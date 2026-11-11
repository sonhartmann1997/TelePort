# Implementierungsplan: Strukturierte Pipeline-Erweiterung (MODUL 1 bis MODUL 6 – ohne Staffel-Flip)

## MODUL 1: Import-Schleife & Limits (`/worker-modules/03-telegram-kv-engine.js`, `/worker-modules/07-webhook-callbacks.js`, `/worker-modules/08c-tma-netflix-frontend.js`)
1. **Streng chronologische Abarbeitung & `processedMsgIds`-Deduplizierung:**
   - Sowohl im Client-Vorab-Parser (`detectAndParseClientBackupJson` in `08c`) als auch im Server-Batch-Ingester (`detectAndExtractTelegramBackupOrJson` & `processEntriesBatchWithLimit` in `07`) werden `messages` vor dem Loop zwingend aufsteigend nach `Number(msg.id || msg.message_id || 0)` sortiert.
   - Nachrichten werden strikt sequenziell (`for (let i = startIndex; i < messages.length; i++)`) abgearbeitet.
   - Ein `const processedMsgIds = new Set()` (sowie sitzungsübergreifend im Batch-State) stellt sicher: Ist `msg.id` bereits in `processedMsgIds` enthalten, wird die Nachricht sofort übersprungen (ohne Log-Eintrag), um mehrfache Durchläufe bei Resumes zu verhindern.
2. **Cloudflare Free-Tier Turbo anpassen (`subrequestGuard: 38`, `wallClockLimitMs: 6000`):**
   - In `WORKER_SPEED_PROFILES.free_turbo` (`03-telegram-kv-engine.js`) und `processEntriesBatchWithLimit` (`07-webhook-callbacks.js`) wird der Subrequest-Guard von `14` auf **`38`** und der Zeit-Guard auf **`6000ms`** angehoben.
   - **Kein Logger-Overflow durch Pausen:** Löst der Guard aus, wird `SUBREQUEST_PAUSE` ausschließlich in `summaryCounts` hochgezählt, aber **niemals** in das `entries`-Array des Diagnose-Loggers geschrieben. Als `nextIndex` wird exakt der aktuelle Index `i` zurückgegeben.

---

## MODUL 2: Archive (`.rar`/`.zip`/`.7z`/`.iso`/`.tar`/`.gz`) als Download-Dateien speichern (`/worker-modules/02-parser-ingester.js`, `/worker-modules/04-d1-database.js`, `/worker-modules/07-webhook-callbacks.js`, `/worker-modules/08b-tma-netflix-frontend.js`)
1. **Erkennung als Download-Archiv statt Junk:**
   - Ganz oben im Client- und Server-Parser prüfen wir:
     `const isArchive = /\.(?:rar|zip|7z|iso|tar|gz)$/i.test(fileName || "");`
   - Wenn `isArchive === true`: Die Datei durchläuft regulär die Bereinigungs- und TMDb-Pipeline und erhält zwingend `type: "archive"` und `isDownloadOnly: true` (`isArchive: true`) im `parsedItem`.
2. **Speicherung in D1 unter `downloads` (nicht als abspielbarer Videostream):**
   - Beim D1-UPSERT (`saveMovieToD1` / `saveSeriesToD1` / `saveMovieFileToD1` / `saveEpisodeFileToD1` in `04-d1-database.js` & `resolveAndIngestMediaEntry` in `07-webhook-callbacks.js`) werden Archive mit `isDownloadOnly: true` **nicht** als regulärer Videostream für den Video-Player eingereiht, sondern im `downloads`-Array (`details_json.downloads` sowie mit `is_download_only` / `codec: "ARCHIVE"`-Kennzeichnung) des jeweiligen Films bzw. der Serie/Staffel gespeichert, sodass das Frontend dafür dedizierte Download-Buttons (`📦 Download-Archiv`) rendert.

---

