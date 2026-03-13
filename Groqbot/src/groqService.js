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

// APIs gratuitas sin API key (clima, divisas, países, sismos, festivos)
let FREE_API_TOOLS = [], callFreeApiTool = null, detectProactiveTool = null;
try {
  const fat = require("./freeApiTools");
  FREE_API_TOOLS = fat.FREE_API_TOOLS || [];
  callFreeApiTool = fat.callFreeApiTool;
  detectProactiveTool = fat.detectProactiveTool;
  console.log("[Groq] freeApiTools cargado: " + FREE_API_TOOLS.length + " herramientas");
} catch (err) {
  console.error("[Groq] ERROR cargando freeApiTools:", err.message);
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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STACK TECNICO COMPLETO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LENGUAJE Y RUNTIME:
  - JavaScript (Node.js v20) — 100% del backend
  - Sin TypeScript, sin transpilacion, JS puro con CommonJS (require/module.exports)

FRAMEWORK Y SERVIDOR:
  - Express.js — servidor HTTP interno para health checks y dashboard
  - Baileys — libreria open-source unofficial de WhatsApp Web (WebSocket)
    Baileys conecta el bot a WhatsApp simulando un cliente web real.
    No usa la API oficial de WhatsApp Business (que es de pago).

INTELIGENCIA ARTIFICIAL — Groq API:
  - Proveedor: Groq (groq.com) — inferencia ultra-rapida en hardware LPU propio
  - SDK: groq SDK oficial para Node.js (@groq-sdk)
  - Modelos disponibles:
      Llama 4 Scout 17B (meta-llama/llama-4-scout-17b-16e-instruct) — modelo principal
      Llama 3.3 70B Versatile — mas inteligente
      Kimi K2 (moonshotai/kimi-k2-instruct) — buena calidad general
      Llama 3.1 8B Instant — ultra rapido
  - STT (voz → texto): Whisper large-v3-turbo via Groq
  - TTS (texto → voz): Orpheus v1 (playai-tts via Groq)
  - Busqueda web dentro del chat: tool_use con DuckDuckGo scraping propio
  - Onboarding de gastos: usa Groq (llama-3.3-70b) para parsear respuestas del usuario

BASE DE DATOS — Supabase:
  - Proveedor: Supabase (supabase.com) — PostgreSQL gestionado en la nube
  - SDK: @supabase/supabase-js
  - Tabla contacts: perfiles, personalidades, preferencias, datos de gastos por usuario
    Columnas relevantes:
      jid TEXT PRIMARY KEY          — identificador unico WhatsApp
      name TEXT                     — nombre push
      personality TEXT              — prompt de personalidad del usuario
      onboarding_done BOOLEAN       — si completo el onboarding de Cortana
      preferences JSONB             — prefs del briefing (horarios, criptos, etc.)
      gastos_data JSONB             — todos los datos del bot de finanzas del usuario
  - Tabla auth_sessions: estado de sesion de Baileys (para no perder sesion al reiniciar)
  - La sesion de WhatsApp se guarda en Supabase, no en archivos locales

HOJAS DE CALCULO — Google Sheets API:
  - Proveedor: Google Sheets + Google Drive API v4
  - SDK: google-spreadsheet (npm) + googleapis (npm)
  - Autenticacion: Service Account (JSON de credenciales en GOOGLE_CREDENTIALS_BASE64)
  - Cada usuario tiene su propio Google Spreadsheet privado
  - El usuario crea la hoja, comparte con el service account, envia el link al bot
  - Pestanas por mes: "Febrero 2026", "Marzo 2026", etc.
  - Pestanas especiales: Resumen, Configuracion, Ahorros

DESPLIEGUE — Koyeb:
  - Plataforma: Koyeb (koyeb.com) — free tier, siempre activo (no duerme)
  - Contenedor: Docker (Dockerfile en la raiz del repo)
    Base image: node:20-slim + ffmpeg (para audio)
  - Source: GitHub → https://github.com/pruebasn8n8-del/whatsapp-bot.git
  - Auto-deploy: cada push a master en ese repo triggerea un nuevo deploy
  - Variables de entorno configuradas directamente en el dashboard de Koyeb
  - Keep-alive: el bot se hace ping a si mismo cada 10 min para no dormir
  - Health check: GET /health (Express)
  - UptimeRobot: monitoreo externo que hace ping al endpoint /health cada 5 min
    para mantener el servicio activo y recibir alertas si cae

REPOSITORIO Y CONTROL DE VERSIONES:
  - Git con dos remotos:
      github → https://github.com/pruebasn8n8-del/whatsapp-bot.git (Koyeb, produccion)
      origin → Hugging Face Spaces (secundario/backup)
  - Rama principal: master
  - Comando para deployar: git push github master

NOTICIAS Y PRECIOS EN TIEMPO REAL:
  - Noticias: Google News RSS (sin API key) — topics como colombia, tecnologia, economia
  - TRM Colombia: scraping de datos.gov.co (API gratuita del gobierno)
  - Criptomonedas: CoinGecko API (free tier, sin key)
  - Divisas (EUR, GBP, etc.): ExchangeRate-API o similar (free tier)
  - Briefing automatico: cron jobs a las 7:00, 13:00, 19:00 (America/Bogota)

ESTRUCTURA DEL PROYECTO (monorepo):
  src/              — Core: router, Baileys, Supabase, onboarding
  Groqbot/          — Bot de IA: Groq, busqueda web, voz, stickers, GIFs
  Gastos/           — Bot de finanzas: Google Sheets, parseo de gastos con IA
  DailyBriefing/    — Noticias, clima, precios automaticos

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAPACIDADES DEL BOT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  - Texto, voz (STT+TTS), imagenes (vision IA), documentos (PDF, txt), URLs
  - GENERAR DOCUMENTOS: crea archivos PDF y presentaciones PowerPoint (PPTX) con diseño profesional. Ejemplos: "hazme un PDF sobre X", "genera una presentación de PowerPoint sobre Y", "crea un informe de Z". El documento se envía directo al chat.
  - Busqueda web automatica segun el tipo de pregunta
  - Recordatorios flexibles (/recordar 30m Llamar a mama)
  - Precios de cryptos en tiempo real + TRM Colombia
  - Alertas de precio para cryptos
  - GIFs animados (/gif busqueda)
  - Stickers WebP (/sticker)
  - Multi-usuario con personalidad e historial por persona
  - Memoria persistente por usuario (guardada en Supabase)
  - Bot de finanzas con Google Sheets privado por usuario
  - Briefing diario automatico con noticias, precios y preferencias personales
  - DATOS EN TIEMPO REAL SIN API KEY (se activan automaticamente segun el contexto):
      Clima: temperatura, humedad, viento, pronostico 3 dias para CUALQUIER ciudad del mundo
      Tasas de cambio: EUR, GBP, JPY, MXN, BRL, CAD, CHF, CNY y mas vs USD/EUR
      Info de paises: capital, poblacion, moneda, idiomas, area, zonas horarias
      Sismos recientes: ultimos 7 dias a nivel mundial (USGS NEIC)
      Festivos: dias feriados de cualquier pais por ano
  - Cuando el usuario pregunte por clima de cualquier ciudad, SIEMPRE usar la herramienta get_weather
  - Si NO se menciona ciudad, usar Bogotá como ciudad por defecto (ciudad del bot y del creador)
  - Para preguntas como "¿va a llover hoy?", "¿hace frío?", "¿cómo está el tiempo?", "¿está soleado?", también usar get_weather con city="Bogota"
  - Cuando pregunte por sismos/terremotos, SIEMPRE usar get_recent_earthquakes
  - Cuando pregunte por festivos/feriados, SIEMPRE usar get_public_holidays
  - Cuando pregunte por tasas de cambio (excepto COP), usar get_exchange_rate
  - Cuando pregunte por datos de un pais, usar get_country_info

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRIVACIDAD Y DATOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  - Las conversaciones y datos personales de los usuarios son PRIVADOS.
  - El creador (Andrew) NO tiene acceso a los mensajes ni al historial de conversaciones.
  - Los datos se guardan en Supabase (base de datos cifrada en la nube) solo para que el bot funcione.
  - Nadie, incluyendo Andrew, puede leer las conversaciones de los usuarios.
  - Si alguien pregunta si el creador puede ver su informacion o mensajes, responde claramente que NO.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMANDOS — ASISTENTE IA (Groq)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
  /recordatorios  Ver lista de recordatorios activos
  /buscar [query] Busqueda web explicita con resultados formateados
  /clima [ciudad] Clima actual + pronostico 3 dias (Open-Meteo, sin key)
  /dolar /trm     TRM Colombia del dia
  /btc /eth       Precio de Bitcoin o Ethereum
  /crypto [coin]  Precio de cualquier criptomoneda
  /alerta         Alerta de precio: /alerta eth < 2000
  /alertas        Ver y gestionar alertas activas
  /miperfil       Ver o cambiar personalidad del usuario
  /corto          Activar respuestas muy cortas (2-3 oraciones max)
  /largo          Activar respuestas extensas y detalladas
  /normal         Volver a la longitud de respuesta estandar

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMANDOS — BRIEFING Y NOTICIAS (todos los usuarios)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /briefing       Briefing completo ahora (noticias + precios)
  /noticias       Solo noticias segun preferencias
  /precios        TRM + criptos + divisas segun preferencias
  /prefs          Ver preferencias del briefing
  /prefs on|off   Activar/desactivar briefing automatico
  /prefs horarios 7 13 19   Elegir horarios (7am, 1pm, 7pm)
  /prefs monedas BTC ETH    Criptos a mostrar
  /prefs divisas EUR GBP    Divisas fiat extra
  /prefs noticias colombia tecnologia   Temas de noticias
  /prefs cantidad 5         Numero de noticias (1-10)
  /prefs clima on|off       Mostrar/ocultar clima
  /prefs dolar on|off       Mostrar/ocultar TRM

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMANDOS — BOT DE FINANZAS (Gastos)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Activar:  /gastos | /gasto | /finanzas | /ahorros | /ahorro | /presupuesto
            /cuentas | /dinero | /plata | /contador | /dineros
  Salir:    /salir | /stop | /exit | /close | /cerrar
  Reset:    /resetgastos (reinicia onboarding desde cero)

  Dentro del modo gastos:
  /ayuda              Lista completa de comandos
  /actualizar         Regenera hojas Config, Resumen y Ahorros en Google Sheets
  Almuerzo 15k        Registrar un gasto (texto libre con monto)
  Taxi 25k [enero]    Registrar gasto en otro mes
  ver gastos          Ultimos 10 gastos del mes actual
  ver gastos [enero]  Gastos de un mes especifico
  editar X            Editar gasto numero X de la lista
  borrar X            Eliminar gasto numero X de la lista
  resumen             Analisis financiero completo
  cuentas             Ver saldo de cuentas
  config              Ver configuracion actual
  salario 5M          Configurar salario mensual
  saldo 2.5M          Configurar saldo bancario
  meta ahorro 1M      Meta de ahorro mensual

  El bot de gastos usa Google Sheets (hoja privada del usuario) + IA de Groq
  para parsear montos en notacion colombiana: 15k=15.000, 2.5M=2.500.000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMANDOS EXCLUSIVOS DEL ADMIN (Andrew)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /bot              Cambiar entre Groq IA y Control de Gastos
  /briefing on|off  Activar/desactivar briefing global
  /briefing status  Estado del scheduler
  /bloquear         Agregar numero a lista negra
  /desbloquear      Quitar numero de lista negra
  /bloqueados       Ver lista negra
  /noticia [n]      Ver detalle de una noticia
  /resetgastos all  Resetear gastos de TODOS los usuarios

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USUARIOS EXTERNOS Y FILTROS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  - Primera vez → onboarding: el bot pregunta como quiere que lo traten
  - Personalidad guardada en Supabase, persiste entre conversaciones
  - Numeros +58 (Venezuela) y lista negra → reciben aviso anti-spam automatico
  - Usuarios pueden activar el bot de finanzas igual que el admin

SI TE PREGUNTAN SOBRE TI MISMO O TU CREADOR:
  Responde con orgullo y detalle tecnico. Eres Cortana, un bot de WhatsApp con IA
  creado por Andrew, desarrollador colombiano de 23 anos especializado en
  automatizaciones con IA. Puedes explicar el stack completo, las APIs que usas,
  como funciona el deploy, donde se guardan los datos, todo.
=== FIN CONOCIMIENTO BASE ===`;

const CONVERSATION_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_RETRIES = 3;
const MAX_INPUT_LENGTH = 4000;
const MAX_TOKENS_DEFAULT = 2048;

// ============================================
// Patrones que indican consulta compleja → chain of thought
// ============================================
const THINKING_PATTERNS = [
  // Matemáticas y cálculos
  /\b(calcul[ae]|cuanto (es|son|da|resulta|vale)|resuelve|ecuac[ií]on|f[oó]rmula|porcentaje|descuento|inter[eé]s|promedio|probabilidad|demuestra)\b/i,
  // Análisis y comparación
  /\b(compar[ae]|analiz[ae]|diferencia entre|mejor.*peor|pros?.*contras?|ventaja.*desventaja|cu[aá]l (es|seria|sería) (mejor|peor|m[aá]s))\b/i,
  // Planificación y estrategia
  /\b(plan|estrategia|hoja de ruta|paso a paso|c[oó]mo (hacer|implementar|lograr|conseguir|crear|construir)|deber[ií]a|recomend[ae])\b/i,
  // Código y programación
  /\b(c[oó]digo|programa|funci[oó]n|algoritmo|bug|error|refactor|optimiz[ae]|debug|implementa|crea un (script|programa|funci[oó]n|bot|api))\b/i,
  // Explicaciones profundas
  /\b(explica (detalladamente|en profundidad|c[oó]mo funciona|por qu[eé])|por qu[eé] (es|funciona|pasa|ocurre)|diferencia (entre|de))\b/i,
  // Generación de texto largo
  /\b(escribe|redacta|genera|crea).{0,30}(correo|email|carta|ensayo|art[ií]culo|informe|reporte|propuesta|presentaci[oó]n|resumen)\b/i,
  // Toma de decisiones
  /\b(qu[eé] (har[ií]as|recomiendas|aconsejas|opinas)|c[oó]mo (decido|elijo|escojo)|ayuda(me)? (a decidir|a elegir|a escoger))\b/i,
];

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
    this.maxHistory = parseInt(process.env.MAX_HISTORY) || 100;
    this.ttsVoice = process.env.TTS_VOICE || "leda";
    this.ttsModel = "canopylabs/orpheus-v1-english";
    this.sttModel = "whisper-large-v3-turbo";

    // Map<userId, { messages, lastActivity }>
    this.conversations = new Map();
    // Map<userId, string>
    this.customPrompts = new Map();
    // Map<userId, string> - modelo per-chat
    this.chatModels = new Map();
    // Map<userId, string> - contexto financiero por usuario (gastos bot)
    this.financialContexts = new Map();
    // Map<userId, string> - info del usuario (nombre, memoria) inyectada en el sistema
    this.userContexts = new Map();
    // Map<userId, 'short'|'default'|'long'> - longitud de respuesta preferida
    this.responseLengths = new Map();
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

  setFinancialContext(userId, ctx) { this.financialContexts.set(userId, ctx); }
  clearFinancialContext(userId) { this.financialContexts.delete(userId); }

  setUserContext(userId, ctx) { this.userContexts.set(userId, ctx); }
  clearUserContext(userId) { this.userContexts.delete(userId); }

  getResponseLength(userId) { return this.responseLengths.get(userId) || 'default'; }
  setResponseLength(userId, length) { this.responseLengths.set(userId, length); }

  // ============================================
  // Chain of Thought - Razonamiento previo para consultas complejas
  // ============================================

  /**
   * Detecta si el mensaje se beneficia de razonamiento estructurado previo.
   */
  _shouldDeepThink(message) {
    if (!message || typeof message !== 'string') return false;
    if (message.length < 25) return false; // Muy corto = no necesita thinking
    for (const pattern of THINKING_PATTERNS) {
      if (pattern.test(message)) return true;
    }
    return false;
  }

  /**
   * Genera un bosquejo de razonamiento interno usando Llama 3.1 8B (rápido).
   * No se añade al historial — es contexto interno para el modelo principal.
   */
  async _generateThinkingContext(message) {
    try {
      const completion = await this._withRetry(() =>
        this.client.chat.completions.create({
          model: 'llama-3.1-8b-instant',
          messages: [
            {
              role: 'system',
              content: 'Eres un asistente que planifica respuestas. Dado el mensaje del usuario, genera SOLO un plan de razonamiento breve (3-5 puntos) de cómo responder correctamente. No escribas la respuesta, solo el proceso de pensamiento. Máximo 150 palabras en español.',
            },
            { role: 'user', content: message },
          ],
          temperature: 0.1,
          max_tokens: 220,
        })
      );
      return completion.choices[0]?.message?.content?.trim() || null;
    } catch (e) {
      console.log('[Groq] Thinking step falló (silencioso):', e.message?.substring(0, 50));
      return null; // Fallo silencioso — no bloquear la respuesta
    }
  }

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
      // Frases de corte de entrenamiento más comunes
      /mi (última|ultimo).*(actualización|entrenamiento|conocimiento)/i,
      /fecha.*de.*mi.*actualización/i,
      /actualización.*abril.*202[0-9]/i,
      /entrenamiento.*hasta/i,
      /conocimiento.*hasta.*202[0-9]/i,
      /no tengo información (sobre|acerca|de) eventos? (recientes?|actuales?|del [0-9])/i,
      /no puedo (confirmar|verificar) eventos? (recientes?|actuales?|post)/i,
      /para (información|datos) (más )?(recientes?|actualizados?|actuales?)/i,
      /te sugiero (consultar|revisar|buscar) fuentes/i,
      /según (mis datos|mi información|lo que sé) hasta/i,
    ];

    for (const pattern of UNCERTAINTY_PATTERNS) {
      if (pattern.test(r)) return true;
    }
    return false;
  }

  /**
   * Audita la relevancia de la respuesta (¿responde lo que se preguntó?).
   * IMPORTANTE: NO verifica hechos. Si hubo búsqueda web, confía en esos datos.
   * Solo corrige si la respuesta habla de un tema completamente diferente.
   *
   * @param {string} userId
   * @param {string} userMessage
   * @param {string} aiResponse
   * @param {object} opts - { didSearch: boolean, searchContext: string|null }
   */
  async _auditResponse(userId, userMessage, aiResponse, opts = {}) {
    const { didSearch = false, searchContext = null } = opts;

    if (!aiResponse || aiResponse.length < 30) return aiResponse;
    if (!userMessage || typeof userMessage !== 'string' || userMessage.length < 6) return aiResponse;
    if (aiResponse.length > 3500) return aiResponse;

    try {
      // Si hubo búsqueda web, el audit solo verifica que el tema sea correcto —
      // nunca puede marcar datos del web como incorrectos (no tiene internet).
      const auditInstructions = didSearch
        ? 'IMPORTANTE: Esta respuesta está basada en resultados de búsqueda web en tiempo real. ' +
          'NO tienes acceso a internet. NUNCA marques como incorrectos datos que vienen de una búsqueda web reciente. ' +
          'TU ÚNICO criterio: ¿La respuesta habla del tema que el usuario preguntó? Si habla del tema = {"ok":true}. ' +
          'Solo {"ok":false} si la respuesta claramente habla de un tema COMPLETAMENTE DIFERENTE al preguntado.'
        : 'REGLAS CRÍTICAS:\n' +
          '- NO tienes acceso a internet ni datos actualizados. NUNCA evalúes si los hechos son correctos.\n' +
          '- SOLO verifica: ¿La respuesta intenta responder lo que el usuario preguntó?\n' +
          '- Si intenta responder el tema correcto = {"ok":true}, aunque sea breve o incompleta.\n' +
          '- {"ok":false} SOLO si la respuesta habla de un tema COMPLETAMENTE DIFERENTE al de la pregunta.\n' +
          '- En cualquier duda = {"ok":true}. Sé muy conservador al marcar problemas.';

      const auditCompletion = await this.client.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content:
              'Eres un auditor de relevancia para un bot de WhatsApp.\n\n' +
              auditInstructions +
              '\n\nFormato de respuesta — ÚNICAMENTE JSON válido:\n' +
              '{"ok":true}\n' +
              '{"ok":false,"reason":"la respuesta habla de X pero el usuario preguntó sobre Y"}',
          },
          {
            role: 'user',
            content: `PREGUNTA:\n${userMessage.substring(0, 400)}\n\nRESPUESTA:\n${aiResponse.substring(0, 700)}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 80,
      });

      const auditText = (auditCompletion.choices[0]?.message?.content || '').trim();
      let auditResult;
      try {
        const jsonMatch = auditText.match(/\{[\s\S]*\}/);
        auditResult = jsonMatch ? JSON.parse(jsonMatch[0]) : { ok: true };
      } catch {
        return aiResponse;
      }

      if (auditResult.ok === false && auditResult.reason) {
        console.log(`[Groq][Audit] ❌ Off-topic — "${auditResult.reason}"`);
        console.log(`[Groq][Audit] Original (${aiResponse.length} chars): "${aiResponse.substring(0, 150).replace(/\n/g, ' ')}..."`);

        const currentModel = this.getModel(userId);
        // La corrección incluye el contexto de búsqueda si estaba disponible
        const correctionSystem =
          'Eres Cortana, asistente de WhatsApp. El auditor detectó que tu respuesta anterior no correspondía a la pregunta del usuario.\n' +
          `Problema: ${auditResult.reason}\n\n` +
          (searchContext ? `[DATOS DE BÚSQUEDA WEB — úsalos para responder]:\n${searchContext.substring(0, 2000)}\n\n` : '') +
          'Genera una respuesta NUEVA que responda directamente lo que se preguntó. No menciones al auditor.';

        const correctionCompletion = await this.client.chat.completions.create({
          model: currentModel,
          messages: [
            { role: 'system', content: correctionSystem },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.7,
          max_tokens: 800,
        });

        const corrected = this._sanitizeReply(correctionCompletion.choices[0]?.message?.content || '');
        if (corrected && corrected.length > 20) {
          console.log(`[Groq][Audit] ✅ Corregida (${corrected.length} chars): "${corrected.substring(0, 150).replace(/\n/g, ' ')}..."`);
          return corrected;
        }
      } else {
        console.log(`[Groq][Audit] ✅ OK${didSearch ? ' (web-backed)' : ''} — "${aiResponse.substring(0, 80).replace(/\n/g, ' ')}..."`);
      }

      return aiResponse;
    } catch (e) {
      console.log('[Groq][Audit] Error silencioso:', e.message?.substring(0, 60));
      return aiResponse;
    }
  }

  /**
   * Limpia tokens especiales de Llama que a veces se filtran en la respuesta.
   */
  _sanitizeReply(text) {
    if (!text || typeof text !== 'string') return text;
    return text
      // Tokens especiales de Llama 3 / Llama 4
      .replace(/<\|start_header_id\|>[\s\S]*?<\|end_header_id\|>\s*/g, '')
      .replace(/<\|eot_id\|>/g, '')
      .replace(/<\|begin_of_text\|>/g, '')
      .replace(/<\|end_of_text\|>/g, '')
      .replace(/<\|finetune_right_pad_id\|>/g, '')
      .replace(/<\|[a-z_]+\|>/g, '')
      .trim();
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
  // Detecta mensajes que no necesitan búsqueda web (saludos, confirmaciones, etc.)
  // ============================================
  _isTrivialMessage(message) {
    if (!message || typeof message !== 'string') return true;
    const msg = message.trim().toLowerCase().replace(/[!?.¿¡]+/g, '').trim();
    if (msg.length < 4) return true;
    const trivialPatterns = [
      /^(hola|hey|hi|buenas|buenos días|buenos dias|buen día|buen dia|buenas tardes|buenas noches|qué hay|que hay|ey)$/i,
      /^(ok|okay|vale|dale|listo|entendido|claro|sí|si|no|gracias|de nada|genial|perfecto|bien|mal|chévere|chevere)$/i,
      /^(cómo estás|como estas|qué tal|que tal|cómo te va|como te va|cómo vas|como vas)$/i,
      /^(jaja|jeje|jajaja|jejeje|xd)$/i,
      /^[\d\s]+$/, // solo números o espacios
    ];
    return trivialPatterns.some(p => p.test(msg));
  }

  // ============================================
  // Chat: búsqueda web en CADA mensaje + loop de tool calls
  // La IA decide si los resultados son suficientes o necesita más búsquedas.
  // ============================================
  async chat(userId, userMessage) {
    this.stats.messages++;
    if (typeof userMessage === "string" && userMessage.length > MAX_INPUT_LENGTH) {
      userMessage = userMessage.substring(0, MAX_INPUT_LENGTH) + "... (truncado)";
    }

    this.addToHistory(userId, "user", userMessage);

    const currentModel = this.getModel(userId);
    const dateStr = new Date().toLocaleDateString("es-CO", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      timeZone: process.env.TIMEZONE || 'America/Bogota',
    });

    const msgText = typeof userMessage === 'string' ? userMessage : '';
    const isTrivial = this._isTrivialMessage(msgText);
    let totalSearches = 0;

    // ---- Construir query enriquecida con contexto del historial ----
    // Si el mensaje es corto (< 80 chars), siempre añade contexto de los últimos
    // intercambios para que la búsqueda sepa de qué se está hablando.
    const buildSearchQuery = () => {
      let base = msgText
        .replace(/^(oye|hey|dime|cuéntame|explícame|sabes|sabes algo sobre)\s*/i, '')
        .replace(/[?¿!¡]+/g, '')
        .trim();

      if (base.length < 80) {
        // Usar la última respuesta del asistente como contexto para la búsqueda.
        // Ej: "Lo mataron?" + ctx "Nicolás Maduro capturado 2026" → query relevante.
        const history = this.getHistory(userId);
        const lastAsst = [...history].reverse().find(m => m.role === 'assistant' && typeof m.content === 'string');
        if (lastAsst) {
          const ctx = lastAsst.content.substring(0, 150).replace(/\n/g, ' ').trim();
          if (ctx) base = ctx + ' | ' + base;
        }
      }

      return base.substring(0, 400);
    };

    // ---- Búsqueda inicial siempre que el mensaje no sea trivial ----
    let initialSearchResults = null;
    if (!isTrivial && webSearch) {
      const query = buildSearchQuery();
      console.log(`[Groq] Búsqueda inicial: "${query.substring(0, 120)}"`);
      this.stats.searches++;
      totalSearches++;
      try {
        initialSearchResults = await webSearch(query);
        console.log('[Groq] Búsqueda inicial completada');
      } catch (e) {
        console.log('[Groq] Búsqueda inicial falló:', e.message);
      }
    }

    // ---- APIs estructuradas proactivas (clima, sismos, festivos) ----
    let proactiveApiResults = null;
    if (!isTrivial && detectProactiveTool) {
      const proactiveApi = detectProactiveTool(msgText);
      if (proactiveApi) {
        console.log('[Groq] API proactiva: ' + proactiveApi.tool);
        this.stats.searches++;
        try {
          proactiveApiResults = await callFreeApiTool(proactiveApi.tool, proactiveApi.args);
          console.log('[Groq] Datos API proactiva obtenidos');
        } catch (e) {
          console.log('[Groq] API proactiva falló:', e.message);
        }
      }
    }

    // ---- Thinking step para consultas complejas ----
    let thinkingCtx = null;
    if (!isTrivial && this._shouldDeepThink(msgText)) {
      thinkingCtx = await this._generateThinkingContext(msgText);
      if (thinkingCtx) console.log('[Groq] Chain-of-thought generado');
    }

    // ---- Longitud de respuesta ----
    const respLen = this.getResponseLength(userId);
    const lengthRule =
      respLen === 'short'
        ? "\n- LONGITUD: MUY CORTA. Máximo 2-3 oraciones. Solo lo esencial."
        : respLen === 'long'
        ? "\n- LONGITUD: Extenso cuando el tema lo justifique. Detalla, ejemplos, contexto."
        : "\n- LONGITUD: Conciso y directo. Sin relleno. La respuesta útil en el menor texto posible.";

    // ---- System prompt ----
    let systemPrompt =
      this.getSystemPrompt(userId) +
      "\n\n" + APP_KNOWLEDGE +
      "\n\nFecha actual: " + dateStr + "." +
      "\n\nREGLAS CRÍTICAS — OBLIGATORIAS:" +
      "\n- Tienes resultados de búsqueda web inyectados en este contexto. Son tu ÚNICA fuente para hechos actuales." +
      "\n- PROHIBIDO inventar fechas, nombres, lugares, cifras o eventos. Si los resultados no lo dicen, NO lo digas." +
      "\n- ANTES de citar un resultado, analiza su título y snippet para verificar que habla exactamente del tema preguntado. Ej: un artículo sobre 'elecciones consulta y congreso' NO confirma resultados de elecciones presidenciales. 'Precios de acciones' NO confirma precios de criptomonedas. Si hay duda, úsalo con cautela o busca uno más específico." +
      "\n- Si los resultados son sobre un tema relacionado pero diferente al preguntado, indícalo claramente: 'Los resultados que encontré son sobre X, no sobre Y específicamente.'" +
      "\n- Si los resultados no confirman el hecho preguntado, di: 'No encontré esa información en los resultados actuales.' y ofrece lo que SÍ encontraste." +
      "\n- Cuando cites un hecho, incluye la URL fuente del resultado (formato: _fuente: URL_). Nunca inventes URLs." +
      "\n- Si el usuario pide más contexto o fuentes, cita literalmente los títulos y URLs de los resultados que usaste." +
      "\n- Si los resultados actuales no son suficientes o son imprecisos, usa web_search con una query más específica antes de responder." +
      "\n- NUNCA digas 'hasta mi última actualización', 'mi conocimiento llega hasta', 'no tengo información en tiempo real'. Tienes búsqueda web activa." +
      "\n- NUNCA preguntes si quiere respuesta en audio o texto. NUNCA digas 'dame un momento' o 'voy a buscar'." +
      "\n- NUNCA recomiendes: Revista Semana, Caracol Radio, RCN Radio, RCN TV." +
      "\n- Formatea con WhatsApp markdown: *negrita*, _cursiva_, ```codigo```. Listas con •." +
      lengthRule;

    const userCtx = this.userContexts.get(userId);
    if (userCtx) systemPrompt += "\n\n" + userCtx;
    if (thinkingCtx) systemPrompt += "\n\n[RAZONAMIENTO INTERNO]:\n" + thinkingCtx;

    if (initialSearchResults) {
      systemPrompt += "\n\n[RESULTADOS DE BÚSQUEDA WEB — fuente principal de información]:\n" + initialSearchResults;
    }
    if (proactiveApiResults) {
      systemPrompt += "\n\n[DATOS EN TIEMPO REAL — clima/sismos/festivos/divisas]:\n" + proactiveApiResults;
    }

    const finCtx = this.financialContexts.get(userId);
    if (finCtx) systemPrompt += "\n\n" + finCtx;

    // ---- Loop de tool calls: la IA decide si necesita más búsquedas ----
    const MAX_TOOL_ROUNDS = 5;
    const allTools = [
      ...(WEB_SEARCH_TOOL && webSearch ? [WEB_SEARCH_TOOL] : []),
      ...FREE_API_TOOLS,
    ];

    const messages = [
      { role: "system", content: systemPrompt },
      ...this.getHistory(userId),
    ];

    let finalReply = null;

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const params = {
          model: currentModel,
          messages,
          temperature: 0.7,
          max_tokens: MAX_TOKENS_DEFAULT,
          top_p: 0.9,
        };
        if (allTools.length > 0) {
          params.tools = allTools;
          params.tool_choice = "auto";
        }

        console.log(`[Groq] Round ${round + 1}/${MAX_TOOL_ROUNDS} (${currentModel.split('/').pop()}, búsquedas: ${totalSearches})`);

        let completion;
        try {
          completion = await this._withRetry(() => this.client.chat.completions.create(params));
        } catch (toolErr) {
          if (toolErr.status === 400 && toolErr.message?.includes('tool_use_failed')) {
            console.log('[Groq] Tool call malformado, reintentando sin tools...');
            delete params.tools;
            delete params.tool_choice;
            completion = await this._withRetry(() => this.client.chat.completions.create(params));
          } else {
            throw toolErr;
          }
        }

        const msg = completion.choices[0].message;

        // Sin tool calls → respuesta final
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          finalReply = this._sanitizeReply(msg.content || 'No pude generar una respuesta.');
          break;
        }

        // La IA quiere más herramientas → ejecutarlas
        console.log(`[Groq] ${msg.tool_calls.length} tool call(s) en round ${round + 1}`);
        messages.push(msg);

        for (const tc of msg.tool_calls) {
          let args;
          try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

          if (tc.function.name === 'web_search') {
            const query = args.query || msgText;
            console.log(`[Groq] web_search: "${query.substring(0, 80)}"`);
            this.stats.searches++;
            totalSearches++;
            try {
              const results = await webSearch(query);
              messages.push({ role: 'tool', tool_call_id: tc.id, content: results });
            } catch (e) {
              messages.push({ role: 'tool', tool_call_id: tc.id, content: `Búsqueda falló: ${e.message}` });
            }
          } else if (callFreeApiTool) {
            console.log(`[Groq] free API: ${tc.function.name}`);
            this.stats.searches++;
            try {
              const result = await callFreeApiTool(tc.function.name, args);
              messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
            } catch (e) {
              messages.push({ role: 'tool', tool_call_id: tc.id, content: `API falló: ${e.message}` });
            }
          }
        }
      }

      // Si se agotaron los rounds sin respuesta, forzar
      if (!finalReply) {
        console.log('[Groq] Max rounds alcanzado, forzando respuesta final...');
        const forced = await this._withRetry(() =>
          this.client.chat.completions.create({ model: currentModel, messages, temperature: 0.7, max_tokens: MAX_TOKENS_DEFAULT, top_p: 0.9 })
        );
        finalReply = this._sanitizeReply(forced.choices[0]?.message?.content || 'No pude generar una respuesta.');
      }

      // Audit solo cuando no hubo ninguna búsqueda (ej: mensajes triviales respondidos con conocimiento)
      if (totalSearches === 0) {
        finalReply = await this._auditResponse(userId, msgText, finalReply, { didSearch: false, searchContext: null });
      } else {
        console.log(`[Groq][Audit] ⏭ Saltado — ${totalSearches} búsqueda(s) realizadas`);
      }

      this.addToHistory(userId, "assistant", finalReply);
      return finalReply;

    } catch (error) {
      console.error("[Groq] Error Chat:", error.message);
      if (error.status === 429) return "Límite de solicitudes alcanzado. Espera un minuto.";
      if (error.message?.includes("token")) { this.clearHistory(userId); return "Conversación reiniciada (muy larga). Puedes seguir preguntando."; }
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
        this.client.chat.completions.create({ model: visionModel, messages, temperature: 0.7, max_tokens: MAX_TOKENS_DEFAULT, top_p: 0.9 })
      );
      const reply = this._sanitizeReply(completion.choices[0]?.message?.content || "No pude analizar la imagen.");
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
