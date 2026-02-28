// Groqbot/src/freeApiTools.js
// APIs 100% gratuitas, sin API key requerida.
// Usadas como tools de Groq para responder automáticamente en conversación.

const API_TIMEOUT_MS = 9000;

// ============================================================
// WMO Weather codes (compartidos con weatherService.js)
// ============================================================
const WMO_DESC = {
  0: 'despejado', 1: 'mayormente despejado', 2: 'parcialmente nublado', 3: 'nublado',
  45: 'niebla', 48: 'niebla con escarcha',
  51: 'llovizna ligera', 53: 'llovizna moderada', 55: 'llovizna intensa',
  61: 'lluvia ligera', 63: 'lluvia moderada', 65: 'lluvia intensa',
  71: 'nevada ligera', 73: 'nevada moderada', 75: 'nevada intensa',
  80: 'chubascos ligeros', 81: 'chubascos moderados', 82: 'chubascos intensos',
  95: 'tormenta eléctrica', 96: 'tormenta con granizo', 99: 'tormenta intensa',
};
const WMO_EMOJI = (code, isDay) => {
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
};

// ============================================================
// CLIMA — Open-Meteo Geocoding + Weather (sin key)
// https://open-meteo.com/
// ============================================================
async function getWeatherForCity(cityName) {
  if (!cityName || typeof cityName !== 'string') throw new Error('Nombre de ciudad requerido');

  // 1. Geocodificar ciudad → coordenadas
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=es&format=json`;
  const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!geoRes.ok) throw new Error('Error buscando ciudad: ' + geoRes.status);
  const geoData = await geoRes.json();

  if (!geoData.results || geoData.results.length === 0) {
    throw new Error(`Ciudad "${cityName}" no encontrada`);
  }

  const { latitude, longitude, name, country, timezone, admin1 } = geoData.results[0];

  // 2. Obtener clima actual + pronóstico 3 días
  const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,precipitation` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,uv_index_max` +
    `&timezone=${encodeURIComponent(timezone || 'auto')}&forecast_days=4`;

  const wRes = await fetch(wUrl, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!wRes.ok) throw new Error('Error obteniendo clima: ' + wRes.status);
  const wData = await wRes.json();

  const c = wData.current;
  const d = wData.daily;

  const forecast = (d.time || []).slice(0, 4).map((date, i) => ({
    date,
    maxC: Math.round(d.temperature_2m_max[i]),
    minC: Math.round(d.temperature_2m_min[i]),
    rain: d.precipitation_probability_max[i] || 0,
    code: d.weather_code[i],
    uvMax: d.uv_index_max ? Math.round(d.uv_index_max[i]) : null,
  }));

  return {
    city: name,
    region: admin1 || null,
    country: country || null,
    timezone: timezone || null,
    current: {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      windKmph: Math.round(c.wind_speed_10m),
      precipitation: c.precipitation || 0,
      code: c.weather_code,
      description: WMO_DESC[c.weather_code] || 'condiciones variables',
      emoji: WMO_EMOJI(c.weather_code, c.is_day),
      isDay: c.is_day,
    },
    forecast,
  };
}

function formatWeatherResponse(data) {
  const { city, region, country, current: c, forecast } = data;
  const location = [city, region, country].filter(Boolean).join(', ');

  const lines = [
    `${c.emoji} *Clima en ${location}*`,
    `Ahora: *${c.temp}°C* — ${c.description}`,
    `Sensación térmica: ${c.feelsLike}°C  |  Humedad: ${c.humidity}%`,
    `Viento: ${c.windKmph} km/h`,
  ];

  if (c.precipitation > 0) {
    lines.push(`Precipitación actual: ${c.precipitation} mm`);
  }

  if (forecast.length > 0) {
    lines.push('', '*Pronóstico:*');
    for (const day of forecast) {
      const isToday = day.date === new Date().toISOString().slice(0, 10);
      const label = isToday ? 'Hoy' : new Date(day.date + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
      const em = WMO_EMOJI(day.code, true);
      const rain = day.rain > 30 ? ` ☂️ ${day.rain}%` : day.rain > 0 ? ` (${day.rain}% lluvia)` : '';
      const uv = day.uvMax !== null && day.uvMax > 6 ? ` ☀️UV ${day.uvMax}` : '';
      lines.push(`  ${em} *${label}:* ${day.maxC}° / ${day.minC}°${rain}${uv}`);
    }
  }

  lines.push('', `_Fuente: Open-Meteo (sin API key)_`);
  return lines.join('\n');
}

// ============================================================
// TASAS DE CAMBIO — frankfurter.app (BCE, sin key)
// https://frankfurter.app/
// Nota: No incluye COP. Para COP usar getTRM() de priceService.
// ============================================================
const FRANKFURTER_CURRENCIES = new Set([
  'AUD','BGN','BRL','CAD','CHF','CNY','CZK','DKK','EUR','GBP',
  'HKD','HUF','IDR','ILS','INR','ISK','JPY','KRW','MXN','MYR',
  'NOK','NZD','PHP','PLN','RON','SEK','SGD','THB','TRY','USD','ZAR',
]);

const CURRENCY_NAMES = {
  AUD: 'Dólar australiano', BGN: 'Lev búlgaro', BRL: 'Real brasileño',
  CAD: 'Dólar canadiense', CHF: 'Franco suizo', CNY: 'Yuan chino',
  CZK: 'Corona checa', DKK: 'Corona danesa', EUR: 'Euro',
  GBP: 'Libra esterlina', HKD: 'Dólar HK', HUF: 'Forinto húngaro',
  IDR: 'Rupia indonesia', ILS: 'Shekel israelí', INR: 'Rupia india',
  ISK: 'Corona islandesa', JPY: 'Yen japonés', KRW: 'Won coreano',
  MXN: 'Peso mexicano', MYR: 'Ringgit malayo', NOK: 'Corona noruega',
  NZD: 'Dólar neozelandés', PHP: 'Peso filipino', PLN: 'Zloty polaco',
  RON: 'Leu rumano', SEK: 'Corona sueca', SGD: 'Dólar singapurense',
  THB: 'Baht tailandés', TRY: 'Lira turca', USD: 'Dólar estadounidense',
  ZAR: 'Rand sudafricano',
};

async function getExchangeRates(from = 'USD', toList = ['EUR', 'GBP', 'JPY', 'MXN', 'BRL', 'CAD']) {
  const fromUp = from.toUpperCase();
  const validTo = toList.map(c => c.toUpperCase()).filter(c => FRANKFURTER_CURRENCIES.has(c) && c !== fromUp);

  if (!FRANKFURTER_CURRENCIES.has(fromUp)) throw new Error(`Moneda base "${from}" no soportada. Disponibles: USD, EUR, GBP, etc.`);
  if (validTo.length === 0) throw new Error('Sin monedas de destino válidas');

  const url = `https://api.frankfurter.app/latest?from=${fromUp}&to=${validTo.join(',')}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!res.ok) throw new Error('Error en API de divisas: ' + res.status);
  return await res.json();
}

