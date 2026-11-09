# D1-Persistenz-Garantie & Batch-Latenz-Optimierung

Dieses Update behebt die gemeinsame Hauptursache dafür, warum Filme/Serien teilweise nur im RAM (`memoryFallback`) blieben **und** warum Batches `6.726 ms` benötigten, und optimiert gleichzeitig das D1-Batching sowie das Pacing im Frontend.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Gefundene Hauptursache (Root Cause für RAM-only + 6.726 ms Latenz):**
> 1. **Wrapper-Konflikt in `ensureD1Schema` blockierte die Spalten-Migration:**
>    In `ensureD1Schema` wurde `rawDb.batch([ db.prepare(...) ])` aufgerufen. Da `db.prepare(...)` unser Wrapper-Objekt (`{ _rawStmt, ... }`) zurückgibt, erwartet das native Cloudflare `rawDb.batch()` jedoch ungewrappte `rawDb.prepare(...)`-Statements. Dadurch brach `ensureD1Schema` vor dem `ALTER TABLE`-Block ab (`catch (e) { d1SchemaInitialized = true; }`).
> 2. **Fehlende Spalten ließen D1-Inserts scheitern (Daten blieben nur im RAM):**
>    Weil die neuen Spalten (`manual_override`, `file_fingerprint`, `part_number`, `edition_label`, `is_bonus`, `matched_title`) durch den abgebrochenen Migrations-Block in bestehenden D1-Tabellen fehlten, wurden Filme und Serien zwar vorab in `memoryFallback` (RAM) eingetragen, aber das anschließende `INSERT INTO movies / series / movie_files` in `flushD1BatchBuffer` schlug mit einem SQLite-Spaltenfehler fehl.
> 3. **6.726 ms Latenz durch den Fehler-Fallback in `flushD1BatchBuffer`:**
>    Wenn `rawDb.batch(chunk)` wegen einer fehlenden Spalte fehlschlug, sprang `flushD1BatchBuffer` in den `catch (batchErr)`-Block und versuchte, alle 30–60 Statements einzeln nacheinander per `await singleStmt.run()` auszuführen – was die Batch-Laufzeit auf **6.726 ms** hochtrieb und bei `hasSubrequestBudget(44)` restliche Schreibbefehle abbrach!

- **Entscheidung 1 (Garantierte D1-Schema-Migration & Unwrapping):**
  - `ensureD1Schema` nutzt durchgehend native `rawDb.prepare(...)`-Statements (und `wrapD1Stmt` / `flushD1BatchBuffer` entpacken `stmt._rawStmt || stmt` immer zuverlässig).
  - Zusätzlich werden alle neuen Spalten sowohl direkt in `CREATE TABLE IF NOT EXISTS` als auch im `ALTER TABLE`-Migrationsblock angelegt. Falls `ALTER TABLE` noch nicht durchgelaufen ist, darf `d1SchemaInitialized` niemals vorzeitig auf `true` gesetzt werden.
- **Entscheidung 2 (100 % D1-Schreibgarantie für Filme, Serien, Episoden & Dateien):**
  - `flushD1BatchBuffer` verwirft im Fallback niemals Statements wegen `hasSubrequestBudget(44)`, sondern führt D1-Writes garantiert aus.
  - `d1_movie_saved_ts_${mid}` und `d1_series_saved_ts_${sid}` werden erst gesetzt, wenn das SQL-Statement tatsächlich ohne Fehler an D1 übergeben wurde.
- **Entscheidung 3 (Worker schonen ohne Datenverlust):**
  - **Sammel-Prefetch (`prefetchBatchMediaFromD1`):** Lädt `movie_files` und `episode_files` für bekannte `tmdb_id`s im Batch in **1 einzigen `rawDb.batch()`-Read** vorab.
  - **Zero-Write nur bei verifizierten D1-Duplikaten:** Ein `SKIPPED_DUPLICATE`-Short-Circuit greift nur dann, wenn die Datei bereits real aus D1 geladen wurde (`fromD1: true`). Neue Filme, Serien, Episoden und neue Qualitäten werden **immer** in D1 geschrieben.
  - **`cleanupEmptySeriesInD1AndMemory` nur am Import-Ende:** Läuft nur noch beim letzten Batch (`isFinalBatch`), nicht nach jedem 10er-Zwischenbatch.
  - **Adaptives Pacing statt starrer 5s-Pause:** Keine Zusatzpause bis `4.500 ms`; kurze `1.000 ms` Verschnaufpause bei `4.500–6.500 ms`; `2.000 ms` Cooldown erst ab `> 6.500 ms`.

---

## 1. Overview & Core Concept

- **Was wird sichergestellt:** Jeder erkannte oder manuell bestätigte Film, jede Serie, jede Episode und jeder Stream-Link wird garantiert und dauerhaft in den Cloudflare-D1-Tabellen (`movies`, `series`, `series_seasons`, `series_episodes`, `movie_files`, `episode_files`, `d1_playlist_items`) gespeichert – nach einem Browser-Reload oder Worker-Neustart ist 100 % des Katalogs in D1 vorhanden.
- **Gleichzeitige Worker-Schonung:** Durch das funktionierende `rawDb.batch()` werden alle Schreibzugriffe eines Batches in **1 einzigen D1-Batch-Transaktion** (~50–120 ms statt 6.726 ms) ausgeführt.

---

## 2. User Experience & Visual Design

