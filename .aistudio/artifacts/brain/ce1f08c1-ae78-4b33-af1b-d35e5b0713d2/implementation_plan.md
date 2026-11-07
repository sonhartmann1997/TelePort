# Implementierungsplan: Admin/VIP-Zugang im Simulator, End-to-End JSON-Import-Simulation & Reparatur der Fehlermeldungen

## 1. Ursache & Behebung des Admin/VIP-Zugangsproblems im Simulator

### Identifizierte Ursachen
1. **Überschreiben von `window.Telegram.WebApp.initData` durch `telegram-web-app.js`:**
   - `NetflixTmaSimulator.tsx` injiziert das Persona-Bridge-Skript direkt nach `<head>`.
   - Wenige Zeilen später lädt `08a-tma-netflix-frontend.js` das externe Skript `<script src="https://telegram.org/js/telegram-web-app.js"></script>`. Da im Simulator-Iframe keine echten Telegram-Hash-Parameter in der URL stehen, überschreibt das offizielle Skript `window.Telegram.WebApp` und setzt `initData = ""`.
   - Beim App-Start ist `rawInitData` dadurch leer (`""`) und die Mini-App landet im **Gast-Modus (`👤 Gast • Login`)**, ohne `/api/tma/auth/init` aufzurufen.
2. **Ablehnung der Simulator-Signatur im Worker-Backend (`resolveTmaAuthContext`):**
   - Selbst wenn das Frontend im Simulator `sessionToken = "sim_session_token_valid"` oder `hash=sim_valid_hmac` sendet, schlagen `verifyTmaSessionToken` und `verifyTelegramInitDataHmac` in `08a-tma-netflix-frontend.js` bei nachfolgenden Backend-Requests (`/api/tma/admin/overview`, `/api/tma/admin/import-batch`, `/api/tma/admin/validate-channel`, `/api/tma/admin/reports`) fehl. Der Worker stuft den Request als `guest` ein (`403 Zugriff verweigert`).
3. **Veraltetes `localStorage`-Token beim Rollenwechsel:**
   - Beim Umschalten zwischen `Admin & VIP`, `Telegram User` und `Gast / Browser` in der oberen Leiste blieb ein zuvor gespeichertes `tma_session_token` im Iframe bestehen.

### Geplante Lösung (Auto-Login über normales Mini-App-Menü)
- **`src/components/NetflixTmaSimulator.tsx`:**
  - Beim Injizieren der Simulator-Bridge wird `<script src="https://telegram.org/js/telegram-web-app.js"></script>` im Simulator-Iframe neutralisiert bzw. `window.Telegram.WebApp` gegen Überschreiben geschützt, sodass `initData` und `initDataUnsafe` der gewählten Rolle (`admin_vip` oder `standard_user`) stabil erhalten bleiben.
  - Beim Wechsel der Rolle in der oberen Simulator-Leiste wird `localStorage` für `tma_session_token` automatisch synchronisiert, sodass sofort der Auto-Login als **Admin & VIP** (`🟢 @streamflix_admin 🌟VIP 👑`) greift und das Admin-Panel regulär über das Mini-App-Menü (Sidebar oder Account-Modal) geöffnet werden kann.
  - Die `/api/tma/auth/init`- und `/api/tma/auth/me`-Requests werden direkt durch die echte Worker-Sandbox (`executeWorkerSandbox`) geleitet, die ein echtes, kryptografisch signiertes Session-Token ausstellt und den Admin-User in der D1-Sandbox (`users`-Tabelle) anlegt.
- **`worker-modules/08a-tma-netflix-frontend.js`:**
  - `verifyTelegramInitDataHmac` unterstützt neben der regulären HMAC-SHA256-Signatur auch verifizierte Simulator-Payloads (`hash=sim_valid_hmac`), sofern die User-ID mit der konfigurierten Simulator-Persona übereinstimmt. Dadurch durchlaufen **alle** nachfolgenden `/api/tma/admin/*`-Routen exakt denselben D1-Auth-Pfad wie in Produktion.

---

## 2. Ursache & Reparatur der VIP/Admin-Fehlermeldungen („🚨 Meldungen“)

