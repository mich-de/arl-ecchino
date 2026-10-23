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

/** Escape HTML per Telegram parse_mode HTML */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Invia messaggio Telegram. Prova HTML, se fallisce riprova plain text.
 */
async function sendTelegram(html, plainFallback) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  log(`Telegram config: token=${token ? token.substring(0, 10) + '...' : 'MISSING'}, chatId=${chatId || 'MISSING'}`);
  if (!token || !chatId) { log('Telegram non configurato - salto invio'); return; }

  const base = `https://api.telegram.org/bot${token}`;

  // Verifica bot attivo
  try {
    const me = await fetch(`${base}/getMe`);
    const meData = await me.json();
    log(`Bot info: ${JSON.stringify(meData)}`);
    if (!meData.ok) { log('ERRORE: bot token invalido!'); return; }
  } catch (e) { log(`getMe fallito: ${e.message}`); return; }

  // Tentativo 1: HTML
  try {
    log(`Telegram invio HTML (${html.length} char)...`);
    const resp = await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML' }),
    });
    const data = await resp.json();
    log(`Telegram response: ${JSON.stringify(data).substring(0, 500)}`);
    if (data.ok) { log('Telegram inviato OK (HTML)'); return; }

    // Se errore "chat not found" o "bot was blocked"
    if (data.description?.includes('chat not found')) {
      log('ERRORE: chat_id non trovato! L\'utente deve premere /start sul bot.');
    } else if (data.description?.includes('bot was blocked')) {
      log('ERRORE: il bot è stato bloccato dall\'utente.');
    }

    // Fallback: plain text senza formattazione
    log('Riprovo senza parse_mode...');
    const plain = plainFallback || html.replace(/<[^>]+>/g, '');
    const resp2 = await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: plain }),
    });
    const data2 = await resp2.json();
    log(`Telegram plain response: ${JSON.stringify(data2).substring(0, 500)}`);
    if (data2.ok) log('Telegram inviato OK (plain)');
    else log(`Telegram fallito anche plain: ${JSON.stringify(data2)}`);
  } catch (e) { log(`Telegram errore: ${e.message}\n${e.stack}`); }
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
    const r1 = await fetch(`${gwUrl}?method=deezer.getUserData&input=3&api_version=1.0&api_token=&cid=${cid}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ APP_NAME: 'Deezer' }),
    });

    if (!r1.ok) {
      throw new Error(`HTTP ${r1.status} da getUserData`);
    }

    const d1 = await r1.json();

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

    if (bodyText.includes('Access Denied') || !bodyText.trimStart().startsWith('{')) {
      throw new Error('Bloccato da Akamai WAF - user.create non disponibile');
    }

    const d2 = JSON.parse(bodyText);

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
  // Test connessione Telegram all'avvio
  log('=== Test Telegram ===');
  await sendTelegram('🔧 <b>arl-ecchino</b> workflow avviato');
  log('=== Fine test ===');

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
      // Messaggio HTML (safe)
      const lines = fresh.map(e =>
        `📧 ${esc(e.email)}\n<code>${esc(e.arl)}</code>\n🔑 <code>${esc(e.password)}</code>`
      ).join('\n\n');
      const html = `🎉 <b>D33Z3R — ${fresh.length} nuovi ARL</b>\n📅 ${new Date().toISOString().substring(0, 10)}\n\n${lines}`;

      // Fallback plain (senza tag)
      const plainLines = fresh.map(e => `${e.email}\n${e.arl}\nPass: ${e.password}`).join('\n\n');
      const plain = `D33Z3R — ${fresh.length} nuovi ARL\n${new Date().toISOString().substring(0, 10)}\n\n${plainLines}`;

      await sendTelegram(html, plain);
    } else {
      await sendTelegram('⚠️ <b>arl-ecchino</b>: nessun ARL generato oggi. Controlla i log su GitHub Actions.');
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
