# Generatore Automatico ARL Deezer

Generatore automatico di cookie ARL per Deezer eseguito via GitHub Actions con notifica su Telegram.

## Come Funziona
1. Il workflow si avvia ogni giorno alle 06:00 UTC (o manualmente tramite `workflow_dispatch`).
2. Avvia un'istanza headless di Chromium gestita da Playwright con evasione fingerprint Akamai.
3. Compila in sequenza gli step del form di registrazione Deezer:
   - **Step 0**: Email generata casualmente
   - **Step 1**: Password sicura
   - **Step 2**: Username, Età (`18`), Identità di genere (`Male`)
4. Al termine della registrazione, estrae il cookie di sessione `arl` valido.
5. Invia i nuovi ARL al canale Telegram configurato.
6. Salva e committa lo storico in `arls.json` e l'ultimo ARL in `arl.txt`.

## How to Install & Configure
Configurare i seguenti GitHub Secrets nel repository:
- `TG_BOT_TOKEN`: Token del bot Telegram per le notifiche.
- `TG_CHAT_ID`: ID della chat Telegram ricevente.

## Esecuzione Manuale
Per lanciare manualmente la generazione da GitHub:
- Andare su **Actions** > **Genera ARL** > **Run workflow**.