function formatExchangeRateResponse(data) {
  const { base, date, rates } = data;
  const lines = [
    `💱 *Tasas de cambio — ${base}*`,
    `_Actualizado: ${date} (BCE)_`,
    '',
  ];

  for (const [code, rate] of Object.entries(rates)) {
    const name = CURRENCY_NAMES[code] || code;
    const formatted = rate < 10 ? rate.toFixed(4) : rate < 1000 ? rate.toFixed(2) : Math.round(rate).toLocaleString('es-CO');
    lines.push(`  • *${code}* (${name}): ${formatted}`);
  }

  lines.push('', `_Para COP usa /dolar (TRM oficial Colombia)_`);
  lines.push(`_Fuente: frankfurter.app — Banco Central Europeo_`);
  return lines.join('\n');
}

// ============================================================
// INFO DE PAÍSES — restcountries.com (sin key)
// https://restcountries.com/
// ============================================================
async function getCountryInfo(query) {
  const url = `https://restcountries.com/v3.1/name/${encodeURIComponent(query)}?fields=name,capital,population,currencies,languages,flags,region,subregion,timezones,area,cca2,cca3,borders`;
  const res = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`País "${query}" no encontrado`);
  const data = await res.json();
  return data[0];
}

function formatCountryResponse(c) {
  const name = c.name?.common || 'Desconocido';
  const official = c.name?.official || name;
  const capital = (c.capital || []).join(', ') || 'N/A';
  const pop = c.population ? c.population.toLocaleString('es-CO') : 'N/A';
  const area = c.area ? c.area.toLocaleString('es-CO') + ' km²' : 'N/A';
  const currencies = Object.values(c.currencies || {}).map(x => `${x.name} (${x.symbol || ''})`).join(', ') || 'N/A';
  const languages = Object.values(c.languages || {}).join(', ') || 'N/A';
  const timezones = (c.timezones || []).join(', ');
  const region = [c.subregion || c.region].filter(Boolean).join(' — ');

  return [
    `🌍 *${name}*`,
    official !== name ? `_${official}_` : null,
    '',
    `🗺️ Región: ${region}`,
    `🏙️ Capital: ${capital}`,
    `👥 Población: ${pop}`,
    `📐 Área: ${area}`,
    `💵 Moneda: ${currencies}`,
    `🗣️ Idiomas: ${languages}`,
    `🕐 Zonas horarias: ${timezones}`,
    c.cca2 ? `🏳️ Código ISO: ${c.cca2} / ${c.cca3 || ''}` : null,
    '',
    `_Fuente: restcountries.com_`,
  ].filter(l => l !== null).join('\n');
}

