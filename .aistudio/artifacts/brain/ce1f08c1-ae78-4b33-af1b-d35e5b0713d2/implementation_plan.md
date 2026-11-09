# Implementierungsplan (Revidiert): Webhook-Passwortschutz, Anti-Retry-Storm Engine, Worker-Health-Monitor & Golden-Ratio UI

## 1. Weiter gedacht: Warum das Webhook-Passwort & Edge-Schutz entscheidend für deinen Cloudflare Free-Tier sind
Ein Passwort direkt für den **Telegram Webhook** (`secret_token` + optionaler URL-Key) löst nicht nur ein Sicherheitsproblem, sondern schützt auch aktiv dein **Cloudflare CPU- & D1-Kontingent**:
1. **Echter Telegram Webhook-Passwortschutz (`X-Telegram-Bot-Api-Secret-Token` + `?secret=`)**:
   - Ohne Webhook-Passwort kann jeder Bot oder Scanner im Internet gefälschte POST-Requests an `https://teleport.sonhartmann-1997.workers.dev/webhook` senden und damit dein D1-Lese-Limit (5 Mio. Zeilen/Tag) oder deine 10ms CPU-Zeit verbrauchen.
   - **Unsere Lösung (0ms Gatekeeper)**: Du vergibst auf der neuen Seite `🤖 Bot & Einstellungen` ein eigenes **Webhook-Passwort** (oder lässt per 1-Klick ein kryptografisch sicheres generieren).
   - Beim Klick auf **„Webhook + Passwort aktivieren“** übermittelt der Worker dieses Passwort als offiziellen `secret_token` an Telegram (`setWebhook`) und zeigt dir zusätzlich die geschützte URL (`.../webhook?secret=DEIN_PASSWORT`).
   - **0-D1-Read Edge-Prüfung**: Der Worker hält das Webhook-Passwort im Warm-Memory (`globalThis`) bereit und prüft jeden eingehenden Webhook-Aufruf **in unter 0,1ms CPU-Zeit noch vor dem JSON-Parsing und vor jedem D1-Zugriff**. Unbefugte Requests werden sofort mit `401 Unauthorized` abgewiesen (0 D1-Reads!).
2. **Weiter gedacht #1 – Schutz vor „Telegram Retry-Stürmen“ (Endlos-Schleifen bei Timeouts)**:
   - *Das versteckte Problem*: Wenn ein Webhook-Aufruf auf dem Free-Tier einmal in ein 503-CPU-Limit läuft, versucht Telegram **denselben Befehl 24 Stunden lang immer wieder alle paar Sekunden erneut zuzustellen** – das legt den Worker und die D1-Datenbank lahm.
   - *Unsere Lösung*:
     - **`update_id` Ring-Buffer im Worker-Speicher**: Jede `update_id` von Telegram wird sofort im Arbeitsspeicher gemerkt. Schickt Telegram ein Update doppelt, antwortet der Worker sofort in `0,1ms` mit `200 OK`, ohne die Aufgabe noch einmal auszuführen.
     - **`max_connections` Free-Tier-Bremse**: Beim Setzen des Webhooks kannst du `max_connections` für den Cloudflare Free-Tier auf z. B. `5–10` (statt Standard `40`) begrenzen, damit Telegram deinen Worker niemals mit 40 gleichzeitigen Requests überflutet.
     - **1-Klick „Hängende Telegram-Updates leeren (`drop_pending_updates`)“**: Ein Not-Aus-Schalter auf der Bot-Seite, falls sich bei Telegram jemals eine Warteschlange aufgestaut hat.
     - **`allowed_updates` Filter**: Telegram weckt deinen Worker nur noch bei echten Ereignissen (`message`, `callback_query`, `inline_query`, `channel_post`) und ignoriert unnötige Status-Updates.
3. **Weiter gedacht #2 – In-Memory Katalog-Cache (95 % weniger D1-Reads beim Öffnen der Mini-App)**:
   - Bisher hat jedes Öffnen der Mini-App (`/api/tma/bootstrap`) alle Filme, Serien und Playlisten frisch aus D1 gelesen.
   - Wir bauen einen **intelligenten In-Memory Edge-Cache (`globalThis.__CATALOG_EDGE_CACHE`)** ein, der den Katalog im Worker-RAM hält und **nur dann automatisch invalidiert wird, wenn du im Admin-Panel etwas importierst, bearbeitest oder löschst**. Ergebnis: Das Öffnen der Mini-App dauert **`< 1ms` CPU-Zeit** und verbraucht **0 D1 Row-Reads**!

---

## 2. Geplante Features im Detail

### A. Neue zentrale Admin-Seite: `🤖 Bot & Einstellungen`
Alle Bot-, Sicherheits- und Worker-Funktionen sind auf **einer einzigen, nach dem Goldenen Schnitt (`61,8% : 38,2%`) aufgebauten Seite** gebündelt:
1. **🔗 Telegram Webhook-Zentrale & Webhook-Passwort (`secret_token`)**:
   - **Webhook-URL Anzeige**: `https://teleport.sonhartmann-1997.workers.dev/webhook` (inkl. 1-Klick-Kopieren).
   - **Webhook-Passwort setzen / ändern / generieren**:
     - Eingabefeld für dein Webhook-Passwort (`A-Za-z0-9_-`, kompatibel mit Telegrams `secret_token`-Spezifikation) + Button **„🎲 Sicheres Passwort generieren“**.
     - Live-Sicherheitsbadge: `🟢 Webhook geschützt (Header + URL-Secret aktiv)` vs. `🟡 Ungeschützt`.
   - **Erweiterte Webhook-Steuerung (1-Klick)**:
     - **„🔒 Webhook mit Passwort bei Telegram registrieren (`setWebhook`)“** (setzt URL, `secret_token`, `max_connections` für Free-Tier und `allowed_updates`).
     - **„🔍 Live Webhook-Diagnose (`getWebhookInfo`)“** (zeigt ausstehende Updates `pending_update_count`, letzten Telegram-Fehler mit Uhrzeit, gesetzte `max_connections` und Verbindungsstatus).
     - **„🧹 Hängende Updates verwerfen (`drop_pending_updates`)“** (stoppt sofort eventuelle Telegram-Retry-Schleifen).
     - **„🧪 Webhook-Selbsttest (Ping mit Passwort)“** (prüft live, ob der Worker unautorisierte Aufrufe blockiert und autorisierte durchlässt).
     - **„🤖 Bot-Befehle & Mini-App Menü-Button synchronisieren“**.
