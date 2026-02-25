const { getDoc, getSheetsApi } = require('./sheetsClient');
const { getFormattedDate, now } = require('../utils/dateUtils');
const config = require('../../config/default');
const logger = require('../utils/logger');

const HEADERS = ['Clave', 'Valor', 'Actualizado'];

let formatted = false;

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

  // Apply formatting once per session (on creation or first access)
  if (!formatted) {
    formatted = true;
    await applyFormat(sheet, isNew);
  }

  return sheet;
}

async function applyFormat(sheet, isNew) {
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
  const spreadsheetId = config.google.spreadsheetId;
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

module.exports = { getConfig, setConfig, getAllConfig };
