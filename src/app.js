const path = require('node:path');
const express = require('express');
const { createAuth, checkWebhookAuth } = require('./auth');
const { createAniWorldClient, normalizeBaseUrl } = require('./aniworld');
const { handleWebhook } = require('./webhook');
const constants = require('./constants');

const SETTINGS_ERRORS = {
  'Invalid AniWorld URL': 'Invalid AniWorld URL. Use an http:// or https:// address.',
  'Failed to save': 'Failed to save settings.',
};
const TEXT_FIELDS = ['default_movie_path', 'default_series_path'];
const SITE_FIELDS = { movie_site: constants.MOVIE_SITES, series_site: constants.SERIES_SITES };
const PROVIDER_FIELDS = ['movie_provider', 'series_provider'];
const LANGUAGE_FIELDS = ['movie_language', 'series_language', 'anime_language'];

const pickLanguage = (v) => (constants.LANGUAGES.includes(v) ? v : null);

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// Returns the partial settings object, or null when aniworld_url is invalid.
function buildSettingsPartial(body) {
  const partial = {};
  if (body.aniworld_url !== undefined) {
    const url = normalizeBaseUrl(body.aniworld_url);
    if (!isHttpUrl(url)) return null;
    partial.aniworld_url = url;
  }
  if (body.clear_api_key === '1') partial.aniworld_api_key = '';
  else if (typeof body.aniworld_api_key === 'string' && body.aniworld_api_key.trim()) {
    partial.aniworld_api_key = body.aniworld_api_key.trim();
  }
  for (const f of TEXT_FIELDS) if (typeof body[f] === 'string') partial[f] = body[f].trim();
  for (const [f, known] of Object.entries(SITE_FIELDS)) {
    if (typeof body[f] !== 'string') continue;
    const sites = [...new Set(body[f].split(',').map((s) => s.trim()))].filter((s) => known.includes(s));
    if (sites.length) partial[f] = sites.join(',');
  }
  for (const f of PROVIDER_FIELDS) if (constants.PROVIDERS.includes(body[f])) partial[f] = body[f];
  for (const f of LANGUAGE_FIELDS) if (constants.LANGUAGES.includes(body[f])) partial[f] = body[f];
  return partial;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    // Reverse proxies often rewrite Host; accept the forwarded host too.
    const forwarded = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    return host === req.headers.host || (forwarded !== '' && host === forwarded);
  } catch {
    return false; // e.g. Origin: null from sandboxed frames
  }
}

function createApp({ db, config }) {
  const app = express();
  const auth = createAuth({ password: config.adminPassword, secret: config.sessionSecret });

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  Object.assign(app.locals, constants);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    res.locals.authEnabled = auth.enabled;
    next();
  });

  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  app.post('/webhook', (req, res) => {
    if (!checkWebhookAuth(req.headers.authorization, config.webhookSecret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { httpStatus, json } = handleWebhook({ db, body: req.body || {} });
    res.status(httpStatus).json(json);
  });

  app.get('/login', (req, res) => {
    if (!auth.enabled || auth.isAuthenticated(req)) return res.redirect('/');
    res.render('login', { error: null });
  });

  app.post('/login', async (req, res) => {
    if (!auth.enabled) return res.redirect('/');
    if (!auth.checkPassword((req.body || {}).password)) {
      // shortcut: per-request delay only slows serial guessing, add a lockout counter if exposed to the internet.
      await new Promise((r) => setTimeout(r, 1000));
      return res.status(401).render('login', { error: 'Invalid password.' });
    }
    auth.login(req, res);
    res.redirect('/');
  });

  // CSRF guard: browsers always send Origin on cross-site POSTs.
  app.use((req, res, next) => {
    if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    next();
  });

  app.post('/logout', (req, res) => {
    auth.logout(req, res);
    res.redirect(auth.enabled ? '/login' : '/');
  });

  app.use((req, res, next) => {
    if (!auth.enabled || auth.isAuthenticated(req)) return next();
    if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.redirect('/login');
    res.status(401).json({ error: 'Unauthorized' });
  });

  app.get('/', (req, res) => {
    res.render('index', { requests: db.getRequests() });
  });

  app.get('/settings', (req, res) => {
    res.render('settings', {
      settings: db.getSettings(),
      success: req.query.success === '1',
      error: SETTINGS_ERRORS[req.query.error] || null,
    });
  });

  app.post('/settings', (req, res) => {
    const partial = buildSettingsPartial(req.body || {});
    if (!partial) return res.redirect('/settings?error=Invalid+AniWorld+URL');
    try {
      db.saveSettings(partial);
    } catch (err) {
      console.error('Error saving settings:', err.message);
      return res.redirect('/settings?error=Failed+to+save');
    }
    res.redirect('/settings?success=1');
  });

  app.post('/delete-request', (req, res) => {
    const id = (req.body || {}).seerr_request_id;
    if (id) db.deleteRequest(id);
    res.redirect('/');
  });

  app.get('/users', (req, res) => {
    res.render('users', { users: db.getUsers() });
  });

  app.post('/users/add', (req, res) => {
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (username) {
      db.upsertUser({
        username,
        anime_language: pickLanguage(body.anime_language),
        series_language: pickLanguage(body.series_language),
        movie_language: pickLanguage(body.movie_language),
      });
    }
    res.redirect('/users');
  });

  app.post('/users/delete', (req, res) => {
    const id = (req.body || {}).id;
    if (id) db.deleteUser(id);
    res.redirect('/users');
  });

  app.get('/api/paths', async (req, res) => {
    const settings = db.getSettings();
    const client = createAniWorldClient({ url: settings.aniworld_url, apiKey: settings.aniworld_api_key });
    if (!client) return res.status(400).json({ error: 'AniWorld URL not configured.' });
    try {
      res.json(await client.customPaths());
    } catch (err) {
      console.error('Failed to fetch paths from AniWorld:', err.message);
      res.status(500).json({ error: 'Failed to fetch paths from AniWorld.' });
    }
  });

  // Express 5 routes sync throws and async rejections here.
  app.use((err, req, res, next) => {
    console.error(`Error on ${req.method} ${req.path}:`, err.message);
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    const message = status >= 500 ? 'Internal Server Error' : 'Bad Request';
    if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.status(status).type('text').send(message);
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
