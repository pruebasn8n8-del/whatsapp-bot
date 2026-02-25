// Groqbot/src/gifSearch.js - Busqueda de GIFs con GIPHY API

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;

/**
 * Busca un GIF en GIPHY y retorna la URL del MP4 (para enviar como video con gifPlayback).
 * @param {string} query - Termino de busqueda
 * @returns {string|null} URL del MP4 o null si no encuentra
 */
async function searchGif(query) {
  if (!GIPHY_API_KEY) {
    throw new Error('GIPHY_API_KEY no configurada en .env');
  }

  const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=25&rating=pg-13&lang=es`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GIPHY API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.data || data.data.length === 0) {
    return null;
  }

  // Seleccionar uno aleatorio de los resultados
  const randomIndex = Math.floor(Math.random() * data.data.length);
  const gif = data.data[randomIndex];

  // Retornar URL del MP4 (mejor para enviar como video con gifPlayback)
  const mp4Url = gif.images?.original?.mp4
    || gif.images?.fixed_height?.mp4
    || gif.images?.downsized?.url;

  return mp4Url || null;
}

module.exports = { searchGif };
