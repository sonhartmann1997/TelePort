      // =========================================================================
      // GRANULARER "FOLGEN KORRIGIEREN"-DIALOG & "FEHLER MELDEN"-MODAL (CLIENT)
      // =========================================================================
      let activeEpisodeCorrectionState = null;
      let activeMediaReportState = null;
      let activeEpisodeStoryState = null;
      let lastSubModalTriggerEl = null;

      function ensureSubModalMountClient() {
        let el = document.getElementById("subModalOverlayRoot");
        if (!el) {
          el = document.createElement("div");
          el.id = "subModalOverlayRoot";
          document.body.appendChild(el);
        }
        if (!el.innerHTML.trim()) {
          const curEl = (typeof currentSpatialEl !== "undefined" && currentSpatialEl) ? currentSpatialEl : document.activeElement;
          if (curEl && curEl !== document.body && !el.contains(curEl)) {
            lastSubModalTriggerEl = curEl;
          }
        }
        return el;
      }

      function closeSubModalOverlayClient() {
        const el = document.getElementById("subModalOverlayRoot");
        if (el) el.innerHTML = "";
        activeEpisodeCorrectionState = null;
        activeMediaReportState = null;
        activeEpisodeStoryState = null;
        if (lastSubModalTriggerEl && document.body.contains(lastSubModalTriggerEl) && typeof jumpSpatialFocus === "function") {
          const restoreEl = lastSubModalTriggerEl;
          lastSubModalTriggerEl = null;
          setTimeout(() => jumpSpatialFocus(restoreEl, false), 20);
        }
      }

      function stepEpisodeCorrectionNumberClient(inputId, delta, minVal = 1, maxVal = 999) {
        const inp = document.getElementById(inputId);
        if (!inp) return;
        const parsedCur = Number(inp.value);
        const cur = (inp.value !== "" && Number.isFinite(parsedCur)) ? parsedCur : minVal;
        const nextVal = Math.min(maxVal, Math.max(minVal, cur + Number(delta || 0)));
        inp.value = String(nextVal);
        updateEpisodeCorrectionLivePreviewClient();
      }

      function switchEpisodeCorrectionTargetFileClient(fileIndexStr) {
        if (!activeEpisodeCorrectionState) return;
        const idx = Number(fileIndexStr);
        const allAdminFiles = (Array.isArray(state.activeDetails?.allStreamFiles) ? state.activeDetails.allStreamFiles : [])
          .slice()
          .sort((a, b) => {
            const sa = Number(a.season_number ?? 1);
            const sb = Number(b.season_number ?? 1);
            if (sa !== sb) return sa - sb;
            return Number(a.episode_number ?? 1) - Number(b.episode_number ?? 1);
          });
        const f = allAdminFiles[idx];
        if (!f) return;
        const sNum = Math.max(0, Number(f.season_number ?? 1));
        const eNum = Math.max(0, Number(f.episode_number ?? 1));
        const epTitle = resolveClientEpisodeTitle(activeEpisodeCorrectionState.tmdbId, sNum, eNum, f);
        activeEpisodeCorrectionState.season = sNum;
        activeEpisodeCorrectionState.episode = eNum;
        activeEpisodeCorrectionState.targetSeason = sNum;
        activeEpisodeCorrectionState.targetEpisode = eNum;
        activeEpisodeCorrectionState.episodeTitle = epTitle;
        activeEpisodeCorrectionState.telegramFileId = String(f.telegram_file_id || "");
        activeEpisodeCorrectionState.versionLabel = String(f.versionLabel || f.version_label || f.tags || "Originalfassung");
        activeEpisodeCorrectionState.targetVersionLabel = activeEpisodeCorrectionState.versionLabel;
        activeEpisodeCorrectionState.quality = String(f.quality || "1080p");
        activeEpisodeCorrectionState.rawFilename = String(f.raw_filename || "");
        activeEpisodeCorrectionState.messageLink = String(f.message_link || "");
        renderEpisodeCorrectionModalDomClient();
      }

      function updateEpisodeCorrectionLivePreviewClient() {
        const st = activeEpisodeCorrectionState;
        if (!st) return;
        if (st.mode === "move_se") {
          const sValRaw = document.getElementById("epCorrNewSeasonInp")?.value;
          const eValRaw = document.getElementById("epCorrNewEpisodeInp")?.value;
          st.targetSeason = Math.max(0, (sValRaw !== undefined && sValRaw !== "") ? Number(sValRaw) : Number(st.season ?? 1));
          st.targetEpisode = Math.max(1, (eValRaw !== undefined && eValRaw !== "") ? Number(eValRaw) : Number(st.episode ?? 1));
        } else if (st.mode === "change_version") {
          st.targetVersionLabel = String(document.getElementById("epCorrVersionInp")?.value || st.versionLabel || "Originalfassung").trim();
        } else if (st.mode === "relink_tmdb") {
          st.selectedNewTypeCode = document.getElementById("epCorrNewTypeSel")?.value === "m" ? "m" : "s";
          st.selectedNewTmdbId = Number(document.getElementById("epCorrNewTmdbIdInp")?.value || st.selectedNewTmdbId || 0);
          const rsValRaw = document.getElementById("epCorrRelinkSeasonInp")?.value;
          const reValRaw = document.getElementById("epCorrRelinkEpisodeInp")?.value;
          st.targetSeason = Math.max(0, (rsValRaw !== undefined && rsValRaw !== "") ? Number(rsValRaw) : Number(st.season ?? 1));
          st.targetEpisode = Math.max(1, (reValRaw !== undefined && reValRaw !== "") ? Number(reValRaw) : Number(st.episode ?? 1));
        }
        const previewEl = document.getElementById("epCorrTargetPreviewCard");
        if (previewEl) {
          previewEl.innerHTML = buildEpisodeCorrectionTargetCardInnerHtmlClient(st);
          if (typeof window.refreshModalAndEpisodeMarquees === "function") {
            window.refreshModalAndEpisodeMarquees(previewEl);
          }
        }
      }

      function buildEpisodeCorrectionTargetCardInnerHtmlClient(st) {
        const nextS = Number(st.targetSeason ?? st.season ?? 1);
        const nextE = Number(st.targetEpisode ?? st.episode ?? 1);
        const nextCode = st.typeCode === "s" ? ("S" + String(nextS).padStart(2, "0") + "E" + String(nextE).padStart(2, "0")) : "🎬 Film";
        const nextVer = String(st.targetVersionLabel || st.versionLabel || "Originalfassung");

        if (st.mode === "move_se") {
          const resolvedTargetEpTitle = resolveClientEpisodeTitle(st.tmdbId, nextS, nextE, null);
          const hasChanged = nextS !== st.season || nextE !== st.episode;
          return '<div style="font-size:10px;font-weight:800;color:#38bdf8;text-transform:uppercase;letter-spacing:0.4px">🎯 Neues Ziel (Nachher)</div>' +
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
              '<span class="ep-code-badge" style="' + (hasChanged ? 'background:rgba(16,185,129,0.22);border-color:#34d399;color:#6ee7b7' : '') + '">' + esc(nextCode) + '</span>' +
              '<div class="inline-marquee-wrap" data-marquee-always="1"><span class="inline-marquee-text" style="font-size:12.5px">' + esc(resolvedTargetEpTitle) + '</span></div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--muted)">Serie: <b>' + esc(st.title) + '</b> • Fassung bleibt: <b>' + esc(st.versionLabel) + '</b></div>' +
            (hasChanged
              ? '<div style="font-size:11px;color:#34d399;font-weight:700">✓ Verschiebt S' + String(st.season).padStart(2, '0') + 'E' + String(st.episode).padStart(2, '0') + ' ➔ ' + esc(nextCode) + '</div>'
              : '<div style="font-size:11px;color:#94a3b8">Wähle unten die gewünschte Ziel-Staffel & Ziel-Folge.</div>');
        }
        if (st.mode === "change_version") {
          const hasChanged = nextVer !== st.versionLabel;
          return '<div style="font-size:10px;font-weight:800;color:#38bdf8;text-transform:uppercase;letter-spacing:0.4px">🎯 Neues Ziel (Nachher)</div>' +
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
              '<span class="ep-code-badge">' + esc(nextCode) + '</span>' +
              '<span class="flix-version-badge">🎞️ ' + esc(nextVer) + '</span>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--muted)">Folge: <b>' + esc(st.episodeTitle || nextCode) + '</b> (' + esc(st.quality) + ')</div>' +
            (hasChanged
              ? '<div style="font-size:11px;color:#34d399;font-weight:700">✓ Neue Schnittfassung: ' + esc(nextVer) + '</div>'
              : '<div style="font-size:11px;color:#94a3b8">Wähle unten eine Vorlage oder gib einen eigenen Versionsnamen ein.</div>');
        }
        const scopeTxt = st.relinkScope === "entire_series"
          ? "📦 Ganze Serie / Alle Folgen umziehen"
          : ("🎯 Nur " + esc(nextCode) + " einzeln zuweisen");
        const targetCodeBadge = st.selectedNewTypeCode === "s"
          ? ("S" + String(nextS).padStart(2, "0") + "E" + String(nextE).padStart(2, "0"))
          : "🎬 Spielfilm";
        return '<div style="font-size:10px;font-weight:800;color:#38bdf8;text-transform:uppercase;letter-spacing:0.4px">🎯 Neues Ziel (Nachher)</div>' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
            '<span class="ep-code-badge" style="background:rgba(16,185,129,0.22);border-color:#34d399;color:#6ee7b7">' + esc(targetCodeBadge) + '</span>' +
            '<div class="inline-marquee-wrap" data-marquee-always="1"><span class="inline-marquee-text" style="font-size:12.5px">' + esc(st.selectedNewTitle || "Ziel wählen") + ' (#' + Number(st.selectedNewTmdbId || 0) + ')</span></div>' +
          '</div>' +
          '<div style="font-size:11px;color:#38bdf8;font-weight:700">' + scopeTxt + '</div>';
      }

      function openEpisodeCorrectionModal(opts) {
        if (!state.authUser?.isAdmin) {
          showHudToast("⛔ Nur Administratoren können Folgen und Dateien umsortieren.");
          return;
        }
        const typeCode = opts?.typeCode === "m" ? "m" : "s";
        const tmdbId = Number(opts?.tmdbId || state.activeDetails?.id || 0);
        const title = String(opts?.title || state.activeDetails?.title || "Titel");
        const season = Math.max(0, Number(opts?.season !== undefined && opts?.season !== null ? opts.season : 1));
        const episode = Math.max(0, Number(opts?.episode !== undefined && opts?.episode !== null ? opts.episode : 1));
        const telegramFileId = String(opts?.telegramFileId || "");
        const versionLabel = String(opts?.versionLabel || "Originalfassung");
        const quality = String(opts?.quality || "1080p");
        const reportId = Number(opts?.reportId || 0);

        let rawFilename = String(opts?.rawFilename || "");
        let messageLink = String(opts?.messageLink || "");
        const allAdminFiles = Array.isArray(state.activeDetails?.allStreamFiles) ? state.activeDetails.allStreamFiles : [];
        const matchedRow = allAdminFiles.find(f =>
          (telegramFileId && String(f.telegram_file_id) === telegramFileId) ||
          (typeCode === "s" && Number(f.season_number) === season && Number(f.episode_number) === episode)
        );
        if (matchedRow) {
          if (!rawFilename && matchedRow.raw_filename) rawFilename = matchedRow.raw_filename;
          if (!messageLink && matchedRow.message_link) messageLink = matchedRow.message_link;
        }

        const episodeTitle = String(opts?.episodeTitle || "").trim() ||
          (typeCode === "s" ? resolveClientEpisodeTitle(tmdbId, season, episode, matchedRow) : title);

        const initialMode = typeCode === "m" ? "relink_tmdb" : (opts?.initialMode || "move_se");
        activeEpisodeCorrectionState = {
          typeCode,
          tmdbId,
          title,
          season,
          episode,
          targetSeason: season,
          targetEpisode: episode,
          episodeTitle,
          telegramFileId,
          versionLabel,
          targetVersionLabel: versionLabel,
          quality,
          rawFilename,
          messageLink,
          reportId,
          mode: initialMode,
          relinkScope: "single_episode",
          selectedNewTmdbId: tmdbId,
          selectedNewTypeCode: typeCode,
          selectedNewTitle: title
        };

        renderEpisodeCorrectionModalDomClient();
      }

      function switchEpisodeCorrectionModeClient(nextMode) {
        if (!activeEpisodeCorrectionState) return;
        activeEpisodeCorrectionState.mode = nextMode;
        renderEpisodeCorrectionModalDomClient();
      }

      function renderEpisodeCorrectionModalDomClient() {
        const st = activeEpisodeCorrectionState;
        if (!st) return;
        const mount = ensureSubModalMountClient();
        const epCodeOnly = st.typeCode === "s"
          ? ('S' + String(st.season).padStart(2, '0') + 'E' + String(st.episode).padStart(2, '0'))
          : '🎬 Film';

        const allAdminFiles = (Array.isArray(state.activeDetails?.allStreamFiles) ? state.activeDetails.allStreamFiles : [])
          .slice()
          .sort((a, b) => {
            const sa = Number(a.season_number ?? 1);
            const sb = Number(b.season_number ?? 1);
            if (sa !== sb) return sa - sb;
            return Number(a.episode_number ?? 1) - Number(b.episode_number ?? 1);
          });

        const directEpisodeSwitcherHtml = (st.typeCode === "s" && allAdminFiles.length > 1) ? (
          '<div style="margin-bottom:10px;padding:8px 10px;border-radius:9px;background:rgba(15,23,42,0.65);border:1px solid rgba(148,163,184,0.22)">' +
            '<label style="font-size:11px;font-weight:800;color:#7dd3fc;display:block;margin-bottom:4px">📂 Folge / Datei direkt wechseln (' + allAdminFiles.length + ' Dateien in dieser Serie):</label>' +
            '<select class="tma-select" style="width:100%;padding:7px 9px;font-size:12px;font-weight:700" onchange="switchEpisodeCorrectionTargetFileClient(this.value)">' +
              allAdminFiles.map((f, idx) => {
                const sn = Number(f.season_number ?? 1);
                const en = Number(f.episode_number ?? 1);
                const code = "S" + String(sn).padStart(2, "0") + "E" + String(en).padStart(2, "0");
                const epT = resolveClientEpisodeTitle(st.tmdbId, sn, en, f);
                const isCur = (st.telegramFileId && String(f.telegram_file_id) === String(st.telegramFileId)) ||
                  (!st.telegramFileId && sn === st.season && en === st.episode);
                const fnShort = f.raw_filename ? (" • 📄 " + f.raw_filename) : "";
                return '<option value="' + idx + '" ' + (isCur ? 'selected' : '') + '>' +
                  esc(code + " – " + epT + " [" + (f.quality || "1080p") + " · " + (f.versionLabel || f.version_label || "Originalfassung") + "]" + fnShort) +
                '</option>';
              }).join("") +
            '</select>' +
          '</div>'
        ) : '';

        const VERSION_PRESETS = [
          "Netflix-Fassung",
          "Originalfassung",
          "TV-Schnitt",
          "DVD-Fassung",
          "Extended Cut",
          "Director's Cut",
          "Uncut"
        ];

        mount.innerHTML =
          '<div class="submodal-backdrop" onclick="if(event.target===this)closeSubModalOverlayClient()">' +
            '<div class="submodal-box" style="max-width:580px">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">' +
                '<div style="font-size:15px;font-weight:900;color:var(--text)">✏️ Folge / Datei gezielt zuordnen</div>' +
                '<button type="button" class="btn close-slate" onclick="closeSubModalOverlayClient()">✖</button>' +
              '</div>' +

              directEpisodeSwitcherHtml +

              /* Klare Vorher -> Nachher Vergleichsbox */
              '<div class="ep-remap-compare-grid">' +
                '<div class="ep-remap-card">' +
                  '<div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:0.4px">📍 Aktuell zugeordnet (Vorher)</div>' +
                  '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                    '<span class="ep-code-badge">' + esc(epCodeOnly) + '</span>' +
                    '<div class="inline-marquee-wrap" data-marquee-always="1"><span class="inline-marquee-text" style="font-size:12.5px">' + esc(st.episodeTitle || st.title) + '</span></div>' +
                  '</div>' +
                  '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:2px">' +
                    formatQualityBadgeHtmlClient(st.quality) +
                    '<span class="stream-meta-pill">' + esc(st.versionLabel) + '</span>' +
                    (st.reportId ? '<span class="stream-meta-pill" style="border-color:#10b981;color:#34d399">🚨 Meldung #' + st.reportId + '</span>' : '') +
                  '</div>' +
                  (st.rawFilename ? '<div style="margin-top:4px;font-family:monospace;font-size:10.5px;color:var(--text);word-break:break-all">📄 ' + esc(st.rawFilename) + '</div>' : '<div style="margin-top:4px;font-size:10.5px;color:var(--muted)">Serie: <b>' + esc(st.title) + '</b></div>') +
                  (st.messageLink ? '<div style="margin-top:2px"><a href="' + esc(safeHttpUrl(st.messageLink)) + '" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;font-size:11px;text-decoration:underline">🔗 Original-Nachricht in Telegram öffnen</a></div>' : '') +
                '</div>' +
                '<div class="ep-remap-compare-arrow">➔</div>' +
                '<div id="epCorrTargetPreviewCard" class="ep-remap-card target">' +
                  buildEpisodeCorrectionTargetCardInnerHtmlClient(st) +
                '</div>' +
              '</div>' +

              /* Modus-Umschalter im Ozean-Blau-Design */
              '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
                (st.typeCode === "s" ? (
                  '<button type="button" class="season-tab-btn ' + (st.mode === 'move_se' ? 'active' : '') + '" onclick="switchEpisodeCorrectionModeClient(\\'move_se\\')">🔢 Staffel & Folge anpassen</button>'
                ) : '') +
                '<button type="button" class="season-tab-btn ' + (st.mode === 'change_version' ? 'active' : '') + '" onclick="switchEpisodeCorrectionModeClient(\\'change_version\\')">🎞️ Version / Schnittfassung</button>' +
                '<button type="button" class="season-tab-btn ' + (st.mode === 'relink_tmdb' ? 'active' : '') + '" onclick="switchEpisodeCorrectionModeClient(\\'relink_tmdb\\')">🔄 Andere TMDb-ID</button>' +
              '</div>' +

              /* MODUS 1: Staffel & Folge anpassen */
              (st.mode === "move_se" ? (
                '<div class="admin-sub-box" style="padding:12px;margin-bottom:12px">' +
                  '<div style="font-size:12px;color:var(--text);margin-bottom:8px">Wähle die korrekte <b>Ziel-Staffel</b> und <b>Ziel-Folge</b> für <b>' + esc(epCodeOnly + ' – ' + (st.episodeTitle || st.title)) + '</b>:</div>' +
                  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
                    '<div>' +
                      '<label style="font-size:11px;color:var(--muted);font-weight:700;display:block;margin-bottom:4px">Ziel-Staffel (0 = Special)</label>' +
                      '<div style="display:flex;gap:4px;align-items:center">' +
                        '<button type="button" class="btn" style="padding:7px 10px;font-weight:900" onclick="stepEpisodeCorrectionNumberClient(\\'epCorrNewSeasonInp\\',-1,0,99)" title="Staffel -1">−</button>' +
                        '<input id="epCorrNewSeasonInp" class="tma-input" type="number" min="0" max="99" value="' + Number(st.targetSeason ?? st.season ?? 1) + '" oninput="updateEpisodeCorrectionLivePreviewClient()" style="width:100%;padding:8px 10px;font-size:13px;font-weight:800;text-align:center" />' +
                        '<button type="button" class="btn" style="padding:7px 10px;font-weight:900" onclick="stepEpisodeCorrectionNumberClient(\\'epCorrNewSeasonInp\\',1,0,99)" title="Staffel +1">＋</button>' +
                      '</div>' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:11px;color:var(--muted);font-weight:700;display:block;margin-bottom:4px">Ziel-Folge</label>' +
                      '<div style="display:flex;gap:4px;align-items:center">' +
                        '<button type="button" class="btn" style="padding:7px 10px;font-weight:900" onclick="stepEpisodeCorrectionNumberClient(\\'epCorrNewEpisodeInp\\',-1,1,999)" title="Folge -1">−</button>' +
                        '<input id="epCorrNewEpisodeInp" class="tma-input" type="number" min="1" max="999" value="' + Number(st.targetEpisode || st.episode) + '" oninput="updateEpisodeCorrectionLivePreviewClient()" style="width:100%;padding:8px 10px;font-size:13px;font-weight:800;text-align:center" />' +
                        '<button type="button" class="btn" style="padding:7px 10px;font-weight:900" onclick="stepEpisodeCorrectionNumberClient(\\'epCorrNewEpisodeInp\\',1,1,999)" title="Folge +1">＋</button>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>'
              ) : '') +

              /* MODUS 2: Version / Schnittfassung wechseln */
              (st.mode === "change_version" ? (
                '<div class="admin-sub-box" style="padding:12px;margin-bottom:12px">' +
                  '<div style="font-size:12px;color:var(--text);margin-bottom:8px">Ordne <b>' + esc(epCodeOnly + ' – ' + (st.episodeTitle || st.title)) + '</b> einer Schnittfassung / Version zu:</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
                    VERSION_PRESETS.map(vp =>
                      '<button type="button" class="season-tab-btn ' + ((st.targetVersionLabel || st.versionLabel) === vp ? 'active' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="document.getElementById(\\'epCorrVersionInp\\').value=\\'' + escJs(vp) + '\\';updateEpisodeCorrectionLivePreviewClient()">' + esc(vp) + '</button>'
                    ).join("") +
                  '</div>' +
                  '<input id="epCorrVersionInp" class="tma-input" value="' + esc(st.targetVersionLabel || st.versionLabel) + '" oninput="updateEpisodeCorrectionLivePreviewClient()" placeholder="Eigene Versions-Bezeichnung (z.B. Netflix-Fassung)..." style="width:100%;padding:8px 10px;font-size:12.5px" />' +
                '</div>'
              ) : '') +

              /* MODUS 3: Mit anderer TMDb-ID (Serie + Staffel/Folge oder Film) verknüpfen */
              (st.mode === "relink_tmdb" ? (
                '<div class="admin-sub-box" style="padding:12px;margin-bottom:12px">' +
                  '<div style="font-size:12px;color:var(--text);margin-bottom:8px"><b>Umfang der Neu-Verknüpfung:</b></div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
                    '<button type="button" class="season-tab-btn ' + (st.relinkScope === 'single_episode' ? 'active' : '') + '" onclick="activeEpisodeCorrectionState.relinkScope=\\'single_episode\\';renderEpisodeCorrectionModalDomClient()">🎯 Nur ' + esc(epCodeOnly) + ' einzeln zuweisen</button>' +
                    '<button type="button" class="season-tab-btn ' + (st.relinkScope === 'entire_series' ? 'active' : '') + '" onclick="activeEpisodeCorrectionState.relinkScope=\\'entire_series\\';renderEpisodeCorrectionModalDomClient()">📦 Ganze Serie / Alle Folgen umziehen</button>' +
                  '</div>' +

                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
                    '<input id="epCorrTmdbSearchInp" class="tma-input" value="' + esc(st.title) + '" placeholder="Richtigen Titel oder TMDb-ID suchen..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();searchEpisodeCorrectionTmdbClient()}" style="flex:1;min-width:170px;padding:8px 10px;font-size:12px" />' +
                    '<button type="button" class="btn blue" onclick="searchEpisodeCorrectionTmdbClient()">🔍 Suchen</button>' +
                  '</div>' +

                  '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-bottom:8px">' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:2px">Ziel-Typ</label>' +
                      '<select id="epCorrNewTypeSel" class="tma-select" onchange="updateEpisodeCorrectionLivePreviewClient()" style="width:100%;padding:7px;font-size:12px">' +
                        '<option value="s" ' + (st.selectedNewTypeCode === 's' ? 'selected' : '') + '>📺 Serie</option>' +
                        '<option value="m" ' + (st.selectedNewTypeCode === 'm' ? 'selected' : '') + '>🎬 Film</option>' +
                      '</select>' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:2px">Ziel TMDb-ID</label>' +
                      '<input id="epCorrNewTmdbIdInp" class="tma-input" type="number" value="' + st.selectedNewTmdbId + '" oninput="updateEpisodeCorrectionLivePreviewClient()" style="width:100%;padding:7px;font-size:12px;font-weight:800" />' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:2px">Ziel-Staffel (0 = Special)</label>' +
                      '<div style="display:flex;gap:3px;align-items:center">' +
                        '<button type="button" class="btn" style="padding:5px 7px;font-weight:900" onclick="stepEpisodeCorrectionNumberClient(\\'epCorrRelinkSeasonInp\\',-1,0,99)">−</button>' +
                        '<input id="epCorrRelinkSeasonInp" class="tma-input" type="number" min="0" max="99" value="' + Number(st.targetSeason ?? st.season ?? 1) + '" oninput="updateEpisodeCorrectionLivePreviewClient()" style="width:100%;padding:7px 4px;font-size:12px;font-weight:800;text-align:center" />' +
                        '<button type="button" class="btn" style="padding:5px 7px;font-weight:900" onclick="stepEpisodeCorrectionNumberClient(\\'epCorrRelinkSeasonInp\\',1,0,99)">＋</button>' +
                      '</div>' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:2px">Ziel-Folge</label>' +
                      '<div style="display:flex;gap:3px;align-items:center">' +
                        '<button type="button" class="btn" style="padding:5px 7px;font-weight:900" onclick="stepEpisodeCorrectionNumberClient(\\'epCorrRelinkEpisodeInp\\',-1,1,999)">−</button>' +
                        '<input id="epCorrRelinkEpisodeInp" class="tma-input" type="number" min="1" max="999" value="' + Number(st.targetEpisode || st.episode) + '" oninput="updateEpisodeCorrectionLivePreviewClient()" style="width:100%;padding:7px 4px;font-size:12px;font-weight:800;text-align:center" />' +
                        '<button type="button" class="btn" style="padding:5px 7px;font-weight:900" onclick="stepEpisodeCorrectionNumberClient(\\'epCorrRelinkEpisodeInp\\',1,1,999)">＋</button>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +

                  '<div id="epCorrTmdbResultsBox" style="max-height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:5px"></div>' +
                '</div>'
              ) : '') +

              '<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">' +
                '<button type="button" class="btn close-slate" onclick="closeSubModalOverlayClient()">Abbrechen</button>' +
                '<button type="button" class="btn green" onclick="submitEpisodeCorrectionClient()">💾 Korrektur speichern</button>' +
              '</div>' +
            '</div>' +
          '</div>';

        if (typeof window.refreshModalAndEpisodeMarquees === "function") {
          setTimeout(() => window.refreshModalAndEpisodeMarquees(mount), 40);
        }
      }

      async function searchEpisodeCorrectionTmdbClient() {
        const q = (document.getElementById("epCorrTmdbSearchInp")?.value || "").trim();
        const resBox = document.getElementById("epCorrTmdbResultsBox");
        if (!q || !resBox) return;
        resBox.innerHTML = '<div style="font-size:11.5px;color:#0284c7;padding:6px">⏳ Suche auf TMDb & Fallback-APIs...</div>';
        try {
          const r = await apiFetchJson(API_BASE + "/search?q=" + encodeURIComponent(q) + "&bypass=1");
          const items = r?.items || [];
          if (items.length === 0) {
            resBox.innerHTML = '<div style="font-size:11.5px;color:#f87171;padding:6px">Keine Treffer gefunden.</div>';
            return;
          }
          resBox.innerHTML = items.slice(0, 10).map(item => {
            const tc = item.media_type === "tv" ? "s" : "m";
            const yr = String(item.release_date || item.first_air_date || "").split("-")[0] || "k.A.";
            const tName = item.title || item.name || "Unbekannt";
            const pUrl = resolvePosterUrlClient(item.poster_path, "w92", item.external_poster_url || "");
            const isSel = activeEpisodeCorrectionState &&
              Number(activeEpisodeCorrectionState.selectedNewTmdbId) === Number(item.id) &&
              activeEpisodeCorrectionState.selectedNewTypeCode === tc;
            return '<div class="admin-sub-box" data-cand-id="' + Number(item.id) + '" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-color:' + (isSel ? '#38bdf8' : 'rgba(148,163,184,0.2)') + ';background:' + (isSel ? 'rgba(14,165,233,0.16)' : '') + '">' +
              '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">' +
                (pUrl ? '<img src="' + esc(pUrl) + '" style="width:28px;height:42px;object-fit:cover;border-radius:4px;flex-shrink:0" />' : '') +
                '<div style="min-width:0;flex:1">' +
                  '<div style="font-size:12px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (tc === "s" ? "📺 " : "🎬 ") + esc(tName) + ' (' + esc(yr) + ')</div>' +
                  '<div style="font-size:10.5px;color:#38bdf8">TMDb #' + Number(item.id) + '</div>' +
                '</div>' +
              '</div>' +
              '<button type="button" class="season-tab-btn ' + (isSel ? 'active' : '') + '" style="padding:4px 9px;font-size:11px" onclick="selectEpisodeCorrectionTmdbCandidateClient(\\'' + tc + '\\',' + Number(item.id) + ',\\'' + escJs(tName) + '\\')">' + (isSel ? '✓ Gewählt' : 'Auswählen') + '</button>' +
            '</div>';
          }).join("");
        } catch (e) {
          resBox.innerHTML = '<div style="font-size:11.5px;color:#f87171;padding:6px">⚠️ Suche fehlgeschlagen.</div>';
        }
      }

      function selectEpisodeCorrectionTmdbCandidateClient(newTypeCode, newTmdbId, newTitle) {
        if (!activeEpisodeCorrectionState) return;
        activeEpisodeCorrectionState.selectedNewTypeCode = newTypeCode;
        activeEpisodeCorrectionState.selectedNewTmdbId = Number(newTmdbId);
        activeEpisodeCorrectionState.selectedNewTitle = newTitle;
        const typeSel = document.getElementById("epCorrNewTypeSel");
        const idInp = document.getElementById("epCorrNewTmdbIdInp");
        if (typeSel) typeSel.value = newTypeCode;
        if (idInp) idInp.value = String(newTmdbId);
        updateEpisodeCorrectionLivePreviewClient();
        const resBox = document.getElementById("epCorrTmdbResultsBox");
        if (resBox) {
          resBox.querySelectorAll(".admin-sub-box[data-cand-id]").forEach(row => {
            const isMatch = Number(row.getAttribute("data-cand-id")) === Number(newTmdbId);
            row.style.borderColor = isMatch ? "#38bdf8" : "rgba(148,163,184,0.2)";
            row.style.background = isMatch ? "rgba(14,165,233,0.16)" : "";
            const btn = row.querySelector("button");
            if (btn) {
              btn.classList.toggle("active", isMatch);
              btn.textContent = isMatch ? "✓ Gewählt" : "Auswählen";
            }
          });
        }
        showHudToast("🎯 Ziel gewählt: " + newTitle + " (#" + newTmdbId + ") – Vorschau oben aktualisiert!");
      }

      async function submitEpisodeCorrectionClient() {
        const st = activeEpisodeCorrectionState;
        if (!st) return;
        const payload = {
          mode: st.mode,
          scope: st.relinkScope || "single_episode",
          oldTypeCode: st.typeCode,
          oldTmdbId: st.tmdbId,
          seriesId: st.tmdbId,
          oldSeason: st.season,
          oldEpisode: st.episode,
          telegramFileId: st.telegramFileId,
          reportId: st.reportId || 0,
          autoResolveReport: true
        };

        if (st.mode === "move_se") {
          const sRaw = document.getElementById("epCorrNewSeasonInp")?.value;
          const eRaw = document.getElementById("epCorrNewEpisodeInp")?.value;
          payload.newSeason = Math.max(0, (sRaw !== undefined && sRaw !== "") ? Number(sRaw) : Number(st.season ?? 1));
          payload.newEpisode = Math.max(1, (eRaw !== undefined && eRaw !== "") ? Number(eRaw) : Number(st.episode ?? 1));
        } else if (st.mode === "change_version") {
          payload.newVersionLabel = String(document.getElementById("epCorrVersionInp")?.value || st.versionLabel || "Originalfassung").trim();
        } else if (st.mode === "relink_tmdb") {
          payload.newTypeCode = document.getElementById("epCorrNewTypeSel")?.value === "m" ? "m" : "s";
          payload.newTmdbId = Number(document.getElementById("epCorrNewTmdbIdInp")?.value || st.selectedNewTmdbId || 0);
          const rsRaw = document.getElementById("epCorrRelinkSeasonInp")?.value;
          const reRaw = document.getElementById("epCorrRelinkEpisodeInp")?.value;
          payload.newSeason = Math.max(0, (rsRaw !== undefined && rsRaw !== "") ? Number(rsRaw) : Number(st.season ?? 1));
          payload.newEpisode = Math.max(1, (reRaw !== undefined && reRaw !== "") ? Number(reRaw) : Number(st.episode ?? 1));
        }

        setBusyState(true, "💾 Speichere Korrektur in D1 & aktualisiere Episoden...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/reassign-episode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Korrektur konnte nicht gespeichert werden."));
            return;
          }
          if (st.reportId) {
            if (Array.isArray(window._adminReportsCache)) {
              window._adminReportsCache = window._adminReportsCache.map(rep =>
                rep && Number(rep.id) === Number(st.reportId)
                  ? { ...rep, status: "resolved", resolved_at: Date.now() }
                  : rep
              );
            }
            if (window._lastAdminOverviewCache && Array.isArray(window._lastAdminOverviewCache.reports)) {
              window._lastAdminOverviewCache.reports = window._adminReportsCache;
              window._lastAdminOverviewCache.openReportsCount = (window._adminReportsCache || []).filter(rep => rep && rep.status === "open").length;
            }
          }
          clearClientMediaCaches();
          closeSubModalOverlayClient();
          showHudToast("✅ Folge erfolgreich korrigiert" + (st.reportId ? " & Fehlermeldung automatisch als gelöst markiert!" : "!"));

          if (st.mode === "relink_tmdb" && r.newTmdbId && (r.scope === "entire_series" || Number(r.newTmdbId) !== Number(st.tmdbId))) {
            await openDetails(r.newTypeCode || "s", r.newTmdbId, false, "", "", r.newSeason ?? 1);
          } else if (st.typeCode === "s") {
            const targetSeasonToLoad = st.mode === "move_se" ? Number(payload.newSeason ?? st.season) : st.season;
            await openDetails("s", st.tmdbId, false, "", "", targetSeasonToLoad);
          } else {
            await openDetails("m", st.tmdbId, false);
          }
          if (state.currentView === "admin") {
            await loadAdminPanelView(true);
          }
        } finally {
          setBusyState(false);
        }
      }

      // "Fehler melden"-Modal (für freigeschaltete VIP-Mitglieder und Admins)
      function openMediaReportModal(opts) {
        const vipAllowed = isCurrentUserVip();
        if (!vipAllowed && !state.authUser?.isAdmin) {
          showHudToast("🔒 Nur freigeschaltete VIP-Mitglieder und Admins können Fehlermeldungen einreichen.");
          return;
        }
        const typeCode = opts?.typeCode === "s" ? "s" : "m";
        const tmdbId = Number(opts?.tmdbId || state.activeDetails?.id || 0);
        const title = String(opts?.title || state.activeDetails?.title || "Unbekannt");
        const season = opts?.season != null ? Number(opts.season) : null;
        const episode = opts?.episode != null ? Number(opts.episode) : null;
        const episodeTitle = String(opts?.episodeTitle || "");
        const telegramFileId = String(opts?.telegramFileId || "");
        const versionLabel = String(opts?.versionLabel || "");

        activeMediaReportState = {
          typeCode,
          tmdbId,
          title,
          season,
          episode,
          episodeTitle,
          telegramFileId,
          versionLabel,
          reasonCode: typeCode === "s" && season != null ? "wrong_episode" : "wrong_media",
          draftNote: ""
        };

        renderMediaReportModalDomClient();
      }

      function selectMediaReportReasonClient(nextCode) {
        if (!activeMediaReportState) return;
        const noteEl = document.getElementById("mediaReportNoteInp");
        if (noteEl) {
          activeMediaReportState.draftNote = noteEl.value;
        }
        activeMediaReportState.reasonCode = nextCode;
        renderMediaReportModalDomClient();
      }

      function renderMediaReportModalDomClient() {
        const st = activeMediaReportState;
        if (!st) return;
        const mount = ensureSubModalMountClient();
        const epTag = st.typeCode === "s" && st.season != null
          ? (' • S' + String(st.season).padStart(2, '0') + 'E' + String(st.episode || 1).padStart(2, '0') + (st.episodeTitle ? (' (' + esc(st.episodeTitle) + ')') : ''))
          : '';

        const REASONS = [
          { code: "wrong_media", label: "🎬 Falscher Film / Falsche Serie" },
          { code: "wrong_episode", label: "🔢 Falsche Staffel- oder Folgennummer" },
          { code: "broken_video", label: "❌ Video defekt / Lädt nicht" },
          { code: "audio_sub", label: "🔇 Tonspur / Sprache fehlt oder asynchron" },
          { code: "other", label: "💬 Sonstiges" }
        ];

        mount.innerHTML =
          '<div class="submodal-backdrop" onclick="if(event.target===this)closeSubModalOverlayClient()">' +
            '<div class="submodal-box">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">' +
                '<div style="font-size:15px;font-weight:900;color:#f59e0b">⚠️ Fehler melden</div>' +
                '<button type="button" class="btn close-slate" onclick="closeSubModalOverlayClient()">✖</button>' +
              '</div>' +

              '<div style="padding:9px 11px;border-radius:8px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.35);margin-bottom:12px;font-size:12px">' +
                '<div style="font-weight:800;color:var(--text)">' + esc(st.title) + '<span style="color:#f59e0b">' + epTag + '</span></div>' +
                (st.versionLabel ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">Version: <b>' + esc(st.versionLabel) + '</b></div>' : '') +
              '</div>' +

              '<div style="font-size:12px;color:var(--text);font-weight:700;margin-bottom:6px">Was stimmt mit diesem Eintrag nicht?</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">' +
                REASONS.map(r => {
                  const isSel = st.reasonCode === r.code;
                  return '<button type="button" class="btn ' + (isSel ? 'red' : '') + '" style="justify-content:flex-start;padding:9px 12px;font-size:12.5px;text-align:left;' + (isSel ? '' : 'background:var(--card);') + '" onclick="selectMediaReportReasonClient(\\'' + r.code + '\\')">' +
                    (isSel ? '🔘 ' : '⚪ ') + esc(r.label) +
                  '</button>';
                }).join("") +
              '</div>' +

              '<div style="margin-bottom:12px">' +
                '<label style="font-size:11.5px;color:var(--muted);font-weight:700;display:block;margin-bottom:4px">Kurze Notiz (optional, z.B. „Ist eigentlich Staffel 2 Folge 5“):</label>' +
                '<textarea id="mediaReportNoteInp" class="tma-textarea" rows="2" placeholder="Optionale Hinweise für den Admin..." oninput="if(activeMediaReportState)activeMediaReportState.draftNote=this.value" style="width:100%;padding:8px 10px;border-radius:8px;font-size:12px;resize:vertical">' + esc(st.draftNote || '') + '</textarea>' +
              '</div>' +

              '<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">' +
                '<button type="button" class="btn" onclick="closeSubModalOverlayClient()">Abbrechen</button>' +
                '<button type="button" class="btn amber" onclick="submitMediaReportClient()">📨 Meldung absenden</button>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      async function submitMediaReportClient() {
        const st = activeMediaReportState;
        if (!st) return;
        const note = String(document.getElementById("mediaReportNoteInp")?.value || "").trim();
        setBusyState(true, "📨 Sende Fehlermeldung an Admin...");
        try {
          const r = await apiFetchJson(API_BASE + "/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              typeCode: st.typeCode,
              tmdbId: st.tmdbId,
              title: st.title,
              seasonNumber: st.season,
              episodeNumber: st.episode,
              episodeTitle: st.episodeTitle,
              telegramFileId: st.telegramFileId,
              versionLabel: st.versionLabel,
              reasonCode: st.reasonCode,
              note
            })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Meldung konnte nicht gesendet werden."));
            return;
          }
          closeSubModalOverlayClient();
          showHudToast("✅ Danke! Deine Fehlermeldung wurde gespeichert und an den Admin gemeldet.");
        } finally {
          setBusyState(false);
        }
      }

      async function openReportCorrectionWorkflowClient(reportObj) {
        if (!reportObj) return;
        const tc = reportObj.type_code === "s" ? "s" : "m";
        const tid = Number(reportObj.tmdb_id || 0);
        const sNum = Math.max(0, Number(reportObj.season_number ?? 1));
        const eNum = Math.max(0, Number(reportObj.episode_number ?? 1));
        const initialMode = reportObj.reason_code === "wrong_media" ? "relink_tmdb" : (tc === "s" ? "move_se" : "relink_tmdb");
        window._pendingEpisodeCorrectionArgs = {
          typeCode: tc,
          tmdbId: tid,
          title: reportObj.title || "Titel",
          season: sNum,
          episode: eNum,
          episodeTitle: reportObj.episode_title || "",
          telegramFileId: reportObj.telegram_file_id || "",
          versionLabel: reportObj.version_label || "Originalfassung",
          reportId: Number(reportObj.id || 0),
          initialMode
        };
        await openDetails(tc, tid, false, reportObj.title || "", "", tc === "s" ? sNum : null);
      }

      function syncAdminReportsCacheClient(reportsList) {
        const cleanList = Array.isArray(reportsList) ? reportsList : [];
        window._adminReportsCache = cleanList;
        if (window._lastAdminOverviewCache && typeof window._lastAdminOverviewCache === "object") {
          window._lastAdminOverviewCache.reports = cleanList;
          window._lastAdminOverviewCache.openReportsCount = cleanList.filter(rep => rep && rep.status === "open").length;
        }
      }

      async function adminResolveMediaReportClient(reportId) {
        setBusyState(true, "✅ Markiere Meldung als gelöst...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "resolve", reportId: Number(reportId) })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Meldung konnte nicht als gelöst markiert werden."));
            return;
          }
          if (Array.isArray(r.reports)) {
            syncAdminReportsCacheClient(r.reports);
          } else if (Array.isArray(window._adminReportsCache)) {
            syncAdminReportsCacheClient(
              window._adminReportsCache.map(rep =>
                rep && (Number(rep.id) === Number(reportId) || Number(rep.created_at) === Number(reportId))
                  ? { ...rep, status: "resolved", resolved_at: Date.now() }
                  : rep
              )
            );
          }
          showHudToast("✅ Meldung #" + reportId + " als gelöst markiert.");
          await loadAdminPanelView(true);
        } finally {
          setBusyState(false);
        }
      }

      async function adminDeleteMediaReportClient(reportId) {
        setBusyState(true, "🗑️ Lösche Meldung...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", reportId: Number(reportId) })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Meldung konnte nicht gelöscht werden."));
            return;
          }
          if (Array.isArray(r.reports)) {
            syncAdminReportsCacheClient(r.reports);
          } else if (Array.isArray(window._adminReportsCache)) {
            syncAdminReportsCacheClient(
              window._adminReportsCache.filter(rep => rep && Number(rep.id) !== Number(reportId) && Number(rep.created_at) !== Number(reportId))
            );
          }
          showHudToast("🗑️ Meldung gelöscht.");
          await loadAdminPanelView(true);
        } finally {
          setBusyState(false);
        }
      }

      async function adminClearAllMediaReportsClient(onlyResolved = false) {
        const label = onlyResolved ? "alle bereits gelösten Fehlermeldungen" : "ALLE Fehlermeldungen (offene & gelöste)";
        const ok = await showCustomConfirm("Möchtest du wirklich " + label + " unwiderruflich aus D1 löschen?", "🗑️ Jetzt löschen");
        if (!ok) return;
        setBusyState(true, "🗑️ Bereinige Fehlermeldungen in D1...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: onlyResolved ? "clear_resolved" : "clear_all" })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Fehlermeldungen konnten nicht bereinigt werden."));
            return;
          }
          if (Array.isArray(r.reports)) {
            syncAdminReportsCacheClient(r.reports);
          } else {
            syncAdminReportsCacheClient(onlyResolved ? (window._adminReportsCache || []).filter(rep => rep && rep.status !== "resolved") : []);
          }
          showHudToast(onlyResolved ? "🧹 Alle gelösten Meldungen entfernt." : "🗑️ Alle Fehlermeldungen komplett zurückgesetzt.");
          await loadAdminPanelView(true);
        } finally {
          setBusyState(false);
        }
      }

      function renderEpisodeStoryModalDomClient() {
        const st = activeEpisodeStoryState;
        if (!st) return;
        const mount = ensureSubModalMountClient();
        const epCode = 'S' + String(st.season).padStart(2, '0') + 'E' + String(st.episode).padStart(2, '0');
        const cachedList = Array.isArray(activeSeasonCacheEpisodes) ? activeSeasonCacheEpisodes : [];
        const curIdx = cachedList.findIndex(e => Number(e.episode_number) === Number(st.episode));
        const prevEp = curIdx > 0 ? cachedList[curIdx - 1] : null;
        const nextEp = (curIdx >= 0 && curIdx < cachedList.length - 1) ? cachedList[curIdx + 1] : null;
        const cachedEpObj = curIdx >= 0 ? cachedList[curIdx] : null;

        const stillUrl = st.stillPath
          ? ("https://image.tmdb.org/t/p/w780" + st.stillPath)
          : (state.activeDetails?.backdropUrl || state.activeDetails?.posterUrl || "");

        const vipAllowed = isCurrentUserVip();
        const activeFile = cachedEpObj?._resolvedActiveFile || (Array.isArray(cachedEpObj?.files) && cachedEpObj.files[0]) || null;
        const activeFid = String(activeFile?.telegram_file_id || activeFile?.file_id || "");
        const activeQual = String(activeFile?.quality || "1080p");
        const activeSizeStr = activeFile ? formatFileSizeClient(activeFile.file_size) : "";
        const activeVerLbl = activeFile ? (cleanUserVisibleStreamTagsClient(activeFile.versionLabel || activeFile.tags || "Originalfassung") || "Originalfassung") : "";
        const isSavedEp = Boolean(cachedEpObj?.isSaved);

        mount.innerHTML =
          '<div class="submodal-backdrop" onclick="if(event.target===this)closeSubModalOverlayClient()">' +
            '<div class="submodal-box" style="max-width:560px;padding:0;overflow:hidden">' +
              (stillUrl ? (
                '<div style="position:relative;width:100%;height:175px;background:#050814;overflow:hidden;border-bottom:1px solid rgba(56,189,248,0.22)">' +
                  '<img src="' + esc(stillUrl) + '" alt="' + esc(st.epName) + '" style="width:100%;height:100%;object-fit:cover;opacity:0.86" />' +
                  '<div style="position:absolute;inset:0;background:linear-gradient(to top, rgba(7,12,26,0.98) 4%, rgba(7,12,26,0.35) 55%, rgba(7,12,26,0.65) 100%)"></div>' +
                  '<div style="position:absolute;top:10px;left:12px;right:12px;display:flex;justify-content:space-between;align-items:center;gap:8px">' +
                    '<span class="ep-code-badge" style="font-size:12px;padding:4px 10px;background:rgba(2,132,199,0.9);color:#fff">' + esc(epCode) + '</span>' +
                    '<button type="button" id="epStoryCloseBtn" class="btn close-slate" onclick="closeSubModalOverlayClient()" style="padding:5px 10px">✖ Schließen</button>' +
                  '</div>' +
                  '<div style="position:absolute;bottom:10px;left:14px;right:14px">' +
                    '<div style="font-size:11px;color:#7dd3fc;font-weight:700;margin-bottom:2px">' + esc(state.activeDetails?.title || "Serie") + ' · Staffel ' + Number(st.season) + '</div>' +
                    '<div style="font-size:17px;font-weight:900;color:#fff;line-height:1.25">' + esc(st.epName || ("Folge " + st.episode)) + '</div>' +
                  '</div>' +
                '</div>'
              ) : (
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:14px 16px 10px;border-bottom:1px solid rgba(56,189,248,0.18)">' +
                  '<div style="display:flex;align-items:center;gap:8px;min-width:0">' +
                    '<span class="ep-code-badge">' + esc(epCode) + '</span>' +
                    '<div style="font-size:15px;font-weight:900;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(st.epName || ("Folge " + st.episode)) + '</div>' +
                  '</div>' +
                  '<button type="button" id="epStoryCloseBtn" class="btn close-slate" onclick="closeSubModalOverlayClient()">✖</button>' +
                '</div>'
              )) +

              '<div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px">' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:#94a3b8">' +
                  (st.airDate ? '<span class="stream-meta-pill">📅 ' + esc(st.airDate) + '</span>' : '') +
                  (st.runtime > 0 ? '<span class="stream-meta-pill">⏱️ ' + Number(st.runtime) + ' Min.</span>' : '') +
                  (st.voteAverage > 0 ? '<span class="stream-meta-pill" style="color:#fbbf24;border-color:rgba(251,191,36,0.35)">⭐ ' + Number(st.voteAverage).toFixed(1) + '</span>' : '') +
                  '<span class="stream-meta-pill" style="color:#34d399;border-color:rgba(16,185,129,0.35)">👁️ Als gesehen markiert</span>' +
                '</div>' +

                '<div style="font-size:13px;line-height:1.6;color:#e2e8f0;background:rgba(15,23,42,0.68);border:1px solid rgba(148,163,184,0.18);border-radius:10px;padding:12px;max-height:220px;overflow-y:auto">' +
                  (st.loading && !st.overview
                    ? '<span style="color:#38bdf8">⏳ Lade deutsche Episoden-Beschreibung...</span>'
                    : esc(st.overview || "Für diese Episode liegt aktuell noch keine ausführliche deutsche Inhaltsangabe vor.")) +
                '</div>' +

                '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                    ((vipAllowed && activeFid) ? (
                      '<button type="button" id="epStoryPlayBtn" class="btn-stream-clean" data-fid="' + esc(activeFid) + '" data-title="' + esc((state.activeDetails?.title || 'Serie') + ' ' + epCode + ' - ' + st.epName) + '" data-qual="' + esc(activeQual) + '" data-sid="' + Number(st.seriesId) + '" data-sn="' + Number(st.season) + '" data-en="' + Number(st.episode) + '" data-epname="' + esc(st.epName) + '" data-size="' + esc(activeSizeStr) + '" data-tags="' + esc(activeVerLbl) + '" onclick="closeSubModalOverlayClient();requestTelegramStreamFromBtn(this)">' +
                        '▶ Stream senden (' + esc(activeQual) + ')' +
                      '</button>'
                    ) : '') +
                    '<button type="button" class="btn" onclick="toggleEpisodeSave(' + Number(st.seriesId) + ',' + Number(st.season) + ',' + Number(st.episode) + ');if(activeEpisodeStoryState){setTimeout(renderEpisodeStoryModalDomClient,220);}">' +
                      (isSavedEp ? '✓ Gemerkt' : '🔖 Folge merken') +
                    '</button>' +
                    (st.telegraphUrl ? (
                      '<a href="' + esc(safeHttpUrl(st.telegraphUrl)) + '" target="_blank" rel="noopener noreferrer" class="btn" style="text-decoration:none" title="Ausführlichen Telegraph-Guide im Browser/Telegram öffnen">📖 Telegraph ↗</a>'
                    ) : '') +
                  '</div>' +

                  '<div style="display:flex;gap:6px;align-items:center">' +
                    (prevEp ? (
                      '<button type="button" class="season-tab-btn" style="padding:5px 10px;font-size:11.5px" data-sid="' + Number(st.seriesId) + '" data-sn="' + Number(st.season) + '" data-en="' + Number(prevEp.episode_number) + '" data-epname="' + esc(prevEp.name || '') + '" onclick="openEpisodeStoryFromEl(this)" title="Vorherige Folge: ' + esc(prevEp.name || '') + '">◀ S' + String(st.season).padStart(2,'0') + 'E' + String(prevEp.episode_number).padStart(2,'0') + '</button>'
                    ) : '') +
                    (nextEp ? (
                      '<button type="button" class="season-tab-btn" style="padding:5px 10px;font-size:11.5px" data-sid="' + Number(st.seriesId) + '" data-sn="' + Number(st.season) + '" data-en="' + Number(nextEp.episode_number) + '" data-epname="' + esc(nextEp.name || '') + '" onclick="openEpisodeStoryFromEl(this)" title="Nächste Folge: ' + esc(nextEp.name || '') + '">S' + String(st.season).padStart(2,'0') + 'E' + String(nextEp.episode_number).padStart(2,'0') + ' ▶</button>'
                    ) : '') +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';

        const focusTarget = document.getElementById("epStoryPlayBtn") || document.getElementById("epStoryCloseBtn");
        if (focusTarget && typeof jumpSpatialFocus === "function") {
          setTimeout(() => jumpSpatialFocus(focusTarget, false), 25);
        }
      }

      function openEpisodeStoryFromEl(el) {
        if (!el) return;
        const sid = Number(el.getAttribute("data-sid") || 0);
        const sn = Number(el.getAttribute("data-sn") || 0);
        const en = Number(el.getAttribute("data-en") || 0);
        const epName = String(el.getAttribute("data-epname") || "");
        openEpisodeStory(sid, sn, en, epName);
      }

      async function openEpisodeStory(seriesId, season, episode, epName = "") {
        setSeriesProgress(seriesId, season, episode, epName);
        const cachedList = Array.isArray(activeSeasonCacheEpisodes) ? activeSeasonCacheEpisodes : [];
        const cachedEp = cachedList.find(e => Number(e.episode_number) === Number(episode)) || null;
        activeEpisodeStoryState = {
          seriesId: Number(seriesId),
          season: Number(season),
          episode: Number(episode),
          epName: String(epName || cachedEp?.name || ("Folge " + episode)),
          overview: String(cachedEp?.overview || ""),
          airDate: String(cachedEp?.air_date || ""),
          stillPath: String(cachedEp?.still_path || ""),
          voteAverage: Number(cachedEp?.vote_average || 0),
          runtime: Number(cachedEp?.runtime || 0),
          telegraphUrl: "",
          loading: true
        };
        renderEpisodeStoryModalDomClient();
        loadSeason(seriesId, season, false, true);
        try {
          const r = await apiFetchJson(API_BASE + "/episode-story", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, seriesId, season, episode })
          });
          if (
            activeEpisodeStoryState &&
            Number(activeEpisodeStoryState.seriesId) === Number(seriesId) &&
            Number(activeEpisodeStoryState.season) === Number(season) &&
            Number(activeEpisodeStoryState.episode) === Number(episode)
          ) {
            activeEpisodeStoryState.loading = false;
            if (r?.telegraphUrl) activeEpisodeStoryState.telegraphUrl = String(r.telegraphUrl);
            if (r?.episode) {
              if (r.episode.name) activeEpisodeStoryState.epName = String(r.episode.name);
              if (r.episode.overview) activeEpisodeStoryState.overview = String(r.episode.overview);
              if (r.episode.air_date) activeEpisodeStoryState.airDate = String(r.episode.air_date);
              if (r.episode.still_path) activeEpisodeStoryState.stillPath = String(r.episode.still_path);
              if (r.episode.vote_average) activeEpisodeStoryState.voteAverage = Number(r.episode.vote_average);
              if (r.episode.runtime) activeEpisodeStoryState.runtime = Number(r.episode.runtime);
            }
            renderEpisodeStoryModalDomClient();
          }
        } catch (e) {
          if (activeEpisodeStoryState) {
            activeEpisodeStoryState.loading = false;
            renderEpisodeStoryModalDomClient();
          }
        }
      }

      function filterSeasonEpisodesInlineClient(rawQuery) {
        const q = String(rawQuery || "").trim().toLowerCase();
        const clearBtn = document.getElementById("seasonEpQuickSearchClearBtn");
        if (clearBtn) clearBtn.style.display = q ? "inline-block" : "none";
        const wrap = document.getElementById("seasonEpisodesListWrap") || document.getElementById("seasonBox");
        if (!wrap) return;
        const rows = wrap.querySelectorAll(".ep-row[data-ep-search]");
        rows.forEach(row => {
          if (!q) {
            row.style.display = "";
            return;
          }
          const hay = String(row.getAttribute("data-ep-search") || "");
          const epNumStr = String(row.getAttribute("data-ep-num") || "");
          const isMatch = hay.includes(q) || epNumStr === q.replace(/^e0*/i, "");
          row.style.display = isMatch ? "" : "none";
        });
      }

      function scrollToActiveProgressEpisodeClient() {
        const box = document.getElementById("seasonBox");
        if (!box) return;
        const targetRow = box.querySelector(".ep-row.ep-next-up, .ep-row.ep-watched");
        if (targetRow) {
          try { targetRow.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_e) {}
          const focusEl = targetRow.querySelector(".btn-stream-clean, .ep-title");
          if (focusEl && typeof jumpSpatialFocus === "function") {
            setTimeout(() => jumpSpatialFocus(focusEl, false), 120);
          }
        }
      }

      async function toggleEpisodeSave(seriesId, season, episode) {
        if (!state.isAuthenticated) { openAccountModal(); return; }
        await apiFetchJson(API_BASE + "/wishlist", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "toggle_episode", seriesId, season, episode }) });
        loadSeason(seriesId, season, false, true);
      }

      async function toggleWishlistItem(type, id) {
        if (!state.isAuthenticated) { openAccountModal(); return; }
        const btn = document.getElementById("modalWishlistBtn");
        const stickyBtn = document.getElementById("modalStickyWishlistBtn");
        if (btn) btn.disabled = true;
        if (stickyBtn) stickyBtn.disabled = true;
        try {
          const r = await apiFetchJson(API_BASE + "/wishlist", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "toggle_item", type, id }) });
          const isSaved = Boolean(r.saved);
          syncCardWishlistBadgeInDom(type, id, isSaved);
          if (state.activeDetails) state.activeDetails.isSaved = isSaved;
          if (btn) {
            btn.disabled = false;
            btn.className = "detail-btn-glass " + (isSaved ? "saved" : "");
            btn.textContent = isSaved ? "✓ Gespeichert" : "＋ Speichern";
          }
          if (stickyBtn) {
            stickyBtn.disabled = false;
            stickyBtn.className = "detail-btn-glass " + (isSaved ? "saved" : "");
            stickyBtn.textContent = isSaved ? "✓ Gespeichert" : "＋ Speichern";
          }
          showHudToast(isSaved ? "✓ Gespeichert" : "🗑️ Aus Merkliste entfernt");
        } catch (e) {
          if (btn) btn.disabled = false;
          if (stickyBtn) stickyBtn.disabled = false;
        }
      }

      // Schnell-Filterung, A-Z Sprungleiste (#20) & Sortierung innerhalb der eigenen Merkliste (#7)
      function setWishlistQuickFilter(nextType) {
        state.wlFilterType = nextType || "all";
        renderWishlistViewDomOnly();
      }

      function setWishlistQuickSort(nextSort) {
        state.wlSort = nextSort || "added_desc";
        renderWishlistViewDomOnly();
      }

      function setWishlistLetter(nextLetter) {
        state.wlLetter = nextLetter || "ALL";
        if (state.wlLetter !== "ALL") state.wlAzOpen = true;
        renderWishlistViewDomOnly();
      }

      function toggleWishlistAzBarClient() {
        state.wlAzOpen = !state.wlAzOpen;
        renderWishlistViewDomOnly();
      }

      function resetWishlistFiltersQuickClient() {
        state.wlFilterType = "all";
        state.wlLetter = "ALL";
        state.wlSearchQuery = "";
        state.wlSort = "added_desc";
        renderWishlistViewDomOnly();
        showHudToast("↺ Merklisten-Filter zurückgesetzt");
      }

      function onWishlistSearchInput(val) {
        state.wlSearchQuery = String(val || "");
        const clearBtn = document.getElementById("wishlistSearchClearBtn");
        if (clearBtn) clearBtn.style.display = state.wlSearchQuery.trim() ? "inline-flex" : "none";
        renderWishlistListItemsMountOnly();
      }

      function clearWishlistSearchQuickClient() {
        state.wlSearchQuery = "";
        const inp = document.getElementById("wishlistSearchInp");
        if (inp) {
          inp.value = "";
          inp.focus();
        }
        const clearBtn = document.getElementById("wishlistSearchClearBtn");
        if (clearBtn) clearBtn.style.display = "none";
        renderWishlistListItemsMountOnly();
      }

      async function moveWishlistItemToFolderClient(uid, targetFolderId) {
        if (!state.isAuthenticated || !uid) return;
        const r = await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, action: "move_item_folder", uid, targetFolderId })
        });
        if (!r || !r.ok) {
          showHudToast("⚠️ Konnte Eintrag nicht verschieben.");
          return;
        }
        const folders = state.cachedWishlistFolders || [];
        const fObj = folders.find(f => f.id === r.folderId);
        showHudToast("📁 Verschoben nach: " + (fObj ? fObj.name : "Standard-Merkliste"));
        closeSubModalOverlayClient();
        loadWishlist(state.wlFolder);
      }

      function openWishlistFolderAssignPopupClient(uid, title, currentFolderId, isSer) {
        const folders = state.cachedWishlistFolders || [];
        const mount = ensureSubModalMountClient();
        const defaultCat = isSer ? "cat_series" : "cat_movies";
        const curFolder = currentFolderId || defaultCat;
        mount.innerHTML =
          '<div class="submodal-backdrop" onclick="if(event.target===this)closeSubModalOverlayClient()">' +
            '<div class="submodal-box" style="max-width:440px">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">' +
                '<div style="font-size:14.5px;font-weight:900;color:#38bdf8">📁 Playlist / Ordner zuweisen</div>' +
                '<button type="button" class="btn close-slate" onclick="closeSubModalOverlayClient()">✖</button>' +
              '</div>' +
              '<div style="font-size:12px;color:var(--muted);margin-bottom:10px">Wähle den Ziel-Ordner für <b style="color:var(--text)">' + esc(title) + '</b>:</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;margin-bottom:12px">' +
                '<button type="button" class="btn ' + ((curFolder === "cat_movies" || curFolder === "cat_series" || !curFolder) ? "blue" : "") + '" style="justify-content:space-between;padding:8px 12px" onclick="moveWishlistItemToFolderClient(\\'' + escJs(uid) + '\\',\\'' + defaultCat + '\\')">' +
                  '<span>' + (isSer ? '📺 Standard (Serien)' : '🎬 Standard (Filme)') + '</span>' +
                  '<span>' + ((curFolder === "cat_movies" || curFolder === "cat_series" || !curFolder) ? "✓ Aktiv" : "Wählen") + '</span>' +
                '</button>' +
                folders.map(f => {
                  const isAct = curFolder === f.id;
                  const fIcon = (f.type === "playlist" || f.isJsonPlaylist) ? "🎵" : "📁";
                  return '<button type="button" class="btn ' + (isAct ? "blue" : "") + '" style="justify-content:space-between;padding:8px 12px" onclick="moveWishlistItemToFolderClient(\\'' + escJs(uid) + '\\',\\'' + escJs(f.id) + '\\')">' +
                    '<span>' + fIcon + ' ' + esc(f.name) + '</span>' +
                    '<span>' + (isAct ? "✓ Aktiv" : "Wählen") + '</span>' +
                  '</button>';
                }).join("") +
              '</div>' +
              '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
                '<button type="button" class="btn" onclick="closeSubModalOverlayClient();createNewFolderPrompt(true)">➕ Neue Playlist anlegen</button>' +
                '<button type="button" class="btn close-slate" onclick="closeSubModalOverlayClient()">Schließen</button>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      function getFilteredAndSortedWishlistItems() {
        const allItems = state.cachedWishlistItems || [];
        const folders = state.cachedWishlistFolders || [];
        const cur = state.wlFolder || "root";
        const disabledFolderIds = new Set(folders.filter(f => f.enabled === false).map(f => f.id));
        const enabledItems = allItems.filter(i => !i.folderId || !disabledFolderIds.has(i.folderId));

        let list = cur === "root"
          ? enabledItems
          : cur === "cat_movies"
            ? enabledItems.filter(i => i.contentType === "movie" || i.folderId === "cat_movies")
            : cur === "cat_series"
              ? enabledItems.filter(i => i.contentType === "series" || i.contentType === "episode")
              : allItems.filter(i => i.folderId === cur);

        if (state.wlFilterType === "m") {
          list = list.filter(i => i.contentType === "movie");
        } else if (state.wlFilterType === "s") {
          list = list.filter(i => i.contentType === "series" || i.contentType === "episode");
        }

        const activeLetter = String(state.wlLetter || "ALL").toUpperCase();
        if (activeLetter && activeLetter !== "ALL") {
          list = list.filter(i => {
            const cleanTitle = String(i.title || "").trim().replace(/^[^a-zA-Z0-9äöüÄÖÜ]+/, "");
            const firstChar = (cleanTitle[0] || "").toUpperCase();
            if (activeLetter === "#") {
              return !/^[A-ZÄÖÜ]$/.test(firstChar);
            }
            if (activeLetter === "A" && firstChar === "Ä") return true;
            if (activeLetter === "O" && firstChar === "Ö") return true;
            if (activeLetter === "U" && firstChar === "Ü") return true;
            return firstChar === activeLetter;
          });
        }

        const q = String(state.wlSearchQuery || "").trim().toLowerCase();
        if (q) {
          list = list.filter(i => String(i.title || "").toLowerCase().includes(q) || String(i.year || "").includes(q));
        }

        const sorted = [...list];
        if (state.wlSort === "added_asc") {
          sorted.sort((a, b) => (Number(a.addedAt) || 0) - (Number(b.addedAt) || 0));
        } else if (state.wlSort === "rating_desc") {
          sorted.sort((a, b) => (Number(b.rating || b.vote_average) || 0) - (Number(a.rating || a.vote_average) || 0));
        } else if (state.wlSort === "rating_asc") {
          sorted.sort((a, b) => (Number(a.rating || a.vote_average) || 0) - (Number(b.rating || b.vote_average) || 0));
        } else if (state.wlSort === "title_asc") {
          sorted.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "de"));
        } else if (state.wlSort === "title_desc") {
          sorted.sort((a, b) => String(b.title || "").localeCompare(String(a.title || ""), "de"));
        } else if (state.wlSort === "year_desc") {
          sorted.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
        } else if (state.wlSort === "year_asc") {
          sorted.sort((a, b) => (parseInt(a.year, 10) || 9999) - (parseInt(b.year, 10) || 9999));
        } else {
          sorted.sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0));
        }
        return sorted;
      }

      function setWishlistViewMode(nextMode) {
        state.wlViewMode = nextMode === "list" ? "list" : "grid";
        try { localStorage.setItem("tma_wl_view_mode", state.wlViewMode); } catch (e) {}
        renderWishlistViewDomOnly();
      }

      function renderWishlistListItemsMountOnly() {
        const mount = document.getElementById("wishlistItemsMount");
        const countEl = document.getElementById("wishlistCountSpan");
        if (!mount) return;
        const folders = state.cachedWishlistFolders || [];
        const filteredItems = getFilteredAndSortedWishlistItems();
        if (countEl) countEl.textContent = String(filteredItems.length);
        if (filteredItems.length === 0) {
          const hasSubFilter = Boolean(
            (state.wlSearchQuery && state.wlSearchQuery.trim()) ||
            (state.wlLetter && state.wlLetter !== "ALL") ||
            (state.wlFilterType && state.wlFilterType !== "all")
          );
          mount.innerHTML = '<div class="panel-box" style="color:var(--text-muted);font-size:12.5px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">' +
            '<span>Keine passenden Einträge in dieser Merklisten-Ansicht gefunden.</span>' +
            (hasSubFilter ? '<button type="button" class="btn danger" style="padding:4px 10px;font-size:11.5px" onclick="resetWishlistFiltersQuickClient()">↺ Filter zurücksetzen</button>' : '') +
          '</div>';
          return;
        }

        const isGridMode = state.wlViewMode !== "list";
        if (isGridMode) {
          mount.innerHTML = '<div class="carousel">' + filteredItems.map(it => {
            const isEp = it.contentType === 'episode';
            const isSer = it.contentType === 'series' || isEp;
            const tc = isSer ? 's' : 'm';
            const targetId = Number(isEp ? it.seriesId : it.tmdbId) || 0;
            const cardKey = tc + "_" + targetId;
            const itemTitleSafe = esc(it.title || 'Titel');
            const resolvedCardPoster = resolvePosterUrlClient(it.poster, 'w342', '');
            const yrStr = esc((it.year && it.year !== 'K. A.') ? String(it.year).slice(0, 4) : '–');
            const ratStr = it.rating ? Number(it.rating).toFixed(1) : '';
            const mediaLabel = isSer ? 'Serie' : 'Film';
            const epsList = Array.isArray(it.episodes) ? it.episodes : [];
            const plObj = it.folderId ? folders.find(f => f.id === it.folderId) : null;
            const epCountBadgeHtml = (isSer && epsList.length > 0)
              ? ('<span class="card-type-badge" title="' + epsList.length + ' gespeicherte Folge(n) – Tipp für Liste" onclick="event.stopPropagation();setWishlistViewMode(\\'list\\')">📺 ' + epsList.length + ' Flg.</span>')
              : '';
            const subLeftHtml = folders.length > 0
              ? ('<span class="card-wl-folder-link" title="Antippen, um Playlist / Ordner zuzuweisen" onclick="event.stopPropagation();openWishlistFolderAssignPopupClient(\\'' + escJs(it.uid) + '\\',\\'' + escJs(it.title || 'Titel') + '\\',\\'' + escJs(it.folderId || '') + '\\',' + (isSer ? 'true' : 'false') + ')">' + (plObj ? ('📁 ' + esc(plObj.name.slice(0, 11)) + ' ▾') : ('📁 ' + mediaLabel + ' ▾')) + '</span>')
              : ('<span>' + (plObj ? ('📁 ' + esc(plObj.name.slice(0, 12))) : mediaLabel) + '</span>');
            const wlPosterSrc = resolvedCardPoster ? esc(resolvedCardPoster) : buildPosterFallbackSvg(it.title, isSer ? 'SERIE' : 'FILM');
            return '<div class="card card-saved" tabindex="0" data-card-key="' + esc(cardKey) + '" data-card-type="' + tc + '" data-card-id="' + targetId + '" data-card-title="' + itemTitleSafe + '" data-card-year="' + yrStr + '" data-card-rating="' + esc(ratStr) + '" data-card-vip="" data-card-saved="1" data-card-media-label="' + mediaLabel + '" data-wl-uid="' + esc(it.uid || '') + '" onclick="openDetails(\\'' + tc + '\\',' + targetId + ')">' +
              '<div class="card-poster-wrap">' +
                '<div class="card-top-left-stack">' +
                  epCountBadgeHtml +
                '</div>' +
                '<button type="button" class="card-quick-save saved" onclick="event.stopPropagation();deleteSavedUid(\\'' + escJs(it.uid) + '\\')" title="Aus Merkliste entfernen">🗑️</button>' +
                '<button type="button" class="card-hover-play-btn" onclick="playInstantTrailerFromCard(event,\\'' + tc + '\\',' + targetId + ')" aria-label="Trailer abspielen" title="Instant-Trailer abspielen">' +
                  '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.2 2.6a.9.9 0 0 1 1.37-.77l8.2 5.4a.9.9 0 0 1 0 1.54l-8.2 5.4A.9.9 0 0 1 4.2 13.4V2.6z"/></svg>' +
                '</button>' +
                '<img class="lazy-cover-img is-loading" src="' + LAZY_POSTER_PLACEHOLDER_SVG + '" data-lazy-src="' + wlPosterSrc + '" draggable="false" alt="' + itemTitleSafe + '" />' +
              '</div>' +
              '<div class="card-body">' +
                '<div class="card-title"><span class="card-title-text">' + itemTitleSafe + '</span></div>' +
                '<div class="card-sub">' + subLeftHtml + '<span>' + yrStr + '</span></div>' +
              '</div>' +
            '</div>';
          }).join("") + '</div>';
          unlockCatalogCoversLoadingClient(false);
          observeLazyCoversInContainerClient(mount);
          return;
        }

        mount.innerHTML = filteredItems.map((it, idx) => {
          const isEp = it.contentType === 'episode';
          const isSer = it.contentType === 'series' || isEp;
          const targetId = isEp ? it.seriesId : it.tmdbId;
          const badge = isEp ? '💿 Folge' : isSer ? '📺 Serie' : '🎬 Film';
          const plObj = it.folderId ? folders.find(f => f.id === it.folderId) : null;
          const plTag = plObj ? ' <span style="color:var(--blue);font-size:10.5px">[' + esc(plObj.name) + ']</span>' : '';
          const thumbUrl = resolvePosterUrlClient(it.poster, 'w185', '');
          const epsList = Array.isArray(it.episodes) ? it.episodes : [];
          const drawerId = 'wl_' + esc(it.uid || (targetId + '_' + idx));
          const epPreviewCodes = epsList.slice(0, 3).map(e => e.code || ('S' + String(e.season !== undefined && e.season !== null ? e.season : 1).padStart(2, '0') + 'E' + String(e.episode || 1).padStart(2, '0'))).join(', ');
          const epSummaryBtnHtml = (isSer && epsList.length > 0)
            ? ('<button type="button" class="btn" style="padding:3px 8px;font-size:11px;background:rgba(56,189,248,0.14);border-color:rgba(56,189,248,0.45);color:var(--blue)" onclick="toggleSeriesEpisodesDrawerClient(event,\\'' + drawerId + '\\')">📺 ' + epsList.length + ' Folge' + (epsList.length === 1 ? '' : 'n') + ' (' + esc(epPreviewCodes) + (epsList.length > 3 ? '…' : '') + ') <span id="epDrawerIcon_' + drawerId + '">▾</span></button>')
            : '';
          const defaultFolderVal = isSer ? "cat_series" : "cat_movies";
          const curFolderVal = (it.folderId && folders.some(f => f.id === it.folderId)) ? it.folderId : defaultFolderVal;
          const folderSelectHtml = folders.length > 0 ? (
            '<select class="mode-filter-select" style="padding:3px 7px;font-size:11px;max-width:155px" onchange="moveWishlistItemToFolderClient(\\'' + escJs(it.uid) + '\\',this.value)" title="In Playlist oder Ordner verschieben">' +
              '<option value="' + defaultFolderVal + '"' + (curFolderVal === defaultFolderVal ? ' selected' : '') + '>📁 Standard (' + (isSer ? 'Serien' : 'Filme') + ')</option>' +
              folders.map(f => {
                const fIcon = (f.type === 'playlist' || f.isJsonPlaylist) ? '🎵' : '📁';
                return '<option value="' + esc(f.id) + '"' + (curFolderVal === f.id ? ' selected' : '') + '>' + fIcon + ' ' + esc(f.name) + '</option>';
              }).join('') +
            '</select>'
          ) : '';
          const epDrawerHtml = (isSer && epsList.length > 0)
            ? ('<div id="epDrawer_' + drawerId + '" style="display:none;flex-direction:column;gap:4px;margin-top:6px;padding:8px;border-radius:8px;background:var(--surface);border:1px solid rgba(56,189,248,0.3)">' +
                epsList.map(ep => {
                  const sVal = (ep.season !== undefined && ep.season !== null) ? Number(ep.season) : 1;
                  const epCode = ep.code || ('S' + String(sVal).padStart(2, '0') + 'E' + String(ep.episode || 1).padStart(2, '0'));
                  const epTitle = ep.title || ('Folge ' + (ep.episode || 1));
                  const qStr = [ep.quality || '1080p', ep.codec || ''].filter(Boolean).join(' • ');
                  return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;background:var(--card);border:1px solid rgba(148,163,184,0.12);font-size:11.5px">' +
                    '<div style="cursor:pointer;flex:1" onclick="openDetails(\\'s\\',' + Number(targetId) + ',false,\\'\\',\\'\\',' + sVal + ')">' +
                      '<b style="color:var(--blue)">' + esc(epCode) + '</b> – <span style="color:var(--text)">' + esc(epTitle) + '</span>' +
                      (qStr ? ' <span style="color:var(--text-muted);font-size:10.5px">[' + esc(qStr) + ']</span>' : '') +
                    '</div>' +
                    '<button type="button" class="btn" style="padding:2px 7px;font-size:10.5px" onclick="openDetails(\\'s\\',' + Number(targetId) + ',false,\\'\\',\\'\\',' + sVal + ')">' + (sVal === 0 ? 'Specials' : ('Staffel ' + sVal)) + ' öffnen</button>' +
                  '</div>';
                }).join('') +
              '</div>')
            : '';
          return '<div class="ep-row" style="flex-direction:column;align-items:stretch">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:180px;cursor:pointer" tabindex="0" onclick="openDetails(\\''+(isSer?'s':'m')+'\\','+targetId+',false)">' +
                (thumbUrl
                  ? '<img class="lazy-cover-img is-loading" src="' + LAZY_POSTER_PLACEHOLDER_SVG + '" data-lazy-src="' + esc(thumbUrl) + '" style="width:32px;height:46px;object-fit:cover;border-radius:4px;flex-shrink:0" alt="" />'
                  : '<div style="width:32px;height:46px;background:var(--card);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + (isSer ? '📺' : '🎬') + '</div>') +
                '<div>' +
                  '<div style="font-size:12.5px;font-weight:800;color:var(--text)"><span style="color:var(--text-muted);font-size:11px;margin-right:6px">' + badge + '</span>' + esc(it.title) + (it.year && it.year !== 'K. A.' ? ' <span style="color:var(--text-muted);font-size:11px">(' + esc(it.year) + ')</span>' : '') + plTag + '</div>' +
                  (it.allQualities || it.quality ? '<div style="font-size:10.5px;color:var(--text-muted);margin-top:2px">' + esc(it.allQualities || it.quality) + '</div>' : '') +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                folderSelectHtml +
                epSummaryBtnHtml +
                '<button class="btn danger" onclick="deleteSavedUid(\\''+escJs(it.uid)+'\\')" title="Aus Merkliste entfernen">🗑️</button>' +
              '</div>' +
            '</div>' +
            epDrawerHtml +
          '</div>';
        }).join("");
        unlockCatalogCoversLoadingClient(false);
        observeLazyCoversInContainerClient(mount);
      }

      function toggleWishlistFoldersManager() {
        state.wlManageFoldersOpen = !state.wlManageFoldersOpen;
        renderWishlistViewDomOnly();
      }

      function renderWishlistViewDomOnly() {
        const root = document.getElementById("appRoot");
        if (!root) return;
        const allItems = state.cachedWishlistItems || [];
        const folders = state.cachedWishlistFolders || [];
        const cur = state.wlFolder || "root";
        const disabledFolderIds = new Set(folders.filter(f => f.enabled === false).map(f => f.id));
        const enabledItems = allItems.filter(i => !i.folderId || !disabledFolderIds.has(i.folderId));
        const filteredItems = getFilteredAndSortedWishlistItems();
        const activeFolderObj = folders.find(f => f.id === cur) || null;
        const isGridMode = state.wlViewMode !== "list";
        const isManageOpen = Boolean(state.wlManageFoldersOpen);

        const moviesCount = enabledItems.filter(i => i.contentType === "movie" || i.folderId === "cat_movies").length;
        const seriesCount = enabledItems.filter(i => i.contentType === "series" || i.contentType === "episode").length;

        const folderBtns = [
          '<button class="btn '+(cur==='root'?'active':'')+'" onclick="loadWishlist(\\'root\\')">📂 Alle ('+enabledItems.length+')</button>',
          '<button class="btn '+(cur==='cat_movies'?'active':'')+'" onclick="loadWishlist(\\'cat_movies\\')">🎬 Filme ('+moviesCount+')</button>',
          '<button class="btn '+(cur==='cat_series'?'active':'')+'" onclick="loadWishlist(\\'cat_series\\')">📺 Serien ('+seriesCount+')</button>',
          ...folders.map(f => {
            const isEn = f.enabled !== false;
            const fCount = allItems.filter(i => i.folderId === f.id).length;
            const fIcon = (f.type === 'playlist' || f.isJsonPlaylist) ? (isEn ? '🎵' : '⚪') : (isEn ? '📁' : '⚪');
            return '<button class="btn '+(cur===f.id?'active':'')+'" style="'+(isEn?'':'opacity:0.65;border-style:dashed')+'" onclick="loadWishlist(\\''+escJs(f.id)+'\\')">' + fIcon + ' ' + esc(f.name) + ' (' + fCount + ')</button>';
          })
        ].join(" ");

        const smartPlaylistsPanelHtml = isManageOpen ? (
          '<div class="panel-box" style="margin-bottom:10px;border-color:rgba(14,165,233,0.35)">' +
            '<div class="section-title">' +
              '<span>🎵 Playlisten & Ordner verwalten (' + folders.length + ')</span>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button type="button" class="btn blue" style="padding:4px 9px;font-size:11.5px" onclick="createNewFolderPrompt(true)">➕ Neue Playlist</button>' +
                '<button type="button" class="btn" style="padding:4px 9px;font-size:11.5px" onclick="createNewFolderPrompt(false)">📁 Neuer Ordner</button>' +
                '<button type="button" class="btn close-slate" onclick="toggleWishlistFoldersManager()" title="Verwaltung einklappen">✖</button>' +
              '</div>' +
            '</div>' +
            (folders.length > 0 ? folders.map(f => {
              const isEn = f.enabled !== false;
              const count = allItems.filter(i => i.folderId === f.id).length;
              const badgeType = (f.type === 'playlist' || f.isJsonPlaylist) ? '📦 Playlist' : '📁 Ordner';
              return '<div class="ep-row" style="' + (isEn ? '' : 'opacity:0.68;') + '">' +
                '<div class="ep-title" tabindex="0" onclick="loadWishlist(\\'' + escJs(f.id) + '\\')">' +
                  '<span style="font-size:11px;padding:2px 7px;border-radius:999px;margin-right:6px;background:' + (isEn ? 'rgba(16,185,129,0.18);color:#34d399;border:1px solid rgba(16,185,129,0.4)' : 'rgba(148,163,184,0.18);color:var(--text-muted);border:1px solid rgba(148,163,184,0.3)') + '">' +
                    (isEn ? '🟢 Aktiv' : '⚪ Pausiert') +
                  '</span>' +
                  '<b style="color:var(--text)">' + esc(f.name) + '</b> <span style="color:var(--text-muted);font-size:11px">(' + count + ' Titel • ' + badgeType + ')</span>' +
                '</div>' +
                '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                  '<button class="btn ' + (isEn ? 'green' : '') + '" onclick="togglePlaylistFolderTma(\\'' + escJs(f.id) + '\\')">' + (isEn ? '🟢 Ein' : '⚪ Aus') + '</button>' +
                  '<button class="btn" onclick="loadWishlist(\\'' + escJs(f.id) + '\\')">📂 Öffnen</button>' +
                  '<button class="btn" onclick="renamePlaylistFolderTma(\\'' + escJs(f.id) + '\\',\\'' + escJs(f.name) + '\\')">✏️ Name</button>' +
                  '<button class="btn danger" onclick="deletePlaylistFolderTma(\\'' + escJs(f.id) + '\\',\\'' + escJs(f.name) + '\\')">🗑️</button>' +
                '</div>' +
              '</div>';
            }).join("") : '<div style="font-size:12px;color:var(--text-muted)">Noch keine eigenen Playlisten oder Ordner angelegt.</div>') +
          '</div>'
        ) : '';

        const activeFolderBannerHtml = activeFolderObj ? (
          '<div class="panel-box" style="margin-bottom:10px;border-color:' + (activeFolderObj.enabled !== false ? 'rgba(16,185,129,0.4)' : 'rgba(148,163,184,0.35)') + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div>' +
                '<div style="font-size:13.5px;font-weight:800;color:var(--text)">' + ((activeFolderObj.type === 'playlist' || activeFolderObj.isJsonPlaylist) ? '🎵 Playlist: ' : '📁 Ordner: ') + esc(activeFolderObj.name) + '</div>' +
                '<div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">' +
                  'Status: <b style="color:' + (activeFolderObj.enabled !== false ? '#10b981' : 'var(--text-muted)') + '">' + (activeFolderObj.enabled !== false ? '🟢 In Haupt-Merkliste sichtbar' : '⚪ Ausgeblendet') + '</b>' +
                  (activeFolderObj.sourceLabel ? ' • Quelle: ' + esc(activeFolderObj.sourceLabel) : '') +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                (activeFolderObj.linked && activeFolderObj.tmdbRefId && activeFolderObj.type === 'collection'
                  ? '<button class="btn purple" onclick="openCollectionView(' + Number(activeFolderObj.tmdbRefId) + ')">🍿 Komplette Filmreihe</button>'
                  : '') +
                (activeFolderObj.linked && activeFolderObj.tmdbRefId && activeFolderObj.type === 'universe'
                  ? '<button class="btn purple" onclick="openUniverseView(\\'' + escJs(activeFolderObj.tmdbRefId) + '\\')">🌌 Komplettes Universum</button>'
                  : '') +
                '<button class="btn ' + (activeFolderObj.enabled !== false ? 'green' : 'blue') + '" onclick="togglePlaylistFolderTma(\\'' + escJs(activeFolderObj.id) + '\\')">' + (activeFolderObj.enabled !== false ? '🟢 Ausschalten' : '⚪ Einschalten') + '</button>' +
                '<button class="btn" onclick="renamePlaylistFolderTma(\\'' + escJs(activeFolderObj.id) + '\\',\\'' + escJs(activeFolderObj.name) + '\\')">✏️ Umbenennen</button>' +
                '<button class="btn danger" onclick="deletePlaylistFolderTma(\\'' + escJs(activeFolderObj.id) + '\\',\\'' + escJs(activeFolderObj.name) + '\\')">🗑️ Löschen</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        ) : '';

        const azLetters = ["ALL", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "#"];
        const curWlLetter = String(state.wlLetter || "ALL").toUpperCase();
        const isAzVisible = Boolean(state.wlAzOpen || curWlLetter !== "ALL");
        const hasActiveWlFilters = Boolean(
          curWlLetter !== "ALL" ||
          (state.wlFilterType && state.wlFilterType !== "all") ||
          (state.wlSearchQuery && state.wlSearchQuery.trim())
        );
        const azBarHtml = isAzVisible ? (
          '<div class="wl-az-bar" style="margin-bottom:10px">' +
            azLetters.map(ltr =>
              '<button type="button" class="wl-az-btn ' + (curWlLetter === ltr ? 'active' : '') + '" onclick="setWishlistLetter(\\'' + ltr + '\\')">' + (ltr === "ALL" ? "Alle" : ltr) + '</button>'
            ).join("") +
          '</div>'
        ) : '';

        const showSubTypeSelect = (cur !== "cat_movies" && cur !== "cat_series");
        const hasSearchTxt = Boolean(state.wlSearchQuery && state.wlSearchQuery.trim());
        const quickFilterBarHtml = '<div class="floating-filter-bar" style="margin-bottom:10px;padding:8px 10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between">' +
          '<div style="position:relative;display:flex;align-items:center;min-width:160px;flex:1 1 190px">' +
            '<input id="wishlistSearchInp" class="tma-input" value="' + esc(state.wlSearchQuery || '') + '" oninput="onWishlistSearchInput(this.value)" placeholder="🔍 In Merkliste suchen..." style="width:100%;padding:6px 28px 6px 10px;border-radius:8px;font-size:12px" />' +
            '<button type="button" id="wishlistSearchClearBtn" style="position:absolute;right:6px;display:' + (hasSearchTxt ? 'inline-flex' : 'none') + ';align-items:center;justify-content:center;background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:12px;padding:2px 4px" onclick="clearWishlistSearchQuickClient()" title="Suchtext löschen">✕</button>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
            (showSubTypeSelect ? (
              '<select class="mode-filter-select" onchange="setWishlistQuickFilter(this.value)" title="Medientyp in diesem Ordner filtern">' +
                '<option value="all"' + (state.wlFilterType === "all" || !state.wlFilterType ? " selected" : "") + '>🎞️ Alle Typen</option>' +
                '<option value="m"' + (state.wlFilterType === "m" ? " selected" : "") + '>🎬 Nur Filme</option>' +
                '<option value="s"' + (state.wlFilterType === "s" ? " selected" : "") + '>📺 Nur Serien</option>' +
              '</select>'
            ) : '') +
            '<select class="sort-select" onchange="setWishlistQuickSort(this.value)" title="Merkliste sortieren">' +
              '<option value="added_desc"' + (state.wlSort === "added_desc" || !state.wlSort ? " selected" : "") + '>🕒 Hinzugefügt: Neueste</option>' +
              '<option value="added_asc"' + (state.wlSort === "added_asc" ? " selected" : "") + '>🕰️ Hinzugefügt: Älteste</option>' +
              '<option value="rating_desc"' + (state.wlSort === "rating_desc" ? " selected" : "") + '>⭐ TMDb-Bewertung (Höchste)</option>' +
              '<option value="rating_asc"' + (state.wlSort === "rating_asc" ? " selected" : "") + '>⭐ TMDb-Bewertung (Niedrigste)</option>' +
              '<option value="year_desc"' + (state.wlSort === "year_desc" ? " selected" : "") + '>📅 Erscheinungsjahr (Neueste)</option>' +
              '<option value="year_asc"' + (state.wlSort === "year_asc" ? " selected" : "") + '>📅 Erscheinungsjahr (Älteste)</option>' +
              '<option value="title_asc"' + (state.wlSort === "title_asc" ? " selected" : "") + '>🔤 Alphabetisch (A–Z)</option>' +
              '<option value="title_desc"' + (state.wlSort === "title_desc" ? " selected" : "") + '>🔤 Alphabetisch (Z–A)</option>' +
            '</select>' +
            '<button type="button" class="btn ' + (isAzVisible ? 'active' : '') + '" style="padding:5px 9px;font-size:11.5px" onclick="toggleWishlistAzBarClient()" title="Alphabetischen A–Z Schnellfilter ein-/ausblenden">🔤 A–Z' + (curWlLetter !== "ALL" ? ' (' + curWlLetter + ')' : ' ▾') + '</button>' +
            '<button type="button" class="btn ' + (isGridMode ? 'active' : '') + '" style="padding:5px 9px;font-size:11.5px" onclick="setWishlistViewMode(\\'grid\\')" title="Als Poster-Raster anzeigen">🖼️ Poster</button>' +
            '<button type="button" class="btn ' + (!isGridMode ? 'active' : '') + '" style="padding:5px 9px;font-size:11.5px" onclick="setWishlistViewMode(\\'list\\')" title="Als kompakte Liste mit Episoden-Auswahl anzeigen">📋 Liste</button>' +
            (hasActiveWlFilters ? '<button type="button" class="btn danger" style="padding:5px 9px;font-size:11.5px" onclick="resetWishlistFiltersQuickClient()" title="Suchtext & Filter zurücksetzen">↺ Reset</button>' : '') +
          '</div>' +
        '</div>';

        root.innerHTML = '<div class="section">' +
          '<div class="section-title">' +
            '<span>💾 Merkliste & Playlisten (<span id="wishlistCountSpan">' + filteredItems.length + '</span> Einträge)</span>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button class="btn blue" onclick="createNewFolderPrompt(true)">➕ Neue Playlist</button>' +
              '<button class="btn ' + (isManageOpen ? 'active' : '') + '" onclick="toggleWishlistFoldersManager()">🗂️ Ordner & Playlisten (' + folders.length + ') ' + (isManageOpen ? '▴' : '▾') + '</button>' +
              '<button class="btn" onclick="goHome()">🏠 Katalog</button>' +
            '</div>' +
          '</div>' +
          '<div class="chip-grid" style="margin-bottom:8px">' + folderBtns + '</div>' +
          smartPlaylistsPanelHtml +
          activeFolderBannerHtml +
          quickFilterBarHtml +
          azBarHtml +
          '<div id="wishlistItemsMount"></div>' +
        '</div>';

        renderWishlistListItemsMountOnly();
      }

      async function loadWishlist(folderFilter) {
        if (document.getElementById("modalRoot")?.innerHTML) {
          closeDetailModal();
        }
        if (folderFilter !== undefined) state.wlFolder = folderFilter;
        state.currentView = "wishlist";
        if (typeof updateFloatingImportStatusBarDom === "function") updateFloatingImportStatusBarDom();
        const root = document.getElementById("appRoot");
        if (!state.isAuthenticated) {
          root.innerHTML = '<div class="section">' +
            '<div class="panel-box" style="border-color:rgba(14,165,233,0.4)">' +
              '<div class="section-title"><span>🔒 Merkliste im Gast-Modus nicht verfügbar</span><button class="btn" onclick="goHome()">🏠 Hauptseite</button></div>' +
              '<p style="font-size:12.5px;color:var(--text-muted);line-height:1.5;margin-bottom:12px">' +
                'Du nutzt die Seite aktuell <b>ohne Telegram initData und ohne eingeloggten Account</b>.<br>' +
                'Im Gast-Modus steht kein persönlicher Speicher (Merkliste) zur Verfügung und ein Zugriff auf andere Telegram-IDs ist gesperrt.' +
              '</p>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                '<button class="btn blue" onclick="openAccountModal()">🔑 Mit abgesichertem Account (Username & Passwort) einloggen</button>' +
                '<button class="btn" onclick="goHome()">🎬 Weiter als Gast stöbern</button>' +
              '</div>' +
            '</div>' +
          '</div>';
          return;
        }
        setBusyState(true, "💾 Lade Merkliste & Custom Playlisten...");
        try {
          const r = await apiFetchJson(API_BASE + "/wishlist");
          const allItems = r.items || [];
          const folders = r.folders || [];
          state.cachedWishlistItems = allItems;
          state.cachedWishlistFolders = folders;

          savedKeysSet.clear();
          allItems.forEach(it => {
            if (it.contentType === "movie" && it.tmdbId) savedKeysSet.add("m_" + it.tmdbId);
            else if (it.contentType === "series" && it.tmdbId) savedKeysSet.add("s_" + it.tmdbId);
          });

          renderWishlistViewDomOnly();
        } finally {
          setBusyState(false);
        }
      }

      async function createNewFolderPrompt(isPlaylist = true) {
        if (!state.isAuthenticated) { openAccountModal(); return; }
        const name = await showCustomPrompt(isPlaylist ? "🎵 Custom Name für die neue Playlist:" : "📁 Name für den neuen Merklisten-Ordner:", "");
        if (!name || !name.trim()) return;
        const r = await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "create_folder", name: name.trim(), isPlaylist: Boolean(isPlaylist) })
        });
        if (!r || !r.ok) {
          showHudToast("⚠️ " + (r?.error || "Konnte nicht erstellt werden."));
          return;
        }
        showHudToast("✅ " + (isPlaylist ? "Playlist" : "Ordner") + " „" + name.trim() + "“ erstellt");
        loadWishlist(state.wlFolder);
      }

      async function togglePlaylistFolderTma(folderId) {
        if (!state.isAuthenticated) return;
        const r = await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "toggle_playlist", folderId })
        });
        if (!r || !r.ok) {
          showHudToast("⚠️ " + (r?.error || "Status konnte nicht geändert werden."));
          return;
        }
        loadWishlist(state.wlFolder);
      }

      async function renamePlaylistFolderTma(folderId, currentName) {
        if (!state.isAuthenticated) return;
        const nextName = await showCustomPrompt("✏️ Neuer Custom Name für die Playlist / den Ordner:", currentName || "");
        if (!nextName || !nextName.trim()) return;
        const r = await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "rename_playlist", folderId, name: nextName.trim() })
        });
        if (!r || !r.ok) {
          showHudToast("⚠️ " + (r?.error || "Umbenennen fehlgeschlagen."));
          return;
        }
        showHudToast("✅ Umbenannt in „" + nextName.trim() + "“");
        loadWishlist(state.wlFolder);
      }

      async function deletePlaylistFolderTma(folderId, currentName) {
        if (!state.isAuthenticated) return;
        const ok = await showCustomConfirm('Playlist "' + (currentName || folderId) + '" inklusive aller zugehörigen Einträge aus der Merkliste löschen?', '🗑️ Löschen');
        if (!ok) return;
        const r = await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "delete_playlist", folderId })
        });
        if (!r || !r.ok) {
          showHudToast("⚠️ " + (r?.error || "Playlist konnte nicht gelöscht werden."));
          return;
        }
        if (state.wlFolder === folderId) state.wlFolder = "root";
        showHudToast("🗑️ Playlist gelöscht");
        loadWishlist(state.wlFolder);
      }

      async function deleteSavedUid(uid) {
        if (!state.isAuthenticated) return;
        const r = await apiFetchJson(API_BASE + "/wishlist", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "delete_uid", uid }) });
        if (!r || !r.ok) {
          showHudToast("⚠️ " + (r?.error || "Eintrag konnte nicht entfernt werden."));
          return;
        }
        loadWishlist(state.wlFolder);
      }

      let activeSettingsSectionTab = "general";

      function switchSettingsSectionTabClient(tabId) {
        triggerTmaHapticClient("selection");
        activeSettingsSectionTab = tabId || "general";
        document.querySelectorAll("[data-settings-tab-btn]").forEach(btn => {
          btn.classList.toggle("blue", btn.getAttribute("data-settings-tab-btn") === activeSettingsSectionTab);
        });
        document.querySelectorAll("[data-settings-sec]").forEach(sec => {
          const secKey = sec.getAttribute("data-settings-sec");
          sec.style.display = (activeSettingsSectionTab === "all" || secKey === activeSettingsSectionTab) ? "block" : "none";
        });
      }

      async function loadSettingsView() {
        state.currentView = "settings";
        if (typeof updateFloatingImportStatusBarDom === "function") updateFloatingImportStatusBarDom();
        updateMediaModeIndicatorDom();
        setBusyState(true, "⚙️ Lade Einstellungen...");
        try {
          const r = await apiFetchJson(API_BASE + "/settings");
          const s = r.settings || {};
          state.settings = s;
          const fskList = r.fskOptions || [];
          const genreList = r.allGenres || [];
          const eraList = r.eraOptions || [];
          const studioList = r.studioOptions || [];
          const platformList = r.platformOptions || [];
          const sync = s.tmdbSync || {};
          const root = document.getElementById("appRoot");

          if (state.sidebarOpen) renderFilterSidebarContent();

          const isAuth = Boolean(state.isAuthenticated && state.authUser);
          const u = state.authUser || {};
          const prevSettingsFocusDfId = (typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.getAttribute)
            ? currentSpatialEl.getAttribute("data-df-id")
            : null;
          const curTab = activeSettingsSectionTab || "general";
          const showSec = (key) => (curTab === "all" || curTab === key) ? "block" : "none";

          root.innerHTML = '<div class="section">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
              '<button class="btn" onclick="goHome()" style="padding:7px 14px;font-size:12.5px">⬅️ Zurück zum Katalog (' + (state.type === 's' ? '📺 Serien' : '🎬 Filme') + ')</button>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button type="button" class="btn ' + (curTab === 'general' ? 'blue' : '') + '" data-settings-tab-btn="general" onclick="switchSettingsSectionTabClient(\\'general\\')">🎛️ Allgemein & Account</button>' +
                '<button type="button" class="btn ' + (curTab === 'delivery' ? 'blue' : '') + '" data-settings-tab-btn="delivery" onclick="switchSettingsSectionTabClient(\\'delivery\\')">📤 Telegram-Versand</button>' +
                '<button type="button" class="btn ' + (curTab === 'shortcuts' ? 'blue' : '') + '" data-settings-tab-btn="shortcuts" onclick="switchSettingsSectionTabClient(\\'shortcuts\\')">⚡ Bot-Befehle</button>' +
                '<button type="button" class="btn ' + (curTab === 'filters' ? 'blue' : '') + '" data-settings-tab-btn="filters" onclick="switchSettingsSectionTabClient(\\'filters\\')">🛡️ Filter-Matrix</button>' +
                '<button type="button" class="btn ' + (curTab === 'all' ? 'blue' : '') + '" data-settings-tab-btn="all" onclick="switchSettingsSectionTabClient(\\'all\\')">📋 Alle zeigen</button>' +
              '</div>' +
            '</div>' +

            '<div data-settings-sec="general" style="display:' + showSec('general') + '">' +
            '<div class="panel-box">' +
              '<div class="section-title">' +
                '<span>🔐 Account & Sicherheit (' + (isAuth ? ('Verbunden: ID ' + esc(u.telegramId)) : '👤 Gast-Modus') + ')</span>' +
                '<div style="display:flex;gap:6px">' +
                  (u.isAdmin ? '<button class="btn blue" onclick="loadAdminPanelView()">👑 Admin-Panel</button>' : '') +
                  '<button class="btn purple" onclick="openAccountModal()">🔑 ' + (isAuth ? (u.hasPasswordAccount ? 'Zugangsdaten verwalten' : 'Passwort festlegen') : 'Jetzt einloggen') + '</button>' +
                '</div>' +
              '</div>' +
              '<p style="font-size:12px;color:var(--muted);line-height:1.5">' +
                (isAuth
                  ? (u.hasPasswordAccount
                      ? '✅ Dein Account ist als <b>' + esc(u.customUsername) + '</b> mit Passwort geschützt. Du kannst dich von jedem Gerät und Browser einloggen.'
                      : '💡 Du bist über Telegram angemeldet. Lege optional einen <b>Benutzernamen & Passwort</b> fest, um dich auch im normalen Webbrowser einzuloggen.')
                  : '⚠️ Im Gast-Modus wird keine persönliche Merkliste synchronisiert. Melde dich an, um deine Favoriten und Einstellungen dauerhaft zu speichern.') +
              '</p>' +
            '</div>' +
            '</div>' +

            '<div data-settings-sec="delivery" style="display:' + showSec('delivery') + '">' +
            (function() {
              const deliv = getDeliveryPreferencesClient();
              const dMode = deliv.targetMode || "dm";
              const customHookUrl = window.location.origin + "/api/telegram/custom-webhook" + (deliv.customBotToken ? ("?botToken=" + encodeURIComponent(deliv.customBotToken)) : "");
              return '<div class="panel-box">' +
                '<div class="section-title">' +
                  '<span>📤 Standard-Versandziel & Gruppen-Zustellung</span>' +
                  '<span style="font-size:11px;color:#0284c7;font-weight:700">Tipp: /id in Gruppe zeigt Chat-ID</span>' +
                '</div>' +
                '<p style="font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:10px">' +
                  'Bestimme, wohin Filme & Serien standardmäßig gesendet werden: in deinen <b>💬 Bot-Privatchat</b>, in eine <b>👥 eigene Ziel-Gruppe</b> oder über deinen <b>🤖 eigenen Telegram-Bot</b>.' +
                '</p>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
                  '<button class="btn ' + (dMode === 'dm' ? 'blue' : '') + '" onclick="saveDeliveryPreferencesClient({targetMode:\\'dm\\'});loadSettingsView()">💬 Bot-Privatchat</button>' +
                  '<button class="btn ' + (dMode === 'group' ? 'blue' : '') + '" onclick="saveDeliveryPreferencesClient({targetMode:\\'group\\'});loadSettingsView()">👥 Eigene Ziel-Gruppe</button>' +
                  '<button class="btn ' + (dMode === 'custom_bot' ? 'blue' : '') + '" onclick="saveDeliveryPreferencesClient({targetMode:\\'custom_bot\\'});loadSettingsView()">🤖 Eigener Bot</button>' +
                '</div>' +
                '<div style="margin-bottom:12px;padding:9px 10px;border-radius:10px;background:rgba(14,165,233,0.06);border:1px solid rgba(56,189,248,0.18)">' +
                  '<div style="font-size:11.5px;font-weight:700;color:var(--text);margin-bottom:4px">📲 Verhalten direkt nach dem Senden</div>' +
                  '<div style="font-size:11px;color:var(--muted);margin-bottom:7px">Springt automatisch zur gesendeten Nachricht im Telegram-Chat, damit man sofort sieht, dass der Bot geliefert hat.</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button class="btn ' + ((deliv.afterSendAction || 'open_minimize') === 'open_minimize' ? 'blue' : '') + '" style="padding:5px 10px;font-size:11.5px" onclick="saveDeliveryPreferencesClient({afterSendAction:\\'open_minimize\\'});loadSettingsView()">💬 Nachricht öffnen &amp; Minimieren</button>' +
                    '<button class="btn ' + (deliv.afterSendAction === 'open_close' ? 'blue' : '') + '" style="padding:5px 10px;font-size:11.5px" onclick="saveDeliveryPreferencesClient({afterSendAction:\\'open_close\\'});loadSettingsView()">✖️ Öffnen &amp; Mini-App schließen</button>' +
                    '<button class="btn ' + (deliv.afterSendAction === 'stay' ? 'blue' : '') + '" style="padding:5px 10px;font-size:11.5px" onclick="saveDeliveryPreferencesClient({afterSendAction:\\'stay\\'});loadSettingsView()">📌 In Mini-App bleiben</button>' +
                  '</div>' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:10px">' +
                  '<div>' +
                    '<div style="font-size:11px;color:var(--muted);margin-bottom:3px">👥 Ziel-Gruppen Chat-ID (z.B. -100...):</div>' +
                    '<input id="settingsTargetGroupIdInp" class="tma-input" value="' + esc(deliv.targetGroupChatId || '') + '" placeholder="-1001234567890" style="width:100%" />' +
                  '</div>' +
                  '<div>' +
                    '<div style="font-size:11px;color:var(--muted);margin-bottom:3px">🧵 Topic / Thread-ID in Ziel-Gruppe (optional):</div>' +
                    '<input id="settingsTargetTopicIdInp" class="tma-input" value="' + esc(deliv.targetTopicId || '') + '" placeholder="z.B. 42" style="width:100%" />' +
                  '</div>' +
                  '<div>' +
                    '<div style="font-size:11px;color:var(--muted);margin-bottom:3px">📦 Quellgruppen-ID (optional):</div>' +
                    '<input id="settingsSourceBridgeIdInp" class="tma-input" value="' + esc(deliv.sourceBridgeChatId || '') + '" placeholder="Automatisch oder ID eintragen" style="width:100%" />' +
                  '</div>' +
                  '<div>' +
                    '<div style="font-size:11px;color:var(--muted);margin-bottom:3px">🤖 Eigenes Bot-Token (@BotFather, optional):</div>' +
                    '<div style="display:flex;gap:4px;align-items:center">' +
                      '<input id="settingsCustomBotTokenInp" class="tma-input" type="password" value="' + esc(deliv.customBotToken || '') + '" placeholder="123456789:ABCdef..." style="width:100%" />' +
                      '<button type="button" class="btn" style="padding:7px 9px;font-size:12px" onclick="togglePasswordVisibilityClient(\\'settingsCustomBotTokenInp\\',this)" title="Bot-Token ein-/ausblenden">👁️</button>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                  '<button class="btn green" onclick="verifyAndConnectCustomBotInSettingsClient()">💾 Einstellungen speichern & Bot verbinden</button>' +
                  '<span style="font-size:11px;color:var(--muted)">Webhook: <code>' + esc(customHookUrl) + '</code></span>' +
                '</div>' +
                '<div id="customBotVerifyStatus" style="font-size:12px;color:#0284c7;margin-top:6px">' +
                  (deliv.customBotUsername ? ('✅ Aktiver eigener Bot: @' + esc(deliv.customBotUsername)) : '') +
                '</div>' +
                '<div class="sidebar-sub-divider" style="margin-top:12px;padding-top:10px">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
                    '<div>' +
                      '<div style="font-size:12px;font-weight:700;color:var(--text)">🧹 Aufbewahrungsdauer für Zustell-Protokolle</div>' +
                      '<div style="font-size:11px;color:var(--muted)">Ältere Zustell-Einträge werden nach Ablauf automatisch bereinigt.</div>' +
                    '</div>' +
                    '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                      '<button type="button" class="btn ' + (Number(deliv.retentionDays || 30) === 7 ? 'blue' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setTmaRetentionPolicyClient(7)">7 Tage</button>' +
                      '<button type="button" class="btn ' + (Number(deliv.retentionDays || 30) === 30 ? 'blue' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setTmaRetentionPolicyClient(30)">30 Tage</button>' +
                      '<button type="button" class="btn ' + (Number(deliv.retentionDays || 30) === 90 ? 'blue' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setTmaRetentionPolicyClient(90)">90 Tage</button>' +
                      '<button type="button" class="btn danger" style="padding:4px 8px;font-size:11px" onclick="clearTmaActivityLogClient()" title="Zustellprotokoll sofort leeren">🗑️ Protokoll leeren</button>' +
                    '</div>' +
                  '</div>' +
                  '<div style="font-size:10.5px;color:#0284c7;margin-bottom:6px">⚡ Aktive KV-TTL: <code>' + (Number(deliv.retentionDays || 30) * 86400) + 's</code> (' + Number(deliv.retentionDays || 30) + ' Tage Auto-Prune in <code>env.MOVIE_SAVED</code>)</div>' +
                  '<div id="tmaActivityLogMount"><div style="font-size:11px;color:var(--muted)">Lade letzte Zustell-Aktivitäten...</div></div>' +
                '</div>' +
              '</div>' +
              buildAntiSpamCockpitBoxHtmlClient();
            })() +
            '</div>' +

            '<div data-settings-sec="general" style="display:' + showSec('general') + '">' +
            '<div class="panel-box">' +
              '<div class="section-title">' +
                '<span>🧭 Steuerung, Maus-Hover & Slider-Einstellungen</span>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:8px">' +
                '<button id="settingsMouseHoverNavBtn" class="btn ' + (mouseHoverNavEnabled ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleMouseHoverNav()">' +
                  '<span>🖱️ Maus-Hover Navigation (Mauszeiger verschiebt Auswahl)</span>' +
                  '<b>' + (mouseHoverNavEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>' +
                '</button>' +
                '<button id="settingsModalHoldNavBtn" class="btn ' + (modalHoldNavEnabled ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleModalHoldNav()">' +
                  '<span>⏩ Detailansicht: Pfeiltaste ⬅️/➡️ gedrückt halten (~450ms) für nächsten/vorherigen Titel</span>' +
                  '<b>' + (modalHoldNavEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>' +
                '</button>' +
                '<button id="settingsHeroToggleBtn" class="btn ' + (!state.heroHidden ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleHeroSliderHidden()">' +
                  '<span>🎬 Spotlight-Banner auf der Startseite</span>' +
                  '<b>' + (state.heroHidden ? 'AUSGEBLENDET' : 'SICHTBAR') + '</b>' +
                '</button>' +
                '<button id="settingsTrailerPreviewBtn" class="btn ' + (trailerPreviewEnabled ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleTrailerPreviewSettingClient()">' +
                  '<span>🎥 Automatische Trailer-Vorschau auf der Detailbühne (Netflix-Modus)</span>' +
                  '<b>' + (trailerPreviewEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>' +
                '</button>' +
              '</div>' +
            '</div>' +
            '</div>' +

            '<div data-settings-sec="shortcuts" style="display:' + showSec('shortcuts') + '">' +
            '<div class="panel-box">' +
              '<div class="section-title">' +
                '<span>⚡ Telegram-Bot Schnellbefehls-Übersicht</span>' +
                '<span style="font-size:11px;color:#0284c7;font-weight:700">f = Film • s = Serie</span>' +
              '</div>' +
              '<p style="font-size:12px;color:var(--muted);margin-bottom:6px">Nutze diese Kurzbefehle jederzeit direkt im Telegram-Bot-Chat (optional auch mit Genre dahinter, z. B. <code>/t f Action</code>):</p>' +
              '<div class="shortcut-cheat-grid">' +
                '<div class="shortcut-cheat-card"><b>🔥 Trending (Filme & Serien)</b><code>/t f   • /trnd f   • /trend f   • /trending f</code><br><code>/t s   • /trnd s   • /trend s   • /trending s</code></div>' +
                '<div class="shortcut-cheat-card"><b>🌟 Populär / Beliebt</b><code>/p f   • /pop f    • /popular f • /populär f</code><br><code>/p s   • /pop s    • /popular s • /populär s</code></div>' +
                '<div class="shortcut-cheat-card"><b>💎 Geheimtipps (Secret Gems)</b><code>/sc f  • /sec f    • /secret f  • /geheim f</code><br><code>/sc s  • /sec s    • /secret s  • /geheim s</code></div>' +
                '<div class="shortcut-cheat-card"><b>🎲 Zufalls-Tipp (mit Genre optional)</b><code>/r f   • /rand f   • /random f  • /r f Action</code><br><code>/r s   • /rand s   • /random s  • /r s Sci-Fi</code></div>' +
              '</div>' +
            '</div>' +
            '</div>' +

            '<div data-settings-sec="general" style="display:' + showSec('general') + '">' +
            '<div class="panel-box">' +
              '<div class="section-title">' +
                '<span>🎬 Instant-Trailer Provider (Direktwiedergabe aus der Übersicht)</span>' +
                '<span style="font-size:11.5px;color:var(--muted);font-weight:700">Aktiv: <b style="color:var(--text)">' + esc(getTrailerProviderLabel(trailerProvider)) + '</b></span>' +
              '</div>' +
              '<p style="font-size:12px;color:var(--muted);margin-bottom:8px">Wähle deinen bevorzugten Video-Anbieter, wenn du auf einer Film-/Serienkarte direkt auf <b>▶ Trailer</b> tippst:</p>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                TRAILER_PROVIDERS_CLIENT.map(tp =>
                  '<button class="btn ' + (trailerProvider === tp.id ? 'blue' : '') + '" onclick="setTrailerProvider(\\'' + escJs(tp.id) + '\\');loadSettingsView()">' + esc(tp.label) + (trailerProvider === tp.id ? ' ✓' : '') + '</button>'
                ).join("") +
              '</div>' +
            '</div>' +
            '</div>' +
            '<div data-settings-sec="filters" style="display:' + showSec('filters') + '">' +
            '<div class="panel-box">' +
              '<div class="section-title"><span>🛡️ Bot-Filter Cockpit (Steuerung über ✓ Positiv & ✕ Negativ)</span>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                  '<button class="btn danger" onclick="restartApp()">🗑️ Alle Filter zurücksetzen</button>' +
                  '<button class="btn" onclick="goHome()">🏠 Zur Hauptseite</button>' +
                '</div>' +
              '</div>' +
              '<p style="font-size:12px;color:var(--muted);margin-bottom:10px">Schalte Filter gezielt über <b>✓ (Einschließen)</b> und <b>✕ (Ausschließen)</b>. Ein erneuter Klick setzt den Filter wieder auf Neutral.</p>' +
              (isCurrentUserVip() ? (
                '<div style="font-size:12.5px;font-weight:700;margin:8px 0 6px;color:#0284c7">🌟 Exklusiver VIP-Stream Filter (#13):</div>' +
                '<div class="direct-filter-grid" style="margin-bottom:10px">' +
                  renderDirectFilterOptionCard("vip_streams", "vip_streams", "🌟 Nur Titel mit verfügbarem VIP-Stream", Boolean(s.onlyVipStreams), false) +
                '</div>'
              ) : '') +
              '<div style="font-size:12.5px;font-weight:700;margin:10px 0 6px">📺 Streaming-Plattformen:</div>' +
              '<div class="direct-filter-grid">' + platformList.map(pl => {
                const inc = (s.includedPlatforms || []).includes(pl.id);
                const ex = (s.excludedPlatforms || []).includes(pl.id);
                return renderDirectFilterOptionCard("platform", pl.id, esc((pl.icon || "📺") + " " + pl.label), inc, ex);
              }).join("") + '</div>' +
              '<div style="font-size:12.5px;font-weight:700;margin:12px 0 6px">🎞️ Genres:</div>' +
              '<div class="direct-filter-grid">' + genreList.map(g => {
                const inc = (s.includedGenres || []).includes(g);
                const ex = (s.excludedGenres || []).includes(g);
                return renderDirectFilterOptionCard("genre", g, genreEmoji(g) + " " + esc(g), inc, ex);
              }).join("") + '</div>' +
              '<div style="font-size:12.5px;font-weight:700;margin:12px 0 6px">📅 Erscheinungsjahre / Epochen:</div>' +
              '<div class="direct-filter-grid">' + eraList.map(e => {
                const inc = (s.includedEras || []).includes(e.id);
                const ex = (s.excludedEras || []).includes(e.id);
                return renderDirectFilterOptionCard("era", e.id, "📅 " + esc(e.label), inc, ex);
              }).join("") + '</div>' +
              '<div style="font-size:12.5px;font-weight:700;margin:12px 0 6px">🏢 Filmstudios:</div>' +
              '<div class="direct-filter-grid">' + studioList.map(st => {
                const inc = (s.includedStudios || []).includes(st.id);
                const ex = (s.excludedStudios || []).includes(st.id);
                return renderDirectFilterOptionCard("studio", st.id, esc((st.icon || "🏢") + " " + st.label), inc, ex);
              }).join("") + '</div>' +
              '<div style="font-size:12.5px;font-weight:700;margin:12px 0 6px">🔞 FSK-Altersfreigaben & Unveröffentlichte:</div>' +
              '<div class="direct-filter-grid">' + fskList.map(f => {
                const inc = (s.includedFsk || []).includes(f);
                const ex = (s.excludedFsk || []).includes(f);
                return renderDirectFilterOptionCard("fsk", f, "🔞 " + esc(f), inc, ex);
              }).join("") +
              renderDirectFilterOptionCard("unreleased", "unreleased", "🗓️ Unveröffentlicht", Boolean(s.showUnreleased), false) +
              '</div>' +
            '</div>' +
            '</div>' +
            '<div data-settings-sec="general" style="display:' + showSec('general') + '">' +
            (isAuth ? (
              '<div class="panel-box">' +
                '<div class="section-title"><span>🌐 Optionale TMDB-Konto Synchronisierung</span>' +
                  (sync.enabled ? '<span style="color:#34d399;font-size:12px">✅ Verbunden als ' + esc(sync.username || 'TMDB-User') + '</span>' : '<span style="color:#aaa;font-size:12px">Optional</span>') +
                '</div>' +
                '<p style="font-size:12px;color:#aaa;margin-bottom:10px">Verbinde optional dein persönliches TheMovieDB-Konto, um deine TMDB-Watchlist & Favoriten automatisch mit deiner Bot-Merkliste zu synchronisieren.</p>' +
                (sync.enabled ? (
                  '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                    '<button class="btn green" onclick="runTmdbSyncNow()">🔄 Jetzt Watchlist & Favoriten synchronisieren</button>' +
                    '<button class="btn danger" onclick="disconnectTmdbSync()">🔌 TMDB-Verbindung trennen</button>' +
                  '</div>'
                ) : (
                  '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                    '<button class="btn red" onclick="startTmdbAuth()">🔗 1. Mit TMDB verbinden (Login öffnen)</button>' +
                    (state.pendingTmdbToken ? '<button class="btn green" onclick="completeTmdbAuth()">✅ 2. Nach Freigabe hier bestätigen</button>' : '') +
                  '</div>'
                )) +
                '<div id="tmdbSyncStatus" style="font-size:12px;color:#fbbf24;margin-top:8px"></div>' +
              '</div>'
            ) : '') +
            '</div>' +
          '</div>';
          if (typeof loadTmaActivityLogPreviewClient === "function") {
            loadTmaActivityLogPreviewClient();
          }
          if (typeof pollAntiSpamQueueClient === "function") {
            pollAntiSpamQueueClient(true);
          }
          if (prevSettingsFocusDfId && typeof CSS !== "undefined" && CSS.escape) {
            const restoredEl = root.querySelector('[data-df-id="' + CSS.escape(prevSettingsFocusDfId) + '"]');
            if (restoredEl) setSpatialFocus(restoredEl, false);
          }
        } finally {
          setBusyState(false);
        }
      }
