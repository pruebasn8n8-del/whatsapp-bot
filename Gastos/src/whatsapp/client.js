const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('../utils/logger');

function createClient() {
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', (qr) => {
    logger.info('Escanea el código QR con WhatsApp:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    logger.info('WhatsApp conectado y listo.');
  });

  client.on('authenticated', () => {
    logger.info('Autenticación exitosa.');
  });

  client.on('auth_failure', (msg) => {
    logger.error(`Error de autenticación: ${msg}`);
  });

  client.on('disconnected', (reason) => {
    logger.warn(`WhatsApp desconectado: ${reason}`);
  });

  return client;
}

module.exports = { createClient };
