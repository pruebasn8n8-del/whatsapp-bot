// src/docGenerator.js — Generación de PDF y PPTX con diseño profesional
const PDFDocument = require('pdfkit');
const PptxGenJS   = require('pptxgenjs');

// ─────────────────────────────────────────────────────────────────────────────
// Paleta de colores
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  primary:   '#0f3460',
  accent:    '#e94560',
  dark:      '#16213e',
  darkest:   '#0a0a1a',
  white:     '#ffffff',
  lightGray: '#e8eaf6',
  midGray:   '#90a4ae',
  text:      '#263238',
  textLight: '#546e7a',
};

// ─────────────────────────────────────────────────────────────────────────────
// PDF — diseño profesional con portada, índice y secciones estilizadas
// ─────────────────────────────────────────────────────────────────────────────
function generatePDF(title, sections = []) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      margin: 0,
      size: 'A4',
      bufferPages: true,
      info: { Title: title, Author: 'Cortana — @andrewhypervenom', Creator: 'Cortana Bot' },
    });

    doc.on('data',  c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;   // 595
    const H = doc.page.height;  // 842
    const ML = 55, MR = 55, CONTENT_W = W - ML - MR;

    // ── PORTADA ────────────────────────────────────────────────────────────
    // Fondo degradado simulado con rectángulos
    doc.rect(0, 0, W, H).fill(C.darkest);
    doc.rect(0, 0, W, H * 0.55).fill(C.dark);

    // Franja de acento
    doc.rect(0, H * 0.55, W, 5).fill(C.accent);

    // Línea decorativa izquierda
    doc.rect(ML - 20, 80, 4, 120).fill(C.accent);

    // Título
    doc.fillColor(C.white)
       .font('Helvetica-Bold')
       .fontSize(32)
       .text(title, ML, 90, { width: CONTENT_W, lineGap: 8 });

    // Subtítulo
    const titleBottom = doc.y + 20;
    doc.fillColor(C.midGray)
       .font('Helvetica')
       .fontSize(13)
       .text('Documento generado por Cortana', ML, titleBottom);

    // Fecha
    const dateStr = new Date().toLocaleDateString('es-CO', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    doc.fillColor(C.midGray)
       .fontSize(11)
       .text(dateStr, ML, doc.y + 6);

    // Resumen de contenido (índice simple en portada)
    if (sections.length > 0) {
      doc.rect(ML, H * 0.62, CONTENT_W, sections.length * 28 + 30)
         .fill('#1a2a4a');

      doc.fillColor(C.accent)
         .font('Helvetica-Bold')
         .fontSize(10)
         .text('CONTENIDO', ML + 18, H * 0.62 + 14);

      sections.forEach((sec, i) => {
        const y = H * 0.62 + 34 + i * 28;
        doc.fillColor(C.midGray)
           .font('Helvetica')
           .fontSize(10)
           .text(`${String(i + 1).padStart(2, '0')}  ${sec.heading || ''}`, ML + 18, y);
      });
    }

    // Branding footer de portada
    doc.rect(0, H - 50, W, 50).fill(C.accent);
    doc.fillColor(C.white)
       .font('Helvetica-Bold')
       .fontSize(11)
       .text('CORTANA', ML, H - 33);
    doc.fillColor(C.white)
       .font('Helvetica')
       .fontSize(9)
       .text('Bot de IA · @andrewhypervenom', ML + 76, H - 33);

    // ── PÁGINAS DE CONTENIDO ───────────────────────────────────────────────
    for (const [idx, sec] of sections.entries()) {
      doc.addPage({ margin: 0 });

      // Header de página
      doc.rect(0, 0, W, 45).fill(C.primary);
      doc.fillColor(C.white)
         .font('Helvetica-Bold')
         .fontSize(9)
         .text(title.toUpperCase(), ML, 16, { width: CONTENT_W - 60 });
      doc.fillColor(C.accent)
         .font('Helvetica-Bold')
         .fontSize(9)
         .text(`§ ${idx + 1}`, W - MR - 30, 16, { width: 30, align: 'right' });

      // Franja de sección
      doc.rect(0, 45, W, 3).fill(C.accent);

      let curY = 70;

      // Heading de sección
      if (sec.heading) {
        // Caja del heading
        doc.rect(ML - 4, curY, CONTENT_W + 8, 36).fill(C.lightGray);
        doc.rect(ML - 4, curY, 5, 36).fill(C.primary);

        doc.fillColor(C.primary)
           .font('Helvetica-Bold')
           .fontSize(15)
           .text(sec.heading, ML + 12, curY + 9, { width: CONTENT_W - 16 });
        curY += 52;
      }

      // Contenido
      if (sec.content) {
        // Dividir el contenido en párrafos
        const paragraphs = sec.content.split(/\n\n+/);
        for (const para of paragraphs) {
          const lines = para.trim();
          if (!lines) continue;

          // Detectar si es lista (empieza con - o •)
          if (/^[-•*]/.test(lines)) {
            const items = lines.split('\n').filter(l => l.trim());
            for (const item of items) {
              const clean = item.replace(/^[-•*]\s*/, '').trim();
              doc.fillColor(C.accent)
                 .font('Helvetica-Bold')
                 .fontSize(11)
                 .text('▸', ML, curY);
              doc.fillColor(C.text)
                 .font('Helvetica')
                 .fontSize(11)
                 .text(clean, ML + 16, curY, { width: CONTENT_W - 16, lineGap: 3 });
              curY = doc.y + 6;
            }
          } else {
            doc.fillColor(C.text)
               .font('Helvetica')
               .fontSize(11)
               .text(lines, ML, curY, { width: CONTENT_W, align: 'justify', lineGap: 4 });
            curY = doc.y + 14;
          }

          if (curY > H - 100) {
            doc.addPage({ margin: 0 });
            doc.rect(0, 0, W, 45).fill(C.primary);
            doc.fillColor(C.white)
               .font('Helvetica-Bold')
               .fontSize(9)
               .text(title.toUpperCase(), ML, 16, { width: CONTENT_W - 60 });
            doc.rect(0, 45, W, 3).fill(C.accent);
            curY = 70;
          }
        }
      }
    }

    // ── FOOTER EN TODAS LAS PÁGINAS (excepto portada) ─────────────────────
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = 1; i < total; i++) {
      doc.switchToPage(range.start + i);
      doc.rect(0, H - 32, W, 32).fill(C.darkest);
      doc.fillColor(C.midGray)
         .font('Helvetica')
         .fontSize(8)
         .text(`${title}  ·  Generado por Cortana`, ML, H - 20, { width: CONTENT_W - 50 });
      doc.fillColor(C.accent)
         .font('Helvetica-Bold')
         .fontSize(9)
         .text(`${i} / ${total - 1}`, W - MR, H - 20, { width: 40, align: 'right' });
    }

    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PPTX — diseño oscuro con portada, slides de contenido y slide final
// ─────────────────────────────────────────────────────────────────────────────
async function generatePPTX(title, slides = []) {
  const pptx = new PptxGenJS();
  pptx.layout  = 'LAYOUT_16x9';
  pptx.author  = 'Cortana Bot';
  pptx.subject = title;
  pptx.title   = title;

  const BG     = '0a0a1a';
  const DARK   = '16213e';
  const PRI    = '0f3460';
  const ACC    = 'e94560';
  const WHITE  = 'ffffff';
  const GRAY   = '90a4ae';
  const LGRAY  = 'e8eaf6';
  const W = 10, H = 5.63; // pulgadas 16:9

  // ── PORTADA ──────────────────────────────────────────────────────────────
  const cover = pptx.addSlide();
  cover.background = { color: BG };

  // Rectángulo izquierdo decorativo
  cover.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.18, h: H, fill: { color: ACC },
  });

  // Rectángulo superior
  cover.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 0.08, fill: { color: ACC },
  });

  // Caja de fondo del título
  cover.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 0.9, w: 9, h: 2.6, fill: { color: DARK }, line: { color: PRI, width: 1 },
  });

  // Título
  cover.addText(title, {
    x: 0.7, y: 1.0, w: 8.6, h: 2.4,
    fontSize: 36, bold: true, color: WHITE,
    align: 'center', valign: 'middle', wrap: true,
    shadow: { type: 'outer', color: ACC, blur: 8, offset: 2, angle: 45 },
  });

  // Línea separadora
  cover.addShape(pptx.ShapeType.rect, {
    x: 2.5, y: 3.7, w: 5, h: 0.05, fill: { color: ACC },
  });

  // Subtítulo
  cover.addText('Generado por Cortana · @andrewhypervenom', {
    x: 0.5, y: 3.85, w: 9, h: 0.45,
    fontSize: 12, color: GRAY, align: 'center', italic: true,
  });

  // Fecha
  const dateStr = new Date().toLocaleDateString('es-CO', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  cover.addText(dateStr, {
    x: 0.5, y: 4.4, w: 9, h: 0.4,
    fontSize: 10, color: GRAY, align: 'center',
  });

  // Número de slides
  cover.addText(`${slides.length} secciones`, {
    x: 0.5, y: 4.9, w: 9, h: 0.3,
    fontSize: 10, color: ACC, bold: true, align: 'center',
  });

  // ── SLIDES DE CONTENIDO ───────────────────────────────────────────────────
  slides.forEach((slide, idx) => {
    const s = pptx.addSlide();
    s.background = { color: BG };

    // Header bar
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: W, h: 1.0, fill: { color: PRI },
    });
    // Acento izquierdo
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 0.12, h: H, fill: { color: ACC },
    });
    // Línea debajo del header
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 1.0, w: W, h: 0.05, fill: { color: ACC },
    });

    // Número de slide
    s.addShape(pptx.ShapeType.rect, {
      x: W - 0.9, y: 0, w: 0.9, h: 1.0, fill: { color: ACC },
    });
    s.addText(`${String(idx + 1).padStart(2, '0')}`, {
      x: W - 0.9, y: 0, w: 0.9, h: 1.0,
      fontSize: 22, bold: true, color: WHITE,
      align: 'center', valign: 'middle',
    });

    // Título del slide
    s.addText(slide.title || '', {
      x: 0.3, y: 0.08, w: W - 1.5, h: 0.84,
      fontSize: 20, bold: true, color: WHITE, valign: 'middle',
    });

    // Puntos clave
    const points = (slide.points || []);
    if (points.length) {
      const bulletRows = points.map((p, pi) => ([
        {
          text: `${pi + 1}`,
          options: {
            color: ACC, bold: true, fontSize: 13,
            align: 'center',
          },
        },
        {
          text: `  ${p}`,
          options: { color: LGRAY, fontSize: 14 },
        },
      ]));

      // Calcular altura disponible por punto
      const availH = H - 1.25;
      const rowH   = Math.min(availH / points.length, 0.7);

      points.forEach((p, pi) => {
        const rowY = 1.2 + pi * (rowH + 0.08);

        // Fondo alterno
        if (pi % 2 === 0) {
          s.addShape(pptx.ShapeType.rect, {
            x: 0.22, y: rowY - 0.06, w: W - 0.35, h: rowH + 0.04,
            fill: { color: DARK }, line: { color: PRI, width: 0.5 },
          });
        }

        // Número del punto
        s.addShape(pptx.ShapeType.rect, {
          x: 0.22, y: rowY - 0.06, w: 0.38, h: rowH + 0.04,
          fill: { color: ACC },
        });
        s.addText(`${pi + 1}`, {
          x: 0.22, y: rowY - 0.06, w: 0.38, h: rowH + 0.04,
          fontSize: 12, bold: true, color: WHITE,
          align: 'center', valign: 'middle',
        });

        // Texto del punto
        s.addText(p, {
          x: 0.7, y: rowY, w: W - 0.95, h: rowH,
          fontSize: 13, color: LGRAY, valign: 'middle', wrap: true,
        });
      });
    }

    // Pie de slide
    s.addText(title, {
      x: 0.22, y: H - 0.3, w: W - 0.5, h: 0.25,
      fontSize: 8, color: GRAY, align: 'left',
    });
  });

  // ── SLIDE FINAL ───────────────────────────────────────────────────────────
  const end = pptx.addSlide();
  end.background = { color: BG };
  end.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: H, fill: { color: ACC } });
  end.addShape(pptx.ShapeType.rect, { x: 0, y: H * 0.5, w: W, h: 0.05, fill: { color: ACC } });

  end.addText('Gracias', {
    x: 0.5, y: 1.2, w: 9, h: 1.5,
    fontSize: 52, bold: true, color: WHITE, align: 'center',
  });
  end.addText('Presentación generada por Cortana', {
    x: 0.5, y: 3.2, w: 9, h: 0.5,
    fontSize: 14, color: GRAY, align: 'center', italic: true,
  });
  end.addText('@andrewhypervenom', {
    x: 0.5, y: 3.8, w: 9, h: 0.4,
    fontSize: 12, color: ACC, bold: true, align: 'center',
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
