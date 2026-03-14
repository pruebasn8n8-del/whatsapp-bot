const puppeteer = require('puppeteer-core');

const SAB_URL = 'https://app.sab.gov.co/sab/lluvias.htm';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
];

// Instancia persistente — se lanza una vez y se reutiliza
let _browser = null;

async function _getBrowser() {
  if (_browser) {
    try {
      // Verificar que sigue vivo
      await _browser.version();
      return _browser;
    } catch (_) {
      _browser = null;
    }
  }
  _browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    args: LAUNCH_ARGS,
    headless: true,
  });
  _browser.on('disconnected', () => { _browser = null; });
  return _browser;
}

async function takeScreenshot(url = SAB_URL) {
  const browser = await _getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000)); // esperar render tiles JS
    const buffer = await page.screenshot({ type: 'jpeg', quality: 85 });
    return buffer;
  } finally {
    await page.close();
  }
}

// Precalentar el browser al iniciar el módulo
_getBrowser().catch(() => {});

module.exports = { takeScreenshot, SAB_URL };
