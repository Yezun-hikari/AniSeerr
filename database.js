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
      series_language TEXT DEFAULT 'German Dub',
      anime_language TEXT DEFAULT 'German Dub'
    )
  `);

  // Users table for language exceptions
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      anime_language TEXT DEFAULT 'German Dub',
      series_language TEXT DEFAULT 'German Dub',
      movie_language TEXT DEFAULT 'German Dub'
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
  // Ensure columns exist if table was already created
  const newCols = [
    "movie_site TEXT DEFAULT 'megakino'",
    "series_site TEXT DEFAULT 'sto'",
    "movie_provider TEXT DEFAULT 'VOE'",
    "series_provider TEXT DEFAULT 'VOE'",
    "movie_language TEXT DEFAULT 'German Dub'",
    "series_language TEXT DEFAULT 'German Dub'",
    "anime_language TEXT DEFAULT 'German Dub'",
    "default_movie_path TEXT DEFAULT ''",
    "default_series_path TEXT DEFAULT ''",
    "aniworld_username TEXT DEFAULT ''",
    "aniworld_password TEXT DEFAULT ''"
  ];
  
  newCols.forEach(col => {
    const colName = col.split(' ')[0];
    db.run(`ALTER TABLE settings ADD COLUMN ${col}`, (err) => {
      // Ignore errors if column already exists
    });
  });
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
      series_language,
      anime_language
    } = settings;

    db.run(
      `INSERT INTO settings (seerr_url, seerr_api_key, aniworld_url, aniworld_username, aniworld_password, default_movie_path, default_series_path, movie_site, series_site, movie_provider, series_provider, movie_language, series_language, anime_language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [seerr_url, seerr_api_key, aniworld_url, aniworld_username, aniworld_password, default_movie_path, default_series_path, movie_site, series_site, movie_provider, series_provider, movie_language, series_language, anime_language],
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

// Helper to add or update a request
function addOrUpdateRequest(seerr_request_id, requester, title, type, status) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM requests WHERE seerr_request_id = ?`, [seerr_request_id], (err, row) => {
      if (err) return reject(err);
      if (row) {
        db.run(
          `UPDATE requests SET requester = ?, title = ?, type = ?, status = ?, timestamp = CURRENT_TIMESTAMP WHERE seerr_request_id = ?`,
          [requester, title, type, status, seerr_request_id],
          function (err) {
            if (err) reject(err);
            else resolve(row.id);
          }
        );
      } else {
        db.run(
          `INSERT INTO requests (seerr_request_id, requester, title, type, status) VALUES (?, ?, ?, ?, ?)`,
          [seerr_request_id, requester, title, type, status],
          function (err) {
            if (err) reject(err);
            else resolve(this.lastID);
          }
        );
      }
    });
  });
}

// Helper to delete a request
function deleteRequest(seerr_request_id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM requests WHERE seerr_request_id = ?`, [seerr_request_id], function(err) {
      if (err) reject(err);
      else resolve();
    });
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

// Helper to get all user exceptions
function getUsers() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM users ORDER BY username ASC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// Helper to get a specific user by username
function getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Helper to add or update a user exception
function addOrUpdateUser(username, anime_language, series_language, movie_language) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
      if (err) return reject(err);
      if (row) {
        db.run(
          'UPDATE users SET anime_language = ?, series_language = ?, movie_language = ? WHERE username = ?',
          [anime_language, series_language, movie_language, username],
          function (err) {
            if (err) reject(err);
            else resolve(row.id);
          }
        );
      } else {
        db.run(
          'INSERT INTO users (username, anime_language, series_language, movie_language) VALUES (?, ?, ?, ?)',
          [username, anime_language, series_language, movie_language],
          function (err) {
            if (err) reject(err);
            else resolve(this.lastID);
          }
        );
      }
    });
  });
}

// Helper to delete a user exception
function deleteUser(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM users WHERE id = ?', [id], function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

module.exports = {
  getSettings,
  saveSettings,
  addOrUpdateRequest,
  deleteRequest,
  getRequests,
  getUsers,
  getUserByUsername,
  addOrUpdateUser,
  deleteUser
};
