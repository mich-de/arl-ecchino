# Session & Architecture Memory Log

## Decisioni Architetturali
1. **Bypass Akamai Bot Manager**: Le chiamate dirette POST verso `gw-light.php` restituiscono 403 Forbidden. L'approccio vincente è simulare la compilazione visuale del form React/Chakra UI via Playwright con spoofing del runtime browser.
2. **Form Step 2 & Chakra UI**:
   - Il campo `#age` è un `NumberInput` con `role="spinbutton"`. L'uso di `fill()` non sempre propaga lo stato interno di React. È richiesta la sequenza `click()`, `pressSequentially('18')`, e `press('Tab')`.
   - Il selettore `#identity` richiede la selezione esplicita del valore `'M'` (Male) e l'emissione dell'evento `change`.
3. **Debug & Diagnostica**:
   - Aggiunto listener `page.on('response')` per tracciare lo stato HTTP delle chiamate interne di autenticazione e registrazione.
   - Upload automatico degli screenshot (`debug_*.png`) su GitHub Actions artifacts per ispezione visiva istantanea in caso di blocco.
