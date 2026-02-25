const { getDoc, getSheetsApi } = require('./sheetsClient');
const { getMonthTabName } = require('../utils/dateUtils');
const { categories, defaultCategory } = require('../categories/categoryMap');
const { writeSavingsTab } = require('./savingsCalculator');
const { createCharts } = require('./chartManager');
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
function emptyCell() {
  return { userEnteredFormat: { ...baseFmt } };
}

function sumByCategoryFormula(t, labelCell) {
  return `=SUMPRODUCT((${t}!E$2:E$1000=${labelCell})*(${t}!D$2:D$1000))`;
}

async function updateDashboard() {
  const doc = await getDoc();
  const sheetsApi = await getSheetsApi();
  const spreadsheetId = config.google.spreadsheetId;
  const tabName = getMonthTabName();

  let resumenSheet = doc.sheetsByTitle[config.sheets.resumenTab];
  if (!resumenSheet) {
    resumenSheet = await doc.addSheet({ title: config.sheets.resumenTab });
  }

  const monthSheet = doc.sheetsByTitle[tabName];
  if (!monthSheet) {
    logger.info('No hay datos del mes actual para el dashboard');
    return;
  }

  const resumenSheetId = resumenSheet.sheetId;
  const t = `'${tabName}'`;

  // Read financial config
  let cfg = {};
  try { cfg = await getAllConfig(); } catch (e) { /* no config yet */ }
  const salario = cfg['Salario'] || null;
  const saldo = cfg['Saldo Inicial'] || null;
  const tipoBase = cfg['Tipo Base'] || null;
  const metaAhorro = cfg['Meta Ahorro Mensual'] || null;
  const ingreso = tipoBase === 'saldo' ? saldo : salario;

  const titleBg = { red: 0.15, green: 0.22, blue: 0.38 };
  const titleFg = { red: 1, green: 1, blue: 1 };
  const greenBg = { red: 0.85, green: 0.94, blue: 0.85 };
  const grayBg = { red: 0.85, green: 0.85, blue: 0.85 };
  const currFmt = { numberFormat: { type: 'CURRENCY', pattern: '"$"#,##0' }, ...baseFmt };
  const pctFmt = { numberFormat: { type: 'PERCENT', pattern: '0%' }, ...baseFmt };
  const headerFmt = { backgroundColor: grayBg, textFormat: { bold: true }, ...baseFmt };
  const titleFmt = { backgroundColor: titleBg, textFormat: { bold: true, fontSize: 16, foregroundColor: titleFg }, ...baseFmt };
  const sectionFmt = { textFormat: { bold: true, fontSize: 12 }, ...baseFmt };
  const finHeaderFmt = { backgroundColor: greenBg, textFormat: { bold: true }, ...baseFmt };

  const allCats = [...categories, defaultCategory];
  const rows = [];
  let r = 0; // 0-indexed row counter (r), sheet row = r+1

  // --- TITLE ---
  const titleRow = [{ userEnteredValue: { stringValue: `Dashboard de Gastos - ${tabName}` }, userEnteredFormat: titleFmt }];
  for (let i = 1; i < 8; i++) titleRow.push({ userEnteredFormat: { backgroundColor: titleBg } });
  rows.push({ values: titleRow }); r++;

  // Empty
  rows.push({ values: [emptyCell()] }); r++;

  // --- KPI SECTION ---
  rows.push({ values: [strCell('Indicador', headerFmt), strCell('Valor', headerFmt)] }); r++;

  const totalMesRow = r + 1; // 1-indexed sheet row
  rows.push({ values: [strCell('Total Mes'), formulaCell(`=SUM(${t}!D:D)`, currFmt)] }); r++;

  // Category totals
  const catNames = ['Gastos Hormiga', 'Gastos Necesarios', 'Gastos Opcionales', 'Alimentación', 'Transporte', 'Educación', 'Sin Categoría'];
  const catStartRow = r + 1; // 1-indexed
  for (let i = 0; i < catNames.length; i++) {
    const sheetRow = r + 1;
    rows.push({
      values: [
        strCell(catNames[i]),
        formulaCell(sumByCategoryFormula(t, `A${sheetRow}`), currFmt),
      ],
    });
    r++;
  }

  // Count
  rows.push({ values: [strCell('Cantidad de Gastos'), formulaCell(`=COUNTA(${t}!D2:D)`)] }); r++;

  // Average
  rows.push({ values: [strCell('Promedio por Gasto'), formulaCell(`=IFERROR(AVERAGE(${t}!D2:D);0)`, currFmt)] }); r++;

  // --- FINANCIAL SITUATION ---
  if (ingreso) {
    rows.push({ values: [emptyCell()] }); r++;

    rows.push({ values: [strCell('Situación Financiera', sectionFmt)] }); r++;
    rows.push({ values: [strCell('Indicador', finHeaderFmt), strCell('Valor', finHeaderFmt)] }); r++;

    const baseLabel = tipoBase === 'saldo' ? 'Saldo Inicial' : 'Ingreso Mensual';
    const ingresoRow = r + 1;
    rows.push({ values: [strCell(baseLabel), numCell(ingreso, currFmt)] }); r++;

    const gastadoRow = r + 1;
    rows.push({ values: [strCell('Total Gastado'), formulaCell(`=B${totalMesRow}`, currFmt)] }); r++;

    const disponibleRow = r + 1;
    rows.push({ values: [strCell('Disponible'), formulaCell(`=B${ingresoRow}-B${gastadoRow}`, currFmt)] }); r++;

    rows.push({ values: [strCell('% Gastado'), formulaCell(`=IFERROR(B${gastadoRow}/B${ingresoRow};0)`, pctFmt)] }); r++;
    rows.push({ values: [strCell('% Disponible'), formulaCell(`=IFERROR(B${disponibleRow}/B${ingresoRow};0)`, pctFmt)] }); r++;

    if (metaAhorro) {
      const metaRow = r + 1;
      rows.push({ values: [strCell('Meta de Ahorro'), numCell(metaAhorro, currFmt)] }); r++;
      rows.push({ values: [strCell('Cumplimiento Meta'), formulaCell(`=IFERROR(B${disponibleRow}/B${metaRow};0)`, pctFmt)] }); r++;
    }
  }

  // --- SAVINGS SECTION ---
  rows.push({ values: [emptyCell()] }); r++;

  rows.push({ values: [strCell('Ahorro Potencial', sectionFmt)] }); r++;
  rows.push({ values: [strCell('Escenario', headerFmt), strCell('Monto', headerFmt)] }); r++;

  const savParts = [];
  for (let i = 0; i < catNames.length; i++) {
    const cat = allCats.find(c => c.name === catNames[i]);
    if (cat && cat.savingsRate > 0) {
      savParts.push({ bCell: `B${catStartRow + i}`, rate: cat.savingsRate });
    }
  }

  const conservadorF = '=' + savParts.map(p => `${p.bCell}*${Math.round(p.rate * 100)}/100/2`).join('+');
  const agresivoF = '=' + savParts.map(p => `${p.bCell}*${Math.round(p.rate * 100)}/100`).join('+');

  rows.push({ values: [strCell('Conservador'), formulaCell(conservadorF, currFmt)] }); r++;
  rows.push({ values: [strCell('Agresivo'), formulaCell(agresivoF, currFmt)] }); r++;

  // --- TOP 10 ---
  rows.push({ values: [emptyCell()] }); r++;
  rows.push({ values: [emptyCell()] }); r++;

  rows.push({ values: [strCell('Top 10 Gastos del Mes', sectionFmt)] }); r++;
  rows.push({ values: [strCell('Descripción', headerFmt), strCell('Monto', headerFmt), strCell('Categoría', headerFmt)] }); r++;

  const monthRows = await monthSheet.getRows();
  const sorted = [...monthRows]
    .map(row => ({
      desc: row.get('Descripción') || '',
      amount: parseFloat(row.get('Monto')) || 0,
      cat: row.get('Categoría') || '',
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  for (let i = 0; i < 10; i++) {
    if (i < sorted.length) {
      rows.push({ values: [strCell(sorted[i].desc), numCell(sorted[i].amount, currFmt), strCell(sorted[i].cat)] });
    } else {
      rows.push({ values: [strCell(''), strCell(''), strCell('')] });
    }
    r++;
  }

  // --- WRITE TO SHEET ---
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: { sheetId: resumenSheetId, startRowIndex: 0, startColumnIndex: 0 },
            fields: 'userEnteredValue,userEnteredFormat',
          },
        },
        {
          updateCells: {
            range: { sheetId: resumenSheetId, startRowIndex: 0, startColumnIndex: 0 },
            rows,
            fields: 'userEnteredValue,userEnteredFormat',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: resumenSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 220 },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: resumenSheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
            properties: { pixelSize: 180 },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: resumenSheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
            properties: { pixelSize: 180 },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: resumenSheetId, dimension: 'ROWS', startIndex: 0, endIndex: rows.length },
            properties: { pixelSize: 30 },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: resumenSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 45 },
            fields: 'pixelSize',
          },
        },
        {
          repeatCell: {
            range: { sheetId: resumenSheetId, startRowIndex: 0, endRowIndex: 100, startColumnIndex: 0, endColumnIndex: 3 },
            cell: {
              userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' },
            },
            fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment',
          },
        },
      ],
    },
  });

  // Format month tab
  const monthSheetId = monthSheet.sheetId;
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: monthSheetId, startRowIndex: 0, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 7 },
            cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
            fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment',
          },
        },
        { updateDimensionProperties: { range: { sheetId: monthSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: monthSheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: monthSheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: monthSheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 140 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: monthSheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: monthSheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: monthSheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: monthSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1000 }, properties: { pixelSize: 28 }, fields: 'pixelSize' } },
      ],
    },
  });

  logger.info(`Dashboard actualizado con fórmulas para ${tabName}`);

  await writeSavingsTab();

  try {
    await createCharts();
  } catch (err) {
    logger.error(`Error creando gráficos: ${err.message}`);
  }
}

module.exports = { updateDashboard };
