// Gastos/src/gastosOnboarding.js - Onboarding conversacional para el bot de Finanzas

const { getGastosData, setGastosData } = require('../../src/gastosDb');
const { createUserSpreadsheet, setCurrentSpreadsheetId } = require('./sheets/sheetsClient');
const { setConfig } = require('./sheets/configManager');
const { formatCOP } = require('./utils/formatCurrency');

const PREFIX = '\u200B';

// ==================== Mensajes de cada paso ====================

function msgGoals() {
  return [
    '¡Hola! Soy tu asistente financiero personal 💰',
    '',
    'Voy a ayudarte a tomar control de tu dinero. ¿Qué quieres lograr? Puedes responderme con tus propias palabras:',
    '',
    '💸 Controlar mis gastos del día a día',
    '🏦 Ahorrar más dinero',
    '🎯 Cumplir metas de ahorro',
    '📊 Llevar un registro completo de mis finanzas',
    '🚀 Todo lo anterior',
  ].join('\n');
}

function msgIncome(data) {
  const goalsText = data.goals && data.goals.length ? data.goals.slice(0, 2).join(' y ') : null;
  return [
    goalsText ? `¡Perfecto, ${goalsText}! 🎯` : '¡Perfecto! 🎯',
    '',
    'Para darte un análisis preciso, necesito saber cuánto dinero recibes.',
    '',
    '¿Cuánto ganas y con qué frecuencia? Por ejemplo:',
    '• _"Gano 3 millones al mes"_',
    '• _"Me pagan 1.5M cada quincena"_',
    '• _"Recibo 800k semanal"_',
  ].join('\n');
}

function msgPayday(data) {
  const salaryText = data.salary ? formatCOP(data.salary) + (data.salary_frequency === 'monthly' ? ' mensual' : data.salary_frequency === 'biweekly' ? ' quincenal' : ' semanal') : 'registrado';
  return [
    `Ingresos: *${salaryText}* ✓`,
    '',
    '¿Qué día(s) del mes te pagan? Ejemplos:',
    '• _"El día 30"_',
    '• _"Los días 15 y 30"_ (quincena)',
    '• _"El último día del mes"_',
    '• _"Los viernes"_ (semanal)',
  ].join('\n');
}

function msgAccounts() {
  return [
    '¿Cuánto dinero tienes actualmente en tus cuentas? Puedes decirme el total o desglosado por banco:',
    '',
    '• _"Tengo 500k en Nequi y 2M en Bancolombia"_',
    '• _"Tengo como 1.5 millones en total"_',
    '• _"En efectivo tengo 300k"_',
    '• _"No tengo nada ahora"_',
  ].join('\n');
}

function msgCrypto(data) {
  const total = (data.accounts || []).reduce((s, a) => s + (a.balance || 0), 0);
  const accountsText = total > 0 ? `Cuentas: *${formatCOP(total)}* en total ✓` : 'Sin cuentas registradas ✓';
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
    'Casi terminamos! 🚀',
    '',
    '¿Tienes una meta de ahorro mensual? ¿Cuánto quieres guardar cada mes?',
    '',
    '• _"Quiero ahorrar 300k al mes"_',
    '• _"El 20% de lo que gano"_',
    '• _"No tengo una meta todavía"_',
  ].join('\n');
}

function msgConfirm(data) {
  const lines = ['📋 *Resumen de tu perfil financiero*\n'];

  if (data.goals && data.goals.length) {
    const goalLabels = { control_gastos: 'Control de gastos', ahorro: 'Ahorro', metas: 'Metas financieras', inversion: 'Inversión', presupuesto: 'Presupuesto', todo: 'Todo' };
    lines.push('🎯 *Objetivos:* ' + data.goals.map(g => goalLabels[g] || g).join(', '));
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
    lines.push(`₿ *Criptomonedas:* ${data.crypto.map(c => `${c.amount} ${c.symbol}`).join(', ')}`);
  }

  if (data.fx_holdings && data.fx_holdings.length > 0) {
    lines.push(`💱 *Divisas:* ${data.fx_holdings.map(f => `${f.amount} ${f.currency}`).join(', ')}`);
  }

  if (data.savings_goal) {
    lines.push(`💰 *Meta de ahorro:* ${formatCOP(data.savings_goal)}/mes`);
  } else {
    lines.push('💰 *Meta de ahorro:* Sin meta definida');
  }

  lines.push('');
  lines.push('¿Todo correcto? Escribe *sí* para crear tu hoja de cálculo personal, o *no* para empezar de nuevo.');
  return lines.join('\n');
}

// ==================== Flow principal ====================

/**
 * Inicia el onboarding de finanzas para un usuario nuevo.
 */
async function startGastosOnboarding(sock, jid) {
  await setGastosData(jid, { onboarding_step: 'goals', onboarding_data: {} });
  await sock.sendMessage(jid, { text: PREFIX + msgGoals() });
}

/**
 * Procesa un paso del onboarding.
 * @returns {boolean} true si el onboarding se completó exitosamente
 */
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
            text: PREFIX + 'No pude entender el monto 😅 Intenta ser más específico, por ejemplo: _"Gano 3 millones al mes"_',
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
        const isYes = ['sí', 'si', 'yes', 'ok', 'listo', 'perfecto', 'claro', 'correcto', 'dale', 'va', 'confirmado'].some(w => tl.includes(w));
        const isNo = ['no', 'nop', 'incorrecto', 'mal', 'empezar', 'reiniciar'].some(w => tl.includes(w));

        if (isNo) {
          await setGastosData(jid, { onboarding_step: 'goals', onboarding_data: {} });
          await sock.sendMessage(jid, { text: PREFIX + '🔄 Sin problema, empecemos de nuevo!\n\n' + msgGoals() });
          return false;
        }

        if (isYes) {
          await sock.sendMessage(jid, { text: PREFIX + '⏳ Creando tu hoja de cálculo personal...' });
          const success = await _completeOnboarding(sock, jid, data);
          return success;
        }

        await sock.sendMessage(jid, { text: PREFIX + 'Escribe *sí* para confirmar o *no* para empezar de nuevo.' });
        return false;
      }

      default:
        return false;
    }
  } catch (err) {
    console.error('[GastosOnboarding] Error en paso', step, ':', err.message);
    await sock.sendMessage(jid, {
      text: PREFIX + 'Tuve un problema procesando tu respuesta. Intenta de nuevo o escríbeme algo diferente.',
    });
    return false;
  }
}

