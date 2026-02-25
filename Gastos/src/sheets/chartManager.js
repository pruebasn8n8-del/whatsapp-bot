const { getSheetsApi } = require('./sheetsClient');
const { getDoc } = require('./sheetsClient');
const config = require('../../config/default');
const logger = require('../utils/logger');

async function createCharts() {
  const doc = await getDoc();
  const sheetsApi = await getSheetsApi();
  const spreadsheetId = config.google.spreadsheetId;

  // Get the Resumen sheet ID
  const resumenSheet = doc.sheetsByTitle[config.sheets.resumenTab];
  if (!resumenSheet) {
    logger.warn('Pestaña Resumen no encontrada, omitiendo gráficos');
    return;
  }
  const resumenSheetId = resumenSheet.sheetId;

  // Find current month tab for data source
  const { getMonthTabName } = require('../utils/dateUtils');
  const monthTab = doc.sheetsByTitle[getMonthTabName()];
  if (!monthTab) {
    logger.warn('Pestaña del mes actual no encontrada, omitiendo gráficos');
    return;
  }
  const monthSheetId = monthTab.sheetId;
  const rows = await monthTab.getRows();
  const dataEndRow = rows.length + 1; // +1 for header

  // First, remove existing charts from Resumen
  const sheetInfo = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties,charts)',
  });

  const resumenInfo = sheetInfo.data.sheets.find(s => s.properties.sheetId === resumenSheetId);
  const existingCharts = resumenInfo?.charts || [];

  const deleteRequests = existingCharts.map(chart => ({
    deleteEmbeddedObject: { objectId: chart.chartId },
  }));

  const addRequests = [];

  // 1. Pie chart - By Category (position: row 1, col D - right of data)
  addRequests.push({
    addChart: {
      chart: {
        position: {
          overlayPosition: {
            anchorCell: { sheetId: resumenSheetId, rowIndex: 0, columnIndex: 3 },
            widthPixels: 500,
            heightPixels: 320,
          },
        },
        spec: {
          title: 'Gastos por Categoría',
          pieChart: {
            legendPosition: 'RIGHT_LEGEND',
            domain: {
              sourceRange: {
                sources: [{ sheetId: monthSheetId, startRowIndex: 0, endRowIndex: dataEndRow, startColumnIndex: 4, endColumnIndex: 5 }],
              },
            },
            series: {
              sourceRange: {
                sources: [{ sheetId: monthSheetId, startRowIndex: 0, endRowIndex: dataEndRow, startColumnIndex: 3, endColumnIndex: 4 }],
              },
            },
          },
        },
      },
    },
  });

  // 2. Bar chart - Daily spending (position: row 17, col D - below pie chart)
  addRequests.push({
    addChart: {
      chart: {
        position: {
          overlayPosition: {
            anchorCell: { sheetId: resumenSheetId, rowIndex: 11, columnIndex: 3 },
            widthPixels: 500,
            heightPixels: 320,
          },
        },
        spec: {
          title: 'Gasto Diario',
          basicChart: {
            chartType: 'BAR',
            legendPosition: 'NO_LEGEND',
            axis: [
              { position: 'BOTTOM_AXIS', title: 'Fecha' },
              { position: 'LEFT_AXIS', title: 'Monto (COP)' },
            ],
            domains: [{
              domain: {
                sourceRange: {
                  sources: [{ sheetId: monthSheetId, startRowIndex: 0, endRowIndex: dataEndRow, startColumnIndex: 0, endColumnIndex: 1 }],
                },
              },
            }],
            series: [{
              series: {
                sourceRange: {
                  sources: [{ sheetId: monthSheetId, startRowIndex: 0, endRowIndex: dataEndRow, startColumnIndex: 3, endColumnIndex: 4 }],
                },
              },
            }],
          },
        },
      },
    },
  });

  // 3. Line chart - Accumulated trend (position: row 33, col D - below bar chart)
  addRequests.push({
    addChart: {
      chart: {
        position: {
          overlayPosition: {
            anchorCell: { sheetId: resumenSheetId, rowIndex: 22, columnIndex: 3 },
            widthPixels: 500,
            heightPixels: 320,
          },
        },
        spec: {
          title: 'Tendencia Acumulada',
          basicChart: {
            chartType: 'LINE',
            legendPosition: 'NO_LEGEND',
            axis: [
              { position: 'BOTTOM_AXIS', title: 'Fecha' },
              { position: 'LEFT_AXIS', title: 'Acumulado (COP)' },
            ],
            domains: [{
              domain: {
                sourceRange: {
                  sources: [{ sheetId: monthSheetId, startRowIndex: 0, endRowIndex: dataEndRow, startColumnIndex: 0, endColumnIndex: 1 }],
                },
              },
            }],
            series: [{
              series: {
                sourceRange: {
                  sources: [{ sheetId: monthSheetId, startRowIndex: 0, endRowIndex: dataEndRow, startColumnIndex: 3, endColumnIndex: 4 }],
                },
              },
            }],
          },
        },
      },
    },
  });

  // Execute all requests
  const requests = [...deleteRequests, ...addRequests];
  if (requests.length > 0) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
    logger.info(`Gráficos actualizados: ${addRequests.length} creados, ${deleteRequests.length} eliminados`);
  }
}

module.exports = { createCharts };
