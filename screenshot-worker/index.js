const express = require('express');
const { getSabScreenshot, genericScreenshot, scrapePage } = require('./screenshotLogic');

const app = express();
app.use(express.json());
const WORKER_SECRET = process.env.WORKER_SECRET;

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (!WORKER_SECRET || req.headers['x-worker-key'] !== WORKER_SECRET) {
    return res.status(401).end();
  }
  next();
});

app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get('/screenshot/sab', async (req, res) => {
  try {
    const buf = await getSabScreenshot();
    if (!buf) return res.status(503).end();
    res.set('Content-Type', 'image/jpeg').send(buf);
  } catch (err) {
    console.error('[Worker] Error en /screenshot/sab:', err.message);
    res.status(503).end();
  }
});

app.post('/screenshot', async (req, res) => {
  const { url, width, height, fullPage, selector } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url requerida' });
  try {
    const buf = await genericScreenshot({ url, width, height, fullPage, selector });
    res.set('Content-Type', 'image/jpeg').send(buf);
  } catch (err) {
    console.error('[Worker] Error en /screenshot:', err.message);
    res.status(503).json({ error: err.message });
  }
});

app.post('/scrape', async (req, res) => {
  const { url, selector, waitFor } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url requerida' });
  try {
    const result = await scrapePage({ url, selector, waitFor });
    res.json(result);
  } catch (err) {
    console.error('[Worker] Error en /scrape:', err.message);
    res.status(503).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Screenshot worker en puerto ${PORT}`));

if (process.env.APP_URL) {
  const https = require('https');
  const keepAliveUrl = process.env.APP_URL.replace(/\/$/, '') + '/health';
  setInterval(() => {
    https.get(keepAliveUrl, () => {}).on('error', () => {});
  }, 4 * 60 * 1000);
  console.log('[KeepAlive] Pinging', keepAliveUrl, 'cada 4 minutos');
}
