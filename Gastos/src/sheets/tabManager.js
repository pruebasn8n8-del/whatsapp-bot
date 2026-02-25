const { getDoc, getSheetsApi } = require('./sheetsClient');
const { getMonthTabName } = require('../utils/dateUtils');
const config = require('../../config/default');
const logger = require('../utils/logger');

const HEADERS = ['Fecha', 'Hora', 'Descripción', 'Monto', 'Categoría', 'Subcategoría', 'Día Semana'];

async function getOrCreateMonthTab(dt) {
  const doc = await getDoc();
  const tabName = getMonthTabName(dt);

  let sheet = doc.sheetsByTitle[tabName];
  if (sheet) return sheet;

  logger.info(`Creando pestaña: ${tabName}`);
  sheet = await doc.addSheet({
    title: tabName,
    headerValues: HEADERS,
  });

  // Format header row
  await sheet.loadCells('A1:G1');
  for (let col = 0; col < HEADERS.length; col++) {
    const cell = sheet.getCell(0, col);
    cell.textFormat = { bold: true, foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } };
    cell.backgroundColor = { red: 0.2, green: 0.27, blue: 0.45 };
    cell.horizontalAlignment = 'CENTER';
    cell.verticalAlignment = 'MIDDLE';
  }
  await sheet.saveUpdatedCells();

  // Set column widths and default cell format for centering
  const sheetsApi = await getSheetsApi();
  const spreadsheetId = config.google.spreadsheetId;
  const colWidths = [120, 100, 220, 140, 160, 160, 130]; // Fecha, Hora, Descripción, Monto, Categoría, Subcategoría, Día Semana
  const widthRequests = colWidths.map((px, i) => ({
    updateDimensionProperties: {
      range: { sheetId: sheet.sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px },
      fields: 'pixelSize',
    },
  }));

  // Set default cell format to centered
  widthRequests.push({
    repeatCell: {
      range: { sheetId: sheet.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 },
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment',
    },
  });

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: widthRequests },
  });

  return sheet;
}

async function ensureTab(title, headers) {
  const doc = await getDoc();
  let sheet = doc.sheetsByTitle[title];
  if (sheet) return sheet;

  logger.info(`Creando pestaña: ${title}`);
  sheet = await doc.addSheet({
    title,
    headerValues: headers,
  });
  return sheet;
}

module.exports = { getOrCreateMonthTab, ensureTab };
