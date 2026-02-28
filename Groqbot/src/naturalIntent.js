// Groqbot/src/naturalIntent.js
// Detección de intención en lenguaje natural — no requiere comandos explícitos.
// Permite interactuar con el bot sin escribir /comandos.

// Roles disponibles (sync con PRESET_ROLES en whatsappClient.js)
const PRESET_ROLE_NAMES = ['traductor', 'programador', 'tutor', 'escritor', 'fitness', 'chef'];

// Modelos disponibles (sync con AVAILABLE_MODELS en groqService.js)
const MODEL_KEYS = {
  versatile: ['versatile', '70b', 'llama 70', 'inteligente', 'potente', 'avanzado', 'grande', 'mejor modelo'],
  kimi: ['kimi'],
  instant: ['instant', '8b', 'rápido', 'rapido', 'veloz', 'ligero', 'pequeño', 'pequeño', 'pequeno'],
  reset: ['scout', 'defecto', 'normal', 'original', 'predeterminado', 'por defecto'],
};

/**
 * Detecta la intención del usuario en lenguaje natural.
 * Solo debe llamarse para mensajes que NO empiezan con '/'.
 * @param {string} text - Mensaje del usuario (original, sin procesar)
 * @returns {{ intent: string, params: object } | null}
 *
 * Intents: 'reminder' | 'voice_on' | 'voice_off' | 'list_reminders' |
 *          'role' | 'model' | 'gif' | 'pdf' | 'qr'
 */
