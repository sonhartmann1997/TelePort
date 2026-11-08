# Kollisionsfreie ID-Architektur, Manuelle Titel-Bestätigung & D1/KV-Speicher-Optimierung

Dieses Update beseitigt jegliche ID-Überlappungen zwischen TMDb, Zusatz-APIs und manuell angelegten Titeln, sorgt dafür, dass Serien wie Filme vorrangig ihre echte TMDb-ID erhalten, ermöglicht das manuelle Bestätigen unbekannter Filme/Serien ohne TMDb-ID über einen eigenen Dialog und reduziert unnötige D1- und KV-Schreibzugriffe drastisch.

## User Review & Critical Decisions

> [!IMPORTANT]
> Alle Rückfragen aus Phase 1 wurden bestätigt und sind verbindlich in dieser Architektur verankert:

- **Automatische TMDb-Brücke + getrennte Original-IDs für Zusatz-APIs**: Serien und Filme nutzen vorrangig ihre offizielle TMDb-ID (`1 .. 99.999.999`). Findet OMDb, TVMaze oder Wikidata eine externe ID (`imdb_id`, `thetvdb_id`, `wikidata_id`), wird zuerst über TMDb `/3/find/` geprüft, ob ein offizieller TMDb-Eintrag existiert. Nur wenn kein TMDb-Eintrag existiert, wird der Titel automatisch mit seiner nativen Zusatz-API-ID in einem strikt getrennten 100-Millionen-Block (ohne Modulo-Kürzung) gespeichert.
- **Manueller Bestätigungs-Dialog für Titel ohne API-Treffer**: Filme und Serien, die weder auf TMDb noch in den Zusatz-APIs gefunden werden (oder manuell angelegt werden sollen), können direkt über einen Dialog mit **Titel, Erscheinungsjahr, Typ (Film/Serie inkl. Staffel/Episode) und optionalem Poster-Link** bestätigt werden. Sie erhalten eine kollisionsgeprüfte synthetische ID im exklusiven `900.000.000`-Bereich.
- **D1- & KV-Limit-Schonung**: Unveränderte Serien-Metadaten werden beim Episoden-Import nicht mehr bei jeder Folge erneut in `series` und `series_seasons` geschrieben (spart >80 % D1-Writes bei Serien), und unnötige KV-Reads/Writes bei `bot_vip` sowie unveränderten Ordner-/Session-Ständen werden per Dirty-Signatur gestoppt.

---

## 1. Overview & Core Concept

- **Was das System leistet**:
  1. **Überlappungsfreie ID-Räume ohne Modulo-Kollisionen**: Bisherige Modulo-Rechnungen (`% 290000` / `% 390000`) im engen `8.000.000`-Bereich führten dazu, dass sich Wikidata (`8.4M–8.69M`), Apple iTunes (`8.5M–8.9M`) und Wikipedia (`8.7M–8.99M`) gegenseitig überschreiben konnten. Durch disjunkte 100-Millionen-Bereiche pro Quelle bleibt jede externe ID 1:1 erhalten.
  2. **Echte TMDb-IDs für Serien & Filme**: Bevor eine Serie auf eine TVMaze- oder OMDb-ID ausweicht, löst eine TMDb-Find-Bridge (`imdb_id` / `tvdb_id` -> TMDb TV ID) die echte TMDb-Serien-ID auf.
  3. **Manuelle Bestätigung ohne TMDb-ID**: Unbekannte Eigenproduktionen, seltene Dokus oder regionale Titel können ohne TMDb-Zwang bestätigt werden; weitere Episoden derselben Serie erben automatisch dieselbe manuelle Serien-ID.
  4. **Maximale D1- & KV-Effizienz**: Schreibzugriffe erfolgen nur noch bei echten Datenänderungen (Dirty-Hash-Guard).

---

## 2. User Experience & Visual Design

