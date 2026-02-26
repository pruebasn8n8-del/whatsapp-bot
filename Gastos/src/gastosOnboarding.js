// Gastos/src/gastosOnboarding.js - Onboarding conversacional para el bot de Finanzas

const { getGastosData, setGastosData } = require('../../src/gastosDb');
const { createUserSpreadsheet, setCurrentSpreadsheetId } = require('./sheets/sheetsClient');
const { setConfig } = require('./sheets/configManager');
const { formatCOP } = require('./utils/formatCurrency');

const PREFIX = '\u200B';

const GOAL_LABELS = {
  control_gastos: 'Control de gastos',
  ahorro: 'Ahorro',
  metas: 'Metas financieras',
  inversion: 'Inversión',
  presupuesto: 'Presupuesto',
};

// ==================== Mensajes de cada paso ====================

function msgGoals() {
  return [
    '¡Hola! Soy tu asistente financiero personal 💰',
    '',
    'Voy a ayudarte a tomar control de tu dinero. ¿Qué quieres lograr?',
    '',
    '1️⃣  Controlar mis gastos del día a día',
    '2️⃣  Ahorrar más dinero',
    '3️⃣  Cumplir metas de ahorro',
    '4️⃣  Llevar un registro completo de mis finanzas',
    '5️⃣  Todo lo anterior',
    '',
    '_Responde con el número o escribe lo que quieras_',
  ].join('\n');
}

function msgIncome(data) {
  const goalsText = data.goals && data.goals.length
    ? data.goals.slice(0, 3).map(g => GOAL_LABELS[g] || g).join(', ')
    : null;
  return [
    goalsText ? `¡Perfecto! Objetivos: *${goalsText}* ✓` : '¡Perfecto! 🎯',
    '',
    '¿Cuánto ganas y con qué frecuencia?',
    '',
    '• _"Gano 3 millones al mes"_',
    '• _"Me pagan 1.5M cada quincena"_',
    '• _"Recibo 800k semanal"_',
  ].join('\n');
}

function msgPayday(data) {
  const freq = { monthly: 'mensual', biweekly: 'quincenal', weekly: 'semanal', daily: 'diario' };
  const salaryText = data.salary
    ? `${formatCOP(data.salary)} ${freq[data.salary_frequency] || ''}`
    : 'registrado';
  return [
    `Ingresos: *${salaryText}* ✓`,
    '',
    '¿Qué día(s) del mes te pagan?',
    '',
    '• _"El día 30"_',
    '• _"Los días 15 y 30"_ (quincena)',
    '• _"El último día del mes"_',
    '• _"Los viernes"_ (semanal)',
  ].join('\n');
}

function msgAccounts() {
  return [
    '¿Cuánto tienes actualmente en tus cuentas?',
    '',
    '• _"Tengo 500k en Nequi y 2M en Bancolombia"_',
    '• _"Tengo como 1.5 millones en total"_',
    '• _"No tengo nada ahora"_',
  ].join('\n');
}

function msgCrypto(data) {
  const total = (data.accounts || []).reduce((s, a) => s + (a.balance || 0), 0);
  const accountsText = total > 0 ? `Cuentas: *${formatCOP(total)}* ✓` : 'Sin cuentas registradas ✓';
  return [
    accountsText,
    '',
    '¿Tienes ahorros en criptomonedas o divisas extranjeras?',
    '',
    '• _"Tengo 0.05 BTC y 200 dólares"_',
    '• _"Tengo 0.5 ETH en Binance"_',
    '• _"No tengo"_',
  ].join('\n');
}

function msgSavingsGoal() {
  return [
    '¡Casi terminamos! 🚀',
    '',
    '¿Cuánto quieres ahorrar cada mes?',
    '',
    '• _"300k al mes"_',
    '• _"El 20% de lo que gano"_',
    '• _"Sin meta por ahora"_',
  ].join('\n');
}

