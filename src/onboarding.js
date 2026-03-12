// src/onboarding.js - Onboarding conversacional multi-paso
const { getContact, setPersonality, upsertContact, saveOnboardingSession, getOnboardingSessionFromDB, clearOnboardingSession } = require('./contactsDb');

// Estado en memoria: jid -> { step, data, timestamp }
const _sessions = new Map();
const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos

const STEPS = {
  WELCOME:          'welcome',          // ¿Para qué quieres usar el asistente?
  NAME:             'name',             // ¿Cómo te llamo?
  VIBE:             'vibe',             // ¿Cómo quieres que te hable?
  CONFIGURE_MENU:   'configure_menu',   // Menú: reconfigurar todo o editar campo específico
  EDIT_NAME:        'edit_name',        // Sólo cambiar nombre
  EDIT_USO:         'edit_uso',         // Sólo cambiar uso/propósito
  EDIT_VIBE:        'edit_vibe',        // Sólo cambiar tono
};

// ============================================
// Mensajes de cada paso
// ============================================

const MSG_WELCOME = (pushName) =>
  `Hola${pushName ? ' ' + pushName : ''} 👋 Acabo de conectarme.\n\n` +
  `Soy tu asistente personal de WhatsApp. Para darte la mejor experiencia, cuéntame un poco.\n\n` +
  `*¿Para qué quieres usar tu asistente?*\n\n` +
  `Puedes escribir algo como:\n` +
  `• _Ayuda con el trabajo y correos_\n` +
  `• _Aprender cosas nuevas y curiosidades_\n` +
  `• _Programación y tecnología_\n` +
  `• _Apoyo emocional y consejos de vida_\n` +
  `• _De todo un poco_`;

const MSG_NAME = () =>
  `Genial, me queda claro 👌\n\n` +
  `*¿Cómo prefieres que te llame?*\n` +
  `_(Solo tu nombre o apodo)_`;

const MSG_VIBE = (nombre) =>
  `Un gusto, *${nombre}* 😊\n\n` +
  `*¿Cómo prefieres que te hable?*\n\n` +
  `1️⃣ Casual y relajado (como un amigo)\n` +
  `2️⃣ Profesional y directo\n` +
  `3️⃣ Técnico y preciso\n` +
  `4️⃣ Divertido con humor\n\n` +
  `Responde con el número o descríbelo a tu manera.`;

const MSG_CONFIGURE_MENU = (nombre) =>
  `¿Qué quieres cambiar${nombre ? ', *' + nombre + '*' : ''}?\n\n` +
  `1️⃣ Reconfigurar todo (empezar de cero)\n` +
  `2️⃣ Cambiar mi nombre\n` +
  `3️⃣ Cambiar para qué uso el bot\n` +
  `4️⃣ Cambiar el tono de respuesta`;

const MSG_CONFIRM = (nombre, uso, vibe) =>
  `Todo listo, *${nombre}* ✅\n\n` +
  `Así es como te voy a atender:\n` +
  `• *Para:* ${uso}\n` +
  `• *Tono:* ${vibe}\n\n` +
  `Puedes cambiar esto cuando quieras con */configurar*\n\n` +
  `¿En qué te puedo ayudar hoy? 🚀`;

// Mensajes de re-pregunta cuando la respuesta no es válida para el paso
const MSG_RETRY = {
  [STEPS.CONFIGURE_MENU]: `Responde con 1, 2, 3 o 4 para elegir qué quieres cambiar.`,
  [STEPS.WELCOME]:   `Cuéntame un poco más. ¿Para qué quieres usar el asistente?\n_(ej: trabajo, programación, aprender cosas nuevas...)_`,
  [STEPS.EDIT_USO]:  `Cuéntame un poco más. ¿Para qué quieres usar el asistente?\n_(ej: trabajo, programación, aprender cosas nuevas...)_`,
  [STEPS.NAME]:      `Por favor dime cómo te llamas o cómo prefieres que te llame.\n_(Solo un nombre o apodo, máximo 4 palabras)_`,
  [STEPS.EDIT_NAME]: `Por favor dime cómo te llamas o cómo prefieres que te llame.\n_(Solo un nombre o apodo, máximo 4 palabras)_`,
  [STEPS.VIBE]:      `Responde con *1*, *2*, *3* o *4*, o descríbelo a tu manera.`,
  [STEPS.EDIT_VIBE]: `Responde con *1*, *2*, *3* o *4*, o descríbelo a tu manera.`,
};

