# Intelligente Serien-Weiche („Kein Film → Serie“) & D1-Serien-Heilung

Dieses Update behebt die fehlerhafte Zuordnung nummerierter Serienfolgen (`Black Box 1`, `Spuk im Hochhaus 1..7`, `Spuk unterm Riesenrad 1..7`, `Pippi Langstrumpf 1..21`), verhindert `0% CONFLICT_?`-Abbrüche bei Cloudflare-Subrequest-Pausen (`Squid Game S01E01/E02`, `Axel! will's wissen S01E01/E02`) und führt bestehende doppelte oder posterlose Serien-Karten (`Generation Kill`, `Black Box`, `Spuk von draußen`, `Zur See`, `Axel! will's wissen`) automatisch in der D1-Datenbank zusammen.

## User Review & Critical Decisions

> [!IMPORTANT]
> Alle Architekturentscheidungen wurden gemäß deinen Vorgaben festgelegt:

- **Confirmed Decision 1 (Automatischer Serien-Fallback für Nummerntitel)**: Jeder Titel mit Endziffer (`Black Box 1`, `Spuk im Hochhaus 1`) oder Mittelziffer + Folgentitel (`Pippi Langstrumpf 1 Pippi zieht in die Villa Kunterbunt`), der keinen sicheren TMDb-Filmtreffer (`Confidence >= 78%`) erzielt und kein gesperrtes Film-Franchise mit Jahreszahl ist, wird automatisch in `Serientitel` + `Staffel 1, Episode N` zerlegt und über die TMDb-TV-API (inkl. Fallbacks) aufgelöst.
- **Confirmed Decision 2 (D1-Serien-Zusammenführung & Poster-Nachladung)**: Bereits importierte Serien mit Duplikaten (`Generation Kill`), synthetischen Fallback-IDs (`8xxxxxx`/`9xxxxxx`) oder fehlenden Postern (`Spuk von draußen`, `Axel! will's wissen`, `Zur See`, `Black Box`) werden direkt in der D1-Datenbank zusammengeführt und mit offiziellen TMDb-Serien-IDs sowie Postern aktualisiert.

---

## 1. Overview & Core Concept

- **Was das Update leistet**:
  1. **„Kein Film → Serie“-Erkennungsweiche (`@ANCHOR: PARSER_SWITCH` & `@ANCHOR: TMDB_FETCH`)**: Wenn ein Dateiname oder Backup-Eintrag wie `Black Box 1` zunächst keinen eindeutigen Film auf TMDb findet, erkennt der Worker zwingend, dass die `1` für `Episode 1` einer Serie steht, bereinigt den Suchtitel auf `Black Box` und ordnet die Datei sauber `Black Box – S01E01` zu.
  2. **Erhalt des bereinigten Serientitels zwischen Client & Server**: Wenn der Client-Parser oder Pre-Context bereits `isSeries: true`, `episode: N` und den bereinigten Serientitel (`Spuk im Hochhaus` statt `Spuk im Hochhaus 1`) ermittelt hat, überschreibt der Server-Parser diesen Titel nicht mehr mit dem rohen Dateinamen.
  3. **Verlustfreie Subrequest-Pause ohne `0% CONFLICT_?`**: Das Cloudflare-Subrequest-Budget wird bei jedem HTTP-Request sauber zurückgesetzt (`resetSubrequestBudget()`), und Batch-Importe pausieren vor dem 40-Subrequest-Limit, ohne das laufende Episoden-Paar (`S01E01/E02`) als `0%`-Konflikt abzubrechen.
  4. **Automatische D1-Serien-Heilung & Deduplizierung (`@ANCHOR: D1_MOVIES`)**: Doppelte Serien-Karten (gleicher Titel unter verschiedenen IDs wie `Generation Kill`) werden samt ihrer `episode_files` zusammengeführt; fehlende Poster und echte TMDb-TV-Metadaten werden automatisch nachgeladen.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  - **Serien-Tab in der Netflix-TMA**: Beim Öffnen des Reiters `Serien` (`Trending • Nur VIP-Streams`) führt das Backend automatisch eine schnelle D1-Konsolidierung durch: Doppelte Karten (`Generation Kill`) verschwinden sofort, alle Episoden sind unter einer einzigen Serien-Karte vereint, und fehlende Poster (`Spuk von draußen`, `Axel! will's wissen`, `Zur See`, `Black Box`) werden über TMDb/TVMaze/OMDb nachgeladen.
  - **JSON-Backup-Import**: Nummerierte Serien ohne `S01E01`-Präfix (`Black Box 1..6`, `Spuk im Hochhaus 1..7`, `Spuk unterm Riesenrad 1..7`, `Pippi Langstrumpf 1..21`) laufen ohne `CONFLICT_?` direkt als `OK` mit sauberem TMDb-Serientitel und Episodennummer durch.
