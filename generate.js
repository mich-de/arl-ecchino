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

async function sendTelegram(text) {
  const token  = process.env.TG_BOT_TOKEN;
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
    else          log(`Telegram inviato (${text.length} caratteri)`);
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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    ignoreHTTPSErrors: true,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  const page = await context.newPage();

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto('https://www.deezer.com/us/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await delay(3000);
    const title   = await page.title().catch(() => '');
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
  const email    = `deezerbot${r(8)}@gmail.com`;
  const password = `Dz${r(10)}!A1`;
  const username = `dzuser${r(6)}`;
  const age      = '28';

  log(`  -> registrazione form: ${email}`);

  // networkidle assicura che la SPA React abbia completato il rendering
  await page.goto('https://account.deezer.com/en-us/signup/', {
    waitUntil: 'networkidle',
    timeout: 45000,
  }).catch(() => {});
  await delay(2000);
  log(`  -> URL dopo goto: ${page.url()}`);

  // Chiudi il popup cookie ("A note about our cookies") — blocca il form se non chiuso
  // Selettori esatti da ispezione DOM account.deezer.com
  const cookieBtns = [
    '#gdpr-btn-refuse',              // esatto — da ispezione
    '#gdpr-btn-accept',              // fallback
    'button:has-text("Refuse")',
    'button:has-text("Reject")',
    'button:has-text("Reject all")',
    'button:has-text("Accept")',
    'button:has-text("Accept all")',
    '[data-testid="gdpr-refuse"]',
    '[data-testid="gdpr-accept"]',
    '#didomi-notice-disagree-button',
    '#didomi-notice-agree-button',
  ];
  for (const sel of cookieBtns) {
    try {
      await page.click(sel, { timeout: 2000 });
      log(`  -> Cookie popup chiuso (${sel})`);
      await delay(800);
      break;
    } catch {}
  }

  const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  if (bodyText.toLowerCase().includes('access denied')) {
    await page.screenshot({ path: 'debug_signup_blocked.png', fullPage: true }).catch(() => {});
    throw new Error('Pagina di registrazione bloccata (Access Denied)');
  }

  // ── STEP 1: Email — prova piu selettori ────────────────────────────────
  const emailSels = [
    '#email',
    'input[type="email"]',
    'input[name="email"]',
    'input[autocomplete="email"]',
    'input[placeholder*="email" i]',
  ];
  let emailSel = null;
  for (const sel of emailSels) {
    try { await page.waitForSelector(sel, { timeout: 6000 }); emailSel = sel; break; } catch {}
  }
  if (!emailSel) {
    await page.screenshot({ path: 'debug_no_email.png', fullPage: true }).catch(() => {});
    const title = await page.title().catch(() => '');
    throw new Error(`Campo email non trovato - url: ${page.url()} title: ${title}`);
  }
  await page.fill(emailSel, email);
  await delay(400 + Math.random() * 300);
  await page.click('button:has-text("Continue")');
  await delay(2500);

  try { await page.waitForSelector('#password', { timeout: 15000 }); }
  catch {
    await page.screenshot({ path: 'debug_no_password.png', fullPage: true }).catch(() => {});
    throw new Error(`Campo #password non trovato - url: ${page.url()}`);
  }
  await page.fill('#password', password);
  await delay(400 + Math.random() * 200);
  await page.click('button:has-text("Continue")');
  await delay(2500);

  try { await page.waitForSelector('#username', { timeout: 15000 }); }
  catch {
    await page.screenshot({ path: 'debug_no_username.png', fullPage: true }).catch(() => {});
    throw new Error(`Campo #username non trovato - url: ${page.url()}`);
  }
  await page.fill('#username', username);
  await delay(300);

  try { await page.fill('#age', age); await delay(300); } catch {}
  try { await page.selectOption('#identity', { index: 1 }); await delay(300); } catch {}

  // Aspetta che il pulsante sia cliccabile prima di premere
  try { await page.waitForSelector('button:has-text("Sign up for free")', { timeout: 5000 }); } catch {}
  await page.click('button:has-text("Sign up for free")');
  log('  -> Submit cliccato, attendo navigazione post-registrazione...');
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }),
    delay(25000),
  ]).catch(() => {});
  await delay(3000);
  log(`  -> URL post-submit: ${page.url()}`);

  // Se siamo ancora su account.deezer.com, naviga su www.deezer.com
  // L'ARL cookie viene impostato dopo il redirect alla home
  if (page.url().includes('account.deezer.com') || page.url().includes('signup')) {
    log('  -> Navigo su www.deezer.com per ottenere il cookie ARL...');
    await page.goto('https://www.deezer.com/us/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await delay(3000);
    log(`  -> URL dopo redirect: ${page.url()}`);
  }

  // Leggi cookie da tutti i domini Deezer
  const allCookies = await page.context().cookies([
    'https://www.deezer.com',
    'https://account.deezer.com',
    'https://deezer.com',
  ]);
  log(`  -> Cookie trovati: ${allCookies.map(c => c.name).join(', ') || 'nessuno'}`);
  const arlCookie = allCookies.find(c => c.name === 'arl');
  if (!arlCookie?.value) {
    const snippet = await page.evaluate(() => document.body?.innerText?.substring(0, 400) || '').catch(() => '');
    await page.screenshot({ path: 'debug_no_arl.png', fullPage: true }).catch(() => {});
    throw new Error(`ARL non trovato. URL: ${page.url()} | Pagina: ${snippet.substring(0, 150)}`);
  }
  return { arl: arlCookie.value, email, password, username };
}

async function main() {
  const existing = loadExisting();
  const now      = new Date();
  const cutoff   = now.getTime() - KEEP_DAYS * 86400 * 1000;
  const valid    = existing.filter(e => { const t = Date.parse(e.created || 0); return !isNaN(t) && t >= cutoff; });
  log(`ARL esistenti: ${existing.length}, validi dopo prune (<${KEEP_DAYS}g): ${valid.length}`);

  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
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
        const rec   = await createOne(page);
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
