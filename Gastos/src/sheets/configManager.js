const { getDoc, getSheetsApi } = require('./sheetsClient');
const { getFormattedDate, now } = require('../utils/dateUtils');
const config = require('../../config/default');
const logger = require('../utils/logger');

const HEADERS = ['Clave', 'Valor', 'Actualizado'];

const _formatted = new Set(); // formatted per spreadsheetId

async function getSheet() {
  const doc = await getDoc();
  const title = config.sheets.configuracionTab;
  let sheet = doc.sheetsByTitle[title];
  let isNew = false;

  if (!sheet) {
    logger.info(`Creando pestaña: ${title}`);
    sheet = await doc.addSheet({ title, headerValues: HEADERS });
    isNew = true;
  }

  // Apply formatting once per spreadsheet (best-effort, no abortar si falla)
  if (!_formatted.has(doc.spreadsheetId)) {
    _formatted.add(doc.spreadsheetId);
    try {
      await applyFormat(sheet, isNew, doc.spreadsheetId);
    } catch (fmtErr) {
      logger.warn('[ConfigManager] Formato no aplicado (no crítico):', fmtErr.message);
    }
  }

  return sheet;
}

async function applyFormat(sheet, isNew, spreadsheetId) {
  // Format header row
  await sheet.loadCells('A1:C1');
  for (let col = 0; col < HEADERS.length; col++) {
    const cell = sheet.getCell(0, col);
    cell.textFormat = { bold: true, foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } };
    cell.backgroundColor = { red: 0.2, green: 0.27, blue: 0.45 };
    cell.horizontalAlignment = 'CENTER';
    cell.verticalAlignment = 'MIDDLE';
    if (isNew) {
      cell.value = HEADERS[col];
    }
  }
  await sheet.saveUpdatedCells();

  // Set column widths and default cell format
  const sheetsApi = await getSheetsApi();
  const colWidths = [200, 200, 180]; // Clave, Valor, Actualizado

  const requests = colWidths.map((px, i) => ({
    updateDimensionProperties: {
      range: { sheetId: sheet.sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px },
      fields: 'pixelSize',
    },
  }));

  // Default row height
  requests.push({
    updateDimensionProperties: {
      range: { sheetId: sheet.sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 100 },
      properties: { pixelSize: 28 },
      fields: 'pixelSize',
    },
  });

  // Header row taller
  requests.push({
    updateDimensionProperties: {
      range: { sheetId: sheet.sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 36 },
      fields: 'pixelSize',
    },
  });

  // Center all cells
  requests.push({
    repeatCell: {
      range: { sheetId: sheet.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 3 },
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment',
    },
  });

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  logger.info('Formato aplicado a hoja Configuracion');
}

async function getConfig(key) {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('Clave') === key);
  if (!row) return null;
  const val = row.get('Valor');
  const num = parseFloat(val);
  return isNaN(num) ? val : num;
}

async function setConfig(key, value) {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  const existing = rows.find(r => r.get('Clave') === key);
  const fecha = getFormattedDate(now());

  if (existing) {
    existing.set('Valor', value);
    existing.set('Actualizado', fecha);
    await existing.save();
  } else {
    await sheet.addRow({ Clave: key, Valor: value, Actualizado: fecha });
  }

  logger.info(`Config actualizada: ${key} = ${value}`);
}

