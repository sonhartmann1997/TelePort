# 5-Modul Pipeline-Upgrade, 900M-ID Abgleich-Konsole & Smart-Heilung

Dieses Upgrade erweitert die Import-, Parser-, TMDb-Scoring-, D1-UPSERT- und Diagnose-Pipeline um 5 präzise abgestimmte Module, ergänzt das manuelle 900M-ID Abgleich-Modal um Live-Kollisionsprüfung, Queue-Abarbeitung und 1-Klick-Migration auf echte TMDb-IDs und fügt 3 intelligente Komfort-Werkzeuge hinzu (selbstlernendes Alias-Gedächtnis, Mehrteiler-Lückenprüfung für CD1/CD2 und 1-Klick-Nachprüfung alter Konflikte).

## User Review & Critical Decisions

> [!IMPORTANT]
> Alle bestätigten Entscheidungen und deine 3 ausgewählten Zusatz-Ideen sind fest im Plan verankert (ohne AVI/DivX/Browser-Stream-Priorisierung in Modul 4):

- **Bestätigte Entscheidung 1 (900M-ID Abgleich-Modal & Komfort-Funktionen)**:
  - **Live-Vorschau der 900M-ID & D1-Kollisionsstatus** (`900M–944M` Film, `945M–989M` Serie).
  - **Automatische Erkennung vorhandener 900M-Serien** in D1, damit weitere Folgen derselben Serie sofort dieselbe ID erhalten.
  - **Queue-Modus** zum flüssigen Abarbeiten aller offenen `TMDB_NOT_FOUND`-Einträge nacheinander.
  - **1-Klick-Migration (`900M-ID → echte TMDb-ID`)** inklusive verlustfreiem Umzug aller Episoden, Dateien und Playlists.
- **Bestätigte Entscheidung 2 (5-Modul Pipeline-Erweiterung – ohne AVI/Browser-Stream-Logik)**:
  - **Modul 1 (Import-Loop & Variablen-Hygiene)**: Aufsteigende Sortierung nach `msg.id`, Session-Deduplizierung via `processedMsgIds`, lückenlose `rawText`-Extraktion in allen Pfaden, isolierter Variablen-Scope im Schleifenkörper und Gatekeeper-Filterung für Sprachlern-/Tutorial-Videos (`SKIPPED_JUNK`).
  - **Modul 2 (Parser, CD1/CD2-Pairing, Bonus, Editionen & Jahres-Cut-Off)**: Erkennung von `CD1`/`CD2` und führenden `01`/`02` vor `(YYYY)` **vor** der Serien-Weiche inkl. Nachbar-Pairing (`i - 1` / `i + 1`), Bonus-/Special-Guard (`season = 0` / `isBonus = true`), Editions-Extraktion (`editionLabel`), harter Cut-Off rechts neben der Jahreszahl (auch ohne Leerzeichen wie `2012SiFi`) sowie Anhebung des Titel-Limits auf **120 Zeichen** (mit `> 15 Wörter` Beschreibungs-Schutz).
  - **Modul 3 (TMDb Smart-Scoring & Fallbacks)**: Exakter Titel-Bonus (`+150 Punkte` bei ±1 Jahr) und Artikel-Schutz (`The`/`Der`/`Die`/`Das` erst im letzten Schritt entfernen), Römische-Zahlen-Retry bei Jahres-Konflikt (> 2 Jahre Abweichung), Dual-Source-Fallback (`titleFromText` ↔ `titleFromFileName`), Nachbar-Überlaufschutz bei eigenem Titel + Jahr sowie `/search/tv`-Miniserien-Fallback.
  - **Modul 4 (D1 `fileFingerprint`, `part_number`, Jahres-Sperre & `manual_override`)**: Zweistufiger `fileFingerprint` (`file_unique_id || file_id || size_duration_WxH`), sauberes Versions-Badge (`[editionLabel, resolutionLabel, sizeLabel].filter(Boolean).join(" • ")`), eigenes `part_number`-Feld, Jahres-Sperre beim Film-UPSERT (> 1 Jahr Abweichung blockiert Zusammenführung) und unüberschreibbarer Admin-Schreibschutz (`manual_override = 1`).
  - **Modul 5 (Diagnose-Logger)**: Fehler-Priorisierung im Export-Puffer (`OK`/`SKIPPED_DUPLICATE` verdrängen niemals echte Problemfälle), einheitlicher Status `"CONFLICT"` sowie strikte Trennung zwischen `parsedTitle` und `matchedTitle`.
