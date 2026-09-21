const test = require('node:test');
const assert = require('node:assert');
const { parseSearchKeyword, getAniWorldClient } = require('../server');
const db = require('../database');

test('parseSearchKeyword cleans up titles correctly', () => {
  assert.strictEqual(parseSearchKeyword('Naruto Shippuden – Movie (2020)'), 'Naruto Shippuden - Movie');
  assert.strictEqual(parseSearchKeyword('Attack on Titan × Final Season (2022)'), 'Attack on Titan x Final Season');
  assert.strictEqual(parseSearchKeyword('One Piece (1999)'), 'One Piece');
});

test('Database operations for settings and requests', async () => {
  await db.saveSettings({
    seerr_url: 'http://localhost:5055',
    aniworld_url: 'http://localhost:8080',
    aniworld_api_key: 'awd_testkey',
    movie_site: 'megakino',
    series_site: 'aniworld,sto'
  });

  const settings = await db.getSettings();
  assert.strictEqual(settings.aniworld_url, 'http://localhost:8080');
  assert.strictEqual(settings.aniworld_api_key, 'awd_testkey');

  await db.addOrUpdateRequest(999, 'testuser', 'Test Anime', 'series', 'Pending Approval');
  let requests = await db.getRequests();
  const req = requests.find(r => r.seerr_request_id === 999);
  assert.ok(req);
  assert.strictEqual(req.requester, 'testuser');
  assert.strictEqual(req.status, 'Pending Approval');

  await db.deleteRequest(999);
  requests = await db.getRequests();
  assert.strictEqual(requests.find(r => r.seerr_request_id === 999), undefined);
});

test('getAniWorldClient constructs client with correct config', async () => {
  await db.saveSettings({
    aniworld_url: 'http://localhost:8080',
    aniworld_api_key: 'awd_secret'
  });

  const client = await getAniWorldClient();
  assert.ok(client);
  assert.strictEqual(client.defaults.baseURL, 'http://localhost:8080');
  assert.strictEqual(client.defaults.headers['X-API-Key'], 'awd_secret');
});
