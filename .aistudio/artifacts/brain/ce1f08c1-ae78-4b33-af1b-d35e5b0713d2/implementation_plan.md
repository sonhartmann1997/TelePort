# KV-Batching & Session Write-Back Engine (Schutz gegen 503- & Quota-Limits)

Dieser Plan führt eine zentrale **KV-Batching- & Write-Back-Engine** ein, die alle Lese- und Schreibzugriffe auf Cloudflare KV (`MOVIE_SAVED` & `MY_KV`) im Arbeitsspeicher bündelt, Nutzerdaten in einem einzigen KV-Dokument pro `chatId` konsolidiert und Änderungen gesammelt am Session-Ende bzw. periodisch zurückschreibt.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Bestätigte Architektur-Entscheidungen aus deinen Antworten:**
> - **Bestätigte Entscheidung 1 – Konsolidiertes User-KV-Dokument (`u_bundle_<chatId>`) + Write-Back-Batcher**: Statt 4 separater KV-Keys pro Nutzer (`settings_<id>`, `user_<id>`, `folders_<id>`, `sess_<id>`) werden alle vier Bereiche in einem einzigen JSON-Bundle `u_bundle_<chatId}` gespeichert (mit automatischer, transparenter Übernahme bestehender alter Keys beim ersten Lesen). Dadurch sinken die KV-Aufrufe pro Nutzer-Interaktion sofort um bis zu **75–90 %**.
> - **Bestätigte Entscheidung 2 – In-Memory-Pufferung mit periodischem & Session-End-Flush**: Schreibzugriffe (Merkliste, Ordner, Filter, Activity-Logs, Anti-Spam-Status, Bot-Tokens) ändern sofort den RAM-Zustand (`memoryFallback`) und markieren den Key in einer `dirtyKvWrites`-Map. Ein echter KV-Write erfolgt erst gebündelt am Ende einer Session/Import-Sequenz oder nach Ablauf des Puffer-Intervalls.

---

## 1. Übersicht & Kernkonzept

- **Was umgesetzt wird**:
  1. **Zentraler KV-Read-Through- & Write-Back-Manager (`kvBatchEngine`)**:
     - Jeder KV-Key wird pro Worker-Session maximal **einmal** aus Cloudflare KV gelesen und danach vollständig aus dem RAM (`memoryFallback`) bedient (auch bei `null`/leeren Werten, damit nicht-existente Keys wie `TG_CUSTOM_BOT_TOKEN` nicht bei jedem Request erneut abgefragt werden).
     - Alle Schreibvorgänge (`kvStagePut`, `kvStageDelete`) landen zunächst im Dirty-Buffer (`dirtyKvWrites`), wobei mehrfache Änderungen am selben Key automatisch zu **einem einzigen** Schreibvorgang verschmolzen werden (Write Coalescing).
  2. **Unified User Bundle (`u_bundle_<chatId>`)**:
     - Vereint `session` (`wlState`, `searchState`, `originSession`, `simAnchor`, `promptState`), `settings` (Filter, FSK, UI-Scale, Delivery-Config), `savedList` (Merkliste / VIP-Stream-Items) und `folders` (Playlists & Sammlungen) in einem einzigen KV-Eintrag pro `chatId`.
     - **Nahtlose Legacy-Migration**: Existiert `u_bundle_<chatId>` noch nicht in KV, liest der Hydrator einmalig vorhandene Altdaten (`user_<chatId>`, `folders_<chatId>`, `settings_<chatId>`, `sess_<chatId>`) ein und führt sie im neuen Bundle zusammen.
  3. **Gedrosseltes Write-Back für System- & Diagnose-Keys (`MY_KV`)**:
     - Häufig aktualisierte System-Keys wie `TG_ACTIVITY_LOG_JSON`, `TG_LOG_RETENTION_DAYS`, `TG_ANTI_SPAM_STATE_JSON` und `tma_backup_import_checkpoint_v1` werden im RAM gepuffert und nur noch periodisch (z. B. alle 15–25 Mutationen oder nach >= 60 Sekunden) bzw. beim expliziten Session-Flush in KV geschrieben.

---

## 2. User Experience & Admin-Transparenz

- **Sofortige UI-Reaktion ohne KV-Wartezeit**:
  - Alle Aktionen im Admin-Panel, in der Netflix-Mini-App und im Telegram-Bot lesen und mutieren direkt den In-Memory-Bundle-State. Dadurch antworten Endpunkte wie `/api/tma/admin/overview`, `/api/tma/admin/playlists` und `/api/tma/stream` verzögerungsfrei und lösen keine 503-Fehler durch KV-Rate-Limits mehr aus.