// ============================================================
// SISMOS RECIENTES — USGS NEIC (sin key)
// https://earthquake.usgs.gov/earthquakes/feed/v1.0/
// ============================================================
async function getRecentEarthquakes(minMag = 4.5) {
  // Feeds disponibles: significant_week, 4.5_week, 2.5_week
  let feedUrl;
  if (minMag >= 5.0) {
    feedUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson';
  } else {
    feedUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';
  }

  const res = await fetch(feedUrl, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!res.ok) throw new Error('Error consultando USGS: ' + res.status);
  const data = await res.json();

  const quakes = data.features
    .filter(e => e.properties.mag >= minMag)
    .sort((a, b) => b.properties.time - a.properties.time)
    .slice(0, 10)
    .map(e => ({
      place: e.properties.place,
      magnitude: e.properties.mag,
      depth: Math.round(e.geometry.coordinates[2]),
      time: new Date(e.properties.time).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }),
      alert: e.properties.alert || null,
    }));

  return { count: data.metadata.count, filtered: quakes };
}

function formatEarthquakesResponse(data) {
  const { filtered: quakes } = data;

  if (quakes.length === 0) {
    return `✅ No se registraron sismos significativos en los últimos 7 días.\n\n_Fuente: USGS NEIC_`;
  }

  const alertEmoji = { green: '🟢', yellow: '🟡', orange: '🟠', red: '🔴' };

  const lines = [
    `🌍 *Sismos recientes (últimos 7 días)*`,
    `_Magnitud ≥ ${quakes[0] ? '' : '4.5'} | Hora Colombia_`,
    '',
  ];

  for (const q of quakes) {
    const mag = q.magnitude.toFixed(1);
    const alert = q.alert ? (alertEmoji[q.alert] || '') + ' ' : '';
    const magEmoji = q.magnitude >= 7 ? '🔴' : q.magnitude >= 6 ? '🟠' : q.magnitude >= 5 ? '🟡' : '⚪';
    lines.push(`${magEmoji} *M${mag}* — ${q.place}`);
    lines.push(`  ${alert}Profundidad: ${q.depth} km | ${q.time}`);
  }

  lines.push('', `_Fuente: USGS National Earthquake Information Center_`);
  return lines.join('\n');
}

// ============================================================
// FESTIVOS — date.nager.at (sin key)
// https://date.nager.at/
// ============================================================
const COUNTRY_NAMES_ES = {
  CO: 'Colombia', US: 'Estados Unidos', MX: 'México', AR: 'Argentina',
  ES: 'España', CL: 'Chile', PE: 'Perú', VE: 'Venezuela', EC: 'Ecuador',
  BR: 'Brasil', DE: 'Alemania', FR: 'Francia', GB: 'Reino Unido',
  IT: 'Italia', CA: 'Canadá', AU: 'Australia', JP: 'Japón',
};

