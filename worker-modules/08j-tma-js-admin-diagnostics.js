      // =========================================================================
      // PERSISTENTES DIAGNOSE-LOG (D1 + Browser localStorage + KI-Analyse-Export)
      // =========================================================================
      const CLIENT_DIAG_LOG_STORAGE_KEY = "tma_import_diagnostic_logs_v1";
            let clientDiagnosticLogState = {
        logs: [],
        summaryCounts: {
          SUBREQUEST_PAUSE: 0,
          SKIPPED_HEADER: 0,
          SKIPPED_JUNK: 0
        },
        loadedFromLocal: false,
        filterStatus: "ALL",
        searchQuery: "",
        syncing: false
      };

      function loadClientDiagnosticLogsFromStorage() {
        if (clientDiagnosticLogState.loadedFromLocal) return clientDiagnosticLogState.logs;
        clientDiagnosticLogState.loadedFromLocal = true;
        try {
          const raw = localStorage.getItem(CLIENT_DIAG_LOG_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              clientDiagnosticLogState.logs = parsed
                .filter(l => l && l.status !== "SUBREQUEST_PAUSE" && l.status !== "SKIPPED_HEADER")
                .map(l => {
                  const st = String(l.status || "OK").toUpperCase();
                  if (st === "TMDB_NOT_FOUND" || st === "API_ERROR" || st === "SUBREQUEST_PAUSE") {
                    return { ...l, matchedTitle: null, tmdbId: null };
                  }
                  return l;
                })
                .slice(0, 1200);
            }
          }
        } catch (e) {}
        return clientDiagnosticLogState.logs;
      }

      let _diagLogSaveTimer = null;
      function saveClientDiagnosticLogsToStorage(immediate = true) {
        if (!immediate) {
          if (_diagLogSaveTimer) return;
          _diagLogSaveTimer = setTimeout(() => {
            _diagLogSaveTimer = null;
            try {
              localStorage.setItem(CLIENT_DIAG_LOG_STORAGE_KEY, JSON.stringify((clientDiagnosticLogState.logs || []).slice(0, 1000)));
            } catch (e) {}
          }, 900);
          return;
        }
        if (_diagLogSaveTimer) {
          clearTimeout(_diagLogSaveTimer);
          _diagLogSaveTimer = null;
        }
        try {
          localStorage.setItem(CLIENT_DIAG_LOG_STORAGE_KEY, JSON.stringify((clientDiagnosticLogState.logs || []).slice(0, 1000)));
        } catch (e) {}
      }

      function getDiagnosticLogTotalCountClient() {
        loadClientDiagnosticLogsFromStorage();
        return (clientDiagnosticLogState.logs || []).length;
      }

      function appendClientDiagnosticLogs(newEntries = [], syncToServer = true) {
        if (!Array.isArray(newEntries) || newEntries.length === 0) return;
        loadClientDiagnosticLogsFromStorage();
        if (!clientDiagnosticLogState.summaryCounts) {
          clientDiagnosticLogState.summaryCounts = { SUBREQUEST_PAUSE: 0, SKIPPED_HEADER: 0, SKIPPED_JUNK: 0 };
        }
        const existingByKey = new Map();
        (clientDiagnosticLogState.logs || []).forEach((l) => {
          const k = String(l.msgId || "") + "|" + String(l.fileName || "");
          if (!existingByKey.has(k)) existingByKey.set(k, l);
        });
        const added = [];
        const prepended = [];
        for (const raw of newEntries) {
          if (!raw) continue;
          const rawMsgVal = raw.msgId ?? raw.msg_id ?? null;
          const normMsgId = (rawMsgVal !== null && rawMsgVal !== "" && Number.isFinite(Number(rawMsgVal)) && Number(rawMsgVal) > 0)
            ? Number(rawMsgVal)
            : null;
          const rawStatusUp = String(raw.status || "OK").toUpperCase();
          const normStatus = rawStatusUp === "CONFLICT_?" ? "CONFLICT" : rawStatusUp;

          // MODUL 1.2: SUBREQUEST_PAUSE und SKIPPED_HEADER NIEMALS in das entries-Array schreiben (nur in summaryCounts hochzählen!)
          if (normStatus === "SUBREQUEST_PAUSE") {
            clientDiagnosticLogState.summaryCounts.SUBREQUEST_PAUSE = (clientDiagnosticLogState.summaryCounts.SUBREQUEST_PAUSE || 0) + 1;
            continue;
          }
          if (normStatus === "SKIPPED_HEADER") {
            clientDiagnosticLogState.summaryCounts.SKIPPED_HEADER = (clientDiagnosticLogState.summaryCounts.SKIPPED_HEADER || 0) + 1;
            continue;
          }

          // MODUL 6.3: Variablen-Leck im Logger schließen! Bei TMDB_NOT_FOUND oder API_ERROR sind matchedTitle & tmdbId zwingend null!
          const isUnmatchedStatus = normStatus === "TMDB_NOT_FOUND" || normStatus === "API_ERROR" || normStatus === "SUBREQUEST_PAUSE";
          const entry = {
            id: raw.id || ("diag_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
            msgId: normMsgId,
            fileName: String(raw.fileName || raw.file_name || raw.rawFileName || "Unbekannt").slice(0, 260),
            rawText: String(raw.rawText || raw.raw_text || "").slice(0, 500),
            status: normStatus,
            reviewReasonCode: raw.reviewReasonCode || raw.review_reason_code || raw.details?.reviewReasonCode || null,
            reason: String(raw.reason || "").slice(0, 360),
            detectedType: String(raw.detectedType || raw.detected_type || "auto"),
            parsedTitle: String(raw.parsedTitle || raw.parsed_title || raw.cleanTitle || ""),
            matchedTitle: isUnmatchedStatus ? null : (String(raw.matchedTitle || raw.matched_title || raw.details?.matchedTitle || "") || null),
            seasonNumber: raw.seasonNumber ?? raw.season_number ?? raw.season ?? null,
            episodeNumber: raw.episodeNumber ?? raw.episode_number ?? raw.episode ?? null,
            tmdbId: isUnmatchedStatus ? null : (raw.tmdbId ?? raw.tmdb_id ?? null),
            details: raw.details && typeof raw.details === "object" ? raw.details : null,
            rawEntry: raw.rawEntry || raw.details?.rawEntry || (raw.raw_entry_json ? (() => { try { return JSON.parse(raw.raw_entry_json); } catch (_) { return null; } })() : null),
            createdAt: Number(raw.createdAt || raw.created_at || Date.now())
          };
          const dedupeKey = String(entry.msgId || "") + "|" + entry.fileName;
          const existingRef = existingByKey.get(dedupeKey);
          if (existingRef) {
            Object.assign(existingRef, entry, {
              matchedTitle: isUnmatchedStatus ? null : (entry.matchedTitle || existingRef.matchedTitle || null),
              tmdbId: isUnmatchedStatus ? null : (entry.tmdbId ?? existingRef.tmdbId ?? null)
            });
            added.push(existingRef);
          } else {
            existingByKey.set(dedupeKey, entry);
            prepended.push(entry);
            added.push(entry);
          }
        }
        if (prepended.length > 0) {
          clientDiagnosticLogState.logs = [...prepended.reverse(), ...(clientDiagnosticLogState.logs || [])];
        }
        // Fehler-Priorität im Log-Buffer – OK und SKIPPED_DUPLICATE dürfen niemals echte Problem-Einträge verdrängen
        if (clientDiagnosticLogState.logs.length > 1200) {
          const priorityProblemLogs = [];
          const routineLogs = [];
          for (const l of clientDiagnosticLogState.logs) {
            const st = String(l.status || "OK").toUpperCase();
            if (st === "OK" || st === "SKIPPED_DUPLICATE") {
              routineLogs.push(l);
            } else {
              priorityProblemLogs.push(l);
            }
          }
          const remainingSlots = Math.max(0, 1200 - priorityProblemLogs.length);
          clientDiagnosticLogState.logs = [
            ...priorityProblemLogs.slice(0, 1200),
            ...routineLogs.slice(0, remainingSlots)
          ];
        }
        saveClientDiagnosticLogsToStorage(Boolean(syncToServer));
        if (syncToServer && added.length > 0) {
          apiFetchJson(API_BASE + "/admin/import-logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "append", logs: added.slice(0, 120) })
          }).catch(() => {});
        }
      }

      async function syncDiagnosticLogsFromD1Client(silent = false) {
        loadClientDiagnosticLogsFromStorage();
        if (!silent) clientDiagnosticLogState.syncing = true;
        try {
          const r = await apiFetchJson(API_BASE + "/admin/import-logs?limit=600");
          if (r && r.ok && Array.isArray(r.logs)) {
            appendClientDiagnosticLogs(r.logs, false);
          }
        } catch (e) {}
        clientDiagnosticLogState.syncing = false;
        if (state.adminTab === "diaglog") loadAdminPanelView();
        else if (backupImportJob.activeSubTab === "diaglog") renderBackupImportBoxDom();
      }

      function setDiagLogFilterClient(statusVal) {
        clientDiagnosticLogState.filterStatus = statusVal || "ALL";
        refreshDiagnosticLogMountDom();
      }

      function setDiagLogSearchClient(qVal) {
        clientDiagnosticLogState.searchQuery = String(qVal || "");
        refreshDiagnosticLogMountDom(true);
      }

      function refreshDiagnosticLogMountDom(preserveSearchFocus = false) {
        const oldSearchInp = document.getElementById("diagLogSearchInp");
        const hadFocus = Boolean(preserveSearchFocus || (oldSearchInp && document.activeElement === oldSearchInp));
        const selStart = oldSearchInp && typeof oldSearchInp.selectionStart === "number" ? oldSearchInp.selectionStart : null;
        const selEnd = oldSearchInp && typeof oldSearchInp.selectionEnd === "number" ? oldSearchInp.selectionEnd : null;
        const mount = document.getElementById("diagLogStandaloneMount");
        if (mount) {
          mount.outerHTML = renderImportDiagnosticLogBoxHtml();
        } else {
          renderBackupImportBoxDom();
        }
        if (hadFocus) {
          const nextSearchInp = document.getElementById("diagLogSearchInp");
          if (nextSearchInp) {
            nextSearchInp.focus();
            if (selStart !== null && selEnd !== null && typeof nextSearchInp.setSelectionRange === "function") {
              try { nextSearchInp.setSelectionRange(selStart, selEnd); } catch (_e) {}
            }
          }
        }
      }

      async function clearAllDiagnosticLogsClient() {
        const ok = await showCustomConfirm("Diagnose-Log in D1 und im Browser wirklich komplett leeren?", "🗑️ Logs leeren");
        if (!ok) return;
        clientDiagnosticLogState.logs = [];
        clientDiagnosticLogState.summaryCounts = { SUBREQUEST_PAUSE: 0, SKIPPED_HEADER: 0, SKIPPED_JUNK: 0 };
        saveClientDiagnosticLogsToStorage();
        try {
          await apiFetchJson(API_BASE + "/admin/import-logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "clear" })
          });
        } catch (e) {}
        showHudToast("🗑️ Diagnose-Logs geleert");
        refreshDiagnosticLogMountDom();
      }

      async function rehealOldConflictsWithNewPipelineClient() {
        loadClientDiagnosticLogsFromStorage();
        const openProblems = (clientDiagnosticLogState.logs || []).filter(l => {
          const st = String(l.status || "").toUpperCase();
          return st === "TMDB_NOT_FOUND" || st === "CONFLICT" || st === "CONFLICT_?";
        });
        setBusyState(true, "🩺 Prüfe offene Konflikte & TMDB_NOT_FOUND mit der neuen Modul 1-6 Pipeline...");
        try {
          let totalChecked = 0;
          let totalHealed = 0;
          let cursor = 0;
          let firstErrorMsg = "";
          const maxRounds = 5;
          for (let round = 0; round < maxRounds; round++) {
            const slice = openProblems.slice(cursor, cursor + 10);
            const r = await apiFetchJson(API_BASE + "/admin/reheal-conflicts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                limit: 10,
                items: slice.length > 0 ? slice : undefined
              })
            });
            if (!r || !r.ok) {
              firstErrorMsg = r?.error || "Serverfehler bei der Konflikt-Nachprüfung";
              break;
            }
            totalChecked += Number(r.checkedCount || 0);
            totalHealed += Number(r.healedCount || 0);
            if (Array.isArray(r.healedItems) && r.healedItems.length > 0) {
              for (const healed of r.healedItems) {
                const target = (clientDiagnosticLogState.logs || []).find(
                  l => (healed.msgId && Number(l.msgId) === Number(healed.msgId)) || (healed.fileName && l.fileName === healed.fileName)
                );
                if (target) {
                  target.status = "OK";
                  target.tmdbId = healed.tmdbId;
                  target.matchedTitle = healed.matchedTitle || healed.parsedTitle || "";
                  target.reason = "Automatisch geheilt (Neue Pipeline) → " + (healed.matchedTitle || healed.parsedTitle) + " (#" + healed.tmdbId + ")";
                }
              }
              saveClientDiagnosticLogsToStorage();
            }
            cursor += 10;
            if (!r.remainingCount || slice.length < 10 || cursor >= openProblems.length) break;
          }
          clearClientMediaCaches();
          refreshDiagnosticLogMountDom();
          if (firstErrorMsg && totalChecked === 0) {
            showHudToast("⚠️ Konflikt-Nachprüfung fehlgeschlagen: " + firstErrorMsg);
          } else {
            showHudToast("🩺 Nachprüfung abgeschlossen: " + totalHealed + " von " + totalChecked + " geprüften Konflikten automatisch geheilt" + (firstErrorMsg ? (" (Hinweis: " + firstErrorMsg + ")") : "!"));
          }
        } catch (e) {
          showHudToast("⚠️ Fehler bei der Konflikt-Nachprüfung: " + (e?.message || "Unbekannt"));
        } finally {
          setBusyState(false);
        }
      }

      async function exportDiagnosticLogsForAiClient(onlyProblems = true) {
        loadClientDiagnosticLogsFromStorage();
        const all = (clientDiagnosticLogState.logs || []).filter(l => l && l.status !== "SUBREQUEST_PAUSE" && l.status !== "SKIPPED_HEADER");
        const sc = clientDiagnosticLogState.summaryCounts || {};
        // Echte Problem-Einträge haben im Export-Buffer immer Vorrang vor OK und SKIPPED_DUPLICATE
        const priorityProblems = all.filter(l => l.status !== "OK" && l.status !== "SKIPPED_DUPLICATE");
        const routineItems = all.filter(l => l.status === "OK" || l.status === "SKIPPED_DUPLICATE");
        const orderedList = onlyProblems
          ? priorityProblems
          : [...priorityProblems, ...routineItems];
        const payload = {
          exportedAt: new Date().toISOString(),
          totalLogs: all.length,
          exportedCount: Math.min(250, orderedList.length),
          summaryCounts: {
            OK: all.filter(l => l.status === "OK").length,
            SKIPPED_JUNK: Math.max(Number(sc.SKIPPED_JUNK || 0), all.filter(l => l.status === "SKIPPED_JUNK").length),
            SKIPPED_HEADER: Number(sc.SKIPPED_HEADER || 0),
            SKIPPED_DUPLICATE: all.filter(l => l.status === "SKIPPED_DUPLICATE").length,
            TMDB_NOT_FOUND: all.filter(l => l.status === "TMDB_NOT_FOUND").length,
            CONFLICT: all.filter(l => l.status === "CONFLICT_?" || l.status === "CONFLICT").length,
            SUBREQUEST_PAUSE: Number(sc.SUBREQUEST_PAUSE || 0),
            API_ERROR: all.filter(l => l.status === "API_ERROR").length
          },
          entries: orderedList.slice(0, 250).map(l => {
            const st = l.status === "CONFLICT_?" ? "CONFLICT" : l.status;
            const isUnmatched = st === "TMDB_NOT_FOUND" || st === "API_ERROR" || st === "SUBREQUEST_PAUSE";
            return {
              msgId: l.msgId !== null && l.msgId !== undefined ? Number(l.msgId) : null,
              status: st,
              detectedType: l.detectedType,
              fileName: l.fileName,
              parsedTitle: l.parsedTitle,
              matchedTitle: isUnmatched ? null : (l.matchedTitle || null),
              season: l.seasonNumber,
              episode: l.episodeNumber,
              tmdbId: isUnmatched ? null : (l.tmdbId ?? null),
              reason: l.reason,
              rawText: (l.rawText || "").slice(0, 220)
            };
          })
        };
        const jsonText = JSON.stringify(payload, null, 2);
        try {
          await navigator.clipboard.writeText(jsonText);
          showHudToast("📋 Diagnose-JSON (" + payload.exportedCount + " Einträge, Fehler-Priorität aktiv) in die Zwischenablage kopiert!");
        } catch (e) {
          const blob = new Blob([jsonText], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "diagnose-log-ki-export.json";
          a.style.display = "none";
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            try { a.remove(); } catch (_re) {}
            try { URL.revokeObjectURL(url); } catch (_ue) {}
          }, 1500);
          showHudToast("💾 Diagnose-Log als JSON-Datei heruntergeladen!");
        }
      }

      async function quickAssignDiagLogEntryClient(diagIdx) {
        loadClientDiagnosticLogsFromStorage();
        const item = clientDiagnosticLogState.logs[diagIdx];
        if (!item) return;
        const tmdbInp = document.getElementById("diagFixTmdb_" + diagIdx);
        const typeSel = document.getElementById("diagFixType_" + diagIdx);
        const sInp = document.getElementById("diagFixSeason_" + diagIdx);
        const eInp = document.getElementById("diagFixEp_" + diagIdx);
        const newTmdbId = Number(tmdbInp?.value || 0);
        const newTypeCode = typeSel?.value === "s" ? "s" : "m";
        const sNum = Number(sInp?.value ?? item.seasonNumber ?? 1);
        const eNum = Number(eInp?.value || item.episodeNumber || 1);
        if (!newTmdbId) {
          showHudToast("⚠️ Bitte eine gültige TMDb-ID eingeben!");
          return;
        }
        setBusyState(true, "🔧 Weise Eintrag direkt TMDb #" + newTmdbId + " zu...");
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
          if (newTypeCode === "s") {
            rawEntry.season = sNum;
            rawEntry.episode = eNum;
            rawEntry.isSeries = true;
          }
          const r = await apiFetchJson(API_BASE + "/admin/remap-import-item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              newTmdbId,
              newTypeCode,
              msgId: item.msgId || null,
              oldTmdbId: item.tmdbId || null,
              oldTypeCode: item.detectedType === "series" ? "s" : "m",
              targetChatId: backupImportJob.targetPlaylistChatId || chatId,
              playlistFolderId: backupImportJob.playlistFolderId || null,
              playlistMode: backupImportJob.playlistMode || "both",
              rawEntry
            })
          });
          if (r && r.ok) {
            item.status = "OK";
            item.tmdbId = newTmdbId;
            item.matchedTitle = r.matchedItem?.matchedTitle || r.matchedItem?.cleanTitle || "";
            item.detectedType = newTypeCode === "s" ? "series" : "movie";
            item.seasonNumber = newTypeCode === "s" ? sNum : null;
            item.episodeNumber = newTypeCode === "s" ? eNum : null;
            item.reason = "Manuell im Diagnose-Log zugewiesen → " + (r.matchedItem?.cleanTitle || ("TMDb #" + newTmdbId));
            saveClientDiagnosticLogsToStorage();
            await apiFetchJson(API_BASE + "/admin/import-logs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "resolve",
                id: item.id,
                msgId: item.msgId,
                tmdbId: newTmdbId,
                reason: item.reason
              })
            }).catch(() => {});
            clearClientMediaCaches();
            showHudToast("✅ Erfolgreich verknüpft: " + (r.matchedItem?.cleanTitle || ("TMDb #" + newTmdbId)));
            refreshDiagnosticLogMountDom();
          } else {
            showHudToast("⚠️ " + (r?.error || "Zuweisung fehlgeschlagen"));
          }
        } finally {
          setBusyState(false);
        }
      }

      function renderImportDiagnosticLogBoxHtml() {
        loadClientDiagnosticLogsFromStorage();
        const logs = (clientDiagnosticLogState.logs || []).filter(l => l && l.status !== "SUBREQUEST_PAUSE" && l.status !== "SKIPPED_HEADER");
        const sc = clientDiagnosticLogState.summaryCounts || {};
        const fStatus = clientDiagnosticLogState.filterStatus || "ALL";
        const q = (clientDiagnosticLogState.searchQuery || "").trim().toLowerCase();

        const counts = {
          ALL: logs.length,
          OK: 0,
          SKIPPED_JUNK: 0,
          SKIPPED_HEADER: Number(sc.SKIPPED_HEADER || 0),
          SKIPPED_DUPLICATE: 0,
          SKIPPED_PRERELEASE: 0,
          TMDB_NOT_FOUND: 0,
          CONFLICT: 0,
          SUBREQUEST_PAUSE: Number(sc.SUBREQUEST_PAUSE || 0),
          API_ERROR: 0
        };
        for (const l of logs) {
          const st = String(l.status || "OK");
          if (st === "CONFLICT_?" || st === "CONFLICT") counts.CONFLICT++;
          else if (counts[st] !== undefined) counts[st]++;
        }

        const filtered = logs.filter((l) => {
          const st = String(l.status || "OK");
          if (fStatus === "PROBLEMS") {
            if (st === "OK" || st === "SKIPPED_DUPLICATE") return false;
          } else if (fStatus === "CONFLICT") {
            if (st !== "CONFLICT_?" && st !== "CONFLICT") return false;
          } else if (fStatus !== "ALL" && st !== fStatus) {
            return false;
          }
          if (q) {
            const hay = (String(l.msgId || "") + " " + String(l.fileName || "") + " " + String(l.parsedTitle || "") + " " + String(l.matchedTitle || "") + " " + String(l.reason || "") + " " + String(l.rawText || "")).toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

        const statusBadgeMap = {
          OK: { bg: "rgba(16,185,129,0.2)", col: "#34d399", label: "🟢 OK" },
          SKIPPED_JUNK: { bg: "rgba(148,163,184,0.2)", col: "#94a3b8", label: "🗑️ SKIPPED_JUNK" },
          SKIPPED_HEADER: { bg: "rgba(56,189,248,0.2)", col: "#38bdf8", label: "📌 SKIPPED_HEADER" },
          SKIPPED_DUPLICATE: { bg: "rgba(167,139,250,0.2)", col: "#a78bfa", label: "♻️ SKIPPED_DUPLICATE" },
          SKIPPED_PRERELEASE: { bg: "rgba(245,158,11,0.22)", col: "#fbbf24", label: "⚠️ SKIPPED_PRERELEASE" },
          TMDB_NOT_FOUND: { bg: "rgba(239,68,68,0.25)", col: "#f87171", label: "❌ TMDB_NOT_FOUND" },
          "CONFLICT_?": { bg: "rgba(245,158,11,0.25)", col: "#fbbf24", label: "⚠️ CONFLICT" },
          CONFLICT: { bg: "rgba(245,158,11,0.25)", col: "#fbbf24", label: "⚠️ CONFLICT" },
          SUBREQUEST_PAUSE: { bg: "rgba(59,130,246,0.25)", col: "#60a5fa", label: "🛡️ SUBREQUEST_PAUSE" },
          API_ERROR: { bg: "rgba(239,68,68,0.25)", col: "#fca5a5", label: "🔥 API_ERROR" }
        };

        return '<div id="diagLogStandaloneMount" style="background:#101016;border:1px solid rgba(56,189,248,0.35);border-radius:10px;padding:12px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
            '<div>' +
              '<div style="font-size:14px;font-weight:900;color:#fff">🛠️ Persistentes Import-Diagnose-Log (D1 + Browser)</div>' +
              '<div style="font-size:11.5px;color:#94a3b8">Lückenlose Nachverfolgung jeder Message-ID inkl. Grund, Typ-Weiche, Subrequest-Guard & Direkt-Korrektur</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button type="button" class="btn green" onclick="rehealOldConflictsWithNewPipelineClient()" title="Prüft alle offenen TMDB_NOT_FOUND & CONFLICT Einträge mit der neuen Modul 1-6 Pipeline nach">🩺 Alt-Konflikte mit neuer Pipeline prüfen</button>' +
              '<button type="button" class="btn" style="background:rgba(168,85,247,0.22);border:1px solid rgba(168,85,247,0.55);color:#e9d5ff" onclick="startManualNoTmdbQueueModeClient(\\'diag\\')" title="Öffnet alle offenen Nicht-erkannt-Treffer nacheinander im 900M-Modal">✨ Queue-Modus (900M-ID)</button>' +
              '<button type="button" class="btn amber" onclick="exportDiagnosticLogsForAiClient(true)">📋 Fehler-Log für KI kopieren</button>' +
              '<button type="button" class="btn blue" onclick="exportDiagnosticLogsForAiClient(false)">📋 Komplettes Log kopieren</button>' +
              '<button type="button" class="btn" onclick="syncDiagnosticLogsFromD1Client(false)">🔄 Aus D1 laden</button>' +
              '<button type="button" class="btn danger" onclick="clearAllDiagnosticLogsClient()">🗑️ Logs leeren</button>' +
            '</div>' +
          '</div>' +

          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;margin-bottom:10px;font-size:11.5px">' +
            '<div onclick="setDiagLogFilterClient(\\'ALL\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'ALL' ? 'rgba(56,189,248,0.22)' : '#181822') + ';border:1px solid rgba(255,255,255,0.1)">📋 Gesamt: <b>' + counts.ALL + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'PROBLEMS\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'PROBLEMS' ? 'rgba(245,158,11,0.22)' : '#181822') + ';border:1px solid rgba(245,158,11,0.35)">🚨 Alle Hinweise/Fehler: <b style="color:#fbbf24">' + (counts.ALL - counts.OK - counts.SKIPPED_DUPLICATE) + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'OK\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'OK' ? 'rgba(16,185,129,0.22)' : '#181822') + ';border:1px solid rgba(16,185,129,0.3)">🟢 OK: <b style="color:#34d399">' + counts.OK + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'TMDB_NOT_FOUND\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'TMDB_NOT_FOUND' ? 'rgba(239,68,68,0.25)' : '#181822') + ';border:1px solid rgba(239,68,68,0.35)">❌ TMDB_NOT_FOUND: <b style="color:#f87171">' + counts.TMDB_NOT_FOUND + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'CONFLICT\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'CONFLICT' ? 'rgba(245,158,11,0.25)' : '#181822') + ';border:1px solid rgba(245,158,11,0.35)">⚠️ CONFLICT: <b style="color:#fbbf24">' + counts.CONFLICT + '</b></div>' +
            '<div style="padding:7px 9px;border-radius:6px;background:#181822;border:1px solid rgba(56,189,248,0.3)" title="Wird nur in summaryCounts gezählt und verdrängt keine Fehler im Log">📌 Header/Poster: <b style="color:#38bdf8">' + counts.SKIPPED_HEADER + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'SKIPPED_DUPLICATE\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'SKIPPED_DUPLICATE' ? 'rgba(167,139,250,0.22)' : '#181822') + ';border:1px solid rgba(167,139,250,0.3)">♻️ Duplikate: <b style="color:#a78bfa">' + counts.SKIPPED_DUPLICATE + '</b></div>' +
            '<div style="padding:7px 9px;border-radius:6px;background:#181822;border:1px solid rgba(59,130,246,0.35)" title="Wird nur in summaryCounts gezählt und verdrängt keine Fehler im Log">🛡️ Subrequest-Guard: <b style="color:#60a5fa">' + counts.SUBREQUEST_PAUSE + '</b></div>' +
          '</div>' +

          '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
            '<input id="diagLogSearchInp" value="' + esc(clientDiagnosticLogState.searchQuery || "") + '" oninput="setDiagLogSearchClient(this.value)" placeholder="🔍 Suche nach Message-ID (z.B. 118, 303), Dateiname, Suchtitel, TMDb-Match..." style="flex:1;min-width:240px;padding:8px 10px;border-radius:6px;background:#161620;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px" />' +
          '</div>' +

          (filtered.length === 0 ? (
            '<div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px;background:#15151e;border-radius:8px">' +
              'Noch keine Einträge für diesen Filter vorhanden. Lade eine <code>result.json</code> hoch oder klicke oben auf <b>🔄 Aus D1 laden</b>.' +
            '</div>'
          ) : (
            '<div style="max-height:460px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">' +
              filtered.slice(0, 180).map((item) => {
                const origIdx = (clientDiagnosticLogState.logs || []).indexOf(item);
                const badge = statusBadgeMap[item.status] || { bg: "rgba(148,163,184,0.2)", col: "#cbd5e1", label: item.status };
                const isFixable = item.status === "TMDB_NOT_FOUND" || item.status === "CONFLICT_?" || item.status === "CONFLICT" || item.status === "API_ERROR";
                const isSynthetic900m = Number(item.tmdbId || 0) >= 900000000;
                const itemReasonMeta = isFixable ? resolveClientReviewReasonMeta(item) : null;
                const seLabel = item.seasonNumber !== null && item.seasonNumber !== undefined
                  ? (' • <b style="color:#38bdf8">S' + String(item.seasonNumber).padStart(2, '0') + 'E' + String(item.episodeNumber || 1).padStart(2, '0') + '</b>')
                  : '';
                return '<div style="background:#161620;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:9px 11px;display:flex;flex-direction:column;gap:6px">' +
                  '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">' +
                    '<div style="min-width:0;flex:1">' +
                      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                        '<span style="font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:999px;background:' + badge.bg + ';color:' + badge.col + '">' + esc(badge.label) + '</span>' +
                        (itemReasonMeta ? '<span style="font-family:monospace;font-size:10px;font-weight:900;padding:2px 7px;border-radius:5px;' + itemReasonMeta.badgeStyle + '">' + itemReasonMeta.icon + ' ' + esc(itemReasonMeta.code) + '</span>' : '') +
                        (item.msgId ? '<span style="font-family:monospace;font-size:11px;background:#0f172a;color:#38bdf8;padding:2px 6px;border-radius:5px;border:1px solid rgba(56,189,248,0.3)">Msg #' + esc(item.msgId) + '</span>' : '') +
                        '<span style="font-size:11px;color:#94a3b8">[' + esc(item.detectedType || 'auto') + ']</span>' +
                        '<b style="font-size:12.5px;color:#fff">' + esc(item.fileName || item.parsedTitle || 'Eintrag') + '</b>' +
                        (item.parsedTitle ? ' <span style="font-size:11px;color:#a78bfa">🔍 Suchtitel: „' + esc(item.parsedTitle) + '“</span>' : '') +
                        (item.matchedTitle ? ' <span style="font-size:11px;color:#34d399">🎯 Match: „' + esc(item.matchedTitle) + '“</span>' : '') +
                        seLabel +
                        (item.tmdbId ? ' <span style="font-size:11px;color:' + (isSynthetic900m ? '#e9d5ff' : '#34d399') + '">(' + (isSynthetic900m ? '900M #' : 'TMDb #') + esc(item.tmdbId) + ')</span>' : '') +
                      '</div>' +
                      '<div style="font-size:11.5px;color:#cbd5e1;margin-top:3px">💬 <b>Grund:</b> ' + esc(item.reason || '–') + '</div>' +
                      (item.rawText ? '<div style="font-size:10.5px;color:#64748b;margin-top:2px;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📄 Roh-Text: ' + esc(item.rawText) + '</div>' : '') +
                    '</div>' +
                    (isSynthetic900m && origIdx >= 0 ? (
                      '<button type="button" class="btn blue" style="padding:4px 8px;font-size:10.5px" onclick="openManualNoTmdbConfirmForDiagItem(' + origIdx + ')">🔄 900M → TMDb migrieren</button>'
                    ) : '') +
                  '</div>' +
                  (isFixable && origIdx >= 0 ? (
                    '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:#101018;padding:7px;border-radius:6px;border:1px solid rgba(245,158,11,0.3)">' +
                      '<span style="font-size:11px;font-weight:800;color:#fbbf24">🔧 Direkt-Zuweisung:</span>' +
                      '<select id="diagFixType_' + origIdx + '" style="padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px">' +
                        '<option value="s" ' + (item.detectedType === 'series' || item.seasonNumber ? 'selected' : '') + '>📺 Serie</option>' +
                        '<option value="m" ' + (item.detectedType === 'movie' && !item.seasonNumber ? 'selected' : '') + '>🎬 Film</option>' +
                      '</select>' +
                      '<input id="diagFixTmdb_' + origIdx + '" type="number" value="' + esc(item.tmdbId || '') + '" placeholder="TMDb-ID (z.B. 66732)" style="width:135px;padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px" />' +
                      '<input id="diagFixSeason_' + origIdx + '" type="number" value="' + esc(item.seasonNumber ?? 1) + '" placeholder="Staffel" style="width:68px;padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px" title="Staffel" />' +
                      '<input id="diagFixEp_' + origIdx + '" type="number" value="' + esc(item.episodeNumber || 1) + '" placeholder="Folge" style="width:68px;padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px" title="Folge" />' +
                      '<button type="button" class="btn green" style="padding:5px 9px;font-size:11px" onclick="quickAssignDiagLogEntryClient(' + origIdx + ')">💾 Jetzt verknüpfen</button>' +
                      '<button type="button" class="btn purple" style="padding:5px 9px;font-size:11px;background:rgba(168,85,247,0.22);border:1px solid rgba(168,85,247,0.55);color:#e9d5ff" onclick="openManualNoTmdbConfirmForDiagItem(' + origIdx + ')">✨ Ohne TMDb-ID bestätigen</button>' +
                    '</div>'
                  ) : '') +
                '</div>';
              }).join("") +
            '</div>'
          )) +
        '</div>';
      }

      async function startOrResumeBackupImport() {
        if (backupImportJob.running || !backupImportJob.entries.length) return;
        const activeChan = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
        if (!activeChan || (!activeChan.startsWith("-100") && !activeChan.startsWith("@"))) {
          showHudToast("⛔ Import gesperrt: Bitte zuerst oben in Schritt 1 die Kanal-ID (-100...) prüfen!");
          return;
        }
        backupImportJob.verifiedChannelId = activeChan;

        const inpEl = document.getElementById("backupPlaylistNameInp");
        if ( inpEl && inpEl.value.trim()) {
          backupImportJob.customPlaylistName = inpEl.value.trim().slice(0, 48);
        }
        // MODUL 6.3 + MODUL 1.1: Bei einem neuen Import ab Index 0 alte Logs & processedMsgIds sauber zurücksetzen
        if (backupImportJob.cursor === 0 && !backupImportJob._freshLogsResetDone) {
          backupImportJob._freshLogsResetDone = true;
          backupImportJob._processedMsgIds = new Set();
          clientDiagnosticLogState.logs = [];
          clientDiagnosticLogState.summaryCounts = { SUBREQUEST_PAUSE: 0, SKIPPED_HEADER: 0, SKIPPED_JUNK: 0 };
          saveClientDiagnosticLogsToStorage();
        }
        if (!(backupImportJob._processedMsgIds instanceof Set)) {
          backupImportJob._processedMsgIds = new Set();
        }
        backupImportJob.running = true;
        backupImportJob.paused = false;
        if (!backupImportJob.startedAt) backupImportJob.startedAt = Date.now();
        renderBackupImportBoxDom();

        const DEFAULT_BATCH_SIZE = getEffectiveImportBatchSizeClient();
        if (!backupImportJob.cursorRetries) backupImportJob.cursorRetries = {};

        const isolateFailedEntryAtCursor = (reasonMsg) => {
          const badIdx = backupImportJob.cursor;
          const badEntry = backupImportJob.entries[badIdx] || {};
          const rawLabel = typeof badEntry === "string"
            ? badEntry
            : (badEntry.rawInput || badEntry.filename || badEntry.file_name || badEntry.cleanTitle || ("Eintrag #" + (badIdx + 1)));
          const fallbackItem = {
            id: "rev_" + badIdx + "_" + Date.now(),
            rawInput: String(rawLabel),
            rawEntry: typeof badEntry === "object" ? badEntry : { filename: String(rawLabel) },
            status: "failed",
            ingestStatus: "failed",
            isUncertain: true,
            confidence: 0,
            typeCode: badEntry.isSeries ? "s" : "m",
            tmdbId: null,
            cleanTitle: badEntry.cleanTitle || String(rawLabel),
            year: badEntry.year || "k.A.",
            poster: "",
            quality: badEntry.quality || "1080p",
            codec: badEntry.codec || "x264",
            part: badEntry.part || null,
            season: badEntry.season || null,
            episode: badEntry.episode || null,
            metadataSource: "Prüfung",
            reviewReasonCode: "API_ERROR",
            errorReason: "Nach Wiederholungsversuch isoliert: " + String(reasonMsg || "Unbekannter Fehler"),
            reason: "Nach Wiederholungsversuch isoliert: " + String(reasonMsg || "Unbekannter Fehler"),
            msgId: (badEntry.msg_id || badEntry.messageId || badEntry.message_id) ? Number(badEntry.msg_id || badEntry.messageId || badEntry.message_id) : null,
            messageLink: badEntry.message_link || badEntry.messageLink || "",
            rawFileName: badEntry.raw_file_name || badEntry.file_name || String(rawLabel),
            rawText: badEntry.raw_text || badEntry.rawText || "",
            sourceUsed: badEntry.source_used || "file_name",
            languages: badEntry.languages || ["de"],
            prevMessages: Array.isArray(badEntry.prev_messages || badEntry.prevMessages) ? (badEntry.prev_messages || badEntry.prevMessages) : [],
            candidates: []
          };
          backupImportJob.reviewItems.push(fallbackItem);
          backupImportJob.failedCount += 1;
          backupImportJob.cursor += 1;
          appendClientDiagnosticLogs([{
            msgId: fallbackItem.msgId,
            fileName: fallbackItem.rawFileName,
            rawText: fallbackItem.rawText,
            status: "API_ERROR",
            reviewReasonCode: "API_ERROR",
            reason: "Nach Wiederholungsversuch isoliert: " + String(reasonMsg || "Unbekannter Fehler"),
            detectedType: fallbackItem.typeCode === "s" ? "series" : "movie",
            parsedTitle: fallbackItem.cleanTitle,
            matchedTitle: null,
            seasonNumber: fallbackItem.season,
            episodeNumber: fallbackItem.episode,
            tmdbId: null,
            rawEntry: fallbackItem.rawEntry
          }], true);
          saveBackupCheckpointClient();
          const isOutdatedWorkerErr = String(reasonMsg || "").includes("normalizeCompareString") || String(reasonMsg || "").includes("externalFallbackCache");
          backupImportJob.recentLog.push(
            "⚠️ Eintrag #" + (badIdx + 1) + " (" + String(rawLabel).slice(0, 36) + ") zur Prüfung isoliert" +
            (isOutdatedWorkerErr ? " [Hinweis: Bitte aktualisierte worker.js in Cloudflare deployen!]" : "") +
            " – fahre bei #" + backupImportJob.cursor + " fort."
          );
        };

        if (!backupImportJob.resolvedTitlesCache || typeof backupImportJob.resolvedTitlesCache !== "object") {
          backupImportJob.resolvedTitlesCache = {};
        }
        if (!(backupImportJob._knownD1FileIds instanceof Set)) {
          backupImportJob._knownD1FileIds = new Set();
        }
        if (!(backupImportJob._knownD1Fingerprints instanceof Set)) {
          backupImportJob._knownD1Fingerprints = new Set();
        }
        const PERSISTENT_BROWSER_TITLES_KEY = "tma_persistent_resolved_titles_v2";
        if (!backupImportJob._loadedPersistentBrowserTitles) {
          backupImportJob._loadedPersistentBrowserTitles = true;
          try {
            const rawSavedTitles = localStorage.getItem(PERSISTENT_BROWSER_TITLES_KEY);
            if (rawSavedTitles) {
              const parsedTitles = JSON.parse(rawSavedTitles);
              if (parsedTitles && typeof parsedTitles === "object") {
                for (const [k, v] of Object.entries(parsedTitles)) {
                  if (v && v.tmdbId && !backupImportJob.resolvedTitlesCache[k]) {
                    backupImportJob.resolvedTitlesCache[k] = v;
                  }
                }
              }
            }
          } catch (e) {}
        }
        let _persistBrowserTitlesTimer = null;
        const schedulePersistBrowserTitlesCache = () => {
          if (_persistBrowserTitlesTimer) return;
          _persistBrowserTitlesTimer = setTimeout(() => {
            _persistBrowserTitlesTimer = null;
            try {
              const entries = Object.entries(backupImportJob.resolvedTitlesCache || {}).filter(([, v]) => v && v.tmdbId);
              const trimmedObj = {};
              const startIdx = Math.max(0, entries.length - 3500);
              for (let i = startIdx; i < entries.length; i++) {
                trimmedObj[entries[i][0]] = entries[i][1];
              }
              localStorage.setItem(PERSISTENT_BROWSER_TITLES_KEY, JSON.stringify(trimmedObj));
            } catch (e) {}
          }, 1200);
        };

        const normClientTitleKey = (t) => String(t || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\\u0300-\\u036f]/g, "")
          .replace(/&/g, "and")
          .replace(/[^a-z0-9]+/g, "")
          .trim();

        // D1-Katalog Pre-Seed: Einmalig beim Start alle bereits in D1 gespeicherten Filme, Serien, Entity-Mappings & Datei-Fingerprints in den Browser-Cache vorladen (0 Such-Calls ab Eintrag #1!)
        if (!backupImportJob._d1CatalogPreSeeded) {
          backupImportJob._d1CatalogPreSeeded = true;
          backupImportJob.currentBatchModeLabel = "🧠 Lade D1-Pre-Seed...";
          backupImportJob.currentBatchModeColor = "#38bdf8";
          renderBackupImportBoxDom();
          try {
            const preRes = await apiFetchJson(API_BASE + "/admin/catalog-preseed", { method: "GET" });
            if (preRes && preRes.ok) {
              let preSeedAdded = 0;
              if (Array.isArray(preRes.items)) {
                for (const pItem of preRes.items) {
                  if (!pItem || !pItem.tmdbId || !pItem.title) continue;
                  const pNorm = normClientTitleKey(pItem.title);
                  if (!pNorm || pNorm === "unbekannt") continue;
                  const pType = pItem.typeCode === "s" ? "s" : "m";
                  const pYear = pItem.year ? String(pItem.year) : "any";
                  const cacheObj = {
                    tmdbId: Number(pItem.tmdbId),
                    typeCode: pType,
                    cleanTitle: String(pItem.title),
                    poster: pItem.poster || ""
                  };
                  backupImportJob.resolvedTitlesCache[pType + "_" + pNorm + "_" + pYear] = cacheObj;
                  if (!backupImportJob.resolvedTitlesCache[pType + "_" + pNorm + "_any"]) {
                    backupImportJob.resolvedTitlesCache[pType + "_" + pNorm + "_any"] = cacheObj;
                  }
                  preSeedAdded++;
                }
              }
              if (Array.isArray(preRes.entityMappings)) {
                for (const em of preRes.entityMappings) {
                  if (!em || !em.tmdbId) continue;
                  const emNorm = normClientTitleKey(em.title || "");
                  const emType = em.typeCode === "s" ? "s" : "m";
                  const cacheObj = {
                    tmdbId: Number(em.tmdbId),
                    typeCode: emType,
                    cleanTitle: String(em.title || ""),
                    poster: em.poster || ""
                  };
                  if (emNorm && emNorm !== "unbekannt") {
                    if (!backupImportJob.resolvedTitlesCache[emType + "_" + emNorm + "_any"]) {
                      backupImportJob.resolvedTitlesCache[emType + "_" + emNorm + "_any"] = cacheObj;
                    }
                  }
                  const strippedKey = String(em.cacheKey || "").replace(/^title_res_/, "");
                  if (strippedKey && !backupImportJob.resolvedTitlesCache[strippedKey]) {
                    backupImportJob.resolvedTitlesCache[strippedKey] = cacheObj;
                  }
                }
              }
              if (Array.isArray(preRes.existingFileIds)) {
                for (const fid of preRes.existingFileIds) {
                  if (fid) backupImportJob._knownD1FileIds.add(String(fid));
                }
              }
              if (Array.isArray(preRes.existingFingerprints)) {
                for (const fp of preRes.existingFingerprints) {
                  if (fp && fp !== "0_0_0x0") backupImportJob._knownD1Fingerprints.add(String(fp));
                }
              }
              backupImportJob.d1PreSeedCount = preSeedAdded;
              schedulePersistBrowserTitlesCache();
              if (preSeedAdded > 0 || backupImportJob._knownD1FileIds.size > 0) {
                backupImportJob.recentLog.push(
                  "🧠 D1-Katalog Pre-Seed geladen: " +
                  preSeedAdded.toLocaleString("de-DE") + " Titel & " +
                  backupImportJob._knownD1FileIds.size.toLocaleString("de-DE") + " Datei-IDs im Browser-Cache bereit!"
                );
              }
            }
          } catch (preErr) {}
          renderBackupImportBoxDom();
        }

        while (backupImportJob.running && !backupImportJob.paused && backupImportJob.cursor < backupImportJob.entries.length) {
          let waitGuard = 0;
          while (window._adminPriorityRequestInFlight && waitGuard < 25) {
            await new Promise(res => setTimeout(res, 150));
            waitGuard++;
          }
          if (!backupImportJob.running || backupImportJob.paused) break;

          const curRetryCount = Number(backupImportJob.cursorRetries[backupImportJob.cursor] || 0);
          const lookaheadSlice = backupImportJob.entries.slice(backupImportJob.cursor, backupImportJob.cursor + 24);
          let lookaheadCacheHits = 0;
          let consecutivePreResolved = 0;
          let streakBroken = false;
          const seenSeriesInLookahead = new Set();
          for (const lkItem of lookaheadSlice) {
            if (!lkItem || typeof lkItem !== "object") continue;
            if (lkItem.tmdb_id || lkItem.tmdbId) {
              lookaheadCacheHits++;
              if (!streakBroken) consecutivePreResolved++;
              continue;
            }
            const lkKey = normClientTitleKey(lkItem.cleanTitle || lkItem.title || "");
            if (!lkKey) {
              streakBroken = true;
              continue;
            }
            const lkType = (lkItem.typeCode === "s" || lkItem.isSeries || lkItem.season || lkItem.episode) ? "s" : "m";
            const lkYear = lkItem.year && lkItem.year !== "k.A." ? String(lkItem.year) : "any";
            const isResolvedInBrowser = Boolean(
              backupImportJob.resolvedTitlesCache[lkType + "_" + lkKey + "_" + lkYear]?.tmdbId ||
              backupImportJob.resolvedTitlesCache[lkType + "_" + lkKey + "_any"]?.tmdbId
            );
            if (isResolvedInBrowser) {
              lookaheadCacheHits++;
              if (!streakBroken) consecutivePreResolved++;
            } else if (lkType === "s" && seenSeriesInLookahead.has(lkKey)) {
              // Weitere Folgen derselben Serie im selben Batch benötigen 0 zusätzliche TMDb-Subrequests!
              lookaheadCacheHits++;
            } else {
              if (lkType === "s") seenSeriesInLookahead.add(lkKey);
              streakBroken = true;
            }
          }

          const healthSt = window._workerHealthMonitorState || {};
          if (healthSt.cooldownUntil && Date.now() < healthSt.cooldownUntil) {
            const waitCooldownMs = Math.min(2800, Math.max(200, healthSt.cooldownUntil - Date.now()));
            backupImportJob.currentBatchModeLabel = "🛡️ CPU-Cooldown (" + (waitCooldownMs / 1000).toFixed(1) + "s Pause)";
            backupImportJob.currentBatchModeColor = "#f59e0b";
            renderBackupImportBoxDom();
            await new Promise(r => setTimeout(r, waitCooldownMs));
          }
          const curProfileBaseSize = getEffectiveImportBatchSizeClient();
          const healthRecSize = Number(healthSt.recommendedBatchSize || 5);
          let effectiveBatchSize = Math.min(curProfileBaseSize, healthRecSize);
          let isPreResolvedFastBatch = false;
          if (curRetryCount > 0) {
            effectiveBatchSize = 1;
            backupImportJob.currentBatchModeLabel = "🔍 Einzel-Isolierung (1/Batch)";
            backupImportJob.currentBatchModeColor = "#fbbf24";
          } else if (healthSt.throttled || backupImportJob._lastBatchHadLatencyCooldown) {
            effectiveBatchSize = Math.min(2, Math.max(1, healthRecSize));
            backupImportJob._lastBatchHadLatencyCooldown = false;
            backupImportJob.currentBatchModeLabel = "🛡️ Auto-Throttle (" + effectiveBatchSize + "/Batch • <7ms CPU Schutz)";
            backupImportJob.currentBatchModeColor = "#f59e0b";
          } else if (consecutivePreResolved >= 8) {
            effectiveBatchSize = Math.min(20, consecutivePreResolved);
            isPreResolvedFastBatch = true;
            backupImportJob.currentBatchModeLabel = "⚡ Browser-Cache Fast-Batch (" + effectiveBatchSize + "/Batch • 0 Such-Calls)";
            backupImportJob.currentBatchModeColor = "#10b981";
          } else if (lookaheadCacheHits >= 5) {
            effectiveBatchSize = Math.min(12, curProfileBaseSize + 5);
            isPreResolvedFastBatch = consecutivePreResolved >= 5;
            backupImportJob.currentBatchModeLabel = "🚀 Turbo (" + effectiveBatchSize + "/Batch • Cache-Hits)";
            backupImportJob.currentBatchModeColor = "#34d399";
          } else {
            effectiveBatchSize = Math.min(6, curProfileBaseSize + 1);
            const profShort = (state.adminWorkerSpeedProfile || "free_turbo") === "free_turbo" ? "🛡️ Free-Turbo" : (state.adminWorkerSpeedProfile === "paid_pro" ? "🚀 Paid Pro" : "⚖️ Ausgewogen");
            backupImportJob.currentBatchModeLabel = profShort + " (" + effectiveBatchSize + "/Batch)";
            backupImportJob.currentBatchModeColor = "#00e5ff";
          }
          const rawSlice = backupImportJob.entries.slice(backupImportJob.cursor, backupImportJob.cursor + effectiveBatchSize);

          // MODUL 1.1: Set-basierte Deduplizierung inkl. processedMsgIds (bereits abgearbeitete msg.id ohne Logging überspringen!)
          const seenBatchItemKeys = new Set();
          const dedupedRawSlice = [];
          const dedupedOrigIndices = [];
          let batchDedupDropped = 0;
          for (let sIdx = 0; sIdx < rawSlice.length; sIdx++) {
            const item = rawSlice[sIdx];
            if (!item || typeof item !== "object") {
              dedupedRawSlice.push(item);
              dedupedOrigIndices.push(sIdx);
              continue;
            }
            const itemMsgId = Number(item.msg_id || item.message_id || item.messageId || 0);
            if (itemMsgId > 0 && backupImportJob._processedMsgIds.has(itemMsgId)) {
              continue;
            }
            const rawTitle = String(item.cleanTitle || item.title || item.filename || item.file_name || item.raw_file_name || item.rawInput || "").trim();
            const normTitle = normClientTitleKey(rawTitle);
            const tgIdKey = String(item.fileFingerprint || item.telegram_unique_id || item.file_unique_id || item.telegram_file_id || item.file_id || item.msg_id || item.message_id || "").trim();
            const seKey = (item.season || item.episode) ? ("s" + (item.season || 0) + "e" + (item.episode || 0)) : "";
            const yKey = String(item.year || "").trim();
            if (tgIdKey || normTitle) {
              const compositeKey = tgIdKey + "::" + normTitle + "::" + seKey + "::" + yKey;
              if (seenBatchItemKeys.has(compositeKey)) {
                batchDedupDropped++;
                continue;
              }
              seenBatchItemKeys.add(compositeKey);
            }
            dedupedRawSlice.push(item);
            dedupedOrigIndices.push(sIdx);
          }

          if (dedupedRawSlice.length === 0) {
            backupImportJob.cursor += rawSlice.length;
            backupImportJob.duplicatesInDb += batchDedupDropped;
            saveBackupCheckpointClient(false);
            renderBackupImportBoxDom();
            continue;
          }

          // 2. Browser-Titel-Cache: Bereits im Lauf oder per D1-Pre-Seed aufgelöste Serien/Filme direkt mit ihrer TMDb-ID annotieren (0 Such-Calls im Worker!)
          const slice = dedupedRawSlice.map(entry => {
            if (!entry || typeof entry !== "object") return entry;
            if (entry.tmdb_id || entry.tmdbId || entry.knownUnmatched) return entry;
            const rawTitle = entry.cleanTitle || entry.title || "";
            const nKey = normClientTitleKey(rawTitle);
            if (!nKey || nKey === "unbekannt" || nKey.length < 2) return entry;
            const tCode = (entry.typeCode === "s" || entry.isSeries || entry.season || entry.episode) ? "s" : "m";
            const yKey = entry.year && entry.year !== "k.A." ? String(entry.year) : "any";
            const cachedHit = backupImportJob.resolvedTitlesCache[tCode + "_" + nKey + "_" + yKey]
              || (tCode === "s" ? backupImportJob.resolvedTitlesCache["s_" + nKey + "_any"] : null)
              || (yKey === "any" ? backupImportJob.resolvedTitlesCache[tCode + "_" + nKey + "_any"] : null);
            if (!cachedHit) return entry;
            if (cachedHit.knownUnmatched) {
              return { ...entry, knownUnmatched: true };
            }
            if (cachedHit.tmdbId) {
              backupImportJob.browserCacheHitsCount = Number(backupImportJob.browserCacheHitsCount || 0) + 1;
              return {
                ...entry,
                tmdb_id: cachedHit.tmdbId,
                typeCode: cachedHit.typeCode || tCode,
                isSeries: (cachedHit.typeCode || tCode) === "s",
                cleanTitle: cachedHit.cleanTitle || entry.cleanTitle,
                external_poster_url: entry.external_poster_url || cachedHit.poster || ""
              };
            }
            return entry;
          });
          let hadRateWarning = false;
          let batchLatencyMs = 0;
          try {
            const isFinalBatchFlag = (backupImportJob.cursor + rawSlice.length >= backupImportJob.entries.length);
            backupImportJob._batchStepCounter = Number(backupImportJob._batchStepCounter || 0) + 1;
            const shouldPersistD1Checkpoint = isFinalBatchFlag || (backupImportJob._batchStepCounter % 10 === 0);
            const lightweightCheckpoint = shouldPersistD1Checkpoint ? {
              fileName: backupImportJob.fileName,
              total: backupImportJob.entries.length,
              cursor: backupImportJob.cursor,
              moviesSaved: backupImportJob.moviesSaved,
              seriesSaved: backupImportJob.seriesSaved,
              failedCount: backupImportJob.failedCount,
              duplicatesInDb: backupImportJob.duplicatesInDb,
              mergedQualitiesInDb: backupImportJob.mergedQualitiesInDb,
              uncertainCount: backupImportJob.uncertainCount
            } : null;
            const tBatchStartMs = Date.now();
            const r = await apiFetchJson(API_BASE + "/admin/import-batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                entries: slice,
                isPreResolvedFastBatch,
                batchStartCursor: backupImportJob.cursor,
                isFinalBatch: isFinalBatchFlag,
                sourceChannelId: activeChan,
                playlistName: backupImportJob.customPlaylistName || backupImportJob.fileName || "JSON-Import",
                playlistMode: backupImportJob.playlistMode || "both",
                playlistFolderId: backupImportJob.playlistFolderId || null,
                targetChatId: backupImportJob.targetPlaylistChatId || chatId,
                sourceLabel: backupImportJob.isTelegramBackup ? ("Telegram Backup: " + backupImportJob.backupChatName) : backupImportJob.fileName,
                speedProfile: state.adminWorkerSpeedProfile || "free_turbo",
                deferKvWrite: true,
                checkpoint: lightweightCheckpoint
              })
            });
            batchLatencyMs = Date.now() - tBatchStartMs;
            if (r && r.ok) {
              delete backupImportJob.cursorRetries[backupImportJob.cursor];
              if (r.playlistFolder?.id) {
                backupImportJob.playlistFolderId = r.playlistFolder.id;
                backupImportJob.customPlaylistName = r.playlistFolder.name;
              }
              const batchStartIdx = backupImportJob.cursor;
              // MODUL 1.2: 38-Subrequest- & 6000ms-Zeit-Guard: Wenn der Worker PARTIAL_BATCH meldet, rückt der Cursor exakt zum nächsten unverarbeiteten Original-Index vor!
              const processedSliceCount = (r.status === "PARTIAL_BATCH" && typeof r.nextStartIndex === "number" && r.nextStartIndex >= 0)
                ? r.nextStartIndex
                : slice.length;
              const rawAdvanceCount = (r.status === "PARTIAL_BATCH" && processedSliceCount < dedupedOrigIndices.length)
                ? dedupedOrigIndices[processedSliceCount]
                : rawSlice.length;
              const processedCount = processedSliceCount;
              for (let pi = 0; pi < processedSliceCount; pi++) {
                const pEntry = dedupedRawSlice[pi];
                const pMsgId = Number(pEntry?.msg_id || pEntry?.message_id || pEntry?.messageId || 0);
                if (pMsgId > 0) backupImportJob._processedMsgIds.add(pMsgId);
              }
              backupImportJob.cursor += rawAdvanceCount;
              backupImportJob.moviesSaved += Number(r.moviesAddedCount || 0);
              backupImportJob.seriesSaved += Number(r.seriesAddedCount || 0);
              backupImportJob.failedCount += Number(r.failedCount || 0);
              backupImportJob.duplicatesInDb += Number(r.duplicatesCount || 0) + batchDedupDropped;
              backupImportJob.mergedQualitiesInDb += Number(r.mergedQualitiesCount || 0);
              backupImportJob.uncertainCount += Number(r.uncertainCount || 0);

              if (Array.isArray(r.batchItems)) {
                const batchDiagEntries = [];
                const newlyResolvedSeriesMap = {};
                for (let bi = 0; bi < r.batchItems.length; bi++) {
                  const bItem = r.batchItems[bi];
                  const isFailedItem = bItem.status === "failed" || !bItem.tmdbId;
                  if (bItem.msgId) backupImportJob._processedMsgIds.add(Number(bItem.msgId));
                  const origEntry = rawSlice[bi] || bItem.rawEntry || {};
                  const rawInTitle = origEntry.cleanTitle || origEntry.title || bItem.cleanTitle || "";
                  const normInKey = normClientTitleKey(rawInTitle);
                  const normResKey = normClientTitleKey(bItem.cleanTitle || "");
                  const itemTypeCode = bItem.typeCode === "s" ? "s" : "m";
                  const itemYearKey = (origEntry.year && origEntry.year !== "k.A.") ? String(origEntry.year) : ((bItem.year && bItem.year !== "k.A.") ? String(bItem.year) : "any");
                  if (bItem.tmdbId && Number(bItem.confidence || 100) >= 75) {
                    const cacheVal = {
                      tmdbId: Number(bItem.tmdbId),
                      typeCode: itemTypeCode,
                      cleanTitle: bItem.cleanTitle || rawInTitle,
                      poster: bItem.poster || ""
                    };
                    if (normInKey && normInKey !== "unbekannt") {
                      backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normInKey + "_" + itemYearKey] = cacheVal;
                      if (itemTypeCode === "s" || itemYearKey === "any") {
                        backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normInKey + "_any"] = cacheVal;
                      }
                      newlyResolvedSeriesMap[itemTypeCode + "_" + normInKey] = cacheVal;
                    }
                    if (normResKey && normResKey !== "unbekannt") {
                      backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normResKey + "_" + itemYearKey] = cacheVal;
                      if (itemTypeCode === "s" || itemYearKey === "any") {
                        backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normResKey + "_any"] = cacheVal;
                      }
                      newlyResolvedSeriesMap[itemTypeCode + "_" + normResKey] = cacheVal;
                    }
                  } else if (isFailedItem && bItem.reviewReasonCode === "TMDB_NOT_FOUND" && normInKey && normInKey !== "unbekannt") {
                    if (!backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normInKey + "_any"]?.tmdbId) {
                      backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normInKey + "_" + itemYearKey] = { knownUnmatched: true };
                      if (itemTypeCode === "s" || itemYearKey === "any") {
                        backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normInKey + "_any"] = { knownUnmatched: true };
                      }
                    }
                  }
                  const computedReason = bItem.errorReason || (isFailedItem
                    ? "Kein TMDb-Treffer für '" + (bItem.cleanTitle || bItem.rawInput || "") + "'"
                    : bItem.isUncertain
                      ? "Unsichere Zuordnung (" + (bItem.confidence || 0) + "%) → " + (bItem.cleanTitle || "")
                      : bItem.ingestStatus === "skipped_prerelease"
                        ? "Vorabversion/TS/MD übersprungen (gute Version bereits in D1)"
                        : bItem.ingestStatus === "duplicate"
                          ? "Identische Datei (fileFingerprint) bereits in D1 vorhanden (" + (bItem.cleanTitle || "") + ")"
                          : bItem.ingestStatus === "updated"
                            ? "Bestehender Episoden-/Film-Slot per UPSERT mit neuer Datei verknüpft → " + (bItem.cleanTitle || "")
                            : "Erfolgreich zugeordnet → " + (bItem.cleanTitle || "") + (bItem.tmdbId ? " (TMDb #" + bItem.tmdbId + ")" : "") + (Number(bItem.replacedPrereleaseCount || 0) > 0 ? (" [🧹 " + bItem.replacedPrereleaseCount + " Vorabversion ersetzt!]") : ""));
                  const computedReasonCode = bItem.reviewReasonCode || (isFailedItem ? "TMDB_NOT_FOUND" : (bItem.isUncertain ? inferClientReviewReasonCode({ ...bItem, errorReason: computedReason }) : null));
                  const itemObj = {
                    ...bItem,
                    status: isFailedItem ? "failed" : bItem.status,
                    tmdbId: isFailedItem ? null : (bItem.tmdbId || null),
                    matchedTitle: isFailedItem ? null : (bItem.matchedTitle || bItem.cleanTitle || null),
                    reviewReasonCode: computedReasonCode,
                    errorReason: bItem.errorReason || (isFailedItem || bItem.isUncertain ? computedReason : null),
                    reason: computedReason,
                    msgId: bItem.msgId ? Number(bItem.msgId) : null,
                    id: "rev_" + (batchStartIdx + bi) + "_" + Date.now()
                  };
                  backupImportJob.reviewItems.push(itemObj);
                  if (bItem.tmdbId && !isFailedItem) {
                    backupImportJob.livePosterFeed.unshift(itemObj);
                  }
                  const diagStatus = isFailedItem
                    ? "TMDB_NOT_FOUND"
                    : bItem.isUncertain
                      ? "CONFLICT_?"
                      : bItem.ingestStatus === "skipped_prerelease"
                        ? "SKIPPED_PRERELEASE"
                        : bItem.ingestStatus === "duplicate"
                          ? "SKIPPED_DUPLICATE"
                          : "OK";
                  batchDiagEntries.push({
                    msgId: bItem.msgId ? Number(bItem.msgId) : null,
                    fileName: bItem.rawFileName || bItem.rawInput || bItem.cleanTitle || "Unbekannt",
                    rawText: bItem.rawText || "",
                    status: diagStatus,
                    reviewReasonCode: computedReasonCode,
                    reason: computedReason,
                    detectedType: bItem.typeCode === "s" ? "series" : "movie",
                    parsedTitle: bItem.parsedTitle || bItem.cleanTitle || "",
                    matchedTitle: isFailedItem ? null : (bItem.matchedTitle || bItem.cleanTitle || null),
                    seasonNumber: bItem.season || null,
                    episodeNumber: bItem.episode || null,
                    tmdbId: isFailedItem ? null : (bItem.tmdbId || null),
                    rawEntry: bItem.rawEntry || null
                  });
                }
                if (r.status === "PARTIAL_BATCH") {
                  const isTimeGuard = r.pauseReason === "TIME_LIMIT_GUARD";
                  if (!clientDiagnosticLogState.summaryCounts) {
                    clientDiagnosticLogState.summaryCounts = { SUBREQUEST_PAUSE: 0, SKIPPED_HEADER: 0, SKIPPED_JUNK: 0 };
                  }
                  // MODUL 1.2: SUBREQUEST_PAUSE NUR in summaryCounts hochzählen, NIEMALS in batchDiagEntries / entries schreiben!
                  clientDiagnosticLogState.summaryCounts.SUBREQUEST_PAUSE = (clientDiagnosticLogState.summaryCounts.SUBREQUEST_PAUSE || 0) + 1;
                  backupImportJob.recentLog.push("🛡️ " + (isTimeGuard ? "6s-Zeit-Guard" : "38-Subrequest-Guard") + " aktiv (" + processedCount + "/" + slice.length + " im Batch verarbeitet) – setze nahtlos bei #" + backupImportJob.cursor + " fort...");
                }
                appendClientDiagnosticLogs(batchDiagEntries, false);
                schedulePersistBrowserTitlesCache();
                if (backupImportJob.reviewItems.length > 900) {
                  const priorityReviews = [];
                  const routineReviews = [];
                  for (const rv of backupImportJob.reviewItems) {
                    if (rv && (rv.status === "failed" || rv.isUncertain || rv.contextError || !rv.tmdbId || Number(rv.tmdbId) >= 900000000)) {
                      priorityReviews.push(rv);
                    } else {
                      routineReviews.push(rv);
                    }
                  }
                  const keepRoutineCount = Math.max(200, 900 - priorityReviews.length);
                  backupImportJob.reviewItems = [
                    ...priorityReviews,
                    ...routineReviews.slice(-keepRoutineCount)
                  ];
                }
                if (backupImportJob.livePosterFeed.length > 16) {
                  backupImportJob.livePosterFeed = backupImportJob.livePosterFeed.slice(0, 16);
                }

                // AUTO-NACHHEILUNG (Breaking Bad S01E01 Fix):
                // Falls eine frühere Episode derselben Serie im aktuellen Lauf wegen Subrequest-Cutoff oder temporärem Timeout
                // als TMDB_NOT_FOUND liegen geblieben ist, verknüpfe sie jetzt sofort automatisch mit der erkannten TMDb-ID!
                if (Object.keys(newlyResolvedSeriesMap).length > 0 && Array.isArray(backupImportJob.reviewItems)) {
                  const orphansToHeal = [];
                  for (let ri = 0; ri < backupImportJob.reviewItems.length; ri++) {
                    const prevRev = backupImportJob.reviewItems[ri];
                    if (!prevRev || prevRev.status !== "failed" || prevRev.tmdbId || prevRev._autoHealed) continue;
                    const pType = (prevRev.typeCode === "s" || prevRev.season || prevRev.episode) ? "s" : "m";
                    const pNorm = normClientTitleKey(prevRev.cleanTitle || prevRev.rawEntry?.cleanTitle || "");
                    const matchedResolved = pNorm ? newlyResolvedSeriesMap[pType + "_" + pNorm] : null;
                    if (matchedResolved && matchedResolved.tmdbId) {
                      prevRev._autoHealed = true;
                      orphansToHeal.push({ revItem: prevRev, resolved: matchedResolved });
                    }
                  }
                  if (orphansToHeal.length > 0) {
                    try {
                      const healEntries = orphansToHeal.map(o => ({
                        ...(typeof o.revItem.rawEntry === "object" && o.revItem.rawEntry ? o.revItem.rawEntry : { filename: o.revItem.rawInput }),
                        tmdb_id: o.resolved.tmdbId,
                        typeCode: o.resolved.typeCode,
                        isSeries: o.resolved.typeCode === "s",
                        cleanTitle: o.resolved.cleanTitle || o.revItem.cleanTitle,
                        external_poster_url: o.resolved.poster || "",
                        bypassNegativeTitleCache: true
                      }));
                      const healRes = await apiFetchJson(API_BASE + "/admin/import-batch", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          entries: healEntries,
                          sourceChannelId: activeChan,
                          playlistName: backupImportJob.customPlaylistName || backupImportJob.fileName || "JSON-Import",
                          playlistMode: backupImportJob.playlistMode || "both",
                          playlistFolderId: backupImportJob.playlistFolderId || null,
                          targetChatId: backupImportJob.targetPlaylistChatId || chatId,
                          sourceLabel: backupImportJob.isTelegramBackup ? ("Telegram Backup: " + backupImportJob.backupChatName) : backupImportJob.fileName,
                          deferKvWrite: true
                        })
                      });
                      if (healRes && healRes.ok && Array.isArray(healRes.batchItems)) {
                        for (let hi = 0; hi < orphansToHeal.length; hi++) {
                          const healedItem = healRes.batchItems[hi];
                          const targetRev = orphansToHeal[hi].revItem;
                          if (healedItem && healedItem.tmdbId) {
                            targetRev.status = healedItem.ingestStatus || "added";
                            targetRev.isUncertain = false;
                            targetRev.contextError = false;
                            targetRev.reviewReasonCode = null;
                            targetRev.errorReason = null;
                            targetRev.tmdbId = healedItem.tmdbId;
                            targetRev.cleanTitle = healedItem.cleanTitle || targetRev.cleanTitle;
                            targetRev.year = healedItem.year || targetRev.year;
                            targetRev.poster = healedItem.poster || orphansToHeal[hi].resolved.poster || "";
                            targetRev.reason = "🩹 Automatisch nachgeheilt → " + targetRev.cleanTitle + " (TMDb #" + healedItem.tmdbId + ")";
                            backupImportJob.failedCount = Math.max(0, Number(backupImportJob.failedCount || 0) - 1);
                            if (healedItem.typeCode === "s") backupImportJob.seriesSaved++;
                            else backupImportJob.moviesSaved++;
                            if (Array.isArray(backupImportJob.clientDiagLogs)) {
                              for (const dLog of backupImportJob.clientDiagLogs) {
                                if (dLog && dLog.status === "TMDB_NOT_FOUND" &&
                                    ((targetRev.msgId && Number(dLog.msgId) === Number(targetRev.msgId)) ||
                                     dLog.fileName === (targetRev.rawFileName || targetRev.rawInput))) {
                                  dLog.status = "OK";
                                  dLog.reviewReasonCode = null;
                                  dLog.tmdbId = healedItem.tmdbId;
                                  dLog.parsedTitle = targetRev.cleanTitle;
                                  dLog.reason = targetRev.reason;
                                }
                              }
                            }
                            const seLabel = targetRev.season
                              ? (" S" + String(targetRev.season).padStart(2, "0") + "E" + String(targetRev.episode || 1).padStart(2, "0"))
                              : "";
                            backupImportJob.recentLog.push("🩹 Auto-Nachheilung: " + targetRev.cleanTitle + seLabel + " nachträglich mit TMDb #" + healedItem.tmdbId + " verknüpft!");
                          }
                        }
                      }
                    } catch (healErr) {}
                  }
                }
              }

              if (Array.isArray(r.sampleTitles) && r.sampleTitles.length > 0) {
                backupImportJob.recentLog.push("✅ Batch #" + Math.ceil(backupImportJob.cursor / DEFAULT_BATCH_SIZE) + " [" + (backupImportJob.customPlaylistName || "Playlist") + "]: " + r.sampleTitles.slice(0, 3).join(", "));
              }
              saveBackupCheckpointClient(false);
            } else {
              hadRateWarning = true;
              const errMsg = String(r?.error || "Kurze Pause...");
              if (state.adminWorkerSpeedProfile && state.adminWorkerSpeedProfile !== "free_turbo") {
                state.adminWorkerSpeedProfile = "free_turbo";
                try { localStorage.setItem("tma_worker_speed_profile", "free_turbo"); } catch (e) {}
                backupImportJob.recentLog.push("🛡️ Automatischer Wechsel auf „Free-Tier Turbo“ nach Server-Warnung.");
              }
              const nextRetry = curRetryCount + 1;
              backupImportJob.cursorRetries[backupImportJob.cursor] = nextRetry;
              if (nextRetry >= 3) {
                isolateFailedEntryAtCursor(errMsg);
              } else {
                saveBackupCheckpointClient(false);
                const waitMs = 1800 * nextRetry;
                backupImportJob.recentLog.push("⏳ Einzel-Prüfung (" + nextRetry + "/2) bei Checkpoint #" + backupImportJob.cursor + ": " + errMsg);
                await new Promise(res => setTimeout(res, waitMs));
              }
            }
          } catch (e) {
            hadRateWarning = true;
            const errMsg = String(e?.message || e || "Netzwerkfehler");
            if (state.adminWorkerSpeedProfile && state.adminWorkerSpeedProfile !== "free_turbo") {
              state.adminWorkerSpeedProfile = "free_turbo";
              try { localStorage.setItem("tma_worker_speed_profile", "free_turbo"); } catch (err) {}
              backupImportJob.recentLog.push("🛡️ Timeout erkannt – schalte automatisch auf „Free-Tier Turbo“ (12/Batch, 3.2s Guard) um!");
            }
            const nextRetry = curRetryCount + 1;
            backupImportJob.cursorRetries[backupImportJob.cursor] = nextRetry;
            if (nextRetry >= 3) {
              isolateFailedEntryAtCursor(errMsg);
            } else {
              saveBackupCheckpointClient(false);
              const waitMs = 2200 * nextRetry;
              backupImportJob.recentLog.push("⏳ Rate-Limit / Einzel-Isolierung (" + nextRetry + "/2) bei #" + backupImportJob.cursor + ": " + errMsg);
              await new Promise(res => setTimeout(res, waitMs));
            }
          }
          renderBackupImportBoxDom();
          // Adaptives Pacing statt starrer 5s-Pause bei >2000ms:
          // Normale TMDb-Batches bis 4500ms laufen ohne Zusatzpause durch; 4500–6500ms erhalten 1s Verschnaufpause; erst ab >6500ms greift ein 2s Cooldown.
          if (batchLatencyMs > 6500 && backupImportJob.running && !backupImportJob.paused) {
            backupImportJob._lastBatchHadLatencyCooldown = true;
            backupImportJob.currentBatchModeLabel = "⏳ Kurz-Pause (2s Cooldown)";
            backupImportJob.currentBatchModeColor = "#fbbf24";
            backupImportJob.recentLog.push("⏳ Kurz-Pause (2s Cooldown): Hohe Worker-Batch-Latenz (" + batchLatencyMs + "ms > 6500ms) – drossele Folge-Batch auf 6 Einträge");
            renderBackupImportBoxDom();
            await new Promise(res => setTimeout(res, 2000));
          } else if (batchLatencyMs > 4500 && backupImportJob.running && !backupImportJob.paused) {
            backupImportJob._lastBatchHadLatencyCooldown = true;
            backupImportJob.currentBatchModeLabel = "🛡️ Adaptives Pacing (1s)";
            backupImportJob.currentBatchModeColor = "#f59e0b";
            renderBackupImportBoxDom();
            await new Promise(res => setTimeout(res, 1000));
          } else {
            await new Promise(res => setTimeout(res, hadRateWarning ? 500 : 220));
          }
        }

        backupImportJob.running = false;
        if (backupImportJob.cursor >= backupImportJob.entries.length && backupImportJob.entries.length > 0) {
          saveBackupCheckpointClient(true);
          clearClientMediaCaches();
          showHudToast("🎉 Smart-Import 100% abgeschlossen! Alle Einträge sind dauerhaft in D1 gespeichert.");
        }
        renderBackupImportBoxDom();
      }

      function pauseBackupImport() {
        backupImportJob.paused = true;
        backupImportJob.running = false;
        saveBackupCheckpointClient(true);
        showHudToast("⏸️ Pausiert & Checkpoint bei #" + backupImportJob.cursor + " gespeichert.");
        renderBackupImportBoxDom();
      }

      function resetBackupImport(clearSaved = false) {
        if (clearSaved) {
          clearBackupCheckpointClient();
          backupImportJob.savedCheckpoint = null;
        }
        backupImportJob.paused = true;
        backupImportJob.running = false;
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
        backupImportJob.recentLog = [];
        backupImportJob.livePosterFeed = [];
        backupImportJob.reviewItems = [];
        backupImportJob.activeSubTab = "dashboard";
        renderBackupImportBoxDom();
      }

      async function runServerD1QueueStepAdmin(rounds = 2) {
        setBusyState(true, "⏳ Verarbeite nächsten Batch aus der D1-Import-Warteschlange...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/import-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "step", rounds })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "D1-Import-Batch konnte nicht ausgeführt werden."));
            return;
          }
          await loadAdminPanelView(true);
        } finally {
          setBusyState(false);
        }
      }

      async function clearServerD1QueueAdmin() {
        const ok = await showCustomConfirm("Gesamte D1-Import-Warteschlange wirklich leeren?", "🗑️ Queue leeren");
        if (!ok) return;
        setBusyState(true, "🗑️ Leere D1-Import-Warteschlange...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/import-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "clear" })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "D1-Warteschlange konnte nicht geleert werden."));
            return;
          }
          showHudToast("🗑️ D1-Warteschlange geleert");
          await loadAdminPanelView(true);
        } finally {
          setBusyState(false);
        }
      }

      async function adminCreatePlaylistPrompt() {
        const targetUid = state.adminPlaylistTargetChatId || chatId;
        const defaultMode = targetUid === "bot_vip" ? "vip_stream" : "both";
        const name = await showCustomPrompt("🎵 Name für die neue Custom Playlist (Ziel: " + (targetUid === "bot_vip" ? "🤖 Globale Bot-VIP-Playlist" : ("User ID " + targetUid)) + "):", "");
        if (!name || !name.trim()) return;
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", targetChatId: targetUid, name: name.trim(), playlistMode: defaultMode })
        });
        if (!r || !r.ok) {
          showHudToast("⚠️ " + (r?.error || "Playlist konnte nicht angelegt werden."));
          return;
        }
        if (r?.folder?.id) {
          state.adminEditingFolderId = r.folder.id;
        }
        showHudToast("✅ Playlist „" + name.trim() + "“ angelegt");
        loadAdminPanelView();
      }

      async function adminTogglePlaylist(targetUid, folderId) {
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "toggle", targetChatId: targetUid, folderId })
        });
        if (!r || !r.ok) {
          showHudToast("⚠️ " + (r?.error || "Playlist-Status konnte nicht geändert werden."));
          return;
        }
        loadAdminPanelView();
      }

      async function adminSetPlaylistMode(targetUid, folderId, nextMode) {
        const progBox = document.getElementById("adminPlaylistBatchProgressBox");
        let offset = 0;
        const limit = 25;
        let hasMore = true;
        let totalSynced = 0;
        let abortedOnError = false;

        if (progBox) {
          progBox.style.display = "block";
          progBox.innerHTML = '<div style="font-size:12px;color:#38bdf8">⚙️ Schalte Playlist-Modus in 25er-Batches um...</div>';
        }
        try {
          while (hasMore) {
            const r = await apiFetchJson(API_BASE + "/admin/playlists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "set_mode",
                targetChatId: targetUid,
                folderId,
                playlistMode: nextMode,
                offset,
                limit
              })
            });
            if (!r || !r.ok) {
              abortedOnError = true;
              showHudToast("⚠️ Modus-Wechsel abgebrochen: " + (r?.error || "Serverfehler"));
              break;
            }
            totalSynced += Number(r.syncedVipCount || 0);
            hasMore = Boolean(r.hasMore);
            offset = Number(r.nextOffset || (offset + limit));
            const total = Math.max(1, Number(r.total || offset));
            const pct = Math.min(100, Math.round((offset / total) * 100));
            if (progBox) {
              progBox.innerHTML =
                '<div style="display:flex;justify-content:space-between;font-size:12px;color:#34d399;margin-bottom:4px">' +
                  '<span>⚡ Synchronisiere Playlist-Modus in 25er-Batches...</span>' +
                  '<b>' + Math.min(offset, total) + ' / ' + total + ' (' + pct + '%)</b>' +
                '</div>' +
                '<div style="width:100%;height:8px;background:#1e293b;border-radius:999px;overflow:hidden">' +
                  '<div style="width:' + pct + '%;height:100%;background:#10b981;transition:width 0.2s"></div>' +
                '</div>';
            }
          }
          clearClientMediaCaches();
          if (!abortedOnError) {
            const modeLabel = nextMode === "vip_stream" ? "🌟 VIP-Stream-Playlist" : nextMode === "watchlist" ? "🔖 Merkliste" : "⚡ VIP-Stream + Merkliste";
            showHudToast("✅ Modus gesetzt: " + modeLabel + " (" + totalSynced + " Einträge in 25er-Batches verarbeitet)");
          }
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function adminCopyPlaylistBatchClient(sourceUid, sourceFolderId, sourceFolderName) {
        const defaultName = String(sourceFolderName || "Playlist") + " (VIP-Kopie)";
        const targetName = await showCustomPrompt("📋 Name der Ziel-Playlist (wird in 25er-Batches ohne Cloudflare-Limit kopiert):", defaultName);
        if (!targetName || !targetName.trim()) return;

        const progBox = document.getElementById("adminPlaylistBatchProgressBox");
        let offset = 0;
        const limit = 25;
        let hasMore = true;
        let totalCopied = 0;
        let abortedOnError = false;

        if (progBox) {
          progBox.style.display = "block";
          progBox.innerHTML = '<div style="font-size:12px;color:#38bdf8">📋 Starte 25er-Batch-Kopie für „' + esc(targetName.trim()) + '“...</div>';
        }

        while (hasMore) {
          const r = await apiFetchJson(API_BASE + "/admin/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "copy_playlist_batch",
              sourceChatId: sourceUid,
              sourceFolderId: sourceFolderId,
              targetChatId: "bot_vip",
              targetFolderName: targetName.trim(),
              targetMode: "both",
              offset,
              limit
            })
          });
          if (!r || !r.ok) {
            abortedOnError = true;
            showHudToast("⚠️ Batch-Kopie gestoppt bei #" + offset + ": " + (r?.error || "Fehler"));
            break;
          }
          totalCopied += Number(r.copiedInBatch || 0);
          hasMore = Boolean(r.hasMore);
          offset = Number(r.nextOffset || (offset + limit));
          const total = Math.max(1, Number(r.total || offset));
          const pct = Math.min(100, Math.round((offset / total) * 100));
          if (progBox) {
            progBox.innerHTML =
              '<div style="display:flex;justify-content:space-between;font-size:12px;color:#34d399;margin-bottom:4px">' +
                '<span>📋 Kopiere in 25er-Batches nach „' + esc(r.targetFolderName || targetName.trim()) + '“...</span>' +
                '<b>' + Math.min(offset, total) + ' / ' + total + ' (' + pct + '%)</b>' +
              '</div>' +
              '<div style="width:100%;height:8px;background:#1e293b;border-radius:999px;overflow:hidden">' +
                '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#0ea5e9,#10b981);transition:width 0.2s"></div>' +
              '</div>';
          }
          await new Promise(res => setTimeout(res, 120));
        }

        clearClientMediaCaches();
        if (!abortedOnError) {
          showHudToast("✅ Playlist komplett kopiert (" + totalCopied + " Titel in 25er-Batches übertragen)!");
        }
        await loadAdminPanelView();
      }

      async function adminOpenPlaylistEditor(targetUid, folderId) {
        state.adminPlaylistTargetChatId = String(targetUid || chatId);
        state.adminEditingFolderId = String(folderId || "");
        state.adminTab = "playlists";
        await loadAdminPanelView();
      }

      async function adminOpenBotVipPlaylistDirect() {
        state.adminPlaylistTargetChatId = "bot_vip";
        state.adminEditingFolderId = "";
        state.adminTab = "playlists";
        await loadAdminPanelView();
      }

      async function adminReorderPlaylistItem(targetUid, folderId, itemUid, direction) {
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reorder_item", targetChatId: targetUid, folderId, uid: itemUid, direction })
        });
        if (r && r.ok) {
          loadAdminPanelView();
        } else {
          showHudToast("⚠️ " + (r?.error || "Reihenfolge konnte nicht geändert werden."));
        }
      }

      async function adminRemovePlaylistItem(targetUid, folderId, itemUid) {
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove_item", targetChatId: targetUid, folderId, uid: itemUid })
        });
        if (r && r.ok) {
          showHudToast("➖ Titel nur aus Playlist entfernt (bleibt in D1 erhalten)");
          loadAdminPanelView();
        } else {
          showHudToast("⚠️ " + (r?.error || "Titel konnte nicht aus Playlist entfernt werden."));
        }
      }

      function adminDeletePlaylistItemFromBtn(btn) {
        if (!btn) return;
        const targetUid = String(btn.getAttribute("data-target-uid") || state.adminPlaylistTargetChatId || "");
        const folderId = String(btn.getAttribute("data-folder-id") || "");
        const itemUid = String(btn.getAttribute("data-item-uid") || "");
        const typeCode = String(btn.getAttribute("data-type") || "m");
        const tmdbId = Number(btn.getAttribute("data-tmdb-id") || 0);
        const title = String(btn.getAttribute("data-title") || "");
        adminDeletePlaylistItemFromD1(targetUid, folderId, itemUid, typeCode, tmdbId, title);
      }

      async function adminDeletePlaylistItemFromD1(targetUid, folderId, itemUid, typeCode, tmdbId, title) {
        const ok = await showCustomConfirm(
          'Möchtest du "' + (title || ('TMDb #' + tmdbId)) + '" wirklich KOMPLETT aus der D1-Datenbank & dem Telegram-Bot löschen (inkl. aller verknüpften Video-Streams) UND aus der Playlist entfernen?',
          '🗑️ Komplett aus D1 + Bot löschen'
        );
        if (!ok) return;
        setBusyState(true, "🗑️ Lösche Titel + Streams aus D1 & Playlist...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "delete_from_d1",
              targetChatId: targetUid,
              folderId,
              uid: itemUid,
              typeCode,
              tmdbId
            })
          });
          if (r && r.ok) {
            clearClientMediaCaches();
            showHudToast("🗑️ Titel komplett aus D1, Bot & Playlist gelöscht");
            await loadAdminPanelView();
          } else {
            showHudToast("⚠️ " + (r?.error || "Löschen aus D1 fehlgeschlagen."));
          }
        } finally {
          setBusyState(false);
        }
      }

      async function adminSyncBotVipFromD1Client(forceIncludeHidden) {
        const progBox = document.getElementById("adminPlaylistBatchProgressBox");
        let offset = 0;
        const limit = 25;
        let hasMore = true;
        let totalAdded = 0;
        let lastTotalInPlaylist = 0;
        let abortedOnError = false;

        if (progBox) {
          progBox.style.display = "block";
          progBox.innerHTML = '<div style="font-size:12px;color:#38bdf8">🔄 Synchronisiere D1-Katalog in 25er-Batches (umgeht Cloudflare 50-Subrequest-Limit)...</div>';
        }
        try {
          while (hasMore) {
            const r = await apiFetchJson(API_BASE + "/admin/playlists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "sync_d1",
                targetChatId: "bot_vip",
                folderId: state.adminEditingFolderId || "pl_bot_vip_default",
                forceIncludeHidden: Boolean(forceIncludeHidden && offset === 0),
                offset,
                limit
              })
            });
            if (!r || !r.ok) {
              abortedOnError = true;
              showHudToast("⚠️ " + (r?.error || "D1-Synchronisation fehlgeschlagen."));
              break;
            }
            totalAdded += Number(r.addedCount || r.syncedAddedCount || 0);
            lastTotalInPlaylist = Number(r.totalInPlaylist || lastTotalInPlaylist);
            hasMore = Boolean(r.hasMore);
            offset = Number(r.nextOffset || (offset + limit));
            const totalInD1 = Math.max(1, Number(r.totalInD1 || offset));
            const pct = Math.min(100, Math.round((offset / totalInD1) * 100));
            if (progBox) {
              progBox.innerHTML =
                '<div style="display:flex;justify-content:space-between;font-size:12px;color:#38bdf8;margin-bottom:4px">' +
                  '<span>🔄 Synchronisiere D1 → Bot-VIP Playlist (25er-Batches)...</span>' +
                  '<b>' + Math.min(offset, totalInD1) + ' / ' + totalInD1 + ' (' + pct + '%)</b>' +
                '</div>' +
                '<div style="width:100%;height:8px;background:#1e293b;border-radius:999px;overflow:hidden">' +
                  '<div style="width:' + pct + '%;height:100%;background:#38bdf8;transition:width 0.2s"></div>' +
                '</div>';
            }
          }
          clearClientMediaCaches();
          state.adminPlaylistTargetChatId = "bot_vip";
          if (!abortedOnError) {
            showHudToast("✅ D1-Bot-Sync abgeschlossen: " + lastTotalInPlaylist + " Titel in Bot-VIP-Playlist (" + totalAdded + " neu in 25er-Batches verknüpft)");
          }
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function adminAddPlaylistItemClient(targetUid, folderId) {
        const qInp = document.getElementById("plEditorAddQueryInp");
        const tSel = document.getElementById("plEditorAddTypeSel");
        const qualInp = document.getElementById("plEditorAddQualInp");
        const query = (qInp ? qInp.value : "").trim();
        const typeCode = tSel ? tSel.value : "auto";
        const quality = (qualInp ? qualInp.value : "1080p").trim() || "1080p";
        if (!query) {
          showHudToast("⚠️ Bitte Titel oder TMDb-ID eingeben.");
          return;
        }
        setBusyState(true, "➕ Suche & füge „" + query + "“ zur Playlist hinzu...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "add_item", targetChatId: targetUid, folderId, query, typeCode, quality })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Konnte Titel nicht hinzufügen."));
            return;
          }
          clearClientMediaCaches();
          if (qInp) qInp.value = "";
          showHudToast("✅ Hinzugefügt: " + (r.addedItem?.cleanTitle || query));
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      function adminCopyPlaylistBatchFromBtn(btn) {
        if (!btn) return;
        const targetUid = String(btn.getAttribute("data-target-uid") || state.adminPlaylistTargetChatId || "");
        const folderId = String(btn.getAttribute("data-folder-id") || "");
        const name = String(btn.getAttribute("data-name") || "");
        adminCopyPlaylistBatchClient(targetUid, folderId, name);
      }

      function adminRenamePlaylistFromBtn(btn) {
        if (!btn) return;
        const targetUid = String(btn.getAttribute("data-target-uid") || state.adminPlaylistTargetChatId || "");
        const folderId = String(btn.getAttribute("data-folder-id") || "");
        const name = String(btn.getAttribute("data-name") || "");
        adminRenamePlaylist(targetUid, folderId, name);
      }

      function adminDeletePlaylistFromBtn(btn) {
        if (!btn) return;
        const targetUid = String(btn.getAttribute("data-target-uid") || state.adminPlaylistTargetChatId || "");
        const folderId = String(btn.getAttribute("data-folder-id") || "");
        const name = String(btn.getAttribute("data-name") || "");
        adminDeletePlaylist(targetUid, folderId, name);
      }

      async function adminRenamePlaylist(targetUid, folderId, currentName) {
        const nextName = await showCustomPrompt("✏️ Neuer Custom Name für diese Playlist:", currentName || "");
        if (!nextName || !nextName.trim()) return;
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", targetChatId: targetUid, folderId, name: nextName.trim() })
        });
        if (!r || !r.ok) {
          showHudToast("⚠️ " + (r?.error || "Playlist konnte nicht umbenannt werden."));
          return;
        }
        showHudToast("✅ Playlist umbenannt");
        loadAdminPanelView();
      }

      async function adminDeletePlaylist(targetUid, folderId, currentName) {
        const ok = await showCustomConfirm('Playlist "' + (currentName || folderId) + '" (User ' + targetUid + ') samt aller Einträge wirklich löschen?', '🗑️ Löschen');
        if (!ok) return;
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", targetChatId: targetUid, folderId })
        });
        if (!r || !r.ok) {
          showHudToast("⚠️ " + (r?.error || "Playlist konnte nicht gelöscht werden."));
          return;
        }
        if (String(state.adminEditingFolderId) === String(folderId)) {
          state.adminEditingFolderId = "";
        }
        showHudToast("🗑️ Playlist gelöscht");
        loadAdminPanelView();
      }

      async function copyAdminTextToClipboardClient(text, label = "Text") {
        const val = String(text || "").trim();
        if (!val) return;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(val);
            showHudToast("📋 " + label + " in die Zwischenablage kopiert!");
            return;
          }
        } catch (e) {}
        const ta = document.createElement("textarea");
        ta.value = val;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta);
        showHudToast("📋 " + label + " kopiert!");
      }

      async function adminSetVideoCoverModeClient(mode) {
        const cleanMode = ["backdrop", "poster", "off"].includes(mode) ? mode : "backdrop";
        setBusyState(true, "🖼️ Speichere Bot API 8.3 Video-Cover-Modus (" + cleanMode + ")...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/bot-setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "set_cover_mode", videoCoverMode: cleanMode })
          });
          if (r && r.ok) {
            state.adminVideoCoverMode = r.videoCoverMode || cleanMode;
            if (window._lastAdminOverviewCache) {
              window._lastAdminOverviewCache.botSetup = {
                ...(window._lastAdminOverviewCache.botSetup || {}),
                videoCoverMode: state.adminVideoCoverMode
              };
            }
            const labelMap = {
              backdrop: "🖼️ 16:9 Szenenbild (TMDb Backdrop mit Poster-Fallback)",
              poster: "🎬 2:3 Filmplakat (TMDb Poster)",
              off: "⚪ Deaktiviert (Kein Cover-Embedding)"
            };
            showHudToast("✅ Bot API 8.3 Video-Cover: " + (labelMap[state.adminVideoCoverMode] || state.adminVideoCoverMode));
            loadAdminPanelView(false);
          } else {
            showHudToast("⚠️ Konnte Cover-Modus nicht speichern.");
          }
        } finally {
          setBusyState(false);
        }
      }

      function getEffectiveImportBatchSizeClient() {
        if (!state.adminWorkerSpeedProfile) {
          try {
            state.adminWorkerSpeedProfile = localStorage.getItem("tma_worker_speed_profile") || "free_turbo";
          } catch (e) {
            state.adminWorkerSpeedProfile = "free_turbo";
          }
        }
        const prof = String(state.adminWorkerSpeedProfile || "free_turbo");
        if (prof === "paid_pro") return 30;
        if (prof === "balanced") return 18;
        return 12;
      }

      async function adminSetWorkerSpeedProfileClient(profileKey) {
        const cleanProf = ["free_turbo", "balanced", "paid_pro"].includes(profileKey) ? profileKey : "free_turbo";
        const prevProf = state.adminWorkerSpeedProfile || "free_turbo";
        setBusyState(true, "⚡ Aktiviere Worker Geschwindigkeits-Profil (" + cleanProf + ")...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/bot-setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "set_speed_profile", speedProfile: cleanProf })
          });
          if (!r || !r.ok) {
            state.adminWorkerSpeedProfile = prevProf;
            showHudToast("⚠️ " + (r?.error || "Worker-Profil konnte nicht auf dem Server gespeichert werden."));
            return;
          }
          state.adminWorkerSpeedProfile = r.speedProfile || cleanProf;
          try {
            localStorage.setItem("tma_worker_speed_profile", state.adminWorkerSpeedProfile);
          } catch (e) {}
          if (window._lastAdminOverviewCache) {
            window._lastAdminOverviewCache.botSetup = {
              ...(window._lastAdminOverviewCache.botSetup || {}),
              speedProfile: state.adminWorkerSpeedProfile,
              speedProfileConfig: r.speedProfileConfig || null
            };
          }
          const labelMap = {
            free_turbo: "🛡️ Free-Tier Turbo (10ms CPU Schutz • 12er-Batch • 3.2s Guard • Smart-Notfall-Fallback)",
            balanced: "⚖️ Ausgewogen (18er-Batch • 4.5s Guard)",
            paid_pro: "🚀 Paid Worker Pro (30er-Batch • 6.5s Guard • Volle 8-API Kaskade)"
          };
          showHudToast("⚡ Worker-Profil aktiv: " + (labelMap[state.adminWorkerSpeedProfile] || state.adminWorkerSpeedProfile));
          renderBackupImportBoxDom();
          if (state.currentView === "admin") {
            loadAdminPanelView(false);
          }
        } finally {
          setBusyState(false);
        }
      }

      async function adminRunBotMiniAppSetupClient() {
        const urlInp = document.getElementById("adminBotMiniAppUrlInp");
        const btnTextInp = document.getElementById("adminBotMenuBtnTextInp");
        const webAppUrl = (urlInp && urlInp.value ? urlInp.value.trim() : window.location.origin).replace(/\\/+$/, "");
        const buttonText = (btnTextInp && btnTextInp.value ? btnTextInp.value.trim() : "🍿 Mediathek") || "🍿 Mediathek";
        setBusyState(true, "🚀 Aktiviere Telegram Chat-Menü-Button (setChatMenuButton) & Bot-Befehle (setMyCommands)...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/bot-setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "setup_miniapp_menu",
              webAppUrl,
              buttonText
            })
          });
          const statusEl = document.getElementById("adminBotSetupStatusMsg");
          if (r && r.ok) {
            if (window._lastAdminOverviewCache) {
              window._lastAdminOverviewCache.botSetup = {
                ...(window._lastAdminOverviewCache.botSetup || {}),
                webAppUrl: r.webAppUrl || webAppUrl
              };
            }
            if (statusEl) {
              statusEl.style.display = "block";
              statusEl.style.color = "#34d399";
              statusEl.innerHTML = "✅ <b>Erfolgreich aktiviert!</b> Der permanente Button <b>„" + esc(r.buttonText || buttonText) + "“</b> unten links im Telegram-Chat (<code>setChatMenuButton</code>) sowie alle Schnellbefehle (<code>setMyCommands</code>) und der Inline-Suche-Button sind jetzt live geschaltet.";
            }
            showHudToast("🚀 Mini-App Menü-Button („" + (r.buttonText || buttonText) + "“) & Befehle live aktiviert!");
          } else {
            if (statusEl) {
              statusEl.style.display = "block";
              statusEl.style.color = "#f87171";
              statusEl.textContent = "⚠️ Fehler bei der Telegram-Aktivierung. Prüfe, ob TELEGRAM_BOT_TOKEN in Cloudflare gesetzt ist.";
            }
            showHudToast("⚠️ Telegram API Rückmeldung prüfen.");
          }
        } finally {
          setBusyState(false);
        }
      }

      async function downloadNeonBotAssetPngClient(kind) {
        const isSplash = kind === "splash_640x360";
        const width = isSplash ? 640 : 512;
        const height = isSplash ? 360 : 512;
        const fileName = isSplash
          ? "telegram-miniapp-splashscreen-640x360.png"
          : "telegram-bot-profilbild-512x512.png";
        const srcUrl = isSplash
          ? "/assets/telegram_miniapp_splash_neon.jpg"
          : "/assets/telegram_bot_avatar_neon.jpg";

        showHudToast("🎨 Rendere hochauflösendes PNG (" + width + "×" + height + " px)...");

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          showHudToast("⚠️ Canvas wird von diesem Browser nicht unterstützt.");
          return;
        }

        // 1. Deep Neon-Cinema Background Fallback
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, "#070B19");
        bgGrad.addColorStop(0.5, "#0B1021");
        bgGrad.addColorStop(1, "#12092B");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // 2. Load generated artwork & draw cover-fit
        const loadedImg = await new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            try {
              const scale = Math.max(width / img.width, height / img.height);
              const drawW = img.width * scale;
              const drawH = img.height * scale;
              const dx = (width - drawW) / 2;
              const dy = (height - drawH) / 2;
              ctx.drawImage(img, dx, dy, drawW, drawH);
              resolve(true);
            } catch (e) {
              resolve(false);
            }
          };
          img.onerror = () => resolve(false);
          img.src = srcUrl;
        });

        if (!loadedImg) {
          // Procedural Neon-Cinema Emblem Fallback (for standalone Worker without static assets)
          const cx = width / 2;
          const cy = isSplash ? height * 0.44 : height * 0.5;
          const rOuter = isSplash ? 76 : 145;
          const glow = ctx.createRadialGradient(cx, cy, rOuter * 0.15, cx, cy, rOuter * 1.45);
          glow.addColorStop(0, "rgba(0, 240, 255, 0.38)");
          glow.addColorStop(0.55, "rgba(139, 92, 246, 0.24)");
          glow.addColorStop(1, "rgba(7, 11, 25, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(cx, cy, rOuter * 1.45, 0, Math.PI * 2);
          ctx.fill();

          ctx.save();
          ctx.strokeStyle = "#00F0FF";
          ctx.lineWidth = isSplash ? 5 : 9;
          ctx.beginPath();
          ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = "#8B5CF6";
          ctx.lineWidth = isSplash ? 3 : 6;
          ctx.beginPath();
          ctx.arc(cx, cy, rOuter * 0.76, 0, Math.PI * 2);
          ctx.stroke();

          const playGrad = ctx.createLinearGradient(cx - rOuter * 0.35, cy - rOuter * 0.4, cx + rOuter * 0.45, cy + rOuter * 0.4);
          playGrad.addColorStop(0, "#00F0FF");
          playGrad.addColorStop(1, "#8B5CF6");
          ctx.fillStyle = playGrad;
          ctx.beginPath();
          ctx.moveTo(cx - rOuter * 0.22, cy - rOuter * 0.36);
          ctx.lineTo(cx + rOuter * 0.38, cy);
          ctx.lineTo(cx - rOuter * 0.22, cy + rOuter * 0.36);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        // 3. Subtle Neon-Cinema Glass Vignette & Crisp Branding Frame
        const radGrad = ctx.createRadialGradient(
          width * 0.5,
          height * 0.5,
          width * 0.18,
          width * 0.5,
          height * 0.5,
          width * 0.72
        );
        radGrad.addColorStop(0, "rgba(7, 11, 25, 0.0)");
        radGrad.addColorStop(1, "rgba(7, 11, 25, 0.52)");
        ctx.fillStyle = radGrad;
        ctx.fillRect(0, 0, width, height);

        // Neon border glow
        ctx.save();
        ctx.strokeStyle = "rgba(0, 240, 255, 0.55)";
        ctx.lineWidth = isSplash ? 3 : 4;
        ctx.strokeRect(isSplash ? 6 : 8, isSplash ? 6 : 8, width - (isSplash ? 12 : 16), height - (isSplash ? 12 : 16));
        ctx.restore();

        if (isSplash) {
          // Bottom glass bar with crisp badge for 640x360 BotFather Mini-App Splash/Header
          const pillW = 290;
          const pillH = 38;
          const pillX = (width - pillW) / 2;
          const pillY = height - 54;
          ctx.save();
          ctx.fillStyle = "rgba(7, 11, 25, 0.82)";
          ctx.beginPath();
          if (typeof ctx.roundRect === "function") {
            ctx.roundRect(pillX, pillY, pillW, pillH, 19);
          } else {
            ctx.rect(pillX, pillY, pillW, pillH);
          }
          ctx.fill();
          ctx.strokeStyle = "rgba(0, 240, 255, 0.65)";
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.font = "900 14px system-ui, -apple-system, sans-serif";
          ctx.fillStyle = "#F8FAFC";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("🎬 STREAMING MINI-APP • 4K UHD", width / 2, pillY + pillH / 2 + 1);
          ctx.restore();
        }

        canvas.toBlob((blob) => {
          if (!blob) {
            showHudToast("⚠️ PNG-Export fehlgeschlagen.");
            return;
          }
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            try {
              document.body.removeChild(a);
              URL.revokeObjectURL(blobUrl);
            } catch (e) {}
          }, 500);
          showHudToast("✅ " + fileName + " (" + width + "×" + height + " PNG) heruntergeladen!");
        }, "image/png");
      }

      // 1-Klick BotFather 512x512 Single-<path> SVG Download (exakt nach Telegram-Spezifikation: 512x512 + 1 einziges <path>-Element)
      function downloadBotFatherSinglePathSvgClient() {
        const singlePathSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><path fill="#00E5FF" fill-rule="evenodd" d="M256 28 C381.9 28 484 130.1 484 256 C484 381.9 381.9 484 256 484 C130.1 484 28 381.9 28 256 C28 130.1 130.1 28 256 28 Z M256 58 C146.6 58 58 146.6 58 256 C58 365.4 146.6 454 256 454 C365.4 454 454 365.4 454 256 C454 146.6 365.4 58 256 58 Z M256 96 C344.4 96 416 167.6 416 256 C416 344.4 344.4 416 256 416 C167.6 416 96 344.4 96 256 C96 167.6 167.6 96 256 96 Z M256 118 C179.8 118 118 179.8 118 256 C118 332.2 179.8 394 256 394 C332.2 394 394 332.2 394 256 C394 179.8 332.2 118 256 118 Z M136 168 L168 168 L168 200 L136 200 Z M136 240 L168 240 L168 272 L136 272 Z M136 312 L168 312 L168 344 L136 344 Z M344 168 L376 168 L376 200 L344 200 Z M344 240 L376 240 L376 272 L344 272 Z M344 312 L376 312 L376 344 L344 344 Z M210 184 L334 256 L210 328 Z"/></svg>';
        const blob = new Blob([singlePathSvg], { type: "image/svg+xml;charset=utf-8" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = "bot-splashscreen-512x512.svg";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try {
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
          } catch (e) {}
        }, 500);
        showHudToast("✅ bot-splashscreen-512x512.svg (512×512 • 1 <path>-Element) heruntergeladen!");
      }

      // 1-Klick BotFather 512x512 WEBP Download (Alternative für @BotFather Splashscreen / Icon)
      function downloadNeonBotAssetWebpClient() {
        const width = 512;
        const height = 512;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, "#060A14");
        bgGrad.addColorStop(0.5, "#0B1328");
        bgGrad.addColorStop(1, "#111C38");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        const cx = 256;
        const cy = 256;
        const glow = ctx.createRadialGradient(cx, cy, 24, cx, cy, 220);
        glow.addColorStop(0, "rgba(0, 229, 255, 0.42)");
        glow.addColorStop(0.55, "rgba(99, 102, 241, 0.25)");
        glow.addColorStop(1, "rgba(6, 10, 20, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, 220, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#00E5FF";
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(cx, cy, 176, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = "#6366F1";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(cx, cy, 132, 0, Math.PI * 2);
        ctx.stroke();

        const playGrad = ctx.createLinearGradient(195, 175, 335, 335);
        playGrad.addColorStop(0, "#00E5FF");
        playGrad.addColorStop(1, "#38BDF8");
        ctx.fillStyle = playGrad;
        ctx.beginPath();
        ctx.moveTo(212, 182);
        ctx.lineTo(334, 256);
        ctx.lineTo(212, 330);
        ctx.closePath();
        ctx.fill();

        canvas.toBlob((blob) => {
          if (!blob) {
            showHudToast("⚠️ WEBP-Export nicht unterstützt.");
            return;
          }
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = "bot-splashscreen-512x512.webp";
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            try {
              document.body.removeChild(a);
              URL.revokeObjectURL(blobUrl);
            } catch (e) {}
          }, 500);
          showHudToast("✅ bot-splashscreen-512x512.webp (512×512 WEBP) heruntergeladen!");
        }, "image/webp", 0.94);
      }

      // Echtzeit Worker-Health-Monitor Widget (CPU-Laufzeit ms / 10ms Limit, Subrequests, Auto-Throttle & Sparkline)
      function renderWorkerHealthMonitorWidgetHtml(compact = false) {
        const st = window._workerHealthMonitorState || {
          history: [],
          lastCpuMs: 0.9,
          lastWallMs: 38,
          lastSubrequests: 1,
          lastD1Ops: 1,
          lastRoute: "/discover",
          status: "healthy",
          throttled: false,
          recommendedBatchSize: 5
        };
        const cpuMs = Number(st.lastCpuMs || 0.9);
        const cpuPct = Math.min(100, Math.max(4, Math.round((cpuMs / 10) * 100)));
        const isCrit = cpuMs >= 8.2 || st.status === "critical";
        const isWarn = !isCrit && (cpuMs >= 6.8 || st.status === "warning" || st.throttled);
        const barColor = isCrit
          ? "linear-gradient(90deg,#f59e0b,#e11d48)"
          : isWarn
            ? "linear-gradient(90deg,#0284c7,#f59e0b)"
            : "linear-gradient(90deg,#0284c7,#4f46e5,#10b981)";
        const badgeBg = isCrit
          ? "rgba(225,29,72,0.2);color:#fda4af;border:1px solid rgba(244,63,94,0.5)"
          : isWarn
            ? "rgba(245,158,11,0.2);color:#fde68a;border:1px solid rgba(245,158,11,0.5)"
            : "rgba(16,185,129,0.18);color:#34d399;border:1px solid rgba(16,185,129,0.4)";
        const badgeText = isCrit
          ? "🚨 CPU NAHE 10ms – AUTO-COOLDOWN (1/Batch)"
          : isWarn
            ? "🛡️ GEDROSSELT (" + (st.recommendedBatchSize || 2) + "/Batch)"
            : "🟢 OPTIMAL (<10ms Free-Limit)";
        const hist = Array.isArray(st.history) && st.history.length > 0
          ? st.history.slice(-14)
          : [{ cpuMs: 0.9, status: "healthy" }, { cpuMs: 1.2, status: "healthy" }, { cpuMs: cpuMs, status: st.status }];
        const sparkBars = hist.map(h => {
          const hPct = Math.min(100, Math.max(12, Math.round((Number(h.cpuMs || 1) / 10) * 100)));
          const c = h.cpuMs >= 8.2 ? "#e11d48" : h.cpuMs >= 6.8 ? "#f59e0b" : "#0ea5e9";
          return '<div title="CPU ' + Number(h.cpuMs || 0).toFixed(2) + 'ms (' + esc(h.route || '') + ')" style="flex:1;height:' + hPct + '%;background:' + c + ';border-radius:2px;min-width:5px"></div>';
        }).join("");

        return '<div class="worker-health-monitor-mount" style="background:var(--card);border:1px solid ' + (isCrit ? 'rgba(225,29,72,0.55)' : isWarn ? 'rgba(245,158,11,0.5)' : 'rgba(14,165,233,0.3)') + ';border-radius:10px;padding:' + (compact ? '10px' : '12px') + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px">' +
            '<div style="font-size:12px;font-weight:900;color:var(--text);display:flex;align-items:center;gap:6px">' +
              '<span>🩺 Echtzeit Worker-Health-Monitor</span>' +
              '<span style="font-size:10px;padding:2px 7px;border-radius:999px;' + badgeBg + '">' + badgeText + '</span>' +
            '</div>' +
            '<span style="font-size:11px;font-family:monospace;color:var(--blue);font-weight:800">' + cpuMs.toFixed(2) + ' ms / 10.0 ms CPU</span>' +
          '</div>' +
          '<div style="width:100%;height:10px;background:#050913;border-radius:999px;overflow:hidden;border:1px solid rgba(148,163,184,0.2);margin-bottom:8px;position:relative">' +
            '<div style="width:' + cpuPct + '%;height:100%;background:' + barColor + ';transition:width 0.25s ease"></div>' +
            '<div title="7ms Auto-Throttle Schwelle" style="position:absolute;left:70%;top:0;bottom:0;width:2px;background:rgba(245,158,11,0.85)"></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;font-size:10.5px;margin-bottom:8px">' +
            '<div style="background:rgba(14,165,233,0.06);padding:5px 7px;border-radius:6px;border:1px solid rgba(148,163,184,0.14)">⚡ CPU: <b style="color:var(--blue)">' + cpuMs.toFixed(2) + 'ms</b></div>' +
            '<div style="background:rgba(14,165,233,0.06);padding:5px 7px;border-radius:6px;border:1px solid rgba(148,163,184,0.14)">⏱️ Netz: <b style="color:var(--text)">' + Number(st.lastWallMs || 40) + 'ms</b></div>' +
            '<div style="background:rgba(14,165,233,0.06);padding:5px 7px;border-radius:6px;border:1px solid rgba(148,163,184,0.14)">🔌 Subreq: <b style="color:#0ea5e9">' + Number(st.lastSubrequests || 1) + '/50</b></div>' +
            '<div style="background:rgba(14,165,233,0.06);padding:5px 7px;border-radius:6px;border:1px solid rgba(148,163,184,0.14)">📦 Batch: <b style="color:#10b981">' + Number(st.recommendedBatchSize || 5) + '/Req</b></div>' +
          '</div>' +
          '<div style="display:flex;align-items:flex-end;gap:3px;height:24px;background:#050913;padding:4px 6px;border-radius:6px;border:1px solid rgba(148,163,184,0.15)">' +
            sparkBars +
          '</div>' +
          (st.throttleReason ? '<div style="font-size:10.5px;color:#f59e0b;margin-top:6px">🛡️ ' + esc(st.throttleReason) + '</div>' : '<div style="font-size:10px;color:var(--muted);margin-top:5px">Ab 7.0ms CPU halbiert der Monitor die Batch-Größe vollautomatisch auf 1–2 und legt einen kurzen Cooldown ein.</div>') +
        '</div>';
      }

      window.updateWorkerHealthMonitorDom = function() {
        const mounts = document.querySelectorAll(".worker-health-monitor-mount");
        if (!mounts || mounts.length === 0) return;
        const freshHtml = renderWorkerHealthMonitorWidgetHtml(true);
        mounts.forEach(el => {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = freshHtml;
          if (wrapper.firstElementChild) {
            el.replaceWith(wrapper.firstElementChild);
          }
        });
      };

      // Generiert ein kryptografisch starkes Webhook-Passwort (secret_token kompatibel: A-Z, a-z, 0-9, _, -)
      function generateRandomWebhookPasswordClient() {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
        const arr = new Uint8Array(36);
        if (window.crypto && window.crypto.getRandomValues) {
          window.crypto.getRandomValues(arr);
        } else {
          for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        }
        let token = "tp_wh_";
        for (let i = 0; i < arr.length; i++) {
          token += chars[arr[i] % chars.length];
        }
        const inp = document.getElementById("adminWebhookPasswordInp");
        if (inp) {
          inp.type = "text";
          inp.value = token;
        }
        refreshManualWebhookLinksUiClient();
        showHudToast("🔑 Sicheres Webhook-Passwort generiert – jetzt auf 'Speichern & bei Telegram registrieren' klicken!");
      }

      function computeManualWebhookLinksClient() {
        const urlInp = document.getElementById("adminWebhookUrlInp");
        const pwInp = document.getElementById("adminWebhookPasswordInp");
        const maxConnSel = document.getElementById("adminWebhookMaxConnSel");
        const dropChk = document.getElementById("adminWebhookDropPendingChk");
        const cachedSetup = window._lastAdminOverviewCache?.botSetup || {};
        const fallbackOrigin = String(location.origin || "").replace(/\\/$/, "");
        const webhookUrl = (urlInp && urlInp.value.trim()) ? urlInp.value.trim() : String(cachedSetup.webhookUrl || (fallbackOrigin + "/webhook"));
        let originBase = fallbackOrigin;
        try {
          originBase = new URL(webhookUrl).origin.replace(/\\/$/, "");
        } catch (e) {}
        const typedSecret = pwInp ? String(pwInp.value || "").trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128) : "";
        const effectiveSecret = typedSecret || String(cachedSetup.activeWebhookSecret || "").trim();
        const maxConnections = maxConnSel ? Math.min(40, Math.max(1, Number(maxConnSel.value) || 8)) : (Number(cachedSetup.webhookMaxConnections) || 8);
        const dropPending = dropChk ? Boolean(dropChk.checked) : true;

        const workerParams = new URLSearchParams();
        if (effectiveSecret) workerParams.set("secret", effectiveSecret);
        if (dropPending) workerParams.set("drop_pending_updates", "1");
        workerParams.set("max_connections", String(maxConnections));
        const workerSetWebhookUrl = originBase + "/setwebhook?" + workerParams.toString();

        const tgParams = new URLSearchParams();
        tgParams.set("url", webhookUrl);
        tgParams.set("max_connections", String(maxConnections));
        tgParams.set("drop_pending_updates", dropPending ? "true" : "false");
        if (effectiveSecret) tgParams.set("secret_token", effectiveSecret);
        const telegramDirectApiUrl = "https://api.telegram.org/bot<DEIN_BOT_TOKEN>/setWebhook?" + tgParams.toString();

        return {
          webhookUrl,
          workerSetWebhookUrl,
          telegramDirectApiUrl,
          hasSecret: Boolean(effectiveSecret)
        };
      }

      function refreshManualWebhookLinksUiClient() {
        const links = computeManualWebhookLinksClient();
        const workerInp = document.getElementById("adminManualWorkerWebhookLinkInp");
        const tgApiInp = document.getElementById("adminManualTelegramApiLinkInp");
        const openWorkerLink = document.getElementById("adminManualWorkerOpenAnchor");
        const secretHint = document.getElementById("adminManualWorkerSecretHint");
        if (workerInp) workerInp.value = links.workerSetWebhookUrl;
        if (tgApiInp) tgApiInp.value = links.telegramDirectApiUrl;
        if (openWorkerLink) openWorkerLink.href = safeHttpUrl(links.workerSetWebhookUrl);
        if (secretHint) {
          secretHint.style.display = links.hasSecret ? "none" : "block";
        }
      }

      function copyAdminInputValueClient(inputId, label) {
        const el = document.getElementById(inputId);
        const val = el ? String(el.value || "").trim() : "";
        if (!val) {
          showHudToast("⚠️ Kein Link zum Kopieren vorhanden.");
          return;
        }
        copyAdminTextToClipboardClient(val, label || "Link");
      }

      async function adminSaveAndRegisterWebhookClient(clearPassword = false) {
        const pwInp = document.getElementById("adminWebhookPasswordInp");
        const maxConnSel = document.getElementById("adminWebhookMaxConnSel");
        const dropChk = document.getElementById("adminWebhookDropPendingChk");
        const urlInp = document.getElementById("adminWebhookUrlInp");
        const statusBox = document.getElementById("adminWebhookStatusBox");
        const webhookPassword = clearPassword ? "" : (pwInp ? String(pwInp.value || "").trim() : "");
        const maxConnections = maxConnSel ? Number(maxConnSel.value || 8) : 8;
        const dropPendingUpdates = Boolean(dropChk && dropChk.checked);
        const webhookUrl = urlInp ? String(urlInp.value || "").trim() : "";

        if (statusBox) {
          statusBox.style.display = "block";
          statusBox.style.color = "#38bdf8";
          statusBox.innerHTML = clearPassword
            ? "⏳ Entferne Webhook-Passwort & aktualisiere Webhook bei Telegram (<code>setWebhook</code>)..."
            : "⏳ Speichere Webhook-Konfiguration & registriere Webhook bei Telegram (<code>setWebhook</code>)...";
        }
        try {
          const r = await apiFetchJson(API_BASE + "/admin/bot-setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "save_webhook_and_register",
              webhookPassword,
              clearPassword: Boolean(clearPassword),
              maxConnections,
              dropPendingUpdates,
              webhookUrl
            })
          });
          if (r && r.ok) {
            if (window._lastAdminOverviewCache && window._lastAdminOverviewCache.botSetup) {
              window._lastAdminOverviewCache.botSetup.webhookUrl = r.webhookUrl || webhookUrl;
              window._lastAdminOverviewCache.botSetup.hasWebhookPassword = Boolean(r.hasWebhookPassword);
              window._lastAdminOverviewCache.botSetup.webhookPasswordPreview = r.webhookPasswordPreview || "";
              window._lastAdminOverviewCache.botSetup.activeWebhookSecret = String(r.activeWebhookSecret || "");
              window._lastAdminOverviewCache.botSetup.webhookMaxConnections = r.maxConnections || maxConnections;
              window._lastAdminOverviewCache.botSetup.manualSetWebhookWorkerUrl = r.manualSetWebhookWorkerUrl || "";
              window._lastAdminOverviewCache.botSetup.manualTelegramApiTemplateUrl = r.manualTelegramApiTemplateUrl || "";
            }
            if (clearPassword && pwInp) pwInp.value = "";
            refreshManualWebhookLinksUiClient();
            showHudToast(r.simulated ? "💾 Webhook-Konfiguration im Simulator gespeichert!" : "🔒 Webhook erfolgreich bei Telegram registriert & verifiziert!");
            if (statusBox) {
              const info = r.webhookInfo || null;
              const liveLine = info
                ? ('<br/>📡 <b>Telegram-Bestätigung (<code>getWebhookInfo</code>):</b> URL <code>' + esc(info.url || "-") + '</code> • Wartende Updates: <b>' + Number(info.pending_update_count || 0) + '</b> • max_connections: <code>' + Number(info.max_connections || maxConnections) + '</code>' + (info.last_error_message ? (' • ⚠️ Letzter Fehler: <code>' + esc(info.last_error_message) + '</code>') : ' • ✅ Keine Fehler'))
                : '';
              statusBox.style.color = r.simulated ? "#fbbf24" : "#34d399";
              statusBox.innerHTML = (r.simulated ? "⚠️ <b>" : "✅ <b>") + esc(r.message || "Webhook registriert!") + "</b>" +
                (r.webhookPasswordPreview ? (" • Aktives Passwort: <code>" + esc(r.webhookPasswordPreview) + "</code>") : " • Passwort: <code>deaktiviert</code>") +
                liveLine;
            }
          } else {
            const errTxt = (r && (r.message || r.error)) || "Registrierung fehlgeschlagen";
            showHudToast("⚠️ " + errTxt);
            if (statusBox) {
              statusBox.style.color = "#f87171";
              statusBox.innerHTML = "❌ <b>Fehler:</b> " + esc(errTxt);
            }
          }
        } catch (e) {
          if (statusBox) {
            statusBox.style.color = "#f87171";
            statusBox.innerHTML = "❌ <b>Netzwerkfehler:</b> " + esc(e.message || String(e));
          }
        }
      }

      async function adminCheckWebhookLiveStatusClient() {
        const statusBox = document.getElementById("adminWebhookStatusBox");
        if (statusBox) {
          statusBox.style.display = "block";
          statusBox.style.color = "#38bdf8";
          statusBox.innerHTML = "🔍 Frage Live-Status von Telegram ab (<code>getWebhookInfo</code>)...";
        }
        try {
          const r = await apiFetchJson(API_BASE + "/admin/bot-setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "get_webhook_info" })
          });
          if (!r || !r.ok) {
            const errTxt = r?.error || r?.message || "Webhook-Status konnte nicht abgefragt werden.";
            showHudToast("⚠️ " + errTxt);
            if (statusBox) {
              statusBox.style.color = "#f87171";
              statusBox.innerHTML = "❌ <b>" + esc(errTxt) + "</b>";
            }
            return;
          }
          const info = r?.webhookInfo || {};
          const pending = Number(info.pending_update_count || 0);
          const lastErr = info.last_error_message ? String(info.last_error_message) : "Keine Fehler";
          const maxConn = Number(info.max_connections || 8);
          if (statusBox) {
            statusBox.style.color = pending > 0 ? "#fbbf24" : "#34d399";
            statusBox.innerHTML =
              '📡 <b>Telegram Live-Webhook-Status:</b><br/>' +
              '• <b>Registrierte URL:</b> <code>' + esc(info.url || "Nicht gesetzt") + '</code><br/>' +
              '• <b>Wartende Updates (Retry-Stau):</b> <b style="color:' + (pending > 0 ? '#f87171' : '#34d399') + '">' + pending + '</b> • <b>max_connections:</b> <code>' + maxConn + '</code><br/>' +
              '• <b>Passwort-Gatekeeper:</b> ' + (r?.hasWebhookPassword ? '🔒 Aktiv (<code>X-Telegram-Bot-Api-Secret-Token</code>)' : '⚠️ Kein Passwort gesetzt') + '<br/>' +
              '• <b>Letzter Telegram-Fehler:</b> <code>' + esc(lastErr) + '</code>';
          }
        } catch (e) {
          if (statusBox) {
            statusBox.style.color = "#f87171";
            statusBox.innerHTML = "❌ Fehler bei getWebhookInfo: " + esc(e.message || String(e));
          }
        }
      }

      async function adminDropPendingWebhookUpdatesClient() {
        const statusBox = document.getElementById("adminWebhookStatusBox");
        if (statusBox) {
          statusBox.style.display = "block";
          statusBox.style.color = "#fbbf24";
          statusBox.innerHTML = "🧹 Verwerfe angestaute Telegram-Updates (<code>drop_pending_updates=true</code>)...";
        }
        try {
          const r = await apiFetchJson(API_BASE + "/admin/bot-setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "drop_pending_updates" })
          });
          if (!r || !r.ok) {
            const errTxt = r?.error || r?.message || "Hängende Updates konnten nicht verworfen werden.";
            showHudToast("⚠️ " + errTxt);
            if (statusBox) {
              statusBox.style.color = "#f87171";
              statusBox.innerHTML = "❌ <b>" + esc(errTxt) + "</b>";
            }
            return;
          }
          showHudToast("🧹 " + (r?.message || "Hängende Updates verworfen!"));
          if (statusBox) {
            statusBox.style.color = "#34d399";
            statusBox.innerHTML = "✅ <b>" + esc(r?.message || "Alle hängenden Updates verworfen!") + "</b>";
          }
        } catch (e) {
          if (statusBox) {
            statusBox.style.color = "#f87171";
            statusBox.innerHTML = "❌ Fehler: " + esc(e.message || String(e));
          }
        }
      }

      function applyAdminTelegramPaletteLiveClient(paletteKey) {
        state.themeMode = paletteKey || "dark";
        applyThemeAndAccessibilityToDom();
        try {
          if (chatId && chatId !== "guest") {
            apiFetchJson(API_BASE + "/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId, themeMode: state.themeMode })
            }).catch(() => {});
          }
        } catch (e) {}
        const pal = (typeof TELEGRAM_THEME_PALETTES_CLIENT !== "undefined" && TELEGRAM_THEME_PALETTES_CLIENT[state.themeMode])
          ? TELEGRAM_THEME_PALETTES_CLIENT[state.themeMode]
          : { headerColor: "#060A14", bgColor: "#060A14", bottomBarColor: "#0B1222" };
        showHudToast("🎨 Mini-App Farben live gesetzt (Header " + pal.headerColor + " • Body " + pal.bgColor + ")");
        if (state.currentView === "admin") {
          loadAdminPanelView(false);
        }
      }

      let _adminPanelLoadSeq = 0;
      async function loadAdminPanelView(forceNetworkRefresh = false) {
        if (!state.isAuthenticated || !state.authUser?.isAdmin) {
          showHudToast("⛔ Zugriff verweigert: Nur für autorisierte Administratoren.");
          return;
        }
        const myLoadSeq = ++_adminPanelLoadSeq;
        const wasAlreadyInAdmin = state.currentView === "admin";
        state.currentView = "admin";
        updateFloatingImportStatusBarDom();
        if (!state.adminPlaylistTargetChatId) state.adminPlaylistTargetChatId = String(chatId);

        const hasActiveOrPausedImport = Boolean(
          Array.isArray(backupImportJob?.entries) &&
          backupImportJob.entries.length > 0 &&
          (backupImportJob.running || (backupImportJob.cursor > 0 && backupImportJob.cursor < backupImportJob.entries.length))
        );
        if (!wasAlreadyInAdmin && hasActiveOrPausedImport && state.adminTab !== "diaglog") {
          state.adminTab = "backup";
        }
        if (!state.adminTab) {
          state.adminTab = hasActiveOrPausedImport ? "backup" : "users";
        }

        // Sofort-Zugang ohne Netzwerk-Blockade: Wenn der Import läuft oder Backup/Logs geöffnet werden und ein Cache vorliegt,
        // niemals durch /admin/overview blockieren oder ein HTTP 503 riskieren!
        const canUseInstantCache = Boolean(
          !forceNetworkRefresh &&
          (backupImportJob.running || ((state.adminTab === "backup" || state.adminTab === "diaglog") && window._lastAdminOverviewCache))
        );

        let r = null;
        try {
          if (canUseInstantCache) {
            r = window._lastAdminOverviewCache || {
              ok: true,
              users: [],
              media: [],
              playlists: [],
              reports: window._adminReportsCache || [],
              _instantLocalMode: true
            };
          } else {
            window._adminPriorityRequestInFlight = true;
            setBusyState(true, "👑 Lade Admin-Dashboard, User, VIP-Playlisten & Mediendatenbank...");
            try {
              r = await apiFetchJson(
                API_BASE + "/admin/overview?mediaType=" + encodeURIComponent(state.adminMediaType || "m") +
                "&playlistChatId=" + encodeURIComponent(state.adminPlaylistTargetChatId || chatId) +
                "&folderId=" + encodeURIComponent(state.adminEditingFolderId || "") +
                "&tab=" + encodeURIComponent(state.adminTab || "users") +
                (forceNetworkRefresh ? "&refresh=1" : "")
              );
              if (r && r.ok) {
                const prevGaps = window._lastAdminOverviewCache?.seriesGaps;
                if (!forceNetworkRefresh && r.seriesGaps?.lazyDeferred && prevGaps && !prevGaps.lazyDeferred) {
                  r.seriesGaps = prevGaps;
                }
                window._lastAdminOverviewCache = r;
              }
            } catch (netErr) {
              r = null;
            } finally {
              window._adminPriorityRequestInFlight = false;
            }
          }
          // Veraltete Antworten nach schnellem Tab-Wechsel oder Verlassen des Admin-Bereichs verwerfen
          if (myLoadSeq !== _adminPanelLoadSeq || state.currentView !== "admin") {
            return;
          }

          if (!r || !r.ok) {
            // Niemals das Öffnen des Admin-Panels abbrechen! Stattdessen sofort mit Cache/Fallback-Daten öffnen,
            // damit Backup-Import (Pause/Stopp) und Diagnose-Logs zu 100% erreichbar bleiben!
            r = window._lastAdminOverviewCache || {
              ok: true,
              users: [],
              media: [],
              playlists: [],
              reports: window._adminReportsCache || [],
              _fallbackOn503: true
            };
            if (!wasAlreadyInAdmin && state.adminTab !== "diaglog") {
              state.adminTab = "backup";
            }
            showHudToast("⚡ Admin-Panel im Direkt-Modus geöffnet (Import-Steuerung & Logs sofort bereit)");
          }

          const users = r.users || [];
          const mediaList = r.media || [];
          const qStats = r.queueStats || { pendingCount: 0, processedCount: 0, moviesSaved: 0, seriesSaved: 0, failedCount: 0 };
          const adminPlaylists = r.playlists || [];
          if (!window._adminBackupPlaylistsByChatId) window._adminBackupPlaylistsByChatId = {};
          window._adminBackupPlaylistsByChatId[String(state.adminPlaylistTargetChatId || chatId)] = adminPlaylists;
          const rawSeriesGaps = r.seriesGaps || {};
          const seriesGaps = {
            totalSeriesChecked: Number(rawSeriesGaps.totalSeriesChecked ?? (Array.isArray(rawSeriesGaps.items || rawSeriesGaps.series) ? (rawSeriesGaps.items || rawSeriesGaps.series).length : 0)),
            seriesWithGapsCount: Number(rawSeriesGaps.seriesWithGapsCount ?? rawSeriesGaps.totalSeriesWithGaps ?? 0),
            seriesWithInternalGapsCount: Number(rawSeriesGaps.seriesWithInternalGapsCount ?? rawSeriesGaps.totalSeriesWithInternalGaps ?? 0),
            totalMissingInternal: Number(rawSeriesGaps.totalMissingInternal ?? rawSeriesGaps.totalInternalMissingEpisodes ?? 0),
            totalMissingTrailing: Number(rawSeriesGaps.totalMissingTrailing ?? rawSeriesGaps.totalTrailingMissingEpisodes ?? 0),
            totalPrereleaseOnly: Number(rawSeriesGaps.totalPrereleaseOnly ?? rawSeriesGaps.totalPrereleaseEpisodes ?? 0),
            incompleteMultipartMoviesCount: Number(rawSeriesGaps.incompleteMultipartMoviesCount ?? (Array.isArray(rawSeriesGaps.incompleteMultipartMovies) ? rawSeriesGaps.incompleteMultipartMovies.length : 0)),
            incompleteMultipartMovies: Array.isArray(rawSeriesGaps.incompleteMultipartMovies) ? rawSeriesGaps.incompleteMultipartMovies : [],
            items: Array.isArray(rawSeriesGaps.items) ? rawSeriesGaps.items : (Array.isArray(rawSeriesGaps.series) ? rawSeriesGaps.series : [])
          };
          const allReports = Array.isArray(r.reports) ? r.reports : (window._adminReportsCache || []);
          window._adminReportsCache = allReports;
          if (!clientDiagnosticLogState.loadedFromD1Once && !backupImportJob.running) {
            clientDiagnosticLogState.loadedFromD1Once = true;
            restoreBackupImportSessionAfterReload();
          }
          const openReportsCount = Number(r.openReportsCount ?? allReports.filter(rep => rep && rep.status === "open").length);
          const reportFilter = state.adminReportFilter || "open";
          const filteredReports = reportFilter === "all"
            ? allReports
            : allReports.filter(rep => rep && rep.status === reportFilter);
          const activeFolderId = r.activeFolderId || (adminPlaylists[0]?.id || "");
          state.adminEditingFolderId = activeFolderId;
          const activeFolderObj = adminPlaylists.find(f => String(f.id) === String(activeFolderId)) || null;
          const activeFolderItems = Array.isArray(r.activePlaylistItems) ? r.activePlaylistItems : [];
          const root = document.getElementById("appRoot");

          const userSelectOptionsHtml = [
            '<option value="bot_vip" ' + (String(state.adminPlaylistTargetChatId) === "bot_vip" ? 'selected' : '') + '>🤖 Globale Bot-VIP-Playlist (bot_vip)</option>',
            '<option value="' + esc(chatId) + '" ' + (String(state.adminPlaylistTargetChatId) === String(chatId) ? 'selected' : '') + '>👑 Eigene Admin-Merkliste (ID ' + esc(chatId) + ')</option>',
            ...users.filter(u => String(u.telegramId) !== String(chatId)).map(u =>
              '<option value="' + esc(u.telegramId) + '" ' + (String(state.adminPlaylistTargetChatId) === String(u.telegramId) ? 'selected' : '') + '>👤 ID ' + esc(u.telegramId) + (u.tgUsername ? ' (@' + esc(u.tgUsername) + ')' : '') + (u.customUsername ? ' [' + esc(u.customUsername) + ']' : '') + '</option>'
            )
          ].join("");

          const playlistEditorBoxHtml = activeFolderObj ? (
            '<div class="panel-box" style="border-color:rgba(251,191,36,0.45);margin-top:12px">' +
              '<div class="section-title">' +
                '<span>👑 Vollwertiger Playlist-Editor: <b style="color:#fbbf24">' + esc(activeFolderObj.name) + '</b> (' + activeFolderItems.length + ' Titel)</span>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                  (String(state.adminPlaylistTargetChatId) === "bot_vip"
                    ? '<button class="btn amber" onclick="adminSyncBotVipFromD1Client(true)" title="Synchronisiert alle vom Telegram-Bot in D1 gespeicherten Filme & Serien in 25er-Batches">🔄 Alle D1-Bot-Filme & -Serien (25er-Batches) synchronisieren</button>'
                    : '') +
                  '<button class="btn ' + ((activeFolderObj.playlistMode || 'both') === 'vip_stream' ? 'amber' : '') + '" onclick="adminSetPlaylistMode(\\'' + escJs(state.adminPlaylistTargetChatId) + '\\',\\'' + escJs(activeFolderObj.id) + '\\',\\'vip_stream\\')">🌟 Als VIP-Stream-Playlist</button>' +
                  '<button class="btn ' + ((activeFolderObj.playlistMode || 'both') === 'watchlist' ? 'blue' : '') + '" onclick="adminSetPlaylistMode(\\'' + escJs(state.adminPlaylistTargetChatId) + '\\',\\'' + escJs(activeFolderObj.id) + '\\',\\'watchlist\\')">🔖 Als Merkliste</button>' +
                  '<button class="btn ' + ((activeFolderObj.playlistMode || 'both') === 'both' ? 'green' : '') + '" onclick="adminSetPlaylistMode(\\'' + escJs(state.adminPlaylistTargetChatId) + '\\',\\'' + escJs(activeFolderObj.id) + '\\',\\'both\\')">⚡ Beides (VIP + Merkliste)</button>' +
                '</div>' +
              '</div>' +
              '<div class="admin-sub-box" style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                '<select id="plEditorAddTypeSel" class="tma-select" style="padding:7px 9px;font-size:12px">' +
                  '<option value="auto">🔄 Auto (Film/Serie)</option>' +
                  '<option value="m">🎬 Film</option>' +
                  '<option value="s">📺 Serie</option>' +
                '</select>' +
                '<input id="plEditorAddQueryInp" class="tma-input" placeholder="Titel oder TMDb-ID zur Playlist hinzufügen (z.B. Inception oder 27205)..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();adminAddPlaylistItemClient(\\'' + escJs(state.adminPlaylistTargetChatId) + '\\',\\'' + escJs(activeFolderObj.id) + '\\')}" style="flex:1;min-width:210px;padding:7px 10px;font-size:12px" />' +
                '<input id="plEditorAddQualInp" class="tma-input" value="1080p" placeholder="Qualität (1080p/4K)" style="width:95px;padding:7px 9px;font-size:12px" />' +
                '<button class="btn green" onclick="adminAddPlaylistItemClient(\\'' + escJs(state.adminPlaylistTargetChatId) + '\\',\\'' + escJs(activeFolderObj.id) + '\\')">➕ Titel hinzufügen</button>' +
              '</div>' +
              (activeFolderItems.length === 0 ? (
                '<div class="admin-sub-box" style="font-size:12px;color:var(--muted);padding:12px;text-align:center">Diese Playlist enthält noch keine Titel. Klicke oben auf <b>🔄 Alle D1-Bot-Filme & -Serien synchronisieren</b>, füge einen Titel per Name/TMDb-ID hinzu oder importiere ein JSON-Backup.</div>'
              ) : (
                '<div style="display:flex;flex-direction:column;gap:6px;max-height:460px;overflow-y:auto;padding-right:4px">' +
                  activeFolderItems.map((it, idx) => {
                    const tc = it.contentType === "series" ? "s" : "m";
                    const streamCountNum = Number(it.streamCount || 0);
                    const qualDisplay = esc(it.allQualities || it.quality || "1080p");
                    const pImg = resolvePosterUrlClient(it.poster, "w185", "");
                    const epsList = Array.isArray(it.episodes) ? it.episodes : [];
                    const drawerId = "adm_pl_" + esc(it.uid || (it.tmdbId + "_" + idx));
                    const epPreviewCodes = epsList.slice(0, 3).map(e => e.code || ("S" + String(e.season || 1).padStart(2, "0") + "E" + String(e.episode || 1).padStart(2, "0"))).join(", ");
                    const epDrawerToggleHtml = (tc === "s" && epsList.length > 0)
                      ? ('<button type="button" class="btn" style="padding:3px 8px;font-size:11px;background:rgba(56,189,248,0.16);border-color:rgba(56,189,248,0.45);color:#38bdf8" onclick="toggleSeriesEpisodesDrawerClient(event,\\'' + drawerId + '\\')" title="Importierte Serienfolgen auf-/zuklappen">📺 ' + epsList.length + ' Folge' + (epsList.length === 1 ? '' : 'n') + ' (' + esc(epPreviewCodes) + (epsList.length > 3 ? '…' : '') + ') <span id="epDrawerIcon_' + drawerId + '">▾</span></button>')
                      : '';
                    const epDrawerBodyHtml = (tc === "s" && epsList.length > 0)
                      ? ('<div id="epDrawer_' + drawerId + '" style="display:none;flex-direction:column;gap:4px;margin-top:6px;padding:8px;border-radius:8px;background:rgba(15,23,42,0.88);border:1px solid rgba(56,189,248,0.35)">' +
                          epsList.map(ep => {
                            const epCode = ep.code || ("S" + String(ep.season || 1).padStart(2, "0") + "E" + String(ep.episode || 1).padStart(2, "0"));
                            const epTitle = ep.title || ("Folge " + (ep.episode || 1));
                            const qStr = [ep.quality || "1080p", ep.codec || ""].filter(Boolean).join(" • ");
                            return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.04);font-size:11.5px">' +
                              '<div style="cursor:pointer;flex:1" onclick="openDetails(\\'s\\',' + Number(it.tmdbId) + ',false,\\'\\',\\'\\',' + Number(ep.season || 1) + ')">' +
                                '<b style="color:#38bdf8">' + esc(epCode) + '</b> – <span style="color:#f8fafc">' + esc(epTitle) + '</span>' +
                                (qStr ? ' <span style="color:#94a3b8;font-size:10.5px">[' + esc(qStr) + ']</span>' : '') +
                              '</div>' +
                              '<button type="button" class="btn" style="padding:2px 7px;font-size:10.5px" onclick="openDetails(\\'s\\',' + Number(it.tmdbId) + ',false,\\'\\',\\'\\',' + Number(ep.season || 1) + ')">Staffel ' + Number(ep.season || 1) + ' öffnen</button>' +
                            '</div>';
                          }).join("") +
                        '</div>')
                      : '';
                    return '<div class="ep-row" style="flex-direction:column;align-items:stretch">' +
                      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
                        '<div style="display:flex;align-items:center;flex:1;min-width:180px">' +
                          '<span style="font-size:11.5px;font-weight:900;color:#64748b;width:28px;text-align:center;flex-shrink:0">#' + (idx + 1) + '</span>' +
                          (pImg
                            ? '<img src="' + esc(pImg) + '" style="width:32px;height:46px;object-fit:cover;border-radius:4px;margin-right:8px;flex-shrink:0" alt="" />'
                            : '<div style="width:32px;height:46px;background:#1e293b;border-radius:4px;margin-right:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + (tc === "s" ? "📺" : "🎬") + '</div>') +
                          '<div style="flex:1;min-width:140px;cursor:pointer" onclick="openDetails(\\'' + tc + '\\',' + Number(it.tmdbId) + ',false)">' +
                            '<div style="font-size:12.5px;font-weight:800;color:var(--text)">' +
                              (tc === "s" ? "📺 " : "🎬 ") + esc(it.title) + ' <span style="color:var(--muted);font-weight:600">(' + esc(it.year || "k.A.") + ')</span>' +
                              (it.syncedFromD1 ? ' <span style="font-size:10px;padding:1px 6px;border-radius:999px;background:rgba(16,185,129,0.18);color:#10b981;margin-left:4px">🤖 D1-Bot</span>' : '') +
                            '</div>' +
                            '<div style="font-size:11px;color:#0284c7">' +
                              'TMDb #' + Number(it.tmdbId) + ' • ' + qualDisplay +
                              (streamCountNum > 0 ? (' • <b style="color:#fbbf24">' + streamCountNum + (tc === "s" ? (' Folge' + (streamCountNum === 1 ? '' : 'n') + '/Streams') : (' Bot-Stream' + (streamCountNum === 1 ? '' : 's'))) + '</b>') : '') +
                              (it.genres ? (' • ' + esc(it.genres)) : '') +
                            '</div>' +
                          '</div>' +
                        '</div>' +
                        '<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">' +
                          epDrawerToggleHtml +
                          (idx > 0 ? '<button class="btn" style="padding:4px 7px;font-size:11px" title="Nach ganz oben" onclick="adminReorderPlaylistItem(\\'' + escJs(state.adminPlaylistTargetChatId) + '\\',\\'' + escJs(activeFolderObj.id) + '\\',\\'' + escJs(it.uid) + '\\',\\'top\\')">⏫</button>' : '') +
                          (idx > 0 ? '<button class="btn" style="padding:4px 7px;font-size:11px" title="Position nach oben" onclick="adminReorderPlaylistItem(\\'' + escJs(state.adminPlaylistTargetChatId) + '\\',\\'' + escJs(activeFolderObj.id) + '\\',\\'' + escJs(it.uid) + '\\',\\'up\\')">⬆️</button>' : '') +
                          (idx < activeFolderItems.length - 1 ? '<button class="btn" style="padding:4px 7px;font-size:11px" title="Position nach unten" onclick="adminReorderPlaylistItem(\\'' + escJs(state.adminPlaylistTargetChatId) + '\\',\\'' + escJs(activeFolderObj.id) + '\\',\\'' + escJs(it.uid) + '\\',\\'down\\')">⬇️</button>' : '') +
                          '<button class="btn" style="padding:4px 8px;font-size:11px" title="Details & Streams öffnen" onclick="openDetails(\\'' + tc + '\\',' + Number(it.tmdbId) + ',false)">👁️</button>' +
                          '<button class="btn" style="padding:4px 8px;font-size:11px;border-color:rgba(245,158,11,0.45);color:#fbbf24" title="Nur aus dieser Playlist entfernen (Film/Serie bleibt in D1 erhalten)" onclick="adminRemovePlaylistItem(\\'' + escJs(state.adminPlaylistTargetChatId) + '\\',\\'' + escJs(activeFolderObj.id) + '\\',\\'' + escJs(it.uid) + '\\')">➖ Aus Playlist</button>' +
                          '<button class="btn danger" style="padding:4px 8px;font-size:11px" title="Komplett aus D1-Datenbank + Telegram-Bot UND aus Playlist löschen" data-target-uid="' + esc(state.adminPlaylistTargetChatId) + '" data-folder-id="' + esc(activeFolderObj.id) + '" data-item-uid="' + esc(it.uid) + '" data-type="' + esc(tc) + '" data-tmdb-id="' + Number(it.tmdbId) + '" data-title="' + esc(it.title) + '" onclick="adminDeletePlaylistItemFromBtn(this)">🗑️ Aus D1 + Bot</button>' +
                        '</div>' +
                      '</div>' +
                      epDrawerBodyHtml +
                    '</div>';
                  }).join("") +
                '</div>'
              )) +
            '</div>'
          ) : '';

          const playlistsManagerBoxHtml =
            '<div class="panel-box" style="border-color:rgba(16,185,129,0.4)">' +
              '<div class="section-title">' +
                '<span>🎵 Smarte Custom Playlisten, Bot-VIP-Playlist & 25er-Batch-Kopie (' + adminPlaylists.length + ')</span>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                  '<button class="btn amber" onclick="adminOpenBotVipPlaylistDirect()">🤖 Bot-VIP-Playlist öffnen</button>' +
                  '<button class="btn blue" onclick="adminSyncBotVipFromD1Client(true)" title="Synchronisiert alle in D1 gespeicherten Bot-Filme & -Serien in 25er-Batches in die Bot-VIP-Playlist">🔄 D1-Katalog (25er-Batches) synchronisieren</button>' +
                  '<select class="tma-select" onchange="state.adminPlaylistTargetChatId=this.value;state.adminEditingFolderId=\\'\\';backupImportJob.targetPlaylistChatId=this.value;loadAdminPanelView()" style="padding:6px 10px;font-size:12px">' +
                    userSelectOptionsHtml +
                  '</select>' +
                  '<button class="btn green" onclick="adminCreatePlaylistPrompt()">➕ Neue Playlist</button>' +
                '</div>' +
              '</div>' +
              '<p style="font-size:12px;color:var(--muted);margin-bottom:10px">Alle Playlisten werden automatisch in <b>25er-Batches</b> kopiert und synchronisiert – dadurch wird das <b>Cloudflare 50-Subrequest-Limit</b> niemals erreicht, egal ob 50 oder 5.000 Filme!</p>' +
              '<div id="adminPlaylistBatchProgressBox" class="admin-sub-box" style="display:none;margin-bottom:10px;padding:10px 12px;border-color:rgba(56,189,248,0.4)"></div>' +
              (adminPlaylists.length === 0
                ? '<div style="font-size:12px;color:var(--muted);padding:8px 0">Noch keine Playlisten oder Ordner für dieses Ziel vorhanden.</div>'
                : adminPlaylists.map(pl => {
                    const isEn = pl.enabled !== false;
                    const isEditingThis = String(pl.id) === String(activeFolderId);
                    const pMode = pl.playlistMode || "both";
                    const modeBadge = pMode === "vip_stream"
                      ? '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(245,158,11,0.2);color:#d97706;margin-left:6px">🌟 VIP-Stream</span>'
                      : pMode === "watchlist"
                        ? '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(2,132,199,0.16);color:#0284c7;margin-left:6px">🔖 Merkliste</span>'
                        : '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(16,185,129,0.2);color:#059669;margin-left:6px">⚡ VIP + Merkliste</span>';
                    return '<div class="ep-row" style="' + (isEn ? '' : 'opacity:0.68;') + (isEditingThis ? 'border:1px solid rgba(251,191,36,0.55);background:rgba(251,191,36,0.06);' : '') + '">' +
                      '<div style="flex:1">' +
                        '<div style="font-size:13px;font-weight:800;color:var(--text)">' +
                          '<span style="font-size:11px;padding:2px 6px;border-radius:999px;margin-right:6px;background:' + (isEn ? 'rgba(16,185,129,0.2);color:#059669' : 'rgba(148,163,184,0.2);color:var(--muted)') + '">' +
                            (isEn ? '🟢 Aktiv' : '⚪ Aus') +
                          '</span>' +
                          esc(pl.name) + ' <span style="color:#0284c7;font-size:11.5px">(' + Number(pl.itemCount || 0) + ' Titel)</span>' +
                          modeBadge +
                        '</div>' +
                        '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' +
                          (pl.isJsonPlaylist || pl.type === 'playlist' ? '📦 JSON-/VIP-Playlist' : '📁 Custom Ordner') +
                          (pl.sourceLabel ? ' • Quelle: ' + esc(pl.sourceLabel) : '') +
                        '</div>' +
                      '</div>' +
                      '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                        '<button class="btn ' + (isEditingThis ? 'amber' : 'blue') + '" onclick="adminOpenPlaylistEditor(\\'' + escJs(state.adminPlaylistTargetChatId) + '\\',\\'' + escJs(pl.id) + '\\')">📂 Öffnen & Bearbeiten</button>' +
                        '<button class="btn green" data-target-uid="' + esc(state.adminPlaylistTargetChatId) + '" data-folder-id="' + esc(pl.id) + '" data-name="' + esc(pl.name) + '" onclick="adminCopyPlaylistBatchFromBtn(this)" title="Kopiert diese Playlist in 25er-Batches ohne API-Limit">📋 25er-Batch Kopie</button>' +
                        '<button class="btn ' + (isEn ? 'green' : '') + '" onclick="adminTogglePlaylist(\\'' + escJs(state.adminPlaylistTargetChatId) + '\\',\\'' + escJs(pl.id) + '\\')">' + (isEn ? '🟢 Ein' : '⚪ Aus') + '</button>' +
                        '<button class="btn" data-target-uid="' + esc(state.adminPlaylistTargetChatId) + '" data-folder-id="' + esc(pl.id) + '" data-name="' + esc(pl.name) + '" onclick="adminRenamePlaylistFromBtn(this)">✏️</button>' +
                        '<button class="btn danger" data-target-uid="' + esc(state.adminPlaylistTargetChatId) + '" data-folder-id="' + esc(pl.id) + '" data-name="' + esc(pl.name) + '" onclick="adminDeletePlaylistFromBtn(this)">🗑️</button>' +
                      '</div>' +
                    '</div>';
                  }).join("")
              ) +
              playlistEditorBoxHtml +
            '</div>';

          const savedChanVal = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
          const isChanReady = Boolean(savedChanVal && (savedChanVal.startsWith("-100") || savedChanVal.startsWith("@")));

          const botSetup = r.botSetup || window._lastAdminOverviewCache?.botSetup || {};
          const curCoverMode = state.adminVideoCoverMode || botSetup.videoCoverMode || "backdrop";
          state.adminVideoCoverMode = curCoverMode;
          if (!state.adminWorkerSpeedProfile) {
            let savedLocalProf = "";
            try { savedLocalProf = localStorage.getItem("tma_worker_speed_profile") || ""; } catch (e) {}
            state.adminWorkerSpeedProfile = savedLocalProf || botSetup.speedProfile || "free_turbo";
          }
          const curSpeedProfile = state.adminWorkerSpeedProfile || "free_turbo";
          const effMiniAppUrl = String(botSetup.webAppUrl || window.location.origin || "https://teleport.sonhartmann-1997.workers.dev").replace(/\\/+$/, "");
          const effBotUsername = String(botSetup.botUsername || "DeinBot").replace(/^@/, "");
          const botFatherCommandsBlock = [
            "start - 🍿 Hauptmenü & Netflix Mini-App öffnen",
            "search - 🔍 Film oder Serie direkt suchen",
            "filter - 🎛️ Katalog-Filter & Streaming-Dienste",
            "t - 🔥 Aktuelle Trends (z.B. /t f oder /t s)",
            "p - 🌟 Populäre Hits (z.B. /p f oder /p s)",
            "sc - 💎 Geheimtipps (z.B. /sc f oder /sc s)",
            "r - 🎲 Zufalls-Tipp (z.B. /r f oder /r s)",
            "info - ℹ️ Hilfe, Befehle & Mini-App Guide",
            "id - 🆔 Eigene Chat- / Gruppen-ID anzeigen"
          ].join("\\n");

          const botApi83CockpitHtml =
            '<div class="panel-box" style="border-color:rgba(56,189,248,0.42);background:linear-gradient(135deg,rgba(15,23,42,0.92),rgba(17,24,39,0.88));margin-bottom:12px">' +
              '<div class="section-title" style="margin-bottom:6px">' +
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                  '<span>🚀 Telegram Bot API 8.3+ & Cloudflare Anti-Timeout Cockpit</span>' +
                  '<span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(16,185,129,0.18);color:#34d399;border:1px solid rgba(16,185,129,0.38)">Bot API 8.0–8.3 aktiv</span>' +
                '</div>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                  '<button type="button" class="btn" style="padding:4px 9px;font-size:11px" onclick="toggleTmaFullscreenClient()">⛶ Vollbild testen</button>' +
                  '<button type="button" class="btn" style="padding:4px 9px;font-size:11px" onclick="addTmaToHomeScreenClient()">📲 Home-Screen-Icon</button>' +
                  '<button type="button" class="btn blue" style="padding:4px 10px;font-size:11px" onclick="state.adminBotGuideOpen=!state.adminBotGuideOpen;loadAdminPanelView(false)">' +
                    (state.adminBotGuideOpen ? '📖 @BotFather Guide ausblenden ▴' : '📖 @BotFather 3-Schritte-Guide ▾') +
                  '</button>' +
                '</div>' +
              '</div>' +
              /* Anti-Timeout Worker Geschwindigkeits-Profil Umschalter */
              '<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.35);border-radius:10px;padding:10px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
                '<div style="flex:1;min-width:240px">' +
                  '<div style="font-size:12px;font-weight:800;color:#34d399">⚡ Cloudflare Worker Geschwindigkeits-Profil (Anti-Timeout & 10ms CPU Schutz)</div>' +
                  '<div style="font-size:11px;color:#cbd5e1;margin-top:2px">' +
                    'Verhindert Timeouts auf dem kostenlosen Cloudflare Worker durch <b>D1 Delta-Upsert</b> (0 Voll-Playlist-Reads), <b>TMDb-Direkt-Turbo</b> und parallelen 1.8s Notfall-Fallback nur bei 0 TMDb-Treffern.' +
                  '</div>' +
                '</div>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                  '<button type="button" class="btn ' + (curSpeedProfile === 'free_turbo' ? 'green' : '') + '" style="font-size:11.5px;padding:6px 11px" onclick="adminSetWorkerSpeedProfileClient(\\'free_turbo\\')">' +
                    (curSpeedProfile === 'free_turbo' ? '✓ ' : '') + '🛡️ Free-Tier Turbo (Empfohlen)' +
                  '</button>' +
                  '<button type="button" class="btn ' + (curSpeedProfile === 'balanced' ? 'blue' : '') + '" style="font-size:11.5px;padding:6px 11px" onclick="adminSetWorkerSpeedProfileClient(\\'balanced\\')">' +
                    (curSpeedProfile === 'balanced' ? '✓ ' : '') + '⚖️ Ausgewogen' +
                  '</button>' +
                  '<button type="button" class="btn ' + (curSpeedProfile === 'paid_pro' ? 'amber' : '') + '" style="font-size:11.5px;padding:6px 11px" onclick="adminSetWorkerSpeedProfileClient(\\'paid_pro\\')">' +
                    (curSpeedProfile === 'paid_pro' ? '✓ ' : '') + '🚀 Paid Worker Pro' +
                  '</button>' +
                '</div>' +
              '</div>' +
              '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:10px;align-items:stretch">' +
                /* Box 1: Bot API 8.3 Video Cover Embedding ohne Re-Upload */
                '<div class="admin-sub-box">' +
                  '<div style="font-size:12px;font-weight:800;color:var(--text);margin-bottom:4px">🖼️ Bot API 8.3 Video-Cover direkt in Dateien einbetten (0 Bytes Re-Upload)</div>' +
                  '<div style="font-size:11px;color:var(--muted);line-height:1.45;margin-bottom:8px">' +
                    'Bettet das hochauflösende TMDb-Cover via <code>cover</code>-Parameter direkt in den Telegram-Videoplayer ein – bei <code>sendVideo</code> sofort und bei <code>copyMessage</code> automatisch über <b>File-ID-Harvesting + In-Place <code>editMessageMedia</code></b>!' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button type="button" class="btn ' + (curCoverMode === 'backdrop' ? 'green' : '') + '" style="flex:1;min-width:130px;justify-content:center;font-size:11.5px" onclick="adminSetVideoCoverModeClient(\\'backdrop\\')">' +
                      (curCoverMode === 'backdrop' ? '✓ ' : '') + '🖼️ 16:9 Szenenbild (Backdrop)' +
                    '</button>' +
                    '<button type="button" class="btn ' + (curCoverMode === 'poster' ? 'amber' : '') + '" style="flex:1;min-width:120px;justify-content:center;font-size:11.5px" onclick="adminSetVideoCoverModeClient(\\'poster\\')">' +
                      (curCoverMode === 'poster' ? '✓ ' : '') + '🎬 2:3 Filmplakat (Poster)' +
                    '</button>' +
                    '<button type="button" class="btn ' + (curCoverMode === 'off' ? 'active' : '') + '" style="padding:6px 10px;font-size:11.5px" onclick="adminSetVideoCoverModeClient(\\'off\\')">' +
                      (curCoverMode === 'off' ? '✓ ' : '') + '⚪ Aus' +
                    '</button>' +
                  '</div>' +
                '</div>' +
                /* Box 2: 1-Klick Mini-App Menü-Button Unten Links (setChatMenuButton) */
                '<div class="admin-sub-box">' +
                  '<div style="font-size:12px;font-weight:800;color:var(--text);margin-bottom:4px">🍿 Mini-App Direktstart-Button im Bot aktivieren (setChatMenuButton)</div>' +
                  '<div style="font-size:11px;color:var(--muted);line-height:1.45;margin-bottom:8px">' +
                    'Setzt den permanenten <b>„🍿 Mediathek“</b>-Button unten links neben dem Texteingabefeld im Bot-Chat für alle Nutzer sowie den Start-Button über jeder Inline-Suche.' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                    '<input id="adminBotMiniAppUrlInp" class="tma-input" value="' + esc(effMiniAppUrl) + '" placeholder="https://dein-worker.workers.dev" style="flex:1;min-width:160px;padding:6px 9px;font-size:11.5px" />' +
                    '<input id="adminBotMenuBtnTextInp" class="tma-input" value="🍿 Mediathek" placeholder="Button-Text" style="width:115px;padding:6px 8px;font-size:11.5px" />' +
                    '<button type="button" class="btn green" style="font-size:11.5px" onclick="adminRunBotMiniAppSetupClient()">🚀 Jetzt 1-Klick aktivieren</button>' +
                  '</div>' +
                  '<div id="adminBotSetupStatusMsg" style="display:none;font-size:11px;margin-top:6px;line-height:1.4"></div>' +
                '</div>' +
              '</div>' +
              /* Box 3: Neon-Cinema PNG-Studio (512x512 Bot-Foto & 640x360 Mini-App Splashscreen) + Empfohlene Mini-App Farben */
              '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:10px;align-items:stretch;margin-top:10px">' +
                /* PNG-Studio für @BotFather */
                '<div style="background:linear-gradient(135deg,rgba(7,11,25,0.92),rgba(18,9,43,0.88));border:1px solid rgba(0,240,255,0.32);border-radius:10px;padding:10px">' +
                  '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;flex-wrap:wrap">' +
                    '<div style="font-size:12px;font-weight:800;color:#f8fafc">🖼️ @BotFather PNG-Studio (Neon-Cinema Design)</div>' +
                    '<button type="button" class="btn" style="padding:3px 8px;font-size:10.5px;border-color:rgba(0,240,255,0.45);color:#38bdf8" onclick="previewBootSplashscreenClient()">✨ In-App Splashscreen testen</button>' +
                  '</div>' +
                  '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
                    '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:210px;background:rgba(255,255,255,0.03);padding:7px;border-radius:8px;border:1px solid rgba(255,255,255,0.08)">' +
                      '<img src="/assets/telegram_bot_avatar_neon.jpg" alt="Bot Avatar" style="width:46px;height:46px;border-radius:10px;object-fit:cover;border:1px solid rgba(0,240,255,0.55);flex-shrink:0" />' +
                      '<div style="flex:1;min-width:110px">' +
                        '<div style="font-size:11.5px;font-weight:800;color:#fff">Bot-Profilbild (1:1)</div>' +
                        '<div style="font-size:10.5px;color:#94a3b8">Exakt 512×512 px PNG für <code>/setuserpic</code></div>' +
                        '<button type="button" class="btn blue" style="margin-top:4px;padding:4px 8px;font-size:10.5px;width:100%" onclick="downloadNeonBotAssetPngClient(\\'avatar_512\\')">⬇️ 512×512 PNG laden</button>' +
                      '</div>' +
                    '</div>' +
                    '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:225px;background:rgba(255,255,255,0.03);padding:7px;border-radius:8px;border:1px solid rgba(255,255,255,0.08)">' +
                      '<img src="/assets/telegram_miniapp_splash_neon.jpg" alt="Mini-App Splash" style="width:74px;height:46px;border-radius:8px;object-fit:cover;border:1px solid rgba(139,92,246,0.55);flex-shrink:0" />' +
                      '<div style="flex:1;min-width:110px">' +
                        '<div style="font-size:11.5px;font-weight:800;color:#fff">Mini-App Splash (16:9)</div>' +
                        '<div style="font-size:10.5px;color:#94a3b8">Exakt 640×360 px PNG für @BotFather</div>' +
                        '<button type="button" class="btn green" style="margin-top:4px;padding:4px 8px;font-size:10.5px;width:100%" onclick="downloadNeonBotAssetPngClient(\\'splash_640x360\\')">⬇️ 640×360 PNG laden</button>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                /* Empfohlene Mini-App Farben (Header, Body, Bottom-Bar) & 1-Klick Copy für @BotFather */
                '<div style="background:linear-gradient(135deg,rgba(11,16,33,0.94),rgba(7,11,25,0.94));border:1px solid rgba(139,92,246,0.38);border-radius:10px;padding:10px">' +
                  '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;flex-wrap:wrap">' +
                    '<div style="font-size:12px;font-weight:800;color:#f8fafc">🎨 Empfohlene Mini-App Farben (Telegram SDK & @BotFather)</div>' +
                    '<button type="button" class="btn green" style="padding:3px 8px;font-size:10.5px" onclick="applyAdminTelegramPaletteLiveClient(\\'dark\\')">⚡ Neon-Cinema Farben aktivieren</button>' +
                  '</div>' +
                  '<div style="font-size:10.5px;color:#94a3b8;margin-bottom:7px;line-height:1.4">' +
                    'Werden beim Start automatisch per <code>setHeaderColor</code>, <code>setBackgroundColor</code> & <code>setBottomBarColor</code> gesetzt. Klicke auf einen Farbcode zum Kopieren für <b>@BotFather ▸ Configure Mini App</b>:' +
                  '</div>' +
                  '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px">' +
                    '<div onclick="copyAdminTextToClipboardClient(\\'#0B1021\\',\\'Mini-App Header-Farbe\\')" style="cursor:pointer;display:flex;align-items:center;gap:7px;padding:5px 7px;border-radius:7px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1)" title="Klicken zum Kopieren">' +
                      '<span style="width:20px;height:20px;border-radius:5px;background:#0B1021;border:1px solid #38bdf8;flex-shrink:0"></span>' +
                      '<div style="line-height:1.2"><div style="font-size:10px;color:#94a3b8">Header Color</div><div style="font-size:11px;font-weight:800;color:#fff;font-family:monospace">#0B1021 📋</div></div>' +
                    '</div>' +
                    '<div onclick="copyAdminTextToClipboardClient(\\'#070B19\\',\\'Mini-App Body-/Background-Farbe\\')" style="cursor:pointer;display:flex;align-items:center;gap:7px;padding:5px 7px;border-radius:7px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1)" title="Klicken zum Kopieren">' +
                      '<span style="width:20px;height:20px;border-radius:5px;background:#070B19;border:1px solid #8b5cf6;flex-shrink:0"></span>' +
                      '<div style="line-height:1.2"><div style="font-size:10px;color:#94a3b8">Body / Background</div><div style="font-size:11px;font-weight:800;color:#fff;font-family:monospace">#070B19 📋</div></div>' +
                    '</div>' +
                    '<div onclick="copyAdminTextToClipboardClient(\\'#090D1C\\',\\'Mini-App Bottom-Bar-Farbe\\')" style="cursor:pointer;display:flex;align-items:center;gap:7px;padding:5px 7px;border-radius:7px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1)" title="Klicken zum Kopieren">' +
                      '<span style="width:20px;height:20px;border-radius:5px;background:#090D1C;border:1px solid rgba(255,255,255,0.3);flex-shrink:0"></span>' +
                      '<div style="line-height:1.2"><div style="font-size:10px;color:#94a3b8">Bottom Bar</div><div style="font-size:11px;font-weight:800;color:#fff;font-family:monospace">#090D1C 📋</div></div>' +
                    '</div>' +
                    '<div onclick="copyAdminTextToClipboardClient(\\'#00F0FF\\',\\'Primärer Neon-Cyan Akzent\\')" style="cursor:pointer;display:flex;align-items:center;gap:7px;padding:5px 7px;border-radius:7px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1)" title="Klicken zum Kopieren">' +
                      '<span style="width:20px;height:20px;border-radius:5px;background:linear-gradient(135deg,#00F0FF,#8B5CF6);border:1px solid #fff;flex-shrink:0"></span>' +
                      '<div style="line-height:1.2"><div style="font-size:10px;color:#94a3b8">Neon-Akzent</div><div style="font-size:11px;font-weight:800;color:#38bdf8;font-family:monospace">#00F0FF 📋</div></div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              /* Aufklappbarer @BotFather Guide für Main Mini App & Chatlisten-Öffnen */
              (state.adminBotGuideOpen ? (
                '<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(15,23,42,0.95);border:1px solid rgba(56,189,248,0.35);font-size:11.5px;color:#cbd5e1;line-height:1.55">' +
                  '<div style="font-weight:800;color:#38bdf8;margin-bottom:6px">📖 Was du direkt hier per 1-Klick erledigst vs. was einmalig im @BotFather eingestellt wird:</div>' +
                  '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">' +
                    '<div style="background:rgba(255,255,255,0.03);padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08)">' +
                      '<b style="color:#34d399">1️⃣ Automatisch per Bot-API (Kein BotFather nötig):</b><br/>' +
                      '• <b>Menü-Button unten links im Chat:</b> Wird beim Klick auf <i>„🚀 Jetzt 1-Klick aktivieren“</i> (und automatisch bei <code>/start</code>) via <code>setChatMenuButton</code> gesetzt.<br/>' +
                      '• <b>Inline-Suche Start-Button:</b> Erscheint automatisch ganz oben über den Inline-Suchergebnissen.<br/>' +
                      '• <b>In-Place Video-Cover (Bot API 8.3):</b> Funktioniert vollautomatisch über den Worker.' +
                    '</div>' +
                    '<div style="background:rgba(255,255,255,0.03);padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08)">' +
                      '<b style="color:#fbbf24">2️⃣ Einmalig im @BotFather (Main Mini App, Bot-Foto, Splashscreen & Login Widget):</b><br/>' +
                      '1. Öffne <a href="https://t.me/BotFather" target="_blank" rel="noopener" style="color:#38bdf8;text-decoration:underline">@BotFather</a> ▸ <code>/mybots</code> ▸ <b>@' + esc(effBotUsername) + '</b>.<br/>' +
                      '2. <b>Bot-Foto:</b> <i>Edit Bot ▸ Edit Botpic</i> ▸ das <b>512×512 PNG</b> hochladen.<br/>' +
                      '3. <b>Main Mini App & Farben:</b> <i>Bot Settings ▸ Configure Mini App</i> ▸ URL einfügen, das <b>640×360 PNG</b> sowie Header <code>#0B1021</code> & Background <code>#070B19</code> eintragen.<br/>' +
                      '4. <b>Telegram Login Widget im Browser:</b> Sende <code>/setdomain</code> an @BotFather und hinterlege deine Worker-Domain:' +
                      '<div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">' +
                        '<button type="button" class="btn" style="padding:3px 8px;font-size:11px" onclick="copyAdminTextToClipboardClient(\\'' + escJs(effMiniAppUrl) + '\\',\\'Mini-App URL\\')">📋 Mini-App URL kopieren</button>' +
                        '<button type="button" class="btn" style="padding:3px 8px;font-size:11px" onclick="copyAdminTextToClipboardClient(' + JSON.stringify(botFatherCommandsBlock).replace(/"/g, '&quot;') + ',\\'BotFather Befehlsliste\\')">📋 Befehlsliste kopieren</button>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>'
              ) : '') +
            '</div>';

          const officialWebhookUrl = String(botSetup.webhookUrl || (String(effMiniAppUrl || "").replace(/\\/app$/i, "") + "/webhook"));
          const hasWebhookPw = Boolean(botSetup.hasWebhookPassword);
          const webhookPwPreview = String(botSetup.webhookPasswordPreview || "");
          const webhookMaxConn = Number(botSetup.webhookMaxConnections || 8);
          const activeWhSecretRaw = String(botSetup.activeWebhookSecret || "");
          const fallbackWorkerSetUrl = String(botSetup.manualSetWebhookWorkerUrl || (officialWebhookUrl.replace(/\\/webhook$/i, "") + "/setwebhook?" + (activeWhSecretRaw ? ("secret=" + encodeURIComponent(activeWhSecretRaw) + "&") : "") + "drop_pending_updates=1&max_connections=" + webhookMaxConn));
          const fallbackTgApiSetUrl = String(botSetup.manualTelegramApiTemplateUrl || ("https://api.telegram.org/bot<DEIN_BOT_TOKEN>/setWebhook?url=" + encodeURIComponent(officialWebhookUrl) + "&max_connections=" + webhookMaxConn + "&drop_pending_updates=true" + (activeWhSecretRaw ? ("&secret_token=" + encodeURIComponent(activeWhSecretRaw)) : "")));

          const botAndSettingsDedicatedPageHtml =
            '<div class="golden-grid">' +
              /* Linke Hauptspalte (61.8%): Webhook-Zentrale + Passwort-Schutz + BotFather Studio + Bot API 8.3 */
              '<div style="display:flex;flex-direction:column;gap:12px;min-width:0">' +
                /* 1. Telegram Webhook-Link & Passwort-Schutz (secret_token) Zentrale */
                '<div class="panel-box" style="border-color:rgba(14,165,233,0.45)">' +
                  '<div class="section-title" style="margin-bottom:6px">' +
                    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                      '<span>🔗 Telegram Bot Webhook-Link & Passwort-Schutz (<code>secret_token</code>)</span>' +
                      '<span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:' + (hasWebhookPw ? 'rgba(16,185,129,0.2);color:#10b981;border:1px solid rgba(16,185,129,0.45)' : 'rgba(245,158,11,0.2);color:#d97706;border:1px solid rgba(245,158,11,0.45)') + '">' +
                        (hasWebhookPw ? ('🔒 Passwort aktiv (' + esc(webhookPwPreview) + ')') : '⚠️ Noch kein Webhook-Passwort gesetzt') +
                      '</span>' +
                    '</div>' +
                    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                      '<button type="button" class="btn blue" style="padding:4px 9px;font-size:11px" onclick="adminCheckWebhookLiveStatusClient()">🔍 Live-Status (getWebhookInfo)</button>' +
                      '<button type="button" class="btn amber" style="padding:4px 9px;font-size:11px" onclick="adminDropPendingWebhookUpdatesClient()" title="Verwirft alle bei Telegram angestauten Alt-Updates (stoppt Retry-Stürme sofort)">🧹 Hängende Updates verwerfen</button>' +
                    '</div>' +
                  '</div>' +
                  '<p style="font-size:11.5px;color:var(--muted);line-height:1.45;margin-bottom:10px">' +
                    'Schützt deinen Cloudflare Worker vor fremden Bot-Scannern und Telegram-Retry-Stürmen: Unautorisierte Requests ohne gültiges Webhook-Passwort werden in <b>&lt; 0.1ms (0 D1-Reads)</b> an der Edge abgewiesen.' +
                  '</p>' +
                  '<div style="display:flex;flex-direction:column;gap:8px">' +
                    '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
                      '<span style="font-size:11.5px;font-weight:800;color:#0284c7;min-width:130px">🌐 Webhook-URL:</span>' +
                      '<input id="adminWebhookUrlInp" class="tma-input" value="' + esc(officialWebhookUrl) + '" oninput="refreshManualWebhookLinksUiClient()" style="flex:1;min-width:220px;padding:7px 10px;font-family:monospace;font-size:12px" />' +
                      '<button type="button" class="btn" onclick="copyAdminInputValueClient(\\'adminWebhookUrlInp\\',\\'Telegram Webhook-URL\\')">📋 Link kopieren</button>' +
                    '</div>' +
                    '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
                      '<span style="font-size:11.5px;font-weight:800;color:#10b981;min-width:130px">🔑 Webhook-Passwort:</span>' +
                      '<input id="adminWebhookPasswordInp" class="tma-input" type="password" oninput="refreshManualWebhookLinksUiClient()" placeholder="' + (hasWebhookPw ? ('Aktives Passwort (' + esc(webhookPwPreview) + ') – leer lassen zum Behalten') : 'Sicheres Passwort (A-Z, 0-9, _, -) eingeben oder generieren...') + '" style="flex:1;min-width:210px;padding:7px 10px;font-family:monospace;font-size:12px" />' +
                      '<button type="button" class="btn" onclick="const el=document.getElementById(\\'adminWebhookPasswordInp\\');if(el)el.type=el.type===\\'password\\'?\\'text\\':\\'password\\'">👁️</button>' +
                      '<button type="button" class="btn purple" onclick="generateRandomWebhookPasswordClient()">🎲 Passwort generieren</button>' +
                      (hasWebhookPw ? '<button type="button" class="btn red" onclick="adminSaveAndRegisterWebhookClient(true)" title="Entfernt das Webhook-Passwort und aktualisiert den Webhook">🗑️ Entfernen</button>' : '') +
                    '</div>' +
                    '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding-top:4px">' +
                      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:11.5px;color:var(--text)">' +
                        '<label style="display:flex;align-items:center;gap:5px">⚡ Max. parallele Verbindungen:' +
                          '<select id="adminWebhookMaxConnSel" class="tma-select" onchange="refreshManualWebhookLinksUiClient()" style="padding:4px 8px;font-size:11.5px">' +
                            '<option value="6" ' + (webhookMaxConn === 6 ? 'selected' : '') + '>6 (Ultra-Safe Free-Tier)</option>' +
                            '<option value="8" ' + (webhookMaxConn === 8 ? 'selected' : '') + '>8 (Empfohlen Free-Tier)</option>' +
                            '<option value="16" ' + (webhookMaxConn === 16 ? 'selected' : '') + '>16 (Balanced)</option>' +
                            '<option value="40" ' + (webhookMaxConn === 40 ? 'selected' : '') + '>40 (Paid Worker Standard)</option>' +
                          '</select>' +
                        '</label>' +
                        '<label style="display:flex;align-items:center;gap:5px;cursor:pointer">' +
                          '<input id="adminWebhookDropPendingChk" type="checkbox" checked onchange="refreshManualWebhookLinksUiClient()" /> 🧹 Alte hängende Updates beim Setzen verwerfen' +
                        '</label>' +
                      '</div>' +
                      '<button type="button" class="btn green" onclick="adminSaveAndRegisterWebhookClient(false)">🔒 Speichern & Webhook automatisch bei Telegram registrieren</button>' +
                    '</div>' +
                    '<div id="adminWebhookStatusBox" class="admin-sub-box" style="display:none;margin-top:6px;padding:8px 10px;font-size:11.5px;line-height:1.5"></div>' +
                    /* Manueller Webhook-Eintrag (Direktlinks zum Kopieren / Aufrufen) */
                    '<div class="admin-sub-box" style="margin-top:6px;padding:10px 12px;border-color:rgba(56,189,248,0.35);background:rgba(15,23,42,0.55)">' +
                      '<div style="font-size:11.5px;font-weight:900;color:#38bdf8;margin-bottom:6px">📋 Manueller Webhook-Eintrag (Direktlinks – passen sich live an deine Eingaben an)</div>' +
                      '<div style="display:flex;flex-direction:column;gap:7px">' +
                        '<div>' +
                          '<div style="font-size:10.5px;color:#cbd5e1;margin-bottom:3px"><b>Option A – Worker-Direktlink (<code>/setwebhook</code>):</b> Im Browser öffnen, damit dein Worker den Webhook inkl. Secret-Token setzt:</div>' +
                          '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
                            '<input id="adminManualWorkerWebhookLinkInp" class="tma-input" value="' + esc(fallbackWorkerSetUrl) + '" readonly style="flex:1;min-width:220px;padding:6px 9px;font-family:monospace;font-size:11px;color:#93c5fd" />' +
                            '<button type="button" class="btn" style="padding:5px 9px;font-size:11px" onclick="copyAdminInputValueClient(\\'adminManualWorkerWebhookLinkInp\\',\\'Worker /setwebhook Link\\')">📋 Kopieren</button>' +
                            '<a id="adminManualWorkerOpenAnchor" href="' + esc(safeHttpUrl(fallbackWorkerSetUrl)) + '" target="_blank" rel="noopener noreferrer" class="btn blue" style="padding:5px 9px;font-size:11px;text-decoration:none">🌐 Öffnen</a>' +
                          '</div>' +
                          '<div id="adminManualWorkerSecretHint" style="display:' + (hasWebhookPw ? 'none' : 'block') + ';font-size:10px;color:#fbbf24;margin-top:3px">ℹ️ Ohne gespeichertes Webhook-Passwort erfordert <code>/setwebhook</code> eine aktive Admin-Session – oder nutze Option B direkt über die Telegram API.</div>' +
                        '</div>' +
                        '<div>' +
                          '<div style="font-size:10.5px;color:#cbd5e1;margin-bottom:3px"><b>Option B – Direkter Telegram Bot API Link:</b> Ersetze <code>&lt;DEIN_BOT_TOKEN&gt;</code> durch dein BotFather-Token und öffne die URL im Browser:</div>' +
                          '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
                            '<input id="adminManualTelegramApiLinkInp" class="tma-input" value="' + esc(fallbackTgApiSetUrl) + '" readonly style="flex:1;min-width:220px;padding:6px 9px;font-family:monospace;font-size:11px;color:#86efac" />' +
                            '<button type="button" class="btn" style="padding:5px 9px;font-size:11px" onclick="copyAdminInputValueClient(\\'adminManualTelegramApiLinkInp\\',\\'Telegram API setWebhook Link\\')">📋 Kopieren</button>' +
                          '</div>' +
                        '</div>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +

                /* 2. @BotFather Studio inkl. 512x512 Single-<path> SVG + 512x512 WEBP + 512x512 PNG + 640x360 PNG */
                '<div class="panel-box" style="border-color:rgba(99,102,241,0.45);background:linear-gradient(145deg,#091224,#101935)">' +
                  '<div class="section-title" style="margin-bottom:6px">' +
                    '<span>🎨 @BotFather Komplett-Baukasten (512×512 Single-<code>&lt;path&gt;</code> SVG, WEBP & PNGs)</span>' +
                    '<button type="button" class="btn" style="padding:3px 9px;font-size:11px;border-color:rgba(0,229,255,0.45);color:#00e5ff" onclick="previewBootSplashscreenClient()">✨ In-App Splashscreen testen</button>' +
                  '</div>' +
                  '<p style="font-size:11.5px;color:#cbd5e1;margin-bottom:10px;line-height:1.45">' +
                    'Exakt nach der offiziellen Telegram-Anforderung (<i>„Canvas size 512×512 and a single &lt;path&gt; element inside, or a WEBP file with the same size“</i>):' +
                  '</p>' +
                  '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">' +
                    '<div style="background:rgba(0,229,255,0.07);border:1px solid rgba(0,229,255,0.4);border-radius:9px;padding:9px;display:flex;flex-direction:column;justify-content:space-between;gap:6px">' +
                      '<div>' +
                        '<div style="font-size:12px;font-weight:900;color:#00e5ff">💎 Splashscreen SVG (512×512)</div>' +
                        '<div style="font-size:10.5px;color:#cbd5e1;margin-top:2px">Strikte <code>512×512</code> Vektorgrafik mit exakt <b>1 einzigen <code>&lt;path&gt;</code>-Element</b> für @BotFather!</div>' +
                      '</div>' +
                      '<button type="button" class="btn green" style="width:100%;justify-content:center;font-size:11px" onclick="downloadBotFatherSinglePathSvgClient()">⬇️ 512×512 Single-Path .SVG laden</button>' +
                    '</div>' +
                    '<div style="background:rgba(99,102,241,0.09);border:1px solid rgba(99,102,241,0.42);border-radius:9px;padding:9px;display:flex;flex-direction:column;justify-content:space-between;gap:6px">' +
                      '<div>' +
                        '<div style="font-size:12px;font-weight:900;color:#a5b4fc">🖼️ Splashscreen WEBP (512×512)</div>' +
                        '<div style="font-size:10.5px;color:#cbd5e1;margin-top:2px">Exakt <code>512×512 px</code> im verlustfreien <b>.WEBP</b> Format (Alternative für @BotFather).</div>' +
                      '</div>' +
                      '<button type="button" class="btn blue" style="width:100%;justify-content:center;font-size:11px" onclick="downloadNeonBotAssetWebpClient()">⬇️ 512×512 .WEBP laden</button>' +
                    '</div>' +
                    '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:9px;display:flex;flex-direction:column;justify-content:space-between;gap:6px">' +
                      '<div>' +
                        '<div style="font-size:12px;font-weight:800;color:#fff">🤖 Bot-Profilbild PNG (512×512)</div>' +
                        '<div style="font-size:10.5px;color:#94a3b8;margin-top:2px">Für <code>/setuserpic</code> im @BotFather.</div>' +
                      '</div>' +
                      '<button type="button" class="btn" style="width:100%;justify-content:center;font-size:11px" onclick="downloadNeonBotAssetPngClient(\\'avatar_512\\')">⬇️ 512×512 .PNG laden</button>' +
                    '</div>' +
                    '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:9px;display:flex;flex-direction:column;justify-content:space-between;gap:6px">' +
                      '<div>' +
                        '<div style="font-size:12px;font-weight:800;color:#fff">🎬 Mini-App Header PNG (640×360)</div>' +
                        '<div style="font-size:10.5px;color:#94a3b8;margin-top:2px">16:9 Vorschau-Banner für Mini-App Links.</div>' +
                      '</div>' +
                      '<button type="button" class="btn" style="width:100%;justify-content:center;font-size:11px" onclick="downloadNeonBotAssetPngClient(\\'splash_640x360\\')">⬇️ 640×360 .PNG laden</button>' +
                    '</div>' +
                  '</div>' +
                '</div>' +

                /* 3. Bot API 8.3 Cockpit (Speed-Profil, Video-Cover, Menü-Button, Farben & Befehlsliste) */
                botApi83CockpitHtml +
              '</div>' +

              /* Rechte Begleitspalte (38.2%): Echtzeit Worker-Health-Monitor + Anti-Spam Cockpit + Schnell-Aktionen */
              '<div style="display:flex;flex-direction:column;gap:12px;min-width:0">' +
                renderWorkerHealthMonitorWidgetHtml(false) +
                buildAntiSpamCockpitBoxHtmlClient() +
                '<div class="panel-box" style="border-color:rgba(244,63,94,0.35)">' +
                  '<div class="section-title" style="margin-bottom:6px"><span>🧰 Datenbank-Wartung & Komplett-Reset</span></div>' +
                  '<div style="font-size:11.5px;color:#94a3b8;margin-bottom:8px">Defekte oder doppelte Stream-Buttons werden jetzt vollautomatisch ausgefiltert. Bei Bedarf kannst du hier einen Datenbank-Reset ausführen:</div>' +
                  '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                    '<button type="button" class="btn danger" onclick="adminRunCompleteMediaResetClient()">🧨 Komplett-Reset (Alle Medien & Playlisten löschen)</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>';

          root.innerHTML = '<div class="section">' +
            '<div class="section-title">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                '<button type="button" class="btn" onclick="goHome()" title="Zurück zum Katalog">⬅️ Katalog</button>' +
                '<span>👑 Admin-Cockpit & Bot-Zentrale</span>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="btn ' + (state.adminTab === 'bot' ? 'active' : 'blue') + '" onclick="state.adminTab=\\'bot\\';loadAdminPanelView()">🤖 Bot & Einstellungen</button>' +
                '<button class="btn ' + (state.adminTab === 'backup' ? 'active' : '') + '" onclick="state.adminTab=\\'backup\\';loadAdminPanelView()">📦 JSON-Import</button>' +
                '<button class="btn ' + (state.adminTab === 'playlists' ? 'active' : '') + '" onclick="state.adminTab=\\'playlists\\';loadAdminPanelView()">🎵 Playlisten (' + adminPlaylists.length + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'users' ? 'active' : '') + '" onclick="state.adminTab=\\'users\\';loadAdminPanelView()">👥 User & VIP (' + users.length + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'reports' ? 'active' : (openReportsCount > 0 ? 'amber' : '')) + '" onclick="state.adminTab=\\'reports\\';loadAdminPanelView()">🚨 Meldungen (' + openReportsCount + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'gaps' ? 'active' : '') + '" onclick="state.adminTab=\\'gaps\\';loadAdminPanelView()">📉 Serien-Lücken (' + Number(seriesGaps.seriesWithGapsCount || 0) + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'crud' ? 'active' : '') + '" onclick="state.adminTab=\\'crud\\';loadAdminPanelView()">🎬 Medien CRUD (' + mediaList.length + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'diaglog' ? 'active' : '') + '" onclick="state.adminTab=\\'diaglog\\';loadAdminPanelView()">📋 Logs (' + getDiagnosticLogTotalCountClient() + ')</button>' +
                '<button class="btn" onclick="loadAdminPanelView(true)" title="Daten frisch vom Server laden">🔄</button>' +
              '</div>' +
            '</div>' +
            (state.adminTab === "bot" ? (
              botAndSettingsDedicatedPageHtml
            ) : state.adminTab === "users" ? (
              '<div class="panel-box">' +
                '<div class="section-title"><span>👥 Registrierte Telegram- & Web-Nutzer (' + users.length + ')</span></div>' +
                (users.length === 0 ? '<div style="font-size:12px;color:#aaa">Noch keine Nutzer in D1 registriert.</div>' : '') +
                users.map(u => '<div class="ep-row">' +
                  '<div style="flex:1">' +
                    '<div style="font-size:13px;font-weight:800;color:var(--text)">🆔 ' + esc(u.telegramId) +
                      (u.tgUsername ? ' <span style="color:#0284c7">@' + esc(u.tgUsername) + '</span>' : '') +
                      (u.customUsername ? ' <span style="color:#10b981">[Web: ' + esc(u.customUsername) + ']</span>' : '') +
                      (u.isAdmin ? ' <span style="color:#4f46e5">👑 ADMIN</span>' : '') +
                    '</div>' +
                    '<div style="font-size:11px;color:var(--muted)">' +
                      (u.hasPasswordAccount ? '🔐 Passwort-Account aktiv' : '📱 Nur Telegram initData') +
                      (u.totpEnabled ? ' • 🛡️ 2FA aktiv' : '') +
                      ' • Zuletzt aktiv: ' + (u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString('de-DE') : '–') +
                    '</div>' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button class="btn" onclick="state.adminPlaylistTargetChatId=\\'' + escJs(u.telegramId) + '\\';state.adminTab=\\'playlists\\';loadAdminPanelView()">🎵 Playlisten</button>' +
                    '<button class="btn ' + (u.isVip ? 'amber' : '') + '" onclick="toggleUserVipAdmin(\\'' + escJs(u.telegramId) + '\\',' + (!u.isVip) + ')">' +
                      (u.isVip ? '🌟 VIP AKTIV (Entziehen)' : '⚪ Kein VIP (VIP vergeben)') +
                    '</button>' +
                  '</div>' +
                '</div>').join("") +
              '</div>'
            ) : state.adminTab === "reports" ? (
              '<div class="panel-box" style="border-color:rgba(245,158,11,0.45)">' +
                '<div class="section-title">' +
                  '<span>🚨 Eingegangene Fehlermeldungen von VIPs & Admins (' + openReportsCount + ' offen / ' + allReports.length + ' gesamt)</span>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button type="button" class="btn ' + (reportFilter === 'open' ? 'amber' : '') + '" onclick="state.adminReportFilter=\\'open\\';loadAdminPanelView()">🔥 Offen (' + openReportsCount + ')</button>' +
                    '<button type="button" class="btn ' + (reportFilter === 'resolved' ? 'green' : '') + '" onclick="state.adminReportFilter=\\'resolved\\';loadAdminPanelView()">✅ Gelöst (' + (allReports.length - openReportsCount) + ')</button>' +
                    '<button type="button" class="btn ' + (reportFilter === 'all' ? 'blue' : '') + '" onclick="state.adminReportFilter=\\'all\\';loadAdminPanelView()">📋 Alle (' + allReports.length + ')</button>' +
                    ((allReports.length - openReportsCount) > 0 ? '<button type="button" class="btn amber" onclick="adminClearAllMediaReportsClient(true)">🧹 Gelöste entfernen (' + (allReports.length - openReportsCount) + ')</button>' : '') +
                    (allReports.length > 0 ? '<button type="button" class="btn danger" onclick="adminClearAllMediaReportsClient(false)">🗑️ Alle Meldungen löschen</button>' : '') +
                  '</div>' +
                '</div>' +
                '<p style="font-size:12px;color:var(--muted);margin-bottom:10px">Klicke auf <b>🔧 Jetzt korrigieren</b>, um direkt in die Detailansicht & den Folgen-Korrektur-Dialog zu springen. Sobald du die Korrektur speicherst, wird die Meldung automatisch als gelöst markiert!</p>' +
                (filteredReports.length === 0 ? (
                  '<div class="admin-sub-box" style="padding:16px;text-align:center;color:var(--muted);font-size:12.5px">🎉 Keine ' + (reportFilter === 'open' ? 'offenen ' : '') + 'Fehlermeldungen vorhanden.</div>'
                ) : (
                  filteredReports.map(rep => {
                    const isOpen = rep.status === "open";
                    const tc = rep.type_code === "s" ? "s" : "m";
                    const epStr = tc === "s" && rep.season_number != null
                      ? (' • <b style="color:#0284c7">S' + String(rep.season_number).padStart(2, '0') + 'E' + String(rep.episode_number || 1).padStart(2, '0') + '</b>' + (rep.episode_title ? (' (' + esc(rep.episode_title) + ')') : ''))
                      : '';
                    return '<div class="ep-row" style="' + (isOpen ? 'border-color:rgba(245,158,11,0.5);background:rgba(245,158,11,0.06);' : 'opacity:0.75;') + '">' +
                      '<div style="flex:1;min-width:210px">' +
                        '<div style="font-size:13px;font-weight:800;color:var(--text)">' +
                          '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;margin-right:6px;background:' + (isOpen ? 'rgba(239,68,68,0.2);color:#dc2626' : 'rgba(16,185,129,0.2);color:#059669') + '">' +
                            (isOpen ? '🚨 OFFEN' : '✅ GELÖST') +
                          '</span>' +
                          (tc === 's' ? '📺 ' : '🎬 ') + esc(rep.title) + ' <span style="color:var(--muted);font-weight:600">(TMDb #' + Number(rep.tmdb_id) + ')</span>' +
                          epStr +
                          (rep.version_label ? (' <span class="flix-version-badge" style="margin-left:6px">🎞️ ' + esc(rep.version_label) + '</span>') : '') +
                        '</div>' +
                        '<div style="font-size:12px;color:#d97706;font-weight:700;margin-top:4px">' +
                          esc(rep.reason_label || '⚠️ Fehler gemeldet') +
                          (rep.note ? (' — <span style="color:var(--text);font-weight:500">„' + esc(rep.note) + '“</span>') : '') +
                        '</div>' +
                        '<div style="font-size:11px;color:var(--muted);margin-top:3px">' +
                          '👤 Gemeldet von: <b>' + (rep.reporter_username ? ('@' + esc(rep.reporter_username) + ' (' + esc(rep.reporter_telegram_id) + ')') : esc(rep.reporter_telegram_id)) + '</b>' +
                          ' • ' + (rep.created_at ? new Date(Number(rep.created_at)).toLocaleString('de-DE') : '') +
                          (!isOpen && rep.resolved_by ? (' • Gelöst von: <b style="color:#10b981">' + esc(rep.resolved_by) + '</b>') : '') +
                        '</div>' +
                      '</div>' +
                      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                        '<button type="button" class="btn blue" onclick="openReportCorrectionWorkflowByIdClient(' + Number(rep.id) + ')">🔧 Jetzt korrigieren</button>' +
                        (isOpen ? '<button type="button" class="btn green" onclick="adminResolveMediaReportClient(' + Number(rep.id) + ')">✅ Als gelöst markieren</button>' : '') +
                        '<button type="button" class="btn danger" onclick="adminDeleteMediaReportClient(' + Number(rep.id) + ')" title="Meldung löschen">🗑️</button>' +
                      '</div>' +
                    '</div>';
                  }).join("")
                )) +
              '</div>'
            ) : state.adminTab === "playlists" ? (
              playlistsManagerBoxHtml
            ) : state.adminTab === "gaps" ? (
              '<div class="panel-box" style="border-color:rgba(245,158,11,0.5)">' +
                '<div class="section-title">' +
                  '<span>📉 Fehlende Serienfolgen & Staffel-Lücken Finder (' + Number(seriesGaps.seriesWithGapsCount || 0) + ' Serien mit Lücken von ' + Number(seriesGaps.totalSeriesChecked || 0) + ' geprüften Serien)</span>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button class="btn ' + ((state.adminGapFilter || 'all') === 'all' ? 'amber' : '') + '" onclick="state.adminGapFilter=\\'all\\';loadAdminPanelView()">📋 Alle Lücken (' + Number(seriesGaps.seriesWithGapsCount || 0) + ')</button>' +
                    '<button class="btn ' + (state.adminGapFilter === 'internal' ? 'red' : '') + '" onclick="state.adminGapFilter=\\'internal\\';loadAdminPanelView()">🚨 Nur Lücken mitten in der Staffel (' + Number(seriesGaps.seriesWithInternalGapsCount || 0) + ')</button>' +
                    '<button class="btn green" onclick="state.adminTab=\\'gaps\\';loadAdminPanelView(true)" title="Ignoriert den Cache und scannt alle Serien, Staffeln und Episoden in D1 sofort neu">🔄 Jetzt Lücken neu scannen</button>' +
                  '</div>' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:8px;margin-bottom:12px;font-size:12px">' +
                  '<div class="admin-sub-box" style="padding:9px 11px;border-color:rgba(239,68,68,0.4)">🚨 <b>Lücken mitten in Staffel/Serie (Prio 1):</b> <span style="color:#dc2626;font-weight:900">' + Number(seriesGaps.totalMissingInternal || 0) + ' Folgen</span> in ' + Number(seriesGaps.seriesWithInternalGapsCount || 0) + ' Serien</div>' +
                  '<div class="admin-sub-box" style="padding:9px 11px;border-color:rgba(56,189,248,0.35)">⏳ <b>Fehlend am Staffelende (Prio 2):</b> <span style="color:#0284c7;font-weight:900">' + Number(seriesGaps.totalMissingTrailing || 0) + ' Folgen</span></div>' +
                  '<div class="admin-sub-box" style="padding:9px 11px;border-color:rgba(99,102,241,0.45)">💿 <b>Unvollständige Mehrteiler (CD1/CD2):</b> <span style="color:#4f46e5;font-weight:900">' + Number(seriesGaps.incompleteMultipartMoviesCount || 0) + ' Filme</span></div>' +
                  '<div class="admin-sub-box" style="padding:9px 11px;border-color:rgba(245,158,11,0.4)">⚠️ <b>Nur als Vorabversion/TS/MD:</b> <span style="color:#d97706;font-weight:900">' + Number(seriesGaps.totalPrereleaseOnly || 0) + ' Folgen</span></div>' +
                '</div>' +
                ((seriesGaps.incompleteMultipartMovies && seriesGaps.incompleteMultipartMovies.length > 0) ? (
                  '<div class="admin-sub-box" style="border-color:rgba(99,102,241,0.5);padding:10px 12px;margin-bottom:12px">' +
                    '<div style="font-size:12.5px;font-weight:900;color:#4f46e5;margin-bottom:6px">💿 Unvollständige Mehrteiler-Filme (CD1 oder CD2 fehlt in D1):</div>' +
                    '<div style="display:flex;flex-direction:column;gap:6px">' +
                      seriesGaps.incompleteMultipartMovies.map(mp =>
                        '<div class="admin-surface-card" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;border-radius:7px;font-size:12px">' +
                          '<div>' +
                            '🎬 <b>' + esc(mp.title) + '</b> <span style="color:var(--muted)">(' + esc(mp.year || 'k.A.') + ' • TMDb #' + Number(mp.tmdbId) + ')</span> — ' +
                            '<span style="color:#10b981">Vorhanden: ' + esc((mp.presentParts || []).map(p => 'CD ' + p).join(', ')) + '</span> • ' +
                            '<b style="color:#dc2626">Fehlt: ' + esc(mp.missingLabel || ((mp.missingParts || []).map(p => 'CD ' + p).join(', '))) + '</b>' +
                          '</div>' +
                          '<button type="button" class="btn blue" style="padding:4px 9px;font-size:11px" onclick="openDetails(\\'m\\',' + Number(mp.tmdbId) + ',false)">🎬 Film öffnen</button>' +
                        '</div>'
                      ).join("") +
                    '</div>' +
                  '</div>'
                ) : '') +
                '<p style="font-size:12px;color:var(--muted);margin-bottom:10px">💡 <b>Besonders wichtig (rot markiert):</b> Wenn z.B. <code>Folge 1 + 2</code> fehlen, während <code>Folge 3</code> bereits vorhanden ist, oder eine komplette Zwischen-Staffel (z.B. <code>Staffel 2</code> vor <code>Staffel 3</code>) fehlt, steht diese Serie ganz oben.</p>' +
                ((() => {
                  const gapItems = (seriesGaps.items || []).filter(item => state.adminGapFilter === "internal" ? (item.hasPriorityInternalGaps ?? item.hasInternalGaps) : true);
                  if (gapItems.length === 0) {
                    return '<div class="admin-sub-box" style="padding:18px;text-align:center;color:#10b981;font-size:12.5px;border-color:rgba(16,185,129,0.35)">🎉 Perfekt! Keine fehlenden Serienfolgen in dieser Ansicht gefunden.</div>';
                  }
                  return '<div style="display:flex;flex-direction:column;gap:10px;max-height:620px;overflow-y:auto;padding-right:4px">' +
                    gapItems.map(sItem => {
                      const seriesIdVal = Number(sItem.seriesId ?? sItem.tmdbId ?? 0);
                      const hasPrioInt = Boolean(sItem.hasPriorityInternalGaps ?? sItem.hasInternalGaps);
                      const totInt = Number(sItem.totalInternalMissing ?? sItem.internalMissingCount ?? 0);
                      const totTrail = Number(sItem.totalTrailingMissing ?? sItem.trailingMissingCount ?? 0);
                      const totPre = Number(sItem.totalPrerelease ?? sItem.prereleaseCount ?? 0);
                      const pImg = resolvePosterUrlClient(sItem.poster, "w185", "");
                      return '<div class="admin-surface-card" style="' + (hasPrioInt ? 'border-color:rgba(239,68,68,0.55);' : '') + 'padding:11px;display:flex;flex-direction:column;gap:8px">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
                          '<div style="display:flex;align-items:center;gap:10px;min-width:200px;flex:1">' +
                            (pImg
                              ? '<img src="' + esc(pImg) + '" style="width:38px;height:56px;object-fit:cover;border-radius:5px;flex-shrink:0" alt="" />'
                              : '<div style="width:38px;height:56px;background:#1e293b;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📺</div>') +
                            '<div>' +
                              '<div style="font-size:13.5px;font-weight:900;color:var(--text);display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                                esc(sItem.title) + ' <span style="color:var(--muted);font-weight:600;font-size:12px">(' + esc(sItem.year || 'k.A.') + ' • TMDb #' + seriesIdVal + ')</span>' +
                                (hasPrioInt ? '<span style="background:rgba(239,68,68,0.18);color:#dc2626;border:1px solid rgba(239,68,68,0.5);padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:800">🚨 LÜCKE MITTEN IN DER STAFFEL/SERIE (' + totInt + ' fehlt)</span>' : '') +
                              '</div>' +
                              '<div style="font-size:11.5px;color:var(--muted);margin-top:3px">' +
                                'Innerhalb der Staffel/Serie fehlend: <b style="color:#dc2626">' + totInt + '</b> • Am Staffelende offen: <b style="color:#0284c7">' + totTrail + '</b>' +
                                (totPre > 0 ? (' • Nur Vorabversion/TS/MD: <b style="color:#d97706">' + totPre + '</b>') : '') +
                              '</div>' +
                            '</div>' +
                          '</div>' +
                          '<button class="btn blue" onclick="openDetails(\\'s\\',' + seriesIdVal + ',false)">📺 Serie öffnen</button>' +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;gap:6px">' +
                          (sItem.seasons || []).map(sec => {
                            const intList = sec.internalGaps || sec.internalMissingEpisodes || [];
                            const trailList = sec.trailingMissing || sec.trailingMissingEpisodes || [];
                            const preList = sec.prereleaseEpisodes || [];
                            const upList = sec.uploadedEpisodes || sec.presentEpisodes || [];
                            const upCount = Number(sec.uploadedCount ?? sec.uploadedEpisodesCount ?? upList.length);
                            const intCodes = intList.map(epN => 'S' + String(sec.seasonNumber).padStart(2, '0') + 'E' + String(epN).padStart(2, '0'));
                            const trailCodes = trailList.map(epN => 'S' + String(sec.seasonNumber).padStart(2, '0') + 'E' + String(epN).padStart(2, '0'));
                            const preCodes = preList.map(epN => 'S' + String(sec.seasonNumber).padStart(2, '0') + 'E' + String(epN).padStart(2, '0'));
                            const upCodes = upList.map(epN => 'E' + String(epN).padStart(2, '0'));
                            const isMissingWholeSeason = Boolean(sec.isCompletelyMissingSeason);
                            return '<div class="admin-sub-box" style="' + (isMissingWholeSeason ? 'border-color:rgba(239,68,68,0.45);' : '') + 'padding:8px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                              '<div style="flex:1;min-width:210px;font-size:11.5px">' +
                                '<div style="font-weight:800;color:var(--text);margin-bottom:3px">' +
                                  'Staffel ' + Number(sec.seasonNumber) +
                                  (isMissingWholeSeason
                                    ? ' <span style="color:#dc2626;font-weight:800">(0 / ' + Number(sec.expectedTotalEpisodes) + ' Folgen vorhanden – komplette Zwischen-Staffel fehlt!)</span>'
                                    : ' <span style="color:#10b981;font-weight:700">(' + upCount + ' / ' + Number(sec.expectedTotalEpisodes) + ' Folgen vorhanden: ' + esc(upCodes.slice(0, 12).join(', ')) + (upCodes.length > 12 ? '…' : '') + ')</span>') +
                                '</div>' +
                                (intCodes.length > 0 ? (
                                  '<div style="color:#dc2626;margin-top:2px">🚨 <b>' + (isMissingWholeSeason ? ('Komplette Staffel ' + Number(sec.seasonNumber) + ' fehlt mitten in der Serie:') : ('Fehlt mitten in Staffel ' + Number(sec.seasonNumber) + ' (vor E' + String(sec.maxUploadedEp).padStart(2, '0') + '):')) + '</b> <code style="background:rgba(239,68,68,0.16);color:#dc2626;padding:1px 6px;border-radius:4px;font-weight:800">' + esc(intCodes.slice(0, 16).join(', ')) + (intCodes.length > 16 ? (' +' + (intCodes.length - 16) + ' weitere') : '') + '</code></div>'
                                ) : '') +
                                (trailCodes.length > 0 ? (
                                  '<div style="color:#0284c7;margin-top:2px">⏳ <b>Fehlt ab E' + String(Number(sec.maxUploadedEp || 0) + 1).padStart(2, '0') + ' bis Staffelende:</b> <code style="background:rgba(2,132,199,0.12);color:#0284c7;padding:1px 6px;border-radius:4px">' + esc(trailCodes.slice(0, 15).join(', ')) + (trailCodes.length > 15 ? (' +' + (trailCodes.length - 15) + ' weitere') : '') + '</code></div>'
                                ) : '') +
                                (preCodes.length > 0 ? (
                                  '<div style="color:#d97706;margin-top:2px">⚠️ <b>Nur als Vorabversion / TS / MD vorhanden (wird bei gutem Upload automatisch ersetzt):</b> <code style="background:rgba(245,158,11,0.16);color:#d97706;padding:1px 6px;border-radius:4px">' + esc(preCodes.join(', ')) + '</code></div>'
                                ) : '') +
                              '</div>' +
                              '<button class="btn" style="padding:4px 9px;font-size:11px" onclick="openDetails(\\'s\\',' + seriesIdVal + ',false,\\'\\',\\'\\',' + Number(sec.seasonNumber) + ')">Staffel ' + Number(sec.seasonNumber) + ' öffnen</button>' +
                            '</div>';
                          }).join("") +
                        '</div>' +
                      '</div>';
                    }).join("") +
                  '</div>';
                })()) +
              '</div>'
            ) : state.adminTab === "diaglog" ? (
              renderImportDiagnosticLogBoxHtml()
            ) : state.adminTab === "backup" ? (
              '<div id="adminJsonImportPanelBox" class="panel-box" style="border-color:rgba(14,165,233,0.35);transition:box-shadow 0.2s ease">' +
                '<div id="adminJsonImportDragHandle" class="admin-drag-handle" data-drag-handle="true" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(148,163,184,0.16)" title="Klicken & Ziehen zum freien Verschieben des JSON-Import-Panels">' +
                  '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                    '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;padding:3px 8px;border-radius:6px;background:rgba(14,165,233,0.16);border:1px solid rgba(56,189,248,0.35);color:#38bdf8">⠿ Verschieben</span>' +
                    '<div>' +
                      '<div style="font-size:14px;font-weight:900;color:var(--text)">📦 JSON-Backup-Import & Ziel-Playlist-Steuerung</div>' +
                      '<div style="font-size:11.5px;color:var(--muted)">1. Quell-Kanal verifizieren · 2. JSON-Backup wählen · 3. Ziel-Account, Playlist, Modus & Name festlegen</div>' +
                    '</div>' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button type="button" class="btn" onclick="resetAdminJsonImportDragClient()" title="Position zurücksetzen">↺ Position</button>' +
                    '<button type="button" id="adminJsonImportCollapseBtn" class="btn" onclick="toggleAdminJsonImportCollapseClient()" title="Import-Panel kompakt einklappen">' + (adminJsonImportPanelCollapsed ? '▾ Ausklappen' : '▴ Einklappen') + '</button>' +
                    '<button type="button" class="btn" onclick="runSimulatedJsonImportTestSuiteClient()" title="Testet die Import-Pipeline mit 7 Testfällen">🧪 E2E-Test</button>' +
                    '<button type="button" class="btn" onclick="openLargeJsonHowToModalClient()">✂️ &gt;200 MB Hilfe</button>' +
                  '</div>' +
                '</div>' +
                '<div id="adminJsonImportPanelBody" style="display:' + (adminJsonImportPanelCollapsed ? 'none' : 'block') + '">' +

                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:10px;margin-bottom:10px">' +
                  '<div class="backup-step-card">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">' +
                      '<span style="font-size:12px;font-weight:800;color:var(--blue)">1️⃣ Quell-Kanal verifizieren</span>' +
                      (isChanReady ? '<span style="font-size:10.5px;font-weight:800;color:#10b981">✅ Freigeschaltet</span>' : '<span style="font-size:10.5px;color:#f59e0b">Pflichtschritt</span>') +
                    '</div>' +
                    '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                      '<input id="backupSourceChannelInp" class="backup-input" value="' + esc(savedChanVal) + '" placeholder="-1001234567890 oder https://t.me/c/1234567890/42" style="flex:1;min-width:170px;font-family:monospace" />' +
                      '<input id="backupSampleMsgIdInp" class="backup-input" type="number" placeholder="Msg-ID (opt.)" style="width:105px;font-family:monospace" />' +
                      '<button class="btn green" onclick="verifyBackupChannelClient()">🔍 Kanal prüfen</button>' +
                    '</div>' +
                    '<div id="backupChannelVerifyBanner" style="display:' + (isChanReady ? 'block' : 'none') + ';padding:5px 9px;border-radius:6px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);font-size:11px;color:#10b981">' +
                      (isChanReady ? ('✅ Quell-Kanal aktiv: <code>' + esc(savedChanVal) + '</code> — Schritt 2 freigeschaltet!') : '') +
                    '</div>' +
                  '</div>' +

                  '<div class="backup-step-card">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">' +
                      '<span style="font-size:12px;font-weight:800;color:#10b981">2️⃣ JSON-Backup-Datei auswählen</span>' +
                      '<span style="font-size:10.5px;color:var(--muted)">Telegram <code>result.json</code> oder Titelliste</span>' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                      '<input id="backupJsonFileInputEl" class="backup-input" type="file" accept=".json,application/json" ' + (!isChanReady ? 'disabled' : '') + ' onchange="handleBackupFileInput(event)" style="flex:1;min-width:200px;opacity:' + (isChanReady ? '1' : '0.45') + '" />' +
                    '</div>' +
                    '<div id="backupParseNotice" style="font-size:11.5px;color:#f59e0b;min-height:16px"></div>' +
                  '</div>' +
                '</div>' +

                '<div class="backup-step-card" style="margin-bottom:10px">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                    '<span style="font-size:12px;font-weight:800;color:var(--blue)">3️⃣ Ziel-Playlist & Modus festlegen (Wo soll die Liste reingeladen werden?)</span>' +
                    '<span style="font-size:11px;color:var(--muted)">Wähle Account, bestehende Playlist oder lege eine neue Playlist an</span>' +
                  '</div>' +
                  '<div id="backupTargetControlsMount">' +
                    renderBackupTargetControlsHtml() +
                  '</div>' +
                '</div>' +

                '<div id="e2eSimReportMount" style="display:' + (window._lastE2eSimReportHtml ? 'block' : 'none') + ';margin-top:10px">' + (window._lastE2eSimReportHtml || '') + '</div>' +
                '<div id="backupImportLiveMount" style="margin-top:10px"></div>' +
                (qStats.pendingCount > 0 ? (
                  '<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(148,163,184,0.18);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
                    '<div style="font-size:12px;font-weight:800;color:#f59e0b">📥 Server-Queue (vom Bot hochgeladen): ' + qStats.pendingCount + ' offen</div>' +
                    '<div style="display:flex;gap:8px">' +
                      '<button class="btn green" onclick="runServerD1QueueStepAdmin(2)">▶️ Nächste verarbeiten</button>' +
                      '<button class="btn danger" onclick="clearServerD1QueueAdmin()">🗑️ Queue leeren</button>' +
                    '</div>' +
                  '</div>'
                ) : '') +
                '</div>' +
              '</div>'
            ) : (
              '<div class="panel-box">' +
                '<div class="section-title"><span>➕ Film oder Serie in D1 anlegen / bearbeiten (CRUD)</span></div>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px">' +
                  '<select id="crudTypeSel" class="tma-select" style="padding:8px">' +
                    '<option value="m" ' + (state.adminMediaType === 'm' ? 'selected' : '') + '>🎬 Film (movies)</option>' +
                    '<option value="s" ' + (state.adminMediaType === 's' ? 'selected' : '') + '>📺 Serie (series)</option>' +
                  '</select>' +
                  '<input id="crudTmdbIdInp" class="tma-input" placeholder="TMDB-ID (z.B. 603)" style="padding:8px" />' +
                  '<input id="crudTitleInp" class="tma-input" placeholder="Sauberer Titel (optional bei TMDB-Auto)" style="padding:8px" />' +
                  '<input id="crudYearInp" class="tma-input" placeholder="Release-Jahr (z.B. 1999)" style="padding:8px" />' +
                  '<input id="crudFileIdInp" class="tma-input" placeholder="Optionale telegram_file_id" style="padding:8px" />' +
                  '<input id="crudQualityInp" class="tma-input" placeholder="Qualität (z.B. 1080p / 4K)" value="1080p" style="padding:8px" />' +
                  '<input id="crudFileSizeInp" class="tma-input" placeholder="Dateigröße (z.B. 2.45 GB / 890 MB)" style="padding:8px" />' +
                  '<input id="crudTagsInp" class="tma-input" placeholder="Tags (z.B. DE · DL · HDR · BluRay)" style="padding:8px" />' +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                  '<button class="btn green" onclick="submitAdminMediaCrud()">💾 In D1 speichern / von TMDB synchronisieren</button>' +
                  '<button class="btn purple" onclick="openManualNoTmdbConfirmForCrudClient()">✨ Ohne TMDb-ID manuell anlegen</button>' +
                  '<button class="btn ' + (state.adminMediaType === 'm' ? 'active' : '') + '" onclick="state.adminMediaType=\\'m\\';loadAdminPanelView()">🎬 Filme in D1 zeigen</button>' +
                  '<button class="btn ' + (state.adminMediaType === 's' ? 'active' : '') + '" onclick="state.adminMediaType=\\'s\\';loadAdminPanelView()">📺 Serien in D1 zeigen</button>' +
                '</div>' +
                '<div style="margin-top:14px">' +
                  mediaList.map(m => '<div class="ep-row">' +
                    '<div class="ep-title" onclick="openDetails(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ',false)">' +
                      '<b>#' + m.tmdb_id + ' – ' + esc(m.title) + '</b> (' + esc(m.release_year || 'k.A.') + ') • ⭐ ' + Number(m.vote_average || 0).toFixed(1) + ' • ' + esc(m.genres || '') +
                    '</div>' +
                    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                      '<button class="btn purple" onclick="openDetailsWithAdminTool(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ',\\'poster\\')" title="Cover/Poster ändern">🖼️ Cover</button>' +
                      '<button class="btn blue" onclick="openDetailsWithAdminTool(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ',\\'remap\\')" title="Titel neu zuordnen & Original-Link prüfen">🔄 Neu zuordnen</button>' +
                      '<button class="btn danger" onclick="deleteAdminMediaCrud(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ')">🗑️ Löschen</button>' +
                    '</div>' +
                  '</div>').join("") +
                '</div>' +
              '</div>'
            )) +
          '</div>';
          if (state.adminTab === "backup") {
            renderBackupImportBoxDom();
          }
          if (typeof pollAntiSpamQueueClient === "function") {
            pollAntiSpamQueueClient(true);
          }
        } finally {
          setBusyState(false);
        }
      }

      async function openReportCorrectionWorkflowByIdClient(reportId) {
        const list = Array.isArray(window._adminReportsCache) ? window._adminReportsCache : [];
        const found = list.find(r => Number(r?.id) === Number(reportId));
        if (!found) {
          showHudToast("⚠️ Meldung #" + reportId + " nicht im Cache gefunden.");
          return;
        }
        await openReportCorrectionWorkflowClient(found);
      }

      async function toggleUserVipAdmin(targetTelegramId, nextVipState) {
        const r = await apiFetchJson(API_BASE + "/admin/vip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegramId: targetTelegramId, isVip: Boolean(nextVipState) })
        });
        if (!r || !r.ok) {
          showHudToast("⚠️ " + (r?.error || "VIP-Status konnte nicht gespeichert werden."));
          return;
        }
        if (r.user && state.authUser && String(state.authUser.telegramId) === String(targetTelegramId)) {
          state.authUser = r.user;
          updateSyncBadge();
        }
        clearClientMediaCaches();
        showHudToast(nextVipState ? "🌟 VIP-Status aktiviert" : "⚪ VIP-Status entzogen");
        loadAdminPanelView();
      }

      async function submitAdminMediaCrud() {
        const typeCode = document.getElementById("crudTypeSel")?.value || "m";
        const tmdbId = document.getElementById("crudTmdbIdInp")?.value.trim() || "";
        const title = document.getElementById("crudTitleInp")?.value.trim() || "";
        const year = document.getElementById("crudYearInp")?.value.trim() || "";
        const fileId = document.getElementById("crudFileIdInp")?.value.trim() || "";
        const quality = document.getElementById("crudQualityInp")?.value.trim() || "1080p";
        const fileSize = document.getElementById("crudFileSizeInp")?.value.trim() || "";
        const tags = document.getElementById("crudTagsInp")?.value.trim() || "";
        if (!tmdbId && !title) {
          showHudToast("⚠️ Bitte mindestens eine TMDB-ID oder einen Titel angeben.");
          return;
        }
        setBusyState(true, "💾 Speichere Eintrag in D1...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "upsert", typeCode, tmdbId, title, year, fileId, quality, fileSize, tags })
          });
          clearClientMediaCaches();
          if (!r || !r.ok) showHudToast("⚠️ " + (r?.error || "Fehler beim Speichern"));
          else showHudToast("✅ Eintrag in D1 gespeichert");
          state.adminMediaType = typeCode;
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function deleteAdminMediaCrud(typeCode, tmdbId) {
        const ok = await showCustomConfirm("Diesen Titel (#" + tmdbId + ") wirklich aus D1 löschen?", "🗑️ Löschen");
        if (!ok) return;
        const r = await apiFetchJson(API_BASE + "/admin/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", typeCode, tmdbId })
        });
        if (!r || !r.ok) {
          showHudToast("⚠️ " + (r?.error || "Löschen aus D1 fehlgeschlagen."));
          return;
        }
        clearClientMediaCaches();
        showHudToast("🗑️ Eintrag #" + tmdbId + " gelöscht");
        loadAdminPanelView();
      }

      async function startTmdbAuth() {
        const st = document.getElementById("tmdbSyncStatus");
        if (st) st.textContent = "⏳ Erstelle TMDB-Freigabelink...";
        const r = await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "create_token" }) });
        if (r.ok && r.requestToken) {
          state.pendingTmdbToken = r.requestToken;
          if (tg && tg.openLink) tg.openLink(r.authUrl);
          else window.open(r.authUrl, "_blank");
          loadSettingsView();
          const st2 = document.getElementById("tmdbSyncStatus");
          if (st2) st2.textContent = "👉 Bitte im geöffneten TMDB-Fenster auf 'Approve / Zulassen' tippen und danach auf '✅ 2. Nach Freigabe hier bestätigen' klicken.";
        } else if (st) {
          st.textContent = "⚠️ Fehler: " + (r.error || "Token konnte nicht erstellt werden.");
        }
      }
      async function completeTmdbAuth() {
        const st = document.getElementById("tmdbSyncStatus");
        if (st) st.textContent = "⏳ Verbinde TMDB-Konto & synchronisiere Merkliste...";
        const r = await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "create_session", requestToken: state.pendingTmdbToken }) });
        if (r.ok) {
          state.pendingTmdbToken = "";
          await loadSettingsView();
          const st2 = document.getElementById("tmdbSyncStatus");
          if (st2) st2.textContent = "✅ Verbunden! " + (r.syncResult?.importedCount || 0) + " Titel von TMDB importiert & " + (r.syncResult?.pushedCount || 0) + " zu TMDB übertragen.";
        } else if (st) {
          st.textContent = "⚠️ " + (r.error || "Freigabe wurde auf TMDB noch nicht bestätigt.");
        }
      }
      async function runTmdbSyncNow() {
        const st = document.getElementById("tmdbSyncStatus");
        if (st) st.textContent = "⏳ Synchronisiere mit TMDB...";
        const r = await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "sync_now" }) });
        if (st) {
          st.textContent = r.ok
            ? ("✅ Sync abgeschlossen: " + r.importedCount + " neu von TMDB importiert, " + r.pushedCount + " zu TMDB übertragen.")
            : ("⚠️ " + (r.error || "Synchronisierung fehlgeschlagen."));
        }
      }
      async function disconnectTmdbSync() {
        await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "disconnect" }) });
        loadSettingsView();
      }

      async function initAuthSession() {
        try {
          if (!rawInitData && typeof extractClientTelegramInitData === "function") {
            rawInitData = extractClientTelegramInitData();
          }
          if (!rawLaunchToken && typeof extractClientTelegramLaunchToken === "function") {
            rawLaunchToken = extractClientTelegramLaunchToken();
          }
          let loggedInViaInitOrLaunch = false;
          if (rawInitData || rawLaunchToken) {
            const r = await apiFetchJson(API_BASE + "/auth/init", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ initData: rawInitData || "", tgLaunch: rawLaunchToken || "" })
            });
            if (r && r.ok && r.user) {
              sessionToken = r.sessionToken || sessionToken;
              try { if (sessionToken) localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
              state.isAuthenticated = true;
              state.hasInitData = true;
              state.authUser = r.user;
              chatId = String(r.user.telegramId);
              loggedInViaInitOrLaunch = true;
            }
          }
          if (!loggedInViaInitOrLaunch && sessionToken) {
            const r = await apiFetchJson(API_BASE + "/auth/me");
            if (r && r.ok && r.isAuthenticated && r.user) {
              state.isAuthenticated = true;
              state.hasInitData = Boolean(r.hasInitData);
              state.authUser = r.user;
              chatId = String(r.user.telegramId);
            } else {
              sessionToken = "";
              try { localStorage.removeItem("tma_session_token"); } catch (e) {}
              state.isAuthenticated = false;
              state.authUser = null;
              chatId = "guest";
            }
          } else if (!loggedInViaInitOrLaunch) {
            state.isAuthenticated = false;
            state.authUser = null;
            chatId = "guest";
          }
        } catch (e) {
          state.isAuthenticated = false;
          state.authUser = null;
          chatId = "guest";
        }
        updateSyncBadge();
        await loadDiscover("m", "all", "trend", "pop_desc");
        if (typeof dismissBootSplashscreen === "function") {
          dismissBootSplashscreen();
        }

        // Deep-Link Unterstützung (aus dem Bot -> direkt zur entsprechenden Ansicht in der Mini-App!)
        let deepLinkOpened = false;
        try {
          const params = new URLSearchParams(window.location.search);
          const startParam = String(tg?.initDataUnsafe?.start_param || params.get("tgWebAppStartParam") || "").trim();
          const openCol = params.get("openCol") || (startParam.startsWith("col_") ? startParam.replace("col_", "") : "");
          const openUni = params.get("openUni") || (startParam.startsWith("uni_") ? startParam.replace("uni_", "") : "");
          const openPerson = params.get("openPerson") || "";
          const directOpenType = params.get("openType") || "";
          const directOpenId = params.get("openId") || "";
          const openItem = params.get("openItem")
            || ((directOpenType === "m" || directOpenType === "s") && directOpenId ? (directOpenType + "_" + directOpenId) : "")
            || ((startParam.startsWith("m_") || startParam.startsWith("s_")) ? startParam : "");

          if (openCol) {
            deepLinkOpened = true;
            await openCollectionView(openCol, "year_asc");
          } else if (openUni) {
            deepLinkOpened = true;
            await openUniverseView(openUni, "year_asc");
          } else if (openPerson) {
            deepLinkOpened = true;
            const pInput = document.getElementById("searchInput");
            if (pInput) pInput.value = openPerson;
            await runSearch(false, openPerson, "person");
          } else if (openItem && openItem.includes("_")) {
            const [tCode, tId] = openItem.split("_");
            if ((tCode === "m" || tCode === "s") && tId) {
              deepLinkOpened = true;
              await openDetails(tCode, tId);
            }
          } else if (startParam === "wishlist") {
            deepLinkOpened = true;
            await loadWishlist("root");
          } else if (startParam === "settings") {
            deepLinkOpened = true;
            await loadSettingsView();
          }
        } catch (e) {}

        // Standard-Auswahl beim Öffnen der App liegt direkt auf dem Suchfeld (#searchInput)
        if (!deepLinkOpened) {
          const defaultSearchInp = document.getElementById("searchInput");
          if (defaultSearchInp && typeof setSpatialFocus === "function") {
            setSpatialFocus(defaultSearchInp, false);
          }
        }
      }
