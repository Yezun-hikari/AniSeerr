const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULT_MOVIE_SITES, DEFAULT_SERIES_SITES } = require('./constants');

const SETTINGS_FIELDS = [
  'aniworld_url', 'aniworld_api_key', 'default_movie_path', 'default_series_path',
  'movie_site', 'series_site', 'movie_provider', 'series_provider',
  'movie_language', 'series_language', 'anime_language',
];

// Column name -> definition. Site defaults match the app defaults (old 'megakino'/'sto' dropped aniworld, SPEC §10 #17).
const SETTINGS_COLUMNS = {
  seerr_url: 'TEXT',
  seerr_api_key: 'TEXT',
  aniworld_url: 'TEXT',
  aniworld_api_key: "TEXT DEFAULT ''",
  default_movie_path: "TEXT DEFAULT ''",
  default_series_path: "TEXT DEFAULT ''",
  movie_site: `TEXT DEFAULT '${DEFAULT_MOVIE_SITES}'`,
  series_site: `TEXT DEFAULT '${DEFAULT_SERIES_SITES}'`,
  movie_provider: "TEXT DEFAULT 'VOE'",
  series_provider: "TEXT DEFAULT 'VOE'",
  movie_language: "TEXT DEFAULT 'German Dub'",
  series_language: "TEXT DEFAULT 'German Dub'",
  anime_language: "TEXT DEFAULT 'German Dub'",
};

function migrate(db) {
  const cols = Object.entries(SETTINGS_COLUMNS).map(([n, d]) => `${n} ${d}`).join(',\n  ');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${cols}
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      anime_language TEXT DEFAULT 'German Dub',
      series_language TEXT DEFAULT 'German Dub',
      movie_language TEXT DEFAULT 'German Dub'
    );
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seerr_request_id INTEGER,
      requester TEXT,
      title TEXT,
      type TEXT,
      status TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const existing = new Set(db.prepare('PRAGMA table_info(settings)').all().map((c) => c.name));
  for (const [name, def] of Object.entries(SETTINGS_COLUMNS)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE settings ADD COLUMN ${name} ${def}`);
  }

  db.exec(`
    BEGIN;
    DELETE FROM settings WHERE id <> (SELECT MAX(id) FROM settings);
    DELETE FROM requests WHERE seerr_request_id IS NOT NULL AND id NOT IN (SELECT MAX(id) FROM requests GROUP BY seerr_request_id);
    DROP INDEX IF EXISTS idx_requests_seerr_request_id;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_seerr_request_id_unique ON requests(seerr_request_id);
    CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
    -- Downloads run in the background; one still processing at startup was cut off by a restart.
    UPDATE requests SET status = 'Interrupted' WHERE status = 'Processing Download...';
    UPDATE requests SET status = 'Test received' WHERE status = 'success (Test)';
    UPDATE requests SET status = 'Queued' WHERE status = 'success';
    COMMIT;
  `);
}

function openDb(file) {
  const isMemory = file === ':memory:';
  if (!isMemory) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (!isMemory) db.exec('PRAGMA journal_mode = WAL');
  migrate(db);

  const stmt = {
    latestSettings: db.prepare('SELECT * FROM settings ORDER BY id DESC LIMIT 1'),
    insertSettings: db.prepare('INSERT INTO settings DEFAULT VALUES'),
    upsertRequest: db.prepare(`
      INSERT INTO requests (seerr_request_id, requester, title, type, status) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(seerr_request_id) DO UPDATE SET
        requester = excluded.requester, title = excluded.title, type = excluded.type,
        status = excluded.status, timestamp = CURRENT_TIMESTAMP`),
    setRequestStatus: db.prepare(
      'UPDATE requests SET status = ?, timestamp = CURRENT_TIMESTAMP WHERE seerr_request_id = ?'),
    deleteRequest: db.prepare('DELETE FROM requests WHERE seerr_request_id = ?'),
    getRequests: db.prepare(`
      SELECT id, seerr_request_id, requester, title, type, status, timestamp
      FROM requests ORDER BY timestamp DESC, id DESC LIMIT ?`),
    getUsers: db.prepare('SELECT * FROM users ORDER BY username ASC'),
    getUser: db.prepare('SELECT * FROM users WHERE username = ?'),
    upsertUser: db.prepare(`
      INSERT INTO users (username, anime_language, series_language, movie_language) VALUES (?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET anime_language = excluded.anime_language,
        series_language = excluded.series_language, movie_language = excluded.movie_language`),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  };

  // node:sqlite rows have a null prototype; spread gives a plain, unshared object.
  const loadSettings = () => ({ ...(stmt.latestSettings.get() || {}) });
  let settingsCache = loadSettings();

  return {
    getSettings: () => ({ ...settingsCache }),

    saveSettings(partial) {
      const keys = SETTINGS_FIELDS.filter((k) => partial[k] !== undefined);
      let id = settingsCache.id;
      if (id === undefined) id = stmt.insertSettings.run().lastInsertRowid;
      if (keys.length) {
        // Column names come from the fixed whitelist, never from input.
        db.prepare(`UPDATE settings SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
          .run(...keys.map((k) => partial[k]), id);
      }
      settingsCache = loadSettings();
    },

    upsertRequest({ seerrRequestId, requester, title, type, status }) {
      stmt.upsertRequest.run(seerrRequestId, requester ?? null, title ?? null, type ?? null, status ?? null);
    },

    setRequestStatus: (seerrRequestId, status) =>
      stmt.setRequestStatus.run(status, seerrRequestId).changes > 0,

    deleteRequest(seerrRequestId) {
      stmt.deleteRequest.run(seerrRequestId);
    },

    getRequests: (limit = 100) => stmt.getRequests.all(limit).map((r) => ({ ...r })),
    getUsers: () => stmt.getUsers.all().map((r) => ({ ...r })),

    getUser(username) {
      const row = stmt.getUser.get(username);
      return row ? { ...row } : undefined;
    },

    upsertUser({ username, anime_language, series_language, movie_language }) {
      stmt.upsertUser.run(username, anime_language ?? null, series_language ?? null, movie_language ?? null);
    },

    deleteUser(id) {
      stmt.deleteUser.run(id);
    },

    close: () => db.close(),
  };
}

module.exports = { openDb, SETTINGS_FIELDS };
