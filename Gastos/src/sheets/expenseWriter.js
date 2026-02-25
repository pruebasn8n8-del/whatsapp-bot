const { getOrCreateMonthTab } = require('./tabManager');
const { getSheetsApi } = require('./sheetsClient');
const { now, getFormattedDate, getFormattedTime, getDayOfWeek } = require('../utils/dateUtils');
const { updateDashboard } = require('./dashboardUpdater');
const config = require('../../config/default');
const logger = require('../utils/logger');

async function writeExpense({ description, amount, category, subcategory, tag }) {
  const dt = now();
  const sheet = await getOrCreateMonthTab(dt);

  const row = {
    Fecha: getFormattedDate(dt),
    Hora: getFormattedTime(dt),
    Descripción: description,
    Monto: amount,
    Categoría: category,
    Subcategoría: subcategory || '',
    'Día Semana': getDayOfWeek(dt),
  };

  const addedRow = await sheet.addRow(row, { raw: false });
  logger.info(`Fila escrita en ${sheet.title}: ${description} - ${amount}`);

  // Center the newly added row
  try {
    const sheetsApi = await getSheetsApi();
    const rowIndex = addedRow.rowNumber - 1; // 0-indexed
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: config.google.spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: sheet.sheetId,
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: 0,
                endColumnIndex: 7,
              },
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
  } catch (err) {
    logger.error(`Error formateando fila: ${err.message}`);
  }

  // Update dashboard after writing
  try {
    await updateDashboard();
  } catch (err) {
    logger.error(`Error actualizando dashboard: ${err.message}`);
  }
}

module.exports = { writeExpense };
