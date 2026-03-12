// src/docGenerator.js — Generación de PDF y PPTX con diseño minimalista moderno
'use strict';

const PDFDocument = require('pdfkit');
const PptxGenJS   = require('pptxgenjs');

// ─────────────────────────────────────────────────────────────────────────────
// Temas adaptativos por tópico
// ─────────────────────────────────────────────────────────────────────────────
const THEMES = {
  tech:       { primary: '#0ea5e9', accent: '#06b6d4', dark: '#0c1929', bg: '#f0f9ff', name: 'tech' },
  nature:     { primary: '#10b981', accent: '#059669', dark: '#022c22', bg: '#f0fdf4', name: 'nature' },
  finance:    { primary: '#1e40af', accent: '#f59e0b', dark: '#0f172a', bg: '#f8fafc', name: 'finance' },
  health:     { primary: '#0d9488', accent: '#14b8a6', dark: '#042f2e', bg: '#f0fdfa', name: 'health' },
  education:  { primary: '#7c3aed', accent: '#8b5cf6', dark: '#1e1b4b', bg: '#faf5ff', name: 'education' },
  creative:   { primary: '#db2777', accent: '#ec4899', dark: '#500724', bg: '#fdf2f8', name: 'creative' },
  sports:     { primary: '#ea580c', accent: '#f97316', dark: '#431407', bg: '#fff7ed', name: 'sports' },
  default:    { primary: '#4f46e5', accent: '#818cf8', dark: '#1e1b4b', bg: '#f5f3ff', name: 'default' },
};

const THEME_KEYWORDS = {
  tech:      /\b(tecnolog|software|program|código|ia|inteligencia|artificial|web|app|digital|sistem|comput|datos|red|ciberseg|robót|automat|machine|learning|cloud|nube|desarrollo|devops|api|servidor|hardware|microchip|crypto|blockchain)\b/i,
  nature:    /\b(naturalez|medioambiente|ecolog|climat|sostenib|verde|bosque|animal|biodiversidad|agua|océano|suelo|planta|ecosistem|renovable|carbon|reciclaje|fauna|flora|orgánico|sustentab)\b/i,
  finance:   /\b(finanz|dinero|inversión|presupuesto|economía|banco|mercado|bolsa|accion|capital|crédit|deuda|ahorro|impuest|rentabilidad|forex|trading|criptomoneda|patrimonio|contabilidad|fiscal)\b/i,
  health:    /\b(salud|medicina|médic|hospital|bienestar|nutrición|ejercicio|dieta|enfermedad|tratamiento|paciente|clínica|farmac|mental|terapia|deporte|fitness|cuerpo|cirugía|diagnóst)\b/i,
  education: /\b(educación|aprendizaje|escuela|universidad|curso|estudio|enseñanza|académic|ciencia|investigación|conocimiento|alumno|profesor|capacitación|taller|seminario|graduación|certificación|pedagogía)\b/i,
  creative:  /\b(arte|diseño|música|fotografía|cine|moda|creativ|cultura|literatur|poesía|pintura|escultura|danza|teatro|publicidad|branding|ilustración|animación|contenido|marketing)\b/i,
  sports:    /\b(deporte|fútbol|baloncesto|tenis|atletism|competencia|equipo|jugador|entrenamiento|campeón|liga|torneo|olímpic|rugby|natación|ciclismo|maratón|boxeo|gym|fuerza)\b/i,
};

