const { getOrCreateMonthTab } = require('./tabManager');
const { getSheetsApi, getDoc } = require('./sheetsClient');
const { now, getFormattedDate, getFormattedTime, getDayOfWeek } = require('../utils/dateUtils');
const { updateDashboard } = require('./dashboardUpdater');
const logger = require('../utils/logger');

/**
 * Escribe un gasto en la hoja del mes correspondiente.
 * @param {object} params
 * @param {string} params.description
 * @param {number} params.amount
 * @param {string} params.category
 * @param {string} [params.subcategory]
 * @param {string} [params.tag]
 * @param {string|null} [params.targetMonth] - Nombre de pestaña destino (ej: "Enero 2026"). Null = mes actual.
 */
async function writeExpense({ description, amount, category, subcategory, tag, targetMonth }) {
  const dt = now();
  const sheet = await getOrCreateMonthTab(dt, targetMonth || null);

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
    const rowIndex = addedRow.rowNumber - 1;
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: (await getDoc()).spreadsheetId,
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

  try {
    await updateDashboard();
  } catch (err) {
    logger.error(`Error actualizando dashboard: ${err.message}`);
  }
}

module.exports = { writeExpense };
