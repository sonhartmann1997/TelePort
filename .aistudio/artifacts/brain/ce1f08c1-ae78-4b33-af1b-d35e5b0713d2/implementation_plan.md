# Optimierungsplan: Cloudflare Free-Worker Anti-Timeout & Turbo-Engine

## 1. Ursache der bisherigen Timeouts (Diagnose)
Auf dem **kostenlosen Cloudflare Worker (Free Plan)** gelten zwei strikte Grenzen pro Aufruf: maximal **10 Millisekunden reine CPU-Rechenzeit** und maximal **50 Subrequests** (externe API-Aufrufe + D1-Abfragen). Bisher führten drei Engpässe regelmäßig zu Timeouts (`HTTP 503 / 524` bzw. `AbortError`):

1. **Komplettes Neuladen & Parsen der Playlisten bei jedem Import-Batch (`batchSaveIngestedItemsToPlaylist`)**:
   - Bei jedem einzelnen Batch hat der Worker die gesamte bisherige Playlist aus D1 geladen (`getSavedList`), durchsucht und zweimal neu geschrieben (für die Ziel-Playlist und für `bot_vip`). Ab einigen hundert Einträgen sprengt das sofort das **10-ms-CPU-Limit**.
2. **Große `details_json`-Blobs beim Kaltstart & Admin-Öffnen (`ensureLocalD1CatalogTitleMapLoaded` & `computeSeriesGapsOverview`)**:
   - Beim Start eines Worker-Isolates und beim Öffnen des Admin-Dashboards wurden sämtliche `details_json`- und `episodes_json`-Textfelder aller Filme und Serien aus D1 geladen und per `JSON.parse()` verarbeitet.
3. **Sequenzielle 4,5-Sekunden-Wartezeiten bei schwer erkennbaren Titeln**:
   - Wenn ein Titel bei TMDb nicht sofort gefunden wurde, liefen bis zu 8 externe Fallback-APIs (OMDb, iTunes, TVMaze, AniList, Jikan, Wikidata, Wikipedia) mit jeweils bis zu 4,5 Sekunden Timeout nacheinander ab – ein einziger unbekannter Titel konnte einen Batch dadurch 12–15 Sekunden blockieren.

---

## 2. Geplante Architektur- & Performance-Optimierungen

### A. JSON-Import Turbo-Modus mit intelligentem Notfall-Fallback (`/worker-modules/07-webhook-callbacks.js`, `/worker-modules/03-telegram-kv-engine.js`, `/worker-modules/04-d1-database.js`)
- **Direktes D1-Delta-Upsert statt Komplett-Laden der Playlist**:
  - `batchSaveIngestedItemsToPlaylist` lädt während des JSON-Imports nicht mehr die komplette bestehende Playlist in den Arbeitsspeicher, sondern schreibt ausschließlich die **neuen/aktualisierten Einträge des aktuellen Batches** direkt per `INSERT INTO d1_playlist_items ... ON CONFLICT(chat_id, uid) DO UPDATE` in D1. Dadurch sinkt die CPU-Zeit beim Playlist-Speichern um über **90 %** (unabhängig davon, ob 50 oder 50.000 Filme in der Datenbank liegen).
- **Katalog-Titel-Map ohne `details_json`-Ballast**:
  - `ensureLocalD1CatalogTitleMapLoaded` liest nur noch die schlanken Index-Spalten (`SELECT tmdb_id, title, release_year, poster_path FROM movies / series`) ohne `details_json` und ohne `JSON.parse()`-Schleife.
- **2-Stufen Smart-Turbo-Lookup (TMDb First + schneller Parallel-Fallback nur bei Bedarf)**:
  - **Stufe 1 (Turbo)**: Prüft zuerst den lokalen D1-/RAM-Cache (0 ms) und fragt dann gezielt TMDb (DE/EN) mit kurzem Timeout (`2.200 ms`) ab. Sobald ein sicherer Treffer (`Confidence >= 72 %`) vorliegt, werden alle weiteren API-Aufrufe für dieses Element übersprungen.
  - **Stufe 2 (Notfall-Fallback für schwere Fälle)**: Nur wenn TMDb keinen Treffer liefert **und** im aktuellen Batch noch genügend Zeit- und Subrequest-Budget vorhanden ist, werden die wichtigsten Fallback-Quellen (iTunes DE, TVMaze, OMDb) **parallel mit hartem 1.800-ms-Zeitlimit** abgefragt statt nacheinander je 4,5 Sekunden zu warten.

### B. Sofortiges Laden von Admin-Dashboard & Playlisten (`/worker-modules/09-tma-api-worker-export.js`, `/worker-modules/04-d1-database.js`)
- **Tab-gesteuertes Lazy-Loading in `/api/tma/admin/overview`**:
  - Die rechenintensive Serien-Lücken-Analyse (`computeSeriesGapsOverview`) und die automatische DB-Bereinigung (`cleanupEmptySeriesInD1AndMemory`) werden beim normalen Öffnen des Admin-Dashboards nicht mehr blockierend ausgeführt, sondern nur noch, wenn gezielt der Tab **„📉 Serien-Lücken“** geöffnet oder auf Aktualisieren geklickt wird.
  - Für den geöffneten Playlist-Ordner werden nur die tatsächlich benötigten Einträge und Poster-Pfade geladen; auf unnötige `saveRawList`-Schreibvorgänge während reiner Lese-Abfragen (`GET /admin/overview`) wird komplett verzichtet.
- **`listAllMediaFromD1` ohne `JSON.parse()`-Engpass**:
  - Liest alle benötigten Felder (`tmdb_id`, `title`, `release_year`, `fsk`, `vote_average`, `genres`, `poster_path`) direkt aus den SQL-Spalten statt für jeden Film `details_json` zu parsen.

### C. Umschaltbares Geschwindigkeits-Profil im Admin-Cockpit (`/worker-modules/08c-tma-netflix-frontend.js`, `/worker-modules/09-tma-api-worker-export.js`)
Im Admin-Cockpit (sowie direkt im Backup-Import-Panel) wird ein neuer **1-Klick Profil-Umschalter (`⚡ Worker Geschwindigkeits-Profil`)** eingebaut, der sowohl im Browser als auch im Worker gespeichert wird:
1. **🛡️ Free-Tier Turbo (Standard – Optimal für kostenlosen Cloudflare Worker)**:
   - Kompakte Batches (`12 Einträge`), früher Wall-Clock-Schutz (`3,2 Sek.`), Subrequest-Guard bei `20/50`, TMDb-Turbo + gebündelter 1,8s-Notfall-Fallback bei schwierigen Titeln.
2. **⚖️ Ausgewogen (Balanced)**:
   - Mittlere Batches (`18 Einträge`), Wall-Clock-Schutz bei `4,5 Sek.`, Subrequest-Guard bei `26/50`, erweiterte Fallback-Suche.
3. **🚀 Paid / High-Throughput (Für Cloudflare Workers Paid $5 Tarif)**:
   - Große Batches (`30 Einträge`), Wall-Clock-Schutz bei `7,5 Sek.`, Subrequest-Guard bei `36/50`, volle Multi-API-Tiefensuche.
- **Automatische Selbstheilung bei langsamem Netz**: Falls im Profil *Ausgewogen* oder *Paid* jemals ein Timeout auftritt, regelt der Importer die Batch-Größe für die nächsten Schritte automatisch auf das *Free-Tier Turbo*-Niveau herunter, sodass der Import niemals abbricht.
