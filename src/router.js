// src/router.js
// Router unificado para Baileys: multi-usuario con onboarding y personalidad por contacto

const { handleGroqMessage } = require('../Groqbot/src/whatsappClient');
const { handleGastosMessage } = require('../Gastos/src/whatsapp/messageHandler');
const { sendBriefingNow, setScheduleTime, setEnabled, isEnabled, getScheduleTime, getScheduledTimes } = require('../DailyBriefing/src/scheduler');
const { getLastNews, getNewsByTopics, formatNews } = require('../DailyBriefing/src/newsService');
const { getMessageText, getInteractiveResponse, sendButtonMessage, PREFIX } = require('./messageUtils');
const {
  getOnboardingState,
  startOnboarding,
  handleOnboardingStep,
  loadPersonalityIfNeeded,
  updatePersonality,
} = require('./onboarding');
const {
  isBlocked, blockContact, unblockContact, getBlockedContacts,
} = require('./contactsDb');
const { getPrefs, setPrefs, formatPrefsText, VALID_TOPICS, VALID_FX } = require('./prefsDb');
const { getTRM, getCryptoPrice, getFxRates, formatCOP: _formatCOP, formatUSD: _formatUSD, formatChangeArrow: _formatArrow, COIN_ALIASES } = require('../Groqbot/src/priceService');
const { CRYPTO_EMOJI, FX_EMOJI, FX_NAME } = require('../DailyBriefing/src/briefingService');
const { getGastosData, setGastosData, resetAllGastosData, resetGastosData } = require('./gastosDb');
const { startGastosOnboarding, handleGastosOnboardingStep, resendCurrentStep } = require('../Gastos/src/gastosOnboarding');
const { setCurrentSpreadsheetId } = require('../Gastos/src/sheets/sheetsClient');

// Palabras clave que activan el bot de Gastos (para todos los usuarios)
const GASTOS_TRIGGERS = ['/gastos', '/ahorros', '/finanzas', '/presupuesto', '/cuentas', '/dinero', '/plata'];

// Detección NL: "quiero ver mis gastos", "mi configuración de gastos", etc.
// Solo cuando NO está ya en modo gastos
function _isGastosNL(t) {
  if (GASTOS_TRIGGERS.includes(t)) return false;
  return /\b(gastos?|finanzas|ahorro|ahorros|presupuesto)\b/i.test(t) &&
    /\b(quiero|quisiera|ver|abrir|activar|entrar|acceder|modo|mi|mis|dame|mu[eé]strame|mostrar|ir\s+a|configuraci[oó]n|resumen)\b/i.test(t);
}

// Estado global admin
let activeBot = null; // null | 'groq' | 'gastos' | 'gastos_onboarding'
const pendingSelection = new Map(); // chatId -> timestamp
const SELECTION_TIMEOUT_MS = 60 * 1000;

// Estado por usuario externo (no persiste en reinicios, pero es ok)
// 'gastos' | 'gastos_onboarding' | null (null = Groq por defecto)
const userActiveBot = new Map();

/**
 * Retorna true si el JID es el administrador del bot.
 * Soporta formato @s.whatsapp.net y @lid (via MY_LID env var).
 */
function isAdmin(jid) {
  const myNumber = process.env.MY_NUMBER;
  if (!myNumber) return false;
  const adminJid = myNumber + '@s.whatsapp.net';
  const cleanJid = jid.replace(/:\d+@/, '@');
  if (cleanJid === adminJid || jid === adminJid) return true;
  // Soporte para JID tipo @lid (WhatsApp multi-device)
  const myLid = process.env.MY_LID;
  if (myLid) {
    const cleanLid = myLid.replace(/:\d+@/, '@').replace('@lid', '') + '@lid';
    if (cleanJid === cleanLid || cleanJid === myLid.replace(/:\d+@/, '@')) return true;
  }
  return false;
}

/**
 * Configura el router en el socket de Baileys.
 */
