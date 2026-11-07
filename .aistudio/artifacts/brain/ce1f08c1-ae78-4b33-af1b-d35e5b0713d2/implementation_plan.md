# Minimierung der API-Zugriffe & Schutz vor HTTP 503 beim JSON-Import

Dieser Plan beseitigt die `HTTP 503` Gateway-/Rate-Limit-Abbrüche (z. B. bei Eintrag `#1093`) beim Massen-Import großer Telegram-Backups (`100k+` Einträge), indem identische Titel (Filme, Serien-Staffeln, Mehrteiler, Qualitäts-Upgrades und auch unauffindbare Titel) über alle 8 APIs hinweg nur **ein einziges Mal** gesucht und danach zu 100 % lokal aus D1 & RAM aufgelöst werden.

## User Review & Critical Decisions

> [!IMPORTANT]
> Alle Entscheidungen basieren direkt auf deinen Vorgaben aus der Rückfrage:

- **Entscheidung 1 (D1-First Vorab-Check & Sofort-Stopp ab 85 % Treffer)**: Bevor überhaupt ein externer Request an TMDb gesendet wird, prüft der Worker lokal in D1 (`movie_files`, `episode_files`, `movies`, `series`, `entity_cache`), ob Datei oder Titel bereits bekannt sind. Liefert die erste TMDb-Suche (Titel + Jahr) bereits einen Treffer mit $\ge 85\%$ Sicherheit, bricht die Suchkaskade sofort ab (keine überflüssige Zweitsuche ohne Jahr mehr).
- **Entscheidung 2 (Alle 8 APIs aktiv, aber 0 doppelte Suchen bei gleichem Titel)**: Die vollständige 8-API-Kaskade (TMDb, OMDb, Apple iTunes DE, TVMaze, Wikidata, AniList, Jikan/MAL, Wikipedia DE/EN) bleibt während des Massen-Imports uneingeschränkt aktiv. Sobald ein Titel (egal ob als Treffer in TMDb, als Treffer in einer der 7 Fallback-APIs oder als „Nicht gefunden“) einmal aufgelöst wurde, wird das Ergebnis für diesen normalisierten Titel in RAM + D1 (`entity_cache`) hinterlegt, sodass alle weiteren Folgen, Teile oder Duplikate desselben Titels **0 externe API-Requests** verbrauchen.

---

## 1. Ursache des Fehlers bei `#1093` (Root-Cause-Analyse)

1. **Wiederholte 8-API-Suchen für denselben Titel (Hauptursache für HTTP 503)**:
   - Bisher wurden nur offizielle TMDb-Serien (`id < 8000000`) im `entity_cache` gespeichert.
   - Wurde eine Serie über eine der 7 Fallback-APIs (`id >= 8000000`, z. B. TVMaze, Wikidata oder Wikipedia) gelöst **oder** in keiner der 8 APIs gefunden (`TMDB_NOT_FOUND`), fand **keine** Speicherung im Titel-Cache statt.
   - Bei einer Serie mit 20 Folgen oder mehreren Dateien gleichen Namens hat der Worker für **jede einzelne Folge** erneut bis zu 15 externe HTTP-Requests über alle 8 APIs abgefeuert.
2. **Doppelte TMDb-Suche bei fast jedem Film (`hitsWithYear < 2`)**:
   - In `searchTmdbCandidatesForImport` stand bisher `if (!parsed.year || hitsWithYear < 2) await runTmdbQuery(..., null)`. Da ein Film mit exakter Jahreszahl bei TMDb fast immer genau `1` Treffer liefert (`hitsWithYear === 1`), wurde bei nahezu jedem Film unnötig ein zweiter TMDb-Request ohne Jahr ausgeführt.
3. **Versteckte Cloudflare-Subrequests durch `caches.default` & ungezählte Detail-Fetches**:
   - Cloudflare berechnet für `caches.default.match()` und `caches.default.put()` jeweils einen eigenen Subrequest vom 50-Subrequest-Limit pro Worker-Aufruf. Ein einziger Cache-Miss verbrauchte damit 3 Subrequests statt 1, während `fetchMovieDetails`, `fetchSeriesDetails` und `fetchSeasonDetails` gar nicht im `currentInvocationSubrequests`-Zähler mitgezählt wurden. Dadurch griff der 40-Subrequest-Schutz (`PARTIAL_BATCH`) zu spät und Cloudflare brach den Request mit `HTTP 503` ab.
4. **Wiederholtes `resolveSeriesVersionOnTMDb` & `saveSeriesToD1` pro Folge**:
   - Bei 10 Folgen derselben Staffel in einem Batch wurde für jede Folge erneut die Serien-Versionsprüfung und das Speichern des Serien-Stammsatzes ausgeführt.

---

## 2. Technische Architektur & Datenstrategie

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   JSON-Import Batch (/api/tma/admin/import-batch)          │
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       │
                                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STUFE 0: Lokaler D1-First & RAM Vorab-Check (0 externe API-Requests!)      │
