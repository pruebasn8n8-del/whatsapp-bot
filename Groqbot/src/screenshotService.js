const puppeteer = require('puppeteer-core');

const SAB_URL = 'https://app.sab.gov.co/sab/lluvias.htm';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
];

// Recursos que no aportan al mapa — bloquearlos acelera la carga
const BLOCKED_TYPES = new Set(['font', 'media', 'other']);
const BLOCKED_PATTERNS = [/google-analytics/, /googletagmanager/, /facebook/, /doubleclick/];

// Browser persistente
let _browser = null;

async function _getBrowser() {
  if (_browser) {
    try { await _browser.version(); return _browser; } catch (_) { _browser = null; }
  }
  _browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    args: LAUNCH_ARGS,
    headless: true,
  });
  _browser.on('disconnected', () => { _browser = null; });
  return _browser;
}

// Cache simple en memoria
let _cache = null; // { buffer, ts }

async function takeScreenshot(url = SAB_URL) {
  // Devolver cache si es reciente
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    console.log('[Screenshot] Cache hit');
    return _cache.buffer;
  }

  const browser = await _getBrowser();
  const page = await browser.newPage();
  try {
    // Bloquear recursos innecesarios
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (BLOCKED_TYPES.has(req.resourceType()) || BLOCKED_PATTERNS.some(p => p.test(req.url()))) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000)); // esperar render del mapa
    const buffer = await page.screenshot({ type: 'jpeg', quality: 85 });

    _cache = { buffer, ts: Date.now() };
    return buffer;
  } finally {
    await page.close();
  }
}

// Precalentar browser + primera captura al iniciar
_getBrowser()
  .then(() => takeScreenshot())
  .then(() => console.log('[Screenshot] Cache inicial listo'))
  .catch(e => console.log('[Screenshot] Precalentamiento falló:', e.message));

// Refrescar cache cada 5 minutos en background
setInterval(() => {
  takeScreenshot().catch(e => console.log('[Screenshot] Refresh falló:', e.message));
}, CACHE_TTL_MS);

module.exports = { takeScreenshot, SAB_URL };