function setupRouter(sock, groqService) {
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      try {
        const jid = msg.key.remoteJid;
        if (!jid) continue;
        if (jid === 'status@broadcast') continue;
        if (!msg.message) continue;

        const isGroup = jid.endsWith('@g.us');
        if (isGroup) continue; // Solo chats individuales

        const body = getMessageText(msg);
        const interactive = getInteractiveResponse(msg);

        // Ignorar mensajes del bot (zero-width prefix)
        if (body.startsWith(PREFIX)) continue;

        // fromMe=true puede ser:
        // 1. Bot enviando mensaje a usuario externo (ej: onboarding, warning) → IGNORAR
        // 2. Admin escribiéndose a sí mismo (self-chat) → procesar como comando
        // Distinguimos por número: si el remoteJid es el propio número del bot = self-chat.
        if (msg.key.fromMe) {
          const botNumber = (sock.user?.id || '').split(':')[0].split('@')[0];
          const jidNumber = jid.split(':')[0].split('@')[0];
          if (jidNumber !== botNumber) continue; // Bot enviando a usuario externo → ignorar
          if (!body) continue; // Self-chat sin texto → ignorar
        }

        const text = body.trim();
        const textLower = text.toLowerCase();
        const pushName = msg.pushName || null;

        if (body || interactive) {
          console.log(`[Router] ${isAdmin(jid) ? '[ADMIN]' : '[USER]'} jid=${jid} nombre="${pushName || ''}" texto="${(body || '').substring(0, 50)}"`);
        } else if (msg.message) {
          console.log(`[Router] DEBUG empty body jid=${jid} msg.message keys: ${Object.keys(msg.message).join(',')}`);
        }

        // Marcar mensaje como leído
        try { await sock.readMessages([msg.key]); } catch (_) {}

        // ============================================
        // COMANDOS UNIVERSALES (admin y usuarios)
        // ============================================

        // /resetgastos - cualquier usuario puede reiniciar su propio perfil de gastos
        if (textLower === '/resetgastos') {
          const { resetGastosData } = require('./gastosDb');
          await resetGastosData(jid);
          userActiveBot.delete(jid);
          if (isAdmin(jid)) activeBot = null;
          await sock.sendMessage(jid, {
            text: PREFIX + '✅ Tu perfil de gastos fue reiniciado.\nEscribe /gastos para configurarlo de nuevo.',
          });
          continue;
        }

        // /actualizar - regenerar hojas de gastos (funciona desde cualquier modo)
        if (textLower === '/actualizar') {
          const gastosData = await getGastosData(jid);
          if (!gastosData.sheet_id || gastosData.onboarding_step !== 'complete') {
            await sock.sendMessage(jid, { text: PREFIX + 'No tienes gastos configurados. Escribe /gastos para empezar.' });
            continue;
          }
          setCurrentSpreadsheetId(gastosData.sheet_id);
          await sock.sendMessage(jid, { text: PREFIX + '⏳ Actualizando todas las hojas...' });
          const errors = [];
          try {
            const { writeInitialConfigLayout } = require('../Gastos/src/sheets/configManager');
            const { initResumenSheet, updateDashboard } = require('../Gastos/src/sheets/dashboardUpdater');
            const { writeSavingsTab } = require('../Gastos/src/sheets/savingsCalculator');
            const data = gastosData.config || {};
            await writeInitialConfigLayout(data);
            await initResumenSheet(data);
            await writeSavingsTab();
            await updateDashboard();
          } catch (e) { errors.push(e.message.substring(0, 80)); }
          if (errors.length) {
            await sock.sendMessage(jid, { text: PREFIX + `✅ Hojas actualizadas (con avisos):\n${errors.map(e => '• ' + e).join('\n')}` });
          } else {
            await sock.sendMessage(jid, { text: PREFIX + '✅ Configuración, Resumen, Ahorros y Dashboard actualizados.' });
          }
          continue;
        }

        // ============================================
        // LENGUAJE NATURAL — Sin necesidad de /comandos
        // Detecta intenciones comunes en texto plano.
        // ============================================
        if (!text.startsWith('/') && !interactive) {
          // "dame el briefing" / "quiero el briefing" / "resumen del día"
          const wantsBriefing =
            /\b(?:dame|quiero|manda|envía|dime)\s+(?:el|mi)?\s*(?:briefing|resumen\s+(?:de[l]?\s+)?(?:d[ií]a|diario|hoy))\b/i.test(textLower) ||
            /\bbrief(?:ing)?\s+(?:de\s+)?(?:hoy|ahora)\b/i.test(textLower) ||
            /\bmi\s+resumen\s+diario\b/i.test(textLower);
          if (wantsBriefing) {
            try {
              await sock.sendPresenceUpdate('composing', jid);
              await sendBriefingNow(sock, jid);
            } catch (err) {
              await sock.sendMessage(jid, { text: PREFIX + 'Error generando briefing: ' + err.message.substring(0, 100) });
            }
            continue;
          }

          // "dame las noticias" / "últimas noticias" / "qué pasó hoy"
          const wantsNews =
            /\b(?:dame|quiero|cuéntame|manda|envía)\s+(?:las?\s+)?(?:últimas?\s+)?noticias?\b/i.test(textLower) ||
            /\bnoticias?\s+(?:de\s+)?(?:hoy|ahora|recientes?|última\s+hora)\b/i.test(textLower) ||
            /\b(?:qué\s+(?:pasó|hay)\s+(?:hoy|de\s+nuevo))\b/i.test(textLower);
          if (wantsNews) {
            try {
              await sock.sendPresenceUpdate('composing', jid);
              const prefs = await getPrefs(jid);
              const topics = prefs.news_topics && prefs.news_topics.length ? prefs.news_topics : ['colombia', 'internacional'];
              const count = prefs.news_count || 5;
              const news = await getNewsByTopics(topics, count);
              const newsText = formatNews(news) || 'No se pudieron obtener noticias en este momento.';
              await sock.sendMessage(jid, { text: PREFIX + newsText });
            } catch (err) {
              await sock.sendMessage(jid, { text: PREFIX + 'Error obteniendo noticias: ' + err.message.substring(0, 80) });
            }
            continue;
          }

          // "ver precios" / "dame los precios" / "cómo van los precios"
          const wantsPrices =
            /\b(?:dame|ver|muestra|quiero)\s+(?:los?\s+)?precios?\b/i.test(textLower) ||
            /\b(?:cómo|como)\s+(?:van|están|estan)\s+(?:los?\s+)?(?:precios?|mercados?|cryptos?)\b/i.test(textLower) ||
            /\bestado\s+del\s+mercado\b/i.test(textLower);
          if (wantsPrices) {
            try {
              await sock.sendPresenceUpdate('composing', jid);
              const prefs = await getPrefs(jid);
              const cryptos = prefs.cryptos && prefs.cryptos.length ? prefs.cryptos : ['BTC'];
              const fx = prefs.fx_currencies || [];
              const showTrm = prefs.show_trm !== false;
              const lines = ['💰 *Precios actuales*', ''];
              if (showTrm) {
                try { const trm = await getTRM(); if (trm) lines.push(`💵 *Dólar TRM:* ${_formatCOP(trm.rate)} COP`); } catch (_) {}
              }
              const cryptoResults = await Promise.allSettled(cryptos.map(c => getCryptoPrice(c)));
              for (let i = 0; i < cryptos.length; i++) {
                if (cryptoResults[i].status === 'fulfilled' && cryptoResults[i].value) {
                  const b = cryptoResults[i].value;
                  lines.push(`${CRYPTO_EMOJI[b.symbol] || '🪙'} *${b.symbol}:* ${_formatUSD(b.price_usd)} (${_formatArrow(b.change_24h)})`);
                }
              }
              if (fx.length > 0) {
                const rates = await getFxRates(fx).catch(() => []);
                if (rates.length > 0) {
                  lines.push('', '💱 *Divisas*');
                  for (const r of rates) lines.push(`${FX_EMOJI[r.currency] || ''} *${FX_NAME[r.currency] || r.currency}:* ${_formatCOP(r.priceCop)} COP`);
                }
              }
              await sock.sendMessage(jid, { text: PREFIX + lines.join('\n') });
            } catch (err) {
              await sock.sendMessage(jid, { text: PREFIX + 'Error obteniendo precios: ' + err.message.substring(0, 80) });
            }
            continue;
          }
        }

        // /noticias - obtener noticias ahora (con preferencias del usuario)
        if (textLower === '/noticias') {
          try {
            await sock.sendPresenceUpdate('composing', jid);
            const prefs = await getPrefs(jid);
            const topics = prefs.news_topics && prefs.news_topics.length ? prefs.news_topics : ['colombia', 'internacional'];
            const count = prefs.news_count || 5;
            const news = await getNewsByTopics(topics, count);
            const newsText = formatNews(news) || 'No se pudieron obtener noticias en este momento.';
            await sock.sendMessage(jid, { text: PREFIX + newsText });
          } catch (err) {
            await sock.sendMessage(jid, { text: PREFIX + 'Error obteniendo noticias: ' + err.message.substring(0, 80) });
          }
          continue;
        }

        // /precios - precios actuales (con preferencias del usuario)
        if (textLower === '/precios') {
          try {
            await sock.sendPresenceUpdate('composing', jid);
            const prefs = await getPrefs(jid);
            const cryptos = prefs.cryptos && prefs.cryptos.length ? prefs.cryptos : ['BTC'];
            const fx = prefs.fx_currencies || [];
            const showTrm = prefs.show_trm !== false;

            const lines = ['💰 *Precios actuales*', ''];

            if (showTrm) {
              try {
                const trm = await getTRM();
                if (trm) lines.push(`💵 *Dólar TRM:* ${_formatCOP(trm.rate)} COP`);
              } catch (_) {}
            }

            const cryptoResults = await Promise.allSettled(cryptos.map(c => getCryptoPrice(c)));
            for (let i = 0; i < cryptos.length; i++) {
              if (cryptoResults[i].status === 'fulfilled' && cryptoResults[i].value) {
                const b = cryptoResults[i].value;
                const emoji = CRYPTO_EMOJI[b.symbol] || '🪙';
                lines.push(`${emoji} *${b.symbol}:* ${_formatUSD(b.price_usd)} (${_formatArrow(b.change_24h)})`);
              }
            }

            if (fx.length > 0) {
              const rates = await getFxRates(fx).catch(() => []);
              if (rates.length > 0) {
                lines.push('');
                lines.push('💱 *Divisas*');
                for (const r of rates) {
                  const emoji = FX_EMOJI[r.currency] || '';
                  const name = FX_NAME[r.currency] || r.currency;
                  lines.push(`${emoji} *${name}:* ${_formatCOP(r.priceCop)} COP`);
                }
              }
            }

            await sock.sendMessage(jid, { text: PREFIX + lines.join('\n') });
          } catch (err) {
            await sock.sendMessage(jid, { text: PREFIX + 'Error obteniendo precios: ' + err.message.substring(0, 80) });
          }
          continue;
        }

        // /prefs [subcomando] - ver/editar preferencias del briefing
        if (textLower === '/prefs' || textLower.startsWith('/prefs ')) {
          const args = text.replace(/^\/prefs\s*/i, '').trim();
          const argsLower = args.toLowerCase();

          try {
            const prefs = await getPrefs(jid);

            if (!args) {
              await sock.sendMessage(jid, { text: PREFIX + formatPrefsText(prefs) });
              continue;
            }

            if (argsLower === 'on') {
              await setPrefs(jid, { briefing_enabled: true });
              const times = prefs.briefing_times && prefs.briefing_times.length
                ? prefs.briefing_times.map(h => `${h}:00`).join(', ')
                : '7:00, 13:00, 19:00';
              await sock.sendMessage(jid, { text: PREFIX + `✅ Briefing automático *activado*\nRecibirás actualizaciones a las *${times}*\n\n_/prefs off para desactivar_` });
              continue;
            }

            if (argsLower === 'off') {
              await setPrefs(jid, { briefing_enabled: false });
              await sock.sendMessage(jid, { text: PREFIX + '❌ Briefing automático *desactivado*\n\n_/prefs on para activar_' });
              continue;
            }

            if (argsLower.startsWith('horarios ')) {
              const rawHours = argsLower.replace('horarios ', '').split(/\s+/).map(Number).filter(h => !isNaN(h) && h >= 0 && h <= 23);
              const scheduledTimes = getScheduledTimes ? getScheduledTimes() : [7, 13, 19];
              const validHours = rawHours.filter(h => scheduledTimes.includes(h));
              if (validHours.length === 0) {
                await sock.sendMessage(jid, { text: PREFIX + `Horarios disponibles: *7* (7:00 AM), *13* (1:00 PM), *19* (7:00 PM)\nEjemplo: _/prefs horarios 7 19_` });
              } else {
                await setPrefs(jid, { briefing_times: validHours });
                await sock.sendMessage(jid, { text: PREFIX + `⏰ Horarios actualizados: *${validHours.map(h => h + ':00').join(', ')}*` });
              }
              continue;
            }

            if (argsLower.startsWith('monedas ')) {
              const rawCryptos = argsLower.replace('monedas ', '').split(/\s+/).map(c => c.toUpperCase());
              const validCryptos = rawCryptos.filter(c => COIN_ALIASES[c.toLowerCase()]).map(c => c.toUpperCase());
              if (validCryptos.length === 0) {
                await sock.sendMessage(jid, { text: PREFIX + 'Disponibles: BTC ETH SOL BNB XRP ADA DOGE MATIC AVAX LINK ATOM LTC NEAR TON SHIB\nEjemplo: _/prefs monedas BTC ETH_' });
              } else {
                await setPrefs(jid, { cryptos: validCryptos });
                await sock.sendMessage(jid, { text: PREFIX + `₿ Criptomonedas: *${validCryptos.join(', ')}*` });
              }
              continue;
            }

            if (argsLower.startsWith('divisas ')) {
              const rawFx = argsLower.replace('divisas ', '').split(/\s+/).map(c => c.toUpperCase());
              if (rawFx.includes('NINGUNA') || rawFx.includes('NO') || rawFx.includes('NADA')) {
                await setPrefs(jid, { fx_currencies: [] });
                await sock.sendMessage(jid, { text: PREFIX + '💱 Divisas extra desactivadas.' });
              } else {
                const validFx = rawFx.filter(c => VALID_FX.includes(c));
                if (validFx.length === 0) {
                  await sock.sendMessage(jid, { text: PREFIX + `Disponibles: ${VALID_FX.join(', ')}\nEjemplo: _/prefs divisas EUR GBP_` });
                } else {
                  await setPrefs(jid, { fx_currencies: validFx });
                  await sock.sendMessage(jid, { text: PREFIX + `💱 Divisas extra: *${validFx.join(', ')}*` });
                }
              }
              continue;
            }

            if (argsLower.startsWith('noticias ')) {
              const rawTopics = argsLower.replace('noticias ', '').split(/\s+/);
              const validTopics = rawTopics.filter(t => VALID_TOPICS.includes(t));
              if (validTopics.length === 0) {
                await sock.sendMessage(jid, { text: PREFIX + `Temas disponibles: *${VALID_TOPICS.join(', ')}*\nEjemplo: _/prefs noticias colombia tecnologia_` });
              } else {
                await setPrefs(jid, { news_topics: validTopics });
                await sock.sendMessage(jid, { text: PREFIX + `📰 Temas de noticias: *${validTopics.join(', ')}*` });
              }
              continue;
            }

            if (argsLower.startsWith('cantidad ')) {
              const n = parseInt(argsLower.replace('cantidad ', ''));
              if (isNaN(n) || n < 1 || n > 10) {
                await sock.sendMessage(jid, { text: PREFIX + 'Cantidad válida: 1 a 10\nEjemplo: _/prefs cantidad 5_' });
              } else {
                await setPrefs(jid, { news_count: n });
                await sock.sendMessage(jid, { text: PREFIX + `📰 Cantidad de noticias: *${n}*` });
              }
              continue;
            }

            if (argsLower.startsWith('clima ')) {
              const val = argsLower.includes('on') || argsLower.includes('si') || argsLower.includes('sí');
              await setPrefs(jid, { show_weather: val });
              await sock.sendMessage(jid, { text: PREFIX + `🌤️ Clima en el briefing: ${val ? '*activado*' : '*desactivado*'}` });
              continue;
            }

            if (argsLower.startsWith('dolar ') || argsLower.startsWith('dólar ') || argsLower.startsWith('trm ')) {
              const val = argsLower.includes('on') || argsLower.includes('si') || argsLower.includes('sí');
              await setPrefs(jid, { show_trm: val });
              await sock.sendMessage(jid, { text: PREFIX + `💵 Dólar TRM en el briefing: ${val ? '*activado*' : '*desactivado*'}` });
              continue;
            }

            // Subcomando no reconocido → mostrar prefs
            await sock.sendMessage(jid, { text: PREFIX + formatPrefsText(prefs) });
          } catch (err) {
            await sock.sendMessage(jid, { text: PREFIX + 'Error actualizando preferencias: ' + err.message.substring(0, 80) });
          }
          continue;
        }

        // /briefing (sin argumentos) - briefing completo ahora con las prefs del usuario
        if (textLower === '/briefing') {
          try {
            await sock.sendPresenceUpdate('composing', jid);
            await sendBriefingNow(sock, jid);
          } catch (err) {
            await sock.sendMessage(jid, { text: PREFIX + 'Error generando briefing: ' + err.message.substring(0, 100) });
          }
          continue;
        }

        // ============================================
        // FLUJO ADMIN - Comandos privilegiados
        // ============================================
        if (isAdmin(jid) || msg.key.fromMe) {
          // Ignorar mensajes propios que no sean comandos si no hay bot activo
          // (el admin puede usar el bot normalmente si activa groq)

          if (textLower === '/briefing off') {
            setEnabled(false, sock);
            await sock.sendMessage(jid, { text: PREFIX + '⏹️ Briefing automático *desactivado* globalmente.\nReactivar: /briefing on' });
            continue;
          }

          if (textLower === '/briefing on') {
            setEnabled(true, sock);
            const times = (getScheduledTimes ? getScheduledTimes() : [7, 13, 19]).map(h => h + ':00').join(', ');
            await sock.sendMessage(jid, {
              text: PREFIX + `✅ Briefing automático *activado*\nHorarios: *${times}*\n_Zona: ${process.env.TIMEZONE || 'America/Bogota'}_`
            });
            continue;
          }

          if (textLower === '/briefing status') {
            const enabled = isEnabled();
            const times = (getScheduledTimes ? getScheduledTimes() : [7, 13, 19]).map(h => h + ':00').join(', ');
            await sock.sendMessage(jid, {
              text: PREFIX + [
                '*Daily Briefing (Admin)*',
                `Estado global: ${enabled ? '*activo* ✅' : '*desactivado* ❌'}`,
                `Horarios: *${times}*`,
                `Zona: _${process.env.TIMEZONE || 'America/Bogota'}_`,
                '',
                'Comandos admin:',
                '  /briefing on/off - Activar/desactivar global',
                '  /briefing status - Estado',
                '',
                'Comandos personales:',
                '  /briefing - Obtener briefing ahora',
                '  /prefs - Ver/editar mis preferencias',
              ].join('\n')
            });
            continue;
          }

          const noticiaMatch = text.match(/^\/noticia\s+(\d+)$/i);
          if (noticiaMatch) {
            const num = parseInt(noticiaMatch[1]);
            const news = getLastNews();
            if (news.length === 0) {
              await sock.sendMessage(jid, { text: PREFIX + 'No hay noticias cargadas. Escribe /briefing primero.' });
              continue;
            }
            if (num < 1 || num > news.length) {
              await sock.sendMessage(jid, { text: PREFIX + `Numero invalido. Hay ${news.length} noticias (1-${news.length}).` });
              continue;
            }
            await sock.sendPresenceUpdate('composing', jid);
            const n = news[num - 1];
            let articleUrl = '';
            let summary = '';
            try {
              const { searchResult, content } = await _findAndFetchArticle(n.title, n.source);
              articleUrl = searchResult?.url || '';
              if (content) summary = await _summarizeWithAI(groqService, n.title, content);
            } catch (e) {
              console.log('[Router] Error buscando articulo:', e.message);
            }
            const divider = '─'.repeat(25);
            const lines = [`📰 *${n.title}*`, divider];
            if (n.source) lines.push(`📌 _${n.source}_`);
            if (summary) lines.push('', summary);
            if (articleUrl) lines.push('', `🔗 ${articleUrl}`);
            lines.push('', divider);
            const nav = [];
            if (num > 1) nav.push(`/noticia ${num - 1} ← ant`);
            if (num < news.length) nav.push(`/noticia ${num + 1} → sig`);
            if (nav.length > 0) lines.push(nav.join('  |  '));
            await sock.sendMessage(jid, { text: PREFIX + lines.join('\n') });
            continue;
          }

          if (textLower === '/bot') {
            pendingSelection.set(jid, Date.now());
            setTimeout(() => {
              const ts = pendingSelection.get(jid);
              if (ts && (Date.now() - ts) >= SELECTION_TIMEOUT_MS) pendingSelection.delete(jid);
            }, SELECTION_TIMEOUT_MS);
            const currentStatus = activeBot
              ? `Bot activo: *${activeBot === 'groq' ? 'Groq IA' : 'Control de Gastos'}*`
              : '_Ningun bot activo_';
            await sendButtonMessage(sock, jid,
              '*Selecciona un bot*',
              currentStatus + '  |  Responde *1* o *2*',
              [
                { id: 'bot_groq', text: 'Groq IA', desc: 'Asistente de IA con voz, vision, GIFs y mas' },
                { id: 'bot_gastos', text: 'Control de Gastos', desc: 'Registro y analisis de gastos en Google Sheets' },
              ]
            );
            continue;
          }

          if (textLower === '/stop') {
            pendingSelection.delete(jid);
            if (activeBot !== 'gastos' && activeBot !== 'gastos_onboarding') {
              await sock.sendMessage(jid, { text: PREFIX + 'Groq IA es el modo por defecto.\n\n/bot - Activar Control de Gastos' });
              continue;
            }
            activeBot = null;
            await sock.sendMessage(jid, {
              text: PREFIX + `*Control de Gastos* desactivado\n\nGroq IA activo por defecto.\n/bot - Volver a Gastos`
            });
            console.log('[Router] Gastos desactivado, volviendo a Groq.');
            continue;
          }

          if (textLower === '/status') {
            if (activeBot === 'gastos') {
              await sock.sendMessage(jid, { text: PREFIX + `Bot activo: *Control de Gastos*\n\n/stop - Volver a Groq IA\n/bot - Cambiar bot` });
            } else {
              await sock.sendMessage(jid, { text: PREFIX + 'Groq IA activo (por defecto)\n\n/bot - Activar Control de Gastos' });
            }
            continue;
          }

          // /bloquear <numero_o_jid> [razon]
          // Acepta: /bloquear 573108857927  o  /bloquear 150714848379046@lid
          const bloquearMatch = text.match(/^\/bloquear\s+\+?(\S+)(?:\s+(.+))?$/i);
          if (bloquearMatch) {
            const raw = bloquearMatch[1];
            const razon = bloquearMatch[2] || null;
            // Si ya trae @ es un JID completo (ej: @lid); si no, es número de teléfono
            const targetJid = raw.includes('@') ? raw : raw + '@s.whatsapp.net';
            const display = raw.includes('@') ? raw : `+${raw}`;
            await blockContact(targetJid, razon);
            await sock.sendMessage(jid, { text: PREFIX + `*${display}* bloqueado.${razon ? '\nRazón: ' + razon : ''}` });
            continue;
          }

          // /desbloquear <numero_o_jid>
          const desbloquearMatch = text.match(/^\/desbloquear\s+\+?(\S+)$/i);
          if (desbloquearMatch) {
            const raw = desbloquearMatch[1];
            const targetJid = raw.includes('@') ? raw : raw + '@s.whatsapp.net';
            const display = raw.includes('@') ? raw : `+${raw}`;
            await unblockContact(targetJid);
            await sock.sendMessage(jid, { text: PREFIX + `*${display}* desbloqueado.` });
            continue;
          }

          // /bloqueados - ver lista negra
          if (textLower === '/bloqueados') {
            const lista = await getBlockedContacts();
            if (lista.length === 0) {
              await sock.sendMessage(jid, { text: PREFIX + 'Lista negra vacía.\n\n/bloquear <numero> [razon] - Agregar número' });
            } else {
              const lineas = lista.map((c, i) => {
                const num = c.jid.replace('@s.whatsapp.net', '');
                const nombre = c.name ? ` (${c.name})` : '';
                const razon = c.block_reason ? `  → ${c.block_reason}` : '';
                return `${i + 1}. +${num}${nombre}${razon}`;
              });
              await sock.sendMessage(jid, {
                text: PREFIX + `*Lista negra (${lista.length})*\n\n${lineas.join('\n')}\n\n/desbloquear <numero> - Quitar de la lista`
              });
            }
            continue;
          }

          // Seleccion de bot pendiente (admin)
          if (pendingSelection.has(jid)) {
            let selection = null;
            if (interactive) {
              if (interactive.id === 'bot_groq') selection = 'groq';
              else if (interactive.id === 'bot_gastos') selection = 'gastos';
            }
            if (!selection && (text === '1' || text === '2')) {
              selection = text === '1' ? 'groq' : 'gastos';
            }
            if (selection) {
              pendingSelection.delete(jid);
              const divider = '─'.repeat(25);
              if (selection === 'groq') {
                activeBot = 'groq';
                await sock.sendMessage(jid, {
                  text: PREFIX +
                    '*Groq IA activado*\n' + divider + '\n\n' +
                    'Escribeme, enviame un audio, una imagen, un documento o una URL.\n\n' +
                    '*Comandos principales:*\n' +
                    '  /ayuda  -  Ver todos los comandos\n' +
                    '  /modelo  -  Cambiar modelo de IA\n' +
                    '  /voz  -  Respuestas por voz\n' +
                    '  /role  -  Cambiar personalidad\n' +
                    '  /sticker  -  Convertir imagen a sticker\n' +
                    '  /gif  -  Buscar y enviar GIFs\n\n' +
                    divider + '\n_Escribe /stop para desactivar_'
                });
              } else {
                // Gastos: verificar si el admin ya tiene su sheet personal
                const gastosData = await getGastosData(jid);
                if (gastosData.onboarding_step === 'complete' && gastosData.sheet_id) {
                  activeBot = 'gastos';
                  await sock.sendMessage(jid, {
                    text: PREFIX +
                      '*Control de Gastos activado*\n' + divider + '\n\n' +
                      'Registra un gasto escribiendo:\n_Almuerzo 25k_ | _Uber 15.000_ | _Netflix 20k_\n\n' +
                      `📊 Tu hoja: ${gastosData.sheet_url}\n\n` +
                      divider + '\n_Escribe */ayuda* para ver todos los comandos_\n_/stop para desactivar_'
                  });
                } else if (gastosData.onboarding_step && gastosData.onboarding_step !== 'complete') {
                  activeBot = 'gastos_onboarding';
                  await resendCurrentStep(sock, jid);
                } else {
                  activeBot = 'gastos_onboarding';
                  await startGastosOnboarding(sock, jid);
                }
              }
              continue;
            }
          }

          // /resetgastos - Reset datos de gastos (admin)
          if (textLower === '/resetgastos' || textLower === '/resetgastos all') {
            const resetAll = textLower === '/resetgastos all';
            await sock.sendMessage(jid, { text: PREFIX + `⏳ Reseteando datos de gastos${resetAll ? ' de todos los usuarios' : ''}...` });
            let ok;
            if (resetAll) {
              ok = await resetAllGastosData();
            } else {
              await resetGastosData(jid);
              ok = true;
            }
            activeBot = null;
            if (ok) {
              await sock.sendMessage(jid, {
                text: PREFIX + [
                  `✅ *Gastos reseteados${resetAll ? ' (todos los usuarios)' : ''}*`,
                  '',
                  resetAll
                    ? 'Todos los usuarios deberán pasar por el onboarding nuevamente para crear su hoja de cálculo propia.'
                    : 'Tu perfil de gastos fue reseteado. Usa /gastos para configurar de nuevo.',
                  '',
                  '_Groq IA activo por defecto._',
                ].join('\n')
              });
            } else {
              await sock.sendMessage(jid, { text: PREFIX + 'Error al resetear. Revisa los logs.' });
            }
            continue;
          }

          // Trigger words de gastos para el admin - usa sheet propio (igual que usuarios externos)
          if (GASTOS_TRIGGERS.includes(textLower)) {
            const gastosData = await getGastosData(jid);
            if (gastosData.onboarding_step === 'complete' && gastosData.sheet_id) {
              activeBot = 'gastos';
              const divider = '─'.repeat(25);
              await sock.sendMessage(jid, {
                text: PREFIX + `💰 *Control de Gastos activado*\n${divider}\n\nRegistra un gasto:\n_Almuerzo 25k_ | _Uber 15.000_ | _Netflix 20k_\n\n📊 Tu hoja: ${gastosData.sheet_url}\n\n${divider}\n_Escribe */ayuda* para ver todos los comandos_\n_/stop para desactivar_`
              });
            } else if (gastosData.onboarding_step && gastosData.onboarding_step !== 'complete') {
              activeBot = 'gastos_onboarding';
              await resendCurrentStep(sock, jid);
            } else {
              activeBot = 'gastos_onboarding';
              await startGastosOnboarding(sock, jid);
            }
            continue;
          }

          // NL trigger gastos: "quiero ver mis gastos", "mi configuración de gastos", etc.
          // Activa el modo silenciosamente y procesa el mensaje directo (sin welcome)
          if (activeBot !== 'gastos' && activeBot !== 'gastos_onboarding' && _isGastosNL(textLower)) {
            const gastosData = await getGastosData(jid);
            if (gastosData.onboarding_step === 'complete' && gastosData.sheet_id) {
              activeBot = 'gastos';
              await handleGastosMessage(msg, sock, gastosData.sheet_id);
            } else if (gastosData.onboarding_step && gastosData.onboarding_step !== 'complete') {
              activeBot = 'gastos_onboarding';
              await resendCurrentStep(sock, jid);
            } else {
              activeBot = 'gastos_onboarding';
              await startGastosOnboarding(sock, jid);
            }
            continue;
          }

          // Delegar: Gastos (con sheet propio), Onboarding, o Groq por defecto
          if (activeBot === 'gastos_onboarding') {
            const done = await handleGastosOnboardingStep(sock, jid, text, groqService);
            if (done) activeBot = 'gastos';
          } else if (activeBot === 'gastos') {
            const gastosData = await getGastosData(jid);
            await handleGastosMessage(msg, sock, gastosData.sheet_id || null);
          } else {
            // Fallback: recuperar estado desde Supabase si la memoria se perdió (restart)
            const gastosData = await getGastosData(jid);
            if (gastosData.onboarding_step && gastosData.onboarding_step !== 'complete') {
              activeBot = 'gastos_onboarding';
              const done = await handleGastosOnboardingStep(sock, jid, text, groqService);
              if (done) activeBot = 'gastos';
            } else if (gastosData.onboarding_step === 'complete' && gastosData.sheet_id) {
              activeBot = 'gastos';
              await handleGastosMessage(msg, sock, gastosData.sheet_id);
            } else {
              await handleGroqMessage(msg, sock, groqService);
            }
          }
          continue;
        }

        // ============================================
        // FILTRO: LISTA NEGRA Y NÚMEROS +58
        // ============================================

        // phoneNumber: para JIDs @s.whatsapp.net es el número real; para @lid es opaco
        const phoneNumber = jid.split(':')[0].split('@')[0];
        // +58 solo aplica si el JID es @s.whatsapp.net (número real conocido)
        const isVenezuelan = jid.endsWith('@s.whatsapp.net') && phoneNumber.startsWith('58');
        // Revisar lista negra tanto por JID real (@s.whatsapp.net) como por @lid
        const blocked = await isBlocked(jid);

        if (isVenezuelan || blocked) {
          const warningMsg =
            '🚨 *AVISO OFICIAL* 🚨\n\n' +
            'Este número ha sido identificado, reportado y está siendo monitoreado ' +
            'por las autoridades competentes.\n\n' +
            'Toda comunicación queda registrada y será entregada a los organismos ' +
            'de seguridad correspondientes.\n\n' +
            'Le recomendamos abstenerse de continuar contactando este número.\n\n' +
            '_Este es un aviso automatizado. No responda a este mensaje._';
          await sock.sendMessage(jid, { text: warningMsg });
          console.log(`[Router] [BLOQUEADO] jid=${jid} (${isVenezuelan ? '+58 Venezuela' : 'lista negra'})`);
          continue;
        }

        // ============================================
        // FLUJO USUARIOS EXTERNOS - Groq IA multi-usuario
        // ============================================

        // /noticia <num> también disponible para usuarios externos (usando la misma caché)
        const noticiaExtMatch = text.match(/^\/noticia\s+(\d+)$/i);
        if (noticiaExtMatch) {
          const num = parseInt(noticiaExtMatch[1]);
          const news = getLastNews();
          if (news.length === 0) {
            await sock.sendMessage(jid, { text: PREFIX + 'No hay noticias cargadas. Escribe /noticias primero.' });
            continue;
          }
          if (num < 1 || num > news.length) {
            await sock.sendMessage(jid, { text: PREFIX + `Número inválido. Hay ${news.length} noticias (1-${news.length}).` });
            continue;
          }
          await sock.sendPresenceUpdate('composing', jid);
          const n = news[num - 1];
          let articleUrl = '';
          let summary = '';
          try {
            const { searchResult, content } = await _findAndFetchArticle(n.title, n.source);
            articleUrl = searchResult?.url || '';
            if (content) summary = await _summarizeWithAI(groqService, n.title, content);
          } catch (e) {
            console.log('[Router] Error buscando artículo:', e.message);
          }
          const divider = '─'.repeat(25);
          const lines = [`📰 *${n.title}*`, divider];
          if (n.source) lines.push(`📌 _${n.source}_`);
          if (summary) lines.push('', summary);
          if (articleUrl) lines.push('', `🔗 ${articleUrl}`);
          lines.push('', divider);
          const nav = [];
          if (num > 1) nav.push(`/noticia ${num - 1} ← ant`);
          if (num < news.length) nav.push(`/noticia ${num + 1} → sig`);
          if (nav.length > 0) lines.push(nav.join('  |  '));
          await sock.sendMessage(jid, { text: PREFIX + lines.join('\n') });
          continue;
        }

        // Comando /miperfil - cambiar personalidad (disponible para todos)
        const miperfilMatch = text.match(/^\/miperfil\s+(.+)$/is);
        if (miperfilMatch) {
          await updatePersonality(sock, jid, miperfilMatch[1].trim(), groqService);
          continue;
        }

        // Verificar estado de onboarding
        const onboardingState = await getOnboardingState(jid);
        console.log(`[Router] [USER] onboarding=${onboardingState} jid=${jid}`);

        if (onboardingState === 'new') {
          await startOnboarding(sock, jid, pushName);
          console.log(`[Router] [USER] onboarding iniciado para jid=${jid}`);
          continue;
        }

        if (onboardingState === 'in_progress') {
          await handleOnboardingStep(sock, jid, text, groqService);
          continue;
        }

        // ============================================
        // MODO GASTOS (usuarios externos)
        // ============================================
        const userBot = userActiveBot.get(jid);

        // Salir de gastos
        if (userBot && (textLower === '/salir' || textLower === '/stop')) {
          userActiveBot.delete(jid);
          await sock.sendMessage(jid, { text: PREFIX + '👋 Volviste al asistente de IA. Escríbeme cuando necesites algo!' });
          continue;
        }

        // NL trigger gastos para externos: activa silenciosamente y procesa directo
        if (!userBot && _isGastosNL(textLower)) {
          const gastosData = await getGastosData(jid);
          if (gastosData.onboarding_step === 'complete' && gastosData.sheet_id) {
            userActiveBot.set(jid, 'gastos');
            if (gastosData.sheet_id) setCurrentSpreadsheetId(gastosData.sheet_id);
            try {
              await handleGastosMessage(msg, sock, gastosData.sheet_id);
            } catch (err) {
              console.error(`[Router] [USER] Gastos NL error jid=${jid}:`, err.message);
            }
          } else if (gastosData.onboarding_step && gastosData.onboarding_step !== 'complete') {
            userActiveBot.set(jid, 'gastos_onboarding');
            await resendCurrentStep(sock, jid);
          } else {
            userActiveBot.set(jid, 'gastos_onboarding');
            await startGastosOnboarding(sock, jid);
          }
          continue;
        }

        // Trigger words para activar gastos
        if (!userBot && GASTOS_TRIGGERS.includes(textLower)) {
          const gastosData = await getGastosData(jid);

          if (gastosData.onboarding_step === 'complete' && gastosData.sheet_id) {
            // Onboarding completo → activar modo gastos
            userActiveBot.set(jid, 'gastos');
            const divider = '─'.repeat(25);
            await sock.sendMessage(jid, {
              text: PREFIX + [
                '💰 *Modo Finanzas activado*',
                divider,
                '',
                'Registra un gasto escribiendo lo que gastaste:',
                '_"Almuerzo 25k"_ | _"Transporte 15.000"_ | _"Netflix 20k"_',
                '',
                `📊 Tu hoja: ${gastosData.sheet_url || '(ver en config)'}`,
                divider,
                '_Escribe */ayuda* para ver todos los comandos_',
                '_/salir → volver al asistente de IA_',
              ].join('\n'),
            });
          } else if (gastosData.onboarding_step && gastosData.onboarding_step !== 'complete') {
            // Onboarding en progreso → retomar
            userActiveBot.set(jid, 'gastos_onboarding');
            await resendCurrentStep(sock, jid);
          } else {
            // Nuevo → iniciar onboarding
            userActiveBot.set(jid, 'gastos_onboarding');
            await startGastosOnboarding(sock, jid);
          }
          continue;
        }

        // Estamos en onboarding de gastos
        if (userBot === 'gastos_onboarding') {
          const done = await handleGastosOnboardingStep(sock, jid, text, groqService);
          if (done) {
            userActiveBot.set(jid, 'gastos'); // Completado → cambiar a modo gastos
          }
          continue;
        }

        // Estamos en modo gastos activo
        if (userBot === 'gastos') {
          const gastosData = await getGastosData(jid);
          if (gastosData.sheet_id) setCurrentSpreadsheetId(gastosData.sheet_id);
          try {
            await handleGastosMessage(msg, sock, gastosData.sheet_id);
          } catch (err) {
            console.error(`[Router] [USER] Gastos error jid=${jid}:`, err.message);
            await sock.sendMessage(jid, { text: PREFIX + 'Hubo un error con el bot de finanzas. Intenta de nuevo.' });
          }
          continue;
        }

        // ============================================
        // Groq IA por defecto (con fallback a gastos si estaba mid-onboarding)
        // ============================================
        // Fallback: si el servidor se reinició y el usuario estaba en onboarding de gastos,
        // recuperar estado desde Supabase
        {
          const gastosData = await getGastosData(jid);
          if (gastosData.onboarding_step && gastosData.onboarding_step !== 'complete') {
            userActiveBot.set(jid, 'gastos_onboarding');
            const done = await handleGastosOnboardingStep(sock, jid, text, groqService);
            if (done) userActiveBot.set(jid, 'gastos');
            continue;
          }
          if (gastosData.onboarding_step === 'complete' && gastosData.sheet_id && userBot === 'gastos') {
            userActiveBot.set(jid, 'gastos');
            await handleGastosMessage(msg, sock, gastosData.sheet_id);
            continue;
          }
        }

        await loadPersonalityIfNeeded(jid, groqService);
        console.log(`[Router] [USER] → Groq jid=${jid}`);
        try {
          await handleGroqMessage(msg, sock, groqService);
          console.log(`[Router] [USER] ← Groq OK jid=${jid}`);
        } catch (groqErr) {
          console.error(`[Router] [USER] ← Groq ERROR jid=${jid}:`, groqErr.message);
          try { await sock.sendMessage(jid, { text: 'Hubo un error al responder. Intenta de nuevo.' }); } catch (_) {}
        }

      } catch (error) {
        console.error('[Router] Error:', error.message);
      }
    }
  });
}

