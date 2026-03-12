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
 * Cuanto mayor el score, más relevante es la imagen al tema.
 */
function _scoreCandidate(candidate, keyword) {
  const kws = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (kws.length === 0) return 1;
  const text = [candidate.title, candidate.url, candidate.source].filter(Boolean).join(' ').toLowerCase();
  return kws.filter(w => text.includes(w)).length;
}

/**
 * Trae hasta `count` candidatos de DDG con metadata completa (título, url, imagen).
 * Filtra dominios bloqueados y mínimo ancho 600px.
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
 * Filtra palabras meta/estructurales para no contaminar la búsqueda.
 * Ej: "Guía de Fútbol" + "Características y Actualizaciones" → "fútbol" (fallback al título)
 * Ej: "Fútbol" + "Historia del Balón" → "fútbol balón"
 * Ej: "Rocket League" + "Mecánicas de Juego y Físicas" → "rocket league mecánicas físicas"
 */
function sectionKeyword(mainTitle, sectionHeading) {
  const stop = new Set(['de','del','la','el','los','las','un','una','para','con','en','por','que','y','a','o','e','como','desde','hasta','sobre','sus','este','esta','entre','muy','mas','más','sus','esta','estos','estas']);
  const clean = t => (t || '').toLowerCase()
    .replace(/[^\w\sáéíóúñü]/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stop.has(w) && !META_WORDS.has(w));

  const main = clean(mainTitle).slice(0, 2);      // ej: ["rocket", "league"]
  const sec  = clean(sectionHeading).slice(0, 2); // ej: ["mecanicas", "fisicas"]

  // Si el heading solo tiene palabras meta/estructurales, usar solo el título principal
  if (sec.length === 0) return main.join(' ') || titleToKeyword(mainTitle);
  return [...main, ...sec].join(' ');
}

/**
 * Busca imágenes para todo el documento con keywords específicos por sección
 * y deduplicación por URL — si la imagen #1 ya fue usada, toma la #2, etc.
 *
 * coverKeyword: keyword para la portada (null = sin imagen de portada)
 * sectionKeywords: array de keywords uno por sección/slide
 * Retorna: { coverBuf, sectionBufs[] }
 */
