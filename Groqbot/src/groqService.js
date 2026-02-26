// src/groqService.js
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");

let webSearch, WEB_SEARCH_TOOL;
try {
  const ws = require("./webSearch");
  webSearch = ws.webSearch;
  WEB_SEARCH_TOOL = ws.WEB_SEARCH_TOOL;
  console.log("[Groq] Modulo webSearch cargado correctamente");
} catch (err) {
  console.error("[Groq] ERROR cargando webSearch:", err.message);
  webSearch = null;
  WEB_SEARCH_TOOL = null;
}

// ============================================
// Conocimiento fijo del bot (identidad, creador, app)
// Siempre inyectado en el system prompt
// ============================================
const APP_KNOWLEDGE = `
=== IDENTIDAD Y CONOCIMIENTO BASE (siempre disponible) ===

NOMBRE DEL BOT: Cortana
CREADOR: Andrew
  - Desarrollador de automatizaciones con IA
  - Bogota, Colombia | 23 anos
  - Redes sociales: @andrewhypervenom (Instagram, TikTok, GitHub u otras)
  - Si alguien pregunta por el creador, habla de Andrew con orgullo y detalla su perfil

SOBRE ESTA APP (Cortana - WhatsApp Bot):
  - Bot de WhatsApp con IA creado por Andrew como proyecto personal/profesional
  - Backend: Node.js + Baileys (libreria WhatsApp Web unofficial)
  - IA: Groq API con modelos de Llama y Kimi (rapido, gratis tier generoso)
  - Base de datos: Supabase (PostgreSQL) para perfiles de usuario y memoria persistente
  - Hosting: Koyeb (gratis) con Docker
  - STT (voz a texto): Whisper large-v3-turbo via Groq
  - TTS (texto a voz): Orpheus v1 via Groq
  - Busqueda web: DuckDuckGo + scraping propio (sin API de pago)

MODELOS DE IA DISPONIBLES (comando /modelo):
  - Llama 4 Scout 17B (default): rapido, soporta vision de imagenes, 30K tokens/min
  - Llama 3.3 70B Versatile: mas inteligente, 12K tokens/min
  - Kimi K2: buena calidad general, 10K tokens/min
  - Llama 3.1 8B Instant: ultra rapido para tareas simples

CAPACIDADES DEL BOT:
  - Texto, voz (STT+TTS), imagenes (vision IA), documentos (PDF, txt, etc.), URLs
  - Busqueda web automatica e inteligente segun el tipo de pregunta
  - Recordatorios con tiempo flexible (/recordar 30m Llamar a mama)
  - Precios de cryptos en tiempo real + TRM Colombia (/btc /eth /dolar /crypto)
  - Alertas de precio para cryptos (/alerta btc > 100000)
  - Envio de GIFs animados (/gif busqueda)
  - Conversion de imagenes a stickers WebP (/sticker)
  - Citar mensajes para dar contexto a la IA (reply)
  - Multi-usuario: cada persona tiene su propia personalidad e historial
  - Memoria persistente: al limpiar el chat guarda datos importantes del usuario

COMANDOS DISPONIBLES:
  /ayuda          Ver todos los comandos
  /modelo         Cambiar modelo de IA
  /voz            Activar/desactivar respuestas por nota de voz
  /role [texto]   Cambiar personalidad (o elegir preset)
  /limpiar        Limpiar chat guardando memoria importante
  /reset /nuevo   Limpiar historial (guarda memoria)
  /resumen        Resumen de la conversacion actual
  /exportar       Descargar conversacion como archivo de texto
  /sticker        Convertir imagen citada a sticker WebP
  /gif [texto]    Buscar y enviar un GIF animado
  /recordar       Crear recordatorio: /recordar 2h Reunion
  /dolar /trm     TRM Colombia del dia (USD/COP)
  /btc /eth       Precio de Bitcoin o Ethereum
  /crypto [coin]  Precio de cualquier criptomoneda
  /alerta         Alerta de precio: /alerta eth < 2000
  /alertas        Ver y gestionar alertas activas
  /miperfil       Usuarios externos: cambiar su personalidad

COMPORTAMIENTO CON NUMEROS +58 (VENEZUELA) Y LISTA NEGRA:
  Cuando un numero venezolano (+58) o un numero en la lista negra del admin intenta
  contactar, el sistema les envia automaticamente este mensaje exacto:

  "🚨 *AVISO OFICIAL* 🚨

  Este número ha sido identificado, reportado y está siendo monitoreado por las autoridades competentes.

  Toda comunicación queda registrada y será entregada a los organismos de seguridad correspondientes.

  Le recomendamos abstenerse de continuar contactando este número.

  _Este es un aviso automatizado. No responda a este mensaje._"

  Es una medida anti-spam/anti-scam configurada por Andrew para disuadir scammers.

COMANDOS EXCLUSIVOS DEL ADMIN (Andrew):
  /briefing       Recibir noticias + clima del dia de Colombia
  /briefing hora  Programar el briefing diario
  /bot            Cambiar entre Groq IA y bot de Control de Gastos
  /bloquear       Agregar numero a lista negra
  /desbloquear    Quitar numero de lista negra
  /bloqueados     Ver lista negra
  /noticia [n]    Ver detalle de una noticia del briefing

USUARIOS EXTERNOS:
  Primera vez que escribe → onboarding: el bot pregunta como quiere que lo trate
  (personalidad, tono, contexto). Eso se guarda en Supabase y persiste.
  Con /miperfil pueden cambiar su personalidad en cualquier momento.

SI TE PREGUNTAN SOBRE TI MISMO O TU CREADOR:
  Responde con orgullo. Eres Cortana, un bot de WhatsApp con IA creado por Andrew,
  desarrollador colombiano de 23 anos especializado en automatizaciones con IA.
  Puedes explicar como funciona la app, que tecnologias usa, y que puede hacer.
=== FIN CONOCIMIENTO BASE ===`;

