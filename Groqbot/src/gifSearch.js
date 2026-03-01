// Groqbot/src/gifSearch.js
// Búsqueda de GIFs con GIPHY. Requiere GIPHY_API_KEY en variables de entorno.
// Usa variantes MP4 medianas para evitar rechazos de WhatsApp por tamaño.

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const MAX_GIF_BYTES = 14 * 1024 * 1024; // 14 MB — límite seguro para WhatsApp

/**
 * Busca un GIF y retorna su URL de MP4 vía GIPHY.
 * @param {string} query - Término de búsqueda
 * @returns {{ url: string, source: string } | null}
 */
async function searchGif(query) {
  if (!query || typeof query !== 'string') return null;

  if (!GIPHY_API_KEY) {
    console.warn('[GIF] GIPHY_API_KEY no configurada');
    return null;
  }

  try {
    return await _searchGiphy(query);
  } catch (e) {
    console.error('[GIF] GIPHY falló:', e.message);
    return null;
  }
}

/**
 * Busca en GIPHY usando variantes MP4 de tamaño reducido.
 * Prioriza fixed_height y downsized_medium sobre original para evitar
 * archivos >15MB que WhatsApp rechaza.
 */
async function _searchGiphy(query) {
  const url =
    `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}` +
    `&q=${encodeURIComponent(query)}&limit=10&rating=g`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GIPHY ${res.status}`);
  const data = await res.json();
  if (!data.data || data.data.length === 0) return null;

  // Sin barajar: los primeros resultados son los más relevantes
  const pool = data.data.slice(0, 3);
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

module.exports = { searchGif, MAX_GIF_BYTES };
