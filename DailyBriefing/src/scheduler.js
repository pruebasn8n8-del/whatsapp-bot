// DailyBriefing/src/scheduler.js - Programador del briefing diario

const cron = require('node-cron');
const { generateBriefing } = require('./briefingService');

const PREFIX = '\u200B'; // Zero-width space (anti-loop)

let _cronJob = null;
let _enabled = true;
let _hour = 7;
let _minute = 0;

/**
 * Inicia el scheduler del briefing diario.
 * @param {object} sock - Socket de Baileys
 */
function startScheduler(sock) {
  _scheduleJob(sock);
  console.log(`[DailyBriefing] Scheduler iniciado - ${_hour}:${String(_minute).padStart(2, '0')} AM (${process.env.TIMEZONE || 'America/Bogota'})`);
}

/**
 * Cambia la hora del briefing.
 * @param {number} hour - Hora (0-23)
 * @param {number} minute - Minuto (0-59)
 * @param {object} sock - Socket de Baileys
 */
function setScheduleTime(hour, minute, sock) {
  _hour = hour;
  _minute = minute;
  if (_cronJob) {
    _cronJob.stop();
    _cronJob = null;
  }
  if (_enabled) {
    _scheduleJob(sock);
  }
}

/**
 * Activa/desactiva el envio automatico.
 */
function setEnabled(enabled, sock) {
  _enabled = enabled;
  if (_cronJob) {
    _cronJob.stop();
    _cronJob = null;
  }
  if (_enabled) {
    _scheduleJob(sock);
  }
}

function isEnabled() {
  return _enabled;
}

function getScheduleTime() {
  return { hour: _hour, minute: _minute };
}

function _scheduleJob(sock) {
  if (_cronJob) {
    _cronJob.stop();
  }

  const timezone = process.env.TIMEZONE || 'America/Bogota';
  const cronExpr = `${_minute} ${_hour} * * *`;

  _cronJob = cron.schedule(cronExpr, async () => {
    if (!_enabled) return;

    const myNumber = process.env.MY_NUMBER;
    if (!myNumber) {
      console.error('[DailyBriefing] MY_NUMBER no configurado');
      return;
    }

    const jid = myNumber + '@s.whatsapp.net';

    try {
      console.log('[DailyBriefing] Generando briefing diario...');
      const userName = sock.user?.name || '';
      const message = await generateBriefing({ userName });
      await sock.sendMessage(jid, { text: PREFIX + message });
      console.log('[DailyBriefing] Briefing enviado exitosamente');
    } catch (err) {
      console.error('[DailyBriefing] Error enviando briefing:', err.message);
    }
  }, { timezone });
}

/**
 * Envia un briefing bajo demanda.
 * @param {object} sock - Socket de Baileys
 * @param {string} jid - Chat ID
 */
async function sendBriefingNow(sock, jid) {
  const userName = sock.user?.name || '';
  const message = await generateBriefing({ userName });
  await sock.sendMessage(jid, { text: PREFIX + message });
}

module.exports = {
  startScheduler,
  setScheduleTime,
  setEnabled,
  isEnabled,
  getScheduleTime,
  sendBriefingNow,
};
