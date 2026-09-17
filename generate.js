const { chromium } = require('playwright');
const fs = require('fs');

const DATA_FILE   = process.env.ARL_DATA_FILE  || 'arls.json';
const TARGET_FILE = process.env.ARL_TARGET_FILE || 'arl.txt';
const DAILY_COUNT = parseInt(process.env.ARL_DAILY_COUNT || '10', 10);
const KEEP_DAYS   = parseInt(process.env.ARL_KEEP_DAYS   || '30', 10);

function r(len) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

// ---------------------------------------------------------------------------
// Cookie / GDPR banner dismissal
// ---------------------------------------------------------------------------
async function acceptCookies(page) {
  const selectors = [
    '#gdpr-btn-accept-all',
    'button[data-testid="gdpr-btn-accept-all"]',
    '[data-testid*="accept-all"]',
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("I accept")',
    'button:has-text("Agree")',
    '#didomi-notice-agree-button',
    '.gdpr-btn-accept',
  ];
  for (const sel of selectors) {
    try {
      await page.click(sel, { timeout: 1500 });
      await delay(700);
      return true;
    } catch {}
  }
  return false;
}

async function sendTelegram(text) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  if (!token || !chatId) {
    log('Telegram non configurato (TG_BOT_TOKEN/TG_CHAT_ID mancanti) — salto invio');
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    const data = await resp.json();
    if (!data.ok) log(`Telegram errore: ${JSON.stringify(data)}`);
    else log(`Telegram inviato (${text.length} caratteri)`);
  } catch (e) {
    log(`Telegram fallito: ${e.message}`);
  }
}

function loadExisting() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    log(`Errore lettura ${DATA_FILE}: ${e.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// UI-based registration — flusso multi-step su account.deezer.com
// (Chakra UI React SPA: step0=email, step1=password, step2=profilo)
// ---------------------------------------------------------------------------
async function createOne(page) {
  const email    = `deezerbot${r(8)}@gmail.com`;
  const password = `Dz${r(10)}!A1`;
  const username = `dzuser${r(6)}`;
  const age      = '28';

  log(`  → registrazione form: ${email}`);

  // Naviga direttamente alla signup page (redirige a ?step=0)
  await page.goto('https://account.deezer.com/en-us/signup/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  }).catch(() => {});
  await delay(3000);

  // Accetta cookie banner ("Accept")
  try {
    await page.click('button:has-text("Accept")', { timeout: 5000 });
    await delay(800);
  } catch {}

  // Controlla blocco WAF
  const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  if (bodyText.toLowerCase().includes('access denied')) {
    await page.screenshot({ path: 'debug_signup_blocked.png', fullPage: true }).catch(() => {});
    throw new Error('Pagina di registrazione bloccata (Access Denied)');
  }

  // ── STEP 1: Email ──────────────────────────────────────────────────────
  try {
    await page.waitForSelector('#email', { timeout: 8000 });
  } catch {
    await page.screenshot({ path: 'debug_no_email.png', fullPage: true }).catch(() => {});
    throw new Error(`Campo #email non trovato — url: ${page.url()}`);
  }
  await page.fill('#email', email);
  await delay(400 + Math.random() * 300);
  await page.click('button:has-text("Continue")');
  await delay(2000);

  // ── STEP 2: Password ───────────────────────────────────────────────────
  try {
    await page.waitForSelector('#password', { timeout: 8000 });
  } catch {
    await page.screenshot({ path: 'debug_no_password.png', fullPage: true }).catch(() => {});
    throw new Error(`Campo #password non trovato — url: ${page.url()}`);
  }
  await page.fill('#password', password);
  await delay(400 + Math.random() * 200);
  await page.click('button:has-text("Continue")');
  await delay(2000);

  // ── STEP 3: Profilo (username, age, identity) ──────────────────────────
  try {
    await page.waitForSelector('#username', { timeout: 8000 });
  } catch {
    await page.screenshot({ path: 'debug_no_username.png', fullPage: true }).catch(() => {});
    throw new Error(`Campo #username non trovato — url: ${page.url()}`);
  }
  await page.fill('#username', username);
  await delay(300);

  // Age (spinbutton)
  try {
    await page.fill('#age', age);
    await delay(300);
  } catch {}

  // Identity / gender select
  try {
    await page.selectOption('#identity', { index: 1 }); // prima opzione non-placeholder
    await delay(300);
  } catch {}

  // Submit finale
  await page.click('button:has-text("Sign up for free")');

  // Attendi navigazione post-registrazione
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    delay(20000),
  ]).catch(() => {});
  await delay(3000);

  // ── Estrai ARL dai cookie (dominio .deezer.com) ────────────────────────
  const allCookies = await page.context().cookies([
    'https://www.deezer.com',
    'https://account.deezer.com',
  ]);
  const arlCookie = allCookies.find(c => c.name === 'arl');
  if (!arlCookie?.value) {
    const currentUrl  = page.url();
    const pageSnippet = await page.evaluate(
      () => document.body?.innerText?.substring(0, 400) || ''
    ).catch(() => '');
    await page.screenshot({ path: 'debug_no_arl.png', fullPage: true }).catch(() => {});
    throw new Error(`ARL non trovato. URL: ${currentUrl} | Pagina: ${pageSnippet.substring(0, 150)}`);
  }

  return { arl: arlCookie.value, email, password, username };
}

