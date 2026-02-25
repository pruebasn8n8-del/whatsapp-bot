// src/messageUtils.js
// Utilidades para parsear mensajes de Baileys + menus interactivos

const PREFIX = '\u200B'; // Zero-width space prefix for bot messages

/**
 * Extrae el texto del cuerpo de un mensaje Baileys.
 */
function getMessageText(msg) {
  const m = msg.message;
  if (!m) return '';
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || m.documentWithCaptionMessage?.message?.documentMessage?.caption
    || '';
}

/**
 * Extrae la respuesta interactiva de un mensaje (botones, listas).
 * @returns {{ id: string, text: string } | null}
 */
function getInteractiveResponse(msg) {
  const m = msg.message;
  if (!m) return null;

  // NativeFlow response (modern interactive)
  if (m.interactiveResponseMessage?.nativeFlowResponseMessage) {
    const flow = m.interactiveResponseMessage.nativeFlowResponseMessage;
    try {
      const params = JSON.parse(flow.paramsJson || '{}');
      return { id: params.id || flow.name || '', text: params.text || params.displayText || '' };
    } catch {
      return { id: flow.name || '', text: '' };
    }
  }

  // Legacy buttons response
  if (m.buttonsResponseMessage) {
    return {
      id: m.buttonsResponseMessage.selectedButtonId || '',
      text: m.buttonsResponseMessage.selectedDisplayText || '',
    };
  }

  // Legacy list response
  if (m.listResponseMessage) {
    return {
      id: m.listResponseMessage.singleSelectReply?.selectedRowId || '',
      text: m.listResponseMessage.title || '',
    };
  }

  return null;
}

/**
 * Envia un menu con botones (formato texto profesional).
 * @param {object} sock - Socket de Baileys
 * @param {string} jid - Chat ID
 * @param {string} title - Titulo del menu
 * @param {string} footer - Texto del footer
 * @param {Array<{id: string, text: string, desc?: string}>} buttons - Lista de opciones
 */
async function sendButtonMessage(sock, jid, title, footer, buttons) {
  const lines = buttons.map((btn, i) => {
    const num = `${i + 1}`;
    const desc = btn.desc ? `\n      _${btn.desc}_` : '';
    return `  *[ ${num} ]* ${btn.text}${desc}`;
  });

  const divider = '─'.repeat(25);
  const text = `${title}\n${divider}\n\n${lines.join('\n\n')}\n\n${divider}\n_${footer}_`;
  await sock.sendMessage(jid, { text: PREFIX + text });
}

/**
 * Envia un menu con lista de opciones (formato texto profesional).
 * @param {object} sock - Socket de Baileys
 * @param {string} jid - Chat ID
 * @param {string} title - Titulo
 * @param {string} footer - Footer
 * @param {string} _buttonText - (ignorado, compatibilidad)
 * @param {Array<{title: string, rows: Array<{id: string, title: string, description?: string}>}>} sections
 */
async function sendListMessage(sock, jid, title, footer, _buttonText, sections) {
  const divider = '─'.repeat(25);
  let text = title + '\n' + divider;

  for (const sec of sections) {
    if (sec.title) text += '\n\n*' + sec.title + '*\n';
    sec.rows.forEach((row, i) => {
      const desc = row.description ? `\n      _${row.description}_` : '';
      text += `  *[ ${i + 1} ]* ${row.title}${desc}\n`;
    });
  }

  text += '\n' + divider + '\n_' + footer + '_';
  await sock.sendMessage(jid, { text: PREFIX + text });
}

module.exports = { getMessageText, getInteractiveResponse, sendButtonMessage, sendListMessage, PREFIX };
