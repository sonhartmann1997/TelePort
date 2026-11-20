      /* 100% Vollbild TelePort Kino-Spotlight: Unbeschnittene Cover/Backdrops am oberen Rand + weicher Top-Fade + Bild-Ausfüllung hinter der Top-Leiste */
      @keyframes heroSlideProgress {
        0% { width: 0%; }
        100% { width: 100%; }
      }
      @keyframes heroScrollChevronBounce {
        0%, 100% { transform: translate3d(0, 0, 0); opacity: 0.78; }
        50% { transform: translate3d(0, 5px, 0); opacity: 1; }
      }
      .hero-curtain-shell {
        display: grid;
        grid-template-rows: 1fr;
        opacity: 1;
        margin-top: 0px;
        margin-bottom: 0px;
        transition:
          grid-template-rows 0.42s cubic-bezier(0.22, 1, 0.36, 1),
          opacity 0.36s cubic-bezier(0.22, 1, 0.36, 1),
          margin-top 0.42s cubic-bezier(0.22, 1, 0.36, 1),
          margin-bottom 0.42s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: grid-template-rows, opacity, margin-top;
      }
      .hero-curtain-shell.is-collapsed {
        grid-template-rows: 0fr;
        opacity: 0;
        margin-top: 0px;
        margin-bottom: 0px;
        pointer-events: none;
      }
      /* Bounce-Lock Fixierung: Bricht bei zu schnellem Wischen jede Zwischen-Dehnung ab und rastet verzögerungsfrei ein */
      .hero-curtain-shell.is-bounce-locked {
        transition:
          grid-template-rows 0.12s cubic-bezier(0.16, 1, 0.3, 1),
          opacity 0.1s cubic-bezier(0.16, 1, 0.3, 1),
          margin-top 0.12s cubic-bezier(0.16, 1, 0.3, 1),
          margin-bottom 0.12s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      .hero-curtain-shell.is-bounce-locked .hero-stage-wrap {
        --hero-rubber-y: 0px !important;
        --hero-scroll-fade: 0 !important;
      }
      .hero-curtain-shell.is-bounce-locked .hero-inner {
        transform: translate3d(0, 0, 0) !important;
      }
      /* Katalog & Filme unterhalb des 100%-Vollbild-Sliders: Gleiten als Vorhang auf scrollY = 0 + Gummiband-Widerstand an der Oberkante */
      #heroBannerSlot + .section {
        --catalog-rubber-y: 0px;
        transform: translate3d(0, var(--catalog-rubber-y, 0px), 0);
        transition: opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1), transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: opacity, transform;
      }
      #heroBannerSlot + .section.is-rubber-dragging {
        transition: opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1), transform 0.05s linear;
      }
      #heroBannerSlot + .section.is-bounce-locked {
        --catalog-rubber-y: 0px !important;
        transform: translate3d(0, 0, 0) !important;
        transition: opacity 0.12s cubic-bezier(0.16, 1, 0.3, 1), transform 0.1s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      body.hero-slider-expanded #heroBannerSlot + .section {
        min-height: calc(100vh - 54px);
        min-height: calc(100svh - 54px);
        box-sizing: border-box;
        padding-bottom: 36px;
      }
      body.hero-slider-expanded:not(.hero-scrolled-past) #heroBannerSlot + .section {
        opacity: 0;
        transform: translate3d(0, 18px, 0);
        pointer-events: none;
        max-height: 0;
        min-height: 0 !important;
        overflow: hidden;
        padding-top: 0 !important;
        padding-bottom: 0 !important;
        margin: 0 !important;
      }
      .hero-curtain-inner {
        overflow: hidden;
        min-height: 0;
      }
      .hero-stage-wrap {
        --ambi-1: 14, 165, 233;
        --ambi-2: 56, 189, 248;
        --ambi-3: 30, 64, 175;
        --hero-scroll-fade: 0;
        --hero-rubber-y: 0px;
        position: relative;
        margin: 0;
        z-index: 1;
        background: var(--bg);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
      }
      /* Flackerfreie atmosphärische Farblicht-Ausfüllung ohne seitliche Scheinwerfer oder helle Blende */
      .hero-ambilight-glow,
      .hero-ambilight-beams {
        display: none !important;
      }
      /* Hardwarebeschleunigtes Scroll-Abdunklungs-Overlay (reines GPU-Opacity statt Live-Blur-Neuberechnung beim Scrollen) */
      .hero-scroll-dim-overlay {
        position: absolute;
        inset: 0;
        z-index: 3;
        pointer-events: none;
        background: var(--bg);
        opacity: var(--hero-scroll-fade, 0);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        will-change: opacity;
      }
      body.is-gesture-dragging,
      body.is-gesture-dragging * {
        user-select: none !important;
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
      }
      .hero,
      .detail-hero-stage,
      .admin-drag-handle,
      #floatingImportStatusWidget {
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
      }
      .hero {
        position: relative;
        z-index: 1;
        margin: 0;
        min-height: calc(100vh - var(--sticky-header-height, 54px));
        min-height: calc(100svh - var(--sticky-header-height, 54px));
        height: calc(100svh - var(--sticky-header-height, 54px));
        box-sizing: border-box;
        border-radius: 0;
        border: none;
        background: transparent;
        box-shadow: none;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 16px 28px 14px;
        overflow: hidden;
        touch-action: pan-x;
      }
      .hero:has(.expandable-desc-box.is-expanded) {
        touch-action: pan-x pan-y;
      }
      /* Scharfes Slider-Bild direkt unterhalb der oberen Suchleiste (top: 0) */
      .hero-backdrop-layer {
        position: absolute;
        inset: 0;
        background-image: var(--hero-bg-landscape, none);
        background-size: cover;
        background-position: center top;
        background-repeat: no-repeat !important;
        z-index: 0;
        pointer-events: none;
        opacity: 0;
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transition: opacity 0.45s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: opacity;
      }
      .hero-backdrop-layer.is-poster-fallback,
      .detail-hero-stage:not([data-has-backdrop="1"]) .detail-backdrop-layer {
        background-image:
          radial-gradient(circle at 74% 48%, rgba(2, 6, 18, 0) 18%, rgba(4, 7, 15, 0.72) 54%, rgba(4, 7, 15, 0.98) 84%),
          var(--hero-bg-portrait, var(--hero-bg-landscape, none)),
          radial-gradient(circle at 72% 48%, rgba(var(--ambi-1, 14, 165, 233), 0.34) 0%, rgba(var(--ambi-2, 37, 99, 235), 0.16) 44%, rgba(4, 7, 15, 0.98) 82%) !important;
        background-size: 100% 100%, contain, 100% 100% !important;
        background-position: center center, 76% center, center center !important;
        background-repeat: no-repeat, no-repeat, no-repeat !important;
        background-color: #04070f !important;
      }
      .hero-backdrop-layer.active-layer {
        opacity: 1;
        transform: translate3d(0, 0, 0);
      }
      /* Sanfter Kino-Fade (ohne obere Highlight-Blende, unten nahtlos in den Katalog) */
      .hero-scrim-layer {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background:
          linear-gradient(180deg, rgba(5, 8, 16, 0.22) 0%, rgba(5, 8, 16, 0) 48px),
          linear-gradient(0deg, var(--bg) 0%, rgba(6, 9, 17, 0.92) 9%, rgba(6, 9, 17, 0.44) 24%, rgba(6, 9, 17, 0.08) 42%, rgba(6, 9, 17, 0) 58%),
          linear-gradient(90deg, rgba(4, 7, 15, 0.84) 0%, rgba(4, 7, 15, 0.62) 22%, rgba(4, 7, 15, 0.28) 44%, rgba(4, 7, 15, 0.05) 64%, rgba(4, 7, 15, 0) 78%),
          linear-gradient(90deg, var(--bg) 0%, rgba(5, 8, 16, 0) 3%, rgba(5, 8, 16, 0) 97%, var(--bg) 100%);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
      }
      /* Automatische Kontrast-Unterstützung bei extrem hellen Szenenbildern (wie Schnee/Eis in Interstellar) */
      .hero-stage-wrap.hero-bright-backdrop .hero-scrim-layer {
        background:
          linear-gradient(180deg, rgba(5, 8, 16, 0.28) 0%, rgba(5, 8, 16, 0) 56px),
          linear-gradient(0deg, var(--bg) 0%, rgba(5, 8, 16, 0.95) 11%, rgba(5, 8, 16, 0.52) 27%, rgba(5, 8, 16, 0.12) 45%, rgba(5, 8, 16, 0) 62%),
          linear-gradient(90deg, rgba(4, 7, 15, 0.92) 0%, rgba(4, 7, 15, 0.76) 26%, rgba(4, 7, 15, 0.42) 48%, rgba(4, 7, 15, 0.10) 68%, rgba(4, 7, 15, 0) 84%),
          linear-gradient(90deg, var(--bg) 0%, rgba(5, 8, 16, 0) 3%, rgba(5, 8, 16, 0) 97%, var(--bg) 100%);
      }
      .hero-inner {
        position: relative;
        z-index: 2;
        width: 100%;
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        min-height: clamp(280px, 62svh, 600px);
        gap: 12px;
        transform: translate3d(0, var(--hero-rubber-y, 0px), 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        will-change: transform;
      }
      /* Hochkant-Ansicht (Portrait): Normale 2:3 Filmcover (w780) unbeschnitten ohne Zoom und ohne Vervielfachung */
      @media (orientation: portrait), (max-width: 640px) {
        .hero-backdrop-layer,
        .hero-backdrop-layer.is-poster-fallback,
        .detail-hero-stage:not([data-has-backdrop="1"]) .detail-backdrop-layer {
          inset: 0 !important;
          background-image:
            radial-gradient(circle at 50% 42%, rgba(2, 6, 18, 0) 22%, rgba(4, 7, 15, 0.76) 58%, rgba(4, 7, 15, 0.98) 88%),
            var(--hero-bg-portrait, var(--hero-bg-landscape, none)),
            radial-gradient(circle at 50% 42%, rgba(var(--ambi-1, 14, 165, 233), 0.34) 0%, rgba(var(--ambi-2, 37, 99, 235), 0.16) 46%, rgba(4, 7, 15, 0.98) 85%) !important;
          background-position: center center, center top, center center !important;
          background-size: 100% 100%, contain, 100% 100% !important;
          background-repeat: no-repeat, no-repeat, no-repeat !important;
          background-color: #04070f !important;
        }
        .hero-scrim-layer,
        .hero-stage-wrap.hero-bright-backdrop .hero-scrim-layer {
          background:
            linear-gradient(180deg, rgba(4, 7, 15, 0.22) 0%, rgba(4, 7, 15, 0) 48px),
            linear-gradient(0deg, var(--bg) 0%, rgba(5, 8, 16, 0.96) 14%, rgba(5, 8, 16, 0.74) 30%, rgba(5, 8, 16, 0.24) 46%, rgba(5, 8, 16, 0) 64%) !important;
        }
      }
      .hero-widescreen-body {
        display: flex;
        align-items: flex-end;
        justify-content: flex-start;
        margin-top: auto;
        padding: 6px 0 4px;
      }
      .hero-content {
        position: relative;
        z-index: 2;
        min-width: 0;
        max-width: 600px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 4px 0;
        transition: opacity 0.24s ease, transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .hero-content.hero-fade-step {
        opacity: 0.25;
        transform: translate3d(8px, 0, 0);
      }
      /* TelePort Kicker über dem großen Filmtitel */
      .hero-kicker {
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 800;
        letter-spacing: 2.2px;
        text-transform: uppercase;
        color: rgba(241, 245, 249, 0.92);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 1px;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.95);
      }
      .hero-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        padding: 3px 10px;
        border-radius: 999px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .hero-badge.movie { background: linear-gradient(135deg, #0284c7, #1d4ed8); color: #fff; }
      .hero-badge.series { background: linear-gradient(135deg, #4338ca, #6d28d9); color: #fff; }
      .hero-title {
        min-width: 0;
        width: 100%;
        margin-bottom: 2px;
      }
      .hero-title-text {
        font-size: var(--cinema-title-size);
        font-weight: 900;
        line-height: 1.04;
        color: #ffffff;
        letter-spacing: -0.6px;
        text-transform: uppercase;
        text-shadow: 0 4px 20px rgba(0, 0, 0, 0.92), 0 1px 4px rgba(0, 0, 0, 0.9);
      }
      .cinema-clear-logo-wrap {
        position: relative;
        display: flex;
        align-items: flex-end;
        min-height: calc(clamp(44px, 7vh, 78px) * var(--scale-text));
        margin-bottom: 2px;
      }
      .cinema-clear-logo-fallback-title {
        display: none !important;
        width: 100%;
      }
      .cinema-clear-logo-wrap.is-logo-loading .cinema-clear-logo-fallback-title {
        display: flex !important;
      }
      .cinema-clear-logo-wrap.is-logo-ready .cinema-clear-logo-fallback-title {
        display: none !important;
      }
      .cinema-clear-logo {
        display: block;
        max-height: calc(clamp(54px, 8.8vh, 88px) * var(--scale-text));
        max-width: min(420px, 84vw);
        width: auto;
        height: auto;
        object-fit: contain;
        object-position: left bottom;
        filter: drop-shadow(0 6px 22px rgba(0, 0, 0, 0.92)) drop-shadow(0 2px 6px rgba(0, 0, 0, 0.86));
        user-select: none;
        -webkit-user-drag: none;
        transition: opacity 0.18s ease, transform 0.2s ease, filter 0.2s ease;
      }
      .cinema-clear-logo-wrap.is-logo-loading .cinema-clear-logo {
        position: absolute;
        left: 0;
        bottom: 0;
        opacity: 0;
        pointer-events: none;
      }
      .cinema-clear-logo-wrap.is-logo-ready .cinema-clear-logo {
        position: relative;
        opacity: 1;
      }
      .cinema-clear-logo:hover {
        transform: scale(1.015);
        filter: drop-shadow(0 8px 26px rgba(var(--ambi-1, 14, 165, 248), 0.45)) drop-shadow(0 4px 12px rgba(0, 0, 0, 0.92));
      }
      .hero-meta-clean {
        font-size: var(--cinema-meta-size);
        color: #f8fafc;
        margin-bottom: 4px;
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
        align-items: center;
        font-weight: 700;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.95);
      }
      .hero-meta-star {
        color: #ef4444;
        font-weight: 900;
      }
      .hero-meta-sep {
        color: rgba(255, 255, 255, 0.5);
      }
      .hero-meta-year {
        cursor: pointer;
        color: #f8fafc;
      }
      .hero-meta-hd {
        font-size: calc(10px * var(--scale-text));
        font-weight: 900;
        letter-spacing: 0.6px;
        color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, 0.38);
        border-radius: 4px;
        padding: 0px 5px;
        line-height: 1.35;
        background: rgba(15, 23, 42, 0.45);
      }
      .hero-meta-genres {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px;
        color: #cbd5e1;
      }
      .hero-meta-genre {
        cursor: pointer;
        color: #e2e8f0;
      }
      .hero-desc {
        font-size: var(--cinema-desc-size);
        color: rgba(241, 245, 249, 0.92);
        line-height: 1.55;
        margin-bottom: 10px;
        max-width: min(68ch, 100%);
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.96), 0 1px 3px rgba(0, 0, 0, 0.88);
      }
      /* Aufklappbare Kompakt-Scrollbox für Titelbeschreibungen: Offenes Design ohne Dauer-Rand, mit edler Shadowbox & Rand nur bei Hover/Select */
      .expandable-desc-box {
        position: relative;
        border-radius: 9px;
        border: 1px solid transparent;
        padding: 0;
        margin-left: 0;
        cursor: default;
        transition: background 0.2s ease, border-color 0.2s ease, padding 0.2s ease, box-shadow 0.2s ease;
        outline: none !important;
      }
      .expandable-desc-box.is-long-desc,
      .expandable-desc-box.is-expanded {
        cursor: pointer;
      }
      .expandable-desc-box.is-long-desc.spatial-focus,
      .expandable-desc-box.is-expanded.spatial-focus {
        background: rgba(8, 13, 24, 0.78);
        border-color: #38bdf8 !important;
        padding: 6px 10px 6px;
        box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.45), 0 0 18px rgba(56, 189, 248, 0.28), 0 8px 22px rgba(0, 0, 0, 0.65) !important;
      }
      .expandable-desc-box.is-long-desc:hover .desc-expand-hint,
      .expandable-desc-box.is-long-desc.spatial-focus .desc-expand-hint {
        color: #ffffff;
        text-decoration: underline;
      }
      .expandable-desc-scroll {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        word-break: break-word;
      }
      .expandable-desc-box.is-expanded {
        background: rgba(8, 13, 24, 0.86);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border-color: transparent;
        padding: 8px 10px 6px;
        margin-left: 0;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.72);
      }
      .expandable-desc-box.is-expanded .expandable-desc-scroll {
        display: block !important;
        -webkit-line-clamp: unset !important;
        max-height: 132px;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y !important;
        padding-right: 6px;
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: rgba(56, 189, 248, 0.65) rgba(15, 23, 42, 0.45);
      }
      .expandable-desc-box.is-expanded .expandable-desc-scroll::-webkit-scrollbar {
        width: 5px;
      }
      .expandable-desc-box.is-expanded .expandable-desc-scroll::-webkit-scrollbar-track {
        background: rgba(15, 23, 42, 0.45);
        border-radius: 999px;
      }
      .expandable-desc-box.is-expanded .expandable-desc-scroll::-webkit-scrollbar-thumb {
        background: rgba(56, 189, 248, 0.68);
        border-radius: 999px;
      }
      .desc-actions-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 4px;
      }
      .desc-expand-hint {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        color: #7dd3fc;
        letter-spacing: 0.2px;
        user-select: none;
        opacity: 0.92;
      }
      .expandable-desc-box:not(.is-long-desc):not(.is-expanded) .desc-expand-hint {
        display: none;
      }
      .desc-translate-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 9px;
        border-radius: 999px;
        border: 1px solid rgba(56, 189, 248, 0.45);
        background: rgba(15, 23, 42, 0.72);
        color: #bae6fd;
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 800;
        letter-spacing: 0.2px;
        cursor: pointer;
        transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.15s ease;
        user-select: none;
      }
      .desc-translate-btn:hover,
      .desc-translate-btn.spatial-focus {
        background: rgba(14, 165, 233, 0.28);
        border-color: #38bdf8;
        color: #ffffff;
        transform: translateY(-1px);
      }
      .desc-translate-btn.is-translated {
        border-color: rgba(52, 211, 153, 0.55);
        color: #a7f3d0;
      }
      .hero-actions-box {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .hero-btn-play {
        background: #ffffff !important;
        color: #090d16 !important;
        border: 1px solid #ffffff !important;
        border-radius: 8px !important;
        padding: var(--cinema-btn-pad) !important;
        font-size: var(--cinema-btn-font) !important;
        font-weight: 800 !important;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
        transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
      }
      .hero-btn-play:hover,
      .hero-btn-play.spatial-focus {
        background: #f1f5f9 !important;
        transform: translateY(-1px) scale(1.03);
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.55), 0 8px 22px rgba(0, 0, 0, 0.78) !important;
      }
      .hero-btn-play.is-trailer-unavailable {
        background: rgba(30, 41, 59, 0.72) !important;
        color: rgba(226, 232, 240, 0.88) !important;
        border: 1px solid rgba(148, 163, 184, 0.34) !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
      }
      .hero-btn-play.is-trailer-unavailable:hover,
      .hero-btn-play.is-trailer-unavailable.spatial-focus {
        background: rgba(51, 65, 85, 0.9) !important;
        color: #ffffff !important;
        border-color: rgba(148, 163, 184, 0.65) !important;
      }
      .hero-btn-info,
      .hero-btn-wishlist {
        background: rgba(30, 41, 59, 0.68) !important;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: #ffffff !important;
        border: 1px solid rgba(255, 255, 255, 0.24) !important;
        border-radius: 8px !important;
        padding: var(--cinema-btn-pad) !important;
        font-size: var(--cinema-btn-font) !important;
        font-weight: 700 !important;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
        transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }
      .hero-btn-info:hover,
      .hero-btn-info.spatial-focus,
      .hero-btn-wishlist:hover,
      .hero-btn-wishlist.spatial-focus {
        background: rgba(51, 65, 85, 0.85) !important;
        border-color: rgba(255, 255, 255, 0.55) !important;
        transform: translateY(-1px) scale(1.03);
      }
      .hero-btn-wishlist.saved {
        background: rgba(16, 185, 129, 0.24) !important;
        border-color: rgba(52, 211, 153, 0.72) !important;
        color: #ecfdf5 !important;
      }
      /* Minimalistische TelePort-Punktleiste unten mittig + animierter "∨" Scroll-Hinweis-Pfeil */
      .hero-bottom-bar {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        width: 100%;
        padding-top: 2px;
      }
      .hero-scroll-down-hint {
        appearance: none;
        -webkit-appearance: none;
        border: 1px solid rgba(255, 255, 255, 0.22);
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.68) 0%, rgba(30, 41, 59, 0.54) 100%);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: rgba(248, 250, 252, 0.94);
        cursor: pointer;
        padding: 4px 14px 4px;
        border-radius: 999px;
        display: inline-flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 6px;
        opacity: calc(1 - min(1, var(--hero-scroll-fade, 0) * 3.5));
        transition: color 0.18s ease, transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, opacity 0.2s ease;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55);
      }
      .hero-scroll-down-hint:hover,
      .hero-scroll-down-hint.spatial-focus {
        color: #ffffff;
        background: linear-gradient(135deg, rgba(2, 132, 199, 0.72) 0%, rgba(37, 99, 235, 0.72) 100%);
        border-color: rgba(125, 211, 252, 0.8);
        transform: translateY(2px) scale(1.05);
      }
      .hero-scroll-down-label {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.25px;
        white-space: nowrap;
      }
      .hero-scroll-down-chevron {
        width: 16px;
        height: 10px;
        display: block;
        animation: heroScrollChevronBounce 2s ease-in-out infinite;
      }
      .hero-dots-nav {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 4px 10px;
        border-radius: 999px;
        background: radial-gradient(ellipse at center, rgba(4, 7, 15, 0.62) 0%, rgba(4, 7, 15, 0.28) 75%, rgba(4, 7, 15, 0) 100%);
      }
      .hero-circle-arrow {
        width: 30px;
        height: 30px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.26);
        background: rgba(15, 23, 42, 0.52);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: #f8fafc;
        font-size: 15px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
      }
      .hero-circle-arrow:hover,
      .hero-circle-arrow.spatial-focus {
        background: rgba(255, 255, 255, 0.22);
        border-color: #ffffff;
        transform: scale(1.08);
      }
      .hero-dots-nav:has(.spatial-focus) {
        background: rgba(7, 11, 20, 0.78);
        box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.45), 0 6px 18px rgba(0, 0, 0, 0.75);
      }
      .hero-dots-track {
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }
      .hero-dot {
        position: relative;
        width: 6px;
        height: 6px;
        border-radius: 999px;
        padding: 0;
        border: none;
        background: rgba(255, 255, 255, 0.36);
        cursor: pointer;
        overflow: hidden;
        flex-shrink: 0;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.65);
        transition: width 0.28s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s ease, transform 0.2s ease;
      }
      .hero-dot:hover {
        background: rgba(255, 255, 255, 0.72);
        transform: scale(1.18);
      }
      .hero-dot.active {
        width: 24px;
        background: rgba(255, 255, 255, 0.35);
      }
      .hero-dot.spatial-focus {
        outline: 2px solid #38bdf8 !important;
        outline-offset: 3px;
        background: #ffffff !important;
      }
      .hero-thumb-progress {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
      }
      .hero-dot.active .hero-thumb-progress {
        opacity: 1;
      }
      .hero-thumb-progress-fill {
        height: 100%;
        width: 0%;
        border-radius: 999px;
        background: #ffffff;
        box-shadow: 0 0 8px rgba(255, 255, 255, 0.9);
      }
      .hero-dot.active .hero-thumb-progress-fill {
        animation: heroSlideProgress 7s linear forwards;
      }
      .hero:hover .hero-dot.active .hero-thumb-progress-fill,
      .hero:focus-within .hero-dot.active .hero-thumb-progress-fill {
        animation-play-state: paused;
      }
      .hero-hide-btn {
        height: var(--top-bar-h, 38px) !important;
        min-height: var(--top-bar-h, 38px) !important;
        max-height: var(--top-bar-h, 38px) !important;
        box-sizing: border-box !important;
        background: linear-gradient(135deg, rgba(8, 13, 24, 0.86) 0%, rgba(var(--ambi-1), 0.20) 100%);
        color: rgba(248, 250, 252, 0.95);
        border: 1px solid rgba(var(--ambi-2), 0.36);
        border-radius: 10px;
        padding: 0 11px;
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        flex-shrink: 0;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.44), inset 0 1px 0 rgba(255, 255, 255, 0.12);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transition: border-color 0.25s ease, transform 0.15s ease, color 0.15s ease;
      }
      .hero-hide-btn.is-collapsed-state {
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.86) 0%, rgba(var(--ambi-1), 0.28) 100%);
        border-color: rgba(var(--ambi-2), 0.58);
        color: #f8fafc;
      }
      .hero-hide-btn:hover,
      .hero-hide-btn.spatial-focus {
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.92) 0%, rgba(var(--ambi-2), 0.34) 100%);
        color: #ffffff;
        border-color: rgba(255, 255, 255, 0.68);
        transform: translateY(-1px);
      }
      /* 1-Zeilen Spotlight-Strip (Legacy-Fallback) */
      .hero-collapsed-strip {
        margin: 6px 14px 2px;
        padding: 7px 12px;
        border-radius: 12px;
        background: linear-gradient(90deg, rgba(var(--ambi-1), 0.18) 0%, rgba(15, 23, 42, 0.92) 45%, rgba(15, 23, 42, 0.96) 100%);
        border: 1px solid rgba(var(--ambi-2), 0.28);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }
      .hero-collapsed-left {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        flex: 1 1 200px;
      }
      .hero-collapsed-thumb {
        width: 24px;
        height: 34px;
        border-radius: 5px;
        object-fit: cover;
        border: 1px solid rgba(255, 255, 255, 0.22);
        flex-shrink: 0;
      }
      .hero-collapsed-title {
        font-size: calc(12.5px * var(--scale-text));
        font-weight: 800;
        color: #ffffff;
        min-width: 0;
        flex: 1;
        cursor: pointer;
      }
      .hero-collapsed-title:hover {
        color: #38bdf8;
      }
      .hero-collapsed-meta {
        font-size: calc(11.5px * var(--scale-text));
        color: #94a3b8;
        white-space: nowrap;
        font-weight: 700;
      }
      .hero-collapsed-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      /* Visuelles "🌌 Welten & Reihen" Portal-Dock direkt unter der Filterleiste */
      .worlds-portal-tray {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(148, 163, 184, 0.22);
        animation: fadeIn 0.16s ease;
      }
      .worlds-portal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }
      .worlds-search-input {
        flex: 1 1 180px;
        min-width: 150px;
        background: rgba(15, 23, 42, 0.65);
        border: 1px solid rgba(148, 163, 184, 0.32);
        color: var(--text);
        padding: 6px 10px;
        border-radius: 8px;
        font-size: calc(12px * var(--scale-text));
      }
      .worlds-portal-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(165px, 1fr));
        gap: 7px;
        max-height: 235px;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 6px;
        box-sizing: border-box;
      }
      .world-portal-card {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 8px 10px;
        border-radius: 10px;
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.78), rgba(15, 23, 42, 0.92));
        border: 1px solid rgba(148, 163, 184, 0.24);
        cursor: pointer;
        text-align: left;
        box-sizing: border-box;
        transition: all 0.15s ease;
      }
      .world-portal-card:hover,
      .world-portal-card.spatial-focus {
        border-color: var(--accent-primary);
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(30, 41, 59, 0.95));
        transform: none;
      }
      .world-portal-icon {
        font-size: 20px;
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.07);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .world-portal-info {
        min-width: 0;
        flex: 1;
      }
      .world-portal-name {
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        color: #f8fafc;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .world-portal-sub {
        font-size: calc(10.5px * var(--scale-text));
        color: #94a3b8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      @media (max-width: 760px) {
        header {
          --top-bar-h: 36px;
          padding: 6px 8px;
          gap: 5px;
        }
        /* Mobilansicht: Nur klare Symbole ohne Text (☰, 🎬|📺, 💾, ▴) + exakt gleiche Höhe (36px) */
        header .top-btn-label,
        header .brand-text-wrap {
          display: none !important;
        }
        header #sidebarToggleBtn,
        header #navBtnWishlist,
        header .hero-hide-btn {
          width: var(--top-bar-h) !important;
          min-width: var(--top-bar-h) !important;
          padding: 0 !important;
          font-size: 14px !important;
          transition: width 0.24s cubic-bezier(0.22, 1, 0.36, 1), min-width 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease, transform 0.2s ease;
        }
        header #headerBrandLogo {
          width: var(--top-bar-h);
          min-width: var(--top-bar-h);
          padding: 0;
          transition: width 0.24s cubic-bezier(0.22, 1, 0.36, 1), min-width 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
        }
        header #mediaModeBanner {
          transition: max-width 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease, padding 0.2s ease;
        }
        .media-mode-tab {
          padding: 0 7px;
          font-size: 13px;
        }
        /* Kompaktes Such-Pill im mobilen Ruhezustand: Nur Genre-Emoji ohne abgeschnittenen Text */
        header:not(.mobile-search-expanded) .search-genre-trigger-label,
        header:not(.mobile-search-expanded) .search-genre-caret,
        header:not(.mobile-search-expanded) .search-genre-quick-reset {
          display: none !important;
        }
        header:not(.mobile-search-expanded) .search-genre-trigger-btn {
          width: 32px;
          min-width: 32px;
          max-width: 32px;
          padding: 0;
          justify-content: center;
        }
        header:not(.mobile-search-expanded) .search-genre-trigger-btn.has-active-genre {
          background: rgba(14, 165, 233, 0.25);
          box-shadow: inset 0 0 0 1.5px rgba(56, 189, 248, 0.78);
        }
        header:not(.mobile-search-expanded) .search-input-wrap input {
          padding: 0 24px 0 7px;
          font-size: 12px;
        }
        /* 100% Vollbreiten-Expansion der mobilen Suchleiste bei Klick/Fokus */
        header.mobile-search-expanded {
          gap: 0 !important;
        }
        header.mobile-search-expanded #sidebarToggleBtn,
        header.mobile-search-expanded #headerBrandLogo,
        header.mobile-search-expanded #mediaModeBanner,
        header.mobile-search-expanded #navBtnWishlist,
        header.mobile-search-expanded #heroHideBtn {
          width: 0 !important;
          min-width: 0 !important;
          max-width: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
          border-width: 0 !important;
          opacity: 0 !important;
          pointer-events: none !important;
          overflow: hidden !important;
        }
        header.mobile-search-expanded .search-bar {
          flex: 1 1 100% !important;
          width: 100% !important;
          border-color: rgba(var(--ambi-2), 0.78);
        }
        header.mobile-search-expanded .mobile-search-collapse-btn {
          display: inline-flex !important;
        }
        header.mobile-search-expanded .search-genre-trigger-btn {
          border-radius: 0;
          max-width: 96px;
          padding: 0 6px;
        }
        .search-autocomplete-box,
        .search-genre-dropdown-overlay {
          left: 8px;
          right: 8px;
        }
        .genre-overlay-grid {
          grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
        }
        .hero-curtain-shell { margin-top: -48px; margin-bottom: 0px; }
        .hero-stage-wrap { margin: 0; }
        .hero { min-height: 100vh; min-height: 100dvh; height: 100dvh; padding: 58px 14px 10px; border-radius: 0; }
        .hero-inner { min-height: clamp(320px, 64dvh, 540px); gap: 8px; }
        .hero-title-text { font-size: clamp(24px, 7vw, 34px); }
        .hero-desc { font-size: 12.5px; margin-bottom: 8px; }
        .hero-desc:not(.is-expanded) .expandable-desc-scroll { -webkit-line-clamp: 2; }
        .hero-desc.is-expanded .expandable-desc-scroll { max-height: 112px; }
        .hero-btn-play, .hero-btn-info, .hero-btn-wishlist { padding: 8px 13px !important; font-size: 12px !important; }
      }
      @media (max-width: 480px) {
        header #headerBrandLogo {
          display: none !important;
        }
      }

      .section { position: relative; z-index: 5; padding: 8px 14px; }
      .section-title { font-size: calc(13.5px * var(--scale-text)); font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; color: #e5e5e5; }
      .mode-bar { display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 0; align-items: center; }

      /* Flache, edle Glas-Filterleiste im Apple TV+ / Kino-Look */
      .floating-filter-bar {
        background: linear-gradient(135deg, rgba(10, 15, 28, 0.62) 0%, rgba(15, 23, 42, 0.48) 100%);
        backdrop-filter: blur(18px) saturate(1.3);
        -webkit-backdrop-filter: blur(18px) saturate(1.3);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 6px 10px;
        margin: 4px 0 12px;
        box-shadow: 0 8px 24px rgba(2, 6, 23, 0.28);
      }
      .ff-controls-grid {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
      }
      .ff-controls-grid > .btn {
        height: calc(33px * var(--scale-menu));
        box-sizing: border-box;
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.11);
        color: #e2e8f0;
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 700;
        padding: 0 11px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .ff-controls-grid > .btn:hover,
      .ff-controls-grid > .btn.spatial-focus {
        background: rgba(14, 165, 233, 0.18);
        border-color: rgba(56, 189, 248, 0.65);
        color: #ffffff;
      }
      @media (max-width: 640px) {
        .ff-controls-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .ff-controls-grid > select,
        .ff-controls-grid > .btn {
          width: 100%;
          min-width: 0;
          justify-content: center;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
      .ff-top-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
      .ff-dropdown-tabs { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; flex: 1; }
      .ff-tab-btn {
        background: rgba(255,255,255,0.06);
        color: #e2e8f0;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        padding: calc(5px * var(--scale-menu)) calc(9px * var(--scale-menu));
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.14s ease;
      }
      .ff-tab-btn:hover { background: rgba(14, 165, 233, 0.14); border-color: rgba(56, 189, 248, 0.35); }
      .ff-tab-btn.open { background: rgba(2, 132, 199, 0.28); border-color: #38bdf8; color: #fff; box-shadow: 0 3px 12px rgba(2, 132, 199, 0.25); }
      .ff-tab-btn.has-inc { border-color: var(--inc-border); background: var(--inc-bg); color: var(--inc-text); }
      .ff-tab-btn.has-exc { border-color: var(--exc-border); }

      /* Kompakte einheitliche 33px Glas-Dropdowns für Modus, Anbieter & Sortierung */
      .sort-select,
      .mode-filter-select,
      .new-filter-select {
        height: calc(33px * var(--scale-menu));
        box-sizing: border-box;
        background-color: rgba(255, 255, 255, 0.05);
        color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 9px;
        padding: 0 calc(10px * var(--scale-menu));
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 700;
        cursor: pointer;
        outline: none;
        color-scheme: dark;
        transition: border-color 0.14s ease, background-color 0.14s ease, color 0.14s ease;
      }
      .sort-select option,
      .mode-filter-select option,
      .new-filter-select option {
        background-color: #0f172a;
        color: #f8fafc;
      }
      .sort-select:hover,
      .sort-select.spatial-focus,
      .mode-filter-select:hover,
      .mode-filter-select.spatial-focus,
      .mode-filter-select.active-mode,
      .new-filter-select:hover,
      .new-filter-select.spatial-focus,
      .new-filter-select.active-new {
        border-color: rgba(56, 189, 248, 0.58);
        background-color: rgba(14, 165, 233, 0.14);
        color: #ffffff;
      }

      /* Direkt-Auswahl-Grid in der Sidebar (Farbkennung für Aktiviert vs. Gesperrt, 100% Zoom-fest) */
      .direct-filter-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(165px * var(--scale-menu))), 1fr));
        gap: 6px;
        margin-top: 6px;
      }
      .direct-filter-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 9px;
        padding: calc(5.5px * var(--scale-menu)) calc(8px * var(--scale-menu));
        transition: all 0.14s ease;
      }
      .direct-filter-card.state-inc { background: var(--inc-bg); border-color: var(--inc-border); }
      .direct-filter-card.state-exc { background: var(--exc-bg); border-color: var(--exc-border); }
      .df-label {
        flex: 1;
        min-width: 0;
        font-size: calc(12px * var(--scale-text));
        font-weight: 700;
        color: #f1f5f9;
        padding: 2px 3px;
        line-height: 1.3;
        cursor: default;
        user-select: none;
        pointer-events: none;
        white-space: normal;
        word-break: break-word;
      }
      .direct-filter-card.state-inc .df-label { color: var(--inc-text); }
      .direct-filter-card.state-exc .df-label { color: var(--exc-text); text-decoration: line-through; }
      .df-actions { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }
      .df-btn {
        border: 1px solid rgba(255,255,255,0.15);
        background: rgba(0,0,0,0.35);
        color: #cbd5e1;
        border-radius: 6px;
        width: 26px;
        height: 26px;
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 900;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.12s;
      }
      .df-btn .df-ico-sel { display: none; }
      .df-btn.inc:hover, .df-btn.inc.active { background: var(--inc-solid); border-color: var(--inc-border); color: #fff; }
      .df-btn.exc:hover, .df-btn.exc.active { background: var(--exc-solid); border-color: var(--exc-border); color: #fff; }
      /* Im aktivierten Zustand gibt die Selektion (Fokus / Hover) direkt Neutral (○) vor; kein doppeltes Aktivieren */
      .df-btn.is-neutral-on-select:hover,
      .df-btn.is-neutral-on-select.spatial-focus {
        background: rgba(148, 163, 184, 0.32) !important;
        border-color: #f8fafc !important;
        color: #ffffff !important;
      }
      .df-btn.is-neutral-on-select:hover .df-ico-cur,
      .df-btn.is-neutral-on-select.spatial-focus .df-ico-cur {
        display: none;
      }
      .df-btn.is-neutral-on-select:hover .df-ico-sel,
      .df-btn.is-neutral-on-select.spatial-focus .df-ico-sel {
        display: inline;
      }

      .ff-active-pills {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-wrap: wrap;
      }
      .ff-label { font-size: calc(11.5px * var(--scale-text)); font-weight: 700; color: #94a3b8; display: inline-flex; align-items: center; gap: 4px; }
      /* Reine Farbkennung bei aktiven Filtern (ohne überflüssiges Text-Präfix) */
      .f-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 700;
        padding: 4px 10px;
        border-radius: 999px;
        cursor: pointer;
        border: 1px solid transparent;
        transition: transform 0.12s, background 0.14s;
      }
      .f-pill:hover { transform: translateY(-1px); }
      .f-pill.inc { background: var(--inc-bg); color: var(--inc-text); border-color: var(--inc-border); }
      .f-pill.exc { background: var(--exc-bg); color: var(--exc-text); border-color: var(--exc-border); text-decoration: line-through; }
      .f-pill.neutral { background: rgba(255,255,255,0.08); color: #e2e8f0; border-color: rgba(255,255,255,0.18); }

      .sort-group {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: rgba(15,23,42,0.9);
        border: 1px solid rgba(148,163,184,0.3);
        border-radius: 999px;
        padding: 3px 6px;
        flex-wrap: wrap;
      }
      .sort-group-label { font-size: calc(10.5px * var(--scale-text)); font-weight: 800; color: #94a3b8; padding: 0 5px; text-transform: uppercase; }
      .sort-chip { background: transparent; color: #cbd5e1; border: 0; border-radius: 999px; padding: 4px 8px; font-size: calc(11px * var(--scale-text)); font-weight: 700; cursor: pointer; }
      .sort-chip.active { background: #3b82f6; color: #fff; }

      /* Ruhige 2:3 Katalog-Filmcover im Apple TV+ Stil mit integriertem unteren Farbverlauf & Hover-Glas-Aktionen */
      .carousel {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(calc(132px * var(--scale-cover)), 1fr));
        gap: calc(12px * var(--scale-cover));
        align-items: stretch;
      }
      .card {
        background: #0f172a;
        border-radius: 12px;
        aspect-ratio: 2 / 3;
        overflow: hidden;
        cursor: pointer;
        transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s ease, box-shadow 0.2s ease;
        border: 1px solid rgba(255, 255, 255, 0.10);
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.48);
        display: block;
        position: relative;
        content-visibility: auto;
        contain-intrinsic-size: 132px 198px;
        touch-action: pan-y;
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        user-select: none;
      }
      .card * {
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        user-select: none;
      }
      .card:hover,
      .card.spatial-focus {
        border-color: #38bdf8 !important;
        outline: 2px solid #38bdf8 !important;
        outline-offset: -2px !important;
        transform: translateY(-2px);
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.55), 0 14px 28px rgba(0, 0, 0, 0.75) !important;
      }
      .card:active { transform: scale(0.98); }
      .card-poster-wrap {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: linear-gradient(110deg, #0f172a 25%, #19253d 48%, #0f172a 72%);
        background-size: 200% 100%;
        touch-action: pan-y;
      }
      .card-poster-wrap img,
      .card > img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        background: #0f172a;
        display: block;
        pointer-events: none;
        -webkit-user-drag: none;
        -webkit-touch-callout: none;
        user-select: none;
        transition: opacity 0.24s ease, transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .card:hover .card-poster-wrap img,
      .card.spatial-focus .card-poster-wrap img {
        transform: scale(1.045);
      }
      .card-poster-wrap img.lazy-cover-img.is-loading {
        opacity: 0.18;
      }
      .card-poster-wrap img.lazy-cover-img.is-loaded {
        opacity: 1;
      }
      .card-top-left-stack {
        position: absolute;
        top: 7px;
        left: 7px;
        z-index: 4;
        display: flex;
        align-items: center;
        gap: 5px;
        pointer-events: none;
      }
      .card-rank-badge {
        font-size: calc(10px * var(--scale-text));
        font-weight: 900;
        padding: 2px 7px;
        border-radius: 6px;
        background: linear-gradient(135deg, #0284c7, #4338ca);
        color: #fff;
        box-shadow: 0 3px 10px rgba(0,0,0,0.85);
        border: 1px solid rgba(255,255,255,0.32);
        letter-spacing: 0.2px;
      }
      .card-type-badge {
        font-size: calc(9px * var(--scale-text));
        font-weight: 800;
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(10, 14, 24, 0.88);
        backdrop-filter: blur(8px);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.18);
      }
      /* Minimaler grüner VIP-Punkt oben links auf dem Cover */
      .card-vip-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #10b981;
        border: 1.5px solid #ffffff;
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.95), 0 2px 5px rgba(0, 0, 0, 0.85);
        display: inline-block;
        flex-shrink: 0;
        pointer-events: auto;
      }
      /* Lesezeichen-Button oben rechts: im Ruhezustand ruhig ausgeblendet (außer wenn gespeichert), bei Hover/Fokus edel sichtbar */
      .card-quick-save {
        position: absolute;
        top: 7px;
        right: 7px;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: rgba(10, 15, 28, 0.78);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.22);
        color: #fff;
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 5;
        opacity: 0;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55);
        transition: transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), background 0.14s, opacity 0.16s ease, border-color 0.14s;
      }
      @media (hover: none), (pointer: coarse) {
        .card-quick-save {
          opacity: 0.88;
          pointer-events: auto;
          width: 28px;
          height: 28px;
          font-size: 12px;
        }
        .card-quick-info,
        .card-quick-trailer {
          display: none !important;
        }
      }
      .card.long-press-active {
        transform: scale(0.96) !important;
        transition: transform 0.12s ease;
      }
      .card-quick-save.saved,
      .card:hover .card-quick-save,
      .card:focus-within .card-quick-save,
      .card.spatial-focus .card-quick-save,
      .card.card-subnav-active .card-quick-save {
        opacity: 1;
        pointer-events: auto;
      }
      .card.card-saved {
        border-color: rgba(16, 185, 129, 0.65) !important;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(16, 185, 129, 0.35);
      }
      .card-quick-save:hover,
      .card-quick-save.spatial-focus {
        opacity: 1;
        pointer-events: auto;
        transform: scale(1.12);
        background: #0ea5e9;
        color: #04101d;
        border-color: #fff;
        box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.55), 0 4px 12px rgba(0,0,0,0.85);
      }
      .card-quick-save.saved {
        background: linear-gradient(135deg, #10b981, #059669);
        border-color: #6ee7b7;
        color: #ffffff;
        font-weight: 900;
        box-shadow: 0 0 12px rgba(16, 185, 129, 0.55), 0 2px 8px rgba(0, 0, 0, 0.65);
      }
      .card-quick-save.saved.spatial-focus {
        border-color: #fff;
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.75), 0 4px 12px rgba(0,0,0,0.85);
      }
      @keyframes quickSavePop {
        0% { transform: scale(0.8); }
        45% { transform: scale(1.36); }
        75% { transform: scale(0.93); }
        100% { transform: scale(1); }
      }
      .card-quick-save.quick-save-pop {
        opacity: 1 !important;
        pointer-events: auto !important;
        animation: quickSavePop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }
      .detail-collapse-btn {
        width: 100%;
        text-align: left;
        justify-content: space-between;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: var(--text);
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        margin: 8px 0;
      }
      .detail-collapse-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.25);
      }
      body[data-theme="light"] .detail-collapse-btn {
        background: #f1f5f9;
        border-color: #cbd5e1;
        color: #0f172a;
      }
      body[data-theme="light"] .detail-collapse-btn:hover {
        background: #e2e8f0;
        border-color: #94a3b8;
      }
      /* Hover-Glas-Aktionen (▶ Trailer & ℹ️ Details) schweben über dem unteren Titel-Verlauf */
      .card-quick-trailer {
        position: absolute;
        bottom: 52px;
        right: 6px;
        z-index: 5;
        background: rgba(10, 15, 28, 0.88);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: #fff;
        border: 1px solid rgba(56, 189, 248, 0.65);
        border-radius: 999px;
        padding: 3px 8px;
        font-size: calc(10px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        opacity: 0;
        pointer-events: none;
        transform: translateY(4px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.75);
        transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1), transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), background 0.14s, border-color 0.14s, box-shadow 0.14s;
      }
      .card:hover .card-quick-trailer,
      .card:focus-within .card-quick-trailer,
      .card.spatial-focus .card-quick-trailer,
      .card.card-subnav-active .card-quick-trailer {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
      .card-quick-trailer:hover,
      .card-quick-trailer.spatial-focus {
        background: var(--red);
        border-color: #fff;
        transform: translateY(0) scale(1.06);
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.55), 0 4px 14px rgba(0,0,0,0.85);
      }
      .card-quick-info {
        position: absolute;
        bottom: 52px;
        left: 6px;
        z-index: 5;
        background: rgba(10, 15, 28, 0.88);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 999px;
        padding: 3px 8px;
        font-size: calc(10px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        opacity: 0;
        pointer-events: none;
        transform: translateY(4px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.75);
        transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1), transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), background 0.14s, border-color 0.14s, box-shadow 0.14s;
      }
      /* ℹ️ Details auf dem Cover im normalen Maus-Hover ausgeblendet (da Klick auf Karte bereits Details öffnet), nur im TV/Gamepad-Subnav-Modus sichtbar */
      .card.card-subnav-active .card-quick-info {
        display: inline-flex !important;
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
      .card-quick-info:hover,
      .card-quick-info.spatial-focus {
        background: var(--purple);
        border-color: #fff;
        color: #fff;
        transform: translateY(0) scale(1.06);
        box-shadow: 0 0 0 3px rgba(91, 70, 245, 0.6), 0 4px 14px rgba(0,0,0,0.85);
      }
      .card.card-subnav-active {
        border-color: var(--accent-primary) !important;
        box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.45), 0 12px 28px rgba(0,0,0,0.75);
      }
      /* Aufgeräumte Detail-Modal Nutzer-Aktionsleiste & eigene kompakte Admin-Leiste */
      .modal-actions-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 12px;
        margin-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .modal-actions-primary {
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
        align-items: center;
      }
      .modal-actions-tools {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
        align-items: center;
      }
      .btn-action-glass {
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(255, 255, 255, 0.16);
        color: #f8fafc;
        font-weight: 700;
        padding: 6px 12px;
        border-radius: 8px;
        font-size: calc(12px * var(--scale-text));
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.15s ease;
        text-decoration: none;
      }
      .btn-action-glass:hover,
      .btn-action-glass.spatial-focus {
        background: rgba(255, 255, 255, 0.14);
        border-color: rgba(255, 255, 255, 0.32);
        color: #ffffff;
      }
      .btn-action-glass.saved,
      .btn-action-glass.green {
        background: rgba(16, 185, 129, 0.16);
        border-color: rgba(16, 185, 129, 0.45);
        color: #6ee7b7;
      }
      .btn-tool-quiet {
        background: rgba(255, 255, 255, 0.035);
        border: 1px solid rgba(255, 255, 255, 0.09);
        color: #94a3b8;
        font-weight: 600;
        padding: 5px 9px;
        border-radius: 7px;
        font-size: calc(11.5px * var(--scale-text));
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.14s ease;
      }
      .btn-tool-quiet:hover,
      .btn-tool-quiet.spatial-focus {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.24);
        color: #f8fafc;
      }
      /* Edle einzeilige Metadaten- & Genre-Leisten im Detail-Header (Apple TV+ / Netflix Stil) */
      .modal-meta-inline {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 7px;
        font-size: calc(12.5px * var(--scale-text));
        font-weight: 600;
        color: #cbd5e1;
        line-height: 1.4;
      }
      .modal-meta-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .modal-meta-item.clickable {
        cursor: pointer;
        transition: color 0.14s ease;
      }
      .modal-meta-item.clickable:hover,
      .modal-meta-item.clickable.spatial-focus {
        color: #ffffff;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .modal-meta-rating {
        color: #fbbf24;
        font-weight: 800;
      }
      .modal-meta-fsk {
        padding: 1px 6px;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.06);
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        color: #e2e8f0;
        letter-spacing: 0.2px;
      }
      .modal-meta-dot {
        color: rgba(148, 163, 184, 0.55);
        font-weight: 900;
        user-select: none;
      }
      .modal-genre-inline {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-size: calc(12px * var(--scale-text));
        color: #94a3b8;
      }
      .modal-genre-link {
        color: #e2e8f0;
        font-weight: 600;
        cursor: pointer;
        transition: color 0.14s ease;
      }
      .modal-genre-link:hover,
      .modal-genre-link.spatial-focus {
        color: #ffffff;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      /* Kompakter integrierter Versandziel-Umschalter (in Staffel-Zeile oder Film-Header) */
      .delivery-inline-wrap {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .delivery-inline-pills {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 3px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.1);
        flex-wrap: wrap;
      }
      .delivery-inline-label {
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        color: #94a3b8;
        padding: 0 6px 0 5px;
        white-space: nowrap;
      }
      .delivery-pill-btn {
        background: transparent;
        border: 1px solid transparent;
        color: #94a3b8;
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.14s ease;
        white-space: nowrap;
      }
      .delivery-pill-btn:hover {
        color: #f8fafc;
        background: rgba(255, 255, 255, 0.06);
      }
      .delivery-pill-btn.active {
        background: rgba(255, 255, 255, 0.14);
        border-color: rgba(255, 255, 255, 0.22);
        color: #ffffff;
      }
      .delivery-config-drawer {
        padding: 10px 12px;
        border-radius: 9px;
        background: rgba(15, 23, 42, 0.78);
        border: 1px solid rgba(255, 255, 255, 0.12);
        margin-top: 4px;
        margin-bottom: 6px;
      }
      .season-toolbar-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      /* Kompakte Release-Box für mehrteilige Filme (CD 1 bis CD N nebeneinander) */
      .release-box-card {
        display: flex;
        flex-direction: column;
        gap: 9px;
        padding: 11px 13px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.09);
        transition: border-color 0.16s ease, background 0.16s ease;
      }
      .release-box-card:hover {
        border-color: rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.045);
      }
      .release-box-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        padding-bottom: 7px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      .release-cd-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        align-items: center;
      }
      .cd-part-chip-wrap {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .btn-cd-part {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 8px;
        background: rgba(14, 165, 233, 0.16);
        border: 1px solid rgba(56, 189, 248, 0.45);
        color: #ffffff;
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        transition: all 0.15s ease;
        font-variant-numeric: tabular-nums;
      }
      .btn-cd-part:hover,
      .btn-cd-part.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #ffffff;
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(14, 165, 233, 0.35);
      }
      .btn-cd-part .cd-size-sub {
        font-size: calc(11px * var(--scale-text));
        font-weight: 600;
        color: rgba(255, 255, 255, 0.78);
      }
      body[data-theme="light"] .release-box-card {
        background: #f8fafc;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .release-box-header {
        border-bottom-color: #e2e8f0;
      }
      body[data-theme="light"] .btn-cd-part {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0c4a6e;
      }
      body[data-theme="light"] .btn-cd-part .cd-size-sub {
        color: #0369a1;
      }
      body[data-theme="light"] .btn-cd-part:hover {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #0284c7;
        color: #ffffff;
      }
      body[data-theme="light"] .btn-cd-part:hover .cd-size-sub {
        color: rgba(255, 255, 255, 0.85);
      }
      body[data-theme="light"] .btn-action-glass {
        background: #f1f5f9;
        border-color: #cbd5e1;
        color: #0f172a;
      }
      body[data-theme="light"] .btn-action-glass:hover {
        background: #e2e8f0;
      }
      body[data-theme="light"] .btn-tool-quiet {
        background: #f8fafc;
        border-color: #cbd5e1;
        color: #475569;
      }
      body[data-theme="light"] .btn-tool-quiet:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
      body[data-theme="light"] .delivery-inline-pills {
        background: #f1f5f9;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .delivery-pill-btn {
        color: #475569;
      }
      body[data-theme="light"] .delivery-pill-btn.active {
        background: #0f172a;
        color: #ffffff;
      }
      body[data-theme="light"] .delivery-config-drawer {
        background: #f8fafc;
        border-color: #cbd5e1;
      }
      .card-body {
        position: absolute;
        inset: auto 0 0 0;
        z-index: 2;
        padding: 32px 10px 8px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 2px;
        background: linear-gradient(180deg, rgba(4, 7, 16, 0) 0%, rgba(4, 7, 16, 0.84) 48%, rgba(4, 7, 16, 0.98) 100%);
        pointer-events: none;
      }
      .card-title {
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        color: #ffffff;
        line-height: 1.24;
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: normal;
        word-break: break-word;
        overflow-wrap: anywhere;
        position: relative;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
      }
      .card-title-text {
        display: inline;
      }
      @keyframes cardTitleMarquee {
        0%, 14% { transform: translateX(0); }
        82%, 94% { transform: translateX(var(--marquee-dist, -45%)); }
        100% { transform: translateX(0); }
      }
      .card-title.is-marquee-overflow {
        display: flex !important;
        align-items: center;
        -webkit-line-clamp: unset !important;
        white-space: nowrap !important;
        overflow: hidden !important;
      }
      .card-title.is-marquee-overflow .card-title-text {
        display: inline-block;
        white-space: nowrap;
        padding-right: 18px;
        will-change: transform;
        animation: cardTitleMarquee var(--marquee-dur, 5.5s) ease-in-out infinite;
      }
      .card-sub {
        font-size: calc(10.5px * var(--scale-text));
        color: #cbd5e1;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 1px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      @keyframes cardFadeIn {
        from { opacity: 0.35; }
        to { opacity: 1; }
      }
      .card { animation: cardFadeIn 0.18s ease-out; }

      /* Sanfte Skeleton-Platzhalterkarten beim Nachladen statt hartem Ausgrauen (#21) */
      @keyframes skeletonShimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      .skeleton-card {
        aspect-ratio: 2 / 3;
        border-radius: 12px;
        overflow: hidden;
        background: #0f172a;
        border: 1px solid rgba(148, 163, 184, 0.12);
        position: relative;
        pointer-events: none;
      }
      .skeleton-poster {
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, rgba(15, 23, 42, 0.9) 25%, rgba(30, 41, 59, 0.95) 50%, rgba(15, 23, 42, 0.9) 75%);
        background-size: 200% 100%;
        animation: skeletonShimmer 1.35s infinite linear;
      }
      .skeleton-line {
        display: none;
      }

      /* Seiten-Anzeige (Seite X von Y) & Direkt-Seitenwahl (#17) */
      .pagination-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 16px;
        padding: 12px 10px;
        border-radius: 12px;
        background: var(--surface);
        border: 1px solid rgba(148, 163, 184, 0.16);
        box-shadow: 0 6px 20px rgba(2, 6, 23, 0.35);
      }
      .page-counter-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 5px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(var(--ambi-2), 0.34);
        color: var(--text);
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        transition: all 0.16s ease;
      }
      .page-counter-pill:hover,
      .page-counter-pill.spatial-focus {
        background: rgba(14, 165, 233, 0.22);
        border-color: #38bdf8;
        color: #ffffff;
        transform: translateY(-1px);
      }
      /* Smarter Floating-Seitenindikator unten rechts (öffnen per Touch, Maus oder TV-Remote) */
      #smartPageIndicatorBtn {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 74;
        display: none;
        align-items: center;
        gap: 7px;
        padding: 8px 14px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(8, 13, 24, 0.94) 0%, rgba(var(--ambi-1), 0.24) 100%);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(var(--ambi-2), 0.52);
        color: #f8fafc;
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.68), 0 0 18px rgba(var(--ambi-1), 0.16);
        opacity: 0.82;
        transform: translate3d(0, 0, 0);
        transition: opacity 0.22s ease, transform 0.18s ease, border-color 0.2s ease, box-shadow 0.2s ease;
      }
      #smartPageIndicatorBtn.is-scrolling-active,
      #smartPageIndicatorBtn:hover,
      #smartPageIndicatorBtn.spatial-focus {
        opacity: 1;
        border-color: #38bdf8;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.82), 0 0 0 2px rgba(56, 189, 248, 0.45);
        transform: translate3d(0, -2px, 0);
      }
      body.in-hero-slider #smartPageIndicatorBtn,
      body.in-hero-slider .catalog-back-to-top-fab {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      /* TV- & Touch-Seiten-Schnellwahl-Popup */
      .page-jump-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 220;
        background: rgba(2, 6, 23, 0.82);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        animation: fadeIn 0.15s ease;
      }
      .page-jump-modal-box {
        width: min(94vw, 460px);
        background: linear-gradient(165deg, rgba(11, 17, 30, 0.98) 0%, rgba(15, 23, 42, 0.96) 100%);
        border: 1px solid rgba(var(--ambi-2), 0.55);
        border-radius: 16px;
        padding: 18px;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.9);
        display: flex;
        flex-direction: column;
        gap: 14px;
        color: #f8fafc;
        font-variant-numeric: tabular-nums;
      }
      .page-step-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .page-step-btn {
        height: 40px;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.26);
        background: rgba(30, 41, 59, 0.78);
        color: #f1f5f9;
        font-size: calc(12.5px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.14s ease;
      }
      .page-step-btn:hover,
      .page-step-btn.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #2563eb);
        border-color: #7dd3fc;
        color: #ffffff;
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(2, 132, 199, 0.45);
      }
      .page-jump-slider {
        width: 100%;
        height: 8px;
        accent-color: #0ea5e9;
        cursor: pointer;
      }
      .page-jump-number-inp {
        width: 92px;
        height: 38px;
        border-radius: 9px;
        border: 1px solid rgba(56, 189, 248, 0.45);
        background: rgba(6, 9, 17, 0.9);
        color: #ffffff;
        font-size: 15px;
        font-weight: 900;
        text-align: center;
        font-variant-numeric: tabular-nums;
        outline: none;
      }
      .page-jump-number-inp:focus,
      .page-jump-number-inp.spatial-focus {
        border-color: #38bdf8;
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.35);
      }
      .page-jump-bar {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 12px 8px 6px;
        margin-top: 4px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }
      .page-jump-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        flex-wrap: wrap;
      }
      .page-jump-btn {
        min-width: 32px;
        height: 30px;
        padding: 0 8px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.14s ease;
      }
      .page-jump-btn:hover,
      .page-jump-btn.spatial-focus {
        background: var(--red);
        border-color: #fff;
        color: #fff;
        transform: translateY(-1px);
      }
      .page-jump-btn.active {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #7dd3fc;
        color: #fff;
        box-shadow: 0 4px 12px rgba(2, 132, 199, 0.38);
      }

      /* Alphabet-Schnellsprung A-Z in der Merkliste (#20) */
      .wl-az-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        overflow-x: auto;
        padding: 6px 6px 8px;
        margin-bottom: 8px;
        scrollbar-width: thin;
        box-sizing: border-box;
      }
      .wl-az-btn {
        min-width: 26px;
        height: 26px;
        padding: 0 6px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.05);
        color: #cbd5e1;
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.12s ease;
      }
      .wl-az-btn:hover,
      .wl-az-btn.spatial-focus {
        background: rgba(14, 165, 233, 0.25);
        border-color: var(--red);
        color: #fff;
      }
      .wl-az-btn.active {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #7dd3fc;
        color: #fff;
      }

      /* Zuletzt angesehene Titel (Quick-Resume Leiste) mit Einzel-Löschbutton (✕) & Komplett-Leeren (🗑️) */
      .recent-strip {
        display: flex;
        align-items: center;
        gap: 8px;
        overflow-x: auto;
        padding: 6px 6px 8px;
        scrollbar-width: thin;
        box-sizing: border-box;
      }
      .recent-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 999px;
        padding: 3px 6px 3px 4px;
        cursor: pointer;
        flex-shrink: 0;
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 700;
        color: var(--text);
        transition: all 0.14s;
      }
      .recent-chip:hover,
      .recent-chip.spatial-focus {
        border-color: var(--accent-primary);
        background: rgba(14, 165, 233, 0.14);
      }
      .recent-chip img {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        object-fit: cover;
      }
      .recent-chip-del {
        background: rgba(255,255,255,0.1);
        border: 0;
        color: #cbd5e1;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        font-size: 10px;
        font-weight: 900;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 0;
        margin-left: 2px;
      }
      .recent-chip-del:hover {
        background: var(--danger);
        color: #fff;
      }
      .load-more-wrap {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 12px 0 6px;
      }

      /* Größen-Anpassung Zeilen in der Sidebar */
      .scale-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; }
      .scale-row:last-child { border-bottom: 0; }
      .scale-label { font-size: calc(11.5px * var(--scale-text)); font-weight: 700; color: #e2e8f0; }
      .scale-opts { display: flex; gap: 4px; flex-wrap: wrap; }

      /* Premium Fullscreen App Detail-View im TelePort Kino-Slider-Design (1:1 Größe mit Slider + Unified Topbar) */
      body.modal-open-pause-hero .hero-dot.active .hero-thumb-progress-fill {
        animation-play-state: paused !important;
      }
      .modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
        background: var(--bg);
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
        touch-action: pan-y;
        padding: var(--sticky-header-height, 54px) 0 0 0;
        scroll-padding-top: calc(var(--sticky-header-height, 54px) + 18px);
        scroll-padding-bottom: 32px;
        animation: fadeIn 0.18s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .modal {
        background: var(--bg);
        border-radius: 0;
        max-width: 100%;
        width: 100%;
        min-height: calc(100vh - var(--sticky-header-height, 54px));
        min-height: calc(100dvh - var(--sticky-header-height, 54px));
        margin: 0;
        overflow: visible;
        border: 0;
        box-shadow: none;
        display: flex;
        flex-direction: column;
      }
      /* Natürliche Kicker-Zeile direkt über dem Filmtitel (ersetzt die alte künstliche Top-Extraleiste) */
      .detail-kicker-row {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
        margin-bottom: 2px;
      }
      .detail-active-filter-chip.muted {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 600;
        color: rgba(148, 163, 184, 0.78);
        background: rgba(15, 23, 42, 0.52);
        border: 1px solid rgba(148, 163, 184, 0.22);
        padding: 2px 8px;
        border-radius: 999px;
        filter: grayscale(0.45);
        user-select: none;
      }
      .return-last-detail-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(99, 102, 241, 0.22));
        border: 1px solid rgba(56, 189, 248, 0.58);
        color: #f0f9ff;
        padding: calc(3px * var(--scale-menu)) calc(10px * var(--scale-menu));
        border-radius: 999px;
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(2, 132, 199, 0.25);
        transition: all 0.16s ease;
      }
      .return-last-detail-chip:hover,
      .return-last-detail-chip.spatial-focus {
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.36), rgba(99, 102, 241, 0.36));
        border-color: #38bdf8;
        color: #ffffff;
        transform: translateY(-1px);
      }
      /* Sticky Mini-Header beim Runterscrollen auf der Detailseite */
      .detail-sticky-mini-header {
        position: fixed;
        top: var(--sticky-header-height, 54px);
        left: 0;
        right: 0;
        z-index: 115;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 28px;
        background: linear-gradient(90deg, rgba(6, 9, 18, 0.92) 0%, rgba(var(--ambi-1, 14, 165, 233), 0.18) 55%, rgba(6, 9, 18, 0.94) 100%);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border-bottom: 1px solid rgba(var(--ambi-1, 56, 189, 248), 0.28);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.65);
        opacity: 0;
        transform: translateY(-12px);
        pointer-events: none;
        transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .detail-sticky-mini-header.is-visible {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .detail-sticky-mini-left {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .detail-sticky-mini-title {
        font-size: calc(14px * var(--scale-text));
        font-weight: 900;
        color: #ffffff;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: min(460px, 52vw);
      }
      .detail-sticky-mini-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      /* 1:1 Identische Detail-Hero-Stage wie im Haupt-Slider (.hero) – Zero Jump */
      .detail-hero-stage {
        position: relative;
        z-index: 1;
        width: 100%;
        margin: 0;
        min-height: calc(100vh - var(--sticky-header-height, 54px));
        min-height: calc(100svh - var(--sticky-header-height, 54px));
        height: calc(100svh - var(--sticky-header-height, 54px));
        box-sizing: border-box;
        padding: 16px 28px 14px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        overflow: hidden;
        isolation: isolate;
        touch-action: pan-x pan-y;
        cursor: pointer;
        transition: opacity 0.18s ease;
      }
      #detailTitleBoxEl,
      #detailTitleBoxEl * {
        pointer-events: none !important;
        cursor: pointer !important;
      }
      .detail-hero-stage:has(.expandable-desc-box.is-expanded) {
        touch-action: pan-x pan-y;
      }
      .detail-stage-transitioning .detail-hero-stage,
      .detail-stage-transitioning .detail-content-body {
        opacity: 0.28;
        transform: translateX(var(--adj-slide-dir, 14px));
        transition: opacity 0.16s ease, transform 0.16s ease;
      }
      .detail-morph-enter .detail-content-body {
        animation: detailBodyRevealIn 0.28s cubic-bezier(0.22, 1, 0.36, 1);
      }
      @keyframes detailBodyRevealIn {
        from { opacity: 0; transform: translateY(14px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .detail-backdrop-layer {
        position: absolute;
        inset: 0;
        z-index: 0;
        background-image: var(--hero-bg-landscape);
        background-size: cover;
        background-position: center top;
        background-repeat: no-repeat !important;
        pointer-events: none;
        transform: translate3d(0, var(--detail-parallax-y, 0px), 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        will-change: transform;
      }
      @media (max-width: 640px), (orientation: portrait) {
        .detail-backdrop-layer {
          background-image:
            radial-gradient(circle at 50% 42%, rgba(2, 6, 18, 0) 22%, rgba(4, 7, 15, 0.76) 58%, rgba(4, 7, 15, 0.98) 88%),
            var(--hero-bg-portrait, var(--hero-bg-landscape)),
            radial-gradient(circle at 50% 42%, rgba(var(--ambi-1, 14, 165, 233), 0.34) 0%, rgba(var(--ambi-2, 37, 99, 235), 0.16) 46%, rgba(4, 7, 15, 0.98) 85%) !important;
          background-position: center center, center top, center center !important;
          background-size: 100% 100%, contain, 100% 100% !important;
          background-repeat: no-repeat, no-repeat, no-repeat !important;
          background-color: #04070f !important;
        }
      }
      .detail-backdrop-layer.is-ken-burns-active {
        animation: none !important;
      }
      /* Lautloser Hintergrund-Video-Teaser & Nahtloser Vordergrund-Kino-Modus (100% unbeschnitten ohne Zoom) */
      .detail-bg-video-layer {
        position: absolute;
        inset: 0;
        z-index: 0;
        overflow: hidden;
        pointer-events: none;
        opacity: 0;
        background: #03060d;
        transition: opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1), filter 0.32s ease;
      }
      .detail-bg-video-layer.is-concealing {
        opacity: 0 !important;
        transition: opacity 0.14s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }
      .detail-bg-video-layer.is-playing {
        opacity: 1;
      }
      /* Reiner Top-Bleed im overflow:hidden Container: schiebt YouTubes obere Titelzeile (~62px) aus dem Bild, belässt die Unterkante bündig bei 0px (kein Zoom, 100% unbeschnittene Untertitel!) */
      .detail-bg-video-frame {
        position: absolute;
        top: -64px;
        left: 0;
        right: 0;
        width: 100% !important;
        height: calc(100% + 64px) !important;
        transform-origin: 50% 50%;
        transform: translate3d(0, 0, 0) !important;
        clip-path: none !important;
        -webkit-clip-path: none !important;
        border: 0;
        pointer-events: none;
      }
      .detail-hero-stage.is-cc-safe-framing .detail-bg-video-frame,
      .hero.is-cc-safe-framing .detail-bg-video-frame {
        top: -64px;
        height: calc(100% + 64px) !important;
        transform: translate3d(0, 0, 0) !important;
      }
      @media (max-height: 460px) {
        .detail-bg-video-frame,
        .detail-hero-stage.is-cc-safe-framing .detail-bg-video-frame,
        .hero.is-cc-safe-framing .detail-bg-video-frame {
          top: -54px;
          height: calc(100% + 54px) !important;
        }
      }
      .detail-ambilight-glow {
        position: absolute;
        inset: -10%;
        z-index: 1;
        pointer-events: none;
        background:
          radial-gradient(58% 52% at 74% 26%, rgba(var(--ambi-1, 14, 165, 233), 0.16) 0%, transparent 72%),
          radial-gradient(50% 46% at 22% 72%, rgba(var(--ambi-2, 99, 102, 241), 0.14) 0%, transparent 74%);
        mix-blend-mode: screen;
        opacity: 0.78;
        transition: opacity 0.36s ease;
      }
      /* 1:1 Exakt derselbe kristallklare Scrim-Verlauf wie im Haupt-Slider (.hero-scrim-layer) */
      .detail-scrim-layer {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background:
          linear-gradient(180deg, rgba(5, 8, 16, 0.22) 0%, rgba(5, 8, 16, 0) 48px),
          linear-gradient(0deg, var(--bg) 0%, rgba(6, 9, 17, 0.92) 9%, rgba(6, 9, 17, 0.44) 24%, rgba(6, 9, 17, 0.08) 42%, rgba(6, 9, 17, 0) 58%),
          linear-gradient(90deg, rgba(4, 7, 15, 0.84) 0%, rgba(4, 7, 15, 0.62) 22%, rgba(4, 7, 15, 0.28) 44%, rgba(4, 7, 15, 0.05) 64%, rgba(4, 7, 15, 0) 78%),
          linear-gradient(90deg, var(--bg) 0%, rgba(5, 8, 16, 0) 3%, rgba(5, 8, 16, 0) 97%, var(--bg) 100%);
        transform: translate3d(0, 0, 0);
        transition: opacity 0.36s ease;
      }
      .detail-hero-stage.hero-bright-backdrop .detail-scrim-layer {
        background:
          linear-gradient(180deg, rgba(5, 8, 16, 0.28) 0%, rgba(5, 8, 16, 0) 56px),
          linear-gradient(0deg, var(--bg) 0%, rgba(5, 8, 16, 0.95) 11%, rgba(5, 8, 16, 0.52) 27%, rgba(5, 8, 16, 0.12) 45%, rgba(5, 8, 16, 0) 62%),
          linear-gradient(90deg, rgba(4, 7, 15, 0.92) 0%, rgba(4, 7, 15, 0.76) 26%, rgba(4, 7, 15, 0.42) 48%, rgba(4, 7, 15, 0.10) 68%, rgba(4, 7, 15, 0) 84%),
          linear-gradient(90deg, var(--bg) 0%, rgba(5, 8, 16, 0) 3%, rgba(5, 8, 16, 0) 97%, var(--bg) 100%);
      }
      @media (orientation: portrait), (max-width: 640px) {
        .detail-scrim-layer,
        .detail-hero-stage.hero-bright-backdrop .detail-scrim-layer {
          background:
            linear-gradient(180deg, rgba(4, 7, 15, 0.22) 0%, rgba(4, 7, 15, 0) 48px),
            linear-gradient(0deg, var(--bg) 0%, rgba(5, 8, 16, 0.96) 14%, rgba(5, 8, 16, 0.74) 30%, rgba(5, 8, 16, 0.24) 46%, rgba(5, 8, 16, 0) 64%) !important;
        }
      }
      .detail-scroll-dim-overlay {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background: var(--bg);
        opacity: var(--detail-scroll-dim, 0);
      }
      .detail-hero-content {
        position: relative;
        z-index: 2;
        min-width: 0;
        max-width: 600px;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 4px 0;
        transition: opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1), transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .detail-hero-stage .hero-bottom-bar,
      .hero .hero-content,
      .hero .hero-bottom-bar {
        transition: opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1), transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
      }
      /* Vordergrund-Trailer-Modus (Beim Klick auf Szenenbild, Video oder "Trailer": ALLE Elemente blenden im Detail-View UND im Hauptslider aus) */
      .modal-backdrop:has(.detail-hero-stage.is-trailer-foreground-mode) {
        overflow: hidden !important;
      }
      .modal:has(.detail-hero-stage.is-trailer-foreground-mode) .detail-content-body,
      .modal:has(.detail-hero-stage.is-trailer-foreground-mode) .detail-sticky-mini-header {
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity 0.26s ease;
      }
      .detail-hero-stage.is-trailer-foreground-mode .detail-hero-content,
      .detail-hero-stage.is-trailer-foreground-mode .hero-bottom-bar,
      .detail-hero-stage.is-trailer-foreground-mode .detail-ambilight-glow,
      .detail-hero-stage.is-trailer-foreground-mode .detail-scroll-dim-overlay,
      .hero.is-trailer-foreground-mode .hero-content,
      .hero.is-trailer-foreground-mode .hero-bottom-bar,
      .hero.is-trailer-foreground-mode .hero-scroll-dim-overlay,
      .hero-stage-wrap:has(.hero.is-trailer-foreground-mode) .hero-ambilight-glow,
      .hero-stage-wrap:has(.hero.is-trailer-foreground-mode) .hero-ambilight-beams {
        opacity: 0 !important;
        pointer-events: none !important;
        transform: translateY(10px);
      }
      .detail-hero-stage.is-trailer-foreground-mode .detail-scrim-layer,
      .hero.is-trailer-foreground-mode .hero-scrim-layer {
        opacity: 0 !important;
      }
      .detail-hero-stage.is-trailer-foreground-mode .detail-bg-video-layer.is-playing,
      .hero.is-trailer-foreground-mode .detail-bg-video-layer.is-playing {
        opacity: 1 !important;
        z-index: 3;
        filter: brightness(1.02) contrast(1.02);
      }
      /* Gleichmäßige, sanfte Kino-Abdunklung im Pause-Zustand – komplett ohne harte Kanten oder Schattenboxen! */
      .detail-hero-stage.is-trailer-foreground-mode.is-cinema-paused:not(.is-cinema-ended) .detail-bg-video-layer.is-playing,
      .hero.is-trailer-foreground-mode.is-cinema-paused:not(.is-cinema-ended) .detail-bg-video-layer.is-playing {
        filter: brightness(0.76) contrast(1.02);
      }
      body:has(.is-trailer-foreground-mode) #floatingImportStatusWidget {
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }
      .detail-hero-stage.is-trailer-foreground-mode .detail-bg-video-frame,
      .hero.is-trailer-foreground-mode .detail-bg-video-frame {
        clip-path: none !important;
        -webkit-clip-path: none !important;
      }
      .detail-foreground-stage-catcher {
        position: absolute;
        inset: 0;
        z-index: 4;
        display: none;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
      }
      .detail-foreground-stage-catcher.is-cursor-idle,
      .hero.is-trailer-foreground-mode.is-cinema-controls-idle,
      .hero.is-trailer-foreground-mode.is-cinema-controls-idle *,
      .detail-hero-stage.is-trailer-foreground-mode.is-cinema-controls-idle,
      .detail-hero-stage.is-trailer-foreground-mode.is-cinema-controls-idle * {
        cursor: none !important;
      }
      .cinema-end-countdown-num {
        font-variant-numeric: tabular-nums;
        opacity: 0.85;
      }
      .detail-hero-stage.is-trailer-foreground-mode .detail-foreground-stage-catcher,
      .hero.is-trailer-foreground-mode .detail-foreground-stage-catcher {
        display: block;
      }
      /* Glas-Ripple-Feedback bei Doppel-Tipp ±10s Spulen & Play/Pause */
      .detail-seek-ripple-badge {
        position: absolute;
        top: 50%;
        z-index: 15;
        transform: translate(-50%, -50%) scale(0.86);
        padding: 10px 20px;
        border-radius: 999px;
        background: rgba(8, 13, 24, 0.86);
        backdrop-filter: blur(22px) saturate(180%);
        -webkit-backdrop-filter: blur(22px) saturate(180%);
        border: 1px solid rgba(56, 189, 248, 0.52);
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.78), 0 0 22px rgba(var(--ambi-1, 14, 165, 233), 0.25);
        color: #ffffff;
        font-size: calc(14px * var(--scale-text));
        font-weight: 900;
        letter-spacing: 0.02em;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .detail-seek-ripple-badge.is-left { left: 22%; }
      .detail-seek-ripple-badge.is-center { left: 50%; }
      .detail-seek-ripple-badge.is-right { left: 78%; }
      .detail-seek-ripple-badge.is-visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      .detail-seek-ripple-badge.is-loading-pulse {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
        animation: detailTrailerLoadingPulse 1.2s ease-in-out infinite alternate;
      }
      @keyframes detailTrailerLoadingPulse {
        from { opacity: 0.72; transform: translate(-50%, -50%) scale(0.97); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1.02); }
      }
      /* Blickdichtes TelePort-Badge unten rechts (ohne Transparenz – deckt den YouTube-Button unten rechts komplett ab, ohne Untertitel in der Mitte zu berühren) */
      .cinema-teleport-watermark {
        position: absolute;
        right: 4px;
        bottom: 4px;
        min-width: 142px;
        min-height: 44px;
        z-index: 15;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 8px 18px 8px 14px;
        border-radius: 999px;
        background: #060a14;
        border: 1px solid rgba(56, 189, 248, 0.36);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.72);
        color: #f8fafc;
        font-size: calc(13px * var(--scale-text));
        font-weight: 900;
        letter-spacing: 0.03em;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        opacity: 0;
        transition: opacity 0.24s ease;
      }
      .cinema-teleport-watermark svg,
      .cinema-dock-brand svg {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }
      .cinema-teleport-watermark .tp-accent,
      .cinema-dock-brand .tp-accent {
        color: #38bdf8;
      }
      .detail-hero-stage.is-trailer-foreground-mode .cinema-teleport-watermark,
      .hero.is-trailer-foreground-mode .cinema-teleport-watermark {
        opacity: 1;
      }
      .detail-hero-stage.is-trailer-foreground-mode:has(.detail-cinema-player-dock:not(.is-idle-hidden)) .cinema-teleport-watermark,
      .hero.is-trailer-foreground-mode:has(.detail-cinema-player-dock:not(.is-idle-hidden)) .cinema-teleport-watermark {
        opacity: 0;
      }
      /* Nahtloses, kantenfreies 2-Ebenen Cinema-Player-Overlay (ohne Schattenbox oder harte Blur-Kante) */
      .detail-cinema-player-dock {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 16;
        width: 100%;
        min-height: 92px;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
        padding: 28px 22px 14px;
        border-radius: 0;
        background: linear-gradient(180deg, rgba(4, 7, 15, 0) 0%, rgba(4, 7, 15, 0.24) 28%, rgba(4, 7, 15, 0.62) 66%, rgba(4, 7, 15, 0.86) 100%);
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        border-top: none;
        box-shadow: none;
        color: #f8fafc;
        box-sizing: border-box;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translate3d(0, 12px, 0);
        transition: opacity 0.24s cubic-bezier(0.22, 1, 0.36, 1), transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), visibility 0.24s linear, background 0.2s ease;
      }
      .hero:not(.is-trailer-foreground-mode) .detail-cinema-player-dock,
      .detail-hero-stage:not(.is-trailer-foreground-mode) .detail-cinema-player-dock {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transform: translate3d(0, 12px, 0) !important;
      }
      .detail-hero-stage.is-trailer-foreground-mode .detail-cinema-player-dock,
      .hero.is-trailer-foreground-mode .detail-cinema-player-dock {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: translate3d(0, 0, 0);
      }
      .detail-cinema-player-dock.is-idle-hidden {
        opacity: 0 !important;
        pointer-events: none !important;
        transform: translate3d(0, 10px, 0) !important;
      }
      .detail-cinema-player-dock:hover,
      .detail-cinema-player-dock:focus-within {
        background: linear-gradient(180deg, rgba(4, 7, 15, 0) 0%, rgba(4, 7, 15, 0.30) 28%, rgba(4, 7, 15, 0.68) 66%, rgba(4, 7, 15, 0.90) 100%);
      }
      .detail-hero-stage.is-cc-safe-framing .detail-cinema-player-dock,
      .hero.is-cc-safe-framing .detail-cinema-player-dock {
        bottom: 0;
      }
      .cinema-dock-controls-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        min-height: 40px;
      }
      .cinema-dock-controls-left,
      .cinema-dock-controls-right {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .cinema-dock-controls-right {
        margin-left: auto;
      }
      .cinema-dock-brand {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: 4px;
        padding-left: 12px;
        border-left: 1px solid rgba(255, 255, 255, 0.14);
        color: #f8fafc;
        font-size: calc(13px * var(--scale-text));
        font-weight: 900;
        letter-spacing: 0.03em;
        white-space: nowrap;
        flex-shrink: 0;
        user-select: none;
        -webkit-user-select: none;
        pointer-events: none;
      }
      /* Sanft auslaufende Auto-Hide Kino-Kopfzeile oben (kein harter schwarzer Balken, verschwindet im Idle komplett) */
      .cinema-top-hud {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 16;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 16px 20px 32px;
        background: linear-gradient(180deg, rgba(4, 7, 15, 0.56) 0%, rgba(4, 7, 15, 0.22) 52%, rgba(4, 7, 15, 0) 100%);
        pointer-events: none;
        opacity: 0;
        visibility: hidden;
        transform: translate3d(0, -10px, 0);
        transition: opacity 0.24s cubic-bezier(0.16, 1, 0.3, 1), transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.24s linear;
      }
      .detail-hero-stage.is-trailer-foreground-mode .cinema-top-hud,
      .hero.is-trailer-foreground-mode .cinema-top-hud {
        opacity: 1;
        visibility: visible;
        transform: translate3d(0, 0, 0);
      }
      .cinema-top-hud.is-idle-hidden {
        opacity: 0 !important;
        transform: translate3d(0, -10px, 0) !important;
        pointer-events: none !important;
      }
      .cinema-top-hud-info {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        pointer-events: none;
      }
      .cinema-top-hud-title {
        font-size: calc(16px * var(--scale-text));
        font-weight: 800;
        color: #f8fafc;
        letter-spacing: 0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.72);
      }
      .cinema-top-hud-meta {
        font-size: calc(12px * var(--scale-text));
        font-weight: 600;
        color: rgba(226, 232, 240, 0.84);
        letter-spacing: 0.02em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-variant-numeric: tabular-nums;
      }
      .cinema-top-hud-close {
        min-width: 44px;
        min-height: 44px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(8, 13, 24, 0.76);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        color: #f8fafc;
        font-size: calc(14px * var(--scale-text));
        font-weight: 800;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        cursor: pointer;
        pointer-events: auto;
        white-space: nowrap;
        flex-shrink: 0;
        transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
      }
      .cinema-top-hud-close:hover,
      .cinema-top-hud-close:focus-visible,
      .cinema-top-hud-close.spatial-focus {
        background: rgba(56, 189, 248, 0.24);
        border-color: rgba(56, 189, 248, 0.72);
        transform: scale(1.04);
        outline: none;
      }
      /* Blickdichter Lade-Indikator in der Bildmitte (verdeckt YouTubes mittigen Start-/Pause-Indikator komplett, ohne Schattenbox) */
      .cinema-start-center-shield {
        position: absolute;
        top: 50%;
        left: 50%;
        z-index: 14;
        width: 88px;
        height: 88px;
        border-radius: 50%;
        border: 1.5px solid rgba(56, 189, 248, 0.28);
        background: #060a14;
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.68), 0 0 24px rgba(var(--ambi-1, 14, 165, 233), 0.22);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        opacity: 0;
        transform: translate3d(-50%, -50%, 0) scale(0.88);
        transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .cinema-start-center-shield::after {
        content: "";
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.16);
        border-top-color: #38bdf8;
        animation: cinemaStartShieldSpin 0.82s linear infinite;
      }
      @keyframes cinemaStartShieldSpin {
        to { transform: rotate(360deg); }
      }
      .detail-hero-stage.is-trailer-foreground-mode.is-cinema-starting:not(.is-cinema-paused):not(.is-cinema-ended) .cinema-start-center-shield,
      .hero.is-trailer-foreground-mode.is-cinema-starting:not(.is-cinema-paused):not(.is-cinema-ended) .cinema-start-center-shield {
        opacity: 1;
        transform: translate3d(-50%, -50%, 0) scale(1);
        transition-duration: 0.08s;
      }
      .cinema-start-bottom-shield {
        display: none !important;
      }
      /* Blickdichter Play-Button in der Mitte & schwebende Schnellaktionsleiste im Pause-Zustand (verdeckt YouTube-Center-Icon ohne Schattenbox) */
      .cinema-pause-center-btn {
        position: absolute;
        top: 50%;
        left: 50%;
        z-index: 15;
        width: 96px;
        height: 96px;
        padding: 0;
        margin: 0;
        line-height: 0;
        border-radius: 50%;
        border: 1.5px solid rgba(255, 255, 255, 0.32);
        background: #080f1e;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.68), 0 0 28px rgba(var(--ambi-1, 14, 165, 233), 0.26);
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translate3d(-50%, -50%, 0) scale(0.86) !important;
        transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.2s linear, border-color 0.18s ease, background 0.18s ease;
      }
      .cinema-pause-center-btn svg {
        width: 36px;
        height: 36px;
        display: block;
        flex-shrink: 0;
      }
      .detail-hero-stage.is-trailer-foreground-mode.is-cinema-paused:not(.is-cinema-ended) .cinema-pause-center-btn,
      .hero.is-trailer-foreground-mode.is-cinema-paused:not(.is-cinema-ended) .cinema-pause-center-btn {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: translate3d(-50%, -50%, 0) scale(1) !important;
      }
      .cinema-pause-center-btn:hover,
      .cinema-pause-center-btn:focus-visible,
      .cinema-pause-center-btn.spatial-focus {
        border-color: rgba(56, 189, 248, 0.95);
        background: #0f203d;
        transform: translate3d(-50%, -50%, 0) scale(1.06) !important;
        outline: none !important;
      }
      .cinema-pause-bottom-curtain {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 102px;
        min-height: 0;
        z-index: 15;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: 0 24px;
        box-sizing: border-box;
        background: none;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translate3d(0, 10px, 0);
        transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.22s linear;
      }
      .detail-hero-stage.is-trailer-foreground-mode.is-cinema-paused:not(.is-cinema-ended) .cinema-pause-bottom-curtain,
      .hero.is-trailer-foreground-mode.is-cinema-paused:not(.is-cinema-ended) .cinema-pause-bottom-curtain {
        opacity: 1;
        visibility: visible;
        pointer-events: none;
        transform: translate3d(0, 0, 0);
      }
      .cinema-pause-quick-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 12px;
        max-width: 100%;
        pointer-events: auto;
      }
      .cinema-overlay-btn {
        min-height: 44px;
        padding: 0 20px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.22);
        background: rgba(15, 23, 42, 0.78);
        backdrop-filter: blur(18px) saturate(150%);
        -webkit-backdrop-filter: blur(18px) saturate(150%);
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
        color: #f8fafc;
        font-size: calc(13.5px * var(--scale-text));
        font-weight: 800;
        letter-spacing: 0.01em;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
      }
      .cinema-overlay-btn svg {
        width: 16px;
        height: 16px;
        display: block;
        flex-shrink: 0;
      }
      .cinema-overlay-btn:hover,
      .cinema-overlay-btn:focus-visible,
      .cinema-overlay-btn.spatial-focus {
        background: rgba(56, 189, 248, 0.28);
        border-color: rgba(56, 189, 248, 0.92);
        color: #ffffff;
        transform: translateY(-1px) scale(1.04);
        box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.92), 0 0 22px rgba(56, 189, 248, 0.45);
        outline: none;
      }
      .cinema-overlay-btn.is-primary {
        background: #f8fafc;
        border-color: #ffffff;
        color: #060a14;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.52);
      }
      .cinema-overlay-btn.is-primary:hover,
      .cinema-overlay-btn.is-primary:focus-visible,
      .cinema-overlay-btn.is-primary.spatial-focus {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #060a14;
        transform: translateY(-1px) scale(1.05);
        box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.95), 0 0 24px rgba(56, 189, 248, 0.55);
      }
      .cinema-dock-btn.spatial-focus,
      .cinema-dock-scrubber.spatial-focus,
      .cinema-vol-step-btn.spatial-focus,
      .cinema-top-hud-close.spatial-focus,
      .cinema-pause-center-btn.spatial-focus {
        box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.92), 0 0 18px rgba(56, 189, 248, 0.45) !important;
        border-color: rgba(56, 189, 248, 0.95) !important;
      }
      /* Dezentes Ende-Overlay (erst bei echtem Video-Ende pState === 0) */
      .cinema-end-overlay {
        position: absolute;
        inset: 0;
        z-index: 15;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        padding: 88px 24px 108px;
        box-sizing: border-box;
        background: radial-gradient(circle at 50% 44%, rgba(8, 13, 24, 0.80) 0%, rgba(4, 7, 15, 0.94) 100%);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        text-align: center;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: scale(0.98);
        transition: opacity 0.26s cubic-bezier(0.16, 1, 0.3, 1), transform 0.26s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.26s linear;
      }
      .detail-hero-stage.is-trailer-foreground-mode.is-cinema-ended .cinema-end-overlay,
      .hero.is-trailer-foreground-mode.is-cinema-ended .cinema-end-overlay {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: scale(1);
      }
      .cinema-end-kicker {
        font-size: calc(12px * var(--scale-text));
        font-weight: 700;
        color: rgba(148, 163, 184, 0.92);
        letter-spacing: 0.04em;
      }
      .cinema-end-title {
        font-size: clamp(20px, 2.6vw, 30px);
        font-weight: 900;
        color: #f8fafc;
        max-width: min(560px, 92%);
        text-wrap: balance;
        line-height: 1.2;
      }
      .cinema-end-actions {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 6px;
      }
      @media (max-width: 640px) {
        .cinema-top-hud {
          padding: 12px 12px 24px;
          gap: 10px;
        }
        .cinema-top-hud-title {
          font-size: 14px;
        }
        .cinema-start-center-shield {
          width: 68px;
          height: 68px;
        }
        .cinema-pause-center-btn {
          width: 72px;
          height: 72px;
        }
        .cinema-pause-center-btn svg {
          width: 28px;
          height: 28px;
        }
        .cinema-pause-bottom-curtain {
          bottom: 92px;
          min-height: 0;
          padding: 0 12px;
        }
        .cinema-overlay-btn {
          min-height: 42px;
          padding: 0 14px;
          font-size: 12.5px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .detail-bg-video-frame,
        .cinema-top-hud,
        .cinema-start-center-shield,
        .cinema-start-bottom-shield,
        .cinema-pause-center-btn,
        .cinema-pause-bottom-curtain,
        .cinema-end-overlay {
          transition-duration: 0.01ms !important;
        }
      }
      .cinema-dock-btn {
        height: 38px;
        min-width: 38px;
        padding: 0 12px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(8, 13, 24, 0.56);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: #f8fafc;
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        box-sizing: border-box;
        transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.16s ease;
      }
      .cinema-dock-btn svg {
        width: 16px;
        height: 16px;
        display: block;
        flex-shrink: 0;
      }
      #heroCinemaPlayBtn,
      #heroCinemaRestartBtn,
      #detailCinemaPlayBtn,
      #detailCinemaRestartBtn {
        width: 38px;
        height: 38px;
        min-width: 38px;
        padding: 0;
        border-radius: 50%;
        line-height: 0;
      }
      #heroCinemaMuteBtn,
      #detailCinemaMuteBtn {
        height: 38px;
        min-width: 38px;
        padding: 0 11px;
        border-radius: 999px;
        gap: 6px;
      }
      .cinema-vol-mini-pct {
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: rgba(226, 232, 240, 0.88);
        letter-spacing: 0.01em;
      }
      #heroCinemaPlayBtn,
      #detailCinemaPlayBtn {
        background: rgba(56, 189, 248, 0.22);
        border-color: rgba(56, 189, 248, 0.48);
        color: #ffffff;
      }
      /* Vertikales Lautstärke-Popover über dem Ton-Button (Pfeil Hoch/Runter = Lauter/Leiser, Links/Rechts = Nahtlose Dock-Navigation ohne Falle!) */
      .cinema-dock-vol-group {
        position: relative;
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
      }
      .cinema-vol-popover {
        position: absolute;
        left: 50%;
        bottom: calc(100% + 12px);
        z-index: 24;
        width: 56px;
        padding: 9px 7px 8px;
        border-radius: 16px;
        background: rgba(8, 13, 24, 0.94);
        backdrop-filter: blur(22px) saturate(180%);
        -webkit-backdrop-filter: blur(22px) saturate(180%);
        border: 1px solid rgba(56, 189, 248, 0.42);
        box-shadow: 0 16px 38px rgba(0, 0, 0, 0.82), 0 0 22px rgba(14, 165, 233, 0.22);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 7px;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translate3d(-50%, 8px, 0) scale(0.94);
        transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1), transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), visibility 0.18s linear;
      }
      .cinema-vol-popover::after {
        content: "";
        position: absolute;
        left: -6px;
        right: -6px;
        top: 100%;
        height: 16px;
      }
      .cinema-dock-vol-group:hover .cinema-vol-popover,
      .cinema-dock-vol-group:focus-within .cinema-vol-popover,
      .cinema-dock-vol-group.is-vol-popover-open .cinema-vol-popover {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: translate3d(-50%, 0, 0) scale(1);
      }
      .cinema-vol-pct-lbl {
        font-size: 11px;
        font-weight: 900;
        font-variant-numeric: tabular-nums;
        color: #e0f2fe;
        line-height: 1;
        letter-spacing: 0.01em;
      }
      .cinema-vol-step-btn {
        width: 34px;
        height: 28px;
        padding: 0;
        border-radius: 9px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.08);
        color: #f8fafc;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.14s ease, border-color 0.14s ease, transform 0.14s ease, color 0.14s ease;
      }
      .cinema-vol-step-btn svg {
        width: 15px;
        height: 15px;
        display: block;
      }
      .cinema-vol-step-btn:hover,
      .cinema-vol-step-btn.is-step-pulse {
        background: rgba(56, 189, 248, 0.34);
        border-color: #38bdf8;
        color: #ffffff;
        transform: scale(1.08);
      }
      .cinema-vol-meter-hit {
        position: relative;
        width: 34px;
        height: 92px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      .cinema-vol-meter-track {
        position: relative;
        width: 6px;
        height: 82px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        overflow: visible;
      }
      .cinema-vol-meter-fill {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: var(--vol-pct, 85%);
        border-radius: 999px;
        background: linear-gradient(0deg, #0284c7 0%, #38bdf8 100%);
        box-shadow: 0 0 10px rgba(56, 189, 248, 0.55);
        transition: height 0.1s ease-out;
      }
      .cinema-vol-meter-thumb {
        position: absolute;
        left: 50%;
        bottom: var(--vol-pct, 85%);
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #ffffff;
        border: 2px solid #38bdf8;
        box-shadow: 0 0 10px rgba(56, 189, 248, 0.85);
        transform: translate(-50%, 50%);
        transition: bottom 0.1s ease-out, transform 0.14s ease;
      }
      .cinema-vol-meter-hit:hover .cinema-vol-meter-thumb {
        transform: translate(-50%, 50%) scale(1.16);
      }
      .cinema-vol-kb-hint {
        font-size: 9.5px;
        font-weight: 800;
        color: rgba(148, 163, 184, 0.9);
        letter-spacing: 0.03em;
        line-height: 1;
      }
      .cinema-dock-cc-btn {
        min-width: 42px;
        padding: 0 10px;
        letter-spacing: 0.03em;
        font-size: calc(11.5px * var(--scale-text));
      }
      .cinema-dock-cc-btn.is-cc-active,
      .cinema-dock-speed-btn.is-speed-active {
        background: rgba(14, 165, 233, 0.26);
        border-color: rgba(56, 189, 248, 0.72);
        color: #e0f2fe;
        box-shadow: 0 0 12px rgba(56, 189, 248, 0.24);
      }
      .cinema-dock-speed-btn {
        min-width: 40px;
        padding: 0 9px;
        font-size: calc(11.5px * var(--scale-text));
        font-variant-numeric: tabular-nums;
      }
      .cinema-dock-btn:hover,
      .cinema-dock-btn.spatial-focus {
        background: rgba(56, 189, 248, 0.28) !important;
        border-color: #38bdf8 !important;
        color: #ffffff !important;
        box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.36), 0 6px 16px rgba(14, 165, 233, 0.35);
        transform: translateY(-1px);
      }
      .cinema-dock-btn.is-active-mode {
        background: rgba(255, 255, 255, 0.11);
        border-color: rgba(255, 255, 255, 0.24);
        color: #ffffff;
      }
      /* Full-Width Timeline-Zeile (Ebene 1 oben im Dock) */
      .cinema-dock-timeline-wrap {
        position: relative;
        width: 100%;
        display: flex;
        align-items: center;
        padding: 4px 0 2px;
      }
      .cinema-scrub-tooltip {
        position: absolute;
        left: var(--tooltip-pct, 0%);
        bottom: calc(100% + 6px);
        transform: translate3d(-50%, 4px, 0);
        padding: 4px 9px;
        border-radius: 8px;
        background: rgba(8, 13, 24, 0.94);
        border: 1px solid rgba(56, 189, 248, 0.45);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.72);
        color: #f8fafc;
        font-size: 11px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.14s ease, transform 0.14s ease;
        z-index: 20;
      }
      .cinema-scrub-tooltip.is-visible {
        opacity: 1;
        transform: translate3d(-50%, 0, 0);
      }
      .cinema-scrub-kb-hint {
        position: absolute;
        right: 0;
        bottom: calc(100% + 7px);
        padding: 3px 9px;
        border-radius: 999px;
        background: rgba(8, 13, 24, 0.92);
        border: 1px solid rgba(56, 189, 248, 0.55);
        color: #bae6fd;
        font-size: 10.5px;
        font-weight: 800;
        letter-spacing: 0.02em;
        pointer-events: none;
        opacity: 0;
        transform: translate3d(0, 4px, 0);
        transition: opacity 0.16s ease, transform 0.16s ease;
        z-index: 19;
      }
      .cinema-dock-timeline-wrap:has(.cinema-dock-scrubber.spatial-focus) .cinema-scrub-kb-hint {
        opacity: 1;
        transform: translate3d(0, 0, 0);
      }
      .cinema-dock-scrubber {
        -webkit-appearance: none;
        appearance: none;
        flex: 1;
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: linear-gradient(90deg, #38bdf8 0%, #38bdf8 var(--scrub-pct, 0%), rgba(255, 255, 255, 0.22) var(--scrub-pct, 0%), rgba(255, 255, 255, 0.22) 100%);
        outline: none;
        cursor: pointer;
        margin: 0;
        transition: height 0.15s ease, box-shadow 0.15s ease;
      }
      .cinema-dock-scrubber:hover,
      .cinema-dock-scrubber:focus,
      .cinema-dock-scrubber.spatial-focus {
        height: 8px;
        box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.42);
      }
      .cinema-dock-scrubber::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #ffffff;
        border: 2px solid #38bdf8;
        box-shadow: 0 0 10px rgba(56, 189, 248, 0.85);
        cursor: pointer;
        transition: transform 0.15s ease;
      }
      .cinema-dock-scrubber:hover::-webkit-slider-thumb,
      .cinema-dock-scrubber:focus::-webkit-slider-thumb,
      .cinema-dock-scrubber.spatial-focus::-webkit-slider-thumb {
        transform: scale(1.24);
      }
      .cinema-dock-scrubber::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #ffffff;
        border: 2px solid #38bdf8;
        box-shadow: 0 0 10px rgba(56, 189, 248, 0.85);
        cursor: pointer;
        transition: transform 0.15s ease;
      }
      .cinema-dock-time {
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        color: #e2e8f0;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        padding-left: 4px;
        letter-spacing: 0.02em;
      }
      @media (min-width: 1400px) {
        .cinema-pause-bottom-curtain {
          bottom: 112px;
          padding: 0 32px;
        }
        .detail-cinema-player-dock {
          width: 100%;
          bottom: 0;
          min-height: 102px;
          padding: 32px 28px 16px;
          gap: 10px;
          border-radius: 0;
        }
        .cinema-dock-btn {
          height: 42px;
          min-width: 42px;
          padding: 0 14px;
          font-size: calc(13px * var(--scale-text));
        }
        .cinema-dock-btn svg {
          width: 18px;
          height: 18px;
        }
        #heroCinemaPlayBtn,
        #heroCinemaRestartBtn,
        #detailCinemaPlayBtn,
        #detailCinemaRestartBtn {
          width: 42px;
          height: 42px;
          min-width: 42px;
          padding: 0;
        }
        #heroCinemaMuteBtn,
        #detailCinemaMuteBtn {
          height: 42px;
          min-width: 42px;
          padding: 0 13px;
        }
        .cinema-dock-scrubber {
          height: 7px;
        }
      }
      @media (max-width: 640px) {
        .detail-cinema-player-dock {
          width: 100%;
          bottom: 0;
          min-height: 84px;
          padding: 22px 12px 11px;
          gap: 7px;
          border-radius: 0;
        }
        .cinema-dock-controls-row {
          gap: 6px;
          min-height: 38px;
        }
        .cinema-dock-controls-left,
        .cinema-dock-controls-right {
          gap: 5px;
        }
        .cinema-dock-brand {
          display: none;
        }
        .cinema-teleport-watermark {
          right: 4px;
          bottom: 4px;
          min-width: 124px;
          min-height: 36px;
          padding: 5px 12px 5px 10px;
          font-size: 11px;
        }
        .cinema-dock-btn {
          height: 38px;
          min-width: 38px;
          padding: 0 9px;
          font-size: calc(11.5px * var(--scale-text));
        }
        #heroCinemaPlayBtn,
        #heroCinemaRestartBtn,
        #detailCinemaPlayBtn,
        #detailCinemaRestartBtn {
          width: 38px;
          height: 38px;
          min-width: 38px;
          padding: 0;
        }
        #heroCinemaMuteBtn,
        #detailCinemaMuteBtn {
          height: 38px;
          min-width: 38px;
          padding: 0 9px;
        }
        .cinema-vol-mini-pct {
          display: none;
        }
        .cinema-dock-btn svg {
          width: 15px;
          height: 15px;
        }
        .cinema-dock-time {
          font-size: calc(11px * var(--scale-text));
          padding-left: 2px;
        }
        #heroCinemaModeBtn span,
        #detailCinemaModeBtn span {
          display: none;
        }
      }
      .detail-kicker-link {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: #f1f5f9;
        background: rgba(15, 23, 42, 0.56);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(var(--ambi-1, 148, 163, 184), 0.34);
        padding: 3px 10px;
        border-radius: 999px;
        cursor: pointer;
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        letter-spacing: 0.3px;
        transition: all 0.15s ease;
      }
      .detail-kicker-link:hover, .detail-kicker-link.spatial-focus {
        background: rgba(56, 189, 248, 0.24);
        border-color: #38bdf8;
        color: #ffffff;
        transform: translateY(-1px);
      }
      .detail-monumental-title {
        margin: 0;
        font-size: var(--cinema-title-size);
        font-weight: 900;
        line-height: 1.04;
        letter-spacing: -0.6px;
        text-transform: uppercase;
        color: #ffffff;
        text-shadow: 0 4px 20px rgba(0, 0, 0, 0.92), 0 1px 4px rgba(0, 0, 0, 0.9);
        cursor: pointer;
        word-break: break-word;
      }
      .detail-monumental-title:hover {
        color: #38bdf8;
      }
      .detail-unboxed-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 7px;
        font-size: var(--cinema-meta-size);
        font-weight: 700;
        color: #f8fafc;
        margin-bottom: 4px;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.95);
      }
      .detail-meta-rating {
        color: #ef4444;
        font-weight: 900;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .detail-meta-dot {
        color: rgba(255, 255, 255, 0.5);
        user-select: none;
      }
      .detail-meta-link {
        color: #e2e8f0;
        cursor: pointer;
      }
      .detail-meta-link:hover, .detail-meta-link.spatial-focus {
        color: #38bdf8;
        text-decoration: underline;
      }
      .detail-meta-studio {
        color: #e2e8f0;
        font-weight: 700;
        cursor: pointer;
      }
      /* TelePort Hero Action Bar: 1:1 mit Slider-Buttons (unter der Beschreibung) */
      .detail-action-bar {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .detail-action-primary-group {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .detail-btn-play-white {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: #ffffff;
        color: #090d16;
        border: 1px solid #ffffff;
        border-radius: 8px;
        padding: var(--cinema-btn-pad);
        font-size: var(--cinema-btn-font);
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
        transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
      }
      .detail-btn-play-white:hover, .detail-btn-play-white.spatial-focus {
        background: #f1f5f9;
        transform: translateY(-1px) scale(1.03);
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.55), 0 8px 22px rgba(0, 0, 0, 0.78);
      }
      .detail-version-select-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
      }
      .detail-version-select {
        appearance: none;
        -webkit-appearance: none;
        background: rgba(15, 23, 42, 0.82);
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 8px;
        padding: var(--cinema-btn-pad);
        padding-right: 34px;
        font-size: var(--cinema-btn-font);
        font-weight: 700;
        cursor: pointer;
        backdrop-filter: blur(12px);
        max-width: min(360px, 84vw);
        text-overflow: ellipsis;
        white-space: nowrap;
        overflow: hidden;
        transition: border-color 0.15s ease, background 0.15s ease;
      }
      .detail-version-select:hover, .detail-version-select:focus, .detail-version-select.spatial-focus {
        border-color: #38bdf8;
        background: rgba(30, 41, 59, 0.95);
        outline: none;
      }
      .detail-version-select-caret {
        position: absolute;
        right: 12px;
        pointer-events: none;
        font-size: 11px;
        color: #94a3b8;
      }
      .detail-btn-glass {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        background: rgba(30, 41, 59, 0.68);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 8px;
        padding: var(--cinema-btn-pad);
        font-size: var(--cinema-btn-font);
        font-weight: 700;
        cursor: pointer;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
        text-decoration: none;
        transition: all 0.15s ease;
      }
      .detail-btn-glass:hover, .detail-btn-glass.spatial-focus {
        background: rgba(51, 65, 85, 0.85);
        border-color: rgba(255, 255, 255, 0.55);
        color: #ffffff;
        transform: translateY(-1px) scale(1.03);
      }
      .detail-btn-glass.saved {
        background: rgba(16, 185, 129, 0.24);
        border-color: rgba(52, 211, 153, 0.72);
        color: #ecfdf5;
      }
      .detail-btn-glass.teaser-active {
        border-color: rgba(56, 189, 248, 0.68);
        color: #e0f2fe;
      }
      .detail-btn-glass.is-trailer-unavailable,
      .detail-btn-play-white.is-trailer-unavailable {
        background: rgba(30, 41, 59, 0.66) !important;
        color: rgba(203, 213, 225, 0.9) !important;
        border: 1px solid rgba(148, 163, 184, 0.34) !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.42);
      }
      .detail-btn-glass.is-trailer-unavailable:hover,
      .detail-btn-glass.is-trailer-unavailable.spatial-focus,
      .detail-btn-play-white.is-trailer-unavailable:hover,
      .detail-btn-play-white.is-trailer-unavailable.spatial-focus {
        background: rgba(51, 65, 85, 0.88) !important;
        color: #ffffff !important;
        border-color: rgba(148, 163, 184, 0.65) !important;
      }
      .detail-overview-wrap {
        max-width: min(68ch, 100%);
        margin-bottom: 10px;
      }
      /* Untere Sektionen im Fullscreen-App-View (Zusatz-Infos, Episoden/Teile, Cast-Glas-Karten, Filmreihe & Ähnliche Titel) */
      .detail-content-body {
        width: 100%;
        padding: 18px 28px 64px;
        display: flex;
        flex-direction: column;
        gap: calc(28px * var(--scale-all));
        transition: opacity 0.22s ease, transform 0.22s ease;
      }
      /* Ruhige, edle Kino-Metadaten-Zeile für Zusatz-Infos (Regie, Studio, Land, Streaming-Anbieter) ohne schwere Kapsel-Flut */
      .detail-credits-glass-strip {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px 4px;
        padding: calc(10px * var(--scale-all)) calc(14px * var(--scale-all));
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.42);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(148, 163, 184, 0.14);
      }
      .detail-credit-sep {
        color: rgba(148, 163, 184, 0.45);
        font-size: calc(12px * var(--scale-text));
        padding: 0 4px;
        user-select: none;
      }
      .detail-credit-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 8px;
        border-radius: 7px;
        background: transparent;
        border: 1px solid transparent;
        color: #e2e8f0;
        font-size: calc(12px * var(--scale-text));
        font-weight: 700;
        cursor: pointer;
        text-decoration: none;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      .detail-credit-pill b {
        color: #94a3b8;
        font-weight: 600;
      }
      .detail-credit-pill:hover, .detail-credit-pill.spatial-focus {
        background: rgba(56, 189, 248, 0.14);
        border-color: rgba(56, 189, 248, 0.42);
        color: #38bdf8;
      }
      .detail-section-block {
        display: flex;
        flex-direction: column;
        gap: calc(13px * var(--scale-all));
      }
      .detail-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .detail-section-header-right {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .detail-header-nav-group {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .detail-section-heading {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin: 0;
        font-size: calc(19px * var(--scale-text));
        font-weight: 900;
        color: #f8fafc;
        letter-spacing: -0.01em;
      }
      .detail-section-heading::before {
        content: "";
        display: inline-block;
        width: 4px;
        height: calc(20px * var(--scale-text));
        border-radius: 2px;
        background: linear-gradient(180deg, rgb(var(--ambi-1, 56, 189, 248)), rgb(var(--ambi-2, 99, 102, 241)));
        box-shadow: 0 0 12px rgba(var(--ambi-1, 56, 189, 248), 0.65);
      }
      /* Cast- & Empfehlungs-Slider im kompakten 2:3 Filmcover-Design mit schlanken Glas-Balken direkt links & rechts daneben */
      .detail-carousel-wrap {
        position: relative;
        width: 100%;
        display: flex;
        align-items: stretch;
        gap: calc(8px * var(--scale-cover));
      }
      .detail-cast-track {
        flex: 1;
        min-width: 0;
        display: flex;
        gap: calc(10px * var(--scale-cover));
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-x pan-y;
        padding: 8px 8px 14px;
        scroll-behavior: smooth;
        scrollbar-width: none;
        cursor: grab;
        user-select: none;
        box-sizing: border-box;
      }
      .detail-cast-track.is-dragging,
      .detail-similar-track.is-dragging {
        cursor: grabbing;
        scroll-behavior: auto;
      }
      .detail-cast-track::-webkit-scrollbar { display: none; }
      .detail-cast-card {
        position: relative;
        flex: 0 0 auto;
        width: calc(clamp(98px, 9.5vw, 116px) * var(--scale-cover));
        aspect-ratio: 2 / 3;
        border-radius: 10px;
        overflow: hidden;
        background: #0f172a;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.6);
        cursor: pointer;
        transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
      }
      .detail-cast-card:hover, .detail-cast-card.spatial-focus {
        transform: translateY(-2px);
        border-color: #38bdf8 !important;
        outline: 2px solid #38bdf8 !important;
        outline-offset: -2px !important;
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.55), 0 12px 24px rgba(0, 0, 0, 0.82) !important;
      }
      .detail-cast-photo-wrap {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #0f172a;
      }
      .detail-cast-photo {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center 18%;
        display: block;
        transition: transform 0.24s ease;
      }
      .detail-cast-card:hover .detail-cast-photo,
      .detail-cast-card.spatial-focus .detail-cast-photo {
        transform: scale(1.05);
      }
      .detail-cast-info {
        position: absolute;
        inset: auto 0 0 0;
        padding: 24px 8px 7px;
        background: linear-gradient(180deg, transparent 0%, rgba(4, 7, 16, 0.86) 48%, rgba(4, 7, 16, 0.98) 100%);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .detail-cast-name {
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 800;
        color: #ffffff;
        line-height: 1.2;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .detail-cast-role {
        font-size: calc(10px * var(--scale-text));
        font-weight: 600;
        color: #94a3b8;
        line-height: 1.18;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* Horizontale Filmreihen- & "Das könnte dir auch gefallen" Cover-Reihe (kompakt ~132px mit --scale-cover Zoom) */
      .detail-similar-track {
        flex: 1;
        min-width: 0;
        display: flex;
        gap: calc(11px * var(--scale-cover));
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-x pan-y;
        padding: 8px 8px 14px;
        scroll-behavior: smooth;
        scrollbar-width: none;
        cursor: grab;
        user-select: none;
        box-sizing: border-box;
      }
      .detail-similar-track::-webkit-scrollbar { display: none; }
      .detail-sim-card {
        position: relative;
        flex: 0 0 auto;
        width: calc(clamp(114px, 11vw, 136px) * var(--scale-cover));
        aspect-ratio: 2 / 3;
        border-radius: 10px;
        overflow: hidden;
        background: #0f172a;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.6);
        cursor: pointer;
        transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
      }
      .detail-sim-card.is-current-part {
        border-color: #38bdf8;
        box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.45), 0 10px 24px rgba(0, 0, 0, 0.75);
      }
      .detail-sim-card:hover, .detail-sim-card.spatial-focus {
        transform: translateY(-2px);
        border-color: #38bdf8 !important;
        outline: 2px solid #38bdf8 !important;
        outline-offset: -2px !important;
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.55), 0 12px 24px rgba(0, 0, 0, 0.82) !important;
      }
      .detail-sim-current-badge {
        position: absolute;
        top: 6px;
        left: 6px;
        z-index: 4;
        background: linear-gradient(135deg, #0284c7, #4338ca);
        color: #ffffff;
        font-size: calc(9.5px * var(--scale-text));
        font-weight: 900;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid rgba(125, 211, 252, 0.6);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
      }
      .detail-sim-poster {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .detail-sim-overlay {
        position: absolute;
        inset: auto 0 0 0;
        padding: 26px 9px 8px;
        background: linear-gradient(180deg, transparent 0%, rgba(4, 7, 16, 0.86) 48%, rgba(4, 7, 16, 0.98) 100%);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .detail-sim-title {
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        color: #ffffff;
        line-height: 1.22;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .detail-sim-sub {
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 600;
        color: #94a3b8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* Schlanke hohe Glas-Balken (‹ / ›) direkt links & rechts NEBEN der Cover-Reihe */
      .detail-carousel-side-btn {
        flex: 0 0 calc(28px * var(--scale-menu));
        width: calc(28px * var(--scale-menu));
        margin: 5px 0 12px;
        border-radius: 10px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(7, 11, 22, 0.90));
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #f8fafc;
        font-size: calc(18px * var(--scale-text));
        font-weight: 900;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.52);
        transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, opacity 0.18s ease, transform 0.14s ease, box-shadow 0.16s ease;
        user-select: none;
      }
      .detail-carousel-side-btn:hover {
        background: linear-gradient(180deg, rgba(14, 165, 233, 0.34), rgba(30, 58, 138, 0.52));
        border-color: rgba(56, 189, 248, 0.78);
        color: #ffffff;
        box-shadow: 0 8px 22px rgba(2, 132, 199, 0.38);
      }
      .detail-carousel-side-btn:active {
        transform: scale(0.97);
      }
      .detail-carousel-side-btn.is-edge-disabled {
        opacity: 0.24;
        cursor: default;
        pointer-events: none;
      }
      @media (max-width: 640px) {
        .detail-carousel-side-btn {
          flex: 0 0 24px;
          width: 24px;
          font-size: 16px;
          border-radius: 8px;
        }
      }
      /* Schauspieler- & Regie-Spotlight-Overlay (Mini-Filmografie direkt über der Detailansicht) */
      .person-spotlight-backdrop {
        position: fixed;
        inset: 0;
        z-index: 260;
        background: rgba(3, 7, 18, 0.78);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        animation: fadeIn 0.18s ease;
      }
      .person-spotlight-card {
        width: min(880px, 96vw);
        max-height: 86vh;
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 22px 24px;
        border-radius: 20px;
        background: linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(7, 11, 22, 0.96));
        border: 1px solid rgba(var(--ambi-1, 56, 189, 248), 0.38);
        box-shadow: 0 28px 70px rgba(0, 0, 0, 0.92);
        overflow-y: auto;
      }
      .person-spotlight-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      .person-spotlight-profile {
        display: flex;
        align-items: center;
        gap: 16px;
        min-width: 0;
      }
      .person-spotlight-avatar {
        width: calc(74px * var(--scale-cover));
        height: calc(74px * var(--scale-cover));
        border-radius: 50%;
        object-fit: cover;
        object-position: center 20%;
        border: 2px solid #38bdf8;
        background: #0f172a;
        flex-shrink: 0;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65);
      }
      .person-spotlight-name {
        font-size: calc(22px * var(--scale-text));
        font-weight: 900;
        color: #ffffff;
        margin: 0;
        line-height: 1.15;
      }
      .person-spotlight-sub {
        font-size: calc(12.5px * var(--scale-text));
        color: #7dd3fc;
        font-weight: 700;
        margin-top: 3px;
      }
      .person-spotlight-bio {
        font-size: calc(12.5px * var(--scale-text));
        color: #cbd5e1;
        line-height: 1.55;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        cursor: pointer;
      }
      .person-spotlight-bio.is-expanded {
        display: block !important;
        -webkit-line-clamp: unset !important;
        max-height: 180px;
        overflow-y: auto;
        padding-right: 4px;
      }
      .person-spotlight-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(calc(132px * var(--scale-cover)), 1fr));
        gap: calc(12px * var(--scale-cover));
        padding: 6px;
        box-sizing: border-box;
      }
      /* Live-Zoom-Badge (oben rechts bei L2/R2 oder +/-) & Controller-HUD (PlayStation / Xbox) */
      #liveZoomBadgeEl {
        position: fixed;
        top: calc(var(--sticky-header-height, 54px) + 12px);
        right: 18px;
        z-index: 1650;
        background: linear-gradient(135deg, rgba(8, 13, 25, 0.92), rgba(2, 132, 199, 0.35));
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(56, 189, 248, 0.65);
        color: #f8fafc;
        padding: 6px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 900;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.75);
        pointer-events: none;
        opacity: 0;
        transform: translateY(-8px) scale(0.96);
        transition: opacity 0.18s ease, transform 0.18s ease;
      }
      #liveZoomBadgeEl.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      #controllerHudBar {
        position: fixed;
        bottom: 12px;
        right: 14px;
        z-index: 155;
        display: none;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        background: linear-gradient(135deg, rgba(8, 13, 26, 0.86), rgba(15, 23, 42, 0.78));
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1px solid rgba(56, 189, 248, 0.32);
        border-radius: 999px;
        padding: 5px 13px;
        font-size: 11.5px;
        font-weight: 700;
        color: #cbd5e1;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.68);
        pointer-events: none;
      }
      #controllerHudBar.visible {
        display: inline-flex;
      }
      #controllerHudBar b {
        color: #38bdf8;
        font-weight: 900;
      }
      @media (max-width: 640px) {
        .detail-hero-stage {
          padding: 14px 16px 12px;
        }
        .detail-content-body {
          padding: 16px 16px 56px;
        }
        #controllerHudBar {
          display: none !important;
        }
      }
      .ep-icon-btn {
        padding: 4px 7px !important;
        font-size: calc(11px * var(--scale-text)) !important;
        border-radius: 6px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        color: #94a3b8;
        transition: all 0.14s ease;
      }
      .ep-icon-btn:hover {
        background: rgba(255,255,255,0.14);
        color: #fff;
      }
      /* Sub-Modal für "Folgen korrigieren" & "Fehler melden" */
      .submodal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 240;
        background: rgba(2, 6, 23, 0.84);
        backdrop-filter: blur(6px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 14px;
        animation: fadeIn 0.14s ease;
      }
      .submodal-box {
        background: var(--surface);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 14px;
        width: 100%;
        max-width: 520px;
        max-height: 90vh;
        overflow-y: auto;
        padding: 16px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.92);
      }
      .modal-body { padding: 14px 18px 20px; }
      .detail-meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 8px;
        margin: 10px 0;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        padding: 10px;
      }
      .detail-meta-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .detail-meta-label {
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 800;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      /* Modernisierte Serien-Staffel-Leiste & Streaming-Episoden-Karten (Apple TV+ / Netflix Stil) */
      .season-toolbar-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 12px;
        padding: 6px 8px;
        border-radius: 12px;
        background: rgba(10, 15, 28, 0.55);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      body[data-theme="light"] .season-toolbar-row {
        background: #f1f5f9;
        border-color: #cbd5e1;
      }
      .season-tab-btn {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.10);
        color: #cbd5e1;
        padding: 6px 14px;
        border-radius: 999px;
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.16s ease;
      }
      .season-tab-btn:hover,
      .season-tab-btn.spatial-focus {
        background: rgba(14, 165, 233, 0.18);
        border-color: rgba(56, 189, 248, 0.58);
        color: #ffffff;
      }
      .season-tab-btn.active {
        background: #ffffff;
        border-color: #ffffff;
        color: #090d16;
        box-shadow: 0 4px 14px rgba(255, 255, 255, 0.22);
      }
      body[data-theme="light"] .season-tab-btn {
        background: #ffffff;
        border-color: #cbd5e1;
        color: #334155;
      }
      body[data-theme="light"] .season-tab-btn:hover {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0369a1;
      }
      body[data-theme="light"] .season-tab-btn.active {
        background: #0f172a;
        border-color: #0f172a;
        color: #ffffff;
      }
      .season-version-filter-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        padding: 7px 12px;
        margin-bottom: 12px;
        border-radius: 10px;
        background: rgba(14, 165, 233, 0.06);
        border: 1px solid rgba(56, 189, 248, 0.18);
        font-size: calc(11.5px * var(--scale-text));
      }
      body[data-theme="light"] .season-version-filter-bar {
        background: #f0f9ff;
        border-color: #bae6fd;
      }
      .ep-row {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: center;
        padding: calc(11px * var(--scale-menu)) calc(14px * var(--scale-menu));
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.84) 0%, rgba(10, 15, 28, 0.94) 100%);
        content-visibility: auto;
        contain-intrinsic-size: 0 74px;
        border-radius: 12px;
        margin-bottom: calc(8px * var(--scale-all));
        gap: calc(7px * var(--scale-all));
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
        transition: background 0.14s ease, border-color 0.14s ease, transform 0.12s ease;
      }
      button, .btn, .detail-btn-glass, .detail-btn-play-white, .cinema-dock-btn, .season-tab-btn, .mode-pill, .f-pill, .recent-chip {
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }
      .ep-row:hover,
      .ep-row:focus-within {
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.78) 0%, rgba(14, 165, 233, 0.12) 100%);
        border-color: rgba(56, 189, 248, 0.48);
        box-shadow: 0 10px 24px rgba(2, 6, 23, 0.52);
        transform: translateY(-1px);
      }
      body[data-theme="light"] .ep-row {
        background: #ffffff;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .ep-row:hover,
      body[data-theme="light"] .ep-row:focus-within {
        background: #f8fafc;
        border-color: #38bdf8;
      }
      .ep-row.ep-watched { border-color: rgba(16, 185, 129, 0.42); background: linear-gradient(135deg, rgba(16, 185, 129, 0.09), rgba(15, 23, 42, 0.58)); }
      .ep-row.ep-next-up { border-color: rgba(56, 189, 248, 0.65); background: linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(15, 23, 42, 0.68)); }
      .ep-row.ep-autofilled { border-left: 3px solid #38bdf8; }
      .ep-row-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        min-width: 0;
        flex-wrap: wrap;
      }
      .ep-row-bottom {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        width: 100%;
      }
      body[data-theme="light"] .ep-row-bottom {
        border-top-color: transparent;
      }
      .ep-title {
        font-size: calc(14px * var(--scale-text));
        font-weight: 800;
        color: #f8fafc;
        cursor: pointer;
        flex: 1;
        min-width: 0;
        border-radius: 7px;
        padding: 3px 6px;
        box-sizing: border-box;
        transition: color 0.14s ease, background 0.14s ease;
        display: flex;
        align-items: center;
        gap: 10px;
        overflow: hidden;
      }
      .ep-title.spatial-focus,
      .ep-title:hover {
        color: #38bdf8;
        background: rgba(14, 165, 233, 0.10);
      }
      .ep-title:hover .ep-name-text,
      .ep-title.spatial-focus .ep-name-text {
        color: #38bdf8;
      }
      body[data-theme="light"] .ep-title:hover .ep-name-text,
      body[data-theme="light"] .ep-title.spatial-focus .ep-name-text {
        color: #0284c7;
      }
      .ep-code-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 3px 9px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #e2e8f0;
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.3px;
        flex-shrink: 0;
      }
      /* Lauftext (Marquee) Wrapper für Folgennamen & lange Modal-Titel */
      .ep-name-wrap,
      .inline-marquee-wrap {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        position: relative;
        display: flex;
        align-items: center;
      }
      .ep-name-text,
      .inline-marquee-text {
        color: #f8fafc;
        font-weight: 700;
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: inline-block;
        max-width: 100%;
      }
      .ep-name-wrap.is-marquee-overflow,
      .inline-marquee-wrap.is-marquee-overflow {
        mask-image: linear-gradient(to right, transparent 0%, #000 3%, #000 95%, transparent 100%);
        -webkit-mask-image: linear-gradient(to right, transparent 0%, #000 3%, #000 95%, transparent 100%);
      }
      .ep-name-wrap.is-marquee-overflow .ep-name-text,
      .inline-marquee-wrap.is-marquee-overflow .inline-marquee-text {
        max-width: none !important;
        overflow: visible !important;
        text-overflow: clip !important;
        padding-right: 24px;
        will-change: transform;
        animation: cardTitleMarquee var(--marquee-dur, 6s) ease-in-out infinite;
      }
      .ep-quality-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 7px;
        border-radius: 6px;
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        background: rgba(14, 165, 233, 0.18);
        border: 1px solid rgba(56, 189, 248, 0.45);
        color: #7dd3fc;
        flex-shrink: 0;
      }
      .ep-quality-badge.q-uhd {
        background: rgba(99, 102, 241, 0.22);
        border-color: rgba(129, 140, 248, 0.55);
        color: #c7d2fe;
      }
      .ep-quality-badge.q-sd {
        background: rgba(148, 163, 184, 0.18);
        border-color: rgba(148, 163, 184, 0.4);
        color: #cbd5e1;
      }
      body[data-theme="light"] .ep-quality-badge {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0369a1;
      }
      .ep-autofill-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 7px;
        border-radius: 6px;
        font-size: calc(10px * var(--scale-text));
        font-weight: 800;
        background: rgba(245, 158, 11, 0.16);
        border: 1px solid rgba(251, 191, 36, 0.45);
        color: #fde68a;
        flex-shrink: 0;
      }
      body[data-theme="light"] .ep-autofill-badge {
        background: #fef3c7;
        border-color: #f59e0b;
        color: #92400e;
      }
      .btn-stream-clean {
        background: linear-gradient(135deg, rgba(2, 132, 199, 0.24), rgba(67, 56, 202, 0.24));
        border: 1px solid rgba(56, 189, 248, 0.5);
        color: #e0f2fe;
        font-weight: 700;
        padding: 5px 11px;
        border-radius: 7px;
        font-size: calc(11px * var(--scale-text));
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.14s ease;
      }
      .btn-stream-clean:hover,
      .btn-stream-clean.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #7dd3fc;
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
      }
      .btn-stream-clean.prerelease {
        background: rgba(245, 158, 11, 0.15);
        border-color: rgba(245, 158, 11, 0.45);
        color: #fde68a;
      }
      .btn-stream-clean.prerelease:hover {
        background: #d97706;
        border-color: #fbbf24;
        color: #ffffff;
      }
      .ep-ghost-btn {
        background: rgba(30, 41, 59, 0.45);
        border: 1px solid rgba(148, 163, 184, 0.18);
        color: #94a3b8;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        cursor: pointer;
        opacity: 0.62;
        transition: opacity 0.14s ease, background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
      }
      .ep-ghost-btn.admin-remap-btn {
        background: rgba(14, 165, 233, 0.14);
        border-color: rgba(56, 189, 248, 0.4);
        color: #7dd3fc;
      }
      .ep-ghost-btn.admin-remap-btn:hover,
      .ep-ghost-btn.admin-remap-btn.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #7dd3fc;
        color: #ffffff;
      }
      .ep-row:hover .ep-ghost-btn,
      .ep-row:focus-within .ep-ghost-btn,
      .ep-ghost-btn:hover,
      .ep-ghost-btn.spatial-focus {
        opacity: 1;
      }
      .ep-ghost-btn:hover,
      .ep-ghost-btn.spatial-focus {
        opacity: 1;
        background: rgba(51, 65, 85, 0.85);
        border-color: rgba(148, 163, 184, 0.45);
        color: #ffffff;
      }
      .ep-ghost-btn.saved {
        opacity: 1;
        background: rgba(16, 185, 129, 0.18);
        border-color: rgba(16, 185, 129, 0.48);
        color: #6ee7b7;
      }
      body[data-theme="light"] .ep-ghost-btn {
        background: #f1f5f9;
        border-color: #cbd5e1;
        color: #334155;
      }
      body[data-theme="light"] .ep-ghost-btn.admin-remap-btn {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0369a1;
      }
      body[data-theme="light"] .ep-ghost-btn:hover {
        background: #e2e8f0;
        border-color: #94a3b8;
        color: #0f172a;
      }
      body[data-theme="light"] .ep-name-text,
      body[data-theme="light"] .inline-marquee-text {
        color: #0f172a;
      }
      body[data-theme="light"] .ep-code-badge {
        background: #e0f2fe;
        border-color: #7dd3fc;
        color: #0369a1;
      }
      body[data-theme="light"] .btn-stream-clean {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0c4a6e;
      }
      body[data-theme="light"] .btn-stream-clean:hover {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #0284c7;
        color: #ffffff;
      }
      body[data-theme="light"] .btn-stream-clean.prerelease {
        background: #fef3c7;
        border-color: #f59e0b;
        color: #92400e;
      }
      body[data-theme="light"] .btn-stream-clean.prerelease:hover {
        background: #d97706;
        border-color: #b45309;
        color: #ffffff;
      }
      /* Vorher -> Nachher Vergleichsbox im Admin Folgen-Korrektur-Modal */
      .ep-remap-compare-grid {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        gap: 8px;
        align-items: stretch;
        margin-bottom: 12px;
      }
      @media (max-width: 540px) {
        .ep-remap-compare-grid {
          grid-template-columns: 1fr;
        }
        .ep-remap-compare-arrow {
          transform: rotate(90deg);
          margin: -2px auto;
        }
      }
      .ep-remap-card {
        padding: 10px 11px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.24);
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .ep-remap-card.target {
        background: rgba(14, 165, 233, 0.11);
        border-color: rgba(56, 189, 248, 0.5);
      }
      body[data-theme="light"] .ep-remap-card {
        background: #f8fafc;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .ep-remap-card.target {
        background: #f0f9ff;
        border-color: #38bdf8;
      }
      .ep-remap-compare-arrow {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        font-weight: 900;
        color: #38bdf8;
        padding: 0 2px;
      }
      .stream-meta-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(255, 255, 255, 0.16);
        color: #e2e8f0;
        font-variant-numeric: tabular-nums;
      }
      body[data-theme="light"] .stream-meta-pill {
        background: #f1f5f9;
        border-color: #cbd5e1;
        color: #334155;
      }
      .stream-meta-pill.size {
        background: rgba(2, 132, 199, 0.18);
        border-color: rgba(56, 189, 248, 0.4);
        color: #7dd3fc;
      }
      .stream-meta-pill.tags {
        background: rgba(245, 158, 11, 0.16);
        border-color: rgba(251, 191, 36, 0.4);
        color: #fde68a;
      }
      .ep-progress-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: calc(10px * var(--scale-text));
        font-weight: 800;
        padding: 1px 6px;
        border-radius: 999px;
        background: rgba(16, 185, 129, 0.22);
        border: 1px solid rgba(16, 185, 129, 0.5);
        color: #6ee7b7;
        flex-shrink: 0;
      }
      .ep-progress-badge.next {
        background: rgba(14, 165, 233, 0.22);
        border-color: rgba(56, 189, 248, 0.55);
        color: #7dd3fc;
      }
      /* Visuelle Fortschrittsanzeige für Gedrückthalten (~450ms) der Pfeiltasten ⬅️/➡️ im Detail-Modal */
      .modal-hold-nav-indicator {
        position: fixed;
        top: 50%;
        transform: translateY(-50%);
        z-index: 280;
        background: rgba(16, 16, 24, 0.96);
        border: 1px solid var(--accent-primary);
        border-radius: 12px;
        padding: 10px 14px;
        color: #fff;
        font-size: 12px;
        font-weight: 800;
        box-shadow: 0 10px 30px rgba(0,0,0,0.85);
        display: none;
        flex-direction: column;
        gap: 6px;
        min-width: 170px;
        max-width: 240px;
        pointer-events: none;
      }
      .modal-hold-nav-indicator.left { left: 16px; }
      .modal-hold-nav-indicator.right { right: 16px; }
      .modal-hold-nav-track {
        width: 100%;
        height: 6px;
        background: rgba(255,255,255,0.14);
        border-radius: 999px;
        overflow: hidden;
      }
      .modal-hold-nav-bar {
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, var(--accent-primary), #10b981);
        transition: width 450ms linear;
      }
      .embed-box { margin: 10px 0; background: #000; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15); }
      .embed-frame { width: 100%; aspect-ratio: 16/9; border: 0; display: block; background: #000; }
      .chip-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
      .panel-box { background: rgba(18, 21, 30, 0.88); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
      .lightbox-backdrop { position: fixed; inset: 0; z-index: 1700; background: rgba(4, 7, 17, 0.95); backdrop-filter: blur(10px); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px; overflow: hidden; }
      .lightbox-toolbar { position: relative; z-index: 5; display: flex; justify-content: space-between; align-items: center; width: 100%; max-width: 720px; margin-bottom: 12px; gap: 10px; padding: 8px 12px; border-radius: 12px; background: rgba(7, 12, 26, 0.88); border: 1px solid rgba(56, 189, 248, 0.25); box-shadow: 0 8px 24px rgba(0,0,0,0.65); }
      .lightbox-img { position: relative; z-index: 1; max-width: 96vw; max-height: 78vh; object-fit: contain; border-radius: 10px; box-shadow: 0 14px 44px rgba(0,0,0,0.92); transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1); cursor: zoom-in; }
      .lightbox-img.zoomed { transform: scale(1.62); cursor: zoom-out; }
      a.link { color: #38bdf8; text-decoration: none; font-weight: 600; }
      body[data-theme="light"] a.link { color: #0284c7; }
      #hudToast {
        position: fixed;
        bottom: 20px;
        left: 50%;
        right: auto;
        transform: translateX(-50%);
        z-index: 2600;
        max-width: min(92vw, 560px);
        text-align: center;
        background: rgba(7, 12, 26, 0.96);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(56, 189, 248, 0.65);
        color: #fff;
        padding: 9px 16px;
        border-radius: 999px;
        font-size: 12.5px;
        font-weight: 800;
        box-shadow: 0 10px 28px rgba(0,0,0,0.82), 0 0 16px rgba(56, 189, 248, 0.2);
        display: none;
        pointer-events: auto;
        cursor: pointer;
      }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      /* Futuristischer Neon-Cinema Boot-Splashscreen */
      #tmaBootSplashscreen {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: radial-gradient(circle at 50% 38%, rgba(0, 240, 255, 0.16) 0%, rgba(139, 92, 246, 0.14) 34%, #070b19 78%);
        background-color: #070b19;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
        transition: opacity 0.38s cubic-bezier(0.16, 1, 0.3, 1), transform 0.38s cubic-bezier(0.16, 1, 0.3, 1);
        user-select: none;
      }
      #tmaBootSplashscreen.splash-hidden {
        opacity: 0;
        transform: scale(1.03);
        pointer-events: none;
      }
      .neon-splash-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        max-width: 360px;
        width: 100%;
      }
      .neon-splash-avatar-wrap {
        position: relative;
        width: 116px;
        height: 116px;
        border-radius: 50%;
        padding: 3px;
        background: linear-gradient(135deg, #00f0ff 0%, #8b5cf6 55%, #ec4899 100%);
        box-shadow: 0 0 36px rgba(0, 240, 255, 0.38), 0 0 64px rgba(139, 92, 246, 0.28);
        margin-bottom: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .neon-splash-avatar-img {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        object-fit: cover;
        background: #070b19;
        display: block;
      }
      .neon-splash-title {
        font-size: 24px;
        font-weight: 900;
        letter-spacing: -0.02em;
        color: #f8fafc;
        margin-bottom: 4px;
      }
      .neon-splash-title span {
        background: linear-gradient(90deg, #00f0ff, #a855f7);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .neon-splash-sub {
        font-size: 12.5px;
        color: #94a3b8;
        margin-bottom: 18px;
        letter-spacing: 0.01em;
      }
      .neon-splash-bar-track {
        width: 180px;
        height: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.09);
        overflow: hidden;
        position: relative;
      }
      .neon-splash-bar-fill {
        height: 100%;
        width: 65%;
        border-radius: 999px;
        background: linear-gradient(90deg, #00f0ff, #8b5cf6);
        animation: neonSplashPulse 1.1s ease-in-out infinite alternate;
      }
      @keyframes neonSplashPulse {
        0% { transform: translateX(-35%); width: 45%; }
        100% { transform: translateX(85%); width: 65%; }
      }
      @media (prefers-reduced-motion: reduce) {
        #tmaBootSplashscreen { transition: opacity 0.15s linear; transform: none !important; }
        .neon-splash-bar-fill { animation: none; width: 100%; }
      }
      /* Tastatur-/Controller-Modus aktiv: Am Ende des Stylesheets alle Kind-Elemente (inkl. pointer-events: auto !important) zuverlässig vom Maus-Hover entkoppeln */
      body.kb-nav-active #appRoot,
      body.kb-nav-active #appRoot *,
      body.kb-nav-active header,
      body.kb-nav-active header *,
      body.kb-nav-active #filterSidebarDrawer,
      body.kb-nav-active #filterSidebarDrawer *,
      body.kb-nav-active #tvQuickJumpElevator,
      body.kb-nav-active #tvQuickJumpElevator *,
      body.kb-nav-active #modalRoot,
      body.kb-nav-active #modalRoot *,
      body.kb-nav-active #pageJumpModalRoot,
      body.kb-nav-active #pageJumpModalRoot *,
      body.kb-nav-active #customDialogRoot,
      body.kb-nav-active #customDialogRoot *,
      body.kb-nav-active #personSpotlightOverlayRoot,
      body.kb-nav-active #personSpotlightOverlayRoot *,
      body.kb-nav-active #searchGenreDropdownOverlay,
      body.kb-nav-active #searchGenreDropdownOverlay *,
      body.kb-nav-active #smartPageIndicatorBtn,
      body.kb-nav-active #smartPageIndicatorBtn *,
      body.kb-nav-active #catalogBackToTopFab,
      body.kb-nav-active #catalogBackToTopFab *,
      body.kb-nav-active .catalog-edge-trigger-left,
      body.kb-nav-active .catalog-edge-trigger-left *,
      body.kb-nav-active .catalog-edge-trigger-right,
      body.kb-nav-active .catalog-edge-trigger-right * {
        pointer-events: none !important;
      }
      /* Portal-Orange Fokusrahmen (#ff7a00) für maximalen Kontrast auf Trailer- & hellen/blauen Hauptbuttons */
      body .hero-btn-play.spatial-focus,
      body .hero-btn-play:focus-visible,
      body .hero-btn-play.is-trailer-unavailable.spatial-focus,
      body #heroBtnTrailer.spatial-focus,
      body #heroBtnTrailer:focus-visible,
      body #heroCinemaPlayBtn.spatial-focus,
      body #heroCinemaPlayBtn:focus-visible,
      body #detailCinemaPlayBtn.spatial-focus,
      body #detailCinemaPlayBtn:focus-visible,
      body .cinema-pause-center-btn.spatial-focus,
      body .detail-btn-play-white.spatial-focus,
      body .detail-btn-play-white:focus-visible,
      body #detailTrailerBtn.spatial-focus,
      body #detailTrailerBtn:focus-visible,
      body #detailPrimaryPlayBtn.spatial-focus,
      body #detailPrimaryPlayBtn:focus-visible,
      body .card-quick-trailer.spatial-focus,
      body .cinema-overlay-btn.is-primary.spatial-focus,
      body .cinema-dock-btn.is-primary.spatial-focus,
      body .btn.blue.spatial-focus,
      body .btn.blue:focus-visible,
      body .btn.red.spatial-focus,
      body .btn.red:focus-visible,
      body .btn.primary.spatial-focus,
      body .btn.primary:focus-visible,
      body .btn.active.spatial-focus,
      body .btn.active:focus-visible,
      body .btn.hero-primary.spatial-focus,
      body .page-jump-btn.primary.spatial-focus,
      body .page-jump-btn.active.spatial-focus,
      body .media-mode-tab.active-movie.spatial-focus,
      body .media-mode-tab.active-series.spatial-focus {
        outline: 3px solid #ff7a00 !important;
        outline-offset: 2px !important;
        border-color: #ff7a00 !important;
        box-shadow: 0 0 0 2px rgba(6, 10, 20, 0.92), 0 0 0 5px #ff7a00, 0 0 26px rgba(255, 122, 0, 0.85), 0 8px 22px rgba(0, 0, 0, 0.78) !important;
        z-index: 30;
      }
      body .card-quick-trailer.spatial-focus,
      body .media-mode-tab.active-movie.spatial-focus,
      body .media-mode-tab.active-series.spatial-focus {
        outline-offset: -1px !important;
        box-shadow: inset 0 0 0 1px rgba(255, 195, 113, 0.8), 0 0 0 2px #ff7a00, 0 0 18px rgba(255, 122, 0, 0.85) !important;
      }
    </style>
  </head>
  <body>
    <div id="tmaBootSplashscreen" onclick="dismissBootSplashscreen()" title="Antippen zum Überspringen">
      <div class="neon-splash-card">
        <div class="neon-splash-avatar-wrap">
          <img
            class="neon-splash-avatar-img"
            src="/src/assets/images/telegram_bot_avatar_neon_1794251893026.jpg"
            alt="TelePort Neon Cinema Logo"
            referrerPolicy="no-referrer"
            onerror="if(!this.dataset.triedAlt){this.dataset.triedAlt='1';this.src='/assets/telegram_bot_avatar_neon.jpg';}else{this.style.display='none';this.nextElementSibling.style.display='flex';}"
          />
          <div style="display:none;width:100%;height:100%;border-radius:50%;background:#070b19;align-items:center;justify-content:center">
            <svg width="64" height="64" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="14" cy="14" r="11.5" stroke="#00f0ff" stroke-width="2.2" stroke-dasharray="18 5"/>
              <circle cx="14" cy="14" r="7.5" stroke="#8b5cf6" stroke-width="1.5"/>
              <path d="M11.8 9.8L18.5 14L11.8 18.2V9.8Z" fill="#00f0ff"/>
            </svg>
          </div>
        </div>
        <div class="neon-splash-title">Tele<span>Port</span> Cinema</div>
        <div class="neon-splash-sub">Synchronisiere Mediathek & Streams…</div>
        <div class="neon-splash-bar-track"><div class="neon-splash-bar-fill"></div></div>
      </div>
    </div>
    <header id="topUnifiedBar" class="search-bar-outer">
      <button class="btn" id="sidebarToggleBtn" onclick="toggleFilterSidebar()" title="Menü, Filter, Zufall, Account, Design & Ansichtsgröße öffnen"><span class="top-btn-icon">☰</span><span class="top-btn-label"> Menü</span><span id="topSidebarFilterCountBadge" class="top-filter-count-badge" style="display:none">0</span></button>
      <button type="button" class="btn" id="topBarBackBtn" onclick="closeDetailModal()" title="Zurück zur vorherigen Ansicht (Esc / B / ○)"><span class="top-btn-icon">←</span><span class="top-btn-label" id="topBarBackBtnLabel"> Zurück</span></button>
      <span id="headerBrandLogo" class="brand-logo" tabindex="0" role="button" aria-label="TelePort – Zur Hauptseite" onclick="goHome()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();goHome();}" title="TelePort – Zur Hauptseite">
        <svg class="teleport-logo-svg" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="tpGradHeader" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#38bdf8"/>
              <stop offset="50%" stop-color="#0284c7"/>
              <stop offset="100%" stop-color="#6366f1"/>
            </linearGradient>
          </defs>
          <circle cx="14" cy="14" r="11.5" stroke="url(#tpGradHeader)" stroke-width="2.5" stroke-dasharray="18 5"/>
          <circle cx="14" cy="14" r="7.5" stroke="#38bdf8" stroke-width="1.4" stroke-opacity="0.75"/>
          <path d="M11.8 9.8L18.5 14L11.8 18.2V9.8Z" fill="url(#tpGradHeader)"/>
        </svg>
        <span class="brand-text-wrap">Tele<span class="teleport-accent">Port</span></span>
      </span>
      <div class="media-mode-switch-inline" id="mediaModeBanner">
        <button id="tabBtnMovies" class="media-mode-tab active-movie" onclick="switchType('m')" title="Zu Filme wechseln">
          <span class="top-btn-icon">🎬</span><span class="top-btn-label"> Filme</span>
        </button>
        <button id="tabBtnSeries" class="media-mode-tab" onclick="switchType('s')" title="Zu Serien wechseln">
          <span class="top-btn-icon">📺</span><span class="top-btn-label"> Serien</span>
        </button>
      </div>
      <div class="search-bar" onclick="if(window.innerWidth<=760 && !document.getElementById('topUnifiedBar')?.classList.contains('mobile-search-expanded')){expandMobileSearchBarClient();}">
        <button type="button" id="mobileSearchCollapseBtn" class="mobile-search-collapse-btn" onclick="collapseMobileSearchBarClient(event)" title="Suche einklappen" aria-label="Suche einklappen">←</button>
        <button type="button" id="searchGenreTriggerBtn" class="search-genre-trigger-btn" onclick="toggleSearchGenreDropdownOverlay(event)" title="Nach Genre filtern" aria-haspopup="listbox" aria-expanded="false">
          <span id="searchGenreTriggerIcon" class="search-genre-trigger-icon">🎞️</span>
          <span id="searchGenreTriggerLabel" class="search-genre-trigger-label">Alle Genres</span>
          <span id="searchGenreQuickResetBtn" class="search-genre-quick-reset" onclick="resetTopGenreFilterQuickClient(event)" title="Genre-Filter mit 1 Klick zurücksetzen (Alle Genres)" style="display:none">✕</span>
          <span class="search-genre-caret">▾</span>
        </button>
        <select id="searchGenreSelect" class="search-scope-select" style="display:none !important" aria-hidden="true" onchange="onSearchGenreSelectChange(this.value)" title="Nach Genre filtern">
          <option value="all">🎞️ Alle Genres</option>
        </select>
        <div class="search-input-wrap">
          <input
            id="searchInput"
            placeholder="Film, Serie, Studio, Person oder (Jahr)..."
            autocomplete="off"
            onfocus="onSearchInputFocus()"
            onblur="onSearchInputBlur()"
            oninput="onSearchInputLive(this.value)"
            onkeydown="onSearchInputKeyDownClient(event, this)"
          />
          <button type="button" id="searchClearBtn" class="search-clear-btn is-empty" onclick="clearSearchInput()" title="Suchfeld leeren" aria-label="Suchfeld leeren">✕</button>
        </div>
        <button type="button" class="search-submit-btn" onclick="closeSearchGenreDropdownOverlay();closeAutocomplete();runSearch()" title="Suche starten" aria-label="Suche starten">🔍</button>
      </div>
      <button class="btn" id="navBtnWishlist" onclick="loadWishlist('root')" title="Synchronisierte Merkliste & Playlisten"><span class="top-btn-icon">💾</span><span class="top-btn-label"> Merkliste</span></button>
      <button type="button" id="heroHideBtn" class="hero-hide-btn hero-top-dock-hide-btn" onclick="toggleHeroSliderHidden()" title="Kino-Spotlight ein- oder ausklappen"><span class="top-btn-icon">▴</span><span class="top-btn-label"> Einklappen</span></button>
      <div id="topBarAdjNavGroup" class="detail-adj-nav">
        <button type="button" id="modalAdjPrevBtn" class="top-adj-nav-btn" onclick="navigateDetailModalAdjacent(-1)" title="Vorheriger Titel (L1 / LB)">◀</button>
        <button type="button" id="modalAdjNextBtn" class="top-adj-nav-btn" onclick="navigateDetailModalAdjacent(1)" title="Nächster Titel (R1 / RB)">▶</button>
      </div>
      <div id="searchGenreDropdownOverlay" class="search-genre-dropdown-overlay" role="listbox" aria-label="Genre wählen" onmousedown="event.preventDefault()"></div>
      <div id="searchAutocompleteBox" class="search-autocomplete-box" role="listbox" aria-label="Suchvorschläge" onmousedown="event.preventDefault()"></div>
    </header>
    <div id="catalogEdgeTriggerLeft" class="catalog-edge-trigger-left" onclick="cancelSideMenuHoverTimersClient();if(!state.sidebarOpen)toggleFilterSidebar()" onmouseenter="scheduleLeftEdgeHoverOpenClient()" onmouseleave="cancelLeftEdgeHoverOpenClient()" title="Menü-Übersicht öffnen" aria-label="Menü-Übersicht öffnen">
      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 3.25L10.75 8L6 12.75" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div id="catalogEdgeTriggerRight" class="catalog-edge-trigger-right" onclick="cancelSideMenuHoverTimersClient();openRightMenuOverlayClient(true)" onmouseenter="scheduleRightEdgeHoverOpenClient()" onmouseleave="cancelRightEdgeHoverOpenClient()" title="Schnellmenü öffnen" aria-label="Schnellmenü öffnen">
      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10 3.25L5.25 8L10 12.75" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <nav id="tvQuickJumpElevator" class="tv-quick-jump-elevator" aria-label="Katalog-Navigation">
      <div id="rightMenuSubPanel" class="tv-elevator-subpanel" aria-live="polite"></div>
      <div class="tv-elevator-main-col">
        <button type="button" id="tvElevBtnSearch" class="tv-elevator-btn" onclick="focusSearchWithoutScrollClient(event)" title="Suche aktivieren (ohne Hochscrollen)"><span>🔍</span><span class="tv-elev-label">Suche</span></button>
        <button type="button" id="tvElevBtnBot" class="tv-elevator-btn" onclick="openPageJumpFromElevatorClient(event)" title="Seite direkt wählen"><span>📄</span><span class="tv-elev-label">Seite</span></button>
        <button type="button" id="tvElevBtnTop" class="tv-elevator-btn" onclick="scrollToTopFromElevatorClient(event)" title="Ganz nach oben scrollen"><span>⬆️</span><span class="tv-elev-label">Nach oben</span></button>
        <button type="button" id="tvElevBtnWishlist" class="tv-elevator-btn" data-rm-tab="wishlist" onclick="toggleRightMenuSubPanelClient('wishlist')" title="Merkliste direkt im rechten Menü öffnen, filtern & sortieren"><span>💾</span><span class="tv-elev-label">Merkliste</span><span id="tvElevBadgeWishlist" class="tv-elev-count-badge" style="display:none">0</span></button>
        <button type="button" id="tvElevBtnRecent" class="tv-elevator-btn" data-rm-tab="recent" onclick="toggleRightMenuSubPanelClient('recent')" title="Zuletzt gesehen direkt im rechten Menü öffnen, filtern & sortieren"><span>🕒</span><span class="tv-elev-label">Zuletzt</span><span id="tvElevBadgeRecent" class="tv-elev-count-badge" style="display:none">0</span></button>
      </div>
    </nav>
    <div id="elevatorBackdrop" class="elevator-backdrop" onclick="closeRightMenuOverlayClient(event, true)" aria-hidden="true"></div>

    <!-- Linke 2-Spalten Ambilight-Glas Sidebar (Links: Einzeilige Kategorien | Rechts: Dynamisches Optionen-Panel) -->
    <div id="sidebarBackdrop" class="sidebar-backdrop" onclick="closeFilterSidebar()"></div>
    <aside id="filterSidebarDrawer" class="sidebar-drawer" aria-label="Filter & Einstellungen Sidebar">
      <div class="sidebar-header">
        <span id="sidebarBrandLogo" class="brand-logo" tabindex="0" role="button" aria-label="TelePort – Zur Hauptseite" onclick="closeFilterSidebar();goHome()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();closeFilterSidebar();goHome();}" title="Zur Hauptseite (Startseite öffnen)">
          <svg class="teleport-logo-svg" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="14" cy="14" r="11.5" stroke="url(#tpGradHeader)" stroke-width="2.5" stroke-dasharray="18 5"/>
            <circle cx="14" cy="14" r="7.5" stroke="#38bdf8" stroke-width="1.4" stroke-opacity="0.75"/>
            <path d="M11.8 9.8L18.5 14L11.8 18.2V9.8Z" fill="url(#tpGradHeader)"/>
          </svg>
          <span>Tele<span class="teleport-accent">Port</span></span>
        </span>
        <div style="display:flex;gap:6px">
          <button class="btn danger" style="padding:4px 8px;font-size:11px" onclick="setDirectFilter('reset_all','','neutral')" title="Alle aktiven Filter zurücksetzen">🗑️ Reset</button>
          <button class="btn close-slate" onclick="closeFilterSidebar()" title="Sidebar schließen">✖</button>
        </div>
      </div>
      <div class="sidebar-columns-wrap">
        <div id="sidebarDrawerBody" class="sidebar-body"></div>
        <div id="sidebarRightSubPanel" class="sidebar-right-subpanel" aria-live="polite"></div>
      </div>
    </aside>

    <div id="busyOverlayBar">
      <div class="spinner"></div>
      <span id="busyOverlayText">⏳ Filter wird angewendet – lade passende Ergebnisse nach...</span>
    </div>

    <div id="hudToast"></div>
    <div id="liveZoomBadgeEl" aria-live="polite">🔍 Zoom: 100%</div>
    <div id="controllerHudBar" aria-hidden="true"></div>
    <div id="antiSpamHudMount" style="position:fixed;bottom:14px;right:14px;left:14px;max-width:480px;margin-left:auto;z-index:1550;pointer-events:none;display:none"></div>
    <div id="modalHoldNavIndicator" class="modal-hold-nav-indicator">
      <span id="modalHoldNavText">⏩ Halten zum Weiterblättern...</span>
      <div class="modal-hold-nav-track"><div id="modalHoldNavBar" class="modal-hold-nav-bar"></div></div>
    </div>
    <div id="customDialogRoot"></div>

    <div id="appRoot"><div class="section">⏳ Lade synchronisierte Inhalte...</div></div>
    <div id="modalRoot"></div>
    <div id="lightboxRoot"></div>

    <script>
      window.__TELEPORT_BOOTED__ = false;
      window.__renderTeleportDiagError = function(title, detail) {
        var root = document.getElementById("appRoot");
        if (!root) return;
        if (window.__TELEPORT_BOOTED__ && root.innerHTML.indexOf("⏳ Lade synchronisierte Inhalte...") === -1) return;
        var safeMsg = String(detail || "Unbekannter Script-/Ladefehler").replace(/[<>&]/g, function(c) {
          return c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;";
        });
        root.innerHTML =
          '<div class="section" style="max-width:680px;margin:28px auto;background:#16161d;border:1px solid rgba(229,9,20,0.55);border-radius:12px;padding:18px;box-shadow:0 12px 32px rgba(0,0,0,0.6)">' +
            '<div style="display:flex;align-items:center;gap:10px;font-size:16px;font-weight:900;color:#f87171;margin-bottom:8px">⚠️ ' + title + '</div>' +
            '<div style="font-size:12.5px;color:#cbd5e1;line-height:1.5;margin-bottom:10px">Beim Initialisieren der Mini-App ist ein Fehler aufgetreten:</div>' +
            '<pre style="background:#0b0b10;border:1px solid rgba(255,255,255,0.12);padding:10px;border-radius:8px;font-size:11.5px;color:#fbbf24;overflow-x:auto;white-space:pre-wrap;margin-bottom:12px">' + safeMsg + '</pre>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
              '<button class="btn red" onclick="location.reload()">🔄 Mini-App neu laden</button>' +
            '</div>' +
          '</div>';
      };
      window.addEventListener("error", function(ev) {
        var msg = (ev && ev.message ? ev.message : "Script Error") + (ev && ev.lineno ? " (Zeile " + ev.lineno + (ev.colno ? ":" + ev.colno : "") + ")" : "");
        window.__renderTeleportDiagError("Diagnose: Script- oder Ladefehler erkannt", msg);
      });
      window.addEventListener("unhandledrejection", function(ev) {
        var reason = ev && ev.reason ? (ev.reason.stack || ev.reason.message || String(ev.reason)) : "Unhandled Promise Rejection";
        if (!window.__TELEPORT_BOOTED__) {
          window.__renderTeleportDiagError("Diagnose: Start-Promise fehlgeschlagen", reason);
        }
      });
    </script>
