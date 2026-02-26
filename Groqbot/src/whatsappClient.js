// src/whatsappClient.js - Groq handler para Baileys
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const GroqService = require("./groqService");
const { getTRM, getCryptoPrice, searchCrypto, formatUSD, formatCOP: formatCOPPrice, formatChangeArrow } = require("./priceService");
const { getMessageText, getInteractiveResponse, sendListMessage, sendButtonMessage, unwrapMessage } = require("../../src/messageUtils");

// Importar ffmpeg del paquete npm
let ffmpegPath = "ffmpeg";
try {
  const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
  ffmpegPath = ffmpegInstaller.path;
  console.log("[Groq] Usando ffmpeg de npm:", ffmpegPath);
} catch (e) {
  console.log("[Groq] Usando ffmpeg del sistema");
}

// ============================================
// Estado compartido para el handler de Groq
// ============================================
const _botPrefix = "\u200B";
const _voiceModes = new Map(); // chatId -> boolean
const _sentMessageIds = new Set();
const _lastVoiceResponse = new Map();
const _reminders = new Map(); // chatId -> [{ text, timeout, time }]
const _pendingModelo = new Map(); // chatId -> { options: [...keys], timestamp }
const _pendingRole = new Map(); // chatId -> { options: [...keys], timestamp }
const _priceAlerts = new Map(); // chatId -> [{ coin, condition, target, createdAt }]
const _pendingClearConfirm = new Map(); // chatId -> { timestamp }
const _cleanupPromptSent = new Map(); // chatId -> timestamp
const _chatMessageKeys = new Map(); // chatId -> [{ key, ts }] mensajes enviados por el bot
const SELECTION_TIMEOUT = 60 * 1000;
const USER_MSG_WARN_THRESHOLD = 10; // Sugerir limpieza al llegar a 10 mensajes del usuario
const CLEANUP_PROMPT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos entre prompts de limpieza
const MAX_TRACKED_MSGS = 80; // Maximo de keys a recordar por chat

// Import lazy de contactsDb (puede no estar disponible si falta Supabase)
let _contactsDb;
function _getContactsDb() {
  if (_contactsDb === undefined) {
    try { _contactsDb = require("../../src/contactsDb"); }
    catch (e) { _contactsDb = null; }
  }
  return _contactsDb;
}
const _tmpDir = path.join(process.cwd(), ".tmp_audio");
if (!fs.existsSync(_tmpDir)) {
  fs.mkdirSync(_tmpDir, { recursive: true });
}

// Roles predefinidos para /role
const PRESET_ROLES = {
  traductor: "Eres un traductor profesional. Traduce entre espanol e ingles. Si te escriben en espanol, traduce al ingles. Si te escriben en ingles, traduce al espanol. Solo da la traduccion sin explicaciones adicionales.",
  programador: "Eres un experto programador senior. Ayudas con codigo, debugging, arquitectura y mejores practicas. Respondes con codigo limpio y explicaciones claras. Usa formato de WhatsApp.",
  tutor: "Eres un tutor paciente y pedagogico. Explicas conceptos de forma simple, usas analogias y ejemplos. Haces preguntas para verificar comprension. Adaptas tu nivel al del estudiante.",
  escritor: "Eres un escritor creativo y editor profesional. Ayudas a redactar, corregir y mejorar textos. Puedes escribir en diferentes estilos y tonos segun lo que necesite el usuario.",
  fitness: "Eres un entrenador personal y nutricionista. Das consejos de ejercicio, rutinas y alimentacion. Siempre recuerdas que no eres medico y recomiendas consultar profesionales.",
  chef: "Eres un chef profesional. Sugieres recetas, tecnicas de cocina y combinaciones de ingredientes. Puedes adaptar recetas a dietas especificas y presupuestos.",
};

// Regex para detectar URLs en texto
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

/**
 * Convierte un buffer de imagen a WebP para stickers.
 * Baileys requiere formato WebP para stickers.
 */
async function _convertToWebpSticker(buffer) {
  const ts = Date.now();
  const inputPath = path.join(_tmpDir, ts + '_stk_in.png');
  const outputPath = path.join(_tmpDir, ts + '_stk_out.webp');
  try {
    fs.writeFileSync(inputPath, buffer);
    await execAsync(
      `"${ffmpegPath}" -i "${inputPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -c:v libwebp -lossless 0 -quality 80 -loop 0 -preset default -an -vsync 0 -y "${outputPath}"`
    );
    const webpBuffer = fs.readFileSync(outputPath);
    return webpBuffer;
  } finally {
    _cleanupFiles(inputPath, outputPath);
  }
}

// ============================================
// Helpers para determinar tipo de mensaje Baileys
// ============================================
function _getMsgType(msg) {
  const m = msg.message;
  if (!m) return null;
  const base = unwrapMessage(m);
  if (base.audioMessage) return base.audioMessage.ptt ? 'ptt' : 'audio';
  if (base.imageMessage) return 'image';
  if (base.stickerMessage) return 'sticker';
  if (base.videoMessage) return 'video';
  if (base.documentMessage || base.documentWithCaptionMessage) return 'document';
  if (base.conversation || base.extendedTextMessage) return 'text';
  return null;
}

function _hasMedia(msg) {
  const t = _getMsgType(msg);
  return ['ptt', 'audio', 'image', 'sticker', 'video', 'document'].includes(t);
}

function _getMediaMimetype(msg) {
  const m = msg.message;
  if (!m) return '';
  const base = unwrapMessage(m);
  if (base.audioMessage) return base.audioMessage.mimetype || '';
  if (base.imageMessage) return base.imageMessage.mimetype || '';
  if (base.stickerMessage) return base.stickerMessage.mimetype || '';
  if (base.videoMessage) return base.videoMessage.mimetype || '';
  if (base.documentMessage) return base.documentMessage.mimetype || '';
  if (base.documentWithCaptionMessage?.message?.documentMessage) return base.documentWithCaptionMessage.message.documentMessage.mimetype || '';
  return '';
}

function _getDocumentFilename(msg) {
  const m = msg.message;
  if (!m) return 'documento';
  const base = unwrapMessage(m);
  if (base.documentMessage) return base.documentMessage.fileName || 'documento';
  if (base.documentWithCaptionMessage?.message?.documentMessage) return base.documentWithCaptionMessage.message.documentMessage.fileName || 'documento';
  return 'documento';
}

/**
 * Verifica si un texto es realmente legible (no basura binaria).
 */
