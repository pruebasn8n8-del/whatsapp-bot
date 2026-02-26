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

const FIELD_NAMES = {
  goals: 'Objetivos',
  salary: 'Ingresos',
  payday: 'Día de pago',
  accounts: 'Cuentas',
  crypto: 'Criptomonedas',
  fx_holdings: 'Divisas',
  savings_goal: 'Meta de ahorro',
};

// Señales que indican corrección de un paso anterior
const CORRECTION_SIGNALS = [
  'no ', 'no,', 'no.', 'espera', 'perdón', 'perdon', 'en realidad',
  'me corrijo', 'quise decir', 'quiero decir', 'eso no', 'no no',
  'mentira', 'mejor dicho', 'o sea', 'o mejor', 'la verdad',
];

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
  ].join('\n');
}

function msgAccounts() {
  return [
    '¿Cuánto tienes actualmente en tus cuentas?',
    '',
    '• _"Tengo 500k en Nequi y 2M en Bancolombia"_',
    '• _"Tengo 7.156 en Nequi y 2.850 en efectivo"_',
    '• _"No tengo nada ahora"_',
  ].join('\n');
}

function msgCrypto(data) {
  const total = (data.accounts || []).reduce((s, a) => s + (a.balance || 0), 0);
  const accountsText = total > 0
    ? `Cuentas: *${formatCOP(total)}* ✓`
    : 'Sin cuentas registradas ✓';
  return [
    accountsText,
    '',
    '¿Tienes ahorros en criptomonedas o divisas extranjeras?',
    '',
    '• _"Tengo 0.05 BTC y 200 dólares"_',
    '• _"No tengo"_',
  ].join('\n');
}

