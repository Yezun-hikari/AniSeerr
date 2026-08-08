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
- A running Seerr Server.
- A running AniWorld Downloader.
- Docker & Docker Compose (recommended).

### Starting with Docker

A Docker image is automatically provided with every release, optimized for both **AMD64** (classic PCs/Servers) and **ARM64** (Raspberry Pi, Apple Silicon, etc.).

You can simply start the project using the included `docker-compose.yml`. Adjust the ports if necessary.

```bash
docker-compose up -d
```

After starting, the AniSeerr web interface is available at `http://<YOUR_IP>:5010`. There, under **Settings**, you can configure the credentials, preferences, and URLs for your AniWorld Downloader.

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

### 2. JSON Payload
The JSON Payload can be left entirely on the **Default**. AniSeerr understands the standard Seerr JSON format.

### 3. Notification Types
For AniSeerr to correctly track the status of requests and start downloads, **exactly these five notification types** must be checked:

- [x] **Request Pending**
- [x] **Request Auto-Approved**
- [x] **Request Approved**
- [x] **Request Declined**
- [x] **Request Available**

All other boxes (like "Issue Reported", etc.) can remain unchecked, as AniSeerr does not process these events.

### 4. Testing
Click **Test** at the very bottom of Seerr. If everything is set up correctly, you should see in the **Logs** of AniSeerr that it received the test request.

---

## 💻 Technical Workflow (How it works)

1. Seerr sends a webhook (e.g., "Request Approved").
2. AniSeerr receives the webhook and extracts the title of the series/movie.
3. AniSeerr communicates with the AniWorld Downloader via the `/api/search` endpoint and searches for the title.
4. If the title is found, AniSeerr sends a download command via `/api/download` to the downloader.
5. The **AniWorld Downloader** then independently establishes connections to the streaming sites (hosters).

## Supported Providers
* VOE
* Vidoza
* Streamtape
* Doodstream

---

## 🌎 Global Language Settings & User Exceptions

### Global Language Settings
By default, AniSeerr Bridge applies your global language settings to downloaded media.
- **Anime Language**: Applied when the media is downloaded from `aniworld`.
- **Series Language**: Applied when downloading a series from other sites (e.g., `sto`).
- **Movie Language**: Applied when downloading a movie.

You can configure these global defaults on the **Settings** page.

### User Exceptions
If multiple users use Seerr and prefer different languages (e.g., one user prefers English Dub for Anime, while another prefers Japanese Sub), you can set up **User Exceptions**.

1. Navigate to the **Users (Exceptions)** page via the top navigation bar.
2. Enter the user's **exact Seerr Username** (case-sensitive).
3. Select their preferred language for Anime, normal Series, and Movies.
4. Click **Save User**.

When this user requests media in Seerr, AniSeerr Bridge will prioritize their specific language settings over the global defaults. If a user is not listed in the exceptions, the global settings will be used.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
