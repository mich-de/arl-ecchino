const { chromium } = require('playwright');
const fs = require('fs');

const DATA_FILE = process.env.ARL_DATA_FILE || 'arls.json';
const TARGET_FILE = process.env.ARL_TARGET_FILE || 'arl.txt';
const DAILY_COUNT = parseInt(process.env.ARL_DAILY_COUNT || '10', 10);
const KEEP_DAYS = parseInt(process.env.ARL_KEEP_DAYS || '30', 10);

function r(len) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

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

async function createOne(page) {
  const email = `deezerbot${r(8)}@outlook.com`;
  const password = `Dz${r(10)}!A1`;
  const username = `dzuser${r(6)}`;

  const tokenResult = await page.evaluate(async () => {
    const resp = await fetch('https://www.deezer.com/ajax/gw-light.php?method=deezer.getUserData&input=3&api_version=1.0.0&api_token=&cid=' + Math.floor(Math.random() * 999999), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ APP_NAME: 'Deezer' }),
      credentials: 'include',
    });
    return await resp.json();
  });
  const apiToken = tokenResult.results?.USER_TOKEN || '';
  if (!apiToken) throw new Error('No API token');

  const createResult = await page.evaluate(async (params) => {
    const { token, email, password, username } = params;
    const resp = await fetch(`https://www.deezer.com/ajax/gw-light.php?method=user.create&input=3&api_version=1.0.0&api_token=${token}&cid=${Math.floor(Math.random() * 999999)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        APP_NAME: 'Deezer',
        EMAIL: email,
        PASSWORD: password,
        BLOG_NAME: username,
        SEX: 'M',
        BIRTHDAY: '1995-06-15',
        JOURNEY_VERSION: 'unlogged_smart_and_login_web_v1',
      }),
      credentials: 'include',
    });
    return await resp.json();
  }, { token: apiToken, email, password, username });

  if (createResult.results?.arl) {
    return { arl: createResult.results.arl, email, password, username };
  }
  if (createResult.error?.REQUEST_ERROR === 'email_already_used') {
    // email collision: retry once with a new email
    const email2 = `deezerbot${r(8)}@outlook.com`;
    const createResult2 = await page.evaluate(async (params) => {
      const { token, email, password, username } = params;
      const resp = await fetch(`https://www.deezer.com/ajax/gw-light.php?method=user.create&input=3&api_version=1.0.0&api_token=${token}&cid=${Math.floor(Math.random() * 999999)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          APP_NAME: 'Deezer',
          EMAIL: email,
          PASSWORD: password,
          BLOG_NAME: username,
          SEX: 'M',
          BIRTHDAY: '1995-06-15',
          JOURNEY_VERSION: 'unlogged_smart_and_login_web_v1',
        }),
        credentials: 'include',
      });
      return await resp.json();
    }, { token: apiToken, email: email2, password, username });
    if (createResult2.results?.arl) {
      return { arl: createResult2.results.arl, email: email2, password, username };
    }
  }
  throw new Error('Creazione fallita: ' + JSON.stringify(createResult.error || createResult));
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

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

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
    await page.goto('https://www.deezer.com/us/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delay(2000);

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