- **Bestätigte Entscheidung 3 (Ausgewählte Zusatz-Ideen)**:
  1. **Selbstlernendes Alias-Gedächtnis bei manueller Korrektur**: Jede manuelle Admin-Zuweisung speichert das normalisierte Roh-Titel-/Dateinamen-Muster dauerhaft als gelernte Alias-Regel in D1 (`manual_override = 1`), sodass künftige Folgen oder Re-Uploads sofort ohne externe API-Abfrage aufgelöst werden.
  2. **Mehrteiler-Prüfung für fehlende `CD1`- oder `CD2`-Teile**: Automatische Erkennung unvollständiger Mehrteiler-Filme (z. B. `part_number = 2` vorhanden, aber `part_number = 1` fehlt, oder `CD 1` ohne `CD 2`) mit eigener Übersicht im Lücken-Tab.
  3. **1-Klick-Nachprüfung alter Konflikte mit neuer Pipeline**: Direkt-Button im Konflikt-/Diagnose-Tab, der bestehende `CONFLICT`- und `TMDB_NOT_FOUND`-Einträge aus früheren Durchläufen gesammelt durch die neue Modul-2/3-Pipeline (Jahres-Cut-Off, Roman-Retry, Dual-Source, Miniserien-Fallback) schickt und automatisch heilt.

---

## 1. Overview & Core Concept

- **Was das System leistet**: Große Telegram-Kanal-Exporte (`result.json`) werden streng chronologisch dedupliziert, Mehrteiler (`CD1`/`CD2`, `01 (1997)`), Sondereditionen (`Director's Cut`) und Bonus-Clips sauber getrennt, über mehrstufiges TMDb-Smart-Scoring aufgelöst und kollisionsfrei mit `fileFingerprint` in D1 gespeichert. Manuelle Korrekturen trainieren automatisch das D1-Alias-Gedächtnis, während unvollständige `CD1`/`CD2`-Mehrteiler und offene 900M-Titel übersichtlich verwaltet werden.
- **Zielgruppe / Einsatzkontext**: Administratoren der Telegram Mini App & des Cloudflare Workers zur vollautomatischen und kuratierten Katalogpflege.
- **Kernmehrwert**: Deutlich weniger Fehlzuordnungen bei Filmreihen und Zweiteilern, null falsche Duplikat-Verwerfungen bei JSON-Backups ohne `file_id`, dauerhaftes Lernen aus jeder Admin-Korrektur und schnelle Stapel-Heilung alter Konflikte.

---

## 2. User Experience & Visual Design

