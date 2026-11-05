# Detailansicht-Optimierung (CD 1–N Release-Box) & Korrektur der Serien-/Film-Parser-Logik

Dieser erweiterte Plan kombiniert das bereits bestätigte **Redesign der Detailansicht für mehrteilige Filme (`CD 1` bis `CD N`)** mit der vollständigen **Behebung der Serien-/Film-Erkennungsfehler**, die auf deinen Screenshots (`Deep Blue Sea 3` als `Deep Blue S01E03`) und im 1.200-Einträge-Import-Log sichtbar sind.

## User Review & Bestätigte Entscheidungen

> [!IMPORTANT]
> Alle Entscheidungen aus der vorherigen Runde bleiben vollständig erhalten und werden um die exakten Parser-Fixes aus deiner Log-Analyse ergänzt:

- **Bestätigte Entscheidung 1 (Einheitliche `CD 1..N` Benennung & Sortierung)**: Technische Split-Bezeichnungen (`SPLIT1`–`SPLIT5`, `PART1`, `CD01`, `DISC1`) werden einheitlich als **`CD 1`, `CD 2`, `CD 3` ...** dargestellt und strikt aufsteigend nach Teil-Nummer sortiert (`CD 1` → `CD 2` → `CD 3` → `CD 4` → `CD 5`, statt wie bisher nach Dateigröße).
- **Bestätigte Entscheidung 2 (Kompakte Release-Box für Mehrteiler)**: Mehrteilige Filme eines Releases werden in **einer gemeinsamen Release-Box** mit kompakten **`CD 1` bis `CD 5` Buttons nebeneinander** gebündelt.
- **Bestätigte Entscheidung 3 (Technische Badges nur für Admins im Edit-Menü)**: `🔗 Quellgruppe (Auto-Copy)` und doppelte Sprach-/Split-Pills (`🏷️ DE · SPLIT3`) verschwinden aus der Stream-Zeile und sind für Admins im `✏️` Bearbeitungs-Modal einsehbar.
- **Neu aus deinen Screenshots & Logs (Serien-/Film-Logik & Titel-Parser)**: Behebung aller 7 Fehlklassifizierungen im Server- und Client-Parser (`Deep Blue Sea 3`, `Size: ... MB` → `Size 12`, `+18` → `18 어게인`, `Mad Max 4 Fury Road` / `Sector 4`, `Episode X Staffel Y Little Britain USA`, `Geisterjäger`-Umlaut-Bug, `Creed |||` sowie Trailer-Filterung).

---

## 1. Ursache & Lösung der 7 Fehler aus deinen Screenshots & Logs

### Fehler 1: `Deep Blue Sea 3 (2020)-001.mkv` .. `-005.mkv` wurde zu Serie `Deep Blue (2015)` → `S01E03 – Folge 3`
- **Ursache**: Beim Bereinigen von `Deep Blue Sea 3 (2020)-001.mkv` wurden zuerst `(2020)` und `-001` entfernt. Übrig blieb `"Deep Blue Sea 3"`. Anschließend griff der Fallback-Regex `tailEpMatch` (für Serien wie `"Black Box 1"`), interpretierte die `3` am Ende als **Episode 3** einer Serie `"Deep Blue Sea"` und suchte bei TMDb nur noch nach TV-Serien (`search/tv`) – woraufhin TMDb die Football-Doku-Serie **`Deep Blue (2015)`** zuordnete.
- **Lösung**:
  1. **Split-File-Sperre**: Dateien mit Video-Split-Endung (`-001.mkv` bis `-009.mkv`, `CD 1..9`, `Part 1..9`) ohne explizites `SxxExx`/`Staffel`/`Folge`-Tag sind **immer Filme** (oder Mehrteiler-Filme) und dürfen niemals in `midEp` oder `tailEpMatch` als Serien-Episode eingestuft werden.
  2. **Jahreszahl-Sperre vor Fortsetzungsnummern**: Steht im Original-Dateinamen direkt hinter der Zahl eine Jahreszahl in Klammern (z. B. `Deep Blue Sea 3 (2020)`, `Deep Blue Sea 2 (2018)`, `Creed 3 (2023)`), ist die Zahl vor `(YYYY)` **immer eine Film-Fortsetzungsnummer** und niemals eine Episodennummer.
  3. **Franchise-Guard erweitert**: `deep blue sea`, `sharknado`, `sector`, `ghettogangz`, `burg schreckenstein`, `fifty shades`, `jumanji`, `machete`, `mechanic`, `undisputed`, `boyka` u. v. m. werden fest in den Film-Franchise-Schutz aufgenommen.

