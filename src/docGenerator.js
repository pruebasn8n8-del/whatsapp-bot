// src/docGenerator.js
'use strict';

const PDFDocument = require('pdfkit');
const PptxGenJS   = require('pptxgenjs');

// ── Temas adaptativos ────────────────────────────────────────────────────────
const THEMES = {
  tech:      { primary: '#0ea5e9', accent: '#06b6d4', dark: '#0c1929', bg: '#f0f9ff' },
  nature:    { primary: '#10b981', accent: '#059669', dark: '#022c22', bg: '#f0fdf4' },
  finance:   { primary: '#1e40af', accent: '#f59e0b', dark: '#0f172a', bg: '#f8fafc' },
  health:    { primary: '#0d9488', accent: '#14b8a6', dark: '#042f2e', bg: '#f0fdfa' },
  education: { primary: '#7c3aed', accent: '#8b5cf6', dark: '#1e1b4b', bg: '#faf5ff' },
  creative:  { primary: '#db2777', accent: '#ec4899', dark: '#500724', bg: '#fdf2f8' },
  gaming:    { primary: '#7c3aed', accent: '#f97316', dark: '#1a0533', bg: '#faf5ff' },
  sports:    { primary: '#ea580c', accent: '#f97316', dark: '#431407', bg: '#fff7ed' },
  default:   { primary: '#4f46e5', accent: '#818cf8', dark: '#1e1b4b', bg: '#f5f3ff' },
};

const THEME_KEYWORDS = {
  tech:      /\b(tecnolog|software|program|código|ia |inteligencia artificial|web|app|digital|sistem|comput|datos|red|ciberseg|robót|automat|cloud|nube|desarrollo|devops|api|servidor|hardware|instala|windows|linux|ubuntu|python|javascript|html|css|usb|drivers?|configurar)\b/i,
  nature:    /\b(naturalez|medioambiente|ecolog|climat|sostenib|verde|bosque|animal|biodiversidad|agua|océano|planta|ecosistem|renovable|reciclaje|fauna|flora|orgánico)\b/i,
  finance:   /\b(finanz|dinero|inversión|presupuesto|economía|banco|mercado|bolsa|accion|capital|crédit|deuda|ahorro|impuest|forex|trading|criptomoneda|contabilidad)\b/i,
  health:    /\b(salud|medicina|médic|hospital|bienestar|nutrición|ejercicio|dieta|enfermedad|tratamiento|clínica|farmac|mental|terapia|fitness|cirugía)\b/i,
  education: /\b(educación|aprendizaje|escuela|universidad|curso|estudio|enseñanza|académic|ciencia|investigación|alumno|profesor|capacitación|seminario|pedagogía)\b/i,
  creative:  /\b(arte|diseño|música|fotografía|cine|moda|creativ|cultura|literatur|poesía|pintura|escultura|danza|teatro|publicidad|branding|ilustración|animación|marketing)\b/i,
  gaming:    /\b(gaming|gamer|videojuego|esport|rocket.?league|fortnite|minecraft|valorant|league.?of.?legends|call.?of.?duty|overwatch|steam|playstation|xbox|nintendo|twitch|streamer|fps|mmorpg|battle.?royale)\b/i,
  sports:    /\b(deporte|fútbol|baloncesto|tenis|atletism|campeón|liga|torneo|olímpic|rugby|natación|ciclismo|maratón|boxeo|gym|fuerza)\b/i,
};

function getTheme(title) {
  const text = (title || '').toLowerCase();
  for (const [key, regex] of Object.entries(THEME_KEYWORDS)) {
    if (regex.test(text)) return THEMES[key];
  }
  return THEMES.default;
}

// ── Image fetching ───────────────────────────────────────────────────────────
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function _downloadImage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000),
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 8192 ? buf : null;
}

// Dominios bloqueados: streams, redes sociales, noticias, academia, propaganda
const BLOCKED_DOMAINS = [
  // Streams y redes sociales
  'twitch.tv','twitter.com','x.com','instagram.com','tiktok.com',
  'youtube.com','youtu.be','reddit.com','facebook.com','pinterest.com',
  'tumblr.com','discord.com','patreon.com','streamable.com',
  // Canales deportivos / propaganda
  'clarosports.com','espn.com','espndeportes.com','fox.com','foxsports.com',
  'nbcsports.com','goal.com','marca.com','sport.es','as.com',
  'mundodeportivo.com','tycsports.com','directv.com','canalrcn.com',
  // Noticias (thumbnails irrelevantes)
  'cnn.com','bbc.com','reuters.com','apnews.com','nytimes.com',
  'theguardian.com','elmundo.es','elpais.com','infobae.com','eltiempo.com',
  // Academicos / documentos (capturas de tesis, papers, Word)
  'academia.edu','researchgate.net','scribd.com','slideshare.net',
  'issuu.com','docplayer.net','docsity.com','studocu.com',
];
function _isBlockedUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return BLOCKED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

// Patrones en la URL/título que indican captura de documento o propaganda
function _looksLikeDocument(candidate) {
  const text = ((candidate.image || '') + ' ' + (candidate.title || '')).toLowerCase();
  return /\.(pdf|docx?|pptx?|xlsx?)|scribd|slideshare|word\s?doc|thesis|dissertation|tesis|trabajo\s?de\s?grado|academia\.edu/i.test(text);
}

/**
 * Cuántas palabras del keyword aparecen en el título/URL del candidato.
 */
function _scoreCandidate(candidate, keyword) {
  const kws = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (kws.length === 0) return 1;
  const text = [candidate.title, candidate.url, candidate.source].filter(Boolean).join(' ').toLowerCase();
  return kws.filter(w => text.includes(w)).length;
}

/**
 * Trae hasta `count` candidatos de DDG con metadata completa.
 */
async function _getDDGCandidates(keyword, count, offset = 0) {
  const q = keyword;
  const pageRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&ia=images`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(8000),
  });
  const html = await pageRes.text();
  const vqd  = (html.match(/vqd=['"]([^'"]+)['"]/) || [])[1];
  if (!vqd) return [];

  const apiUrl = 'https://duckduckgo.com/i.js?' + new URLSearchParams({
    q, o: 'json', p: '1', s: String(offset), u: 'bing', f: ',,,type:photo', l: 'en-us', vqd,
  });
  const apiRes = await fetch(apiUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://duckduckgo.com/', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  const json = await apiRes.json();
  return (json.results || [])
    .filter(r =>
      r.image?.startsWith('https') &&
      (r.width || 0) >= 600 &&
      !_isBlockedUrl(r.image) &&
      !_isBlockedUrl(r.url) &&
      !_looksLikeDocument(r)
    )
    .slice(0, count);
}

/**
 * Combina el keyword del título + palabras visuales del heading de sección.
 */
function sectionKeyword(mainTitle, sectionHeading) {
  const stop = new Set(['de','del','la','el','los','las','un','una','para','con','en','por','que','y','a','o','e','como','desde','hasta','sobre','sus','este','esta','entre','muy','mas','más','sus','esta','estos','estas']);
  const clean = t => (t || '').toLowerCase()
    .replace(/[^\w\sáéíóúñü]/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stop.has(w) && !META_WORDS.has(w));

  const main = clean(mainTitle).slice(0, 2);
  const sec  = clean(sectionHeading).slice(0, 2);

  if (sec.length === 0) return main.join(' ') || titleToKeyword(mainTitle);
  return [...main, ...sec].join(' ');
}

/**
 * Busca imágenes para todo el documento con keywords específicos por sección.
 */
async function fetchDocImages(coverKeyword, sectionKeywords) {
  const allKeywords = coverKeyword ? [coverKeyword, ...sectionKeywords] : [...sectionKeywords];

  const uKey = process.env.UNSPLASH_ACCESS_KEY;
  if (uKey) {
    try {
      const results = await Promise.allSettled(
        allKeywords.map(kw => fetch(
          `https://api.unsplash.com/photos/random?query=${encodeURIComponent(kw)}&orientation=landscape&count=1`,
          { headers: { 'Authorization': `Client-ID ${uKey}`, 'Accept-Version': 'v1' }, signal: AbortSignal.timeout(7000) }
        ).then(r => r.ok ? r.json() : null))
      );
      const bufs = await Promise.allSettled(
        results.map(async r => {
          const photos = r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [];
          const url = photos[0]?.urls?.regular;
          return url ? _downloadImage(url) : null;
        })
      );
      const imgs = bufs.map(r => r.status === 'fulfilled' ? r.value : null);
      if (imgs.filter(Boolean).length >= 1) {
        return coverKeyword
          ? { coverBuf: imgs[0] || null, sectionBufs: imgs.slice(1) }
          : { coverBuf: null, sectionBufs: imgs };
      }
    } catch {}
  }

  const candidateLists = await Promise.allSettled(
    allKeywords.map(kw => _getDDGCandidates(kw, 18))
  );

  const usedUrls = new Set();
  const selectedUrls = [];
  for (let ki = 0; ki < allKeywords.length; ki++) {
    const keyword    = allKeywords[ki];
    const candidates = candidateLists[ki]?.status === 'fulfilled' ? (candidateLists[ki].value || []) : [];

    const scored = candidates
      .filter(c => !_looksLikeDocument(c))
      .map(c => ({ ...c, score: _scoreCandidate(c, keyword) }))
      .sort((a, b) => b.score - a.score);

    const pick = scored.find(c => c.score > 0 && !usedUrls.has(c.image));
    if (pick) { usedUrls.add(pick.image); selectedUrls.push(pick.image); continue; }

    try {
      const more = await _getDDGCandidates(keyword, 18, 20);
      const morePick = more
        .filter(c => !_looksLikeDocument(c))
        .map(c => ({ ...c, score: _scoreCandidate(c, keyword) }))
        .sort((a, b) => b.score - a.score)
        .find(c => !usedUrls.has(c.image));
      if (morePick) { usedUrls.add(morePick.image); selectedUrls.push(morePick.image); continue; }
    } catch {}

    const fallback = scored.find(c => !usedUrls.has(c.image));
    if (fallback) { usedUrls.add(fallback.image); selectedUrls.push(fallback.image); continue; }

    selectedUrls.push(null);
  }

  const bufs = await Promise.allSettled(
    selectedUrls.map(url => url ? _downloadImage(url) : Promise.resolve(null))
  );
  const imgs = bufs.map(r => r.status === 'fulfilled' ? r.value : null);

  return coverKeyword
    ? { coverBuf: imgs[0] || null, sectionBufs: imgs.slice(1) }
    : { coverBuf: null, sectionBufs: imgs };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const META_WORDS = new Set([
  'guia','guía','manual','tutorial','curso','completo','completa','introduccion',
  'introducción','overview','resumen','summary','aprende','aprender','todo','sobre',
  'caracteristicas','características','actualizaciones','actualizacion','historia',
  'historico','histórico','general','generalidades','descripcion','descripción',
  'informacion','información','aspectos','ventajas','desventajas','beneficios',
  'tipos','comparacion','comparación','impacto','analisis','análisis','conclusion',
  'conclusión','futuro','perspectivas','contexto','importancia','fundamentos',
  'bases','principios','conceptos','teoria','teoría','practica','práctica',
  'updates','features','overview','introduction','history','basics','guide',
  'sistema','sistemas','configuracion','configuración','instalacion','instalación',
  'proceso','procesos','metodos','métodos','tecnicas','técnicas',
]);