function getTheme(title) {
  const text = (title || '').toLowerCase();
  for (const [key, regex] of Object.entries(THEME_KEYWORDS)) {
    if (regex.test(text)) return THEMES[key];
  }
  return THEMES.default;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch de imagen de portada desde Unsplash Source
// ─────────────────────────────────────────────────────────────────────────────
async function fetchCoverImage(keyword) {
  try {
    const kw  = encodeURIComponent((keyword || 'minimal abstract').replace(/\s+/g, ','));
    const url = `https://source.unsplash.com/featured/1400x900/?${kw},minimal`;

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal:   controller.signal,
      redirect: 'follow',
      headers:  { 'User-Agent': 'CortanaBot/1.0' },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 4096 ? buf : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

/** Extrae keyword principal del título para la imagen */
function titleToKeyword(title) {
  const stop = new Set(['de','del','la','el','los','las','un','una','para','con','en','por','que','y','a','o','e']);
  const words = (title || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stop.has(w));
  return words.slice(0, 3).join(',') || 'minimal abstract';
}

/** Fecha formateada en español */
function fmtDate() {
  return new Date().toLocaleDateString('es-CO', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** Strip hex # */
function hex(c) { return c.replace('#', ''); }

// ─────────────────────────────────────────────────────────────────────────────
// PDF — diseño minimalista moderno
// ─────────────────────────────────────────────────────────────────────────────
async function generatePDF(title, sections = []) {
  const theme   = getTheme(title);
  const keyword = titleToKeyword(title);

  // Fetch portada + imágenes de cada sección en paralelo
  const [imgBuf, ...sectionImgsBuf] = await Promise.all([
    fetchCoverImage(keyword),
    ...sections.map(sec => fetchCoverImage(sec.heading || keyword)),
  ]);

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      margin:      0,
      size:        'A4',
      bufferPages: true,
      info: {
        Title:   title,
        Author:  'Cortana — @andrewhypervenom',
        Creator: 'Cortana Bot',
      },
    });

    doc.on('data',  c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W  = doc.page.width;   // 595
    const H  = doc.page.height;  // 842
    const ML = 60, MR = 60;
    const CONTENT_W = W - ML - MR;

    // ── PORTADA ──────────────────────────────────────────────────────────────
    // Fondo base oscuro
    doc.rect(0, 0, W, H).fill(theme.dark);

    // Imagen full-bleed (si disponible)
    if (imgBuf) {
      try {
        doc.image(imgBuf, 0, 0, { width: W, height: H, cover: [W, H] });
      } catch { /* imagen inválida, ignorar */ }

      // Overlay semi-transparente sobre la imagen
      doc.save();
      doc.fillOpacity(0.72);
      doc.rect(0, 0, W, H).fill(theme.dark);
      doc.restore();
    } else {
      // Degradado simulado sin imagen
      // Bloque superior más oscuro
      doc.save();
      doc.fillOpacity(1);
      doc.rect(0, 0, W, H * 0.6).fill(theme.dark);
      doc.restore();

      doc.save();
      doc.fillOpacity(0.55);
      doc.rect(0, H * 0.6, W, H * 0.4).fill(theme.primary);
      doc.restore();
    }

    // Franja vertical de acento — izquierda
    doc.save();
    doc.fillOpacity(1);
    doc.rect(0, 0, 5, H).fill(theme.accent);
    doc.restore();

    // Círculo decorativo sutil — esquina superior derecha
    doc.save();
    doc.fillOpacity(0.06);
    doc.circle(W + 60, -60, 240).fill(theme.primary);
    doc.restore();

    doc.save();
    doc.fillOpacity(0.04);
    doc.circle(W + 20, -20, 160).fill(theme.accent);
    doc.restore();

    // Tagline encima del título
    const TAG_Y = H * 0.28;
    doc.fillColor('#ffffff')
       .fillOpacity(0.45)
       .font('Helvetica')
       .fontSize(9)
       .text('DOCUMENTO GENERADO POR CORTANA', ML + 4, TAG_Y, {
         width:         CONTENT_W,
         characterSpacing: 2,
       });

    // Línea decorativa fina sobre el título
    doc.save();
    doc.fillOpacity(1);
    doc.rect(ML + 4, TAG_Y + 18, 36, 1.5).fill(theme.accent);
    doc.restore();

    // Título principal grande
    const TITLE_Y = TAG_Y + 34;
    doc.fillColor('#ffffff')
       .fillOpacity(1)
       .font('Helvetica-Bold')
       .fontSize(34)
       .text(title, ML + 4, TITLE_Y, {
         width:   CONTENT_W,
         lineGap: 6,
       });

    // Fecha y subtítulo
    const after = doc.y + 22;
    doc.fillColor('#ffffff')
       .fillOpacity(0.55)
       .font('Helvetica')
       .fontSize(10)
       .text(fmtDate(), ML + 4, after);

    doc.fillColor('#ffffff')
       .fillOpacity(0.4)
       .font('Helvetica')
       .fontSize(9)
       .text('Cortana · @andrewhypervenom', ML + 4, doc.y + 5);

    // Índice de contenidos en la parte baja de la portada
    if (sections.length > 0) {
      const TOC_Y = H * 0.70;

      // Línea separadora
      doc.save();
      doc.fillOpacity(0.18);
      doc.rect(ML + 4, TOC_Y - 10, CONTENT_W, 0.5).fill('#ffffff');
      doc.restore();

      doc.fillColor('#ffffff')
         .fillOpacity(0.35)
         .font('Helvetica')
         .fontSize(8)
         .text('CONTENIDO', ML + 4, TOC_Y, { characterSpacing: 2 });

      sections.slice(0, 8).forEach((sec, i) => {
        const sy = TOC_Y + 18 + i * 21;
        // Número pequeño en acento
        doc.fillColor(theme.accent)
           .fillOpacity(0.9)
           .font('Helvetica-Bold')
           .fontSize(8)
           .text(String(i + 1).padStart(2, '0'), ML + 4, sy);
        // Título de sección
        doc.fillColor('#ffffff')
           .fillOpacity(0.65)
           .font('Helvetica')
           .fontSize(9)
           .text(sec.heading || '', ML + 22, sy, {
             width: CONTENT_W - 22,
             ellipsis: true,
           });
      });
    }

    // ── PÁGINAS DE CONTENIDO — diseño website/app ────────────────────────────
    for (const [idx, sec] of sections.entries()) {
      doc.addPage({ margin: 0 });

      const pW   = doc.page.width;
      const pH   = doc.page.height;
      const pCW  = pW - ML - MR;
      const IMG_H    = Math.round(pH * 0.38);   // hero image: 38% de la página
      const FOOTER_H = 34;
      const CARD_Y   = IMG_H + 14;
      const CARD_H   = pH - CARD_Y - FOOTER_H - 10;
      const secImg   = sectionImgsBuf[idx] || null;

      // ── Fondo de página con color del tema
      doc.fillOpacity(1);
      doc.rect(0, 0, pW, pH).fill(theme.bg);

      // ── Hero image / bloque de sección (top 38%)
      if (secImg) {
        try {
          doc.save();
          doc.rect(0, 0, pW, IMG_H).clip();
          doc.image(secImg, 0, 0, { width: pW });
          doc.restore();
        } catch {
          doc.rect(0, 0, pW, IMG_H).fill(theme.primary);
        }
      } else {
        // Fallback: bloque de color con patrón geométrico
        doc.rect(0, 0, pW, IMG_H).fill(theme.primary);
        // Círculos decorativos
        doc.save();
        doc.fillOpacity(0.12);
        doc.circle(pW * 0.82, IMG_H * 0.3, 80).fill(theme.accent);
        doc.circle(pW * 0.92, IMG_H * 0.9, 50).fill('#ffffff');
        doc.restore();
      }

      // Overlay degradado simulado (2 capas: leve arriba, oscuro abajo)
      doc.save();
      doc.fillOpacity(0.20);
      doc.rect(0, 0, pW, IMG_H * 0.45).fill('#000000');
      doc.restore();
      doc.save();
      doc.fillOpacity(0.68);
      doc.rect(0, IMG_H * 0.45, pW, IMG_H * 0.55).fill('#000000');
      doc.restore();

      // Chip número de sección (top-right)
      doc.fillOpacity(1);
      doc.rect(pW - 54, 0, 54, 30).fill(theme.accent);
      doc.fillColor('#ffffff')
         .font('Helvetica-Bold')
         .fontSize(12)
         .text(String(idx + 1).padStart(2, '0'), pW - 54, 9, { width: 54, align: 'center' });

      // Línea de acento fina sobre el título
      doc.fillOpacity(1);
      doc.rect(ML, IMG_H - 48, 28, 2.5).fill(theme.accent);

      // Título de sección (bottom-left del hero)
      if (sec.heading) {
        doc.fillColor('#ffffff')
           .fillOpacity(1)
           .font('Helvetica-Bold')
           .fontSize(19)
           .text(sec.heading, ML, IMG_H - 42, { width: pCW - 70, lineGap: 3 });
      }

      // ── Tarjeta de contenido (card blanca flotante sobre fondo tintado)
      // Sombra simulada
      doc.save();
      doc.fillOpacity(0.07);
      doc.rect(ML + 4, CARD_Y + 4, pCW, CARD_H).fill('#000000');
      doc.restore();

      // Card blanca
      doc.fillOpacity(1);
      doc.rect(ML, CARD_Y, pCW, CARD_H).fill('#ffffff');

      // Borde izquierdo de acento (4px)
      doc.rect(ML, CARD_Y, 4, CARD_H).fill(theme.accent);

      // ── Contenido dentro de la card
      const INNER_X = ML + 18;
      const INNER_W = pCW - 28;
      const MAX_Y   = CARD_Y + CARD_H - 16;
      let curY = CARD_Y + 18;

      if (sec.content) {
        const paragraphs = sec.content.split(/\n\n+/);
        for (const para of paragraphs) {
          const lines = para.trim();
          if (!lines || curY >= MAX_Y - 10) continue;

          if (/^[-•*]/.test(lines)) {
            for (const item of lines.split('\n').filter(l => l.trim())) {
              if (curY >= MAX_Y - 10) break;
              const clean = item.replace(/^[-•*]\s*/, '').trim();
              doc.fillColor(theme.accent).fillOpacity(1)
                 .circle(INNER_X - 8, curY + 5.5, 2.5).fill();
              doc.fillColor('#374151').fillOpacity(1)
                 .font('Helvetica').fontSize(10)
                 .text(clean, INNER_X, curY, { width: INNER_W, align: 'justify', lineGap: 3 });
              curY = Math.min(doc.y + 6, MAX_Y);
            }
          } else {
            doc.fillColor('#374151').fillOpacity(1)
               .font('Helvetica').fontSize(10.5)
               .text(lines, INNER_X, curY, { width: INNER_W, align: 'justify', lineGap: 4 });
            curY = Math.min(doc.y + 12, MAX_Y);
          }
        }
      }

      // ── Footer
      doc.fillOpacity(1);
      doc.rect(0, pH - FOOTER_H, pW, 1).fill(theme.primary);
      doc.save();
      doc.fillOpacity(0.06);
      doc.rect(0, pH - FOOTER_H + 1, pW, FOOTER_H - 1).fill(theme.primary);
      doc.restore();
      doc.fillColor(theme.primary).fillOpacity(0.7)
         .font('Helvetica').fontSize(7.5)
         .text(title.substring(0, 55), ML, pH - FOOTER_H + 10);
      doc.fillColor(theme.accent).fillOpacity(1)
         .font('Helvetica-Bold').fontSize(9)
         .text(String(idx + 2), pW - MR, pH - FOOTER_H + 10, { width: MR - 5, align: 'right' });
    }

    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PPTX — diseño minimalista moderno
// ─────────────────────────────────────────────────────────────────────────────
async function generatePPTX(title, slides = []) {
  const theme   = getTheme(title);
  const keyword = titleToKeyword(title);
  const imgBuf  = await fetchCoverImage(keyword);

  // Convertir imagen a base64 data URL para pptxgenjs
  let coverDataUrl = null;
  if (imgBuf) {
    try {
      coverDataUrl = 'data:image/jpeg;base64,' + imgBuf.toString('base64');
    } catch { coverDataUrl = null; }
  }

  const pptx = new PptxGenJS();
  pptx.layout  = 'LAYOUT_16x9';
  pptx.author  = 'Cortana Bot';
  pptx.subject = title;
  pptx.title   = title;

  const W  = 10;      // pulgadas 16:9
  const H  = 5.625;

  // Colores sin # para pptxgenjs
  const PRI  = hex(theme.primary);
  const ACC  = hex(theme.accent);
  const DARK = hex(theme.dark);
  const BG   = hex(theme.bg);
  const WHITE = 'FFFFFF';
  const LGRAY = 'F3F4F6';
  const MGRAY = '9CA3AF';
  const TEXTC = '1F2937';

  // ── PORTADA ───────────────────────────────────────────────────────────────
  const cover = pptx.addSlide();

  if (coverDataUrl) {
    // Imagen full-bleed
    cover.addImage({
      data: coverDataUrl,
      x: 0, y: 0, w: W, h: H,
    });
    // Overlay oscuro semi-transparente (transparency: 0–100, donde 100=invisible)
    cover.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: W, h: H,
      fill: { color: DARK, transparency: 45 },
      line: { color: DARK, width: 0 },
    });
  } else {
    // Fondo sólido oscuro sin imagen
    cover.background = { color: DARK };

    // Círculo decorativo sutil
    cover.addShape(pptx.ShapeType.ellipse, {
      x: W * 0.68, y: -0.8, w: 3.5, h: 3.5,
      fill: { color: PRI, transparency: 88 },
      line: { color: PRI, width: 0 },
    });
    cover.addShape(pptx.ShapeType.ellipse, {
      x: W * 0.78, y: -0.2, w: 2.2, h: 2.2,
      fill: { color: ACC, transparency: 85 },
      line: { color: ACC, width: 0 },
    });
  }

  // Franja vertical izquierda (acento) — 10% del ancho
  cover.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W * 0.1, h: H,
    fill: { color: ACC },
    line: { color: ACC, width: 0 },
  });

  // Línea fina horizontal sobre el título
  cover.addShape(pptx.ShapeType.rect, {
    x: W * 0.14, y: H * 0.36,
    w: 0.5, h: 0.04,
    fill: { color: ACC },
    line: { color: ACC, width: 0 },
  });

  // Etiqueta "DOCUMENTO" sobre el título
  cover.addText('GENERADO POR CORTANA', {
    x: W * 0.13, y: H * 0.24, w: W * 0.75, h: 0.28,
    fontSize: 7.5, color: WHITE, bold: false,
    charSpacing: 2.5, align: 'left', valign: 'middle',
    transparency: 45,
  });

  // Título grande centrado (desplazado a la derecha de la franja)
  cover.addText(title, {
    x: W * 0.13, y: H * 0.30, w: W * 0.80, h: H * 0.45,
    fontSize: 34, bold: true, color: WHITE,
    align: 'left', valign: 'middle', wrap: true,
    paraSpaceAfter: 0,
  });

  // Fecha + subtítulo
  cover.addText(`${fmtDate()}  ·  Cortana @andrewhypervenom`, {
    x: W * 0.13, y: H * 0.76, w: W * 0.76, h: 0.35,
    fontSize: 9.5, color: WHITE, align: 'left',
    transparency: 38,
  });

  // Contador de secciones en el acento
  cover.addText(`${slides.length}`, {
    x: 0, y: H * 0.42, w: W * 0.1, h: 0.4,
    fontSize: 18, bold: true, color: WHITE,
    align: 'center', valign: 'middle',
  });
  cover.addText('secciones', {
    x: 0, y: H * 0.56, w: W * 0.1, h: 0.28,
    fontSize: 7, color: WHITE, align: 'center',
    transparency: 25,
  });

  // ── SLIDES DE CONTENIDO ───────────────────────────────────────────────────
  slides.forEach((slide, idx) => {
    const s = pptx.addSlide();
    s.background = { color: WHITE };

    // Barra superior de color primario (0.75 pulgadas)
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: W, h: 0.75,
      fill: { color: PRI },
      line: { color: PRI, width: 0 },
    });

    // Chip del número de sección — esquina superior derecha dentro de la barra
    s.addShape(pptx.ShapeType.rect, {
      x: W - 0.85, y: 0, w: 0.85, h: 0.75,
      fill: { color: ACC },
      line: { color: ACC, width: 0 },
    });
    s.addText(String(idx + 1).padStart(2, '0'), {
      x: W - 0.85, y: 0, w: 0.85, h: 0.75,
      fontSize: 18, bold: true, color: WHITE,
      align: 'center', valign: 'middle',
    });

    // Título de la slide dentro de la barra
    s.addText(slide.title || '', {
      x: 0.28, y: 0, w: W - 1.25, h: 0.75,
      fontSize: 17, bold: true, color: WHITE,
      align: 'left', valign: 'middle', wrap: true,
    });

    // Puntos con dot decorativo en acento
    const points = slide.points || [];
    if (points.length > 0) {
      const availH  = H - 0.75 - 0.35;  // barra + footer
      const rowH    = Math.min(availH / points.length, 0.82);
      const startY  = 0.88;

      points.forEach((p, pi) => {
        const rowY = startY + pi * rowH;

        // Fondo alterno muy sutil
        if (pi % 2 === 0) {
          s.addShape(pptx.ShapeType.rect, {
            x: 0.22, y: rowY - 0.04, w: W - 0.36, h: rowH - 0.04,
            fill: { color: LGRAY },
            line: { color: LGRAY, width: 0 },
          });
        }

        // Dot acento
        s.addShape(pptx.ShapeType.ellipse, {
          x: 0.32, y: rowY + rowH * 0.5 - 0.07,
          w: 0.14, h: 0.14,
          fill: { color: ACC },
          line: { color: ACC, width: 0 },
        });

        // Texto del punto
        s.addText(p, {
          x: 0.58, y: rowY, w: W - 0.80, h: rowH,
          fontSize: 11.5, color: TEXTC,
          align: 'left', valign: 'middle', wrap: true,
          paraSpaceAfter: 0,
        });
      });
    }

    // Footer: título del documento en gris
    s.addText(title, {
      x: 0.28, y: H - 0.3, w: W - 0.56, h: 0.28,
      fontSize: 7.5, color: MGRAY, align: 'left', valign: 'middle',
    });
  });

  // ── SLIDE FINAL "Thank you" ───────────────────────────────────────────────
  const end = pptx.addSlide();

  if (coverDataUrl) {
    end.addImage({
      data: coverDataUrl,
      x: 0, y: 0, w: W, h: H,
    });
    end.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: W, h: H,
      fill: { color: DARK, transparency: 45 },
      line: { color: DARK, width: 0 },
    });
  } else {
    end.background = { color: DARK };
    end.addShape(pptx.ShapeType.ellipse, {
      x: -0.5, y: H * 0.55, w: 3, h: 3,
      fill: { color: PRI, transparency: 88 },
      line: { color: PRI, width: 0 },
    });
  }

  // Franja izquierda igual que portada
  end.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W * 0.1, h: H,
    fill: { color: ACC },
    line: { color: ACC, width: 0 },
  });

  // "Gracias" grande
  end.addText('Gracias', {
    x: W * 0.13, y: H * 0.18, w: W * 0.78, h: H * 0.46,
    fontSize: 54, bold: true, color: WHITE,
    align: 'left', valign: 'middle',
  });

  // Línea decorativa fina
  end.addShape(pptx.ShapeType.rect, {
    x: W * 0.13, y: H * 0.70, w: 0.5, h: 0.04,
    fill: { color: ACC },
    line: { color: ACC, width: 0 },
  });

  end.addText('Presentación generada por Cortana · @andrewhypervenom', {
    x: W * 0.13, y: H * 0.74, w: W * 0.75, h: 0.35,
    fontSize: 10, color: WHITE,
    align: 'left', transparency: 38,
  });

  const data = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Detección de tipo de documento con IA
// ─────────────────────────────────────────────────────────────────────────────
async function detectDocumentRequest(text, groqService) {
  if (!/\b(crea|haz|hazme|genera|realiza|dame|necesito|quiero|hacer|elabora|prepara|arma|produce|documento|informe|reporte|presentaci|diapositiva|pdf|ppt|power\s*point|slide|ensayo|propuesta|plan|manual|guía)\b/i.test(text)) {
    return null;
  }

  try {
    const res = await groqService.client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{
        role: 'user',
        content: `¿El siguiente mensaje es una petición para crear un documento? Si es PDF o documento de texto responde "pdf", si es PowerPoint/presentación/diapositivas responde "pptx", si no es ninguno responde "no".\n\nMensaje: "${text}"\n\nResponde SOLO con: pdf, pptx, o no`,
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
