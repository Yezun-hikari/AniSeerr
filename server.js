const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const db = require('./database');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5010;

// Setup EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Helper to get Axios instance for AniWorld
async function getAniWorldClient() {
  const settings = await db.getSettings();
  if (!settings.aniworld_url) return null;
  
  let auth = undefined;
  if (settings.aniworld_username && settings.aniworld_password) {
    auth = {
      username: settings.aniworld_username,
      password: settings.aniworld_password
    };
  }
  
  return axios.create({
    baseURL: settings.aniworld_url,
    auth: auth
  });
}

// ---------------------------------------------------------
// Routes
// ---------------------------------------------------------

app.get('/', async (req, res) => {
  try {
    const requests = await db.getRequests();
    res.render('index', { requests });
  } catch (err) {
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
    res.status(500).send("Error loading settings.");
  }
});

app.post('/settings', async (req, res) => {
  try {
    await db.saveSettings(req.body);
    res.redirect('/settings?success=1');
  } catch (err) {
    res.redirect('/settings?error=Failed+to+save');
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
    res.status(500).json({ error: "Failed to fetch paths from AniWorld." });
  }
});

// ---------------------------------------------------------
// Seerr Webhook Endpoint
// ---------------------------------------------------------
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log("Received Webhook from Seerr:", payload);
    
    // Check if this is an approved request
    // Seerr payload typically has notification_type or event
    const notifType = payload.notification_type;
    const eventType = payload.event;
    const mediaObj = payload.media || payload['{{media}}'] || {};
    const reqObj = payload.request || payload['{{request}}'] || {};
    const mediaStatus = mediaObj.status;
    
    const isApproved = 
      notifType === 'MEDIA_APPROVED' || notifType === 'MEDIA_AUTO_APPROVED' || 
      eventType === 'MEDIA_APPROVED' || eventType === 'MEDIA_AUTO_APPROVED' ||
      notifType === 'TEST' || eventType === 'TEST' || eventType === '{{event}}' ||
      mediaStatus === 'APPROVED' || mediaStatus === 3 || reqObj.status === 'APPROVED';

    if (isApproved) {
      
      const title = payload.subject || mediaObj.title || payload['{{subject}}'] || "Unknown Title";
      let type = "series";
      if (mediaObj.media_type) {
         type = mediaObj.media_type.toLowerCase() === 'movie' ? 'movie' : 'series';
      }
      const requester = reqObj.requestedBy_username || payload['{{requestedBy_username}}'] || "Unknown User";
      const seerr_request_id = reqObj.request_id || payload['{{request_id}}'] || null;

      if (notifType === 'TEST' || eventType === 'TEST' || eventType === '{{event}}') {
         console.log("Test Webhook received successfully!");
         await db.addRequest(seerr_request_id, requester, "Test Request", type, "success (Test)");
         return res.status(200).json({ status: "OK - Test Received" });
      }

      // Custom Search and Queue logic instead of Planned Releases
      let queueStatus = "success";
      try {
        const client = await getAniWorldClient();
        if (client) {
          const settings = await db.getSettings();
          const customPathId = type === 'movie' ? (settings.default_movie_path ? parseInt(settings.default_movie_path) : null) : (settings.default_series_path ? parseInt(settings.default_series_path) : null);
          const siteString = type === 'movie' ? (settings.movie_site || 'megakino,filmpalast,cineby') : (settings.series_site || 'aniworld,sto');
          const sites = siteString.split(',').map(s => s.trim()).filter(s => s);
          const provider = type === 'movie' ? (settings.movie_provider || 'VOE') : (settings.series_provider || 'VOE');
          const language = type === 'movie' ? (settings.movie_language || 'German Dub') : (settings.series_language || 'German Dub');
          
          let results = null;
          let foundSite = null;

          // 1. Search for title across priority sites
          for (const s of sites) {
            try {
              const searchResp = await client.post('/api/search', { keyword: title, site: s });
              if (searchResp.data.results && searchResp.data.results.length > 0) {
                results = searchResp.data.results;
                foundSite = s;
                break;
              }
            } catch (searchErr) {
              console.log(`Search on ${s} failed:`, searchErr.message);
            }
          }
          
          if (!results || results.length === 0) {
            queueStatus = "Not found in search";
            console.log(`Title not found: ${title} on any of the sites: ${sites.join(', ')}`);
          } else {
            const firstResultUrl = results[0].url;
            console.log(`Found ${title} on site ${foundSite}. URL: ${firstResultUrl}`);
            
            if (type === 'movie') {
               // Queue movie directly using /api/download
               await client.post('/api/download', {
                 episodes: [firstResultUrl],
                 language: language,
                 provider: provider,
                 title: title,
                 series_url: firstResultUrl,
                 custom_path_id: customPathId
               });
               console.log(`Successfully queued movie ${title}.`);
            } else {
               // For series, queue all episodes
               const seasonsResp = await client.get('/api/seasons', { params: { url: firstResultUrl } });
               const seasons = seasonsResp.data.seasons || [];
               
               let allEpisodes = [];
               for (const season of seasons) {
                 const episodesResp = await client.get('/api/series', { params: { url: season.url } });
                 const episodes = episodesResp.data.episodes || [];
                 for (const ep of episodes) {
                    if (ep.url) {
                       allEpisodes.push(ep.url);
                    }
                 }
               }
               
               if (allEpisodes.length > 0) {
                 await client.post('/api/download', {
                   episodes: allEpisodes,
                   language: language,
                   provider: provider,
                   title: title,
                   series_url: firstResultUrl,
                   custom_path_id: customPathId
                 });
                 console.log(`Successfully queued ${allEpisodes.length} episodes for series ${title}.`);
               } else {
                 queueStatus = "No episodes found";
                 console.log(`No episodes found for series ${title}.`);
               }
            }
          }
        } else {
          queueStatus = "AniWorld not configured";
        }
      } catch (err) {
        console.error("Failed to add to AniWorld:", err.message);
        queueStatus = err.response ? `API Error ${err.response.status}` : "Network Error";
      }

      await db.addRequest(seerr_request_id, requester, title, type, queueStatus);
    }

    res.status(200).json({ status: "OK" });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`AniSeerr Bridge running on http://localhost:${PORT}`);
});