function titleToKeyword(title) {
  const stop = new Set(['de','del','la','el','los','las','un','una','para','con','en','por','que','y','a','o','e','como','desde','hasta','sobre']);
  const words = (title || '')
    .toLowerCase()
    .replace(/[^\w\sáéíóúñü]/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stop.has(w) && !META_WORDS.has(w));
  return words.slice(0, 3).join(' ') || 'abstract minimal';
}

function fmtDate() {
  return new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

function hex(c) { return (c || '').replace('#', ''); }

// ── Emoji stripper para PDF (Helvetica no soporta emojis) ────────────────────
// PPTX no usa esto — PowerPoint renderiza emojis con fuentes del sistema
function _stripEmoji(str) {
  return (str || '')
    .replace(/\p{Emoji_Presentation}/gu, '')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/\u200D/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Limpia artefactos de markdown que se hayan colado en texto que ya va a renderizarse
 * como texto plano (headings, bullets, celdas de tabla, etc).
 * Quita ##, **, *, `  cuando no fueron procesados por el parser de líneas.
 */
function _cleanForRender(text) {
  return (text || '')
    .replace(/^#{1,6}\s*/gm, '')          // ## al inicio de línea
    .replace(/\*\*([^*]*)\*\*/g, '$1')    // **negrita**
    .replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '$1') // *itálica* sin tocar **
    .replace(/`([^`]*)`/g, '$1')          // `inline code`
    .replace(/^\s*>\s*/gm, '')            // > blockquote
    .trim();
}

// ── Bold segment splitter ────────────────────────────────────────────────────
/**
 * Divide un string en segmentos {text, bold} según **texto**.
 * Ej: "hola **mundo** aquí" → [{text:"hola ",bold:false},{text:"mundo",bold:true},{text:" aquí",bold:false}]
 */
function splitBoldSegments(line) {
  const segments = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index), bold: false });
    segments.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last), bold: false });
  return segments.length > 0 ? segments : [{ text: line, bold: false }];
}

/**
 * Divide un string en segmentos {text, code, bold} según `code` y **bold**.
 * Prioridad: code > bold.
 */
function splitInlineSegments(line) {
  const segments = [];
  // Tokeniza por `code` y **bold**
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0, m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index), bold: false, code: false });
    const tok = m[0];
    if (tok.startsWith('`')) {
      segments.push({ text: tok.slice(1, -1), bold: false, code: true });
    } else {
      segments.push({ text: tok.slice(2, -2), bold: true, code: false });
    }
    last = m.index + tok.length;
  }
  if (last < line.length) segments.push({ text: line.slice(last), bold: false, code: false });
  return segments.length > 0 ? segments : [{ text: line, bold: false, code: false }];
}

// ── PDF Code Block Renderer ──────────────────────────────────────────────────
function _pdfCodeBlock(doc, codeText, x, w, y, maxY, theme) {
  if (!codeText || y + 20 > maxY) return y;
  const PAD = 10, BORDER = 3;
  const lines = codeText.split('\n');
  const lineH = 13;
  const totalH = PAD * 2 + lines.length * lineH + 4;

  if (y + totalH > maxY) return y;

  // Fondo gris claro
  doc.save().fillOpacity(1).rect(x, y, w, totalH).fill('#F1F5F9').restore();
  // Borde izquierdo accent
  doc.fillOpacity(1).rect(x, y, BORDER, totalH).fill(theme.accent);
  // Borde exterior sutil
  doc.save().strokeColor('#CBD5E1').strokeOpacity(0.6).lineWidth(0.5)
     .rect(x, y, w, totalH).stroke().restore();

  // Texto en Courier
  lines.forEach((codeLine, li) => {
    const ly = y + PAD + li * lineH;
    if (ly >= maxY - lineH) return;
    doc.fillColor('#1E293B').fillOpacity(1).font('Courier').fontSize(8.5)
       .text(codeLine || ' ', x + BORDER + PAD, ly, { width: w - BORDER - PAD * 2, lineBreak: false });
  });

  return y + totalH + 8;
}

// ── PDF rich content renderer (reemplaza _pdfText) ──────────────────────────
/**
 * Renderiza sección completa: content con jerarquía tipográfica + tabla + flowchart + curiosity.
 * Retorna la Y final.
 */
