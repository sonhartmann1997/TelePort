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
            API_BASE + "/search?personId=" + encodeURIComponent(personId) +
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
        if (document.getElementById("modalRoot")?.innerHTML) {
          closeDetailModal();
        }
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

        // Hintergrund-Sync ohne Blockade (X-Tma-Settings Header überträgt den Filter bereits sofort mit dem Discover/Search-Aufruf!)
        apiFetchJson(API_BASE + "/settings", {
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
        }).catch(() => {});

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

      window._workerHealthMonitorState = window._workerHealthMonitorState || {
        history: [],
        lastCpuMs: 0.9,
        lastWallMs: 38,
        lastSubrequests: 1,
        lastD1Ops: 1,
        lastRoute: "/api/tma/discover",
        status: "healthy",
        throttled: false,
        recommendedBatchSize: 5,
        cooldownUntil: 0,
        throttleReason: ""
      };

      function recordClientWorkerHealthSample(sample) {
        const st = window._workerHealthMonitorState;
        const cpuMs = Math.max(0.2, Math.min(25, Number(sample?.cpuMs ?? 1.1)));
        const wallMs = Math.max(5, Math.round(Number(sample?.wallMs ?? 45)));
        const subrequests = Math.max(0, Number(sample?.subrequests ?? 0));
        const d1Ops = Math.max(0, Number(sample?.d1Ops ?? 0));
        const route = String(sample?.route || "/api/tma").replace("/api/tma", "") || "/";
        st.lastCpuMs = Number(cpuMs.toFixed(2));
        st.lastWallMs = wallMs;
        st.lastSubrequests = subrequests;
        st.lastD1Ops = d1Ops;
        st.lastRoute = route;

        if (sample?.forcedOverload || cpuMs >= 8.2) {
          st.status = "critical";
          st.throttled = true;
          st.recommendedBatchSize = 1;
          st.cooldownUntil = Date.now() + 2400;
          st.throttleReason = "CPU " + cpuMs.toFixed(1) + "ms nahe 10ms Free-Limit → Batch auf 1 gedrosselt + 2.4s Cooldown";
        } else if (cpuMs >= 6.8 || subrequests >= 14) {
          st.status = "warning";
          st.throttled = true;
          st.recommendedBatchSize = 2;
          st.cooldownUntil = Date.now() + 1400;
          st.throttleReason = "CPU " + cpuMs.toFixed(1) + "ms (>=6.8ms) → Automatisch auf 2er Micro-Batch gedrosselt + 1.4s Cooldown";
        } else {
          st.status = "healthy";
          if (st.throttled && Date.now() > st.cooldownUntil) {
            st.recommendedBatchSize = Math.min(5, (st.recommendedBatchSize || 2) + 1);
            if (st.recommendedBatchSize >= 4) {
              st.throttled = false;
              st.throttleReason = "";
            }
          } else if (!st.throttled) {
            st.recommendedBatchSize = 5;
          }
        }

        st.history.push({
          ts: Date.now(),
          cpuMs: st.lastCpuMs,
          wallMs: st.lastWallMs,
          subrequests: st.lastSubrequests,
          d1Ops: st.lastD1Ops,
          route: st.lastRoute,
          status: st.status
        });
        if (st.history.length > 16) st.history.shift();
        if (typeof window.updateWorkerHealthMonitorDom === "function") {
          try { window.updateWorkerHealthMonitorDom(); } catch (e) {}
        }
      }

      window._clientApiGetCache = window._clientApiGetCache || new Map();
      window._clientApiInFlightGetMap = window._clientApiInFlightGetMap || new Map();

      const BROWSER_PERSISTENT_CACHE_PREFIX = "tma_api_p_v1_";
      const BROWSER_PERSISTENT_CACHE_INDEX_KEY = "tma_api_p_v1_idx";
      const BROWSER_PERSISTENT_CACHE_MAX_ENTRIES = 120;
      const BROWSER_PERSISTENT_CACHE_MAX_BYTES = 65000;

      function extractBrowserApiPathClient(urlStr) {
        const raw = String(urlStr || "");
        const qIdx = raw.indexOf("?");
        return qIdx >= 0 ? raw.slice(0, qIdx) : raw;
      }

      function isFilterDependentApiRouteClient(urlStr) {
        const p = extractBrowserApiPathClient(urlStr);
        return (
          p.endsWith("/discover") ||
          p.endsWith("/search") ||
          p.endsWith("/collections") ||
          p.endsWith("/universes") ||
          p.endsWith("/similar")
        );
      }

      function isVipAwareApiRouteClient(urlStr) {
        const p = extractBrowserApiPathClient(urlStr);
        return (
          p.endsWith("/discover") ||
          p.endsWith("/search") ||
          p.endsWith("/collections") ||
          p.endsWith("/universes") ||
          p.endsWith("/similar") ||
          p.endsWith("/details") ||
          p.endsWith("/season") ||
          p.endsWith("/person")
        );
      }

      function isPersistentLocalStorageApiRouteClient(urlStr) {
        const p = extractBrowserApiPathClient(urlStr);
        return (
          p.endsWith("/logo") ||
          p.endsWith("/logos") ||
          p.endsWith("/translate") ||
          p.endsWith("/details") ||
          p.endsWith("/season") ||
          p.endsWith("/person") ||
          p.endsWith("/collections") ||
          p.endsWith("/universes") ||
          p.endsWith("/similar")
        );
      }

      function isSessionStorageApiRouteClient(urlStr) {
        const p = extractBrowserApiPathClient(urlStr);
        return p.endsWith("/discover") || p.endsWith("/search");
      }

      function isUserScopedApiRouteClient(urlStr) {
        const p = extractBrowserApiPathClient(urlStr);
        if (
          p.endsWith("/wishlist") ||
          p.endsWith("/reports") ||
          p.endsWith("/settings") ||
          p.includes("/admin/")
        ) {
          return true;
        }
        if (p.endsWith("/discover")) {
          // Seite 1 enthält nutzerspezifische savedKeys
          const raw = String(urlStr || "");
          const hasNonFirstPage = /[?&]page=([2-9]|[1-9][0-9]+)/.test(raw);
          return !hasNonFirstPage;
        }
        return false;
      }

      function canonicalizeBrowserApiUrlForCacheClient(urlStr) {
        const raw = String(urlStr || "");
        const qIdx = raw.indexOf("?");
        if (qIdx < 0) return raw;
        const pathPart = raw.slice(0, qIdx);
        const queryPart = raw.slice(qIdx + 1);
        const stripChatId = !isUserScopedApiRouteClient(raw) || pathPart.endsWith("/discover");
        try {
          const sp = new URLSearchParams(queryPart);
          if (stripChatId) sp.delete("chatId");
          const entries = [];
          sp.forEach((val, key) => {
            entries.push([key, val]);
          });
          entries.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1)));
          const rebuilt = entries.map(pair => encodeURIComponent(pair[0]) + "=" + encodeURIComponent(pair[1])).join("&");
          return rebuilt ? (pathPart + "?" + rebuilt) : pathPart;
        } catch (e) {
          return raw;
        }
      }

      function buildClientFilterHashForCacheClient(vipFlag) {
        try {
          const s = (state && state.settings && typeof state.settings === "object") ? state.settings : {};
          const filtersActive = s.filtersActive !== false;
          const showUnreleased = Boolean(s.showUnreleased);
          const onlyVipStreams = Boolean(vipFlag && s.onlyVipStreams);
          const normArr = (arr) => {
            if (!filtersActive || !Array.isArray(arr) || arr.length === 0) return "";
            const uniq = Array.from(new Set(arr.map(v => String(v == null ? "" : v).trim()).filter(Boolean))).sort();
            return uniq.join(",");
          };
          const parts = [
            filtersActive ? "1" : "0",
            showUnreleased ? "1" : "0",
            onlyVipStreams ? "1" : "0",
            normArr(s.includedFsk),
            normArr(s.excludedFsk),
            normArr(s.includedGenres),
            normArr(s.excludedGenres),
            normArr(s.includedEras),
            normArr(s.excludedEras),
            normArr(s.includedStudios),
            normArr(s.excludedStudios),
            normArr(s.includedPlatforms),
            normArr(s.excludedPlatforms)
          ];
          if (parts[0] === "1" && parts[1] === "0" && parts[2] === "0" && parts.slice(3).every(x => x === "")) {
            return "def";
          }
          const str = parts.join("|");
          let h = 2166136261;
          for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          return (h >>> 0).toString(36);
        } catch (e) {
          return "def";
        }
      }

      function hashBrowserCacheKeyClient(cacheKey) {
        let h1 = 2166136261;
        let h2 = 16777619;
        for (let i = 0; i < cacheKey.length; i++) {
          const c = cacheKey.charCodeAt(i);
          h1 = Math.imul(h1 ^ c, 16777619);
          h2 = Math.imul(h2 ^ (c + i), 2246822519);
        }
        return (h1 >>> 0).toString(36) + "_" + (h2 >>> 0).toString(36);
      }

      function buildBrowserApiCacheKeyClient(urlStr) {
        const raw = String(urlStr || "");
        const canonicalUrl = canonicalizeBrowserApiUrlForCacheClient(raw);
        const vipFlag = (typeof isCurrentUserVip === "function") ? Boolean(isCurrentUserVip()) : false;
        const segments = [canonicalUrl];
        if (isVipAwareApiRouteClient(raw)) {
          segments.push(vipFlag ? "v1" : "v0");
        }
        if (isFilterDependentApiRouteClient(raw)) {
          segments.push("f=" + buildClientFilterHashForCacheClient(vipFlag));
        }
        if (isUserScopedApiRouteClient(raw)) {
          const scopeUid = (state && state.isAuthenticated && state.authUser && state.authUser.telegramId)
            ? String(state.authUser.telegramId)
            : String(chatId || "guest");
          segments.push("u=" + scopeUid);
        }
        return segments.join("::");
      }

      function getBrowserApiCacheTtlMsClient(urlStr) {
        const u = String(urlStr || "");
        if (u.includes("refresh=1") || u.includes("mode=random")) return 0;
        const p = extractBrowserApiPathClient(u);
        if (p.endsWith("/logo") || p.endsWith("/logos") || p.endsWith("/translate")) {
          return 24 * 60 * 60 * 1000; // 24 Stunden persistent im Browser (statische Logos & Übersetzungen)
        }
        if (p.endsWith("/details") || p.endsWith("/season") || p.endsWith("/person")) {
          return 30 * 60 * 1000; // 30 Minuten persistent im Browser (0 Worker-Calls beim erneuten Öffnen!)
        }
        if (p.endsWith("/collections") || p.endsWith("/universes") || p.endsWith("/similar")) {
          return 20 * 60 * 1000; // 20 Minuten persistent im Browser
        }
        if (p.endsWith("/discover") || p.endsWith("/search")) {
          return 5 * 60 * 1000; // 5 Minuten im Session-/RAM-Cache
        }
        if (p.endsWith("/wishlist") || p.endsWith("/reports") || p.endsWith("/admin/overview") || p.endsWith("/admin/import-logs")) {
          return 22 * 1000; // 22 Sekunden Kurzzeit-Puffer gegen Doppel-Klicks
        }
        if (p.endsWith("/admin/catalog-preseed") || p.endsWith("/admin/tmdb-candidates")) {
          return 2 * 60 * 1000;
        }
        return 0;
      }

      function readPersistentCacheIndexClient() {
        try {
          const raw = localStorage.getItem(BROWSER_PERSISTENT_CACHE_INDEX_KEY);
          if (!raw) return [];
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          return [];
        }
      }

      function writePersistentCacheIndexClient(idxList) {
        try {
          localStorage.setItem(BROWSER_PERSISTENT_CACHE_INDEX_KEY, JSON.stringify(Array.isArray(idxList) ? idxList : []));
        } catch (e) {}
      }

      function clearPersistentBrowserApiCacheClient(predicateFn) {
        try {
          const hasPredicate = typeof predicateFn === "function";
          const idx = readPersistentCacheIndexClient();
          const kept = [];
          const seenKeys = new Set();
          for (const item of idx) {
            if (!item || !item.k) continue;
            seenKeys.add(item.k);
            const shouldRemove = !hasPredicate || predicateFn(String(item.r || ""), String(item.k || ""));
            if (shouldRemove) {
              try { localStorage.removeItem(item.k); } catch (e) {}
            } else {
              kept.push(item);
            }
          }
          if (!hasPredicate) {
            const strayKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
              const lk = localStorage.key(i);
              if (lk && lk.startsWith(BROWSER_PERSISTENT_CACHE_PREFIX)) strayKeys.push(lk);
            }
            for (const lk of strayKeys) {
              try { localStorage.removeItem(lk); } catch (e) {}
            }
            try { localStorage.removeItem(BROWSER_PERSISTENT_CACHE_INDEX_KEY); } catch (e) {}
          } else {
            writePersistentCacheIndexClient(kept);
          }
        } catch (e) {}
      }

      function readBrowserApiCacheEntryClient(cacheKey, urlStr) {
        const memMap = window._clientApiGetCache;
        if (memMap instanceof Map && memMap.has(cacheKey)) {
          return memMap.get(cacheKey);
        }
        const keyHash = hashBrowserCacheKeyClient(cacheKey);
        const rawUrl = String(urlStr || cacheKey || "");
        if (isPersistentLocalStorageApiRouteClient(rawUrl)) {
          try {
            const lsKey = BROWSER_PERSISTENT_CACHE_PREFIX + keyHash;
            const rawLs = localStorage.getItem(lsKey);
            if (rawLs) {
              const parsed = JSON.parse(rawLs);
              if (parsed && parsed.key === cacheKey && parsed.data) {
                if (parsed.exp && Date.now() > Number(parsed.exp)) {
                  try { localStorage.removeItem(lsKey); } catch (e) {}
                } else {
                  if (memMap instanceof Map) memMap.set(cacheKey, parsed);
                  return parsed;
                }
              }
            }
          } catch (e) {}
        }
        if (isSessionStorageApiRouteClient(rawUrl)) {
          try {
            const ssKey = "tma_api_c_" + keyHash;
            const raw = sessionStorage.getItem(ssKey);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && parsed.key === cacheKey && parsed.data) {
                if (memMap instanceof Map) memMap.set(cacheKey, parsed);
                return parsed;
              }
            }
          } catch (e) {}
        }
        return null;
      }

      function hasFreshBrowserApiCacheClient(urlStr) {
        const ttl = getBrowserApiCacheTtlMsClient(urlStr);
        if (ttl <= 0) return false;
        const key = buildBrowserApiCacheKeyClient(urlStr);
        const entry = readBrowserApiCacheEntryClient(key, urlStr);
        return Boolean(entry && entry.data && (Date.now() - Number(entry.ts || 0)) < ttl);
      }

      function writeBrowserApiCacheEntryClient(cacheKey, dataObj, urlStr) {
        if (!dataObj || dataObj.ok === false) return;
        const ttlMs = getBrowserApiCacheTtlMsClient(urlStr);
        if (ttlMs <= 0) return;
        const now = Date.now();
        const entry = { key: cacheKey, data: dataObj, ts: now, exp: now + ttlMs };
        const memMap = window._clientApiGetCache;
        if (memMap instanceof Map) {
          if (memMap.size > 260) {
            const oldestKey = memMap.keys().next().value;
            if (oldestKey) memMap.delete(oldestKey);
          }
          memMap.set(cacheKey, entry);
        }
        const u = String(urlStr || "");
        const keyHash = hashBrowserCacheKeyClient(cacheKey);
        if (isPersistentLocalStorageApiRouteClient(u)) {
          try {
            const serialized = JSON.stringify(entry);
            if (serialized.length <= BROWSER_PERSISTENT_CACHE_MAX_BYTES) {
              const lsKey = BROWSER_PERSISTENT_CACHE_PREFIX + keyHash;
              const routePath = extractBrowserApiPathClient(u);
              let idx = readPersistentCacheIndexClient().filter(it => {
                if (!it || !it.k) return false;
                if (it.k === lsKey) return false;
                if (it.exp && now > Number(it.exp)) {
                  try { localStorage.removeItem(it.k); } catch (e) {}
                  return false;
                }
                return true;
              });
              while (idx.length >= BROWSER_PERSISTENT_CACHE_MAX_ENTRIES) {
                const evicted = idx.shift();
                if (evicted && evicted.k) {
                  try { localStorage.removeItem(evicted.k); } catch (e) {}
                }
              }
              try {
                localStorage.setItem(lsKey, serialized);
              } catch (quotaErr) {
                // Bei QuotaExceededError älteste 25% aus dem LRU-Index entfernen und einmal neu versuchen
                const evictCount = Math.max(8, Math.ceil(idx.length * 0.25));
                for (let j = 0; j < evictCount && idx.length > 0; j++) {
                  const oldItem = idx.shift();
                  if (oldItem && oldItem.k) {
                    try { localStorage.removeItem(oldItem.k); } catch (e) {}
                  }
                }
                try { localStorage.setItem(lsKey, serialized); } catch (e2) {
                  writePersistentCacheIndexClient(idx);
                  return;
                }
              }
              idx.push({ k: lsKey, ts: now, exp: entry.exp, r: routePath });
              writePersistentCacheIndexClient(idx);
            }
          } catch (e) {}
          return;
        }
        if (isSessionStorageApiRouteClient(u)) {
          try {
            const ssKey = "tma_api_c_" + keyHash;
            sessionStorage.setItem(ssKey, JSON.stringify(entry));
          } catch (e) {}
        }
      }

      function getClientWorkerCircuitState() {
        if (!window._clientWorkerCircuitState || typeof window._clientWorkerCircuitState !== "object") {
          window._clientWorkerCircuitState = {
            consecutiveOverloads: 0,
            cooldownUntil: 0,
            lastStatus: 0
          };
        }
        return window._clientWorkerCircuitState;
      }

      async function refreshTmaSessionSingleFlight() {
        const now = Date.now();
        if (window._tmaAuthRefreshInFlight) {
          return window._tmaAuthRefreshInFlight;
        }
        if (Number(window._tmaLastAuthRefreshFailTs || 0) > 0 && (now - Number(window._tmaLastAuthRefreshFailTs)) < 5000) {
          return { ok: false, skippedCooldown: true };
        }
        const extractedInit = (typeof extractClientTelegramInitData === "function") ? extractClientTelegramInitData() : "";
        const extractedLaunch = (typeof extractClientTelegramLaunchToken === "function") ? extractClientTelegramLaunchToken() : "";
        const candidateInit = extractedInit || rawInitData || "";
        const candidateLaunch = extractedLaunch || rawLaunchToken || "";
        const usableInit = (candidateInit && candidateInit !== String(window._tmaDeadInitData || "")) ? candidateInit : "";
        const usableLaunch = (candidateLaunch && candidateLaunch !== String(window._tmaDeadLaunchToken || "")) ? candidateLaunch : "";
        if (!usableInit && !usableLaunch) {
          return { ok: false, noCredentials: true };
        }

        const refreshPromise = (async () => {
          const timeoutCtrl = new AbortController();
          const timer = setTimeout(() => {
            try { timeoutCtrl.abort(); } catch (e) {}
          }, 10000);
          try {
            const refreshHeaders = { "Content-Type": "application/json" };
            const isSafeHdr = (v) => typeof v === "string" && v.length > 0 && !/[^\\x00-\\xFF]/.test(v);
            if (isSafeHdr(usableInit)) refreshHeaders["X-Telegram-Init-Data"] = usableInit;
            if (isSafeHdr(usableLaunch)) refreshHeaders["X-Telegram-Launch-Token"] = usableLaunch;
            const res = await fetch(API_BASE + "/auth/init", {
              method: "POST",
              headers: refreshHeaders,
              body: JSON.stringify({ initData: usableInit, tgLaunch: usableLaunch }),
              cache: "no-store",
              signal: timeoutCtrl.signal
            });
            const text = await res.text();
            let parsed = null;
            try { parsed = JSON.parse(text); } catch (_e) { parsed = null; }
            if (res.ok && parsed && parsed.ok && parsed.sessionToken) {
              sessionToken = String(parsed.sessionToken);
              try { localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
              if (usableInit) rawInitData = usableInit;
              if (usableLaunch) rawLaunchToken = usableLaunch;
              window._tmaDeadInitData = "";
              window._tmaDeadLaunchToken = "";
              window._tmaLastAuthRefreshFailTs = 0;
              if (typeof state === "object" && state) {
                state.isAuthenticated = true;
                state.hasInitData = true;
                if (parsed.user) {
                  state.authUser = parsed.user;
                  if (parsed.user.telegramId) chatId = String(parsed.user.telegramId);
                }
              }
              if (typeof updateSyncBadge === "function") {
                try { updateSyncBadge(); } catch (e) {}
              }
              return { ok: true, sessionToken };
            }
            if (
              res.status === 401 ||
              res.status === 400 ||
              (parsed && (parsed.reasonCode === "INIT_DATA_EXPIRED" || parsed.reasonCode === "LAUNCH_TOKEN_INVALID"))
            ) {
              if (usableInit) {
                window._tmaDeadInitData = usableInit;
                if (rawInitData === usableInit) rawInitData = "";
              }
              if (usableLaunch) {
                window._tmaDeadLaunchToken = usableLaunch;
                if (rawLaunchToken === usableLaunch) rawLaunchToken = "";
              }
            }
            window._tmaLastAuthRefreshFailTs = Date.now();
            return { ok: false, status: res.status || 0 };
          } catch (_err) {
            window._tmaLastAuthRefreshFailTs = Date.now();
            return { ok: false, networkError: true };
          } finally {
            clearTimeout(timer);
          }
        })();

        window._tmaAuthRefreshInFlight = refreshPromise;
        try {
          return await refreshPromise;
        } finally {
          if (window._tmaAuthRefreshInFlight === refreshPromise) {
            window._tmaAuthRefreshInFlight = null;
          }
        }
      }

      async function apiFetchJson(url, opts = {}) {
        const method = String(opts.method || "GET").toUpperCase();
        const urlStr = String(url || "");
        const isImportBatch = urlStr.includes("/admin/import-batch") || urlStr.includes("/admin/ingest-inbox/flush");
        const isBackgroundImportAux = method !== "GET" && (urlStr.includes("/admin/import-logs") || urlStr.includes("/admin/import-checkpoint"));
        const circuitSt = getClientWorkerCircuitState();
        if (isBackgroundImportAux && circuitSt.cooldownUntil > Date.now()) {
          return {
            ok: false,
            skippedDueToCooldown: true,
            _httpStatus: 503,
            error: "Hintergrund-Sync pausiert (Worker-Cooldown aktiv)."
          };
        }
        const isGetRequest = method === "GET" && !opts.bypassCache;
        const cacheTtlMs = isGetRequest ? getBrowserApiCacheTtlMsClient(urlStr) : 0;
        const cacheKey = isGetRequest ? buildBrowserApiCacheKeyClient(urlStr) : "";
        let staleCacheEntry = null;

        if (isGetRequest && cacheKey) {
          const cached = readBrowserApiCacheEntryClient(cacheKey, urlStr);
          if (cached && cached.data) {
            staleCacheEntry = cached;
            if (cacheTtlMs > 0 && (Date.now() - Number(cached.ts || 0)) < cacheTtlMs) {
              return cached.data;
            }
          }
          const inFlightMap = window._clientApiInFlightGetMap;
          if (inFlightMap instanceof Map && inFlightMap.has(cacheKey) && !opts.signal) {
            return inFlightMap.get(cacheKey);
          }
        } else if (method !== "GET" && !isImportBatch && !isBackgroundImportAux) {
          // Gezielte Cache-Invalidierung bei Schreibzugriffen:
          // - /wishlist -> invalidiert /wishlist, /discover?page=1 (savedKeys) sowie /details & /season (isSaved)
          // - /settings -> invalidiert nur filter-abhängige Routen (NICHT /details, /season, /logo, /logos, /translate!)
          // - /admin/* -> invalidiert Medien- & Admin-Caches (NICHT /logo, /logos, /translate)
          const isWishlistMut = urlStr.includes("/wishlist");
          const isSettingsMut = urlStr.includes("/settings");
          const isAdminMut = urlStr.includes("/admin/");
          if (window._clientApiGetCache instanceof Map) {
            for (const k of Array.from(window._clientApiGetCache.keys())) {
              const shouldEvictRam =
                k.includes("/wishlist") ||
                k.includes("/admin/overview") ||
                k.includes("/admin/import-logs") ||
                (isWishlistMut && (k.includes("/details") || k.includes("/season") || k.includes("/discover"))) ||
                (isSettingsMut && (k.includes("/discover") || k.includes("/search") || k.includes("/collections") || k.includes("/universes") || k.includes("/similar") || k.includes("/settings"))) ||
                (isAdminMut && (k.includes("/details") || k.includes("/season") || k.includes("/discover") || k.includes("/reports")));
              if (shouldEvictRam) {
                window._clientApiGetCache.delete(k);
              }
            }
          }
          if (isWishlistMut || isAdminMut) {
            clearPersistentBrowserApiCacheClient((routePath) => (
              routePath.endsWith("/details") || routePath.endsWith("/season") || routePath.endsWith("/discover")
            ));
          }
        }

        const headers = { ...(opts.headers || {}) };
        if (!rawInitData && typeof extractClientTelegramInitData === "function") {
          const freshInit = extractClientTelegramInitData();
          if (freshInit && freshInit !== String(window._tmaDeadInitData || "")) {
            rawInitData = freshInit;
          }
        }
        const isHeaderSafeStr = (v) => typeof v === "string" && v.length > 0 && !/[^\\x00-\\xFF]/.test(v);
        if (isHeaderSafeStr(sessionToken)) headers["Authorization"] = "Bearer " + sessionToken;
        if (isHeaderSafeStr(rawInitData)) headers["X-Telegram-Init-Data"] = rawInitData;
        if (isHeaderSafeStr(rawLaunchToken)) {
          headers["X-Telegram-Launch-Token"] = rawLaunchToken;
        }
        if (isFilterDependentApiRouteClient(urlStr) && state.settings && Object.keys(state.settings).length > 0) {
          try {
            const hdrFilterObj = {
              filtersActive: state.settings.filtersActive,
              showUnreleased: state.settings.showUnreleased,
              onlyVipStreams: state.settings.onlyVipStreams,
              includedFsk: state.settings.includedFsk,
              excludedFsk: state.settings.excludedFsk,
              includedGenres: state.settings.includedGenres,
              excludedGenres: state.settings.excludedGenres,
              includedEras: state.settings.includedEras,
              excludedEras: state.settings.excludedEras,
              includedStudios: state.settings.includedStudios,
              excludedStudios: state.settings.excludedStudios,
              includedPlatforms: state.settings.includedPlatforms,
              excludedPlatforms: state.settings.excludedPlatforms,
              uiScale: state.settings.uiScale,
              trailerProvider: state.settings.trailerProvider
            };
            headers["X-Tma-Settings"] = encodeURIComponent(JSON.stringify(hdrFilterObj));
          } catch (e) {}
        }
        const timeoutMs = isImportBatch ? 24000 : 12000;
        const isInteractiveDuringImport = !isImportBatch && typeof backupImportJob !== "undefined" && backupImportJob && backupImportJob.running;
        if (isInteractiveDuringImport) {
          window._adminPriorityRequestInFlight = (Number(window._adminPriorityRequestInFlight || 0) + 1);
        }

        const executeNetworkFetchWithRetries = async () => {
          try {
            const doSingleFetch = async (isRetry = false, hasRefreshedAuth = false) => {
              const reqStartMs = Date.now();
              const sentBearerToken = sessionToken;
              const timeoutCtrl = new AbortController();
              const timer = setTimeout(() => {
                try { timeoutCtrl.abort(); } catch (e) {}
              }, timeoutMs);
              let onExternalAbort = null;
              if (opts.signal) {
                if (opts.signal.aborted) {
                  clearTimeout(timer);
                  throw new DOMException("Aborted", "AbortError");
                }
                onExternalAbort = () => {
                  clearTimeout(timer);
                  try { timeoutCtrl.abort(); } catch (e) {}
                };
                opts.signal.addEventListener("abort", onExternalAbort, { once: true });
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
                const wallElapsed = Date.now() - reqStartMs;
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
                  recordClientWorkerHealthSample({
                    cpuMs: res.status === 503 ? 9.5 : 8.2,
                    wallMs: wallElapsed,
                    subrequests: 12,
                    d1Ops: 4,
                    route: urlStr,
                    forcedOverload: true
                  });
                  const retryAfterRaw = res.headers ? res.headers.get("Retry-After") : null;
                  let retryAfterMs = 0;
                  if (retryAfterRaw) {
                    const secNum = Number(retryAfterRaw);
                    if (Number.isFinite(secNum) && secNum > 0) {
                      retryAfterMs = Math.min(60000, Math.round(secNum * 1000));
                    } else {
                      const dtMs = Date.parse(retryAfterRaw) - Date.now();
                      if (Number.isFinite(dtMs) && dtMs > 0) retryAfterMs = Math.min(60000, Math.round(dtMs));
                    }
                  }
                  const cState = getClientWorkerCircuitState();
                  cState.consecutiveOverloads = Math.min(10, Number(cState.consecutiveOverloads || 0) + 1);
                  cState.lastStatus = res.status || 503;
                  const expCooldownMs = Math.min(45000, 2500 * Math.pow(2, Math.min(4, cState.consecutiveOverloads - 1)));
                  const jitterCooldown = Math.floor(Math.random() * 650);
                  const effectiveCooldownMs = Math.max(retryAfterMs, expCooldownMs) + jitterCooldown;
                  cState.cooldownUntil = Math.max(Number(cState.cooldownUntil || 0), Date.now() + effectiveCooldownMs);
                  const rateErr = new Error(
                    "Worker/D1 überlastet oder Rate-Limit (HTTP " + (res.status || 524) + ") – Exponential Backoff aktiv"
                  );
                  rateErr.isRateLimitOrHtml = true;
                  rateErr.httpStatus = res.status || 503;
                  rateErr.retryAfterMs = effectiveCooldownMs;
                  rateErr.consecutiveOverloads = cState.consecutiveOverloads;
                  throw rateErr;
                }
                if (res.status === 401 || res.status === 403) {
                  const canAttemptSilentRefresh =
                    res.status === 401 &&
                    !hasRefreshedAuth &&
                    !opts._authRefreshAttempted &&
                    !urlStr.includes("/auth/");
                  if (canAttemptSilentRefresh) {
                    clearTimeout(timer);
                    let refreshedOk = false;
                    if (isHeaderSafeStr(sessionToken) && sessionToken !== sentBearerToken) {
                      // Ein paralleler Request hat die Session bereits erfolgreich erneuert
                      refreshedOk = true;
                    } else {
                      const refreshRes = await refreshTmaSessionSingleFlight();
                      refreshedOk = Boolean(refreshRes && refreshRes.ok && isHeaderSafeStr(sessionToken));
                    }
                    if (refreshedOk) {
                      if (opts.signal && opts.signal.aborted) {
                        throw new DOMException("Aborted", "AbortError");
                      }
                      headers["Authorization"] = "Bearer " + sessionToken;
                      if (isHeaderSafeStr(rawInitData)) {
                        headers["X-Telegram-Init-Data"] = rawInitData;
                      } else {
                        delete headers["X-Telegram-Init-Data"];
                      }
                      if (isHeaderSafeStr(rawLaunchToken)) {
                        headers["X-Telegram-Launch-Token"] = rawLaunchToken;
                      } else {
                        delete headers["X-Telegram-Launch-Token"];
                      }
                      return await doSingleFetch(true, true);
                    }
                  }
                  let authParsed = null;
                  try {
                    authParsed = JSON.parse(text);
                  } catch (_parseErr) {
                    authParsed = null;
                  }
                  const authResult = (authParsed && typeof authParsed === "object")
                    ? { ...authParsed }
                    : {
                        ok: false,
                        error: res.status === 401
                          ? "Authentifizierung fehlgeschlagen oder Sitzung abgelaufen (HTTP 401)."
                          : "Zugriff verweigert: Keine Admin- oder VIP-Berechtigung (HTTP 403)."
                      };
                  authResult.ok = false;
                  authResult._httpStatus = res.status;
                  authResult._authError = true;
                  return authResult;
                }
                try {
                  const parsed = JSON.parse(text);
                  if (parsed && typeof parsed === "object") {
                    parsed._httpStatus = res.status;
                  }
                  if (res.ok) {
                    const cState = getClientWorkerCircuitState();
                    cState.consecutiveOverloads = isImportBatch ? 0 : Math.max(0, Number(cState.consecutiveOverloads || 0) - 1);
                    if (cState.consecutiveOverloads === 0) cState.cooldownUntil = 0;
                  }
                  if (parsed && parsed._workerHealth && typeof parsed._workerHealth === "object") {
                    recordClientWorkerHealthSample(parsed._workerHealth);
                  } else {
                    const approxCpu = Math.min(8.5, Math.max(0.4, Number((text.length / 55000 + (isImportBatch ? 1.8 : 0.5)).toFixed(2))));
                    recordClientWorkerHealthSample({
                      cpuMs: approxCpu,
                      wallMs: wallElapsed,
                      subrequests: Number(parsed?.subrequestCount || 1),
                      d1Ops: 1,
                      route: urlStr
                    });
                  }
                  if (isGetRequest && cacheKey && parsed && parsed.ok !== false) {
                    writeBrowserApiCacheEntryClient(cacheKey, parsed, urlStr);
                  }
                  return parsed;
                } catch (e) {
                  const cleanSnippet = trimmed.replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ").trim().slice(0, 90);
                  const parseErr = new Error("Server-Antwort kein JSON (HTTP " + res.status + "): " + (cleanSnippet || "Leere Antwort"));
                  parseErr.isRateLimitOrHtml = res.status >= 500 || res.status === 429;
                  parseErr.httpStatus = res.status;
                  throw parseErr;
                }
              } finally {
                clearTimeout(timer);
                if (opts.signal && onExternalAbort) {
                  try { opts.signal.removeEventListener("abort", onExternalAbort); } catch (e) {}
                }
              }
            };

            const disableInternalRetries = Boolean(opts.noRetry || isImportBatch || isBackgroundImportAux);
            const backoffDelays = disableInternalRetries ? [] : [1200, 3200];
            let lastErr = null;
            for (let attempt = 0; attempt <= backoffDelays.length; attempt++) {
              try {
                return await doSingleFetch(attempt > 0);
              } catch (err) {
                lastErr = err;
                if (opts.signal && opts.signal.aborted) throw err;
                if (disableInternalRetries) throw err;
                // Wenn ein Stale-Browser-Cache für diesen GET-Aufruf vorliegt und HTTP 503/429 auftritt, liefere sofort die gecachte Antwort ohne Blockade!
                if (isGetRequest && staleCacheEntry && staleCacheEntry.data && err && err.isRateLimitOrHtml) {
                  return staleCacheEntry.data;
                }
                if (attempt < backoffDelays.length) {
                  const jitterMs = Math.floor(Math.random() * 450);
                  const baseWait = err && err.isRateLimitOrHtml
                    ? Math.max(backoffDelays[attempt], Math.min(8000, Number(err.retryAfterMs || 0)))
                    : 600 * (attempt + 1);
                  await new Promise(r => setTimeout(r, baseWait + jitterMs));
                }
              }
            }
            if (isGetRequest && staleCacheEntry && staleCacheEntry.data) {
              return staleCacheEntry.data;
            }
            throw lastErr || new Error("Netzwerkfehler");
          } finally {
            if (isInteractiveDuringImport) {
              window._adminPriorityRequestInFlight = Math.max(0, Number(window._adminPriorityRequestInFlight || 1) - 1);
            }
            if (isGetRequest && cacheKey && window._clientApiInFlightGetMap instanceof Map) {
              window._clientApiInFlightGetMap.delete(cacheKey);
            }
          }
        };

        const p = executeNetworkFetchWithRetries();
        if (isGetRequest && cacheKey && !opts.signal && window._clientApiInFlightGetMap instanceof Map) {
          window._clientApiInFlightGetMap.set(cacheKey, p);
        }
        return p;
      }

      window.apiFetchJson = apiFetchJson;
      window.api = function(endpoint, opts) {
        const target = String(endpoint || "").startsWith("http")
          ? endpoint
          : (API_BASE + (String(endpoint || "").startsWith("/api/tma") ? String(endpoint || "").slice(8) : endpoint));
        return apiFetchJson(target, opts);
      };

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
        else if (category === "reset_category") {
          if (effectiveVal === "genres") {
            s.includedGenres = []; s.excludedGenres = [];
            state.genreId = "all";
            syncSearchGenreSelectDom();
          } else if (effectiveVal === "platforms") {
            s.includedPlatforms = []; s.excludedPlatforms = [];
          } else if (effectiveVal === "eras") {
            s.includedEras = []; s.excludedEras = [];
          } else if (effectiveVal === "studios") {
            s.includedStudios = []; s.excludedStudios = [];
          } else if (effectiveVal === "fsk") {
            s.includedFsk = []; s.excludedFsk = [];
            s.showUnreleased = false;
          }
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

      async function resetSidebarCategoryFiltersQuickClient(catKey) {
        triggerTmaHapticClient("selection");
        await setDirectFilter("reset_category", String(catKey || ""), "neutral");
      }

      function toggleSearchFilterCollapse() {
        state.filtersCollapsedInSearch = !state.filtersCollapsedInSearch;
        const filterMount = document.getElementById("floatingFilterMount");
        if (filterMount) filterMount.innerHTML = buildFloatingFilterBarHtml();
      }

      async function triggerRandom() {
        const isMovie = state.type !== "s";
        triggerTmaHapticClient("medium");
        setBusyState(true, "🎲 Ziehe zufälligen " + (isMovie ? "Film" : "Serien-Tipp") + " mit deinen aktiven Filtern...");
        try {
          const r = await apiFetchJson(API_BASE + "/discover?type=" + state.type + "&genreId=" + state.genreId + "&mode=random&bypass=1");
          if (r.items && r.items.length > 0) {
            if (!Array.isArray(state.recentRandomKeys)) state.recentRandomKeys = [];
            const recentSet = new Set(state.recentRandomKeys);
            const pick = r.items.find(it => it && it.id && !recentSet.has(state.type + "_" + it.id)) || r.items[0];
            const pickKey = state.type + "_" + pick.id;
            state.recentRandomKeys.push(pickKey);
            if (state.recentRandomKeys.length > 16) {
              state.recentRandomKeys.shift();
            }
            window._openingViaRandomDice = true;
            await openDetails(state.type, pick.id, false, pick.title || pick.name || "", pick.poster_path || "");
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

      let catalogViewReqSeq = 0;

      async function loadDiscover(type, genreId, mode, sort, bypass = false, jumpToCards = false, targetPage = 1) {
        const myReqSeq = ++catalogViewReqSeq;
        state.type = type; state.genreId = genreId; state.mode = mode; state.sort = sort;
        const pageNum = Math.max(1, Number(targetPage) || 1);
        state.startPage = pageNum;
        state.page = pageNum;
        state.visibleCatalogPage = pageNum;
        state.hasMorePages = false;
        state.loadingMore = false;
        state.isSearchMode = false;
        state.searchFocused = false;
        state.currentView = "discover";
        if (typeof updateFloatingImportStatusBarDom === "function") updateFloatingImportStatusBarDom();
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        if (pageNum > 1) {
          heroCurtainScrolledToCatalog = true;
        }
        document.body.classList.remove("search-active-dim");
        updateMediaModeIndicatorDom();
        syncSearchGenreSelectDom();
        const root = document.getElementById("appRoot");
        const companyQueryParam = state.currentCompanyId ? ("&companyId=" + encodeURIComponent(state.currentCompanyId)) : "";
        const discoverUrl = API_BASE + "/discover?type=" + type + "&genreId=" + genreId + "&mode=" + mode + "&sort=" + sort + "&page=" + pageNum + "&bypass=" + (bypass ? "1" : "0") + companyQueryParam;
        const isInstantFromCache = hasFreshBrowserApiCacheClient(discoverUrl);
        if (!isInstantFromCache) {
          const existingGrid = document.getElementById("resultsGridContainer");
          if (existingGrid) {
            existingGrid.innerHTML = buildSkeletonCardsHtml();
          }
          setBusyState(true, "⏳ Lade " + (type === "s" ? "Serien" : "Filme") + (pageNum > 1 ? (" (Seite " + pageNum + ")") : "") + "...");
        }
        try {
          const res = await apiFetchJson(discoverUrl);
          if (myReqSeq !== catalogViewReqSeq) return;
          state.items = (res.items || []).map(it => ({ ...it, _pageNum: pageNum }));
          state.totalPages = Math.max(1, Number(res.totalPages) || 1);
          state.totalResults = Math.max(state.items.length, Number(res.totalResults) || state.items.length);
          state.hasMorePages = Boolean(res.hasMore ?? (pageNum < state.totalPages));
          if (res.genres && typeof res.genres === "object") {
            state.genres = res.genres;
          } else if (!state.genres || Object.keys(state.genres).length === 0) {
            state.genres = type === "s" ? SERIES_GENRES_CLIENT : MOVIE_GENRES_CLIENT;
          }
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
            root.innerHTML = '<div class="section">' + buildFloatingFilterBarHtml() + '<div class="panel-box"><div class="section-title">⚠️ Alle ' + res.rawCount + ' Treffer wurden durch deine aktiven Filter ausgeblendet</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn red" onclick="loadDiscover(\\''+escJs(type)+'\\',\\''+escJs(genreId)+'\\',\\''+escJs(mode)+'\\',\\''+escJs(sort)+'\\',true,false)">🔓 Filter hier temporär deaktivieren</button><button class="btn" onclick="setDirectFilter(\\'reset_all\\',\\'\\',\\'neutral\\')">🗑️ Alle Filter zurücksetzen</button></div></div></div>';
            syncSmartPageIndicatorDomClient();
            return;
          }
          renderDiscover();
          if (jumpToCards && typeof focusFirstResultCard === "function") {
            focusFirstResultCard(false);
          }
        } catch (err) {
          if (myReqSeq !== catalogViewReqSeq) return;
          root.innerHTML = '<div class="section"><div class="panel-box"><div class="section-title">⚠️ Fehler beim Laden</div><p style="font-size:12px;color:#ccc;margin-bottom:8px">' + esc(err.message) + '</p><button class="btn red" onclick="loadDiscover(\\''+escJs(type)+'\\',\\''+escJs(genreId)+'\\',\\''+escJs(mode)+'\\',\\''+escJs(sort)+'\\')">🔄 Erneut versuchen</button></div></div>';
        } finally {
          if (myReqSeq === catalogViewReqSeq && !isInstantFromCache) setBusyState(false);
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
        const myReqSeq = ++catalogViewReqSeq;
        if (typeof hideTmaMobileKeyboardClient === "function") {
          hideTmaMobileKeyboardClient();
        } else if (inp && document.activeElement === inp) {
          inp.blur();
        }
        const topHdr = document.getElementById("topUnifiedBar");
        if (topHdr && topHdr.classList.contains("mobile-search-expanded")) {
          topHdr.classList.remove("mobile-search-expanded");
        }
        closeAutocomplete();
        if (document.getElementById("modalRoot")?.innerHTML) {
          closeDetailModal();
        }
        const pageNum = Math.max(1, Number(targetPage) || 1);
        const isNewSearchQuery = state.searchQuery !== q || !state.isSearchMode;
        state.isSearchMode = true;
        state.searchFocused = false;
        state.startPage = pageNum;
        state.page = pageNum;
        state.visibleCatalogPage = pageNum;
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
        if (typeof clearSearchShortcutReturnCardClient === "function") {
          clearSearchShortcutReturnCardClient();
        }
        document.body.classList.remove("search-active-dim");
        updateMediaModeIndicatorDom();
        if (heroRotationTimer) clearInterval(heroRotationTimer);

        const root = document.getElementById("appRoot");
        const searchUrl = API_BASE + "/search?q=" + encodeURIComponent(q) +
          "&scope=" + encodeURIComponent(state.searchScope || "all") +
          "&sort=" + encodeURIComponent(state.sort) +
          "&page=" + pageNum + "&bypass=" + (bypass ? "1" : "0");
        const isInstantSearchCache = hasFreshBrowserApiCacheClient(searchUrl);
        if (!isInstantSearchCache) {
          const existingGrid = document.getElementById("resultsGridContainer");
          if (existingGrid) {
            existingGrid.innerHTML = buildSkeletonCardsHtml();
          }
          setBusyState(true, '🔍 Suche nach "' + q + '"' + (pageNum > 1 ? (' (Seite ' + pageNum + ')') : '') + '...');
        }
        try {
          const res = await apiFetchJson(searchUrl);
          if (myReqSeq !== catalogViewReqSeq) return;
          state.searchMatchedCollections = res.collections || [];
          state.searchMatchedUniverses = res.universes || [];
          state.searchMatchedPersons = res.persons || [];
          state.searchMatchedStudios = res.studios || [];
          if ((res.items || []).length === 0 && res.filteredOutCount > 0 && !bypass) {
            state.heroSlides = [];
            if (typeof syncHeroExpandedBodyClass === "function") syncHeroExpandedBodyClass();
            root.innerHTML = '<div class="section"><div id="floatingFilterMount">' + buildFloatingFilterBarHtml() + '</div><div class="panel-box"><div class="section-title">⚠️ Keine Treffer wegen aktiver Filter (' + res.filteredOutCount + ' ausgeblendet)</div><button class="btn red" onclick="runSearch(true)">🔓 Filter temporär deaktivieren (Alle ' + res.filteredOutCount + ' zeigen)</button></div></div>';
            if (jumpToResults && typeof focusFirstResultCard === "function") focusFirstResultCard(false);
            syncSmartPageIndicatorDomClient();
            return;
          }
          state.items = (res.items || []).map(it => ({ ...it, _pageNum: pageNum }));
          state.totalPages = Math.max(1, Number(res.totalPages) || 1);
          state.totalResults = Math.max(state.items.length, Number(res.totalResults) || state.items.length);
          state.hasMorePages = Boolean(res.hasMore ?? (pageNum < state.totalPages));
          document.body.classList.remove("search-active-dim");

          const detectedEntityCount =
            state.searchMatchedCollections.length +
            state.searchMatchedUniverses.length +
            state.searchMatchedPersons.length +
            state.searchMatchedStudios.length;

          if (state.items.length >= 2) {
            rebuildHeroSlides(state.items);
            heroCurtainScrolledToCatalog = pageNum > 1 || Boolean(state.heroHidden);
            if (!heroCurtainScrolledToCatalog) {
              document.body.classList.remove("hero-scrolled-past", "page-scrolled");
              if ((window.scrollY || window.pageYOffset || 0) !== 0) {
                window.scrollTo(0, 0);
              }
            }
          } else {
            state.heroSlides = [];
            heroCurtainScrolledToCatalog = true;
          }

          renderDiscover("🔍 Suchergebnisse: " + q);
          if (typeof preloadHeroSlidesAndUnlockCoversClient === "function") {
            preloadHeroSlidesAndUnlockCoversClient();
          }

          // Exakt 1 Suchtreffer (ohne zusätzliche Entitäten) -> direkt Detailseite öffnen (Suchansicht bleibt für Zurück im Hintergrund)
          if (pageNum === 1 && state.items.length === 1 && detectedEntityCount === 0) {
            const onlyItem = state.items[0];
            if (onlyItem && onlyItem.id) {
              const onlyType = (onlyItem.media_type === "tv" || onlyItem.media_type === "s") ? "s" : "m";
              if (typeof openDetails === "function") {
                openDetails(onlyType, onlyItem.id);
              }
              return;
            }
          }

          if (jumpToResults) {
            if (!heroCurtainScrolledToCatalog && typeof isHeroStageAvailableForCurrentViewClient === "function" && isHeroStageAvailableForCurrentViewClient()) {
              const heroFocusTarget = document.getElementById("heroBtnTrailer") || document.getElementById("heroBtnDetails");
              if (heroFocusTarget && typeof jumpSpatialFocus === "function") {
                jumpSpatialFocus(heroFocusTarget, false);
              }
            } else if (typeof focusFirstResultCard === "function") {
              focusFirstResultCard(false);
            }
          }
        } catch (err) {
          if (myReqSeq !== catalogViewReqSeq) return;
          root.innerHTML = '<div class="section"><div class="panel-box">⚠️ Fehler bei der Suche: ' + esc(err.message) + '</div></div>';
        } finally {
          if (myReqSeq === catalogViewReqSeq) {
            document.body.classList.remove("search-active-dim");
            if (!isInstantSearchCache) setBusyState(false);
          }
        }
      }

      // Direkt-Seitenwahl (#17) für Discover & Suche (inkl. Übergang zum Katalog & Vorladen der gewählten Seite)
      async function jumpToPage(targetPage) {
        const p = Math.max(1, Math.min(Number(state.totalPages) || 1, Number(targetPage) || 1));
        if (state.loadingMore) return;
        closePageJumpModalClient();
        if (state.isSearchMode && state.searchQuery) {
          await runSearch(false, state.searchQuery, state.searchScope, true, p);
        } else {
          await loadDiscover(state.type, state.genreId, state.mode, state.sort, false, true, p);
        }
        if (typeof isHeroScrollCouplingActiveClient === "function" && isHeroScrollCouplingActiveClient() && !heroCurtainScrolledToCatalog) {
          if (typeof animateHeroCatalogSnapScrollClient === "function") {
            animateHeroCatalogSnapScrollClient(100, { bounceLock: false });
          } else {
            heroCurtainScrolledToCatalog = true;
          }
        }
        unlockCatalogCoversLoadingClient(false);
        preloadCatalogPageCoversClient(p);
        syncSmartPageIndicatorDomClient(true);
      }

      // Einzelne Katalog-Karte als HTML: Freies Poster, ruhige Titel-/Info-Zeile darunter & Datenattribute für die Fokus-Info-Zeile
      function buildCatalogCardHtmlClient(it, idx, opts = {}) {
        const showTop10Ranks = Boolean(opts.showTop10Ranks);
        const isMixedMediaView = Boolean(opts.isMixedMediaView);
        const vipAllowed = opts.vipAllowed !== undefined ? Boolean(opts.vipAllowed) : isCurrentUserVip();
        const defaultPageNum = Math.max(1, Number(opts.pageNum || it._pageNum || state.page || 1));
        const itemPageNum = Math.max(1, Number(it._pageNum) || defaultPageNum);
        const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : state.type;
        const cardKey = tc + "_" + it.id;
        const isCardSaved = savedKeysSet.has(cardKey);
        const rankHtml = (showTop10Ranks && idx < 10) ? ('<span class="card-rank-badge">#' + (idx + 1) + '</span>') : "";
        const vipQualityText = (vipAllowed && it.vipQuality) ? String(it.vipQuality) : "";
        const vipQualityHtml = vipQualityText
          ? ('<span class="card-vip-dot" title="VIP-Stream verfügbar: ' + esc(vipQualityText) + '"></span>')
          : "";
        const itemTitleSafe = esc(it.title || it.name || "");
        const resolvedCardPoster = resolvePosterUrlClient(it.poster_path, "w342", it.external_poster_url || it.poster || "");
        const yrStr = esc((it.release_date || it.first_air_date || "").slice(0, 4) || "–");
        const ratStr = it.vote_average ? Number(it.vote_average).toFixed(1) : "–";
        const mediaLabel = tc === "s" ? "Serie" : "Film";
        const effectivePosterSrc = resolvedCardPoster ? esc(resolvedCardPoster) : LAZY_POSTER_FALLBACK_SVG;
        const mixedSuffixHtml = isMixedMediaView ? ('<span class="card-sub-dot">·</span><span>' + mediaLabel + '</span>') : "";

        return '<div class="card' + (isCardSaved ? " card-saved" : "") + '" tabindex="0" data-card-key="' + esc(cardKey) + '" data-card-type="' + tc + '" data-card-id="' + it.id + '" data-card-title="' + itemTitleSafe + '" data-card-year="' + yrStr + '" data-card-rating="' + esc(ratStr) + '" data-card-vip="' + esc(vipQualityText) + '" data-card-saved="' + (isCardSaved ? "1" : "0") + '" data-card-media-label="' + mediaLabel + '" data-page-num="' + itemPageNum + '" onclick="openDetails(\\'' + tc + '\\',' + it.id + ')">' +
          '<div class="card-poster-wrap">' +
            '<div class="card-top-left-stack">' +
              rankHtml +
              vipQualityHtml +
            '</div>' +
            '<button type="button" class="card-quick-save ' + (isCardSaved ? "saved" : "") + '" onclick="quickToggleCardWishlist(event,\\'' + tc + '\\',' + it.id + ')" title="' + (isCardSaved ? "In deiner Merkliste gespeichert (Tipp oder gedrückt halten zum Entfernen)" : "In Merkliste speichern (Tipp oder Karte gedrückt halten)") + '">' + (isCardSaved ? "✓" : "🔖") + '</button>' +
            '<button type="button" class="card-hover-play-btn" onclick="playInstantTrailerFromCard(event,\\'' + tc + '\\',' + it.id + ')" aria-label="Trailer abspielen" title="Instant-Trailer abspielen">' +
              '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.2 2.6a.9.9 0 0 1 1.37-.77l8.2 5.4a.9.9 0 0 1 0 1.54l-8.2 5.4A.9.9 0 0 1 4.2 13.4V2.6z"/></svg>' +
            '</button>' +
            '<img class="lazy-cover-img is-loading" src="' + LAZY_POSTER_PLACEHOLDER_SVG + '" data-lazy-src="' + effectivePosterSrc + '" data-page-num="' + itemPageNum + '"' + (idx < 8 ? ' fetchpriority="high"' : '') + ' draggable="false" oncontextmenu="return false;" alt="' + itemTitleSafe + '" />' +
          '</div>' +
          '<div class="card-body">' +
            '<div class="card-title"><span class="card-title-text">' + itemTitleSafe + '</span></div>' +
            '<div class="card-sub">' +
              '<span class="card-sub-meta"><span class="card-sub-rating">★ ' + ratStr + '</span><span class="card-sub-dot">·</span><span>' + yrStr + '</span>' + mixedSuffixHtml + '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      }

      // Endlos-Scrollen / „Mehr laden“-Pagination für Entdecken- & Such-Grid (nahtloses Anhängen ohne DOM-Reset!)
      async function loadMoreResults(isAutoScroll = false) {
        if (state.loadingMore || !state.hasMorePages) return;
        const nextPage = (Number(state.page) || 1) + 1;
        state.loadingMore = true;
        const statusLbl = document.getElementById("infiniteScrollStatusLabel");
        if (statusLbl) {
          statusLbl.innerHTML = "⏳ Lade Seite " + nextPage + " von " + Math.max(nextPage, Number(state.totalPages) || 1) + " automatisch nach…";
        }
        const gridEl = document.getElementById("resultsGridContainer");
        if (gridEl && !isAutoScroll) {
          const loadWrap = gridEl.querySelector(".load-more-wrap");
          if (loadWrap) {
            loadWrap.insertAdjacentHTML("beforebegin", buildSkeletonCardsHtml(6));
          }
        }
        if (!isAutoScroll) {
          setBusyState(true, "⏳ Lade Seite " + nextPage + " nach...");
        }
        try {
          let res = null;
          if (state.isSearchMode && state.searchQuery) {
            res = await apiFetchJson(
              API_BASE + "/search?q=" + encodeURIComponent(state.searchQuery) +
              "&scope=" + encodeURIComponent(state.searchScope || "all") +
              "&sort=" + encodeURIComponent(state.sort) +
              "&page=" + nextPage
            );
          } else {
            const companyQueryParam = state.currentCompanyId ? ("&companyId=" + encodeURIComponent(state.currentCompanyId)) : "";
            res = await apiFetchJson(
              API_BASE + "/discover?type=" + state.type +
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
          }).map(it => ({ ...it, _pageNum: nextPage }));

          const prevCount = state.items.length;
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

          const liveGridEl = document.getElementById("resultsGridContainer");
          if (liveGridEl) {
            liveGridEl.querySelectorAll('[data-skeleton="1"]').forEach(el => el.remove());
            const showTop10Ranks = !state.isSearchMode && state.currentView === "discover" && state.mode === "trend" && !state.currentCompanyId;
            const isMixedMediaView = Boolean(state.isSearchMode || state.currentView === "collection_items" || state.currentView === "universe_items" || state.currentView === "person_items");
            const appendedHtml = freshItems.map((it, i) => buildCatalogCardHtmlClient(it, prevCount + i, {
              showTop10Ranks,
              isMixedMediaView,
              pageNum: nextPage
            })).join("");

            const sentinelWrap = document.getElementById("infiniteScrollSentinel") || liveGridEl.querySelector(".load-more-wrap");
            if (sentinelWrap && appendedHtml) {
              sentinelWrap.insertAdjacentHTML("beforebegin", appendedHtml);
            } else if (appendedHtml) {
              liveGridEl.insertAdjacentHTML("beforeend", appendedHtml);
            }

            // Treffer-Zähler im Sektions-Header aktualisieren
            const hitsCountEl = document.getElementById("sectionHitsCountLabel");
            if (hitsCountEl) {
              const totPages = Math.max(state.page, Number(state.totalPages) || 1);
              const totalResNum = Math.max(state.items.length, Number(state.totalResults) || state.items.length);
              hitsCountEl.textContent = (totPages > 1 || totalResNum > state.items.length)
                ? (state.items.length + " geladen • " + totalResNum.toLocaleString("de-DE") + " Treffer")
                : (state.items.length + " Treffer");
            }

            // Sentinel-Status aktualisieren
            const nextStatusLbl = document.getElementById("infiniteScrollStatusLabel");
            if (nextStatusLbl) {
              if (state.hasMorePages) {
                nextStatusLbl.innerHTML = '📜 Seite ' + state.page + ' von ' + state.totalPages + ' geladen';
              } else {
                nextStatusLbl.innerHTML = '✅ Alle verfügbaren Treffer bis Seite ' + state.page + ' geladen';
              }
            }
            const manualMoreBtn = document.getElementById("manualLoadMoreBtn");
            if (manualMoreBtn) {
              if (state.hasMorePages && state.page < state.totalPages) {
                manualMoreBtn.style.display = "inline-flex";
                manualMoreBtn.innerHTML = "➕ Seite " + (state.page + 1) + " laden";
              } else {
                manualMoreBtn.style.display = "none";
              }
            }
            const bottomPill = document.getElementById("bottomPageCounterPill");
            if (bottomPill) {
              bottomPill.innerHTML = "🎯 Seite wählen (" + (state.visibleCatalogPage || state.page) + " / " + state.totalPages + ") ▾";
            }

            observeLazyCoversInContainerClient(liveGridEl);
            ensureCatalogPageTrackObserverClient(liveGridEl);
            ensureInfiniteScrollSentinelObserverClient();
            if (catalogCoversUnlocked) {
              preloadCatalogPageCoversClient(nextPage);
            }
            syncSmartPageIndicatorDomClient(false);
          } else {
            renderDiscover(state.isSearchMode ? ("🔍 Suchergebnisse: " + state.searchQuery) : undefined);
          }
        } catch (e) {
          if (gridEl) {
            gridEl.querySelectorAll('[data-skeleton="1"]').forEach(el => el.remove());
          }
          showHudToast("⚠️ Weitere Ergebnisse konnten nicht geladen werden.");
        } finally {
          state.loadingMore = false;
          if (!isAutoScroll) {
            setBusyState(false);
          }
        }
      }

      function renderDirectFilterOptionCard(category, itemValue, displayLabel, isInc, isExc) {
        const stateCls = isInc ? "state-inc" : isExc ? "state-exc" : "";
        const dfBaseId = esc(category + ":" + itemValue);
        const incBtnHtml = isInc
          ? '<button class="df-btn inc active is-neutral-on-select" data-df-id="' + dfBaseId + ':inc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + escJs(itemValue) + '\\',\\'neutral\\')" title="Aktiviert – Auswählen setzt auf Neutral (○)"><span class="df-ico-cur">✓</span><span class="df-ico-sel">○</span></button>'
          : '<button class="df-btn inc" data-df-id="' + dfBaseId + ':inc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + escJs(itemValue) + '\\',\\'include\\')" title="Positiv aktivieren (✓)">✓</button>';
        const excBtnHtml = isExc
          ? '<button class="df-btn exc active is-neutral-on-select" data-df-id="' + dfBaseId + ':exc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + escJs(itemValue) + '\\',\\'neutral\\')" title="Gesperrt – Auswählen setzt auf Neutral (○)"><span class="df-ico-cur">✕</span><span class="df-ico-sel">○</span></button>'
          : '<button class="df-btn exc" data-df-id="' + dfBaseId + ':exc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + escJs(itemValue) + '\\',\\'exclude\\')" title="Negativ ausschließen (✕)">✕</button>';
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

        if (state.lastClosedDetailItem && state.lastClosedDetailItem.id) {
          const lastIt = state.lastClosedDetailItem;
          const shortTitle = String(lastIt.title || "Titel").length > 32
            ? (String(lastIt.title).slice(0, 31) + "…")
            : String(lastIt.title || "Titel");
          pills.push(
            '<button type="button" class="return-last-detail-chip" onclick="reopenLastClosedDetailItemClient()" title="Direkt zurück zu ' + esc(lastIt.title || "Titel") + ' springen">' +
              '<span>↩ Zurück zu: <b>' + esc(shortTitle) + '</b></span>' +
              '<span class="chip-dismiss" onclick="dismissLastClosedDetailItemClient(event)" title="Chip ausblenden">✕</span>' +
            '</button>'
          );
        }

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
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'genre\\',\\''+escJs(g)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">' + genreEmoji(g) + ' ' + esc(g) + ' ✕</span>');
        });
        (s.excludedGenres || []).forEach(g => {
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'genre\\',\\''+escJs(g)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">' + genreEmoji(g) + ' ' + esc(g) + ' ✕</span>');
        });

        if (incPlatforms.length > 1) {
          incPlatforms.forEach(pid => {
            const label = getPlatformDisplayLabelClient(pid);
            pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'platform\\',\\''+escJs(pid)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">' + esc(label) + ' ✕</span>');
          });
        }
        excPlatforms.forEach(pid => {
          const label = getPlatformDisplayLabelClient(pid);
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'platform\\',\\''+escJs(pid)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">' + esc(label) + ' ✕</span>');
        });

        (s.includedEras || []).forEach(eid => {
          const er = ERA_OPTIONS_CLIENT.find(e => e.id === eid);
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'era\\',\\''+escJs(eid)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">📅 ' + esc(er ? er.label : eid) + ' ✕</span>');
        });
        (s.excludedEras || []).forEach(eid => {
          const er = ERA_OPTIONS_CLIENT.find(e => e.id === eid);
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'era\\',\\''+escJs(eid)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">📅 ' + esc(er ? er.label : eid) + ' ✕</span>');
        });

        (s.includedStudios || []).forEach(sid => {
          const st = STUDIO_OPTIONS_CLIENT.find(x => x.id === sid);
          const label = st ? (st.icon + " " + st.label) : sid;
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'studio\\',\\''+escJs(sid)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">' + esc(label) + ' ✕</span>');
        });
        (s.excludedStudios || []).forEach(sid => {
          const st = STUDIO_OPTIONS_CLIENT.find(x => x.id === sid);
          const label = st ? (st.icon + " " + st.label) : sid;
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'studio\\',\\''+escJs(sid)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">' + esc(label) + ' ✕</span>');
        });

        (s.includedFsk || []).forEach(f => {
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'fsk\\',\\''+escJs(f)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">🔞 ' + esc(f) + ' ✕</span>');
        });
        (s.excludedFsk || []).forEach(f => {
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'fsk\\',\\''+escJs(f)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">🔞 ' + esc(f) + ' ✕</span>');
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
        const totalActiveFilters = typeof countActiveUserFiltersClient === "function" ? countActiveUserFiltersClient() : 0;
        const hasCustomSortOrMode = Boolean(
          (curSort && curSort !== "default") ||
          (isDiscoverView && curMode && curMode !== "trend")
        );
        const showQuickResetBtn = totalActiveFilters > 0 || hasCustomSortOrMode;

        if (typeof syncTopBarFilterIndicatorsClient === "function") {
          syncTopBarFilterIndicatorsClient();
        }

        const quickResetBtnHtml = showQuickResetBtn
          ? ('<button type="button" class="btn ff-quick-reset-btn" onclick="resetAllCatalogFiltersAndSortQuickClient(event)" title="Alle aktiven Filter, Anbieter & Sortierung mit 1 Klick auf Standard zurücksetzen">↺ ' + (totalActiveFilters > 0 ? ('Reset (' + totalActiveFilters + ')') : 'Standard') + '</button>')
          : '';

        const controlsHtml =
          modeOrScopeHtml +
          providerSelectHtml +
          sortGroupHtml +
          quickResetBtnHtml +
          (!state.isSearchMode ? '<button type="button" class="btn" onclick="triggerRandom()" title="Zufälligen Titel mit deinen aktiven Filtern ziehen">🎲 Zufall</button>' : '') +
          (!state.isSearchMode ? '<button class="btn ' + (isFranchiseActive ? 'blue' : '') + '" onclick="toggleWorldsTray()" title="Filmuniversen & Filmreihen Portal-Dock ein- oder ausklappen">🌌 Welten & Reihen ' + (state.worldsTrayOpen ? '▴' : '▾') + '</button>' : '') +
          ((state.isSearchMode || isColView || isUniView || isPerView || state.currentCompanyId) ? '<button class="btn" onclick="goHome()">🏠 Hauptseite</button>' : '');

        return '<div class="floating-filter-bar">' +
          '<div class="ff-controls-grid">' +
            controlsHtml +
          '</div>' +
          (state.worldsTrayOpen && !state.isSearchMode ? buildWorldsPortalTrayHtml() : '') +
          (pills.length > 0 ? (
            '<div class="ff-active-pills" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.2)">' +
              pills.join("") +
              (totalActiveFilters > 0 ? '<button class="btn danger" style="padding:2px 8px;font-size:10.5px" onclick="resetAllCatalogFiltersAndSortQuickClient(event)" title="Alle aktiven Filter löschen">🗑️ Alle Filter löschen</button>' : '') +
            '</div>'
          ) : '') +
        '</div>';
      }

      async function resetAllCatalogFiltersAndSortQuickClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        triggerTmaHapticClient("medium");
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        state.genreId = "all";
        state.sort = "default";
        if (!state.isSearchMode && state.currentView === "discover") {
          state.mode = "trend";
        }
        syncSearchGenreSelectDom();
        await setDirectFilter("reset_all", "", "neutral");
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
        const clearBtn = document.getElementById("worldsSearchClearBtn");
        if (clearBtn) {
          clearBtn.style.display = state.worldsTrayQuery.trim().length > 0 ? "inline-flex" : "none";
        }
        const gridEl = document.getElementById("worldsPortalGridMount");
        if (gridEl) gridEl.innerHTML = buildWorldsPortalCardsOnlyHtml();
        if (worldsTraySearchTimer) clearTimeout(worldsTraySearchTimer);
        const q = state.worldsTrayQuery.trim();
        if (q.length >= 2) {
          worldsTraySearchTimer = setTimeout(async () => {
            try {
              const r = await apiFetchJson(API_BASE + "/collections?q=" + encodeURIComponent(q));
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

      function clearWorldsTraySearchClient() {
        triggerTmaHapticClient("selection");
        state.worldsTrayQuery = "";
        state.worldsTrayRemoteCols = [];
        const inp = document.getElementById("worldsTraySearchInputEl");
        if (inp) {
          inp.value = "";
          try { inp.focus(); } catch (e) {}
        }
        const clearBtn = document.getElementById("worldsSearchClearBtn");
        if (clearBtn) clearBtn.style.display = "none";
        const gridEl = document.getElementById("worldsPortalGridMount");
        if (gridEl) gridEl.innerHTML = buildWorldsPortalCardsOnlyHtml();
      }

      function buildWorldsPortalCardsOnlyHtml() {
        const q = String(state.worldsTrayQuery || "").trim().toLowerCase();
        const isColsTab = state.worldsTrayTab === "collections";

        if (!isColsTab && !q) {
          return (CINEMATIC_UNIVERSES_CLIENT || []).map(u =>
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openUniverseView(\\'' + escJs(u.id) + '\\')">' +
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
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openUniverseView(\\'' + escJs(u.id) + '\\')">' +
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
        const hasQuery = String(state.worldsTrayQuery || "").trim().length > 0;
        return '<div class="worlds-portal-tray">' +
          '<div class="worlds-portal-header">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button type="button" class="btn ' + (!isColsTab ? 'blue' : '') + '" onclick="switchWorldsTrayTab(\\'universes\\')">🌌 Universen (' + (CINEMATIC_UNIVERSES_CLIENT ? CINEMATIC_UNIVERSES_CLIENT.length : 0) + ')</button>' +
              '<button type="button" class="btn ' + (isColsTab ? 'blue' : '') + '" onclick="switchWorldsTrayTab(\\'collections\\')">🍿 Filmreihen (' + (FEATURED_COLLECTIONS_CLIENT ? FEATURED_COLLECTIONS_CLIENT.length : 0) + '+)</button>' +
            '</div>' +
            '<div style="position:relative;flex:1 1 180px;min-width:150px;display:flex;align-items:center">' +
              '<input id="worldsTraySearchInputEl" type="text" class="worlds-search-input" style="width:100%;padding-right:28px" value="' + esc(state.worldsTrayQuery || '') + '" oninput="onWorldsTraySearchInput(this.value)" placeholder="🔍 Welt oder Filmreihe suchen (z.B. Marvel, Star Wars, Dune)..." />' +
              '<button type="button" id="worldsSearchClearBtn" onclick="clearWorldsTraySearchClient()" title="Suche leeren" style="position:absolute;right:6px;display:' + (hasQuery ? 'inline-flex' : 'none') + ';align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;border:0;background:rgba(148,163,184,0.22);color:#f8fafc;font-size:11px;cursor:pointer">✕</button>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center">' +
              '<button type="button" class="btn" onclick="state.worldsTrayOpen=false;loadFranchisesHub(\\'' + (isColsTab ? 'collections' : 'universes') + '\\')" title="Große Vollbild-Übersicht öffnen">🗂️ Vollbild-Hub</button>' +
              '<button type="button" class="btn" onclick="toggleWorldsTray(false)" title="Welten-Leiste einklappen">✕</button>' +
            '</div>' +
          '</div>' +
          '<div id="worldsPortalGridMount" class="worlds-portal-grid">' +
            buildWorldsPortalCardsOnlyHtml() +
          '</div>' +
        '</div>';
      }

      function renderDiscover(customTitle) {
        const root = document.getElementById("appRoot");
        const vipAllowed = isCurrentUserVip();

        const canRenderHeroSlot = Boolean(
          Array.isArray(state.heroSlides) &&
          state.heroSlides.length > 0 &&
          (!state.isSearchMode || state.items.length >= 2)
        );
        const heroSectionHtml = canRenderHeroSlot
          ? '<div id="heroBannerSlot">' + buildHeroBannerInnerHtml() + '</div>'
          : (typeof syncHeroExpandedBodyClass === "function" ? (syncHeroExpandedBodyClass(), "") : "");

        const isColView = state.currentView === "collection" && state.currentCollectionId;
        const isUniView = state.currentView === "universe" && state.currentUniverseId;
        const isPerView = state.currentView === "person" && state.currentPersonId;
        const isStudioView = Boolean(state.currentView === "discover" && state.currentCompanyId);

        const franchiseActionBannerHtml = (isColView || isUniView) ? (
          '<div class="panel-box" style="margin-bottom:10px;padding:10px 12px;border-color:' + (isColView ? 'rgba(91,70,245,0.5)' : 'rgba(16,185,129,0.5)') + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div>' +
                '<div style="font-size:13.5px;font-weight:800;color:var(--text-main)">' + esc(customTitle || (isColView ? '🍿 Filmreihe' : '🌌 Filmuniversum')) + '</div>' +
                '<div style="font-size:11px;color:var(--text-muted)">Komplette ' + (isColView ? 'Filmreihe' : 'Welt') + ' speichern, teilen oder weitere Reihen entdecken:</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="btn green" onclick="saveWholeCollectionOrUniverseTma(\\'' + (isColView ? 'col' : 'uni') + '\\',\\'' + escJs(isColView ? state.currentCollectionId : state.currentUniverseId) + '\\')">💾 Alle ' + state.items.length + ' speichern</button>' +
                '<button class="btn purple" data-kind="' + (isColView ? 'col' : 'uni') + '" data-id="' + esc(isColView ? state.currentCollectionId : state.currentUniverseId) + '" data-title="' + esc(isColView ? state.currentCollectionName : state.currentUniverseName) + '" onclick="shareCollectionOrUniverseFromBtn(this)">📤 Teilen</button>' +
                '<button class="btn" onclick="loadFranchisesHub(\\'' + (isColView ? 'collections' : 'universes') + '\\')">🌌 Alle ' + (isColView ? 'Reihen' : 'Welten') + '</button>' +
                '<button class="btn" onclick="goHome()">🏠 Katalog</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        ) : (isPerView || isStudioView) ? (
          '<div class="panel-box" style="margin-bottom:10px;padding:9px 12px;border-color:rgba(56,189,248,0.42)">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div style="font-size:13px;font-weight:800;color:var(--text-main)">' +
                (isPerView ? ('🌟 Filmografie: ' + esc(state.currentPersonName || 'Person')) : ('🏢 Studio-Katalog: ' + esc(state.currentCompanyName || 'Filmstudio'))) +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="btn" onclick="goHome()">🏠 Zurück zum Hauptkatalog</button>' +
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
                '<button class="btn" style="background:rgba(245,158,11,0.2);border-color:#f59e0b" data-cid="' + esc(st.companyIds || st.id) + '" data-cname="' + esc(st.name) + '" onclick="openStudioView(this.dataset.cid,this.dataset.cname)">' + esc(st.icon || '🏢') + ' Studio: ' + esc(st.name) + '</button>'
              ).join("") +
              (state.searchMatchedUniverses || []).map(u =>
                '<button class="btn" style="background:rgba(16,185,129,0.2);border-color:#10b981" onclick="openUniverseView(\\'' + escJs(u.id) + '\\')">' + esc(u.icon || '🌌') + ' Universum: ' + esc(u.name) + '</button>'
              ).join("") +
              (state.searchMatchedCollections || []).map(c =>
                '<button class="btn" style="background:rgba(91,70,245,0.22);border-color:#7c69ff" onclick="openCollectionView(' + Number(c.id) + ')">🍿 Filmreihe: ' + esc(c.name) + '</button>'
              ).join("") +
              (state.searchMatchedPersons || []).map(p =>
                '<button class="btn" style="background:rgba(2,132,199,0.22);border-color:#38bdf8" data-pid="' + Number(p.id) + '" data-pname="' + esc(p.name) + '" onclick="openPersonView(Number(this.dataset.pid),this.dataset.pname)">🌟 ' + esc(p.name) + (p.known_for ? ' (' + esc(p.known_for) + ')' : '') + '</button>'
              ).join("") +
            '</div>' +
          '</div>'
        ) : '';

        // Verlauf „Zuletzt gesehen“ ist zentral im rechten Schnellmenü integriert (keine doppelte Leiste auf der Hauptseite)
        const recentStripMountHtml = "";

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
        const visiblePage = Math.max(1, Math.min(totPages, Number(state.visibleCatalogPage || curPage) || 1));
        const totalResNum = Math.max(state.items.length, Number(state.totalResults) || state.items.length);
        const hitsLabel = (!isColView && !isUniView && !isPerView && (totPages > 1 || totalResNum > state.items.length))
          ? (state.items.length + " geladen • " + totalResNum.toLocaleString("de-DE") + " Treffer")
          : (state.items.length + " Treffer");
        const hasNextPage = Boolean(state.hasMorePages && curPage < totPages && state.items.length > 0);
        const canPaginateView = Boolean((state.currentView === "discover" || state.isSearchMode) && !isColView && !isUniView && !isPerView && (hasNextPage || totPages > 1) && state.items.length > 0);

        // Schlanker Auto-Load-Sentinel am Ende des Grids (mit 1-Klick-Nachladen & Seiten-Schnellwahl)
        let paginationBarHtml = "";
        if (canPaginateView) {
          paginationBarHtml = '<div id="infiniteScrollSentinel" class="load-more-wrap" style="padding:14px 12px;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap">' +
            '<span id="infiniteScrollStatusLabel" style="font-size:12px;color:var(--text-muted);font-weight:700">' +
              (hasNextPage
                ? ('📄 Seite ' + curPage + ' von ' + totPages + ' geladen')
                : ('✅ Alle ' + totPages + ' Seiten geladen')) +
            '</span>' +
            (hasNextPage ? (
              '<button type="button" id="manualLoadMoreBtn" class="page-counter-pill" style="background:rgba(14,165,233,0.18);border-color:rgba(56,189,248,0.52);color:#e0f2fe" onclick="loadMoreResults(false)" title="Nächste Katalogseite direkt laden">➕ Seite ' + (curPage + 1) + ' laden</button>'
            ) : '') +
            (totPages > 1 ? (
              '<button type="button" id="bottomPageCounterPill" class="page-counter-pill" onclick="openPageJumpModalClient()" title="Gezielten Seitensprung öffnen">🎯 Seite wählen (' + visiblePage + ' / ' + totPages + ') ▾</button>'
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
              '<span>' + headerTitle + ' (<span id="sectionHitsCountLabel">' + hitsLabel + '</span>)</span>' +
              ((!isColView && !isUniView && !isPerView && totPages > 1)
                ? '<button type="button" id="sectionPageCounterPill" class="page-counter-pill" onclick="openPageJumpModalClient()" title="Klicken oder Enter für direkte Seitenwahl (TV & Touch)">📄 Seite ' + visiblePage + ' / ' + totPages + ' ▾</button>'
                : '') +
            '</div>' +
            '<div id="resultsGridContainer" class="carousel">' + (state.items.length > 0 ? state.items.map((it, idx) => buildCatalogCardHtmlClient(it, idx, {
              showTop10Ranks,
              isMixedMediaView,
              pageNum: it._pageNum || startPage
            })).join("") + paginationBarHtml : (
              '<div class="panel-box" style="grid-column:1 / -1;margin-top:6px">' +
                '<div class="section-title">⚠️ Keine Treffer mit dieser Filter-Kombination auf Seite ' + curPage + '</div>' +
                '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Passe in der linken Sidebar (☰ Filter) einzelne Filter an oder setze alle Filter zurück:</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                  '<button class="btn purple" onclick="toggleFilterSidebar()">☰ Filter-Sidebar öffnen</button>' +
                  '<button class="btn danger" onclick="setDirectFilter(\\'reset_all\\',\\'\\',\\'neutral\\')">🗑️ Alle Filter zurücksetzen</button>' +
                '</div>' +
              '</div>'
            )) + '</div>' +
          '</div>';

        // Gestaffelte Bild-Ladepipeline (Slider #1 -> Slider #2..N + 1 Seite Cover -> IntersectionObserver + Infinite Scroll) starten
        preloadHeroSlidesAndUnlockCoversClient();

        if (typeof window.refreshModalAndEpisodeMarquees === "function") {
          const heroSlot = document.getElementById("heroBannerSlot");
          if (heroSlot) setTimeout(() => window.refreshModalAndEpisodeMarquees(heroSlot), 40);
        }
      }

      async function loadFranchisesHub(tab) {
        if (tab) state.franchiseTab = tab;
        state.currentView = "franchises";
        if (typeof updateFloatingImportStatusBarDom === "function") updateFloatingImportStatusBarDom();
        const root = document.getElementById("appRoot");
        setBusyState(true, "⏳ Lade Filmreihen & Filmuniversen...");
        try {
          const [colsRes, unisRes] = await Promise.all([
            apiFetchJson(API_BASE + "/collections"),
            apiFetchJson(API_BASE + "/universes")
          ]);
          const cols = colsRes.collections || [];
          const unis = unisRes.universes || [];
          const isUni = state.franchiseTab === "universes";

          root.innerHTML = '<div class="section">' +
            '<div class="section-title" style="margin-top:4px">' +
              '<span>🌌 Welten & 🍿 Filmreihen entdecken</span>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="btn ' + (!isUni ? 'active' : '') + '" onclick="loadFranchisesHub(\\'collections\\')">🍿 Filmreihen (' + cols.length + ')</button>' +
                '<button class="btn ' + (isUni ? 'active' : '') + '" onclick="loadFranchisesHub(\\'universes\\')">🌌 Filmuniversen (' + unis.length + ')</button>' +
                '<button class="btn" onclick="goHome()">🏠 Katalog</button>' +
              '</div>' +
            '</div>' +
            (!isUni ? (
              '<div class="floating-filter-bar" style="display:flex;gap:6px;margin-bottom:12px;padding:8px 10px;align-items:center">' +
                '<input id="colSearchInput" class="tma-input" style="flex:1;padding:7px 12px;border-radius:8px;font-size:12.5px" placeholder="🔍 Beliebige Filmreihe suchen (z.B. Saw, Matrix, John Wick, Fast & Furious)..." onkeydown="if(event.key===\\'Enter\\')searchCollectionsInHub()" />' +
                '<button class="btn blue" onclick="searchCollectionsInHub()">🔍 Suchen</button>' +
              '</div>' +
              '<div id="colHubGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;padding:4px">' +
                cols.map(c => '<button class="btn" style="padding:10px 12px;font-size:12.5px;justify-content:flex-start;text-align:left" onclick="openCollectionView(' + c.id + ')">' + esc(c.icon || '🍿') + ' <span>' + esc(c.name) + '</span></button>').join("") +
              '</div>'
            ) : (
              '<div id="uniHubGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;padding:4px">' +
                unis.map(u => '<div class="panel-box f-pill neutral" tabindex="0" style="cursor:pointer;margin-bottom:0;display:block;border-radius:10px;padding:12px" onclick="openUniverseView(\\''+escJs(u.id)+'\\')"><div style="font-size:14px;font-weight:800;margin-bottom:4px">' + esc(u.icon || '🌌') + ' ' + esc(u.name) + '</div><div style="font-size:11.5px;color:var(--muted);line-height:1.4">' + esc(u.description || '') + '</div></div>').join("") +
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
          const r = await apiFetchJson(API_BASE + "/collections?q=" + encodeURIComponent(q));
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

      async function openCollectionView(colId, sortOverride = null) {
        document.getElementById("modalRoot").innerHTML = "";
        const effSort = sortOverride || state.sort || "year_asc";
        if (sortOverride) state.sort = sortOverride;
        setBusyState(true, "🍿 Lade Filmreihe...");
        try {
          const r = await apiFetchJson(API_BASE + "/collections?id=" + encodeURIComponent(colId) + "&sort=" + encodeURIComponent(effSort));
          if (!r || !r.ok) return;
          state.isSearchMode = false;
          state.currentView = "collection";
          if (typeof updateFloatingImportStatusBarDom === "function") updateFloatingImportStatusBarDom();
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

      async function openUniverseView(uniId, sortOverride = null) {
        document.getElementById("modalRoot").innerHTML = "";
        const effSort = sortOverride || state.sort || "year_asc";
        if (sortOverride) state.sort = sortOverride;
        setBusyState(true, "🌌 Lade Filmuniversum...");
        try {
          const r = await apiFetchJson(API_BASE + "/universes?id=" + encodeURIComponent(uniId) + "&sort=" + encodeURIComponent(effSort));
          if (!r || !r.ok) return;
          state.isSearchMode = false;
          state.currentView = "universe";
          if (typeof updateFloatingImportStatusBarDom === "function") updateFloatingImportStatusBarDom();
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

      function buildActorAvatarFallbackSvgClient(actorName) {
        const clean = String(actorName || "Cast").trim();
        const parts = clean.split(/\\s+/).filter(Boolean);
        const initials = parts.length >= 2
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : clean.slice(0, 2).toUpperCase();
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360" viewBox="0 0 240 360">' +
          '<defs><linearGradient id="ag" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#090d18"/></linearGradient></defs>' +
          '<rect width="240" height="360" rx="12" fill="url(#ag)"/>' +
          '<circle cx="120" cy="128" r="44" fill="#334155"/>' +
          '<path d="M44 268 C44 198 196 198 196 268" fill="#334155"/>' +
          '<text x="120" y="142" fill="#f8fafc" font-family="sans-serif" font-size="30" font-weight="800" text-anchor="middle">' + esc(initials) + '</text>' +
        '</svg>';
        return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
      }

      function syncDetailCarouselSideButtonsClient(trackEl) {
        if (!trackEl) return;
        const wrap = trackEl.closest ? trackEl.closest(".detail-carousel-wrap") : null;
        if (!wrap) return;
        const prevBtn = wrap.querySelector(".detail-carousel-side-btn.prev");
        const nextBtn = wrap.querySelector(".detail-carousel-side-btn.next");
        const maxScroll = Math.max(0, trackEl.scrollWidth - trackEl.clientWidth);
        if (prevBtn) {
          prevBtn.classList.toggle("is-edge-disabled", trackEl.scrollLeft <= 6);
        }
        if (nextBtn) {
          nextBtn.classList.toggle("is-edge-disabled", maxScroll <= 6 || trackEl.scrollLeft >= maxScroll - 6);
        }
      }

      function scrollDetailHorizontalTrackClient(trackId, dir, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const el = document.getElementById(trackId);
        if (!el) return;
        const step = Math.max(260, Math.round(el.clientWidth * 0.76));
        try {
          el.scrollBy({ left: dir * step, behavior: "smooth" });
        } catch (_e) {
          el.scrollLeft += dir * step;
        }
        setTimeout(() => syncDetailCarouselSideButtonsClient(el), 320);
      }

      function initDetailHorizontalDragScrollClient(containerEl) {
        const root = containerEl || document.getElementById("modalRoot");
        if (!root) return;
        const tracks = root.querySelectorAll(".detail-cast-track, .detail-similar-track");
        tracks.forEach(track => {
          syncDetailCarouselSideButtonsClient(track);
          setTimeout(() => syncDetailCarouselSideButtonsClient(track), 140);
          if (track._dragScrollBound) return;
          track._dragScrollBound = true;
          let isDown = false;
          let startX = 0;
          let scrollLeftStart = 0;
          let movedDist = 0;

          track.addEventListener("scroll", () => {
            syncDetailCarouselSideButtonsClient(track);
          }, { passive: true });

          track.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            isDown = true;
            movedDist = 0;
            startX = e.pageX - track.offsetLeft;
            scrollLeftStart = track.scrollLeft;
          });
          track.addEventListener("mouseleave", () => {
            if (!isDown) return;
            isDown = false;
            track.classList.remove("is-dragging");
          });
          track.addEventListener("mouseup", () => {
            if (!isDown) return;
            isDown = false;
            track.classList.remove("is-dragging");
            if (movedDist > 7) {
              track._suppressClickUntil = Date.now() + 220;
            }
          });
          track.addEventListener("mousemove", (e) => {
            if (!isDown) return;
            const x = e.pageX - track.offsetLeft;
            const walk = x - startX;
            movedDist = Math.max(movedDist, Math.abs(walk));
            if (movedDist > 5) {
              e.preventDefault();
              track.classList.add("is-dragging");
              track.scrollLeft = scrollLeftStart - walk * 1.25;
            }
          });
          track.addEventListener("click", (e) => {
            if (track._suppressClickUntil && Date.now() < track._suppressClickUntil) {
              e.preventDefault();
              e.stopPropagation();
            }
          }, true);
        });
      }

      function scrollToDetailBelowFoldClient(ev, targetId = "detailContentBodyEl") {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const targetEl = document.getElementById(targetId) || document.getElementById("detailContentBodyEl");
        const modalBackdrop = document.querySelector("#modalRoot .modal-backdrop");
        if (modalBackdrop && targetEl) {
          const backdropRect = modalBackdrop.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          const offsetTop = modalBackdrop.scrollTop + (targetRect.top - backdropRect.top) - 12;
          if (typeof animateContainerScrollTopSmoothClient === "function") {
            animateContainerScrollTopSmoothClient(modalBackdrop, Math.max(0, offsetTop), 380);
          } else {
            modalBackdrop.scrollTo({ top: Math.max(0, offsetTop), behavior: "smooth" });
          }
          return;
        }
        if (targetEl && typeof targetEl.scrollIntoView === "function") {
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }

      // Reverse-Engineered Netflix Trailer-Engine:
      // Phase 1: Artwork-Hold (~1,45s ruhiges Szenenbild während Pre-Buffering im Hintergrund)
      // Phase 2: Verifizierter Crossfade (erst bei playerState === 1) + Klick/Tap auf Bühne -> Vordergrund
      // Phase 3: End-Fade zurück auf Szenenbild (1,45s vor Schluss gegen YouTube-Endscreen) + Scroll-Auto-Pause
      let detailBgTeaserTimer = null;
      let detailBgTeaserRevealTimer = null;
      let detailBgTeaserRevealTargetAt = 0;
      let detailBgTeaserDelayedPauseTimer = null;
      let detailBgTeaserWatchdogTimer = null;
      let detailBgTeaserHandshakeTimer = null;
      let detailBgTeaserStageOpenedAt = 0;
      let detailBgTeaserPlayingStartedAt = 0;
      let detailBgTeaserChromeShieldRequired = true;
      let detailBgTeaserMuted = true;
      let detailBgTeaserUserMuted = false;
      let detailBgTeaserPendingUnmute = false;
      let detailBgTeaserUnmuteRetries = 0;
      let detailBgTeaserUnmuteRetryTimers = [];
      let detailBgTeaserPaused = false;
      let detailBgTeaserEnded = false;
      let detailBgTeaserPausedByScroll = false;
      let detailBgTeaserIsPlayingConfirmed = false;
      let detailBgTeaserActiveKey = "";
      let detailBgTeaserCandidates = [];
      let detailBgTeaserCandidateIdx = 0;
      let detailBgTeaserStoppedByUser = false;
      let detailBgTeaserCurTime = 0;
      let detailBgTeaserDuration = 0;
      let detailBgTeaserScrubbing = false;
      let detailBgTeaserCcMode = "off";
      let detailBgTeaserSpeed = 1;
      let detailAutoOpenTrailerCancelled = false;
      const clientBlockedYoutubeKeys = new Set();

      function clearDetailUnmuteRetryTimersClient() {
        if (Array.isArray(detailBgTeaserUnmuteRetryTimers) && detailBgTeaserUnmuteRetryTimers.length) {
          detailBgTeaserUnmuteRetryTimers.forEach(t => clearTimeout(t));
          detailBgTeaserUnmuteRetryTimers = [];
        }
      }

      function enforceDetailForegroundUnmuteClient() {
        clearDetailUnmuteRetryTimersClient();
        detailBgTeaserUserMuted = false;
        detailBgTeaserMuted = false;
        detailBgTeaserPendingUnmute = true;
        detailBgTeaserUnmuteRetries = 0;
        window._detailUnmuteGraceUntil = Date.now() + 3000;
        const applyOnce = () => {
          const st = document.getElementById("detailHeroStageEl");
          if (!st || !st.classList.contains("is-trailer-foreground-mode") || detailBgTeaserUserMuted) return;
          const targetVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
          sendYoutubeBgTeaserCommandClient("unMute");
          sendYoutubeBgTeaserCommandClient("setVolume", [targetVol]);
        };
        applyOnce();
        detailBgTeaserUnmuteRetryTimers.push(setTimeout(applyOnce, 240));
        detailBgTeaserUnmuteRetryTimers.push(setTimeout(applyOnce, 680));
      }

      function formatTrailerDockTimeClient(secInput) {
        const s = Math.max(0, Math.floor(Number(secInput) || 0));
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return mins + ":" + (secs < 10 ? "0" + secs : secs);
      }

      function setDetailTrailerLoadingBadgeClient(visible, text = "🎬 Trailer startet…") {
        const badge = document.getElementById("detailSeekRippleBadge");
        if (!badge) return;
        if (visible) {
          if (detailSeekRippleTimer) {
            clearTimeout(detailSeekRippleTimer);
            detailSeekRippleTimer = null;
          }
          badge.className = "detail-seek-ripple-badge is-center is-loading-pulse";
          badge.textContent = text;
        } else if (badge.classList.contains("is-loading-pulse")) {
          badge.classList.remove("is-loading-pulse", "is-visible");
        }
      }

      function extractCandidateKeysFromTrailersClient(trailersInput) {
        if (!trailersInput) return [];
        if (typeof trailersInput === "string") {
          const k = trailersInput.trim();
          return k && !clientBlockedYoutubeKeys.has(k) ? [k] : [];
        }
        if (typeof registerTrailerMetaMapClient === "function") {
          registerTrailerMetaMapClient(trailersInput);
        }
        const rawArr = Array.isArray(trailersInput.candidates) && trailersInput.candidates.length > 0
          ? trailersInput.candidates
          : (trailersInput.key ? [trailersInput.key] : []);
        const seen = new Set();
        const out = [];
        for (const item of rawArr) {
          const k = String(item || "").trim();
          if (!k || seen.has(k) || clientBlockedYoutubeKeys.has(k)) continue;
          seen.add(k);
          out.push(k);
        }
        return out;
      }

      function clearDetailBgTeaserTimersClient() {
        if (detailBgTeaserTimer) {
          clearTimeout(detailBgTeaserTimer);
          detailBgTeaserTimer = null;
        }
        if (detailBgTeaserRevealTimer) {
          clearTimeout(detailBgTeaserRevealTimer);
          detailBgTeaserRevealTimer = null;
        }
        detailBgTeaserRevealTargetAt = 0;
        if (detailBgTeaserDelayedPauseTimer) {
          clearTimeout(detailBgTeaserDelayedPauseTimer);
          detailBgTeaserDelayedPauseTimer = null;
        }
        if (detailBgTeaserWatchdogTimer) {
          clearTimeout(detailBgTeaserWatchdogTimer);
          detailBgTeaserWatchdogTimer = null;
        }
        if (detailBgTeaserHandshakeTimer) {
          clearInterval(detailBgTeaserHandshakeTimer);
          detailBgTeaserHandshakeTimer = null;
        }
        stopDetailCinemaLiveClockClient();
        clearDetailUnmuteRetryTimersClient();
      }

      let detailBgTeaserPreloadedParked = false;
      let detailBgTeaserLastInfoAt = 0;
      let detailCinemaLiveClockTimer = null;
      let detailCinemaLiveClockLastTickAt = 0;
      let detailCinemaLiveClockPingCount = 0;
      let detailCinemaDockIdleTimer = null;
      let detailCinemaEndcardTimer = null;
      let detailCinemaEndcardSecondsLeft = 0;

      function stopDetailCinemaLiveClockClient() {
        if (detailCinemaLiveClockTimer) {
          clearInterval(detailCinemaLiveClockTimer);
          detailCinemaLiveClockTimer = null;
        }
        detailCinemaLiveClockLastTickAt = 0;
        detailCinemaLiveClockPingCount = 0;
      }

      function ensureDetailCinemaLiveClockClient() {
        if (detailCinemaLiveClockTimer) return;
        detailCinemaLiveClockLastTickAt = Date.now();
        detailCinemaLiveClockPingCount = 0;
        detailCinemaLiveClockTimer = setInterval(() => {
          const liveStage = document.getElementById("detailHeroStageEl");
          const isFgLive = Boolean(liveStage && liveStage.classList.contains("is-trailer-foreground-mode"));
          if (!isFgLive || !detailBgTeaserActiveKey || detailBgTeaserPaused || detailBgTeaserEnded) {
            stopDetailCinemaLiveClockClient();
            return;
          }
          const now = Date.now();
          const dtSec = Math.max(0, Math.min(2.5, (now - (detailCinemaLiveClockLastTickAt || now)) / 1000));
          detailCinemaLiveClockLastTickAt = now;
          if (detailBgTeaserScrubbing) return;
          const infoStale = !detailBgTeaserLastInfoAt || (now - detailBgTeaserLastInfoAt) >= 1100;
          if (infoStale && (detailBgTeaserIsPlayingConfirmed || (detailBgTeaserStageOpenedAt && (now - detailBgTeaserStageOpenedAt) >= 1400))) {
            const spd = Number(detailBgTeaserSpeed || 1) > 0 ? Number(detailBgTeaserSpeed || 1) : 1;
            const nextSec = (Number(detailBgTeaserCurTime) || 0) + (dtSec * spd);
            detailBgTeaserCurTime = detailBgTeaserDuration > 0 ? Math.min(detailBgTeaserDuration, nextSec) : nextSec;
            detailBgTeaserIsPlayingConfirmed = true;
            syncDetailCinemaDockUiClient();
          }
          detailCinemaLiveClockPingCount += 1;
          if ((detailBgTeaserDuration <= 0 || infoStale) && (detailCinemaLiveClockPingCount % 4 === 1)) {
            const frame = document.getElementById("detailBgVideoIframe");
            if (frame && frame.contentWindow) {
              try {
                frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 2, channel: "widget" }), "*");
              } catch (_dpe) {}
            }
          }
        }, 500);
      }

      function renderDetailCinemaEndcardCloseBtnLabelClient(secondsLeft) {
        const closeBtn = document.getElementById("detailCinemaEndCloseBtn");
        if (!closeBtn) return;
        const lbl = closeBtn.querySelector("span");
        if (!lbl) return;
        if (secondsLeft > 0) {
          lbl.innerHTML = 'Schließen <span class="cinema-end-countdown-num">(' + secondsLeft + 's)</span>';
        } else {
          lbl.textContent = "Schließen";
        }
      }

      function cancelDetailCinemaEndcardCountdownClient(resetLabel = true) {
        if (detailCinemaEndcardTimer) {
          clearInterval(detailCinemaEndcardTimer);
          detailCinemaEndcardTimer = null;
        }
        detailCinemaEndcardSecondsLeft = 0;
        if (resetLabel) {
          renderDetailCinemaEndcardCloseBtnLabelClient(0);
        }
      }

      function startDetailCinemaEndcardCountdownClient() {
        cancelDetailCinemaEndcardCountdownClient(false);
        const stageEl = document.getElementById("detailHeroStageEl");
        if (!stageEl || !stageEl.classList.contains("is-trailer-foreground-mode") || !detailBgTeaserEnded) return;
        detailCinemaEndcardSecondsLeft = 20;
        renderDetailCinemaEndcardCloseBtnLabelClient(detailCinemaEndcardSecondsLeft);
        detailCinemaEndcardTimer = setInterval(() => {
          const liveStage = document.getElementById("detailHeroStageEl");
          if (!liveStage || !liveStage.classList.contains("is-trailer-foreground-mode") || !detailBgTeaserEnded) {
            cancelDetailCinemaEndcardCountdownClient(true);
            return;
          }
          detailCinemaEndcardSecondsLeft -= 1;
          if (detailCinemaEndcardSecondsLeft <= 0) {
            cancelDetailCinemaEndcardCountdownClient(true);
            exitDetailForegroundTrailerModeClient();
            return;
          }
          renderDetailCinemaEndcardCloseBtnLabelClient(detailCinemaEndcardSecondsLeft);
        }, 1000);
      }

      function wakeDetailCinemaDockClient() {
        const dock = document.getElementById("detailCinemaPlayerDock");
        const topHud = document.getElementById("detailCinemaTopHud");
        const catcher = document.getElementById("detailForegroundStageCatcher");
        const stageEl = document.getElementById("detailHeroStageEl");
        if (dock) dock.classList.remove("is-idle-hidden");
        if (topHud) topHud.classList.remove("is-idle-hidden");
        if (catcher) catcher.classList.remove("is-cursor-idle");
        if (stageEl) stageEl.classList.remove("is-cinema-controls-idle");
        if (detailCinemaDockIdleTimer) {
          clearTimeout(detailCinemaDockIdleTimer);
          detailCinemaDockIdleTimer = null;
        }
        const isForeground = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));
        if (!isForeground || detailBgTeaserPaused || detailBgTeaserEnded || detailBgTeaserScrubbing) {
          return;
        }
        const isKbMode = Boolean(document.body && document.body.classList.contains("kb-nav-mode"));
        const idleDelayMs = isKbMode ? 3600 : 2800;
        detailCinemaDockIdleTimer = setTimeout(() => {
          detailCinemaDockIdleTimer = null;
          const liveDock = document.getElementById("detailCinemaPlayerDock");
          const liveTopHud = document.getElementById("detailCinemaTopHud");
          const liveStage = document.getElementById("detailHeroStageEl");
          const liveCatcher = document.getElementById("detailForegroundStageCatcher");
          if (!liveDock || !liveStage || !liveStage.classList.contains("is-trailer-foreground-mode")) return;
          if (detailBgTeaserPaused || detailBgTeaserEnded || detailBgTeaserScrubbing) return;
          if (typeof isCinemaDockPointerInteractingClient === "function" && isCinemaDockPointerInteractingClient("detail")) {
            wakeDetailCinemaDockClient();
            return;
          }
          if (typeof syncCinemaVolPopoverFocusStateClient === "function") {
            syncCinemaVolPopoverFocusStateClient(null);
          }
          liveDock.classList.add("is-idle-hidden");
          if (liveTopHud) liveTopHud.classList.add("is-idle-hidden");
          if (liveCatcher) liveCatcher.classList.add("is-cursor-idle");
          liveStage.classList.add("is-cinema-controls-idle");
        }, idleDelayMs);
      }

      // Blendet das Video erst ein, nachdem YouTubes eigene Start-/Seek-/Resume-Leisten vollständig ausgeblendet sind
      // UND der Nutzer den Trailer per Tipp/Button in den Vordergrund-Modus geholt hat.
      // WICHTIG: Überschreibt niemals einen bereits laufenden früheren Reveal-Timer nach hinten (kein Timer-Reset bei Mehrfach-Tipp!).
      function scheduleDetailRevealAfterYoutubeChromeHidesClient(holdMs = 1550, forceReset = false) {
        if (detailBgTeaserDelayedPauseTimer) {
          clearTimeout(detailBgTeaserDelayedPauseTimer);
          detailBgTeaserDelayedPauseTimer = null;
        }
        const safeHoldMs = Math.max(350, Number(holdMs) || 1550);
        const now = Date.now();
        const proposedTargetAt = now + safeHoldMs;
        const stageEl = document.getElementById("detailHeroStageEl");
        const isFgNow = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));

        if (detailBgTeaserRevealTimer && !forceReset && detailBgTeaserRevealTargetAt > now) {
          if (proposedTargetAt >= detailBgTeaserRevealTargetAt - 80) {
            if (isFgNow && stageEl) {
              stageEl.classList.add("is-cinema-starting");
            }
            return;
          }
          clearTimeout(detailBgTeaserRevealTimer);
          detailBgTeaserRevealTimer = null;
        } else if (detailBgTeaserRevealTimer) {
          clearTimeout(detailBgTeaserRevealTimer);
          detailBgTeaserRevealTimer = null;
        }

        detailBgTeaserChromeShieldRequired = true;
        detailBgTeaserRevealTargetAt = proposedTargetAt;
        const layer = document.getElementById("detailBgVideoLayer");
        if (isFgNow) {
          // Kein Vollbild-Backcover im Vordergrund: Video sofort zeigen, nur gezielte Start-Ersatzoverlays über YouTube-Center/Leisten!
          if (layer) {
            layer.classList.remove("is-concealing");
            layer.classList.add("is-playing");
          }
          if (stageEl) stageEl.classList.add("is-cinema-starting");
          setDetailTrailerLoadingBadgeClient(false);
        } else if (layer) {
          layer.classList.remove("is-playing");
        }

        detailBgTeaserRevealTimer = setTimeout(() => {
          detailBgTeaserRevealTimer = null;
          detailBgTeaserRevealTargetAt = 0;
          const liveLayer = document.getElementById("detailBgVideoLayer");
          const liveStage = document.getElementById("detailHeroStageEl");
          const isFg = Boolean(liveStage && liveStage.classList.contains("is-trailer-foreground-mode"));
          if (
            liveLayer &&
            !detailBgTeaserPaused &&
            !detailBgTeaserEnded &&
            !detailBgTeaserStoppedByUser &&
            !detailBgTeaserPausedByScroll
          ) {
            const elapsedSinceMount = Date.now() - (detailBgTeaserStageOpenedAt || Date.now());
            if (detailBgTeaserIsPlayingConfirmed || (isFg && elapsedSinceMount >= 1500)) {
              detailBgTeaserIsPlayingConfirmed = true;
              if (!isFg) {
                detailBgTeaserPreloadedParked = true;
                detailBgTeaserPaused = true;
                detailBgTeaserChromeShieldRequired = true;
                liveLayer.classList.remove("is-playing", "is-concealing");
                if (liveStage) liveStage.classList.remove("is-cinema-starting");
                setDetailTrailerLoadingBadgeClient(false);
                sendYoutubeBgTeaserCommandClient("pauseVideo");
                syncDetailCinemaDockUiClient();
                return;
              }
              detailBgTeaserPreloadedParked = false;
              detailBgTeaserChromeShieldRequired = false;
              liveLayer.classList.remove("is-concealing");
              liveLayer.classList.add("is-playing");
              if (liveStage) liveStage.classList.remove("is-cinema-starting");
              setDetailTrailerLoadingBadgeClient(false);
              if (detailBgTeaserPendingUnmute || !detailBgTeaserMuted) {
                detailBgTeaserPendingUnmute = false;
                detailBgTeaserMuted = false;
                sendYoutubeBgTeaserCommandClient("unMute");
                sendYoutubeBgTeaserCommandClient("setVolume", [getSavedTrailerVolumeClient()]);
              }
              applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
              if (detailBgTeaserSpeed !== 1) {
                sendYoutubeBgTeaserCommandClient("setPlaybackRate", [detailBgTeaserSpeed]);
              }
              ensureDetailCinemaLiveClockClient();
              wakeDetailCinemaDockClient();
            } else {
              sendYoutubeBgTeaserCommandClient("playVideo");
              scheduleDetailRevealAfterYoutubeChromeHidesClient(750, true);
              return;
            }
          } else {
            if (liveStage) liveStage.classList.remove("is-cinema-starting");
            setDetailTrailerLoadingBadgeClient(false);
          }
          syncDetailCinemaDockUiClient();
        }, safeHoldMs);
      }

      // Cover-First, Pause-Second: Blendet zuerst das Szenenbild über das noch laufende Video und pausiert YouTube erst im verdeckten Zustand
      function concealAndPauseDetailTrailerClient(opts = {}) {
        if (detailBgTeaserRevealTimer) {
          clearTimeout(detailBgTeaserRevealTimer);
          detailBgTeaserRevealTimer = null;
        }
        detailBgTeaserRevealTargetAt = 0;
        if (detailBgTeaserDelayedPauseTimer) {
          clearTimeout(detailBgTeaserDelayedPauseTimer);
          detailBgTeaserDelayedPauseTimer = null;
        }
        stopDetailCinemaLiveClockClient();
        setDetailTrailerLoadingBadgeClient(false);
        detailBgTeaserPaused = true;
        detailBgTeaserChromeShieldRequired = true;
        if (typeof opts.stoppedByUser === "boolean") {
          detailBgTeaserStoppedByUser = opts.stoppedByUser;
        }
        if (typeof opts.pausedByScroll === "boolean") {
          detailBgTeaserPausedByScroll = opts.pausedByScroll;
        }
        if (typeof opts.ended === "boolean") {
          detailBgTeaserEnded = opts.ended;
        }
        const stageEl = document.getElementById("detailHeroStageEl");
        if (stageEl) {
          stageEl.classList.remove("is-cinema-starting");
          if (opts.exitForeground) {
            stageEl.classList.remove("is-trailer-foreground-mode");
          }
        }
        const layer = document.getElementById("detailBgVideoLayer");
        if (layer) {
          layer.classList.add("is-concealing");
          layer.classList.remove("is-playing");
        }
        syncDetailCinemaDockUiClient();
        const pauseDelayMs = typeof opts.pauseDelayMs === "number" ? opts.pauseDelayMs : 220;
        detailBgTeaserDelayedPauseTimer = setTimeout(() => {
          detailBgTeaserDelayedPauseTimer = null;
          const liveLayer = document.getElementById("detailBgVideoLayer");
          if (liveLayer) {
            liveLayer.classList.remove("is-concealing");
          }
          if (detailBgTeaserPaused || detailBgTeaserEnded) {
            sendYoutubeBgTeaserCommandClient("pauseVideo");
          }
        }, pauseDelayMs);
      }

      function resumeDetailTrailerWithBackdropShieldClient(opts = {}) {
        const wasPendingPauseOnly = Boolean(detailBgTeaserDelayedPauseTimer && !detailBgTeaserEnded);
        const wasPreloadedParked = detailBgTeaserPreloadedParked;
        detailBgTeaserPreloadedParked = false;
        if (detailBgTeaserDelayedPauseTimer) {
          clearTimeout(detailBgTeaserDelayedPauseTimer);
          detailBgTeaserDelayedPauseTimer = null;
        }
        detailBgTeaserPaused = false;
        detailBgTeaserPausedByScroll = false;
        detailBgTeaserStoppedByUser = false;
        const stageElForResume = document.getElementById("detailHeroStageEl");
        const layer = document.getElementById("detailBgVideoLayer");
        if (layer) {
          layer.classList.remove("is-concealing");
        }
        if (detailBgTeaserEnded && opts.restartIfEnded !== false) {
          detailBgTeaserEnded = false;
          detailBgTeaserCurTime = 0;
          detailBgTeaserChromeShieldRequired = false;
          if (stageElForResume) stageElForResume.classList.remove("is-cinema-starting");
          setDetailTrailerLoadingBadgeClient(false);
          if (layer) layer.classList.add("is-playing");
          sendYoutubeBgTeaserCommandClient("seekTo", [0, true]);
          sendYoutubeBgTeaserCommandClient("playVideo");
          if (detailBgTeaserPendingUnmute || !detailBgTeaserMuted) {
            const targetVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
            sendYoutubeBgTeaserCommandClient("unMute");
            sendYoutubeBgTeaserCommandClient("setVolume", [targetVol]);
          }
          applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
          ensureDetailCinemaLiveClockClient();
          wakeDetailCinemaDockClient();
          syncDetailCinemaDockUiClient();
          return;
        }
        if ((wasPendingPauseOnly || (layer && layer.classList.contains("is-playing"))) && detailBgTeaserIsPlayingConfirmed && !wasPreloadedParked) {
          detailBgTeaserChromeShieldRequired = false;
          if (stageElForResume) stageElForResume.classList.remove("is-cinema-starting");
          setDetailTrailerLoadingBadgeClient(false);
          if (layer) layer.classList.add("is-playing");
          sendYoutubeBgTeaserCommandClient("playVideo");
          if (detailBgTeaserPendingUnmute || !detailBgTeaserMuted) {
            const targetVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
            sendYoutubeBgTeaserCommandClient("unMute");
            sendYoutubeBgTeaserCommandClient("setVolume", [targetVol]);
          }
          applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
          ensureDetailCinemaLiveClockClient();
          wakeDetailCinemaDockClient();
          syncDetailCinemaDockUiClient();
          return;
        }
        detailBgTeaserChromeShieldRequired = true;
        const isFgResume = Boolean(stageElForResume && stageElForResume.classList.contains("is-trailer-foreground-mode"));
        if (layer) {
          if (isFgResume) layer.classList.add("is-playing");
          else layer.classList.remove("is-playing");
        }
        if (wasPreloadedParked && detailBgTeaserCurTime <= 6) {
          detailBgTeaserCurTime = 0;
          sendYoutubeBgTeaserCommandClient("seekTo", [0, true]);
        }
        sendYoutubeBgTeaserCommandClient("playVideo");
        if (detailBgTeaserPendingUnmute || !detailBgTeaserMuted) {
          const targetVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
          sendYoutubeBgTeaserCommandClient("unMute");
          sendYoutubeBgTeaserCommandClient("setVolume", [targetVol]);
        }
        applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
        scheduleDetailRevealAfterYoutubeChromeHidesClient(wasPreloadedParked ? 1850 : 1250, true);
        if (isFgResume) ensureDetailCinemaLiveClockClient();
        syncDetailCinemaDockUiClient();
      }

      function syncDetailTrailerAvailabilityUiClient(hasTrailer, isSeedOnly = false, count = 0) {
        const trBtn = document.getElementById("detailTrailerBtn");
        const primaryBtn = document.getElementById("detailPrimaryPlayBtn");
        const isPrimaryTrailerBtn = Boolean(primaryBtn && String(primaryBtn.getAttribute("onclick") || "").includes("enterDetailForegroundTrailerModeClient"));
        if (isSeedOnly) {
          if (trBtn) {
            trBtn.classList.remove("is-trailer-unavailable");
            trBtn.innerHTML = "🎬 Trailer";
          }
          if (isPrimaryTrailerBtn && primaryBtn) {
            primaryBtn.classList.remove("is-trailer-unavailable");
            primaryBtn.innerHTML = "▶ Trailer";
          }
          return;
        }
        if (trBtn) {
          trBtn.classList.toggle("is-trailer-unavailable", !hasTrailer);
          trBtn.innerHTML = hasTrailer ? "🎬 Trailer" : "🔎 Trailer suchen";
          trBtn.setAttribute(
            "title",
            hasTrailer
              ? (count > 1 ? ("Trailer im Vordergrund abspielen (" + count + " Clips verfügbar)") : "Alle Elemente ausblenden & Trailer im Vordergrund abspielen")
              : "Kein direkt abspielbarer Trailer gefunden – YouTube-Suche öffnen"
          );
        }
        if (isPrimaryTrailerBtn && primaryBtn) {
          primaryBtn.classList.toggle("is-trailer-unavailable", !hasTrailer);
          primaryBtn.innerHTML = hasTrailer ? "▶ Trailer" : "🔎 Trailer auf YouTube";
          primaryBtn.setAttribute(
            "title",
            hasTrailer
              ? "Trailer direkt im Vordergrund abspielen"
              : "Kein direkt abspielbarer Trailer gefunden – YouTube-Suche öffnen"
          );
        }
      }

      function activateDetailKenBurnsFallbackClient() {
        clearDetailBgTeaserTimersClient();
        setDetailTrailerLoadingBadgeClient(false);
        detailBgTeaserActiveKey = "";
        detailBgTeaserIsPlayingConfirmed = false;
        detailBgTeaserEnded = false;
        if (state.activeDetails) {
          state.activeDetails.hasTrailer = false;
        }
        syncDetailTrailerAvailabilityUiClient(false, false, 0);
        const stageEl = document.getElementById("detailHeroStageEl");
        if (stageEl) {
          stageEl.classList.remove("is-trailer-foreground-mode", "is-cinema-starting", "is-cinema-paused", "is-cinema-ended", "is-cc-safe-framing");
          const backdropLayer = stageEl.querySelector(".detail-backdrop-layer");
          if (backdropLayer) backdropLayer.classList.add("is-ken-burns-active");
        }
        const layer = document.getElementById("detailBgVideoLayer");
        if (layer) {
          layer.classList.remove("is-playing", "is-concealing");
          layer.innerHTML = "";
        }
        const dock = document.getElementById("detailCinemaPlayerDock");
        if (dock) {
          dock.classList.remove("is-ready");
        }
      }

      let detailFgTapTimer = null;
      let detailFgLastTapAt = 0;
      let detailSeekRippleTimer = null;

      function showDetailSeekRippleBadgeClient(text, zone = "center", opts = null) {
        const badge = document.getElementById("detailSeekRippleBadge");
        if (!badge) return;
        if (detailSeekRippleTimer) {
          clearTimeout(detailSeekRippleTimer);
          detailSeekRippleTimer = null;
        }
        const isHtmlIcon = Boolean(opts && opts.isHtmlIcon);
        const holdMs = Math.max(260, Number(opts && opts.durationMs) || 680);
        badge.className = "detail-seek-ripple-badge is-" + (zone === "left" || zone === "right" ? zone : "center") + (isHtmlIcon ? " is-icon-circle" : "");
        if (isHtmlIcon) {
          badge.innerHTML = text;
        } else {
          badge.textContent = text;
        }
        requestAnimationFrame(() => {
          badge.classList.add("is-visible");
        });
        detailSeekRippleTimer = setTimeout(() => {
          badge.classList.remove("is-visible");
          detailSeekRippleTimer = null;
        }, holdMs);
      }

      function seekDetailCinemaRelativeClient(deltaSec, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeDetailCinemaDockClient();
        const frame = document.getElementById("detailBgVideoIframe");
        if (!frame || !detailBgTeaserActiveKey) return;
        const maxDur = detailBgTeaserDuration > 3.5 ? Math.max(1, detailBgTeaserDuration - 3.3) : 9999;
        const nextSec = Math.max(0, Math.min(maxDur, (detailBgTeaserCurTime || 0) + Number(deltaSec || 0)));
        detailBgTeaserCurTime = nextSec;
        detailBgTeaserEnded = false;
        if (detailBgTeaserDelayedPauseTimer) {
          clearTimeout(detailBgTeaserDelayedPauseTimer);
          detailBgTeaserDelayedPauseTimer = null;
        }
        sendYoutubeBgTeaserCommandClient("seekTo", [nextSec, true]);
        if (detailBgTeaserPaused) {
          detailBgTeaserPaused = false;
          detailBgTeaserPausedByScroll = false;
          detailBgTeaserStoppedByUser = false;
          sendYoutubeBgTeaserCommandClient("playVideo");
        }
        scheduleDetailRevealAfterYoutubeChromeHidesClient(1150, true);
        syncDetailCinemaDockUiClient();
        showDetailSeekRippleBadgeClient(
          deltaSec < 0 ? ("⏪ " + deltaSec + "s") : ("⏩ +" + deltaSec + "s"),
          deltaSec < 0 ? "left" : "right"
        );
      }

      function restartDetailCinemaTrailerClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeDetailCinemaDockClient();
        const frame = document.getElementById("detailBgVideoIframe");
        if (!frame || !detailBgTeaserActiveKey) return;
        detailBgTeaserCurTime = 0;
        detailBgTeaserEnded = false;
        detailBgTeaserPaused = false;
        detailBgTeaserPausedByScroll = false;
        detailBgTeaserStoppedByUser = false;
        if (detailBgTeaserDelayedPauseTimer) {
          clearTimeout(detailBgTeaserDelayedPauseTimer);
          detailBgTeaserDelayedPauseTimer = null;
        }
        sendYoutubeBgTeaserCommandClient("seekTo", [0, true]);
        sendYoutubeBgTeaserCommandClient("playVideo");
        applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
        scheduleDetailRevealAfterYoutubeChromeHidesClient(1150, true);
        syncDetailCinemaDockUiClient();
        showDetailSeekRippleBadgeClient("⏮ 0:00 Neustart", "center");
      }

      function switchNextDetailTrailerCandidateManualClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeDetailCinemaDockClient();
        if (!Array.isArray(detailBgTeaserCandidates) || detailBgTeaserCandidates.length <= 1) return;
        const nextIdx = (detailBgTeaserCandidateIdx + 1) % detailBgTeaserCandidates.length;
        const keepUnmuted = !detailBgTeaserMuted || Boolean(document.getElementById("detailHeroStageEl")?.classList.contains("is-trailer-foreground-mode"));
        detailBgTeaserStoppedByUser = false;
        mountDetailTrailerCandidateAtIndexClient(nextIdx, keepUnmuted, 0);
        syncDetailCinemaDockUiClient();
        const nextMeta = getTrailerCandidateMetaClient(detailBgTeaserCandidates[nextIdx]);
        const langSuffix = nextMeta.lang ? (" · " + nextMeta.lang.toUpperCase()) : "";
        const subSuffix = detailBgTeaserCcMode !== "off" ? " · UT DE" : "";
        showDetailSeekRippleBadgeClient("⏭ Clip " + (nextIdx + 1) + "/" + detailBgTeaserCandidates.length + langSuffix + subSuffix, "center");
      }

      function onForegroundStageCatcherTapClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const stageEl = document.getElementById("detailHeroStageEl");
        if (!stageEl) return;
        const dock = document.getElementById("detailCinemaPlayerDock");
        const wasDockIdleHidden = Boolean(dock && dock.classList.contains("is-idle-hidden"));
        wakeDetailCinemaDockClient();
        const now = Date.now();
        let clientX = 0;
        if (ev && typeof ev.clientX === "number" && ev.clientX > 0) {
          clientX = ev.clientX;
        } else if (ev && ev.changedTouches && ev.changedTouches[0]) {
          clientX = ev.changedTouches[0].clientX;
        }
        const rect = stageEl.getBoundingClientRect();
        const relX = rect.width > 0 ? ((clientX - rect.left) / rect.width) : 0.5;

        if (now - detailFgLastTapAt < 270) {
          // Doppel-Tipp erkannt! Links = -10s, Rechts = +10s, Mitte = Play/Pause
          detailFgLastTapAt = 0;
          if (detailFgTapTimer) {
            clearTimeout(detailFgTapTimer);
            detailFgTapTimer = null;
          }
          if (relX < 0.38 && detailBgTeaserActiveKey) {
            seekDetailCinemaRelativeClient(-10, ev);
          } else if (relX > 0.62 && detailBgTeaserActiveKey) {
            seekDetailCinemaRelativeClient(10, ev);
          } else if (detailBgTeaserActiveKey) {
            toggleDetailCinemaPlayPauseClient(ev);
          }
          return;
        }

        // Wenn der Trailer im Vordergrund-Modus gerade noch im kurzen Vorlauf steckt, bricht ein Tipp den Modus NICHT ab!
        const layer = document.getElementById("detailBgVideoLayer");
        if ((stageEl.classList.contains("is-cinema-starting") || (layer && !layer.classList.contains("is-playing"))) && detailBgTeaserActiveKey && !detailBgTeaserPaused && !detailBgTeaserEnded) {
          sendYoutubeBgTeaserCommandClient("playVideo");
          sendYoutubeBgTeaserCommandClient("unMute");
          sendYoutubeBgTeaserCommandClient("setVolume", [getSavedTrailerVolumeClient()]);
          applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
          return;
        }

        detailFgLastTapAt = now;
        if (detailFgTapTimer) {
          clearTimeout(detailFgTapTimer);
        }
        detailFgTapTimer = setTimeout(() => {
          detailFgTapTimer = null;
          detailFgLastTapAt = 0;
          if (!detailBgTeaserActiveKey) {
            exitDetailForegroundTrailerModeClient(ev);
            return;
          }
          if (detailBgTeaserPaused && !detailBgTeaserEnded) {
            toggleDetailCinemaPlayPauseClient(ev);
            return;
          }
          if (wasDockIdleHidden && !detailBgTeaserPaused && !detailBgTeaserEnded) {
            wakeDetailCinemaDockClient();
            return;
          }
          toggleDetailCinemaPlayPauseClient(ev);
        }, 255);
      }

      function finishDetailTrailerToArtworkClient() {
        concealAndPauseDetailTrailerClient({
          ended: true,
          pausedByScroll: false,
          exitForeground: true,
          pauseDelayMs: 430
        });
      }

      function syncDetailCinemaDockUiClient() {
        const dock = document.getElementById("detailCinemaPlayerDock");
        if (!dock) return;
        const topHud = document.getElementById("detailCinemaTopHud");
        const stageEl = document.getElementById("detailHeroStageEl");
        const isForeground = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));
        const hasVideoControls = Boolean(detailBgTeaserActiveKey || detailBgTeaserIsPlayingConfirmed);
        const ccActive = detailBgTeaserCcMode === "de" || detailBgTeaserCcMode === "en";
        if (stageEl) {
          stageEl.classList.toggle("is-cc-safe-framing", ccActive);
          stageEl.classList.toggle("is-cinema-paused", Boolean(isForeground && detailBgTeaserPaused && !detailBgTeaserEnded && hasVideoControls));
          stageEl.classList.toggle("is-cinema-ended", Boolean(isForeground && detailBgTeaserEnded && hasVideoControls));
          if (!isForeground || detailBgTeaserPaused || detailBgTeaserEnded || (detailBgTeaserIsPlayingConfirmed && !detailBgTeaserChromeShieldRequired && !detailBgTeaserRevealTimer && !detailBgTeaserScrubbing)) {
            stageEl.classList.remove("is-cinema-starting");
          }
          if (!isForeground || !detailBgTeaserEnded) {
            cancelDetailCinemaEndcardCountdownClient(true);
          }
        }
        dock.classList.toggle("is-ready", Boolean(isForeground));
        if (!isForeground || detailBgTeaserPaused || detailBgTeaserEnded) {
          dock.classList.remove("is-idle-hidden");
          if (topHud) topHud.classList.remove("is-idle-hidden");
          if (stageEl) stageEl.classList.remove("is-cinema-controls-idle");
          const catcher = document.getElementById("detailForegroundStageCatcher");
          if (catcher) catcher.classList.remove("is-cursor-idle");
        }

        const activeD = (typeof state !== "undefined" && state.activeDetails) ? state.activeDetails : null;
        const dTitle = activeD ? String(activeD.title || "").trim() : "";
        const dYear = activeD ? String(activeD.year || "").trim() : "";
        const topTitleEl = document.getElementById("detailCinemaTopTitle");
        if (topTitleEl && dTitle) topTitleEl.textContent = dTitle;
        const topMetaEl = document.getElementById("detailCinemaTopMeta");
        if (topMetaEl) {
          topMetaEl.textContent = buildCinemaTopHudMetaTextClient(dYear, detailBgTeaserActiveKey, detailBgTeaserCcMode);
        }
        const endTitleEl = document.getElementById("detailCinemaEndTitle");
        if (endTitleEl && dTitle) endTitleEl.textContent = dTitle;

        const playBtn = document.getElementById("detailCinemaPlayBtn");
        if (playBtn) {
          playBtn.style.display = hasVideoControls ? "inline-flex" : "none";
          const nextPlayKey = detailBgTeaserEnded ? "replay" : (detailBgTeaserPaused ? "play" : "pause");
          if (playBtn.getAttribute("data-icon-state") !== nextPlayKey) {
            playBtn.setAttribute("data-icon-state", nextPlayKey);
            playBtn.innerHTML = CINEMA_ICONS_CLIENT[nextPlayKey];
          }
          if (detailBgTeaserEnded) {
            playBtn.title = "Trailer erneut abspielen";
          } else {
            playBtn.title = detailBgTeaserPaused ? "Trailer fortsetzen (Leertaste)" : "Trailer pausieren (Leertaste)";
          }
        }
        const restartBtn = document.getElementById("detailCinemaRestartBtn");
        if (restartBtn) {
          restartBtn.style.display = hasVideoControls ? "inline-flex" : "none";
        }
        const muteBtn = document.getElementById("detailCinemaMuteBtn");
        const curVol = getSavedTrailerVolumeClient();
        if (muteBtn) {
          muteBtn.style.display = hasVideoControls ? "inline-flex" : "none";
          const nextVolKey = (detailBgTeaserMuted || curVol <= 0) ? "volMute" : (curVol < 45 ? "volLow" : "volHigh");
          const miniPctVal = (detailBgTeaserMuted || curVol <= 0) ? "Aus" : (curVol + "%");
          if (muteBtn.getAttribute("data-icon-state") !== nextVolKey) {
            muteBtn.setAttribute("data-icon-state", nextVolKey);
            muteBtn.innerHTML = CINEMA_ICONS_CLIENT[nextVolKey] + '<span id="detailCinemaVolMiniPct" class="cinema-vol-mini-pct">' + miniPctVal + '</span>';
          }
          muteBtn.title = (detailBgTeaserMuted ? "Ton einschalten (Enter / M)" : "Ton stummschalten (Enter / M)") + " · Lautstärke: ↑ / ↓";
        }
        const volGroup = document.getElementById("detailCinemaVolGroup");
        if (volGroup) {
          volGroup.style.display = hasVideoControls ? "inline-flex" : "none";
        }
        if (typeof syncCinemaVolPopoverUiClient === "function") {
          syncCinemaVolPopoverUiClient("detail", curVol, detailBgTeaserMuted);
        }
        const timelineWrap = document.getElementById("detailCinemaTimelineWrap");
        if (timelineWrap) {
          timelineWrap.style.display = hasVideoControls ? "flex" : "none";
        }
        const ccBtn = document.getElementById("detailCinemaCcBtn");
        if (ccBtn) {
          ccBtn.style.display = hasVideoControls ? "inline-flex" : "none";
          const ccMeta = formatTrailerCcButtonMetaClient(detailBgTeaserCcMode);
          ccBtn.textContent = ccMeta.label;
          ccBtn.classList.toggle("is-cc-active", ccMeta.active);
          ccBtn.title = ccMeta.title;
        }
        const speedBtn = document.getElementById("detailCinemaSpeedBtn");
        if (speedBtn) {
          speedBtn.style.display = hasVideoControls ? "inline-flex" : "none";
          const spd = Number(detailBgTeaserSpeed || 1);
          speedBtn.textContent = spd + "×";
          speedBtn.classList.toggle("is-speed-active", Math.abs(spd - 1) > 0.05);
          speedBtn.title = "Wiedergabegeschwindigkeit (" + spd + "×) ändern (Taste S)";
        }
        const totalClips = Array.isArray(detailBgTeaserCandidates) ? detailBgTeaserCandidates.length : 0;
        const nextClipBtn = document.getElementById("detailCinemaNextClipBtn");
        if (nextClipBtn) {
          if (totalClips > 1 && hasVideoControls) {
            nextClipBtn.style.display = "inline-flex";
            const clipLabel = ((detailBgTeaserCandidateIdx % totalClips) + 1) + "/" + totalClips;
            if (nextClipBtn.getAttribute("data-clip-label") !== clipLabel) {
              nextClipBtn.setAttribute("data-clip-label", clipLabel);
              nextClipBtn.innerHTML = CINEMA_ICONS_CLIENT.nextClip + "<span>" + clipLabel + "</span>";
            }
            const curMeta = getTrailerCandidateMetaClient(detailBgTeaserActiveKey);
            const metaNote = (curMeta.lang ? curMeta.lang.toUpperCase() : "") + (curMeta.name ? (" · " + curMeta.name) : "");
            nextClipBtn.title = "Nächsten Trailer / Clip abspielen (Taste N)" + (metaNote ? (" – Aktuell: " + metaNote) : "");
          } else {
            nextClipBtn.style.display = "none";
          }
        }
        const pauseNextBtn = document.getElementById("detailCinemaPauseNextBtn");
        if (pauseNextBtn) pauseNextBtn.style.display = (totalClips > 1 && hasVideoControls) ? "inline-flex" : "none";
        const endNextBtn = document.getElementById("detailCinemaEndNextBtn");
        if (endNextBtn) endNextBtn.style.display = (totalClips > 1 && hasVideoControls) ? "inline-flex" : "none";
        const modeBtn = document.getElementById("detailCinemaModeBtn");
        if (modeBtn) {
          modeBtn.classList.toggle("is-active-mode", isForeground);
          const nextModeKey = isForeground ? "close" : "open";
          if (modeBtn.getAttribute("data-mode-state") !== nextModeKey) {
            modeBtn.setAttribute("data-mode-state", nextModeKey);
            modeBtn.innerHTML = isForeground ? (CINEMA_ICONS_CLIENT.close + "<span>Schließen</span>") : "<span>⛶ Kino</span>";
          }
          modeBtn.title = isForeground ? "Trailer beenden & Filminfos wieder einblenden (Esc)" : "Alle Elemente ausblenden & Trailer in den Vordergrund holen";
        }
        const timeLbl = document.getElementById("detailCinemaTimeLbl");
        if (timeLbl) {
          if (detailBgTeaserDuration > 0) {
            timeLbl.textContent = formatTrailerDockTimeClient(detailBgTeaserCurTime) + " / " + formatTrailerDockTimeClient(detailBgTeaserDuration);
          } else {
            const safeCur = detailBgTeaserIsPlayingConfirmed ? detailBgTeaserCurTime : 0;
            timeLbl.textContent = formatTrailerDockTimeClient(safeCur);
          }
        }
        const scrubber = document.getElementById("detailCinemaScrubber");
        if (scrubber) {
          const maxDur = detailBgTeaserDuration > 0 ? Math.floor(detailBgTeaserDuration) : 120;
          if (!detailBgTeaserScrubbing) {
            scrubber.max = String(maxDur);
            scrubber.value = String(Math.min(maxDur, Math.floor(detailBgTeaserCurTime || 0)));
          }
          const pct = maxDur > 0 ? Math.max(0, Math.min(100, ((Number(scrubber.value) || detailBgTeaserCurTime || 0) / maxDur) * 100)) : 0;
          scrubber.style.setProperty("--scrub-pct", pct.toFixed(1) + "%");
        }
        const legacyAudioBtn = document.getElementById("detailBgTeaserAudioBtn");
        if (legacyAudioBtn) {
          legacyAudioBtn.classList.toggle("teaser-active", Boolean(detailBgTeaserIsPlayingConfirmed));
          legacyAudioBtn.textContent = detailBgTeaserMuted ? "🔇 Ton an" : "🔊 Ton aus";
        }
      }

      function stopDetailBackgroundVideoTeaserClient(opts = {}) {
        const preserveForeground = Boolean(opts && opts.preserveForeground);
        clearDetailBgTeaserTimersClient();
        setDetailTrailerLoadingBadgeClient(false);
        if (detailFgTapTimer) {
          clearTimeout(detailFgTapTimer);
          detailFgTapTimer = null;
        }
        if (!preserveForeground && typeof syncCinemaVolPopoverFocusStateClient === "function") {
          syncCinemaVolPopoverFocusStateClient(null);
        }
        detailBgTeaserActiveKey = "";
        detailBgTeaserCandidates = [];
        detailBgTeaserCandidateIdx = 0;
        detailBgTeaserIsPlayingConfirmed = false;
        detailBgTeaserPreloadedParked = false;
        detailBgTeaserChromeShieldRequired = true;
        detailBgTeaserPendingUnmute = false;
        detailBgTeaserPlayingStartedAt = 0;
        detailBgTeaserPaused = false;
        detailBgTeaserEnded = false;
        detailBgTeaserPausedByScroll = false;
        detailBgTeaserCurTime = 0;
        detailBgTeaserDuration = 0;
        detailBgTeaserLastInfoAt = 0;
        const stageEl = document.getElementById("detailHeroStageEl");
        if (stageEl && !preserveForeground) {
          stageEl.classList.remove("is-trailer-foreground-mode", "is-cinema-starting", "is-cinema-paused", "is-cinema-ended", "is-cc-safe-framing", "is-cinema-controls-idle");
        }
        const layer = document.getElementById("detailBgVideoLayer");
        if (layer) {
          layer.classList.remove("is-playing", "is-concealing");
          layer.innerHTML = "";
        }
        const dock = document.getElementById("detailCinemaPlayerDock");
        if (dock && !preserveForeground) {
          dock.classList.remove("is-ready");
        }
      }

      function sendYoutubeBgTeaserCommandClient(funcName, args = []) {
        const frame = document.getElementById("detailBgVideoIframe");
        if (!frame || !frame.contentWindow) return;
        try {
          frame.contentWindow.postMessage(JSON.stringify({
            event: "command",
            func: funcName,
            args: args,
            id: 2,
            channel: "widget"
          }), "*");
        } catch (_e) {}
      }

      function onDetailBgYoutubeIframeLoadClient() {
        if (detailBgTeaserHandshakeTimer) {
          clearInterval(detailBgTeaserHandshakeTimer);
          detailBgTeaserHandshakeTimer = null;
        }
        let ticks = 0;
        const sendHandshake = () => {
          const frame = document.getElementById("detailBgVideoIframe");
          if (!frame || !frame.contentWindow) {
            if (detailBgTeaserHandshakeTimer) {
              clearInterval(detailBgTeaserHandshakeTimer);
              detailBgTeaserHandshakeTimer = null;
            }
            return;
          }
          try {
            frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 2, channel: "widget" }), "*");
            frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"], id: 2, channel: "widget" }), "*");
            frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onApiChange"], id: 2, channel: "widget" }), "*");
            frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onError"], id: 2, channel: "widget" }), "*");
            if (!detailBgTeaserPaused && !detailBgTeaserEnded && !detailBgTeaserStoppedByUser) {
              frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [], id: 2, channel: "widget" }), "*");
            }
            if (detailBgTeaserPendingUnmute || !detailBgTeaserMuted) {
              const targetVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
              frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [], id: 2, channel: "widget" }), "*");
              frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [targetVol], id: 2, channel: "widget" }), "*");
            }
            if (ticks === 0 || ticks === 3) {
              applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
            }
          } catch (_e) {}
          ticks++;
          if (ticks >= 32 || (detailBgTeaserIsPlayingConfirmed && detailBgTeaserDuration > 0)) {
            if (detailBgTeaserHandshakeTimer) {
              clearInterval(detailBgTeaserHandshakeTimer);
              detailBgTeaserHandshakeTimer = null;
            }
          }
        };
        sendHandshake();
        detailBgTeaserHandshakeTimer = setInterval(sendHandshake, 280);
      }

      function mountDetailTrailerCandidateAtIndexClient(idx, startUnmuted = false, startSeconds = 0, overrideCcMode = null, opts = {}) {
        clearDetailBgTeaserTimersClient();
        clearDetailUnmuteRetryTimersClient();
        if (idx < 0 || idx >= detailBgTeaserCandidates.length) {
          activateDetailKenBurnsFallbackClient();
          return;
        }
        const layer = document.getElementById("detailBgVideoLayer");
        if (!layer) return;
        detailBgTeaserCandidateIdx = idx;
        const cleanKey = detailBgTeaserCandidates[idx];
        detailBgTeaserActiveKey = cleanKey;
        detailBgTeaserCcMode = (overrideCcMode === "off" || overrideCcMode === "de" || overrideCcMode === "en")
          ? overrideCcMode
          : (shouldAutoEnableSubtitlesForKeyClient(cleanKey) ? "de" : "off");
        detailBgTeaserSpeed = Number(opts && opts.preserveSpeed) > 0 ? Number(opts.preserveSpeed) : 1;
        detailBgTeaserStageOpenedAt = Date.now();
        detailBgTeaserIsPlayingConfirmed = false;
        detailBgTeaserPreloadedParked = false;
        detailBgTeaserChromeShieldRequired = true;
        detailBgTeaserPlayingStartedAt = 0;
        detailBgTeaserPaused = false;
        detailBgTeaserEnded = false;
        detailBgTeaserPausedByScroll = false;
        const safeStartSec = Math.max(0, Number(startSeconds || 0));
        detailBgTeaserCurTime = safeStartSec;
        detailBgTeaserLastInfoAt = 0;
        if (!(opts && opts.keepDuration)) {
          detailBgTeaserDuration = 0;
        }
        detailBgTeaserPendingUnmute = Boolean(startUnmuted);
        detailBgTeaserMuted = !startUnmuted;
        if (startUnmuted) {
          detailBgTeaserUserMuted = false;
          detailBgTeaserUnmuteRetries = 0;
          window._detailUnmuteGraceUntil = Date.now() + 3000;
        }

        const stageEl = document.getElementById("detailHeroStageEl");
        const isFgMount = Boolean(startUnmuted || (stageEl && stageEl.classList.contains("is-trailer-foreground-mode")));
        layer.classList.remove("is-concealing");
        if (isFgMount) layer.classList.add("is-playing");
        else layer.classList.remove("is-playing");

        // WICHTIG: Immer mit autoplay=1&mute=1 starten (100% Autoplay-Erlaubnis auf iOS/Android/Telegram WebView) und Ton sofort per JS-API zuschalten!
        const embedSrc = buildTrailerEmbedUrlClient(cleanKey, safeStartSec, detailBgTeaserCcMode, 2);
        layer.innerHTML = '<iframe id="detailBgVideoIframe" class="detail-bg-video-frame" src="' + esc(embedSrc) + '" onload="onDetailBgYoutubeIframeLoadClient()" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" playsinline="1" webkit-playsinline="1" tabindex="-1" aria-hidden="true"></iframe>';

        if (stageEl) {
          stageEl.classList.remove("is-cinema-paused", "is-cinema-ended");
          stageEl.classList.toggle("is-cc-safe-framing", detailBgTeaserCcMode === "de" || detailBgTeaserCcMode === "en");
          stageEl.classList.toggle("is-cinema-starting", isFgMount);
        }
        if (isFgMount) {
          setDetailTrailerLoadingBadgeClient(false);
          scheduleDetailRevealAfterYoutubeChromeHidesClient((opts && opts.fastRevealMs) ? opts.fastRevealMs : 2100, true);
          ensureDetailCinemaLiveClockClient();
        }

        // Watchdog: Falls YouTube das Video blockiert oder nach 5,2s noch nicht im Playing-State (1) ist -> nächsten Trailer testen!
        detailBgTeaserWatchdogTimer = setTimeout(() => {
          if (!detailBgTeaserIsPlayingConfirmed && detailBgTeaserActiveKey === cleanKey && !detailBgTeaserStoppedByUser) {
            if (detailBgTeaserCandidates.length > 1) {
              clientBlockedYoutubeKeys.add(cleanKey);
              advanceToNextDetailTrailerCandidateClient(startUnmuted || !detailBgTeaserMuted);
            }
          }
        }, 5200);
      }

      function advanceToNextDetailTrailerCandidateClient(keepUnmuted = false) {
        const nextIdx = detailBgTeaserCandidateIdx + 1;
        if (nextIdx < detailBgTeaserCandidates.length) {
          mountDetailTrailerCandidateAtIndexClient(nextIdx, keepUnmuted, 0);
        } else {
          activateDetailKenBurnsFallbackClient();
        }
      }

      if (typeof window !== "undefined" && !window._detailYtMessageListenerBound) {
        window._detailYtMessageListenerBound = true;
        window.addEventListener("message", (ev) => {
          if (!detailBgTeaserActiveKey) return;
          const detailFrame = document.getElementById("detailBgVideoIframe");
          if (!detailFrame || !detailFrame.contentWindow || ev.source !== detailFrame.contentWindow) return;
          const orig = String(ev.origin || "");
          if (orig !== "https://www.youtube.com" && orig !== "https://www.youtube-nocookie.com" && orig !== "https://youtube.com" && orig !== "https://youtube-nocookie.com") return;
          let msg = null;
          try {
            msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
          } catch (_e) {
            return;
          }
          if (!msg || typeof msg !== "object") return;

          if (msg.event === "onApiChange") {
            if (detailBgTeaserCcMode === "de" || detailBgTeaserCcMode === "en") {
              applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
            }
            return;
          }

          if (msg.event === "onError" || (msg.info && typeof msg.info === "number" && msg.event === "onError")) {
            clientBlockedYoutubeKeys.add(detailBgTeaserActiveKey);
            advanceToNextDetailTrailerCandidateClient(detailBgTeaserPendingUnmute || !detailBgTeaserMuted);
            return;
          }

          let pState = null;
          if (msg.event === "onStateChange" && typeof msg.info === "number") {
            pState = msg.info;
          } else if ((msg.event === "infoDelivery" || msg.event === "initialDelivery") && msg.info && typeof msg.info === "object") {
            if (typeof msg.info.playerState === "number") {
              pState = msg.info.playerState;
            }
            const rawDetailCurTime = typeof msg.info.currentTime === "number"
              ? msg.info.currentTime
              : (msg.info.progressState && typeof msg.info.progressState.current === "number" ? msg.info.progressState.current : null);
            if (rawDetailCurTime !== null && Number.isFinite(rawDetailCurTime) && rawDetailCurTime >= 0) {
              detailBgTeaserCurTime = rawDetailCurTime;
              detailBgTeaserLastInfoAt = Date.now();
            }
            const rawDetailDur = (typeof msg.info.duration === "number" && msg.info.duration > 0)
              ? msg.info.duration
              : ((msg.info.progressState && typeof msg.info.progressState.duration === "number" && msg.info.progressState.duration > 0)
                ? msg.info.progressState.duration
                : (msg.info.videoData && Number(msg.info.videoData.lengthSeconds) > 0 ? Number(msg.info.videoData.lengthSeconds) : 0));
            if (rawDetailDur > 0 && Number.isFinite(rawDetailDur)) {
              detailBgTeaserDuration = rawDetailDur;
            }
            const curStageEl = document.getElementById("detailHeroStageEl");
            const isFgLive = Boolean(curStageEl && curStageEl.classList.contains("is-trailer-foreground-mode"));
            if (typeof msg.info.muted === "boolean") {
              if (isFgLive && !detailBgTeaserUserMuted && msg.info.muted === true && detailBgTeaserUnmuteRetries < 4) {
                detailBgTeaserUnmuteRetries += 1;
                window._detailUnmuteGraceUntil = Date.now() + 1800;
                const retryVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
                sendYoutubeBgTeaserCommandClient("unMute");
                sendYoutubeBgTeaserCommandClient("setVolume", [retryVol]);
                detailBgTeaserMuted = false;
              } else if (!detailBgTeaserPendingUnmute && (msg.info.muted === false || detailBgTeaserUserMuted || Date.now() > (window._detailUnmuteGraceUntil || 0))) {
                detailBgTeaserMuted = msg.info.muted;
              }
            }
            // Im stillen Hintergrund-Preview 3,2s vor Ende sanft ausblenden; im aktiven Kino-Vordergrund bis zum echten Ende durchspielen!
            if (
              !isFgLive &&
              detailBgTeaserDuration > 6 &&
              detailBgTeaserCurTime > 2 &&
              (detailBgTeaserDuration - detailBgTeaserCurTime) <= 3.2 &&
              !detailBgTeaserEnded &&
              !detailBgTeaserScrubbing
            ) {
              finishDetailTrailerToArtworkClient();
              return;
            }
            syncDetailCinemaDockUiClient();
          }

          if (pState !== null) {
            const layer = document.getElementById("detailBgVideoLayer");
            const stageEl = document.getElementById("detailHeroStageEl");
            const isFg = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));
            if (pState === 1) {
              if (detailBgTeaserWatchdogTimer) {
                clearTimeout(detailBgTeaserWatchdogTimer);
                detailBgTeaserWatchdogTimer = null;
              }
              const wasConfirmedBefore = detailBgTeaserIsPlayingConfirmed;
              detailBgTeaserIsPlayingConfirmed = true;
              detailBgTeaserPaused = false;
              detailBgTeaserEnded = false;
              if (!wasConfirmedBefore || !detailBgTeaserPlayingStartedAt) {
                detailBgTeaserPlayingStartedAt = Date.now();
              }
              if (detailBgTeaserDuration <= 0 && detailFrame && detailFrame.contentWindow) {
                try { detailFrame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 2, channel: "widget" }), "*"); } catch (_dle) {}
              }
              if (isFg) {
                ensureDetailCinemaLiveClockClient();
              }
              if (detailBgTeaserPendingUnmute || (isFg && !detailBgTeaserUserMuted)) {
                detailBgTeaserPendingUnmute = false;
                enforceDetailForegroundUnmuteClient();
              }
              applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
              if (detailBgTeaserSpeed !== 1) {
                sendYoutubeBgTeaserCommandClient("setPlaybackRate", [detailBgTeaserSpeed]);
              }
              if (stageEl) {
                const backdropLayer = stageEl.querySelector(".detail-backdrop-layer");
                if (backdropLayer) backdropLayer.classList.remove("is-ken-burns-active");
              }
              if (detailBgTeaserChromeShieldRequired || !isFg || !wasConfirmedBefore) {
                const elapsedPlaying = Date.now() - (detailBgTeaserPlayingStartedAt || Date.now());
                const holdRemainingMs = Math.max(480, 2250 - elapsedPlaying);
                scheduleDetailRevealAfterYoutubeChromeHidesClient(holdRemainingMs, !wasConfirmedBefore);
              } else if (layer && isFg && !detailBgTeaserStoppedByUser && !detailBgTeaserPausedByScroll && !detailBgTeaserDelayedPauseTimer) {
                layer.classList.remove("is-concealing");
                layer.classList.add("is-playing");
                if (stageEl) stageEl.classList.remove("is-cinema-starting");
                setDetailTrailerLoadingBadgeClient(false);
                wakeDetailCinemaDockClient();
              }
              syncDetailCinemaDockUiClient();
            } else if (pState === 2) {
              detailBgTeaserPaused = true;
              stopDetailCinemaLiveClockClient();
              if (stageEl) stageEl.classList.remove("is-cinema-starting");
              setDetailTrailerLoadingBadgeClient(false);
              // Im Vordergrund-Kino-Modus bleibt das pausierte Video sichtbar; gezielte TelePort-Ersatzoverlays überdecken nur YouTube-Controls!
              if (!isFg || detailBgTeaserPreloadedParked || detailBgTeaserEnded) {
                detailBgTeaserChromeShieldRequired = true;
                if (layer) {
                  layer.classList.remove("is-playing");
                }
              } else {
                detailBgTeaserChromeShieldRequired = false;
                if (layer) {
                  layer.classList.remove("is-concealing");
                  layer.classList.add("is-playing");
                }
              }
              wakeDetailCinemaDockClient();
              syncDetailCinemaDockUiClient();
            } else if (pState === 0) {
              stopDetailCinemaLiveClockClient();
              if (stageEl) stageEl.classList.remove("is-cinema-starting");
              if (isFg) {
                detailBgTeaserEnded = true;
                detailBgTeaserPaused = true;
                if (detailBgTeaserDuration > 0) detailBgTeaserCurTime = detailBgTeaserDuration;
                setDetailTrailerLoadingBadgeClient(false);
                wakeDetailCinemaDockClient();
                syncDetailCinemaDockUiClient();
                startDetailCinemaEndcardCountdownClient();
                const endPrimaryBtn = document.getElementById("detailCinemaEndPrimaryBtn");
                if (endPrimaryBtn) {
                  if (typeof jumpSpatialFocus === "function") jumpSpatialFocus(endPrimaryBtn, false);
                  try { endPrimaryBtn.focus({ preventScroll: true }); } catch (_fe) {}
                  requestAnimationFrame(() => {
                    const liveBtn = document.getElementById("detailCinemaEndPrimaryBtn");
                    if (liveBtn && document.getElementById("detailHeroStageEl")?.classList.contains("is-cinema-ended")) {
                      if (typeof jumpSpatialFocus === "function") jumpSpatialFocus(liveBtn, false);
                      try { liveBtn.focus({ preventScroll: true }); } catch (_fe2) {}
                    }
                  });
                }
              } else {
                finishDetailTrailerToArtworkClient();
              }
            } else if ((pState === -1 || pState === 5) && !detailBgTeaserPaused && !detailBgTeaserEnded && !detailBgTeaserStoppedByUser) {
              sendYoutubeBgTeaserCommandClient("playVideo");
              syncDetailCinemaDockUiClient();
            }
          }
        });
      }

      function scheduleDetailBackgroundVideoTeaserClient(trailersOrKey, immediateForeground = false) {
        stopDetailBackgroundVideoTeaserClient({ preserveForeground: Boolean(immediateForeground) });
        detailBgTeaserStoppedByUser = false;
        detailBgTeaserStageOpenedAt = Date.now();
        const candidates = extractCandidateKeysFromTrailersClient(trailersOrKey || state.activeDetails?.trailers);
        detailBgTeaserCandidates = candidates;
        detailBgTeaserCandidateIdx = 0;

        if (candidates.length === 0) {
          activateDetailKenBurnsFallbackClient();
          if (immediateForeground) {
            if (typeof showHudToast === "function") {
              showHudToast("ℹ️ Kein direkt abspielbarer Trailer verfügbar");
            }
            const fallbackFocusBtn = document.getElementById("detailPrimaryPlayBtn") || document.getElementById("detailTrailerBtn") || document.getElementById("modalWishlistBtn");
            if (fallbackFocusBtn && typeof jumpSpatialFocus === "function") {
              jumpSpatialFocus(fallbackFocusBtn, false);
            }
          }
          return;
        }

        if (immediateForeground) {
          const stageEl = document.getElementById("detailHeroStageEl");
          if (stageEl) stageEl.classList.add("is-trailer-foreground-mode", "is-cinema-starting");
          setDetailTrailerLoadingBadgeClient(false);
          enforceDetailForegroundUnmuteClient();
          mountDetailTrailerCandidateAtIndexClient(0, true, 0);
          wakeDetailCinemaDockClient();
          syncDetailCinemaDockUiClient();
          const focusBtn = document.getElementById("detailCinemaPlayBtn") || document.getElementById("detailCinemaModeBtn");
          if (focusBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(focusBtn, false);
          }
          return;
        }

        // Wenn die automatische Trailer-Vorschau im Menü deaktiviert wurde -> Ruhiges Szenenbild stehen lassen (Klick auf "🎬 Trailer" bleibt jederzeit aktiv!)
        if (typeof trailerPreviewEnabled !== "undefined" && !trailerPreviewEnabled) {
          const stageEl = document.getElementById("detailHeroStageEl");
          if (stageEl) {
            const backdropLayer = stageEl.querySelector(".detail-backdrop-layer");
            if (backdropLayer) backdropLayer.classList.remove("is-ken-burns-active");
          }
          return;
        }

        // Im Hintergrund vorladen (nach 320ms), aber erst beim Tippen auf Hintergrund / Trailer einblenden!
        detailBgTeaserTimer = setTimeout(() => {
          const modalBackdrop = document.querySelector("#modalRoot .modal-backdrop");
          if (!modalBackdrop || modalBackdrop.scrollTop > 260) return;
          if (document.getElementById("personSpotlightOverlayRoot")?.innerHTML) return;
          if (typeof trailerPreviewEnabled !== "undefined" && !trailerPreviewEnabled) return;
          mountDetailTrailerCandidateAtIndexClient(0, false, 0);
        }, 320);
      }

      function toggleDetailCinemaPlayPauseClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeDetailCinemaDockClient();
        const stageEl = document.getElementById("detailHeroStageEl");
        const isFg = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));
        if (!isFg) {
          enterDetailForegroundTrailerModeClient(ev, false);
          return;
        }
        const frame = document.getElementById("detailBgVideoIframe");
        if (!frame) {
          if (detailBgTeaserCandidates.length > 0) {
            detailBgTeaserStoppedByUser = false;
            mountDetailTrailerCandidateAtIndexClient(detailBgTeaserCandidateIdx || 0, !detailBgTeaserMuted, 0);
          }
          return;
        }
        if (detailBgTeaserEnded || detailBgTeaserPaused) {
          resumeDetailTrailerWithBackdropShieldClient({ restartIfEnded: true });
          showDetailSeekRippleBadgeClient(CINEMA_ICONS_CLIENT.pause, "center", { isHtmlIcon: true, durationMs: 900 });
        } else {
          // Video-Frame sichtbar lassen – gezielte TelePort-Ersatzoverlays überdecken nur YouTube-Pause-Controls!
          if (detailBgTeaserRevealTimer) {
            clearTimeout(detailBgTeaserRevealTimer);
            detailBgTeaserRevealTimer = null;
          }
          if (stageEl) stageEl.classList.remove("is-cinema-starting");
          detailBgTeaserPaused = true;
          detailBgTeaserStoppedByUser = true;
          detailBgTeaserChromeShieldRequired = false;
          const layer = document.getElementById("detailBgVideoLayer");
          if (layer) {
            layer.classList.remove("is-concealing");
            layer.classList.add("is-playing");
          }
          sendYoutubeBgTeaserCommandClient("pauseVideo");
          wakeDetailCinemaDockClient();
          syncDetailCinemaDockUiClient();
          const centerPlayBtn = document.getElementById("detailCinemaCenterPlayBtn");
          if (centerPlayBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(centerPlayBtn, false);
          }
        }
      }

      function triggerDetailStreamFromCinemaOverlayClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        exitDetailForegroundTrailerModeClient(ev);
        setTimeout(() => {
          const primaryBtn = document.getElementById("detailPrimaryPlayBtn") || document.getElementById("detailStickyPrimaryPlayBtn");
          if (!primaryBtn) return;
          const onClickAttr = String(primaryBtn.getAttribute("onclick") || "");
          // Nur Stream starten, wenn der primäre Button wirklich ein Stream-Starter ist (verhindert Endlosschleife bei Nicht-VIP / Titeln ohne Stream!)
          if (!onClickAttr.includes("enterDetailForegroundTrailerModeClient")) {
            primaryBtn.click();
          }
        }, 60);
      }

      function toggleDetailBackgroundTeaserAudioClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeDetailCinemaDockClient();
        const frame = document.getElementById("detailBgVideoIframe");
        if (!frame) {
          const candidates = extractCandidateKeysFromTrailersClient(state.activeDetails?.trailers);
          if (candidates.length === 0) return;
          detailBgTeaserCandidates = candidates;
          mountDetailTrailerCandidateAtIndexClient(0, true, 0);
          return;
        }
        if (detailBgTeaserMuted) {
          const vol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : saveTrailerVolumeClient(85);
          enforceDetailForegroundUnmuteClient();
          showDetailSeekRippleBadgeClient("🔊 " + vol + "%", "center");
          if (detailBgTeaserEnded || detailBgTeaserPaused) {
            resumeDetailTrailerWithBackdropShieldClient({ restartIfEnded: true });
            return;
          }
        } else {
          clearDetailUnmuteRetryTimersClient();
          detailBgTeaserUserMuted = true;
          detailBgTeaserPendingUnmute = false;
          detailBgTeaserMuted = true;
          sendYoutubeBgTeaserCommandClient("mute");
          showDetailSeekRippleBadgeClient("🔇 Stumm", "center");
        }
        syncDetailCinemaDockUiClient();
      }

      function onDetailCinemaVolumeInputClient(inpEl, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (!inpEl) return;
        wakeDetailCinemaDockClient();
        const vol = saveTrailerVolumeClient(inpEl.value);
        inpEl.style.setProperty("--vol-pct", vol + "%");
        if (vol <= 0) {
          clearDetailUnmuteRetryTimersClient();
          detailBgTeaserUserMuted = true;
          detailBgTeaserMuted = true;
          detailBgTeaserPendingUnmute = false;
          sendYoutubeBgTeaserCommandClient("mute");
        } else {
          detailBgTeaserUserMuted = false;
          detailBgTeaserMuted = false;
          detailBgTeaserPendingUnmute = false;
          window._detailUnmuteGraceUntil = Date.now() + 2000;
          sendYoutubeBgTeaserCommandClient("unMute");
          sendYoutubeBgTeaserCommandClient("setVolume", [vol]);
        }
        syncDetailCinemaDockUiClient();
      }

      function adjustDetailCinemaVolumeStepClient(delta, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeDetailCinemaDockClient();
        const numDelta = Number(delta || 0);
        if (numDelta !== 0 && typeof flashCinemaVolStepBtnClient === "function") {
          flashCinemaVolStepBtnClient("detail", numDelta > 0 ? "up" : "down");
        }
        const baseVol = detailBgTeaserMuted ? 0 : getSavedTrailerVolumeClient();
        const nextVol = saveTrailerVolumeClient(baseVol + numDelta);
        if (nextVol <= 0) {
          clearDetailUnmuteRetryTimersClient();
          detailBgTeaserUserMuted = true;
          detailBgTeaserMuted = true;
          sendYoutubeBgTeaserCommandClient("mute");
          showDetailSeekRippleBadgeClient("🔇 Stumm", "center");
        } else {
          detailBgTeaserUserMuted = false;
          detailBgTeaserMuted = false;
          window._detailUnmuteGraceUntil = Date.now() + 2000;
          sendYoutubeBgTeaserCommandClient("unMute");
          sendYoutubeBgTeaserCommandClient("setVolume", [nextVol]);
          showDetailSeekRippleBadgeClient("🔊 " + nextVol + "%", "center");
        }
        syncDetailCinemaDockUiClient();
      }

      function toggleDetailCinemaSubtitlesClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeDetailCinemaDockClient();
        const nextMode = getNextTrailerCcModeClient(detailBgTeaserCcMode);
        detailBgTeaserCcMode = nextMode;
        const ccMeta = formatTrailerCcButtonMetaClient(nextMode);
        const frame = document.getElementById("detailBgVideoIframe");
        if (frame && detailBgTeaserActiveKey && Array.isArray(detailBgTeaserCandidates) && detailBgTeaserCandidates.length > 0) {
          const resumeSec = Math.max(0, Math.floor(detailBgTeaserCurTime || 0));
          const keepUnmuted = !detailBgTeaserMuted || Boolean(document.getElementById("detailHeroStageEl")?.classList.contains("is-trailer-foreground-mode"));
          const keepSpeed = detailBgTeaserSpeed || 1;
          detailBgTeaserStoppedByUser = false;
          mountDetailTrailerCandidateAtIndexClient(detailBgTeaserCandidateIdx || 0, keepUnmuted, resumeSec, nextMode, {
            preserveSpeed: keepSpeed,
            keepDuration: true,
            fastRevealMs: 1150,
            loadingLabel: ccMeta.toast + "…"
          });
        } else {
          applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, nextMode, detailBgTeaserActiveKey);
          showDetailSeekRippleBadgeClient(ccMeta.toast, "center");
        }
        syncDetailCinemaDockUiClient();
      }

      function cycleDetailCinemaSpeedClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeDetailCinemaDockClient();
        detailBgTeaserSpeed = getNextTrailerSpeedClient(detailBgTeaserSpeed);
        sendYoutubeBgTeaserCommandClient("setPlaybackRate", [detailBgTeaserSpeed]);
        showDetailSeekRippleBadgeClient("⚡ " + detailBgTeaserSpeed + "×", "center");
        syncDetailCinemaDockUiClient();
      }

      function onDetailCinemaScrubInputClient(inpEl, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (!inpEl) return;
        detailBgTeaserScrubbing = true;
        wakeDetailCinemaDockClient();
        detailBgTeaserChromeShieldRequired = true;
        const stageEl = document.getElementById("detailHeroStageEl");
        if (stageEl && stageEl.classList.contains("is-trailer-foreground-mode")) {
          stageEl.classList.add("is-cinema-starting");
        } else {
          const layer = document.getElementById("detailBgVideoLayer");
          if (layer) layer.classList.remove("is-playing");
        }
        const targetSec = Math.max(0, Number(inpEl.value || 0));
        detailBgTeaserCurTime = targetSec;
        const maxDur = Number(inpEl.max) || (detailBgTeaserDuration > 0 ? Math.floor(detailBgTeaserDuration) : 120);
        const pct = maxDur > 0 ? Math.max(0, Math.min(100, (targetSec / maxDur) * 100)) : 0;
        inpEl.style.setProperty("--scrub-pct", pct.toFixed(1) + "%");
        const timeLbl = document.getElementById("detailCinemaTimeLbl");
        if (timeLbl) {
          timeLbl.textContent = detailBgTeaserDuration > 0
            ? (formatTrailerDockTimeClient(targetSec) + " / " + formatTrailerDockTimeClient(detailBgTeaserDuration))
            : formatTrailerDockTimeClient(targetSec);
        }
      }

      function onDetailCinemaScrubChangeClient(inpEl, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (!inpEl) return;
        const maxDur = detailBgTeaserDuration > 3.5 ? Math.max(1, Math.floor(detailBgTeaserDuration - 3.3)) : 9999;
        const targetSec = Math.max(0, Math.min(maxDur, Number(inpEl.value || 0)));
        detailBgTeaserCurTime = targetSec;
        detailBgTeaserScrubbing = false;
        detailBgTeaserEnded = false;
        if (detailBgTeaserDelayedPauseTimer) {
          clearTimeout(detailBgTeaserDelayedPauseTimer);
          detailBgTeaserDelayedPauseTimer = null;
        }
        sendYoutubeBgTeaserCommandClient("seekTo", [targetSec, true]);
        if (detailBgTeaserPaused) {
          detailBgTeaserPaused = false;
          detailBgTeaserPausedByScroll = false;
          detailBgTeaserStoppedByUser = false;
          sendYoutubeBgTeaserCommandClient("playVideo");
        }
        scheduleDetailRevealAfterYoutubeChromeHidesClient(1150, true);
        syncDetailCinemaDockUiClient();
        wakeDetailCinemaDockClient();
      }

      function enterDetailForegroundTrailerModeClient(ev, fromStageTap = false) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const stageEl = document.getElementById("detailHeroStageEl");
        if (!stageEl) return;
        if (stageEl.classList.contains("is-trailer-foreground-mode")) {
          const layer = document.getElementById("detailBgVideoLayer");
          // Falls der Nutzer im Vordergrund-Modus ein zweites Mal tippt, während der Trailer noch im kurzen Vorlauf steckt -> Modus halten & Ton/Start sicherstellen!
          if ((stageEl.classList.contains("is-cinema-starting") || (layer && !layer.classList.contains("is-playing"))) && detailBgTeaserActiveKey && !detailBgTeaserPaused && !detailBgTeaserEnded) {
            detailBgTeaserPendingUnmute = true;
            detailBgTeaserMuted = false;
            sendYoutubeBgTeaserCommandClient("playVideo");
            sendYoutubeBgTeaserCommandClient("unMute");
            sendYoutubeBgTeaserCommandClient("setVolume", [getSavedTrailerVolumeClient()]);
            applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
            syncDetailCinemaDockUiClient();
            return;
          }
          exitDetailForegroundTrailerModeClient(ev);
          return;
        }
        const candidates = detailBgTeaserCandidates.length > 0
          ? detailBgTeaserCandidates
          : extractCandidateKeysFromTrailersClient(state.activeDetails?.trailers);
        const modalBackdrop = document.querySelector("#modalRoot .modal-backdrop");
        if (modalBackdrop && modalBackdrop.scrollTop > 4) {
          modalBackdrop.scrollTo({ top: 0, behavior: "smooth" });
        }
        if (candidates.length === 0) {
          if (fromStageTap) {
            // Auf dem Tablet/Smartphone/Desktop beim Tipp auf das Szenenbild auch ohne Trailer alle Details für den Clean-Cinema-Blick ausblenden!
            stageEl.classList.add("is-trailer-foreground-mode");
            syncDetailCinemaDockUiClient();
            return;
          }
          const d = state.activeDetails || {};
          const ytQ = encodeURIComponent((d.title || "") + " " + (d.year && d.year !== "K.A." ? d.year : "") + " Trailer Deutsch");
          showHudToast("ℹ️ Kein einbettbarer Trailer – öffne YouTube-Suche");
          window.open("https://www.youtube.com/results?search_query=" + ytQ, "_blank", "noopener,noreferrer");
          return;
        }
        if (detailBgTeaserTimer) {
          clearTimeout(detailBgTeaserTimer);
          detailBgTeaserTimer = null;
        }
        detailBgTeaserCandidates = candidates;
        detailBgTeaserStoppedByUser = false;
        detailBgTeaserPausedByScroll = false;
        stageEl.classList.add("is-trailer-foreground-mode", "is-cinema-starting");
        setDetailTrailerLoadingBadgeClient(false);
        enforceDetailForegroundUnmuteClient();

        const existingFrame = document.getElementById("detailBgVideoIframe");
        if (existingFrame && detailBgTeaserActiveKey) {
          applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
          if (detailBgTeaserSpeed && detailBgTeaserSpeed !== 1) {
            sendYoutubeBgTeaserCommandClient("setPlaybackRate", [detailBgTeaserSpeed]);
          }
          if (detailBgTeaserDuration <= 0 && existingFrame.contentWindow) {
            try { existingFrame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 2, channel: "widget" }), "*"); } catch (_dle2) {}
          }
          ensureDetailCinemaLiveClockClient();
          const layer = document.getElementById("detailBgVideoLayer");
          const elapsedSincePlaying = detailBgTeaserPlayingStartedAt > 0
            ? (Date.now() - detailBgTeaserPlayingStartedAt)
            : 0;
          const initialChromeStillFading = Boolean(detailBgTeaserPlayingStartedAt > 0 && elapsedSincePlaying < 2250);
          // 1. Trailer läuft bereits sichtbar im Hintergrund (und Start-Chrome ist weg) -> 0ms sofort mit Ton weiterlaufen lassen!
          if (detailBgTeaserIsPlayingConfirmed && !detailBgTeaserPaused && !detailBgTeaserEnded && !detailBgTeaserChromeShieldRequired && !initialChromeStillFading) {
            stageEl.classList.remove("is-cinema-starting");
            setDetailTrailerLoadingBadgeClient(false);
            if (layer) {
              layer.classList.remove("is-concealing");
              layer.classList.add("is-playing");
            }
          } else if (!detailBgTeaserPaused && !detailBgTeaserEnded) {
            // 2. Trailer lädt gerade schon im Hintergrund an -> gezieltes Start-Overlay bis YT-Chrome weg ist!
            sendYoutubeBgTeaserCommandClient("playVideo");
            const elapsed = detailBgTeaserPlayingStartedAt > 0
              ? (Date.now() - detailBgTeaserPlayingStartedAt)
              : (Date.now() - (detailBgTeaserStageOpenedAt || Date.now()));
            const remainingMs = Math.max(600, 2250 - elapsed);
            scheduleDetailRevealAfterYoutubeChromeHidesClient(remainingMs, true);
          } else {
            // 3. Trailer war vorgepuffert-geparkt, pausiert oder beendet -> Ohne Vollbild-Cover direkt mit Start-Shield fortsetzen
            resumeDetailTrailerWithBackdropShieldClient({ restartIfEnded: true });
          }
        } else {
          mountDetailTrailerCandidateAtIndexClient(0, true, 0);
        }
        syncDetailCinemaDockUiClient();
        const focusBtn = document.getElementById("detailCinemaPlayBtn") || document.getElementById("detailCinemaModeBtn");
        if (focusBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(focusBtn, false);
        }
      }

      function exitDetailForegroundTrailerModeClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        detailAutoOpenTrailerCancelled = true;
        cancelDetailCinemaEndcardCountdownClient(true);
        stopDetailCinemaLiveClockClient();
        if (typeof syncCinemaVolPopoverFocusStateClient === "function") {
          syncCinemaVolPopoverFocusStateClient(null);
        }
        const stageEl = document.getElementById("detailHeroStageEl");
        if (!stageEl) return;
        stageEl.classList.remove("is-cinema-starting", "is-cinema-controls-idle");
        // Beim Verlassen des Kino-Vordergrund-Modus wieder das ruhige Szenenbild samt Text/Buttons einblenden und den Trailer dahinter pausieren
        if (detailBgTeaserActiveKey && !detailBgTeaserPaused && !detailBgTeaserEnded) {
          concealAndPauseDetailTrailerClient({
            exitForeground: true,
            stoppedByUser: true,
            pauseDelayMs: 220
          });
        } else {
          setDetailTrailerLoadingBadgeClient(false);
          stageEl.classList.remove("is-trailer-foreground-mode");
          const layer = document.getElementById("detailBgVideoLayer");
          if (layer) {
            layer.classList.add("is-concealing");
            layer.classList.remove("is-playing");
            setTimeout(() => {
              const liveLayer = document.getElementById("detailBgVideoLayer");
              if (liveLayer && !liveLayer.classList.contains("is-playing")) {
                liveLayer.classList.remove("is-concealing");
              }
            }, 180);
          }
          syncDetailCinemaDockUiClient();
        }
        const trBtn = document.getElementById("detailTrailerBtn") || document.getElementById("detailPrimaryPlayBtn");
        if (trBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(trBtn, false);
        }
      }

      // Wow-Effekt #4: Cinematic Scroll-Parallax, Sticky-Mini-Header & Netflix Scroll-Auto-Pause beim Runterscrollen zum Cast (rAF-gedrosselt & GPU-optimiert ohne Blur-Lag)
      let detailModalScrollRafPending = false;
      function onDetailModalScrollClient(scrollEl) {
        if (!scrollEl || detailModalScrollRafPending) return;
        detailModalScrollRafPending = true;
        requestAnimationFrame(() => {
          detailModalScrollRafPending = false;
          const st = Number(scrollEl.scrollTop || 0);
          const stageEl = document.getElementById("detailHeroStageEl");
          if (stageEl) {
            const pY = Math.min(180, Math.round(st * 0.32));
            const pDim = st > 16 ? Math.min(0.86, (st / 460)).toFixed(2) : "0";
            if (stageEl._lastPy !== pY) {
              stageEl._lastPy = pY;
              stageEl.style.setProperty("--detail-parallax-y", pY + "px");
            }
            if (stageEl._lastPdim !== pDim) {
              stageEl._lastPdim = pDim;
              stageEl.style.setProperty("--detail-scroll-dim", pDim);
            }
          }
          const stickyHeader = document.getElementById("detailStickyMiniHeader");
          if (stickyHeader) {
            const shouldShowSticky = st > 310;
            if (stickyHeader._lastVis !== shouldShowSticky) {
              stickyHeader._lastVis = shouldShowSticky;
              stickyHeader.classList.toggle("is-visible", shouldShowSticky);
            }
          }
          if (st > 250 && detailBgTeaserActiveKey) {
            if (!detailBgTeaserPaused && !detailBgTeaserEnded) {
              // Cover-First, Pause-Second beim Runterscrollen zum Cast
              concealAndPauseDetailTrailerClient({ pausedByScroll: true, exitForeground: true });
            }
          }
        });
      }

      // Wow-Effekt #3: Schauspieler- & Regie-Spotlight-Overlay (Mini-Filmografie direkt über der Detailansicht)
      function closePersonSpotlightOverlayClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const root = document.getElementById("personSpotlightOverlayRoot");
        if (root) root.innerHTML = "";
      }

      let activePersonSpotlightItemsCache = [];
      let activePersonSpotlightFilter = "all";

      function togglePersonSpotlightBioExpandClient() {
        const bioEl = document.getElementById("personSpotlightBioEl");
        const hintEl = document.getElementById("personSpotlightBioHintEl");
        if (!bioEl) return;
        const expanded = bioEl.classList.toggle("is-expanded");
        if (hintEl) {
          hintEl.textContent = expanded ? "▴ Weniger anzeigen" : "▾ Biografie ganz lesen";
        }
      }

      function renderPersonSpotlightGridCardsClient(filterMode = "all") {
        activePersonSpotlightFilter = filterMode || "all";
        const gridEl = document.getElementById("personSpotlightGridEl");
        const countEl = document.getElementById("personSpotlightCountLbl");
        const filterBarEl = document.getElementById("personSpotlightFilterBarEl");
        if (!gridEl) return;

        const allItems = Array.isArray(activePersonSpotlightItemsCache) ? activePersonSpotlightItemsCache : [];
        const movieItems = allItems.filter(it => (it.media_type === "tv" || it.type === "s") ? false : true);
        const seriesItems = allItems.filter(it => (it.media_type === "tv" || it.type === "s") ? true : false);

        if (filterBarEl) {
          if (movieItems.length > 0 && seriesItems.length > 0) {
            filterBarEl.style.display = "inline-flex";
            filterBarEl.innerHTML =
              '<button type="button" class="btn ' + (activePersonSpotlightFilter === 'all' ? 'blue' : '') + '" style="padding:3px 9px;font-size:11px" onclick="renderPersonSpotlightGridCardsClient(\\'all\\')">Alle (' + allItems.length + ')</button>' +
              '<button type="button" class="btn ' + (activePersonSpotlightFilter === 'm' ? 'blue' : '') + '" style="padding:3px 9px;font-size:11px" onclick="renderPersonSpotlightGridCardsClient(\\'m\\')">🎬 Filme (' + movieItems.length + ')</button>' +
              '<button type="button" class="btn ' + (activePersonSpotlightFilter === 's' ? 'blue' : '') + '" style="padding:3px 9px;font-size:11px" onclick="renderPersonSpotlightGridCardsClient(\\'s\\')">📺 Serien (' + seriesItems.length + ')</button>';
          } else {
            filterBarEl.style.display = "none";
          }
        }

        const filtered = activePersonSpotlightFilter === "m"
          ? movieItems
          : activePersonSpotlightFilter === "s"
            ? seriesItems
            : allItems;

        if (countEl) {
          countEl.textContent = "(" + filtered.length + ")";
        }

        if (filtered.length === 0) {
          gridEl.innerHTML = '<div style="grid-column:1 / -1;font-size:13px;color:#94a3b8;padding:10px 2px">Keine Titel in dieser Kategorie gefunden.</div>';
          return;
        }

        gridEl.innerHTML = filtered.slice(0, 24).map(it => {
          const tc = it.media_type === "tv" || it.type === "s" ? "s" : "m";
          const itemTitle = String(it.title || it.name || "Titel").trim();
          const isCur = state.activeDetails && String(state.activeDetails.id) === String(it.id);
          const fbSvg = buildPosterFallbackSvg(itemTitle, tc === "s");
          const pUrl = resolvePosterUrlClient(it.poster_path, "w342", it.external_poster_url || it.poster || "") || fbSvg;
          const voteStr = it.vote_average ? ("★ " + Number(it.vote_average).toFixed(1)) : "";
          const yearStr = String(it.release_date || it.first_air_date || "").slice(0, 4);
          const subLine = [yearStr, voteStr, tc === "s" ? "Serie" : "Film"].filter(Boolean).join(" · ");
          return '<div class="detail-sim-card' + (isCur ? ' is-current-part' : '') + '" style="width:100%" tabindex="0" onclick="saveLastClosedDetailItemClient();closePersonSpotlightOverlayClient();openDetails(\\'' + tc + '\\',' + Number(it.id) + ')" onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();saveLastClosedDetailItemClient();closePersonSpotlightOverlayClient();openDetails(\\'' + tc + '\\',' + Number(it.id) + ');}">' +
            (isCur ? '<span class="detail-sim-current-badge">Aktuell</span>' : '') +
            '<img class="detail-sim-poster lazy-cover-img is-loading" src="' + LAZY_POSTER_PLACEHOLDER_SVG + '" data-lazy-src="' + esc(pUrl) + '" alt="' + esc(itemTitle) + '" draggable="false" />' +
            '<div class="detail-sim-overlay">' +
              '<div class="detail-sim-title">' + esc(itemTitle) + '</div>' +
              '<div class="detail-sim-sub">' + esc(subLine) + '</div>' +
            '</div>' +
          '</div>';
        }).join("");
        unlockCatalogCoversLoadingClient(false);
        observeLazyCoversInContainerClient(gridEl);
      }

      function openPersonFromSpotlightBtn(btn) {
        if (!btn) return;
        const pid = Number(btn.getAttribute("data-pid") || 0);
        const pname = btn.getAttribute("data-pname") || "";
        saveLastClosedDetailItemClient();
        closeDetailModal();
        if (pid > 0) {
          openPersonView(pid, pname);
        } else {
          runSearch(false, pname, "person");
        }
      }

      async function openPersonSpotlightOverlayClient(personId, personName, roleLabel = "", photoUrl = "") {
        let root = document.getElementById("personSpotlightOverlayRoot");
        if (!root) {
          const m = document.getElementById("modalRoot");
          if (!m) {
            if (personId) openPersonView(personId, personName);
            else runSearch(false, personName, "person");
            return;
          }
          root = document.createElement("div");
          root.id = "personSpotlightOverlayRoot";
          m.appendChild(root);
        }
        const cleanName = String(personName || "Person").trim();
        const fbAvatar = buildActorAvatarFallbackSvgClient(cleanName);
        const initialAvatar = photoUrl || fbAvatar;
        const subText = roleLabel ? String(roleLabel) : "Schauspiel & Regie";
        activePersonSpotlightItemsCache = [];
        activePersonSpotlightFilter = "all";

        root.innerHTML = '<div class="person-spotlight-backdrop" onclick="if(event.target===this)closePersonSpotlightOverlayClient(event)">' +
          '<div class="person-spotlight-card" role="dialog" aria-label="' + esc(cleanName) + '">' +
            '<div class="person-spotlight-header">' +
              '<div class="person-spotlight-profile">' +
                '<img id="personSpotlightAvatarEl" class="person-spotlight-avatar" src="' + esc(initialAvatar) + '" alt="' + esc(cleanName) + '" onerror="this.onerror=null;this.src=\\'' + escJs(fbAvatar) + '\\';" />' +
                '<div>' +
                  '<h3 class="person-spotlight-name">' + esc(cleanName) + '</h3>' +
                  '<div id="personSpotlightSubEl" class="person-spotlight-sub">' + esc(subText) + '</div>' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                '<button type="button" class="detail-btn-glass" data-pid="' + Number(personId || 0) + '" data-pname="' + esc(cleanName) + '" onclick="openPersonFromSpotlightBtn(this)">🔍 Im Hauptkatalog öffnen</button>' +
                '<button type="button" class="detail-btn-glass" onclick="closePersonSpotlightOverlayClient(event)">✕ Schließen</button>' +
              '</div>' +
            '</div>' +
            '<div id="personSpotlightBioWrapEl" style="display:none;flex-direction:column;gap:4px">' +
              '<div id="personSpotlightBioEl" class="person-spotlight-bio" onclick="togglePersonSpotlightBioExpandClient()"></div>' +
              '<span id="personSpotlightBioHintEl" style="display:none;font-size:11px;font-weight:800;color:#38bdf8;cursor:pointer;align-self:flex-start" onclick="togglePersonSpotlightBioExpandClient()">▾ Biografie ganz lesen</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div class="detail-section-heading" style="font-size:calc(15px * var(--scale-text))">Verfügbare Filme & Serien mit ' + esc(cleanName) + ' <span id="personSpotlightCountLbl" style="color:#38bdf8;font-size:13px"></span></div>' +
              '<div id="personSpotlightFilterBarEl" style="display:none;gap:5px;flex-wrap:wrap"></div>' +
            '</div>' +
            '<div id="personSpotlightGridEl" class="person-spotlight-grid">' +
              '<div style="grid-column:1 / -1;font-size:13px;color:#94a3b8;padding:12px 2px">⏳ Lade Filmografie aus dem Katalog...</div>' +
            '</div>' +
          '</div>' +
        '</div>';

        try {
          const url = API_BASE + "/search?" +
            (personId ? ("personId=" + encodeURIComponent(personId)) : "scope=person") +
            "&q=" + encodeURIComponent(cleanName) +
            "&bypass=1&sort=pop_desc";
          const res = await apiFetchJson(url);
          const gridEl = document.getElementById("personSpotlightGridEl");
          if (!gridEl) return;
          const pInfo = Array.isArray(res?.persons) && res.persons[0] ? res.persons[0] : null;
          if (pInfo) {
            if (pInfo.profile_path && !photoUrl) {
              const avEl = document.getElementById("personSpotlightAvatarEl");
              if (avEl) avEl.src = resolvePosterUrlClient(pInfo.profile_path, "w185", "");
            }
            if (pInfo.biography) {
              const bioWrap = document.getElementById("personSpotlightBioWrapEl");
              const bioEl = document.getElementById("personSpotlightBioEl");
              const bioHint = document.getElementById("personSpotlightBioHintEl");
              if (bioWrap && bioEl) {
                bioEl.textContent = pInfo.biography;
                bioWrap.style.display = "flex";
                if (bioHint && pInfo.biography.length > 180) {
                  bioHint.style.display = "inline-block";
                }
              }
            }
            const subParts = [roleLabel, pInfo.birthday ? ("* " + pInfo.birthday.slice(0, 4)) : "", pInfo.place_of_birth || ""].filter(Boolean);
            const subEl = document.getElementById("personSpotlightSubEl");
            if (subEl && subParts.length > 0) subEl.textContent = subParts.join(" · ");
          }
          activePersonSpotlightItemsCache = Array.isArray(res?.items) ? res.items : [];
          renderPersonSpotlightGridCardsClient("all");
        } catch (_err) {
          const gridEl = document.getElementById("personSpotlightGridEl");
          if (gridEl) gridEl.innerHTML = '<div style="grid-column:1 / -1;font-size:13px;color:#94a3b8">Titel konnten nicht geladen werden.</div>';
        }
      }

      async function autoLoadSimilarInDetailClient(type, id) {
        const wrap = document.getElementById("detailSimilarSectionWrap");
        const track = document.getElementById("detailSimilarTrackEl");
        if (!track) return;
        const onlyVipFlag = state.settings?.onlyVipStreams ? "1" : "0";
        try {
          const r = await apiFetchJson(
            API_BASE + "/similar?type=" + encodeURIComponent(type) +
            "&id=" + encodeURIComponent(id) +
            "&onlyVip=" + onlyVipFlag
          );
          if (!state.activeDetails || String(state.activeDetails.id) !== String(id)) return;
          let items = Array.isArray(r?.items) ? r.items : [];
          if (state.settings?.onlyVipStreams) {
            items = items.filter(it => it && Boolean(it.vipQuality || it.hasVipStream));
          }
          if (items.length === 0) {
            if (wrap) wrap.style.display = "none";
            return;
          }
          if (wrap) wrap.style.display = "flex";
          track.innerHTML = items.slice(0, 16).map(it => {
            const tc = it.media_type === "tv" ? "s" : (it.media_type === "movie" ? "m" : type);
            const itemTitle = String(it.title || it.name || "Titel").trim();
            const fbSvg = buildPosterFallbackSvg(itemTitle, tc === "s");
            const simPoster = resolvePosterUrlClient(it.poster_path, "w342", it.external_poster_url || it.poster || "") || fbSvg;
            const voteStr = it.vote_average ? Number(it.vote_average).toFixed(1) : "";
            const yearStr = String(it.release_date || it.first_air_date || "").slice(0, 4);
            const typeWord = tc === "s" ? "Serie" : "Film";
            const subParts = [voteStr, yearStr, typeWord].filter(Boolean).join(" · ");
            return '<div class="detail-sim-card" tabindex="0" data-card-title="' + esc(itemTitle) + '" onclick="openDetails(\\'' + tc + '\\',' + Number(it.id) + ')" onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();openDetails(\\'' + tc + '\\',' + Number(it.id) + ');}">' +
              '<img class="detail-sim-poster lazy-cover-img is-loading" src="' + LAZY_POSTER_PLACEHOLDER_SVG + '" data-lazy-src="' + esc(simPoster) + '" alt="' + esc(itemTitle) + '" draggable="false" oncontextmenu="return false;" />' +
              '<div class="detail-sim-overlay">' +
                '<div class="detail-sim-title">' + esc(itemTitle) + '</div>' +
                '<div class="detail-sim-sub">' + esc(subParts) + '</div>' +
              '</div>' +
            '</div>';
          }).join("");
          unlockCatalogCoversLoadingClient(false);
          observeLazyCoversInContainerClient(track);
          syncDetailCarouselSideButtonsClient(track);
          setTimeout(() => syncDetailCarouselSideButtonsClient(track), 120);
        } catch (_err) {
          if (wrap) wrap.style.display = "none";
        }
      }

      async function autoLoadCollectionInDetailClient(colId, currentMovieId) {
        const wrap = document.getElementById("detailCollectionSectionWrap");
        const track = document.getElementById("detailCollectionTrackEl");
        if (!track || !colId) return;
        try {
          const r = await apiFetchJson(
            API_BASE + "/collections?id=" + encodeURIComponent(colId) +
            "&sort=year_asc"
          );
          if (!state.activeDetails || !state.activeDetails.collection || String(state.activeDetails.collection.id) !== String(colId)) return;
          const items = Array.isArray(r?.items) ? r.items : [];
          if (items.length <= 1) {
            if (wrap) wrap.style.display = "none";
            return;
          }
          if (wrap) wrap.style.display = "flex";
          track.innerHTML = items.map(it => {
            const tc = it.media_type === "tv" ? "s" : "m";
            const itemTitle = String(it.title || it.name || "Titel").trim();
            const isCurPart = String(it.id) === String(currentMovieId);
            const fbSvg = buildPosterFallbackSvg(itemTitle, tc === "s");
            const colPoster = resolvePosterUrlClient(it.poster_path, "w342", it.external_poster_url || it.poster || "") || fbSvg;
            const voteStr = it.vote_average ? ("★ " + Number(it.vote_average).toFixed(1)) : "";
            const yearStr = String(it.release_date || it.first_air_date || "").slice(0, 4);
            const subParts = [yearStr, voteStr].filter(Boolean).join(" · ");
            return '<div class="detail-sim-card' + (isCurPart ? ' is-current-part' : '') + '" tabindex="0" data-card-title="' + esc(itemTitle) + '" onclick="openDetails(\\'' + tc + '\\',' + Number(it.id) + ')" onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();openDetails(\\'' + tc + '\\',' + Number(it.id) + ');}">' +
              (isCurPart ? '<span class="detail-sim-current-badge">Aktuell</span>' : '') +
              '<img class="detail-sim-poster lazy-cover-img is-loading" src="' + LAZY_POSTER_PLACEHOLDER_SVG + '" data-lazy-src="' + esc(colPoster) + '" alt="' + esc(itemTitle) + '" draggable="false" oncontextmenu="return false;" />' +
              '<div class="detail-sim-overlay">' +
                '<div class="detail-sim-title">' + esc(itemTitle) + '</div>' +
                '<div class="detail-sim-sub">' + esc(subParts) + '</div>' +
              '</div>' +
            '</div>';
          }).join("");
          unlockCatalogCoversLoadingClient(false);
          observeLazyCoversInContainerClient(track);
          syncDetailCarouselSideButtonsClient(track);
          setTimeout(() => syncDetailCarouselSideButtonsClient(track), 120);
        } catch (_err) {
          if (wrap) wrap.style.display = "none";
        }
      }

      async function loadSimilarInTma(type, id) {
        return autoLoadSimilarInDetailClient(type, id);
      }

      function saveLastClosedDetailItemClient() {
        const d = state.activeDetails;
        if (!d || !d.id) return;
        state.lastClosedDetailItem = {
          typeCode: d.typeCode || state.type || "m",
          id: d.id,
          title: d.title || d.name || "Titel",
          poster_path: d.poster_path || d.external_poster_url || ""
        };
      }

      function reopenLastClosedDetailItemClient() {
        const last = state.lastClosedDetailItem;
        if (!last || !last.id) return;
        openDetails(last.typeCode || "m", last.id, false, last.title || "", last.poster_path || "");
      }

      function dismissLastClosedDetailItemClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        state.lastClosedDetailItem = null;
        const fm = document.getElementById("floatingFilterMount");
        if (fm) fm.innerHTML = buildFloatingFilterBarHtml();
      }

      // Wischgesten (Swipe Touch + Maus + Trackpad) und Pfeil-Wechsel (◀ / ▶) zum nächsten/vorherigen Titel basierend auf der Herkunftsliste (#10)
      function getActiveDetailNavigationPoolClient() {
        if (state.currentView === "wishlist" && Array.isArray(state.cachedWishlistItems) && state.cachedWishlistItems.length > 1) {
          return state.cachedWishlistItems;
        }
        if (Array.isArray(state.items) && state.items.length > 1) {
          return state.items;
        }
        return [];
      }

      function getAdjacentDetailItem(step) {
        const pool = getActiveDetailNavigationPoolClient();
        if (!state.activeDetails || pool.length <= 1) return null;
        const curId = String(state.activeDetails.id);
        const idx = pool.findIndex(x => x && String(x.id || x.tmdb_id) === curId);
        if (idx === -1) return null;
        const nextIdx = (idx + step + pool.length) % pool.length;
        const cand = pool[nextIdx];
        const candId = cand && (cand.id || cand.tmdb_id);
        if (!cand || !candId) return null;
        const tc = cand.media_type === "tv" || cand.type === "s" ? "s" : cand.media_type === "movie" || cand.type === "m" ? "m" : state.type;
        return {
          typeCode: tc,
          id: candId,
          title: cand.title || cand.name || "",
          poster_path: cand.poster_path || cand.poster || "",
          index: nextIdx,
          total: pool.length
        };
      }

      let isDetailAdjacentTransitionBusy = false;
      function navigateDetailModalAdjacent(step) {
        if (isDetailAdjacentTransitionBusy) return;
        const adj = getAdjacentDetailItem(step);
        if (!adj) return;
        triggerTmaHapticClient("selection");
        const stageEl = document.getElementById("detailHeroStageEl");
        const bodyEl = document.querySelector("#modalRoot .detail-content-body");
        if (stageEl) {
          isDetailAdjacentTransitionBusy = true;
          const slideDir = step > 0 ? "-18px" : "18px";
          stageEl.style.setProperty("--adj-slide-dir", slideDir);
          stageEl.classList.add("detail-stage-transitioning");
          if (bodyEl) {
            bodyEl.style.setProperty("--adj-slide-dir", slideDir);
            bodyEl.classList.add("detail-stage-transitioning");
          }
          setTimeout(() => {
            isDetailAdjacentTransitionBusy = false;
            openDetails(adj.typeCode, adj.id, false, adj.title, adj.poster_path);
          }, 145);
          return;
        }
        openDetails(adj.typeCode, adj.id, false, adj.title, adj.poster_path);
      }

      let lastModalHorizontalWheelAt = 0;
      function onModalWheelHorizontalClient(ev) {
        if (!ev) return;
        if (ev.target && typeof ev.target.closest === "function" && ev.target.closest(".detail-cast-track, .detail-similar-track, .season-toolbar-row")) {
          return;
        }
        const deltaMult = ev.deltaMode === 1 ? 24 : (ev.deltaMode === 2 ? 360 : 1);
        const dx = (Number(ev.deltaX) || 0) * deltaMult;
        const dy = (Number(ev.deltaY) || 0) * deltaMult;
        if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) * 1.35) {
          const now = Date.now();
          if (now - lastModalHorizontalWheelAt < 450) return;
          lastModalHorizontalWheelAt = now;
          ev.preventDefault();
          navigateDetailModalAdjacent(dx > 0 ? 1 : -1);
        }
      }

      let modalTouchStartY = 0;
      let modalTouchStartTime = 0;
      let modalLastTouchTapAt = 0;
      let modalPointerStartX = 0;
      let modalPointerStartY = 0;

      function isInteractiveDetailHeroControl(target) {
        if (!target || typeof target.closest !== "function") return false;
        return Boolean(
          target.closest(
            "button, a, select, input, .detail-foreground-stage-catcher, .detail-cinema-player-dock, .detail-kicker-link, .return-last-detail-chip, .expandable-desc-box, .hero-scroll-down-hint, .detail-cast-track, .detail-similar-track, #modalPosterPickerBox, #modalRemapMediaBox, #modalMoreActionsBox"
          )
        );
      }

      function tryToggleTrailerForegroundOnStageTapClient(ev) {
        const stageEl = document.getElementById("detailHeroStageEl");
        if (!stageEl) return false;
        if (stageEl.classList.contains("is-trailer-foreground-mode")) {
          exitDetailForegroundTrailerModeClient(ev);
          return true;
        }
        // Jeder Tipp/Klick auf das freie Szenenbild (Backdrop-Foto) oder den Hintergrund-Trailer blendet alle Details aus & holt den Trailer in den Vordergrund!
        enterDetailForegroundTrailerModeClient(ev, true);
        return true;
      }

      function onModalHeroTouchStart(ev) {
        if (isInteractiveDetailHeroControl(ev.target)) {
          modalTouchStartX = 0;
          modalTouchStartY = 0;
          modalTouchStartTime = 0;
          return;
        }
        if (ev.touches && ev.touches[0]) {
          modalTouchStartX = ev.touches[0].clientX;
          modalTouchStartY = ev.touches[0].clientY;
          modalTouchStartTime = Date.now();
        }
      }

      function onModalHeroTouchEnd(ev) {
        if (!modalTouchStartX || !ev.changedTouches || !ev.changedTouches[0]) return;
        const dx = ev.changedTouches[0].clientX - modalTouchStartX;
        const dy = ev.changedTouches[0].clientY - (modalTouchStartY || ev.changedTouches[0].clientY);
        const dt = Date.now() - (modalTouchStartTime || Date.now());
        modalTouchStartX = 0;
        modalTouchStartY = 0;
        modalTouchStartTime = 0;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.35) {
          navigateDetailModalAdjacent(dx < 0 ? 1 : -1);
          return;
        }
        // Kurzes Antippen (<14px Bewegung auf Tablet/Smartphone) auf das Szenenbild oder Video -> Alle Details ausblenden & Trailer in den Vordergrund!
        if (Math.abs(dx) < 14 && Math.abs(dy) < 14 && dt < 450 && !isInteractiveDetailHeroControl(ev.target)) {
          modalLastTouchTapAt = Date.now();
          tryToggleTrailerForegroundOnStageTapClient(ev);
        }
      }

      function onModalHeroMouseDown(ev) {
        if (ev.button !== 0 || isInteractiveDetailHeroControl(ev.target)) {
          modalPointerStartX = 0;
          modalPointerStartY = 0;
          return;
        }
        if (ev.cancelable) ev.preventDefault();
        try { window.getSelection()?.removeAllRanges(); } catch (_e) {}
        modalPointerStartX = ev.clientX;
        modalPointerStartY = ev.clientY;
      }

      function onModalHeroMouseUp(ev) {
        if (!modalPointerStartX) return;
        const dx = ev.clientX - modalPointerStartX;
        const dy = ev.clientY - (modalPointerStartY || ev.clientY);
        modalPointerStartX = 0;
        modalPointerStartY = 0;
        if (Date.now() - modalLastTouchTapAt < 450) return;
        if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.35) {
          navigateDetailModalAdjacent(dx < 0 ? 1 : -1);
          return;
        }
        // Klick (<10px Bewegung) auf das Szenenbild oder Video -> Alle Details ausblenden & Trailer in den Vordergrund!
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && !isInteractiveDetailHeroControl(ev.target)) {
          tryToggleTrailerForegroundOnStageTapClient(ev);
        }
      }

      function getDetailBackButtonLabelClient(typeCode) {
        if (state.isSearchMode) return "← Zurück";
        if (state.currentView === "wishlist") return "← Merkliste";
        if (state.currentCollectionId) return "← Filmreihe";
        if (state.currentUniverseId) return "← Universum";
        if (state.currentPersonId) return "← " + (state.currentPersonName || "Person");
        if (state.currentCompanyId) return "← " + (state.currentCompanyName || "Studio");
        return "← Zurück";
      }

      function getPlayableMovieFilesForHeroClient(d) {
        const allRawFiles = Array.isArray(d?.files) ? d.files.filter(f => f && f.telegram_file_id) : [];
        const isArch = (f) => Boolean(
          f.is_download_only || f.isArchive || f.type === "archive" ||
          /\\.(?:rar|zip|7z|iso|tar|gz|r\\d{2}|z\\d{2})$|\\.(?:7z|zip|rar)\\.\\d{3}$/i.test(String(f.raw_filename || f.file_name || "")) ||
          String(f.codec || "").toUpperCase() === "RAR"
        );
        return allRawFiles.filter(f => !isArch(f));
      }

      function getSeriesVersionProfilesForHeroClient(d) {
        const files = Array.isArray(d?.allStreamFiles) && d.allStreamFiles.length > 0
          ? d.allStreamFiles
          : (Array.isArray(d?.files) ? d.files : []);
        const map = new Map();
        for (const f of files) {
          if (!f || f.is_download_only || f.isDownloadOnly) continue;
          const vLbl = String(f.versionLabel || f.version_label || cleanUserVisibleStreamTagsClient(f.tags || "") || "Originalfassung").trim() || "Originalfassung";
          const qLbl = String(f.quality || "1080p").trim() || "1080p";
          const key = qLbl + " · " + vLbl;
          map.set(key, (map.get(key) || 0) + 1);
        }
        if (map.size === 0 && Array.isArray(d?.availableVersions)) {
          for (const v of d.availableVersions) {
            if (!v) continue;
            const key = (d.vipQuality || "1080p") + " · " + String(v).trim();
            map.set(key, 1);
          }
        }
        return Array.from(map.entries()).map(([key, count]) => ({ key, count }));
      }

      function onDetailHeroVersionChangeClient(selectEl) {
        if (!selectEl || !state.activeDetails) return;
        const val = String(selectEl.value || "");
        const d = state.activeDetails;
        const type = d.typeCode || "m";
        state.activeDetails._selectedHeroVersionValue = val;
        if (type === "s") {
          const curSeason = Number(state.activeDetails._activeLoadedSeason ?? d.firstVipSeason ?? 1);
          selectSeasonPreferredProfileClient(d.id, curSeason, val || "auto");
        }
      }

      function triggerDetailHeroPrimaryPlayClient() {
        const d = state.activeDetails;
        if (!d) return;
        const type = d.typeCode || "m";
        const vipAllowed = isCurrentUserVip();
        if (!vipAllowed) {
          const poster = resolvePosterUrlClient(d.poster_path, "w342", d.external_poster_url || "");
          playInstantTrailerFromCard(null, type, d.id, d.title, poster);
          return;
        }
        const selectEl = document.getElementById("detailHeroVersionSelect");
        const selectedVal = selectEl ? String(selectEl.value || "0") : String(d._selectedHeroVersionValue || "0");

        if (type === "m") {
          const movieFiles = getPlayableMovieFilesForHeroClient(d);
          if (movieFiles.length === 0) {
            const seasonSec = document.getElementById("detailStreamsSection");
            if (seasonSec) seasonSec.scrollIntoView({ behavior: "smooth" });
            return;
          }
          const idx = Math.max(0, Math.min(movieFiles.length - 1, Number(selectedVal) || 0));
          const f = movieFiles[idx] || movieFiles[0];
          const sizeLabel = formatFileSizeClient(f.file_size);
          const partLabel = normalizeClientPartLabel(f.part, f.raw_filename || "");
          const tagsLabel = cleanUserVisibleStreamTagsClient(f.tags || f.versionLabel || f.version_label || "");
          requestTelegramStream(
            f.telegram_file_id,
            d.title + (partLabel ? " (" + partLabel + ")" : ""),
            f.quality || "1080p",
            { fileSize: sizeLabel, tags: tagsLabel }
          );
          return;
        }

        // Serie: Spiele gespeicherte Fortschritts-Folge oder erste verfügbare Folge in der gewählten Version ab
        const prog = getSeriesProgress(d.id);
        const episodes = Array.isArray(activeSeasonCacheEpisodes) ? activeSeasonCacheEpisodes : [];
        let targetEp = null;
        if (prog && prog.episode) {
          targetEp = episodes.find(e => Number(e.episode_number) === Number(prog.episode) && Array.isArray(e.files) && e.files.length > 0);
        }
        if (!targetEp) {
          targetEp = episodes.find(e => Array.isArray(e.files) && e.files.length > 0) || null;
        }
        if (targetEp && Array.isArray(targetEp.files) && targetEp.files.length > 0) {
          let chosenFile = targetEp._resolvedActiveFile || targetEp.files[0];
          if (selectedVal && selectedVal !== "auto") {
            const matched = targetEp.files.find(f => {
              const vLbl = String(f.versionLabel || f.version_label || cleanUserVisibleStreamTagsClient(f.tags || "") || "Originalfassung").trim() || "Originalfassung";
              const qLbl = String(f.quality || "1080p").trim() || "1080p";
              return (qLbl + " · " + vLbl) === selectedVal;
            });
            if (matched) chosenFile = matched;
          }
          const curSeason = Number(targetEp.season_number ?? prog?.season ?? d.firstVipSeason ?? 1);
          const epCode = "S" + String(curSeason).padStart(2, "0") + "E" + String(targetEp.episode_number).padStart(2, "0");
          const sizeLabel = formatFileSizeClient(chosenFile.file_size);
          const tagsLabel = cleanUserVisibleStreamTagsClient(chosenFile.tags || chosenFile.versionLabel || chosenFile.version_label || "");
          setSeriesProgress(d.id, curSeason, targetEp.episode_number, targetEp.name || "");
          requestTelegramStream(
            chosenFile.telegram_file_id || chosenFile.file_id,
            d.title + " " + epCode + (targetEp.name ? " - " + targetEp.name : ""),
            chosenFile.quality || "1080p",
            { fileSize: sizeLabel, tags: tagsLabel, seriesId: d.id, seasonNumber: curSeason, episodeNumber: targetEp.episode_number }
          );
          return;
        }
        const allSeriesFiles = Array.isArray(d.allStreamFiles) ? d.allStreamFiles.filter(f => f && f.telegram_file_id && !f.is_download_only) : [];
        if (allSeriesFiles.length > 0) {
          const f0 = allSeriesFiles[0];
          const sNum = Number(f0.season_number ?? 1);
          const eNum = Number(f0.episode_number ?? 1);
          const epCode = "S" + String(sNum).padStart(2, "0") + "E" + String(eNum).padStart(2, "0");
          requestTelegramStream(
            f0.telegram_file_id,
            d.title + " " + epCode,
            f0.quality || "1080p",
            { fileSize: formatFileSizeClient(f0.file_size), tags: cleanUserVisibleStreamTagsClient(f0.tags || ""), seriesId: d.id, seasonNumber: sNum, episodeNumber: eNum }
          );
          return;
        }
        const seasonBox = document.getElementById("seasonBox");
        if (seasonBox) seasonBox.scrollIntoView({ behavior: "smooth" });
      }

      function prepareDiscoverContextFromModal() {
        saveLastClosedDetailItemClient();
        closeDetailModal();
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
        saveLastClosedDetailItemClient();
        closeDetailModal();
        runSearch(false, "(" + y + ")", "all");
      }

      function filterOrSearchStudioFromModal(studioName, companyId = "") {
        saveLastClosedDetailItemClient();
        if (companyId) {
          closeDetailModal();
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
          closeDetailModal();
          runSearch(false, studioName, "all");
        }
      }

      function filterOrSearchProviderFromModal(provName) {
        saveLastClosedDetailItemClient();
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
          closeDetailModal();
          runSearch(false, provName, "all");
        }
      }

      function buildMutedActiveFiltersForDetailHtml() {
        const s = state.settings || {};
        const chips = [];
        if (state.isSearchMode && state.searchQuery) {
          chips.push('<span class="detail-active-filter-chip muted" title="Aktive Suche">🔍 „' + esc(state.searchQuery) + '“</span>');
        }
        if (state.currentCompanyId && state.currentCompanyName) {
          chips.push('<span class="detail-active-filter-chip muted" title="Aktives Studio">🏢 ' + esc(state.currentCompanyName) + '</span>');
        }
        if (state.currentPersonId && state.currentPersonName) {
          chips.push('<span class="detail-active-filter-chip muted" title="Aktive Person">🌟 ' + esc(state.currentPersonName) + '</span>');
        }
        if (state.genreId && state.genreId !== "all") {
          const genreMap = (Object.keys(state.genres || {}).length > 0)
            ? state.genres
            : (state.type === "s" ? SERIES_GENRES_CLIENT : MOVIE_GENRES_CLIENT);
          const gEntry = Object.entries(genreMap).find(([, id]) => String(id) === String(state.genreId));
          if (gEntry) {
            chips.push('<span class="detail-active-filter-chip muted">' + genreEmoji(gEntry[0]) + ' ' + esc(gEntry[0]) + '</span>');
          }
        }
        (s.includedGenres || []).slice(0, 3).forEach(g => {
          chips.push('<span class="detail-active-filter-chip muted">' + genreEmoji(g) + ' ' + esc(g) + '</span>');
        });
        const rawIncPlatforms = Array.isArray(s.includedPlatforms) ? s.includedPlatforms : [];
        const incPlatforms = Array.from(new Set(rawIncPlatforms.map(normalizePlatformIdClient).filter(Boolean)));
        incPlatforms.slice(0, 2).forEach(pid => {
          chips.push('<span class="detail-active-filter-chip muted">' + esc(getPlatformDisplayLabelClient(pid)) + '</span>');
        });
        (s.includedEras || []).slice(0, 2).forEach(eid => {
          const er = ERA_OPTIONS_CLIENT.find(e => e.id === eid);
          chips.push('<span class="detail-active-filter-chip muted">📅 ' + esc(er ? er.label : eid) + '</span>');
        });
        (s.includedStudios || []).slice(0, 2).forEach(sid => {
          const st = STUDIO_OPTIONS_CLIENT.find(x => x.id === sid);
          chips.push('<span class="detail-active-filter-chip muted">' + esc(st ? (st.icon + " " + st.label) : sid) + '</span>');
        });
        (s.includedFsk || []).slice(0, 1).forEach(f => {
          chips.push('<span class="detail-active-filter-chip muted">🔞 ' + esc(f) + '</span>');
        });
        if (s.onlyVipStreams && isCurrentUserVip()) {
          chips.push('<span class="detail-active-filter-chip muted">🌟 Nur Streams</span>');
        }
        return chips.slice(0, 6).join("");
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
            b.className = "btn " + (isMatch ? "blue" : "");
            if (tpObj) b.textContent = tpObj.label + (isMatch ? " ✓ Standard" : "");
          });
        }
        const d = state.activeDetails;
        if (!d || !d.trailers || !d.trailers.embeds) return;
        const embedUrl = d.trailers.embeds[activeKey] || d.trailers.embeds.youtube;
        const box = document.getElementById("trailerEmbedContainer");
        if (box) {
          box.innerHTML = '<div class="embed-box"><iframe class="embed-frame" src="' + esc(embedUrl) + '" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" playsinline="1" webkit-playsinline="1"></iframe></div>';
          return;
        }
        const activeIframe = document.getElementById("detailBgTeaserIframe");
        if (activeIframe && embedUrl) {
          activeIframe.src = embedUrl;
        }
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
        const sNum = (season !== undefined && season !== null && String(season).trim() !== "") ? Number(season) : NaN;
        const eNum = Number(episode);
        if (!seriesId || !Number.isFinite(sNum) || sNum < 0 || !Number.isFinite(eNum) || eNum <= 0) return;
        try {
          const map = getSeriesProgressMap();
          map[String(seriesId)] = {
            season: sNum,
            episode: eNum,
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

      function toggleModalCreditsBox() {}

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

      function findPreloadedSeedItemClient(typeCode, id, preTitle = "", prePoster = "") {
        const tc = typeCode === "s" ? "s" : "m";
        const idStr = String(id || "");
        const pools = [
          Array.isArray(state.heroSlides) ? state.heroSlides : [],
          Array.isArray(state.items) ? state.items : [],
          Array.isArray(state.collectionItems) ? state.collectionItems : [],
          Array.isArray(state.universeItems) ? state.universeItems : []
        ];
        let hit = null;
        for (const list of pools) {
          const found = list.find(it => {
            if (!it || String(it.id || it.tmdbId || "") !== idStr) return false;
            if (it.media_type) {
              const itTc = it.media_type === "tv" ? "s" : "m";
              return itTc === tc;
            }
            return true;
          });
          if (found) {
            hit = found;
            break;
          }
        }
        if (!hit && !preTitle && !prePoster) return null;
        const rawTitle = String(hit?.title || hit?.name || preTitle || "").replace(/\\s*\\(\\d{4}\\)$/, "").trim();
        if (!rawTitle) return null;
        const posterPath = hit?.poster_path || hit?.poster || prePoster || "";
        const backdropPath = hit?.backdrop_path || "";
        const extPoster = hit?.external_poster_url || "";
        if (!posterPath && !backdropPath && !extPoster) return null;

        const rawDate = String(hit?.release_date || hit?.first_air_date || hit?.year || "");
        const yearStr = rawDate.slice(0, 4) || "K.A.";
        const voteNum = Number(hit?.vote_average || hit?.vote || 0);
        const voteStr = voteNum > 0 ? String(Math.round(voteNum * 10) / 10) : "–";
        const cardKey = tc + "_" + idStr;
        const logoPath = hit?.logo_path || (typeof clientClearLogoCache !== "undefined" ? (clientClearLogoCache.get(cardKey) || "") : "");

        let genresStr = "";
        if (typeof hit?.genres === "string" && hit.genres) {
          genresStr = hit.genres;
        } else if (Array.isArray(hit?.genre_ids) && hit.genre_ids.length > 0 && state.genres && typeof state.genres === "object") {
          genresStr = hit.genre_ids.map(gid => state.genres[gid] || "").filter(Boolean).slice(0, 3).join(", ");
        }

        return {
          id: Number(id) || id,
          typeCode: tc,
          title: rawTitle,
          year: yearStr,
          vote: voteStr,
          fsk: "",
          runtime: "",
          country: "",
          statusText: "",
          numberOfSeasons: 0,
          numberOfEpisodes: 0,
          genres: genresStr,
          studios: "",
          studiosList: [],
          providers: "",
          providerButtons: [],
          directors: "",
          directorsList: [],
          casts: "",
          castList: [],
          overview: String(hit?.overview || "").trim(),
          _originalOverviewEn: hit?._originalOverviewEn || "",
          _translatedOverviewDe: hit?._translatedOverviewDe || "",
          _showTranslatedOverviewDe: Boolean(hit?._showTranslatedOverviewDe),
          poster_path: posterPath,
          external_poster_url: extPoster,
          backdrop_path: backdropPath,
          logo_path: logoPath,
          collection: null,
          universe: null,
          telegraphUrl: "",
          tmdbDeUrl: "https://www.themoviedb.org/" + (tc === "m" ? "movie" : "tv") + "/" + idStr + "?language=de-DE",
          isSaved: typeof savedKeysSet !== "undefined" && savedKeysSet.has(cardKey),
          trailers: null,
          files: [],
          downloads: [],
          allStreamFiles: [],
          availableVersions: hit?.vipQuality ? [String(hit.vipQuality)] : [],
          primaryVersionLabel: hit?.vipQuality ? String(hit.vipQuality) : "",
          _isSeedStageOnly: true
        };
      }
