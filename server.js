const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 5010;

// Setup EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Helper to get Axios instance for AniWorld Downloader
async function getAniWorldClient() {
  const settings = await db.getSettings();
  if (!settings.aniworld_url) return null;

  let baseURL = settings.aniworld_url.trim();
  if (!baseURL.startsWith('http://') && !baseURL.startsWith('https://')) {
    baseURL = `http://${baseURL}`;
  }
  baseURL = baseURL.replace(/\/+$/, '');

  const headers = {};
  if (settings.aniworld_api_key && settings.aniworld_api_key.trim()) {
    headers['X-API-Key'] = settings.aniworld_api_key.trim();
  }

  return axios.create({
    baseURL,
    timeout: 60000,
    headers,
    maxRedirects: 5,
    validateStatus: status => status >= 200 && status < 400
  });
}

// Helper to parse search title from Seerr webhook subject/title
function parseSearchKeyword(rawTitle) {
  if (!rawTitle) return '';
  return rawTitle
    .replace(/–/g, '-')
    .replace(/×/g, 'x')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim();
}

// ---------------------------------------------------------
// Web UI Routes
// ---------------------------------------------------------

app.get('/', async (req, res) => {
  try {
    const requests = await db.getRequests();
    res.render('index', { requests });
  } catch (err) {
    console.error("Error loading index page:", err);
    res.status(500).send("Error loading requests.");
  }
});

app.get('/settings', async (req, res) => {
  try {
    const settings = await db.getSettings();
    res.render('settings', { 
      settings, 
      success: req.query.success, 
      error: req.query.error 
    });
  } catch (err) {
    console.error("Error loading settings page:", err);
    res.status(500).send("Error loading settings.");
  }
});

app.post('/settings', async (req, res) => {
  try {
    await db.saveSettings(req.body);
    res.redirect('/settings?success=1');
  } catch (err) {
    console.error("Error saving settings:", err);
    res.redirect('/settings?error=Failed+to+save');
  }
});

app.post('/delete-request', async (req, res) => {
  try {
    const { seerr_request_id } = req.body;
    if (seerr_request_id) {
      await db.deleteRequest(seerr_request_id);
    }
    res.redirect('/');
  } catch (err) {
    console.error("Delete request error:", err);
    res.redirect('/');
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await db.getUsers();
    res.render('users', { users });
  } catch (err) {
    console.error("Error loading users page:", err);
    res.status(500).send("Error loading users.");
  }
});

app.post('/users/add', async (req, res) => {
  try {
    const { username, anime_language, series_language, movie_language } = req.body;
    if (username) {
      await db.addOrUpdateUser(username, anime_language, series_language, movie_language);
    }
    res.redirect('/users');
  } catch (err) {
    console.error("Add user error:", err);
    res.redirect('/users');
  }
});

app.post('/users/delete', async (req, res) => {
  try {
    const { id } = req.body;
    if (id) {
      await db.deleteUser(id);
    }
    res.redirect('/users');
  } catch (err) {
    console.error("Delete user error:", err);
    res.redirect('/users');
  }
});

app.get('/api/paths', async (req, res) => {
  try {
    const client = await getAniWorldClient();
    if (!client) {
      return res.status(400).json({ error: "AniWorld URL not configured." });
    }
    const response = await client.get('/api/custom-paths');
    res.json(response.data);
  } catch (err) {
    console.error("Failed to fetch paths from AniWorld:", err.message);
    res.status(500).json({ error: "Failed to fetch paths from AniWorld." });
  }
});

// ---------------------------------------------------------
// Seerr Webhook Endpoint
// ---------------------------------------------------------

