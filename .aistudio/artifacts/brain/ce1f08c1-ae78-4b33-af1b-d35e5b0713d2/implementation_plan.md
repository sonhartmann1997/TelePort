# Modulare 9-Abteilungen-Architektur & Automatischer Cloudflare-Build-Assembler

Dieser Plan löst die Ursache des blockierten GitHub-Updates endgültig: Da eine einzelne ~2-MB-Datei (`worker.js` mit > 2,6 MB Base64-Payload) beim AI-Studio-GitHub-Push vom Einzeldatei-Limit der GitHub-API übersprungen wurde, teilen wir den Worker im Repository physisch in seine **9 logischen Abteilungs-Module** (je ca. 100–350 KB) auf und setzen während `bun run build` (`vite build`) auf Cloudflare vollautomatisch die finale `worker.js` für `npx wrangler deploy` zusammen.

## User Review & Critical Decisions

> [!IMPORTANT]
> Durch deine Rückmeldung („Ich habe in AI Studio oben rechts auf GitHub gepusht“) ist die Ursache zu 100 % geklärt: AI Studio hat beim Push zwar neuen Commit-Trigger gesendet, aber die 1,98 MB große `worker.js` wegen des GitHub-API-Limits nicht überschrieben. Mit den 9 kleinen Modul-Dateien ist jede Datei im Repo unter 400 KB groß und wird bei jedem GitHub-Push garantiert übertragen.

- **Bestätigte Entscheidung 1 (9 Abteilungs-Module im Repository)**: Aufteilung des Monolithen in 9 übersichtliche Abteilungs-Dateien anhand der `@ANCHOR:`-Grenzen.
- **Bestätigte Entscheidung 2 (Automatischer Build-Assembler in Vite)**: Direkte Integration des Assemblers in den Vite-Build-Zyklus (`bun run build`), da Bun standardmäßig `prebuild`-Skripte überspringt, aber `vite build` immer ausführt.

---

## 1. Overview & Core Concept

- **What It Does**: Zerlegt den gesamten Cloudflare-Worker-Code verlustfrei in 9 eigenständige Abteilungs-Dateien (von `01 · Config & Genres` bis `09 · TMA API & Export`) und ersetzt die 2-MB-Datei im Repository durch einen winzigen Platzhalter (< 1 KB), damit GitHub die alte fehlerhafte `worker.js` sofort überschreibt. Beim Ausführen von `bun run build` auf Cloudflare (sowie beim Start des lokalen Dev-Servers) baut das Vite-Plugin aus den 9 Abteilungen automatisch wieder die komplette `worker.js` zusammen und validiert sie mit `esbuild`.
- **Target Audience / Persona**: Entwickler des Telegram-Bots & der STREAMFLIX Mini-App mit Fokus auf saubere Code-Struktur und zuverlässiges CI/CD-Deployment über GitHub und Cloudflare Workers Builds.
- **Key Value**:
  1. **100 % zuverlässiger GitHub-Sync**: Keine Datei im Repository überschreitet 400 KB.
  2. **Saubere Abteilungs-Trennung**: Jede der 9 Abteilungen ist separat wartbar, ergibt aber beim Build automatisch ein einziges großes Ganzes.
  3. **Garantierte Ausführung unter Bun**: Da der Assembler direkt im Vite-Plugin läuft, greift er bei `bun run build` auf Cloudflare ohne zusätzliche Wrapper-Skripte.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. Im Studio-Editor lassen sich sowohl die 9 einzelnen Abteilungen als auch das zusammengesetzte Gesamtskript einsehen, bearbeiten und herunterladen.
  2. Beim Klick auf das GitHub-Symbol in AI Studio werden alle 9 Abteilungs-Dateien sowie der schlanke Entry-Stub übertragen und überschreiben den alten Stand auf GitHub sofort.
  3. Cloudflare Workers Builds führt `bun run build` aus, das Vite-Plugin setzt die 9 Abteilungen zur finalen `worker.js` zusammen, prüft sie per `esbuild` und übergibt sie nahtlos an `npx wrangler deploy`.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Dunkles Entwickler-Studio (`#090c14`) gepaart mit dem STREAMFLIX-Design (`#141414` & `#E50914`).
  - *Color Palette & Mood*: Klare Abteilungs-Badges und Anker-Navigation im Code-Editor zur schnellen Orientierung zwischen Parser, D1-Datenbank, TMDb-Fetch und Mini-App.
  - *Typography & Hierarchy*: Monospace-Darstellung für Abteilungs-Code und Build-Logs, serife/sans-serife Kontraste in der STREAMFLIX-Vorschau.
  - *Component Styling & Layout*: Unveränderte 9-Abteilungen-Navigation im Studio-Editor, jetzt synchron zur physischen Modul-Aufteilung im Repository.
