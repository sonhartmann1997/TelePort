# Implementierungsplan: 2-Stufen-Film-Erkennung (`enrichVideoFromNeighborPost` + `pickBestTMDbMovie`) & `E.T.` Kurztitel-Regel

## Zielsetzung
1. **Stufe 1 – Nachbar-Post-Anreicherung (`+1`, `-1`, `+2`, `-2`) mit Basiswort-Schutz (`enrichVideoFromNeighborPost`)**:
   - Bei Videos mit Kurztiteln wie `Arielle 2023` steht das Poster samt vollständigem Filmtitel (`Disneys Arielle, die Meerjungfrau`) und der Handlungsbeschreibung im Telegram-Kanal oft im Post **direkt unter dem Video (`index + 1`)**, während direkt darüber (`index - 1`) noch der Text des vorherigen Films (`Tin & Tina 2023`) steht.
   - Der Parser prüft deshalb Nachbar-Posts in der Reihenfolge `[+1, -1, +2, -2]` (sofern der Nachbar kein eigenes Video ist):
     - Studio-Präfixe am Zeilenanfang (`Disneys`, `Disney's`, `Marvels`, `Marvel's`, `Pixars`, `Pixar's`) werden entfernt (`"Disneys Arielle, die Meerjungfrau"` $\rightarrow$ `"Arielle, die Meerjungfrau"`).
     - **Harter Sicherheits-Check (`baseWord`)**: Das erste Hauptwort des Video-Kurztitels (mind. 3 Zeichen, ohne Artikel/Studio-Präfix, z. B. `"arielle"`) **muss** in der ersten Zeile des Nachbar-Posts vorkommen. Dadurch werden fremde Nachbar-Posts wie `"Tin & Tina 2023"` (`-1`) sofort ausgeschlossen.
     - **Jahres-Abgleich**: Falls sowohl Video als auch Nachbar-Post eine Jahreszahl nennen, müssen diese übereinstimmen (`parsedVideo.year === neighborYear`).
     - **Übernahme**: Der angereicherte Langtitel (ohne angehängte Jahreszahl), das Jahr sowie der gesamte Beschreibungstext (`contextOverview = lines.slice(1).join(" ")`) werden am Eintrag gespeichert und an die TMDb-Suche übergeben.

2. **Stufe 2 – Intelligentes TMDb-Kandidaten-Scoring (`pickBestTMDbMovie`)**:
   - Statt bei `/search/movie` blind `results[0]` oder nur einen reinen Titel-/Jahres-Treffer zu nehmen, werden alle Kandidaten mit `pickBestTMDbMovie(results, parsedItem)` bewertet:
     1. **Jahres-Check**: Exaktes Jahr (`diff === 0`) gibt `+40` Punkte, `diff === 1` gibt `+15` Punkte, größere Abweichungen werden mit `-diff * 25` hart abgestraft.
     2. **Titel-Genauigkeit**: Exakter Match mit dem (angereicherten) Titel (`title` oder `original_title`) gibt `+50` Punkte, `startsWith` gibt `+30` Punkte, `includes` gibt `+15` Punkte.
     3. **Beschreibungs-Fingerabdruck (`contextOverview` vs. TMDb `overview`)**: Alle signifikanten Wörter (`length >= 5`, z. B. `"meerjungfrau"`, `"lieblingstochter"`, `"triton"`, `"halle"`, `"bailey"`) aus dem Telegram-Nachbar-Post werden mit `movie.overview` von TMDb abgeglichen. Jedes gemeinsame Wort bringt `+20` Punkte (bis zu `+100` Punkte).
     4. **Bekanntheits- / Blockbuster-Bonus (`vote_count`)**: Schützt zuverlässig vor billigen Mockbustern oder obskuren Doppelgängern aus demselben Jahr (`votes > 1000` $\rightarrow$ `+35`, `votes > 200` $\rightarrow$ `+20`, `votes > 50` $\rightarrow$ `+10`, `votes < 10` $\rightarrow$ `-15`).

3. **Gezielte Kurztitel-Erkennung für `E.T.` / `ET` (1982)**:
   - Ohne die bestehende Parsing-Logik zu verändern, wird eine gezielte Kurztitel- und Alias-Regel für `E.T.` (`E.T. - Der Außerirdische`, `E.T.`, `ET 1982`, `E.T. 1982`) eingebaut, die direkt auf `"E.T. – Der Außerirdische"` (1982, TMDb `#601`) auflöst und in `cleanMediaTitle` nicht an der 3-Zeichen-Mindestlänge scheitert.

---

