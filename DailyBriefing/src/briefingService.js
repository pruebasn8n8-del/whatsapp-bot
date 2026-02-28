// DailyBriefing/src/briefingService.js - Orquestador del briefing diario

const { getWeather, formatWeather } = require('./weatherService');
const { getNewsByTopics, formatNews } = require('./newsService');
const {
  getTRM, getCryptoPrice, getFxRates,
  formatCOP: formatCOPPrice, formatUSD, formatChangeArrow,
} = require('../../Groqbot/src/priceService');

// Emojis y nombres para divisas fiat
const FX_EMOJI = {
  EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', CHF: '🇨🇭',
  MXN: '🇲🇽', BRL: '🇧🇷', ARS: '🇦🇷', PEN: '🇵🇪',
  CLP: '🇨🇱', VES: '🇻🇪', CAD: '🇨🇦', AUD: '🇦🇺',
};
const FX_NAME = {
  EUR: 'Euro', GBP: 'Libra', JPY: 'Yen japonés', CNY: 'Yuan chino',
  CHF: 'Franco suizo', MXN: 'Peso MX', BRL: 'Real brasileño', ARS: 'Peso AR',
  PEN: 'Sol peruano', CLP: 'Peso CL', VES: 'Bolívar', CAD: 'Dólar CA', AUD: 'Dólar AU',
};

// Emojis para criptomonedas comunes
const CRYPTO_EMOJI = {
  BTC: '₿', ETH: '⟠', SOL: '◎', BNB: '🔶', XRP: '✕',
  ADA: '₳', DOGE: '🐕', DOT: '●', MATIC: '⬟', AVAX: '🔺',
  LINK: '⬡', ATOM: '⚛', LTC: 'Ł', NEAR: '🌊', TON: '💎',
  SHIB: '🐕', PEPE: '🐸', SUI: '🌊', APT: '📦', ARB: '🔷', OP: '🔴',
};

/**
 * Genera el mensaje completo del briefing diario.
 * @param {object} options
 * @param {string} options.userName - Nombre del usuario
 * @param {object} options.prefs - Preferencias del usuario (de prefsDb)
 * @returns {string} Mensaje formateado para WhatsApp
 */
async function generateBriefing(options = {}) {
  const { userName = '', prefs = {} } = options;

  const show_weather = prefs.show_weather !== false;
  const show_trm = prefs.show_trm !== false;
  const cryptos = prefs.cryptos && prefs.cryptos.length > 0 ? prefs.cryptos : ['BTC'];
  const fx_currencies = prefs.fx_currencies || [];
  const news_count = prefs.news_count || 5;
  const news_topics = prefs.news_topics && prefs.news_topics.length > 0
    ? prefs.news_topics
    : ['colombia', 'internacional'];

  // Datos base en paralelo
  const [weatherResult, newsResult, trmResult] = await Promise.allSettled([
    show_weather ? getWeather() : Promise.resolve(null),
    getNewsByTopics(news_topics, news_count),
    show_trm ? getTRM() : Promise.resolve(null),
  ]);

  // Criptomonedas en paralelo
  const cryptoResults = await Promise.allSettled(cryptos.map(c => getCryptoPrice(c)));

  // Divisas fiat (si hay alguna configurada)
  const fxRates = fx_currencies.length > 0
    ? await getFxRates(fx_currencies).catch(() => [])
    : [];

  // Gastos (opcional)
  let gastosInfo = null;
  try { gastosInfo = await _getGastosInfo(); } catch (_) {}

  // Construir mensaje
  const { DateTime } = require('luxon');
  const now = DateTime.now().setZone(process.env.TIMEZONE || 'America/Bogota');
  const greeting = _getGreeting(now.hour, userName, now.weekday % 7); // luxon: 1=Mon..7=Sun → 0=Sun via mod
  const dateStr = now.toFormat("cccc d 'de' LLLL yyyy", { locale: 'es' });

  const sections = [];

  // Header
  sections.push(`${greeting} - _${dateStr}_`);
  sections.push('');

  // Clima
  if (show_weather) {
    const weatherData = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
    const weatherText = formatWeather(weatherData);
    if (weatherText) {
      sections.push(weatherText);
      sections.push('');
    }
  }

  // Precios: TRM + criptos + divisas fiat
  const priceLines = [];

  if (show_trm && trmResult.status === 'fulfilled' && trmResult.value) {
    priceLines.push(`💵 *Dólar TRM:* ${formatCOPPrice(trmResult.value.rate)} COP`);
  }

  for (let i = 0; i < cryptos.length; i++) {
    if (cryptoResults[i].status === 'fulfilled' && cryptoResults[i].value) {
      const b = cryptoResults[i].value;
      const emoji = CRYPTO_EMOJI[b.symbol] || '🪙';
      priceLines.push(`${emoji} *${b.symbol}:* ${formatUSD(b.price_usd)} (${formatChangeArrow(b.change_24h)})`);
    }
  }

  if (fxRates.length > 0) {
    for (const r of fxRates) {
      const emoji = FX_EMOJI[r.currency] || '💱';
      const name = FX_NAME[r.currency] || r.currency;
      priceLines.push(`${emoji} *${name}:* ${formatCOPPrice(r.priceCop)} COP`);
    }
  }

  if (priceLines.length > 0) {
    sections.push(priceLines.join('\n'));
    sections.push('');
  }

  // Noticias
  const newsData = newsResult.status === 'fulfilled' ? newsResult.value : [];
  const newsText = formatNews(newsData);
  if (newsText) {
    sections.push(newsText);
    sections.push('');
  }

  // Gastos
  if (gastosInfo) {
    sections.push(gastosInfo);
    sections.push('');
  }

  // Footer con comandos de personalización
  sections.push(_footerHelp());

  return sections.join('\n');
}

