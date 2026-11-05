# Implementierungsplan: Ruckelfreies JSON-Einlesen & Blockierungsfreies Admin-Panel beim Import

## 1. Ruckelfreies Einlesen großer JSON-Backups (Chunked Async UI-Yielding)
- **Ursache:** In `/worker-modules/08c-tma-netflix-frontend.js` laufen `detectAndParseClientBackupJson()` und `deduplicateAndClassifyClientEntries()` bisher synchron in einer einzigen Schleife über zehntausende Telegram-Nachrichten. Dadurch blockiert der Browser-Hauptthread für 1–3 Sekunden.
- **Lösung:**
  - Beide Funktionen werden in asynchrone Funktionen (`async function`) umgewandelt, die alle **400 Einträge** kurz an den Browser-UI-Thread abgeben (`await new Promise(r => setTimeout(r, 0))`).
  - Während des Einlesens und Deduplizierens wird der Fortschritt live im Status-Text aktualisiert (z. B. `⏳ Lese & analysiere Nachricht 2.400 / 14.800 (16%)...` bzw. `⏳ Gruppiere & prüfe Duplikate...`).
  - Der Browser bleibt dadurch jederzeit flüssig und reagiert sofort auf Klicks oder Scrollen.

---

## 2. Garantierter Sofort-Zugang zum Admin-Panel (Kein Aussperren bei HTTP 503)
- **Ursache:** Wenn während eines laufenden Batch-Imports ins Admin-Panel gewechselt wird, ruft `loadAdminPanelView()` bisher zwingend `GET /api/tma/admin/overview` auf. Da der Cloudflare Worker parallel durch `/api/tma/admin/import-batch` ausgelastet ist, schlägt `/admin/overview` in ein `HTTP 503`-Limit und bricht `loadAdminPanelView()` mit `return;` komplett ab – noch bevor die Admin-Oberfläche gezeichnet wird.
- **Lösung:**
  - **Lokaler Admin-Overview-Cache (`window._lastAdminOverviewCache`):** Sobald `/api/tma/admin/overview` einmal erfolgreich geladen wurde, wird das Ergebnis im Speicher gecacht.
  - **Sofort-Öffnen bei laufendem Import (`backupImportJob.running`):** Wenn ein Backup-Import aktiv ist (oder pausiert mit offener Queue), überspringt `loadAdminPanelView()` den schweren Netzwerk-Abruf `/admin/overview` standardmäßig und nutzt direkt den lokalen Cache (bzw. ein sicheres Leer-Fallback-Objekt), wechselt automatisch auf den Tab **`backup`** (sofern nicht gezielt ein anderer Tab gewählt wurde) und rendert das Admin-Panel **in 0 ms ohne Netzwerk-Blockade**.
  - **Fallback-Schutz bei HTTP 503 / Netzwerkfehler:** Selbst wenn kein Import läuft und `/api/tma/admin/overview` wegen eines kurzzeitigen Cloudflare-Limits (`HTTP 503`) fehlschlägt, bricht `loadAdminPanelView()` **niemals** das Rendern der Admin-Oberfläche ab, sondern öffnet das Admin-Panel mit den gecachten Daten (oder leeren Standardlisten) plus dezentem Hinweis-Toast. So sind **Backup-Import**, **Pause/Stopp** und **Diagnose-Logs** unter allen Umständen zu 100 % erreichbar.
  - **Request-Vorfahrt:** Wenn im Admin-Panel manuell auf `🔄 Aktualisieren` geklickt wird, wartet die Hintergrund-Import-Schleife (`startOrResumeBackupImport`) vor dem nächsten Batch automatisch kurz ab, bis der Admin-Abruf fertig ist, damit sich beide Requests nicht gegenseitig in ein `HTTP 503` treiben.

---

## 3. Schwebende Mini-Statusleiste auf anderen Seiten (Floating Import Widget)
- **Funktion:** Sobald ein Backup-Import läuft (oder mit verbleibenden Einträgen pausiert ist) und man das Admin-Panel verlässt (z. B. auf die Startseite, Filme oder Serien wechselt), erscheint unten über der Navigation eine kompakte, elegante **Mini-Statusleiste**:
  - Zeigt live den aktuellen Stand: `📦 Backup-Import läuft: 420 / 1.200 (35%) • ✅ 418 • ⚠️ 2` (inkl. animiertem Fortschrittsbalken).
  - **1-Klick-Buttons direkt in der Leiste:**
    - `⏸️ Pause` / `▶️ Weiter` (pausiert oder startet den Import sofort, ohne die Seite wechseln zu müssen).
    - `📂 Zum Import` (öffnet sofort und ohne Netzwerk-Wartezeit den Backup-Import-Tab im Admin-Panel).
    - `📋 Logs` (springt direkt in den Diagnose-Log-Tab).
