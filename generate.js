const { chromium } = require('playwright');
const fs = require('fs');

const DATA_FILE = process.env.ARL_DATA_FILE || 'arls.json';
const TARGET_FILE = process.env.ARL_TARGET_FILE || 'arl.txt';
const DAILY_COUNT = parseInt(process.env.ARL_DAILY_COUNT || '10', 10);
const KEEP_DAYS = parseInt(process.env.ARL_KEEP_DAYS || '30', 10);

const FIRST_NAMES = ['marco', 'luca', 'matteo', 'alessio', 'davide', 'andrea', 'simone', 'federico', 'lorenzo', 'gabriele', 'alex', 'chris', 'jordan', 'sam', 'daniel', 'robert'];
const LAST_NAMES = ['rossi', 'bianchi', 'ferrari', 'ricci', 'marino', 'greco', 'bruno', 'conti', 'miller', 'smith', 'brown', 'wilson', 'taylor', 'clark'];

function r(len) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function generateRealisticEmail() {
  const f = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const l = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  const n = Math.floor(100 + Math.random() * 900);
  return `${f}.${l}${n}@gmail.com`;
}

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

async function humanMoveAndClick(page, locator) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator.first();
  await el.waitFor({ state: 'visible', timeout: 10000 });
  const box = await el.boundingBox();
  if (box) {
    const targetX = box.x + box.width / 2 + (Math.random() * 10 - 5);
    const targetY = box.y + box.height / 2 + (Math.random() * 6 - 3);
    await page.mouse.move(targetX - 40, targetY - 20, { steps: 5 });
    await delay(60);
    await page.mouse.move(targetX, targetY, { steps: 5 });
    await delay(120);
    await page.mouse.click(targetX, targetY);
  } else {
    await el.click();
  }
}

async function sendTelegram(text) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  if (!token || !chatId) { log('Telegram non configurato - salto invio'); return; }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    const data = await resp.json();
    if (!data.ok) log(`Telegram errore: ${JSON.stringify(data)}`);
    else log(`Telegram inviato (${text.length} caratteri)`);
  } catch (e) { log(`Telegram fallito: ${e.message}`); }
}

function loadExisting() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { log(`Errore lettura ${DATA_FILE}: ${e.message}`); return []; }
}

async function trySession(launchOpts) {
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto('https://www.deezer.com/us/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await delay(3000);
    const title = await page.title().catch(() => '');
    const blocked = await page.evaluate(() => document.documentElement.outerHTML.substring(0, 2000).toLowerCase()).catch(() => '');
    const hasChallenge = title.toLowerCase().includes('just a moment')
      || title.toLowerCase().includes('captcha')
      || blocked.includes('cf-challenge')
      || blocked.includes('challenge-platform');
    const pageEmpty = title.trim() === '' || page.url().startsWith('chrome-error://');
    if (!hasChallenge && !pageEmpty) {
      log(`Sessione ok (title: "${title}")`);
      return { browser, page, context };
    }
    const reason = pageEmpty ? `vuota/errore (url: ${page.url()})` : 'challenge Cloudflare';
    log(`Sessione ${reason} - tentativo ${attempt + 1}/3`);
    await delay(5000 * (attempt + 1));
  }
  await browser.close();
  return null;
}