function _footerHelp() {
  return [
    '─────────────────────────',
    '_/prefs_ → personalizar  |  _/noticias_ → noticias  |  _/precios_ → precios',
  ].join('\n');
}

// Mensajes motivadores según el día de la semana
const DAY_CONTEXT = {
  1: '💪 *¡Que empiece bien la semana!*',   // Lunes
  2: '🚀 *Martes con todo!*',               // Martes
  3: '⚡ *Mitad de semana, vamos!*',         // Miércoles
  4: '🔥 *Ya casi viernes!*',               // Jueves
  5: '🎉 *¡Feliz viernes!*',                // Viernes
  6: '😎 *Sábado libre!*',                  // Sábado
  0: '☕ *Domingo de recarga!*',             // Domingo
};

function _getGreeting(hour, userName, dayOfWeek) {
  const name = userName ? `, ${userName}` : '';
  let timeGreeting;
  if (hour < 12) timeGreeting = `☀️ *Buenos días${name}!*`;
  else if (hour < 18) timeGreeting = `🌤️ *Buenas tardes${name}!*`;
  else timeGreeting = `🌙 *Buenas noches${name}!*`;

  const dayMsg = dayOfWeek !== undefined ? DAY_CONTEXT[dayOfWeek] : null;
  return dayMsg ? `${timeGreeting}  ${dayMsg}` : timeGreeting;
}

async function _getGastosInfo() {
  try {
    const { getFinancialSummary } = require('../../Gastos/src/sheets/financialSummary');
    const summary = await getFinancialSummary();
    if (!summary) return null;

    const { formatCOP } = require('../../Gastos/src/utils/formatCurrency');
    const lines = ['💰 *Finanzas del mes*'];

    if (summary.totalGastos !== undefined) {
      lines.push(`Gastos: *${formatCOP(summary.totalGastos)}*`);
    }
    if (summary.presupuesto) {
      const pct = Math.round((summary.totalGastos / summary.presupuesto) * 100);
      lines.push(`Presupuesto: ${formatCOP(summary.totalGastos)} / ${formatCOP(summary.presupuesto)} (${pct}%)`);
    }
    if (summary.saldo !== undefined) {
      lines.push(`Saldo: *${formatCOP(summary.saldo)}*`);
    }

    return lines.join('\n');
  } catch (_) {
    return null;
  }
}

module.exports = { generateBriefing, CRYPTO_EMOJI, FX_EMOJI, FX_NAME };
