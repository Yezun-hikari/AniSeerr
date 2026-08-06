# AniSeerr

AniSeerr ist eine Brücke (Bridge) zwischen **Seerr** und dem **AniWorld Downloader**. Das Tool empfängt Webhook-Benachrichtigungen von Seerr, wenn ein neuer Film oder eine neue Serie angefragt wird, und gibt diese automatisch an den AniWorld Downloader weiter, um den Download zu starten.

## 🚀 Features

- **Nahtlose Integration:** Verbindet Seerr direkt mit dem AniWorld Downloader.
- **Vollautomatisch:** Sucht und reiht genehmigte (Approved) Anfragen automatisch in die Download-Warteschlange ein.
- **Status-Tracking:** Verfolgt ausstehende (Pending), abgelehnte (Declined) und verfügbare (Available) Anfragen übersichtlich in einem eigenen Web-Interface.

---

## 🛠️ Installation & Setup

### Voraussetzungen
- Ein laufender Seerr Server.
- Ein laufender AniWorld Downloader.
- Docker & Docker Compose (empfohlen).

### Starten mit Docker

Wenn du Docker verwendest, kannst du das Projekt einfach über die beiliegende `docker-compose.yml` starten. Passe die Ports bei Bedarf an.

```bash
docker-compose up -d
```

Nach dem Start ist das AniSeerr Web-Interface unter `http://<DEINE_IP>:5010` erreichbar. Dort kannst du unter **Settings** die Zugangsdaten, Präferenzen und URLs für deinen AniWorld Downloader konfigurieren.

---

## 🔗 Konfiguration in Seerr

Damit AniSeerr weiß, wann neue Medien angefragt werden, muss ein Webhook in Seerr eingerichtet werden.

1. Öffne Seerr und navigiere zu **Einstellungen > Benachrichtigungen** (Settings > Notifications).
2. Klicke auf **Webhook**.
3. Setze den Haken bei **Dienst aktivieren** (Enable Agent).

### 1. Webhook-URL & Virtuelle Netzwerke (Docker)
Die Webhook-URL hängt davon ab, wie deine Container miteinander kommunizieren:

* **Standard / Host-IP:** Laufen die Tools nicht im selben Netzwerk, trage die IP-Adresse des Servers ein: `http://<DEINE_SERVER_IP>:5010/webhook`
* **Virtuelles Docker-Netzwerk (Empfohlen):** Wenn Seerr im **selben Docker-Netzwerk** (Custom Bridge Network) laufen, können sie direkt über den Container-Namen kommunizieren. Das ist die sicherste und sauberste Methode, da der Traffic das Docker-Netzwerk nicht verlässt. 
  Trage in diesem Fall als Webhook-URL den Namen des AniSeerr-Containers ein, z. B.:
  `http://aniseerr:5010/webhook`

### 2. JSON-Inhalt (Payload)
Der JSON-Inhalt kann komplett auf dem **Standard (Default)** belassen werden. AniSeerr versteht das standardmäßige Seerr JSON-Format.

### 3. Benachrichtigungstypen (Notification Types)
Damit AniSeerr den Status von Anfragen korrekt mitverfolgen und Downloads starten kann, müssen **genau diese fünf Benachrichtigungstypen** angehakt werden (genau wie auf deinem Screenshot):

- [x] **Genehmigung ausstehend** (Request Pending)
- [x] **Anfrage automatisch genehmigt** (Request Auto-Approved)
- [x] **Anfrage genehmigt** (Request Approved)
- [x] **Anfrage abgelehnt** (Request Declined)
- [x] **Anfrage verfügbar** (Request Available)

Alle anderen Haken (wie "Problem gemeldet" etc.) können deaktiviert bleiben, da AniSeerr diese Ereignisse nicht verarbeitet.

### 4. Testen
Klicke ganz unten in Seerr auf **Testen**. Wenn alles korrekt eingerichtet ist, solltest du in den **Logs** von AniSeerr sehen, dass es die Test-Anfrage empfangen hat.

---

## 💻 Technischer Ablauf (Wie es funktioniert)

1. Seerr sendet einen Webhook (z.B. "Anfrage genehmigt").
2. AniSeerr empfängt den Webhook und filtert den Titel der Serie/des Films heraus.
3. AniSeerr kommuniziert über die `/api/search` Schnittstelle mit dem AniWorld Downloader und sucht nach dem Titel.
4. Wird der Titel gefunden, sendet AniSeerr einen Download-Befehl über `/api/download` an den Downloader.
5. Der **AniWorld Downloader** baut dann selbstständig die Verbindungen zu den Streaming-Seiten (Hostern) auf und lädt die Videodateien herunter.

---

## 📄 Lizenz

Dieses Projekt ist unter der [MIT Lizenz](LICENSE) lizenziert.