- **Visual Identity & Theme**:
  - Unverändertes Netflix-Dark-Design (`#141414`, `#E50914` Akzent) mit lückenlosen Poster-Karten, korrekten Erscheinungsjahren und Bewertungs-Badges.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Zweistufige Film-vor-Serie-Auflösung für Nummerntitel (`Titel N` & `Titel N Episodentitel`)**
  - *Chosen Approach*:
    - Hat ein Titel das Muster `<Basis> <1..99>` (z. B. `Black Box 1`, `Spuk im Hochhaus 1`) oder `<Basis> <1..99> <Folgentitel>` (z. B. `Pippi Langstrumpf 1 Pippi zieht in die Villa Kunterbunt`), wird geprüft, ob für den vollen Namen ein hochkonfidenter Film-Treffer (`>= 78%`, exakt passender Titel/Jahr) existiert.
    - Falls **kein** solcher Film-Treffer existiert (oder der Eintrag bereits durch Nachbarfolgen `2, 3...` als Serie markiert ist), wird zwingend der Basis-Titel (`Black Box`, `Spuk im Hochhaus`, `Pippi Langstrumpf`) als **TV-Serie (`typeCode = "s"`, `season = 1`, `episode = N`)** gesucht und sämtliche Serien-Kandidaten erhalten den Serien-Confidence-Bonus.
  - *Why*: Echte Film-Fortsetzungen (`Iron Man 3 (2013)`, `Saw II`) erzielen auf TMDb sofort `> 85%` Film-Confidence oder stehen auf der Franchise-Blockliste; Serien wie `Black Box 1` oder `Spuk im Hochhaus 1` haben keinen Film-Treffer und werden so zu 100 % treffsicher als Serie `S01E01` erkannt.

- **Decision 2: Universelle TMDb-Authentifizierung (v3 `api_key` & v4 `Bearer`) + Subrequest-Budget-Reset pro Request**
  - *Chosen Approach*:
    - `resetSubrequestBudget()` wird zu Beginn jedes API-/TMA-Requests aufgerufen, damit ein Cloudflare-Worker-Isolate nicht nach mehreren API-Aufrufen dauerhaft bei `currentInvocationSubrequests >= 42` blockiert.
    - Ein zentraler Helper unterstützt automatisch sowohl TMDb v4 JWTs (`eyJ...` per `Authorization: Bearer`) als auch 32-stellige TMDb v3 Hex-Keys (`?api_key=...`), egal in welcher Secret-Variable (`TMDB_BEARER_TOKEN` oder `TMDB_API_KEY`) sie liegen.
    - Vor jedem Paar im Batch-Import wird geprüft, ob mindestens 12 Subrequests im aktuellen Request-Budget frei sind; falls während eines Paares das Limit erreicht wird, wird das Paar nicht als `0% CONFLICT_?` gespeichert, sondern exakt ab diesem Index per `SUBREQUEST_PAUSE` im nächsten Batch wiederholt.

- **Decision 3: Automatische D1-Serien-Deduplizierung & Poster-Heilung**
  - *Chosen Approach*:
    - Serien in D1 mit identischem normalisiertem Titel (z. B. zwei Einträge für `Generation Kill` mit verschiedenen IDs) werden automatisch auf die primäre TMDb-ID (mit Poster und `< 8000000` bevorzugt) zusammengeführt (`UPDATE episode_files SET series_id = ...`, `DELETE FROM series WHERE tmdb_id = ...`).
    - Falls `Black Box (2014)` fälschlicherweise mit Film-Metadaten oder ohne Serien-Poster in `series` lag, oder Serien wie `Spuk von draußen`, `Axel! will's wissen` und `Zur See` unter einer Fallback-ID (`8xxxxxx`/`9xxxxxx`) ohne Poster gespeichert wurden, löst die Heilungs-Routine die offizielle TMDb-TV-ID samt Poster auf und aktualisiert die verknüpften Episoden in D1.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   Eingehender Eintrag (Bot / JSON-Import)                  │
│   "Black Box 1" | "Spuk im Hochhaus 1" | "Pippi Langstrumpf 1 Pippi..."    │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 1. Parser & Pre-Context (@ANCHOR: PARSER_SWITCH)                           │
│ - Bewahrt bereits vom Client erkannte cleanTitle ("Spuk im Hochhaus")      │
│ - Erkennt Mittelziffer + Folgentitel ("Pippi Langstrumpf 1 <Folgentitel>") │
│ - Erkennt Endziffer ("Black Box 1" -> baseTitle: "Black Box", ep: 1)       │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 2. TMDb Kandidaten-Weiche (@ANCHOR: TMDB_FETCH)                            │
│ - Prüft: Gibt es einen sicheren Film-Treffer (>= 78%) für "Black Box 1"?   │
│ - NEIN -> Zwingender Serien-Fallback (Stufe 5 / 5B):                       │
│   Suche "/search/tv?query=Black Box" -> Treffer: Serie S01E01              │
│ - Bei Subrequest-Limit: Sauberer Rollback auf SUBREQUEST_PAUSE statt 0%    │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 3. D1 Serien-Konsolidierung & Poster-Heilung (@ANCHOR: D1_MOVIES)          │
│ - Führt doppelte Serien-Zeilen ("Generation Kill") in D1 zusammen          │
│ - Migriert synthetische IDs (8xxxxxx/9xxxxxx) auf echte TMDb-TV-IDs        │
│ - Lädt fehlende Serien-Poster (DE -> EN -> Original -> TVMaze) nach        │
└────────────────────────────────────────────────────────────────────────────┘
```