- **Manueller Bestätigungs-Dialog (ohne TMDb-ID)**:
  - Im **Konflikt- & Review-Bereich** des Backup-Importers, im **Diagnose-Log** sowie in der **Film/Serien-CRUD-Verwaltung** erscheint neben der TMDb-Kandidaten-Suche der Button **✨ Ohne TMDb-ID manuell bestätigen**.
  - Ein aufgeräumtes Modal im dunklen Streaming-Design (`#12121a`, klare Typografie, 0 überflüssige Badges) öffnet sich mit vorausgefüllten Werten aus dem Dateinamen:
    - **Titel** (Textfeld, vorausgefüllt mit erkanntem `cleanTitle`)
    - **Erscheinungsjahr** (z. B. `2024` oder leer für `k.A.`)
    - **Medientyp-Umschalter** (`🎬 Film` / `📺 Serie` – bei Serie mit Feldern für **Staffel** und **Episode**)
    - **Optionaler Poster-/Cover-Link** (`https://...`) und **Optionale Genres / Kurzinfo**
  - Mit Klick auf **✅ Jetzt mit synthetischer ID speichern** wird der Eintrag sofort in D1 angelegt, aus der Konfliktliste als gelöst markiert und im Katalog sichtbar.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Disjunkte 100-Millionen-ID-Blöcke statt Modulo-Kompression**
  - *Gewählter Ansatz*:
    - `1 .. 99.999.999`: **Offizielle TMDb-ID** (Filme & Serien in getrennten Tabellen `movies` und `series`)
    - `100.000.000 .. 199.999.999`: **OMDb / IMDb** (`100_000_000 + numerische IMDb-ID`, z. B. `tt1234567` $\rightarrow$ `101234567`)
    - `200.000.000 .. 299.999.999`: **TVMaze** (`200_000_000 + tvmazeId`)
    - `300.000.000 .. 399.999.999`: **AniList** (`300_000_000 + anilistId`)
    - `400.000.000 .. 499.999.999`: **MyAnimeList / Jikan** (`400_000_000 + malId`)
    - `500.000.000 .. 599.999.999`: **Wikidata** (`500_000_000 + Q-Nummer`)
    - `600.000.000 .. 699.999.999`: **MediaWiki / Wikipedia** (`600_000_000 + pageid`)
    - `700.000.000 .. 899.999.999`: **Apple iTunes DE** (`700_000_000 + track/collectionId`)
    - `900.000.000 .. 999.999.999`: **Manuell bestätigte Titel ohne TMDb-ID** (deterministischer Hash aus `typeCode + normalisierter Titel + Jahr` im `900M`-Raum + aktive D1-Kollisionsprüfung mit Linear-Probing, falls ein Hash jemals durch einen anderen Titel belegt sein sollte).
  - *Warum*: Keine zwei APIs können jemals dieselbe ID erzeugen, und innerhalb einer API entfällt die Modulo-Kollision (`% 290000`). Bestehende Fallback-IDs (`>= 8.000.000`) bleiben voll abwärtskompatibel.

- **Entscheidung 2: D1 Write-Deduplizierung bei Serien-Episoden & KV-Dirty-Guard**
  - *Gewählter Ansatz*: Beim Import von 20 Folgen einer Serie wurde bisher 20-mal `saveSeriesToD1` (inkl. Schleife über alle Staffeln in `series_seasons`) ausgeführt. Ein In-Memory-Signatur-Check (`d1_series_sig_${id}`) überspringt redundante Schreibvorgänge auf `series` und `series_seasons`, solange sich die Serien-Stammdaten nicht geändert haben; es wird nur die neue Episode in `episode_files` geschrieben.
  - *Warum*: Senkt die D1-Row-Writes beim Serien-Import um über 80 % und hält die Worker-Latenz dauerhaft niedrig.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     Eingehende Datei / Manuelle Eingabe                    │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 1. TMDb-Suche & Externe-ID-Brücke (/3/find/{imdb_id | tvdb_id})            │
│    • Liefert für Filme UND Serien vorrangig die echte TMDb-ID (1..99M)     │
└──────────────────┬──────────────────────────────────────┬──────────────────┘
                   │ Gefunden auf TMDb                    │ Nicht auf TMDb
                   ▼                                      ▼
