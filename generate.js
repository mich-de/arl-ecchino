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
// UI-based registration — evita il blocco WAF su gw-light.php?method=user.create
// ---------------------------------------------------------------------------
async function createOne(page) {
  const email    = `deezerbot${r(8)}@gmail.com`;
  const password = `Dz${r(10)}!A1`;
  const username = `dzuser${r(6)}`;

  log(`  → registrazione form: ${email}`);

  // Naviga alla pagina di registrazione
  await page.goto('https://www.deezer.com/us/register', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  }).catch(() => {});
  await delay(3000);

  // Accetta cookie se compare il banner
  await acceptCookies(page);

  // Controlla blocco WAF
  const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  if (bodyText.toLowerCase().includes('access denied')) {
    await page.screenshot({ path: 'debug_register_blocked.png', fullPage: true }).catch(() => {});
    throw new Error('Pagina di registrazione bloccata (Access Denied)');
  }

  // ── Email ──────────────────────────────────────────────────────────────
  const emailSels = [
    'input[name="email"]',
    'input[type="email"]',
    'input[placeholder*="email" i]',
    '#email',
    '#signup-email',
  ];
  let emailFilled = false;
  for (const sel of emailSels) {
    try {
      await page.waitForSelector(sel, { timeout: 4000 });
      await page.fill(sel, email);
      emailFilled = true;
      break;
    } catch {}
  }
  if (!emailFilled) {
    await page.screenshot({ path: 'debug_no_email_field.png', fullPage: true }).catch(() => {});
    const title = await page.title().catch(() => 'n/a');
    throw new Error(`Campo email non trovato — title: "${title}" url: ${page.url()}`);
  }
  await delay(400 + Math.random() * 300);

  // ── Password ───────────────────────────────────────────────────────────
  const passSels = [
    'input[name="password"]',
    'input[type="password"]',
    'input[placeholder*="password" i]',
    '#password',
    '#signup-password',
  ];
  for (const sel of passSels) {
    try {
      const el = await page.$(sel);
      if (el) { await el.fill(password); break; }
    } catch {}
  }
  await delay(400 + Math.random() * 200);

  // ── Username / blog_name (opzionale) ───────────────────────────────────
  const nameSels = [
    'input[name="blog_name"]',
    'input[name="username"]',
    'input[name="name"]',
    'input[placeholder*="username" i]',
  ];
  for (const sel of nameSels) {
    try {
      const el = await page.$(sel);
      if (el) { await el.fill(username); break; }
    } catch {}
  }
  await delay(300);

  // ── Data di nascita (dropdown o input date) ────────────────────────────
  try {
    const dayEl = await page.$('select[name="day"], select[name="birth_day"], select[name="birthDay"]');
    if (dayEl) await dayEl.selectOption('15');

    const monthEl = await page.$('select[name="month"], select[name="birth_month"], select[name="birthMonth"]');
    if (monthEl) await monthEl.selectOption('6');

    const yearEl = await page.$('select[name="year"], select[name="birth_year"], select[name="birthYear"]');
    if (yearEl) await yearEl.selectOption('1995');

    const dateEl = await page.$('input[type="date"][name*="birth"], input[name="birthday"]');
    if (dateEl) await dateEl.fill('1995-06-15');
  } catch {}
  await delay(300);

  // ── Genere (opzionale) ────────────────────────────────────────────────
  try {
    const genderSel = await page.$('select[name="sex"], select[name="gender"]');
    if (genderSel) {
      await genderSel.selectOption('M');
    } else {
      const maleRadio = await page.$('input[name="sex"][value="M"], input[name="gender"][value="M"]');
      if (maleRadio && !(await maleRadio.isChecked())) await maleRadio.click();
    }
  } catch {}
  await delay(300);

  // ── Checkbox termini (opzionale) ──────────────────────────────────────
  try {
    const chk = await page.$('input[type="checkbox"][name*="cgu"], input[type="checkbox"][name*="terms"]');
    if (chk && !(await chk.isChecked())) await chk.click();
  } catch {}
  await delay(400);

  // ── Submit ─────────────────────────────────────────────────────────────
  const submitSels = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Create")',
    'button:has-text("Register")',
    'button:has-text("Sign up")',
    'button:has-text("Get started")',
  ];
  for (const sel of submitSels) {
    try {
      const btn = await page.$(sel);
      if (btn) { await btn.click(); break; }
    } catch {}
  }

  // Attendi navigazione post-registrazione
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
    delay(15000),
  ]).catch(() => {});
  await delay(2500);

  // ── Estrai ARL dai cookie ─────────────────────────────────────────────
  const cookies   = await page.context().cookies(['https://www.deezer.com']);
  const arlCookie = cookies.find(c => c.name === 'arl');
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