async function getPublicHolidays(countryCode = 'CO', year = null) {
  const y = year || new Date().getFullYear();
  const code = countryCode.toUpperCase();
  const url = `https://date.nager.at/api/v3/PublicHolidays/${y}/${code}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`No se encontraron festivos para ${code} ${y}`);
  return { holidays: await res.json(), country: code, year: y };
}

function formatHolidaysResponse(data) {
  const { holidays, country, year } = data;
  const countryName = COUNTRY_NAMES_ES[country] || country;

  if (!holidays || holidays.length === 0) {
    return `No se encontraron festivos para ${countryName} ${year}.`;
  }

  // Filtrar los que vienen o son próximos
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = holidays.filter(h => h.date >= today);
  const past = holidays.filter(h => h.date < today);

  const lines = [
    `📅 *Festivos ${countryName} ${year}*`,
    `Total: ${holidays.length} | Próximos: ${upcoming.length}`,
    '',
  ];

  if (upcoming.length > 0) {
    lines.push('*Próximos:*');
    for (const h of upcoming.slice(0, 8)) {
      const d = new Date(h.date + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
      lines.push(`  📌 *${d}* — ${h.localName || h.name}`);
    }
  }

  if (past.length > 0 && upcoming.length < 4) {
    lines.push('', '*Anteriores este año:*');
    for (const h of past.slice(-4)) {
      const d = new Date(h.date + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
      lines.push(`  ✓ ${d} — ${h.localName || h.name}`);
    }
  }

  lines.push('', `_Fuente: date.nager.at_`);
  return lines.join('\n');
}

// ============================================================
// DISPATCHER — llamado desde groqService al procesar tool calls
// ============================================================
async function callFreeApiTool(name, args = {}) {
  const label = `${name}(${JSON.stringify(args).substring(0, 60)})`;
  console.log(`[FreeAPI] Llamando: ${label}`);

  try {
    switch (name) {
      case 'get_weather': {
        const city = args.city || 'Bogota';
        const data = await getWeatherForCity(city);
        return formatWeatherResponse(data);
      }
      case 'get_exchange_rate': {
        const from = (args.from || 'USD').toUpperCase();
        const toRaw = args.to || 'EUR,GBP,JPY,MXN,BRL,CAD';
        const toList = toRaw.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
        const data = await getExchangeRates(from, toList);
        return formatExchangeRateResponse(data);
      }
      case 'get_country_info': {
        const query = args.country || args.name || 'Colombia';
        const data = await getCountryInfo(query);
        return formatCountryResponse(data);
      }
      case 'get_recent_earthquakes': {
        const minMag = parseFloat(args.min_magnitude) || 4.5;
        const data = await getRecentEarthquakes(minMag);
        return formatEarthquakesResponse(data);
      }
      case 'get_public_holidays': {
        const code = (args.country_code || args.country || 'CO').toUpperCase();
        const year = parseInt(args.year) || null;
        const data = await getPublicHolidays(code, year);
        return formatHolidaysResponse(data);
      }
      default:
        return `Herramienta "${name}" no reconocida.`;
    }
  } catch (e) {
    console.error(`[FreeAPI] Error en ${name}:`, e.message);
    return `Error obteniendo datos (${name}): ${e.message}`;
  }
}

// ============================================================
// TOOL DEFINITIONS para Groq tool calling
// ============================================================
const FREE_API_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Obtiene el clima actual y pronóstico de 3-4 días para CUALQUIER ciudad del mundo. Usar SIEMPRE cuando el usuario pregunte por clima, temperatura, lluvia, pronóstico, calor, frío, nieve, tiempo atmosférico. No usar web_search para clima, usar esta herramienta.',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'Nombre de la ciudad. Ej: Bogota, Madrid, Nueva York, Buenos Aires, Tokyo. Si el usuario no especifica ciudad usar "Bogota".',
          },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_exchange_rate',
      description: 'Obtiene tasas de cambio actualizadas entre monedas mundiales (EUR, GBP, JPY, MXN, BRL, CAD, etc.). Usar cuando pregunten por conversión de monedas o tipo de cambio. NOTA: No incluye COP (peso colombiano), para TRM usar /dolar.',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Moneda base. Ej: USD, EUR, GBP. Por defecto USD.',
          },
          to: {
            type: 'string',
            description: 'Monedas destino separadas por coma. Ej: EUR,GBP,JPY,MXN,BRL,CAD',
          },
        },
        required: ['from'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_country_info',
      description: 'Obtiene información actualizada de un país: capital, población, moneda, idiomas, área, zona horaria. Usar cuando pregunten sobre datos de un país.',
      parameters: {
        type: 'object',
        properties: {
          country: {
            type: 'string',
            description: 'Nombre del país en español o inglés. Ej: Colombia, France, Japan, Brasil.',
          },
        },
        required: ['country'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_earthquakes',
      description: 'Obtiene sismos y terremotos significativos de los últimos 7 días a nivel mundial. Usar cuando pregunten por sismos, terremotos, actividad sísmica, temblores recientes.',
      parameters: {
        type: 'object',
        properties: {
          min_magnitude: {
            type: 'number',
            description: 'Magnitud mínima Richter. Por defecto 4.5. Usar 6.0+ para sismos fuertes únicamente.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_public_holidays',
      description: 'Obtiene los días festivos y feriados de un país para un año específico. Usar cuando pregunten por festivos, feriados, días no laborales, puentes.',
      parameters: {
        type: 'object',
        properties: {
          country_code: {
            type: 'string',
            description: 'Código de país ISO 2 letras: CO (Colombia), US, MX, AR, ES, CL, PE, BR, DE, FR, GB. Por defecto CO.',
          },
          year: {
            type: 'integer',
            description: 'Año. Si no se especifica, usa el año actual.',
          },
        },
        required: ['country_code'],
      },
    },
  },
];

// Detección proactiva — cuándo llamar a un API antes que el modelo responda
// Retorna { tool, args } o null
function detectProactiveTool(message) {
  if (!message || typeof message !== 'string') return null;
  const msg = message.toLowerCase().trim();
  if (msg.length < 8) return null;

  // ---- Clima con ciudad explícita ----
  const weatherCityPatterns = [
    /\b(?:clima|tiempo|temperatura|lluvia|pronostico|pronóstico|calor|frío|frio|va a llover|nevar)\b.{0,40}\ben\b.{0,25}([a-záéíóúñü][a-záéíóúñü\s]{2,25})/i,
    /\b(?:como|cómo)\s+(?:esta|está)\s+el\s+(?:clima|tiempo|temperatura)\s+(?:en|de)\s+([a-záéíóúñü][a-záéíóúñü\s]{2,25})/i,
    /\b([a-záéíóúñü][a-záéíóúñü\s]{2,20})\s+(?:clima|tiempo|temperatura|lluvia|pronostico)/i,
  ];
  for (const pat of weatherCityPatterns) {
    const m = msg.match(pat);
    if (m && m[1]) {
      const city = m[1].trim().replace(/\b(hoy|mañana|ahora|este|la)\b/gi, '').trim();
      if (city.length > 2) return { tool: 'get_weather', args: { city } };
    }
  }

  // ---- Clima general (sin ciudad → Bogotá) ----
  if (/\b(?:va a llover hoy|esta lloviendo|como esta el tiempo hoy|que tal el clima|temperatura hoy|hace calor hoy|esta frio hoy)\b/i.test(msg)) {
    return { tool: 'get_weather', args: { city: 'Bogota' } };
  }

  // ---- Sismos ----
  if (/\b(?:sismo|terremoto|temblor|sismos|terremotos|actividad sismica|sísmica|hubo temblor)\b/i.test(msg)) {
    return { tool: 'get_recent_earthquakes', args: { min_magnitude: 4.5 } };
  }

  // ---- Festivos Colombia ----
  if (/\b(?:festivo|feriado|día no laboral|puente festivo|dias festivos)\b.{0,30}\b(?:colombia|colombi)\b/i.test(msg) ||
      /\b(?:proximo|siguiente|cuándo es el|cuando es el)\s+(?:festivo|feriado)\b/i.test(msg) ||
      /\b(?:festivos?|feriados?)\s+(?:de|en|del)\s+(?:colombia|este año|este mes)\b/i.test(msg)) {
    return { tool: 'get_public_holidays', args: { country_code: 'CO' } };
  }

  return null;
}

module.exports = {
  FREE_API_TOOLS,
  callFreeApiTool,
  detectProactiveTool,
  // Funciones directas (para /clima en whatsappClient)
  getWeatherForCity,
  formatWeatherResponse,
  getExchangeRates,
  formatExchangeRateResponse,
  getCountryInfo,
  formatCountryResponse,
  getRecentEarthquakes,
  formatEarthquakesResponse,
  getPublicHolidays,
  formatHolidaysResponse,
};
