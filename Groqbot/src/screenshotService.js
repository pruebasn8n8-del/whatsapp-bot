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

module.exports = { takeScreenshot, getSabScreenshot };
