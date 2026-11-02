const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

function start(config) {
  const db = openDb(':memory:');
  const app = createApp({ db, config: { sessionSecret: '', ...config } });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const req = (path, opts = {}) => fetch(base + path, { redirect: 'manual', ...opts });
      resolve({ db, server, base, req });
    });
  });
}

const form = (data, cookie, extra = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}), ...extra },
  body: new URLSearchParams(data).toString(),
});

let t;
let cookie;

before(async () => {
  t = await start({ adminPassword: 'pw', webhookSecret: 'hooksecret' });
  const res = await t.req('/login', form({ password: 'pw' }));
  cookie = res.headers.get('set-cookie').split(';')[0];
});

after(() => {
  t.server.close();
  t.db.close();
});

test('healthz is open', async () => {
  const res = await t.req('/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('HTML pages redirect to /login without session', async () => {
  for (const path of ['/', '/settings', '/users']) {
    const res = await t.req(path);
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get('location'), '/login');
  }
});

test('API and POST return 401 JSON without session', async () => {
  const api = await t.req('/api/paths');
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: 'Unauthorized' });
  const post = await t.req('/settings', form({ aniworld_url: 'http://x' }));
  assert.equal(post.status, 401);
});

test('login rejects wrong password and accepts correct one', async () => {
  const bad = await t.req('/login', form({ password: 'nope' }));
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /Invalid password/);

  const good = await t.req('/login', form({ password: 'pw' }));
  assert.equal(good.status, 302);
  const setCookie = good.headers.get('set-cookie');
  assert.match(setCookie, /^aniseerr_session=\d+\.[0-9a-f]{64};/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.doesNotMatch(setCookie, /Secure/);

  const page = await t.req('/', { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Accepted Requests/);
  assert.match(html, /Logout/);
});

test('tampered or expired session cookie is rejected', async () => {
  const [expiry, mac] = cookie.split('=')[1].split('.');
  const tampered = `aniseerr_session=${Number(expiry) + 1}.${mac}`;
  assert.equal((await t.req('/', { headers: { Cookie: tampered } })).status, 302);
  assert.equal((await t.req('/', { headers: { Cookie: 'aniseerr_session=garbage' } })).status, 302);
});

test('logout clears the cookie', async () => {
  const res = await t.req('/logout', form({}, cookie));
  assert.equal(res.status, 302);
  assert.match(res.headers.get('set-cookie'), /aniseerr_session=;.*Max-Age=0/);
});

test('webhook requires the secret, exact or Bearer', async () => {
  const body = JSON.stringify({ notification_type: 'TEST_NOTIFICATION' });
  const post = (auth) => t.req('/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body,
  });
  const none = await post();
  assert.equal(none.status, 401);
  assert.deepEqual(await none.json(), { error: 'Unauthorized' });
  assert.equal((await post('wrong')).status, 401);
  const exact = await post('hooksecret');
  assert.equal(exact.status, 200);
  assert.deepEqual(await exact.json(), { status: 'OK - Test Received' });
  assert.equal((await post('Bearer hooksecret')).status, 200);
});

test('cross-origin POST is rejected, same-origin allowed', async () => {
  const evil = await t.req('/users/add', form({ username: 'mallory' }, cookie, { Origin: 'http://evil.example' }));
  assert.equal(evil.status, 403);
  assert.equal(t.db.getUser('mallory'), undefined);

  const ok = await t.req('/users/add', form({ username: 'tim', anime_language: 'German Sub', movie_language: 'bogus' }, cookie, { Origin: t.base }));
  assert.equal(ok.status, 302);
  const user = t.db.getUser('tim');
  assert.equal(user.anime_language, 'German Sub');
  assert.equal(user.movie_language, null);
});

test('settings: API key kept when empty, cleared on request, never rendered', async () => {
  const save = (data) => t.req('/settings', form(data, cookie));

  let res = await save({ aniworld_url: 'localhost:8080/', aniworld_api_key: 'awd_supersecret', movie_provider: 'Vidoza' });
  assert.equal(res.headers.get('location'), '/settings?success=1');
  assert.equal(t.db.getSettings().aniworld_url, 'http://localhost:8080');
  assert.equal(t.db.getSettings().aniworld_api_key, 'awd_supersecret');

  res = await save({ aniworld_url: 'http://localhost:9090', aniworld_api_key: '' });
  assert.equal(res.headers.get('location'), '/settings?success=1');
  const s = t.db.getSettings();
  assert.equal(s.aniworld_api_key, 'awd_supersecret');
  assert.equal(s.aniworld_url, 'http://localhost:9090');
  assert.equal(s.movie_provider, 'Vidoza');

  const html = await (await t.req('/settings?success=1', { headers: { Cookie: cookie } })).text();
  assert.doesNotMatch(html, /awd_supersecret/);
  assert.match(html, /Saved \(leave empty to keep\)/);
  assert.match(html, /Settings saved successfully/);

  await save({ aniworld_url: 'http://localhost:9090', clear_api_key: '1' });
  assert.equal(t.db.getSettings().aniworld_api_key, '');
});