// ============================================
// Validación de respuesta por paso
// ============================================
function _isValidForStep(step, text) {
  const t = text.trim();
  const lower = t.toLowerCase().replace(/[!?.¿¡]+/g, '').trim();

  if (t.length < 2) return false;

  // Respuestas triviales rechazadas en todos los pasos
  if (/^(hola|hey|hi|ok|okay|sí|si|no|dale|listo|bien|mal|gracias|jaja|jeje|xd|nada|igual|👍|👎|😀|😂|😅)$/.test(lower)) return false;

  switch (step) {
    case STEPS.CONFIGURE_MENU:
      return /^[1-4]$/.test(lower) || /(todo|nombre|uso|tono|vibe)/i.test(lower);

    case STEPS.NAME:
    case STEPS.EDIT_NAME:
      // Nombre: 2-40 chars, sin signos de pregunta, máximo 4 palabras
      return t.length >= 2 && t.length <= 40 && !t.includes('?') && t.split(/\s+/).length <= 4;

    case STEPS.WELCOME:
    case STEPS.EDIT_USO:
      // Uso: al menos 5 caracteres descriptivos
      return t.length >= 5;

    case STEPS.VIBE:
    case STEPS.EDIT_VIBE:
      // Número del 1-4 o texto libre > 2 chars
      return /^[1-4]$/.test(lower) || t.length > 2;

    default:
      return true;
  }
}

// ============================================
// Helpers
// ============================================
function parseVibe(text) {
  const t = text.trim().toLowerCase();
  if (t === '1' || t.includes('casual') || t.includes('amigo') || t.includes('relajad')) return 'casual y relajado, como hablarle a un amigo';
  if (t === '2' || t.includes('profesional') || t.includes('direct')) return 'profesional y directo';
  if (t === '3' || t.includes('técnic') || t.includes('tecnic') || t.includes('precis')) return 'técnico y preciso';
  if (t === '4' || t.includes('diviert') || t.includes('humor')) return 'divertido con humor';
  return text.trim();
}

function buildPersonality(nombre, uso, vibe) {
  return (
    `Eres el asistente personal de WhatsApp de ${nombre}. ` +
    `Tu propósito principal: ${uso}. ` +
    `Estilo de comunicación: ${vibe}. ` +
    `Hablas en español colombiano. ` +
    `Eres conciso, útil y nunca empiezas con frases genéricas como "¡Claro!" o "¡Por supuesto!". ` +
    `Vas directo al punto. Si no sabes algo, lo dices honestamente.`
  );
}

// Guarda personalidad + datos de perfil (para poder editarlos después)
async function _finishOnboarding(jid, nombre, uso, vibe, groqService) {
  const personality = buildPersonality(nombre, uso, vibe);
  // Mantener onboarding_data con perfil raw para ediciones futuras (no usar clearOnboardingSession)
  await upsertContact(jid, { onboarding_step: null, onboarding_done: true, onboarding_data: { nombre, uso, vibe } });
  await setPersonality(jid, personality, nombre);
  groqService.setCustomPrompt(jid, personality);
  groqService.setUserContext(jid, `[DATOS DEL USUARIO]\nNombre: ${nombre}`);
  groqService.clearHistory(jid);
}

// ============================================
// API pública
// ============================================

async function getOnboardingState(jid) {
  const session = _sessions.get(jid);
  if (session) {
    if (Date.now() - session.timestamp > TIMEOUT_MS) {
      _sessions.delete(jid);
    } else {
      return 'in_progress';
    }
  }
  const contact = await getContact(jid);
  // Revisar onboarding_step ANTES de onboarding_done:
  // /configurar puede activar un step incluso en usuarios que ya terminaron el onboarding.
  if (contact?.onboarding_step) {
    const updatedAt = contact.updated_at ? new Date(contact.updated_at).getTime() : 0;
    const stale = Date.now() - updatedAt > 24 * 60 * 60 * 1000;
    if (stale) {
      await upsertContact(jid, { onboarding_step: null, onboarding_data: null });
      return contact?.onboarding_done ? 'done' : 'new';
    }
    _sessions.set(jid, {
      step: contact.onboarding_step,
      data: contact.onboarding_data || {},
      timestamp: Date.now(),
    });
    return 'in_progress';
  }
  if (contact?.onboarding_done) return 'done';
  return 'new';
}