function _pdfRichContent(doc, section, x, w, startY, maxY, theme) {
  let curY = startY;
  // Aplicar strip de emojis al contenido completo antes de procesar
  const content = _stripEmoji(section.content || '').trim();

  // Pre-procesar: separar bloques de código ``` ``` del texto normal
  // Resultado: array de { type: 'text'|'code', value: string }
  const segments = [];
  const codeBlockRe = /```(?:\w+)?\n?([\s\S]*?)```/g;
  let lastIdx = 0, cm;
  while ((cm = codeBlockRe.exec(content)) !== null) {
    if (cm.index > lastIdx) segments.push({ type: 'text', value: content.slice(lastIdx, cm.index) });
    segments.push({ type: 'code', value: cm[1].trimEnd() });
    lastIdx = cm.index + cm[0].length;
  }
  if (lastIdx < content.length) segments.push({ type: 'text', value: content.slice(lastIdx) });

  for (const seg of segments) {
    if (curY >= maxY - 20) break;

    if (seg.type === 'code') {
      curY = Math.min(curY + 6, maxY);
      curY = _pdfCodeBlock(doc, seg.value, x, w, curY, maxY, theme);
      continue;
    }

    // Procesar texto línea por línea
    const lines = seg.value.split('\n');
    let pi = 0;
    while (pi < lines.length) {
      if (curY >= maxY - 20) break;
      const raw = lines[pi];
      const line = raw.trimEnd();
      pi++;

      if (!line.trim()) {
        curY = Math.min(curY + 6, maxY);
        continue;
      }

      // Separador horizontal ---
      if (/^-{3,}$/.test(line.trim())) {
        if (curY + 8 > maxY) break;
        doc.save().strokeColor(theme.primary).strokeOpacity(0.25).lineWidth(0.7)
           .moveTo(x, curY + 4).lineTo(x + w, curY + 4).stroke().restore();
        curY += 10;
        continue;
      }

      // ## Subtítulo H2 (lenient: permite sin espacio y espacios previos)
      const h2 = line.match(/^\s*#{2,3}\s*(.+)/);
      if (h2 && !line.match(/^\s*#{4,}/)) {
        const isH3 = line.trim().startsWith('###');
        if (isH3) {
          if (curY + 22 > maxY) break;
          curY = Math.min(curY + 4, maxY);
          doc.fillColor(theme.primary).fillOpacity(1).font('Helvetica-Bold').fontSize(11.5)
             .text(_cleanForRender(_stripEmoji(h2[1])), x, curY, { width: w, lineGap: 2 });
          curY = doc.y + 6;
        } else {
          if (curY + 30 > maxY) break;
          curY = Math.min(curY + 6, maxY);
          doc.fillColor(theme.dark).fillOpacity(1).font('Helvetica-Bold').fontSize(13)
             .text(_cleanForRender(_stripEmoji(h2[1])), x, curY, { width: w, lineGap: 2 });
          curY = doc.y + 2;
          if (curY + 3 <= maxY) {
            doc.fillOpacity(1).rect(x, curY, 32, 2).fill(theme.accent);
            curY += 7;
          }
        }
        continue;
      }

      // > Blockquote
      const bq = line.match(/^>\s*(.+)/);
      if (bq) {
        if (curY + 22 > maxY) break;
        doc.save().fillOpacity(0.08).rect(x, curY - 2, w, 20).fill(theme.primary).restore();
        doc.fillOpacity(1).rect(x, curY - 2, 3, 20).fill(theme.primary);
        doc.fillColor(theme.dark).fillOpacity(0.80).font('Helvetica').fontSize(10)
           .text(_cleanForRender(_stripEmoji(bq[1])), x + 10, curY, { width: w - 12, lineGap: 2 });
        curY = Math.min(doc.y + 8, maxY);
        continue;
      }

      // 1. Lista numerada
      const num = line.match(/^(\d+)\.\s+(.+)/);
      if (num) {
        if (curY + 20 > maxY) break;
        const numStr = num[1] + '.';
        const numW = 20;
        doc.fillColor(theme.accent).fillOpacity(1).font('Helvetica-Bold').fontSize(10.5)
           .text(numStr, x, curY, { width: numW, lineBreak: false });
        doc.fillColor('#374151').fillOpacity(1).font('Helvetica').fontSize(10.5)
           .text(_cleanForRender(_stripEmoji(num[2])), x + numW + 2, curY, { width: w - numW - 2, lineGap: 3 });
        curY = Math.min(doc.y + 4, maxY);
        continue;
      }

      // Sub-bullet anidado (2+ espacios + -)
      const subBullet = line.match(/^ {2,}[-•*]\s+(.+)/);
      if (subBullet) {
        if (curY + 18 > maxY) break;
        const ix = x + 18;
        doc.fillColor('#9CA3AF').fillOpacity(1).circle(ix - 6, curY + 5, 2).fill();
        doc.fillColor('#6B7280').fillOpacity(1).font('Helvetica').fontSize(9.5)
           .text(_cleanForRender(_stripEmoji(subBullet[1])), ix, curY, { width: w - 20, lineGap: 2 });
        curY = Math.min(doc.y + 3, maxY);
        continue;
      }

      // Bullet principal
      const bullet = line.match(/^[-•*]\s+(.+)/);
      if (bullet) {
        if (curY + 20 > maxY) break;
        doc.fillColor(theme.accent).fillOpacity(1).circle(x - 5, curY + 5.5, 2.5).fill();
        doc.fillColor('#374151').fillOpacity(1).font('Helvetica').fontSize(10)
           .text(_cleanForRender(_stripEmoji(bullet[1])), x, curY, { width: w, lineGap: 3 });
        curY = Math.min(doc.y + 4, maxY);
        continue;
      }

      // Línea completamente en negrita **texto**
      if (/^\*\*[^*].*\*\*\s*$/.test(line.trim())) {
        if (curY + 18 > maxY) break;
        const clean = _stripEmoji(line.trim().replace(/^\*\*|\*\*\s*$/g, ''));
        doc.fillColor('#1F2937').fillOpacity(1).font('Helvetica-Bold').fontSize(10.5)
           .text(clean, x, curY, { width: w, lineGap: 3 });
        curY = Math.min(doc.y + 6, maxY);
        continue;
      }

      // Párrafo normal (puede tener inline code y negrita)
      if (curY + 14 > maxY) break;
      const segs2 = splitInlineSegments(line);
      const hasInline = segs2.some(s => s.bold || s.code);
      if (hasInline) {
        segs2.forEach((s2, i) => {
          const isLast = i === segs2.length - 1;
          if (!s2.text) return;
          const cleanText = _stripEmoji(s2.text);
          if (s2.code) {
            doc.fillColor('#1E293B').fillOpacity(1).font('Courier').fontSize(9)
               .text(cleanText, i === 0 ? x : undefined, i === 0 ? curY : undefined, {
                 continued: !isLast, width: w, lineGap: 4,
               });
          } else {
            doc.fillColor('#374151').fillOpacity(1)
               .font(s2.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5)
               .text(cleanText, i === 0 ? x : undefined, i === 0 ? curY : undefined, {
                 continued: !isLast, width: w, lineGap: 4, align: 'justify',
               });
          }
        });
        curY = Math.min(doc.y + 8, maxY);
      } else {
        // Párrafo sin markdown reconocido: limpiar cualquier artefacto residual
        const cleanLine = _cleanForRender(_stripEmoji(line));
        if (!cleanLine) { curY = Math.min(curY + 4, maxY); continue; }
        doc.fillColor('#374151').fillOpacity(1).font('Helvetica').fontSize(10.5)
           .text(cleanLine, x, curY, { width: w, align: 'justify', lineGap: 4 });
        curY = Math.min(doc.y + 8, maxY);
      }
    }
  }

  // Tabla
  if (section.table?.headers?.length > 0 && curY + 40 < maxY) {
    curY = _pdfTable(doc, section.table, x, w, curY + 12, maxY, theme);
  }
  // Flowchart
  if (section.flowchart?.steps?.length > 0 && curY + 60 < maxY) {
    curY = _pdfFlowchart(doc, section.flowchart, x, w, curY + 12, maxY, theme);
  }
  // Curiosity box
  if (section.curiosity && curY + 40 < maxY) {
    curY = _pdfCuriosityBox(doc, section.curiosity, x, w, curY + 12, theme);
  }

  return curY;
}

// ── PDF Table Renderer ───────────────────────────────────────────────────────
function _pdfTable(doc, table, x, w, y, maxY, theme) {
  const { headers = [], rows = [] } = table;
  if (!headers.length) return y;

  const colW  = w / headers.length;
  const ROW_H = 22;
  const HDR_H = 26;
  const totalH = HDR_H + rows.length * ROW_H + 4;

  if (y + totalH > maxY) return y;

  // Header row
  doc.fillOpacity(1).rect(x, y, w, HDR_H).fill(theme.primary);
  headers.forEach((h, ci) => {
    doc.fillColor('#ffffff').fillOpacity(1).font('Helvetica-Bold').fontSize(9)
       .text(_stripEmoji(String(h)), x + ci * colW + 6, y + 7, { width: colW - 12, align: 'left', lineBreak: false });
  });

  // Data rows
  rows.forEach((row, ri) => {
    const ry = y + HDR_H + ri * ROW_H;
    const bg = ri % 2 === 0 ? '#ffffff' : (theme.bg || '#F9FAFB');
    doc.fillOpacity(1).rect(x, ry, w, ROW_H).fill(bg);

    // Separator line
    doc.save()
       .strokeColor(theme.primary).strokeOpacity(0.18).lineWidth(0.5)
       .moveTo(x, ry + ROW_H).lineTo(x + w, ry + ROW_H).stroke()
       .restore();

    (row || []).forEach((cell, ci) => {
      doc.fillColor('#374151').fillOpacity(1).font('Helvetica').fontSize(9)
         .text(_stripEmoji(String(cell ?? '')), x + ci * colW + 6, ry + 6,
               { width: colW - 12, align: 'left', lineBreak: false });
    });
  });

  // Outer border
  doc.save()
     .strokeColor(theme.primary).strokeOpacity(0.30).lineWidth(0.8)
     .rect(x, y, w, HDR_H + rows.length * ROW_H).stroke()
     .restore();

  // Vertical column dividers
  for (let ci = 1; ci < headers.length; ci++) {
    doc.save()
       .strokeColor(theme.primary).strokeOpacity(0.15).lineWidth(0.5)
       .moveTo(x + ci * colW, y).lineTo(x + ci * colW, y + HDR_H + rows.length * ROW_H).stroke()
       .restore();
  }

  return y + HDR_H + rows.length * ROW_H + 14;
}

// ── PDF Flowchart Renderer ───────────────────────────────────────────────────
function _pdfFlowchart(doc, flowchart, x, w, y, maxY, theme) {
  const { steps = [], decision_idx = -1 } = flowchart;
  if (!steps.length) return y;

  const BOX_W  = Math.min(200, w - 20);
  const BOX_H  = 34;
  const ARROW_H = 18;
  const totalH = steps.length * (BOX_H + ARROW_H) + 16;

  if (y + totalH > maxY) return y;

  const centerX = x + w / 2;
  let curY = y + 8;

  steps.forEach((step, i) => {
    const boxX      = centerX - BOX_W / 2;
    const boxY      = curY;
    const isDecision = i === decision_idx;
    const isEndpoint = i === 0 || i === steps.length - 1;

    if (isDecision) {
      // Diamante
      const cx = centerX, cy = boxY + BOX_H / 2;
      const dx = BOX_W / 2 + 4, dy = BOX_H / 2 + 4;
      doc.save()
         .fillOpacity(1)
         .polygon([cx, cy - dy], [cx + dx, cy], [cx, cy + dy], [cx - dx, cy])
         .fill(theme.accent);
      doc.polygon([cx, cy - dy], [cx + dx, cy], [cx, cy + dy], [cx - dx, cy])
         .stroke(theme.primary);
      doc.restore();
      doc.fillColor('#ffffff').fillOpacity(1).font('Helvetica-Bold').fontSize(8)
         .text(_stripEmoji(String(step)), cx - dx + 8, cy - 8,
               { width: dx * 2 - 16, align: 'center', lineBreak: false });
    } else {
      // Caja redondeada
      const fillC = isEndpoint ? theme.primary : '#ffffff';
      const textC = isEndpoint ? '#ffffff' : theme.dark;
      doc.save()
         .fillOpacity(1)
         .roundedRect(boxX, boxY, BOX_W, BOX_H, 5)
         .fill(fillC);
      doc.roundedRect(boxX, boxY, BOX_W, BOX_H, 5)
         .stroke(theme.primary);
      doc.restore();
      doc.fillColor(textC).fillOpacity(1).font('Helvetica').fontSize(9)
         .text(_stripEmoji(String(step)), boxX + 8, boxY + BOX_H / 2 - 7,
               { width: BOX_W - 16, align: 'center', lineBreak: false });
    }

    // Flecha hacia el siguiente paso
    if (i < steps.length - 1) {
      const arrowTopY = boxY + BOX_H;
      const arrowBotY = arrowTopY + ARROW_H;
      doc.save()
         .strokeColor(theme.primary).strokeOpacity(0.80).lineWidth(1.2)
         .moveTo(centerX, arrowTopY).lineTo(centerX, arrowBotY - 6).stroke()
         .restore();
      // Triángulo arrowhead (sentido horario = downward)
      doc.save()
         .fillOpacity(0.80).fillColor(theme.primary)
         .polygon(
           [centerX, arrowBotY],
           [centerX - 5, arrowBotY - 7],
           [centerX + 5, arrowBotY - 7]
         )
         .fill();
      doc.restore();
    }

    curY = boxY + BOX_H + ARROW_H;
  });

  return curY + 10;
}

// ── PDF Curiosity Box ────────────────────────────────────────────────────────
function _pdfCuriosityBox(doc, text, x, w, y, theme) {
  if (!text) return y;
  const cleanText = _stripEmoji(text);
  const BORDER = 4, PAD = 12, LABEL_H = 18, ICON_SIZE = 14;
  const estLines = Math.ceil(cleanText.length / ((w - PAD * 2 - BORDER) / 5.5));
  const contentH = LABEL_H + 8 + estLines * 14 + PAD;
  const totalH   = contentH + PAD;

  // Fondo semitransparente
  doc.save().fillOpacity(0.06).rect(x + BORDER, y, w - BORDER, totalH).fill(theme.accent).restore();
  // Barra izquierda
  doc.fillOpacity(1).rect(x, y, BORDER, totalH).fill(theme.accent);

  // Ícono dibujado: círculo accent con "!" (reemplaza emoji 💡)
  const iconX = x + BORDER + PAD;
  const iconY = y + PAD + 1;
  doc.fillOpacity(1).circle(iconX + ICON_SIZE / 2, iconY + ICON_SIZE / 2, ICON_SIZE / 2).fill(theme.accent);
  doc.fillColor('#ffffff').fillOpacity(1).font('Helvetica-Bold').fontSize(9)
     .text('!', iconX, iconY + 2, { width: ICON_SIZE, align: 'center', lineBreak: false });

  // Label "Dato curioso"
  doc.fillColor(theme.accent).fillOpacity(1).font('Helvetica-Bold').fontSize(9.5)
     .text('Dato curioso', x + BORDER + PAD + ICON_SIZE + 6, y + PAD + 1,
           { width: w - BORDER - PAD * 2 - ICON_SIZE - 6, lineBreak: false });

  // Texto
  doc.fillColor('#374151').fillOpacity(1).font('Helvetica').fontSize(9.5)
     .text(cleanText, x + BORDER + PAD, y + PAD + LABEL_H + 2,
           { width: w - BORDER - PAD * 2, lineGap: 3 });

  return y + totalH + 8;
}

// ── PDF References Page ──────────────────────────────────────────────────────
function _pdfReferencesPage(doc, references, title, theme) {
  doc.addPage({ margin: 0 });
  const W = doc.page.width, H = doc.page.height;
  const ML = 60, MR = 60, CW = W - ML - MR, FOOTER_H = 32;

  doc.fillOpacity(1).rect(0, 0, W, H).fill('#ffffff');
  doc.rect(0, 0, W, 2).fill(theme.primary);
  doc.rect(0, 0, 5, H).fill(theme.accent);

  // Header
  doc.fillColor(theme.dark).fillOpacity(1).font('Helvetica-Bold').fontSize(18)
     .text('Referencias', ML, 28, { width: CW });
  const underY = doc.y + 4;
  doc.fillOpacity(1).rect(ML, underY, 48, 2).fill(theme.accent);

  let curY = underY + 18;
  const MAXREF_Y = H - FOOTER_H - 16;

  references.forEach((ref, i) => {
    if (curY >= MAXREF_Y) return;
    const apa = `${ref.author || 'Autor desconocido'} (${ref.year || 's.f.'}). ${ref.title || ''}. ${ref.publisher || ''}`;

    // Badge número
    doc.save().fillOpacity(1).rect(ML, curY, 18, 18).fill(theme.bg || '#F9FAFB').restore();
    doc.fillColor(theme.primary).fillOpacity(1).font('Helvetica-Bold').fontSize(8)
       .text(String(i + 1), ML + 1, curY + 4, { width: 16, align: 'center', lineBreak: false });

    // Texto APA
    doc.fillColor('#374151').fillOpacity(1).font('Helvetica').fontSize(9)
       .text(apa, ML + 24, curY, { width: CW - 24, lineGap: 2 });
    curY = doc.y + 2;

    // URL en color accent
    if (ref.url) {
      doc.fillColor(theme.accent).fillOpacity(1).font('Helvetica').fontSize(8.5)
         .text(ref.url, ML + 24, curY, { width: CW - 24, lineGap: 2 });
      curY = doc.y + 10;
    } else {
      curY += 8;
    }
  });

  _pdfFooter(doc, title, '—', theme);
}

// ── PDF shared footer ─────────────────────────────────────────────────────────
function _pdfFooter(doc, title, pageNum, theme) {
  const W = doc.page.width, H = doc.page.height;
  const ML = 60, MR = 60, FOOTER_H = 32;
  doc.fillOpacity(1).rect(0, H - FOOTER_H, W, 0.8).fill(theme.primary);
  doc.save().fillOpacity(0.05).rect(0, H - FOOTER_H + 0.8, W, FOOTER_H - 0.8).fill(theme.primary).restore();
  doc.fillColor(theme.primary).fillOpacity(0.65).font('Helvetica').fontSize(7.5)
     .text(title.substring(0, 55), ML, H - FOOTER_H + 9);
  doc.fillColor(theme.accent).fillOpacity(1).font('Helvetica-Bold').fontSize(9)
     .text(String(pageNum), W - MR, H - FOOTER_H + 9, { width: MR - 5, align: 'right' });
}

// ── PDF: VISUAL style ─────────────────────────────────────────────────────────
function _pdfCoverVisual(doc, title, sections, theme, imgBuf) {
  const W = doc.page.width, H = doc.page.height;
  const ML = 60, CW = W - ML - 60;

  doc.rect(0, 0, W, H).fill(theme.dark);
  if (imgBuf) {
    try { doc.image(imgBuf, 0, 0, { width: W, height: H, cover: [W, H] }); } catch {}
    doc.save().fillOpacity(0.70).rect(0, 0, W, H).fill(theme.dark).restore();
  } else {
    doc.save().fillOpacity(0.50).rect(0, H * 0.58, W, H * 0.42).fill(theme.primary).restore();
  }
  doc.rect(0, 0, 5, H).fill(theme.accent);
  doc.save().fillOpacity(0.06).circle(W + 60, -60, 240).fill(theme.primary).restore();

  const TAG_Y = H * 0.27;
  doc.fillColor('#ffffff').fillOpacity(0.40).font('Helvetica').fontSize(9)
     .text('DOCUMENTO GENERADO POR CORTANA', ML + 4, TAG_Y, { width: CW, characterSpacing: 2 });
  doc.save().fillOpacity(1).rect(ML + 4, TAG_Y + 17, 36, 1.5).fill(theme.accent).restore();
  doc.fillColor('#ffffff').fillOpacity(1).font('Helvetica-Bold').fontSize(34)
     .text(title, ML + 4, TAG_Y + 30, { width: CW, lineGap: 6 });

  const afterY = doc.y + 20;
  doc.fillColor('#ffffff').fillOpacity(0.50).font('Helvetica').fontSize(10).text(fmtDate(), ML + 4, afterY);
  doc.fillColor('#ffffff').fillOpacity(0.35).font('Helvetica').fontSize(9).text('Cortana · @andrewhypervenom', ML + 4, doc.y + 4);

  if (sections.length > 0) {
    const TOC_Y = H * 0.70;
    doc.save().fillOpacity(0.15).rect(ML + 4, TOC_Y - 10, CW, 0.5).fill('#ffffff').restore();
    doc.fillColor('#ffffff').fillOpacity(0.30).font('Helvetica').fontSize(8)
       .text('CONTENIDO', ML + 4, TOC_Y, { characterSpacing: 2 });
    sections.slice(0, 8).forEach((sec, i) => {
      const sy = TOC_Y + 17 + i * 21;
      doc.fillColor(theme.accent).fillOpacity(0.9).font('Helvetica-Bold').fontSize(8)
         .text(String(i + 1).padStart(2, '0'), ML + 4, sy);
      doc.fillColor('#ffffff').fillOpacity(0.60).font('Helvetica').fontSize(9)
         .text(sec.heading || '', ML + 22, sy, { width: CW - 22, ellipsis: true });
    });
  }
}

function _pdfSectionVisual(doc, sec, idx, title, theme, imgBuf) {
  const W = doc.page.width, H = doc.page.height;
  const ML = 60, MR = 60;
  const FOOTER_H = 34;
  const IMG_H    = Math.round(H * 0.32);
  const CARD_Y   = IMG_H + 14;
  const CARD_H   = H - CARD_Y - FOOTER_H - 10;
  const pCW      = W - ML - MR;

  doc.fillOpacity(1).rect(0, 0, W, H).fill(theme.bg);

  if (imgBuf) {
    let imgOk = false;
    doc.save();
    doc.rect(0, 0, W, IMG_H).clip();
    try { doc.image(imgBuf, 0, 0, { cover: [W, IMG_H] }); imgOk = true; } catch {}
    doc.restore();
    if (!imgOk) {
      doc.fillOpacity(1).rect(0, 0, W, IMG_H).fill(theme.primary);
    }
  } else {
    doc.fillOpacity(1).rect(0, 0, W, IMG_H).fill(theme.primary);
    doc.save().fillOpacity(0.12);
    doc.circle(W * 0.82, IMG_H * 0.35, 80).fill(theme.accent);
    doc.circle(W * 0.92, IMG_H * 0.85, 48).fill('#ffffff');
    doc.restore();
  }

  doc.save().fillOpacity(0.22).rect(0, 0, W, IMG_H * 0.45).fill('#000000').restore();
  doc.save().fillOpacity(0.65).rect(0, IMG_H * 0.45, W, IMG_H * 0.55).fill('#000000').restore();

  doc.fillOpacity(1).rect(W - 54, 0, 54, 30).fill(theme.accent);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12)
     .text(String(idx + 1).padStart(2, '0'), W - 54, 9, { width: 54, align: 'center' });

  doc.fillOpacity(1).rect(ML, IMG_H - 50, 28, 2.5).fill(theme.accent);
  if (sec.heading) {
    doc.fillColor('#ffffff').fillOpacity(1).font('Helvetica-Bold').fontSize(19)
       .text(sec.heading, ML, IMG_H - 43, { width: pCW - 70, lineGap: 3 });
  }

  doc.save().fillOpacity(0.07).rect(ML + 4, CARD_Y + 4, pCW, CARD_H).fill('#000000').restore();
  doc.fillOpacity(1).rect(ML, CARD_Y, pCW, CARD_H).fill('#ffffff');
  doc.rect(ML, CARD_Y, 4, CARD_H).fill(theme.accent);

  _pdfRichContent(doc, sec, ML + 18, pCW - 28, CARD_Y + 18, CARD_Y + CARD_H - 14, theme);
  _pdfFooter(doc, title, idx + 2, theme);
}

// ── PDF: TECHNICAL style ──────────────────────────────────────────────────────
function _pdfCoverTechnical(doc, title, sections, theme) {
  const W = doc.page.width, H = doc.page.height;
  const SPLIT = Math.round(W * 0.57);
  const ML = 38;

  doc.rect(0, 0, SPLIT, H).fill('#ffffff');
  doc.rect(SPLIT, 0, W - SPLIT, H).fill(theme.primary);
  doc.rect(0, 0, SPLIT, 8).fill(theme.accent);

  doc.save().fillOpacity(0.14);
  for (let row = 0; row < 14; row++) {
    for (let col = 0; col < 5; col++) {
      doc.circle(SPLIT + 22 + col * 30, 28 + row * 58, 3).fill('#ffffff');
    }
  }
  doc.restore();

  doc.fillColor('#ffffff').fillOpacity(0.90).font('Helvetica-Bold').fontSize(80)
     .text(String(sections.length).padStart(2, '0'), SPLIT + 10, H * 0.27, { width: W - SPLIT - 14 });
  doc.fillColor('#ffffff').fillOpacity(0.40).font('Helvetica').fontSize(9)
     .text('SECCIONES', SPLIT + 14, H * 0.27 + 90, { characterSpacing: 3 });

  doc.fillColor(theme.dark).fillOpacity(1).font('Helvetica-Bold').fontSize(28)
     .text(title, ML, H * 0.29, { width: SPLIT - ML - 16, lineGap: 7 });
  doc.fillColor(theme.primary).fillOpacity(0.75).font('Helvetica').fontSize(10)
     .text(fmtDate(), ML, doc.y + 18);
  doc.fillColor('#6B7280').fillOpacity(1).font('Helvetica').fontSize(9)
     .text('Cortana · @andrewhypervenom', ML, doc.y + 4);

  if (sections.length > 0) {
    const TOC_Y = H * 0.63;
    doc.save().fillOpacity(1).rect(ML, TOC_Y - 10, 32, 1.5).fill(theme.accent).restore();
    doc.fillColor(theme.primary).fillOpacity(0.55).font('Helvetica').fontSize(7.5)
       .text('CONTENIDO', ML, TOC_Y, { characterSpacing: 2 });
    sections.slice(0, 7).forEach((sec, i) => {
      const sy = TOC_Y + 15 + i * 20;
      doc.fillColor(theme.accent).fillOpacity(1).font('Helvetica-Bold').fontSize(7.5)
         .text(String(i + 1).padStart(2, '0'), ML, sy);
      doc.fillColor(theme.dark).fillOpacity(0.65).font('Helvetica').fontSize(8.5)
         .text(sec.heading || '', ML + 18, sy, { width: SPLIT - ML - 26, ellipsis: true });
    });
  }
}

function _pdfSectionTechnical(doc, sec, idx, title, theme) {
  const W = doc.page.width, H = doc.page.height;
  const ML = 60, MR = 60, CW = W - ML - MR, FOOTER_H = 32;
  const CHIP_Y = 28; // margen superior del chip (antes era 14)
  const CHIP = 52;

  doc.fillOpacity(1).rect(0, 0, W, H).fill('#ffffff');
  doc.rect(0, 0, W, 4).fill(theme.primary);

  doc.save().fillOpacity(0.04).fillColor(theme.primary).font('Helvetica-Bold').fontSize(210)
     .text(String(idx + 1), W * 0.38, H * 0.12, { width: W * 0.58 });
  doc.restore();

  doc.fillOpacity(1).rect(ML, CHIP_Y, CHIP, CHIP).fill(theme.accent);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
     .text(String(idx + 1).padStart(2, '0'), ML, CHIP_Y + CHIP / 2 - 12, { width: CHIP, align: 'center' });

  if (sec.heading) {
    doc.fillColor(theme.dark).fillOpacity(1).font('Helvetica-Bold').fontSize(17)
       .text(_cleanForRender(sec.heading), ML + CHIP + 14, CHIP_Y + 8, { width: CW - CHIP - 16, lineGap: 3 });
  }

  const SEP_Y = CHIP_Y + CHIP + 8;
  doc.fillOpacity(1).rect(ML, SEP_Y, CW, 0.8).fill(theme.primary);
  _pdfRichContent(doc, sec, ML, CW, SEP_Y + 12, H - FOOTER_H - 12, theme);
  _pdfFooter(doc, title, idx + 2, theme);
}

// ── PDF: CLEAN style ──────────────────────────────────────────────────────────
function _pdfCoverClean(doc, title, sections, theme) {
  const W = doc.page.width, H = doc.page.height;
  const ML = 66, CW = W - ML - 60;

  doc.rect(0, 0, W, H).fill('#ffffff');
  doc.rect(0, 0, 10, H).fill(theme.accent);
  doc.rect(10, 0, W - 10, 3).fill(theme.primary);
  doc.save().fillOpacity(0.04).fillColor(theme.primary).circle(W + 60, -80, 320).fill().restore();

  doc.fillColor(theme.primary).fillOpacity(0.55).font('Helvetica').fontSize(8)
     .text('DOCUMENTO GENERADO POR CORTANA', ML, H * 0.27, { characterSpacing: 2 });
  doc.save().fillOpacity(1).rect(ML, H * 0.27 + 15, 40, 1.5).fill(theme.accent).restore();
  doc.fillColor(theme.dark).fillOpacity(1).font('Helvetica-Bold').fontSize(36)
     .text(title, ML, H * 0.29 + 18, { width: CW - 20, lineGap: 8 });

  doc.fillColor('#6B7280').fillOpacity(1).font('Helvetica').fontSize(10).text(fmtDate(), ML, doc.y + 26);
  doc.fillColor('#9CA3AF').font('Helvetica').fontSize(9).text('Cortana · @andrewhypervenom', ML, doc.y + 4);

  if (sections.length > 0) {
    const TOC_Y = H * 0.66;
    doc.save().fillOpacity(1).rect(ML, TOC_Y - 8, CW, 0.5).fill(theme.primary).restore();
    doc.fillColor(theme.primary).fillOpacity(0.50).font('Helvetica').fontSize(8)
       .text('CONTENIDO', ML, TOC_Y, { characterSpacing: 2 });
    sections.slice(0, 8).forEach((sec, i) => {
      const sy = TOC_Y + 15 + i * 20;
      doc.fillColor(theme.accent).fillOpacity(1).font('Helvetica-Bold').fontSize(8)
         .text(String(i + 1).padStart(2, '0'), ML, sy);
      doc.fillColor('#374151').fillOpacity(0.80).font('Helvetica').fontSize(9)
         .text(sec.heading || '', ML + 22, sy, { width: CW - 22, ellipsis: true });
    });
  }
}

function _pdfSectionClean(doc, sec, idx, title, theme) {
  const W = doc.page.width, H = doc.page.height;
  const ML = 60, MR = 60, CW = W - ML - MR, FOOTER_H = 32;
  const HDR_H = 68; // altura de la banda de cabecera

  doc.fillOpacity(1).rect(0, 0, W, H).fill('#ffffff');
  doc.rect(0, 0, 5, H).fill(theme.accent);
  doc.rect(0, 0, W, 2).fill(theme.primary);
  doc.save().fillOpacity(1).rect(0, 2, W, HDR_H - 2).fill(theme.bg || '#F9FAFB').restore();

  // Número y título con margen superior cómodo
  doc.fillColor(theme.accent).fillOpacity(1).font('Helvetica-Bold').fontSize(10)
     .text(String(idx + 1).padStart(2, '0'), ML, 28);
  if (sec.heading) {
    doc.fillColor(theme.dark).fillOpacity(1).font('Helvetica-Bold').fontSize(14)
       .text(_cleanForRender(sec.heading), ML + 28, 26, { width: CW - 28, lineGap: 2 });
  }
  doc.fillOpacity(1).rect(ML, HDR_H, CW, 0.5).fill(theme.primary);
  _pdfRichContent(doc, sec, ML, CW, HDR_H + 14, H - FOOTER_H - 12, theme);
  _pdfFooter(doc, title, idx + 2, theme);
}

// ── generatePDF ───────────────────────────────────────────────────────────────
async function generatePDF(title, sections = [], references = [], opts = {}) {
  const { style = 'clean', useImages = false } = opts;
  const theme   = getTheme(title);
  const keyword = titleToKeyword(title);

  let coverImgBuf    = null;
  let sectionImgBufs = sections.map(() => null);
  if (useImages) {
    const secKeywords = sections.map(sec => sectionKeyword(title, sec.heading || ''));
    const { coverBuf, sectionBufs } = await fetchDocImages(keyword, secKeywords);
    coverImgBuf    = coverBuf;
    sectionImgBufs = sectionBufs;
  }

  const coverFn   = style === 'visual' ? _pdfCoverVisual   : style === 'technical' ? _pdfCoverTechnical   : _pdfCoverClean;
  const sectionFn = style === 'visual' ? _pdfSectionVisual : style === 'technical' ? _pdfSectionTechnical : _pdfSectionClean;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      margin: 0, size: 'A4', bufferPages: true,
      info: { Title: title, Author: 'Cortana — @andrewhypervenom', Creator: 'Cortana Bot' },
    });
    doc.on('data',  c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (style === 'visual') {
      coverFn(doc, title, sections, theme, coverImgBuf);
    } else {
      coverFn(doc, title, sections, theme);
    }

    sections.forEach((sec, idx) => {
      doc.addPage({ margin: 0 });
      if (style === 'visual') {
        sectionFn(doc, sec, idx, title, theme, sectionImgBufs[idx]);
      } else {
        sectionFn(doc, sec, idx, title, theme);
      }
    });

    // Página de referencias al final
    if (Array.isArray(references) && references.length > 0) {
      _pdfReferencesPage(doc, references, title, theme);
    }

    doc.end();
  });
}

