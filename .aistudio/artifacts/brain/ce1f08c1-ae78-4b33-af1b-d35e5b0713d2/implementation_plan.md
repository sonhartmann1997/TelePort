# Automatisierter Cloudflare Workers GitHub-Build & Pre-Build-Validierung

Dieser Plan sichert das automatische Deployment über GitHub-Sync zu Cloudflare Workers Builds ab, indem vor jedem Build eine strikte `esbuild`-Syntax- und Bundle-Prüfung (exakt analog zu Wrangler) ausgeführt, der Worker-Quellcode automatisch synchronisiert und die produktiven Cloudflare-Bindings (`DB`, `MOVIE_SAVED`, `WEBHOOK_URL`) fest verdrahtet werden.

## User Review & Critical Decisions

> [!IMPORTANT]
> Alle Entscheidungen aus den Rückfragen wurden übernommen. Sobald du auf **Proceed** klickst, wird die Pre-Build-Pipeline scharfgeschaltet und der finale Build erzeugt, sodass dein nächster GitHub-Push bei Cloudflare ohne `const`- oder Duplicate-Key-Fehler durchläuft.

- **Bestätigte Entscheidung 1 (Deployment-Pfad)**: Automatischer Deploy via GitHub-Sync mit Cloudflare Workers Builds (`bun run build` gefolgt von `npx wrangler deploy`).
- **Bestätigte Entscheidung 2 (Pre-Build-Absicherung)**: Automatische `esbuild`-Syntax- und Bundle-Prüfung sowie Synchronisation des Worker-Skripts vor jedem `npm run build` / `bun run build`.

---

## 1. Overview & Core Concept

- **What It Does**: Verbindet die lokale Studio-Vorschau, die generierten statischen Assets und den Cloudflare-Edge-Worker in einer einzigen, reproduzierbaren Build-Pipeline. Vor jedem Frontend-Build prüft `esbuild` das gesamte Worker-Skript im ESM-Bundle-Modus auf Konstanten-Zuweisungen, doppelte Objektschlüssel und Syntaxfehler.
- **Target Audience / Persona**: Entwickler und Administratoren des Telegram Movie & Series Bots + der STREAMFLIX Mini-App, die Änderungen direkt über GitHub an Cloudflare Workers ausrollen.
- **Key Value**: Verhindert fehlgeschlagene Cloudflare-Deploys durch frühzeitige Bundle-Validierung und garantiert, dass Studio-Download, Vorschau-Sandbox und produktiver Cloudflare Worker immer denselben geprüften Stand verwenden.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. Änderungen am Worker oder im Studio werden automatisch durch die Pre-Build-Prüfung validiert.
  2. Im Reiter **Deploy & Einrichtungs-Anleitung** sind die produktiven Bindings (`WEBHOOK_URL`, `DB`, `MOVIE_SAVED`) bereits fertig voreingestellt und als `wrangler.toml` / `wrangler.jsonc` abrufbar.
  3. Nach dem Synchronisieren zu GitHub führt Cloudflare Workers Builds `bun run build` und `npx wrangler deploy` in einem Durchlauf fehlerfrei aus.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Immersion im Netflix-inspirierten Dark-Mode (`#141414` / `#090c14`) mit klaren Status-Indikatoren im Studio-Header.
  - *Color Palette & Mood*: Tiefschwarze Oberflächen (`--background: #090c14`), markante Signal-Akzente in Netflix-Rot (`#E50914`) und Cloudflare-Amber (`#F59E0B`).
  - *Typography & Hierarchy*: Klare Sans-Serif-Hierarchie für UI-Elemente kombiniert mit präziser Monospace-Darstellung für Wrangler-Konfigurationen, Logs und Anker-Navigation.
  - *Component Styling & Layout*: Aufgeräumtes Multi-Tab-Studio mit dynamischem Code-Splitting (`React.lazy`) für schnelle Ladezeiten.
- **Interactive Feedback & Motion**: Sofortige Status-Rückmeldung beim Kopieren oder Herunterladen des geprüften Worker-Skripts sowie beim Testen der Telegram-Webhook-Endpunkte.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Pre-Build `esbuild` Dry-Run & Auto-Sync im Build-Skript**
  - *Chosen Approach*: Integration eines Pre-Build-Schritts in das Build-Kommando, der den Worker vor dem Vite-Build mit `esbuild --bundle --format=esm` prüft und in das statische Asset-Verzeichnis synchronisiert.
  - *Why*: Wrangler nutzt intern exakt `esbuild` im ESM-Modus. Dadurch werden Fehler wie `Cannot assign to "list" because it is a constant` oder `Duplicate key " viii "` bereits beim Bauen erkannt und behoben, bevor ein Commit entsteht.
  - *Alternatives Considered*: Reine Prüfung über `node --check` (erkennt zwar Syntaxfehler, aber keine `const`-Neuzuweisungen oder doppelte Objekt-Keys, die erst der `esbuild`-Bundler von Wrangler meldet).
