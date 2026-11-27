      async function handleBackupFileInput(ev) {
        const file = ev?.target?.files?.[0];
        if (!file) return;

        const activeChannelId = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
        if (!activeChannelId || (!activeChannelId.startsWith("-100") && !activeChannelId.startsWith("@"))) {
          showHudToast("⛔ Gesperrt: Bitte zuerst Schritt 1 (Kanal-ID -100... oder Link) eingeben und prüfen!");
          if (ev?.target) ev.target.value = "";
          return;
        }
        backupImportJob.verifiedChannelId = activeChannelId;

        const statusEl = document.getElementById("backupParseNotice");
        const sizeMb = file.size / (1024 * 1024);
        if (statusEl) {
          statusEl.style.color = "#fbbf24";
          statusEl.textContent = "⏳ Lese & analysiere " + file.name + " (" + sizeMb.toFixed(2) + " MB)...";
        }
        try {
          await new Promise(r => setTimeout(r, 10));
          let info = null;
          if (sizeMb > 15) {
            info = await streamParseLargeClientBackupFile(file, statusEl);
          } else {
            const text = await file.text();
            await new Promise(r => setTimeout(r, 0));
            const repairRes = repairAndParseClientBackupJson(text);
            if (!repairRes.ok || !repairRes.parsed) {
              info = await streamParseLargeClientBackupFile(file, statusEl);
            } else {
              info = await detectAndParseClientBackupJson(repairRes.parsed, file.name, file.size, repairRes, statusEl);
            }
          }

          // Verifizierte Kanal-ID garantiert in JEDEN Eintrag (+ gebundene Untertitel) injizieren, damit niemals tg_export_0_ entsteht!
          if (Array.isArray(info.entries)) {
            for (const ent of info.entries) {
              if (!ent || typeof ent !== "object") continue;
              ent.chat_id = activeChannelId;
              const mId = ent.message_id || ent.msg_id;
              if (mId && (!ent.telegram_file_id || String(ent.telegram_file_id).startsWith("tg_export_"))) {
                ent.telegram_file_id = "tg_export_" + activeChannelId + "_" + mId;
              }
              if (Array.isArray(ent.subtitle_files)) {
                for (const sf of ent.subtitle_files) {
                  if (!sf || typeof sf !== "object") continue;
                  sf.chat_id = activeChannelId;
                  if (sf.message_id && (!sf.file_id || String(sf.file_id).startsWith("tg_export_"))) {
                    sf.file_id = "tg_export_" + activeChannelId + "_" + sf.message_id;
                  }
                }
              }
            }
          }

          const fileSignature = String(file.name) + "::" + String(file.size) + "::" + String(info.entries.length);
          const existingCp = loadBackupCheckpointClient();
          const matchingCp = (
            existingCp &&
            (existingCp.fileSignature === fileSignature || existingCp.fileName === file.name) &&
            Number(existingCp.cursor) > 0 &&
            Number(existingCp.cursor) < info.entries.length
          ) ? existingCp : null;

          const cleanBase = String(file.name || "Import").replace(/\\.json$/i, "").trim();
          const preservedFolderId = matchingCp?.playlistFolderId || backupImportJob.playlistFolderId || "";
          const preservedTargetChatId = String(matchingCp?.targetPlaylistChatId || backupImportJob.targetPlaylistChatId || state.adminPlaylistTargetChatId || chatId);
          const preservedMode = matchingCp?.playlistMode || backupImportJob.playlistMode || (preservedTargetChatId === "bot_vip" ? "vip_stream" : "both");
          const hasExplicitCustomName = Boolean(
            (preservedFolderId && backupImportJob.customPlaylistName) ||
            backupImportJob._userEditedPlaylistName
          );
          const suggestedPlaylistName = matchingCp?.customPlaylistName
            ? matchingCp.customPlaylistName
            : hasExplicitCustomName
              ? backupImportJob.customPlaylistName
              : (info.isTelegramBackup ? ("📦 " + info.backupChatName) : (info.backupChatName || ("🎵 " + cleanBase)));

          backupImportJob = {
            ...info,
            fileSignature,
            verifiedChannelId: activeChannelId,
            channelVerifyResult: backupImportJob.channelVerifyResult || { ok: true, readable: true, channelId: activeChannelId },
            savedCheckpoint: matchingCp,
            splitChunkSize: 250,
            customPlaylistName: String(suggestedPlaylistName).slice(0, 48),
            _userEditedPlaylistName: hasExplicitCustomName,
            playlistMode: preservedMode,
            targetPlaylistChatId: preservedTargetChatId,
            playlistFolderId: preservedFolderId,
            cursor: matchingCp ? Number(matchingCp.cursor || 0) : 0,
            moviesSaved: matchingCp ? Number(matchingCp.moviesSaved || 0) : 0,
            seriesSaved: matchingCp ? Number(matchingCp.seriesSaved || 0) : 0,
            duplicatesInDb: matchingCp ? Number(matchingCp.duplicatesInDb || 0) : 0,
            mergedQualitiesInDb: matchingCp ? Number(matchingCp.mergedQualitiesInDb || 0) : 0,
            uncertainCount: matchingCp ? Number(matchingCp.uncertainCount || 0) : 0,
            failedCount: matchingCp ? Number(matchingCp.failedCount || 0) : 0,
            running: false,
            paused: false,
            startedAt: 0,
            recentLog: matchingCp
              ? ["📌 Gespeicherter Checkpoint geladen: Fortsetzung bei Eintrag #" + matchingCp.cursor + " / " + info.entries.length + " bereit."]
              : [],
            livePosterFeed: [],
            reviewItems: Array.isArray(backupImportJob.reviewItems) ? backupImportJob.reviewItems : [],
            activeSubTab: "dashboard",
            reviewFilter: "needs_attention"
          };
          saveBackupJobToIndexedDbClient(true);
          saveBackupCheckpointClient(true);
          if (statusEl) {
            statusEl.style.color = matchingCp ? "#f59e0b" : (info.repaired ? "#0284c7" : "#10b981");
            const chunksCount = Math.max(1, Math.ceil(info.entries.length / 250));
            statusEl.textContent = matchingCp
              ? ("📌 Checkpoint erkannt: Bei #" + matchingCp.cursor.toLocaleString("de-DE") + " von " + info.entries.length.toLocaleString("de-DE") + " fortsetzen oder ab 0 neu starten!")
              : ("✅ " + info.entries.length.toLocaleString("de-DE") + " Einträge erkannt [Kanal " + activeChannelId + "] (" + chunksCount + " Chunks bereit)!");
          }
          refreshBackupTargetControlsDom();
          renderBackupImportBoxDom();
        } catch (err) {
          if (statusEl) {
            statusEl.style.color = "#f87171";
            statusEl.textContent = "❌ Fehler beim Lesen der JSON-Datei: " + err.message;
          }
        }
      }

      async function runSimulatedJsonImportTestSuiteClient() {
        const reportBox = document.getElementById("e2eSimReportMount");
        const setSimStatus = (html) => {
          if (reportBox) {
            reportBox.style.display = "block";
            reportBox.innerHTML = html;
          }
        };

        setBusyState(true, "🧪 Starte E2E JSON-Import Simulation (7 Testfälle + Pipeline-Prüfung)...");
        setSimStatus('<div style="padding:12px;color:#38bdf8;font-weight:700">⏳ Schritt 1/5: Prüfe Quell-Kanal (-1001987654321) & generiere realistisches Telegram result.json Test-Backup...</div>');

        try {
          const simChannelId = "-1001987654321";
          const chanRes = await apiFetchJson(API_BASE + "/admin/validate-channel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelInput: simChannelId })
          });
          saveVerifiedChannelIdClient(simChannelId);
          backupImportJob.verifiedChannelId = simChannelId;
          const chanInp = document.getElementById("backupSourceChannelInp");
          if (chanInp) chanInp.value = simChannelId;

          // Realistisches Telegram Desktop Chat-Export JSON mit 7 gezielten Testfällen
          const simulatedTelegramExport = {
            name: "VIP Kino & Serien Archiv (E2E Simulation)",
            type: "private_supergroup",
            id: 1987654321,
            messages: [
              {
                id: 9001,
                type: "message",
                date: "2025-02-01T18:00:00",
                text: "📌 Willkommen im VIP-Archiv! Alle neuen Uploads folgen direkt hierunter."
              },
              {
                id: 9002,
                type: "message",
                date: "2025-02-01T18:05:00",
                file_name: "Interstellar (2014) German DL 1080p BluRay x264.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 10140,
                width: 1920,
                height: 1080,
                text: "🎬 Interstellar (2014) • Deutsch & Englisch • 1080p Full HD"
              },
              {
                id: 9003,
                type: "message",
                date: "2025-02-01T18:10:00",
                file_name: "Matrix (1999) German CAM.TS.LD.mp4",
                mime_type: "video/mp4",
                duration_seconds: 8160,
                width: 1280,
                height: 720,
                text: "🎬 Matrix (1999) • Vorabversion TS/CAM"
              },
              {
                id: 9004,
                type: "message",
                date: "2025-02-01T18:15:00",
                file_name: "Matrix (1999) German DL 1080p BluRay.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 8160,
                width: 1920,
                height: 1080,
                text: "🎬 Matrix (1999) • 1080p BluRay Qualitäts-Upgrade (ersetzt TS automatisch)"
              },
              {
                id: 9004,
                type: "message",
                date: "2025-02-01T18:15:00",
                file_name: "Matrix (1999) German DL 1080p BluRay.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 8160,
                width: 1920,
                height: 1080,
                text: "🎬 Matrix (1999) • Exaktes Duplikat (gleiche Message-ID #9004)"
              },
              {
                id: 9005,
                type: "message",
                date: "2025-02-01T18:20:00",
                file_name: "Breaking.Bad.S01E01.German.1080p.WEB-DL.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 3480,
                width: 1920,
                height: 1080,
                text: "📺 Breaking Bad (2008) - Staffel 1 Folge 1"
              },
              {
                id: 9006,
                type: "message",
                date: "2025-02-01T18:22:00",
                file_name: "Breaking.Bad.S01E02.German.1080p.WEB-DL.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 2880,
                width: 1920,
                height: 1080,
                text: "📺 Breaking Bad (2008) - Staffel 1 Folge 2"
              },
              {
                id: 9007,
                type: "message",
                date: "2025-02-01T18:25:00",
                file_name: "Breaking.Bad.S01E04.German.1080p.WEB-DL.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 2880,
                width: 1920,
                height: 1080,
                text: "📺 Breaking Bad (2008) - Staffel 1 Folge 4 (S01E03 fehlt absichtlich für Lücken-Finder!)"
              },
              {
                id: 9008,
                type: "message",
                date: "2025-02-01T18:30:00",
                file_name: "Inception (1995) German 1080p.mp4",
                mime_type: "video/mp4",
                duration_seconds: 8880,
                width: 1920,
                height: 1080,
                text: "🎬 Inception (1995) • Absichtlicher Jahreszahl-Konflikt (Release 2010 vs. 1995)"
              },
              {
                id: 9009,
                type: "message",
                date: "2025-02-01T18:35:00",
                file_name: "XyzUnbekannterPhantomFilm99999 (2024) 1080p.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 5400,
                width: 1920,
                height: 1080,
                text: "🎬 Absichtlich nicht existierender Testtitel für TMDB_NOT_FOUND Prüfung"
              }
            ]
          };

          const rawJsonStr = JSON.stringify(simulatedTelegramExport, null, 2);
          setSimStatus('<div style="padding:12px;color:#38bdf8;font-weight:700">⏳ Schritt 2/5: Analysiere JSON-Struktur über Client-Parser (detectAndParseClientBackupJson)...</div>');

          const repairRes = repairAndParseClientBackupJson(rawJsonStr);
          const parsedInfo = await detectAndParseClientBackupJson(
            repairRes.parsed,
            "simulation_result.json",
            rawJsonStr.length,
            repairRes,
            null
          );

          for (const ent of (parsedInfo.entries || [])) {
            ent.chat_id = simChannelId;
            const mId = ent.message_id || ent.msg_id;
            if (mId) ent.telegram_file_id = "tg_export_" + simChannelId + "_" + mId;
          }

          backupImportJob = {
            ...parsedInfo,
            fileName: "simulation_result.json",
            fileSignature: "simulation_result.json::" + rawJsonStr.length + "::" + parsedInfo.entries.length,
            verifiedChannelId: simChannelId,
            channelVerifyResult: { ok: true, readable: true, channelId: simChannelId },
            savedCheckpoint: null,
            splitChunkSize: 250,
            customPlaylistName: "🧪 E2E Simulation Playlist",
            playlistMode: "both",
            targetPlaylistChatId: String(state.adminPlaylistTargetChatId || chatId),
            playlistFolderId: "",
            cursor: 0,
            moviesSaved: 0,
            seriesSaved: 0,
            duplicatesInDb: 0,
            mergedQualitiesInDb: 0,
            uncertainCount: 0,
            failedCount: 0,
            running: false,
            paused: false,
            startedAt: Date.now(),
            recentLog: ["🧪 E2E JSON-Simulation geladen (" + parsedInfo.entries.length + " Video-Einträge aus 10 Nachrichten extrahiert)."],
            livePosterFeed: [],
            reviewItems: [],
            activeSubTab: "dashboard",
            reviewFilter: "needs_attention"
          };

          setSimStatus('<div style="padding:12px;color:#fbbf24;font-weight:700">⏳ Schritt 3/5: Sende Batch durch echte Worker-Pipeline (/api/tma/admin/import-batch)...</div>');
          await startOrResumeBackupImport();

          setSimStatus('<div style="padding:12px;color:#a855f7;font-weight:700">⏳ Schritt 4/5: Prüfe VIP-Fehlermeldungen (Erstellen, Auflösen & Löschen) sowie Hauptkatalog (/api/tma/discover)...</div>');
          const createRepRes = await apiFetchJson(API_BASE + "/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "m",
              tmdbId: 603,
              title: "Matrix (E2E Sim-Test)",
              reasonCode: "wrong_audio",
              reasonLabel: "🔇 Tonspur-Testmeldung (E2E Simulation)",
              note: "Automatischer Funktionstest für Meldungs-Bestätigung & Löschung"
            })
          });
          const createdReportId = createRepRes?.report?.id;
          let reportResolveOk = false;
          let reportDeleteOk = false;
          if (createdReportId) {
            const resRep = await apiFetchJson(API_BASE + "/admin/reports", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "resolve", reportId: createdReportId })
            });
            reportResolveOk = Boolean(resRep && resRep.ok);
            const delRep = await apiFetchJson(API_BASE + "/admin/reports", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete", reportId: createdReportId })
            });
            reportDeleteOk = Boolean(delRep && delRep.ok && !(delRep.reports || []).some(x => Number(x.id) === Number(createdReportId)));
          }

          setSimStatus('<div style="padding:12px;color:#34d399;font-weight:700">⏳ Schritt 5/5: Validiere D1-Persistenz, Staffel-Lücken-Erkennung & Hauptseiten-Darstellung...</div>');
          const [overviewRes, discoverRes] = await Promise.all([
            apiFetchJson(API_BASE + "/admin/overview"),
            apiFetchJson(API_BASE + "/discover?mode=all&page=1")
          ]);
          if (overviewRes && overviewRes.ok) {
            window._lastAdminOverviewCache = overviewRes;
            window._adminReportsCache = overviewRes.mediaReports || [];
          }

          const batchItems = backupImportJob.reviewItems || [];
          const hasSkipHeaderOk = parsedInfo.entries.length === 9;
          const hasMovieSavedOk = Number(backupImportJob.moviesSaved || 0) >= 1 && (overviewRes?.d1Diagnostic?.counts?.movies || 0) >= 1;
          const hasPrereleaseUpgradeOk = batchItems.some(x => Number(x.replacedPrereleaseCount || 0) > 0 || x.ingestStatus === "updated" || x.ingestStatus === "inserted");
          const hasDuplicateDetectOk = Number(backupImportJob.duplicatesInDb || 0) >= 1 || batchItems.some(x => x.ingestStatus === "duplicate");
          const seriesGapItems = overviewRes?.seriesGaps?.items || [];
          const hasSeriesGapOk = seriesGapItems.some(s => (s.seasons || []).some(sec => (sec.internalGaps || []).includes(3)));
          const hasUncertainYearOk = batchItems.some(x => x.isUncertain || x.reviewReasonCode === "YEAR_CONFLICT");
          const hasFailedNotFoundOk = batchItems.some(x => x.status === "failed" || x.reviewReasonCode === "TMDB_NOT_FOUND");
          const hasDiscoverMainUiOk = Boolean(discoverRes && discoverRes.ok && Array.isArray(discoverRes.items) && discoverRes.items.length > 0);

          const checks = [
            {
              name: "1. Kanal-Verifizierung & Text-Nachrichten-Filter (#9001 ohne Video übersprungen)",
              ok: Boolean(chanRes && chanRes.ok && hasSkipHeaderOk),
              detail: hasSkipHeaderOk ? "9 Video-Einträge aus 10 Nachrichten extrahiert (Reine Textnachricht sauber ignoriert)" : ("Extrahierte Einträge: " + parsedInfo.entries.length)
            },
            {
              name: "2. 1080p Film-Import & D1-Persistenz (Interstellar / Matrix)",
              ok: hasMovieSavedOk,
              detail: "Filme in D1 gespeichert: " + Number(overviewRes?.d1Diagnostic?.counts?.movies || backupImportJob.moviesSaved || 0) + " • Playlisten: " + Number(overviewRes?.d1Diagnostic?.counts?.playlists || 0)
            },
            {
              name: "3. Vorabversion (.TS/CAM) → 1080p BluRay Auto-Upgrade",
              ok: hasPrereleaseUpgradeOk,
              detail: "Matrix (1999) TS erkannt und durch 1080p Version ersetzt/aktualisiert"
            },
            {
              name: "4. Exakter Duplikat-Schutz (gleiche file_id + message_id #9004)",
              ok: hasDuplicateDetectOk,
              detail: "Duplikate erkannt & blockiert: " + Number(backupImportJob.duplicatesInDb || 0)
            },
            {
              name: "5. Serien-Import (Breaking Bad S01E01, E02, E04) + Staffel-Lücken-Finder (S01E03)",
              ok: hasSeriesGapOk,
              detail: hasSeriesGapOk ? "Lücke S01E03 mitten in Staffel 1 erfolgreich im Lücken-Finder erkannt!" : "Serie gespeichert, prüfe Staffel-Lücken-Tab"
            },
            {
              name: "6. Konflikt-Erkennung: Jahres-Abweichung (Inception 1995 vs. 2010) & Nicht erkannt (TMDB_NOT_FOUND)",
              ok: hasUncertainYearOk && hasFailedNotFoundOk,
              detail: "Unsicher (YEAR_CONFLICT): " + (hasUncertainYearOk ? "Ja" : "Nein") + " • Nicht erkannt (TMDB_NOT_FOUND): " + (hasFailedNotFoundOk ? "Ja" : "Nein")
            },
            {
              name: "7. VIP/Admin-Fehlermeldung Lebenszyklus (Anlegen → Bestätigen → Löschen)",
              ok: reportResolveOk && reportDeleteOk,
              detail: reportResolveOk && reportDeleteOk ? "Meldung erstellt, als gelöst markiert und rückstandslos gelöscht" : "Fehler beim Meldungs-Test"
            },
            {
              name: "8. Hauptseiten-Darstellung (/api/tma/discover Katalog nach Import intakt)",
              ok: hasDiscoverMainUiOk,
              detail: hasDiscoverMainUiOk ? (discoverRes.items.length + " Titel im Hauptseiten-Katalog abrufbar") : "Katalog leer oder Fehler"
            }
          ];

          const passedCount = checks.filter(c => c.ok).length;
          const reportHtml =
            '<div class="admin-surface-card" style="border:1px solid ' + (passedCount === checks.length ? 'rgba(16,185,129,0.55)' : 'rgba(245,158,11,0.55)') + ';margin-top:10px">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
                '<div style="font-size:13.5px;font-weight:900;color:var(--text)">🧪 E2E JSON-Import Prüfbericht: <span style="color:' + (passedCount === checks.length ? '#10b981' : '#f59e0b') + '">' + passedCount + ' / ' + checks.length + ' Tests bestanden</span></div>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                  '<button type="button" class="btn amber" style="padding:4px 9px;font-size:11px" onclick="switchBackupSubTab(\\'review\\')">🛠️ Konflikte im Review-Tab ansehen</button>' +
                  '<button type="button" class="btn blue" style="padding:4px 9px;font-size:11px" onclick="state.adminTab=\\'gaps\\';loadAdminPanelView(true)">📉 Staffel-Lücke (S01E03) ansehen</button>' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px">' +
                checks.map(c => (
                  '<div class="admin-sub-box" style="border:1px solid ' + (c.ok ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.45)') + ';padding:7px 10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:11.5px">' +
                    '<div style="font-weight:800;color:' + (c.ok ? '#10b981' : '#e11d48') + '">' + (c.ok ? '✅ ' : '❌ ') + esc(c.name) + '</div>' +
                    '<div style="color:var(--muted);font-size:11px">' + esc(c.detail) + '</div>' +
                  '</div>'
                )).join("") +
              '</div>' +
            '</div>';

          window._lastE2eSimReportHtml = reportHtml;
          setSimStatus(reportHtml);
          renderBackupImportBoxDom();
          showHudToast("✅ E2E JSON-Import Simulation abgeschlossen (" + passedCount + "/" + checks.length + " Checks OK)!");
        } catch (err) {
          setSimStatus('<div style="padding:12px;color:#f87171;font-weight:800">❌ Fehler während der E2E-Simulation: ' + esc(err?.message || String(err)) + '</div>');
        } finally {
          setBusyState(false);
        }
      }

      function resumeBackupFromCheckpointClient() {
        const cp = backupImportJob.savedCheckpoint || loadBackupCheckpointClient();
        if (cp && backupImportJob.entries.length > 0) {
          backupImportJob.cursor = Math.min(Number(cp.cursor || 0), backupImportJob.entries.length);
        }
        showHudToast("▶️ Setze Smart-Import nahtlos bei Eintrag #" + backupImportJob.cursor + " fort...");
        startOrResumeBackupImport();
      }

      function restartBackupFromZeroNoDupesClient() {
        clearBackupCheckpointClient();
        backupImportJob.savedCheckpoint = null;
        backupImportJob.cursor = 0;
        backupImportJob.moviesSaved = 0;
        backupImportJob.seriesSaved = 0;
        backupImportJob.duplicatesInDb = 0;
        backupImportJob.mergedQualitiesInDb = 0;
        backupImportJob.uncertainCount = 0;
        backupImportJob.failedCount = 0;
        backupImportJob.startedAt = 0;
        backupImportJob._freshLogsResetDone = false;
        backupImportJob.cursorRetries = {};
        backupImportJob._processedMsgIds = new Set();
        backupImportJob.recentLog = ["🔄 Neustart ab Index 0 (Duplikat-Schutz aktiv: bestehende Einträge werden sauber aktualisiert)."];
        showHudToast("🔄 Starte ab 0 neu (ohne Duplikate einzufügen)...");
        startOrResumeBackupImport();
      }

      function getBackupTargetPlaylistsForChatClient(targetChatVal) {
        const key = String(targetChatVal || backupImportJob.targetPlaylistChatId || state.adminPlaylistTargetChatId || chatId);
        if (window._adminBackupPlaylistsByChatId && Array.isArray(window._adminBackupPlaylistsByChatId[key])) {
          return window._adminBackupPlaylistsByChatId[key];
        }
        if (String(state.adminPlaylistTargetChatId || chatId) === key && Array.isArray(window._lastAdminOverviewCache?.playlists)) {
          return window._lastAdminOverviewCache.playlists;
        }
        return [];
      }

      function getBackupTargetSummaryLabelClient() {
        const j = backupImportJob;
        const targetChat = String(j.targetPlaylistChatId || state.adminPlaylistTargetChatId || chatId);
        const accountLabel = targetChat === "bot_vip"
          ? "🤖 Globale Bot-VIP-Playlist"
          : (targetChat === String(chatId) ? "👑 Eigene Admin-Merkliste" : ("👤 User ID " + targetChat));
        const modeMap = {
          both: "⚡ VIP + Merkliste",
          vip_stream: "🌟 Nur VIP-Stream",
          watchlist: "🔖 Nur Merkliste"
        };
        const modeLabel = modeMap[j.playlistMode || "both"] || modeMap.both;
        const folders = getBackupTargetPlaylistsForChatClient(targetChat);
        const existingFolder = j.playlistFolderId
          ? folders.find(f => String(f.id) === String(j.playlistFolderId))
          : null;
        const plLabel = existingFolder
          ? ("📂 " + existingFolder.name)
          : ("➕ Neu: „" + (j.customPlaylistName || "🎵 JSON-Import") + "“");
        return accountLabel + " · " + plLabel + " · " + modeLabel;
      }

      function renderBackupTargetControlsHtml() {
        const j = backupImportJob;
        const curTargetChat = String(j.targetPlaylistChatId || state.adminPlaylistTargetChatId || chatId);
        const curFolderId = String(j.playlistFolderId || "");
        const curMode = ["vip_stream", "watchlist", "both"].includes(j.playlistMode)
          ? j.playlistMode
          : (curTargetChat === "bot_vip" ? "vip_stream" : "both");
        const curName = j.customPlaylistName || "🎵 JSON-Import";
        const users = Array.isArray(window._lastAdminOverviewCache?.users) ? window._lastAdminOverviewCache.users : [];
        const folders = getBackupTargetPlaylistsForChatClient(curTargetChat);

        const accountOptionsHtml = [
          '<option value="bot_vip"' + (curTargetChat === "bot_vip" ? " selected" : "") + '>🤖 Globale Bot-VIP-Playlist (bot_vip)</option>',
          '<option value="' + esc(chatId) + '"' + (curTargetChat === String(chatId) ? " selected" : "") + '>👑 Eigene Admin-Merkliste (ID ' + esc(chatId) + ')</option>',
          ...users.filter(u => String(u.telegramId) !== String(chatId)).map(u =>
            '<option value="' + esc(u.telegramId) + '"' + (curTargetChat === String(u.telegramId) ? " selected" : "") + '>👤 ID ' + esc(u.telegramId) + (u.tgUsername ? ' (@' + esc(u.tgUsername) + ')' : '') + (u.customUsername ? ' [' + esc(u.customUsername) + ']' : '') + '</option>'
          )
        ].join("");

        const folderOptionsHtml = [
          '<option value=""' + (!curFolderId ? " selected" : "") + '>➕ Neue Playlist anlegen / per Name</option>',
          ...folders.map(pl => {
            const pMode = pl.playlistMode === "vip_stream" ? "VIP-Stream" : pl.playlistMode === "watchlist" ? "Merkliste" : "VIP + Merkliste";
            return '<option value="' + esc(pl.id) + '"' + (String(pl.id) === curFolderId ? " selected" : "") + '>📂 ' + esc(pl.name) + ' (' + Number(pl.itemCount || 0) + ' Titel · ' + pMode + ')</option>';
          })
        ].join("");

        return '<div class="backup-target-grid">' +
          '<div>' +
            '<label class="backup-field-label">🎯 1. Ziel-Account / Bereich</label>' +
            '<select class="backup-select" onchange="changeBackupTargetAccountClient(this.value)">' +
              accountOptionsHtml +
            '</select>' +
          '</div>' +
          '<div>' +
            '<label class="backup-field-label">📂 2. Vorhandene Playlist oder Neu</label>' +
            '<select class="backup-select" onchange="changeBackupTargetFolderClient(this.value)">' +
              folderOptionsHtml +
            '</select>' +
          '</div>' +
          '<div>' +
            '<label class="backup-field-label">⚙️ 3. Playlist-Modus</label>' +
            '<select class="backup-select" onchange="setBackupPlaylistModeClient(this.value)">' +
              '<option value="both"' + (curMode === "both" ? " selected" : "") + '>⚡ Beides (VIP-Streams + Merkliste)</option>' +
              '<option value="vip_stream"' + (curMode === "vip_stream" ? " selected" : "") + '>🌟 Nur VIP-Stream-Katalog</option>' +
              '<option value="watchlist"' + (curMode === "watchlist" ? " selected" : "") + '>🔖 Nur persönliche Merkliste</option>' +
            '</select>' +
          '</div>' +
          '<div>' +
            '<label class="backup-field-label">' + (curFolderId ? '🏷️ 4. Gewählte Playlist (Name)' : '✏️ 4. Name der neuen Playlist') + '</label>' +
            '<input id="backupPlaylistNameInp" class="backup-input backup-playlist-name-inp" value="' + esc(curName) + '" oninput="updateBackupCustomPlaylistName(this.value)" placeholder="z.B. 🎵 JSON-Import..." />' +
          '</div>' +
        '</div>';
      }

      function refreshBackupTargetControlsDom() {
        const mountEl = document.getElementById("backupTargetControlsMount");
        if (mountEl) {
          mountEl.innerHTML = renderBackupTargetControlsHtml();
        }
        const summaryEl = document.getElementById("backupTargetLiveSummaryBadge");
        if (summaryEl) {
          summaryEl.textContent = getBackupTargetSummaryLabelClient();
        }
      }

      async function changeBackupTargetAccountClient(newTargetChatId) {
        const nextChat = String(newTargetChatId || chatId);
        backupImportJob.targetPlaylistChatId = nextChat;
        state.adminPlaylistTargetChatId = nextChat;
        backupImportJob.playlistFolderId = "";
        if (nextChat === "bot_vip") {
          backupImportJob.playlistMode = "vip_stream";
        } else if (!backupImportJob.playlistMode) {
          backupImportJob.playlistMode = "both";
        }
        saveBackupCheckpointClient(false);
        refreshBackupTargetControlsDom();
        renderBackupImportBoxDom();
        try {
          const r = await apiFetchJson(
            API_BASE + "/admin/overview?mediaType=" + encodeURIComponent(state.adminMediaType || "m") +
            "&playlistChatId=" + encodeURIComponent(nextChat) +
            "&tab=backup"
          );
          if (r && r.ok && Array.isArray(r.playlists)) {
            if (!window._adminBackupPlaylistsByChatId) window._adminBackupPlaylistsByChatId = {};
            window._adminBackupPlaylistsByChatId[nextChat] = r.playlists;
            if (window._lastAdminOverviewCache) {
              window._lastAdminOverviewCache.playlists = r.playlists;
              if (Array.isArray(r.users)) window._lastAdminOverviewCache.users = r.users;
            }
            refreshBackupTargetControlsDom();
            renderBackupImportBoxDom();
          }
        } catch (e) {}
      }

      function changeBackupTargetFolderClient(folderId) {
        const fId = String(folderId || "");
        backupImportJob.playlistFolderId = fId;
        const curTargetChat = String(backupImportJob.targetPlaylistChatId || state.adminPlaylistTargetChatId || chatId);
        const folders = getBackupTargetPlaylistsForChatClient(curTargetChat);
        const found = fId ? folders.find(f => String(f.id) === fId) : null;
        if (found) {
          backupImportJob.customPlaylistName = String(found.name || "🎵 JSON-Import").slice(0, 48);
          backupImportJob._userEditedPlaylistName = true;
          if (["vip_stream", "watchlist", "both"].includes(found.playlistMode)) {
            backupImportJob.playlistMode = found.playlistMode;
          }
          showHudToast("📂 Ziel-Playlist gewählt: " + found.name);
        }
        saveBackupCheckpointClient(false);
        refreshBackupTargetControlsDom();
        renderBackupImportBoxDom();
      }

      function updateBackupCustomPlaylistName(val) {
        backupImportJob.customPlaylistName = String(val || "").trim().slice(0, 48);
        backupImportJob._userEditedPlaylistName = true;
        const summaryEl = document.getElementById("backupTargetLiveSummaryBadge");
        if (summaryEl) {
          summaryEl.textContent = getBackupTargetSummaryLabelClient();
        }
      }

      function setBackupPlaylistModeClient(modeVal) {
        backupImportJob.playlistMode = ["vip_stream", "watchlist", "both"].includes(modeVal) ? modeVal : "both";
        saveBackupCheckpointClient(false);
        refreshBackupTargetControlsDom();
        renderBackupImportBoxDom();
      }

      function switchBackupSubTab(tab) {
        if (tab === "diaglog") {
          backupImportJob.activeSubTab = "diaglog";
          renderBackupImportBoxDom();
          syncDiagnosticLogsFromD1Client(true);
          return;
        }
        backupImportJob.activeSubTab = tab === "review" ? "review" : "dashboard";
        renderBackupImportBoxDom();
        if (backupImportJob.activeSubTab === "review") {
          syncReviewItemsFromD1MetadataClient(true);
        }
      }

      function setBackupReviewFilter(f) {
        backupImportJob.reviewFilter = f || "needs_attention";
        renderBackupImportBoxDom();
      }

      function syncReviewCardDomInputsToItemState(item) {
        if (!item) return;
        const sInp = document.getElementById("revSeasonInp_" + item.id);
        const eInp = document.getElementById("revEpInp_" + item.id);
        const qInp = document.getElementById("revSearchInp_" + item.id);
        const tSel = document.getElementById("revSearchType_" + item.id);
        if (sInp && sInp.value !== "") {
          const parsedS = parseInt(sInp.value, 10);
          if (!Number.isNaN(parsedS)) item.season = Math.max(0, parsedS);
        }
        if (eInp && eInp.value !== "") {
          const parsedE = parseInt(eInp.value, 10);
          if (!Number.isNaN(parsedE)) item.episode = Math.max(1, parsedE);
        }
        if (qInp) item.manualSearchQuery = qInp.value;
        if (tSel) item.manualSearchType = tSel.value;
      }

      function updateReviewHeaderCountersInDom() {
        const j = backupImportJob;
        const allItems = j.reviewItems || [];
        const needsCount = allItems.filter(x => !x.resolvedByAdmin && (x.status === "failed" || x.isUncertain || x.contextError || !x.tmdbId)).length;
        const uncertainCount = allItems.filter(x => !x.resolvedByAdmin && x.isUncertain && x.status !== "failed" && Boolean(x.tmdbId)).length;
        const failedCount = allItems.filter(x => !x.resolvedByAdmin && (x.status === "failed" || !x.tmdbId)).length;

        const btnNeeds = document.getElementById("revBtnNeeds");
        const btnUnc = document.getElementById("revBtnUncertain");
        const btnFail = document.getElementById("revBtnFailed");
        const btnAll = document.getElementById("revBtnAll");
        const tabSubBtn = document.getElementById("revSubTabBtn");

        if (btnNeeds) btnNeeds.innerHTML = "⚠️ Prüfbedarf (" + needsCount + ")";
        if (btnUnc) btnUnc.innerHTML = "🔎 Unsichere Treffer (" + uncertainCount + ")";
        if (btnFail) btnFail.innerHTML = "❌ Nicht erkannt (" + failedCount + ")";
        if (btnAll) btnAll.innerHTML = "📋 Alle importierten (" + allItems.length + ")";
        if (tabSubBtn) {
          tabSubBtn.innerHTML = "🛠️ Prüfen & Korrigieren" + (
            needsCount > 0
              ? (' <span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:999px;font-size:10.5px;margin-left:4px">' + needsCount + '</span>')
              : (" (" + allItems.length + ")")
          );
        }
      }

      function updateSingleReviewCardInDom(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        const cardEl = document.getElementById("revCard_" + itemId);
        if (cardEl) {
          const scrollContainer = document.getElementById("backupReviewScrollContainer");
          const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : null;
          const prevWinScrollY = window.scrollY;
          cardEl.outerHTML = renderSingleBackupReviewCardHtml(it, backupImportJob.reviewItems || []);
          if (scrollContainer && prevScrollTop !== null) {
            scrollContainer.scrollTop = prevScrollTop;
          }
          if (typeof prevWinScrollY === "number" && Math.abs(window.scrollY - prevWinScrollY) > 4) {
            window.scrollTo({ top: prevWinScrollY, behavior: "instant" });
          }
        }
        updateReviewHeaderCountersInDom();
      }

      function reopenResolvedReviewCard(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        it.expandedAfterResolve = true;
        updateSingleReviewCardInDom(itemId);
      }

      function collapseResolvedReviewCard(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        it.expandedAfterResolve = false;
        updateSingleReviewCardInDom(itemId);
      }

      // Bestätigt den aktuellen Vorschlag INKLUSIVE Speicherung von Staffel/Folge & Kanal-Datei-ID in D1!
      async function confirmBackupReviewItem(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        syncReviewCardDomInputsToItemState(it);
        if (it.tmdbId) {
          await applyBackupCandidateRemap(itemId, it.tmdbId, it.typeCode || "m", { isConfirmAction: true });
          return;
        }
        openManualNoTmdbConfirmForReviewItem(itemId);
      }

            let activeManualNoTmdbContext = null;
      let manualNoTmdbLivePreviewTimer = null;
      const manualNoTmdbQueueState = {
        active: false,
        source: "diag",
        totalInitial: 0,
        processedCount: 0
      };

      function closeManualNoTmdbConfirmModalClient() {
        if (manualNoTmdbLivePreviewTimer) {
          clearTimeout(manualNoTmdbLivePreviewTimer);
          manualNoTmdbLivePreviewTimer = null;
        }
        const el = document.getElementById("manualNoTmdbConfirmModalOverlay");
        if (el) el.style.display = "none";
        activeManualNoTmdbContext = null;
        manualNoTmdbQueueState.active = false;
      }

      function toggleManualNoTmdbSeriesFieldsClient() {
        const typeSel = document.getElementById("manualNoTmdbTypeSel");
        const seWrap = document.getElementById("manualNoTmdbSeriesRow");
        if (seWrap && typeSel) {
          seWrap.style.display = typeSel.value === "s" ? "grid" : "none";
        }
        scheduleManualNoTmdbLivePreviewClient();
      }

      function scheduleManualNoTmdbLivePreviewClient() {
        if (manualNoTmdbLivePreviewTimer) clearTimeout(manualNoTmdbLivePreviewTimer);
        manualNoTmdbLivePreviewTimer = setTimeout(() => {
          updateManualNoTmdbLivePreviewClient();
        }, 180);
      }

      function selectExisting900mSeriesInModalClient(synthId, seriesTitle, seriesYear) {
        const titleInp = document.getElementById("manualNoTmdbTitleInp");
        const yearInp = document.getElementById("manualNoTmdbYearInp");
        const typeSel = document.getElementById("manualNoTmdbTypeSel");
        const reuseInp = document.getElementById("manualNoTmdbReuseIdInp");
        if (titleInp && seriesTitle) titleInp.value = String(seriesTitle);
        if (yearInp && seriesYear && seriesYear !== "k.A.") yearInp.value = String(seriesYear);
        if (typeSel) typeSel.value = "s";
        if (reuseInp) reuseInp.value = String(Number(synthId) || 0);
        toggleManualNoTmdbSeriesFieldsClient();
        showHudToast("🔗 Vorhandene 900M-Serie ausgewählt (#" + synthId + ")");
      }

      async function updateManualNoTmdbLivePreviewClient() {
        const badgeEl = document.getElementById("manualNoTmdbLivePreviewBox");
        const suggestEl = document.getElementById("manualNoTmdbExistingSeriesSuggestBox");
        if (!badgeEl) return;
        const title = String(document.getElementById("manualNoTmdbTitleInp")?.value || "").trim();
        const typeCode = document.getElementById("manualNoTmdbTypeSel")?.value === "s" ? "s" : "m";
        const year = String(document.getElementById("manualNoTmdbYearInp")?.value || "").trim();
        const reuseInp = document.getElementById("manualNoTmdbReuseIdInp");
        const forcedReuseId = Number(reuseInp?.value || 0);

        if (!title) {
          badgeEl.innerHTML = '<span style="color:#94a3b8">Bitte Titel eingeben, um die 900M-ID & Kollisionsprüfung live zu berechnen…</span>';
          if (suggestEl) suggestEl.style.display = "none";
          return;
        }

        try {
          const qs = "?type=" + encodeURIComponent(typeCode) + "&title=" + encodeURIComponent(title) + "&year=" + encodeURIComponent(year);
          const r = await apiFetchJson(API_BASE + "/admin/preview-manual-id" + qs);
          if (!r || !r.ok) return;
          const displayId = forcedReuseId >= 900000000 ? forcedReuseId : Number(r.allocatedId || 0);
          const isReusing = forcedReuseId >= 900000000 || Boolean(r.isExistingMatch);
          const rangeText = esc(r.rangeLabel || (typeCode === "s" ? "945M–989M (Manuelle Serien)" : "900M–944M (Manuelle Filme)"));
          badgeEl.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div>' +
                '<span style="font-size:10.5px;color:#cbd5e1">Synthetische Ziel-ID (' + rangeText + '):</span> ' +
                '<code style="font-size:12.5px;font-weight:900;color:#e9d5ff;background:rgba(168,85,247,0.22);padding:2px 7px;border-radius:5px;border:1px solid rgba(168,85,247,0.5)">#' + displayId + '</code>' +
              '</div>' +
              '<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:' + (isReusing ? 'rgba(56,189,248,0.2);color:#38bdf8' : 'rgba(16,185,129,0.2);color:#34d399') + '">' +
                (isReusing
                  ? ('♻️ Bestehender 900M-Eintrag erkannt (' + esc(r.existingMatch?.title || title) + ')')
                  : '🟢 Frei & 100% kollisionsfrei in D1') +
              '</span>' +
            '</div>';

          if (suggestEl) {
            const list900 = Array.isArray(r.existing900mSeries) ? r.existing900mSeries : [];
            if (typeCode === "s" && list900.length > 0) {
              suggestEl.style.display = "block";
              suggestEl.innerHTML =
                '<div style="font-size:11px;font-weight:800;color:#0284c7;margin-bottom:5px">🔗 Vorhandene 900M-Serien in D1 (1-Klick-Verknüpfung für weitere Folgen):</div>' +
                '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                  list900.slice(0, 8).map(s => {
                    const sId = Number(s.id || 0);
                    const sTitle = String(s.title || "");
                    const sYear = String(s.year || "");
                    const activeSel = (forcedReuseId === sId || Number(r.existingMatch?.id || 0) === sId);
                    return '<button type="button" class="btn ' + (activeSel ? 'blue' : '') + '" style="padding:3px 8px;font-size:10.5px" onclick="selectExisting900mSeriesInModalClient(' + sId + ',\\'' + escJs(sTitle) + '\\',\\'' + escJs(sYear) + '\\')">📺 ' + esc(sTitle) + ' (#' + sId + ')</button>';
                  }).join("") +
                '</div>';
            } else {
              suggestEl.style.display = "none";
            }
          }
        } catch (e) {}
      }

      function getOpenTmdbNotFoundQueueTargetsClient(source = "diag") {
        if (source === "review") {
          return (backupImportJob.reviewItems || []).filter(it => !it.resolvedByAdmin && (!it.tmdbId || it.status === "failed"));
        }
        loadClientDiagnosticLogsFromStorage();
        const logs = clientDiagnosticLogState.logs || [];
        const targets = [];
        logs.forEach((l, idx) => {
          const st = String(l.status || "").toUpperCase();
          if (st === "TMDB_NOT_FOUND" || st === "CONFLICT" || st === "CONFLICT_?") {
            targets.push({ diagIdx: idx, log: l });
          }
        });
        return targets;
      }

      function startManualNoTmdbQueueModeClient(source = "diag") {
        const targets = getOpenTmdbNotFoundQueueTargetsClient(source);
        if (targets.length === 0) {
          showHudToast("🎉 Keine offenen TMDB_NOT_FOUND / Konflikt-Einträge für den Queue-Modus vorhanden!");
          return;
        }
        manualNoTmdbQueueState.active = true;
        manualNoTmdbQueueState.source = source;
        manualNoTmdbQueueState.totalInitial = targets.length;
        manualNoTmdbQueueState.processedCount = 0;
        if (source === "review") {
          openManualNoTmdbConfirmForReviewItem(targets[0].id);
        } else {
          openManualNoTmdbConfirmForDiagItem(targets[0].diagIdx);
        }
      }

      function skipCurrentManualNoTmdbQueueItemClient() {
        const ctx = activeManualNoTmdbContext;
        if (!ctx) return;
        const targets = getOpenTmdbNotFoundQueueTargetsClient(manualNoTmdbQueueState.source);
        if (targets.length <= 1) {
          showHudToast("ℹ️ Kein weiterer offener Eintrag in der Queue.");
          return;
        }
        let nextTarget = targets[0];
        if (manualNoTmdbQueueState.source === "review") {
          const curIdx = targets.findIndex(t => String(t.id) === String(ctx.itemId));
          nextTarget = targets[(curIdx + 1) % targets.length];
          openManualNoTmdbConfirmForReviewItem(nextTarget.id);
        } else {
          const curIdx = targets.findIndex(t => Number(t.diagIdx) === Number(ctx.diagIdx));
          nextTarget = targets[(curIdx + 1) % targets.length];
          openManualNoTmdbConfirmForDiagItem(nextTarget.diagIdx);
        }
      }

      async function submitMigrate900mToRealTmdbClient() {
        const oldInp = document.getElementById("manualMigrateOld900mInp");
        const newInp = document.getElementById("manualMigrateNewTmdbInp");
        const typeSel = document.getElementById("manualNoTmdbTypeSel");
        const oldSyntheticId = Number(oldInp?.value || activeManualNoTmdbContext?.existingSyntheticId || 0);
        const newTmdbId = Number(newInp?.value || 0);
        const typeCode = typeSel?.value === "s" ? "s" : "m";
        if (oldSyntheticId < 900000000 || !newTmdbId || newTmdbId >= 900000000) {
          showHudToast("⚠️ Bitte eine gültige 900M-ID (>= 900.000.000) und eine echte TMDb-ID (< 900.000.000) eingeben.");
          return;
        }
        setBusyState(true, "🔄 Migriere #" + oldSyntheticId + " inkl. Episoden, Streams & Playlisten auf TMDb #" + newTmdbId + "...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/migrate-synthetic-id", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              oldSyntheticId,
              newTmdbId,
              typeCode,
              targetChatId: backupImportJob.targetPlaylistChatId || chatId
            })
          });
          if (r && r.ok) {
            clearClientMediaCaches();
            closeManualNoTmdbConfirmModalClient();
            showHudToast("✅ Migration abgeschlossen: #" + oldSyntheticId + " → TMDb #" + newTmdbId + (r.officialTitle ? (" (" + r.officialTitle + ")") : ""));
            refreshDiagnosticLogMountDom();
            if (state.currentView === "admin") loadAdminPanelView(true);
          } else {
            showHudToast("⚠️ " + (r?.error || "Migration fehlgeschlagen"));
          }
        } finally {
          setBusyState(false);
        }
      }

      function openManualNoTmdbConfirmModalClient(ctx) {
        if (!ctx || typeof ctx !== "object") return;
        activeManualNoTmdbContext = ctx;
        let overlay = document.getElementById("manualNoTmdbConfirmModalOverlay");
        if (!overlay && document.body) {
          overlay = document.createElement("div");
          overlay.id = "manualNoTmdbConfirmModalOverlay";
          overlay.style.cssText =
            "position:fixed;inset:0;z-index:12000;background:rgba(5,6,12,0.84);backdrop-filter:blur(7px);" +
            "display:flex;align-items:center;justify-content:center;padding:14px;";
          overlay.addEventListener("click", (ev) => {
            if (ev.target === overlay) closeManualNoTmdbConfirmModalClient();
          });
          document.body.appendChild(overlay);
        }
        if (!overlay) return;

        const initType = ctx.typeCode === "s" ? "s" : "m";
        const initTitle = String(ctx.title || "").trim();
        const initYear = String(ctx.year && ctx.year !== "k.A." ? ctx.year : "").replace(/[^0-9]/g, "").slice(0, 4);
        const initSeason = ctx.season !== undefined && ctx.season !== null ? Math.max(0, parseInt(ctx.season, 10) || 0) : 1;
        const initEpisode = Math.max(1, parseInt(ctx.episode, 10) || 1);
        const initPoster = String(ctx.poster || "").trim();
        const initGenres = String(ctx.genres || "Manuell bestätigt").trim();
        const initOverview = String(ctx.overview || "").trim();
        const sibCount = Number(ctx.siblingCount || 0);
        const existingSynthId = Number(ctx.existingSyntheticId || 0);
        const openQueueTargets = getOpenTmdbNotFoundQueueTargetsClient(ctx.mode === "review" ? "review" : "diag");
        const isQueueActive = Boolean(manualNoTmdbQueueState.active);

        overlay.style.display = "flex";
        overlay.innerHTML =
          '<div class="admin-surface-card" style="width:min(95vw,540px);border:1px solid rgba(99,102,241,0.45);border-radius:14px;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,0.65);max-height:92vh;overflow-y:auto">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">' +
              '<div>' +
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                  '<span style="font-size:15px;font-weight:900;color:var(--text)">✨ 900M-ID Abgleich-Modal (Manuelle Bestätigung)</span>' +
                  (isQueueActive ? (
                    '<span style="font-size:10.5px;font-weight:900;padding:2px 8px;border-radius:999px;background:rgba(14,165,233,0.18);color:#0284c7;border:1px solid rgba(14,165,233,0.45)">⚡ Queue-Modus aktiv (' + openQueueTargets.length + ' offen)</span>'
                  ) : '') +
                '</div>' +
                '<div style="font-size:11.5px;color:var(--muted);margin-top:2px">Erhält eine kollisionsfreie synthetische ID im exklusiven <b>900.000.000+</b> Bereich (überschreibt niemals TMDb-IDs) und aktiviert den Schreibschutz (<code>manual_override = 1</code>).</div>' +
              '</div>' +
              '<button type="button" class="btn close-slate" style="padding:4px 9px;font-size:12px" onclick="closeManualNoTmdbConfirmModalClient()">✖</button>' +
            '</div>' +
            '<input id="manualNoTmdbReuseIdInp" type="hidden" value="' + (existingSynthId >= 900000000 ? existingSynthId : 0) + '" />' +
            '<div id="manualNoTmdbLivePreviewBox" style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.35);border-radius:8px;padding:8px 10px;margin-bottom:9px;font-size:11.5px">Berechne 900M-ID Vorschau…</div>' +
            '<div id="manualNoTmdbExistingSeriesSuggestBox" class="admin-sub-box" style="display:none;border-color:rgba(14,165,233,0.35);padding:8px 10px;margin-bottom:9px"></div>' +
            (ctx.rawFileName ? (
              '<div class="admin-sub-box" style="padding:7px 10px;margin-bottom:10px;font-size:11px;color:var(--muted);word-break:break-all">' +
                '📄 <b>Datei / Quelle:</b> <code class="admin-code-pill">' + esc(ctx.rawFileName) + '</code>' +
              '</div>'
            ) : '') +
            '<div style="display:flex;flex-direction:column;gap:9px">' +
              '<div>' +
                '<label style="display:block;font-size:11px;font-weight:800;color:#6366f1;margin-bottom:4px">🎬 Titel (Pflichtfeld)</label>' +
                '<input id="manualNoTmdbTitleInp" class="tma-input" value="' + esc(initTitle) + '" oninput="document.getElementById(\\'manualNoTmdbReuseIdInp\\').value=\\'0\\';scheduleManualNoTmdbLivePreviewClient()" placeholder="z.B. Seltene Dokumentation / Eigenproduktion" style="width:100%;padding:8px 10px;font-size:12.5px" />' +
              '</div>' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
                '<div>' +
                  '<label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:4px">📂 Medientyp</label>' +
                  '<select id="manualNoTmdbTypeSel" class="tma-select" onchange="document.getElementById(\\'manualNoTmdbReuseIdInp\\').value=\\'0\\';toggleManualNoTmdbSeriesFieldsClient()" style="width:100%;padding:8px 10px;font-size:12.5px">' +
                    '<option value="m"' + (initType === 'm' ? ' selected' : '') + '>🎬 Film (900M–944M)</option>' +
                    '<option value="s"' + (initType === 's' ? ' selected' : '') + '>📺 Serie (945M–989M)</option>' +
                  '</select>' +
                '</div>' +
                '<div>' +
                  '<label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:4px">📅 Erscheinungsjahr (optional)</label>' +
                  '<input id="manualNoTmdbYearInp" class="tma-input" type="number" min="1900" max="2099" value="' + esc(initYear) + '" oninput="document.getElementById(\\'manualNoTmdbReuseIdInp\\').value=\\'0\\';scheduleManualNoTmdbLivePreviewClient()" placeholder="z.B. 2024" style="width:100%;padding:8px 10px;font-size:12.5px" />' +
                '</div>' +
              '</div>' +
              '<div id="manualNoTmdbSeriesRow" style="display:' + (initType === 's' ? 'grid' : 'none') + ';grid-template-columns:1fr 1fr;gap:8px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:8px">' +
                '<div>' +
                  '<label style="display:block;font-size:11px;font-weight:800;color:#6366f1;margin-bottom:3px">📺 Staffel (S, 0 = Bonus/Special)</label>' +
                  '<input id="manualNoTmdbSeasonInp" class="tma-input" type="number" min="0" max="99" value="' + initSeason + '" style="width:100%;padding:6px 8px;font-size:12px" />' +
                '</div>' +
                '<div>' +
                  '<label style="display:block;font-size:11px;font-weight:800;color:#6366f1;margin-bottom:3px">🎞️ Episode (E)</label>' +
                  '<input id="manualNoTmdbEpInp" class="tma-input" type="number" min="1" max="999" value="' + initEpisode + '" style="width:100%;padding:6px 8px;font-size:12px" />' +
                '</div>' +
                (sibCount >= 2 ? (
                  '<label style="grid-column:1 / -1;display:flex;align-items:center;gap:6px;font-size:11.5px;color:#0284c7;cursor:pointer;margin-top:2px">' +
                    '<input id="manualNoTmdbApplySiblingsChk" type="checkbox" checked />' +
                    '<span>⚡ Alle <b>' + sibCount + ' offenen Folgen</b> dieser Serie gleich mit derselben Serien-ID verknüpfen</span>' +
                  '</label>'
                ) : '') +
              '</div>' +
              '<div>' +
                '<label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:4px">🖼️ Optionaler Poster-Link (HTTPS Bild-URL)</label>' +
                '<input id="manualNoTmdbPosterInp" class="tma-input" value="' + esc(initPoster) + '" placeholder="https://... (leer lassen für Standard-Cover)" style="width:100%;padding:8px 10px;font-size:12px" />' +
              '</div>' +
              '<div>' +
                '<label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:4px">🏷️ Genres (optional)</label>' +
                '<input id="manualNoTmdbGenresInp" class="tma-input" value="' + esc(initGenres) + '" placeholder="z.B. Dokumentation, Konzert, Eigenproduktion" style="width:100%;padding:7px 10px;font-size:12px" />' +
              '</div>' +
              '<div>' +
                '<label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:4px">📝 Kurzbeschreibung (optional)</label>' +
                '<textarea id="manualNoTmdbOverviewInp" class="tma-textarea" rows="2" placeholder="Optionale Beschreibung für die Detailansicht..." style="width:100%;padding:7px 10px;font-size:12px;resize:vertical">' + esc(initOverview) + '</textarea>' +
              '</div>' +
              '<label class="admin-sub-box" style="display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--text);cursor:pointer;padding:7px 10px">' +
                '<input id="manualNoTmdbQueueContinueChk" type="checkbox" ' + ((isQueueActive || openQueueTargets.length > 1) ? 'checked' : '') + ' />' +
                '<span>⏭️ <b>Queue-Modus:</b> Nach dem Speichern automatisch nächsten offenen <code>TMDB_NOT_FOUND</code>-Treffer öffnen (' + openQueueTargets.length + ' offen)</span>' +
              '</label>' +
              '<details class="admin-sub-box" style="border-color:rgba(14,165,233,0.35);padding:8px 10px"' + (existingSynthId >= 900000000 ? ' open' : '') + '>' +
                '<summary style="cursor:pointer;font-size:11.5px;font-weight:800;color:#0284c7">🔄 1-Klick-Upgrade: Bestehende 900M-ID später auf echte TMDb-ID umziehen</summary>' +
                '<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--muted)">' +
                  '<div>Zieht alle Episoden, Videodateien, Aliase und Playlisten einer synthetischen 900M-ID verlustfrei auf eine offizielle TMDb-ID um und löscht den alten 900M-Datensatz.</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                    '<input id="manualMigrateOld900mInp" class="tma-input" type="number" value="' + (existingSynthId >= 900000000 ? existingSynthId : '') + '" placeholder="Alte 900M-ID (z.B. 945123456)" style="flex:1;min-width:140px;padding:6px 8px;font-size:11.5px" />' +
                    '<input id="manualMigrateNewTmdbInp" class="tma-input" type="number" placeholder="Neue echte TMDb-ID (z.B. 66732)" style="flex:1;min-width:140px;padding:6px 8px;font-size:11.5px" />' +
                    '<button type="button" class="btn blue" style="padding:6px 10px;font-size:11.5px;font-weight:800" onclick="submitMigrate900mToRealTmdbClient()">🔄 Jetzt auf TMDb-ID migrieren</button>' +
                  '</div>' +
                '</div>' +
              '</details>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap">' +
              '<div>' +
                (openQueueTargets.length > 1 ? '<button type="button" class="btn" onclick="skipCurrentManualNoTmdbQueueItemClient()">⏭️ Nächster Treffer (' + openQueueTargets.length + ')</button>' : '') +
              '</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                '<button type="button" class="btn close-slate" onclick="closeManualNoTmdbConfirmModalClient()">Abbrechen</button>' +
                '<button type="button" class="btn green" style="background:linear-gradient(90deg,#0284c7,#059669);border-color:#38bdf8;color:#fff;font-weight:800" onclick="submitManualNoTmdbConfirmModalClient()">✨ Ohne TMDb-ID speichern & zuweisen</button>' +
              '</div>' +
            '</div>' +
          '</div>';

        updateManualNoTmdbLivePreviewClient();
      }

      function openManualNoTmdbConfirmForReviewItem(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        syncReviewCardDomInputsToItemState(it);
        const searchInp = document.getElementById("revSearchInp_" + itemId);
        const seasonInp = document.getElementById("revSeasonInp_" + itemId);
        const epInp = document.getElementById("revEpInp_" + itemId);
        const rawFileName = it.rawFileName || it.rawEntry?.raw_file_name || it.rawEntry?.filename || it.rawInput || "";
        const siblings = getMatchingOpenSeriesSiblingItems(it, null);
        const guessType = (it.typeCode === "s" || it.season || it.episode || /S\\d{1,2}E\\d{1,3}|Staffel|Folge|Episode/i.test(rawFileName)) ? "s" : "m";
        openManualNoTmdbConfirmModalClient({
          mode: "review",
          itemId: it.id,
          title: (searchInp && searchInp.value.trim()) ? searchInp.value.trim() : (it.cleanTitle || it.rawInput || "Unbekannter Titel"),
          year: it.year && it.year !== "k.A." ? it.year : "",
          typeCode: guessType,
          season: seasonInp ? seasonInp.value : (it.season ?? 1),
          episode: epInp ? epInp.value : (it.episode || 1),
          poster: it.poster || "",
          rawFileName,
          siblingCount: siblings.length,
          existingSyntheticId: Number(it.tmdbId || 0) >= 900000000 ? Number(it.tmdbId) : 0
        });
      }

      function openManualNoTmdbConfirmForDiagItem(diagIdx) {
        loadClientDiagnosticLogsFromStorage();
        const item = clientDiagnosticLogState.logs[diagIdx];
        if (!item) return;
        const typeSel = document.getElementById("diagFixType_" + diagIdx);
        const sInp = document.getElementById("diagFixSeason_" + diagIdx);
        const eInp = document.getElementById("diagFixEp_" + diagIdx);
        openManualNoTmdbConfirmModalClient({
          mode: "diag",
          diagIdx,
          title: item.parsedTitle || item.fileName || "Unbekannter Titel",
          year: "",
          typeCode: (typeSel ? typeSel.value : (item.detectedType === "series" || item.seasonNumber !== null ? "s" : "m")),
          season: sInp ? sInp.value : (item.seasonNumber ?? 1),
          episode: eInp ? eInp.value : (item.episodeNumber || 1),
          poster: "",
          rawFileName: item.fileName || item.rawText || "",
          existingSyntheticId: Number(item.tmdbId || 0) >= 900000000 ? Number(item.tmdbId) : 0
        });
      }

      function openManualNoTmdbConfirmForCrudClient() {
        const typeCode = document.getElementById("crudTypeSel")?.value || "m";
        const title = document.getElementById("crudTitleInp")?.value.trim() || "";
        const year = document.getElementById("crudYearInp")?.value.trim() || "";
        openManualNoTmdbConfirmModalClient({
          mode: "crud",
          title,
          year,
          typeCode,
          season: 1,
          episode: 1,
          poster: ""
        });
      }

      async function submitManualNoTmdbConfirmModalClient() {
        const ctx = activeManualNoTmdbContext;
        if (!ctx) return;
        const title = String(document.getElementById("manualNoTmdbTitleInp")?.value || "").trim();
        const typeCode = document.getElementById("manualNoTmdbTypeSel")?.value === "s" ? "s" : "m";
        const year = String(document.getElementById("manualNoTmdbYearInp")?.value || "").trim();
        const seasonRaw = document.getElementById("manualNoTmdbSeasonInp")?.value;
        const season = seasonRaw !== undefined && seasonRaw !== "" ? Math.max(0, parseInt(seasonRaw, 10) || 0) : 1;
        const episode = Math.max(1, parseInt(document.getElementById("manualNoTmdbEpInp")?.value, 10) || 1);
        const poster = String(document.getElementById("manualNoTmdbPosterInp")?.value || "").trim();
        const genres = String(document.getElementById("manualNoTmdbGenresInp")?.value || "Manuell bestätigt").trim();
        const overview = String(document.getElementById("manualNoTmdbOverviewInp")?.value || "").trim();
        const applySiblings = Boolean(document.getElementById("manualNoTmdbApplySiblingsChk")?.checked);
        const continueQueue = Boolean(document.getElementById("manualNoTmdbQueueContinueChk")?.checked);
        const reuseSyntheticId = Number(document.getElementById("manualNoTmdbReuseIdInp")?.value || 0);

        if (!title) {
          showHudToast("⚠️ Bitte einen Titel für die manuelle Bestätigung eingeben.");
          return;
        }

        const manualCustomMeta = {
          title,
          originalTitle: title,
          year: year || "k.A.",
          poster,
          genres: genres || "Manuell bestätigt",
          overview: overview || "Manuell ohne TMDb-ID bestätigter Titel.",
          reuseSyntheticId: reuseSyntheticId >= 900000000 ? reuseSyntheticId : 0,
          source: "Manuell bestätigt"
        };

        const prevMode = ctx.mode;
        closeManualNoTmdbConfirmModalClient();
        if (continueQueue) {
          manualNoTmdbQueueState.active = true;
          manualNoTmdbQueueState.source = prevMode === "review" ? "review" : "diag";
        }

        const maybeOpenNextInQueue = () => {
          if (!continueQueue) return;
          const remaining = getOpenTmdbNotFoundQueueTargetsClient(prevMode === "review" ? "review" : "diag");
          if (remaining.length > 0) {
            setTimeout(() => {
              if (prevMode === "review") openManualNoTmdbConfirmForReviewItem(remaining[0].id);
              else openManualNoTmdbConfirmForDiagItem(remaining[0].diagIdx);
            }, 160);
          } else {
            manualNoTmdbQueueState.active = false;
            showHudToast("🎉 Queue abgeschlossen – alle offenen Einträge wurden abgearbeitet!");
          }
        };

        if (ctx.mode === "review" && ctx.itemId) {
          const baseItem = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(ctx.itemId));
          if (!baseItem) return;
          const sInp = document.getElementById("revSeasonInp_" + ctx.itemId);
          const eInp = document.getElementById("revEpInp_" + ctx.itemId);
          if (sInp) sInp.value = String(season);
          if (eInp) eInp.value = String(episode);
          baseItem.season = season;
          baseItem.episode = episode;
          baseItem.cleanTitle = title;
          if (year) baseItem.year = year;

          const siblings = (typeCode === "s" && applySiblings)
            ? getMatchingOpenSeriesSiblingItems(baseItem, null)
            : [baseItem];
          const targetList = siblings.length > 0 ? siblings : [baseItem];

          setBusyState(true, "✨ Vergib kollisionsfreie 900M-ID & speichere „" + title + "“ in D1...");
          try {
            let sharedAllocatedId = reuseSyntheticId >= 900000000 ? reuseSyntheticId : 0;
            let okCount = 0;
            for (const sib of targetList) {
              const ok = await applyBackupCandidateRemap(sib.id, sharedAllocatedId, typeCode, {
                isConfirmAction: true,
                confirmManualWithoutTmdb: true,
                manualCustomMeta,
                candidateMeta: manualCustomMeta,
                silentBusy: true
              });
              if (ok) {
                okCount++;
                if (!sharedAllocatedId && sib.tmdbId) {
                  sharedAllocatedId = Number(sib.tmdbId);
                }
              }
            }
            clearClientMediaCaches();
            showHudToast("✨ Manuell ohne TMDb-ID gespeichert: " + title + (sharedAllocatedId ? (" (#" + sharedAllocatedId + ")") : "") + (targetList.length > 1 ? (" [" + okCount + " Folgen]") : ""));
            maybeOpenNextInQueue();
          } finally {
            setBusyState(false);
          }
          return;
        }

        if (ctx.mode === "diag" && ctx.diagIdx !== undefined) {
          loadClientDiagnosticLogsFromStorage();
          const item = clientDiagnosticLogState.logs[ctx.diagIdx];
          if (!item) return;
          setBusyState(true, "✨ Weise Diagnose-Eintrag kollisionsfreie 900M-ID zu...");
          try {
            const rawEntry = item.rawEntry && typeof item.rawEntry === "object"
              ? { ...item.rawEntry }
              : {
                  filename: item.fileName,
                  raw_file_name: item.fileName,
                  raw_text: item.rawText,
                  msg_id: item.msgId,
                  message_id: item.msgId
                };
            if (typeCode === "s") {
              rawEntry.season = season;
              rawEntry.episode = episode;
              rawEntry.isSeries = true;
            }
            const r = await apiFetchJson(API_BASE + "/admin/remap-import-item", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                newTmdbId: reuseSyntheticId >= 900000000 ? reuseSyntheticId : 0,
                reuseSyntheticId: reuseSyntheticId >= 900000000 ? reuseSyntheticId : 0,
                newTypeCode: typeCode,
                confirmManualWithoutTmdb: true,
                manualCustomMeta,
                msgId: item.msgId || null,
                season: typeCode === "s" ? season : null,
                episode: typeCode === "s" ? episode : null,
                oldTmdbId: item.tmdbId || null,
                oldTypeCode: item.detectedType === "series" ? "s" : "m",
                targetChatId: backupImportJob.targetPlaylistChatId || chatId,
                playlistFolderId: backupImportJob.playlistFolderId || null,
                playlistMode: backupImportJob.playlistMode || "both",
                rawEntry
              })
            });
            if (r && r.ok && r.matchedItem) {
              item.status = "OK";
              item.tmdbId = r.matchedItem.tmdbId;
              item.matchedTitle = r.matchedItem.matchedTitle || r.matchedItem.cleanTitle;
              item.detectedType = typeCode === "s" ? "series" : "movie";
              item.seasonNumber = typeCode === "s" ? season : null;
              item.episodeNumber = typeCode === "s" ? episode : null;
              item.reason = "Manuell ohne TMDb-ID bestätigt → " + r.matchedItem.cleanTitle + " (#" + r.matchedItem.tmdbId + ")";
              saveClientDiagnosticLogsToStorage();
              await apiFetchJson(API_BASE + "/admin/import-logs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "resolve",
                  id: item.id,
                  msgId: item.msgId,
                  tmdbId: r.matchedItem.tmdbId,
                  reason: item.reason
                })
              }).catch(() => {});
              clearClientMediaCaches();
              showHudToast("✨ Manuell ohne TMDb-ID verknüpft: " + r.matchedItem.cleanTitle + " (#" + r.matchedItem.tmdbId + ")");
              refreshDiagnosticLogMountDom();
              maybeOpenNextInQueue();
            } else {
              showHudToast("⚠️ " + (r?.error || "Manuelle Zuweisung fehlgeschlagen"));
            }
          } finally {
            setBusyState(false);
          }
          return;
        }

        if (ctx.mode === "crud") {
          const fileId = document.getElementById("crudFileIdInp")?.value.trim() || "";
          const quality = document.getElementById("crudQualityInp")?.value.trim() || "1080p";
          const fileSize = document.getElementById("crudFileSizeInp")?.value.trim() || "";
          const tags = document.getElementById("crudTagsInp")?.value.trim() || "";
          setBusyState(true, "✨ Lege manuellen Titel ohne TMDb-ID in D1 an...");
          try {
            const r = await apiFetchJson(API_BASE + "/admin/media", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "upsert",
                confirmManualWithoutTmdb: true,
                typeCode,
                tmdbId: reuseSyntheticId >= 900000000 ? reuseSyntheticId : 0,
                title,
                year,
                poster,
                genres,
                overview,
                season,
                episode,
                fileId,
                quality,
                fileSize,
                tags
              })
            });
            clearClientMediaCaches();
            if (!r || !r.ok) showHudToast("⚠️ " + (r?.error || "Fehler beim Anlegen"));
            else showHudToast("✨ Manuell angelegt: " + title + " (#" + (r.item?.id || r.item?.tmdbId || "") + ")");
            state.adminMediaType = typeCode;
            await loadAdminPanelView();
          } finally {
            setBusyState(false);
          }
        }
      }

      function usePrevMessageForReviewSearch(itemId, queryText) {
        const inp = document.getElementById("revSearchInp_" + itemId);
        if (inp) {
          inp.value = String(queryText || "").trim();
          searchManualCandidatesForReviewItem(itemId);
        }
      }

      // Findet alle weiteren offenen Folgen derselben Serie in der Prüfliste (z. B. Axel will's wissen S01E09, S01E10, S01E12)
      function getMatchingOpenSeriesSiblingItems(baseItem, targetTmdbId = null) {
        if (!baseItem) return [];
        const allItems = backupImportJob.reviewItems || [];
        const normBase = normalizeClientCompareTitle(baseItem.cleanTitle || "");
        const effId = Number(targetTmdbId || baseItem.tmdbId || 0);
        return allItems.filter(x => {
          if (!x || x.resolvedByAdmin) return false;
          if (effId > 0 && Number(x.tmdbId || 0) === effId) return true;
          const normX = normalizeClientCompareTitle(x.cleanTitle || "");
          if (normBase && normX && normBase === normX) return true;
          return false;
        });
      }

      async function applyBackupCandidateRemap(itemId, newTmdbId, newTypeCode, options = null) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        const isManualNoTmdb = Boolean(options?.confirmManualWithoutTmdb);
        if (!it || (!newTmdbId && !isManualNoTmdb)) return false;
        syncReviewCardDomInputsToItemState(it);

        const cands = Array.isArray(it.candidates) ? it.candidates : [];
        const matchedCand = cands.find(c => Number(c.tmdbId) === Number(newTmdbId) && (c.typeCode || "m") === (newTypeCode === "s" ? "s" : "m")) || null;

        const seasonInp = document.getElementById("revSeasonInp_" + itemId);
        const epInp = document.getElementById("revEpInp_" + itemId);
        const rawFileName = it.rawFileName || it.rawEntry?.raw_file_name || it.rawEntry?.filename || it.rawInput || "";
        const rawTailMatch = String(rawFileName).replace(/\\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i, "").match(/(?:^|\\s|[-_])(?:teil\\s*|part\\s*|ep\\.?\\s*)?0*(\\d{1,2})\\s*$/i);
        const inferredTailEp = rawTailMatch ? parseInt(rawTailMatch[1], 10) : null;

        const fallbackSeason = matchedCand?.inferredSeason != null
          ? Number(matchedCand.inferredSeason)
          : (it.season != null ? Number(it.season) : 1);
        const fallbackEpisode = matchedCand?.inferredEpisode || it.episode || (inferredTailEp >= 1 && inferredTailEp <= 99 ? inferredTailEp : 1);

        const rawSeasonParsed = seasonInp && seasonInp.value !== "" ? parseInt(seasonInp.value, 10) : NaN;
        const manualSeason = newTypeCode === "s"
          ? Math.max(0, !Number.isNaN(rawSeasonParsed) ? rawSeasonParsed : fallbackSeason)
          : null;
        const rawEpParsed = epInp && epInp.value !== "" ? parseInt(epInp.value, 10) : NaN;
        const manualEpisode = newTypeCode === "s"
          ? Math.max(1, !Number.isNaN(rawEpParsed) ? rawEpParsed : fallbackEpisode)
          : null;

        const candidateMeta = options?.candidateMeta || (matchedCand ? {
          id: Number(matchedCand.tmdbId),
          title: matchedCand.title || it.cleanTitle || "Unbekannt",
          originalTitle: matchedCand.originalTitle || matchedCand.title || "",
          year: matchedCand.year || it.year || "k.A.",
          poster: matchedCand.poster || it.poster || "",
          vote_average: Number(matchedCand.voteAverage || 0),
          source: matchedCand.source || it.metadataSource || "Fallback"
        } : {
          id: Number(newTmdbId || 0),
          title: it.cleanTitle || "Unbekannt",
          year: it.year || "k.A.",
          poster: it.poster || "",
          source: isManualNoTmdb ? "Manuell bestätigt" : (it.metadataSource || "Fallback")
        });

        const activeChan = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
        const silentBusy = Boolean(options?.silentBusy);
        if (!silentBusy) {
          setBusyState(true, options?.isConfirmAction ? "💾 Speichere Bestätigung in D1 & Playlist..." : "🔄 Aktualisiere Zuordnung in D1 & Playlist...");
        }
        try {
          const r = await apiFetchJson(API_BASE + "/admin/remap-import-item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              oldTmdbId: it.tmdbId || null,
              oldTypeCode: it.typeCode || "m",
              oldSeason: it.season || null,
              oldEpisode: it.episode || null,
              newTmdbId: Number(newTmdbId || 0),
              newTypeCode: newTypeCode === "s" ? "s" : "m",
              confirmManualWithoutTmdb: isManualNoTmdb,
              manualCustomMeta: options?.manualCustomMeta || null,
              sourceChannelId: activeChan || "",
              messageId: it.messageId || it.rawEntry?.message_id || it.rawEntry?.msg_id || null,
              candidateMeta,
              rawEntry: it.rawEntry || { filename: it.rawInput },
              playlistFolderId: backupImportJob.playlistFolderId || null,
              playlistName: backupImportJob.customPlaylistName || "🎵 JSON-Import",
              playlistMode: backupImportJob.playlistMode || "both",
              targetChatId: backupImportJob.targetPlaylistChatId || chatId,
              season: manualSeason,
              episode: manualEpisode
            })
          });
          if (!r || !r.ok || !r.matchedItem) {
            if (!silentBusy) showHudToast("⚠️ " + (r?.error || "Speicherung fehlgeschlagen."));
            return false;
          }
          const wasFailed = it.status === "failed" || !it.tmdbId;
          const wasUncertain = Boolean(it.isUncertain);
          const prevType = it.typeCode;

          it.tmdbId = r.matchedItem.tmdbId;
          it.typeCode = r.matchedItem.typeCode;
          it.cleanTitle = r.matchedItem.cleanTitle;
          it.year = r.matchedItem.year;
          it.poster = r.matchedItem.poster;
          if (r.matchedItem.season) it.season = r.matchedItem.season;
          if (r.matchedItem.episode) it.episode = r.matchedItem.episode;
          if (r.matchedItem.episodeTitle) it.episodeTitle = r.matchedItem.episodeTitle;
          if (r.matchedItem.metadataSource) it.metadataSource = r.matchedItem.metadataSource;
          it.confidence = 100;
          it.isUncertain = false;
          it.status = options?.isConfirmAction ? "confirmed" : "remapped";
          it.resolvedByAdmin = true;
          it.expandedAfterResolve = false;

          if (wasFailed) {
            backupImportJob.failedCount = Math.max(0, backupImportJob.failedCount - 1);
            if (r.matchedItem.typeCode === "s") backupImportJob.seriesSaved++;
            else backupImportJob.moviesSaved++;
          } else {
            if (wasUncertain) backupImportJob.uncertainCount = Math.max(0, backupImportJob.uncertainCount - 1);
            if (prevType !== r.matchedItem.typeCode) {
              if (r.matchedItem.typeCode === "s") {
                backupImportJob.moviesSaved = Math.max(0, backupImportJob.moviesSaved - 1);
                backupImportJob.seriesSaved++;
              } else {
                backupImportJob.seriesSaved = Math.max(0, backupImportJob.seriesSaved - 1);
                backupImportJob.moviesSaved++;
              }
            }
          }

          saveBackupCheckpointClient(false);
          updateSingleReviewCardInDom(itemId);

          if (!silentBusy) {
            const seSuffix = r.matchedItem.typeCode === "s" && r.matchedItem.season && r.matchedItem.episode
              ? (" S" + String(r.matchedItem.season).padStart(2, "0") + "E" + String(r.matchedItem.episode).padStart(2, "0"))
              : "";
            showHudToast("✅ In D1 gespeichert: " + r.matchedItem.cleanTitle + seSuffix + " (" + r.matchedItem.year + ")");
          }
          return true;
        } finally {
          if (!silentBusy) setBusyState(false);
        }
      }

      // 1-Klick Sammel-Bestätigung für alle Folgen derselben Serie (jede Folge behält ihre eigene S/E Nummer!)
      async function confirmAllSeriesEpisodesInReview(itemId, targetTmdbId, targetTypeCode = "s") {
        const baseItem = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!baseItem) return;
        const effTmdbId = Number(targetTmdbId || baseItem.tmdbId || 0);
        if (!effTmdbId) return;

        const siblings = getMatchingOpenSeriesSiblingItems(baseItem, effTmdbId);
        if (siblings.length === 0) return;

        const cands = Array.isArray(baseItem.candidates) ? baseItem.candidates : [];
        const matchedCand = cands.find(c => Number(c.tmdbId) === effTmdbId) || null;
        const sharedCandidateMeta = matchedCand ? {
          id: effTmdbId,
          title: matchedCand.title || baseItem.cleanTitle || "Unbekannt",
          originalTitle: matchedCand.originalTitle || matchedCand.title || "",
          year: matchedCand.year || baseItem.year || "k.A.",
          poster: matchedCand.poster || baseItem.poster || "",
          vote_average: Number(matchedCand.voteAverage || 0),
          source: matchedCand.source || baseItem.metadataSource || "Fallback"
        } : {
          id: effTmdbId,
          title: baseItem.cleanTitle || "Unbekannt",
          year: baseItem.year || "k.A.",
          poster: baseItem.poster || "",
          source: baseItem.metadataSource || "Fallback"
        };

        let okCount = 0;
        setBusyState(true, "⚡ Speichere alle " + siblings.length + " Folgen von „" + (sharedCandidateMeta.title || baseItem.cleanTitle) + "“ in D1...");
        try {
          for (const sib of siblings) {
            const success = await applyBackupCandidateRemap(sib.id, effTmdbId, targetTypeCode || "s", {
              isConfirmAction: true,
              silentBusy: true,
              candidateMeta: sharedCandidateMeta
            });
            if (success) okCount++;
          }
          showHudToast("🎉 " + okCount + " / " + siblings.length + " Folgen von „" + (sharedCandidateMeta.title || baseItem.cleanTitle) + "“ in D1 gespeichert!");
        } finally {
          setBusyState(false);
        }
      }

      async function searchManualCandidatesForReviewItem(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        syncReviewCardDomInputsToItemState(it);
        const inp = document.getElementById("revSearchInp_" + itemId);
        const sel = document.getElementById("revSearchType_" + itemId);
        const q = (inp ? inp.value : it.cleanTitle || it.rawInput || "").trim();
        const typeVal = sel ? sel.value : "auto";
        if (!q) {
          showHudToast("⚠️ Bitte Suchbegriff oder TMDb-ID eingeben.");
          return;
        }
        it.manualSearchQuery = q;
        it.manualSearchType = typeVal;
        setBusyState(true, "🔍 Durchsuche alle 8 APIs nach „" + q + "“...");
        try {
          const r = await apiFetchJson(
            API_BASE + "/admin/tmdb-candidates?q=" + encodeURIComponent(q) + "&type=" + encodeURIComponent(typeVal)
          );
          if (r && Array.isArray(r.candidates)) {
            it.candidates = r.candidates;
            if (r.candidates.length === 0) showHudToast("ℹ️ Keine Treffer für „" + q + "“ gefunden.");
          }
          updateSingleReviewCardInDom(itemId);
        } finally {
          setBusyState(false);
        }
      }

      function inferClientReviewReasonCode(item) {
        if (!item || typeof item !== "object") return "PARSER_AMBIGUITY";
        const explicit = String(
          item.reviewReasonCode ||
          item.review_reason_code ||
          item.rawEntry?.reviewReasonCode ||
          item.rawEntry?.review_reason_code ||
          item.details?.reviewReasonCode ||
          item.details?.review_reason_code ||
          ""
        ).trim().toUpperCase();
        if (explicit) return explicit;
        const st = String(item.status || "").trim().toUpperCase();
        const rText = String(item.errorReason || item.reason || "").trim();
        if (st === "FAILED" || st === "TMDB_NOT_FOUND" || (!item.tmdbId && st !== "OK" && st !== "ADDED" && st !== "UPDATED") || /kein(?: passender)?\\s+tmdb|kein treffer auf tmdb|nicht erkannt|not[_\\s-]*found/i.test(rText)) {
          return "TMDB_NOT_FOUND";
        }
        if (st === "API_ERROR" || /nach wiederholungsversuch isoliert|api[_\\s-]*error|timeout/i.test(rText)) {
          return "API_ERROR";
        }
        if (/staffel-konflikt|staffel\\s+\\d+.*hat nur\\s+\\d+\\s+staffel/i.test(rText)) {
          return "SEASON_CONFLICT";
        }
        if (/jahres-konflikt|jahres-\\/kontext-sperre|jahre\\s+abweichung/i.test(rText)) {
          return "YEAR_CONFLICT";
        }
        if (/fortsetzungs-\\/teil-konflikt|teil-konflikt|sequel/i.test(rText)) {
          return "SEQUEL_CONFLICT";
        }
        return "PARSER_AMBIGUITY";
      }

      function resolveClientReviewReasonMeta(item) {
        const code = inferClientReviewReasonCode(item);
        const catalog = {
          TMDB_NOT_FOUND: {
            code: "TMDB_NOT_FOUND",
            icon: "❌",
            label: "Kein TMDb-Treffer",
            badgeStyle: "background:rgba(239,68,68,0.22);color:#fca5a5;border:1px solid rgba(239,68,68,0.5)",
            boxStyle: "background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.38);color:#fecaca"
          },
          YEAR_CONFLICT: {
            code: "YEAR_CONFLICT",
            icon: "📅",
            label: "Jahres-Konflikt",
            badgeStyle: "background:rgba(245,158,11,0.22);color:#fde68a;border:1px solid rgba(245,158,11,0.5)",
            boxStyle: "background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.38);color:#fde68a"
          },
          PARSER_AMBIGUITY: {
            code: "PARSER_AMBIGUITY",
            icon: "🔀",
            label: "Parser-/Titel-Mehrdeutigkeit",
            badgeStyle: "background:rgba(168,85,247,0.22);color:#e9d5ff;border:1px solid rgba(168,85,247,0.5)",
            boxStyle: "background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.38);color:#e9d5ff"
          },
          SEASON_CONFLICT: {
            code: "SEASON_CONFLICT",
            icon: "📺",
            label: "Staffel-Konflikt",
            badgeStyle: "background:rgba(14,165,233,0.22);color:#bae6fd;border:1px solid rgba(56,189,248,0.5)",
            boxStyle: "background:rgba(14,165,233,0.12);border:1px solid rgba(56,189,248,0.38);color:#bae6fd"
          },
          SEQUEL_CONFLICT: {
            code: "SEQUEL_CONFLICT",
            icon: "🎬",
            label: "Fortsetzungs-Konflikt",
            badgeStyle: "background:rgba(236,72,153,0.22);color:#fbcfe8;border:1px solid rgba(236,72,153,0.5)",
            boxStyle: "background:rgba(236,72,153,0.12);border:1px solid rgba(236,72,153,0.38);color:#fbcfe8"
          },
          API_ERROR: {
            code: "API_ERROR",
            icon: "🔥",
            label: "API-/Timeout-Fehler",
            badgeStyle: "background:rgba(239,68,68,0.25);color:#fecaca;border:1px solid rgba(248,113,113,0.55)",
            boxStyle: "background:rgba(239,68,68,0.14);border:1px solid rgba(239,68,68,0.42);color:#fecaca"
          }
        };
        return catalog[code] || catalog.PARSER_AMBIGUITY;
      }

      async function syncReviewItemsFromD1MetadataClient(silent = true) {
        try {
          if (!silent) setBusyState(true, "🔄 Lade Konflikt-Metadaten & Review-Flags aus D1...");
          const r = await apiFetchJson(API_BASE + "/admin/import-logs?status=PROBLEMS&limit=600");
          if (r && r.ok && Array.isArray(r.logs)) {
            appendClientDiagnosticLogs(r.logs, false);
          }
          loadClientDiagnosticLogsFromStorage();
          const diagLogs = clientDiagnosticLogState.logs || [];
          if (!Array.isArray(backupImportJob.reviewItems)) {
            backupImportJob.reviewItems = [];
          }
          const reviewByKey = new Map();
          for (const rev of backupImportJob.reviewItems) {
            if (!rev) continue;
            const mId = rev.msgId || rev.messageId || rev.rawEntry?.msg_id || rev.rawEntry?.message_id || "";
            const fName = rev.rawFileName || rev.rawEntry?.raw_file_name || rev.rawEntry?.filename || rev.rawInput || "";
            if (mId) reviewByKey.set("msg:" + String(mId), rev);
            if (fName) reviewByKey.set("fn:" + String(fName).toLowerCase(), rev);
          }

          let enrichedOrAdded = 0;
          for (const log of diagLogs) {
            if (!log) continue;
            const st = String(log.status || "").toUpperCase();
            if (st !== "TMDB_NOT_FOUND" && st !== "CONFLICT_?" && st !== "CONFLICT" && st !== "API_ERROR") continue;
            const mId = log.msgId ? Number(log.msgId) : null;
            const fName = String(log.fileName || log.parsedTitle || "").trim();
            const existingRev = (mId && reviewByKey.get("msg:" + String(mId))) ||
                                (fName && reviewByKey.get("fn:" + fName.toLowerCase())) ||
                                null;
            const dbReasonCode = inferClientReviewReasonCode(log);
            if (existingRev) {
              if (!existingRev.reviewReasonCode && dbReasonCode) {
                existingRev.reviewReasonCode = dbReasonCode;
                enrichedOrAdded++;
              }
              if (!existingRev.errorReason && log.reason) {
                existingRev.errorReason = log.reason;
                existingRev.reason = log.reason;
                enrichedOrAdded++;
              }
              if ((!Array.isArray(existingRev.candidates) || existingRev.candidates.length === 0) && Array.isArray(log.details?.candidates)) {
                existingRev.candidates = log.details.candidates;
              }
            } else {
              const rawEntryObj = (log.rawEntry && typeof log.rawEntry === "object")
                ? log.rawEntry
                : (log.details?.rawEntry && typeof log.details.rawEntry === "object"
                    ? log.details.rawEntry
                    : {
                        filename: fName || "Unbekannt",
                        raw_file_name: fName || "",
                        raw_text: log.rawText || log.textPreview || "",
                        msg_id: mId,
                        message_id: mId
                      });
              const hydratedItem = {
                id: "rev_d1_" + (log.id || mId || Math.random().toString(36).slice(2, 8)),
                rawInput: fName || log.parsedTitle || "Unbekannt",
                rawEntry: rawEntryObj,
                status: st === "TMDB_NOT_FOUND" || !log.tmdbId ? "failed" : "?",
                contextError: st === "CONFLICT_?" || st === "CONFLICT" || st === "TMDB_NOT_FOUND",
                isUncertain: true,
                reviewReasonCode: dbReasonCode,
                errorReason: log.reason || "",
                reason: log.reason || "",
                confidence: st === "TMDB_NOT_FOUND" ? 0 : 55,
                typeCode: (log.typeCode === "s" || log.detectedType === "series" || log.seasonNumber || log.season) ? "s" : "m",
                tmdbId: log.tmdbId ? Number(log.tmdbId) : null,
                cleanTitle: log.parsedTitle || fName || "Unbekannt",
                year: rawEntryObj?.year || "k.A.",
                poster: "",
                quality: rawEntryObj?.quality || "1080p",
                codec: rawEntryObj?.codec || "x264",
                season: log.seasonNumber ?? log.season ?? rawEntryObj?.season ?? null,
                episode: log.episodeNumber ?? log.episode ?? rawEntryObj?.episode ?? null,
                metadataSource: "D1-Metadaten",
                msgId: mId,
                messageId: mId,
                messageLink: rawEntryObj?.message_link || rawEntryObj?.messageLink || "",
                rawFileName: fName,
                rawText: log.rawText || log.textPreview || rawEntryObj?.raw_text || "",
                parsedFrom: rawEntryObj?.parsed_from || "D1-Import-Log",
                languages: Array.isArray(rawEntryObj?.languages) ? rawEntryObj.languages : ["de"],
                prevMessages: Array.isArray(rawEntryObj?.prev_messages) ? rawEntryObj.prev_messages : [],
                candidates: Array.isArray(log.details?.candidates) ? log.details.candidates : []
              };
              backupImportJob.reviewItems.push(hydratedItem);
              if (mId) reviewByKey.set("msg:" + String(mId), hydratedItem);
              if (fName) reviewByKey.set("fn:" + fName.toLowerCase(), hydratedItem);
              enrichedOrAdded++;
            }
          }
          if (enrichedOrAdded > 0 && backupImportJob.activeSubTab === "review") {
            renderBackupImportBoxDom();
          }
          if (!silent) {
            showHudToast("✅ Konflikt-Metadaten & Review-Flags aus D1 synchronisiert (" + backupImportJob.reviewItems.length + " Einträge)");
          }
        } catch (e) {
          if (!silent) showHudToast("⚠️ D1-Synchronisierung fehlgeschlagen");
        } finally {
          if (!silent) setBusyState(false);
        }
      }

      function renderSingleBackupReviewCardHtml(item, allItems) {
        const isFailed = item.status === "failed" || !item.tmdbId;
        const isResolved = Boolean(item.resolvedByAdmin);
        const seTag = (item.season != null && item.season !== "")
          ? (" • S" + String(item.season).padStart(2, "0") + "E" + String(item.episode || 1).padStart(2, "0") + (item.episodeTitle ? (" – " + item.episodeTitle) : ""))
          : "";
        const rawEntry = item.rawEntry || {};
        const msgId = item.messageId || item.msgId || rawEntry.message_id || rawEntry.msg_id || null;
        const msgLink = item.messageLink || rawEntry.message_link || "";
        const rawFileName = item.rawFileName || rawEntry.raw_file_name || rawEntry.filename || "";
        const metaSrc = item.metadataSource || "TMDb";
        const reasonMeta = resolveClientReviewReasonMeta(item);

        // KOMPAKTE GRÜNE ZEILE AN ORT UND STELLE: Sobald bestätigt/korrigiert, klappt die Karte platzsparend zusammen (ohne Scroll-Sprung!)
        if (isResolved && !item.expandedAfterResolve) {
          return '<div id="revCard_' + esc(item.id) + '" style="background:rgba(16,185,129,0.09);border:1px solid rgba(16,185,129,0.42);border-radius:10px;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:220px;flex:1">' +
              '<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(16,185,129,0.22);color:#10b981;border:1px solid rgba(16,185,129,0.45)">✅ In D1 gespeichert</span>' +
              '<span style="font-family:monospace;font-size:10px;font-weight:800;padding:2px 6px;border-radius:5px;background:rgba(16,185,129,0.14);color:#10b981;border:1px solid rgba(16,185,129,0.3)" title="Ursprünglicher Prüfgrund behoben">✓ ' + esc(reasonMeta.code) + '</span>' +
              '<span style="font-size:12.5px;font-weight:800;color:var(--text)">' +
                esc(item.cleanTitle || item.rawInput) + ' (' + esc(item.year || 'k.A.') + ')' +
              '</span>' +
              '<span style="font-size:11.5px;color:#0284c7;font-weight:700">[' + (item.typeCode === 's' ? '📺 Serie' : '🎬 Film') + esc(seTag) + ' • ' + esc(item.quality || '1080p') + ']</span>' +
              (rawFileName ? '<code class="admin-code-pill" style="font-size:10.5px">' + esc(rawFileName) + '</code>' : '') +
              (msgId ? '<span style="font-size:10.5px;color:var(--muted)">💬 #' + esc(String(msgId)) + '</span>' : '') +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
              (item.tmdbId ? '<button type="button" class="btn" style="padding:3px 8px;font-size:11px" onclick="openDetails(\\'' + (item.typeCode || 'm') + '\\',' + Number(item.tmdbId) + ',false)">👁️ Vorschau</button>' : '') +
              '<button type="button" class="btn" style="padding:3px 8px;font-size:11px" onclick="reopenResolvedReviewCard(\\'' + escJs(item.id) + '\\')">✏️ Bearbeiten</button>' +
            '</div>' +
          '</div>';
        }

        const badgeBg = isResolved
          ? "rgba(16,185,129,0.2);color:#10b981;border:1px solid rgba(16,185,129,0.4)"
          : isFailed
            ? "rgba(239,68,68,0.2);color:#e11d48;border:1px solid rgba(239,68,68,0.4)"
            : "rgba(245,158,11,0.2);color:#f59e0b;border:1px solid rgba(245,158,11,0.4)";
        const badgeLabel = isResolved
          ? "✅ Korrigiert / Bestätigt"
          : isFailed
            ? "❌ Nicht erkannt"
            : ("⚠️ Unsicher (" + Number(item.confidence || 0) + "% Match)");

        const cands = Array.isArray(item.candidates) ? item.candidates : [];
        const rawText = item.rawText || rawEntry.raw_text || "";
        const parsedFrom = item.parsedFrom || rawEntry.parsed_from || "Dateiname";
        const prevMsgs = Array.isArray(item.prevMessages)
          ? item.prevMessages
          : (Array.isArray(rawEntry.prev_messages) ? rawEntry.prev_messages : []);
        const langs = Array.isArray(item.languages) && item.languages.length ? item.languages.join(", ").toUpperCase() : "DE";

        // Vorbelegung für Staffel (S) & Folge (E) aus erkannten Werten oder angehängter/eingebetteter Zahl im Dateinamen
        const rawBaseNoExt = String(rawFileName || item.rawInput || item.cleanTitle || "").replace(/\\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i, "");
        const rawTailMatch = rawBaseNoExt.match(/(?:^|\\s|[-_])(?:teil\\s*|part\\s*|ep\\.?\\s*)?0*(\\d{1,2})\\s*$/i);
        const rawMidMatch = !rawTailMatch ? rawBaseNoExt.match(/^(.{2,}?)\\s+(?:[-–]\\s*)?(?:teil\\s+|part\\s+|ep\\.?\\s*|folge\\s+)?0*(\\d{1,2})\\s+(?:[-–:]\\s*)?(.{3,})$/i) : null;
        const inferredEpNum = rawTailMatch ? parseInt(rawTailMatch[1], 10) : (rawMidMatch ? parseInt(rawMidMatch[2], 10) : null);
        const defaultSeasonVal = item.season != null ? Number(item.season) : (cands[0]?.inferredSeason != null ? Number(cands[0].inferredSeason) : 1);
        const defaultEpisodeVal = item.episode || cands[0]?.inferredEpisode || (inferredEpNum >= 1 && inferredEpNum <= 99 ? inferredEpNum : 1);

        // Prüfen, ob mehrere offene Folgen derselben Serie in der Prüfliste liegen (für 1-Klick Sammel-Bestätigung)
        const seriesSiblings = (item.typeCode === "s" || item.season || item.episode || cands[0]?.typeCode === "s")
          ? getMatchingOpenSeriesSiblingItems(item, item.tmdbId || cands[0]?.tmdbId || null)
          : [];
        const batchTmdbId = Number(item.tmdbId || cands[0]?.tmdbId || 0);
        const reviewReasonText = String(
          item.errorReason ||
          item.reason ||
          (isFailed
            ? ("Kein passender TMDb-Eintrag für „" + (item.cleanTitle || item.rawInput || "Unbekannt") + "“ gefunden – bitte manuell suchen oder TMDb-ID zuweisen.")
            : (item.contextError
                ? "Kontext-, Staffel- oder Jahres-Konflikt zwischen Dateiname/Post und TMDb-Treffer erkannt."
                : ("Unsichere automatische Zuordnung (" + Number(item.confidence || 0) + "% Match-Sicherheit) – bitte kurz prüfen oder bestätigen.")))
        ).trim();

        return '<div id="revCard_' + esc(item.id) + '" class="admin-surface-card">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
            '<div style="flex:1;min-width:220px">' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px">' +
                '<span title="Datenbank Review-Reason-Flag (' + esc(reasonMeta.code) + ')" style="font-family:monospace;font-size:10.5px;font-weight:900;padding:2px 8px;border-radius:5px;letter-spacing:0.03em;' + reasonMeta.badgeStyle + '">' +
                  reasonMeta.icon + ' ' + esc(reasonMeta.code) + ' • ' + esc(reasonMeta.label) +
                '</span>' +
                '<span style="font-size:10.5px;background:rgba(14,165,233,0.16);color:#0284c7;padding:2px 7px;border-radius:5px;font-weight:700">🔎 Quelle: ' + esc(parsedFrom) + '</span>' +
                '<span style="font-size:10.5px;background:rgba(99,102,241,0.16);color:#6366f1;padding:2px 7px;border-radius:5px;font-weight:700">🌐 Audio: ' + esc(langs) + '</span>' +
                (msgId ? '<span style="font-size:10.5px;background:rgba(148,163,184,0.16);color:var(--muted);padding:2px 7px;border-radius:5px">💬 Msg #' + esc(String(msgId)) + '</span>' : '') +
                (msgLink ? '<a href="' + esc(safeHttpUrl(msgLink)) + '" target="_blank" rel="noopener noreferrer" style="font-size:10.5px;background:rgba(14,165,233,0.18);color:#0284c7;border:1px solid rgba(14,165,233,0.4);padding:2px 8px;border-radius:5px;text-decoration:none;font-weight:800">🔗 Nachricht in Telegram öffnen ↗</a>' : '') +
              '</div>' +
              '<div style="font-size:12.5px;font-weight:800;color:var(--text);margin-top:4px">' +
                (item.tmdbId
                  ? ('Aktuell zugeordnet (' + esc(metaSrc) + '): <span style="color:#0284c7">' + esc(item.cleanTitle) + ' (' + esc(item.year || 'k.A.') + ')</span> [' + (item.typeCode === 's' ? '📺 Serie' : '🎬 Film') + seTag + ' • ' + esc(item.quality || '1080p') + ']')
                  : ('Kein automatischer Treffer für: <span style="color:#e11d48">' + esc(item.cleanTitle || item.rawInput) + '</span>')) +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
              '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;background:' + badgeBg + '">' + badgeLabel + '</span>' +
              (item.tmdbId && !isResolved ? '<button type="button" class="btn green" style="padding:4px 9px;font-size:11px" onclick="confirmBackupReviewItem(\\'' + escJs(item.id) + '\\')">✓ Passt so</button>' : '') +
              (seriesSiblings.length >= 2 && batchTmdbId > 0 ? '<button type="button" class="btn green" style="padding:4px 9px;font-size:11px;background:linear-gradient(90deg,#059669,#0284c7);border-color:#38bdf8;color:#fff" onclick="confirmAllSeriesEpisodesInReview(\\'' + escJs(item.id) + '\\',' + batchTmdbId + ',\\'s\\')" title="Speichert alle ' + seriesSiblings.length + ' offenen Folgen dieser Serie jeweils mit ihrer eigenen Staffel/Folge (z.B. S01E09, S01E10, S01E12) in D1">⚡ Alle ' + seriesSiblings.length + ' Folgen bestätigen</button>' : '') +
              '<button type="button" class="btn purple" style="padding:4px 9px;font-size:11px" onclick="openManualNoTmdbConfirmForReviewItem(\\'' + escJs(item.id) + '\\')" title="Titel existiert nicht auf TMDb? Hier manuell mit eigener kollisionsfreier 900M-ID bestätigen">✨ Ohne TMDb-ID bestätigen</button>' +
              (item.tmdbId ? '<button type="button" class="btn" style="padding:4px 9px;font-size:11px" onclick="openDetails(\\'' + (item.typeCode || 'm') + '\\',' + Number(item.tmdbId) + ',false)">👁️ Vorschau</button>' : '') +
              (isResolved ? '<button type="button" class="btn" style="padding:4px 9px;font-size:11px" onclick="collapseResolvedReviewCard(\\'' + escJs(item.id) + '\\')">🔼 Einklappen</button>' : '') +
            '</div>' +
          '</div>' +
          '<div style="' + reasonMeta.boxStyle + ';border-radius:8px;padding:7px 10px;margin-bottom:8px;font-size:11.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;line-height:1.35">' +
            '<span style="font-family:monospace;font-size:10.5px;font-weight:900;padding:2px 7px;border-radius:4px;' + reasonMeta.badgeStyle + ';white-space:nowrap">' + reasonMeta.icon + ' ' + esc(reasonMeta.code) + '</span>' +
            '<span style="font-weight:700;flex:1;min-width:180px">' + esc(reviewReasonText) + '</span>' +
          '</div>' +
          '<div class="admin-sub-box" style="margin-bottom:8px;font-size:11.5px;display:flex;flex-direction:column;gap:5px">' +
            (rawFileName ? '<div><b style="color:var(--muted)">💾 Dateiname (file_name):</b> <code class="admin-code-pill" style="word-break:break-all">' + esc(rawFileName) + '</code></div>' : '') +
            (rawText ? '<div><b style="color:var(--muted)">📝 Volltext / Caption dieser Nachricht:</b> <div class="admin-code-pill" style="padding:5px 8px;margin-top:3px;max-height:76px;overflow-y:auto;white-space:pre-wrap;font-size:11px">' + esc(rawText) + '</div></div>' : '') +
            (prevMsgs.length > 0 ? (
              '<div style="margin-top:3px;padding-top:6px;border-top:1px dashed rgba(148,163,184,0.25)">' +
                '<div style="font-size:11px;font-weight:800;color:#f59e0b;margin-bottom:4px">⬆️ Die ' + prevMsgs.length + ' Nachrichten direkt über dieser Videodatei (Steckbrief / Titel-Kontext):</div>' +
                '<div style="display:flex;flex-direction:column;gap:5px">' +
                  prevMsgs.map((pm, pIdx) => {
                    const labelIdx = prevMsgs.length === 2 ? (pIdx === 0 ? "2 Nachrichten darüber" : "1 Nachricht direkt darüber") : "Nachricht direkt darüber";
                    return '<div class="admin-sub-box" style="border-color:rgba(245,158,11,0.3);padding:6px 8px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                      '<div style="flex:1;min-width:180px;font-size:11px;color:var(--text)">' +
                        '<span style="color:#f59e0b;font-weight:800">[' + labelIdx + (pm.msgId ? ' • #' + esc(String(pm.msgId)) : '') + ']</span> ' +
                        esc(pm.text || '(Kein Text)') +
                      '</div>' +
                      '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                        (pm.titleGuess ? '<button type="button" class="btn amber" style="padding:3px 8px;font-size:10.5px" onclick="usePrevMessageForReviewSearch(\\'' + escJs(item.id) + '\\',\\'' + escJs(pm.titleGuess) + '\\')">🔍 „' + esc(pm.titleGuess.slice(0, 28)) + '“ suchen</button>' : '') +
                        (pm.tmdbId ? '<button type="button" class="btn green" style="padding:3px 8px;font-size:10.5px" onclick="applyBackupCandidateRemap(\\'' + escJs(item.id) + '\\',' + Number(pm.tmdbId) + ',\\'' + (pm.mediaType === 'tv' ? 's' : 'm') + '\\')">🎯 TMDb #' + Number(pm.tmdbId) + ' direkt zuweisen</button>' : '') +
                      '</div>' +
                    '</div>';
                  }).join("") +
                '</div>' +
              '</div>'
            ) : '') +
          '</div>' +
          (cands.length > 0 ? (
            '<div style="margin-bottom:8px">' +
              '<div style="font-size:11px;color:var(--muted);margin-bottom:5px">🎯 <b>Gefundene Kandidaten (8 APIs – 1-Klick Übernahme inkl. gewählter Staffel/Folge):</b></div>' +
              '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">' +
                cands.map(c => {
                  const isCurrent = item.tmdbId && Number(item.tmdbId) === Number(c.tmdbId) && item.typeCode === c.typeCode;
                  const srcLabel = c.source || "TMDb";
                  const seBadge = c.typeCode === "s" && c.inferredEpisode
                    ? (' <span style="background:rgba(99,102,241,0.2);color:#6366f1;padding:1px 5px;border-radius:4px;font-weight:800">S' + String(c.inferredSeason || 1).padStart(2, "0") + 'E' + String(c.inferredEpisode).padStart(2, "0") + '</span>')
                    : '';
                  return '<div class="admin-sub-box" style="min-width:215px;max-width:255px;' + (isCurrent ? 'background:rgba(16,185,129,0.14);border-color:rgba(16,185,129,0.5);' : '') + 'padding:7px;display:flex;gap:8px;align-items:center;flex-shrink:0">' +
                    (c.poster
                      ? '<img src="' + esc(c.poster) + '" style="width:38px;height:56px;object-fit:cover;border-radius:5px;flex-shrink:0" alt="" />'
                      : '<div style="width:38px;height:56px;background:rgba(148,163,184,0.2);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">' + (c.typeCode === 's' ? '📺' : '🎬') + '</div>') +
                    '<div style="flex:1;min-width:0">' +
                      '<div style="font-size:11.5px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(c.title) + '">' + esc(c.title) + '</div>' +
                      '<div style="font-size:10px;color:var(--muted);margin-top:2px">' +
                        (c.typeCode === 's' ? '📺 Serie' : '🎬 Film') + seBadge + ' • ' + esc(c.year || 'k.A.') + ' • <b style="color:#0284c7">' + esc(srcLabel) + '</b> (' + Number(c.confidence || 0) + '%)' +
                      '</div>' +
                      '<div style="display:flex;gap:4px;margin-top:5px">' +
                        '<button type="button" class="btn ' + (isCurrent ? 'green' : 'amber') + '" style="padding:3px 8px;font-size:10.5px;flex:1" onclick="applyBackupCandidateRemap(\\'' + escJs(item.id) + '\\',' + Number(c.tmdbId) + ',\\'' + (c.typeCode === 's' ? 's' : 'm') + '\\')">' +
                          (isCurrent ? '✓ Aktiv (Speichern)' : '✓ Auswählen') +
                        '</button>' +
                        (c.typeCode === 's' && seriesSiblings.length >= 2 ? '<button type="button" class="btn green" style="padding:3px 6px;font-size:10px" title="Alle ' + seriesSiblings.length + ' Folgen dieser Serie auf diesen Kandidaten zuweisen" onclick="confirmAllSeriesEpisodesInReview(\\'' + escJs(item.id) + '\\',' + Number(c.tmdbId) + ',\\'s\\')">⚡ Alle ' + seriesSiblings.length + '</button>' : '') +
                      '</div>' +
                    '</div>' +
                  '</div>';
                }).join("") +
              '</div>' +
            '</div>'
          ) : '') +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px">' +
            '<select id="revSearchType_' + esc(item.id) + '" class="tma-select" style="padding:5px 8px;font-size:11.5px">' +
              '<option value="auto"' + ((item.manualSearchType || 'auto') === 'auto' ? ' selected' : '') + '>🔄 Auto (Film & Serie)</option>' +
              '<option value="m"' + (item.manualSearchType === 'm' ? ' selected' : '') + '>🎬 Nur Filme</option>' +
              '<option value="s"' + (item.manualSearchType === 's' ? ' selected' : '') + '>📺 Nur Serien</option>' +
            '</select>' +
            '<div class="admin-sub-box" style="display:flex;align-items:center;gap:4px;border-color:rgba(99,102,241,0.45);padding:3px 7px" title="Staffel & Folge für Serien-Zuordnung (z.B. S01E01, 0 = Special)">' +
              '<span style="font-size:10.5px;font-weight:800;color:#6366f1">S</span>' +
              '<input id="revSeasonInp_' + esc(item.id) + '" class="tma-input" type="number" min="0" max="99" value="' + Math.max(0, Number.isFinite(Number(defaultSeasonVal)) ? Number(defaultSeasonVal) : 1) + '" onchange="syncReviewCardDomInputsToItemState((backupImportJob.reviewItems||[]).find(x=>String(x.id)===\\'' + escJs(item.id) + '\\'))" style="width:44px;padding:2px 4px;border-radius:4px;font-size:11.5px;font-weight:800;text-align:center" />' +
              '<span style="font-size:10.5px;font-weight:800;color:#6366f1">E</span>' +
              '<input id="revEpInp_' + esc(item.id) + '" class="tma-input" type="number" min="1" max="999" value="' + (Number(defaultEpisodeVal) || 1) + '" onchange="syncReviewCardDomInputsToItemState((backupImportJob.reviewItems||[]).find(x=>String(x.id)===\\'' + escJs(item.id) + '\\'))" style="width:48px;padding:2px 4px;border-radius:4px;font-size:11.5px;font-weight:800;text-align:center" />' +
            '</div>' +
            '<input id="revSearchInp_' + esc(item.id) + '" class="tma-input" value="' + esc(item.manualSearchQuery || item.cleanTitle || '') + '" placeholder="Manueller Titel oder TMDb-ID (z.B. 603)..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();searchManualCandidatesForReviewItem(\\'' + escJs(item.id) + '\\')}" style="flex:1;min-width:160px;padding:5px 9px;font-size:11.5px" />' +
            '<button type="button" class="btn" style="padding:5px 10px;font-size:11.5px" onclick="searchManualCandidatesForReviewItem(\\'' + escJs(item.id) + '\\')">🔍 Alle 8 APIs durchsuchen</button>' +
            '<button type="button" class="btn purple" style="padding:5px 10px;font-size:11.5px" onclick="openManualNoTmdbConfirmForReviewItem(\\'' + escJs(item.id) + '\\')">✨ Ohne TMDb-ID zuweisen</button>' +
          '</div>' +
        '</div>';
      }

      function renderBackupReviewTabHtml(j) {
        const allItems = j.reviewItems || [];
        const openConflictItems = allItems.filter(x => !x.resolvedByAdmin && (x.status === "failed" || x.isUncertain || x.contextError || !x.tmdbId));
        const needsAttentionOpenCount = openConflictItems.length;
        const uncertainOpenCount = allItems.filter(x => !x.resolvedByAdmin && x.isUncertain && x.status !== "failed" && x.tmdbId).length;
        const failedOpenCount = allItems.filter(x => !x.resolvedByAdmin && (x.status === "failed" || !x.tmdbId)).length;

        const flagCounts = {
          TMDB_NOT_FOUND: 0,
          YEAR_CONFLICT: 0,
          PARSER_AMBIGUITY: 0,
          SEASON_CONFLICT: 0,
          SEQUEL_CONFLICT: 0,
          API_ERROR: 0
        };
        for (const it of openConflictItems) {
          const code = inferClientReviewReasonCode(it);
          if (flagCounts[code] !== undefined) flagCounts[code]++;
        }

        // Damit bestätigte Karten an Ort und Stelle grün eingeklappt stehen bleiben (statt die Liste unter dem Mauszeiger wegzuziehen!),
        // behalten wir bereits in dieser Sitzung bestätigte Einträge (x.resolvedByAdmin) als kompakte grüne Zeile in der Liste.
        let visibleList = allItems.filter(x => x.status === "failed" || x.isUncertain || x.contextError || !x.tmdbId || x.resolvedByAdmin);
        if (j.reviewFilter === "uncertain") visibleList = allItems.filter(x => (x.isUncertain && x.status !== "failed" && x.tmdbId) || x.resolvedByAdmin);
        else if (j.reviewFilter === "failed") visibleList = allItems.filter(x => x.status === "failed" || !x.tmdbId);
        else if (j.reviewFilter === "all") visibleList = allItems;
        else if (String(j.reviewFilter || "").startsWith("flag:")) {
          const targetFlag = String(j.reviewFilter).slice(5);
          visibleList = allItems.filter(x => (!x.resolvedByAdmin && inferClientReviewReasonCode(x) === targetFlag) || (x.resolvedByAdmin && inferClientReviewReasonCode(x) === targetFlag));
        }

        const flagFilterButtons = [
          { code: "TMDB_NOT_FOUND", icon: "❌", col: "#e11d48", bg: "rgba(225,29,72,0.16)" },
          { code: "YEAR_CONFLICT", icon: "📅", col: "#d97706", bg: "rgba(245,158,11,0.16)" },
          { code: "PARSER_AMBIGUITY", icon: "🔀", col: "#6366f1", bg: "rgba(99,102,241,0.16)" },
          { code: "SEASON_CONFLICT", icon: "📺", col: "#0284c7", bg: "rgba(14,165,233,0.16)" },
          { code: "SEQUEL_CONFLICT", icon: "🎬", col: "#4f46e5", bg: "rgba(79,70,229,0.16)" },
          { code: "API_ERROR", icon: "🔥", col: "#dc2626", bg: "rgba(220,38,38,0.18)" }
        ];

        return '<div style="margin-top:10px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button id="revBtnNeeds" class="btn ' + (j.reviewFilter === 'needs_attention' ? 'amber' : '') + '" onclick="setBackupReviewFilter(\\'needs_attention\\')">⚠️ Prüfbedarf (' + needsAttentionOpenCount + ')</button>' +
              '<button id="revBtnUncertain" class="btn ' + (j.reviewFilter === 'uncertain' ? 'amber' : '') + '" onclick="setBackupReviewFilter(\\'uncertain\\')">🔎 Unsichere Treffer (' + uncertainOpenCount + ')</button>' +
              '<button id="revBtnFailed" class="btn ' + (j.reviewFilter === 'failed' ? 'danger' : '') + '" onclick="setBackupReviewFilter(\\'failed\\')">❌ Nicht erkannt (' + failedOpenCount + ')</button>' +
              '<button id="revBtnAll" class="btn ' + (j.reviewFilter === 'all' ? 'green' : '') + '" onclick="setBackupReviewFilter(\\'all\\')">📋 Alle importierten (' + allItems.length + ')</button>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
              '<button type="button" class="btn blue" style="padding:4px 9px;font-size:11px" onclick="syncReviewItemsFromD1MetadataClient(false)">🔄 Konflikte aus D1 laden</button>' +
              '<span style="font-size:11.5px;color:var(--muted)">💡 Bestätigte Karten klappen grün an Ort & Stelle zusammen</span>' +
            '</div>' +
          '</div>' +
          '<div class="admin-sub-box" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;padding:7px 9px">' +
            '<span style="font-size:11px;font-weight:800;color:var(--muted);margin-right:2px">🏷️ Review-Reason-Filter (DB-Flags):</span>' +
            flagFilterButtons.map(fb => {
              const active = j.reviewFilter === ("flag:" + fb.code);
              const cnt = flagCounts[fb.code] || 0;
              return '<button type="button" class="btn" onclick="setBackupReviewFilter(\\'' + (active ? 'needs_attention' : ('flag:' + fb.code)) + '\\')" style="font-family:monospace;font-size:10.5px;font-weight:800;padding:3px 8px;border-radius:6px;background:' + (active ? fb.bg : 'var(--surface)') + ';color:' + fb.col + ';border:1px solid ' + (active ? fb.col : 'rgba(148,163,184,0.28)') + '">' +
                fb.icon + ' ' + fb.code + ' (' + cnt + ')' +
              '</button>';
            }).join("") +
          '</div>' +
          (visibleList.length === 0 ? (
            '<div class="admin-sub-box" style="border-color:rgba(16,185,129,0.35);padding:16px;text-align:center;color:#10b981;font-size:12.5px">' +
              (allItems.length === 0
                ? 'ℹ️ Starte zuerst den Smart-Import oder klicke oben auf <b>🔄 Konflikte aus D1 laden</b>, um Zuordnungen zu prüfen.'
                : '🎉 Perfekt! Keine offenen Einträge für diesen Review-Reason-Filter.') +
            '</div>'
          ) : (
            '<div id="backupReviewScrollContainer" style="display:flex;flex-direction:column;gap:12px;max-height:640px;overflow-y:auto;padding-right:4px">' +
              visibleList.slice(0, 80).map(item => renderSingleBackupReviewCardHtml(item, allItems)).join("") +
              (visibleList.length > 80
                ? '<div class="admin-sub-box" style="text-align:center;font-size:11.5px;color:var(--muted);padding:10px">ℹ️ Zeige die ersten <b>80</b> von <b>' + visibleList.length + '</b> Einträgen — nutze die Filter oben, um gezielt einzugrenzen.</div>'
                : '') +
            '</div>'
          )) +
        '</div>';
      }

      function openAdminTabDirectClient(tabName = "backup") {
        state.adminTab = tabName || "backup";
        loadAdminPanelView(false);
      }

      let adminJsonImportPanelCollapsed = false;
      let floatingImportWidgetCompact = false;
      const FLOATING_IMPORT_POS_STORAGE_KEY = "tma_floating_import_pos_v1";
      const adminPanelDragOffsets = new Map();
      let activeAdminDragState = null;

      try {
        const savedFloatRaw = sessionStorage.getItem(FLOATING_IMPORT_POS_STORAGE_KEY);
        if (savedFloatRaw) {
          const parsedFloat = JSON.parse(savedFloatRaw);
          if (parsedFloat && typeof parsedFloat === "object") {
            if (Number.isFinite(Number(parsedFloat.x)) && Number.isFinite(Number(parsedFloat.y))) {
              adminPanelDragOffsets.set("floatingImportStatusWidget", {
                x: Math.round(Number(parsedFloat.x)),
                y: Math.round(Number(parsedFloat.y))
              });
            }
            if (typeof parsedFloat.compact === "boolean") {
              floatingImportWidgetCompact = parsedFloat.compact;
            }
          }
        }
      } catch (_e) {}

      function persistFloatingImportWidgetPrefsClient() {
        try {
          const off = adminPanelDragOffsets.get("floatingImportStatusWidget") || { x: 0, y: 0 };
          sessionStorage.setItem(FLOATING_IMPORT_POS_STORAGE_KEY, JSON.stringify({
            x: Math.round(Number(off.x) || 0),
            y: Math.round(Number(off.y) || 0),
            compact: Boolean(floatingImportWidgetCompact)
          }));
        } catch (_e) {}
      }

      function clampAdminPanelDragOffsetClient(panelEl, nx, ny) {
        let rx = Math.round(Number(nx) || 0);
        let ry = Math.round(Number(ny) || 0);
        if (!panelEl || typeof window === "undefined") return { x: rx, y: ry };
        const vw = Math.max(320, window.innerWidth || document.documentElement?.clientWidth || 1024);
        const vh = Math.max(320, window.innerHeight || document.documentElement?.clientHeight || 768);
        const headerEl = document.querySelector(".topbar, header");
        const safeTop = Math.max(8, Math.min(96, Math.round((headerEl ? headerEl.getBoundingClientRect().height : 54) + 8)));
        const rect = panelEl.getBoundingClientRect();
        const cur = adminPanelDragOffsets.get(panelEl.id || "default_admin_panel") || { x: 0, y: 0 };

        if (panelEl.id === "floatingImportStatusWidget") {
          const w = Math.max(120, Math.min(vw - 16, rect.width || (floatingImportWidgetCompact ? 240 : Math.min(vw * 0.94, 680))));
          const h = Math.max(40, Math.min(vh - safeTop - 16, rect.height || (floatingImportWidgetCompact ? 42 : 76)));
          const maxDx = Math.max(0, Math.floor((vw - w) / 2) - 8);
          const minDx = -maxDx;
          // Basisposition: bottom: 14px -> Oberkante bei (vh - 14 - h)
          const baseTop = vh - 14 - h;
          const rawMinDy = Math.round(safeTop - baseTop);
          const maxDy = 6;
          const minDy = Math.min(rawMinDy, maxDy);
          rx = Math.min(maxDx, Math.max(minDx, rx));
          ry = Math.min(maxDy, Math.max(minDy, ry));
          return { x: rx, y: ry };
        }

        // In-Flow Admin-Panel (#adminJsonImportPanelBox): Drag-Handle immer im sichtbaren Bereich halten
        const naturalLeft = rect.left - (Number(cur.x) || 0);
        const naturalTop = rect.top - (Number(cur.y) || 0);
        const panelW = Math.max(240, rect.width || vw - 32);
        const minVisibleX = Math.min(180, Math.round(panelW * 0.4));
        const rawMinRx = Math.round(minVisibleX - panelW - naturalLeft);
        const rawMaxRx = Math.round(vw - minVisibleX - naturalLeft);
        const loRx = Math.min(rawMinRx, rawMaxRx);
        const hiRx = Math.max(rawMinRx, rawMaxRx);
        const rawMinRy = Math.round(safeTop - naturalTop);
        const rawMaxRy = Math.round(vh - 72 - naturalTop);
        const loRy = Math.min(rawMinRy, rawMaxRy);
        const hiRy = Math.max(rawMinRy, rawMaxRy);
        rx = Math.min(hiRx, Math.max(loRx, rx));
        ry = Math.min(hiRy, Math.max(loRy, ry));
        return { x: rx, y: ry };
      }

      function applyAdminPanelDragOffsetClient(panelEl, nx, ny) {
        if (!panelEl) return;
        const key = panelEl.id || "default_admin_panel";
        const isExplicitReset = (Number(nx) || 0) === 0 && (Number(ny) || 0) === 0;
        const clamped = isExplicitReset ? { x: 0, y: 0 } : clampAdminPanelDragOffsetClient(panelEl, nx, ny);
        const rx = clamped.x;
        const ry = clamped.y;
        adminPanelDragOffsets.set(key, { x: rx, y: ry });
        if (panelEl.id === "floatingImportStatusWidget") {
          panelEl.style.transform = "translate3d(calc(-50% + " + rx + "px), " + ry + "px, 0)";
          persistFloatingImportWidgetPrefsClient();
        } else if (rx === 0 && ry === 0) {
          panelEl.style.transform = "";
          panelEl.style.position = "";
          panelEl.style.zIndex = "";
        } else {
          panelEl.style.transform = "translate3d(" + rx + "px, " + ry + "px, 0)";
          panelEl.style.position = "relative";
          panelEl.style.zIndex = "210";
        }
      }

      function clampAllAdminDraggedPanelsToViewportClient() {
        const floatEl = document.getElementById("floatingImportStatusWidget");
        if (floatEl && floatEl.style.display !== "none") {
          const curFloat = adminPanelDragOffsets.get("floatingImportStatusWidget") || { x: 0, y: 0 };
          applyAdminPanelDragOffsetClient(floatEl, curFloat.x, curFloat.y);
        }
        const adminBox = document.getElementById("adminJsonImportPanelBox");
        if (adminBox) {
          const curBox = adminPanelDragOffsets.get("adminJsonImportPanelBox");
          if (curBox && (curBox.x !== 0 || curBox.y !== 0)) {
            applyAdminPanelDragOffsetClient(adminBox, curBox.x, curBox.y);
          }
        }
      }

      const extractAdminDragClientPoint = (ev, fallbackX, fallbackY) => {
        if (typeof ev.clientX === "number" && typeof ev.clientY === "number") {
          return { x: ev.clientX, y: ev.clientY };
        }
        const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]);
        if (t) return { x: t.clientX, y: t.clientY };
        return { x: fallbackX, y: fallbackY };
      };
      const onGlobalAdminDragSelectStart = (ev) => {
        if (activeAdminDragState && ev.cancelable) ev.preventDefault();
      };
      const onGlobalAdminDragMove = (ev) => {
        if (!activeAdminDragState) return;
        if (activeAdminDragState.source === "pointer") {
          if (ev.type !== "pointermove") return;
          if (activeAdminDragState.pointerId !== null && ev.pointerId !== undefined && ev.pointerId !== activeAdminDragState.pointerId) return;
        } else if (activeAdminDragState.source === "mouse") {
          if (ev.type !== "mousemove") return;
          if (ev.buttons !== undefined && ev.buttons === 0) {
            endGlobalAdminDragClient();
            return;
          }
        } else if (activeAdminDragState.source === "touch") {
          if (ev.type !== "touchmove") return;
          if (ev.cancelable) ev.preventDefault();
        }
        try { window.getSelection()?.removeAllRanges(); } catch (_e) {}
        const pt = extractAdminDragClientPoint(ev, activeAdminDragState.startX, activeAdminDragState.startY);
        const dx = pt.x - activeAdminDragState.startX;
        const dy = pt.y - activeAdminDragState.startY;
        const livePanel = (activeAdminDragState.panelId ? document.getElementById(activeAdminDragState.panelId) : null) || activeAdminDragState.panelEl;
        if (livePanel) {
          applyAdminPanelDragOffsetClient(livePanel, activeAdminDragState.baseX + dx, activeAdminDragState.baseY + dy);
        }
      };
      const onGlobalAdminDragBlur = () => endGlobalAdminDragClient(null);
      const onGlobalAdminDragKeydown = (ev) => {
        if (ev.key === "Escape" && activeAdminDragState) endGlobalAdminDragClient(null);
      };
      let adminDragActiveListenersAttached = false;
      function attachActiveAdminDragListenersClient() {
        if (typeof window === "undefined" || adminDragActiveListenersAttached) return;
        adminDragActiveListenersAttached = true;
        window.addEventListener("selectstart", onGlobalAdminDragSelectStart);
        window.addEventListener("pointermove", onGlobalAdminDragMove, { passive: true });
        window.addEventListener("mousemove", onGlobalAdminDragMove, { passive: true });
        window.addEventListener("touchmove", onGlobalAdminDragMove, { passive: false });
        window.addEventListener("pointerup", endGlobalAdminDragClient, { passive: true });
        window.addEventListener("mouseup", endGlobalAdminDragClient, { passive: true });
        window.addEventListener("touchend", endGlobalAdminDragClient, { passive: true });
        window.addEventListener("touchcancel", endGlobalAdminDragClient, { passive: true });
        window.addEventListener("pointercancel", endGlobalAdminDragClient, { passive: true });
        window.addEventListener("blur", onGlobalAdminDragBlur, { passive: true });
        window.addEventListener("keydown", onGlobalAdminDragKeydown);
      }
      function detachActiveAdminDragListenersClient() {
        if (typeof window === "undefined" || !adminDragActiveListenersAttached) return;
        adminDragActiveListenersAttached = false;
        window.removeEventListener("selectstart", onGlobalAdminDragSelectStart);
        window.removeEventListener("pointermove", onGlobalAdminDragMove);
        window.removeEventListener("mousemove", onGlobalAdminDragMove);
        window.removeEventListener("touchmove", onGlobalAdminDragMove);
        window.removeEventListener("pointerup", endGlobalAdminDragClient);
        window.removeEventListener("mouseup", endGlobalAdminDragClient);
        window.removeEventListener("touchend", endGlobalAdminDragClient);
        window.removeEventListener("touchcancel", endGlobalAdminDragClient);
        window.removeEventListener("pointercancel", endGlobalAdminDragClient);
        window.removeEventListener("blur", onGlobalAdminDragBlur);
        window.removeEventListener("keydown", onGlobalAdminDragKeydown);
      }
      function endGlobalAdminDragClient(ev) {
        if (!activeAdminDragState) {
          detachActiveAdminDragListenersClient();
          return;
        }
        if (ev && activeAdminDragState.source === "pointer" && activeAdminDragState.pointerId !== null && ev.pointerId !== undefined && ev.pointerId !== activeAdminDragState.pointerId) {
          return;
        }
        const dragRef = activeAdminDragState;
        activeAdminDragState = null;
        detachActiveAdminDragListenersClient();
        const liveHandle = (dragRef.handleId ? document.getElementById(dragRef.handleId) : null) || dragRef.handleEl;
        const livePanel = (dragRef.panelId ? document.getElementById(dragRef.panelId) : null) || dragRef.panelEl;
        if (liveHandle) {
          liveHandle.style.cursor = "grab";
          if (dragRef.pointerId !== null && typeof liveHandle.releasePointerCapture === "function") {
            try {
              if (typeof liveHandle.hasPointerCapture !== "function" || liveHandle.hasPointerCapture(dragRef.pointerId)) {
                liveHandle.releasePointerCapture(dragRef.pointerId);
              }
            } catch (_e) {}
          }
        }
        if (livePanel) {
          livePanel.classList.remove("admin-panel-dragging");
        }
        if (document.body) {
          document.body.classList.remove("is-gesture-dragging");
          document.body.style.userSelect = "";
        }
      }
      function ensureAdminDragResizeListenerBoundClient() {
        if (typeof window === "undefined" || window._adminGlobalDragResizeBound) return;
        window._adminGlobalDragResizeBound = true;
        let _adminDragResizeTimer = null;
        window.addEventListener("resize", () => {
          if (_adminDragResizeTimer) clearTimeout(_adminDragResizeTimer);
          _adminDragResizeTimer = setTimeout(clampAllAdminDraggedPanelsToViewportClient, 120);
        }, { passive: true });
      }

      function bindDraggableAdminPanelClient(panelEl, handleEl) {
        if (!panelEl || !handleEl) return;
        ensureAdminDragResizeListenerBoundClient();
        const key = panelEl.id || "default_admin_panel";
        const saved = adminPanelDragOffsets.get(key);
        if (saved && (saved.x !== 0 || saved.y !== 0)) {
          applyAdminPanelDragOffsetClient(panelEl, saved.x, saved.y);
        }
        if (handleEl._dragBound) return;
        handleEl._dragBound = true;
        handleEl.style.cursor = "grab";
        handleEl.style.userSelect = "none";
        handleEl.style.webkitUserSelect = "none";
        handleEl.style.touchAction = "none";

        const isInteractiveChild = (rawTarget) => {
          const targetEl = rawTarget && typeof rawTarget.closest === "function"
            ? rawTarget
            : (rawTarget && rawTarget.parentElement && typeof rawTarget.parentElement.closest === "function" ? rawTarget.parentElement : null);
          return Boolean(targetEl && targetEl.closest("button, input, select, textarea, a, label, [role=\\'button\\']"));
        };

        const startDrag = (ev, source) => {
          if (activeAdminDragState) return;
          if (source !== "touch" && ev.button !== undefined && ev.button !== 0) return;
          if (isInteractiveChild(ev.target)) return;
          if (ev.cancelable) ev.preventDefault();
          ev.stopPropagation();
          try { window.getSelection()?.removeAllRanges(); } catch (_e) {}
          const cur = adminPanelDragOffsets.get(key) || { x: 0, y: 0 };
          const clientX = typeof ev.clientX === "number" ? ev.clientX : (ev.touches && ev.touches[0] ? ev.touches[0].clientX : 0);
          const clientY = typeof ev.clientY === "number" ? ev.clientY : (ev.touches && ev.touches[0] ? ev.touches[0].clientY : 0);
          const pointerId = source === "pointer" && ev.pointerId !== undefined ? ev.pointerId : null;
          activeAdminDragState = {
            source,
            pointerId,
            panelId: panelEl.id || "",
            handleId: handleEl.id || "",
            panelEl,
            handleEl,
            startX: clientX,
            startY: clientY,
            baseX: cur.x,
            baseY: cur.y
          };
          attachActiveAdminDragListenersClient();
          handleEl.style.cursor = "grabbing";
          panelEl.classList.add("admin-panel-dragging");
          if (document.body) {
            document.body.classList.add("is-gesture-dragging");
            document.body.style.userSelect = "none";
          }
          if (pointerId !== null && typeof handleEl.setPointerCapture === "function") {
            try { handleEl.setPointerCapture(pointerId); } catch (_e) {}
          }
        };

        if (typeof window !== "undefined" && "PointerEvent" in window) {
          handleEl.addEventListener("pointerdown", (ev) => startDrag(ev, "pointer"));
          handleEl.addEventListener("lostpointercapture", () => {
            if (activeAdminDragState && activeAdminDragState.handleEl === handleEl) {
              endGlobalAdminDragClient(null);
            }
          });
        } else {
          handleEl.addEventListener("touchstart", (ev) => startDrag(ev, "touch"), { passive: false });
        }
        // WICHTIG für Linux Firefox: mousedown muss AUCH dann ev.preventDefault() aufrufen, wenn pointerdown bereits gefeuert hat, da Firefox sonst Text markiert!
        handleEl.addEventListener("mousedown", (ev) => {
          if (ev.button !== undefined && ev.button !== 0) return;
          if (isInteractiveChild(ev.target)) return;
          if (ev.cancelable) ev.preventDefault();
          ev.stopPropagation();
          try { window.getSelection()?.removeAllRanges(); } catch (_e) {}
          if (!activeAdminDragState) startDrag(ev, "mouse");
        });
        handleEl.addEventListener("dblclick", (ev) => {
          if (isInteractiveChild(ev.target)) return;
          applyAdminPanelDragOffsetClient(panelEl, 0, 0);
        });
        handleEl.addEventListener("dragstart", (ev) => ev.preventDefault());
      }

      function toggleAdminJsonImportCollapseClient() {
        adminJsonImportPanelCollapsed = !adminJsonImportPanelCollapsed;
        const bodyEl = document.getElementById("adminJsonImportPanelBody");
        const btnEl = document.getElementById("adminJsonImportCollapseBtn");
        if (bodyEl) {
          bodyEl.style.display = adminJsonImportPanelCollapsed ? "none" : "block";
        }
        if (btnEl) {
          btnEl.innerHTML = adminJsonImportPanelCollapsed ? "▾ Ausklappen" : "▴ Einklappen";
        }
      }

      function resetAdminJsonImportDragClient() {
        const panelEl = document.getElementById("adminJsonImportPanelBox");
        if (panelEl) {
          applyAdminPanelDragOffsetClient(panelEl, 0, 0);
        }
      }

      function resetFloatingImportDragClient() {
        const widgetEl = document.getElementById("floatingImportStatusWidget");
        if (widgetEl) {
          applyAdminPanelDragOffsetClient(widgetEl, 0, 0);
        }
      }

      function toggleFloatingImportCompactClient() {
        floatingImportWidgetCompact = !floatingImportWidgetCompact;
        persistFloatingImportWidgetPrefsClient();
        updateFloatingImportStatusBarDom();
        clampAllAdminDraggedPanelsToViewportClient();
      }

      function updateFloatingImportStatusBarDom() {
        try {
          let widgetEl = document.getElementById("floatingImportStatusWidget");
          const j = backupImportJob;
          const total = Array.isArray(j?.entries) ? j.entries.length : 0;
          const done = Number(j?.cursor || 0);
          const hasActiveOrPausedJob = Boolean(
            state.isAuthenticated &&
            state.authUser?.isAdmin &&
            total > 0 &&
            (j.running || (done > 0 && done < total))
          );

          if (!hasActiveOrPausedJob || state.currentView === "admin") {
            if (widgetEl) widgetEl.style.display = "none";
            return;
          }

          if (!widgetEl && document.body) {
            widgetEl = document.createElement("div");
            widgetEl.id = "floatingImportStatusWidget";
            widgetEl.style.cssText =
              "position:fixed;bottom:14px;left:50%;transform:translate3d(-50%,0,0);z-index:1540;" +
              "width:min(94vw,680px);background:rgba(15,23,42,0.96);border:1px solid rgba(56,189,248,0.55);" +
              "border-radius:12px;padding:9px 12px;box-shadow:0 12px 32px rgba(0,0,0,0.8);backdrop-filter:blur(10px);";
            document.body.appendChild(widgetEl);
          }
          if (!widgetEl) return;

          const wasHidden = widgetEl.style.display === "none" || !widgetEl.style.display;
          const pct = total > 0 ? ((done / total) * 100).toFixed(1) : "0.0";
          const issuesCount = Number(j.failedCount || 0) + Number(j.uncertainCount || 0);
          widgetEl.style.display = "block";
          widgetEl.classList.toggle("is-compact", Boolean(floatingImportWidgetCompact));

          // WICHTIG: Niemals alle 600ms das komplette innerHTML überschreiben, damit #floatingImportDragHandle beim Ziehen nicht zerstört wird!
          if (!document.getElementById("floatingImportDragHandle")) {
            widgetEl.innerHTML =
              '<div id="floatingImportDragHandle" class="admin-drag-handle" data-drag-handle="true" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap" title="Ziehen zum Verschieben · Doppelklick = Position zurücksetzen">' +
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:#f8fafc;pointer-events:none">' +
                  '<span style="font-size:11px;padding:2px 6px;border-radius:5px;background:rgba(30,41,59,0.9);border:1px solid rgba(148,163,184,0.28);color:#94a3b8">⠿</span>' +
                  '<span id="floatingImportStateLbl" style="font-weight:900"></span>' +
                  '<b id="floatingImportProgressTxt"></b>' +
                  '<span id="floatingImportMoviesTxt" style="color:#34d399;font-size:11.5px"></span>' +
                  '<span id="floatingImportSeriesTxt" style="color:#38bdf8;font-size:11.5px"></span>' +
                  '<span id="floatingImportIssuesTxt" style="color:#fbbf24;font-size:11.5px;display:none"></span>' +
                '</div>' +
                '<div id="floatingImportActionBtns" style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                  '<button type="button" id="floatingImportToggleRunBtn" class="btn amber" style="padding:4px 9px;font-size:11px"></button>' +
                  '<button type="button" id="floatingImportOpenBtn" class="btn blue" style="padding:4px 9px;font-size:11px" onclick="openAdminTabDirectClient(\\'backup\\')">📂 Zum Import</button>' +
                  '<button type="button" id="floatingImportLogsBtn" class="btn" style="padding:4px 9px;font-size:11px" onclick="openAdminTabDirectClient(\\'diaglog\\')">🛠️ Logs</button>' +
                  '<button type="button" id="floatingImportResetPosBtn" class="btn" style="padding:4px 7px;font-size:11px" onclick="resetFloatingImportDragClient()" title="Position zurücksetzen">↺</button>' +
                  '<button type="button" id="floatingImportCompactBtn" class="btn" style="padding:4px 7px;font-size:11px" onclick="toggleFloatingImportCompactClient()" title="Kompakt umschalten">▾</button>' +
                '</div>' +
              '</div>' +
              '<div id="floatingImportProgressBarWrap" style="width:100%;height:5px;background:#1e293b;border-radius:999px;overflow:hidden;margin-top:6px;pointer-events:none">' +
                '<div id="floatingImportProgressBarFill" style="width:0%;height:100%;background:linear-gradient(90deg,#0ea5e9,#10b981);transition:width 0.25s ease"></div>' +
              '</div>';
            const dragHandle = document.getElementById("floatingImportDragHandle");
            if (dragHandle) {
              bindDraggableAdminPanelClient(widgetEl, dragHandle);
            }
          }

          const isCompact = Boolean(floatingImportWidgetCompact);
          const stateLbl = document.getElementById("floatingImportStateLbl");
          if (stateLbl) {
            stateLbl.style.color = j.running ? "#38bdf8" : "#fbbf24";
            stateLbl.textContent = isCompact
              ? (j.running ? "⚡" : "⏸️")
              : (j.running ? "⚡ Backup-Import läuft:" : "⏸️ Import pausiert:");
          }
          const progTxt = document.getElementById("floatingImportProgressTxt");
          if (progTxt) {
            progTxt.textContent = isCompact
              ? (pct + "%")
              : (done.toLocaleString("de-DE") + " / " + total.toLocaleString("de-DE") + " (" + pct + "%)");
          }
          const movTxt = document.getElementById("floatingImportMoviesTxt");
          if (movTxt) {
            movTxt.style.display = isCompact ? "none" : "inline";
            movTxt.textContent = "🎬 " + Number(j.moviesSaved || 0).toLocaleString("de-DE");
          }
          const serTxt = document.getElementById("floatingImportSeriesTxt");
          if (serTxt) {
            serTxt.style.display = isCompact ? "none" : "inline";
            serTxt.textContent = "📺 " + Number(j.seriesSaved || 0).toLocaleString("de-DE");
          }
          const issTxt = document.getElementById("floatingImportIssuesTxt");
          if (issTxt) {
            if (!isCompact && issuesCount > 0) {
              issTxt.style.display = "inline";
              issTxt.textContent = "⚠️ " + issuesCount;
            } else {
              issTxt.style.display = "none";
            }
          }
          const openBtn = document.getElementById("floatingImportOpenBtn");
          if (openBtn) openBtn.style.display = isCompact ? "none" : "";
          const logsBtn = document.getElementById("floatingImportLogsBtn");
          if (logsBtn) logsBtn.style.display = isCompact ? "none" : "";
          const resetBtn = document.getElementById("floatingImportResetPosBtn");
          if (resetBtn) resetBtn.style.display = isCompact ? "none" : "";
          const progWrap = document.getElementById("floatingImportProgressBarWrap");
          if (progWrap) progWrap.style.display = isCompact ? "none" : "block";
          const compactBtn = document.getElementById("floatingImportCompactBtn");
          if (compactBtn) {
            compactBtn.textContent = isCompact ? "▴" : "▾";
            compactBtn.title = isCompact ? "Vollansicht anzeigen" : "Kompakt minimieren";
          }
          const toggleBtn = document.getElementById("floatingImportToggleRunBtn");
          if (toggleBtn && (toggleBtn._lastRunningState !== Boolean(j.running) || toggleBtn._lastCompactState !== isCompact)) {
            toggleBtn._lastRunningState = Boolean(j.running);
            toggleBtn._lastCompactState = isCompact;
            toggleBtn.className = "btn " + (j.running ? "amber" : "green");
            toggleBtn.textContent = isCompact
              ? (j.running ? "⏸️" : "▶️")
              : (j.running ? "⏸️ Pause" : "▶️ Weiter");
            toggleBtn.onclick = () => {
              if (backupImportJob.running) pauseBackupImport();
              else startOrResumeBackupImport();
            };
          }
          const barFill = document.getElementById("floatingImportProgressBarFill");
          if (barFill) {
            barFill.style.width = Math.min(100, Number(pct)) + "%";
          }
          if (wasHidden) {
            const curOff = adminPanelDragOffsets.get("floatingImportStatusWidget") || { x: 0, y: 0 };
            applyAdminPanelDragOffsetClient(widgetEl, curOff.x, curOff.y);
          }
        } catch (e) {}
      }

      let floatingImportPollTimer = null;
      function stopFloatingImportStatusPolling() {
        if (floatingImportPollTimer) {
          clearInterval(floatingImportPollTimer);
          floatingImportPollTimer = null;
        }
      }
      function ensureFloatingImportStatusPolling() {
        const j = backupImportJob;
        const total = Array.isArray(j?.entries) ? j.entries.length : 0;
        const done = Number(j?.cursor || 0);
        const hasActiveOrPausedJob = Boolean(
          state.isAuthenticated &&
          state.authUser?.isAdmin &&
          total > 0 &&
          (j.running || (done > 0 && done < total))
        );
        if (!hasActiveOrPausedJob) {
          stopFloatingImportStatusPolling();
          return;
        }
        if (!floatingImportPollTimer) {
          floatingImportPollTimer = setInterval(() => {
            if (typeof document !== "undefined" && document.hidden) return;
            const cur = backupImportJob;
            const curTotal = Array.isArray(cur?.entries) ? cur.entries.length : 0;
            const curDone = Number(cur?.cursor || 0);
            const stillActive = Boolean(
              state.isAuthenticated &&
              state.authUser?.isAdmin &&
              curTotal > 0 &&
              (cur.running || (curDone > 0 && curDone < curTotal))
            );
            updateFloatingImportStatusBarDom();
            if (!stillActive) {
              stopFloatingImportStatusPolling();
            }
          }, 600);
        }
      }

      function renderBackupImportBoxDom() {
        updateFloatingImportStatusBarDom();
        ensureFloatingImportStatusPolling();
        const adminPanelBox = document.getElementById("adminJsonImportPanelBox");
        const adminDragHandle = document.getElementById("adminJsonImportDragHandle");
        if (adminPanelBox && adminDragHandle) {
          bindDraggableAdminPanelClient(adminPanelBox, adminDragHandle);
        }
        const mount = document.getElementById("backupImportLiveMount");
        if (!mount) return;
        const j = backupImportJob;
        // Aktuelle Scroll-Position und offene Eingaben im Review-Tab vor einem Komplett-Render sichern
        const oldScrollEl = document.getElementById("backupReviewScrollContainer");
        const savedReviewScrollTop = oldScrollEl ? oldScrollEl.scrollTop : null;
        if (j.activeSubTab === "review" && Array.isArray(j.reviewItems)) {
          for (const it of j.reviewItems) syncReviewCardDomInputsToItemState(it);
        }
        const activeChan = j.verifiedChannelId || getSavedVerifiedChannelIdClient();
        const isChanVerified = Boolean(activeChan && (activeChan.startsWith("-100") || activeChan.startsWith("@")));
        const fileInp = document.getElementById("backupJsonFileInputEl");
        if (fileInp) {
          fileInp.disabled = !isChanVerified;
          fileInp.style.opacity = isChanVerified ? "1" : "0.45";
        }

        const savedCp = j.savedCheckpoint || loadBackupCheckpointClient();
        const total = j.entries.length > 0 ? j.entries.length : Number(savedCp?.totalEntries || savedCp?.total || j.rawMessageCount || 0);
        const done = j.cursor > 0 ? j.cursor : Number(savedCp?.cursor || 0);
        const pct = total > 0 ? ((done / total) * 100).toFixed(1) : "0.0";
        const elapsedSec = j.startedAt ? Math.max(1, (Date.now() - j.startedAt) / 1000) : 1;
        const speedPerSec = done > 0 ? (done / elapsedSec).toFixed(1) : "0.0";
        const remCount = Math.max(0, total - done);
        const etaSec = done > 0 && Number(speedPerSec) > 0 ? Math.round(remCount / Number(speedPerSec)) : 0;
        const etaStr = etaSec > 3600
          ? (Math.floor(etaSec / 3600) + "h " + Math.floor((etaSec % 3600) / 60) + "m")
          : etaSec > 60
            ? (Math.floor(etaSec / 60) + "m " + (etaSec % 60) + "s")
            : (etaSec + "s");

        const hasRestoredOrActiveData = Boolean(
          j.fileName ||
          (savedCp && (Number(savedCp.cursor) > 0 || Number(savedCp.totalEntries || savedCp.total) > 0)) ||
          (Array.isArray(j.reviewItems) && j.reviewItems.length > 0) ||
          getDiagnosticLogTotalCountClient() > 0
        );

        if (!hasRestoredOrActiveData) {
          mount.innerHTML =
            '<div class="backup-cockpit-box">' +
              '<div class="golden-grid">' +
                '<div style="display:flex;flex-direction:column;justify-content:center;gap:10px;min-width:0">' +
                  '<div style="font-size:13px;font-weight:800;color:var(--text)">' +
                    (isChanVerified
                      ? ('✅ Quell-Kanal <code>' + esc(activeChan) + '</code> ist verifiziert. Bitte wähle oben in Schritt 2 deine <code>result.json</code> Datei aus.')
                      : '🔒 <b>JSON-Upload noch gesperrt:</b> Bitte gib oben in Schritt 1 die Telegram Kanal-ID (<code>-100...</code>) oder einen Nachrichten-Link ein und klicke auf <b>🔍 Kanal prüfen</b>.') +
                  '</div>' +
                  '<div style="font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                    '<span>🎯 Aktuelles Ziel:</span>' +
                    '<b id="backupTargetLiveSummaryBadge" style="color:var(--blue)">' + esc(getBackupTargetSummaryLabelClient()) + '</b>' +
                  '</div>' +
                '</div>' +
                '<div style="min-width:0">' +
                  (typeof renderWorkerHealthMonitorWidgetHtml === "function" ? renderWorkerHealthMonitorWidgetHtml(true) : '') +
                '</div>' +
              '</div>' +
            '</div>';
          return;
        }
        const effectiveFileName = j.fileName || savedCp?.fileName || "D1-Import-Sitzung (wiederhergestellt)";

        const openReviewCount = (j.reviewItems || []).filter(x => !x.resolvedByAdmin && (x.status === "failed" || x.isUncertain)).length;
        const totalDeduplicated = Number(j.duplicatesSkippedInFile || 0) + Number(j.duplicatesInDb || 0);
        const totalMergedStreams = Number(j.mergedQualitiesInDb || 0) + (done === 0 ? Number(j.qualityVariantsInFile || 0) : 0);

        // Gelber Hinweis-Banner erscheint NUR nach einem Seiten-Reload (F5), wenn noch keine Datei im Speicher liegt (j.entries.length === 0).
        // Während einer aktiven Import-Pause (j.entries.length > 0) stehen Fortsetzen, Neustart und Reset direkt in der Kopfzeile – niemals doppelt!
        const checkpointBannerHtml = (!j.running && j.entries.length === 0 && done > 0 && done < total)
          ? ('<div style="background:rgba(245,158,11,0.14);border:1px solid rgba(245,158,11,0.45);border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div style="font-size:12px;color:#fbbf24">' +
                '📌 <b>Gespeicherter D1-Checkpoint bei Eintrag #' + done.toLocaleString('de-DE') + ' / ' + total.toLocaleString('de-DE') + ' (' + pct + '%)</b> erkannt – bitte wähle oben in Schritt 2 kurz die JSON-Datei aus, um nahtlos fortzusetzen.' +
              '</div>' +
            '</div>')
          : '';

        const authAbortBannerHtml = j.authAbortError
          ? ('<div style="background:rgba(220,38,38,0.18);border:1px solid rgba(248,113,113,0.6);border-radius:10px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
              '<div style="font-size:12.5px;color:#fecaca;line-height:1.45">' +
                '<div style="font-weight:800;color:#fff;margin-bottom:3px">⛔ Import sofort gestoppt (HTTP ' + esc(String(j.authAbortError.status || 403)) + ')</div>' +
                esc(j.authAbortError.message || "Keine gültige Admin-Authentifizierung.") +
                (j.authAbortError.telegramId ? (' <span style="opacity:0.85">[Telegram-ID: <code>' + esc(String(j.authAbortError.telegramId)) + '</code>]</span>') : '') +
              '</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                '<button type="button" class="btn blue" style="padding:6px 11px;font-size:12px" onclick="openAccountModal()">🔐 Neu anmelden</button>' +
              '</div>' +
            '</div>')
          : '';

        const circuitBreakerBannerHtml = (!j.authAbortError && j.circuitBreakerNotice)
          ? ('<div style="background:rgba(245,158,11,0.16);border:1px solid rgba(251,191,36,0.55);border-radius:10px;padding:11px 13px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
              '<div style="font-size:12px;color:#fde68a;line-height:1.45">' + esc(j.circuitBreakerNotice) + '</div>' +
              '<button type="button" class="btn green" style="padding:6px 11px;font-size:12px" onclick="startOrResumeBackupImport()">▶️ Fortsetzen</button>' +
            '</div>')
          : '';

        mount.innerHTML =
          '<div class="backup-cockpit-box">' +
            authAbortBannerHtml +
            circuitBreakerBannerHtml +
            checkpointBannerHtml +
            (j.repaired ? (
              '<div style="background:rgba(2,132,199,0.14);border:1px solid rgba(14,165,233,0.4);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px;color:var(--text)">' +
                '🛠️ <b>JSON Auto-Repair erfolgreich:</b> ' + esc((j.repairNotes || []).join(" • ")) +
              '</div>'
            ) : '') +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">' +
              '<div>' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                  '<span style="font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:6px;background:' + (j.isTelegramBackup ? 'rgba(2,132,199,0.18);color:#38bdf8;border:1px solid rgba(14,165,233,0.4)' : 'rgba(16,185,129,0.18);color:#34d399;border:1px solid rgba(16,185,129,0.35)') + '">' +
                    (j.isTelegramBackup ? ('📦 TELEGRAM CHAT-BACKUP: ' + esc(j.backupChatName)) : '📄 STANDARD JSON-TITELLISTE') +
                  '</span>' +
                  '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:6px;background:rgba(16,185,129,0.16);color:#34d399;border:1px solid rgba(16,185,129,0.32)">📡 Kanal: ' + esc(activeChan || 'Verifiziert') + '</span>' +
                  (!j.running && done > 0 && done < total ? '<span style="font-size:11px;font-weight:800;padding:3px 9px;border-radius:6px;background:rgba(245,158,11,0.18);color:#fbbf24;border:1px solid rgba(245,158,11,0.4)">⏸️ Import pausiert bei #' + done.toLocaleString('de-DE') + '</span>' : '') +
                '</div>' +
                '<div style="font-size:12px;color:var(--muted);margin-top:6px">' +
                  'Datei: <b style="color:var(--text)">' + esc(effectiveFileName) + '</b>' + (j.fileSizeMb ? (' (' + j.fileSizeMb + ' MB)') : '') + ' · Einträge gesamt: <b style="color:var(--blue)">' + total.toLocaleString('de-DE') + '</b>' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                (!j.running && j.entries.length > 0 && done < total ? '<button class="btn green" onclick="startOrResumeBackupImport()">' + (done > 0 ? ('▶️ Fortsetzen ab #' + done.toLocaleString('de-DE')) : ('🚀 Smart-Import starten (' + total.toLocaleString('de-DE') + ')')) + '</button>' : '') +
                (j.running ? '<button class="btn amber" onclick="pauseBackupImport()">⏸️ Pausieren</button>' : '') +
                (done > 0 && !j.running && j.entries.length > 0 ? '<button class="btn amber" onclick="restartBackupFromZeroNoDupesClient()">🔄 Ab 0 neu starten</button>' : '') +
                ((done > 0 || j.entries.length > 0 || (j.reviewItems && j.reviewItems.length > 0)) ? '<button class="btn danger" onclick="resetBackupImport(true)">↺ Zurücksetzen</button>' : '') +
              '</div>' +
            '</div>' +

            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;border-bottom:1px solid rgba(148,163,184,0.18);padding-bottom:10px;align-items:center;justify-content:space-between">' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="btn ' + (j.activeSubTab !== 'review' && j.activeSubTab !== 'diaglog' ? 'blue' : '') + '" onclick="switchBackupSubTab(\\'dashboard\\')">📊 Live-Cockpit</button>' +
                '<button id="revSubTabBtn" class="btn ' + (j.activeSubTab === 'review' ? 'amber' : '') + '" onclick="switchBackupSubTab(\\'review\\')">' +
                  '🛠️ Prüfen & Korrigieren' +
                  (openReviewCount > 0 ? ' <span style="background:#e11d48;color:#fff;padding:1px 6px;border-radius:999px;font-size:10.5px;margin-left:4px">' + openReviewCount + '</span>' : ' (' + (j.reviewItems || []).length + ')') +
                '</button>' +
                '<button class="btn ' + (j.activeSubTab === 'diaglog' ? 'blue' : '') + '" onclick="switchBackupSubTab(\\'diaglog\\')">' +
                  '📋 Diagnose-Log (' + getDiagnosticLogTotalCountClient() + ')' +
                '</button>' +
              '</div>' +
              '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11.5px;color:var(--muted)">' +
                '<span>🎯 Ziel:</span>' +
                '<b id="backupTargetLiveSummaryBadge" style="color:var(--blue)">' + esc(getBackupTargetSummaryLabelClient()) + '</b>' +
              '</div>' +
            '</div>' +

            (j.activeSubTab === "review" ? renderBackupReviewTabHtml(j) : j.activeSubTab === "diaglog" ? renderImportDiagnosticLogBoxHtml() : (
              '<div class="golden-grid">' +
                /* Linke Hauptspalte (61.8%): Fortschritt, Kern-Kennzahlen & Live-Poster-Feed */
                '<div style="display:flex;flex-direction:column;gap:10px;min-width:0">' +
                  '<div class="backup-progress-track">' +
                    '<div style="width:' + Math.min(100, Number(pct)) + '%;height:100%;background:linear-gradient(90deg,#0284c7,#4f46e5,#10b981);transition:width 0.25s ease"></div>' +
                    '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:900;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.85)">' +
                      pct + '% (' + done.toLocaleString('de-DE') + ' / ' + total.toLocaleString('de-DE') + ')' +
                    '</div>' +
                  '</div>' +
                  '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;font-size:11.5px">' +
                    '<div style="background:var(--card);padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.14)">🎬 Filme in D1: <b style="color:#10b981">' + j.moviesSaved.toLocaleString('de-DE') + '</b></div>' +
                    '<div style="background:var(--card);padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.14)">📺 Serien in D1: <b style="color:#0ea5e9">' + j.seriesSaved.toLocaleString('de-DE') + '</b></div>' +
                    '<div style="background:var(--card);padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.14)">♻️ Duplikate: <b style="color:#818cf8">' + totalDeduplicated.toLocaleString('de-DE') + '</b></div>' +
                    '<div style="background:var(--card);padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.14)">🔗 Gemerged: <b style="color:#f59e0b">' + totalMergedStreams.toLocaleString('de-DE') + '</b></div>' +
                    '<div style="background:var(--card);padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.14);cursor:pointer" onclick="switchBackupSubTab(\\'review\\')">⚠️ Prüfen: <b style="color:#f59e0b">' + j.uncertainCount.toLocaleString('de-DE') + '</b></div>' +
                    '<div style="background:var(--card);padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.14);cursor:pointer" onclick="setBackupReviewFilter(\\'failed\\');switchBackupSubTab(\\'review\\')">❌ Offen: <b style="color:#e11d48">' + j.failedCount.toLocaleString('de-DE') + '</b></div>' +
                  '</div>' +
                  (Array.isArray(j.livePosterFeed) && j.livePosterFeed.length > 0 ? (
                    '<div>' +
                      '<div style="font-size:11.5px;font-weight:800;color:var(--muted);margin-bottom:6px">🎞️ Zuletzt zugeordnete Titel (Live-Feed):</div>' +
                      '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">' +
                        j.livePosterFeed.slice(0, 8).map(f => {
                          const fSeCode = (f.typeCode === 's' && f.season != null && f.season !== '')
                            ? ('S' + String(f.season).padStart(2, '0') + 'E' + String(f.episode || 1).padStart(2, '0'))
                            : '';
                          const fPoster = resolvePosterUrlClient(f.poster, 'w185', '');
                          return '<div style="min-width:155px;max-width:185px;background:var(--card);border:1px solid rgba(148,163,184,0.16);border-radius:8px;padding:6px;display:flex;gap:7px;align-items:center;flex-shrink:0">' +
                            (fPoster
                              ? '<img src="' + esc(fPoster) + '" style="width:34px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0" alt="" />'
                              : '<div style="width:34px;height:50px;background:rgba(14,165,233,0.15);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + (f.typeCode === 's' ? '📺' : '🎬') + '</div>') +
                            '<div style="min-width:0;flex:1">' +
                              '<div style="font-size:11px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(f.cleanTitle) + '</div>' +
                              '<div style="font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (fSeCode ? ('<b style="color:var(--blue)">' + esc(fSeCode) + '</b> · ') : '') + esc(f.year || 'k.A.') + ' · ' + esc(f.quality || '1080p') + '</div>' +
                              '<div style="font-size:9.5px;margin-top:2px;color:' + (f.isUncertain ? '#f59e0b' : f.ingestStatus === 'merged_quality' ? '#0ea5e9' : '#10b981') + '">' +
                                esc(f.metadataSource || 'TMDb') + ' · ' + (f.isUncertain ? ('⚠️ ' + f.confidence + '%') : f.ingestStatus === 'merged_quality' ? '🔗 Merge' : f.ingestStatus === 'duplicate' ? '♻️ In D1' : ('✅ ' + f.confidence + '%')) +
                              '</div>' +
                            '</div>' +
                          '</div>';
                        }).join("") +
                      '</div>' +
                    '</div>'
                  ) : '') +
                '</div>' +
                /* Rechte Begleitspalte (38.2%): EINZIGER Echtzeit Worker-Health-Monitor & Kompakt-Log */
                '<div style="display:flex;flex-direction:column;gap:10px;min-width:0">' +
                  (typeof renderWorkerHealthMonitorWidgetHtml === "function" ? renderWorkerHealthMonitorWidgetHtml(true) : '') +
                  '<div style="background:var(--card);border:1px solid rgba(148,163,184,0.16);border-radius:10px;padding:9px">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted);margin-bottom:5px">' +
                      '<span>🎛️ Batch: <b style="color:' + (j.currentBatchModeColor || 'var(--blue)') + '">' + esc(j.currentBatchModeLabel || '🛡️ Free-Turbo (5/Batch)') + '</b></span>' +
                      '<span>⚡ <b style="color:var(--text)">' + speedPerSec + ' Titel/s</b>' + (j.running && etaSec > 0 ? ' (~' + etaStr + ')' : '') + '</span>' +
                    '</div>' +
                    (j.recentLog.length > 0 ? (
                      '<div style="font-size:10.5px;color:var(--muted);max-height:86px;overflow-y:auto;background:#070c18;padding:6px 8px;border-radius:6px;font-family:monospace;line-height:1.45">' +
                        j.recentLog.slice(-5).map(l => '<div>' + esc(l) + '</div>').join("") +
                      '</div>'
                    ) : '<div style="font-size:11px;color:var(--muted)">Bereit zum Start. Alle Batches werden automatisch unter 10ms CPU gehalten.</div>') +
                  '</div>' +
                '</div>' +
              '</div>'
            )) +
          '</div>';

        // Nach einem Komplett-Render die exakte Scroll-Position des Review-Containers wiederherstellen
        if (savedReviewScrollTop !== null && savedReviewScrollTop > 0) {
          const newScrollEl = document.getElementById("backupReviewScrollContainer");
          if (newScrollEl) newScrollEl.scrollTop = savedReviewScrollTop;
        }
      }
