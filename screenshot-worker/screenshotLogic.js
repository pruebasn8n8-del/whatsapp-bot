const puppeteer = require('puppeteer-core');

const SAB_URL = 'https://app.sab.gov.co/sab/lluvias.htm';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
];

const BLOCKED_TYPES = new Set(['font', 'media', 'other']);
const BLOCKED_PATTERNS = [/google-analytics/, /googletagmanager/, /facebook/, /doubleclick/];

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

let _cache = null;

async function getSabScreenshot() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    console.log('[Screenshot] Cache hit');
    return _cache.buffer;
  }

  const browser = await _getBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (BLOCKED_TYPES.has(req.resourceType()) || BLOCKED_PATTERNS.some(p => p.test(req.url()))) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(SAB_URL, { waitUntil: 'networkidle0', timeout: 45000 });
    const buffer = await page.screenshot({ type: 'jpeg', quality: 85 });

    _cache = { buffer, ts: Date.now() };
    return buffer;
  } finally {
    await page.close();
  }
}

_getBrowser()
  .then(() => getSabScreenshot())
  .then(() => console.log('[Screenshot] Cache inicial listo'))
  .catch(e => console.log('[Screenshot] Precalentamiento falló:', e.message));

setInterval(() => {
  getSabScreenshot().catch(e => console.log('[Screenshot] Refresh falló:', e.message));
}, CACHE_TTL_MS);

// options: { url, width=1280, height=800, fullPage=false, selector=null }
async function genericScreenshot({ url, width = 1280, height = 800, fullPage = false, selector = null } = {}) {
  if (!url) throw new Error('url requerida');
  const browser = await _getBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (BLOCKED_TYPES.has(req.resourceType()) || BLOCKED_PATTERNS.some(p => p.test(req.url()))) {
        req.abort();
      } else {
        req.continue();
      }
    });
    await page.setViewport({ width, height });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Espera que JS (TradingView, Chart.js, etc.) termine de renderizar
    await new Promise(r => setTimeout(r, 5000));
    if (selector) {
      await page.waitForSelector(selector, { timeout: 10000 });
      const el = await page.$(selector);
      if (!el) throw new Error(`Selector "${selector}" no encontrado`);
      return await el.screenshot({ type: 'jpeg', quality: 85 });
    }
    return await page.screenshot({ type: 'jpeg', quality: 85, fullPage });
  } finally {
    await page.close();
  }
}

// options: { url, selector='body', waitFor=0 }
async function scrapePage({ url, selector = 'body', waitFor = 0 } = {}) {
  if (!url) throw new Error('url requerida');
  const browser = await _getBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (BLOCKED_TYPES.has(req.resourceType()) || BLOCKED_PATTERNS.some(p => p.test(req.url()))) {
        req.abort();
      } else {
        req.continue();
      }
    });
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    if (waitFor > 0) await new Promise(r => setTimeout(r, Math.min(waitFor, 10000)));
    await page.waitForSelector(selector, { timeout: 10000 });
    const result = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { text: '', html: '' };
      return { text: el.innerText || el.textContent || '', html: el.innerHTML };
    }, selector);
    return result;
  } finally {
    await page.close();
  }
}

// html: string con HTML completo a convertir a PDF
async function generatePdf(html) {
  if (!html) throw new Error('html requerido');
  const browser = await _getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return pdf;
  } finally {
    await page.close();
  }
}

module.exports = { getSabScreenshot, genericScreenshot, scrapePage, generatePdf };