│  1. Existiert telegram_file_id / (chat_id + msg_id) schon in D1?           │
│     └──► JA: Sofort als SKIPPED_DUPLICATE / bekanntes Medium übernehmen    │
│  2. Existiert Titel-Schlüssel (normTitle + Jahr + Typ) in RAM / D1?        │
│     ├──► Bekannter Treffer (TMDb ODER Fallback-API >= 8000000):            │
│     │    Sofort vorhandene ID & Metadaten aus D1/RAM nutzen (0 API-Calls)  │
│     └──► Bekannter Negativ-Treffer (NEGATIVE_CACHE / TMDB_NOT_FOUND):      │
│          Sofort als "Nicht erkannt" markieren, 8 APIs NICHT erneut fragen! │
│  3. Existiert Film/Serie bereits mit exaktem Titel (+ Jahr) in D1          │
│     (`movies` / `series` Tabelle)?                                         │
│     └──► JA: Direkt bestehende D1-Entität verknüpfen (0 Such-Calls)        │
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       │ (Nur bei echtem neuen/unbekannten Titel)
                                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STUFE 1: TMDb-Suche mit Early-Exit ab >= 85% Confidence                    │
│  • Suche (Titel + Jahr): Wenn bester Treffer >= 85% Confidence hat         │
│    ──► SOFORT-STOPP! Keine Zweitsuche ohne Jahr, keine Varianten-Suche.    │
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       │ (Nur wenn TMDb < 85% / kein Treffer)
                                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STUFE 2: 8-API Fallback-Kaskade mit persistentem Titel-Cache               │
│  • OMDb ──► iTunes DE ──► TVMaze ──► Wikidata ──► AniList ──► Jikan ──► WP │
│  • Ergebnis (egal ob Fallback-Hit >= 8000000 oder Negativ-Ergebnis) wird   │
│    sofort unter `title_res_<type>_<normTitle>_<year>` in RAM + D1          │
│    (`entity_cache`) gespeichert -> 2. Datei gleichen Titels = 0 API-Calls! │
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       │
                                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STUFE 3: Präzises Subrequest-Budget & Einmal-Staffel-Auflösung             │
│  • Jede echte externe HTTP-Anfrage (inkl. Movie/Series/Season-Details)     │
│    zählt exakt im Subrequest-Zähler; `caches.default` Overhead entfällt.   │
│  • Serien-Stammdaten & Staffel-Metadaten werden pro Staffel nur 1x         │
│    aufgelöst und für alle Folge-Episoden direkt aus D1/RAM bedient.        │
└────────────────────────────────────────────────────────────────────────────┘
```

### Wichtige Produkt- & Architekturentscheidungen

- **Universeller Positiv- & Negativ-Titel-Cache (`title_res_*`) in RAM + D1 (`entity_cache`)**:
  - *Gewählter Ansatz*: Jeder aufgelöste Titel – unabhängig davon, ob Film oder Serie, ob offizielle TMDb-ID (`< 8000000`), synthetische Fallback-ID (`>= 8000000`) oder `NOT_FOUND` – wird unter seinem normalisierten Schlüssel (`title_res_s_<normTitle>_<year>` bzw. `title_res_m_<normTitle>_<year>`) im RAM und in `entity_cache` (D1) gecacht.
  - *Warum*: Wenn in einem Backup 25 Folgen einer seltenen Serie (oder 25 Teile mit nicht erkennbarem Dateinamen) hintereinander vorkommen, sucht nur Folge 1 über die 8 APIs. Die Folgen 2 bis 25 erhalten sofort (in `< 1 ms`) dasselbe Ergebnis aus dem Cache, ohne einen einzigen externen Request auszulösen.
  - *Sicherheit bei manueller Korrektur*: Sobald du im Review-Tab einen `NOT_FOUND`- oder Konflikt-Eintrag manuell über „Alle 8 APIs durchsuchen“ oder per Kandidaten-Klick korrigierst (`remap-saved-media`), wird ein eventuell vorhandener Negativ-Cache-Eintrag für diesen Titel sofort mit der korrekten TMDb-ID überschrieben.
- **D1-First Lookup in den Tabellen `movies` und `series`**:
  - *Gewählter Ansatz*: Vor einer externen Suche prüft ein schneller D1-Lookup (gecacht in einer In-Memory-Titel-Map), ob in `movies` oder `series` bereits ein Eintrag mit identischem normalisiertem Titel (und passendem Release-Jahr) existiert.
  - *Warum*: Bei Qualitäts-Upgrades (z. B. `720p` $\rightarrow$ `1080p`), Mehrteilern (`CD1` / `CD2`) oder beim Fortsetzen/Neustarten eines 180k-Imports werden bereits in D1 vorhandene Filme und Serien komplett ohne API-Aufruf zugeordnet.
- **Exaktes Subrequest-Tracking & sanftes `PARTIAL_BATCH` statt `HTTP 503`**:
  - *Gewählter Ansatz*: Alle externen `fetchWithTimeout`-Aufrufe (auch in `fetchMovieDetails`, `fetchSeriesDetails`, `fetchSeasonDetails`) erhöhen `currentInvocationSubrequests`. Zudem verzichten wir im Worker während des Massen-Imports auf unnötige `caches.default.match/put`-Subrequests, da Ergebnisse ohnehin persistent in D1 + RAM liegen.
  - *Warum*: Der Subrequest-Guard stoppt garantiert rechtzeitig bei 30 Subrequests und gibt ein sauberes `PARTIAL_BATCH` zurück, statt bei Eintrag `#1093` in einen harten Cloudflare `HTTP 503` Fehler zu laufen und den Eintrag fälschlich zu isolieren.
