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
  try {
    setCurrentSpreadsheetId(spreadsheetId);

    const jid = msg.key.remoteJid;
    const text = getMessageText(msg);
    if (!text || text.startsWith('\u200B') || text.startsWith('\u2713') || text.startsWith('\u2753') || text.startsWith('\uD83D\uDCCB') || text.startsWith('\uD83D\uDDD1') || text.startsWith('\u270F') || text.startsWith('\uD83D\uDCCA') || text.startsWith('\u2699') || text.startsWith('\uD83D\uDCB0')) return;

    const chatId = jid;
    const textLower = text.trim().toLowerCase();

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

    // --- Command: force dashboard update ---
    if (textLower === 'actualizar' || textLower === 'update') {
      await _reply(sock, jid, msg, 'Actualizando dashboard y hojas...');
      try {
        await updateDashboard();
        await _reply(sock, jid, msg, 'Dashboard, Ahorros y graficos actualizados correctamente.');
      } catch (err) {
        await _reply(sock, jid, msg, `Error al actualizar: ${err.message}`);
      }
      return;
    }

    // --- Command: financial summary ---
    if (textLower === 'resumen' || textLower === 'resumen financiero') {
      const summary = await getFinancialSummary();
      await _reply(sock, jid, msg, summary);
      return;
    }

    // --- Command: view config ---
    if (['config', 'ver config', 'configuracion', 'configuración', 'ver configuracion', 'ver configuración'].includes(textLower)) {
      const cfg = await getAllConfig();
      const tipoBase = cfg['Tipo Base'] || 'No configurado';
      const salario = cfg['Salario'] ? formatCOP(cfg['Salario']) : 'No configurado';
      const saldoVal = cfg['Saldo Inicial'] ? formatCOP(cfg['Saldo Inicial']) : 'No configurado';
      const meta = cfg['Meta Ahorro Mensual'] ? formatCOP(cfg['Meta Ahorro Mensual']) : 'No configurada';
      const base = tipoBase === 'saldo' ? 'Saldo bancario' : tipoBase === 'salario' ? 'Salario' : 'No configurado';

      const divider = '─'.repeat(25);
      await _reply(sock, jid, msg,
        `*Configuracion*\n${divider}\n\n` +
        `  Salario:  ${salario}\n` +
        `  Saldo Inicial:  ${saldoVal}\n` +
        `  Base de calculo:  ${base}\n` +
        `  Meta de Ahorro:  ${meta}\n\n` +
        `${divider}\n` +
        `*Comandos:*\n` +
        `  salario _5M_\n` +
        `  saldo _2.5M_\n` +
        `  meta ahorro _1M_\n` +
        `  resumen  -  Analisis completo\n` +
        `  /stop  -  Desactivar bot`
      );
      return;
    }

    // --- Command: view accounts / balance ---
    if (['cuentas', 'ver cuentas', 'mis cuentas', 'saldo', 'ver saldo', 'balance'].includes(textLower)) {
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
    const verGastosSimple = (textLower === 'ver gastos' || textLower === 'gastos' || textLower === 'ver');
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

    // --- Handle pending edit response ---
    const pendingEdit = pendingEdits.get(chatId);
    if (pendingEdit) {
      const descMatch = text.trim().match(/^desc\s+(.+)$/i);
      const montoMatch = text.trim().match(/^monto\s+(.+)$/i);
      const catMatch = text.trim().match(/^cat\s+(\d+)$/i);

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
  }
}

async function _reply(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text: PREFIX + text }, { quoted: msg });
}

module.exports = { handleGastosMessage };
