// src/onboarding.js - Flujo de bienvenida para nuevos contactos
const { getContact, setPersonality, upsertContact } = require('./contactsDb');

// Contactos esperando ingresar su personalidad: jid -> { step, timestamp }
const _pendingOnboarding = new Map();
const ONBOARDING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos

const WELCOME_MESSAGE = `¡Hola! 👋 Soy tu asistente personal de WhatsApp.

Antes de comenzar, quiero conocer tus preferencias para darte la mejor experiencia.

*¿Cómo te gustaría que fuera mi personalidad?*

Puedes escribir algo como:
• _Formal y profesional, experto en derecho_
• _Casual y divertido, me gusta el humor_
• _Experto en programación y tecnología_
• _Coach de vida motivacional_
• _Asistente general en español colombiano_

✍️ Escribe ahora cómo quieres que sea tu asistente:`;

const CONFIRM_MESSAGE = (personality) =>
  `✅ *¡Perfecto!* He guardado tu configuración.\n\n` +
  `Tu asistente ahora es: _${personality.substring(0, 80)}${personality.length > 80 ? '...' : ''}_\n\n` +
  `Puedes cambiar mi personalidad en cualquier momento escribiendo:\n` +
  `*/miperfil <nueva descripción>*\n\n` +
  `¿En qué puedo ayudarte hoy? 😊`;

/**
 * Verifica si un contacto necesita onboarding.
 * Retorna: 'new' | 'pending' | 'done'
 */
async function getOnboardingState(jid) {
  // Si está en el mapa pendiente y no expiró
  const pending = _pendingOnboarding.get(jid);
  if (pending) {
    if (Date.now() - pending.timestamp < ONBOARDING_TIMEOUT_MS) {
      return 'pending';
    }
    _pendingOnboarding.delete(jid);
  }

  const contact = await getContact(jid);
  if (!contact || !contact.onboarding_done) return 'new';
  return 'done';
}

/**
 * Inicia el onboarding: envía el mensaje de bienvenida y marca como pendiente.
 */
async function startOnboarding(sock, jid, pushName) {
  // Crear el contacto en Supabase si no existe
  await upsertContact(jid, { name: pushName || null, onboarding_done: false });

  _pendingOnboarding.set(jid, { timestamp: Date.now() });

  await sock.sendMessage(jid, { text: WELCOME_MESSAGE });
}

/**
 * Completa el onboarding: guarda la personalidad y limpia el estado pendiente.
 * Retorna la personalidad guardada.
 */
async function completeOnboarding(sock, jid, personalityText, groqService, pushName) {
  const personality = personalityText.trim();

  // Guardar en Supabase
  await setPersonality(jid, personality, pushName || null);

  // Aplicar en memoria para esta sesión
  groqService.setCustomPrompt(jid, personality);
  groqService.clearHistory(jid);

  _pendingOnboarding.delete(jid);

  await sock.sendMessage(jid, { text: CONFIRM_MESSAGE(personality) });

  return personality;
}

/**
 * Carga la personalidad de un contacto desde Supabase a groqService (si no está en memoria).
 */
async function loadPersonalityIfNeeded(jid, groqService) {
  if (groqService.customPrompts.has(jid)) return; // ya está en memoria

  const contact = await getContact(jid);
  if (contact?.personality) {
    groqService.setCustomPrompt(jid, contact.personality);
  }
}

/**
 * Actualiza la personalidad de un contacto (comando /miperfil).
 */
async function updatePersonality(sock, jid, newPersonality, groqService) {
  await setPersonality(jid, newPersonality);
  groqService.setCustomPrompt(jid, newPersonality);
  groqService.clearHistory(jid);

  await sock.sendMessage(jid, {
    text: `✅ *Perfil actualizado*\n\n_${newPersonality.substring(0, 100)}${newPersonality.length > 100 ? '...' : ''}_\n\nConversación reiniciada.`
  });
}

module.exports = {
  getOnboardingState,
  startOnboarding,
  completeOnboarding,
  loadPersonalityIfNeeded,
  updatePersonality,
};
