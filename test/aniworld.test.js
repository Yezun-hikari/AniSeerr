const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createAniWorldClient, normalizeBaseUrl } = require('../src/aniworld');

let server;
let base;
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      const path = req.url.split('?')[0];
      const reply = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (path === '/api/search') return reply(200, { results: [{ url: 'http://x/a' }] });
      if (path === '/api/seasons') return reply(200, { seasons: [{ url: 's1', season_number: 1 }] });
      if (path === '/api/episodes') return reply(200, { episodes: [{ url: 'e1' }, {}, { url: 'e2' }] });
      if (path === '/api/custom-paths') return reply(200, { paths: [{ id: 1, name: 'Anime' }] });
      if (path === '/api/download') return reply(500, { error: 'secret detail' });
      reply(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `127.0.0.1:${server.address().port}/`;
});

after(() => { server.closeAllConnections(); server.close(); });

test('normalizeBaseUrl', () => {
  assert.equal(normalizeBaseUrl('  localhost:8080// '), 'http://localhost:8080');
  assert.equal(normalizeBaseUrl('https://a.b/x/'), 'https://a.b/x');
  assert.equal(normalizeBaseUrl(''), '');
});

test('null client when url blank', () => {
  assert.equal(createAniWorldClient({ url: '  ', apiKey: 'k' }), null);
});

test('methods, headers and query params', async () => {
  seen.length = 0;
  const c = createAniWorldClient({ url: base, apiKey: 'awd_key' });
  assert.deepEqual(await c.search('One Piece', 'aniworld'), [{ url: 'http://x/a' }]);
  assert.deepEqual(await c.seasons('http://x/a'), [{ url: 's1', season_number: 1 }]);
  assert.deepEqual(await c.episodes('s1', 'http://x/a'), ['e1', 'e2']);
  assert.deepEqual(await c.customPaths(), { paths: [{ id: 1, name: 'Anime' }] });
  assert.equal(seen[0].method, 'POST');
  assert.deepEqual(seen[0].body, { keyword: 'One Piece', site: 'aniworld' });
  assert.ok(seen.every((r) => r.headers['x-api-key'] === 'awd_key'));
  assert.equal(seen[2].url, `/api/episodes?url=s1&series_url=${encodeURIComponent('http://x/a')}`);
});

test('no X-API-Key header without key', async () => {
  seen.length = 0;
  await createAniWorldClient({ url: base }).customPaths();
  assert.equal(seen[0].headers['x-api-key'], undefined);
});

test('non-2xx throws without body or key', async () => {
  const c = createAniWorldClient({ url: base, apiKey: 'awd_key' });
  await assert.rejects(c.download({ episodes: [] }), (err) => {
    assert.equal(err.message, 'AniWorld POST /api/download failed: 500');
    return true;
  });
});
