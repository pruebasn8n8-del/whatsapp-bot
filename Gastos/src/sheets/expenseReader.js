const { getDoc, getSheetsApi } = require('./sheetsClient');
const { getMonthTabName } = require('../utils/dateUtils');
const { updateDashboard } = require('./dashboardUpdater');
const logger = require('../utils/logger');

/**
 * Obtiene los últimos gastos del mes indicado.
 * @param {number} limit
 * @param {string|null} tabName - Nombre de la pestaña del mes (ej: "Enero 2026"). Null = mes actual.
 */
async function getRecentExpenses(limit = 10, tabName = null) {
  const doc = await getDoc();
  const sheetTabName = tabName || getMonthTabName();
  const sheet = doc.sheetsByTitle[sheetTabName];
  if (!sheet) return [];

  const rows = await sheet.getRows();
  const result = [];
  const start = Math.max(0, rows.length - limit);
  for (let i = rows.length - 1; i >= start; i--) {
    result.push({
      index: i,
      rowNumber: rows[i].rowNumber,
      fecha: rows[i].get('Fecha') || '',
      hora: rows[i].get('Hora') || '',
      descripcion: rows[i].get('Descripción') || '',
      monto: parseFloat(rows[i].get('Monto')) || 0,
      categoria: rows[i].get('Categoría') || '',
    });
  }
  return result;
}

/**
 * Elimina un gasto por número de fila.
 * @param {number} rowNumber
 * @param {string|null} tabName - Nombre de la pestaña. Null = mes actual.
 */
async function deleteExpense(rowNumber, tabName = null) {
  const doc = await getDoc();
  const sheetsApi = await getSheetsApi();
  const spreadsheetId = doc.spreadsheetId;
  const sheetTabName = tabName || getMonthTabName();
  const sheet = doc.sheetsByTitle[sheetTabName];
  if (!sheet) throw new Error(`No se encontró la pestaña "${sheetTabName}"`);

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheet.sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });

  logger.info(`Fila ${rowNumber} eliminada de ${sheetTabName}`);
  await updateDashboard();
}

/**
 * Edita campos de un gasto.
 * @param {number} rowNumber
 * @param {object} fields - { descripcion, monto, categoria }
 * @param {string|null} tabName - Nombre de la pestaña. Null = mes actual.
 */
async function editExpense(rowNumber, fields, tabName = null) {
  const doc = await getDoc();
  const sheetTabName = tabName || getMonthTabName();
  const sheet = doc.sheetsByTitle[sheetTabName];
  if (!sheet) throw new Error(`No se encontró la pestaña "${sheetTabName}"`);

  const rows = await sheet.getRows();
  const row = rows.find(r => r.rowNumber === rowNumber);
  if (!row) throw new Error('No se encontró la fila');

  if (fields.descripcion !== undefined) row.set('Descripción', fields.descripcion);
  if (fields.monto !== undefined) row.set('Monto', fields.monto);
  if (fields.categoria !== undefined) row.set('Categoría', fields.categoria);

  await row.save();
  logger.info(`Fila ${rowNumber} editada en ${sheetTabName}`);

  await updateDashboard();
}

module.exports = { getRecentExpenses, deleteExpense, editExpense };
