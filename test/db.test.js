const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aniseerr-'));
  return path.join(dir, 'nested', 'aniseerr.db');
}

// Oldest settings shape (before the ALTER migrations) plus the old requests schema without UNIQUE.
function buildOldDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seerr_url TEXT,
      seerr_api_key TEXT,
      aniworld_url TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      anime_language TEXT DEFAULT 'German Dub',
      series_language TEXT DEFAULT 'German Dub',
      movie_language TEXT DEFAULT 'German Dub'
    );
    CREATE TABLE requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seerr_request_id INTEGER,
      requester TEXT,
      title TEXT,
      type TEXT,
      status TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_requests_seerr_request_id ON requests(seerr_request_id);
    CREATE INDEX idx_requests_timestamp ON requests(timestamp);
    INSERT INTO settings (seerr_url, aniworld_url) VALUES ('http://s1', 'http://old1');
    INSERT INTO settings (seerr_url, aniworld_url) VALUES ('http://s2', 'http://old2');
    INSERT INTO settings (seerr_url, aniworld_url) VALUES ('http://s3', 'http://latest');
    INSERT INTO requests (seerr_request_id, title, status) VALUES (1, 'A-old', 'Pending Approval');
    INSERT INTO requests (seerr_request_id, title, status) VALUES (2, 'B', 'Queued on sto');
    INSERT INTO requests (seerr_request_id, title, status) VALUES (1, 'A-new', 'Queued on aniworld');
    INSERT INTO users (username, anime_language) VALUES ('tim', 'English Sub');
  `);
  old.close();
}

test('migrates an old-schema database', () => {
  const file = tmpFile();
  buildOldDb(file);

  for (let i = 0; i < 2; i++) { // second open proves idempotency
    const db = openDb(file);
    const s = db.getSettings();
    assert.equal(s.aniworld_url, 'http://latest');
    assert.equal(s.seerr_url, 'http://s3');
    assert.equal(s.anime_language, 'German Dub');
    assert.equal(s.series_site, 'aniworld,sto');
    assert.equal(s.aniworld_api_key, '');

    const reqs = db.getRequests();
    assert.equal(reqs.length, 2);
    assert.deepEqual(reqs.filter((r) => r.seerr_request_id === 1).map((r) => r.title), ['A-new']);
    assert.equal(db.getUser('tim').anime_language, 'English Sub');

    // upsert on the migrated table must now hit the unique index
    db.upsertRequest({ seerrRequestId: 2, requester: 'x', title: 'B2', type: 'tv', status: 'Pending Approval' });
    assert.equal(db.getRequests().length, 2);
    db.close();
  }

  const raw = new DatabaseSync(file);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM settings').get().n, 1);
  const idx = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'requests'").all().map((r) => r.name);
  assert.ok(idx.includes('idx_requests_seerr_request_id_unique'));
  assert.ok(idx.includes('idx_requests_timestamp'));
  assert.ok(!idx.includes('idx_requests_seerr_request_id'));
  assert.equal(raw.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  raw.close();
});

test('settings: partial save keeps other fields, never appends rows, returns copies', () => {
  const db = openDb(':memory:');
  assert.deepEqual(db.getSettings(), {});
  db.saveSettings({ aniworld_url: 'http://a', aniworld_api_key: 'awd_key', movie_language: 'English Sub' });
  db.saveSettings({ aniworld_url: 'http://b', aniworld_api_key: undefined, seerr_url: 'ignored', bogus: 'x' });

  const s = db.getSettings();
  assert.equal(s.aniworld_url, 'http://b');
  assert.equal(s.aniworld_api_key, 'awd_key');
  assert.equal(s.movie_language, 'English Sub');
  assert.equal(s.movie_site, 'megakino,filmpalast,filmo,moflix');
  assert.equal(s.seerr_url, null);
  assert.equal(s.bogus, undefined);
  assert.equal(s.id, 1);

  s.aniworld_url = 'mutated';
  assert.equal(db.getSettings().aniworld_url, 'http://b');
  db.close();
});

test('requests: upsert is atomic, no duplicates, newest first', () => {
  const db = openDb(':memory:');
  db.upsertRequest({ seerrRequestId: 5, requester: 'u', title: 'T', type: 'movie', status: 'Pending Approval' });
  db.upsertRequest({ seerrRequestId: '5', requester: 'u', title: 'T2', type: 'movie', status: 'Processing Download...' });
  db.upsertRequest({ seerrRequestId: 6, requester: 'v', title: 'U', type: 'tv', status: 'Pending Approval' });

  const rows = db.getRequests();
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'requester', 'seerr_request_id', 'status', 'timestamp', 'title', 'type']);
  assert.equal(rows[0].seerr_request_id, 6); // same timestamp, higher id first
  assert.equal(rows[1].title, 'T2');
  assert.equal(rows[1].status, 'Processing Download...');
  assert.equal(db.getRequests(1).length, 1);
  db.close();
});

test('requests: setRequestStatus never resurrects deleted rows', () => {
  const db = openDb(':memory:');
  db.upsertRequest({ seerrRequestId: 7, requester: 'u', title: 'T', type: 'tv', status: 'Processing Download...' });
  assert.equal(db.setRequestStatus(7, 'Queued on aniworld'), true);
  assert.equal(db.getRequests()[0].status, 'Queued on aniworld');

  db.deleteRequest(7);
  assert.equal(db.setRequestStatus(7, 'Queued on aniworld'), false);
  assert.equal(db.getRequests().length, 0);
  db.close();
});

test('users: upsert, get, list, delete', () => {
  const db = openDb(':memory:');
  db.upsertUser({ username: 'zoe', anime_language: 'German Sub', series_language: null, movie_language: null });
  db.upsertUser({ username: 'amy', anime_language: 'English Dub', series_language: 'English Sub', movie_language: 'German Dub' });
  db.upsertUser({ username: 'zoe', anime_language: 'English Sub', series_language: 'German Dub', movie_language: null });

  assert.deepEqual(db.getUsers().map((u) => u.username), ['amy', 'zoe']);
  const zoe = db.getUser('zoe');
  assert.equal(zoe.anime_language, 'English Sub');
  assert.equal(zoe.series_language, 'German Dub');
  assert.equal(zoe.movie_language, null);
  assert.equal(db.getUser('Zoe'), undefined);

  db.deleteUser(zoe.id);
  assert.equal(db.getUser('zoe'), undefined);
  db.close();
});

test('startup marks interrupted downloads and maps 1.x status strings', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aniseerr-')), 'a.db');
  let db = openDb(file);
  db.upsertRequest({ seerrRequestId: 1, requester: 'a', title: 't', type: 'series', status: 'Processing Download...' });
  db.upsertRequest({ seerrRequestId: 2, requester: 'a', title: 't', type: 'series', status: 'success (Test)' });
  db.close();
  db = openDb(file);
  const byId = Object.fromEntries(db.getRequests().map((r) => [r.seerr_request_id, r.status]));
  assert.deepEqual(byId, { 1: 'Interrupted', 2: 'Test received' });
  db.close();
});
