// Gastos/src/gastosOnboarding.js - Onboarding con capa de verificación en cada paso

const { getGastosData, setGastosData } = require('../../src/gastosDb');
const { setCurrentSpreadsheetId, getDoc } = require('./sheets/sheetsClient');
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
  goals: 'Objetivos', salary: 'Ingresos', payday: 'Día de pago',
  accounts: 'Cuentas', crypto: 'Criptomonedas', fx_holdings: 'Divisas',
  savings_goal: 'Meta de ahorro',
};

const CORRECTION_SIGNALS = [
  'no ', 'no,', 'no.', 'espera', 'perdón', 'perdon', 'en realidad',
  'me corrijo', 'quise decir', 'quiero decir', 'eso no', 'no no',
  'mentira', 'mejor dicho', 'o sea', 'o mejor', 'la verdad', 'error',
];

// Reglas numéricas inyectadas en TODOS los prompts que manejan montos
const NUM_RULES = `
REGLAS NUMÉRICAS - Colombia usa punto como separador de miles:
• "7.156" = 7.156 pesos (siete mil ciento cincuenta y seis) — NO multipliques por nada
• "2.850" = 2.850 pesos (dos mil ochocientos cincuenta)
• "1.500.000" = 1.500.000 pesos (un millón quinientos mil)
• Sufijo k = ×1.000: "100k"=100.000 | "50k"=50.000 | "500k"=500.000
• Sufijo M = ×1.000.000: "1M"=1.000.000 | "2.1M"=2.100.000 | "3M"=3.000.000
• Sin sufijo = valor exacto: "7156"=7.156 | "2850"=2.850
NUNCA multipliques un número que no tenga sufijo k o M.`;

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
    '• _"El día 30"_  •  _"Los días 15 y 30"_  •  _"El 1"_',
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
  return [
    total > 0 ? `Cuentas: *${formatCOP(total)}* ✓` : 'Sin cuentas registradas ✓',
    '',
    '¿Tienes ahorros en criptomonedas o divisas extranjeras?',
    '',
    '• _"Tengo 0.05 BTC y 200 dólares"_  •  _"No tengo"_',
  ].join('\n');
}

function msgSavingsGoal() {
  return [
    '¡Casi terminamos! 🚀',
    '',
    '¿Cuánto quieres ahorrar cada mes?',
    '',
    '• _"100k al mes"_  •  _"El 20% de lo que gano"_  •  _"Sin meta"_',
  ].join('\n');
}

function msgConfirm(data) {
  const lines = ['📋 *Resumen de tu perfil financiero*\n'];
  if (data.goals && data.goals.length)
    lines.push('🎯 *Objetivos:* ' + data.goals.map(g => GOAL_LABELS[g] || g).join(', '));
  if (data.salary) {
    const freq = { monthly: 'mensual', biweekly: 'quincenal', weekly: 'semanal', daily: 'diario' };
    lines.push(`💵 *Ingresos:* ${formatCOP(data.salary)} ${freq[data.salary_frequency] || ''}`);
  }
  if (data.payday && data.payday.length)
    lines.push(`📅 *Día de pago:* ${data.payday.map(d => 'día ' + d).join(' y ')}`);
  if (data.accounts && data.accounts.length > 0) {
    const total = data.accounts.reduce((s, a) => s + (a.balance || 0), 0);
    lines.push(`🏦 *Cuentas:* ${formatCOP(total)} total`);
    data.accounts.forEach(a => lines.push(`   • ${a.name}: ${formatCOP(a.balance)}`));
  }
  if (data.crypto && data.crypto.length > 0)
    lines.push(`₿ *Cripto:* ${data.crypto.map(c => `${c.amount} ${c.symbol}`).join(', ')}`);
  if (data.fx_holdings && data.fx_holdings.length > 0)
    lines.push(`💱 *Divisas:* ${data.fx_holdings.map(f => `${f.amount} ${f.currency}`).join(', ')}`);
  lines.push(`💰 *Meta de ahorro:* ${data.savings_goal ? formatCOP(data.savings_goal) + '/mes' : 'Sin meta'}`);
  lines.push('');
  lines.push('¿Todo correcto? Escribe *sí* para continuar.');
  lines.push('Si algo está mal, dime qué: _"la meta es 100k"_ | _"el salario es 3M"_');
  lines.push('_Escribe *reiniciar* para empezar desde cero._');
  return lines.join('\n');
}

