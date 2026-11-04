# Umsetzungsplan: Untertitel-Bindung, Vorabversion-Auto-Ersatz, Serien-Lücken-Finder & Diagnose-Log-Fix

## 1. Übersicht & Zielsetzung
Dieses Update erweitert das System um vier eng verzahnte Module für den Medien-Import, die Qualitätsverwaltung und das Admin-Dashboard:
1. **Untertitel-Bindung (`.srt`, `.sub`, `.vtt`, `.ass`)**: Untertiteldateien im Kanal oder JSON-Export werden nicht mehr als Junk verworfen, sondern intelligent an die zugehörige Videodatei (in der Regel die unmittelbar darüberliegende Videonachricht oder per Dateinamen-Abgleich) gekoppelt. Beim Abrufen eines Streams werden gebundene Untertitel automatisch mitgesendet und zusätzlich über einen eigenen Untertitel-Button bereitgestellt.
2. **Automatischer Ersatz von Vorabversionen (`#vorabversion`, `TS`, `CAM`, `MD` / Mic-Dub)**: Schlechte Vorab-Releases werden nur als Notfall-Platzhalter vorgehalten. Sobald beim Import eine reguläre Version für denselben Film bzw. dieselbe Serienfolge eintrifft, werden vorhandene Vorab-/TS-/MD-/CAM-Einträge automatisch aus der Datenbank gelöscht und durch die saubere Version ersetzt. Ist bereits eine saubere Version vorhanden, wird eine nachträglich gesendete Vorabversion beim Import automatisch übersprungen.
3. **Serien-Lücken-Finder (Übersicht fehlender Folgen)**: Ein neues Analyse-Werkzeug im Admin-Dashboard deckt fehlende Episoden in importierten Serien auf. Interne Staffellücken (z. B. Folge 1 und 2 fehlen, während Folge 3 bereits vorhanden ist) werden mit höchster Priorität hervorgehoben, ergänzt durch den Abgleich bis zum offiziellen Staffelende.
4. **Diagnose-Log-Reparatur & Synchronisation**: Behebt den Bug, durch den der Reiter „Diagnose-Log“ neben „Prüfen & Korrigieren“ nicht angeklickt werden konnte, und synchronisiert die Zählerstände beider Diagnose-Log-Einstiegspunkte in Echtzeit.

---

## 2. Funktionale & Technische Architektur

### Modul 1: Untertitel-Erkennung, Bindung & Auslieferung
- **Erkennung statt Blockade**:
  - Dateien mit den Endungen `.srt`, `.sub`, `.vtt`, `.ass` und `.ssa` werden aus der Liste blockierter Junk-Endungen herausgenommen und als `SUBTITLE_ATTACHMENT` klassifiziert.
  - Sprachkürzel im Dateinamen oder Begleittext (z. B. `de`, `ger`, `en`, `eng`, `forced`) werden automatisch als Untertitelsprache erkannt.
- **Automatische Bindung an das zugehörige Video**:
  - **Beim JSON-Import**: Trifft der Parser auf eine Untertitel-Nachricht, prüft er zuerst, ob eine explizite Antwort-Referenz (`reply_to_message_id`) auf ein Video existiert, andernfalls bindet er die Untertiteldatei an den unmittelbar zuvor erfassten Video-Kandidaten (Nachricht darüber), sofern die Nachrichten-ID-Distanz gering ist oder der bereinigte Titel übereinstimmt.
  - **Beim Live-Bot-Empfang**: Geht eine Untertiteldatei im Kanal oder Chat ein, wird sie an das zuletzt im selben Kanal/Chat empfangene Video (bzw. die per Reply referenzierte Videonachricht) in der Datenbank gekoppelt.
- **Datenbank-Erweiterung & Auslieferung**:
  - Die Tabellen für Film- und Episodendateien speichern gebundene Untertitel (`subtitles_json` mit Datei-Referenz, Dateiname und Sprachlabel) sowie das Tag `💬 Untertitel`.
  - **Automatischer Mitversand + Separater Button**: Wird ein Film oder eine Folge im Bot oder über die Mini App gestartet, sendet der Bot automatisch das Video und direkt im Anschluss die verknüpfte(n) Untertiteldatei(en). Zusätzlich erscheint im Detail-Modal und unter der Bot-Karte ein dedizierter Button `💬 Untertitel senden (.srt)`, um die Untertiteldatei jederzeit separat abzurufen.