function msgConfirm(data) {
  const lines = ['📋 *Resumen de tu perfil financiero*\n'];

  if (data.goals && data.goals.length) {
    lines.push('🎯 *Objetivos:* ' + data.goals.map(g => GOAL_LABELS[g] || g).join(', '));
  }

  if (data.salary) {
    const freq = { monthly: 'mensual', biweekly: 'quincenal', weekly: 'semanal', daily: 'diario' };
    lines.push(`💵 *Ingresos:* ${formatCOP(data.salary)} ${freq[data.salary_frequency] || data.salary_frequency}`);
  }

  if (data.payday && data.payday.length) {
    lines.push(`📅 *Día de pago:* ${data.payday.map(d => 'día ' + d).join(' y ')}`);
  }

  if (data.accounts && data.accounts.length > 0) {
    const total = data.accounts.reduce((s, a) => s + (a.balance || 0), 0);
    lines.push(`🏦 *Cuentas:* ${formatCOP(total)} total`);
    data.accounts.forEach(a => lines.push(`   • ${a.name}: ${formatCOP(a.balance)}`));
  }

  if (data.crypto && data.crypto.length > 0) {
    lines.push(`₿ *Cripto:* ${data.crypto.map(c => `${c.amount} ${c.symbol}`).join(', ')}`);
  }

  if (data.fx_holdings && data.fx_holdings.length > 0) {
    lines.push(`💱 *Divisas:* ${data.fx_holdings.map(f => `${f.amount} ${f.currency}`).join(', ')}`);
  }

  lines.push(`💰 *Meta de ahorro:* ${data.savings_goal ? formatCOP(data.savings_goal) + '/mes' : 'Sin meta'}`);

  lines.push('');
  lines.push('¿Todo correcto? Escribe *sí* para crear tu hoja.');
  lines.push('O dime qué está mal y lo corrijo sin empezar de nuevo:');
  lines.push('_Ej: "la meta es 100k" | "el salario es 3M" | "no tengo cuentas"_');
  lines.push('_Escribe *reiniciar* para empezar desde cero._');

  return lines.join('\n');
}

// ==================== Flow principal ====================

async function startGastosOnboarding(sock, jid) {
  await setGastosData(jid, { onboarding_step: 'goals', onboarding_data: {} });
  await sock.sendMessage(jid, { text: PREFIX + msgGoals() });
}

