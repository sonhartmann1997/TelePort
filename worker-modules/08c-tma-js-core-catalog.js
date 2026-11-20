    <script>
      const API_BASE = "${workerOrigin}/api/tma";
      const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
      if (tg) {
        try {
          tg.ready();
          tg.expand();
          if (typeof tg.disableVerticalSwipes === "function") {
            tg.disableVerticalSwipes();
          }
        } catch (e) {}
      }

      function syncTelegramBackButtonClient() {
        try {
          const liveTg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : tg;
          if (!liveTg || !liveTg.BackButton) return;
          const modalRoot = document.getElementById("modalRoot");
          const hasModal = Boolean(modalRoot && modalRoot.innerHTML.trim().length > 0);
          const spotlightRoot = document.getElementById("personSpotlightOverlayRoot");
          const hasSpotlight = Boolean(spotlightRoot && spotlightRoot.innerHTML.trim().length > 0);
          const customDialogRoot = document.getElementById("customDialogRoot");
          const hasCustomDialog = Boolean(customDialogRoot && customDialogRoot.innerHTML.trim().length > 0);
          const isSidebarOpen = Boolean(typeof state !== "undefined" && state.sidebarOpen);
          const isNonDiscoverView = Boolean(typeof state !== "undefined" && state.currentView && state.currentView !== "discover");

          if (hasModal || hasSpotlight || hasCustomDialog || isSidebarOpen || isNonDiscoverView) {
            liveTg.BackButton.show();
            if (typeof liveTg.BackButton.offClick === "function") {
              liveTg.BackButton.offClick(handleTelegramBackButtonClickClient);
            }
            liveTg.BackButton.onClick(handleTelegramBackButtonClickClient);
          } else {
            liveTg.BackButton.hide();
            if (typeof liveTg.BackButton.offClick === "function") {
              liveTg.BackButton.offClick(handleTelegramBackButtonClickClient);
            }
          }
        } catch (e) {}
      }

      function handleTelegramBackButtonClickClient() {
        try {
          const customDialogRoot = document.getElementById("customDialogRoot");
          if (customDialogRoot && customDialogRoot.innerHTML.trim().length > 0) {
            if (customDialogRoot.querySelector(".page-jump-modal-backdrop") && typeof closePageJumpModalClient === "function") {
              closePageJumpModalClient();
            } else if (typeof closeCustomDialog === "function") {
              closeCustomDialog(null);
            } else {
              customDialogRoot.innerHTML = "";
            }
            syncTelegramBackButtonClient();
            return;
          }
          const modalRoot = document.getElementById("modalRoot");
          if (modalRoot && modalRoot.innerHTML.trim().length > 0) {
            if (typeof closeDetailModal === "function") closeDetailModal();
            syncTelegramBackButtonClient();
            return;
          }
          const spotlightRoot = document.getElementById("personSpotlightOverlayRoot");
          if (spotlightRoot && spotlightRoot.innerHTML.trim().length > 0 && typeof closePersonSpotlightOverlayClient === "function") {
            closePersonSpotlightOverlayClient();
            syncTelegramBackButtonClient();
            return;
          }
          if (typeof state !== "undefined" && state.sidebarOpen && typeof closeFilterSidebar === "function") {
            closeFilterSidebar();
            syncTelegramBackButtonClient();
            return;
          }
          if (typeof state !== "undefined" && state.currentView && state.currentView !== "discover" && typeof loadDiscover === "function") {
            loadDiscover(state.type, state.genreId, state.mode, state.sort, false, false, 1);
            syncTelegramBackButtonClient();
            return;
          }
        } catch (e) {}
      }

      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        window.addEventListener("load", function() {
          navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function() {});
        });
      }

      window.addEventListener("offline", function() {
        if (typeof showHudToast === "function") {
          showHudToast("📡 Offline – Gecachte Filme & Merkliste bleiben verfügbar.");
        }
      });
      window.addEventListener("online", function() {
        if (typeof showHudToast === "function") {
          showHudToast("🟢 Verbindung wiederhergestellt");
        }
      });
      function extractClientTelegramInitData() {
        try {
          const liveTg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : tg;
          if (liveTg && typeof liveTg.initData === "string" && liveTg.initData.trim().length > 0) {
            return liveTg.initData.trim();
          }
        } catch (e) {}
        try {
          const hashStr = String(window.location.hash || "").replace(/^#/, "");
          if (hashStr) {
            const hashParams = new URLSearchParams(hashStr);
            const fromHash = hashParams.get("tgWebAppData");
            if (fromHash && fromHash.trim().length > 0) return fromHash.trim();
          }
        } catch (e) {}
        try {
          const searchParams = new URLSearchParams(window.location.search || "");
          const fromSearch = searchParams.get("tgWebAppData");
          if (fromSearch && fromSearch.trim().length > 0) return fromSearch.trim();
        } catch (e) {}
        return "";
      }
      function extractClientTelegramLaunchToken() {
        try {
          const searchParams = new URLSearchParams(window.location.search || "");
          const fromSearch = searchParams.get("tgLaunch");
          if (fromSearch && fromSearch.trim().length > 0) return fromSearch.trim();
        } catch (e) {}
        try {
          const hashStr = String(window.location.hash || "").replace(/^#/, "");
          if (hashStr) {
            const hashParams = new URLSearchParams(hashStr);
            const fromHash = hashParams.get("tgLaunch");
            if (fromHash && fromHash.trim().length > 0) return fromHash.trim();
          }
        } catch (e) {}
        return "";
      }
      let rawInitData = extractClientTelegramInitData();
      let rawLaunchToken = extractClientTelegramLaunchToken();
      let sessionToken = "";
      try { sessionToken = localStorage.getItem("tma_session_token") || ""; } catch (e) {}
      let chatId = "guest";

      const GENRE_EMOJIS = ${JSON.stringify(GENRE_EMOJIS)};
      const MOVIE_GENRES_CLIENT = ${JSON.stringify(MOVIE_GENRES)};
      const SERIES_GENRES_CLIENT = ${JSON.stringify(SERIES_GENRES)};
      const PLATFORM_OPTIONS_CLIENT = ${JSON.stringify(PLATFORM_OPTIONS)};
      const STUDIO_OPTIONS_CLIENT = ${JSON.stringify(STUDIO_OPTIONS)};
      const ERA_OPTIONS_CLIENT = ${JSON.stringify(ERA_OPTIONS)};
      const FSK_OPTIONS_CLIENT = ${JSON.stringify(FSK_OPTIONS)};
      const FEATURED_COLLECTIONS_CLIENT = ${JSON.stringify(FEATURED_COLLECTIONS)};
      const CINEMATIC_UNIVERSES_CLIENT = ${JSON.stringify(CINEMATIC_UNIVERSES)};

      function genreEmoji(name) {
        return GENRE_EMOJIS[name] || "🎞️";
      }

      function normalizeCompareString(str) {
        return String(str || "")
          .toLowerCase()
          .replace(/ä/g, "ae")
          .replace(/ö/g, "oe")
          .replace(/ü/g, "ue")
          .replace(/ß/g, "ss")
          .replace(/&/g, " and ")
          .replace(/[^a-z0-9\\s]/g, " ")
          .replace(/\\s+/g, " ")
          .trim();
      }
      window.normalizeCompareString = normalizeCompareString;

      function openInBot(startPayload) {
        const botName = (state && state.botUsername) ? state.botUsername : "";
        const cleanPayload = String(startPayload || "").trim();
        const url = botName
          ? ("https://t.me/" + botName + (cleanPayload ? ("?start=" + encodeURIComponent(cleanPayload)) : ""))
          : ("https://t.me/");
        if (tg && typeof tg.openTelegramLink === "function" && botName) {
          try { tg.openTelegramLink(url); return; } catch (e) {}
        }
        window.open(url, "_blank");
      }

      function openCurrentViewInBot() {
        const modalEl = document.getElementById("modalRoot");
        if (modalEl && modalEl.innerHTML.trim() && state.activeDetails && state.activeDetails.id) {
          const tc = state.activeDetails.typeCode || state.type || "m";
          openInBot(tc + "_" + state.activeDetails.id);
          return;
        }
        if (state.currentView === "person" && state.currentPersonId) {
          openInBot("pcr_" + state.currentPersonId + "_1");
          return;
        }
        if (state.currentView === "collection" && state.currentCollectionId) {
          openInBot("bcol_" + state.currentCollectionId);
          return;
        }
        if (state.currentView === "universe" && state.currentUniverseId) {
          openInBot("buni_" + state.currentUniverseId);
          return;
        }
        if (state.currentView === "franchises") {
          openInBot(state.franchiseTab === "universes" ? "discover_universes" : "discover_collections");
          return;
        }
        if (state.currentView === "wishlist") {
          if (state.wlFolder && state.wlFolder !== "root") {
            openInBot("wlo_" + state.wlFolder);
          } else {
            openInBot("wishlist");
          }
          return;
        }
        if (state.currentView === "settings") {
          openInBot("settings");
          return;
        }
        if (state.currentView === "admin") {
          openInBot("admin");
          return;
        }
        if (state.isSearchMode && state.searchQuery) {
          openInBot("search_" + state.searchQuery.slice(0, 36));
          return;
        }
        openInBot(state.type === "s" ? "discover_series" : "discover_movies");
      }

      function shareItemFromTma(typeCode, id) {
        const d = state.activeDetails;
        const botName = state.botUsername || "";
        const inlineQuery = "share_" + typeCode + "_" + id;
        if (tg && typeof tg.switchInlineQuery === "function") {
          try { tg.switchInlineQuery(inlineQuery, ["users", "groups", "channels"]); return; } catch (e) {}
        }
        const shareTargetUrl = (d && d.shareData && d.shareData.targetTitleUrl)
          ? d.shareData.targetTitleUrl
          : (botName ? ("https://t.me/" + botName + "?start=" + typeCode + "_" + id) : window.location.href);
        const sharePlain = (d && d.shareData && d.shareData.plainShareText)
          ? d.shareData.plainShareText
          : ("🎬 " + (d?.title || "Empfehlung") + " – Im Film & Serien Bot öffnen!");
        const tgShareUrl = "https://t.me/share/url?url=" + encodeURIComponent(shareTargetUrl) + "&text=" + encodeURIComponent(sharePlain);
        if (tg && typeof tg.openTelegramLink === "function") {
          try { tg.openTelegramLink(tgShareUrl); return; } catch (e) {}
        }
        window.open(tgShareUrl, "_blank");
      }

      async function sendSharePostToBotChat(typeCode, id) {
        setBusyState(true, "📤 Sende einheitlichen Teilen-Post in deinen Bot-Chat...");
        try {
          const r = await apiFetchJson(API_BASE + "/share-in-bot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ typeCode, id })
          });
          if (r && r.ok) {
            showHudToast("✅ Einheitlicher Teilen-Post in deinen Bot-Chat gesendet!");
          } else {
            openInBot("sh_" + typeCode + "_" + id);
          }
        } catch (e) {
          openInBot("sh_" + typeCode + "_" + id);
        } finally {
          setBusyState(false);
        }
      }

      function shareCollectionOrUniverseFromTma(kind, id, titleText) {
        const botName = state.botUsername || "";
        const inlineQuery = kind === "col" ? ("share_col_" + id) : ("share_uni_" + id);
        if (tg && typeof tg.switchInlineQuery === "function") {
          try { tg.switchInlineQuery(inlineQuery, ["users", "groups", "channels"]); return; } catch (e) {}
        }
        const deepParam = kind === "col" ? ("bcol_" + id) : ("buni_" + id);
        const targetUrl = botName ? ("https://t.me/" + botName + "?start=" + deepParam) : window.location.href;
        const text = (kind === "col" ? "🍿 Filmreihe: " : "🌌 Filmuniversum: ") + (titleText || id) + "\\n👉 Im Film & Serien Bot öffnen: " + targetUrl;
        const shareUrl = "https://t.me/share/url?url=" + encodeURIComponent(targetUrl) + "&text=" + encodeURIComponent(text);
        if (tg && typeof tg.openTelegramLink === "function") {
          try { tg.openTelegramLink(shareUrl); return; } catch (e) {}
        }
        window.open(shareUrl, "_blank");
      }

      function shareCollectionOrUniverseFromBtn(btn) {
        if (!btn) return;
        const kind = btn.getAttribute("data-kind") || "col";
        const id = btn.getAttribute("data-id") || "";
        const title = btn.getAttribute("data-title") || "";
        shareCollectionOrUniverseFromTma(kind, id, title);
      }

      function updateSyncBadge() {
        const b = document.getElementById("syncBadge");
        const admBtn = document.getElementById("adminHeaderBtn");
        if (b) {
          b.style.color = "";
          b.style.borderColor = "";
          if (state && state.isAuthenticated && state.authUser) {
            const u = state.authUser;
            const label = u.customUsername || (u.tgUsername ? "@" + u.tgUsername : ("ID " + u.telegramId));
            const vipTag = u.isVip ? " 🌟VIP" : "";
            const admTag = u.isAdmin ? " 👑" : "";
            b.className = "btn sidebar-account-btn is-auth";
            b.innerHTML = '<span>🟢 ' + esc(label + vipTag + admTag) + '</span><span class="sidebar-account-cta">🔐 Konto öffnen ▸</span>';
            if (admBtn) admBtn.style.display = u.isAdmin ? "inline-flex" : "none";
          } else {
            b.className = "btn sidebar-account-btn is-guest";
            b.innerHTML = '<span>👤 Gast • Login</span><span class="sidebar-account-cta">🔐 Konto öffnen ▸</span>';
            if (admBtn) admBtn.style.display = "none";
          }
        }
        if (state && state.sidebarOpen && typeof renderFilterSidebarContent === "function") {
          renderFilterSidebarContent(false);
        }
      }

      // =========================================================================
      // 1. GRÖSSEN-ANPASSUNG, DESIGN-THEMES (DARK/LIGHT/CYBERPUNK), FARBENBLIND-MODUS & SIDEBAR
      // =========================================================================
      const DEFAULT_UI_SCALE = { all: 100, text: 100, cover: 100, menu: 100 };
      let uiScale = (function() {
        try {
          const raw = localStorage.getItem("tma_ui_scale");
          if (raw) return { ...DEFAULT_UI_SCALE, ...JSON.parse(raw) };
        } catch (e) {}
        return { ...DEFAULT_UI_SCALE };
      })();

      let appTheme = (function() {
        try { return localStorage.getItem("tma_theme") || "dark"; } catch (e) { return "dark"; }
      })();
      let colorblindMode = (function() {
        try { return localStorage.getItem("tma_colorblind") === "1"; } catch (e) { return false; }
      })();
      let mouseHoverNavEnabled = (function() {
        try {
          const v = localStorage.getItem("tma_mouse_hover_nav");
          return v === null ? true : v === "1";
        } catch (e) { return true; }
      })();
      let modalHoldNavEnabled = (function() {
        try {
          const v = localStorage.getItem("tma_modal_hold_nav");
          return v === null ? true : v === "1";
        } catch (e) { return true; }
      })();
      let trailerPreviewEnabled = (function() {
        try {
          const v = localStorage.getItem("tma_trailer_preview_enabled");
          return v === null ? true : v === "1";
        } catch (e) { return true; }
      })();

      const TRAILER_PROVIDERS_CLIENT = [
        { id: "youtube", label: "▶️ YouTube", shortLabel: "YouTube" },
        { id: "piped", label: "🛡️ Piped", shortLabel: "Piped" },
        { id: "invidiousDe", label: "🇩🇪 Invidious DE", shortLabel: "Invidious DE" },
        { id: "invidious1", label: "🕵️ Invidious (yewtu.be)", shortLabel: "yewtu.be" },
        { id: "invidious2", label: "🔒 Nadeko", shortLabel: "Nadeko" }
      ];
      let trailerProvider = (function() {
        try { return localStorage.getItem("tma_trailer_provider") || "youtube"; } catch (e) { return "youtube"; }
      })();

      function getTrailerProviderLabel(provId) {
        const found = TRAILER_PROVIDERS_CLIENT.find(p => p.id === (provId || trailerProvider));
        return found ? found.shortLabel : "YouTube";
      }

      function setTrailerProvider(nextProvider, persistRemote = true) {
        const valid = TRAILER_PROVIDERS_CLIENT.some(p => p.id === nextProvider) ? nextProvider : "youtube";
        trailerProvider = valid;
        try { localStorage.setItem("tma_trailer_provider", trailerProvider); } catch (e) {}
        if (state && state.settings) state.settings.trailerProvider = trailerProvider;
        if (state && state.sidebarOpen) renderFilterSidebarContent();
        const found = TRAILER_PROVIDERS_CLIENT.find(p => p.id === trailerProvider);
        showHudToast("🎬 Standard-Trailer Quelle: " + (found ? found.label : "▶️ YouTube"));
        if (persistRemote) {
          fetch(API_BASE + "/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, action: "save_trailer_provider", trailerProvider })
          }).catch(() => {});
        }
      }

      // Empfohlene Telegram Mini-App Farbpaletten (Header, Body & Bottom-Bar)
      const TELEGRAM_THEME_PALETTES_CLIENT = {
        neon: {
          name: "🌌 Neon-Cinema (Empfohlen für @BotFather)",
          headerColor: "#0B1021",
          backgroundColor: "#070B19",
          bottomBarColor: "#090D1C",
          accentCyan: "#00F0FF",
          accentViolet: "#8B5CF6"
        },
        cyberpunk: {
          name: "⚡ Cyberpunk Neon",
          headerColor: "#0B1021",
          backgroundColor: "#070B19",
          bottomBarColor: "#090D1C",
          accentCyan: "#00F0FF",
          accentViolet: "#8B5CF6"
        },
        dark: {
          name: "🌙 Classic Dark Cinema",
          headerColor: "#0E0E16",
          backgroundColor: "#08080C",
          bottomBarColor: "#0C0C12",
          accentCyan: "#38BDF8",
          accentViolet: "#E50914"
        },
        light: {
          name: "☀️ Daylight Studio",
          headerColor: "#F1F5F9",
          backgroundColor: "#F8FAFC",
          bottomBarColor: "#E2E8F0",
          accentCyan: "#0284C7",
          accentViolet: "#6366F1"
        }
      };

      function syncTelegramWebAppColorsClient(themeKey = "", customColors = null) {
        const pal = customColors || TELEGRAM_THEME_PALETTES_CLIENT[themeKey || appTheme] || TELEGRAM_THEME_PALETTES_CLIENT.neon;
        try {
          const tgApp = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
          if (tgApp) {
            if (typeof tgApp.setHeaderColor === "function") tgApp.setHeaderColor(pal.headerColor);
            if (typeof tgApp.setBackgroundColor === "function") tgApp.setBackgroundColor(pal.backgroundColor);
            if (typeof tgApp.setBottomBarColor === "function") tgApp.setBottomBarColor(pal.bottomBarColor);
          }
          let metaTheme = document.querySelector('meta[name="theme-color"]');
          if (!metaTheme) {
            metaTheme = document.createElement("meta");
            metaTheme.name = "theme-color";
            document.head.appendChild(metaTheme);
          }
          metaTheme.content = pal.headerColor;
        } catch (e) {}
        return pal;
      }

      function dismissBootSplashscreen() {
        const el = document.getElementById("tmaBootSplashscreen");
        if (!el || el.classList.contains("splash-hidden")) return;
        el.classList.add("splash-hidden");
        setTimeout(() => {
          try { if (el && el.classList.contains("splash-hidden")) el.style.display = "none"; } catch (e) {}
        }, 420);
      }

      function previewBootSplashscreenClient() {
        const el = document.getElementById("tmaBootSplashscreen");
        if (!el) return;
        el.style.display = "flex";
        requestAnimationFrame(() => {
          el.classList.remove("splash-hidden");
        });
        setTimeout(() => {
          dismissBootSplashscreen();
        }, 1800);
      }
      setTimeout(dismissBootSplashscreen, 1500);

      function applyThemeAndAccessibilityToDom() {
        document.body.setAttribute("data-theme", appTheme || "dark");
        document.body.setAttribute("data-colorblind", colorblindMode ? "1" : "0");
        document.body.setAttribute("data-hover-nav", mouseHoverNavEnabled ? "1" : "0");
        syncTelegramWebAppColorsClient(appTheme || "dark");
      }
      applyThemeAndAccessibilityToDom();

      function setAppTheme(nextTheme) {
        appTheme = nextTheme || "dark";
        try { localStorage.setItem("tma_theme", appTheme); } catch (e) {}
        applyThemeAndAccessibilityToDom();
        if (state && state.sidebarOpen) renderFilterSidebarContent();
        const themeLabel = appTheme === "light" ? "☀️ Light Mode" : appTheme === "cyberpunk" ? "⚡ Cyberpunk / Neon-Cinema Mode" : "🌙 Dark Mode";
        showHudToast("🎨 Design & Telegram-Farben: " + themeLabel);
      }

      function toggleColorblindMode() {
        colorblindMode = !colorblindMode;
        try { localStorage.setItem("tma_colorblind", colorblindMode ? "1" : "0"); } catch (e) {}
        applyThemeAndAccessibilityToDom();
        if (state && state.sidebarOpen) renderFilterSidebarContent();
        const filterMount = document.getElementById("floatingFilterMount");
        if (filterMount) filterMount.innerHTML = buildFloatingFilterBarHtml();
        showHudToast(colorblindMode ? "👁️ Farbenblind-Modus aktiviert (Blau / Orange + Konturen)" : "👁️ Standard-Farbschema aktiviert");
      }

      function toggleMouseHoverNav() {
        mouseHoverNavEnabled = !mouseHoverNavEnabled;
        try { localStorage.setItem("tma_mouse_hover_nav", mouseHoverNavEnabled ? "1" : "0"); } catch (e) {}
        applyThemeAndAccessibilityToDom();
        if (state && state.sidebarOpen) {
          renderFilterSidebarContent(false);
          const sbBtn = document.getElementById("sidebarMouseHoverNavBtn");
          if (sbBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(sbBtn, false);
        }
        if (state && state.currentView === "settings") {
          const stBtn = document.getElementById("settingsMouseHoverNavBtn");
          if (stBtn) {
            stBtn.className = "btn " + (mouseHoverNavEnabled ? "blue" : "");
            stBtn.innerHTML = '<span>🖱️ Maus-Hover Navigation (Mauszeiger verschiebt Auswahl)</span><b>' + (mouseHoverNavEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>';
            if (!state.sidebarOpen && typeof jumpSpatialFocus === "function") jumpSpatialFocus(stBtn, false);
          }
        }
        showHudToast(mouseHoverNavEnabled ? "🖱️ Maus-Hover Navigation: AKTIVIERT" : "🖱️ Maus-Hover Navigation: DEAKTIVIERT");
      }

      function toggleModalHoldNav() {
        modalHoldNavEnabled = !modalHoldNavEnabled;
        try { localStorage.setItem("tma_modal_hold_nav", modalHoldNavEnabled ? "1" : "0"); } catch (e) {}
        if (state && state.sidebarOpen) {
          renderFilterSidebarContent(false);
          const sbBtn = document.getElementById("sidebarModalHoldNavBtn");
          if (sbBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(sbBtn, false);
        }
        if (state && state.currentView === "settings") {
          const stBtn = document.getElementById("settingsModalHoldNavBtn");
          if (stBtn) {
            stBtn.className = "btn " + (modalHoldNavEnabled ? "blue" : "");
            stBtn.innerHTML = '<span>⏩ Detailansicht: Pfeiltaste ⬅️/➡️ gedrückt halten (~450ms) für nächsten/vorherigen Titel</span><b>' + (modalHoldNavEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>';
            if (!state.sidebarOpen && typeof jumpSpatialFocus === "function") jumpSpatialFocus(stBtn, false);
          }
        }
        showHudToast(modalHoldNavEnabled ? "⏩ Pfeiltaste gedrückt halten (450ms) im Detail-Modal: AKTIV" : "⏩ Pfeiltaste gedrückt halten im Detail-Modal: AUS");
      }

      function toggleTrailerPreviewSettingClient() {
        trailerPreviewEnabled = !trailerPreviewEnabled;
        try { localStorage.setItem("tma_trailer_preview_enabled", trailerPreviewEnabled ? "1" : "0"); } catch (e) {}
        if (state && state.sidebarOpen) {
          renderFilterSidebarContent(false);
          const sbBtn = document.getElementById("sidebarTrailerPreviewBtn") || document.getElementById("sidebarTrailerPreviewQuickBtn");
          if (sbBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(sbBtn, false);
        }
        if (state && state.currentView === "settings") {
          const stBtn = document.getElementById("settingsTrailerPreviewBtn");
          if (stBtn) {
            stBtn.className = "btn " + (trailerPreviewEnabled ? "blue" : "");
            stBtn.innerHTML = '<span>🎥 Automatische Trailer-Vorschau auf der Detailbühne (Netflix-Modus)</span><b>' + (trailerPreviewEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>';
            if (!state.sidebarOpen && typeof jumpSpatialFocus === "function") jumpSpatialFocus(stBtn, false);
          }
        }
        const stageEl = document.getElementById("detailHeroStageEl");
        if (stageEl && state && state.activeDetails) {
          if (!trailerPreviewEnabled && !stageEl.classList.contains("is-trailer-foreground-mode")) {
            if (typeof stopDetailBackgroundVideoTeaserClient === "function") {
              stopDetailBackgroundVideoTeaserClient();
            }
          } else if (trailerPreviewEnabled && typeof scheduleDetailBackgroundVideoTeaserClient === "function") {
            scheduleDetailBackgroundVideoTeaserClient(state.activeDetails.trailers, false);
          }
        }
        showHudToast(trailerPreviewEnabled ? "🎥 Automatische Trailer-Vorschau: EIN (Netflix-Modus)" : "🎥 Automatische Trailer-Vorschau: AUS (Nur bei Klick auf Trailer)");
      }

      let hudToastTimer = null;
      function showHudToast(msg) {
        const el = document.getElementById("hudToast");
        if (!el) return;
        el.textContent = msg;
        el.title = "Antippen zum Ausblenden";
        el.onclick = () => {
          if (hudToastTimer) clearTimeout(hudToastTimer);
          el.style.display = "none";
        };
        el.style.display = "block";
        if (hudToastTimer) clearTimeout(hudToastTimer);
        hudToastTimer = setTimeout(() => { el.style.display = "none"; }, 2500);
      }

      // Nicht-blockierende Custom Dialoge (Ersatz für window.prompt & window.confirm im iFrame/Telegram WebApp)
      let activeCustomDialogResolver = null;
      let lastCustomDialogTriggerEl = null;
      function closeCustomDialog(resultValue) {
        const root = document.getElementById("customDialogRoot");
        if (root) root.innerHTML = "";
        if (activeCustomDialogResolver) {
          const fn = activeCustomDialogResolver;
          activeCustomDialogResolver = null;
          fn(resultValue);
        }
        if (lastCustomDialogTriggerEl && document.body.contains(lastCustomDialogTriggerEl) && typeof jumpSpatialFocus === "function") {
          const restoreEl = lastCustomDialogTriggerEl;
          lastCustomDialogTriggerEl = null;
          setTimeout(() => jumpSpatialFocus(restoreEl, false), 20);
        }
      }

      function showCustomConfirm(messageText, confirmLabel = "✅ Bestätigen") {
        return new Promise((resolve) => {
          activeCustomDialogResolver = resolve;
          const root = document.getElementById("customDialogRoot");
          if (!root) { resolve(true); return; }
          const curEl = (typeof currentSpatialEl !== "undefined" && currentSpatialEl) ? currentSpatialEl : document.activeElement;
          if (curEl && curEl !== document.body && !root.contains(curEl)) {
            lastCustomDialogTriggerEl = curEl;
          }
          const isDangerConfirm = /lösch|reset|leeren|entfern|trennen|deaktivier|abmeld/i.test(String(confirmLabel || "") + " " + String(messageText || ""));
          root.innerHTML = '<div class="modal-backdrop" style="z-index:1600;align-items:center" onclick="if(event.target===this)closeCustomDialog(false)">' +
            '<div class="modal" style="max-width:420px;padding:18px;border:1px solid rgba(255,255,255,0.2)">' +
              '<div style="font-size:15px;font-weight:800;margin-bottom:10px">🛡️ Bestätigung</div>' +
              '<div style="font-size:13px;color:var(--text-muted);line-height:1.5;margin-bottom:16px">' + esc(messageText) + '</div>' +
              '<div style="display:flex;justify-content:flex-end;gap:8px">' +
                '<button id="customConfirmCancelBtn" class="btn" onclick="closeCustomDialog(false)">Abbrechen</button>' +
                '<button id="customConfirmOkBtn" class="btn ' + (isDangerConfirm ? 'danger' : 'red') + '" onclick="closeCustomDialog(true)">' + esc(confirmLabel) + '</button>' +
              '</div>' +
            '</div>' +
          '</div>';
          setTimeout(() => {
            const okBtn = document.getElementById("customConfirmOkBtn");
            if (okBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(okBtn, false);
          }, 25);
        });
      }

      function showCustomPrompt(titleText, defaultValue = "") {
        return new Promise((resolve) => {
          activeCustomDialogResolver = resolve;
          const root = document.getElementById("customDialogRoot");
          if (!root) { resolve(defaultValue || null); return; }
          const curEl = (typeof currentSpatialEl !== "undefined" && currentSpatialEl) ? currentSpatialEl : document.activeElement;
          if (curEl && curEl !== document.body && !root.contains(curEl)) {
            lastCustomDialogTriggerEl = curEl;
          }
          root.innerHTML = '<div class="modal-backdrop" style="z-index:1600;align-items:center" onclick="if(event.target===this)closeCustomDialog(null)">' +
            '<div class="modal" style="max-width:440px;padding:18px;border:1px solid rgba(255,255,255,0.2)">' +
              '<div style="font-size:15px;font-weight:800;margin-bottom:10px">' + esc(titleText) + '</div>' +
              '<input id="customPromptInp" value="' + esc(defaultValue) + '" placeholder="Name eingeben..." onkeydown="if(event.key===\\'Enter\\')closeCustomDialog(this.value);if(event.key===\\'Escape\\')closeCustomDialog(null)" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:var(--bg-elevated);color:var(--text-main);font-size:13.5px;margin-bottom:14px" />' +
              '<div style="display:flex;justify-content:flex-end;gap:8px">' +
                '<button class="btn" onclick="closeCustomDialog(null)">Abbrechen</button>' +
                '<button class="btn green" onclick="closeCustomDialog(document.getElementById(\\'customPromptInp\\')?.value||\\'\\')">💾 Speichern</button>' +
              '</div>' +
            '</div>' +
          '</div>';
          setTimeout(() => {
            const inp = document.getElementById("customPromptInp");
            if (inp) { inp.focus(); inp.select(); }
          }, 40);
        });
      }

      let liveZoomBadgeTimer = null;
      function showLiveZoomBadgeClient(labelText) {
        const el = document.getElementById("liveZoomBadgeEl");
        if (!el) return;
        el.textContent = labelText || ("🔍 Zoom: " + Number(uiScale.all || 100) + "%");
        el.classList.add("visible");
        if (liveZoomBadgeTimer) clearTimeout(liveZoomBadgeTimer);
        liveZoomBadgeTimer = setTimeout(() => {
          el.classList.remove("visible");
        }, 1500);
      }

      function applyUiScaleToDom() {
        const root = document.documentElement;
        const w = window.innerWidth || 1024;
        // Auf 1080p-Laptop/PC (>= 900px) entspricht 100% Standardgröße direkt dem gewünschten 145%-Kino-Feeling!
        const desktopCinemaBoost = w >= 900 ? 1.42 : (w >= 700 ? 1.15 : 1.0);
        const sAll = Math.min(1.65, Math.max(0.65, Number(uiScale.all || 100) / 100));
        const sText = Math.min(1.65, Math.max(0.7, Number(uiScale.text || 100) / 100));
        const sCover = Math.min(1.85, Math.max(0.65, Number(uiScale.cover || 100) / 100));
        const sMenu = Math.min(1.55, Math.max(0.7, Number(uiScale.menu || 100) / 100));
        root.style.setProperty("--desktop-cinema-boost", desktopCinemaBoost.toFixed(3));
        root.style.setProperty("--scale-all", (sAll * desktopCinemaBoost).toFixed(3));
        root.style.setProperty("--scale-text", (sText * sAll * desktopCinemaBoost).toFixed(3));
        root.style.setProperty("--scale-cover", (sCover * sAll * desktopCinemaBoost).toFixed(3));
        root.style.setProperty("--scale-menu", (sMenu * sAll * Math.min(1.22, desktopCinemaBoost)).toFixed(3));
      }
      applyUiScaleToDom();

      // Automatische Geräteerkennung (User-Agent + Fire TV / Silk + Viewport)
      function detectClientDeviceAndAdapt() {
        const ua = String(navigator.userAgent || "").toLowerCase();
        const w = window.innerWidth || 1024;
        const maxTouch = Number(navigator.maxTouchPoints || 0);
        const isFireTv = /\\baft[a-z0-9]{1,5}\\b|fire\\s?tv/i.test(ua) || (/\\bsilk\\b/i.test(ua) && !/mobile/i.test(ua) && maxTouch === 0 && w >= 900);
        const isSmartTv = isFireTv || /android.*tv|smart-tv|smarttv|googletv|bravia|webos|tizen|crkey|playstation|xbox|nintendo/i.test(ua);
        let devType = "desktop";
        let devLabel = "💻 Desktop";
        if (isSmartTv) {
          devType = "tv";
          devLabel = isFireTv ? "📺 Fire TV" : "📺 Smart-TV / Controller";
        } else if (/ipad|tablet|playbook|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) {
          devType = "tablet";
          devLabel = "📟 Tablet";
        } else if (/iphone|ipod|android.*mobile|windows phone|mobile/i.test(ua) || w <= 640) {
          devType = "mobile";
          devLabel = "📱 Mobil";
        }
        document.body.setAttribute("data-device", devType);
        if (isFireTv) {
          document.body.setAttribute("data-tv-profile", "firetv");
        } else {
          document.body.removeAttribute("data-tv-profile");
        }
        const b = document.getElementById("deviceBadge");
        if (b) b.textContent = devLabel;
        applyUiScaleToDom();
      }
      detectClientDeviceAndAdapt();
      window.addEventListener("resize", detectClientDeviceAndAdapt);

      function setUiScaleValue(key, val, persistRemote = true) {
        const clamped = Math.min(160, Math.max(65, Number(val) || 100));
        uiScale[key] = clamped;
        try { localStorage.setItem("tma_ui_scale", JSON.stringify(uiScale)); } catch (e) {}
        applyUiScaleToDom();
        if (state && state.sidebarOpen) renderFilterSidebarContent(false);
        const labelPrefix = key === "all" ? "🔍 Zoom" : key === "text" ? "🔤 Textgröße" : key === "cover" ? "🖼️ Covergröße" : "🎛️ Menügröße";
        showLiveZoomBadgeClient(labelPrefix + ": " + clamped + "%");
        if (persistRemote) {
          fetch(API_BASE + "/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, action: "save_ui_scale", uiScale })
          }).catch(() => {});
        }
      }

      function adjustOverallScaleStep(delta) {
        const cur = Number(uiScale.all || 100);
        setUiScaleValue("all", cur + delta, true);
      }

      function resetUiScale() {
        uiScale = { ...DEFAULT_UI_SCALE };
        try { localStorage.setItem("tma_ui_scale", JSON.stringify(uiScale)); } catch (e) {}
        applyUiScaleToDom();
        if (state && state.sidebarOpen) renderFilterSidebarContent(false);
        showLiveZoomBadgeClient("🔍 Zoom: 100% (Standard)");
        fetch(API_BASE + "/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, action: "save_ui_scale", uiScale })
        }).catch(() => {});
      }

      function focusFirstSidebarFilterOption() {
        const subPanel = document.getElementById("sidebarRightSubPanel");
        if (subPanel && state.sidebarTab) {
          const firstSubBtn = subPanel.querySelector(".direct-filter-grid .df-btn.inc, .direct-filter-grid .df-btn, .scale-opts .btn, #sidebarThemeBtn_dark, .btn");
          if (firstSubBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstSubBtn, true);
            return;
          }
        }
        const body = document.getElementById("sidebarDrawerBody");
        if (!body) return;
        const firstCatTab = body.querySelector(".sidebar-menu-row");
        if (firstCatTab && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(firstCatTab, false);
        }
      }

      function closeSidebarSubPanelToMain() {
        const prevTab = state.sidebarTab;
        state.sidebarTab = null;
        state.sidebarDesignOpen = false;
        state.sidebarScaleOpen = false;
        renderFilterSidebarContent(false);
        if (prevTab) {
          const rowBtn = document.getElementById("sidebarCatTab_" + prevTab) || document.getElementById("sidebarSecBtn_" + prevTab);
          if (rowBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(rowBtn, true);
          }
        }
      }

      function toggleFilterSidebar(initialTab) {
        if (initialTab) {
          state.sidebarTab = initialTab;
          state.sidebarOpen = true;
        } else {
          state.sidebarOpen = !state.sidebarOpen;
          if (state.sidebarOpen) {
            state.sidebarTab = null;
          }
        }
        const drawer = document.getElementById("filterSidebarDrawer");
        const backdrop = document.getElementById("sidebarBackdrop");
        if (drawer) drawer.classList.toggle("open", Boolean(state.sidebarOpen));
        if (backdrop) backdrop.classList.toggle("open", Boolean(state.sidebarOpen));
        if (state.sidebarOpen) {
          if (typeof closeRightMenuOverlayClient === "function") {
            closeRightMenuOverlayClient(null, false);
          }
          renderFilterSidebarContent(Boolean(state.sidebarTab));
          if (!state.sidebarTab) {
            const firstCatTab = document.getElementById("sidebarCatTab_genres") || document.querySelector("#sidebarDrawerBody .sidebar-menu-row");
            if (firstCatTab && typeof jumpSpatialFocus === "function") {
              jumpSpatialFocus(firstCatTab, false);
            }
          }
        } else {
          state.sidebarTab = null;
          if (drawer) drawer.classList.remove("has-subpanel");
          if (typeof lastElevatorReturnEl !== "undefined" && lastElevatorReturnEl && document.body.contains(lastElevatorReturnEl) && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(lastElevatorReturnEl, false);
            lastElevatorReturnEl = null;
          } else if (typeof focusFirstResultCard === "function") {
            focusFirstResultCard(false);
          }
        }
      }

      function closeFilterSidebar() {
        state.sidebarOpen = false;
        state.sidebarTab = null;
        state.sidebarDesignOpen = false;
        state.sidebarScaleOpen = false;
        const drawer = document.getElementById("filterSidebarDrawer");
        const backdrop = document.getElementById("sidebarBackdrop");
        if (drawer) {
          drawer.classList.remove("open", "has-subpanel");
        }
        if (backdrop) backdrop.classList.remove("open");
        if (typeof lastElevatorReturnEl !== "undefined" && lastElevatorReturnEl && document.body.contains(lastElevatorReturnEl) && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(lastElevatorReturnEl, false);
          lastElevatorReturnEl = null;
        } else if (typeof focusFirstResultCard === "function") {
          focusFirstResultCard(false);
        }
      }

      function switchSidebarCategoryTab(tabName, jumpIntoRightPanel = true) {
        if (state.sidebarTab === tabName && !jumpIntoRightPanel) {
          closeSidebarSubPanelToMain();
          return;
        }
        state.sidebarTab = tabName;
        renderFilterSidebarContent(Boolean(jumpIntoRightPanel));
      }

      function toggleSidebarExtraSection(secName) {
        switchSidebarCategoryTab(secName, true);
      }

      function toggleTmaFullscreenClient() {
        try {
          const tgWebApp = window.Telegram && window.Telegram.WebApp;
          if (tgWebApp && typeof tgWebApp.requestFullscreen === "function") {
            if (tgWebApp.isFullscreen && typeof tgWebApp.exitFullscreen === "function") {
              tgWebApp.exitFullscreen();
              showHudToast("🗗 Telegram Vollbild-Modus beendet.");
            } else {
              tgWebApp.requestFullscreen();
              showHudToast("⛶ Telegram Bot API 8.0 Vollbild-Modus aktiviert!");
            }
            return;
          }
          if (tgWebApp && typeof tgWebApp.expand === "function") {
            tgWebApp.expand();
          }
          if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().then(() => {
              showHudToast("⛶ Vollbild-Modus aktiviert!");
            }).catch(() => {
              showHudToast("⛶ Mini-App auf maximale Höhe erweitert!");
            });
          } else if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
            showHudToast("🗗 Vollbild-Modus beendet.");
          } else {
            showHudToast("⛶ Mini-App auf maximale Höhe erweitert!");
          }
        } catch (e) {
          showHudToast("⛶ Vollbild-Umschaltung ausgeführt.");
        }
      }

      function addTmaToHomeScreenClient() {
        try {
          const tgWebApp = window.Telegram && window.Telegram.WebApp;
          if (tgWebApp && typeof tgWebApp.addToHomeScreen === "function") {
            tgWebApp.addToHomeScreen();
            showHudToast("📲 Telegram Home-Screen-Verknüpfung angefragt!");
            return;
          }
        } catch (e) {}
        showHudToast("📲 Tipp: Öffne die Mini-App in Telegram (ab v11.4 / Bot API 8.0) oder nutze im Browser „Zum Startbildschirm hinzufügen“.");
      }

      function renderFilterSidebarContent(jumpToOptions = false) {
        const body = document.getElementById("sidebarDrawerBody");
        const subPanel = document.getElementById("sidebarRightSubPanel");
        const drawer = document.getElementById("filterSidebarDrawer");
        if (!body) return;
        const s = state.settings || {};
        const curTab = state.sidebarTab || null;

        const gCount = (s.includedGenres || []).length + (s.excludedGenres || []).length;
        const pCount = (s.includedPlatforms || []).length + (s.excludedPlatforms || []).length;
        const eCount = (s.includedEras || []).length + (s.excludedEras || []).length;
        const stCount = (s.includedStudios || []).length + (s.excludedStudios || []).length;
        const fCount = (s.includedFsk || []).length + (s.excludedFsk || []).length + (s.showUnreleased ? 1 : 0);

        const buildScaleRow = (label, key, presets) => {
          const cur = Number(uiScale[key] || 100);
          return '<div class="scale-row">' +
            '<span class="scale-label">' + label + ' <b style="color:var(--blue)">' + cur + '%</b></span>' +
            '<div class="scale-opts">' +
              '<button id="sbScale_' + key + '_dec" class="btn" onclick="setUiScaleValue(\\'' + key + '\\',' + (cur - 5) + ')">➖</button>' +
              presets.map(p => '<button id="sbScale_' + key + '_' + p.v + '" class="btn ' + (cur === p.v ? 'blue' : '') + '" onclick="setUiScaleValue(\\'' + key + '\\',' + p.v + ')">' + p.l + '</button>' ).join("") +
              '<button id="sbScale_' + key + '_inc" class="btn" onclick="setUiScaleValue(\\'' + key + '\\',' + (cur + 5) + ')">➕</button>' +
            '</div>' +
          '</div>';
        };

        const themeBadge = appTheme === "light" ? "☀️ Light" : appTheme === "cyberpunk" ? "⚡ Cyber" : "🌙 Dark";
        const scaleBadge = Number(uiScale.all || 100) + "%";
        const isAuth = Boolean(state && state.isAuthenticated && state.authUser);
        const u = (state && state.authUser) || {};
        const accLabel = isAuth
          ? ("🟢 " + (u.customUsername || (u.tgUsername ? "@" + u.tgUsername : ("ID " + u.telegramId))) + (u.isVip ? " 🌟VIP" : "") + (u.isAdmin ? " 👑" : ""))
          : "👤 Gast • Login";

        const prevFocusDfId = (!jumpToOptions && typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.getAttribute)
          ? currentSpatialEl.getAttribute("data-df-id")
          : null;
        const prevFocusElId = (!jumpToOptions && typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.id)
          ? currentSpatialEl.id
          : null;

        const totalCatFilters = gCount + pCount + eCount + stCount + fCount + (s.onlyVipStreams ? 1 : 0);

        // Linke Hauptspalte: Kompakter Konto-Kopfbereich -> Direkt darunter Katalog-Filter im Hauptfokus -> Ansicht -> Kompakte Werkzeuge unten
        body.innerHTML =
          /* 0. Konto & Schnell-Entdecken */
          '<div class="sidebar-section">' +
            '<div class="sidebar-nav-grid">' +
              '<button id="syncBadge" class="btn sidebar-account-btn ' + (isAuth ? 'is-auth' : 'is-guest') + '" style="grid-column:1 / -1;justify-content:space-between" onclick="closeFilterSidebar();openAccountModal()">' +
                '<span>' + esc(accLabel) + '</span><span class="sidebar-account-cta">🔐 Konto ▸</span>' +
              '</button>' +
              (u.isAdmin ? (
                '<button id="adminHeaderBtn" class="btn blue" style="grid-column:1 / -1;justify-content:center" onclick="closeFilterSidebar();loadAdminPanelView()">👑 Admin-Dashboard & VIP-Verwaltung</button>'
              ) : '') +
              '<button id="sidebarRandomBtn" class="btn" onclick="closeFilterSidebar();triggerRandom()" title="Zufälligen Titel mit aktiven Filtern ziehen">' +
                (state.type === 's' ? '🎲 Zufalls-Serie' : '🎲 Zufalls-Film') +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();loadFranchisesHub()" title="Alle Filmreihen & Filmuniversen öffnen">' +
                '🌌 Welten & Reihen' +
              '</button>' +
            '</div>' +
          '</div>' +

          /* 1. Katalog-Filter direkt im oberen Hauptblickfeld (Rechts öffnen sich die Optionen nach Auswahl) */
          '<div class="sidebar-section">' +
            '<div class="sidebar-section-title">' +
              '<span>🎛️ Katalog-Filter' + (totalCatFilters > 0 ? (' (' + totalCatFilters + ' aktiv)') : '') + '</span>' +
              '<span style="font-size:10px;color:var(--muted)">Optionen ▸</span>' +
            '</div>' +
            '<div class="sidebar-menu-stack">' +
              '<button type="button" id="sidebarCatTab_genres" data-sb-cat="genres" class="sidebar-menu-row ' + (curTab === 'genres' ? 'active' : '') + (gCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'genres\\',true)">' +
                '<span class="sidebar-menu-row-left">🎞️ Genres</span>' +
                '<span class="sidebar-menu-row-right">' + (gCount ? (gCount + ' aktiv ') : '') + '▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarCatTab_platforms" data-sb-cat="platforms" class="sidebar-menu-row ' + (curTab === 'platforms' ? 'active' : '') + (pCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'platforms\\',true)">' +
                '<span class="sidebar-menu-row-left">📺 Streaming-Anbieter</span>' +
                '<span class="sidebar-menu-row-right">' + (pCount ? (pCount + ' aktiv ') : '') + '▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarCatTab_eras" data-sb-cat="eras" class="sidebar-menu-row ' + (curTab === 'eras' ? 'active' : '') + (eCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'eras\\',true)">' +
                '<span class="sidebar-menu-row-left">📅 Epochen & Jahrzehnte</span>' +
                '<span class="sidebar-menu-row-right">' + (eCount ? (eCount + ' aktiv ') : '') + '▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarCatTab_studios" data-sb-cat="studios" class="sidebar-menu-row ' + (curTab === 'studios' ? 'active' : '') + (stCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'studios\\',true)">' +
                '<span class="sidebar-menu-row-left">🏢 Studios & Produktion</span>' +
                '<span class="sidebar-menu-row-right">' + (stCount ? (stCount + ' aktiv ') : '') + '▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarCatTab_fsk" data-sb-cat="fsk" class="sidebar-menu-row ' + (curTab === 'fsk' ? 'active' : '') + (fCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'fsk\\',true)">' +
                '<span class="sidebar-menu-row-left">🔞 Altersfreigabe (FSK)</span>' +
                '<span class="sidebar-menu-row-right">' + (fCount ? (fCount + ' aktiv ') : '') + '▸</span>' +
              '</button>' +
              (isCurrentUserVip() ? (
                '<button type="button" id="sidebarVipStreamsOnlyBtn" class="sidebar-menu-row ' + (s.onlyVipStreams ? 'active has-inc' : '') + '" onclick="setDirectFilter(\\'vip_streams\\',\\'\\',\\'toggle\\')">' +
                  '<span class="sidebar-menu-row-left">🌟 Nur mit verfügbarem Stream</span>' +
                  '<span class="sidebar-menu-row-right">' + (s.onlyVipStreams ? 'AKTIV ✓' : 'ALLE') + '</span>' +
                '</button>'
              ) : '') +
            '</div>' +
          '</div>' +

          /* 2. Darstellung & Skalierung ebenfalls einzeilig in der linken Übersicht */
          '<div class="sidebar-section">' +
            '<div class="sidebar-section-title">' +
              '<span>✨ Ansicht & Komfort</span>' +
            '</div>' +
            '<div class="sidebar-menu-stack">' +
              '<button type="button" id="sidebarSecBtn_design" data-sb-cat="design" class="sidebar-menu-row ' + (curTab === 'design' ? 'active' : '') + '" onclick="switchSidebarCategoryTab(\\'design\\',true)">' +
                '<span class="sidebar-menu-row-left">🎨 Darstellung & Komfort</span>' +
                '<span class="sidebar-menu-row-right">' + themeBadge + ' ▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarSecBtn_scale" data-sb-cat="scale" class="sidebar-menu-row ' + (curTab === 'scale' ? 'active' : '') + '" onclick="switchSidebarCategoryTab(\\'scale\\',true)">' +
                '<span class="sidebar-menu-row-left">🔠 Skalierung & Textgröße</span>' +
                '<span class="sidebar-menu-row-right">' + scaleBadge + ' ▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarTrailerPreviewQuickBtn" class="sidebar-menu-row ' + (trailerPreviewEnabled ? 'active has-inc' : '') + '" onclick="toggleTrailerPreviewSettingClient()" title="Automatische Trailer-Vorschau auf der Detailbühne ein- oder ausschalten">' +
                '<span class="sidebar-menu-row-left">🎥 Trailer-Vorschau</span>' +
                '<span class="sidebar-menu-row-right">' + (trailerPreviewEnabled ? 'EIN ✓' : 'AUS') + '</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          /* 3. Kompakte System- & App-Werkzeuge am unteren Rand */
          '<div class="sidebar-section">' +
            '<div class="sidebar-section-title">' +
              '<span>🛠️ App & Werkzeuge</span>' +
            '</div>' +
            '<div class="sidebar-nav-grid">' +
              '<button class="btn" onclick="closeFilterSidebar();loadSettingsView()" title="Alle Einstellungen öffnen">' +
                '⚙️ Einstellungen' +
              '</button>' +
              '<button id="sidebarOpenInBotBtn" class="btn" onclick="closeFilterSidebar();openCurrentViewInBot()" title="Aktuelle Ansicht im Telegram-Bot öffnen">' +
                '🤖 Im Bot öffnen' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();toggleTmaFullscreenClient()" title="Bot API 8.0 Vollbild-Modus ein-/ausschalten">' +
                '⛶ Vollbild' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();addTmaToHomeScreenClient()" title="Bot API 8.0 Mini-App Icon auf dem Smartphone-Startbildschirm ablegen">' +
                '📲 Home-Icon' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();goBack()" title="Zurück zur vorherigen Ansicht">' +
                '⬅️ Zurück' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();restartApp()" title="Alle aktiven Filter zurücksetzen & neu starten">' +
                '🔄 Neu starten' +
              '</button>' +
            '</div>' +
          '</div>';

        // Rechtes Optionen-Panel (#sidebarRightSubPanel) aufbauen, sobald eine Kategorie aktiv ist
        if (drawer) {
          drawer.classList.toggle("has-subpanel", Boolean(curTab));
        }
        if (subPanel) {
          if (!curTab) {
            subPanel.innerHTML = "";
          } else {
            let subTitle = "";
            let subContentHtml = "";
            let catActiveCount = 0;
            const isFilterCat = curTab === "genres" || curTab === "platforms" || curTab === "eras" || curTab === "studios" || curTab === "fsk";
            if (curTab === "genres") {
              subTitle = "🎞️ Genres wählen";
              catActiveCount = gCount;
              const allGenreNames = Array.from(new Set([
                ...Object.keys(state.genres || {}),
                "Action", "Abenteuer", "Animation", "Komödie", "Krimi", "Dokumentarfilm", "Drama", "Familie", "Fantasy", "Historie", "Horror", "Musik", "Mystery", "Liebesfilm", "Sci-Fi", "Thriller", "Kriegsfilm", "Western",
                ...(s.includedGenres || []),
                ...(s.excludedGenres || [])
              ]));
              subContentHtml = '<div class="direct-filter-grid">' +
                allGenreNames.map(gName => {
                  const isInc = (s.includedGenres || []).includes(gName);
                  const isExc = (s.excludedGenres || []).includes(gName);
                  return renderDirectFilterOptionCard("genre", gName, genreEmoji(gName) + " " + esc(gName), isInc, isExc);
                }).join("") +
              '</div>';
            } else if (curTab === "platforms") {
              subTitle = "📺 Streaming-Anbieter";
              catActiveCount = pCount;
              subContentHtml = '<div class="direct-filter-grid">' +
                PLATFORM_OPTIONS_CLIENT.map(pl => {
                  const isInc = (s.includedPlatforms || []).includes(pl.id);
                  const isExc = (s.excludedPlatforms || []).includes(pl.id);
                  return renderDirectFilterOptionCard("platform", pl.id, esc((pl.icon || "📺") + " " + pl.label), isInc, isExc);
                }).join("") +
              '</div>';
            } else if (curTab === "eras") {
              subTitle = "📅 Epochen & Jahrzehnte";
              catActiveCount = eCount;
              subContentHtml = '<div class="direct-filter-grid">' +
                ERA_OPTIONS_CLIENT.map(er => {
                  const isInc = (s.includedEras || []).includes(er.id);
                  const isExc = (s.excludedEras || []).includes(er.id);
                  return renderDirectFilterOptionCard("era", er.id, "📅 " + esc(er.label), isInc, isExc);
                }).join("") +
              '</div>';
            } else if (curTab === "studios") {
              subTitle = "🏢 Studios & Produktion";
              catActiveCount = stCount;
              subContentHtml = '<div class="direct-filter-grid">' +
                STUDIO_OPTIONS_CLIENT.map(st => {
                  const isInc = (s.includedStudios || []).includes(st.id);
                  const isExc = (s.excludedStudios || []).includes(st.id);
                  return renderDirectFilterOptionCard("studio", st.id, esc((st.icon || "🏢") + " " + st.label), isInc, isExc);
                }).join("") +
              '</div>';
            } else if (curTab === "fsk") {
              subTitle = "🔞 Altersfreigabe (FSK)";
              catActiveCount = fCount;
              subContentHtml = '<div class="direct-filter-grid">' +
                FSK_OPTIONS_CLIENT.map(f => {
                  const isInc = (s.includedFsk || []).includes(f);
                  const isExc = (s.excludedFsk || []).includes(f);
                  return renderDirectFilterOptionCard("fsk", f, "🔞 " + esc(f), isInc, isExc);
                }).join("") +
                renderDirectFilterOptionCard("unreleased", "unreleased", "🗓️ Unveröffentlicht", Boolean(s.showUnreleased), false) +
              '</div>';
            } else if (curTab === "design") {
              subTitle = "🎨 Darstellung & Komfort";
              subContentHtml =
                '<div id="sidebarDesignBody" style="display:flex;flex-direction:column;gap:7px">' +
                  '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(95px,1fr));gap:6px">' +
                    '<button id="sidebarThemeBtn_dark" class="btn ' + (appTheme === 'dark' ? 'blue' : '') + '" onclick="setAppTheme(\\'dark\\')">🌙 Dark</button>' +
                    '<button id="sidebarThemeBtn_light" class="btn ' + (appTheme === 'light' ? 'blue' : '') + '" onclick="setAppTheme(\\'light\\')">☀️ Light</button>' +
                    '<button id="sidebarThemeBtn_cyberpunk" class="btn ' + (appTheme === 'cyberpunk' ? 'blue' : '') + '" onclick="setAppTheme(\\'cyberpunk\\')">⚡ Cyber</button>' +
                  '</div>' +
                  '<button id="sidebarColorblindBtn" class="btn ' + (colorblindMode ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleColorblindMode()">' +
                    '<span>👁️ Farbenblind-Modus</span>' +
                    '<b>' + (colorblindMode ? 'EIN' : 'AUS') + '</b>' +
                  '</button>' +
                  '<button id="sidebarMouseHoverNavBtn" class="btn ' + (mouseHoverNavEnabled ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleMouseHoverNav()">' +
                    '<span>🖱️ Maus-Hover Fokus</span>' +
                    '<b>' + (mouseHoverNavEnabled ? 'EIN' : 'AUS') + '</b>' +
                  '</button>' +
                  '<button id="sidebarModalHoldNavBtn" class="btn ' + (modalHoldNavEnabled ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleModalHoldNav()">' +
                    '<span>⏩ Pfeil halten (450ms) = Nächster</span>' +
                    '<b>' + (modalHoldNavEnabled ? 'EIN' : 'AUS') + '</b>' +
                  '</button>' +
                  '<button id="sidebarHeroToggleBtn" class="btn ' + (!state.heroHidden ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleHeroSliderHidden()">' +
                    '<span>🎬 Spotlight-Banner</span>' +
                    '<b>' + (state.heroHidden ? 'AUS' : 'EIN') + '</b>' +
                  '</button>' +
                  '<button id="sidebarTrailerPreviewBtn" class="btn ' + (trailerPreviewEnabled ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleTrailerPreviewSettingClient()">' +
                    '<span>🎥 Trailer-Vorschau (Detailseite)</span>' +
                    '<b>' + (trailerPreviewEnabled ? 'EIN' : 'AUS') + '</b>' +
                  '</button>' +
                '</div>';
            } else if (curTab === "scale") {
              subTitle = "🔠 Skalierung & Textgröße";
              subContentHtml =
                '<div id="sidebarScaleBody" style="display:flex;flex-direction:column;gap:6px">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:4px">' +
                    '<span style="font-size:calc(10.5px * var(--scale-text));color:var(--muted)">Tastatur: <b>+</b> / <b>-</b> · Controller: <b>L2</b> / <b>R2</b> (<b>R3</b> = 100%)</span>' +
                    '<button id="sidebarScaleResetBtn" class="btn blue" style="padding:4px 10px" onclick="resetUiScale()">↺ 100% Standard</button>' +
                  '</div>' +
                  buildScaleRow("📐 Gesamt", "all", [{l:"85%",v:85},{l:"100%",v:100},{l:"115%",v:115},{l:"130%",v:130}]) +
                  buildScaleRow("🔤 Text", "text", [{l:"85%",v:85},{l:"100%",v:100},{l:"115%",v:115},{l:"130%",v:130}]) +
                  buildScaleRow("🖼️ Cover", "cover", [{l:"80%",v:80},{l:"100%",v:100},{l:"125%",v:125},{l:"150%",v:150}]) +
                  buildScaleRow("🎛️ Menü", "menu", [{l:"85%",v:85},{l:"100%",v:100},{l:"115%",v:115},{l:"125%",v:125}]) +
                '</div>';
            }

            subPanel.innerHTML =
              '<div class="sidebar-subpanel-top">' +
                '<div class="sidebar-subpanel-title">' + subTitle + '</div>' +
                '<div style="display:flex;gap:6px;align-items:center">' +
                  (isFilterCat && catActiveCount > 0
                    ? ('<button type="button" class="btn danger" style="padding:3px 8px;font-size:10.5px" onclick="resetSidebarCategoryFiltersQuickClient(\\'' + curTab + '\\')" title="Filter dieser Kategorie zurücksetzen">↺ Reset (' + catActiveCount + ')</button>')
                    : '') +
                  '<button type="button" id="sidebarSubBackBtn" class="btn" onclick="closeSidebarSubPanelToMain()" title="Zurück in die linke Menü-Übersicht (Pfeil links)">← Übersicht</button>' +
                '</div>' +
              '</div>' +
              '<div style="font-size:calc(10.5px * var(--scale-text));color:var(--muted);margin-bottom:4px">' +
                (isFilterCat
                  ? '✅ = Einschließen · 🚫 = Ausschließen · ◀ Pfeil links = Übersicht'
                  : '◀ Pfeil nach links führt direkt zurück in die Menü-Übersicht') +
              '</div>' +
              subContentHtml;
          }
        }

        const searchRoot = drawer || body;
        if (jumpToOptions) {
          focusFirstSidebarFilterOption();
        } else if (prevFocusDfId && typeof CSS !== "undefined" && CSS.escape) {
          const restoredEl = searchRoot.querySelector('[data-df-id="' + CSS.escape(prevFocusDfId) + '"]');
          if (restoredEl) setSpatialFocus(restoredEl, false);
        } else if (prevFocusElId) {
          const restoredById = document.getElementById(prevFocusElId);
          if (restoredById && searchRoot.contains(restoredById)) setSpatialFocus(restoredById, false);
        }
      }

      // =========================================================================
      // 2. LADEHINWEIS & ABORT-CONTROLLER FÜR BLITZSCHNELLERES FILTERN
      // =========================================================================
      let activeAbortController = null;
      function setBusyState(isBusy, messageText) {
        const bar = document.getElementById("busyOverlayBar");
        const txt = document.getElementById("busyOverlayText");
        const grid = document.getElementById("resultsGridContainer");
        if (txt && messageText) txt.textContent = messageText;
        if (bar) bar.classList.toggle("visible", Boolean(isBusy));
        if (grid) grid.classList.toggle("results-busy", Boolean(isBusy));
      }

      let activeBotCodePollTimer = null;
      let activeBotCodeChallenge = null;

      function stopBotCodePollClient() {
        if (activeBotCodePollTimer) {
          clearInterval(activeBotCodePollTimer);
          activeBotCodePollTimer = null;
        }
      }

      function switchLoginModalTabClient(tabName) {
        state.loginModalTab = tabName;
        openAccountModal();
      }

      async function onTelegramWidgetAuthClient(tgUser) {
        const fb = document.getElementById("loginModalFeedback");
        if (fb) {
          fb.style.color = "#38bdf8";
          fb.textContent = "⏳ Prüfe Telegram Login-Widget Signatur (HMAC-SHA256)...";
        }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/telegram-widget", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user: tgUser })
          });
          if (!r || !r.ok || !r.user) {
            if (fb) {
              fb.style.color = "#f87171";
              fb.textContent = "❌ " + (r?.error || "Telegram Widget Login fehlgeschlagen.");
            }
            return;
          }
          stopBotCodePollClient();
          sessionToken = r.sessionToken || "";
          try { localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
          state.isAuthenticated = true;
          state.authUser = r.user;
          chatId = String(r.user.telegramId);
          clearClientMediaCaches();
          updateSyncBadge();
          const m = document.getElementById("modalRoot");
          if (m) m.innerHTML = "";
          showHudToast("✅ Via Telegram Login-Widget als " + (r.user.tgUsername ? "@" + r.user.tgUsername : r.user.firstName || r.user.telegramId) + " angemeldet!");
          loadDiscover(state.type, state.genreId, state.mode, state.sort);
        } catch (err) {
          if (fb) {
            fb.style.color = "#f87171";
            fb.textContent = "❌ " + (err?.message || "Verbindungsfehler");
          }
        }
      }
      window.onTelegramWidgetAuthClient = onTelegramWidgetAuthClient;

      function mountTelegramLoginWidgetClient() {
        const container = document.getElementById("tgLoginWidgetContainer");
        if (!container) return;
        const botName = String(state.botUsername || window._lastAdminOverviewCache?.botSetup?.botUsername || "").replace(/^@/, "").trim();
        if (!botName || botName === "DeinBot") {
          container.innerHTML = '<div style="font-size:11.5px;color:#94a3b8;padding:6px 0">ℹ️ Sobald <code>BOT_USERNAME</code> / <code>TELEGRAM_BOT_TOKEN</code> gesetzt und bei @BotFather mit <code>/setdomain</code> verknüpft ist, erscheint hier automatisch der offizielle Telegram-Login-Button. Nutze alternativ direkt den <b>1-Klick Bot-Code</b> darunter oder den Test-Login:</div>';
          return;
        }
        container.innerHTML = "";
        const s = document.createElement("script");
        s.async = true;
        s.src = "https://telegram.org/js/telegram-widget.js?22";
        s.setAttribute("data-telegram-login", botName);
        s.setAttribute("data-size", "large");
        s.setAttribute("data-radius", "8");
        s.setAttribute("data-onauth", "onTelegramWidgetAuthClient(user)");
        s.setAttribute("data-request-access", "write");
        container.appendChild(s);
      }

      async function startBotCodeLoginChallengeClient() {
        stopBotCodePollClient();
        const box = document.getElementById("botCodeChallengeBox");
        if (box) {
          box.innerHTML = '<div style="font-size:12px;color:#38bdf8;padding:8px 0">⏳ Erzeuge sicheren 6-stelligen Einmal-Code & Bot-Deep-Link...</div>';
        }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/bot-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create" })
          });
          if (!r || !r.ok || !r.challengeId) {
            if (box) box.innerHTML = '<div style="font-size:12px;color:#f87171">❌ Konnte Login-Code nicht erstellen.</div>';
            return;
          }
          activeBotCodeChallenge = r;
          if (r.botUsername && !state.botUsername) state.botUsername = r.botUsername;
          const formattedCode = String(r.code || "").replace(/^(\\d{3})(\\d{3})$/, "$1 $2");
          if (box) {
            box.innerHTML =
              '<div style="background:rgba(7,11,25,0.92);border:1px solid rgba(0,240,255,0.4);border-radius:10px;padding:12px;margin-top:6px;display:flex;flex-direction:column;gap:8px;align-items:center;text-align:center">' +
                '<div style="font-size:11.5px;color:#94a3b8">Sende diesen 6-stelligen Code an den Telegram-Bot oder klicke auf <b>Direkt in Telegram bestätigen</b>:</div>' +
                '<div style="font-family:monospace;font-variant-numeric:tabular-nums;font-size:26px;font-weight:900;letter-spacing:4px;color:#00f0ff;background:rgba(0,240,255,0.08);border:1px solid rgba(0,240,255,0.3);padding:6px 18px;border-radius:8px;user-select:all">' +
                  esc(formattedCode) +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
                  (r.deepLink ? (
                    '<a href="' + esc(r.deepLink) + '" target="_blank" rel="noopener" class="btn blue" style="text-decoration:none;font-weight:800">' +
                      '🚀 1-Klick: Direkt in Telegram bestätigen' +
                    '</a>'
                  ) : '') +
                  '<button type="button" class="btn" onclick="simulateBotCodeConfirmClient(\\'' + esc(r.challengeId) + '\\')" title="Bestätigt den Code im lokalen Simulator / Vorschau-Modus">' +
                    '🧪 Im Simulator bestätigen' +
                  '</button>' +
                '</div>' +
                '<div id="botCodePollStatusText" style="font-size:11.5px;color:#fbbf24">⏳ Warte auf Bestätigung in Telegram (automatischer Abgleich alle 2s)...</div>' +
              '</div>';
          }
          activeBotCodePollTimer = setInterval(() => {
            pollBotCodeChallengeClient(r.challengeId);
          }, 2000);
        } catch (err) {
          if (box) box.innerHTML = '<div style="font-size:12px;color:#f87171">❌ ' + esc(err?.message || "Fehler") + '</div>';
        }
      }

      async function pollBotCodeChallengeClient(challengeId) {
        if (!challengeId) return;
        try {
          const r = await apiFetchJson(API_BASE + "/auth/bot-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "poll", challengeId })
          });
          if (!r || !r.ok) return;
          const stEl = document.getElementById("botCodePollStatusText");
          if (r.status === "expired") {
            stopBotCodePollClient();
            if (stEl) {
              stEl.style.color = "#f87171";
              stEl.textContent = "⌛ Code abgelaufen. Bitte neuen Code anfordern.";
            }
            return;
          }
          if (r.status === "confirmed" && r.user && r.sessionToken) {
            stopBotCodePollClient();
            sessionToken = r.sessionToken;
            try { localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
            state.isAuthenticated = true;
            state.authUser = r.user;
            chatId = String(r.user.telegramId);
            clearClientMediaCaches();
            updateSyncBadge();
            const m = document.getElementById("modalRoot");
            if (m) m.innerHTML = "";
            showHudToast("✅ Telegram Bot-Login erfolgreich bestätigt!");
            loadDiscover(state.type, state.genreId, state.mode, state.sort);
          }
        } catch (e) {}
      }

      async function simulateBotCodeConfirmClient(challengeId) {
        if (!challengeId) return;
        await apiFetchJson(API_BASE + "/auth/bot-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "simulate_confirm", challengeId })
        });
        await pollBotCodeChallengeClient(challengeId);
      }

      function toggleAccountSecurityDrawerClient() {
        state.accountSecurityOpen = !state.accountSecurityOpen;
        openAccountModal();
      }

      function openAccountModal() {
        const m = document.getElementById("modalRoot");
        if (!m) return;
        const isAuth = Boolean(state.isAuthenticated && state.authUser);
        const u = state.authUser || {};
        const canCreateOrUpdateAccount = Boolean(state.hasInitData || (isAuth && u.hasPasswordAccount));
        const activeTab = state.loginModalTab || "telegram";
        const isSecOpen = Boolean(state.accountSecurityOpen || !isAuth);

        let bodyHtml = "";
        if (isAuth) {
          stopBotCodePollClient();
          bodyHtml += '<div class="panel-box" style="border-color:rgba(16,185,129,0.35)">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
              '<div style="font-size:14px;font-weight:800;color:#34d399">✅ Angemeldet ' + (u.tgUsername ? ('als @' + esc(u.tgUsername)) : ('(ID: ' + esc(u.telegramId) + ')')) + '</div>' +
              '<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:' + (u.isVip ? 'rgba(251,191,36,0.18);color:#fbbf24;border:1px solid rgba(251,191,36,0.4)' : 'rgba(148,163,184,0.15);color:#cbd5e1') + '">' +
                (u.isVip ? '🌟 VIP Aktiv' : 'Standard-Konto') +
              '</span>' +
            '</div>' +
            '<div style="font-size:12px;color:#cbd5e1;line-height:1.65;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px;background:rgba(15,23,42,0.55);padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.06)">' +
              '<div>🆔 <b>Telegram-ID:</b> ' + esc(u.telegramId) + '</div>' +
              '<div>🔐 <b>Web-Login:</b> ' + (u.hasPasswordAccount ? ('<span style="color:#34d399"><b>' + esc(u.customUsername) + '</b></span>') : '<span style="color:#fbbf24">Noch kein Passwort</span>') + '</div>' +
              '<div>🛡️ <b>2FA-Schutz:</b> ' + (u.totpEnabled ? '<span style="color:#34d399;font-weight:800">🟢 Aktiv</span>' : '<span style="color:#94a3b8">⚪ Optional</span>') + '</div>' +
              (u.isAdmin ? '<div>👑 <b>Rolle:</b> <span style="color:#f87171;font-weight:800">Administrator</span></div>' : '') +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px">' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button type="button" class="btn ' + (isSecOpen ? 'active' : 'blue') + '" onclick="toggleAccountSecurityDrawerClient()">⚙️ Passwort & 2FA ' + (isSecOpen ? '▴' : '▾') + '</button>' +
                (u.isAdmin ? '<button class="btn amber" onclick="document.getElementById(\\'modalRoot\\').innerHTML=\\'\\';loadAdminPanelView()">👑 Admin-Panel</button>' : '') +
              '</div>' +
              '<button class="btn danger" onclick="logoutWebSession()">🚪 Abmelden</button>' +
            '</div>' +
          '</div>';
        } else {
          bodyHtml += '<div class="panel-box" style="border-color:rgba(56,189,248,0.4);background:linear-gradient(145deg,rgba(11,16,33,0.95),rgba(16,16,24,0.96))">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
              '<div style="font-size:13.5px;font-weight:800;color:#38bdf8">🔐 Anmeldung für Browser, PC & Smart-TV</div>' +
              '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                '<button type="button" class="btn ' + (activeTab === "telegram" ? "active" : "") + '" style="padding:4px 10px;font-size:11.5px" onclick="switchLoginModalTabClient(\\'telegram\\')">📲 Per Telegram-Bot / Code</button>' +
                '<button type="button" class="btn ' + (activeTab === "password" ? "active" : "") + '" style="padding:4px 10px;font-size:11.5px" onclick="switchLoginModalTabClient(\\'password\\')">🔑 Username & Passwort</button>' +
              '</div>' +
            '</div>' +
            (activeTab === "telegram" ? (
              '<div style="display:flex;flex-direction:column;gap:10px">' +
                '<div style="background:rgba(14,165,233,0.08);border:1px solid rgba(56,189,248,0.35);border-radius:10px;padding:11px">' +
                  '<div style="font-size:12.5px;font-weight:800;color:#38bdf8;margin-bottom:4px">📲 Schnell-Login per 6-stelligem Code oder 1-Klick im Bot (Empfohlen)</div>' +
                  '<div style="font-size:11.5px;color:#cbd5e1;line-height:1.45;margin-bottom:8px">' +
                    'Funktioniert sofort auf jedem Gerät (Smart-TV, PC & Smartphone) ohne Drittanbieter-Cookies:' +
                  '</div>' +
                  '<button type="button" class="btn blue" onclick="startBotCodeLoginChallengeClient()">📲 6-stelligen Login-Code & Bot-Link anfordern</button>' +
                  '<div id="botCodeChallengeBox"></div>' +
                '</div>' +
                '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(139,92,246,0.28);border-radius:10px;padding:10px">' +
                  '<div style="font-size:12px;font-weight:800;color:#c4b5fd;margin-bottom:4px">🌐 Alternativ: Browser-Login über Telegram Widget</div>' +
                  '<div id="tgLoginWidgetContainer" style="min-height:34px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"></div>' +
                '</div>' +
                '<div id="loginModalFeedback" style="font-size:12px;color:#f87171"></div>' +
              '</div>'
            ) : (
              '<div style="display:flex;flex-direction:column;gap:8px">' +
                '<p style="font-size:12px;color:#cbd5e1;line-height:1.45;margin:0 0 4px 0">' +
                  'Melde dich mit deinem gespeicherten <b>Username & Passwort</b> an:' +
                '</p>' +
                '<input id="loginUsernameInp" class="tma-input" placeholder="Username" onkeydown="if(event.key===\\'Enter\\'){const p=document.getElementById(\\'loginPasswordInp\\');if(p&&!p.value)p.focus();else submitWebLogin();}" style="padding:8px 10px;font-size:13px" />' +
                '<div style="display:flex;gap:6px;align-items:center">' +
                  '<input id="loginPasswordInp" class="tma-input" type="password" placeholder="Passwort" onkeydown="if(event.key===\\'Enter\\')submitWebLogin()" style="flex:1;padding:8px 10px;font-size:13px" />' +
                  '<button type="button" class="btn" style="padding:8px 10px" onclick="togglePasswordVisibilityClient(\\'loginPasswordInp\\',this)" title="Passwort ein-/ausblenden">👁️</button>' +
                '</div>' +
                '<div id="login2faWrap" style="display:none;flex-direction:column;gap:6px;padding:8px;border-radius:6px;background:rgba(91,70,245,0.14);border:1px solid rgba(91,70,245,0.4)">' +
                  '<div style="font-size:11.5px;font-weight:700;color:#c4b5fd">🛡️ 2FA-Schutz aktiv: Bitte 6-stelligen Authenticator-Code eingeben</div>' +
                  '<input id="loginTotpInp" class="tma-input" placeholder="6-stelliger 2FA-Code (z. B. 123456)" maxlength="6" inputmode="numeric" onkeydown="if(event.key===\\'Enter\\')submitWebLogin()" style="padding:8px 10px;border-color:rgba(167,139,250,0.5);font-size:14px;letter-spacing:3px;font-weight:800;text-align:center" />' +
                '</div>' +
                '<button class="btn green" onclick="submitWebLogin()">🔑 Einloggen</button>' +
                '<div id="loginModalFeedback" style="font-size:12px;color:#f87171"></div>' +
              '</div>'
            )) +
          '</div>';
        }

        if ((canCreateOrUpdateAccount || isAuth) && isSecOpen) {
          bodyHtml += '<div class="panel-box">' +
            '<div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:6px">🔐 ' + (u.hasPasswordAccount ? 'Username & Passwort ändern' : 'Web-Zugang (Username & Passwort) einrichten') + '</div>' +
            '<p style="font-size:11.5px;color:var(--muted);margin-bottom:10px">Ermöglicht den bequemen Login im Browser und auf dem Smart-TV auch ohne Telegram auf dem Zweitgerät.</p>' +
            '<div style="display:flex;flex-direction:column;gap:8px">' +
              '<input id="setAccUsernameInp" class="tma-input" value="' + esc(u.customUsername || u.tgUsername || '') + '" placeholder="Gewünschter Username (3–32 Zeichen)" onkeydown="if(event.key===\\'Enter\\'){const p=document.getElementById(\\'setAccPasswordInp\\');if(p&&!p.value)p.focus();else submitSaveAccountCredentials();}" style="padding:8px 10px;font-size:13px" />' +
              '<div style="display:flex;gap:6px;align-items:center">' +
                '<input id="setAccPasswordInp" class="tma-input" type="password" placeholder="Neues sicheres Passwort (mind. 6 Zeichen)" onkeydown="if(event.key===\\'Enter\\')submitSaveAccountCredentials()" style="flex:1;padding:8px 10px;font-size:13px" />' +
                '<button type="button" class="btn" style="padding:8px 10px" onclick="togglePasswordVisibilityClient(\\'setAccPasswordInp\\',this)" title="Passwort ein-/ausblenden">👁️</button>' +
              '</div>' +
              '<button class="btn purple" onclick="submitSaveAccountCredentials()">💾 Zugangsdaten speichern</button>' +
              '<div id="setAccFeedback" style="font-size:12px;color:#fbbf24"></div>' +
            '</div>' +
          '</div>';

          bodyHtml += '<div class="panel-box" style="border-color:rgba(91,70,245,0.35)">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
              '<div style="font-size:13px;font-weight:800;color:#c4b5fd">🛡️ Zwei-Faktor-Schutz (TOTP 2FA)</div>' +
              '<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:' + (u.totpEnabled ? 'rgba(16,185,129,0.2);color:#34d399' : 'rgba(148,163,184,0.16);color:var(--muted)') + '">' +
                (u.totpEnabled ? '🟢 2FA AKTIV' : '⚪ OPTIONAL') +
              '</span>' +
            '</div>' +
            '<p style="font-size:11.5px;color:var(--muted);margin-bottom:10px">Zusätzlicher Schutz per 6-stelligem Einmalcode (Google Authenticator, Authy, 1Password, Apple Passwörter).</p>' +
            (u.totpEnabled ? (
              '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                '<input id="disable2faCodeInp" class="tma-input" placeholder="6-stelliger 2FA-Code zur Bestätigung" maxlength="6" inputmode="numeric" onkeydown="if(event.key===\\'Enter\\')disable2faProtection()" style="padding:7px 10px;font-size:12.5px;width:230px" />' +
                '<button class="btn danger" onclick="disable2faProtection()">🔓 2FA deaktivieren</button>' +
              '</div>'
            ) : (
              '<div>' +
                '<button class="btn blue" onclick="start2faQrSetup()">📲 2FA mit QR-Code einrichten</button>' +
                '<div id="totpSetupMount" style="margin-top:10px"></div>' +
              '</div>'
            )) +
            '<div id="totpFeedback" style="font-size:12px;color:#fbbf24;margin-top:8px"></div>' +
          '</div>';
        }

        m.innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this){stopBotCodePollClient();this.parentElement.innerHTML=\\'\\';}"><div class="modal"><div class="modal-body" style="max-width:680px;margin:0 auto;width:100%">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h2 style="font-size:17px">👤 Konto & Anmeldung</h2><button class="btn close-slate" onclick="stopBotCodePollClient();document.getElementById(\\'modalRoot\\').innerHTML=\\'\\'">✖ Schließen</button></div>' +
          bodyHtml +
        '</div></div></div>';

        if (!isAuth && activeTab === "telegram") {
          setTimeout(mountTelegramLoginWidgetClient, 40);
        } else if (!isAuth && activeTab === "password") {
          setTimeout(() => {
            const uInp = document.getElementById("loginUsernameInp");
            if (uInp) uInp.focus();
          }, 40);
        }
      }

      function togglePasswordVisibilityClient(inputId, btnEl) {
        const inp = document.getElementById(inputId);
        if (!inp) return;
        const isPwd = inp.type === "password";
        inp.type = isPwd ? "text" : "password";
        if (btnEl) {
          btnEl.textContent = isPwd ? "🙈" : "👁️";
          btnEl.title = isPwd ? "Wieder verbergen" : "Passwort / Token anzeigen";
        }
      }

      async function start2faQrSetup() {
        const mount = document.getElementById("totpSetupMount");
        const fb = document.getElementById("totpFeedback");
        if (fb) { fb.style.color = "#fbbf24"; fb.textContent = "⏳ Generiere TOTP-Schlüssel & QR-Code..."; }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/2fa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "setup" })
          });
          if (!r || !r.ok) {
            if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + (r?.error || "2FA-Setup fehlgeschlagen."); }
            return;
          }
          if (fb) fb.textContent = "";
          if (mount) {
            const otpUriHtml = r.otpauthUrl
              ? ('<a href="' + esc(r.otpauthUrl) + '" class="btn blue" style="text-decoration:none">🔐 Direkt in Authenticator-App öffnen</a>')
              : '';
            mount.innerHTML = '<div class="admin-sub-box" style="padding:12px;display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center">' +
              '<div style="font-size:12px;color:var(--text);font-weight:700">1. Richte 2FA sicher lokal in deiner Authenticator-App (Google Authenticator, Authy, 1Password) ein:</div>' +
              otpUriHtml +
              '<div style="font-size:11px;color:var(--muted)">Manueller Setup-Schlüssel (Base32 – wird niemals an externe QR-Server gesendet):<br><code style="color:#fbbf24;font-size:12px;user-select:all;letter-spacing:1px">' + esc(r.secret) + '</code></div>' +
              '<div style="font-size:12px;color:var(--text);font-weight:700;margin-top:4px">2. Gib zur Aktivierung den 6-stelligen Code aus der App ein:</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
                '<input id="verifyTotpSetupInp" class="tma-input" placeholder="123456" maxlength="6" inputmode="numeric" onkeydown="if(event.key===\\'Enter\\')confirm2faSetupEnable()" style="padding:8px 12px;border-color:rgba(16,185,129,0.5);font-size:15px;letter-spacing:3px;font-weight:800;width:140px;text-align:center" />' +
                '<button class="btn green" onclick="confirm2faSetupEnable()">✅ Code prüfen & 2FA aktivieren</button>' +
              '</div>' +
            '</div>';
            setTimeout(() => {
              const vInp = document.getElementById("verifyTotpSetupInp");
              if (vInp) vInp.focus();
            }, 40);
          }
        } catch (err) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + err.message; }
        }
      }

      async function confirm2faSetupEnable() {
        const inp = document.getElementById("verifyTotpSetupInp");
        const fb = document.getElementById("totpFeedback");
        const code = (inp ? inp.value : "").trim();
        if (!/^\\d{6}$/.test(code)) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "⚠️ Bitte einen gültigen 6-stelligen Zahlencode eingeben."; }
          return;
        }
        if (fb) { fb.style.color = "#fbbf24"; fb.textContent = "⏳ Prüfe TOTP-Code..."; }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/2fa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "enable", code })
          });
          if (!r || !r.ok) {
            if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + (r?.error || "Ungültiger Code."); }
            return;
          }
          state.authUser = r.user;
          updateSyncBadge();
          openAccountModal();
        } catch (err) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + err.message; }
        }
      }

      async function disable2faProtection() {
        const inp = document.getElementById("disable2faCodeInp");
        const fb = document.getElementById("totpFeedback");
        const code = (inp ? inp.value : "").trim();
        if (fb) { fb.style.color = "#fbbf24"; fb.textContent = "⏳ Deaktiviere 2FA..."; }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/2fa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "disable", code })
          });
          if (!r || !r.ok) {
            if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + (r?.error || "Konnte 2FA nicht deaktivieren."); }
            return;
          }
          state.authUser = r.user;
          updateSyncBadge();
          openAccountModal();
        } catch (err) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + err.message; }
        }
      }

      async function submitWebLogin() {
        const uInp = document.getElementById("loginUsernameInp");
        const pInp = document.getElementById("loginPasswordInp");
        const tInp = document.getElementById("loginTotpInp");
        const tWrap = document.getElementById("login2faWrap");
        const fb = document.getElementById("loginModalFeedback");
        const username = (uInp ? uInp.value : "").trim();
        const password = pInp ? pInp.value : "";
        const totpCode = (tInp ? tInp.value : "").trim();
        if (!username || !password) {
          if (fb) fb.textContent = "⚠️ Bitte Username und Passwort eingeben.";
          return;
        }
        if (fb) { fb.style.color = "#fbbf24"; fb.textContent = "⏳ Prüfe Zugangsdaten..."; }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, totpCode })
          });
          if (r && r.requires2fa) {
            if (tWrap) tWrap.style.display = "flex";
            if (tInp) tInp.focus();
            if (fb) {
              fb.style.color = r.error ? "#f87171" : "#c4b5fd";
              fb.textContent = r.error ? ("❌ " + r.error) : "🛡️ Passwort korrekt! Bitte jetzt deinen 6-stelligen 2FA-Code eingeben.";
            }
            return;
          }
          if (!r || !r.ok) {
            if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + (r?.error || "Login fehlgeschlagen."); }
            return;
          }
          sessionToken = r.sessionToken || "";
          try { localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
          state.isAuthenticated = true;
          state.authUser = r.user;
          chatId = String(r.user.telegramId);
          clearClientMediaCaches();
          updateSyncBadge();
          document.getElementById("modalRoot").innerHTML = "";
          loadDiscover(state.type, state.genreId, state.mode, state.sort);
        } catch (err) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + err.message; }
        }
      }

      async function submitSaveAccountCredentials() {
        const uInp = document.getElementById("setAccUsernameInp");
        const pInp = document.getElementById("setAccPasswordInp");
        const fb = document.getElementById("setAccFeedback");
        const customUsername = (uInp ? uInp.value : "").trim();
        const password = pInp ? pInp.value : "";
        if (!customUsername || password.length < 6) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "⚠️ Username (mind. 3 Zeichen) und Passwort (mind. 6 Zeichen) erforderlich."; }
          return;
        }
        if (fb) { fb.style.color = "#fbbf24"; fb.textContent = "⏳ Verschlüssele Passwort (PBKDF2-SHA256) & sichere Account..."; }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/set-account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customUsername, password })
          });
          if (!r || !r.ok) {
            if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + (r?.error || "Speichern fehlgeschlagen."); }
            return;
          }
          if (r.sessionToken) {
            sessionToken = r.sessionToken;
            try { localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
          }
          state.authUser = r.user;
          updateSyncBadge();
          if (fb) { fb.style.color = "#34d399"; fb.textContent = "✅ Account erfolgreich abgesichert! Du kannst dich jetzt von überall (auch ohne Telegram initData) als „" + customUsername + "“ einloggen."; }
        } catch (err) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + err.message; }
        }
      }

      function logoutWebSession() {
        sessionToken = "";
        try { localStorage.removeItem("tma_session_token"); } catch (e) {}
        if (!rawInitData) {
          state.isAuthenticated = false;
          state.authUser = null;
          chatId = "guest";
        }
        clearClientMediaCaches();
        updateSyncBadge();
        document.getElementById("modalRoot").innerHTML = "";
        goHome();
      }

      function esc(str) {
        return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }

      let lastLightboxTriggerEl = null;
      function toggleLightboxZoomClient() {
        const im = document.getElementById("lbImg");
        const zBtn = document.getElementById("lbZoomToggleBtn");
        if (!im) return;
        const isZoomed = im.classList.toggle("zoomed");
        if (zBtn) zBtn.textContent = isZoomed ? "🔎 Verkleinern" : "🔍 Vergrößern";
      }

      function openLightbox(imgUrl, titleText) {
        if (!imgUrl) return;
        const lb = document.getElementById("lightboxRoot");
        if (!lb) return;
        const curEl = (typeof currentSpatialEl !== "undefined" && currentSpatialEl) ? currentSpatialEl : document.activeElement;
        if (curEl && curEl !== document.body && !lb.contains(curEl)) {
          lastLightboxTriggerEl = curEl;
        }
        lb.innerHTML = '<div class="lightbox-backdrop" onclick="if(event.target===this)closeLightbox()">' +
          '<div class="lightbox-toolbar">' +
            '<div style="font-size:13.5px;font-weight:800;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(titleText || 'Großansicht') + '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0">' +
              '<button type="button" id="lbZoomToggleBtn" class="btn" onclick="toggleLightboxZoomClient()">🔍 Vergrößern</button>' +
              '<a href="' + esc(imgUrl) + '" target="_blank" rel="noopener noreferrer" class="btn" style="text-decoration:none" title="Originalbild in voller Auflösung öffnen">🔗 Original ↗</a>' +
              '<button type="button" id="lbCloseBtn" class="btn close-slate" onclick="closeLightbox()">✖ Schließen</button>' +
            '</div>' +
          '</div>' +
          '<img id="lbImg" class="lightbox-img" src="' + esc(imgUrl) + '" onclick="toggleLightboxZoomClient()" alt="' + esc(titleText || 'Poster') + '" />' +
          '<div style="position:relative;z-index:5;font-size:11px;color:#94a3b8;margin-top:10px;background:rgba(7,12,26,0.75);padding:4px 12px;border-radius:999px">💡 Auf das Bild tippen zum Vergrößern / Verkleinern · ESC zum Schließen</div>' +
        '</div>';
        setTimeout(() => {
          const closeBtn = document.getElementById("lbCloseBtn");
          if (closeBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(closeBtn, false);
        }, 25);
      }
      function closeLightbox() {
        const lb = document.getElementById("lightboxRoot");
        if (lb) lb.innerHTML = "";
        if (lastLightboxTriggerEl && document.body.contains(lastLightboxTriggerEl) && typeof jumpSpatialFocus === "function") {
          const restoreEl = lastLightboxTriggerEl;
          lastLightboxTriggerEl = null;
          setTimeout(() => jumpSpatialFocus(restoreEl, false), 20);
        }
      }

      let filterClickSeq = 0;
      let sidebarFilterDebounceTimer = null;
      let liveSearchDebounceTimer = null;
      let heroTouchStartX = 0;
      let heroTouchStartY = 0;
      let heroTouchDraggingUp = false;
      let modalTouchStartX = 0;
      let lastModalTriggerKey = "";
      let lastModalTriggerEl = null;
      let lastModalHeroReturnId = "";

      // Clientseitiger Instant-Cache (5 Min TTL) für Detailansichten & Staffeln (#3)
      const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
      const clientDetailsCache = new Map();
      const clientSeasonCache = new Map();

      function clearClientMediaCaches() {
        clientDetailsCache.clear();
        clientSeasonCache.clear();
        if (window._clientApiGetCache instanceof Map) {
          window._clientApiGetCache.clear();
        }
        try {
          const keysToRemove = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith("tma_api_c_")) keysToRemove.push(k);
          }
          for (const k of keysToRemove) sessionStorage.removeItem(k);
        } catch (e) {}
      }

      // Prüft strikt, ob der aktuelle Nutzer VIP-Mitglied (oder Admin) ist:
      // Qualitäten & Streams werden ausschließlich VIP-Mitgliedern angezeigt!
      function isCurrentUserVip() {
        return Boolean(state && state.isAuthenticated && state.authUser && (state.authUser.isVip || state.authUser.isAdmin));
      }

      function saveModalReturnFocusTarget(typeCode, id) {
        const modalEl = document.getElementById("modalRoot");
        const modalAlreadyOpen = Boolean(modalEl && modalEl.innerHTML.trim());
        if (!modalAlreadyOpen) {
          lastModalTriggerKey = (typeCode && id) ? (typeCode + "_" + id) : "";
          lastModalTriggerEl = (typeof currentSpatialEl !== "undefined" && currentSpatialEl) ? currentSpatialEl : null;
          const activeEl = document.activeElement;
          const inHeroSlider = !heroCurtainScrolledToCatalog && !state.heroHidden && !state.isSearchMode && (!state.currentView || state.currentView === "discover");
          if (inHeroSlider) {
            if (
              (lastModalTriggerEl && lastModalTriggerEl.id === "heroBtnTrailer") ||
              (activeEl && activeEl.id === "heroBtnTrailer")
            ) {
              lastModalHeroReturnId = "heroBtnTrailer";
            } else {
              const curHero = Array.isArray(state.heroSlides) ? (state.heroSlides[state.heroIndex] || state.heroSlides[0]) : null;
              const curHeroType = curHero && (curHero.media_type === "tv" || state.type === "s") ? "s" : "m";
              const matchesHeroSlide = Boolean(curHero && String(curHero.id) === String(id) && curHeroType === typeCode);
              const triggeredFromHero = Boolean(
                (lastModalTriggerEl && lastModalTriggerEl.closest && lastModalTriggerEl.closest(".hero")) ||
                (activeEl && activeEl.closest && activeEl.closest(".hero")) ||
                matchesHeroSlide
              );
              lastModalHeroReturnId = triggeredFromHero ? "heroBtnDetails" : "";
            }
          } else {
            lastModalHeroReturnId = "";
          }
        } else if (typeCode && id) {
          lastModalTriggerKey = typeCode + "_" + id;
        }
      }

      function closeDetailModal() {
        const stageEl = document.getElementById("detailHeroStageEl");
        if (stageEl && stageEl.classList.contains("is-trailer-foreground-mode") && typeof exitDetailForegroundTrailerModeClient === "function") {
          exitDetailForegroundTrailerModeClient();
          return;
        }
        const heroStageEl = document.getElementById("heroStageEl");
        const m = document.getElementById("modalRoot");
        if ((!m || !m.innerHTML.trim()) && heroStageEl && heroStageEl.classList.contains("is-trailer-foreground-mode") && typeof exitHeroForegroundTrailerModeClient === "function") {
          exitHeroForegroundTrailerModeClient();
          return;
        }
        if (typeof stopDetailBackgroundVideoTeaserClient === "function") {
          stopDetailBackgroundVideoTeaserClient();
        }
        if (document.body) document.body.classList.remove("modal-open-pause-hero");
        if (m) m.innerHTML = "";
        if (typeof syncTelegramBackButtonClient === "function") {
          syncTelegramBackButtonClient();
        }
        if (typeof scheduleHeroBackgroundVideoTeaserClient === "function") {
          scheduleHeroBackgroundVideoTeaserClient(false);
        }
        if (lastModalHeroReturnId && !heroCurtainScrolledToCatalog && !state.heroHidden) {
          const heroReturnBtn = document.getElementById(lastModalHeroReturnId) || document.getElementById("heroBtnDetails");
          lastModalHeroReturnId = "";
          if (heroReturnBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(heroReturnBtn, false);
            return;
          }
        }
        if (lastModalTriggerEl && document.body.contains(lastModalTriggerEl) && lastModalTriggerEl.closest && lastModalTriggerEl.closest(".hero") && !heroCurtainScrolledToCatalog && !state.heroHidden) {
          const heroDetailsBtn = document.getElementById("heroBtnDetails") || lastModalTriggerEl;
          if (typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(heroDetailsBtn, false);
            return;
          }
        }
        if (lastModalTriggerKey) {
          const cardEl = document.querySelector('.card[data-card-key="' + lastModalTriggerKey + '"]');
          if (cardEl && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(cardEl, true);
            return;
          }
        }
        if (lastModalTriggerEl && document.body.contains(lastModalTriggerEl) && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(lastModalTriggerEl, true);
          return;
        }
        if (typeof focusFirstResultCard === "function") {
          focusFirstResultCard(false);
        }
      }

      let recentViewedList = (function() {
        try {
          const r = JSON.parse(localStorage.getItem("tma_recent_viewed") || "[]");
          return Array.isArray(r) ? r.slice(0, 40) : [];
        } catch (e) { return []; }
      })();
      let savedKeysSet = new Set();

      function addRecentViewedItem(d, typeCode) {
        if (!d || !d.id) return;
        let posterUrl = "";
        if (d.poster_path) {
          posterUrl = String(d.poster_path).startsWith("http")
            ? d.poster_path
            : ("https://image.tmdb.org/t/p/w185" + d.poster_path);
        } else if (d.poster) {
          posterUrl = d.poster;
        }
        const rawYear = String(d.year || d.releaseDate || d.release_date || d.first_air_date || "").slice(0, 4);
        const cleanYear = /^[0-9]{4}$/.test(rawYear) ? rawYear : "";
        const cleanRating = Number(d.vote_average || d.rating || 0);
        const cleanFsk = String(d.fsk || "").trim();
        const entry = {
          id: Number(d.id),
          tmdbId: Number(d.id),
          type: typeCode === "s" ? "s" : "m",
          contentType: typeCode === "s" ? "series" : "movie",
          title: String(d.title || d.name || "Titel").slice(0, 80),
          poster: posterUrl,
          year: cleanYear || "K. A.",
          rating: cleanRating > 0 ? cleanRating : 0,
          fsk: cleanFsk || "K. A.",
          addedAt: Date.now()
        };
        recentViewedList = [entry, ...recentViewedList.filter(x => !(x.id === entry.id && x.type === entry.type))].slice(0, 40);
        try { localStorage.setItem("tma_recent_viewed", JSON.stringify(recentViewedList)); } catch (e) {}
        refreshRecentViewedStripDom();
        syncRightMenuBadgesClient();
        if (state.rightMenuTab === "recent") {
          renderRightMenuSubPanelEntriesOnlyClient();
        }
      }

      function removeRecentViewedItem(ev, typeCode, id) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const tc = typeCode === "s" ? "s" : "m";
        const numId = Number(id);
        recentViewedList = recentViewedList.filter(x => !(x.type === tc && Number(x.id) === numId));
        try { localStorage.setItem("tma_recent_viewed", JSON.stringify(recentViewedList)); } catch (e) {}
        refreshRecentViewedStripDom();
        syncRightMenuBadgesClient();
        if (state.rightMenuTab === "recent") {
          renderRightMenuSubPanelContentClient(false);
        }
        showHudToast("🗑️ Aus „Zuletzt gesehen“ entfernt");
      }

      function clearAllRecentViewed() {
        recentViewedList = [];
        try { localStorage.removeItem("tma_recent_viewed"); } catch (e) {}
        refreshRecentViewedStripDom();
        syncRightMenuBadgesClient();
        if (state.rightMenuTab === "recent") {
          renderRightMenuSubPanelContentClient(false);
        }
        showHudToast("🗑️ Verlauf „Zuletzt gesehen“ geleert");
      }

      function syncRightMenuBadgesClient() {
        const wlBadge = document.getElementById("tvElevBadgeWishlist");
        const recBadge = document.getElementById("tvElevBadgeRecent");
        const wlCount = (Array.isArray(state.cachedWishlistItems) && state.cachedWishlistItems.length > 0)
          ? state.cachedWishlistItems.length
          : savedKeysSet.size;
        const recCount = Array.isArray(recentViewedList) ? recentViewedList.length : 0;
        if (wlBadge) {
          wlBadge.textContent = String(wlCount);
          wlBadge.style.display = wlCount > 0 ? "inline-flex" : "none";
        }
        if (recBadge) {
          recBadge.textContent = String(recCount);
          recBadge.style.display = recCount > 0 ? "inline-flex" : "none";
        }
        const wlBtn = document.getElementById("tvElevBtnWishlist");
        const recBtn = document.getElementById("tvElevBtnRecent");
        if (wlBtn) wlBtn.classList.toggle("active-tab", state.rightMenuTab === "wishlist");
        if (recBtn) recBtn.classList.toggle("active-tab", state.rightMenuTab === "recent");
      }

      function getRightMenuEraCatalogClient() {
        if (typeof ERA_OPTIONS_CLIENT !== "undefined" && Array.isArray(ERA_OPTIONS_CLIENT) && ERA_OPTIONS_CLIENT.length > 0) {
          return ERA_OPTIONS_CLIENT;
        }
        return [
          { id: "2020_plus", label: "2020+", min: 2020, max: 9999 },
          { id: "2010_2019", label: "2010 – 2019", min: 2010, max: 2019 },
          { id: "2000_2009", label: "2000 – 2009", min: 2000, max: 2009 },
          { id: "1990_1999", label: "1990 – 1999", min: 1990, max: 1999 },
          { id: "pre_1990", label: "Vor 1990", min: 0, max: 1989 }
        ];
      }

      function ensureRightMenuFilterStateClient() {
        if (!state.rmSort) state.rmSort = "added_desc";
        if (state.rmEra === undefined) state.rmEra = "";
        if (state.rmYear === undefined) state.rmYear = "";
        if (state.rmMinRating === undefined) state.rmMinRating = "";
        if (state.rmMaxRating === undefined) state.rmMaxRating = "";
        if (!state.rmFsk) state.rmFsk = "ALL";
        if (!state.rmLetter) state.rmLetter = "ALL";
        if (!state.rmType) state.rmType = "all";
        if (state.rmQuery === undefined) state.rmQuery = "";
      }

      function resetRightMenuFiltersClient() {
        state.rmSort = "added_desc";
        state.rmEra = "";
        state.rmYear = "";
        state.rmMinRating = "";
        state.rmMaxRating = "";
        state.rmFsk = "ALL";
        state.rmLetter = "ALL";
        state.rmType = "all";
        state.rmQuery = "";
        renderRightMenuSubPanelContentClient(false);
      }

      function normalizeItemFskNumberClient(rawFsk) {
        const s = String(rawFsk || "").trim();
        if (!s || s === "K. A.") return null;
        const m = s.match(/(?:^|[^0-9])(0|6|12|16|18)(?:$|[^0-9])/);
        return m ? m[1] : null;
      }

      function extractRightMenuItemYearClient(it) {
        const raw = String((it && (it.year || it.release_date || it.first_air_date || it.releaseDate)) || "");
        const m = raw.match(/(19[0-9]{2}|20[0-9]{2})/);
        return m ? Number(m[1]) : 0;
      }

      function getRightMenuFilteredAndSortedItemsClient(tabMode) {
        ensureRightMenuFilterStateClient();
        const isWishlist = tabMode === "wishlist";
        let rawList = [];
        if (isWishlist) {
          const allItems = Array.isArray(state.cachedWishlistItems) ? state.cachedWishlistItems : [];
          const folders = Array.isArray(state.cachedWishlistFolders) ? state.cachedWishlistFolders : [];
          const disabledFolderIds = new Set(folders.filter(f => f.enabled === false).map(f => f.id));
          rawList = allItems.filter(i => i && (!i.folderId || !disabledFolderIds.has(i.folderId)));
        } else {
          rawList = Array.isArray(recentViewedList) ? recentViewedList.slice() : [];
        }

        let list = rawList.map((it, idx) => {
          const isEp = it.contentType === "episode";
          const isSer = it.contentType === "series" || isEp || it.type === "s";
          const tc = isSer ? "s" : "m";
          const targetId = Number(isEp ? it.seriesId : (it.tmdbId || it.id)) || 0;
          const yearNum = extractRightMenuItemYearClient(it);
          const ratingNum = Number(it.rating || it.vote_average || 0);
          const fskCode = normalizeItemFskNumberClient(it.fsk);
          const addedTs = Number(it.addedAt || 0) || (rawList.length - idx);
          return {
            _raw: it,
            uid: it.uid || (tc + "_" + targetId),
            tc,
            targetId,
            title: String(it.title || "Titel"),
            poster: it.poster || "",
            yearNum,
            yearStr: yearNum > 0 ? String(yearNum) : "",
            ratingNum,
            fskCode,
            fskLabel: fskCode !== null ? ("FSK " + fskCode) : "",
            addedTs,
            epCount: Array.isArray(it.episodes) ? it.episodes.length : 0
          };
        });

        if (state.rmType === "m") {
          list = list.filter(x => x.tc === "m");
        } else if (state.rmType === "s") {
          list = list.filter(x => x.tc === "s");
        }

        const yrFilter = String(state.rmYear || "").replace(/[^0-9]/g, "").slice(0, 4);
        if (yrFilter) {
          if (yrFilter.length === 4) {
            const exactYr = Number(yrFilter);
            if (exactYr > 0) {
              list = list.filter(x => x.yearNum === exactYr);
            }
          } else {
            list = list.filter(x => x.yearStr && x.yearStr.startsWith(yrFilter));
          }
        } else if (state.rmEra) {
          const eraObj = getRightMenuEraCatalogClient().find(e => e.id === state.rmEra);
          if (eraObj) {
            list = list.filter(x => x.yearNum > 0 && x.yearNum >= eraObj.min && x.yearNum <= eraObj.max);
          }
        }

        const minR = state.rmMinRating !== "" && state.rmMinRating !== null ? Number(state.rmMinRating) : null;
        const maxR = state.rmMaxRating !== "" && state.rmMaxRating !== null ? Number(state.rmMaxRating) : null;
        if (minR !== null && !Number.isNaN(minR) && minR > 0) {
          list = list.filter(x => x.ratingNum >= minR);
        }
        if (maxR !== null && !Number.isNaN(maxR) && maxR < 10) {
          list = list.filter(x => x.ratingNum <= maxR);
        }

        if (state.rmFsk && state.rmFsk !== "ALL") {
          const wantedFsk = String(state.rmFsk).replace(/[^0-9]/g, "");
          list = list.filter(x => x.fskCode === wantedFsk);
        }

        const activeLetter = String(state.rmLetter || "ALL").toUpperCase();
        if (activeLetter && activeLetter !== "ALL") {
          list = list.filter(x => {
            const cleanTitle = x.title.trim().replace(/^[^a-zA-Z0-9äöüÄÖÜ]+/, "");
            const firstChar = (cleanTitle[0] || "").toUpperCase();
            if (activeLetter === "#") return !/^[A-ZÄÖÜ]$/.test(firstChar);
            if (activeLetter === "A" && firstChar === "Ä") return true;
            if (activeLetter === "O" && firstChar === "Ö") return true;
            if (activeLetter === "U" && firstChar === "Ü") return true;
            return firstChar === activeLetter;
          });
        }

        const q = String(state.rmQuery || "").trim().toLowerCase();
        if (q) {
          list = list.filter(x => x.title.toLowerCase().includes(q) || x.yearStr.includes(q));
        }

        const sortKey = state.rmSort || "added_desc";
        list.sort((a, b) => {
          if (sortKey === "added_asc") return a.addedTs - b.addedTs;
          if (sortKey === "added_desc") return b.addedTs - a.addedTs;
          if (sortKey === "rating_desc") return (b.ratingNum - a.ratingNum) || a.title.localeCompare(b.title, "de");
          if (sortKey === "rating_asc") return (a.ratingNum - b.ratingNum) || a.title.localeCompare(b.title, "de");
          if (sortKey === "year_desc") return (b.yearNum - a.yearNum) || a.title.localeCompare(b.title, "de");
          if (sortKey === "year_asc") return ((a.yearNum || 9999) - (b.yearNum || 9999)) || a.title.localeCompare(b.title, "de");
          if (sortKey === "title_asc") return a.title.localeCompare(b.title, "de");
          if (sortKey === "title_desc") return b.title.localeCompare(a.title, "de");
          return b.addedTs - a.addedTs;
        });

        return { items: list, totalRaw: rawList.length, rawList };
      }

      async function toggleRightMenuSubPanelClient(tabName, jumpFocusIntoPanel = false) {
        const elev = document.getElementById("tvQuickJumpElevator");
        if (!elev) return;
        elev.classList.remove("is-dismissed");
        if (state.rightMenuTab === tabName && elev.classList.contains("has-subpanel") && !jumpFocusIntoPanel) {
          closeRightMenuSubPanelClient();
          return;
        }
        state.rightMenuTab = tabName;
        ensureRightMenuFilterStateClient();
        elev.classList.add("has-subpanel", "is-visible", "is-hover-expanded");
        syncRightMenuBadgesClient();
        renderRightMenuSubPanelContentClient(jumpFocusIntoPanel);

        if (tabName === "wishlist" && state.isAuthenticated) {
          try {
            const r = await apiFetchJson(API_BASE + "/wishlist?chatId=" + encodeURIComponent(chatId));
            if (r && Array.isArray(r.items)) {
              state.cachedWishlistItems = r.items;
              state.cachedWishlistFolders = r.folders || [];
              savedKeysSet.clear();
              r.items.forEach(it => {
                if (it.contentType === "movie" && it.tmdbId) savedKeysSet.add("m_" + it.tmdbId);
                else if (it.contentType === "series" && it.tmdbId) savedKeysSet.add("s_" + it.tmdbId);
              });
              syncRightMenuBadgesClient();
              if (state.rightMenuTab === "wishlist") {
                renderRightMenuSubPanelContentClient(false);
              }
            }
          } catch (e) {}
        }
      }

      function closeRightMenuSubPanelClient(returnFocusToTabBtn = false) {
        const prevTab = state.rightMenuTab;
        state.rightMenuTab = null;
        const elev = document.getElementById("tvQuickJumpElevator");
        if (elev) {
          elev.classList.remove("has-subpanel");
        }
        syncRightMenuBadgesClient();
        if (returnFocusToTabBtn && prevTab) {
          const btnId = prevTab === "wishlist" ? "tvElevBtnWishlist" : "tvElevBtnRecent";
          const btn = document.getElementById(btnId);
          if (btn && typeof setSpatialFocus === "function") {
            setSpatialFocus(btn, false, "right");
          }
        }
      }

      const SIDE_MENU_HOVER_OPEN_DELAY_MS = 280;
      let leftEdgeHoverOpenTimer = null;
      let rightEdgeHoverOpenTimer = null;

      function canTriggerSideMenuEdgeHoverClient() {
        if (document.hidden || (typeof document.hasFocus === "function" && !document.hasFocus())) return false;
        if (document.body && document.body.classList.contains("in-hero-slider")) return false;
        if (document.getElementById("heroStageEl")?.classList.contains("is-trailer-foreground-mode")) return false;
        if (document.getElementById("detailHeroStageEl")?.classList.contains("is-trailer-foreground-mode")) return false;
        if (document.getElementById("modalRoot")?.innerHTML.trim()) return false;
        if (document.getElementById("customDialogRoot")?.innerHTML.trim()) return false;
        if (document.getElementById("lightboxRoot")?.innerHTML.trim()) return false;
        return true;
      }

      function cancelLeftEdgeHoverOpenClient() {
        if (leftEdgeHoverOpenTimer) {
          clearTimeout(leftEdgeHoverOpenTimer);
          leftEdgeHoverOpenTimer = null;
        }
      }

      function cancelRightEdgeHoverOpenClient() {
        if (rightEdgeHoverOpenTimer) {
          clearTimeout(rightEdgeHoverOpenTimer);
          rightEdgeHoverOpenTimer = null;
        }
      }

      function cancelSideMenuHoverTimersClient() {
        cancelLeftEdgeHoverOpenClient();
        cancelRightEdgeHoverOpenClient();
      }

      function scheduleLeftEdgeHoverOpenClient() {
        cancelLeftEdgeHoverOpenClient();
        if (state.sidebarOpen || !canTriggerSideMenuEdgeHoverClient()) return;
        leftEdgeHoverOpenTimer = setTimeout(() => {
          leftEdgeHoverOpenTimer = null;
          if (state.sidebarOpen || !canTriggerSideMenuEdgeHoverClient()) return;
          const edgeEl = document.getElementById("catalogEdgeTriggerLeft");
          if (edgeEl && !edgeEl.matches(":hover")) return;
          toggleFilterSidebar();
        }, SIDE_MENU_HOVER_OPEN_DELAY_MS);
      }

      function scheduleRightEdgeHoverOpenClient() {
        cancelRightEdgeHoverOpenClient();
        if (Date.now() < (window.__rmDismissedUntil || 0)) return;
        if (!canTriggerSideMenuEdgeHoverClient()) return;
        const elev = document.getElementById("tvQuickJumpElevator");
        if (elev && (elev.classList.contains("is-hover-expanded") || elev.classList.contains("has-subpanel"))) return;
        rightEdgeHoverOpenTimer = setTimeout(() => {
          rightEdgeHoverOpenTimer = null;
          if (Date.now() < (window.__rmDismissedUntil || 0)) return;
          if (!canTriggerSideMenuEdgeHoverClient()) return;
          const edgeEl = document.getElementById("catalogEdgeTriggerRight");
          if (edgeEl && !edgeEl.matches(":hover")) return;
          openRightMenuOverlayClient(false);
        }, SIDE_MENU_HOVER_OPEN_DELAY_MS);
      }

      if (typeof window !== "undefined" && !window._sideMenuHoverGuardsBound) {
        window._sideMenuHoverGuardsBound = true;
        window.addEventListener("blur", cancelSideMenuHoverTimersClient);
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) cancelSideMenuHoverTimersClient();
        });
        document.documentElement.addEventListener("mouseleave", cancelSideMenuHoverTimersClient);
      }

      function openRightMenuOverlayClient(forceImmediate = false) {
        cancelRightEdgeHoverOpenClient();
        if (!forceImmediate && Date.now() < (window.__rmDismissedUntil || 0)) return;
        if (document.body.classList.contains("in-hero-slider")) return;
        const elev = document.getElementById("tvQuickJumpElevator");
        if (!elev) return;
        if (state.sidebarOpen && typeof closeFilterSidebar === "function") {
          closeFilterSidebar();
        }
        window.__rmDismissedUntil = 0;
        elev.classList.remove("is-dismissed");
        elev.classList.add("is-visible", "is-hover-expanded");
        if (typeof syncRightMenuBadgesClient === "function") {
          syncRightMenuBadgesClient();
        }
      }

      function closeRightMenuOverlayClient(ev = null, suppressHoverUntilLeave = true) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        state.rightMenuTab = null;
        const elev = document.getElementById("tvQuickJumpElevator");
        if (elev) {
          elev.classList.remove("has-subpanel", "is-visible", "is-hover-expanded");
          if (suppressHoverUntilLeave) {
            window.__rmDismissedUntil = Date.now() + 650;
            elev.classList.add("is-dismissed");
            clearTimeout(window.__rmDismissFallbackTimer);
            window.__rmDismissFallbackTimer = setTimeout(() => {
              const curElev = document.getElementById("tvQuickJumpElevator");
              const edgeEl = document.getElementById("catalogEdgeTriggerRight");
              if (curElev && !curElev.matches(":hover") && !(edgeEl && edgeEl.matches(":hover"))) {
                curElev.classList.remove("is-dismissed");
              }
            }, 680);
          }
          if (document.activeElement && elev.contains(document.activeElement) && typeof document.activeElement.blur === "function") {
            try { document.activeElement.blur(); } catch (e) {}
          }
          elev.querySelectorAll(".spatial-focus").forEach(el => el.classList.remove("spatial-focus"));
          if (typeof currentSpatialEl !== "undefined" && currentSpatialEl && elev.contains(currentSpatialEl)) {
            currentSpatialEl = null;
          }
        }
        syncRightMenuBadgesClient();
      }

      function hasActiveRightMenuFiltersClient() {
        return Boolean(
          state.rmEra ||
          (state.rmYear && String(state.rmYear).trim()) ||
          state.rmMinRating !== "" ||
          state.rmMaxRating !== "" ||
          (state.rmFsk && state.rmFsk !== "ALL") ||
          (state.rmLetter && state.rmLetter !== "ALL") ||
          (state.rmType && state.rmType !== "all") ||
          (state.rmQuery && state.rmQuery.trim()) ||
          (state.rmSort && state.rmSort !== "added_desc")
        );
      }

      function syncRightMenuTimeFilterDomClient() {
        const eraSel = document.getElementById("rmEraSelect");
        const yrInp = document.getElementById("rmYearInput");
        const yrClr = document.getElementById("rmYearClearBtn");
        const resetBtn = document.getElementById("rmHeaderResetBtn");
        const hasManualYear = Boolean(state.rmYear && String(state.rmYear).trim().length > 0);
        const hasEra = Boolean(state.rmEra && !hasManualYear);
        if (eraSel) {
          if (eraSel.value !== (hasEra ? state.rmEra : "")) {
            eraSel.value = hasEra ? state.rmEra : "";
          }
          eraSel.classList.toggle("rm-ctrl-active", hasEra);
          eraSel.classList.toggle("rm-ctrl-superseded", hasManualYear);
          eraSel.title = hasManualYear
            ? "Epoche automatisch deaktiviert (manuelles Jahr aktiv) – Epoche wählen zum Umschalten"
            : "Epoche / Jahrzehnt auswählen (deaktiviert manuelles Jahr automatisch)";
        }
        if (yrInp) {
          yrInp.classList.toggle("rm-ctrl-active", hasManualYear);
          yrInp.classList.toggle("rm-ctrl-superseded", hasEra);
        }
        if (yrClr) {
          yrClr.style.display = hasManualYear ? "inline-flex" : "none";
        }
        if (resetBtn) {
          resetBtn.style.display = hasActiveRightMenuFiltersClient() ? "inline-flex" : "none";
        }
      }

      function clearRightMenuManualYearClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        state.rmYear = "";
        const yrInp = document.getElementById("rmYearInput");
        if (yrInp) yrInp.value = "";
        syncRightMenuTimeFilterDomClient();
        renderRightMenuSubPanelEntriesOnlyClient();
      }

      function setRightMenuFilterFieldClient(field, val, onlyRefreshEntries = false) {
        ensureRightMenuFilterStateClient();
        if (field === "rmEra") {
          state.rmEra = String(val || "");
          if (state.rmEra) {
            state.rmYear = "";
          }
          renderRightMenuSubPanelContentClient(false);
          return;
        }
        if (field === "rmYear") {
          const cleaned = String(val || "").replace(/[^0-9]/g, "").slice(0, 4);
          state.rmYear = cleaned;
          if (cleaned.length > 0 && state.rmEra) {
            state.rmEra = "";
          }
          const yrInp = document.getElementById("rmYearInput");
          if (yrInp && yrInp.value !== cleaned) {
            yrInp.value = cleaned;
          }
          syncRightMenuTimeFilterDomClient();
          renderRightMenuSubPanelEntriesOnlyClient();
          return;
        }
        state[field] = val;
        if (onlyRefreshEntries) {
          syncRightMenuTimeFilterDomClient();
          renderRightMenuSubPanelEntriesOnlyClient();
        } else {
          renderRightMenuSubPanelContentClient(false);
        }
      }

      async function deleteWishlistItemFromRightMenuClient(ev, uid) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (!uid) return;
        if (typeof deleteSavedUid === "function") {
          await deleteSavedUid(uid);
          syncRightMenuBadgesClient();
          if (state.rightMenuTab === "wishlist") {
            renderRightMenuSubPanelContentClient(false);
          }
        }
      }

      function openItemFromRightMenuClient(tc, id) {
        closeRightMenuOverlayClient(null, true);
        openDetails(tc, Number(id), false);
      }

      function buildRightMenuEntriesHtmlClient(items, tabMode) {
        if (!items.length) {
          return '<div style="padding:18px 12px;text-align:center;color:var(--text-muted);font-size:12px;background:rgba(15,23,42,0.38);border-radius:10px;border:1px dashed rgba(148,163,184,0.25)">' +
            (tabMode === "wishlist"
              ? (state.isAuthenticated ? 'Keine passenden Einträge in deiner Merkliste gefunden.' : '🔒 Bitte logge dich ein oder nutze die Mini-App in Telegram, um deine Merkliste zu nutzen.')
              : 'Keine passenden Einträge unter „Zuletzt gesehen“ gefunden.') +
          '</div>';
        }
        return items.map(it => {
          const thumbUrl = resolvePosterUrlClient(it.poster, "w185", "");
          const typeBadge = it.tc === "s" ? "📺 Serie" : "🎬 Film";
          const ratingBadge = it.ratingNum > 0 ? ('<span style="color:#fbbf24;font-weight:800">★ ' + it.ratingNum.toFixed(1) + '</span>') : '';
          const fskBadge = it.fskLabel ? ('<span style="padding:1px 5px;border-radius:4px;background:rgba(148,163,184,0.18);border:1px solid rgba(148,163,184,0.3);font-size:10px">' + esc(it.fskLabel) + '</span>') : '';
          const epBadge = it.epCount > 0 ? ('<span style="color:#38bdf8;font-size:10.5px;font-weight:700">• ' + it.epCount + ' Flg.</span>') : '';
          const delActionHtml = tabMode === "wishlist"
            ? ('<button type="button" class="btn danger" style="padding:4px 7px;font-size:11px" onclick="deleteWishlistItemFromRightMenuClient(event,\\'' + esc(it.uid) + '\\')" title="Aus Merkliste entfernen">🗑️</button>')
            : ('<button type="button" class="btn danger" style="padding:4px 7px;font-size:11px" onclick="removeRecentViewedItem(event,\\'' + esc(it.tc) + '\\',' + Number(it.targetId) + ')" title="Aus Verlauf entfernen">✕</button>');
          return '<div class="rm-entry-card" tabindex="0" onclick="openItemFromRightMenuClient(\\'' + esc(it.tc) + '\\',' + Number(it.targetId) + ')">' +
            '<div style="display:flex;align-items:center;gap:9px;min-width:0;flex:1">' +
              (thumbUrl
                ? '<img src="' + esc(thumbUrl) + '" alt="" loading="lazy" style="width:36px;height:52px;object-fit:cover;border-radius:6px;flex-shrink:0;background:#0f172a" />'
                : '<div style="width:36px;height:52px;border-radius:6px;background:rgba(30,41,59,0.8);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">' + (it.tc === "s" ? "📺" : "🎬") + '</div>') +
              '<div style="min-width:0;flex:1">' +
                '<div style="font-size:12.5px;font-weight:800;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.title) + '</div>' +
                '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:3px;font-size:11px;color:#94a3b8">' +
                  '<span>' + typeBadge + '</span>' +
                  (it.yearStr ? '<span>• ' + esc(it.yearStr) + '</span>' : '') +
                  ratingBadge +
                  fskBadge +
                  epBadge +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:5px;flex-shrink:0">' +
              '<button type="button" class="btn" style="padding:4px 7px;font-size:11px" onclick="event.stopPropagation();playInstantTrailerFromCard(event,\\'' + esc(it.tc) + '\\',' + Number(it.targetId) + ')" title="Trailer direkt abspielen">▶</button>' +
              delActionHtml +
            '</div>' +
          '</div>';
        }).join("");
      }

      function renderRightMenuSubPanelEntriesOnlyClient() {
        const tabMode = state.rightMenuTab || "wishlist";
        const { items, totalRaw } = getRightMenuFilteredAndSortedItemsClient(tabMode);
        const listEl = document.getElementById("rmEntriesScrollMount");
        const countEl = document.getElementById("rmHeaderCountBadge");
        if (listEl) {
          listEl.innerHTML = buildRightMenuEntriesHtmlClient(items, tabMode);
        }
        if (countEl) {
          countEl.textContent = items.length + " / " + totalRaw;
        }
      }

      function renderRightMenuSubPanelContentClient(jumpToFirstEntry = false) {
        const subPanel = document.getElementById("rightMenuSubPanel");
        if (!subPanel) return;
        const tabMode = state.rightMenuTab || "wishlist";
        const isWishlist = tabMode === "wishlist";
        const { items, totalRaw, rawList } = getRightMenuFilteredAndSortedItemsClient(tabMode);

        const rawYears = rawList.map(it => extractRightMenuItemYearClient(it)).filter(y => y > 0);
        const availableYears = Array.from(new Set(rawYears)).sort((a, b) => b - a);
        const eraCatalog = getRightMenuEraCatalogClient().slice().reverse();
        const eraIcons = {
          "2020_plus": "🚀",
          "2010_2019": "✨",
          "2000_2009": "📀",
          "1990_1999": "📼",
          "pre_1990": "🎞️"
        };
        const hasManualYear = Boolean(state.rmYear && String(state.rmYear).trim().length > 0);
        const hasActiveEra = Boolean(state.rmEra && !hasManualYear);
        const hasActiveFilter = hasActiveRightMenuFiltersClient();

        const azLetters = ["ALL", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "#"];
        const curLetter = String(state.rmLetter || "ALL").toUpperCase();

        subPanel.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-bottom:6px;border-bottom:1px solid rgba(56,189,248,0.22);flex-shrink:0">' +
            '<div style="display:flex;align-items:center;gap:7px">' +
              '<span style="font-size:14px;font-weight:900;color:#f8fafc">' + (isWishlist ? '💾 Merkliste' : '🕒 Zuletzt gesehen') + '</span>' +
              '<span id="rmHeaderCountBadge" class="tv-elev-count-badge">' + items.length + ' / ' + totalRaw + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">' +
              (isWishlist
                ? '<button type="button" class="btn blue" style="padding:3px 8px;font-size:11px" onclick="closeRightMenuOverlayClient(event,true);loadWishlist(\\'root\\')" title="Komplette Merkliste & Playlisten-Verwaltung im Hauptfenster öffnen">📂 Vollansicht</button>'
                : (totalRaw > 0 ? '<button type="button" class="btn danger" style="padding:3px 8px;font-size:11px" onclick="clearAllRecentViewed()" title="Gesamten Verlauf leeren">🗑️ Leeren</button>' : '')) +
              '<button type="button" id="rmHeaderResetBtn" class="btn danger" style="padding:3px 8px;font-size:11px;display:' + (hasActiveFilter ? 'inline-flex' : 'none') + '" onclick="resetRightMenuFiltersClient()" title="Alle Sortierungen & Filter zurücksetzen">↺ Reset</button>' +
              '<button type="button" class="btn close-slate" style="padding:3px 8px;font-size:11px" onclick="closeRightMenuSubPanelClient(true)" title="Panel schließen (Pfeil rechts)">Übersicht →</button>' +
            '</div>' +
          '</div>' +
          '<div class="rm-filter-panel">' +
            '<div class="rm-filter-row">' +
              '<select class="rm-ctrl-select" style="flex:1 1 175px" onchange="setRightMenuFilterFieldClient(\\'rmSort\\',this.value)" title="Sortierung wählen">' +
                '<option value="added_desc"' + (state.rmSort === "added_desc" ? " selected" : "") + '>🕒 Hinzugefügt: Neueste zuerst</option>' +
                '<option value="added_asc"' + (state.rmSort === "added_asc" ? " selected" : "") + '>🕰️ Hinzugefügt: Älteste zuerst</option>' +
                '<option value="rating_desc"' + (state.rmSort === "rating_desc" ? " selected" : "") + '>⭐ TMDb-Bewertung (Höchste)</option>' +
                '<option value="rating_asc"' + (state.rmSort === "rating_asc" ? " selected" : "") + '>⭐ TMDb-Bewertung (Niedrigste)</option>' +
                '<option value="year_desc"' + (state.rmSort === "year_desc" ? " selected" : "") + '>📅 Erscheinungsjahr (Neueste)</option>' +
                '<option value="year_asc"' + (state.rmSort === "year_asc" ? " selected" : "") + '>📅 Erscheinungsjahr (Älteste)</option>' +
                '<option value="title_asc"' + (state.rmSort === "title_asc" ? " selected" : "") + '>🔤 Alphabetisch (A–Z)</option>' +
                '<option value="title_desc"' + (state.rmSort === "title_desc" ? " selected" : "") + '>🔤 Alphabetisch (Z–A)</option>' +
              '</select>' +
              '<select class="rm-ctrl-select" onchange="setRightMenuFilterFieldClient(\\'rmType\\',this.value)" title="Nach Film oder Serie filtern">' +
                '<option value="all"' + (state.rmType === "all" ? " selected" : "") + '>🎞️ Alle Typen</option>' +
                '<option value="m"' + (state.rmType === "m" ? " selected" : "") + '>🎬 Filme</option>' +
                '<option value="s"' + (state.rmType === "s" ? " selected" : "") + '>📺 Serien</option>' +
              '</select>' +
              '<select class="rm-ctrl-select" onchange="setRightMenuFilterFieldClient(\\'rmFsk\\',this.value)" title="Nach FSK-Altersfreigabe filtern">' +
                '<option value="ALL"' + (state.rmFsk === "ALL" ? " selected" : "") + '>🔞 Alle FSK</option>' +
                '<option value="0"' + (state.rmFsk === "0" ? " selected" : "") + '>FSK 0</option>' +
                '<option value="6"' + (state.rmFsk === "6" ? " selected" : "") + '>FSK 6</option>' +
                '<option value="12"' + (state.rmFsk === "12" ? " selected" : "") + '>FSK 12</option>' +
                '<option value="16"' + (state.rmFsk === "16" ? " selected" : "") + '>FSK 16</option>' +
                '<option value="18"' + (state.rmFsk === "18" ? " selected" : "") + '>FSK 18</option>' +
              '</select>' +
            '</div>' +
            '<div class="rm-filter-row">' +
              '<div class="rm-time-filter-group">' +
                '<select id="rmEraSelect" class="rm-ctrl-select ' + (hasActiveEra ? 'rm-ctrl-active' : (hasManualYear ? 'rm-ctrl-superseded' : '')) + '" onchange="setRightMenuFilterFieldClient(\\'rmEra\\',this.value)" title="' + (hasManualYear ? 'Epoche automatisch deaktiviert (manuelles Jahr aktiv) – Epoche wählen zum Umschalten' : 'Epoche / Jahrzehnt auswählen (deaktiviert manuelles Jahr automatisch)') + '">' +
                  '<option value=""' + (!hasActiveEra ? " selected" : "") + '>📅 Epoche (Alle)</option>' +
                  eraCatalog.map(er => {
                    const cnt = rawYears.filter(y => y >= er.min && y <= er.max).length;
                    const ico = eraIcons[er.id] || "📅";
                    const suffix = cnt > 0 ? (" (" + cnt + ")") : "";
                    return '<option value="' + esc(er.id) + '"' + (hasActiveEra && state.rmEra === er.id ? ' selected' : '') + '>' + ico + ' ' + esc(er.label) + suffix + '</option>';
                  }).join("") +
                '</select>' +
                '<div class="rm-year-input-wrap">' +
                  '<input id="rmYearInput" type="text" inputmode="numeric" maxlength="4" list="rmAvailableYearsList" class="rm-ctrl-input ' + (hasManualYear ? 'rm-ctrl-active' : (hasActiveEra ? 'rm-ctrl-superseded' : '')) + '" style="width:82px;padding-right:22px" placeholder="od. Jahr..." value="' + esc(state.rmYear || "") + '" oninput="setRightMenuFilterFieldClient(\\'rmYear\\',this.value,true)" title="Exaktes Erscheinungsjahr eingeben (z. B. 2024 – deaktiviert Epoche automatisch)" />' +
                  '<button type="button" id="rmYearClearBtn" class="rm-year-clear-btn" style="display:' + (hasManualYear ? 'inline-flex' : 'none') + '" onclick="clearRightMenuManualYearClient(event)" title="Manuelles Jahr löschen" aria-label="Manuelles Jahr löschen">✕</button>' +
                '</div>' +
                '<datalist id="rmAvailableYearsList">' +
                  availableYears.map(y => '<option value="' + y + '"></option>').join("") +
                '</datalist>' +
              '</div>' +
              '<div style="display:inline-flex;align-items:center;gap:4px;background:rgba(8,13,26,0.55);padding:2px 6px;border-radius:7px;border:1px solid rgba(148,163,184,0.22)">' +
                '<span style="font-size:10.5px;color:#fbbf24;font-weight:800">★</span>' +
                '<input type="number" class="rm-ctrl-input" style="width:48px;padding:2px 4px;border:none;background:transparent" min="0" max="10" step="0.5" placeholder="Min" value="' + esc(state.rmMinRating !== undefined && state.rmMinRating !== null ? String(state.rmMinRating) : "") + '" oninput="setRightMenuFilterFieldClient(\\'rmMinRating\\',this.value,true)" title="Mindest-Bewertung (0.0 – 10.0)" />' +
                '<span style="font-size:10px;color:#64748b">–</span>' +
                '<input type="number" class="rm-ctrl-input" style="width:48px;padding:2px 4px;border:none;background:transparent" min="0" max="10" step="0.5" placeholder="Max" value="' + esc(state.rmMaxRating !== undefined && state.rmMaxRating !== null ? String(state.rmMaxRating) : "") + '" oninput="setRightMenuFilterFieldClient(\\'rmMaxRating\\',this.value,true)" title="Maximal-Bewertung (0.0 – 10.0)" />' +
              '</div>' +
              '<input type="text" class="rm-ctrl-input" style="flex:1 1 110px;min-width:95px" placeholder="🔍 Titel filtern..." value="' + esc(state.rmQuery || "") + '" oninput="setRightMenuFilterFieldClient(\\'rmQuery\\',this.value,true)" title="Einträge nach Titel durchsuchen" />' +
            '</div>' +
            '<div class="rm-az-strip">' +
              azLetters.map(ltr =>
                '<button type="button" class="rm-az-chip ' + (curLetter === ltr ? 'active' : '') + '" onclick="setRightMenuFilterFieldClient(\\'rmLetter\\',\\'' + ltr + '\\')">' + (ltr === "ALL" ? "Alle" : ltr) + '</button>'
              ).join("") +
            '</div>' +
          '</div>' +
          '<div id="rmEntriesScrollMount" class="rm-entries-scroll">' +
            buildRightMenuEntriesHtmlClient(items, tabMode) +
          '</div>';

        if (jumpToFirstEntry && typeof setSpatialFocus === "function") {
          const firstTarget = subPanel.querySelector(".rm-entry-card, .rm-ctrl-select, .rm-az-chip");
          if (firstTarget) setSpatialFocus(firstTarget, false, "left");
        }
      }

      function toggleRecentViewedCollapsedClient() {
        state.recentStripCollapsed = !state.recentStripCollapsed;
        refreshRecentViewedStripDom();
      }

      function scrollRecentStripClient(dirStep) {
        const track = document.getElementById("recentViewedStripTrack") || document.querySelector(".recent-strip");
        if (!track) return;
        triggerTmaHapticClient("selection");
        const stepPx = Math.max(220, Math.round(track.clientWidth * 0.65));
        track.scrollBy({ left: (Number(dirStep) || 1) * stepPx, behavior: "smooth" });
      }

      // Verlauf „Zuletzt gesehen“ lebt zentral im rechten Schnellmenü – keine separate Leiste mehr auf der Hauptseite
      function buildRecentViewedStripHtml() {
        return "";
      }

      function refreshRecentViewedStripDom() {
        const mount = document.getElementById("recentViewedMount");
        if (mount) mount.innerHTML = "";
      }

      async function playInstantTrailerFromCard(ev, typeCode, id, titleText, posterPath) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const tc = typeCode === "s" ? "s" : "m";
        const activeStage = document.getElementById("detailHeroStageEl");
        if (activeStage && state.activeDetails && String(state.activeDetails.id) === String(id) && state.activeDetails.typeCode === tc) {
          if (typeof enterDetailForegroundTrailerModeClient === "function") {
            enterDetailForegroundTrailerModeClient(ev);
            return;
          }
        }
        const resolvedTitle = titleText || (ev?.target?.closest?.(".card")?.getAttribute("data-card-title")) || "";
        await openDetails(tc, id, true, resolvedTitle, posterPath);
      }

      function switchInstantTrailerModalProvider(sourceKey) {
        setTrailerProvider(sourceKey);
        switchEmbedSource(sourceKey, false);
        const modalBtns = document.querySelectorAll("#modalRoot button[data-tp-id]");
        modalBtns.forEach(b => {
          const pid = b.getAttribute("data-tp-id") || "";
          const tpObj = TRAILER_PROVIDERS_CLIENT.find(x => x.id === pid);
          const isMatch = pid === sourceKey;
          b.className = "btn " + (isMatch ? "blue" : "");
          if (tpObj) b.textContent = tpObj.label + (isMatch ? " ✓ Standard" : "");
        });
      }

      // Universelle Client-Hilfsfunktion: Normalisiert TMDb-Poster-Pfade UND volle Fallback-URLs (OMDb, Wikidata, TVMaze)
      function resolvePosterUrlClient(posterPathOrUrl, size, fallbackUrl) {
        const sz = size || "w342";
        const raw = String(posterPathOrUrl || fallbackUrl || "").trim();
        if (!raw) return "";
        if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
        if (raw.startsWith("/")) return "https://image.tmdb.org/t/p/" + sz + raw;
        return "https://image.tmdb.org/t/p/" + sz + "/" + raw;
      }

      // Live-Synchronisation eines im Detail-Modal nachgeladenen Posters zurück in Katalog-Karten, Merkliste & Admin-Liste
      function syncCardPosterInDom(typeCode, id, resolvedPosterUrl) {
        if (!id || !resolvedPosterUrl) return;
        const key = (typeCode === "s" ? "s" : "m") + "_" + id;
        document.querySelectorAll('.card[data-card-key="' + key + '"] img').forEach(img => {
          const curSrc = img.getAttribute("src") || "";
          if (!curSrc || curSrc.includes("via.placeholder.com")) {
            img.setAttribute("src", resolvedPosterUrl);
          }
        });
        if (Array.isArray(state.items)) {
          state.items.forEach(it => {
            if (it && String(it.id) === String(id) && !it.poster_path && !it.external_poster_url) {
              it.poster_path = resolvedPosterUrl;
            }
          });
        }
        if (Array.isArray(state.cachedWishlistItems)) {
          state.cachedWishlistItems.forEach(it => {
            if (it && String(it.tmdbId) === String(id) && !it.poster) {
              it.poster = resolvedPosterUrl;
            }
          });
        }
      }

      // Klappt die Episodenliste (S01E01 – Titel) einer Serie in Playlisten / Merkliste / Admin-Editor auf oder zu
      function toggleSeriesEpisodesDrawerClient(ev, drawerId) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const box = document.getElementById("epDrawer_" + drawerId);
        const icon = document.getElementById("epDrawerIcon_" + drawerId);
        if (!box) return;
        const isHidden = box.style.display === "none";
        box.style.display = isHidden ? "flex" : "none";
        if (icon) icon.textContent = isHidden ? "▴" : "▾";
      }

      // Live-Synchronisation des Favoriten-Badges (🔖 / ✓) zwischen Detail-Modal, Hintergrund-Grid & Cache (#6)
      function syncCardWishlistBadgeInDom(typeCode, id, isSaved, triggerPop = false) {
        const key = (typeCode === "s" ? "s" : "m") + "_" + id;
        if (isSaved) savedKeysSet.add(key);
        else savedKeysSet.delete(key);
        document.querySelectorAll('.card[data-card-key="' + key + '"]').forEach(cardEl => {
          cardEl.classList.toggle("card-saved", Boolean(isSaved));
          cardEl.setAttribute("data-card-saved", isSaved ? "1" : "0");
          const btn = cardEl.querySelector(".card-quick-save");
          if (btn) {
            btn.classList.toggle("saved", Boolean(isSaved));
            btn.textContent = isSaved ? "✓" : "🔖";
            btn.setAttribute("title", isSaved ? "In deiner Merkliste gespeichert (Tipp oder gedrückt halten zum Entfernen)" : "In Merkliste speichern (Tipp oder Karte gedrückt halten)");
            if (triggerPop) {
              btn.classList.remove("quick-save-pop");
              void btn.offsetWidth; // Reflow erzwingen für erneute CSS-Keyframe-Animation
              btn.classList.add("quick-save-pop");
              setTimeout(() => {
                btn.classList.remove("quick-save-pop");
              }, 360);
            }
          }
        });
        // Hero-Slider Speichern-Button (#heroBtnWishlist) live mitsynchronisieren
        const heroWlBtn = document.getElementById("heroBtnWishlist");
        if (heroWlBtn && heroWlBtn.getAttribute("data-hero-wl-key") === key) {
          heroWlBtn.classList.toggle("saved", Boolean(isSaved));
          heroWlBtn.innerHTML = isSaved ? "✓ Gespeichert" : "＋ Speichern";
          heroWlBtn.setAttribute("title", isSaved ? "Aus deiner Merkliste entfernen" : "Direkt in deiner Merkliste speichern");
        }
        // Detail-Modal Button mitsynchronisieren, falls Modal für diesen Titel aktuell geöffnet ist
        if (state && state.activeDetails && String(state.activeDetails.id) === String(id) && state.activeDetails.typeCode === typeCode) {
          state.activeDetails.isSaved = Boolean(isSaved);
          const modalBtn = document.getElementById("modalWishlistBtn");
          if (modalBtn) {
            modalBtn.className = "detail-btn-glass " + (isSaved ? "saved" : "");
            modalBtn.textContent = isSaved ? "✓ Gespeichert" : "＋ Speichern";
          }
        }
        for (const [cKey, cVal] of clientDetailsCache.entries()) {
          if (cKey.startsWith(key + "_") && cVal && cVal.data) {
            cVal.data.isSaved = Boolean(isSaved);
          }
        }
        if (typeof syncRightMenuBadgesClient === "function") {
          syncRightMenuBadgesClient();
        }
        if (typeof syncCatalogFocusInfoBarClient === "function") {
          syncCatalogFocusInfoBarClient();
        }
      }

      const wishlistTogglesInFlight = new Set();

      async function quickToggleCardWishlist(ev, typeCode, id, titleText) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        if (!state.isAuthenticated) { openAccountModal(); return; }

        const cardKey = (typeCode === "s" ? "s" : "m") + "_" + id;
        if (wishlistTogglesInFlight.has(cardKey)) return;
        wishlistTogglesInFlight.add(cardKey);

        const resolvedTitle = titleText || (ev?.target?.closest?.(".card")?.getAttribute("data-card-title")) || "";
        const prevSaved = savedKeysSet.has(cardKey);
        const nextSaved = !prevSaved;

        // 1. Sofortiges optimistisches UI-Update und Pop-Animation auf dem Cover
        syncCardWishlistBadgeInDom(typeCode, id, nextSaved, true);
        showHudToast((nextSaved ? "💾 Gespeichert: " : "🗑️ Entfernt: ") + (resolvedTitle || "Titel"));

        // 2. Sofortiges Haptik-Feedback
        try {
          if (tg && tg.HapticFeedback && typeof tg.HapticFeedback.impactOccurred === "function") {
            tg.HapticFeedback.impactOccurred("medium");
          } else if (navigator.vibrate) {
            navigator.vibrate(30);
          }
        } catch (e) {}

        // 3. Im Hintergrund synchronisieren mit automatischem Rollback im Fehlerfall
        try {
          const r = await apiFetchJson(API_BASE + "/wishlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, action: "toggle_item", type: typeCode, id })
          });
          const serverSaved = Boolean(r && r.saved);
          if (serverSaved !== nextSaved) {
            syncCardWishlistBadgeInDom(typeCode, id, serverSaved, false);
          }
        } catch (e) {
          syncCardWishlistBadgeInDom(typeCode, id, prevSaved, false);
          showHudToast("⚠️ Fehler beim Aktualisieren der Merkliste");
        } finally {
          setTimeout(() => wishlistTogglesInFlight.delete(cardKey), 400);
        }
      }

      // Mobile Long-Press (~420ms) auf Katalog-Karten zum direkten Speichern/Entfernen in der Merkliste
      let cardLongPressTimer = null;
      let cardLongPressStartX = 0;
      let cardLongPressStartY = 0;
      let cardLongPressTarget = null;
      let cardLongPressTriggered = false;
      let lastCardLongPressAt = 0;

      function clearCardLongPressTimer() {
        if (cardLongPressTimer) {
          clearTimeout(cardLongPressTimer);
          cardLongPressTimer = null;
        }
        if (cardLongPressTarget) {
          cardLongPressTarget.classList.remove("long-press-active");
          cardLongPressTarget = null;
        }
      }

      // Unterdrückt das native Browser-/OS-Bildmenü ("Öffnen in... / Download / Link kopieren") und Textmarkierung auf Karten
      document.addEventListener("contextmenu", function(ev) {
        const card = ev.target && ev.target.closest ? ev.target.closest(".card") : null;
        if (card) {
          ev.preventDefault();
          ev.stopPropagation();
          return false;
        }
      }, { capture: true, passive: false });

      document.addEventListener("selectstart", function(ev) {
        const el = ev.target && ev.target.nodeType === 1 ? ev.target : (ev.target && ev.target.parentElement ? ev.target.parentElement : null);
        if (el && el.closest && el.closest(".card")) {
          ev.preventDefault();
        }
      }, { passive: false });

      // Intelligenter Lauftext (Marquee) für überlange Kartentitel, Folgennamen & Modal-Titel bei Hover, Fokus oder Auswahl
      let cardHoverPrewarmTimer = null;
      let cardTouchPrewarmTimer = null;
      const prewarmedDetailKeysInFlightSet = new Set();

      function prewarmItemDetailsClient(typeCode, id) {
        if (!id || typeof apiFetchJson !== "function") return;
        if (typeof backupImportJob !== "undefined" && backupImportJob && backupImportJob.running) return;
        const tc = typeCode === "s" ? "s" : "m";
        const vipAllowed = typeof isCurrentUserVip === "function" ? isCurrentUserVip() : false;
        const cacheKey = tc + "_" + id + "_" + (vipAllowed ? "vip" : "std");
        if (typeof clientDetailsCache !== "undefined" && clientDetailsCache instanceof Map) {
          const existing = clientDetailsCache.get(cacheKey);
          if (existing && (Date.now() - existing.ts < CLIENT_CACHE_TTL_MS)) return;
        }
        if (prewarmedDetailKeysInFlightSet.has(cacheKey)) return;
        prewarmedDetailKeysInFlightSet.add(cacheKey);
        apiFetchJson(API_BASE + "/details?chatId=" + encodeURIComponent(chatId) + "&type=" + tc + "&id=" + encodeURIComponent(id))
          .then((d) => {
            if (d && d.ok !== false && typeof clientDetailsCache !== "undefined" && clientDetailsCache instanceof Map) {
              clientDetailsCache.set(cacheKey, { data: d, ts: Date.now() });
              if (d.logo_path && typeof preloadClearLogoBitmapClient === "function") {
                preloadClearLogoBitmapClient(d.logo_path);
              }
            }
          })
          .catch(() => {})
          .finally(() => {
            prewarmedDetailKeysInFlightSet.delete(cacheKey);
          });
      }

      function scheduleCardIntentPrewarmClient(cardEl, delayMs = 70) {
        if (!cardEl || typeof cardEl.getAttribute !== "function") return;
        const rawKey = cardEl.getAttribute("data-card-key") || "";
        if (!rawKey) return;
        const parts = rawKey.split("_");
        if (parts.length < 2) return;
        const tc = parts[0] === "s" ? "s" : "m";
        const idNum = Number(parts[1]);
        if (!idNum) return;
        if (cardHoverPrewarmTimer) clearTimeout(cardHoverPrewarmTimer);
        cardHoverPrewarmTimer = setTimeout(() => {
          cardHoverPrewarmTimer = null;
          prewarmItemDetailsClient(tc, idNum);
        }, delayMs);
      }

      function activateCardTitleMarquee(card) {
        if (!card || !card.querySelector || card._noMarqueeNeeded) return;
        const titleEl = card.querySelector(".card-title");
        if (!titleEl || titleEl.classList.contains("is-marquee-overflow")) return;
        const rawText = (card.getAttribute("data-card-title") || titleEl.textContent || "").trim();
        if (rawText.length <= 20) {
          card._noMarqueeNeeded = true;
          return;
        }
        const isClamped = (titleEl.scrollHeight > titleEl.clientHeight + 2) || (rawText.length > 30);
        if (!isClamped) {
          card._noMarqueeNeeded = true;
          return;
        }
        let textSpan = titleEl.querySelector(".card-title-text");
        if (!textSpan) {
          titleEl.innerHTML = '<span class="card-title-text">' + esc(rawText) + '</span>';
          textSpan = titleEl.querySelector(".card-title-text");
        }
        titleEl.classList.add("is-marquee-overflow");
        const overflowPx = Math.max(0, (textSpan ? textSpan.scrollWidth : titleEl.scrollWidth) - titleEl.clientWidth);
        if (overflowPx > 4) {
          const durSec = Math.max(4.2, Math.min(11.5, 2.5 + overflowPx / 36)).toFixed(2) + "s";
          titleEl.style.setProperty("--marquee-dist", "-" + (overflowPx + 10) + "px");
          titleEl.style.setProperty("--marquee-dur", durSec);
        } else {
          titleEl.classList.remove("is-marquee-overflow");
          card._noMarqueeNeeded = true;
        }
      }

      function deactivateCardTitleMarquee(card) {
        if (!card || !card.querySelector) return;
        const titleEl = card.querySelector(".card-title");
        if (!titleEl || !titleEl.classList.contains("is-marquee-overflow")) return;
        titleEl.classList.remove("is-marquee-overflow");
        titleEl.style.removeProperty("--marquee-dist");
        titleEl.style.removeProperty("--marquee-dur");
      }

      function activateInlineTextMarquee(wrapEl) {
        if (!wrapEl || wrapEl.classList.contains("is-marquee-overflow")) return;
        const textSpan = wrapEl.querySelector(".ep-name-text, .inline-marquee-text");
        if (!textSpan) return;
        const overflowPx = Math.max(0, textSpan.scrollWidth - wrapEl.clientWidth);
        if (overflowPx > 3) {
          const durSec = Math.max(4.2, Math.min(12.5, 2.6 + overflowPx / 34)).toFixed(2) + "s";
          wrapEl.classList.add("is-marquee-overflow");
          wrapEl.style.setProperty("--marquee-dist", "-" + (overflowPx + 16) + "px");
          wrapEl.style.setProperty("--marquee-dur", durSec);
        }
      }

      function deactivateInlineTextMarquee(wrapEl) {
        if (!wrapEl || !wrapEl.classList.contains("is-marquee-overflow")) return;
        if (wrapEl.hasAttribute("data-marquee-always")) return;
        wrapEl.classList.remove("is-marquee-overflow");
        wrapEl.style.removeProperty("--marquee-dist");
        wrapEl.style.removeProperty("--marquee-dur");
      }

      window.refreshModalAndEpisodeMarquees = function(rootNode) {
        const scope = rootNode || document;
        if (!scope || !scope.querySelectorAll) return;
        scope.querySelectorAll("[data-marquee-always='1']").forEach(wrapEl => {
          wrapEl.classList.remove("is-marquee-overflow");
          activateInlineTextMarquee(wrapEl);
        });
      };

      window.syncActiveCardMarquee = function(focusedEl) {
        const activeCard = focusedEl && focusedEl.closest ? focusedEl.closest(".card") : null;
        document.querySelectorAll(".card-title.is-marquee-overflow").forEach(el => {
          const parentCard = el.closest(".card");
          if (parentCard && parentCard !== activeCard && !parentCard.matches(":hover")) {
            deactivateCardTitleMarquee(parentCard);
          }
        });
        if (activeCard) {
          activateCardTitleMarquee(activeCard);
          scheduleCardIntentPrewarmClient(activeCard, 60);
        }
        const activeEpRow = focusedEl && focusedEl.closest ? focusedEl.closest(".ep-row, .inline-marquee-wrap") : null;
        document.querySelectorAll(".ep-name-wrap.is-marquee-overflow, .inline-marquee-wrap.is-marquee-overflow").forEach(el => {
          if (el.hasAttribute("data-marquee-always")) return;
          const parentRow = el.closest(".ep-row") || el;
          if (parentRow !== activeEpRow && !parentRow.matches(":hover")) {
            deactivateInlineTextMarquee(el);
          }
        });
        if (activeEpRow) {
          const wraps = activeEpRow.classList && (activeEpRow.classList.contains("ep-name-wrap") || activeEpRow.classList.contains("inline-marquee-wrap"))
            ? [activeEpRow]
            : Array.from(activeEpRow.querySelectorAll(".ep-name-wrap, .inline-marquee-wrap"));
          wraps.forEach(w => activateInlineTextMarquee(w));
        }
      };

      let lastMouseOverCardEl = null;
      document.addEventListener("mouseover", function(ev) {
        const card = ev.target && ev.target.closest ? ev.target.closest(".card") : null;
        if (card) {
          if (card !== lastMouseOverCardEl) {
            lastMouseOverCardEl = card;
            activateCardTitleMarquee(card);
            scheduleCardIntentPrewarmClient(card, 75);
          }
        }
        const epRow = ev.target && ev.target.closest ? ev.target.closest(".ep-row, .inline-marquee-wrap") : null;
        if (epRow) {
          if (epRow.classList.contains("inline-marquee-wrap")) {
            activateInlineTextMarquee(epRow);
          } else {
            epRow.querySelectorAll(".ep-name-wrap, .inline-marquee-wrap").forEach(w => activateInlineTextMarquee(w));
          }
        }
      }, { passive: true });

      document.addEventListener("mouseout", function(ev) {
        const card = ev.target && ev.target.closest ? ev.target.closest(".card") : null;
        if (card) {
          const rel = ev.relatedTarget;
          if (!rel || !card.contains(rel)) {
            if (lastMouseOverCardEl === card) lastMouseOverCardEl = null;
            if (cardHoverPrewarmTimer) {
              clearTimeout(cardHoverPrewarmTimer);
              cardHoverPrewarmTimer = null;
            }
            if (!card.classList.contains("spatial-focus") && !card.classList.contains("card-subnav-active")) {
              deactivateCardTitleMarquee(card);
            }
          }
        }
        const epRow = ev.target && ev.target.closest ? ev.target.closest(".ep-row, .inline-marquee-wrap") : null;
        if (epRow) {
          const rel = ev.relatedTarget;
          if (!rel || !epRow.contains(rel)) {
            if (epRow.classList.contains("inline-marquee-wrap")) {
              deactivateInlineTextMarquee(epRow);
            } else {
              epRow.querySelectorAll(".ep-name-wrap, .inline-marquee-wrap").forEach(w => deactivateInlineTextMarquee(w));
            }
          }
        }
      }, { passive: true });

      document.addEventListener("touchstart", function(ev) {
        if (!ev.touches || ev.touches.length !== 1) return;
        const epTouch = ev.target && ev.target.closest ? ev.target.closest(".ep-row, .inline-marquee-wrap") : null;
        if (epTouch && typeof window.syncActiveCardMarquee === "function") {
          window.syncActiveCardMarquee(epTouch);
        }
        if (ev.target && ev.target.closest && ev.target.closest("button, a, select, input")) return;
        const card = ev.target && ev.target.closest ? ev.target.closest(".card[data-card-key]") : null;
        if (!card) return;
        if (typeof window.syncActiveCardMarquee === "function") window.syncActiveCardMarquee(card);
        const rawKey = card.getAttribute("data-card-key") || "";
        const parts = rawKey.split("_");
        if (parts.length < 2) return;
        const tc = parts[0] === "s" ? "s" : "m";
        const idNum = Number(parts[1]);
        if (!idNum) return;
        if (cardTouchPrewarmTimer) clearTimeout(cardTouchPrewarmTimer);
        cardTouchPrewarmTimer = setTimeout(() => {
          cardTouchPrewarmTimer = null;
          prewarmItemDetailsClient(tc, idNum);
        }, 42);
        const titleEl = card.querySelector(".card-title");
        const titleTxt = card.getAttribute("data-card-title") || (titleEl ? titleEl.textContent : "") || "Titel";

        clearCardLongPressTimer();
        cardLongPressTriggered = false;
        cardLongPressStartX = ev.touches[0].clientX;
        cardLongPressStartY = ev.touches[0].clientY;
        cardLongPressTarget = card;

        cardLongPressTimer = setTimeout(function() {
          cardLongPressTimer = null;
          cardLongPressTriggered = true;
          lastCardLongPressAt = Date.now();
          if (cardLongPressTarget) {
            cardLongPressTarget.classList.add("long-press-active");
            setTimeout(() => {
              if (card) card.classList.remove("long-press-active");
            }, 240);
          }
          quickToggleCardWishlist(null, tc, idNum, titleTxt);
        }, 420);
      }, { passive: true });

      document.addEventListener("touchmove", function(ev) {
        if (cardTouchPrewarmTimer) {
          clearTimeout(cardTouchPrewarmTimer);
          cardTouchPrewarmTimer = null;
        }
        if (!cardLongPressTimer || !ev.touches || !ev.touches[0]) return;
        const dx = ev.touches[0].clientX - cardLongPressStartX;
        const dy = ev.touches[0].clientY - cardLongPressStartY;
        // Euklidische Distanz: 22px Bewegungstoleranz (dx² + dy² > 484) gegen Android-Finger-Mikrojitter
        if ((dx * dx + dy * dy) > 484) {
          clearCardLongPressTimer();
        }
      }, { passive: true });

      document.addEventListener("touchend", function(ev) {
        if (cardLongPressTriggered) {
          lastCardLongPressAt = Date.now();
          cardLongPressTriggered = false;
          if (ev && ev.cancelable) ev.preventDefault();
        }
        clearCardLongPressTimer();
      }, { passive: false });

      document.addEventListener("touchcancel", function() {
        cardLongPressTriggered = false;
        clearCardLongPressTimer();
      }, { passive: true });

      // Desktop Mouse Long-Press (~420ms) auf Katalog-Karten zum direkten Speichern/Entfernen in der Merkliste
      document.addEventListener("mousedown", function(ev) {
        if (ev.button !== 0) return;
        if (ev.target && ev.target.closest && ev.target.closest("button, a, select, input")) return;
        const card = ev.target && ev.target.closest ? ev.target.closest(".card[data-card-key]") : null;
        if (!card) return;
        const rawKey = card.getAttribute("data-card-key") || "";
        const parts = rawKey.split("_");
        if (parts.length < 2) return;
        const tc = parts[0] === "s" ? "s" : "m";
        const idNum = Number(parts[1]);
        if (!idNum) return;
        const titleEl = card.querySelector(".card-title");
        const titleTxt = card.getAttribute("data-card-title") || (titleEl ? titleEl.textContent : "") || "Titel";

        clearCardLongPressTimer();
        cardLongPressTriggered = false;
        cardLongPressStartX = ev.clientX;
        cardLongPressStartY = ev.clientY;
        cardLongPressTarget = card;

        cardLongPressTimer = setTimeout(function() {
          cardLongPressTimer = null;
          cardLongPressTriggered = true;
          lastCardLongPressAt = Date.now();
          if (cardLongPressTarget) {
            cardLongPressTarget.classList.add("long-press-active");
            setTimeout(() => {
              if (card) card.classList.remove("long-press-active");
            }, 240);
          }
          quickToggleCardWishlist(null, tc, idNum, titleTxt);
        }, 420);
      });

      document.addEventListener("mousemove", function(ev) {
        if (!cardLongPressTimer) return;
        const dx = ev.clientX - cardLongPressStartX;
        const dy = ev.clientY - cardLongPressStartY;
        if ((dx * dx + dy * dy) > 256) {
          clearCardLongPressTimer();
        }
      });

      document.addEventListener("mouseup", function() {
        if (cardLongPressTriggered) {
          lastCardLongPressAt = Date.now();
          cardLongPressTriggered = false;
        }
        clearCardLongPressTimer();
      });

      let state = {
        type: "m",
        genreId: "all",
        mode: "trend",
        sort: "default",
        startPage: 1,
        page: 1,
        totalPages: 1,
        totalResults: 0,
        hasMorePages: false,
        loadingMore: false,
        visibleCatalogPage: 1,
        items: [],
        genres: {},
        settings: {},
        history: [],
        wlFolder: "root",
        wlFilterType: "all",
        wlSort: "added_desc",
        wlSearchQuery: "",
        wlLetter: "ALL",
        wlViewMode: (function() {
          try { return localStorage.getItem("tma_wl_view_mode") || "grid"; } catch (e) { return "grid"; }
        })(),
        cachedWishlistItems: [],
        cachedWishlistFolders: [],
        activeDetails: null,
        pendingTmdbToken: "",
        franchiseTab: "collections",
        worldsTrayOpen: false,
        worldsTrayTab: "universes",
        worldsTrayQuery: "",
        worldsTrayRemoteCols: [],
        openFilterDropdown: null,
        sidebarOpen: false,
        sidebarTab: null,
        sidebarDesignOpen: false,
        sidebarScaleOpen: false,
        isSearchMode: false,
        searchFocused: false,
        searchQuery: "",
        searchScope: "all",
        searchMatchedCollections: [],
        searchMatchedUniverses: [],
        searchMatchedPersons: [],
        searchMatchedStudios: [],
        searchEntitiesExpanded: false,
        filtersCollapsedInSearch: false,
        scalePanelOpen: false,
        heroSlides: [],
        heroIndex: 0,
        heroActionsEngaged: false,
        heroHidden: (function() {
          try { return localStorage.getItem("tma_hero_hidden") === "1"; } catch (e) { return false; }
        })(),
        isAuthenticated: false,
        hasInitData: Boolean(rawInitData),
        authUser: null,
        adminTab: "users",
        adminMediaType: "m",
        currentView: "discover",
        currentCollectionId: null,
        currentCollectionName: "",
        currentUniverseId: null,
        currentUniverseName: "",
        currentPersonId: null,
        currentPersonName: "",
        currentCompanyId: null,
        currentCompanyName: "",
        botUsername: ""
      };

      // =========================================================================
      // 3. KINO-SPOTLIGHT HERO-SHOWCASE (POSTER-KARTE + CROSSFADE/ZOOM + MINIATUR-LEISTE)
      // =========================================================================
      let heroRotationTimer = null;
      let heroPointerHovered = false;
      const overviewTranslationCacheClient = new Map();
      const heroDetailsOverviewBackfillSet = new Set();

      function isGenericPlaceholderOverviewClient(text) {
        const t = String(text || "").trim();
        if (!t) return true;
        return t.indexOf("Tippe auf Details für Trailer") !== -1 || t === "Keine deutsche Beschreibung hinterlegt.";
      }

      function isLikelyEnglishOverviewClient(text) {
        const raw = String(text || "").trim();
        if (!raw || raw.length < 24 || isGenericPlaceholderOverviewClient(raw)) return false;
        const lower = " " + raw.toLowerCase().replace(/[^a-zäöüß\\s]/g, " ") + " ";
        const enMatches = lower.match(/\\b(the|and|with|from|when|after|into|their|while|who|his|her|they|that|this|for|about|between|against|through|during|before|under|around|world|family|life|young|story|years|discover|discovers|finds|must|new|two|one|three|first|last)\\b/g);
        const deMatches = lower.match(/\\b(und|der|die|das|ein|eine|einer|einem|einen|mit|auf|für|von|sich|nicht|auch|als|nach|wird|werden|wurde|über|durch|gegen|zwischen|während|oder|aber|wenn|wie|noch|nur|schon|mehr|seiner|seinem|ihrer|ihrem|ihren|dieser|diese|dieses)\\b/g);
        const enCount = enMatches ? enMatches.length : 0;
        const deCount = deMatches ? deMatches.length : 0;
        return enCount >= 2 && enCount > deCount * 1.5;
      }

      function buildContextualHeroFallbackOverviewClient(hero, isMovie) {
        if (!hero) return "Exklusives Highlight im Katalog – entdecke Trailer, Streams, Besetzung und alle Filmreihen-Details.";
        const titleRaw = String(hero.title || hero.name || "Dieses Highlight").trim();
        const yearStr = String(hero.release_date || hero.first_air_date || "").slice(0, 4);
        const voteNum = Number(hero.vote_average || 0);
        const voteStr = voteNum > 0 ? voteNum.toFixed(1) : "";
        const genres = typeof resolveHeroGenreItemsClient === "function"
          ? resolveHeroGenreItemsClient(hero, isMovie).map(g => g.name).filter(Boolean)
          : [];
        const genreText = genres.length > 0 ? genres.slice(0, 3).join(", ") : (isMovie ? "Kino-Highlight" : "Serien-Highlight");
        const typeWord = isMovie ? "Spielfilm" : "Serie";
        return "„" + titleRaw + "“" + (yearStr ? (" (" + yearStr + ")") : "") +
          " zählt zu den ausgewählten " + typeWord + "-Empfehlungen im Bereich " + genreText +
          (voteStr ? (" und überzeugt mit einer TMDb-Wertung von ★ " + voteStr) : "") +
          ". Starte direkt den Trailer oder öffne die Detailansicht für Streams, Episoden und Besetzung.";
      }

      function resolveHeroOverviewTextClient(hero, isMovie) {
        if (!hero) return "";
        if (hero._showTranslatedOverviewDe && hero._translatedOverviewDe) {
          return String(hero._translatedOverviewDe).trim();
        }
        const raw = String(hero.overview || "").trim();
        if (raw && !isGenericPlaceholderOverviewClient(raw)) {
          return raw;
        }
        return buildContextualHeroFallbackOverviewClient(hero, isMovie);
      }

      async function ensureHeroSlidesOverviewsClient() {
        if (!Array.isArray(state.heroSlides) || state.heroSlides.length === 0) return;
        const slidesSnapshot = state.heroSlides.slice();
        for (let i = 0; i < slidesSnapshot.length; i++) {
          const sl = slidesSnapshot[i];
          if (!sl || !sl.id) continue;
          const rawOv = String(sl.overview || "").trim();
          if (rawOv && !isGenericPlaceholderOverviewClient(rawOv)) continue;
          const slType = sl.media_type === "tv" || state.type === "s" ? "s" : "m";
          const key = slType + "_" + sl.id;
          if (heroDetailsOverviewBackfillSet.has(key)) continue;
          heroDetailsOverviewBackfillSet.add(key);
          try {
            const det = await apiFetchJson(API_BASE + "/details?type=" + slType + "&id=" + encodeURIComponent(sl.id));
            const fetchedOv = String(det?.overview || "").trim();
            if (fetchedOv && !isGenericPlaceholderOverviewClient(fetchedOv)) {
              sl.overview = fetchedOv;
              const curHero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
              if (curHero && Number(curHero.id) === Number(sl.id)) {
                updateHeroBannerDomOnly(false);
              }
            }
          } catch (_e) {}
        }
      }

      function triggerTmaHapticClient(style) {
        try {
          const s = style || "light";
          if (tg && tg.HapticFeedback) {
            if (s === "selection" && typeof tg.HapticFeedback.selectionChanged === "function") {
              tg.HapticFeedback.selectionChanged();
              return;
            }
            if (typeof tg.HapticFeedback.impactOccurred === "function") {
              tg.HapticFeedback.impactOccurred(s === "heavy" ? "heavy" : s === "medium" ? "medium" : "light");
              return;
            }
          }
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            navigator.vibrate(s === "heavy" ? 20 : s === "medium" ? 14 : 9);
          }
        } catch (_e) {}
      }

      async function translateOverviewTextClient(ev, itemKey, boxId, textElId, btnId) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        triggerTmaHapticClient("light");
        const textEl = document.getElementById(textElId);
        const btnEl = document.getElementById(btnId);
        const boxEl = document.getElementById(boxId);
        if (!textEl || !btnEl) return;

        // Ziel-Objekt (Hero-Slide oder Detail-Modal) ermitteln
        let targetObj = null;
        if (itemKey === "activeDetails" && state.activeDetails) {
          targetObj = state.activeDetails;
        } else if (Array.isArray(state.heroSlides)) {
          targetObj = state.heroSlides.find(s => ((s.media_type === "tv" || state.type === "s" ? "s" : "m") + "_" + s.id) === itemKey) || state.heroSlides[state.heroIndex];
        }
        const origText = String(targetObj?._originalOverviewEn || targetObj?.overview || textEl.getAttribute("data-orig-overview") || textEl.textContent || "").trim();
        if (!origText) return;
        if (targetObj && !targetObj._originalOverviewEn) {
          targetObj._originalOverviewEn = origText;
        }
        textEl.setAttribute("data-orig-overview", origText);

        // Toggle zurück auf Englisch, falls bereits übersetzt
        if (btnEl.classList.contains("is-translated")) {
          btnEl.classList.remove("is-translated");
          btnEl.innerHTML = "🌐 Auf Deutsch übersetzen";
          textEl.textContent = origText;
          if (targetObj) targetObj._showTranslatedOverviewDe = false;
          if (boxEl) requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(boxEl));
          return;
        }

        // Aus Cache laden, falls schon übersetzt
        const cachedDe = (targetObj && targetObj._translatedOverviewDe) || overviewTranslationCacheClient.get(origText);
        if (cachedDe) {
          if (targetObj) {
            targetObj._translatedOverviewDe = cachedDe;
            targetObj._showTranslatedOverviewDe = true;
          }
          textEl.textContent = cachedDe;
          btnEl.classList.add("is-translated");
          btnEl.innerHTML = "🇬🇧 Original anzeigen";
          if (boxEl) requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(boxEl));
          return;
        }

        const prevLabel = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = "⏳ Übersetze…";
        try {
          const res = await apiFetchJson(API_BASE + "/translate?text=" + encodeURIComponent(origText) + "&sl=en&tl=de");
          const translated = String(res?.translatedText || "").trim();
          if (translated) {
            overviewTranslationCacheClient.set(origText, translated);
            if (targetObj) {
              targetObj._translatedOverviewDe = translated;
              targetObj._showTranslatedOverviewDe = true;
            }
            textEl.textContent = translated;
            btnEl.classList.add("is-translated");
            btnEl.innerHTML = "🇬🇧 Original anzeigen";
            if (boxEl) requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(boxEl));
          } else {
            btnEl.innerHTML = prevLabel;
          }
        } catch (_err) {
          btnEl.innerHTML = prevLabel;
        } finally {
          btnEl.disabled = false;
        }
      }

      function rebuildHeroSlides(itemsList) {
        const withBackdrop = (itemsList || []).filter(i => i && (i.backdrop_path || i.poster_path));
        const withOverview = withBackdrop.filter(i => i.overview && !isGenericPlaceholderOverviewClient(i.overview));
        const withoutOverview = withBackdrop.filter(i => !i.overview || isGenericPlaceholderOverviewClient(i.overview));
        const prioritizedPool = withOverview.concat(withoutOverview);
        if (prioritizedPool.length <= 6) {
          state.heroSlides = prioritizedPool.slice(0, 6);
        } else {
          const pool = prioritizedPool.slice(0, 14);
          const picked = [];
          while (picked.length < 6 && pool.length > 0) {
            const idx = Math.floor(Math.random() * pool.length);
            picked.push(pool.splice(idx, 1)[0]);
          }
          state.heroSlides = picked;
        }
        state.heroIndex = 0;
        state.heroActionsEngaged = false;
        startHeroRotationTimer();
        setTimeout(() => {
          if (typeof prewarmAllHeroSlidesClearLogosClient === "function") {
            prewarmAllHeroSlidesClearLogosClient();
          }
          const activeSlide = state.heroSlides[0];
          if (activeSlide && activeSlide.id) {
            const activeType = activeSlide.media_type === "tv" || state.type === "s" ? "s" : "m";
            prewarmItemDetailsClient(activeType, activeSlide.id);
          }
        }, 35);
        setTimeout(() => {
          ensureHeroSlidesOverviewsClient();
        }, 380);
      }

      // =========================================================================
      // 3b. GESTAFFELTE BILD-LADEPIPELINE (SLIDER 1 -> SLIDER 2..N + SEITE 1 COVER -> INTERSECTIONOBSERVER)
      //     INKLUSIVE SCHNELL-SCROLL-SCHUTZ, AUTO-PAGINATION & SMART-SEITENINDIKATOR
      // =========================================================================
      const LAZY_POSTER_PLACEHOLDER_SVG =
        "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22450%22 viewBox=%220 0 300 450%22%3E%3Crect width=%22300%22 height=%22450%22 fill=%22%230f172a%22/%3E%3C/svg%3E";
      const LAZY_POSTER_FALLBACK_SVG =
        "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22450%22 viewBox=%220 0 300 450%22%3E%3Crect width=%22300%22 height=%22450%22 fill=%22%230f172a%22/%3E%3Ctext x=%22150%22 y=%22225%22 fill=%22%2364748b%22 font-family=%22sans-serif%22 font-size=%2216%22 text-anchor=%22middle%22%3EKein Poster%3C/text%3E%3C/svg%3E";

      function buildPosterFallbackSvg(titleText, isSeriesOrLabel) {
        const safeLabel = (typeof isSeriesOrLabel === "string" && isSeriesOrLabel.trim())
          ? isSeriesOrLabel.trim().slice(0, 12).toUpperCase()
          : (isSeriesOrLabel ? "SERIE" : "FILM");
        const cleanTitle = String(titleText || "Kein Poster")
          .replace(/[<>&"']/g, "")
          .trim()
          .slice(0, 26);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">' +
          '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#1e293b"/></linearGradient></defs>' +
          '<rect width="300" height="450" fill="url(#bg)"/>' +
          '<rect x="95" y="160" width="110" height="28" rx="6" fill="rgba(56,189,248,0.16)" stroke="rgba(56,189,248,0.45)"/>' +
          '<text x="150" y="179" fill="#7dd3fc" font-family="sans-serif" font-size="12" font-weight="700" text-anchor="middle">' + safeLabel + '</text>' +
          '<text x="150" y="230" fill="#e2e8f0" font-family="sans-serif" font-size="15" font-weight="700" text-anchor="middle">' + (cleanTitle || "Kein Poster") + '</text>' +
          '</svg>';
        return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      }

      let heroWaterfallSeq = 0;
      let catalogCoversUnlocked = false;
      let lazyCoverObserver = null;
      let infiniteScrollSentinelObserver = null;
      let catalogPageTrackObserver = null;
      let smartPageIndicatorIdleTimer = null;
      const pendingIntersectedCoversSet = new Set();
      const preloadedHeroSlideUrlsSet = new Set();

      function hydrateLazyCoverImageClient(img) {
        if (!img || !(img instanceof Element)) return;
        if (img._dwellTimer) {
          clearTimeout(img._dwellTimer);
          img._dwellTimer = null;
        }
        pendingIntersectedCoversSet.delete(img);
        const targetSrc = img.getAttribute("data-lazy-src");
        if (!targetSrc) {
          img.classList.remove("is-loading");
          img.classList.add("is-loaded");
          return;
        }
        img.removeAttribute("data-lazy-src");
        if (lazyCoverObserver) {
          try { lazyCoverObserver.unobserve(img); } catch (_e) {}
        }
        try { img.decoding = "async"; } catch (_e) {}
        const finalizeLoaded = () => {
          img.classList.remove("is-loading");
          img.classList.add("is-loaded");
        };
        img.addEventListener("load", finalizeLoaded, { once: true });
        img.addEventListener("error", finalizeLoaded, { once: true });
        img.src = targetSrc;
      }

      function ensureLazyCoverIntersectionObserverClient() {
        if (lazyCoverObserver || typeof IntersectionObserver === "undefined") return lazyCoverObserver;
        lazyCoverObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const img = entry.target;
              if (!img) continue;
              if (entry.isIntersecting) {
                img._isIntersectingViewportZone = true;
                if (!catalogCoversUnlocked) {
                  pendingIntersectedCoversSet.add(img);
                  continue;
                }
                hydrateLazyCoverImageClient(img);
              } else {
                img._isIntersectingViewportZone = false;
                pendingIntersectedCoversSet.delete(img);
                if (img._dwellTimer) {
                  clearTimeout(img._dwellTimer);
                  img._dwellTimer = null;
                }
              }
            }
          },
          {
            root: null,
            rootMargin: "120% 0px 120% 0px",
            threshold: 0.01
          }
        );
        return lazyCoverObserver;
      }

      function preloadCatalogPageCoversClient(pageNum) {
        const targetPageStr = String(pageNum || state.startPage || 1);
        const imgs = Array.from(
          document.querySelectorAll(
            '#resultsGridContainer img.lazy-cover-img[data-lazy-src][data-page-num="' + targetPageStr + '"]'
          )
        );
        const listToLoad = imgs.length > 0
          ? imgs
          : Array.from(document.querySelectorAll("#resultsGridContainer img.lazy-cover-img[data-lazy-src]")).slice(0, 20);
        if (!listToLoad.length) return;
        let idx = 0;
        const loadBatch = () => {
          if (!catalogCoversUnlocked) return;
          const slice = listToLoad.slice(idx, idx + 8);
          idx += 8;
          for (const img of slice) {
            hydrateLazyCoverImageClient(img);
          }
          if (idx < listToLoad.length) {
            requestAnimationFrame(loadBatch);
          }
        };
        loadBatch();
      }

      function unlockCatalogCoversLoadingClient(preloadFirstPage = true) {
        const wasLocked = !catalogCoversUnlocked;
        catalogCoversUnlocked = true;
        if (pendingIntersectedCoversSet.size > 0) {
          const queued = Array.from(pendingIntersectedCoversSet);
          pendingIntersectedCoversSet.clear();
          queued.forEach((img) => hydrateLazyCoverImageClient(img));
        }
        if (wasLocked && preloadFirstPage) {
          preloadCatalogPageCoversClient(state.startPage || 1);
        }
      }

      function preloadSingleImageUrlClient(url, highPriority = false) {
        return new Promise((resolve) => {
          if (!url || preloadedHeroSlideUrlsSet.has(url)) {
            resolve(true);
            return;
          }
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            preloadedHeroSlideUrlsSet.add(url);
            resolve(true);
          };
          const timer = setTimeout(finish, highPriority ? 360 : 900);
          try {
            const img = new Image();
            if (highPriority && "fetchPriority" in img) {
              try { img.fetchPriority = "high"; } catch (_e) {}
            }
            img.onload = () => { clearTimeout(timer); finish(); };
            img.onerror = () => { clearTimeout(timer); finish(); };
            img.src = url;
          } catch (_err) {
            clearTimeout(timer);
            finish();
          }
        });
      }

      async function preloadHeroSlideAssetsPairClient(slideObj, highPriority = false) {
        if (!slideObj) return;
        const slideType = slideObj.media_type === "tv" || state.type === "s" ? "s" : "m";
        if (typeof ensureHeroSlideClearLogoClient === "function") {
          ensureHeroSlideClearLogoClient(slideObj, slideType);
        }
        const bpUrl = typeof resolveHeroSlideBackdropUrlClient === "function" ? resolveHeroSlideBackdropUrlClient(slideObj) : "";
        const posterUrl = typeof resolveHeroSlidePosterUrlClient === "function" ? resolveHeroSlidePosterUrlClient(slideObj, "w780") : "";
        const isPortraitViewport = (window.innerWidth || 1024) <= 640 || (window.innerHeight > window.innerWidth);
        const primaryUrl = isPortraitViewport ? (posterUrl || bpUrl) : (bpUrl || posterUrl);
        if (primaryUrl) {
          await preloadSingleImageUrlClient(primaryUrl, highPriority);
        }
      }

      function observeLazyCoversInContainerClient(rootEl) {
        const scope = rootEl || document;
        if (!scope || typeof scope.querySelectorAll !== "function") return;
        const obs = ensureLazyCoverIntersectionObserverClient();
        const imgs = Array.from(scope.querySelectorAll("img.lazy-cover-img[data-lazy-src]"));
        if (!obs) {
          imgs.forEach((img) => hydrateLazyCoverImageClient(img));
          return;
        }
        imgs.forEach((img) => obs.observe(img));
      }

      function ensureInfiniteScrollSentinelObserverClient() {
        if (typeof IntersectionObserver === "undefined") return;
        if (infiniteScrollSentinelObserver) {
          infiniteScrollSentinelObserver.disconnect();
        }
        const sentinelEl = document.getElementById("infiniteScrollSentinel");
        if (!sentinelEl) return;
        infiniteScrollSentinelObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting && state.hasMorePages && !state.loadingMore) {
                const sliderBlocking = Boolean(
                  !state.isSearchMode &&
                  !state.heroHidden &&
                  !heroCurtainScrolledToCatalog &&
                  Array.isArray(state.heroSlides) &&
                  state.heroSlides.length > 0
                );
                if (!sliderBlocking && typeof loadMoreResults === "function") {
                  loadMoreResults(true);
                }
              }
            }
          },
          {
            root: null,
            rootMargin: "0px 0px 850px 0px",
            threshold: 0.01
          }
        );
        infiniteScrollSentinelObserver.observe(sentinelEl);
      }

      function ensureCatalogPageTrackObserverClient(rootEl) {
        if (typeof IntersectionObserver === "undefined") return;
        if (!catalogPageTrackObserver) {
          catalogPageTrackObserver = new IntersectionObserver(
            (entries) => {
              let bestPage = null;
              let bestTop = Infinity;
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  const pAttr = Number(entry.target.getAttribute("data-page-num") || 0);
                  if (pAttr > 0 && entry.boundingClientRect.top < bestTop) {
                    bestTop = entry.boundingClientRect.top;
                    bestPage = pAttr;
                  }
                }
              }
              if (bestPage && bestPage !== state.visibleCatalogPage) {
                state.visibleCatalogPage = bestPage;
                syncSmartPageIndicatorDomClient(true);
              }
            },
            {
              root: null,
              rootMargin: "-15% 0px -55% 0px",
              threshold: 0.05
            }
          );
        }
        const scope = rootEl || document.getElementById("resultsGridContainer");
        if (!scope || typeof scope.querySelectorAll !== "function") return;
        const cards = scope.querySelectorAll(".card[data-page-num]");
        cards.forEach((c) => catalogPageTrackObserver.observe(c));
      }

      let lastPageIndicatorDomSig = "";
      function syncSmartPageIndicatorDomClient(pulseActive = false) {
        const totPages = Math.max(1, Number(state.totalPages) || 1);
        const curLoadedMaxPage = Math.max(1, Number(state.page) || 1);
        const startP = Math.max(1, Math.min(curLoadedMaxPage, Number(state.startPage) || 1));
        const visPage = Math.max(startP, Math.min(curLoadedMaxPage, Number(state.visibleCatalogPage) || curLoadedMaxPage));

        const isCatalogVisible = Boolean(
          (state.currentView === "discover" || state.isSearchMode) &&
          !state.currentCollectionId &&
          !state.currentUniverseId &&
          !state.currentPersonId &&
          totPages > 1 &&
          state.items.length > 0 &&
          !(document.body && document.body.classList.contains("in-hero-slider")) &&
          (state.isSearchMode || state.heroHidden || heroCurtainScrolledToCatalog || (window.scrollY || window.pageYOffset || 0) > 20)
        );

        let floatBtn = document.getElementById("smartPageIndicatorBtn");
        if (!floatBtn && document.body) {
          floatBtn = document.createElement("button");
          floatBtn.type = "button";
          floatBtn.id = "smartPageIndicatorBtn";
          floatBtn.setAttribute("onclick", "openPageJumpModalClient()");
          floatBtn.setAttribute("title", "Aktuelle Seite – Klicken oder Enter für direkte Seitenwahl (TV & Touch)");
          document.body.appendChild(floatBtn);
        }

        const nextSig = visPage + "|" + totPages + "|" + startP + "|" + curLoadedMaxPage + "|" + (state.hasMorePages ? "1" : "0") + "|" + (isCatalogVisible ? "1" : "0");
        const topPill = document.getElementById("sectionPageCounterPill");
        if (nextSig !== lastPageIndicatorDomSig || (topPill && !topPill._sigSynced)) {
          lastPageIndicatorDomSig = nextSig;
          if (topPill) {
            topPill.innerHTML = "📄 Seite " + visPage + " / " + totPages + " ▾";
            topPill._sigSynced = true;
          }

          const sentinelInfo = document.getElementById("infiniteScrollStatusLabel");
          if (sentinelInfo) {
            if (state.hasMorePages && curLoadedMaxPage < totPages) {
              sentinelInfo.innerHTML = "📄 Seiten " + startP + (curLoadedMaxPage > startP ? ("–" + curLoadedMaxPage) : "") + " von " + totPages + " geladen";
            } else if (totPages > 1) {
              sentinelInfo.innerHTML = "✅ Alle " + totPages + " Seiten geladen";
            }
          }
          const manualMoreBtn = document.getElementById("manualLoadMoreBtn");
          if (manualMoreBtn) {
            if (state.hasMorePages && curLoadedMaxPage < totPages) {
              manualMoreBtn.style.display = "inline-flex";
              manualMoreBtn.innerHTML = "➕ Seite " + (curLoadedMaxPage + 1) + " laden";
            } else {
              manualMoreBtn.style.display = "none";
            }
          }
          const bottomPill = document.getElementById("bottomPageCounterPill");
          if (bottomPill) {
            bottomPill.innerHTML = "🎯 Seite wählen (" + visPage + " / " + totPages + ") ▾";
          }

          if (floatBtn) {
            if (!isCatalogVisible) {
              floatBtn.style.display = "none";
            } else {
              floatBtn.style.display = "inline-flex";
              floatBtn.innerHTML = '<span>📄 Seite ' + visPage + ' / ' + totPages + '</span><span style="font-size:10px;opacity:0.8">▾</span>';
            }
          }
        }

        if (pulseActive && floatBtn && isCatalogVisible) {
          if (!floatBtn.classList.contains("is-scrolling-active")) {
            floatBtn.classList.add("is-scrolling-active");
          }
          if (smartPageIndicatorIdleTimer) clearTimeout(smartPageIndicatorIdleTimer);
          smartPageIndicatorIdleTimer = setTimeout(() => {
            floatBtn.classList.remove("is-scrolling-active");
          }, 1400);
        }
      }

      let pendingModalJumpPage = 1;

      function updatePageJumpModalDomValueClient(nextVal) {
        const totPages = Math.max(1, Number(state.totalPages) || 1);
        pendingModalJumpPage = Math.max(1, Math.min(totPages, Math.round(Number(nextVal) || 1)));
        const titleNumEl = document.getElementById("pageJumpLiveTargetLabel");
        if (titleNumEl) titleNumEl.textContent = "Seite " + pendingModalJumpPage + " von " + totPages;
        const sliderEl = document.getElementById("pageJumpRangeSlider");
        if (sliderEl && Number(sliderEl.value) !== pendingModalJumpPage) {
          sliderEl.value = String(pendingModalJumpPage);
        }
        const numInp = document.getElementById("pageJumpNumberInput");
        if (numInp && document.activeElement !== numInp) {
          numInp.value = String(pendingModalJumpPage);
        }
        const confirmBtn = document.getElementById("pageJumpConfirmBtn");
        if (confirmBtn) {
          confirmBtn.innerHTML = "🚀 Zu Seite " + pendingModalJumpPage + " springen";
        }
      }

      function adjustPageJumpModalValueClient(deltaOrTarget, isAbsolute = false) {
        triggerTmaHapticClient("selection");
        const nextVal = isAbsolute ? Number(deltaOrTarget) : (pendingModalJumpPage + Number(deltaOrTarget));
        updatePageJumpModalDomValueClient(nextVal);
      }

      function closePageJumpModalClient() {
        const dialogRoot = document.getElementById("customDialogRoot");
        if (dialogRoot) dialogRoot.innerHTML = "";
        const inHero = Boolean(document.body && document.body.classList.contains("in-hero-slider"));
        const returnBtn = inHero
          ? (document.getElementById("heroBtnTrailer") || document.getElementById("heroBtnDetails"))
          : (document.querySelector("#resultsGridContainer .card.spatial-focus, #resultsGridContainer .card") || document.getElementById("smartPageIndicatorBtn") || document.getElementById("sectionPageCounterPill"));
        if (returnBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(returnBtn, false);
        }
      }

      async function confirmPageJumpModalClient(targetOverride = null) {
        const targetP = targetOverride !== null ? Number(targetOverride) : pendingModalJumpPage;
        const dialogRoot = document.getElementById("customDialogRoot");
        if (dialogRoot) dialogRoot.innerHTML = "";
        triggerTmaHapticClient("medium");
        // Falls die Seite bereits im aktuellen Endlos-Grid geladen ist, direkt weich zur ersten Karte dieser Seite scrollen!
        const firstCardOnPage = document.querySelector('#resultsGridContainer .card[data-page-num="' + targetP + '"]');
        if (firstCardOnPage) {
          if (!heroCurtainScrolledToCatalog && !state.heroHidden && !state.isSearchMode) {
            animateHeroCatalogSnapScrollClient(getHeroCatalogSnapScrollYClient());
          }
          state.visibleCatalogPage = targetP;
          syncSmartPageIndicatorDomClient(true);
          if (typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstCardOnPage, true);
          } else {
            firstCardOnPage.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          return;
        }
        if (typeof jumpToPage === "function") {
          await jumpToPage(targetP);
        }
      }

      function openPageJumpModalClient() {
        const totPages = Math.max(1, Number(state.totalPages) || 1);
        if (totPages <= 1) return;
        triggerTmaHapticClient("light");
        const curPage = Math.max(1, Math.min(totPages, Number(state.visibleCatalogPage || state.page) || 1));
        const curLoadedMax = Math.max(1, Number(state.page) || 1);
        const startLoaded = Math.max(1, Math.min(curLoadedMax, Number(state.startPage) || 1));
        pendingModalJumpPage = curPage;
        const dialogRoot = document.getElementById("customDialogRoot");
        if (!dialogRoot) return;

        // 1-Klick-Schnellwahl-Seiten (Anfang, Nachbarseiten, Mitte, Ende) berechnen
        const quickSet = new Set([1, totPages]);
        if (totPages >= 4) quickSet.add(Math.max(1, Math.round(totPages / 2)));
        if (totPages >= 8) {
          quickSet.add(Math.max(1, Math.round(totPages * 0.25)));
          quickSet.add(Math.max(1, Math.round(totPages * 0.75)));
        }
        for (let d = -2; d <= 2; d++) {
          const p = curPage + d;
          if (p >= 1 && p <= totPages) quickSet.add(p);
        }
        const quickPages = Array.from(quickSet).sort((a, b) => a - b);
        const quickButtonsHtml = quickPages.map(p =>
          '<button type="button" class="page-jump-btn ' + (p === curPage ? 'active' : '') + '" onclick="confirmPageJumpModalClient(' + p + ')" title="Direkt zu Seite ' + p + ' springen">' +
            (p === 1 && curPage !== 1 ? '⏮ 1' : (p === totPages && curPage !== totPages ? (totPages + ' ⏭') : p)) +
          '</button>'
        ).join("");

        const loadedRangeText = startLoaded === curLoadedMax
          ? ("Seite " + startLoaded + " im Stream geladen")
          : ("Seiten " + startLoaded + "–" + curLoadedMax + " im Stream geladen");

        dialogRoot.innerHTML =
          '<div class="page-jump-modal-backdrop" onclick="if(event.target===this)closePageJumpModalClient()">' +
            '<div class="page-jump-modal-box" role="dialog" aria-modal="true" aria-label="Seiten-Schnellwahl">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid rgba(148,163,184,0.18);padding-bottom:10px">' +
                '<div>' +
                  '<div style="font-size:14px;font-weight:900;color:#f8fafc">🎯 Seiten-Schnellwahl</div>' +
                  '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' + loadedRangeText + ' • ' + totPages + ' Seiten gesamt</div>' +
                '</div>' +
                '<button type="button" class="btn" style="padding:4px 10px" onclick="closePageJumpModalClient()" title="Schließen">✕</button>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px">' +
                '<div style="font-size:11px;color:#94a3b8;font-weight:800;letter-spacing:0.3px">⚡ DIREKT-SPRUNG (1 KLICK)</div>' +
                '<div class="page-jump-row" style="justify-content:flex-start">' + quickButtonsHtml + '</div>' +
              '</div>' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(15,23,42,0.75);padding:10px 12px;border-radius:12px;border:1px solid rgba(56,189,248,0.28)">' +
                '<div>' +
                  '<div style="font-size:11px;color:#94a3b8;font-weight:700">ZIELSEITE WÄHLEN</div>' +
                  '<div id="pageJumpLiveTargetLabel" style="font-size:17px;font-weight:900;color:#38bdf8;margin-top:2px">Seite ' + curPage + ' von ' + totPages + '</div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:6px">' +
                  '<span style="font-size:11.5px;color:#cbd5e1;font-weight:700">Nr.:</span>' +
                  '<input id="pageJumpNumberInput" type="number" min="1" max="' + totPages + '" value="' + curPage + '" class="page-jump-number-inp" oninput="updatePageJumpModalDomValueClient(this.value)" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();confirmPageJumpModalClient(this.value);}" />' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px">' +
                '<input id="pageJumpRangeSlider" type="range" min="1" max="' + totPages + '" value="' + curPage + '" class="page-jump-slider" oninput="updatePageJumpModalDomValueClient(this.value)" />' +
                '<div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;font-weight:700">' +
                  '<span>Seite 1</span>' +
                  '<span>Mitte (' + Math.max(1, Math.round(totPages / 2)) + ')</span>' +
                  '<span>Seite ' + totPages + '</span>' +
                '</div>' +
              '</div>' +
              '<div class="page-step-grid">' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(1, true)">⏮ 1</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(-10, false)">-10</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(-5, false)">-5</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(-1, false)">-1</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(1, false)">+1</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(5, false)">+5</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(10, false)">+10</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(' + totPages + ', true)">' + totPages + ' ⏭</button>' +
              '</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">' +
                '<button type="button" id="pageJumpConfirmBtn" class="btn blue" style="flex:1;padding:10px 14px;font-size:13px;font-weight:900;justify-content:center" onclick="confirmPageJumpModalClient()">🚀 Zu Seite ' + curPage + ' springen</button>' +
                (curPage > 1 ? '<button type="button" class="btn" style="padding:10px 12px;font-size:12px" onclick="confirmPageJumpModalClient(1)">⬆ Seite 1</button>' : '') +
              '</div>' +
            '</div>' +
          '</div>';
        const confirmBtn = document.getElementById("pageJumpConfirmBtn");
        if (confirmBtn && typeof jumpSpatialFocus === "function") {
          setTimeout(() => jumpSpatialFocus(confirmBtn, false), 30);
        }
      }

      async function preloadHeroSlidesAndUnlockCoversClient() {
        const mySeq = ++heroWaterfallSeq;
        const gridEl = document.getElementById("resultsGridContainer");
        observeLazyCoversInContainerClient(gridEl || document);
        ensureInfiniteScrollSentinelObserverClient();
        ensureCatalogPageTrackObserverClient(gridEl);
        syncSmartPageIndicatorDomClient(false);

        const sliderIsActiveFront = Boolean(
          !state.isSearchMode &&
          !state.heroHidden &&
          (!state.currentView || state.currentView === "discover") &&
          Array.isArray(state.heroSlides) &&
          state.heroSlides.length > 0 &&
          !heroCurtainScrolledToCatalog
        );

        if (!sliderIsActiveFront) {
          unlockCatalogCoversLoadingClient(true);
          return;
        }

        // Stufe 1: Zuerst exklusiv Slide 1 laden (Katalog-Cover warten kurz, sofern der Nutzer nicht bereits runterscrollt)
        catalogCoversUnlocked = false;
        const slidesSnapshot = state.heroSlides.slice();
        await preloadHeroSlideAssetsPairClient(slidesSnapshot[0], true);
        if (mySeq !== heroWaterfallSeq) return;

        // Stufe 2: Ab Slide 2 parallel die komplette 1. Seite der Katalog-Cover vorladen + IntersectionObserver freischalten,
        // während Slide 2 -> Slide 3 -> ... nacheinander im Hintergrund geladen werden!
        unlockCatalogCoversLoadingClient(true);
        for (let i = 1; i < slidesSnapshot.length; i++) {
          if (mySeq !== heroWaterfallSeq) return;
          await preloadHeroSlideAssetsPairClient(slidesSnapshot[i], false);
        }
      }

      let catalogWindowScrollRafPending = false;
      window.addEventListener("scroll", () => {
        if (catalogWindowScrollRafPending) return;
        catalogWindowScrollRafPending = true;
        requestAnimationFrame(() => {
          catalogWindowScrollRafPending = false;
          const y = window.scrollY || window.pageYOffset || 0;
          if (typeof syncHeroScrollFadeAndTopBarStateClient === "function") {
            syncHeroScrollFadeAndTopBarStateClient();
          }
          if (y > 8 || heroCurtainScrolledToCatalog) {
            if (!catalogCoversUnlocked) {
              unlockCatalogCoversLoadingClient(true);
            }
            syncSmartPageIndicatorDomClient(true);
          } else {
            syncSmartPageIndicatorDomClient(false);
          }
        });
      }, { passive: true });

      function setHeroPointerHover(isHovered) {
        heroPointerHovered = Boolean(isHovered);
      }

      function formatCollapsedHeroSearchPlaceholderClient(hero, isCompactMobilePill) {
        if (!hero) return isCompactMobilePill ? "Suchen…" : "Film, Serie, Studio, Person oder (Jahr)...";
        const heroType = hero.media_type === "tv" || state.type === "s" ? "s" : "m";
        const isMovie = heroType === "m";
        const titleRaw = String(hero.title || hero.name || "").trim();
        if (!titleRaw) return isCompactMobilePill ? "Suchen…" : "Film, Serie, Studio, Person oder (Jahr)...";
        if (isCompactMobilePill) {
          return "💡 " + titleRaw;
        }
        const voteStr = hero.vote_average ? ("★ " + hero.vote_average.toFixed(1)) : "";
        const yearStr = String(hero.release_date || hero.first_air_date || "").slice(0, 4);
        const typeLabel = isMovie ? "Film" : "Serie";
        const genreItems = typeof resolveHeroGenreItemsClient === "function"
          ? resolveHeroGenreItemsClient(hero, isMovie).slice(0, 2)
          : [];
        const genreStr = genreItems.length ? genreItems.map(g => g.name).join(", ") : "";
        const metaParts = [voteStr, yearStr, typeLabel, genreStr].filter(Boolean);
        return "💡 " + titleRaw + (metaParts.length ? (" · " + metaParts.join(" · ")) : "") + " — Tippen zum Suchen…";
      }

      function isMobileCompactSearchPillActiveClient() {
        const w = window.innerWidth || document.documentElement.clientWidth || 1024;
        if (w > 760) return false;
        const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
        return !(hdr && hdr.classList.contains("mobile-search-expanded"));
      }

      function isUserInHeroSliderFront() {
        if (!document.body) return false;
        if (state.heroHidden || state.isSearchMode) return false;
        if (state.currentView && state.currentView !== "discover") return false;
        if (!Array.isArray(state.heroSlides) || state.heroSlides.length === 0) return false;
        if (heroCurtainScrolledToCatalog || document.body.classList.contains("hero-scrolled-past")) return false;
        const y = window.scrollY || window.pageYOffset || 0;
        return y <= 20;
      }

      function syncHeroSearchPlaceholderAndToggleBtnClient() {
        if (document.body) {
          document.body.classList.toggle("in-hero-slider", isUserInHeroSliderFront());
        }
        const hideBtn = document.getElementById("heroHideBtn");
        const isCollapsed = Boolean(state.heroHidden);
        const isScrolledPast = Boolean(document.body && document.body.classList.contains("hero-scrolled-past"));
        const showCompactSpotlightHint = isCollapsed || isScrolledPast;
        if (hideBtn) {
          hideBtn.classList.toggle("is-collapsed-state", showCompactSpotlightHint);
          hideBtn.setAttribute("aria-expanded", showCompactSpotlightHint ? "false" : "true");
          hideBtn.setAttribute(
            "title",
            showCompactSpotlightHint
              ? "Kino-Spotlight oben anzeigen"
              : "Kino-Spotlight sanft nach oben einklappen"
          );
          hideBtn.innerHTML = showCompactSpotlightHint
            ? '<span class="top-btn-icon">▾</span><span class="top-btn-label"> Spotlight</span>'
            : '<span class="top-btn-icon">▴</span><span class="top-btn-label"> Einklappen</span>';
        }
        const inp = document.getElementById("searchInput");
        if (!inp) return;
        const compactPill = isMobileCompactSearchPillActiveClient();
        const onCatalogDiscover = (!state.currentView || state.currentView === "discover") && !state.isSearchMode;
        if (showCompactSpotlightHint && onCatalogDiscover && Array.isArray(state.heroSlides) && state.heroSlides.length > 0) {
          const hero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
          inp.placeholder = formatCollapsedHeroSearchPlaceholderClient(hero, compactPill);
          inp.classList.add("hero-placeholder-active");
          const bpUrl = resolveHeroSlideBackdropUrlClient(hero);
          if (bpUrl) applyDynamicHeroAmbilightClient(bpUrl);
        } else {
          inp.placeholder = compactPill ? "Suchen…" : "Film, Serie, Studio, Person oder (Jahr)...";
          inp.classList.remove("hero-placeholder-active");
        }
      }

      let windowResizeDebounceTimer = null;
      window.addEventListener("resize", () => {
        if ((window.innerWidth || 1024) > 760) {
          const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
          if (hdr) hdr.classList.remove("mobile-search-expanded");
        }
        if (windowResizeDebounceTimer) clearTimeout(windowResizeDebounceTimer);
        windowResizeDebounceTimer = setTimeout(() => {
          windowResizeDebounceTimer = null;
          syncHeroSearchPlaceholderAndToggleBtnClient();
          syncExpandableDescriptionsOverflowClient();
        }, 90);
      }, { passive: true });

      let heroWheelDownAccum = 0;
      let heroWheelUpAccum = 0;
      let heroWheelDecayTimer = null;
      let heroSnapAnimatingUntil = 0;
      let heroTouchSettleTimer = null;
      let heroSpringRafId = 0;
      let heroMomentumDrainActive = false;
      let heroMomentumDrainDir = 0;
      let heroLastWheelEventAt = 0;
      let heroPageTouchActive = false;
      let heroTouchStartTime = 0;
      let heroTouchStartScrollY = 0;
      let heroLastCatalogScrollY = 0;
      let heroCurrentZone = 0; // 0 = Vollbild-Slider (Vorhang offen), 1 = Katalog-Cover (Vorhang weggeglitten, Cover starten bei scrollY=0)
      let heroCurtainScrolledToCatalog = false;

      function getHeroCatalogSnapScrollYClient() {
        const stageWrap = document.getElementById("heroStageWrapEl");
        const topBarH = (document.getElementById("topUnifiedBar")?.offsetHeight) || 54;
        const heroH = (stageWrap && stageWrap.offsetHeight > 120) ? stageWrap.offsetHeight : (window.innerHeight || 640);
        return Math.max(200, heroH - topBarH);
      }

      function isAnySideMenuOpenClient() {
        if (state.sidebarOpen) return true;
        if (document.getElementById("filterSidebarDrawer")?.classList.contains("open")) return true;
        const elev = document.getElementById("tvQuickJumpElevator");
        if (elev && (
          elev.classList.contains("has-subpanel") ||
          elev.classList.contains("is-visible") ||
          elev.classList.contains("is-hover-expanded") ||
          (typeof elev.matches === "function" && elev.matches(":hover"))
        )) {
          return true;
        }
        return false;
      }

      window.addEventListener("wheel", (ev) => {
        if (!isAnySideMenuOpenClient()) return;
        const scrollHost = ev.target && typeof ev.target.closest === "function"
          ? ev.target.closest(".sidebar-body, .sidebar-right-subpanel, .rm-entries-scroll")
          : null;
        if (!scrollHost) {
          ev.preventDefault();
          return;
        }
        const dy = Number(ev.deltaY) || 0;
        const atTop = scrollHost.scrollTop <= 0 && dy < 0;
        const atBottom = (scrollHost.scrollTop + scrollHost.clientHeight >= scrollHost.scrollHeight - 1) && dy > 0;
        if (atTop || atBottom) {
          ev.preventDefault();
        }
      }, { passive: false });

      window.addEventListener("touchmove", (ev) => {
        if (!isAnySideMenuOpenClient()) return;
        const scrollHost = ev.target && typeof ev.target.closest === "function"
          ? ev.target.closest(".sidebar-body, .sidebar-right-subpanel, .rm-entries-scroll")
          : null;
        if (!scrollHost) {
          ev.preventDefault();
        }
      }, { passive: false });

      function isHeroScrollCouplingActiveClient() {
        if (!document.body || state.heroHidden || state.isSearchMode) return false;
        if (state.currentView && state.currentView !== "discover") return false;
        if (!Array.isArray(state.heroSlides) || state.heroSlides.length === 0) return false;
        if (isAnySideMenuOpenClient()) return false;
        if (document.getElementById("modalRoot")?.innerHTML.trim()) return false;
        if (document.getElementById("lightboxRoot")?.innerHTML.trim()) return false;
        if (document.getElementById("customDialogRoot")?.innerHTML.trim()) return false;
        if (document.getElementById("searchGenreDropdownOverlay")?.classList.contains("open")) return false;
        if (document.getElementById("searchAutocompleteBox")?.classList.contains("open")) return false;
        return true;
      }

      // Echte DOM-Überlaufmessung für 3-Zeilen-Clamp: "▾ Mehr lesen" erscheint NUR, wenn Text wirklich abgeschnitten ist
      function syncExpandableDescriptionsOverflowClient(rootEl) {
        const scope = rootEl || document;
        if (!scope) return;
        const boxes = (scope.classList && scope.classList.contains("expandable-desc-box"))
          ? [scope]
          : Array.from(scope.querySelectorAll ? scope.querySelectorAll(".expandable-desc-box") : []);
        for (const box of boxes) {
          const scrollEl = box.querySelector(".expandable-desc-scroll");
          if (!scrollEl) continue;
          if (box.classList.contains("is-expanded")) {
            box.classList.add("is-long-desc");
            continue;
          }
          const isTruncated = (scrollEl.scrollHeight - scrollEl.clientHeight) > 2;
          box.classList.toggle("is-long-desc", isTruncated);
          if (isTruncated) {
            box.setAttribute("title", "Klicken oder Enter für vollständige Beschreibung");
          } else {
            box.removeAttribute("title");
          }
        }
      }

      function toggleExpandableDescriptionClient(ev, boxId) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const box = document.getElementById(boxId);
        if (!box) return;
        const scrollEl = box.querySelector(".expandable-desc-scroll");
        if (!box.classList.contains("is-expanded")) {
          const isTruncated = scrollEl ? ((scrollEl.scrollHeight - scrollEl.clientHeight) > 2) : box.classList.contains("is-long-desc");
          if (!isTruncated) {
            box.classList.remove("is-long-desc");
            return;
          }
          box.classList.add("is-long-desc");
        }
        triggerTmaHapticClient("light");
        const willExpand = !box.classList.contains("is-expanded");
        box.classList.toggle("is-expanded", willExpand);
        box.setAttribute("aria-expanded", willExpand ? "true" : "false");
        const hintEl = box.querySelector(".desc-expand-hint");
        if (hintEl) {
          hintEl.textContent = willExpand ? "▴ Einklappen" : "▾ Mehr lesen";
        }
        if (scrollEl && !willExpand) {
          scrollEl.scrollTop = 0;
          requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(box));
        }
      }

      function clearHeroDescTransientFocusClient() {
        const descEl = document.getElementById("heroDescEl");
        if (!descEl) return;
        descEl.classList.remove("spatial-focus");
        if (document.activeElement === descEl && typeof descEl.blur === "function") {
          try { descEl.blur(); } catch (_e) {}
        }
        if (typeof currentSpatialEl !== "undefined" && currentSpatialEl === descEl) {
          currentSpatialEl = null;
        }
      }

      function setHeroRubberBandOffsetClient(px) {
        const stageWrap = document.getElementById("heroStageWrapEl");
        if (stageWrap) {
          stageWrap.style.setProperty("--hero-rubber-y", Math.round(px) + "px");
        }
      }

      function setCatalogRubberBandOffsetClient(px, isDragging) {
        const catSec = document.querySelector("#heroBannerSlot + .section");
        if (catSec) {
          catSec.classList.toggle("is-rubber-dragging", Boolean(isDragging && px !== 0));
          catSec.style.setProperty("--catalog-rubber-y", Math.round(px) + "px");
        }
      }

      function resetHeroResistancePreviewClient() {
        heroWheelDownAccum = 0;
        heroWheelUpAccum = 0;
        setHeroRubberBandOffsetClient(0);
        setCatalogRubberBandOffsetClient(0, false);
        const hintBtn = document.getElementById("heroScrollDownHintBtn");
        if (hintBtn) {
          hintBtn.style.transform = "";
        }
        syncHeroScrollFadeAndTopBarStateClient();
      }

      function cancelHeroSpringScrollClient() {
        if (heroSpringRafId) {
          cancelAnimationFrame(heroSpringRafId);
          heroSpringRafId = 0;
        }
      }

      let heroBounceLockUntil = 0;
      let heroBounceLockTimer = null;
      const HERO_BOUNCE_LOCK_VELOCITY = 1.15; // px/ms
      const HERO_BOUNCE_LOCK_MIN_DIST = 34; // px
      const HERO_BOUNCE_LOCK_COOLDOWN_MS = 400; // ms

      // Vorhang-Bühnen-Übergang: Slider gleitet als Vorhang weg, Filmcover starten physisch bei scrollY = 0 (kein Nachruckeln!)
      // Unterstützt zusätzlich Bounce-Lock ({ bounceLock: true }): bricht bei zu schnellem Wischen die Animation sofort ab und fixiert den Endzustand für 400ms.
      function animateHeroCatalogSnapScrollClient(targetY, opts) {
        const isBounceLock = Boolean(opts && opts.bounceLock);
        cancelHeroSpringScrollClient();
        heroWheelDownAccum = 0;
        heroWheelUpAccum = 0;
        if (heroWheelDecayTimer) {
          clearTimeout(heroWheelDecayTimer);
          heroWheelDecayTimer = null;
        }
        if (heroTouchSettleTimer) {
          clearTimeout(heroTouchSettleTimer);
          heroTouchSettleTimer = null;
        }
        setHeroRubberBandOffsetClient(0);
        setCatalogRubberBandOffsetClient(0, false);
        clearHeroDescTransientFocusClient();
        const stageWrap = document.getElementById("heroStageWrapEl");
        if (stageWrap) {
          stageWrap.style.setProperty("--hero-scroll-fade", "0");
          stageWrap.style.setProperty("--hero-rubber-y", "0px");
        }
        const hintBtn = document.getElementById("heroScrollDownHintBtn");
        if (hintBtn) hintBtn.style.transform = "";

        const goingToCatalog = Number(targetY) > 10;
        const zoneChanged = heroCurtainScrolledToCatalog !== goingToCatalog;
        heroCurtainScrolledToCatalog = goingToCatalog;
        heroCurrentZone = goingToCatalog ? 1 : 0;
        heroLastCatalogScrollY = 0;

        if (zoneChanged) {
          triggerTmaHapticClient(isBounceLock ? "heavy" : "medium");
        }

        const nowMs = Date.now();
        heroMomentumDrainActive = true;
        heroMomentumDrainDir = goingToCatalog ? 1 : -1;
        heroLastWheelEventAt = nowMs;
        heroSnapAnimatingUntil = nowMs + (isBounceLock ? HERO_BOUNCE_LOCK_COOLDOWN_MS : 420);

        const curtainEl = document.getElementById("heroCurtainShell");
        const catSecEl = document.querySelector("#heroBannerSlot + .section");
        if (isBounceLock) {
          heroBounceLockUntil = performance.now() + HERO_BOUNCE_LOCK_COOLDOWN_MS;
          if (heroBounceLockTimer) {
            clearTimeout(heroBounceLockTimer);
            heroBounceLockTimer = null;
          }
          if (curtainEl) curtainEl.classList.add("is-bounce-locked");
          if (catSecEl) catSecEl.classList.add("is-bounce-locked");
          heroBounceLockTimer = setTimeout(() => {
            if (curtainEl) curtainEl.classList.remove("is-bounce-locked");
            if (catSecEl) catSecEl.classList.remove("is-bounce-locked");
            heroBounceLockTimer = null;
          }, HERO_BOUNCE_LOCK_COOLDOWN_MS);
        }

        if (goingToCatalog) {
          if (typeof stopHeroBackgroundVideoTeaserClient === "function") {
            stopHeroBackgroundVideoTeaserClient();
          }
          if (document.body) {
            document.body.classList.add("hero-scrolled-past", "page-scrolled");
          }
          if (curtainEl) {
            curtainEl.classList.add("is-collapsed");
          }
          if ((window.scrollY || window.pageYOffset || 0) !== 0) {
            window.scrollTo(0, 0);
          }
          unlockCatalogCoversLoadingClient(true);
          syncSmartPageIndicatorDomClient(true);
          if (typeof focusFirstResultCard === "function") {
            const curEl = typeof currentSpatialEl !== "undefined" ? currentSpatialEl : null;
            if (!curEl || (curEl.closest && (curEl.closest(".hero") || curEl.closest("#heroBannerSlot")))) {
              focusFirstResultCard(false);
            }
          }
          // Sobald der Nutzer vom Slider nach unten zu den Covern scrollt, direkt die nächste Seite im Hintergrund vorladen!
          if (state.hasMorePages && !state.loadingMore && Number(state.page || 1) === Number(state.startPage || 1) && typeof loadMoreResults === "function") {
            setTimeout(() => {
              if (heroCurtainScrolledToCatalog && state.hasMorePages && !state.loadingMore) {
                loadMoreResults(true);
              }
            }, 120);
          }
        } else {
          if (document.body) {
            document.body.classList.remove("hero-scrolled-past", "page-scrolled");
            if (!state.heroHidden && !state.isSearchMode && state.currentView === "discover") {
              document.body.classList.add("in-hero-slider");
            }
          }
          if (curtainEl && !state.heroHidden) {
            curtainEl.classList.remove("is-collapsed");
          }
          if ((window.scrollY || window.pageYOffset || 0) !== 0) {
            window.scrollTo(0, 0);
          }
          syncSmartPageIndicatorDomClient(false);
          requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient());
          if (typeof scheduleHeroBackgroundVideoTeaserClient === "function") {
            scheduleHeroBackgroundVideoTeaserClient(false);
          }
        }
        syncHeroScrollFadeAndTopBarStateClient();
        syncHeroSearchPlaceholderAndToggleBtnClient();
        syncSmartPageIndicatorDomClient(goingToCatalog);
      }

      let heroLastHorizWheelAt = 0;

      function onHeroCatalogWheelClient(ev) {
        if (!isHeroScrollCouplingActiveClient()) return;
        const targetEl = ev.target;
        if (targetEl && typeof targetEl.closest === "function") {
          const expDesc = targetEl.closest(".expandable-desc-box.is-expanded");
          if (expDesc) {
            const sc = expDesc.querySelector(".expandable-desc-scroll");
            if (sc && sc.scrollHeight > sc.clientHeight + 2) {
              return;
            }
          }
        }
        const now = Date.now();
        // Linux Firefox sendet bei Mausrädern/Trackpads häufig deltaMode === 1 (DOM_DELTA_LINE statt Pixel) -> auf Pixel-Skala normieren!
        const deltaMult = ev.deltaMode === 1 ? 24 : (ev.deltaMode === 2 ? 360 : 1);
        const rawDx = (Number(ev.deltaX) || 0) * deltaMult;
        const rawDy = (Number(ev.deltaY) || 0) * deltaMult;
        const dx = Math.abs(rawDx) > 0.5 ? rawDx : (ev.shiftKey ? rawDy : 0);
        const dy = ev.shiftKey && Math.abs(rawDx) <= 0.5 ? 0 : rawDy;

        // Horizontal Wheel / Trackpad Scroll Left & Right im geöffneten Slider: Blättert direkt durch die Slides!
        if (!heroCurtainScrolledToCatalog && !state.heroHidden && Array.isArray(state.heroSlides) && state.heroSlides.length > 1) {
          if (Math.abs(dx) >= 14 && Math.abs(dx) > Math.abs(dy) * 1.15) {
            ev.preventDefault();
            if (now - heroLastHorizWheelAt >= 260) {
              heroLastHorizWheelAt = now;
              triggerTmaHapticClient("selection");
              setHeroSlideIndex(state.heroIndex + (dx > 0 ? 1 : -1));
            }
            return;
          }
        }

        const gapMs = now - heroLastWheelEventAt;
        heroLastWheelEventAt = now;

        if (now < heroSnapAnimatingUntil) {
          ev.preventDefault();
          return;
        }
        if (heroMomentumDrainActive) {
          const sameDirection = (heroMomentumDrainDir > 0 && dy > 0) || (heroMomentumDrainDir < 0 && dy < 0);
          if (sameDirection && gapMs < 130) {
            ev.preventDefault();
            return;
          }
          heroMomentumDrainActive = false;
          heroMomentumDrainDir = 0;
        }

        if (Math.abs(dy) < 1) return;

        const y = window.scrollY || window.pageYOffset || 0;
        const DOWN_THRESHOLD = 105;
        const UP_THRESHOLD = 105;

        // 1. Zone 0 (Vollbild-Slider offen): Sanfter, angenehm erreichbarer Übergang zum Katalog (DOWN_THRESHOLD = 105)
        if (!heroCurtainScrolledToCatalog) {
          if (dy > 0) {
            ev.preventDefault();
            heroWheelUpAccum = 0;
            const velocityBoost = Math.abs(dy) > 55 ? 1.12 : 0.85;
            const step = Math.min(78, Math.max(12, Math.abs(dy) * velocityBoost));
            heroWheelDownAccum += step;

            if (heroWheelDecayTimer) clearTimeout(heroWheelDecayTimer);
            if (heroWheelDownAccum >= DOWN_THRESHOLD) {
              animateHeroCatalogSnapScrollClient(getHeroCatalogSnapScrollYClient());
              return;
            }

            const ratio = Math.min(1, heroWheelDownAccum / DOWN_THRESHOLD);
            const rubberOffset = -Math.round(Math.pow(ratio, 0.85) * 34);
            setHeroRubberBandOffsetClient(rubberOffset);
            const stageWrap = document.getElementById("heroStageWrapEl");
            if (stageWrap) {
              stageWrap.style.setProperty("--hero-scroll-fade", (ratio * 0.32).toFixed(3));
            }
            const hintBtn = document.getElementById("heroScrollDownHintBtn");
            if (hintBtn) {
              hintBtn.style.transform = "translate3d(0, " + Math.round(ratio * 10) + "px, 0) scale(" + (1 + ratio * 0.14).toFixed(2) + ")";
            }
            heroWheelDecayTimer = setTimeout(resetHeroResistancePreviewClient, 240);
          }
          return;
        }

        // 2. Zone 1 (Katalog-Cover bei scrollY = 0): Am oberen Rand erfordert Weiter-Hochscrollen ebenfalls spürbaren Gummiband-Widerstand (UP_THRESHOLD = 210)
        if (heroCurtainScrolledToCatalog && y <= 6 && dy < 0) {
          ev.preventDefault();
          heroWheelDownAccum = 0;
          const velocityBoost = Math.abs(dy) > 55 ? 1.12 : 0.85;
          const step = Math.min(78, Math.max(12, Math.abs(dy) * velocityBoost));
          heroWheelUpAccum += step;

          if (heroWheelDecayTimer) clearTimeout(heroWheelDecayTimer);
          if (heroWheelUpAccum >= UP_THRESHOLD) {
            animateHeroCatalogSnapScrollClient(0);
            return;
          }

          const ratio = Math.min(1, heroWheelUpAccum / UP_THRESHOLD);
          const catalogRubber = Math.round(Math.pow(ratio, 0.85) * 32);
          setCatalogRubberBandOffsetClient(catalogRubber, true);
          heroWheelDecayTimer = setTimeout(resetHeroResistancePreviewClient, 240);
          return;
        }
      }

      let heroCatalogDraggingDown = false;
      let heroTouchLastY = 0;
      let heroTouchLastTime = 0;
      let heroTouchInstantVy = 0;

      window.addEventListener("wheel", onHeroCatalogWheelClient, { passive: false });
      window.addEventListener("touchstart", (ev) => {
        if (performance.now() < heroBounceLockUntil) {
          heroPageTouchActive = false;
          heroCatalogDraggingDown = false;
          return;
        }
        if (ev.target && typeof ev.target.closest === "function" && ev.target.closest(".expandable-desc-box.is-expanded")) {
          heroPageTouchActive = false;
          heroCatalogDraggingDown = false;
          return;
        }
        heroPageTouchActive = true;
        heroCatalogDraggingDown = false;
        heroTouchStartScrollY = window.scrollY || window.pageYOffset || 0;
        if (ev.touches && ev.touches[0]) {
          heroTouchStartX = ev.touches[0].clientX;
          heroTouchStartY = ev.touches[0].clientY;
          heroTouchLastY = ev.touches[0].clientY;
          heroTouchStartTime = performance.now();
          heroTouchLastTime = heroTouchStartTime;
          heroTouchInstantVy = 0;
        }
      }, { passive: true });

      // Aktiver TouchMove-Wächter am oberen Katalogrand (scrollY <= 6):
      // Blockiert Browser-Pull-to-Refresh ("Seite aktualisieren") sofort, baut Gummiband-Widerstand auf und löst bei zu schnellem Wischen direkt den Bounce-Lock aus!
      window.addEventListener("touchmove", (ev) => {
        if (!heroPageTouchActive || !ev.touches || !ev.touches[0]) return;
        const nowPerf = performance.now();
        if (nowPerf < heroBounceLockUntil) {
          heroPageTouchActive = false;
          heroCatalogDraggingDown = false;
          setCatalogRubberBandOffsetClient(0, false);
          return;
        }
        if (ev.target && typeof ev.target.closest === "function" && ev.target.closest(".expandable-desc-box.is-expanded")) {
          return;
        }
        if (!heroCurtainScrolledToCatalog || !isHeroScrollCouplingActiveClient() || Date.now() < heroSnapAnimatingUntil) return;
        const curY = window.scrollY || window.pageYOffset || 0;
        const curTouchY = ev.touches[0].clientY;
        const dx = ev.touches[0].clientX - (heroTouchStartX || ev.touches[0].clientX);
        const dy = curTouchY - (heroTouchStartY || curTouchY);
        const stepDt = Math.max(8, nowPerf - (heroTouchLastTime || nowPerf));
        const totalDt = Math.max(12, nowPerf - (heroTouchStartTime || nowPerf));
        const instVy = (curTouchY - (heroTouchLastY || curTouchY)) / stepDt;
        const avgVy = dy / totalDt;
        heroTouchInstantVy = Math.abs(instVy) > Math.abs(avgVy) ? instVy : avgVy;
        heroTouchLastY = curTouchY;
        heroTouchLastTime = nowPerf;

        if ((curY <= 6 || heroCatalogDraggingDown) && dy > 4 && dy > Math.abs(dx) * 1.05) {
          if (ev.cancelable) {
            ev.preventDefault();
          }
          // Mid-Gesture Bounce-Lock (Vollständig geöffnet): Bei zu schnellem Wischen nach unten sofort Animation abbrechen & Slider fixieren!
          if (dy >= HERO_BOUNCE_LOCK_MIN_DIST && heroTouchInstantVy >= HERO_BOUNCE_LOCK_VELOCITY && dy > Math.abs(dx) * 1.15) {
            heroPageTouchActive = false;
            heroCatalogDraggingDown = false;
            setCatalogRubberBandOffsetClient(0, false);
            animateHeroCatalogSnapScrollClient(0, { bounceLock: true });
            return;
          }
          heroCatalogDraggingDown = true;
          // Logarithmische Gummiband-Kurve: spürbarer Widerstand beim Ziehen nach unten an der Katalog-Oberkante
          const rubberPx = Math.round(Math.min(38, Math.pow(Math.max(0, dy - 4), 0.76) * 1.28));
          setCatalogRubberBandOffsetClient(rubberPx, true);
        } else if (heroCatalogDraggingDown && dy <= 0) {
          heroCatalogDraggingDown = false;
          setCatalogRubberBandOffsetClient(0, false);
        }
      }, { passive: false });

      window.addEventListener("touchend", (ev) => {
        const wasDraggingCatalogDown = heroCatalogDraggingDown;
        heroPageTouchActive = false;
        heroCatalogDraggingDown = false;
        setCatalogRubberBandOffsetClient(0, false);

        if (performance.now() < heroBounceLockUntil) return;
        if (!isHeroScrollCouplingActiveClient() || Date.now() < heroSnapAnimatingUntil) return;
        const curY = window.scrollY || window.pageYOffset || 0;

        // Katalog -> Vollbild-Slider: Erst wenn der Gummiband-Widerstand überwunden wurde (dy >= 88px ODER kräftiger Flick dy >= 48px mit vy >= 0.55)
        if (heroCurtainScrolledToCatalog && (curY <= 8 || wasDraggingCatalogDown)) {
          const dyTouch = (ev.changedTouches && ev.changedTouches[0] && heroTouchStartY)
            ? (ev.changedTouches[0].clientY - heroTouchStartY)
            : 0;
          const dxTouch = (ev.changedTouches && ev.changedTouches[0] && heroTouchStartX)
            ? (ev.changedTouches[0].clientX - heroTouchStartX)
            : 0;
          const dtTouch = Math.max(16, performance.now() - (heroTouchStartTime || performance.now()));
          const avgVyTouch = dyTouch / dtTouch;
          const vyTouch = Math.abs(heroTouchInstantVy) > Math.abs(avgVyTouch) ? heroTouchInstantVy : avgVyTouch;
          if (dyTouch >= HERO_BOUNCE_LOCK_MIN_DIST && vyTouch >= HERO_BOUNCE_LOCK_VELOCITY && dyTouch > Math.abs(dxTouch) * 1.15) {
            animateHeroCatalogSnapScrollClient(0, { bounceLock: true });
            return;
          }
          if ((dyTouch >= 56 || (dyTouch >= 36 && vyTouch >= 0.45)) && dyTouch > Math.abs(dxTouch) * 1.12) {
            animateHeroCatalogSnapScrollClient(0);
          }
        }
      }, { passive: true });

      window.addEventListener("touchcancel", () => {
        heroPageTouchActive = false;
        heroCatalogDraggingDown = false;
        setCatalogRubberBandOffsetClient(0, false);
      }, { passive: true });

      function syncHeroScrollFadeAndTopBarStateClient() {
        if (!document.body) return;
        const prevInFrontHero = document.body.classList.contains("in-hero-slider");
        const inFrontHero = typeof isUserInHeroSliderFront === "function" ? isUserInHeroSliderFront() : false;
        document.body.classList.toggle("in-hero-slider", inFrontHero);
        if (inFrontHero !== prevInFrontHero && typeof syncSmartPageIndicatorDomClient === "function") {
          syncSmartPageIndicatorDomClient(false);
        }
        if (!inFrontHero && typeof stopHeroBackgroundVideoTeaserClient === "function") {
          const bgLayer = document.getElementById("heroBgVideoLayer");
          if (heroBgTeaserActiveKey || (bgLayer && bgLayer.innerHTML)) {
            stopHeroBackgroundVideoTeaserClient();
          }
        }
        const y = window.scrollY || window.pageYOffset || 0;
        document.body.classList.toggle("catalog-deep-scrolled", y > 420);
        const stageWrap = document.getElementById("heroStageWrapEl");
        if (!stageWrap || state.heroHidden || state.isSearchMode) {
          document.body.classList.toggle("page-scrolled", y > 10);
          if (stageWrap) {
            stageWrap.style.setProperty("--hero-scroll-fade", "0");
            stageWrap.style.setProperty("--hero-rubber-y", "0px");
          }
          if (document.body.classList.contains("hero-scrolled-past")) {
            document.body.classList.remove("hero-scrolled-past");
            syncHeroSearchPlaceholderAndToggleBtnClient();
          }
          return;
        }

        if (heroCurtainScrolledToCatalog) {
          heroLastCatalogScrollY = y;
          heroCurrentZone = 1;
          document.body.classList.add("page-scrolled");
          if (!document.body.classList.contains("hero-scrolled-past")) {
            document.body.classList.add("hero-scrolled-past");
            syncHeroSearchPlaceholderAndToggleBtnClient();
          }
          stageWrap.style.setProperty("--hero-scroll-fade", "0");
          return;
        }

        heroLastCatalogScrollY = 0;
        heroCurrentZone = 0;
        document.body.classList.toggle("page-scrolled", y > 10);
        if (document.body.classList.contains("hero-scrolled-past")) {
          document.body.classList.remove("hero-scrolled-past");
          syncHeroSearchPlaceholderAndToggleBtnClient();
        }
        stageWrap.style.setProperty("--hero-scroll-fade", "0");
      }

      function returnToHeroSpotlightFromCatalogClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        triggerTmaHapticClient("selection");
        if (state.heroHidden) {
          toggleHeroSliderHidden(false);
        } else {
          animateHeroCatalogSnapScrollClient(0);
        }
      }

      function scrollCatalogBackToTopOrSpotlightClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        triggerTmaHapticClient("light");
        const y = window.scrollY || window.pageYOffset || 0;
        if (y > 60) {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          returnToHeroSpotlightFromCatalogClient(ev);
        }
      }
