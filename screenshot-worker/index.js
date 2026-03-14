const express = require('express');
const { getSabScreenshot } = require('./screenshotLogic');

const app = express();
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