function detectNaturalIntent(text) {
  if (!text || typeof text !== 'string') return null;
  const msg = text.trim();
  if (msg.startsWith('/')) return null;
  if (msg.length < 4) return null;
  const low = msg.toLowerCase();

  // ==========================================================
  // RECORDATORIO
  // "recuérdame en 2 horas que llame a mamá"
  // "avísame en 30 minutos de la reunión"
  // "ponme un recordatorio en 1 hora para la reunión"
  // "en 2 horas recuérdame la reunión"
  // ==========================================================
  const TIME_UNIT = '(?:minutos?|mins?|horas?|d[ií]as?|[hmd](?=\\s|$))';
  const TIME_EXPR = `\\d+\\s*${TIME_UNIT}`;

  // P1: "recuérdame/avísame [en] X unit [que/de/para] text"
  const p1 = msg.match(
    new RegExp(`\\b(?:recuérdame|recuerda(?:me)?|avísame|avisame)\\s+(?:en\\s+)?(${TIME_EXPR})\\s*(?:(?:que|de|para|sobre|a|:|-)\\s*)?(.+)`, 'i')
  );
  if (p1 && p1[1] && p1[2] && p1[2].trim().length > 2) {
    return { intent: 'reminder', params: { rawTime: p1[1].trim(), text: p1[2].trim() } };
  }

  // P2: "ponme [un] recordatorio [en] X unit [de/que/para] text"
  const p2 = msg.match(
    new RegExp(`\\bponme\\s+(?:un\\s+)?recordatorio\\s+(?:en\\s+)?(${TIME_EXPR})\\s*(?:(?:de|para|que|sobre)\\s*)?(.+)`, 'i')
  );
  if (p2 && p2[1] && p2[2] && p2[2].trim().length > 2) {
    return { intent: 'reminder', params: { rawTime: p2[1].trim(), text: p2[2].trim() } };
  }

  // P3: "ponme [un] recordatorio de text en X unit"
  const p3 = msg.match(
    new RegExp(`\\bponme\\s+(?:un\\s+)?recordatorio\\s+(?:de|para|sobre|a)\\s+(.+?)\\s+en\\s+(${TIME_EXPR})`, 'i')
  );
  if (p3 && p3[1] && p3[2]) {
    return { intent: 'reminder', params: { rawTime: p3[2].trim(), text: p3[1].trim() } };
  }

  // P4: "en X unit recuérdame/avísame [que/de] text"
  const p4 = msg.match(
    new RegExp(`^en\\s+(${TIME_EXPR})\\s+(?:recuérdame|avísame|avisame|dime|que)\\s+(?:(?:de|que|para)\\s+)?(.+)`, 'i')
  );
  if (p4 && p4[1] && p4[2] && p4[2].trim().length > 2) {
    return { intent: 'reminder', params: { rawTime: p4[1].trim(), text: p4[2].trim() } };
  }

  // P5: "agenda/agéndame text en X unit"
  const p5 = msg.match(
    new RegExp(`\\b(?:agéndame|agendame|agenda)\\s+(.+?)\\s+(?:en|para)\\s+(${TIME_EXPR})`, 'i')
  );
  if (p5 && p5[1] && p5[2]) {
    return { intent: 'reminder', params: { rawTime: p5[2].trim(), text: p5[1].trim() } };
  }

  // ==========================================================
  // MODO VOZ
  // ==========================================================
  if (
    /\b(?:activa(?:\s+la)?|pon(?:me)?\s+(?:en\s+)?modo|responde\s+(?:con|en)|quiero\s+respuestas?\s+(?:en|con)|usa)\s+(?:la\s+)?(?:voz|audio)\b/i.test(low) ||
    /\bmodo\s+(?:voz|audio)\b/i.test(low) ||
    /\bresponde(?:r)?\s+(?:con|en)\s+audio\b/i.test(low) ||
    /\bactiva\s+el\s+audio\b/i.test(low)
  ) {
    return { intent: 'voice_on' };
  }
  if (
    /\b(?:desactiva(?:\s+la)?|quita(?:\s+la)?|sin)\s+(?:la\s+)?(?:voz|audio)\b/i.test(low) ||
    /\bresponde(?:r)?\s+(?:en|con)\s+texto\b/i.test(low) ||
    /\bmodo\s+texto\b/i.test(low) ||
    /\bdesactiva\s+el\s+audio\b/i.test(low)
  ) {
    return { intent: 'voice_off' };
  }

  // ==========================================================
  // VER RECORDATORIOS
  // ==========================================================
  if (
    /\b(?:mis|ver\s+mis?|cuáles?\s+(?:son\s+)?mis?|qué|lista\s+de)\s+recordatorios?\b/i.test(low) ||
    /\brecordatorios?\s+(?:activos?|pendientes?|que\s+tengo)\b/i.test(low) ||
    /\b(?:tengo|hay)\s+(?:algún\s+)?recordatorio?\b/i.test(low)
  ) {
    return { intent: 'list_reminders' };
  }

  // ==========================================================
  // CAMBIO DE ROL
  // ==========================================================
  for (const role of PRESET_ROLE_NAMES) {
    const rolePatterns = [
      new RegExp(`\\b(?:actú[ae]|s[ée]|conviértete|ponme|cámbiate?|haz(?:te)?)\\s+(?:como|en|un?|de)?\\s*(?:modo\\s+)?${role}\\b`, 'i'),
      new RegExp(`\\b(?:necesito|quiero|dame|ayúdame\\s+como)\\s+(?:un?\\s+)?(?:buen\\s+)?${role}\\b`, 'i'),
      new RegExp(`\\bmodo\\s+${role}\\b`, 'i'),
      new RegExp(`\\beres\\s+(?:mi\\s+)?(?:un?\\s+)?${role}\\b`, 'i'),
      new RegExp(`\\bponme\\s+en\\s+modo\\s+${role}\\b`, 'i'),
    ];
    for (const pat of rolePatterns) {
      if (pat.test(low)) return { intent: 'role', params: { role } };
    }
  }

  // ==========================================================
  // CAMBIO DE MODELO IA
  // ==========================================================
  for (const [key, keywords] of Object.entries(MODEL_KEYS)) {
    for (const kw of keywords) {
      if (low.includes(kw) && /\b(?:usa|cambia|activa|necesito|quiero|pon|switch)\b/i.test(low)) {
        return { intent: 'model', params: { key } };
      }
    }
  }

  // ==========================================================
  // GIF
  // ==========================================================
  const gifMatch = msg.match(/\b(?:mándame|busca|envíame|dame|pon|muéstrame)\s+(?:un\s+)?gif\s+(?:de\s+)?(.+?)$/i);
  if (gifMatch && gifMatch[1] && gifMatch[1].trim().length > 1) {
    return { intent: 'gif', params: { query: gifMatch[1].trim() } };
  }

  // ==========================================================
  // PDF — "crea un PDF sobre X" / "genera un informe de X"
  // ==========================================================
  const pdfMatch = msg.match(
    /\b(?:crea|genera|hazme|escribe|redacta|necesito|quiero|dame)\s+(?:un\s+)?(?:pdf|documento|informe|reporte|doc|artículo|ensayo)\s+(?:sobre|de|acerca\s+de|con\s+info(?:rmación)?\s+de|para|del?)\s+(.+?)$/i
  );
  if (pdfMatch && pdfMatch[1] && pdfMatch[1].trim().length > 3) {
    return { intent: 'pdf', params: { topic: pdfMatch[1].trim() } };
  }
  // "quiero un PDF de X"
  const pdfMatch2 = msg.match(
    /\b(?:quiero|necesito)\s+(?:un\s+)?(?:pdf|documento|informe|reporte)\s+(?:de|sobre|acerca\s+de)\s+(.+?)$/i
  );
  if (pdfMatch2 && pdfMatch2[1] && pdfMatch2[1].trim().length > 3) {
    return { intent: 'pdf', params: { topic: pdfMatch2[1].trim() } };
  }

  // ==========================================================
  // QR CODE — "genera un QR de X" / "crea un código QR para X"
  // ==========================================================
  const qrMatch = msg.match(
    /\b(?:crea|genera|hazme|haz|dame)\s+(?:un\s+)?(?:código\s+)?qr\s+(?:de|para|con)?\s*(.+?)$/i
  );
  if (qrMatch && qrMatch[1] && qrMatch[1].trim().length > 1) {
    return { intent: 'qr', params: { data: qrMatch[1].trim() } };
  }
  const qrMatch2 = msg.match(/\bqr\s+(?:de|para|con)\s+(.+?)$/i);
  if (qrMatch2 && qrMatch2[1]) {
    return { intent: 'qr', params: { data: qrMatch2[1].trim() } };
  }

  return null;
}

module.exports = { detectNaturalIntent, PRESET_ROLE_NAMES, MODEL_KEYS };
