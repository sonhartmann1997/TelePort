# Eliminierung von `HTTP 503` beim Massen-Import durch D1-Bulk-Bündelung (`db.batch`) & Browser-Titel-Cache

Behebung des Cloudflare-Fehlers `⏳ Rate-Limit / Einzel-Isolierung bei #5469: API-Zugriffslimit / Cloudflare Gateway-Pause (HTTP 503)` durch Zusammenfassung aller D1-Lese- und Schreiboperationen eines Import-Batches in gesammelte `db.batch()`-Transaktionen, lückenlose Zählung aller D1-/KV-/HTTP-Subrequests sowie einen persistenten Browser-Titel-Cache im Mini-App-Importer.

## User Review & Critical Decisions

> [!IMPORTANT]
> Beide Optimierungsstrategien wurden durch deine Auswahl bestätigt und sind verbindlich eingeplant:

- **Bestätigte Entscheidung 1 (D1-Bulk-Bündelung per `db.batch` + D1-Subrequest-Zählung)**: Da Cloudflare jede einzelne D1-Abfrage (`first`, `all`, `run`, `batch`) und jeden KV-Aufruf auf das harte 50-Subrequest-Limit pro Worker-Aufruf anrechnet, werden sämtliche D1-Vorab-Checks am Batch-Anfang in **1 einzigen `db.batch()`-Read** und sämtliche D1-Speicheroperationen am Batch-Ende in **1 einzigen `db.batch()`-Write** gebündelt. Zusätzlich zählt ein transparenter D1/KV-Tracker jede reale Datenbankabfrage im Subrequest-Budget mit.
- **Bestätigte Entscheidung 2 (Browser-Titel-Cache im Mini-App-Importer)**: Der JSON-Importer der Mini-App merkt sich jeden einmal aufgelösten Serien- und Filmtitel im Browser-Speicher (`resolvedTitlesCache`) und übergibt bei allen nachfolgenden Episoden oder Qualitätsstufen desselben Titels direkt die fertige `tmdb_id` an den Worker (`0 Such-Requests`).

---

## 1. Overview & Core Concept