function _isReadableText(text) {
  if (!text || text.length < 5) return false;
  const sample = text.substring(0, 500);
  const alphanumeric = (sample.match(/[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ0-9\s.,;:!?¿¡'"()\-]/g) || []).length;
  if (alphanumeric < sample.length * 0.6) return false;
  const words = sample.match(/[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ]{3,}/g) || [];
  if (words.length < 3) return false;
  if (sample.length > 50) {
    const chunk = sample.substring(0, 50);
    for (let len = 2; len <= 6; len++) {
      const pattern = chunk.substring(0, len);
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const repeats = (chunk.match(new RegExp(escaped, "g")) || []).length;
      if (repeats > 10) return false;
    }
  }
  return true;
}

/**
 * Extrae texto legible de una pagina web.
 */
async function _fetchUrlContent(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null;

    const html = await response.text();

    const sampleChars = html.substring(0, 200);
    const nonPrintable = (sampleChars.match(/[^\x20-\x7E\xA0-\xFF\n\r\t<>&;]/g) || []).length;
    if (nonPrintable > sampleChars.length * 0.3) {
      console.log("[Groq] URL devolvio contenido no legible (posible compresion)");
      return null;
    }

    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<\/?(p|br|div|h[1-6]|li|tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/  +/g, " ")
      .trim();

    if (text.length > 50 && !_isReadableText(text)) {
      console.log("[Groq] Texto extraido de URL no es legible");
      return null;
    }

    if (text.length > 3000) {
      text = text.substring(0, 3000) + "... (contenido truncado)";
    }

    return text.length > 50 ? text : null;
  } catch (error) {
    console.log("[Groq] Error fetching URL:", error.message);
    return null;
  }
}

/**
 * Extrae contexto del mensaje citado (reply) en Baileys.
 */
function _getQuotedContext(msg) {
  try {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo
      || msg.message?.imageMessage?.contextInfo
      || msg.message?.audioMessage?.contextInfo
      || msg.message?.videoMessage?.contextInfo
      || msg.message?.documentMessage?.contextInfo;

    if (!contextInfo?.quotedMessage) return null;

    const quoted = contextInfo.quotedMessage;
    let context = "";

    // Extraer texto del mensaje citado
    const quotedText = quoted.conversation
      || quoted.extendedTextMessage?.text
      || quoted.imageMessage?.caption
      || quoted.videoMessage?.caption
      || '';

    if (quotedText) {
      let body = quotedText.startsWith(_botPrefix) ? quotedText.substring(1) : quotedText;
      body = body.substring(0, 1000);
      context = _isReadableText(body) ? body : "[Contenido no legible]";
    }

    // Indicar tipo de media si hay
    if (quoted.imageMessage) context += (context ? "\n" : "") + "[Media: imagen]";
    if (quoted.audioMessage) context += (context ? "\n" : "") + "[Media: audio]";
    if (quoted.documentMessage) context += (context ? "\n" : "") + "[Media: documento]";
    if (quoted.videoMessage) context += (context ? "\n" : "") + "[Media: video]";

    return context ? "[Mensaje citado: " + context + "]" : null;
  } catch (error) {
    console.log("[Groq] Error obteniendo mensaje citado:", error.message);
    return null;
  }
}

/**
 * Procesa un documento (PDF, texto, etc.) y extrae su contenido.
 */
function _extractDocumentText(buffer, mime) {
  try {
    // Archivos de texto plano
    if (mime.includes("text/") || mime.includes("json") || mime.includes("xml") || mime.includes("javascript") || mime.includes("csv")) {
      const text = buffer.toString("utf-8");
      return text.length > 4000 ? text.substring(0, 4000) + "... (truncado)" : text;
    }

    // PDF - extraer texto basico
    if (mime.includes("pdf")) {
      const pdfText = buffer.toString("latin1");
      const textParts = [];
      const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      let match;
      while ((match = streamRegex.exec(pdfText)) !== null) {
        const tjMatches = match[1].match(/\(([^)]+)\)/g);
        if (tjMatches) {
          for (const tj of tjMatches) {
            const clean = tj.slice(1, -1)
              .replace(/\\n/g, "\n").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
            if (clean.length > 2 && _isReadableText(clean)) {
              textParts.push(clean);
            }
          }
        }
      }
      const extracted = textParts.join(" ").trim();
      if (extracted.length > 50 && _isReadableText(extracted)) {
        return extracted.length > 4000 ? extracted.substring(0, 4000) + "... (truncado)" : extracted;
      }
      return null;
    }

    return null;
  } catch (error) {
    console.log("[Groq] Error extrayendo texto del documento:", error.message);
    return null;
  }
}

/**
 * Parsea el tiempo de un recordatorio.
 */
function _parseReminderTime(words) {
  let totalMs = 0;
  let consumed = 0;

  const str = words.join(" ").toLowerCase();

  const compactMatch = str.match(/^(\d+[dhms])+$/);
  if (compactMatch) {
    const days = str.match(/(\d+)d/);
    const hours = str.match(/(\d+)h/);
    const minutes = str.match(/(\d+)m(?!s)/);
    const seconds = str.match(/(\d+)s/);
    if (days) totalMs += parseInt(days[1]) * 86400000;
    if (hours) totalMs += parseInt(hours[1]) * 3600000;
    if (minutes) totalMs += parseInt(minutes[1]) * 60000;
    if (seconds) totalMs += parseInt(seconds[1]) * 1000;
    return { ms: totalMs, consumed: 1 };
  }

  const timeUnits = {
    "segundo": 1000, "segundos": 1000, "seg": 1000, "s": 1000,
    "minuto": 60000, "minutos": 60000, "min": 60000, "m": 60000,
    "hora": 3600000, "horas": 3600000, "h": 3600000,
    "dia": 86400000, "dias": 86400000, "d": 86400000,
  };

  let i = 0;
  while (i < words.length) {
    const num = parseInt(words[i]);
    if (!isNaN(num) && i + 1 < words.length) {
      const unit = words[i + 1].toLowerCase().replace(/[.,;]$/, "");
      if (timeUnits[unit]) {
        totalMs += num * timeUnits[unit];
        consumed = i + 2;
        i += 2;
        continue;
      }
    }
    if (i === 0 && !isNaN(num) && (words.length === 1 || !timeUnits[words[1]?.toLowerCase()])) {
      totalMs = num * 60000;
      consumed = 1;
    }
    break;
  }

  return { ms: totalMs, consumed: consumed || 1 };
}

// ============================================
// Tracking y borrado de mensajes del bot
// ============================================
function _trackSentMessage(chatId, sentMsg) {
  if (!sentMsg?.key) return;
  if (!_chatMessageKeys.has(chatId)) _chatMessageKeys.set(chatId, []);
  const keys = _chatMessageKeys.get(chatId);
  keys.push({ key: sentMsg.key, ts: Date.now() });
  if (keys.length > MAX_TRACKED_MSGS) keys.splice(0, keys.length - MAX_TRACKED_MSGS);
}

async function _deleteChatMessages(sock, chatId) {
  const tracked = _chatMessageKeys.get(chatId);
  if (!tracked || tracked.length === 0) return 0;
  let deleted = 0;
  for (const { key } of [...tracked]) {
    try {
      await sock.sendMessage(chatId, { delete: key });
      deleted++;
      await new Promise(r => setTimeout(r, 120));
    } catch (_) {}
  }
  _chatMessageKeys.delete(chatId);
  console.log("[Groq] Mensajes borrados del chat:", deleted);
  return deleted;
}

// ============================================
// Limpieza inteligente: extrae memoria antes de limpiar
// ============================================
const MEMORY_MARKER_PROMPT = "\n\n--- MEMORIA PERSONAL ---\n";

async function _smartClearHistory(sock, jid, chatId, groqService) {
  const history = groqService.getHistory(chatId);
  let memoryMsg = null;

  if (history.length >= 4) {
    try {
      const memory = await groqService.extractMemory(chatId);
      if (memory) {
        const db = _getContactsDb();
        if (db) { try { await db.appendMemory(jid, memory); } catch (_) {} }

        const currentPrompt = groqService.getSystemPrompt(chatId);
        const date = new Date().toLocaleDateString("es-CO");
        let newPrompt;
        if (currentPrompt.includes(MEMORY_MARKER_PROMPT)) {
          newPrompt = currentPrompt + "\n\n[" + date + "]\n" + memory;
        } else {
          newPrompt = currentPrompt + MEMORY_MARKER_PROMPT + "[" + date + "]\n" + memory;
        }
        groqService.setCustomPrompt(chatId, newPrompt);
        const preview = memory.length > 280 ? memory.substring(0, 280) + "..." : memory;
        memoryMsg = "Chat limpiado.\n\n*Guarde en memoria:*\n_" + preview + "_\n\nPuedes seguir hablando, recuerdo lo importante.";
      }
    } catch (e) {
      console.error("[Groq] Error extrayendo memoria:", e.message);
    }
  }

  // Borrar mensajes del chat y luego limpiar historial
  groqService.clearHistory(chatId);
  _cleanupPromptSent.delete(chatId);
  await _deleteChatMessages(sock, jid);

  await _sendText(sock, jid, memoryMsg || "Chat limpiado. Puedes seguir hablando.");
}

/**
 * Procesa un mensaje individual con el bot de Groq.
 * @param {object} msg - Mensaje de Baileys (messages.upsert)
 * @param {object} sock - Socket de Baileys
 * @param {object} groqService - Instancia de GroqService
 */
async function handleGroqMessage(msg, sock, groqService) {
  const jid = msg.key.remoteJid;
  if (jid === "status@broadcast") return;

  // ANTI-BUCLE: Ignorar mensajes que el bot acaba de enviar
  if (msg.key.id && _sentMessageIds.has(msg.key.id)) return;

  // Anti-loop: ignorar mensajes con prefijo del bot
  const bodyText = getMessageText(msg);
  if (bodyText.startsWith(_botPrefix)) return;

  // Soporte de grupos: solo responder si mencionan al bot
  const isGroup = jid.endsWith("@g.us");
  if (isGroup) {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const mentionedJids = contextInfo?.mentionedJid || [];
    const myNumber = process.env.MY_NUMBER;
    const mentionedMe = myNumber && mentionedJids.some(id => id.includes(myNumber));
    const quotedMe = !!contextInfo?.quotedMessage;
    if (!mentionedMe && !quotedMe) return;
  }

  // Chats individuales: responder a cualquier JID (el router ya filtra quién llega aquí)
  // No aplicar restricción de self-chat — multi-usuario gestionado en router.js

  // Determinar tipo de media
  const msgType = _getMsgType(msg);
  const isVoice = msgType === 'ptt' || msgType === 'audio';
  const isImage = msgType === 'image' || msgType === 'sticker';
  const isDocument = msgType === 'document';

  // ANTI-BUCLE: Si es un audio y acabamos de responder con voz
  if (isVoice && msg.key.fromMe) {
    const lastResponse = _lastVoiceResponse.get(jid);
    if (lastResponse && (Date.now() - lastResponse) < 5000) return;
  }

  // Si no es texto, audio, imagen ni documento, ignorar
  const _body = bodyText;
  if (!isVoice && !isImage && !isDocument && !_body.trim()) return;

  const chatId = jid;
  const chatVoiceMode = _voiceModes.get(chatId) || false;

  let typingInterval = null;

  try {
    let userMessage;

    // ========== IMAGEN -> STICKER o VISION ==========
    if (isImage) {
      const caption = (bodyText || "").trim().toLowerCase();

      // Si el caption es /sticker, convertir la imagen a sticker directamente
      if (caption === "/sticker") {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        if (!buffer) {
          await _sendText(sock, jid, "No pude descargar la imagen.");
          return;
        }
        try {
          const webpBuffer = await _convertToWebpSticker(buffer);
          await sock.sendMessage(jid, { sticker: webpBuffer });
          console.log("[Groq] Sticker enviado (desde caption)");
        } catch (e) {
          console.error("[Groq] Error convirtiendo sticker:", e.message);
          await _sendText(sock, jid, "Error creando sticker. Asegurate de enviar una imagen.");
        }
        return;
      }

      console.log("[Groq] Imagen recibida, analizando con Vision...");
      typingInterval = _startPersistentTyping(sock, jid);

      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (!buffer) {
        _stopPersistentTyping(typingInterval);
        await _sendText(sock, jid, "No pude descargar la imagen.");
        return;
      }

      const base64 = buffer.toString('base64');
      const mimetype = _getMediaMimetype(msg);
      const userPrompt = caption || null;
      const reply = await groqService.vision(chatId, base64, mimetype, userPrompt);
      const formattedReply = _formatForWhatsApp(reply);

      _stopPersistentTyping(typingInterval);

      if (chatVoiceMode) {
        await sock.sendPresenceUpdate('recording', jid);
        await _sendVoiceReply(sock, jid, formattedReply, reply, groqService);
      } else {
        await sock.sendMessage(jid, { text: _botPrefix + formattedReply });
      }
      console.log("[Groq] Respuesta vision enviada");
      return;
    }

    // ========== DOCUMENTO -> ANALISIS ==========
    if (isDocument) {
      console.log("[Groq] Documento recibido, analizando...");
      typingInterval = _startPersistentTyping(sock, jid);

      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (!buffer) {
        _stopPersistentTyping(typingInterval);
        await _sendText(sock, jid, "No pude descargar el documento.");
        return;
      }

      groqService.stats.documents++;
      const mime = _getMediaMimetype(msg);
      const docText = _extractDocumentText(buffer, mime);
      if (!docText) {
        _stopPersistentTyping(typingInterval);
        const isPdf = mime.includes("pdf");
        const errorMsg = isPdf
          ? "Este PDF parece ser un documento escaneado (imagen) o esta protegido. No pude extraer texto legible.\n\nIntenta enviarlo como *imagen* (screenshot o foto) para analizarlo con Vision."
          : "No pude extraer texto de este tipo de documento (" + mime + ").";
        await _sendText(sock, jid, errorMsg);
        return;
      }

      const fileName = _getDocumentFilename(msg);
      const userPrompt = bodyText.trim();
      const prompt = userPrompt
        ? userPrompt + "\n\n[Contenido del archivo \"" + fileName + "\":\n" + docText + "]"
        : "Analiza y resume el contenido de este documento:\n\n[Archivo: \"" + fileName + "\"]\n" + docText;

      const reply = await groqService.chat(chatId, prompt);
      const formattedReply = _formatForWhatsApp(reply);
      _stopPersistentTyping(typingInterval);

      await sock.sendMessage(jid, { text: _botPrefix + formattedReply });
      console.log("[Groq] Respuesta documento enviada (" + fileName + ")");
      return;
    }

    // ========== VOZ -> TEXTO (Whisper STT) ==========
    if (isVoice) {
      console.log("[Groq] Audio recibido, transcribiendo con Whisper...");
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (!buffer) {
        await _sendText(sock, jid, "No pude descargar el audio.");
        return;
      }

      const inputId = Date.now();
      const mime = _getMediaMimetype(msg);
      const inputExt = mime.includes("ogg") ? "ogg" : "mp3";
      const inputPath = path.join(_tmpDir, inputId + "." + inputExt);
      fs.writeFileSync(inputPath, buffer);

      const wavPath = path.join(_tmpDir, inputId + ".wav");
      try {
        await execAsync(`"${ffmpegPath}" -i "${inputPath}" -ar 16000 -ac 1 -y "${wavPath}"`);
      } catch (e) {
        fs.copyFileSync(inputPath, wavPath);
      }

      try {
        userMessage = await groqService.transcribe(wavPath);
        console.log("[Groq] Transcripcion:", userMessage.substring(0, 80));
      } catch (e) {
        const errMsg = e.message === "RATE_LIMIT"
          ? "Limite de transcripciones alcanzado. Intenta en unos segundos."
          : "No pude transcribir el audio.";
        await _sendText(sock, jid, errMsg);
        _cleanupFiles(inputPath, wavPath);
        return;
      }

      await sock.sendMessage(jid, { text: _botPrefix + "_" + userMessage + "_" });
      _cleanupFiles(inputPath, wavPath);

      if (!userMessage || userMessage.trim() === "") {
        await _sendText(sock, jid, "No logre entender el audio. Puedes repetirlo?");
        return;
      }

    } else {
      // ========== TEXTO ==========
      userMessage = _body.trim();

      // En grupo, remover la mencion del texto
      if (isGroup && myNumber) {
        userMessage = userMessage.replace(new RegExp("@" + myNumber, "g"), "").trim();
      }

      const cmd = userMessage.toLowerCase();

      // ---- RESPUESTAS INTERACTIVAS (botones/listas) ----
      const interactive = getInteractiveResponse(msg);
      if (interactive && interactive.id) {
        // Confirmacion de limpieza de chat
        if (interactive.id === "limpiar_si") {
          _pendingClearConfirm.delete(chatId);
          await _smartClearHistory(sock, jid, chatId, groqService);
          return;
        }
        if (interactive.id === "limpiar_no") {
          _pendingClearConfirm.delete(chatId);
          await _sendText(sock, jid, "Entendido, el chat continua.");
          return;
        }
        // Seleccion de modelo
        if (interactive.id.startsWith("modelo_")) {
          const modelKey = interactive.id.replace("modelo_", "");
          if (modelKey === "reset" || modelKey === "default") {
            groqService.resetModel(chatId);
            await _sendText(sock, jid, "Modelo restaurado al por defecto: *" + groqService.model.split("/").pop() + "*");
          } else {
            const models = GroqService.AVAILABLE_MODELS;
            if (models[modelKey]) {
              groqService.setModel(chatId, models[modelKey].id);
              await _sendText(sock, jid, "Modelo cambiado a *" + models[modelKey].name + "*\n_" + models[modelKey].desc + "_");
            }
          }
          return;
        }
        // Seleccion de rol
        if (interactive.id.startsWith("role_")) {
          const roleKey = interactive.id.replace("role_", "");
          if (roleKey === "reset") {
            groqService.resetCustomPrompt(chatId);
            groqService.clearHistory(chatId);
            await _sendText(sock, jid, "Rol restaurado al por defecto. Conversacion reiniciada.");
          } else if (PRESET_ROLES[roleKey]) {
            groqService.setCustomPrompt(chatId, PRESET_ROLES[roleKey]);
            groqService.clearHistory(chatId);
            await _sendText(sock, jid, "Rol cambiado a *" + roleKey + "*. Conversacion reiniciada.\n\n_" + PRESET_ROLES[roleKey].substring(0, 100) + "..._");
          }
          return;
        }
      }

      // ---- SELECCION NUMERICA PENDIENTE (modelo/role) ----
      const num = parseInt(cmd, 10);
      if (!isNaN(num) && cmd === String(num)) {
        // Pendiente de confirmacion de limpieza
        const pendingClear = _pendingClearConfirm.get(chatId);
        if (pendingClear && (num === 1 || num === 2)) {
          _pendingClearConfirm.delete(chatId);
          if (num === 1) {
            await _smartClearHistory(sock, jid, chatId, groqService);
          } else {
            await _sendText(sock, jid, "Entendido, el chat continua.");
          }
          return;
        }

        // Pendiente de /modelo
        const pendingM = _pendingModelo.get(chatId);
        if (pendingM && num >= 1 && num <= pendingM.options.length) {
          _pendingModelo.delete(chatId);
          const modelKey = pendingM.options[num - 1];
          if (modelKey === "reset") {
            groqService.resetModel(chatId);
            await _sendText(sock, jid, "Modelo restaurado al por defecto: *" + groqService.model.split("/").pop() + "*");
          } else {
            const models = GroqService.AVAILABLE_MODELS;
            if (models[modelKey]) {
              groqService.setModel(chatId, models[modelKey].id);
              await _sendText(sock, jid, "Modelo cambiado a *" + models[modelKey].name + "*\n_" + models[modelKey].desc + "_");
            }
          }
          return;
        }

        // Pendiente de /role
        const pendingR = _pendingRole.get(chatId);
        if (pendingR && num >= 1 && num <= pendingR.options.length) {
          _pendingRole.delete(chatId);
          const roleKey = pendingR.options[num - 1];
          if (roleKey === "reset") {
            groqService.resetCustomPrompt(chatId);
            groqService.clearHistory(chatId);
            await _sendText(sock, jid, "Rol restaurado al por defecto. Conversacion reiniciada.");
          } else if (PRESET_ROLES[roleKey]) {
            groqService.setCustomPrompt(chatId, PRESET_ROLES[roleKey]);
            groqService.clearHistory(chatId);
            await _sendText(sock, jid, "Rol cambiado a *" + roleKey + "*. Conversacion reiniciada.\n\n_" + PRESET_ROLES[roleKey].substring(0, 100) + "..._");
          }
          return;
        }
      }

      // ---- COMANDOS ----

      if (cmd === "/reset" || cmd === "/nuevo") {
        await _smartClearHistory(sock, jid, chatId, groqService);
        return;
      }

      if (cmd === "/limpiar") {
        _pendingClearConfirm.set(chatId, { timestamp: Date.now() });
        const histLen = groqService.getHistory(chatId).length;
        await sendButtonMessage(sock, jid,
          "*Limpiar chat*\n\nTienes " + histLen + " mensajes en el historial.\nAntes de limpiar guardare lo importante en mi memoria.",
          "Responde 1 o 2",
          [
            { id: "limpiar_si", text: "Si, limpiar y guardar memoria", desc: "Guarda lo importante y comienza de nuevo" },
            { id: "limpiar_no", text: "No, continuar sin limpiar", desc: "Mantener el historial actual" },
          ]
        );
        return;
      }

      if (cmd === "/help" || cmd === "/ayuda") {
        const currentModel = groqService.getModel(chatId);
        const modelName = Object.values(GroqService.AVAILABLE_MODELS).find(m => m.id === currentModel)?.name || currentModel.split("/").pop();
        const currentRole = groqService.customPrompts.has(chatId) ? " (personalizado)" : "";
        const divider = '─'.repeat(25);
        await _sendText(sock, jid, [
          "*Groq IA*" + currentRole,
          divider,
          "",
          "Enviame texto, audio, imagen, documento o URL.",
          "",
          "*Comandos*",
          "  /modelo  -  Cambiar modelo de IA",
          "  /voz  -  Respuestas por voz",
          "  /role  -  Cambiar personalidad",
          "  /resumen  -  Resumen de conversacion",
          "  /stats  -  Estadisticas de uso",
          "  /exportar  -  Exportar conversacion",
          "  /sticker  -  Imagen a sticker",
          "  /gif _busqueda_  -  Enviar un GIF",
          "  /recordar _tiempo texto_  -  Recordatorio",
          "  /limpiar  -  Limpiar chat y guardar memoria",
          "  /reset  -  Reiniciar conversacion",
          "  /stop  -  Desactivar bot",
          "",
          "*Precios*",
          "  /dolar  -  TRM del dia",
          "  /btc  -  Precio Bitcoin",
          "  /eth  -  Precio Ethereum",
          "  /crypto _moneda_  -  Cualquier crypto",
          "  /alerta _crypto > precio_  -  Alerta",
          "  /alertas  -  Ver alertas activas",
          "",
          "*Automatico*",
          "  URLs  -  Analizo contenido web",
          "  Reply  -  Cito mensajes para contexto",
          "  Docs  -  Analizo archivos adjuntos",
          "  Grupos  -  Mencioname (@) para responder",
          "",
          divider,
          `Modelo: _${modelName}_`,
        ].join("\n"));
        return;
      }

      // /modelo - cambiar modelo
      if (cmd === "/modelo" || cmd === "/modelos") {
        const currentModel = groqService.getModel(chatId);
        const models = GroqService.AVAILABLE_MODELS;
        const currentName = Object.values(models).find(m => m.id === currentModel)?.name || currentModel.split("/").pop();

        const modelKeys = Object.keys(models);
        const rows = modelKeys.map((key) => ({
          id: "modelo_" + key,
          title: models[key].name + (models[key].id === currentModel ? " (activo)" : ""),
          description: models[key].desc,
        }));
        rows.push({ id: "modelo_reset", title: "Restaurar por defecto", description: "Volver al modelo original" });

        // Guardar opciones para seleccion numerica
        const optionKeys = [...modelKeys, "reset"];
        _pendingModelo.set(chatId, { options: optionKeys, timestamp: Date.now() });
        setTimeout(() => {
          const p = _pendingModelo.get(chatId);
          if (p && (Date.now() - p.timestamp) >= SELECTION_TIMEOUT) _pendingModelo.delete(chatId);
        }, SELECTION_TIMEOUT);

        await sendListMessage(sock, jid,
          "*Modelos de IA disponibles*\n\nActual: _" + currentName + "_",
          "Responde con el numero para cambiar",
          "Ver modelos",
          [{ title: "Modelos", rows }]
        );
        return;
      }

      const modelMatch = userMessage.match(/^\/modelo\s+(\S+)$/i);
      if (modelMatch) {
        const modelKey = modelMatch[1].toLowerCase();
        if (modelKey === "reset" || modelKey === "default") {
          groqService.resetModel(chatId);
          await _sendText(sock, jid, "Modelo restaurado al por defecto: *" + groqService.model.split("/").pop() + "*");
          return;
        }
        const models = GroqService.AVAILABLE_MODELS;
        if (models[modelKey]) {
          groqService.setModel(chatId, models[modelKey].id);
          await _sendText(sock, jid, "Modelo cambiado a *" + models[modelKey].name + "*\n_" + models[modelKey].desc + "_");
          return;
        }
        await _sendText(sock, jid, "Modelo no encontrado. Escribe /modelo para ver opciones.");
        return;
      }

      if (cmd === "/voz") {
        const newMode = !chatVoiceMode;
        _voiceModes.set(chatId, newMode);
        await _sendText(sock, jid, newMode
          ? "Modo voz *activado* - respondere con notas de voz"
          : "Modo voz *desactivado* - respondere con texto");
        return;
      }

      // /resumen - resumen de conversacion
      if (cmd === "/resumen") {
        typingInterval = _startPersistentTyping(sock, jid);
        const summary = await groqService.summarizeConversation(chatId);
        _stopPersistentTyping(typingInterval);
        await sock.sendMessage(jid, { text: _botPrefix + "*Resumen de la conversacion:*\n\n" + summary });
        return;
      }

      // /stats - estadisticas
      if (cmd === "/stats" || cmd === "/estadisticas") {
        const s = groqService.stats;
        const model = groqService.getModel(chatId);
        const modelName = Object.values(GroqService.AVAILABLE_MODELS).find(m => m.id === model)?.name || model.split("/").pop();
        const convos = groqService.conversations.size;
        const history = groqService.getHistory(chatId).length;
        const divider = '─'.repeat(25);
        await _sendText(sock, jid, [
          "*Estadisticas*",
          divider,
          "",
          `  Mensajes:  *${s.messages}*`,
          `  Imagenes:  *${s.images}*`,
          `  Audios:  *${s.audios}*`,
          `  URLs:  *${s.urls}*`,
          `  Documentos:  *${s.documents}*`,
          "",
          "*Sesion*",
          `  Modelo:  _${modelName}_`,
          `  Chats activos:  *${convos}*`,
          `  Mensajes aqui:  *${history}*`,
          `  Modo voz:  ${chatVoiceMode ? "*activado*" : "desactivado"}`,
          divider,
        ].join("\n"));
        return;
      }

      // /exportar - exportar conversacion
      if (cmd === "/exportar" || cmd === "/export") {
        const history = groqService.getHistory(chatId);
        if (history.length < 1) {
          await _sendText(sock, jid, "No hay conversacion para exportar.");
          return;
        }
        const lines = history.map(m => {
          const role = m.role === "user" ? "Tu" : "Bot";
          const content = typeof m.content === "string" ? m.content : "[media]";
          return role + ": " + content;
        });
        const exportText = "Conversacion exportada (" + new Date().toLocaleString("es-CO") + ")\n" +
          "Mensajes: " + history.length + "\n" +
          "=".repeat(40) + "\n\n" + lines.join("\n\n");

        const docBuffer = Buffer.from(exportText, "utf-8");
        const fileName = "conversacion_" + new Date().toISOString().slice(0, 10) + ".txt";
        await sock.sendMessage(jid, {
          document: docBuffer,
          mimetype: "text/plain",
          fileName: fileName,
          caption: _botPrefix + "Conversacion exportada (" + history.length + " mensajes)"
        });
        return;
      }

      // /recordar <tiempo> <texto>
      const reminderParts = userMessage.match(/^\/recordar\s+(.+)$/i);
      if (reminderParts) {
        const allWords = reminderParts[1].trim().split(/\s+/);
        const { ms: timeMs, consumed } = _parseReminderTime(allWords);
        const reminderText = allWords.slice(consumed).join(" ").trim();

        if (!reminderText) {
          await _sendText(sock, jid, "Falta el texto del recordatorio.\nEjemplo: /recordar 30m Llamar a mama");
          return;
        }

        if (timeMs < 10000 || timeMs > 86400000) {
          await _sendText(sock, jid, "El tiempo debe ser entre 10 segundos y 24 horas.\nEjemplos: /recordar 30m Llamar a mama, /recordar 2h Reunion");
          return;
        }

        const timeoutId = setTimeout(async () => {
          try {
            await sock.sendMessage(jid, { text: _botPrefix + "*Recordatorio:*\n\n" + reminderText });
          } catch (e) {
            console.log("[Groq] Error enviando recordatorio:", e.message);
          }
          const list = _reminders.get(chatId) || [];
          const idx = list.findIndex(r => r.timeout === timeoutId);
          if (idx >= 0) list.splice(idx, 1);
        }, timeMs);

        if (!_reminders.has(chatId)) _reminders.set(chatId, []);
        _reminders.get(chatId).push({ text: reminderText, timeout: timeoutId, time: Date.now() + timeMs });

        const minutes = Math.round(timeMs / 60000);
        const timeLabel = minutes >= 60 ? Math.floor(minutes / 60) + "h " + (minutes % 60) + "m" : minutes + " min";
        await _sendText(sock, jid, "Recordatorio programado en *" + timeLabel + "*:\n_" + reminderText + "_");
        return;
      }

      if (cmd === "/recordar") {
        await _sendText(sock, jid, "Uso: /recordar <tiempo> <texto>\n\nEjemplos:\n- /recordar 30m Llamar a mama\n- /recordar 2h Reunion de trabajo\n- /recordar 1d Pagar factura");
        return;
      }

      // /sticker - convertir imagen citada a sticker
      if (cmd === "/sticker" || cmd.startsWith("/sticker\n") || cmd.startsWith("/sticker ")) {
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo?.quotedMessage) {
          await _sendText(sock, jid, "Cita una imagen y escribe /sticker para convertirla.");
          return;
        }
        const quoted = contextInfo.quotedMessage;
        if (!quoted.imageMessage && !quoted.stickerMessage) {
          await _sendText(sock, jid, "El mensaje citado no es una imagen.");
          return;
        }
        // Download quoted image
        const quotedMsg = { message: quoted, key: { remoteJid: jid, id: contextInfo.stanzaId, fromMe: false, participant: contextInfo.participant } };
        let buffer;
        try {
          buffer = await downloadMediaMessage(quotedMsg, 'buffer', {});
        } catch (e) {
          console.error("[Groq] Error descargando imagen citada:", e.message);
          await _sendText(sock, jid, "No pude descargar la imagen citada.");
          return;
        }
        if (!buffer) {
          await _sendText(sock, jid, "No pude descargar la imagen.");
          return;
        }
        try {
          const webpBuffer = await _convertToWebpSticker(buffer);
          await sock.sendMessage(jid, { sticker: webpBuffer });
          console.log("[Groq] Sticker enviado (desde citado)");
        } catch (e) {
          console.error("[Groq] Error convirtiendo sticker:", e.message);
          await _sendText(sock, jid, "Error creando sticker: " + e.message.substring(0, 80));
        }
        return;
      }

      // /gif <busqueda> - Buscar y enviar GIF
      const gifMatch = userMessage.match(/^\/gif\s+(.+)$/i);
      if (gifMatch || cmd === "/gif") {
        const { searchGif } = require("./gifSearch");
        const query = gifMatch ? gifMatch[1].trim() : "";
        if (!query) {
          await _sendText(sock, jid, "Uso: /gif <busqueda>\n\nEjemplo: /gif risa");
          return;
        }
        try {
          typingInterval = _startPersistentTyping(sock, jid);
          const gifUrl = await searchGif(query);
          _stopPersistentTyping(typingInterval);
          if (!gifUrl) {
            await _sendText(sock, jid, "No encontre GIFs para: _" + query + "_");
            return;
          }
          // Descargar el MP4 de GIPHY
          const resp = await fetch(gifUrl);
          const gifBuffer = Buffer.from(await resp.arrayBuffer());
          await sock.sendMessage(jid, {
            video: gifBuffer,
            gifPlayback: true,
            caption: "",
          });
          console.log("[Groq] GIF enviado para:", query);
        } catch (e) {
          _stopPersistentTyping(typingInterval);
          console.error("[Groq] Error buscando GIF:", e.message);
          await _sendText(sock, jid, "Error buscando GIF: " + e.message.substring(0, 100));
        }
        return;
      }

      // ---- COMANDOS DE PRECIO / DOLAR / CRYPTO ----

      // /dolar - TRM del dia
      if (cmd === "/dolar" || cmd === "/trm") {
        try {
          typingInterval = _startPersistentTyping(sock, jid);
          const trm = await getTRM();
          _stopPersistentTyping(typingInterval);
          typingInterval = null;
          const rateFormatted = formatCOPPrice(trm.rate);
          await _sendText(sock, jid, [
            "💵 *TRM Colombia*",
            `Hoy: *${rateFormatted} COP* por 1 USD`,
            "",
            `Fuente: _${trm.source}_`,
          ].join("\n"));
        } catch (e) {
          _stopPersistentTyping(typingInterval);
          typingInterval = null;
          await _sendText(sock, jid, "Error obteniendo TRM: " + e.message.substring(0, 100));
        }
        return;
      }

      // /btc - Bitcoin rapido
      if (cmd === "/btc") {
        await _handleCryptoCommand(sock, jid, "bitcoin");
        return;
      }

      // /eth - Ethereum rapido
      if (cmd === "/eth") {
        await _handleCryptoCommand(sock, jid, "ethereum");
        return;
      }

      // /crypto <coin> - Precio de cualquier crypto
      const cryptoMatch = userMessage.match(/^\/crypto\s+(.+)$/i);
      if (cryptoMatch) {
        const query = cryptoMatch[1].trim().toLowerCase();
        await _handleCryptoCommand(sock, jid, query);
        return;
      }
      if (cmd === "/crypto") {
        await _sendText(sock, jid, "Uso: /crypto <moneda>\n\nEjemplos:\n- /crypto solana\n- /crypto doge\n- /crypto cardano\n\nAccesos rapidos: /btc, /eth, /dolar");
        return;
      }

      // /alerta - Crear alerta de precio
      const alertMatch = userMessage.match(/^\/alerta\s+(\S+)\s*(>|<)\s*([\d.,]+)$/i);
      if (alertMatch) {
        const coin = alertMatch[1].toLowerCase();
        const condition = alertMatch[2]; // > or <
        const target = parseFloat(alertMatch[3].replace(/,/g, ''));

        if (isNaN(target) || target <= 0) {
          await _sendText(sock, jid, "Precio invalido. Ejemplo: /alerta btc > 100000");
          return;
        }

        if (!_priceAlerts.has(chatId)) _priceAlerts.set(chatId, []);
        const alerts = _priceAlerts.get(chatId);

        if (alerts.length >= 10) {
          await _sendText(sock, jid, "Maximo 10 alertas activas. Usa /alertas borrar <num> para liberar espacio.");
          return;
        }

        alerts.push({ coin, condition, target, createdAt: Date.now() });

        const condLabel = condition === '>' ? 'suba por encima de' : 'baje por debajo de';
        await _sendText(sock, jid, `🔔 *Alerta creada*\nTe aviso cuando *${coin.toUpperCase()}* ${condLabel} *$${target.toLocaleString('en-US')}* USD`);

        // Iniciar polling si es la primera alerta
        _ensureAlertPolling(sock);
        return;
      }

      if (cmd === "/alerta") {
        await _sendText(sock, jid, "Uso: /alerta <crypto> <> o <>> <precio>\n\nEjemplos:\n- /alerta btc > 100000\n- /alerta eth < 2000\n- /alerta sol > 200");
        return;
      }

      // /alertas - Ver alertas activas
      if (cmd === "/alertas") {
        const alerts = _priceAlerts.get(chatId) || [];
        if (alerts.length === 0) {
          await _sendText(sock, jid, "No tienes alertas activas.\n\nCrear: /alerta btc > 100000");
          return;
        }

        const lines = alerts.map((a, i) => {
          const sym = a.condition === '>' ? '↑' : '↓';
          return `  ${i + 1}. *${a.coin.toUpperCase()}* ${a.condition} $${a.target.toLocaleString('en-US')} ${sym}`;
        });

        await _sendText(sock, jid, [
          "🔔 *Alertas activas*",
          "",
          ...lines,
          "",
          "Borrar: /alertas borrar <num>",
        ].join("\n"));
        return;
      }

      // /alertas borrar <num>
      const alertDelMatch = userMessage.match(/^\/alertas\s+borrar\s+(\d+)$/i);
      if (alertDelMatch) {
        const idx = parseInt(alertDelMatch[1]) - 1;
        const alerts = _priceAlerts.get(chatId) || [];
        if (idx < 0 || idx >= alerts.length) {
          await _sendText(sock, jid, "Numero invalido. Usa /alertas para ver la lista.");
          return;
        }
        const removed = alerts.splice(idx, 1)[0];
        await _sendText(sock, jid, `Alerta eliminada: *${removed.coin.toUpperCase()}* ${removed.condition} $${removed.target.toLocaleString('en-US')}`);
        return;
      }

      // /role sin argumentos
      if (cmd === "/role" || cmd === "/rol") {
        const current = groqService.customPrompts.has(chatId) ? "Personalizado" : "Por defecto";
        const roleDescriptions = {
          traductor: "Traduce entre espanol e ingles",
          programador: "Experto en codigo y debugging",
          tutor: "Explica conceptos de forma simple",
          escritor: "Redaccion y edicion de textos",
          fitness: "Ejercicio y nutricion",
          chef: "Recetas y tecnicas de cocina",
        };
        const roleKeys = Object.keys(PRESET_ROLES);
        const rows = roleKeys.map(name => ({
          id: "role_" + name,
          title: name.charAt(0).toUpperCase() + name.slice(1),
          description: roleDescriptions[name] || "",
        }));
        rows.push({ id: "role_reset", title: "Restaurar por defecto", description: "Volver al rol original" });

        // Guardar opciones para seleccion numerica
        const optionKeys = [...roleKeys, "reset"];
        _pendingRole.set(chatId, { options: optionKeys, timestamp: Date.now() });
        setTimeout(() => {
          const p = _pendingRole.get(chatId);
          if (p && (Date.now() - p.timestamp) >= SELECTION_TIMEOUT) _pendingRole.delete(chatId);
        }, SELECTION_TIMEOUT);

        await sendListMessage(sock, jid,
          "*Roles disponibles*\n\nActual: _" + current + "_\n\nRol personalizado: /role _Tu eres un experto en..._",
          "Responde con el numero para cambiar",
          "Ver roles",
          [{ title: "Roles", rows }]
        );
        return;
      }

      // /role <nombre o texto>
      const roleMatch = userMessage.match(/^\/(role|rol)\s+(.+)$/i);
      if (roleMatch) {
        const roleArg = roleMatch[2].trim().toLowerCase();
        if (roleArg === "reset" || roleArg === "default") {
          groqService.resetCustomPrompt(chatId);
          groqService.clearHistory(chatId);
          await _sendText(sock, jid, "Rol restaurado al por defecto. Conversacion reiniciada.");
          return;
        }
        if (PRESET_ROLES[roleArg]) {
          groqService.setCustomPrompt(chatId, PRESET_ROLES[roleArg]);
          groqService.clearHistory(chatId);
          await _sendText(sock, jid, "Rol cambiado a *" + roleArg + "*. Conversacion reiniciada.\n\n_" + PRESET_ROLES[roleArg].substring(0, 100) + "..._");
          return;
        }
        const customPrompt = roleMatch[2].trim();
        groqService.setCustomPrompt(chatId, customPrompt);
        groqService.clearHistory(chatId);
        await _sendText(sock, jid, "Rol personalizado activado. Conversacion reiniciada.\n\n_" + customPrompt.substring(0, 100) + "..._");
        return;
      }
    }

    // ========== CONTEXTO: QUOTED MESSAGE + URLs ==========
    let contextParts = [];

    // Contexto de mensaje citado
    const quotedContext = _getQuotedContext(msg);
    if (quotedContext) {
      contextParts.push(quotedContext);
    }

    // Detectar URLs y leer contenido
    if (userMessage) {
      const urls = userMessage.match(URL_REGEX);
      if (urls && urls.length > 0) {
        const urlsToFetch = urls.slice(0, 2);
        for (const url of urlsToFetch) {
          groqService.stats.urls++;
          console.log("[Groq] Leyendo URL:", url);
          const content = await _fetchUrlContent(url);
          if (content) {
            contextParts.push("[Contenido de " + url + ":\n" + content + "]");
          } else {
            contextParts.push("[No pude leer el contenido de " + url + "]");
          }
        }
      }
    }

    // Construir mensaje con contexto
    let fullMessage = userMessage;
    if (contextParts.length > 0) {
      fullMessage = contextParts.join("\n\n") + "\n\n" + userMessage;
    }

    // ========== PROCESAR CON IA ==========
    console.log("[Groq]", (userMessage || "").substring(0, 80) + "...");
    typingInterval = _startPersistentTyping(sock, jid);

    const reply = await groqService.chat(chatId, fullMessage);
    const formattedReply = _formatForWhatsApp(reply);

    _stopPersistentTyping(typingInterval);

    // ========== RESPONDER ==========
    if (chatVoiceMode || isVoice) {
      await sock.sendPresenceUpdate('recording', jid);
      await _sendVoiceReply(sock, jid, formattedReply, reply, groqService);
    } else {
      const sentMsg = await sock.sendMessage(jid, { text: _botPrefix + formattedReply });
      if (sentMsg) _trackSentMessage(jid, sentMsg);
    }

    console.log("[Groq] Respuesta enviada" + ((chatVoiceMode || isVoice) ? " (voz)" : " (texto)"));

    // ========== DETECCION DE CHAT EXTENSO (10 mensajes del usuario) ==========
    const history = groqService.getHistory(chatId);
    const userMsgCount = history.filter(m => m.role === 'user').length;
    if (userMsgCount >= USER_MSG_WARN_THRESHOLD && !_pendingClearConfirm.has(chatId)) {
      const lastPrompt = _cleanupPromptSent.get(chatId) || 0;
      if (Date.now() - lastPrompt > CLEANUP_PROMPT_COOLDOWN_MS) {
        _cleanupPromptSent.set(chatId, Date.now());
        _pendingClearConfirm.set(chatId, { timestamp: Date.now() });
        const sentBtn = await sendButtonMessage(sock, jid,
          "Llevamos " + userMsgCount + " mensajes\n\nLimpiar borra el chat y guarda lo importante en mi memoria.",
          "Usa /limpiar cuando quieras",
          [
            { id: "limpiar_si", text: "Limpiar y guardar memoria", desc: "Borra el chat y guarda lo importante" },
            { id: "limpiar_no", text: "Seguir hablando", desc: "Mantener el chat como esta" },
          ]
        );
        if (sentBtn) _trackSentMessage(jid, sentBtn);
      }
    }

  } catch (error) {
    _stopPersistentTyping(typingInterval);
    console.error("[Groq] Error:", error.message);
    try {
      await sock.sendMessage(jid, { text: _botPrefix + "Error procesando tu mensaje: " + error.message.substring(0, 100) });
    } catch (_) {}
  }
}