// ── generatePPTX ──────────────────────────────────────────────────────────────
async function generatePPTX(title, slides = [], references = [], opts = {}) {
  const { style = 'clean', useImages = false } = opts;
  const theme   = getTheme(title);
  const keyword = titleToKeyword(title);

  let slideDataUrls = slides.map(() => null);
  if (useImages) {
    const slideKws = slides.map(s => sectionKeyword(title, s.title || ''));
    const { sectionBufs } = await fetchDocImages(null, slideKws);
    slideDataUrls = sectionBufs.map(buf => {
      if (!buf) return null;
      try { return 'data:image/jpeg;base64,' + buf.toString('base64'); } catch { return null; }
    });
  }

  const pptx = new PptxGenJS();
  pptx.layout  = 'LAYOUT_16x9';
  pptx.author  = 'Cortana Bot';
  pptx.subject = title;
  pptx.title   = title;

  const W = 10, H = 5.625;
  const PRI   = hex(theme.primary);
  const ACC   = hex(theme.accent);
  const DARK  = hex(theme.dark);
  const WHITE = 'FFFFFF';
  const LGRAY = 'F3F4F6';
  const MGRAY = '9CA3AF';
  const TEXTC = '1F2937';

  // ── PORTADA ──────────────────────────────────────────────────────────────
  const cover = pptx.addSlide();

  if (style === 'technical') {
    cover.background = { color: 'F8F9FA' };
    cover.addShape(pptx.ShapeType.rect, {
      x: W * 0.60, y: 0, w: W * 0.40, h: H,
      fill: { color: PRI }, line: { color: PRI, width: 0 },
    });
    cover.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: W * 0.60, h: 0.07,
      fill: { color: ACC }, line: { color: ACC, width: 0 },
    });
    cover.addText(String(slides.length).padStart(2, '0'), {
      x: W * 0.60, y: H * 0.18, w: W * 0.40, h: 1.4,
      fontSize: 80, bold: true, color: WHITE,
      align: 'center', valign: 'middle', transparency: 8,
    });
    cover.addText('SECCIONES', {
      x: W * 0.60, y: H * 0.70, w: W * 0.40, h: 0.30,
      fontSize: 8.5, color: WHITE, align: 'center', charSpacing: 2.5, transparency: 45,
    });
    cover.addText(title, {
      x: 0.35, y: H * 0.20, w: W * 0.57, h: H * 0.48,
      fontSize: 30, bold: true, color: DARK,
      align: 'left', valign: 'middle', wrap: true,
    });
    cover.addText(`${fmtDate()}  ·  Cortana @andrewhypervenom`, {
      x: 0.35, y: H * 0.76, w: W * 0.57, h: 0.32,
      fontSize: 9, color: MGRAY, align: 'left',
    });
  } else if (style === 'clean') {
    cover.background = { color: PRI };
    cover.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: W * 0.07, h: H,
      fill: { color: ACC }, line: { color: ACC, width: 0 },
    });
    cover.addShape(pptx.ShapeType.ellipse, {
      x: W * 0.70, y: H * 0.60, w: 2.5, h: 2.5,
      fill: { color: WHITE, transparency: 90 }, line: { color: WHITE, width: 0 },
    });
    cover.addShape(pptx.ShapeType.ellipse, {
      x: W * 0.78, y: -0.5, w: 1.8, h: 1.8,
      fill: { color: WHITE, transparency: 88 }, line: { color: WHITE, width: 0 },
    });
    cover.addText('GENERADO POR CORTANA', {
      x: W * 0.11, y: H * 0.20, w: W * 0.78, h: 0.28,
      fontSize: 7.5, color: WHITE, charSpacing: 2.5,
      align: 'left', valign: 'middle', transparency: 48,
    });
    cover.addText(title, {
      x: W * 0.11, y: H * 0.28, w: W * 0.78, h: H * 0.46,
      fontSize: 34, bold: true, color: WHITE,
      align: 'left', valign: 'middle', wrap: true,
    });
    cover.addText(`${fmtDate()}  ·  Cortana @andrewhypervenom`, {
      x: W * 0.11, y: H * 0.78, w: W * 0.78, h: 0.32,
      fontSize: 9, color: WHITE, align: 'left', transparency: 40,
    });
    cover.addText(`${slides.length}`, {
      x: 0, y: H * 0.38, w: W * 0.07, h: 0.42,
      fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle',
    });
    cover.addText('slides', {
      x: 0, y: H * 0.53, w: W * 0.07, h: 0.26,
      fontSize: 7, color: WHITE, align: 'center', transparency: 28,
    });
  } else {
    // visual: oscuro + panel derecho
    cover.background = { color: DARK };
    cover.addShape(pptx.ShapeType.rect, {
      x: W * 0.62, y: 0, w: W * 0.38, h: H,
      fill: { color: PRI, transparency: 22 }, line: { color: PRI, width: 0 },
    });
    cover.addShape(pptx.ShapeType.ellipse, {
      x: W * 0.72, y: -0.6, w: 2.8, h: 2.8,
      fill: { color: ACC, transparency: 75 }, line: { color: ACC, width: 0 },
    });
    cover.addShape(pptx.ShapeType.ellipse, {
      x: W * 0.80, y: H * 0.55, w: 2.0, h: 2.0,
      fill: { color: WHITE, transparency: 90 }, line: { color: WHITE, width: 0 },
    });
    cover.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: W * 0.08, h: H,
      fill: { color: ACC }, line: { color: ACC, width: 0 },
    });
    cover.addShape(pptx.ShapeType.rect, {
      x: W * 0.12, y: H * 0.37, w: 0.45, h: 0.04,
      fill: { color: ACC }, line: { color: ACC, width: 0 },
    });
    cover.addText('GENERADO POR CORTANA', {
      x: W * 0.11, y: H * 0.22, w: W * 0.50, h: 0.28,
      fontSize: 7.5, color: WHITE, charSpacing: 2.5,
      align: 'left', valign: 'middle', transparency: 45,
    });
    cover.addText(title, {
      x: W * 0.11, y: H * 0.28, w: W * 0.52, h: H * 0.48,
      fontSize: 32, bold: true, color: WHITE,
      align: 'left', valign: 'middle', wrap: true,
    });
    cover.addText(`${fmtDate()}  ·  Cortana @andrewhypervenom`, {
      x: W * 0.11, y: H * 0.78, w: W * 0.50, h: 0.32,
      fontSize: 9, color: WHITE, align: 'left', transparency: 40,
    });
    cover.addText(`${slides.length}`, {
      x: 0, y: H * 0.40, w: W * 0.08, h: 0.40,
      fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle',
    });
    cover.addText('slides', {
      x: 0, y: H * 0.55, w: W * 0.08, h: 0.26,
      fontSize: 7, color: WHITE, align: 'center', transparency: 25,
    });
  }

  // ── SLIDES DE CONTENIDO ───────────────────────────────────────────────────
  slides.forEach((slide, idx) => {
    const s = pptx.addSlide();
    s.background = { color: WHITE };
    const points      = slide.points || [];
    const hasTable    = !!(slide.table?.headers?.length > 0);
    const hasFlow     = !!(slide.flowchart?.steps?.length > 0);
    const hasCuriosity = !!slide.curiosity;

    // Reserva espacio si hay curiosity box al fondo
    const BOTTOM_RESERVE = hasCuriosity ? 1.00 : 0.35;

    if (style === 'technical') {
      // Watermark número (faint)
      s.addText(String(idx + 1).padStart(2, '0'), {
        x: W * 0.55, y: H * 0.05, w: W * 0.43, h: H * 0.80,
        fontSize: 150, bold: true, color: LGRAY,
        align: 'center', valign: 'middle',
      });
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.05, fill: { color: PRI }, line: { color: PRI, width: 0 } });
      s.addShape(pptx.ShapeType.rect, { x: 0.22, y: 0.14, w: 0.65, h: 0.65, fill: { color: ACC }, line: { color: ACC, width: 0 } });
      s.addText(String(idx + 1).padStart(2, '0'), {
        x: 0.22, y: 0.14, w: 0.65, h: 0.65,
        fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle',
      });
      s.addText(slide.title || '', {
        x: 1.05, y: 0.17, w: W - 1.30, h: 0.58,
        fontSize: 17, bold: true, color: DARK, align: 'left', valign: 'middle', wrap: true,
      });
      s.addShape(pptx.ShapeType.rect, { x: 0.22, y: 0.98, w: W - 0.44, h: 0.02, fill: { color: PRI }, line: { color: PRI, width: 0 } });

      const contentStartY = 1.08;
      const contentEndY   = H - BOTTOM_RESERVE;
      const availH        = contentEndY - contentStartY;

      if (hasTable) {
        _pptxAddTable(s, pptx, slide.table, 0.22, contentStartY, W - 0.44, availH, PRI, ACC, LGRAY, TEXTC, WHITE);
      } else if (hasFlow) {
        _pptxAddFlowchart(s, pptx, slide.flowchart, 0.22, contentStartY, W - 0.44, availH, PRI, ACC, DARK, WHITE, TEXTC);
      } else if (points.length > 0) {
        const rowH = Math.min(availH / points.length, 0.84);
        points.forEach((p, pi) => {
          const rowY = contentStartY + pi * rowH;
          s.addShape(pptx.ShapeType.ellipse, { x: 0.32, y: rowY + rowH * 0.5 - 0.07, w: 0.14, h: 0.14, fill: { color: ACC }, line: { color: ACC, width: 0 } });
          s.addText(p, { x: 0.58, y: rowY, w: W * 0.60 - 0.70, h: rowH, fontSize: 11, color: TEXTC, align: 'left', valign: 'middle', wrap: true, paraSpaceAfter: 0 });
        });
      }

    } else if (style === 'visual') {
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.72, fill: { color: PRI }, line: { color: PRI, width: 0 } });
      s.addShape(pptx.ShapeType.rect, { x: W - 0.82, y: 0, w: 0.82, h: 0.72, fill: { color: ACC }, line: { color: ACC, width: 0 } });
      s.addText(String(idx + 1).padStart(2, '0'), {
        x: W - 0.82, y: 0, w: 0.82, h: 0.72,
        fontSize: 17, bold: true, color: WHITE, align: 'center', valign: 'middle',
      });
      s.addText(slide.title || '', {
        x: 0.25, y: 0, w: W - 1.20, h: 0.72,
        fontSize: 16, bold: true, color: WHITE, align: 'left', valign: 'middle', wrap: true,
      });

      const imgDataUrl = slideDataUrls[idx];
      const contentStartY = 0.84;
      const contentEndY   = H - BOTTOM_RESERVE;
      const availH        = contentEndY - contentStartY;
      const hasImg        = !!imgDataUrl && !hasTable && !hasFlow;
      const txtW          = hasImg ? W * 0.54 : W - 0.50;

      if (hasImg) {
        const imgX = W * 0.60, imgY = 0.85, imgW = W * 0.37, imgH = H - 0.85 - BOTTOM_RESERVE;
        s.addShape(pptx.ShapeType.rect, { x: imgX - 0.08, y: imgY - 0.08, w: imgW + 0.16, h: imgH + 0.16, fill: { color: LGRAY }, line: { color: 'E5E7EB', width: 1 } });
        s.addImage({ data: imgDataUrl, x: imgX, y: imgY, w: imgW, h: imgH, sizing: { type: 'contain', w: imgW, h: imgH } });
      }

      if (hasTable) {
        _pptxAddTable(s, pptx, slide.table, 0.25, contentStartY, W - 0.50, availH, PRI, ACC, LGRAY, TEXTC, WHITE);
      } else if (hasFlow) {
        _pptxAddFlowchart(s, pptx, slide.flowchart, 0.25, contentStartY, txtW, availH, PRI, ACC, DARK, WHITE, TEXTC);
      } else if (points.length > 0) {
        const rowH = Math.min(availH / points.length, 0.84);
        points.forEach((p, pi) => {
          const rowY = contentStartY + pi * rowH;
          if (pi % 2 === 0) s.addShape(pptx.ShapeType.rect, { x: 0.25, y: rowY - 0.04, w: txtW, h: rowH - 0.04, fill: { color: LGRAY }, line: { color: LGRAY, width: 0 } });
          s.addShape(pptx.ShapeType.ellipse, { x: 0.35, y: rowY + rowH * 0.5 - 0.07, w: 0.14, h: 0.14, fill: { color: ACC }, line: { color: ACC, width: 0 } });
          s.addText(p, { x: 0.61, y: rowY, w: txtW - 0.48, h: rowH, fontSize: 11, color: TEXTC, align: 'left', valign: 'middle', wrap: true, paraSpaceAfter: 0 });
        });
      }
      s.addText(title, { x: 0.25, y: H - 0.30, w: W - 0.50, h: 0.26, fontSize: 7, color: MGRAY, align: 'left', valign: 'middle' });

    } else {
      // clean
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.03, fill: { color: PRI }, line: { color: PRI, width: 0 } });
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0.03, w: W, h: 0.68, fill: { color: LGRAY }, line: { color: LGRAY, width: 0 } });
      s.addText(String(idx + 1).padStart(2, '0'), {
        x: 0.22, y: 0.08, w: 0.55, h: 0.55,
        fontSize: 14, bold: true, color: ACC, align: 'center', valign: 'middle',
      });
      s.addText(slide.title || '', {
        x: 0.90, y: 0.10, w: W - 1.12, h: 0.55,
        fontSize: 16, bold: true, color: DARK, align: 'left', valign: 'middle', wrap: true,
      });
      s.addShape(pptx.ShapeType.rect, { x: 0.22, y: 0.77, w: W - 0.44, h: 0.02, fill: { color: PRI }, line: { color: PRI, width: 0 } });

      const contentStartY = 0.86;
      const contentEndY   = H - BOTTOM_RESERVE;
      const availH        = contentEndY - contentStartY;

      if (hasTable) {
        _pptxAddTable(s, pptx, slide.table, 0.22, contentStartY, W - 0.44, availH, PRI, ACC, LGRAY, TEXTC, WHITE);
      } else if (hasFlow) {
        _pptxAddFlowchart(s, pptx, slide.flowchart, 0.22, contentStartY, W - 0.44, availH, PRI, ACC, DARK, WHITE, TEXTC);
      } else if (points.length > 0) {
        const rowH = Math.min(availH / points.length, 0.84);
        points.forEach((p, pi) => {
          const rowY = contentStartY + pi * rowH;
          s.addShape(pptx.ShapeType.ellipse, { x: 0.32, y: rowY + rowH * 0.5 - 0.06, w: 0.12, h: 0.12, fill: { color: ACC }, line: { color: ACC, width: 0 } });
          s.addText(p, { x: 0.56, y: rowY, w: W - 0.78, h: rowH, fontSize: 11, color: TEXTC, align: 'left', valign: 'middle', wrap: true, paraSpaceAfter: 0 });
        });
      }
      s.addText(title, { x: 0.25, y: H - 0.30, w: W - 0.50, h: 0.26, fontSize: 7, color: MGRAY, align: 'left', valign: 'middle' });
    }

    // Curiosity box al fondo (todos los estilos)
    if (hasCuriosity) {
      const boxY = H - 0.95;
      s.addShape(pptx.ShapeType.rect, {
        x: 0.22, y: boxY, w: W - 0.44, h: 0.78,
        fill: { color: ACC, transparency: 88 }, line: { color: ACC, width: 1.2 },
      });
      s.addShape(pptx.ShapeType.rect, {
        x: 0.22, y: boxY, w: 0.06, h: 0.78,
        fill: { color: ACC }, line: { color: ACC, width: 0 },
      });
      s.addText(`💡 ${slide.curiosity}`, {
        x: 0.34, y: boxY + 0.06, w: W - 0.62, h: 0.66,
        fontSize: 9, color: TEXTC, align: 'left', valign: 'middle', wrap: true,
      });
    }
  });

  // ── SLIDE REFERENCIAS ─────────────────────────────────────────────────────
  if (Array.isArray(references) && references.length > 0) {
    const refSlide = pptx.addSlide();
    refSlide.background = { color: WHITE };
    refSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.05, fill: { color: PRI }, line: { color: PRI, width: 0 } });
    refSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.05, w: W, h: 0.70, fill: { color: LGRAY }, line: { color: LGRAY, width: 0 } });
    refSlide.addText('Referencias', { x: 0.25, y: 0.10, w: 4, h: 0.55, fontSize: 20, bold: true, color: DARK });
    refSlide.addShape(pptx.ShapeType.rect, { x: 0.25, y: 0.78, w: 0.70, h: 0.03, fill: { color: ACC }, line: { color: ACC, width: 0 } });

    references.slice(0, 6).forEach((ref, i) => {
      const refY = 0.92 + i * 0.72;
      if (refY + 0.65 > H) return;
      const apa = `${ref.author || ''} (${ref.year || 's.f.'}). ${ref.title || ''}. ${ref.publisher || ''}`;
      refSlide.addText([
        { text: `${i + 1}. `, options: { bold: true, color: ACC } },
        { text: apa + (ref.url ? `\n${ref.url}` : ''), options: { color: TEXTC } },
      ], { x: 0.25, y: refY, w: W - 0.50, h: 0.65, fontSize: 9.5, wrap: true });
    });
  }

  // ── SLIDE FINAL ───────────────────────────────────────────────────────────
  const end = pptx.addSlide();
  const endBg = style === 'clean' ? PRI : DARK;
  end.background = { color: endBg };
  end.addShape(pptx.ShapeType.rect, {
    x: W * 0.62, y: 0, w: W * 0.38, h: H,
    fill: { color: PRI, transparency: style === 'clean' ? 70 : 20 }, line: { color: PRI, width: 0 },
  });
  end.addShape(pptx.ShapeType.ellipse, {
    x: W * 0.72, y: -0.6, w: 2.8, h: 2.8,
    fill: { color: ACC, transparency: 75 }, line: { color: ACC, width: 0 },
  });
  end.addShape(pptx.ShapeType.ellipse, {
    x: -0.5, y: H * 0.55, w: 2.5, h: 2.5,
    fill: { color: style === 'clean' ? WHITE : PRI, transparency: 85 }, line: { color: PRI, width: 0 },
  });
  end.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W * 0.08, h: H,
    fill: { color: ACC }, line: { color: ACC, width: 0 },
  });
  end.addText('Gracias', {
    x: W * 0.11, y: H * 0.18, w: W * 0.52, h: H * 0.46,
    fontSize: 52, bold: true, color: WHITE, align: 'left', valign: 'middle',
  });
  end.addShape(pptx.ShapeType.rect, {
    x: W * 0.11, y: H * 0.70, w: 0.45, h: 0.04,
    fill: { color: ACC }, line: { color: ACC, width: 0 },
  });
  end.addText('Presentación generada por Cortana · @andrewhypervenom', {
    x: W * 0.11, y: H * 0.74, w: W * 0.52, h: 0.32,
    fontSize: 9.5, color: WHITE, align: 'left', transparency: 40,
  });

  const data = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(data);
}