### Modul 2: Automatische Bereinigung von `#vorabversion`, `TS`, `CAM` & `MD` beim Import
- **Prerelease-/Low-Quality-Detektor**:
  - Erkennt zuverlässig Marker für minderwertige Vorabfassungen in Text und Dateiname: `#vorabversion`, `vorabversion`, `telesync`, `ts`, `hdts`, `cam`, `hdcam`, `camrip`, `micdub`, `mic dub`, `md`, `line dubbed`, `screener`, `workprint`.
  - Markiert entsprechende Streams mit dem Versions-Hinweis `⚠️ Vorabversion / TS / MD`.
- **Ersatz-Logik beim Import**:
  - **Fall A (Gute Version trifft auf bestehende Vorabversion)**: Wird eine reguläre Version (`1080p`, `720p`, `4K`, `WEB-DL`, `BluRay` etc. ohne Vorab-/TS-/MD-Marker) importiert, löscht die Speicherroutine automatisch alle für diesen Film bzw. diese Serienfolge vorhandenen Vorab-/TS-/MD-/CAM-Datensätze aus der Datenbank und speichert nur die saubere Version.
  - **Fall B (Vorabversion trifft auf bestehende gute Version)**: Existiert in der Datenbank bereits mindestens eine reguläre, saubere Version für den Film oder die Folge, wird eine eingehende Vorab-/TS-/MD-Datei nicht mehr als Stream angelegt, sondern im Diagnose-Log sauber als `SKIPPED_PRERELEASE (Gute Version bereits vorhanden)` dokumentiert.
  - **Fall C (Notfall-Speicherung)**: Existiert noch gar keine Version des Titels, wird die Vorabversion regulär mit dem sichtbaren Hinweis `⚠️ Vorabversion` gespeichert, bis später ein Upgrade importiert wird.

### Modul 3: Serien-Lücken-Finder im Admin-Dashboard
- **Zweistufige Lücken-Analyse pro Serie & Staffel**:
  - **Priorität 1 – Interne Staffellücken (Kritisch)**: Prüft innerhalb jeder vorhandenen Staffel von Folge `1` bis zur höchsten hochgeladenen Folge (`maxUploadedEp`), welche Episoden dazwischen fehlen (z. B. Folge 1 und 2 fehlen, Folge 3 ist vorhanden; oder Folge 4 fehlt zwischen Folge 1–3 und 5–8). Diese Lücken werden rot/amber als **„Interne Lücke“** markiert.
  - **Priorität 2 – Fehlende Folgen am Staffelende**: Vergleicht die hochgeladenen Folgen zusätzlich mit der offiziellen Episodenanzahl der Staffel, um noch ausstehende Folgen bis zum Staffelfinale separat als **„Offenes Staffelende“** auszuweisen.
- **Dashboard-Oberfläche (`🧩 Serien-Lücken`)**:
  - Übersichtliche Filterung nach: *„Nur interne Lücken (Priorität)“*, *„Alle unvollständigen Staffeln“* und Textsuche nach Serienname.
  - Kompakte Staffel-Zeitleiste mit visuellen Episoden-Badges (Vorhanden = Grün, Interne Lücke = Rot hervorgehoben, Fehlend am Ende = Grau/Amber) sowie 1-Klick-Kopierfunktion für eine kompakte Lücken-Liste (ideal zum schnellen Nachladen fehlender Folgen).

### Modul 4: Reparatur & Synchronisierung des Diagnose-Logs
- **Klickbarkeit des Sub-Tabs wiederherstellen**:
  - Die Tab-Umschaltfunktion im Import-Cockpit akzeptiert nun explizit den Wert `diaglog`, sodass der Button `🛠️ Diagnose-Log` direkt neben `🛠️ Prüfen & Korrigieren` sofort die Diagnose-Ansicht öffnet.
- **Einheitlicher Echtzeit-Zähler**:
  - Sowohl der obere Admin-Reiter als auch der Sub-Tab im Import-Bereich greifen auf dieselbe zentrale Zähler-Aktualisierung zu (Kombination aus gespeicherten Server-Logs und aktuellen Browser-Vorab-Logs ohne doppelte Zählung). Dadurch zeigen beide Stellen jederzeit exakt dieselbe Zahl an.