async function createOne(page, context) {
  const email = generateRealisticEmail();
  const password = `Dz${r(10)}!A1`;
  const username = email.split('@')[0].replace('.', '') + r(2);

  log(`  -> registrazione form: ${email} (user: ${username})`);

  // Navigare alla pagina di registrazione US
  await page.goto('https://www.deezer.com/us/register', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await delay(2500);

  try {
    // Step 1: Email
    log(`  -> step 1 (email)...`);
    const emailInput = page.locator('input[type="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.click();
    await emailInput.fill(email);
    await delay(500);

    // Cerca il pulsante "Continue" o simile
    let continueBtn = page.locator('button:has-text("Continue")').first();
    let found = await continueBtn.isVisible().catch(() => false);
    if (!found) {
      continueBtn = page.locator('button:has-text("continue")').first();
      found = await continueBtn.isVisible().catch(() => false);
    }
    if (!found) {
      continueBtn = page.locator('button[type="submit"]').first();
    }

    await continueBtn.click();
    await delay(2000);

    // Step 2: Password
    log(`  -> step 2 (password)...`);
    const passInput = page.locator('input[type="password"]').first();
    await passInput.waitFor({ state: 'visible', timeout: 10000 });
    await passInput.click();
    await passInput.fill(password);
    await delay(500);

    continueBtn = page.locator('button:has-text("Continue")').first();
    found = await continueBtn.isVisible().catch(() => false);
    if (!found) {
      continueBtn = page.locator('button:has-text("continue")').first();
      found = await continueBtn.isVisible().catch(() => false);
    }
    if (!found) {
      continueBtn = page.locator('button[type="submit"]').first();
    }

    await continueBtn.click();
    await delay(2000);

    // Step 3: Username + Age + Gender
    log(`  -> step 3 (username, age, gender)...`);
    const userInput = page.locator('input').filter({ hasText: /username|user|name/i }).first();
    if (await userInput.isVisible().catch(() => false)) {
      await userInput.click();
      await userInput.fill(username);
      await delay(500);
    }

    // Age field (Chakra NumberInput): click, clear, type 18
    const ageInput = page.locator('input[type="number"]').first();
    if (await ageInput.isVisible().catch(() => false)) {
      await ageInput.click();
      await ageInput.selectText();
      await ageInput.type('18');
      await delay(300);
    }

    // Gender/Identity: look for select or radio buttons
    const maleOption = page.locator('input[value="M"]').first();
    if (await maleOption.isVisible().catch(() => false)) {
      await maleOption.click();
      await delay(300);
    }

    // Submit form
    continueBtn = page.locator('button:has-text("Continue")').first();
    found = await continueBtn.isVisible().catch(() => false);
    if (!found) {
      continueBtn = page.locator('button:has-text("continue")').first();
      found = await continueBtn.isVisible().catch(() => false);
    }
    if (!found) {
      continueBtn = page.locator('button:has-text("Create account")').first();
      found = await continueBtn.isVisible().catch(() => false);
    }
    if (!found) {
      continueBtn = page.locator('button[type="submit"]').first();
    }

    await continueBtn.click();
    await delay(3000);

  } catch (err) {
    log(`Errore durante compilazione form: ${err.message}`);
    throw err;
  }

  // Estrai ARL dai cookie della sessione
  log(`  -> estrazione ARL dai cookie...`);
  const cookies = await context.cookies();
  const arlCookie = cookies.find(c => c.name === 'arl');
  const sidCookie = cookies.find(c => c.name === 'sid');

  if (!arlCookie) {
    throw new Error(`ARL non trovato nei cookie di risposta`);
  }

  const arl = arlCookie.value;
  log(`  -> ARL ottenuto: ${arl.substring(0, 20)}...`);

  // Validazione: verificare ARL con deezer.getUserData
  log(`  -> validazione ARL...`);
  try {
    const cid = Math.floor(Math.random() * 999999);
    const gw = 'https://www.deezer.com/us/ajax/gw-light.php';  // ✅ MIRROR /us CORRETTO
    const r = await context.request.get(`${gw}?method=deezer.getUserData&input=3&api_version=1.0&api_token=&cid=${cid}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 DeezerKotlin/1.0' },
    });
    const data = await r.json().catch(() => null);
    if (!data || data?.error && Object.keys(data.error).length > 0) {
      log(`  -> Validazione fallita: ${JSON.stringify(data?.error)}`);
      throw new Error('ARL validation failed');
    }
    log(`  -> ARL validato!`);
  } catch (e) {
    log(`  -> Validazione fallita: ${e.message}`);
    throw e;
  }

  return { arl, email, password, username };
}

async function main() {
  const existing = loadExisting();
  const now = new Date();
  const cutoff = now.getTime() - KEEP_DAYS * 86400 * 1000;
  const valid = existing.filter(e => { const t = Date.parse(e.created || 0); return !isNaN(t) && t >= cutoff; });
  log(`ARL esistenti: ${existing.length}, validi dopo prune (<${KEEP_DAYS}g): ${valid.length}`);

  const useHeadful = Boolean(process.env.DISPLAY);
  log(`Modalità browser: ${useHeadful ? 'HEADFUL (via Xvfb virtual display)' : 'HEADLESS'}`);

  const launchOpts = {
    headless: !useHeadful,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,800',
    ],
  };
  if (process.env.PROXY_URL) {
    launchOpts.proxy = { server: process.env.PROXY_URL };
    log(`Proxy configurato: ${process.env.PROXY_URL}`);
  }

  log('Getting session...');
  const sessionResult = await trySession(launchOpts);
  if (!sessionResult) {
    log('ERROR: Impossibile ottenere sessione Deezer');
    process.exitCode = 1;
    return;
  }

  const { browser, page, context } = sessionResult;

  try {
    let created = 0;
    const today = new Date().toISOString();
    const fresh = [];

    for (let i = 0; i < DAILY_COUNT; i++) {
      try {
        const rec = await createOne(page, context);
        const entry = { ...rec, created: today };
        valid.push(entry);
        fresh.push(entry);
        created++;
        log(`[${i + 1}/${DAILY_COUNT}] ARL ok: ${rec.arl.substring(0, 20)}...`);
      } catch (err) {
        log(`[${i + 1}/${DAILY_COUNT}] fallito: ${err.message}`);
        await delay(3000);
      }
      if (i < DAILY_COUNT - 1) await delay(2000);
    }

    if (fresh.length > 0) {
      const lines = fresh.map(e => `ARL ${e.email}\n\`${e.arl}\`\nPass: \`${e.password}\``).join('\n\n');
      await sendTelegram(`*D33Z3R - ${fresh.length} nuovi ARL (${new Date().toISOString().substring(0, 10)})*\n\n${lines}`);
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(valid, null, 2));
    log(`Salvati ${valid.length} ARL in ${DATA_FILE} (nuovi oggi: ${created})`);

    if (valid.length > 0) {
      const newest = valid[valid.length - 1];
      fs.writeFileSync(TARGET_FILE, `email: ${newest.email}\npassword: ${newest.password}\narl: ${newest.arl}\ncreated: ${newest.created}\n`);
      log(`Aggiornato ${TARGET_FILE} con l'ARL piu recente`);
    }
  } catch (err) {
    log(`ERROR: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
