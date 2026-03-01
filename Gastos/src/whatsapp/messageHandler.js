const { parseExpense } = require('../parser/expenseParser');
const { categorize } = require('../categories/categorizer');
const { categories } = require('../categories/categoryMap');
const { saveLearnedCategory } = require('../categories/learnedCategories');
const { writeExpense } = require('../sheets/expenseWriter');
const { getRecentExpenses, deleteExpense, editExpense } = require('../sheets/expenseReader');
const { setConfig, getAllConfig } = require('../sheets/configManager');
const { setCurrentSpreadsheetId } = require('../sheets/sheetsClient');
const { getFinancialSummary } = require('../sheets/financialSummary');
const { updateDashboard } = require('../sheets/dashboardUpdater');
const { parseAmount } = require('../parser/amountParser');
const { formatCOP } = require('../utils/formatCurrency');
const { now, getMonthTabName, parseMonthInput } = require('../utils/dateUtils');
const logger = require('../utils/logger');
const { getMessageText, getInteractiveResponse, sendListMessage } = require('../../../src/messageUtils');

const PREFIX = '\u200B';
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// chatId -> { description, amount, parsed, targetMonth, sock, jid, timer }
const pendingCategories = new Map();

// chatId -> { expenses: [...], tabName: string } - last viewed list for deletion/editing
const lastViewedExpenses = new Map();

// chatId -> { expense, tabName, timer } - pending edit waiting for user input
const pendingEdits = new Map();

// chatId -> { type, params, timer } - acción NL esperando confirmación del usuario
const pendingConfirmations = new Map();

const CONFIRM_YES = /^(sí|si|yes|ok|dale|listo|confirmo|confirmar|correcto|claro|adelante|hazlo|procede|venga|va|afirmativo)$/i;
const CONFIRM_NO  = /^(no|cancelar|cancela|cancel|nope|para|stop|olvida|olvídalo|mejor\s+no|negativo)$/i;

function _setPendingConf(chatId, data, sock, jid) {
  const prev = pendingConfirmations.get(chatId);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => pendingConfirmations.delete(chatId), TIMEOUT_MS);
  pendingConfirmations.set(chatId, { ...data, timer, sock, jid });
}

const categoryMenu = categories
  .map((cat, i) => `${i + 1}. ${cat.name}`)
  .join('\n');

/**
 * Extrae un sufijo de mes entre corchetes del texto: "Almuerzo 25k [enero]"
 * @returns {{ cleanText: string, targetMonth: string|null }}
 */
function extractMonthSuffix(text) {
  const bracketMatch = text.match(/\[([^\]]+)\]\s*$/);
  if (!bracketMatch) return { cleanText: text, targetMonth: null };

  const parsed = parseMonthInput(bracketMatch[1].trim());
  if (!parsed) return { cleanText: text, targetMonth: null };

  const cleanText = text.replace(/\[[^\]]+\]\s*$/, '').trim();
  return { cleanText, targetMonth: parsed.tabName };
}

/**
 * Procesa un mensaje individual con el bot de Gastos.
 * @param {object} msg - Mensaje de Baileys
 * @param {object} sock - Socket de Baileys
 * @param {string|null} spreadsheetId - ID del spreadsheet del usuario
 */
