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

async function sendTelegram(text) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  log(`Telegram config: token=${token ? token.substring(0, 10) + '...' : 'MISSING'}, chatId=${chatId || 'MISSING'}`);
  if (!token || !chatId) { log('Telegram non configurato - salto invio'); return; }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    log(`Telegram POST: ${url.substring(0, 50)}...`);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    const data = await resp.json();
    log(`Telegram response: ${JSON.stringify(data).substring(0, 500)}`);
    if (!data.ok) log(`Telegram errore: ${JSON.stringify(data)}`);
    else log(`Telegram inviato OK (${text.length} caratteri)`);
  } catch (e) { log(`Telegram fallito: ${e.message}\n${e.stack}`); }
}

function loadExisting() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { log(`Errore lettura ${DATA_FILE}: ${e.message}`); return []; }
}

/**
 * Genera un ARL via API Deezer gw-light (basato su preezer DeezerApi.kt)
 *
 * Flusso:
 * 1. POST deezer.getUserData (senza auth) → ottieni USER_TOKEN
 * 2. POST user.create con USER_TOKEN → ottieni ARL
 */
async function createOne() {
  const email = generateRealisticEmail();
  const password = `Dz${r(10)}!A1`;
  const username = email.split('@')[0].replace('.', '') + r(2);

  log(`  -> generazione ARL: ${email} (user: ${username})`);

  const gwUrl = 'https://www.deezer.com/us/ajax/gw-light.php';
  const cid = Math.floor(Math.random() * 999999);
  const headers = {
    'User-Agent': 'Mozilla/5.0 DeezerKotlin/1.0',
    'Content-Type': 'application/json',
  };

  try {
    // 1. Ottieni USER_TOKEN da deezer.getUserData (API anonima)
    log(`  -> step 1 (getUserData)...`);
    const url1 = `${gwUrl}?method=deezer.getUserData&input=3&api_version=1.0&api_token=&cid=${cid}`;
    log(`  -> POST: ${url1.substring(0, 80)}...`);
    const r1 = await fetch(url1, {
      method: 'POST',
      headers,
      body: JSON.stringify({ APP_NAME: 'Deezer' }),
    });

    if (!r1.ok) {
      throw new Error(`HTTP ${r1.status} da getUserData`);
    }

    const d1 = await r1.json();

    // Controlla se error è un array vuoto (successo) o un oggetto (errore)
    if (d1.error && typeof d1.error === 'object' && !Array.isArray(d1.error) && Object.keys(d1.error).length > 0) {
      throw new Error(`Errore API: ${JSON.stringify(d1.error)}`);
    }

    const apiToken = d1.results?.USER_TOKEN;
    if (!apiToken) {
      throw new Error(`No USER_TOKEN in response: ${JSON.stringify(d1).substring(0, 200)}`);
    }

    log(`  -> USER_TOKEN ottenuto`);

    // 2. Crea account con user.create
    log(`  -> step 2 (user.create)...`);
    const r2 = await fetch(`${gwUrl}?method=user.create&input=3&api_version=1.0&api_token=${apiToken}&cid=${Math.floor(Math.random() * 999999)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        APP_NAME: 'Deezer',
        EMAIL: email,
        PASSWORD: password,
        BLOG_NAME: username,
        SEX: 'M',
        BIRTHDAY: '1995-06-15',
        JOURNEY_VERSION: 'unlogged_smart_and_login_web_v1',
      }),
    });

    if (!r2.ok) {
      throw new Error(`HTTP ${r2.status} da user.create`);
    }

    const bodyText = await r2.text();

    // Controlla se è bloccato da WAF
    if (bodyText.includes('Access Denied') || !bodyText.trimStart().startsWith('{')) {
      throw new Error('Bloccato da Akamai WAF - user.create non disponibile');
    }

    const d2 = JSON.parse(bodyText);

    // Controlla errore (error è un array vuoto in successo, oggetto in errore)
    if (d2.error && typeof d2.error === 'object' && !Array.isArray(d2.error) && Object.keys(d2.error).length > 0) {
      throw new Error(`Errore user.create: ${d2.error.message || JSON.stringify(d2.error)}`);
    }

    const arl = d2.results?.arl;
    if (!arl) {
      throw new Error(`No ARL in response: ${JSON.stringify(d2).substring(0, 300)}`);
    }

    log(`  -> ARL ottenuto: ${arl.substring(0, 20)}...`);
    return { arl, email, password, username };

  } catch (err) {
    log(`  -> fallito: ${err.message}`);
    log(`  -> stack: ${err.stack}`);
    throw err;
  }
}

async function main() {
  // Test Telegram subito all'avvio
  log('=== Test invio Telegram ===');
  await sendTelegram('🔧 arl-ecchino test: workflow avviato');
  log('=== Fine test Telegram ===');

  const existing = loadExisting();
  const now = new Date();
  const cutoff = now.getTime() - KEEP_DAYS * 86400 * 1000;
  const valid = existing.filter(e => { const t = Date.parse(e.created || 0); return !isNaN(t) && t >= cutoff; });
  log(`ARL esistenti: ${existing.length}, validi dopo prune (<${KEEP_DAYS}g): ${valid.length}`);

  try {
    let created = 0;
    const today = new Date().toISOString();
    const fresh = [];

    for (let i = 0; i < DAILY_COUNT; i++) {
      try {
        const rec = await createOne();
        const entry = { ...rec, created: today };
        valid.push(entry);
        fresh.push(entry);
        created++;
        log(`[${i + 1}/${DAILY_COUNT}] ✓ ARL: ${rec.arl.substring(0, 20)}...`);
      } catch (err) {
        log(`[${i + 1}/${DAILY_COUNT}] ✗ ${err.message}`);
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

    process.exitCode = created > 0 ? 0 : 1;
  } catch (err) {
    log(`ERROR: ${err.message}`);
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e); process.exit(1); });
