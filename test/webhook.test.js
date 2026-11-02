const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  parseSearchKeyword, parsePayload, resolveLanguage, processApproved, handleWebhook,
} = require('../src/webhook');

// Fake db implementing the contract methods webhook.js uses; records calls.
function fakeDb(settings = {}, users = {}) {
  const calls = [];
  return {
    calls,
    getSettings: () => ({ ...settings }),
    getUser: (name) => users[name],
    upsertRequest: (r) => calls.push(['upsert', r]),
    setRequestStatus: (id, status) => { calls.push(['status', id, status]); return true; },
    deleteRequest: (id) => calls.push(['delete', id]),
  };
}

// Fake AniWorld: per-test handlers keyed by path; records requests.
let server;
let url;
let routes = {};
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const rec = { method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: body ? JSON.parse(body) : null, headers: req.headers };
      seen.push(rec);
      const [status, json] = (routes[u.pathname] || (() => [404, {}]))(rec);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.closeAllConnections(); server.close(); });

function reset(r) {
  routes = r;
  seen.length = 0;
}

const downloads = () => seen.filter((r) => r.path === '/api/download').map((r) => r.body);

test('parseSearchKeyword (SPEC §8)', () => {
  assert.equal(parseSearchKeyword('Naruto Shippuden – Movie (2020)'), 'Naruto Shippuden - Movie');
  assert.equal(parseSearchKeyword('Attack on Titan × Final Season (2022)'), 'Attack on Titan x Final Season');
  assert.equal(parseSearchKeyword('One Piece (1999)'), 'One Piece');
  assert.equal(parseSearchKeyword(''), '');
  assert.equal(parseSearchKeyword(undefined), '');
});

test('parsePayload fields (default Seerr template)', () => {
  const p = parsePayload({
    notification_type: 'MEDIA_APPROVED',
    subject: 'One Piece (1999)',
    '{{media}}': { media_type: 'tv', status: 'PROCESSING' },
    '{{request}}': { request_id: '12', requestedBy_username: 'tim', requestedBy_email: 'x@y' },
    '{{extra}}': [{ name: 'Requested Seasons', value: '1, 2,x' }, { name: 'Empty', value: '' }],
  });
  assert.deepEqual(p, {
    kind: 'approved',
    seerrRequestId: '12',
    requester: 'tim',
    title: 'One Piece (1999) (Requested Seasons: 1, 2,x)',
    searchKeyword: 'One Piece',
    type: 'series',
    requestedSeasons: [1, 2],
  });
  const q = parsePayload({ media: { media_type: 'MOVIE', title: 'Dune' } });
  assert.equal(q.type, 'movie');
  assert.equal(q.title, 'Dune');
  assert.equal(q.requester, 'Unknown User');
  assert.equal(q.seerrRequestId, null);
  assert.equal(parsePayload(null).title, 'Unknown Title');
});

test('classification table', () => {
  const k = (b) => parsePayload(b).kind;
  assert.equal(k({ notification_type: 'TEST' }), 'test');
  assert.equal(k({ notification_type: 'TEST_NOTIFICATION' }), 'test'); // #11
  assert.equal(k({ event: '{{event}}' }), 'test');
  assert.equal(k({ event: 'TEST' }), 'test');
  assert.equal(k({ notification_type: 'MEDIA_AVAILABLE' }), 'available');
  assert.equal(k({ notification_type: 'MEDIA_PENDING' }), 'pending');
  assert.equal(k({ notification_type: 'MEDIA_DECLINED' }), 'declined');
  assert.equal(k({ notification_type: 'MEDIA_AUTO_APPROVED' }), 'approved');
  // #13: approved type wins over AVAILABLE media status.
  assert.equal(k({ notification_type: 'MEDIA_APPROVED', media: { status: 'AVAILABLE' } }), 'approved');
  // #14: declined type wins over PENDING media status.
  assert.equal(k({ notification_type: 'MEDIA_DECLINED', media: { status: 'PENDING' } }), 'declined');
  // status fallback when type missing/unknown
  assert.equal(k({ media: { status: 5 } }), 'available');
  assert.equal(k({ media: { status: 'AVAILABLE' } }), 'available');
  assert.equal(k({ request: { status: 'DECLINED' } }), 'declined');
  assert.equal(k({ event: 'OTHER', media: { status: 'APPROVED' } }), 'approved');
  assert.equal(k({ request: { status: 'APPROVED' } }), 'approved');
  assert.equal(k({ media: { status: 'PENDING' } }), 'pending');
  assert.equal(k({ media: { status: 3 } }), 'ignored'); // 3 = PROCESSING
  assert.equal(k({}), 'ignored');
});