- **Ursache des `HTTP 503` bei `#5469`**: In Cloudflare Workers zählen nicht nur externe `fetch()`-Aufrufe, sondern auch jede einzelne D1-SQL-Abfrage und jeder KV-Zugriff als Subrequest (Limit: 50 pro Request). Bisher löste ein 10er-Batch rund 70 bis 90 einzelne D1-Abfragen aus (pro Eintrag 4 einzelne `SELECT`-Checks, 2–4 `entity_cache`-Writes sowie separate `SELECT`/`INSERT`-Aufrufe für `movie_files`, `episode_files`, `movies`, `series`, Playlists und Checkpoints). Sobald die Summe aus D1-Abfragen und API-Fetches 50 erreichte, brach Cloudflare den Worker hart mit `HTTP 503` ab.
- **Lösung**:
  1. **Vom Einzel-SQL zum Sammel-`db.batch`**: Reduktion der D1-Subrequests pro 10er-Batch von ~80 auf **2–4 gebündelte `db.batch`-Aufrufe**.
  2. **Echtes Subrequest-Tracking (HTTP + D1 + KV)**: Der Subrequest-Zähler überwacht alle drei Subrequest-Quellen gemeinsam und teilt einen Batch rechtzeitig (`PARTIAL_BATCH`), bevor Cloudflare je an die 50er-Grenze stößt.
  3. **Browser-Titel-Cache in der Mini-App**: Verhindert wiederholte Titelsuchen bereits auf Client-Seite über alle Chunks hinweg.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Vorab-Anreicherung im Browser vor jedem Batch**: Bevor der Mini-App-Importer die nächsten 10 Einträge an den Worker sendet, prüft er seinen lokalen `resolvedTitlesCache`. Ist eine Serie (z. B. Folge 1 aus einem früheren Batch) oder ein Film bereits bekannt, wird die `tmdb_id` direkt an den Eintrag geheftet.
  2. **1-Subrequest D1-Bulk-Prefetch im Worker**: Der Worker lädt zu Beginn des Batches alle benötigten `movie_files`-, `episode_files`- und `entity_cache`-Einträge für alle 10 Elemente in **einem einzigen `db.batch()`-Aufruf** in den RAM.
  3. **1-Subrequest D1-Bulk-Commit am Batch-Ende**: Während die 10 Einträge verarbeitet werden, sammelt eine D1-Write-Queue alle SQL-Statements (`movies`, `series`, `movie_files`, `episode_files`, `series_episodes`, `entity_cache`, `d1_playlist_items`, `import_diagnostic_logs`, `d1_import_checkpoints`) und schreibt sie am Ende gemeinsam in **einem einzigen `db.batch()`-Aufruf** in D1.
  4. **Transparente Live-Anzeige**: Im Import-Log und Fortschrittsbalken sieht der Admin jederzeit die exakte Anzahl der genutzten Gesamt-Subrequests (inkl. D1) sowie die Anzahl der lokal aus dem Browser-/D1-Cache bedienten Titel.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Dunkles Streaming- & Admin-Cockpit (`#101016` / `#090c14`) mit flüssigem Echtzeit-Fortschrittsbalken ohne Gateway-Aussetzer.
  - *Color Palette & Mood*: Smaragdgrün (`#10b981`) für gebündelte D1-Commits und Cache-Treffer, Cyan (`#38bdf8`) für `PARTIAL_BATCH`-Fortsetzungen, Amber (`#f59e0b`) für manuelle Prüf-Kandidaten.
  - *Typography & Hierarchy*: Tabellarische Zähler (`tabular-nums`) und Monospace-Metriken für Subrequest-Budget und Batch-Durchsatz.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Transparenter D1-Subrequest-Proxy + Write-Behind-Queue pro Batch**
  - *Gewählter Ansatz*: Das D1-Binding wird mit einem leichtgewichtigen Proxy ummantelt, der jeden tatsächlichen `.first()`-, `.all()`-, `.run()`- und `.batch()`-Aufruf in `currentInvocationSubrequests` mitzählt. Gleichzeitig werden während eines Import-Batches alle Schreibbefehle in einer Batch-Transaktionsliste (`pendingD1BatchStatements`) gesammelt und am Ende in einem einzigen `db.batch()` ausgeführt.
  - *Warum*: Ein `db.batch()` mit 40 SQL-Statements zählt bei Cloudflare als **nur 1 einziger Subrequest** statt 40. Damit sinkt die D1-Last pro Batch um über 90 %.
