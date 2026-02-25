const { getDoc, getSheetsApi } = require('./sheetsClient');
const { getMonthTabName } = require('../utils/dateUtils');
const { updateDashboard } = require('./dashboardUpdater');
const config = require('../../config/default');
const logger = require('../utils/logger');

async function getRecentExpenses(limit = 10) {
  const doc = await getDoc();
  const tabName = getMonthTabName();
  const sheet = doc.sheetsByTitle[tabName];
  if (!sheet) return [];

  const rows = await sheet.getRows();
  // Return the last N rows, most recent first, with their row index
  const result = [];
  const start = Math.max(0, rows.length - limit);
  for (let i = rows.length - 1; i >= start; i--) {
    result.push({
      index: i, // index in the rows array
      rowNumber: rows[i].rowNumber, // 1-indexed sheet row number
      fecha: rows[i].get('Fecha') || '',
      hora: rows[i].get('Hora') || '',
      descripcion: rows[i].get('Descripción') || '',
      monto: parseFloat(rows[i].get('Monto')) || 0,
      categoria: rows[i].get('Categoría') || '',
    });
  }
  return result;
}

async function deleteExpense(rowNumber) {
  const doc = await getDoc();
  const sheetsApi = await getSheetsApi();
  const spreadsheetId = config.google.spreadsheetId;
  const tabName = getMonthTabName();
  const sheet = doc.sheetsByTitle[tabName];
  if (!sheet) throw new Error('No se encontró la pestaña del mes actual');

  // Delete the row using the Sheets API (deleteRange shifts rows up)
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheet.sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1, // 0-indexed
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });

  logger.info(`Fila ${rowNumber} eliminada de ${tabName}`);

  // Update dashboard after deletion
  await updateDashboard();
}

async function editExpense(rowNumber, fields) {
  const doc = await getDoc();
  const tabName = getMonthTabName();
  const sheet = doc.sheetsByTitle[tabName];
  if (!sheet) throw new Error('No se encontró la pestaña del mes actual');

  const rows = await sheet.getRows();
  const row = rows.find(r => r.rowNumber === rowNumber);
  if (!row) throw new Error('No se encontró la fila');

  if (fields.descripcion !== undefined) row.set('Descripción', fields.descripcion);
  if (fields.monto !== undefined) row.set('Monto', fields.monto);
  if (fields.categoria !== undefined) row.set('Categoría', fields.categoria);

  await row.save();
  logger.info(`Fila ${rowNumber} editada en ${tabName}`);

  await updateDashboard();
}

module.exports = { getRecentExpenses, deleteExpense, editExpense };
