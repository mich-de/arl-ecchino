# Implementation Plan - Generatore Automatico ARL Deezer

## 1. Obiettivo & Architettura
Automatizzare la generazione e il rinnovo giornaliero di cookie ARL per account Deezer, eseguiti tramite GitHub Actions (`ubuntu-latest`), memorizzati in `arls.json` / `arl.txt` e notificati via bot Telegram.

## 2. Componenti Chiave

### **Playwright Automation (`generate.js`)** ✅

**Flusso di registrazione**:
1. **trySession()**: Evita Akamai bot challenge
   - Emulazione browser headless (Mobile Android 13, Chrome 116)
   - Spoofing `navigator.webdriver = false`
   - Timezone: America/New_York, Locale: en-US
   - Retry fino a 3 volte per Cloudflare
   
2. **createOne()**: Registrazione account Deezer
   - Navigazione a `https://www.deezer.com/us/register` (mirror `/us` obbligatorio)
   - Compilazione form React/Chakra UI:
     - **Step 1**: Email
     - **Step 2**: Password
     - **Step 3**: Username + Age (18) + Gender (Male)
   - Estrazione ARL dai cookie della sessione: `context.cookies()`
   - **Validazione**: `deezer.getUserData` sul mirror `/us`
   - Ritorno: `{ arl, email, password, username, created }`

3. **Gestione errori**:
   - Try-catch per ogni creazione account
   - Log dettagliato di ogni step
   - Delay tra i tentativi (backoff esponenziale)

### **GitHub Actions Workflow (`.github/workflows/arl.yml`)** ✅

- **Trigger**:
  - Schedule: `0 6 * * *` (06:00 UTC ogni giorno)
  - Dispatch manuale (Actions tab)
  
- **Job**:
  - Node 24 + Playwright Chromium
  - Esecuzione: `xvfb-run node generate.js` (virtual display per headful mode detection)
  - Salvataggio artefatti: screenshot debug (`debug_*.png`) in caso di errore
  - Commit automatico: `arls.json` + `arl.txt` se nuovi ARL generati
  
- **Env vars**:
  - `ARL_DAILY_COUNT`: numero ARL da generare (default 10)
  - `ARL_KEEP_DAYS`: giorni di storico da conservare (default 30)
  - `TG_BOT_TOKEN` / `TG_CHAT_ID`: notifiche Telegram
  - `PROXY_URL` (opzionale)

### **Notifica Telegram**

```
*D33Z3R - N nuovi ARL (YYYY-MM-DD)*

ARL email@example.com
`arl_token_completo`
Pass: `password123`

...
```

## 3. Flusso Tecnico Dettagliato

```
┌─────────────────────────────────────┐
│ GitHub Actions trigger (06:00 UTC)  │
└────────────┬────────────────────────┘
             │
             ▼
    ┌─────────────────┐
    │ trySession()    │
    │ Bypass Akamai   │
    │ (3 retry)       │
    └────────┬────────┘
             │
        ✅ OK?
             │
             ▼
    ┌──────────────────────┐
    │ Loop DAILY_COUNT (10)│
    └────────┬─────────────┘
             │
             ▼
    ┌────────────────────────┐
    │ createOne(page, ctx)   │
    ├────────────────────────┤
    │ POST form registrazione│
    │ (email, pass, user,    │
    │  age=18, gender=M)     │
    └────────┬───────────────┘
             │
             ▼
    ┌─────────────────────┐
    │ Estrai ARL          │
    │ (context.cookies()) │
    └────────┬────────────┘
             │
             ▼
    ┌──────────────────────┐
    │ Validazione ARL      │
    │ (getUserData /us/)   │
    └────────┬─────────────┘
             │
        ✅ Valido?
             │
             ├─► Sì: Salva in valid[], invia Telegram
             └─► No: Log errore, next retry
```

## 4. File Output

- **`arls.json`**: Array JSON di tutti gli ARL validi (ultimi 30 giorni)
  ```json
  [
    {
      "arl": "...",
      "email": "...",
      "password": "...",
      "username": "...",
      "created": "2026-10-23T06:00:00.000Z"
    },
    ...
  ]
  ```

- **`arl.txt`**: ARL più recente, leggibile
  ```
  email: user@example.com
  password: Dz1234567890!A1
  arl: <token completo>
  created: 2026-10-23T06:00:00.000Z
  ```

## 5. Validazione & Monitoraggio

- **Log stdout**: Ogni step tracciato (timestamp ISO 8601)
- **Screenshot debug**: `debug_*.png` su fallimento (artefatto GitHub)
- **Notifica Telegram**: Conferma N ARL generati
- **Commit message**: `ARL: YYYY-MM-DD — aggiornamento automatico`

## 6. Limitazioni Note

- **ARL free**: Accesso massimo MP3_128 (320 = Premium, FLAC = HiFi)
- **Validità ARL**: 7-30 giorni (soggetto a revoca Deezer)
- **Geolocalizzazione**: Mirror `/us` potrebbe richiedere VPN in alcuni paesi
- **Rate limit**: Deezer potrebbe temporaneamente bloccare generazione massiccia

## 7. Prossimi Step (opzionali)

- [ ] Aggiunta statistiche di successo/fallimento in arls.json
- [ ] Integrazione con archiviazione cloud (S3, GCS) per backup ARL
- [ ] Monitoraggio disponibilità ARL via health check periodico
- [ ] Proxy rotation se rate-limit di Deezer viene applicato
