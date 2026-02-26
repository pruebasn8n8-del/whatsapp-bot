// Gastos/src/sheets/sheetsClient.js - Cliente Google Sheets multi-usuario

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const path = require('path');
const config = require('../../config/default');
const logger = require('../utils/logger');

// Cache de auth (se reutiliza entre usuarios)
let _auth = null;
let _sheetsApi = null;

// Cache de documentos por spreadsheetId
const _docCache = new Map();

// ID del spreadsheet activo para la operación actual (debe ser del usuario)
let _currentSpreadsheetId = null;

async function _getAuth() {
  if (_auth) return _auth;
  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ];

  // Opción 1: JSON completo en base64 (más confiable, evita problemas de escaping)
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    try {
      const creds = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf8'));
      _auth = new GoogleAuth({ credentials: creds, scopes });
      logger.info('[SheetsClient] Auth via GOOGLE_CREDENTIALS_BASE64');
      return _auth;
    } catch (e) {
      logger.warn('[SheetsClient] Error parseando GOOGLE_CREDENTIALS_BASE64:', e.message);
    }
  }

  // Opción 2: email + private key por separado
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    _auth = new GoogleAuth({
      credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: privateKey },
      scopes,
    });
    logger.info('[SheetsClient] Auth via GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY');
    return _auth;
  }

  // Opción 3: archivo local (desarrollo)
  const credPath = path.resolve(config.google.credentialsPath);
  _auth = new GoogleAuth({ keyFile: credPath, scopes });
  logger.info('[SheetsClient] Auth via archivo: ' + credPath);
  return _auth;
}

/**
 * Establece el spreadsheetId del usuario actual.
 * Debe llamarse al inicio de cada handleGastosMessage con el sheet del usuario.
 */
function setCurrentSpreadsheetId(id) {
  _currentSpreadsheetId = id || null;
}

/**
 * Retorna el spreadsheetId activo. Lanza error si no hay ninguno configurado.
 * Cada usuario debe tener su propio spreadsheet (creado en el onboarding).
 */
function getCurrentSpreadsheetId() {
  if (!_currentSpreadsheetId) {
    throw new Error('No hay hoja de cálculo configurada para este usuario. Usa /gastos para configurar tu perfil.');
  }
  return _currentSpreadsheetId;
}

/**
 * Obtiene (o crea en caché) el doc de Google Spreadsheet para el ID activo.
 */
async function getDoc() {
  const id = getCurrentSpreadsheetId();
  if (_docCache.has(id)) return _docCache.get(id);

  const auth = await _getAuth();
  const doc = new GoogleSpreadsheet(id, auth);
  await doc.loadInfo();
  _docCache.set(id, doc);
  logger.info(`Conectado a Google Sheets: "${doc.title}" (${id.substring(0, 12)}...)`);
  return doc;
}

/**
 * Invalida la caché de un spreadsheet (útil después de agregar hojas).
 */
function invalidateDocCache(spreadsheetId = null) {
  const id = spreadsheetId || _currentSpreadsheetId;
  if (id) _docCache.delete(id);
}

async function getSheetsApi() {
  if (_sheetsApi) return _sheetsApi;
  const auth = await _getAuth();
  _sheetsApi = google.sheets({ version: 'v4', auth });
  return _sheetsApi;
}

/**
 * Crea una nueva hoja de cálculo privada para un usuario.
 * @param {string} title - Título de la hoja (ej: "Finanzas - 573219273071")
 * @returns {{ id: string, url: string }}
 */
async function createUserSpreadsheet(title) {
  const sheetsApi = await getSheetsApi();

  // Verificar que el auth tiene credenciales válidas antes de crear
  const auth = await _getAuth();
  const client = await auth.getClient();
  logger.info('[SheetsClient] Auth client type:', client.constructor.name);

  const response = await sheetsApi.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [
        { properties: { title: 'Configuracion', index: 0 } },
      ],
    },
  });

  const id = response.data.spreadsheetId;
  const url = `https://docs.google.com/spreadsheets/d/${id}`;

  logger.info(`Nueva hoja de cálculo creada: "${title}" → ${id}`);
  return { id, url };
}

module.exports = {
  getDoc,
  getSheetsApi,
  setCurrentSpreadsheetId,
  getCurrentSpreadsheetId,
  createUserSpreadsheet,
  invalidateDocCache,
};