async function startOnboarding(sock, jid, pushName) {
  const data = { pushName };
  await upsertContact(jid, { name: pushName || null, onboarding_done: false });
  await saveOnboardingSession(jid, STEPS.WELCOME, data);
  _sessions.set(jid, { step: STEPS.WELCOME, data, timestamp: Date.now() });
  await sock.sendMessage(jid, { text: MSG_WELCOME(pushName) });
}

/**
 * Abre el menú /configurar: editar todo o solo un campo.
 */
async function startConfigureMenu(sock, jid, pushName, groqService) {
  // Cargar perfil guardado para tenerlo disponible en los pasos de edición
  const contact = await getContact(jid);
  const profile = contact?.onboarding_data || {};
  const nombre = profile.nombre || contact?.name || pushName || null;

  const data = {
    pushName,
    nombre:  profile.nombre  || contact?.name || null,
    uso:     profile.uso     || null,
    vibe:    profile.vibe    || null,
  };

  await saveOnboardingSession(jid, STEPS.CONFIGURE_MENU, data);
  _sessions.set(jid, { step: STEPS.CONFIGURE_MENU, data, timestamp: Date.now() });
  await sock.sendMessage(jid, { text: MSG_CONFIGURE_MENU(nombre) });
}

async function handleOnboardingStep(sock, jid, userText, groqService) {
  const session = _sessions.get(jid);
  if (!session) return false;

  session.timestamp = Date.now();
  const text = userText.trim();

  // ── Validación universal por paso ──────────────────────────────────
  if (!_isValidForStep(session.step, text)) {
    const retryMsg = MSG_RETRY[session.step];
    if (retryMsg) await sock.sendMessage(jid, { text: retryMsg });
    return false;
  }

  // ── CONFIGURE_MENU ─────────────────────────────────────────────────
  if (session.step === STEPS.CONFIGURE_MENU) {
    const lower = text.toLowerCase().replace(/[!?.¿¡]+/g, '').trim();

    if (lower === '1' || /todo/i.test(lower)) {
      // Reconfigurar todo: reset y flujo completo
      _sessions.delete(jid);
      await upsertContact(jid, { onboarding_done: false, onboarding_step: null, onboarding_data: null, personality: null, name: null });
      groqService.clearHistory(jid);
      groqService.customPrompts.delete(jid);
      groqService.userContexts.delete(jid);
      await startOnboarding(sock, jid, session.data.pushName);

    } else if (lower === '2' || /nombre/i.test(lower)) {
      session.step = STEPS.EDIT_NAME;
      await saveOnboardingSession(jid, STEPS.EDIT_NAME, session.data);
      await sock.sendMessage(jid, { text: `*¿Cómo prefieres que te llame?*\n_(Solo tu nombre o apodo)_` });

    } else if (lower === '3' || /uso/i.test(lower)) {
      session.step = STEPS.EDIT_USO;
      await saveOnboardingSession(jid, STEPS.EDIT_USO, session.data);
      await sock.sendMessage(jid, {
        text: `*¿Para qué quieres usar el asistente?*\n\n` +
              `• _Ayuda con el trabajo y correos_\n` +
              `• _Programación y tecnología_\n` +
              `• _De todo un poco_`,
      });

    } else if (lower === '4' || /tono/i.test(lower)) {
      session.step = STEPS.EDIT_VIBE;
      await saveOnboardingSession(jid, STEPS.EDIT_VIBE, session.data);
      await sock.sendMessage(jid, { text: MSG_VIBE(session.data.nombre || 'tú') });
    }
    return false;
  }

  // ── WELCOME (uso) ──────────────────────────────────────────────────
  if (session.step === STEPS.WELCOME) {
    session.data.uso = text;
    session.step = STEPS.NAME;
    await saveOnboardingSession(jid, STEPS.NAME, session.data);
    await sock.sendMessage(jid, { text: MSG_NAME() });
    return false;
  }

  // ── NAME ───────────────────────────────────────────────────────────
  if (session.step === STEPS.NAME) {
    const nombre = text.split(' ')[0];
    session.data.nombre = nombre;
    session.step = STEPS.VIBE;
    await saveOnboardingSession(jid, STEPS.VIBE, session.data);
    await sock.sendMessage(jid, { text: MSG_VIBE(nombre) });
    return false;
  }

  // ── VIBE (fin del onboarding original) ────────────────────────────
  if (session.step === STEPS.VIBE) {
    session.data.vibe = parseVibe(text);
    const { nombre, uso } = session.data;
    await _finishOnboarding(jid, nombre, uso, session.data.vibe, groqService);
    _sessions.delete(jid);
    await sock.sendMessage(jid, { text: MSG_CONFIRM(nombre, uso, session.data.vibe) });
    return true;
  }

  // ── EDIT_NAME ──────────────────────────────────────────────────────
  if (session.step === STEPS.EDIT_NAME) {
    const nombre = text.split(' ')[0];
    const uso  = session.data.uso  || 'asistencia general';
    const vibe = session.data.vibe || 'casual y relajado';
    await _finishOnboarding(jid, nombre, uso, vibe, groqService);
    _sessions.delete(jid);
    await sock.sendMessage(jid, { text: `✅ Listo, ahora te llamo *${nombre}*.\nConversación reiniciada.` });
    return true;
  }

  // ── EDIT_USO ───────────────────────────────────────────────────────
  if (session.step === STEPS.EDIT_USO) {
    const uso    = text;
    const nombre = session.data.nombre || 'tú';
    const vibe   = session.data.vibe   || 'casual y relajado';
    await _finishOnboarding(jid, nombre, uso, vibe, groqService);
    _sessions.delete(jid);
    await sock.sendMessage(jid, { text: `✅ Actualizado. Ahora sé que me usas para: _${uso}_\nConversación reiniciada.` });
    return true;
  }

  // ── EDIT_VIBE ──────────────────────────────────────────────────────
  if (session.step === STEPS.EDIT_VIBE) {
    const vibe   = parseVibe(text);
    const nombre = session.data.nombre || 'tú';
    const uso    = session.data.uso    || 'asistencia general';
    await _finishOnboarding(jid, nombre, uso, vibe, groqService);
    _sessions.delete(jid);
    await sock.sendMessage(jid, { text: `✅ Tono actualizado a: _${vibe}_\nConversación reiniciada.` });
    return true;
  }

  return false;
}

