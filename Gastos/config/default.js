require('dotenv').config();
const path = require('path');

module.exports = {
  google: {
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    credentialsPath: path.join(__dirname, '..', 'credentials', 'service-account.json'),
  },
  timezone: process.env.TIMEZONE || 'America/Bogota',
  currency: {
    code: 'COP',
    symbol: '$',
    locale: 'es-CO',
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  sheets: {
    resumenTab: 'Resumen',
    categoriasTab: 'Categorias',
    ahorrosTab: 'Ahorros',
    configuracionTab: 'Configuracion',
  },
};