test('resolveLanguage', () => {
  const settings = { movie_language: 'English Sub', anime_language: 'German Sub', series_language: '' };
  assert.equal(resolveLanguage({ type: 'movie', site: 'x', settings }), 'English Sub');
  // Site can't deliver the wanted language: fall back to one it offers.
  assert.equal(resolveLanguage({ type: 'movie', site: 'megakino', settings }), 'German Dub');
  assert.equal(resolveLanguage({ type: 'series', site: 'sto', settings: { series_language: 'English Dub' } }), 'English Dub');
  assert.equal(resolveLanguage({ type: 'series', site: 'sto', settings: { series_language: 'German Sub' } }), 'German Dub');
  assert.equal(resolveLanguage({ type: 'series', site: 'aniworld', settings }), 'German Sub');
  assert.equal(resolveLanguage({ type: 'series', site: 'sto', settings }), 'German Dub');
  const user = { movie_language: 'English Dub', anime_language: null };
  assert.equal(resolveLanguage({ type: 'movie', site: 'x', settings, user }), 'English Dub');
  // #18: null user language falls back to global setting.
  assert.equal(resolveLanguage({ type: 'series', site: 'aniworld', settings, user }), 'German Sub');
  assert.equal(resolveLanguage({ type: 'movie', site: 'x', settings: {} }), 'German Dub');
});

test('processApproved: movie', async () => {
  reset({
    '/api/search': (r) => (r.body.site === 'filmpalast' ? [200, { results: [{ url: 'http://m/dune' }] }] : [200, { results: [] }]),
    '/api/episodes': () => [200, { episodes: [] }],
    '/api/download': () => [200, {}],
  });
  const db = fakeDb({ aniworld_url: url, aniworld_api_key: 'awd_k', default_movie_path: '3', movie_provider: 'Vidoza' }, { tim: { movie_language: 'English Sub' } });
  const parsed = parsePayload({ notification_type: 'MEDIA_APPROVED', subject: 'Dune (2021)', media: { media_type: 'movie' }, request: { request_id: '7', requestedBy_username: 'tim' } });
  const status = await processApproved({ db, parsed });
  assert.equal(status, 'Queued on filmpalast');
  assert.deepEqual(seen.filter((r) => r.path === '/api/search').map((r) => r.body), [
    { keyword: 'Dune', site: 'megakino' }, { keyword: 'Dune', site: 'filmpalast' },
  ]);
  assert.deepEqual(downloads(), [{
    episodes: ['http://m/dune'], language: 'German Dub', provider: 'Vidoza', title: 'Dune (2021)', series_url: 'http://m/dune', custom_path_id: 3,
  }]);
  assert.ok(seen.every((r) => r.headers['x-api-key'] === 'awd_k'));
  assert.deepEqual(db.calls, [['status', '7', 'Queued on filmpalast']]);
});

test('processApproved: series with season filter', async () => {
  reset({
    '/api/search': () => [200, { results: [{ url: 'http://a/op' }] }],
    '/api/seasons': () => [200, { seasons: [{ url: 's1', season_number: 1 }, { url: 's2', season_number: '2' }, { url: 's3', season_number: 3 }] }],
    '/api/episodes': (r) => (r.query.url === 's2' ? [500, {}] : [200, { episodes: [{ url: `${r.query.url}e1` }, { url: `${r.query.url}e2` }] }]),
    '/api/download': () => [200, {}],
  });
  const db = fakeDb({ aniworld_url: url, anime_language: 'German Sub' });
  const parsed = parsePayload({
    notification_type: 'MEDIA_APPROVED', subject: 'One Piece (1999)', '{{media}}': { media_type: 'tv' },
    '{{request}}': { request_id: '12' }, '{{extra}}': [{ name: 'Requested Seasons', value: '1,2' }],
  });
  assert.equal(await processApproved({ db, parsed }), 'Queued on aniworld');
  const eps = seen.filter((r) => r.path === '/api/episodes');
  assert.deepEqual(eps.map((r) => r.query.url).sort(), ['s1', 's2']);
  assert.ok(eps.every((r) => r.query.series_url === 'http://a/op'));
  assert.deepEqual(downloads(), [{
    episodes: ['s1e1', 's1e2'], language: 'German Sub', provider: 'VOE', title: 'One Piece (1999) (Requested Seasons: 1,2)', series_url: 'http://a/op',
  }]);
});