// ============================================
// Typing indicator persistente
// ============================================

function _startPersistentTyping(sock, jid) {
  sock.sendPresenceUpdate('composing', jid).catch(() => {});
  return setInterval(() => {
    try { sock.sendPresenceUpdate('composing', jid); } catch (_) {}
  }, 4000);
}

function _stopPersistentTyping(interval) {
  if (interval) clearInterval(interval);
}

// ============================================
// Respuesta de voz (FFmpeg async)
// ============================================

async function _sendVoiceReply(sock, jid, formattedReply, rawReply, groqService) {
  const audioId = Date.now();
  const wavPath = path.join(_tmpDir, audioId + "_tts.wav");
  const oggPath = path.join(_tmpDir, audioId + "_tts.ogg");

  try {
    await groqService.speak(rawReply, wavPath);

    let audioPath = wavPath;
    try {
      await execAsync(`"${ffmpegPath}" -i "${wavPath}" -c:a libopus -b:a 64k -y "${oggPath}"`);
      audioPath = oggPath;
    } catch (e) {
      console.log("[Groq] ffmpeg no disponible para OGG, enviando WAV");
    }

    const audioData = fs.readFileSync(audioPath);
    const mimetype = audioPath.endsWith(".ogg") ? "audio/ogg; codecs=opus" : "audio/wav";

    const sentMsg = await sock.sendMessage(jid, {
      audio: audioData,
      mimetype: mimetype,
      ptt: true,
    });

    _lastVoiceResponse.set(jid, Date.now());

    if (sentMsg && sentMsg.key) {
      _sentMessageIds.add(sentMsg.key.id);
      setTimeout(() => _sentMessageIds.delete(sentMsg.key.id), 10000);
      _trackSentMessage(jid, sentMsg);
    }

  } catch (error) {
    const reason = error.message === "RATE_LIMIT" ? "rate limit TTS" : error.message;
    console.log("[Groq] TTS fallo (" + reason + ") -> enviando texto");
    await sock.sendMessage(jid, { text: _botPrefix + formattedReply + "\n\n_Nota: no pude generar audio (" + reason + ")_" });
  } finally {
    _cleanupFiles(wavPath, oggPath);
  }
}