- **Sicheres Persistieren über `waitUntil` & Session-Flush**:
  - Am Ende eines Benutzer-Flows oder Batch-Imports (sowie über einen periodischen Flush-Hook in `ctx.waitUntil`) schreibt `flushDirtyKvBatch(env, options)` alle geänderten Keys in einem einzigen Durchgang zurück, sofern sich der JSON-Inhalt gegenüber dem letzten KV-Stand tatsächlich geändert hat (Hash-/String-Diff-Prüfung).

---

## 3. Technische Architektur & Datenfluss

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                 INCOMING REQUEST / BOT UPDATE / ADMIN ACTION                 │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. IN-MEMORY READ-THROUGH CACHE & UNIFIED USER BUNDLE                        │
│                                                                              │
│  getUserBundle(env, chatId)  ──► Prüft RAM (`u_bundle_<chatId>`)             │
│    ├─ Treffer im RAM?        ──► Sofortige Rückgabe (0 KV-Reads!)            │
│    └─ Nicht im RAM?          ──► 1x KV-Read `u_bundle_<chatId>`              │
│                                  (Fallback: einmalige Migration alter Keys   │
│                                   `user_`, `folders_`, `settings_`, `sess_`) │
│                                                                              │
│  cachedKvGet(kv, key)        ──► Speichert auch leere Treffer ("__KV_NULL__")│
│                                  im RAM (verhindert wiederholte KV-Reads     │
│                                  für `TG_CUSTOM_BOT_TOKEN` etc.)             │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. WRITE COALESCING & DIRTY BUFFER (`dirtyKvWrites` Map)                     │
│                                                                              │
│  • saveUserSettings / saveRawList / saveFolders / saveWishlistViewState      │
│      ──► Mutiert `u_bundle_<chatId>` im RAM                                  │
│      ──► Markiert `u_bundle_<chatId>` im Dirty-Buffer (1 Key statt 4!)       │
│                                                                              │
│  • recordAndPruneWorkerActivityLog / persistAntiSpamStateToStorage           │
│      ──► Aktualisiert RAM-Liste sofort                                       │
│      ──► Reiht Key mit Zähler/Zeitstempel in den periodischen Buffer ein     │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3. SINGLE WRITE-BACK FLUSH (`flushDirtyKvBatch` via `ctx.waitUntil`)         │
│                                                                              │
│  • Prüft pro Dirty-Key: Hat sich `JSON.stringify(val)` seit dem letzten      │
│    KV-Stand geändert? Falls identisch -> Skip (0 KV-Writes).                 │
│  • Schreibt geänderte User-Bundles am Session-Ende / nach Batch-Abschluss    │
│    oder wenn das periodische Zeitfenster (>= 45s / >= 15 Mutationen) greift, │
│    in einem einzigen Write-Back nach Cloudflare KV zurück.                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Wichtige Produkt- & Architektur-Entscheidungen

1. **Negative-Caching für optionale Konfigurations-Keys (`__KV_EMPTY__`)**:
   - **Problem bisher**: Wenn `TG_CUSTOM_BOT_TOKEN`, `TG_DEFAULT_CHAT_ID` oder `tma_verified_source_channel_v1` in KV leer (`null`) waren, hat der Worker bei *jedem* API-Request erneut `kv.get(...)` aufgerufen, weil `null` nicht im RAM gecacht wurde.
   - **Lösung**: `kvGetCached` speichert auch `null`-Ergebnisse mit einem Sentinel-Eintrag im RAM. Damit sinken KV-Reads für optionale Settings nach dem ersten Request auf **0**.

2. **Konsolidierung von 4 User-Keys auf 1 `u_bundle_<chatId>`**:
   - **Problem bisher**: Beim Laden des Admin-Dashboards oder der Mini-App wurden `settings_<id>`, `user_<id>`, `folders_<id>` und `sess_<id>` einzeln gelesen und bei Playlist-/Filter-Aktionen einzeln geschrieben.
   - **Lösung**: Alle vier Strukturen leben gemeinsam in `u_bundle_<chatId> = { v: 2, updatedAt, session, settings, folders, savedList }`. Egal wie viele Änderungen an Merkliste, Ordnern, Suchstatus und Filtern während einer Session passieren: Beim Flush wird maximal **1 einziger KV-Write** für das gesamte Nutzerprofil ausgeführt.
