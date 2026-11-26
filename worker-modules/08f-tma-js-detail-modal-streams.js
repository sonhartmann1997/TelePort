      function renderOrPatchDetailStageClient(type, id, d, forceSeasonNum = null, autoOpenTrailer = false, isDeltaHydration = false) {
        const vipAllowed = isCurrentUserVip();
        const isSeedOnly = Boolean(d._isSeedStageOnly);
        const detailKey = type + "_" + (d.id || id);

        if (document.body) {
          document.body.classList.add("modal-open-pause-hero");
        }
        const topSearchInp = document.getElementById("searchInput");
        if (topSearchInp && state.searchQuery && !topSearchInp.value) {
          topSearchInp.value = state.searchQuery;
          updateSearchClearBtnVisibility();
        }

        const m = document.getElementById("modalRoot");
        if (!m) return;
        const tr = d.trailers || null;
        const posterOrig = resolvePosterUrlClient(d.poster_path, "original", d.external_poster_url || "");
        const posterW780 = resolvePosterUrlClient(d.poster_path, "w780", d.external_poster_url || "");
        const posterThumb = resolvePosterUrlClient(d.poster_path, "w342", d.external_poster_url || "");
        if (posterThumb && !isSeedOnly) {
          syncCardPosterInDom(type, d.id || id, posterThumb);
        }
        const backdropOrig = resolvePosterUrlClient(d.backdrop_path, "original", "");
        const backdropW1280 = resolvePosterUrlClient(d.backdrop_path, "w1280", posterW780 || posterOrig);
        const portraitBg = posterW780 || backdropW1280 || posterOrig;
        const ytSearchQuery = encodeURIComponent((d.title || "") + " " + (d.year && d.year !== "K.A." ? d.year : "") + " Trailer Deutsch");
        const ytSearchUrl = "https://www.youtube.com/results?search_query=" + ytSearchQuery;

        const genresListClean = (d.genres && d.genres !== "Keine Angabe")
          ? d.genres.split(",").map(g => g.trim()).filter(Boolean)
          : [];
        const directorsArr = Array.isArray(d.directorsList) && d.directorsList.length > 0
          ? d.directorsList
          : (d.directors && d.directors !== "Keine Angabe" ? d.directors.split(",").map(n => ({ name: n.trim(), id: null })).filter(x => x.name) : []);
        const castArr = Array.isArray(d.castList) && d.castList.length > 0
          ? d.castList
          : (d.casts && d.casts !== "Keine Angabe" ? d.casts.split(",").map(n => ({ name: n.trim(), id: null, character: "", profile_path: "" })).filter(x => x.name) : []);
        const studiosArr = Array.isArray(d.studiosList) && d.studiosList.length > 0
          ? d.studiosList
          : (d.studios && d.studios !== "Keine Angabe" ? d.studios.split(",").map(s => ({ name: s.trim(), id: null })).filter(x => x.name) : []);
        const dedupedProvidersList = cleanAndDedupeProvidersClient(d.providers);

        const hasValidYear = Boolean(d.year && d.year !== "K.A.");
        const fskClean = String(d.fsk || "").trim();
        const fskFilterTarget = FSK_OPTIONS_CLIENT.find(fo => fskClean.includes(fo)) || "";
        const hasValidFsk = Boolean(fskFilterTarget && !/keine angabe|unbekannt/i.test(fskClean));
        const prevAdj = getAdjacentDetailItem(-1);
        const nextAdj = getAdjacentDetailItem(1);
        const backBtnLabel = getDetailBackButtonLabelClient(type);

        const topBackBtn = document.getElementById("topBarBackBtn");
        const topBackLbl = document.getElementById("topBarBackBtnLabel");
        if (topBackLbl) topBackLbl.textContent = backBtnLabel.replace(/^←\\s*/, "");
        if (topBackBtn) topBackBtn.title = backBtnLabel + " (Esc / B / ○)";
        const topPrevBtn = document.getElementById("modalAdjPrevBtn");
        const topNextBtn = document.getElementById("modalAdjNextBtn");
        if (topPrevBtn) {
          topPrevBtn.disabled = !prevAdj;
          topPrevBtn.style.opacity = prevAdj ? "1" : "0.35";
          topPrevBtn.title = prevAdj ? ("Vorheriger Titel: " + prevAdj.title + " (L1 / LB)") : "Kein vorheriger Titel";
        }
        if (topNextBtn) {
          topNextBtn.disabled = !nextAdj;
          topNextBtn.style.opacity = nextAdj ? "1" : "0.35";
          topNextBtn.title = nextAdj ? ("Nächster Titel: " + nextAdj.title + " (R1 / RB)") : "Kein nächster Titel";
        }

        if (d.logo_path && typeof clientClearLogoCache !== "undefined") {
          clientClearLogoCache.set(detailKey, d.logo_path);
        }
        const activeLogoPath = d.logo_path || (typeof clientClearLogoCache !== "undefined" ? (clientClearLogoCache.get(detailKey) || "") : "");

        const returnChipHtml = (state.lastClosedDetailItem && String(state.lastClosedDetailItem.id) !== String(d.id || id))
          ? ('<button type="button" class="return-last-detail-chip" onclick="reopenLastClosedDetailItemClient()" title="Zurück zum vorherigen Titel: ' + esc(state.lastClosedDetailItem.title || "Titel") + '">↩ ' + esc(String(state.lastClosedDetailItem.title || "Zurück").slice(0, 26)) + '</button>')
          : "";
        const mutedActiveFiltersHtml = buildMutedActiveFiltersForDetailHtml();
        const kickerRowHtml = [
          '<span class="hero-badge ' + (type === "s" ? "series" : "movie") + '">' + (type === "s" ? "📺 SERIE" : "🎬 FILM") + '</span>',
          state.openedFromRandom ? '<span class="hero-badge" style="background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#ffffff;border:1px solid rgba(196,181,253,0.45)">🎲 ZUFALLS-TIPP</span>' : "",
          d.collection ? (
            '<button type="button" class="detail-kicker-link" onclick="scrollToDetailBelowFoldClient(event,\\'detailCollectionSectionWrap\\')" title="Zur Filmreihe springen: ' + esc(d.collection.name) + '">' +
              '<span>🍿</span><span>' + esc(d.collection.name) + '</span>' +
            '</button>'
          ) : "",
          d.universe ? (
            '<button type="button" class="detail-kicker-link" onclick="saveLastClosedDetailItemClient();closeDetailModal();openUniverseView(\\'' + escJs(d.universe.id) + '\\')" title="Universum öffnen: ' + esc(d.universe.name) + '">' +
              '<span>' + esc(d.universe.icon || "🌌") + '</span><span>' + esc(d.universe.name) + '</span>' +
            '</button>'
          ) : "",
          returnChipHtml
        ].filter(Boolean).join("");

        const cleanStatusLabel = (type === "s" && d.statusText && d.statusText !== "Unbekannt")
          ? String(d.statusText).replace(/^[🔴🟢🟡⚪]\\s*/, "").trim()
          : "";
        const heroStyleGenresHtml = genresListClean.length > 0
          ? ('<span class="hero-meta-sep">·</span><span class="hero-meta-genres">' +
              genresListClean.slice(0, 3).map((gName, idx, arr) =>
                '<span class="hero-meta-genre" tabindex="0" onclick="filterByCategoryFromModal(\\'genre\\',\\'' + escJs(gName) + '\\')" title="Nach Genre filtern: ' + esc(gName) + '">' + esc(gName) + '</span>' +
                (idx < arr.length - 1 ? '<span>, </span>' : '')
              ).join("") +
            '</span>')
          : "";
        const unboxedMetaHtml = [
          (d.vote && d.vote !== "0.0") ? ('<span><span class="hero-meta-star">★</span> ' + esc(d.vote) + '</span>') : "",
          hasValidYear ? ('<span class="hero-meta-year" tabindex="0" onclick="searchByYearFromModal(\\'' + escJs(d.year) + '\\')" title="Alle Titel aus dem Jahr ' + esc(d.year) + '">' + esc(d.year) + '</span>') : "",
          (d.runtime && d.runtime !== "Keine Angabe") ? ('<span>' + esc(d.runtime) + '</span>') : "",
          (type === "s" && d.numberOfSeasons) ? ('<span>' + Number(d.numberOfSeasons) + (Number(d.numberOfSeasons) === 1 ? " Staffel" : " Staffeln") + '</span>') : "",
          hasValidFsk ? ('<span class="detail-meta-link" tabindex="0" onclick="filterByCategoryFromModal(\\'fsk\\',\\'' + escJs(fskFilterTarget) + '\\')" title="Nach ' + esc(fskFilterTarget) + ' filtern">' + esc(fskFilterTarget) + '</span>') : "",
          '<span class="hero-meta-hd" title="Im Katalog in HD verfügbar">HD</span>'
        ].filter(Boolean).join('<span class="hero-meta-sep">·</span>') + heroStyleGenresHtml;

        const creditsPillsArr = [
          ...directorsArr.slice(0, 2).map(p => {
            const pPhoto = p.profile_path ? resolvePosterUrlClient(p.profile_path, "w185", "") : "";
            return '<button type="button" class="detail-credit-pill" onclick="openPersonSpotlightOverlayClient(' + (p.id ? Number(p.id) : 'null') + ',\\'' + escJs(p.name) + '\\',\\'Regie\\',\\'' + escJs(pPhoto) + '\\')" title="Spotlight & Filmografie von ' + esc(p.name) + ' öffnen">🎬 <b>Regie:</b> ' + esc(p.name) + '</button>';
          }),
          ...studiosArr.slice(0, 3).map(sObj =>
            '<button type="button" class="detail-credit-pill" onclick="filterOrSearchStudioFromModal(\\'' + escJs(sObj.name) + '\\',\\'' + escJs(sObj.id || "") + '\\')" title="Alle Titel von ' + esc(sObj.name) + '">🏢 <b>Studio:</b> ' + esc(sObj.name) + '</button>'
          ),
          (d.country && d.country !== "k.A." && d.country !== "Keine Angabe")
            ? ('<button type="button" class="detail-credit-pill" onclick="saveLastClosedDetailItemClient();closeDetailModal();runSearch(false,\\'' + escJs(d.country) + '\\')" title="Alle Titel aus ' + esc(d.country) + '">🌍 <b>Land:</b> ' + esc(d.country) + '</button>')
            : "",
          cleanStatusLabel
            ? ('<span class="detail-credit-pill" style="cursor:default">📡 <b>Status:</b> ' + esc(cleanStatusLabel) + (d.numberOfEpisodes ? (' · ' + Number(d.numberOfEpisodes) + ' Folgen') : '') + '</span>')
            : "",
          ...dedupedProvidersList.slice(0, 3).map(pName =>
            '<button type="button" class="detail-credit-pill" onclick="filterOrSearchProviderFromModal(\\'' + escJs(pName) + '\\')" title="Nach Streaming-Anbieter filtern: ' + esc(pName) + '">📺 ' + esc(pName) + '</button>'
          ),
          ...((d.providerButtons && d.providerButtons.length > 0) ? d.providerButtons.map(pb =>
            '<a class="detail-credit-pill" href="' + esc(safeHttpUrl(pb.url)) + '" target="_blank" rel="noopener noreferrer" style="border-color:' + esc(pb.border || "#0284c7") + '">' + esc(pb.buttonText) + '</a>'
          ) : [])
        ].filter(Boolean);
        const creditsGlassStripHtml = creditsPillsArr.length > 0
          ? ('<div class="detail-credits-glass-strip">' + creditsPillsArr.join('<span class="detail-credit-sep">·</span>') + '</div>')
          : "";

        const playableMovieFiles = type === "m" ? getPlayableMovieFilesForHeroClient(d) : [];
        const seriesVersionProfiles = type === "s" ? getSeriesVersionProfilesForHeroClient(d) : [];
        const hasVipStreams = Boolean(
          vipAllowed && (
            (type === "m" && playableMovieFiles.length > 0) ||
            (type === "s" && (seriesVersionProfiles.length > 0 || (Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 0) || Number(d.firstVipSeason || 0) > 0))
          )
        );

        let versionSelectHtml = "";
        if (hasVipStreams) {
          if (type === "m" && playableMovieFiles.length > 0) {
            const optionsHtml = playableMovieFiles.map((f, idx) => {
              const vLbl = cleanUserVisibleStreamTagsClient(f.tags || f.versionLabel || f.version_label || "") || String(d.primaryVersionLabel || "Originalfassung");
              const qLbl = String(f.quality || "1080p").trim();
              const cLbl = String(f.codec || "x264").trim();
              const szLbl = formatFileSizeClient(f.file_size);
              const ptLbl = normalizeClientPartLabel(f.part, f.raw_filename || "");
              const labelParts = ["🎞️ " + vLbl, qLbl, cLbl, szLbl, ptLbl ? ("(" + ptLbl + ")") : ""].filter(Boolean).join(" · ");
              return '<option value="' + idx + '">' + esc(labelParts) + '</option>';
            }).join("");
            versionSelectHtml = '<div class="detail-version-select-wrap">' +
              '<select id="detailHeroVersionSelect" class="detail-version-select" onchange="onDetailHeroVersionChangeClient(this)" title="Gewünschte Schnittfassung & Qualität zum direkten Abspielen wählen">' +
                optionsHtml +
              '</select>' +
              '<span class="detail-version-select-caret">▾</span>' +
            '</div>';
          } else if (type === "s" && seriesVersionProfiles.length > 0) {
            const optionsHtml = seriesVersionProfiles.map(prof =>
              '<option value="' + esc(prof.key) + '">🎞️ ' + esc(prof.key) + (prof.count > 1 ? (' (' + prof.count + ' Flg.)') : '') + '</option>'
            ).join("");
            versionSelectHtml = '<div class="detail-version-select-wrap">' +
              '<select id="detailHeroVersionSelect" class="detail-version-select" onchange="onDetailHeroVersionChangeClient(this)" title="Bevorzugte Serien-Fassung & Qualität wählen">' +
                optionsHtml +
              '</select>' +
              '<span class="detail-version-select-caret">▾</span>' +
            '</div>';
          }
        }

        const savedProg = type === "s" ? getSeriesProgress(d.id) : null;
        const hasForcedSeason = forceSeasonNum !== undefined && forceSeasonNum !== null && !isNaN(Number(forceSeasonNum));
        const initialSeason = hasForcedSeason
          ? Number(forceSeasonNum)
          : (savedProg && savedProg.season !== undefined && savedProg.season !== null && !isNaN(Number(savedProg.season)))
            ? Number(savedProg.season)
            : (d.firstVipSeason !== undefined && d.firstVipSeason !== null && !isNaN(Number(d.firstVipSeason)) ? Number(d.firstVipSeason) : 1);
        if (state.activeDetails) {
          state.activeDetails._activeLoadedSeason = initialSeason;
        }

        const detailTrailerCandCount = tr
          ? (Array.isArray(tr.candidates) && tr.candidates.length ? tr.candidates.length : (tr.key ? 1 : 0))
          : 0;
        const hasVerifiedDetailTrailer = isSeedOnly ? true : Boolean((d.hasTrailer !== false) && detailTrailerCandCount > 0);

        const primaryPlayBtnLabel = hasVipStreams
          ? (type === "s"
              ? (savedProg && savedProg.season !== undefined && savedProg.season !== null && savedProg.episode
                  ? ("▶ Weiter: S" + String(savedProg.season).padStart(2, "0") + " · E" + String(savedProg.episode).padStart(2, "0"))
                  : "▶ Abspielen")
              : "▶ Abspielen")
          : (hasVerifiedDetailTrailer ? "▶ Trailer" : "🔎 Trailer auf YouTube");

        const primaryVersionBadgeText = String(d.primaryVersionLabel || (Array.isArray(d.availableVersions) && d.availableVersions[0]) || "").trim();
        const canReportMedia = Boolean(vipAllowed || state.authUser?.isAdmin);
        const isAdminUser = Boolean(state.authUser?.isAdmin);

        const hasMultiPartOrArchivesForMovie = Boolean(
          vipAllowed && type === "m" && (
            playableMovieFiles.some(f => Boolean(normalizeClientPartLabel(f.part, f.raw_filename || ""))) ||
            (Array.isArray(d.downloads) && d.downloads.length > 0) ||
            playableMovieFiles.length > 1
          )
        );

        const castSectionHtml = castArr.length > 0 ? (
          '<section class="detail-section-block">' +
            '<div class="detail-section-header">' +
              '<h3 class="detail-section-heading">Cast</h3>' +
            '</div>' +
            '<div class="detail-carousel-wrap">' +
              '<button type="button" tabindex="-1" class="detail-carousel-side-btn prev" onclick="scrollDetailHorizontalTrackClient(\\'detailCastTrackEl\\',-1,event)" title="Cast nach links scrollen" aria-label="Cast nach links scrollen">‹</button>' +
              '<div id="detailCastTrackEl" class="detail-cast-track">' +
                castArr.map(c => {
                  const cName = String(c.name || "").trim();
                  const cRole = String(c.character || "Darsteller").trim();
                  const fbAvatar = buildActorAvatarFallbackSvgClient(cName);
                  const photoUrl = c.profile_path ? resolvePosterUrlClient(c.profile_path, "w342", "") : fbAvatar;
                  const spotlightCall = 'openPersonSpotlightOverlayClient(' + (c.id ? Number(c.id) : 'null') + ',\\'' + escJs(cName) + '\\',\\'' + escJs(cRole) + '\\',\\'' + escJs(photoUrl) + '\\')';
                  return '<div class="detail-cast-card" tabindex="0" onclick="' + spotlightCall + '" onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();' + spotlightCall + ';}" title="Spotlight & Filme mit ' + esc(cName) + ' anzeigen">' +
                    '<div class="detail-cast-photo-wrap">' +
                      '<img class="detail-cast-photo lazy-cover-img is-loading" src="' + LAZY_POSTER_PLACEHOLDER_SVG + '" data-lazy-src="' + esc(photoUrl) + '" alt="' + esc(cName) + '" draggable="false" onerror="this.onerror=null;this.src=\\'' + escJs(fbAvatar) + '\\';" />' +
                    '</div>' +
                    '<div class="detail-cast-info">' +
                      '<div class="detail-cast-name">' + esc(cName) + '</div>' +
                      '<div class="detail-cast-role">' + esc(cRole) + '</div>' +
                    '</div>' +
                  '</div>';
                }).join("") +
              '</div>' +
              '<button type="button" tabindex="-1" class="detail-carousel-side-btn next" onclick="scrollDetailHorizontalTrackClient(\\'detailCastTrackEl\\',1,event)" title="Cast nach rechts scrollen" aria-label="Cast nach rechts scrollen">›</button>' +
            '</div>' +
          '</section>'
        ) : "";

        const bgVarsStyle =
          "--hero-bg-landscape:url('" + esc(backdropW1280 || portraitBg) + "');" +
          "--hero-bg-portrait:url('" + esc(portraitBg || backdropW1280) + "');";

        const collectionSectionHtml = (type === "m" && d.collection && d.collection.id) ? (
          '<section id="detailCollectionSectionWrap" class="detail-section-block" style="display:none">' +
            '<div class="detail-section-header">' +
              '<h3 class="detail-section-heading">🍿 Alle Teile der Filmreihe: ' + esc(d.collection.name || "Filmreihe") + '</h3>' +
              '<div class="detail-section-header-right">' +
                '<button type="button" class="btn-tool-quiet" onclick="saveLastClosedDetailItemClient();closeDetailModal();openCollectionView(' + Number(d.collection.id) + ')">Komplette Reihe öffnen ➔</button>' +
              '</div>' +
            '</div>' +
            '<div class="detail-carousel-wrap">' +
              '<button type="button" tabindex="-1" class="detail-carousel-side-btn prev" onclick="scrollDetailHorizontalTrackClient(\\'detailCollectionTrackEl\\',-1,event)" title="Nach links scrollen" aria-label="Nach links scrollen">‹</button>' +
              '<div id="detailCollectionTrackEl" class="detail-similar-track">' +
                '<div style="font-size:12.5px;color:#94a3b8;padding:12px 4px">⏳ Lade alle Teile der Filmreihe...</div>' +
              '</div>' +
              '<button type="button" tabindex="-1" class="detail-carousel-side-btn next" onclick="scrollDetailHorizontalTrackClient(\\'detailCollectionTrackEl\\',1,event)" title="Nach rechts scrollen" aria-label="Nach rechts scrollen">›</button>' +
            '</div>' +
          '</section>'
        ) : "";

        const primaryClickJs = hasVipStreams
          ? 'triggerDetailHeroPrimaryPlayClient()'
          : 'enterDetailForegroundTrailerModeClient(event)';

        const primaryActionButtonsHtml =
          '<button type="button" id="detailPrimaryPlayBtn" class="detail-btn-play-white' + (!hasVipStreams && !isSeedOnly && !hasVerifiedDetailTrailer ? ' is-trailer-unavailable' : '') + '" onclick="' + primaryClickJs + '" title="' + (!hasVipStreams && !isSeedOnly && !hasVerifiedDetailTrailer ? 'Kein direkt abspielbarer Trailer gefunden – YouTube-Suche öffnen' : '') + '">' +
            esc(primaryPlayBtnLabel) +
          '</button>' +
          versionSelectHtml +
          (hasVipStreams ? buildModalDeliveryTargetSelectorHtml() : '') +
          (hasVipStreams ? (
            '<button type="button" id="detailTrailerBtn" class="detail-btn-glass' + (!isSeedOnly && !hasVerifiedDetailTrailer ? ' is-trailer-unavailable' : '') + '" onclick="enterDetailForegroundTrailerModeClient(event)" title="' + (!isSeedOnly && !hasVerifiedDetailTrailer ? 'Kein direkt abspielbarer Trailer gefunden – YouTube-Suche öffnen' : (detailTrailerCandCount > 1 ? ('Trailer im Vordergrund abspielen (' + detailTrailerCandCount + ' Clips verfügbar)') : 'Alle Elemente ausblenden & Trailer im Vordergrund abspielen (ohne Neuladen)')) + '">' + (!isSeedOnly && !hasVerifiedDetailTrailer ? '🔎 Trailer suchen' : '🎬 Trailer') + '</button>'
          ) : '') +
          '<button type="button" id="modalWishlistBtn" class="detail-btn-glass ' + (d.isSaved ? "saved" : "") + '" onclick="toggleWishlistItem(\\'' + type + '\\',' + Number(d.id) + ')">' +
            (d.isSaved ? "✓ Gespeichert" : "＋ Speichern") +
          '</button>' +
          ((typeof window.canShowCastToTvButtonClient === "function" && window.canShowCastToTvButtonClient()) ? (
            '<button type="button" id="detailCastToTvBtn" class="detail-btn-glass detail-btn-tv-cast" onclick="castItemToTvClient(\\'' + type + '\\',' + Number(d.id) + ',\\'' + escJs(d.title || "") + '\\')" title="Diesen Titel direkt auf deinem verbundenen Fernseher öffnen">📺 Auf TV öffnen</button>'
          ) : '<button type="button" id="detailCastToTvBtn" class="detail-btn-glass detail-btn-tv-cast" style="display:none" onclick="castItemToTvClient(\\'' + type + '\\',' + Number(d.id) + ',\\'' + escJs(d.title || "") + '\\')" title="Diesen Titel direkt auf deinem verbundenen Fernseher öffnen">📺 Auf TV öffnen</button>') +
          (state.openedFromRandom ? (
            '<button type="button" id="modalNextRandomBtn" class="detail-btn-glass" style="border-color:rgba(167,139,250,0.55);color:#ede9fe" onclick="triggerRandom()" title="Direkt den nächsten Zufalls-Tipp mit deinen aktiven Filtern ziehen">🎲 Weiterwürfeln</button>'
          ) : '') +
          '<button type="button" id="modalMoreActionsBtn" class="detail-btn-glass" onclick="toggleModalMoreActions()" title="Teilen, Melden, Original-Poster, TMDb & weitere Werkzeuge">⋯ Mehr ▾</button>';

        const isInTelegramNow = typeof isRealTelegramMiniAppClient === "function" && isRealTelegramMiniAppClient();
        const isTvModeNow = typeof window.isCurrentDeviceTvModeClient === "function" && window.isCurrentDeviceTvModeClient();
        const canShareToStoryNow = Boolean(
          isInTelegramNow &&
          window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.shareToStory === "function" &&
          (posterOrig || d.poster_path || d.external_poster_url)
        );
        const moreActionsInnerHtml =
          (!isTvModeNow ? (
            '<button class="btn purple" onclick="shareItemFromTma(\\'' + type + '\\',' + Number(d.id) + ')">📤 An Chat teilen</button>' +
            (canShareToStoryNow ? '<button class="btn" onclick="shareItemToStoryFromTma(\\'' + type + '\\',' + Number(d.id) + ')" title="Filmposter direkt in deine Telegram-Story teilen">✨ In Story teilen</button>' : '') +
            '<button class="btn" onclick="sendSharePostToBotChat(\\'' + type + '\\',' + Number(d.id) + ')">💬 Teilen-Post im Bot</button>' +
            '<button class="btn blue" onclick="openInBot(\\'' + type + "_" + Number(d.id) + '\\')">🤖 Im Bot öffnen</button>'
          ) : '') +
          (canReportMedia ? '<button class="btn" onclick="openMediaReportModal({typeCode:\\'' + type + '\\',tmdbId:' + Number(d.id) + ',title:\\'' + escJs(d.title) + '\\',versionLabel:\\'' + escJs(primaryVersionBadgeText || "Originalfassung") + '\\'})" title="Defekten Stream oder falsche Zuordnung melden">⚠️ Fehler melden</button>' : '') +
          (isAdminUser ? '<button class="btn" onclick="toggleModalPosterPicker(\\'' + type + '\\',' + Number(d.id) + ')" title="Cover ändern (Admin)">🖼️ Cover ändern</button>' : '') +
          (isAdminUser ? '<button class="btn" onclick="toggleModalRemapBox(\\'' + type + '\\',' + Number(d.id) + ')" title="Neu zuordnen (Admin)">🔄 Neu zuordnen</button>' : '') +
          (d.telegraphUrl ? '<a class="btn" href="' + esc(safeHttpUrl(d.telegraphUrl)) + '" target="_blank" rel="noopener noreferrer">📖 Telegraph-Guide</a>' : '') +
          (posterOrig ? '<button class="btn" onclick="openLightbox(\\'' + escJs(posterOrig) + '\\',\\'' + escJs(d.title) + ' – Original-Poster\\')">🖼️ Original-Poster</button>' : '') +
          (backdropOrig ? '<button class="btn" onclick="openLightbox(\\'' + escJs(backdropOrig) + '\\',\\'' + escJs(d.title) + ' – Szenenbild\\')">🏞️ Szenenbild</button>' : '') +
          (d.tmdbDeUrl ? '<a class="btn" href="' + esc(safeHttpUrl(d.tmdbDeUrl)) + '" target="_blank" rel="noopener noreferrer">🌐 Auf TMDb ansehen</a>' : '');

        const similarSectionHtml =
          '<section id="detailSimilarSectionWrap" class="detail-section-block" style="display:flex">' +
            '<div class="detail-section-header">' +
              '<h3 class="detail-section-heading">Das könnte dir auch gefallen</h3>' +
            '</div>' +
            '<div class="detail-carousel-wrap">' +
              '<button type="button" tabindex="-1" class="detail-carousel-side-btn prev" onclick="scrollDetailHorizontalTrackClient(\\'detailSimilarTrackEl\\',-1,event)" title="Nach links scrollen" aria-label="Nach links scrollen">‹</button>' +
              '<div id="detailSimilarTrackEl" class="detail-similar-track">' +
                '<div style="font-size:12.5px;color:#94a3b8;padding:12px 4px">⏳ Lade passende Empfehlungen...</div>' +
              '</div>' +
              '<button type="button" tabindex="-1" class="detail-carousel-side-btn next" onclick="scrollDetailHorizontalTrackClient(\\'detailSimilarTrackEl\\',1,event)" title="Nach rechts scrollen" aria-label="Nach rechts scrollen">›</button>' +
            '</div>' +
          '</section>';

        const contentBodyInnerHtml = isSeedOnly
          ? (
              '<div style="padding:18px 4px;font-size:13px;color:#94a3b8;display:flex;align-items:center;gap:8px">' +
                '<span>⏳ Lade Besetzung, Streams & Empfehlungen...</span>' +
              '</div>' +
              similarSectionHtml
            )
          : (
              creditsGlassStripHtml +
              (type === "s" ? (
                '<section id="detailStreamsSection" class="detail-section-block">' +
                  '<div class="detail-section-header">' +
                    '<h3 class="detail-section-heading">Staffeln & Episoden</h3>' +
                  '</div>' +
                  '<div id="seasonBox">Lade Episoden...</div>' +
                  '<div id="seriesArchiveDownloadsMount">' +
                    (vipAllowed && Array.isArray(d.downloads) && d.downloads.length > 0 ? buildArchiveDownloadsSectionHtml(d, isAdminUser) : '') +
                  '</div>' +
                  ((vipAllowed || isAdminUser) && Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 0
                    ? ('<div id="flixTabPanel_versions" style="margin-top:12px">' + buildDetailModalVersionsTabHtml(d, type, vipAllowed, isAdminUser, canReportMedia) + '</div>')
                    : '') +
                '</section>'
              ) : (hasMultiPartOrArchivesForMovie ? (
                '<section id="detailStreamsSection" class="detail-section-block">' +
                  '<div class="detail-section-header">' +
                    '<h3 class="detail-section-heading">Alle Teile & Versionen</h3>' +
                  '</div>' +
                  buildMovieStreamsReleaseSectionHtml(d, isAdminUser, canReportMedia) +
                  ((vipAllowed || isAdminUser) && Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 1
                    ? ('<div id="flixTabPanel_versions" style="margin-top:12px">' + buildDetailModalVersionsTabHtml(d, type, vipAllowed, isAdminUser, canReportMedia) + '</div>')
                    : '') +
                '</section>'
              ) : '')) +
              castSectionHtml +
              collectionSectionHtml +
              similarSectionHtml
            );

        const existingStageEl = document.getElementById("detailHeroStageEl");
        if (isDeltaHydration && existingStageEl && existingStageEl.getAttribute("data-detail-key") === detailKey) {
          // DELTA-HYDRATION: Obere Bühne steht bereits aus dem Slider/Katalog! Nur noch fehlende Felder & unteren Bereich nachziehen (0ms Flackern)
          if (!existingStageEl.getAttribute("data-has-backdrop") && (backdropW1280 || portraitBg)) {
            existingStageEl.style.setProperty("--hero-bg-landscape", "url('" + (backdropW1280 || portraitBg) + "')");
            existingStageEl.style.setProperty("--hero-bg-portrait", "url('" + (portraitBg || backdropW1280) + "')");
            existingStageEl.setAttribute("data-has-backdrop", d.backdrop_path ? "1" : "");
            applyDynamicHeroAmbilightClient(backdropW1280 || portraitBg);
          }
          const kickerEl = document.getElementById("detailKickerEl");
          if (kickerEl) kickerEl.innerHTML = kickerRowHtml;

          const titleBoxEl = document.getElementById("detailTitleBoxEl");
          if (titleBoxEl && activeLogoPath && !titleBoxEl.querySelector("img")) {
            if (typeof clientClearLogoCache !== "undefined" && d.id) {
              clientClearLogoCache.set(type + "_" + Number(d.id), activeLogoPath);
              if (typeof schedulePersistClearLogoCacheClient === "function") {
                schedulePersistClearLogoCacheClient();
              }
            }
            if (typeof preloadClearLogoBitmapClient === "function") {
              preloadClearLogoBitmapClient(activeLogoPath).then((ready) => {
                if (!ready) return;
                const liveTitleBox = document.getElementById("detailTitleBoxEl");
                if (liveTitleBox && state.activeDetails && String(state.activeDetails.id) === String(d.id)) {
                  liveTitleBox.innerHTML = buildHeroTitleOrLogoInnerHtmlClient(d.title, activeLogoPath);
                }
              });
            } else {
              titleBoxEl.innerHTML = buildHeroTitleOrLogoInnerHtmlClient(d.title, activeLogoPath);
            }
          }

          const metaEl = document.getElementById("detailMetaCleanEl");
          if (metaEl && unboxedMetaHtml) {
            metaEl.innerHTML = unboxedMetaHtml;
          }

          const ovTextEl = document.getElementById("modalHeaderOverviewTextEl");
          if (ovTextEl && d.overview && (!ovTextEl.textContent || ovTextEl.textContent.includes("Keine deutsche Beschreibung"))) {
            const ovText = String(d._showTranslatedOverviewDe && d._translatedOverviewDe ? d._translatedOverviewDe : d.overview).trim();
            ovTextEl.textContent = ovText;
            ovTextEl.setAttribute("data-orig-overview", String(d._originalOverviewEn || d.overview || "").trim());
          }

          const hadFocusInPrimaryGroup = Boolean(
            typeof currentSpatialEl !== "undefined" &&
            currentSpatialEl &&
            currentSpatialEl.closest &&
            currentSpatialEl.closest("#detailActionPrimaryGroupEl")
          );
          const actionGroupEl = document.getElementById("detailActionPrimaryGroupEl");
          if (actionGroupEl) {
            actionGroupEl.innerHTML = primaryActionButtonsHtml;
          }
          const stickyPlayBtn = document.getElementById("detailStickyPrimaryPlayBtn");
          if (stickyPlayBtn) {
            stickyPlayBtn.textContent = primaryPlayBtnLabel;
            stickyPlayBtn.setAttribute("onclick", primaryClickJs);
          }
          const moreBoxEl = document.getElementById("modalMoreActionsBox");
          if (moreBoxEl) {
            moreBoxEl.innerHTML = moreActionsInnerHtml;
          }
          const bodyEl = document.getElementById("detailContentBodyEl");
          if (bodyEl) {
            bodyEl.innerHTML = contentBodyInnerHtml;
          }

          initDetailHorizontalDragScrollClient(m);
          unlockCatalogCoversLoadingClient(false);
          observeLazyCoversInContainerClient(m);
          if (type === "m" && d.collection && d.collection.id) {
            autoLoadCollectionInDetailClient(d.collection.id, d.id || id);
          }
          autoLoadSimilarInDetailClient(type, d.id || id);
          const pauseStreamBtn = document.getElementById("detailCinemaPauseStreamBtn");
          const endPrimaryBtn = document.getElementById("detailCinemaEndPrimaryBtn");
          const cinemaPrimaryHtml = (hasVipStreams ? CINEMA_ICONS_CLIENT.stream : CINEMA_ICONS_CLIENT.info) +
            '<span>' + (hasVipStreams ? 'Stream starten' : 'Filminfos ansehen') + '</span>';
          if (pauseStreamBtn) pauseStreamBtn.innerHTML = cinemaPrimaryHtml;
          if (endPrimaryBtn) endPrimaryBtn.innerHTML = cinemaPrimaryHtml;

          const shouldStayForeground = Boolean(
            (autoOpenTrailer && !detailAutoOpenTrailerCancelled) ||
            existingStageEl.classList.contains("is-trailer-foreground-mode")
          );
          if (!detailBgTeaserActiveKey) {
            scheduleDetailBackgroundVideoTeaserClient(tr, shouldStayForeground);
          } else if (shouldStayForeground) {
            existingStageEl.classList.add("is-trailer-foreground-mode");
            enforceDetailForegroundUnmuteClient();
            applyYoutubeSubtitlesStateClient(sendYoutubeBgTeaserCommandClient, detailBgTeaserCcMode, detailBgTeaserActiveKey);
            syncDetailCinemaDockUiClient();
          }

          if (typeof syncExpandableDescriptionsOverflowClient === "function") {
            requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(m));
          }
          if (typeof window.refreshModalAndEpisodeMarquees === "function") {
            setTimeout(() => window.refreshModalAndEpisodeMarquees(m), 60);
          }
          if (type === "s") {
            loadSeason(d.id, initialSeason, false);
          }
          if (hadFocusInPrimaryGroup && !shouldStayForeground) {
            const firstModalBtn = m.querySelector("#detailPrimaryPlayBtn, #detailTrailerBtn, #modalWishlistBtn");
            if (firstModalBtn && typeof jumpSpatialFocus === "function") {
              jumpSpatialFocus(firstModalBtn, false);
            }
          }
          return;
        }

        m.innerHTML = '<div class="modal-backdrop" onwheel="onModalWheelHorizontalClient(event)" onscroll="onDetailModalScrollClient(this)">' +
          '<div class="modal detail-morph-enter">' +
            /* STICKY MINI-HEADER BEIM RUNTERSCROLLEN */
            '<div id="detailStickyMiniHeader" class="detail-sticky-mini-header">' +
              '<div class="detail-sticky-mini-left">' +
                '<span class="hero-badge ' + (type === "s" ? "series" : "movie") + '">' + (type === "s" ? "SERIE" : "FILM") + '</span>' +
                '<span class="detail-sticky-mini-title">' + esc(d.title) + '</span>' +
                ((d.vote && d.vote !== "0.0") ? ('<span class="hero-meta-star" style="font-size:13px">★ ' + esc(d.vote) + '</span>') : '') +
              '</div>' +
              '<div class="detail-sticky-mini-actions">' +
                '<button type="button" id="detailStickyPrimaryPlayBtn" class="detail-btn-play-white" style="padding:6px 14px;font-size:12.5px" onclick="' + primaryClickJs + '">' + esc(primaryPlayBtnLabel) + '</button>' +
                '<button type="button" id="modalStickyWishlistBtn" class="detail-btn-glass ' + (d.isSaved ? "saved" : "") + '" style="padding:6px 12px;font-size:12px" onclick="toggleWishlistItem(\\'' + type + '\\',' + Number(d.id) + ')" title="Auf die Merkliste setzen / entfernen">' + (d.isSaved ? "✓ Gespeichert" : "＋ Speichern") + '</button>' +
                '<button type="button" class="detail-btn-glass" style="padding:6px 11px;font-size:12px" onclick="scrollDetailModalToHeroStageTopClient()" title="Nach oben zur Bühne">↑ Oben</button>' +
                '<button type="button" class="detail-btn-glass" style="padding:6px 11px;font-size:12px" onclick="closeDetailModal()" title="Detailansicht schließen (Esc)">✕</button>' +
              '</div>' +
            '</div>' +

            /* 1:1 FULLSCREEN KINO-HERO-STAGE EXAKT WIE IM HAUPT-SLIDER (ZERO JUMP) */
            '<section id="detailHeroStageEl" class="detail-hero-stage' + (autoOpenTrailer ? ' is-trailer-foreground-mode is-cinema-starting' : '') + '" data-detail-key="' + esc(detailKey) + '" data-has-backdrop="' + (d.backdrop_path ? '1' : '') + '" style="' + bgVarsStyle + '" ontouchstart="onModalHeroTouchStart(event)" ontouchend="onModalHeroTouchEnd(event)" onmousedown="onModalHeroMouseDown(event)" onmouseup="onModalHeroMouseUp(event)">' +
              '<div class="detail-backdrop-layer"></div>' +
              '<div id="detailBgVideoLayer" class="detail-bg-video-layer"></div>' +
              '<div class="detail-ambilight-glow"></div>' +
              '<div class="detail-scrim-layer"></div>' +
              '<div class="detail-scroll-dim-overlay"></div>' +
              '<div class="hero-inner">' +
                '<div class="hero-widescreen-body">' +
                  '<div class="detail-hero-content">' +
                    /* 1. EDLE KICKER-ZEILE DIREKT ÜBER DEM TITEL */
                    '<div id="detailKickerEl" class="detail-kicker-row">' + kickerRowHtml + '</div>' +

                    /* 2. FILMTITEL / OFFIZIELLES TMDB CLEARLOGO (OHNE KLICK-SUCHE AUF DER DETAILSEITE) */
                    '<div id="detailTitleBoxEl" class="hero-title">' +
                      buildHeroTitleOrLogoInnerHtmlClient(d.title, activeLogoPath) +
                    '</div>' +

                    /* 3. KOMPAKTE 1-ZEILIGE META-ZEILE (1:1 MIT SLIDER) */
                    '<div id="detailMetaCleanEl" class="hero-meta-clean">' + unboxedMetaHtml + '</div>' +

                    /* 4. BESCHREIBUNG ÜBER DEN AKTIONS-BUTTONS (EINHEITLICHE STAGE-KOMPONENTE 1:1 WIE IM SLIDER) */
                    buildUnifiedStageDescriptionBoxHtmlClient({
                      boxId: "modalHeaderOverviewEl",
                      textId: "modalHeaderOverviewTextEl",
                      translateBtnId: "modalHeaderTranslateBtn",
                      translateTargetKey: "activeDetails",
                      overviewText: String(d._showTranslatedOverviewDe && d._translatedOverviewDe ? d._translatedOverviewDe : (d.overview || "Keine deutsche Beschreibung hinterlegt.")).trim(),
                      rawOrigOverview: String(d._originalOverviewEn || d.overview || "").trim(),
                      isTranslated: Boolean(d._showTranslatedOverviewDe && d._translatedOverviewDe),
                      alwaysRenderTranslateBtn: false
                    }) +

                    /* 5. AKTIONS-BUTTONS UNTER DER BESCHREIBUNG */
                    '<div class="detail-action-bar">' +
                      '<div id="detailActionPrimaryGroupEl" class="detail-action-primary-group">' +
                        primaryActionButtonsHtml +
                      '</div>' +
                    '</div>' +

                    '<div id="modalPosterPickerBox" style="display:none;margin:8px 0;padding:12px;border-radius:10px;background:rgba(15,23,42,0.94);border:1px solid rgba(168,85,247,0.45)"></div>' +
                    '<div id="modalRemapMediaBox" style="display:none;margin:8px 0;padding:12px;border-radius:10px;background:rgba(15,23,42,0.94);border:1px solid rgba(56,189,248,0.45)"></div>' +
                    '<div id="modalMoreActionsBox" style="display:none;gap:6px;flex-wrap:wrap;padding:10px 12px;border-radius:10px;background:rgba(15,23,42,0.88);border:1px solid rgba(148,163,184,0.24)">' +
                      moreActionsInnerHtml +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="hero-bottom-bar">' +
                  '<button type="button" tabindex="-1" class="hero-scroll-down-hint" onclick="scrollToDetailBelowFoldClient(event)" title="Nach unten zu Streams, Cast & Empfehlungen scrollen" aria-label="Nach unten zu Streams, Cast & Empfehlungen scrollen">' +
                    '<span class="hero-scroll-down-label">' + (type === "s" ? "📺 Staffeln, Cast & Infos" : "🎬 Streams, Cast & Infos") + '</span>' +
                    '<svg class="hero-scroll-down-chevron" viewBox="0 0 24 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                      '<path d="M2.5 2.25L12 10.75L21.5 2.25" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '</svg>' +
                  '</button>' +
                '</div>' +
              '</div>' +
              /* EINHEITLICHER KINO-PLAYER (100% IDENTISCH ZUM HERO-SLIDER) */
              buildCinemaPlayerOverlayHtmlClient({
                mode: "detail",
                title: d.title,
                year: (d.year && d.year !== "K.A.") ? d.year : "",
                hasVipStreams: hasVipStreams,
                autoOpenTrailer: autoOpenTrailer
              }) +
            '</section>' +

            /* 6. UNTERER CONTENT-BEREICH BEIM RUNTERSCROLLEN */
            '<div id="detailContentBodyEl" class="detail-content-body">' +
              contentBodyInnerHtml +
            '</div>' +
            '<div id="personSpotlightOverlayRoot"></div>' +
          '</div>' +
        '</div>';

        if (backdropW1280 || portraitBg) {
          applyDynamicHeroAmbilightClient(backdropW1280 || portraitBg);
        }
        initDetailHorizontalDragScrollClient(m);
        unlockCatalogCoversLoadingClient(false);
        observeLazyCoversInContainerClient(m);

        if (!isSeedOnly) {
          if (type === "m" && d.collection && d.collection.id) {
            autoLoadCollectionInDetailClient(d.collection.id, d.id || id);
          }
          autoLoadSimilarInDetailClient(type, d.id || id);
          scheduleDetailBackgroundVideoTeaserClient(tr, autoOpenTrailer && !detailAutoOpenTrailerCancelled);
          if (type === "s") {
            loadSeason(d.id, initialSeason, false);
          }
        } else if (autoOpenTrailer) {
          syncDetailCinemaDockUiClient();
          wakeDetailCinemaDockClient();
        }

        if (typeof syncExpandableDescriptionsOverflowClient === "function") {
          requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(m));
        }
        if (typeof window.refreshModalAndEpisodeMarquees === "function") {
          setTimeout(() => window.refreshModalAndEpisodeMarquees(m), 60);
        }
        const initialFocusEl = (autoOpenTrailer && !detailAutoOpenTrailerCancelled)
          ? (document.getElementById("detailCinemaPlayBtn") || document.getElementById("detailCinemaModeBtn") || document.getElementById("detailCinemaTopCloseBtn"))
          : (m.querySelector("#detailPrimaryPlayBtn, #detailTrailerBtn, #modalWishlistBtn") || document.getElementById("topBarBackBtn"));
        if (initialFocusEl && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(initialFocusEl, false);
        }
      }

      let activeDetailReqSeq = 0;
      let activeSeasonReqSeq = 0;

      async function openDetails(type, id, autoOpenTrailer = false, preTitle = "", prePoster = "", forceSeasonNum = null) {
        if (typeof lastCardLongPressAt !== "undefined" && Date.now() - lastCardLongPressAt < 650) {
          return;
        }
        const reqSeq = ++activeDetailReqSeq;
        activeSeasonReqSeq++;
        detailAutoOpenTrailerCancelled = false;
        state.openedFromRandom = Boolean(window._openingViaRandomDice);
        window._openingViaRandomDice = false;
        if (typeof hideTmaMobileKeyboardClient === "function") {
          hideTmaMobileKeyboardClient();
        }
        if (typeof stopHeroBackgroundVideoTeaserClient === "function") {
          stopHeroBackgroundVideoTeaserClient();
        }
        saveModalReturnFocusTarget(type, id);
        const seedItem = findPreloadedSeedItemClient(type, id, preTitle, prePoster);
        if (seedItem) {
          addRecentViewedItem(seedItem, type);
        } else if (id && (preTitle || prePoster)) {
          addRecentViewedItem({ id, title: preTitle, poster_path: prePoster }, type);
        }
        if (typeof window.notifyTvSyncDetailOpenedClient === "function") {
          window.notifyTvSyncDetailOpenedClient(type, Number(id), Boolean(autoOpenTrailer), preTitle || (seedItem && seedItem.title) || "");
        }
        if (typeof window.refreshTvSyncDevicesLazyClient === "function") {
          window.refreshTvSyncDevicesLazyClient(false);
        }
        const vipAllowed = isCurrentUserVip();
        const cacheKey = type + "_" + id + "_" + (vipAllowed ? "vip" : "std");
        const cachedEntry = clientDetailsCache.get(cacheKey);
        const hasValidCache = Boolean(cachedEntry && (Date.now() - cachedEntry.ts < CLIENT_CACHE_TTL_MS));

        if (!hasValidCache && seedItem) {
          // 0ms SOFORT-BÜHNE: Vorhandene Daten aus dem Hero-Slider / Katalog sofort rendern, ohne alles neu zu laden!
          state.activeDetails = { ...seedItem, typeCode: type, id: seedItem.id || id };
          renderOrPatchDetailStageClient(type, id, state.activeDetails, forceSeasonNum, autoOpenTrailer, false);
        } else if (!hasValidCache) {
          setBusyState(true, "⏳ Lade Details...");
        }

        try {
          const d = hasValidCache
            ? cachedEntry.data
            : await apiFetchJson(API_BASE + "/details?type=" + type + "&id=" + id);
          if (!d || d.ok === false) {
            throw new Error(d?.error || "Titeldetails konnten nicht geladen werden.");
          }
          if (!hasValidCache) {
            clientDetailsCache.set(cacheKey, { data: d, ts: Date.now() });
          }
          // Race-Condition-Schutz: Falls inzwischen ein anderer Titel geöffnet oder das Modal geschlossen wurde, veraltete Antwort verwerfen
          if (reqSeq !== activeDetailReqSeq) {
            return;
          }
          if (seedItem && seedItem._showTranslatedOverviewDe && seedItem._translatedOverviewDe) {
            d._translatedOverviewDe = seedItem._translatedOverviewDe;
            d._showTranslatedOverviewDe = true;
            d._originalOverviewEn = seedItem._originalOverviewEn || d.overview || "";
          }
          state.activeDetails = { ...d, typeCode: type, id: d.id || id };
          if (d.botUsername) state.botUsername = d.botUsername;
          if (d.isSaved) savedKeysSet.add(type + "_" + (d.id || id));
          addRecentViewedItem(d, type);

          renderOrPatchDetailStageClient(type, id, state.activeDetails, forceSeasonNum, autoOpenTrailer, Boolean(!hasValidCache && seedItem));

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
          if (reqSeq === activeDetailReqSeq && !seedItem) {
            showHudToast("⚠️ Details konnten nicht geladen werden – bitte erneut antippen.");
          }
        } finally {
          if (reqSeq === activeDetailReqSeq) {
            setBusyState(false);
          }
        }
      }

      function switchDetailModalTab(tabName) {
        state.activeDetailTab = tabName;
      }

      // Hilfsfunktionen für Qualitäts-Ranking, Qualitäts-Badge & Episodentitel-Auflösung
      function getQualityRankScoreClient(qRaw) {
        const q = String(qRaw || "").toUpperCase();
        if (q.includes("2160") || q.includes("4K") || q.includes("UHD")) return 400;
        if (q.includes("1440") || q.includes("2K")) return 300;
        if (q.includes("1080") || q.includes("FHD")) return 200;
        if (q.includes("720") || q.includes("HD")) return 100;
        if (q.includes("576") || q.includes("480") || q.includes("SD")) return 50;
        return 150;
      }

      function formatQualityBadgeHtmlClient(qRaw, extraCodec) {
        const qClean = String(qRaw || "1080p").trim() || "1080p";
        const qUpper = qClean.toUpperCase();
        const cls = (qUpper.includes("2160") || qUpper.includes("4K"))
          ? "ep-quality-badge q-uhd"
          : (qUpper.includes("480") || qUpper.includes("576") || qUpper.includes("SD"))
            ? "ep-quality-badge q-sd"
            : "ep-quality-badge";
        const codecClean = String(extraCodec || "").trim();
        const label = codecClean && !/^(rar|archive)$/i.test(codecClean) ? (qClean + " · " + codecClean) : qClean;
        return '<span class="' + cls + '" title="Video-Qualität: ' + esc(label) + '">📺 ' + esc(label) + '</span>';
      }

      function resolveClientEpisodeTitle(seriesId, seasonNum, epNum, fileObj) {
        const sNum = Number(seasonNum !== undefined && seasonNum !== null ? seasonNum : (fileObj?.season_number ?? 1));
        const eNum = Number(epNum !== undefined && epNum !== null ? epNum : (fileObj?.episode_number ?? 1));
        if (fileObj) {
          const directTitle = String(fileObj.episode_title || fileObj.episodeTitle || fileObj.epName || "").trim();
          if (directTitle && !/^Folge\\s+\\d+$/i.test(directTitle)) return directTitle;
        }
        if (Array.isArray(activeSeasonCacheEpisodes) && activeSeasonCacheEpisodes.length > 0) {
          const hit = activeSeasonCacheEpisodes.find(e => Number(e.season_number !== undefined && e.season_number !== null ? e.season_number : sNum) === sNum && Number(e.episode_number) === eNum);
          if (hit && hit.name && !/^Folge\\s+\\d+$/i.test(hit.name)) return String(hit.name).trim();
        }
        if (typeof clientSeasonCache !== "undefined" && clientSeasonCache instanceof Map) {
          const vipEntry = clientSeasonCache.get(seriesId + "_" + sNum + "_vip") || clientSeasonCache.get(seriesId + "_" + sNum + "_std");
          const eps = vipEntry?.data?.episodes;
          if (Array.isArray(eps)) {
            const hit = eps.find(e => Number(e.episode_number) === eNum);
            if (hit && hit.name && !/^Folge\\s+\\d+$/i.test(hit.name)) return String(hit.name).trim();
          }
        }
        const allFiles = Array.isArray(state.activeDetails?.allStreamFiles) ? state.activeDetails.allStreamFiles : [];
        const fileWithTitle = allFiles.find(f => Number(f.season_number ?? 1) === sNum && Number(f.episode_number ?? 1) === eNum && (f.episode_title || f.episodeTitle));
        if (fileWithTitle) {
          return String(fileWithTitle.episode_title || fileWithTitle.episodeTitle).trim();
        }
        if (fileObj && fileObj.raw_filename) {
          const fn = String(fileObj.raw_filename).replace(/\\.(mp4|mkv|avi|m4v|ts|mov|webm|rar)$/i, "").replace(/[._]+/g, " ").trim();
          const m = fn.match(/S\\d{1,2}\\s*E\\d{1,3}\\s*[-–—:]?\\s*(.+?)(?:\\s+(?:1080p|720p|2160p|480p|4K|GERMAN|DL|WEB|BluRay|HDTV|x264|x265|HEVC|AVC)\\b|$)/i);
          if (m && m[1] && m[1].trim().length >= 2) {
            return m[1].trim();
          }
        }
        return "Folge " + eNum;
      }

      let versionsTabSeasonFilter = -1; // -1 = Alle Staffeln, >=0 = spezifische Staffel (inkl. Staffel 0 Specials)
      let versionsTabPreferredProfile = "auto"; // 'auto' oder spezifisches Profil für Auto-Fill

      function setVersionsTabSeasonFilterClient(seasonNum) {
        versionsTabSeasonFilter = seasonNum !== undefined && seasonNum !== null ? Number(seasonNum) : -1;
        refreshDetailModalVersionsTabDomClient();
      }

      function setVersionsTabPreferredProfileClient(profileKey) {
        versionsTabPreferredProfile = String(profileKey || "auto");
        refreshDetailModalVersionsTabDomClient();
      }

      function refreshDetailModalVersionsTabDomClient() {
        const panel = document.getElementById("flixTabPanel_versions");
        const d = state.activeDetails;
        if (!panel || !d) return;
        const type = d.typeCode === "s" || Array.isArray(d.seasons) ? "s" : "m";
        const vipAllowed = isCurrentUserVip();
        const isAdminUser = Boolean(state.authUser?.isAdmin);
        const canReportMedia = Boolean(vipAllowed || isAdminUser);
        panel.innerHTML = buildDetailModalVersionsTabHtml(d, type, vipAllowed, isAdminUser, canReportMedia);
        if (typeof window.refreshModalAndEpisodeMarquees === "function") {
          setTimeout(() => window.refreshModalAndEpisodeMarquees(panel), 40);
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

        // Staffeln ermitteln (bei Serien inklusive Staffel 0 Specials)
        const seasonSet = new Set();
        for (const f of allFiles) {
          if (!f) continue;
          const sn = Number(f.season_number ?? 1);
          if (sn >= 0) seasonSet.add(sn);
        }
        const availableSeasons = Array.from(seasonSet).sort((a, b) => a - b);
        const activeSeasonFilter = (type === "s" && versionsTabSeasonFilter >= 0 && seasonSet.has(versionsTabSeasonFilter))
          ? versionsTabSeasonFilter
          : -1;

        const filteredFiles = (type === "s" && activeSeasonFilter >= 0)
          ? allFiles.filter(f => f && Number(f.season_number ?? 1) === activeSeasonFilter)
          : allFiles;

        // Gruppiere Dateien nach Schnittfassung / Qualität
        const groupsMap = new Map();
        const profileCounts = new Map();
        for (const f of filteredFiles) {
          if (!f) continue;
          const isRar = String(f.codec || "").toUpperCase() === "RAR" || /^RAR/i.test(String(f.part || "")) || /\\.rar$/i.test(String(f.raw_filename || ""));
          const baseVer = isRar ? "📦 RAR-Archiv" : (String(f.versionLabel || f.version_label || f.tags || "Originalfassung").trim() || "Originalfassung");
          const qualClean = String(f.quality || "1080p").trim() || "1080p";
          const groupKey = isRar ? baseVer : (baseVer + " · " + qualClean);
          if (!groupsMap.has(groupKey)) groupsMap.set(groupKey, []);
          groupsMap.get(groupKey).push(f);
          if (!isRar) {
            profileCounts.set(groupKey, (profileCounts.get(groupKey) || 0) + 1);
          }
        }

        // Staffel-Filterleiste oben im Versionen-Tab
        const seasonFilterBarHtml = (type === "s" && availableSeasons.length > 1) ? (
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
            '<span style="font-size:11.5px;font-weight:800;color:#94a3b8">📺 Staffel-Filter:</span>' +
            '<button type="button" class="season-tab-btn ' + (activeSeasonFilter === -1 ? 'active' : '') + '" style="padding:4px 10px;font-size:11.5px" onclick="setVersionsTabSeasonFilterClient(-1)">Alle Staffeln (' + allFiles.length + ')</button>' +
            availableSeasons.map(sn => {
              const cnt = allFiles.filter(f => f && Number(f.season_number ?? 1) === sn).length;
              const sLabel = sn === 0 ? "Staffel 0 (Specials)" : ("Staffel " + sn);
              return '<button type="button" class="season-tab-btn ' + (activeSeasonFilter === sn ? 'active' : '') + '" style="padding:4px 10px;font-size:11.5px" onclick="setVersionsTabSeasonFilterClient(' + sn + ')">' + esc(sLabel) + ' · ' + cnt + '</button>';
            }).join("") +
          '</div>'
        ) : '';

        // KOMPLETTE AUTO-FILL STAFFEL-ANSICHT (Standard bei Serien: Füllt fehlende Folgen einer Qualität/Version automatisch mit einer anderen Version auf!)
        let completeAutoFillHtml = "";
        if (type === "s") {
          const streamOnlyFiles = filteredFiles.filter(f => {
            if (!f) return false;
            const isRar = String(f.codec || "").toUpperCase() === "RAR" || /^RAR/i.test(String(f.part || "")) || /\\.rar$/i.test(String(f.raw_filename || ""));
            return !isRar && !f.is_download_only && !f.isDownloadOnly;
          });
          if (streamOnlyFiles.length > 0) {
            const sortedProfiles = Array.from(profileCounts.entries())
              .sort((a, b) => {
                if (b[1] !== a[1]) return b[1] - a[1];
                return getQualityRankScoreClient(b[0]) - getQualityRankScoreClient(a[0]);
              })
              .map(entry => entry[0]);
            const dominantProfile = (versionsTabPreferredProfile !== "auto" && sortedProfiles.includes(versionsTabPreferredProfile))
              ? versionsTabPreferredProfile
              : (sortedProfiles[0] || "Originalfassung · 1080p");

            // Gruppiere alle vorhandenen Episoden nach (Staffel, Folge)
            const epBuckets = new Map();
            const seasonsInScope = activeSeasonFilter >= 0 ? [activeSeasonFilter] : availableSeasons;
            for (const sn of seasonsInScope) {
              const sFiles = streamOnlyFiles.filter(f => Number(f.season_number ?? 1) === sn);
              for (const f of sFiles) {
                const en = Number(f.episode_number ?? 1);
                const bKey = sn + "_" + en;
                if (!epBuckets.has(bKey)) epBuckets.set(bKey, { season: sn, episode: en, files: [] });
                epBuckets.get(bKey).files.push(f);
              }
            }

            const sortedEpKeys = Array.from(epBuckets.values()).sort((a, b) => {
              if (a.season !== b.season) return a.season - b.season;
              return a.episode - b.episode;
            });

            let autoFilledCount = 0;
            const completeRowsHtml = sortedEpKeys.map(bucket => {
              const sn = bucket.season;
              const en = bucket.episode;
              const epCode = "S" + String(sn).padStart(2, "0") + "E" + String(en).padStart(2, "0");
              const candidateFiles = bucket.files.slice().sort((a, b) => getQualityRankScoreClient(b.quality) - getQualityRankScoreClient(a.quality));
              const exactMatch = candidateFiles.find(f => {
                const bVer = String(f.versionLabel || f.version_label || f.tags || "Originalfassung").trim() || "Originalfassung";
                const qCln = String(f.quality || "1080p").trim() || "1080p";
                return (bVer + " · " + qCln) === dominantProfile;
              });
              const chosenFile = exactMatch || candidateFiles[0];
              const isFilledFromOther = Boolean(!exactMatch && sortedProfiles.length > 1);
              if (isFilledFromOther) autoFilledCount++;

              const chosenVerLbl = String(chosenFile.versionLabel || chosenFile.version_label || chosenFile.tags || "Originalfassung").trim() || "Originalfassung";
              const chosenQual = String(chosenFile.quality || "1080p").trim() || "1080p";
              const chosenSize = formatFileSizeClient(chosenFile.file_size);
              const chosenSubs = Array.isArray(chosenFile.subtitles) ? chosenFile.subtitles : [];
              const epTitleStr = resolveClientEpisodeTitle(d.id, sn, en, chosenFile);

              return '<div class="ep-row ' + (isFilledFromOther ? 'ep-autofilled' : '') + '" style="margin-bottom:5px;padding:8px 10px">' +
                '<div class="ep-row-top">' +
                  '<div class="ep-title" tabindex="0" onclick="openEpisodeStory(' + Number(d.id) + ',' + sn + ',' + en + ',\\'' + escJs(epTitleStr) + '\\')" title="' + esc(epCode + ' – ' + epTitleStr) + '">' +
                    '<span class="ep-code-badge">' + esc(epCode) + '</span>' +
                    '<div class="ep-name-wrap"><span class="ep-name-text">' + esc(epTitleStr) + '</span></div>' +
                  '</div>' +
                  '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;flex-shrink:0">' +
                    formatQualityBadgeHtmlClient(chosenQual, chosenFile.codec) +
                    '<span class="stream-meta-pill">' + esc(chosenVerLbl) + (chosenSize ? (' · ' + esc(chosenSize)) : '') + '</span>' +
                    (isFilledFromOther ? '<span class="ep-autofill-badge" title="Fehlte in ' + esc(dominantProfile) + ' – automatisch aufgefüllt aus ' + esc(chosenVerLbl + ' (' + chosenQual + ')') + '">🔄 Aufgefüllt · ' + esc(chosenQual) + '</span>' : '') +
                  '</div>' +
                '</div>' +
                '<div class="ep-row-bottom">' +
                  '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0">' +
                    '<button type="button" class="btn-stream-clean" data-fid="' + esc(chosenFile.telegram_file_id) + '" data-title="' + esc(d.title + ' ' + epCode + ' - ' + epTitleStr) + '" data-qual="' + esc(chosenQual) + '" data-sid="' + Number(d.id) + '" data-sn="' + sn + '" data-en="' + en + '" data-epname="' + esc(epTitleStr) + '" data-size="' + esc(chosenSize) + '" data-tags="' + esc(chosenVerLbl) + '" onclick="requestTelegramStreamFromBtn(this)">▶ Stream · ' + esc(chosenQual) + (chosenSize ? (' · ' + esc(chosenSize)) : '') + (chosenSubs.length > 0 ? ' + UT' : '') + '</button>' +
                    (chosenSubs.length > 0 ? '<button type="button" class="btn-tool-quiet" style="padding:4px 8px;font-size:11px" data-fid="' + esc(chosenFile.telegram_file_id) + '" data-title="' + esc(d.title + ' ' + epCode) + '" data-sid="' + Number(d.id) + '" data-sn="' + sn + '" data-en="' + en + '" onclick="requestTelegramSubtitleOnlyFromBtn(this)">💬 UT (' + chosenSubs.length + ')</button>' : '') +
                    (isAdminUser && chosenFile.raw_filename ? '<span style="font-size:10.5px;color:#94a3b8;font-family:monospace;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(chosenFile.raw_filename) + '">📄 ' + esc(chosenFile.raw_filename) + '</span>' : '') +
                  '</div>' +
                  '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                    (isAdminUser ? '<button type="button" class="ep-ghost-btn admin-remap-btn" data-type="s" data-tmdb-id="' + Number(d.id) + '" data-sn="' + sn + '" data-en="' + en + '" data-epname="' + esc(epTitleStr) + '" data-fid="' + esc(chosenFile.telegram_file_id) + '" data-ver="' + esc(chosenVerLbl) + '" data-qual="' + esc(chosenQual) + '" data-raw="' + esc(chosenFile.raw_filename || '') + '" data-msg="' + esc(chosenFile.message_link || '') + '" onclick="openEpisodeCorrectionFromBtn(this)" title="Folge ' + esc(epCode) + ' (' + esc(epTitleStr) + ') neu zuordnen">✏️ ' + esc(epCode) + ' zuordnen</button>' : '') +
                    (canReportMedia ? '<button type="button" class="ep-ghost-btn" data-type="s" data-tmdb-id="' + Number(d.id) + '" data-sn="' + sn + '" data-en="' + en + '" data-epname="' + esc(epTitleStr) + '" data-fid="' + esc(chosenFile.telegram_file_id) + '" data-ver="' + esc(chosenVerLbl) + '" onclick="openMediaReportFromBtn(this)" title="Fehler für ' + esc(epCode) + ' melden">⚠️</button>' : '') +
                  '</div>' +
                '</div>' +
              '</div>';
            }).join("");

            const profileSwitcherHtml = sortedProfiles.length > 1 ? (
              '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
                '<span style="font-size:11px;color:#94a3b8;font-weight:700">Bevorzugte Basis-Qualität (fehlende Folgen werden automatisch ergänzt):</span>' +
                sortedProfiles.map(prof => {
                  const isAct = prof === dominantProfile;
                  return '<button type="button" class="delivery-pill-btn ' + (isAct ? 'active' : '') + '" style="padding:3px 8px;font-size:11px" onclick="setVersionsTabPreferredProfileClient(\\'' + escJs(prof) + '\\')">' + esc(prof) + '</button>';
                }).join("") +
              '</div>'
            ) : '';

            completeAutoFillHtml =
              '<div style="margin-bottom:14px;padding:12px;border-radius:12px;background:linear-gradient(135deg,rgba(14,165,233,0.12),rgba(15,23,42,0.85));border:1px solid rgba(56,189,248,0.38)">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
                  '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
                    '<span class="flix-version-badge" style="background:linear-gradient(135deg,#0284c7,#4338ca);border-color:#7dd3fc;color:#fff">✨ Komplette Staffel-Ansicht (Auto-Fill Standard)</span>' +
                    '<span class="stream-meta-pill size">' + sortedEpKeys.length + ' Folgen lückenlos</span>' +
                    (autoFilledCount > 0 ? '<span class="ep-autofill-badge">🔄 ' + autoFilledCount + ' Folge' + (autoFilledCount === 1 ? '' : 'n') + ' aus Alternativ-Version ergänzt</span>' : '<span class="stream-meta-pill" style="border-color:rgba(16,185,129,0.45);color:#6ee7b7">✓ Alle Folgen in ' + esc(dominantProfile) + '</span>') +
                  '</div>' +
                '</div>' +
                '<div style="font-size:11.5px;color:#cbd5e1;margin-bottom:8px">' +
                  'Zeigt dir immer alle verfügbaren Folgen durchgehend an. Falls einzelne Episoden in <b>' + esc(dominantProfile) + '</b> fehlen, werden sie automatisch mit einer anderen vorhandenen Version aufgefüllt und direkt mit ihrer jeweiligen Qualität gekennzeichnet.' +
                '</div>' +
                profileSwitcherHtml +
                '<div style="display:flex;flex-direction:column;gap:4px;max-height:340px;overflow-y:auto;padding-right:2px">' +
                  completeRowsHtml +
                '</div>' +
              '</div>';
          }
        }

        return '<div class="panel-box" style="margin:6px 0">' +
          '<div class="section-title" style="margin-bottom:8px">' +
            '<span>🎞️ Verfügbare Schnittfassungen & Versionen (' + groupsMap.size + ' Fassung' + (groupsMap.size === 1 ? '' : 'en') + ' • ' + filteredFiles.length + ' Datei' + (filteredFiles.length === 1 ? '' : 'en') + ')</span>' +
          '</div>' +
          seasonFilterBarHtml +
          completeAutoFillHtml +
          '<div style="font-size:11.5px;color:#94a3b8;margin-bottom:8px;font-weight:700">' +
            '📂 Einzelne Schnittfassungen & Qualitäts-Gruppen im Detail:' +
          '</div>' +
          Array.from(groupsMap.entries()).map(([vLabel, filesList]) => {
            const sortedGroupFiles = filesList.slice().sort((a, b) => {
              const sa = Number(a.season_number ?? 1);
              const sb = Number(b.season_number ?? 1);
              if (sa !== sb) return sa - sb;
              return Number(a.episode_number ?? 1) - Number(b.episode_number ?? 1);
            });
            return '<div style="margin-bottom:12px;padding:11px;border-radius:11px;background:rgba(15,23,42,0.65);border:1px solid rgba(148,163,184,0.2)">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
                '<span class="flix-version-badge">🎞️ ' + esc(vLabel) + '</span>' +
                '<span class="stream-meta-pill">' + sortedGroupFiles.length + (type === 's' ? (' Folge' + (sortedGroupFiles.length === 1 ? '' : 'n')) : (' Datei' + (sortedGroupFiles.length === 1 ? '' : 'en'))) + '</span>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:5px;max-height:280px;overflow-y:auto;padding-right:2px">' +
                sortedGroupFiles.map(f => {
                  const sNum = Number(f.season_number ?? 1);
                  const eNum = Number(f.episode_number ?? 1);
                  const epCode = type === 's' ? ('S' + String(sNum).padStart(2, '0') + 'E' + String(eNum).padStart(2, '0')) : '';
                  const epTitleStr = type === 's' ? resolveClientEpisodeTitle(d.id, sNum, eNum, f) : (d.title || 'Film');
                  const sizeStr = formatFileSizeClient(f.file_size);
                  const isRar = String(f.codec || "").toUpperCase() === "RAR" || /^RAR/i.test(String(f.part || "")) || /\\.rar$/i.test(String(f.raw_filename || ""));
                  const partStr = String(f.part || "").trim();
                  const subsList = Array.isArray(f.subtitles) ? f.subtitles : [];
                  const cleanVer = String(f.versionLabel || f.version_label || f.tags || "Originalfassung").trim() || "Originalfassung";
                  return '<div class="ep-row" style="margin-bottom:0;padding:8px 10px">' +
                    '<div class="ep-row-top">' +
                      '<div class="ep-title" tabindex="0" ' + (type === 's' ? ('onclick="openEpisodeStory(' + Number(d.id) + ',' + sNum + ',' + eNum + ',\\'' + escJs(epTitleStr) + '\\')"') : '') + '>' +
                        '<span class="ep-code-badge">' + (epCode ? esc(epCode) : (isRar ? '📦 RAR' : '🎬 Film')) + '</span>' +
                        '<div class="ep-name-wrap"><span class="ep-name-text">' + esc(type === 's' ? epTitleStr : (partStr || cleanVer || d.title)) + '</span></div>' +
                      '</div>' +
                      '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;flex-shrink:0">' +
                        formatQualityBadgeHtmlClient(f.quality || '1080p', f.codec) +
                        (sizeStr ? '<span class="stream-meta-pill">' + esc(sizeStr) + '</span>' : '') +
                        (subsList.length > 0 ? '<span class="stream-meta-pill" style="border-color:rgba(16,185,129,0.5);color:#34d399">💬 ' + subsList.length + ' UT</span>' : '') +
                      '</div>' +
                    '</div>' +
                    '<div class="ep-row-bottom">' +
                      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0">' +
                        '<button type="button" class="' + (isRar ? 'btn amber' : 'btn-stream-clean') + '" data-fid="' + esc(f.telegram_file_id) + '" data-title="' + esc(d.title + (epCode ? (' ' + epCode + ' - ' + epTitleStr) : '') + (partStr ? (' (' + partStr + ')') : '')) + '" data-qual="' + esc(f.quality || '1080p') + '" data-sid="' + Number(d.id) + '" data-sn="' + sNum + '" data-en="' + eNum + '" data-epname="' + esc(epTitleStr) + '" data-size="' + esc(sizeStr) + '" data-tags="' + esc(cleanVer) + '" onclick="requestTelegramStreamFromBtn(this)">' + (isRar ? '📦 RAR senden' : ('▶ Stream · ' + esc(f.quality || '1080p') + (subsList.length > 0 ? ' + UT' : ''))) + '</button>' +
                        (subsList.length > 0 ? '<button type="button" class="btn-tool-quiet" style="padding:4px 8px;font-size:11px" data-fid="' + esc(f.telegram_file_id) + '" data-title="' + esc(d.title + (epCode ? (' ' + epCode) : '')) + '" data-sid="' + (type === 's' ? Number(d.id) : '') + '" data-sn="' + sNum + '" data-en="' + eNum + '" onclick="requestTelegramSubtitleOnlyFromBtn(this)" title="Nur Untertitel einzeln senden">💬 UT (' + subsList.length + ')</button>' : '') +
                        (isAdminUser && f.raw_filename ? '<span style="font-size:10.5px;color:#94a3b8;font-family:monospace;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(f.raw_filename) + '">📄 ' + esc(f.raw_filename) + '</span>' : '') +
                      '</div>' +
                      '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                        (isAdminUser ? '<button type="button" class="ep-ghost-btn admin-remap-btn" data-type="' + esc(type) + '" data-tmdb-id="' + Number(d.id) + '" data-sn="' + sNum + '" data-en="' + eNum + '" data-epname="' + esc(epTitleStr) + '" data-fid="' + esc(f.telegram_file_id) + '" data-ver="' + esc(cleanVer) + '" data-qual="' + esc(f.quality || '1080p') + '" data-raw="' + esc(f.raw_filename || '') + '" data-msg="' + esc(f.message_link || '') + '" onclick="openEpisodeCorrectionFromBtn(this)" title="' + esc((epCode || 'Datei') + ' (' + epTitleStr + ') korrigieren / zuordnen') + '">✏️ ' + (epCode ? esc(epCode) + ' ' : '') + 'zuordnen</button>' : '') +
                        (canReportMedia ? '<button type="button" class="ep-ghost-btn" data-type="' + esc(type) + '" data-tmdb-id="' + Number(d.id) + '" data-sn="' + sNum + '" data-en="' + eNum + '" data-epname="' + esc(epTitleStr) + '" data-fid="' + esc(f.telegram_file_id) + '" data-ver="' + esc(cleanVer) + '" onclick="openMediaReportFromBtn(this)" title="Fehler melden">⚠️</button>' : '') +
                      '</div>' +
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
        const remapBox = document.getElementById("modalRemapMediaBox");
        if (remapBox) remapBox.style.display = "none";
        const moreBox = document.getElementById("modalMoreActionsBox");
        if (moreBox) moreBox.style.display = "none";
        box.style.display = "block";
        setTimeout(() => { try { box.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_e) {} }, 40);
        box.innerHTML = '<div style="font-size:12px;color:#cbd5e1">⏳ Lade verfügbare Cover von TMDb (Original EN / DE / Textless), Apple iTunes DE & OMDb...</div>';
        try {
          const title = state.activeDetails?.title || "";
          const year = state.activeDetails?.year || "";
          const r = await apiFetchJson(API_BASE + "/admin/posters?type=" + encodeURIComponent(typeCode) + "&id=" + encodeURIComponent(mediaId) + "&title=" + encodeURIComponent(title) + "&year=" + encodeURIComponent(year));
          const posters = Array.isArray(r?.posters) ? r.posters : [];
          box.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
              '<div style="font-size:13px;font-weight:800;color:#e9d5ff">🖼️ Cover / Poster auswählen (' + posters.length + ' gefunden)</div>' +
              '<button type="button" class="btn close-slate" style="padding:2px 8px;font-size:11px" onclick="document.getElementById(\\'modalPosterPickerBox\\').style.display=\\'none\\'">✖ Schließen</button>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
              '<input id="customPosterUrlInp" class="tma-input" placeholder="Eigene Bild-URL (https://...jpg/png) oder TMDb /path.jpg" style="flex:1;min-width:210px;padding:6px 9px;border-color:rgba(168,85,247,0.4);font-size:12px" />' +
              '<button type="button" class="btn purple" onclick="applyCustomModalPoster(\\'' + escJs(typeCode) + '\\',' + Number(mediaId) + ')">💾 URL als Cover speichern</button>' +
            '</div>' +
            (posters.length > 0 ? (
              '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:10px;max-height:360px;overflow-y:auto;padding:4px">' +
                posters.map(p =>
                  '<div style="display:flex;flex-direction:column;gap:4px;background:rgba(255,255,255,0.04);padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);cursor:pointer" onclick="selectModalPosterOption(\\'' + escJs(typeCode) + '\\',' + Number(mediaId) + ',\\'' + escJs(p.poster_path || '') + '\\',\\'' + escJs(p.external_poster_url || p.url || '') + '\\')">' +
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

      let modalRemapSelectedFileIndex = -1; // -1 = Alle Dateien des Titels, >= 0 = Einzelne Datei/Folge

      function selectModalRemapSourceFileClient(fileIdx, typeCode, mediaId) {
        const d = state.activeDetails || {};
        const allFiles = Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 0
          ? d.allStreamFiles
          : (Array.isArray(d.files) ? d.files : []);
        modalRemapSelectedFileIndex = Number(fileIdx);
        const box = document.getElementById("modalRemapMediaBox");
        if (box) {
          box.style.display = "none";
          toggleModalRemapBox(typeCode, mediaId, true);
        }
        if (fileIdx >= 0 && allFiles[fileIdx]) {
          const f = allFiles[fileIdx];
          const sInp = document.getElementById("modalRemapSeasonInp");
          const eInp = document.getElementById("modalRemapEpisodeInp");
          if (sInp) sInp.value = String(Number(f.season_number ?? 1));
          if (eInp) eInp.value = String(Number(f.episode_number ?? 1));
        }
      }

      async function toggleModalRemapBox(typeCode, mediaId, keepFileSelection = false) {
        const box = document.getElementById("modalRemapMediaBox");
        if (!box) return;
        if (box.style.display === "block") {
          box.style.display = "none";
          return;
        }
        const posterBox = document.getElementById("modalPosterPickerBox");
        if (posterBox) posterBox.style.display = "none";
        const moreBox = document.getElementById("modalMoreActionsBox");
        if (moreBox) moreBox.style.display = "none";
        box.style.display = "block";
        setTimeout(() => { try { box.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_e) {} }, 40);
        const d = state.activeDetails || {};
        const allFiles = (Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 0
          ? d.allStreamFiles
          : (Array.isArray(d.files) ? d.files : [])).slice().sort((a, b) => {
            const sa = Number(a.season_number ?? 1);
            const sb = Number(b.season_number ?? 1);
            if (sa !== sb) return sa - sb;
            return Number(a.episode_number ?? 1) - Number(b.episode_number ?? 1);
          });
        if (!keepFileSelection) {
          modalRemapSelectedFileIndex = (typeCode === "s" && allFiles.length > 1) ? 0 : -1;
        }
        const activeFile = (modalRemapSelectedFileIndex >= 0 && allFiles[modalRemapSelectedFileIndex])
          ? allFiles[modalRemapSelectedFileIndex]
          : (allFiles[0] || {});
        const activeS = Number(activeFile.season_number ?? 1);
        const activeE = Number(activeFile.episode_number ?? 1);
        const activeEpCode = typeCode === "s" ? ("S" + String(activeS).padStart(2, "0") + "E" + String(activeE).padStart(2, "0")) : "🎬 Film";
        const activeEpTitle = typeCode === "s" ? resolveClientEpisodeTitle(d.id, activeS, activeE, activeFile) : (d.title || "Spielfilm");
        const origFilename = activeFile.raw_filename || d.rawFilename || d.title || "";
        const origSeedQuery = d.title || (origFilename
          ? origFilename.replace(/\\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i, "").replace(/[._]+/g, " ")
          : "");

        const activeSourceBannerHtml =
          '<div class="ep-remap-compare-grid" style="margin-bottom:10px">' +
            '<div class="ep-remap-card">' +
              '<div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:0.4px">📍 Aktuell ausgewählt (Vorher)</div>' +
              '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                '<span class="ep-code-badge">' + (modalRemapSelectedFileIndex === -1 ? ('📦 Alle ' + allFiles.length + ' Dateien') : esc(activeEpCode)) + '</span>' +
                '<div class="inline-marquee-wrap" data-marquee-always="1"><span class="inline-marquee-text" style="font-size:12.5px">' + esc(modalRemapSelectedFileIndex === -1 ? (d.title + ' (Kompletter Titel)') : activeEpTitle) + '</span></div>' +
                (activeFile.quality ? formatQualityBadgeHtmlClient(activeFile.quality, activeFile.codec) : '') +
              '</div>' +
              (origFilename ? '<div style="font-family:monospace;font-size:10.5px;color:#cbd5e1;word-break:break-all">📄 ' + esc(origFilename) + '</div>' : '') +
            '</div>' +
            '<div class="ep-remap-compare-arrow">➔</div>' +
            '<div class="ep-remap-card target">' +
              '<div style="font-size:10px;font-weight:800;color:#38bdf8;text-transform:uppercase;letter-spacing:0.4px">🎯 Neues Ziel (Nachher)</div>' +
              '<div id="modalRemapTargetPreviewText" style="font-size:12px;font-weight:800;color:var(--text)">' +
                (modalRemapSelectedFileIndex === -1
                  ? 'Kompletten Titel / alle Folgen neu verknüpfen'
                  : ('Nur ' + esc(activeEpCode) + ' (' + esc(activeEpTitle) + ') neu zuordnen')) +
              '</div>' +
              '<div style="font-size:11px;color:var(--muted)">Wähle unten eine Datei/Folge und klicke beim gewünschten TMDb-Treffer auf <b>✓ Jetzt zuordnen</b>.</div>' +
            '</div>' +
          '</div>';

        const filesMetaHtml = allFiles.length > 0 ? (
          '<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(15,23,42,0.65);border:1px solid rgba(148,163,184,0.22);font-size:11.5px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
              '<span style="font-weight:800;color:#7dd3fc">📂 1. Welche Folge / Datei soll neu zugeordnet werden? (' + allFiles.length + ' vorhanden)</span>' +
              (allFiles.length > 1 ? (
                '<button type="button" class="season-tab-btn ' + (modalRemapSelectedFileIndex === -1 ? 'active' : '') + '" style="padding:3px 9px;font-size:11px" onclick="selectModalRemapSourceFileClient(-1,\\'' + escJs(typeCode) + '\\',' + Number(mediaId) + ')">📦 Alle ' + allFiles.length + ' Dateien gemeinsam</button>'
              ) : '') +
            '</div>' +
            '<div style="display:flex;flex-direction:column;gap:5px;max-height:165px;overflow-y:auto;padding-right:2px">' +
              allFiles.map((f, fIdx) => {
                const isSelected = modalRemapSelectedFileIndex === fIdx;
                const fn = f.raw_filename || f.telegram_file_id || "Unbekannte Datei";
                const mLink = f.message_link || "";
                const sNum = Number(f.season_number ?? 1);
                const eNum = Number(f.episode_number ?? 1);
                const epCodeStr = typeCode === "s" ? ("S" + String(sNum).padStart(2, "0") + "E" + String(eNum).padStart(2, "0")) : "🎬 Film";
                const epNameStr = typeCode === "s" ? resolveClientEpisodeTitle(d.id, sNum, eNum, f) : (d.title || "Film");
                return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 8px;border-radius:7px;background:' + (isSelected ? 'rgba(14,165,233,0.18)' : 'rgba(2,6,23,0.45)') + ';border:1px solid ' + (isSelected ? 'rgba(56,189,248,0.65)' : 'rgba(148,163,184,0.14)') + ';cursor:pointer" onclick="selectModalRemapSourceFileClient(' + fIdx + ',\\'' + escJs(typeCode) + '\\',' + Number(mediaId) + ')">' +
                  '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;min-width:0">' +
                    '<span class="ep-code-badge">' + esc(epCodeStr) + '</span>' +
                    '<b style="color:var(--text);font-size:11.5px">' + esc(epNameStr) + '</b>' +
                    formatQualityBadgeHtmlClient(f.quality || "1080p", f.codec) +
                    '<code style="font-size:10.5px;color:#94a3b8;word-break:break-all">📄 ' + esc(fn) + '</code>' +
                  '</div>' +
                  '<div style="display:flex;gap:5px;align-items:center" onclick="event.stopPropagation()">' +
                    '<button type="button" class="season-tab-btn ' + (isSelected ? 'active' : '') + '" style="padding:2px 8px;font-size:10.5px" onclick="selectModalRemapSourceFileClient(' + fIdx + ',\\'' + escJs(typeCode) + '\\',' + Number(mediaId) + ')">' + (isSelected ? '✓ Ausgewählt' : 'Auswählen') + '</button>' +
                    '<button type="button" class="btn-tool-quiet" style="padding:2px 7px;font-size:10.5px" onclick="openEpisodeCorrectionModal({typeCode:\\'' + escJs(typeCode) + '\\',tmdbId:' + Number(mediaId) + ',title:\\'' + escJs(d.title || '') + '\\',season:' + sNum + ',episode:' + eNum + ',episodeTitle:\\'' + escJs(epNameStr) + '\\',telegramFileId:\\'' + escJs(f.telegram_file_id || '') + '\\',versionLabel:\\'' + escJs(f.versionLabel || f.version_label || 'Originalfassung') + '\\',quality:\\'' + escJs(f.quality || '1080p') + '\\',rawFilename:\\'' + escJs(fn) + '\\',messageLink:\\'' + escJs(mLink) + '\\'})">✏️ Detail-Korrektur</button>' +
                    (mLink ? '<a class="btn-tool-quiet" style="padding:2px 7px;font-size:10.5px" href="' + esc(safeHttpUrl(mLink)) + '" target="_blank" rel="noopener noreferrer">🔗 Post</a>' : '') +
                  '</div>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>'
        ) : '';

        box.innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
            '<div style="font-size:13px;font-weight:800;color:#38bdf8">🔄 Folge oder Titel neu zuordnen</div>' +
            '<button type="button" class="btn close-slate" style="padding:2px 8px;font-size:11px" onclick="document.getElementById(\\'modalRemapMediaBox\\').style.display=\\'none\\'">✖ Schließen</button>' +
          '</div>' +
          activeSourceBannerHtml +
          filesMetaHtml +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            '<input id="modalRemapSearchInp" class="tma-input" value="' + esc(origSeedQuery) + '" placeholder="Suchbegriff oder TMDb-ID (z.B. Zur See, Pippi Langstrumpf, tmdb:40964)..." style="flex:1;min-width:190px;padding:6px 9px;font-size:12px" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();searchModalRemapCandidates(\\'' + escJs(typeCode) + '\\',' + Number(mediaId) + ');}" />' +
            '<select id="modalRemapTypeSel" class="tma-select" style="padding:6px 8px;font-size:12px">' +
              '<option value="">Alle (Film & Serie)</option>' +
              '<option value="m">🎬 Nur Filme</option>' +
              '<option value="s">📺 Nur Serien / Anime</option>' +
            '</select>' +
            '<span style="font-size:11px;color:var(--muted);font-weight:700">Ziel-Staffel / Folge:</span>' +
            '<input id="modalRemapSeasonInp" class="tma-input" type="number" min="1" max="99" value="' + activeS + '" title="Ziel-Staffel" style="width:52px;padding:5px;font-size:12px;font-weight:800;text-align:center" />' +
            '<input id="modalRemapEpisodeInp" class="tma-input" type="number" min="1" max="999" value="' + activeE + '" title="Ziel-Folge" style="width:58px;padding:5px;font-size:12px;font-weight:800;text-align:center" />' +
            '<button type="button" class="btn blue" onclick="searchModalRemapCandidates(\\'' + escJs(typeCode) + '\\',' + Number(mediaId) + ')">🔎 Suchen (8 APIs)</button>' +
          '</div>' +
          '<div id="modalRemapResultsBox" style="display:flex;flex-direction:column;gap:6px"></div>';

        if (typeof window.refreshModalAndEpisodeMarquees === "function") {
          setTimeout(() => window.refreshModalAndEpisodeMarquees(box), 40);
        }
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
          if (firstInferredEp && modalRemapSelectedFileIndex === -1) {
            const sInp = document.getElementById("modalRemapSeasonInp");
            const eInp = document.getElementById("modalRemapEpisodeInp");
            if (sInp && firstInferredEp.inferredSeason) sInp.value = String(firstInferredEp.inferredSeason);
            if (eInp && firstInferredEp.inferredEpisode) eInp.value = String(firstInferredEp.inferredEpisode);
          }
          const d = state.activeDetails || {};
          const allFiles = (Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 0
            ? d.allStreamFiles
            : (Array.isArray(d.files) ? d.files : [])).slice().sort((a, b) => {
              const sa = Number(a.season_number ?? 1);
              const sb = Number(b.season_number ?? 1);
              if (sa !== sb) return sa - sb;
              return Number(a.episode_number ?? 1) - Number(b.episode_number ?? 1);
            });
          const selFile = (modalRemapSelectedFileIndex >= 0 && allFiles[modalRemapSelectedFileIndex]) ? allFiles[modalRemapSelectedFileIndex] : null;
          const btnTargetBadge = selFile
            ? ('S' + String(selFile.season_number ?? 1).padStart(2, '0') + 'E' + String(selFile.episode_number ?? 1).padStart(2, '0') + ' zuordnen')
            : 'Alle zuordnen';

          resBox.innerHTML = cands.map(c => {
            const epHint = c.inferredEpisode
              ? (' • <span style="color:#fde047;font-weight:800">Erkannt: S' + String(c.inferredSeason || 1).padStart(2, '0') + 'E' + String(c.inferredEpisode).padStart(2, '0') + (c.inferredEpisodeTitle ? (' (' + esc(c.inferredEpisodeTitle) + ')') : '') + '</span>')
              : '';

            return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:rgba(15,23,42,0.68);border:1px solid rgba(148,163,184,0.2)">' +
              '<div style="display:flex;gap:8px;align-items:center;min-width:0;flex:1">' +
                (c.poster ? '<img src="' + esc(c.poster) + '" style="width:32px;height:48px;object-fit:cover;border-radius:4px;flex-shrink:0" />' : '') +
                '<div style="font-size:12px;min-width:0;flex:1">' +
                  '<b>' + esc(c.title) + '</b> (' + esc(c.year || 'k.A.') + ') ' +
                  '<span class="f-pill neutral" style="font-size:10px;padding:1px 5px">' + (c.typeCode === 's' ? '📺 Serie' : '🎬 Film') + ' • ' + esc(c.source || 'TMDb') + ' #' + c.tmdbId + '</span>' +
                  epHint +
                '</div>' +
              '</div>' +
              '<button type="button" class="btn green" style="padding:5px 10px;font-size:11px;flex-shrink:0" onclick="executeModalRemapMedia(\\'' + escJs(oldTypeCode) + '\\',' + Number(oldMediaId) + ',\\'' + escJs(c.typeCode) + '\\',' + Number(c.tmdbId) + ',' + Number(c.inferredSeason || 0) + ',' + Number(c.inferredEpisode || 0) + ')">✓ ' + esc(btnTargetBadge) + '</button>' +
            '</div>';
          }).join("");
        } catch (e) {
          resBox.innerHTML = '<div style="font-size:11.5px;color:#f87171">⚠️ Suche fehlgeschlagen.</div>';
        }
      }

      async function executeModalRemapMedia(oldTypeCode, oldTmdbId, newTypeCode, newTmdbId, inferredSeason = 0, inferredEpisode = 0) {
        const sVal = Number(document.getElementById("modalRemapSeasonInp")?.value || inferredSeason || 1);
        const eVal = Number(document.getElementById("modalRemapEpisodeInp")?.value || inferredEpisode || 1);
        const d = state.activeDetails || {};
        const allFiles = (Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 0
          ? d.allStreamFiles
          : (Array.isArray(d.files) ? d.files : [])).slice().sort((a, b) => {
            const sa = Number(a.season_number ?? 1);
            const sb = Number(b.season_number ?? 1);
            if (sa !== sb) return sa - sb;
            return Number(a.episode_number ?? 1) - Number(b.episode_number ?? 1);
          });
        const selFile = (modalRemapSelectedFileIndex >= 0 && allFiles[modalRemapSelectedFileIndex]) ? allFiles[modalRemapSelectedFileIndex] : null;

        setBusyState(true, "🔄 Ordne " + (selFile ? ("S" + String(selFile.season_number ?? 1).padStart(2, "0") + "E" + String(selFile.episode_number ?? 1).padStart(2, "0")) : "Dateien & Streams") + " dem neuen Titel zu...");
        try {
          let r = null;
          if (selFile && allFiles.length > 1) {
            r = await apiFetchJson(API_BASE + "/admin/reassign-episode", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "relink_tmdb",
                scope: "single_episode",
                oldTypeCode,
                oldTmdbId: Number(oldTmdbId),
                seriesId: Number(oldTmdbId),
                oldSeason: Number(selFile.season_number ?? 1),
                oldEpisode: Number(selFile.episode_number ?? 1),
                telegramFileId: String(selFile.telegram_file_id || ""),
                newTypeCode,
                newTmdbId: Number(newTmdbId),
                newSeason: sVal,
                newEpisode: eVal
              })
            });
          } else {
            r = await apiFetchJson(API_BASE + "/admin/remap-saved-media", {
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
          }
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Neuzuordnung fehlgeschlagen."));
            return;
          }
          clearClientMediaCaches();
          showHudToast("✅ Erfolgreich neu zugeordnet" + (selFile ? (" (S" + String(sVal).padStart(2, "0") + "E" + String(eVal).padStart(2, "0") + ")") : "") + "!");
          await openDetails(newTypeCode, newTmdbId, false);
          if (state.mode === "admin") {
            loadAdminPanelView();
          } else {
            loadDiscover(state.type, state.genreId, state.mode, state.sort, false, false, state.page || 1);
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
          topicRoutingMode: "off", // 'off' | 'by_type' | 'per_series'
          topicMap: {},
          sourceBridgeChatId: "",
          customBotToken: "",
          customBotUsername: "",
          afterSendAction: "open_minimize", // 'open_minimize' | 'open_close' | 'stay'
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
        // Server-side topicMap ist autoritativ (wird bei Auto-Erstellung im Worker aktualisiert)
        if (fromServer.topicMap && typeof fromServer.topicMap === "object" && Object.keys(fromServer.topicMap).length > 0) {
          merged.topicMap = fromServer.topicMap;
        } else if (!merged.topicMap || typeof merged.topicMap !== "object") {
          merged.topicMap = {};
        }
        const tMode = String(merged.topicRoutingMode || "off").trim().toLowerCase();
        merged.topicRoutingMode = (tMode === "by_type" || tMode === "per_series" || tMode === "off") ? tMode : "off";
        const act = String(merged.afterSendAction || "open_minimize").trim();
        merged.afterSendAction = (act === "open_minimize" || act === "open_close" || act === "stay") ? act : "open_minimize";
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
        const topicMode = prefs.topicRoutingMode || "off";
        const topicBadgeShort = topicMode === "per_series"
          ? " · 🗂️ Pro Serie"
          : (topicMode === "by_type" ? " · 🗂️ Filme/Serien" : "");
        return '<div id="modalDeliveryTargetMount" class="delivery-inline-wrap">' +
          '<div class="delivery-inline-pills" title="Aktives Versandziel: ' + activeModeSummary + '">' +
            '<span class="delivery-inline-label">📤 Senden an:</span>' +
            '<button type="button" class="delivery-pill-btn ' + (mode === 'dm' ? 'active' : '') + '" onclick="switchModalDeliveryModeClient(\\'dm\\')" title="An privaten Bot-Chat senden">💬 Bot-Chat</button>' +
            '<button type="button" class="delivery-pill-btn ' + (mode === 'group' ? 'active' : '') + '" onclick="switchModalDeliveryModeClient(\\'group\\')" title="In eigene Telegram-Gruppe senden">👥 Gruppe</button>' +
            '<button type="button" class="delivery-pill-btn ' + (mode === 'custom_bot' ? 'active' : '') + '" onclick="switchModalDeliveryModeClient(\\'custom_bot\\')" title="Über eigenen Bot senden">🤖 Eigener Bot</button>' +
            '<button type="button" class="delivery-pill-btn ' + (showConfigInputs ? 'active' : '') + '" onclick="toggleModalDeliveryConfigBoxClient()" title="Themen-Routing, Gruppen-ID & Bot-Token ein-/ausklappen">⚙️' + esc(topicBadgeShort) + (showConfigInputs ? ' ▴' : '') + '</button>' +
          '</div>' +
          (showConfigInputs ? (
            '<div class="delivery-config-drawer">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">' +
                '<span style="font-size:11px;font-weight:800;color:#7dd3fc">⚙️ Ziel- &amp; Themen-Konfiguration (wird automatisch gespeichert)</span>' +
                '<button type="button" class="btn close-slate" style="padding:2px 8px;font-size:10.5px" onclick="toggleModalDeliveryConfigBoxClient()">✓ Einklappen</button>' +
              '</div>' +
              '<div style="margin-bottom:8px;padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                '<span style="font-size:10.5px;color:var(--muted);font-weight:700">🗂️ Auto-Themen:</span>' +
                '<button type="button" class="delivery-pill-btn ' + (topicMode === 'off' ? 'active' : '') + '" onclick="switchTopicRoutingModeClient(\\'off\\')" title="Keine automatischen Themen (Hauptchat oder manuelle Topic-ID)">⚪ Aus</button>' +
                '<button type="button" class="delivery-pill-btn ' + (topicMode === 'by_type' ? 'active' : '') + '" onclick="switchTopicRoutingModeClient(\\'by_type\\')" title="Legt automatisch 🎬 Filme & 📺 Serien als Themen an">🎬/📺 Typ</button>' +
                '<button type="button" class="delivery-pill-btn ' + (topicMode === 'per_series' ? 'active' : '') + '" onclick="switchTopicRoutingModeClient(\\'per_series\\')" title="Filme in 🎬 Filme, jede Serie bekommt automatisch ihr eigenes Thema">📺 Pro Serie</button>' +
              '</div>' +
              '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px">' +
                '<div>' +
                  '<div style="font-size:10.5px;color:var(--muted);margin-bottom:3px">👥 Ziel-Gruppen Chat-ID (<code>/id</code>):</div>' +
                  '<input id="modalDelivGroupIdInp" class="tma-input" value="' + esc(prefs.targetGroupChatId || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="z.B. -1001987654321" style="width:100%;padding:5px 8px;font-size:11.5px" />' +
                '</div>' +
                '<div>' +
                  '<div style="font-size:10.5px;color:var(--muted);margin-bottom:3px">🧵 Manuelle Topic-ID (Override):</div>' +
                  '<input id="modalDelivTopicIdInp" class="tma-input" value="' + esc(prefs.targetTopicId || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="Leer = Auto-Themen" style="width:100%;padding:5px 8px;font-size:11.5px" />' +
                '</div>' +
                '<div>' +
                  '<div style="font-size:10.5px;color:var(--muted);margin-bottom:3px">📦 Quellgruppen-ID (optional):</div>' +
                  '<input id="modalDelivSourceGroupInp" class="tma-input" value="' + esc(prefs.sourceBridgeChatId || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="Auto (-100...) oder leer lassen" style="width:100%;padding:5px 8px;font-size:11.5px" />' +
                '</div>' +
                '<div>' +
                  '<div style="font-size:10.5px;color:var(--muted);margin-bottom:3px">🤖 Eigenes Bot-Token (optional):</div>' +
                  '<div style="display:flex;gap:4px;align-items:center">' +
                    '<input id="modalDelivBotTokenInp" class="tma-input" type="password" value="' + esc(prefs.customBotToken || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="123456:ABC-DEF..." style="width:100%;padding:5px 8px;font-size:11.5px" />' +
                    '<button type="button" class="btn" style="padding:4px 7px;font-size:11px" onclick="togglePasswordVisibilityClient(\\'modalDelivBotTokenInp\\',this)" title="Bot-Token ein-/ausblenden">👁️</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              ((typeof isRealTelegramMiniAppClient === "function" && isRealTelegramMiniAppClient()) ? (
                '<div style="margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                  '<span style="font-size:10.5px;color:var(--muted);font-weight:700">📲 Nach dem Senden:</span>' +
                  '<button type="button" class="delivery-pill-btn ' + (prefs.afterSendAction === 'open_minimize' ? 'active' : '') + '" onclick="switchAfterSendActionClient(\\'open_minimize\\')" title="Öffnet die gesendete Nachricht/den Chat und minimiert die Mini-App">💬 Öffnen &amp; Minimieren</button>' +
                  '<button type="button" class="delivery-pill-btn ' + (prefs.afterSendAction === 'open_close' ? 'active' : '') + '" onclick="switchAfterSendActionClient(\\'open_close\\')" title="Öffnet den Chat und schließt die Mini-App vollständig">✖️ Schließen</button>' +
                  '<button type="button" class="delivery-pill-btn ' + (prefs.afterSendAction === 'stay' ? 'active' : '') + '" onclick="switchAfterSendActionClient(\\'stay\\')" title="In der Mini-App bleiben (mit Button zum Öffnen im Hinweis)">📌 In App bleiben</button>' +
                '</div>'
              ) : '') +
            '</div>'
          ) : '') +
        '</div>';
      }

      function syncDynamicDeliveryButtonLabelsClient() {
        const lbl = getActiveDeliveryButtonLabelClient();
        document.querySelectorAll('[data-dynamic-delivery-btn="1"]').forEach(btn => {
          const hasUt = btn.getAttribute("data-has-ut") === "1";
          btn.textContent = "▶ " + lbl + (hasUt ? " + UT" : "");
        });
      }

      function switchModalDeliveryModeClient(nextMode) {
        const prefs = saveDeliveryPreferencesClient({ targetMode: nextMode || "dm" });
        if ((nextMode === "group" && !prefs.targetGroupChatId) || (nextMode === "custom_bot" && !prefs.customBotToken)) {
          modalDeliveryConfigExpanded = true;
        } else if (nextMode === "dm") {
          modalDeliveryConfigExpanded = false;
        }
        const mount = document.getElementById("modalDeliveryTargetMount");
        if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
        syncDynamicDeliveryButtonLabelsClient();
      }

      function toggleModalDeliveryConfigBoxClient() {
        modalDeliveryConfigExpanded = !modalDeliveryConfigExpanded;
        const mount = document.getElementById("modalDeliveryTargetMount");
        if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
      }

      function switchAfterSendActionClient(nextAction) {
        const clean = (nextAction === "open_minimize" || nextAction === "open_close" || nextAction === "stay")
          ? nextAction
          : "open_minimize";
        saveDeliveryPreferencesClient({ afterSendAction: clean }, true);
        const mount = document.getElementById("modalDeliveryTargetMount");
        if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
        const labelMap = {
          open_minimize: "💬 Nach dem Senden: Nachricht öffnen & Mini-App minimieren",
          open_close: "✖️ Nach dem Senden: Nachricht öffnen & Mini-App schließen",
          stay: "📌 Nach dem Senden: In Mini-App bleiben (mit Öffnen-Button)"
        };
        showHudToast(labelMap[clean]);
      }

      function switchTopicRoutingModeClient(nextMode, reloadSettings = false) {
        const clean = (nextMode === "by_type" || nextMode === "per_series" || nextMode === "off") ? nextMode : "off";
        saveDeliveryPreferencesClient({ topicRoutingMode: clean }, true);
        const mount = document.getElementById("modalDeliveryTargetMount");
        if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
        if (reloadSettings && typeof loadSettingsView === "function") loadSettingsView();
        const labelMap = {
          off: "⚪ Auto-Themen aus (Hauptchat / manuelle Topic-ID)",
          by_type: "🗂️ Auto-Themen aktiv: 🎬 Filme & 📺 Serien",
          per_series: "🗂️ Auto-Themen aktiv: 🎬 Filme & eigenes Thema pro Serie"
        };
        showHudToast(labelMap[clean]);
      }

      function resetDeliveryTopicMapClient(reloadSettings = false) {
        const next = { ...getDeliveryPreferencesClient(), topicMap: {}, resetTopicMap: true };
        try {
          const toStore = { ...next };
          delete toStore.resetTopicMap;
          localStorage.setItem("tma_delivery_prefs_v1", JSON.stringify(toStore));
        } catch (e) {}
        if (!state.settings) state.settings = {};
        state.settings.deliveryConfig = { ...next, resetTopicMap: undefined };
        apiFetchJson(API_BASE + "/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, action: "save_delivery_config", deliveryConfig: next })
        }).then(() => {
          if (reloadSettings && typeof loadSettingsView === "function") loadSettingsView();
        }).catch(() => {});
        showHudToast("🔄 Themen-Zuordnung zurückgesetzt");
      }

      function formatResolvedTopicToastSuffixClient(resObj) {
        if (!resObj || !resObj.resolvedTopicId) return "";
        const tName = String(resObj.resolvedTopicName || ("Topic #" + resObj.resolvedTopicId)).trim();
        return " · 🗂️ " + tName + (resObj.topicAutoCreated ? " (neu)" : "");
      }

      function openSentTelegramMessageClient(openUrl, opts = {}) {
        let safeUrl = (typeof safeHttpUrl === "function") ? safeHttpUrl(openUrl) : ( /^https?:\\/\\//i.test(String(openUrl || "").trim()) ? String(openUrl).trim() : "" );
        const mode = String(opts.afterSendAction || "open_minimize");
        const targetMode = String(opts.targetMode || "dm");
        let isDirectLink = Boolean(opts.isDirectMessageLink);
        const fallbackBotUser = String(opts.botUsername || "").replace(/^@/, "").trim();
        const isInsideTg = Boolean(tg && (tg.initData || (tg.platform && tg.platform !== "unknown")));
        const launchedChatType = String(tg?.initDataUnsafe?.chat_type || "").toLowerCase();

        // Schutz gegen Versehen (Saved Messages): Im DM-Modus niemals auf den eigenen Telegram-Usernamen springen!
        const ownUsername = String(tg?.initDataUnsafe?.user?.username || "").replace(/^@/, "").trim().toLowerCase();
        if (targetMode !== "group" && safeUrl && ownUsername) {
          const selfMatch = safeUrl.match(/^https?:\\/\\/t\\.me\\/([A-Za-z0-9_]+)(?:\\/.*)?$/i);
          if (selfMatch && selfMatch[1].toLowerCase() === ownUsername) {
            safeUrl = (fallbackBotUser && fallbackBotUser.toLowerCase() !== ownUsername)
              ? ("https://t.me/" + fallbackBotUser)
              : "";
            isDirectLink = false;
          }
        }

        const isOwnBotDmContext = targetMode === "dm" && !isDirectLink && (!launchedChatType || launchedChatType === "sender");

        if (isInsideTg) {
          if (mode === "open_close") {
            if (!isOwnBotDmContext && safeUrl && typeof tg.openTelegramLink === "function") {
              try { tg.openTelegramLink(safeUrl); } catch (_e) {}
              if (typeof tg.close === "function") {
                setTimeout(() => { try { tg.close(); } catch (_e) {} }, 220);
              }
              return true;
            }
            if (typeof tg.close === "function") {
              try { tg.close(); return true; } catch (_e) {}
            }
          }
          // Standard "open_minimize": openTelegramLink springt direkt zur Nachricht/zum Chat und minimiert die Mini-App nativ in Telegram
          if (safeUrl && typeof tg.openTelegramLink === "function") {
            try { tg.openTelegramLink(safeUrl); return true; } catch (_e) {}
          }
          if (typeof tg.close === "function") {
            try { tg.close(); return true; } catch (_e) {}
          }
          return false;
        }
        if (safeUrl) {
          return openExternalUrlSafe(safeUrl);
        }
        return false;
      }

      function handleAfterTelegramSendClient(streamRes, toastText, extra = {}) {
        const prefs = getDeliveryPreferencesClient();
        const afterSendAction = prefs.afterSendAction || "open_minimize";
        const isInsideTg = Boolean(tg && (tg.initData || (tg.platform && tg.platform !== "unknown")));
        try {
          if (tg && tg.HapticFeedback && typeof tg.HapticFeedback.notificationOccurred === "function") {
            tg.HapticFeedback.notificationOccurred("success");
          }
        } catch (_e) {}

        const resolvedBotUser = String(streamRes?.botUsername || (prefs.targetMode === "custom_bot" ? prefs.customBotUsername : "") || "").replace(/^@/, "").trim();
        let openUrl = String(streamRes?.openMessageUrl || "").trim();
        if (!openUrl && resolvedBotUser) {
          openUrl = "https://t.me/" + resolvedBotUser;
        }
        const safeUrl = (typeof safeHttpUrl === "function") ? safeHttpUrl(openUrl) : ( /^https?:\\/\\//i.test(openUrl) ? openUrl : "" );
        const isDirectMessageLink = Boolean(streamRes?.isDirectMessageLink);
        const actionLabel = isDirectMessageLink ? "💬 Nachricht öffnen" : "💬 Chat öffnen";
        const canJumpToChat = Boolean(safeUrl || isInsideTg);
        const willAutoTrigger = Boolean(
          !extra.skipAutoAction &&
          !streamRes?.queued &&
          isInsideTg &&
          (afterSendAction === "open_minimize" || afterSendAction === "open_close")
        );

        const finalToastMsg = willAutoTrigger
          ? (toastText + (afterSendAction === "open_close" ? " — schließe Mini-App..." : " — öffne Chat..."))
          : toastText;

        showHudToast(
          finalToastMsg,
          canJumpToChat
            ? {
                actionLabel,
                durationMs: willAutoTrigger ? 3000 : 6000,
                onAction: () => openSentTelegramMessageClient(safeUrl, {
                  afterSendAction: afterSendAction === "stay" ? "open_minimize" : afterSendAction,
                  targetMode: prefs.targetMode || "dm",
                  isDirectMessageLink,
                  botUsername: resolvedBotUser
                })
              }
            : null
        );

        if (willAutoTrigger) {
          setTimeout(() => {
            openSentTelegramMessageClient(safeUrl, {
              afterSendAction,
              targetMode: prefs.targetMode || "dm",
              isDirectMessageLink,
              botUsername: resolvedBotUser
            });
          }, 450);
        }
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
        syncDynamicDeliveryButtonLabelsClient();
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
          const r = await apiFetchJson(API_BASE + "/activity-log");
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
          if (typeof backupImportJob !== "undefined" && backupImportJob && backupImportJob.running) {
            return;
          }
          if (!state.isAuthenticated || (!state.authUser?.isVip && !state.authUser?.isAdmin)) {
            if (clientAntiSpamPollTimer) {
              clearTimeout(clientAntiSpamPollTimer);
              clientAntiSpamPollTimer = null;
            }
            return;
          }
          const prefs = getDeliveryPreferencesClient();
          const targetChat = prefs.targetMode === "group" && prefs.targetGroupChatId ? prefs.targetGroupChatId : chatId;
          const r = await apiFetchJson(
            API_BASE + "/anti-spam-queue?chatId=" + encodeURIComponent(targetChat || "") + "&drain=" + (autoDrain ? "1" : "0")
          );
          if (r && (r._httpStatus === 401 || r._httpStatus === 403 || r._authError)) {
            if (clientAntiSpamPollTimer) {
              clearTimeout(clientAntiSpamPollTimer);
              clientAntiSpamPollTimer = null;
            }
            return;
          }
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
                Number(r.snapshot.gauges.singleChatPacing?.cooldownMs || 0) > 0
              ));
            if (hasActiveWork) {
              scheduleAntiSpamPollClient(1600);
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

      function requestTelegramStreamFromBtn(btn) {
        if (!btn) return;
        const fid = String(btn.getAttribute("data-fid") || "").trim();
        const title = String(btn.getAttribute("data-title") || state.activeDetails?.title || "Stream").trim();
        const qual = String(btn.getAttribute("data-qual") || "1080p").trim();
        const sid = btn.getAttribute("data-sid") ? Number(btn.getAttribute("data-sid")) : (state.activeDetails?.id || undefined);
        const season = btn.getAttribute("data-sn") !== null && btn.getAttribute("data-sn") !== "" ? Number(btn.getAttribute("data-sn")) : undefined;
        const episode = btn.getAttribute("data-en") !== null && btn.getAttribute("data-en") !== "" ? Number(btn.getAttribute("data-en")) : undefined;
        const epName = String(btn.getAttribute("data-epname") || "").trim();
        const fileSize = String(btn.getAttribute("data-size") || "").trim();
        const tags = String(btn.getAttribute("data-tags") || "").trim();
        requestTelegramStream(fid, title, qual, { seriesId: sid, season, episode, epName, fileSize, tags });
      }

      function requestTelegramSubtitleOnlyFromBtn(btn) {
        if (!btn) return;
        const fid = String(btn.getAttribute("data-fid") || "").trim();
        const title = String(btn.getAttribute("data-title") || state.activeDetails?.title || "Untertitel").trim();
        const sid = btn.getAttribute("data-sid") ? Number(btn.getAttribute("data-sid")) : (state.activeDetails?.id || undefined);
        const season = btn.getAttribute("data-sn") !== null && btn.getAttribute("data-sn") !== "" ? Number(btn.getAttribute("data-sn")) : undefined;
        const episode = btn.getAttribute("data-en") !== null && btn.getAttribute("data-en") !== "" ? Number(btn.getAttribute("data-en")) : undefined;
        requestTelegramSubtitleOnly(fid, title, { seriesId: sid, season, episode });
      }

      function openEpisodeCorrectionFromBtn(btn) {
        if (!btn) return;
        openEpisodeCorrectionModal({
          typeCode: btn.getAttribute("data-type") || (state.activeDetails?.typeCode || "m"),
          tmdbId: Number(btn.getAttribute("data-tmdb-id") || state.activeDetails?.id || 0),
          title: state.activeDetails?.title || "",
          season: btn.getAttribute("data-sn") !== null && btn.getAttribute("data-sn") !== "" ? Number(btn.getAttribute("data-sn")) : undefined,
          episode: btn.getAttribute("data-en") !== null && btn.getAttribute("data-en") !== "" ? Number(btn.getAttribute("data-en")) : undefined,
          episodeTitle: btn.getAttribute("data-epname") || "",
          telegramFileId: btn.getAttribute("data-fid") || "",
          versionLabel: btn.getAttribute("data-ver") || "Originalfassung",
          quality: btn.getAttribute("data-qual") || "1080p",
          rawFilename: btn.getAttribute("data-raw") || "",
          messageLink: btn.getAttribute("data-msg") || ""
        });
      }

      function openMediaReportFromBtn(btn) {
        if (!btn) return;
        openMediaReportModal({
          typeCode: btn.getAttribute("data-type") || (state.activeDetails?.typeCode || "m"),
          tmdbId: Number(btn.getAttribute("data-tmdb-id") || state.activeDetails?.id || 0),
          title: state.activeDetails?.title || "",
          season: btn.getAttribute("data-sn") !== null && btn.getAttribute("data-sn") !== "" ? Number(btn.getAttribute("data-sn")) : null,
          episode: btn.getAttribute("data-en") !== null && btn.getAttribute("data-en") !== "" ? Number(btn.getAttribute("data-en")) : null,
          episodeTitle: btn.getAttribute("data-epname") || "",
          telegramFileId: btn.getAttribute("data-fid") || "",
          versionLabel: btn.getAttribute("data-ver") || ""
        });
      }

      async function requestTelegramSubtitleOnly(fileId, cleanTitle, extraMeta = null) {
        return requestTelegramStream(fileId, cleanTitle, "Untertitel", { ...(extraMeta || {}), subtitleOnly: true });
      }

      function validateDeliveryTargetBeforeSendClient(prefs) {
        if (!prefs || typeof prefs !== "object") return true;
        if (prefs.targetMode === "group" && !prefs.targetGroupChatId) {
          modalDeliveryConfigExpanded = true;
          const mount = document.getElementById("modalDeliveryTargetMount");
          if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
          showHudToast("👥 Bitte gib oben deine Ziel-Gruppen Chat-ID ein (Tipp: /id in deiner Gruppe senden).");
          return false;
        }
        if (prefs.targetMode === "custom_bot" && !prefs.customBotToken) {
          modalDeliveryConfigExpanded = true;
          const mount = document.getElementById("modalDeliveryTargetMount");
          if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
          showHudToast("🤖 Bitte trage oben dein eigenes Bot-Token ein (oder wechsle auf Bot-Chat).");
          return false;
        }
        return true;
      }

      async function requestTelegramStream(fileId, cleanTitle, quality, extraMeta = null) {
        if (!isCurrentUserVip()) {
          showHudToast("🔒 Streams & Qualitäten sind exklusiv für VIP-Mitglieder verfügbar.");
          return;
        }
        const prefs = getDeliveryPreferencesClient();
        if (!validateDeliveryTargetBeforeSendClient(prefs)) return;
        const metaObj = extraMeta && typeof extraMeta === "object" ? extraMeta : {};
        const isSubtitleOnly = Boolean(metaObj.subtitleOnly);
        if (!isSubtitleOnly && metaObj.seriesId && metaObj.season !== undefined && metaObj.season !== null && metaObj.episode) {
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
              topicRoutingMode: prefs.topicRoutingMode || "off",
              seriesTitle: (state.activeDetails?.typeCode === "s" || metaObj.seriesId) ? String(state.activeDetails?.title || "").trim() : "",
              sourceBridgeChatId: prefs.sourceBridgeChatId || "",
              customBotToken: prefs.customBotToken || "",
              customBotUsername: prefs.customBotUsername || "",
              typeCode: state.activeDetails?.typeCode || (metaObj.seriesId ? "s" : "m"),
              tmdbId: metaObj.seriesId || state.activeDetails?.id || null,
              posterUrl: state.activeDetails?.poster || state.activeDetails?.poster_path || "",
              backdropUrl: state.activeDetails?.backdrop || state.activeDetails?.backdrop_path || "",
              season: (metaObj.season !== undefined && metaObj.season !== null && metaObj.season !== "") ? Number(metaObj.season) : null,
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
            const topicNote = formatResolvedTopicToastSuffixClient(r);
            if (r.queued && r.job) {
              const etaSec = Math.max(1, Math.ceil((Number(r.job.waitMs) || 1150) / 1000));
              handleAfterTelegramSendClient(
                r,
                "⏳ Anti-Spam Schutz: „" + cleanTitle + "“ auf Warteschleifen-Pos. #" + (r.job.position || 1) + " (Zustellung in ~" + etaSec + "s)" + topicNote,
                { skipAutoAction: true }
              );
            } else if (isSubtitleOnly) {
              handleAfterTelegramSendClient(
                r,
                "💬 " + Number(r.subtitlesSentCount || 1) + " Untertitel-Datei(en) für „" + cleanTitle + "“ an " + destLabel + " gesendet" + topicNote + "!"
              );
            } else {
              const copyNote = r.copiedFromSourceGroup ? " (Auto-Copy)" : "";
              const coverNote = r.coverEmbedded ? " + 🖼️ Cover" : "";
              const subNote = Number(r.subtitlesSentCount || 0) > 0 ? (" + 💬 " + r.subtitlesSentCount + " UT") : "";
              handleAfterTelegramSendClient(
                r,
                "✅ „" + cleanTitle + "“ (" + quality + sizeSuffix + ") an " + destLabel + " gesendet" + copyNote + coverNote + subNote + topicNote + "!"
              );
            }
            if (!isSubtitleOnly && metaObj.seriesId && metaObj.season !== undefined && metaObj.season !== null && metaObj.season !== "") {
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
        if (/^(?:RAR|ZIP|7Z|ISO|TAR|GZ)/i.test(pStr)) return pStr.toUpperCase();
        const m = pStr.match(/^(?:SPLIT|PART|TEIL|CD|DISC|DISK|DVD)[\\s._-]*0*([1-9]\\d?)$/i);
        if (m) return "CD " + parseInt(m[1], 10);
        if (!pStr && rawFilename) {
          const fnStr = String(rawFilename).trim();
          const fnArchPart = fnStr.match(/\\.part0*([1-9]\\d?)\\.rar$/i);
          if (fnArchPart) return "RAR-PART" + parseInt(fnArchPart[1], 10);
          const fn7zSplit = fnStr.match(/\\.(7z|zip|rar)\\.0*([1-9]\\d{0,2})$/i);
          if (fn7zSplit) return fn7zSplit[1].toUpperCase() + "-PART" + parseInt(fn7zSplit[2], 10);
          const fnR00 = fnStr.match(/\\.r0*(\\d{1,2})$/i);
          if (fnR00) return "RAR-PART" + (parseInt(fnR00[1], 10) + 2);
          const fnZ01 = fnStr.match(/\\.z0*([1-9]\\d?)$/i);
          if (fnZ01) return "ZIP-PART" + parseInt(fnZ01[1], 10);
          const fnSplit = fnStr.match(/-00([1-9])(?:\\.(?:mp4|mkv|avi|m4v|mk3d|flv|ts|mov|wmv))+$/i);
          if (fnSplit) return "CD " + parseInt(fnSplit[1], 10);
        }
        return pStr;
      }

      function extractClientPartNumber(partStr) {
        if (!partStr) return 0;
        const m = String(partStr).match(/(\\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      }

      function cleanUserVisibleStreamTagsClient(rawTags = "") {
        if (!rawTags) return "";
        return String(rawTags)
          .split(/\\s*[·•|]\\s*/)
          .map(t => t.trim())
          .filter(t => t && !/^(?:SPLIT|PART|TEIL|CD|DISC|DISK|DVD)[\\s._-]*0*\\d+$/i.test(t) && !/^Originalfassung$/i.test(t))
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(" · ");
      }

      function buildArchiveDownloadsSectionHtml(d, isAdminUser) {
        const rawList = Array.isArray(d?.downloads) ? d.downloads.filter(dl => dl && (dl.telegram_file_id || dl.file_id)) : [];
        const deduped = rawList.filter((dl, idx, arr) => {
          const fid = String(dl.telegram_file_id || dl.file_id || "");
          return fid && arr.findIndex(x => String(x.telegram_file_id || x.file_id || "") === fid) === idx;
        });
        if (deduped.length === 0) {
          window._activeModalArchiveDownloads = [];
          return "";
        }
        const rawDownloads = deduped.slice().sort((a, b) => {
          const sDiff = Number(a.season_number || 0) - Number(b.season_number || 0);
          if (sDiff !== 0) return sDiff;
          const eDiff = Number(a.episode_number || 0) - Number(b.episode_number || 0);
          if (eDiff !== 0) return eDiff;
          const pA = Number(a.part_number || extractClientPartNumber(normalizeClientPartLabel(a.part, a.file_name || a.raw_filename || "")) || 1);
          const pB = Number(b.part_number || extractClientPartNumber(normalizeClientPartLabel(b.part, b.file_name || b.raw_filename || "")) || 1);
          return pA - pB;
        });
        window._activeModalArchiveDownloads = rawDownloads;
        const totalBytes = rawDownloads.reduce((acc, dl) => acc + (Number(dl.file_size) || 0), 0);
        const totalSizeStr = formatFileSizeClient(totalBytes);
        const batchBtnHtml = rawDownloads.length >= 2
          ? ('<button type="button" class="btn-action-glass" style="padding:4px 10px;font-size:11.5px;border-color:rgba(245,158,11,0.45);color:#fde68a" onclick="sendAllArchiveDownloadsToTelegram()" title="Alle ' + rawDownloads.length + ' Archiv-Teile geordnet nacheinander an dein gewähltes Ziel senden">' +
              '📦 Alle ' + rawDownloads.length + ' Archiv-Teile senden' +
            '</button>')
          : '';
        return '<div style="margin-top:12px;font-variant-numeric:tabular-nums">' +
          '<div class="season-toolbar-row" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<div style="font-size:12.5px;font-weight:800;color:#fde68a">📦 Zusatz-Downloads & Archive (' + rawDownloads.length + (totalSizeStr ? ' · Gesamt ' + esc(totalSizeStr) : '') + ')</div>' +
            batchBtnHtml +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px">' +
            rawDownloads.map((dl, idx) => {
              const fid = dl.telegram_file_id || dl.file_id || "";
              const sizeLabel = formatFileSizeClient(dl.file_size);
              const fnLabel = dl.file_name || dl.raw_filename || "Archiv-Download";
              const codecLabel = dl.codec || (/\\.(?:zip|z\\d{2}|zip\\.\\d{3})$/i.test(fnLabel) ? "ZIP" : /\\.7z(?:\\.\\d{3})?$/i.test(fnLabel) ? "7Z" : /\\.iso$/i.test(fnLabel) ? "ISO" : /\\.(?:tar|gz)$/i.test(fnLabel) ? "TAR" : "RAR");
              const partLabel = normalizeClientPartLabel(dl.part, fnLabel);
              const partNum = Number(dl.part_number || extractClientPartNumber(partLabel) || 0);
              const hasSeEp = Number.isFinite(Number(dl.season_number)) && Number.isFinite(Number(dl.episode_number)) && Number(dl.episode_number) > 0;
              const seEpCode = hasSeEp ? ('S' + String(dl.season_number).padStart(2, '0') + 'E' + String(dl.episode_number).padStart(2, '0')) : '';
              const btnCaption = (rawDownloads.length > 1 && partNum > 0)
                ? ('📦 Teil ' + partNum + ' senden')
                : (rawDownloads.length > 1 ? ('📦 Teil ' + (idx + 1) + ' senden') : '📦 Archiv-Download senden');
              const streamTitle = (d?.title || 'Download') + (seEpCode ? (' ' + seEpCode) : '') + (partLabel ? (' (' + partLabel + ')') : '');
              return '<div class="ep-row" style="margin-bottom:0;border-color:rgba(245,158,11,0.4);background:rgba(245,158,11,0.06)">' +
                '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
                  '<span class="ep-code-badge" style="background:rgba(245,158,11,0.2);color:#fde68a;border-color:rgba(245,158,11,0.45)">📦 ' + esc(codecLabel) + '</span>' +
                  (seEpCode ? '<span class="ep-code-badge">' + esc(seEpCode) + '</span>' : '') +
                  '<span class="ep-name-text">' + esc(fnLabel) + (partLabel ? ' · ' + esc(partLabel) : '') + '</span>' +
                  (sizeLabel ? '<span class="stream-meta-pill size" title="Dateigröße">' + esc(sizeLabel) + '</span>' : '') +
                '</div>' +
                '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                  '<button class="btn-stream-clean prerelease" data-fid="' + esc(fid) + '" data-title="' + esc(streamTitle) + '" data-qual="' + esc(codecLabel) + '" data-size="' + esc(sizeLabel) + '" data-tags="📦 Archiv-Download" onclick="requestTelegramStreamFromBtn(this)">' + esc(btnCaption) + '</button>' +
                '</div>' +
              '</div>';
            }).join("") +
          '</div>' +
        '</div>';
      }

      async function sendStreamBatchClient(itemsPayload, prefs, batchLabel = "Batch-Versand") {
        if (!Array.isArray(itemsPayload) || itemsPayload.length === 0) {
          return { ok: false, sentCount: 0, queuedCount: 0, failedCount: 0, batchApiCalls: 0, lastSentRes: null, deliveredIndices: [] };
        }
        let sentCount = 0;
        let queuedCount = 0;
        let failedCount = 0;
        let batchApiCalls = 0;
        let lastSentRes = null;
        let methodUsed = "";
        const deliveredIndices = [];
        const CHUNK_SIZE = 100;
        for (let offset = 0; offset < itemsPayload.length; offset += CHUNK_SIZE) {
          const chunk = itemsPayload.slice(offset, offset + CHUNK_SIZE);
          const totalChunks = Math.ceil(itemsPayload.length / CHUNK_SIZE);
          const chunkNum = Math.floor(offset / CHUNK_SIZE) + 1;
          setBusyState(true, "⚡ Batch-Versand (" + chunk.length + " Dateien" + (totalChunks > 1 ? (" · Paket " + chunkNum + "/" + totalChunks) : "") + "): " + batchLabel + "...");
          const r = await apiFetchJson(API_BASE + "/stream-batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              batchLabel,
              items: chunk,
              typeCode: state.activeDetails?.typeCode || chunk[0]?.typeCode || "",
              tmdbId: state.activeDetails?.id || chunk[0]?.tmdbId || null,
              seriesTitle: (state.activeDetails?.typeCode === "s" || chunk[0]?.typeCode === "s") ? String(state.activeDetails?.title || "").trim() : "",
              targetMode: prefs.targetMode || "dm",
              targetGroupChatId: prefs.targetGroupChatId || "",
              targetTopicId: prefs.targetTopicId || "",
              topicRoutingMode: prefs.topicRoutingMode || "off",
              sourceBridgeChatId: prefs.sourceBridgeChatId || "",
              customBotToken: prefs.customBotToken || "",
              customBotUsername: prefs.customBotUsername || ""
            })
          });
          if (r && r.antiSpam) {
            clientAntiSpamSnapshot = r.antiSpam;
            renderAntiSpamLiveHudBannerClient(r.antiSpam);
          }
          if (r && r.ok) {
            sentCount += Number(r.sentCount || 0);
            queuedCount += Number(r.queuedCount || 0);
            failedCount += Number(r.failedCount || 0);
            batchApiCalls += Number(r.batchApiCalls || 0);
            if (r.method) methodUsed = String(r.method);
            if (!lastSentRes || r.openMessageUrl) lastSentRes = r;
            if (Array.isArray(r.deliveredIndices)) {
              for (const localIdx of r.deliveredIndices) {
                deliveredIndices.push(offset + Number(localIdx));
              }
            }
          } else {
            return { ok: false, fallbackNeeded: Boolean(r && r._httpStatus === 404), error: r?.error || "Batch-Versand fehlgeschlagen", sentCount, queuedCount, failedCount, batchApiCalls, lastSentRes, deliveredIndices, methodUsed };
          }
        }
        return { ok: sentCount + queuedCount > 0, sentCount, queuedCount, failedCount, batchApiCalls, lastSentRes, deliveredIndices, methodUsed };
      }

      async function sendAllArchiveDownloadsToTelegram() {
        if (!isCurrentUserVip()) {
          showHudToast("🔒 Exklusiv für VIP-Mitglieder verfügbar.");
          return;
        }
        const d = state.activeDetails || {};
        const rawList = (Array.isArray(window._activeModalArchiveDownloads) && window._activeModalArchiveDownloads.length > 0)
          ? window._activeModalArchiveDownloads
          : (Array.isArray(d.downloads) ? d.downloads : []);
        const targetList = rawList.filter(dl => dl && (dl.telegram_file_id || dl.file_id));
        if (targetList.length === 0) {
          showHudToast("⚠️ Keine Archiv-Downloads zum Senden gefunden.");
          return;
        }
        const prefs = getDeliveryPreferencesClient();
        if (!validateDeliveryTargetBeforeSendClient(prefs)) return;
        const isSeriesModal = Array.isArray(d.seasons) && d.seasons.length > 0;
        const batchItems = targetList.map((dl, i) => {
          const fid = dl.telegram_file_id || dl.file_id || "";
          const fnLabel = dl.file_name || dl.raw_filename || "Archiv-Download";
          const codecLabel = dl.codec || (/\\.(?:zip|z\\d{2}|zip\\.\\d{3})$/i.test(fnLabel) ? "ZIP" : /\\.7z(?:\\.\\d{3})?$/i.test(fnLabel) ? "7Z" : "RAR");
          const partLabel = normalizeClientPartLabel(dl.part, fnLabel) || ("Teil " + (i + 1));
          const hasSeEp = Number.isFinite(Number(dl.season_number)) && Number.isFinite(Number(dl.episode_number)) && Number(dl.episode_number) > 0;
          const seEpCode = hasSeEp ? (' S' + String(dl.season_number).padStart(2, '0') + 'E' + String(dl.episode_number).padStart(2, '0')) : '';
          return {
            fileId: fid,
            title: (d.title || "Archiv") + seEpCode + " (" + partLabel + ")",
            quality: codecLabel,
            fileSize: formatFileSizeClient(dl.file_size),
            tags: "📦 Archiv-Download",
            typeCode: isSeriesModal ? "s" : "m",
            tmdbId: d.id || null,
            posterUrl: d.poster || d.poster_path || "",
            backdropUrl: d.backdrop || d.backdrop_path || ""
          };
        });
        let sentCount = 0;
        let queuedCount = 0;
        let lastSentRes = null;
        let usedCopyMessages = false;
        if (batchItems.length >= 2) {
          try {
            const bRes = await sendStreamBatchClient(batchItems, prefs, (d.title || "Archiv") + " (" + batchItems.length + " Teile)");
            if (bRes && bRes.ok) {
              sentCount = bRes.sentCount;
              queuedCount = bRes.queuedCount;
              lastSentRes = bRes.lastSentRes;
              usedCopyMessages = Boolean(bRes.batchApiCalls > 0);
            }
          } catch (e) {}
        }
        if (sentCount + queuedCount === 0) {
          for (let i = 0; i < batchItems.length; i++) {
            const item = batchItems[i];
            setBusyState(true, "📦 Sende Archiv " + (i + 1) + "/" + batchItems.length + ": " + item.title + "...");
            try {
              const r = await apiFetchJson(API_BASE + "/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chatId,
                  ...item,
                  targetMode: prefs.targetMode || "dm",
                  targetGroupChatId: prefs.targetGroupChatId || "",
                  targetTopicId: prefs.targetTopicId || "",
                  sourceBridgeChatId: prefs.sourceBridgeChatId || "",
                  customBotToken: prefs.customBotToken || "",
                  customBotUsername: prefs.customBotUsername || ""
                })
              });
              if (r && r.antiSpam) {
                clientAntiSpamSnapshot = r.antiSpam;
                renderAntiSpamLiveHudBannerClient(r.antiSpam);
              }
              if (r && r.ok) {
                if (!lastSentRes || (!r.queued && r.openMessageUrl)) lastSentRes = r;
                if (r.queued) queuedCount++;
                else sentCount++;
              }
            } catch (e) {}
          }
        }
        setBusyState(false);
        scheduleAntiSpamPollClient(950);
        if (sentCount + queuedCount > 0) {
          const batchBadge = usedCopyMessages ? " ⚡ Batch-API" : "";
          const msg = queuedCount > 0
            ? ("⏳ " + sentCount + " sofort gesendet, " + queuedCount + " Archiv-Teil(e) in Warteschleife!" + batchBadge)
            : ("✅ Alle " + sentCount + "/" + targetList.length + " Archiv-Teile gesendet!" + batchBadge);
          handleAfterTelegramSendClient(lastSentRes, msg, { skipAutoAction: sentCount === 0 });
        } else {
          showHudToast("⚠️ Archiv-Teile konnten nicht gesendet werden.");
        }
      }

      function buildMovieStreamsReleaseSectionHtml(d, isAdminUser, canReportMedia) {
        const allRawFiles = Array.isArray(d.files) ? d.files.filter(f => f && f.telegram_file_id) : [];
        const isClientArchRow = (f) => Boolean(f.is_download_only || f.isArchive || f.type === "archive" || /\\.(?:rar|zip|7z|iso|tar|gz|r\\d{2}|z\\d{2})$|\\.(?:7z|zip|rar)\\.\\d{3}$/i.test(String(f.raw_filename || f.file_name || "")));
        const rawFiles = allRawFiles.filter(f => !isClientArchRow(f));
        const inlineArchiveFiles = allRawFiles.filter(f => isClientArchRow(f));
        const combinedDownloads = [
          ...(Array.isArray(d.downloads) ? d.downloads : []),
          ...inlineArchiveFiles
        ].filter((dl, idx, arr) => {
          const fid = String(dl?.telegram_file_id || dl?.file_id || "");
          if (!fid) return false;
          return arr.findIndex(x => String(x?.telegram_file_id || x?.file_id || "") === fid) === idx;
        });

        const normalizedFiles = rawFiles.map(f => {
          const isRarFile = String(f.codec || "").toUpperCase() === "RAR" || /^RAR/i.test(String(f.part || "")) || /\\.rar$/i.test(String(f.raw_filename || ""));
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
        const archiveSectionHtml = combinedDownloads.length > 0
          ? buildArchiveDownloadsSectionHtml({ ...d, downloads: combinedDownloads }, isAdminUser)
          : "";

        if (totalReleaseCount === 0) {
          return '<div>' +
            archiveSectionHtml +
          '</div>';
        }

        return '<div>' +
          '<div class="season-toolbar-row">' +
            '<div style="font-size:12.5px;font-weight:800;color:var(--text)">🎬 Verfügbare Releases (' + totalReleaseCount + (rawFiles.length > totalReleaseCount ? ' · ' + rawFiles.length + ' Dateien' : '') + ')</div>' +
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
                      '<button type="button" class="btn-action-glass" style="padding:4px 10px;font-size:11.5px;border-color:rgba(245,158,11,0.45);color:#fde68a" onclick="sendAllMoviePartsToTelegram(\\'' + escJs(blk.key) + '\\')" title="Alle ' + parts.length + ' ' + partWord + ' geordnet von 1 bis ' + parts.length + ' an dein gewähltes Ziel senden">' +
                        '📦 Alle ' + parts.length + ' ' + partWord + ' senden' +
                      '</button>' +
                      (canReportMedia ? '<button type="button" class="ep-ghost-btn" data-type="m" data-tmdb-id="' + Number(d.id) + '" data-fid="' + esc(first.telegram_file_id) + '" data-ver="' + esc(tagsLabel || 'Originalfassung') + '" onclick="openMediaReportFromBtn(this)" title="Fehler zu diesem Mehrteiler-Release melden">⚠️</button>' : '') +
                    '</div>' +
                  '</div>' +
                  '<div class="release-cd-grid">' +
                    parts.map(p => {
                      const pSize = formatFileSizeClient(p.file_size);
                      const pLabel = p._normPart || ("CD " + p._partNum);
                      const pSubs = Array.isArray(p.subtitles) ? p.subtitles : [];
                      return '<div class="cd-part-chip-wrap">' +
                        '<button type="button" class="btn-cd-part" data-fid="' + esc(p.telegram_file_id) + '" data-title="' + esc(d.title + ' (' + pLabel + ')') + '" data-qual="' + esc(p.quality || '1080p') + '" data-size="' + esc(pSize) + '" data-tags="' + esc(tagsLabel) + '" onclick="requestTelegramStreamFromBtn(this)" title="' + esc(d.title + ' – ' + pLabel + (pSize ? ' (' + pSize + ')' : '')) + ' senden">' +
                          '<span>▶ ' + esc(pLabel) + '</span>' +
                          (pSize ? '<span class="cd-size-sub">· ' + esc(pSize) + '</span>' : '') +
                          (pSubs.length > 0 ? '<span class="cd-size-sub">+ UT</span>' : '') +
                        '</button>' +
                        (isAdminUser ? '<button type="button" class="ep-ghost-btn" style="width:24px;height:24px;font-size:11px" data-type="m" data-tmdb-id="' + Number(d.id) + '" data-epname="' + esc(pLabel) + '" data-fid="' + esc(p.telegram_file_id) + '" data-ver="' + esc(tagsLabel || 'Originalfassung') + '" data-qual="' + esc(p.quality || '1080p') + '" data-raw="' + esc(p.raw_filename || '') + '" data-msg="' + esc(p.message_link || '') + '" onclick="openEpisodeCorrectionFromBtn(this)" title="' + esc(pLabel) + ' bearbeiten / Details & Quellgruppe prüfen">✏️</button>' : '') +
                      '</div>';
                    }).join("") +
                  '</div>' +
                '</div>';
              }

              const f = blk.file;
              const sizeLabel = formatFileSizeClient(f.file_size);
              const isRarFile = f._isRar;
              const tagsLabel = f._cleanTags;
              const isPrereleaseTag = tagsLabel.includes("Vorabversion") || /\\b(?:HDTS|TeleSync|HDCAM|MicDub|LineDub|Screener|DVDScr)\\b/i.test(tagsLabel);
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
                  '<button class="btn-stream-clean ' + (isRarFile || isPrereleaseTag ? 'prerelease' : '') + '" ' + (isRarFile ? '' : ('data-dynamic-delivery-btn="1" data-has-ut="' + (subsList.length > 0 ? '1' : '0') + '"')) + ' data-fid="' + esc(f.telegram_file_id) + '" data-title="' + esc(d.title + (partLabel ? ' (' + partLabel + ')' : '')) + '" data-qual="' + esc(f.quality || '1080p') + '" data-size="' + esc(sizeLabel) + '" data-tags="' + esc(tagsLabel) + '" onclick="requestTelegramStreamFromBtn(this)">' + (isRarFile ? '📦 RAR senden' : ('▶ ' + esc(getActiveDeliveryButtonLabelClient()) + (subsList.length > 0 ? ' + UT' : ''))) + '</button>' +
                  (subsList.length > 0 ? '<button type="button" class="btn-tool-quiet" style="padding:4px 8px;font-size:11px" data-fid="' + esc(f.telegram_file_id) + '" data-title="' + esc(d.title) + '" onclick="requestTelegramSubtitleOnlyFromBtn(this)" title="Nur die verknüpfte(n) Untertitel-Datei(en) einzeln senden">💬 UT (' + subsList.length + ')</button>' : '') +
                  (isAdminUser ? '<button type="button" class="ep-ghost-btn" data-type="m" data-tmdb-id="' + Number(d.id) + '" data-fid="' + esc(f.telegram_file_id) + '" data-ver="' + esc(tagsLabel || 'Originalfassung') + '" data-qual="' + esc(f.quality || '1080p') + '" data-raw="' + esc(f.raw_filename || '') + '" data-msg="' + esc(f.message_link || '') + '" onclick="openEpisodeCorrectionFromBtn(this)" title="Datei-Version ändern, Quellgruppe prüfen oder mit anderem TMDb-Titel verknüpfen">✏️</button>' : '') +
                  (canReportMedia ? '<button type="button" class="ep-ghost-btn" data-type="m" data-tmdb-id="' + Number(d.id) + '" data-fid="' + esc(f.telegram_file_id) + '" data-ver="' + esc(tagsLabel || 'Originalfassung') + '" onclick="openMediaReportFromBtn(this)" title="Fehler zu dieser Datei melden">⚠️</button>' : '') +
                '</div>' +
              '</div>';
            }).join("") +
          '</div>' +
          archiveSectionHtml +
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
        if (!validateDeliveryTargetBeforeSendClient(prefs)) return;
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

        const batchItems = targetList.map((f, i) => {
          const cleanPartStr = f._normPart || normalizeClientPartLabel(f.part, f.raw_filename || "") || ("CD " + (i + 1));
          return {
            fileId: f.telegram_file_id,
            title: d.title + " (" + cleanPartStr + ")",
            quality: f.quality || "1080p",
            fileSize: formatFileSizeClient(f.file_size),
            tags: cleanUserVisibleStreamTagsClient(f.tags || ""),
            typeCode: "m",
            tmdbId: d.id || null,
            posterUrl: d.poster || d.poster_path || "",
            backdropUrl: d.backdrop || d.backdrop_path || ""
          };
        });

        let sentCount = 0;
        let queuedCount = 0;
        let lastSentRes = null;
        let usedCopyMessages = false;
        if (batchItems.length >= 2) {
          try {
            const bRes = await sendStreamBatchClient(batchItems, prefs, d.title + " (" + batchItems.length + " Teile)");
            if (bRes && bRes.ok) {
              sentCount = bRes.sentCount;
              queuedCount = bRes.queuedCount;
              lastSentRes = bRes.lastSentRes;
              usedCopyMessages = Boolean(bRes.batchApiCalls > 0);
            }
          } catch (e) {}
        }
        if (sentCount + queuedCount === 0) {
          for (let i = 0; i < batchItems.length; i++) {
            const item = batchItems[i];
            setBusyState(true, "📦 Sende Teil " + (i + 1) + "/" + batchItems.length + ": " + item.title + "...");
            try {
              const r = await apiFetchJson(API_BASE + "/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chatId,
                  ...item,
                  targetMode: prefs.targetMode || "dm",
                  targetGroupChatId: prefs.targetGroupChatId || "",
                  targetTopicId: prefs.targetTopicId || "",
                  sourceBridgeChatId: prefs.sourceBridgeChatId || "",
                  customBotToken: prefs.customBotToken || "",
                  customBotUsername: prefs.customBotUsername || ""
                })
              });
              if (r && r.antiSpam) {
                clientAntiSpamSnapshot = r.antiSpam;
                renderAntiSpamLiveHudBannerClient(r.antiSpam);
              }
              if (r && r.ok) {
                if (!lastSentRes || (!r.queued && r.openMessageUrl)) lastSentRes = r;
                if (r.queued) queuedCount++;
                else sentCount++;
              }
            } catch (e) {}
          }
        }
        setBusyState(false);
        scheduleAntiSpamPollClient(950);
        if (sentCount + queuedCount > 0) {
          const batchBadge = usedCopyMessages ? " ⚡ Batch-API" : "";
          const msg = queuedCount > 0
            ? ("⏳ " + sentCount + " sofort gesendet, " + queuedCount + " CD(s) in Warteschleife!" + batchBadge)
            : ("✅ Alle " + sentCount + "/" + targetList.length + " CDs gesendet!" + batchBadge);
          handleAfterTelegramSendClient(lastSentRes, msg, { skipAutoAction: sentCount === 0 });
        } else {
          showHudToast("⚠️ Teile konnten nicht gesendet werden.");
        }
      }

      // Optimierung #14: Ganze Staffel für VIPs nacheinander an das gewählte Ziel senden
      let activeSeasonCacheEpisodes = [];
      const selectedEpisodeVersionMap = {};
      const selectedSeasonPreferredProfileMap = {}; // pro seriesId_seasonNum: 'auto' oder spezifisches Profil

      function selectEpisodeVersion(seriesId, seasonNum, epNumber, versionIdx) {
        const key = seriesId + "_" + seasonNum + "_" + epNumber;
        selectedEpisodeVersionMap[key] = Number(versionIdx) || 0;
        loadSeason(seriesId, seasonNum, false, false);
      }

      function selectSeasonPreferredProfileClient(seriesId, seasonNum, profileKey) {
        const sKey = seriesId + "_" + seasonNum;
        selectedSeasonPreferredProfileMap[sKey] = String(profileKey || "auto");
        Object.keys(selectedEpisodeVersionMap).forEach(k => {
          if (k.startsWith(sKey + "_")) delete selectedEpisodeVersionMap[k];
        });
        loadSeason(seriesId, seasonNum, false, false);
      }

      async function sendWholeSeasonToTelegram(seriesId, seasonNum) {
        if (!isCurrentUserVip()) {
          showHudToast("🔒 Exklusiv für VIP-Mitglieder verfügbar.");
          return;
        }
        const prefs = getDeliveryPreferencesClient();
        if (!validateDeliveryTargetBeforeSendClient(prefs)) return;
        const episodesWithStreams = (activeSeasonCacheEpisodes || []).filter(ep => Array.isArray(ep.files) && ep.files.length > 0);
        if (episodesWithStreams.length === 0) {
          showHudToast("⚠️ Keine Episoden-Streams in dieser Staffel hinterlegt.");
          return;
        }
        const seriesTitle = state.activeDetails?.title || "Serie";
        const sSummaryPrefix = Number(seasonNum) === 0 ? "Specials" : ("Staffel " + seasonNum);
        const batchEntries = [];
        for (let i = 0; i < episodesWithStreams.length; i++) {
          const ep = episodesWithStreams[i];
          const bestFile = ep._resolvedActiveFile || (Array.isArray(ep.versions) && ep.versions[0]) || (Array.isArray(ep.files) && ep.files[0]);
          const targetFileId = bestFile?.telegram_file_id || bestFile?.file_id;
          if (!bestFile || !targetFileId) continue;
          const epCode = "S" + String(seasonNum).padStart(2, "0") + "E" + String(ep.episode_number).padStart(2, "0");
          batchEntries.push({
            ep,
            payload: {
              fileId: targetFileId,
              title: seriesTitle + " " + epCode + " - " + (ep.name || ("Folge " + ep.episode_number)),
              quality: bestFile.quality || "1080p",
              fileSize: formatFileSizeClient(bestFile.file_size),
              tags: bestFile.versionLabel || bestFile.tags || "",
              typeCode: "s",
              tmdbId: seriesId || state.activeDetails?.id || null,
              posterUrl: state.activeDetails?.poster || state.activeDetails?.poster_path || "",
              backdropUrl: ep.still || ep.still_path || state.activeDetails?.backdrop || state.activeDetails?.backdrop_path || "",
              season: (seasonNum !== undefined && seasonNum !== null && seasonNum !== "") ? Number(seasonNum) : null,
              episode: ep.episode_number || null
            }
          });
        }
        let sentCount = 0;
        let queuedCount = 0;
        let lastSentRes = null;
        let usedCopyMessages = false;
        if (batchEntries.length >= 2) {
          try {
            const bRes = await sendStreamBatchClient(
              batchEntries.map(x => x.payload),
              prefs,
              seriesTitle + " · " + sSummaryPrefix + " (" + batchEntries.length + " Folgen)"
            );
            if (bRes && bRes.ok) {
              sentCount = bRes.sentCount;
              queuedCount = bRes.queuedCount;
              lastSentRes = bRes.lastSentRes;
              usedCopyMessages = Boolean(bRes.batchApiCalls > 0);
              for (const idx of (bRes.deliveredIndices || [])) {
                const deliveredEp = batchEntries[idx]?.ep;
                if (deliveredEp) setSeriesProgress(seriesId, seasonNum, deliveredEp.episode_number, deliveredEp.name || "");
              }
            }
          } catch (e) {}
        }
        if (sentCount + queuedCount === 0) {
          for (let i = 0; i < batchEntries.length; i++) {
            const { ep, payload } = batchEntries[i];
            const epCode = "S" + String(seasonNum).padStart(2, "0") + "E" + String(ep.episode_number).padStart(2, "0");
            setBusyState(true, "📦 " + sSummaryPrefix + " (" + (i + 1) + "/" + batchEntries.length + "): " + epCode + "...");
            try {
              const r = await apiFetchJson(API_BASE + "/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chatId,
                  ...payload,
                  targetMode: prefs.targetMode || "dm",
                  targetGroupChatId: prefs.targetGroupChatId || "",
                  targetTopicId: prefs.targetTopicId || "",
                  topicRoutingMode: prefs.topicRoutingMode || "off",
                  seriesTitle: seriesTitle || "",
                  sourceBridgeChatId: prefs.sourceBridgeChatId || "",
                  customBotToken: prefs.customBotToken || "",
                  customBotUsername: prefs.customBotUsername || ""
                })
              });
              if (r && r.antiSpam) {
                clientAntiSpamSnapshot = r.antiSpam;
                renderAntiSpamLiveHudBannerClient(r.antiSpam);
              }
              if (r && r.ok) {
                if (!lastSentRes || (!r.queued && r.openMessageUrl)) lastSentRes = r;
                if (r.queued) queuedCount++;
                else sentCount++;
                setSeriesProgress(seriesId, seasonNum, ep.episode_number, ep.name || "");
              }
            } catch (e) {}
          }
        }
        setBusyState(false);
        scheduleAntiSpamPollClient(950);
        if (sentCount + queuedCount > 0) {
          const batchBadge = usedCopyMessages ? " ⚡ Batch-API" : "";
          const topicBadge = formatResolvedTopicToastSuffixClient(lastSentRes);
          const msg = queuedCount > 0
            ? ("⏳ " + sSummaryPrefix + ": " + sentCount + " sofort, " + queuedCount + " Folge(n) in Warteschleife!" + batchBadge + topicBadge)
            : ("✅ " + sSummaryPrefix + ": " + sentCount + "/" + episodesWithStreams.length + " Folgen gesendet!" + batchBadge + topicBadge);
          handleAfterTelegramSendClient(lastSentRes, msg, { skipAutoAction: sentCount === 0 });
        } else {
          showHudToast("⚠️ Folgen konnten nicht gesendet werden.");
        }
        loadSeason(seriesId, seasonNum, false, false);
      }

      async function loadSeason(seriesId, seasonNum, jumpToFirstEpisode = false, forceRefresh = false) {
        const parsedSeasonNum = (seasonNum !== undefined && seasonNum !== null && String(seasonNum).trim() !== "" && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
        seasonNum = parsedSeasonNum;
        const seasonReqSeq = ++activeSeasonReqSeq;
        if (state.activeDetails && String(state.activeDetails.id) === String(seriesId)) {
          state.activeDetails._activeLoadedSeason = parsedSeasonNum;
        }
        // 0ms Optimistisches UI-Feedback beim Staffel-Tab-Wechsel
        const existingBox = document.getElementById("seasonBox");
        if (existingBox) {
          existingBox.querySelectorAll(".season-tab-btn").forEach(btn => {
            const dataS = btn.getAttribute("data-season-num");
            if (dataS !== null) {
              btn.classList.toggle("active", Number(dataS) === parsedSeasonNum);
            } else {
              const m = String(btn.textContent || "").match(/(?:Staffel\\s+(\\d+)|Specials)/i);
              if (m) {
                const sVal = m[1] !== undefined ? Number(m[1]) : 0;
                btn.classList.toggle("active", sVal === parsedSeasonNum);
              }
            }
          });
        }
        const vipAllowed = isCurrentUserVip();
        const cacheKey = seriesId + "_" + parsedSeasonNum + "_" + (vipAllowed ? "vip" : "std");
        const cachedEntry = !forceRefresh ? clientSeasonCache.get(cacheKey) : null;
        const hasValidCache = Boolean(cachedEntry && (Date.now() - cachedEntry.ts < CLIENT_CACHE_TTL_MS));
        const s = hasValidCache
          ? cachedEntry.data
          : await apiFetchJson(API_BASE + "/season?seriesId=" + seriesId + "&season=" + parsedSeasonNum);
        if (!hasValidCache && s && s.ok !== false) {
          clientSeasonCache.set(cacheKey, { data: s, ts: Date.now() });
        }
        // Race-Condition-Schutz: Veraltete Staffel-Antwort verwerfen, falls inzwischen eine andere Staffel oder Serie geöffnet wurde
        if (seasonReqSeq !== activeSeasonReqSeq) return;
        if (state.activeDetails && String(state.activeDetails.id) !== String(seriesId)) return;
        // Free-Plan Schutz: Folge-Staffel erst bei explizitem Staffel-Klick laden (kein automatischer Hintergrund-Prefetch)
        const box = document.getElementById("seasonBox");
        if (!box) return;
        const maxAllowedEpisodes = Number(s.seasonEpisodeCount || 0);
        const rawEpisodesArray = Array.isArray(s.episodes) ? s.episodes.map(ep => ({ ...ep })) : [];

        // Smart Auto-Fill Ergänzung: Falls in allStreamFiles der Serie für diese Staffel Folgen vorliegen, die in ep.files fehlen, automatisch zusammenführen
        if (vipAllowed && Array.isArray(state.activeDetails?.allStreamFiles)) {
          const extraSeasonFiles = state.activeDetails.allStreamFiles.filter(f =>
            f && Number(f.season_number ?? 1) === parsedSeasonNum &&
            !f.is_download_only && !f.isDownloadOnly &&
            String(f.codec || "").toUpperCase() !== "RAR" &&
            !/\\.rar$/i.test(String(f.raw_filename || ""))
          );
          const epByNum = new Map(rawEpisodesArray.map(e => [Number(e.episode_number), e]));
          for (const ef of extraSeasonFiles) {
            const en = Number(ef.episode_number || 1);
            if (maxAllowedEpisodes > 0 && en > maxAllowedEpisodes) continue;
            let epObj = epByNum.get(en);
            if (!epObj) {
              epObj = {
                episode_number: en,
                season_number: seasonNum,
                name: resolveClientEpisodeTitle(seriesId, seasonNum, en, ef),
                overview: "",
                vote_average: 0,
                isSaved: false,
                files: [],
                versions: []
              };
              rawEpisodesArray.push(epObj);
              epByNum.set(en, epObj);
            }
            if (!Array.isArray(epObj.files)) epObj.files = [];
            const alreadyIn = epObj.files.some(x => String(x.telegram_file_id) === String(ef.telegram_file_id));
            if (!alreadyIn) {
              epObj.files.push(ef);
            }
          }
          rawEpisodesArray.sort((a, b) => Number(a.episode_number) - Number(b.episode_number));
        }

        const finalEpisodesList = maxAllowedEpisodes > 0
          ? rawEpisodesArray.filter(ep => Number(ep.episode_number) <= maxAllowedEpisodes).slice(0, maxAllowedEpisodes)
          : rawEpisodesArray;
        const episodes = finalEpisodesList;
        activeSeasonCacheEpisodes = episodes;

        const prog = getSeriesProgress(seriesId);
        const seasonStreamableCount = vipAllowed
          ? episodes.filter(ep => Array.isArray(ep.files) && ep.files.length > 0).length
          : 0;

        // Analysiere alle vorhandenen Qualitäts-/Schnittfassungs-Profile in dieser Staffel für die automatische Auffüll-Logik (Smart Auto-Fill)
        const seasonProfileCountMap = new Map();
        if (vipAllowed) {
          for (const ep of episodes) {
            const fl = Array.isArray(ep.files) ? ep.files : [];
            const seenInEp = new Set();
            for (const f of fl) {
              if (!f) continue;
              const vLbl = String(f.versionLabel || f.version_label || f.tags || "Originalfassung").trim() || "Originalfassung";
              const qLbl = String(f.quality || "1080p").trim() || "1080p";
              const pKey = qLbl + " · " + vLbl;
              if (!seenInEp.has(pKey)) {
                seenInEp.add(pKey);
                seasonProfileCountMap.set(pKey, (seasonProfileCountMap.get(pKey) || 0) + 1);
              }
            }
          }
        }
        const sortedSeasonProfiles = Array.from(seasonProfileCountMap.entries())
          .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return getQualityRankScoreClient(b[0]) - getQualityRankScoreClient(a[0]);
          })
          .map(entry => ({ key: entry[0], count: entry[1] }));

        const sProfKey = seriesId + "_" + seasonNum;
        const userPrefProfile = selectedSeasonPreferredProfileMap[sProfKey] || "auto";
        const targetPrimaryProfile = (userPrefProfile !== "auto" && sortedSeasonProfiles.some(p => p.key === userPrefProfile))
          ? userPrefProfile
          : (sortedSeasonProfiles[0]?.key || "");

        const sCounts = (s.seasonCounts && typeof s.seasonCounts === "object") ? s.seasonCounts : (state.activeDetails?.seasonCounts || {});
        const sBtns = (s.seasons || [1]).map(n => {
          const isProgSeason = prog && Number(prog.season) === Number(n);
          const rawCnt = vipAllowed ? Number(sCounts[n] || sCounts[String(n)] || 0) : 0;
          const vipEpCnt = (n === seasonNum && maxAllowedEpisodes > 0) ? Math.min(rawCnt, maxAllowedEpisodes) : rawCnt;
          const vipBadgeTxt = vipEpCnt > 0 ? (' · ' + vipEpCnt) : '';
          const sLabel = n === 0 ? 'Specials' : ('Staffel ' + n);
          return '<button type="button" class="season-tab-btn ' + (n === seasonNum ? 'active' : '') + '" data-season-num="' + n + '" onclick="loadSeason(' + seriesId + ',' + n + ',true)">' + esc(sLabel) + vipBadgeTxt + (isProgSeason ? ' 👁️' : '') + '</button>';
        }).join("");

        const progressBannerHtml = prog ? (
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;margin-bottom:8px;border-radius:8px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);font-size:11.5px">' +
            '<span>👁️ <b>Fortschritt:</b> Zuletzt bei <b>S' + String(prog.season).padStart(2,'0') + 'E' + String(prog.episode).padStart(2,'0') + '</b>' + (prog.epName ? ' (' + esc(prog.epName) + ')' : '') + '</span>' +
            (Number(prog.season) !== Number(seasonNum)
              ? '<button type="button" class="season-tab-btn" style="padding:3px 9px;font-size:11px" onclick="loadSeason(' + seriesId + ',' + Number(prog.season) + ',true)">↪️ Zu ' + (Number(prog.season) === 0 ? 'Specials' : ('Staffel ' + Number(prog.season))) + '</button>'
              : '<button type="button" class="season-tab-btn" style="padding:3px 9px;font-size:11px" onclick="scrollToActiveProgressEpisodeClient()">🎯 Zur Folge springen ▾</button>') +
          '</div>'
        ) : '';

        let autoFilledSeasonCount = 0;
        const episodeCardsHtml = episodes.map(ep => {
          const epCode = 'S'+String(seasonNum).padStart(2,'0')+'E'+String(ep.episode_number).padStart(2,'0');
          const epNameClean = (ep.name && !/^Folge\\s+\\d+$/i.test(ep.name))
            ? ep.name
            : resolveClientEpisodeTitle(seriesId, seasonNum, ep.episode_number, (ep.files && ep.files[0]) || null);
          ep.name = epNameClean;
          const isLastWatched = Boolean(prog && Number(prog.season) === Number(seasonNum) && Number(prog.episode) === Number(ep.episode_number));
          const isAlreadyWatched = Boolean(prog && (Number(seasonNum) < Number(prog.season) || (Number(seasonNum) === Number(prog.season) && Number(ep.episode_number) <= Number(prog.episode))));
          const isNextEpisode = Boolean(prog && Number(prog.season) === Number(seasonNum) && Number(ep.episode_number) === Number(prog.episode) + 1);
          const progBadgeHtml = isLastWatched
            ? '<span class="ep-progress-badge">✓ Zuletzt gesehen</span>'
            : isNextEpisode
              ? '<span class="ep-progress-badge next">▶ Nächste Folge</span>'
              : isAlreadyWatched
                ? '<span class="ep-progress-badge">✓ Gesehen</span>'
                : '';

          let filesBtns = "";
          let activeFileForActions = (Array.isArray(ep.files) && ep.files[0]) ? ep.files[0] : null;
          let isEpAutoFilled = false;
          let topQualityBadgeHtml = "";
          let topAutoFillBadgeHtml = "";

          if (vipAllowed) {
            const rawVersions = Array.isArray(ep.files) && ep.files.length > 0
              ? ep.files.map(f => ({
                  ...f,
                  versionLabel: String(f.versionLabel || f.version_label || f.tags || "Originalfassung").trim() || "Originalfassung",
                  file_id: f.telegram_file_id,
                  telegram_file_id: f.telegram_file_id,
                  quality: String(f.quality || "1080p").trim() || "1080p",
                  codec: f.codec || "x264",
                  file_size: f.file_size || 0,
                  tags: f.tags || "",
                  subtitles: Array.isArray(f.subtitles) ? f.subtitles : [],
                  _normPart: normalizeClientPartLabel(f.part, f.raw_filename || ""),
                  _partNum: extractClientPartNumber(normalizeClientPartLabel(f.part, f.raw_filename || ""))
                }))
              : (Array.isArray(ep.versions) ? ep.versions.map(v => ({
                  ...v,
                  versionLabel: String(v.versionLabel || "Originalfassung").trim() || "Originalfassung",
                  quality: String(v.quality || "1080p").trim() || "1080p"
                })) : []);

            rawVersions.sort((a, b) => {
              if (a._partNum > 0 && b._partNum > 0 && a._partNum !== b._partNum) return a._partNum - b._partNum;
              return getQualityRankScoreClient(b.quality) - getQualityRankScoreClient(a.quality);
            });

            if (rawVersions.length > 0) {
              const vKey = seriesId + "_" + seasonNum + "_" + ep.episode_number;
              const hasManualEpChoice = Object.prototype.hasOwnProperty.call(selectedEpisodeVersionMap, vKey);
              let activeIdx = 0;

              if (hasManualEpChoice) {
                activeIdx = Math.min(Number(selectedEpisodeVersionMap[vKey] || 0), rawVersions.length - 1);
              } else if (targetPrimaryProfile) {
                const matchIdx = rawVersions.findIndex(v => (v.quality + " · " + v.versionLabel) === targetPrimaryProfile);
                if (matchIdx >= 0) {
                  activeIdx = matchIdx;
                } else {
                  activeIdx = 0; // Smart Auto-Fill: Nächstbeste vorhandene Version dieser Folge wählen!
                  if (sortedSeasonProfiles.length > 1) {
                    isEpAutoFilled = true;
                    autoFilledSeasonCount++;
                  }
                }
              }

              const activeVer = rawVersions[activeIdx] || rawVersions[0];
              activeFileForActions = activeVer;
              ep._resolvedActiveFile = activeVer;

              const activeFid = activeVer.file_id || activeVer.telegram_file_id;
              const activeSizeStr = formatFileSizeClient(activeVer.file_size);
              const activeLabel = cleanUserVisibleStreamTagsClient(activeVer.versionLabel || activeVer.tags || "Originalfassung") || "Originalfassung";
              const activeSubs = Array.isArray(activeVer.subtitles) ? activeVer.subtitles : [];
              const isPrereleaseEp = activeLabel.includes("Vorabversion") || /\\b(?:HDTS|TeleSync|HDCAM|MicDub|LineDub|Screener|DVDScr)\\b/i.test(activeLabel);

              topQualityBadgeHtml = formatQualityBadgeHtmlClient(activeVer.quality || "1080p", activeVer.codec);
              if (isEpAutoFilled) {
                topAutoFillBadgeHtml = '<span class="ep-autofill-badge" title="Fehlte in ' + esc(targetPrimaryProfile) + ' – automatisch aufgefüllt mit ' + esc(activeVer.quality + ' (' + activeLabel + ')') + '">🔄 Ergänzt · ' + esc(activeVer.quality) + '</span>';
              }

              const hasMultiplePartsInEp = rawVersions.length > 1 && rawVersions.every(v => v._partNum > 0);
              if (hasMultiplePartsInEp) {
                filesBtns = rawVersions.map(f => {
                  const sz = formatFileSizeClient(f.file_size);
                  const fSubs = Array.isArray(f.subtitles) ? f.subtitles : [];
                  const partPrefix = f._normPart ? (f._normPart + ' · ') : '';
                  const btnMeta = [partPrefix + (f.quality || '1080p'), f.codec || '', sz ? ('· ' + sz) : ''].filter(Boolean).join(' ');
                  return '<button type="button" class="btn-stream-clean" data-fid="' + esc(f.telegram_file_id) + '" data-title="' + esc((state.activeDetails?.title || 'Serie') + ' ' + epCode + ' - ' + ep.name + (f._normPart ? ' (' + f._normPart + ')' : '')) + '" data-qual="' + esc(f.quality || '1080p') + '" data-sid="' + seriesId + '" data-sn="' + seasonNum + '" data-en="' + ep.episode_number + '" data-epname="' + esc(ep.name) + '" data-size="' + esc(sz) + '" data-tags="' + esc(activeLabel) + '" onclick="requestTelegramStreamFromBtn(this)">▶ ' + esc(btnMeta) + (fSubs.length > 0 ? ' + UT' : '') + '</button>';
                }).join(" ");
              } else {
                const activeBtnMeta = [activeVer.quality || '1080p', activeVer.codec || '', activeSizeStr ? ('· ' + activeSizeStr) : '', activeLabel ? ('· ' + activeLabel) : ''].filter(Boolean).join(' ');
                const playBtnHtml = '<button type="button" class="btn-stream-clean ' + (isPrereleaseEp ? 'prerelease' : '') + '" data-fid="' + esc(activeFid) + '" data-title="' + esc((state.activeDetails?.title || 'Serie') + ' ' + epCode + ' - ' + ep.name) + '" data-qual="' + esc(activeVer.quality || '1080p') + '" data-sid="' + seriesId + '" data-sn="' + seasonNum + '" data-en="' + ep.episode_number + '" data-epname="' + esc(ep.name) + '" data-size="' + esc(activeSizeStr) + '" data-tags="' + esc(activeLabel) + '" onclick="requestTelegramStreamFromBtn(this)">▶ Stream · ' + esc(activeBtnMeta) + (activeSubs.length > 0 ? ' + UT' : '') + '</button>' +
                  (activeSubs.length > 0 ? ' <button type="button" class="btn-tool-quiet" style="padding:4px 8px;font-size:11px" data-fid="' + esc(activeFid) + '" data-title="' + esc((state.activeDetails?.title || 'Serie') + ' ' + epCode) + '" data-sid="' + seriesId + '" data-sn="' + seasonNum + '" data-en="' + ep.episode_number + '" onclick="requestTelegramSubtitleOnlyFromBtn(this)" title="Nur Untertitel einzeln senden">💬 UT (' + activeSubs.length + ')</button>' : '');

                const switcherTabsHtml = rawVersions.length > 1 ? (
                  '<div class="version-switcher" style="display:inline-flex;gap:3px;align-items:center;background:rgba(15,23,42,0.65);padding:2px 4px;border-radius:7px;border:1px solid rgba(148,163,184,0.22)">' +
                    rawVersions.map((v, vIdx) => {
                      const isSel = vIdx === activeIdx;
                      const pillTxt = (v.quality || "1080p") + " · " + (v.versionLabel || "Originalfassung");
                      return '<button type="button" class="delivery-pill-btn ' + (isSel ? 'active' : '') + '" style="padding:2px 7px;font-size:10.5px" onclick="selectEpisodeVersion(' + seriesId + ',' + seasonNum + ',' + ep.episode_number + ',' + vIdx + ')">' + esc(pillTxt) + '</button>';
                    }).join('') +
                  '</div>'
                ) : '';

                filesBtns = playBtnHtml + (switcherTabsHtml ? (" " + switcherTabsHtml) : "");
              }
            }
          }

          const isAdminUser = Boolean(state.authUser?.isAdmin);
          const canReportMedia = Boolean(vipAllowed || isAdminUser);
          const activeFidStr = String(activeFileForActions?.telegram_file_id || activeFileForActions?.file_id || "");
          const activeVerLblStr = String(activeFileForActions?.versionLabel || activeFileForActions?.version_label || activeFileForActions?.tags || "Originalfassung");
          const activeQualStr = String(activeFileForActions?.quality || "1080p");
          const activeRawFnStr = String(activeFileForActions?.raw_filename || "");
          const activeMsgLinkStr = String(activeFileForActions?.message_link || "");
          const hasStreamFile = Boolean(Array.isArray(ep.files) && ep.files.length > 0);

          const adminEditBtnHtml = (isAdminUser && hasStreamFile)
            ? ('<button type="button" class="ep-ghost-btn admin-remap-btn" data-type="s" data-tmdb-id="' + seriesId + '" data-sn="' + seasonNum + '" data-en="' + ep.episode_number + '" data-epname="' + esc(ep.name) + '" data-fid="' + esc(activeFidStr) + '" data-ver="' + esc(activeVerLblStr) + '" data-qual="' + esc(activeQualStr) + '" data-raw="' + esc(activeRawFnStr) + '" data-msg="' + esc(activeMsgLinkStr) + '" onclick="openEpisodeCorrectionFromBtn(this)" title="Folge ' + esc(epCode) + ' (' + esc(ep.name) + ') neu zuordnen oder Schnittfassung ändern">✏️ ' + esc(epCode) + ' zuordnen</button>')
            : '';

          const reportBtnHtml = canReportMedia
            ? ('<button type="button" class="ep-ghost-btn" data-type="s" data-tmdb-id="' + seriesId + '" data-sn="' + seasonNum + '" data-en="' + ep.episode_number + '" data-epname="' + esc(ep.name) + '" data-fid="' + esc(activeFidStr) + '" data-ver="' + esc(activeVerLblStr) + '" onclick="openMediaReportFromBtn(this)" title="Fehler für ' + epCode + ' melden">⚠️</button>')
            : '';

          const rowCls = [
            "ep-row",
            isLastWatched ? "ep-watched" : (isNextEpisode ? "ep-next-up" : ""),
            isEpAutoFilled ? "ep-autofilled" : ""
          ].filter(Boolean).join(" ");

          return '<div class="' + rowCls + '" data-ep-num="' + Number(ep.episode_number) + '" data-ep-search="' + esc((epCode + ' ' + ep.name + ' ' + ep.episode_number).toLowerCase()) + '">' +
            '<div class="ep-row-top">' +
              '<div class="ep-title" tabindex="0" data-sid="' + seriesId + '" data-sn="' + seasonNum + '" data-en="' + ep.episode_number + '" data-epname="' + esc(ep.name) + '" onclick="openEpisodeStoryFromEl(this)" title="' + esc(epCode + ' – ' + ep.name) + ' (Antippen für Beschreibung)">' +
                '<span class="ep-code-badge">' + epCode + '</span>' +
                '<div class="ep-name-wrap"><span class="ep-name-text">' + esc(ep.name) + '</span></div>' +
              '</div>' +
              '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;flex-shrink:0">' +
                (filesBtns ? '' : topQualityBadgeHtml) +
                topAutoFillBadgeHtml +
                progBadgeHtml +
              '</div>' +
            '</div>' +
            '<div class="ep-row-bottom">' +
              '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0">' +
                (filesBtns || '<span style="font-size:11px;color:var(--muted)">Keine Stream-Datei verknüpft</span>') +
              '</div>' +
              '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                adminEditBtnHtml +
                reportBtnHtml +
                '<button type="button" class="ep-ghost-btn '+(ep.isSaved?'saved':'')+'" onclick="toggleEpisodeSave('+seriesId+','+seasonNum+','+ep.episode_number+')" title="'+(ep.isSaved?'Folge aus Merkliste entfernen':'Folge auf Merkliste speichern')+'">'+(ep.isSaved?'✓ Gemerkt':'🔖')+'</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        }).join("");

        const seasonVersionFilterBarHtml = (vipAllowed && sortedSeasonProfiles.length > 1) ? (
          '<div class="season-version-filter-bar">' +
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
              '<span style="font-weight:800;color:#38bdf8">🎞️ Staffel-Version (Smart Auto-Fill):</span>' +
              '<button type="button" class="delivery-pill-btn ' + (userPrefProfile === 'auto' ? 'active' : '') + '" style="padding:3px 9px;font-size:11px" onclick="selectSeasonPreferredProfileClient(' + seriesId + ',' + seasonNum + ',\\'auto\\')">✨ Komplett · Auto (' + esc(sortedSeasonProfiles[0].key) + ')</button>' +
              sortedSeasonProfiles.map(prof => {
                const isAct = userPrefProfile === prof.key;
                const missingCnt = Math.max(0, seasonStreamableCount - prof.count);
                return '<button type="button" class="delivery-pill-btn ' + (isAct ? 'active' : '') + '" style="padding:3px 9px;font-size:11px" onclick="selectSeasonPreferredProfileClient(' + seriesId + ',' + seasonNum + ',\\'' + escJs(prof.key) + '\\')">' +
                  esc(prof.key) + ' (' + prof.count + '/' + seasonStreamableCount + (missingCnt > 0 ? (' + ' + missingCnt + ' ergänzt') : '') + ')' +
                '</button>';
              }).join("") +
            '</div>' +
            (autoFilledSeasonCount > 0
              ? '<span class="ep-autofill-badge">🔄 ' + autoFilledSeasonCount + ' fehlende Folge' + (autoFilledSeasonCount === 1 ? '' : 'n') + ' automatisch ergänzt</span>'
              : '<span class="stream-meta-pill" style="border-color:rgba(16,185,129,0.45);color:#6ee7b7">✓ Komplett in ' + esc(targetPrimaryProfile) + '</span>') +
          '</div>'
        ) : '';

        const episodeQuickFilterHtml = episodes.length >= 6 ? (
          '<div style="display:inline-flex;align-items:center;gap:4px;background:rgba(15,23,42,0.72);border:1px solid rgba(148,163,184,0.25);border-radius:8px;padding:2px 7px">' +
            '<span style="font-size:11px;opacity:0.75">🔍</span>' +
            '<input id="seasonEpQuickSearchInp" type="text" placeholder="Folge / Titel (' + episodes.length + ')..." oninput="filterSeasonEpisodesInlineClient(this.value)" style="background:transparent;border:none;outline:none;color:var(--text);font-size:11.5px;width:130px;padding:3px 2px" />' +
            '<button type="button" id="seasonEpQuickSearchClearBtn" style="display:none;background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:11px;padding:0 3px" onclick="const inp=document.getElementById(\\'seasonEpQuickSearchInp\\');if(inp){inp.value=\\'\\';filterSeasonEpisodesInlineClient(\\'\\');inp.focus();}" title="Episoden-Filter zurücksetzen">✕</button>' +
          '</div>'
        ) : '';

        box.innerHTML =
          '<div class="season-toolbar-row">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' + sBtns + '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
              episodeQuickFilterHtml +
              ((vipAllowed && seasonStreamableCount > 0) ? (
                '<button type="button" class="btn-action-glass" style="padding:5px 10px;font-size:11.5px;border-color:rgba(56,189,248,0.45);color:#7dd3fc" onclick="sendWholeSeasonToTelegram(' + seriesId + ',' + seasonNum + ')" title="Alle ' + seasonStreamableCount + ' verfügbaren Folgen von ' + (Number(seasonNum) === 0 ? 'Specials' : ('Staffel ' + seasonNum)) + ' (inkl. automatisch ergänzter Folgen) nacheinander senden">' +
                  '📦 ' + (Number(seasonNum) === 0 ? 'Specials' : ('Staffel ' + seasonNum)) + ' komplett senden (' + seasonStreamableCount + ')' +
                '</button>'
              ) : '') +
            '</div>' +
          '</div>' +
          seasonVersionFilterBarHtml +
          progressBannerHtml +
          '<div id="seasonEpisodesListWrap">' + episodeCardsHtml + '</div>';

        const seriesArchMount = document.getElementById("seriesArchiveDownloadsMount");
        if (seriesArchMount && vipAllowed) {
          const mergedSeriesDownloads = [
            ...(Array.isArray(state.activeDetails?.downloads) ? state.activeDetails.downloads : []),
            ...(Array.isArray(s.downloads) ? s.downloads : [])
          ];
          if (mergedSeriesDownloads.length > 0) {
            seriesArchMount.innerHTML = buildArchiveDownloadsSectionHtml(
              { ...(state.activeDetails || {}), downloads: mergedSeriesDownloads },
              Boolean(state.authUser?.isAdmin)
            );
          }
        }
        if (typeof refreshDetailModalVersionsTabDomClient === "function") {
          refreshDetailModalVersionsTabDomClient();
        }
        if (typeof window.refreshModalAndEpisodeMarquees === "function") {
          setTimeout(() => window.refreshModalAndEpisodeMarquees(box), 50);
        }
        if (jumpToFirstEpisode) {
          const nextOrFirstEpEl = box.querySelector(".ep-row.ep-next-up .ep-title, .ep-row.ep-watched .ep-title, .ep-title");
          if (nextOrFirstEpEl && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(nextOrFirstEpEl, true);
          }
        }
      }
