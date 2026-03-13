// Groqbot/src/freeApiTools.js
// APIs 100% gratuitas, sin API key requerida.
// Usadas como tools de Groq para responder automáticamente en conversación.

const API_TIMEOUT_MS = 9000;
const TZ = process.env.TIMEZONE || 'America/Bogota';

/** Retorna la fecha de hoy en Bogotá como string YYYY-MM-DD */
function _todayBogota() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // en-CA → YYYY-MM-DD
}

/** Retorna el año actual en Bogotá */
function _yearBogota() {
  return parseInt(new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 4));
}

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

/** Convierte grados de viento a punto cardinal (8 puntos) */
function _windDeg2Dir(deg) {
  if (deg === null || deg === undefined) return null;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/** Formatea hora ISO (2026-03-13T06:09) → HH:MM en la timezone dada */
function _fmtTime(isoStr, tz) {
  if (!isoStr) return null;
  try {
    return new Date(isoStr).toLocaleTimeString('es-CO', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return null; }
}

async function getWeatherForCity(cityName) {
  if (!cityName || typeof cityName !== 'string') throw new Error('Nombre de ciudad requerido');

  let latitude, longitude, name, country, timezone, admin1;

  // Bogotá shortcut — coordenadas hardcodeadas, sin geocoding
  const isBogota = /^bog[oa]t[aá]$/i.test(cityName.trim());
  if (isBogota) {
    latitude = 4.6097; longitude = -74.0817;
    name = 'Bogotá'; country = 'Colombia'; timezone = 'America/Bogota'; admin1 = 'Cundinamarca';
  } else {
    // 1. Geocodificar ciudad → coordenadas
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=es&format=json`;
    const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    if (!geoRes.ok) throw new Error('Error buscando ciudad: ' + geoRes.status);
    const geoData = await geoRes.json();

    if (!geoData.results || geoData.results.length === 0) {
      throw new Error(`Ciudad "${cityName}" no encontrada`);
    }
    ({ latitude, longitude, name, country, timezone, admin1 } = geoData.results[0]);
  }

  // 2. Obtener clima actual + pronóstico 4 días
  const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_direction_10m,precipitation,uv_index,cloud_cover` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,uv_index_max,sunrise,sunset,precipitation_sum,wind_speed_10m_max` +
    `&timezone=${encodeURIComponent(timezone || 'auto')}&forecast_days=4`;

  const wRes = await fetch(wUrl, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!wRes.ok) throw new Error('Error obteniendo clima: ' + wRes.status);
  const wData = await wRes.json();

  const c = wData.current;
  const d = wData.daily;
  const tz = timezone || 'auto';

  const forecast = (d.time || []).slice(0, 4).map((date, i) => ({
    date,
    maxC: Math.round(d.temperature_2m_max[i]),
    minC: Math.round(d.temperature_2m_min[i]),
    rain: d.precipitation_probability_max[i] || 0,
    code: d.weather_code[i],
    uvMax: d.uv_index_max ? Math.round(d.uv_index_max[i]) : null,
    sunrise: _fmtTime(d.sunrise ? d.sunrise[i] : null, tz),
    sunset: _fmtTime(d.sunset ? d.sunset[i] : null, tz),
    precipSum: d.precipitation_sum ? (d.precipitation_sum[i] || 0) : 0,
    windMax: d.wind_speed_10m_max ? Math.round(d.wind_speed_10m_max[i]) : null,
  }));

  return {
    city: name,
    region: admin1 || null,
    country: country || null,
    timezone: tz,
    current: {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      windKmph: Math.round(c.wind_speed_10m),
      windDir: _windDeg2Dir(c.wind_direction_10m),
      precipitation: c.precipitation || 0,
      uvIndex: c.uv_index !== undefined ? Math.round(c.uv_index) : null,
      cloudCover: c.cloud_cover !== undefined ? c.cloud_cover : null,
      code: c.weather_code,
      description: WMO_DESC[c.weather_code] || 'condiciones variables',
      emoji: WMO_EMOJI(c.weather_code, c.is_day),
      isDay: c.is_day,
    },
    forecast,
  };
}

function _weatherTip(rainTodayPct, rainTomorrowPct, uvIndex) {
  if (rainTodayPct >= 60) {
    const opts = [
      '☔ Hoy llueve — el plan perfecto es cobija, café y una buena serie.',
      '🌧️ Paraguas obligatorio. El clima dice: quédate cómodo hoy.',
      '🌧️ Día de lluvia — ideal para quedarse en casa con algo rico.',
    ];
    return opts[Math.floor(Math.random() * opts.length)];
  }
  if (rainTodayPct >= 30) {
    const opts = [
      '🌂 Posible lluvia — lleva paraguas por si acaso.',
      '🌦️ Cielos inestables. No salgas sin sombrilla.',
    ];
    return opts[Math.floor(Math.random() * opts.length)];
  }
  if (rainTomorrowPct >= 60) {
    return '☀️ Hoy está despejado — aprovecha antes de que llegue la lluvia mañana.';
  }
  if (uvIndex >= 8) {
    const opts = [
      '🧴 Sol fuerte hoy — protector solar antes de salir.',
      '☀️ Buen día para salir, pero lleva protector solar.',
    ];
    return opts[Math.floor(Math.random() * opts.length)];
  }
  if (uvIndex >= 6) {
    const opts = [
      '😎 Buenas condiciones hoy — disfruta el día.',
      '🌤️ Clima agradable — perfecto para salir.',
    ];
    return opts[Math.floor(Math.random() * opts.length)];
  }
  const opts = [
    '🌿 Día tranquilo — perfecto para lo que tengas planeado.',
    '✨ El clima acompaña hoy, disfrútalo.',
    '🌤️ Buen día para salir.',
  ];
  return opts[Math.floor(Math.random() * opts.length)];
}

function formatWeatherResponse(data) {
  const { city, region, country, current: c, forecast } = data;

  // Evitar redundancia tipo "Bogotá, Distrito Capital de Bogotá, Colombia"
  const regionClean = region && !region.toLowerCase().includes(city.toLowerCase()) ? region : null;
  const location = [city, regionClean, country].filter(Boolean).join(', ');

  const uvStr = c.uvIndex !== null
    ? `UV ${c.uvIndex}${c.uvIndex >= 11 ? ' 🔴' : c.uvIndex >= 8 ? ' ⚠️' : ''}`
    : null;
  const windStr = c.windDir ? `💨 ${c.windKmph} km/h ${c.windDir}` : `💨 ${c.windKmph} km/h`;

  const lines = [
    `*${location}* ${c.emoji}`,
    `*${c.temp}°C* — ${c.description}`,
    `Sensación ${c.feelsLike}° · Humedad ${c.humidity}%`,
    `${windStr}${uvStr ? ` · ${uvStr}` : ''}`,
  ];

  // Amanecer/atardecer compacto
  if (forecast.length > 0 && (forecast[0].sunrise || forecast[0].sunset)) {
    const sun = [];
    if (forecast[0].sunrise) sun.push(`🌅 ${forecast[0].sunrise}`);
    if (forecast[0].sunset) sun.push(`🌇 ${forecast[0].sunset}`);
    lines.push(sun.join('  '));
  }

  if (forecast.length > 0) {
    lines.push('', '*Pronóstico*');
    for (const day of forecast) {
      const isToday = day.date === _todayBogota();
      const label = isToday
        ? 'Hoy  '
        : new Date(day.date + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' });
      const em = WMO_EMOJI(day.code, true);
      const rain = day.rain >= 50 ? `  ☂️ ${day.rain}%` : day.rain >= 15 ? `  ${day.rain}% 🌧️` : '';
      const uv = day.uvMax >= 8 ? `  ☀️${day.uvMax}` : '';
      lines.push(`• ${label}  ${em}  ${day.maxC}° / ${day.minC}°${rain}${uv}`);
    }
  }

  const rainToday = forecast[0]?.rain || 0;
  const rainTomorrow = forecast[1]?.rain || 0;
  const tip = _weatherTip(rainToday, rainTomorrow, c.uvIndex || 0);
  lines.push('', `_${tip}_`);

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
  const y = year || _yearBogota();
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
  const today = _todayBogota();
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
// Política: mejor lanzar una API de más que no responder con datos reales.
function detectProactiveTool(message) {
  if (!message || typeof message !== 'string') return null;
  const msg = message.toLowerCase().trim();
  if (msg.length < 5) return null;

  // ---- Clima: cualquier mención de palabras clave climáticas ----
  const weatherKeyword = /\b(clima|temperatura|tiempo(?!\s+libre|\s+es\s+oro|\s+muerto|\s+de\s+calidad|\s+que\s+falta)(?!\s+libre)|lluvi[ao]|lloviendo|va\s+a\s+llover|pronostic[oa]|calor\b|fr[íi]o\b|nublado|despejado|nevar|nevada|granizo|tormenta\b|humedad|viento\b|sol\s+hoy)\b/i;
  if (weatherKeyword.test(msg)) {
    // Intentar extraer ciudad del mensaje
    const cityExtractors = [
      // "en Bogotá", "en Madrid" — la ciudad viene después de "en"
      /\ben\s+((?:[a-záéíóúñü]+\s*){1,3}?)(?:\s*[?!.,]|\s*$)/i,
      // "de Medellín", "para Cali"
      /\b(?:de|para)\s+((?:[a-záéíóúñü]+\s*){1,2}?)(?:\s*[?!.,]|\s*$)/i,
      // "clima [ciudad]" o "[ciudad] temperatura"
      /(?:clima|temperatura|tiempo)\s+(?:de\s+|en\s+)?((?:[a-záéíóúñü]+\s*){1,2}?)(?:\s*[?!.,]|\s*$)/i,
      /\b((?:[a-záéíóúñü]+\s*){1,2}?)\s+(?:clima|temperatura|tiempo|lluvia)\b/i,
    ];

    // Palabras a ignorar como ciudades
    const STOP_WORDS = /^(el|la|los|las|un|una|hoy|mañana|ahora|este|esta|que|del|de|en|sobre|acerca|actual|actualmente|hace|como|cómo|cual|cuál|bogota|bogotá|colombia)$/i;

    for (const pat of cityExtractors) {
      const m = msg.match(pat);
      if (m && m[1]) {
        const raw = m[1].trim();
        // Eliminar stop words y limpiar
        const city = raw.split(/\s+/)
          .filter(w => w.length > 2 && !STOP_WORDS.test(w))
          .join(' ')
          .trim();
        if (city.length > 2) {
          return { tool: 'get_weather', args: { city } };
        }
      }
    }

    // Sin ciudad → Bogotá por defecto
    return { tool: 'get_weather', args: { city: 'Bogota' } };
  }

  // ---- Sismos ----
  if (/\b(sismo|terremoto|temblor|sismos|terremotos|actividad\s+s[íi]smica|hubo\s+temblor|hay\s+temblor)\b/i.test(msg)) {
    return { tool: 'get_recent_earthquakes', args: { min_magnitude: 4.5 } };
  }

  // ---- Festivos / feriados ----
  if (/\b(festivo|feriado|d[íi]a\s+no\s+laboral|puente\s+festivo|dias?\s+festivos?|feriados?)\b/i.test(msg)) {
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
