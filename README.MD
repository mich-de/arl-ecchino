# Generatore Automatico ARL Deezer

Generatore automatico di cookie ARL per Deezer eseguito via GitHub Actions con notifica su Telegram.

## Come Funziona

1. Il workflow si avvia ogni giorno alle 06:00 UTC (o manualmente tramite `workflow_dispatch`).
2. Avvia un'istanza headless di Chromium gestita da Playwright con evasione fingerprint Akamai.
3. Compila in sequenza il **form vero di registrazione Deezer**:
   - **Step 1**: Email generata casualmente
   - **Step 2**: Password sicura
   - **Step 3**: Username, Età (`18`), Identità di genere (`Male`)
4. Al termine della registrazione, estrae il cookie di sessione `arl` dal cookie header `Set-Cookie`.
5. **Valida l'ARL** con `deezer.getUserData` sul mirror `/us`.
6. Invia i nuovi ARL al canale Telegram configurato.
7. Salva e committa lo storico in `arls.json` e l'ultimo ARL in `arl.txt`.

## Architettura Tecnica

- **Base URL**: `https://www.deezer.com/us/ajax/gw-light.php` (mirror `/us` obbligatorio — root EU bloccato da Akamai WAF)
- **Form di registrazione**: Compilazione visuale via Playwright (React/Chakra UI)
- **Estrazione cookie**: Da `Set-Cookie` della risposta POST di registrazione
- **Validazione**: `deezer.getUserData` verifica che l'ARL sia valido e non revocato
- **Notifica**: Bot Telegram invia i nuovi ARL con email/password/username associati

## How to Install & Configure

Configurare i seguenti GitHub Secrets nel repository:
- `TG_BOT_TOKEN`: Token del bot Telegram per le notifiche.
- `TG_CHAT_ID`: ID della chat Telegram ricevente.
- `PROXY_URL` (opzionale): URL del proxy (es. `http://proxy.example.com:8080`)

## Esecuzione Manuale

Per lanciare manualmente la generazione da GitHub:
- Andare su **Actions** > **Genera ARL** > **Run workflow**.

## Limitazioni Note

- **ARL free**: Accesso massimo a **MP3_128** (320 kbps = Premium, FLAC = HiFi)
- **Brani non disponibili**: Errore 2002 → fallback anteprima 30 secondi
- **Validità**: Gli ARL rimangono validi solitamente **7-30 giorni** (soggetto a revoca Deezer)

## Riferimenti

- Implementazione di streaming: `mich-de/preezer` (app Android, decrittazione BF_CBC_STRIPE)
- Documentazione API Deezer: `preezer/DOCUMENTAZIONE.md`
- Reverse-engineering: `mich-de/Velune-doped`, `Lunatic16/deezload`
