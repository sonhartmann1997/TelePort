# Implementierungsplan: Telegram Bot API 8.0–8.3+ & Mini-App Direktstart-Upgrade

## 1. Web Mini-App Direktstart & Tiefe Telegram-Integration
* **Permanenter Chat-Menü-Button (`setChatMenuButton` mit `MenuButtonWebApp`):**
  * Erweiterung von `tgApi(env)` in `/worker-modules/03-telegram-kv-engine.js` um `setChatMenuButton(chatId = null, webAppUrl = "", buttonText = "🍿 Mediathek")` und `setMyCommands()`.
  * Automatische Registrierung des `MenuButtonWebApp` beim Aufruf von `/start` sowie global über einen 1-Klick-Button im Admin-Cockpit, sodass unten links neben dem Texteingabefeld dauerhaft der **„🍿 Mediathek“**-Button zum direkten Öffnen der Mini-App erscheint.
* **Start-Button über Inline-Suchergebnissen (`InlineQueryResultsButton`):**
  * In `answerInlineQuery` (`/worker-modules/03-telegram-kv-engine.js` & `/worker-modules/06-bot-ui-menus.js`) wird automatisch der moderne Parameter `button: { text: "🍿 Mediathek Mini-App öffnen", web_app: { url: effectiveWebAppUrl } }` mitgegeben, sodass Nutzer aus jedem Chat heraus über den Inline-Ergebnissen direkt in die Mini-App springen können.
* **Bot API 8.0 Vollbild-Modus (`requestFullscreen`) & Home-Screen-Icon (`addToHomeScreen`):**
  * In der TMA (`/worker-modules/08a-tma-netflix-frontend.js` & `/worker-modules/08b-tma-netflix-frontend.js`) wird ein Header-/Einstellungs-Button für **Vollbild (`⛶ Vollbild` via `Telegram.WebApp.requestFullscreen()` / `exitFullscreen()`)** sowie **„📲 App zum Startbildschirm hinzufügen“ (`Telegram.WebApp.addToHomeScreen()`)** integriert (inkl. automatischem Fallback für ältere Clients oder Desktop-Browser).
* **1-Klick Setup & `@BotFather`-Guide im Admin-Cockpit:**
  * Neues Panel **„🚀 Telegram Bot API 8.3 & Mini-App Setup“** im Admin-Cockpit (`/worker-modules/08b-tma-netflix-frontend.js` & `/worker-modules/08c-tma-netflix-frontend.js`) mit:
    1. **1-Klick „Menü-Button & Bot-Befehle jetzt in Telegram aktivieren“** (führt `setChatMenuButton` + `setMyCommands` live über `/api/tma/admin/bot-setup` aus).
    2. **Kompakter `@BotFather` 3-Schritte-Guide** (mit Kopier-Buttons für App-URL & Kurzbeschreibung), um zusätzlich die *Main Mini App* in der Chatliste und den Direktlink `t.me/DeinBot/app` freizuschalten.

---

## 2. Video-Cover direkt in Dateien einbetten – ohne Neu-Upload (`Bot API 8.3 cover`)
* **Individuell im Admin-Cockpit umschaltbarer Cover-Modus (`videoCoverMode`):**
  * Im Admin-Cockpit (sowie persistent in D1/KV) kann der Admin jederzeit wählen zwischen:
    * **`backdrop` (Standard):** 16:9 TMDb-Szenenbild (`backdrop_path`) mit automatischem Fallback auf das vertikale Poster (`poster_path`).
    * **`poster`:** Immer das klassische vertikale TMDb-Film-/Serienplakat (`poster_path`).
    * **`off`:** Kein zusätzliches Cover beim Video-Versand einbetten.
* **Direktes Cover-Embedding bei `sendVideo` (0 Bytes Video-Upload):**
  * In `deliverMediaOrCopyFromSource` (`/worker-modules/03-telegram-kv-engine.js`) und `/api/tma/send-stream` (`/worker-modules/09-tma-api-worker-export.js`) ermittelt der Worker anhand der `tmdbId` (bzw. der übergebenen `posterUrl` / `backdropUrl`) die passende hochauflösende TMDb-Bild-URL und übergibt sie im neuen Bot API 8.3 Parameter **`cover`** an `sendVideo`.
* **Automatisches File-ID-Harvesting + In-Place Cover-Update für `copyMessage` (`tg_export_...`):**
  * Wird eine Datei aus dem JSON-Backup zunächst per `copyMessage` (`tg_export_<chatId>_<msgId>`) aus der Quellgruppe kopiert:
    1. Falls eine `file_id` im Response oder über den stillen Harvest-Forward (`HARVEST_CACHE_CHAT_ID` bzw. Zielchat-Inspect) geerntet wird, speichert der Worker die echte `telegram_file_id` sofort dauerhaft in D1 (`replaceExportFileIdInD1`).
    2. Unmittelbar danach ruft der Worker **`editMessageMedia`** mit `InputMediaVideo` (`media: harvestedFileId`, `cover: coverUrl`, `caption: htmlCaption`) auf der soeben gesendeten Nachricht im Zielchat auf – dadurch erhält selbst eine kopierte Datei sofort ihr eingebettetes Cover im Player, ohne dass das Video neu hochgeladen werden muss.
    3. Bei jedem weiteren Abruf dieses Titels nutzt der Bot direkt `sendVideo` mit der gespeicherten `file_id` + `cover`.

---

## 3. Native `copy_text`-Buttons (`CopyTextButton`) zum 1-Klick-Kopieren
* **Unterstützung in `sanitizeReplyMarkup` (`/worker-modules/02-parser-ingester.js`):**
  * Sicherstellen, dass `copy_text: { text: "..." }` in Inline-Keyboard-Buttons erhalten bleibt und sauber an die Telegram Bot API durchgereicht wird.
* **Integration in Detailkarten & „🔍 Wie suchen?“-Menü (`/worker-modules/06-bot-ui-menus.js`):**
  * Im Such-/Aktionsmenü eines Films oder einer Serie wird ein nativer **`📋 Titel kopieren`**-Button (`copy_text: { text: "Titel (Jahr)" }`) eingebunden, der den Namen bei einem Tipp sofort nativ in die Zwischenablage des Smartphones/PCs kopiert (ohne einen Callback-Roundtrip zu benötigen).
