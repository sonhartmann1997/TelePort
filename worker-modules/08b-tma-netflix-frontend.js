        state.searchMatchedStudios = [];
        state.searchEntitiesExpanded = false;
        document.body.classList.remove("search-active-dim");
        closeAutocomplete();
        if (state.isSearchMode) goHome();
      }

      function onSearchInputFocus() {
        updateSearchClearBtnVisibility();
        state.searchFocused = true;
      }

      function onSearchInputBlur() {
        setTimeout(() => {
          const inp = document.getElementById("searchInput");
          const val = (inp ? inp.value : "").trim();
          updateSearchClearBtnVisibility();
          if (!val && !state.isSearchMode) {
            state.searchFocused = false;
          }
          closeAutocomplete();
        }, 220);
      }

      function closeAutocomplete() {
        const box = document.getElementById("searchAutocompleteBox");
        if (box) {
          box.classList.remove("open");
          box.innerHTML = "";
        }
      }

      function onSearchScopeChange(newScope) {
        const selEl = document.getElementById("searchScopeSelect");
        const resolvedScope = newScope || (selEl && selEl.value) || "all";
        state.searchScope = resolvedScope;
        const inp = document.getElementById("searchInput");
        if (inp && inp.value.trim()) {
          runSearch(false, inp.value.trim(), state.searchScope);
        } else if (state.isSearchMode && state.searchQuery) {
          runSearch(false, state.searchQuery, state.searchScope);
        }
      }

      function toggleSearchDetectedEntities() {
        state.searchEntitiesExpanded = !state.searchEntitiesExpanded;
        const box = document.getElementById("searchDetectedEntitiesBody");
        const iconEl = document.getElementById("searchDetectedEntitiesToggleIcon") || document.getElementById("searchDetectedEntitiesChevron");
        if (box) {
          box.style.display = state.searchEntitiesExpanded ? "flex" : "none";
        }
        if (iconEl) {
          iconEl.textContent = state.searchEntitiesExpanded ? "Ausblenden ▴" : "Anzeigen ▾";
        }
      }

      let liveSearchReqSeq = 0;

      function onSearchInputLive(rawVal) {
        updateSearchClearBtnVisibility();
        const q = String(rawVal || "").trim();
        state.searchFocused = true;
        if (liveSearchDebounceTimer) clearTimeout(liveSearchDebounceTimer);
        if (!q) {
          closeAutocomplete();
          return;
        }
        const mySeq = ++liveSearchReqSeq;
        liveSearchDebounceTimer = setTimeout(async () => {
          try {
            const res = await apiFetchJson(
              API_BASE + "/search?chatId=" + encodeURIComponent(chatId) +
              "&q=" + encodeURIComponent(q) +
              "&scope=" + encodeURIComponent(state.searchScope || "all") +
              "&sort=" + encodeURIComponent(state.sort)
            );
            if (mySeq !== liveSearchReqSeq || !res || !res.ok) return;
            state.searchMatchedCollections = res.collections || [];
            state.searchMatchedUniverses = res.universes || [];
            state.searchMatchedPersons = res.persons || [];
            state.searchMatchedStudios = res.studios || [];
            state.searchEntitiesExpanded = false;
            renderAutocompleteSuggestions(q, res);
            // Live-Ergebnisse direkt aktualisieren, während man tippt!
            state.isSearchMode = true;
            state.searchQuery = q;
            state.startPage = 1;
            state.page = 1;
            state.totalPages = Math.max(1, Number(res.totalPages) || 1);
            state.hasMorePages = Boolean(res.hasMore ?? (state.page < state.totalPages));
            state.filtersCollapsedInSearch = false;
            state.items = res.items || [];
            state.totalResults = Math.max(state.items.length, Number(res.totalResults) || state.items.length);
            renderDiscover("🔍 Live-Suche: " + q);
          } catch (e) {}
        }, 280);
      }

      function renderAutocompleteSuggestions(q, res) {
        const box = document.getElementById("searchAutocompleteBox");
        if (!box) return;
        const cols = (res.collections || []).slice(0, 4);
        const unis = (res.universes || []).slice(0, 3);
        const studs = (res.studios || []).slice(0, 4);
        const pers = (res.persons || []).slice(0, 4);
        const media = (res.items || []).slice(0, 5);
        if (!cols.length && !unis.length && !studs.length && !pers.length && !media.length) {
          closeAutocomplete();
          return;
        }
        let html = "";
        if (cols.length || unis.length || studs.length) {
          html += '<div class="ac-group-title">🍿 Reihen, 🌌 Universen & 🏢 Filmstudios (Automatisch erkannt)</div>';
          unis.forEach(u => {
            html += '<div class="ac-item" tabindex="0" onclick="closeAutocomplete();openUniverseView(\\'' + esc(u.id) + '\\')">' +
              '<span>' + esc(u.icon || '🌌') + ' <b>' + esc(u.name) + '</b></span>' +
              '<span style="font-size:11px;color:#34d399">Universum öffnen ➔</span>' +
            '</div>';
          });
          cols.forEach(c => {
            html += '<div class="ac-item" tabindex="0" onclick="closeAutocomplete();openCollectionView(' + Number(c.id) + ')">' +
              '<span>🍿 <b>' + esc(c.name) + '</b></span>' +
              '<span style="font-size:11px;color:#a78bfa">Filmreihe öffnen ➔</span>' +
            '</div>';
          });
          studs.forEach(st => {
            const cid = st.companyIds || st.id;
            html += '<div class="ac-item" tabindex="0" onclick="closeAutocomplete();openStudioView(\\'' + esc(String(cid)) + '\\',\\'' + esc(st.name) + '\\',\\'' + esc(st.presetStudioId || '') + '\\')">' +
              '<span>' + esc(st.icon || '🏢') + ' <b>' + esc(st.name) + '</b></span>' +
              '<span style="font-size:11px;color:#f59e0b">Studio-Katalog ➔</span>' +
            '</div>';
          });
        }
        if (pers.length) {
          html += '<div class="ac-group-title">🌟 Personen (Schauspieler & Regie)</div>';
          pers.forEach(p => {
            html += '<div class="ac-item" tabindex="0" onclick="closeAutocomplete();openPersonView(' + Number(p.id) + ',\\'' + esc(p.name) + '\\')">' +
              '<span>🌟 <b>' + esc(p.name) + '</b>' + (p.known_for ? ' <span style="color:#94a3b8;font-size:11px">(' + esc(p.known_for) + ')</span>' : '') + '</span>' +
              '<span style="font-size:11px;color:#38bdf8">Filmografie ➔</span>' +
            '</div>';
          });
        }
        if (media.length) {
          html += '<div class="ac-group-title">🎬 Filme & 📺 Serien (Mit aktiven Filtern)</div>';
          media.forEach(m => {
            const tc = m.media_type === "tv" ? "s" : "m";
            const yr = (m.release_date || m.first_air_date || "").slice(0, 4);
            html += '<div class="ac-item" tabindex="0" onclick="closeAutocomplete();openDetails(\\'' + tc + '\\',' + Number(m.id) + ',false)">' +
              '<span>' + (tc === 's' ? '📺' : '🎬') + ' <b>' + esc(m.title || m.name) + '</b>' + (yr ? ' <span style="color:#94a3b8">(' + esc(yr) + ')</span>' : '') + '</span>' +
              '<span style="font-size:11px;color:#fbbf24">⭐ ' + (m.vote_average ? m.vote_average.toFixed(1) : '–') + '</span>' +
            '</div>';
          });
        }
        box.innerHTML = html;
        box.classList.add("open");
      }

      async function openStudioView(companyId, companyName, presetStudioId = "") {
        document.getElementById("modalRoot").innerHTML = "";
        closeAutocomplete();
        if (presetStudioId) {
          prepareDiscoverContextFromModal();
          await setDirectFilter("studio", presetStudioId, "force_include");
          return;
        }
        state.isSearchMode = false;
        state.searchFocused = false;
        state.searchQuery = "";
        state.currentView = "discover";
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        state.currentCompanyId = String(companyId || "").trim();
        state.currentCompanyName = String(companyName || "Filmstudio").trim();
        const inp = document.getElementById("searchInput");
        if (inp) inp.value = "";
        updateSearchClearBtnVisibility();
        await loadDiscover(state.type || "m", state.genreId || "all", "pop", state.sort || "default", false, true, 1);
      }

      function clearStudioView() {
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        loadDiscover(state.type || "m", state.genreId || "all", state.mode || "trend", state.sort || "default", false, false, 1);
      }

      async function openPersonView(personId, personName) {
        document.getElementById("modalRoot").innerHTML = "";
        closeAutocomplete();
        state.isSearchMode = true;
        state.currentView = "person";
        state.currentPersonId = personId;
        state.currentPersonName = personName || "Person";
        state.searchQuery = personName || "";
        state.filtersCollapsedInSearch = false;
        const inp = document.getElementById("searchInput");
        if (inp && personName) inp.value = personName;
        if (inp && document.activeElement === inp) inp.blur();
        updateSearchClearBtnVisibility();
        setBusyState(true, '🌟 Lade Filme & Serien mit "' + (personName || personId) + '"...');
        try {
          const res = await apiFetchJson(
            API_BASE + "/search?chatId=" + encodeURIComponent(chatId) +
            "&personId=" + encodeURIComponent(personId) +
            "&q=" + encodeURIComponent(personName || "") +
            "&sort=" + encodeURIComponent(state.sort)
          );
          state.items = res.items || [];
          state.currentPersonName = res.personName || personName || "Person";
          renderDiscover("🌟 Person: " + state.currentPersonName);
          if (typeof focusFirstResultCard === "function") focusFirstResultCard(false);
        } finally {
          setBusyState(false);
        }
      }

      function switchType(t) {
        if (state.type === t && !state.isSearchMode && state.currentView === "discover" && !state.currentCompanyId && state.genreId === "all") return;
        pushHistory(() => loadDiscover(state.type, state.genreId, state.mode, state.sort));
        state.type = t;
        state.genreId = "all";
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        state.isSearchMode = false;
        state.searchFocused = false;
        state.searchQuery = "";
        document.body.classList.remove("search-active-dim");
        updateMediaModeIndicatorDom();
        loadDiscover(t, "all", "trend", "default", false, false);
      }

      const CLIENT_PLATFORM_ID_ALIASES = {
        disney: "disneyplus",
        apple: "appletv",
        sky: "wow",
        paramount: "paramountplus",
        rtl: "rtlplus",
        magenta: "magentatv",
        ard: "ard_zdf",
        zdf: "ard_zdf"
      };

      function normalizePlatformIdClient(pid) {
        const clean = String(pid || "").trim().toLowerCase();
        return CLIENT_PLATFORM_ID_ALIASES[clean] || clean;
      }

      function getPlatformDisplayLabelClient(pid) {
        const normId = normalizePlatformIdClient(pid);
        const pl = PLATFORM_OPTIONS_CLIENT.find(p => p.id === normId);
        return pl ? (pl.icon + " " + pl.label) : String(pid || "");
      }

      function selectMode(m) {
        if (!m) return;
        if (m === "franchises") {
          loadFranchisesHub();
          return;
        }
        const nextSort = (state.sort && state.sort !== "default") ? state.sort : "default";
        state.isSearchMode = false;
        state.searchFocused = false;
        document.body.classList.remove("search-active-dim");
        loadDiscover(state.type, state.genreId, m, nextSort, false, false);
      }

      function onModeSelectChange(m) {
        if (!m) return;
        selectMode(String(m));
      }

      function applySortValue(next) {
        if (!next) return;
        if (state.currentView === "collection" && state.currentCollectionId) {
          state.sort = next;
          openCollectionView(state.currentCollectionId);
        } else if (state.currentView === "universe" && state.currentUniverseId) {
          state.sort = next;
          openUniverseView(state.currentUniverseId);
        } else if (state.currentView === "person" && state.currentPersonId) {
          state.sort = next;
          openPersonView(state.currentPersonId, state.currentPersonName);
        } else if (state.isSearchMode && state.searchQuery) {
          state.sort = next;
          runSearch(false);
        } else {
          loadDiscover(state.type, state.genreId, state.mode, next, false, false);
        }
      }

      function onSortSelectChange(val) {
        applySortValue(String(val || "default"));
      }

      async function onProviderFilterSelectChange(providerVal) {
        if (!providerVal || providerVal === "__multi__") return;
        const rawVal = String(providerVal || "all");
        const val = (rawVal === "all" || rawVal === "vip") ? rawVal : normalizePlatformIdClient(rawVal);

        const s = state.settings || (state.settings = {});
        s.filtersActive = true;
        if (val === "all") {
          s.onlyVipStreams = false;
          s.includedPlatforms = [];
          if (state.sort === "added_desc" || state.sort === "added_asc") {
            state.sort = "default";
          }
        } else if (val === "vip") {
          s.onlyVipStreams = true;
          s.includedPlatforms = [];
          if (!state.sort || state.sort === "default") {
            state.sort = "added_desc";
          }
        } else {
          s.onlyVipStreams = false;
          s.includedPlatforms = [val];
          s.excludedPlatforms = (Array.isArray(s.excludedPlatforms) ? s.excludedPlatforms : [])
            .map(normalizePlatformIdClient)
            .filter(x => x !== val);
          if (state.sort === "added_desc" || state.sort === "added_asc") {
            state.sort = "default";
          }
        }
        try {
          localStorage.setItem("tma_cached_settings", JSON.stringify(state.settings));
        } catch (e) {}

        const filterMount = document.getElementById("floatingFilterMount");
        if (filterMount) filterMount.innerHTML = buildFloatingFilterBarHtml();
        if (state.sidebarOpen) renderFilterSidebarContent(false);

        try {
          await apiFetchJson(API_BASE + "/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              action: "set_direct_filter",
              clientSettings: state.settings,
              clientSettingsAuthoritative: true,
              includeDiscover: false,
              includeSearch: false
            })
          });
        } catch (e) {}

        if (state.isSearchMode && state.searchQuery) {
          await runSearch(false);
        } else {
          await loadDiscover(state.type, state.genreId, state.mode || "trend", state.sort || "default", false, false);
        }
      }

      async function onNewReleaseSourceChange(sourceVal) {
        return onProviderFilterSelectChange(sourceVal);
      }

      function toggleSort(prefix) {
        const key = prefix === "vote" ? "rating" : prefix;
        const next = state.sort === key + "_desc" ? key + "_asc" : key + "_desc";
        applySortValue(next);
      }

      async function apiFetchJson(url, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        if (sessionToken) headers["Authorization"] = "Bearer " + sessionToken;
        if (rawInitData) headers["X-Telegram-Init-Data"] = rawInitData;
        if (state.settings && Object.keys(state.settings).length > 0) {
          try {
            headers["X-Tma-Settings"] = encodeURIComponent(JSON.stringify(state.settings));
          } catch (e) {}
        }
        const isImportBatch = String(url || "").includes("/admin/import-batch");
        const timeoutMs = isImportBatch ? 22000 : 11500;
        const doSingleFetch = async (isRetry = false) => {
          const timeoutCtrl = new AbortController();
          const timer = setTimeout(() => {
            try { timeoutCtrl.abort(); } catch (e) {}
          }, timeoutMs);
          if (opts.signal) {
            if (opts.signal.aborted) {
              clearTimeout(timer);
              throw new DOMException("Aborted", "AbortError");
            }
            opts.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              try { timeoutCtrl.abort(); } catch (e) {}
            }, { once: true });
          }
          try {
            const fetchOpts = {
              ...opts,
              headers,
              signal: timeoutCtrl.signal
            };
            if (isRetry) fetchOpts.cache = "no-store";
            const res = await fetch(url, fetchOpts);
            const text = await res.text();
            const trimmed = String(text || "").trim();
            const isHtmlError =
              trimmed.startsWith("<!DOCTYPE") ||
              trimmed.startsWith("<html") ||
              trimmed.includes("<!--[if lt IE 7]>") ||
              res.status === 429 ||
              res.status === 502 ||
              res.status === 503 ||
              res.status === 524;
            if (isHtmlError) {
              const rateErr = new Error(
                "API-Zugriffslimit / Cloudflare Gateway-Pause (HTTP " + (res.status || 524) + ") – automatischer Cooldown aktiv"
              );
              rateErr.isRateLimitOrHtml = true;
              throw rateErr;
            }
            try {
              return JSON.parse(text);
            } catch (e) {
              const cleanSnippet = trimmed.replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ").trim().slice(0, 90);
              const parseErr = new Error("Server-Antwort kein JSON (HTTP " + res.status + "): " + (cleanSnippet || "Leere Antwort"));
              parseErr.isRateLimitOrHtml = res.status >= 500 || res.status === 429;
              throw parseErr;
            }
          } finally {
            clearTimeout(timer);
          }
        };

        const backoffDelays = [1100, 2600, 5200];
        let lastErr = null;
        for (let attempt = 0; attempt <= backoffDelays.length; attempt++) {
          try {
            return await doSingleFetch(attempt > 0);
          } catch (err) {
            lastErr = err;
            if (opts.signal && opts.signal.aborted) throw err;
            if (attempt < backoffDelays.length) {
              const waitMs = err && err.isRateLimitOrHtml ? backoffDelays[attempt] : 450 * (attempt + 1);
              await new Promise(r => setTimeout(r, waitMs));
            }
          }
        }
        throw lastErr || new Error("Netzwerkfehler");
      }

      // =========================================================================
      // 5. DIREKTE 1-KLICK INCLUDE / EXCLUDE FILTER-AKTION (MEHRFACHAUSWAHL-SICHER & OHNE DOUBLE-TOGGLE!)
      // =========================================================================
      function normalizeGenreNameForClient(rawGenre, targetType) {
        const g = String(rawGenre || "").trim();
        if (!g) return "";
        const low = g.toLowerCase();
        const isSeries = (targetType || state.type) === "s";
        if (low === "science fiction" || low === "sci-fi" || low === "scifi") {
          return isSeries ? "Sci-Fi & Fantasy" : "Sci-Fi";
        }
        if (low === "action" && isSeries) return "Action & Adventure";
        if (low === "abenteuer" && isSeries) return "Action & Adventure";
        if (low === "action & adventure" && !isSeries) return "Action";
        if (low === "sci-fi & fantasy" && !isSeries) return "Sci-Fi";
        if (low === "fantasy" && isSeries) return "Sci-Fi & Fantasy";
        if (low === "kriegsfilm" && isSeries) return "War & Politics";
        if (low === "war & politics" && !isSeries) return "Kriegsfilm";
        return g;
      }

      async function setDirectFilter(category, value, mode) {
        const mySeq = ++filterClickSeq;
        if (sidebarFilterDebounceTimer) {
          clearTimeout(sidebarFilterDebounceTimer);
          sidebarFilterDebounceTimer = null;
        }
        if (activeAbortController) {
          try { activeAbortController.abort(); } catch (e) {}
        }

        const s = state.settings || (state.settings = {});
        const applyLocalDirect = (incKey, excKey, val, m) => {
          s[incKey] = Array.isArray(s[incKey]) ? [...s[incKey]] : [];
          s[excKey] = Array.isArray(s[excKey]) ? [...s[excKey]] : [];
          if (m === "force_include") {
            s[excKey] = s[excKey].filter(x => x !== val);
            if (!s[incKey].includes(val)) s[incKey].push(val);
          } else if (m === "include") {
            if (s[incKey].includes(val)) s[incKey] = s[incKey].filter(x => x !== val);
            else { s[excKey] = s[excKey].filter(x => x !== val); s[incKey].push(val); }
          } else if (m === "exclude") {
            if (s[excKey].includes(val)) s[excKey] = s[excKey].filter(x => x !== val);
            else { s[incKey] = s[incKey].filter(x => x !== val); s[excKey].push(val); }
          } else {
            s[incKey] = s[incKey].filter(x => x !== val);
            s[excKey] = s[excKey].filter(x => x !== val);
          }
        };

        const effectiveVal = category === "genre"
          ? normalizeGenreNameForClient(value, state.type)
          : category === "platform"
            ? normalizePlatformIdClient(value)
            : String(value || "");

        if (category === "genre") {
          applyLocalDirect("includedGenres", "excludedGenres", effectiveVal, mode);
          state.genreId = "all";
        } else if (category === "platform") {
          s.includedPlatforms = Array.isArray(s.includedPlatforms) ? s.includedPlatforms.map(normalizePlatformIdClient) : [];
          s.excludedPlatforms = Array.isArray(s.excludedPlatforms) ? s.excludedPlatforms.map(normalizePlatformIdClient) : [];
          applyLocalDirect("includedPlatforms", "excludedPlatforms", effectiveVal, mode);
        }
        else if (category === "era") applyLocalDirect("includedEras", "excludedEras", effectiveVal, mode);
        else if (category === "studio") applyLocalDirect("includedStudios", "excludedStudios", effectiveVal, mode);
        else if (category === "fsk") applyLocalDirect("includedFsk", "excludedFsk", effectiveVal, mode);
        else if (category === "unreleased") {
          if (mode === "include" || mode === "force_include") s.showUnreleased = true;
          else if (mode === "exclude" || mode === "neutral") s.showUnreleased = false;
          else s.showUnreleased = !Boolean(s.showUnreleased);
        }
        else if (category === "vip_streams") {
          if (mode === "include" || mode === "force_include") s.onlyVipStreams = true;
          else if (mode === "exclude" || mode === "neutral") s.onlyVipStreams = false;
          else s.onlyVipStreams = !Boolean(s.onlyVipStreams);
        }
        else if (category === "reset_all") {
          s.includedGenres = []; s.excludedGenres = [];
          s.includedPlatforms = []; s.excludedPlatforms = [];
          s.includedEras = []; s.excludedEras = [];
          s.includedStudios = []; s.excludedStudios = [];
          s.includedFsk = []; s.excludedFsk = [];
          s.showUnreleased = false;
          s.onlyVipStreams = false;
          state.newReleaseSource = "all";
          state.genreId = "all";
        }
        s.filtersActive = true;

        try {
          localStorage.setItem("tma_cached_settings", JSON.stringify(state.settings));
        } catch (e) {}

        // Sofortiges lokales UI-Update (0 ms) für Pills & Sidebar-Buttons (#8)
        const filterMount = document.getElementById("floatingFilterMount");
        if (filterMount) filterMount.innerHTML = buildFloatingFilterBarHtml();
        if (state.sidebarOpen) renderFilterSidebarContent(false);

        const executeRemoteFilterSync = async () => {
          activeAbortController = new AbortController();
          setBusyState(true, "⏳ Filter aktiv – aktualisiere passende " + (state.type === "s" ? "Serien" : "Filme") + "...");
          try {
            const actionName = category === "reset_all"
              ? "reset_all_filters"
              : category === "unreleased"
                ? "toggle_unreleased"
                : "set_direct_filter";

            const shouldLoadDiscover = !state.isSearchMode && (
              state.currentView === "discover" ||
              state.currentView === "wishlist" ||
              state.currentView === "franchises"
            );

            const res = await apiFetchJson(API_BASE + "/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: activeAbortController.signal,
              body: JSON.stringify({
                chatId,
                action: actionName,
                category,
                value: effectiveVal,
                mode: mode === "force_include" ? "include" : mode,
                clientSettings: state.settings,
                clientSettingsAuthoritative: true,
                includeDiscover: shouldLoadDiscover,
                includeSearch: state.isSearchMode && state.currentView !== "person",
                searchQuery: state.searchQuery,
                type: state.type,
                genreId: state.genreId,
                discoverMode: state.mode,
                sort: state.sort
              })
            });

            if (mySeq !== filterClickSeq) return;
            if (res && res.settings) {
              state.settings = res.settings;
              try {
                localStorage.setItem("tma_cached_settings", JSON.stringify(state.settings));
              } catch (e) {}
            }
            if (state.sidebarOpen) renderFilterSidebarContent(false);

            if (state.currentView === "settings") {
              await loadSettingsView();
            } else if (state.currentView === "collection" && state.currentCollectionId) {
              await openCollectionView(state.currentCollectionId);
            } else if (state.currentView === "universe" && state.currentUniverseId) {
              await openUniverseView(state.currentUniverseId);
            } else if (state.currentView === "person" && state.currentPersonId) {
              await openPersonView(state.currentPersonId, state.currentPersonName);
            } else if (state.isSearchMode && res && res.search) {
              state.startPage = 1;
              state.page = 1;
              state.items = res.search.items || [];
              state.totalPages = Math.max(1, Number(res.search.totalPages) || 1);
              state.totalResults = Math.max(state.items.length, Number(res.search.totalResults) || state.items.length);
              state.hasMorePages = Boolean(res.search.hasMore ?? (state.items.length >= 12));
              renderDiscover("🔍 Suchergebnisse: " + state.searchQuery);
              if (!state.sidebarOpen && typeof focusFirstResultCard === "function") focusFirstResultCard(false);
            } else if (res && res.discover) {
              state.currentView = "discover";
              state.startPage = 1;
              state.page = 1;
              state.items = res.discover.items || [];
              state.totalPages = Math.max(1, Number(res.discover.totalPages) || 1);
              state.totalResults = Math.max(state.items.length, Number(res.discover.totalResults) || state.items.length);
              state.hasMorePages = Boolean(res.discover.hasMore ?? (state.items.length >= 12));
              state.genres = res.discover.genres || state.genres;
              rebuildHeroSlides(state.items);
              renderDiscover();
              if (!state.sidebarOpen && typeof focusFirstResultCard === "function") focusFirstResultCard(false);
            } else {
              if (state.isSearchMode) await runSearch(false);
              else await loadDiscover(state.type, state.genreId, state.mode, state.sort, false, false);
            }
          } catch (err) {
            if (err && err.name === "AbortError") return;
          } finally {
            if (mySeq === filterClickSeq) setBusyState(false);
          }
        };

        // Sanftes Batch-Debounce (200 ms) bei geöffnetem Filter-Drawer (#8), damit schnelle Mehrfach-Klicks gebündelt werden
        if (state.sidebarOpen && category !== "reset_all") {
          sidebarFilterDebounceTimer = setTimeout(executeRemoteFilterSync, 200);
        } else {
          await executeRemoteFilterSync();
        }
      }

      function toggleFilterDropdown(tabKey) {
        toggleFilterSidebar(tabKey || "genres");
      }

      function toggleSearchFilterCollapse() {
        state.filtersCollapsedInSearch = !state.filtersCollapsedInSearch;
        const filterMount = document.getElementById("floatingFilterMount");
        if (filterMount) filterMount.innerHTML = buildFloatingFilterBarHtml();
      }

      async function triggerRandom() {
        const isMovie = state.type !== "s";
        setBusyState(true, "🎲 Ziehe zufälligen " + (isMovie ? "Film" : "Serien-Tipp") + " mit deinen aktiven Filtern...");
        try {
          const r = await apiFetchJson(API_BASE + "/discover?chatId=" + encodeURIComponent(chatId) + "&type=" + state.type + "&genreId=" + state.genreId + "&mode=random");
          if (r.items && r.items[0]) {
            await openDetails(state.type, r.items[0].id);
          } else {
            showHudToast("⚠️ Kein Zufallstreffer mit den aktuellen Filtern gefunden.");
          }
        } catch (e) {} finally {
          setBusyState(false);
        }
      }

      function buildSkeletonCardsHtml(count) {
        const targetCount = count || Math.max(12, (state.items && state.items.length) ? state.items.length : 20);
        let html = "";
        for (let i = 0; i < targetCount; i++) {
          html += '<div class="skeleton-card" data-skeleton="1">' +
            '<div class="skeleton-poster"></div>' +
            '<div class="skeleton-body">' +
              '<div class="skeleton-line"></div>' +
              '<div class="skeleton-line short"></div>' +
            '</div>' +
          '</div>';
        }
        return html;
      }

      async function loadDiscover(type, genreId, mode, sort, bypass = false, jumpToCards = false, targetPage = 1) {
        state.type = type; state.genreId = genreId; state.mode = mode; state.sort = sort;
        const pageNum = Math.max(1, Number(targetPage) || 1);
        state.startPage = pageNum;
        state.page = pageNum;
        state.hasMorePages = false;
        state.loadingMore = false;
        state.isSearchMode = false;
        state.searchFocused = false;
        state.currentView = "discover";
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        document.body.classList.remove("search-active-dim");
        updateMediaModeIndicatorDom();
        syncSearchGenreSelectDom();
        const root = document.getElementById("appRoot");
        const existingGrid = document.getElementById("resultsGridContainer");
        if (existingGrid) {
          existingGrid.innerHTML = buildSkeletonCardsHtml();
        }
        setBusyState(true, "⏳ Lade " + (type === "s" ? "Serien" : "Filme") + (pageNum > 1 ? (" (Seite " + pageNum + ")") : "") + "...");
        try {
          const companyQueryParam = state.currentCompanyId ? ("&companyId=" + encodeURIComponent(state.currentCompanyId)) : "";
          const res = await apiFetchJson(API_BASE + "/discover?chatId=" + encodeURIComponent(chatId) + "&type=" + type + "&genreId=" + genreId + "&mode=" + mode + "&sort=" + sort + "&page=" + pageNum + "&bypass=" + (bypass ? "1" : "0") + companyQueryParam);
          state.items = res.items || [];
          state.totalPages = Math.max(1, Number(res.totalPages) || 1);
          state.totalResults = Math.max(state.items.length, Number(res.totalResults) || state.items.length);
          state.hasMorePages = Boolean(res.hasMore ?? (pageNum < state.totalPages));
          state.genres = res.genres || {};
          syncSearchGenreSelectDom();
          if (Array.isArray(res.savedKeys)) {
            savedKeysSet = new Set(res.savedKeys);
          }
          if (res.botUsername) state.botUsername = res.botUsername;
          if (res.settings) {
            state.settings = res.settings;
            if (res.settings.uiScale && !localStorage.getItem("tma_ui_scale")) {
              uiScale = { ...DEFAULT_UI_SCALE, ...res.settings.uiScale };
              applyUiScaleToDom();
            }
            if (res.settings.trailerProvider && !localStorage.getItem("tma_trailer_provider")) {
              trailerProvider = res.settings.trailerProvider;
            }
          }
          if (state.sidebarOpen) renderFilterSidebarContent(false);
          if (pageNum === 1) rebuildHeroSlides(state.items);
          if (state.items.length === 0 && res.rawCount > 0 && !bypass) {
            root.innerHTML = '<div class="section">' + buildFloatingFilterBarHtml() + '<div class="panel-box"><div class="section-title">⚠️ Alle ' + res.rawCount + ' Treffer wurden durch deine aktiven Filter ausgeblendet</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn red" onclick="loadDiscover(\\''+type+'\\',\\''+genreId+'\\',\\''+mode+'\\',\\''+sort+'\\',true,false)">🔓 Filter hier temporär deaktivieren</button><button class="btn" onclick="setDirectFilter(\\'reset_all\\',\\'\\',\\'neutral\\')">🗑️ Alle Filter zurücksetzen</button></div></div></div>';
            return;
          }
          renderDiscover();
          if (jumpToCards && typeof focusFirstResultCard === "function") {
            focusFirstResultCard(false);
          }
        } catch (err) {
          root.innerHTML = '<div class="section"><div class="panel-box"><div class="section-title">⚠️ Fehler beim Laden</div><p style="font-size:12px;color:#ccc;margin-bottom:8px">' + esc(err.message) + '</p><button class="btn red" onclick="loadDiscover(\\''+type+'\\',\\''+genreId+'\\',\\''+mode+'\\',\\''+sort+'\\')">🔄 Erneut versuchen</button></div></div>';
        } finally {
          setBusyState(false);
        }
      }

      async function runSearch(bypass = false, overrideQuery = null, overrideScope = null, jumpToResults = true, targetPage = 1) {
        if (liveSearchDebounceTimer) {
          clearTimeout(liveSearchDebounceTimer);
          liveSearchDebounceTimer = null;
        }
        ++liveSearchReqSeq;
        const inp = document.getElementById("searchInput");
        if (overrideQuery !== null && inp) inp.value = overrideQuery;
        updateSearchClearBtnVisibility();
        if (overrideScope !== null) {
          state.searchScope = overrideScope;
          const sel = document.getElementById("searchScopeSelect");
          if (sel) sel.value = overrideScope;
        }
        const q = (overrideQuery !== null ? overrideQuery : (inp ? inp.value : "")).trim();
        if (!q) return;
        if (inp && document.activeElement === inp) {
          inp.blur();
        }
        closeAutocomplete();
        document.getElementById("modalRoot").innerHTML = "";
        const pageNum = Math.max(1, Number(targetPage) || 1);
        const isNewSearchQuery = state.searchQuery !== q || !state.isSearchMode;
        state.isSearchMode = true;
        state.searchFocused = false;
        state.startPage = pageNum;
        state.page = pageNum;
        state.hasMorePages = false;
        state.loadingMore = false;
        state.currentView = "discover";
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        state.searchQuery = q;
        if (isNewSearchQuery && pageNum === 1) {
          state.searchEntitiesExpanded = false;
        }
        state.openFilterDropdown = null;
        state.filtersCollapsedInSearch = false;
        document.body.classList.remove("search-active-dim");
        updateMediaModeIndicatorDom();
        if (heroRotationTimer) clearInterval(heroRotationTimer);

        const root = document.getElementById("appRoot");
        const existingGrid = document.getElementById("resultsGridContainer");
        if (existingGrid) {
          existingGrid.innerHTML = buildSkeletonCardsHtml();
        }
        setBusyState(true, '🔍 Suche nach "' + q + '"' + (pageNum > 1 ? (' (Seite ' + pageNum + ')') : '') + '...');
        try {
          const res = await apiFetchJson(
            API_BASE + "/search?chatId=" + encodeURIComponent(chatId) +
            "&q=" + encodeURIComponent(q) +
            "&scope=" + encodeURIComponent(state.searchScope || "all") +
            "&sort=" + encodeURIComponent(state.sort) +
            "&page=" + pageNum + "&bypass=" + (bypass ? "1" : "0")
          );
          state.searchMatchedCollections = res.collections || [];
          state.searchMatchedUniverses = res.universes || [];
          state.searchMatchedPersons = res.persons || [];
          state.searchMatchedStudios = res.studios || [];
          if ((res.items || []).length === 0 && res.filteredOutCount > 0 && !bypass) {
            root.innerHTML = '<div class="section"><div id="floatingFilterMount">' + buildFloatingFilterBarHtml() + '</div><div class="panel-box"><div class="section-title">⚠️ Keine Treffer wegen aktiver Filter (' + res.filteredOutCount + ' ausgeblendet)</div><button class="btn red" onclick="runSearch(true)">🔓 Filter temporär deaktivieren (Alle ' + res.filteredOutCount + ' zeigen)</button></div></div>';
            if (jumpToResults && typeof focusFirstResultCard === "function") focusFirstResultCard(false);
            return;
          }
          state.items = res.items || [];
          state.totalPages = Math.max(1, Number(res.totalPages) || 1);
          state.totalResults = Math.max(state.items.length, Number(res.totalResults) || state.items.length);
          state.hasMorePages = Boolean(res.hasMore ?? (pageNum < state.totalPages));
          document.body.classList.remove("search-active-dim");
          renderDiscover("🔍 Suchergebnisse: " + q);
          if (jumpToResults && typeof focusFirstResultCard === "function") {
            focusFirstResultCard(false);
          }
        } catch (err) {
          root.innerHTML = '<div class="section"><div class="panel-box">⚠️ Fehler bei der Suche: ' + esc(err.message) + '</div></div>';
        } finally {
          document.body.classList.remove("search-active-dim");
          setBusyState(false);
        }
      }

      // Direkt-Seitenwahl (#17) für Discover & Suche (ohne Seiten-Springen!)
      async function jumpToPage(targetPage) {
        const p = Math.max(1, Math.min(Number(state.totalPages) || 1, Number(targetPage) || 1));
        if (state.loadingMore) return;
        if (state.isSearchMode && state.searchQuery) {
          await runSearch(false, state.searchQuery, state.searchScope, false, p);
        } else {
          await loadDiscover(state.type, state.genreId, state.mode, state.sort, false, false, p);
        }
      }

      // Endlos-Scrollen / „Mehr laden“-Pagination für Entdecken- & Such-Grid (#2 & #21)
      async function loadMoreResults() {
        if (state.loadingMore || !state.hasMorePages) return;
        const nextPage = (Number(state.page) || 1) + 1;
        state.loadingMore = true;
        const loadBtn = document.getElementById("loadMoreGridBtn");
        if (loadBtn) {
          loadBtn.disabled = true;
          loadBtn.textContent = "⏳ Lade Seite " + nextPage + "...";
        }
        // Sanfte Skeleton-Platzhalter (#21) direkt im Grid anhängen statt Ausgrauen!
        const gridEl = document.getElementById("resultsGridContainer");
        if (gridEl) {
          const loadWrap = gridEl.querySelector(".load-more-wrap");
          if (loadWrap) {
            loadWrap.insertAdjacentHTML("beforebegin", buildSkeletonCardsHtml(6));
          }
        }
        setBusyState(true, "⏳ Lade Seite " + nextPage + " nach...");
        try {
          let res = null;
          if (state.isSearchMode && state.searchQuery) {
            res = await apiFetchJson(
              API_BASE + "/search?chatId=" + encodeURIComponent(chatId) +
              "&q=" + encodeURIComponent(state.searchQuery) +
              "&scope=" + encodeURIComponent(state.searchScope || "all") +
              "&sort=" + encodeURIComponent(state.sort) +
              "&page=" + nextPage
            );
          } else {
            const companyQueryParam = state.currentCompanyId ? ("&companyId=" + encodeURIComponent(state.currentCompanyId)) : "";
            res = await apiFetchJson(
              API_BASE + "/discover?chatId=" + encodeURIComponent(chatId) +
              "&type=" + state.type +
              "&genreId=" + state.genreId +
              "&mode=" + state.mode +
              "&sort=" + state.sort +
              "&page=" + nextPage +
              companyQueryParam
            );
          }
          const incoming = (res && Array.isArray(res.items)) ? res.items : [];
          const existingKeys = new Set(state.items.map(it => {
            const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : state.type;
            return tc + "_" + it.id;
          }));
          const freshItems = incoming.filter(it => {
            if (!it || !it.id) return false;
            const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : state.type;
            const k = tc + "_" + it.id;
            if (existingKeys.has(k)) return false;
            existingKeys.add(k);
            return true;
          });
          const firstNewItem = freshItems[0] || null;
          state.page = nextPage;
          if (res && res.totalPages) {
            state.totalPages = Math.max(nextPage, Number(res.totalPages) || 1);
          }
          state.items = [...state.items, ...freshItems];
          if (res && res.totalResults) {
            state.totalResults = Math.max(state.items.length, Number(res.totalResults) || state.items.length);
          } else {
            state.totalResults = Math.max(state.items.length, Number(state.totalResults) || state.items.length);
          }
          state.hasMorePages = Boolean(res && res.hasMore && freshItems.length > 0);
          renderDiscover(state.isSearchMode ? ("🔍 Suchergebnisse: " + state.searchQuery) : undefined);
          if (firstNewItem) {
            const firstNewTc = firstNewItem.media_type === "tv" ? "s" : firstNewItem.media_type === "movie" ? "m" : state.type;
            const firstNewCard = document.querySelector('.card[data-card-key="' + firstNewTc + '_' + firstNewItem.id + '"]');
            if (firstNewCard && typeof jumpSpatialFocus === "function") {
              jumpSpatialFocus(firstNewCard, false);
            }
          }
        } catch (e) {
          if (gridEl) {
            gridEl.querySelectorAll('[data-skeleton="1"]').forEach(el => el.remove());
          }
          showHudToast("⚠️ Weitere Ergebnisse konnten nicht geladen werden.");
        } finally {
          state.loadingMore = false;
          setBusyState(false);
        }
      }

      function renderDirectFilterOptionCard(category, itemValue, displayLabel, isInc, isExc) {
        const stateCls = isInc ? "state-inc" : isExc ? "state-exc" : "";
        const dfBaseId = esc(category + ":" + itemValue);
        const incBtnHtml = isInc
          ? '<button class="df-btn inc active is-neutral-on-select" data-df-id="' + dfBaseId + ':inc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + esc(itemValue) + '\\',\\'neutral\\')" title="Aktiviert – Auswählen setzt auf Neutral (○)"><span class="df-ico-cur">✓</span><span class="df-ico-sel">○</span></button>'
          : '<button class="df-btn inc" data-df-id="' + dfBaseId + ':inc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + esc(itemValue) + '\\',\\'include\\')" title="Positiv aktivieren (✓)">✓</button>';
        const excBtnHtml = isExc
          ? '<button class="df-btn exc active is-neutral-on-select" data-df-id="' + dfBaseId + ':exc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + esc(itemValue) + '\\',\\'neutral\\')" title="Gesperrt – Auswählen setzt auf Neutral (○)"><span class="df-ico-cur">✕</span><span class="df-ico-sel">○</span></button>'
          : '<button class="df-btn exc" data-df-id="' + dfBaseId + ':exc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + esc(itemValue) + '\\',\\'exclude\\')" title="Negativ ausschließen (✕)">✕</button>';
        return '<div class="direct-filter-card ' + stateCls + '">' +
          '<span class="df-label">' +
            displayLabel +
          '</span>' +
          '<div class="df-actions">' +
            incBtnHtml +
            excBtnHtml +
          '</div>' +
        '</div>';
      }

      function buildFloatingFilterBarHtml() {
        const s = state.settings || {};
        const rawIncPlatforms = Array.isArray(s.includedPlatforms) ? s.includedPlatforms : [];
        const incPlatforms = Array.from(new Set(rawIncPlatforms.map(normalizePlatformIdClient).filter(Boolean)));
        const rawExcPlatforms = Array.isArray(s.excludedPlatforms) ? s.excludedPlatforms : [];
        const excPlatforms = Array.from(new Set(rawExcPlatforms.map(normalizePlatformIdClient).filter(Boolean)));
        const pills = [];

        if (state.currentCompanyId) {
          pills.push('<span class="f-pill inc" tabindex="0" onclick="clearStudioView()" title="Aktiver Studio-Filter – Antippen zum Entfernen">🏢 ' + esc(state.currentCompanyName || "Studio") + ' ✕</span>');
        }

        if (state.genreId && state.genreId !== "all") {
          const genreMap = (Object.keys(state.genres || {}).length > 0)
            ? state.genres
            : (state.type === "s" ? SERIES_GENRES_CLIENT : MOVIE_GENRES_CLIENT);
          const gEntry = Object.entries(genreMap).find(([, id]) => String(id) === String(state.genreId));
          const gName = gEntry ? gEntry[0] : "Genre";
          pills.push('<span class="f-pill inc" tabindex="0" onclick="onSearchGenreSelectChange(\\'all\\')" title="Aktiver Filter – Antippen zum Entfernen">' + genreEmoji(gName) + ' ' + esc(gName) + ' ✕</span>');
        }

        (s.includedGenres || []).forEach(g => {
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'genre\\',\\''+esc(g)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">' + genreEmoji(g) + ' ' + esc(g) + ' ✕</span>');
        });
        (s.excludedGenres || []).forEach(g => {
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'genre\\',\\''+esc(g)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">' + genreEmoji(g) + ' ' + esc(g) + ' ✕</span>');
        });

        if (incPlatforms.length > 1) {
          incPlatforms.forEach(pid => {
            const label = getPlatformDisplayLabelClient(pid);
            pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'platform\\',\\''+esc(pid)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">' + esc(label) + ' ✕</span>');
          });
        }
        excPlatforms.forEach(pid => {
          const label = getPlatformDisplayLabelClient(pid);
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'platform\\',\\''+esc(pid)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">' + esc(label) + ' ✕</span>');
        });

        (s.includedEras || []).forEach(eid => {
          const er = ERA_OPTIONS_CLIENT.find(e => e.id === eid);
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'era\\',\\''+esc(eid)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">📅 ' + esc(er ? er.label : eid) + ' ✕</span>');
        });
        (s.excludedEras || []).forEach(eid => {
          const er = ERA_OPTIONS_CLIENT.find(e => e.id === eid);
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'era\\',\\''+esc(eid)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">📅 ' + esc(er ? er.label : eid) + ' ✕</span>');
        });

        (s.includedStudios || []).forEach(sid => {
          const st = STUDIO_OPTIONS_CLIENT.find(x => x.id === sid);
          const label = st ? (st.icon + " " + st.label) : sid;
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'studio\\',\\''+esc(sid)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">' + esc(label) + ' ✕</span>');
        });
        (s.excludedStudios || []).forEach(sid => {
          const st = STUDIO_OPTIONS_CLIENT.find(x => x.id === sid);
          const label = st ? (st.icon + " " + st.label) : sid;
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'studio\\',\\''+esc(sid)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">' + esc(label) + ' ✕</span>');
        });

        (s.includedFsk || []).forEach(f => {
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'fsk\\',\\''+esc(f)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">🔞 ' + esc(f) + ' ✕</span>');
        });
        (s.excludedFsk || []).forEach(f => {
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'fsk\\',\\''+esc(f)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">🔞 ' + esc(f) + ' ✕</span>');
        });

        if (s.showUnreleased) {
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'unreleased\\',\\'\\',\\'toggle\\')" title="Unveröffentlichte wieder ausblenden">🗓️ Unreleased ✕</span>');
        }

        const isColView = state.currentView === "collection" && state.currentCollectionId;
        const isUniView = state.currentView === "universe" && state.currentUniverseId;
        const isPerView = state.currentView === "person" && state.currentPersonId;

        const isDiscoverView = !state.isSearchMode && state.currentView === 'discover';
        const curMode = state.mode || 'trend';
        const curSort = state.sort || "default";

        // Smart-Cockpit Sortierlogik (inspiriert von JustWatch & Netflix):
        // - "📥 Hinzugefügt am ▼/▲" NUR anzeigen, wenn 🌟 Nur VIP-Streams aktiv ist!
        // - Volle Sortier-Kriterien (Beliebt, Bewertung, Jahr) zeigen bei Suche, Genre-Filter, Studio-Filter, Kollektion/Universum/Person.
        // - Bei reinem Modus-Browsen (Trending/Beliebt/Top/Neuheiten + z.B. Netflix) kompakte Auf-/Absteigend-Richtungswahl anbieten statt redundanter Kriterien.
        const isVipActive = Boolean(s.onlyVipStreams && isCurrentUserVip());
        const hasGenreOrStudioActive = Boolean(
          (state.genreId && state.genreId !== "all") ||
          state.currentCompanyId ||
          (Array.isArray(s.includedGenres) && s.includedGenres.length > 0) ||
          (Array.isArray(s.includedStudios) && s.includedStudios.length > 0) ||
          (Array.isArray(s.includedEras) && s.includedEras.length > 0)
        );
        const showFullSortCriteria = Boolean(
          state.isSearchMode ||
          isVipActive ||
          hasGenreOrStudioActive ||
          isColView ||
          isUniView ||
          isPerView
        );

        let sortGroupHtml = "";
        if (showFullSortCriteria) {
          sortGroupHtml = '<select class="sort-select" onchange="onSortSelectChange(this.value)" title="Sortierreihenfolge wählen">' +
            '<option value="default"' + (curSort === 'default' ? ' selected' : '') + '>✨ Sortierung: Standard</option>' +
            (isVipActive ? (
              '<option value="added_desc"' + (curSort === 'added_desc' ? ' selected' : '') + '>📥 Hinzugefügt am ▼</option>' +
              '<option value="added_asc"' + (curSort === 'added_asc' ? ' selected' : '') + '>📥 Hinzugefügt am ▲</option>'
            ) : '') +
            '<option value="pop_desc"' + (curSort === 'pop_desc' ? ' selected' : '') + '>🔥 Beliebt ▼</option>' +
            '<option value="pop_asc"' + (curSort === 'pop_asc' ? ' selected' : '') + '>🔥 Beliebt ▲</option>' +
            '<option value="rating_desc"' + (curSort === 'rating_desc' ? ' selected' : '') + '>⭐ Bewertung ▼</option>' +
            '<option value="rating_asc"' + (curSort === 'rating_asc' ? ' selected' : '') + '>⭐ Bewertung ▲</option>' +
            '<option value="year_desc"' + (curSort === 'year_desc' ? ' selected' : '') + '>📅 Jahr ▼</option>' +
            '<option value="year_asc"' + (curSort === 'year_asc' ? ' selected' : '') + '>📅 Jahr ▲</option>' +
          '</select>';
        } else if (curMode !== 'trend') {
          const isAsc = curSort === 'dir_asc' || curSort.endsWith('_asc');
          sortGroupHtml = '<select class="sort-select" onchange="onSortSelectChange(this.value)" title="Reihenfolge umkehren (Absteigend / Aufsteigend)">' +
            '<option value="default"' + (!isAsc ? ' selected' : '') + '>✨ Sortierung: ▼ Absteigend (Standard)</option>' +
            '<option value="dir_asc"' + (isAsc ? ' selected' : '') + '>✨ Sortierung: ▲ Aufsteigend</option>' +
          '</select>';
        }

        // Im Suchmodus KEIN "Modus wählen..." / "Trending" Dropdown anzeigen! Stattdessen den Such-Bereich (Alles / Filme / Serien / Person / Reihe) anbieten:
        const curScope = state.searchScope || 'all';
        const modeOrScopeHtml = state.isSearchMode
          ? (
            '<select id="searchScopeSelect" class="mode-filter-select active-mode" onchange="onSearchScopeChange(this.value)" title="Suchbereich einschränken">' +
              '<option value="all"' + (curScope === 'all' ? ' selected' : '') + '>⚡ Bereich: Alles</option>' +
              '<option value="movie"' + (curScope === 'movie' ? ' selected' : '') + '>🎬 Nur Filme</option>' +
              '<option value="series"' + (curScope === 'series' ? ' selected' : '') + '>📺 Nur Serien</option>' +
              '<option value="person"' + (curScope === 'person' ? ' selected' : '') + '>🌟 Person / Cast</option>' +
              '<option value="collection"' + (curScope === 'collection' ? ' selected' : '') + '>🍿 Filmreihe</option>' +
            '</select>'
          )
          : (
            '<select class="mode-filter-select ' + (isDiscoverView ? 'active-mode' : '') + '" onchange="onModeSelectChange(this.value)" title="Kategorie-Modus wählen (Trending, Beliebt, Top, Geheimtipps, Neuheiten)">' +
              (!isDiscoverView ? '<option value="" selected disabled hidden>📂 Modus wählen...</option>' : '') +
              '<option value="trend"' + (isDiscoverView && curMode === 'trend' ? ' selected' : '') + '>🔥 Trending</option>' +
              '<option value="pop"' + (isDiscoverView && curMode === 'pop' ? ' selected' : '') + '>🌟 Beliebt</option>' +
              '<option value="top"' + (isDiscoverView && curMode === 'top' ? ' selected' : '') + '>🏆 Top Bewertet</option>' +
              '<option value="gems"' + (isDiscoverView && curMode === 'gems' ? ' selected' : '') + '>💎 Geheimtipps</option>' +
              '<option value="new"' + (isDiscoverView && curMode === 'new' ? ' selected' : '') + '>🆕 Neuheiten</option>' +
            '</select>'
          );

        const activeProviderVal = s.onlyVipStreams
          ? 'vip'
          : (incPlatforms.length === 1 ? incPlatforms[0] : (incPlatforms.length > 1 ? '__multi__' : 'all'));
        const isProviderFiltered = activeProviderVal !== 'all';

        const providerSelectHtml = '<select class="new-filter-select ' + (isProviderFiltered ? 'active-new' : '') + '" onchange="onProviderFilterSelectChange(this.value)" title="Nach Streaming-Anbieter filtern">' +
          '<option value="all"' + (activeProviderVal === 'all' ? ' selected' : '') + '>📺 Alle Anbieter</option>' +
          (activeProviderVal === '__multi__' ? '<option value="__multi__" selected disabled hidden>📺 ' + incPlatforms.length + ' Anbieter aktiv</option>' : '') +
          (isCurrentUserVip() ? '<option value="vip"' + (activeProviderVal === 'vip' ? ' selected' : '') + '>🌟 Nur VIP-Streams</option>' : '') +
          PLATFORM_OPTIONS_CLIENT.map(pl =>
            '<option value="' + esc(pl.id) + '"' + (activeProviderVal === pl.id ? ' selected' : '') + '>' + esc(pl.icon + ' ' + pl.label) + '</option>'
          ).join('') +
        '</select>';

        const isFranchiseActive = !state.isSearchMode && (state.currentView === 'franchises' || isColView || isUniView || state.worldsTrayOpen);

        const controlsHtml =
          modeOrScopeHtml +
          providerSelectHtml +
          sortGroupHtml +
          (!state.isSearchMode ? '<button class="btn ' + (isFranchiseActive ? 'red' : '') + '" onclick="toggleWorldsTray()" title="Filmuniversen & Filmreihen Portal-Dock ein- oder ausklappen">🌌 Welten & Reihen ' + (state.worldsTrayOpen ? '▴' : '▾') + '</button>' : '') +
          ((state.isSearchMode || isColView || isUniView || isPerView || state.currentCompanyId) ? '<button class="btn" onclick="goHome()">🏠 Hauptseite</button>' : '');

        return '<div class="floating-filter-bar">' +
          '<div class="ff-controls-grid">' +
            controlsHtml +
          '</div>' +
          (state.worldsTrayOpen && !state.isSearchMode ? buildWorldsPortalTrayHtml() : '') +
          (pills.length > 0 ? (
            '<div class="ff-active-pills" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.2)">' +
              pills.join("") +
              '<button class="btn red" style="padding:2px 8px;font-size:10.5px" onclick="setDirectFilter(\\'reset_all\\',\\'\\',\\'neutral\\')" title="Alle aktiven Filter löschen">🗑️ Reset</button>' +
            '</div>'
          ) : '') +
        '</div>';
      }

      function toggleWorldsTray(forceState) {
        state.worldsTrayOpen = typeof forceState === "boolean" ? forceState : !state.worldsTrayOpen;
        const fm = document.getElementById("floatingFilterMount");
        if (fm) fm.innerHTML = buildFloatingFilterBarHtml();
      }

      function switchWorldsTrayTab(tab) {
        state.worldsTrayTab = tab === "collections" ? "collections" : "universes";
        const fm = document.getElementById("floatingFilterMount");
        if (fm) fm.innerHTML = buildFloatingFilterBarHtml();
      }

      let worldsTraySearchTimer = null;
      function onWorldsTraySearchInput(val) {
        state.worldsTrayQuery = String(val || "");
        const gridEl = document.getElementById("worldsPortalGridMount");
        if (gridEl) gridEl.innerHTML = buildWorldsPortalCardsOnlyHtml();
        if (worldsTraySearchTimer) clearTimeout(worldsTraySearchTimer);
        const q = state.worldsTrayQuery.trim();
        if (q.length >= 2) {
          worldsTraySearchTimer = setTimeout(async () => {
            try {
              const r = await apiFetchJson(API_BASE + "/collections?chatId=" + encodeURIComponent(chatId) + "&q=" + encodeURIComponent(q));
              if (r && Array.isArray(r.results)) {
                state.worldsTrayRemoteCols = r.results.slice(0, 12);
                const g2 = document.getElementById("worldsPortalGridMount");
                if (g2) g2.innerHTML = buildWorldsPortalCardsOnlyHtml();
              }
            } catch (e) {}
          }, 260);
        } else {
          state.worldsTrayRemoteCols = [];
        }
      }

      function buildWorldsPortalCardsOnlyHtml() {
        const q = String(state.worldsTrayQuery || "").trim().toLowerCase();
        const isColsTab = state.worldsTrayTab === "collections";

        if (!isColsTab && !q) {
          return (CINEMATIC_UNIVERSES_CLIENT || []).map(u =>
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openUniverseView(\\'' + esc(u.id) + '\\')">' +
              '<div class="world-portal-icon">' + esc(u.icon || '🌌') + '</div>' +
              '<div class="world-portal-info">' +
                '<div class="world-portal-name">' + esc(u.name) + '</div>' +
                '<div class="world-portal-sub">' + esc(u.desc || 'Filmuniversum') + '</div>' +
              '</div>' +
            '</button>'
          ).join("");
        }

        if (isColsTab && !q) {
          return (FEATURED_COLLECTIONS_CLIENT || []).map(c =>
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openCollectionView(' + Number(c.id) + ')">' +
              '<div class="world-portal-icon">' + esc(c.icon || '🍿') + '</div>' +
              '<div class="world-portal-info">' +
                '<div class="world-portal-name">' + esc(c.name) + '</div>' +
                '<div class="world-portal-sub">Filmreihe öffnen</div>' +
              '</div>' +
            '</button>'
          ).join("");
        }

        // Bei eingegebenem Suchbegriff: Universen + lokale Filmreihen + Live-TMDb-Reihen kombiniert zeigen!
        const matchedUnis = (CINEMATIC_UNIVERSES_CLIENT || []).filter(u =>
          u.name.toLowerCase().includes(q) || (u.desc && u.desc.toLowerCase().includes(q)) || u.id.toLowerCase().includes(q)
        );
        const matchedLocalCols = (FEATURED_COLLECTIONS_CLIENT || []).filter(c =>
          c.name.toLowerCase().includes(q)
        );
        const seenColIds = new Set(matchedLocalCols.map(c => Number(c.id)));
        const extraRemoteCols = (state.worldsTrayRemoteCols || []).filter(c => c && c.id && !seenColIds.has(Number(c.id)));

        const cards = [
          ...matchedUnis.map(u =>
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openUniverseView(\\'' + esc(u.id) + '\\')">' +
              '<div class="world-portal-icon">' + esc(u.icon || '🌌') + '</div>' +
              '<div class="world-portal-info">' +
                '<div class="world-portal-name">' + esc(u.name) + '</div>' +
                '<div class="world-portal-sub">🌌 Universum • ' + esc(u.desc || '') + '</div>' +
              '</div>' +
            '</button>'
          ),
          ...matchedLocalCols.map(c =>
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openCollectionView(' + Number(c.id) + ')">' +
              '<div class="world-portal-icon">' + esc(c.icon || '🍿') + '</div>' +
              '<div class="world-portal-info">' +
                '<div class="world-portal-name">' + esc(c.name) + '</div>' +
                '<div class="world-portal-sub">🍿 Beliebte Filmreihe</div>' +
              '</div>' +
            '</button>'
          ),
          ...extraRemoteCols.map(c =>
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openCollectionView(' + Number(c.id) + ')">' +
              '<div class="world-portal-icon">🍿</div>' +
              '<div class="world-portal-info">' +
                '<div class="world-portal-name">' + esc(c.name) + '</div>' +
                '<div class="world-portal-sub">🍿 TMDb Filmreihe</div>' +
              '</div>' +
            '</button>'
          )
        ];

        return cards.length > 0
          ? cards.join("")
          : '<div style="grid-column:1 / -1;font-size:12px;color:var(--text-muted);padding:6px">Keine passende Reihe oder Welt zu „' + esc(state.worldsTrayQuery) + '“ gefunden.</div>';
      }

      function buildWorldsPortalTrayHtml() {
        const isColsTab = state.worldsTrayTab === "collections";
        return '<div class="worlds-portal-tray">' +
          '<div class="worlds-portal-header">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button type="button" class="btn ' + (!isColsTab ? 'red' : '') + '" onclick="switchWorldsTrayTab(\\'universes\\')">🌌 Universen (' + (CINEMATIC_UNIVERSES_CLIENT ? CINEMATIC_UNIVERSES_CLIENT.length : 0) + ')</button>' +
              '<button type="button" class="btn ' + (isColsTab ? 'red' : '') + '" onclick="switchWorldsTrayTab(\\'collections\\')">🍿 Filmreihen (' + (FEATURED_COLLECTIONS_CLIENT ? FEATURED_COLLECTIONS_CLIENT.length : 0) + '+)</button>' +
            '</div>' +
            '<input type="text" class="worlds-search-input" value="' + esc(state.worldsTrayQuery || '') + '" oninput="onWorldsTraySearchInput(this.value)" placeholder="🔍 Welt oder Filmreihe suchen (z.B. Marvel, Star Wars, Saw, Dune)..." />' +
            '<button type="button" class="btn" onclick="state.worldsTrayOpen=false;loadFranchisesHub(\\'' + (isColsTab ? 'collections' : 'universes') + '\\')" title="Große Vollbild-Übersicht öffnen">🗂️ Vollbild-Hub</button>' +
          '</div>' +
          '<div id="worldsPortalGridMount" class="worlds-portal-grid">' +
            buildWorldsPortalCardsOnlyHtml() +
          '</div>' +
        '</div>';
      }

      function renderDiscover(customTitle) {
        const root = document.getElementById("appRoot");
        const vipAllowed = isCurrentUserVip();

        const heroSectionHtml = state.isSearchMode
          ? ""
          : '<div id="heroBannerSlot">' + buildHeroBannerInnerHtml() + '</div>';

        const isColView = state.currentView === "collection" && state.currentCollectionId;
        const isUniView = state.currentView === "universe" && state.currentUniverseId;
        const isPerView = state.currentView === "person" && state.currentPersonId;

        const franchiseActionBannerHtml = (isColView || isUniView) ? (
          '<div class="panel-box" style="margin-bottom:10px;border-color:' + (isColView ? 'rgba(91,70,245,0.5)' : 'rgba(16,185,129,0.5)') + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div>' +
                '<div style="font-size:14px;font-weight:800;color:var(--text-main)">' + esc(customTitle || (isColView ? '🍿 Filmreihe' : '🌌 Filmuniversum')) + '</div>' +
                '<div style="font-size:11.5px;color:var(--text-muted)">Direkt über Telegram teilen oder komplett in deiner Merkliste speichern:</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="btn green" onclick="saveWholeCollectionOrUniverseTma(\\'' + (isColView ? 'col' : 'uni') + '\\',\\'' + esc(isColView ? state.currentCollectionId : state.currentUniverseId) + '\\')">💾 Alle ' + state.items.length + ' sichtbaren speichern</button>' +
                '<button class="btn purple" onclick="shareCollectionOrUniverseFromTma(\\'' + (isColView ? 'col' : 'uni') + '\\',\\'' + esc(isColView ? state.currentCollectionId : state.currentUniverseId) + '\\',\\'' + esc(isColView ? state.currentCollectionName : state.currentUniverseName) + '\\')">📤 Teilen</button>' +
                '<button class="btn" onclick="loadFranchisesHub(\\'' + (isColView ? 'collections' : 'universes') + '\\')">🔙 Alle ' + (isColView ? 'Reihen' : 'Universen') + '</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        ) : '';

        // Bei aktiver Suche: Erkannte Filmstudios, Filmreihen, Universen & Personen standardmäßig EINGEKLAPPT und per Klick ausklappbar!
        const detectedCount =
          ((state.searchMatchedStudios && state.searchMatchedStudios.length) || 0) +
          ((state.searchMatchedUniverses && state.searchMatchedUniverses.length) || 0) +
          ((state.searchMatchedCollections && state.searchMatchedCollections.length) || 0) +
          ((state.searchMatchedPersons && state.searchMatchedPersons.length) || 0);
        const hasSearchEntities = state.isSearchMode && detectedCount > 0;
        const isEntitiesOpen = Boolean(state.searchEntitiesExpanded);
        const searchDetectedEntitiesHtml = hasSearchEntities ? (
          '<div class="panel-box" style="margin-bottom:10px;padding:8px 12px;border-color:rgba(91,70,245,0.45)">' +
            '<div onclick="toggleSearchDetectedEntities()" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;gap:8px">' +
              '<span style="font-size:12px;font-weight:800;color:#c4b5fd">✨ Automatisch zu deiner Suche erkannt (' + detectedCount + ')</span>' +
              '<span id="searchDetectedEntitiesToggleIcon" style="font-size:11.5px;font-weight:700;color:#a78bfa">' + (isEntitiesOpen ? 'Ausblenden ▴' : 'Anzeigen ▾') + '</span>' +
            '</div>' +
            '<div id="searchDetectedEntitiesBody" style="display:' + (isEntitiesOpen ? 'flex' : 'none') + ';gap:6px;flex-wrap:wrap;margin-top:8px">' +
              (state.searchMatchedStudios || []).map(st =>
                '<button class="btn" style="background:rgba(245,158,11,0.2);border-color:#f59e0b" onclick="openStudioView(\\'' + esc(st.companyIds || st.id) + '\\',\\'' + esc(st.name) + '\\')">' + esc(st.icon || '🏢') + ' Studio: ' + esc(st.name) + '</button>'
              ).join("") +
              (state.searchMatchedUniverses || []).map(u =>
                '<button class="btn" style="background:rgba(16,185,129,0.2);border-color:#10b981" onclick="openUniverseView(\\'' + esc(u.id) + '\\')">' + esc(u.icon || '🌌') + ' Universum: ' + esc(u.name) + '</button>'
              ).join("") +
              (state.searchMatchedCollections || []).map(c =>
                '<button class="btn" style="background:rgba(91,70,245,0.22);border-color:#7c69ff" onclick="openCollectionView(' + Number(c.id) + ')">🍿 Filmreihe: ' + esc(c.name) + '</button>'
              ).join("") +
              (state.searchMatchedPersons || []).map(p =>
                '<button class="btn" style="background:rgba(2,132,199,0.22);border-color:#38bdf8" onclick="openPersonView(' + Number(p.id) + ',\\'' + esc(p.name) + '\\')">🌟 ' + esc(p.name) + (p.known_for ? ' (' + esc(p.known_for) + ')' : '') + '</button>'
              ).join("") +
            '</div>' +
          '</div>'
        ) : '';

        // Zuletzt angesehen (Quick-Resume Strip) auf der Hauptseite – aktualisiert sich live bei jedem Klick!
        const recentStripMountHtml = '<div id="recentViewedMount">' + buildRecentViewedStripHtml() + '</div>';

        const baseModeTitle = state.currentCompanyId
          ? ("🏢 Studio: " + esc(state.currentCompanyName || "Filmstudio"))
          : state.mode === "trend"
            ? "🔥 Trending"
            : state.mode === "pop"
              ? "🌟 Beliebt"
              : state.mode === "top"
                ? "🏆 Top Bewertet"
                : state.mode === "gems"
                  ? "💎 Geheimtipps"
                  : "🆕 Neuheiten";
        const activeIncPlats = Array.isArray(state.settings?.includedPlatforms)
          ? Array.from(new Set(state.settings.includedPlatforms.map(normalizePlatformIdClient).filter(Boolean)))
          : [];
        const providerTitleSuffix = state.settings?.onlyVipStreams
          ? " • 🌟 VIP-Streams"
          : activeIncPlats.length === 1
            ? (" • " + esc(getPlatformDisplayLabelClient(activeIncPlats[0])))
            : "";
        const headerTitle = customTitle
          ? esc(customTitle)
          : (baseModeTitle + providerTitleSuffix);

        const showTop10Ranks = !state.isSearchMode && state.currentView === "discover" && state.mode === "trend" && !state.currentCompanyId;
        const isMixedMediaView = Boolean(state.isSearchMode || isColView || isUniView || isPerView);
        const curPage = Math.max(1, Number(state.page) || 1);
        const startPage = Math.max(1, Math.min(curPage, Number(state.startPage) || 1));
        const totPages = Math.max(curPage, Number(state.totalPages) || 1);
        const totalResNum = Math.max(state.items.length, Number(state.totalResults) || state.items.length);
        const pageRangeLabel = startPage < curPage
          ? ("Seiten " + startPage + "–" + curPage + " von " + totPages)
          : ("Seite " + curPage + " von " + totPages);
        const hitsLabel = (!isColView && !isUniView && !isPerView && (totPages > 1 || totalResNum > state.items.length))
          ? (state.items.length + " geladen • " + totalResNum.toLocaleString("de-DE") + " Treffer")
          : (state.items.length + " Treffer");
        const hasNextPage = Boolean(state.hasMorePages && curPage < totPages && state.items.length > 0);
        const canPaginateView = Boolean((state.currentView === "discover" || state.isSearchMode) && !isColView && !isUniView && !isPerView && (hasNextPage || totPages > 1) && state.items.length > 0);

        // Direkt-Seitenwahl (#17) berechnen – auf der letzten Seite wird „Mehr laden“ ausgeblendet, bei 1 Seite komplett ausgeblendet
        let paginationBarHtml = "";
        if (canPaginateView) {
          const pageButtons = [];
          const maxQuickPages = Math.min(totPages, 7);
          let startP = Math.max(1, curPage - 3);
          let endP = Math.min(totPages, startP + maxQuickPages - 1);
          if (endP - startP + 1 < maxQuickPages) {
            startP = Math.max(1, endP - maxQuickPages + 1);
          }
          if (startP > 1) {
            pageButtons.push('<button type="button" class="page-jump-btn ' + (1 >= startPage && 1 <= curPage ? 'active' : '') + '" onclick="jumpToPage(1)">1</button>');
            if (startP > 2) pageButtons.push('<span style="color:var(--text-muted);font-size:11px;padding:0 2px">…</span>');
          }
          for (let p = startP; p <= endP; p++) {
            pageButtons.push('<button type="button" class="page-jump-btn ' + (p >= startPage && p <= curPage ? 'active' : '') + '" onclick="jumpToPage(' + p + ')">' + p + '</button>');
          }
          if (endP < totPages) {
            if (endP < totPages - 1) pageButtons.push('<span style="color:var(--text-muted);font-size:11px;padding:0 2px">…</span>');
            pageButtons.push('<button type="button" class="page-jump-btn" onclick="jumpToPage(' + totPages + ')">' + totPages + '</button>');
          }
          paginationBarHtml = '<div class="load-more-wrap">' +
            (hasNextPage ? (
              '<button type="button" id="loadMoreGridBtn" class="btn red" style="padding:9px 20px;font-size:13px" onclick="loadMoreResults()">➕ Mehr laden (Seite ' + (curPage + 1) + ' von ' + totPages + ')</button>'
            ) : '') +
            (totPages > 1 ? (
              '<div class="pagination-bar">' +
                '<span class="page-counter-pill">📄 ' + pageRangeLabel + '</span>' +
                (curPage > 1 ? '<button type="button" class="page-jump-btn" onclick="jumpToPage(' + (curPage - 1) + ')" title="Vorherige Seite">◀</button>' : '') +
                pageButtons.join("") +
                (curPage < totPages ? '<button type="button" class="page-jump-btn" onclick="jumpToPage(' + (curPage + 1) + ')" title="Nächste Seite">▶</button>' : '') +
              '</div>'
            ) : '') +
          '</div>';
        }

        root.innerHTML = heroSectionHtml +
          '<div class="section">' +
            '<div id="floatingFilterMount">' + buildFloatingFilterBarHtml() + '</div>' +
            recentStripMountHtml +
            searchDetectedEntitiesHtml +
            franchiseActionBannerHtml +
            '<div class="section-title" style="margin-top:6px">' +
              '<span>' + headerTitle + ' (' + hitsLabel + ')</span>' +
              ((!isColView && !isUniView && !isPerView && totPages > 1) ? '<span class="page-counter-pill">📄 ' + pageRangeLabel + '</span>' : '') +
            '</div>' +
            '<div id="resultsGridContainer" class="carousel">' + (state.items.length > 0 ? state.items.map((it, idx) => {
              const tc = it.media_type === 'tv' ? 's' : it.media_type === 'movie' ? 'm' : state.type;
              const badgeTxt = tc === 's' ? '📺 Serie' : '🎬 Film';
              const cardKey = tc + "_" + it.id;
              const isCardSaved = savedKeysSet.has(cardKey);
              const rankHtml = (showTop10Ranks && idx < 10) ? ('<span class="card-rank-badge">#' + (idx + 1) + '</span>') : '';
              // Dezenter grüner VIP-Punkt auf dem Cover (Details im Modal)
              const vipQualityHtml = (vipAllowed && it.vipQuality)
                ? ('<span class="card-vip-dot" title="VIP-Stream verfügbar: ' + esc(it.vipQuality) + '"></span>')
                : '';
              const itemTitleSafe = esc(it.title || it.name || '');
              const resolvedCardPoster = resolvePosterUrlClient(it.poster_path, 'w342', it.external_poster_url || it.poster || '');
              const itemPosterSafe = esc(it.poster_path || it.external_poster_url || it.poster || '');
              const yrStr = esc((it.release_date || it.first_air_date || '').slice(0, 4) || '–');
              const ratStr = it.vote_average ? it.vote_average.toFixed(1) : '–';
              const subRightTxt = isMixedMediaView ? ((tc === 's' ? '📺 ' : '🎬 ') + yrStr) : yrStr;
              return '<div class="card" tabindex="0" data-card-key="' + esc(cardKey) + '" data-card-title="' + itemTitleSafe + '" onclick="openDetails(\\''+tc+'\\','+it.id+',false,\\''+itemTitleSafe+'\\',\\''+itemPosterSafe+'\\')">' +
                '<div class="card-poster-wrap">' +
                  '<div class="card-top-left-stack">' +
                    rankHtml +
                    vipQualityHtml +
                  '</div>' +
                  '<button type="button" class="card-quick-save ' + (isCardSaved ? 'saved' : '') + '" onclick="quickToggleCardWishlist(event,\\'' + tc + '\\',' + it.id + ',\\'' + itemTitleSafe + '\\')" title="In Merkliste speichern oder entfernen (Tipp oder Karte gedrückt halten)">' + (isCardSaved ? '✓' : '🔖') + '</button>' +
                  '<button type="button" class="card-quick-info" onclick="event.stopPropagation();openDetails(\\''+tc+'\\','+it.id+',false,\\''+itemTitleSafe+'\\',\\''+itemPosterSafe+'\\')" title="Details öffnen">ℹ️ Details</button>' +
                  '<button type="button" class="card-quick-trailer" onclick="playInstantTrailerFromCard(event,\\'' + tc + '\\',' + it.id + ',\\'' + itemTitleSafe + '\\',\\'' + itemPosterSafe + '\\')" title="Instant-Trailer sofort abspielen">▶ Trailer</button>' +
                  '<img src="' + (resolvedCardPoster ? esc(resolvedCardPoster) : 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22450%22 viewBox=%220 0 300 450%22%3E%3Crect width=%22300%22 height=%22450%22 fill=%22%231c1c24%22/%3E%3Ctext x=%22150%22 y=%22225%22 fill=%22%2371717a%22 font-family=%22sans-serif%22 font-size=%2216%22 text-anchor=%22middle%22%3EKein Poster%3C/text%3E%3C/svg%3E') + '" onerror="this.onerror=null;this.src=\\\'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22450%22 viewBox=%220 0 300 450%22%3E%3Crect width=%22300%22 height=%22450%22 fill=%22%231c1c24%22/%3E%3Ctext x=%22150%22 y=%22225%22 fill=%22%2371717a%22 font-family=%22sans-serif%22 font-size=%2216%22 text-anchor=%22middle%22%3EKein Poster%3C/text%3E%3C/svg%3E\\\';" loading="lazy" draggable="false" oncontextmenu="return false;" alt="' + itemTitleSafe + '" />' +
                '</div>' +
                '<div class="card-body">' +
                  '<div class="card-title">' + itemTitleSafe + '</div>' +
                  '<div class="card-sub"><span>⭐ ' + ratStr + '</span><span>' + subRightTxt + '</span></div>' +
                '</div>' +
              '</div>';
            }).join("") + paginationBarHtml : (
              '<div class="panel-box" style="grid-column:1 / -1;margin-top:6px">' +
                '<div class="section-title">⚠️ Keine Treffer mit dieser Filter-Kombination auf Seite ' + curPage + '</div>' +
                '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Passe in der linken Sidebar (☰ Filter) einzelne Filter an oder setze alle Filter zurück:</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                  '<button class="btn purple" onclick="toggleFilterSidebar()">☰ Filter-Sidebar öffnen</button>' +
                  '<button class="btn red" onclick="setDirectFilter(\\'reset_all\\',\\'\\',\\'neutral\\')">🗑️ Alle Filter zurücksetzen</button>' +
                '</div>' +
              '</div>'
            )) + '</div>' +
          '</div>';
      }

      async function loadFranchisesHub(tab) {
        if (tab) state.franchiseTab = tab;
        state.currentView = "franchises";
        const root = document.getElementById("appRoot");
        setBusyState(true, "⏳ Lade Filmreihen & Filmuniversen...");
        try {
          const [colsRes, unisRes] = await Promise.all([
            apiFetchJson(API_BASE + "/collections?chatId=" + encodeURIComponent(chatId)),
            apiFetchJson(API_BASE + "/universes?chatId=" + encodeURIComponent(chatId))
          ]);
          const cols = colsRes.collections || [];
          const unis = unisRes.universes || [];
          const isUni = state.franchiseTab === "universes";

          root.innerHTML = '<div class="section">' +
            '<div id="floatingFilterMount">' + buildFloatingFilterBarHtml() + '</div>' +
            '<div class="section-title" style="margin-top:6px"><span>🍿 Filmreihen & 🌌 Filmuniversen</span><div style="display:flex;gap:6px"><button class="btn" onclick="goHome()">🏠 Zur Hauptseite</button></div></div>' +
            '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
              '<button class="btn ' + (!isUni ? 'red' : '') + '" onclick="loadFranchisesHub(\\'collections\\')">🍿 Beliebte Filmreihen (' + cols.length + ')</button>' +
              '<button class="btn ' + (isUni ? 'red' : '') + '" onclick="loadFranchisesHub(\\'universes\\')">🌌 Große Filmuniversen (' + unis.length + ')</button>' +
            '</div>' +
            (!isUni ? (
              '<div style="display:flex;gap:6px;margin-bottom:12px">' +
                '<input id="colSearchInput" style="flex:1;background:var(--card);border:1px solid rgba(148,163,184,0.35);color:var(--text);padding:8px 12px;border-radius:6px;font-size:13px" placeholder="🔍 Beliebige Filmreihe auf TMDB suchen (z.B. Saw, Matrix, John Wick)..." onkeydown="if(event.key===\\'Enter\\')searchCollectionsInHub()" />' +
                '<button class="btn red" onclick="searchCollectionsInHub()">Reihe suchen</button>' +
              '</div>' +
              '<div id="colHubGrid" class="chip-grid">' +
                cols.map(c => '<button class="btn" style="padding:9px 12px;font-size:12.5px" onclick="openCollectionView(' + c.id + ')">' + esc(c.icon || '🍿') + ' ' + esc(c.name) + '</button>').join("") +
              '</div>'
            ) : (
              '<div id="uniHubGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">' +
                unis.map(u => '<div class="panel-box f-pill neutral" tabindex="0" style="cursor:pointer;margin-bottom:0;display:block;border-radius:10px" onclick="openUniverseView(\\''+esc(u.id)+'\\')"><div style="font-size:14px;font-weight:700;margin-bottom:4px">' + esc(u.icon || '🌌') + ' ' + esc(u.name) + '</div><div style="font-size:11.5px;color:var(--muted)">' + esc(u.description || '') + '</div></div>').join("") +
              '</div>'
            )) +
          '</div>';
          const firstHubOption = root.querySelector("#colHubGrid .btn, #uniHubGrid .f-pill");
          if (firstHubOption && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstHubOption, false);
          }
        } finally {
          setBusyState(false);
        }
      }

      async function searchCollectionsInHub() {
        const inp = document.getElementById("colSearchInput");
        const q = inp ? inp.value.trim() : "";
        if (!q) return;
        if (inp && document.activeElement === inp) inp.blur();
        setBusyState(true, '🔍 Suche Filmreihe "' + q + '"...');
        try {
          const r = await apiFetchJson(API_BASE + "/collections?chatId=" + encodeURIComponent(chatId) + "&q=" + encodeURIComponent(q));
          const grid = document.getElementById("colHubGrid");
          if (!grid) return;
          const list = r.results || [];
          if (list.length === 0) {
            grid.innerHTML = '<div class="panel-box">Keine Filmreihen zu "' + esc(q) + '" gefunden.</div>';
            return;
          }
          grid.innerHTML = list.map(c => '<button class="btn" style="padding:9px 12px;font-size:12.5px" onclick="openCollectionView(' + c.id + ')">🍿 ' + esc(c.name) + '</button>').join("");
          const firstColBtn = grid.querySelector(".btn");
          if (firstColBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstColBtn, true);
          }
        } finally {
          setBusyState(false);
        }
      }

      async function openCollectionView(colId) {
        document.getElementById("modalRoot").innerHTML = "";
        setBusyState(true, "🍿 Lade Filmreihe...");
        try {
          const r = await apiFetchJson(API_BASE + "/collections?chatId=" + encodeURIComponent(chatId) + "&id=" + encodeURIComponent(colId) + "&sort=" + state.sort);
          if (!r || !r.ok) return;
          state.isSearchMode = false;
          state.currentView = "collection";
          state.currentCollectionId = r.id || colId;
          state.currentCollectionName = r.name || "Filmreihe";
          state.currentUniverseId = null;
          state.items = r.items || [];
          rebuildHeroSlides(state.items);
          renderDiscover("🍿 Filmreihe: " + (r.name || "Kollektion"));
          if (typeof focusFirstResultCard === "function") focusFirstResultCard(true);
        } finally {
          setBusyState(false);
        }
      }

      async function openUniverseView(uniId) {
        document.getElementById("modalRoot").innerHTML = "";
        setBusyState(true, "🌌 Lade Filmuniversum...");
        try {
          const r = await apiFetchJson(API_BASE + "/universes?chatId=" + encodeURIComponent(chatId) + "&id=" + encodeURIComponent(uniId) + "&sort=" + state.sort);
          if (!r || !r.ok) return;
          state.isSearchMode = false;
          state.currentView = "universe";
          state.currentUniverseId = r.id || uniId;
          state.currentUniverseName = r.name || "Filmuniversum";
          state.currentCollectionId = null;
          state.items = r.items || [];
          rebuildHeroSlides(state.items);
          renderDiscover((r.icon || "🌌") + " " + (r.name || "Filmuniversum"));
          if (typeof focusFirstResultCard === "function") focusFirstResultCard(true);
        } finally {
          setBusyState(false);
        }
      }

      async function saveWholeCollectionOrUniverseTma(kind, refId) {
        if (!state.isAuthenticated) { openAccountModal(); return; }
        setBusyState(true, "💾 Speichere " + (kind === "col" ? "Filmreihe" : "Filmuniversum") + " als eigenen Ordner in deiner Merkliste...");
        try {
          const r = await apiFetchJson(API_BASE + "/wishlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              action: kind === "col" ? "save_collection" : "save_universe",
              refId
            })
          });
          if (r && r.ok) {
            showHudToast("✅ " + (r.addedCount || 0) + " Filme in Ordner „" + (r.folderName || "") + "“ gespeichert!");
          } else {
            showHudToast("⚠️ " + (r?.error || "Speichern fehlgeschlagen."));
          }
        } finally {
          setBusyState(false);
        }
      }

      async function loadSimilarInTma(type, id) {
        setBusyState(true, "✨ Suche ähnliche Titel...");
        try {
          const r = await apiFetchJson(API_BASE + "/similar?chatId=" + encodeURIComponent(chatId) + "&type=" + type + "&id=" + id);
          const box = document.getElementById("similarModalBox");
          const items = r.items || [];
          if (!box) return;
          if (items.length === 0) {
            box.innerHTML = '<div style="font-size:12px;color:#94a3b8;margin-top:8px">Keine ähnlichen Titel mit den aktuellen Filtern gefunden.</div>';
            return;
          }
          box.innerHTML = '<div class="modal-sub-box" style="margin-top:10px;padding:12px;background:var(--card);border-radius:10px;border:1px solid rgba(255,255,255,0.08)">' +
            '<div style="font-size:12.5px;font-weight:800;color:var(--text);margin-bottom:8px">✨ Ähnliche Empfehlungen (' + items.length + '):</div>' +
            '<div class="carousel" style="grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:8px">' +
              items.slice(0, 8).map(it => {
                const tc = it.media_type === 'tv' ? 's' : type;
                const itemTitle = it.title || it.name || 'Titel';
                const fbSvg = buildPosterFallbackSvg(itemTitle, tc === 's');
                const simPoster = resolvePosterUrlClient(it.poster_path, 'w342', it.external_poster_url || it.poster || '') || fbSvg;
                return '<div class="card" tabindex="0" onclick="openDetails(\\''+tc+'\\','+it.id+',false)">' +
                  '<div class="card-poster-wrap">' +
                    '<img src="' + esc(simPoster) + '" alt="' + esc(itemTitle) + '" loading="lazy" draggable="false" oncontextmenu="return false;" onerror="this.onerror=null;this.src=\\'' + fbSvg + '\\'" />' +
                  '</div>' +
                  '<div class="card-body"><div class="card-title">' + esc(itemTitle) + '</div><div class="card-sub"><span>⭐ ' + (it.vote_average ? Number(it.vote_average).toFixed(1) : '–') + '</span><span>' + esc((it.release_date || it.first_air_date || '').slice(0,4)) + '</span></div></div>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>';
          const firstSimCard = box.querySelector(".card");
          if (firstSimCard && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstSimCard, true);
          }
        } finally {
          setBusyState(false);
        }
      }

      // Wischgesten (Swipe) und Pfeil-Wechsel (◀ / ▶) zum nächsten/vorherigen Film im geöffneten Detail-Modal (#10)
      function getAdjacentDetailItem(step) {
        if (!state.activeDetails || !Array.isArray(state.items) || state.items.length <= 1) return null;
        const curId = String(state.activeDetails.id);
        const idx = state.items.findIndex(x => x && String(x.id) === curId);
        if (idx === -1) return null;
        const nextIdx = (idx + step + state.items.length) % state.items.length;
        const cand = state.items[nextIdx];
        if (!cand || !cand.id) return null;
        const tc = cand.media_type === "tv" ? "s" : cand.media_type === "movie" ? "m" : state.type;
        return {
          typeCode: tc,
          id: cand.id,
          title: cand.title || cand.name || "",
          poster_path: cand.poster_path || "",
          index: nextIdx,
          total: state.items.length
        };
      }

      function navigateDetailModalAdjacent(step) {
        const adj = getAdjacentDetailItem(step);
        if (!adj) return;
        openDetails(adj.typeCode, adj.id, false, adj.title, adj.poster_path);
      }

      function onModalHeroTouchStart(ev) {
        if (ev.touches && ev.touches[0]) modalTouchStartX = ev.touches[0].clientX;
      }

      function onModalHeroTouchEnd(ev) {
        if (!modalTouchStartX || !ev.changedTouches || !ev.changedTouches[0]) return;
        const dx = ev.changedTouches[0].clientX - modalTouchStartX;
        modalTouchStartX = 0;
        if (Math.abs(dx) > 55) {
          navigateDetailModalAdjacent(dx < 0 ? 1 : -1);
        }
      }

      function prepareDiscoverContextFromModal() {
        document.getElementById("modalRoot").innerHTML = "";
        closeAutocomplete();
        if (state.activeDetails && (state.activeDetails.typeCode === "m" || state.activeDetails.typeCode === "s")) {
          state.type = state.activeDetails.typeCode;
        }
        state.isSearchMode = false;
        state.searchFocused = false;
        state.searchQuery = "";
        state.currentView = "discover";
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        state.genreId = "all";
        const inp = document.getElementById("searchInput");
        if (inp) inp.value = "";
        updateSearchClearBtnVisibility();
        document.body.classList.remove("search-active-dim");
        updateMediaModeIndicatorDom();
        syncSearchGenreSelectDom();
      }

      function filterByCategoryFromModal(category, value) {
        prepareDiscoverContextFromModal();
        const normalizedVal = category === "genre" ? normalizeGenreNameForClient(value, state.type) : value;
        setDirectFilter(category, normalizedVal, "force_include");
      }

      function searchByYearFromModal(yearVal) {
        const y = String(yearVal || "").trim();
        if (!y) return;
        document.getElementById("modalRoot").innerHTML = "";
        runSearch(false, "(" + y + ")", "all");
      }

      function filterOrSearchStudioFromModal(studioName, companyId = "") {
        if (companyId) {
          openStudioView(companyId, studioName);
          return;
        }
        const norm = String(studioName || "").toLowerCase();
        const matched = STUDIO_OPTIONS_CLIENT.find(st =>
          norm.includes(st.label.toLowerCase()) ||
          st.label.toLowerCase().includes(norm) ||
          (Array.isArray(st.match) && st.match.some(m => norm.includes(String(m).toLowerCase())))
        );
        if (matched) {
          prepareDiscoverContextFromModal();
          setDirectFilter("studio", matched.id, "force_include");
        } else {
          document.getElementById("modalRoot").innerHTML = "";
          runSearch(false, studioName, "all");
        }
      }

      function filterOrSearchProviderFromModal(provName) {
        const norm = String(provName || "").toLowerCase();
        const matched = PLATFORM_OPTIONS_CLIENT.find(pl =>
          norm.includes(pl.label.toLowerCase()) ||
          pl.label.toLowerCase().includes(norm) ||
          (Array.isArray(pl.match) && pl.match.some(m => norm.includes(String(m).toLowerCase())))
        );
        if (matched) {
          prepareDiscoverContextFromModal();
          setDirectFilter("platform", matched.id, "force_include");
        } else {
          document.getElementById("modalRoot").innerHTML = "";
          runSearch(false, provName, "all");
        }
      }

      function switchEmbedSource(sourceKey, saveAsDefault = true) {
        const activeKey = sourceKey || trailerProvider || "youtube";
        if (saveAsDefault && sourceKey) {
          setTrailerProvider(sourceKey);
          const detailBtns = document.querySelectorAll("#modalRoot button[data-detail-tp-id]");
          detailBtns.forEach(b => {
            const pid = b.getAttribute("data-detail-tp-id") || "";
            const tpObj = TRAILER_PROVIDERS_CLIENT.find(x => x.id === pid);
            const isMatch = pid === activeKey;
            b.className = "btn " + (isMatch ? "red" : "");
            if (tpObj) b.textContent = tpObj.label + (isMatch ? " ✓ Standard" : "");
          });
        }
        const d = state.activeDetails;
        if (!d || !d.trailers || !d.trailers.embeds) return;
        const box = document.getElementById("trailerEmbedContainer");
        if (!box) return;
        const embedUrl = d.trailers.embeds[activeKey] || d.trailers.embeds.youtube;
        box.innerHTML = '<div class="embed-box"><iframe class="embed-frame" src="' + esc(embedUrl) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
      }

      // Client-Hilfsfunktion: Dateigröße in MB / GB formatieren (tabular-nums)
      function formatFileSizeClient(bytesInput) {
        if (bytesInput === null || bytesInput === undefined || bytesInput === "") return "";
        const b = Number(bytesInput);
        if (!Number.isFinite(b) || b <= 0) {
          const s = String(bytesInput).trim();
          return /\\b(?:gb|mb|gib|mib)\\b/i.test(s) ? s : "";
        }
        const gb = b / (1024 * 1024 * 1024);
        if (gb >= 1) return gb.toFixed(2) + " GB";
        const mb = b / (1024 * 1024);
        if (mb >= 1) return (mb >= 100 ? Math.round(mb) : mb.toFixed(1)) + " MB";
        return Math.max(1, Math.round(b / 1024)) + " KB";
      }

      // Optimierung #14: Serien-Fortschritt lokal merken (Staffel & Folge pro Serie)
      function getSeriesProgressMap() {
        try {
          const raw = localStorage.getItem("tma_series_progress");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") return parsed;
          }
        } catch (e) {}
        return {};
      }

      function getSeriesProgress(seriesId) {
        if (!seriesId) return null;
        const map = getSeriesProgressMap();
        return map[String(seriesId)] || null;
      }

      function setSeriesProgress(seriesId, season, episode, epName = "") {
        if (!seriesId || !season || !episode) return;
        try {
          const map = getSeriesProgressMap();
          map[String(seriesId)] = {
            season: Number(season),
            episode: Number(episode),
            epName: String(epName || "").slice(0, 80),
            updatedAt: Date.now()
          };
          localStorage.setItem("tma_series_progress", JSON.stringify(map));
        } catch (e) {}
      }

      function cleanAndDedupeProvidersClient(rawProvidersStr) {
        if (!rawProvidersStr || rawProvidersStr === "Keine Angabe" || rawProvidersStr === "Derzeit keine Flatrate bekannt") {
          return [];
        }
        const parts = String(rawProvidersStr).split(",").map(s => s.trim()).filter(Boolean);
        const seen = new Set();
        const out = [];
        for (const p of parts) {
          let cleaned = p
            .replace(/\\s+(?:standard\\s+with\\s+ads|basic\\s+with\\s+ads|with\\s+ads|amazon\\s+channel|apple\\s+tv\\s+channel|plus\\s+channel|channel)$/i, "")
            .trim();
          const low = cleaned.toLowerCase();
          for (const pl of PLATFORM_OPTIONS_CLIENT) {
            const matchHit = Array.isArray(pl.match) && pl.match.some(m => {
              const kw = String(m || "").toLowerCase().trim();
              if (!kw) return false;
              const rx = new RegExp("(?:^|[^a-z0-9äöüß])" + kw.replace(/[.*+?^()|[\\]\\\\{}]/g, "\\\\$&") + "(?:$|[^a-z0-9äöüß])", "i");
              return rx.test(low);
            });
            if (matchHit || low === pl.label.toLowerCase()) {
              cleaned = pl.shortLabel || pl.label;
              break;
            }
          }
          const key = cleaned.toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push(cleaned);
        }
        return out;
      }

      function toggleModalCreditsBox() {
        const box = document.getElementById("modalCreditsCollapseBox");
        const btn = document.getElementById("modalCreditsToggleBtn");
        if (!box) return;
        const isHidden = box.style.display === "none";
        box.style.display = isHidden ? "grid" : "none";
        if (btn) {
          btn.innerHTML = isHidden
            ? '<span>👥 Besetzung, Regie, Studios & Jahr ausblenden</span><span>▴</span>'
            : '<span>👥 Besetzung, Regie, Studios & Jahr anzeigen</span><span>▾</span>';
        }
      }

      function toggleModalMoreActions() {
        const box = document.getElementById("modalMoreActionsBox");
        const btn = document.getElementById("modalMoreActionsBtn");
        if (!box) return;
        const isHidden = box.style.display === "none";
        box.style.display = isHidden ? "flex" : "none";
        if (btn) {
          btn.textContent = isHidden ? "⋯ Weniger ▴" : "⋯ Mehr ▾";
        }
      }

      async function openDetails(type, id, autoOpenTrailer = false, preTitle = "", prePoster = "", forceSeasonNum = null) {
        if (typeof lastCardLongPressAt !== "undefined" && Date.now() - lastCardLongPressAt < 650) {
          return;
        }
        saveModalReturnFocusTarget(type, id);
        // Sofort beim Anklicken "Zuletzt angesehen" aktualisieren (ohne auf API zu warten!)
        if (id && (preTitle || prePoster)) {
          addRecentViewedItem({ id, title: preTitle, poster_path: prePoster }, type);
        } else if (id && Array.isArray(state.items)) {
          const foundInGrid = state.items.find(x => String(x.id) === String(id));
          if (foundInGrid) addRecentViewedItem(foundInGrid, type);
        }
        const vipAllowed = isCurrentUserVip();
        const cacheKey = type + "_" + id + "_" + (vipAllowed ? "vip" : "std");
        const cachedEntry = clientDetailsCache.get(cacheKey);
        const hasValidCache = Boolean(cachedEntry && (Date.now() - cachedEntry.ts < CLIENT_CACHE_TTL_MS));
        if (!hasValidCache) {
          setBusyState(true, "⏳ Lade Details...");
        }
        try {
          const d = hasValidCache
            ? cachedEntry.data
            : await apiFetchJson(API_BASE + "/details?chatId=" + encodeURIComponent(chatId) + "&type=" + type + "&id=" + id);
          if (!d || d.ok === false) {
            throw new Error(d?.error || "Titeldetails konnten nicht geladen werden.");
          }
          if (!hasValidCache) {
            clientDetailsCache.set(cacheKey, { data: d, ts: Date.now() });
          }
          state.activeDetails = { ...d, typeCode: type, id: d.id || id };
          if (d.botUsername) state.botUsername = d.botUsername;
          if (d.isSaved) savedKeysSet.add(type + "_" + (d.id || id));
          addRecentViewedItem(d, type);
          const m = document.getElementById("modalRoot");
          const tr = d.trailers || null;
          const posterOrig = resolvePosterUrlClient(d.poster_path, 'original', d.external_poster_url || '');
          const posterThumb = resolvePosterUrlClient(d.poster_path, 'w342', d.external_poster_url || '');
          if (posterThumb) {
            syncCardPosterInDom(type, d.id || id, posterThumb);
          }
          const backdropOrig = resolvePosterUrlClient(d.backdrop_path, 'original', '');
          const backdropBanner = resolvePosterUrlClient(d.backdrop_path, 'w780', posterOrig);
          const ytSearchQuery = encodeURIComponent((d.title || '') + ' ' + (d.year && d.year !== 'K.A.' ? d.year : '') + ' Trailer Deutsch');
          const ytSearchUrl = 'https://www.youtube.com/results?search_query=' + ytSearchQuery;

          // Klickbare Genres & bereinigte, deduplizierte Streaming-Anbieter
          const genresListClean = (d.genres && d.genres !== "Keine Angabe")
            ? d.genres.split(",").map(g => g.trim()).filter(Boolean)
            : [];
          const clickableGenresHtml = genresListClean.map(gName =>
            '<span class="f-pill inc" tabindex="0" onclick="filterByCategoryFromModal(\\'' + 'genre\\',\\'' + esc(gName) + '\\')" title="Nach Genre filtern: ' + esc(gName) + '">' + genreEmoji(gName) + ' ' + esc(gName) + '</span>'
          ).join(" ");
          const heroInlineGenresHtml = genresListClean.map(gName =>
            '<span class="modal-genre-link" tabindex="0" onclick="filterByCategoryFromModal(\\'' + 'genre\\',\\'' + esc(gName) + '\\')" title="Nach Genre filtern: ' + esc(gName) + '">' + esc(gName) + '</span>'
          ).join('<span class="modal-meta-dot">·</span>');

          const directorsArr = Array.isArray(d.directorsList) && d.directorsList.length > 0
            ? d.directorsList
            : (d.directors && d.directors !== "Keine Angabe" ? d.directors.split(",").map(n => ({ name: n.trim(), id: null })).filter(x => x.name) : []);
          const clickableDirectorsHtml = directorsArr.map(p =>
            '<span class="f-pill neutral" tabindex="0" onclick="' + (p.id ? ('openPersonView(' + Number(p.id) + ',\\'' + esc(p.name) + '\\')') : ('runSearch(false,\\'' + esc(p.name) + '\\',\\'person\\')')) + '" title="Alle Titel von ' + esc(p.name) + '">' + esc(p.name) + '</span>'
          ).join(" ");

          const castArr = Array.isArray(d.castList) && d.castList.length > 0
            ? d.castList
            : (d.casts && d.casts !== "Keine Angabe" ? d.casts.split(",").map(n => ({ name: n.trim(), id: null })).filter(x => x.name) : []);
          const clickableCastHtml = castArr.map(p =>
            '<span class="f-pill neutral" tabindex="0" onclick="' + (p.id ? ('openPersonView(' + Number(p.id) + ',\\'' + esc(p.name) + '\\')') : ('runSearch(false,\\'' + esc(p.name) + '\\',\\'person\\')')) + '" title="Alle Titel mit ' + esc(p.name) + '">' + esc(p.name) + '</span>'
          ).join(" ");

          const studiosArr = Array.isArray(d.studiosList) && d.studiosList.length > 0
            ? d.studiosList
            : (d.studios && d.studios !== "Keine Angabe" ? d.studios.split(",").map(s => ({ name: s.trim(), id: null })).filter(x => x.name) : []);
          const clickableStudiosHtml = studiosArr.map(sObj =>
            '<span class="f-pill neutral" tabindex="0" onclick="filterOrSearchStudioFromModal(\\'' + esc(sObj.name) + '\\',\\'' + esc(sObj.id || '') + '\\')" title="Alle Titel von Studio ' + esc(sObj.name) + '">' + esc(sObj.name) + '</span>'
          ).join(" ");

          const hasValidYear = Boolean(d.year && d.year !== 'K.A.');
          const clickableYearInDetailsHtml = hasValidYear
            ? ('<span class="f-pill neutral" tabindex="0" onclick="searchByYearFromModal(\\'' + esc(d.year) + '\\')" title="Alle Filme & Serien aus dem Jahr ' + esc(d.year) + ' suchen">📅 ' + esc(d.year) + '</span>')
            : '';

          const dedupedProvidersList = cleanAndDedupeProvidersClient(d.providers);
          const clickableProvidersHtml = dedupedProvidersList.map(pName =>
            '<span class="f-pill inc" tabindex="0" onclick="filterOrSearchProviderFromModal(\\'' + esc(pName) + '\\')" title="Nach Streaming-Anbieter filtern: ' + esc(pName) + '">📺 ' + esc(pName) + '</span>'
          ).join(" ");

          const fskClean = String(d.fsk || "").trim();
          const fskFilterTarget = FSK_OPTIONS_CLIENT.find(fo => fskClean.includes(fo)) || "";
          const hasValidFsk = Boolean(fskFilterTarget && !/keine angabe|unbekannt/i.test(fskClean));
          const prevAdj = getAdjacentDetailItem(-1);
          const nextAdj = getAdjacentDetailItem(1);
          const hasCreditsOrStudios = Boolean(clickableDirectorsHtml || clickableCastHtml || clickableStudiosHtml || clickableYearInDetailsHtml);

          // Edle einzeilige Metadaten-Elemente mit Trennpunkten (Apple TV+ / Netflix Stil)
          const cleanStatusLabel = (type === 's' && d.statusText && d.statusText !== 'Unbekannt')
            ? String(d.statusText).replace(/^[🔴🟢🟡⚪]\s*/, '').trim()
            : '';
          const heroMetaParts = [
            (d.vote && d.vote !== '0.0') ? ('<span class="modal-meta-item modal-meta-rating">★ ' + esc(d.vote) + '</span>') : '',
            hasValidFsk ? ('<span class="modal-meta-item modal-meta-fsk clickable" tabindex="0" onclick="filterByCategoryFromModal(\\'fsk\\',\\'' + esc(fskFilterTarget) + '\\')" title="Nach ' + esc(fskFilterTarget) + ' filtern">' + esc(fskFilterTarget) + '</span>') : '',
            (d.runtime && d.runtime !== 'Keine Angabe') ? ('<span class="modal-meta-item">' + esc(d.runtime) + '</span>') : '',
            (d.country && d.country !== 'k.A.' && d.country !== 'Keine Angabe') ? ('<span class="modal-meta-item clickable" tabindex="0" onclick="closeDetailModal();runSearch(false,\\'' + esc(d.country) + '\\')" title="Alle Titel aus ' + esc(d.country) + ' suchen">' + esc(d.country) + '</span>') : '',
            (type === 's' && d.numberOfSeasons) ? ('<span class="modal-meta-item">' + Number(d.numberOfSeasons) + (Number(d.numberOfSeasons) === 1 ? ' Staffel' : ' Staffeln') + ' (' + Number(d.numberOfEpisodes || 0) + ' Flg.)</span>') : '',
            cleanStatusLabel ? ('<span class="modal-meta-item">' + esc(cleanStatusLabel) + '</span>') : ''
          ].filter(Boolean);
          const heroMetaInlineHtml = heroMetaParts.join('<span class="modal-meta-dot">·</span>');

          // Prüfen, ob mehrteilige Film-Teile (z.B. CD1 & CD2 / Part 1 & Part 2) vorliegen
          const multiPartFiles = (vipAllowed && Array.isArray(d.files))
            ? d.files.filter(f => f && f.telegram_file_id && f.part)
            : [];
          const hasMultipleParts = multiPartFiles.length >= 2;
          const canReportMedia = Boolean(vipAllowed || state.authUser?.isAdmin);
          const isAdminUser = Boolean(state.authUser?.isAdmin);

          // Kompaktes Versions-Badge für den Flixnet Hero-Header (z.B. "Netflix-Fassung" / "Originalfassung")
          const allVersionsArr = Array.isArray(d.availableVersions) ? d.availableVersions.filter(Boolean) : [];
          const primaryVersionBadgeText = String(d.primaryVersionLabel || allVersionsArr[0] || "").trim();
          const allStreamFilesArr = Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 0
            ? d.allStreamFiles
            : (Array.isArray(d.files) ? d.files : []);
          const distinctVersionCount = Math.max(allVersionsArr.length, allStreamFilesArr.length > 0 ? 1 : 0);

          const initialTab = autoOpenTrailer ? "details" : "streams";
          state.activeDetailTab = initialTab;

          m.innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeDetailModal()">' +
            '<div class="modal">' +
              /* 1. FLIXNET-INSPIRIERTER HERO-HEADER: Großes TMDb-Backdrop mit Fade-Out, links Cover-Poster, rechts Titel, Jahr, Rating, Laufzeit, Genres & Versions-Badge */
              '<div class="modal-hero-banner" ontouchstart="onModalHeroTouchStart(event)" ontouchend="onModalHeroTouchEnd(event)" style="' + (backdropBanner ? ('background-image:url(' + esc(backdropBanner) + ')') : '') + '">' +
                '<div class="modal-hero-top">' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                    '<span class="hero-badge ' + (type === 's' ? 'series' : 'movie') + '">' + (type === 's' ? '📺 SERIE' : '🎬 FILM') + '</span>' +
                    (primaryVersionBadgeText ? '<span class="flix-version-badge" title="Aktive Schnittfassung / Version">🎞️ ' + esc(primaryVersionBadgeText) + (allVersionsArr.length > 1 ? (' +' + (allVersionsArr.length - 1)) : '') + '</span>' : '') +
                  '</div>' +
                  '<div style="display:flex;gap:6px;align-items:center">' +
                    (prevAdj ? '<button id="modalAdjPrevBtn" class="btn" onclick="navigateDetailModalAdjacent(-1)" title="Vorheriger Titel: ' + esc(prevAdj.title) + '">◀</button>' : '') +
                    (nextAdj ? '<button id="modalAdjNextBtn" class="btn" onclick="navigateDetailModalAdjacent(1)" title="Nächster Titel: ' + esc(nextAdj.title) + '">▶</button>' : '') +
                    '<button class="btn red" onclick="closeDetailModal()" title="Schließen">✖</button>' +
                  '</div>' +
                '</div>' +

                '<div class="flix-hero-grid">' +
                  (posterThumb
                    ? '<img class="flix-poster-card" src="' + esc(posterThumb) + '" onclick="openLightbox(\\''+esc(posterOrig)+'\\',\\''+esc(d.title)+'\\')" title="Antippen für großes Original-Poster" alt="' + esc(d.title) + '" />'
                    : '<div class="flix-poster-card" style="display:flex;align-items:center;justify-content:center;font-size:32px">' + (type === 's' ? '📺' : '🎬') + '</div>') +
                  '<div class="flix-meta-col">' +
                    '<div class="flix-title-row">' +
                      '<h2 style="font-size:24px;font-weight:900;color:#ffffff;margin:0;line-height:1.18;letter-spacing:-0.01em;text-shadow:0 2px 14px rgba(0,0,0,0.95)">' +
                        '<span style="cursor:pointer;color:#ffffff" onclick="runSearch(false,\\'' + esc(d.title) + '\\')" title="Antippen, um nach diesem Titel zu suchen">' + esc(d.title) + '</span>' +
                        (hasValidYear ? ' <span style="color:#94a3b8;font-weight:600;font-size:17px">(' + esc(d.year) + ')</span>' : '') +
                      '</h2>' +
                    '</div>' +

                    (heroMetaInlineHtml ? '<div class="modal-meta-inline">' + heroMetaInlineHtml + '</div>' : '') +

                    (heroInlineGenresHtml ? '<div class="modal-genre-inline">' + heroInlineGenresHtml + '</div>' : '') +

                    '<p style="font-size:12.5px;line-height:1.55;color:#cbd5e1;margin:2px 0 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden" title="Vollständige Beschreibung im Reiter Details">' +
                      esc(d.overview || 'Keine deutsche Beschreibung hinterlegt.') +
                    '</p>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              /* 2. TABS UNTER DEM HEADER: [ Staffeln & Episoden / Streams ] | [ Versionen ] | [ Details ] */
              '<div class="flix-tabs-bar">' +
                '<button type="button" id="flixTabBtn_streams" class="flix-tab-btn ' + (initialTab === 'streams' ? 'active' : '') + '" onclick="switchDetailModalTab(\\'streams\\')">' +
                  (type === 's' ? '📺 Staffeln & Episoden' : '🎬 Streams & Dateien') +
                '</button>' +
                '<button type="button" id="flixTabBtn_versions" class="flix-tab-btn ' + (initialTab === 'versions' ? 'active' : '') + '" onclick="switchDetailModalTab(\\'versions\\')">' +
                  '🎞️ Versionen' + (distinctVersionCount > 0 ? (' (' + distinctVersionCount + ')') : '') +
                '</button>' +
                '<button type="button" id="flixTabBtn_details" class="flix-tab-btn ' + (initialTab === 'details' ? 'active' : '') + '" onclick="switchDetailModalTab(\\'details\\')">' +
                  'ℹ️ Details' + (tr ? ' & Trailer' : '') +
                '</button>' +
              '</div>' +

              '<div class="modal-body">' +
                /* Vereinte, ruhige Aktionsleiste: Links Hauptaktionen, rechts dezente Admin- & Melde-Werkzeuge */
                '<div class="modal-actions-row">' +
                  '<div class="modal-actions-primary">' +
                    ((d.providerButtons && d.providerButtons.length > 0) ? (
                      d.providerButtons.map(pb =>
                        '<a class="btn-action-glass" href="' + esc(pb.url) + '" target="_blank" rel="noopener noreferrer" style="background:' + esc(pb.bg || 'rgba(229,9,20,0.22)') + ';border-color:' + esc(pb.border || '#e50914') + ';color:#fff">' + esc(pb.buttonText) + '</a>'
                      ).join("")
                    ) : '') +
                    '<button id="modalWishlistBtn" class="btn-action-glass ' + (d.isSaved ? 'saved green' : '') + '" onclick="toggleWishlistItem(\\''+type+'\\','+d.id+')">' + (d.isSaved ? '✅ Gespeichert' : '💾 Merkliste') + '</button>' +
                    '<button class="btn-action-glass" onclick="loadSimilarInTma(\\''+type+'\\','+d.id+')">✨ Ähnliche Titel</button>' +
                  '</div>' +
                  '<div class="modal-actions-tools">' +
                    (isAdminUser ? '<button type="button" class="btn-tool-quiet" onclick="toggleModalPosterPicker(\\''+type+'\\','+d.id+')" title="Original-Cover von TMDb (EN/DE), Apple iTunes DE, OMDb oder eigene Bild-URL wählen">🖼️ Cover</button>' : '') +
                    (isAdminUser ? '<button type="button" class="btn-tool-quiet" onclick="toggleModalRemapBox(\\''+type+'\\','+d.id+')" title="Falsch zugeordneten Film/Serie inkl. Original-Dateiname & Telegram-Link neu zuordnen">🔄 Zuordnen</button>' : '') +
                    (canReportMedia ? '<button type="button" class="btn-tool-quiet" onclick="openMediaReportModal({typeCode:\\''+type+'\\',tmdbId:'+Number(d.id)+',title:\\''+esc(d.title)+'\\',versionLabel:\\''+esc(primaryVersionBadgeText || 'Originalfassung')+'\\'})" title="Falschen Titel, falsche Staffel/Folge oder defektes Video melden">⚠️ Melden</button>' : '') +
                    '<button type="button" id="modalMoreActionsBtn" class="btn-tool-quiet" onclick="toggleModalMoreActions()" title="Teilen, Telegraph-Guide, Original-Poster & TMDb">⋯ Mehr ▾</button>' +
                  '</div>' +
                '</div>' +

                '<div id="modalPosterPickerBox" style="display:none;margin:10px 0;padding:12px;border-radius:10px;background:rgba(15,23,42,0.92);border:1px solid rgba(168,85,247,0.45)"></div>' +
                '<div id="modalRemapMediaBox" style="display:none;margin:10px 0;padding:12px;border-radius:10px;background:rgba(15,23,42,0.92);border:1px solid rgba(56,189,248,0.45)"></div>' +

                '<div id="modalMoreActionsBox" style="display:none;gap:6px;flex-wrap:wrap;padding:8px 10px;margin-bottom:10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(148,163,184,0.2)">' +
                  '<button class="btn purple" onclick="shareItemFromTma(\\''+type+'\\','+d.id+')">📤 Über Telegram teilen</button>' +
                  '<button class="btn" onclick="sendSharePostToBotChat(\\''+type+'\\','+d.id+')">💬 Teilen-Post im Bot</button>' +
                  '<button class="btn blue" onclick="openInBot(\\'' + type + '_' + d.id + '\\')">🤖 Im Bot öffnen</button>' +
                  (d.telegraphUrl ? '<a class="btn" href="' + esc(d.telegraphUrl) + '" target="_blank">📖 Telegraph-Guide</a>' : '') +
                  (posterOrig ? '<button class="btn" onclick="openLightbox(\\''+esc(posterOrig)+'\\',\\''+esc(d.title)+' – Original-Poster\\')">🖼️ Original-Poster</button>' : '') +
                  (backdropOrig ? '<button class="btn" onclick="openLightbox(\\''+esc(backdropOrig)+'\\',\\''+esc(d.title)+' – Szenenbild\\')">🏞️ Szenenbild</button>' : '') +
                  (d.tmdbDeUrl ? '<a class="btn" href="' + esc(d.tmdbDeUrl) + '" target="_blank" rel="noopener noreferrer">🌐 Auf TMDb ansehen</a>' : '') +
                  (!tr ? '<a class="btn red" href="' + esc(ytSearchUrl) + '" target="_blank" rel="noopener noreferrer">🔎 Trailer auf YouTube suchen</a>' : '') +
                '</div>' +

                '<div id="similarModalBox"></div>' +

                /* TAB 1: STAFFELN & EPISODEN (bzw. STREAMS & DATEIEN bei Filmen) */
                '<div id="flixTabPanel_streams" style="display:' + (initialTab === 'streams' ? 'block' : 'none') + '">' +
                  ((vipAllowed && type === 'm' && d.files && d.files.length > 0) ? (
                    buildMovieStreamsReleaseSectionHtml(d, isAdminUser, canReportMedia)
                  ) : (!vipAllowed && type === 'm' ? (
                    '<div class="panel-box" style="margin:6px 0;text-align:center;color:#94a3b8;font-size:12.5px">' +
                      '🔒 Direkt-Streams & Downloads sind exklusiv für freigeschaltete <b>VIP-Mitglieder</b> sichtbar. Nutze die Tabs oben für <b>Versionen</b> & <b>Details / Trailer</b>.' +
                    '</div>'
                  ) : '')) +
                  (type === 's' ? '<div id="seasonBox" style="margin-top:4px">Lade Episoden...</div>' : '') +
                '</div>' +

                /* TAB 2: VERSIONEN (Übersicht aller Schnittfassungen, Episode-Groups & Dateien) */
                '<div id="flixTabPanel_versions" style="display:' + (initialTab === 'versions' ? 'block' : 'none') + '">' +
                  buildDetailModalVersionsTabHtml(d, type, vipAllowed, isAdminUser, canReportMedia) +
                '</div>' +

                /* TAB 3: DETAILS & TRAILER (Vollständige Beschreibung, Besetzung, Regie, Studios, Reihen, Trailer) */
                '<div id="flixTabPanel_details" style="display:' + (initialTab === 'details' ? 'block' : 'none') + '">' +
                  ((d.collection || d.universe) ? (
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px">' +
                      (d.collection ? (
                        '<button class="btn purple" onclick="openCollectionView(' + d.collection.id + ')">🍿 Reihe: ' + esc(d.collection.name) + '</button>'
                      ) : '') +
                      (d.universe ? (
                        '<button class="btn green" onclick="openUniverseView(\\''+esc(d.universe.id)+'\\')">' + esc(d.universe.icon || '🌌') + ' ' + esc(d.universe.name) + '</button>'
                      ) : '') +
                    '</div>'
                  ) : '') +

                  '<div class="panel-box" style="margin:6px 0 10px">' +
                    '<div class="detail-meta-label" style="margin-bottom:6px">📖 Handlung & Beschreibung</div>' +
                    '<p style="font-size:13px;line-height:1.6;color:var(--text);margin:0">' + esc(d.overview || 'Keine deutsche Beschreibung hinterlegt.') + '</p>' +
                  '</div>' +

                  ((clickableGenresHtml || clickableProvidersHtml) ? (
                    '<div class="detail-meta-grid" style="margin:8px 0">' +
                      (clickableGenresHtml ? '<div class="detail-meta-row"><span class="detail-meta-label">🎞️ Genres</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableGenresHtml + '</div></div>' : '') +
                      (clickableProvidersHtml ? '<div class="detail-meta-row"><span class="detail-meta-label">📺 Verfügbar bei</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableProvidersHtml + '</div></div>' : '') +
                    '</div>'
                  ) : '') +

                  (hasCreditsOrStudios ? (
                    '<div id="modalCreditsCollapseBox" class="detail-meta-grid" style="display:grid;margin-top:6px;margin-bottom:10px">' +
                      (clickableYearInDetailsHtml ? '<div class="detail-meta-row"><span class="detail-meta-label">📅 Erscheinungsjahr</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableYearInDetailsHtml + '</div></div>' : '') +
                      (clickableDirectorsHtml ? '<div class="detail-meta-row"><span class="detail-meta-label">🎬 Regie</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableDirectorsHtml + '</div></div>' : '') +
                      (clickableStudiosHtml ? '<div class="detail-meta-row"><span class="detail-meta-label">🏢 Studios</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableStudiosHtml + '</div></div>' : '') +
                      (clickableCastHtml ? '<div class="detail-meta-row" style="grid-column:1 / -1"><span class="detail-meta-label">🌟 Besetzung</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableCastHtml + '</div></div>' : '') +
                    '</div>'
                  ) : '') +

                  (tr ? '<div class="modal-sub-box" style="margin:10px 0;padding:10px;background:var(--card);border-radius:10px;border:1px solid rgba(229,9,20,0.32)">' +
                    '<div style="font-size:12px;color:var(--text);margin-bottom:7px">🎬 <b>Trailer direkt abspielen & Standard-Quelle wählen:</b></div>' +
                    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                      TRAILER_PROVIDERS_CLIENT.map(tp =>
                        '<button class="btn ' + (trailerProvider === tp.id ? 'red' : '') + '" data-detail-tp-id="' + esc(tp.id) + '" onclick="switchEmbedSource(\\'' + esc(tp.id) + '\\',true)">' + esc(tp.label) + (trailerProvider === tp.id ? ' ✓ Standard' : '') + '</button>'
                      ).join("") +
                    '</div>' +
                    '<div id="trailerEmbedContainer"></div>' +
                  '</div>' : '') +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
          if (tr && autoOpenTrailer) switchEmbedSource(trailerProvider || "youtube", false);
          if (type === 's') {
            const savedProg = getSeriesProgress(d.id);
            const initialSeason = (forceSeasonNum && Number(forceSeasonNum) > 0)
              ? Number(forceSeasonNum)
              : (savedProg && savedProg.season > 0)
                ? savedProg.season
                : (Number(d.firstVipSeason || 0) > 0 ? Number(d.firstVipSeason) : 1);
            loadSeason(d.id, initialSeason, false);
          }
          const firstModalBtn = m.querySelector("#modalWishlistBtn, .modal-body .btn");
          if (firstModalBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstModalBtn, false);
          }
          if (window._pendingModalAdminAction === "poster") {
            window._pendingModalAdminAction = null;
            toggleModalPosterPicker(type, d.id || id);
          } else if (window._pendingModalAdminAction === "remap") {
            window._pendingModalAdminAction = null;
            toggleModalRemapBox(type, d.id || id);
          } else if (window._pendingEpisodeCorrectionArgs) {
            const pendingArgs = window._pendingEpisodeCorrectionArgs;
            window._pendingEpisodeCorrectionArgs = null;
            setTimeout(() => openEpisodeCorrectionModal(pendingArgs), 260);
          }
        } catch (err) {
          clientDetailsCache.delete(cacheKey);
          showHudToast("⚠️ Details konnten nicht geladen werden – bitte erneut antippen.");
        } finally {
          setBusyState(false);
        }
      }

      function switchDetailModalTab(tabName) {
        state.activeDetailTab = tabName;
        const tabs = ["streams", "versions", "details"];
        for (const t of tabs) {
          const btn = document.getElementById("flixTabBtn_" + t);
          const panel = document.getElementById("flixTabPanel_" + t);
          if (btn) btn.classList.toggle("active", t === tabName);
          if (panel) panel.style.display = t === tabName ? "block" : "none";
        }
        if (tabName === "details" && state.activeDetails?.trailers) {
          const container = document.getElementById("trailerEmbedContainer");
          if (container && !container.innerHTML.trim()) {
            switchEmbedSource(trailerProvider || "youtube", false);
          }
        }
      }

      function buildDetailModalVersionsTabHtml(d, type, vipAllowed, isAdminUser, canReportMedia) {
        const allFiles = Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 0
          ? d.allStreamFiles
          : (Array.isArray(d.files) ? d.files : []);
        if (!vipAllowed && !isAdminUser) {
          return '<div class="panel-box" style="margin:6px 0;text-align:center;color:#94a3b8;font-size:12.5px">' +
            '🔒 Die detaillierte Versions- & Schnittfassungs-Übersicht ist exklusiv für freigeschaltete <b>VIP-Mitglieder</b> und Administratoren verfügbar.' +
          '</div>';
        }
        if (allFiles.length === 0) {
          return '<div class="panel-box" style="margin:6px 0;text-align:center;color:#94a3b8;font-size:12.5px">' +
            'ℹ️ Für diesen Titel sind aktuell noch keine separaten Schnittfassungen oder Stream-Dateien in D1 hinterlegt.' +
          '</div>';
        }

        // Gruppiere alle Dateien nach Schnittfassung / Version (z.B. "Netflix-Fassung", "Originalfassung", "📦 RAR-Archiv")
        const groupsMap = new Map();
        for (const f of allFiles) {
          if (!f) continue;
          const isRar = String(f.codec || "").toUpperCase() === "RAR" || /^RAR/i.test(String(f.part || "")) || /\.rar$/i.test(String(f.raw_filename || ""));
          const vLbl = isRar ? "📦 RAR-Archiv" : (String(f.versionLabel || f.version_label || f.tags || "Originalfassung").trim() || "Originalfassung");
          if (!groupsMap.has(vLbl)) groupsMap.set(vLbl, []);
          groupsMap.get(vLbl).push(f);
        }

        return '<div class="panel-box" style="margin:6px 0">' +
          '<div class="section-title" style="margin-bottom:8px">' +
            '<span>🎞️ Verfügbare Schnittfassungen & Versionen (' + groupsMap.size + ' Fassung' + (groupsMap.size === 1 ? '' : 'en') + ' • ' + allFiles.length + ' Datei' + (allFiles.length === 1 ? '' : 'en') + ')</span>' +
          '</div>' +
          '<div style="font-size:11.5px;color:#94a3b8;margin-bottom:10px">' +
            'Hier siehst du alle hinterlegten Schnittfassungen & Kategorien (z.B. <b>Netflix-Fassung</b>, <b>Originalfassung</b> oder <b>📦 RAR-Archiv</b>). ' +
            (isAdminUser ? 'Über den <b>✏️ Stift-Button</b> kannst du jede Folge/Datei einzeln einer anderen Staffel, Folge, Version oder TMDb-ID zuweisen.' : '') +
          '</div>' +
          Array.from(groupsMap.entries()).map(([vLabel, filesList]) => {
            return '<div style="margin-bottom:12px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1)">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
                '<span class="flix-version-badge">🎞️ ' + esc(vLabel) + '</span>' +
                '<span style="font-size:11.5px;color:#94a3b8;font-weight:700">' + filesList.length + (type === 's' ? (' Folge' + (filesList.length === 1 ? '' : 'n')) : (' Datei' + (filesList.length === 1 ? '' : 'en'))) + '</span>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:5px;max-height:280px;overflow-y:auto;padding-right:2px">' +
                filesList.map(f => {
                  const sNum = Number(f.season_number || 1);
                  const eNum = Number(f.episode_number || 1);
                  const epCode = type === 's' ? ('S' + String(sNum).padStart(2, '0') + 'E' + String(eNum).padStart(2, '0')) : '';
                  const sizeStr = formatFileSizeClient(f.file_size);
                  const isRar = String(f.codec || "").toUpperCase() === "RAR" || /^RAR/i.test(String(f.part || "")) || /\.rar$/i.test(String(f.raw_filename || ""));
                  const partStr = String(f.part || "").trim();
                  const subsList = Array.isArray(f.subtitles) ? f.subtitles : [];
                  const qualStr = [f.quality || '1080p', f.codec || '', partStr ? ('• ' + partStr) : '', sizeStr ? ('• ' + sizeStr) : ''].filter(Boolean).join(' ');
                  return '<div class="ep-row" style="margin-bottom:0;padding:6px 8px">' +
                    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;min-width:150px">' +
                      (epCode ? '<b style="color:#38bdf8;font-size:12px">' + esc(epCode) + '</b>' : '<b style="color:#38bdf8;font-size:12px">' + (isRar ? '📦 RAR' : '🎬 Film') + '</b>') +
                      '<span class="stream-meta-pill">' + esc(qualStr) + '</span>' +
                      (subsList.length > 0 ? '<span class="stream-meta-pill" style="border-color:rgba(16,185,129,0.5);color:#34d399">💬 ' + subsList.length + ' UT</span>' : '') +
                      (isAdminUser && f.raw_filename ? '<span style="font-size:10.5px;color:#94a3b8;font-family:monospace;word-break:break-all">📄 ' + esc(f.raw_filename) + '</span>' : '') +
                    '</div>' +
                    '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                      '<button class="btn ' + (isRar ? 'amber' : 'red') + '" style="padding:3px 8px;font-size:11px" onclick="requestTelegramStream(\\'' + esc(f.telegram_file_id) + '\\',\\'' + esc(d.title + (epCode ? (' ' + epCode) : '') + (partStr ? (' (' + partStr + ')') : '')) + '\\',\\'' + esc(f.quality || '1080p') + '\\',{seriesId:' + Number(d.id) + ',season:' + sNum + ',episode:' + eNum + ',fileSize:\\'' + esc(sizeStr) + '\\',tags:\\'' + esc(vLabel) + '\\'})">' + (isRar ? '📦 RAR senden' : ('▶️ Stream' + (subsList.length > 0 ? ' + UT' : ''))) + '</button>' +
                      (subsList.length > 0 ? '<button type="button" class="btn blue" style="padding:3px 8px;font-size:11px" onclick="requestTelegramSubtitleOnly(\\'' + esc(f.telegram_file_id) + '\\',\\'' + esc(d.title + (epCode ? (' ' + epCode) : '')) + '\\',{seriesId:' + (type === 's' ? Number(d.id) : 'null') + ',season:' + sNum + ',episode:' + eNum + '})" title="Nur Untertitel einzeln senden">💬 UT (' + subsList.length + ')</button>' : '') +
                      (isAdminUser ? '<button type="button" class="btn ep-icon-btn" onclick="openEpisodeCorrectionModal({typeCode:\\'' + type + '\\',tmdbId:' + Number(d.id) + ',title:\\'' + esc(d.title) + '\\',season:' + sNum + ',episode:' + eNum + ',telegramFileId:\\'' + esc(f.telegram_file_id) + '\\',versionLabel:\\'' + esc(vLabel) + '\\',quality:\\'' + esc(f.quality || '1080p') + '\\',rawFilename:\\'' + esc(f.raw_filename || '') + '\\',messageLink:\\'' + esc(f.message_link || '') + '\\'})" title="Folge/Datei korrigieren">✏️</button>' : '') +
                      (canReportMedia ? '<button type="button" class="btn ep-icon-btn" onclick="openMediaReportModal({typeCode:\\'' + type + '\\',tmdbId:' + Number(d.id) + ',title:\\'' + esc(d.title) + '\\',season:' + sNum + ',episode:' + eNum + ',telegramFileId:\\'' + esc(f.telegram_file_id) + '\\',versionLabel:\\'' + esc(vLabel) + '\\'})" title="Fehler melden">⚠️</button>' : '') +
                    '</div>' +
                  '</div>';
                }).join("") +
              '</div>' +
            '</div>';
          }).join("") +
        '</div>';
      }

      async function openDetailsWithAdminTool(type, id, toolName) {
        window._pendingModalAdminAction = toolName;
        await openDetails(type, id, false);
      }

      async function toggleModalPosterPicker(typeCode, mediaId) {
        const box = document.getElementById("modalPosterPickerBox");
        if (!box) return;
        if (box.style.display === "block") {
          box.style.display = "none";
          return;
        }
        box.style.display = "block";
        box.innerHTML = '<div style="font-size:12px;color:#cbd5e1">⏳ Lade verfügbare Cover von TMDb (Original EN / DE / Textless), Apple iTunes DE & OMDb...</div>';
        try {
          const title = state.activeDetails?.title || "";
          const year = state.activeDetails?.year || "";
          const r = await apiFetchJson(API_BASE + "/admin/posters?type=" + encodeURIComponent(typeCode) + "&id=" + encodeURIComponent(mediaId) + "&title=" + encodeURIComponent(title) + "&year=" + encodeURIComponent(year));
          const posters = Array.isArray(r?.posters) ? r.posters : [];
          box.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
              '<div style="font-size:13px;font-weight:800;color:#e9d5ff">🖼️ Cover / Poster auswählen (' + posters.length + ' gefunden)</div>' +
              '<button type="button" class="btn" style="padding:2px 8px;font-size:11px" onclick="document.getElementById(\\'modalPosterPickerBox\\').style.display=\\'none\\'">✖ Schließen</button>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
              '<input id="customPosterUrlInp" placeholder="Eigene Bild-URL (https://...jpg/png) oder TMDb /path.jpg" style="flex:1;min-width:210px;padding:6px 9px;border-radius:6px;background:#090d16;color:#fff;border:1px solid rgba(168,85,247,0.4);font-size:12px" />' +
              '<button type="button" class="btn purple" onclick="applyCustomModalPoster(\\'' + esc(typeCode) + '\\',' + Number(mediaId) + ')">💾 URL als Cover speichern</button>' +
            '</div>' +
            (posters.length > 0 ? (
              '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:10px;max-height:360px;overflow-y:auto;padding:4px">' +
                posters.map(p =>
                  '<div style="display:flex;flex-direction:column;gap:4px;background:rgba(255,255,255,0.04);padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);cursor:pointer" onclick="selectModalPosterOption(\\'' + esc(typeCode) + '\\',' + Number(mediaId) + ',\\'' + esc(p.poster_path || '') + '\\',\\'' + esc(p.external_poster_url || p.url || '') + '\\')">' +
                    '<img src="' + esc(p.thumb || p.url) + '" loading="lazy" style="width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:6px;background:#111" />' +
                    '<div style="font-size:10.5px;font-weight:700;color:#e2e8f0;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.label || p.source || 'Poster') + '</div>' +
                    '<button type="button" class="btn green" style="padding:3px 6px;font-size:10px;width:100%">✓ Wählen</button>' +
                  '</div>'
                ).join("") +
              '</div>'
            ) : '<div style="font-size:12px;color:#94a3b8">Keine alternativen Galerie-Poster gefunden – du kannst oben direkt eine eigene Bild-URL einfügen.</div>');
        } catch (e) {
          box.innerHTML = '<div style="font-size:12px;color:#f87171">⚠️ Fehler beim Laden der Cover-Galerie.</div>';
        }
      }

      async function applyCustomModalPoster(typeCode, mediaId) {
        const val = (document.getElementById("customPosterUrlInp")?.value || "").trim();
        if (!val) {
          showHudToast("⚠️ Bitte zuerst eine Bild-URL eingeben.");
          return;
        }
        const isTmdbPath = val.startsWith("/") && !val.startsWith("//");
        await selectModalPosterOption(typeCode, mediaId, isTmdbPath ? val : "", isTmdbPath ? "" : val);
      }

      async function selectModalPosterOption(typeCode, mediaId, posterPath, externalPosterUrl) {
        setBusyState(true, "🖼️ Aktualisiere Cover in D1 & Playlists...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/update-poster", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              typeCode,
              tmdbId: Number(mediaId),
              poster_path: posterPath || null,
              external_poster_url: externalPosterUrl || ""
            })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Cover konnte nicht gespeichert werden."));
            return;
          }
          clearClientMediaCaches();
          const newThumb = resolvePosterUrlClient(r.poster_path, "w342", r.external_poster_url || "");
          if (newThumb) {
            syncCardPosterInDom(typeCode, mediaId, newThumb);
          }
          showHudToast("✅ Neues Cover gespeichert!");
          await openDetails(typeCode, mediaId, false);
        } finally {
          setBusyState(false);
        }
      }

      async function toggleModalRemapBox(typeCode, mediaId) {
        const box = document.getElementById("modalRemapMediaBox");
        if (!box) return;
        if (box.style.display === "block") {
          box.style.display = "none";
          return;
        }
        box.style.display = "block";
        const d = state.activeDetails || {};
        const allFiles = Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 0
          ? d.allStreamFiles
          : (Array.isArray(d.files) ? d.files : []);
        const firstFile = allFiles[0] || {};
        const origFilename = firstFile.raw_filename || d.rawFilename || d.title || "";
        const origCaption = firstFile.raw_caption || "";
        const origSeedQuery = origFilename
          ? origFilename.replace(/\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i, "").replace(/[._]+/g, " ")
          : (d.title || "");

        const filesMetaHtml = allFiles.length > 0 ? (
          '<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(148,163,184,0.2);font-size:11.5px">' +
            '<div style="font-weight:800;color:#7dd3fc;margin-bottom:4px">📂 Verknüpfte Original-Dateien & Telegram-Links (' + allFiles.length + '):</div>' +
            '<div style="display:flex;flex-direction:column;gap:5px;max-height:135px;overflow-y:auto">' +
              allFiles.map(f => {
                const fn = f.raw_filename || f.telegram_file_id || "Unbekannte Datei";
                const cap = f.raw_caption ? (' — ' + f.raw_caption) : '';
                const mLink = f.message_link || "";
                const epTag = (f.season_number || f.episode_number)
                  ? ('<span class="stream-meta-pill">S' + String(f.season_number || 1).padStart(2, '0') + 'E' + String(f.episode_number || 1).padStart(2, '0') + '</span> ')
                  : '';
                return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 6px;border-radius:6px;background:rgba(0,0,0,0.35)">' +
                  '<div style="word-break:break-all;color:#e2e8f0;flex:1">' + epTag + '<code>' + esc(fn) + '</code>' + (cap ? '<span style="color:#94a3b8">' + esc(cap) + '</span>' : '') + '</div>' +
                  '<div style="display:flex;gap:5px;align-items:center">' +
                    (mLink ? '<a class="btn blue" style="padding:2px 7px;font-size:10.5px" href="' + esc(mLink) + '" target="_blank" rel="noopener noreferrer">🔗 Original-Post</a>' : '') +
                    '<button type="button" class="btn" style="padding:2px 7px;font-size:10.5px" onclick="document.getElementById(\\'modalRemapSearchInp\\').value=\\'' + esc(fn.replace(/\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i, '')) + '\\';searchModalRemapCandidates(\\'' + esc(typeCode) + '\\',' + Number(mediaId) + ')">🔎 Als Suchtitel</button>' +
                  '</div>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>'
        ) : '';

        box.innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
            '<div style="font-size:13px;font-weight:800;color:#38bdf8">🔄 Falsch zugeordnet? Titel / Serie neu zuordnen</div>' +
            '<button type="button" class="btn" style="padding:2px 8px;font-size:11px" onclick="document.getElementById(\\'modalRemapMediaBox\\').style.display=\\'none\\'">✖ Schließen</button>' +
          '</div>' +
          filesMetaHtml +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            '<input id="modalRemapSearchInp" value="' + esc(origSeedQuery) + '" placeholder="Suchbegriff oder TMDb-ID (z.B. Zur See, Pippi Langstrumpf, tmdb:40964)..." style="flex:1;min-width:190px;padding:6px 9px;border-radius:6px;background:#090d16;color:#fff;border:1px solid rgba(56,189,248,0.4);font-size:12px" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();searchModalRemapCandidates(\\'' + esc(typeCode) + '\\',' + Number(mediaId) + ');}" />' +
            '<select id="modalRemapTypeSel" style="padding:6px 8px;border-radius:6px;background:#090d16;color:#fff;border:1px solid rgba(56,189,248,0.4);font-size:12px">' +
              '<option value="">Alle (Film & Serie)</option>' +
              '<option value="m">🎬 Nur Filme</option>' +
              '<option value="s">📺 Nur Serien / Anime</option>' +
            '</select>' +
            '<span style="font-size:11px;color:#94a3b8">Staffel/Folge (bei Serie):</span>' +
            '<input id="modalRemapSeasonInp" type="number" min="1" max="99" value="1" title="Ziel-Staffel" style="width:48px;padding:5px;border-radius:6px;background:#090d16;color:#fff;border:1px solid rgba(56,189,248,0.4);font-size:12px;text-align:center" />' +
            '<input id="modalRemapEpisodeInp" type="number" min="1" max="999" value="1" title="Ziel-Folge" style="width:54px;padding:5px;border-radius:6px;background:#090d16;color:#fff;border:1px solid rgba(56,189,248,0.4);font-size:12px;text-align:center" />' +
            '<button type="button" class="btn blue" onclick="searchModalRemapCandidates(\\'' + esc(typeCode) + '\\',' + Number(mediaId) + ')">🔎 Suchen (8 APIs)</button>' +
          '</div>' +
          '<div id="modalRemapResultsBox" style="display:flex;flex-direction:column;gap:6px"></div>';

        searchModalRemapCandidates(typeCode, mediaId);
      }

      async function searchModalRemapCandidates(oldTypeCode, oldMediaId) {
        const q = (document.getElementById("modalRemapSearchInp")?.value || "").trim();
        const forceTc = (document.getElementById("modalRemapTypeSel")?.value || "").trim();
        const resBox = document.getElementById("modalRemapResultsBox");
        if (!resBox || !q) return;
        resBox.innerHTML = '<div style="font-size:11.5px;color:#94a3b8">⏳ Durchsuche TMDb, Apple iTunes DE, TVMaze, AniList, MyAnimeList, OMDb & Wikidata...</div>';
        try {
          const r = await apiFetchJson(API_BASE + "/admin/tmdb-candidates?q=" + encodeURIComponent(q) + (forceTc ? ("&type=" + encodeURIComponent(forceTc)) : ""));
          const cands = Array.isArray(r?.candidates) ? r.candidates : [];
          if (cands.length === 0) {
            resBox.innerHTML = '<div style="font-size:11.5px;color:#f87171">Keine Treffer gefunden. Versuche den reinen Serientitel oder <code>tmdb:ID</code>.</div>';
            return;
          }
          const firstInferredEp = cands.find(c => c.inferredEpisode);
          if (firstInferredEp) {
            const sInp = document.getElementById("modalRemapSeasonInp");
            const eInp = document.getElementById("modalRemapEpisodeInp");
            if (sInp && firstInferredEp.inferredSeason) sInp.value = String(firstInferredEp.inferredSeason);
            if (eInp && firstInferredEp.inferredEpisode) eInp.value = String(firstInferredEp.inferredEpisode);
          }
          resBox.innerHTML = cands.map(c => {
            const epHint = c.inferredEpisode
              ? (' • <span style="color:#fde047;font-weight:800">Erkannt: S' + String(c.inferredSeason || 1).padStart(2, '0') + 'E' + String(c.inferredEpisode).padStart(2, '0') + (c.inferredEpisodeTitle ? (' (' + esc(c.inferredEpisodeTitle) + ')') : '') + '</span>')
              : '';

            return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1)">' +
              '<div style="display:flex;gap:8px;align-items:center">' +
                (c.poster ? '<img src="' + esc(c.poster) + '" style="width:32px;height:48px;object-fit:cover;border-radius:4px" />' : '') +
                '<div style="font-size:12px">' +
                  '<b>' + esc(c.title) + '</b> (' + esc(c.year || 'k.A.') + ') ' +
                  '<span class="f-pill neutral" style="font-size:10px;padding:1px 5px">' + (c.typeCode === 's' ? '📺 Serie' : '🎬 Film') + ' • ' + esc(c.source || 'TMDb') + ' #' + c.tmdbId + '</span>' +
                  epHint +
                '</div>' +
              '</div>' +
              '<button type="button" class="btn green" style="padding:4px 9px;font-size:11px" onclick="executeModalRemapMedia(\\'' + esc(oldTypeCode) + '\\',' + Number(oldMediaId) + ',\\'' + esc(c.typeCode) + '\\',' + Number(c.tmdbId) + ',' + Number(c.inferredSeason || 0) + ',' + Number(c.inferredEpisode || 0) + ')">✓ Jetzt zuordnen</button>' +
            '</div>';
          }).join("");
        } catch (e) {
          resBox.innerHTML = '<div style="font-size:11.5px;color:#f87171">⚠️ Suche fehlgeschlagen.</div>';
        }
      }

      async function executeModalRemapMedia(oldTypeCode, oldTmdbId, newTypeCode, newTmdbId, inferredSeason = 0, inferredEpisode = 0) {
        const sVal = Number(document.getElementById("modalRemapSeasonInp")?.value || inferredSeason || 1);
        const eVal = Number(document.getElementById("modalRemapEpisodeInp")?.value || inferredEpisode || 1);
        setBusyState(true, "🔄 Ordne Dateien & Streams dem neuen Titel zu...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/remap-saved-media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              oldTypeCode,
              oldTmdbId: Number(oldTmdbId),
              newTypeCode,
              newTmdbId: Number(newTmdbId),
              season: sVal,
              episode: eVal
            })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Neuzuordnung fehlgeschlagen."));
            return;
          }
          clearClientMediaCaches();
          showHudToast("✅ Erfolgreich neu zugeordnet zu: " + (r.newTitle || ("#" + newTmdbId)));
          await openDetails(newTypeCode, newTmdbId, false);
          if (state.mode === "admin") {
            loadAdminPanelView();
          } else {
            loadView(false);
          }
        } finally {
          setBusyState(false);
        }
      }

      // =========================================================================
      // VERSAND-ZIEL & CUSTOM-BOT KONFIGURATION (Privat-Chat vs. Eigene Gruppe vs. Eigener Bot)
      // =========================================================================
      let modalDeliveryConfigExpanded = false;

      function getDeliveryPreferencesClient() {
        const defaults = {
          targetMode: "dm", // 'dm' | 'group' | 'custom_bot'
          targetGroupChatId: "",
          targetTopicId: "",
          sourceBridgeChatId: "",
          customBotToken: "",
          customBotUsername: "",
          retentionDays: 30 // 7 | 30 | 90 Tage KV Retention Policy
        };
        let local = {};
        try {
          const raw = localStorage.getItem("tma_delivery_prefs_v1");
          if (raw) local = JSON.parse(raw) || {};
        } catch (e) {}
        const fromServer = (state.settings && state.settings.deliveryConfig && typeof state.settings.deliveryConfig === "object")
          ? state.settings.deliveryConfig
          : {};
        const merged = { ...defaults, ...fromServer, ...local };
        const rDays = Number(merged.retentionDays);
        merged.retentionDays = (rDays === 7 || rDays === 30 || rDays === 90) ? rDays : 30;
        return merged;
      }

      function saveDeliveryPreferencesClient(partial, syncServer = true) {
        const next = { ...getDeliveryPreferencesClient(), ...partial };
        try {
          localStorage.setItem("tma_delivery_prefs_v1", JSON.stringify(next));
        } catch (e) {}
        if (!state.settings) state.settings = {};
        state.settings.deliveryConfig = next;
        if (syncServer) {
          apiFetchJson(API_BASE + "/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, action: "save_delivery_config", deliveryConfig: next })
          }).catch(() => {});
        }
        return next;
      }

      function getActiveDeliveryButtonLabelClient() {
        const prefs = getDeliveryPreferencesClient();
        if (prefs.targetMode === "group") {
          return prefs.targetGroupChatId ? "👥 In Gruppe senden" : "👥 Gruppe wählen & senden";
        }
        if (prefs.targetMode === "custom_bot") {
          return prefs.customBotUsername ? ("🤖 via @" + prefs.customBotUsername + " senden") : "🤖 Über eigenen Bot senden";
        }
        return "💬 An Bot-Chat senden";
      }

      function buildModalDeliveryTargetSelectorHtml() {
        const prefs = getDeliveryPreferencesClient();
        const mode = prefs.targetMode || "dm";
        const showConfigInputs = modalDeliveryConfigExpanded || (mode === "group" && !prefs.targetGroupChatId) || (mode === "custom_bot" && !prefs.customBotToken);
        const activeModeSummary = mode === "group"
          ? ("Eigene Gruppe" + (prefs.targetGroupChatId ? (" (" + esc(prefs.targetGroupChatId) + ")") : " (ID fehlt)"))
          : mode === "custom_bot"
            ? ("Eigener Bot" + (prefs.customBotUsername ? (" (@" + esc(prefs.customBotUsername) + ")") : ""))
            : "Bot-Privatchat (DM)";
        return '<div id="modalDeliveryTargetMount" class="delivery-inline-wrap">' +
          '<div class="delivery-inline-pills" title="Aktives Versandziel: ' + activeModeSummary + '">' +
            '<span class="delivery-inline-label">📤 Ziel:</span>' +
            '<button type="button" class="delivery-pill-btn ' + (mode === 'dm' ? 'active' : '') + '" onclick="switchModalDeliveryModeClient(\\'dm\\')" title="An privaten Bot-Chat senden">💬 Privat</button>' +
            '<button type="button" class="delivery-pill-btn ' + (mode === 'group' ? 'active' : '') + '" onclick="switchModalDeliveryModeClient(\\'group\\')" title="In eigene Telegram-Gruppe senden">👥 Gruppe</button>' +
            '<button type="button" class="delivery-pill-btn ' + (mode === 'custom_bot' ? 'active' : '') + '" onclick="switchModalDeliveryModeClient(\\'custom_bot\\')" title="Über eigenen Bot senden">🤖 Bot</button>' +
            '<button type="button" class="delivery-pill-btn ' + (showConfigInputs ? 'active' : '') + '" onclick="toggleModalDeliveryConfigBoxClient()" title="Gruppen-ID, Quellgruppe & eigenen Bot konfigurieren">⚙️</button>' +
          '</div>' +
          (showConfigInputs ? (
            '<div class="delivery-config-drawer">' +
              '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px">' +
                '<div>' +
                  '<div style="font-size:10.5px;color:#94a3b8;margin-bottom:3px">👥 Ziel-Gruppen Chat-ID (<code>/id</code>):</div>' +
                  '<input id="modalDelivGroupIdInp" value="' + esc(prefs.targetGroupChatId || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="z.B. -1001987654321" style="width:100%;padding:5px 8px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px" />' +
                '</div>' +
                '<div>' +
                  '<div style="font-size:10.5px;color:#94a3b8;margin-bottom:3px">🧵 Topic / Thread-ID (optional):</div>' +
                  '<input id="modalDelivTopicIdInp" value="' + esc(prefs.targetTopicId || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="Optional (z.B. 42)" style="width:100%;padding:5px 8px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px" />' +
                '</div>' +
                '<div>' +
                  '<div style="font-size:10.5px;color:#94a3b8;margin-bottom:3px">📦 Quellgruppen-ID (Auto-Copy):</div>' +
                  '<input id="modalDelivSourceGroupInp" value="' + esc(prefs.sourceBridgeChatId || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="Auto (-100...) oder überschreiben" style="width:100%;padding:5px 8px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px" />' +
                '</div>' +
                '<div>' +
                  '<div style="font-size:10.5px;color:#94a3b8;margin-bottom:3px">🤖 Eigenes Bot-Token (optional):</div>' +
                  '<input id="modalDelivBotTokenInp" type="password" value="' + esc(prefs.customBotToken || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="123456:ABC-DEF..." style="width:100%;padding:5px 8px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px" />' +
                '</div>' +
              '</div>' +
            '</div>'
          ) : '') +
        '</div>';
      }

      function switchModalDeliveryModeClient(nextMode) {
        const prefs = saveDeliveryPreferencesClient({ targetMode: nextMode || "dm" });
        if ((nextMode === "group" && !prefs.targetGroupChatId) || (nextMode === "custom_bot" && !prefs.customBotToken)) {
          modalDeliveryConfigExpanded = true;
        }
        const mount = document.getElementById("modalDeliveryTargetMount");
        if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
      }

      function toggleModalDeliveryConfigBoxClient() {
        modalDeliveryConfigExpanded = !modalDeliveryConfigExpanded;
        const mount = document.getElementById("modalDeliveryTargetMount");
        if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
      }

      function onModalDeliveryFieldInputClient() {
        const gVal = document.getElementById("modalDelivGroupIdInp")?.value.trim() || "";
        const tVal = document.getElementById("modalDelivTopicIdInp")?.value.trim() || "";
        const sVal = document.getElementById("modalDelivSourceGroupInp")?.value.trim() || "";
        const bVal = document.getElementById("modalDelivBotTokenInp")?.value.trim() || "";
        saveDeliveryPreferencesClient({
          targetGroupChatId: gVal,
          targetTopicId: tVal,
          sourceBridgeChatId: sVal,
          customBotToken: bVal
        }, true);
      }

      async function verifyAndConnectCustomBotInSettingsClient() {
        const tokenInp = document.getElementById("settingsCustomBotTokenInp");
        const groupInp = document.getElementById("settingsTargetGroupIdInp");
        const topicInp = document.getElementById("settingsTargetTopicIdInp");
        const sourceInp = document.getElementById("settingsSourceBridgeIdInp");
        const statusEl = document.getElementById("customBotVerifyStatus");
        const token = tokenInp ? tokenInp.value.trim() : "";
        saveDeliveryPreferencesClient({
          targetGroupChatId: groupInp ? groupInp.value.trim() : "",
          targetTopicId: topicInp ? topicInp.value.trim() : "",
          sourceBridgeChatId: sourceInp ? sourceInp.value.trim() : "",
          customBotToken: token
        }, true);
        if (!token) {
          if (statusEl) statusEl.textContent = "✅ Gruppen- & Versand-Einstellungen gespeichert!";
          showHudToast("✅ Versand-Einstellungen gespeichert");
          return;
        }
        if (statusEl) statusEl.textContent = "⏳ Prüfe eigenes Bot-Token & aktiviere Webhook...";
        try {
          const r = await apiFetchJson(API_BASE + "/custom-bot/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              botToken: token,
              registerWebhook: true
            })
          });
          if (r && r.ok) {
            saveDeliveryPreferencesClient({
              customBotToken: token,
              customBotUsername: r.botUsername || ""
            }, true);
            if (statusEl) {
              statusEl.innerHTML = "✅ Verbunden mit <b>@" + esc(r.botUsername || r.firstName) + "</b>! Webhook aktiv: <code>" + esc(r.webhookUrl || "") + "</code>";
            }
            showHudToast("🤖 Eigener Bot @" + (r.botUsername || "Bot") + " verbunden!");
            if (typeof loadTmaActivityLogPreviewClient === "function") loadTmaActivityLogPreviewClient();
          } else {
            if (statusEl) statusEl.textContent = "⚠️ " + (r?.error || "Bot-Token konnte nicht verifiziert werden.");
          }
        } catch (e) {
          if (statusEl) statusEl.textContent = "⚠️ Fehler bei der Bot-Verifizierung.";
        }
      }

      async function setTmaRetentionPolicyClient(days) {
        const cleanDays = (Number(days) === 7 || Number(days) === 90) ? Number(days) : 30;
        saveDeliveryPreferencesClient({ retentionDays: cleanDays }, true);
        try {
          const r = await apiFetchJson(API_BASE + "/activity-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, action: "set_retention", retentionDays: cleanDays })
          });
          const prunedInfo = (r && typeof r.prunedCount === "number" && r.prunedCount > 0)
            ? (" (" + r.prunedCount + " abgelaufene Logs bereinigt)")
            : "";
          showHudToast("🧹 KV Retention Policy: " + cleanDays + " Tage aktiv" + prunedInfo);
        } catch (e) {
          showHudToast("🧹 Retention Policy: " + cleanDays + " Tage gespeichert");
        }
        loadSettingsView();
      }

      async function clearTmaActivityLogClient() {
        try {
          await apiFetchJson(API_BASE + "/activity-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, action: "clear_log" })
          });
          showHudToast("🗑️ Telegram Delivery-Logs in KV geleert");
        } catch (e) {}
        loadTmaActivityLogPreviewClient();
      }

      async function loadTmaActivityLogPreviewClient() {
        const mount = document.getElementById("tmaActivityLogMount");
        if (!mount) return;
        try {
          const r = await apiFetchJson(API_BASE + "/activity-log?chatId=" + encodeURIComponent(chatId));
          if (!r || !r.ok) {
            mount.innerHTML = '<div style="font-size:11px;color:#94a3b8">Keine KV-Aktivitätsdaten verfügbar.</div>';
            return;
          }
          const entries = Array.isArray(r.entries) ? r.entries : [];
          if (!entries.length) {
            mount.innerHTML = '<div style="font-size:11px;color:#64748b;padding:6px 0">Noch keine Telegram-Zustellungen im aktuellen Aufbewahrungszeitraum (' + (r.retentionDays || 30) + ' Tage).</div>';
            return;
          }
          mount.innerHTML = '<div style="display:flex;flex-direction:column;gap:5px;max-height:170px;overflow-y:auto;padding-right:2px">' +
            entries.slice(0, 8).map(function(item) {
              const okBadge = item.status === "success"
                ? '<span style="color:#34d399;font-weight:800">OK</span>'
                : '<span style="color:#fb7185;font-weight:800">ERR</span>';
              const tStr = item.timestamp ? new Date(item.timestamp).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
              return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;background:rgba(15,23,42,0.75);border:1px solid rgba(255,255,255,0.07);font-size:11px">' +
                '<div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                  okBadge + ' <b style="color:#f8fafc">' + esc(item.title || "Telegram Event") + '</b> ' +
                  '<span style="color:#38bdf8">[' + esc(item.method || "API") + ']</span> ' +
                  '<span style="color:#94a3b8">' + esc(item.summary || "") + '</span>' +
                '</div>' +
                '<span style="color:#64748b;font-size:10px;white-space:nowrap">' + esc(tStr) + '</span>' +
              '</div>';
            }).join("") +
          '</div>';
        } catch (e) {
          mount.innerHTML = '<div style="font-size:11px;color:#64748b">Aktivitätsprotokoll bereit.</div>';
        }
      }

      // =========================================================================
      // TELEGRAM ANTI-SPAM ENGINE & AUTOMATISIERTE WARTESCHLEIFE (LIVE-HUD + GRAFIK-COCKPIT)
      // =========================================================================
      let clientAntiSpamSnapshot = null;
      let clientAntiSpamPollTimer = null;

      function scheduleAntiSpamPollClient(intervalMs = 1100) {
        if (clientAntiSpamPollTimer) clearTimeout(clientAntiSpamPollTimer);
        clientAntiSpamPollTimer = setTimeout(() => {
          pollAntiSpamQueueClient(true);
        }, intervalMs);
      }

      async function pollAntiSpamQueueClient(autoDrain = true) {
        try {
          const prefs = getDeliveryPreferencesClient();
          const targetChat = prefs.targetMode === "group" && prefs.targetGroupChatId ? prefs.targetGroupChatId : chatId;
          const r = await apiFetchJson(
            API_BASE + "/anti-spam-queue?chatId=" + encodeURIComponent(targetChat || "") + "&drain=" + (autoDrain ? "1" : "0")
          );
          if (r && r.ok && r.snapshot) {
            const prevCount = clientAntiSpamSnapshot ? Number(clientAntiSpamSnapshot.queueCount || 0) : 0;
            clientAntiSpamSnapshot = r.snapshot;
            renderAntiSpamLiveHudBannerClient(r.snapshot);
            renderAntiSpamCockpitDomClient(r.snapshot);
            if (r.drainedCount > 0) {
              showHudToast("✅ Anti-Spam Warteschleife: " + r.drainedCount + " Sendung(en) automatisch zugestellt!");
              if (typeof loadTmaActivityLogPreviewClient === "function" && state.currentView === "settings") {
                loadTmaActivityLogPreviewClient();
              }
            } else if (prevCount > 0 && Number(r.snapshot.queueCount || 0) === 0) {
              showHudToast("✅ Anti-Spam Warteschleife vollständig abgearbeitet!");
            }
            const hasActiveWork = Number(r.snapshot.queueCount || 0) > 0 ||
              (r.snapshot.gauges && (
                r.snapshot.gauges.floodWait429?.active ||
                Number(r.snapshot.gauges.singleChatPacing?.cooldownMs || 0) > 0 ||
                Number(r.snapshot.gauges.globalPerSec?.used || 0) > 0
              ));
            if (hasActiveWork) {
              scheduleAntiSpamPollClient(1050);
            } else if (state.currentView === "settings" || state.currentView === "admin") {
              scheduleAntiSpamPollClient(3500);
            }
          }
        } catch (e) {}
      }

      function renderAntiSpamLiveHudBannerClient(snap) {
        const hud = document.getElementById("antiSpamHudMount");
        if (!hud) return;
        if (!snap) {
          hud.style.display = "none";
          return;
        }
        const qCount = Number(snap.queueCount || 0);
        const flood429 = snap.gauges?.floodWait429 || {};
        const chatPacingMs = Number(snap.gauges?.singleChatPacing?.cooldownMs || 0);
        if (qCount === 0 && !flood429.active && chatPacingMs <= 0) {
          hud.style.display = "none";
          hud.innerHTML = "";
          return;
        }

        const firstJob = (snap.queue && snap.queue[0]) ? snap.queue[0] : null;
        const etaSec = flood429.active
          ? flood429.remainingSec
          : (firstJob ? firstJob.etaSec : Math.ceil(chatPacingMs / 1000));
        const borderColor = flood429.active
          ? "rgba(244,63,94,0.75)"
          : qCount > 0
            ? "rgba(245,158,11,0.75)"
            : "rgba(16,185,129,0.65)";
        const accentColor = flood429.active ? "#fb7185" : qCount > 0 ? "#fbbf24" : "#34d399";
        const statusTitle = flood429.active
          ? ("🚨 Telegram 429 Flood-Wait aktiv (" + flood429.remainingSec + "s Cooldown)")
          : qCount > 0
            ? ("⏳ Automatisierte Anti-Spam Warteschleife (" + qCount + (qCount === 1 ? " Job" : " Jobs") + " eingereiht)")
            : "🛡️ Anti-Spam Pacing-Fenster aktiv (1.15s Schutz)";

        const progressPct = flood429.active
          ? Math.min(100, Math.max(10, Math.round((flood429.remainingSec / Math.max(1, flood429.lastRetryAfterSec || 5)) * 100)))
          : qCount > 0
            ? Math.min(100, Math.max(12, 100 - Math.min(90, etaSec * 12)))
            : Math.min(100, Math.max(15, Number(snap.gauges?.singleChatPacing?.pct || 35)));

        hud.style.display = "block";
        hud.innerHTML =
          '<div style="pointer-events:auto;background:rgba(15,23,42,0.95);backdrop-filter:blur(12px);border:1px solid ' + borderColor + ';border-radius:12px;padding:10px 12px;box-shadow:0 12px 32px rgba(0,0,0,0.65);font-variant-numeric:tabular-nums">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">' +
              '<div style="font-size:12px;font-weight:800;color:' + accentColor + ';display:flex;align-items:center;gap:6px">' +
                '<span>' + statusTitle + '</span>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:6px">' +
                '<span style="font-size:11px;font-weight:800;color:#f8fafc;background:rgba(255,255,255,0.1);padding:2px 7px;border-radius:6px">ETA ' + etaSec + 's</span>' +
                (qCount > 0 ? '<button type="button" class="btn green" style="padding:2px 7px;font-size:10.5px" onclick="triggerAntiSpamQueueDrainClient(true)" title="Fällige Jobs sofort zustellen">▶️ Drain</button>' : '') +
              '</div>' +
            '</div>' +
            '<div style="height:5px;border-radius:999px;background:rgba(255,255,255,0.1);overflow:hidden;margin-bottom:6px">' +
              '<div style="height:100%;width:' + progressPct + '%;background:' + accentColor + ';transition:width 0.3s ease"></div>' +
            '</div>' +
            (firstJob ? (
              '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#cbd5e1;gap:8px">' +
                '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🎬 Pos. #1: <b style="color:#fff">' + esc(firstJob.title) + '</b> (' + esc(firstJob.quality) + ') ➔ <code>' + esc(firstJob.chatId) + '</code></span>' +
                '<span style="color:#94a3b8;font-size:10.5px;white-space:nowrap">' + esc(firstJob.reason) + '</span>' +
              '</div>'
            ) : (
              '<div style="font-size:10.5px;color:#94a3b8">Global: ' + (snap.gauges?.globalPerSec?.used || 0) + '/25 Sek. • Gruppe: ' + (snap.gauges?.groupPerMin?.used || 0) + '/18 Min. • Abgearbeitet: ' + (snap.stats?.totalDrained || 0) + '</div>'
            )) +
          '</div>';
      }

      function buildAntiSpamCockpitBoxHtmlClient() {
        return '<div class="panel-box" style="border-color:rgba(245,158,11,0.5);background:linear-gradient(180deg,rgba(245,158,11,0.07),rgba(15,23,42,0.5))">' +
          '<div class="section-title" style="margin-bottom:6px">' +
            '<span>🛡️ Telegram Anti-Spam Engine & Automatisierte Warteschleife (Live-Cockpit)</span>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button type="button" class="btn green" style="padding:4px 9px;font-size:11px" onclick="triggerAntiSpamQueueDrainClient(true)">▶️ Queue jetzt abarbeiten</button>' +
              '<button type="button" class="btn amber" style="padding:4px 9px;font-size:11px" onclick="simulateAntiSpamBurstClient(5)">⚡ Burst-Test (5 Sendungen)</button>' +
              '<button type="button" class="btn" style="padding:4px 9px;font-size:11px;color:#fb7185" onclick="clearAntiSpamQueueClient()">🗑️ Queue leeren</button>' +
            '</div>' +
          '</div>' +
          '<p style="font-size:11.5px;color:#94a3b8;margin-bottom:10px">' +
            'Erzwingt strikt die offiziellen Telegram-Grenzwerte mit Sicherheitspuffer (<b>max. 1 Msg / 1,15s pro Chat</b> • <b>max. 18 Msg / 60s pro Gruppe</b> • <b>max. 25 Msg / Sek. global</b> + <b>HTTP 429 retry_after Automatik</b>). Bei Überschreitung greift nahtlos die D1/KV-Warteschleife.' +
          '</p>' +
          '<div id="tmaAntiSpamCockpitMount"><div style="font-size:11.5px;color:#94a3b8">Lade Echtzeit-Telemetrie & Warteschleife...</div></div>' +
        '</div>';
      }

      function renderAntiSpamCockpitDomClient(snap) {
        const mount = document.getElementById("tmaAntiSpamCockpitMount");
        if (!mount || !snap) return;
        const gGlobal = snap.gauges?.globalPerSec || { used: 0, max: 25, pct: 0 };
        const gGroup = snap.gauges?.groupPerMin || { used: 0, max: 18, pct: 0, chatId: "Alle Gruppen" };
        const gChat = snap.gauges?.singleChatPacing || { cooldownMs: 0, intervalMs: 1150, pct: 0, chatId: "Bereit" };
        const g429 = snap.gauges?.floodWait429 || { active: false, remainingSec: 0, total429Hits: 0 };
        const qList = Array.isArray(snap.queue) ? snap.queue : [];
        const recentList = Array.isArray(snap.recentProcessed) ? snap.recentProcessed : [];

        const gaugeColor = (pct) => pct >= 85 ? "#fb7185" : pct >= 50 ? "#fbbf24" : "#34d399";

        mount.innerHTML =
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:12px;font-variant-numeric:tabular-nums">' +
            // Gauge 1: Global / Sek
            '<div style="padding:10px;border-radius:10px;background:rgba(15,23,42,0.85);border:1px solid rgba(255,255,255,0.1)">' +
              '<div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:800;margin-bottom:5px">' +
                '<span style="color:#cbd5e1">🌐 Global / Sekunde</span>' +
                '<span style="color:' + gaugeColor(gGlobal.pct) + '">' + gGlobal.used + ' / ' + gGlobal.max + ' Msg/s (' + gGlobal.pct + '%)</span>' +
              '</div>' +
              '<div style="height:7px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden">' +
                '<div style="height:100%;width:' + Math.max(4, gGlobal.pct) + '%;background:' + gaugeColor(gGlobal.pct) + ';transition:width 0.3s ease"></div>' +
              '</div>' +
              '<div style="font-size:10.5px;color:#64748b;margin-top:5px">Telegram Hard-Limit: 30/Sek. (Puffer: 25/Sek.)</div>' +
            '</div>' +
            // Gauge 2: Gruppe / Min
            '<div style="padding:10px;border-radius:10px;background:rgba(15,23,42,0.85);border:1px solid rgba(255,255,255,0.1)">' +
              '<div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:800;margin-bottom:5px">' +
                '<span style="color:#cbd5e1">👥 Gruppe / Minute</span>' +
                '<span style="color:' + gaugeColor(gGroup.pct) + '">' + gGroup.used + ' / ' + gGroup.max + ' Msg/m (' + gGroup.pct + '%)</span>' +
              '</div>' +
              '<div style="height:7px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden">' +
                '<div style="height:100%;width:' + Math.max(4, gGroup.pct) + '%;background:' + gaugeColor(gGroup.pct) + ';transition:width 0.3s ease"></div>' +
              '</div>' +
              '<div style="font-size:10.5px;color:#64748b;margin-top:5px">Telegram Hard-Limit: 20/Min. • Ziel: <code>' + esc(gGroup.chatId) + '</code></div>' +
            '</div>' +
            // Gauge 3: Single-Chat Pacing & 429 Status
            '<div style="padding:10px;border-radius:10px;background:rgba(15,23,42,0.85);border:1px solid ' + (g429.active ? 'rgba(244,63,94,0.6)' : 'rgba(255,255,255,0.1)') + '">' +
              '<div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:800;margin-bottom:5px">' +
                '<span style="color:#cbd5e1">⏱️ Single-Chat & 429 Schutz</span>' +
                '<span style="color:' + (g429.active ? '#fb7185' : gaugeColor(gChat.pct)) + '">' +
                  (g429.active ? ('429 WAIT: ' + g429.remainingSec + 's') : (gChat.cooldownMs > 0 ? (gChat.cooldownMs + ' ms') : 'FREI (0 ms)')) +
                '</span>' +
              '</div>' +
              '<div style="height:7px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden">' +
                '<div style="height:100%;width:' + (g429.active ? 100 : Math.max(4, gChat.pct)) + '%;background:' + (g429.active ? '#fb7185' : gaugeColor(gChat.pct)) + ';transition:width 0.3s ease"></div>' +
              '</div>' +
              '<div style="font-size:10.5px;color:#64748b;margin-top:5px">Intervall: 1.150ms • Sofort: ' + (snap.stats?.totalSentImmediate || 0) + ' • Gequeued: ' + (snap.stats?.totalQueued || 0) + ' • Drained: ' + (snap.stats?.totalDrained || 0) + '</div>' +
            '</div>' +
          '</div>' +

          // Warteschleifen-Pipeline
          '<div style="padding:10px;border-radius:10px;background:rgba(15,23,42,0.65);border:1px solid rgba(255,255,255,0.08);font-variant-numeric:tabular-nums">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
              '<span style="font-size:12px;font-weight:800;color:#f8fafc">⏳ Aktive Warteschleife (' + qList.length + ' ausstehend)</span>' +
              '<span style="font-size:11px;color:#38bdf8">Auto-Drain via Worker <code>waitUntil</code> + D1/KV Persistenz</span>' +
            '</div>' +
            (qList.length === 0 ? (
              '<div style="font-size:11.5px;color:#34d399;padding:6px 0">✅ Keine Rückstände – alle Telegram-Sendungen wurden innerhalb der Anti-Spam-Limits zugestellt.</div>'
            ) : (
              '<div style="display:flex;flex-direction:column;gap:6px;max-height:210px;overflow-y:auto">' +
                qList.map(item => (
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 9px;border-radius:8px;background:rgba(30,41,59,0.85);border:1px solid rgba(251,191,36,0.35);font-size:11.5px">' +
                    '<div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                      '<span style="color:#fbbf24;font-weight:800">#' + item.position + '</span> ' +
                      '<b style="color:#fff">' + esc(item.title) + '</b> ' +
                      '<span style="color:#38bdf8">[' + esc(item.quality) + ']</span> ' +
                      '<span style="color:#94a3b8">➔ <code>' + esc(item.chatId) + '</code> • ' + esc(item.reason) + '</span>' +
                    '</div>' +
                    '<span style="font-size:11px;font-weight:800;color:#fbbf24;white-space:nowrap">in ' + item.etaSec + 's</span>' +
                  '</div>'
                )).join("") +
              '</div>'
            )) +
            (recentList.length > 0 ? (
              '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.07)">' +
                '<div style="font-size:11px;font-weight:800;color:#94a3b8;margin-bottom:5px">✅ Zuletzt automatisch aus der Warteschleife zugestellt:</div>' +
                '<div style="display:flex;flex-direction:column;gap:4px">' +
                  recentList.slice(0, 4).map(r => (
                    '<div style="display:flex;justify-content:space-between;font-size:10.5px;color:#cbd5e1;padding:3px 6px;background:rgba(16,185,129,0.08);border-radius:5px">' +
                      '<span>✅ <b>' + esc(r.title) + '</b> (' + esc(r.quality || "1080p") + ') ➔ <code>' + esc(r.chatId) + '</code></span>' +
                      '<span style="color:#34d399">nach ' + ((Number(r.waitedMs || 0) / 1000).toFixed(1)) + 's Pacing zugestellt</span>' +
                    '</div>'
                  )).join("") +
                '</div>' +
              '</div>'
            ) : '') +
          '</div>';
      }

      async function triggerAntiSpamQueueDrainClient(forceImmediate = false) {
        try {
          const r = await apiFetchJson(API_BASE + "/anti-spam-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "drain", forceImmediate: Boolean(forceImmediate) })
          });
          if (r && r.ok && r.snapshot) {
            clientAntiSpamSnapshot = r.snapshot;
            renderAntiSpamLiveHudBannerClient(r.snapshot);
            renderAntiSpamCockpitDomClient(r.snapshot);
            showHudToast("▶️ Warteschleife verarbeitet: " + (r.drainedCount || 0) + " Job(s) gesendet.");
            if (typeof loadTmaActivityLogPreviewClient === "function" && state.currentView === "settings") {
              loadTmaActivityLogPreviewClient();
            }
          }
        } catch (e) {}
      }

      async function simulateAntiSpamBurstClient(count = 5) {
        try {
          const prefs = getDeliveryPreferencesClient();
          const targetChat = (prefs.targetMode === "group" && prefs.targetGroupChatId)
            ? prefs.targetGroupChatId
            : (chatId && chatId !== "guest" ? chatId : "-1001987654321");
          const r = await apiFetchJson(API_BASE + "/anti-spam-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "simulate_burst",
              count: Number(count) || 5,
              chatId: targetChat,
              targetMode: prefs.targetMode || "dm"
            })
          });
          if (r && r.ok && r.snapshot) {
            clientAntiSpamSnapshot = r.snapshot;
            renderAntiSpamLiveHudBannerClient(r.snapshot);
            renderAntiSpamCockpitDomClient(r.snapshot);
            showHudToast("⚡ Burst-Test: 1 sofort gesendet, " + (r.queuedCount || 0) + " in Anti-Spam Warteschleife eingereiht!");
            scheduleAntiSpamPollClient(950);
          }
        } catch (e) {}
      }

      async function clearAntiSpamQueueClient() {
        try {
          const r = await apiFetchJson(API_BASE + "/anti-spam-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "clear" })
          });
          if (r && r.ok && r.snapshot) {
            clientAntiSpamSnapshot = r.snapshot;
            renderAntiSpamLiveHudBannerClient(r.snapshot);
            renderAntiSpamCockpitDomClient(r.snapshot);
            showHudToast("🗑️ Anti-Spam Warteschleife geleert.");
          }
        } catch (e) {}
      }

      async function requestTelegramSubtitleOnly(fileId, cleanTitle, extraMeta = null) {
        return requestTelegramStream(fileId, cleanTitle, "Untertitel", { ...(extraMeta || {}), subtitleOnly: true });
      }

      async function requestTelegramStream(fileId, cleanTitle, quality, extraMeta = null) {
        if (!isCurrentUserVip()) {
          showHudToast("🔒 Streams & Qualitäten sind exklusiv für VIP-Mitglieder verfügbar.");
          return;
        }
        const prefs = getDeliveryPreferencesClient();
        if (prefs.targetMode === "group" && !prefs.targetGroupChatId) {
          modalDeliveryConfigExpanded = true;
          const mount = document.getElementById("modalDeliveryTargetMount");
          if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
          showHudToast("👥 Bitte gib oben deine Ziel-Gruppen Chat-ID ein (Tipp: /id in deiner Gruppe senden).");
          return;
        }
        const metaObj = extraMeta && typeof extraMeta === "object" ? extraMeta : {};
        const isSubtitleOnly = Boolean(metaObj.subtitleOnly);
        if (!isSubtitleOnly && metaObj.seriesId && metaObj.season && metaObj.episode) {
          setSeriesProgress(metaObj.seriesId, metaObj.season, metaObj.episode, metaObj.epName || "");
        }
        const sizeSuffix = metaObj.fileSize ? (" • " + metaObj.fileSize) : "";
        const destLabel = prefs.targetMode === "group"
          ? ("Gruppe " + prefs.targetGroupChatId)
          : prefs.targetMode === "custom_bot"
            ? ("eigenen Bot" + (prefs.customBotUsername ? " @" + prefs.customBotUsername : ""))
            : "deinen Telegram-Chat";
        setBusyState(true, (isSubtitleOnly ? "💬 Sende Untertitel für " : "📥 Sende ") + cleanTitle + (isSubtitleOnly ? "" : (" (" + quality + sizeSuffix + ")")) + " an " + destLabel + "...");
        try {
          const r = await apiFetchJson(API_BASE + "/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              fileId,
              title: cleanTitle,
              quality,
              fileSize: metaObj.fileSize || "",
              tags: metaObj.tags || "",
              subtitleOnly: isSubtitleOnly,
              targetMode: prefs.targetMode || "dm",
              targetGroupChatId: prefs.targetGroupChatId || "",
              targetTopicId: prefs.targetTopicId || "",
              sourceBridgeChatId: prefs.sourceBridgeChatId || "",
              customBotToken: prefs.customBotToken || "",
              typeCode: state.activeDetails?.typeCode || (metaObj.seriesId ? "s" : "m"),
              tmdbId: metaObj.seriesId || state.activeDetails?.id || null,
              season: metaObj.season || null,
              episode: metaObj.episode || null
            })
          });
          if (r && r.antiSpam) {
            clientAntiSpamSnapshot = r.antiSpam;
            renderAntiSpamLiveHudBannerClient(r.antiSpam);
            renderAntiSpamCockpitDomClient(r.antiSpam);
            scheduleAntiSpamPollClient(1000);
          }
          if (r && r.ok) {
            if (r.queued && r.job) {
              const etaSec = Math.max(1, Math.ceil((Number(r.job.waitMs) || 1150) / 1000));
              showHudToast("⏳ Anti-Spam Schutz: „" + cleanTitle + "“ auf Warteschleifen-Pos. #" + (r.job.position || 1) + " (Zustellung in ~" + etaSec + "s)");
            } else if (isSubtitleOnly) {
              showHudToast("💬 " + Number(r.subtitlesSentCount || 1) + " Untertitel-Datei(en) für „" + cleanTitle + "“ an " + destLabel + " gesendet!");
            } else {
              const copyNote = r.copiedFromSourceGroup ? " (per Auto-Copy aus Quellgruppe)" : "";
              const subNote = Number(r.subtitlesSentCount || 0) > 0 ? (" + 💬 " + r.subtitlesSentCount + " Untertitel mitgesendet") : "";
              showHudToast("✅ „" + cleanTitle + "“ (" + quality + sizeSuffix + ") an " + destLabel + " gesendet" + copyNote + subNote + "!");
            }
            if (!isSubtitleOnly && metaObj.seriesId && metaObj.season) {
              loadSeason(metaObj.seriesId, metaObj.season, false, false);
            }
          } else {
            showHudToast("⚠️ " + (r?.error || "Datei konnte nicht gesendet werden."));
          }
        } finally {
          setBusyState(false);
        }
      }

      function normalizeClientPartLabel(rawPart, rawFilename = "") {
        const pStr = String(rawPart || "").trim();
        if (!pStr && !rawFilename) return "";
        if (/^RAR/i.test(pStr)) return pStr.toUpperCase();
        const m = pStr.match(/^(?:SPLIT|PART|TEIL|CD|DISC|DISK|DVD)[\s._-]*0*([1-9]\d?)$/i);
        if (m) return "CD " + parseInt(m[1], 10);
        if (!pStr && rawFilename) {
          const fnSplit = String(rawFilename).match(/-00([1-9])(?:\.(?:mp4|mkv|avi|m4v|mk3d|flv|ts|mov|wmv))+$/i);
          if (fnSplit) return "CD " + parseInt(fnSplit[1], 10);
        }
        return pStr;
      }

      function extractClientPartNumber(partStr) {
        if (!partStr) return 0;
        const m = String(partStr).match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      }

      function cleanUserVisibleStreamTagsClient(rawTags = "") {
        if (!rawTags) return "";
        return String(rawTags)
          .split(/\s*[·•|]\s*/)
          .map(t => t.trim())
          .filter(t => t && !/^(?:SPLIT|PART|TEIL|CD|DISC|DISK|DVD)[\s._-]*0*\d+$/i.test(t) && !/^Originalfassung$/i.test(t))
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(" · ");
      }

      function buildMovieStreamsReleaseSectionHtml(d, isAdminUser, canReportMedia) {
        const rawFiles = Array.isArray(d.files) ? d.files.filter(f => f && f.telegram_file_id) : [];
        const normalizedFiles = rawFiles.map(f => {
          const isRarFile = String(f.codec || "").toUpperCase() === "RAR" || /^RAR/i.test(String(f.part || "")) || /\.rar$/i.test(String(f.raw_filename || ""));
          const normPart = normalizeClientPartLabel(f.part, f.raw_filename || "");
          const partNum = extractClientPartNumber(normPart);
          const cleanTags = isRarFile ? "📦 RAR-Archiv" : cleanUserVisibleStreamTagsClient(f.tags || f.versionLabel || f.version_label || "");
          return {
            ...f,
            _isRar: isRarFile,
            _normPart: normPart,
            _partNum: partNum,
            _cleanTags: cleanTags
          };
        });

        // Gruppiere mehrteilige Dateien desselben Releases (Qualität + Codec) in eine gemeinsame Release-Box
        const releaseBuckets = new Map();
        const orderedBlocks = [];

        for (const f of normalizedFiles) {
          if (f._normPart && f._partNum > 0) {
            const gKey = (f._isRar ? "RAR" : String(f.quality || "1080p").toUpperCase()) + "|" + String(f.codec || "x264").toUpperCase();
            if (!releaseBuckets.has(gKey)) {
              const bucket = { type: "multipart", key: gKey, files: [] };
              releaseBuckets.set(gKey, bucket);
              orderedBlocks.push(bucket);
            }
            releaseBuckets.get(gKey).files.push(f);
          } else {
            orderedBlocks.push({ type: "single", file: f });
          }
        }

        // Falls ein "multipart"-Bucket nur 1 einzige Datei hat, als normale Einzel-Zeile behandeln
        const finalBlocks = [];
        for (const blk of orderedBlocks) {
          if (blk.type === "multipart") {
            blk.files.sort((a, b) => (a._partNum - b._partNum) || String(a._normPart).localeCompare(String(b._normPart), "de", { numeric: true }));
            if (blk.files.length === 1) {
              finalBlocks.push({ type: "single", file: blk.files[0] });
            } else {
              finalBlocks.push(blk);
            }
          } else {
            finalBlocks.push(blk);
          }
        }

        const totalReleaseCount = finalBlocks.length;

        return '<div>' +
          '<div class="season-toolbar-row">' +
            '<div style="font-size:12.5px;font-weight:800;color:var(--text)">🎬 Verfügbare Releases (' + totalReleaseCount + (rawFiles.length > totalReleaseCount ? ' · ' + rawFiles.length + ' Dateien' : '') + ')</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
              buildModalDeliveryTargetSelectorHtml() +
            '</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px">' +
            finalBlocks.map(blk => {
              if (blk.type === "multipart") {
                const parts = blk.files;
                const first = parts[0];
                const isRar = first._isRar;
                const qual = isRar ? "RAR" : (first.quality || "1080p");
                const codec = first.codec || "x264";
                const tagsLabel = first._cleanTags || "DE";
                const totalBytes = parts.reduce((acc, item) => acc + (Number(item.file_size) || 0), 0);
                const totalSizeStr = formatFileSizeClient(totalBytes);
                const partWord = isRar ? "RAR-Teile" : "CDs";
                return '<div class="release-box-card">' +
                  '<div class="release-box-header">' +
                    '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
                      '<span class="ep-code-badge">' + esc(qual) + '</span>' +
                      '<span class="ep-name-text">' + esc(codec) + '</span>' +
                      (tagsLabel ? '<span class="stream-meta-pill tags">' + esc(tagsLabel) + '</span>' : '') +
                      '<span class="stream-meta-pill size">' + parts.length + ' ' + partWord + (totalSizeStr ? (' · Gesamt ' + esc(totalSizeStr)) : '') + '</span>' +
                    '</div>' +
                    '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
                      '<button type="button" class="btn-action-glass" style="padding:4px 10px;font-size:11.5px;border-color:rgba(245,158,11,0.45);color:#fde68a" onclick="sendAllMoviePartsToTelegram(\\'' + esc(blk.key) + '\\')" title="Alle ' + parts.length + ' ' + partWord + ' geordnet von 1 bis ' + parts.length + ' an dein gewähltes Ziel senden">' +
                        '📦 Alle ' + parts.length + ' ' + partWord + ' senden' +
                      '</button>' +
                      (canReportMedia ? '<button type="button" class="ep-ghost-btn" onclick="openMediaReportModal({typeCode:\\'m\\',tmdbId:' + Number(d.id) + ',title:\\'' + esc(d.title) + '\\',telegramFileId:\\'' + esc(first.telegram_file_id) + '\\',versionLabel:\\'' + esc(tagsLabel || 'Originalfassung') + '\\'})" title="Fehler zu diesem Mehrteiler-Release melden">⚠️</button>' : '') +
                    '</div>' +
                  '</div>' +
                  '<div class="release-cd-grid">' +
                    parts.map(p => {
                      const pSize = formatFileSizeClient(p.file_size);
                      const pLabel = p._normPart || ("CD " + p._partNum);
                      const pSubs = Array.isArray(p.subtitles) ? p.subtitles : [];
                      return '<div class="cd-part-chip-wrap">' +
                        '<button type="button" class="btn-cd-part" onclick="requestTelegramStream(\\'' + esc(p.telegram_file_id) + '\\',\\'' + esc(d.title + ' (' + pLabel + ')') + '\\',\\'' + esc(p.quality || '1080p') + '\\',{fileSize:\\'' + esc(pSize) + '\\',tags:\\'' + esc(tagsLabel) + '\\'})" title="' + esc(d.title + ' – ' + pLabel + (pSize ? ' (' + pSize + ')' : '')) + ' senden">' +
                          '<span>▶ ' + esc(pLabel) + '</span>' +
                          (pSize ? '<span class="cd-size-sub">· ' + esc(pSize) + '</span>' : '') +
                          (pSubs.length > 0 ? '<span class="cd-size-sub">+ UT</span>' : '') +
                        '</button>' +
                        (isAdminUser ? '<button type="button" class="ep-ghost-btn" style="width:24px;height:24px;font-size:11px" onclick="openEpisodeCorrectionModal({typeCode:\\'m\\',tmdbId:' + Number(d.id) + ',title:\\'' + esc(d.title + ' (' + pLabel + ')') + '\\',telegramFileId:\\'' + esc(p.telegram_file_id) + '\\',versionLabel:\\'' + esc(tagsLabel || 'Originalfassung') + '\\',quality:\\'' + esc(p.quality || '1080p') + '\\',rawFilename:\\'' + esc(p.raw_filename || '') + '\\',messageLink:\\'' + esc(p.message_link || '') + '\\'})" title="' + esc(pLabel) + ' bearbeiten / Details & Quellgruppe prüfen">✏️</button>' : '') +
                      '</div>';
                    }).join("") +
                  '</div>' +
                '</div>';
              }

              const f = blk.file;
              const sizeLabel = formatFileSizeClient(f.file_size);
              const isRarFile = f._isRar;
              const tagsLabel = f._cleanTags;
              const isPrereleaseTag = tagsLabel.includes("Vorabversion") || /\b(?:HDTS|TeleSync|HDCAM|MicDub|LineDub|Screener|DVDScr)\b/i.test(tagsLabel);
              const partLabel = f._normPart;
              const subsList = Array.isArray(f.subtitles) ? f.subtitles : [];
              return '<div class="ep-row" style="margin-bottom:0;' + (isPrereleaseTag ? 'border-color:rgba(245,158,11,0.45);background:rgba(245,158,11,0.06);' : '') + '">' +
                '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
                  '<span class="ep-code-badge">' + esc(isRarFile ? 'RAR' : (f.quality || '1080p')) + '</span>' +
                  '<span class="ep-name-text">' + esc(f.codec || 'x264') + (partLabel ? ' · ' + esc(partLabel) : '') + '</span>' +
                  (sizeLabel ? '<span class="stream-meta-pill size" title="Dateigröße">' + esc(sizeLabel) + '</span>' : '') +
                  (tagsLabel ? '<span class="stream-meta-pill tags" title="Sprache / Schnittfassung">' + esc(tagsLabel) + '</span>' : '') +
                  (subsList.length > 0 ? '<span class="stream-meta-pill" style="border-color:rgba(16,185,129,0.5);color:#34d399" title="Wird beim Video-Versand automatisch mitgesendet">💬 ' + subsList.length + ' UT</span>' : '') +
                '</div>' +
                '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                  '<button class="btn-stream-clean ' + (isRarFile || isPrereleaseTag ? 'prerelease' : '') + '" onclick="requestTelegramStream(\\'' + esc(f.telegram_file_id) + '\\',\\'' + esc(d.title + (partLabel ? ' (' + partLabel + ')' : '')) + '\\',\\'' + esc(f.quality || '1080p') + '\\',{fileSize:\\'' + esc(sizeLabel) + '\\',tags:\\'' + esc(tagsLabel) + '\\'})">' + (isRarFile ? '📦 RAR senden' : ('▶ ' + esc(getActiveDeliveryButtonLabelClient()) + (subsList.length > 0 ? ' + UT' : ''))) + '</button>' +
                  (subsList.length > 0 ? '<button type="button" class="btn-tool-quiet" style="padding:4px 8px;font-size:11px" onclick="requestTelegramSubtitleOnly(\\'' + esc(f.telegram_file_id) + '\\',\\'' + esc(d.title) + '\\',{seriesId:null})" title="Nur die verknüpfte(n) Untertitel-Datei(en) einzeln senden">💬 UT (' + subsList.length + ')</button>' : '') +
                  (isAdminUser ? '<button type="button" class="ep-ghost-btn" onclick="openEpisodeCorrectionModal({typeCode:\\'m\\',tmdbId:' + Number(d.id) + ',title:\\'' + esc(d.title) + '\\',telegramFileId:\\'' + esc(f.telegram_file_id) + '\\',versionLabel:\\'' + esc(tagsLabel || 'Originalfassung') + '\\',quality:\\'' + esc(f.quality || '1080p') + '\\',rawFilename:\\'' + esc(f.raw_filename || '') + '\\',messageLink:\\'' + esc(f.message_link || '') + '\\'})" title="Datei-Version ändern, Quellgruppe prüfen oder mit anderem TMDb-Titel verknüpfen">✏️</button>' : '') +
                  (canReportMedia ? '<button type="button" class="ep-ghost-btn" onclick="openMediaReportModal({typeCode:\\'m\\',tmdbId:' + Number(d.id) + ',title:\\'' + esc(d.title) + '\\',telegramFileId:\\'' + esc(f.telegram_file_id) + '\\',versionLabel:\\'' + esc(tagsLabel || 'Originalfassung') + '\\'})" title="Fehler zu dieser Datei melden">⚠️</button>' : '') +
                '</div>' +
              '</div>';
            }).join("") +
          '</div>' +
        '</div>';
      }

      // Mehrteilige Filme (z.B. CD 1 bis CD 5) strikt aufsteigend (1 -> 2 -> 3 -> 4 -> 5) an das gewählte Ziel senden
      async function sendAllMoviePartsToTelegram(releaseGroupKey = "") {
        if (!isCurrentUserVip()) {
          showHudToast("🔒 Exklusiv für VIP-Mitglieder verfügbar.");
          return;
        }
        const d = state.activeDetails;
        if (!d || !Array.isArray(d.files)) return;
        const prefs = getDeliveryPreferencesClient();
        const partFiles = d.files
          .filter(f => {
            if (!f || !f.telegram_file_id) return false;
            const normP = normalizeClientPartLabel(f.part, f.raw_filename || "");
            if (!normP) return false;
            if (releaseGroupKey) {
              const isRar = String(f.codec || "").toUpperCase() === "RAR" || /^RAR/i.test(normP);
              const gKey = (isRar ? "RAR" : String(f.quality || "1080p").toUpperCase()) + "|" + String(f.codec || "x264").toUpperCase();
              return gKey === releaseGroupKey;
            }
            return true;
          })
          .map(f => ({
            ...f,
            _normPart: normalizeClientPartLabel(f.part, f.raw_filename || ""),
            _partNum: extractClientPartNumber(normalizeClientPartLabel(f.part, f.raw_filename || ""))
          }))
          .sort((a, b) => (a._partNum - b._partNum) || String(a._normPart).localeCompare(String(b._normPart), "de", { numeric: true }));
        const targetList = partFiles.length >= 2 ? partFiles : d.files.filter(f => f && f.telegram_file_id);
        if (targetList.length === 0) return;

        let sentCount = 0;
        let queuedCount = 0;
        for (let i = 0; i < targetList.length; i++) {
          const f = targetList[i];
          const cleanPartStr = f._normPart || normalizeClientPartLabel(f.part, f.raw_filename || "") || ("CD " + (i + 1));
          const partLabel = " (" + cleanPartStr + ")";
          const sizeLabel = formatFileSizeClient(f.file_size);
          setBusyState(true, "📦 Sende " + cleanPartStr + " (" + (i + 1) + "/" + targetList.length + "): " + d.title + "...");
          try {
            const r = await apiFetchJson(API_BASE + "/stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chatId,
                fileId: f.telegram_file_id,
                title: d.title + partLabel,
                quality: f.quality || "1080p",
                fileSize: sizeLabel,
                tags: cleanUserVisibleStreamTagsClient(f.tags || ""),
                targetMode: prefs.targetMode || "dm",
                targetGroupChatId: prefs.targetGroupChatId || "",
                targetTopicId: prefs.targetTopicId || "",
                sourceBridgeChatId: prefs.sourceBridgeChatId || "",
                customBotToken: prefs.customBotToken || ""
              })
            });
            if (r && r.antiSpam) {
              clientAntiSpamSnapshot = r.antiSpam;
              renderAntiSpamLiveHudBannerClient(r.antiSpam);
            }
            if (r && r.ok) {
              if (r.queued) queuedCount++;
              else sentCount++;
            }
          } catch (e) {}
        }
        setBusyState(false);
        scheduleAntiSpamPollClient(950);
        if (queuedCount > 0) {
          showHudToast("⏳ " + sentCount + " sofort gesendet, " + queuedCount + " CD(s) in Anti-Spam Warteschleife eingereiht!");
        } else {
          showHudToast("✅ Alle " + sentCount + "/" + targetList.length + " CDs gesendet!");
        }
      }

      // Optimierung #14: Ganze Staffel für VIPs nacheinander an das gewählte Ziel senden
      let activeSeasonCacheEpisodes = [];
      const selectedEpisodeVersionMap = {};

      function selectEpisodeVersion(seriesId, seasonNum, epNumber, versionIdx) {
        const key = seriesId + "_" + seasonNum + "_" + epNumber;
        selectedEpisodeVersionMap[key] = Number(versionIdx) || 0;
        loadSeason(seriesId, seasonNum, false, false);
      }

      async function sendWholeSeasonToTelegram(seriesId, seasonNum) {
        if (!isCurrentUserVip()) {
          showHudToast("🔒 Exklusiv für VIP-Mitglieder verfügbar.");
          return;
        }
        const prefs = getDeliveryPreferencesClient();
        const episodesWithStreams = (activeSeasonCacheEpisodes || []).filter(ep => Array.isArray(ep.files) && ep.files.length > 0);
        if (episodesWithStreams.length === 0) {
          showHudToast("⚠️ Keine Episoden-Streams in dieser Staffel hinterlegt.");
          return;
        }
        const seriesTitle = state.activeDetails?.title || "Serie";
        let sentCount = 0;
        let queuedCount = 0;
        for (let i = 0; i < episodesWithStreams.length; i++) {
          const ep = episodesWithStreams[i];
          const vKey = seriesId + "_" + seasonNum + "_" + ep.episode_number;
          const selIdx = Number(selectedEpisodeVersionMap[vKey] || 0);
          const epVersions = Array.isArray(ep.versions) && ep.versions.length > 0 ? ep.versions : ep.files;
          const bestFile = epVersions[selIdx] || ep.files[0];
          const targetFileId = bestFile?.telegram_file_id || bestFile?.file_id;
          if (!bestFile || !targetFileId) continue;
          const epCode = "S" + String(seasonNum).padStart(2, "0") + "E" + String(ep.episode_number).padStart(2, "0");
          const sizeLabel = formatFileSizeClient(bestFile.file_size);
          setBusyState(true, "📦 Staffel " + seasonNum + " (" + (i + 1) + "/" + episodesWithStreams.length + "): " + epCode + "...");
          try {
            const r = await apiFetchJson(API_BASE + "/stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chatId,
                fileId: targetFileId,
                title: seriesTitle + " " + epCode + " - " + (ep.name || ("Folge " + ep.episode_number)),
                quality: bestFile.quality || "1080p",
                fileSize: sizeLabel,
                tags: bestFile.versionLabel || bestFile.tags || "",
                targetMode: prefs.targetMode || "dm",
                targetGroupChatId: prefs.targetGroupChatId || "",
                targetTopicId: prefs.targetTopicId || "",
                sourceBridgeChatId: prefs.sourceBridgeChatId || "",
                customBotToken: prefs.customBotToken || ""
              })
            });
            if (r && r.antiSpam) {
              clientAntiSpamSnapshot = r.antiSpam;
              renderAntiSpamLiveHudBannerClient(r.antiSpam);
            }
            if (r && r.ok) {
              if (r.queued) queuedCount++;
              else sentCount++;
              setSeriesProgress(seriesId, seasonNum, ep.episode_number, ep.name || "");
            }
          } catch (e) {}
        }
        setBusyState(false);
        scheduleAntiSpamPollClient(950);
        if (queuedCount > 0) {
          showHudToast("⏳ Staffel " + seasonNum + ": " + sentCount + " sofort, " + queuedCount + " Folge(n) in Anti-Spam Warteschleife!");
        } else {
          showHudToast("✅ Staffel " + seasonNum + ": " + sentCount + "/" + episodesWithStreams.length + " Folgen gesendet!");
        }
        loadSeason(seriesId, seasonNum, false, false);
      }

      async function loadSeason(seriesId, seasonNum, jumpToFirstEpisode = false, forceRefresh = false) {
        const vipAllowed = isCurrentUserVip();
        const cacheKey = seriesId + "_" + seasonNum + "_" + (vipAllowed ? "vip" : "std");
        const cachedEntry = !forceRefresh ? clientSeasonCache.get(cacheKey) : null;
        const hasValidCache = Boolean(cachedEntry && (Date.now() - cachedEntry.ts < CLIENT_CACHE_TTL_MS));
        const s = hasValidCache
          ? cachedEntry.data
          : await apiFetchJson(API_BASE + "/season?chatId=" + encodeURIComponent(chatId) + "&seriesId=" + seriesId + "&season=" + seasonNum);
        if (!hasValidCache && s && s.ok !== false) {
          clientSeasonCache.set(cacheKey, { data: s, ts: Date.now() });
        }
        const box = document.getElementById("seasonBox");
        if (!box) return;
        const maxAllowedEpisodes = Number(s.seasonEpisodeCount || 0);
        const rawEpisodesArray = s.episodes || [];
        // Die "Max. 1 aktive Gruppe / Keine Addition"-Regel:
        // Holt sich exakt die Folgen der aktiven Gruppe und ignoriert alles danach per hartem .slice(0, maxAllowedEpisodes)!
        const finalEpisodesList = maxAllowedEpisodes > 0
          ? rawEpisodesArray.filter(ep => Number(ep.episode_number) <= maxAllowedEpisodes).slice(0, maxAllowedEpisodes)
          : rawEpisodesArray;
        const episodes = finalEpisodesList;
        activeSeasonCacheEpisodes = episodes;
        const prog = getSeriesProgress(seriesId);
        const seasonStreamableCount = vipAllowed
          ? episodes.filter(ep => Array.isArray(ep.files) && ep.files.length > 0).length
          : 0;

        const sCounts = (s.seasonCounts && typeof s.seasonCounts === "object") ? s.seasonCounts : (state.activeDetails?.seasonCounts || {});
        const sBtns = (s.seasons || [1]).map(n => {
          const isProgSeason = prog && Number(prog.season) === Number(n);
          const rawCnt = vipAllowed ? Number(sCounts[n] || sCounts[String(n)] || 0) : 0;
          const vipEpCnt = (n === seasonNum && maxAllowedEpisodes > 0) ? Math.min(rawCnt, maxAllowedEpisodes) : rawCnt;
          const vipBadgeTxt = vipEpCnt > 0 ? (' · ' + vipEpCnt) : '';
          return '<button class="btn '+(n===seasonNum?'red':'')+'" style="padding:5px 11px;font-size:12px" onclick="loadSeason('+seriesId+','+n+',true)">Staffel '+n+vipBadgeTxt+(isProgSeason ? ' 👁️' : '')+'</button>';
        }).join(" ");

        const progressBannerHtml = prog ? (
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;margin-bottom:8px;border-radius:8px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);font-size:11.5px">' +
            '<span>👁️ <b>Fortschritt:</b> Zuletzt bei <b>S' + String(prog.season).padStart(2,'0') + 'E' + String(prog.episode).padStart(2,'0') + '</b>' + (prog.epName ? ' (' + esc(prog.epName) + ')' : '') + '</span>' +
            (Number(prog.season) !== Number(seasonNum) ? '<button class="btn green" style="padding:3px 8px;font-size:11px" onclick="loadSeason(' + seriesId + ',' + Number(prog.season) + ',true)">↪️ Zu Staffel ' + Number(prog.season) + '</button>' : '') +
          '</div>'
        ) : '';

        box.innerHTML =
          '<div class="season-toolbar-row">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' + sBtns + '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
              (vipAllowed ? buildModalDeliveryTargetSelectorHtml() : '') +
              ((vipAllowed && seasonStreamableCount > 0) ? (
                '<button class="btn-action-glass" style="padding:5px 10px;font-size:11.5px;border-color:rgba(245,158,11,0.45);color:#fde68a" onclick="sendWholeSeasonToTelegram(' + seriesId + ',' + seasonNum + ')" title="Alle ' + seasonStreamableCount + ' verfügbaren Folgen von Staffel ' + seasonNum + ' nacheinander an dein gewähltes Ziel senden">' +
                  '📦 Staffel ' + seasonNum + ' senden (' + seasonStreamableCount + ')' +
                '</button>'
              ) : '') +
            '</div>' +
          '</div>' +
          progressBannerHtml +
          episodes.map(ep => {
            const epCode = 'S'+String(seasonNum).padStart(2,'0')+'E'+String(ep.episode_number).padStart(2,'0');
            const isLastWatched = Boolean(prog && Number(prog.season) === Number(seasonNum) && Number(prog.episode) === Number(ep.episode_number));
            const isNextEpisode = Boolean(prog && Number(prog.season) === Number(seasonNum) && Number(ep.episode_number) === Number(prog.episode) + 1);
            const rowCls = isLastWatched ? "ep-row ep-watched" : isNextEpisode ? "ep-row ep-next-up" : "ep-row";
            const progBadgeHtml = isLastWatched
              ? '<span class="ep-progress-badge">👁️ Zuletzt</span>'
              : isNextEpisode
                ? '<span class="ep-progress-badge next">▶ Nächste</span>'
                : '';

            // Episoden-Streams & Versions-Switcher strikt NUR für VIP-Mitglieder!
            let filesBtns = "";
            let activeFileForActions = (Array.isArray(ep.files) && ep.files[0]) ? ep.files[0] : null;
            if (vipAllowed) {
              const epVersions = Array.isArray(ep.versions) && ep.versions.length > 0
                ? ep.versions
                : (Array.isArray(ep.files) ? ep.files.map(f => ({
                    versionLabel: f.versionLabel || f.version_label || "Originalfassung",
                    file_id: f.telegram_file_id,
                    telegram_file_id: f.telegram_file_id,
                    quality: f.quality || "1080p",
                    codec: f.codec || "x264",
                    file_size: f.file_size || 0,
                    tags: f.tags || "",
                    subtitles: Array.isArray(f.subtitles) ? f.subtitles : []
                  })) : []);

              const distinctLabels = Array.from(new Set(epVersions.map(v => v.versionLabel || "Originalfassung")));
              if (epVersions.length > 1 && distinctLabels.length > 1) {
                const vKey = seriesId + "_" + seasonNum + "_" + ep.episode_number;
                const activeIdx = Math.min(Number(selectedEpisodeVersionMap[vKey] || 0), epVersions.length - 1);
                const activeVer = epVersions[activeIdx] || epVersions[0];
                activeFileForActions = activeVer;
                const activeFid = activeVer.file_id || activeVer.telegram_file_id;
                const activeSizeStr = formatFileSizeClient(activeVer.file_size);
                const activeLabel = activeVer.versionLabel || "Originalfassung";
                const activeSubs = Array.isArray(activeVer.subtitles) ? activeVer.subtitles : [];
                const activeBtnMeta = [activeVer.quality || '1080p', activeVer.codec || '', activeSizeStr ? ('· ' + activeSizeStr) : '', '· ' + activeLabel].filter(Boolean).join(' ');

                const switcherTabsHtml =
                  '<div class="version-switcher" style="display:inline-flex;gap:3px;align-items:center;background:rgba(255,255,255,0.04);padding:2px 4px;border-radius:6px;border:1px solid rgba(255,255,255,0.1)">' +
                    epVersions.map((v, vIdx) => {
                      const isSel = vIdx === activeIdx;
                      const vLbl = v.versionLabel || "Originalfassung";
                      return '<button type="button" class="delivery-pill-btn ' + (isSel ? 'active' : '') + '" style="padding:2px 7px;font-size:10.5px" onclick="selectEpisodeVersion(' + seriesId + ',' + seasonNum + ',' + ep.episode_number + ',' + vIdx + ')">' + esc(vLbl) + '</button>';
                    }).join('') +
                  '</div>';

                const playBtnHtml = '<button class="btn-stream-clean" onclick="requestTelegramStream(\\''+esc(activeFid)+'\\',\\''+esc((state.activeDetails?.title || 'Serie') + ' ' + epCode + ' - ' + ep.name)+'\\',\\''+esc(activeVer.quality || '1080p')+'\\',{seriesId:'+seriesId+',season:'+seasonNum+',episode:'+ep.episode_number+',epName:\\''+esc(ep.name)+'\\',fileSize:\\''+esc(activeSizeStr)+'\\',tags:\\''+esc(activeLabel)+'\\'})">▶ ' + esc(activeBtnMeta) + (activeSubs.length > 0 ? ' + UT' : '') + '</button>' +
                  (activeSubs.length > 0 ? ' <button type="button" class="btn-tool-quiet" style="padding:4px 8px;font-size:11px" onclick="requestTelegramSubtitleOnly(\\''+esc(activeFid)+'\\',\\''+esc((state.activeDetails?.title || 'Serie') + ' ' + epCode)+'\\',{seriesId:'+seriesId+',season:'+seasonNum+',episode:'+ep.episode_number+'})" title="Nur Untertitel einzeln senden">💬 UT (' + activeSubs.length + ')</button>' : '');

                filesBtns = switcherTabsHtml + " " + playBtnHtml;
              } else if (Array.isArray(ep.files)) {
                const sortedEpFiles = ep.files
                  .slice()
                  .map(f => ({
                    ...f,
                    _normPart: normalizeClientPartLabel(f.part, f.raw_filename || ""),
                    _partNum: extractClientPartNumber(normalizeClientPartLabel(f.part, f.raw_filename || ""))
                  }))
                  .sort((a, b) => {
                    if (a._partNum > 0 && b._partNum > 0 && a._partNum !== b._partNum) return a._partNum - b._partNum;
                    return 0;
                  });
                filesBtns = sortedEpFiles.map(f => {
                  const sizeStr = formatFileSizeClient(f.file_size);
                  const rawTagsStr = cleanUserVisibleStreamTagsClient(f.tags || f.versionLabel || f.version_label || "");
                  const fSubs = Array.isArray(f.subtitles) ? f.subtitles : [];
                  const tagsStr = rawTagsStr
                    .split(/\s*·\s*/)
                    .map(t => {
                      const tl = t.toLowerCase();
                      if (tl.includes("netflix") || tl.includes("edited") || tl.includes("stream") || tl.includes("original parts")) return "Netflix-Fassung";
                      if (tl.includes("tv-schnitt")) return "TV-Schnitt";
                      if (tl.includes("dvd-fassung")) return "DVD-Fassung";
                      return t.trim();
                    })
                    .filter(Boolean)
                    .filter((v, i, arr) => arr.indexOf(v) === i)
                    .join(" · ");
                  const isPrereleaseEp = tagsStr.includes("Vorabversion") || /\b(?:HDTS|TeleSync|HDCAM|MicDub|LineDub|Screener|DVDScr)\b/i.test(tagsStr);
                  const partPrefix = f._normPart ? (f._normPart + ' · ') : '';
                  const btnMeta = [partPrefix + (f.quality || '1080p'), f.codec || '', sizeStr ? ('· ' + sizeStr) : '', tagsStr ? ('· ' + tagsStr) : ''].filter(Boolean).join(' ');
                  return '<button class="btn-stream-clean ' + (isPrereleaseEp ? 'prerelease' : '') + '" onclick="requestTelegramStream(\\''+esc(f.telegram_file_id)+'\\',\\''+esc((state.activeDetails?.title || 'Serie') + ' ' + epCode + ' - ' + ep.name + (f._normPart ? ' (' + f._normPart + ')' : ''))+'\\',\\''+esc(f.quality || '1080p')+'\\',{seriesId:'+seriesId+',season:'+seasonNum+',episode:'+ep.episode_number+',epName:\\''+esc(ep.name)+'\\',fileSize:\\''+esc(sizeStr)+'\\',tags:\\''+esc(tagsStr)+'\\'})">▶ ' + esc(btnMeta) + (fSubs.length > 0 ? ' + UT' : '') + '</button>' +
                    (fSubs.length > 0 ? ' <button type="button" class="btn-tool-quiet" style="padding:4px 8px;font-size:11px" onclick="requestTelegramSubtitleOnly(\\''+esc(f.telegram_file_id)+'\\',\\''+esc((state.activeDetails?.title || 'Serie') + ' ' + epCode)+'\\',{seriesId:'+seriesId+',season:'+seasonNum+',episode:'+ep.episode_number+'})" title="Nur Untertitel einzeln senden">💬 UT (' + fSubs.length + ')</button>' : '');
                }).join(" ");
              }
            }

            const isAdminUser = Boolean(state.authUser?.isAdmin);
            const canReportMedia = Boolean(vipAllowed || isAdminUser);
            const activeFidStr = String(activeFileForActions?.telegram_file_id || activeFileForActions?.file_id || "");
            const activeVerLblStr = String(activeFileForActions?.versionLabel || activeFileForActions?.version_label || activeFileForActions?.tags || "Originalfassung");
            const activeQualStr = String(activeFileForActions?.quality || "1080p");
            const hasStreamFile = Boolean(Array.isArray(ep.files) && ep.files.length > 0);

            const adminEditBtnHtml = (isAdminUser && hasStreamFile)
              ? ('<button type="button" class="ep-ghost-btn" onclick="openEpisodeCorrectionModal({typeCode:\\'s\\',tmdbId:' + seriesId + ',title:\\'' + esc(state.activeDetails?.title || 'Serie') + '\\',season:' + seasonNum + ',episode:' + ep.episode_number + ',episodeTitle:\\'' + esc(ep.name) + '\\',telegramFileId:\\'' + esc(activeFidStr) + '\\',versionLabel:\\'' + esc(activeVerLblStr) + '\\',quality:\\'' + esc(activeQualStr) + '\\'})" title="Folge korrigieren (Staffel/Folge anpassen, Schnittfassung wechseln oder mit neuer TMDb-ID verknüpfen)">✏️</button>')
              : '';

            const reportBtnHtml = canReportMedia
              ? ('<button type="button" class="ep-ghost-btn" onclick="openMediaReportModal({typeCode:\\'s\\',tmdbId:' + seriesId + ',title:\\'' + esc(state.activeDetails?.title || 'Serie') + '\\',season:' + seasonNum + ',episode:' + ep.episode_number + ',episodeTitle:\\'' + esc(ep.name) + '\\',telegramFileId:\\'' + esc(activeFidStr) + '\\',versionLabel:\\'' + esc(activeVerLblStr) + '\\'})" title="Fehler für ' + epCode + ' melden">⚠️</button>')
              : '';

            return '<div class="' + rowCls + '">' +
              '<div class="ep-title" tabindex="0" onclick="openEpisodeStory('+seriesId+','+seasonNum+','+ep.episode_number+',\\''+esc(ep.name)+'\\')" title="Antippen für Episoden-Beschreibung & Telegraph-Guide">' +
                '<span class="ep-code-badge">' + epCode + '</span>' +
                '<span class="ep-name-text">' + esc(ep.name) + '</span>' +
                progBadgeHtml +
              '</div>' +
              '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                filesBtns +
                adminEditBtnHtml +
                reportBtnHtml +
                '<button class="ep-ghost-btn '+(ep.isSaved?'saved':'')+'" onclick="toggleEpisodeSave('+seriesId+','+seasonNum+','+ep.episode_number+')" title="'+(ep.isSaved?'Folge aus Merkliste entfernen':'Folge auf Merkliste speichern')+'">'+(ep.isSaved?'✓':'🔖')+'</button>' +
              '</div>' +
            '</div>';
          }).join("");
        if (jumpToFirstEpisode) {
          const nextOrFirstEpEl = box.querySelector(".ep-row.ep-next-up .ep-title, .ep-row.ep-watched .ep-title, .ep-title");
          if (nextOrFirstEpEl && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(nextOrFirstEpEl, true);
          }
        }
      }

      // =========================================================================
      // GRANULARER "FOLGEN KORRIGIEREN"-DIALOG & "FEHLER MELDEN"-MODAL (CLIENT)
      // =========================================================================
      let activeEpisodeCorrectionState = null;
      let activeMediaReportState = null;

      function ensureSubModalMountClient() {
        let el = document.getElementById("subModalOverlayRoot");
        if (!el) {
          el = document.createElement("div");
          el.id = "subModalOverlayRoot";
          document.body.appendChild(el);
        }
        return el;
      }

      function closeSubModalOverlayClient() {
        const el = document.getElementById("subModalOverlayRoot");
        if (el) el.innerHTML = "";
        activeEpisodeCorrectionState = null;
        activeMediaReportState = null;
      }

      function openEpisodeCorrectionModal(opts) {
        if (!state.authUser?.isAdmin) {
          showHudToast("⛔ Nur Administratoren können Folgen und Dateien umsortieren.");
          return;
        }
        const typeCode = opts?.typeCode === "m" ? "m" : "s";
        const tmdbId = Number(opts?.tmdbId || state.activeDetails?.id || 0);
        const title = String(opts?.title || state.activeDetails?.title || "Titel");
        const season = Math.max(1, Number(opts?.season || 1));
        const episode = Math.max(1, Number(opts?.episode || 1));
        const episodeTitle = String(opts?.episodeTitle || "");
        const telegramFileId = String(opts?.telegramFileId || "");
        const versionLabel = String(opts?.versionLabel || "Originalfassung");
        const quality = String(opts?.quality || "1080p");
        const reportId = Number(opts?.reportId || 0);

        // Falls in activeDetails.allStreamFiles der Original-Dateiname oder Telegram-Link vorhanden ist, automatisch nachladen
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

        const initialMode = typeCode === "m" ? "relink_tmdb" : (opts?.initialMode || "move_se");
        activeEpisodeCorrectionState = {
          typeCode,
          tmdbId,
          title,
          season,
          episode,
          episodeTitle,
          telegramFileId,
          versionLabel,
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
        const epBadge = st.typeCode === "s"
          ? ('S' + String(st.season).padStart(2, '0') + 'E' + String(st.episode).padStart(2, '0') + (st.episodeTitle ? (' – ' + esc(st.episodeTitle)) : ''))
          : '🎬 Spielfilm-Datei';

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
            '<div class="submodal-box">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">' +
                '<div style="font-size:15px;font-weight:900;color:#fff">✏️ Folge / Datei korrigieren</div>' +
                '<button type="button" class="btn red" onclick="closeSubModalOverlayClient()">✖</button>' +
              '</div>' +

              '<div style="padding:9px 11px;border-radius:8px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.35);margin-bottom:10px;font-size:12px">' +
                '<div style="font-weight:800;color:#f8fafc">' + esc(st.title) + ' <span style="color:#38bdf8">(' + epBadge + ')</span></div>' +
                '<div style="color:#94a3b8;font-size:11px;margin-top:3px">' +
                  'Aktuelle Version: <b style="color:#fbbf24">' + esc(st.versionLabel) + '</b> • Qualität: <b>' + esc(st.quality) + '</b>' +
                  (String(st.telegramFileId || "").startsWith("tg_export_") ? ' • <span style="color:#38bdf8">🔗 Quellgruppe (Auto-Copy)</span>' : (st.telegramFileId ? ' • <span style="color:#34d399">⚡ Direkte Telegram File-ID</span>' : '')) +
                  (st.reportId ? (' • <span style="color:#34d399">🚨 Verknüpft mit Meldung #' + st.reportId + ' (wird beim Speichern automatisch gelöst)</span>') : '') +
                '</div>' +
                (st.rawFilename ? '<div style="margin-top:4px;font-family:monospace;font-size:10.5px;color:#cbd5e1;word-break:break-all">📄 Original-Datei: ' + esc(st.rawFilename) + '</div>' : '') +
                (st.telegramFileId ? '<div style="margin-top:2px;font-family:monospace;font-size:10px;color:#64748b;word-break:break-all">🔑 File-Ref: ' + esc(st.telegramFileId) + '</div>' : '') +
                (st.messageLink ? '<div style="margin-top:4px"><a href="' + esc(st.messageLink) + '" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;font-size:11px;text-decoration:underline">🔗 Original-Nachricht in Telegram öffnen</a></div>' : '') +
              '</div>' +

              /* Modus-Umschalter */
              '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
                (st.typeCode === "s" ? (
                  '<button type="button" class="btn ' + (st.mode === 'move_se' ? 'red' : '') + '" onclick="switchEpisodeCorrectionModeClient(\\'move_se\\')">🔢 Staffel & Folge anpassen</button>'
                ) : '') +
                '<button type="button" class="btn ' + (st.mode === 'change_version' ? 'red' : '') + '" onclick="switchEpisodeCorrectionModeClient(\\'change_version\\')">🎞️ Version / Schnittfassung</button>' +
                '<button type="button" class="btn ' + (st.mode === 'relink_tmdb' ? 'red' : '') + '" onclick="switchEpisodeCorrectionModeClient(\\'relink_tmdb\\')">🔄 Neu verknüpfen (TMDb)</button>' +
              '</div>' +

              /* MODUS 1: Staffel & Folge anpassen */
              (st.mode === "move_se" ? (
                '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;margin-bottom:12px">' +
                  '<div style="font-size:12px;color:#cbd5e1;margin-bottom:8px">Wähle die korrekte <b>Staffel</b> und <b>Folge</b> innerhalb von <b>' + esc(st.title) + '</b>:</div>' +
                  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
                    '<div>' +
                      '<label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Ziel-Staffel</label>' +
                      '<input id="epCorrNewSeasonInp" type="number" min="1" max="99" value="' + st.season + '" style="width:100%;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:13px;font-weight:800" />' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Ziel-Folge</label>' +
                      '<input id="epCorrNewEpisodeInp" type="number" min="1" max="999" value="' + st.episode + '" style="width:100%;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:13px;font-weight:800" />' +
                    '</div>' +
                  '</div>' +
                '</div>'
              ) : '') +

              /* MODUS 2: Version / Schnittfassung wechseln */
              (st.mode === "change_version" ? (
                '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;margin-bottom:12px">' +
                  '<div style="font-size:12px;color:#cbd5e1;margin-bottom:8px">Ordne diese Datei einer anderen <b>Schnittfassung / Version</b> zu (keine Version geht verloren, beide erscheinen im Versions-Switcher):</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
                    VERSION_PRESETS.map(vp =>
                      '<button type="button" class="btn ' + (st.versionLabel === vp ? 'amber' : '') + '" onclick="document.getElementById(\\'epCorrVersionInp\\').value=\\'' + esc(vp) + '\\'">' + esc(vp) + '</button>'
                    ).join("") +
                  '</div>' +
                  '<input id="epCorrVersionInp" value="' + esc(st.versionLabel) + '" placeholder="Eigene Versions-Bezeichnung (z.B. Netflix-Fassung)..." style="width:100%;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:12.5px" />' +
                '</div>'
              ) : '') +

              /* MODUS 3: Mit anderer TMDb-ID (Serie + Staffel/Folge oder Film) verknüpfen */
              (st.mode === "relink_tmdb" ? (
                '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;margin-bottom:12px">' +
                  '<div style="font-size:12px;color:#cbd5e1;margin-bottom:8px"><b>Umfang der Neu-Verknüpfung:</b></div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
                    '<button type="button" class="btn ' + (st.relinkScope === 'single_episode' ? 'green' : '') + '" onclick="activeEpisodeCorrectionState.relinkScope=\\'single_episode\\';renderEpisodeCorrectionModalDomClient()">🎯 Nur diese einzelne Folge / Datei zuweisen</button>' +
                    '<button type="button" class="btn ' + (st.relinkScope === 'entire_series' ? 'amber' : '') + '" onclick="activeEpisodeCorrectionState.relinkScope=\\'entire_series\\';renderEpisodeCorrectionModalDomClient()">📦 Ganze Serie / Alle Folgen umziehen</button>' +
                  '</div>' +

                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
                    '<input id="epCorrTmdbSearchInp" value="' + esc(st.title) + '" placeholder="Richtigen Titel oder TMDb-ID suchen..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();searchEpisodeCorrectionTmdbClient()}" style="flex:1;min-width:170px;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:12px" />' +
                    '<button type="button" class="btn blue" onclick="searchEpisodeCorrectionTmdbClient()">🔍 Suchen</button>' +
                  '</div>' +

                  '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-bottom:8px">' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:#94a3b8;display:block;margin-bottom:2px">Ziel-Typ</label>' +
                      '<select id="epCorrNewTypeSel" onchange="activeEpisodeCorrectionState.selectedNewTypeCode=this.value" style="width:100%;padding:7px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px">' +
                        '<option value="s" ' + (st.selectedNewTypeCode === 's' ? 'selected' : '') + '>📺 Serie</option>' +
                        '<option value="m" ' + (st.selectedNewTypeCode === 'm' ? 'selected' : '') + '>🎬 Film</option>' +
                      '</select>' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:#94a3b8;display:block;margin-bottom:2px">Ziel TMDb-ID</label>' +
                      '<input id="epCorrNewTmdbIdInp" type="number" value="' + st.selectedNewTmdbId + '" style="width:100%;padding:7px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;font-weight:800" />' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:#94a3b8;display:block;margin-bottom:2px">Staffel</label>' +
                      '<input id="epCorrRelinkSeasonInp" type="number" min="1" max="99" value="' + st.season + '" style="width:100%;padding:7px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;font-weight:800" />' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:#94a3b8;display:block;margin-bottom:2px">Folge</label>' +
                      '<input id="epCorrRelinkEpisodeInp" type="number" min="1" max="999" value="' + st.episode + '" style="width:100%;padding:7px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;font-weight:800" />' +
                    '</div>' +
                  '</div>' +

                  '<div id="epCorrTmdbResultsBox" style="max-height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:5px"></div>' +
                '</div>'
              ) : '') +

              '<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">' +
                '<button type="button" class="btn" onclick="closeSubModalOverlayClient()">Abbrechen</button>' +
                '<button type="button" class="btn green" onclick="submitEpisodeCorrectionClient()">💾 Korrektur speichern</button>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      async function searchEpisodeCorrectionTmdbClient() {
        const q = (document.getElementById("epCorrTmdbSearchInp")?.value || "").trim();
        const resBox = document.getElementById("epCorrTmdbResultsBox");
        if (!q || !resBox) return;
        resBox.innerHTML = '<div style="font-size:11.5px;color:#38bdf8;padding:6px">⏳ Suche auf TMDb & Fallback-APIs...</div>';
        try {
          const r = await apiFetchJson(API_BASE + "/search?chatId=" + encodeURIComponent(chatId) + "&q=" + encodeURIComponent(q) + "&bypass=1");
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
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:7px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1)">' +
              '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">' +
                (pUrl ? '<img src="' + esc(pUrl) + '" style="width:28px;height:42px;object-fit:cover;border-radius:4px;flex-shrink:0" />' : '') +
                '<div style="min-width:0;flex:1">' +
                  '<div style="font-size:12px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (tc === "s" ? "📺 " : "🎬 ") + esc(tName) + ' (' + esc(yr) + ')</div>' +
                  '<div style="font-size:10.5px;color:#38bdf8">TMDb #' + Number(item.id) + '</div>' +
                '</div>' +
              '</div>' +
              '<button type="button" class="btn green" style="padding:4px 8px;font-size:11px" onclick="selectEpisodeCorrectionTmdbCandidateClient(\\'' + tc + '\\',' + Number(item.id) + ',\\'' + esc(tName) + '\\')">Auswählen</button>' +
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
        showHudToast("🎯 Ziel gewählt: " + newTitle + " (#" + newTmdbId + ") – jetzt Staffel/Folge prüfen & speichern.");
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
          payload.newSeason = Math.max(1, Number(document.getElementById("epCorrNewSeasonInp")?.value || st.season));
          payload.newEpisode = Math.max(1, Number(document.getElementById("epCorrNewEpisodeInp")?.value || st.episode));
        } else if (st.mode === "change_version") {
          payload.newVersionLabel = String(document.getElementById("epCorrVersionInp")?.value || st.versionLabel || "Originalfassung").trim();
        } else if (st.mode === "relink_tmdb") {
          payload.newTypeCode = document.getElementById("epCorrNewTypeSel")?.value === "m" ? "m" : "s";
          payload.newTmdbId = Number(document.getElementById("epCorrNewTmdbIdInp")?.value || st.selectedNewTmdbId || 0);
          payload.newSeason = Math.max(1, Number(document.getElementById("epCorrRelinkSeasonInp")?.value || st.season));
          payload.newEpisode = Math.max(1, Number(document.getElementById("epCorrRelinkEpisodeInp")?.value || st.episode));
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
          clearClientMediaCaches();
          closeSubModalOverlayClient();
          showHudToast("✅ Folge erfolgreich korrigiert" + (st.reportId ? " & Fehlermeldung automatisch als gelöst markiert!" : "!"));

          if (st.mode === "relink_tmdb" && r.newTmdbId && (r.scope === "entire_series" || Number(r.newTmdbId) !== Number(st.tmdbId))) {
            await openDetails(r.newTypeCode || "s", r.newTmdbId, false, "", "", r.newSeason || 1);
          } else if (st.typeCode === "s") {
            const targetSeasonToLoad = st.mode === "move_se" ? Number(payload.newSeason || st.season) : st.season;
            await openDetails("s", st.tmdbId, false, "", "", targetSeasonToLoad);
          } else {
            await openDetails("m", st.tmdbId, false);
          }
          if (state.currentView === "admin") {
            loadAdminPanelView();
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
          reasonCode: typeCode === "s" && season ? "wrong_episode" : "wrong_media"
        };

        renderMediaReportModalDomClient();
      }

      function renderMediaReportModalDomClient() {
        const st = activeMediaReportState;
        if (!st) return;
        const mount = ensureSubModalMountClient();
        const epTag = st.typeCode === "s" && st.season
          ? (' • S' + String(st.season).padStart(2, '0') + 'E' + String(st.episode || 1).padStart(2, '0') + (st.episodeTitle ? (' (' + esc(st.episodeTitle) + ')') : ''))
          : '';

        const REASONS = [
          { code: "wrong_media", label: "🎬 Falscher Film / Falsche Serie" },
          { code: "wrong_episode", label: "🔢 Falsche Staffel- oder Folgennummer" },
          { code: "broken_video", label: "❌ Video defekt / Lädt nicht" },
          { code: "other", label: "💬 Sonstiges" }
        ];

        mount.innerHTML =
          '<div class="submodal-backdrop" onclick="if(event.target===this)closeSubModalOverlayClient()">' +
            '<div class="submodal-box">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">' +
                '<div style="font-size:15px;font-weight:900;color:#fbbf24">⚠️ Fehler melden</div>' +
                '<button type="button" class="btn red" onclick="closeSubModalOverlayClient()">✖</button>' +
              '</div>' +

              '<div style="padding:9px 11px;border-radius:8px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.35);margin-bottom:12px;font-size:12px">' +
                '<div style="font-weight:800;color:#fff">' + esc(st.title) + '<span style="color:#fbbf24">' + epTag + '</span></div>' +
                (st.versionLabel ? '<div style="font-size:11px;color:#94a3b8;margin-top:2px">Version: <b>' + esc(st.versionLabel) + '</b></div>' : '') +
              '</div>' +

              '<div style="font-size:12px;color:#cbd5e1;font-weight:700;margin-bottom:6px">Was stimmt mit diesem Eintrag nicht?</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">' +
                REASONS.map(r => {
                  const isSel = st.reasonCode === r.code;
                  return '<button type="button" class="btn ' + (isSel ? 'red' : '') + '" style="justify-content:flex-start;padding:9px 12px;font-size:12.5px;text-align:left;' + (isSel ? '' : 'background:rgba(255,255,255,0.04);') + '" onclick="activeMediaReportState.reasonCode=\\'' + r.code + '\\';renderMediaReportModalDomClient()">' +
                    (isSel ? '🔘 ' : '⚪ ') + esc(r.label) +
                  '</button>';
                }).join("") +
              '</div>' +

              '<div style="margin-bottom:12px">' +
                '<label style="font-size:11.5px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Kurze Notiz (optional, z.B. „Ist eigentlich Staffel 2 Folge 5“):</label>' +
                '<textarea id="mediaReportNoteInp" rows="2" placeholder="Optionale Hinweise für den Admin..." style="width:100%;padding:8px 10px;border-radius:8px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;resize:vertical"></textarea>' +
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
        const sNum = Math.max(1, Number(reportObj.season_number || 1));
        const eNum = Math.max(1, Number(reportObj.episode_number || 1));
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

      async function adminResolveMediaReportClient(reportId) {
        setBusyState(true, "✅ Markiere Meldung als gelöst...");
        try {
          await apiFetchJson(API_BASE + "/admin/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "resolve", reportId: Number(reportId) })
          });
          showHudToast("✅ Meldung #" + reportId + " als gelöst markiert.");
          loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function adminDeleteMediaReportClient(reportId) {
        setBusyState(true, "🗑️ Lösche Meldung...");
        try {
          await apiFetchJson(API_BASE + "/admin/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", reportId: Number(reportId) })
          });
          showHudToast("🗑️ Meldung gelöscht.");
          loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function openEpisodeStory(seriesId, season, episode, epName = "") {
        setSeriesProgress(seriesId, season, episode, epName);
        setBusyState(true, "📖 Öffne Telegraph-Story...");
        try {
          const r = await apiFetchJson(API_BASE + "/episode-story", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, seriesId, season, episode }) });
          if (r.telegraphUrl) {
            if (tg && tg.openLink) tg.openLink(r.telegraphUrl);
            else window.open(r.telegraphUrl, "_blank");
          }
          loadSeason(seriesId, season, false, true);
        } finally {
          setBusyState(false);
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
        if (btn) btn.disabled = true;
        try {
          const r = await apiFetchJson(API_BASE + "/wishlist", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "toggle_item", type, id }) });
          const isSaved = Boolean(r.saved);
          syncCardWishlistBadgeInDom(type, id, isSaved);
          if (state.activeDetails) state.activeDetails.isSaved = isSaved;
          if (btn) {
            btn.disabled = false;
            btn.className = "btn " + (isSaved ? "green" : "");
            btn.textContent = isSaved ? "✅ Gespeichert" : "💾 Merkliste";
          }
          showHudToast(isSaved ? "💾 Zur Merkliste hinzugefügt" : "🗑️ Aus Merkliste entfernt");
        } catch (e) {
          if (btn) btn.disabled = false;
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
        renderWishlistViewDomOnly();
      }

      function onWishlistSearchInput(val) {
        state.wlSearchQuery = String(val || "");
        renderWishlistListItemsMountOnly();
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
        if (state.wlSort === "title_asc") {
          sorted.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "de"));
        } else if (state.wlSort === "year_desc") {
          sorted.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
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
          mount.innerHTML = '<div class="panel-box" style="color:var(--text-muted);font-size:12.5px">Keine passenden Einträge in dieser Merklisten-Ansicht gefunden.</div>';
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
            const itemPosterSafe = esc(it.poster || '');
            const yrStr = esc((it.year && it.year !== 'K. A.') ? String(it.year).slice(0, 4) : '–');
            const epsList = Array.isArray(it.episodes) ? it.episodes : [];
            const plObj = it.folderId ? folders.find(f => f.id === it.folderId) : null;
            const epCountBadgeHtml = (isSer && epsList.length > 0)
              ? ('<span class="card-type-badge" title="' + epsList.length + ' gespeicherte Folge(n) – Tipp für Liste" onclick="event.stopPropagation();setWishlistViewMode(\\'list\\')">📺 ' + epsList.length + ' Flg.</span>')
              : '';
            const subLeftTxt = plObj ? ('📁 ' + esc(plObj.name.slice(0, 12))) : (isSer ? '📺 Serie' : '🎬 Film');
            return '<div class="card" tabindex="0" data-card-key="' + esc(cardKey) + '" data-card-title="' + itemTitleSafe + '" onclick="openDetails(\\'' + tc + '\\',' + targetId + ',false,\\'' + itemTitleSafe + '\\',\\'' + itemPosterSafe + '\\')">' +
              '<div class="card-poster-wrap">' +
                '<div class="card-top-left-stack">' +
                  epCountBadgeHtml +
                '</div>' +
                '<button type="button" class="card-quick-save saved" onclick="event.stopPropagation();deleteSavedUid(\\'' + esc(it.uid) + '\\')" title="Aus Merkliste entfernen">🗑️</button>' +
                '<button type="button" class="card-quick-info" onclick="event.stopPropagation();openDetails(\\'' + tc + '\\',' + targetId + ',false,\\'' + itemTitleSafe + '\\',\\'' + itemPosterSafe + '\\')" title="Details öffnen">ℹ️ Details</button>' +
                '<button type="button" class="card-quick-trailer" onclick="playInstantTrailerFromCard(event,\\'' + tc + '\\',' + targetId + ',\\'' + itemTitleSafe + '\\',\\'' + itemPosterSafe + '\\')" title="Instant-Trailer abspielen">▶ Trailer</button>' +
                '<img src="' + (resolvedCardPoster ? esc(resolvedCardPoster) : buildPosterFallbackSvg(it.title, isSer ? 'SERIE' : 'FILM')) + '" onerror="this.onerror=null;this.src=buildPosterFallbackSvg(\\'' + itemTitleSafe + '\\',\\'' + (isSer ? 'SERIE' : 'FILM') + '\\');" loading="lazy" draggable="false" alt="' + itemTitleSafe + '" />' +
              '</div>' +
              '<div class="card-body">' +
                '<div class="card-title">' + itemTitleSafe + '</div>' +
                '<div class="card-sub"><span>' + subLeftTxt + '</span><span>' + yrStr + '</span></div>' +
              '</div>' +
            '</div>';
          }).join("") + '</div>';
          return;
        }

        mount.innerHTML = filteredItems.map((it, idx) => {
          const isEp = it.contentType === 'episode';
          const isSer = it.contentType === 'series' || isEp;
          const targetId = isEp ? it.seriesId : it.tmdbId;
          const badge = isEp ? '💿 Folge' : isSer ? '📺 Serie' : '🎬 Film';
          const plObj = it.folderId ? folders.find(f => f.id === it.folderId) : null;
          const plTag = plObj ? ' <span style="color:#38bdf8;font-size:10.5px">[' + esc(plObj.name) + ']</span>' : '';
          const thumbUrl = resolvePosterUrlClient(it.poster, 'w185', '');
          const epsList = Array.isArray(it.episodes) ? it.episodes : [];
          const drawerId = 'wl_' + esc(it.uid || (targetId + '_' + idx));
          const epPreviewCodes = epsList.slice(0, 3).map(e => e.code || ('S' + String(e.season || 1).padStart(2, '0') + 'E' + String(e.episode || 1).padStart(2, '0'))).join(', ');
          const epSummaryBtnHtml = (isSer && epsList.length > 0)
            ? ('<button type="button" class="btn" style="padding:3px 8px;font-size:11px;background:rgba(56,189,248,0.16);border-color:rgba(56,189,248,0.45);color:#38bdf8" onclick="toggleSeriesEpisodesDrawerClient(event,\\'' + drawerId + '\\')">📺 ' + epsList.length + ' Folge' + (epsList.length === 1 ? '' : 'n') + ' (' + esc(epPreviewCodes) + (epsList.length > 3 ? '…' : '') + ') <span id="epDrawerIcon_' + drawerId + '">▾</span></button>')
            : '';
          const epDrawerHtml = (isSer && epsList.length > 0)
            ? ('<div id="epDrawer_' + drawerId + '" style="display:none;flex-direction:column;gap:4px;margin-top:6px;padding:8px;border-radius:8px;background:rgba(15,23,42,0.85);border:1px solid rgba(56,189,248,0.3)">' +
                epsList.map(ep => {
                  const epCode = ep.code || ('S' + String(ep.season || 1).padStart(2, '0') + 'E' + String(ep.episode || 1).padStart(2, '0'));
                  const epTitle = ep.title || ('Folge ' + (ep.episode || 1));
                  const qStr = [ep.quality || '1080p', ep.codec || ''].filter(Boolean).join(' • ');
                  return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.04);font-size:11.5px">' +
                    '<div style="cursor:pointer;flex:1" onclick="openDetails(\\'s\\',' + Number(targetId) + ',false,\\'\\',\\'\\',' + Number(ep.season || 1) + ')">' +
                      '<b style="color:#38bdf8">' + esc(epCode) + '</b> – <span style="color:#f8fafc">' + esc(epTitle) + '</span>' +
                      (qStr ? ' <span style="color:#94a3b8;font-size:10.5px">[' + esc(qStr) + ']</span>' : '') +
                    '</div>' +
                    '<button type="button" class="btn" style="padding:2px 7px;font-size:10.5px" onclick="openDetails(\\'s\\',' + Number(targetId) + ',false,\\'\\',\\'\\',' + Number(ep.season || 1) + ')">Staffel ' + Number(ep.season || 1) + ' öffnen</button>' +
                  '</div>';
                }).join('') +
              '</div>')
            : '';
          return '<div class="ep-row" style="flex-direction:column;align-items:stretch">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:180px;cursor:pointer" tabindex="0" onclick="openDetails(\\''+(isSer?'s':'m')+'\\','+targetId+',false)">' +
                (thumbUrl
                  ? '<img src="' + esc(thumbUrl) + '" style="width:32px;height:46px;object-fit:cover;border-radius:4px;flex-shrink:0" alt="" />'
                  : '<div style="width:32px;height:46px;background:#1e293b;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + (isSer ? '📺' : '🎬') + '</div>') +
                '<div>' +
                  '<div style="font-size:12.5px;font-weight:800;color:#fff"><span style="color:#aaa;font-size:11px;margin-right:6px">' + badge + '</span>' + esc(it.title) + (it.year && it.year !== 'K. A.' ? ' <span style="color:#888;font-size:11px">(' + esc(it.year) + ')</span>' : '') + plTag + '</div>' +
                  (it.allQualities || it.quality ? '<div style="font-size:10.5px;color:#94a3b8;margin-top:2px">' + esc(it.allQualities || it.quality) + '</div>' : '') +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                epSummaryBtnHtml +
                '<button class="btn red" onclick="deleteSavedUid(\\''+esc(it.uid)+'\\')">🗑️</button>' +
              '</div>' +
            '</div>' +
            epDrawerHtml +
          '</div>';
        }).join("");
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

        const folderBtns = [
          '<button class="btn '+(cur==='root'?'active':'')+'" onclick="loadWishlist(\\'root\\')">📂 Alle Aktiven ('+enabledItems.length+')</button>',
          '<button class="btn '+(cur==='cat_movies'?'active':'')+'" onclick="loadWishlist(\\'cat_movies\\')">🎬 Filme</button>',
          '<button class="btn '+(cur==='cat_series'?'active':'')+'" onclick="loadWishlist(\\'cat_series\\')">📺 Serien & Folgen</button>',
          ...folders.map(f => {
            const isEn = f.enabled !== false;
            const fCount = allItems.filter(i => i.folderId === f.id).length;
            const fIcon = (f.type === 'playlist' || f.isJsonPlaylist) ? (isEn ? '🎵' : '⚪') : (isEn ? '📁' : '⚪');
            return '<button class="btn '+(cur===f.id?'active':'')+'" style="'+(isEn?'':'opacity:0.65;border-style:dashed')+'" onclick="loadWishlist(\\''+esc(f.id)+'\\')">' + fIcon + ' ' + esc(f.name) + ' (' + fCount + ')</button>';
          })
        ].join(" ");

        const smartPlaylistsPanelHtml = folders.length > 0 ? (
          '<div class="panel-box" style="margin-bottom:12px;border-color:rgba(16,185,129,0.35)">' +
            '<div class="section-title">' +
              '<span>🎵 Smarte Playlisten & Ordner verwalten (' + folders.length + ')</span>' +
              '<span style="font-size:11px;color:#94a3b8">Einschalten • Ausschalten • Umbenennen • Löschen</span>' +
            '</div>' +
            folders.map(f => {
              const isEn = f.enabled !== false;
              const count = allItems.filter(i => i.folderId === f.id).length;
              const badgeType = (f.type === 'playlist' || f.isJsonPlaylist) ? '📦 JSON-Playlist' : '📁 Ordner';
              return '<div class="ep-row" style="' + (isEn ? '' : 'opacity:0.68;') + '">' +
                '<div class="ep-title" tabindex="0" onclick="loadWishlist(\\'' + esc(f.id) + '\\')">' +
                  '<span style="font-size:11px;padding:2px 6px;border-radius:999px;margin-right:6px;background:' + (isEn ? 'rgba(16,185,129,0.2);color:#34d399' : 'rgba(148,163,184,0.2);color:#94a3b8') + '">' +
                    (isEn ? '🟢 Eingeschaltet' : '⚪ Ausgeschaltet') +
                  '</span>' +
                  '<b>' + esc(f.name) + '</b> <span style="color:#94a3b8;font-size:11px">(' + count + ' Titel • ' + badgeType + ')</span>' +
                '</div>' +
                '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                  '<button class="btn ' + (isEn ? 'green' : '') + '" onclick="togglePlaylistFolderTma(\\'' + esc(f.id) + '\\')">' + (isEn ? '🟢 Ein (Ausschalten)' : '⚪ Aus (Einschalten)') + '</button>' +
                  '<button class="btn" onclick="loadWishlist(\\'' + esc(f.id) + '\\')">📂 Öffnen</button>' +
                  '<button class="btn" onclick="renamePlaylistFolderTma(\\'' + esc(f.id) + '\\',\\'' + esc(f.name) + '\\')">✏️ Name</button>' +
                  '<button class="btn red" onclick="deletePlaylistFolderTma(\\'' + esc(f.id) + '\\',\\'' + esc(f.name) + '\\')">🗑️ Löschen</button>' +
                '</div>' +
              '</div>';
            }).join("") +
          '</div>'
        ) : '';

        const activeFolderBannerHtml = activeFolderObj ? (
          '<div class="panel-box" style="margin-bottom:10px;border-color:' + (activeFolderObj.enabled !== false ? 'rgba(16,185,129,0.45)' : 'rgba(251,191,36,0.45)') + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div>' +
                '<div style="font-size:14px;font-weight:800;color:#fff">' + ((activeFolderObj.type === 'playlist' || activeFolderObj.isJsonPlaylist) ? '🎵 Custom Playlist: ' : '📁 Ordner: ') + esc(activeFolderObj.name) + '</div>' +
                '<div style="font-size:11.5px;color:#aaa;margin-top:2px">' +
                  'Status: <b style="color:' + (activeFolderObj.enabled !== false ? '#34d399' : '#fbbf24') + '">' + (activeFolderObj.enabled !== false ? '🟢 Eingeschaltet (In Merkliste sichtbar)' : '⚪ Ausgeschaltet (In Haupt-Merkliste ausgeblendet)') + '</b>' +
                  (activeFolderObj.sourceLabel ? ' • Quelle: ' + esc(activeFolderObj.sourceLabel) : '') +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                (activeFolderObj.linked && activeFolderObj.tmdbRefId && activeFolderObj.type === 'collection'
                  ? '<button class="btn purple" onclick="openCollectionView(' + Number(activeFolderObj.tmdbRefId) + ')">🍿 Komplette Filmreihe öffnen</button>'
                  : '') +
                (activeFolderObj.linked && activeFolderObj.tmdbRefId && activeFolderObj.type === 'universe'
                  ? '<button class="btn purple" onclick="openUniverseView(\\'' + esc(activeFolderObj.tmdbRefId) + '\\')">🌌 Komplettes Universum öffnen</button>'
                  : '') +
                '<button class="btn ' + (activeFolderObj.enabled !== false ? 'green' : 'amber') + '" onclick="togglePlaylistFolderTma(\\'' + esc(activeFolderObj.id) + '\\')">' + (activeFolderObj.enabled !== false ? '🟢 Ausschalten' : '⚪ Einschalten') + '</button>' +
                '<button class="btn" onclick="renamePlaylistFolderTma(\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(activeFolderObj.name) + '\\')">✏️ Umbenennen</button>' +
                '<button class="btn red" onclick="deletePlaylistFolderTma(\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(activeFolderObj.name) + '\\')">🗑️ Playlist löschen</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        ) : '';

        const azLetters = ["ALL", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "#"];
        const curWlLetter = String(state.wlLetter || "ALL").toUpperCase();
        const azBarHtml = '<div class="wl-az-bar" style="margin-bottom:10px">' +
          azLetters.map(ltr =>
            '<button type="button" class="wl-az-btn ' + (curWlLetter === ltr ? 'active' : '') + '" onclick="setWishlistLetter(\\'' + ltr + '\\')">' + (ltr === "ALL" ? "Alle" : ltr) + '</button>'
          ).join("") +
        '</div>';

        const quickFilterBarHtml = '<div class="panel-box" style="margin-bottom:10px;padding:10px 12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between">' +
          '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">' +
            '<span style="font-size:11px;font-weight:700;color:var(--text-muted)">Typ:</span>' +
            '<button class="btn ' + (state.wlFilterType === 'all' ? 'active' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickFilter(\\'all\\')">📂 Alle</button>' +
            '<button class="btn ' + (state.wlFilterType === 'm' ? 'active' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickFilter(\\'m\\')">🎬 Nur Filme</button>' +
            '<button class="btn ' + (state.wlFilterType === 's' ? 'active' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickFilter(\\'s\\')">📺 Nur Serien</button>' +
          '</div>' +
          '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">' +
            '<span style="font-size:11px;font-weight:700;color:var(--text-muted)">Sortierung:</span>' +
            '<button class="btn ' + (state.wlSort === 'added_desc' ? 'active' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickSort(\\'added_desc\\')">🆕 Zuletzt</button>' +
            '<button class="btn ' + (state.wlSort === 'title_asc' ? 'active' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickSort(\\'title_asc\\')">🔤 A–Z</button>' +
            '<button class="btn ' + (state.wlSort === 'year_desc' ? 'active' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickSort(\\'year_desc\\')">📅 Jahr</button>' +
          '</div>' +
          '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">' +
            '<span style="font-size:11px;font-weight:700;color:var(--text-muted)">Ansicht:</span>' +
            '<button class="btn ' + (isGridMode ? 'active' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistViewMode(\\'grid\\')" title="Als Poster-Raster anzeigen">🖼️ Poster-Grid</button>' +
            '<button class="btn ' + (!isGridMode ? 'active' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistViewMode(\\'list\\')" title="Als kompakte Liste mit Episoden-Auswahl anzeigen">📋 Liste</button>' +
          '</div>' +
          '<input id="wishlistSearchInp" value="' + esc(state.wlSearchQuery || '') + '" oninput="onWishlistSearchInput(this.value)" placeholder="🔍 In Merkliste filtern..." style="min-width:160px;flex:1;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:var(--text);font-size:12px" />' +
        '</div>';

        root.innerHTML = '<div class="section">' +
          '<div class="section-title"><span>💾 Synchronisierte Bot-Merkliste (<span id="wishlistCountSpan">' + filteredItems.length + '</span> Einträge)</span><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn green" onclick="createNewFolderPrompt(true)">➕ Neue Custom Playlist</button><button class="btn" onclick="createNewFolderPrompt(false)">📁 Neuer Ordner</button><button class="btn" onclick="goHome()">🏠 Hauptseite</button></div></div>' +
          '<div class="chip-grid" style="margin-bottom:10px">' + folderBtns + '</div>' +
          quickFilterBarHtml +
          azBarHtml +
          smartPlaylistsPanelHtml +
          activeFolderBannerHtml +
          '<div id="wishlistItemsMount"></div>' +
        '</div>';

        renderWishlistListItemsMountOnly();
      }

      async function loadWishlist(folderFilter) {
        if (folderFilter !== undefined) state.wlFolder = folderFilter;
        state.currentView = "wishlist";
        const root = document.getElementById("appRoot");
        if (!state.isAuthenticated) {
          root.innerHTML = '<div class="section">' +
            '<div class="panel-box" style="border-color:rgba(251,191,36,0.45)">' +
              '<div class="section-title"><span>🔒 Merkliste im Gast-Modus nicht verfügbar</span><button class="btn" onclick="goHome()">🏠 Hauptseite</button></div>' +
              '<p style="font-size:12.5px;color:#ddd;line-height:1.5;margin-bottom:12px">' +
                'Du nutzt die Seite aktuell <b>ohne Telegram initData und ohne eingeloggten Account</b>.<br>' +
                'Im Gast-Modus steht kein persönlicher Speicher (Merkliste) zur Verfügung und ein Zugriff auf andere Telegram-IDs ist gesperrt.' +
              '</p>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                '<button class="btn green" onclick="openAccountModal()">🔑 Mit abgesichertem Account (Username & Passwort) einloggen</button>' +
                '<button class="btn" onclick="goHome()">🎬 Weiter als Gast stöbern</button>' +
              '</div>' +
            '</div>' +
          '</div>';
          return;
        }
        setBusyState(true, "💾 Lade Merkliste & Custom Playlisten...");
        try {
          const r = await apiFetchJson(API_BASE + "/wishlist?chatId=" + encodeURIComponent(chatId));
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
        await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "create_folder", name: name.trim(), isPlaylist: Boolean(isPlaylist) })
        });
        showHudToast("✅ " + (isPlaylist ? "Playlist" : "Ordner") + " „" + name.trim() + "“ erstellt");
        loadWishlist(state.wlFolder);
      }

      async function togglePlaylistFolderTma(folderId) {
        if (!state.isAuthenticated) return;
        await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "toggle_playlist", folderId })
        });
        loadWishlist(state.wlFolder);
      }

      async function renamePlaylistFolderTma(folderId, currentName) {
        if (!state.isAuthenticated) return;
        const nextName = await showCustomPrompt("✏️ Neuer Custom Name für die Playlist / den Ordner:", currentName || "");
        if (!nextName || !nextName.trim()) return;
        await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "rename_playlist", folderId, name: nextName.trim() })
        });
        showHudToast("✅ Umbenannt in „" + nextName.trim() + "“");
        loadWishlist(state.wlFolder);
      }

      async function deletePlaylistFolderTma(folderId, currentName) {
        if (!state.isAuthenticated) return;
        const ok = await showCustomConfirm('Playlist "' + (currentName || folderId) + '" inklusive aller zugehörigen Einträge aus der Merkliste löschen?', '🗑️ Löschen');
        if (!ok) return;
        await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "delete_playlist", folderId })
        });
        if (state.wlFolder === folderId) state.wlFolder = "root";
        showHudToast("🗑️ Playlist gelöscht");
        loadWishlist(state.wlFolder);
      }

      async function deleteSavedUid(uid) {
        if (!state.isAuthenticated) return;
        await apiFetchJson(API_BASE + "/wishlist", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "delete_uid", uid }) });
        loadWishlist(state.wlFolder);
      }

      async function loadSettingsView() {
        state.currentView = "settings";
        updateMediaModeIndicatorDom();
        setBusyState(true, "⚙️ Lade Filter-Cockpit & Account-Einstellungen...");
        try {
          const r = await apiFetchJson(API_BASE + "/settings?chatId=" + encodeURIComponent(chatId));
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

          root.innerHTML = '<div class="section">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
              '<button class="btn" onclick="goHome()" style="padding:7px 14px;font-size:12.5px">⬅️ Zurück zur Übersicht (' + (state.type === 's' ? '📺 Serien' : '🎬 Filme') + ')</button>' +
              '<span style="font-size:12px;font-weight:700;color:var(--text-muted)">⚙️ Einstellungen & Filter-Cockpit</span>' +
            '</div>' +
            '<div class="panel-box">' +
              '<div class="section-title">' +
                '<span>🔐 Account & Sicherheit (' + (isAuth ? ('Verbunden: ID ' + esc(u.telegramId)) : '👤 Gast-Modus ohne Speicher') + ')</span>' +
                '<div style="display:flex;gap:6px">' +
                  (u.isAdmin ? '<button class="btn amber" onclick="loadAdminPanelView()">👑 Admin-Panel</button>' : '') +
                  '<button class="btn purple" onclick="openAccountModal()">🔑 ' + (isAuth ? (u.hasPasswordAccount ? 'Zugangsdaten verwalten' : 'Account mit Passwort absichern') : 'Jetzt einloggen') + '</button>' +
                '</div>' +
              '</div>' +
              '<p style="font-size:12px;color:var(--text-muted);line-height:1.5">' +
                (isAuth
                  ? (u.hasPasswordAccount
                      ? '✅ Dein Account ist als <b>' + esc(u.customUsername) + '</b> mit Passwort abgesichert. Du kannst dich von jedem Gerät und Browser (auch ohne Telegram <code>initData</code>) einloggen.'
                      : '💡 Du bist über Telegram <code>initData</code> eingeloggt. Lege jetzt einen <b>Username & Passwort</b> fest, damit du dich künftig auch außerhalb von Telegram von überall einloggen kannst!')
                  : '⚠️ Ohne Telegram <code>initData</code> und ohne Account-Login bist du im Gast-Modus (kein Merklisten-Speicher, kein Zugriff auf fremde IDs).') +
              '</p>' +
            '</div>' +

            (function() {
              const deliv = getDeliveryPreferencesClient();
              const dMode = deliv.targetMode || "dm";
              const customHookUrl = window.location.origin + "/api/telegram/custom-webhook" + (deliv.customBotToken ? ("?botToken=" + encodeURIComponent(deliv.customBotToken)) : "");
              return '<div class="panel-box">' +
                '<div class="section-title">' +
                  '<span>📤 Standard-Versandziel, Gruppen-Delivery & Eigener Bot</span>' +
                  '<span style="font-size:11px;color:#38bdf8;font-weight:700">Tipp: /id in Gruppe zeigt Chat-ID</span>' +
                '</div>' +
                '<p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:10px">' +
                  'Bestimme, wohin Filme & Serien standardmäßig gesendet werden: in deinen <b>💬 Bot-Privatchat</b>, in eine <b>👥 eigene Ziel-Gruppe</b> oder über deinen <b>🤖 eigenen Telegram-Bot-Token</b>. ' +
                  'Wenn der Bot Mitglied deiner Quellgruppe (aus <code>result.json</code>) ist, löst er Dateien automatisch per <code>copyMessage</code> auf und speichert die File-ID in D1.' +
                '</p>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
                  '<button class="btn ' + (dMode === 'dm' ? 'active' : '') + '" onclick="saveDeliveryPreferencesClient({targetMode:\\'dm\\'});loadSettingsView()">💬 Standard: Bot-Privatchat</button>' +
                  '<button class="btn ' + (dMode === 'group' ? 'active' : '') + '" onclick="saveDeliveryPreferencesClient({targetMode:\\'group\\'});loadSettingsView()">👥 Standard: Eigene Ziel-Gruppe</button>' +
                  '<button class="btn ' + (dMode === 'custom_bot' ? 'active' : '') + '" onclick="saveDeliveryPreferencesClient({targetMode:\\'custom_bot\\'});loadSettingsView()">🤖 Standard: Eigener Bot-Token</button>' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:10px">' +
                  '<div>' +
                    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">👥 Ziel-Gruppen Chat-ID (z.B. -100...):</div>' +
                    '<input id="settingsTargetGroupIdInp" value="' + esc(deliv.targetGroupChatId || '') + '" placeholder="-1001234567890" style="width:100%;padding:7px 9px;border-radius:8px;background:var(--bg-elevated);color:var(--text);border:1px solid rgba(255,255,255,0.14);font-size:12px" />' +
                  '</div>' +
                  '<div>' +
                    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">🧵 Topic / Thread-ID in Ziel-Gruppe (optional):</div>' +
                    '<input id="settingsTargetTopicIdInp" value="' + esc(deliv.targetTopicId || '') + '" placeholder="z.B. 42" style="width:100%;padding:7px 9px;border-radius:8px;background:var(--bg-elevated);color:var(--text);border:1px solid rgba(255,255,255,0.14);font-size:12px" />' +
                  '</div>' +
                  '<div>' +
                    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">📦 Quellgruppen-ID (Bridge für result.json):</div>' +
                    '<input id="settingsSourceBridgeIdInp" value="' + esc(deliv.sourceBridgeChatId || '') + '" placeholder="Auto (-100...) oder überschreiben" style="width:100%;padding:7px 9px;border-radius:8px;background:var(--bg-elevated);color:var(--text);border:1px solid rgba(255,255,255,0.14);font-size:12px" />' +
                  '</div>' +
                  '<div>' +
                    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">🤖 Eigenes Bot-Token (@BotFather, optional):</div>' +
                    '<input id="settingsCustomBotTokenInp" type="password" value="' + esc(deliv.customBotToken || '') + '" placeholder="123456789:ABCdef..." style="width:100%;padding:7px 9px;border-radius:8px;background:var(--bg-elevated);color:var(--text);border:1px solid rgba(255,255,255,0.14);font-size:12px" />' +
                  '</div>' +
                '</div>' +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                  '<button class="btn green" onclick="verifyAndConnectCustomBotInSettingsClient()">💾 Speichern & optionalen Bot-Webhook verbinden</button>' +
                  '<span style="font-size:11px;color:var(--text-muted)">Webhook-Endpunkt: <code>' + esc(customHookUrl) + '</code></span>' +
                '</div>' +
                '<div id="customBotVerifyStatus" style="font-size:12px;color:#38bdf8;margin-top:6px">' +
                  (deliv.customBotUsername ? ('✅ Aktiver eigener Bot: @' + esc(deliv.customBotUsername)) : '') +
                '</div>' +
                '<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08)">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
                    '<div>' +
                      '<div style="font-size:12px;font-weight:700;color:var(--text)">🧹 Retention Policy (KV-Performance & Log-Aufbewahrung)</div>' +
                      '<div style="font-size:11px;color:var(--text-muted)">Bereinigt Zustell- & Fehler-Logs älter als 7, 30 oder 90 Tage automatisch via KV <code>expirationTtl</code>.</div>' +
                    '</div>' +
                    '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                      '<button type="button" class="btn ' + (Number(deliv.retentionDays || 30) === 7 ? 'active' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setTmaRetentionPolicyClient(7)">7 Tage</button>' +
                      '<button type="button" class="btn ' + (Number(deliv.retentionDays || 30) === 30 ? 'active' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setTmaRetentionPolicyClient(30)">30 Tage</button>' +
                      '<button type="button" class="btn ' + (Number(deliv.retentionDays || 30) === 90 ? 'active' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setTmaRetentionPolicyClient(90)">90 Tage</button>' +
                      '<button type="button" class="btn" style="padding:4px 8px;font-size:11px;color:#fb7185" onclick="clearTmaActivityLogClient()" title="Alle gespeicherten Telegram-Zustelllogs in KV sofort löschen">🗑️ Log leeren</button>' +
                    '</div>' +
                  '</div>' +
                  '<div style="font-size:10.5px;color:#38bdf8;margin-bottom:6px">⚡ Aktive KV-TTL: <code>' + (Number(deliv.retentionDays || 30) * 86400) + 's</code> (' + Number(deliv.retentionDays || 30) + ' Tage Auto-Prune in <code>env.MY_KV</code>)</div>' +
                  '<div id="tmaActivityLogMount"><div style="font-size:11px;color:var(--text-muted)">Lade letzte Zustell-Aktivitäten...</div></div>' +
                '</div>' +
              '</div>' +
              buildAntiSpamCockpitBoxHtmlClient();
            })() +

            '<div class="panel-box">' +
              '<div class="section-title">' +
                '<span>🧭 Steuerung, Maus-Hover & Slider-Einstellungen</span>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:8px">' +
                '<button id="settingsMouseHoverNavBtn" class="btn ' + (mouseHoverNavEnabled ? 'green' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleMouseHoverNav()">' +
                  '<span>🖱️ Maus-Hover Navigation (Mauszeiger verschiebt Auswahl)</span>' +
                  '<b>' + (mouseHoverNavEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>' +
                '</button>' +
                '<button id="settingsModalHoldNavBtn" class="btn ' + (modalHoldNavEnabled ? 'green' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleModalHoldNav()">' +
                  '<span>⏩ Detailansicht: Pfeiltaste ⬅️/➡️ gedrückt halten (~450ms) für nächsten/vorherigen Titel</span>' +
                  '<b>' + (modalHoldNavEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>' +
                '</button>' +
                '<button id="settingsHeroToggleBtn" class="btn ' + (!state.heroHidden ? 'green' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleHeroSliderHidden()">' +
                  '<span>🎬 Spotlight-Banner auf der Startseite</span>' +
                  '<b>' + (state.heroHidden ? 'AUSGEBLENDET' : 'SICHTBAR') + '</b>' +
                '</button>' +
              '</div>' +
            '</div>' +

            '<div class="panel-box">' +
              '<div class="section-title">' +
                '<span>⚡ Telegram-Bot Schnellbefehls-Übersicht</span>' +
                '<span style="font-size:11px;color:#38bdf8;font-weight:700">f = Film • s = Serie</span>' +
              '</div>' +
              '<p style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Nutze diese Kurzbefehle jederzeit direkt im Telegram-Bot-Chat (optional auch mit Genre dahinter, z. B. <code>/t f Action</code>):</p>' +
              '<div class="shortcut-cheat-grid">' +
                '<div class="shortcut-cheat-card"><b>🔥 Trending (Filme & Serien)</b><code>/t f   • /trnd f   • /trend f   • /trending f</code><br><code>/t s   • /trnd s   • /trend s   • /trending s</code></div>' +
                '<div class="shortcut-cheat-card"><b>🌟 Populär / Beliebt</b><code>/p f   • /pop f    • /popular f • /populär f</code><br><code>/p s   • /pop s    • /popular s • /populär s</code></div>' +
                '<div class="shortcut-cheat-card"><b>💎 Geheimtipps (Secret Gems)</b><code>/sc f  • /sec f    • /secret f  • /geheim f</code><br><code>/sc s  • /sec s    • /secret s  • /geheim s</code></div>' +
                '<div class="shortcut-cheat-card"><b>🎲 Zufalls-Tipp (mit Genre optional)</b><code>/r f   • /rand f   • /random f  • /r f Action</code><br><code>/r s   • /rand s   • /random s  • /r s Sci-Fi</code></div>' +
              '</div>' +
            '</div>' +

            '<div class="panel-box">' +
              '<div class="section-title">' +
                '<span>🎬 Instant-Trailer Provider (Direktwiedergabe aus der Übersicht)</span>' +
                '<span style="font-size:11.5px;color:var(--text-muted);font-weight:700">Aktiv: <b style="color:var(--text)">' + esc(getTrailerProviderLabel(trailerProvider)) + '</b></span>' +
              '</div>' +
              '<p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Wähle deinen bevorzugten Video-Anbieter, wenn du auf einer Film-/Serienkarte direkt auf <b>▶ Trailer</b> tippst:</p>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                TRAILER_PROVIDERS_CLIENT.map(tp =>
                  '<button class="btn ' + (trailerProvider === tp.id ? 'active' : '') + '" onclick="setTrailerProvider(\\'' + esc(tp.id) + '\\');loadSettingsView()">' + esc(tp.label) + (trailerProvider === tp.id ? ' ✓' : '') + '</button>'
                ).join("") +
              '</div>' +
            '</div>' +
            '<div class="panel-box">' +
              '<div class="section-title"><span>🛡️ Bot-Filter Cockpit (Steuerung über ✓ Positiv & ✕ Negativ)</span>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                  '<button class="btn red" onclick="restartApp()">🗑️ Alle Filter zurücksetzen</button>' +
                  '<button class="btn" onclick="goHome()">🏠 Zur Hauptseite</button>' +
                '</div>' +
              '</div>' +
              '<p style="font-size:12px;color:#aaa;margin-bottom:10px">Filter lassen sich gezielt über <b>✓ (Positiv)</b> und <b>✕ (Negativ)</b> schalten (der Text selbst ist nicht auswählbar). Ist ein Filter aktiv, gibt dessen Auswahl direkt <b>○ Neutral</b> vor, während daneben die Gegenoption wählbar bleibt.</p>' +
              (isCurrentUserVip() ? (
                '<div style="font-size:12.5px;font-weight:700;margin:8px 0 6px;color:#fbbf24">🌟 Exklusiver VIP-Stream Filter (#13):</div>' +
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
            (isAuth ? (
              '<div class="panel-box">' +
                '<div class="section-title"><span>🌐 Optionale TMDB-Konto Synchronisierung</span>' +
                  (sync.enabled ? '<span style="color:#34d399;font-size:12px">✅ Verbunden als ' + esc(sync.username || 'TMDB-User') + '</span>' : '<span style="color:#aaa;font-size:12px">Optional</span>') +
                '</div>' +
                '<p style="font-size:12px;color:#aaa;margin-bottom:10px">Verbinde optional dein persönliches TheMovieDB-Konto, um deine TMDB-Watchlist & Favoriten automatisch mit deiner Bot-Merkliste zu synchronisieren.</p>' +
                (sync.enabled ? (
                  '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                    '<button class="btn green" onclick="runTmdbSyncNow()">🔄 Jetzt Watchlist & Favoriten synchronisieren</button>' +
                    '<button class="btn red" onclick="disconnectTmdbSync()">🔌 TMDB-Verbindung trennen</button>' +
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

      // =========================================================================
      // ADMIN-PANEL: USER-LISTE, VIP-STATUS TOGGLE, SMART PLAYLIST MANAGER, FILM-CRUD & 100K+ BACKUP-IMPORTER
      // =========================================================================
      let backupImportJob = {
        fileName: "",
        fileSizeMb: "0",
        isTelegramBackup: false,
        backupChatName: "",
        backupChatId: "",
        backupChatUsername: "",
        rawMessageCount: 0,
        repaired: false,
        repairNotes: [],
        detectedMoviesCount: 0,
        detectedSeriesCount: 0,
        duplicatesSkippedInFile: 0,
        qualityVariantsInFile: 0,
        previewSamples: [],
        customPlaylistName: "",
        playlistMode: "both",
        targetPlaylistChatId: "",
        playlistFolderId: "",
        entries: [],
        cursor: 0,
        moviesSaved: 0,
        seriesSaved: 0,
        duplicatesInDb: 0,
        mergedQualitiesInDb: 0,
        uncertainCount: 0,
        failedCount: 0,
        running: false,
        paused: false,
        startedAt: 0,
        recentLog: [],
        livePosterFeed: [],
        reviewItems: [],
        activeSubTab: "dashboard",
        reviewFilter: "needs_attention"
      };

      function flattenClientTgText(tf) {
        if (!tf) return "";
        if (typeof tf === "string") return tf.trim();
        if (Array.isArray(tf)) {
          return tf.map(p => typeof p === "string" ? p : (p && typeof p.text === "string" ? p.text : "")).join("").trim();
        }
        return "";
      }

      function normalizeClientCompareTitle(str) {
        return String(str || "")
          .toLowerCase()
          .replace(/ä/g, "ae")
          .replace(/ö/g, "oe")
          .replace(/ü/g, "ue")
          .replace(/ß/g, "ss")
          .replace(/[^a-z0-9\\s]/g, " ")
          .replace(/\\b(?:der|die|das|the|a|an|ein|eine)\\b/g, " ")
          .replace(/\\s+/g, " ")
          .trim();
      }

      const CLIENT_SERIES_ALIASES = {
        "ahs": "American Horror Story",
        "adtdwv": "Als die Tiere den Wald verließen",
        "gzsz": "Gute Zeiten, schlechte Zeiten",
        "dsds": "Deutschland sucht den Superstar",
        "gntm": "Germany's Next Topmodel",
        "jacob 2 2": "Jacob 2/2",
        "ps profis": "Die PS-Profis",
        "die ps profis": "Die PS-Profis",
        "axel wills wissen": "Axel! will's wissen",
        "axel will's wissen": "Axel! will's wissen",
        "axel! wills wissen": "Axel! will's wissen",
        "maxe baumann": "Maxe Baumann",
        "buffy": "Buffy the Vampire Slayer",
        "himym": "How I Met Your Mother",
        "got": "Game of Thrones",
        "twd": "The Walking Dead",
        "tbbt": "The Big Bang Theory",
        "haus des geldes": "Money Heist",
        "stawaepideauskywa1080": "Star Wars: Der Aufstieg Skywalkers",
        "stawaepideauskywa": "Star Wars: Der Aufstieg Skywalkers",
        "pso bw bd": "Black Widow",
        "pso-bw bd": "Black Widow",
        "pso bw": "Black Widow",
        "saw 1": "Saw",
        "saw 1 - wessen blut wird fliessen": "Saw",
        "saw 1 - wessen blut wird fließen": "Saw",
        "saw 7": "Saw 3D - Vollendung",
        "saw 7 - vollendung": "Saw 3D - Vollendung",
        "saw 7 vollendung": "Saw 3D - Vollendung",
        "kingsman 3 the beginning": "The King's Man: The Beginning",
        "kingsman 3 - the beginning": "The King's Man: The Beginning",
        "kingsman 3": "The King's Man: The Beginning",
        "pirates of the caribbean 3": "Pirates of the Caribbean - Am Ende der Welt",
        "pirates of the caribbean 4": "Pirates of the Caribbean - Fremde Gezeiten",
        "fluch der karibik 3": "Pirates of the Caribbean - Am Ende der Welt",
        "fluch der karibik 4": "Pirates of the Caribbean - Fremde Gezeiten",
        "professor t": "Professor T.",
        "9 1 2 wochen": "9½ Wochen",
        "9 1/2 wochen": "9½ Wochen",
        "e.t.": "E.T. – Der Außerirdische",
        "e.t": "E.T. – Der Außerirdische",
        "e t": "E.T. – Der Außerirdische",
        "et": "E.T. – Der Außerirdische",
        "e.t. der ausserirdische": "E.T. – Der Außerirdische",
        "e.t. der außerirdische": "E.T. – Der Außerirdische",
        "e.t. - der ausserirdische": "E.T. – Der Außerirdische",
        "e.t. - der außerirdische": "E.T. – Der Außerirdische",
        "et der ausserirdische": "E.T. – Der Außerirdische",
        "et der außerirdische": "E.T. – Der Außerirdische"
      };

      function detectClientVideoQuality(msg, rawText, rawFileName) {
        const w = Number(msg?.width || msg?.video?.width || 0);
        const h = Number(msg?.height || msg?.video?.height || 0);
        if (w > 0 || h > 0) {
          if (w >= 3800 || h >= 2100) return "2160p";
          if (w >= 1900 || h >= 1000) return "1080p";
          if (w >= 1200 || h >= 700)  return "720p";
          if (w >= 600  || h >= 340)  return "480p";
          return "360p";
        }
        const combined = ((rawText || "") + " " + (rawFileName || "")).toLowerCase();
        if (/\\b(2160p|4k|uhd)\\b/.test(combined)) return "2160p";
        if (/\\b(1080p|fhd|fullhd)\\b/.test(combined)) return "1080p";
        if (/\\b(720p|hd)\\b/.test(combined)) return "720p";
        if (/\\b(480p|576p|sd|dvdrip)\\b/.test(combined)) return "480p";
        return null;
      }

      function getCleanClientContentLines(normalizedText) {
        return String(normalizedText || "")
          .split(/\\r?\\n/)
          .map(l => l.trim())
          .filter(l => {
            if (!l) return false;
            if (/^(?:weitergeleitet|forwarded|kanal|channel|quelle|source|join|abonniert|size|größe|groesse|dateigröße|runtime|laufzeit|dauer|länge|laenge|erscheinungsjahr|produktionsland|genre|gener|studio|regie|director|darsteller|actors|cast|fsk|imdb|tmdb|rating|bewertung|audio|format|codec|sprache|language|untertitel|subtitles|released|preis|free|kostenlos)\\b/i.test(l)) return false;
            if (/^(?:[🔞➕+\\s]*(?:12|16|18)\\+?|ab\\s+\\d+\\s+jahren|fsk\\s*\\d+|\\d+(?:[.,]\\d+)?\\s*(?:mb|gb|tb|min|minuten))$/i.test(l)) return false;
            const stripped = l
              .replace(/https?:\\/\\/\\S+/gi, "")
              .replace(/[@#][A-Za-z0-9_äöüÄÖÜß]+/g, "")
              .replace(/[\\u{1F1E6}-\\u{1F1FF}]{2}/gu, "")
              .replace(/[^A-Za-z0-9äöüÄÖÜß]/g, "");
            return stripped.length >= 2 && !/^(?:18|16|12|fsk18|fsk16|fsk12|hd|uhd|4k)$/i.test(stripped);
          });
      }

      function classifyClientJunkReason(msg) {
        if (!msg || typeof msg !== "object") return "🎭 Ungültige Nachricht übersprungen";
        if (msg.type && msg.type !== "message") return "🎭 Service-Nachricht übersprungen";
        const mType = String(msg.media_type || "").toLowerCase();
        if (mType === "sticker" || mType === "animation" || mType === "voice_message" || mType === "audio_file" || mType === "video_message") {
          return "🎭 Sticker / Animation / Sprachnachricht übersprungen";
        }
        const fName = String(msg.file_name || msg.file || "").toLowerCase().trim();
        if (fName === "sticker.webp" || fName.endsWith(".webp") || fName.endsWith(".tgs") || fName.endsWith(".gif.mp4") || fName.endsWith(".gif")) {
          return "🎭 Sticker / GIF-Animation übersprungen";
        }
        // .rar und .partXX.rar sind als eigene Kategorie ("📦 RAR-Archiv") erlaubt!
        if (/\\.rar$/i.test(fName)) {
          return null;
        }
        // Untertitel (.srt, .vtt, .sub, .ass, .ssa) werden NICHT als Junk verworfen, sondern an das darüberliegende Video gebunden!
        if (/\\.(?:srt|vtt|sub|ass|ssa)$/i.test(fName)) {
          return null;
        }
        if (/\\.(?:idx|mp3|m4a|flac|ogg|wav|opus|aac|apk|exe|msi|dmg|iso|pdf|epub|mobi|txt|nfo|jpg|jpeg|png|zip|7z|tar|gz)$/i.test(fName)) {
          return "📄 Dokument / PDF / Audio / Bilddatei übersprungen";
        }
        const dur = Number(msg.duration_seconds || msg.duration || 0);
        const isVid = mType === "video_file" || /^video\\//i.test(msg.mime_type || "") || /\\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d)$/i.test(fName);
        const rawCap = flattenClientTgText(msg.text || msg.caption).slice(0, 220);
        const hasTrailerKeyword = /(?:^|[\\s._\\-(\\[])(?:kinotrailer|official\\s+trailer|offizieller\\s+trailer|teaser\\s+trailer|trailer\\s+(?:german|deutsch|englisch|english|hd|full\\s*hd|1080p|720p|4k)|trailer|teaser|coming\\s+soon|zwiastun|vorschau)(?=$|[\\s._\\-)\\]:])/i.test(fName) ||
          /^(?:trailer|teaser|coming\\s+soon)\\b/i.test(rawCap) ||
          /\\b(?:official\\s+trailer|offizieller\\s+trailer|kinotrailer|teaser\\s+trailer|trailer\\s+(?:german|deutsch)|(?:\\(|\\[)\\s*trailer\\b|coming\\s+soon)\\b/i.test(rawCap);
        if (hasTrailerKeyword && (!dur || dur < 900)) {
          return "🎬 Trailer / Teaser / Coming Soon übersprungen";
        }
        // Videos ohne "Trailer" im Namen sind ab 60 Sekunden erlaubt (rettet Star Wars: Die Mächte des Schicksals & One Piece Strohhut Theater!)
        if (isVid && dur > 0 && dur < 60) {
          return "🎭 Kurzclip (< 60s) übersprungen";
        }
        return null;
      }

      function isClientJunkOrSticker(msg) {
        return Boolean(classifyClientJunkReason(msg));
      }

      function extractClientPartInfo(rawText, rawFileName, durationSec = 0) {
        const rawFnStr = String(rawFileName || "").trim();
        const combinedRaw = (rawFnStr + " " + String(rawText || "")).trim();
        const isRar = /\\.rar$/i.test(rawFnStr) || /\\.part\\d+\\.rar\\b/i.test(combinedRaw);
        if (isRar) {
          const rarPartMatch = combinedRaw.match(/(?:\\.part|\\bpart)[\\s._-]*0*([1-9]\\d?)\\b/i);
          if (rarPartMatch) {
            const num = parseInt(rarPartMatch[1], 10);
            return { isMultiPart: true, isArchive: true, partNumber: num, partType: "RAR", partLabel: "RAR-PART" + num };
          }
          return { isMultiPart: false, isArchive: true, partNumber: 1, partType: "RAR", partLabel: "RAR" };
        }
        const fn = rawFnStr.replace(/(?:\\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d))+$/i, "");
        const combined = (fn + " " + String(rawText || "")).trim();
        const cdMatch = combined.match(/\\b(CD|Disc|Disk|DVD|Split)[\\s._-]*0*([1-9])\\b/i);
        if (cdMatch) {
          const num = parseInt(cdMatch[2], 10);
          return { isMultiPart: true, isArchive: false, partNumber: num, partType: "CD", partLabel: "CD " + num };
        }
        const splitMatch = fn.match(/(?:[-_.]|\\s)00([1-9])$/);
        if (splitMatch) {
          const num = parseInt(splitMatch[1], 10);
          return { isMultiPart: true, isArchive: false, partNumber: num, partType: "CD", partLabel: "CD " + num };
        }
        const partMatch = combined.match(/\\bPart[\\s._-]*0*([1-9])\\b/i);
        if (partMatch && (!durationSec || durationSec < 5000)) {
          const num = parseInt(partMatch[1], 10);
          return { isMultiPart: true, isArchive: false, partNumber: num, partType: "CD", partLabel: "CD " + num };
        }
        return null;
      }

      function normalizeClientEpisodeText(str) {
        if (!str) return "";
        let s = String(str)
          .replace(/%26/gi, "&")
          .replace(/%20/g, " ")
          .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
          .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
        s = Array.from(s).map(ch => {
          return (ch.charCodeAt(0) > 127 && !"äöüÄÖÜßéèêàáâóòôúùûíìîçñøåÆØÅ–—„“”’´‧·".includes(ch))
            ? ch.normalize("NFKD")
            : ch;
        }).join("");
        s = s.replace(/[\\p{Script=Arabic}\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF،؛؟]+/gu, " ")
          .replace(/󠄿/g, "")
          .replace(/_/g, " ")
          .replace(/[\\u00A0 \\t]+/g, " ");
        // Senkrechte Striche als römische Zahlen am Wortende umwandeln ("Creed |||" -> "Creed III")
        s = s.replace(/(?<=[A-Za-zÄÖÜäöüß])\\s+(\\|{2,3})(?=$|[\\s)\\]._-])/g, (_, pipes) => pipes.length === 3 ? " III" : " II");
        // Regel 1: Episoden-Muster in S01E01 umwandeln
        s = s.replace(/\\b(?:Staffel|Season)\\s*0*(\\d{1,2})\\s*(?:[-–,·‧:|\\/]|\\s)+\\s*(?:Folge|Episode|Ep\\.?)\\s*0*(\\d{1,3})(?!\\s*[-–]\\s*\\d{1,3})\\b/gi, (_, st, ep) => "S" + String(st).padStart(2, "0") + "E" + String(ep).padStart(2, "0"));
        s = s.replace(/\\bS0*(\\d{1,2})\\s*[-–]\\s*E0*(\\d{1,3})\\b/gi, (_, st, ep) => "S" + String(st).padStart(2, "0") + "E" + String(ep).padStart(2, "0"));
        s = s.replace(/\\bS0*(\\d{1,2})\\s+E0*(\\d{1,3})\\b/gi, (_, st, ep) => "S" + String(st).padStart(2, "0") + "E" + String(ep).padStart(2, "0"));
        s = s.replace(/(?<![\\d.])\\b0*(\\d{1,2})x0*(\\d{2,3})\\b(?![\\d.])/gi, (_, st, ep) => {
          const stNum = parseInt(st, 10);
          const epNum = parseInt(ep, 10);
          if (stNum >= 1 && stNum <= 40 && epNum >= 1 && epNum <= 250) {
            return "S" + String(stNum).padStart(2, "0") + "E" + String(epNum).padStart(2, "0");
          }
          return _;
        });
        // E01S01 / E01S02 strikt umkehren (E01 ist Episode 1, S02 ist Staffel 2 -> S$2E$1)
        s = s.replace(/\\bE0*(\\d{1,3})[\\s._-]*S0*(\\d{1,2})\\b/gi, (_, epNum, sNum) => {
          const season = parseInt(sNum, 10) || 1;
          const episode = parseInt(epNum, 10) || 1;
          return "S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0");
        });
        // Mittelpunkt-Episodenschema: "Maxe Baumann · 01 Ferien ohne Ende" -> "Maxe Baumann S01E01 Ferien ohne Ende"
        s = s.replace(/([A-Za-zÄÖÜäöüß]{2,})\\s+[·‧•]\\s+0*(\\d{1,2})\\s+([A-Za-zÄÖÜäöüß])/g, (_, name, ep, nextChar) => {
          return name + " S01E" + String(ep).padStart(2, "0") + " " + nextChar;
        });
        // "Strohhut Theater 1 - Chopper Man" -> "Strohhut Theater S01E01 - Chopper Man" & "Folgen 1 - 10" -> "S01E01-E10"
        s = s.replace(/\\b(Strohhut[\\s._-]+Theater)[\\s._-]+0*([1-9]\\d?)\\b/gi, (_, name, ep) => {
          return name + " S01E" + String(parseInt(ep, 10)).padStart(2, "0");
        });
        s = s.replace(/\\b(?:Folgen|Folge|Episoden|Episodes)[\\s._-]*0*(\\d{1,3})\\s*[-–]\\s*0*(\\d{1,3})\\b/gi, (_, ep1, ep2) => {
          return "S01E" + String(parseInt(ep1, 10)).padStart(2, "0") + "-E" + String(parseInt(ep2, 10)).padStart(2, "0");
        });
        return s;
      }

      function cleanClientMediaTitle(raw) {
        if (!raw) return "";
        let t = normalizeClientEpisodeText(raw)
          .replace(/(?:\\.part0*\\d{1,2})?(?:\\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d|rar|json))+$/i, "");
        t = t.replace(/\\(\\s*\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\s*\\)/g, " ");
        t = t.replace(/\\b\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\b/g, " ");
        if ((t.match(/\\./g) || []).length >= 2 && !t.includes(" ") && !/^e\\.t\\.?$/i.test(t.trim())) {
          t = t.replace(/\\./g, " ");
        }
        t = t.replace(/(?<![A-Za-zÄÖÜäöüß0-9])(?:ger|deu|german|deutsch|eng|english|englisch|jap|jpn|fr|fra|es|spa|it|ita|tr|tur|ru|rus)[\\s._-]+(?:ger|deu|eng|jap|jpn|fr|es|it|tr|ru)[\\s._-]+(?:sub|subs|dub|dubbed)(?![A-Za-zÄÖÜäöüß0-9])/gi, " ");
        t = t.replace(/(?<![A-Za-zÄÖÜäöüß0-9])(?:ger|deu|german|deutsch|eng|english|englisch|jap|jpn|japanisch|fr|fra|es|spa|it|ita|tr|tur|ru|rus)[\\s._-]+(?:sub|subs|ut|untertitel|dub|dubbed|forced)(?![A-Za-zÄÖÜäöüß0-9])/gi, " ");
        t = t.replace(/(?:AC3|AAC|DTS|DD5\\.?1)?[\\s._-]*(?:CD|Disc|Disk|DVD|Split)[\\s._-]*0*[1-9]\\b/gi, " ");
        t = t.replace(/(?:^|[\\s._\\-(])Part[\\s._-]*0*([1-9]\\d?)(?:$|[\\s._\\-)])/gi, " ");
        t = t.replace(/(?:[-_.]|\\s)00[1-9]\\b/g, " ");
        t = t.replace(/[\\u{1F1E6}-\\u{1F1FF}]{2}/gu, "");
        t = t.replace(/[《》«»⟨⟩]/g, " ");
        t = t.replace(/^[🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎➡️▶️🍿⭐️❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️\\s]+/gu, "");
        t = t.replace(/[↩️🔠🔢⤴️⬅️➡️🎦]+.*$/gu, "");
        t = t.replace(/[\\p{Emoji_Presentation}\\p{Extended_Pictographic}🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎🩸❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️]/gu, " ");
        t = t.replace(/@[A-Za-z0-9_]+/g, "");
        t = t.replace(/#(?:gutfilm|archemovie|filmwelt|weltderfilme|sauerkraut|hd|fullhd|fhd|uhd|4k|1080p|720p|480p|deutsch|german|kino|serie|serien|film|filme|neu|new|stream|download|vip|ov|omu|horror|action|comedy|thriller|drama|scifi|fantasy|anime)\\b/gi, " ");
        t = t.replace(/#(?=[A-Za-zÄÖÜäöüß0-9])/g, " ");
        t = t.replace(/s[\\._]to\\s*-?\\s*Serien.*/i, "").replace(/Sto\\s*-\\s*Serien.*/i, "");
        t = t.replace(/serien[\\._](?:life|show).*/i, "").replace(/HD\\s*Filme\\s*Serien.*/i, "");
        t = t.replace(/^(?:Title|Titel)\\s*:\\s*/i, "").replace(/^(?:vs-|cd-|spy-|d-|4sf-|arc-|tvp-)/i, "");
        t = t.replace(/^(?:disney'?s|disneys|marvel'?s|marvels|pixar'?s|pixars)\\s+/i, "");
        t = t.replace(/^(?:s\\d{1,2}[\\s._-]*e\\d{1,3}|e\\d{1,3}[\\s._-]*s\\d{1,2}|\\d{1,2}x\\d{1,3})\\b[\\s._\\-–:]*/i, "");
        t = t.replace(/\\bS\\d{1,2}\\s*E\\d{0,3}(?=[A-Za-z]|\\b)/gi, " ");
        t = t.replace(/\\b\\d{3,4}\\s*[x×]\\s*\\d{3,4}\\b/g, "");
        t = t.replace(/(?<![A-Za-zÄÖÜäöüß0-9])(?:super[\\s._-]*duper[\\s._-]*cut|extended[\\s._-]*director'?s?[\\s._-]*cut|(?:extended|director'?s?|director’s|theatrical|ultimate|final|special|unrated|uncut|recut|producer'?s?|television|tv|fan|snyder|remastered|restored|collector'?s?|collector’s|anniversary|limited|deluxe|diamond|platinum|imax|open[\\s._-]*matte|international|rough|workprint)[\\s._-]*(?:cut|edition|version|fassung|ed\\.?)|(?:kino|lang|kurz|fernseh|tv|schnitt|rohschnitt|farb|original|alternativ|jubiläums|jubilaeums|directors|extended|uncut|unrated)[\\s._-]*(?:fassung|version|edition|cut)|(?:4k[\\s._-]*)?(?:digitally[\\s._-]*)?(?:remastered|restored)|mastered[\\s._-]*in[\\s._-]*4k|open[\\s._-]*matte|3d|hsbs|sbs|hou)(?![A-Za-zÄÖÜäöüß0-9])/gi, " ");
        t = t.replace(/(?<![A-Za-zÄÖÜäöüß0-9])(1080p|720p|2160p|480p|4k|uhd|h265|h264|x264|x265|hevc|av1|10bit|de-en|en-de|de-fr|fr-de|de-es|es-de|de-it|it-de|de-tr|tr-de|de-ru|ru-de|de-ja|de-jp|german|deutsch|germany|deu|ger|englisch|english|eng|französisch|franzoesisch|french|fra|fre|vff|vf|(?<!grundkurs\\s+)(?:spanisch|spanish)|spa|esp|castellano|latino|italienisch|italian|ita|türkisch|tuerkisch|turkish|tur|russisch|russian|rus|japanisch|japanese|jap|jpn|koreanisch|korean|kor|dl|dual[\\s._-]*audio|dual|multi|multilang|(?<!world\\s+wide\\s+)web|web-dl|webrip|bluray|bdrip|dvdrip|remux|fullhd|fhd|microhd(?:\\s*720|\\s*1080)?|hd|sd|dt__ov|dt[\\s._-]*ov|ov|omu|omeu|oton|originalton|gerdub|engdub|japdub|gersub|engsub|softsub|hardsub|subbed|forced|germanforced|extended[\\s._-]*cut|director'?s?[\\s._-]*cut|theatrical[\\s._-]*cut|ultimate[\\s._-]*cut|final[\\s._-]*cut|special[\\s._-]*(?:cut|edition)|collector'?s?[\\s._-]*edition|extended[\\s._-]*(?:edition|version)|uncut[\\s._-]*(?:edition|version)?|unrated[\\s._-]*(?:cut|edition|version)?|farbfassung|langfassung|kinofassung|fernsehfassung|schnittfassung|remastered|restored|uncut|unrated|extended|recut|ac3|aac|6ch|limited|mp4|mkv|avi|m4v|flv|mk3d|archemovie|gutfilm|filmwelt|weltderfilme|sauerkraut|wayne|wvf|dollhead|empir|tvnation|contribution|vivo|watch)(?![A-Za-zÄÖÜäöüß0-9])/gi, " ");
        t = t.replace(/[\\(\\[]\\s*(?:the\\s+)?(?:cut|dc|edition|version|fassung)\\s*[\\)\\]]/gi, " ");
        t = t.replace(/[\\(\\[]\\s*(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s*[\\)\\]]/gi, " ");
        t = t.replace(/^(.{2,}?)\\s+(?:[-–:]\\s*)?(?:the\\s+)?(?:cut|edition|version|fassung|redux)\\s*$/i, "$1");
        t = t.replace(/\\s*[-–:]\\s*(?:the|der|die|das)\\s*$/i, "");
        t = t.replace(/(?:[\\(\\[_-]\\s*(?:DE|EN|FR|ES|IT|TR|RU|JA|KO)\\s*[\\)\\]]?|\\s+(?:DE|EN|FR|ES|IT|TR|RU|JA|KO)(?=\\s*$))/g, " ");
        t = t.replace(/^(?:\\d{1,4}\\.\\s+|0\\d\\s*[-–]\\s+)/, "").replace(/-\\d{3}$/, "");
        t = t.replace(/\\(\\s*\\)|\\[\\s*\\]/g, "");
        t = t.replace(/\\s+/g, " ").replace(/^[\\s\\-–·‧:.,#"=|⎪&]+|[\\s\\-–·‧:.,#"=|⎪&]+$/g, "");
        if (/^(?:[A-Za-zÄÖÜäöüß]\\s+){3,}[A-Za-zÄÖÜäöüß]$/.test(t)) {
          t = t.replace(/\\s+/g, "");
        }
        t = t.replace(/\\b([A-Za-zÄÖÜäöüß]{3,})\\s+\\1\\b/gi, "$1");
        const openParens = (t.match(/\\(/g) || []).length;
        const closeParens = (t.match(/\\)/g) || []).length;
        if (openParens > closeParens) t = t.replace(/\\(/g, "");
        if (closeParens > openParens) t = t.replace(/\\)/g, "");
        t = t.replace(/\\s+/g, " ").trim();
        if (!/[A-Za-zÄÖÜäöüß0-9]/.test(t)) return "";
        if (/^(?:video|vmp4|new+|file|clip|movie|stream)$/i.test(t)) return "";
        const lower = t.toLowerCase();
        if (CLIENT_SERIES_ALIASES[lower]) return CLIENT_SERIES_ALIASES[lower];
        const prefixKey = lower.split(/\\s*[-–]\\s*/)[0];
        if (CLIENT_SERIES_ALIASES[prefixKey]) return CLIENT_SERIES_ALIASES[prefixKey];
        return t;
      }

      function parseClientMediaPreview(rawFilenameOrTitle, durationSec = 0, msgObj = null) {
        const raw = String(rawFilenameOrTitle || "").trim();
        const rawCapText = msgObj && typeof msgObj === "object" ? String(msgObj.raw_text || msgObj.text || msgObj.caption || "") : "";
        const isRarArchive = /\\.rar$/i.test(raw) || /\\.rar$/i.test(String(msgObj?.raw_file_name || msgObj?.file_name || "")) || /\\.part\\d+\\.rar\\b/i.test(raw + " " + rawCapText);
        let withoutExt = normalizeClientEpisodeText(raw).replace(/(?:\\.part0*\\d{1,2})?(?:\\.(?:mp4|mkv|avi|mov|webm|m4v|ts|flv|wmv|mk3d|rar|json))+$/i, "");
        withoutExt = withoutExt.replace(/\\(\\s*\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\s*\\)/g, " ").replace(/\\b\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\b/g, " ");
        let quality = detectClientVideoQuality(msgObj, withoutExt, raw);
        let codec = isRarArchive ? "RAR" : "x264";
        const cm = !isRarArchive ? withoutExt.match(/\\b(x265|h\\.?265|hevc|x264|h\\.?264|avc|av1)\\b/i) : null;
        if (cm) {
          const cLow = cm[1].toLowerCase().replace(/\\./g, "");
          codec = (cLow === "x265" || cLow === "h265" || cLow === "hevc") ? "x265" : (cLow === "av1" ? "AV1" : "x264");
        }
        const pInfo = extractClientPartInfo(rawCapText || raw, String(msgObj?.raw_file_name || msgObj?.file_name || raw), durationSec);
        let part = pInfo ? pInfo.partLabel : null;

        let isSeries = false;
        let season = null;
        let episode = null;
        let episodeTitle = "";
        let explicitTitle = null;

        const hashStaffelFull = withoutExt.match(/^(.+?)[_\\s]*#[_\\s]*S(\\d{1,2})E(\\d{1,3})[_\\s]*(?:[#\\-–]+[_\\s]*)(.+)$/i) ||
                                withoutExt.match(/^(.+?)[_\\s]*#[_\\s]*Staffel[_\\s]*(\\d{1,2})[_\\s,.\\-]*(?:Folge|Episode)[_\\s]*(\\d{1,3})[_\\s]*(?:[#\\-–]+[_\\s]*)(.+)$/i);
        const archeMatch = withoutExt.match(/^S(\\d{1,2})E(\\d{1,3})\\s*[-–]\\s*@\\w+\\s*[-–]\\s*(.+)$/i);
        const hashStaffelMatch = withoutExt.match(/^#?\\s*S(\\d{1,2})E(\\d{1,3})\\s*[-–]\\s*(.+)$/i);
        const epStaffelVonMatch = raw.match(/(?:Episode|Folge)[\\s._]*(\\d+)(?:[\\s._\\-&]+\\d+)?[\\s._\\-]*(?:Staffel|Season)[\\s._]*(\\d+)[\\s._\\-]*von[\\s._]+(.+?)(?:\\.mp4|\\.mkv|\\.avi|s_to_Serien|_sto_Serien|[\\s._]+(?:s[_. ]to|Sto|serien|HD|Online|❤)|$)/i) ||
                                  withoutExt.match(/(?:Episode|Folge)[\\s._]*(\\d{1,3})(?:[\\s._\\-&]+\\d{1,3})?[\\s._\\-]*(?:(?:\\(?Staffel[\\s._]*(\\d{1,2})\\)?)[\\s._\\-]*(?:von[\\s._]+)?|(?:von[\\s._]+))(.+?)(?:[\\s._]*\\(\\d{1,3}\\))?(?:s_to_Serien|_sto_Serien|[\\s._]+(?:s[_. ]to|Sto|serien|HD|Online|❤)|$)/i);
        const rawFileOnly = msgObj && typeof msgObj === "object"
          ? normalizeClientEpisodeText(String(msgObj.raw_file_name || msgObj.file_name || "").trim())
          : "";
        const fileExplicitSeMatch = rawFileOnly
          ? (rawFileOnly.match(/\\bS(\\d{1,2})[\\s._-]*E(\\d{1,3})(?:[-–]E?(\\d{1,3}))?\\b/i) ||
             rawFileOnly.match(/(?:Episode|Folge)[\\s._]*(\\d+)(?:[\\s._\\-&]+\\d+)?[\\s._\\-]*(?:Staffel|Season)[\\s._]*(\\d+)/i))
          : null;
        const seMatch = withoutExt.match(/\\bS(\\d{1,2})[\\s._-]*E(\\d{1,3})(?:[-–]E?(\\d{1,3}))?\\b/i);

        let cutIdx = withoutExt.length;
        if (hashStaffelFull) {
          isSeries = true;
          season = parseInt(hashStaffelFull[2], 10) || 1;
          episode = parseInt(hashStaffelFull[3], 10) || 1;
          episodeTitle = cleanClientMediaTitle(hashStaffelFull[1]);
          explicitTitle = hashStaffelFull[4];
        } else if (archeMatch) {
          isSeries = true;
          season = parseInt(archeMatch[1], 10) || 1;
          episode = parseInt(archeMatch[2], 10) || 1;
          explicitTitle = archeMatch[3];
        } else if (hashStaffelMatch) {
          isSeries = true;
          season = parseInt(hashStaffelMatch[1], 10) || 1;
          episode = parseInt(hashStaffelMatch[2], 10) || 1;
          explicitTitle = hashStaffelMatch[3];
        } else if (epStaffelVonMatch) {
          isSeries = true;
          episode = parseInt(epStaffelVonMatch[1], 10) || 1;
          season = epStaffelVonMatch[2] ? parseInt(epStaffelVonMatch[2], 10) : 1;
          explicitTitle = epStaffelVonMatch[3].replace(/_/g, " ").trim();
          if (msgObj && typeof msgObj === "object" && msgObj.pre_context) {
            msgObj.pre_context.seriesHeader = cleanClientMediaTitle(explicitTitle) || explicitTitle;
          }
        } else if (seMatch) {
          isSeries = true;
          season = parseInt(seMatch[1], 10) || 1;
          episode = parseInt(seMatch[2], 10) || 1;
          const afterRaw = withoutExt.slice(seMatch.index + seMatch[0].length).replace(/^[\\s._\\-–:·‧|⎪=]+/, "");
          if (seMatch.index === 0) {
            // Fall E01S01 Frontier 2016: S01E01 steht am Anfang, danach folgt der Serienname (+ ggf. Jahr)
            withoutExt = afterRaw;
            cutIdx = withoutExt.length;
            explicitTitle = afterRaw;
          } else {
            if (afterRaw) {
              const eqMatch = afterRaw.match(/^=\\s*([^=]+?)\\s*=/);
              episodeTitle = cleanClientMediaTitle(eqMatch ? eqMatch[1] : afterRaw);
            }
            if (typeof seMatch.index === "number" && seMatch.index > 1) {
              cutIdx = Math.min(cutIdx, seMatch.index);
            }
          }
        } else {
          const epOnly = withoutExt.match(/\\b(?:Folge|Episode|Ep\\.?)\\s*0*(\\d{1,3})\\b/i);
