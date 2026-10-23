# Session & Architecture Memory Log

## Decisioni Architetturali Finali

### 1. Mirror Deezer `/us` (CRITICO)
**Problema**: Le chiamate POST verso `gw-light.php` su `www.deezer.com/ajax/` (EU) restituiscono **403 Forbidden** (Akamai WAF).

**Soluzione**: Usare il mirror `/us`:
```
❌ https://www.deezer.com/ajax/gw-light.php (EU, bloccato)
✅ https://www.deezer.com/us/ajax/gw-light.php (US, funzionante)
```

Questo è il **bug critico** che impediva la registrazione. Soluzione derivata da preezer DOCUMENTAZIONE.md § 1 e § 3.

### 2. Compilazione Form Reale (vs API diretta)
**Problema iniziale**: Il codice tentava registrazione tramite API dirette senza compilare il form vero:
```javascript
// ❌ SBAGLIATO: tentativa di POST API diretta
POST /us/ajax/gw-light.php?method=deezer.getUserData
POST /us/ajax/gw-light.php?method=user.create
// Deezer richiede il form compilato nel browser (session state, CSRF tokens, etc)
```

**Soluzione corretta**: Compilare il form React/Chakra UI di registrazione via Playwright:
1. Navigare a `https://www.deezer.com/us/register`
2. Compilare i campi email, password, username, age (18), gender (M)
3. Sottomettere il form tramite click
4. Estrarre ARL dal cookie `Set-Cookie` della risposta

### 3. Estrazione ARL dai Cookie
**Flusso corretto**:
```
POST form di registrazione via Playwright
    ↓
Deezer genera nuovo account
    ↓
Response headers contengono Set-Cookie: arl=<token>
    ↓
Estrai cookie 'arl' dal context via context.cookies()
```

### 4. Validazione ARL
**Implementato**: Dopo l'estrazione, validare l'ARL con:
```javascript
GET /us/ajax/gw-light.php?method=deezer.getUserData
// Se risposta è valida (error: [] array vuoto), ARL è OK
// Se errore o non responsive, ARL è stato revocato/invalido
```

### 5. Evasione Akamai
**Mantenuto**:
- User-Agent spoofing (Mobile Chrome)
- Disabilità `navigator.webdriver`
- Timezone e locale: America/New_York
- Browser fingerprint evasion flags

### 6. Gestione Errori
- Retry al massimo 3 volte per `trySession()`
- Log dettagliato di ogni step
- Screenshot di debug (artefatti GitHub Actions) in caso di fallimento
- Notifica Telegram solo per ARL validi

## Riferimenti Tecnici

- **Preezer DOCUMENTAZIONE.md** § 2-3: API gw-light, cookie management, user.create su mirror `/us`
- **Preezer CLAUDE.md**: Crypto BF_CBC_STRIPE, bug risolti (Akamai 403)
- **Velune-doped**: Reverse-engineering Deezer API

## Status Finale

✅ Mirror `/us` corretto  
✅ Compilazione form reale (Playwright)  
✅ Estrazione ARL dai cookie  
✅ Validazione ARL  
✅ Notifica Telegram  
✅ Commit automatico arls.json  

**Ready for production**.
