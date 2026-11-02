const { createAniWorldClient } = require('./aniworld');
const {
  DEFAULT_LANGUAGE, DEFAULT_PROVIDER, DEFAULT_MOVIE_SITES, DEFAULT_SERIES_SITES,
  MOVIE_SITES, SERIES_SITES, SITE_LANGUAGES, PROVIDERS,
} = require('./constants');

function parseSearchKeyword(rawTitle) {
  if (!rawTitle) return '';
  return rawTitle.replace(/–/g, '-').replace(/×/g, 'x').replace(/\s*\(\d{4}\)\s*$/, '').trim();
}

const TYPE_KINDS = {
  TEST: 'test',
  TEST_NOTIFICATION: 'test',
  '{{event}}': 'test',
  MEDIA_AVAILABLE: 'available',
  MEDIA_PENDING: 'pending',
  MEDIA_DECLINED: 'declined',
  MEDIA_APPROVED: 'approved',
  MEDIA_AUTO_APPROVED: 'approved',
};

function classify(payload, media, request) {
  const kind = TYPE_KINDS[payload.notification_type] || TYPE_KINDS[payload.event];
  if (kind) return kind;
  const ms = media.status;
  const rs = request.status;
  if (ms === 'AVAILABLE' || ms === 5) return 'available';
  if (ms === 'DECLINED' || rs === 'DECLINED') return 'declined';
  if (ms === 'APPROVED' || rs === 'APPROVED') return 'approved';
  if (ms === 'PENDING' || rs === 'PENDING') return 'pending';
  return 'ignored';
}

function parsePayload(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const media = payload.media || payload['{{media}}'] || {};
  const request = payload.request || payload['{{request}}'] || {};
  const extra = payload.extra || payload['{{extra}}'] || [];

  const rawTitle = payload.subject || media.title || payload['{{subject}}'] || 'Unknown Title';
  let extraDetails = '';
  let requestedSeasons = [];
  if (Array.isArray(extra)) {
    for (const item of extra) {
      if (!item || !item.name || !item.value) continue;
      extraDetails += ` (${item.name}: ${item.value})`;
      if (item.name === 'Requested Seasons') {
        requestedSeasons = String(item.value).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      }
    }
  }

  return {
    kind: classify(payload, media, request),
    seerrRequestId: request.request_id || payload['{{request_id}}'] || null,
    requester: request.requestedBy_username || payload['{{requestedBy_username}}'] || 'Unknown User',
    title: rawTitle + extraDetails,
    searchKeyword: parseSearchKeyword(rawTitle),
    type: String(media.media_type || '').toLowerCase() === 'movie' ? 'movie' : 'series',
    requestedSeasons,
  };
}

function resolveLanguage({ type, site, settings = {}, user }) {
  let field = 'series_language';
  if (type === 'movie') field = 'movie_language';
  else if (site === 'aniworld') field = 'anime_language';
  const wanted = (user && user[field]) || settings[field] || DEFAULT_LANGUAGE;
  const offered = SITE_LANGUAGES[site];
  if (!offered || offered.includes(wanted)) return wanted;
  return offered.includes(DEFAULT_LANGUAGE) ? DEFAULT_LANGUAGE : offered[0];
}

// Drops sites AniWorld-Downloader no longer supports (e.g. cineby saved by 1.x).
function sitesFor(isMovie, str) {
  const known = isMovie ? MOVIE_SITES : SERIES_SITES;
  const sites = String(str || '').split(',').map((s) => s.trim()).filter((s) => known.includes(s));
  return sites.length ? sites : (isMovie ? DEFAULT_MOVIE_SITES : DEFAULT_SERIES_SITES).split(',');
}

async function findOnSites(client, keyword, sites) {
  for (const site of sites) {
    try {
      const results = await client.search(keyword, site);
      if (results.length) return { site, results };
    } catch (err) {
      console.error(`Search on ${site} failed:`, err.message);
    }
  }
  return null;
}

async function seriesEpisodes(client, seriesUrl, requestedSeasons) {
  const seasons = (await client.seasons(seriesUrl)).filter((season) => {
    const n = season.season_number;
    if (requestedSeasons.length && n !== null && n !== undefined && !requestedSeasons.includes(parseInt(n, 10))) {
      console.log(`Skipping season ${n} because it was not requested.`);
      return false;
    }
    return true;
  });
  const lists = await Promise.all(seasons.map((season) => client.episodes(season.url, seriesUrl).catch((err) => {
    console.error(`Failed to fetch episodes for season URL ${season.url}:`, err.message);
    return [];
  })));
  return lists.flat();
}

