# Cloudflare API-, D1- & KV-Quota-Optimierung (Kein Tageslimit-Lockout mehr)

Dieser Plan behebt die vier Hauptursachen im Code, die bisher deine täglichen Cloudflare-Kontingente (5 Mio. D1-Reads, 100k D1-Writes, 1.000 KV-Writes und 100k Worker-Requests) vorzeitig aufgebraucht und das Admin-Panel am Ende des Tages blockiert haben.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Warum das Tageslimit bisher explodiert ist (Code-Diagnose):**
> 1. **Fehlende SQLite-Indizes in D1 (Full-Table-Scans):** In `movie_files`, `episode_files` und `series_episodes` fehlten Sekundär-Indizes auf `movie_id`, `series_id` und `telegram_file_id`. Dadurch hat D1 bei **jeder einzelnen Episoden-Speicherung** die komplette Tabelle (tausende Zeilen × 6 Abfragen = ~30.000 gelesene Zeilen pro Folge!) komplett durchsucht.
> 2. **KV-Write-Explosion beim Import (1.000 KV-Writes/Tag Limit):** Jeder 6er-Batch beim JSON-Import hat bisher sofort die riesige `saved_bot_vip`-Liste UND den `import-checkpoint` per `KV.put()` geschrieben. Bei 500 Batches waren das 1.000 `KV.put`-Aufrufe – das komplette Tageslimit von Cloudflare KV!
> 3. **Schwere Voll-Synchronisation bei jedem Admin-Panel-Öffnen:** `GET /api/tma/admin/overview` hat bei jedem Öffnen automatisch `ensureBotVipDefaultPlaylist` (liest alle Filme, alle Serien und alle Episoden-Dateien + schreibt KV), `cleanupEmptySeriesInD1AndMemory` (Full-Table-Scan `DELETE`) und `computeSeriesGapsOverview` ausgeführt.
> 4. **Redundante Serien-Writes pro Folge:** Beim Import von Staffel 1 (z. B. 20 Folgen) wurde `saveSeriesToD1` (inkl. Staffel-Cleanup-Queries) 20-mal hintereinander für dieselbe Serie ausgeführt statt nur 1-mal.

- **Entscheidung 1 (SQLite-Indizes & RAM-First-Caching):** Wir legen alle fehlenden D1-Indizes automatisch in `ensureD1Schema` an und prüfen bei User-Auth (`getUserByTelegramIdFromD1`), Film-/Serien-Details und Datei-Abfragen immer zuerst den `memoryFallback`-RAM-Cache, bevor D1 abgefragt wird.
- **Entscheidung 2 (KV-Write-Bremse):** Checkpoints und Playlist-Updates während des laufenden JSON-Imports werden im RAM + Browser-`localStorage` sofort aktualisiert, aber nur noch gebündelt (alle 15 Batches bzw. bei Pause/Abschluss) in Cloudflare KV geschrieben (**-93% KV-Writes**).
- **Entscheidung 3 (Admin-Notfallzugang bei erschöpftem Limit):** Falls D1 oder KV am Abend ein Quota-Limit melden, fängt ein **Quota-Fallback-Schutzschild** den Fehler ab und bedient Auth sowie Admin-Panel nahtlos aus dem signierten Session-Token und dem Worker-RAM-Cache.

---

## 1. Overview & Core Concept

- **Was wird verbessert:** Drastische Senkung der gelesenen und geschriebenen D1-Zeilen (um ca. **90–95 %**), der KV-Schreibzugriffe (um ca. **90 %**) und der Admin-API-Last, ohne dass Funktionen oder Daten verloren gehen.
- **Hauptnutzen:** Selbst an Tagen mit riesigen JSON-Importen (tausende Filme & Serien-Episoden) bleibt dein tägliches Cloudflare-Kontingent im grünen Bereich, und das Admin-Panel öffnet jederzeit verzögerungsfrei.

---

## 2. User Experience & Visual Design

- **Sofortiger Admin-Panel-Start:** Das Öffnen des Admin-Panels lädt die Übersicht in einem Bruchteil der bisherigen Zeit, weil keine unaufgeforderten Voll-Scans (`syncD1CatalogIntoBotVipPlaylist`, `cleanupEmptySeries`) mehr bei jedem Tab-Wechsel blockieren.
- **Ununterbrochener Import ohne KV-Blockade:** Der Batch-Import läuft flüssig durch, ohne nach einigen hundert Einträgen an `KV put limit exceeded` oder `D1 rows read exceeded` zu scheitern.
- **Gezielte Diagnose-Log-Speicherung:** Um D1-Writes zu schonen, werden im schnellen RAM-Puffer weiterhin alle 2.500 letzten Einträge gehalten, während in die D1-Tabelle `import_diagnostic_logs` bevorzugt relevante Einträge (Konflikte, Fehler, Nicht-Gefunden, Vorabversionen) bzw. kompakte Batches geschrieben werden.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Sekundär-Indizes für alle D1-Fremdschlüssel**
  - *Gewählter Ansatz:* `CREATE INDEX IF NOT EXISTS` für `idx_movie_files_movie_id`, `idx_movie_files_fid`, `idx_episode_files_series_ep`, `idx_episode_files_fid`, `idx_series_episodes_series`, `idx_media_reports_status` und `idx_diag_logs_msg`.
  - *Warum:* Cloudflare D1 zählt jede bei einem Query gescannte Zeile gegen das 5-Mio.-Tageslimit. Mit Index liest `WHERE movie_id = ?1` exakt 1–2 Zeilen statt 10.000 Zeilen.
