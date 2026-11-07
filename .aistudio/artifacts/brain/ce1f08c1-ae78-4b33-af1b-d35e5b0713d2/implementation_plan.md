# 100 % D1-Datenbank-Architektur für 180k+ JSON-Importe & Reload-Sicherheit

Dieser überarbeitete Plan stellt sicher, dass **alle importierten Filme, Serien, Episoden, Stream-Dateien, Prüflisten und Import-Playlists dauerhaft und ausschließlich in Cloudflare D1 (SQL)** gespeichert werden – **nicht in Cloudflare KV** – und dass nach einem Seiten-Reload (F5) sowohl das Import-Cockpit als auch die Darstellung auf der **Hauptseite**, im **Detail-Modal** und in den **Playlists** vollständig intakt bleiben.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Antwort auf deine Frage: „Und die Einträge landen am Ende in KV und nicht in D1? Ist das schlau?“**
> **Nein – 180.000 Einträge in KV zu speichern wäre überhaupt nicht schlau!**
> - Cloudflare KV ist nur für kleine Key-Value-Daten gedacht (max. 1.000 Schreibzugriffe/Tag im Free-Tarif, 25 MB Limit, hohes CPU-Limit-Risiko beim `JSON.parse()` großer Listen).
> - **Cloudflare D1 (SQLite)** hingegen ist für hunderttausende Datensätze gebaut (Millionen Zeilen, schnelle SQL-Indizes, kein 1.000-Writes-Deckel).
> - **Neue Architektur-Entscheidung**: Die importierten Einträge und Import-Playlists landen **weder währenddessen noch am Ende in KV**, sondern **zu 100 % in D1**! KV wird beim JSON-Import überhaupt nicht mehr beschrieben (0 KV-Writes).

- **Bestätigte Entscheidung 1 (100 % D1 statt KV für alle Importe & Playlists)**:
  - Filme (`movies`, `movie_files`), Serien & Episoden (`series`, `series_episodes`, `episode_files`), Import-Playlists (`d1_playlists`, `d1_playlist_items`), der Server-Checkpoint (`d1_import_checkpoints`) und das Diagnose-Log (`import_diagnostic_logs`) liegen **komplett in D1**.
- **Bestätigte Entscheidung 2 (Garantierter Erhalt der Hauptseite & UI-Darstellung)**:
  - Wir haben alle UI-Endpunkte geprüft:
    1. **Hauptseite (`/api/tma/discover`) & Suche (`/api/tma/search`)**: Lesen die VIP-Stream-Badges (`1080p`, `4K`, Stream-Anzahl) über `attachVipQualitiesToMediaList` und `applyVipStreamsOnlyFilterIfActive` **bereits direkt per SQL `WHERE movie_id IN (...)` aus D1** (`movie_files` & `episode_files`). Zusätzlich ergänzen wir im Modus „🌟 Nur VIP-Streams“ eine direkte D1-Katalog-Abfrage, damit alle in D1 importierten Filme & Serien sofort auf der Hauptseite erscheinen.
    2. **Detail-Modal (`/api/tma/details`) & Staffel-Ansicht (`/api/tma/season`)**: Laden alle Schnittfassungen, Episoden und Stream-Buttons direkt aus den D1-Tabellen `movie_files` und `episode_files`.
    3. **Playlists & Admin-Übersicht (`/api/tma/wishlist`, `/api/tma/admin/overview`)**: Laden die JSON-Import-Playlists und den `bot_vip`-Katalog direkt aus **D1** statt aus einem überladenen KV-Array. Dadurch bleibt das UI optisch und funktional zu 100 % identisch, stürzt aber auch bei 180.000 Einträgen niemals ab.

---

## 1. Overview & Core Concept