async function handleGastosOnboardingStep(sock, jid, text, groqService) {
  const gastos = await getGastosData(jid);
  const step = gastos.onboarding_step;
  if (!step || step === 'complete') return false;

  const data = gastos.onboarding_data || {};

  try {
    switch (step) {
      case 'goals': {
        const parsed = await _parseGoals(text, groqService);
        const newData = { ...data, goals: parsed.goals || ['control_gastos'] };
        await setGastosData(jid, { onboarding_step: 'income', onboarding_data: newData });
        await sock.sendMessage(jid, { text: PREFIX + msgIncome(newData) });
        return false;
      }

      case 'income': {
        const parsed = await _parseIncome(text, groqService);
        if (!parsed.amount) {
          await sock.sendMessage(jid, {
            text: PREFIX + 'No pude entender el monto 😅 Intenta así: _"Gano 3 millones al mes"_ o _"2.1M mensual"_',
          });
          return false;
        }
        const newData = { ...data, salary: parsed.amount, salary_frequency: parsed.frequency || 'monthly' };
        await setGastosData(jid, { onboarding_step: 'payday', onboarding_data: newData });
        await sock.sendMessage(jid, { text: PREFIX + msgPayday(newData) });
        return false;
      }

      case 'payday': {
        const parsed = await _parsePayday(text, groqService);
        const newData = { ...data, payday: parsed.days || [] };
        await setGastosData(jid, { onboarding_step: 'accounts', onboarding_data: newData });
        await sock.sendMessage(jid, { text: PREFIX + msgAccounts() });
        return false;
      }

      case 'accounts': {
        const parsed = await _parseAccounts(text, groqService);
        const newData = { ...data, accounts: parsed.accounts || [] };
        await setGastosData(jid, { onboarding_step: 'crypto', onboarding_data: newData });
        await sock.sendMessage(jid, { text: PREFIX + msgCrypto(newData) });
        return false;
      }

      case 'crypto': {
        const parsed = await _parseCrypto(text, groqService);
        const newData = { ...data, crypto: parsed.crypto || [], fx_holdings: parsed.fx || [] };
        await setGastosData(jid, { onboarding_step: 'savings_goal', onboarding_data: newData });
        await sock.sendMessage(jid, { text: PREFIX + msgSavingsGoal() });
        return false;
      }

      case 'savings_goal': {
        const parsed = await _parseSavingsGoal(text, data, groqService);
        const newData = { ...data, savings_goal: parsed.amount || null };
        await setGastosData(jid, { onboarding_step: 'confirm', onboarding_data: newData });
        await sock.sendMessage(jid, { text: PREFIX + msgConfirm(newData) });
        return false;
      }

      case 'confirm': {
        const tl = text.trim().toLowerCase();

        const isYes = ['sí', 'si', 'yes', 'ok', 'listo', 'perfecto', 'claro', 'correcto', 'dale', 'va', 'confirmado', 'todo bien', 'esta bien', 'está bien'].some(w => tl.includes(w));
        const isRestart = ['reiniciar', 'empezar de nuevo', 'desde cero', 'reset', 'volver a empezar'].some(w => tl.includes(w));

        if (isRestart) {
          await setGastosData(jid, { onboarding_step: 'goals', onboarding_data: {} });
          await sock.sendMessage(jid, { text: PREFIX + '🔄 Empezando desde cero!\n\n' + msgGoals() });
          return false;
        }

        if (isYes) {
          await sock.sendMessage(jid, { text: PREFIX + '⏳ Creando tu hoja de cálculo personal...' });
          const success = await _completeOnboarding(sock, jid, data);
          return success;
        }

        // Intentar parsear como corrección puntual
        const correction = await _parseCorrection(text, data, groqService);
        if (correction.field && correction.value !== null && correction.value !== undefined) {
          let newData;
          // Para accounts y crypto, el valor es un array
          if (correction.field === 'accounts' || correction.field === 'crypto' || correction.field === 'fx_holdings') {
            newData = { ...data, [correction.field]: correction.value };
          } else {
            newData = { ...data, [correction.field]: correction.value };
          }
          await setGastosData(jid, { onboarding_step: 'confirm', onboarding_data: newData });
          const fieldNames = {
            goals: 'Objetivos', salary: 'Ingresos', payday: 'Día de pago',
            accounts: 'Cuentas', crypto: 'Criptomonedas', fx_holdings: 'Divisas',
            savings_goal: 'Meta de ahorro',
          };
          await sock.sendMessage(jid, {
            text: PREFIX + `✅ *${fieldNames[correction.field] || correction.field}* actualizado.\n\n${msgConfirm(newData)}`,
          });
        } else {
          // No se pudo parsear la corrección, mostrar opciones
          await sock.sendMessage(jid, {
            text: PREFIX + [
              '¿Qué quieres corregir? Dime el número o descríbeme qué está mal:',
              '',
              '1️⃣  Objetivos',
              '2️⃣  Ingresos / salario',
              '3️⃣  Día de pago',
              '4️⃣  Cuentas / saldo',
              '5️⃣  Criptomonedas',
              '6️⃣  Meta de ahorro',
              '',
              'O escribe *sí* para confirmar | *reiniciar* para empezar de cero',
            ].join('\n'),
          });
        }
        return false;
      }

      default:
        return false;
    }
  } catch (err) {
    console.error('[GastosOnboarding] Error en paso', step, ':', err.message);
    await sock.sendMessage(jid, {
      text: PREFIX + 'Tuve un problema procesando tu respuesta. Intenta de nuevo.',
    });
    return false;
  }
}

async function resendCurrentStep(sock, jid) {
  const gastos = await getGastosData(jid);
  const step = gastos.onboarding_step;
  const data = gastos.onboarding_data || {};

  const messages = {
    goals: msgGoals(),
    income: msgIncome(data),
    payday: msgPayday(data),
    accounts: msgAccounts(),
    crypto: msgCrypto(data),
    savings_goal: msgSavingsGoal(),
    confirm: msgConfirm(data),
  };

  const msg = messages[step];
  if (msg) {
    await sock.sendMessage(jid, { text: PREFIX + '↩️ Continuamos donde lo dejamos:\n\n' + msg });
  }
}

// ==================== Finalización ====================

