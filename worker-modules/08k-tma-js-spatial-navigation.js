      // =========================================================================
      // SPATIAL NAVIGATION: PFEILTASTEN, ANDROID-TV REMOTE, GAMEPAD, MAUS-HOVER & TYPE-TO-SEARCH
      // Inklusive Select-then-Jump Regel & Hero-Slider Rotations-Navigation!
      // =========================================================================
      const FOCUSABLE_SELECTOR = ".brand-logo, .btn, .sidebar-collapse-btn, .sidebar-menu-row, .top-adj-nav-btn, #topBarBackBtn, .return-last-detail-chip, .detail-collapse-btn, .detail-back-btn, .detail-adj-btn, .detail-kicker-link, .detail-meta-link, .detail-meta-studio, .detail-credit-pill, .detail-btn-play-white, .detail-btn-glass, .detail-version-select, .detail-cast-card, .detail-sim-card, .media-mode-tab, .card, .ff-tab-btn, .f-pill, .sort-chip, .sort-select, .mode-filter-select, .new-filter-select, .df-btn, .ep-title, .expandable-desc-box.is-long-desc, .expandable-desc-box.is-expanded, .hero-btn-play, .hero-btn-info, .hero-btn-wishlist, .hero-meta-year, .hero-meta-genre, .hero-circle-arrow, .hero-dot, .hero-hide-btn, .cinema-dock-btn, .cinema-dock-scrubber, .cinema-top-hud-close, .cinema-pause-center-btn, .cinema-overlay-btn, .world-portal-card, .worlds-search-input, .ac-item, .search-scope-select, .search-genre-trigger-btn, .mobile-search-collapse-btn, .genre-overlay-chip, .genre-overlay-type-btn, .genre-overlay-close-btn, #searchInput, .search-clear-btn, .search-submit-btn, .recent-chip, .recent-strip-scroll-btn, .page-counter-pill, #smartPageIndicatorBtn, .tv-elevator-btn, .rm-entry-card, .rm-ctrl-select, .rm-ctrl-input, .rm-az-chip, .page-jump-btn, .page-step-btn, .page-jump-slider, .page-jump-number-inp";
      const CARD_SUB_SELECTOR = ".card-quick-save, .card-hover-play-btn";
      let currentSpatialEl = null;
      let lastSelectJumpAt = 0;
      let userScrolledRecently = false;
      let lastElevatorReturnEl = null;
      let activeInputProfile = (document.body && document.body.getAttribute("data-tv-profile") === "firetv")
        ? "firetv"
        : (document.body && document.body.getAttribute("data-device") === "tv")
          ? "tv"
          : "keyboard";
      let lastFocusBarCardEl = null;
      let hoverFocusBarClearTimer = null;

      window.addEventListener("wheel", () => { userScrolledRecently = true; }, { passive: true });
      window.addEventListener("touchmove", () => { userScrolledRecently = true; }, { passive: true });

      function clearCardSubnavState(exceptCard = null) {
        document.querySelectorAll(".card.card-subnav-active").forEach(c => {
          if (c !== exceptCard) c.classList.remove("card-subnav-active");
        });
      }

      function isCardSubElement(el) {
        return Boolean(el && el.matches && el.matches(CARD_SUB_SELECTOR));
      }

      function isManualNoTmdbModalOpenClient() {
        const el = document.getElementById("manualNoTmdbConfirmModalOverlay");
        return Boolean(el && el.style.display && el.style.display !== "none");
      }

      function isHeroSliderBlockingCardBarClient() {
        if (typeof isUserInHeroSliderFront === "function" && isUserInHeroSliderFront()) return true;
        if (document.body) {
          if (document.body.classList.contains("in-hero-slider")) return true;
          if (document.body.classList.contains("hero-slider-expanded") && !document.body.classList.contains("hero-scrolled-past")) {
            return true;
          }
        }
        return false;
      }

      function isAnyBlockingOverlayOpenForCardBarClient() {
        if (isHeroSliderBlockingCardBarClient()) return true;
        const elev = document.getElementById("tvQuickJumpElevator");
        const isRightOverlayOpen = Boolean(
          elev && (elev.classList.contains("has-subpanel") || elev.classList.contains("is-visible") || elev.classList.contains("is-hover-expanded"))
        );
        return Boolean(
          getActiveForegroundCinemaContextClient() ||
          (state && state.sidebarOpen) ||
          isRightOverlayOpen ||
          isManualNoTmdbModalOpenClient() ||
          document.getElementById("subModalOverlayRoot")?.innerHTML.trim() ||
          document.getElementById("modalRoot")?.innerHTML.trim() ||
          document.getElementById("customDialogRoot")?.innerHTML.trim() ||
          document.getElementById("personSpotlightOverlayRoot")?.innerHTML.trim() ||
          document.getElementById("lightboxRoot")?.innerHTML.trim() ||
          document.getElementById("searchGenreDropdownOverlay")?.classList.contains("open") ||
          document.getElementById("searchAutocompleteBox")?.classList.contains("open") ||
          document.getElementById("topUnifiedBar")?.classList.contains("mobile-search-expanded")
        );
      }

      function isCatalogCardDirectlyActiveClient() {
        if (!currentSpatialEl || !currentSpatialEl.classList || !currentSpatialEl.classList.contains("card")) return false;
        if (!document.body.contains(currentSpatialEl)) return false;
        return !isAnyBlockingOverlayOpenForCardBarClient();
      }

      function getCardActionMetaClient(cardEl) {
        if (!cardEl || !cardEl.getAttribute) return null;
        const rawKey = String(cardEl.getAttribute("data-card-key") || "");
        const keyParts = rawKey.split("_");
        const tc = cardEl.getAttribute("data-card-type") || (keyParts[0] === "s" ? "s" : "m");
        const idNum = Number(cardEl.getAttribute("data-card-id") || keyParts[1] || 0);
        const title = String(cardEl.getAttribute("data-card-title") || cardEl.querySelector(".card-title-text")?.textContent || "").trim();
        const year = String(cardEl.getAttribute("data-card-year") || "").trim();
        const rating = String(cardEl.getAttribute("data-card-rating") || "").trim();
        const vip = String(cardEl.getAttribute("data-card-vip") || "").trim();
        const mediaLabel = String(cardEl.getAttribute("data-card-media-label") || (tc === "s" ? "Serie" : "Film")).trim();
        const wlUid = String(cardEl.getAttribute("data-wl-uid") || "").trim();
        const isSaved = cardEl.getAttribute("data-card-saved") === "1" || cardEl.classList.contains("card-saved") || (rawKey && typeof savedKeysSet !== "undefined" && savedKeysSet.has(rawKey));
        return { tc, id: idNum, key: rawKey, title, year, rating, vip, mediaLabel, wlUid, isSaved };
      }

      function triggerCardTrailerByElClient(cardEl, ev = null) {
        const meta = getCardActionMetaClient(cardEl);
        if (!meta || !meta.id) return false;
        if (typeof playInstantTrailerFromCard === "function") {
          playInstantTrailerFromCard(ev, meta.tc, meta.id);
          return true;
        }
        const playBtn = cardEl.querySelector(".card-hover-play-btn");
        if (playBtn) {
          playBtn.click();
          return true;
        }
        return false;
      }

      function triggerCardWishlistByElClient(cardEl, ev = null) {
        const meta = getCardActionMetaClient(cardEl);
        if (!meta) return false;
        if (meta.wlUid) {
          const saveBtn = cardEl.querySelector(".card-quick-save");
          if (saveBtn) {
            saveBtn.click();
            return true;
          }
        }
        if (meta.id && typeof quickToggleCardWishlist === "function") {
          quickToggleCardWishlist(ev, meta.tc, meta.id, meta.title);
          return true;
        }
        const saveBtn = cardEl.querySelector(".card-quick-save");
        if (saveBtn) {
          saveBtn.click();
          return true;
        }
        return false;
      }

      function triggerFocusBarActionClient(action, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        const targetCard = (lastFocusBarCardEl && document.body.contains(lastFocusBarCardEl))
          ? lastFocusBarCardEl
          : (currentSpatialEl && currentSpatialEl.closest ? currentSpatialEl.closest(".card") : null);
        if (!targetCard) return;
        if (action === "details") {
          targetCard.click();
        } else if (action === "trailer") {
          triggerCardTrailerByElClient(targetCard, ev);
        } else if (action === "wishlist") {
          triggerCardWishlistByElClient(targetCard, ev);
        }
      }

      function resolveDefaultInputProfileClient() {
        if (document.body && document.body.getAttribute("data-tv-profile") === "firetv") return "firetv";
        if (document.body && document.body.getAttribute("data-device") === "tv") return "tv";
        return "keyboard";
      }

      let catalogFocusBarFadeTimer = null;
      let catalogFocusShortcutsIntroActive = false;
      let catalogFocusShortcutsIntroDone = false;
      let catalogFocusShortcutsIntroTimer = null;
      let catalogFocusBarHovered = false;
      let catalogFocusBarHoverBound = false;

      function scheduleCatalogFocusBarAutoFadeClient(durationMs = 2500) {
        if (catalogFocusBarFadeTimer) {
          clearTimeout(catalogFocusBarFadeTimer);
          catalogFocusBarFadeTimer = null;
        }
        if (catalogFocusBarHovered) return;
        const safeMs = Math.max(800, Number(durationMs) || 2500);
        catalogFocusBarFadeTimer = setTimeout(() => {
          catalogFocusBarFadeTimer = null;
          if (catalogFocusBarHovered) return;
          const barEl = document.getElementById("catalogFocusInfoBar");
          if (barEl) barEl.classList.remove("visible");
        }, safeMs);
      }

      function syncCatalogFocusInfoBarClient(explicitCardEl = undefined) {
        const bar = document.getElementById("catalogFocusInfoBar");
        if (!bar) return;
        if (!catalogFocusBarHoverBound) {
          catalogFocusBarHoverBound = true;
          bar.addEventListener("mouseenter", () => {
            catalogFocusBarHovered = true;
            if (catalogFocusBarFadeTimer) {
              clearTimeout(catalogFocusBarFadeTimer);
              catalogFocusBarFadeTimer = null;
            }
          });
          bar.addEventListener("mouseleave", () => {
            catalogFocusBarHovered = false;
            if (bar.classList.contains("visible") && !catalogFocusShortcutsIntroActive) {
              scheduleCatalogFocusBarAutoFadeClient(2500);
            }
          });
        }
        if (isAnyBlockingOverlayOpenForCardBarClient()) {
          if (catalogFocusBarFadeTimer) {
            clearTimeout(catalogFocusBarFadeTimer);
            catalogFocusBarFadeTimer = null;
          }
          if (hoverFocusBarClearTimer) {
            clearTimeout(hoverFocusBarClearTimer);
            hoverFocusBarClearTimer = null;
          }
          catalogFocusBarHovered = false;
          bar.classList.remove("visible");
          lastFocusBarCardEl = null;
          return;
        }
        const isSmallMobile = (window.innerWidth || 1024) <= 640;
        if (isSmallMobile && !isKeyboardNavActive) {
          bar.classList.remove("visible");
          return;
        }
        let cardEl = null;
        if (explicitCardEl === null) {
          cardEl = null;
        } else if (explicitCardEl && explicitCardEl.classList && explicitCardEl.classList.contains("card")) {
          cardEl = explicitCardEl;
        } else if (currentSpatialEl && currentSpatialEl.closest) {
          cardEl = currentSpatialEl.closest(".card");
        }
        if (!cardEl || !document.body.contains(cardEl)) {
          if (catalogFocusBarFadeTimer) {
            clearTimeout(catalogFocusBarFadeTimer);
            catalogFocusBarFadeTimer = null;
          }
          bar.classList.remove("visible");
          lastFocusBarCardEl = null;
          return;
        }
        const meta = getCardActionMetaClient(cardEl);
        if (!meta || !meta.title) {
          bar.classList.remove("visible");
          return;
        }
        const prevCardEl = lastFocusBarCardEl;
        lastFocusBarCardEl = cardEl;

        // Einmaliger 5-Sekunden-Hinweis beim allerersten Cover-Fokus (Shortcuts unten + Seitenmenü-Rand-Laschen synchron)
        if (!catalogFocusShortcutsIntroDone && !catalogFocusShortcutsIntroActive) {
          catalogFocusShortcutsIntroActive = true;
          if (typeof triggerSideEdgeHintsAutoFadeClient === "function") {
            triggerSideEdgeHintsAutoFadeClient(5000, "intro");
          }
          if (catalogFocusShortcutsIntroTimer) {
            clearTimeout(catalogFocusShortcutsIntroTimer);
          }
          catalogFocusShortcutsIntroTimer = setTimeout(() => {
            catalogFocusShortcutsIntroTimer = null;
            catalogFocusShortcutsIntroActive = false;
            catalogFocusShortcutsIntroDone = true;
            if (!catalogFocusBarHovered) {
              const liveBar = document.getElementById("catalogFocusInfoBar");
              if (liveBar) liveBar.classList.remove("visible");
            }
          }, 5000);
        }

        const showShortcutsNow = catalogFocusShortcutsIntroActive && !catalogFocusShortcutsIntroDone;
        const profile = activeInputProfile || resolveDefaultInputProfileClient();
        const saveLabel = meta.isSaved ? "Entfernen" : "Merken";

        let hintsHtml = "";
        if (showShortcutsNow) {
          if (profile === "firetv") {
            hintsHtml =
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'details\\',event)"><kbd>OK</kbd> Details</button>' +
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'trailer\\',event)"><kbd>⏯</kbd> Trailer</button>' +
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'wishlist\\',event)"><kbd>OK halten</kbd> ' + saveLabel + '</button>' +
              '<span class="cfi-hint-btn is-static"><kbd>⏪/⏩</kbd> Blättern</span>';
          } else if (profile === "tv") {
            hintsHtml =
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'details\\',event)"><kbd>OK</kbd> Details</button>' +
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'trailer\\',event)"><kbd>⏯</kbd> Trailer</button>' +
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'wishlist\\',event)"><kbd>OK halten</kbd> ' + saveLabel + '</button>';
          } else if (profile === "gamepad-ps") {
            hintsHtml =
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'details\\',event)"><kbd>✕</kbd> Details</button>' +
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'trailer\\',event)"><kbd>✕ halten</kbd> Trailer</button>' +
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'wishlist\\',event)"><kbd>□</kbd> ' + saveLabel + '</button>';
          } else if (profile === "gamepad-xbox") {
            hintsHtml =
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'details\\',event)"><kbd>A</kbd> Details</button>' +
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'trailer\\',event)"><kbd>A halten</kbd> Trailer</button>' +
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'wishlist\\',event)"><kbd>X</kbd> ' + saveLabel + '</button>';
          } else {
            hintsHtml =
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'details\\',event)"><kbd>Enter</kbd> Details</button>' +
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'trailer\\',event)"><kbd>Leertaste</kbd> Trailer</button>' +
              '<button type="button" class="cfi-hint-btn" onclick="triggerFocusBarActionClient(\\'wishlist\\',event)"><kbd>Enter halten</kbd> ' + saveLabel + '</button>';
          }
        }

        const metaParts = [];
        if (meta.rating && meta.rating !== "–") {
          metaParts.push('<span class="cfi-rating">★ ' + esc(meta.rating) + '</span>');
        }
        if (meta.year && meta.year !== "–") {
          metaParts.push('<span>' + esc(meta.year) + '</span>');
        }
        if (meta.mediaLabel) {
          metaParts.push('<span>' + esc(meta.mediaLabel) + '</span>');
        }
        const vipDotHtml = meta.vip ? '<span class="cfi-vip-dot" title="VIP: ' + esc(meta.vip) + '"></span>' : '';
        const savedMarkHtml = meta.isSaved ? '<span class="cfi-saved-mark" title="In Merkliste">✓</span>' : '';

        bar.classList.toggle("is-title-only", !showShortcutsNow);
        bar.innerHTML =
          '<div class="cfi-left">' +
            vipDotHtml +
            '<span class="cfi-title">' + esc(meta.title) + '</span>' +
            (metaParts.length ? ('<span class="cfi-meta">' + metaParts.join('<span>·</span>') + '</span>') : '') +
            savedMarkHtml +
          '</div>' +
          (showShortcutsNow ? ('<span class="cfi-divider"></span><div class="cfi-hints">' + hintsHtml + '</div>') : '');

        bar.classList.add("visible");
        if (!showShortcutsNow && (cardEl !== prevCardEl || !catalogFocusBarFadeTimer)) {
          scheduleCatalogFocusBarAutoFadeClient(2500);
        }
        const ctrlHud = document.getElementById("controllerHudBar");
        if (ctrlHud) ctrlHud.classList.remove("visible");
      }

      function getActiveForegroundCinemaContextClient() {
        const elev = document.getElementById("tvQuickJumpElevator");
        const isRightOverlayOpen = Boolean(
          elev && (elev.classList.contains("has-subpanel") || elev.classList.contains("is-hover-expanded"))
        );
        const isBlockedByOverlay = Boolean(
          (state && state.sidebarOpen) ||
          isRightOverlayOpen ||
          isManualNoTmdbModalOpenClient() ||
          document.getElementById("subModalOverlayRoot")?.innerHTML.trim() ||
          document.getElementById("searchGenreDropdownOverlay")?.classList.contains("open") ||
          document.getElementById("searchAutocompleteBox")?.classList.contains("open") ||
          document.getElementById("topUnifiedBar")?.classList.contains("mobile-search-expanded") ||
          document.getElementById("customDialogRoot")?.innerHTML.trim() ||
          document.getElementById("personSpotlightOverlayRoot")?.innerHTML.trim() ||
          document.getElementById("lightboxRoot")?.innerHTML.trim()
        );
        if (isBlockedByOverlay) return null;
        const modalHasContent = Boolean(document.getElementById("modalRoot")?.innerHTML.trim());
        if (modalHasContent) {
          const detailStage = document.getElementById("detailHeroStageEl");
          if (detailStage && detailStage.classList.contains("is-trailer-foreground-mode")) {
            return {
              mode: "detail",
              prefix: "detail",
              stageEl: detailStage,
              isPaused: detailStage.classList.contains("is-cinema-paused"),
              isEnded: detailStage.classList.contains("is-cinema-ended"),
              isStarting: detailStage.classList.contains("is-cinema-starting")
            };
          }
          return null;
        }
        const heroStage = document.getElementById("heroStageEl");
        if (heroStage && heroStage.classList.contains("is-trailer-foreground-mode")) {
          return {
            mode: "hero",
            prefix: "hero",
            stageEl: heroStage,
            isPaused: heroStage.classList.contains("is-cinema-paused"),
            isEnded: heroStage.classList.contains("is-cinema-ended"),
            isStarting: heroStage.classList.contains("is-cinema-starting")
          };
        }
        return null;
      }

      function wakeActiveCinemaDockClient(ctx) {
        if (!ctx) return;
        if (ctx.mode === "detail" && typeof wakeDetailCinemaDockClient === "function") {
          wakeDetailCinemaDockClient();
        } else if (ctx.mode === "hero" && typeof wakeHeroCinemaDockClient === "function") {
          wakeHeroCinemaDockClient();
        }
      }

      function cancelActiveCinemaEndcardCountdownClient(ctx) {
        if (!ctx || !ctx.isEnded) return;
        if (ctx.mode === "detail" && typeof cancelDetailCinemaEndcardCountdownClient === "function") {
          cancelDetailCinemaEndcardCountdownClient(true);
        } else if (ctx.mode === "hero" && typeof cancelHeroCinemaEndcardCountdownClient === "function") {
          cancelHeroCinemaEndcardCountdownClient(true);
        }
      }

      function isCinemaControlElementInteractiveClient(el) {
        if (!el || el.disabled) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      }

      let lastFocusedCinemaDockBtnId = "";

      function getCinemaControlRowsClient(ctx) {
        if (!ctx) return [];
        const p = ctx.prefix;
        const rows = [];

        const topClose = document.getElementById(p + "CinemaTopCloseBtn");
        if (isCinemaControlElementInteractiveClient(topClose)) {
          rows.push([topClose]);
        }

        if (ctx.isEnded) {
          const endOverlay = document.getElementById(p + "CinemaEndOverlay");
          if (endOverlay) {
            const endBtns = Array.from(endOverlay.querySelectorAll("button.cinema-overlay-btn")).filter(isCinemaControlElementInteractiveClient);
            if (endBtns.length) rows.push(endBtns);
          }
        } else if (ctx.isPaused) {
          const centerPlay = document.getElementById(p + "CinemaCenterPlayBtn");
          if (isCinemaControlElementInteractiveClient(centerPlay)) {
            rows.push([centerPlay]);
          }
          const pauseCurtain = document.getElementById(p + "CinemaPauseCurtain");
          if (pauseCurtain) {
            const pauseBtns = Array.from(pauseCurtain.querySelectorAll("button.cinema-overlay-btn")).filter(isCinemaControlElementInteractiveClient);
            if (pauseBtns.length) rows.push(pauseBtns);
          }
        }

        const dock = document.getElementById(p + "CinemaPlayerDock");
        if (dock) {
          // Tier 1: Eigene Zeitleisten-Zeile (Pfeil ↑ aus der Steuerung springt hierher, ←/→ spulen ±10s, ↓ kehrt zurück)
          const scrubber = document.getElementById(p + "CinemaScrubber");
          if (isCinemaControlElementInteractiveClient(scrubber)) {
            rows.push([scrubber]);
          }
          // Tier 2: Reine Button-Steuerleiste (←/→ laufen komplett frei von links nach rechts ohne jemals an Lautstärke hängen zu bleiben!)
          const dockControls = Array.from(dock.querySelectorAll("button.cinema-dock-btn")).filter(isCinemaControlElementInteractiveClient);
          if (dockControls.length) rows.push(dockControls);
        }
        return rows;
      }

      function getCinemaFocusableElementsClient(ctx) {
        return getCinemaControlRowsClient(ctx).flat();
      }

      function navigateCinemaPlayerFocusClient(dir, ctx, opts = {}) {
        if (!ctx) return false;
        const isTabNav = Boolean(opts && opts.isTabNav);
        wakeActiveCinemaDockClient(ctx);
        cancelActiveCinemaEndcardCountdownClient(ctx);
        const p = ctx.prefix;

        // Tab / Shift+Tab wandert linear durch alle Steuerelemente ohne von Scrubber/Lautstärke abgefangen zu werden
        if (isTabNav) {
          const flatEls = getCinemaFocusableElementsClient(ctx);
          if (!flatEls.length) return false;
          const idx = flatEls.indexOf(currentSpatialEl);
          const step = dir === "left" ? -1 : 1;
          const nextEl = idx === -1
            ? flatEls[step > 0 ? 0 : flatEls.length - 1]
            : flatEls[(idx + step + flatEls.length) % flatEls.length];
          if (nextEl && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(nextEl, false);
            if (nextEl.tagName === "BUTTON" || nextEl.tagName === "INPUT") {
              try { nextEl.focus({ preventScroll: true }); } catch (_ft) {}
            }
          }
          return true;
        }

        // Auf dem Lautstärke-Button regeln Pfeil ↑ / ↓ stufenlos die Lautstärke (±10%), während ← / → direkt zu den Nachbar-Buttons wechseln!
        if (currentSpatialEl && currentSpatialEl.id === p + "CinemaMuteBtn" && (dir === "up" || dir === "down")) {
          const volDelta = dir === "up" ? 10 : -10;
          if (typeof syncCinemaVolPopoverFocusStateClient === "function") {
            syncCinemaVolPopoverFocusStateClient(currentSpatialEl);
          }
          if (ctx.mode === "detail" && typeof adjustDetailCinemaVolumeStepClient === "function") adjustDetailCinemaVolumeStepClient(volDelta);
          else if (ctx.mode === "hero" && typeof adjustHeroCinemaVolumeStepClient === "function") adjustHeroCinemaVolumeStepClient(volDelta);
          return true;
        }

        // Auf der eigenen Zeitleisten-Zeile (Scrubber) spulen ← / → gezielt ±10s, während ↑ / ↓ die Zeile sofort verlassen!
        if (currentSpatialEl && currentSpatialEl.id === p + "CinemaScrubber" && (dir === "left" || dir === "right")) {
          const stepSign = dir === "right" ? 1 : -1;
          if (ctx.mode === "detail" && typeof seekDetailCinemaRelativeClient === "function") seekDetailCinemaRelativeClient(stepSign * 10);
          else if (ctx.mode === "hero" && typeof seekHeroCinemaRelativeClient === "function") seekHeroCinemaRelativeClient(stepSign * 10);
          return true;
        }

        const rows = getCinemaControlRowsClient(ctx);
        if (!rows.length) return false;

        let curRowIdx = -1;
        let curColIdx = -1;
        for (let r = 0; r < rows.length; r++) {
          const c = rows[r].indexOf(currentSpatialEl);
          if (c !== -1) {
            curRowIdx = r;
            curColIdx = c;
            break;
          }
        }

        if (curRowIdx === -1) {
          const defaultTarget = ctx.isEnded
            ? (document.getElementById(p + "CinemaEndPrimaryBtn") || rows[0][0])
            : ctx.isPaused
              ? (document.getElementById(p + "CinemaPauseResumeBtn") || document.getElementById(p + "CinemaCenterPlayBtn") || rows[rows.length - 1][0])
              : (document.getElementById(p + "CinemaPlayBtn") || rows[rows.length - 1][0]);
          if (defaultTarget && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(defaultTarget, false);
            if (defaultTarget.tagName === "BUTTON") {
              try { defaultTarget.focus({ preventScroll: true }); } catch (_fe) {}
            }
          }
          return true;
        }

        if (currentSpatialEl && currentSpatialEl.classList && currentSpatialEl.classList.contains("cinema-dock-btn") && currentSpatialEl.id) {
          lastFocusedCinemaDockBtnId = currentSpatialEl.id;
        }

        let targetEl = null;
        if (dir === "left" || dir === "right") {
          const curRow = rows[curRowIdx];
          if (curRow.length === 1) {
            targetEl = curRow[0];
          } else {
            const delta = dir === "right" ? 1 : -1;
            const nextCol = (curColIdx + delta + curRow.length) % curRow.length;
            targetEl = curRow[nextCol];
          }
        } else if (dir === "up" || dir === "down") {
          const nextRowIdx = dir === "up"
            ? Math.max(0, curRowIdx - 1)
            : Math.min(rows.length - 1, curRowIdx + 1);
          const targetRow = rows[nextRowIdx];
          if (targetRow.length === 1) {
            targetEl = targetRow[0];
          } else if (currentSpatialEl && currentSpatialEl.id === p + "CinemaScrubber" && dir === "down") {
            // Vom vollbreiten Scrubber nach unten direkt zurück zum zuletzt genutzten Dock-Button (oder Play)
            const remembered = lastFocusedCinemaDockBtnId ? document.getElementById(lastFocusedCinemaDockBtnId) : null;
            targetEl = (remembered && targetRow.includes(remembered))
              ? remembered
              : (document.getElementById(p + "CinemaPlayBtn") || targetRow[0]);
          } else {
            const curRect = currentSpatialEl.getBoundingClientRect();
            const curCx = curRect.left + curRect.width / 2;
            let bestEl = targetRow[0];
            let bestDist = Infinity;
            for (const cand of targetRow) {
              const cr = cand.getBoundingClientRect();
              const dist = Math.abs((cr.left + cr.width / 2) - curCx);
              if (dist < bestDist) {
                bestDist = dist;
                bestEl = cand;
              }
            }
            targetEl = bestEl;
          }
        }

        if (targetEl && typeof jumpSpatialFocus === "function") {
          if (targetEl.classList && targetEl.classList.contains("cinema-dock-btn") && targetEl.id) {
            lastFocusedCinemaDockBtnId = targetEl.id;
          }
          jumpSpatialFocus(targetEl, false);
          if (targetEl.tagName === "BUTTON") {
            try { targetEl.focus({ preventScroll: true }); } catch (_fe2) {}
          }
        }
        return true;
      }

      function confirmCinemaPlayerFocusClient(ctx) {
        if (!ctx) return false;
        wakeActiveCinemaDockClient(ctx);
        cancelActiveCinemaEndcardCountdownClient(ctx);
        const p = ctx.prefix;
        const activeNodes = getCinemaFocusableElementsClient(ctx);
        if (currentSpatialEl && activeNodes.includes(currentSpatialEl)) {
          if (currentSpatialEl.id === p + "CinemaScrubber") {
            if (ctx.mode === "detail" && typeof toggleDetailCinemaPlayPauseClient === "function") toggleDetailCinemaPlayPauseClient();
            else if (ctx.mode === "hero" && typeof toggleHeroCinemaPlayPauseClient === "function") toggleHeroCinemaPlayPauseClient();
            return true;
          }
          if (currentSpatialEl.id === p + "CinemaMuteBtn") {
            if (typeof syncCinemaVolPopoverFocusStateClient === "function") {
              syncCinemaVolPopoverFocusStateClient(currentSpatialEl);
            }
            currentSpatialEl.click();
            return true;
          }
          currentSpatialEl.click();
          return true;
        }
        if (ctx.isEnded) {
          const primaryEnd = document.getElementById(p + "CinemaEndPrimaryBtn");
          if (primaryEnd) {
            primaryEnd.click();
            return true;
          }
        }
        if (ctx.mode === "detail" && typeof toggleDetailCinemaPlayPauseClient === "function") toggleDetailCinemaPlayPauseClient();
        else if (ctx.mode === "hero" && typeof toggleHeroCinemaPlayPauseClient === "function") toggleHeroCinemaPlayPauseClient();
        return true;
      }

      function getVisibleFocusables() {
        const activeCinemaCtx = getActiveForegroundCinemaContextClient();
        if (activeCinemaCtx) {
          return getCinemaFocusableElementsClient(activeCinemaCtx);
        }
        const dialogEl = document.getElementById("customDialogRoot");
        const manual900mEl = document.getElementById("manualNoTmdbConfirmModalOverlay");
        const subModalEl = document.getElementById("subModalOverlayRoot");
        const spotlightEl = document.getElementById("personSpotlightOverlayRoot");
        const modalEl = document.getElementById("modalRoot");
        const topUnifiedHeader = document.getElementById("topUnifiedBar");
        const lbEl = document.getElementById("lightboxRoot");
        const sidebarEl = document.getElementById("filterSidebarDrawer");
        const isManual900mActive = isManualNoTmdbModalOpenClient();
        const isSubModalActive = Boolean(subModalEl && subModalEl.innerHTML.trim());
        const isSpotlightActive = Boolean(spotlightEl && spotlightEl.innerHTML.trim());
        const isModalActive = Boolean(modalEl && modalEl.innerHTML.trim());
        const scopeRoot = (dialogEl && dialogEl.innerHTML.trim())
          ? dialogEl
          : isManual900mActive
            ? manual900mEl
            : isSubModalActive
              ? subModalEl
              : (lbEl && lbEl.innerHTML.trim())
                ? lbEl
                : isSpotlightActive
                  ? spotlightEl
                  : (state.sidebarOpen && sidebarEl)
                    ? sidebarEl
                    : isModalActive
                      ? modalEl
                      : document.body;
        const rawNodes = Array.from(scopeRoot.querySelectorAll(FOCUSABLE_SELECTOR));
        if (scopeRoot === modalEl && !state.sidebarOpen && topUnifiedHeader) {
          const headerNodes = Array.from(topUnifiedHeader.querySelectorAll(FOCUSABLE_SELECTOR));
          rawNodes.unshift(...headerNodes);
        }
        const nodes = Array.from(new Set(rawNodes));
        return nodes.filter(el => {
          if (el.disabled) return false;
          if (!state.sidebarOpen && sidebarEl && sidebarEl.contains(el)) return false;
          if (el.closest && el.closest(".hero-curtain-shell.is-collapsed")) return false;
          if (el.closest && el.closest(".detail-sticky-mini-header:not(.is-visible)")) return false;
          // Player-Controls, Top-HUD, Pause- & Endcard-Overlays dürfen NUR fokussierbar sein, wenn der Trailer-Player im Vordergrund aktiv ist!
          if (el.closest && el.closest(".detail-cinema-player-dock, .hero-cinema-player-dock, .cinema-top-hud, .cinema-pause-bottom-curtain, .cinema-end-overlay")) return false;
          if (el.classList && (el.classList.contains("cinema-dock-btn") || el.classList.contains("cinema-dock-scrubber") || el.classList.contains("cinema-vol-step-btn") || el.classList.contains("cinema-top-hud-close") || el.classList.contains("cinema-pause-center-btn") || el.classList.contains("cinema-overlay-btn"))) return false;
          if (el.classList && el.classList.contains("tv-elevator-btn")) {
            return !(document.body && document.body.classList.contains("in-hero-slider")) && !isModalActive;
          }
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
          const r = el.getBoundingClientRect();
          const minDim = (el.classList && el.classList.contains("hero-dot")) ? 2 : 4;
          return r.width > minDim && r.height > minDim;
        });
      }

      function getSpatialLayoutBox(el) {
        const r = el.getBoundingClientRect();
        const isStickyOrFixed = Boolean(
          el && (
            el.id === "smartPageIndicatorBtn" ||
            el.id === "catalogBackToTopFab" ||
            (el.closest && (
              el.closest("header") ||
              el.closest("#tvQuickJumpElevator") ||
              el.closest(".modal-backdrop") ||
              el.closest(".page-jump-modal-backdrop") ||
              el.closest(".sidebar-drawer") ||
              el.closest("#customDialogRoot") ||
              el.closest(".lightbox-backdrop")
            ))
          )
        );
        const scrollOffset = isStickyOrFixed ? 0 : (window.scrollY || window.pageYOffset || 0);
        return {
          left: r.left,
          right: r.right,
          top: r.top + scrollOffset,
          bottom: r.bottom + scrollOffset,
          width: r.width,
          height: r.height
        };
      }

      let lastSpatialNavDir = "down";

      function syncStickyHeaderCssVars() {
        try {
          const headerEl = document.querySelector("header");
          if (!headerEl) return 54;
          const hr = headerEl.getBoundingClientRect();
          const h = hr.height > 0 ? Math.round(hr.height) : 54;
          document.documentElement.style.setProperty("--sticky-header-height", h + "px");
          document.documentElement.style.setProperty("--sticky-header-offset", (h + 20) + "px");
          return h;
        } catch (e) {
          return 54;
        }
      }

      window.addEventListener("resize", () => { syncStickyHeaderCssVars(); }, { passive: true });
      syncStickyHeaderCssVars();

      function getStickyTopObstructionOffset(el, navDir = "down") {
        let topObstruction = 0;

        const headerEl = document.querySelector("header");
        if (headerEl) {
          const hr = headerEl.getBoundingClientRect();
          if (hr.height > 0) {
            const h = Math.round(hr.height);
            document.documentElement.style.setProperty("--sticky-header-height", h + "px");
            document.documentElement.style.setProperty("--sticky-header-offset", (h + 20) + "px");
            if (hr.bottom > topObstruction) {
              topObstruction = hr.bottom;
            }
          }
        }

        const searchOuter = document.querySelector(".search-bar-outer");
        if (searchOuter && !(el && el.closest && el.closest(".search-bar-outer"))) {
          const cs = window.getComputedStyle(searchOuter);
          if (cs.position === "sticky" || cs.position === "fixed") {
            const sr = searchOuter.getBoundingClientRect();
            if (sr.height > 0 && sr.bottom > topObstruction) {
              topObstruction = sr.bottom;
            }
          }
        }

        const filterBar = document.querySelector(".floating-filter-bar");
        if (filterBar && !(el && el.closest && el.closest(".floating-filter-bar"))) {
          const cs = window.getComputedStyle(filterBar);
          const fr = filterBar.getBoundingClientRect();
          if (cs.position === "sticky" || cs.position === "fixed") {
            if (fr.height > 0 && fr.bottom > topObstruction) {
              topObstruction = fr.bottom;
            }
          } else if (navDir === "up" && el && el.closest && el.closest("#resultsGridContainer")) {
            // Wenn man im Ergebnisse-Grid nach oben navigiert und sich in der obersten Kartenreihe direkt unterhalb der Filterleiste befindet:
            // Filterleisten-Höhe als oberen Puffer einrechnen, damit sowohl die Filterleiste als auch die Karte komplett unter dem Sticky-Header sichtbar werden.
            const elBox = getSpatialLayoutBox(el);
            const fbBox = getSpatialLayoutBox(filterBar);
            if (elBox.top >= fbBox.bottom - 8 && (elBox.top - fbBox.bottom) < 110) {
              topObstruction += Math.max(0, fr.height + 14);
            }
          }
        }

        return Math.max(52, topObstruction);
      }

      function useSpatialScrollIntoView(el, navDir = lastSpatialNavDir) {
        if (!el) return;
        const applyScrollPass = () => {
          try {
            const modalBackdrop = el.closest ? el.closest(".modal-backdrop") : null;
            const sidebarBody = el.closest ? el.closest(".sidebar-body") : null;
            const acBox = el.closest ? el.closest(".search-autocomplete-box") : null;
            const dialogBox = el.closest ? el.closest("#customDialogRoot") : null;

            // 0. Horizontale Slider-Tracks (.detail-cast-track, .detail-similar-track, .season-toolbar-row, .detail-credits-strip)
            // immer zuerst horizontal nachscrollen, damit fokussierte Karten niemals seitlich außerhalb des Sichtfeldes wandern!
            const horizTrack = el.closest
              ? el.closest(".detail-cast-track, .detail-similar-track, .season-toolbar-row, .detail-credits-strip")
              : null;
            if (horizTrack) {
              const trRect = horizTrack.getBoundingClientRect();
              const elRect = el.getBoundingClientRect();
              const padX = 20;
              if (elRect.left < trRect.left + padX) {
                horizTrack.scrollLeft += (elRect.left - (trRect.left + padX));
              } else if (elRect.right > trRect.right - padX) {
                horizTrack.scrollLeft += (elRect.right - (trRect.right - padX));
              }
              if (typeof syncDetailCarouselSideButtonsClient === "function") {
                syncDetailCarouselSideButtonsClient(horizTrack);
              }
            }

            if (modalBackdrop) {
              const inHeroStage = Boolean(
                el.closest &&
                el.closest("#detailHeroStageEl") &&
                !el.closest("#modalPosterPickerBox, #modalRemapMediaBox")
              );
              const inHeroStageOrHeader = Boolean(
                inHeroStage || (el.closest && el.closest("#topUnifiedBar"))
              );
              // Sobald auf der Detailseite der Fokus auf der Bühnen-/Aktionsreihe (Trailer, Speichern, Infos) liegt,
              // wandert die Ansicht komplett mit sanftem Hero-Slider-Übergang wieder ganz nach oben!
              if (inHeroStage && modalBackdrop.scrollTop > 2) {
                if (typeof scrollDetailModalToHeroStageTopClient === "function") {
                  scrollDetailModalToHeroStageTopClient();
                } else {
                  modalBackdrop.scrollTo({ top: 0, behavior: "smooth" });
                }
                return;
              }
              if (inHeroStageOrHeader && navDir === "up" && modalBackdrop.scrollTop > 0) {
                const rTopCheck = el.getBoundingClientRect();
                if (rTopCheck.top < 110) {
                  if (typeof scrollDetailModalToHeroStageTopClient === "function") {
                    scrollDetailModalToHeroStageTopClient();
                  } else {
                    modalBackdrop.scrollTop = 0;
                  }
                  return;
                }
              }
              const r = el.getBoundingClientRect();
              const headerEl = document.getElementById("topUnifiedBar");
              const stickyMiniEl = document.getElementById("detailStickyMiniHeader");
              const baseHeaderBottom = headerEl ? Math.max(54, headerEl.getBoundingClientRect().bottom) : 54;
              const miniHeaderExtra = (stickyMiniEl && !inHeroStageOrHeader) ? 52 : 0;
              const stickyOffset = baseHeaderBottom + miniHeaderExtra + 20;
              const botPad = window.innerHeight - 36;
              if (r.top < stickyOffset) {
                modalBackdrop.scrollTop += (r.top - stickyOffset);
              } else if (r.bottom > botPad) {
                modalBackdrop.scrollTop += (r.bottom - botPad);
              }
              return;
            }

            const sidebarSubBody = el.closest ? el.closest(".sidebar-sub-body") : null;
            if (sidebarSubBody) {
              const sbRect = sidebarSubBody.getBoundingClientRect();
              const r = el.getBoundingClientRect();
              const topBoundary = sbRect.top + 14;
              const botBoundary = sbRect.bottom - 14;
              if (r.top < topBoundary) {
                sidebarSubBody.scrollTop += (r.top - topBoundary);
              } else if (r.bottom > botBoundary) {
                sidebarSubBody.scrollTop += (r.bottom - botBoundary);
              }
              return;
            }

            if (sidebarBody) {
              const sbRect = sidebarBody.getBoundingClientRect();
              const r = el.getBoundingClientRect();
              const topBoundary = sbRect.top + 14;
              const botBoundary = sbRect.bottom - 14;
              if (r.top < topBoundary) {
                sidebarBody.scrollTop += (r.top - topBoundary);
              } else if (r.bottom > botBoundary) {
                sidebarBody.scrollTop += (r.bottom - botBoundary);
              }
              return;
            }

            if (acBox || dialogBox) {
              if (typeof el.scrollIntoView === "function") {
                el.scrollIntoView({ block: "nearest", inline: "nearest" });
              }
              return;
            }

            if (
              el.id === "smartPageIndicatorBtn" ||
              el.id === "catalogBackToTopFab" ||
              (el.closest && el.closest("#tvQuickJumpElevator"))
            ) {
              return;
            }

            // Hauptseite: Wenn Fokus auf Header, Suchleiste oder Hero-Slider liegt -> komplett nach oben (top: 0) scrollen
            const inTopZone = Boolean(
              el.closest && (
                el.closest("header") ||
                el.closest(".search-bar-outer") ||
                el.closest("#heroBannerSlot") ||
                el.closest(".hero") ||
                el.closest(".hero-collapsed-strip")
              )
            );
            const curScrollY = window.scrollY || window.pageYOffset || 0;
            if (inTopZone) {
              if (curScrollY > 0) {
                window.scrollTo({ top: 0, behavior: "auto" });
              }
              return;
            }

            // Dynamisches Offset aus Sticky-Header + Filter-Bar berechnen (unten Platz für Fokus-Info-Zeile lassen)
            const obstructionOffset = getStickyTopObstructionOffset(el, navDir);
            const safeTopBoundary = obstructionOffset + 22;
            const isCardTarget = Boolean(el.classList && el.classList.contains("card"));
            const safeBottomBoundary = window.innerHeight - (isCardTarget ? 78 : 28);
            const curtainEl = document.getElementById("heroCurtainShell");
            const pendingCurtainCollapseH = (curtainEl && curtainEl.classList.contains("is-collapsed"))
              ? Math.max(0, curtainEl.getBoundingClientRect().height)
              : 0;
            const rawR = el.getBoundingClientRect();
            const effTop = rawR.top - pendingCurtainCollapseH;
            const effBottom = rawR.bottom - pendingCurtainCollapseH;

            if (effTop < safeTopBoundary) {
              const targetScrollY = Math.max(0, curScrollY + (effTop - safeTopBoundary));
              window.scrollTo({ top: targetScrollY, behavior: "auto" });
            } else if (effBottom > safeBottomBoundary) {
              const targetScrollY = Math.max(0, curScrollY + (effBottom - safeBottomBoundary));
              window.scrollTo({ top: targetScrollY, behavior: "auto" });
            }
          } catch (e) {}
        };

        // 1. Sofortiger Scroll-Durchlauf
        applyScrollPass();

        // 2. Zweiter Verifikations-Durchlauf im nächsten Animations-Frame, um eventuelle Layout-Shifts durch content-visibility: auto beim Hochscrollen auszugleichen
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => {
            if (currentSpatialEl === el) {
              applyScrollPass();
            }
          });
        }
      }

      function setSpatialFocus(el, scrollIntoView = true, navDir = lastSpatialNavDir) {
        if (!el) return;
        if (currentSpatialEl && currentSpatialEl !== el) {
          currentSpatialEl.classList.remove("spatial-focus");
          currentSpatialEl.classList.remove("ac-kb-active");
        }
        const isTargetInSearchDropdown = Boolean(
          el.closest && (el.closest("#searchAutocompleteBox") || el.closest("#searchGenreDropdownOverlay"))
        );
        if (
          document.activeElement &&
          document.activeElement !== el &&
          document.activeElement !== document.body &&
          !(document.activeElement.id === "searchInput" && isTargetInSearchDropdown) &&
          typeof document.activeElement.blur === "function"
        ) {
          try { document.activeElement.blur(); } catch (e) {}
        }
        currentSpatialEl = el;
        currentSpatialEl.classList.add("spatial-focus");
        if (typeof syncCinemaVolPopoverFocusStateClient === "function") {
          syncCinemaVolPopoverFocusStateClient(currentSpatialEl);
        }
        const elevBox = document.getElementById("tvQuickJumpElevator");
        if (elevBox) {
          const goingIntoElev = Boolean(el.closest && el.closest("#tvQuickJumpElevator"));
          if (goingIntoElev) {
            elevBox.classList.remove("is-dismissed");
          }
          elevBox.classList.toggle("is-visible", goingIntoElev);
          if (!goingIntoElev) {
            elevBox.classList.remove("is-hover-expanded");
          }
        }
        if (el.classList && el.classList.contains("ac-item")) {
          const acBoxEl = document.getElementById("searchAutocompleteBox");
          if (acBoxEl) {
            const allAc = Array.from(acBoxEl.querySelectorAll(".ac-item"));
            const idx = allAc.indexOf(el);
            if (typeof activeAutocompleteIndex !== "undefined") {
              activeAutocompleteIndex = idx;
            }
            allAc.forEach((item, i) => item.classList.toggle("ac-kb-active", i === idx));
          }
        }
        const parentCard = isCardSubElement(el) ? el.closest(".card") : null;
        clearCardSubnavState(parentCard);
        if (parentCard) parentCard.classList.add("card-subnav-active");
        if (typeof window.syncActiveCardMarquee === "function") {
          window.syncActiveCardMarquee(parentCard || el);
        }
        if (el.closest && el.closest(".hero") && document.body && typeof isHeroStageAvailableForCurrentViewClient === "function" && isHeroStageAvailableForCurrentViewClient()) {
          document.body.classList.add("in-hero-slider");
          if (typeof syncSmartPageIndicatorDomClient === "function") {
            syncSmartPageIndicatorDomClient(false);
          }
        }
        // Rücksprung-Ziel für „Pfeil-oben-halten -> Suche“ zurücksetzen, sobald Fokus den Header/Suchbereich verlässt
        if (searchShortcutReturnCardEl && el.id !== "wishlistSearchInp" && !(el.closest && (el.closest("#topUnifiedBar") || el.closest("#searchAutocompleteBox") || el.closest("#searchGenreDropdownOverlay")))) {
          searchShortcutReturnCardEl = null;
        }

        if (scrollIntoView) {
          useSpatialScrollIntoView(el, navDir);
        }
        syncCatalogFocusInfoBarClient();
      }

      function jumpSpatialFocus(el, scrollIntoView = true, navDir = lastSpatialNavDir) {
        if (!el) return;
        lastSelectJumpAt = Date.now();
        setSpatialFocus(el, scrollIntoView, navDir);
      }

      function focusFirstResultCard(scrollIntoView = false) {
        const target = document.querySelector("#resultsGridContainer .card, #appRoot .card, #colHubGrid .btn, #uniHubGrid .f-pill, #appRoot .ep-title");
        if (target) {
          jumpSpatialFocus(target, scrollIntoView);
        }
      }

      // Automatische Maus-Sperre während der Tastatur-/Controller-Nutzung:
      // Verhindert, dass beim Scrollen per Pfeiltasten der stillstehende Mauszeiger durch synthetische mouseover-Events den Fokus klaut!
      let isKeyboardNavActive = false;
      let lastMouseX = null;
      let lastMouseY = null;

      function engageKeyboardNavMode() {
        if (!isKeyboardNavActive) {
          isKeyboardNavActive = true;
          if (document.body) document.body.classList.add("kb-nav-active");
        }
      }

      function disengageKeyboardNavMode(ev = null) {
        if (isKeyboardNavActive) {
          isKeyboardNavActive = false;
          if (document.body) document.body.classList.remove("kb-nav-active");
          const actTag = (document.activeElement && document.activeElement.tagName || "").toUpperCase();
          if (actTag === "INPUT" || actTag === "TEXTAREA" || actTag === "SELECT") return;
          let realUnder = null;
          if (ev && typeof ev.clientX === "number" && typeof ev.clientY === "number") {
            try {
              realUnder = document.elementFromPoint(ev.clientX, ev.clientY);
            } catch (_ep) {}
          }
          if (!realUnder && ev && ev.target) realUnder = ev.target;
          const subTarget = realUnder && typeof realUnder.closest === "function" ? realUnder.closest(CARD_SUB_SELECTOR) : null;
          const focusTarget = realUnder && typeof realUnder.closest === "function" ? realUnder.closest(FOCUSABLE_SELECTOR) : null;
          if (mouseHoverNavEnabled && subTarget) {
            setSpatialFocus(subTarget, false);
            return;
          }
          if (mouseHoverNavEnabled && focusTarget && !focusTarget.disabled && !focusTarget.classList.contains("is-current-mode")) {
            setSpatialFocus(focusTarget, false);
            return;
          }
          // Verhindert klebenbleibende Tastatur-Markierung, wenn die Maus beim Zurückwechseln ein anderes Element oder freien Raum berührt
          if (currentSpatialEl && (!focusTarget || focusTarget !== currentSpatialEl)) {
            currentSpatialEl.classList.remove("spatial-focus");
            clearCardSubnavState(null);
            currentSpatialEl = null;
          }
          syncCatalogFocusInfoBarClient();
        }
      }

      // Echte physische Mausbewegung (>= 4px) oder Klick reaktiviert die Maussteuerung sofort
      let pendingKbClickRescueEl = null;
      document.addEventListener("mousemove", (ev) => {
        if (typeof ev.clientX !== "number" || typeof ev.clientY !== "number") return;
        if (lastMouseX === null || lastMouseY === null) {
          lastMouseX = ev.clientX;
          lastMouseY = ev.clientY;
          return;
        }
        const dist = Math.hypot(ev.clientX - lastMouseX, ev.clientY - lastMouseY);
        if (dist >= 4) {
          lastMouseX = ev.clientX;
          lastMouseY = ev.clientY;
          pendingKbClickRescueEl = null;
          disengageKeyboardNavMode(ev);
        }
      }, { passive: true });

      document.addEventListener("mousedown", (ev) => {
        if (typeof ev.clientX === "number" && typeof ev.clientY === "number") {
          lastMouseX = ev.clientX;
          lastMouseY = ev.clientY;
        }
        const wasKbActive = isKeyboardNavActive;
        disengageKeyboardNavMode(ev);
        pendingKbClickRescueEl = null;
        if (wasKbActive && ev.button === 0 && (ev.target === document.documentElement || ev.target === document.body) && typeof ev.clientX === "number" && typeof ev.clientY === "number") {
          try {
            const realEl = document.elementFromPoint(ev.clientX, ev.clientY);
            if (realEl && realEl !== document.documentElement && realEl !== document.body) {
              pendingKbClickRescueEl = realEl;
            }
          } catch (_ce) {}
        }
      }, true);

      document.addEventListener("mouseup", (ev) => {
        if (!pendingKbClickRescueEl) return;
        const rescueTarget = pendingKbClickRescueEl;
        pendingKbClickRescueEl = null;
        if (ev.button !== 0) return;
        try {
          const curUnder = (typeof ev.clientX === "number" && typeof ev.clientY === "number")
            ? document.elementFromPoint(ev.clientX, ev.clientY)
            : null;
          const clickable = (curUnder && curUnder.closest && curUnder.closest("button, a, input, select, [role='button'], .card, .sidebar-menu-row, .tv-elevator-btn, .f-pill, .hero-dot"))
            || (rescueTarget.closest && rescueTarget.closest("button, a, input, select, [role='button'], .card, .sidebar-menu-row, .tv-elevator-btn, .f-pill, .hero-dot"))
            || rescueTarget;
          if (clickable && typeof clickable.click === "function") {
            clickable.click();
          }
        } catch (_re) {}
      }, true);

      document.addEventListener("wheel", () => {
        pendingKbClickRescueEl = null;
        disengageKeyboardNavMode();
      }, { passive: true });

      // Maus-Hover verschiebt die aktive Auswahl direkt auf das gehoverte Objekt (sofern in den Einstellungen aktiviert und Tastatur-Modus NICHT aktiv ist),
      // und aktualisiert die ruhige Fokus-Info-Zeile bei Desktop-Hover auf Katalog-Covern.
      document.addEventListener("mouseover", (ev) => {
        if (isKeyboardNavActive) return;
        const actTag = (document.activeElement && document.activeElement.tagName || "").toUpperCase();
        if (actTag === "INPUT" || actTag === "TEXTAREA" || actTag === "SELECT") return;
        if (window.matchMedia && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
        if (isHeroSliderBlockingCardBarClient()) {
          if (hoverFocusBarClearTimer) { clearTimeout(hoverFocusBarClearTimer); hoverFocusBarClearTimer = null; }
          syncCatalogFocusInfoBarClient(null);
        } else {
          const inBar = Boolean(ev.target && typeof ev.target.closest === "function" && ev.target.closest("#catalogFocusInfoBar"));
          if (inBar) {
            if (hoverFocusBarClearTimer) { clearTimeout(hoverFocusBarClearTimer); hoverFocusBarClearTimer = null; }
            return;
          }
          const hoveredCard = ev.target && typeof ev.target.closest === "function" ? ev.target.closest(".card") : null;
          if (hoveredCard) {
            if (hoverFocusBarClearTimer) { clearTimeout(hoverFocusBarClearTimer); hoverFocusBarClearTimer = null; }
            if (activeInputProfile !== "keyboard" && activeInputProfile !== "firetv" && activeInputProfile !== "tv") {
              activeInputProfile = resolveDefaultInputProfileClient();
            }
            syncCatalogFocusInfoBarClient(hoveredCard);
          } else if (!currentSpatialEl || !(currentSpatialEl.classList && currentSpatialEl.classList.contains("card"))) {
            if (!hoverFocusBarClearTimer) {
              hoverFocusBarClearTimer = setTimeout(() => {
                hoverFocusBarClearTimer = null;
                if (!isKeyboardNavActive) syncCatalogFocusInfoBarClient(null);
              }, 180);
            }
          }
        }
        if (!mouseHoverNavEnabled) return;
        if (Date.now() - lastSelectJumpAt < 450) return;
        const subTarget = ev.target && typeof ev.target.closest === "function" ? ev.target.closest(CARD_SUB_SELECTOR) : null;
        if (subTarget) {
          setSpatialFocus(subTarget, false);
          return;
        }
        const target = ev.target && typeof ev.target.closest === "function" ? ev.target.closest(FOCUSABLE_SELECTOR) : null;
        if (target && !target.disabled && !target.classList.contains("is-current-mode")) {
          const activeCinemaForHover = getActiveForegroundCinemaContextClient();
          if (activeCinemaForHover) {
            const allowedCinemaEls = getCinemaFocusableElementsClient(activeCinemaForHover);
            if (!allowedCinemaEls.includes(target)) return;
          }
          setSpatialFocus(target, false);
        }
      }, { passive: true });

      function engageCardSubNav(cardEl) {
        // Direkte 1-Schritt-Navigation: Kein Sub-Menü auf Covern mehr – Enter/OK öffnet direkt die Details!
        return false;
      }

      function handleSpatialConfirmAction() {
        if (!currentSpatialEl) return;
        if (currentSpatialEl.id === "searchInput") {
          const val = (currentSpatialEl.value || "").trim();
          if (document.activeElement === currentSpatialEl && val.length > 0) {
            closeAutocomplete();
            currentSpatialEl.blur();
            runSearch(false, val, undefined, true);
            return;
          }
          onSearchInputFocus();
          currentSpatialEl.focus();
          return;
        }
        const tag = (currentSpatialEl.tagName || "").toUpperCase();
        if (tag === "SELECT") {
          currentSpatialEl.focus();
          if (typeof currentSpatialEl.showPicker === "function") {
            try { currentSpatialEl.showPicker(); } catch (e) {}
          }
          return;
        }
        // Direkte 1-Schritt-Aktion auf Film-/Serien-Cover: Öffnet sofort die Detailansicht!
        currentSpatialEl.click();
      }

      let edgePushLastStepAt = 0;
      let edgePushArrivedEl = null;
      let edgePushArrivedAt = 0;

      function moveSpatialFocus(dir, suppressScroll = false, isRepeatEvent = false) {
        engageKeyboardNavMode();
        lastSpatialNavDir = dir || "down";
        const list = getVisibleFocusables();
        if (!list.length) return;

        // Falls Fokus per Maus auf einem Karten-Sub-Button lag, sauber zurück auf die Karte für nahtlose Raster-Navigation
        if (currentSpatialEl && isCardSubElement(currentSpatialEl)) {
          const parentCard = currentSpatialEl.closest(".card");
          if (parentCard) {
            clearCardSubnavState(null);
            currentSpatialEl.classList.remove("spatial-focus");
            currentSpatialEl = parentCard;
            currentSpatialEl.classList.add("spatial-focus");
          }
        }

        const elevElForHoverCheck = document.getElementById("tvQuickJumpElevator");
        if (
          elevElForHoverCheck &&
          elevElForHoverCheck.classList.contains("is-hover-expanded") &&
          (!currentSpatialEl || !(currentSpatialEl.closest && currentSpatialEl.closest("#tvQuickJumpElevator")))
        ) {
          if (currentSpatialEl && !(currentSpatialEl.closest && currentSpatialEl.closest("#tvQuickJumpElevator"))) {
            lastElevatorReturnEl = currentSpatialEl;
          }
          const firstElevBtn = document.getElementById("tvElevBtnSearch") || document.getElementById("tvElevBtnBot") || document.getElementById("tvElevBtnTop") || elevElForHoverCheck.querySelector(".tv-elevator-btn");
          if (firstElevBtn) {
            setSpatialFocus(firstElevBtn, false, dir);
            return;
          }
        }

        if (!currentSpatialEl || !list.includes(currentSpatialEl)) {
          userScrolledRecently = false;
          const rawHeroTarget = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active") || document.getElementById("heroBtnTrailer");
          const activeHeroDot = (rawHeroTarget && list.includes(rawHeroTarget)) ? rawHeroTarget : null;
          if (activeHeroDot) {
            setSpatialFocus(activeHeroDot, true, dir);
            return;
          }
          const visibleCards = Array.from(document.querySelectorAll("#resultsGridContainer .card, #appRoot .card")).filter(el => {
            if (!list.includes(el)) return false;
            const r = el.getBoundingClientRect();
            return r.bottom > 64 && r.top < window.innerHeight - 24;
          });
          const fallbackTarget = visibleCards[0] || list.find(el => !(el.closest && (el.closest("#tvQuickJumpElevator") || el.closest("header")))) || list[0];
          setSpatialFocus(fallbackTarget, true, dir);
          return;
        }

        // Viewport-Aware Focus Recovery: Wenn man per Mausrad, Touch oder rechtem Stick gescrollt hat und der alte Fokus nicht mehr im sichtbaren Bereich liegt,
        // springt die Pfeiltasten-Navigation direkt zum ersten im aktuellen Sichtfeld liegenden Element (statt zurück zum alten Fokus zu reißen)!
        if (userScrolledRecently && !state.sidebarOpen) {
          userScrolledRecently = false;
          const curR = currentSpatialEl.getBoundingClientRect();
          const isOffscreen = curR.bottom < 64 || curR.top > window.innerHeight - 24;
          if (isOffscreen) {
            const visibleInViewport = list.filter(cand => {
              if (cand.closest && (cand.closest("header") || cand.closest("#tvQuickJumpElevator"))) return false;
              const r = cand.getBoundingClientRect();
              return r.top >= 58 && r.bottom <= window.innerHeight - 16;
            });
            if (visibleInViewport.length > 0) {
              setSpatialFocus(visibleInViewport[0], false, dir);
              return;
            }
          }
        }

        // Smarte 2-Spalten-Navigation im Ambilight-Glas-Menü (#filterSidebarDrawer):
        // - Links in der Menü-Übersicht (#sidebarDrawerBody): Hoch/Runter läuft sauber einzeilig durch alle Menü-Zeilen; Enter öffnet die ausgewählte Kategorie.
        //   Pfeil Rechts (entgegengesetzte Richtung zum Öffnen nach Links) schließt das linke Menü sofort wieder!
        // - Rechts im Optionen-Panel (#sidebarRightSubPanel): Pfeil Links vom linken Rand führt zurück in die Menü-Übersicht; Pfeil Rechts vom rechten Rand schließt das Menü.
        if (state.sidebarOpen) {
          const inLeftMenuCol = Boolean(currentSpatialEl.closest && currentSpatialEl.closest("#sidebarDrawerBody"));
          const inRightSubCol = Boolean(currentSpatialEl.closest && currentSpatialEl.closest("#sidebarRightSubPanel"));
          if (inLeftMenuCol) {
            if (dir === "right") {
              if (typeof closeFilterSidebar === "function") {
                closeFilterSidebar();
              }
              return;
            }
            if (dir === "left") {
              return;
            }
            const leftRows = Array.from(document.querySelectorAll("#sidebarDrawerBody .sidebar-menu-row")).filter(el => list.includes(el));
            const rowIdx = leftRows.indexOf(currentSpatialEl);
            if (rowIdx !== -1) {
              if (dir === "down") {
                if (rowIdx + 1 < leftRows.length) {
                  setSpatialFocus(leftRows[rowIdx + 1], true, "down");
                }
                return;
              }
              if (dir === "up") {
                if (rowIdx > 0) {
                  setSpatialFocus(leftRows[rowIdx - 1], true, "up");
                } else {
                  const sbHeaderBtn = document.querySelector("#filterSidebarDrawer .sidebar-header .sidebar-collapse-btn, #filterSidebarDrawer .sidebar-header .brand-logo");
                  if (sbHeaderBtn && list.includes(sbHeaderBtn)) setSpatialFocus(sbHeaderBtn, true, "up");
                }
                return;
              }
            }
          } else if (inRightSubCol && (dir === "left" || dir === "right")) {
            const curSubBox = getSpatialLayoutBox(currentSpatialEl);
            const rightPanelItems = Array.from(document.querySelectorAll("#sidebarRightSubPanel " + FOCUSABLE_SELECTOR)).filter(el => list.includes(el));
            if (dir === "left") {
              const hasLeftNeighborInSubPanel = rightPanelItems.some(cand => {
                if (cand === currentSpatialEl) return false;
                const r = getSpatialLayoutBox(cand);
                const vOverlap = Math.min(curSubBox.bottom, r.bottom) - Math.max(curSubBox.top, r.top);
                const isSameRow = vOverlap > 4 || Math.abs((r.top + r.height / 2) - (curSubBox.top + curSubBox.height / 2)) < Math.max(curSubBox.height, r.height) * 0.65;
                return isSameRow && (r.left + r.width / 2) < (curSubBox.left + curSubBox.width / 2) - 6;
              });
              if (!hasLeftNeighborInSubPanel) {
                if (typeof closeSidebarSubPanelToMain === "function") {
                  closeSidebarSubPanelToMain();
                  return;
                }
              }
            } else if (dir === "right") {
              const hasRightNeighborInSubPanel = rightPanelItems.some(cand => {
                if (cand === currentSpatialEl) return false;
                const r = getSpatialLayoutBox(cand);
                const vOverlap = Math.min(curSubBox.bottom, r.bottom) - Math.max(curSubBox.top, r.top);
                const isSameRow = vOverlap > 4 || Math.abs((r.top + r.height / 2) - (curSubBox.top + curSubBox.height / 2)) < Math.max(curSubBox.height, r.height) * 0.65;
                return isSameRow && (r.left + r.width / 2) > (curSubBox.left + curSubBox.width / 2) + 6;
              });
              if (!hasRightNeighborInSubPanel && typeof closeFilterSidebar === "function") {
                closeFilterSidebar();
                return;
              }
            }
          }
        }

        // Referenzen auf die Suchleiste & Kopfzeile
        const sScope = document.getElementById("searchGenreTriggerBtn") || document.getElementById("searchGenreSelect") || document.getElementById("searchScopeSelect");
        const sInp = document.getElementById("searchInput");
        const sClear = document.getElementById("searchClearBtn") || document.querySelector(".search-clear-btn");
        const sSub = document.querySelector(".search-submit-btn");
        const sClearVisible = Boolean(sClear && !sClear.classList.contains("is-empty") && list.includes(sClear));

        const focusSearchOrHeaderUp = () => {
          if (sInp && list.includes(sInp)) {
            setSpatialFocus(sInp, true);
            return true;
          }
          const activeTab = document.querySelector(".media-mode-tab.active-movie, .media-mode-tab.active-series, .media-mode-tab");
          if (activeTab && list.includes(activeTab)) {
            setSpatialFocus(activeTab, true);
            return true;
          }
          const menuBtn = document.getElementById("sidebarToggleBtn");
          if (menuBtn && list.includes(menuBtn)) {
            setSpatialFocus(menuBtn, true);
            return true;
          }
          return false;
        };

        // Falls eine aufgeklappte Beschreibungs-Scrollbox (.expandable-desc-box.is-expanded) fokussiert ist:
        // Hoch/Runter scrollt zuerst weich durch den Beschreibungstext!
        if (currentSpatialEl.classList && currentSpatialEl.classList.contains("expandable-desc-box") && currentSpatialEl.classList.contains("is-expanded")) {
          const sc = currentSpatialEl.querySelector(".expandable-desc-scroll");
          if (sc && (dir === "down" || dir === "up")) {
            const maxSc = Math.max(0, sc.scrollHeight - sc.clientHeight);
            if (dir === "down" && sc.scrollTop < maxSc - 4) {
              sc.scrollBy({ top: 44, behavior: "smooth" });
              return;
            }
            if (dir === "up" && sc.scrollTop > 4) {
              sc.scrollBy({ top: -44, behavior: "smooth" });
              return;
            }
          }
        }

        const curHero = currentSpatialEl.closest ? currentSpatialEl.closest(".hero") : null;
        if (curHero) {
          const actDot = curHero.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || curHero.querySelector(".hero-dot.active");
          const trBtn = document.getElementById("heroBtnTrailer");
          const detBtn = document.getElementById("heroBtnDetails");
          const wlHeroBtn = document.getElementById("heroBtnWishlist");
          const descHeroEl = document.getElementById("heroDescEl");
          const hideBtn = document.getElementById("heroHideBtn");

          const scrollDownFromHeroToCatalog = () => {
            const usesCurtainCollapse = Boolean(document.getElementById("heroCurtainShell"));
            if (typeof scrollToCatalogBelowHeroClient === "function") {
              scrollToCatalogBelowHeroClient(null, { bounceLock: true });
            }
            const focusFirstCatalogEntry = () => {
              const firstCatalogCard = document.querySelector("#resultsGridContainer .card, #appRoot .card");
              const fallbackFilterEl = document.querySelector(".floating-filter-bar .f-pill, .floating-filter-bar .sort-select, .floating-filter-bar .mode-filter-select, .floating-filter-bar .new-filter-select");
              const targetEl = firstCatalogCard || fallbackFilterEl;
              if (usesCurtainCollapse) {
                if ((window.scrollY || window.pageYOffset || 0) !== 0) {
                  window.scrollTo(0, 0);
                }
                if (targetEl) {
                  jumpSpatialFocus(targetEl, false, "down");
                }
              } else if (targetEl) {
                jumpSpatialFocus(targetEl, false, "down");
                const topBarH = (document.getElementById("topUnifiedBar")?.offsetHeight) || 54;
                const r = targetEl.getBoundingClientRect();
                const curY = window.scrollY || window.pageYOffset || 0;
                const destY = Math.max(0, Math.round(curY + r.top - topBarH - 18));
                window.scrollTo({ top: destY, behavior: "smooth" });
              }
            };
            focusFirstCatalogEntry();
            requestAnimationFrame(() => {
              if (usesCurtainCollapse && (window.scrollY || window.pageYOffset || 0) !== 0) {
                window.scrollTo(0, 0);
              }
            });
          };

          const focusHeroDescOrHeaderUp = () => {
            if (descHeroEl && typeof syncExpandableDescriptionsOverflowClient === "function") {
              syncExpandableDescriptionsOverflowClient(descHeroEl);
            }
            const descFocusable = Boolean(descHeroEl && (descHeroEl.classList.contains("is-long-desc") || descHeroEl.classList.contains("is-expanded")));
            if (descHeroEl && (descFocusable || list.includes(descHeroEl))) {
              setSpatialFocus(descHeroEl, true, "up");
              return true;
            }
            return focusSearchOrHeaderUp();
          };

          if (currentSpatialEl.id === "heroDescEl") {
            if (dir === "down") {
              if (trBtn) { setSpatialFocus(trBtn, true, "down"); return; }
              if (detBtn) { setSpatialFocus(detBtn, true, "down"); return; }
            }
            if (dir === "up") {
              if (focusSearchOrHeaderUp()) return;
            }
            if (dir === "left" || dir === "right") {
              setHeroSlideIndex(state.heroIndex + (dir === "right" ? 1 : -1));
              const nextDesc = document.getElementById("heroDescEl");
              if (nextDesc && typeof syncExpandableDescriptionsOverflowClient === "function") {
                syncExpandableDescriptionsOverflowClient(nextDesc);
              }
              const nextDescFocusable = Boolean(nextDesc && (nextDesc.classList.contains("is-long-desc") || nextDesc.classList.contains("is-expanded")));
              if (nextDescFocusable) {
                setSpatialFocus(nextDesc, true, dir);
              } else {
                const nextTr = document.getElementById("heroBtnTrailer") || document.getElementById("heroBtnDetails");
                if (nextTr) setSpatialFocus(nextTr, true, dir);
              }
              return;
            }
          } else if (currentSpatialEl.id === "heroBtnTrailer") {
            if (dir === "right") {
              if (detBtn) { setSpatialFocus(detBtn, true); return; }
              if (wlHeroBtn) { setSpatialFocus(wlHeroBtn, true); return; }
            }
            if (dir === "left") {
              setHeroSlideIndex(state.heroIndex - 1);
              const nextTr = document.getElementById("heroBtnTrailer");
              if (nextTr) setSpatialFocus(nextTr, true);
              return;
            }
            if (dir === "down") {
              scrollDownFromHeroToCatalog();
              return;
            }
            if (dir === "up") {
              if (focusHeroDescOrHeaderUp()) return;
            }
          } else if (currentSpatialEl.id === "heroBtnDetails") {
            if (dir === "left") {
              if (trBtn) { setSpatialFocus(trBtn, true); return; }
            }
            if (dir === "right") {
              if (wlHeroBtn) { setSpatialFocus(wlHeroBtn, true); return; }
              setHeroSlideIndex(state.heroIndex + 1);
              const nextDet = document.getElementById("heroBtnDetails");
              if (nextDet) setSpatialFocus(nextDet, true);
              return;
            }
            if (dir === "down") {
              scrollDownFromHeroToCatalog();
              return;
            }
            if (dir === "up") {
              if (focusHeroDescOrHeaderUp()) return;
            }
          } else if (currentSpatialEl.id === "heroBtnWishlist") {
            if (dir === "left") {
              if (detBtn) { setSpatialFocus(detBtn, true); return; }
              if (trBtn) { setSpatialFocus(trBtn, true); return; }
            }
            if (dir === "right") {
              setHeroSlideIndex(state.heroIndex + 1);
              const nextWl = document.getElementById("heroBtnWishlist");
              if (nextWl) setSpatialFocus(nextWl, true);
              return;
            }
            if (dir === "down") {
              scrollDownFromHeroToCatalog();
              return;
            }
            if (dir === "up") {
              if (focusHeroDescOrHeaderUp()) return;
            }
          } else if (currentSpatialEl.classList.contains("hero-dot") || currentSpatialEl.classList.contains("hero-circle-arrow")) {
            // Punktleiste (< • • • • ━━ • >): Links/Rechts blättert, Hoch zurück zu Trailer, Runter direkt ins Cover-Grid
            if (dir === "left" || dir === "right") {
              setHeroSlideIndex(state.heroIndex + (dir === "right" ? 1 : -1));
              const nextDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active");
              if (nextDot) setSpatialFocus(nextDot, true);
              return;
            }
            if (dir === "up") {
              if (trBtn) { setSpatialFocus(trBtn, true); return; }
              if (detBtn) { setSpatialFocus(detBtn, true); return; }
              if (focusSearchOrHeaderUp()) return;
            }
            if (dir === "down") {
              scrollDownFromHeroToCatalog();
              return;
            }
          }
        }

        // Kompakter 1-Zeilen Spotlight-Strip (.hero-collapsed-strip): Hoch springt direkt zur Suche (#searchInput)
        const curCollapsedStrip = currentSpatialEl.closest ? currentSpatialEl.closest(".hero-collapsed-strip") : null;
        if (curCollapsedStrip && dir === "up") {
          if (focusSearchOrHeaderUp()) return;
        }

        // Deterministische Hoch/Runter-Navigation innerhalb der Such-Vorschlagsliste (#searchAutocompleteBox)
        const inAutocompleteBox = Boolean(currentSpatialEl.closest && currentSpatialEl.closest("#searchAutocompleteBox"));
        if (inAutocompleteBox) {
          const acItems = Array.from(document.querySelectorAll("#searchAutocompleteBox.open .ac-item")).filter(el => list.includes(el));
          const acIdx = acItems.indexOf(currentSpatialEl);
          if (dir === "down") {
            if (acIdx !== -1 && acIdx + 1 < acItems.length) {
              setSpatialFocus(acItems[acIdx + 1], true, "down");
              return;
            }
            const firstBelowCard = document.querySelector("#resultsGridContainer .card, .floating-filter-bar .f-pill, #appRoot .card");
            if (firstBelowCard && list.includes(firstBelowCard)) {
              closeAutocomplete();
              setSpatialFocus(firstBelowCard, true, "down");
            }
            return;
          }
          if (dir === "up") {
            if (acIdx > 0) {
              setSpatialFocus(acItems[acIdx - 1], true, "up");
              return;
            }
            if (sInp && list.includes(sInp)) {
              if (typeof setAutocompleteHighlightIndexClient === "function") setAutocompleteHighlightIndexClient(-1);
              setSpatialFocus(sInp, true, "up");
              try { sInp.focus(); } catch (e) {}
              return;
            }
          }
          if (dir === "left" || dir === "right") {
            return;
          }
        }

        // Einzeilige Top-Leiste (<header id="topUnifiedBar" class="search-bar-outer">):
        // Deterministische Links/Rechts-Reihenfolge über alle 38px-Elemente (☰ Menü / ← Zurück -> Logo -> Filme -> Serien -> Genre -> Suche -> ✕ -> 🔍 -> 💾 Merkliste -> ▴ Einklappen / ◀ ▶)
        const topHideBtn = document.getElementById("heroHideBtn");
        const topHideVisible = Boolean(topHideBtn && list.includes(topHideBtn));
        const topBackBtn = document.getElementById("topBarBackBtn");
        const topPrevAdjBtn = document.getElementById("modalAdjPrevBtn");
        const topNextAdjBtn = document.getElementById("modalAdjNextBtn");
        const mobCollapseBtn = document.getElementById("mobileSearchCollapseBtn");
        const inGenreOverlay = Boolean(currentSpatialEl.closest && currentSpatialEl.closest("#searchGenreDropdownOverlay"));
        const inHeader = !inAutocompleteBox && !inGenreOverlay && Boolean(
          (currentSpatialEl.closest && (currentSpatialEl.closest("header") || currentSpatialEl.closest(".search-bar-outer"))) ||
          currentSpatialEl === topBackBtn ||
          currentSpatialEl === topPrevAdjBtn ||
          currentSpatialEl === topNextAdjBtn ||
          currentSpatialEl === mobCollapseBtn ||
          currentSpatialEl === sScope ||
          currentSpatialEl === sInp ||
          currentSpatialEl === sClear ||
          currentSpatialEl === sSub ||
          currentSpatialEl === topHideBtn
        );
        if (currentSpatialEl && currentSpatialEl.id === "wishlistSearchInp" && dir === "down") {
          if (searchShortcutReturnCardEl && document.body.contains(searchShortcutReturnCardEl) && list.includes(searchShortcutReturnCardEl)) {
            const returnCard = searchShortcutReturnCardEl;
            searchShortcutReturnCardEl = null;
            setSpatialFocus(returnCard, true, "down");
            return;
          }
        }

        if (inHeader) {
          if (dir === "left" || dir === "right") {
            const headerOrder = [
              document.getElementById("sidebarToggleBtn"),
              topBackBtn,
              document.getElementById("headerBrandLogo"),
              document.getElementById("tabBtnMovies"),
              document.getElementById("tabBtnSeries"),
              mobCollapseBtn,
              sScope,
              sInp,
              sClearVisible ? sClear : null,
              sSub,
              document.getElementById("navBtnWishlist"),
              topHideVisible ? topHideBtn : null,
              topPrevAdjBtn,
              topNextAdjBtn
            ].filter(el => el && list.includes(el));
            const hIdx = headerOrder.indexOf(currentSpatialEl);
            if (hIdx !== -1) {
              const nextHIdx = dir === "right" ? hIdx + 1 : hIdx - 1;
              if (nextHIdx >= 0 && nextHIdx < headerOrder.length) {
                setSpatialFocus(headerOrder[nextHIdx], true, dir);
              }
              return;
            }
          }
          if (dir === "up") {
            const modalBackdropEl = document.querySelector("#modalRoot .modal-backdrop");
            if (modalBackdropEl && modalBackdropEl.scrollTop > 10) {
              modalBackdropEl.scrollTo({ top: 0, behavior: "smooth" });
            } else if ((window.scrollY || window.pageYOffset || 0) > 15) {
              window.scrollTo({ top: 0, behavior: "smooth" });
            } else if (!modalBackdropEl && typeof expandHeroSliderAndFocusClient === "function") {
              const isHeroCollapsedNow = Boolean(
                (typeof heroCurtainScrolledToCatalog !== "undefined" && heroCurtainScrolledToCatalog) ||
                (document.body && document.body.classList.contains("hero-scrolled-past")) ||
                state.heroHidden
              );
              if (isHeroCollapsedNow) {
                expandHeroSliderAndFocusClient("hero");
              }
            }
            return;
          }
          if (dir === "down") {
            const firstGenreChip = document.querySelector("#searchGenreDropdownOverlay.open .genre-overlay-chip.active, #searchGenreDropdownOverlay.open .genre-overlay-chip");
            if (firstGenreChip && list.includes(firstGenreChip)) {
              setSpatialFocus(firstGenreChip, !suppressScroll);
              return;
            }
            const firstAc = document.querySelector("#searchAutocompleteBox.open .ac-item");
            if (firstAc && list.includes(firstAc)) {
              setSpatialFocus(firstAc, !suppressScroll);
              return;
            }
            // Exakter Rücksprung zum ursprünglich gewählten Film, von dem aus „Pfeil oben halten -> Suche“ gestartet wurde
            if (searchShortcutReturnCardEl && document.body.contains(searchShortcutReturnCardEl) && list.includes(searchShortcutReturnCardEl)) {
              const returnCard = searchShortcutReturnCardEl;
              searchShortcutReturnCardEl = null;
              setSpatialFocus(returnCard, true, "down");
              return;
            }
            const isScrolledPastHero = Boolean(
              (typeof heroCurtainScrolledToCatalog !== "undefined" && heroCurtainScrolledToCatalog) ||
              (document.body && document.body.classList.contains("hero-scrolled-past")) ||
              state.heroHidden
            );
            if (!isScrolledPastHero) {
              const heroTr = document.getElementById("heroBtnTrailer") || document.getElementById("heroBtnDetails");
              if (heroTr && list.includes(heroTr)) {
                setSpatialFocus(heroTr, !suppressScroll);
                return;
              }
            }
            // Express-Sprung aus der Kopfzeile direkt auf das erste Cover (Filterleiste bleibt gezielt per 1× Hoch ab der obersten Cover-Reihe erreichbar!)
            const firstDirectCard = document.querySelector("#resultsGridContainer .card, #appRoot .card");
            if (firstDirectCard && list.includes(firstDirectCard)) {
              setSpatialFocus(firstDirectCard, !suppressScroll, "down");
              return;
            }
            const firstFilterFallback = document.querySelector(".floating-filter-bar .f-pill, .floating-filter-bar .sort-select, .floating-filter-bar .mode-filter-select");
            if (firstFilterFallback && list.includes(firstFilterFallback)) {
              setSpatialFocus(firstFilterFallback, !suppressScroll, "down");
              return;
            }
          }
        }

        // Deterministische 2-Spalten-Navigation innerhalb des rechten Menüs (#tvQuickJumpElevator + #rightMenuSubPanel)
        const inTvElevator = Boolean(currentSpatialEl.closest && currentSpatialEl.closest("#tvQuickJumpElevator"));
        const inRightMenuSubPanel = Boolean(currentSpatialEl.closest && currentSpatialEl.closest("#rightMenuSubPanel"));
        if (inTvElevator) {
          const elevContainer = document.getElementById("tvQuickJumpElevator");
          if (!inRightMenuSubPanel) {
            const elevBtns = Array.from(document.querySelectorAll("#tvQuickJumpElevator .tv-elevator-main-col .tv-elevator-btn")).filter(el => !el.disabled);
            const eIdx = elevBtns.indexOf(currentSpatialEl);
            if (dir === "up" || dir === "down") {
              if (elevBtns.length > 0) {
                const nextEIdx = dir === "down"
                  ? ((eIdx + 1) % elevBtns.length)
                  : ((eIdx - 1 + elevBtns.length) % elevBtns.length);
                setSpatialFocus(elevBtns[nextEIdx], false, dir);
              }
              return;
            }
            if (dir === "left") {
              // Entgegengesetzte Richtung zum Öffnen nach Rechts -> schließt das rechte Seitenmenü sofort wieder (Enter öffnet den ausgewählten Eintrag)
              if (typeof closeRightMenuOverlayClient === "function") {
                closeRightMenuOverlayClient(null, true);
              } else {
                if (typeof closeRightMenuSubPanelClient === "function") closeRightMenuSubPanelClient(false);
                if (elevContainer) elevContainer.classList.remove("is-visible", "is-hover-expanded", "has-subpanel");
              }
              if (lastElevatorReturnEl && document.body.contains(lastElevatorReturnEl) && list.includes(lastElevatorReturnEl)) {
                setSpatialFocus(lastElevatorReturnEl, true, "left");
                return;
              }
              const visibleCards = Array.from(document.querySelectorAll("#resultsGridContainer .card, #appRoot .card")).filter(el => {
                if (!list.includes(el)) return false;
                const r = el.getBoundingClientRect();
                return r.top >= 48 && r.bottom <= window.innerHeight + 40;
              });
              if (visibleCards.length > 0) {
                visibleCards.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
                setSpatialFocus(visibleCards[0], false, "left");
                return;
              }
              return;
            }
            if (dir === "right") {
              return;
            }
          } else if (dir === "right" || dir === "left") {
            const curSubBox = getSpatialLayoutBox(currentSpatialEl);
            const subItems = Array.from(document.querySelectorAll("#rightMenuSubPanel " + FOCUSABLE_SELECTOR)).filter(el => list.includes(el));
            if (dir === "right") {
              const hasRightInSub = subItems.some(cand => {
                if (cand === currentSpatialEl) return false;
                const r = getSpatialLayoutBox(cand);
                const vOverlap = Math.min(curSubBox.bottom, r.bottom) - Math.max(curSubBox.top, r.top);
                const isSameRow = vOverlap > 4 || Math.abs((r.top + r.height / 2) - (curSubBox.top + curSubBox.height / 2)) < Math.max(curSubBox.height, r.height) * 0.65;
                return isSameRow && (r.left + r.width / 2) > (curSubBox.left + curSubBox.width / 2) + 6;
              });
              if (!hasRightInSub) {
                const activeTabBtn = document.getElementById(state.rightMenuTab === "recent" ? "tvElevBtnRecent" : "tvElevBtnWishlist") || document.getElementById("tvElevBtnSearch");
                if (activeTabBtn) {
                  setSpatialFocus(activeTabBtn, false, "right");
                  return;
                }
              }
            } else if (dir === "left") {
              const hasLeftInSub = subItems.some(cand => {
                if (cand === currentSpatialEl) return false;
                const r = getSpatialLayoutBox(cand);
                const vOverlap = Math.min(curSubBox.bottom, r.bottom) - Math.max(curSubBox.top, r.top);
                const isSameRow = vOverlap > 4 || Math.abs((r.top + r.height / 2) - (curSubBox.top + curSubBox.height / 2)) < Math.max(curSubBox.height, r.height) * 0.65;
                return isSameRow && (r.left + r.width / 2) < (curSubBox.left + curSubBox.width / 2) - 6;
              });
              if (!hasLeftInSub) {
                if (typeof closeRightMenuSubPanelClient === "function") closeRightMenuSubPanelClient(false);
                if (elevContainer) elevContainer.classList.remove("is-visible", "is-hover-expanded", "has-subpanel");
                if (lastElevatorReturnEl && document.body.contains(lastElevatorReturnEl) && list.includes(lastElevatorReturnEl)) {
                  setSpatialFocus(lastElevatorReturnEl, true, "left");
                  return;
                }
              }
            }
          }
        }

        // Deterministische Links/Rechts-Steuerung im Sidebar-Header (.sidebar-header) inkl. Sidebar-Logo (#sidebarBrandLogo)
        const inSidebarHeader = Boolean(currentSpatialEl.closest && currentSpatialEl.closest(".sidebar-header"));
        if (inSidebarHeader && (dir === "left" || dir === "right")) {
          const sbHeaderEl = currentSpatialEl.closest(".sidebar-header");
          const sbHeaderItems = Array.from(sbHeaderEl.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => list.includes(el));
          const shIdx = sbHeaderItems.indexOf(currentSpatialEl);
          if (shIdx !== -1) {
            const nextShIdx = dir === "right" ? shIdx + 1 : shIdx - 1;
            if (nextShIdx >= 0 && nextShIdx < sbHeaderItems.length) {
              setSpatialFocus(sbHeaderItems[nextShIdx], !suppressScroll, dir);
            } else if (dir === "right" && typeof closeFilterSidebar === "function") {
              closeFilterSidebar();
            }
            return;
          }
        }

        // Von der obersten Zeile der Filterleiste (.floating-filter-bar) führt Pfeil hoch (⬆) direkt in den Hero-Slider (fährt ihn ggf. wieder aus) / Suchleiste
        const curFF = currentSpatialEl.closest ? currentSpatialEl.closest(".floating-filter-bar") : null;
        if (curFF && dir === "up") {
          const curBoxFF = getSpatialLayoutBox(currentSpatialEl);
          const hasHigherInFF = list.some(cand =>
            cand !== currentSpatialEl &&
            curFF.contains(cand) &&
            getSpatialLayoutBox(cand).bottom <= curBoxFF.top + 6
          );
          if (!hasHigherInFF) {
            if (typeof expandHeroSliderAndFocusClient === "function" && expandHeroSliderAndFocusClient("hero")) {
              return;
            }
            const actHeroDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active");
            const heroTr = document.getElementById("heroBtnTrailer");
            const restoreBtn = document.getElementById("heroRestoreBtn");
            if (actHeroDot && list.includes(actHeroDot)) {
              setSpatialFocus(actHeroDot, !suppressScroll);
              return;
            }
            if (heroTr && list.includes(heroTr)) {
              setSpatialFocus(heroTr, !suppressScroll);
              return;
            }
            if (restoreBtn && list.includes(restoreBtn)) {
              setSpatialFocus(restoreBtn, !suppressScroll);
              return;
            }
            if (focusSearchOrHeaderUp()) return;
          }
        }

        // Deterministische Links/Rechts-Navigation innerhalb horizontaler Cover-Slider (.detail-cast-track / .detail-similar-track),
        // damit Pfeil Rechts/Links lückenlos Karte für Karte durch den Slider wandert und das Sichtfeld automatisch mitscrollt!
        const curHorizTrack = currentSpatialEl.closest
          ? currentSpatialEl.closest(".detail-cast-track, .detail-similar-track")
          : null;
        if (curHorizTrack && (dir === "left" || dir === "right")) {
          const trackCards = Array.from(curHorizTrack.querySelectorAll(".detail-cast-card, .detail-sim-card")).filter(el => list.includes(el));
          const tIdx = trackCards.indexOf(currentSpatialEl);
          if (tIdx !== -1) {
            const nextTIdx = dir === "right" ? tIdx + 1 : tIdx - 1;
            if (nextTIdx >= 0 && nextTIdx < trackCards.length) {
              setSpatialFocus(trackCards[nextTIdx], !suppressScroll, dir);
            }
            return;
          }
        }

        const curRect = getSpatialLayoutBox(curHero ? curHero : currentSpatialEl);
        const cx = curRect.left + curRect.width / 2;
        const cy = curRect.top + curRect.height / 2;

        // Rechts-Rand-Ausbruch & Links-Rand-Ausbruch + Intelligente Zonen-Übergänge (Filterleiste ↔ Hero-Slider ↔ Cover-Grid)
        const hasOverlayBlockingElevator = Boolean(
          document.getElementById("modalRoot")?.innerHTML.trim() ||
          document.getElementById("lightboxRoot")?.innerHTML.trim() ||
          document.getElementById("customDialogRoot")?.innerHTML.trim() ||
          state.sidebarOpen
        );
        const isCurrentCatalogCard = Boolean(currentSpatialEl.classList && currentSpatialEl.classList.contains("card"));
        const inFloatingFilterBar = Boolean(currentSpatialEl.closest && currentSpatialEl.closest(".floating-filter-bar"));

        // 1) In der Filterleiste: Hoch fährt Hero-Slider wieder aus (oder geht zur Suche); Runter springt direkt auf das erste Cover
        if (inFloatingFilterBar && !hasOverlayBlockingElevator) {
          if (dir === "up") {
            if (typeof expandHeroSliderAndFocusClient === "function" && expandHeroSliderAndFocusClient("hero")) {
              return;
            }
            if (focusSearchOrHeaderUp()) return;
          }
          if (dir === "down") {
            const firstCardBelowFilter = document.querySelector("#resultsGridContainer .card, #appRoot .card");
            if (firstCardBelowFilter && list.includes(firstCardBelowFilter)) {
              setSpatialFocus(firstCardBelowFilter, !suppressScroll, "down");
              return;
            }
          }
        }

        // 2) Oberste Reihe im Cover-Grid + Hoch: gezielt in die Filterleiste (oder Hero-Slider wieder ausfahren)
        if (isCurrentCatalogCard && dir === "up" && !hasOverlayBlockingElevator && currentSpatialEl.closest && currentSpatialEl.closest("#resultsGridContainer")) {
          const hasCardAbove = list.some(cand => {
            if (cand === currentSpatialEl || !(cand.classList && cand.classList.contains("card"))) return false;
            if (!cand.closest || !cand.closest("#resultsGridContainer")) return false;
            const r = getSpatialLayoutBox(cand);
            return (r.top + r.height / 2) < cy - 24;
          });
          if (!hasCardAbove) {
            const filterTarget = document.querySelector(".floating-filter-bar .mode-filter-select, .floating-filter-bar .sort-select, .floating-filter-bar .f-pill, .floating-filter-bar .new-filter-select");
            if (filterTarget && list.includes(filterTarget)) {
              setSpatialFocus(filterTarget, !suppressScroll, "up");
              return;
            }
            if (typeof expandHeroSliderAndFocusClient === "function" && expandHeroSliderAndFocusClient("hero")) {
              return;
            }
            if (focusSearchOrHeaderUp()) return;
          }
        }

        if (
          dir === "right" &&
          !hasOverlayBlockingElevator &&
          !inHeader &&
          !curHero &&
          !inTvElevator &&
          !curHorizTrack &&
          currentSpatialEl.closest &&
          currentSpatialEl.closest("#appRoot")
        ) {
          const hasRightNeighborInSameRow = list.some(cand => {
            if (cand === currentSpatialEl) return false;
            if (cand.id === "smartPageIndicatorBtn" || cand.id === "catalogBackToTopFab") return false;
            if (cand.closest && (cand.closest("#tvQuickJumpElevator") || cand.closest("header"))) return false;
            if (isCurrentCatalogCard && !(cand.classList && cand.classList.contains("card"))) return false;
            const r = getSpatialLayoutBox(cand);
            const cTx = r.left + r.width / 2;
            const cTy = r.top + r.height / 2;
            if (cTx <= cx + 6) return false;
            const vOverlap = Math.min(curRect.bottom, r.bottom) - Math.max(curRect.top, r.top);
            return vOverlap > 4 || Math.abs(cTy - cy) < Math.max(curRect.height, r.height) * 0.62;
          });
          if (!hasRightNeighborInSameRow) {
            const nowEdge = Date.now();
            if (isRepeatEvent && edgePushArrivedEl !== currentSpatialEl && (nowEdge - edgePushLastStepAt < 200)) {
              edgePushArrivedEl = currentSpatialEl;
              edgePushArrivedAt = nowEdge;
              return;
            }
            if (isRepeatEvent && edgePushArrivedEl === currentSpatialEl && (nowEdge - edgePushArrivedAt < 180)) {
              return;
            }
            edgePushArrivedEl = null;
            const elevContainer = document.getElementById("tvQuickJumpElevator");
            if (elevContainer) {
              lastElevatorReturnEl = currentSpatialEl;
              if (typeof openRightMenuOverlayClient === "function") {
                openRightMenuOverlayClient(true);
              } else {
                elevContainer.classList.remove("is-dismissed");
                elevContainer.classList.add("is-visible");
              }
              const targetElevBtn = document.getElementById("tvElevBtnWishlist") || document.getElementById("tvElevBtnSearch") || elevContainer.querySelector(".tv-elevator-btn");
              if (targetElevBtn) {
                setSpatialFocus(targetElevBtn, false, "right");
                return;
              }
            }
          }
        }

        // Links-Rand-Ausbruch: Am linken Rand einer Zeile öffnet Weiterdrücken nach Links sofort das linke Menü (#filterSidebarDrawer)!
        if (
          dir === "left" &&
          !hasOverlayBlockingElevator &&
          !inHeader &&
          !curHero &&
          !inTvElevator &&
          !curHorizTrack &&
          currentSpatialEl.closest &&
          currentSpatialEl.closest("#appRoot")
        ) {
          const hasLeftNeighborInSameRow = list.some(cand => {
            if (cand === currentSpatialEl) return false;
            if (cand.id === "smartPageIndicatorBtn" || cand.id === "catalogBackToTopFab") return false;
            if (cand.closest && (cand.closest("#tvQuickJumpElevator") || cand.closest("header"))) return false;
            if (isCurrentCatalogCard && !(cand.classList && cand.classList.contains("card"))) return false;
            const r = getSpatialLayoutBox(cand);
            const cTx = r.left + r.width / 2;
            const cTy = r.top + r.height / 2;
            if (cTx >= cx - 6) return false;
            const vOverlap = Math.min(curRect.bottom, r.bottom) - Math.max(curRect.top, r.top);
            return vOverlap > 4 || Math.abs(cTy - cy) < Math.max(curRect.height, r.height) * 0.62;
          });
          if (!hasLeftNeighborInSameRow) {
            const nowEdge = Date.now();
            if (isRepeatEvent && edgePushArrivedEl !== currentSpatialEl && (nowEdge - edgePushLastStepAt < 200)) {
              edgePushArrivedEl = currentSpatialEl;
              edgePushArrivedAt = nowEdge;
              return;
            }
            if (isRepeatEvent && edgePushArrivedEl === currentSpatialEl && (nowEdge - edgePushArrivedAt < 180)) {
              return;
            }
            edgePushArrivedEl = null;
            if (typeof toggleFilterSidebar === "function") {
              lastElevatorReturnEl = currentSpatialEl;
              toggleFilterSidebar();
              return;
            }
          }
        }

        let bestEl = null;
        let bestScore = Infinity;

        for (const cand of list) {
          if (cand === currentSpatialEl) continue;
          // Schwebende Rand-Widgets (#tvQuickJumpElevator, #smartPageIndicatorBtn, #catalogBackToTopFab) bei normaler Raster-Suche überspringen
          if (
            cand.id === "smartPageIndicatorBtn" ||
            cand.id === "catalogBackToTopFab" ||
            (!inRightMenuSubPanel && cand.closest && cand.closest("#tvQuickJumpElevator")) ||
            (inRightMenuSubPanel && !(cand.closest && cand.closest("#rightMenuSubPanel")))
          ) {
            continue;
          }
          const candHero = cand.closest ? cand.closest(".hero") : null;
          if (curHero && candHero) {
            // Beim Verlassen des Hero-Banners nach Oben/Unten alle anderen internen Hero-Elemente überspringen
            continue;
          }
          if (!curHero && candHero) {
            // Von außerhalb in den Hero-Slider navigieren:
            // Direkt auf den aktiven Slide-Indikator (.hero-dot.active) springen (oder #heroBtnTrailer falls nur 1 Slide existiert),
            // damit man sofort mit Pfeil Links/Rechts durch die Highlights blättern oder mit Enter/Hoch den Trailer/Details öffnen kann!
            const hasActiveDot = Boolean(candHero.querySelector(".hero-dot.active"));
            if (hasActiveDot) {
              if (!cand.classList.contains("hero-dot") || !cand.classList.contains("active")) {
                continue;
              }
            } else if (cand.id !== "heroBtnTrailer") {
              continue;
            }
          }

          // Wenn man von oben/unten in einen horizontalen Slider (.detail-cast-track / .detail-similar-track) wechselt,
          // dürfen nur Karten angewählt werden, die aktuell im sichtbaren horizontalen Ausschnitt des Tracks liegen!
          const candHorizTrack = cand.closest
            ? cand.closest(".detail-cast-track, .detail-similar-track")
            : null;
          if (candHorizTrack && candHorizTrack !== curHorizTrack) {
            const trRect = candHorizTrack.getBoundingClientRect();
            const cRect = cand.getBoundingClientRect();
            const isHorizVisible = (cRect.right > trRect.left + 24) && (cRect.left < trRect.right - 24);
            if (!isHorizVisible) {
              const firstCard = candHorizTrack.querySelector(".detail-cast-card, .detail-sim-card");
              if (cand !== firstCard) continue;
            }
          }

          const r = getSpatialLayoutBox((!curHero && candHero) ? candHero : cand);
          // Nächsten Punkt auf der Bounding-Box berechnen (verhindert das Überspringen breiter Elemente wie #searchInput oder .hero)
          const nearestX = Math.max(r.left, Math.min(cx, r.right));
          const nearestY = Math.max(r.top, Math.min(cy, r.bottom));
          const centerTx = r.left + r.width / 2;
          const centerTy = r.top + r.height / 2;

          const dxCenter = centerTx - cx;
          const dyCenter = centerTy - cy;
          const dxEdge = nearestX - cx;
          const dyEdge = nearestY - cy;

          if (dir === "right" && centerTx <= cx + 4) continue;
          if (dir === "left" && centerTx >= cx - 4) continue;
          if (dir === "down" && centerTy <= cy + 4) continue;
          if (dir === "up" && centerTy >= cy - 4) continue;

          // Prüfen, ob das Element auf derselben horizontalen Zeile liegt
          const verticalOverlap = Math.min(curRect.bottom, r.bottom) - Math.max(curRect.top, r.top);
          const isSameRow = verticalOverlap > 4 || Math.abs(dyCenter) < Math.max(curRect.height, r.height) * 0.65;

          let score;
          if (dir === "left" || dir === "right") {
            const hDist = Math.min(Math.abs(dxEdge), Math.abs(dxCenter));
            const vPenalty = isSameRow ? Math.abs(dyCenter) * 0.5 : (Math.abs(dyCenter) * 4.5 + 180);
            score = hDist + vPenalty;
          } else {
            const vDist = Math.min(Math.abs(dyEdge), Math.abs(dyCenter));
            const hPenalty = Math.abs(dxEdge) * 1.8;
            score = vDist + hPenalty;
          }

          if (score < bestScore) {
            bestScore = score;
            bestEl = cand;
          }
        }

        if (bestEl) {
          if (dir === "left" || dir === "right") {
            edgePushLastStepAt = Date.now();
            edgePushArrivedEl = null;
          }
          setSpatialFocus(bestEl, !suppressScroll, dir);
        } else {
          // Vertikales Rand-Wrap-Around am unteren Ende nur bei bewusstem Einzeltipp (nicht beim Gedrückthalten!)
          if (!suppressScroll && !isRepeatEvent && verticalTurboStreak <= 1 && dir === "down" && !hasOverlayBlockingElevator && typeof tvElevatorJumpClient === "function") {
            tvElevatorJumpClient("top", true);
            return;
          }
          // Kein weiteres Element in dieser Richtung vorhanden -> Fokus bleibt sauber im Sichtfeld auf dem aktuellen Element
          if (!suppressScroll) {
            useSpatialScrollIntoView(currentSpatialEl, dir);
          }
        }
      }

      // Long-Press Pfeiltasten-Navigation (~450ms) im Detail-Modal (vorheriger/nächster Film)
      // Hinweistext erscheint erst nach 220ms echtem Gedrückthalten, damit kurzes Antippen niemals nervt!
      const HOLD_NAV_DURATION_MS = 450;
      const HOLD_NAV_SHOW_DELAY_MS = 220;
      let modalHoldTimer = null;
      let modalHoldShowTimer = null;
      let modalHoldActiveKey = "";
      let modalHoldTriggered = false;

      // Enter / Fire TV OK auf Film-Cover: Kurz drücken = Direkt Details öffnen, Gedrückthalten (>= 380ms) = Merkliste umschalten!
      const CARD_ENTER_HOLD_MS = 380;
      let cardEnterHoldTimer = null;
      let cardEnterHoldTarget = null;
      let cardEnterHoldTriggered = false;

      function isConfirmSelectKeyClient(ev) {
        return Boolean(ev && (ev.key === "Enter" || ev.key === "Select" || ev.keyCode === 23));
      }

      function isMediaPlayPauseKeyClient(ev) {
        return Boolean(ev && (ev.key === "MediaPlayPause" || ev.key === "MediaPlay" || ev.code === "MediaPlayPause" || ev.keyCode === 179 || ev.keyCode === 85));
      }

      function isMediaRewindKeyClient(ev) {
        return Boolean(ev && (ev.key === "MediaRewind" || ev.key === "MediaTrackPrevious" || ev.keyCode === 227 || ev.keyCode === 89));
      }

      function isMediaFastForwardKeyClient(ev) {
        return Boolean(ev && (ev.key === "MediaFastForward" || ev.key === "MediaTrackNext" || ev.keyCode === 228 || ev.keyCode === 90));
      }

      function isRemoteMenuKeyClient(ev) {
        return Boolean(ev && (ev.key === "ContextMenu" || ev.keyCode === 82 || ev.keyCode === 93));
      }

      function cancelCardEnterHold() {
        if (cardEnterHoldTimer) {
          clearTimeout(cardEnterHoldTimer);
          cardEnterHoldTimer = null;
        }
        if (cardEnterHoldTarget && cardEnterHoldTarget.classList) {
          cardEnterHoldTarget.classList.remove("is-enter-holding");
        }
        cardEnterHoldTarget = null;
        cardEnterHoldTriggered = false;
      }

      function cancelModalArrowHold() {
        if (modalHoldTimer) {
          clearTimeout(modalHoldTimer);
          modalHoldTimer = null;
        }
        if (modalHoldShowTimer) {
          clearTimeout(modalHoldShowTimer);
          modalHoldShowTimer = null;
        }
        modalHoldActiveKey = "";
        modalHoldTriggered = false;
        const ind = document.getElementById("modalHoldNavIndicator");
        const bar = document.getElementById("modalHoldNavBar");
        if (ind) {
          ind.style.display = "none";
          ind.classList.remove("left", "right");
        }
        if (bar) {
          bar.style.transition = "none";
          bar.style.width = "0%";
        }
      }

      function startModalArrowHold(keyName, step, adjItem) {
        cancelModalArrowHold();
        if (!modalHoldNavEnabled || !adjItem) return;
        modalHoldActiveKey = keyName;
        modalHoldTriggered = false;
        modalHoldShowTimer = setTimeout(() => {
          modalHoldShowTimer = null;
          if (!modalHoldActiveKey || modalHoldTriggered) return;
          const ind = document.getElementById("modalHoldNavIndicator");
          const txt = document.getElementById("modalHoldNavText");
          const bar = document.getElementById("modalHoldNavBar");
          if (ind && txt && bar) {
            ind.classList.remove("left", "right");
            ind.classList.add(step < 0 ? "left" : "right");
            txt.textContent = step < 0
              ? ("◀ Halten: " + (adjItem.title || "Vorheriger Titel"))
              : ("Halten: " + (adjItem.title || "Nächster Titel") + " ▶");
            bar.style.transition = "none";
            bar.style.width = "0%";
            ind.style.display = "flex";
            void bar.offsetWidth;
            bar.style.transition = "width " + Math.max(120, HOLD_NAV_DURATION_MS - HOLD_NAV_SHOW_DELAY_MS) + "ms linear";
            bar.style.width = "100%";
          }
        }, HOLD_NAV_SHOW_DELAY_MS);

        modalHoldTimer = setTimeout(() => {
          modalHoldTimer = null;
          modalHoldTriggered = true;
          cancelModalArrowHold();
          navigateDetailModalAdjacent(step);
        }, HOLD_NAV_DURATION_MS);
      }

      let topBarUpHoldTimer = null;
      let topBarUpHoldShowTimer = null;
      let topBarUpHoldActive = false;
      let topBarUpHoldTriggered = false;
      const TOP_BAR_HOLD_DURATION_MS = 400;
      const TOP_BAR_HOLD_SHOW_DELAY_MS = 120;

      function cancelTopBarUpHold() {
        if (topBarUpHoldTimer) {
          clearTimeout(topBarUpHoldTimer);
          topBarUpHoldTimer = null;
        }
        if (topBarUpHoldShowTimer) {
          clearTimeout(topBarUpHoldShowTimer);
          topBarUpHoldShowTimer = null;
        }
        if (topBarUpHoldActive) {
          topBarUpHoldActive = false;
          const ind = document.getElementById("modalHoldNavIndicator");
          const bar = document.getElementById("modalHoldNavBar");
          if (ind && !modalHoldActiveKey) {
            ind.style.display = "none";
            ind.classList.remove("left", "right");
          }
          if (bar && !modalHoldActiveKey) {
            bar.style.transition = "none";
            bar.style.width = "0%";
          }
        }
        topBarUpHoldTriggered = false;
      }

      function startTopBarUpHold() {
        cancelTopBarUpHold();
        topBarUpHoldActive = true;
        topBarUpHoldTriggered = false;
        topBarUpHoldShowTimer = setTimeout(() => {
          topBarUpHoldShowTimer = null;
          if (!topBarUpHoldActive || topBarUpHoldTriggered) return;
          const ind = document.getElementById("modalHoldNavIndicator");
          const txt = document.getElementById("modalHoldNavText");
          const bar = document.getElementById("modalHoldNavBar");
          if (ind && txt && bar) {
            ind.classList.remove("left", "right");
            txt.textContent = "⬆️ Halten: Direkt nach oben zur Suche & Navigation…";
            bar.style.transition = "none";
            bar.style.width = "0%";
            ind.style.display = "flex";
            void bar.offsetWidth;
            bar.style.transition = "width " + Math.max(100, TOP_BAR_HOLD_DURATION_MS - TOP_BAR_HOLD_SHOW_DELAY_MS) + "ms linear";
            bar.style.width = "100%";
          }
        }, TOP_BAR_HOLD_SHOW_DELAY_MS);

        topBarUpHoldTimer = setTimeout(() => {
          topBarUpHoldTimer = null;
          topBarUpHoldTriggered = true;
          cancelTopBarUpHold();
          closeAutocomplete();
          if (verticalUpHoldOriginCardEl && document.body.contains(verticalUpHoldOriginCardEl)) {
            searchShortcutReturnCardEl = verticalUpHoldOriginCardEl;
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
          const targetTopEl = document.getElementById("searchInput") || document.getElementById("sidebarToggleBtn");
          if (targetTopEl) {
            setSpatialFocus(targetTopEl, false, "up");
          }
          if (typeof showHudToast === "function") {
            showHudToast("⬆️ Direkt oben in der Such- & Navigationsleiste");
          }
        }, TOP_BAR_HOLD_DURATION_MS);
      }

      // =========================================================================
      // TV- & KONSOLEN-TURBO-SPRUNG, SCHNELLSPRUNG-FAHRSTUHL & TRIGGER-SEITENWAHL
      // =========================================================================
      let verticalTurboDir = "";
      let verticalTurboStreak = 0;
      let verticalTurboLastStepAt = 0;
      let verticalTurboExpressDone = false;
      let verticalHoldTimer = null;
      let verticalHoldShowTimer = null;
      let verticalUpHoldOriginCardEl = null;
      let searchShortcutReturnCardEl = null;
      const VERTICAL_HOLD_SHOW_DELAY_MS = 160;
      const VERTICAL_HOLD_DURATION_MS = 460;
      let controllerL2R2Mode = "page"; // "page" (Standard: 5-Zeilen / Seiten-Blättern) oder "zoom" (UI-Zoom)

      function clearSearchShortcutReturnCardClient() {
        searchShortcutReturnCardEl = null;
        verticalUpHoldOriginCardEl = null;
      }

      function resetVerticalTurboStreakClient() {
        if (verticalHoldTimer) {
          clearTimeout(verticalHoldTimer);
          verticalHoldTimer = null;
        }
        if (verticalHoldShowTimer) {
          clearTimeout(verticalHoldShowTimer);
          verticalHoldShowTimer = null;
        }
        verticalTurboDir = "";
        verticalTurboStreak = 0;
        verticalTurboLastStepAt = 0;
        verticalTurboExpressDone = false;
        cancelTopBarUpHold();
      }

      function moveSpatialFocusMultiRowClient(dir, steps = 3) {
        const count = Math.max(1, Number(steps) || 3);
        let prevEl = currentSpatialEl;
        for (let i = 0; i < count; i++) {
          const isLast = i === count - 1;
          moveSpatialFocus(dir, !isLast);
          if (currentSpatialEl === prevEl) break;
          prevEl = currentSpatialEl;
        }
        if (currentSpatialEl) {
          useSpatialScrollIntoView(currentSpatialEl, dir);
        }
      }

      function tvElevatorJumpClient(targetZone, isWrapAround = false) {
        if (typeof triggerTmaHapticClient === "function") triggerTmaHapticClient("selection");
        closeAutocomplete();
        const list = getVisibleFocusables();
        const isWishlist = state.currentView === "wishlist";

        if (targetZone === "top") {
          const isHeroCollapsedOrScrolled = Boolean(
            (typeof heroCurtainScrolledToCatalog !== "undefined" && heroCurtainScrolledToCatalog) ||
            (document.body && document.body.classList.contains("hero-scrolled-past")) ||
            state.heroHidden ||
            (window.scrollY || window.pageYOffset || 0) > 40
          );
          if (!isWrapAround && !isWishlist && isHeroCollapsedOrScrolled && typeof expandHeroSliderAndFocusClient === "function" && expandHeroSliderAndFocusClient("hero")) {
            if (typeof showHudToast === "function") {
              showHudToast("🎬 Hero-Slider eingeblendet");
            }
            return;
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
          const wlInp = isWishlist ? document.getElementById("wishlistSearchInp") : null;
          const topTarget = (wlInp && list.includes(wlInp))
            ? wlInp
            : (document.getElementById("searchInput") || document.getElementById("sidebarToggleBtn"));
          if (topTarget) {
            jumpSpatialFocus(topTarget, false, "up");
          }
          if (typeof showHudToast === "function") {
            showHudToast(isWrapAround ? "🔄 Oben: Such- & Navigationsleiste" : "⬆️ Oben: Such- & Navigationsleiste");
          }
          return;
        }

        if (targetZone === "filter") {
          const filterTarget = isWishlist
            ? (document.getElementById("wishlistSearchInp") || document.querySelector("#appRoot .sort-select, #appRoot .f-pill, #appRoot .btn"))
            : document.querySelector(".floating-filter-bar .mode-filter-select, .floating-filter-bar .sort-select, .floating-filter-bar .f-pill, #sectionPageCounterPill");
          if (filterTarget && list.includes(filterTarget)) {
            jumpSpatialFocus(filterTarget, true, "up");
            if (typeof showHudToast === "function") {
              showHudToast("🎛️ Fokus auf Filter- & Sortierleiste");
            }
          } else {
            tvElevatorJumpClient("top", false);
          }
          return;
        }

        if (targetZone === "middle") {
          const cards = Array.from(document.querySelectorAll("#resultsGridContainer .card, #appRoot .card")).filter(el => list.includes(el));
          if (cards.length > 0) {
            const midIdx = Math.floor(cards.length / 2);
            const midCard = cards[midIdx];
            lastElevatorReturnEl = midCard;
            jumpSpatialFocus(midCard, true, "down");
            if (typeof showHudToast === "function") {
              showHudToast("🎯 Mitte des Rasters (Titel " + (midIdx + 1) + " von " + cards.length + ")");
            }
          }
          return;
        }

        if (targetZone === "bottom") {
          const botPageBtn = document.getElementById("bottomPageCounterPill");
          const loadMoreBtn = document.getElementById("manualLoadMoreBtn");
          const topPagePill = document.getElementById("sectionPageCounterPill");
          const cards = Array.from(document.querySelectorAll("#resultsGridContainer .card, #appRoot .card")).filter(el => list.includes(el));
          const lastCard = cards.length > 0 ? cards[cards.length - 1] : null;

          // Wenn man bereits unten auf dem Seitenwahl-Button steht und nochmals "Seiten / Unten" klickt -> direkt Seitenwahl-Dialog öffnen!
          if (!isWrapAround && currentSpatialEl && (currentSpatialEl === botPageBtn || currentSpatialEl.id === "tvElevBtnBot") && Number(state.totalPages) > 1) {
            const docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            const atBottomAlready = (window.innerHeight + (window.scrollY || window.pageYOffset || 0)) >= docH - 180;
            if (atBottomAlready && typeof openPageJumpModalClient === "function") {
              openPageJumpModalClient();
              return;
            }
          }

          const targetBotEl = (botPageBtn && list.includes(botPageBtn))
            ? botPageBtn
            : (loadMoreBtn && list.includes(loadMoreBtn))
              ? loadMoreBtn
              : lastCard || topPagePill;

          if (targetBotEl) {
            if (lastCard) lastElevatorReturnEl = lastCard;
            jumpSpatialFocus(targetBotEl, true, "down");
            if (typeof showHudToast === "function") {
              showHudToast(isWrapAround ? "⏬ Unten: Seitenwahl & Katalog-Ende" : "📄 Unten: Seitenwahl & Katalog-Ende");
            }
          }
          return;
        }
      }

      function focusSearchWithoutScrollClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (typeof triggerTmaHapticClient === "function") triggerTmaHapticClient("light");
        if (typeof closeRightMenuOverlayClient === "function") {
          closeRightMenuOverlayClient(null, true);
        } else {
          const elevContainer = document.getElementById("tvQuickJumpElevator");
          if (elevContainer) {
            elevContainer.classList.remove("has-subpanel", "is-visible", "is-hover-expanded");
            elevContainer.classList.add("is-dismissed");
          }
        }
        const hdr = document.getElementById("topUnifiedBar");
        if (hdr && typeof expandMobileSearchBarClient === "function") {
          expandMobileSearchBarClient(true);
        }
        const inp = document.getElementById("searchInput");
        if (inp) {
          setSpatialFocus(inp, false);
          try { inp.focus({ preventScroll: true }); } catch (e) { try { inp.focus(); } catch (e2) {} }
          try {
            if (inp.value && typeof inp.setSelectionRange === "function") {
              inp.setSelectionRange(inp.value.length, inp.value.length);
            }
          } catch (e) {}
        }
        const bar = document.querySelector("#topUnifiedBar .search-bar");
        if (bar) {
          bar.classList.add("is-search-focused");
          bar.classList.remove("search-focus-pulse");
          void bar.offsetWidth;
          bar.classList.add("search-focus-pulse");
        }
        if (typeof showHudToast === "function") showHudToast("🔍 Suche aktiv – einfach lostippen");
      }

      function openPageJumpFromElevatorClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (typeof triggerTmaHapticClient === "function") triggerTmaHapticClient("selection");
        if (typeof closeRightMenuOverlayClient === "function") {
          closeRightMenuOverlayClient(null, true);
        } else {
          const elevContainer = document.getElementById("tvQuickJumpElevator");
          if (elevContainer) elevContainer.classList.remove("has-subpanel", "is-visible", "is-hover-expanded");
        }
        const totPages = Math.max(1, Number(state.totalPages) || 1);
        if (totPages > 1 && typeof openPageJumpModalClient === "function") {
          openPageJumpModalClient();
        } else if (typeof tvElevatorJumpClient === "function") {
          tvElevatorJumpClient("bottom");
        }
      }

      function scrollToTopFromElevatorClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (typeof triggerTmaHapticClient === "function") triggerTmaHapticClient("selection");
        if (typeof closeRightMenuOverlayClient === "function") {
          closeRightMenuOverlayClient(null, true);
        } else {
          const elevContainer = document.getElementById("tvQuickJumpElevator");
          if (elevContainer) elevContainer.classList.remove("has-subpanel", "is-visible", "is-hover-expanded");
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
        const firstTopCard = document.querySelector("#resultsGridContainer .card, #appRoot .card");
        if (firstTopCard) {
          setSpatialFocus(firstTopCard, false, "up");
        }
        if (typeof showHudToast === "function") showHudToast("⬆️ Nach oben");
      }

      function handleVerticalDirectionStepWithTurboClient(dir, isRepeatEvent = false) {
        const inTvElevator = Boolean(currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#tvQuickJumpElevator"));
        const inAutocomplete = Boolean(currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#searchAutocompleteBox"));
        const inGenreOverlay = Boolean(currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#searchGenreDropdownOverlay"));
        const inExpandedDesc = Boolean(currentSpatialEl && currentSpatialEl.classList && currentSpatialEl.classList.contains("expandable-desc-box") && currentSpatialEl.classList.contains("is-expanded"));
        if (inTvElevator || inAutocomplete || inGenreOverlay || inExpandedDesc || state.sidebarOpen) {
          moveSpatialFocus(dir, false, Boolean(isRepeatEvent));
          return;
        }

        // Auto-Repeat beim Gedrückthalten löst KEINE weiteren Zeilensprünge aus (verhindert jedes Herumspringen!):
        // Nur der ruhige Halte-Timer springt gezielt nach oben zur Suche bzw. nach unten zur Seitenwahl.
        if (isRepeatEvent) {
          if (verticalTurboDir === dir && (verticalHoldTimer || verticalTurboExpressDone)) {
            verticalTurboLastStepAt = Date.now();
            return;
          }
          return;
        }

        // Normaler Druck: Immer exakt 1 Zeile wechseln (nie mehr als eine!)
        // Ursprungs-Cover VOR dem ersten Schritt nach oben merken, damit Pfeil-nach-unten aus der Suche exakt dorthin zurückkehrt!
        const originCardBeforeUpStep = (dir === "up" && currentSpatialEl && currentSpatialEl.closest)
          ? currentSpatialEl.closest(".card")
          : null;
        resetVerticalTurboStreakClient();
        verticalUpHoldOriginCardEl = originCardBeforeUpStep;
        verticalTurboDir = dir;
        verticalTurboStreak = 1;
        verticalTurboLastStepAt = Date.now();
        verticalTurboExpressDone = false;
        moveSpatialFocus(dir, false, false);

        const isModalOpenNow = Boolean(document.getElementById("modalRoot")?.innerHTML.trim());
        const isPageJumpOpenNow = Boolean(
          document.getElementById("customDialogRoot")?.querySelector(".page-jump-modal-backdrop")
        );
        if (isPageJumpOpenNow) return;

        verticalHoldShowTimer = setTimeout(() => {
          verticalHoldShowTimer = null;
          if (verticalTurboDir !== dir || verticalTurboExpressDone) return;
          topBarUpHoldActive = true;
          const ind = document.getElementById("modalHoldNavIndicator");
          const txt = document.getElementById("modalHoldNavText");
          const bar = document.getElementById("modalHoldNavBar");
          if (ind && txt && bar) {
            ind.classList.remove("left", "right");
            if (isModalOpenNow) {
              txt.textContent = dir === "up" ? "⬆️ Halten: Anfang der Detailansicht" : "⏬ Halten: Ende der Detailansicht";
            } else {
              txt.textContent = dir === "up" ? "🔍 Halten: Direkt zur Suche" : "📄 Halten: Direkt zur Seitenwahl";
            }
            bar.style.transition = "none";
            bar.style.width = "0%";
            ind.style.display = "flex";
            void bar.offsetWidth;
            bar.style.transition = "width " + Math.max(120, VERTICAL_HOLD_DURATION_MS - VERTICAL_HOLD_SHOW_DELAY_MS) + "ms linear";
            bar.style.width = "100%";
          }
        }, VERTICAL_HOLD_SHOW_DELAY_MS);

        verticalHoldTimer = setTimeout(() => {
          verticalHoldTimer = null;
          if (verticalTurboDir !== dir) return;
          verticalTurboExpressDone = true;
          cancelTopBarUpHold();
          const modalBackdrop = document.querySelector("#modalRoot .modal-backdrop");
          if (modalBackdrop && document.getElementById("modalRoot")?.innerHTML.trim()) {
            const list = getVisibleFocusables();
            if (dir === "up") {
              if (typeof scrollDetailModalToHeroStageTopClient === "function") {
                scrollDetailModalToHeroStageTopClient();
              } else {
                modalBackdrop.scrollTo({ top: 0, behavior: "smooth" });
              }
              const topModalBtn = document.querySelector("#detailHeroStageEl .detail-btn-play-white, #detailHeroStageEl .detail-btn-glass") || list[0];
              if (topModalBtn) jumpSpatialFocus(topModalBtn, false, "up");
              if (typeof showHudToast === "function") showHudToast("⬆️ Anfang der Detailansicht");
            } else {
              const modalItems = list.filter(el => modalBackdrop.contains(el));
              const lastModalEl = modalItems.length > 0 ? modalItems[modalItems.length - 1] : null;
              if (lastModalEl) jumpSpatialFocus(lastModalEl, true, "down");
              if (typeof showHudToast === "function") showHudToast("⏬ Ende der Detailansicht");
            }
            return;
          }

          if (dir === "up") {
            const savedOriginCard = (verticalUpHoldOriginCardEl && document.body.contains(verticalUpHoldOriginCardEl))
              ? verticalUpHoldOriginCardEl
              : null;
            if (state.currentView === "wishlist") {
              const wlInp = document.getElementById("wishlistSearchInp");
              if (wlInp) {
                searchShortcutReturnCardEl = savedOriginCard;
                jumpSpatialFocus(wlInp, false, "up");
                try { wlInp.focus({ preventScroll: true }); } catch (_we) {}
                if (typeof showHudToast === "function") showHudToast("🔍 Merklisten-Suche aktiv");
                return;
              }
            }
            if (typeof focusSearchWithoutScrollClient === "function") {
              searchShortcutReturnCardEl = savedOriginCard;
              focusSearchWithoutScrollClient();
            } else {
              searchShortcutReturnCardEl = savedOriginCard;
              tvElevatorJumpClient("top", false);
            }
          } else {
            const totPages = Math.max(1, Number(state.totalPages) || 1);
            if (totPages > 1 && typeof openPageJumpModalClient === "function") {
              openPageJumpModalClient();
            } else {
              tvElevatorJumpClient("bottom", false);
            }
          }
        }, VERTICAL_HOLD_DURATION_MS);
      }

      function toggleControllerTriggerModeClient() {
        controllerL2R2Mode = controllerL2R2Mode === "zoom" ? "page" : "zoom";
        activeControllerBrand = ""; // Erzwingt HUD-Refresh
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = pads && (pads[0] || pads[1] || pads[2] || pads[3]);
        syncControllerHudBarClient(gp);
        if (typeof showHudToast === "function") {
          showHudToast(
            controllerL2R2Mode === "page"
              ? "🎮 L2 / R2 Modus: 📄 Schnelles Zeilen- & Seiten-Blättern"
              : "🎮 L2 / R2 Modus: 🔍 Live UI-Zoom (-5% / +5%)"
          );
        }
      }

      async function handleTvQuickPageOrBlockStepClient(stepDir) {
        const dir = stepDir < 0 ? "up" : "down";
        if (typeof triggerTmaHapticClient === "function") triggerTmaHapticClient("selection");

        // 1. Falls das Seitenwahl-Popup offen ist: -5 / +5 Seiten blättern
        if (document.getElementById("customDialogRoot")?.querySelector(".page-jump-modal-backdrop") && typeof adjustPageJumpModalValueClient === "function") {
          adjustPageJumpModalValueClient(stepDir * 5);
          return;
        }

        // 2. Falls Detail-Modal offen ist: 5 Zeilen / Episoden auf einmal springen
        const modalBackdrop = document.querySelector("#modalRoot .modal-backdrop");
        if (modalBackdrop && document.getElementById("modalRoot")?.innerHTML.trim()) {
          moveSpatialFocusMultiRowClient(dir, 5);
          if (typeof showHudToast === "function") {
            showHudToast(stepDir < 0 ? "⏫ 5 Zeilen nach oben" : "⏬ 5 Zeilen nach unten");
          }
          return;
        }

        // 3. Hauptkatalog / Merkliste: 5 Rasterzeilen springen – oder am unteren Rand direkt nächste Seite laden!
        const prevEl = currentSpatialEl;
        moveSpatialFocusMultiRowClient(dir, 5);
        if (stepDir > 0 && (currentSpatialEl === prevEl || (currentSpatialEl && currentSpatialEl.id === "manualLoadMoreBtn"))) {
          if (state.hasMorePages && typeof loadMoreResults === "function") {
            await loadMoreResults(false);
            if (typeof showHudToast === "function") {
              showHudToast("📄 Nächste Katalog-Seite geladen");
            }
            return;
          }
        }
        if (typeof showHudToast === "function") {
          showHudToast(stepDir < 0 ? "⏫ Schnellsprung nach oben (5 Zeilen)" : "⏬ Schnellsprung nach unten (5 Zeilen)");
        }
      }

      window.addEventListener("keyup", (ev) => {
        if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
          const wasHoldingThisKey = modalHoldActiveKey === ev.key;
          const didTriggerHold = modalHoldTriggered;
          cancelModalArrowHold();
          if (wasHoldingThisKey && !didTriggerHold) {
            moveSpatialFocus(ev.key === "ArrowRight" ? "right" : "left");
          }
        } else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
          resetVerticalTurboStreakClient();
        } else if (isConfirmSelectKeyClient(ev)) {
          const targetCard = cardEnterHoldTarget;
          const didTriggerLong = cardEnterHoldTriggered;
          cancelCardEnterHold();
          if (targetCard && !didTriggerLong && currentSpatialEl === targetCard) {
            targetCard.click();
          }
        }
      });
      window.addEventListener("blur", () => {
        cancelModalArrowHold();
        resetVerticalTurboStreakClient();
        cancelCardEnterHold();
      });

      document.addEventListener("keydown", (ev) => {
        engageKeyboardNavMode();
        if (
          ev.key === "Select" || ev.keyCode === 23 ||
          isMediaPlayPauseKeyClient(ev) || isMediaRewindKeyClient(ev) ||
          isMediaFastForwardKeyClient(ev) || isRemoteMenuKeyClient(ev) ||
          ev.key === "GoBack" || ev.key === "BrowserBack" || ev.keyCode === 4
        ) {
          activeInputProfile = "firetv";
        } else if (activeInputProfile === "gamepad-ps" || activeInputProfile === "gamepad-xbox") {
          activeInputProfile = resolveDefaultInputProfileClient();
        }
        if (typeof wakeHeroCinemaDockClient === "function") wakeHeroCinemaDockClient();
        if (typeof wakeDetailCinemaDockClient === "function") wakeDetailCinemaDockClient();
        const activeEl = document.activeElement;
        const activeTag = (activeEl && activeEl.tagName || "").toUpperCase();
        const isSearchInpFocused = activeEl && activeEl.id === "searchInput";
        const activeInputType = activeTag === "INPUT" ? String(activeEl.type || "text").toLowerCase() : "";
        const isRangeOrNonTextInput = activeTag === "INPUT" && (activeInputType === "range" || activeInputType === "button" || activeInputType === "checkbox" || activeInputType === "radio" || activeInputType === "submit" || activeInputType === "reset");
        const isTypingInInput = (activeTag === "INPUT" && !isRangeOrNonTextInput) || activeTag === "TEXTAREA" || activeTag === "SELECT" || Boolean(activeEl && activeEl.isContentEditable);

        const isBackKey = ev.key === "Escape" || ev.key === "GoBack" || ev.key === "BrowserBack" || ev.key === "XF86Back" || ev.keyCode === 4 || ev.keyCode === 166 || (ev.key === "Backspace" && !isTypingInInput);
        if (isBackKey) {
          cancelModalArrowHold();
          resetVerticalTurboStreakClient();
          cancelCardEnterHold();
          const cinemaCtxForBack = getActiveForegroundCinemaContextClient();
          if (cinemaCtxForBack) {
            if (activeEl && activeEl !== document.body && typeof activeEl.blur === "function") activeEl.blur();
            if (cinemaCtxForBack.mode === "detail" && typeof exitDetailForegroundTrailerModeClient === "function") {
              exitDetailForegroundTrailerModeClient(ev);
            } else if (cinemaCtxForBack.mode === "hero" && typeof exitHeroForegroundTrailerModeClient === "function") {
              exitHeroForegroundTrailerModeClient(ev);
            }
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          if (state.sidebarOpen && state.sidebarSubPanelOpen && currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#sidebarRightSubPanel")) {
            if (typeof closeSidebarSubPanelToMain === "function") closeSidebarSubPanelToMain();
            ev.preventDefault();
            return;
          }
          if (document.getElementById("customDialogRoot")?.querySelector(".page-jump-modal-backdrop")) {
            if (typeof closePageJumpModalClient === "function") closePageJumpModalClient();
            ev.preventDefault();
            return;
          }
          if (document.getElementById("customDialogRoot")?.innerHTML.trim()) {
            if (activeEl && activeEl !== document.body && typeof activeEl.blur === "function") activeEl.blur();
            if (typeof closeCustomDialog === "function") closeCustomDialog(null);
            ev.preventDefault();
            return;
          }
          if (isManualNoTmdbModalOpenClient() && typeof closeManualNoTmdbConfirmModalClient === "function") {
            if (activeEl && activeEl !== document.body && typeof activeEl.blur === "function") activeEl.blur();
            closeManualNoTmdbConfirmModalClient();
            ev.preventDefault();
            return;
          }
          if (document.getElementById("subModalOverlayRoot")?.innerHTML.trim() && typeof closeSubModalOverlayClient === "function") {
            if (activeEl && activeEl !== document.body && typeof activeEl.blur === "function") activeEl.blur();
            closeSubModalOverlayClient();
            ev.preventDefault();
            return;
          }
          if (currentSpatialEl && (currentSpatialEl.id === "heroBtnDetails" || currentSpatialEl.id === "heroBtnTrailer")) {
            state.heroActionsEngaged = false;
            const box = document.getElementById("heroActionsBox");
            if (box) box.classList.remove("engaged");
            const actCard = document.querySelector('.hero-thumb-card[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-thumb-card.active");
            if (actCard) setSpatialFocus(actCard, false);
            ev.preventDefault();
            return;
          }
          if (currentSpatialEl && isCardSubElement(currentSpatialEl)) {
            const parentCard = currentSpatialEl.closest(".card");
            clearCardSubnavState(null);
            if (parentCard) setSpatialFocus(parentCard, false);
            ev.preventDefault();
            return;
          }
          const elevForEsc = document.getElementById("tvQuickJumpElevator");
          const isElevOpenForEsc = Boolean(
            elevForEsc && (
              elevForEsc.classList.contains("has-subpanel") ||
              elevForEsc.classList.contains("is-visible") ||
              elevForEsc.classList.contains("is-hover-expanded") ||
              (currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#tvQuickJumpElevator"))
            )
          );
          if (isElevOpenForEsc) {
            if (currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#rightMenuSubPanel") && typeof closeRightMenuSubPanelClient === "function") {
              closeRightMenuSubPanelClient(true);
              ev.preventDefault();
              return;
            }
            if (typeof closeRightMenuOverlayClient === "function") {
              closeRightMenuOverlayClient(null, true);
            } else {
              if (elevForEsc) elevForEsc.classList.remove("is-visible", "is-hover-expanded", "has-subpanel");
              if (typeof closeRightMenuSubPanelClient === "function") closeRightMenuSubPanelClient(false);
            }
            if (lastElevatorReturnEl && document.body.contains(lastElevatorReturnEl)) {
              setSpatialFocus(lastElevatorReturnEl, true, "left");
            }
            ev.preventDefault();
            return;
          }
          const spotlightRoot = document.getElementById("personSpotlightOverlayRoot");
          if (spotlightRoot && spotlightRoot.innerHTML.trim() && typeof closePersonSpotlightOverlayClient === "function") {
            closePersonSpotlightOverlayClient(ev);
            ev.preventDefault();
            return;
          }
          const openDescBox = document.querySelector(".expandable-desc-box.is-expanded");
          if (openDescBox && openDescBox.id && typeof toggleExpandableDescriptionClient === "function") {
            toggleExpandableDescriptionClient(ev, openDescBox.id);
            ev.preventDefault();
            return;
          }
          if (document.getElementById("searchGenreDropdownOverlay")?.classList.contains("open")) {
            if (typeof closeSearchGenreDropdownOverlay === "function") closeSearchGenreDropdownOverlay();
            ev.preventDefault();
            return;
          }
          if (document.getElementById("searchAutocompleteBox")?.classList.contains("open")) {
            closeAutocomplete();
            ev.preventDefault();
            return;
          }
          if (document.getElementById("topUnifiedBar")?.classList.contains("mobile-search-expanded") && !String(document.getElementById("searchInput")?.value || "").trim()) {
            if (typeof collapseMobileSearchBarClient === "function") collapseMobileSearchBarClient(true);
            ev.preventDefault();
            return;
          }
          if (activeEl && activeEl !== document.body && typeof activeEl.blur === "function") activeEl.blur();
          goBack();
          ev.preventDefault();
          return;
        }

        // Kino-Trailer Tastatur- & Fernbedienungs-Steuerung im aktiven Vordergrund-Modus (inkl. Pause-Menü & Endcard)
        // getActiveForegroundCinemaContextClient() blockiert automatisch bei offenen Overlays (Sidebar, rechtes Untermenü, Suche, Dialoge)
        if (!isTypingInInput && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
          const activeCinemaCtx = getActiveForegroundCinemaContextClient();
          if (activeCinemaCtx) {
            const detailFgActive = activeCinemaCtx.mode === "detail";
            const heroFgActive = activeCinemaCtx.mode === "hero";
            const lk = String(ev.key || "").toLowerCase();
            const isSpace = ev.code === "Space" || ev.key === " ";

            if (ev.key === "Tab") {
              cancelModalArrowHold();
              resetVerticalTurboStreakClient();
              ev.preventDefault();
              ev.stopPropagation();
              engageKeyboardNavMode();
              navigateCinemaPlayerFocusClient(ev.shiftKey ? "left" : "right", activeCinemaCtx, { isTabNav: true });
              return;
            }
            if (ev.key === "ArrowLeft" || ev.key === "ArrowRight" || ev.key === "ArrowUp" || ev.key === "ArrowDown") {
              cancelModalArrowHold();
              resetVerticalTurboStreakClient();
              ev.preventDefault();
              ev.stopPropagation();
              engageKeyboardNavMode();
              const dirMap = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
              navigateCinemaPlayerFocusClient(dirMap[ev.key], activeCinemaCtx);
              return;
            }
            if (isConfirmSelectKeyClient(ev)) {
              cancelModalArrowHold();
              resetVerticalTurboStreakClient();
              ev.preventDefault();
              ev.stopPropagation();
              if (!ev.repeat) {
                confirmCinemaPlayerFocusClient(activeCinemaCtx);
              }
              return;
            }
            if (lk === "k" || isSpace || isMediaPlayPauseKeyClient(ev)) {
              ev.preventDefault();
              ev.stopPropagation();
              if ((isSpace || isMediaPlayPauseKeyClient(ev)) && activeCinemaCtx.isEnded) {
                if (!ev.repeat) confirmCinemaPlayerFocusClient(activeCinemaCtx);
                return;
              }
              if (detailFgActive && typeof toggleDetailCinemaPlayPauseClient === "function") toggleDetailCinemaPlayPauseClient(ev);
              else if (heroFgActive && typeof toggleHeroCinemaPlayPauseClient === "function") toggleHeroCinemaPlayPauseClient(ev);
              return;
            }
            if (lk === "m") {
              ev.preventDefault();
              if (detailFgActive && typeof toggleDetailBackgroundTeaserAudioClient === "function") toggleDetailBackgroundTeaserAudioClient(ev);
              else if (heroFgActive && typeof toggleHeroBackgroundTeaserAudioClient === "function") toggleHeroBackgroundTeaserAudioClient(ev);
              return;
            }
            if (lk === "c") {
              ev.preventDefault();
              if (detailFgActive && typeof toggleDetailCinemaSubtitlesClient === "function") toggleDetailCinemaSubtitlesClient(ev);
              else if (heroFgActive && typeof toggleHeroCinemaSubtitlesClient === "function") toggleHeroCinemaSubtitlesClient(ev);
              return;
            }
            if (lk === "j" || isMediaRewindKeyClient(ev)) {
              ev.preventDefault();
              ev.stopPropagation();
              if (detailFgActive && typeof seekDetailCinemaRelativeClient === "function") seekDetailCinemaRelativeClient(-10, ev);
              else if (heroFgActive && typeof seekHeroCinemaRelativeClient === "function") seekHeroCinemaRelativeClient(-10, ev);
              return;
            }
            if (lk === "l" || isMediaFastForwardKeyClient(ev)) {
              ev.preventDefault();
              ev.stopPropagation();
              if (detailFgActive && typeof seekDetailCinemaRelativeClient === "function") seekDetailCinemaRelativeClient(10, ev);
              else if (heroFgActive && typeof seekHeroCinemaRelativeClient === "function") seekHeroCinemaRelativeClient(10, ev);
              return;
            }
            if (lk === "n" || ev.key === "PageDown" || ev.key === "ChannelDown") {
              ev.preventDefault();
              ev.stopPropagation();
              if (detailFgActive && typeof switchNextDetailTrailerCandidateManualClient === "function") switchNextDetailTrailerCandidateManualClient(ev);
              else if (heroFgActive && typeof switchNextHeroTrailerCandidateManualClient === "function") switchNextHeroTrailerCandidateManualClient(ev);
              return;
            }
            if (ev.key === "PageUp" || ev.key === "ChannelUp") {
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
            if (lk === "s") {
              ev.preventDefault();
              if (detailFgActive && typeof cycleDetailCinemaSpeedClient === "function") cycleDetailCinemaSpeedClient(ev);
              else if (heroFgActive && typeof cycleHeroCinemaSpeedClient === "function") cycleHeroCinemaSpeedClient(ev);
              return;
            }
            if (lk === "r" || lk === "0" || ev.key === "Home") {
              ev.preventDefault();
              ev.stopPropagation();
              if (detailFgActive && typeof restartDetailCinemaTrailerClient === "function") restartDetailCinemaTrailerClient(ev);
              else if (heroFgActive && typeof restartHeroCinemaTrailerClient === "function") restartHeroCinemaTrailerClient(ev);
              return;
            }
            if (ev.key === "End") {
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
            if (ev.key === "+" || ev.key === "=" || ev.code === "NumpadAdd") {
              ev.preventDefault();
              if (detailFgActive && typeof adjustDetailCinemaVolumeStepClient === "function") adjustDetailCinemaVolumeStepClient(10);
              else if (heroFgActive && typeof adjustHeroCinemaVolumeStepClient === "function") adjustHeroCinemaVolumeStepClient(10);
              return;
            }
            if (ev.key === "-" || ev.key === "_" || ev.code === "NumpadSubtract") {
              ev.preventDefault();
              if (detailFgActive && typeof adjustDetailCinemaVolumeStepClient === "function") adjustDetailCinemaVolumeStepClient(-10);
              else if (heroFgActive && typeof adjustHeroCinemaVolumeStepClient === "function") adjustHeroCinemaVolumeStepClient(-10);
              return;
            }
            // Im aktiven Trailer-Modus verhindert dieser Schutz versehentliches Type-to-Search oder Hintergrund-Shortcuts!
            if (ev.key && ev.key.length === 1) {
              return;
            }
          }
        }

        // Fire TV / Smart-TV Fernbedienung & Tastatur Schnell-Tasten: Rewind/FastForward, Play/Pause, Menü, PageUp/PageDown, Home/End & Leertaste auf Cover (KEINE Buchstaben-Shortcuts!)
        if (!isTypingInInput) {
          if (ev.key === "PageDown" || ev.key === "ChannelDown" || isMediaFastForwardKeyClient(ev)) {
            ev.preventDefault();
            ev.stopPropagation();
            handleTvQuickPageOrBlockStepClient(1);
            return;
          }
          if (ev.key === "PageUp" || ev.key === "ChannelUp" || isMediaRewindKeyClient(ev)) {
            ev.preventDefault();
            ev.stopPropagation();
            handleTvQuickPageOrBlockStepClient(-1);
            return;
          }
          if (ev.key === "Home") {
            ev.preventDefault();
            tvElevatorJumpClient("top", false);
            return;
          }
          if (ev.key === "End") {
            ev.preventDefault();
            tvElevatorJumpClient("bottom", false);
            return;
          }
          if (isMediaPlayPauseKeyClient(ev) && isCatalogCardDirectlyActiveClient()) {
            ev.preventDefault();
            ev.stopPropagation();
            if (!ev.repeat) {
              triggerCardTrailerByElClient(currentSpatialEl, ev);
            }
            return;
          }
          if (isRemoteMenuKeyClient(ev) && isCatalogCardDirectlyActiveClient()) {
            ev.preventDefault();
            ev.stopPropagation();
            if (!ev.repeat) {
              triggerCardWishlistByElClient(currentSpatialEl, ev);
            }
            return;
          }
          const isSpaceKey = ev.code === "Space" || ev.key === " ";
          if (isSpaceKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey && isCatalogCardDirectlyActiveClient()) {
            ev.preventDefault();
            ev.stopPropagation();
            if (!ev.repeat) {
              triggerCardTrailerByElClient(currentSpatialEl, ev);
            }
            return;
          }
        }

        // Größenanpassung per + und - auf der Tastatur (sofern man nicht in einem Textfeld tippt)
        if (!isTypingInInput && (ev.key === "+" || ev.key === "=" || ev.code === "NumpadAdd")) {
          ev.preventDefault();
          adjustOverallScaleStep(5);
          return;
        }
        if (!isTypingInInput && (ev.key === "-" || ev.key === "_" || ev.code === "NumpadSubtract")) {
          ev.preventDefault();
          adjustOverallScaleStep(-5);
          return;
        }

        // Nahtlose Pfeiltasten-Navigation auch aus dem Suchfeld heraus (inkl. ruhigem 450ms Gedrückthalten im Detail-Modal ohne Fokus-Herumspringen)
        if (ev.key === "ArrowRight") {
          resetVerticalTurboStreakClient();
          if (currentSpatialEl && currentSpatialEl.id === "pageJumpRangeSlider" && typeof adjustPageJumpModalValueClient === "function") {
            ev.preventDefault();
            adjustPageJumpModalValueClient(ev.shiftKey ? 5 : 1);
            return;
          }
          const modalOpen = Boolean(document.getElementById("modalRoot")?.innerHTML.trim());
          if (modalOpen && ev.shiftKey && !isTypingInInput) {
            cancelModalArrowHold();
            const nextBtn = document.getElementById("modalAdjNextBtn");
            if (nextBtn) { ev.preventDefault(); nextBtn.click(); return; }
          }
          if (isSearchInpFocused) {
            const valLen = (activeEl.value || "").length;
            const atEnd = valLen === 0 || activeEl.selectionEnd === valLen;
            if (!atEnd) return;
            activeEl.blur();
          } else if (isTypingInInput) {
            return;
          } else if (activeTag === "SELECT") {
            activeEl.blur();
          }
          ev.preventDefault();
          if (modalOpen && modalHoldNavEnabled && !isTypingInInput) {
            const adjNext = getAdjacentDetailItem(1);
            if (adjNext) {
              if (!ev.repeat && modalHoldActiveKey !== "ArrowRight") {
                startModalArrowHold("ArrowRight", 1, adjNext);
              }
              return;
            }
          }
          moveSpatialFocus("right", false, Boolean(ev.repeat));
          return;
        }
        if (ev.key === "ArrowLeft") {
          resetVerticalTurboStreakClient();
          if (currentSpatialEl && currentSpatialEl.id === "pageJumpRangeSlider" && typeof adjustPageJumpModalValueClient === "function") {
            ev.preventDefault();
            adjustPageJumpModalValueClient(ev.shiftKey ? -5 : -1);
            return;
          }
          const modalOpen = Boolean(document.getElementById("modalRoot")?.innerHTML.trim());
          if (modalOpen && ev.shiftKey && !isTypingInInput) {
            cancelModalArrowHold();
            const prevBtn = document.getElementById("modalAdjPrevBtn");
            if (prevBtn) { ev.preventDefault(); prevBtn.click(); return; }
          }
          if (isSearchInpFocused) {
            const valLen = (activeEl.value || "").length;
            const atStart = valLen === 0 || activeEl.selectionStart === 0;
            if (!atStart) return;
            activeEl.blur();
          } else if (isTypingInInput) {
            return;
          } else if (activeTag === "SELECT") {
            activeEl.blur();
          }
          ev.preventDefault();
          if (modalOpen && modalHoldNavEnabled && !isTypingInInput) {
            const adjPrev = getAdjacentDetailItem(-1);
            if (adjPrev) {
              if (!ev.repeat && modalHoldActiveKey !== "ArrowLeft") {
                startModalArrowHold("ArrowLeft", -1, adjPrev);
              }
              return;
            }
          }
          moveSpatialFocus("left", false, Boolean(ev.repeat));
          return;
        }
        if (ev.key === "ArrowDown") {
          cancelModalArrowHold();
          if (ev.repeat && verticalTurboDir === "down" && (verticalHoldTimer || verticalTurboExpressDone)) {
            ev.preventDefault();
            return;
          }
          const acOpen = Boolean(document.getElementById("searchAutocompleteBox")?.classList.contains("open"));
          if (isSearchInpFocused && acOpen && typeof onSearchInputKeyDownClient === "function") {
            onSearchInputKeyDownClient(ev, activeEl);
            return;
          }
          ev.preventDefault();
          if ((isSearchInpFocused && !acOpen) || activeTag === "SELECT") activeEl.blur();
          handleVerticalDirectionStepWithTurboClient("down", Boolean(ev.repeat));
          return;
        }
        if (ev.key === "ArrowUp") {
          cancelModalArrowHold();
          if (ev.repeat && verticalTurboDir === "up" && (verticalHoldTimer || verticalTurboExpressDone)) {
            ev.preventDefault();
            return;
          }
          const acOpen = Boolean(document.getElementById("searchAutocompleteBox")?.classList.contains("open"));
          if (isSearchInpFocused && acOpen && typeof onSearchInputKeyDownClient === "function") {
            onSearchInputKeyDownClient(ev, activeEl);
            return;
          }
          ev.preventDefault();
          if ((isSearchInpFocused && !acOpen) || activeTag === "SELECT") activeEl.blur();
          handleVerticalDirectionStepWithTurboClient("up", Boolean(ev.repeat));
          return;
        }

        // Enter / Fire TV OK: Auf einem Film-Cover öffnet kurzes Drücken direkt Details; Gedrückthalten (>= 380ms) oder Shift+Enter schaltet die Merkliste um!
        if (isConfirmSelectKeyClient(ev) && !isTypingInInput && currentSpatialEl) {
          cancelModalArrowHold();
          resetVerticalTurboStreakClient();
          ev.preventDefault();
          if (currentSpatialEl.id === "pageJumpNumberInput") {
            currentSpatialEl.focus();
            if (typeof currentSpatialEl.select === "function") currentSpatialEl.select();
            return;
          }
          if (currentSpatialEl.classList && currentSpatialEl.classList.contains("card")) {
            if (ev.shiftKey) {
              if (!ev.repeat) {
                cancelCardEnterHold();
                triggerCardWishlistByElClient(currentSpatialEl, ev);
              }
              return;
            }
            if (!ev.repeat && cardEnterHoldTarget !== currentSpatialEl) {
              cancelCardEnterHold();
              cardEnterHoldTarget = currentSpatialEl;
              cardEnterHoldTriggered = false;
              cardEnterHoldTarget.classList.add("is-enter-holding");
              cardEnterHoldTimer = setTimeout(() => {
                cardEnterHoldTimer = null;
                cardEnterHoldTriggered = true;
                const target = cardEnterHoldTarget;
                if (target && target.classList) target.classList.remove("is-enter-holding");
                cardEnterHoldTarget = null;
                if (target && currentSpatialEl === target) {
                  clearCardSubnavState(null);
                  triggerCardWishlistByElClient(target, null);
                }
              }, CARD_ENTER_HOLD_MS);
            }
            return;
          }
          if (!ev.repeat) {
            handleSpatialConfirmAction();
          }
          return;
        }

        // Type-to-Search: Sobald auf der Tastatur ein Buchstabe/Zahl getippt wird, startet automatisch die Suche!
        if (!isTypingInInput && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.length === 1 && /[a-zA-Z0-9äöüÄÖÜß]/.test(ev.key)) {
          const modalOpen = Boolean(document.getElementById("modalRoot")?.innerHTML.trim());
          const dialogOpen = Boolean(document.getElementById("customDialogRoot")?.innerHTML.trim());
          const rmOpen = Boolean(document.getElementById("tvQuickJumpElevator")?.classList.contains("has-subpanel"));
          if (!modalOpen && !dialogOpen && !rmOpen) {
            const sInp = document.getElementById("searchInput");
            if (sInp) {
              setSpatialFocus(sInp, false);
              onSearchInputFocus();
              sInp.focus();
            }
          }
        }
      });

      // Gamepad / Controller Polling (Auto-Erkennung PlayStation DualSense/DualShock vs. Xbox / Android TV Gamepad)
      // Inkl. L2/R2 Seiten-/Block-Sprung (umschaltbar auf Zoom), Turbo-D-Pad, R3 100%-Zoom-Reset, Rechtem Stick 60fps Scrollen, X/□ Speichern, Y/△ Suche!
      let lastGamepadStepAt = 0;
      let lastGamepadZoomAt = 0;
      let lastGamepadActivityAt = 0;
      let activeControllerBrand = "";
      let gamepadVerticalHeld = false;
      let gamepadBtnAPrevPressed = false;
      let gamepadBtnADownAt = 0;
      let gamepadBtnACardEl = null;
      let gamepadBtnAHoldFired = false;

      function isPlayStationControllerClient(gpId) {
        const s = String(gpId || "").toLowerCase();
        return s.includes("dualsense") || s.includes("dualshock") || s.includes("playstation") || s.includes("sony") || s.includes("054c") || s.includes("wireless controller");
      }

      function syncControllerHudBarClient(gp) {
        const hud = document.getElementById("controllerHudBar");
        if (!hud) return;
        const isPs = isPlayStationControllerClient(gp?.id || "");
        activeInputProfile = isPs ? "gamepad-ps" : "gamepad-xbox";
        const activeCinemaCtx = getActiveForegroundCinemaContextClient();
        if (activeCinemaCtx) {
          const brandKey = (isPs ? "ps_cinema_" : "xbox_cinema_") + (activeCinemaCtx.isEnded ? "end" : "play");
          if (activeControllerBrand !== brandKey || !hud.innerHTML) {
            activeControllerBrand = brandKey;
            if (isPs) {
              hud.innerHTML =
                '<span class="hud-item"><kbd>✕</kbd> ' + (activeCinemaCtx.isEnded ? 'Auswahl' : 'Auswahl/Pause') + '</span>' +
                '<span class="hud-item"><kbd>○</kbd> Schließen</span>' +
                '<span class="hud-item"><kbd>□</kbd> Untertitel</span>' +
                '<span class="hud-item"><kbd>△</kbd> Ton</span>' +
                '<span class="hud-item"><kbd>L1</kbd><kbd>R1</kbd> ' + (activeCinemaCtx.isEnded ? '◀/▶' : '±10s') + '</span>' +
                '<span class="hud-item"><kbd>L2</kbd><kbd>R2</kbd> Lautstärke</span>' +
                '<span class="hud-item"><kbd>R3</kbd> 0:00</span>';
            } else {
              hud.innerHTML =
                '<span class="hud-item"><kbd>A</kbd> ' + (activeCinemaCtx.isEnded ? 'Auswahl' : 'Auswahl/Pause') + '</span>' +
                '<span class="hud-item"><kbd>B</kbd> Schließen</span>' +
                '<span class="hud-item"><kbd>X</kbd> Untertitel</span>' +
                '<span class="hud-item"><kbd>Y</kbd> Ton</span>' +
                '<span class="hud-item"><kbd>LB</kbd><kbd>RB</kbd> ' + (activeCinemaCtx.isEnded ? '◀/▶' : '±10s') + '</span>' +
                '<span class="hud-item"><kbd>LT</kbd><kbd>RT</kbd> Lautstärke</span>' +
                '<span class="hud-item"><kbd>R3</kbd> 0:00</span>';
            }
          }
          hud.classList.add("visible");
          return;
        }
        // Wenn die ruhige Katalog-Fokus-Info-Zeile für ein Cover aktiv ist, übernimmt sie die Controller-Hinweise ohne Überlappung!
        if (isCatalogCardDirectlyActiveClient()) {
          syncCatalogFocusInfoBarClient();
          hud.classList.remove("visible");
          return;
        }
        const modeLabel = controllerL2R2Mode === "zoom" ? "Zoom" : "Seite/Sprung";
        const brandKey = (isPs ? "ps_" : "xbox_") + controllerL2R2Mode;
        if (activeControllerBrand !== brandKey || !hud.innerHTML) {
          activeControllerBrand = brandKey;
          if (isPs) {
            hud.innerHTML =
              '<span class="hud-item"><kbd>✕</kbd> Auswahl</span>' +
              '<span class="hud-item"><kbd>○</kbd> Zurück</span>' +
              '<span class="hud-item"><kbd>□</kbd> Speichern</span>' +
              '<span class="hud-item"><kbd>△</kbd> Suche</span>' +
              '<span class="hud-item"><kbd>L1</kbd><kbd>R1</kbd> ◀/▶</span>' +
              '<span class="hud-item" style="cursor:pointer;pointer-events:auto" onclick="toggleControllerTriggerModeClient()" title="Klicken zum Umschalten zwischen Seiten-Sprung und Live-Zoom"><kbd>L2</kbd><kbd>R2</kbd> ' + modeLabel + '</span>' +
              '<span class="hud-item"><kbd>R3</kbd> 100%</span>';
          } else {
            hud.innerHTML =
              '<span class="hud-item"><kbd>A</kbd> Auswahl</span>' +
              '<span class="hud-item"><kbd>B</kbd> Zurück</span>' +
              '<span class="hud-item"><kbd>X</kbd> Speichern</span>' +
              '<span class="hud-item"><kbd>Y</kbd> Suche</span>' +
              '<span class="hud-item"><kbd>LB</kbd><kbd>RB</kbd> ◀/▶</span>' +
              '<span class="hud-item" style="cursor:pointer;pointer-events:auto" onclick="toggleControllerTriggerModeClient()" title="Klicken zum Umschalten zwischen Seiten-Sprung und Live-Zoom"><kbd>LT</kbd><kbd>RT</kbd> ' + modeLabel + '</span>' +
              '<span class="hud-item"><kbd>R3</kbd> 100%</span>';
          }
        }
        hud.classList.add("visible");
      }

      function pollGamepadNavigation() {
        try {
          const pads = navigator.getGamepads ? navigator.getGamepads() : [];
          const gp = pads && (pads[0] || pads[1] || pads[2] || pads[3]);
          if (gp) {
            const now = Date.now();
            const axX = gp.axes?.[0] || 0;
            const axY = gp.axes?.[1] || 0;
            const rightStickX = gp.axes?.[2] || 0;
            const rightStickY = gp.axes?.[3] || 0;
            const activeCinemaCtx = getActiveForegroundCinemaContextClient();

            // Isolierte Trailer-Player Controller-Steuerung (inkl. Pause-Menü & Endcard) ohne jegliche Überschneidung mit dem Hintergrund!
            if (activeCinemaCtx) {
              const btnL2 = Boolean(gp.buttons?.[6]?.pressed || (gp.buttons?.[6]?.value || 0) > 0.45);
              const btnR2 = Boolean(gp.buttons?.[7]?.pressed || (gp.buttons?.[7]?.value || 0) > 0.45);
              if ((btnL2 || btnR2) && now - lastGamepadZoomAt > 175) {
                lastGamepadZoomAt = now;
                lastGamepadActivityAt = now;
                engageKeyboardNavMode();
                syncControllerHudBarClient(gp);
                wakeActiveCinemaDockClient(activeCinemaCtx);
                const volDelta = btnR2 ? 10 : -10;
                if (activeCinemaCtx.mode === "detail" && typeof adjustDetailCinemaVolumeStepClient === "function") adjustDetailCinemaVolumeStepClient(volDelta);
                else if (activeCinemaCtx.mode === "hero" && typeof adjustHeroCinemaVolumeStepClient === "function") adjustHeroCinemaVolumeStepClient(volDelta);
              }

              if (now - lastGamepadStepAt > 180) {
                const up = Boolean(gp.buttons?.[12]?.pressed || axY < -0.55);
                const down = Boolean(gp.buttons?.[13]?.pressed || axY > 0.55);
                const left = Boolean(gp.buttons?.[14]?.pressed || axX < -0.55);
                const right = Boolean(gp.buttons?.[15]?.pressed || axX > 0.55);
                const btnA = gp.buttons?.[0]?.pressed;
                const btnB = gp.buttons?.[1]?.pressed;
                const btnX = gp.buttons?.[2]?.pressed;
                const btnY = gp.buttons?.[3]?.pressed;
                const btnLB = gp.buttons?.[4]?.pressed;
                const btnRB = gp.buttons?.[5]?.pressed;
                const btnR3 = gp.buttons?.[11]?.pressed;

                if (up || down || left || right || btnA || btnB || btnX || btnY || btnLB || btnRB || btnR3) {
                  lastGamepadActivityAt = now;
                  engageKeyboardNavMode();
                  syncControllerHudBarClient(gp);
                }

                if (up) { navigateCinemaPlayerFocusClient("up", activeCinemaCtx); lastGamepadStepAt = now; }
                else if (down) { navigateCinemaPlayerFocusClient("down", activeCinemaCtx); lastGamepadStepAt = now; }
                else if (left) { navigateCinemaPlayerFocusClient("left", activeCinemaCtx); lastGamepadStepAt = now; }
                else if (right) { navigateCinemaPlayerFocusClient("right", activeCinemaCtx); lastGamepadStepAt = now; }
                else if (btnA) {
                  confirmCinemaPlayerFocusClient(activeCinemaCtx);
                  lastGamepadStepAt = now + 130;
                }
                else if (btnB) {
                  if (activeCinemaCtx.mode === "detail" && typeof exitDetailForegroundTrailerModeClient === "function") exitDetailForegroundTrailerModeClient();
                  else if (activeCinemaCtx.mode === "hero" && typeof exitHeroForegroundTrailerModeClient === "function") exitHeroForegroundTrailerModeClient();
                  lastGamepadStepAt = now + 180;
                }
                else if (btnX) {
                  wakeActiveCinemaDockClient(activeCinemaCtx);
                  if (activeCinemaCtx.mode === "detail" && typeof toggleDetailCinemaSubtitlesClient === "function") toggleDetailCinemaSubtitlesClient();
                  else if (activeCinemaCtx.mode === "hero" && typeof toggleHeroCinemaSubtitlesClient === "function") toggleHeroCinemaSubtitlesClient();
                  lastGamepadStepAt = now + 180;
                }
                else if (btnY) {
                  wakeActiveCinemaDockClient(activeCinemaCtx);
                  if (activeCinemaCtx.mode === "detail" && typeof toggleDetailBackgroundTeaserAudioClient === "function") toggleDetailBackgroundTeaserAudioClient();
                  else if (activeCinemaCtx.mode === "hero" && typeof toggleHeroBackgroundTeaserAudioClient === "function") toggleHeroBackgroundTeaserAudioClient();
                  lastGamepadStepAt = now + 180;
                }
                else if (btnLB || btnRB) {
                  wakeActiveCinemaDockClient(activeCinemaCtx);
                  if (activeCinemaCtx.isEnded) {
                    navigateCinemaPlayerFocusClient(btnRB ? "right" : "left", activeCinemaCtx);
                  } else {
                    const seekSec = btnRB ? 10 : -10;
                    if (activeCinemaCtx.mode === "detail" && typeof seekDetailCinemaRelativeClient === "function") seekDetailCinemaRelativeClient(seekSec);
                    else if (activeCinemaCtx.mode === "hero" && typeof seekHeroCinemaRelativeClient === "function") seekHeroCinemaRelativeClient(seekSec);
                  }
                  lastGamepadStepAt = now + 160;
                }
                else if (btnR3) {
                  wakeActiveCinemaDockClient(activeCinemaCtx);
                  if (activeCinemaCtx.mode === "detail" && typeof restartDetailCinemaTrailerClient === "function") restartDetailCinemaTrailerClient();
                  else if (activeCinemaCtx.mode === "hero" && typeof restartHeroCinemaTrailerClient === "function") restartHeroCinemaTrailerClient();
                  lastGamepadStepAt = now + 220;
                }
              }

              if (lastGamepadActivityAt && now - lastGamepadActivityAt > 8500) {
                const hud = document.getElementById("controllerHudBar");
                if (hud) hud.classList.remove("visible");
              }
              requestAnimationFrame(pollGamepadNavigation);
              return;
            }

            // Rechter Analog-Stick (axes[2], axes[3]): Butterweiches 60fps Scrollen ohne Fokus-Sprung!
            if (Math.abs(rightStickY) > 0.18 || Math.abs(rightStickX) > 0.22) {
              lastGamepadActivityAt = now;
              syncControllerHudBarClient(gp);
              userScrolledRecently = true;
              const dy = Math.abs(rightStickY) > 0.18 ? (rightStickY * 18) : 0;
              const dx = Math.abs(rightStickX) > 0.22 ? (rightStickX * 16) : 0;
              const subBody = state.sidebarOpen && state.sidebarSubPanelOpen ? document.querySelector("#sidebarRightSubPanel .sidebar-sub-body") : null;
              const sbBody = state.sidebarOpen ? document.getElementById("sidebarDrawerBody") : null;
              const modalBackdrop = document.querySelector("#modalRoot .modal-backdrop");
              if (subBody && currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#sidebarRightSubPanel")) {
                subBody.scrollTop += dy;
              } else if (sbBody) {
                sbBody.scrollTop += dy;
              } else if (modalBackdrop) {
                if (Math.abs(dx) > Math.abs(dy) * 1.2) {
                  const horizTrack = currentSpatialEl && currentSpatialEl.closest ? currentSpatialEl.closest(".detail-cast-track, .detail-similar-track") : document.querySelector("#modalRoot .detail-cast-track, #modalRoot .detail-similar-track");
                  if (horizTrack) horizTrack.scrollLeft += dx;
                } else {
                  modalBackdrop.scrollTop += dy;
                }
              } else {
                window.scrollBy(0, dy);
              }
            }

            // L2 / LT (buttons[6]) & R2 / RT (buttons[7]): Standardmäßig 5-Zeilen-/Seiten-Blättern (optional umschaltbar auf Live-Zoom)
            const btnL2 = Boolean(gp.buttons?.[6]?.pressed || (gp.buttons?.[6]?.value || 0) > 0.45);
            const btnR2 = Boolean(gp.buttons?.[7]?.pressed || (gp.buttons?.[7]?.value || 0) > 0.45);
            const triggerCooldown = controllerL2R2Mode === "zoom" ? 175 : 260;
            if ((btnL2 || btnR2) && now - lastGamepadZoomAt > triggerCooldown) {
              lastGamepadZoomAt = now;
              lastGamepadActivityAt = now;
              engageKeyboardNavMode();
              syncControllerHudBarClient(gp);
              if (controllerL2R2Mode === "zoom") {
                if (btnR2) adjustOverallScaleStep(5);
                else if (btnL2) adjustOverallScaleStep(-5);
              } else {
                if (btnR2) handleTvQuickPageOrBlockStepClient(1);
                else if (btnL2) handleTvQuickPageOrBlockStepClient(-1);
              }
            }

            const upHeld = Boolean(gp.buttons?.[12]?.pressed || axY < -0.55);
            const downHeld = Boolean(gp.buttons?.[13]?.pressed || axY > 0.55);
            if (!upHeld && !downHeld) {
              if (gamepadVerticalHeld) {
                gamepadVerticalHeld = false;
                if (verticalTurboDir) resetVerticalTurboStreakClient();
              }
            } else {
              gamepadVerticalHeld = true;
            }

            // ✕ / A auf Film-Cover: Kurz drücken = Direkt Details, Gedrückthalten (>= 380ms) = Instant-Trailer!
            const rawBtnA = Boolean(gp.buttons?.[0]?.pressed);
            if (rawBtnA && !gamepadBtnAPrevPressed && isCatalogCardDirectlyActiveClient()) {
              gamepadBtnADownAt = now;
              gamepadBtnACardEl = currentSpatialEl;
              gamepadBtnAHoldFired = false;
              gamepadBtnACardEl.classList.add("is-enter-holding");
              lastGamepadActivityAt = now;
              engageKeyboardNavMode();
              syncControllerHudBarClient(gp);
            } else if (rawBtnA && gamepadBtnACardEl && !gamepadBtnAHoldFired && now - gamepadBtnADownAt >= CARD_ENTER_HOLD_MS) {
              gamepadBtnAHoldFired = true;
              gamepadBtnACardEl.classList.remove("is-enter-holding");
              const holdTarget = gamepadBtnACardEl;
              if (currentSpatialEl === holdTarget) {
                triggerCardTrailerByElClient(holdTarget, null);
              }
              lastGamepadStepAt = now + 220;
            } else if (!rawBtnA && gamepadBtnAPrevPressed && gamepadBtnACardEl) {
              const relCard = gamepadBtnACardEl;
              const wasHold = gamepadBtnAHoldFired;
              relCard.classList.remove("is-enter-holding");
              gamepadBtnACardEl = null;
              gamepadBtnADownAt = 0;
              gamepadBtnAHoldFired = false;
              if (!wasHold && currentSpatialEl === relCard) {
                resetVerticalTurboStreakClient();
                relCard.click();
                lastGamepadStepAt = now + 120;
              }
            }
            gamepadBtnAPrevPressed = rawBtnA;

            const dynamicGamepadInterval = 180;
            if (now - lastGamepadStepAt > dynamicGamepadInterval) {
              const up = upHeld;
              const down = downHeld;
              const left = gp.buttons?.[14]?.pressed || axX < -0.55;
              const right = gp.buttons?.[15]?.pressed || axX > 0.55;
              const btnA = rawBtnA && !gamepadBtnACardEl;
              const btnB = gp.buttons?.[1]?.pressed;
              const btnX = gp.buttons?.[2]?.pressed;
              const btnY = gp.buttons?.[3]?.pressed;
              const btnLB = gp.buttons?.[4]?.pressed;
              const btnRB = gp.buttons?.[5]?.pressed;
              const btnStart = gp.buttons?.[9]?.pressed;
              const btnR3 = gp.buttons?.[11]?.pressed;

              if (up || down || left || right || btnA || btnB || btnX || btnY || btnLB || btnRB || btnStart || btnR3) {
                lastGamepadActivityAt = now;
                engageKeyboardNavMode();
                syncControllerHudBarClient(gp);
              }

              if (up) { handleVerticalDirectionStepWithTurboClient("up", verticalTurboDir === "up"); lastGamepadStepAt = now; }
              else if (down) { handleVerticalDirectionStepWithTurboClient("down", verticalTurboDir === "down"); lastGamepadStepAt = now; }
              else if (left) { resetVerticalTurboStreakClient(); moveSpatialFocus("left", false, true); lastGamepadStepAt = now; }
              else if (right) { resetVerticalTurboStreakClient(); moveSpatialFocus("right", false, true); lastGamepadStepAt = now; }
              else if (btnStart && isCatalogCardDirectlyActiveClient()) {
                resetVerticalTurboStreakClient();
                triggerCardTrailerByElClient(currentSpatialEl, null);
                lastGamepadStepAt = now + 220;
              }
              else if (btnA && currentSpatialEl) {
                resetVerticalTurboStreakClient();
                handleSpatialConfirmAction();
                lastGamepadStepAt = now + 120;
              }
              else if (btnB) {
                resetVerticalTurboStreakClient();
                if (state.sidebarOpen && state.sidebarSubPanelOpen && currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#sidebarRightSubPanel")) {
                  if (typeof closeSidebarSubPanelToMain === "function") closeSidebarSubPanelToMain();
                } else if (currentSpatialEl && isCardSubElement(currentSpatialEl)) {
                  const parentCard = currentSpatialEl.closest(".card");
                  clearCardSubnavState(null);
                  if (parentCard) setSpatialFocus(parentCard, false);
                } else if (currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#tvQuickJumpElevator") && lastElevatorReturnEl && document.body.contains(lastElevatorReturnEl)) {
                  setSpatialFocus(lastElevatorReturnEl, true, "left");
                } else {
                  goBack();
                }
                lastGamepadStepAt = now + 150;
              }
              else if (btnX) {
                const modalWlBtn = document.getElementById("modalWishlistBtn");
                if (modalWlBtn && document.getElementById("modalRoot")?.innerHTML.trim()) {
                  modalWlBtn.click();
                } else {
                  const focusedCard = currentSpatialEl && currentSpatialEl.closest ? currentSpatialEl.closest(".card[data-card-key]") : null;
                  if (focusedCard) {
                    const saveBtn = focusedCard.querySelector(".card-quick-save");
                    if (saveBtn) saveBtn.click();
                  } else {
                    const heroWl = document.getElementById("heroBtnWishlist");
                    if (heroWl) heroWl.click();
                  }
                }
                lastGamepadStepAt = now + 180;
              }
              else if (btnY) {
                if (state.sidebarOpen) closeFilterSidebar();
                const sInp = document.getElementById("searchInput");
                if (sInp) {
                  setSpatialFocus(sInp, true, "up");
                  onSearchInputFocus();
                  sInp.focus();
                }
                lastGamepadStepAt = now + 180;
              }
              else if (btnR3) {
                resetUiScale();
                lastGamepadStepAt = now + 220;
              }
              else if (btnLB) {
                if (document.getElementById("modalRoot")?.innerHTML.trim()) {
                  navigateDetailModalAdjacent(-1);
                } else {
                  setHeroSlideIndex(state.heroIndex - 1);
                }
                lastGamepadStepAt = now + 160;
              }
              else if (btnRB) {
                if (document.getElementById("modalRoot")?.innerHTML.trim()) {
                  navigateDetailModalAdjacent(1);
                } else {
                  setHeroSlideIndex(state.heroIndex + 1);
                }
                lastGamepadStepAt = now + 160;
              }
            }

            if (lastGamepadActivityAt && now - lastGamepadActivityAt > 8500) {
              const hud = document.getElementById("controllerHudBar");
              if (hud) hud.classList.remove("visible");
            }
          }
        } catch (e) {}
        requestAnimationFrame(pollGamepadNavigation);
      }
      requestAnimationFrame(pollGamepadNavigation);

      window.__TELEPORT_BOOTED__ = true;
      try {
        const mRoot = document.getElementById("modalRoot");
        if (mRoot && typeof MutationObserver !== "undefined") {
          const backBtnObs = new MutationObserver(() => {
            if (typeof syncTelegramBackButtonClient === "function") syncTelegramBackButtonClient();
            if (typeof syncCatalogFocusInfoBarClient === "function") syncCatalogFocusInfoBarClient();
          });
          backBtnObs.observe(mRoot, { childList: true, subtree: false });
        }
      } catch (_e) {}
      initAuthSession();
      setTimeout(() => {
        if (typeof pollAntiSpamQueueClient === "function") pollAntiSpamQueueClient(true);
        const hasLocalBackupCp = typeof loadBackupCheckpointClient === "function"
          ? Boolean(loadBackupCheckpointClient())
          : (() => {
              try {
                const raw = localStorage.getItem("tma_backup_import_checkpoint_v1");
                if (!raw) return false;
                const cp = JSON.parse(raw);
                return Boolean(cp && typeof cp === "object" && (Number(cp.cursor) > 0 || Number(cp.totalEntries || cp.total) > 0));
              } catch (_e) {
                return false;
              }
            })();
        if (state.authUser?.isAdmin || hasLocalBackupCp) {
          if (typeof restoreBackupImportSessionAfterReload === "function") {
            restoreBackupImportSessionAfterReload();
          }
        }
      }, 900);
    </script>
    <!-- @TMA_STATIC_JS_END -->
  </body>
  </html>`;
  }
