const config = require('./src/config');
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');

const db = openDb(config.dbPath);
const app = createApp({ db, config });

if (!config.adminPassword) console.warn('WARNING: ADMIN_PASSWORD not set. The web UI is open to anyone who can reach it.');
if (!config.webhookSecret) console.warn('WARNING: WEBHOOK_SECRET not set. POST /webhook accepts unauthenticated requests.');

const server = app.listen(config.port, '0.0.0.0', (err) => {
  if (err) {
    console.error(`Failed to listen on port ${config.port}: ${err.message}`);
    process.exit(1);
  }
  console.log(`AniSeerr running on http://localhost:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeAllConnections();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
