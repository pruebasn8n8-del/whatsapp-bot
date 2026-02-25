const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const path = require('path');
const config = require('../../config/default');
const logger = require('../utils/logger');

let doc = null;
let sheetsApi = null;

async function getDoc() {
  if (doc) return doc;

  const credPath = path.resolve(config.google.credentialsPath);
  const auth = new GoogleAuth({
    keyFile: credPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  });

  doc = new GoogleSpreadsheet(config.google.spreadsheetId, auth);
  await doc.loadInfo();
  logger.info(`Conectado a Google Sheets: "${doc.title}"`);
  return doc;
}

async function getSheetsApi() {
  if (sheetsApi) return sheetsApi;

  const credPath = path.resolve(config.google.credentialsPath);
  const auth = new GoogleAuth({
    keyFile: credPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsApi = google.sheets({ version: 'v4', auth });
  return sheetsApi;
}

module.exports = { getDoc, getSheetsApi };
