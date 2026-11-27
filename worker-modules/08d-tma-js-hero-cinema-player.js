      // =========================================================================
      // HAUPTSLIDER INLINE-KINO-TRAILER ENGINE (1:1 wie Detailansicht: Im Hintergrund vorladen, erst beim Tippen einblenden)
      // =========================================================================
      let heroBgTeaserTimer = null;
      let heroBgTeaserRevealTimer = null;
      let heroBgTeaserRevealTargetAt = 0;
      let heroBgTeaserDelayedPauseTimer = null;
      let heroBgTeaserWatchdogTimer = null;
      let heroBgTeaserHandshakeTimer = null;
      let heroBgTeaserStageOpenedAt = 0;
      let heroBgTeaserPlayingStartedAt = 0;
      let heroBgTeaserChromeShieldRequired = true;
      let heroBgTeaserPreloadedParked = false;
      let heroBgTeaserMuted = true;
      let heroBgTeaserUserMuted = false;
      let heroBgTeaserPendingUnmute = false;
      let heroBgTeaserUnmuteRetries = 0;
      let heroBgTeaserUnmuteRetryTimers = [];
      let heroBgTeaserDeferTimer = null;
      let heroBgTeaserPaused = false;
      let heroBgTeaserEnded = false;
      let heroBgTeaserStoppedByUser = false;
      let heroBgTeaserIsPlayingConfirmed = false;
      let heroBgTeaserActiveKey = "";
      let heroBgTeaserActiveSlideKey = "";
      let heroBgTeaserCandidates = [];
      let heroBgTeaserCandidatesSlideKey = "";
      let heroBgTeaserRequestSeq = 0;
      let heroBgTeaserCandidateIdx = 0;
      let heroBgTeaserCurTime = 0;
      let heroBgTeaserDuration = 0;
      let heroBgTeaserScrubbing = false;
      let heroBgTeaserLastInfoAt = 0;
      let heroCinemaLiveClockTimer = null;
      let heroCinemaLiveClockLastTickAt = 0;
      let heroCinemaLiveClockPingCount = 0;

      function clearHeroUnmuteRetryTimersClient() {
        if (Array.isArray(heroBgTeaserUnmuteRetryTimers) && heroBgTeaserUnmuteRetryTimers.length) {
          heroBgTeaserUnmuteRetryTimers.forEach(t => clearTimeout(t));
          heroBgTeaserUnmuteRetryTimers = [];
        }
      }

      function enforceHeroForegroundUnmuteClient() {
        clearHeroUnmuteRetryTimersClient();
        heroBgTeaserUserMuted = false;
        heroBgTeaserMuted = false;
        heroBgTeaserPendingUnmute = true;
        heroBgTeaserUnmuteRetries = 0;
        window._heroUnmuteGraceUntil = Date.now() + 3000;
        const applyOnce = () => {
          const st = document.getElementById("heroStageEl");
          if (!st || !st.classList.contains("is-trailer-foreground-mode") || heroBgTeaserUserMuted) return;
          const targetVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
          sendYoutubeHeroTeaserCommandClient("unMute");
          sendYoutubeHeroTeaserCommandClient("setVolume", [targetVol]);
        };
        applyOnce();
        heroBgTeaserUnmuteRetryTimers.push(setTimeout(applyOnce, 240));
        heroBgTeaserUnmuteRetryTimers.push(setTimeout(applyOnce, 680));
      }
      const CINEMA_ICONS_CLIENT = {
        play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.2 5.14v13.72a1 1 0 0 0 1.53.85l10.8-6.86a1 1 0 0 0 0-1.7L9.73 4.29A1 1 0 0 0 8.2 5.14Z"/></svg>',
        pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.4"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.4"/></svg>',
        replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
        restart: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="2.4" height="14" rx="1.2"/><path d="M18.6 5.6a1 1 0 0 0-1.52-.85l-8.4 5.4a1 1 0 0 0 0 1.7l8.4 5.4a1 1 0 0 0 1.52-.85V5.6Z"/></svg>',
        nextClip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.4 5.6a1 1 0 0 1 1.52-.85l8.4 5.4a1 1 0 0 1 0 1.7l-8.4 5.4a1 1 0 0 1-1.52-.85V5.6Z"/><rect x="16.6" y="5" width="2.4" height="14" rx="1.2"/></svg>',
        stream: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="M10 9.2L15.2 12L10 14.8V9.2Z" fill="currentColor" stroke="none"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5"/><circle cx="12" cy="7.6" r="1" fill="currentColor" stroke="none"/></svg>',
        close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
        volHigh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none"/><path d="M15.4 8.6a5 5 0 0 1 0 6.8"/><path d="M18.5 5.8a9 9 0 0 1 0 12.4"/></svg>',
        volLow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none"/><path d="M15.4 8.6a5 5 0 0 1 0 6.8"/></svg>',
        volMute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none"/><path d="M16 9l5 6M21 9l-5 6"/></svg>',
        chevUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
        chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
      };

      const CINEMA_TELEPORT_BRAND_SVG = '<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="11.5" stroke="#38bdf8" stroke-width="2.4" stroke-dasharray="18 5"/><circle cx="14" cy="14" r="7.5" stroke="#818cf8" stroke-width="1.4" stroke-opacity="0.8"/><path d="M11.8 9.8L18.5 14L11.8 18.2V9.8Z" fill="#38bdf8"/></svg>';

      // Einheitliche Cinema-Player-Komponente für Hero-Slider, Detailseite & Instant-Trailer (100% 1:1 Parität)
      function buildCinemaPlayerOverlayHtmlClient(opts = {}) {
        const isHero = opts.mode === "hero";
        const p = isHero ? "hero" : "detail";
        const safeTitle = esc(String(opts.title || "").trim());
        const safeYear = esc(String(opts.year || "").trim());
        const hasVipStreams = Boolean(opts.hasVipStreams);
        const wakeFn = isHero ? "wakeHeroCinemaDockClient()" : "wakeDetailCinemaDockClient()";
        const tapFn = isHero ? "onHeroForegroundStageCatcherTapClient(event)" : "onForegroundStageCatcherTapClient(event)";
        const exitFn = isHero ? "exitHeroForegroundTrailerModeClient(event)" : "exitDetailForegroundTrailerModeClient(event)";
        const playFn = isHero ? "toggleHeroCinemaPlayPauseClient(event)" : "toggleDetailCinemaPlayPauseClient(event)";
        const restartFn = isHero ? "restartHeroCinemaTrailerClient(event)" : "restartDetailCinemaTrailerClient(event)";
        const muteFn = isHero ? "toggleHeroBackgroundTeaserAudioClient(event)" : "toggleDetailBackgroundTeaserAudioClient(event)";
        const volStepUpFn = isHero ? "adjustHeroCinemaVolumeStepClient(10, event)" : "adjustDetailCinemaVolumeStepClient(10, event)";
        const volStepDownFn = isHero ? "adjustHeroCinemaVolumeStepClient(-10, event)" : "adjustDetailCinemaVolumeStepClient(-10, event)";
        const scrubInFn = isHero ? "onHeroCinemaScrubInputClient(this, event)" : "onDetailCinemaScrubInputClient(this, event)";
        const scrubChgFn = isHero ? "onHeroCinemaScrubChangeClient(this, event)" : "onDetailCinemaScrubChangeClient(this, event)";
        const ccFn = isHero ? "toggleHeroCinemaSubtitlesClient(event)" : "toggleDetailCinemaSubtitlesClient(event)";
        const speedFn = isHero ? "cycleHeroCinemaSpeedClient(event)" : "cycleDetailCinemaSpeedClient(event)";
        const nextFn = isHero ? "switchNextHeroTrailerCandidateManualClient(event)" : "switchNextDetailTrailerCandidateManualClient(event)";
        const cancelEndFn = isHero ? "cancelHeroCinemaEndcardCountdownClient(true)" : "cancelDetailCinemaEndcardCountdownClient(true)";
        const secondaryActionFn = isHero
          ? "openHeroDetailsFromCinemaOverlayClient(event)"
          : "triggerDetailStreamFromCinemaOverlayClient(event)";
        const secondaryActionId = isHero ? "heroCinemaPauseDetailsBtn" : "detailCinemaPauseStreamBtn";
        const secondaryLabel = isHero ? "Details & Stream" : (hasVipStreams ? "Stream starten" : "Filminfos ansehen");
        const secondaryIcon = (isHero || hasVipStreams) ? CINEMA_ICONS_CLIENT.stream : CINEMA_ICONS_CLIENT.info;
        const initVol = getSavedTrailerVolumeClient();
        const catcherClass = isHero ? "detail-foreground-stage-catcher hero-foreground-stage-catcher" : "detail-foreground-stage-catcher";
        const dockClass = isHero ? "detail-cinema-player-dock hero-cinema-player-dock" : "detail-cinema-player-dock";

        return '' +
          '<div id="' + p + 'ForegroundStageCatcher" class="' + catcherClass + '" onmousemove="' + wakeFn + '" onclick="' + tapFn + '" title="Einmal tippen: Steuerung / Pause · Doppeltippen links/rechts: ±10s"></div>' +
          '<div id="' + p + 'SeekRippleBadge" class="detail-seek-ripple-badge" aria-live="polite"></div>' +
          '<div id="' + p + 'CinemaTopHud" class="cinema-top-hud" onmousemove="' + wakeFn + '" onclick="event.stopPropagation()">' +
            '<button type="button" id="' + p + 'CinemaTopCloseBtn" class="cinema-top-hud-close" onclick="' + exitFn + '" title="Trailer schließen (Esc)" aria-label="Trailer schließen">✕</button>' +
          '</div>' +
          '<div id="' + p + 'CinemaStartShield" class="cinema-start-center-shield" aria-hidden="true"></div>' +
          '<div id="' + p + 'CinemaStartBottomShield" class="cinema-start-bottom-shield" aria-hidden="true"></div>' +
          '<button type="button" id="' + p + 'CinemaCenterPlayBtn" class="cinema-pause-center-btn" onclick="' + playFn + '" title="Trailer fortsetzen (Leertaste)" aria-label="Trailer fortsetzen">' + CINEMA_ICONS_CLIENT.play + '</button>' +
          '<div id="' + p + 'CinemaPauseCurtain" class="cinema-pause-bottom-curtain" onmousemove="' + wakeFn + '" onclick="event.stopPropagation()">' +
            '<div class="cinema-pause-quick-bar">' +
              '<button type="button" id="' + p + 'CinemaPauseResumeBtn" class="cinema-overlay-btn is-primary" onclick="' + playFn + '">' + CINEMA_ICONS_CLIENT.play + '<span>Fortsetzen</span></button>' +
              '<button type="button" id="' + secondaryActionId + '" class="cinema-overlay-btn" onclick="' + secondaryActionFn + '">' + secondaryIcon + '<span>' + secondaryLabel + '</span></button>' +
              '<button type="button" id="' + p + 'CinemaPauseNextBtn" class="cinema-overlay-btn" style="display:none" onclick="' + nextFn + '">' + CINEMA_ICONS_CLIENT.nextClip + '<span>Nächster Clip</span></button>' +
            '</div>' +
          '</div>' +
          '<div id="' + p + 'CinemaEndOverlay" class="cinema-end-overlay" onclick="event.stopPropagation()">' +
            '<div class="cinema-end-kicker">Trailer beendet</div>' +
            '<div id="' + p + 'CinemaEndTitle" class="cinema-end-title">' + safeTitle + '</div>' +
            '<div class="cinema-end-actions" onmouseenter="' + cancelEndFn + '" onclick="' + cancelEndFn + '">' +
              '<button type="button" id="' + p + 'CinemaEndPrimaryBtn" class="cinema-overlay-btn is-primary" onclick="' + secondaryActionFn + '">' + secondaryIcon + '<span>' + secondaryLabel + '</span></button>' +
              '<button type="button" id="' + p + 'CinemaEndReplayBtn" class="cinema-overlay-btn" onclick="' + restartFn + '">' + CINEMA_ICONS_CLIENT.replay + '<span>Nochmal ansehen</span></button>' +
              '<button type="button" id="' + p + 'CinemaEndNextBtn" class="cinema-overlay-btn" style="display:none" onclick="' + nextFn + '">' + CINEMA_ICONS_CLIENT.nextClip + '<span>Nächster Clip</span></button>' +
              '<button type="button" id="' + p + 'CinemaEndCloseBtn" class="cinema-overlay-btn" onclick="' + exitFn + '">' + CINEMA_ICONS_CLIENT.close + '<span>Schließen</span></button>' +
            '</div>' +
          '</div>' +
          '<div id="' + p + 'CinemaBrandWatermark" class="cinema-teleport-watermark" aria-hidden="true">' +
            CINEMA_TELEPORT_BRAND_SVG +
            '<span>Tele<span class="tp-accent">Port</span></span>' +
          '</div>' +
          '<div id="' + p + 'CinemaPlayerDock" class="' + dockClass + '" onmousemove="' + wakeFn + '" ontouchstart="' + wakeFn + '" onclick="event.stopPropagation();' + wakeFn + '">' +
            '<div id="' + p + 'CinemaTimelineWrap" class="cinema-dock-timeline-wrap" onmousemove="onCinemaScrubHoverMoveClient(event,\\'' + p + '\\')" onmouseleave="onCinemaScrubHoverLeaveClient(\\'' + p + '\\')">' +
              '<div id="' + p + 'CinemaScrubTooltip" class="cinema-scrub-tooltip" aria-hidden="true">0:00</div>' +
              '<div class="cinema-scrub-kb-hint" aria-hidden="true">◀ -10s · ▶ +10s</div>' +
              '<input type="range" id="' + p + 'CinemaScrubber" class="cinema-dock-scrubber" min="0" max="120" step="1" value="0" oninput="' + scrubInFn + '" onchange="' + scrubChgFn + '" onclick="event.stopPropagation()" title="Im Trailer vor- oder zurückspulen (← / → oder J / L)" aria-label="Wiedergabeposition" />' +
            '</div>' +
            '<div class="cinema-dock-controls-row">' +
              '<div class="cinema-dock-controls-left">' +
                '<button type="button" id="' + p + 'CinemaPlayBtn" class="cinema-dock-btn" data-icon-state="pause" onclick="' + playFn + '" title="Trailer pausieren / fortsetzen (Leertaste)" aria-label="Abspielen oder Pausieren">' + CINEMA_ICONS_CLIENT.pause + '</button>' +
                '<button type="button" id="' + p + 'CinemaRestartBtn" class="cinema-dock-btn" onclick="' + restartFn + '" title="Trailer von Anfang starten – 0:00 (Taste R)" aria-label="Trailer von Anfang starten">' + CINEMA_ICONS_CLIENT.restart + '</button>' +
                '<div id="' + p + 'CinemaVolGroup" class="cinema-dock-vol-group">' +
                  '<button type="button" id="' + p + 'CinemaMuteBtn" class="cinema-dock-btn" data-icon-state="volHigh" onclick="' + muteFn + '" title="Ton umschalten (Enter / M) · Lautstärke: Pfeil ↑ / ↓" aria-label="Lautstärke und Stummschaltung">' +
                    CINEMA_ICONS_CLIENT.volHigh +
                    '<span id="' + p + 'CinemaVolMiniPct" class="cinema-vol-mini-pct">' + initVol + '%</span>' +
                  '</button>' +
                  '<div id="' + p + 'CinemaVolPopover" class="cinema-vol-popover" role="group" aria-label="Lautstärke regeln" onclick="event.stopPropagation()">' +
                    '<span id="' + p + 'CinemaVolPctLbl" class="cinema-vol-pct-lbl">' + initVol + '%</span>' +
                    '<button type="button" id="' + p + 'CinemaVolUpBtn" class="cinema-vol-step-btn" tabindex="-1" onclick="' + volStepUpFn + '" title="Lauter (+10%, Pfeil ↑)" aria-label="Lautstärke erhöhen">' + CINEMA_ICONS_CLIENT.chevUp + '</button>' +
                    '<div id="' + p + 'CinemaVolMeterHit" class="cinema-vol-meter-hit" onpointerdown="onCinemaVolMeterPointerDownClient(event,\\'' + p + '\\')" title="Lautstärke ziehen oder antippen">' +
                      '<div class="cinema-vol-meter-track">' +
                        '<div id="' + p + 'CinemaVolMeterFill" class="cinema-vol-meter-fill" style="--vol-pct:' + initVol + '%"></div>' +
                        '<div id="' + p + 'CinemaVolMeterThumb" class="cinema-vol-meter-thumb" style="--vol-pct:' + initVol + '%"></div>' +
                      '</div>' +
                    '</div>' +
                    '<button type="button" id="' + p + 'CinemaVolDownBtn" class="cinema-vol-step-btn" tabindex="-1" onclick="' + volStepDownFn + '" title="Leiser (-10%, Pfeil ↓)" aria-label="Lautstärke verringern">' + CINEMA_ICONS_CLIENT.chevDown + '</button>' +
                    '<span class="cinema-vol-kb-hint" aria-hidden="true">↑ / ↓</span>' +
                  '</div>' +
                '</div>' +
                '<span id="' + p + 'CinemaTimeLbl" class="cinema-dock-time">0:00</span>' +
              '</div>' +
              '<div class="cinema-dock-controls-right">' +
                '<button type="button" id="' + p + 'CinemaCcBtn" class="cinema-dock-btn cinema-dock-cc-btn" onclick="' + ccFn + '" title="Untertitel umschalten: Aus / DE / EN (Taste C)">CC</button>' +
                '<button type="button" id="' + p + 'CinemaSpeedBtn" class="cinema-dock-btn cinema-dock-speed-btn" onclick="' + speedFn + '" title="Wiedergabegeschwindigkeit ändern (Taste S)">1×</button>' +
                '<button type="button" id="' + p + 'CinemaNextClipBtn" class="cinema-dock-btn" style="display:none" onclick="' + nextFn + '" title="Nächsten verfügbaren Trailer / Clip abspielen (Taste N)">' + CINEMA_ICONS_CLIENT.nextClip + '<span>1/2</span></button>' +
                '<button type="button" id="' + p + 'CinemaModeBtn" class="cinema-dock-btn is-active-mode" data-mode-state="close" onclick="' + exitFn + '" title="Trailer schließen (Esc)" aria-label="Trailer schließen">' + CINEMA_ICONS_CLIENT.close + '<span>Schließen</span></button>' +
                '<div class="cinema-dock-brand" aria-hidden="true">' +
                  CINEMA_TELEPORT_BRAND_SVG +
                  '<span class="cinema-brand-label">Tele<span class="tp-accent">Port</span></span>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      const cinemaVolStepPulseTimers = new Map();
      function flashCinemaVolStepBtnClient(prefix, dir) {
        const btnId = prefix + (dir === "up" ? "CinemaVolUpBtn" : "CinemaVolDownBtn");
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const prev = cinemaVolStepPulseTimers.get(btnId);
        if (prev) clearTimeout(prev);
        btn.classList.add("is-step-pulse");
        cinemaVolStepPulseTimers.set(btnId, setTimeout(() => {
          btn.classList.remove("is-step-pulse");
          cinemaVolStepPulseTimers.delete(btnId);
        }, 190));
      }

      function syncCinemaVolPopoverUiClient(prefix, volVal, isMuted) {
        const dispVol = isMuted ? 0 : Math.max(0, Math.min(100, Math.round(Number(volVal) || 0)));
        const pctStr = dispVol + "%";
        const labelStr = (isMuted || dispVol <= 0) ? "Aus" : pctStr;
        const fillEl = document.getElementById(prefix + "CinemaVolMeterFill");
        const thumbEl = document.getElementById(prefix + "CinemaVolMeterThumb");
        const pctLbl = document.getElementById(prefix + "CinemaVolPctLbl");
        const miniPct = document.getElementById(prefix + "CinemaVolMiniPct");
        if (fillEl) fillEl.style.setProperty("--vol-pct", pctStr);
        if (thumbEl) thumbEl.style.setProperty("--vol-pct", pctStr);
        if (pctLbl) pctLbl.textContent = labelStr;
        if (miniPct) miniPct.textContent = labelStr;
      }

      function syncCinemaVolPopoverFocusStateClient(focusedEl) {
        ["hero", "detail"].forEach(p => {
          const vg = document.getElementById(p + "CinemaVolGroup");
          if (!vg) return;
          const isVolFocused = Boolean(
            focusedEl && (
              focusedEl.id === p + "CinemaMuteBtn" ||
              (focusedEl.closest && focusedEl.closest("#" + p + "CinemaVolGroup"))
            )
          );
          vg.classList.toggle("is-vol-popover-open", isVolFocused);
        });
      }

      function applyCinemaVolumeFromMeterClient(prefix, clientY) {
        const hitEl = document.getElementById(prefix + "CinemaVolMeterHit");
        if (!hitEl) return;
        const trackEl = hitEl.querySelector(".cinema-vol-meter-track") || hitEl;
        const rect = trackEl.getBoundingClientRect();
        if (!rect || rect.height <= 0) return;
        const ratio = Math.max(0, Math.min(1, (rect.bottom - clientY) / rect.height));
        const rawVol = Math.round((ratio * 100) / 5) * 5;
        const fakeInp = { value: String(rawVol), style: { setProperty: function() {} } };
        if (prefix === "hero" && typeof onHeroCinemaVolumeInputClient === "function") {
          onHeroCinemaVolumeInputClient(fakeInp);
        } else if (prefix === "detail" && typeof onDetailCinemaVolumeInputClient === "function") {
          onDetailCinemaVolumeInputClient(fakeInp);
        }
      }

      function onCinemaVolMeterPointerDownClient(ev, prefix) {
        if (!ev) return;
        if (typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (typeof ev.preventDefault === "function") ev.preventDefault();
        const hitEl = document.getElementById(prefix + "CinemaVolMeterHit");
        if (hitEl && typeof hitEl.setPointerCapture === "function" && ev.pointerId !== undefined) {
          try { hitEl.setPointerCapture(ev.pointerId); } catch (_ce) {}
        }
        applyCinemaVolumeFromMeterClient(prefix, ev.clientY);
        const onMove = (mEv) => {
          applyCinemaVolumeFromMeterClient(prefix, mEv.clientY);
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      }

      function onCinemaScrubHoverMoveClient(ev, prefix) {
        const wrap = document.getElementById(prefix + "CinemaTimelineWrap");
        const scrubber = document.getElementById(prefix + "CinemaScrubber");
        const tooltip = document.getElementById(prefix + "CinemaScrubTooltip");
        if (!wrap || !scrubber || !tooltip) return;
        const rect = scrubber.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const maxSec = Number(scrubber.max) || 0;
        const hoverSec = Math.floor(ratio * maxSec);
        tooltip.textContent = formatHeroTrailerDockTimeClient(hoverSec);
        tooltip.style.setProperty("--tooltip-pct", (ratio * 100).toFixed(2) + "%");
        tooltip.classList.add("is-visible");
      }

      function onCinemaScrubHoverLeaveClient(prefix) {
        const tooltip = document.getElementById(prefix + "CinemaScrubTooltip");
        if (tooltip) tooltip.classList.remove("is-visible");
      }

      function isCinemaDockPointerInteractingClient(prefix) {
        if (document.body && document.body.classList.contains("kb-nav-active")) return false;
        const dock = document.getElementById(prefix + "CinemaPlayerDock");
        if (!dock) return false;
        try {
          if (dock.matches(":hover")) return true;
        } catch (_he) {}
        const vg = document.getElementById(prefix + "CinemaVolGroup");
        try {
          if (vg && vg.matches(":hover")) return true;
        } catch (_he2) {}
        return false;
      }
      let heroBgTeaserCcMode = "off";
      let heroBgTeaserSpeed = 1;
      let heroCinemaZoomMode = "fill";
      let heroFgTapTimer = null;
      let heroFgLastTapAt = 0;
      let heroSeekRippleTimer = null;
      let lastHeroStageTapHandledAt = 0;

      const trailerCandidateMetaCache = new Map();
      let sharedTrailerVolumePref = (function() {
        try {
          const saved = Number(localStorage.getItem("tma_trailer_volume"));
          if (!Number.isNaN(saved) && saved >= 0 && saved <= 100) return Math.round(saved);
        } catch (_e) {}
        return 85;
      })();

      function getSavedTrailerVolumeClient() {
        const parsed = Number(sharedTrailerVolumePref);
        return Math.max(0, Math.min(100, Math.round(Number.isFinite(parsed) ? parsed : 85)));
      }

      function saveTrailerVolumeClient(val) {
        const clamped = Math.max(0, Math.min(100, Math.round(Number(val))));
        sharedTrailerVolumePref = clamped;
        try { localStorage.setItem("tma_trailer_volume", String(clamped)); } catch (_e) {}
        return clamped;
      }

      function registerTrailerMetaMapClient(trailersInput) {
        if (!trailersInput || typeof trailersInput !== "object") return;
        const metaObj = trailersInput.meta && typeof trailersInput.meta === "object" ? trailersInput.meta : null;
        if (metaObj) {
          Object.keys(metaObj).forEach(k => {
            const m = metaObj[k];
            if (k && m && typeof m === "object") {
              trailerCandidateMetaCache.set(String(k).trim(), {
                lang: String(m.lang || "").trim().toLowerCase(),
                name: String(m.name || "").trim(),
                type: String(m.type || "Trailer").trim()
              });
            }
          });
        } else if (trailersInput.key && trailersInput.lang) {
          trailerCandidateMetaCache.set(String(trailersInput.key).trim(), {
            lang: String(trailersInput.lang || "").trim().toLowerCase(),
            name: "",
            type: "Trailer"
          });
        }
      }

      function getTrailerCandidateMetaClient(ytKey) {
        const k = String(ytKey || "").trim();
        if (!k) return { lang: "", name: "", type: "Trailer" };
        return trailerCandidateMetaCache.get(k) || { lang: "", name: "", type: "Trailer" };
      }

      function shouldAutoEnableSubtitlesForKeyClient(ytKey) {
        const meta = getTrailerCandidateMetaClient(ytKey);
        return meta.lang === "en";
      }

      function getNextTrailerCcModeClient(curMode) {
        if (curMode === "off") return "de";
        if (curMode === "de") return "en";
        return "off";
      }

      function formatTrailerCcButtonMetaClient(ccMode) {
        if (ccMode === "de") {
          return {
            label: "CC DE",
            active: true,
            toast: "💬 Untertitel: Deutsch",
            title: "Untertitel: Deutsch aktiv – Klicken für Englisch (Taste C)"
          };
        }
        if (ccMode === "en") {
          return {
            label: "CC EN",
            active: true,
            toast: "💬 Untertitel: Englisch",
            title: "Untertitel: Englisch aktiv – Klicken zum Ausschalten (Taste C)"
          };
        }
        return {
          label: "CC",
          active: false,
          toast: "💬 Untertitel: Aus",
          title: "Untertitel: Aus – Klicken für Deutsch (Taste C)"
        };
      }

      function getNextTrailerSpeedClient(curRate) {
        const steps = [1, 1.25, 1.5, 0.75];
        const idx = steps.findIndex(r => Math.abs(r - Number(curRate || 1)) < 0.05);
        return steps[(idx + 1) % steps.length];
      }

      function buildTrailerLoadingLabelClient(ytKey, ccMode) {
        const meta = getTrailerCandidateMetaClient(ytKey);
        const langTag = meta.lang === "en" ? "EN" : (meta.lang === "de" ? "DE" : "");
        const subTag = ccMode === "de" ? "UT DE" : (ccMode === "en" ? "UT EN" : "");
        if (langTag && subTag) return "🎬 Trailer startet (" + langTag + " · " + subTag + ")…";
        if (langTag) return "🎬 Trailer startet (" + langTag + ")…";
        return "🎬 Trailer startet…";
      }

      function buildTrailerEmbedUrlClient(cleanKey, startSeconds = 0, ccMode = "off", widgetId = 1) {
        const ccEnabled = ccMode === "de" || ccMode === "en";
        const hlParam = ccMode === "en" ? "en" : "de";
        const ccParams = ccEnabled
          ? ("&cc_load_policy=1&cc_lang_pref=" + encodeURIComponent(ccMode))
          : "&cc_load_policy=0";
        let originParam = "";
        try {
          const orig = (typeof window !== "undefined" && window.location && window.location.origin) ? String(window.location.origin) : "";
          if (orig && (orig.startsWith("https://") || orig.startsWith("http://"))) {
            originParam = "&origin=" + encodeURIComponent(orig);
          }
        } catch (_oe) {}
        const safeWidgetId = Math.max(1, Number(widgetId) || 1);
        return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(cleanKey) +
          "?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&showinfo=0&rel=0" +
          "&modestbranding=1&iv_load_policy=3" + ccParams + "&autohide=1&playsinline=1&enablejsapi=1" + originParam + "&widgetid=" + safeWidgetId + "&hl=" + hlParam +
          "&start=" + Math.max(0, Math.floor(Number(startSeconds || 0)));
      }

      const youtubeSubtitleRetryTimers = new WeakMap();
      let youtubeSubtitleApplySeq = 0;

      function applyYoutubeSubtitlesStateClient(sendCmdFn, ccMode, ytKey = "") {
        if (typeof sendCmdFn !== "function") return;
        const prevTimers = youtubeSubtitleRetryTimers.get(sendCmdFn);
        if (Array.isArray(prevTimers)) {
          prevTimers.forEach(t => clearTimeout(t));
          youtubeSubtitleRetryTimers.delete(sendCmdFn);
        }
        const applySeq = ++youtubeSubtitleApplySeq;
        if (ccMode === "de" || ccMode === "en") {
          const meta = getTrailerCandidateMetaClient(ytKey);
          const isDeTrailer = Boolean(meta && meta.lang === "de");
          const isEnTrailer = Boolean(meta && meta.lang === "en");
          const triggerCaptions = () => {
            if (applySeq !== youtubeSubtitleApplySeq) return;
            sendCmdFn("loadModule", ["captions"]);
            sendCmdFn("setOption", ["captions", "fontSize", 1]);
            if (ccMode === "en") {
              sendCmdFn("setOption", ["captions", "track", { languageCode: "en" }]);
            } else if (isDeTrailer) {
              sendCmdFn("setOption", ["captions", "track", { languageCode: "de" }]);
            } else if (isEnTrailer) {
              sendCmdFn("setOption", ["captions", "track", { languageCode: "en", translationLanguage: { languageCode: "de" } }]);
            } else {
              sendCmdFn("setOption", ["captions", "track", { languageCode: "de" }]);
            }
          };
          triggerCaptions();
          const timers = [
            setTimeout(() => {
              if (applySeq !== youtubeSubtitleApplySeq) return;
              triggerCaptions();
            }, 480),
            setTimeout(() => {
              if (applySeq !== youtubeSubtitleApplySeq) return;
              if (ccMode === "de" && !isDeTrailer && !isEnTrailer) {
                sendCmdFn("loadModule", ["captions"]);
                sendCmdFn("setOption", ["captions", "track", { languageCode: "en", translationLanguage: { languageCode: "de" } }]);
              } else {
                triggerCaptions();
              }
            }, 1180)
          ];
          youtubeSubtitleRetryTimers.set(sendCmdFn, timers);
        } else {
          sendCmdFn("setOption", ["captions", "track", {}]);
          sendCmdFn("setOption", ["cc", "track", {}]);
          sendCmdFn("unloadModule", ["captions"]);
          sendCmdFn("unloadModule", ["cc"]);
        }
      }

      function buildCinemaTopHudMetaTextClient(yearStr, ytKey, ccMode) {
        const parts = [];
        const cleanYear = String(yearStr || "").trim();
        if (cleanYear && cleanYear !== "K.A.") parts.push(cleanYear);
        const meta = getTrailerCandidateMetaClient(ytKey);
        if (meta && meta.lang === "de") parts.push("DE");
        else if (meta && meta.lang === "en") parts.push("EN");
        if (ccMode === "de") parts.push("UT DE");
        else if (ccMode === "en") parts.push("UT EN");
        return parts.join(" · ");
      }

      function formatHeroTrailerDockTimeClient(secInput) {
        const s = Math.max(0, Math.floor(Number(secInput) || 0));
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return mins + ":" + (secs < 10 ? "0" + secs : secs);
      }

      function setHeroTrailerLoadingBadgeClient(visible, text = "🎬 Trailer startet…") {
        const badge = document.getElementById("heroSeekRippleBadge");
        if (!badge) return;
        if (visible) {
          if (heroSeekRippleTimer) {
            clearTimeout(heroSeekRippleTimer);
            heroSeekRippleTimer = null;
          }
          badge.className = "detail-seek-ripple-badge is-center is-loading-pulse";
          badge.textContent = text;
        } else if (badge.classList.contains("is-loading-pulse")) {
          badge.classList.remove("is-loading-pulse", "is-visible");
        }
      }

      function showHeroSeekRippleBadgeClient(text, zone = "center", opts = null) {
        const badge = document.getElementById("heroSeekRippleBadge");
        if (!badge) return;
        if (heroSeekRippleTimer) {
          clearTimeout(heroSeekRippleTimer);
          heroSeekRippleTimer = null;
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
        heroSeekRippleTimer = setTimeout(() => {
          badge.classList.remove("is-visible");
          heroSeekRippleTimer = null;
        }, holdMs);
      }

      function clearHeroBgTeaserTimersClient() {
        if (heroBgTeaserTimer) {
          clearTimeout(heroBgTeaserTimer);
          heroBgTeaserTimer = null;
        }
        if (heroBgTeaserRevealTimer) {
          clearTimeout(heroBgTeaserRevealTimer);
          heroBgTeaserRevealTimer = null;
        }
        heroBgTeaserRevealTargetAt = 0;
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        if (heroBgTeaserWatchdogTimer) {
          clearTimeout(heroBgTeaserWatchdogTimer);
          heroBgTeaserWatchdogTimer = null;
        }
        if (heroBgTeaserHandshakeTimer) {
          clearInterval(heroBgTeaserHandshakeTimer);
          heroBgTeaserHandshakeTimer = null;
        }
        if (heroBgTeaserDeferTimer) {
          clearTimeout(heroBgTeaserDeferTimer);
          heroBgTeaserDeferTimer = null;
        }
        stopHeroCinemaLiveClockClient();
        clearHeroUnmuteRetryTimersClient();
      }

      function stopHeroCinemaLiveClockClient() {
        if (heroCinemaLiveClockTimer) {
          clearInterval(heroCinemaLiveClockTimer);
          heroCinemaLiveClockTimer = null;
        }
        heroCinemaLiveClockLastTickAt = 0;
        heroCinemaLiveClockPingCount = 0;
      }

      function ensureHeroCinemaLiveClockClient() {
        if (heroCinemaLiveClockTimer) return;
        heroCinemaLiveClockLastTickAt = Date.now();
        heroCinemaLiveClockPingCount = 0;
        heroCinemaLiveClockTimer = setInterval(() => {
          const liveStage = document.getElementById("heroStageEl");
          const isFgLive = Boolean(liveStage && liveStage.classList.contains("is-trailer-foreground-mode"));
          if (!isFgLive || !heroBgTeaserActiveKey || heroBgTeaserPaused || heroBgTeaserEnded) {
            stopHeroCinemaLiveClockClient();
            return;
          }
          const now = Date.now();
          const dtSec = Math.max(0, Math.min(2.5, (now - (heroCinemaLiveClockLastTickAt || now)) / 1000));
          heroCinemaLiveClockLastTickAt = now;
          if (heroBgTeaserScrubbing) return;
          const infoStale = !heroBgTeaserLastInfoAt || (now - heroBgTeaserLastInfoAt) >= 1100;
          if (infoStale && (heroBgTeaserIsPlayingConfirmed || (heroBgTeaserStageOpenedAt && (now - heroBgTeaserStageOpenedAt) >= 1400))) {
            const spd = Number(heroBgTeaserSpeed || 1) > 0 ? Number(heroBgTeaserSpeed || 1) : 1;
            const nextSec = (Number(heroBgTeaserCurTime) || 0) + (dtSec * spd);
            heroBgTeaserCurTime = heroBgTeaserDuration > 0 ? Math.min(heroBgTeaserDuration, nextSec) : nextSec;
            heroBgTeaserIsPlayingConfirmed = true;
            syncHeroCinemaDockUiClient();
          }
          heroCinemaLiveClockPingCount += 1;
          if ((heroBgTeaserDuration <= 0 || infoStale) && (heroCinemaLiveClockPingCount % 4 === 1)) {
            const frame = document.getElementById("heroBgVideoIframe");
            if (frame && frame.contentWindow) {
              try {
                frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
              } catch (_pe) {}
            }
          }
        }, 500);
      }

      function sendYoutubeHeroTeaserCommandClient(funcName, args = []) {
        const frame = document.getElementById("heroBgVideoIframe");
        if (!frame || !frame.contentWindow) return;
        try {
          frame.contentWindow.postMessage(JSON.stringify({
            event: "command",
            func: funcName,
            args: args,
            id: 1,
            channel: "widget"
          }), "*");
        } catch (_e) {}
      }

      let heroCinemaDockIdleTimer = null;
      let heroCinemaEndcardTimer = null;
      let heroCinemaEndcardSecondsLeft = 0;

      function renderHeroCinemaEndcardCloseBtnLabelClient(secondsLeft) {
        const closeBtn = document.getElementById("heroCinemaEndCloseBtn");
        if (!closeBtn) return;
        const lbl = closeBtn.querySelector("span");
        if (!lbl) return;
        if (secondsLeft > 0) {
          lbl.innerHTML = 'Schließen <span class="cinema-end-countdown-num">(' + secondsLeft + 's)</span>';
        } else {
          lbl.textContent = "Schließen";
        }
      }

      function cancelHeroCinemaEndcardCountdownClient(resetLabel = true) {
        if (heroCinemaEndcardTimer) {
          clearInterval(heroCinemaEndcardTimer);
          heroCinemaEndcardTimer = null;
        }
        heroCinemaEndcardSecondsLeft = 0;
        if (resetLabel) {
          renderHeroCinemaEndcardCloseBtnLabelClient(0);
        }
      }

      function startHeroCinemaEndcardCountdownClient() {
        cancelHeroCinemaEndcardCountdownClient(false);
        const stageEl = document.getElementById("heroStageEl");
        if (!stageEl || !stageEl.classList.contains("is-trailer-foreground-mode") || !heroBgTeaserEnded) return;
        heroCinemaEndcardSecondsLeft = 20;
        renderHeroCinemaEndcardCloseBtnLabelClient(heroCinemaEndcardSecondsLeft);
        heroCinemaEndcardTimer = setInterval(() => {
          const liveStage = document.getElementById("heroStageEl");
          if (!liveStage || !liveStage.classList.contains("is-trailer-foreground-mode") || !heroBgTeaserEnded) {
            cancelHeroCinemaEndcardCountdownClient(true);
            return;
          }
          heroCinemaEndcardSecondsLeft -= 1;
          if (heroCinemaEndcardSecondsLeft <= 0) {
            cancelHeroCinemaEndcardCountdownClient(true);
            exitHeroForegroundTrailerModeClient();
            return;
          }
          renderHeroCinemaEndcardCloseBtnLabelClient(heroCinemaEndcardSecondsLeft);
        }, 1000);
      }

      function wakeHeroCinemaDockClient() {
        const dock = document.getElementById("heroCinemaPlayerDock");
        const topHud = document.getElementById("heroCinemaTopHud");
        const catcher = document.getElementById("heroForegroundStageCatcher");
        const stageEl = document.getElementById("heroStageEl");
        if (dock) dock.classList.remove("is-idle-hidden");
        if (topHud) topHud.classList.remove("is-idle-hidden");
        if (catcher) catcher.classList.remove("is-cursor-idle");
        if (stageEl) stageEl.classList.remove("is-cinema-controls-idle");
        if (heroCinemaDockIdleTimer) {
          clearTimeout(heroCinemaDockIdleTimer);
          heroCinemaDockIdleTimer = null;
        }
        const isForeground = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));
        if (!isForeground || heroBgTeaserPaused || heroBgTeaserEnded || heroBgTeaserScrubbing) {
          return;
        }
        const idleDelayMs = (document.body && document.body.classList.contains("kb-nav-active")) ? 3600 : 2800;
        heroCinemaDockIdleTimer = setTimeout(() => {
          heroCinemaDockIdleTimer = null;
          const liveDock = document.getElementById("heroCinemaPlayerDock");
          const liveTopHud = document.getElementById("heroCinemaTopHud");
          const liveStage = document.getElementById("heroStageEl");
          const liveCatcher = document.getElementById("heroForegroundStageCatcher");
          if (!liveDock || !liveStage || !liveStage.classList.contains("is-trailer-foreground-mode")) return;
          if (heroBgTeaserPaused || heroBgTeaserEnded || heroBgTeaserScrubbing) return;
          if (isCinemaDockPointerInteractingClient("hero")) {
            wakeHeroCinemaDockClient();
            return;
          }
          liveDock.classList.add("is-idle-hidden");
          if (liveTopHud) liveTopHud.classList.add("is-idle-hidden");
          if (liveCatcher) liveCatcher.classList.add("is-cursor-idle");
          liveStage.classList.add("is-cinema-controls-idle");
          syncCinemaVolPopoverFocusStateClient(null);
        }, idleDelayMs);
      }

      function syncHeroCinemaDockUiClient() {
        const dock = document.getElementById("heroCinemaPlayerDock");
        if (!dock) return;
        const topHud = document.getElementById("heroCinemaTopHud");
        const stageEl = document.getElementById("heroStageEl");
        const isForeground = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));
        const hasVideoControls = Boolean(heroBgTeaserActiveKey || heroBgTeaserIsPlayingConfirmed);
        const ccActive = heroBgTeaserCcMode === "de" || heroBgTeaserCcMode === "en";
        if (stageEl) {
          stageEl.classList.toggle("is-cc-safe-framing", ccActive);
          stageEl.classList.toggle("is-cinema-paused", Boolean(isForeground && heroBgTeaserPaused && !heroBgTeaserEnded && hasVideoControls));
          stageEl.classList.toggle("is-cinema-ended", Boolean(isForeground && heroBgTeaserEnded && hasVideoControls));
          if (!isForeground || heroBgTeaserPaused || heroBgTeaserEnded || (heroBgTeaserIsPlayingConfirmed && !heroBgTeaserChromeShieldRequired && !heroBgTeaserRevealTimer && !heroBgTeaserScrubbing)) {
            stageEl.classList.remove("is-cinema-starting");
          }
          if (!isForeground || !heroBgTeaserEnded) {
            cancelHeroCinemaEndcardCountdownClient(true);
          }
        }
        dock.classList.toggle("is-ready", Boolean(isForeground));
        if (!isForeground || heroBgTeaserPaused || heroBgTeaserEnded) {
          dock.classList.remove("is-idle-hidden");
          if (topHud) topHud.classList.remove("is-idle-hidden");
          if (stageEl) stageEl.classList.remove("is-cinema-controls-idle");
          const catcher = document.getElementById("heroForegroundStageCatcher");
          if (catcher) catcher.classList.remove("is-cursor-idle");
        }

        const curHero = (state && Array.isArray(state.heroSlides)) ? (state.heroSlides[state.heroIndex] || state.heroSlides[0]) : null;
        const heroTitle = curHero ? String(curHero.title || curHero.name || "").trim() : "";
        const heroYear = curHero ? String(curHero.release_date || curHero.first_air_date || "").slice(0, 4) : "";
        const topTitleEl = document.getElementById("heroCinemaTopTitle");
        if (topTitleEl && heroTitle) topTitleEl.textContent = heroTitle;
        const topMetaEl = document.getElementById("heroCinemaTopMeta");
        if (topMetaEl) {
          topMetaEl.textContent = buildCinemaTopHudMetaTextClient(heroYear, heroBgTeaserActiveKey, heroBgTeaserCcMode);
        }
        const endTitleEl = document.getElementById("heroCinemaEndTitle");
        if (endTitleEl && heroTitle) endTitleEl.textContent = heroTitle;

        const playBtn = document.getElementById("heroCinemaPlayBtn");
        if (playBtn) {
          playBtn.style.display = hasVideoControls ? "inline-flex" : "none";
          const nextPlayKey = heroBgTeaserEnded ? "replay" : (heroBgTeaserPaused ? "play" : "pause");
          if (playBtn.getAttribute("data-icon-state") !== nextPlayKey) {
            playBtn.setAttribute("data-icon-state", nextPlayKey);
            playBtn.innerHTML = CINEMA_ICONS_CLIENT[nextPlayKey];
          }
          if (heroBgTeaserEnded) {
            playBtn.title = "Trailer erneut abspielen";
          } else {
            playBtn.title = heroBgTeaserPaused ? "Trailer fortsetzen (Leertaste)" : "Trailer pausieren (Leertaste)";
          }
        }
        const restartBtn = document.getElementById("heroCinemaRestartBtn");
        if (restartBtn) {
          restartBtn.style.display = hasVideoControls ? "inline-flex" : "none";
        }
        const muteBtn = document.getElementById("heroCinemaMuteBtn");
        const curVol = getSavedTrailerVolumeClient();
        if (muteBtn) {
          muteBtn.style.display = hasVideoControls ? "inline-flex" : "none";
          const nextVolKey = (heroBgTeaserMuted || curVol <= 0) ? "volMute" : (curVol < 45 ? "volLow" : "volHigh");
          if (muteBtn.getAttribute("data-icon-state") !== nextVolKey) {
            muteBtn.setAttribute("data-icon-state", nextVolKey);
            const miniPctVal = (heroBgTeaserMuted || curVol <= 0) ? "Aus" : (curVol + "%");
            muteBtn.innerHTML = CINEMA_ICONS_CLIENT[nextVolKey] + '<span id="heroCinemaVolMiniPct" class="cinema-vol-mini-pct">' + miniPctVal + '</span>';
          }
          muteBtn.title = heroBgTeaserMuted
            ? "Ton einschalten (Enter / M) · Lautstärke: Pfeil ↑ / ↓"
            : ("Ton stummschalten (Enter / M) · Lautstärke: " + curVol + "% (Pfeil ↑ / ↓)");
        }
        const volGroup = document.getElementById("heroCinemaVolGroup");
        if (volGroup) {
          volGroup.style.display = hasVideoControls ? "inline-flex" : "none";
        }
        syncCinemaVolPopoverUiClient("hero", curVol, heroBgTeaserMuted);
        const timelineWrap = document.getElementById("heroCinemaTimelineWrap");
        if (timelineWrap) {
          timelineWrap.style.display = hasVideoControls ? "flex" : "none";
        }
        const ccBtn = document.getElementById("heroCinemaCcBtn");
        if (ccBtn) {
          ccBtn.style.display = hasVideoControls ? "inline-flex" : "none";
          const ccMeta = formatTrailerCcButtonMetaClient(heroBgTeaserCcMode);
          ccBtn.textContent = ccMeta.label;
          ccBtn.classList.toggle("is-cc-active", ccMeta.active);
          ccBtn.title = ccMeta.title;
        }
        const speedBtn = document.getElementById("heroCinemaSpeedBtn");
        if (speedBtn) {
          speedBtn.style.display = hasVideoControls ? "inline-flex" : "none";
          const spd = Number(heroBgTeaserSpeed || 1);
          speedBtn.textContent = spd + "×";
          speedBtn.classList.toggle("is-speed-active", Math.abs(spd - 1) > 0.05);
          speedBtn.title = "Wiedergabegeschwindigkeit (" + spd + "×) ändern (Taste S)";
        }
        const totalClips = Array.isArray(heroBgTeaserCandidates) ? heroBgTeaserCandidates.length : 0;
        const nextClipBtn = document.getElementById("heroCinemaNextClipBtn");
        if (nextClipBtn) {
          if (totalClips > 1 && hasVideoControls) {
            nextClipBtn.style.display = "inline-flex";
            const clipLabel = ((heroBgTeaserCandidateIdx % totalClips) + 1) + "/" + totalClips;
            if (nextClipBtn.getAttribute("data-clip-label") !== clipLabel) {
              nextClipBtn.setAttribute("data-clip-label", clipLabel);
              nextClipBtn.innerHTML = CINEMA_ICONS_CLIENT.nextClip + "<span>" + clipLabel + "</span>";
            }
            const curMeta = getTrailerCandidateMetaClient(heroBgTeaserActiveKey);
            const metaNote = (curMeta.lang ? curMeta.lang.toUpperCase() : "") + (curMeta.name ? (" · " + curMeta.name) : "");
            nextClipBtn.title = "Nächsten Trailer / Clip abspielen (Taste N)" + (metaNote ? (" – Aktuell: " + metaNote) : "");
          } else {
            nextClipBtn.style.display = "none";
          }
        }
        const pauseNextBtn = document.getElementById("heroCinemaPauseNextBtn");
        if (pauseNextBtn) pauseNextBtn.style.display = (totalClips > 1 && hasVideoControls) ? "inline-flex" : "none";
        const endNextBtn = document.getElementById("heroCinemaEndNextBtn");
        if (endNextBtn) endNextBtn.style.display = (totalClips > 1 && hasVideoControls) ? "inline-flex" : "none";

        const modeBtn = document.getElementById("heroCinemaModeBtn");
        if (modeBtn) {
          modeBtn.classList.toggle("is-active-mode", isForeground);
          const nextModeKey = isForeground ? "close" : "open";
          if (modeBtn.getAttribute("data-mode-state") !== nextModeKey) {
            modeBtn.setAttribute("data-mode-state", nextModeKey);
            modeBtn.innerHTML = isForeground ? (CINEMA_ICONS_CLIENT.close + "<span>Schließen</span>") : "<span>⛶ Kino</span>";
          }
          modeBtn.title = isForeground ? "Trailer beenden & Slider-Infos wieder einblenden (Esc)" : "Alle Elemente ausblenden & Trailer in den Vordergrund holen";
        }
        const timeLbl = document.getElementById("heroCinemaTimeLbl");
        if (timeLbl) {
          if (heroBgTeaserDuration > 0) {
            timeLbl.textContent = formatHeroTrailerDockTimeClient(heroBgTeaserCurTime) + " / " + formatHeroTrailerDockTimeClient(heroBgTeaserDuration);
          } else {
            const safeCur = heroBgTeaserIsPlayingConfirmed ? heroBgTeaserCurTime : 0;
            timeLbl.textContent = formatHeroTrailerDockTimeClient(safeCur);
          }
        }
        const scrubber = document.getElementById("heroCinemaScrubber");
        if (scrubber) {
          const maxDur = heroBgTeaserDuration > 0 ? Math.floor(heroBgTeaserDuration) : 120;
          if (!heroBgTeaserScrubbing) {
            scrubber.max = String(maxDur);
            scrubber.value = String(Math.min(maxDur, Math.floor(heroBgTeaserCurTime || 0)));
          }
          const pct = maxDur > 0 ? Math.max(0, Math.min(100, ((Number(scrubber.value) || heroBgTeaserCurTime || 0) / maxDur) * 100)) : 0;
          scrubber.style.setProperty("--scrub-pct", pct.toFixed(1) + "%");
        }
      }

      function scheduleHeroRevealAfterYoutubeChromeHidesClient(holdMs = 1550, forceReset = false) {
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        const safeHoldMs = Math.max(350, Number(holdMs) || 1550);
        const now = Date.now();
        const proposedTargetAt = now + safeHoldMs;
        const stageEl = document.getElementById("heroStageEl");
        const isFgNow = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));

        if (heroBgTeaserRevealTimer && !forceReset && heroBgTeaserRevealTargetAt > now) {
          if (proposedTargetAt >= heroBgTeaserRevealTargetAt - 80) {
            if (isFgNow && stageEl) {
              stageEl.classList.add("is-cinema-starting");
            }
            return;
          }
          clearTimeout(heroBgTeaserRevealTimer);
          heroBgTeaserRevealTimer = null;
        } else if (heroBgTeaserRevealTimer) {
          clearTimeout(heroBgTeaserRevealTimer);
          heroBgTeaserRevealTimer = null;
        }

        heroBgTeaserChromeShieldRequired = true;
        heroBgTeaserRevealTargetAt = proposedTargetAt;
        const layer = document.getElementById("heroBgVideoLayer");
        if (isFgNow) {
          // Kein Vollbild-Backcover im Vordergrund: Video sofort zeigen, nur gezielte Start-Ersatzoverlays über YouTube-Center/Leisten!
          if (layer) {
            layer.classList.remove("is-concealing");
            layer.classList.add("is-playing");
          }
          if (stageEl) stageEl.classList.add("is-cinema-starting");
          setHeroTrailerLoadingBadgeClient(false);
        } else if (layer) {
          layer.classList.remove("is-playing");
        }

        heroBgTeaserRevealTimer = setTimeout(() => {
          heroBgTeaserRevealTimer = null;
          heroBgTeaserRevealTargetAt = 0;
          const liveLayer = document.getElementById("heroBgVideoLayer");
          const liveStage = document.getElementById("heroStageEl");
          const isFg = Boolean(liveStage && liveStage.classList.contains("is-trailer-foreground-mode"));
          if (
            liveLayer &&
            !heroBgTeaserPaused &&
            !heroBgTeaserEnded &&
            !heroBgTeaserStoppedByUser
          ) {
            const elapsedSinceMount = Date.now() - (heroBgTeaserStageOpenedAt || Date.now());
            if (heroBgTeaserIsPlayingConfirmed || (isFg && elapsedSinceMount >= 1500)) {
              heroBgTeaserIsPlayingConfirmed = true;
              // Im Hintergrund vorladen, aber erst beim Tippen einblenden:
              if (!isFg) {
                heroBgTeaserPreloadedParked = true;
                heroBgTeaserPaused = true;
                heroBgTeaserChromeShieldRequired = true;
                liveLayer.classList.remove("is-playing", "is-concealing");
                if (liveStage) liveStage.classList.remove("is-cinema-starting");
                setHeroTrailerLoadingBadgeClient(false);
                sendYoutubeHeroTeaserCommandClient("pauseVideo");
                syncHeroCinemaDockUiClient();
                return;
              }
              heroBgTeaserPreloadedParked = false;
              heroBgTeaserChromeShieldRequired = false;
              liveLayer.classList.remove("is-concealing");
              liveLayer.classList.add("is-playing");
              if (liveStage) liveStage.classList.remove("is-cinema-starting");
              setHeroTrailerLoadingBadgeClient(false);
              if (heroBgTeaserPendingUnmute || !heroBgTeaserMuted) {
                heroBgTeaserPendingUnmute = false;
                heroBgTeaserMuted = false;
                sendYoutubeHeroTeaserCommandClient("unMute");
                sendYoutubeHeroTeaserCommandClient("setVolume", [getSavedTrailerVolumeClient()]);
              }
              applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, heroBgTeaserCcMode, heroBgTeaserActiveKey);
              if (heroBgTeaserSpeed !== 1) {
                sendYoutubeHeroTeaserCommandClient("setPlaybackRate", [heroBgTeaserSpeed]);
              }
              ensureHeroCinemaLiveClockClient();
              wakeHeroCinemaDockClient();
            } else {
              sendYoutubeHeroTeaserCommandClient("playVideo");
              scheduleHeroRevealAfterYoutubeChromeHidesClient(750, true);
              return;
            }
          } else {
            if (liveStage) liveStage.classList.remove("is-cinema-starting");
            setHeroTrailerLoadingBadgeClient(false);
          }
          syncHeroCinemaDockUiClient();
        }, safeHoldMs);
      }

      function concealAndPauseHeroTrailerClient(opts = {}) {
        if (heroBgTeaserRevealTimer) {
          clearTimeout(heroBgTeaserRevealTimer);
          heroBgTeaserRevealTimer = null;
        }
        heroBgTeaserRevealTargetAt = 0;
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        stopHeroCinemaLiveClockClient();
        setHeroTrailerLoadingBadgeClient(false);
        heroBgTeaserPaused = true;
        heroBgTeaserChromeShieldRequired = true;
        if (typeof opts.stoppedByUser === "boolean") {
          heroBgTeaserStoppedByUser = opts.stoppedByUser;
        }
        if (typeof opts.ended === "boolean") {
          heroBgTeaserEnded = opts.ended;
        }
        const stageEl = document.getElementById("heroStageEl");
        if (stageEl) {
          stageEl.classList.remove("is-cinema-starting");
          if (opts.exitForeground) {
            stageEl.classList.remove("is-trailer-foreground-mode");
          }
        }
        const layer = document.getElementById("heroBgVideoLayer");
        if (layer) {
          layer.classList.add("is-concealing");
          layer.classList.remove("is-playing");
        }
        syncHeroCinemaDockUiClient();
        const pauseDelayMs = typeof opts.pauseDelayMs === "number" ? opts.pauseDelayMs : 220;
        heroBgTeaserDelayedPauseTimer = setTimeout(() => {
          heroBgTeaserDelayedPauseTimer = null;
          const liveLayer = document.getElementById("heroBgVideoLayer");
          if (liveLayer) {
            liveLayer.classList.remove("is-concealing");
          }
          if (heroBgTeaserPaused || heroBgTeaserEnded) {
            sendYoutubeHeroTeaserCommandClient("pauseVideo");
          }
        }, pauseDelayMs);
      }

      function resumeHeroTrailerWithBackdropShieldClient(opts = {}) {
        const wasPendingPauseOnly = Boolean(heroBgTeaserDelayedPauseTimer && !heroBgTeaserEnded);
        const wasPreloadedParked = heroBgTeaserPreloadedParked;
        heroBgTeaserPreloadedParked = false;
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        heroBgTeaserPaused = false;
        heroBgTeaserStoppedByUser = false;
        const stageElForResume = document.getElementById("heroStageEl");
        const layer = document.getElementById("heroBgVideoLayer");
        if (layer) {
          layer.classList.remove("is-concealing");
        }
        if (heroBgTeaserEnded && opts.restartIfEnded !== false) {
          heroBgTeaserEnded = false;
          heroBgTeaserCurTime = 0;
          heroBgTeaserChromeShieldRequired = false;
          if (stageElForResume) stageElForResume.classList.remove("is-cinema-starting");
          setHeroTrailerLoadingBadgeClient(false);
          if (layer) layer.classList.add("is-playing");
          sendYoutubeHeroTeaserCommandClient("seekTo", [0, true]);
          sendYoutubeHeroTeaserCommandClient("playVideo");
          if (heroBgTeaserPendingUnmute || !heroBgTeaserMuted) {
            const targetVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
            sendYoutubeHeroTeaserCommandClient("unMute");
            sendYoutubeHeroTeaserCommandClient("setVolume", [targetVol]);
          }
          applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, heroBgTeaserCcMode, heroBgTeaserActiveKey);
          ensureHeroCinemaLiveClockClient();
          wakeHeroCinemaDockClient();
          syncHeroCinemaDockUiClient();
          return;
        }
        if ((wasPendingPauseOnly || (layer && layer.classList.contains("is-playing"))) && heroBgTeaserIsPlayingConfirmed && !wasPreloadedParked) {
          heroBgTeaserChromeShieldRequired = false;
          if (stageElForResume) stageElForResume.classList.remove("is-cinema-starting");
          setHeroTrailerLoadingBadgeClient(false);
          if (layer) layer.classList.add("is-playing");
          sendYoutubeHeroTeaserCommandClient("playVideo");
          if (heroBgTeaserPendingUnmute || !heroBgTeaserMuted) {
            const targetVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
            sendYoutubeHeroTeaserCommandClient("unMute");
            sendYoutubeHeroTeaserCommandClient("setVolume", [targetVol]);
          }
          applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, heroBgTeaserCcMode, heroBgTeaserActiveKey);
          ensureHeroCinemaLiveClockClient();
          wakeHeroCinemaDockClient();
          syncHeroCinemaDockUiClient();
          return;
        }
        heroBgTeaserChromeShieldRequired = true;
        const isFgResume = Boolean(stageElForResume && stageElForResume.classList.contains("is-trailer-foreground-mode"));
        if (layer) {
          if (isFgResume) layer.classList.add("is-playing");
          else layer.classList.remove("is-playing");
        }
        if (wasPreloadedParked && heroBgTeaserCurTime <= 6) {
          heroBgTeaserCurTime = 0;
          sendYoutubeHeroTeaserCommandClient("seekTo", [0, true]);
        }
        sendYoutubeHeroTeaserCommandClient("playVideo");
        if (heroBgTeaserPendingUnmute || !heroBgTeaserMuted) {
          const targetVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
          sendYoutubeHeroTeaserCommandClient("unMute");
          sendYoutubeHeroTeaserCommandClient("setVolume", [targetVol]);
        }
        applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, heroBgTeaserCcMode, heroBgTeaserActiveKey);
        scheduleHeroRevealAfterYoutubeChromeHidesClient(wasPreloadedParked ? 1850 : 1250, true);
        if (isFgResume) ensureHeroCinemaLiveClockClient();
        syncHeroCinemaDockUiClient();
      }

      function stopHeroBackgroundVideoTeaserClient() {
        heroBgTeaserRequestSeq += 1;
        clearHeroBgTeaserTimersClient();
        setHeroTrailerLoadingBadgeClient(false);
        if (heroFgTapTimer) {
          clearTimeout(heroFgTapTimer);
          heroFgTapTimer = null;
        }
        heroBgTeaserActiveKey = "";
        heroBgTeaserActiveSlideKey = "";
        heroBgTeaserCandidates = [];
        heroBgTeaserCandidatesSlideKey = "";
        heroBgTeaserCandidateIdx = 0;
        heroBgTeaserIsPlayingConfirmed = false;
        heroBgTeaserPreloadedParked = false;
        heroBgTeaserChromeShieldRequired = true;
        heroBgTeaserPendingUnmute = false;
        heroBgTeaserPlayingStartedAt = 0;
        heroBgTeaserPaused = false;
        heroBgTeaserEnded = false;
        heroBgTeaserCurTime = 0;
        heroBgTeaserDuration = 0;
        heroBgTeaserLastInfoAt = 0;
        const stageEl = document.getElementById("heroStageEl");
        if (stageEl) {
          stageEl.classList.remove("is-trailer-foreground-mode", "is-cinema-starting", "is-cinema-paused", "is-cinema-ended", "is-cc-safe-framing");
        }
        const layer = document.getElementById("heroBgVideoLayer");
        if (layer) {
          layer.classList.remove("is-playing", "is-concealing");
          layer.innerHTML = "";
        }
        const dock = document.getElementById("heroCinemaPlayerDock");
        if (dock) {
          dock.classList.remove("is-ready");
        }
      }

      function onHeroBgYoutubeIframeLoadClient() {
        if (heroBgTeaserHandshakeTimer) {
          clearInterval(heroBgTeaserHandshakeTimer);
          heroBgTeaserHandshakeTimer = null;
        }
        let ticks = 0;
        const sendHandshake = () => {
          const frame = document.getElementById("heroBgVideoIframe");
          if (!frame || !frame.contentWindow) {
            if (heroBgTeaserHandshakeTimer) {
              clearInterval(heroBgTeaserHandshakeTimer);
              heroBgTeaserHandshakeTimer = null;
            }
            return;
          }
          try {
            frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
            frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"], id: 1, channel: "widget" }), "*");
            frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onApiChange"], id: 1, channel: "widget" }), "*");
            frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onError"], id: 1, channel: "widget" }), "*");
            if (!heroBgTeaserPaused && !heroBgTeaserEnded && !heroBgTeaserStoppedByUser) {
              frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [], id: 1, channel: "widget" }), "*");
            }
            if (heroBgTeaserPendingUnmute || !heroBgTeaserMuted) {
              const targetVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
              frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [], id: 1, channel: "widget" }), "*");
              frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [targetVol], id: 1, channel: "widget" }), "*");
            }
            if (ticks === 0 || ticks === 3) {
              applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, heroBgTeaserCcMode, heroBgTeaserActiveKey);
            }
          } catch (_e) {}
          ticks++;
          if (ticks >= 32 || (heroBgTeaserIsPlayingConfirmed && heroBgTeaserDuration > 0)) {
            if (heroBgTeaserHandshakeTimer) {
              clearInterval(heroBgTeaserHandshakeTimer);
              heroBgTeaserHandshakeTimer = null;
            }
          }
        };
        sendHandshake();
        heroBgTeaserHandshakeTimer = setInterval(sendHandshake, 280);
      }

      function mountHeroTrailerCandidateAtIndexClient(idx, startUnmuted = false, startSeconds = 0, overrideCcMode = null, opts = {}) {
        clearHeroBgTeaserTimersClient();
        clearHeroUnmuteRetryTimersClient();
        if (heroBgTeaserDeferTimer) {
          clearTimeout(heroBgTeaserDeferTimer);
          heroBgTeaserDeferTimer = null;
        }
        if (idx < 0 || idx >= heroBgTeaserCandidates.length) {
          stopHeroBackgroundVideoTeaserClient();
          return;
        }
        const layer = document.getElementById("heroBgVideoLayer");
        if (!layer) return;
        heroBgTeaserCandidateIdx = idx;
        const cleanKey = heroBgTeaserCandidates[idx];
        heroBgTeaserActiveKey = cleanKey;
        heroBgTeaserCcMode = (overrideCcMode === "off" || overrideCcMode === "de" || overrideCcMode === "en")
          ? overrideCcMode
          : (shouldAutoEnableSubtitlesForKeyClient(cleanKey) ? "de" : "off");
        heroBgTeaserSpeed = Number(opts && opts.preserveSpeed) > 0 ? Number(opts.preserveSpeed) : 1;
        heroBgTeaserStageOpenedAt = Date.now();
        heroBgTeaserIsPlayingConfirmed = false;
        heroBgTeaserPreloadedParked = false;
        heroBgTeaserChromeShieldRequired = true;
        heroBgTeaserPlayingStartedAt = 0;
        heroBgTeaserPaused = false;
        heroBgTeaserEnded = false;
        const safeStartSec = Math.max(0, Number(startSeconds || 0));
        heroBgTeaserCurTime = safeStartSec;
        heroBgTeaserLastInfoAt = 0;
        if (!(opts && opts.keepDuration)) {
          heroBgTeaserDuration = 0;
        }
        heroBgTeaserPendingUnmute = Boolean(startUnmuted);
        heroBgTeaserMuted = !startUnmuted;
        if (startUnmuted) {
          heroBgTeaserUserMuted = false;
          heroBgTeaserUnmuteRetries = 0;
          window._heroUnmuteGraceUntil = Date.now() + 3000;
        }

        const stageEl = document.getElementById("heroStageEl");
        const isFgMount = Boolean(startUnmuted || (stageEl && stageEl.classList.contains("is-trailer-foreground-mode")));
        layer.classList.remove("is-concealing");
        if (isFgMount) layer.classList.add("is-playing");
        else layer.classList.remove("is-playing");

        const embedSrc = buildTrailerEmbedUrlClient(cleanKey, safeStartSec, heroBgTeaserCcMode, 1);
        const lazyAttr = isFgMount ? "" : ' loading="lazy"';
        layer.innerHTML = '<iframe id="heroBgVideoIframe" class="detail-bg-video-frame" data-slide-key="' + esc(heroBgTeaserActiveSlideKey || "") + '" src="' + esc(embedSrc) + '"' + lazyAttr + ' onload="onHeroBgYoutubeIframeLoadClient()" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" playsinline="1" webkit-playsinline="1" tabindex="-1" aria-hidden="true"></iframe>';

        if (stageEl) {
          stageEl.classList.remove("is-cinema-paused", "is-cinema-ended");
          stageEl.classList.toggle("is-cc-safe-framing", heroBgTeaserCcMode === "de" || heroBgTeaserCcMode === "en");
          stageEl.classList.toggle("is-cinema-starting", isFgMount);
        }
        if (isFgMount) {
          setHeroTrailerLoadingBadgeClient(false);
          scheduleHeroRevealAfterYoutubeChromeHidesClient((opts && opts.fastRevealMs) ? opts.fastRevealMs : 2100, true);
          ensureHeroCinemaLiveClockClient();
        }

        heroBgTeaserWatchdogTimer = setTimeout(() => {
          if (!heroBgTeaserIsPlayingConfirmed && heroBgTeaserActiveKey === cleanKey && !heroBgTeaserStoppedByUser) {
            if (heroBgTeaserCandidates.length > 1) {
              if (typeof clientBlockedYoutubeKeys !== "undefined") clientBlockedYoutubeKeys.add(cleanKey);
              const nextIdx = heroBgTeaserCandidateIdx + 1;
              if (nextIdx < heroBgTeaserCandidates.length) {
                mountHeroTrailerCandidateAtIndexClient(nextIdx, startUnmuted || !heroBgTeaserMuted, 0);
              }
            }
          }
        }, 5200);
      }

      if (typeof window !== "undefined" && !window._heroYtMessageListenerBound) {
        window._heroYtMessageListenerBound = true;
        window.addEventListener("message", (ev) => {
          if (!heroBgTeaserActiveKey) return;
          const heroFrame = document.getElementById("heroBgVideoIframe");
          if (!heroFrame || !heroFrame.contentWindow || ev.source !== heroFrame.contentWindow) return;
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
            if (heroBgTeaserCcMode === "de" || heroBgTeaserCcMode === "en") {
              applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, heroBgTeaserCcMode, heroBgTeaserActiveKey);
            }
            return;
          }

          if (msg.event === "onError" || (msg.info && typeof msg.info === "number" && msg.event === "onError")) {
            if (typeof clientBlockedYoutubeKeys !== "undefined") clientBlockedYoutubeKeys.add(heroBgTeaserActiveKey);
            const nextIdx = heroBgTeaserCandidateIdx + 1;
            if (nextIdx < heroBgTeaserCandidates.length) {
              mountHeroTrailerCandidateAtIndexClient(nextIdx, heroBgTeaserPendingUnmute || !heroBgTeaserMuted, 0);
            } else {
              const failedHero = state.heroSlides && (state.heroSlides[state.heroIndex] || state.heroSlides[0]);
              if (failedHero) {
                failedHero._trailerChecked = true;
                failedHero._hasEmbeddableTrailer = false;
                failedHero._trailerCount = 0;
              }
              if (typeof syncHeroTrailerAvailabilityButtonClient === "function") {
                syncHeroTrailerAvailabilityButtonClient("none", 0);
              }
              stopHeroBackgroundVideoTeaserClient();
            }
            return;
          }

          let pState = null;
          if (msg.event === "onStateChange" && typeof msg.info === "number") {
            pState = msg.info;
          } else if ((msg.event === "infoDelivery" || msg.event === "initialDelivery") && msg.info && typeof msg.info === "object") {
            if (typeof msg.info.playerState === "number") {
              pState = msg.info.playerState;
            }
            const rawCurTime = typeof msg.info.currentTime === "number"
              ? msg.info.currentTime
              : (msg.info.progressState && typeof msg.info.progressState.current === "number" ? msg.info.progressState.current : null);
            if (rawCurTime !== null && Number.isFinite(rawCurTime) && rawCurTime >= 0) {
              heroBgTeaserCurTime = rawCurTime;
              heroBgTeaserLastInfoAt = Date.now();
            }
            const rawDur = (typeof msg.info.duration === "number" && msg.info.duration > 0)
              ? msg.info.duration
              : ((msg.info.progressState && typeof msg.info.progressState.duration === "number" && msg.info.progressState.duration > 0)
                ? msg.info.progressState.duration
                : (msg.info.videoData && Number(msg.info.videoData.lengthSeconds) > 0 ? Number(msg.info.videoData.lengthSeconds) : 0));
            if (rawDur > 0 && Number.isFinite(rawDur)) {
              heroBgTeaserDuration = rawDur;
            }
            const curStageEl = document.getElementById("heroStageEl");
            const isFgLive = Boolean(curStageEl && curStageEl.classList.contains("is-trailer-foreground-mode"));
            if (typeof msg.info.muted === "boolean") {
              if (isFgLive && !heroBgTeaserUserMuted && msg.info.muted === true && heroBgTeaserUnmuteRetries < 4) {
                heroBgTeaserUnmuteRetries += 1;
                window._heroUnmuteGraceUntil = Date.now() + 1800;
                const retryVol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : 85;
                sendYoutubeHeroTeaserCommandClient("unMute");
                sendYoutubeHeroTeaserCommandClient("setVolume", [retryVol]);
                heroBgTeaserMuted = false;
              } else if (!heroBgTeaserPendingUnmute && (msg.info.muted === false || heroBgTeaserUserMuted || Date.now() > (window._heroUnmuteGraceUntil || 0))) {
                heroBgTeaserMuted = msg.info.muted;
              }
            }
            // Im stillen Hintergrund-Preview 3,2s vor Ende sanft ausblenden; im aktiven Kino-Vordergrund bis zum echten Ende durchspielen!
            if (
              !isFgLive &&
              heroBgTeaserDuration > 6 &&
              heroBgTeaserCurTime > 2 &&
              (heroBgTeaserDuration - heroBgTeaserCurTime) <= 3.2 &&
              !heroBgTeaserEnded &&
              !heroBgTeaserScrubbing
            ) {
              concealAndPauseHeroTrailerClient({ ended: true, exitForeground: true, pauseDelayMs: 430 });
              return;
            }
            syncHeroCinemaDockUiClient();
          }

          if (pState !== null) {
            const layer = document.getElementById("heroBgVideoLayer");
            const stageEl = document.getElementById("heroStageEl");
            const isFg = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));
            if (pState === 1) {
              if (heroBgTeaserWatchdogTimer) {
                clearTimeout(heroBgTeaserWatchdogTimer);
                heroBgTeaserWatchdogTimer = null;
              }
              const wasConfirmedBefore = heroBgTeaserIsPlayingConfirmed;
              heroBgTeaserIsPlayingConfirmed = true;
              heroBgTeaserPaused = false;
              heroBgTeaserEnded = false;
              if (!wasConfirmedBefore || !heroBgTeaserPlayingStartedAt) {
                heroBgTeaserPlayingStartedAt = Date.now();
              }
              if (heroBgTeaserDuration <= 0 && heroFrame && heroFrame.contentWindow) {
                try { heroFrame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*"); } catch (_le) {}
              }
              if (isFg) {
                ensureHeroCinemaLiveClockClient();
              }
              if (heroBgTeaserPendingUnmute || (isFg && !heroBgTeaserUserMuted)) {
                heroBgTeaserPendingUnmute = false;
                enforceHeroForegroundUnmuteClient();
              }
              applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, heroBgTeaserCcMode, heroBgTeaserActiveKey);
              if (heroBgTeaserSpeed !== 1) {
                sendYoutubeHeroTeaserCommandClient("setPlaybackRate", [heroBgTeaserSpeed]);
              }
              if (heroBgTeaserChromeShieldRequired || !isFg || !wasConfirmedBefore) {
                const elapsedPlaying = Date.now() - (heroBgTeaserPlayingStartedAt || Date.now());
                const holdRemainingMs = Math.max(480, 2250 - elapsedPlaying);
                scheduleHeroRevealAfterYoutubeChromeHidesClient(holdRemainingMs, !wasConfirmedBefore);
              } else if (layer && isFg && !heroBgTeaserStoppedByUser && !heroBgTeaserDelayedPauseTimer) {
                layer.classList.remove("is-concealing");
                layer.classList.add("is-playing");
                if (stageEl) stageEl.classList.remove("is-cinema-starting");
                setHeroTrailerLoadingBadgeClient(false);
                wakeHeroCinemaDockClient();
              }
              syncHeroCinemaDockUiClient();
            } else if (pState === 2) {
              heroBgTeaserPaused = true;
              stopHeroCinemaLiveClockClient();
              if (stageEl) stageEl.classList.remove("is-cinema-starting");
              setHeroTrailerLoadingBadgeClient(false);
              // Im Vordergrund-Kino-Modus bleibt das pausierte Video sichtbar; gezielte TelePort-Ersatzoverlays überdecken nur die YouTube-Controls!
              if (!isFg || heroBgTeaserPreloadedParked || heroBgTeaserEnded) {
                heroBgTeaserChromeShieldRequired = true;
                if (layer) {
                  layer.classList.remove("is-playing");
                }
              } else {
                heroBgTeaserChromeShieldRequired = false;
                if (layer) {
                  layer.classList.remove("is-concealing");
                  layer.classList.add("is-playing");
                }
              }
              wakeHeroCinemaDockClient();
              syncHeroCinemaDockUiClient();
            } else if (pState === 0) {
              stopHeroCinemaLiveClockClient();
              if (stageEl) stageEl.classList.remove("is-cinema-starting");
              if (isFg) {
                heroBgTeaserEnded = true;
                heroBgTeaserPaused = true;
                if (heroBgTeaserDuration > 0) heroBgTeaserCurTime = heroBgTeaserDuration;
                setHeroTrailerLoadingBadgeClient(false);
                wakeHeroCinemaDockClient();
                syncHeroCinemaDockUiClient();
                startHeroCinemaEndcardCountdownClient();
                const endPrimaryBtn = document.getElementById("heroCinemaEndPrimaryBtn");
                if (endPrimaryBtn) {
                  if (typeof jumpSpatialFocus === "function") jumpSpatialFocus(endPrimaryBtn, false);
                  try { endPrimaryBtn.focus({ preventScroll: true }); } catch (_fe) {}
                  requestAnimationFrame(() => {
                    const liveBtn = document.getElementById("heroCinemaEndPrimaryBtn");
                    if (liveBtn && document.getElementById("heroStageEl")?.classList.contains("is-cinema-ended")) {
                      if (typeof jumpSpatialFocus === "function") jumpSpatialFocus(liveBtn, false);
                      try { liveBtn.focus({ preventScroll: true }); } catch (_fe2) {}
                    }
                  });
                }
              } else {
                concealAndPauseHeroTrailerClient({ ended: true, exitForeground: true, pauseDelayMs: 430 });
              }
            } else if ((pState === -1 || pState === 5) && !heroBgTeaserPaused && !heroBgTeaserEnded && !heroBgTeaserStoppedByUser) {
              sendYoutubeHeroTeaserCommandClient("playVideo");
              syncHeroCinemaDockUiClient();
            }
          }
        });
      }

      function syncHeroTrailerAvailabilityButtonClient(status = "checking", count = 0) {
        const btn = document.getElementById("heroBtnTrailer");
        if (!btn) return;
        btn.setAttribute("data-trailer-status", status);
        if (status === "none") {
          btn.classList.add("is-trailer-unavailable");
          btn.innerHTML = "🔎 Trailer suchen";
          btn.setAttribute("title", "Kein direkt abspielbarer Trailer verfügbar – YouTube-Suche öffnen");
        } else {
          btn.classList.remove("is-trailer-unavailable");
          btn.innerHTML = "▶ Trailer";
          btn.setAttribute("title", count > 1 ? ("Trailer direkt im Hauptslider abspielen (" + count + " Clips verfügbar)") : "Trailer direkt im Hauptslider einblenden");
        }
      }

      async function resolveHeroSlideTrailerCandidatesClient(hero, heroType) {
        if (!hero || !hero.id) return [];
        const extractFn = typeof extractCandidateKeysFromTrailersClient === "function"
          ? extractCandidateKeysFromTrailersClient
          : (tr) => {
              if (!tr) return [];
              if (typeof tr === "string") return [tr.trim()].filter(Boolean);
              registerTrailerMetaMapClient(tr);
              const arr = Array.isArray(tr.candidates) && tr.candidates.length ? tr.candidates : (tr.key ? [tr.key] : []);
              return arr.map(x => String(x || "").trim()).filter(Boolean);
            };
        const applyAvailability = (list) => {
          const cleanList = Array.isArray(list) ? list : [];
          hero._trailerChecked = true;
          hero._hasEmbeddableTrailer = cleanList.length > 0;
          hero._trailerCount = cleanList.length;
          const activeHero = state.heroSlides && (state.heroSlides[state.heroIndex] || state.heroSlides[0]);
          if (activeHero && String(activeHero.id) === String(hero.id)) {
            syncHeroTrailerAvailabilityButtonClient(cleanList.length > 0 ? "available" : "none", cleanList.length);
          }
          return cleanList;
        };
        if (hero.trailers) {
          registerTrailerMetaMapClient(hero.trailers);
          const direct = extractFn(hero.trailers);
          if (direct.length > 0) return applyAvailability(direct);
        }
        if (hero._cachedTrailers) {
          registerTrailerMetaMapClient(hero._cachedTrailers);
          const cached = extractFn(hero._cachedTrailers);
          if (cached.length > 0) return applyAvailability(cached);
        }
        if (hero._trailerChecked && hero._hasEmbeddableTrailer === false) {
          return applyAvailability([]);
        }
        const tc = heroType === "s" ? "s" : "m";
        const vipAllowed = typeof isCurrentUserVip === "function" ? isCurrentUserVip() : false;
        const cacheKey = tc + "_" + hero.id + "_" + (vipAllowed ? "vip" : "std");
        if (typeof clientDetailsCache !== "undefined" && clientDetailsCache instanceof Map) {
          const hit = clientDetailsCache.get(cacheKey);
          if (hit && hit.data) {
            if (hit.data.trailers) {
              hero._cachedTrailers = hit.data.trailers;
              registerTrailerMetaMapClient(hit.data.trailers);
              return applyAvailability(extractFn(hit.data.trailers));
            }
            if (hit.data.hasTrailer === false || hit.data.trailers === null) {
              return applyAvailability([]);
            }
          }
        }
        try {
          const d = typeof fetchMediaDetailsDedupClient === "function"
            ? await fetchMediaDetailsDedupClient(tc, hero.id)
            : await apiFetchJson(API_BASE + "/details?type=" + tc + "&id=" + encodeURIComponent(hero.id) + "&skipSaved=1");
          if (d && d.ok !== false) {
            if (typeof clientDetailsCache !== "undefined" && clientDetailsCache instanceof Map && !clientDetailsCache.has(cacheKey)) {
              clientDetailsCache.set(cacheKey, { data: d, ts: Date.now() });
            }
            if ((!hero.overview || !String(hero.overview).trim()) && d.overview && String(d.overview).trim()) {
              hero.overview = String(d.overview).trim();
            }
            if (d.trailers) {
              hero._cachedTrailers = d.trailers;
              registerTrailerMetaMapClient(d.trailers);
              return applyAvailability(extractFn(d.trailers));
            }
            return applyAvailability([]);
          }
        } catch (_e) {}
        return [];
      }

      // Lädt den schweren YouTube-Iframe im Hero-Slider erst als Letztes – nachdem sichtbare Elemente & Cover Priorität hatten!
      function scheduleDeferredHeroIframeMountClient(reqSeq, slideKey, mountFn) {
        if (heroBgTeaserDeferTimer) {
          clearTimeout(heroBgTeaserDeferTimer);
          heroBgTeaserDeferTimer = null;
        }
        const runWhenIdle = () => {
          if (reqSeq !== heroBgTeaserRequestSeq) return;
          const finishMount = () => {
            if (reqSeq !== heroBgTeaserRequestSeq) return;
            const curHero = state.heroSlides && (state.heroSlides[state.heroIndex] || state.heroSlides[0]);
            const curSlideKey = curHero ? ((curHero.media_type === "tv" || state.type === "s" ? "s" : "m") + "_" + curHero.id) : "";
            if (!curHero || curSlideKey !== slideKey) return;
            if (document.getElementById("modalRoot")?.firstElementChild) return;
            if (heroCurtainScrolledToCatalog || !isHeroStageAvailableForCurrentViewClient()) return;
            mountFn();
          };
          if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(() => {
              heroBgTeaserDeferTimer = setTimeout(finishMount, 450);
            }, { timeout: 1400 });
          } else {
            heroBgTeaserDeferTimer = setTimeout(finishMount, 750);
          }
        };

        const waitForVisibleImagesThenRun = () => {
          if (reqSeq !== heroBgTeaserRequestSeq) return;
          const visibleImgs = Array.from(document.querySelectorAll("#resultsGridContainer img.lazy-cover-img")).slice(0, 10);
          const pendingImgs = visibleImgs.filter(img => {
            const src = img.getAttribute("src") || "";
            return src && !src.startsWith("data:") && !img.complete;
          });
          if (pendingImgs.length === 0) {
            heroBgTeaserDeferTimer = setTimeout(runWhenIdle, 550);
            return;
          }
          let done = false;
          let remaining = pendingImgs.length;
          const onOneDone = () => {
            remaining -= 1;
            if (!done && remaining <= 0) {
              done = true;
              if (heroBgTeaserDeferTimer) clearTimeout(heroBgTeaserDeferTimer);
              heroBgTeaserDeferTimer = setTimeout(runWhenIdle, 450);
            }
          };
          pendingImgs.forEach(img => {
            img.addEventListener("load", onOneDone, { once: true });
            img.addEventListener("error", onOneDone, { once: true });
          });
          heroBgTeaserDeferTimer = setTimeout(() => {
            if (!done) {
              done = true;
              runWhenIdle();
            }
          }, 2200);
        };

        if (document.readyState === "complete") {
          waitForVisibleImagesThenRun();
        } else {
          let loadFired = false;
          const onDocLoad = () => {
            if (loadFired) return;
            loadFired = true;
            if (heroBgTeaserDeferTimer) clearTimeout(heroBgTeaserDeferTimer);
            waitForVisibleImagesThenRun();
          };
          window.addEventListener("load", onDocLoad, { once: true });
          heroBgTeaserDeferTimer = setTimeout(onDocLoad, 2800);
        }
      }

      function scheduleHeroBackgroundVideoTeaserClient(immediateForeground = false) {
        if (!isHeroStageAvailableForCurrentViewClient()) {
          stopHeroBackgroundVideoTeaserClient();
          return;
        }
        const hero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
        if (!hero || !hero.id) {
          stopHeroBackgroundVideoTeaserClient();
          return;
        }
        const heroType = hero.media_type === "tv" || state.type === "s" ? "s" : "m";
        const slideKey = heroType + "_" + hero.id;
        if (heroBgTeaserActiveSlideKey !== slideKey) {
          stopHeroBackgroundVideoTeaserClient();
          heroBgTeaserActiveSlideKey = slideKey;
        }
        const previewDisabled = !immediateForeground && typeof trailerPreviewEnabled !== "undefined" && !trailerPreviewEnabled;
        if (hero._trailerChecked) {
          syncHeroTrailerAvailabilityButtonClient(hero._hasEmbeddableTrailer ? "available" : "none", hero._trailerCount || 0);
        } else if (previewDisabled) {
          // Wenn Hintergrund-Vorschau aus ist, KEINEN /details-Worker-Call bei jeder Slide-Rotation feuern –
          // Trailer-Button bleibt direkt klickbar und lädt bei Klick on-demand!
          syncHeroTrailerAvailabilityButtonClient("available", 1);
          return;
        } else {
          syncHeroTrailerAvailabilityButtonClient("checking", 0);
        }
        if (!immediateForeground) {
          if (typeof document !== "undefined" && document.hidden) return;
          if (document.getElementById("modalRoot")?.firstElementChild) return;
          if (heroCurtainScrolledToCatalog || (document.body && document.body.classList.contains("hero-scrolled-past"))) return;
        }
        if (heroBgTeaserTimer) {
          clearTimeout(heroBgTeaserTimer);
          heroBgTeaserTimer = null;
        }
        if (heroBgTeaserDeferTimer) {
          clearTimeout(heroBgTeaserDeferTimer);
          heroBgTeaserDeferTimer = null;
        }
        const delayMs = immediateForeground ? 0 : 750;
        const reqSeq = ++heroBgTeaserRequestSeq;
        heroBgTeaserTimer = setTimeout(async () => {
          heroBgTeaserTimer = null;
          if (reqSeq !== heroBgTeaserRequestSeq) return;
          const curHero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
          const curSlideKey = curHero ? ((curHero.media_type === "tv" || state.type === "s" ? "s" : "m") + "_" + curHero.id) : "";
          if (!curHero || curSlideKey !== slideKey) return;
          if (!immediateForeground) {
            if (typeof document !== "undefined" && document.hidden) return;
            if (document.getElementById("modalRoot")?.firstElementChild) return;
            if (heroCurtainScrolledToCatalog || !isHeroStageAvailableForCurrentViewClient()) return;
          }
          const cands = await resolveHeroSlideTrailerCandidatesClient(curHero, heroType);
          if (reqSeq !== heroBgTeaserRequestSeq) return;
          const latestHero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
          const latestSlideKey = latestHero ? ((latestHero.media_type === "tv" || state.type === "s" ? "s" : "m") + "_" + latestHero.id) : "";
          if (!latestHero || latestSlideKey !== slideKey) return;
          heroBgTeaserActiveSlideKey = slideKey;
          heroBgTeaserCandidates = cands;
          heroBgTeaserCandidatesSlideKey = slideKey;
          heroBgTeaserCandidateIdx = 0;
          if (cands.length === 0 || previewDisabled) return;
          const existingFrame = document.getElementById("heroBgVideoIframe");
          if (existingFrame && existingFrame.getAttribute("data-slide-key") === slideKey && heroBgTeaserActiveKey === cands[0]) return;
          if (immediateForeground) {
            mountHeroTrailerCandidateAtIndexClient(0, true, 0);
            syncHeroCinemaDockUiClient();
          } else {
            scheduleDeferredHeroIframeMountClient(reqSeq, slideKey, () => {
              const liveFrame = document.getElementById("heroBgVideoIframe");
              if (liveFrame && liveFrame.getAttribute("data-slide-key") === slideKey && heroBgTeaserActiveKey === cands[0]) return;
              mountHeroTrailerCandidateAtIndexClient(0, false, 0);
              syncHeroCinemaDockUiClient();
            });
          }
        }, delayMs);
      }

      async function enterHeroForegroundTrailerModeClient(ev, fromStageTap = false) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const stageEl = document.getElementById("heroStageEl");
        if (!stageEl) return;
        if (stageEl.classList.contains("is-trailer-foreground-mode")) {
          const layer = document.getElementById("heroBgVideoLayer");
          if ((stageEl.classList.contains("is-cinema-starting") || (layer && !layer.classList.contains("is-playing"))) && heroBgTeaserActiveKey && !heroBgTeaserPaused && !heroBgTeaserEnded) {
            heroBgTeaserPendingUnmute = true;
            heroBgTeaserMuted = false;
            sendYoutubeHeroTeaserCommandClient("playVideo");
            sendYoutubeHeroTeaserCommandClient("unMute");
            sendYoutubeHeroTeaserCommandClient("setVolume", [getSavedTrailerVolumeClient()]);
            applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, heroBgTeaserCcMode, heroBgTeaserActiveKey);
            syncHeroCinemaDockUiClient();
            return;
          }
          exitHeroForegroundTrailerModeClient(ev);
          return;
        }
        const hero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
        if (!hero) return;
        const heroType = hero.media_type === "tv" || state.type === "s" ? "s" : "m";
        const slideKey = heroType + "_" + hero.id;
        if (heroRotationTimer) {
          clearInterval(heroRotationTimer);
          heroRotationTimer = null;
        }
        if (heroBgTeaserActiveSlideKey !== slideKey || heroBgTeaserCandidatesSlideKey !== slideKey) {
          stopHeroBackgroundVideoTeaserClient();
          heroBgTeaserActiveSlideKey = slideKey;
        }
        const reqSeq = ++heroBgTeaserRequestSeq;
        stageEl.classList.add("is-trailer-foreground-mode", "is-cinema-starting");
        setHeroTrailerLoadingBadgeClient(false);
        syncHeroCinemaDockUiClient();

        const candidates = (heroBgTeaserCandidates.length > 0 && heroBgTeaserCandidatesSlideKey === slideKey)
          ? heroBgTeaserCandidates
          : await resolveHeroSlideTrailerCandidatesClient(hero, heroType);
        if (reqSeq !== heroBgTeaserRequestSeq) return;
        const curHero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
        const curSlideKey = curHero ? ((curHero.media_type === "tv" || state.type === "s" ? "s" : "m") + "_" + curHero.id) : "";
        if (!curHero || curSlideKey !== slideKey) return;

        if (candidates.length === 0) {
          stageEl.classList.remove("is-cinema-starting");
          setHeroTrailerLoadingBadgeClient(false);
          if (fromStageTap) {
            syncHeroCinemaDockUiClient();
            return;
          }
          stageEl.classList.remove("is-trailer-foreground-mode");
          syncHeroCinemaDockUiClient();
          startHeroRotationTimer();
          const yearStr = (hero.release_date || hero.first_air_date || "").slice(0, 4);
          const ytQ = encodeURIComponent((hero.title || hero.name || "") + " " + yearStr + " Trailer Deutsch");
          showHudToast("ℹ️ Kein einbettbarer Trailer – öffne YouTube-Suche");
          openExternalUrlSafe("https://www.youtube.com/results?search_query=" + ytQ);
          return;
        }
        if (heroBgTeaserTimer) {
          clearTimeout(heroBgTeaserTimer);
          heroBgTeaserTimer = null;
        }
        if (heroBgTeaserDeferTimer) {
          clearTimeout(heroBgTeaserDeferTimer);
          heroBgTeaserDeferTimer = null;
        }
        heroBgTeaserActiveSlideKey = slideKey;
        heroBgTeaserCandidates = candidates;
        heroBgTeaserCandidatesSlideKey = slideKey;
        heroBgTeaserStoppedByUser = false;
        enforceHeroForegroundUnmuteClient();

        const existingFrame = document.getElementById("heroBgVideoIframe");
        const frameMatchesSlide = Boolean(
          existingFrame &&
          existingFrame.getAttribute("data-slide-key") === slideKey &&
          heroBgTeaserActiveKey &&
          candidates.includes(heroBgTeaserActiveKey)
        );
        if (frameMatchesSlide) {
          applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, heroBgTeaserCcMode, heroBgTeaserActiveKey);
          if (heroBgTeaserSpeed && heroBgTeaserSpeed !== 1) {
            sendYoutubeHeroTeaserCommandClient("setPlaybackRate", [heroBgTeaserSpeed]);
          }
          if (heroBgTeaserDuration <= 0 && existingFrame.contentWindow) {
            try { existingFrame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*"); } catch (_le2) {}
          }
          ensureHeroCinemaLiveClockClient();
          const layer = document.getElementById("heroBgVideoLayer");
          const elapsedSincePlaying = heroBgTeaserPlayingStartedAt > 0
            ? (Date.now() - heroBgTeaserPlayingStartedAt)
            : 0;
          const initialChromeStillFading = Boolean(heroBgTeaserPlayingStartedAt > 0 && elapsedSincePlaying < 2250);
          if (heroBgTeaserIsPlayingConfirmed && !heroBgTeaserPaused && !heroBgTeaserEnded && !heroBgTeaserChromeShieldRequired && !initialChromeStillFading) {
            stageEl.classList.remove("is-cinema-starting");
            setHeroTrailerLoadingBadgeClient(false);
            if (layer) {
              layer.classList.remove("is-concealing");
              layer.classList.add("is-playing");
            }
          } else if (!heroBgTeaserPaused && !heroBgTeaserEnded) {
            sendYoutubeHeroTeaserCommandClient("playVideo");
            const elapsed = heroBgTeaserPlayingStartedAt > 0
              ? (Date.now() - heroBgTeaserPlayingStartedAt)
              : (Date.now() - (heroBgTeaserStageOpenedAt || Date.now()));
            const remainingMs = Math.max(600, 2250 - elapsed);
            scheduleHeroRevealAfterYoutubeChromeHidesClient(remainingMs, true);
          } else {
            resumeHeroTrailerWithBackdropShieldClient({ restartIfEnded: true });
          }
        } else {
          mountHeroTrailerCandidateAtIndexClient(0, true, 0);
        }
        syncHeroCinemaDockUiClient();
        const focusBtn = document.getElementById("heroCinemaPlayBtn") || document.getElementById("heroCinemaModeBtn");
        if (focusBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(focusBtn, false);
        }
      }

      function exitHeroForegroundTrailerModeClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        cancelHeroCinemaEndcardCountdownClient(true);
        stopHeroCinemaLiveClockClient();
        if (typeof syncCinemaVolPopoverFocusStateClient === "function") {
          syncCinemaVolPopoverFocusStateClient(null);
        }
        heroBgTeaserRequestSeq += 1;
        const stageEl = document.getElementById("heroStageEl");
        if (!stageEl) return;
        stageEl.classList.remove("is-cinema-starting", "is-cinema-controls-idle");
        if (heroBgTeaserActiveKey && !heroBgTeaserPaused && !heroBgTeaserEnded) {
          concealAndPauseHeroTrailerClient({
            exitForeground: true,
            stoppedByUser: true,
            pauseDelayMs: 220
          });
        } else {
          setHeroTrailerLoadingBadgeClient(false);
          stageEl.classList.remove("is-trailer-foreground-mode");
          const layer = document.getElementById("heroBgVideoLayer");
          if (layer) {
            layer.classList.add("is-concealing");
            layer.classList.remove("is-playing");
            setTimeout(() => {
              const liveLayer = document.getElementById("heroBgVideoLayer");
              if (liveLayer && !liveLayer.classList.contains("is-playing")) {
                liveLayer.classList.remove("is-concealing");
              }
            }, 180);
          }
          syncHeroCinemaDockUiClient();
        }
        startHeroRotationTimer();
        const trBtn = document.getElementById("heroBtnTrailer") || document.getElementById("heroBtnDetails");
        if (trBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(trBtn, false);
        }
      }

      function toggleHeroCinemaPlayPauseClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeHeroCinemaDockClient();
        const stageEl = document.getElementById("heroStageEl");
        const isFg = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));
        if (!isFg) {
          enterHeroForegroundTrailerModeClient(ev, false);
          return;
        }
        const frame = document.getElementById("heroBgVideoIframe");
        if (!frame) {
          if (heroBgTeaserCandidates.length > 0) {
            heroBgTeaserStoppedByUser = false;
            mountHeroTrailerCandidateAtIndexClient(heroBgTeaserCandidateIdx || 0, !heroBgTeaserMuted, 0);
          }
          return;
        }
        if (heroBgTeaserEnded || heroBgTeaserPaused) {
          resumeHeroTrailerWithBackdropShieldClient({ restartIfEnded: true });
          showHeroSeekRippleBadgeClient(CINEMA_ICONS_CLIENT.pause, "center", { isHtmlIcon: true, durationMs: 900 });
        } else {
          // Video-Frame sichtbar lassen – gezielte TelePort-Ersatzoverlays überdecken nur YouTube-Pause-Controls!
          if (heroBgTeaserRevealTimer) {
            clearTimeout(heroBgTeaserRevealTimer);
            heroBgTeaserRevealTimer = null;
          }
          if (stageEl) stageEl.classList.remove("is-cinema-starting");
          heroBgTeaserPaused = true;
          heroBgTeaserStoppedByUser = true;
          heroBgTeaserChromeShieldRequired = false;
          const layer = document.getElementById("heroBgVideoLayer");
          if (layer) {
            layer.classList.remove("is-concealing");
            layer.classList.add("is-playing");
          }
          sendYoutubeHeroTeaserCommandClient("pauseVideo");
          wakeHeroCinemaDockClient();
          syncHeroCinemaDockUiClient();
          const centerPlayBtn = document.getElementById("heroCinemaCenterPlayBtn");
          if (centerPlayBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(centerPlayBtn, false);
          }
        }
      }

      function openHeroDetailsFromCinemaOverlayClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const curHero = (state && Array.isArray(state.heroSlides)) ? (state.heroSlides[state.heroIndex] || state.heroSlides[0]) : null;
        exitHeroForegroundTrailerModeClient(ev);
        if (curHero && curHero.id && typeof openDetails === "function") {
          const heroType = curHero.media_type === "tv" || state.type === "s" ? "s" : "m";
          openDetails(heroType, curHero.id);
        }
      }

      function toggleHeroBackgroundTeaserAudioClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeHeroCinemaDockClient();
        const frame = document.getElementById("heroBgVideoIframe");
        if (!frame) {
          enterHeroForegroundTrailerModeClient(ev, false);
          return;
        }
        if (heroBgTeaserMuted) {
          const vol = getSavedTrailerVolumeClient() > 0 ? getSavedTrailerVolumeClient() : saveTrailerVolumeClient(85);
          enforceHeroForegroundUnmuteClient();
          showHeroSeekRippleBadgeClient("🔊 " + vol + "%", "center");
          if (heroBgTeaserEnded || heroBgTeaserPaused) {
            resumeHeroTrailerWithBackdropShieldClient({ restartIfEnded: true });
            return;
          }
        } else {
          clearHeroUnmuteRetryTimersClient();
          heroBgTeaserUserMuted = true;
          heroBgTeaserPendingUnmute = false;
          heroBgTeaserMuted = true;
          sendYoutubeHeroTeaserCommandClient("mute");
          showHeroSeekRippleBadgeClient("🔇 Stumm", "center");
        }
        syncHeroCinemaDockUiClient();
      }

      function onHeroCinemaVolumeInputClient(inpEl, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (!inpEl) return;
        wakeHeroCinemaDockClient();
        const vol = saveTrailerVolumeClient(inpEl.value);
        inpEl.style.setProperty("--vol-pct", vol + "%");
        if (vol <= 0) {
          clearHeroUnmuteRetryTimersClient();
          heroBgTeaserUserMuted = true;
          heroBgTeaserMuted = true;
          heroBgTeaserPendingUnmute = false;
          sendYoutubeHeroTeaserCommandClient("mute");
        } else {
          heroBgTeaserUserMuted = false;
          heroBgTeaserMuted = false;
          heroBgTeaserPendingUnmute = false;
          window._heroUnmuteGraceUntil = Date.now() + 2000;
          sendYoutubeHeroTeaserCommandClient("unMute");
          sendYoutubeHeroTeaserCommandClient("setVolume", [vol]);
        }
        syncHeroCinemaDockUiClient();
      }

      function adjustHeroCinemaVolumeStepClient(delta, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeHeroCinemaDockClient();
        const numDelta = Number(delta || 0);
        if (numDelta !== 0) flashCinemaVolStepBtnClient("hero", numDelta > 0 ? "up" : "down");
        const baseVol = heroBgTeaserMuted ? 0 : getSavedTrailerVolumeClient();
        const nextVol = saveTrailerVolumeClient(baseVol + numDelta);
        if (nextVol <= 0) {
          clearHeroUnmuteRetryTimersClient();
          heroBgTeaserUserMuted = true;
          heroBgTeaserMuted = true;
          sendYoutubeHeroTeaserCommandClient("mute");
          showHeroSeekRippleBadgeClient("🔇 Stumm", "center");
        } else {
          heroBgTeaserUserMuted = false;
          heroBgTeaserMuted = false;
          window._heroUnmuteGraceUntil = Date.now() + 2000;
          sendYoutubeHeroTeaserCommandClient("unMute");
          sendYoutubeHeroTeaserCommandClient("setVolume", [nextVol]);
          showHeroSeekRippleBadgeClient("🔊 " + nextVol + "%", "center");
        }
        syncHeroCinemaDockUiClient();
      }

      function toggleHeroCinemaSubtitlesClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeHeroCinemaDockClient();
        const nextMode = getNextTrailerCcModeClient(heroBgTeaserCcMode);
        heroBgTeaserCcMode = nextMode;
        const ccMeta = formatTrailerCcButtonMetaClient(nextMode);
        const frame = document.getElementById("heroBgVideoIframe");
        if (frame && heroBgTeaserActiveKey && Array.isArray(heroBgTeaserCandidates) && heroBgTeaserCandidates.length > 0) {
          const resumeSec = Math.max(0, Math.floor(heroBgTeaserCurTime || 0));
          const keepUnmuted = !heroBgTeaserMuted || Boolean(document.getElementById("heroStageEl")?.classList.contains("is-trailer-foreground-mode"));
          const keepSpeed = heroBgTeaserSpeed || 1;
          heroBgTeaserStoppedByUser = false;
          mountHeroTrailerCandidateAtIndexClient(heroBgTeaserCandidateIdx || 0, keepUnmuted, resumeSec, nextMode, {
            preserveSpeed: keepSpeed,
            keepDuration: true,
            fastRevealMs: 1150,
            loadingLabel: ccMeta.toast + "…"
          });
        } else {
          applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, nextMode, heroBgTeaserActiveKey);
          showHeroSeekRippleBadgeClient(ccMeta.toast, "center");
        }
        syncHeroCinemaDockUiClient();
      }

      function cycleHeroCinemaSpeedClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeHeroCinemaDockClient();
        heroBgTeaserSpeed = getNextTrailerSpeedClient(heroBgTeaserSpeed);
        sendYoutubeHeroTeaserCommandClient("setPlaybackRate", [heroBgTeaserSpeed]);
        showHeroSeekRippleBadgeClient("⚡ " + heroBgTeaserSpeed + "×", "center");
        syncHeroCinemaDockUiClient();
      }

      function seekHeroCinemaRelativeClient(deltaSec, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeHeroCinemaDockClient();
        const frame = document.getElementById("heroBgVideoIframe");
        if (!frame || !heroBgTeaserActiveKey) return;
        const maxDur = heroBgTeaserDuration > 3.5 ? Math.max(1, heroBgTeaserDuration - 3.3) : 9999;
        const nextSec = Math.max(0, Math.min(maxDur, (heroBgTeaserCurTime || 0) + Number(deltaSec || 0)));
        heroBgTeaserCurTime = nextSec;
        heroBgTeaserEnded = false;
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        sendYoutubeHeroTeaserCommandClient("seekTo", [nextSec, true]);
        if (heroBgTeaserPaused) {
          heroBgTeaserPaused = false;
          heroBgTeaserStoppedByUser = false;
          sendYoutubeHeroTeaserCommandClient("playVideo");
        }
        scheduleHeroRevealAfterYoutubeChromeHidesClient(1150, true);
        syncHeroCinemaDockUiClient();
        showHeroSeekRippleBadgeClient(
          deltaSec < 0 ? ("⏪ " + deltaSec + "s") : ("⏩ +" + deltaSec + "s"),
          deltaSec < 0 ? "left" : "right"
        );
      }

      function restartHeroCinemaTrailerClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeHeroCinemaDockClient();
        const frame = document.getElementById("heroBgVideoIframe");
        if (!frame || !heroBgTeaserActiveKey) return;
        heroBgTeaserCurTime = 0;
        heroBgTeaserEnded = false;
        heroBgTeaserPaused = false;
        heroBgTeaserStoppedByUser = false;
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        sendYoutubeHeroTeaserCommandClient("seekTo", [0, true]);
        sendYoutubeHeroTeaserCommandClient("playVideo");
        applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, heroBgTeaserCcMode, heroBgTeaserActiveKey);
        scheduleHeroRevealAfterYoutubeChromeHidesClient(1150, true);
        syncHeroCinemaDockUiClient();
        showHeroSeekRippleBadgeClient("⏮ 0:00 Neustart", "center");
      }

      function switchNextHeroTrailerCandidateManualClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        wakeHeroCinemaDockClient();
        if (!Array.isArray(heroBgTeaserCandidates) || heroBgTeaserCandidates.length <= 1) return;
        const nextIdx = (heroBgTeaserCandidateIdx + 1) % heroBgTeaserCandidates.length;
        const keepUnmuted = !heroBgTeaserMuted || Boolean(document.getElementById("heroStageEl")?.classList.contains("is-trailer-foreground-mode"));
        heroBgTeaserStoppedByUser = false;
        mountHeroTrailerCandidateAtIndexClient(nextIdx, keepUnmuted, 0);
        syncHeroCinemaDockUiClient();
        const nextMeta = getTrailerCandidateMetaClient(heroBgTeaserCandidates[nextIdx]);
        const langSuffix = nextMeta.lang ? (" · " + nextMeta.lang.toUpperCase()) : "";
        const subSuffix = heroBgTeaserCcMode !== "off" ? " · UT DE" : "";
        showHeroSeekRippleBadgeClient("⏭ Clip " + (nextIdx + 1) + "/" + heroBgTeaserCandidates.length + langSuffix + subSuffix, "center");
      }

      function onHeroCinemaScrubInputClient(inpEl, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (!inpEl) return;
        heroBgTeaserScrubbing = true;
        wakeHeroCinemaDockClient();
        heroBgTeaserChromeShieldRequired = true;
        const stageEl = document.getElementById("heroStageEl");
        if (stageEl && stageEl.classList.contains("is-trailer-foreground-mode")) {
          stageEl.classList.add("is-cinema-starting");
        } else {
          const layer = document.getElementById("heroBgVideoLayer");
          if (layer) layer.classList.remove("is-playing");
        }
        const targetSec = Math.max(0, Number(inpEl.value || 0));
        heroBgTeaserCurTime = targetSec;
        const maxDur = Number(inpEl.max) || (heroBgTeaserDuration > 0 ? Math.floor(heroBgTeaserDuration) : 120);
        const pct = maxDur > 0 ? Math.max(0, Math.min(100, (targetSec / maxDur) * 100)) : 0;
        inpEl.style.setProperty("--scrub-pct", pct.toFixed(1) + "%");
        const timeLbl = document.getElementById("heroCinemaTimeLbl");
        if (timeLbl) {
          timeLbl.textContent = heroBgTeaserDuration > 0
            ? (formatHeroTrailerDockTimeClient(targetSec) + " / " + formatHeroTrailerDockTimeClient(heroBgTeaserDuration))
            : formatHeroTrailerDockTimeClient(targetSec);
        }
      }

      function onHeroCinemaScrubChangeClient(inpEl, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (!inpEl) return;
        const maxDur = heroBgTeaserDuration > 3.5 ? Math.max(1, Math.floor(heroBgTeaserDuration - 3.3)) : 9999;
        const targetSec = Math.max(0, Math.min(maxDur, Number(inpEl.value || 0)));
        heroBgTeaserCurTime = targetSec;
        heroBgTeaserScrubbing = false;
        heroBgTeaserEnded = false;
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        sendYoutubeHeroTeaserCommandClient("seekTo", [targetSec, true]);
        if (heroBgTeaserPaused) {
          heroBgTeaserPaused = false;
          heroBgTeaserStoppedByUser = false;
          sendYoutubeHeroTeaserCommandClient("playVideo");
        }
        scheduleHeroRevealAfterYoutubeChromeHidesClient(1150, true);
        syncHeroCinemaDockUiClient();
        wakeHeroCinemaDockClient();
      }

      function onHeroForegroundStageCatcherTapClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const stageEl = document.getElementById("heroStageEl");
        if (!stageEl) return;
        const dock = document.getElementById("heroCinemaPlayerDock");
        const wasDockIdleHidden = Boolean(dock && dock.classList.contains("is-idle-hidden"));
        wakeHeroCinemaDockClient();
        const now = Date.now();
        let clientX = 0;
        if (ev && typeof ev.clientX === "number" && ev.clientX > 0) {
          clientX = ev.clientX;
        } else if (ev && ev.changedTouches && ev.changedTouches[0]) {
          clientX = ev.changedTouches[0].clientX;
        }
        const rect = stageEl.getBoundingClientRect();
        const relX = rect.width > 0 ? ((clientX - rect.left) / rect.width) : 0.5;

        if (now - heroFgLastTapAt < 270) {
          heroFgLastTapAt = 0;
          if (heroFgTapTimer) {
            clearTimeout(heroFgTapTimer);
            heroFgTapTimer = null;
          }
          if (relX < 0.38 && heroBgTeaserActiveKey) {
            seekHeroCinemaRelativeClient(-10, ev);
          } else if (relX > 0.62 && heroBgTeaserActiveKey) {
            seekHeroCinemaRelativeClient(10, ev);
          } else if (heroBgTeaserActiveKey) {
            toggleHeroCinemaPlayPauseClient(ev);
          }
          return;
        }

        const layer = document.getElementById("heroBgVideoLayer");
        if ((stageEl.classList.contains("is-cinema-starting") || (layer && !layer.classList.contains("is-playing"))) && heroBgTeaserActiveKey && !heroBgTeaserPaused && !heroBgTeaserEnded) {
          sendYoutubeHeroTeaserCommandClient("playVideo");
          sendYoutubeHeroTeaserCommandClient("unMute");
          sendYoutubeHeroTeaserCommandClient("setVolume", [getSavedTrailerVolumeClient()]);
          applyYoutubeSubtitlesStateClient(sendYoutubeHeroTeaserCommandClient, heroBgTeaserCcMode, heroBgTeaserActiveKey);
          return;
        }

        heroFgLastTapAt = now;
        if (heroFgTapTimer) {
          clearTimeout(heroFgTapTimer);
        }
        heroFgTapTimer = setTimeout(() => {
          heroFgTapTimer = null;
          heroFgLastTapAt = 0;
          if (!heroBgTeaserActiveKey) {
            exitHeroForegroundTrailerModeClient(ev);
            return;
          }
          if (heroBgTeaserPaused && !heroBgTeaserEnded) {
            toggleHeroCinemaPlayPauseClient(ev);
            return;
          }
          if (wasDockIdleHidden && !heroBgTeaserPaused && !heroBgTeaserEnded) {
            wakeHeroCinemaDockClient();
            return;
          }
          toggleHeroCinemaPlayPauseClient(ev);
        }, 255);
      }

      function scrollToCatalogBelowHeroClient(ev, opts) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (document.getElementById("heroStageEl")?.classList.contains("is-trailer-foreground-mode")) {
          concealAndPauseHeroTrailerClient({ exitForeground: true, pauseDelayMs: 280 });
        }
        animateHeroCatalogSnapScrollClient(getHeroCatalogSnapScrollYClient(), opts);
      }

      function expandHeroSliderAndFocusClient(focusMode = "hero") {
        const hasSearchHero = state.isSearchMode && Array.isArray(state.items) && state.items.length >= 2;
        const hasDiscoverHero = !state.isSearchMode && (!state.currentView || state.currentView === "discover");
        if ((!hasSearchHero && !hasDiscoverHero) || !state.heroSlides || !state.heroSlides.length) {
          return false;
        }
        if (state.heroHidden) {
          toggleHeroSliderHidden(false);
        } else {
          animateHeroCatalogSnapScrollClient(0);
        }
        if (document.body) {
          document.body.classList.add("in-hero-slider");
        }
        if (typeof syncSmartPageIndicatorDomClient === "function") {
          syncSmartPageIndicatorDomClient(false);
        }
        syncExpandableDescriptionsOverflowClient();
        setTimeout(() => {
          syncExpandableDescriptionsOverflowClient();
          if (focusMode === "header") {
            const topEl = document.getElementById("searchInput") || document.getElementById("sidebarToggleBtn");
            if (topEl && typeof jumpSpatialFocus === "function") jumpSpatialFocus(topEl, false, "up");
          } else {
            const heroTarget = document.getElementById("heroBtnTrailer") || document.getElementById("heroBtnDetails") || document.getElementById("heroBtnWishlist");
            if (heroTarget && typeof jumpSpatialFocus === "function") jumpSpatialFocus(heroTarget, false, "up");
          }
          if (typeof syncSmartPageIndicatorDomClient === "function") {
            syncSmartPageIndicatorDomClient(false);
          }
        }, 70);
        return true;
      }

      if (typeof document !== "undefined" && !window._heroVisibilityGuardBound) {
        window._heroVisibilityGuardBound = true;
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) {
            try { stopHeroRotationTimer(); } catch (_e) {}
            try { stopHeroBackgroundVideoTeaserClient(); } catch (_e) {}
            try {
              if (typeof stopDetailBackgroundVideoTeaserClient === "function") {
                stopDetailBackgroundVideoTeaserClient();
              }
            } catch (_e) {}
          } else {
            try { startHeroRotationTimer(); } catch (_e) {}
          }
        });
      }

      function stopHeroRotationTimer() {
        if (heroRotationTimer) {
          clearInterval(heroRotationTimer);
          heroRotationTimer = null;
        }
      }

      function startHeroRotationTimer() {
        stopHeroRotationTimer();
        if (typeof document !== "undefined" && document.hidden) return;
        if (state.heroHidden || (typeof heroCurtainScrolledToCatalog !== "undefined" && heroCurtainScrolledToCatalog)) return;
        if (!Array.isArray(state.heroSlides) || state.heroSlides.length <= 1) return;
        const intervalMs = 7000;
        heroRotationTimer = setInterval(() => {
          if (typeof document !== "undefined" && document.hidden) return;
          if (typeof window !== "undefined" && window._tmaAppDeactivated) return;
          if (!Array.isArray(state.heroSlides) || state.heroSlides.length <= 1) return;
          if (
            document.getElementById("modalRoot")?.firstElementChild ||
            document.getElementById("lightboxRoot")?.firstElementChild ||
            document.getElementById("customDialogRoot")?.firstElementChild
          ) {
            return;
          }
          if (document.getElementById("heroStageEl")?.classList.contains("is-trailer-foreground-mode")) {
            return;
          }
          const isScrolledPast = Boolean(
            heroCurtainScrolledToCatalog ||
            (document.body && document.body.classList.contains("hero-scrolled-past")) ||
            (window.scrollY || window.pageYOffset || 0) > 20
          );
          if (state.heroHidden || isScrolledPast || isAnySideMenuOpenClient()) {
            return;
          }
          if (state.searchFocused || heroPointerHovered) return;
          if (document.getElementById("heroDescEl")?.classList.contains("is-expanded")) return;
          if (typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#heroBannerSlot")) {
            return;
          }
          stopHeroBackgroundVideoTeaserClient();
          state.heroIndex = (state.heroIndex + 1) % state.heroSlides.length;
          state.heroActionsEngaged = false;
          updateHeroBannerDomOnly();
        }, intervalMs);
      }

      function setHeroSlideIndex(idx) {
        if (!state.heroSlides.length) return;
        triggerTmaHapticClient("selection");
        clearHeroDescTransientFocusClient();
        stopHeroBackgroundVideoTeaserClient();
        state.heroIndex = (idx + state.heroSlides.length) % state.heroSlides.length;
        state.heroActionsEngaged = false;
        updateHeroBannerDomOnly();
        startHeroRotationTimer();
      }

      function selectHeroSlideCard(idx) {
        if (!state.heroSlides.length) return;
        triggerTmaHapticClient("selection");
        clearHeroDescTransientFocusClient();
        stopHeroBackgroundVideoTeaserClient();
        state.heroIndex = (idx + state.heroSlides.length) % state.heroSlides.length;
        state.heroActionsEngaged = true;
        updateHeroBannerDomOnly();
        startHeroRotationTimer();
        const trBtn = document.getElementById("heroBtnTrailer") || document.getElementById("heroBtnDetails");
        if (trBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(trBtn, false);
        }
      }

      function toggleHeroSliderHidden(forceHide) {
        const isScrolledPast = Boolean(heroCurtainScrolledToCatalog || (document.body && document.body.classList.contains("hero-scrolled-past")));
        if (typeof forceHide !== "boolean" && !state.heroHidden && isScrolledPast) {
          animateHeroCatalogSnapScrollClient(0);
          return;
        }
        state.heroHidden = typeof forceHide === "boolean" ? forceHide : !state.heroHidden;
        state.heroActionsEngaged = false;
        if (state.heroHidden) {
          stopHeroBackgroundVideoTeaserClient();
        }
        if (!state.heroHidden) {
          heroCurtainScrolledToCatalog = false;
          heroCurrentZone = 0;
          if (document.body) {
            document.body.classList.remove("hero-scrolled-past", "page-scrolled");
          }
          if ((window.scrollY || window.pageYOffset || 0) > 0) {
            window.scrollTo(0, 0);
          }
        }
        try { localStorage.setItem("tma_hero_hidden", state.heroHidden ? "1" : "0"); } catch (e) {}
        syncHeroExpandedBodyClass();
        const curtainEl = document.getElementById("heroCurtainShell");
        if (curtainEl) {
          curtainEl.classList.toggle("is-collapsed", Boolean(state.heroHidden || heroCurtainScrolledToCatalog));
          if (!state.heroHidden) {
            updateHeroBannerDomOnly(false);
          }
        } else {
          updateHeroBannerDomOnly(true);
        }
        syncHeroScrollFadeAndTopBarStateClient();
        syncHeroSearchPlaceholderAndToggleBtnClient();
        startHeroRotationTimer();
        if (state.sidebarOpen) {
          renderFilterSidebarContent(false);
          const sbHeroBtn = document.getElementById("sidebarHeroToggleBtn");
          if (sbHeroBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(sbHeroBtn, false);
        }
        if (state.currentView === "settings") {
          const stHeroBtn = document.getElementById("settingsHeroToggleBtn");
          if (stHeroBtn) {
            stHeroBtn.className = "btn " + (!state.heroHidden ? "blue" : "");
            stHeroBtn.innerHTML = '<span>🎬 Empfehlungs-Slider auf der Startseite</span><b>' + (state.heroHidden ? 'AUSGEBLENDET' : 'SICHTBAR') + '</b>';
            if (!state.sidebarOpen && typeof jumpSpatialFocus === "function") jumpSpatialFocus(stHeroBtn, false);
          }
        }
        if (state.heroHidden) {
          showHudToast("🎬 Spotlight sanft eingeklappt • Highlights rotieren als Vorschlag im Suchfeld");
        } else {
          showHudToast("🎬 Kino-Spotlight ausgeklappt");
        }
        if (!state.sidebarOpen && state.currentView !== "settings") {
          const hideBtn = document.getElementById("heroHideBtn");
          if (hideBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(hideBtn, false);
          }
        }
      }

      function triggerHeroSwipeUpCollapseClient(opts) {
        if (!isHeroStageAvailableForCurrentViewClient()) return;
        scrollToCatalogBelowHeroClient(null, opts);
      }

      let lastHeroSwipeGestureHandledAt = 0;

      window.__tmaHandleHeroSwipe = function(direction, opts) {
        const nowPerf = performance.now();
        if (nowPerf < heroBounceLockUntil && !(opts && opts.bounceLock)) return;
        if (nowPerf - lastHeroSwipeGestureHandledAt < 210) return;
        lastHeroSwipeGestureHandledAt = nowPerf;
        if (direction === "up") {
          triggerHeroSwipeUpCollapseClient(opts);
        } else if (direction === "down") {
          const canRevealHiddenHero = state.heroHidden && Array.isArray(state.heroSlides) && state.heroSlides.length > 0;
          if (canRevealHiddenHero) {
            toggleHeroSliderHidden(false);
          } else if (heroCurtainScrolledToCatalog || (window.scrollY || window.pageYOffset || 0) > 10) {
            animateHeroCatalogSnapScrollClient(0, opts);
          }
        } else if (direction === "left") {
          setHeroSlideIndex(state.heroIndex + 1);
        } else if (direction === "right") {
          setHeroSlideIndex(state.heroIndex - 1);
        }
      };

      if (typeof window !== "undefined" && !window._heroSwipeMessageListenerBound) {
        window._heroSwipeMessageListenerBound = true;
        window.addEventListener("message", (ev) => {
          if (ev.source !== window.parent && ev.source !== window) return;
          const d = ev && ev.data;
          if (d && d.type === "TMA_HERO_SWIPE_GESTURE" && (d.direction === "up" || d.direction === "down" || d.direction === "left" || d.direction === "right")) {
            window.__tmaHandleHeroSwipe(d.direction, { bounceLock: Boolean(d.bounceLock) });
          }
        });
      }

      function resolveHeroEventTargetElementClient(rawTarget) {
        if (!rawTarget || typeof rawTarget !== "object") return null;
        if (typeof rawTarget.closest === "function") return rawTarget;
        if (rawTarget.parentElement && typeof rawTarget.parentElement.closest === "function") {
          return rawTarget.parentElement;
        }
        return null;
      }

      function isHeroInteractiveControlTargetClient(rawTarget) {
        const el = resolveHeroEventTargetElementClient(rawTarget);
        if (!el) return false;
        return Boolean(
          el.closest(
            "button, a, input, select, textarea, .expandable-desc-box, .hero-dots-nav, .hero-scroll-down-hint, .hero-meta-genre, .hero-meta-year, [data-drag-handle], .admin-drag-handle, #floatingImportStatusWidget, .hero-cinema-player-dock"
          )
        );
      }

      let heroMouseDragActive = false;
      let heroMouseStartX = 0;
      let heroMouseStartY = 0;
      let heroMouseLastY = 0;
      let heroMouseStartTime = 0;
      let heroMouseLastTime = 0;
      let heroMouseInstantVy = 0;
      let heroMouseDraggingUp = false;
      let heroMouseStartTarget = null;

      function onHeroMouseDown(ev) {
        if (!ev || ev.button !== 0) return;
        if (performance.now() < heroBounceLockUntil) return;
        if (isHeroInteractiveControlTargetClient(ev.target)) {
          heroMouseDragActive = false;
          heroMouseStartTarget = null;
          return;
        }
        // Verhindert in Linux Firefox zuverlässig das Markieren von Texten beim Ziehen im Slider!
        if (ev.cancelable) ev.preventDefault();
        try { window.getSelection()?.removeAllRanges(); } catch (_e) {}
        if (document.body) document.body.classList.add("is-gesture-dragging");
        cancelHeroSpringScrollClient();
        heroMouseDragActive = true;
        heroMouseStartTarget = ev.target;
        heroMouseStartX = ev.clientX;
        heroMouseStartY = ev.clientY;
        heroMouseLastY = ev.clientY;
        heroMouseStartTime = performance.now();
        heroMouseLastTime = heroMouseStartTime;
        heroMouseInstantVy = 0;
        heroMouseDraggingUp = false;
      }

      if (typeof window !== "undefined" && !window._heroMouseSwipeListenersBound && !(document.body && document.body.getAttribute("data-device") === "tv")) {
        window._heroMouseSwipeListenersBound = true;
        window.addEventListener("selectstart", (ev) => {
          if (heroMouseDragActive || (document.body && document.body.classList.contains("is-gesture-dragging"))) {
            if (ev.cancelable) ev.preventDefault();
          }
        });
        window.addEventListener("mousemove", (ev) => {
          if (!heroMouseDragActive) return;
          if (ev.buttons !== undefined && ev.buttons === 0) {
            heroMouseDragActive = false;
            if (document.body) document.body.classList.remove("is-gesture-dragging");
            setHeroRubberBandOffsetClient(0);
            return;
          }
          const nowPerf = performance.now();
          if (nowPerf < heroBounceLockUntil) {
            heroMouseDragActive = false;
            heroMouseDraggingUp = false;
            if (document.body) document.body.classList.remove("is-gesture-dragging");
            setHeroRubberBandOffsetClient(0);
            return;
          }
          const dx = ev.clientX - heroMouseStartX;
          const dy = ev.clientY - heroMouseStartY;
          const stepDt = Math.max(8, nowPerf - (heroMouseLastTime || nowPerf));
          const totalDt = Math.max(12, nowPerf - (heroMouseStartTime || nowPerf));
          const instVy = (ev.clientY - (heroMouseLastY || ev.clientY)) / stepDt;
          const avgVy = dy / totalDt;
          heroMouseInstantVy = Math.abs(instVy) > Math.abs(avgVy) ? instVy : avgVy;
          heroMouseLastY = ev.clientY;
          heroMouseLastTime = nowPerf;

          if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            try { window.getSelection()?.removeAllRanges(); } catch (_e) {}
            clearHeroDescTransientFocusClient();
          }
          if (Math.abs(dy) >= Math.abs(dx) * 0.95 && isHeroStageAvailableForCurrentViewClient()) {
            if (dy <= -HERO_BOUNCE_LOCK_MIN_DIST && heroMouseInstantVy <= -HERO_BOUNCE_LOCK_VELOCITY && Math.abs(dy) > Math.abs(dx) * 1.15) {
              heroMouseDragActive = false;
              heroMouseDraggingUp = false;
              if (document.body) document.body.classList.remove("is-gesture-dragging");
              setHeroRubberBandOffsetClient(0);
              const hintBtn = document.getElementById("heroScrollDownHintBtn");
              if (hintBtn) hintBtn.style.transform = "";
              window.__tmaHandleHeroSwipe("up", { bounceLock: true });
              return;
            }
            if (dy < -6) {
              heroMouseDraggingUp = true;
              const stageWrap = document.getElementById("heroStageWrapEl");
              if (stageWrap) {
                const heroH = Math.max(280, stageWrap.offsetHeight || window.innerHeight || 580);
                const absDy = Math.abs(dy);
                const rubberPx = -Math.round(Math.min(38, Math.pow(absDy, 0.76) * 1.25));
                setHeroRubberBandOffsetClient(rubberPx);
                const dragFade = Math.max(0, Math.min(0.42, absDy / (heroH * 0.65)));
                stageWrap.style.setProperty("--hero-scroll-fade", dragFade.toFixed(3));
              }
              const hintBtn = document.getElementById("heroScrollDownHintBtn");
              if (hintBtn) {
                const ratio = Math.min(1, Math.abs(dy) / 90);
                hintBtn.style.transform = "translate3d(0, " + Math.round(ratio * 10) + "px, 0) scale(" + (1 + ratio * 0.14).toFixed(2) + ")";
              }
            }
          }
        }, { passive: true });

        window.addEventListener("mouseup", (ev) => {
          if (!heroMouseDragActive) return;
          if (document.body) document.body.classList.remove("is-gesture-dragging");
          const dx = ev.clientX - heroMouseStartX;
          const dy = ev.clientY - heroMouseStartY;
          const dt = Math.max(16, performance.now() - (heroMouseStartTime || performance.now()));
          const avgVy = dy / dt;
          const vy = Math.abs(heroMouseInstantVy) > Math.abs(avgVy) ? heroMouseInstantVy : avgVy;
          const wasDraggingUp = heroMouseDraggingUp;
          const startTarget = heroMouseStartTarget || ev.target;
          heroMouseDragActive = false;
          heroMouseDraggingUp = false;
          heroMouseStartTarget = null;
          setHeroRubberBandOffsetClient(0);
          const hintBtn = document.getElementById("heroScrollDownHintBtn");
          if (hintBtn) hintBtn.style.transform = "";

          if (dy <= -HERO_BOUNCE_LOCK_MIN_DIST && vy <= -HERO_BOUNCE_LOCK_VELOCITY && Math.abs(dy) > Math.abs(dx) * 1.15) {
            window.__tmaHandleHeroSwipe("up", { bounceLock: true });
            return;
          }
          if ((dy <= -56 || (dy <= -36 && vy <= -0.45)) && Math.abs(dy) > Math.abs(dx) * 1.12) {
            window.__tmaHandleHeroSwipe("up");
            return;
          }
          if (wasDraggingUp) {
            animateHeroCatalogSnapScrollClient(0);
            return;
          }
          if (Math.abs(dx) >= 40 && Math.abs(dx) >= Math.abs(dy)) {
            clearHeroDescTransientFocusClient();
            window.__tmaHandleHeroSwipe(dx < 0 ? "left" : "right");
            return;
          }
          // Klick (<10px Bewegung) auf den freien Hintergrund im Hauptslider -> Direkt im Hauptslider Trailer einblenden und Text ausblenden!
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - lastHeroStageTapHandledAt > 420) {
            const el = resolveHeroEventTargetElementClient(startTarget);
            if (!el || !el.closest(".hero-foreground-stage-catcher")) {
              if (!isHeroInteractiveControlTargetClient(startTarget)) {
                lastHeroStageTapHandledAt = Date.now();
                enterHeroForegroundTrailerModeClient(ev, true);
              }
            }
          }
        }, { passive: true });
      }

      function onHeroTouchStart(ev) {
        if (performance.now() < heroBounceLockUntil) {
          heroTouchStartX = 0;
          heroTouchStartY = 0;
          heroTouchDraggingUp = false;
          return;
        }
        const el = resolveHeroEventTargetElementClient(ev.target);
        if (el && el.closest(".expandable-desc-box.is-expanded")) {
          heroTouchStartX = 0;
          heroTouchStartY = 0;
          heroTouchDraggingUp = false;
          return;
        }
        if (ev.touches && ev.touches[0]) {
          cancelHeroSpringScrollClient();
          heroTouchStartX = ev.touches[0].clientX;
          heroTouchStartY = ev.touches[0].clientY;
          heroTouchLastY = ev.touches[0].clientY;
          heroTouchStartTime = performance.now();
          heroTouchLastTime = heroTouchStartTime;
          heroTouchInstantVy = 0;
          heroTouchStartScrollY = window.scrollY || window.pageYOffset || 0;
          heroTouchDraggingUp = false;
        }
      }
      function onHeroTouchMove(ev) {
        const el = resolveHeroEventTargetElementClient(ev.target);
        if (el && el.closest(".expandable-desc-box.is-expanded")) {
          return;
        }
        const nowPerf = performance.now();
        if (nowPerf < heroBounceLockUntil) {
          heroTouchStartX = 0;
          heroTouchStartY = 0;
          heroTouchDraggingUp = false;
          setHeroRubberBandOffsetClient(0);
          return;
        }
        if (!heroTouchStartX || !heroTouchStartY || !ev.touches || !ev.touches[0]) return;
        const curTouchY = ev.touches[0].clientY;
        const dx = ev.touches[0].clientX - heroTouchStartX;
        const dy = curTouchY - heroTouchStartY;
        const stepDt = Math.max(8, nowPerf - (heroTouchLastTime || nowPerf));
        const totalDt = Math.max(12, nowPerf - (heroTouchStartTime || nowPerf));
        const instVy = (curTouchY - (heroTouchLastY || curTouchY)) / stepDt;
        const avgVy = dy / totalDt;
        heroTouchInstantVy = Math.abs(instVy) > Math.abs(avgVy) ? instVy : avgVy;
        heroTouchLastY = curTouchY;
        heroTouchLastTime = nowPerf;

        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          clearHeroDescTransientFocusClient();
        }
        if (Math.abs(dy) >= Math.abs(dx) * 0.95 && isHeroStageAvailableForCurrentViewClient()) {
          if (ev.cancelable) {
            ev.preventDefault();
          }
          // Mid-Gesture Bounce-Lock (Vollständig geschlossen): Bei zu schnellem Wischen nach oben sofort Gummiband abbrechen & Slider schließen!
          if (dy <= -HERO_BOUNCE_LOCK_MIN_DIST && heroTouchInstantVy <= -HERO_BOUNCE_LOCK_VELOCITY && Math.abs(dy) > Math.abs(dx) * 1.15) {
            heroTouchStartX = 0;
            heroTouchStartY = 0;
            heroTouchDraggingUp = false;
            setHeroRubberBandOffsetClient(0);
            const hintBtn = document.getElementById("heroScrollDownHintBtn");
            if (hintBtn) hintBtn.style.transform = "";
            window.__tmaHandleHeroSwipe("up", { bounceLock: true });
            return;
          }
          if (dy < -6) {
            heroTouchDraggingUp = true;
            const stageWrap = document.getElementById("heroStageWrapEl");
            if (stageWrap) {
              const heroH = Math.max(280, stageWrap.offsetHeight || window.innerHeight || 580);
              const absDy = Math.abs(dy);
              // Spürbarer logarithmischer Gummiband-Widerstand am unteren Slider-Rand
              const rubberPx = -Math.round(Math.min(38, Math.pow(absDy, 0.76) * 1.25));
              setHeroRubberBandOffsetClient(rubberPx);
              const dragFade = Math.max(0, Math.min(0.42, absDy / (heroH * 0.65)));
              stageWrap.style.setProperty("--hero-scroll-fade", dragFade.toFixed(3));
            }
            const hintBtn = document.getElementById("heroScrollDownHintBtn");
            if (hintBtn) {
              const ratio = Math.min(1, Math.abs(dy) / 90);
              hintBtn.style.transform = "translate3d(0, " + Math.round(ratio * 10) + "px, 0) scale(" + (1 + ratio * 0.14).toFixed(2) + ")";
            }
          }
        }
      }
      function onHeroTouchEnd(ev) {
        if (performance.now() < heroBounceLockUntil) {
          heroTouchStartX = 0;
          heroTouchStartY = 0;
          heroTouchDraggingUp = false;
          return;
        }
        if (!heroTouchStartX || !ev.changedTouches || !ev.changedTouches[0]) return;
        const dx = ev.changedTouches[0].clientX - heroTouchStartX;
        const dy = heroTouchStartY ? (ev.changedTouches[0].clientY - heroTouchStartY) : 0;
        const dt = Math.max(16, performance.now() - (heroTouchStartTime || performance.now()));
        const avgVy = dy / dt;
        const vy = Math.abs(heroTouchInstantVy) > Math.abs(avgVy) ? heroTouchInstantVy : avgVy;
        const wasDraggingUp = heroTouchDraggingUp;
        heroTouchStartX = 0;
        heroTouchStartY = 0;
        heroTouchDraggingUp = false;
        setHeroRubberBandOffsetClient(0);
        const hintBtn = document.getElementById("heroScrollDownHintBtn");
        if (hintBtn) hintBtn.style.transform = "";
        if (dy <= -HERO_BOUNCE_LOCK_MIN_DIST && vy <= -HERO_BOUNCE_LOCK_VELOCITY && Math.abs(dy) > Math.abs(dx) * 1.15) {
          window.__tmaHandleHeroSwipe("up", { bounceLock: true });
          return;
        }
        // Angenehm sanfter Übergang: Ab 56px Zugweg ODER kurzem Flick (mind. 36px + vy <= -0.45) in den Katalog wechseln
        if ((dy <= -56 || (dy <= -36 && vy <= -0.45)) && Math.abs(dy) > Math.abs(dx) * 1.12) {
          window.__tmaHandleHeroSwipe("up");
          return;
        }
        if (wasDraggingUp) {
          animateHeroCatalogSnapScrollClient(0);
          return;
        }
        if (Math.abs(dx) > 40 && Math.abs(dx) >= Math.abs(dy)) {
          clearHeroDescTransientFocusClient();
          window.__tmaHandleHeroSwipe(dx < 0 ? "left" : "right");
          return;
        }
        // Kurzes Antippen (<14px Bewegung) auf den freien Hintergrund im Hauptslider -> Direkt im Hauptslider Trailer einblenden und Text ausblenden!
        if (Math.abs(dx) < 14 && Math.abs(dy) < 14 && dt < 450 && Date.now() - lastHeroStageTapHandledAt > 420) {
          const el = resolveHeroEventTargetElementClient(ev.target);
          if (!el || !el.closest(".hero-foreground-stage-catcher")) {
            if (!isHeroInteractiveControlTargetClient(ev.target)) {
              lastHeroStageTapHandledAt = Date.now();
              enterHeroForegroundTrailerModeClient(ev, true);
            }
          }
        }
      }

      function resolveHeroSlideBackdropUrlClient(item) {
        if (!item) return "";
        const rawBp = String(item.backdrop_path || item.poster_path || "").trim();
        if (!rawBp) return "";
        if (rawBp.startsWith("http://") || rawBp.startsWith("https://")) return rawBp;
        const isTvMode = Boolean(typeof document !== "undefined" && document.body && document.body.getAttribute("data-device") === "tv");
        const bpSize = isTvMode ? "w780" : "w1280";
        return "https://image.tmdb.org/t/p/" + bpSize + (rawBp.startsWith("/") ? rawBp : ("/" + rawBp));
      }

      function resolveHeroSlidePosterUrlClient(item, size) {
        if (!item) return "";
        const isTvMode = Boolean(typeof document !== "undefined" && document.body && document.body.getAttribute("data-device") === "tv");
        let sz = size || "w342";
        if (isTvMode && sz === "w780") sz = "w500";
        const ext = String(item.external_poster_url || item.poster || "").trim();
        const rawP = String(item.poster_path || item.backdrop_path || "").trim();
        if (typeof resolvePosterUrlClient === "function") {
          return resolvePosterUrlClient(rawP, sz, ext);
        }
        if (ext && (ext.startsWith("http://") || ext.startsWith("https://"))) return ext;
        if (!rawP) return "";
        if (rawP.startsWith("http://") || rawP.startsWith("https://")) return rawP;
        return "https://image.tmdb.org/t/p/" + sz + (rawP.startsWith("/") ? rawP : ("/" + rawP));
      }

      const heroAmbilightColorCache = new Map();

      function boostAmbilightRgbTriplet(r, g, b) {
        let nr = Math.max(0, Math.min(255, Math.round(r)));
        let ng = Math.max(0, Math.min(255, Math.round(g)));
        let nb = Math.max(0, Math.min(255, Math.round(b)));
        const maxC = Math.max(nr, ng, nb);
        const minC = Math.min(nr, ng, nb);
        // Falls der Bildbereich sehr dunkel ist, sanft aufhellen für leuchtendes Ambilight
        if (maxC < 95) {
          const lift = maxC > 8 ? (115 / maxC) : 2.2;
          nr = Math.min(255, Math.round(nr * lift + 18));
          ng = Math.min(255, Math.round(ng * lift + 22));
          nb = Math.min(255, Math.round(nb * lift + 30));
        }
        // Sättigung leicht anheben, damit das Ambilight lebendig wirkt
        const avg = (nr + ng + nb) / 3;
        if (maxC - minC < 45) {
          nr = Math.min(255, Math.max(0, Math.round(avg + (nr - avg) * 1.65)));
          ng = Math.min(255, Math.max(0, Math.round(avg + (ng - avg) * 1.65)));
          nb = Math.min(255, Math.max(0, Math.round(avg + (nb - avg) * 1.65)));
        }
        return nr + ", " + ng + ", " + nb;
      }

      let _lastAppliedBodyAmbiSig = "";
      function applyDynamicHeroAmbilightClient(backdropUrl) {
        if (!backdropUrl) return;
        if (document.body && document.body.getAttribute("data-device") === "tv") return;
        const sampleUrl = String(backdropUrl).replace(/\\/t\\/p\\/(?:w1280|w780|original)\\//i, "/t/p/w300/");
        const applyPalette = (pal) => {
          if (!pal) return;
          const nextSig = pal.c1 + "|" + pal.c2 + "|" + pal.c3;
          if (document.body && _lastAppliedBodyAmbiSig !== nextSig) {
            _lastAppliedBodyAmbiSig = nextSig;
            document.body.style.setProperty("--ambi-1", pal.c1);
            document.body.style.setProperty("--ambi-2", pal.c2);
            document.body.style.setProperty("--ambi-3", pal.c3);
          }
          const target = document.getElementById("heroStageWrapEl") || document.querySelector(".hero-stage-wrap");
          if (target) {
            target.style.setProperty("--ambi-1", pal.c1);
            target.style.setProperty("--ambi-2", pal.c2);
            target.style.setProperty("--ambi-3", pal.c3);
            target.classList.toggle("hero-bright-backdrop", Boolean(pal.isBrightLeft));
          }
          const detailStage = document.getElementById("detailHeroStageEl");
          if (detailStage) {
            detailStage.style.setProperty("--ambi-1", pal.c1);
            detailStage.style.setProperty("--ambi-2", pal.c2);
            detailStage.style.setProperty("--ambi-3", pal.c3);
            detailStage.classList.toggle("hero-bright-backdrop", Boolean(pal.isBrightLeft));
          }
        };
        if (heroAmbilightColorCache.has(sampleUrl)) {
          applyPalette(heroAmbilightColorCache.get(sampleUrl));
          return;
        }
        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.referrerPolicy = "no-referrer";
          img.decoding = "async";
          img.onload = function () {
            try {
              const canvas = document.createElement("canvas");
              const w = 24;
              const h = 14;
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext("2d");
              if (!ctx) return;
              ctx.drawImage(img, 0, 0, w, h);
              const data = ctx.getImageData(0, 0, w, h).data;
              const sampleZone = (xStart, xEnd, yStart, yEnd) => {
                let rSum = 0, gSum = 0, bSum = 0, weightSum = 0;
                for (let y = yStart; y < yEnd; y++) {
                  for (let x = xStart; x < xEnd; x++) {
                    const idx = (y * w + x) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    const lum = (r + g + b) / 3;
                    const sat = Math.max(r, g, b) - Math.min(r, g, b);
                    const weight = 1 + (sat / 85) + (lum > 25 && lum < 235 ? 0.6 : 0.15);
                    rSum += r * weight;
                    gSum += g * weight;
                    bSum += b * weight;
                    weightSum += weight;
                  }
                }
                if (!weightSum) return "14, 165, 233";
                return boostAmbilightRgbTriplet(rSum / weightSum, gSum / weightSum, bSum / weightSum);
              };
              // Helligkeits-Messung im linken Textbereich (für extrem helle Szenen wie Interstellar-Eis)
              let leftLumSum = 0, leftLumCount = 0;
              for (let y = 3; y < 13; y++) {
                for (let x = 0; x < 11; x++) {
                  const idx = (y * w + x) * 4;
                  leftLumSum += (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
                  leftLumCount++;
                }
              }
              const avgLeftLum = leftLumCount > 0 ? (leftLumSum / leftLumCount) : 60;
              const centerMain = sampleZone(5, 19, 1, 11);
              const centerAccent = sampleZone(6, 18, 2, 10);
              const palette = {
                c1: centerMain,
                c2: centerAccent,
                c3: centerMain,
                isBrightLeft: avgLeftLum > 136
              };
              if (typeof setLruMapEntryClient === "function") {
                setLruMapEntryClient(heroAmbilightColorCache, sampleUrl, palette, 30);
              } else {
                heroAmbilightColorCache.set(sampleUrl, palette);
              }
              applyPalette(palette);
            } catch (_e) {}
          };
          img.src = sampleUrl;
        } catch (_err) {}
      }

      function selectHeroGenreFilter(genreId) {
        triggerTmaHapticClient("selection");
        const val = String(genreId || "all");
        const sel = document.getElementById("searchGenreSelect");
        if (sel) sel.value = val;
        onSearchGenreSelectChange(val);
      }

      function resolveHeroGenreItemsClient(hero, isMovie) {
        if (!hero) return [];
        const primaryMap = isMovie ? MOVIE_GENRES_CLIENT : SERIES_GENRES_CLIENT;
        const secondaryMap = isMovie ? SERIES_GENRES_CLIENT : MOVIE_GENRES_CLIENT;
        const idToName = new Map();
        const nameToId = new Map();
        const addEntries = (obj) => {
          if (!obj || typeof obj !== "object") return;
          Object.entries(obj).forEach(([gName, gId]) => {
            idToName.set(String(gId), gName);
            nameToId.set(String(gName).toLowerCase(), String(gId));
          });
        };
        addEntries(secondaryMap);
        addEntries(primaryMap);
        addEntries(state.genres);

        const out = [];
        const seen = new Set();
        const rawList = Array.isArray(hero.genre_ids) && hero.genre_ids.length
          ? hero.genre_ids
          : (Array.isArray(hero.genres) ? hero.genres : []);

        for (const entry of rawList) {
          let gId = "";
          let gName = "";
          if (entry && typeof entry === "object") {
            gId = String(entry.id || "");
            gName = String(entry.name || "");
            if (!gName && gId && idToName.has(gId)) gName = idToName.get(gId);
            if (!gId && gName && nameToId.has(gName.toLowerCase())) gId = nameToId.get(gName.toLowerCase());
          } else if (typeof entry === "number" || (typeof entry === "string" && /^\\d+$/.test(entry.trim()))) {
            gId = String(entry).trim();
            gName = idToName.get(gId) || "";
          } else if (typeof entry === "string" && entry.trim()) {
            gName = entry.trim();
            gId = nameToId.get(gName.toLowerCase()) || "";
          }
          if (gName && !seen.has(gName.toLowerCase())) {
            seen.add(gName.toLowerCase());
            out.push({ id: gId, name: gName });
            if (out.length >= 3) break;
          }
        }
        return out;
      }

      function buildHeroMetaLineInnerHtml(hero, isMovie, voteStr, yearStr) {
        const genres = resolveHeroGenreItemsClient(hero, isMovie);
        const genresHtml = genres.length
          ? '<span class="hero-meta-sep">·</span><span class="hero-meta-genres">' +
              genres.map((g, idx) =>
                (g.id
                  ? '<span class="hero-meta-genre" onclick="selectHeroGenreFilter(\\'' + escJs(g.id) + '\\')" title="Nach Genre ' + esc(g.name) + ' filtern">' + esc(g.name) + '</span>'
                  : '<span>' + esc(g.name) + '</span>') +
                (idx < genres.length - 1 ? '<span>, </span>' : '')
              ).join("") +
            '</span>'
          : '';
        return '<span><span class="hero-meta-star">★</span> ' + voteStr + '</span>' +
          (yearStr ? '<span class="hero-meta-sep">·</span><span class="hero-meta-year" onclick="runSearch(false,\\'(' + escJs(yearStr) + ')\\')" title="Alle Titel aus dem Jahr ' + esc(yearStr) + ' suchen">' + esc(yearStr) + '</span>' : '') +
          '<span class="hero-meta-sep">·</span><span>' + (isMovie ? 'Film' : 'Serie') + '</span>' +
          '<span class="hero-meta-sep">·</span><span class="hero-meta-hd" title="Im Katalog in HD verfügbar">HD</span>' +
          genresHtml;
      }

      function syncHeroExpandedBodyClass() {
        if (!document.body) return;
        const isExp = Boolean(isHeroStageAvailableForCurrentViewClient());
        if (document.body.classList.contains("hero-slider-expanded") !== isExp) {
          document.body.classList.toggle("hero-slider-expanded", isExp);
        }
        const inFrontHero = typeof isUserInHeroSliderFront === "function" ? isUserInHeroSliderFront() : false;
        if (typeof isUserInHeroSliderFront === "function") {
          document.body.classList.toggle("in-hero-slider", inFrontHero);
        }
        if ((inFrontHero || (isExp && !document.body.classList.contains("hero-scrolled-past"))) && typeof syncCatalogFocusInfoBarClient === "function") {
          syncCatalogFocusInfoBarClient(null);
        }
        if (typeof syncSmartPageIndicatorDomClient === "function") {
          syncSmartPageIndicatorDomClient(false);
        }
      }

      const clientClearLogoCache = new Map();
      const clientDecodedClearLogoUrls = new Set();
      const clientClearLogoPreloadPromises = new Map();
      const clientClearLogoFetchPromises = new Map();

      (function hydratePersistedClearLogoCacheClient() {
        try {
          const raw = localStorage.getItem("tma_clearlogo_map_v1");
          if (!raw) return;
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            for (const [k, v] of Object.entries(parsed)) {
              if (k && typeof v === "string") {
                clientClearLogoCache.set(k, v);
              }
            }
          }
        } catch (_e) {}
      })();

      let persistClearLogoTimer = null;
      function schedulePersistClearLogoCacheClient() {
        if (persistClearLogoTimer) return;
        persistClearLogoTimer = setTimeout(() => {
          persistClearLogoTimer = null;
          try {
            const entries = Array.from(clientClearLogoCache.entries()).slice(-300);
            const obj = {};
            for (const [k, v] of entries) {
              obj[k] = v;
            }
            localStorage.setItem("tma_clearlogo_map_v1", JSON.stringify(obj));
          } catch (_e) {}
        }, 450);
      }

      function resolveClearLogoUrlClient(logoPath) {
        const clean = String(logoPath || "").trim();
        if (!clean) return "";
        if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
        return "https://image.tmdb.org/t/p/w500" + (clean.startsWith("/") ? clean : ("/" + clean));
      }

      function preloadClearLogoBitmapClient(logoPathOrUrl) {
        const logoUrl = resolveClearLogoUrlClient(logoPathOrUrl);
        if (!logoUrl) return Promise.resolve(false);
        if (clientDecodedClearLogoUrls.has(logoUrl)) return Promise.resolve(true);
        if (clientClearLogoPreloadPromises.has(logoUrl)) {
          return clientClearLogoPreloadPromises.get(logoUrl);
        }
        const p = new Promise((resolve) => {
          let settled = false;
          const finish = (ok) => {
            if (settled) return;
            settled = true;
            clientClearLogoPreloadPromises.delete(logoUrl);
            if (ok) clientDecodedClearLogoUrls.add(logoUrl);
            resolve(Boolean(ok));
          };
          const timer = setTimeout(() => finish(false), 3500);
          try {
            const img = new Image();
            img.decoding = "async";
            img.onload = () => {
              clearTimeout(timer);
              if (typeof img.decode === "function") {
                img.decode().then(() => finish(true)).catch(() => finish(true));
              } else {
                finish(true);
              }
            };
            img.onerror = () => {
              clearTimeout(timer);
              finish(false);
            };
            img.src = logoUrl;
          } catch (_err) {
            clearTimeout(timer);
            finish(false);
          }
        });
        clientClearLogoPreloadPromises.set(logoUrl, p);
        return p;
      }

      function onClearLogoImgLoadSuccessClient(imgEl) {
        if (!imgEl) return;
        const src = String(imgEl.getAttribute("src") || imgEl.src || "").trim();
        if (src) clientDecodedClearLogoUrls.add(src);
        const wrap = imgEl.closest ? imgEl.closest(".cinema-clear-logo-wrap") : imgEl.parentElement;
        if (wrap) {
          wrap.classList.remove("is-logo-loading");
          wrap.classList.add("is-logo-ready");
          const fb = wrap.querySelector(".cinema-clear-logo-fallback-title");
          if (fb) fb.style.setProperty("display", "none", "important");
        }
      }

      function onClearLogoImgErrorClient(imgEl) {
        if (!imgEl || !imgEl.parentElement) return;
        const altText = esc(imgEl.getAttribute("alt") || "Titel");
        const wrap = imgEl.closest ? imgEl.closest(".cinema-clear-logo-wrap") : imgEl.parentElement;
        if (wrap) {
          wrap.outerHTML =
            '<div id="heroTitleMarqueeWrap" class="inline-marquee-wrap" data-marquee-always="1">' +
              '<span id="heroTitleTextEl" class="inline-marquee-text hero-title-text">' + altText + '</span>' +
            '</div>';
        }
      }

      function buildHeroTitleOrLogoInnerHtmlClient(titleRaw, logoPath, clickAttr = "") {
        const safeTitle = esc(String(titleRaw || "Titel"));
        const logoUrl = resolveClearLogoUrlClient(logoPath);
        const clickProp = clickAttr ? (' onclick="' + clickAttr + '" style="cursor:pointer" title="Nach „' + safeTitle + '“ suchen"') : '';
        if (logoUrl) {
          const isReady = clientDecodedClearLogoUrls.has(logoUrl);
          return '<div class="cinema-clear-logo-wrap ' + (isReady ? 'is-logo-ready' : 'is-logo-loading') + '"' + clickProp + '>' +
            '<div class="cinema-clear-logo-fallback-title inline-marquee-wrap" data-marquee-always="1"' + (isReady ? ' style="display:none !important"' : '') + '>' +
              '<span class="inline-marquee-text hero-title-text">' + safeTitle + '</span>' +
            '</div>' +
            '<img class="cinema-clear-logo" src="' + esc(logoUrl) + '" alt="' + safeTitle + '" decoding="async" draggable="false" onload="onClearLogoImgLoadSuccessClient(this)" onerror="onClearLogoImgErrorClient(this)" />' +
          '</div>';
        }
        return '<div id="heroTitleMarqueeWrap" class="inline-marquee-wrap" data-marquee-always="1"' + clickProp + '>' +
          '<span id="heroTitleTextEl" class="inline-marquee-text hero-title-text">' + safeTitle + '</span>' +
        '</div>';
      }

      async function ensureHeroSlideClearLogoClient(hero, heroType) {
        if (!hero || !hero.id || Number(hero.id) >= 8000000) return "";
        const normType = heroType === "s" ? "s" : "m";
        const key = normType + "_" + Number(hero.id);
        let lp = String(hero.logo_path || "").trim();
        if (!lp && clientClearLogoCache.has(key)) {
          lp = String(clientClearLogoCache.get(key) || "").trim();
          hero.logo_path = lp;
        }
        if (lp) {
          clientClearLogoCache.set(key, lp);
          const ready = await preloadClearLogoBitmapClient(lp);
          if (ready) {
            const activeHero = state.heroSlides && (state.heroSlides[state.heroIndex] || state.heroSlides[0]);
            if (activeHero && String(activeHero.id) === String(hero.id)) {
              const heroTitleBox = document.getElementById("heroTitleBoxEl");
              if (heroTitleBox) {
                heroTitleBox.innerHTML = buildHeroTitleOrLogoInnerHtmlClient(hero.title || hero.name || "", lp);
              }
            }
          }
          return lp;
        }
        if (clientClearLogoCache.has(key)) {
          return "";
        }
        if (clientClearLogoFetchPromises.has(key)) {
          return clientClearLogoFetchPromises.get(key);
        }
        const fetchPromise = (async () => {
          try {
            const r = await apiFetchJson(API_BASE + "/logo?type=" + encodeURIComponent(normType) + "&id=" + encodeURIComponent(hero.id));
            const fetchedLp = String(r?.logo_path || "").trim();
            clientClearLogoCache.set(key, fetchedLp);
            schedulePersistClearLogoCacheClient();
            hero.logo_path = fetchedLp;
            if (!fetchedLp) return "";
            // Zuerst das PNG-Bild komplett im Browser-RAM vorladen & dekodieren, BEVOR das Text-Logo im Slider ersetzt wird (0ms leeres Feld!)
            const ready = await preloadClearLogoBitmapClient(fetchedLp);
            if (!ready) return "";
            const activeHero = state.heroSlides && (state.heroSlides[state.heroIndex] || state.heroSlides[0]);
            if (activeHero && String(activeHero.id) === String(hero.id)) {
              const heroTitleBox = document.getElementById("heroTitleBoxEl");
              if (heroTitleBox) {
                heroTitleBox.innerHTML = buildHeroTitleOrLogoInnerHtmlClient(hero.title || hero.name || "", fetchedLp);
              }
            }
            return fetchedLp;
          } catch (_e) {
            return "";
          } finally {
            clientClearLogoFetchPromises.delete(key);
          }
        })();
        clientClearLogoFetchPromises.set(key, fetchPromise);
        return fetchPromise;
      }

      function prewarmAllHeroSlidesClearLogosClient() {
        if (!Array.isArray(state.heroSlides) || state.heroSlides.length === 0) return;
        const missingKeys = [];
        const slideByKey = new Map();
        state.heroSlides.forEach((sl) => {
          if (!sl || !sl.id || Number(sl.id) >= 8000000) return;
          const slType = sl.media_type === "tv" || state.type === "s" ? "s" : "m";
          const key = slType + "_" + Number(sl.id);
          slideByKey.set(key, sl);
          const existingLp = String(sl.logo_path || "").trim() || (clientClearLogoCache.has(key) ? String(clientClearLogoCache.get(key) || "").trim() : "");
          if (existingLp) {
            sl.logo_path = existingLp;
            clientClearLogoCache.set(key, existingLp);
            preloadClearLogoBitmapClient(existingLp);
          } else if (!clientClearLogoCache.has(key) && !clientClearLogoFetchPromises.has(key)) {
            missingKeys.push(key);
          }
        });
        const uniqMissing = Array.from(new Set(missingKeys)).slice(0, 8);
        if (uniqMissing.length === 0) return;

        // 1 einziger gebündelter Batch-Call (/api/tma/logos) statt 6 separater /api/tma/logo Requests!
        const batchPromise = (async () => {
          try {
            const res = await apiFetchJson(API_BASE + "/logos?items=" + encodeURIComponent(uniqMissing.join(",")));
            const logosMap = (res && res.logos && typeof res.logos === "object") ? res.logos : {};
            let cacheDirty = false;
            const activeHero = state.heroSlides && (state.heroSlides[state.heroIndex] || state.heroSlides[0]);
            for (const key of uniqMissing) {
              const fetchedLp = String(logosMap[key] || "").trim();
              clientClearLogoCache.set(key, fetchedLp);
              cacheDirty = true;
              const sl = slideByKey.get(key);
              if (sl) sl.logo_path = fetchedLp;
              if (fetchedLp) {
                preloadClearLogoBitmapClient(fetchedLp).then((ready) => {
                  if (!ready || !sl) return;
                  const curActive = state.heroSlides && (state.heroSlides[state.heroIndex] || state.heroSlides[0]);
                  if (curActive && String(curActive.id) === String(sl.id)) {
                    const heroTitleBox = document.getElementById("heroTitleBoxEl");
                    if (heroTitleBox) {
                      heroTitleBox.innerHTML = buildHeroTitleOrLogoInnerHtmlClient(sl.title || sl.name || "", fetchedLp);
                    }
                  }
                });
              }
            }
            if (cacheDirty) schedulePersistClearLogoCacheClient();
            return logosMap;
          } catch (_e) {
            return {};
          } finally {
            for (const key of uniqMissing) {
              clientClearLogoFetchPromises.delete(key);
            }
          }
        })();
        for (const key of uniqMissing) {
          clientClearLogoFetchPromises.set(key, batchPromise.then(m => String((m && m[key]) || "")));
        }
      }

      // Gemeinsame, wiederverwendbare Stage-Beschreibungsbox für Hero-Slider, Such-Hero & Detailseite (Single Source of Truth)
      function buildUnifiedStageDescriptionBoxHtmlClient(opts) {
        const boxId = String(opts?.boxId || "heroDescEl");
        const textId = String(opts?.textId || "heroDescTextEl");
        const translateBtnId = String(opts?.translateBtnId || "heroDescTranslateBtn");
        const translateTargetKey = String(opts?.translateTargetKey || "activeDetails");
        const overviewText = String(opts?.overviewText || "").trim();
        const rawOrigOverview = String(opts?.rawOrigOverview || "").trim();
        const showTransBtn = typeof isLikelyEnglishOverviewClient === "function" && isLikelyEnglishOverviewClient(rawOrigOverview);
        const isTranslated = Boolean(opts?.isTranslated);
        const alwaysRenderBtn = Boolean(opts?.alwaysRenderTranslateBtn);
        const transBtnHtml = (alwaysRenderBtn || showTransBtn)
          ? '<button type="button" id="' + esc(translateBtnId) + '" class="desc-translate-btn' + (isTranslated ? ' is-translated' : '') + '"' +
              (alwaysRenderBtn ? (' style="display:' + (showTransBtn ? 'inline-flex' : 'none') + '"') : '') +
              ' onclick="translateOverviewTextClient(event,\\'' + escJs(translateTargetKey) + '\\',\\'' + escJs(boxId) + '\\',\\'' + escJs(textId) + '\\',\\'' + escJs(translateBtnId) + '\\')" title="Englische Beschreibung direkt auf Deutsch übersetzen">' +
              (isTranslated ? '🇬🇧 Original anzeigen' : '🌐 Auf Deutsch übersetzen') +
            '</button>'
          : '';
        return '<div id="' + esc(boxId) + '" class="hero-desc expandable-desc-box" tabindex="0" role="button" aria-expanded="false" onclick="toggleExpandableDescriptionClient(event,\\'' + escJs(boxId) + '\\')" onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();toggleExpandableDescriptionClient(event,\\'' + escJs(boxId) + '\\');}">' +
          '<div id="' + esc(textId) + '" class="expandable-desc-scroll" data-orig-overview="' + esc(rawOrigOverview) + '">' + esc(overviewText) + '</div>' +
          '<div class="desc-actions-row">' +
            '<span class="desc-expand-hint">▾ Mehr lesen</span>' +
            transBtnHtml +
          '</div>' +
        '</div>';
      }

      function getHeroStageKickerTextClient() {
        if (state.isSearchMode && state.searchQuery) {
          return 'SUCH-HIGHLIGHT · „' + String(state.searchQuery).trim() + '“';
        }
        return "HIGHLIGHT DIESE WOCHE";
      }

      function buildHeroBannerInnerHtml() {
        syncHeroExpandedBodyClass();
        syncHeroSearchPlaceholderAndToggleBtnClient();
        if (!Array.isArray(state.heroSlides) || !state.heroSlides.length) return "";
        if (state.isSearchMode && (!Array.isArray(state.items) || state.items.length < 2)) return "";
        const hero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
        if (!hero) return "";
        const heroType = hero.media_type === "tv" || state.type === "s" ? "s" : "m";
        const isMovie = heroType === "m";
        const yearStr = (hero.release_date || hero.first_air_date || "").slice(0, 4);
        const voteStr = hero.vote_average ? hero.vote_average.toFixed(1) : "–";
        const heroTitleRaw = String(hero.title || hero.name || "");
        const heroTitleSafe = esc(heroTitleRaw);
        const heroPosterSafe = esc(hero.poster_path || hero.external_poster_url || hero.poster || "");
        const isTvDeviceHeroInit = Boolean(document.body && document.body.dataset && document.body.dataset.device === "tv");
        const backdropUrl = resolveHeroSlideBackdropUrlClient(hero);
        const posterUrl = isTvDeviceHeroInit ? "" : (resolveHeroSlidePosterUrlClient(hero, "w780") || backdropUrl);
        const heroCardKey = heroType + "_" + hero.id;
        const isHeroSaved = typeof savedKeysSet !== "undefined" && savedKeysSet.has(heroCardKey);
        const cachedAmbi = (!isTvDeviceHeroInit && backdropUrl && heroAmbilightColorCache.has(backdropUrl))
          ? heroAmbilightColorCache.get(backdropUrl)
          : null;
        if (!isTvDeviceHeroInit) {
          if (backdropUrl && !cachedAmbi) {
            setTimeout(() => applyDynamicHeroAmbilightClient(backdropUrl), 25);
          } else if (cachedAmbi && document.body) {
            document.body.style.setProperty("--ambi-1", cachedAmbi.c1);
            document.body.style.setProperty("--ambi-2", cachedAmbi.c2);
            document.body.style.setProperty("--ambi-3", cachedAmbi.c3);
          }
        }
        const ambiStyleVars = (!isTvDeviceHeroInit && cachedAmbi)
          ? ('--ambi-1:' + cachedAmbi.c1 + ';--ambi-2:' + cachedAmbi.c2 + ';--ambi-3:' + cachedAmbi.c3 + ';')
          : '';
        const hasRealBackdrop = Boolean(String(hero.backdrop_path || "").trim());
        const posterFallbackClass = hasRealBackdrop ? "" : " is-poster-fallback";
        const brightClass = (!isTvDeviceHeroInit && cachedAmbi && cachedAmbi.isBrightLeft) ? ' hero-bright-backdrop' : '';
        const collapsedClass = (state.heroHidden || heroCurtainScrolledToCatalog) ? ' is-collapsed' : '';
        const layerAStyle = (backdropUrl ? ('--hero-bg-landscape:url(' + esc(backdropUrl) + ');') : '--hero-bg-landscape:none;') +
          (posterUrl ? ('--hero-bg-portrait:url(' + esc(posterUrl) + ');') : '--hero-bg-portrait:none;');

        const thumbsNavHtml = state.heroSlides.length > 1
          ? '<div class="hero-dots-nav">' +
              '<button type="button" id="heroPrevArrowBtn" class="hero-circle-arrow" onclick="setHeroSlideIndex(' + (state.heroIndex - 1) + ')" title="Vorheriges Highlight (Pfeiltaste Links)">‹</button>' +
              '<div class="hero-dots-track">' +
                state.heroSlides.map((sl, i) => {
                  const slTitle = String(sl.title || sl.name || "");
                  const isAct = i === state.heroIndex;
                  return '<button type="button" class="hero-dot ' + (isAct ? 'active' : '') + '" data-hero-card="' + i + '" onclick="selectHeroSlideCard(' + i + ')" aria-label="Highlight ' + (i + 1) + ': ' + esc(slTitle) + '" title="' + (i + 1) + '. ' + esc(slTitle) + '">' +
                    '<div class="hero-thumb-progress"><div class="hero-thumb-progress-fill"></div></div>' +
                  '</button>';
                }).join("") +
              '</div>' +
              '<button type="button" id="heroNextArrowBtn" class="hero-circle-arrow" onclick="setHeroSlideIndex(' + (state.heroIndex + 1) + ')" title="Nächstes Highlight (Pfeiltaste Rechts)">›</button>' +
            '</div>'
          : '';

        requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient());
        setTimeout(() => scheduleHeroBackgroundVideoTeaserClient(false), 60);

        const ambilightLayersHtml = isTvDeviceHeroInit
          ? ''
          : ('<div id="heroAmbilightEl" class="hero-ambilight-glow" style="' + layerAStyle + '"></div>' +
             '<div id="heroAmbilightBeamsEl" class="hero-ambilight-beams"></div>');

        return '<div id="heroCurtainShell" class="hero-curtain-shell' + collapsedClass + '">' +
          '<div class="hero-curtain-inner">' +
            '<div id="heroStageWrapEl" class="hero-stage-wrap' + brightClass + '" style="' + ambiStyleVars + '">' +
              ambilightLayersHtml +
              '<div id="heroStageEl" class="hero" onmouseenter="setHeroPointerHover(true)" onmouseleave="setHeroPointerHover(false)" onmousedown="onHeroMouseDown(event)" ontouchstart="onHeroTouchStart(event)" ontouchmove="onHeroTouchMove(event)" ontouchend="onHeroTouchEnd(event)">' +
                '<div id="heroBackdropLayerA" class="hero-backdrop-layer active-layer' + posterFallbackClass + '" style="' + layerAStyle + '"></div>' +
                '<div id="heroBackdropLayerB" class="hero-backdrop-layer" style="--hero-bg-landscape:none;--hero-bg-portrait:none"></div>' +
                '<div id="heroBgVideoLayer" class="detail-bg-video-layer hero-bg-video-layer"></div>' +
                '<div class="hero-scrim-layer"></div>' +
                '<div id="heroScrollDimOverlay" class="hero-scroll-dim-overlay"></div>' +
                '<div class="hero-inner">' +
                  '<div class="hero-widescreen-body">' +
                    '<div id="heroContentEl" class="hero-content">' +
                      '<div id="heroKickerEl" class="hero-kicker">' + esc(getHeroStageKickerTextClient()) + '</div>' +
                      '<div id="heroTitleBoxEl" class="hero-title">' +
                        buildHeroTitleOrLogoInnerHtmlClient(heroTitleRaw, hero.logo_path || clientClearLogoCache.get(heroCardKey) || "") +
                      '</div>' +
                      '<div id="heroMetaCleanEl" class="hero-meta-clean">' +
                        buildHeroMetaLineInnerHtml(hero, isMovie, voteStr, yearStr) +
                      '</div>' +
                      buildUnifiedStageDescriptionBoxHtmlClient({
                        boxId: "heroDescEl",
                        textId: "heroDescTextEl",
                        translateBtnId: "heroDescTranslateBtn",
                        translateTargetKey: heroCardKey,
                        overviewText: resolveHeroOverviewTextClient(hero, isMovie),
                        rawOrigOverview: String(hero._originalOverviewEn || hero.overview || "").trim(),
                        isTranslated: Boolean(hero._showTranslatedOverviewDe && hero._translatedOverviewDe),
                        alwaysRenderTranslateBtn: true
                      }) +
                      '<div id="heroActionsBox" class="hero-actions-box ' + (state.heroActionsEngaged ? 'engaged' : '') + '">' +
                        '<button type="button" id="heroBtnTrailer" class="hero-btn-play hero-action-btn' + (hero._trailerChecked && hero._hasEmbeddableTrailer === false ? ' is-trailer-unavailable' : '') + '" onclick="enterHeroForegroundTrailerModeClient(event,false)" title="' + (hero._trailerChecked && hero._hasEmbeddableTrailer === false ? 'Kein direkt abspielbarer Trailer verfügbar – YouTube-Suche öffnen' : 'Trailer direkt im Hauptslider einblenden') + '">' + (hero._trailerChecked && hero._hasEmbeddableTrailer === false ? '🔎 Trailer suchen' : '▶ Trailer') + '</button>' +
                        '<button type="button" id="heroBtnDetails" class="hero-btn-info hero-action-btn" onclick="openDetails(\\''+ heroType +'\\',' + hero.id + ')">ⓘ Details</button>' +
                        '<button type="button" id="heroBtnWishlist" class="hero-btn-wishlist hero-action-btn ' + (isHeroSaved ? 'saved' : '') + '" data-hero-wl-key="' + heroCardKey + '" onclick="quickToggleCardWishlist(event,\\'' + heroType + '\\',' + hero.id + ')" title="' + (isHeroSaved ? 'Aus deiner Merkliste entfernen' : 'Direkt in deiner Merkliste speichern') + '">' + (isHeroSaved ? '✓ Gespeichert' : '＋ Speichern') + '</button>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="hero-bottom-bar">' +
                    thumbsNavHtml +
                    '<button type="button" id="heroScrollDownHintBtn" tabindex="-1" class="hero-scroll-down-hint" onclick="scrollToCatalogBelowHeroClient(event)" title="Nach unten zu allen Treffern & Covern gleiten" aria-label="Nach unten zu allen Treffern & Covern gleiten">' +
                      '<span id="heroScrollDownHintLabel" class="hero-scroll-down-label">' + (state.isSearchMode ? '🔍 Zu allen Suchergebnissen' : '🍿 Zum Katalog') + '</span>' +
                      '<svg class="hero-scroll-down-chevron" viewBox="0 0 24 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                        '<path d="M2.5 2.25L12 10.75L21.5 2.25" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
                      '</svg>' +
                    '</button>' +
                  '</div>' +
                '</div>' +
                buildCinemaPlayerOverlayHtmlClient({
                  mode: "hero",
                  title: heroTitleRaw,
                  year: yearStr,
                  hasVipStreams: true,
                  autoOpenTrailer: false
                }) +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }

      function updateHeroBannerDomOnly(forceFullRebuild) {
        syncHeroExpandedBodyClass();
        syncHeroSearchPlaceholderAndToggleBtnClient();
        const container = document.getElementById("heroBannerSlot");
        if (!container) return;
        const prevHeroFocusId = (typeof currentSpatialEl !== "undefined" && currentSpatialEl && (container.contains(currentSpatialEl) || currentSpatialEl.id === "heroHideBtn"))
          ? (currentSpatialEl.id || (currentSpatialEl.classList.contains("hero-dot") ? "dot" : ""))
          : "";

        const curtainEl = document.getElementById("heroCurtainShell");
        if (curtainEl) {
          curtainEl.classList.toggle("is-collapsed", Boolean(state.heroHidden || heroCurtainScrolledToCatalog));
        }
        const existingStage = container.querySelector(".hero");
        const layerA = document.getElementById("heroBackdropLayerA");
        const layerB = document.getElementById("heroBackdropLayerB");

        // Butterweicher 0,5s In-Place Crossfade & Tiefen-Gleiten (ohne Zittern) + dynamisches Ambilight-Update + Hochkant-Cover
        if (!forceFullRebuild && state.heroSlides.length > 0 && (!state.isSearchMode || (Array.isArray(state.items) && state.items.length >= 2)) && existingStage && layerA && layerB) {
          const hero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
          if (hero) {
            const heroType = hero.media_type === "tv" || state.type === "s" ? "s" : "m";
            const isMovie = heroType === "m";
            const yearStr = (hero.release_date || hero.first_air_date || "").slice(0, 4);
            const voteStr = hero.vote_average ? hero.vote_average.toFixed(1) : "–";
            const heroTitleRaw = String(hero.title || hero.name || "");
            const heroTitleSafe = esc(heroTitleRaw);
            const heroPosterSafe = esc(hero.poster_path || hero.external_poster_url || hero.poster || "");
            const backdropUrl = resolveHeroSlideBackdropUrlClient(hero);
            const posterUrl = resolveHeroSlidePosterUrlClient(hero, "w780") || backdropUrl;
            const hasRealBackdrop = Boolean(String(hero.backdrop_path || "").trim());
            const heroCardKey = heroType + "_" + hero.id;
            const isHeroSaved = typeof savedKeysSet !== "undefined" && savedKeysSet.has(heroCardKey);

            // 1. Dynamisches Ambilight (Farb-Extraktion + Backdrop/Poster-Halo hinter der Top-Leiste + Helligkeits-Check) + 0,5s Crossfade
            const isTvDeviceHero = Boolean(document.body && document.body.dataset && document.body.dataset.device === "tv");
            if (!isTvDeviceHero) {
              const ambiEl = document.getElementById("heroAmbilightEl");
              if (ambiEl) {
                ambiEl.style.setProperty("--hero-bg-landscape", backdropUrl ? ("url(" + backdropUrl + ")") : "none");
                ambiEl.style.setProperty("--hero-bg-portrait", posterUrl ? ("url(" + posterUrl + ")") : "none");
              }
              if (backdropUrl) {
                applyDynamicHeroAmbilightClient(backdropUrl);
              }
            }
            const activeLayer = layerA.classList.contains("active-layer") ? layerA : layerB;
            const nextLayer = activeLayer === layerA ? layerB : layerA;
            nextLayer.classList.remove("active-layer");
            nextLayer.classList.toggle("is-poster-fallback", !hasRealBackdrop);
            nextLayer.style.setProperty("--hero-bg-landscape", backdropUrl ? ("url(" + backdropUrl + ")") : "none");
            nextLayer.style.setProperty("--hero-bg-portrait", posterUrl ? ("url(" + posterUrl + ")") : "none");
            void nextLayer.offsetWidth;
            nextLayer.classList.add("active-layer");
            activeLayer.classList.remove("active-layer");

            // 2. Content, Kicker, Genres, HD-Badge & Merkliste-Button sanft aktualisieren
            const contentEl = document.getElementById("heroContentEl");
            if (contentEl) {
              contentEl.classList.add("hero-fade-step");
              setTimeout(() => contentEl.classList.remove("hero-fade-step"), 60);
            }
            const kickerEl = document.getElementById("heroKickerEl");
            if (kickerEl) {
              kickerEl.textContent = getHeroStageKickerTextClient();
            }
            const scrollHintLbl = document.getElementById("heroScrollDownHintLabel");
            if (scrollHintLbl) {
              scrollHintLbl.textContent = state.isSearchMode ? "🔍 Zu allen Suchergebnissen" : "🍿 Zum Katalog";
            }

            const heroLogoPath = hero.logo_path || clientClearLogoCache.get(heroCardKey) || "";
            const heroTitleBox = document.getElementById("heroTitleBoxEl");
            if (heroTitleBox) {
              heroTitleBox.innerHTML = buildHeroTitleOrLogoInnerHtmlClient(heroTitleRaw, heroLogoPath);
            } else {
              const titleWrap = document.getElementById("heroTitleMarqueeWrap");
              const titleTextEl = document.getElementById("heroTitleTextEl");
              if (titleWrap && typeof deactivateInlineTextMarquee === "function") {
                deactivateInlineTextMarquee(titleWrap);
              }
              if (titleTextEl) {
                titleTextEl.textContent = heroTitleRaw;
              }
            }
            ensureHeroSlideClearLogoClient(hero, heroType);
            const metaEl = document.getElementById("heroMetaCleanEl");
            if (metaEl) {
              metaEl.innerHTML = buildHeroMetaLineInnerHtml(hero, isMovie, voteStr, yearStr);
            }
            const descEl = document.getElementById("heroDescEl");
            const descTextEl = document.getElementById("heroDescTextEl");
            const rawOverview = resolveHeroOverviewTextClient(hero, isMovie);
            const rawOrigOv = String(hero._originalOverviewEn || hero.overview || "").trim();
            const showTransBtn = isLikelyEnglishOverviewClient(rawOrigOv);
            const isCurrentlyTranslated = Boolean(hero._showTranslatedOverviewDe && hero._translatedOverviewDe);
            if (descTextEl) {
              descTextEl.textContent = rawOverview;
              descTextEl.setAttribute("data-orig-overview", rawOrigOv);
              descTextEl.scrollTop = 0;
            } else if (descEl) {
              descEl.textContent = rawOverview;
            }
            if (descEl) {
              descEl.classList.remove("is-expanded", "is-long-desc", "spatial-focus");
              descEl.setAttribute("aria-expanded", "false");
              if (document.activeElement === descEl && typeof descEl.blur === "function") {
                try { descEl.blur(); } catch (_e) {}
              }
              const hintEl = descEl.querySelector(".desc-expand-hint");
              if (hintEl) hintEl.textContent = "▾ Mehr lesen";
              syncExpandableDescriptionsOverflowClient(descEl);
              requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(descEl));
            }
            const transBtn = document.getElementById("heroDescTranslateBtn");
            if (transBtn) {
              transBtn.style.display = showTransBtn ? "inline-flex" : "none";
              transBtn.classList.toggle("is-translated", isCurrentlyTranslated);
              transBtn.innerHTML = isCurrentlyTranslated ? "🇬🇧 Original anzeigen" : "🌐 Auf Deutsch übersetzen";
              transBtn.setAttribute("onclick", "translateOverviewTextClient(event,'" + heroCardKey + "','heroDescEl','heroDescTextEl','heroDescTranslateBtn')");
            }
            const trBtn = document.getElementById("heroBtnTrailer");
            if (trBtn) {
              trBtn.setAttribute("onclick", "enterHeroForegroundTrailerModeClient(event,false)");
              syncHeroTrailerAvailabilityButtonClient(
                hero._trailerChecked ? (hero._hasEmbeddableTrailer ? "available" : "none") : "checking",
                hero._trailerCount || 0
              );
            }
            const detBtn = document.getElementById("heroBtnDetails");
            if (detBtn) {
              detBtn.setAttribute("onclick", "openDetails('" + heroType + "'," + hero.id + ")");
            }
            const wlBtn = document.getElementById("heroBtnWishlist");
            if (wlBtn) {
              wlBtn.setAttribute("data-hero-wl-key", heroCardKey);
              wlBtn.setAttribute("onclick", "quickToggleCardWishlist(event,'" + heroType + "'," + hero.id + ")");
              wlBtn.setAttribute("title", isHeroSaved ? "Aus deiner Merkliste entfernen" : "Direkt in deiner Merkliste speichern");
              wlBtn.classList.toggle("saved", Boolean(isHeroSaved));
              wlBtn.innerHTML = isHeroSaved ? "✓ Gespeichert" : "＋ Speichern";
            }
            const prevArr = document.getElementById("heroPrevArrowBtn");
            if (prevArr) prevArr.setAttribute("onclick", "setHeroSlideIndex(" + (state.heroIndex - 1) + ")");
            const nextArr = document.getElementById("heroNextArrowBtn");
            if (nextArr) nextArr.setAttribute("onclick", "setHeroSlideIndex(" + (state.heroIndex + 1) + ")");

            // 3. Minimalistische Punktleiste + 7s-Fortschrittsbalken aktualisieren (nur beim aktiven Dot Reflow auslösen!)
            const allDots = container.querySelectorAll(".hero-dot");
            let activeDotFill = null;
            allDots.forEach((btn, idx) => {
              const isAct = idx === state.heroIndex;
              btn.classList.toggle("active", isAct);
              const fill = btn.querySelector(".hero-thumb-progress-fill");
              if (fill) {
                if (isAct) {
                  fill.style.animation = "none";
                  activeDotFill = fill;
                } else if (fill.style.animation) {
                  fill.style.animation = "";
                }
              }
            });
            if (activeDotFill) {
              void activeDotFill.offsetWidth;
              activeDotFill.style.animation = "";
            }

            scheduleHeroBackgroundVideoTeaserClient(false);

            if (typeof window.refreshModalAndEpisodeMarquees === "function") {
              setTimeout(() => window.refreshModalAndEpisodeMarquees(container), 40);
            }
            if (prevHeroFocusId === "dot") {
              const c = container.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]');
              if (c) setSpatialFocus(c, false);
            }
            return;
          }
        }

        container.innerHTML = buildHeroBannerInnerHtml();
        const curHero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
        if (curHero) {
          const curHeroType = curHero.media_type === "tv" || state.type === "s" ? "s" : "m";
          applyDynamicHeroAmbilightClient(resolveHeroSlideBackdropUrlClient(curHero));
          ensureHeroSlideClearLogoClient(curHero, curHeroType);
        }
        syncHeroSearchPlaceholderAndToggleBtnClient();
        scheduleHeroBackgroundVideoTeaserClient(false);
        if (typeof window.refreshModalAndEpisodeMarquees === "function") {
          setTimeout(() => window.refreshModalAndEpisodeMarquees(container), 40);
        }
        if (prevHeroFocusId === "heroBtnDetails") {
          const b = document.getElementById("heroBtnDetails");
          if (b) setSpatialFocus(b, false);
        } else if (prevHeroFocusId === "heroBtnWishlist") {
          const b = document.getElementById("heroBtnWishlist");
          if (b) setSpatialFocus(b, false);
        } else if (prevHeroFocusId === "heroBtnTrailer") {
          const b = document.getElementById("heroBtnTrailer");
          if (b) setSpatialFocus(b, false);
        } else if (prevHeroFocusId === "heroHideBtn" || prevHeroFocusId === "heroRestoreBtn") {
          const b = document.getElementById("heroHideBtn");
          if (b) setSpatialFocus(b, false);
        } else if (prevHeroFocusId === "dot") {
          const c = container.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]');
          if (c) setSpatialFocus(c, false);
        }
      }

      // =========================================================================
      // 4. KLAR ERSICHTLICHER FILM / SERIEN MODUS DURCH REINE FARBKENNUNG & NUR INAKTIVE OPTION WÄHLBAR
      // =========================================================================
      function syncSearchGenreSelectDom() {
        const sel = document.getElementById("searchGenreSelect");
        const trigBtn = document.getElementById("searchGenreTriggerBtn");
        const trigIcon = document.getElementById("searchGenreTriggerIcon");
        const trigLabel = document.getElementById("searchGenreTriggerLabel");
        const overlayEl = document.getElementById("searchGenreDropdownOverlay");
        const isMovie = state.type !== "s";
        const gMap = (state.genres && Object.keys(state.genres).length > 0)
          ? state.genres
          : (isMovie ? MOVIE_GENRES_CLIENT : SERIES_GENRES_CLIENT);
        const curGenreId = String(state.genreId || "all");
        let activeName = "Alle Genres";
        let activeEmoji = "🎞️";
        let optsHtml = '<option value="all"' + (curGenreId === "all" ? ' selected' : '') + '>🎞️ Alle Genres</option>';
        Object.entries(gMap || {}).forEach(([gName, gId]) => {
          const idStr = String(gId);
          const em = genreEmoji(gName);
          if (curGenreId === idStr) {
            activeName = gName;
            activeEmoji = em;
          }
          optsHtml += '<option value="' + esc(idStr) + '"' + (curGenreId === idStr ? ' selected' : '') + '>' + em + ' ' + esc(gName) + '</option>';
        });
        if (sel) {
          sel.innerHTML = optsHtml;
          sel.value = curGenreId;
        }
        if (trigIcon) trigIcon.textContent = activeEmoji;
        if (trigLabel) trigLabel.textContent = activeName;
        const quickResetEl = document.getElementById("searchGenreQuickResetBtn");
        if (quickResetEl) {
          quickResetEl.style.display = curGenreId !== "all" ? "inline-flex" : "none";
        }
        if (trigBtn) {
          const hasActive = curGenreId !== "all";
          trigBtn.classList.toggle("has-active-genre", hasActive);
          trigBtn.title = hasActive ? ("Aktives Genre: " + activeName + " (Tippen zum Ändern, ✕ zum Zurücksetzen)") : "Nach Genre filtern";
        }
        if (overlayEl && overlayEl.classList.contains("open")) {
          renderSearchGenreDropdownOverlayContent();
        }
        syncTopBarFilterIndicatorsClient();
      }

      function countActiveUserFiltersClient() {
        const s = state.settings || {};
        let count = 0;
        if (state.genreId && String(state.genreId) !== "all") count += 1;
        if (state.currentCompanyId) count += 1;
        if (s.onlyVipStreams && isCurrentUserVip()) count += 1;
        if (s.showUnreleased) count += 1;
        const addArr = (arr) => {
          if (Array.isArray(arr) && arr.length > 0) count += arr.length;
        };
        addArr(s.includedGenres);
        addArr(s.excludedGenres);
        addArr(s.includedPlatforms);
        addArr(s.excludedPlatforms);
        addArr(s.includedEras);
        addArr(s.excludedEras);
        addArr(s.includedStudios);
        addArr(s.excludedStudios);
        addArr(s.includedFsk);
        addArr(s.excludedFsk);
        return count;
      }

      function syncTopBarFilterIndicatorsClient() {
        const totalActive = countActiveUserFiltersClient();
        const badgeEl = document.getElementById("topSidebarFilterCountBadge");
        const sbBtn = document.getElementById("sidebarToggleBtn");
        if (badgeEl) {
          if (totalActive > 0) {
            badgeEl.textContent = String(totalActive);
            badgeEl.style.display = "inline-flex";
          } else {
            badgeEl.style.display = "none";
          }
        }
        if (sbBtn) {
          sbBtn.classList.toggle("has-active-filters", totalActive > 0);
          sbBtn.title = totalActive > 0
            ? ("Menü & Filter öffnen (" + totalActive + " aktive Filter)")
            : "Menü, Filter, Zufall, Account, Design & Ansichtsgröße öffnen";
        }
        const quickResetEl = document.getElementById("searchGenreQuickResetBtn");
        if (quickResetEl) {
          quickResetEl.style.display = (state.genreId && String(state.genreId) !== "all") ? "inline-flex" : "none";
        }
      }

      function resetTopGenreFilterQuickClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        triggerTmaHapticClient("selection");
        closeSearchGenreDropdownOverlay();
        onSearchGenreSelectChange("all");
      }

      function switchGenreOverlayMediaTypeClient(nextType, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const cleanType = nextType === "s" ? "s" : "m";
        if (state.type === cleanType) return;
        triggerTmaHapticClient("selection");
        state.type = cleanType;
        state.genres = cleanType === "s" ? SERIES_GENRES_CLIENT : MOVIE_GENRES_CLIENT;
        state.genreId = "all";
        updateMediaModeIndicatorDom();
        syncSearchGenreSelectDom();
        renderSearchGenreDropdownOverlayContent();
        if (typeof loadDiscover === "function") {
          loadDiscover(cleanType, "all", state.mode || "trend", state.sort || "default", false, false);
        }
      }

      function renderSearchGenreDropdownOverlayContent() {
        const overlayEl = document.getElementById("searchGenreDropdownOverlay");
        if (!overlayEl) return;
        const isMovie = state.type !== "s";
        const gMap = (state.genres && Object.keys(state.genres).length > 0)
          ? state.genres
          : (isMovie ? MOVIE_GENRES_CLIENT : SERIES_GENRES_CLIENT);
        const curGenreId = String(state.genreId || "all");
        let chipsHtml = '<button type="button" class="genre-overlay-chip ' + (curGenreId === "all" ? "active" : "") + '" onclick="selectGenreFromSearchOverlay(\\'all\\')">' +
          '<span>🎞️</span><span>Alle Genres</span>' +
        '</button>';
        Object.entries(gMap || {}).forEach(([gName, gId]) => {
          const idStr = String(gId);
          const em = genreEmoji(gName);
          chipsHtml += '<button type="button" class="genre-overlay-chip ' + (curGenreId === idStr ? "active" : "") + '" onclick="selectGenreFromSearchOverlay(\\'' + escJs(idStr) + '\\')">' +
            '<span>' + em + '</span><span>' + esc(gName) + '</span>' +
          '</button>';
        });
        overlayEl.innerHTML =
          '<div class="genre-overlay-header">' +
            '<div class="genre-overlay-title">' +
              '<span>🎞️ Genre wählen</span>' +
              '<span class="genre-overlay-type-pills">' +
                '<button type="button" class="genre-overlay-type-btn ' + (isMovie ? 'active' : '') + '" onclick="switchGenreOverlayMediaTypeClient(\\'m\\', event)">🎬 Filme</button>' +
                '<button type="button" class="genre-overlay-type-btn ' + (!isMovie ? 'active' : '') + '" onclick="switchGenreOverlayMediaTypeClient(\\'s\\', event)">📺 Serien</button>' +
              '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              (curGenreId !== "all" ? '<button type="button" class="genre-overlay-close-btn" style="border-color:rgba(56,189,248,0.45);color:#7dd3fc" onclick="selectGenreFromSearchOverlay(\\'all\\')" title="Genre-Filter zurücksetzen">↺ Alle</button>' : '') +
              '<button type="button" class="genre-overlay-close-btn" onclick="closeSearchGenreDropdownOverlay()">✕ Schließen</button>' +
            '</div>' +
          '</div>' +
          '<div class="genre-overlay-grid">' + chipsHtml + '</div>';
      }

      function toggleSearchGenreDropdownOverlay(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        triggerTmaHapticClient("light");
        const overlayEl = document.getElementById("searchGenreDropdownOverlay");
        const trigBtn = document.getElementById("searchGenreTriggerBtn");
        if (!overlayEl) return;
        const willOpen = !overlayEl.classList.contains("open");
        if (willOpen) {
          closeAutocomplete();
          renderSearchGenreDropdownOverlayContent();
          overlayEl.classList.add("open");
          if (trigBtn) {
            trigBtn.classList.add("is-open");
            trigBtn.setAttribute("aria-expanded", "true");
          }
        } else {
          closeSearchGenreDropdownOverlay();
        }
      }

      function closeSearchGenreDropdownOverlay() {
        const overlayEl = document.getElementById("searchGenreDropdownOverlay");
        const trigBtn = document.getElementById("searchGenreTriggerBtn");
        if (overlayEl) {
          overlayEl.classList.remove("open");
        }
        if (trigBtn) {
          trigBtn.classList.remove("is-open");
          trigBtn.setAttribute("aria-expanded", "false");
        }
      }

      function selectGenreFromSearchOverlay(genreVal) {
        triggerTmaHapticClient("selection");
        closeSearchGenreDropdownOverlay();
        onSearchGenreSelectChange(genreVal);
        const inp = document.getElementById("searchInput");
        if (!inp || !inp.value.trim()) {
          collapseMobileSearchBarClient();
        }
      }

      function expandMobileSearchBarClient(focusInput = true) {
        const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
        if (hdr && (window.innerWidth || 1024) <= 760) {
          if (!hdr.classList.contains("mobile-search-expanded")) {
            triggerTmaHapticClient("light");
          }
          hdr.classList.add("mobile-search-expanded");
          syncHeroSearchPlaceholderAndToggleBtnClient();
        }
        if (focusInput) {
          const inp = document.getElementById("searchInput");
          if (inp && document.activeElement !== inp) {
            try { inp.focus(); } catch (e) {}
          }
        }
      }

      function collapseMobileSearchBarClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        triggerTmaHapticClient("selection");
        closeSearchGenreDropdownOverlay();
        closeAutocomplete();
        const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
        if (hdr) {
          hdr.classList.remove("mobile-search-expanded");
        }
        const inp = document.getElementById("searchInput");
        if (inp && document.activeElement === inp) {
          try { inp.blur(); } catch (e) {}
        }
        syncHeroSearchPlaceholderAndToggleBtnClient();
      }

      document.addEventListener("click", (ev) => {
        const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
        if (!hdr) return;
        const t = ev.target;
        if (t && typeof t.closest === "function" && !t.closest("#topUnifiedBar") && !t.closest("#tvElevBtnSearch")) {
          closeSearchGenreDropdownOverlay();
          const inp = document.getElementById("searchInput");
          const hasText = Boolean(inp && inp.value && inp.value.trim().length > 0);
          if (!hasText) {
            hdr.classList.remove("mobile-search-expanded");
            syncHeroSearchPlaceholderAndToggleBtnClient();
          }
        }
      });

      async function onSearchGenreSelectChange(genreVal) {
        const val = String(genreVal || "all");
        state.genreId = val;
        syncSearchGenreSelectDom();
        const isMovie = state.type !== "s";
        const gMap = (state.genres && Object.keys(state.genres).length > 0)
          ? state.genres
          : (isMovie ? MOVIE_GENRES_CLIENT : SERIES_GENRES_CLIENT);
        const foundEntry = Object.entries(gMap || {}).find(([, id]) => String(id) === val);
        const gName = foundEntry ? foundEntry[0] : "";

        if (state.isSearchMode && state.searchQuery) {
          const s = state.settings || (state.settings = {});
          s.filtersActive = true;
          s.includedGenres = gName ? [gName] : [];
          try {
            localStorage.setItem("tma_cached_settings", JSON.stringify(state.settings));
          } catch (e) {}
          await runSearch(false);
        } else {
          await loadDiscover(state.type || "m", val, state.mode || "trend", state.sort || "default", false, false);
        }
      }

      function updateMediaModeIndicatorDom() {
        const isMovie = state.type !== "s";
        const mTab = document.getElementById("tabBtnMovies");
        const sTab = document.getElementById("tabBtnSeries");
        const randBtn = document.getElementById("topRandomDiceBtn");
        if (mTab) {
          mTab.className = "media-mode-tab " + (isMovie ? "active-movie" : "");
          mTab.disabled = false;
          mTab.removeAttribute("tabindex");
          mTab.title = isMovie ? "Zur Filme-Hauptseite" : "Zu Filme wechseln";
        }
        if (sTab) {
          sTab.className = "media-mode-tab " + (!isMovie ? "active-series" : "");
          sTab.disabled = false;
          sTab.removeAttribute("tabindex");
          sTab.title = !isMovie ? "Zur Serien-Hauptseite" : "Zu Serien wechseln";
        }
        if (randBtn) {
          randBtn.innerHTML = '🎲 <span class="rand-short-txt">' + (isMovie ? 'Zufalls-Film' : 'Zufalls-Serie') + '</span><span class="rand-long-txt"> (mit Filtern)</span>';
        }
        syncSearchGenreSelectDom();
      }

      function pushHistory(fn) { state.history.push(fn); }
      function goBack() {
        if (document.getElementById("searchGenreDropdownOverlay")?.classList.contains("open")) { closeSearchGenreDropdownOverlay(); return; }
        if (document.getElementById("topUnifiedBar")?.classList.contains("mobile-search-expanded")) { collapseMobileSearchBarClient(); return; }
        if (document.getElementById("customDialogRoot")?.innerHTML) { closeCustomDialog(null); return; }
        const manual900mEl = document.getElementById("manualNoTmdbConfirmModalOverlay");
        if (manual900mEl && manual900mEl.style.display && manual900mEl.style.display !== "none" && typeof closeManualNoTmdbConfirmModalClient === "function") { closeManualNoTmdbConfirmModalClient(); return; }
        if (document.getElementById("subModalOverlayRoot")?.innerHTML && typeof closeSubModalOverlayClient === "function") { closeSubModalOverlayClient(); return; }
        if (document.getElementById("personSpotlightOverlayRoot")?.innerHTML && typeof closePersonSpotlightOverlayClient === "function") { closePersonSpotlightOverlayClient(); return; }
        if (state.sidebarOpen) { closeFilterSidebar(); return; }
        if (document.getElementById("lightboxRoot").innerHTML) { closeLightbox(); return; }
        if (document.getElementById("modalRoot").innerHTML) { closeDetailModal(); return; }
        const prev = state.history.pop();
        if (prev) prev(); else goHome();
      }

      // Klick auf das TelePort Logo -> Führt direkt zur Hauptseite
      function goHome() {
        state.isSearchMode = false;
        state.searchQuery = "";
        state.filtersCollapsedInSearch = false;
        state.currentView = "discover";
        if (typeof updateFloatingImportStatusBarDom === "function") updateFloatingImportStatusBarDom();
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        state.genreId = "all";
        const inp = document.getElementById("searchInput");
        if (inp) inp.value = "";
        updateSearchClearBtnVisibility();
        closeSearchGenreDropdownOverlay();
        collapseMobileSearchBarClient();
        closeLightbox();
        if (typeof closeManualNoTmdbConfirmModalClient === "function") closeManualNoTmdbConfirmModalClient();
        if (typeof closeSubModalOverlayClient === "function") closeSubModalOverlayClient();
        document.getElementById("modalRoot").innerHTML = "";
        loadDiscover(state.type || "m", "all", "trend", "default");
      }

      // Klick auf "Neu starten" -> Setzt auch alle aktiven Filter zurück und startet frisch auf der Hauptseite
      async function restartApp() {
        state.history = [];
        state.isSearchMode = false;
        state.searchQuery = "";
        state.openFilterDropdown = null;
        state.filtersCollapsedInSearch = false;
        state.currentView = "discover";
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        state.genreId = "all";
        state.settings = {
          includedGenres: [], excludedGenres: [],
          includedPlatforms: [], excludedPlatforms: [],
          includedEras: [], excludedEras: [],
          includedStudios: [], excludedStudios: [],
          includedFsk: [], excludedFsk: [],
          showUnreleased: false,
          onlyVipStreams: false,
          filtersActive: true
        };
        const inp = document.getElementById("searchInput");
        if (inp) inp.value = "";
        updateSearchClearBtnVisibility();
        closeSearchGenreDropdownOverlay();
        collapseMobileSearchBarClient();
        closeLightbox();
        if (typeof closeManualNoTmdbConfirmModalClient === "function") closeManualNoTmdbConfirmModalClient();
        if (typeof closeSubModalOverlayClient === "function") closeSubModalOverlayClient();
        document.getElementById("modalRoot").innerHTML = "";
        setBusyState(true, "🔄 Setze alle Filter zurück & starte Mini-App neu...");
        try {
          const res = await apiFetchJson(API_BASE + "/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              action: "reset_all_filters",
              clientSettings: state.settings,
              includeDiscover: true,
              type: "m",
              genreId: "all",
              mode: "trend",
              sort: "default"
            })
          });
          if (res && res.settings) state.settings = res.settings;
          if (res && res.discover) {
            state.type = "m";
            state.genreId = "all";
            state.mode = "trend";
            state.sort = "default";
            state.startPage = 1;
            state.page = 1;
            state.items = res.discover.items || [];
            state.totalPages = Math.max(1, Number(res.discover.totalPages) || 1);
            state.totalResults = Math.max(state.items.length, Number(res.discover.totalResults) || state.items.length);
            state.hasMorePages = Boolean(res.discover.hasMore ?? (state.items.length >= 12));
            state.genres = res.discover.genres || {};
            updateMediaModeIndicatorDom();
            rebuildHeroSlides(state.items);
            renderDiscover();
            return;
          }
        } catch (e) {} finally {
          setBusyState(false);
        }
        loadDiscover("m", "all", "trend", "default");
      }

      function updateSearchClearBtnVisibility() {
        const inp = document.getElementById("searchInput");
        const btn = document.getElementById("searchClearBtn") || document.querySelector(".search-clear-btn");
        if (!btn) return;
        const hasVal = Boolean(inp && inp.value && inp.value.length > 0);
        btn.classList.toggle("is-empty", !hasVal);
        if (!hasVal && typeof currentSpatialEl !== "undefined" && currentSpatialEl === btn && inp) {
          setSpatialFocus(inp, false);
        }
      }

      function clearSearchInput() {
        const inp = document.getElementById("searchInput");
        if (inp) inp.value = "";
        updateSearchClearBtnVisibility();
        state.searchFocused = false;
        state.searchMatchedCollections = [];
        state.searchMatchedUniverses = [];
        state.searchMatchedPersons = [];

        state.searchMatchedStudios = [];
        state.searchEntitiesExpanded = false;
        document.body.classList.remove("search-active-dim");
        closeAutocomplete();
        if (state.isSearchMode) goHome();
      }

      let lastAutocompleteResponseCache = null;
      let lastAutocompleteQueryCache = "";
      let activeAutocompleteIndex = -1;

      function onSearchInputFocus() {
        if (typeof closeRightMenuOverlayClient === "function") {
          closeRightMenuOverlayClient(null, true);
        }
        closeSearchGenreDropdownOverlay();
        expandMobileSearchBarClient(false);
        updateSearchClearBtnVisibility();
        state.searchFocused = true;
        const bar = document.querySelector("#topUnifiedBar .search-bar");
        if (bar) bar.classList.add("is-search-focused");
        const inp = document.getElementById("searchInput");
        const val = (inp ? inp.value : "").trim();
        const box = document.getElementById("searchAutocompleteBox");
        if (val && box && !box.classList.contains("open") && lastAutocompleteResponseCache && lastAutocompleteQueryCache.toLowerCase() === val.toLowerCase()) {
          renderAutocompleteSuggestions(val, lastAutocompleteResponseCache);
        }
      }

      function onSearchInputBlur() {
        setTimeout(() => {
          const inp = document.getElementById("searchInput");
          const box = document.getElementById("searchAutocompleteBox");
          const activeEl = document.activeElement;
          const isFocusInsideAutocomplete = Boolean(
            (activeEl && activeEl === inp) ||
            (activeEl && activeEl.closest && activeEl.closest("#searchAutocompleteBox")) ||
            (typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#searchAutocompleteBox")) ||
            (box && typeof box.matches === "function" && box.matches(":hover"))
          );
          if (activeEl !== inp) {
            const bar = document.querySelector("#topUnifiedBar .search-bar");
            if (bar) bar.classList.remove("is-search-focused", "search-focus-pulse");
          }
          const val = (inp ? inp.value : "").trim();
          updateSearchClearBtnVisibility();
          const genreOverlayOpen = Boolean(document.getElementById("searchGenreDropdownOverlay")?.classList.contains("open"));
          if (!val && !state.isSearchMode) {
            state.searchFocused = false;
            if (!genreOverlayOpen && activeEl !== inp && !isFocusInsideAutocomplete) {
              const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
              if (hdr) hdr.classList.remove("mobile-search-expanded");
              syncHeroSearchPlaceholderAndToggleBtnClient();
            }
          }
          if (!isFocusInsideAutocomplete) {
            closeAutocomplete();
          }
        }, 240);
      }

      function closeAutocomplete() {
        activeAutocompleteIndex = -1;
        const box = document.getElementById("searchAutocompleteBox");
        if (box) {
          box.classList.remove("open");
          box.innerHTML = "";
        }
      }

      function setAutocompleteHighlightIndexClient(nextIdx) {
        const box = document.getElementById("searchAutocompleteBox");
        if (!box || !box.classList.contains("open")) {
          activeAutocompleteIndex = -1;
          return null;
        }
        const items = Array.from(box.querySelectorAll(".ac-item"));
        if (!items.length) {
          activeAutocompleteIndex = -1;
          return null;
        }
        if (nextIdx < -1) nextIdx = items.length - 1;
        if (nextIdx >= items.length) nextIdx = -1;
        activeAutocompleteIndex = nextIdx;
        items.forEach((el, idx) => {
          const isAct = idx === activeAutocompleteIndex;
          el.classList.toggle("ac-kb-active", isAct);
          el.classList.toggle("spatial-focus", isAct);
          if (isAct && typeof window._trackSpatialFocusEl === "function") {
            window._trackSpatialFocusEl(el);
          }
        });
        if (activeAutocompleteIndex >= 0 && items[activeAutocompleteIndex]) {
          const targetEl = items[activeAutocompleteIndex];
          if (typeof currentSpatialEl !== "undefined") {
            currentSpatialEl = targetEl;
          }
          if (typeof targetEl.scrollIntoView === "function") {
            try { targetEl.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
          }
          return targetEl;
        }
        return null;
      }

      function onSearchInputKeyDownClient(event, inpEl) {
        if (!event) return;
        const box = document.getElementById("searchAutocompleteBox");
        const isAcOpen = Boolean(box && box.classList.contains("open"));
        if (event.key === "ArrowDown" && isAcOpen) {
          const items = Array.from(box.querySelectorAll(".ac-item"));
          if (items.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            const nextIdx = activeAutocompleteIndex + 1 >= items.length ? 0 : activeAutocompleteIndex + 1;
            setAutocompleteHighlightIndexClient(nextIdx);
            return;
          }
        }
        if (event.key === "ArrowUp" && isAcOpen) {
          const items = Array.from(box.querySelectorAll(".ac-item"));
          if (items.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            const prevIdx = activeAutocompleteIndex <= 0 ? (activeAutocompleteIndex === 0 ? -1 : items.length - 1) : activeAutocompleteIndex - 1;
            setAutocompleteHighlightIndexClient(prevIdx);
            return;
          }
        }
        if (event.key === "Escape" && isAcOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeAutocomplete();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (isAcOpen) {
            const items = Array.from(box.querySelectorAll(".ac-item"));
            const highlighted = (activeAutocompleteIndex >= 0 && items[activeAutocompleteIndex])
              ? items[activeAutocompleteIndex]
              : box.querySelector(".ac-item.ac-kb-active, .ac-item.spatial-focus");
            if (highlighted) {
              highlighted.click();
              return;
            }
          }
          closeSearchGenreDropdownOverlay();
          closeAutocomplete();
          if (inpEl && typeof inpEl.blur === "function") inpEl.blur();
          runSearch(false, inpEl ? inpEl.value : "", undefined, true);
        }
      }

      document.addEventListener("pointerdown", (ev) => {
        const box = document.getElementById("searchAutocompleteBox");
        if (!box || !box.classList.contains("open")) return;
        const t = ev.target;
        if (t && typeof t.closest === "function") {
          if (t.closest("#searchAutocompleteBox") || t.closest(".search-bar")) return;
        }
        closeAutocomplete();
      }, { passive: true });

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
          lastAutocompleteResponseCache = null;
          lastAutocompleteQueryCache = "";
          closeAutocomplete();
          return;
        }
        const mySeq = ++liveSearchReqSeq;
        liveSearchDebounceTimer = setTimeout(async () => {
          try {
            const res = await apiFetchJson(
              API_BASE + "/search?q=" + encodeURIComponent(q) +
              "&scope=" + encodeURIComponent(state.searchScope || "all") +
              "&sort=" + encodeURIComponent(state.sort)
            );
            if (mySeq !== liveSearchReqSeq || !res || !res.ok) return;
            lastAutocompleteResponseCache = res;
            lastAutocompleteQueryCache = q;
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

      function selectFullSearchFromAutocompleteClient(qStr) {
        const cleanQ = String(qStr || document.getElementById("searchInput")?.value || "").trim();
        closeAutocomplete();
        const inp = document.getElementById("searchInput");
        if (inp && typeof inp.blur === "function") inp.blur();
        if (cleanQ) {
          runSearch(false, cleanQ, undefined, true);
        }
      }

      function renderAutocompleteSuggestions(q, res) {
        const box = document.getElementById("searchAutocompleteBox");
        if (!box) return;
        const cols = (res.collections || []).slice(0, 4);
        const unis = (res.universes || []).slice(0, 3);
        const studs = (res.studios || []).slice(0, 4);
        const pers = (res.persons || []).slice(0, 4);
        const media = (res.items || []).slice(0, 6);
        if (!cols.length && !unis.length && !studs.length && !pers.length && !media.length) {
          closeAutocomplete();
          return;
        }
        activeAutocompleteIndex = -1;
        let html = '<div class="ac-header-row">' +
          '<span>💡 Direktwahl: Klick / Tipp oder Pfeiltasten ⇅ + Enter</span>' +
          '<button type="button" class="ac-close-mini-btn" onmousedown="event.preventDefault()" onclick="closeAutocomplete()">✕ Schließen</button>' +
        '</div>';

        if (media.length) {
          html += '<div class="ac-group-title">🎬 Filme & 📺 Serien (Direkt öffnen)</div>';
          media.forEach(m => {
            const tc = m.media_type === "tv" ? "s" : "m";
            const yr = (m.release_date || m.first_air_date || "").slice(0, 4);
            const thumbSrc = m.poster_path ? resolvePosterUrlClient(m.poster_path, "w92", "") : "";
            const thumbHtml = thumbSrc
              ? '<img class="ac-item-thumb" src="' + esc(thumbSrc) + '" alt="" loading="lazy" decoding="async" />'
              : '<span class="ac-item-icon-box">' + (tc === "s" ? "📺" : "🎬") + '</span>';
            const typeBadge = tc === "s" ? "Serie" : "Film";
            html += '<div class="ac-item" role="option" tabindex="0" onmousedown="event.preventDefault()" onclick="closeAutocomplete();openDetails(\\'' + tc + '\\',' + Number(m.id) + ',false)">' +
              '<div class="ac-item-left">' +
                thumbHtml +
                '<div class="ac-item-text">' +
                  '<b>' + esc(m.title || m.name) + '</b>' +
                  '<div style="font-size:11px;color:#94a3b8;margin-top:1px">' + (tc === "s" ? "📺 " : "🎬 ") + typeBadge + (yr ? " • " + esc(yr) : "") + '</div>' +
                '</div>' +
              '</div>' +
              '<span class="ac-item-action" style="color:#fbbf24;border-color:rgba(251,191,36,0.35)">⭐ ' + (m.vote_average ? m.vote_average.toFixed(1) : '–') + ' ➔</span>' +
            '</div>';
          });
        }
        if (cols.length || unis.length || studs.length) {
          html += '<div class="ac-group-title">🍿 Reihen, 🌌 Universen & 🏢 Filmstudios</div>';
          unis.forEach(u => {
            html += '<div class="ac-item" role="option" tabindex="0" onmousedown="event.preventDefault()" onclick="closeAutocomplete();openUniverseView(\\'' + escJs(u.id) + '\\')">' +
              '<div class="ac-item-left"><span class="ac-item-icon-box">' + esc(u.icon || '🌌') + '</span><span class="ac-item-text"><b>' + esc(u.name) + '</b></span></div>' +
              '<span class="ac-item-action" style="color:#34d399;border-color:rgba(52,211,153,0.35)">Universum ➔</span>' +
            '</div>';
          });
          cols.forEach(c => {
            html += '<div class="ac-item" role="option" tabindex="0" onmousedown="event.preventDefault()" onclick="closeAutocomplete();openCollectionView(' + Number(c.id) + ')">' +
              '<div class="ac-item-left"><span class="ac-item-icon-box">🍿</span><span class="ac-item-text"><b>' + esc(c.name) + '</b></span></div>' +
              '<span class="ac-item-action" style="color:#a78bfa;border-color:rgba(167,139,250,0.35)">Filmreihe ➔</span>' +
            '</div>';
          });
          studs.forEach(st => {
            const cid = st.companyIds || st.id;
            html += '<div class="ac-item" role="option" tabindex="0" onmousedown="event.preventDefault()" data-cid="' + esc(String(cid)) + '" data-cname="' + esc(st.name) + '" data-cpid="' + esc(st.presetStudioId || '') + '" onclick="closeAutocomplete();openStudioView(this.dataset.cid,this.dataset.cname,this.dataset.cpid)">' +
              '<div class="ac-item-left"><span class="ac-item-icon-box">' + esc(st.icon || '🏢') + '</span><span class="ac-item-text"><b>' + esc(st.name) + '</b></span></div>' +
              '<span class="ac-item-action" style="color:#f59e0b;border-color:rgba(245,158,11,0.35)">Studio ➔</span>' +
            '</div>';
          });
        }
        if (pers.length) {
          html += '<div class="ac-group-title">🌟 Personen (Schauspieler & Regie)</div>';
          pers.forEach(p => {
            html += '<div class="ac-item" role="option" tabindex="0" onmousedown="event.preventDefault()" data-pid="' + Number(p.id) + '" data-pname="' + esc(p.name) + '" onclick="closeAutocomplete();openPersonView(Number(this.dataset.pid),this.dataset.pname)">' +
              '<div class="ac-item-left"><span class="ac-item-icon-box">🌟</span><span class="ac-item-text"><b>' + esc(p.name) + '</b>' + (p.known_for ? ' <span style="color:#94a3b8;font-size:11px">(' + esc(p.known_for) + ')</span>' : '') + '</span></div>' +
              '<span class="ac-item-action" style="color:#38bdf8;border-color:rgba(56,189,248,0.35)">Person ➔</span>' +
            '</div>';
          });
        }
        const totalHitsNum = Math.max(media.length, Number(res.totalResults) || media.length);
        html += '<div class="ac-item" role="option" tabindex="0" style="margin-top:4px;border-top:1px solid rgba(148,163,184,0.16)" onmousedown="event.preventDefault()" onclick="selectFullSearchFromAutocompleteClient()">' +
          '<div class="ac-item-left"><span class="ac-item-icon-box">🔍</span><span class="ac-item-text">Alle Suchergebnisse für „<b>' + esc(q) + '</b>“ im Katalog anzeigen</span></div>' +
          '<span class="ac-item-action" style="color:#38bdf8;border-color:rgba(56,189,248,0.45)">' + totalHitsNum + ' Treffer ➔</span>' +
        '</div>';
        box.innerHTML = html;
        box.classList.add("open");
      }