async function loadPersonalityIfNeeded(jid, groqService) {
  const needsPersonality = !groqService.customPrompts.has(jid);
  const needsUserCtx = !groqService.userContexts.has(jid);
  if (!needsPersonality && !needsUserCtx) return;

  const contact = await getContact(jid);
  if (needsPersonality && contact?.personality) {
    groqService.setCustomPrompt(jid, contact.personality);
  }
  if (needsUserCtx && contact?.name) {
    groqService.setUserContext(jid, `[DATOS DEL USUARIO]\nNombre: ${contact.name}`);
  }
}

async function resetOnboarding(sock, jid, pushName, groqService) {
  _sessions.delete(jid);
  await upsertContact(jid, { onboarding_done: false, onboarding_step: null, onboarding_data: null, personality: null, name: null });
  groqService.clearHistory(jid);
  groqService.customPrompts.delete(jid);
  groqService.userContexts.delete(jid);
  await startOnboarding(sock, jid, pushName);
}

async function updatePersonality(sock, jid, newPersonality, groqService) {
  await setPersonality(jid, newPersonality);
  groqService.setCustomPrompt(jid, newPersonality);
  groqService.clearHistory(jid);
  await sock.sendMessage(jid, {
    text: `✅ *Perfil actualizado*\n\n_${newPersonality.substring(0, 120)}${newPersonality.length > 120 ? '...' : ''}_\n\nConversación reiniciada.`
  });
}

module.exports = {
  getOnboardingState,
  startOnboarding,
  startConfigureMenu,
  handleOnboardingStep,
  loadPersonalityIfNeeded,
  updatePersonality,
  resetOnboarding,
};
