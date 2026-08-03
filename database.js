const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

const db = new sqlite3.Database(path.join(dbDir, 'aniseerr.db'));

db.serialize(() => {
  // Settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seerr_url TEXT,
      seerr_api_key TEXT,
      aniworld_url TEXT,
      aniworld_username TEXT,
      aniworld_password TEXT,
      default_movie_path TEXT,
      default_series_path TEXT,
      movie_site TEXT DEFAULT 'megakino',
      series_site TEXT DEFAULT 'sto',
      movie_provider TEXT DEFAULT 'VOE',
      series_provider TEXT DEFAULT 'VOE',
      movie_language TEXT DEFAULT 'German Dub',
      series_language TEXT DEFAULT 'German Dub'
    )
  `);

  // Requests table
  db.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seerr_request_id INTEGER,
      requester TEXT,
      title TEXT,
      type TEXT,
      status TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Helper to get settings
function getSettings() {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM settings ORDER BY id DESC LIMIT 1', (err, row) => {
      if (err) reject(err);
      else resolve(row || {});
    });
  });
}

// Helper to save settings
function saveSettings(settings) {
  return new Promise((resolve, reject) => {
    const {
      seerr_url,
      seerr_api_key,
      aniworld_url,
      aniworld_username,
      aniworld_password,
      default_movie_path,
      default_series_path,
      movie_site,
      series_site,
      movie_provider,
      series_provider,
      movie_language,
      series_language
    } = settings;

    db.run(
      `INSERT INTO settings (seerr_url, seerr_api_key, aniworld_url, aniworld_username, aniworld_password, default_movie_path, default_series_path, movie_site, series_site, movie_provider, series_provider, movie_language, series_language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [seerr_url, seerr_api_key, aniworld_url, aniworld_username, aniworld_password, default_movie_path, default_series_path, movie_site, series_site, movie_provider, series_provider, movie_language, series_language],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

// Helper to add a request
function addRequest(seerr_request_id, requester, title, type, status) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO requests (seerr_request_id, requester, title, type, status) VALUES (?, ?, ?, ?, ?)`,
      [seerr_request_id, requester, title, type, status],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

// Helper to get all requests
function getRequests() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM requests ORDER BY timestamp DESC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

module.exports = {
  getSettings,
  saveSettings,
  addRequest,
  getRequests
};
