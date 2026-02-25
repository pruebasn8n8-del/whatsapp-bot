// DailyBriefing/src/briefingService.js - Orquestador del briefing diario

const { getWeather, formatWeather } = require('./weatherService');
const { getNews, formatNews } = require('./newsService');
const { getTRM, getCryptoPrice, formatCOP: formatCOPPrice, formatUSD, formatChangeArrow } = require('../../Groqbot/src/priceService');

/**
 * Genera el mensaje completo del briefing diario.
 * @param {object} options
 * @param {string} options.userName - Nombre del usuario
 * @param {number} options.newsCount - Numero de noticias
 * @returns {string} Mensaje formateado para WhatsApp
 */
async function generateBriefing(options = {}) {
  const { userName = '', newsCount = 5 } = options;

  // Obtener todos los datos en paralelo
  const [weather, news, trm, btc] = await Promise.allSettled([
    getWeather(),
    getNews(newsCount),
    getTRM(),
    getCryptoPrice('bitcoin'),
  ]);

  // Obtener datos de gastos (si el modulo esta disponible)
  let gastosInfo = null;
  try {
    gastosInfo = await _getGastosInfo();
  } catch (_) {}

  // Construir mensaje
  const { DateTime } = require('luxon');
  const now = DateTime.now().setZone(process.env.TIMEZONE || 'America/Bogota');
  const greeting = _getGreeting(now.hour, userName);
  const dateStr = now.toFormat("cccc d 'de' LLLL yyyy", { locale: 'es' });

  const sections = [];

  // Header
  sections.push(`${greeting} - _${dateStr}_`);
  sections.push('');

  // Clima
  const weatherData = weather.status === 'fulfilled' ? weather.value : null;
  const weatherText = formatWeather(weatherData);
  if (weatherText) {
    sections.push(weatherText);
    sections.push('');
  }

  // Precios
  const priceLines = [];
  if (trm.status === 'fulfilled' && trm.value) {
    priceLines.push(`💵 *Dolar TRM:* ${formatCOPPrice(trm.value.rate)} COP`);
  }
  if (btc.status === 'fulfilled' && btc.value) {
    const b = btc.value;
    priceLines.push(`₿ *Bitcoin:* ${formatUSD(b.price_usd)} (${formatChangeArrow(b.change_24h)})`);
  }
  if (priceLines.length > 0) {
    sections.push(priceLines.join('\n'));
    sections.push('');
  }

  // Noticias
  const newsData = news.status === 'fulfilled' ? news.value : [];
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

  // Footer
  sections.push('_/briefing para actualizar_');

  return sections.join('\n');
}

function _getGreeting(hour, userName) {
  const name = userName ? `, ${userName}` : '';
  if (hour < 12) return `☀️ *Buenos dias${name}!*`;
  if (hour < 18) return `🌤️ *Buenas tardes${name}!*`;
  return `🌙 *Buenas noches${name}!*`;
}

/**
 * Intenta obtener info de gastos del mes actual.
 */
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

module.exports = { generateBriefing };
