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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  await context.addInitScript(() => {
    // Maschera automazione e incoerenze di piattaforma
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    delete Object.getPrototypeOf(navigator).webdriver;
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
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
  const email = `deezerbot${r(8)}@gmail.com`;
  const password = `Dz${r(10)}!A1`;
  const username = `dzuser${r(6)}`;
  const age = '18';
  const identity = 'M'; // Male

  log(`  -> registrazione form: ${email}`);

  // Monitora risposte di rete rilevanti (autenticazione / registrazione)
  const onResponse = async (resp) => {
    const url = resp.url();
    if (url.includes('signup') || url.includes('register') || url.includes('auth') || url.includes('ajax') || url.includes('gw-light') || url.includes('check')) {
      const status = resp.status();
      log(`  [NET] ${status} ${url.substring(0, 90)}`);
      if (status >= 400 || url.includes('check') || url.includes('user.create')) {
        try {
          const text = await resp.text();
          log(`  [NET BODY] ${text.substring(0, 250)}`);
        } catch {}
      }
    }
  };
  page.on('response', onResponse);

  try {
    // Navigazione iniziale al form di registrazione
    await page.goto('https://account.deezer.com/en-us/signup/', {
      waitUntil: 'networkidle',
      timeout: 45000,
    }).catch(() => {});
    await delay(2000);
    log(`  -> URL dopo goto: ${page.url()}`);

    // Gestione popup Cookie ("A note about our cookies")
    const cookieBtns = [
      '#gdpr-btn-refuse',
      '#gdpr-btn-accept',
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

    // ── STEP 0: Email ───────────────────────────────────────────────────────
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

    await page.locator(emailSel).click();
    await page.locator(emailSel).fill(email);
    await delay(400);
    await page.click('button:has-text("Continue")');
    log('  -> Step 0 (Email) inviato');
    await delay(2000);

    // ── STEP 1: Password ────────────────────────────────────────────────────
    try {
      await page.waitForSelector('#password', { timeout: 15000 });
    } catch {
      await page.screenshot({ path: 'debug_no_password.png', fullPage: true }).catch(() => {});
      throw new Error(`Campo #password non trovato - url: ${page.url()}`);
    }

    await page.locator('#password').click();
    await page.locator('#password').fill(password);
    await delay(400);
    await page.click('button:has-text("Continue")');
    log('  -> Step 1 (Password) inviato');
    await delay(2000);

    // ── STEP 2: Dati personali (Username, Age: 18, Identity: Male) ───────────
    try {
      await page.waitForSelector('#username', { timeout: 15000 });
    } catch {
      await page.screenshot({ path: 'debug_no_username.png', fullPage: true }).catch(() => {});
      throw new Error(`Campo #username non trovato - url: ${page.url()}`);
    }

    // 1. Username
    const usernameInput = page.locator('#username');
    await usernameInput.click();
    await usernameInput.fill(username);
    log(`  -> Username impostato: ${username}`);
    await delay(300);

    // 2. Age (Chakra UI NumberInput / role=spinbutton)
    const ageInput = page.locator('#age');
    await ageInput.waitFor({ state: 'visible', timeout: 5000 });
    await ageInput.click();
    await ageInput.fill('');
    await ageInput.pressSequentially(age, { delay: 80 });
    await page.keyboard.press('Tab');
    await delay(300);
    const enteredAge = await ageInput.inputValue().catch(() => '');
    log(`  -> Age inserito: "${enteredAge}"`);

    // 3. Identity (Chakra UI Select: M = Male)
    const identitySelect = page.locator('#identity');
    await identitySelect.waitFor({ state: 'visible', timeout: 5000 });
    try {
      await identitySelect.selectOption(identity);
    } catch {
      try { await identitySelect.selectOption({ label: 'Male' }); }
      catch { await identitySelect.selectOption({ index: 2 }); }
    }
    await identitySelect.dispatchEvent('change').catch(() => {});
    await delay(300);
    const enteredIdentity = await identitySelect.inputValue().catch(() => '');
    log(`  -> Identity selezionata: "${enteredIdentity}"`);

    // 4. Verifica stato pulsante Submit
    const submitBtn = page.locator('button:has-text("Sign up for free"), button[type="submit"]');
    await submitBtn.first().waitFor({ state: 'visible', timeout: 5000 });
    const isSubmitDisabled = await submitBtn.first().isDisabled().catch(() => false);
    log(`  -> Submit button disabilitato: ${isSubmitDisabled}`);

    // Verifica eventuali errori prima del submit
    const preErrors = await page.$$eval('[class*="error"], [role="alert"], .chakra-form__error-message', els => els.map(e => e.innerText.trim()).filter(Boolean)).catch(() => []);
    if (preErrors.length) log(`  -> Errori prima di submit: ${preErrors.join(' | ')}`);

    // 5. Invio registrazione
    await submitBtn.first().click();
    log('  -> Submit "Sign up for free" cliccato, attendo completamento...');

    // Attendi che l'URL cambi (fuori da signup) o fino a 20s
    try {
      await page.waitForURL(url => !url.toString().includes('signup'), { timeout: 20000 });
      log(`  -> Navigazione post-submit ok: ${page.url()}`);
    } catch {
      log(`  -> Timeout attesa URL post-submit. URL attuale: ${page.url()}`);
      const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 400) || '').catch(() => '');
      log(`  -> Contenuto pagina corrente: ${pageText.replace(/\s+/g, ' ')}`);
      const postErrors = await page.$$eval('[class*="error"], [role="alert"], .chakra-form__error-message', els => els.map(e => e.innerText.trim()).filter(Boolean)).catch(() => []);
      if (postErrors.length) log(`  -> Errori rilevati post-submit: ${postErrors.join(' | ')}`);
      await page.screenshot({ path: 'debug_step2_stuck.png', fullPage: true }).catch(() => {});
    }

    await delay(3000);

    // ── Estrazione Cookie ARL ────────────────────────────────────────────────
    let allCookies = await page.context().cookies();
    let arlCookie = allCookies.find(c => c.name === 'arl' && c.value);

    // Se l'ARL non è presente subito (o siamo su offers/account), naviga su www.deezer.com/us/
    if (!arlCookie) {
      log('  -> ARL non immediato, navigo su https://www.deezer.com/us/ per aggiornare la sessione...');
      await page.goto('https://www.deezer.com/us/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await delay(3000);
      allCookies = await page.context().cookies();
      arlCookie = allCookies.find(c => c.name === 'arl' && c.value);
    }

    const deezerCookies = allCookies.filter(c => c.domain.includes('deezer.com'));
    log(`  -> Cookie deezer.com: ${deezerCookies.map(c => c.name).join(', ') || 'nessuno'}`);

    if (!arlCookie?.value) {
      const snippet = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '').catch(() => '');
      await page.screenshot({ path: 'debug_no_arl.png', fullPage: true }).catch(() => {});
      throw new Error(`ARL non trovato. URL: ${page.url()} | Testo: ${snippet.substring(0, 150)}`);
    }

    return { arl: arlCookie.value, email, password, username };
  } finally {
    page.off('response', onResponse);
  }
}

async function main() {
  const existing = loadExisting();
  const now = new Date();
  const cutoff = now.getTime() - KEEP_DAYS * 86400 * 1000;
  const valid = existing.filter(e => { const t = Date.parse(e.created || 0); return !isNaN(t) && t >= cutoff; });
  log(`ARL esistenti: ${existing.length}, validi dopo prune (<${KEEP_DAYS}g): ${valid.length}`);

  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,800',
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