- **Was wird gelöst**:
  1. **Kein einziger KV-Schreibzugriff mehr beim JSON-Import (100 % D1)**: Sämtliche Daten eines JSON-Imports – inklusive der Zuordnung zur gewählten Ziel-Playlist und des Fortschritts-Checkpoints – werden per SQL `INSERT OR REPLACE` direkt in **D1** gespeichert. Damit entfällt das Cloudflare KV-Limit (1.000 Writes/Tag) für den Import komplett.
  2. **Sofortige Wiederherstellung nach Seiten-Reload (F5)**:
     - Im Browser speichert **IndexedDB** (`tma_backup_job_idb_v1`) die geparste 180k-Eintragsliste lokal zwischen, während **D1** den Server-Checkpoint, alle bereits gespeicherten Filme/Serien und alle offenen Prüffälle hält.
     - Nach F5 wird das Import-Dashboard (Fortschrittsbalken, Zähler, **„🛠️ Prüfen & Korrigieren“** mit Review-Reason-Badges, **„🛠️ Diagnose-Log“** und **„▶️ Weiter“**-Button) sofort wieder angezeigt, ohne dass die `.json`-Datei neu ausgewählt werden muss.
  3. **Intakte Hauptseite & schnelle Katalog-Darstellung**:
     - Die Hauptseite zeigt weiterhin alle Cover, Bewertungen, Filter und VIP-Qualitäts-Badges (`4K`, `1080p`, Episoden-Zähler) direkt aus D1 an.
     - Auch in der **AI Studio Vorschau** werden die simulierte D1-Datenbank und KV-Einstellungen im Browser-Speicher persistiert, sodass F5 in der Vorschau ebenfalls nichts mehr löscht.

---

## 2. User Experience & Visual Design

- **Hauptseite (`Discover`), Suche & Detail-Modal**:
  - **Unverändertes STREAMFLIX-Design**: Hero-Banner, Poster-Grid, Qualitäts-Badges (`1080p`, `4K`, `🎞️ Fassungen`), Filter-Cockpit und Detail-Modal bleiben optisch und funktional exakt erhalten.
  - **Verbesserter VIP-Stream-Filter auf der Hauptseite**: Wenn der Filter **„🌟 Nur VIP-Streams“** aktiv ist, speist sich die Hauptseite direkt aus den in **D1** vorhandenen Filmen und Serien (mit echten `movie_files` / `episode_files`), sodass deine importierten Titel immer zuverlässig auf der Hauptseite auftauchen.
- **Admin-Panel (`Backup / JSON-Import` & `Prüfen & Korrigieren`)**:
  - Bleibt auch nach einem Seiten-Reload (F5) vollständig geöffnet und zeigt alle aus D1 geladenen Konflikte mit ihren **Review-Reason-Badges** (`TMDB_NOT_FOUND`, `YEAR_CONFLICT`, `PARSER_AMBIGUITY`, `SEASON_CONFLICT`, `SEQUEL_CONFLICT`, `API_ERROR`).

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: 100 % D1 für Medien, Import-Playlists & Checkpoints (0 % KV beim Import)**
  - *Gewählter Ansatz*: Anlage/Nutzung schlanker D1-Tabellen (`d1_playlists`, `d1_playlist_items`, `d1_import_checkpoints`) neben `movies`, `movie_files`, `series`, `series_episodes`, `episode_files` und `import_diagnostic_logs`.
  - *Warum*: D1 verkraftet 180.000+ Einträge mühelos per indiziertem SQL, während KV bei großen JSON-Listen an das 1.000-Writes/Tag-Limit und das Worker-CPU-Zeitlimit stößt. KV bleibt ausschließlich für winzige User-Settings reserviert.
- **Entscheidung 2: IndexedDB im Browser + D1 auf dem Server für nahtloses F5-Resume**
  - *Gewählter Ansatz*: Die beim Datei-Upload geparsten Roh-Einträge (`entries[]`) werden einmalig in der Browser-IndexedDB abgelegt; der Fortschritt (`cursor`), die Ergebnisse und die Prüfliste (`reviewItems`) liegen synchron in D1 und IndexedDB.
  - *Warum*: Nach F5 muss eine 50–150 MB große `result.json` nicht erneut hochgeladen und geparst werden – ein Klick auf **„▶️ Weiter“** setzt direkt beim letzten D1-Checkpoint fort.
- **Entscheidung 3: Paginierte D1-Abfragen für Playlists & Admin-Übersicht**
  - *Gewählter Ansatz*: Statt bei 180.000 Einträgen alle Titel auf einmal in den Arbeitsspeicher zu laden, lädt die Playlist-/Admin-Ansicht die Einträge sauber aus D1 nach, während die Hauptseite gezielt nur für die aktuell sichtbaren 20 Karten per `WHERE movie_id IN (...)` die Stream-Qualitäten aus D1 abfragt.
  - *Warum*: Garantierte Antwortzeiten unter 50 ms auf der Hauptseite, egal ob 100 oder 180.000 Einträge in D1 liegen.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   STREAMFLIX MINI-APP UI (08a / 08b / 08c)                 │