async function fetchDocImages(coverKeyword, sectionKeywords) {
  const allKeywords = coverKeyword ? [coverKeyword, ...sectionKeywords] : [...sectionKeywords];

  // A. Unsplash: cada keyword busca por separado → imágenes distintas por naturaleza
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

  // B. DDG: candidatos con metadata completa para scoring + deduplicación
  const candidateLists = await Promise.allSettled(
    allKeywords.map(kw => _getDDGCandidates(kw, 18))
  );

  const usedUrls = new Set();

  // Selección por keyword: en serie para que la deduplicación sea consistente
  const selectedUrls = [];
  for (let ki = 0; ki < allKeywords.length; ki++) {
    const keyword    = allKeywords[ki];
    const candidates = candidateLists[ki]?.status === 'fulfilled' ? (candidateLists[ki].value || []) : [];

    const scored = candidates
      .filter(c => !_looksLikeDocument(c))
      .map(c => ({ ...c, score: _scoreCandidate(c, keyword) }))
      .sort((a, b) => b.score - a.score);

    // 1. Relevante y no duplicado
    const pick = scored.find(c => c.score > 0 && !usedUrls.has(c.image));
    if (pick) { usedUrls.add(pick.image); selectedUrls.push(pick.image); continue; }

    // 2. Pool agotado: pedir segunda página (offset 20) con mismo keyword
    try {
      const more = await _getDDGCandidates(keyword, 18, 20);
      const morePick = more
        .filter(c => !_looksLikeDocument(c))
        .map(c => ({ ...c, score: _scoreCandidate(c, keyword) }))
        .sort((a, b) => b.score - a.score)
        .find(c => !usedUrls.has(c.image));
      if (morePick) { usedUrls.add(morePick.image); selectedUrls.push(morePick.image); continue; }
    } catch {}

    // 3. Último fallback: cualquier no duplicado del primer batch (score 0 ok)
    const fallback = scored.find(c => !usedUrls.has(c.image));
    if (fallback) { usedUrls.add(fallback.image); selectedUrls.push(fallback.image); continue; }

    selectedUrls.push(null);
  }

  // Descargar las seleccionadas en paralelo
  const bufs = await Promise.allSettled(
    selectedUrls.map(url => url ? _downloadImage(url) : Promise.resolve(null))
  );
  const imgs = bufs.map(r => r.status === 'fulfilled' ? r.value : null);

  return coverKeyword
    ? { coverBuf: imgs[0] || null, sectionBufs: imgs.slice(1) }
    : { coverBuf: null, sectionBufs: imgs };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Palabras meta/estructurales que no ayudan en búsquedas de imágenes
const META_WORDS = new Set([
  // Documentales
  'guia','guía','manual','tutorial','curso','completo','completa','introduccion',
  'introducción','overview','resumen','summary','aprende','aprender','todo','sobre',
  // Secciones genéricas
  'caracteristicas','características','actualizaciones','actualizacion','historia',
  'historico','histórico','general','generalidades','descripcion','descripción',
  'informacion','información','aspectos','ventajas','desventajas','beneficios',
  'tipos','comparacion','comparación','impacto','analisis','análisis','conclusion',
  'conclusión','futuro','perspectivas','contexto','importancia','fundamentos',
  'bases','principios','conceptos','teoria','teoría','practica','práctica',
  'updates','features','overview','introduction','history','basics','guide',
  // Tecnológicos genéricos que contaminan
  'sistema','sistemas','configuracion','configuración','instalacion','instalación',
  'proceso','procesos','metodos','métodos','tecnicas','técnicas',
]);

/**
 * Extrae el keyword visual del título, filtrando palabras meta/estructurales.
 * "Guía Completa de Rocket League" → "rocket league"
 */
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

// ── PDF shared text renderer ──────────────────────────────────────────────────
function _pdfText(doc, content, x, w, startY, maxY, theme) {
  let curY = startY;
  for (const para of (content || '').split(/\n\n+/)) {
    const text = para.trim();
    if (!text || curY >= maxY - 10) continue;
    if (/^[-•*]/.test(text)) {
      for (const item of text.split('\n').filter(l => l.trim())) {
        if (curY >= maxY - 10) break;
        const clean = item.replace(/^[-•*]\s*/, '').trim();
        doc.fillColor(theme.accent).fillOpacity(1).circle(x - 5, curY + 5.5, 2.5).fill();
        doc.fillColor('#374151').fillOpacity(1).font('Helvetica').fontSize(10)
           .text(clean, x, curY, { width: w, align: 'justify', lineGap: 3 });
        curY = Math.min(doc.y + 6, maxY);
      }
    } else {
      doc.fillColor('#374151').fillOpacity(1).font('Helvetica').fontSize(10.5)
         .text(text, x, curY, { width: w, align: 'justify', lineGap: 4 });
      curY = Math.min(doc.y + 12, maxY);
    }
  }
}

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
  const IMG_H    = Math.round(H * 0.38);
  const CARD_Y   = IMG_H + 14;
  const CARD_H   = H - CARD_Y - FOOTER_H - 10;
  const pCW      = W - ML - MR;

  // Fondo tintado
  doc.fillOpacity(1).rect(0, 0, W, H).fill(theme.bg);

  // Hero image — cover: [W, IMG_H] recorta sin distorsionar
  // doc.restore() SIEMPRE se llama para liberar el clip, aunque image() falle
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

  // Overlay degradado sobre el hero
  doc.save().fillOpacity(0.22).rect(0, 0, W, IMG_H * 0.45).fill('#000000').restore();
  doc.save().fillOpacity(0.65).rect(0, IMG_H * 0.45, W, IMG_H * 0.55).fill('#000000').restore();

  // Chip número sección
  doc.fillOpacity(1).rect(W - 54, 0, 54, 30).fill(theme.accent);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12)
     .text(String(idx + 1).padStart(2, '0'), W - 54, 9, { width: 54, align: 'center' });

  // Línea + título sobre el hero
  doc.fillOpacity(1).rect(ML, IMG_H - 50, 28, 2.5).fill(theme.accent);
  if (sec.heading) {
    doc.fillColor('#ffffff').fillOpacity(1).font('Helvetica-Bold').fontSize(19)
       .text(sec.heading, ML, IMG_H - 43, { width: pCW - 70, lineGap: 3 });
  }

  // Card flotante con sombra
  doc.save().fillOpacity(0.07).rect(ML + 4, CARD_Y + 4, pCW, CARD_H).fill('#000000').restore();
  doc.fillOpacity(1).rect(ML, CARD_Y, pCW, CARD_H).fill('#ffffff');
  doc.rect(ML, CARD_Y, 4, CARD_H).fill(theme.accent);

  _pdfText(doc, sec.content, ML + 18, pCW - 28, CARD_Y + 18, CARD_Y + CARD_H - 14, theme);
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

  // Dot grid on right panel
  doc.save().fillOpacity(0.14);
  for (let row = 0; row < 14; row++) {
    for (let col = 0; col < 5; col++) {
      doc.circle(SPLIT + 22 + col * 30, 28 + row * 58, 3).fill('#ffffff');
    }
  }
  doc.restore();

  // Big count on right
  doc.fillColor('#ffffff').fillOpacity(0.90).font('Helvetica-Bold').fontSize(80)
     .text(String(sections.length).padStart(2, '0'), SPLIT + 10, H * 0.27, { width: W - SPLIT - 14 });
  doc.fillColor('#ffffff').fillOpacity(0.40).font('Helvetica').fontSize(9)
     .text('SECCIONES', SPLIT + 14, H * 0.27 + 90, { characterSpacing: 3 });

  // Title left
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

  doc.fillOpacity(1).rect(0, 0, W, H).fill('#ffffff');
  doc.rect(0, 0, W, 4).fill(theme.primary);

  // Watermark step number
  doc.save().fillOpacity(0.04).fillColor(theme.primary).font('Helvetica-Bold').fontSize(210)
     .text(String(idx + 1), W * 0.38, H * 0.12, { width: W * 0.58 });
  doc.restore();

  // Step chip
  const CHIP = 52;
  doc.fillOpacity(1).rect(ML, 14, CHIP, CHIP).fill(theme.accent);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
     .text(String(idx + 1).padStart(2, '0'), ML, 14 + CHIP / 2 - 12, { width: CHIP, align: 'center' });

  if (sec.heading) {
    doc.fillColor(theme.dark).fillOpacity(1).font('Helvetica-Bold').fontSize(17)
       .text(sec.heading, ML + CHIP + 14, 22, { width: CW - CHIP - 16, lineGap: 3 });
  }

  doc.fillOpacity(1).rect(ML, 78, CW, 0.8).fill(theme.primary);
  _pdfText(doc, sec.content, ML, CW, 88, H - FOOTER_H - 12, theme);
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

  doc.fillOpacity(1).rect(0, 0, W, H).fill('#ffffff');
  doc.rect(0, 0, 5, H).fill(theme.accent);
  doc.rect(0, 0, W, 2).fill(theme.primary);

  // Light header band
  doc.save().fillOpacity(1).rect(0, 2, W, 44).fill(theme.bg || '#F9FAFB').restore();

  doc.fillColor(theme.accent).fillOpacity(1).font('Helvetica-Bold').fontSize(10)
     .text(String(idx + 1).padStart(2, '0'), ML, 12);
  if (sec.heading) {
    doc.fillColor(theme.dark).fillOpacity(1).font('Helvetica-Bold').fontSize(14)
       .text(sec.heading, ML + 28, 11, { width: CW - 28, lineGap: 2 });
  }
  doc.fillOpacity(1).rect(ML, 52, CW, 0.5).fill(theme.primary);
  _pdfText(doc, sec.content, ML, CW, 62, H - FOOTER_H - 12, theme);
  _pdfFooter(doc, title, idx + 2, theme);
}