- **Interactive Feedback & Motion**: Klare Konsolen-Meldung im Cloudflare-Build-Log (`[Cloudflare Assembler] Assembled 9 departments -> worker.js`), sodass im Deployment-Log sofort sichtbar ist, dass das frische Bundle gebaut wurde.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Physische Aufteilung in 9 Abteilungs-Dateien + kleiner `worker.js`-Stub im Git-Repo**
  - *Chosen Approach*: Speicherung des Codes in 9 Abteilungs-Dateien (je ~100–350 KB) und Ersetzen der 1,98-MB-Datei im VFS durch einen kurzen Stub, der beim Start von Vite/Build sofort durch das zusammengesetzte Gesamtskript ersetzt wird.
  - *Why*: Dadurch zwingen wir die GitHub-Sync-API von AI Studio, die alte 1,98-MB-Datei auf GitHub zu überschreiben, während der gesamte Code in 9 handlichen Paketen übertragen wird.
  - *Alternatives Considered*: Komprimierung der Einzeldatei (reicht bei ~1,9 MB nicht sicher unter das Base64-Limit der GitHub-Contents-API).
- **Entscheidung 2: Assembler direkt im Vite-Build-Plugin statt nur in `prebuild`**
  - *Chosen Approach*: Ausführung des 9-Abteilungen-Assemblers direkt im `buildStart`- und `configureServer`-Hook des Vite-Plugins.
  - *Why*: Cloudflare nutzt `bun run build`. Da Bun NPM-`prebuild`-Hooks ignoriert, aber `$ vite build` immer ausführt, ist der Vite-Plugin-Hook der einzige Ort, der unter Bun auf Cloudflare garantiert vor `npx wrangler deploy` ausgeführt wird.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                AI Studio VFS & GitHub Repository (< 400 KB/File)          │
│                                                                           │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌───────────┐  │
│  │ 01 · Config & Genres    │  │ 02 · Parser & Ingester  │  │ 03 · TG   │  │
│  ├─────────────────────────┤  ├─────────────────────────┤  ├───────────┤  │
│  │ 04 · D1 Datenbank       │  │ 05 · TMDb & Fallbacks   │  │ 06 · Menüs│  │
│  ├─────────────────────────┤  ├─────────────────────────┤  ├───────────┤  │
│  │ 07 · Webhook & Callbacks│  │ 08 · STREAMFLIX UI/Auth │  │ 09 · API  │  │
│  └────────────┬────────────┘  └────────────┬────────────┘  └─────┬─────┘  │
└───────────────┼────────────────────────────┼─────────────────────┼────────┘
                │                            │                     │
                └────────────────────────────┼─────────────────────┘
                                             ▼
┌───────────────────────────────────────────────────────────────────────────┐
│           Cloudflare Build Step (`bun run build` -> `vite build`)         │
│                                                                           │
│  1. Vite Plugin liest alle 9 Abteilungs-Module in definierter Reihenfolge │
│  2. Führt Auto-Heal & esbuild ESM-Validierung (0 Fehler / 0 Warnungen) aus│
│  3. Schreibt die vollständige `worker.js` ins Projekt-Root für Wrangler   │
└────────────────────────────────────────────┬──────────────────────────────┘
                                             │
                                             ▼
┌───────────────────────────────────────────────────────────────────────────┐
│           Cloudflare Deploy Step (`npx wrangler deploy`)                  │
│                                                                           │
│  Wrangler bundelt die frisch erzeugte `worker.js` + `./dist` Assets und   │
│  verbindet D1 (`DB`), KV (`MOVIE_SAVED`) & `WEBHOOK_URL` auf der Edge.    │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - **9 Abteilungs-Module**: Enthalten den vollständigen Worker-Code inklusive aller 3 Dashboard-Fixes (Sequel-Schutz für `Iron Man 3 (2013)`, strenger TMDb-Jahresfilter mit `> 2` Jahre Sperre, Verhinderung & Bereinigung leerer Serien mit 0 Episoden) sowie die reparierte `let list`-Variable und die bereinigten `ROMAN_NUMERALS`.
  - **Entry-Stub**: Im Git-Repository nur wenige Zeilen lang, damit GitHub die alte Datei überschreibt; wird während `vite build` und im Dev-Server automatisch mit dem 1,98-MB-Gesamtcode aus den 9 Modulen überschrieben.
- **Interactive Component & State Mapping**:
  - **Vite Dev-Server Middleware (`/worker.js`)**: Setzt bei jedem Abruf im Studio die 9 Abteilungs-Module live zusammen, sodass Simulator, STREAMFLIX-Vorschau, Code-Editor und „worker.js herunterladen“ immer das vollständige Skript erhalten.
  - **Vite Production Build (`buildStart`)**: Schreibt vor dem Bauen von `./dist` die zusammengefügte und geprüfte `worker.js` auf das Dateisystem der Cloudflare-Build-VM, damit der direkt folgende Schritt `npx wrangler deploy` fehlerfrei durchläuft.
