// src/router.js
// Router unificado para Baileys: multi-usuario con onboarding y personalidad por contacto

const { handleGroqMessage } = require('../Groqbot/src/whatsappClient');
const { handleGastosMessage } = require('../Gastos/src/whatsapp/messageHandler');
const { sendBriefingNow, setScheduleTime, setEnabled, isEnabled, getScheduleTime } = require('../DailyBriefing/src/scheduler');
const { getLastNews } = require('../DailyBriefing/src/newsService');
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

// Estado global (solo admin)
let activeBot = null; // null | 'groq' | 'gastos'
const pendingSelection = new Map(); // chatId -> timestamp
const SELECTION_TIMEOUT_MS = 60 * 1000;

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

        // fromMe=true significa que el mensaje lo envió ESTA cuenta (el admin desde su teléfono).
        // Solo procesamos si tiene texto y no es una respuesta del propio bot (PREFIX).
        // Cualquier fromMe con texto = comando del admin, independiente del formato @lid del JID.
        const isSelfCommand = msg.key.fromMe && !!body && !body.startsWith(PREFIX);
        if (msg.key.fromMe && !isSelfCommand) continue; // Bot enviando sin texto → ignorar

        const text = body.trim();
        const textLower = text.toLowerCase();
        const pushName = msg.pushName || null;

        if (body || interactive) {
          console.log(`[Router] ${isAdmin(jid) ? '[ADMIN]' : '[USER]'} jid=${jid} texto="${(body || '').substring(0, 50)}"`);
        }

        // Marcar mensaje como leído
        try { await sock.readMessages([msg.key]); } catch (_) {}

        // ============================================
        // FLUJO ADMIN - Comandos privilegiados
        // ============================================
        if (isAdmin(jid) || isSelfCommand) {
          // Ignorar mensajes propios que no sean comandos si no hay bot activo
          // (el admin puede usar el bot normalmente si activa groq)

          if (textLower === '/briefing') {
            try {
              await sock.sendPresenceUpdate('composing', jid);
              await sendBriefingNow(sock, jid);
            } catch (err) {
              await sock.sendMessage(jid, { text: PREFIX + 'Error generando briefing: ' + err.message.substring(0, 100) });
            }
            continue;
          }

          const briefingHoraMatch = text.match(/^\/briefing\s+hora\s+(\d{1,2}):?(\d{2})?$/i);
          if (briefingHoraMatch) {
            const hour = parseInt(briefingHoraMatch[1]);
            const minute = parseInt(briefingHoraMatch[2] || '0');
            if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
              await sock.sendMessage(jid, { text: PREFIX + 'Hora invalida. Usa formato 24h: /briefing hora 7:00' });
              continue;
            }
            setScheduleTime(hour, minute, sock);
            await sock.sendMessage(jid, {
              text: PREFIX + `⏰ Briefing programado a las *${hour}:${String(minute).padStart(2, '0')}*\n_Zona: ${process.env.TIMEZONE || 'America/Bogota'}_`
            });
            continue;
          }

          if (textLower === '/briefing off') {
            setEnabled(false, sock);
            await sock.sendMessage(jid, { text: PREFIX + 'Daily briefing *desactivado*.\nReactivar: /briefing on' });
            continue;
          }

          if (textLower === '/briefing on') {
            setEnabled(true, sock);
            const { hour, minute } = getScheduleTime();
            await sock.sendMessage(jid, {
              text: PREFIX + `Daily briefing *activado* ⏰\nHora: *${hour}:${String(minute).padStart(2, '0')}*\n_Zona: ${process.env.TIMEZONE || 'America/Bogota'}_`
            });
            continue;
          }

          if (textLower === '/briefing status') {
            const enabled = isEnabled();
            const { hour, minute } = getScheduleTime();
            await sock.sendMessage(jid, {
              text: PREFIX + [
                '*Daily Briefing*',
                `Estado: ${enabled ? '*activo* ✅' : '*desactivado* ❌'}`,
                `Hora: *${hour}:${String(minute).padStart(2, '0')}*`,
                `Zona: _${process.env.TIMEZONE || 'America/Bogota'}_`,
                '',
                'Comandos:',
                '  /briefing - Obtener ahora',
                '  /briefing hora 7:00 - Cambiar hora',
                '  /briefing on/off - Activar/desactivar',
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
            if (activeBot !== 'gastos') {
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

          // /bloquear <numero> [razon]
          const bloquearMatch = text.match(/^\/bloquear\s+\+?(\d+)(?:\s+(.+))?$/i);
          if (bloquearMatch) {
            const num = bloquearMatch[1];
            const razon = bloquearMatch[2] || null;
            const targetJid = num + '@s.whatsapp.net';
            await blockContact(targetJid, razon);
            await sock.sendMessage(jid, { text: PREFIX + `Número *+${num}* bloqueado.${razon ? '\nRazón: ' + razon : ''}` });
            continue;
          }

          // /desbloquear <numero>
          const desbloquearMatch = text.match(/^\/desbloquear\s+\+?(\d+)$/i);
          if (desbloquearMatch) {
            const num = desbloquearMatch[1];
            const targetJid = num + '@s.whatsapp.net';
            await unblockContact(targetJid);
            await sock.sendMessage(jid, { text: PREFIX + `Número *+${num}* desbloqueado.` });
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
              activeBot = selection;
              const divider = '─'.repeat(25);
              if (selection === 'groq') {
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
                await sock.sendMessage(jid, {
                  text: PREFIX +
                    '*Control de Gastos activado*\n' + divider + '\n\n' +
                    'Registra un gasto escribiendo:\n_Almuerzo 25k_\n\n' +
                    '*Comandos principales:*\n' +
                    '  ver gastos  -  Ver ultimos gastos\n' +
                    '  resumen  -  Resumen financiero\n' +
                    '  config  -  Ver configuracion\n' +
                    '  salario 5M  -  Configurar salario\n\n' +
                    divider + '\n_Escribe /stop para desactivar_'
                });
              }
              continue;
            }
          }

          // Delegar: Gastos si está activo, Groq por defecto
          if (activeBot === 'gastos') {
            await handleGastosMessage(msg, sock);
          } else {
            await handleGroqMessage(msg, sock, groqService);
          }
          continue;
        }

        // ============================================
        // FILTRO: LISTA NEGRA Y NÚMEROS +58
        // ============================================

        const phoneNumber = jid.split('@')[0];
        const isVenezuelan = phoneNumber.startsWith('58');
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

        // Comando /miperfil - cambiar personalidad (disponible para todos)
        const miperfilMatch = text.match(/^\/miperfil\s+(.+)$/is);
        if (miperfilMatch) {
          await updatePersonality(sock, jid, miperfilMatch[1].trim(), groqService);
          continue;
        }

        // Verificar estado de onboarding
        const onboardingState = await getOnboardingState(jid);

        if (onboardingState === 'new') {
          await startOnboarding(sock, jid, pushName);
          continue;
        }

        if (onboardingState === 'in_progress') {
          await handleOnboardingStep(sock, jid, text, groqService);
          continue;
        }

        // Onboarding completado: cargar personalidad si no está en memoria y delegar a Groq
        await loadPersonalityIfNeeded(jid, groqService);
        await handleGroqMessage(msg, sock, groqService);

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