- **Entscheidung 2: Feste Verdrahtung von D1, KV und Webhook-URL in der Wrangler-Konfiguration**
  - *Chosen Approach*: Hinterlegen von `WEBHOOK_URL = "https://teleport.sonhartmann-1997.workers.dev/"`, der D1-Datenbank (`DB`: `5a29a16f-663f-4392-85b8-461a15753829`) und des KV-Namespaces (`MOVIE_SAVED`: `12475ed9f06b4899bc2930d1a7de0ba9`) direkt in der Wrangler-Konfiguration.
  - *Why*: Damit verbindet `npx wrangler deploy` in der Cloudflare-Build-Pipeline alle Datenbanken, KV-Speicher und die Webhook-Domain vollautomatisch ohne manuelle Nacharbeit im Cloudflare-Dashboard.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     GitHub Sync & Cloudflare Build                       │
│                                                                          │
│  ┌──────────────────────┐    ┌──────────────────────┐    ┌────────────┐  │
│  │ 1. Pre-Build Check   │───▶│ 2. Vite Asset Build  │───▶│ 3. Wrangler│  │
│  │ esbuild ESM Dry-Run  │    │ Code-Split Studio &  │    │   Deploy   │  │
│  │ + Worker Asset Sync  │    │ Mini-App Bundle      │    │ Edge Push  │  │
│  └──────────────────────┘    └──────────────────────┘    └─────┬──────┘  │
└────────────────────────────────────────────────────────────────┼─────────┘
                                                                 │
                                                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                Cloudflare Edge Runtime (teleport Worker)                 │
│                                                                          │
│  ┌──────────────────────┐    ┌──────────────────────┐    ┌────────────┐  │
│  │   @ANCHOR: PARSER    │    │   @ANCHOR: TMDB      │    │ @ANCHOR:   │  │
│  │ Sequel-Schutz (YYYY) │───▶│ Strict Movie Lock &  │───▶│ D1_MOVIES  │  │
│  │ + 3-Stufen-Regel     │    │ >2 Jahre Sperre      │    │ 0-Ep Clean │  │
│  └──────────────────────┘    └──────────────────────┘    └─────┬──────┘  │
│                                                                │         │
│  ┌──────────────────────┐    ┌──────────────────────┐          │         │
│  │ KV: MOVIE_SAVED      │◀──▶│ D1: DB (teleport-db) │◀─────────┘         │
│  │ (12475ed9f06b4899…)  │    │ (5a29a16f-663f-4392…)│                    │
│  └──────────────────────┘    └──────────────────────┘                    │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - **D1 (`DB`)**: Speichert `movies`, `movie_files`, `series`, `series_seasons`, `series_episodes` und `episode_files`. Serien werden erst angelegt, wenn mindestens eine reale Videodatei (`telegram_file_id`) vorliegt; verwaiste Serien mit 0 Episoden-Videos werden beim Import-Abschluss und beim Dashboard-Abruf automatisch bereinigt.
  - **KV (`MOVIE_SAVED`)**: Hält Benutzereinstellungen, Filterprofile, Merklisten und den Aktivitäts-Log-Puffer.
  - **Environment (`vars`)**: `WEBHOOK_URL` (`https://teleport.sonhartmann-1997.workers.dev/`) steuert die Telegram-Mini-App-Buttons (`web_app`), den `/setwebhook`-Endpunkt und die Status-Ausgabe.
- **Interactive Component & State Mapping**:
  - **Pre-Build Validator**: Führt vor jedem Build den `esbuild`-Check durch, synchronisiert das geprüfte Worker-Skript für den Studio-Download und bricht bei Fehlern sofort mit klarem Zeilenhinweis ab.
  - **Deploy & Setup View**: Zeigt die fertige Wrangler-Konfiguration inklusive `DB`, `MOVIE_SAVED` und `WEBHOOK_URL` zur direkten Übernahme oder als ZIP-Export an.
