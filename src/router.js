// src/router.js
// Router unificado para Baileys: bot único con lenguaje natural, sin modos separados.

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

// Palabras clave opcionales que inician el onboarding de gastos o muestran estado
const GASTOS_TRIGGERS = ['/gastos', '/ahorros', '/finanzas', '/presupuesto', '/cuentas', '/dinero', '/plata'];

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
          await resetGastosData(jid);
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
        // ADMIN-ONLY COMMANDS - Solo accesibles por el admin
        // ============================================
        if (isAdmin(jid) || msg.key.fromMe) {
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

          // /bloquear <numero_o_jid> [razon]
          const bloquearMatch = text.match(/^\/bloquear\s+\+?(\S+)(?:\s+(.+))?$/i);
          if (bloquearMatch) {
            const raw = bloquearMatch[1];
            const razon = bloquearMatch[2] || null;
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

          // /resetgastos all - solo admin puede resetear todos los usuarios
          if (textLower === '/resetgastos all') {
            await sock.sendMessage(jid, { text: PREFIX + '⏳ Reseteando datos de gastos de todos los usuarios...' });
            const ok = await resetAllGastosData();
            if (ok) {
              await sock.sendMessage(jid, { text: PREFIX + '✅ *Gastos reseteados (todos los usuarios)*\n\nTodos deberán pasar por el onboarding nuevamente.' });
            } else {
              await sock.sendMessage(jid, { text: PREFIX + 'Error al resetear. Revisa los logs.' });
            }
            continue;
          }

          // Comandos admin no reconocidos → caen al flujo unificado
        }

        // ============================================
        // FILTRO: LISTA NEGRA Y NÚMEROS +58 (no admin)
        // ============================================
        if (!isAdmin(jid)) {
          const phoneNumber = jid.split(':')[0].split('@')[0];
          const isVenezuelan = jid.endsWith('@s.whatsapp.net') && phoneNumber.startsWith('58');
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
        }

        // /noticia N - para usuarios externos (admin ya lo manejó arriba)
        if (!isAdmin(jid)) {
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
        }

        // /miperfil - cambiar personalidad (todos los usuarios)
        const miperfilMatch = text.match(/^\/miperfil\s+(.+)$/is);
        if (miperfilMatch) {
          await updatePersonality(sock, jid, miperfilMatch[1].trim(), groqService);
          continue;
        }

        // Onboarding de personalidad (primer contacto)
        const onboardingState = await getOnboardingState(jid);
        console.log(`[Router] onboarding=${onboardingState} jid=${jid}`);
        if (onboardingState === 'new') {
          await startOnboarding(sock, jid, pushName);
          continue;
        }
        if (onboardingState === 'in_progress') {
          await handleOnboardingStep(sock, jid, text, groqService);
          continue;
        }

        // /salir y /stop — ya no hay modo que desactivar, el bot es unificado
        if (textLower === '/salir' || textLower === '/stop') {
          await sock.sendMessage(jid, { text: PREFIX + '¿En qué puedo ayudarte? Escríbeme lo que necesites.' });
          continue;
        }

        // Trigger words de gastos — opcionales, inician onboarding o muestran estado
        if (GASTOS_TRIGGERS.includes(textLower)) {
          const gd = await getGastosData(jid);
          if (gd.onboarding_step === 'complete' && gd.sheet_id) {
            const divider = '─'.repeat(25);
            await sock.sendMessage(jid, {
              text: PREFIX + [
                '💰 *Tu tracker de gastos está listo*',
                divider,
                '',
                'Escríbeme directamente (sin comandos):',
                '  • _"Almuerzo 25k"_ — registrar gasto',
                '  • _"ver mis gastos"_ — últimos gastos del mes',
                '  • _"resumen"_ — análisis financiero completo',
                '  • _"cuánto tengo"_ — estado de cuentas',
                '  • _"ver config"_ — configuración actual',
                '',
                `📊 ${gd.sheet_url || 'Hoja de cálculo configurada'}`,
                divider,
                '_Escribe /resetgastos para reconfigurar desde cero._',
              ].join('\n'),
            });
          } else if (gd.onboarding_step && gd.onboarding_step !== 'complete') {
            await resendCurrentStep(sock, jid);
          } else {
            await startGastosOnboarding(sock, jid);
          }
          continue;
        }

        // ============================================
        // RUTEO UNIFICADO — Gastos → Groq
        // Si gastos está configurado, intenta procesarlo primero.
        // Si el mensaje no es gasto ni consulta financiera, cae a Groq IA.
        // ============================================
        const gastosData = await getGastosData(jid);

        // Onboarding de gastos en progreso → continuar setup
        if (gastosData.onboarding_step && gastosData.onboarding_step !== 'complete') {
          await handleGastosOnboardingStep(sock, jid, text, groqService);
          continue;
        }

        // Gastos configurado → intentar procesar primero
        if (gastosData.onboarding_step === 'complete' && gastosData.sheet_id) {
          setCurrentSpreadsheetId(gastosData.sheet_id);
          let handled;
          try {
            handled = await handleGastosMessage(msg, sock, gastosData.sheet_id);
          } catch (err) {
            console.error(`[Router] Gastos error jid=${jid}:`, err.message);
            handled = false;
          }
          if (handled !== false) continue;
          // Si no manejó → cae a Groq IA
        }

        // Groq IA — responde todo lo que gastos no procesó
        await loadPersonalityIfNeeded(jid, groqService);
        console.log(`[Router] → Groq jid=${jid}`);
        try {
          await handleGroqMessage(msg, sock, groqService);
        } catch (groqErr) {
          console.error(`[Router] Groq ERROR jid=${jid}:`, groqErr.message);
          try { await sock.sendMessage(jid, { text: 'Hubo un error al responder. Intenta de nuevo.' }); } catch (_) {}
        }

      } catch (error) {
        console.error('[Router] Error:', error.message);
      }
    }
  });
}

function getActiveBot() {
  return null; // bot unificado — ya no hay modos separados
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
