# AniSeerr

[![GitHub Release](https://img.shields.io/github/v/release/Yezun-hikari/AniSeerr?style=flat-square)](https://github.com/Yezun-hikari/AniSeerr/releases)
[![Docker Image](https://img.shields.io/badge/docker-multi--arch-blue?style=flat-square&logo=docker)](https://github.com/Yezun-hikari/AniSeerr/pkgs/container/aniseerr)
[![License](https://img.shields.io/github/license/Yezun-hikari/AniSeerr?style=flat-square)](https://github.com/Yezun-hikari/AniSeerr/blob/main/LICENSE)

AniSeerr is a bridge between **Seerr** and the **AniWorld Downloader**. The tool receives webhook notifications from Seerr when a new movie or series is requested, and automatically passes them to the AniWorld Downloader to start the download.

## 🚀 Features

- **Seamless Integration:** Connects Seerr directly with the AniWorld Downloader.
- **Fully Automated:** Searches and queues approved requests automatically into the download queue.
- **Status Tracking:** Tracks pending, declined, and available requests clearly in its own web interface.

---

## 🛠️ Installation & Setup

### Prerequisites
- A running [Seerr Server](https://github.com/seerr-team/seerr).
- A running [AniWorld Downloader](https://github.com/phoenixthrush/AniWorld-Downloader).
- Docker & Docker Compose (recommended), or **Node.js 22.13 or newer** if you run it without Docker (`npm ci --omit=dev && npm start`).

### Starting with Docker

A Docker image is automatically provided with every release, optimized for both **AMD64** (classic PCs/Servers) and **ARM64** (Raspberry Pi, Apple Silicon, etc.).

You can simply start the project using the included `docker-compose.yml`. Adjust the ports if necessary, and **replace every `change-me`** with your own values (see below).

```bash
docker compose up -d
```

After starting, the AniSeerr web interface is available at `http://<YOUR_IP>:5010`. If `ADMIN_PASSWORD` is set, you are first sent to a login page. There, under **Settings**, you can configure the credentials, preferences, and URLs for your AniWorld Downloader.

> **Note:** The AniWorld API key is never shown again in the Settings page. Leave the field empty to keep the saved key, or tick **Clear saved key** to remove it.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ADMIN_PASSWORD` | *(empty)* | Password for the web interface login. Empty disables the login (a warning is logged at startup). |
| `WEBHOOK_SECRET` | *(empty)* | Shared secret Seerr must send in the `Authorization` header of the webhook. Empty leaves `/webhook` open (a warning is logged at startup). |
| `SESSION_SECRET` | *(empty)* | Secret used to sign the login cookie. Empty uses a random secret, so everyone is logged out on every restart. |
| `PORT` | `5010` | Port the web interface and webhook listen on. |
| `DB_PATH` | `data/aniseerr.db` | Path of the SQLite database file (`/app/data/aniseerr.db` in Docker). |

Generate random values for example with `openssl rand -hex 32`.

---

## 🔗 Configuration in Seerr

For AniSeerr to know when new media is requested, a webhook must be set up in Seerr.

1. Open Seerr and navigate to **Settings > Notifications**.
2. Click on **Webhook**.
3. Check the box for **Enable Agent**.

### 1. Webhook URL & Virtual Networks (Docker)
The Webhook URL depends on how your containers communicate with each other:

* **Default / Host IP:** If the tools are not running in the same network, enter the IP address of the server: `http://<YOUR_SERVER_IP>:5010/webhook`
* **Virtual Docker Network (Recommended):** If Seerr is running in the **same Docker network** (Custom Bridge Network), they can communicate directly via the container name. This is the safest and cleanest method, as the traffic does not leave the Docker network.
  In this case, enter the name of the AniSeerr container as the Webhook URL, e.g.:
  `http://aniseerr:5010/webhook`

### 2. Authorization Header
If you set `WEBHOOK_SECRET`, enter **exactly the same value** in the **Authorization Header** field of the Seerr Webhook agent. Requests without it are rejected with `401 Unauthorized`.

### 3. JSON Payload
The JSON Payload can be left entirely on the **Default**. AniSeerr understands the standard Seerr JSON format.

### 4. Notification Types
For AniSeerr to correctly track the status of requests and start downloads, **exactly these five notification types** must be checked:

- [x] **Request Pending**
- [x] **Request Auto-Approved**
- [x] **Request Approved**
- [x] **Request Declined**
- [x] **Request Available**

All other boxes (like "Issue Reported", etc.) can remain unchecked, as AniSeerr does not process these events.

### 5. Testing
Click **Test** at the very bottom of Seerr. If everything is set up correctly, you should see in the **Logs** of AniSeerr that it received the test request.

---

## 💻 Technical Workflow (How it works)

1. Seerr sends a webhook (e.g., "Request Approved").
2. AniSeerr receives the webhook and extracts the title of the series/movie. Approved requests are answered immediately with `202 Accepted` and processed in the background, so Seerr does not run into a timeout. The dashboard shows `Processing Download...` until the request is queued (or failed).
3. AniSeerr communicates with the AniWorld Downloader via the `/api/search` endpoint and searches for the title.
4. If the title is found, AniSeerr sends a download command via `/api/download` to the downloader.
5. The **AniWorld Downloader** then independently establishes connections to the streaming sites (hosters).

---

## 🌎 Global Language Settings & User Exceptions

### Global Language Settings
By default, AniSeerr applies your global language settings to downloaded media.
- **Anime Language**: Applied when the media is downloaded from `aniworld`.
- **Series Language**: Applied when downloading a series from other sites (e.g., `sto`).
- **Movie Language**: Applied when downloading a movie.

You can configure these global defaults on the **Settings** page.

Not every site offers every language. If the site where a title was found does not offer the chosen language, AniSeerr falls back to `German Dub` (or the first language the site offers):

| Site | Languages |
|---|---|
| `aniworld` | German Dub, English Sub, German Sub, English Dub |
| `sto`, `burningseries`, `kinox`, `filmpalast` | German Dub, English Dub |
| `megakino`, `filmo`, `moflix` | German Dub |

### Sites & Providers
The supported sites match AniWorld Downloader 5.4. On the **Settings** page you tick the sites AniSeerr should search and drag them into priority order:
- **Movies**: `megakino`, `filmpalast`, `filmo`, `kinox`, `moflix` (default: megakino, filmpalast, filmo, moflix)
- **Series**: `aniworld`, `sto`, `burningseries`, `kinox`, `moflix` (default: aniworld, sto)

`kinox` and `burningseries` are disabled by default in AniWorld Downloader; enable them there first if you want to use them. `cineby` and the `Streamtape` provider were removed in AniWorld Downloader 5.2. AniSeerr ignores them if they are still saved from an older version.

### User Exceptions
If multiple users use Seerr and prefer different languages (e.g., one user prefers English Dub for Anime, while another prefers German Sub), you can set up **User Exceptions**.

1. Navigate to the **Users (Exceptions)** page via the top navigation bar.
2. Enter the user's **exact Seerr Username** (case-sensitive).
3. Select their preferred language for Anime, normal Series, and Movies.
4. Click **Save User**.

When this user requests media in Seerr, AniSeerr will prioritize their specific language settings over the global defaults. If a user is not listed in the exceptions, the global settings will be used.

---

## ⬆️ Upgrading from 1.x

1. Pull the new image: `docker compose pull && docker compose up -d`.
2. Add `ADMIN_PASSWORD`, `WEBHOOK_SECRET` and `SESSION_SECRET` to your `docker-compose.yml` (see above) and put the webhook secret into the **Authorization Header** field in Seerr.
3. Your existing `data/aniseerr.db` is migrated automatically on startup:
   - The settings history is pruned to the latest saved row (your current settings are kept).
   - Duplicate request rows for the same Seerr request are merged into one.

Stop the container and back up the whole `data/` folder before upgrading if you want to be able to go back to 1.x. The database now uses WAL mode, so `aniseerr.db-wal` and `aniseerr.db-shm` belong to it.

When running without Docker, Node.js 22.13 or newer is now required.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
