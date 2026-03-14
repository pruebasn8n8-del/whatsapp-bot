// Gastos/src/pdfScheduler.js — envío automático del reporte PDF los días 15 y último del mes

const cron = require('node-cron');
const { getAllGastosUsers } = require('../../src/gastosDb');
const { setCurrentSpreadsheetId } = require('./sheets/sheetsClient');
const { buildMonthlyReportHtml } = require('./reportBuilder');
const { generatePdf } = require('../../Groqbot/src/screenshotService');

const PREFIX = '\u200B';

/**
 * Inicia el scheduler que envía el reporte PDF el día 15 y el último día de cada mes a las 8am.
 * @param {object} sock - Socket de Baileys
 */
function startPdfScheduler(sock) {
  const tz = process.env.TIMEZONE || 'America/Bogota';

  // Día 15 fijo a las 8am
  cron.schedule('0 8 15 * *', () => _sendReportsToAll(sock, 'quincena'), { timezone: tz });

  // Días 28-31 a las 8am — verificamos si es el último día del mes
  cron.schedule('0 8 28-31 * *', () => {
    const { DateTime } = require('luxon');
    const now = DateTime.now().setZone(tz);
    if (now.day === now.daysInMonth) {
      _sendReportsToAll(sock, 'cierre_mes');
    }
  }, { timezone: tz });

  console.log('[PdfScheduler] Iniciado — reportes el día 15 y último del mes a las 8:00 AM');
}

async function _sendReportsToAll(sock, motivo) {
  console.log(`[PdfScheduler] Enviando reportes (${motivo})...`);

  let users = [];
  try {
    users = await getAllGastosUsers();
  } catch (err) {
    console.error('[PdfScheduler] Error obteniendo usuarios:', err.message);
    return;
  }

  for (const user of users) {
    const gastos = user.gastos_data;
    if (!gastos || !gastos.sheet_id) continue;

    try {
      setCurrentSpreadsheetId(gastos.sheet_id);
      const { html, tabName } = await buildMonthlyReportHtml();
      const pdfBuffer = await generatePdf(html);
      if (!pdfBuffer) {
        console.warn(`[PdfScheduler] PDF vacío para ${user.jid}, saltando`);
        continue;
      }

      const mesSlug = tabName.toLowerCase().replace(/\s+/g, '_');
      const label = motivo === 'cierre_mes' ? 'cierre de mes' : 'corte quincenal';

      await sock.sendMessage(user.jid, {
        text: PREFIX + `📊 *Reporte de ${label}*\nTe envío el resumen de gastos de *${tabName}*. Un momento...`,
      });
      await sock.sendMessage(user.jid, {
        document: pdfBuffer,
        mimetype: 'application/pdf',
        fileName: `gastos_${mesSlug}.pdf`,
        caption: PREFIX + `📄 *Reporte de Gastos — ${tabName}*\n_${label.charAt(0).toUpperCase() + label.slice(1)} · Cortana_`,
      });

      console.log(`[PdfScheduler] Reporte enviado a ${user.jid}`);
    } catch (err) {
      console.error(`[PdfScheduler] Error procesando ${user.jid}:`, err.message);
    }
  }
}

module.exports = { startPdfScheduler };