┌─────────────────────────────────────┐ ┌────────────────────────────────────┐
│ Echte TMDb-ID (1 .. 99.999.999)     │ │ 2. Zusatz-API-Kaskade              │
│ • Filme -> Tabelle `movies`         │ │ • OMDb     : 100M + IMDb-Nummer    │
│ • Serien -> Tabelle `series`        │ │ • TVMaze   : 200M + TVMaze-ID      │
└──────────────────┬──────────────────┘ │ • AniList  : 300M + AniList-ID     │
                   │                    │ • MAL/Jikan: 400M + MAL-ID         │
                   │                    │ • Wikidata : 500M + Q-ID           │
                   │                    │ • Wikipedia: 600M + Page-ID        │
                   │                    │ • iTunes   : 700M + Collection-ID  │
                   │                    └────────┬──────────────────┬────────┘
                   │                             │ Treffer          │ Kein Treffer
                   │                             │                  ▼
                   │                             │ ┌─────────────────────────┐
                   │                             │ │ 3. Manuelle Bestätigung │
                   │                             │ │ • Dialog: Titel, Jahr,  │
                   │                             │ │   Typ (m/s), Poster-URL │
                   │                             │ │ • ID: 900M + Hash +     │
                   │                             │ │   D1-Kollisionsprüfung  │
                   │                             │ └────────┬────────────────┘
                   ▼                             ▼          ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 4. D1 & KV Persistence Layer (Optimiert)                                   │
│    • D1 Signature-Guard verhindert doppelte `series`/`movies`-Writes       │
│    • `entity_cache` merkt sich auch manuelle 900M-Serien für Folge-Eps     │
│    • KV Dirty-Check verhindert redundante `u_bundle` & `bot_vip` Writes    │
└────────────────────────────────────────────────────────────────────────────┘
```

### Interaktive Abläufe & State-Mapping
1. **Automatische TMDb-Brücke für Serien (`fetchTvMazeSeriesFallback` / `fetchOmdbFallback`)**:
   - Liefert TVMaze `show.externals.thetvdb` oder `show.externals.imdb` (bzw. OMDb `data.imdbID`), prüft `resolveExternalIdToTmdb(env, externalId, source, typeCode)` per `/3/find/`, ob TMDb die Serie unter einer offiziellen TMDb-ID führt, und gibt direkt die echten TMDb-Stammdaten zurück.
2. **Kollisionsfreie synthetische ID-Vergabe (`allocateCollisionFreeManualSyntheticId`)**:
   - Berechnet aus `normalizeCompareString(title) + "_" + year + "_" + typeCode` eine Start-ID im Bereich `900.000.000 .. 989.999.999`.
   - Prüft in D1 (`movies` bzw. `series`), ob diese ID bereits existiert:
     - Ist sie frei $\rightarrow$ sofort verwenden.
     - Gehört sie bereits exakt zu demselben normalisierten Titel $\rightarrow$ wiederverwenden (damit z. B. Folge 2 bis 10 derselben manuellen Serie in derselben Serie landen).
     - Gehört sie zu einem anderen Titel $\rightarrow$ inkrementiert (`candidateId + 1`), bis ein freier Slot gefunden ist.
3. **Manueller Bestätigungs-Dialog im Admin-Panel**:
   - Neuer Button `✨ Manuell ohne TMDb-ID` bei jedem Konflikt-/Unmatched-Eintrag sowie im CRUD-Tab.
   - Öffnet das Modal `openManualNoTmdbConfirmModalClient(indexOrContext)` mit Eingabefeldern für Titel, Jahr, Typ (`Film`/`Serie`), Staffel/Episode (bei Serien) und Poster-URL.
   - Sendet den Request an `/api/tma/admin/remap-import-item` mit `confirmManualWithoutTmdb: true` und aktualisiert die UI-Liste sowie den D1-Auflösungs-Cache sofort.
