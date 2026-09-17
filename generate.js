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
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    delete Object.getPrototypeOf(navigator).webdriver;
    window.chrome = { runtime: {} };
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
      return { browser, page };
    }
    const reason = pageEmpty ? `vuota/errore (url: ${page.url()})` : 'challenge Cloudflare';
    log(`Sessione ${reason} - tentativo ${attempt + 1}/3`);
    await delay(5000 * (attempt + 1));
  }
  await browser.close();
  return null;
}

async function createOne(page) {
  const email = generateRealisticEmail();
  const password = `Dz${r(10)}!A1`;
  const username = email.split('@')[0].replace('.', '') + r(2);

  log(`  -> registrazione API (in-browser): ${email} (user: ${username})`);

  // Navigazione iniziale per ottenere il contesto corretto (cookie, origine) e il fingerprint Chromium
  await page.goto('https://www.deezer.com/us/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await delay(2000);
  
  const result = await page.evaluate(async (params) => {
    const { email, password, username } = params;
    const cid = Math.floor(Math.random() * 999999);
    
    // 1. Fetch anonymous API token
    const r1 = await fetch(`https://www.deezer.com/ajax/gw-light.php?method=deezer.getUserData&input=3&api_version=1.0&api_token=&cid=${cid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ APP_NAME: "Deezer" })
    });
    const t1 = await r1.text();
    let j1;
    try { j1 = JSON.parse(t1); } catch(e) { return { error: "Token parse fail", text: t1.substring(0,200) }; }
    
    const apiToken = j1.results?.USER_TOKEN;
    if (!apiToken) return { error: "No USER_TOKEN", response: j1 };

    // 2. Create account using user.create (Velune-doped method)
    const r2 = await fetch(`https://www.deezer.com/ajax/gw-light.php?method=user.create&input=3&api_version=1.0&api_token=${apiToken}&cid=${cid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        APP_NAME: "Deezer",
        EMAIL: email,
        PASSWORD: password,
        BLOG_NAME: username,
        SEX: "M",
        BIRTHDAY: "1995-06-15",
        JOURNEY_VERSION: "unlogged_smart_and_login_web_v1"
      })
    });
    const t2 = await r2.text();
    let j2;
    try { j2 = JSON.parse(t2); } catch(e) { return { error: "Create parse fail", text: t2.substring(0,200) }; }
    
    return { arl: j2?.results?.arl, response: j2 };
  }, { email, password, username });

  if (result.error) {
    throw new Error(`API Fallita: ${result.error} | Data: ${JSON.stringify(result.text || result.response)}`);
  }
  
  if (result.response?.error && Object.keys(result.response.error).length > 0) {
    throw new Error(`Errore API Deezer: ${JSON.stringify(result.response.error)}`);
  }

  if (!result.arl) {
    throw new Error(`ARL non restituito dall'API: ${JSON.stringify(result.response).substring(0,300)}`);
  }

  log(`  -> API call success: ARL ottenuto!`);
  return { arl: result.arl, email, password, username };
}

async function main() {
  const existing = loadExisting();
  const now = new Date();
  const cutoff = now.getTime() - KEEP_DAYS * 86400 * 1000;
  const valid = existing.filter(e => { const t = Date.parse(e.created || 0); return !isNaN(t) && t >= cutoff; });
  log(`ARL esistenti: ${existing.length}, validi dopo prune (<${KEEP_DAYS}g): ${valid.length}`);

  // Se DISPLAY è impostato (es. via xvfb-run), usa browser headful reale!
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
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  };

  log('Getting session...');
  const sessionResult = await trySession(launchOpts);
  if (!sessionResult) {
    log('ERROR: Impossibile ottenere sessione Deezer');
    process.exitCode = 1;
    return;
  }

  const { browser, page } = sessionResult;

  try {
    let created = 0;
    const today = new Date().toISOString();
    const fresh = [];

    for (let i = 0; i < DAILY_COUNT; i++) {
      try {
        const rec = await createOne(page);
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
