// src/index.js - Entry point unificado (Baileys)
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// ============================================
// Credenciales de Google desde env var (para deploy en contenedor)
// Codifica tu service-account.json en base64 y ponlo en GOOGLE_CREDENTIALS_BASE64
// ============================================
if (process.env.GOOGLE_CREDENTIALS_BASE64) {
  const credPath = path.join(__dirname, '..', 'Gastos', 'credentials', 'service-account.json');
  try {
    fs.mkdirSync(path.dirname(credPath), { recursive: true });
    fs.writeFileSync(credPath, Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8'));
    console.log('Credenciales de Google escritas desde GOOGLE_CREDENTIALS_BASE64.');
  } catch (err) {
    console.error('Error escribiendo credenciales de Google:', err.message);
  }
}

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const { useSupabaseAuthState } = require('./supabaseAuthState');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express');
const GroqService = require('../Groqbot/src/groqService');
const { getDoc } = require('../Gastos/src/sheets/sheetsClient');
const { setupRouter, getActiveBot } = require('./router');
const { startScheduler } = require('../DailyBriefing/src/scheduler');

// ============================================
// Validar configuracion
// ============================================
if (!process.env.GROQ_API_KEY) {
  console.error('Falta GROQ_API_KEY en .env');
  process.exit(1);
}

if (!process.env.GOOGLE_SPREADSHEET_ID) {
  console.error('Falta GOOGLE_SPREADSHEET_ID en .env');
  process.exit(1);
}

// ============================================
// Inicializar servicios
// ============================================
const groqService = new GroqService();

// Modo de deploy: PAIRING_CODE=true usa pairing code en vez de QR (para servidores remotos)
const USE_PAIRING_CODE = process.env.PAIRING_CODE === 'true';
// Auth en Supabase: SUPABASE_AUTH=true persiste la sesion de WhatsApp en Supabase
const USE_SUPABASE_AUTH = process.env.SUPABASE_AUTH === 'true';

let sock = null;
let isReady = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// ============================================
// Conectar WhatsApp con Baileys
// ============================================
async function connectWhatsApp() {
  let state, saveCreds;

  if (USE_SUPABASE_AUTH) {
    console.log('Usando auth state en Supabase...');
    ({ state, saveCreds } = await useSupabaseAuthState());
  } else {
    console.log('Usando auth state en archivo (auth_info/)...');
    ({ state, saveCreds } = await useMultiFileAuthState('auth_info'));
  }

  const { version } = await fetchLatestBaileysVersion();
  console.log('Baileys version:', version.join('.'));

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: undefined,
    keepAliveIntervalMs: 25_000,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    retryRequestDelayMs: 350,
    maxMsgRetryCount: 5,
    generateHighQualityLinkPreview: false,
    getMessage: async () => ({ conversation: '' }),
  });

  // Guardar credenciales cuando se actualicen
  sock.ev.on('creds.update', saveCreds);

  // Manejar estado de conexion
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Cuando Baileys genera el QR significa que ya esta listo para autenticar.
    // En modo pairing code lo interceptamos aqui y pedimos el codigo en su lugar.
    if (qr) {
      if (USE_PAIRING_CODE && !sock.authState.creds.registered) {
        const phone = (process.env.MY_NUMBER || '').replace(/[^0-9]/g, '');
        if (phone) {
          try {
            const code = await sock.requestPairingCode(phone);
            console.log('\n' + '='.repeat(40));
            console.log('PAIRING CODE: ' + code);
            console.log('='.repeat(40));
            console.log('Ve a WhatsApp > Ajustes > Dispositivos vinculados');
            console.log('> Vincular dispositivo > Vincular con numero de telefono');
            console.log('Ingresa el codigo: ' + code);
            console.log('='.repeat(40) + '\n');
          } catch (err) {
            console.error('Error solicitando pairing code:', err.message);
          }
        } else {
          console.error('MY_NUMBER no esta configurado.');
        }
      } else {
        console.log('\nEscanea este codigo QR con WhatsApp:\n');
        qrcode.generate(qr, { small: true });
        console.log('\nAbre WhatsApp > Dispositivos vinculados > Vincular dispositivo\n');
      }
    }

    if (connection === 'close') {
      isReady = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('Desconectado. Codigo:', statusCode);

      if (shouldReconnect) {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error(`Maximo de reconexiones (${MAX_RECONNECT_ATTEMPTS}) alcanzado. Deteniendo.`);
          console.error('Revisa los secrets de Supabase y que las tablas existan, luego reinicia el Space.');
          return;
        }
        reconnectAttempts++;
        const delay = Math.min(5000 * reconnectAttempts, 60000); // 5s, 10s, ... max 60s
        console.log(`Reconectando en ${delay / 1000}s... (intento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, delay));
        await connectWhatsApp();
      } else {
        console.log('Sesion cerrada. Elimina la tabla auth_sessions en Supabase y reinicia.');
      }
    }

    if (connection === 'open') {
      isReady = true;
      reconnectAttempts = 0;
      console.log('WhatsApp conectado y listo!');
      console.log('Mi JID:', sock.user?.id);
      console.log('Modelo IA:', groqService.model);
      console.log('\nComandos disponibles desde WhatsApp:');
      console.log('  /bot      - Seleccionar bot (admin)');
      console.log('  /stop     - Desactivar bot activo (admin)');
      console.log('  /status   - Ver bot activo (admin)');
      console.log('  /briefing - Daily briefing (admin)');
      console.log('  /miperfil - Cambiar personalidad (todos)\n');

      startScheduler(sock);
    }
  });

  setupRouter(sock, groqService);
}

// ============================================
// Express Dashboard
// ============================================
const app = express();
const PORT = process.env.PORT || 7860;
app.use(express.json());

app.get('/', (req, res) => {
  const active = getActiveBot();
  const botLabel = active === 'groq' ? 'Groq IA' : active === 'gastos' ? 'Control de Gastos' : 'Ninguno';
  const dotColor = isReady ? '#22c55e' : '#ef4444';
  const dotGlow = isReady ? '#22c55e80' : '#ef444480';
  const activeDot = active ? '#22c55e' : '#6b7280';

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Bot Hub</title>
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
    .section{margin-top:20px;margin-bottom:8px;font-size:.85rem;color:#666;text-transform:uppercase;letter-spacing:1px}
    .cmd{padding:10px 14px;background:#1e293b;border-radius:8px;margin-bottom:6px;font-family:monospace;font-size:.9rem}
  </style>
</head>
<body>
  <div class="card">
    <h1>WhatsApp Bot Hub</h1>
    <p class="sub">Groq IA + Control de Gastos + Multi-usuario (Baileys)</p>
    <div class="row">
      <div class="dot"></div>
      <span>${isReady ? 'Conectado y funcionando' : 'Desconectado - revisa los logs'}</span>
    </div>
    <div class="row info">
      <div style="width:12px;height:12px;border-radius:50%;background:${activeDot}"></div>
      <span>Bot admin activo:</span>&nbsp;<code>${botLabel}</code>
    </div>
    <div class="row info">
      <span>Modelo IA:</span>&nbsp;<code>${groqService.model}</code>
    </div>
    <div class="row info">
      <span>Conversaciones activas:</span>&nbsp;<code>${groqService.conversations.size}</code>
    </div>
    <div class="row info">
      <span>Auth mode:</span>&nbsp;<code>${USE_SUPABASE_AUTH ? 'Supabase' : 'Archivo local'}</code>
    </div>
    <div class="section">Comandos Admin</div>
    <div class="cmd">/bot &nbsp;&nbsp;&nbsp;- Seleccionar bot</div>
    <div class="cmd">/stop &nbsp;&nbsp;- Desactivar bot</div>
    <div class="cmd">/briefing - Daily briefing</div>
    <div class="section">Comandos Usuarios</div>
    <div class="cmd">/miperfil - Cambiar personalidad</div>
  </div>
</body>
</html>`);
});

app.get('/health', (req, res) => {
  res.json({
    status: isReady ? 'ok' : 'disconnected',
    connected: isReady,
    activeBot: getActiveBot(),
    model: groqService.model,
    conversations: groqService.conversations.size,
    authMode: USE_SUPABASE_AUTH ? 'supabase' : 'file',
    uptime: process.uptime(),
  });
});

// ============================================
// Arrancar
// ============================================
async function main() {
  console.log('Iniciando sistema unificado de WhatsApp (Baileys)...\n');
  console.log('Auth mode:', USE_SUPABASE_AUTH ? 'Supabase' : 'Archivo local');
  console.log('Pairing code:', USE_PAIRING_CODE ? 'Si' : 'No (QR)');

  try {
    await getDoc();
    console.log('Conexion a Google Sheets verificada.');
  } catch (err) {
    console.error('Error conectando a Google Sheets:', err.message);
    console.error('El bot de Gastos no funcionara, pero Groq IA si.');
  }

  app.listen(PORT, () => {
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health\n`);
  });

  await connectWhatsApp();
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\nCerrando...');
  process.exit(0);
});
