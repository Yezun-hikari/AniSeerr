function normalizeBaseUrl(url) {
  let base = String(url || '').trim();
  if (!base) return '';
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return base.replace(/\/+$/, '');
}

function createAniWorldClient({ url, apiKey } = {}) {
  const base = normalizeBaseUrl(url);
  if (!base) return null;
  const key = String(apiKey || '').trim();

  async function call(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (key) headers['X-API-Key'] = key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    // Path only, no query: the query carries URLs we don't want in logs.
    if (!res.ok) throw new Error(`AniWorld ${method} ${path.split('?')[0]} failed: ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  return {
    async search(keyword, site) {
      const data = await call('POST', '/api/search', { keyword, site });
      return Array.isArray(data.results) ? data.results : [];
    },
    async seasons(url) {
      const data = await call('GET', `/api/seasons?${new URLSearchParams({ url })}`);
      return Array.isArray(data.seasons) ? data.seasons : [];
    },
    async episodes(url, seriesUrl) {
      const q = new URLSearchParams({ url });
      if (seriesUrl) q.set('series_url', seriesUrl);
      const data = await call('GET', `/api/episodes?${q}`);
      return (Array.isArray(data.episodes) ? data.episodes : []).map((ep) => ep && ep.url).filter(Boolean);
    },
    async download(payload) {
      await call('POST', '/api/download', payload);
    },
    customPaths() {
      return call('GET', '/api/custom-paths');
    },
  };
}

module.exports = { createAniWorldClient, normalizeBaseUrl };