async function _completeOnboarding(sock, jid, data) {
  try {
    const phoneNum = jid.split('@')[0].split(':')[0];
    const { id: sheetId, url: sheetUrl } = await createUserSpreadsheet(`💰 Finanzas - ${phoneNum}`);

    setCurrentSpreadsheetId(sheetId);

    const totalBalance = (data.accounts || []).reduce((s, a) => s + (a.balance || 0), 0);

    if (data.salary) {
      await setConfig('Salario', data.salary);
      await setConfig('Tipo Base', 'salario');
    }
    if (totalBalance > 0) await setConfig('Saldo Inicial', totalBalance);
    if (data.savings_goal) await setConfig('Meta Ahorro Mensual', data.savings_goal);
    if (data.payday && data.payday.length) await setConfig('Dia Pago', data.payday.join(','));
    if (data.salary_frequency) await setConfig('Frecuencia Salario', data.salary_frequency);
    if (data.accounts && data.accounts.length > 0) await setConfig('Cuentas', JSON.stringify(data.accounts));
    if (data.crypto && data.crypto.length > 0) await setConfig('Criptomonedas', JSON.stringify(data.crypto));
    if (data.fx_holdings && data.fx_holdings.length > 0) await setConfig('Divisas', JSON.stringify(data.fx_holdings));

    await setGastosData(jid, {
      sheet_id: sheetId,
      sheet_url: sheetUrl,
      onboarding_step: 'complete',
      onboarding_data: {},
      config: {
        goals: data.goals || [],
        salary: data.salary || null,
        salary_frequency: data.salary_frequency || 'monthly',
        payday: data.payday || [],
        savings_goal: data.savings_goal || null,
        accounts: data.accounts || [],
        crypto: data.crypto || [],
        fx_holdings: data.fx_holdings || [],
      },
    });

    const divider = '─'.repeat(25);
    const lines = [
      '✅ *¡Tu perfil financiero está listo!*',
      divider,
      '',
      '📊 Tu hoja de cálculo personal:',
      `🔗 ${sheetUrl}`,
      '',
      '*Cómo registrar gastos:*',
      'Escribe lo que gastaste en lenguaje natural:',
      '  _"Almuerzo 25k"_ | _"Uber 15.000"_ | _"Netflix 20k"_',
      '  Para otro mes: _"Almuerzo 25k [enero]"_',
      '',
      '*Comandos útiles:*',
      '  _cuentas_ → ver saldo de tus cuentas',
      '  _ver gastos_ → últimos registros del mes',
      '  _ver gastos [enero]_ → ver otro mes',
      '  _resumen_ → análisis financiero completo',
      '  _/salir_ → volver al asistente de IA',
      divider,
    ];

    await sock.sendMessage(jid, { text: PREFIX + lines.join('\n') });
    return true;
  } catch (err) {
    console.error('[GastosOnboarding] Error completando onboarding:', err.message);
    await sock.sendMessage(jid, {
      text: PREFIX + `Hubo un error creando tu hoja: ${err.message.substring(0, 100)}\nIntenta de nuevo con /gastos.`,
    });
    await setGastosData(jid, { onboarding_step: null });
    return false;
  }
}

// ==================== Parsers con Groq AI ====================

const PARSER_SYSTEM_HEADER = `CONVERSIONES EXACTAS de pesos colombianos:
- "k" SIEMPRE significa ×1.000 (miles): "100k" = 100.000, "500k" = 500.000, "50k" = 50.000
- "M" SIEMPRE significa ×1.000.000 (millones): "1M" = 1.000.000, "2.1M" = 2.100.000
- "un millón" = 1.000.000, "medio millón" = 500.000
- "un millón y medio" = 1.500.000, "dos millones" = 2.000.000
IMPORTANTE: "100k" = CIEN MIL (100.000), NO un millón.`;

async function _groqParse(systemPrompt, userText, groqService) {
  try {
    const response = await groqService.client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 400,
    });
    return JSON.parse(response.choices[0]?.message?.content || '{}');
  } catch (err) {
    console.error('[GastosOnboarding] Error en Groq parse:', err.message);
    return {};
  }
}

async function _parseGoals(text, groqService) {
  // Respuestas numéricas directas
  const t = text.trim();
  if (t === '1') return { goals: ['control_gastos'] };
  if (t === '2') return { goals: ['ahorro'] };
  if (t === '3') return { goals: ['metas'] };
  if (t === '4') return { goals: ['presupuesto'] };
  if (t === '5') return { goals: ['control_gastos', 'ahorro', 'metas', 'inversion', 'presupuesto'] };

  return _groqParse(
    `Eres un asistente financiero. El usuario dice qué objetivos financieros tiene.
Extrae una lista de: "control_gastos", "ahorro", "metas", "inversion", "presupuesto".
Si dice "todo", "todas", "todas las anteriores" o similar → incluye todos.
Responde SOLO con JSON: {"goals": ["control_gastos", "ahorro"]}`,
    text, groqService
  );
}