## Geplante Änderungen im Detail

### 1. `/worker-modules/02-parser-ingester.js`
- **`enrichVideoFromNeighborPost(messages, currentIndex, parsedVideo)`**:
  - Implementierung der Nachbar-Post-Prüfung in der Reihenfolge `[1, -1, 2, -2]`.
  - Extrahiert `baseWord` (ohne führende Artikel `der|die|das|the|a|disneys|disney's`), prüft `firstLine.toLowerCase().includes(baseWord)` und die Jahreskompatibilität, entfernt Studio-Präfixe (`disney'?s|marvel'?s|pixar'?s`) und speichert `title`, `year` und `contextOverview`.
- **Gezielte `E.T.`-Kurztitel-Unterstützung**:
  - Ergänzung in `MOVIE_COLLECTION_ALIASES` / Kurztitel-Erkennung in `cleanMediaTitle` und `parseMediaFilename`, sodass Dateinamen wie `E.T. 1982.mp4`, `ET 1982.mp4`, `E.T. - Der Ausserirdische.mp4` oder `E.T..mkv` sauber als `"E.T. – Der Außerirdische"` (Jahr `1982`, TMDb `#601`) erkannt werden, während alle anderen 2-Buchstaben-Fragmente weiterhin streng gefiltert bleiben.

### 2. `/worker-modules/08c-tma-netflix-frontend.js` (Client-Backup-Parser)
- **`detectAndParseClientBackupJson` & `streamParseLargeClientBackupFile`**:
  - Integration von `enrichVideoFromNeighborPost` beim Parsen der Telegram-Nachrichtenliste (`messages`), damit bei Kurztiteln wie `Arielle 2023` direkt im Browser der Post darunter (`+1`) vor dem Post darüber (`-1`) geprüft wird.
  - Übergabe von `contextOverview` (sowie dem angereicherten `cleanTitle` und `year`) im Entry-Objekt an `/api/tma/admin/import-batch`.
  - Ergänzung der `E.T.`-Kurztitel-Regel im Client-Pre-Parser (`cleanClientMediaTitle`).

### 3. `/worker-modules/05-tmdb-telegraph.js` & `/worker-modules/07-webhook-callbacks.js` (Server-Parser & TMDb-Scoring)
- **`detectAndExtractTelegramBackupOrJson` (`/worker-modules/07-webhook-callbacks.js`)**:
  - Aufruf von `enrichVideoFromNeighborPost(tgMessages, idx, ...)` für jedes erkannte Video, sodass `cleanTitle`, `year` und `contextOverview` aus dem passenden Nachbar-Post (`+1` vor `-1`) angereichert werden.
  - Weitergabe von `parsed.contextOverview = rawEntry.contextOverview` in `resolveAndIngestMediaEntry`.
- **`pickBestTMDbMovie(results, parsedItem)` (`/worker-modules/05-tmdb-telegraph.js` & `/worker-modules/07-webhook-callbacks.js`)**:
  - Einbau der Scoring-Funktion `pickBestTMDbMovie` in die TMDb-Filmsuche (`findOnTMDbWithValidation`, `findOnTMDb` und `searchTmdbCandidatesForImport`).
  - Berücksichtigung von:
    - Jahres-Abstand (`+40` / `+15` / `-diff * 25`)
    - Titel-Genauigkeit (`+50` exakt / `+30` Präfix / `+15` Teilstring, inkl. Bereinigung von `"Disneys "`-Präfixen)
    - Beschreibungs-Fingerabdruck (`contextOverview`-Wörter $\ge 5$ Zeichen gegen `movie.overview`, bis zu `+100` Punkte)
    - Bekanntheits-Bonus (`vote_count > 1000` $\rightarrow$ `+35`, `> 200` $\rightarrow$ `+20`, `> 50` $\rightarrow$ `+10`, `< 10` $\rightarrow$ `-15`).

---

## Verifikation
- Kompilierung und statische Code-Prüfung mit `compile_applet` und `lint_applet`.
- Prüfung der Testfälle:
  - `Arielle 2023` mit `Tin & Tina 2023` in Post `-1` und `Disneys Arielle, die Meerjungfrau` + Beschreibungstext in Post `+1` $\rightarrow$ wählt garantiert den echten Disney-Kinofilm **Arielle, die Meerjungfrau (2023, TMDb #447277)** statt eines 2023er Mockbusters.
  - `E.T. 1982` / `ET 1982` / `E.T.` $\rightarrow$ wird zuverlässig als **E.T. – Der Außerirdische (1982, TMDb #601)** erkannt.
