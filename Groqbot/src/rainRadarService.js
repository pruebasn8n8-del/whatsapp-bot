/**
 * rainRadarService.js
 * Genera imagen de radar de lluvia para Bogotá componiendo:
 *   - Tile base OpenStreetMap
 *   - Tile de radar RainViewer (gratuito, sin API key)
 * Sin Chromium. ~1-2s de latencia.
 */
const https = require('https');
const sharp = require('sharp');

// Tile de Bogotá (lat=4.71, lon=-74.07) a zoom 7
const ZOOM = 7;
const TILE_X = 37;
const TILE_Y = 62;

function _fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'WhatsAppBot/1.0' } },
      res => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} → ${url}`));
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    ).on('error', reject);
  });
}

async function _getLatestRadarTime() {
  const body = await new Promise((resolve, reject) => {
    https.get(
      'https://api.rainviewer.com/public/weather-maps.json',
      { headers: { 'User-Agent': 'WhatsAppBot/1.0' } },
      res => {
        let s = '';
        res.on('data', c => (s += c));
        res.on('end', () => resolve(s));
        res.on('error', reject);
      }
    ).on('error', reject);
  });
  const data = JSON.parse(body);
  const past = data.radar.past;
  return past[past.length - 1].time;
}

async function getRainRadarImage() {
  const radarTime = await _getLatestRadarTime();

  const baseUrl  = `https://tile.openstreetmap.org/${ZOOM}/${TILE_X}/${TILE_Y}.png`;
  const radarUrl = `https://tilecache.rainviewer.com/v2/radar/${radarTime}/256/${ZOOM}/${TILE_X}/${TILE_Y}/4/1_1.png`;

  const [baseBuf, radarBuf] = await Promise.all([
    _fetchBuffer(baseUrl),
    _fetchBuffer(radarUrl),
  ]);

  return sharp(baseBuf)
    .composite([{ input: radarBuf, blend: 'over' }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

module.exports = { getRainRadarImage };
