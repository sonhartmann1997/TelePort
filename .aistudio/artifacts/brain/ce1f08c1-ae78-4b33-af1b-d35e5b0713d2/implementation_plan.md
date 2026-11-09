# Fehleranalyse & Reparaturplan: Parsing-Logik & Diagnose-Logger

Die Auswertung deines Diagnose-Logs (`1.200 Logs`, davon `785 OK`, `348 SKIPPED_HEADER`, `49 SUBREQUEST_PAUSE`, `2 TMDB_NOT_FOUND`, `1 CONFLICT`) zeigt, dass die Pipeline bereits sehr stabil läuft – die verbleibenden Fehlzuordnungen, verstümmelten Titel und leeren `(Reset)`-Header lassen sich auf **8 exakte Ursachen** in der Server- und Client-Parsing-Logik zurückführen.

> [!IMPORTANT]
> **Synchronisierung von Server- & Client-Parser:**
> Einige Bereinigungsregeln waren im Worker-Parser bereits aktualisiert, im vorgeschalteten Browser-JSON-Parser jedoch noch auf dem älteren Stand. Alle 8 Korrekturen werden nachfolgend **synchron in beiden Parser-Stufen** (Browser-Vorab-Parser & Cloudflare Worker-Ingester) verankert.

---

### 1. Gefundene Fehler im Diagnose-Log (Root-Cause-Analyse)

#### Fehler 1: `"- Der"` wird zu `" r"` verstümmelt (Ursache für beide `TMDB_NOT_FOUND` & den `CONFLICT`!)
- **Belege im Log:**
  - `msgId: 2895`: `Shrek - Der tollkühne Held (2001).m4v` ➔ `parsedTitle: "Shrek r tollkühne Held"` (`TMDB_NOT_FOUND`)
  - `msgId: 2897`: `Shrek 2 - Der tollkühne Held kehrt zurück (2004).m4v` ➔ `parsedTitle: "Shrek 2 r tollkühne Held kehrt zurück"` (`TMDB_NOT_FOUND`)
  - `msgId: 3011`: `James Bond 007 - Der Morgen Stirbt Nie (1997).m4v` ➔ `parsedTitle: "James Bond r Morgen Stirbt Nie"` (`CONFLICT`, landet bei `"List of films set in Berlin"`)
- **Ursache:**
  Die Regex zur Entfernung von Länder-/Sprachkürzeln `/(?:[\(\[_-]\s*(?:DE|De|de|EN|...)\s*[\)\]]?)/g` hatte eine optionale schließende Klammer `[\)\]]?` und **keine Wortgrenze (`\b`)**. Dadurch hat sie mitten im deutschen Artikel **`"- Der"`** die Zeichenkette **`"- De"`** als Sprachkürzel erkannt und gelöscht – übrig blieb **`" r"`**!
- **Lösung:**
  Sprachkürzel in Klammern (`(DE)`, `[DE]`) werden strikt von Bindestrich-Suffixen getrennt. Ein Bindestrich-Sprachkürzel (`- DE`, `_DE`) wird nur noch dann entfernt, wenn danach eine **Wortgrenze + Zeilenende** (`\b(?=\s*$)`) folgt. Deutsche Artikel (`Der`, `Die`, `Das`, `Den`, `Dem`, `Des`) nach einem Bindestrich bleiben zu 100 % geschützt.

---

#### Fehler 2: `"007"` wird aus `"James Bond 007"` gelöscht
- **Beleg im Log:**
  - `msgId: 3011`: `James Bond 007 - Der Morgen Stirbt Nie (1997).m4v` ➔ `"007"` fehlt komplett im `parsedTitle`.
- **Ursache:**
  Die Split-Archiv-Regex `replace(/(?:[-_.]|\s)00[1-9]\b/gi, " ")` sollte eigentlich Datei-Splits wie `.001` oder `-002` am Dateiende entfernen, löscht aber auch `" 007"` mitten im Titel.
- **Lösung:**
  Split-Endungen werden nur noch ganz am Ende des Dateinamens für die Ziffern `001` bis `004` (`(?:[-_.]|\s)00[1-4]\s*$/i`) entfernt. `"007"` bleibt immer erhalten.

---

#### Fehler 3: Foto-/Poster-Header ohne Jahreszahl werden als `(Reset)` verworfen
- **Belege im Log:**
  - `msgId: 3872`: `"DRAGON 🐉 BALL DAIMA"` ➔ `parsedTitle: ""`, `reason: "... (Reset)"`
  - `msgId: 3571`: `"𝗛𝗜𝗚𝗛 𝗣𝗢𝗧𝗘𝗡𝗧𝗜𝗔𝗟 ᴴᴰ"` ➔ `parsedTitle: ""`, `reason: "... (Reset)"`
  - `msgId: 2889` (`"The Wire"`), `msgId: 2754` (`"Jamai Raja"`), `msgId: 2712` (`"Fargo"`), `msgId: 2421` (`"Tote Mädchen lügen nicht"`), `msgId: 2389` (`"The Last Kingdom"`), `msgId: 2339` (`"Das Amt"`), `msgId: 2244` (`"Prison Break"`), `msgId: 3431` (`"Creed 3 Rockys Legacy"`), `msgId: 3430` (`"Begabt - Die Gleichung eines Lebens"`) ➔ alle mit `parsedTitle: ""` und `(Reset)`.
  - `msgId: 3436`: `"Wild, witzig und wahnsinnig abgedreht: „Cocaine Bear“ erzählt..."` ➔ `parsedTitle: ""`, `(Reset)`.