2. **🎨 BotFather Asset-Studio (inkl. 512×512 Single-`<path>` SVG & WEBP)**:
   - Exakt nach der offiziellen `@BotFather`-Vorgabe (*"Please send an SVG file with a canvas size of 512x512 and a single `<path>` element inside, or a WEBP or TGS file with the same size"*):
     - **1-Klick Download: `bot-splashscreen-512x512.svg`** → Reines SVG mit `width="512" height="512" viewBox="0 0 512 512"` und **exakt einem einzigen `<path d="..." />`-Element** im Inneren.
     - **1-Klick Download: `bot-splashscreen-512x512.webp`** → Direkt per Canvas erzeugtes `512×512` `.webp` im neuen Dark-Blue/Neon-Cinema-Stil.
     - Zusätzlich: **512×512 Bot-Foto (PNG)**, **640×360 Intro-Banner (PNG)** sowie die **Header-/Body-Farbcodes** (`#060A14` / `#0B1222` / `#00E5FF`) mit 1-Klick-Übernahme in das Telegram WebApp SDK.
3. **⚡ Worker-Speed-Profil, D1-Cache-Kontrolle & Anti-Spam-Cockpit**:
   - Umschalter zwischen **Free-Tier Safe Mode (<10ms CPU, Micro-Batches, Edge-Cache aktiv)** und **Paid Unbound Mode**, Button zum manuellen Leeren des Edge-Caches sowie die Anti-Spam-Einstellungen an einem Ort.

---

### B. Echtzeit `Worker-Health-Monitor` & Automatische Aufgaben-Teilung (Micro-Batching)
- **Live CPU- & Subrequest-Telemetrie**:
  - Jede Worker-Antwort liefert `_workerHealth` (`cpuEstimateMs`, `wallTimeMs`, `subrequests`, `d1Ops`, `cacheHit`).
- **Echtzeit `Worker-Health-Monitor` im UI**:
  - Zeigt die CPU-Laufzeit (ms) der letzten Requests als Live-Anzeige + Mini-Sparkline.
  - **Vollautomatische Drosselung & Cooldown**:
    - Nähert sich ein Request der **7ms-Marke**, halbiert das UI automatisch die Batch-Größe auf **1 bis 2 Aufgaben pro Request** und legt einen kurzen Cooldown (1,5–3s) ein.
    - Bei `HTTP 503 exceededCpu` teilt der **Smart-Split** das Paket sofort in Einzel-Aufgaben (`batchSize = 1`) und arbeitet sie Stück für Stück ab.
- **Beseitigung der Log-Bremsen**:
  - Wegfall des 27-KB-Checkpoint-Payloads bei `/api/tma/admin/import-batch` (spart ~15ms JSON-CPU pro Batch).
  - Gezielte SQL-Index-Abfragen statt Tabellen-Scans in `prefetchBatchMediaFromD1`.
  - Abschaltung des 1,2-Sekunden Dauer-Pollings auf `/api/tma/anti-spam-queue`.

---

### C. Neues Dark-Blue / Subtle-Neon Farbschema, Merklisten-Long-Press & Key-Navigation
1. **Edles Dark-Blue / Subtle-Neon Designsystem (`#060A14` / `#0B1222` / `#00E5FF` / `#6366F1`)**:
   - Hochwertige Midnight-Sapphire-Oberfläche mit feinen Cyan-Konturen – modern, augenschonend und frei von Kitsch.
2. **Goldener Schnitt (`1 : 1.618` / `61,8% : 38,2%`) & Entschlackung**:
   - **Entfernt**: Überflüssiger Tab `🏠 Hauptseite` in der Admin-Leiste sowie der manuelle Button `🧹 Doppelte Buttons bereinigen` (defekte/doppelte Stream-Buttons werden vollautomatisch im Hintergrund gefiltert und bereinigt).
   - **JSON-Import & Detail-Modal**: Aufgeräumtes 2-Spalten-Layout im Verhältnis **`61,8%` Hauptfokus** zu **`38,2%` Live-Status / Stream-Panel**.
3. **Merklisten-Badge & „Gedrückt halten zum Speichern“ (Long-Press)**:
   - Jeder Film in der Merkliste trägt direkt auf dem Poster ein klares **Electric-Cyan Badge (`✓ Merkliste`)** samt feiner Cyan-Kartenkontur.
   - **Gedrückt halten (Touch, Maus & langes `Enter`)** speichert oder entfernt den Titel sofort mit visuellem Impuls und Haptik-Feedback.
4. **Vollständige Tastatur- & Smart-TV Key-Navigation**:
   - Durchgängige Steuerung per Pfeiltasten (`ArrowUp/Down/Left/Right`), `Enter` (inkl. Langdruck bzw. Taste `M`/`W` für Merkliste), `Escape`/`Backspace` und `/` (Suche) mit klarem Cyan-Fokusring.
