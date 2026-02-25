require('dotenv').config();

const { createClient } = require('./whatsapp/client');
const { setupMessageHandler } = require('./whatsapp/messageHandler');
const { getDoc } = require('./sheets/sheetsClient');
const logger = require('./utils/logger');

async function main() {
  logger.info('Iniciando sistema de control de gastos...');

  // Verify Google Sheets connection
  try {
    await getDoc();
    logger.info('Conexión a Google Sheets verificada.');
  } catch (err) {
    logger.error(`Error conectando a Google Sheets: ${err.message}`);
    logger.error('Verifica que credentials/service-account.json existe y GOOGLE_SPREADSHEET_ID está configurado en .env');
    process.exit(1);
  }

  // Initialize WhatsApp client
  const client = createClient();
  setupMessageHandler(client);

  await client.initialize();
  logger.info('WhatsApp inicializado. Esperando mensajes...');
}

main().catch((err) => {
  logger.error(`Error fatal: ${err.message}`);
  process.exit(1);
});