- **Ursache:**
  1. In `extractPreContext` (Server & Client) wurde die erste Textzeile eines Foto-Posters (`firstLine`) **nur dann** als Titel/Serien-Header gespeichert, wenn entweder das Wort `"Staffel"` oder eine **4-stellige Jahreszahl** im Text vorkam. Reine Titel-Poster wie `"The Wire"`, `"Fargo"` oder `"Prison Break"` ohne Jahreszahl fielen durch das Raster und lösten fälschlicherweise einen `(Reset)` aus!
  2. Bei `"𝗛𝗜𝗚𝗛 𝗣𝗢𝗧𝗘𝗡𝗧𝗜𝗔𝗟 ᴴᴰ"` (`msgId: 3571`) wurden die hochgestellten Unicode-Buchstaben `ᴴᴰ` (`\u1D34\u1D30`) zu `"HD"` normalisiert oder vor der NFKD-Normalisierung gefiltert, ohne dass ein Jahr vorhanden war.
  3. Bei `"Wild, witzig und wahnsinnig abgedreht: „Cocaine Bear“ erzählt..."` (`msgId: 3436`) war Zeile 1 ein langer Beschreibungssatz, obwohl der Filmtitel eindeutig in deutschen Anführungszeichen `„Cocaine Bear“` steht.
- **Lösung:**
  - Hat ein Foto-/Text-Header in Zeile 1 einen sauberen Titel (2–65 Zeichen, max. 8 Wörter, kein Metadaten-Label), wird dieser **auch ohne Jahreszahl** als Vorab-Kontext (`title` bzw. `seriesHeader`) übernommen.
  - Ist Zeile 1 ein langer Beschreibungssatz (> 65 Zeichen / > 10 Wörter), sucht ein Fallback nach einem Titel in Anführungszeichen (`„...“`, `"..."`, `«...»`) wie `„Cocaine Bear“`.
  - Unicode-Superscript `ᴴᴰ` / `⁴ᴷ` wird vor der Bereinigung explizit in `HD` / `4K` umgewandelt und als Technik-Tag entfernt.

---

#### Fehler 4: Jahres-Spannen `(2003 - 2006)` hinterlassen Klammer-Reste `"Little Britain ( - )"`
- **Belege im Log:**
  - `msgId: 3481, 3474, 3467`: `"Little Britain (2003 - 2006) Staffel 2/3/4"` ➔ `parsedTitle: "Little Britain ( - )"`.
- **Ursache:**
  Die Jahres-Regex hat `2003` und `2006` einzeln gelöscht, wodurch der Bindestrich zwischen den Klammern `( - )` stehen blieb.
- **Lösung:**
  Jahres-Spannen `[\(\[]?\s*(19[2-9]\d|20[0-2]\d)\s*[-–—/bis]+\s*(?:19[2-9]\d|20[0-2]\d|heute|present)?\s*[\)\]]?` werden als kompletter Ausdruck erkannt (das Startjahr `2003` wird als `year` gespeichert) und mitsamt Klammern und Bindestrich restlos entfernt. Zusätzlich entfernt die Endbereinigung verwaiste Klammern mit Sonderzeichen (`[\(\[]\s*[-–—/:.,;]*\s*[\)\]]`).

---

#### Fehler 5: `"Killers of the Flower Moon (USA 2023) HD 264"` behält `"264"` im Titel
- **Beleg im Log:**
  - `msgId: 3553`: `rawText: "Killers of the Flower Moon (USA 2023) HD 264"` ➔ `parsedTitle: "Killers of the Flower Moon 264"`.
- **Ursache:**
  1. In `extractClientPreContextFromMsg` und `extractPreContext` wurde nur die Jahreszahl `2023` aus Zeile 1 gelöscht, statt den **harten Jahres-Cut-Off** (`applyHardYearCutoff`) anzuwenden, der alles rechts neben `(USA 2023)` (also auch `HD 264`) abschneidet.
  2. Zudem fehlte `264` / `265` ohne führendes `x` oder `h.` in der Tech-Junk-Liste.
- **Lösung:**
  `applyHardYearCutoff` wird konsequent auch auf Header-Zeilen und im Client-Parser angewendet; zusätzlich wird `\b(?:x|h\.?)?26[45]\b` in den Tech-Junk-Filter aufgenommen.

---

#### Fehler 6: `"Erstausstrahlung: April 2025"` als Titel (`msgId: 3791`) & Chat-Text `"Hahahahah Bruder"` erbt Filmtitel (`msgId: 3447`)
- **Belege im Log:**
  - `msgId: 3791`: `"Erstausstrahlung: April 2025 👈 👈\n\nDer Kopfgeldjäger Hub Halloran..."` ➔ `parsedTitle: "Erstausstrahlung: April"`.
  - `msgId: 3447`: `"Hahahahah Bruder"` ➔ `parsedTitle: "Arielle, die Meerjungfrau"` (aus vorheriger Nachricht geerbt).