async function _parseIncome(text, groqService) {
  return _groqParse(
    `${PARSER_SYSTEM_HEADER}
Eres un asistente financiero colombiano. El usuario dice cuánto gana.
Extrae el monto en pesos colombianos y la frecuencia.
Si dice "quincena" o "quincenal" → frequency: "biweekly".
Si dice "semanal" → frequency: "weekly".
Por defecto → frequency: "monthly".
Si no hay monto claro → amount: null.
Responde SOLO con JSON: {"amount": 2100000, "frequency": "monthly"}`,
    text, groqService
  );
}

async function _parsePayday(text, groqService) {
  return _groqParse(
    `El usuario dice qué día(s) del mes le pagan.
Extrae los números de día (1-31). "último día" o "fin de mes" = 30. "quincena" = [15, 30]. "el 1" o "primero" = [1].
Si dice "los viernes" o frecuencia semanal → days: [].
Responde SOLO con JSON: {"days": [1]} o {"days": [15, 30]} o {"days": []}`,
    text, groqService
  );
}

async function _parseAccounts(text, groqService) {
  return _groqParse(
    `${PARSER_SYSTEM_HEADER}
El usuario dice cuánto tiene en sus cuentas bancarias o billeteras.
Extrae nombre y saldo de cada cuenta en pesos colombianos.
Si dice "no tengo" o "nada" o "cero" → accounts: [].
Si dice una cantidad sin especificar banco → name: "Efectivo".
Bancos comunes: Nequi, Bancolombia, Davivienda, BBVA, Falabella, Nu, Rappi, Efectivo.
Responde SOLO con JSON: {"accounts": [{"name": "Nequi", "balance": 500000}]}`,
    text, groqService
  );
}

async function _parseCrypto(text, groqService) {
  return _groqParse(
    `El usuario dice si tiene criptomonedas y/o divisas extranjeras.
Extrae cripto con símbolo (BTC, ETH, SOL, USDT...) y cantidad numérica.
Extrae divisas fiat (USD, EUR, GBP...) con cantidad numérica.
Si dice "no" o "nada" o "no tengo" → crypto: [], fx: [].
Responde SOLO con JSON: {"crypto": [{"symbol": "BTC", "amount": 0.05}], "fx": [{"currency": "USD", "amount": 200}]}`,
    text, groqService
  );
}

async function _parseSavingsGoal(text, data, groqService) {
  const salary = data.salary || 1000000;
  return _groqParse(
    `${PARSER_SYSTEM_HEADER}
El usuario quiere saber cuánto ahorrar mensualmente. Su salario es ${formatCOP(salary)} COP.
Si dice un porcentaje, calcula: 20% de ${salary} = ${Math.round(salary * 0.2)}.
Si dice "sin meta", "no tengo", "todavía no" → amount: null.
Responde SOLO con JSON: {"amount": 100000} o {"amount": null}
RECUERDA: "100k" = 100.000, "500k" = 500.000, "1M" = 1.000.000`,
    text, groqService
  );
}

/**
 * Parsea una corrección puntual en el paso de confirmación.
 * Retorna { field, value } donde field es el nombre del campo a corregir.
 */
async function _parseCorrection(text, data, groqService) {
  return _groqParse(
    `${PARSER_SYSTEM_HEADER}
El usuario está revisando su perfil financiero y quiere corregir un campo específico.
Datos actuales: ${JSON.stringify({ salary: data.salary, savings_goal: data.savings_goal, payday: data.payday, accounts: data.accounts })}

Campos posibles:
- "goals": array de ["control_gastos","ahorro","metas","inversion","presupuesto"]
- "salary": número en COP
- "payday": array de días [1-31]
- "accounts": array de {name, balance}
- "crypto": array de {symbol, amount}
- "savings_goal": número en COP o null

Determina qué campo quiere cambiar y cuál es el nuevo valor.
Si el usuario dice "la meta es 100k" → field: "savings_goal", value: 100000
Si el usuario dice "gano 3M" → field: "salary", value: 3000000
Si el usuario dice "no tengo cuentas" → field: "accounts", value: []
Si no está claro → field: null, value: null

Responde SOLO con JSON: {"field": "savings_goal", "value": 100000}`,
    text, groqService
  );
}

module.exports = { startGastosOnboarding, handleGastosOnboardingStep, resendCurrentStep };
