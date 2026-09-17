# Implementation Plan - Generatore Automatico ARL Deezer

## 1. Obiettivo & Architettura
Automatizzare la generazione e il rinnovo giornaliero di cookie ARL per account Deezer, eseguiti tramite GitHub Actions (`ubuntu-latest`), memorizzati in `arls.json` / `arl.txt` e notificati via bot Telegram.

## 2. Componenti Chiave
- **Playwright Automation (`generate.js`)**:
  - Emulazione browser headless con evasione filtri Akamai (spoofing `platform`, `plugins`, `languages`, `webdriver`).
  - Gestione multi-step del form di registrazione React/Chakra UI:
    - Step 0: Inserimento email e continue.
    - Step 1: Inserimento password e continue.
    - Step 2: Inserimento Username, Age (18 con keystroke emulation su `role=spinbutton`), Identity (`M` = Male).
    - Gestione modale cookie GDPR ("A note about our cookies").
    - Intercettazione chiamate di rete API (`gw-light.php`, `ajax`, `signup`) per diagnostica real-time.
  - Estrazione cookie `arl` dal context storage (.deezer.com).
- **GitHub Actions Workflow (`.github/workflows/arl.yml`)**:
  - Esecuzione schedulata giornaliera (06:00 UTC) e dispatch manuale.
  - Salvataggio artefatti di debug (screenshot in caso di fallimento).
  - Commit e push automatici sul repository.

## 3. Strategia di Verifica
- Test continuo tramite trigger del workflow su GitHub Actions (`gh workflow run arl.yml`).
- Ispezione log di output Playwright e monitoraggio codici di risposta di rete.