async function handleGastosMessage(msg, sock, spreadsheetId) {
  const jid = msg.key.remoteJid;
  try {
    setCurrentSpreadsheetId(spreadsheetId);

    const text = getMessageText(msg);
    if (!text || text.startsWith('\u200B') || text.startsWith('\u2713') || text.startsWith('\u2753') || text.startsWith('\uD83D\uDCCB') || text.startsWith('\uD83D\uDDD1') || text.startsWith('\u270F') || text.startsWith('\uD83D\uDCCA') || text.startsWith('\u2699') || text.startsWith('\uD83D\uDCB0')) return;

    const chatId = jid;
    const textLower = text.trim().toLowerCase();

    // === CONFIRMACIONES PENDIENTES (lenguaje natural) ===
    const pendingConf = pendingConfirmations.get(chatId);
    if (pendingConf) {
      if (CONFIRM_YES.test(textLower.trim())) {
        clearTimeout(pendingConf.timer);
        pendingConfirmations.delete(chatId);
        try {
          if (pendingConf.type === 'delete') {
            await deleteExpense(pendingConf.expense.rowNumber, pendingConf.tabName);
            lastViewedExpenses.delete(chatId);
            await _reply(sock, jid, msg,
              `Eliminado: *${pendingConf.expense.descripcion}* — ${formatCOP(pendingConf.expense.monto)} [${pendingConf.expense.categoria}]\n\n_Escribe "ver gastos" para ver la lista actualizada._`
            );
          } else if (pendingConf.type === 'edit_start') {
            const { expense, tabName, num } = pendingConf;
            const prev = pendingEdits.get(chatId);
            if (prev) clearTimeout(prev.timer);
            const timer = setTimeout(() => pendingEdits.delete(chatId), TIMEOUT_MS);
            pendingEdits.set(chatId, { expense, tabName, timer });
            await _reply(sock, jid, msg,
              `*Editando gasto #${num}:*\n\n` +
              `Descripcion: ${expense.descripcion}\n` +
              `Monto: ${formatCOP(expense.monto)}\n` +
              `Categoria: ${expense.categoria}\n\n` +
              `¿Qué quieres cambiar?\n` +
              `- *desc* NuevoNombre\n` +
              `- *monto* 25000\n` +
              `- *cat* numero (1-${categories.length})\n\n` +
              `${categoryMenu}`
            );
          } else if (pendingConf.type === 'set_salary') {
            await setConfig('Salario', pendingConf.amount);
            await setConfig('Tipo Base', 'salario');
            try { await updateDashboard(); } catch (_) {}
            await _reply(sock, jid, msg, `Salario configurado: *${formatCOP(pendingConf.amount)}*`);
          } else if (pendingConf.type === 'set_balance') {
            await setConfig('Saldo Inicial', pendingConf.amount);
            await setConfig('Tipo Base', 'saldo');
            try { await updateDashboard(); } catch (_) {}
            await _reply(sock, jid, msg, `Saldo configurado: *${formatCOP(pendingConf.amount)}*`);
          } else if (pendingConf.type === 'set_goal') {
            await setConfig('Meta Ahorro Mensual', pendingConf.amount);
            try { await updateDashboard(); } catch (_) {}
            await _reply(sock, jid, msg, `Meta de ahorro configurada: *${formatCOP(pendingConf.amount)}* mensual`);
          }
        } catch (e) {
          await _reply(sock, jid, msg, 'Error ejecutando la acción: ' + e.message.substring(0, 80));
        }
        return;
      }
      if (CONFIRM_NO.test(textLower.trim())) {
        clearTimeout(pendingConf.timer);
        pendingConfirmations.delete(chatId);
        await _reply(sock, jid, msg, 'Cancelado.');
        return;
      }
      // No es sí/no → limpiar y procesar el mensaje normalmente
      clearTimeout(pendingConf.timer);
      pendingConfirmations.delete(chatId);
    }

    // --- Command: set salary ---
    const salarioMatch = textLower.match(/^salario\s+(.+)$/);
    if (salarioMatch) {
      const amount = parseAmount(salarioMatch[1].trim());
      if (!amount) {
        await _reply(sock, jid, msg, 'Monto invalido. Ejemplo: *salario 5M* o *salario 5.000.000*');
        return;
      }
      await setConfig('Salario', amount);
      await setConfig('Tipo Base', 'salario');
      try { await updateDashboard(); } catch (e) {}
      await _reply(sock, jid, msg, `Salario configurado: ${formatCOP(amount)}\n\nEl dashboard se calculara respecto a tu salario.`);
      return;
    }

    // --- Command: set balance ---
    const saldoMatch = textLower.match(/^saldo\s+(.+)$/);
    if (saldoMatch) {
      const amount = parseAmount(saldoMatch[1].trim());
      if (!amount) {
        await _reply(sock, jid, msg, 'Monto invalido. Ejemplo: *saldo 2.5M* o *saldo 2.500.000*');
        return;
      }
      await setConfig('Saldo Inicial', amount);
      await setConfig('Tipo Base', 'saldo');
      try { await updateDashboard(); } catch (e) {}
      await _reply(sock, jid, msg, `Saldo inicial configurado: ${formatCOP(amount)}\n\nEl dashboard se calculara respecto a tu saldo.`);
      return;
    }

    // --- Command: set savings goal ---
    const metaMatch = textLower.match(/^meta\s+ahorro\s+(.+)$/);
    if (metaMatch) {
      const amount = parseAmount(metaMatch[1].trim());
      if (!amount) {
        await _reply(sock, jid, msg, 'Monto invalido. Ejemplo: *meta ahorro 1M* o *meta ahorro 1.000.000*');
        return;
      }
      await setConfig('Meta Ahorro Mensual', amount);
      try { await updateDashboard(); } catch (e) {}
      await _reply(sock, jid, msg, `Meta de ahorro configurada: ${formatCOP(amount)} mensual`);
      return;
    }

    // --- Command: help / command list ---
    if (textLower === '/ayuda' || textLower === '/comandos' || textLower === 'ayuda' || textLower === 'comandos') {
      const divider = '─'.repeat(25);
      await _reply(sock, jid, msg,
        `*📋 Comandos disponibles*\n${divider}\n\n` +
        `*💸 Registrar gasto*\n` +
        `  _Escribe cualquier gasto con monto_\n` +
        `  Ej: "Almuerzo 15k" · "Netflix 50000"\n` +
        `  Añade [mes] al final para otro mes\n` +
        `  Ej: "Taxi 25k [enero]"\n\n` +
        `*📊 Ver gastos*\n` +
        `  ver gastos — últimos 10 de este mes\n` +
        `  ver gastos [mes] — ej: ver gastos [enero]\n\n` +
        `*✏️ Editar / borrar*\n` +
        `  editar X — editar gasto #X de la lista\n` +
        `  borrar X — eliminar gasto #X de la lista\n\n` +
        `*📈 Resumen y saldos*\n` +
        `  resumen — análisis financiero completo\n` +
        `  cuentas — ver saldos y cuentas\n` +
        `  config — ver configuración actual\n\n` +
        `*⚙️ Configurar*\n` +
        `  salario 5M — establecer salario mensual\n` +
        `  saldo 2.5M — establecer saldo bancario\n` +
        `  meta ahorro 1M — meta de ahorro mensual\n\n` +
        `*🔄 Actualizar hojas*\n` +
        `  /actualizar — regenera Configuración, Resumen y Ahorros\n\n` +
        `*🚪 Salir*\n` +
        `  /salir · /stop — desactivar bot de gastos\n` +
        `  /resetgastos — reiniciar onboarding desde cero\n\n` +
        `${divider}\n_Montos: 15k = 15.000 · 2.5M = 2.500.000_`
      );
      return;
    }

    // --- Command: force dashboard + config + resumen update ---
    if (textLower === '/actualizar' || textLower === '/update') {
      await _reply(sock, jid, msg, '⏳ Actualizando todas las hojas...');
      const errors = [];
      // Reformatear Config y Resumen con datos del perfil
      try {
        const { getGastosData } = require('../../../src/gastosDb');
        const { writeInitialConfigLayout } = require('../sheets/configManager');
        const { initResumenSheet } = require('../sheets/dashboardUpdater');
        const { writeSavingsTab } = require('../sheets/savingsCalculator');
        const gastosData = await getGastosData(jid);
        const data = gastosData.config || {};
        await writeInitialConfigLayout(data);
        await initResumenSheet(data);
        await writeSavingsTab();
      } catch (e) { errors.push('perfil: ' + e.message.substring(0, 60)); }
      // Dashboard con gastos del mes
      try { await updateDashboard(); } catch (e) { errors.push('dashboard: ' + e.message.substring(0, 60)); }
      if (errors.length) {
        await _reply(sock, jid, msg, `✅ Hojas actualizadas (con algunos avisos):\n${errors.map(e => '• ' + e).join('\n')}`);
      } else {
        await _reply(sock, jid, msg, '✅ Configuración, Resumen, Ahorros y Dashboard actualizados.');
      }
      return;
    }

    // --- Command: financial summary ---
    if (/^(resumen|resumen\s+financiero?)$/.test(textLower) ||
        /\b(dame\s+(el\s+)?resumen|cu[aá]nto\s+he\s+gastado|c[oó]mo\s+van\s+(mis\s+)?gastos|mis\s+gastos\s+del\s+mes|an[aá]lisis\s+financiero?|informe\s+financiero?|ver\s+resumen|muestra\s+(el\s+)?resumen)\b/i.test(textLower)) {
      const summary = await getFinancialSummary();
      await _reply(sock, jid, msg, summary);
      return;
    }

    // --- Command: view config ---
    if (/^(config|configuraci[oó]n|ver\s+config(uraci[oó]n)?)$/.test(textLower) ||
        /\b(mi\s+config(uraci[oó]n)?|qu[eé]\s+tengo\s+configurado|ver\s+mi\s+configuraci[oó]n|mostrar\s+configuraci[oó]n)\b/i.test(textLower)) {
      const cfg = await getAllConfig();
      const tipoBase = cfg['Tipo Base'] || 'No configurado';
      const _fmtCfg = (v, fallback) => { const n = parseFloat(v); return !isNaN(n) && n > 0 ? formatCOP(n) : fallback; };
      const salario = _fmtCfg(cfg['Salario'], 'No configurado');
      const saldoVal = _fmtCfg(cfg['Saldo Inicial'], 'No configurado');
      const meta = _fmtCfg(cfg['Meta Ahorro Mensual'], 'No configurada');
      const base = tipoBase === 'saldo' ? 'Saldo bancario' : tipoBase === 'salario' ? 'Salario' : 'No configurado';

      const divider = '─'.repeat(25);
      const nothingConfigured = salario === 'No configurado' && saldoVal === 'No configurado' && meta === 'No configurada';

      if (nothingConfigured) {
        await _reply(sock, jid, msg,
          `*Configuracion*\n${divider}\n\n` +
          `  Salario:  No configurado\n` +
          `  Saldo Inicial:  No configurado\n` +
          `  Meta de Ahorro:  No configurada\n\n` +
          `${divider}\n` +
          `_Aún no has configurado tus valores financieros._\n\n` +
          `Puedes configurarlos directamente:\n` +
          `  • _salario 5M_ — salario mensual\n` +
          `  • _saldo 2.5M_ — saldo bancario actual\n` +
          `  • _meta ahorro 500k_ — meta de ahorro mensual\n\n` +
          `O escribe */resetgastos* para reconfigurar todo desde cero.`
        );
      } else {
        await _reply(sock, jid, msg,
          `*Configuracion*\n${divider}\n\n` +
          `  Salario:  ${salario}\n` +
          `  Saldo Inicial:  ${saldoVal}\n` +
          `  Base de calculo:  ${base}\n` +
          `  Meta de Ahorro:  ${meta}\n\n` +
          `${divider}\n` +
          `Escribe */ayuda* para ver todos los comandos`
        );
      }
      return;
    }

    // --- Command: view accounts / balance ---
    if (/^(cuentas|ver\s+cuentas|mis\s+cuentas|saldo|ver\s+saldo|balance)$/.test(textLower) ||
        /\b(cu[aá]nto\s+tengo|mis\s+saldos|ver\s+mis\s+cuentas|estado\s+(de\s+)?(mis\s+)?cuentas|mis\s+finanzas|ver\s+balance)\b/i.test(textLower)) {
      const cfg = await getAllConfig();
      const lines = ['💰 *Estado de cuentas*\n'];
      let totalBalance = 0;

      if (cfg['Cuentas']) {
        try {
          const accounts = JSON.parse(cfg['Cuentas']);
          accounts.forEach(a => {
            lines.push(`🏦 *${a.name}:* ${formatCOP(a.balance)}`);
            totalBalance += a.balance;
          });
          lines.push(`\n*Total:* ${formatCOP(totalBalance)}`);
        } catch (_) {
          if (cfg['Saldo Inicial']) lines.push(`💵 Saldo: ${formatCOP(cfg['Saldo Inicial'])}`);
        }
      } else if (cfg['Saldo Inicial']) {
        lines.push(`💵 Saldo: ${formatCOP(cfg['Saldo Inicial'])}`);
      } else {
        lines.push('_No hay cuentas registradas._');
        lines.push('_Usa_ *saldo 2.5M* _para configurar tu saldo._');
      }

      if (cfg['Criptomonedas']) {
        try {
          const crypto = JSON.parse(cfg['Criptomonedas']);
          if (crypto.length > 0) {
            lines.push('\n₿ *Criptomonedas:*');
            crypto.forEach(c => lines.push(`  • ${c.amount} ${c.symbol}`));
          }
        } catch (_) {}
      }

      if (cfg['Divisas']) {
        try {
          const fx = JSON.parse(cfg['Divisas']);
          if (fx.length > 0) {
            lines.push('\n💱 *Divisas:*');
            fx.forEach(f => lines.push(`  • ${f.amount} ${f.currency}`));
          }
        } catch (_) {}
      }

      await _reply(sock, jid, msg, lines.join('\n'));
      return;
    }

    // --- Command: view expenses (with optional month) ---
    // Supports: "ver gastos", "gastos", "ver", "ver gastos [enero]", "ver gastos enero 2025"
    const verGastosSimple = (
      textLower === 'ver gastos' || textLower === 'gastos' || textLower === 'ver' ||
      /\b(mis\s+gastos|[uú]ltimos\s+gastos|lista\s+(de\s+)?gastos|qu[eé]\s+he\s+gastado|ver\s+mis\s+gastos|mostrar\s+gastos)\b/i.test(textLower)
    );
    const verGastosConMes = !verGastosSimple && textLower.match(/^ver gastos\s+(.+)$/);

    if (verGastosSimple || verGastosConMes) {
      let targetTabName = null;
      let mesLabel = 'este mes';

      if (verGastosConMes) {
        const monthArg = verGastosConMes[1].replace(/[\[\]()]/g, '').trim();
        const parsed = parseMonthInput(monthArg);
        if (parsed) {
          targetTabName = parsed.tabName;
          mesLabel = parsed.tabName;
        }
      }

      const expenses = await getRecentExpenses(10, targetTabName);
      if (expenses.length === 0) {
        await _reply(sock, jid, msg, `No hay gastos registrados en *${mesLabel}*.\n\n_Usa [mes] para ver otro mes. Ej: ver gastos [enero]_`);
        return;
      }

      lastViewedExpenses.set(chatId, { expenses, tabName: targetTabName || getMonthTabName() });

      const lines = expenses.map((e, i) => {
        return `  *${i + 1}.* ${e.descripcion}  -  ${formatCOP(e.monto)}\n      _${e.categoria} | ${e.fecha}_`;
      });
      const divider = '─'.repeat(25);

      await _reply(sock, jid, msg,
        `*Ultimos ${expenses.length} gastos - ${mesLabel}*\n${divider}\n\n${lines.join('\n\n')}\n\n${divider}\n_borrar X  |  editar X_\n_ver gastos [mes] para otro mes_`
      );
      return;
    }

    // --- Command: delete expense ---
    const deleteMatch = textLower.match(/^borrar\s+(\d+)$/);
    if (deleteMatch) {
      const num = parseInt(deleteMatch[1], 10);
      const viewed = lastViewedExpenses.get(chatId);
      const expenses = viewed?.expenses || [];

      if (!expenses.length) {
        await _reply(sock, jid, msg, 'Primero escribe "ver gastos" para ver la lista.');
        return;
      }

      if (num < 1 || num > expenses.length) {
        await _reply(sock, jid, msg, `Numero invalido. Escribe un numero entre 1 y ${expenses.length}.`);
        return;
      }

      const expense = expenses[num - 1];
      const viewedTabName = viewed?.tabName || null;

      await deleteExpense(expense.rowNumber, viewedTabName);
      lastViewedExpenses.delete(chatId);

      await _reply(sock, jid, msg,
        `Eliminado: ${expense.descripcion} - ${formatCOP(expense.monto)} [${expense.categoria}]\n\n_Escribe "ver gastos" para ver la lista actualizada_`
      );
      return;
    }

    // --- Command: edit expense (start) ---
    const editMatch = textLower.match(/^editar\s+(\d+)$/);
    if (editMatch) {
      const num = parseInt(editMatch[1], 10);
      const viewed = lastViewedExpenses.get(chatId);
      const expenses = viewed?.expenses || [];

      if (!expenses.length) {
        await _reply(sock, jid, msg, 'Primero escribe "ver gastos" para ver la lista.');
        return;
      }

      if (num < 1 || num > expenses.length) {
        await _reply(sock, jid, msg, `Numero invalido. Escribe un numero entre 1 y ${expenses.length}.`);
        return;
      }

      const expense = expenses[num - 1];
      const viewedTabName = viewed?.tabName || null;

      const prevEdit = pendingEdits.get(chatId);
      if (prevEdit) clearTimeout(prevEdit.timer);

      const timer = setTimeout(() => {
        pendingEdits.delete(chatId);
      }, TIMEOUT_MS);

      pendingEdits.set(chatId, { expense, tabName: viewedTabName, timer });

      await _reply(sock, jid, msg,
        `*Editando gasto #${num}:*\n\n` +
        `Descripcion: ${expense.descripcion}\n` +
        `Monto: ${formatCOP(expense.monto)}\n` +
        `Categoria: ${expense.categoria}\n\n` +
        `Escribe que quieres cambiar:\n` +
        `- *desc* NuevoNombre\n` +
        `- *monto* 25000\n` +
        `- *cat* numero (1-${categories.length})\n\n` +
        `${categoryMenu}`
      );
      return;
    }

    // === LENGUAJE NATURAL: Operaciones delicadas (piden confirmación) ===

    // NL delete: "borra el gasto 3", "elimina el #2", "quita el 1"
    const nlDeleteMatch = textLower.match(/\b(?:borra(?:r)?|elimin[ao](?:r)?|quita(?:r)?|suprim(?:e|ir)?|borrame)\s+(?:el\s+)?(?:gasto\s+#?\s*)?(\d+)/);
    if (nlDeleteMatch && !textLower.match(/^borrar\s+\d+$/)) {
      const num = parseInt(nlDeleteMatch[1], 10);
      const viewed = lastViewedExpenses.get(chatId);
      const expenses = viewed?.expenses || [];
      if (!expenses.length) {
        await _reply(sock, jid, msg, 'Primero dime *ver gastos* para ver la lista.');
        return;
      }
      if (num < 1 || num > expenses.length) {
        await _reply(sock, jid, msg, `El número debe ser entre 1 y ${expenses.length}.`);
        return;
      }
      const expense = expenses[num - 1];
      _setPendingConf(chatId, { type: 'delete', expense, tabName: viewed.tabName }, sock, jid);
      await _reply(sock, jid, msg,
        `⚠️ *¿Eliminar este gasto?*\n\n` +
        `*${expense.descripcion}* — ${formatCOP(expense.monto)}\n` +
        `_${expense.categoria} | ${expense.fecha}_\n\n` +
        `Responde *sí* para confirmar o *no* para cancelar.`
      );
      return;
    }

    // NL edit: "edita el gasto 1", "cambia el #2", "modifica el 3"
    const nlEditMatch = textLower.match(/\b(?:edita(?:r)?|cambia(?:r)?|modifica(?:r)?|actualiza(?:r)?)\s+(?:el\s+)?(?:gasto\s+#?\s*)?(\d+)/);
    if (nlEditMatch && !textLower.match(/^editar\s+\d+$/)) {
      const num = parseInt(nlEditMatch[1], 10);
      const viewed = lastViewedExpenses.get(chatId);
      const expenses = viewed?.expenses || [];
      if (!expenses.length) {
        await _reply(sock, jid, msg, 'Primero dime *ver gastos* para ver la lista.');
        return;
      }
      if (num < 1 || num > expenses.length) {
        await _reply(sock, jid, msg, `El número debe ser entre 1 y ${expenses.length}.`);
        return;
      }
      const expense = expenses[num - 1];
      _setPendingConf(chatId, { type: 'edit_start', expense, tabName: viewed.tabName, num }, sock, jid);
      await _reply(sock, jid, msg,
        `✏️ *¿Editar este gasto?*\n\n` +
        `*${expense.descripcion}* — ${formatCOP(expense.monto)}\n` +
        `_${expense.categoria} | ${expense.fecha}_\n\n` +
        `Responde *sí* para confirmar o *no* para cancelar.`
      );
      return;
    }

    // NL salary: "mi salario es 5M", "gano 3 millones", "devenzo 2.5M"
    const nlSalaryMatch = textLower.match(/\b(?:mi\s+salario\s+(?:es|son|ser[aá])\s+|mi\s+sueldo\s+(?:es|son|ser[aá])\s+|gano\s+|deveng[oa]\s+)(.+)/);
    if (nlSalaryMatch && !textLower.match(/^salario\s+/)) {
      const amount = parseAmount(nlSalaryMatch[1].replace(/\s*(mensual(?:es)?|al\s+mes|por\s+mes)\s*$/, '').trim());
      if (amount) {
        _setPendingConf(chatId, { type: 'set_salary', amount }, sock, jid);
        await _reply(sock, jid, msg,
          `💵 *¿Configurar salario en ${formatCOP(amount)}?*\n\nResponde *sí* para confirmar o *no* para cancelar.`
        );
        return;
      }
    }

    // NL balance: "mi saldo es 2.5M", "tengo 1M en el banco", "actualiza mi saldo a 3M"
    const nlBalanceMatch = textLower.match(/\b(?:mi\s+saldo\s+(?:es|son|ser[aá])\s+(.+)|tengo\s+(.+?)\s+en\s+(?:el\s+)?(?:banco|nequi|daviplata|efectivo|cuenta)|actualiza(?:r)?\s+(?:mi\s+)?saldo\s+(?:a|en)\s+(.+))/);
    if (nlBalanceMatch && !textLower.match(/^saldo\s+/)) {
      const amtStr = (nlBalanceMatch[1] || nlBalanceMatch[2] || nlBalanceMatch[3] || '').trim();
      const amount = parseAmount(amtStr);
      if (amount) {
        _setPendingConf(chatId, { type: 'set_balance', amount }, sock, jid);
        await _reply(sock, jid, msg,
          `🏦 *¿Actualizar saldo a ${formatCOP(amount)}?*\n\nResponde *sí* para confirmar o *no* para cancelar.`
        );
        return;
      }
    }

    // NL goal: "quiero ahorrar 500k al mes", "mi meta de ahorro es 1M"
    const nlGoalMatch = textLower.match(/\b(?:quiero\s+ahorrar\s+(.+)|mi\s+meta\s+(?:de\s+ahorro\s+)?(?:es|son|ser[aá])\s+(.+)|ponme\s+(?:una\s+)?meta\s+de\s+(.+))/);
    if (nlGoalMatch && !textLower.match(/^meta\s+ahorro\s+/)) {
      const amtStr = (nlGoalMatch[1] || nlGoalMatch[2] || nlGoalMatch[3] || '')
        .replace(/\s*(al\s+mes|mensual(?:es)?|por\s+mes)\s*$/, '').trim();
      const amount = parseAmount(amtStr);
      if (amount) {
        _setPendingConf(chatId, { type: 'set_goal', amount }, sock, jid);
        await _reply(sock, jid, msg,
          `🎯 *¿Configurar meta de ahorro en ${formatCOP(amount)} mensual?*\n\nResponde *sí* para confirmar o *no* para cancelar.`
        );
        return;
      }
    }

    // --- Handle pending edit response ---
    const pendingEdit = pendingEdits.get(chatId);
    if (pendingEdit) {
      const descMatch = text.trim().match(
        /^(?:desc\s+|(?:cambia(?:r)?\s+(?:la\s+)?(?:descripci[oó]n|nombre)(?:\s+a)?\s+)|(?:descripci[oó]n[:\s]+)|(?:nombre[:\s]+)|(?:s[eé]\s+llama(?:ba)?\s+)|(?:el\s+nombre\s+es\s+))(.+)$/i
      );
      const montoMatch = text.trim().match(
        /^(?:monto\s+|(?:en\s+realidad\s+(?:fue|cost[oó]|es)\s+)|(?:el\s+(?:precio|monto|costo)\s+(?:fue|es|era)\s+)|(?:cost[oó]\s+)|(?:monto[:\s]+)|(?:precio[:\s]+))(.+)$/i
      );
      const catMatch = text.trim().match(
        /^(?:cat\s+|(?:categor[ií]a\s+#?\s*)|(?:es\s+(?:de\s+)?(?:tipo|categor[ií]a)\s+)|(?:ponle\s+(?:la\s+)?categor[ií]a\s+))(\d+)$/i
      );

      if (descMatch) {
        const newDesc = descMatch[1].trim();
        clearTimeout(pendingEdit.timer);
        pendingEdits.delete(chatId);
        lastViewedExpenses.delete(chatId);

        await editExpense(pendingEdit.expense.rowNumber, { descripcion: newDesc }, pendingEdit.tabName);

        await _reply(sock, jid, msg,
          `Descripcion actualizada: ${pendingEdit.expense.descripcion} -> *${newDesc}*\n\n_Escribe "ver gastos" para ver la lista actualizada_`
        );
        return;
      }

      if (montoMatch) {
        const newAmount = parseAmount(montoMatch[1].trim());
        if (newAmount === null) {
          await _reply(sock, jid, msg, 'Monto invalido. Ejemplo: *monto 25000* o *monto 25k*');
          return;
        }
        clearTimeout(pendingEdit.timer);
        pendingEdits.delete(chatId);
        lastViewedExpenses.delete(chatId);

        await editExpense(pendingEdit.expense.rowNumber, { monto: newAmount }, pendingEdit.tabName);

        await _reply(sock, jid, msg,
          `Monto actualizado: ${formatCOP(pendingEdit.expense.monto)} -> *${formatCOP(newAmount)}*\n\n_Escribe "ver gastos" para ver la lista actualizada_`
        );
        return;
      }

      if (catMatch) {
        const catNum = parseInt(catMatch[1], 10);
        if (catNum < 1 || catNum > categories.length) {
          await _reply(sock, jid, msg, `Categoria invalida. Escribe un numero entre 1 y ${categories.length}.`);
          return;
        }
        const newCat = categories[catNum - 1];
        clearTimeout(pendingEdit.timer);
        pendingEdits.delete(chatId);
        lastViewedExpenses.delete(chatId);

        await editExpense(pendingEdit.expense.rowNumber, { categoria: newCat.name }, pendingEdit.tabName);

        await _reply(sock, jid, msg,
          `Categoria actualizada: ${pendingEdit.expense.categoria} -> *${newCat.name}*\n\n_Escribe "ver gastos" para ver la lista actualizada_`
        );
        return;
      }
    }

    // Check if this is a response to a pending categorization
    const pending = pendingCategories.get(chatId);
    if (pending) {
      let selectedCategory = null;

      const interactive = getInteractiveResponse(msg);
      if (interactive && interactive.id && interactive.id.startsWith('cat_')) {
        const catIndex = parseInt(interactive.id.replace('cat_', ''), 10);
        if (catIndex >= 0 && catIndex < categories.length) {
          selectedCategory = categories[catIndex];
        }
      }

      if (!selectedCategory) {
        const choice = parseInt(text.trim(), 10);
        if (choice >= 1 && choice <= categories.length) {
          selectedCategory = categories[choice - 1];
        }
      }

      if (selectedCategory) {
        clearTimeout(pending.timer);
        pendingCategories.delete(chatId);

        saveLearnedCategory(pending.description, selectedCategory.name);

        await writeExpense({
          description: pending.description,
          amount: pending.amount,
          category: selectedCategory.name,
          subcategory: pending.parsed.categoryHint || '',
          tag: pending.parsed.tag || '',
          targetMonth: pending.targetMonth || null,
        });

        const mesInfo = pending.targetMonth ? ` → _${pending.targetMonth}_` : '';
        await _reply(sock, jid, msg,
          `Registrado: ${pending.description} ${formatCOP(pending.amount)} [${selectedCategory.name}]${mesInfo} (aprendido)`
        );
        return;
      }
    }

    // --- Parse expense (with optional month suffix) ---
    const { cleanText, targetMonth } = extractMonthSuffix(text);
    const parsed = parseExpense(cleanText);
    if (!parsed) return;

    const category = categorize(parsed.description, parsed.categoryHint);

    if (category.name === 'Sin Categoría') {
      const timer = setTimeout(async () => {
        const p = pendingCategories.get(chatId);
        if (!p) return;
        pendingCategories.delete(chatId);

        await writeExpense({
          description: p.description,
          amount: p.amount,
          category: 'Sin Categoría',
          subcategory: p.parsed.categoryHint || '',
          tag: p.parsed.tag || '',
          targetMonth: p.targetMonth || null,
        });

        try {
          const mesInfo = p.targetMonth ? ` → _${p.targetMonth}_` : '';
          await sock.sendMessage(jid, {
            text: `Registrado: ${p.description} ${formatCOP(p.amount)} [Sin Categoria]${mesInfo} (sin respuesta)`
          });
        } catch (err) {
          logger.error(`Error enviando timeout reply: ${err.message}`);
        }
      }, TIMEOUT_MS);

      pendingCategories.set(chatId, {
        description: parsed.description,
        amount: parsed.amount,
        parsed,
        targetMonth,
        timer,
      });

      const catRows = categories.map((cat, i) => ({
        id: 'cat_' + i,
        title: cat.name,
      }));

      const mesInfo = targetMonth ? `\n_→ Se guardará en: ${targetMonth}_` : '';
      await sendListMessage(sock, jid,
        `*${parsed.description}*  -  ${formatCOP(parsed.amount)}${mesInfo}\n\nSelecciona la categoria:`,
        "Responde con el numero",
        "Ver categorias",
        [{ title: "Categorias", rows: catRows }]
      );
      return;
    }

    await writeExpense({
      description: parsed.description,
      amount: parsed.amount,
      category: category.name,
      subcategory: parsed.categoryHint || '',
      tag: parsed.tag || '',
      targetMonth,
    });

    const mesInfo = targetMonth ? `\n_→ Guardado en: ${targetMonth}_` : '';
    await _reply(sock, jid, msg, `*Registrado*\n${parsed.description}  -  ${formatCOP(parsed.amount)}  [${category.name}]${mesInfo}`);
  } catch (error) {
    logger.error(`Error procesando mensaje: ${error.message}`);
    // 404 = hoja eliminada o acceso revocado → reiniciar onboarding completo
    const is404 = /404|not.?found|requested.?entity/i.test(error.message);
    if (is404) {
      try {
        const { setGastosData } = require('../../../src/gastosDb');
        const { startGastosOnboarding } = require('../gastosOnboarding');
        await setGastosData(jid, { sheet_id: null, sheet_url: null, onboarding_step: null, config: {} });
        await sock.sendMessage(jid, {
          text: '\u200B⚠️ *Tu hoja de cálculo no fue encontrada* (fue eliminada o le quitaste acceso al bot).\n\nVamos a configurar una nueva desde cero 🔄',
        });
        await startGastosOnboarding(sock, jid);
      } catch (e2) {
        console.error('[GastosMessage] Error al reiniciar tras 404:', e2.message);
      }
    }
  }
}

async function _reply(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text: PREFIX + text }, { quoted: msg });
}

module.exports = { handleGastosMessage };