// ── generatePDF ───────────────────────────────────────────────────────────────
async function generatePDF(title, sections = [], opts = {}) {
  const { style = 'clean', useImages = false } = opts;
  const theme   = getTheme(title);
  const keyword = titleToKeyword(title);

  // Portada usa keyword del título; cada sección usa su keyword específico.
  // Deduplicación por URL: si la primera imagen ya fue usada, toma la siguiente.
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

    doc.end();
  });
}

// ── generatePPTX ──────────────────────────────────────────────────────────────
async function generatePPTX(title, slides = [], opts = {}) {
  const { style = 'clean', useImages = false } = opts;
  const theme   = getTheme(title);
  const keyword = titleToKeyword(title);

  // PPTX: sin imagen en portada ni slide final. Cada slide de contenido
  // busca con su keyword específico; deduplicación por URL.
  let slideDataUrls = slides.map(() => null);
  if (useImages) {
    const slideKws = slides.map(s => sectionKeyword(title, s.title || ''));
    const { sectionBufs } = await fetchDocImages(null, slideKws);  // null = sin portada
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
    // Fondo claro, panel derecho primario
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
    // Fondo con color primario, diseño minimalista
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
    const points = slide.points || [];

    if (style === 'technical') {
      // Watermark número grande (faint)
      s.addText(String(idx + 1).padStart(2, '0'), {
        x: W * 0.55, y: H * 0.05, w: W * 0.43, h: H * 0.80,
        fontSize: 150, bold: true, color: LGRAY,
        align: 'center', valign: 'middle',
      });
      // Línea primaria top
      s.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: W, h: 0.05, fill: { color: PRI }, line: { color: PRI, width: 0 },
      });
      // Chip de paso
      s.addShape(pptx.ShapeType.rect, {
        x: 0.22, y: 0.14, w: 0.65, h: 0.65,
        fill: { color: ACC }, line: { color: ACC, width: 0 },
      });
      s.addText(String(idx + 1).padStart(2, '0'), {
        x: 0.22, y: 0.14, w: 0.65, h: 0.65,
        fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle',
      });
      s.addText(slide.title || '', {
        x: 1.05, y: 0.17, w: W - 1.30, h: 0.58,
        fontSize: 17, bold: true, color: DARK, align: 'left', valign: 'middle', wrap: true,
      });
      s.addShape(pptx.ShapeType.rect, {
        x: 0.22, y: 0.98, w: W - 0.44, h: 0.02,
        fill: { color: PRI }, line: { color: PRI, width: 0 },
      });
      if (points.length > 0) {
        const availH = H - 1.08 - 0.32;
        const rowH   = Math.min(availH / points.length, 0.84);
        points.forEach((p, pi) => {
          const rowY = 1.08 + pi * rowH;
          s.addShape(pptx.ShapeType.ellipse, {
            x: 0.32, y: rowY + rowH * 0.5 - 0.07, w: 0.14, h: 0.14,
            fill: { color: ACC }, line: { color: ACC, width: 0 },
          });
          s.addText(p, {
            x: 0.58, y: rowY, w: W * 0.60 - 0.70, h: rowH,
            fontSize: 11, color: TEXTC, align: 'left', valign: 'middle', wrap: true, paraSpaceAfter: 0,
          });
        });
      }

    } else if (style === 'visual') {
      // Header bar
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
      const txtW = imgDataUrl ? W * 0.54 : W - 0.5;
      if (imgDataUrl) {
        const imgX = W * 0.60, imgY = 0.85, imgW = W * 0.37, imgH = H - 0.85 - 0.35;
        s.addShape(pptx.ShapeType.rect, {
          x: imgX - 0.08, y: imgY - 0.08, w: imgW + 0.16, h: imgH + 0.16,
          fill: { color: LGRAY }, line: { color: 'E5E7EB', width: 1 },
        });
        s.addImage({ data: imgDataUrl, x: imgX, y: imgY, w: imgW, h: imgH, sizing: { type: 'contain', w: imgW, h: imgH } });
      }

      if (points.length > 0) {
        const availH = H - 0.72 - 0.35;
        const rowH   = Math.min(availH / points.length, 0.84);
        points.forEach((p, pi) => {
          const rowY = 0.84 + pi * rowH;
          if (pi % 2 === 0) s.addShape(pptx.ShapeType.rect, { x: 0.25, y: rowY - 0.04, w: txtW, h: rowH - 0.04, fill: { color: LGRAY }, line: { color: LGRAY, width: 0 } });
          s.addShape(pptx.ShapeType.ellipse, { x: 0.35, y: rowY + rowH * 0.5 - 0.07, w: 0.14, h: 0.14, fill: { color: ACC }, line: { color: ACC, width: 0 } });
          s.addText(p, { x: 0.61, y: rowY, w: txtW - 0.48, h: rowH, fontSize: 11, color: TEXTC, align: 'left', valign: 'middle', wrap: true, paraSpaceAfter: 0 });
        });
      }
      s.addText(title, { x: 0.25, y: H - 0.30, w: W - 0.50, h: 0.26, fontSize: 7, color: MGRAY, align: 'left', valign: 'middle' });

    } else {
      // clean: header band sutil + texto full-width
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

      if (points.length > 0) {
        const availH = H - 0.86 - 0.32;
        const rowH   = Math.min(availH / points.length, 0.84);
        points.forEach((p, pi) => {
          const rowY = 0.86 + pi * rowH;
          s.addShape(pptx.ShapeType.ellipse, { x: 0.32, y: rowY + rowH * 0.5 - 0.06, w: 0.12, h: 0.12, fill: { color: ACC }, line: { color: ACC, width: 0 } });
          s.addText(p, { x: 0.56, y: rowY, w: W - 0.78, h: rowH, fontSize: 11, color: TEXTC, align: 'left', valign: 'middle', wrap: true, paraSpaceAfter: 0 });
        });
      }
      s.addText(title, { x: 0.25, y: H - 0.30, w: W - 0.50, h: 0.26, fontSize: 7, color: MGRAY, align: 'left', valign: 'middle' });
    }
  });

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
