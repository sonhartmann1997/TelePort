# Lokaler D1-Vorab-Check (`checkDatabaseForExistingTitle`) mit 85%-Stop-Limit in `handleDispatchWorkerImportBatch`

Erweiterung der Batch-Import-Pipeline um einen lokalen `checkDatabaseForExistingTitle(title)`-Helper in `handleDispatchWorkerImportBatch` sowie im JSON-Backup-Splitter-Modal, der vor jeglichen externen API-Aufrufen (TMDb, OMDb und 8-API-Fallbacks) die D1-Datenbank bzw. den lokalen D1-Katalog prüft und ab 85 % Übereinstimmung die gefundene TMDb-ID direkt vorab setzt.

## User Review & Critical Decisions

> [!IMPORTANT]
> Beide Architekturentscheidungen wurden durch deine Rückmeldung bestätigt und sind verbindlich eingeplant:

- **Bestätigte Entscheidung 1 (Vorab-TMDb-ID statt Überspringen bei $\ge 85\,\%$ D1-Treffer)**: Findet `checkDatabaseForExistingTitle(title)` einen bestehenden D1-Eintrag mit mindestens 85 % Übereinstimmung, wird die aufgelöste `tmdb_id`, der Medientyp (`movie` / `series`), das Poster sowie die Metadaten-Quelle direkt im Batch-Eintrag vorab gesetzt. Dadurch speichert der Worker neue Stream-/Qualitätsdateien oder neue Serienfolgen mit **0 externen API-Calls** in D1.
- **Bestätigte Entscheidung 2 (Browser-OMDb-Vorabsuche ebenfalls stoppen)**: Das JSON-Backup-Splitter-Modal (`enrichBatchEntriesWithOmdbFallback`) nutzt denselben D1-Vorab-Check, sodass für bereits in D1 vorhandene Titel ($\ge 85\,\%$) auch im Browser keinerlei OMDb-Requests mehr ausgelöst werden.

---

## 1. Overview & Core Concept

- **Was diese Änderung bewirkt**: Bevor ein JSON-Import-Batch über `handleDispatchWorkerImportBatch` an den Worker gesendet oder im Splitter-Modal mit OMDb-Postern angereichert wird, prüft `checkDatabaseForExistingTitle(title)` lokal gegen den D1-Bestand (über den D1-Katalog, die gespeicherten Entitäten und einen leichtgewichtigen Worker-D1-Lookup), ob der Titel bereits mit $\ge 85\,\%$ Sicherheit bekannt ist.
- **Zielgruppe & Kontext**: Admins beim Import großer Telegram-JSON-Archive (100.000+ / 180.000 Einträge) über den Stream-Splitter und die Worker-Batch-Pipeline.
- **Mehrwert**: Verhindert redundante externe HTTP-Requests im Browser (OMDb) und im Worker (TMDb + 8-API-Kaskade), beschleunigt Serien- und Mehrqualitäts-Importe massiv und schützt zuverlässig vor `HTTP 503` / Rate-Limits.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Batch-Versand über `handleDispatchWorkerImportBatch`**: Für jeden Eintrag im Batch extrahiert der Helper den bereinigten Titel (inkl. Jahr und Serien-/Film-Erkennung) und ruft `checkDatabaseForExistingTitle(title)` auf.
  2. **Sofort-Stopp ab 85 % Übereinstimmung**: Erreicht ein D1-Eintrag einen Ähnlichkeits-Score von $\ge 85\,\%$, bricht die Suche sofort ab. Der Eintrag erhält `tmdb_id`, `typeCode`, `cleanTitle`, `external_poster_url` und `preResolvedFromD1: true`.
  3. **Transparentes Feedback im Konsolen- & Splitter-Status**: Die Konsole und die Batch-Zusammenfassung weisen aus, wie viele Einträge des Chunks bereits lokal über `checkDatabaseForExistingTitle` ($\ge 85\,\%$) in D1 erkannt wurden (`0 API-Calls`).
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Dunkles Developer- & Streaming-Cockpit (`#090c14` / `#101016`) mit klaren Status-Indikatoren und tabellarischen Zählern (`tabular-nums`).
  - *Color Palette & Mood*: Smaragdgrün (`#10b981`) für D1-Cache-Treffer ($\ge 85\,\%$), Cyan (`#38bdf8`) für aktive Batch-Verarbeitung, Amber (`#f59e0b`) für Prüf-Kandidaten.
  - *Typography & Hierarchy*: Klare Sans-Serif-Hierarchie kombiniert mit Monospace-Metriken für Trefferquoten, Confidence-Prozentwerte und Subrequest-Zähler.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Zweistufige lokale D1-Prüfung (`checkDatabaseForExistingTitle`) mit 85%-Stop-Limit**
  - *Gewählter Ansatz*: `checkDatabaseForExistingTitle(title)` bereinigt Dateinamen/Roh-Titel von Release-Tags (`1080p`, `S01E02`, `GERMAN`, etc.), gleicht den Titel gegen die in D1/KV persistierten Katalog- und Cache-Einträge sowie den Worker-D1-Bestand ab und berechnet den Confidence-Score (0–100 %). Sobald ein Treffer $\ge 85\,\%$ erreicht, wird die Prüfung für diesen Titel sofort beendet (`85% stop-limit`) und das Ergebnis im Batch-Speicher hinterlegt.
  - *Warum*: Bei Serien mit vielen Episoden oder Filmen in mehreren Auflösungen wird derselbe Titel oft dutzende Male hintereinander importiert. Der sofortige Abbruch ab 85 % spart sowohl Datenbank-Vergleiche als auch 100 % der externen API-Aufrufe.
- **Entscheidung 2: Vorab-Injektion von `tmdb_id` statt Herausfiltern**
  - *Gewählter Ansatz*: Bekannte Titel werden nicht verworfen, sondern mit ihrer bestätigten `tmdb_id` und dem Medientyp an den Worker übergeben.
  - *Warum*: So werden neue Episoden (`S01E02`, `S01E03`) oder neue Qualitätsstufen (`2160p`, `1080p`) zuverlässig in den D1-Tabellen (`episode_files`, `movie_files`) und in der Ziel-Playlist verknüpft, ohne dass der Worker erneut bei TMDb oder den Fallback-APIs suchen muss.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                 JSON Backup Splitter Modal / Batch Dispatcher                │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ 1. checkDatabaseForExistingTitle(title, options)                       │  │
│  │    • Bereinigt Dateinamen & extrahiert Titel, Jahr & Serien-Indikator  │  │
│  │    • Prüft D1-Katalog, Titel-Resolution-Cache & Sandbox-D1-Bestand     │  │
│  │    • Berechnet Match-Confidence (Exakt / Token-Overlap / Jahres-Bonus) │  │
│  │    • 85%-Stop-Limit: Sofortiger Abbruch beim ersten Treffer >= 85 %    │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
│                                      │                                       │
│                   ┌──────────────────┴──────────────────┐                    │
│                   ▼                                     ▼                    │
│     [Treffer >= 85 % in D1]                [Kein Treffer < 85 % in D1]       │
│  • Überspringt Browser-OMDb-Fetch       • Optionaler Browser-OMDb-Fallback   │
│  • Setzt tmdb_id, typeCode, Poster      • Übergibt Roh-Eintrag an Worker     │
│  • Markiert preResolvedFromD1 = true    • Worker prüft D1 & 8-API-Kaskade    │
│                   │                                     │                    │
│                   └──────────────────┬──────────────────┘                    │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ 2. handleDispatchWorkerImportBatch -> POST /api/import-json            │  │
│  │    • Worker erkennt vorhandene tmdb_id -> 0 externe API-Subrequests    │  │
│  │    • Speichert Datei/Stream & Playlist-Verknüpfung direkt in D1        │  │
│  │    • Aktualisiert lokalen D1-Titel-Index für nachfolgende Chunks       │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State Mapping

- **Titel-Normalisierung & Confidence-Berechnung (`checkDatabaseForExistingTitle`)**:
  - Entfernt Dateiendungen (`.mp4`, `.mkv`), Episoden-Marker (`S01E01`, `Staffel 1`), Jahreszahlen und Release-/Qualitäts-Tags.
  - Vergleicht den normalisierten Suchtitel mit den D1-Einträgen (`movies`, `series`, `entity_cache` / `title_res_*`, gespeicherte Listen in `kvNamespace` sowie dem Worker-Endpunkt `/api/tma/d1-check-titles`).
  - Sobald während der Iteration ein Kandidat `confidence >= 85` erreicht, stoppt die Suche sofort (`break`) und gibt `{ matched: true, confidence, tmdbId, typeCode, title, year, posterUrl, source: 'D1' }` zurück.
- **Integration in `handleDispatchWorkerImportBatch`**:
  - Durchläuft vor dem `executeWorkerSandbox`-Aufruf alle `payload.entries`, führt `checkDatabaseForExistingTitle(entryTitle)` aus und reichert Treffer ($\ge 85\,\%$) direkt mit `tmdb_id`, `typeCode`, `isSeries` und `external_poster_url` an.
  - Nach jedem erfolgreichen Worker-Batch werden neu aufgelöste Titel sofort in den lokalen D1-Titel-Index aufgenommen, sodass schon der nächste Chunk im selben Durchlauf davon profitiert.
- **Integration in `enrichBatchEntriesWithOmdbFallback` & Splitter-Modal**:
  - Überspringt für jeden Eintrag, bei dem `checkDatabaseForExistingTitle(rawTitle)` bereits einen D1-Treffer mit $\ge 85\,\%$ liefert, den externen OMDb-HTTP-Request komplett und übernimmt stattdessen die D1-Metadaten.