async function getAllConfig() {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  const result = {};
  for (const row of rows) {
    const key = row.get('Clave');
    const val = row.get('Valor');
    if (key) {
      const num = parseFloat(val);
      result[key] = isNaN(num) ? val : num;
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────
// writeInitialConfigLayout: rewrites Configuracion with a beautiful
// layout using the full onboarding data object.
// getConfig / setConfig still work afterwards (they use row.get('Clave')).
// ─────────────────────────────────────────────────────────────────

async function writeInitialConfigLayout(data) {
  const doc = await getDoc();
  const sheetsApi = await getSheetsApi();
  const spreadsheetId = doc.spreadsheetId;
  const title = config.sheets.configuracionTab;

  // Ensure tab exists
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({ title, headerValues: HEADERS });
  }

  // Reload to get fresh sheetId
  await doc.loadInfo();
  sheet = doc.sheetsByTitle[title];
  const sheetId = sheet.sheetId;

  const fecha = getFormattedDate(now());

  // ── Color palette ──
  const navyBg    = { red: 0.129, green: 0.188, blue: 0.310 }; // #21304F
  const blueBg    = { red: 0.196, green: 0.373, blue: 0.635 }; // #325FA2
  const white     = { red: 1, green: 1, blue: 1 };
  const lightBlue = { red: 0.941, green: 0.961, blue: 1.000 }; // #F0F5FF
  const grayText  = { red: 0.5, green: 0.5, blue: 0.5 };

  // ── Helpers ──
  function hexBg(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { red: r, green: g, blue: b };
  }

  function makeRow(clave, valor, actualizado, opts = {}) {
    // opts: { isHeader, isSection, isSubRow, isNumber, isSpacer, rowBg }
    const { isHeader, isSection, isSubRow, isNumber, isSpacer, rowBg } = opts;

    if (isSpacer) {
      return {
        values: [
          { userEnteredValue: { stringValue: '' }, userEnteredFormat: { verticalAlignment: 'MIDDLE' } },
          { userEnteredValue: { stringValue: '' }, userEnteredFormat: { verticalAlignment: 'MIDDLE' } },
          { userEnteredValue: { stringValue: '' }, userEnteredFormat: { verticalAlignment: 'MIDDLE' } },
        ],
      };
    }

    const bg = isHeader ? navyBg : isSection ? blueBg : rowBg || white;
    const fg = (isHeader || isSection) ? white : (isSubRow ? grayText : null);

    function fmtCell(val, extraFmt = {}) {
      const fmt = {
        backgroundColor: bg,
        verticalAlignment: 'MIDDLE',
        ...extraFmt,
      };
      if (fg) fmt.foregroundColor = fg;
      if (isHeader || isSection) fmt.textFormat = { bold: true, foregroundColor: white };
      if (isSubRow) fmt.textFormat = { foregroundColor: grayText };
      return fmt;
    }

    // Clave cell
    const claveCell = {
      userEnteredValue: { stringValue: String(clave ?? '') },
      userEnteredFormat: fmtCell(clave, { horizontalAlignment: 'LEFT' }),
    };

    // Valor cell
    let valorCell;
    if (isNumber && typeof valor === 'number' && !isSection && !isHeader) {
      valorCell = {
        userEnteredValue: { numberValue: valor },
        userEnteredFormat: fmtCell(valor, {
          horizontalAlignment: 'RIGHT',
          numberFormat: { type: 'CURRENCY', pattern: '"$"#,##0' },
        }),
      };
    } else {
      valorCell = {
        userEnteredValue: { stringValue: String(valor ?? '') },
        userEnteredFormat: fmtCell(valor, {
          horizontalAlignment: isSection || isHeader ? 'CENTER' : 'LEFT',
        }),
      };
    }

    // Actualizado cell
    const fechaCell = {
      userEnteredValue: { stringValue: String(actualizado ?? '') },
      userEnteredFormat: fmtCell(actualizado, {
        horizontalAlignment: 'CENTER',
        textFormat: isHeader ? { bold: true, foregroundColor: white }
          : isSection ? { bold: true, foregroundColor: white }
          : { fontSize: 9, foregroundColor: grayText },
      }),
    };

    return { values: [claveCell, valorCell, fechaCell] };
  }

  // ── Build rows array ──
  const rows = [];

  // Row 0: header
  rows.push(makeRow('Clave', 'Valor', 'Actualizado', { isHeader: true }));

  // ── INGRESOS section ──
  rows.push(makeRow('§ INGRESOS', '💵  INGRESOS', '', { isSection: true }));

  const freqMap = { monthly: 'Mensual', biweekly: 'Quincenal', weekly: 'Semanal', daily: 'Diario' };
  const freqLabel = freqMap[data.salary_frequency] || data.salary_frequency || 'Mensual';

  let paydayLabel = '';
  if (data.payday && data.payday.length) {
    if (data.payday.length === 1) {
      paydayLabel = `día ${data.payday[0]} de cada mes`;
    } else {
      const joined = data.payday.map(d => `día ${d}`).join(' y ');
      paydayLabel = joined;
    }
  }

  const rowBgWhite = white;
  const rowBgBlue  = lightBlue;

  rows.push(makeRow('Salario', data.salary || 0, fecha, { isNumber: true, rowBg: rowBgWhite }));
  rows.push(makeRow('Frecuencia Salario', freqLabel, fecha, { rowBg: rowBgBlue }));
  rows.push(makeRow('Dia Pago', paydayLabel, fecha, { rowBg: rowBgWhite }));
  rows.push(makeRow('Tipo Base', 'salario', fecha, { rowBg: rowBgBlue }));

  rows.push(makeRow('', '', '', { isSpacer: true }));

  // ── CUENTAS section ──
  rows.push(makeRow('§ CUENTAS', '🏦  CUENTAS', '', { isSection: true }));

  const totalBalance = (data.accounts || []).reduce((s, a) => s + (a.balance || 0), 0);
  rows.push(makeRow('Saldo Inicial', totalBalance, fecha, { isNumber: true, rowBg: rowBgWhite }));

  let acctBgToggle = false;
  for (const acc of (data.accounts || [])) {
    rows.push(makeRow('    Saldo ' + acc.name, acc.balance || 0, fecha, {
      isNumber: true,
      isSubRow: true,
      rowBg: acctBgToggle ? rowBgBlue : rowBgWhite,
    }));
    acctBgToggle = !acctBgToggle;
  }

  rows.push(makeRow('', '', '', { isSpacer: true }));

  // ── META DE AHORRO section ──
  rows.push(makeRow('§ META AHORRO', '💰  META DE AHORRO', '', { isSection: true }));
  rows.push(makeRow('Meta Ahorro Mensual', data.savings_goal || 0, fecha, { isNumber: true, rowBg: rowBgWhite }));

  rows.push(makeRow('', '', '', { isSpacer: true }));

  // ── CRIPTOMONEDAS section (if any) ──
  if (data.crypto && data.crypto.length > 0) {
    rows.push(makeRow('§ CRIPTO', '₿  CRIPTOMONEDAS', '', { isSection: true }));
    let cryptoBgToggle = false;
    for (const c of data.crypto) {
      rows.push(makeRow('Cripto ' + c.symbol, c.amount, fecha, {
        isNumber: typeof c.amount === 'number',
        rowBg: cryptoBgToggle ? rowBgBlue : rowBgWhite,
      }));
      cryptoBgToggle = !cryptoBgToggle;
    }
    rows.push(makeRow('', '', '', { isSpacer: true }));
  }

  // ── DIVISAS section (if any) ──
  if (data.fx_holdings && data.fx_holdings.length > 0) {
    rows.push(makeRow('§ DIVISAS', '💱  DIVISAS', '', { isSection: true }));
    let fxBgToggle = false;
    for (const fx of data.fx_holdings) {
      rows.push(makeRow('Divisa ' + fx.currency, fx.amount, fecha, {
        isNumber: typeof fx.amount === 'number',
        rowBg: fxBgToggle ? rowBgBlue : rowBgWhite,
      }));
      fxBgToggle = !fxBgToggle;
    }
    rows.push(makeRow('', '', '', { isSpacer: true }));
  }

  // ── OBJETIVOS section ──
  const goalLabels = {
    control_gastos: 'Control de gastos',
    ahorro: 'Ahorro',
    metas: 'Metas financieras',
    inversion: 'Inversión',
    presupuesto: 'Presupuesto',
  };
  rows.push(makeRow('§ OBJETIVOS', '🎯  OBJETIVOS', '', { isSection: true }));
  const goalsStr = (data.goals || []).map(g => goalLabels[g] || g).join(', ');
  rows.push(makeRow('Objetivos', goalsStr || 'Sin objetivos', fecha, { rowBg: rowBgWhite }));

  // ── batchUpdate: clear + write + formatting ──
  const requests = [
    // 1. Clear all existing content
    {
      updateCells: {
        range: { sheetId, startRowIndex: 0, startColumnIndex: 0 },
        fields: 'userEnteredValue,userEnteredFormat',
      },
    },
    // 2. Write all rows
    {
      updateCells: {
        range: { sheetId, startRowIndex: 0, startColumnIndex: 0 },
        rows,
        fields: 'userEnteredValue,userEnteredFormat',
      },
    },
    // 3. Column widths: A=215, B=175, C=120
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 215 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 175 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
        properties: { pixelSize: 120 },
        fields: 'pixelSize',
      },
    },
    // 4. Default row height 28px for all rows
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: rows.length },
        properties: { pixelSize: 28 },
        fields: 'pixelSize',
      },
    },
    // 5. Header row taller: 36px
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 36 },
        fields: 'pixelSize',
      },
    },
    // 6. Freeze row 1
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1 },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    },
  ];

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  // Mark as already formatted so getSheet() doesn't overwrite our layout
  _formatted.add(spreadsheetId);

  logger.info('[ConfigManager] Configuracion layout profesional escrito correctamente');
}

module.exports = { getConfig, setConfig, getAllConfig, writeInitialConfigLayout };