## MODUL 3: Der `"fileFingerprint"` (Echte Telegram-IDs vs. JSON) (`/worker-modules/04-d1-database.js`, `/worker-modules/07-webhook-callbacks.js`)
1. **Verhinderung des `null === null`-Duplikat-Bugs:**
   - Für jede Datei wird der eindeutige Fingerabdruck gebildet:
     ```javascript
     const fileFingerprint = msg.file_unique_id || msg.file_id || `${msg.file_size || 0}_${msg.duration_seconds || 0}_${msg.width || 0}x${msg.height || 0}`;
     ```
2. **Exakter 5-Tupel-Abgleich in D1 (`saveMovieFileToD1` & `saveEpisodeFileToD1`):**
   - Nur wenn `(tmdb_id, season, episode, part_number, fileFingerprint)` in D1 exakt identisch ist (und `fileFingerprint !== "0_0_0x0"`), wird `status: "SKIPPED_DUPLICATE"` zurückgegeben.
   - Weicht `fileFingerprint` ab (z. B. andere Dateigröße, Auflösung oder Dauer), wird die Datei als **neue Qualitäts- bzw. Schnitt-Version** desselben Films bzw. derselben Episode in D1 gespeichert.

---

## MODUL 4: Parser-Vorreinigung (Umlaute, Kanal-Tags & Wortgrenzen) (`/worker-modules/02-parser-ingester.js`, `/worker-modules/08b-tma-netflix-frontend.js`)
Sowohl im Server-Parser (`02`) als auch im Client-Vorab-Parser (`08b`) werden `rawText` und `fileName` exakt in dieser Reihenfolge vorgereinigt:
1. **NFC-Normalisierung & Globale Umlaute:**
   - `.normalize("NFC")` ganz am Anfang (`u\u0308` $\rightarrow$ `ü` für *Ein Rezept für die Liebe*), gefolgt von globaler ASCII-Umlaut-Konvertierung mit `/g`-Flag (`.replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü")` inkl. Großbuchstaben `Ae`/`Oe`/`Ue` und Schutz echter Wörter wie *Abenteuer* / *Feuer* / *Duell*), damit bei `"Vier Faeuste fuer ein Halleluja"` beide Wörter umgewandelt werden.
2. **Kanal-Präfixe löschen (vor `_`-Umwandlung & Sprachfilter):**
   - `.replace(/^@\s*(?:german[\s._-]*(?:movies?|vid(?:eo)?s?|filme?)|[\w.-]+)[\s_:\-]*/gi, "")` sowie `^@\s*movies\s+/i` und `\b(?:german[\s._-]+movies|@[\w.-]+)\b/gi`, damit niemals `"MOVIES Nur eine Frau"` oder `"Vid Fack ju Goethe"` übrig bleibt.
3. **Strenge Wortgrenzen `\b` bei Sprach- und Länderkürzeln (`"Pines"`- & `"Fences"`-Fix):**
   - Entferne Sprachkürzel ausschließlich mit echten Wortgrenzen `\b`: `.replace(/\b(?:de|en|fr|es|ger|ita)\b/gi, "")`.
   - Korrigiere den Jahresklammern-Regex in `08b-tma-netflix-frontend.js` (Zeile 5210), sodass zwingend eine öffnende Klammer `[\(\[]` und `\b` vor `(?:DDR|BRD|USA|UK|DE|FR|IT|ES)` stehen muss.
4. **Scene-Group-Präfixe mit Whitelist:**
   - Entferne am Dateianfang kleingeschriebene Scene-Kürzel `^[a-z]{2,6}-` (wie `cyd-`, `cd-`, `nge-`, `inkl-`), **außer** der Anfang gehört zur Whitelist offizieller Bindestrich-Titel (`x-men`, `a-team`, `k-pax`, `g-force`, `u-571`, `k-19`, `t-rex`, `v-wars`, `wall-e`, `spider-man`, `ant-man`, `kick-ass`, `non-stop`, `hi-hi`).
5. **Klammer-Titel aufspalten:**
   - Bei Titeln wie `"Little Italy (Ein Rezept für die Liebe)"` oder `"Freunde mit gewissen Vorzügen (Friends With Benefits)"` wird der Teil vor der Klammer als `primaryTitle` (`cleanTitle`) und der Klammerinhalt als `altTitle` (`originalTitle`) extrahiert und getrennt bei TMDb abgefragt.