### Identifizierte Ursachen (warum Meldungen beim Bestätigen, Löschen und DB-Reset nicht verschwinden)
1. **`media_reports` fehlte komplett beim Datenbank-Reset (`04-d1-database.js` Zeile 2580):**
   - `resetAllMediaAndPlaylistsInD1AndKv(env)` löschte nur 9 Tabellen (`episode_files`, `series_episodes`, `series_seasons`, `series`, `movie_files`, `movies`, `search_cache`, `entity_cache`, `import_queue`), ließ aber **`media_reports`** (sowie `import_diagnostic_logs`, `d1_playlists`, `d1_playlist_items`, `d1_import_checkpoints`) in D1 unangetastet!
   - Zusätzlich wurden in `resetAllD1MediaAdmin` (`08c-tma-netflix-frontend.js` Zeile 1785) die Client-Caches `window._adminReportsCache` und `window._lastAdminOverviewCache` nicht geleert.
2. **Stale Client-Cache nach „Als gelöst markieren“ & „Löschen“ (`08b-tma-netflix-frontend.js` Zeilen 4007–4035 & `08c` Zeile 4036):**
   - `adminResolveMediaReportClient` und `adminDeleteMediaReportClient` riefen zwar `POST /api/tma/admin/reports` auf, ignorierten aber die vom Server zurückgegebene aktualisierte `reports`-Liste und aktualisierten weder `window._adminReportsCache` noch `window._lastAdminOverviewCache`.
   - Anschließend riefen sie `loadAdminPanelView()` mit `forceNetworkRefresh = false` auf, wodurch das Admin-Panel die alten gecachten Meldungen aus `window._lastAdminOverviewCache` / `window._adminReportsCache` wieder anzeigte.
3. **ID-Abweichung zwischen `memoryFallback` (`Date.now()`) und SQLite `AUTOINCREMENT` (`04-d1-database.js` Zeile 1116 & 1141):**
   - Beim Erstellen einer Meldung (`createMediaReportInD1`) wurde `entry.id = Date.now()` gesetzt, während `INSERT INTO media_reports` die `id`-Spalte wegließ. Wenn `res.meta.last_row_id` abwich oder aus dem Memory-Cache gelesen wurde, passte `WHERE id = ?1` beim Löschen/Bestätigen nicht zur gespeicherten ID.
4. **Fehlende Auto-Auflösung bei Korrektur ohne vorhandene Quelldatei oder bei Titel-Neu-Zuordnung (`09-tma-api-worker-export.js` Zeilen 1005 & 1212):**
   - Wenn eine gemeldete Folge bereits verschoben/gelöscht war, brach `/api/tma/admin/reassign-episode` mit `404` ab, **bevor** `resolveMatchingMediaReportsInD1` aufgerufen wurde.
   - Ebenso löste `/api/tma/admin/remap-media` (Titel komplett neu zuordnen) offene Meldungen zum alten `tmdbId` nicht automatisch auf.

### Geplante Lösung für die Fehlermeldungen
- **`worker-modules/04-d1-database.js`:**
  - **Datenbank-Reset (`resetAllMediaAndPlaylistsInD1AndKv`):** Löscht ab sofort auch `DELETE FROM media_reports`, `DELETE FROM import_diagnostic_logs`, `DELETE FROM d1_playlist_items`, `DELETE FROM d1_playlists` und `DELETE FROM d1_import_checkpoints` sowie `memoryFallback.delete("d1_media_reports")`.
  - **Konsistente Report-IDs & sicheres Löschen/Bestätigen:** `resolveMediaReportInD1` und `deleteMediaReportFromD1` matchen sowohl über `id = ?1` als auch über `created_at = ?1`. Zusätzlich wird eine Funktion `clearAllMediaReportsInD1(env, onlyResolved = false)` ergänzt.
- **`worker-modules/09-tma-api-worker-export.js`:**
  - `/api/tma/admin/reports` unterstützt neben `resolve` und `delete` auch `clear_all` (alle Meldungen löschen) und `clear_resolved` (alle gelösten Meldungen löschen).
  - `/api/tma/admin/reassign-episode`, `/api/tma/admin/remap-media` und `deleteMediaFromD1` lösen verknüpfte Meldungen (`reportId` bzw. `tmdbId`) immer zuverlässig auf – selbst wenn die alte Quelldatei bereits entfernt wurde.
- **`worker-modules/08b-tma-netflix-frontend.js` & `08c-tma-netflix-frontend.js`:**
  - `adminResolveMediaReportClient`, `adminDeleteMediaReportClient`, `submitAdminEpisodeReassign` und `resetAllD1MediaAdmin` aktualisieren sofort `window._adminReportsCache` und `window._lastAdminOverviewCache` mit den frischen Server-Daten und erzwingen `loadAdminPanelView(true)`.
  - Im Tab **„🚨 Meldungen“** wird zusätzlich ein Button **„🗑️ Alle Meldungen löschen“** (sowie **„🧹 Gelöste entfernen“**) eingebaut.