function msgSheetSetup() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || 'ver variable GOOGLE_CLIENT_EMAIL';
  return [
    '📊 *Último paso: conecta tu hoja de cálculo*',
    '',
    'Necesito que hagas esto (solo una vez):',
    '',
    '1️⃣ Ve a *sheets.google.com* y crea una hoja nueva',
    '2️⃣ Haz clic en *Compartir* (arriba a la derecha)',
    `3️⃣ Agrega este email como *Editor*:\n   \`${email}\``,
    '4️⃣ Cópiame el *link* de tu hoja aquí',
    '',
    '_La hoja queda en tu Google Drive y es completamente tuya._',
  ].join('\n');
}

// ==================== Detector de inputs irrelevantes ====================

/**
 * Detecta si el usuario está mandando algo completamente ajeno al onboarding.
 * Retorna true → repetir el paso actual, false → procesar normalmente.
 */
function _isOffTopic(text, step) {
  const t = text.trim().toLowerCase();

  // Números solos (1-5) siempre son válidos (goals, cat, etc.)
  if (/^\d{1,2}$/.test(t)) return false;
  // "sí/no/yes" son respuestas válidas en varios pasos
  if (/^(s[íi]|no|yes|nada|ninguno|ninguna)$/.test(t)) return false;
  // Links de Google Sheets son válidos en sheet_setup
  if (step === 'sheet_setup' && t.includes('docs.google')) return false;
  // Señales de corrección → dejar que el flujo normal las maneje
  if (CORRECTION_SIGNALS.some(s => t.startsWith(s) || t.includes(s))) return false;

  // Muy corto sin contenido útil
  if (t.length <= 1) return true;

  // Saludos y frases sin contenido
  if (/^(hola|hey|oye|holi|buenas?|buen[ao]s?\s*(d[íi]as?|tardes?|noches?)?|ok\??|hmm+|uh+|eh+|lol|jaja+|xd+|😊|👍|jeje+)$/
    .test(t)) return true;

  // Preguntas claramente off-topic (clima, noticias, entretenimiento, etc.)
  if (/\b(clima|tiempo\s+en|noticias|gif\s|chiste|broma|pel[íi]cula|canci[oó]n|receta|f[úu]tbol|partido|juego|meme)\b/
    .test(t)) return true;

  return false;
}

// ==================== Flow principal ====================

async function startGastosOnboarding(sock, jid) {
  await setGastosData(jid, { onboarding_step: 'goals', onboarding_data: {} });
  await sock.sendMessage(jid, { text: PREFIX + msgGoals() });
}

function _normalizeData(raw) {
  const d = { ...raw };
  if (d.accounts && !Array.isArray(d.accounts)) d.accounts = [d.accounts];
  if (d.crypto && !Array.isArray(d.crypto)) d.crypto = [d.crypto];
  if (d.fx_holdings && !Array.isArray(d.fx_holdings)) d.fx_holdings = [d.fx_holdings];
  if (d.goals && !Array.isArray(d.goals)) d.goals = [d.goals];
  if (d.payday && !Array.isArray(d.payday)) d.payday = [d.payday];
  return d;
}

