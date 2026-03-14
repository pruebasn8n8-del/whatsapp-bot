// screenshotService.js — cliente HTTP del screenshot-worker (sin Puppeteer/Chromium local)
const https = require('https');
const http = require('http');

const WORKER_URL = process.env.SCREENSHOT_WORKER_URL;
const WORKER_SECRET = process.env.WORKER_SECRET;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

let _cache = null; // { buffer, ts }

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const options = {
      timeout: 30000,
      headers: WORKER_SECRET ? { 'x-worker-key': WORKER_SECRET } : {},
    };
    const req = mod.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Worker respondió ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout conectando al worker')); });
  });
}

async function getSabScreenshot() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    console.log('[Screenshot] Cache hit');
    return _cache.buffer;
  }

  if (!WORKER_URL) {
    console.error('[Screenshot] SCREENSHOT_WORKER_URL no configurado');
    return null;
  }

  try {
    const buffer = await fetchBuffer(WORKER_URL.replace(/\/$/, '') + '/screenshot/sab');
    _cache = { buffer, ts: Date.now() };
    console.log('[Screenshot] Captura recibida del worker');
    return buffer;
  } catch (err) {
    console.error('[Screenshot] Error al contactar worker:', err.message);
    return _cache ? _cache.buffer : null;
  }
}

// Compatibilidad con el caller que usa takeScreenshot
const takeScreenshot = getSabScreenshot;

// Refrescar cache cada 5 minutos en background
setInterval(() => {
  getSabScreenshot().catch(e => console.log('[Screenshot] Refresh falló:', e.message));
}, CACHE_TTL_MS);

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    if (!WORKER_URL) return reject(new Error('SCREENSHOT_WORKER_URL no configurado'));
    const base = WORKER_URL.replace(/\/$/, '');
    const fullUrl = base + path;
    const mod = fullUrl.startsWith('https') ? https : http;
    const payload = JSON.stringify(body);
    const urlObj = new URL(fullUrl);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (fullUrl.startsWith('https') ? 443 : 80),
      path: urlObj.pathname + (urlObj.search || ''),
      method: 'POST',
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(WORKER_SECRET ? { 'x-worker-key': WORKER_SECRET } : {}),
      },
    };
    const req = mod.request(options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Worker respondió ${res.statusCode} en ${path}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const contentType = res.headers['content-type'] || '';
        const buf = Buffer.concat(chunks);
        if (contentType.includes('application/json')) {
          try { resolve(JSON.parse(buf.toString())); } catch (e) { reject(e); }
        } else {
          resolve(buf);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout en ${path}`)); });
    req.write(payload);
    req.end();
  });
}

async function screenshot({ url, width = 1280, height = 800, fullPage = false, selector } = {}) {
  if (!WORKER_URL) {
    console.error('[Screenshot] SCREENSHOT_WORKER_URL no configurado');
    return null;
  }
  try {
    const buf = await postJson('/screenshot', { url, width, height, fullPage, selector });
    console.log('[Screenshot] Captura genérica del worker para:', url);
    return buf;
  } catch (err) {
    console.error('[Screenshot] Error en screenshot genérico:', err.message);
    return null;
  }
}

async function scrape({ url, selector = 'body', waitFor = 0 } = {}) {
  if (!WORKER_URL) {
    console.error('[Screenshot] SCREENSHOT_WORKER_URL no configurado');
    return null;
  }
  try {
    const result = await postJson('/scrape', { url, selector, waitFor });
    console.log('[Screenshot] Scrape del worker para:', url);
    return result;
  } catch (err) {
    console.error('[Screenshot] Scrape falló:', err.message);
    return null;
  }
}

module.exports = { takeScreenshot, getSabScreenshot, screenshot, scrape };
