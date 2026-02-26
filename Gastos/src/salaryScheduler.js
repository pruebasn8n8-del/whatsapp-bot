// Gastos/src/salaryScheduler.js - Scheduler de pago automático de salario

const cron = require('node-cron');
const { getAllGastosUsers } = require('../../src/gastosDb');
const { setCurrentSpreadsheetId } = require('./sheets/sheetsClient');
const { getAllConfig, setConfig } = require('./sheets/configManager');
const { formatCOP } = require('./utils/formatCurrency');

const PREFIX = '\u200B';

/**
 * Inicia el scheduler que verifica diariamente si es día de pago de algún usuario.
 * Se ejecuta todos los días a las 8:00 AM.
 * @param {object} sock - Socket de Baileys
 */
function startSalaryScheduler(sock) {
  const tz = process.env.TIMEZONE || 'America/Bogota';

  cron.schedule('0 8 * * *', async () => {
    await _checkAndSendSalaries(sock);
  }, { timezone: tz });

  console.log('[SalaryScheduler] Iniciado - verificación diaria a las 8:00 AM');
}

async function _checkAndSendSalaries(sock) {
  const { DateTime } = require('luxon');
  const now = DateTime.now().setZone(process.env.TIMEZONE || 'America/Bogota');
  const today = now.day;
  const daysInMonth = now.daysInMonth;

  console.log(`[SalaryScheduler] Verificando días de pago para día ${today}...`);

  let users = [];
  try {
    users = await getAllGastosUsers();
  } catch (err) {
    console.error('[SalaryScheduler] Error obteniendo usuarios:', err.message);
    return;
  }

  for (const user of users) {
    const gastos = user.gastos_data;
    if (!gastos || !gastos.sheet_id) continue;

    const payday = gastos.config?.payday || [];
    if (!payday.length) continue;

    // Check if today is a payday (handle "30" as last day of month)
    const isPayday = payday.some(d => {
      if (d === 30 && today === daysInMonth) return true; // Fin de mes
      return d === today;
    });

    if (!isPayday) continue;

    const salary = gastos.config?.salary;
    if (!salary) continue;

    console.log(`[SalaryScheduler] Día de pago para ${user.jid} - ${formatCOP(salary)}`);

    try {
      // Set their spreadsheet as current
      setCurrentSpreadsheetId(gastos.sheet_id);

      // Read current balance from their sheet
      const cfg = await getAllConfig();
      const currentBalance = parseFloat(cfg['Saldo Inicial'] || 0);
      const newBalance = currentBalance + salary;

      // Update balance in sheet
      await setConfig('Saldo Inicial', newBalance);
      await setConfig('Ultimo Pago', now.toISODate());

      // Send notification
      const freq = { monthly: 'mensual', biweekly: 'quincenal', weekly: 'semanal' };
      const freqLabel = freq[gastos.config?.salary_frequency] || 'mensual';

      await sock.sendMessage(user.jid, {
        text: PREFIX + [
          `💸 *¡Llegó tu pago ${freqLabel}!*`,
          '',
          `Ingreso: *${formatCOP(salary)}*`,
          `Saldo anterior: ${formatCOP(currentBalance)}`,
          `Nuevo saldo: *${formatCOP(newBalance)}*`,
          '',
          '_Recuerda registrar tus gastos del día._',
          '_/gastos → activar bot de finanzas_',
        ].join('\n'),
      });

      console.log(`[SalaryScheduler] Notificación enviada a ${user.jid}`);
    } catch (err) {
      console.error(`[SalaryScheduler] Error procesando ${user.jid}:`, err.message);
    }
  }
}

module.exports = { startSalaryScheduler };