async function handleGastosOnboardingStep(sock, jid, text, groqService) {
  const gastos = await getGastosData(jid);
  const step = gastos.onboarding_step;
  if (!step || step === 'complete') return false;
  const data = _normalizeData(gastos.onboarding_data || {});

  try {
    // ── Detector de correcciones mid-flow (excepto goals y confirm) ──
    if (step !== 'goals' && step !== 'confirm') {
      const tl = text.trim().toLowerCase();
      const hasSignal = CORRECTION_SIGNALS.some(s => tl.startsWith(s) || tl.includes(s));
      if (hasSignal) {
        const correction = await _parseFieldCorrection(text, data, groqService);
        if (correction && correction.field && correction.value !== null) {
          const newData = { ...data, [correction.field]: correction.value };
          await setGastosData(jid, { onboarding_data: newData });
          const currentMsg = _getStepMsg(step, newData);
          await sock.sendMessage(jid, {
            text: PREFIX + `✅ *${FIELD_NAMES[correction.field] || correction.field}* corregido.\n\n${currentMsg}`,
          });
          return false;
        }
      }
    }

    // ── Detector de inputs irrelevantes: repetir el paso actual ──
    // Aplica en todos los pasos excepto 'confirm' (que ya tiene su propia lógica)
    if (step !== 'confirm' && _isOffTopic(text, step)) {
      const stepMsg = _getStepMsg(step, data);
      if (stepMsg) {
        await sock.sendMessage(jid, {
          text: PREFIX + `Continuemos con la configuración 👇\n\n${stepMsg}`,
        });
      }
      return false;
    }

    switch (step) {
      case 'goals': {
        const parsed = await _parseGoals(text, groqService);
        const goals = parsed.goals && parsed.goals.length ? parsed.goals : ['control_gastos'];
        const newData = { ...data, goals };
        await setGastosData(jid, { onboarding_step: 'income', onboarding_data: newData });
        await sock.sendMessage(jid, { text: PREFIX + msgIncome(newData) });
        return false;
      }

      case 'income': {
        const parsed = await _parseIncomeVerified(text, groqService);
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
        // Si no hay días y el usuario no dijo explícitamente que no tiene día fijo → preguntar de nuevo
        if ((!parsed.days || parsed.days.length === 0)) {
          const tl = text.trim().toLowerCase();
          const saysNoFixed = /\b(no\s+tengo|irregular|variable|sin\s+fecha|no\s+hay|no\s+fijo|freelance|proyecto)\b/.test(tl);
          if (!saysNoFixed) {
            await sock.sendMessage(jid, {
              text: PREFIX + 'No pude entender el día. Dime un número:\n\n• _"El día 30"_  •  _"Los días 15 y 30"_  •  _"El 1 de cada mes"_\n\nO escribe _"irregular"_ si tus ingresos no tienen fecha fija.',
            });
            return false;
          }
        }
        const newData = { ...data, payday: parsed.days || [] };
        await setGastosData(jid, { onboarding_step: 'accounts', onboarding_data: newData });
        await sock.sendMessage(jid, { text: PREFIX + msgAccounts() });
        return false;
      }

      case 'accounts': {
        const parsed = await _parseAccountsVerified(text, groqService);
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
        const parsed = await _parseSavingsGoalVerified(text, data, groqService);
        const newData = { ...data, savings_goal: parsed.amount || null };
        await setGastosData(jid, { onboarding_step: 'confirm', onboarding_data: newData });
        await sock.sendMessage(jid, { text: PREFIX + msgConfirm(newData) });
        return false;
      }

      case 'confirm': {
        const tl = text.trim().toLowerCase();
        const isYes = ['sí', 'si', 'yes', 'ok', 'listo', 'perfecto', 'claro', 'correcto', 'dale', 'va', 'confirmado', 'todo bien', 'esta bien', 'está bien'].some(w => tl.includes(w));
        const isRestart = ['reiniciar', 'empezar de nuevo', 'desde cero', 'reset'].some(w => tl.includes(w));

        if (isRestart) {
          await setGastosData(jid, { onboarding_step: 'goals', onboarding_data: {} });
          await sock.sendMessage(jid, { text: PREFIX + '🔄 Empezando desde cero!\n\n' + msgGoals() });
          return false;
        }
        if (isYes) {
          await setGastosData(jid, { onboarding_step: 'sheet_setup', onboarding_data: data });
          await sock.sendMessage(jid, { text: PREFIX + msgSheetSetup() });
          return false;
        }

        // Corrección puntual en el resumen
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
              '', '1️⃣  Objetivos', '2️⃣  Ingresos / salario', '3️⃣  Día de pago',
              '4️⃣  Cuentas / saldo', '5️⃣  Criptomonedas', '6️⃣  Meta de ahorro',
              '', 'O escribe *sí* para confirmar | *reiniciar* para empezar de cero',
            ].join('\n'),
          });
        }
        return false;
      }

      case 'sheet_setup': {
        // El usuario manda el link o ID de su hoja de Google Sheets
        const sheetId = _extractSheetId(text);
        if (!sheetId) {
          await sock.sendMessage(jid, {
            text: PREFIX + [
              '❌ No pude leer ese link. Asegúrate de que sea el link completo de Google Sheets:',
              '_https://docs.google.com/spreadsheets/d/XXXX/edit_',
              '',
              'O mándame directamente el ID (la parte larga entre /d/ y /edit).',
            ].join('\n'),
          });
          return false;
        }
        // Verificar que el bot tiene acceso a esa hoja
        setCurrentSpreadsheetId(sheetId);
        try {
          await getDoc();
        } catch (accessErr) {
          const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || '';
          await sock.sendMessage(jid, {
            text: PREFIX + [
              '❌ No tengo acceso a esa hoja.',
              '',
              'Verifica que la compartiste con este email como *Editor*:',
              `\`${email}\``,
              '',
              'Luego mándame el link de nuevo.',
            ].join('\n'),
          });
          return false;
        }
        return await _completeOnboarding(sock, jid, data, sheetId);
      }

      default:
        return false;
    }
  } catch (err) {
    console.error('[GastosOnboarding] Error en paso', step, ':', err.message);
    await sock.sendMessage(jid, { text: PREFIX + 'Tuve un problema. Intenta de nuevo.' });
    return false;
  }
}