- **Zentrale User Flows**:
  1. **900M-ID Abgleich-Modal mit Live-Vorschau, Serien-Erkennung & Queue-Modus**:
     - Zeigt während der Eingabe live die deterministische 900M-ID (`900M–944M` Film, `945M–989M` Serie) und den D1-Kollisionsstatus.
     - Erkennt automatisch bereits in D1 vorhandene 900M-Serien mit gleichem Titel und schlägt deren ID per 1-Klick vor.
     - Im **Queue-Modus** werden alle offenen `TMDB_NOT_FOUND`-Einträge nacheinander im selben Dialog durchgeblättert (`Eintrag 1 von N`).
  2. **1-Klick-Migration (`900M-ID → echte TMDb-ID`)**:
     - Zieht alle Episoden, Videodateien und Playlist-Einträge einer synthetischen 900M-ID verlustfrei auf eine echte TMDb-ID um und setzt `manual_override = 1`.
  3. **1-Klick „Alt-Konflikte mit neuer Pipeline heilen“**:
     - Im Konflikt- und Diagnose-Tab prüft ein Button alle offenen `CONFLICT`- und `TMDB_NOT_FOUND`-Einträge mit der neuen Modul-2/3-Pipeline nach, aktualisiert geheilte Treffer direkt in D1 und zeigt eine Erfolgsbilanz (`X von Y Konflikten automatisch geheilt`).
  4. **Mehrteiler-Lücken-Anzeige (`CD1` / `CD2` Vollständigkeit)**:
     - Im Lücken-Finder werden neben fehlenden Serienfolgen auch unvollständige Mehrteiler-Filme (`CD 1 fehlt` oder `CD 2 fehlt`) hervorgehoben.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Kontrastreiches Dark-Slate Admin- & Katalog-Interface (`#101016` / `#161622`) mit klarer typografischer Hierarchie und ruhigen, unverschnörkelten Text-Metadaten (`Director's Cut • 1080p • 1.8 GB`).
  - *Color Palette & Semantik*: Smaragdgrün (`#10B981`) für verifizierte D1-Einträge und geheilte Konflikte, Amber (`#F59E0B`) für `"CONFLICT"`-Prüffälle und fehlende `CD1`/`CD2`-Teile, Violett/Blau (`#A855F7` / `#38BDF8`) für den 900M-Abgleich und Karmesinrot (`#EF4444`) für Fehler.
  - *Typography & Tabular Numerals*: Alle IDs, Message-IDs und Zähler nutzen `font-variant-numeric: tabular-nums` bzw. Monospace-Schrift.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Zweistufiger `fileFingerprint` ohne Format-Diskriminierung**
  - *Gewählter Ansatz*: `fileFingerprint = msg.file_unique_id || msg.file_id || "${msg.file_size || 0}_${msg.duration_seconds || 0}_${msg.width || 0}x${msg.height || 0}"`.
  - *Warum*: Verhindert den `null === null`-Duplikat-Bug bei JSON-Backups zuverlässig, ohne `.avi`- oder `.mp4`-Dateien unterschiedlich zu werten.
- **Entscheidung 2: Selbstlernendes Alias-Gedächtnis + `manual_override = 1`**
  - *Gewählter Ansatz*: Jede manuelle Zuweisung speichert sowohl die bereinigte Titel-Variante als auch den rohen Dateinamen-Stamm (ohne `SxxExx`/`CDx`/Jahr) mit `manual_override = 1` in D1 `entity_cache` sowie auf dem Film-/Serien-Datensatz.
  - *Warum*: Künftige Episoden derselben Serie oder erneute Backup-Läufe erkennen das gelernte Muster sofort in Stufe 0 (D1-First) und überschreiben niemals manuelle Admin-Entscheidungen.
- **Entscheidung 3: Harter Jahres-Cut-Off + 120-Zeichen-Titellimit mit 15-Wörter-Schutz**
  - *Gewählter Ansatz*: Alles rechts neben einer erkannten Jahreszahl `(1920..2029)` (inkl. `2012SiFi`) wird sofort abgeschnitten; einzeilige Titel dürfen bis zu 120 Zeichen lang sein, während Fließtext-Beschreibungen ab `> 15 Wörtern` erkannt werden.
  - *Warum*: Schützt lange deutsche Filmtitel (*Star Wars: Episode V – Das Imperium schlägt zurück*) vor dem 40-Zeichen-Abschneider und entfernt gleichzeitig angeklebte Genre-/Cast-Ketten hinter dem Jahr.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Pipeline Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ MODUL 1: Chronologischer Import-Loop & Gatekeeper                            │
