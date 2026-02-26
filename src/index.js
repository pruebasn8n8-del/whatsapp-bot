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
let pairingCodeRequested = false;
let currentPairingCode = null;
let pairingCodeGeneratedAt = null;

// ============================================
// Test de red - verifica que podamos llegar a WhatsApp
// ============================================
async function testNetworkConnectivity() {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = net.createConnection({ host: 'web.whatsapp.com', port: 443, timeout: 10000 });
    socket.on('connect', () => {
      console.log('[Network] OK - Conexion TCP a web.whatsapp.com:443 exitosa');
      socket.destroy();
      resolve(true);
    });
    socket.on('error', (err) => {
      console.error('[Network] ERROR - No se puede conectar a web.whatsapp.com:443:', err.message);
      resolve(false);
    });
    socket.on('timeout', () => {
      console.error('[Network] TIMEOUT - web.whatsapp.com:443 no responde');
      socket.destroy();
      resolve(false);
    });
  });
}

// ============================================
// Conectar WhatsApp con Baileys
// ============================================
async function connectWhatsApp() {
  // Cerrar socket anterior antes de crear uno nuevo.
  // Sin esto, WhatsApp ve dos conexiones del mismo dispositivo y manda 440 al nuevo.
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch (_) {}
    sock = null;
    // Dar tiempo a WhatsApp para registrar que la conexión anterior cerró
    await new Promise(r => setTimeout(r, 2000));
  }

  let state, saveCreds;

  if (USE_SUPABASE_AUTH) {
    console.log('Usando auth state en Supabase...');
    ({ state, saveCreds } = await useSupabaseAuthState());
  } else {
    console.log('Usando auth state en archivo (auth_info/)...');
    ({ state, saveCreds } = await useMultiFileAuthState('auth_info'));
  }

  // Intentar obtener version actual, fallback a version estable conocida
  let version;
  try {
    const result = await fetchLatestBaileysVersion();
    version = result.version;
    console.log('Baileys version (remota):', version.join('.'));
  } catch (err) {
    version = [2, 3000, 1015901306];
    console.log('Baileys version (fallback hardcoded):', version.join('.'));
  }

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
        if (pairingCodeRequested) {
          console.log('Esperando que ingreses el pairing code... (ya fue enviado)');
          return;
        }
        const phone = (process.env.MY_NUMBER || '').replace(/[^0-9]/g, '');
        if (phone) {
          try {
            pairingCodeRequested = true;
            const code = await sock.requestPairingCode(phone);
            currentPairingCode = code;
            pairingCodeGeneratedAt = new Date();
            console.log('\n' + '='.repeat(40));
            console.log('PAIRING CODE: ' + code);
            console.log('='.repeat(40));
            console.log('Ve a WhatsApp > Ajustes > Dispositivos vinculados');
            console.log('> Vincular dispositivo > Vincular con numero de telefono');
            console.log('Ingresa el codigo: ' + code);
            console.log('='.repeat(40) + '\n');
          } catch (err) {
            pairingCodeRequested = false;
            console.error('Error solicitando pairing code:', err.message);
          }
        } else {
          console.error('MY_NUMBER no esta configurado.');
        }
      } else if (!USE_PAIRING_CODE) {
        console.log('\nEscanea este codigo QR con WhatsApp:\n');
        qrcode.generate(qr, { small: true });
        console.log('\nAbre WhatsApp > Dispositivos vinculados > Vincular dispositivo\n');
      }
    }

    if (connection === 'close') {
      isReady = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut; // 401
      const isReplaced = statusCode === 440; // conexion reemplazada por otra sesion

      console.log('Desconectado. Codigo:', statusCode);

      if (isLoggedOut) {
        console.log('Sesion cerrada (logout). Ejecuta DELETE FROM auth_sessions en Supabase y reinicia.');
        return;
      }

      if (isReplaced) {
        // 440: sesion fantasma del container anterior sigue viva en WhatsApp.
        // Reintentar cada 10s hasta que la sesion fantasma expire (~30s).
        reconnectAttempts++;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error(`440 persistente. Maximo de reintentos (${MAX_RECONNECT_ATTEMPTS}) alcanzado.`);
          return;
        }
        console.log(`Conexion reemplazada (440). Reintentando en 10s... (intento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, 10000));
        await connectWhatsApp();
        return;
      }

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(`Maximo de reconexiones (${MAX_RECONNECT_ATTEMPTS}) alcanzado. Deteniendo.`);
        return;
      }
      reconnectAttempts++;
      const delay = Math.min(5000 * reconnectAttempts, 60000);
      console.log(`Reconectando en ${delay / 1000}s... (intento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      await new Promise(r => setTimeout(r, delay));
      await connectWhatsApp();
    }

    if (connection === 'open') {
      isReady = true;
      reconnectAttempts = 0;
      pairingCodeRequested = false;
      currentPairingCode = null;
      pairingCodeGeneratedAt = null;
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

app.get('/pairing-code', (req, res) => {
  if (isReady) return res.json({ status: 'connected', code: null });
  if (!currentPairingCode) return res.json({ status: 'waiting', code: null });
  res.json({
    status: 'pending',
    code: currentPairingCode,
    generatedAt: pairingCodeGeneratedAt,
    instructions: 'WhatsApp > Ajustes > Dispositivos vinculados > Vincular con numero de telefono',
  });
});

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
    ${currentPairingCode ? `
    <div class="section">Vinculacion pendiente</div>
    <div style="background:#1e3a2f;border:1px solid #22c55e;border-radius:10px;padding:18px;margin-bottom:8px;text-align:center">
      <div style="font-size:.8rem;color:#86efac;margin-bottom:8px">PAIRING CODE — ingresalo en WhatsApp</div>
      <div style="font-size:2rem;font-weight:bold;letter-spacing:6px;color:#4ade80;font-family:monospace">${currentPairingCode}</div>
      <div style="font-size:.75rem;color:#6b7280;margin-top:10px">WhatsApp › Ajustes › Dispositivos vinculados<br>› Vincular dispositivo › Vincular con número de teléfono</div>
    </div>` : ''}
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

// Endpoint de diagnóstico: llama Groq directamente sin WhatsApp
app.get('/test-groq', async (req, res) => {
  try {
    const reply = await groqService.chat('__test__', 'Responde solo: OK');
    groqService.clearHistory('__test__');
    res.json({ ok: true, reply: reply.substring(0, 200) });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
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
// Keep-alive: self-ping para evitar que Koyeb duerma el servicio
// Koyeb free tier duerme despues de ~5 min sin trafico entrante.
// Configurar APP_URL en las variables de entorno de Koyeb con la URL publica.
// ============================================
function startKeepAlive() {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.log('[KeepAlive] APP_URL no configurado - el servicio puede dormir por inactividad.');
    console.log('[KeepAlive] Agrega APP_URL=https://tu-app.koyeb.app en las env vars de Koyeb.');
    return;
  }

  const pingUrl = appUrl.replace(/\/$/, '') + '/health';
  const PING_INTERVAL_MS = 4 * 60 * 1000; // cada 4 minutos

  const doPing = () => {
    const https = require('https');
    const http = require('http');
    const mod = pingUrl.startsWith('https') ? https : http;
    const req = mod.get(pingUrl, { timeout: 10000 }, (res) => {
      console.log('[KeepAlive] Ping OK -', res.statusCode);
    });
    req.on('error', (e) => console.log('[KeepAlive] Ping error:', e.message));
    req.on('timeout', () => { req.destroy(); console.log('[KeepAlive] Ping timeout'); });
  };

  // Primer ping a los 30s del arranque, luego cada 4 minutos
  setTimeout(() => {
    doPing();
    setInterval(doPing, PING_INTERVAL_MS);
  }, 30000);

  console.log('[KeepAlive] Iniciado - pinging', pingUrl, 'cada 4 minutos');
}

// ============================================
// Arrancar
// ============================================
async function main() {
  console.log('Iniciando sistema unificado de WhatsApp (Baileys)...\n');
  console.log('Auth mode:', USE_SUPABASE_AUTH ? 'Supabase' : 'Archivo local');
  console.log('Pairing code:', USE_PAIRING_CODE ? 'Si' : 'No (QR)');

  // Verificar conectividad de red hacia WhatsApp
  await testNetworkConnectivity();

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
    startKeepAlive();
  });

  // Esperar a que Koyeb (o cualquier plataforma con rolling deploy) termine de matar
  // el container anterior antes de conectar a WhatsApp. Sin este delay, ambos containers
  // intentan conectar con las mismas credenciales → error 440 en loop.
  const startupDelay = parseInt(process.env.STARTUP_DELAY_MS || '20000');
  if (startupDelay > 0) {
    console.log(`Esperando ${startupDelay / 1000}s para que el container anterior cierre (anti-440)...`);
    await new Promise(r => setTimeout(r, startupDelay));
  }

  await connectWhatsApp();
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});

function gracefulShutdown(signal) {
  console.log(`\n${signal} recibido. Cerrando conexion WhatsApp antes de salir...`);
  // Cerrar el WebSocket limpiamente para que WhatsApp sepa que esta sesion murio.
  // Sin esto, WhatsApp mantiene la sesion abierta ~30s, causando error 440 en el nuevo container.
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch (_) {}
    sock = null;
  }
  // Dar 1s para que el cierre TCP se propague, luego salir
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
