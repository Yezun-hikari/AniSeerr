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

let aniworldSessionCookie = null;

// Helper to get Axios instance for AniWorld
async function getAniWorldClient() {
  const settings = await db.getSettings();
  if (!settings.aniworld_url) return null;
  
  const client = axios.create({
    baseURL: settings.aniworld_url,
    timeout: 60000,
    maxRedirects: 0,
    validateStatus: status => status >= 200 && status < 400
  });
  
  if (settings.aniworld_username && settings.aniworld_password) {
    if (aniworldSessionCookie) {
      client.defaults.headers.Cookie = aniworldSessionCookie;
    } else {
      try {
        // Step 1: GET /login to get CSRF token and initial session cookie
        const getResp = await client.get('/login');
        const initialCookie = getResp.headers['set-cookie'] ? getResp.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '';
        
        // Extract CSRF token from HTML
        const csrfMatch = getResp.data.match(/name="csrf_token" value="([^"]+)"/);
        const csrfToken = csrfMatch ? csrfMatch[1] : '';

        // Step 2: POST /login with CSRF token and initial cookie
        const formData = new URLSearchParams();
        formData.append('username', settings.aniworld_username);
        formData.append('password', settings.aniworld_password);
        if (csrfToken) formData.append('csrf_token', csrfToken);
        
        const loginResp = await client.post('/login', formData.toString(), {
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': initialCookie 
          }
        });
        
        if (loginResp.headers['set-cookie']) {
          aniworldSessionCookie = loginResp.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
          client.defaults.headers.Cookie = aniworldSessionCookie;
          console.log("Successfully logged into AniWorld Downloader.");
        } else {
          console.error("Login successful but no set-cookie header received.");
        }
      } catch (err) {
        console.error("Login to AniWorld failed:", err.message);
      }
    }
  }
  
  return client;
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

app.post('/settings', async (req, res) => {
  try {
    await db.saveSettings(req.body);
    res.redirect('/settings?success=1');
  } catch (err) {
    res.redirect('/settings?error=Failed+to+save');
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await db.getUsers();
    res.render('users', { users });
  } catch (err) {
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
    const extraArr = payload.extra || payload['{{extra}}'] || [];
    
    const isApproved = 
      notifType === 'MEDIA_APPROVED' || notifType === 'MEDIA_AUTO_APPROVED' || 
      eventType === 'MEDIA_APPROVED' || eventType === 'MEDIA_AUTO_APPROVED' ||
      notifType === 'TEST' || eventType === 'TEST' || eventType === '{{event}}' ||
      mediaStatus === 'APPROVED' || mediaStatus === 3 || reqObj.status === 'APPROVED';

    const isPending = !isApproved && (notifType === 'MEDIA_PENDING' || eventType === 'MEDIA_PENDING' || mediaStatus === 'PENDING' || reqObj.status === 'PENDING');
    const isDeclined = notifType === 'MEDIA_DECLINED' || eventType === 'MEDIA_DECLINED' || mediaStatus === 'DECLINED' || reqObj.status === 'DECLINED';
    const isAvailable = notifType === 'MEDIA_AVAILABLE' || eventType === 'MEDIA_AVAILABLE' || mediaStatus === 'AVAILABLE' || mediaStatus === 5;

    let extraDetails = "";
    let requestedSeasons = [];
    if (Array.isArray(extraArr)) {
      extraArr.forEach(item => {
        if (item && item.name && item.value) {
          extraDetails += ` (${item.name}: ${item.value})`;
          if (item.name === 'Requested Seasons') {
             requestedSeasons = item.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
          }
        }
      });
    }

    const rawTitle = payload.subject || mediaObj.title || payload['{{subject}}'] || "Unknown Title";
    const title = rawTitle + extraDetails;
    
    // Clean up title for searching (replace en-dash with hyphen, remove trailing (YYYY) year)
    const searchKeyword = rawTitle.replace(/–/g, '-').replace(/×/g, 'x').replace(/\s*\(\d{4}\)\s*$/, '').trim();
    let type = "series";
    if (mediaObj.media_type) {
       type = mediaObj.media_type.toLowerCase() === 'movie' ? 'movie' : 'series';
    }
    const requester = reqObj.requestedBy_username || payload['{{requestedBy_username}}'] || "Unknown User";
    const seerr_request_id = reqObj.request_id || payload['{{request_id}}'] || null;

    if (notifType === 'TEST' || eventType === 'TEST' || eventType === '{{event}}') {
       console.log("Test Webhook received successfully!");
       await db.addOrUpdateRequest(seerr_request_id, requester, "Test Request", type, "success (Test)");
       return res.status(200).json({ status: "OK - Test Received" });
    }

    if (isAvailable) {
       console.log(`Media is available. Deleting request ${seerr_request_id} from tracking.`);
       await db.deleteRequest(seerr_request_id);
       return res.status(200).json({ status: "OK - Request removed" });
    }

    if (isPending) {
       console.log(`Media is pending. Adding request ${seerr_request_id} to tracking.`);
       await db.addOrUpdateRequest(seerr_request_id, requester, title, type, "Pending Approval");
       return res.status(200).json({ status: "OK - Pending Added" });
    }

    if (isDeclined) {
       console.log(`Media was declined. Deleting request ${seerr_request_id}.`);
       await db.deleteRequest(seerr_request_id);
       return res.status(200).json({ status: "OK - Declined and removed" });
    }

    if (isApproved) {
       // Proceed to download
       await db.addOrUpdateRequest(seerr_request_id, requester, title, type, "Processing Download...");

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
          
          // Get specific user preferences if they exist
          const userException = await db.getUserByUsername(requester);

          let results = null;
          let foundSite = null;

          // 1. Search for title across priority sites
          for (const s of sites) {
            try {
              const searchResp = await client.post('/api/search', { keyword: searchKeyword, site: s });
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
            queueStatus = "Not Found";
            console.log(`Title not found: ${searchKeyword} on any of the sites: ${siteString}`);
          } else {
            const firstResultUrl = results[0].url;
            console.log(`Found ${title} on site ${foundSite}. URL: ${firstResultUrl}`);
            
            // Determine the actual language to use
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
               // Queue movie directly using /api/download
               await client.post('/api/download', {
                 episodes: [firstResultUrl],
                 language: languageToUse,
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
                 if (requestedSeasons.length > 0 && season.season_number !== undefined) {
                    if (!requestedSeasons.includes(parseInt(season.season_number))) {
                        console.log(`Skipping season ${season.season_number} because it was not requested.`);
                        continue;
                    }
                 }
                 
                 const episodesResp = await client.get('/api/episodes', { params: { url: season.url } });
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
                   language: languageToUse,
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

          const dbStatus = queueStatus === 'success' ? `Queued on ${foundSite}` : queueStatus;
          await db.addOrUpdateRequest(seerr_request_id, requester, title, type, dbStatus);
          
          if (queueStatus === 'success') {
             console.log(`Download Queued on ${foundSite}`);
          } else {
             console.log(`Download failed to queue: ${queueStatus}`);
          }
          return res.status(200).json({ status: "OK - Approved and Processed" });
        } else {
          queueStatus = "AniWorld API Error";
          await db.addOrUpdateRequest(seerr_request_id, requester, title, type, queueStatus);
        }
      } catch (err) {
        console.error("Webhook download logic error:", err);
        await db.addOrUpdateRequest(seerr_request_id, requester, title, type, "Internal Error");
      }
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