// ============================================
// Utilidades
// ============================================

async function _sendText(sock, jid, text) {
  const sent = await sock.sendMessage(jid, { text: _botPrefix + text });
  if (sent) _trackSentMessage(jid, sent);
  return sent;
}

function _formatForWhatsApp(text) {
  // Preservar bloques de codigo antes de cualquier transformacion
  const codeBlocks = [];
  let result = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match.replace(/```(\w*)\n?([\s\S]*?)```/, "```$2```"));
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });

  result = result
    // Inline code — preservar tal cual
    .replace(/`([^`\n]+)`/g, "`$1`")
    // **negrita** y __negrita__ → *negrita* (WhatsApp)
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "*$1*")
    // # Encabezados → *texto*
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    // [texto](url) → texto: url
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1: $2")
    // Lineas horizontales → eliminar
    .replace(/^[-=]{3,}$/gm, "")
    // Bullet lists con asterisco "* item" → "• item" (evita confusion con negrita)
    .replace(/^(\s*)\* (.+)$/gm, "$1• $2")
    // Quitar espacios dentro de negrita: * texto * → *texto*
    .replace(/\* ([^*\n]+?) \*/g, "*$1*")
    // Quitar espacios dentro de italica: _ texto _ → _texto_
    .replace(/_ ([^_\n]+?) _/g, "_$1_")
    // Limpiar 3+ saltos de linea consecutivos
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Restaurar bloques de codigo
  codeBlocks.forEach((block, i) => {
    result = result.replace(`\x00CODE${i}\x00`, block);
  });

  return result;
}

function _cleanupFiles(...files) {
  for (const f of files) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
  }
}

// ============================================
// Comandos de precio - helpers
// ============================================

async function _handleCryptoCommand(sock, jid, query) {
  let typingInterval = null;
  try {
    typingInterval = _startPersistentTyping(sock, jid);

    // Si no es un alias conocido, buscar en CoinGecko
    const { COIN_ALIASES } = require("./priceService");
    let coinId = COIN_ALIASES[query] || query;
    if (!COIN_ALIASES[query]) {
      const found = await searchCrypto(query);
      if (found) {
        coinId = found.id;
      }
    }

    const crypto = await getCryptoPrice(coinId);
    _stopPersistentTyping(typingInterval);

    // Obtener TRM para conversion a COP
    let copLine = "";
    if (crypto.price_cop) {
      copLine = `En COP: *${formatCOPPrice(crypto.price_cop)}*`;
    } else {
      try {
        const trm = await getTRM();
        copLine = `En COP: *${formatCOPPrice(crypto.price_usd * trm.rate)}*`;
      } catch (_) {}
    }

    const arrow = crypto.change_24h >= 0 ? "📈" : "📉";
    await _sendText(sock, jid, [
      `${arrow} *${crypto.name} (${crypto.symbol})*`,
      `Precio: *${formatUSD(crypto.price_usd)}* USD`,
      `24h: *${formatChangeArrow(crypto.change_24h)}*`,
      copLine,
    ].filter(Boolean).join("\n"));

  } catch (e) {
    _stopPersistentTyping(typingInterval);
    const msg = e.message.includes("no encontrada")
      ? "Crypto no encontrada: _" + query + "_\n\nEjemplos: /crypto solana, /crypto doge"
      : "Error: " + e.message.substring(0, 100);
    await _sendText(sock, jid, msg);
  }
}

// ============================================
// Sistema de alertas de precio
// ============================================

let _alertPollingInterval = null;

function _ensureAlertPolling(sock) {
  if (_alertPollingInterval) return;

  _alertPollingInterval = setInterval(async () => {
    // Verificar si hay alertas activas
    let totalAlerts = 0;
    for (const [chatId, alerts] of _priceAlerts.entries()) {
      totalAlerts += alerts.length;
    }

    if (totalAlerts === 0) {
      clearInterval(_alertPollingInterval);
      _alertPollingInterval = null;
      return;
    }

    // Verificar cada alerta
    for (const [chatId, alerts] of _priceAlerts.entries()) {
      const triggered = [];

      for (let i = alerts.length - 1; i >= 0; i--) {
        const alert = alerts[i];
        try {
          const crypto = await getCryptoPrice(alert.coin);
          const price = crypto.price_usd;
          const met = (alert.condition === '>' && price > alert.target) ||
                      (alert.condition === '<' && price < alert.target);

          if (met) {
            triggered.push({ ...alert, currentPrice: price, name: crypto.name, symbol: crypto.symbol });
            alerts.splice(i, 1);
          }
        } catch (_) {
          // Silenciar errores de polling
        }
      }

      // Enviar notificaciones
      for (const t of triggered) {
        try {
          const arrow = t.condition === '>' ? '📈 ↑' : '📉 ↓';
          await sock.sendMessage(chatId, {
            text: _botPrefix + [
              `🔔 *ALERTA DE PRECIO* ${arrow}`,
              "",
              `*${t.name} (${t.symbol})*`,
              `Precio actual: *${formatUSD(t.currentPrice)}* USD`,
              `Tu alerta: ${t.condition} $${t.target.toLocaleString('en-US')}`,
            ].join("\n")
          });
        } catch (e) {
          console.log("[Groq] Error enviando alerta:", e.message);
        }
      }
    }
  }, 5 * 60 * 1000); // Cada 5 minutos
}

module.exports = { handleGroqMessage, _priceAlerts, _ensureAlertPolling };