const CONVERSATION_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_RETRIES = 3;
const MAX_INPUT_LENGTH = 4000;

// Modelos disponibles en Groq
const AVAILABLE_MODELS = {
  "scout": { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout", desc: "Rapido, 30K tok/min, vision" },
  "versatile": { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", desc: "Mas inteligente, 12K tok/min" },
  "kimi": { id: "moonshotai/kimi-k2-instruct", name: "Kimi K2", desc: "Buena calidad, 10K tok/min" },
  "instant": { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", desc: "Ultra rapido, menos inteligente" },
};

class GroqService {
  constructor() {
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.model = process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
    this.defaultSystemPrompt = process.env.BOT_PERSONALITY || "Eres un asistente util.";
    this.maxHistory = parseInt(process.env.MAX_HISTORY) || 20;
    this.ttsVoice = process.env.TTS_VOICE || "leda";
    this.ttsModel = "canopylabs/orpheus-v1-english";
    this.sttModel = "whisper-large-v3-turbo";

    // Map<userId, { messages, lastActivity }>
    this.conversations = new Map();
    // Map<userId, string>
    this.customPrompts = new Map();
    // Map<userId, string> - modelo per-chat
    this.chatModels = new Map();
    // Stats globales
    this.stats = { messages: 0, searches: 0, images: 0, audios: 0, urls: 0, documents: 0 };

    this._cleanupInterval = setInterval(() => this._cleanupStale(), CLEANUP_INTERVAL_MS);
  }

  // ============================================
  // Historial con TTL
  // ============================================
  _getConversation(userId) {
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, { messages: [], lastActivity: Date.now() });
    }
    const conv = this.conversations.get(userId);
    conv.lastActivity = Date.now();
    return conv;
  }

  getHistory(userId) { return this._getConversation(userId).messages; }

  addToHistory(userId, role, content) {
    const conv = this._getConversation(userId);
    conv.messages.push({ role, content });
    if (conv.messages.length > this.maxHistory) {
      conv.messages = conv.messages.slice(-this.maxHistory);
    }
  }

  clearHistory(userId) { this.conversations.delete(userId); }

  _cleanupStale() {
    const now = Date.now();
    let cleaned = 0;
    for (const [userId, conv] of this.conversations) {
      if (now - conv.lastActivity > CONVERSATION_TTL_MS) {
        this.conversations.delete(userId);
        cleaned++;
      }
    }
    if (cleaned > 0) console.log(`[Groq] Limpieza: ${cleaned} conversaciones expiradas`);
  }

  // ============================================
  // System prompt / modelo per-chat
  // ============================================
  getSystemPrompt(userId) { return this.customPrompts.get(userId) || this.defaultSystemPrompt; }
  setCustomPrompt(userId, prompt) { this.customPrompts.set(userId, prompt); }
  resetCustomPrompt(userId) { this.customPrompts.delete(userId); }

  getModel(userId) { return this.chatModels.get(userId) || this.model; }
  setModel(userId, modelId) { this.chatModels.set(userId, modelId); }
  resetModel(userId) { this.chatModels.delete(userId); }

  // ============================================
  // Deteccion proactiva de busqueda web
  // ============================================

  /**
   * Determina si el mensaje del usuario probablemente necesita info de internet.
   * Retorna { search: boolean, query: string }
   */
  _shouldProactiveSearch(message) {
    if (!message || typeof message !== "string") return { search: false, query: "" };
    const msg = message.toLowerCase().trim();
    // Ignorar mensajes muy cortos o que son solo saludos
    if (msg.length < 8) return { search: false, query: "" };
    // Ignorar si ya trae contexto de URL o documento inyectado
    if (msg.includes("[contenido de http") || msg.includes("[archivo:")) return { search: false, query: "" };

    // Patrones que indican necesidad de info actualizada
    const SEARCH_TRIGGERS = [
      // Preguntas directas sobre entidades
      /^(quien|quién|quienes|quiénes)\s+(es|son|fue|era)/i,
      /^(que|qué)\s+(es|son|fue|significa|paso|pasó)\s/i,
      /^(como|cómo)\s+(esta|está|van|va|quedo|quedó)\s/i,
      /^(donde|dónde|cuando|cuándo|cuanto|cuánto)\s/i,
      // Temas temporales
      /\b(hoy|ayer|esta semana|este mes|este año|actualmente|ahora mismo|en este momento)\b/i,
      /\b(202[4-9]|203\d)\b/, // Años posteriores al conocimiento del modelo
      /\b(ultimo|última|últimos|últimas|reciente|recientes|nueva|nuevo|nuevas|nuevos)\b/i,
      /\b(noticias|noticia|actualidad|tendencia|trending)\b/i,
      // Datos cambiantes
      /\b(precio|cotizacion|cotización|valor|cuesta|vale|costo)\b.*\b(hoy|actual|dolar|dólar|euro|bitcoin|btc|eth|peso)\b/i,
      /\b(dolar|dólar|euro|bitcoin|btc|eth|peso)\b.*\b(precio|cotizacion|cotización|valor|hoy|actual)\b/i,
      /\b(clima|tiempo|temperatura|pronostico|pronóstico)\b.*\b(en|de|hoy|mañana)\b/i,
      /\b(resultado|marcador|score|ganó|gano|perdió|perdio)\b.*\b(partido|juego|liga|champions|mundial)\b/i,
      // Entidades/personas publicas
      /\b(presidente|ministro|alcalde|gobernador|papa|rey|reina|ceo)\b/i,
      // Peticiones explicitas
      /\b(busca|investiga|averigua|googlea|search|dime.*actual)\b/i,
      // Comparaciones actuales
      /\b(mejor|top|ranking|comparar|vs\.?|versus)\b.*\b(202[4-9]|actual|ahora)\b/i,
    ];

    for (const pattern of SEARCH_TRIGGERS) {
      if (pattern.test(msg)) {
        // Limpiar el query para busqueda: remover prefijos de pregunta
        let query = message.trim()
          .replace(/^(oye|hey|dime|me puedes decir|puedes buscar|busca|investiga|averigua)\s*/i, "")
          .replace(/[?¿!¡]+/g, "")
          .trim();
        if (query.length < 5) query = message.trim();
        return { search: true, query };
      }
    }

    return { search: false, query: "" };
  }

  /**
   * Detecta si la respuesta del modelo contiene frases de incertidumbre
   * que indican que deberia haber buscado en internet.
   */
  _hasUncertainty(response) {
    if (!response || typeof response !== "string") return false;
    const r = response.toLowerCase();
    const UNCERTAINTY_PATTERNS = [
      /no tengo (acceso|información|datos|forma de (verificar|confirmar|acceder|buscar))/,
      /no (puedo|es posible) (acceder|verificar|confirmar|buscar|consultar)/,
      /mi (conocimiento|información|datos).*llega (hasta|solo hasta)/,
      /hasta (mi fecha|diciembre|enero|febrero|marzo).*de corte/,
      /no (estoy seguro|tengo certeza|puedo asegurar|dispongo)/,
      /no cuento con (información|datos)/,
      /te recomiendo (buscar|consultar|verificar)/,
      /seria? (mejor|bueno) (que )?(consultes|busques|verifiques)/,
      /no tengo.*actualizada/,
      /lamento no (poder|tener)/,
      /desafortunadamente.*(no puedo|no tengo)/,
      /i (don'?t have|cannot|can'?t) (access|verify|confirm)/,
      /my (knowledge|training|data).*(cut ?off|ends|limited)/,
    ];

    for (const pattern of UNCERTAINTY_PATTERNS) {
      if (pattern.test(r)) return true;
    }
    return false;
  }

  // ============================================
  // Retry con exponential backoff
  // ============================================
  async _withRetry(fn, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (error.status === 429 && attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`[Groq] Rate limit, reintentando en ${delay}ms (${attempt + 1}/${retries})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw error;
      }
    }
  }

  // ============================================
  // Chat con busqueda web inteligente (proactiva + tool calling + post-validacion)
  // ============================================
  async chat(userId, userMessage) {
    this.stats.messages++;
    if (typeof userMessage === "string" && userMessage.length > MAX_INPUT_LENGTH) {
      userMessage = userMessage.substring(0, MAX_INPUT_LENGTH) + "... (truncado)";
    }

    this.addToHistory(userId, "user", userMessage);

    const currentModel = this.getModel(userId);
    const dateStr = new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    let didSearch = false;

    // ---- CAPA 1: Busqueda proactiva ----
    let proactiveResults = null;
    if (webSearch && typeof userMessage === "string") {
      const { search, query } = this._shouldProactiveSearch(userMessage);
      if (search) {
        console.log("[Groq] Busqueda proactiva detectada: \"" + query.substring(0, 80) + "\"");
        this.stats.searches++;
        try {
          proactiveResults = await webSearch(query);
          didSearch = true;
          console.log("[Groq] Resultados proactivos obtenidos");
        } catch (e) {
          console.log("[Groq] Busqueda proactiva fallo:", e.message);
        }
      }
    }

    // ---- Construir system prompt ----
    let systemPrompt = this.getSystemPrompt(userId) +
      "\n\n" + APP_KNOWLEDGE +
      "\n\nFecha actual: " + dateStr + "." +
      "\n\nREGLAS CRITICAS:" +
      "\n- Tu conocimiento llega hasta diciembre 2023. NUNCA inventes datos posteriores a esa fecha." +
      "\n- Si no estas 100% seguro de un dato, USA la herramienta web_search para verificar." +
      "\n- NUNCA digas 'no tengo acceso a internet' ni 'no puedo buscar'. SIEMPRE tienes la herramienta web_search disponible." +
      "\n- Para preguntas sobre personas, eventos, precios, noticias o datos actuales: OBLIGATORIO usar web_search." +
      "\n- Prefiere dar informacion verificada a inventar. Si no sabes, busca.";

    if (proactiveResults) {
      systemPrompt += "\n\n[INFORMACION ACTUALIZADA DE INTERNET - Usa estos datos como fuente principal para tu respuesta]:\n" + proactiveResults;
    }

    const messages = [
      { role: "system", content: systemPrompt },
      ...this.getHistory(userId),
    ];

    try {
      // Si ya tenemos resultados proactivos, no necesitamos tools (evita tool calls malformados)
      const useTools = !didSearch && !!(WEB_SEARCH_TOOL && webSearch);
      const params = { model: currentModel, messages, temperature: 0.7, max_tokens: 1024, top_p: 0.9 };
      if (useTools) { params.tools = [WEB_SEARCH_TOOL]; params.tool_choice = "auto"; }

      console.log("[Groq] Chat (model: " + currentModel.split("/").pop() + ", tools: " + useTools + ", proactive: " + didSearch + ")");

      let completion;
      try {
        completion = await this._withRetry(() => this.client.chat.completions.create(params));
      } catch (toolError) {
        // Si el modelo genera un tool call malformado (tool_use_failed), reintentar sin tools
        if (toolError.status === 400 && toolError.message?.includes("tool_use_failed")) {
          console.log("[Groq] Tool call malformado, reintentando sin tools...");
          delete params.tools;
          delete params.tool_choice;
          // Si no teniamos busqueda proactiva, hacerla ahora como compensacion
          if (!didSearch && webSearch) {
            const fallbackQuery = (typeof userMessage === "string" ? userMessage : "").trim()
              .replace(/[?¿!¡]+/g, "").trim();
            try {
              const fallbackResults = await webSearch(fallbackQuery);
              didSearch = true;
              this.stats.searches++;
              messages[0] = { role: "system", content: systemPrompt + "\n\n[INFORMACION ACTUALIZADA DE INTERNET]:\n" + fallbackResults };
              console.log("[Groq] Busqueda de compensacion completada");
            } catch (_) {}
          }
          completion = await this._withRetry(() => this.client.chat.completions.create(params));
        } else {
          throw toolError;
        }
      }

      const msg = completion.choices[0].message;

      // ---- Procesar tool calls del modelo ----
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        console.log("[Groq] " + msg.tool_calls.length + " busqueda(s) web solicitada(s) por modelo");
        messages.push(msg);
        didSearch = true;

        for (const tc of msg.tool_calls) {
          if (tc.function.name === "web_search") {
            let args;
            try { args = JSON.parse(tc.function.arguments); } catch { args = { query: userMessage }; }
            console.log("[Groq] Buscando: \"" + args.query + "\"");
            this.stats.searches++;
            const results = await webSearch(args.query);
            messages.push({ role: "tool", tool_call_id: tc.id, content: results });
          }
        }

        const final = await this._withRetry(() =>
          this.client.chat.completions.create({ model: currentModel, messages, temperature: 0.7, max_tokens: 1024, top_p: 0.9 })
        );
        const reply = final.choices[0]?.message?.content || "No pude generar respuesta con los resultados.";
        this.addToHistory(userId, "assistant", reply);
        return reply;
      }

      // ---- Respuesta sin tool call ----
      let reply = msg.content || "No pude generar una respuesta.";

      // ---- CAPA 2: Post-validacion - detectar incertidumbre ----
      if (!didSearch && webSearch && this._hasUncertainty(reply)) {
        console.log("[Groq] Incertidumbre detectada en respuesta, forzando busqueda web...");
        this.stats.searches++;
        try {
          const searchQuery = (typeof userMessage === "string" ? userMessage : "").trim()
            .replace(/^(oye|hey|dime|me puedes decir)\s*/i, "")
            .replace(/[?¿!¡]+/g, "").trim();

          const searchResults = await webSearch(searchQuery || userMessage);
          didSearch = true;

          const retryMessages = [
            { role: "system", content: systemPrompt + "\n\n[INFORMACION ACTUALIZADA DE INTERNET - DEBES usar estos datos para responder]:\n" + searchResults },
            ...this.getHistory(userId),
          ];

          console.log("[Groq] Re-enviando con resultados de busqueda forzada");
          const retryCompletion = await this._withRetry(() =>
            this.client.chat.completions.create({ model: currentModel, messages: retryMessages, temperature: 0.7, max_tokens: 1024, top_p: 0.9 })
          );
          reply = retryCompletion.choices[0]?.message?.content || reply;
        } catch (e) {
          console.log("[Groq] Busqueda forzada fallo:", e.message);
        }
      }

      this.addToHistory(userId, "assistant", reply);
      return reply;

    } catch (error) {
      console.error("[Groq] Error Chat:", error.message);
      if (error.status === 429) return "Limite de solicitudes alcanzado. Espera un minuto.";
      if (error.message?.includes("token")) { this.clearHistory(userId); return "Conversacion reiniciada (muy larga). Puedes seguir preguntando."; }
      return "Error al procesar tu mensaje. Intenta de nuevo.";
    }
  }

  // ============================================
  // Vision
  // ============================================
  async vision(userId, imageBase64, mimeType, userPrompt) {
    this.stats.images++;
    const prompt = userPrompt || "Describe esta imagen en detalle.";
    if (prompt.length > MAX_INPUT_LENGTH) return "Texto demasiado largo. Max " + MAX_INPUT_LENGTH + " caracteres.";

    const userContent = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
    ];
    this.addToHistory(userId, "user", prompt + " [imagen]");

    const messages = [
      { role: "system", content: this.getSystemPrompt(userId) + "\n\n" + APP_KNOWLEDGE },
      ...this.getHistory(userId).slice(0, -1),
      { role: "user", content: userContent },
    ];

    try {
      // Vision solo funciona con modelos que lo soportan (scout)
      const visionModel = this.model; // Siempre usar scout para vision
      const completion = await this._withRetry(() =>
        this.client.chat.completions.create({ model: visionModel, messages, temperature: 0.7, max_tokens: 1024, top_p: 0.9 })
      );
      const reply = completion.choices[0]?.message?.content || "No pude analizar la imagen.";
      this.addToHistory(userId, "assistant", reply);
      return reply;
    } catch (error) {
      console.error("[Groq] Error Vision:", error.message);
      if (error.status === 429) return "Limite alcanzado. Espera un momento.";
      return "Error al analizar la imagen.";
    }
  }

  // ============================================
  // Resumen de conversacion
  // ============================================
  async summarizeConversation(userId) {
    const history = this.getHistory(userId);
    if (history.length < 2) return "No hay suficiente conversacion para resumir.";

    const messages = [
      { role: "system", content: "Genera un resumen conciso de la siguiente conversacion en espanol. Destaca los temas principales, decisiones y datos importantes." },
      { role: "user", content: history.map(m => m.role + ": " + (typeof m.content === "string" ? m.content : "[media]")).join("\n") },
    ];

    try {
      const completion = await this._withRetry(() =>
        this.client.chat.completions.create({ model: this.getModel(userId), messages, temperature: 0.3, max_tokens: 512 })
      );
      return completion.choices[0]?.message?.content || "No pude generar el resumen.";
    } catch (error) {
      return "Error al generar resumen: " + error.message;
    }
  }

  // ============================================
  // Extraccion de memoria de conversacion
  // ============================================
  async extractMemory(userId) {
    const history = this.getHistory(userId);
    if (history.length < 4) return null;

    const convText = history
      .map(m => (m.role === "user" ? "Usuario" : "Bot") + ": " +
        (typeof m.content === "string" ? m.content.substring(0, 300) : "[media]"))
      .join("\n");

    const messages = [
      {
        role: "system",
        content: "Extrae informacion relevante de esta conversacion para guardar en memoria permanente. Incluye SOLO datos concretos: nombre del usuario, gustos confirmados, preferencias, datos personales importantes, fechas relevantes, metas, temas frecuentes, relaciones mencionadas. Escribe una lista de hechos concisos en espanol. Si no hay informacion relevante que guardar, responde unicamente la palabra: sin_memoria",
      },
      { role: "user", content: convText },
    ];

    try {
      const completion = await this._withRetry(() =>
        this.client.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages,
          temperature: 0.1,
          max_tokens: 350,
        })
      );
      const result = (completion.choices[0]?.message?.content || "").trim();
      if (!result || result.toLowerCase().includes("sin_memoria")) return null;
      return result;
    } catch (error) {
      console.error("[Groq] Error extrayendo memoria:", error.message);
      return null;
    }
  }

  // ============================================
  // STT / TTS
  // ============================================
  async transcribe(audioFilePath) {
    this.stats.audios++;
    return this._withRetry(async () => {
      const fileStream = fs.createReadStream(audioFilePath);
      try {
        const t = await this.client.audio.transcriptions.create({ file: fileStream, model: this.sttModel, language: "es", response_format: "json" });
        return t.text || "";
      } finally { fileStream.destroy(); }
    });
  }

  async speak(text, outputPath) {
    const cleaned = this._cleanForTTS(text);
    if (!cleaned || cleaned.length < 2) throw new Error("Texto vacio");
    return this._withRetry(async () => {
      const response = await fetch("https://api.groq.com/openai/v1/audio/speech", {
        method: "POST",
        headers: { "Authorization": "Bearer " + process.env.GROQ_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.ttsModel, voice: this.ttsVoice, input: cleaned, response_format: "wav" }),
      });
      if (!response.ok) {
        const body = await response.text();
        if (response.status === 429) throw Object.assign(new Error("RATE_LIMIT"), { status: 429 });
        throw new Error("TTS HTTP " + response.status);
      }
      await fs.promises.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
      return outputPath;
    });
  }

  _cleanForTTS(text) {
    return text
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}]/gu, "")
      .replace(/[*_~`]/g, "").replace(/```[\s\S]*?```/g, "")
      .replace(/[\u200B-\u200F\uFEFF]/g, "")
      .replace(/\n{3,}/g, "\n\n").replace(/  +/g, " ")
      .trim().substring(0, 4000);
  }
}

GroqService.AVAILABLE_MODELS = AVAILABLE_MODELS;
module.exports = GroqService;
