// Groqbot/src/gifSearch.js
// Búsqueda de GIFs con GIPHY. Requiere GIPHY_API_KEY en variables de entorno.
// Usa variantes MP4 medianas para evitar rechazos de WhatsApp por tamaño.

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const MAX_GIF_BYTES = 14 * 1024 * 1024; // 14 MB — límite seguro para WhatsApp

/**
 * Busca un GIF y retorna su URL de MP4 vía GIPHY.
 * @param {string} query - Término de búsqueda
 * @param {number} index - Posición deseada (0-4 → secuencial, 5+ → aleatorio)
 * @returns {{ url: string, source: string } | null}
 */
async function searchGif(query, index = 0) {
  if (!query || typeof query !== 'string') return null;

  if (!GIPHY_API_KEY) {
    console.warn('[GIF] GIPHY_API_KEY no configurada');
    return null;
  }

  try {
    return await _searchGiphy(query, index);
  } catch (e) {
    console.error('[GIF] GIPHY falló:', e.message);
    return null;
  }
}

/** Extrae la URL mp4 más ligera disponible de un resultado de GIPHY. */
function _getMp4(gif) {
  const imgs = gif.images || {};
  return imgs.fixed_height?.mp4 ||
    imgs.downsized_medium?.mp4 ||
    imgs.fixed_height_small?.mp4 ||
    imgs.preview?.mp4 ||
    null;
}

/**
 * Busca en GIPHY con rotación de resultados.
 * index 0-4 → devuelve el resultado en esa posición (el más relevante primero).
 * index 5+  → aleatorio entre los 5 disponibles.
 */
async function _searchGiphy(query, index) {
  const url =
    `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}` +
    `&q=${encodeURIComponent(query)}&limit=5&rating=g`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GIPHY ${res.status}`);
  const data = await res.json();
  if (!data.data || data.data.length === 0) return null;

  const results = data.data;

  if (index < 5) {
    // Secuencial: desde el índice pedido, avanza si no tiene mp4
    for (let i = index; i < results.length; i++) {
      const mp4 = _getMp4(results[i]);
      if (mp4) return { url: mp4, source: 'giphy' };
    }
  }

  // Modo aleatorio: elegir aleatoriamente entre los disponibles
  const pool = results.map(_getMp4).filter(Boolean);
  if (pool.length === 0) return null;
  return { url: pool[Math.floor(Math.random() * pool.length)], source: 'giphy' };
}

module.exports = { searchGif, MAX_GIF_BYTES };