- **Verlässliche D1-Speicherung & schneller Import-Takt:**
  - Im Backup-Importer laufen Batches ohne den bisherigen `batchErr`-Einzelfallback in unter **1–3 Sekunden** durch.
  - Nach Abschluss (oder Pausieren) des Imports bleiben alle Filme, Serien und Episoden dauerhaft in D1 gespeichert und sind sofort auf allen Geräten abrufbar.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Sicheres Statement-Unwrapping in allen `rawDb.batch()`-Aufrufen**
  - *Gewählter Ansatz:* Eine zentrale Hilfsfunktion `unwrapRawD1Statements(stmts)` stellt sicher, dass `rawDb.batch()` ausschließlich native D1-Statements erhält.
  - *Warum:* Verhindert `D1_TYPE_ERROR` bei Schema-Initialisierung und Sammel-Batches.
- **Entscheidung 2: Unterscheidung zwischen RAM-Vorschau und echtem D1-Bestand (`_persistedInD1`)**
  - *Gewählter Ansatz:* Einträge im Memory-Cache erhalten das Flag `_persistedInD1: true` erst dann, wenn sie aus D1 gelesen oder erfolgreich per `flushD1BatchBuffer` in D1 geschrieben wurden.
  - *Warum:* Dadurch wird kein Film und keine Serie jemals fälschlich beim D1-Schreiben übersprungen, nur weil die Metadaten kurz zuvor im RAM lagen.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌────────────────────────────────────────────────────────────────────────────┐
│            GARANTIERTE D1-PERSISTENZ & SCHNELLE BATCH-PIPELINE             │
├────────────────────────────────────────────────────────────────────────────┤
│ 1. ensureD1Schema(env)                                                     │
│    ├── Native rawDb.prepare() für CREATE TABLE + ALTER TABLE Migrationen   │
│    └── Alle neuen Spalten (manual_override, file_fingerprint, part_number, │
│        edition_label, is_bonus, matched_title) garantiert in D1 vorhanden  │
├────────────────────────────────────────────────────────────────────────────┤
│ 2. prefetchBatchMediaFromD1(env, entriesList)                              │
│    └── 1 rawDb.batch() Read lädt bestehende D1-Zeilen (inkl. _fromD1=true) │
├────────────────────────────────────────────────────────────────────────────┤
│ 3. resolveAndIngestMediaEntry -> saveMovieToD1 / saveSeriesToD1            │
│    ├── Pushes INSERT OR REPLACE für movies/series/episodes/files in Buffer │
│    └── Überspringt D1-Write NUR, wenn Eintrag bereits mit _fromD1=true     │
│        in D1 verifiziert ist                                               │
├────────────────────────────────────────────────────────────────────────────┤
│ 4. flushD1BatchBuffer(env) am Batch-Ende                                   │
│    ├── Entpackt alle Statements sauber via unwrapRawD1Statements()         │
│    ├── Committet alle Filme, Serien & Dateien in 1 atomaren rawDb.batch()  │
│    └── Kein Verwerfen von Schreibbefehlen durch Subrequest-Limits          │
└────────────────────────────────────────────────────────────────────────────┘
```

### Geplante Änderungen im Detail
1. **Schema-Initialisierung & D1-Wrapper (`04-d1-database.js`):**
   - `unwrapRawD1Statements(stmts)` einführen und in `ensureD1Schema`, `flushD1BatchBuffer` sowie `db.batch` verwenden.
   - In `ensureD1Schema`: Alle neuen Spalten (`manual_override`, `file_fingerprint`, `part_number`, `edition_label`, `is_bonus`, `review_reason_code`, `matched_title`) direkt in die `CREATE TABLE IF NOT EXISTS`-Definitionen aufnehmen und den `ALTER TABLE`-Migrationsblock mit `rawDb.batch(unwrapRawD1Statements(alterStmts))` absichern.
2. **Garantierte D1-Speicherung für Filme, Serien & Dateien (`04-d1-database.js`):**
   - In `saveMovieToD1` und `saveSeriesToD1`: Die 30-Minuten-Wiederholsperre (`d1_movie_saved_ts_${mid}` / `d1_series_saved_ts_${sid}`) darf nur greifen, wenn der Film bzw. die Serie nachweislich bereits in D1 existiert, und die vorherige Einzel-`SELECT manual_override`-Abfrage wird durch das bereits vorgeladene `manual_override`-Feld bzw. ein `ON CONFLICT(tmdb_id) DO UPDATE ... WHERE COALESCE(movies.manual_override, 0) = 0 OR excluded.manual_override = 1` direkt im SQL-Statement ersetzt (spart 1 D1-Read pro Film/Serie UND garantiert den D1-Write!).
   - In `saveEpisodeFileToD1`: Die neuen Spalten `file_fingerprint, part_number, edition_label, is_bonus` ebenfalls vollständig im `INSERT INTO episode_files` persistieren.
   - In `saveMovieFileToD1` und `saveEpisodeFileToD1`: Nur dann den D1-Write als `isExactDuplicate` überspringen, wenn die identische Datei bereits in D1 (`_fromD1: true`) gespeichert ist.
   - In `flushD1BatchBuffer`: Den `hasSubrequestBudget(44)`-Abbruch im Fehler-Fallback entfernen, damit niemals ein D1-Schreibbefehl stillschweigend verworfen wird.
3. **Worker-Loop & Frontend-Pacing (`07-webhook-callbacks.js`, `09-tma-api-worker-export.js`, `08c-tma-netflix-frontend.js`):**
   - `cleanupEmptySeriesInD1AndMemory` nur noch beim finalen Batch (`isFinalBatch`) ausführen.
   - `BATCH_WALL_CLOCK_LIMIT_MS` auf `5200ms` setzen und `JSON_INGEST_DELAY_MS` bei reinen D1-/Cache-Treffern überspringen.
   - Im Frontend die starre `2000ms -> 5s Pause` durch das adaptive Pacing (`<= 4500ms` 0s Zusatzpause, `4500–6500ms` 1s Kurzpausierung, `> 6500ms` 2s Cooldown) ersetzen.