### Fehler 2: `Blood And Bone.mp4`, `Russian Transporter HD.mp4`, `Kill Speed.mp4` wurden zu `Size 12`
- **Ursache**: Im Log (`msgId: 4433, 4425, 4419`) enthielt die Telegram-Caption nur `"Size: 295. MB\n@Deutsche_Film"`. Da `Size:` nicht als Metadaten-Zeile ausgeschlossen war, überschrieb die erste Caption-Zeile (`"Size: 295. MB"`) den echten Dateinamen (`"Blood And Bone.mp4"`), wurde zu `"Size"` bereinigt und auf TMDb dem Kurzfilm **`Size 12`** zugeordnet.
- **Lösung**: Zeilen, die mit Metadaten-Labels beginnen (`Size:`, `Größe:`, `Qualität:`, `Format:`, `Dauer:`, `Sprache:`, `Genre:`, `Gener:`, `Studio:`, `Director:`, `Regie:`, `Darsteller:`, `Actors:`, `Released:`, `Language:`, `FSK:`, `IMDb:`, `Rating:`, `Preis:`, `Free`) oder reine Größenangaben (`295 MB`, `1.4 GB`) enthalten, werden in `getCleanContentLines()` strikt herausgefiltert, sodass immer der echte Dateiname (`Blood And Bone.mp4`) genutzt wird.

### Fehler 3: `Sharknado .mp4` & `18 Year Old Virgin.mp4` wurden wegen `+18` in der Caption zu Serie `18 어게인` (`S01E01`)
- **Ursache**: Im Log (`msgId: 4463, 4453`) stand in der ersten Zeile der Caption nur `"+18"`. Da `"18"` zwei Zeichen lang ist, wurde `"+18"` als vermeintlicher Titel bevorzugt und der Dateiname `"Sharknado .mp4"` ignoriert.
- **Lösung**: Altersfreigabe- und Warn-Zeilen (`+18`, `18+`, `FSK 18`, `FSK 16`, `Ab 18 Jahren`, `Ab 16 Jahren`, `Uncensored`) werden niemals als Filmtitel gewertet.

### Fehler 4: `Mad Max 4 Fury Road.mkv` (`msgId: 4415`) & `Sector 4 HD.mp4` (`msgId: 4451`) wurden als Serien-Episode 4 erkannt
- **Ursache**: Der Regex `midEp` (`<Name> <Zahl> <Untertitel>`) stufte `"Mad Max 4 Fury Road"` als Serie `"Mad Max"` Folge 4 (`"Fury Road"`) ein und ordnete sie einem noch aktiven Kanal-Serienkontext (`"Film '72"`) zu. Zudem setzte `msgId: 4511` (`video.mp4` mit `@Deutsche_Film`) fälschlicherweise `"Film '72"` als aktiven Serien-Header für nachfolgende Nachrichten.
- **Lösung**:
  1. `midEp` und `tailEpMatch` greifen niemals bei Filmen mit Spielfilmlänge (`duration > 4200s` / `70 Min.`) oder bekannten Filmreihen (`Mad Max`, `Sector`, etc.).
  2. Generische Kanal-Reste wie `"Film"`, `"Filme"`, `"Serie"`, `"Deutsch"`, `"HD"` dürfen niemals als `activeContext.seriesHeader` gespeichert werden.

### Fehler 5: `Episode 4 Staffel 4 Little Britain USA (4).mp4` (`msgId: 3485..3487`) wurde zu `투바투 Episode`
- **Ursache**: Der Parser-Regex `epStaffelVon` erwartete zwingend das Wort `"von"` (`Episode 1 Staffel 2 von Little Britain`). Bei Staffel 4 (`Episode 4 Staffel 4 Little Britain USA (4).mp4`) fehlte das Wort `"von"`, wodurch `"Episode 4"` als Serienname übrig blieb.
- **Lösung**: `epStaffelVon` wird erweitert, sodass `Episode <E> Staffel <S> [von] <Serienname>` sowohl mit als auch ohne `"von"` zuverlässig den Seriennamen (`Little Britain USA`, `S04E04`) extrahiert und eine Wiederholungszahl in Klammern am Ende (`(4)`) sauber entfernt.

### Fehler 6: `Ghostbusters - Die Geisterjäger (1984)` (`msgId: 2898`) wurde zu `"Geisterjä"` abgeschnitten
- **Ursache**: In JavaScript-Regex gilt `\b` nur für ASCII-Zeichen (`[A-Za-z0-9_]`). Umlaute wie `ä`, `ö`, `ü`, `ß` gelten für `\b` als Wortgrenze! Deshalb erkannte `\bger\b` in `TECH_JUNK_REGEX` nach dem `ä` in `Geisterjäger` eine Wortgrenze und löschte die Endung `ger` (`Geisterjä-ger` → `Geisterjä`).
- **Lösung**: `TECH_JUNK_REGEX` (sowie Sprach-Cleaner im Server- und Client-Parser) verwenden echte Unicode-/Umlaut-Wortgrenzen `(?<![A-Za-zÄÖÜäöüß0-9])...(?![A-Za-zÄÖÜäöüß0-9])`, sodass deutsche Wörter wie `Geisterjäger`, `Jäger`, `Krüger`, `Bürger` oder `Doppelgänger` niemals am Umlaut zerschnitten werden.