async function runPipeline(db, parsed, client) {
  const settings = db.getSettings();
  if (client === undefined) {
    client = createAniWorldClient({ url: settings.aniworld_url, apiKey: settings.aniworld_api_key });
  }
  if (!client) return 'AniWorld URL not configured';

  const isMovie = parsed.type === 'movie';
  const sites = sitesFor(isMovie, isMovie ? settings.movie_site : settings.series_site);
  const savedProvider = isMovie ? settings.movie_provider : settings.series_provider;
  const provider = PROVIDERS.includes(savedProvider) ? savedProvider : DEFAULT_PROVIDER;
  const pathStr = isMovie ? settings.default_movie_path : settings.default_series_path;
  const customPathId = pathStr ? parseInt(pathStr, 10) : NaN;

  const found = await findOnSites(client, parsed.searchKeyword, sites);
  if (!found) {
    console.log(`Title not found: '${parsed.searchKeyword}' on any site: ${sites.join(', ')}`);
    return 'Not Found';
  }
  const seriesUrl = found.results[0].url;
  console.log(`Found '${parsed.title}' on site '${found.site}'. URL: ${seriesUrl}`);

  let episodes;
  if (isMovie) {
    try {
      episodes = await client.episodes(seriesUrl);
    } catch (err) {
      console.log(`Fetching episodes for movie URL failed (${err.message}), using result URL directly.`);
      episodes = [];
    }
    if (!episodes.length) episodes = [seriesUrl];
  } else {
    episodes = await seriesEpisodes(client, seriesUrl, parsed.requestedSeasons);
    if (!episodes.length) {
      console.log(`No episodes found for series '${parsed.title}'.`);
      return 'No episodes found';
    }
  }

  const user = db.getUser(parsed.requester);
  const payload = {
    episodes,
    language: resolveLanguage({ type: parsed.type, site: found.site, settings, user }),
    provider,
    title: parsed.title,
    series_url: seriesUrl,
  };
  if (!isNaN(customPathId)) payload.custom_path_id = customPathId;
  await client.download(payload);
  console.log(`Successfully queued ${episodes.length} episode(s) for ${parsed.type} '${parsed.title}'.`);
  return `Queued on ${found.site}`;
}

async function processApproved({ db, parsed, client }) {
  let status;
  try {
    status = await runPipeline(db, parsed, client);
  } catch (err) {
    console.error('Webhook download logic error:', err.message);
    status = 'Internal Error';
  }
  if (parsed.seerrRequestId) {
    try {
      db.setRequestStatus(parsed.seerrRequestId, status);
    } catch (err) {
      console.error('Failed to save request status:', err.message);
    }
  }
  return status;
}

function handleWebhook({ db, body, runInBackground = true }) {
  const parsed = parsePayload(body);
  const id = parsed.seerrRequestId;
  const upsert = (status) => id && db.upsertRequest({
    seerrRequestId: id, requester: parsed.requester, title: parsed.title, type: parsed.type, status,
  });
  console.log(`Webhook: kind=${parsed.kind} id=${id} title=${parsed.title}`);

  switch (parsed.kind) {
    case 'test':
      upsert('Test received');
      return { httpStatus: 200, json: { status: 'OK - Test Received' }, done: Promise.resolve() };
    case 'available':
      if (id) db.deleteRequest(id);
      return { httpStatus: 200, json: { status: 'OK - Request removed' }, done: Promise.resolve() };
    case 'declined':
      if (id) db.deleteRequest(id);
      return { httpStatus: 200, json: { status: 'OK - Declined and removed' }, done: Promise.resolve() };
    case 'pending':
      upsert('Pending Approval');
      return { httpStatus: 200, json: { status: 'OK - Pending Added' }, done: Promise.resolve() };
    case 'approved': {
      upsert('Processing Download...');
      // Respond before the slow AniWorld calls so Seerr's webhook doesn't time out.
      const done = processApproved({ db, parsed });
      return { httpStatus: 202, json: { status: 'OK - Approved, processing' }, done };
    }
    default:
      return { httpStatus: 200, json: { status: 'OK' }, done: Promise.resolve() };
  }
}

module.exports = { parseSearchKeyword, parsePayload, resolveLanguage, processApproved, handleWebhook };
