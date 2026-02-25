// DailyBriefing/src/weatherService.js - Servicio de clima (Open-Meteo)
// API 100% gratis, sin API key, sin limites para uso no comercial
// https://open-meteo.com/

// Coordenadas por defecto: Bogota, Colombia
const DEFAULT_LAT = 4.6097;
const DEFAULT_LON = -74.0817;
const DEFAULT_CITY = 'Bogota';

/**
 * Obtiene el clima actual y pronostico del dia usando Open-Meteo.
 * No requiere API key ni registro.
 * @param {object} opts
 * @param {number} opts.lat - Latitud (default: Bogota)
 * @param {number} opts.lon - Longitud (default: Bogota)
 * @param {string} opts.city - Nombre de la ciudad para mostrar
 * @returns {{ temp, feels_like, description, temp_max, temp_min, humidity, rain_chance, icon, city }}
 */
async function getWeather(opts = {}) {
  const { lat = DEFAULT_LAT, lon = DEFAULT_LON, city = DEFAULT_CITY } = opts;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&timezone=${encodeURIComponent(process.env.TIMEZONE || 'America/Bogota')}` +
      `&forecast_days=1`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('Open-Meteo API error: ' + res.status);
    const data = await res.json();

    const current = data.current;
    const daily = data.daily;

    return {
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      description: _weatherCodeToDescription(current.weather_code),
      temp_max: Math.round(daily.temperature_2m_max[0]),
      temp_min: Math.round(daily.temperature_2m_min[0]),
      humidity: current.relative_humidity_2m,
      rain_chance: daily.precipitation_probability_max[0] || 0,
      icon: _weatherCodeToEmoji(current.weather_code, current.is_day),
      city,
    };
  } catch (err) {
    console.error('[Weather] Error:', err.message);
    return null;
  }
}

// WMO Weather interpretation codes -> descripcion en español
function _weatherCodeToDescription(code) {
  const descriptions = {
    0: 'despejado',
    1: 'mayormente despejado',
    2: 'parcialmente nublado',
    3: 'nublado',
    45: 'niebla',
    48: 'niebla con escarcha',
    51: 'llovizna ligera',
    53: 'llovizna moderada',
    55: 'llovizna intensa',
    61: 'lluvia ligera',
    63: 'lluvia moderada',
    65: 'lluvia intensa',
    71: 'nevada ligera',
    73: 'nevada moderada',
    75: 'nevada intensa',
    80: 'chubascos ligeros',
    81: 'chubascos moderados',
    82: 'chubascos intensos',
    85: 'chubascos de nieve ligeros',
    86: 'chubascos de nieve intensos',
    95: 'tormenta electrica',
    96: 'tormenta con granizo ligero',
    99: 'tormenta con granizo intenso',
  };
  return descriptions[code] || 'desconocido';
}

// WMO Weather codes -> emoji
function _weatherCodeToEmoji(code, isDay) {
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code <= 2) return isDay ? '⛅' : '☁️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 55) return '🌦️';
  if (code <= 65) return '🌧️';
  if (code <= 75) return '❄️';
  if (code <= 82) return '🌧️';
  if (code >= 95) return '⛈️';
  return '🌤️';
}

/**
 * Formatea el clima para el briefing.
 */
function formatWeather(weather) {
  if (!weather) return null;

  let rainLine = '';
  if (weather.rain_chance > 50) {
    rainLine = `\nLluvia: *${weather.rain_chance}%* (lleva paraguas ☂️)`;
  } else if (weather.rain_chance > 20) {
    rainLine = `\nLluvia: ${weather.rain_chance}% (por si acaso)`;
  }

  return [
    `${weather.icon} *Clima ${weather.city}*`,
    `Ahora: *${weather.temp}°C*, ${weather.description}`,
    `Max: ${weather.temp_max}°C | Min: ${weather.temp_min}°C`,
    rainLine,
  ].filter(Boolean).join('\n');
}

module.exports = { getWeather, formatWeather };