- **Entscheidung 2: RAM-First User-Auth & gecachte Admin-Übersicht**
  - *Gewählter Ansatz:* `getUserByTelegramIdFromD1` nutzt einen 5-Minuten-RAM-Cache (`memoryFallback`), sodass nicht jeder einzelne API-Request (`/api/tma/*`) einen D1-Read auf `users` auslöst. Schwere Aufgaben wie `computeSeriesGapsOverview` und `cleanupEmptySeriesInD1AndMemory` werden für 3 Minuten im RAM gecacht bzw. nur bei echten Änderungen invalidiert.
  - *Warum:* Spart bei normaler App- und Admin-Nutzung über 80 % aller wiederkehrenden D1-Reads.
- **Entscheidung 3: Gedrosselte KV-Persistierung (Write-Coalescing)**
  - *Gewählter Ansatz:* Während `/api/tma/admin/import-batch` läuft, wird die KV-Playlist (`saved_bot_vip` / `saved_<chatId>`) im Worker-RAM sofort aktualisiert und nur alle 15 Batches (oder beim letzten Batch / Pause) physisch per `KV.put` geschrieben. Der Client-Checkpoint nutzt primär `localStorage` + Worker-RAM und schreibt nur bei Pause/Stopp oder alle 20 Batches in KV.
  - *Warum:* Schützt das extrem knappe Cloudflare Free-Tier-Limit von 1.000 `KV.put`-Aufrufen pro Tag.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architektur- & Quota-Schutz-Diagramm

```
┌──────────────────────────────────────────────────────────────────────────┐
│                 Client / Admin-Panel (Browser & TMA)                     │
│  • Checkpoint bei jedem Batch in localStorage (KV nur alle 20 Batches)   │
│  • Deduped Admin-Overview Abfrage (kein Doppel-Reload bei Tab-Wechsel)   │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│               Cloudflare Worker API & Quota-Shield (RAM-First)           │
│  1. Auth-Check: Signiertes Session-Token + 5-Min. RAM-Cache (0 D1-Reads) │
│  2. Import-Batch:                                                        │
│     • Serie bereits in D1/RAM? -> Überspringe redundantes saveSeriesToD1 │
│     • Staffel bereits in D1/RAM? -> Überspringe redundantes saveSeason   │
│     • Playlist-Sync im RAM -> Physisches KV.put nur alle 15 Batches      │
│  3. Admin-Overview:                                                      │
│     • Kein ungefragtes Voll-Sync/DELETE bei jedem GET-Request            │
│     • Series-Gaps & Katalog-Listen mit Smart-TTL im RAM gecacht          │
└─────────────────┬────────────────────────────────────────┬───────────────┘
                  │                                        │
                  ▼                                        ▼
┌──────────────────────────────────────┐ ┌─────────────────────────────────┐
│     Cloudflare D1 (SQLite + Index)   │ │       Cloudflare KV Store       │
│ • idx_movie_files_movie_id           │ │ • Write-Coalescing (Debounced)  │
│ • idx_episode_files_series_ep        │ │ • RAM-Fallback falls 1.000/Tag  │
│ • idx_series_episodes_series         │ │   KV-Put-Limit erreicht ist     │
│ • 1–2 Rows Read statt Full-Scan!     │ └─────────────────────────────────┘
└──────────────────────────────────────┘
```

### Interaktive Komponenten- & Status-Zuordnung
1. **D1 Schema & Index-Booster:** Beim ersten Zugriff legt `ensureD1Schema` alle 7 Performance-Indizes in einem einzigen `db.batch()` an.
2. **RAM-First Caching Layer:** `getMovieFromD1`, `getSeriesFromD1`, `getSeasonFromD1`, `getMovieFilesFromD1`, `getEpisodeFilesFromD1` und `getUserByTelegramIdFromD1` prüfen zuerst den Worker-RAM (`memoryFallback`), bevor sie eine D1-Query abfeuern, und aktualisieren den RAM-Cache bei jedem Write.
3. **Import-Write-Reduktion:** Während eines Serien-Imports wird `saveSeriesToD1` pro Serie nur noch einmal ausgeführt (statt für jede Episode erneut), und `saveSeasonToD1` schreibt nur noch geänderte Staffeln.
4. **Admin-Panel Quota-Resilienz:** Selbst wenn Cloudflare D1 oder KV einen Rate-/Quota-Fehler wirft, fällt `/api/tma/admin/overview` und `/api/tma/auth/*` niemals mit HTTP 500/503 aus, sondern liefert die im Worker-RAM und Session-Token gehaltenen Admin-Daten zurück.