app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body || {};
    console.log("Received Webhook from Seerr:", JSON.stringify(payload));

    const notifType = payload.notification_type;
    const eventType = payload.event;
    const mediaObj = payload.media || payload['{{media}}'] || {};
    const reqObj = payload.request || payload['{{request}}'] || {};
    const mediaStatus = mediaObj.status;
    const extraArr = payload.extra || payload['{{extra}}'] || [];

    const isApproved = 
      notifType === 'MEDIA_APPROVED' || notifType === 'MEDIA_AUTO_APPROVED' || 
      eventType === 'MEDIA_APPROVED' || eventType === 'MEDIA_AUTO_APPROVED' ||
      notifType === 'TEST' || eventType === 'TEST' || eventType === '{{event}}' ||
      mediaStatus === 'APPROVED' || mediaStatus === 3 || reqObj.status === 'APPROVED';

    const isPending = !isApproved && (
      notifType === 'MEDIA_PENDING' || eventType === 'MEDIA_PENDING' ||
      mediaStatus === 'PENDING' || reqObj.status === 'PENDING'
    );
    const isDeclined = notifType === 'MEDIA_DECLINED' || eventType === 'MEDIA_DECLINED' ||
      mediaStatus === 'DECLINED' || reqObj.status === 'DECLINED';
    const isAvailable = notifType === 'MEDIA_AVAILABLE' || eventType === 'MEDIA_AVAILABLE' ||
      mediaStatus === 'AVAILABLE' || mediaStatus === 5;

    let extraDetails = "";
    let requestedSeasons = [];
    if (Array.isArray(extraArr)) {
      extraArr.forEach(item => {
        if (item && item.name && item.value) {
          extraDetails += ` (${item.name}: ${item.value})`;
          if (item.name === 'Requested Seasons') {
            requestedSeasons = String(item.value)
              .split(',')
              .map(s => parseInt(s.trim(), 10))
              .filter(n => !isNaN(n));
          }
        }
      });
    }

    const rawTitle = payload.subject || mediaObj.title || payload['{{subject}}'] || "Unknown Title";
    const title = rawTitle + extraDetails;
    const searchKeyword = parseSearchKeyword(rawTitle);

    let type = "series";
    if (mediaObj.media_type) {
      type = mediaObj.media_type.toLowerCase() === 'movie' ? 'movie' : 'series';
    }
    const requester = reqObj.requestedBy_username || payload['{{requestedBy_username}}'] || "Unknown User";
    const seerr_request_id = reqObj.request_id || payload['{{request_id}}'] || null;

    if (notifType === 'TEST' || eventType === 'TEST' || eventType === '{{event}}') {
      console.log("Test Webhook received successfully!");
      if (seerr_request_id) {
        await db.addOrUpdateRequest(seerr_request_id, requester, "Test Request", type, "success (Test)");
      }
      return res.status(200).json({ status: "OK - Test Received" });
    }

    if (isAvailable) {
      console.log(`Media is available. Deleting request ${seerr_request_id} from tracking.`);
      if (seerr_request_id) {
        await db.deleteRequest(seerr_request_id);
      }
      return res.status(200).json({ status: "OK - Request removed" });
    }

    if (isPending) {
      console.log(`Media is pending. Adding request ${seerr_request_id} to tracking.`);
      if (seerr_request_id) {
        await db.addOrUpdateRequest(seerr_request_id, requester, title, type, "Pending Approval");
      }
      return res.status(200).json({ status: "OK - Pending Added" });
    }

    if (isDeclined) {
      console.log(`Media was declined. Deleting request ${seerr_request_id}.`);
      if (seerr_request_id) {
        await db.deleteRequest(seerr_request_id);
      }
      return res.status(200).json({ status: "OK - Declined and removed" });
    }

    if (isApproved) {
      if (seerr_request_id) {
        await db.addOrUpdateRequest(seerr_request_id, requester, title, type, "Processing Download...");
      }

      let queueStatus = "success";
      try {
        const client = await getAniWorldClient();
        if (!client) {
          queueStatus = "AniWorld URL not configured";
          if (seerr_request_id) {
            await db.addOrUpdateRequest(seerr_request_id, requester, title, type, queueStatus);
          }
          return res.status(400).json({ error: queueStatus });
        }

        const settings = await db.getSettings();
        const customPathStr = type === 'movie' ? settings.default_movie_path : settings.default_series_path;
        const customPathId = customPathStr ? parseInt(customPathStr, 10) : null;

        const siteString = type === 'movie'
          ? (settings.movie_site || 'megakino,filmpalast,cineby')
          : (settings.series_site || 'aniworld,sto');
        const sites = siteString.split(',').map(s => s.trim()).filter(Boolean);
        const provider = type === 'movie'
          ? (settings.movie_provider || 'VOE')
          : (settings.series_provider || 'VOE');

        const userException = await db.getUserByUsername(requester);

        let results = null;
        let foundSite = null;

        for (const s of sites) {
          try {
            const searchResp = await client.post('/api/search', { keyword: searchKeyword, site: s });
            if (searchResp.data && searchResp.data.results && searchResp.data.results.length > 0) {
              results = searchResp.data.results;
              foundSite = s;
              break;
            }
          } catch (searchErr) {
            console.log(`Search on ${s} failed:`, searchErr.message);
          }
        }

        if (!results || results.length === 0) {
          queueStatus = "Not Found";
          console.log(`Title not found: '${searchKeyword}' on any site: ${sites.join(', ')}`);
        } else {
          const firstResultUrl = results[0].url;
          console.log(`Found '${title}' on site '${foundSite}'. URL: ${firstResultUrl}`);

          let languageToUse = 'German Dub';
          if (type === 'movie') {
            languageToUse = userException ? userException.movie_language : (settings.movie_language || 'German Dub');
          } else {
            if (foundSite === 'aniworld') {
              languageToUse = userException ? userException.anime_language : (settings.anime_language || 'German Dub');
            } else {
              languageToUse = userException ? userException.series_language : (settings.series_language || 'German Dub');
            }
          }

          if (type === 'movie') {
            let episodeUrls = [];
            try {
              const epResp = await client.get('/api/episodes', { params: { url: firstResultUrl } });
              const episodesData = epResp.data.episodes || [];
              episodeUrls = episodesData.map(ep => ep.url).filter(Boolean);
            } catch (epErr) {
              console.log(`Fetching episodes for movie URL failed (${epErr.message}), using result URL directly.`);
            }

            if (episodeUrls.length === 0) {
              episodeUrls = [firstResultUrl];
            }

            const downloadPayload = {
              episodes: episodeUrls,
              language: languageToUse,
              provider: provider,
              title: title,
              series_url: firstResultUrl
            };
            if (customPathId !== null && !isNaN(customPathId)) {
              downloadPayload.custom_path_id = customPathId;
            }

            await client.post('/api/download', downloadPayload);
            console.log(`Successfully queued movie '${title}'.`);
          } else {
            const seasonsResp = await client.get('/api/seasons', { params: { url: firstResultUrl } });
            const seasons = seasonsResp.data.seasons || [];

            let allEpisodes = [];
            for (const season of seasons) {
              if (requestedSeasons.length > 0 && season.season_number !== undefined && season.season_number !== null) {
                if (!requestedSeasons.includes(parseInt(season.season_number, 10))) {
                  console.log(`Skipping season ${season.season_number} because it was not requested.`);
                  continue;
                }
              }

              try {
                const episodesResp = await client.get('/api/episodes', {
                  params: { url: season.url, series_url: firstResultUrl }
                });
                const episodes = episodesResp.data.episodes || [];
                for (const ep of episodes) {
                  if (ep.url) {
                    allEpisodes.push(ep.url);
                  }
                }
              } catch (epErr) {
                console.error(`Failed to fetch episodes for season URL ${season.url}:`, epErr.message);
              }
            }

            if (allEpisodes.length > 0) {
              const downloadPayload = {
                episodes: allEpisodes,
                language: languageToUse,
                provider: provider,
                title: title,
                series_url: firstResultUrl
              };
              if (customPathId !== null && !isNaN(customPathId)) {
                downloadPayload.custom_path_id = customPathId;
              }

              await client.post('/api/download', downloadPayload);
              console.log(`Successfully queued ${allEpisodes.length} episodes for series '${title}'.`);
            } else {
              queueStatus = "No episodes found";
              console.log(`No episodes found for series '${title}'.`);
            }
          }
        }

        const dbStatus = queueStatus === 'success' ? `Queued on ${foundSite}` : queueStatus;
        if (seerr_request_id) {
          await db.addOrUpdateRequest(seerr_request_id, requester, title, type, dbStatus);
        }

        return res.status(200).json({ status: "OK - Approved and Processed", details: dbStatus });
      } catch (err) {
        console.error("Webhook download logic error:", err.response ? err.response.data : err.message);
        if (seerr_request_id) {
          await db.addOrUpdateRequest(seerr_request_id, requester, title, type, "Internal Error");
        }
        return res.status(500).json({ error: "Failed to queue download with AniWorld" });
      }
    }

    res.status(200).json({ status: "OK" });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Export app and getAniWorldClient for testing
module.exports = { app, getAniWorldClient, parseSearchKeyword };

// Start Server if run directly
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AniSeerr running on http://localhost:${PORT}`);
  });
}