async function main() {
  const existing = loadExisting();
  const now = new Date();
  const cutoff = now.getTime() - KEEP_DAYS * 86400 * 1000;

  // prune older than KEEP_DAYS
  const valid = existing.filter(e => {
    const t = Date.parse(e.created || 0);
    return !isNaN(t) && t >= cutoff;
  });
  log(`ARL esistenti: ${existing.length}, validi dopo prune (<${KEEP_DAYS}g): ${valid.length}`);

  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  };
  if (process.env.PROXY_URL) {
    launchOpts.proxy = { server: process.env.PROXY_URL };
    log(`Proxy configurato: ${process.env.PROXY_URL}`);
  }
  const browser = await chromium.launch(launchOpts);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  const page = await context.newPage();

  try {
    log('Getting session...');
    // retry in caso di challenge Cloudflare sul primo caricamento
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto('https://www.deezer.com/us/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await delay(3000);
      const title = await page.title().catch(() => '');
      const blocked = await page.evaluate(() => document.documentElement.outerHTML.substring(0, 2000).toLowerCase()).catch(() => '');
      const hasChallenge = title.toLowerCase().includes('just a moment')
        || title.toLowerCase().includes('captcha')
        || blocked.includes('cf-challenge')
        || blocked.includes('challenge-platform')
        || blocked.includes('cloudflare');
      if (!hasChallenge) {
        log(`Sessione ok (title: "${title}")`);
        break;
      }
      log(`Challenge Cloudflare rilevata (tentativo ${attempt + 1}/5), riprovo...`);
      await delay(4000 * (attempt + 1));
    }

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
      await delay(1500);
    }

    if (fresh.length > 0) {
      const lines = fresh.map(e =>
        `ARL ${e.email}\n\`${e.arl}\`\nPass: \`${e.password}\``
      ).join('\n\n');
      await sendTelegram(`*D33Z3R — ${fresh.length} nuovi ARL (${new Date().toISOString().substring(0, 10)})*\n\n${lines}`);
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(valid, null, 2));
    log(`Salvati ${valid.length} ARL in ${DATA_FILE} (nuovi oggi: ${created})`);

    // most recent ARL -> arl.txt
    if (valid.length > 0) {
      const newest = valid[valid.length - 1];
      fs.writeFileSync(TARGET_FILE, `email: ${newest.email}\npassword: ${newest.password}\narl: ${newest.arl}\ncreated: ${newest.created}\n`);
      log(`Aggiornato ${TARGET_FILE} con l'ARL più recente`);
    }
  } catch (err) {
    log(`ERROR: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });