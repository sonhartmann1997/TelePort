# Episoden-UPSERT, Dateinamen-Priorität, Prüfgründe & Schutz vor leeren VIP-Covers

Dieses Update schließt die 34 fehlenden Serienfolgen durch ein echtes D1-Episoden-UPSERT (inkl. Multi-Qualitäts-Unterstützung), gibt dem Dateinamen Vorrang bei Caption-Tippfehlern (`S01E13.mp4` statt `S01E3`), blendet leere Cover ohne gültige Videodatei (`file_id`) konsequent aus und zeigt im Tab **„🛠️ Prüfen & Korrigieren“** zu jedem Eintrag den exakten Prüfgrund (`reason`) prominent an.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Bestätigte Architekturentscheidungen aus der Rücksprache:**
> - **Umgang mit leeren Covern ohne gültige Videodatei (`file_id`)**: Für VIP-Streams werden Einträge ohne echte Telegram-Videodatei (`telegram_file_id`) automatisch aus Katalog, Entdecken-Ansicht und VIP-Playlisten ausgeblendet sowie verwaiste DB-Einträge bereinigt.
> - **Episoden-UPSERT & Multi-Qualität**: Existiert ein Episoden-Slot bereits, wird `SKIPPED_DUPLICATE` **nur noch dann** ausgelöst, wenn sowohl `message_id` als auch `file_id` identisch sind. Leere Slots werden per UPSERT gefüllt, abweichende Dateien derselben Qualitätsstufe aktualisiert und unterschiedliche Qualitätsstufen (`720p`, `1080p`, `4K`, verschiedene Fassungen) bleiben weiterhin nebeneinander auswählbar.

---

## 1. Overview & Core Concept

- **Was wird gelöst**:
  1. **Prüfgrund (`reason`) im Tab „🛠️ Prüfen & Korrigieren“**: Jede Prüfkarte zeigt sofort in einer hervorgehobenen Diagnose-Zeile an, *warum* der Eintrag zur Prüfung markiert wurde (z. B. *„Jahres-Konflikt: Datei nennt 1954, TMDb-Treffer ist 2005“*, *„Staffel-Überlauf: Datei verlangt Staffel 4, TMDb-Treffer hat nur 1 Staffel“*, *„Niedrige Konfidenz (68% Match)“* oder *„Kein TMDb-Treffer für Suchtitel“*).
  2. **Keine leeren VIP-Stream-Cover mehr**: Serien, für die lediglich TMDb-Staffel-Metadaten in `series_episodes` existieren, aber keine einzige echte Videodatei in `episode_files` vorliegt, erhielten bisher fälschlicherweise ein VIP-Qualitäts-Badge und erschienen als leere Cover. Zudem wurden Filme ohne `fileId` beim Import in D1 angelegt. Beides wird unterbunden und bereinigt.
  3. **Smartes Episoden-UPSERT statt falschem `SKIPPED_DUPLICATE`**: Bisher wurden Episoden übersprungen, sobald eine Signatur ohne `file_id`/`message_id` (oder mit Dateigröße `0`) im Set lag. Künftig prüft die Speicherschleife exakt auf `(telegram_file_id, message_id)` und führt bei leeren Slots oder aktualisierten Dateien ein D1-UPSERT aus, während verschiedene Qualitäten (`720p`, `1080p`, `4K`) als auswählbare Streams erhalten bleiben.
  4. **Dateiname schlägt Caption bei Episoden-Widersprüchen (`Queen of the South S01E13.mp4` vs. `S01E3`)**: Hat der Dateiname ein eindeutiges `SxxExx`- oder `Episode X Staffel Y`-Schema, gewinnt bei Abweichungen zur Caption immer die Episoden-/Staffelnummer aus dem Dateinamen. Zusätzlich werden alle `msgId`-Werte im Logger strikt als `Number` normalisiert.

---

## 2. User Experience & Visual Design

- **Diagnose-Banner in jeder Prüfkarte (`🛠️ Prüfen & Korrigieren`)**:
  - Direkt unterhalb der Kopfzeile jeder Karte im Prüf-Tab wird eine klare, farbcodierte Begründungs-Box (`🔎 Warum prüfen? / Grund:`) eingeblendet:
    - **Rot (`#f87171` / `rgba(239,68,68,0.12)`)** bei fehlendem TMDb-Treffer (`TMDB_NOT_FOUND`).
    - **Amber (`#fbbf24` / `rgba(245,158,11,0.14)`)** bei Kontext-, Jahres- oder Staffel-Konflikten (`CONFLICT_?`, z. B. Abweichung > 2 Jahre oder Staffel-Überlauf) sowie bei niedriger Match-Konfidenz (`< 74 %`).
- **Sauberer VIP-Katalog ohne Geister-Cover**:
  - Im VIP-Stream-Modus und in der Bot-VIP-Playlist werden ausschließlich Filme und Serien gerendert, die mindestens eine valide Videodatei (`scoreTelegramFileIdValidity > 0`) in `movie_files` bzw. `episode_files` besitzen.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Exakter Duplikat-Vergleich über `file_id` + `message_id` statt Metadaten-Schätzung**
  - *Gewählter Ansatz*: Ein Eintrag gilt nur dann als `SKIPPED_DUPLICATE`, wenn in D1 für dieselbe Episode bzw. denselben Film bereits exakt dieselbe `telegram_file_id` **und** dieselbe `message_id` gespeichert ist.
  - *Warum*: In Telegram-JSON-Exporten fehlen oft exakte Byte-Größen (`file_size = 0`). Ein reiner Vergleich auf `quality | codec | size:0` führte dazu, dass Folge 4–6 oder Re-Uploads als vermeintliches Duplikat verworfen wurden.
- **Entscheidung 2: Dateinamen-Priorität bei `SxxExx`-Abweichungen**
  - *Gewählter Ansatz*: Wenn sowohl Dateiname (`fileSeParts`) als auch Caption (`textSeParts` / `multiLineSeHit`) eine Episodennummer liefern und diese voneinander abweichen (insbesondere wenn der Dateiname zweistellig wie `E13` ist und die Caption `E3` lautet), wird zwingend `fileSeParts` für `season`, `episode` und `episodeEnd` verwendet.
  - *Warum*: Dateinamen stammen automatisiert aus der Release-/Encoding-Pipeline, während Telegram-Captions häufig händisch getippt werden.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   1. PARSER & KONTEXT-EXTRAKTION                           │
│  • Dateiname ("Queen of the South S01E13.mp4") vs. Caption ("S01E3")       │
│  • fileSeParts hat Vorrang vor textSeParts/multiLineSeHit bei Abweichung   │
│  • msgId wird überall strikt als Number(msg.id || msg.message_id) geführt  │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│             2. D1 EPISODEN- & FILM-UPSERT + MULTI-QUALITÄT                 │
│  • Prüfe vorhandene D1-Streams für (series_id, season, episode):           │
│    ├─ Identische file_id UND message_id vorhanden? -> SKIPPED_DUPLICATE    │
│    ├─ Leerer Slot (file_id leer/synthetisch) oder Update derselben Quali?  │
│    │  -> UPSERT / UPDATE (file_id, message_id, raw_filename, quality, size)│
│    └─ Andere Qualitätsstufe (z. B. 720p + 1080p + 4K)?                     │
│       -> Als zusätzliche auswählbare Qualitätsstufe speichern (MERGE)      │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│        3. GEISTER-COVER-FILTER & PRÜFGRUND-ANZEIGE IM ADMIN-UI             │
│  • attachVipQualitiesToMediaList prüft für VIP-Status NUR echte            │
│    episode_files & movie_files (keine leeren series_episodes-Metadaten!)   │
│  • saveMovieToD1 / saveSeriesToD1 nur bei gültiger Videodatei              │
│  • Prüfen-Tab rendert explizite Begründungs-Box (errorReason / reason)     │
└────────────────────────────────────────────────────────────────────────────┘
```

### Geplante Detail-Anpassungen:
1. **Dateiname vor Caption & `Number(msgId)` (`02-parser-ingester.js`, `08b-tma-netflix-frontend.js`, `08c-tma-netflix-frontend.js`)**:
   - In `parseTelegramMessage` / `parseMediaFilename`: Wenn `fileSeParts` vorhanden ist und `textSeParts` (oder `multiLineSeHit`) eine abweichende Episoden- oder Staffelnummer liefert, überschreibt `fileSeParts` immer die Episoden- und Staffelnummer der Caption (`Queen of the South S01E13.mp4` -> `S01E13`).
   - Alle `msgId`-Felder in Parser, Batch-Ingester und Import-Logger werden einheitlich mit `Number(rawMsgId) || 0` normalisiert.
2. **Episoden- & Film-UPSERT statt `SKIPPED_DUPLICATE` (`04-d1-database.js`, `07-webhook-callbacks.js`)**:
   - In `resolveAndIngestMediaEntry` (`07-webhook-callbacks.js`) und `saveEpisodeFileToD1` / `saveMovieFileToD1` (`04-d1-database.js`):
     - Vergleiche eingehende `(normalizedFid, incomingMsgId)` mit den vorhandenen D1-Einträgen der Episode.
     - **Nur wenn ein D1-Eintrag exakt dieselbe `telegram_file_id` UND `message_id` besitzt**, wird `ingestStatus = "duplicate"` (`SKIPPED_DUPLICATE`) gemeldet.
     - Ist der vorhandene Slot leer (`telegram_file_id` leer oder Platzhalter `vip_playlist_*` / `tg_export_0_*`) oder kommt eine aktualisierte Datei derselben Qualitätsstufe (`quality` + `version_label`), führt D1 ein `UPSERT / UPDATE` aus (`ingestStatus = "updated"` bzw. `"added"`).
     - Kommt eine Datei mit einer anderen Auflösung/Qualität (`720p` vs. `1080p` vs. `4K`), bleibt sie als zusätzliche Qualitätsstufe in `episode_files` erhalten (`ingestStatus = "merged_quality"`).
3. **Schutz vor leeren Covern ohne VIP-Streams (`04-d1-database.js`, `03-telegram-kv-engine.js`, `07-webhook-callbacks.js`)**:
   - In `attachVipQualitiesToMediaList` (`04-d1-database.js`): Entferne den Fallback auf `series_episodes` (reine TMDb-Episoden-Metadaten ohne Video!), sodass `bestSeriesMap` und `vipQuality` ausschließlich aus echten Einträgen in `episode_files` (mit gültiger `telegram_file_id` und `NOT LIKE 'vip_playlist_%'`) gespeist werden.
   - In `resolveAndIngestMediaEntry` (`07-webhook-callbacks.js`): Speichere Filme (`saveMovieToD1`) und Serien (`saveSeriesToD1`) beim Kanal-/Backup-Import nur dann in D1 und in der VIP-Playlist, wenn tatsächlich eine gültige Videodatei (`hasValidVideoFile`) verknüpft ist, und bereinige verwaiste Einträge ohne `movie_files` / `episode_files` automatisch in `cleanupEmptySeriesInD1AndMemory`.
4. **Anzeige des Prüfgrunds (`reason` / `errorReason`) im Tab „🛠️ Prüfen & Korrigieren“ (`07-webhook-callbacks.js`, `08c-tma-netflix-frontend.js`)**:
   - Generiere für jeden unsicheren oder fehlerhaften Eintrag (`isUncertain`, `contextError`, `unmatched`) einen klaren, sprechenden `errorReason`-Text (z. B. Jahres-Abweichung, Staffel-Konflikt, niedrige Titel-Übereinstimmung mit Prozentwert oder Grund des Nicht-Findens).
   - Zeige diesen Grund prominent als Diagnose-Banner in jeder Karte von `renderSingleBackupReviewCardHtml` sowie in der eingeklappten Übersicht an.
