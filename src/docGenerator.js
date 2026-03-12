// src/docGenerator.js — Generación de PDF y PPTX desde estructura JSON
const PDFDocument = require('pdfkit');
const PptxGenJS   = require('pptxgenjs');

// ──────────────────────────────────────────────────────────
// PDF  — título + secciones con heading y contenido
// ──────────────────────────────────────────────────────────
function generatePDF(title, sections = []) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 60, size: 'A4' });

    doc.on('data',  chunk => chunks.push(chunk));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Encabezado ──
    doc
      .rect(0, 0, doc.page.width, 90)
      .fill('#1a1a2e');

    doc
      .fillColor('#ffffff')
      .fontSize(22)
      .font('Helvetica-Bold')
      .text(title, 60, 28, { width: doc.page.width - 120 });

    doc.moveDown(3);

    // ── Secciones ──
    for (const sec of sections) {
      if (sec.heading) {
        doc
          .fillColor('#1a1a2e')
          .fontSize(13)
          .font('Helvetica-Bold')
          .text(sec.heading, { paragraphGap: 4 });

        doc
          .moveTo(doc.x, doc.y)
          .lineTo(doc.page.width - 60, doc.y)
          .strokeColor('#1a1a2e')
          .lineWidth(0.5)
          .stroke();

        doc.moveDown(0.4);
      }

      if (sec.content) {
        doc
          .fillColor('#333333')
          .fontSize(11)
          .font('Helvetica')
          .text(sec.content, { align: 'justify', lineGap: 3 });
        doc.moveDown(1.2);
      }

      // Check space — nueva página si queda poco
      if (doc.y > doc.page.height - 100) doc.addPage();
    }

    // ── Pie de página ──
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i);
      doc
        .fillColor('#999999')
        .fontSize(8)
        .font('Helvetica')
        .text(
          `Generado por Cortana • Página ${i + 1} de ${pages.count}`,
          60,
          doc.page.height - 35,
          { align: 'center', width: doc.page.width - 120 },
        );
    }

    doc.end();
  });
}

// ──────────────────────────────────────────────────────────
// PPTX — título + slides con título y puntos clave
// ──────────────────────────────────────────────────────────
async function generatePPTX(title, slides = []) {
  const pptx = new PptxGenJS();
  pptx.layout  = 'LAYOUT_16x9';
  pptx.author  = 'Cortana Bot';
  pptx.subject = title;

  const BG      = '1a1a2e';
  const ACCENT  = '0f3460';
  const WHITE   = 'ffffff';
  const GRAY    = 'cccccc';

  // ── Portada ──
  const cover = pptx.addSlide();
  cover.background = { color: BG };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 3.2, w: '100%', h: 0.06, fill: { color: ACCENT } });
  cover.addText(title, {
    x: 0.6, y: 1.4, w: 8.8, h: 1.6,
    fontSize: 36, bold: true, color: WHITE,
    align: 'center', valign: 'middle', wrap: true,
  });
  cover.addText('Generado por Cortana', {
    x: 0.6, y: 3.8, w: 8.8, h: 0.5,
    fontSize: 13, color: GRAY, align: 'center',
  });

  // ── Slides de contenido ──
  for (const slide of slides) {
    const s = pptx.addSlide();
    s.background = { color: BG };

    // Barra superior
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.9, fill: { color: ACCENT } });

    // Título del slide
    s.addText(slide.title || '', {
      x: 0.3, y: 0.08, w: 9.4, h: 0.75,
      fontSize: 20, bold: true, color: WHITE, valign: 'middle',
    });

    // Puntos clave
    const points = (slide.points || []).map(p => ({
      text: p,
      options: { bullet: { type: 'bullet' }, color: GRAY, fontSize: 16, paraSpaceAfter: 8 },
    }));

    if (points.length) {
      s.addText(points, {
        x: 0.5, y: 1.1, w: 8.8, h: 4.6,
        valign: 'top', lineSpacingMultiple: 1.3,
      });
    }
  }

  // Devolver como Buffer
  const data = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(data);
}

// ──────────────────────────────────────────────────────────
// Detección de intención de documento
// ──────────────────────────────────────────────────────────
const ACTION_RE   = /\b(crea|cre[ao]|haz|hazme|genera|generar|genera[rm]e|realiza|dame|necesito|quiero|hacer|elabora|prepara|arma|produce)\b/i;
const PDF_RE      = /\bpdf\b/i;
const PPT_RE      = /\b(ppt|pptx|powerpoint|presentaci[oó]n|diapositiva[s]?)\b/i;
const DOC_RE      = /\b(documento|informe|reporte|resum[ei]n\s+ejecutivo|ensayo|propuesta|plan|manual|guía|guia)\b/i;

/**
 * Detecta si el texto es una petición de documento.
 * Retorna 'pdf' | 'pptx' | null
 */
function detectDocumentRequest(text) {
  const t = text.toLowerCase();
  const hasAction = ACTION_RE.test(t);

  if (hasAction && PPT_RE.test(t)) return 'pptx';
  if (PPT_RE.test(t)) return 'pptx'; // "presentación sobre X" sin verbo

  if (hasAction && (PDF_RE.test(t) || DOC_RE.test(t))) return 'pdf';
  if (PDF_RE.test(t) && DOC_RE.test(t)) return 'pdf'; // "un pdf del reporte"

  return null;
}

module.exports = { generatePDF, generatePPTX, detectDocumentRequest };
