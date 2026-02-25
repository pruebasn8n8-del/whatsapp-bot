// src/index.js
require("dotenv").config();

const express = require("express");
const GroqService = require("./groqService");
const WhatsAppBot = require("./whatsappClient");

// Validar configuración
if (!process.env.GROQ_API_KEY) {
  console.error("❌ Falta GROQ_API_KEY en .env");
  process.exit(1);
}

// Inicializar
const groqService = new GroqService();
const bot = new WhatsAppBot(groqService);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ============================================
// Dashboard
// ============================================
app.get("/", (req, res) => {
  const s = bot.getStatus();
  const dotColor = s.connected ? "#22c55e" : "#ef4444";
  const dotGlow = s.connected ? "#22c55e80" : "#ef444480";

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Groq Bot</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
    .card{background:#1a1a1a;border-radius:16px;padding:40px;max-width:520px;width:100%;border:1px solid #333}
    h1{font-size:1.8rem;margin-bottom:8px}
    .sub{color:#888;margin-bottom:24px}
    .row{display:flex;align-items:center;gap:10px;padding:14px;background:#222;border-radius:10px;margin-bottom:8px}
    .dot{width:12px;height:12px;border-radius:50%;background:${dotColor};box-shadow:0 0 8px ${dotGlow}}
    .info span{color:#888}
    code{background:#333;padding:2px 6px;border-radius:4px;font-size:.85em}
    .toggle-row{display:flex;align-items:center;justify-content:space-between;padding:14px;background:#222;border-radius:10px;margin-bottom:8px}
    .toggle-label .t{font-size:.95rem}
    .toggle-label .d{font-size:.75rem;color:#888;margin-top:2px}
    .switch{position:relative;width:50px;height:28px;cursor:pointer}
    .switch input{opacity:0;width:0;height:0}
    .slider{position:absolute;inset:0;background:#444;border-radius:28px;transition:.3s}
    .slider:before{content:"";position:absolute;width:22px;height:22px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.3s}
    input:checked+.slider{background:#22c55e}
    input:checked+.slider:before{transform:translateX(22px)}
    .section{margin-top:20px;margin-bottom:8px;font-size:.85rem;color:#666;text-transform:uppercase;letter-spacing:1px}
    .voice-select{background:#333;color:#e0e0e0;border:1px solid #555;border-radius:8px;padding:8px 12px;font-size:.9rem;width:100%}
    .status-msg{font-size:.8rem;color:#888;text-align:center;margin-top:4px}
    .pipeline{display:flex;align-items:center;justify-content:center;gap:8px;padding:16px;background:#1e293b;border-radius:10px;margin-bottom:16px;font-size:.9rem}
    .pipeline .step{padding:6px 10px;border-radius:6px;background:#334155}
    .pipeline .arrow{color:#475569}
  </style>
</head>
<body>
  <div class="card">
    <h1>🤖 WhatsApp Groq Bot</h1>
    <p class="sub">Asistente de IA con Voz</p>

    <div class="pipeline">
      <span class="step">🎤 Whisper</span>
      <span class="arrow">→</span>
      <span class="step">🧠 Llama</span>
      <span class="arrow">→</span>
      <span class="step">🔊 Orpheus</span>
    </div>

    <div class="row">
      <div class="dot"></div>
      <span>${s.connected ? "Conectado y funcionando" : "Desconectado – revisa la terminal"}</span>
    </div>

    <div class="row info">
      <span>Modelo IA:</span>&nbsp;<code>${s.model}</code>
    </div>
    <div class="row info">
      <span>Conversaciones:</span>&nbsp;<code>${s.activeConversations}</code>
    </div>

    <div class="section">Controles</div>

    <div class="toggle-row">
      <div class="toggle-label">
        <span class="t">💥 Responder a otros</span>
        <span class="d">Si está apagado, solo responde en tu chat</span>
      </div>
      <label class="switch">
        <input type="checkbox" id="toggleOthers" ${s.replyToOthers ? "checked" : ""}
          onchange="api('/api/reply-to-others',{enabled:this.checked},'othersStatus')">
        <span class="slider"></span>
      </label>
    </div>
    <p class="status-msg" id="othersStatus">${s.replyToOthers ? "✅ Respondiendo a todos" : "🔒 Solo tu chat"}</p>

    <div class="toggle-row">
      <div class="toggle-label">
        <span class="t">🔊 Modo Voz (TTS)</span>
        <span class="d">Responder con notas de voz usando Orpheus</span>
      </div>
      <label class="switch">
        <input type="checkbox" id="toggleVoice" ${s.voiceMode ? "checked" : ""}
          onchange="api('/api/voice-mode',{enabled:this.checked},'voiceStatus')">
        <span class="slider"></span>
      </label>
    </div>
    <p class="status-msg" id="voiceStatus">${s.voiceMode ? "🔊 Respuestas por voz" : "💬 Respuestas por texto"}</p>

    <div class="section">Voz TTS</div>
    <div class="row">
      <select class="voice-select" id="voiceSelect" onchange="api('/api/tts-voice',{voice:this.value},'voiceSelectStatus')">
        <option value="diana"  ${s.ttsVoice === "diana"  ? "selected" : ""}>Diana (mujer) ⭐</option>
        <option value="hannah" ${s.ttsVoice === "hannah" ? "selected" : ""}>Hannah (mujer)</option>
        <option value="autumn" ${s.ttsVoice === "autumn" ? "selected" : ""}>Autumn (mujer)</option>
        <option value="austin" ${s.ttsVoice === "austin" ? "selected" : ""}>Austin (hombre)</option>
        <option value="daniel" ${s.ttsVoice === "daniel" ? "selected" : ""}>Daniel (hombre)</option>
        <option value="troy"   ${s.ttsVoice === "troy"   ? "selected" : ""}>Troy (hombre)</option>
      </select>
    </div>
    <p class="status-msg" id="voiceSelectStatus">Voz actual: ${s.ttsVoice}</p>
  </div>

  <script>
    async function api(url, body, statusId) {
      const el = document.getElementById(statusId);
      el.textContent = '⏳ Actualizando...';
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body)
        });
        const data = await res.json();

        if (statusId === 'othersStatus')
          el.textContent = data.replyToOthers ? '✅ Respondiendo a todos' : '🔒 Solo tu chat';
        else if (statusId === 'voiceStatus')
          el.textContent = data.voiceMode ? '🔊 Respuestas por voz' : '💬 Respuestas por texto';
        else if (statusId === 'voiceSelectStatus')
          el.textContent = 'Voz actual: ' + data.ttsVoice;
      } catch(e) {
        el.textContent = '❌ Error';
      }
    }
  </script>
</body>
</html>`);
});

// ============================================
// API endpoints
// ============================================
app.get("/health", (req, res) => {
  const s = bot.getStatus();
  res.json({ status: s.connected ? "ok" : "disconnected", ...s, uptime: process.uptime() });
});

app.get("/api/status", (req, res) => {
  res.json(bot.getStatus());
});

app.post("/api/reply-to-others", (req, res) => {
  bot.replyToOthers = !!req.body.enabled;
  console.log("🔄 Responder a otros: " + (bot.replyToOthers ? "ACTIVADO" : "DESACTIVADO"));
  res.json(bot.getStatus());
});

app.post("/api/voice-mode", (req, res) => {
  bot.voiceMode = !!req.body.enabled;
  console.log("🔊 Modo voz: " + (bot.voiceMode ? "ACTIVADO" : "DESACTIVADO"));
  res.json(bot.getStatus());
});

app.post("/api/tts-voice", (req, res) => {
  const voice = req.body.voice;
  // ✅ VOCES VÁLIDAS de Orpheus según documentación de Groq
  const allowed = ["diana", "hannah", "autumn", "austin", "daniel", "troy"];
  if (allowed.includes(voice)) {
    bot.groq.ttsVoice = voice;
    console.log("🗣️ Voz TTS: " + voice);
  }
  res.json(bot.getStatus());
});

// ============================================
// Arrancar
// ============================================
app.listen(PORT, () => {
  console.log("\n🌐 Dashboard: http://localhost:" + PORT);
  console.log("💚 Health: http://localhost:" + PORT + "/health\n");
});

bot.start().catch((err) => {
  console.error("❌ Error fatal:", err);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\n🛑 Cerrando...");
  process.exit(0);
});