function getActiveBot() {
  return activeBot;
}

// ============================================
// Helpers para /noticia
// ============================================

const { searchDDGLite, searchDDGHtml } = (() => {
  try { return require('../Groqbot/src/webSearch'); } catch (_) { return {}; }
})();

async function _findAndFetchArticle(title, source) {
  const query = `${title} ${source || ''}`.trim();
  let results = [];
  try {
    if (searchDDGLite) results = await searchDDGLite(query);
    if (results.length === 0 && searchDDGHtml) results = await searchDDGHtml(query);
  } catch (e) {
    console.log('[Router] Error en busqueda web:', e.message);
  }
  const searchResult = results.find(r =>
    r.url &&
    !r.url.includes('news.google.com') &&
    !r.url.includes('twitter.com') &&
    !r.url.includes('facebook.com') &&
    !r.url.includes('youtube.com')
  ) || results[0];
  if (!searchResult?.url) return { searchResult: null, content: null };
  const content = await _fetchArticleContent(searchResult.url);
  return { searchResult, content };
}

async function _fetchArticleContent(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'es-CO,es;q=0.9',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
      .replace(/<\/?(p|br|div|h[1-6]|li|tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/  +/g, ' ')
      .trim();
    if (text.length > 4000) text = text.substring(0, 4000);
    return text.length > 100 ? text : null;
  } catch (err) {
    console.log('[Router] Error fetching article:', err.message);
    return null;
  }
}

async function _summarizeWithAI(groqService, title, content) {
  try {
    const response = await groqService.client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: 'Eres un periodista colombiano. Resume esta noticia en espanol de forma clara y concisa. Maximo 4-5 oraciones cortas. No uses markdown ni formato especial, solo texto plano.' },
        { role: 'user', content: `Resume esta noticia:\n\nTitulo: ${title}\n\nContenido:\n${content}` },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });
    return response.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.log('[Router] Error AI summary:', err.message);
    return null;
  }
}

module.exports = { setupRouter, getActiveBot };