/**
 * Re-envía el mensaje del paso actual (para cuando el usuario retoma).
 */
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
    // 1. Crear hoja de cálculo privada para este usuario
    const phoneNum = jid.split('@')[0].split(':')[0];
    const { id: sheetId, url: sheetUrl } = await createUserSpreadsheet(`💰 Finanzas - ${phoneNum}`);

    // 2. Inicializar configuración en la nueva hoja
    setCurrentSpreadsheetId(sheetId);

    const totalBalance = (data.accounts || []).reduce((s, a) => s + (a.balance || 0), 0);

    if (data.salary) {
      await setConfig('Salario', data.salary);
      await setConfig('Tipo Base', 'salario');
    }
    if (totalBalance > 0) {
      await setConfig('Saldo Inicial', totalBalance);
    }
    if (data.savings_goal) {
      await setConfig('Meta Ahorro Mensual', data.savings_goal);
    }
    if (data.payday && data.payday.length) {
      await setConfig('Dia Pago', data.payday.join(','));
    }
    if (data.salary_frequency) {
      await setConfig('Frecuencia Salario', data.salary_frequency);
    }
    if (data.accounts && data.accounts.length > 0) {
      await setConfig('Cuentas', JSON.stringify(data.accounts));
    }
    if (data.crypto && data.crypto.length > 0) {
      await setConfig('Criptomonedas', JSON.stringify(data.crypto));
    }
    if (data.fx_holdings && data.fx_holdings.length > 0) {
      await setConfig('Divisas', JSON.stringify(data.fx_holdings));
    }

    // 3. Guardar en Supabase
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

    // 4. Mensaje de bienvenida
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
      '',
      '*Comandos útiles:*',
      '  _cuentas_ → ver saldo de tus cuentas',
      '  _ver gastos_ → últimos registros del mes',
      '  _resumen_ → análisis financiero completo',
      '  _meta ahorro 300k_ → cambiar meta mensual',
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
      max_tokens: 300,
    });
    return JSON.parse(response.choices[0]?.message?.content || '{}');
  } catch (err) {
    console.error('[GastosOnboarding] Error en Groq parse:', err.message);
    return {};
  }
}

async function _parseGoals(text, groqService) {
  return _groqParse(
    `Eres un asistente financiero. El usuario expresa sus objetivos financieros.
Extrae una lista de objetivos de estas opciones: "control_gastos", "ahorro", "metas", "inversion", "presupuesto".
Si dice "todo" o "todas" o algo similar, incluye todos.
Responde SOLO con JSON: {"goals": ["control_gastos", "ahorro"]}`,
    text, groqService
  );
}

async function _parseIncome(text, groqService) {
  return _groqParse(
    `Eres un asistente financiero colombiano. El usuario dice cuánto gana.
Extrae el monto en pesos colombianos y la frecuencia.
Conversiones: "1M" o "un millón" = 1000000, "500k" o "500 mil" = 500000, "3.5M" = 3500000, "1 millón y medio" = 1500000.
Si dice "quincena" o "quincenal" o "cada 15 días" → frequency: "biweekly".
Si dice "semanal" o "cada semana" → frequency: "weekly".
Por defecto → frequency: "monthly".
Si no hay monto claro → amount: null.
Responde SOLO con JSON: {"amount": 3000000, "frequency": "monthly"}`,
    text, groqService
  );
}

async function _parsePayday(text, groqService) {
  return _groqParse(
    `El usuario dice qué día(s) del mes le pagan.
Extrae los números de día (1-31). "último día" o "fin de mes" = 30. "quincena" = [15, 30].
Si dice "los viernes" o frecuencia semanal → days: [].
Responde SOLO con JSON: {"days": [30]} o {"days": [15, 30]} o {"days": []}`,
    text, groqService
  );
}

async function _parseAccounts(text, groqService) {
  return _groqParse(
    `El usuario dice cuánto tiene en sus cuentas bancarias o billeteras digitales.
Extrae nombre y saldo de cada cuenta en pesos colombianos.
Conversiones: "1M" = 1000000, "500k" = 500000, "un millón" = 1000000.
Si dice "no tengo" o "nada" o "cero" → accounts: [].
Si dice una cantidad sin especificar banco → usa name: "Principal".
Bancos comunes: Nequi, Bancolombia, Davivienda, BBVA, Falabella, Nu, Rappi Pay.
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
    `El usuario dice cuánto quiere ahorrar mensualmente. El salario es ${salary} COP.
Si dice un porcentaje, calcula el monto: 20% de ${salary} = ${Math.round(salary * 0.2)}.
Conversiones: "1M" = 1000000, "500k" = 500000.
Si dice "no" o "sin meta" o "todavía no" → amount: null.
Responde SOLO con JSON: {"amount": 300000} o {"amount": null}`,
    text, groqService
  );
}

module.exports = { startGastosOnboarding, handleGastosOnboardingStep, resendCurrentStep };