- **Ursache:**
  - `Erstausstrahlung:`, `Ausstrahlung:`, `Premiere:`, `Kinostart:`, `Start:` fehlten in der Metadaten-Zeilenfilterung (`getCleanContentLines`).
  - Reine Chat-/Kommentar-Nachrichten ohne Video behielten beim Aufruf von `extractClientPreContextFromMsg` den vorherigen `rollingPreContext.title` bei und schrieben ihn in das Header-Log.
- **Lösung:**
  - `Erstausstrahlung|Ausstrahlung|Premiere|Kinostart|TV-Start|Starttermin` werden als Metadaten-Präfixe ausgefiltert.
  - Chat-Kommentare ohne Medienbezug (`"Hahahahah Bruder"`, `"Danke"`, `"Lol"`) werden als `SKIPPED_JUNK` übersprungen und erben niemals den `parsedTitle` des vorherigen Films.

---

#### Fehler 7: Alter 40-Zeichen-Abschneider im Browser-Vorab-Parser noch aktiv
- **Ursache:**
  Im Worker-Parser wurde das Limit bereits auf 120 Zeichen angehoben, aber im Client-Parser (`parseClientMediaPreview` und `enrichClientVideoFromNeighborPost`) stand noch `if (cleanTitle.length > 50) cleanTitle = cleanTitle.split(/[:\n(]/)[0].trim().slice(0, 40);`.
- **Lösung:**
  Auch im Client-Parser wird der harte 40/50-Zeichen-Abschnitt entfernt und durch die 120-Zeichen-/15-Wörter-Regel ersetzt.

---

#### Fehler 8: `SUBREQUEST_PAUSE`-Duplikate & vererbte `tmdbId` bei `PARTIAL_BATCH`
- **Belege im Log:**
  - `msgId: 186`, `msgId: 99`, `msgId: 93` tauchen doppelt als `SUBREQUEST_PAUSE` auf – einmal beim Pausieren (`tmdbId: null`) und einmal nach erfolgreichem Import (`tmdbId: 1396, matchedTitle: "Breaking Bad"`), wobei der Status auf `SUBREQUEST_PAUSE` hängen blieb.
  - `Subrequest-Guard (Pause bei Index +5)` (`parsedTitle: "PARTIAL_BATCH"`) trägt eine fremde `tmdbId` (`140607`, `180`, `991530`).
- **Lösung:**
  - Wird eine pausierte `msgId` im Folge-Batch mit finalem Status (`OK`, `CONFLICT`, `TMDB_NOT_FOUND`) verarbeitet, überschreibt das Log-Merge den alten `SUBREQUEST_PAUSE`-Status dieser `msgId` sauber mit `"OK"` (statt `SUBREQUEST_PAUSE` beizubehalten).
  - System-Einträge (`PARTIAL_BATCH` / `Subrequest-Guard`) erhalten strikt `tmdbId: null, matchedTitle: null` und werden pro Batch-Pause eindeutig geschlüsselt.

---

### 2. Technische Architektur des Synchron-Fixes

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   TELEGRAM JSON-EXPORT / KANAL-POSTS                       │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 1. Vorab-Normalisierung & Gatekeeper (Client & Worker)                     │
│  • NFKD + Superscript-Normalisierung ("𝗛𝗜𝗚𝗛 𝗣𝗢𝗧𝗘𝗡𝗧𝗜𝗔𝗟 ᴴᴰ" -> "HIGH POTENTIAL")│
│  • Chat-Chatter ("Hahahahah Bruder") -> SKIPPED_JUNK (kein Context-Bleed)  │
│  • Metadaten-Filter inkl. "Erstausstrahlung:", "Kinostart:", "Premiere:"   │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 2. Harter Jahres- & Spannen-Cut-Off + Titel-Reinigung                      │
│  • Jahres-Spannen "(2003 - 2006)" -> Startjahr 2003 + Klammern komplett weg│
│  • Harter Cut-Off nach "(USA 2023)" -> "HD 264" fällt sofort weg           │
│  • Sprach-Suffix "- DE" nur mit \b am Ende -> "- Der" bleibt 100% intakt!  │
│  • Split-Suffix "-001..-004" nur am Ende -> "James Bond 007" bleibt intakt!│
│  • Kein 40-Zeichen-Abschneider im Client- & Server-Parser (120 Zeichen)    │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 3. Vorab-Kontext (Poster-Header) & Diagnose-Log-Merger                     │
│  • Poster ohne Jahr ("The Wire", "Fargo", "Prison Break") werden erkannt   │
│  • Zitat-Fallback ("„Cocaine Bear“") bei langen Beschreibungs-Postern      │
│  • SUBREQUEST_PAUSE wird bei Erfolg im nächsten Batch sauber zu "OK"       │
└────────────────────────────────────────────────────────────────────────────┘
```