- **Entscheidung 2: Client-seitiger `resolvedTitlesCache` im Mini-App-Importer**
  - *Gewählter Ansatz*: Der Browser speichert für jeden erfolgreich verarbeiteten oder bereits als `TMDB_NOT_FOUND` eingestuften Titel den normalisierten Titel-Key im RAM und in `localStorage`. Kommen im weiteren Verlauf (z. B. bei `#5469`) weitere Folgen derselben Serie oder Duplikate vor, sendet der Browser `tmdb_id` bzw. das Negativ-Flag direkt mit.
  - *Warum*: Spart sowohl im Browser als auch im Worker sämtliche Such-Kaskaden für bereits bekannte Titel über alle 180.000 Einträge hinweg.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Batch Pipeline Diagram

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                  Mini-App JSON-Importer (Browser-Client)                       │
│                                                                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ 1. Client-Side resolvedTitlesCache (RAM + localStorage)                  │  │
│  │    • Prüft jeden Eintrag im 10er-Slice vor dem Senden                    │  │
│  │    • Bekannter Titel (>= 85 %): Setzt tmdb_id, typeCode, Poster vorab    │  │
│  │    • Bekannter Negativ-Titel: Markiert knownUnmatched = true (0 APIs)    │  │
│  └────────────────────────────────────┬─────────────────────────────────────┘  │
└───────────────────────────────────────┼────────────────────────────────────────┘
                                        │ POST /api/tma/admin/import-batch
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                   Cloudflare Worker Import-Pipeline (Server)                   │
│                                                                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ 2. Bulk D1 Prefetch (1 einziger db.batch() = 1 Subrequest)               │  │
│  │    • Lädt alle file_ids, entity_cache-Keys & vorhandene Serien/Filme     │  │
│  │      für den gesamten Batch in einem einzigen D1-Roundtrip in den RAM    │  │
│  └────────────────────────────────────┬─────────────────────────────────────┘  │
│                                       ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ 3. Sequenzielle Auflösung mit Unified Subrequest-Guard (HTTP + D1 + KV)  │  │
│  │    • Jede echte HTTP-, D1- und KV-Operation erhöht subrequestCount       │  │
│  │    • Alle D1-Writes (movies, series, episode_files, entity_cache)        │  │
│  │      aktualisieren sofort den RAM und landen in pendingD1BatchStatements │  │
│  │    • Ab 32 Gesamt-Subrequests: Sauberer Stopp -> PARTIAL_BATCH           │  │
│  └────────────────────────────────────┬─────────────────────────────────────┘  │
│                                       ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ 4. Bulk D1 Flush am Batch-Ende (1 einziger db.batch() = 1 Subrequest)    │  │
│  │    • Schreibt alle gesammelten Statements + Playlist-Items +             │  │
│  │      Diagnose-Logs + Import-Checkpoint gemeinsam in 1 D1-Transaktion     │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State Mapping

- **Unified Subrequest Counter (`currentInvocationSubrequests`)**:
  - Zählt jeden `fetchWithTimeout`-Aufruf (+1), jeden echten D1-Roundtrip über den D1-Binding-Proxy (`.first()`, `.all()`, `.run()`, `.batch()` je +1) und jeden KV-Aufruf (`kvCachedGetRaw` bei Cache-Miss +1).
  - `ensureD1Schema` wird pro Worker-Isolate nur 1x ausgeführt; zudem wird bei bereits initialisierten Tabellen der zweite `sqlite_master`-Roundtrip eingespart.
- **Bulk D1 Prefetch (`prefetchBatchMediaFromD1`)**:
  - Sammelt vor der Batch-Schleife alle `telegram_file_id`s und `title_res_*`-Cache-Keys der 10 Einträge und führt deren `SELECT`-Abfragen gebündelt in einem einzigen `db.batch()` aus, der direkt `memoryFallback` befüllt. Damit benötigt `findExistingMediaInD1BeforeExternalSearch` innerhalb der Schleife **0 zusätzliche D1-Subrequests**.
- **Buffered D1 Batch Commit (`beginD1BatchBuffer` / `flushD1BatchBuffer`)**:
  - Während `processEntriesBatchWithLimit` aktiv ist, reihen `saveMovieToD1`, `saveSeriesToD1`, `saveSeasonToD1`, `saveMovieFileToD1`, `saveEpisodeFileToD1`, `saveEntityToD1`, `saveSearchCacheToD1`, `saveImportDiagnosticLogsToD1`, `batchUpsertPlaylistItemsInD1` und `saveImportCheckpointToD1` ihre vorbereiteten SQL-Statements in den Batch-Buffer ein und führen am Ende von `/api/tma/admin/import-batch` (bzw. `/api/import-json`) einen einzigen gesammelten `db.batch()` aus.
- **Client-Side Title Cache (`clientResolvedTitleCache` in der Mini-App)**:
  - Speichert nach jedem Batch alle aufgelösten `batchItems` (sowie `TMDB_NOT_FOUND`-Titel derselben Import-Sitzung) unter ihrem normalisierten Titel+Jahr-Schlüssel, sodass nachfolgende Episoden oder Duplikate im Browser vorab mit `tmdb_id` versehen werden.
