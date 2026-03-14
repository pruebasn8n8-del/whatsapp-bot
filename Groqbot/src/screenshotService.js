const puppeteer = require('puppeteer-core');

const SAB_URL = 'https://app.sab.gov.co/sab/lluvias.htm';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

async function takeScreenshot(url = SAB_URL) {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await new Promise(r => setTimeout(r, 5000)); // esperar render del mapa (tiles JS)
    const buffer = await page.screenshot({ type: 'jpeg', quality: 85 });
    return buffer;
  } finally {
    await browser.close();
  }
}

module.exports = { takeScreenshot, SAB_URL };
