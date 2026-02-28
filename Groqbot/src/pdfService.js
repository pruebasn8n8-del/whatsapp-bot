// Groqbot/src/pdfService.js
// Generación de PDF usando pdfkit (puro JavaScript, sin binarios nativos).
// Convierte contenido Markdown simplificado a PDF formateado.

let PDFDocument = null;
try {
  PDFDocument = require('pdfkit');
} catch (_) {
  console.warn('[PDF] pdfkit no instalado. PDF deshabilitado.');
}

const isPdfAvailable = () => PDFDocument !== null;

/**
 * Limpia símbolos Markdown para texto plano en el PDF.
 */
function _cleanMd(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/```[\s\S]*?```/gm, '')
    .trim();
}

/**
 * Genera un PDF a partir de contenido Markdown simplificado.
 * @param {string} title - Título del documento
 * @param {string} markdownContent - Contenido en Markdown
 * @returns {Promise<Buffer>} - Buffer del PDF generado
 */
async function generatePdf(title, markdownContent) {
  if (!PDFDocument) throw new Error('pdfkit no está instalado. Instala con: npm install pdfkit');

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 60, left: 65, right: 65 },
        info: { Title: title, Author: 'Cortana', Creator: 'whatsapp-bot' },
      });

      const buffers = [];
      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const W = doc.page.width - 130; // ancho útil

      // ---- Encabezado ----
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a1a2e')
        .text(title, { align: 'center', width: W });
      doc.moveDown(0.3);

      doc.fontSize(9).font('Helvetica').fillColor('#999999')
        .text(
          new Date().toLocaleString('es-CO', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          }),
          { align: 'center', width: W }
        );
      doc.moveDown(0.5);

      // Línea divisora
      doc.moveTo(65, doc.y)
        .lineTo(doc.page.width - 65, doc.y)
        .strokeColor('#dddddd').lineWidth(1).stroke();
      doc.moveDown(0.8);

      // ---- Contenido ----
      doc.fontSize(11).font('Helvetica').fillColor('#222222');

      const lines = markdownContent.split('\n');
      for (const line of lines) {
        const t = line.trim();

        if (t.startsWith('# ')) {
          doc.moveDown(0.5);
          doc.fontSize(18).font('Helvetica-Bold').fillColor('#1a1a2e')
            .text(_cleanMd(t.slice(2)), { width: W });
          doc.moveDown(0.3);
          doc.fontSize(11).font('Helvetica').fillColor('#222222');

        } else if (t.startsWith('## ')) {
          doc.moveDown(0.4);
          doc.fontSize(14).font('Helvetica-Bold').fillColor('#2d4a8a')
            .text(_cleanMd(t.slice(3)), { width: W });
          doc.moveDown(0.25);
          doc.fontSize(11).font('Helvetica').fillColor('#222222');

        } else if (t.startsWith('### ')) {
          doc.moveDown(0.3);
          doc.fontSize(12).font('Helvetica-Bold').fillColor('#444444')
            .text(_cleanMd(t.slice(4)), { width: W });
          doc.moveDown(0.2);
          doc.fontSize(11).font('Helvetica').fillColor('#222222');

        } else if (t.match(/^[-•*]\s/)) {
          doc.text('• ' + _cleanMd(t.replace(/^[-•*]\s/, '')), {
            indent: 18, width: W - 18,
          });

        } else if (t.match(/^\d+\.\s/)) {
          doc.text(_cleanMd(t), { indent: 18, width: W - 18 });

        } else if (t === '') {
          doc.moveDown(0.35);

        } else if (t.startsWith('**') && t.endsWith('**') && t.length > 4) {
          doc.fontSize(11).font('Helvetica-Bold').fillColor('#333333')
            .text(_cleanMd(t), { width: W });
          doc.font('Helvetica').fillColor('#222222');

        } else {
          const clean = _cleanMd(t);
          if (clean) doc.fontSize(11).font('Helvetica').fillColor('#222222').text(clean, { width: W });
        }
      }

      // ---- Footer ----
      const footerY = doc.page.height - 48;
      doc.fontSize(8).fillColor('#bbbbbb')
        .text(
          `Generado por Cortana  •  ${new Date().toLocaleDateString('es-CO')}`,
          65, footerY,
          { align: 'left', lineBreak: false }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generatePdf, isPdfAvailable };
