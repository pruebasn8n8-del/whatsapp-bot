const { getDoc, getSheetsApi } = require('./sheetsClient');
const { getMonthTabName } = require('../utils/dateUtils');
const { categories, defaultCategory } = require('../categories/categoryMap');
const { getAllConfig } = require('./configManager');
const config = require('../../config/default');
const logger = require('../utils/logger');

const baseFmt = { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' };

function strCell(v, fmt) {
  const cell = { userEnteredValue: { stringValue: v } };
  cell.userEnteredFormat = fmt ? { ...baseFmt, ...fmt } : { ...baseFmt };
  return cell;
}
function numCell(v, fmt) {
  const cell = { userEnteredValue: { numberValue: v } };
  cell.userEnteredFormat = fmt ? { ...baseFmt, ...fmt } : { ...baseFmt };
  return cell;
}
function formulaCell(f, fmt) {
  const cell = { userEnteredValue: { formulaValue: f } };
  cell.userEnteredFormat = fmt ? { ...baseFmt, ...fmt } : { ...baseFmt };
  return cell;
}

async function writeSavingsTab() {
  const doc = await getDoc();
  const sheetsApi = await getSheetsApi();
  const spreadsheetId = config.google.spreadsheetId;
  const tabName = getMonthTabName();
  const t = `'${tabName}'`;

  let sheet = doc.sheetsByTitle['Ahorros'];
  if (!sheet) {
    sheet = await doc.addSheet({ title: 'Ahorros' });
  }
  const sheetId = sheet.sheetId;

  const allCats = [...categories, defaultCategory];
  const catsWithSavings = allCats.filter(c => c.savingsRate > 0);

  const headerFmt = { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true } };
  const currFmt = { numberFormat: { type: 'CURRENCY', pattern: '"$"#,##0' } };
  const pctFmt = { numberFormat: { type: 'PERCENT', pattern: '0%' } };
  const boldCurrFmt = { numberFormat: { type: 'CURRENCY', pattern: '"$"#,##0' }, textFormat: { bold: true } };
  const boldFmt = { textFormat: { bold: true } };

  const rows = [];

  // Header
  rows.push({
    values: [
      strCell('Categoría', headerFmt),
      strCell('Gasto Actual', headerFmt),
      strCell('Tasa Ahorro', headerFmt),
      strCell('Ahorro Conservador', headerFmt),
      strCell('Ahorro Agresivo', headerFmt),
    ],
  });

  // Category rows - use SUMPRODUCT referencing A column (category name)
  for (let i = 0; i < catsWithSavings.length; i++) {
    const cat = catsWithSavings[i];
    const r = i + 2; // 1-indexed row
    // A has category name, B uses SUMPRODUCT matching A against month tab
    rows.push({
      values: [
        strCell(cat.name),
        formulaCell(`=SUMPRODUCT((${t}!E$2:E$1000=A${r})*(${t}!D$2:D$1000))`, currFmt),
        numCell(cat.savingsRate, pctFmt),
        formulaCell(`=B${r}*C${r}/2`, currFmt),
        formulaCell(`=B${r}*C${r}`, currFmt),
      ],
    });
  }

  // Totals row
  const totRow = catsWithSavings.length + 2;
  rows.push({
    values: [
      strCell('TOTAL', boldFmt),
      formulaCell(`=SUM(B2:B${totRow - 1})`, boldCurrFmt),
      strCell(''),
      formulaCell(`=SUM(D2:D${totRow - 1})`, boldCurrFmt),
      formulaCell(`=SUM(E2:E${totRow - 1})`, boldCurrFmt),
    ],
  });

  // --- INCOME-RELATIVE ANALYSIS ---
  let cfg = {};
  try { cfg = await getAllConfig(); } catch (e) { /* no config yet */ }
  const salario = cfg['Salario'] || null;
  const saldo = cfg['Saldo Inicial'] || null;
  const tipoBase = cfg['Tipo Base'] || null;
  const metaAhorro = cfg['Meta Ahorro Mensual'] || null;
  const ingreso = tipoBase === 'saldo' ? saldo : salario;

  if (ingreso) {
    const sectionFmt = { textFormat: { bold: true, fontSize: 12 } };
    const greenHeader = { backgroundColor: { red: 0.85, green: 0.94, blue: 0.85 }, textFormat: { bold: true } };

    rows.push({ values: [strCell('')] }); // empty
    rows.push({ values: [strCell('Análisis vs Ingreso', sectionFmt)] });
    rows.push({
      values: [
        strCell('Indicador', greenHeader),
        strCell('Valor', greenHeader),
      ],
    });

    const baseLabel = tipoBase === 'saldo' ? 'Saldo Inicial' : 'Ingreso Mensual';
    const ingresoR = rows.length + 1;
    rows.push({ values: [strCell(baseLabel), numCell(ingreso, currFmt)] });

    const gastadoR = rows.length + 1;
    rows.push({ values: [strCell('Total Gastado'), formulaCell(`=B${totRow}`, currFmt)] });

    const ahorroR = rows.length + 1;
    rows.push({ values: [strCell('Ahorro Posible'), formulaCell(`=B${ingresoR}-B${gastadoR}`, currFmt)] });

    if (metaAhorro) {
      const metaR = rows.length + 1;
      rows.push({ values: [strCell('Meta de Ahorro'), numCell(metaAhorro, currFmt)] });

      rows.push({ values: [strCell('Diferencia vs Meta'), formulaCell(`=B${ahorroR}-B${metaR}`, currFmt)] });

      rows.push({ values: [strCell('Cumplimiento'), formulaCell(`=IFERROR(B${ahorroR}/B${metaR};0)`, pctFmt)] });
    }

    // % of income per category
    rows.push({ values: [strCell('')] });
    rows.push({
      values: [
        strCell('Categoría', greenHeader),
        strCell('% del Ingreso', greenHeader),
      ],
    });
    for (let i = 0; i < catsWithSavings.length; i++) {
      const catR = i + 2;
      rows.push({
        values: [
          strCell(catsWithSavings[i].name),
          formulaCell(`=IFERROR(B${catR}/B${ingresoR};0)`, pctFmt),
        ],
      });
    }
  }

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: { sheetId, startRowIndex: 0, startColumnIndex: 0 },
            fields: 'userEnteredValue,userEnteredFormat',
          },
        },
        {
          updateCells: {
            range: { sheetId, startRowIndex: 0, startColumnIndex: 0 },
            rows,
            fields: 'userEnteredValue,userEnteredFormat',
          },
        },
        // Set column widths for proper spacing
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 200 },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 5 },
            properties: { pixelSize: 180 },
            fields: 'pixelSize',
          },
        },
        // Set row heights for spacing
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: rows.length },
            properties: { pixelSize: 30 },
            fields: 'pixelSize',
          },
        },
        // Force center alignment on ALL cells in the Ahorros sheet
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 5 },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
              },
            },
            fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment',
          },
        },
      ],
    },
  });

  logger.info('Pestaña Ahorros actualizada con fórmulas');
}

module.exports = { writeSavingsTab };
