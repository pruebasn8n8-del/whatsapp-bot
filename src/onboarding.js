// src/onboarding.js - Onboarding conversacional multi-paso estilo OpenClaw
const { getContact, setPersonality, upsertContact } = require('./contactsDb');

// Estado en memoria: jid -> { step, data, timestamp }
const _sessions = new Map();
const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos para completar el onboarding

const STEPS = {
  WELCOME: 'welcome',       // Pregunta para qué quiere usar el asistente
  NAME: 'name',             // Cómo lo llamo a él
  VIBE: 'vibe',             // Tono: formal, casual, técnico, etc.
  CONFIRM: 'confirm',       // Resumen y confirmación
};

// ============================================
// Mensajes de cada paso
// ============================================

const MSG_WELCOME = (pushName) =>
  `Hola${pushName ? ' ' + pushName : ''} 👋 Acabo de conectarme.\n\n` +
  `Soy tu asistente personal de WhatsApp. Para darte la mejor experiencia, ` +
  `cuéntame un poco.\n\n` +
  `*¿Para qué quieres usar tu asistente?*\n\n` +
  `Puedes escribir algo como:\n` +
  `• _Ayuda con el trabajo y correos_\n` +
  `• _Aprender cosas nuevas y curiosidades_\n` +
  `• _Programación y tecnología_\n` +
  `• _Apoyo emocional y consejos de vida_\n` +
  `• _De todo un poco_`;

const MSG_NAME = (uso) =>
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

const MSG_CONFIRM = (nombre, uso, vibe) =>
  `Todo listo, ${nombre} ✅\n\n` +
  `Así es como te voy a atender:\n` +
  `• *Para:* ${uso}\n` +
  `• *Tono:* ${vibe}\n\n` +
  `Puedes cambiar esto cuando quieras con */miperfil*\n\n` +
  `¿En qué te puedo ayudar hoy? 🚀`;

// ============================================
// Mapear respuesta de vibe a texto
// ============================================
function parseVibe(text) {
  const t = text.trim().toLowerCase();
  if (t === '1' || t.includes('casual') || t.includes('amigo') || t.includes('relajad')) return 'casual y relajado, como hablarle a un amigo';
  if (t === '2' || t.includes('profesional') || t.includes('direct')) return 'profesional y directo';
  if (t === '3' || t.includes('técnic') || t.includes('tecnic') || t.includes('precis')) return 'técnico y preciso';
  if (t === '4' || t.includes('diviert') || t.includes('humor')) return 'divertido con humor';
  return text.trim(); // respuesta libre
}

// ============================================
// Construir system prompt a partir del onboarding
// ============================================
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

// ============================================
// API pública
// ============================================

/**
 * Retorna el estado del onboarding para un JID.
 * 'new' | 'in_progress' | 'done'
 */
async function getOnboardingState(jid) {
  const session = _sessions.get(jid);
  if (session) {
    if (Date.now() - session.timestamp > TIMEOUT_MS) {
      _sessions.delete(jid);
      // Reiniciar si expiró
      return 'new';
    }
    return 'in_progress';
  }
  const contact = await getContact(jid);
  if (contact?.onboarding_done) return 'done';
  return 'new';
}

/**
 * Inicia el onboarding: envía el primer mensaje y crea la sesión.
 */
async function startOnboarding(sock, jid, pushName) {
  await upsertContact(jid, { name: pushName || null, onboarding_done: false });
  _sessions.set(jid, { step: STEPS.WELCOME, data: { pushName }, timestamp: Date.now() });
  await sock.sendMessage(jid, { text: MSG_WELCOME(pushName) });
}

/**
 * Procesa la respuesta del usuario según el paso actual.
 * Retorna true si el onboarding terminó.
 */
async function handleOnboardingStep(sock, jid, userText, groqService) {
  const session = _sessions.get(jid);
  if (!session) return false;

  session.timestamp = Date.now(); // renovar timeout
  const text = userText.trim();

  if (session.step === STEPS.WELCOME) {
    // El usuario describió para qué quiere usar el bot
    session.data.uso = text;
    session.step = STEPS.NAME;
    await sock.sendMessage(jid, { text: MSG_NAME(text) });
    return false;
  }

  if (session.step === STEPS.NAME) {
    // El usuario dijo su nombre
    const nombre = text.split(' ')[0]; // solo primer nombre
    session.data.nombre = nombre;
    session.step = STEPS.VIBE;
    await sock.sendMessage(jid, { text: MSG_VIBE(nombre) });
    return false;
  }

  if (session.step === STEPS.VIBE) {
    // El usuario eligió el vibe
    session.data.vibe = parseVibe(text);
    const { nombre, uso, vibe } = session.data;

    // Construir y guardar la personalidad
    const personality = buildPersonality(nombre, uso, session.data.vibe);
    await setPersonality(jid, personality, nombre);
    groqService.setCustomPrompt(jid, personality);
    groqService.clearHistory(jid);

    _sessions.delete(jid);
    await sock.sendMessage(jid, { text: MSG_CONFIRM(nombre, uso, session.data.vibe) });
    return true;
  }

  return false;
}

/**
 * Carga la personalidad desde Supabase a groqService si no está en memoria.
 */
async function loadPersonalityIfNeeded(jid, groqService) {
  if (groqService.customPrompts.has(jid)) return;
  const contact = await getContact(jid);
  if (contact?.personality) {
    groqService.setCustomPrompt(jid, contact.personality);
  }
}

/**
 * Actualiza la personalidad via /miperfil.
 */
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
  handleOnboardingStep,
  loadPersonalityIfNeeded,
  updatePersonality,
};
