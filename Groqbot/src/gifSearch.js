// Groqbot/src/gifSearch.js
// Búsqueda de GIFs con GIPHY (primario) + Tenor (fallback, sin API key).
// Usa variantes MP4 medianas para evitar rechazos de WhatsApp por tamaño.

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
// Clave pública de desarrollo de Tenor (documentada por Google/Tenor para uso en desarrollo)
const TENOR_KEY = 'LIVDSRZULELA';
const MAX_GIF_BYTES = 14 * 1024 * 1024; // 14 MB — límite seguro para WhatsApp

/**
 * Busca un GIF y retorna su URL de MP4.
 * Primero intenta GIPHY (si hay API key), luego Tenor como fallback.
 * @param {string} query - Término de búsqueda
 * @returns {{ url: string, source: string } | null}
 */
async function searchGif(query) {
  if (!query || typeof query !== 'string') return null;

  // Intento 1: GIPHY
  if (GIPHY_API_KEY) {
    try {
      const result = await _searchGiphy(query);
      if (result) return result;
    } catch (e) {
      console.warn('[GIF] GIPHY falló:', e.message, '→ intentando Tenor...');
    }
  }

  // Intento 2: Tenor (siempre disponible, key pública de desarrollo)
  try {
    const result = await _searchTenor(query);
    if (result) return result;
  } catch (e) {
    console.warn('[GIF] Tenor también falló:', e.message);
  }

  return null;
}

/**
 * Busca en GIPHY usando variantes MP4 de tamaño reducido.
 * Prioriza fixed_height y downsized_medium sobre original para evitar
 * archivos >15MB que WhatsApp rechaza.
 */
async function _searchGiphy(query) {
  const url =
    `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}` +
    `&q=${encodeURIComponent(query)}&limit=25&rating=g&lang=es`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GIPHY ${res.status}`);
  const data = await res.json();
  if (!data.data || data.data.length === 0) return null;

  // Barajar y probar los primeros 8
  const pool = [...data.data].sort(() => Math.random() - 0.5).slice(0, 8);
  for (const gif of pool) {
    const imgs = gif.images || {};
    // Orden de preferencia: tamaño mediano → pequeño → preview (evitar original)
    const mp4 =
      imgs.fixed_height?.mp4 ||
      imgs.downsized_medium?.mp4 ||
      imgs.fixed_height_small?.mp4 ||
      imgs.preview?.mp4;
    if (mp4) return { url: mp4, source: 'giphy' };
  }
  return null;
}

/**
 * Busca en Tenor usando la clave pública de desarrollo.
 * No requiere clave propia — funciona para uso no comercial / dev.
 * Toma los 3 primeros resultados (más relevantes según el API) sin mezclar.
 * locale=es_ES mejora la relevancia para búsquedas en español.
 */
async function _searchTenor(query) {
  const url =
    `https://api.tenor.com/v1/search?q=${encodeURIComponent(query)}` +
    `&key=${TENOR_KEY}&limit=10&contentfilter=medium&media_filter=minimal&locale=es_ES`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Tenor ${res.status}`);
  const data = await res.json();
  if (!data.results || data.results.length === 0) return null;

  // Sin mezclar: los primeros resultados son los más relevantes para el término buscado
  const pool = data.results.slice(0, 3);
  for (const result of pool) {
    const media = result.media?.[0] || {};
    const mp4 = media.mp4?.url || media.nanomp4?.url || media.tinymp4?.url;
    if (mp4) return { url: mp4, source: 'tenor' };
  }
  return null;
}

module.exports = { searchGif, MAX_GIF_BYTES };