test('processApproved: not found / no episodes / not configured', async () => {
  reset({ '/api/search': (r) => (r.body.site === 'aniworld' ? [500, {}] : [200, { results: [] }]) });
  const db = fakeDb({ aniworld_url: url });
  const parsed = parsePayload({ subject: 'Nope', request: { request_id: '1' } });
  assert.equal(await processApproved({ db, parsed }), 'Not Found');
  assert.deepEqual(db.calls, [['status', '1', 'Not Found']]);

  reset({ '/api/search': () => [200, { results: [{ url: 'u' }] }], '/api/seasons': () => [200, { seasons: [] }] });
  assert.equal(await processApproved({ db, parsed }), 'No episodes found');
  assert.equal(downloads().length, 0);

  const empty = fakeDb({});
  assert.equal(await processApproved({ db: empty, parsed }), 'AniWorld URL not configured');
});

test('processApproved: download error -> Internal Error', async () => {
  reset({
    '/api/search': () => [200, { results: [{ url: 'u' }] }],
    '/api/episodes': () => [200, { episodes: [{ url: 'e' }] }],
    '/api/download': () => [500, { error: 'boom' }],
  });
  const db = fakeDb({ aniworld_url: url });
  const parsed = parsePayload({ subject: 'Dune', media: { media_type: 'movie' }, request: { request_id: '9' } });
  assert.equal(await processApproved({ db, parsed }), 'Internal Error');
  assert.deepEqual(db.calls, [['status', '9', 'Internal Error']]);
});

test('handleWebhook dispatch', async () => {
  const req = { request: { request_id: '5', requestedBy_username: 'tim' }, subject: 'X' };
  let db = fakeDb();
  let r = handleWebhook({ db, body: { ...req, notification_type: 'TEST_NOTIFICATION' } });
  assert.deepEqual([r.httpStatus, r.json], [200, { status: 'OK - Test Received' }]);
  assert.equal(db.calls[0][1].status, 'Test received');

  db = fakeDb();
  r = handleWebhook({ db, body: { ...req, notification_type: 'MEDIA_AVAILABLE' } });
  assert.deepEqual(r.json, { status: 'OK - Request removed' });
  assert.deepEqual(db.calls, [['delete', '5']]);

  db = fakeDb();
  r = handleWebhook({ db, body: { ...req, notification_type: 'MEDIA_DECLINED' } });
  assert.deepEqual(r.json, { status: 'OK - Declined and removed' });

  db = fakeDb();
  r = handleWebhook({ db, body: { ...req, notification_type: 'MEDIA_PENDING' } });
  assert.deepEqual(r.json, { status: 'OK - Pending Added' });
  assert.deepEqual(db.calls[0], ['upsert', { seerrRequestId: '5', requester: 'tim', title: 'X', type: 'series', status: 'Pending Approval' }]);

  db = fakeDb();
  r = handleWebhook({ db, body: { notification_type: 'SOMETHING' } });
  assert.deepEqual([r.httpStatus, r.json, db.calls], [200, { status: 'OK' }, []]);
});

test('handleWebhook approved responds 202 before processing finishes', async () => {
  reset({ '/api/search': () => [200, { results: [] }] });
  const db = fakeDb({ aniworld_url: url, series_site: 'sto' });
  const r = handleWebhook({ db, body: { notification_type: 'MEDIA_APPROVED', subject: 'Y', request: { request_id: '8' } } });
  assert.deepEqual([r.httpStatus, r.json], [202, { status: 'OK - Approved, processing' }]);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0][1].status, 'Processing Download...');
  await r.done;
  assert.deepEqual(db.calls[1], ['status', '8', 'Not Found']);
});

test('processApproved: stale 1.x settings (cineby, Streamtape) are ignored', async () => {
  reset({
    '/api/search': () => [200, { results: [] }],
  });
  const db = fakeDb({ aniworld_url: url, movie_site: 'cineby,megakino', movie_provider: 'Streamtape' });
  const parsed = parsePayload({ notification_type: 'MEDIA_APPROVED', subject: 'Dune', media: { media_type: 'movie' }, request: { request_id: '9' } });
  assert.equal(await processApproved({ db, parsed }), 'Not Found');
  assert.deepEqual(seen.map((r) => r.body.site), ['megakino']);

  reset({
    '/api/search': () => [200, { results: [{ url: 'http://m/x' }] }],
    '/api/episodes': () => [200, { episodes: [] }],
    '/api/download': () => [200, {}],
  });
  const db2 = fakeDb({ aniworld_url: url, movie_site: 'cineby', movie_provider: 'Streamtape' });
  assert.equal(await processApproved({ db: db2, parsed }), 'Queued on megakino');
  assert.equal(downloads()[0].provider, 'VOE');
});