async function resendCurrentStep(sock, jid) {
  const gastos = await getGastosData(jid);
  const msg = _getStepMsg(gastos.onboarding_step, _normalizeData(gastos.onboarding_data || {}));
  if (msg) await sock.sendMessage(jid, { text: PREFIX + '↩️ Continuamos donde lo dejamos:\n\n' + msg });
}

function _getStepMsg(step, data) {
  return {
    goals: msgGoals(), income: msgIncome(data), payday: msgPayday(data),
    accounts: msgAccounts(), crypto: msgCrypto(data), savings_goal: msgSavingsGoal(),
    confirm: msgConfirm(data), sheet_setup: msgSheetSetup(),
  }[step] || null;
}

function _extractSheetId(text) {
  // Extraer ID de un link de Google Sheets o de un ID directo
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (urlMatch) return urlMatch[1];
  // ID directo (cadena de 44 chars alfanuméricos)
  const directMatch = text.trim().match(/^([a-zA-Z0-9_-]{20,})$/);
  if (directMatch) return directMatch[1];
  return null;
}

// ==================== Finalización ====================

async function _completeOnboarding(sock, jid, data, sheetId) {
  try {
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}`;
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
      sheet_id: sheetId, sheet_url: sheetUrl, onboarding_step: 'complete', onboarding_data: {},
      config: { goals: data.goals || [], salary: data.salary || null, salary_frequency: data.salary_frequency || 'monthly', payday: data.payday || [], savings_goal: data.savings_goal || null, accounts: data.accounts || [], crypto: data.crypto || [], fx_holdings: data.fx_holdings || [] },
    });

    // Formatear Config y Resumen con diseño profesional
    const { writeInitialConfigLayout } = require('./sheets/configManager');
    const { initResumenSheet } = require('./sheets/dashboardUpdater');
    try { await writeInitialConfigLayout(data); } catch (e) { console.warn('[Onboarding] Config layout:', e.message); }
    try { await initResumenSheet(data); } catch (e) { console.warn('[Onboarding] Resumen init:', e.message); }

    const divider = '─'.repeat(25);
    await sock.sendMessage(jid, {
      text: PREFIX + ['✅ *¡Tu perfil financiero está listo!*', divider, '', '📊 Tu hoja de cálculo personal:', `🔗 ${sheetUrl}`, '', '*Cómo registrar gastos:*', '  _"Almuerzo 25k"_ | _"Uber 15.000"_ | _"Netflix 20k"_', '  Para otro mes: _"Almuerzo 25k [enero]"_', '', '*Comandos útiles:*', '  _cuentas_ → ver saldo', '  _ver gastos_ → últimos registros', '  _resumen_ → análisis financiero', '  _/salir_ → volver al asistente de IA', divider].join('\n'),
    });
    return true;
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.error('[GastosOnboarding] Error completando:', detail, err.stack?.split('\n')[1]);
    await sock.sendMessage(jid, { text: PREFIX + `Error creando tu hoja: ${detail.substring(0, 120)}\nIntenta de nuevo con /gastos.` });
    await setGastosData(jid, { onboarding_step: null });
    return false;
  }
}

// ==================== Parsers con razonamiento + verificación ====================

/**
 * Parser base con chain-of-thought: el modelo razona antes de extraer.
 * Incluye campo "razonamiento" que fuerza al AI a verificar su propia respuesta.
 */
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
      max_tokens: 500,
    });
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
    if (parsed.razonamiento) {
      console.log('[Onboarding verify]', parsed.razonamiento.substring(0, 150));
    }
    return parsed;
  } catch (err) {
    console.error('[GastosOnboarding] Groq error:', err.message);
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
    `Eres un asistente financiero. El usuario expresa sus objetivos.
Opciones: "control_gastos", "ahorro", "metas", "inversion", "presupuesto".
Si dice "todo" o "todas" → incluye todos.
Responde SOLO con JSON: {"goals": ["control_gastos", "ahorro"]}`,
    text, groqService
  );
}

/**
 * Parser de ingresos con razonamiento interno para verificar el monto.
 */
async function _parseIncomeVerified(text, groqService) {
  return _groqParse(
    `Eres un asistente financiero colombiano. El usuario dice cuánto gana.
${NUM_RULES}

PROCESO (hazlo en orden):
1. Lee el texto del usuario
2. Razona: ¿qué número escribió exactamente? ¿tiene sufijo k o M?
3. Aplica la conversión correcta
4. Verifica: ¿el monto que calculaste tiene sentido para un salario colombiano típico?
5. Si detectas un error en tu cálculo, corrígelo

Frecuencia: "quincena"/"quincenal" → "biweekly" | "semanal" → "weekly" | default → "monthly"

Responde con JSON (incluye razonamiento):
{
  "razonamiento": "El usuario dijo X, el número es Y, con/sin sufijo, resultado = Z",
  "amount": 2100000,
  "frequency": "monthly"
}
Si no hay monto claro → amount: null`,
    text, groqService
  );
}

async function _parsePayday(text, groqService) {
  return _groqParse(
    `El usuario dice qué día(s) del mes le pagan.
"último"/"fin de mes" = 30. "quincena" = [15,30]. "el 1"/"primero" = [1].
Días de semana ("viernes") → days: [].
Responde SOLO con JSON: {"days": [1]}`,
    text, groqService
  );
}

/**
 * Parser de cuentas con razonamiento interno para verificar cada saldo.
 */
async function _parseAccountsVerified(text, groqService) {
  return _groqParse(
    `Eres un asistente financiero colombiano. El usuario dice cuánto tiene en sus cuentas.
${NUM_RULES}

PROCESO OBLIGATORIO para cada cuenta:
1. Extrae el número EXACTO como lo escribió el usuario
2. Razona: ¿tiene sufijo k o M? ¿usa punto como separador de miles?
3. Convierte según las reglas
4. Verifica: ¿el monto tiene sentido? (montos muy pequeños como 7.156 = $7.156 son válidos)
5. Si no hay banco especificado → name: "Efectivo"

Si dice "no tengo" / "nada" → accounts: []
Bancos: Nequi, Bancolombia, Davivienda, BBVA, Nu, Rappi, Efectivo, Daviplata.

Responde con JSON (incluye razonamiento):
{
  "razonamiento": "El usuario dijo 7.156 en Nequi (sin sufijo, punto=separador de miles → 7156) y 2.850 en efectivo (→ 2850)",
  "accounts": [{"name": "Nequi", "balance": 7156}, {"name": "Efectivo", "balance": 2850}]
}`,
    text, groqService
  );
}

async function _parseCrypto(text, groqService) {
  return _groqParse(
    `El usuario dice si tiene criptomonedas o divisas extranjeras.
Si dice "no" / "nada" / "no tengo" → crypto: [], fx: [].
Responde SOLO con JSON: {"crypto": [{"symbol": "BTC", "amount": 0.05}], "fx": [{"currency": "USD", "amount": 200}]}`,
    text, groqService
  );
}

/**
 * Parser de meta de ahorro con razonamiento interno.
 */
async function _parseSavingsGoalVerified(text, data, groqService) {
  const salary = data.salary || 1000000;
  return _groqParse(
    `Eres un asistente financiero colombiano. El usuario quiere ahorrar X por mes.
Su salario es ${formatCOP(salary)} COP.
${NUM_RULES}

PROCESO:
1. Lee el texto del usuario
2. Razona: ¿qué número escribió? ¿sufijo k, M, o porcentaje?
3. Si es porcentaje: X% de ${salary} = ${Math.round(salary * 0.01)}×X
4. Convierte según las reglas
5. Verifica: ¿el monto es razonable como meta de ahorro mensual?

Si dice "sin meta" / "no tengo" / "no" → amount: null

Responde con JSON (incluye razonamiento):
{
  "razonamiento": "El usuario dijo 100k → sufijo k → 100×1000 = 100.000",
  "amount": 100000
}`,
    text, groqService
  );
}

/**
 * Parsea una corrección puntual de cualquier campo (usado en correcciones mid-flow y en confirm).
 * Incluye razonamiento para verificar la corrección.
 */
async function _parseFieldCorrection(text, data, groqService) {
  const existingAccounts = Array.isArray(data.accounts) ? data.accounts : [];
  const result = await _groqParse(
    `El usuario corrige un dato de su perfil financiero.
Cuentas actuales: ${JSON.stringify(existingAccounts)}
${NUM_RULES}

PROCESO:
1. Lee qué quiere corregir el usuario
2. Identifica el campo: goals | salary | payday | accounts | crypto | savings_goal
3. Extrae el nuevo valor con conversión correcta
4. Verifica que el nuevo valor tiene sentido
5. Si no está claro → field: null

IMPORTANTE para "accounts":
- Si el usuario solo menciona UNA cuenta, solo cambia esa. Las demás se conservan.
- El valor SIEMPRE debe ser un array: [{"name":"Nequi","balance":7156}]
- Si dice "tengo 7.156 en Nequi" → actualiza solo Nequi a 7156, conserva efectivo.

Ejemplos:
- "la meta es 100k" → field:"savings_goal", value:100000
- "tengo 7.156 en Nequi" → field:"accounts", value:[{"name":"Nequi","balance":7156}]
- "gano 3M" → field:"salary", value:3000000

Responde con JSON:
{
  "razonamiento": "El usuario quiere corregir X porque...",
  "field": "savings_goal",
  "value": 100000
}
Sin campo claro → {"field": null, "value": null}`,
    text, groqService
  );

  // Normalizar accounts: siempre array + merge con cuentas existentes
  if (result.field === 'accounts') {
    const corrected = Array.isArray(result.value) ? result.value : (result.value ? [result.value] : []);
    const merged = [...existingAccounts];
    for (const acc of corrected) {
      const idx = merged.findIndex(a => a.name?.toLowerCase() === acc.name?.toLowerCase());
      if (idx >= 0) merged[idx] = acc;
      else merged.push(acc);
    }
    result.value = merged;
  }

  return result;
}

module.exports = { startGastosOnboarding, handleGastosOnboardingStep, resendCurrentStep };