function msgSavingsGoal() {
  return [
    '¡Casi terminamos! 🚀',
    '',
    '¿Cuánto quieres ahorrar cada mes?',
    '',
    '• _"100k al mes"_',
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
  lines.push('Si algo está mal, dime qué: _"la meta es 100k"_ | _"el salario es 3M"_');
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
    // ---- Detector universal de correcciones (excepto en goals y confirm) ----
    if (step !== 'goals' && step !== 'confirm') {
      const correction = await _detectAndParseCorrection(text, data, groqService);
      if (correction) {
        const newData = { ...data, [correction.field]: correction.value };
        await setGastosData(jid, { onboarding_data: newData });

        // Determinar qué mensaje mostrar del paso actual (con data ya actualizada)
        const currentMsg = _getCurrentStepMsg(step, newData);
        await sock.sendMessage(jid, {
          text: PREFIX + `✅ *${FIELD_NAMES[correction.field] || correction.field}* corregido.\n\n${currentMsg}`,
        });
        return false;
      }
    }

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
            text: PREFIX + 'No pude entender el monto. Intenta: _"Gano 2.1M al mes"_ o _"3 millones mensuales"_',
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
          return await _completeOnboarding(sock, jid, data);
        }

        // Parsear corrección puntual
        const correction = await _parseFieldCorrection(text, data, groqService);
        if (correction && correction.field) {
          const newData = { ...data, [correction.field]: correction.value };
          await setGastosData(jid, { onboarding_step: 'confirm', onboarding_data: newData });
          await sock.sendMessage(jid, {
            text: PREFIX + `✅ *${FIELD_NAMES[correction.field] || correction.field}* actualizado.\n\n${msgConfirm(newData)}`,
          });
        } else {
          await sock.sendMessage(jid, {
            text: PREFIX + [
              '¿Qué quieres corregir? Dime el número o descríbeme el cambio:',
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
  const msg = _getCurrentStepMsg(step, data);
  if (msg) {
    await sock.sendMessage(jid, { text: PREFIX + '↩️ Continuamos donde lo dejamos:\n\n' + msg });
  }
}

function _getCurrentStepMsg(step, data) {
  const msgs = {
    goals: msgGoals(),
    income: msgIncome(data),
    payday: msgPayday(data),
    accounts: msgAccounts(),
    crypto: msgCrypto(data),
    savings_goal: msgSavingsGoal(),
    confirm: msgConfirm(data),
  };
  return msgs[step] || null;
}

// ==================== Detector universal de correcciones ====================

/**
 * Detecta si el usuario está corrigiendo una respuesta anterior en mitad del flujo.
 * Solo actúa cuando hay señales claras de corrección (no para respuestas normales).
 * @returns {{ field, value } | null}
 */
async function _detectAndParseCorrection(text, data, groqService) {
  const tl = text.trim().toLowerCase();
  const hasSignal = CORRECTION_SIGNALS.some(s => tl.startsWith(s) || tl.includes(s));
  if (!hasSignal) return null;

  const result = await _parseFieldCorrection(text, data, groqService);
  if (result && result.field && result.value !== null && result.value !== undefined) {
    return result;
  }
  return null;
}

// ==================== Finalización ====================

async function _completeOnboarding(sock, jid, data) {
  try {
    const phoneNum = jid.split('@')[0].split(':')[0];
    const { id: sheetId, url: sheetUrl } = await createUserSpreadsheet(`💰 Finanzas - ${phoneNum}`);
    setCurrentSpreadsheetId(sheetId);

    const totalBalance = (data.accounts || []).reduce((s, a) => s + (a.balance || 0), 0);
    if (data.salary) { await setConfig('Salario', data.salary); await setConfig('Tipo Base', 'salario'); }
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
    await sock.sendMessage(jid, {
      text: PREFIX + [
        '✅ *¡Tu perfil financiero está listo!*',
        divider,
        '',
        '📊 Tu hoja de cálculo personal:',
        `🔗 ${sheetUrl}`,
        '',
        '*Cómo registrar gastos:*',
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
      ].join('\n'),
    });
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

// Encabezado de conversiones que va en TODOS los prompts numéricos
const NUM_HEADER = `REGLAS DE NÚMEROS EN PESOS COLOMBIANOS (leer con atención):
1. El punto "." es separador de miles: "7.156" = siete mil ciento cincuenta y seis (7156). NO es decimal.
2. La coma "," es decimal (raro en cantidades): "2,5M" = 2.500.000
3. "k" = miles (×1.000): "100k"=100.000 | "50k"=50.000 | "500k"=500.000
4. "M" = millones (×1.000.000): "1M"=1.000.000 | "2.1M"=2.100.000 | "3M"=3.000.000
5. Números solos sin sufijo = valor exacto: "7156" = 7.156 | "2850" = 2.850
6. "un millón" = 1.000.000 | "medio millón" = 500.000 | "dos millones" = 2.000.000
NUNCA multipliques un número solo por 1000 a menos que tenga sufijo "k" o "mil".`;

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
    console.error('[GastosOnboarding] Groq parse error:', err.message);
    return {};
  }
}

async function _parseGoals(text, groqService) {
  const t = text.trim();
  if (t === '1') return { goals: ['control_gastos'] };
  if (t === '2') return { goals: ['ahorro'] };
  if (t === '3') return { goals: ['metas'] };
  if (t === '4') return { goals: ['presupuesto'] };
  if (t === '5') return { goals: ['control_gastos', 'ahorro', 'metas', 'inversion', 'presupuesto'] };

  return _groqParse(
    `Eres un asistente financiero. El usuario expresa sus objetivos financieros.
Extrae una lista de: "control_gastos", "ahorro", "metas", "inversion", "presupuesto".
Si dice "todo", "todas", "5", "todo lo anterior" → incluye todos.
Responde SOLO con JSON: {"goals": ["control_gastos", "ahorro"]}`,
    text, groqService
  );
}

async function _parseIncome(text, groqService) {
  return _groqParse(
    `${NUM_HEADER}
Eres un asistente financiero colombiano. El usuario dice cuánto gana.
Extrae el monto en pesos colombianos y la frecuencia.
- "quincena", "quincenal", "cada 15 días" → frequency: "biweekly"
- "semanal", "cada semana" → frequency: "weekly"
- Por defecto → frequency: "monthly"
- Sin monto claro → amount: null
Responde SOLO con JSON: {"amount": 2100000, "frequency": "monthly"}`,
    text, groqService
  );
}

async function _parsePayday(text, groqService) {
  return _groqParse(
    `El usuario dice qué día(s) del mes le pagan.
Extrae los números de día (1-31). "último día"/"fin de mes" = 30. "quincena" = [15,30]. "el 1"/"primero" = [1].
Si menciona días de semana ("viernes") → days: [].
Responde SOLO con JSON: {"days": [1]} o {"days": [15,30]} o {"days": []}`,
    text, groqService
  );
}

async function _parseAccounts(text, groqService) {
  return _groqParse(
    `${NUM_HEADER}
El usuario dice cuánto tiene en sus cuentas/billeteras en pesos colombianos.
IMPORTANTE: Cantidades sin sufijo como "7.156" = 7156 pesos. "2.850" = 2850 pesos.
Si dice "no tengo" / "nada" / "cero" → accounts: [].
Si no especifica banco → name: "Efectivo".
Bancos: Nequi, Bancolombia, Davivienda, BBVA, Nu, Rappi, Efectivo, Daviplata.
Responde SOLO con JSON: {"accounts": [{"name": "Nequi", "balance": 7156}, {"name": "Efectivo", "balance": 2850}]}`,
    text, groqService
  );
}

async function _parseCrypto(text, groqService) {
  return _groqParse(
    `El usuario dice si tiene criptomonedas y/o divisas extranjeras.
Si dice "no" / "nada" / "no tengo" → crypto: [], fx: [].
Responde SOLO con JSON: {"crypto": [{"symbol": "BTC", "amount": 0.05}], "fx": [{"currency": "USD", "amount": 200}]}`,
    text, groqService
  );
}

async function _parseSavingsGoal(text, data, groqService) {
  const salary = data.salary || 1000000;
  return _groqParse(
    `${NUM_HEADER}
El usuario quiere ahorrar X por mes. Su salario es ${salary} COP.
Si dice porcentaje: 20% de ${salary} = ${Math.round(salary * 0.2)}.
Si dice "sin meta" / "no tengo" / "todavía no" → amount: null.
Responde SOLO con JSON: {"amount": 100000} o {"amount": null}`,
    text, groqService
  );
}

/**
 * Parsea una corrección puntual de cualquier campo del perfil.
 * Usado tanto en el detector mid-flow como en el paso confirm.
 */
async function _parseFieldCorrection(text, data, groqService) {
  return _groqParse(
    `${NUM_HEADER}
El usuario está corrigiendo un dato de su perfil financiero.
Datos actuales: ${JSON.stringify({ salary: data.salary, savings_goal: data.savings_goal, payday: data.payday, accounts: data.accounts })}

Determina QUÉ campo quiere cambiar y cuál es el NUEVO valor:
- "goals": array de ["control_gastos","ahorro","metas","inversion","presupuesto"]
- "salary": número en COP
- "payday": array de días [1-31]
- "accounts": array de {name, balance} — balances en COP exactos
- "crypto": array de {symbol, amount}
- "savings_goal": número en COP o null

Ejemplos:
- "la meta es 100k" → {"field":"savings_goal","value":100000}
- "gano 3M" → {"field":"salary","value":3000000}
- "tengo 7.156 en Nequi y 2.850 en efectivo" → {"field":"accounts","value":[{"name":"Nequi","balance":7156},{"name":"Efectivo","balance":2850}]}
- "no tengo cuentas" → {"field":"accounts","value":[]}
- Sin campo claro → {"field":null,"value":null}

Responde SOLO con JSON.`,
    text, groqService
  );
}

module.exports = { startGastosOnboarding, handleGastosOnboardingStep, resendCurrentStep };