test('settings: invalid URL rejected, error text never echoed', async () => {
  const res = await t.req('/settings', form({ aniworld_url: 'javascript:alert(1)' }, cookie));
  assert.equal(res.headers.get('location'), '/settings?error=Invalid+AniWorld+URL');
  assert.notEqual(t.db.getSettings().aniworld_url, 'javascript:alert(1)');

  const known = await (await t.req('/settings?error=Invalid+AniWorld+URL', { headers: { Cookie: cookie } })).text();
  assert.match(known, /Invalid AniWorld URL/);
  const spoof = await (await t.req('/settings?error=Call+0800-SCAM', { headers: { Cookie: cookie } })).text();
  assert.doesNotMatch(spoof, /SCAM/);
});

test('dashboard renders statuses null-safely with UTC time element', async () => {
  t.db.upsertRequest({ seerrRequestId: 7, requester: 'tim', title: '<b>X</b>', type: 'series', status: 'Queued on aniworld' });
  t.db.upsertRequest({ seerrRequestId: 8, requester: 'tim', title: 'Y', type: 'movie', status: null });
  const html = await (await t.req('/', { headers: { Cookie: cookie } })).text();
  assert.match(html, /bg-success">Queued on aniworld/);
  assert.match(html, /Error: </);
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/);
  assert.match(html, /<time datetime="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ">/);
});

test('/api/paths: 400 when unconfigured', async () => {
  const other = await start({ adminPassword: '' });
  try {
    const res = await other.req('/api/paths');
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'AniWorld URL not configured.' });
  } finally {
    other.server.close();
    other.db.close();
  }
});

test('no password: UI open, no Logout, webhook open without secret', async () => {
  const open = await start({ adminPassword: '', webhookSecret: '' });
  try {
    const res = await open.req('/');
    assert.equal(res.status, 200);
    assert.doesNotMatch(await res.text(), /Logout/);
    assert.equal((await open.req('/login')).status, 302);
    const hook = await open.req('/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(hook.status, 200);
    // CSRF guard still applies without a password.
    const evil = await open.req('/delete-request', form({ seerr_request_id: '1' }, null, { Origin: 'http://evil.example' }));
    assert.equal(evil.status, 403);
  } finally {
    open.server.close();
    open.db.close();
  }
});

test('cookie signed with a known SESSION_SECRET alone is rejected', async () => {
  const s = await start({ adminPassword: 'pw', sessionSecret: 'change-me' });
  try {
    const expiry = Date.now() + 60000;
    const mac = require('node:crypto').createHmac('sha256', 'change-me').update(String(expiry)).digest('hex');
    const res = await s.req('/', { headers: { Cookie: `aniseerr_session=${expiry}.${mac}` } });
    assert.equal(res.status, 302);
  } finally {
    s.server.close();
    s.db.close();
  }
});

test('POST behind a proxy that rewrites Host is allowed via X-Forwarded-Host', async () => {
  const res = await t.req('/users/add', form({ username: 'proxy' }, cookie, { Origin: 'https://ani.example.com', 'X-Forwarded-Host': 'ani.example.com' }));
  assert.equal(res.status, 302);
});

test('settings: site lists keep only supported sites, deduplicated, in order', async () => {
  const save = (data) => t.req('/settings', form(data, cookie));
  await save({ movie_site: 'filmo, cineby,megakino,filmo', series_site: 'sto,aniworld' });
  let s = t.db.getSettings();
  assert.equal(s.movie_site, 'filmo,megakino');
  assert.equal(s.series_site, 'sto,aniworld');
  await save({ movie_site: 'cineby' });
  s = t.db.getSettings();
  assert.equal(s.movie_site, 'filmo,megakino', 'nothing valid: previous value kept');
  const html = await (await t.req('/settings', { headers: { Cookie: cookie } })).text();
  assert.ok(html.includes('data-id="moflix"'), 'unused supported sites are offered');
  assert.ok(!html.includes('cineby'));
});