│  • messages.sort((a,b) => Number(a.id) - Number(b.id))                       │
│  • processedMsgIds = new Set() (keine Mehrfachverarbeitung bei Resume)       │
│  • rawText-Extraktion (String & Array-Entities) + isolierter Loop-Scope      │
│  • Gatekeeper: Sprachlern-/Tutorial-Videos -> status: "SKIPPED_JUNK"         │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ MODUL 2: Parser, CD1/CD2-Pairing, Bonus-Schutz, Editionen & Jahres-Cut-Off   │
│  • Multi-Part vor Serien-Weiche: -CD1/-CD2 & "01 (1997)" -> movie + part     │
│  • Nachbar-Pairing (i-1 / i+1): Übernimmt tmdbId für Part 2 bei gleichem Name│
│  • Bonus/Special-Guard: season = 0 / isBonus = true (überschreibt nie S01E01)│
│  • Edition-Extractor -> editionLabel | Harter Jahres-Cut-Off (inkl. 2012SiFi)│
│  • Umlaut-Normalisierung + 120-Zeichen-Limit (Satz/Wort-Check > 15 Wörter)   │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ MODUL 3: Selbstlernender D1-Alias-Cache & TMDb Smart-Scoring                 │
│  • Stufe 0: D1-Alias-Gedächtnis (gelernte Admin-Muster -> 0 API-Requests)    │
│  • Exakter Titel + Jahr (±1) = +150 Punkte Bonus | Artikel erst zuletzt ab   │
│  • Römische-Zahlen-Retry (I..XIII) bei Jahres-Abweichung > 2 Jahre           │
│  • Dual-Source-Fallback: titleFromText <-> titleFromFileName                 │
│  • Kein Nachbar-Überlauf bei eigenem Titel + Jahr | /search/tv Fallback      │
└──────────────────┬───────────────────────────────────────┬───────────────────┘
                   │ Treffer gefunden                      │ Kein API-Treffer
                   ▼                                       ▼
┌─────────────────────────────────────────┐ ┌──────────────────────────────────┐
│ MODUL 4: D1 Smart-UPSERT & Mehrteiler   │ │ 900M-ID Abgleich-Modal & Heilung │
│  • fileFingerprint (Size_Dur_WxH)       │ │  • Live-Vorschau 900M-ID & Status│
│  • part_number + CD1/CD2-Lücken-Prüfung │ │  • Auto-Vorschlag 900M-Serien    │
│  • Jahres-Sperre (>1J) & manual_override│ │  • Queue-Modus & 1-Klick-Upgrade │
└──────────────────┬──────────────────────┘ │  • 1-Klick Konflikt-Auto-Heilung │
                   │                        └──────────────┬───────────────────┘
                   └───────────────────┬───────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ MODUL 5: Diagnose-Logger (ImportLogger)                                      │
│  • Problem-Priorität im Puffer (OK/SKIPPED_DUPLICATE verdrängen nie Fehler)  │
│  • Einheitlicher Status "CONFLICT" | parsedTitle vs. matchedTitle getrennt   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & Endpoints

- **D1-Tabellen (`movies`, `series`, `movie_files`, `episode_files`, `entity_cache`)**:
  - `movies` & `series`: `manual_override INTEGER DEFAULT 0` schützt manuell zugewiesene Titel vor dem Überschreiben durch spätere automatische Läufe.
  - `movie_files` & `episode_files`: `file_fingerprint TEXT`, `part_number INTEGER DEFAULT 1`, `edition_label TEXT` und `is_bonus INTEGER DEFAULT 0`.
  - `entity_cache`: Speichert bei jeder manuellen Admin-Korrektur zusätzlich das normalisierte Dateinamen-Stammmuster (`alias_learned_<normStem>`) mit `manualOverride: true`.
- **Neue & erweiterte Admin-Endpunkte**:
  - `/api/tma/admin/preview-manual-id`: Berechnet live die kollisionsfreie 900M-ID und prüft, ob bereits eine gleichnamige 900M-Serie oder ein 900M-Film in D1 existiert.
  - `/api/tma/admin/migrate-synthetic-id`: Migriert einen synthetischen 900M-Eintrag inkl. aller Episoden, Dateien und Playlists per 1-Klick auf eine echte TMDb-ID.
  - `/api/tma/admin/reheal-conflicts`: Führt die 1-Klick-Nachprüfung offener `CONFLICT`- und `TMDB_NOT_FOUND`-Einträge mit der neuen Modul-2/3-Pipeline aus und speichert geheilte Treffer direkt in D1.
  - Erweiterung von `computeSeriesGapsOverview`: Meldet neben fehlenden Serienfolgen/Staffeln auch `incompleteMultipartMovies` (Filme mit `CD 2` ohne `CD 1` oder `CD 1` mit Hinweis auf Mehrteiler ohne `CD 2`).
