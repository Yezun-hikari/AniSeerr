const path = require('node:path');

module.exports = {
  port: Number(process.env.PORT) || 5010,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'aniseerr.db'),
  // Empty means disabled; server.js warns at startup.
  adminPassword: process.env.ADMIN_PASSWORD || '',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  // Empty means a random secret per process (sessions end on restart).
  sessionSecret: process.env.SESSION_SECRET || '',
};