// ── PPTX helper: tabla nativa ─────────────────────────────────────────────────
function _pptxAddTable(s, pptx, table, x, y, w, availH, PRI, ACC, LGRAY, TEXTC, WHITE) {
  const { headers = [], rows = [] } = table;
  if (!headers.length) return;

  const colW = w / headers.length;
  const rowH = Math.min(0.40, (availH - 0.15) / (rows.length + 1));

  const tableData = [
    headers.map(h => ({
      text: String(h),
      options: { bold: true, color: WHITE, fill: { color: PRI }, fontSize: 10, align: 'center', valign: 'middle' },
    })),
    ...rows.map((row, ri) => (row || []).map(cell => ({
      text: String(cell ?? ''),
      options: {
        color: TEXTC, fontSize: 9.5, align: 'left', valign: 'middle',
        fill: { color: ri % 2 === 0 ? WHITE : LGRAY },
      },
    }))),
  ];

  s.addTable(tableData, {
    x, y,
    w,
    colW: Array(headers.length).fill(colW),
    rowH,
    border: { type: 'solid', color: PRI, pt: 0.5, transparency: 70 },
  });
}

// ── PPTX helper: flowchart de shapes ─────────────────────────────────────────
function _pptxAddFlowchart(s, pptx, flowchart, x, y, w, availH, PRI, ACC, DARK, WHITE, TEXTC) {
  const { steps = [], decision_idx = -1 } = flowchart;
  if (!steps.length) return;

  const boxW   = Math.min(3.2, w * 0.70);
  const boxH   = 0.50;
  const gapH   = 0.32;
  const totalH = steps.length * (boxH + gapH);
  const scale  = totalH > availH ? availH / totalH : 1;
  const centerX = x + w / 2;

  steps.forEach((step, si) => {
    const bx  = centerX - boxW / 2;
    const by  = y + si * (boxH + gapH) * scale;
    const isDecision = si === decision_idx;
    const isEndpoint = si === 0 || si === steps.length - 1;

    const shapeType = isDecision ? pptx.ShapeType.diamond : pptx.ShapeType.roundRect;
    const fillColor = isEndpoint ? PRI : (isDecision ? ACC : WHITE);
    const textColor = isEndpoint ? WHITE : (isDecision ? WHITE : DARK);

    s.addShape(shapeType, {
      x: bx, y: by, w: boxW, h: boxH * scale,
      fill: { color: fillColor },
      line: { color: PRI, width: 1.2 },
    });
    s.addText(String(step), {
      x: bx, y: by, w: boxW, h: boxH * scale,
      fontSize: 9, color: textColor, align: 'center', valign: 'middle', wrap: true,
    });

    // Flecha
    if (si < steps.length - 1) {
      const arrowY = by + boxH * scale;
      s.addShape(pptx.ShapeType.line, {
        x: centerX - 0.001, y: arrowY,
        w: 0.001, h: gapH * scale,
        line: { color: PRI, width: 1.2, endArrowType: 'arrow' },
      });
    }
  });
}