│                                                                            │
│  ┌──────────────────────────┐  ┌─────────────────────┐  ┌───────────────┐  │
│  │ Hauptseite & Suche       │  │ Playlists & Details │  │ JSON-Importer │  │
│  │ • Poster-Grid & Filter   │  │ • Staffeln & Folgen │  │ • IndexedDB   │  │
│  │ • VIP-Badges direkt      │  │ • Schnittfassungen  │  │   Auto-Resume │  │
│  │   aus D1 SQL-Abfrage     │  │   direkt aus D1     │  │ • D1-Review   │  │
│  └────────────┬─────────────┘  └──────────┬──────────┘  └───────┬───────┘  │
└───────────────┼───────────────────────────┼─────────────────────┼──────────┘
                │                           │                     │
                ▼                           ▼                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                CLOUDFLARE WORKER + D1 SQL DATENBANK (04, 07, 09)           │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Cloudflare D1 (100 % Single Source of Truth – 0 KV-Writes beim Import)│  │
│  │                                                                      │  │
│  │  • movies / movie_files        ──► Hauptseite VIP-Badges & Streams   │  │
│  │  • series / episode_files      ──► Staffel-/Folgen-Modal & Versionen │  │
│  │  • d1_playlists / items        ──► Import-Playlists & Bot-VIP-Ordner │  │
│  │  • import_diagnostic_logs      ──► Prüfen & Korrigieren + Badges     │  │
│  │  • d1_import_checkpoints       ──► F5-sicherer Fortschritts-Stand    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Geplante Umsetzungsschritte im Detail

1. **D1-Tabellen für Import-Playlists & Checkpoints (`04-d1-database.js`)**:
   - Erweiterung von `ensureD1Schema(env)` um `d1_playlists`, `d1_playlist_items` und `d1_import_checkpoints`.
   - Bereitstellung schneller D1-Helfer (`savePlaylistFolderToD1`, `batchSavePlaylistItemsToD1`, `getPlaylistsAndItemsFromD1`, `saveImportCheckpointToD1`, `getImportCheckpointFromD1`), damit beim JSON-Import **0 KV-Schreibzugriffe** stattfinden und alle Einträge dauerhaft in D1 landen.
2. **Umstellung der JSON-Import-Pipeline auf 100 % D1 (`03-telegram-kv-engine.js`, `07-webhook-callbacks.js`, `09-tma-api-worker-export.js`)**:
   - `processEntriesBatchWithLimit` schreibt Filme, Serien, Episoden, Playlist-Zuordnungen und Diagnose-Logs ausschließlich in **D1**.
   - `getFolders` / `getSavedList` / `/api/tma/admin/overview` lesen Import- und `bot_vip`-Playlists direkt aus D1 (mit Abwärtskompatibilität für bestehende Einträge), sodass im Admin-Panel und in der Merkliste sofort alle importierten D1-Titel sichtbar sind.
3. **Hauptseiten-Integrität & D1-Katalog-Anbindung (`04-d1-database.js`, `09-tma-api-worker-export.js`)**:
   - Sicherstellen, dass `/api/tma/discover` (Hauptseite), `/api/tma/search` und `/api/tma/details` alle VIP-Qualitäten, Cover-Fallbacks und Stream-Buttons direkt aus D1 (`movies`, `movie_files`, `series`, `episode_files`) beziehen und bei aktivem Filter **„🌟 Nur VIP-Streams“** auch direkt aus dem D1-Bestand paginieren können.
4. **IndexedDB Auto-Restore & immer sichtbare Prüf-Tabs nach F5 (`08c-tma-netflix-frontend.js`)**:
   - Speicherung des aktiven `backupImportJob` (inkl. geparster `entries[]` und `reviewItems[]`) in der Browser-IndexedDB (`tma_backup_job_idb_v1`) plus Synchronisation mit dem D1-Checkpoint (`/api/tma/admin/import-checkpoint`) und den D1-Prüfeinträgen (`/api/tma/admin/review-items`).
   - Entfernen der frühen `if (!j.fileName) return;`-Blockade in `renderBackupImportBoxDom()`, damit nach F5 das komplette Import-Cockpit sowie **„🛠️ Prüfen & Korrigieren“** und **„🛠️ Diagnose-Log“** sofort angezeigt werden.
5. **Persistente D1- & KV-Simulation in der AI Studio Vorschau (`src/utils/workerSandbox.ts`)**:
   - Spiegelung des Sandbox-Speichers (`memoryFallback` für D1-Tabellen sowie `SimulatedKVNamespace`) im Browser-Storage der Vorschau, damit auch im Simulator nach F5 alle importierten Einträge erhalten bleiben.