---

## MODUL 5: Multi-Part (`CD1`/`CD2`), Editionen & Jahres-Schnitt (`/worker-modules/02-parser-ingester.js`, `/worker-modules/07-webhook-callbacks.js`, `/worker-modules/08b-tma-netflix-frontend.js`)
1. **Die `"Teil 2"` vs. `"-CD2"` Positions-Regel:**
   - Steht `Teil [1-4]` oder `Part [1-4]` **VOR** der Jahreszahl `(YYYY)` (wie bei `"Die Tribute von Panem – Mockingjay Teil 2 (2015)"`), gehört es zum offiziellen Filmtitel (`part_number = 1`, wird **nicht** gelöscht!).
   - Steht `CD`, `Disc`, `Disk` oder `Part`/`Teil` **HINTER** der Jahreszahl (`"Hogfather - 2006 - Part 2"`), oder ist es ein Split-Suffix (`-001`..`-004`), `01`/`02` direkt vor `(YYYY)` (`"The Postman 01 (1997)"`) oder ein mehrteiliges Archiv (`.part01.rar`), wird es vom Suchtitel abgeschnitten und `part_number = 1..4` gesetzt.
   - Bei Serien (`isSeries === true`) ist `part_number` immer `1` (`Teil`/`Part`/`F10` ist dort die Episodennummer).
   - Bei `part_number > 1` wird der Sequel-Konflikt-Check (`sequelMismatch`) deaktiviert.
2. **Edition extrahieren:**
   - `\b(director'?s[\s._-]*cut|extended(?:\s*cut|\s*edition)?|special[\s._-]*edition|dc)\b/i` wird als `editionLabel` für den Versionen-Switcher gespeichert und vor der TMDb-Suche aus dem Suchtitel entfernt.
3. **Cut-Off nach der Jahreszahl & 120-Zeichen-Limit:**
   - Alles rechts neben der vierstelligen Jahreszahl `(YYYY)` (Auflösungen, Genres wie `2012SiFi`, Codecs, Container) wird rigoros abgeschnitten.
   - Das harte Titel-Limit liegt bei **120 Zeichen** (kein 40/50-Zeichen-Abschneider mitten im Wort).

---

## MODUL 6: TMDb-Scoring, Rechte-Bindestrich-Suche & Logger-Variablen-Leck (`/worker-modules/07-webhook-callbacks.js`, `/worker-modules/08c-tma-netflix-frontend.js`)
1. **Rechte-Bindestrich-Suche (`"Michel aus Lönneberga - Michel bringt die Welt in Ordnung"`):**
   - Liefert die Suche nach dem Gesamttitel und dem Teil links vom Bindestrich 0 passende Treffer, durchsucht `searchTmdbCandidatesForImport` TMDb automatisch auch nach dem Sub-String **rechts** vom ersten Bindestrich (`split(/\s*[-–—:]\s*/)[1]`).
2. **100% Titel-/Untertitel-Match (`+150` Punkte & `±3` Jahre Toleranz):**
   - Stimmt der TMDb-Titel exakt mit dem Suchtitel **oder** mit dem Untertitel (Teil nach dem Bindestrich, wie `"Die Rückkehr"` bei `"Alien 2 - Die Rückkehr (1986)"` $\leftrightarrow$ `"Aliens - Die Rückkehr"`) überein, vergibt das Scoring **+150 Bonuspunkte** und erlaubt eine Produktionsjahr-Toleranz von **±3 Jahren** ohne `YEAR_CONFLICT` oder `SEQUEL_CONFLICT`.
   - Zudem wird vor einer jahreslosen Suche zuerst `year + 1` und `year - 1` geprüft (`"300 (2006)"` $\rightarrow$ `"300"` aus `2007` mit 100%).
3. **Variablen-Leck im Logger schließen:**
   - Bei `TMDB_NOT_FOUND`, `API_ERROR` und `SUBREQUEST_PAUSE` werden beim Erstellen des Log-Eintrags (sowohl im Server-Logger in `07` als auch im Client-Logger in `08c`) zwingend `matchedTitle = null` und `tmdbId = null` gesetzt.