### Fehler 7: `Creed |||` (`msgId: 3432`) & Trailer mit `"Coming Soon"` (`msgId: 4571, 4508, 4497`)
- **Ursache**:
  - `Creed |||` nutzte drei senkrechte Striche `|||` statt `III`; die Striche wurden als Trennzeichen gelöscht, sodass `Creed (2015)` statt `Creed III (2023)` erkannt wurde.
  - Trailer wie `Deep Blue Sea 2 Trailer German (2018) [Full HD 1080p] Coming Soon` (`msgId: 4571`) hatten `file_name: "Deep_Blue_Sea_2_...mp4"` ohne das Wort `"Trailer"` im Dateinamen, aber `"Trailer German ... Coming Soon"` mitten in der Caption.
- **Lösung**:
  - Mehrfache Pipe-Zeichen `|||` bzw. `||` am Wortende nach Leerzeichen werden vor der Bereinigung in römische Zahlen `III` bzw. `II` umgewandelt.
  - Der Trailer-Filter prüft bei kurzen Videos (`< 900s` / `15 Min.`) die gesamte erste Caption-Zeile auf `\b(?:trailer\s+(?:german|deutsch)|offizieller\s+trailer|official\s+trailer|teaser\s+trailer|coming\s+soon)\b`.

---

## 2. User Experience & Visual Design (Detailansicht & CD 1–N Release-Box)

### Kompakte Release-Box für mehrteilige Filme (`CD 1` bis `CD N`)
- **Gruppierte Release-Karte statt 5 Einzelzeilen**:
  - **Release-Kopfzeile**: Zeigt links die gemeinsamen technischen Daten (`1080p · x264 · DE · 5 Teile (Gesamt 8.74 GB)`) und rechts direkt den Sammel-Button `📦 Alle 5 CDs senden` sowie für Admins einen dezenten Edit-/Melde-Button.
  - **Horizontales CD-Button-Grid**: Darunter liegen die einzelnen Teile sauber sortiert von links nach rechts als kompakte Direkt-Buttons:
    `[ ▶ CD 1 · 1.86 GB ]` `[ ▶ CD 2 · 1.86 GB ]` `[ ▶ CD 3 · 1.86 GB ]` `[ ▶ CD 4 · 1.86 GB ]` `[ ▶ CD 5 · 1.30 GB ]`
  - **Einzel-Releases (1 Datei)**: Werden weiterhin als aufgeräumte 1-Zeilen-Karte (`1080p · x264 · 1.94 GB · DE` links, `▶ An Bot-Chat senden` + `✏️` + `⚠️` rechts) ohne `Quellgruppe (Auto-Copy)` Ballast dargestellt.

---

## 3. Technische Architektur & Datenfluss

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 1. SERVER- & CLIENT-INGESTER (Telegram Backup JSON / Live-Post)            │
│    • Trailer-Guard: Überspringt "Trailer German / Coming Soon" (< 15 Min.) │
│    • Caption-Filter: Ignoriert "Size: .. MB", "+18", "Studio:", "Genre:"   │
│    • Pipe-Normalizer: Wandelt "Creed |||" -> "Creed III"                   │
│    • Umlaut-Safe Cleaner: Schützt "Geisterjäger" vor \bger\b-Abschnitt     │
│    • Movie vs. Series Guard:                                               │
│      - Dateien mit -001..-009 / CD1..9 / (YYYY) hinter Zahl = FILM         │
│      - "Episode X Staffel Y <Serie>" auch ohne "von" = SERIE SYYEXX        │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 2. PART-NORMALISIERUNG & SORTIERUNG (CD 1 .. CD N)                         │
│    • SPLIT1..9 / PART1..9 / CD01..9 / DISC1..9 ──► "CD 1" .. "CD 9"        │
│    • Numerische Sortierung: partNum ASC (1 → 2 → 3 → 4 → 5)                │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 3. DETAIL-MODAL RENDERER (Filme & Serien)                                  │
│    • Gruppiert Mehrteiler nach Release (Qualität + Codec + Sprache)        │
│    • Rendert Release-Box mit horizontalen [▶ CD 1 · 1.86 GB] Buttons       │
│    • Verschiebt "🔗 Quellgruppe (Auto-Copy)" in das Admin-✏️-Modal         │
└────────────────────────────────────────────────────────────────────────────┘
```