// ── Detección de tipo de documento con IA ────────────────────────────────────
async function detectDocumentRequest(text, groqService) {
  if (!/\b(crea|haz|hazme|genera|realiza|dame|necesito|quiero|hacer|elabora|prepara|arma|produce|documento|informe|reporte|presentaci|diapositiva|pdf|ppt|power\s*point|slide|ensayo|propuesta|plan|manual|guía)\b/i.test(text)) {
    return null;
  }

  try {
    const res = await groqService.client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{
        role: 'user',
        content: `¿El siguiente mensaje es una petición para crear un archivo?\n\n- Si pide PowerPoint, presentación, diapositivas, PPT o slides → responde "pptx"\n- Si pide PDF, documento, informe, reporte, ensayo, propuesta, plan, manual, guía, o cualquier otro archivo de texto → responde "pdf"\n- Si NO es una petición de crear un archivo → responde "no"\n\nMensaje: "${text}"\n\nResponde SOLO con: pdf, pptx, o no`,
      }],
      max_tokens: 5,
      temperature: 0,
    });
    const answer = (res.choices[0]?.message?.content || '').trim().toLowerCase();
    if (answer.includes('pptx') || answer.includes('ppt')) return 'pptx';
    if (answer.includes('pdf')) return 'pdf';
    return null;
  } catch {
    return null;
  }
}

module.exports = { generatePDF, generatePPTX, detectDocumentRequest };
