// DailyBriefing/src/scheduler.js - Scheduler del briefing (7:00, 13:00, 19:00)

const cron = require('node-cron');
const { generateBriefing } = require('./briefingService');

const PREFIX = '\u200B'; // Zero-width space (anti-loop)
const SCHEDULE_HOURS = [7, 13, 19]; // Horarios fijos globales

let _cronJobs = [];
let _enabled = true;
let _sock = null;

/**
 * Inicia el scheduler del briefing (3 horarios diarios).
 * @param {object} sock - Socket de Baileys
 */
function startScheduler(sock) {
  _sock = sock;
  _scheduleAllJobs(sock);
  console.log(`[DailyBriefing] Scheduler iniciado - Horarios: ${SCHEDULE_HOURS.map(h => h + ':00').join(', ')} (${process.env.TIMEZONE || 'America/Bogota'})`);
}

function _scheduleAllJobs(sock) {
  _cronJobs.forEach(j => j.stop());
  _cronJobs = [];

  if (!_enabled) return;

  const tz = process.env.TIMEZONE || 'America/Bogota';
  for (const hour of SCHEDULE_HOURS) {
    const job = cron.schedule(`0 ${hour} * * *`, async () => {
      await _sendBriefingAtHour(sock, hour);
    }, { timezone: tz });
    _cronJobs.push(job);
  }
}

/**
 * Envía el briefing a todos los suscriptores para una hora dada.
 * Admin siempre recibe; usuarios externos solo si briefing_enabled y ese horario activado.
 */
async function _sendBriefingAtHour(sock, hour) {
  if (!_enabled) return;

  const myNumber = process.env.MY_NUMBER;
  const { getPrefs, DEFAULT_PREFS } = require('../../src/prefsDb');
  const { getAllContacts } = require('../../src/contactsDb');

  // Admin: siempre recibe en los 3 horarios por defecto
  if (myNumber) {
    const adminJid = myNumber + '@s.whatsapp.net';
    try {
      console.log(`[DailyBriefing] Enviando briefing al admin (${hour}:00)...`);
      const adminPrefs = await getPrefs(adminJid);
      const msg = await generateBriefing({ userName: sock.user?.name || '', prefs: adminPrefs });
      await sock.sendMessage(adminJid, { text: PREFIX + msg });
      console.log(`[DailyBriefing] Briefing enviado al admin (${hour}:00)`);
    } catch (err) {
      console.error('[DailyBriefing] Error enviando al admin:', err.message);
    }
  }

  // Usuarios externos con briefing activado y ese horario configurado
  try {
    const contacts = await getAllContacts();
    let sent = 0;

    for (const contact of contacts) {
      // Skip admin
      if (myNumber && (contact.jid === myNumber + '@s.whatsapp.net' || contact.jid.startsWith(myNumber))) continue;

      const prefs = { ...DEFAULT_PREFS, ...(contact.preferences || {}) };
      if (!prefs.briefing_enabled) continue;
      if (!Array.isArray(prefs.briefing_times) || !prefs.briefing_times.includes(hour)) continue;

      try {
        const msg = await generateBriefing({ userName: contact.name || '', prefs });
        await sock.sendMessage(contact.jid, { text: PREFIX + msg });
        sent++;
        // Rate limiting entre usuarios para evitar spam
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.error(`[DailyBriefing] Error enviando a ${contact.jid}:`, err.message);
      }
    }

    if (sent > 0) console.log(`[DailyBriefing] Briefing enviado a ${sent} usuarios externos (${hour}:00)`);
  } catch (err) {
    console.error('[DailyBriefing] Error en envío masivo:', err.message);
  }
}

/**
 * Activa/desactiva el envío automático (global).
 */
function setEnabled(enabled, sock) {
  _enabled = enabled;
  _scheduleAllJobs(sock || _sock);
}

function isEnabled() {
  return _enabled;
}

/**
 * Retorna los horarios programados.
 */
function getScheduledTimes() {
  return SCHEDULE_HOURS;
}

/**
 * Stub de backward-compat (ya no se usa - los horarios son fijos 7/13/19).
 * Usar /prefs horarios para ajustar por usuario.
 */
function setScheduleTime(hour, minute, sock) {
  console.warn('[DailyBriefing] setScheduleTime obsoleto - usa /prefs horarios por usuario');
}

function getScheduleTime() {
  return { hour: SCHEDULE_HOURS[0], minute: 0 };
}

/**
 * Envía un briefing bajo demanda al JID indicado, usando sus preferencias.
 * @param {object} sock - Socket de Baileys
 * @param {string} jid - Chat ID
 */
async function sendBriefingNow(sock, jid) {
  const { getPrefs } = require('../../src/prefsDb');
  const prefs = await getPrefs(jid);
  const userName = sock.user?.name || '';
  const message = await generateBriefing({ userName, prefs });
  await sock.sendMessage(jid, { text: PREFIX + message });
}

module.exports = {
  startScheduler,
  setEnabled,
  isEnabled,
  getScheduledTimes,
  getScheduleTime,      // backward-compat
  setScheduleTime,      // backward-compat (no-op)
  sendBriefingNow,
};
