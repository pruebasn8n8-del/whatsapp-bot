// src/prefsDb.js - Preferencias del briefing por usuario en Supabase
// SQL requerido en Supabase:
//   ALTER TABLE contacts ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}';

const { getContact, upsertContact } = require('./contactsDb');

const DEFAULT_PREFS = {
  briefing_enabled: false,       // opt-in (admin se maneja aparte en scheduler)
  briefing_times: [7, 13, 19],  // horas del día (24h) que coincidan con el scheduler
  show_weather: true,
  show_trm: true,
  cryptos: ['BTC'],              // BTC, ETH, SOL, etc. (alias del COIN_ALIASES de priceService)
  fx_currencies: [],             // EUR, GBP, JPY, MXN, BRL, ARS, etc.
  news_count: 5,                 // 1-10
  news_topics: ['colombia', 'internacional'],
};

const VALID_TOPICS = ['colombia', 'internacional', 'tecnologia', 'deportes', 'economia', 'entretenimiento'];

const TOPIC_LABELS = {
  colombia: 'Colombia',
  internacional: 'Internacional',
  tecnologia: 'Tecnología',
  deportes: 'Deportes',
  economia: 'Economía',
  entretenimiento: 'Entretenimiento',
};

const VALID_FX = ['EUR', 'GBP', 'JPY', 'MXN', 'BRL', 'ARS', 'PEN', 'CLP', 'VES', 'CNY', 'CAD', 'CHF', 'AUD'];

async function getPrefs(jid) {
  const contact = await getContact(jid);
  const stored = contact?.preferences || {};
  return { ...DEFAULT_PREFS, ...stored };
}

async function setPrefs(jid, updates) {
  const current = await getPrefs(jid);
  const merged = { ...current, ...updates };
  await upsertContact(jid, { preferences: merged });
  return merged;
}

function briefingFooterHelp() {
  return [
    '─────────────────────────',
    '⚙️ _Personaliza tu briefing:_',
    '_/prefs on|off_ → activar/desactivar automático',
    '_/prefs horarios 7 13 19_ → cambiar horarios',
    '_/prefs monedas BTC ETH SOL_ → criptos a mostrar',
    '_/prefs divisas EUR GBP_ → divisas fiat extra',
    '_/prefs noticias colombia tecnologia_ → temas',
    '_/prefs cantidad 5_ → número de noticias',
    '_/noticias_ • _/precios_ • _/briefing_',
  ].join('\n');
}

function formatPrefsText(prefs) {
  const times = prefs.briefing_times && prefs.briefing_times.length
    ? prefs.briefing_times.map(h => `${h}:00`).join(', ')
    : 'ninguno';
  const cryptos = prefs.cryptos && prefs.cryptos.length ? prefs.cryptos.join(', ') : 'ninguna';
  const divisas = prefs.fx_currencies && prefs.fx_currencies.length ? prefs.fx_currencies.join(', ') : 'ninguna';
  const topics = prefs.news_topics && prefs.news_topics.length
    ? prefs.news_topics.map(t => TOPIC_LABELS[t] || t).join(', ')
    : 'ninguno';

  return [
    '⚙️ *Mis preferencias del briefing*',
    '',
    `Briefing automático: ${prefs.briefing_enabled ? '*activo* ✅' : '*desactivado* ❌'}`,
    `Horarios: *${times}*`,
    `Clima: ${prefs.show_weather !== false ? '✅' : '❌'}`,
    `Dólar TRM: ${prefs.show_trm !== false ? '✅' : '❌'}`,
    `Criptomonedas: *${cryptos}*`,
    `Divisas extra: *${divisas}*`,
    `Temas de noticias: *${topics}*`,
    `Cantidad de noticias: *${prefs.news_count || 5}*`,
    '',
    briefingFooterHelp(),
  ].join('\n');
}

module.exports = {
  getPrefs,
  setPrefs,
  formatPrefsText,
  briefingFooterHelp,
  DEFAULT_PREFS,
  VALID_TOPICS,
  VALID_FX,
  TOPIC_LABELS,
};