---

## 3. Aufgedeckte Logikfehler in der JSON-Import-Pipeline (werden direkt behoben)

Bei der Analyse des JSON-Import-Datenflusses (`08c-tma-netflix-frontend.js`, `07-webhook-callbacks.js`, `09-tma-api-worker-export.js`) wurden **4 konkrete Logikfehler** gefunden:

1. **Logikfehler 1 – Nicht erkannte Titel (`unmatched`) wurden als `"?"` statt `"failed"` markiert (`07-webhook-callbacks.js` Zeile 2452):**
   - **Problem:** Wenn `resolveAndIngestMediaEntry` keinen TMDb-Treffer findet (`res.unmatched === true`), setzte `processEntriesBatchWithLimit` das Feld `status: "?"` statt `status: "failed"`.
   - **Auswirkung:** Im Tab **„🛠️ Prüfen & Korrigieren“** stand der Zähler **„❌ Nicht erkannt (0)“** immer auf `0`, und alle nicht gefundenen Filme/Serien landeten fälschlich unter **„🔎 Unsichere Treffer“** mit Diagnose-Status `CONFLICT_?` statt `TMDB_NOT_FOUND`.
   - **Fix:** `failItemObj.status` in `07-webhook-callbacks.js` wird sauber auf `"failed"` gesetzt; in `08c-tma-netflix-frontend.js` wird konsistent auf `(x.status === "failed" || !x.tmdbId)` geprüft.
2. **Logikfehler 2 – Fehlerhafter Checkpoint-Cursor bei `PARTIAL_BATCH` (40-Subrequest-Guard) (`09-tma-api-worker-export.js` Zeile 587 & `08c` Zeile 3491):**
   - **Problem:** Der Client schickte vor Batch-Start `cursor: backupImportJob.cursor + slice.length` mit, und der Server speicherte diesen Wert ungeprüft in D1 (`d1_import_checkpoints`). Bei `PARTIAL_BATCH` würden nach einem Reload die restlichen Einträge des Teil-Batches übersprungen.
   - **Fix:** `/api/tma/admin/import-batch` berechnet den D1-Checkpoint erst **nach** `processEntriesBatchWithLimit` anhand des tatsächlichen `nextStartIndex` (`batchStartCursor + nextStartIndex`) und addiert die tatsächlich gespeicherten Zähler exakt auf.
3. **Logikfehler 3 – Doppelte Zählung bei `isolateFailedEntryAtCursor` (`08c-tma-netflix-frontend.js` Zeile 3452):**
   - **Problem:** Isolierte Fehleinträge erhöhten gleichzeitig `failedCount += 1` **und** `uncertainCount += 1`, beim Auflösen wurde aber nur `failedCount` reduziert.
   - **Fix:** Isolierte Fehleinträge erhöhen nur `failedCount`.
4. **Logikfehler 4 – Kanal-Verifizierung (`/api/tma/admin/validate-channel`) prüfte auf `env.BOT_TOKEN` statt `env.TELEGRAM_BOT_TOKEN` (`09-tma-api-worker-export.js` Zeile 269):**
   - **Fix:** Nutzung von `env.TELEGRAM_BOT_TOKEN` mit automatischer Simulator-Erkennung, inklusive Speicherung des verifizierten Quell-Kanals in D1 und Memory.

---

## 4. Echter End-to-End JSON-Import-Testlauf mit Test-Generator & Prüfbericht im Simulator

Im Admin-Panel unter **„📦 Backup-Import (100k+)“** integrieren wir eine direkt ausführbare **End-to-End Simulations- & Diagnose-Suite** (`🧪 E2E JSON-Import Simulation starten`):
- Generiert ein realistisches Telegram-Backup (`result.json`-Struktur mit Kanal `-1001987654321`) mit allen 7 Praxisfällen (1080p Film, TS-Vorabversion + 1080p-Upgrade, Exaktes Duplikat, Serie `S01E01`/`S01E02`/`S01E04` inkl. Lücken-Erkennung für `E03`, Jahres-Konflikt `YEAR_CONFLICT`, Unbekannter Titel `TMDB_NOT_FOUND`, Kanal-Header ohne Video).
- Durchläuft die echte Pipeline (Kanal-Verifizierung → JSON-Parser & Datei-ID-Injektion → `/api/tma/admin/import-batch` → D1-Katalog-, Playlist-, Checkpoint-, Meldungs-Reset- und Hauptseiten-Prüfung) und zeigt einen detaillierten **Prüfbericht (Pass/Fail-Checkliste)** direkt im Admin-Dashboard an.
