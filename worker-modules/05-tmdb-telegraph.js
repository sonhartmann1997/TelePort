  // @DEPARTMENT: 05-tmdb-telegraph | 5. TMDb-API, Confidence-Scoring & Multi-API Fallback
  // @ANCHOR: TELEGRAPH_ENGINE
  // ============================================================================
  // TELEGRAPH (telegra.ph) ARTIKEL-GENERATOR FÜR CAPTIONS (FILME, SERIEN & EPISODEN)
  // Erstellt automatisch Instant-View Artikel auf telegra.ph und speichert den Link
  // dauerhaft in der Cloudflare D1 SQLite Datenbank (movies, series, series_seasons, series_episodes).
  // ============================================================================
  async function getTelegraphAccessToken(env) {
    if (env?.TELEGRAPH_ACCESS_TOKEN) return env.TELEGRAPH_ACCESS_TOKEN;
    if (memoryFallback.has("telegraph_access_token")) {
      return memoryFallback.get("telegraph_access_token");
    }
    const d1TokenObj = await getEntityFromD1(env, "telegraph_account", 365 * 24 * 60 * 60 * 1000);
    if (d1TokenObj && d1TokenObj.access_token) {
      memoryFallback.set("telegraph_access_token", d1TokenObj.access_token);
      return d1TokenObj.access_token;
    }
    try {
      const res = await fetchWithTimeout(
        "https://api.telegra.ph/createAccount?short_name=MovieSeriesBot&author_name=Film+%26+Serien+Bot",
        {},
        3500
      );
      if (res.ok) {
        const json = await res.json();
        const token = json?.result?.access_token;
        if (token) {
          memoryFallback.set("telegraph_access_token", token);
          await saveEntityToD1(env, "telegraph_account", "telegraph", { access_token: token });
          return token;
        }
      }
    } catch (e) {}
    return null;
  }

  async function createTelegraphPage(env, title, contentNodes, authorName = "Film & Serien Bot") {
    const accessToken = await getTelegraphAccessToken(env);
    if (!accessToken || !Array.isArray(contentNodes) || contentNodes.length === 0) return null;
    try {
      const res = await fetchWithTimeout("https://api.telegra.ph/createPage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: accessToken,
          title: String(title || "Film & Serien Info").slice(0, 250),
          author_name: authorName,
          content: contentNodes,
          return_content: false
        })
      }, 4000);
      if (res.ok) {
        const json = await res.json();
        if (json?.ok && json?.result?.url) {
          return String(json.result.url);
        }
      }
    } catch (e) {}
    return null;
  }

  async function ensureMovieOrSeriesTelegraphUrl(env, typeCode, details) {
    if (!details || !details.id) return null;
    if (details.telegraphUrl && details.telegraphVersion === 2) return details.telegraphUrl;

    const isMovie = typeCode === "m";
    const cleanTitle = (details.title || "Unbekannt").replace(/\s*\(\d{4}\)$/, "").trim();
    const releaseYear = details.releaseDate && details.releaseDate !== "Keine Angabe"
      ? String(details.releaseDate).split("-")[0]
      : "";
    const pageTitle = `${cleanTitle}${releaseYear ? ` (${releaseYear})` : ""} • ${isMovie ? "Film-Dossier" : "Serien-Dossier"}`;
    const voteAverage = details.vote_average ? `${Math.round(details.vote_average * 10) / 10} / 10` : "Keine Angabe";
    const fskDisplay = formatFskDisplay(details.fsk);

    const nodes = [];

    // 1. Original-Filmposter (in höchster Original-Auflösung) prominent ganz oben
    if (details.poster_path) {
      nodes.push({
        tag: "figure",
        children: [
          { tag: "img", attrs: { src: `https://image.tmdb.org/t/p/original${details.poster_path}` } },
          { tag: "figcaption", children: [`🖼️ Offizielles Original-Poster • ${cleanTitle}${releaseYear ? ` (${releaseYear})` : ""}`] }
        ]
      });
    } else if (details.backdrop_path) {
      nodes.push({
        tag: "figure",
        children: [
          { tag: "img", attrs: { src: `https://image.tmdb.org/t/p/original${details.backdrop_path}` } },
          { tag: "figcaption", children: [`🖼️ Titelbild • ${cleanTitle}${releaseYear ? ` (${releaseYear})` : ""}`] }
        ]
      });
    }

    // 2. Edles Quick-Facts Banner (Aside Callout)
    nodes.push({
      tag: "aside",
      children: [
        `⭐ ${voteAverage}   •   🔞 ${fskDisplay}   •   ⏳ ${details.runtime || "k.A."}   •   🌍 ${details.country || "k.A."}`
      ]
    });

    // 3. Story & Inhaltsangabe
    let fullOverview = (details.overview || "Keine Beschreibung verfügbar.").trim();
    if (details.isEnglishFallback && fullOverview) {
      const translatedDe = await translator(fullOverview, "de");
      nodes.push({ tag: "h3", children: ["📖 Story & Handlung (Deutsch)"] });
      nodes.push({ tag: "blockquote", children: [translatedDe || fullOverview] });
      nodes.push({ tag: "h4", children: ["🇬🇧 Englische Originalfassung"] });
      nodes.push({ tag: "p", children: [{ tag: "em", children: [fullOverview] }] });
    } else {
      nodes.push({ tag: "h3", children: ["📖 Story & Handlung"] });
      nodes.push({ tag: "blockquote", children: [fullOverview] });
    }

    // 4. Eingebetteter Video-Trailer direkt auf der Telegraph-Seite + Anonyme Frontends
    if (details.trailerKey) {
      const ytWatchUrl = `https://www.youtube.com/watch?v=${details.trailerKey}`;
      nodes.push({ tag: "hr" });
      nodes.push({ tag: "h3", children: ["🎬 Offizieller Trailer (Direkt abspielen)"] });
      nodes.push({
        tag: "figure",
        children: [
          {
            tag: "iframe",
            attrs: { src: `/embed/youtube?url=${encodeURIComponent(ytWatchUrl)}` }
          },
          {
            tag: "figcaption",
            children: [`▶️ Eingebetteter Trailer zu „${cleanTitle}“ – direkt im Artikel abspielbar`]
          }
        ]
      });
      nodes.push({
        tag: "blockquote",
        children: [
          { tag: "strong", children: ["🛡️ Anonyme & werbefreie Trailer-Mirrors: "] },
          { tag: "a", attrs: { href: `https://piped.video/watch?v=${details.trailerKey}` }, children: ["Piped"] },
          "  •  ",
          { tag: "a", attrs: { href: `https://yewtu.be/watch?v=${details.trailerKey}` }, children: ["Invidious (yewtu.be)"] },
          "  •  ",
          { tag: "a", attrs: { href: `https://invidious.nerdvpn.de/watch?v=${details.trailerKey}` }, children: ["Invidious (DE)"] },
          "  •  ",
          { tag: "a", attrs: { href: `https://inv.nadeko.net/watch?v=${details.trailerKey}` }, children: ["Invidious (Nadeko)"] },
          "  •  ",
          { tag: "a", attrs: { href: `https://poketube.fun/watch?v=${details.trailerKey}` }, children: ["PokeTube"] },
          "  •  ",
          { tag: "a", attrs: { href: ytWatchUrl }, children: ["YouTube"] }
        ]
      });
    }

    // 5. Strukturierte Produktions- & Besetzungs-Details
    nodes.push({ tag: "hr" });
    nodes.push({ tag: "h3", children: ["🎭 Besetzung & Produktions-Details"] });

    const listItems = [];
    if (!isMovie && details.statusText) {
      listItems.push({
        tag: "li",
        children: [
          { tag: "strong", children: ["📡 Serien-Status: "] },
          `${details.statusText} (${details.numberOfSeasons || 1} Staffeln • ${details.numberOfEpisodes || 0} Episoden)`
        ]
      });
    }
    listItems.push(
      { tag: "li", children: [{ tag: "strong", children: ["🎞️ Genres: "] }, String(details.genres || "Keine Angabe")] },
      { tag: "li", children: [{ tag: "strong", children: ["🗓️ Erstveröffentlichung: "] }, String(details.releaseDate || "Keine Angabe")] },
      { tag: "li", children: [{ tag: "strong", children: ["🎬 Regie / Creator: "] }, String(details.directors || "Keine Angabe")] },
      { tag: "li", children: [{ tag: "strong", children: ["🌟 Hauptbesetzung: "] }, String(details.casts || "Keine Angabe")] }
    );
    if (details.providers) {
      listItems.push({
        tag: "li",
        children: [{ tag: "strong", children: ["📺 Streaming (Flatrate DE): "] }, String(details.providers)]
      });
    }
    if (details.collection?.name) {
      listItems.push({
        tag: "li",
        children: [{ tag: "strong", children: ["🍿 Filmreihe: "] }, String(details.collection.name)]
      });
    }
    nodes.push({ tag: "ul", children: listItems });

    // 6. Optionales Widescreen-Szenenbild (Backdrop) in Original-Auflösung
    if (details.backdrop_path && details.poster_path && details.backdrop_path !== details.poster_path) {
      nodes.push({
        tag: "figure",
        children: [
          { tag: "img", attrs: { src: `https://image.tmdb.org/t/p/original${details.backdrop_path}` } },
          { tag: "figcaption", children: [`🌄 Widescreen-Szenenbild (Backdrop) • ${cleanTitle}`] }
        ]
      });
    }

    const tmdbUrl = `https://www.themoviedb.org/${isMovie ? "movie" : "tv"}/${details.id}?language=de-DE`;
    nodes.push({ tag: "hr" });
    nodes.push({
      tag: "p",
      children: [
        "🌐 ",
        { tag: "strong", children: ["Offizielle Datenbank: "] },
        { tag: "a", attrs: { href: tmdbUrl }, children: ["Eintrag auf TheMovieDB (Deutsch) öffnen"] }
      ]
    });

    const url = await createTelegraphPage(env, pageTitle, nodes);
    if (url) {
      details.telegraphUrl = url;
      details.telegraphVersion = 2;
      const cacheKey = isMovie ? `movie_${details.id}` : `tv_${details.id}`;
      setCachedTmdb(cacheKey, details);
      if (isMovie) {
        await saveMovieToD1(env, details);
      } else {
        await saveSeriesToD1(env, details);
      }
    }
    return url;
  }

  async function ensureSeasonTelegraphUrl(env, seriesId, seriesDetails, seasonData) {
    if (!seasonData || !Array.isArray(seasonData.episodes) || seasonData.episodes.length === 0) return null;
    if (seasonData.telegraphUrl && seasonData.telegraphVersion === 2) return seasonData.telegraphUrl;

    const seriesTitle = (seriesDetails?.title || `Serie #${seriesId}`).replace(/\s*\(\d{4}\)$/, "").trim();
    const sNum = seasonData.season_number || 1;
    const pageTitle = `${seriesTitle} • Staffel ${sNum} (Episoden-Guide)`;

    const nodes = [];
    if (seriesDetails?.poster_path) {
      nodes.push({
        tag: "figure",
        children: [
          { tag: "img", attrs: { src: `https://image.tmdb.org/t/p/original${seriesDetails.poster_path}` } },
          { tag: "figcaption", children: [`🖼️ Original-Serienposter • ${seriesTitle} (Staffel ${sNum})`] }
        ]
      });
    }
    if (seriesDetails?.trailerKey) {
      const ytUrl = `https://www.youtube.com/watch?v=${seriesDetails.trailerKey}`;
      nodes.push({
        tag: "figure",
        children: [
          { tag: "iframe", attrs: { src: `/embed/youtube?url=${encodeURIComponent(ytUrl)}` } },
          { tag: "figcaption", children: [`🎬 Offizieller Serien-Trailer zu ${seriesTitle}`] }
        ]
      });
    }

    nodes.push({
      tag: "aside",
      children: [`📺 ${seriesTitle}  •  💿 Staffel ${sNum}  •  🎞️ ${seasonData.episodes.length} Episoden`]
    });
    nodes.push({ tag: "hr" });

    for (const ep of seasonData.episodes) {
      const eNum = ep.episode_number || 1;
      const codeStr = `S${String(sNum).padStart(2, "0")}E${String(eNum).padStart(2, "0")}`;
      const epName = ep.name || `Folge ${eNum}`;
      const metaParts = [];
      if (ep.air_date) metaParts.push(`📅 ${ep.air_date}`);
      if (ep.vote_average) metaParts.push(`⭐ ${Math.round(ep.vote_average * 10) / 10}`);
      if (ep.runtime) metaParts.push(`⏳ ${ep.runtime}`);

      nodes.push({
        tag: "h4",
        children: [`🎬 ${codeStr} – ${epName}${metaParts.length ? ` (${metaParts.join(" • ")})` : ""}`]
      });
      nodes.push({
        tag: "blockquote",
        children: [ep.overview && ep.overview.trim() ? ep.overview.trim() : "Keine Episodenbeschreibung hinterlegt."]
      });
    }

    const url = await createTelegraphPage(env, pageTitle, nodes);
    if (url) {
      seasonData.telegraphUrl = url;
      seasonData.telegraphVersion = 2;
      setCachedTmdb(`tv_season_${seriesId}_${sNum}`, seasonData);
      await saveSeasonToD1(env, seriesId, sNum, seasonData);
    }
    return url;
  }

  async function ensureEpisodeTelegraphUrl(env, seriesId, seriesDetails, seasonNumber, epObj) {
    if (!epObj) return null;
    if (epObj.telegraphUrl && epObj.telegraphVersion === 2) return epObj.telegraphUrl;

    const eNum = epObj.episode_number || 1;
    const d1Ep = await getEpisodeFromD1(env, seriesId, seasonNumber, eNum);
    if (!epObj.overview && d1Ep && d1Ep.overview) {
      epObj.overview = d1Ep.overview;
    }
    if (!epObj.overview) {
      const sData = await fetchSeasonDetails(env, seriesId, seasonNumber);
      const matchedEp = (sData?.episodes || []).find(x => Number(x.episode_number) === Number(eNum));
      if (matchedEp) {
        if (matchedEp.overview) epObj.overview = matchedEp.overview;
        if (!epObj.air_date && matchedEp.air_date) epObj.air_date = matchedEp.air_date;
        if (!epObj.vote_average && matchedEp.vote_average) epObj.vote_average = matchedEp.vote_average;
        if (!epObj.runtime && matchedEp.runtime) epObj.runtime = matchedEp.runtime;
        if (!epObj.still_path && matchedEp.still_path) epObj.still_path = matchedEp.still_path;
      }
    }

    const seriesTitle = (seriesDetails?.title || `Serie #${seriesId}`).replace(/\s*\(\d{4}\)$/, "").trim();
    const codeStr = `S${String(seasonNumber).padStart(2, "0")}E${String(eNum).padStart(2, "0")}`;
    const epName = epObj.name || epObj.title || `Folge ${eNum}`;
    const pageTitle = `${seriesTitle} ${codeStr} – ${epName}`;

    const nodes = [];
    if (seriesDetails?.poster_path) {
      nodes.push({
        tag: "figure",
        children: [
          { tag: "img", attrs: { src: `https://image.tmdb.org/t/p/original${seriesDetails.poster_path}` } },
          { tag: "figcaption", children: [`🖼️ Original-Serienposter • ${seriesTitle} (${codeStr}: ${epName})`] }
        ]
      });
    }
    if (epObj.still_path || seriesDetails?.backdrop_path) {
      const stillImg = epObj.still_path || seriesDetails.backdrop_path;
      nodes.push({
        tag: "figure",
        children: [
          { tag: "img", attrs: { src: `https://image.tmdb.org/t/p/original${stillImg}` } },
          { tag: "figcaption", children: [`🌄 Episoden-Szenenbild • ${codeStr} – ${epName}`] }
        ]
      });
    }

    const metaParts = [`📺 ${seriesTitle}`, `💿 Staffel ${seasonNumber} • Folge ${eNum}`];
    if (epObj.air_date) metaParts.push(`📅 ${epObj.air_date}`);
    if (epObj.vote_average) metaParts.push(`⭐ ${Math.round(epObj.vote_average * 10) / 10} / 10`);
    if (epObj.runtime) metaParts.push(`⏳ ${epObj.runtime}`);

    nodes.push({ tag: "aside", children: [metaParts.join("   •   ")] });
    nodes.push({ tag: "h3", children: ["📖 Episoden-Handlung"] });
    nodes.push({
      tag: "blockquote",
      children: [epObj.overview && epObj.overview.trim() ? epObj.overview.trim() : "Keine Beschreibung für diese Folge verfügbar."]
    });

    if (seriesDetails?.trailerKey) {
      const ytUrl = `https://www.youtube.com/watch?v=${seriesDetails.trailerKey}`;
      nodes.push({ tag: "hr" });
      nodes.push({ tag: "h3", children: ["🎬 Serien-Trailer (Direkt abspielen)"] });
      nodes.push({
        tag: "figure",
        children: [
          { tag: "iframe", attrs: { src: `/embed/youtube?url=${encodeURIComponent(ytUrl)}` } },
          { tag: "figcaption", children: [`▶️ Offizieller Trailer zu ${seriesTitle}`] }
        ]
      });
    }

    const tmdbEpUrl = `https://www.themoviedb.org/tv/${seriesId}/season/${seasonNumber}/episode/${eNum}?language=de-DE`;
    nodes.push({ tag: "hr" });
    nodes.push({
      tag: "p",
      children: [
        "🌐 ",
        { tag: "strong", children: ["Quelle: "] },
        { tag: "a", attrs: { href: tmdbEpUrl }, children: ["Episode auf TMDB (Deutsch) öffnen"] }
      ]
    });

    const url = await createTelegraphPage(env, pageTitle, nodes);
    if (url) {
      epObj.telegraphUrl = url;
      epObj.telegraphVersion = 2;
      await saveEpisodeTelegraphToD1(env, seriesId, seasonNumber, eNum, epObj, url);
      const cachedSeason = getCachedTmdb(`tv_season_${seriesId}_${seasonNumber}`);
      if (cachedSeason && Array.isArray(cachedSeason.episodes)) {
        const targetEp = cachedSeason.episodes.find(x => Number(x.episode_number) === Number(eNum));
        if (targetEp) {
          targetEp.telegraphUrl = url;
          targetEp.telegraphVersion = 2;
        }
        await saveSeasonToD1(env, seriesId, seasonNumber, cachedSeason);
      }
    }
    return url;
  }

  async function ensureCollectionTelegraphUrl(env, col) {
    if (!col || !col.id) return null;
    if (col.telegraphUrl) return col.telegraphUrl;
    const cacheKey = `col_telegraph_${col.id}`;
    const cachedUrl = memoryFallback.get(cacheKey);
    if (cachedUrl) return cachedUrl;

    const nodes = [];
    if (col.posterUrl) {
      nodes.push({
        tag: "figure",
        children: [
          { tag: "img", attrs: { src: col.posterUrl } },
          { tag: "figcaption", children: [`🍿 ${col.name} (${(col.parts || []).length} Filme)`] }
        ]
      });
    }
    if (col.overview) {
      nodes.push({ tag: "blockquote", children: [String(col.overview).trim()] });
    }
    if (Array.isArray(col.parts) && col.parts.length > 0) {
      nodes.push({ tag: "h3", children: ["🎬 Enthaltene Filme"] });
      for (const p of col.parts) {
        const yr = (p.release_date || "").split("-")[0] || "K. A.";
        nodes.push({
          tag: "p",
          children: [
            { tag: "strong", children: [`• ${p.title || p.name || "Film"} (${yr})`] },
            p.overview ? ` – ${String(p.overview).slice(0, 180)}` : ""
          ]
        });
      }
    }
    const url = await createTelegraphPage(env, `🍿 ${col.name}`, nodes).catch(() => null);
    if (url) {
      col.telegraphUrl = url;
      memoryFallback.set(cacheKey, url);
    }
    return url;
  }

  // @ANCHOR: TMDB_FETCH
  // --- TMDB API & Multi-API Fallback (TMDb -> OMDb -> Wikidata -> MediaWiki DE/EN) mit 24h Cloudflare Edge-Cache ---
  async function fetchSimilarMedia(env, typeCode, sourceItemId, page = 1) {
    const typePath = typeCode === "s" ? "tv" : "movie";
    const simCacheKey = `sim_list_${typePath}_${sourceItemId}`;
    let results = getCachedTmdb(simCacheKey);
    if (!results) {
      results = await getEntityFromD1(env, simCacheKey, D1_MOVIE_TTL_MS);
      if (results) setCachedTmdb(simCacheKey, results);
    }
    if (!results) {
      results = [];
      try {
        const urlRec = `https://api.themoviedb.org/3/${typePath}/${sourceItemId}/recommendations?language=de-DE&page=${page}`;
        const res = await fetchWithTimeout(urlRec, {
          headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` }
        }, 4500);
        if (res.ok) {
          const json = await res.json();
          results = (json.results || []).filter(i => i && i.id);
        }
      } catch (e) {}
      if (results.length < 5) {
        try {
          const urlSim = `https://api.themoviedb.org/3/${typePath}/${sourceItemId}/similar?language=de-DE&page=${page}`;
          const resSim = await fetchWithTimeout(urlSim, {
            headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` }
          }, 4000);
          if (resSim.ok) {
            const jsonSim = await resSim.json();
            const more = (jsonSim.results || []).filter(i => i && i.id && !results.some(r => r.id === i.id));
            results = [...results, ...more];
          }
        } catch (e) {}
      }
      if (results.length > 0) {
        setCachedTmdb(simCacheKey, results);
        await saveEntityToD1(env, simCacheKey, "similar", results);
      }
    }
    return { results: results || [] };
  }

  var currentInvocationSubrequests = 0;
  var subrequestBudgetExhausted = false;
  function resetSubrequestBudget() {
    currentInvocationSubrequests = 0;
    subrequestBudgetExhausted = false;
  }
  function hasSubrequestBudget(limit = 36) {
    return currentInvocationSubrequests < limit;
  }

  async function cachedExternalFetchJson(url, options = {}, timeoutMs = 4000, ttlSeconds = 86400) {
    const memKey = `ext_json_${url}`;
    const memHit = getCachedTmdb(memKey);
    if (memHit) return memHit;

    if (!hasSubrequestBudget(40)) {
      subrequestBudgetExhausted = true;
      return null;
    }

    try {
      currentInvocationSubrequests++;
      const res = await fetchWithTimeout(url, { ...options, _countedSubrequest: true }, timeoutMs);
      if (!res || !res.ok) return null;
      const text = await res.text();
      if (!text || text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
        return null;
      }
      const data = JSON.parse(text);
      setCachedTmdb(memKey, data);
      return data;
    } catch (e) {
      return null;
    }
  }

  function hashStringToPositiveInt(str, offsetBase = 900000000, moduloRange = 89999999) {
    let h = 2166136261;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const cleanMod = Math.max(1000000, Number(moduloRange) || 89999999);
    return offsetBase + ((h >>> 0) % cleanMod);
  }

  // Löst externe IDs (IMDb tt..., TheTVDB, Wikidata Q...) direkt über TMDb /3/find/ in offizielle TMDb-IDs (1..99.999.999) auf,
  // damit Serien und Filme wann immer möglich ihre echte TMDb-ID statt einer Fallback-ID erhalten!
  async function resolveExternalIdToTmdb(env, externalId, externalSource = "imdb_id", preferredTypeCode = null) {
    const extId = String(externalId || "").trim();
    if (!extId || !env?.TMDB_BEARER_TOKEN) return null;
    const findUrl = `https://api.themoviedb.org/3/find/${encodeURIComponent(extId)}?external_source=${encodeURIComponent(externalSource)}&language=de-DE`;
    const findData = await cachedExternalFetchJson(findUrl, {
      headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` }
    }, 3500);
    if (!findData || typeof findData !== "object") return null;

    const trySeriesFirst = preferredTypeCode === "s";
    const tvHit = Array.isArray(findData.tv_results) && findData.tv_results.length > 0 ? findData.tv_results[0] : null;
    const movieHit = Array.isArray(findData.movie_results) && findData.movie_results.length > 0 ? findData.movie_results[0] : null;

    if (trySeriesFirst && tvHit?.id) {
      const det = await fetchSeriesDetails(env, Number(tvHit.id));
      if (det && det.id) {
        const yr = String(det.releaseDate || "").split("-")[0] || "k.A.";
        return {
          source: `TMDb (via ${externalSource})`,
          id: Number(det.id),
          tmdbId: Number(det.id),
          typeCode: "s",
          title: det.title,
          originalTitle: det.title,
          year: yr,
          releaseDate: det.releaseDate || "Keine Angabe",
          fsk: det.fsk || "FSK Keine Angabe",
          statusText: det.statusText || "Unbekannt",
          runtime: det.runtime || "Keine Angabe",
          genres: det.genres || "Serie",
          directors: det.directors || "Keine Angabe",
          casts: det.casts || "Keine Angabe",
          country: det.country || "k.A.",
          overview: det.overview || "",
          poster: det.poster_path ? `https://image.tmdb.org/t/p/w185${det.poster_path}` : (det.external_poster_url || ""),
          external_poster_url: det.external_poster_url || "",
          vote_average: det.vote_average || 0,
          numberOfSeasons: det.numberOfSeasons || 1,
          numberOfEpisodes: det.numberOfEpisodes || 0,
          seasons: det.seasons || [],
          confidence: 94
        };
      }
    }

    if (movieHit?.id && preferredTypeCode !== "s") {
      const det = await fetchMovieDetails(env, Number(movieHit.id));
      if (det && det.id) {
        const yr = String(det.releaseDate || "").split("-")[0] || "k.A.";
        return {
          source: `TMDb (via ${externalSource})`,
          id: Number(det.id),
          tmdbId: Number(det.id),
          typeCode: "m",
          title: det.title,
          originalTitle: det.title,
          year: yr,
          releaseDate: det.releaseDate || "Keine Angabe",
          fsk: det.fsk || "FSK Keine Angabe",
          runtime: det.runtime || "Keine Angabe",
          genres: det.genres || "Film",
          directors: det.directors || "Keine Angabe",
          casts: det.casts || "Keine Angabe",
          country: det.country || "k.A.",
          overview: det.overview || "",
          poster: det.poster_path ? `https://image.tmdb.org/t/p/w185${det.poster_path}` : (det.external_poster_url || ""),
          external_poster_url: det.external_poster_url || "",
          vote_average: det.vote_average || 0,
          confidence: 94
        };
      }
    }

    if (!trySeriesFirst && tvHit?.id && !preferredTypeCode) {
      const det = await fetchSeriesDetails(env, Number(tvHit.id));
      if (det && det.id) {
        const yr = String(det.releaseDate || "").split("-")[0] || "k.A.";
        return {
          source: `TMDb (via ${externalSource})`,
          id: Number(det.id),
          tmdbId: Number(det.id),
          typeCode: "s",
          title: det.title,
          originalTitle: det.title,
          year: yr,
          releaseDate: det.releaseDate || "Keine Angabe",
          fsk: det.fsk || "FSK Keine Angabe",
          statusText: det.statusText || "Unbekannt",
          runtime: det.runtime || "Keine Angabe",
          genres: det.genres || "Serie",
          directors: det.directors || "Keine Angabe",
          casts: det.casts || "Keine Angabe",
          country: det.country || "k.A.",
          overview: det.overview || "",
          poster: det.poster_path ? `https://image.tmdb.org/t/p/w185${det.poster_path}` : (det.external_poster_url || ""),
          external_poster_url: det.external_poster_url || "",
          vote_average: det.vote_average || 0,
          numberOfSeasons: det.numberOfSeasons || 1,
          numberOfEpisodes: det.numberOfEpisodes || 0,
          seasons: det.seasons || [],
          confidence: 92
        };
      }
    }
    return null;
  }

  const EPISODE_GROUP_TYPES = {
    1: "Original-Ausstrahlung",
    2: "Absolute Nummerierung",
    3: "DVD-Fassung",
    4: "Digital / Streaming-Fassung (Netflix)",
    5: "Story-Arc-Fassung",
    6: "TV-Schnittfassung",
    7: "Kabel-TV-Fassung"
  };

  // Bekannte Serien, bei denen im deutschsprachigen Raum IMMER die Streaming-/Netflix-Zählung genutzt wird:
  // 71446 = Haus des Geldes (La casa de papel) -> 5 Staffeln (13, 9, 8, 8, 10 Folgen) statt 2 Staffeln (15, 16)
  // 69050 = Chilling Adventures of Sabrina
  // 60572 = Pokémon
  const FORCE_EPISODE_GROUP_SERIES = new Set([71446, 69050, 60572]);

  /**
   * Kompaktes Versions-Label für das pinke/rote Datei-Badge im Staffel-Modal
   */
  function formatShortVersionLabel(groupType, groupName = "") {
    const name = String(groupName || "").toLowerCase();
    if (groupType === 4 || name.includes("netflix") || name.includes("edited") || name.includes("stream")) {
      return "Netflix-Fassung";
    }
    if (groupType === 6 || name.includes("tv")) return "TV-Schnitt";
    if (groupType === 3 || name.includes("dvd")) return "DVD-Fassung";
    return "Originalfassung";
  }

  /**
   * Bereinigt alte, überlange Episode-Group-Tags (z.B. "Parts (edited version) (Digital / Streaming-Fassung (Netflix))"
   * oder "Original Parts (Digital / Streaming-Fassung (Netflix))") zu einem kompakten Label ("Netflix-Fassung").
   */
  function normalizeCompactVersionTags(rawTags) {
    if (!rawTags) return "";
    const parts = String(rawTags)
      .split(/\s*·\s*/)
      .map(part => {
        const p = part.trim();
        if (!p) return "";
        if (/digital\s*\/\s*streaming-fassung|parts\s*\(edited\s*version\)|original\s*parts.*netflix|netflix\s*parts/i.test(p)) {
          return formatShortVersionLabel(4, p);
        }
        if (/tv-schnittfassung/i.test(p)) {
          return formatShortVersionLabel(6, p);
        }
        if (/dvd-fassung/i.test(p)) {
          return formatShortVersionLabel(3, p);
        }
        return p;
      })
      .filter(Boolean);
    return Array.from(new Set(parts)).join(" · ");
  }

  /**
   * Ermittelt automatisch die richtige Schnittfassung (z.B. Netflix vs. Original bei "Haus des Geldes")
   * und überschreibt seriesData.seasons mit den korrekten Folgenzahlen der jeweiligen Fassung!
   */
  async function resolveSeriesVersionOnTMDb(tmdbSeriesId, parsedItem, tmdbApiKeyOrEnv, customCachedFetchJson = null) {
    const baseUrl = "https://api.themoviedb.org/3";
    const targetSeason  = Number(parsedItem?.season || 1);
    const targetEpisode = Number(parsedItem?.episode || 1);
    const rawDurSec     = Number(parsedItem?.durationSec || parsedItem?.duration_sec || 0);
    const actualDurationMin = rawDurSec > 0 ? Math.round(rawDurSec / 60) : null;

    const isEnvObj = tmdbApiKeyOrEnv && typeof tmdbApiKeyOrEnv === "object";
    const bearerToken = isEnvObj ? tmdbApiKeyOrEnv.TMDB_BEARER_TOKEN : null;
    const apiKeyStr = typeof tmdbApiKeyOrEnv === "string" ? tmdbApiKeyOrEnv : (isEnvObj ? (tmdbApiKeyOrEnv.TMDB_API_KEY || "") : "");

    const cachedFetchJson = typeof customCachedFetchJson === "function"
      ? customCachedFetchJson
      : async (url) => {
          const cleanUrl = !apiKeyStr ? url.replace(/[?&]api_key=undefined/g, "") : url;
          const headers = { accept: "application/json" };
          if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
          return await cachedExternalFetchJson(cleanUrl, { headers });
        };

    const buildUrl = (pathWithLang) => {
      return apiKeyStr ? `${baseUrl}${pathWithLang}&api_key=${apiKeyStr}` : `${baseUrl}${pathWithLang}`;
    };

    // 1. Serien-Hauptdaten abrufen (Kopie erstellen, damit wir seasons sauber überschreiben können)
    const rawSeriesData = await cachedFetchJson(buildUrl(`/tv/${tmdbSeriesId}?language=de-DE`));
    if (!rawSeriesData) return null;
    const seriesData = {
      ...rawSeriesData,
      seasons: [...(rawSeriesData.seasons || [])]
    };

    const defaultRunTime = seriesData.episode_run_time?.[0] || null;
    const stdSeasonMeta  = seriesData.seasons.find(s => Number(s.season_number) === targetSeason);
    const existsInDefault = Boolean(stdSeasonMeta && targetEpisode <= Number(stdSeasonMeta.episode_count || 0));

    // 2. Laufzeit-Check (z.B. 45 Min. Netflix vs. 70 Min. Original Spanisch)
    let runtimeMismatch = false;
    let isDoubleEpisodeCut = false;

    if (actualDurationMin && defaultRunTime) {
      if (actualDurationMin >= defaultRunTime * 1.75) {
        isDoubleEpisodeCut = true;
        runtimeMismatch = true;
      } else if (Math.abs(actualDurationMin - defaultRunTime) >= 15) {
        runtimeMismatch = true;
      }
    }

    const shouldUseEpisodeGroups =
      FORCE_EPISODE_GROUP_SERIES.has(Number(tmdbSeriesId)) ||
      !existsInDefault ||
      runtimeMismatch;

    if (shouldUseEpisodeGroups) {
      // 3. Episode-Groups gezielt abfragen (dank Cache max. 1 Request pro Serie!)
      const groupsData = await cachedFetchJson(buildUrl(`/tv/${tmdbSeriesId}/episode_groups?language=de-DE`));
      const rawGroups = groupsData?.results || [];

      // Bei Typ-4-Gruppen NIEMALS eine Gruppe wählen, die "Original" im Namen trägt (z.B. "Original Parts"),
      // wenn es eine echte "edited" / "Netflix"-Gruppe gibt!
      const hasEditedOrNetflixGroup = rawGroups.some(g => {
        const n = `${g.name || ""} ${g.description || ""}`.toLowerCase();
        return (g.type === 4 && !n.includes("original")) || n.includes("edited") || n.includes("netflix");
      });
      const candidateGroups = hasEditedOrNetflixGroup
        ? rawGroups.filter(g => {
            const n = `${g.name || ""} ${g.description || ""}`.toLowerCase();
            return !(g.type === 4 && n.includes("original") && !n.includes("edited") && !n.includes("netflix"));
          })
        : rawGroups;

      // Sortiere Gruppen so, dass "Parts (edited version)" / "Netflix" (5 Staffeln à 13, 9, 8, 8, 10 Folgen)
      // IMMER gewinnt und NIEMALS "Original Parts" oder eine addierte 2-Staffel-Gruppe (22 Folgen) gewählt wird!
      const sortedGroups = [...candidateGroups].sort((a, b) => {
        const nameA = `${a.name || ""} ${a.description || ""}`.toLowerCase();
        const nameB = `${b.name || ""} ${b.description || ""}`.toLowerCase();

        // "Original Parts" abstrafen (+3), "edited" / "netflix" stark bevorzugen (-2)!
        const scoreA = (nameA.includes("edited") || nameA.includes("netflix") ? -2 : 0) + (nameA.includes("original") ? 3 : 0);
        const scoreB = (nameB.includes("edited") || nameB.includes("netflix") ? -2 : 0) + (nameB.includes("original") ? 3 : 0);
        if (scoreA !== scoreB) return scoreA - scoreB;

        const prio = { 4: 1, 6: 2, 3: 3, 1: 4, 2: 5 };
        if ((prio[a.type] || 9) !== (prio[b.type] || 9)) {
          return (prio[a.type] || 9) - (prio[b.type] || 9);
        }
        // Bevorzuge Gruppen mit mehr aufgeteilten Staffeln/Parts (z.B. 5 Parts statt 2 kombinierter Staffeln)
        const gCountDiff = Number(b.group_count || 0) - Number(a.group_count || 0);
        if (gCountDiff !== 0) return gCountDiff;
        return Number(b.episode_count || 0) - Number(a.episode_count || 0);
      });

      if (sortedGroups.length > 0) {
      // EISERNE REGEL ("Max. 1 aktive Gruppe / Keine Addition"):
      // Es darf pro Serie/Staffel IMMER NUR EINE EINZIGE aktive Gewinner-Gruppe verwendet werden!
      // Keine Addition von Untergruppen und kein Überschreiben mit einer 22-Folgen-Kombigruppe!
      for (const groupMeta of sortedGroups) {
        const groupDetails = await cachedFetchJson(buildUrl(`/tv/episode_group/${groupMeta.id}?language=de-DE`));
        if (!groupDetails?.groups || groupDetails.groups.length === 0) continue;

        // Jede Untergruppe (Part 1, Part 2, Part 3...) erhält strikt ihren fortlaufenden Index (idx + 1),
        // damit niemals "Season 1 Part 1" (13) und "Season 1 Part 2" (9) beide als season_number = 1 kollidieren oder addiert werden!
        const normalizedGroupSeasons = groupDetails.groups.map((g, idx) => {
          const seasonNum = idx + 1;
          const rawGroupEps = Array.isArray(g.episodes) ? g.episodes : [];
          const maxAllowedEpisodes = rawGroupEps.length;
          const eps = rawGroupEps.slice(0, maxAllowedEpisodes).map((ep, epIdx) => ({
            ...ep,
            season_number: seasonNum,
            episode_number: epIdx + 1,
            original_season_number: ep.season_number,
            original_episode_number: ep.episode_number
          }));

          return {
            id: g.id,
            name: g.name || `Staffel ${seasonNum}`,
            season_number: seasonNum,
            episode_count: maxAllowedEpisodes,
            episodes: eps.slice(0, maxAllowedEpisodes)
          };
        });

        const matchingGroupSeason = normalizedGroupSeasons.find(s => s.season_number === targetSeason);
        if (!matchingGroupSeason) continue;

        // Absolute Obergrenze der aktiven Gewinner-Gruppe (z.B. exakt 13 für Haus des Geldes S01)
        const maxAllowedEpisodes = Number(matchingGroupSeason.episode_count || matchingGroupSeason.episodes.length);
        const finalEpisodesList = matchingGroupSeason.episodes.slice(0, maxAllowedEpisodes);
        matchingGroupSeason.episodes = finalEpisodesList;
        matchingGroupSeason.episode_count = finalEpisodesList.length;

        const matchedEp = targetEpisode <= maxAllowedEpisodes
          ? (finalEpisodesList[targetEpisode - 1] || null)
          : null;

        // Überschreibe seriesData.seasons & Gesamtzahlen strikt mit dieser EINEN Gewinner-Gruppe (13, 9, 8, 8, 10)
        seriesData.seasons = normalizedGroupSeasons.map(s => ({
          id: s.id,
          name: s.name,
          season_number: s.season_number,
          episode_count: s.episode_count,
          air_date: s.episodes[0]?.air_date || null
        }));
        seriesData.number_of_seasons = normalizedGroupSeasons.length;
        seriesData.number_of_episodes = normalizedGroupSeasons.reduce((sum, s) => sum + s.episode_count, 0);
        seriesData.numberOfSeasons = seriesData.number_of_seasons;
        seriesData.numberOfEpisodes = seriesData.number_of_episodes;
        seriesData._normalizedGroupSeasons = normalizedGroupSeasons;

        const shortLabel = formatShortVersionLabel(groupMeta.type, groupMeta.name);

        // Falls targetEpisode innerhalb der Gewinner-Gruppe liegt (oder die Serie in FORCE_EPISODE_GROUP_SERIES ist),
        // brechen wir SOFORT nach dieser einen Gewinner-Gruppe ab!
        if (matchedEp || FORCE_EPISODE_GROUP_SERIES.has(Number(tmdbSeriesId))) {
          return {
            series: seriesData,
            episode: matchedEp,
            versionInfo: {
              isAlternativeOrder: true,
              versionType: EPISODE_GROUP_TYPES[groupMeta.type] || "Alternative Schnittfassung",
              versionLabel: shortLabel,
              groupName: groupMeta.name || "",
              groupId: groupMeta.id,
              seasonEpisodeCount: maxAllowedEpisodes,
              totalSeasons: seriesData.number_of_seasons,
              totalEpisodes: seriesData.number_of_episodes,
              detectedRuntimeMin: actualDurationMin
            }
          };
        }
      }
      }
    }

    // 4. Standard-Fallback: Normale TMDb-Staffel abrufen
    const seasonData = await cachedFetchJson(buildUrl(`/tv/${tmdbSeriesId}/season/${targetSeason}?language=de-DE`));
    const stdEp = (seasonData?.episodes || []).find(e => Number(e.episode_number) === targetEpisode) || null;

    let versionLabel = "Originalfassung";
    if (isDoubleEpisodeCut) {
      versionLabel = "Doppelfolgen-Schnitt";
    } else if (runtimeMismatch && actualDurationMin) {
      versionLabel = `TV-Schnitt (~${actualDurationMin} Min.)`;
    }

    return {
      series: seriesData,
      episode: stdEp,
      versionInfo: {
        isAlternativeOrder: false,
        versionType: isDoubleEpisodeCut ? "Doppelfolgen-Schnitt" : "Standard (Original)",
        versionLabel,
        groupId: null,
        seasonEpisodeCount: stdSeasonMeta?.episode_count || seasonData?.episodes?.length || null,
        totalSeasons: seriesData.number_of_seasons,
        totalEpisodes: seriesData.number_of_episodes,
        detectedRuntimeMin: actualDurationMin
      }
    };
  }

  /**
   * 2. TMDb-Kandidaten-Scoring (Verhindert falsche Doppelgänger / Mockbuster im selben Jahr wie "Arielle 2023")
   * Bewertet alle Treffer anhand von Jahr, Titel-Genauigkeit, Beschreibungs-Fingerabdruck (contextOverview vs. overview)
   * und Bekanntheits-Bonus (vote_count).
   */
  function pickBestTMDbMovie(results = [], parsedItem = {}) {
    if (!Array.isArray(results) || !results.length) return null;

    const targetTitle = String(parsedItem.title || parsedItem.cleanTitle || "")
      .replace(/^(?:disney'?s|disneys|marvel'?s|marvels|pixar'?s|pixars)\s+/i, "")
      .toLowerCase()
      .trim();
    const normTargetTitle = normalizeCompareString(targetTitle);
    const contextWords = Array.from(
      new Set(
        String(parsedItem.contextOverview || "")
          .toLowerCase()
          .split(/[^\p{L}\d]+/u)
          .filter(w => w.length >= 5)
      )
    );

    const scored = results.map(movie => {
      let score = 0;
      const tmdbTitle = String(movie.title || movie.name || "").toLowerCase().trim();
      const tmdbOrig  = String(movie.original_title || movie.original_name || "").toLowerCase().trim();
      const normTmdbTitle = normalizeCompareString(tmdbTitle);
      const normTmdbOrig  = normalizeCompareString(tmdbOrig);
      const relStr = String(movie.release_date || movie.first_air_date || "");
      const releaseYear = relStr ? parseInt(relStr.slice(0, 4), 10) : null;
      const yearDiff = (parsedItem.year && releaseYear) ? Math.abs(Number(parsedItem.year) - releaseYear) : 0;

      // 1. Jahres-Check
      if (parsedItem.year && releaseYear) {
        if (yearDiff === 0) score += 40;
        else if (yearDiff === 1) score += 15;
        else score -= yearDiff * 25; // Falsches Jahrzehnt hart abstrafen!
      }

      // 2. Exakter Titel-Vorrang & Artikel-Schutz (MODUL 3.1 - "The Gentlemen"-Fix):
      // Stimmt candidate.title oder candidate.original_title (case-insensitive) exakt mit dem Suchtitel überein und das Release-Jahr passt (±1 Jahr), vergib +150 Punkte Bonus!
      const isExactCaseInsensitive = (tmdbTitle === targetTitle || tmdbOrig === targetTitle);
      const isExactNormalized = Boolean(normTargetTitle && (normTmdbTitle === normTargetTitle || normTmdbOrig === normTargetTitle));
      if (isExactCaseInsensitive || isExactNormalized) {
        if (!parsedItem.year || (releaseYear && yearDiff <= 1)) {
          score += 150;
        } else {
          score += 50;
        }
      } else if (tmdbTitle.startsWith(targetTitle) || (normTargetTitle && normTmdbTitle.startsWith(normTargetTitle))) {
        score += 30;
      } else if (tmdbTitle.includes(targetTitle) || (normTargetTitle && normTmdbTitle.includes(normTargetTitle))) {
        score += 15;
      }

      // 3. Beschreibungs-Fingerabdruck (Telegram-Text vs. TMDb-Overview)
      if (contextWords.length > 0 && movie.overview) {
        const ovLower = String(movie.overview).toLowerCase();
        let matches = 0;
        for (const word of contextWords) {
          if (ovLower.includes(word)) matches++;
        }
        score += Math.min(matches * 20, 100);
      }

      // 4. Bekanntheits-Bonus (Schutz gegen billige Mockbuster im selben Jahr)
      const votes = Number(movie.vote_count || 0);
      if (votes > 1000) score += 35;
      else if (votes > 200) score += 20;
      else if (votes > 50) score += 10;
      else if (votes < 10) score -= 15;

      return { movie, score };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(b.movie?.popularity || 0) - Number(a.movie?.popularity || 0);
    });
    return scored[0].movie;
  }

  // MODUL 3.2: Entfernt eine eingebettete römische Zahl (I bis XIII) vor einem Untertitel (z.B. "Star Trek IX Nemesis" -> "Star Trek Nemesis")
  function stripRomanNumeralBeforeSubtitle(titleStr) {
    if (!titleStr) return "";
    const s = String(titleStr).trim();
    const m = s.match(/^(.+?)\s+\b(X?I{1,3}|I?V|VI{0,3}|I?X|XI{1,3})\b(?:\s*[:\-–—]\s*|\s+)(.{3,})$/i);
    if (!m) return "";
    return `${m[1].trim()} ${m[3].trim()}`.replace(/\s+/g, " ").trim();
  }

  /**
   * Sucht auf TMDb und prüft das Ergebnis auf Kontext-Konflikte (MODUL 3 inkl. +150 Exact-Bonus,
   * Römische-Zahlen-Retry, Dual-Source-Fallback & Miniserien-/search/tv-Fallback).
   */
  async function findOnTMDbWithValidation(parsedItem, tmdbApiKeyOrEnv, customCachedFetchJson = null) {
    if (!parsedItem) {
      return { status: "?", tmdbMatch: null, contextError: true, reviewReasonCode: "PARSER_AMBIGUITY", errorReason: "Kein Eintrag übergeben" };
    }
    const baseUrl = "https://api.themoviedb.org/3";
    let type = (parsedItem.mediaType === "tv" || parsedItem.isSeries || parsedItem.typeCode === "s") ? "tv" : "movie";
    // MODUL 2.5: Kein 40/50-Zeichen-Abschneider mitten im Wort! Limit auf 120 Zeichen / > 15 Wörter
    if (parsedItem.title && (String(parsedItem.title).length > 120 || String(parsedItem.title).split(/\s+/).length > 15)) {
      if (!parsedItem.contextOverview) parsedItem.contextOverview = String(parsedItem.title);
      parsedItem.title = String(parsedItem.title).split(/[:\n(]/)[0].trim().slice(0, 120);
    }
    if (parsedItem.cleanTitle && (String(parsedItem.cleanTitle).length > 120 || String(parsedItem.cleanTitle).split(/\s+/).length > 15)) {
      if (!parsedItem.contextOverview) parsedItem.contextOverview = String(parsedItem.cleanTitle);
      parsedItem.cleanTitle = String(parsedItem.cleanTitle).split(/[:\n(]/)[0].trim().slice(0, 120);
    }
    const rawQueryTitle = String(parsedItem.title || parsedItem.cleanTitle || "").trim();
    // 1. Doppelpunkt nach Römischen Zahlen erzwingen ("Star Trek II Der Zorn des Khan" -> "Star Trek II: Der Zorn des Khan")
    const queryTitle = rawQueryTitle.replace(/\b(X?I{1,3}|I?V|VI{0,3}|I?X|XI{1,3})\s+([A-ZÄÖÜ])/g, "$1: $2");
    const cleanedMovieQ = type === "movie" ? cleanMovieQuery(queryTitle) : queryTitle;

    const isEnvObj = tmdbApiKeyOrEnv && typeof tmdbApiKeyOrEnv === "object";
    const bearerToken = isEnvObj ? tmdbApiKeyOrEnv.TMDB_BEARER_TOKEN : null;
    const apiKeyStr = typeof tmdbApiKeyOrEnv === "string" ? tmdbApiKeyOrEnv : (isEnvObj ? (tmdbApiKeyOrEnv.TMDB_API_KEY || "") : "");

    const cachedFetchJson = typeof customCachedFetchJson === "function"
      ? customCachedFetchJson
      : async (url) => {
          const cleanUrl = !apiKeyStr ? url.replace(/[?&]api_key=undefined/g, "") : url;
          const headers = { accept: "application/json" };
          if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
          return await cachedExternalFetchJson(cleanUrl, { headers });
        };

    const buildUrl = (pathWithLang) => {
      return apiKeyStr ? `${baseUrl}${pathWithLang}&api_key=${apiKeyStr}` : `${baseUrl}${pathWithLang}`;
    };

    let tmdbHit = null;
    let fallbackWrongYearHit = null;

    const getHitYearDiff = (hit) => {
      if (!hit || !parsedItem.year) return 0;
      const rel = String(hit.release_date || hit.first_air_date || "");
      const y = rel ? parseInt(rel.slice(0, 4), 10) : null;
      return y ? Math.abs(Number(parsedItem.year) - y) : 0;
    };

    const acceptCandidateHit = (candidate) => {
      if (!candidate) return;
      if (getHitYearDiff(candidate) <= 2) {
        if (!tmdbHit) tmdbHit = candidate;
      } else if (!fallbackWrongYearHit) {
        fallbackWrongYearHit = candidate;
      }
    };

    // 1. Direkte ID
    if (parsedItem.tmdbId) {
      tmdbHit = await cachedFetchJson(buildUrl(`/${type}/${parsedItem.tmdbId}?language=de-DE`));
    }

    const isCandidateDach = (item) => {
      if (!item || typeof item !== "object") return false;
      if (String(item.original_language || "").toLowerCase() === "de") return true;
      const countries = Array.isArray(item.origin_country) ? item.origin_country : [];
      return countries.some(c => /^(?:DE|AT|CH|XG)$/i.test(String(c || "").trim()));
    };

    const pickBestHitBySmallestYearDiff = (resultsList, overrideTitle = null, searchType = type) => {
      if (!Array.isArray(resultsList) || resultsList.length === 0) return null;
      if (searchType === "movie") {
        return pickBestTMDbMovie(resultsList, overrideTitle ? { ...parsedItem, title: overrideTitle } : parsedItem);
      }
      const targetY = parsedItem.year ? Number(parsedItem.year) : null;
      const normQ = normalizeCompareString(overrideTitle || queryTitle);
      return [...resultsList].sort((a, b) => {
        const aTitle = normalizeCompareString(a.title || a.name || "");
        const bTitle = normalizeCompareString(b.title || b.name || "");
        const aOrig  = normalizeCompareString(a.original_title || a.original_name || "");
        const bOrig  = normalizeCompareString(b.original_title || b.original_name || "");
        const aExact = (aTitle === normQ || aOrig === normQ) ? 1 : 0;
        const bExact = (bTitle === normQ || bOrig === normQ) ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        if (targetY) {
          const aDate = String(a.release_date || a.first_air_date || "");
          const bDate = String(b.release_date || b.first_air_date || "");
          const aYear = aDate ? parseInt(aDate.slice(0, 4), 10) : 9999;
          const bYear = bDate ? parseInt(bDate.slice(0, 4), 10) : 9999;
          const aDiff = Math.abs(aYear - targetY);
          const bDiff = Math.abs(bYear - targetY);
          if (aDiff !== bDiff) return aDiff - bDiff;
        } else if (aExact && bExact) {
          const aDach = isCandidateDach(a);
          const bDach = isCandidateDach(b);
          if (aDach !== bDach) {
            const nonDach = aDach ? b : a;
            const dach = aDach ? a : b;
            const nonDachIsGlobalHit = (Number(nonDach.vote_count || 0) >= 150 || Number(nonDach.popularity || 0) >= 25) && Number(dach.vote_count || 0) < 30;
            if (!nonDachIsGlobalHit) return aDach ? -1 : 1;
          }
        }
        return Number(b.popularity || 0) - Number(a.popularity || 0);
      })[0];
    };

    const queryTmdbWithAndWithoutYear = async (qStr, searchType = type) => {
      if (!qStr || qStr.length < 2 || tmdbHit) return;
      const yp = searchType === "movie" ? "primary_release_year" : "first_air_date_year";
      if (parsedItem.year) {
        const resY = await cachedFetchJson(
          buildUrl(`/search/${searchType}?query=${encodeURIComponent(qStr)}&${yp}=${parsedItem.year}&language=de-DE`)
        );
        if (resY?.results?.length > 0) {
          const bestY = pickBestHitBySmallestYearDiff(resY.results, qStr, searchType);
          if (bestY) acceptCandidateHit({ ...bestY, _resolvedType: searchType });
        }
      }
      if (!tmdbHit) {
        const resNoY = await cachedFetchJson(
          buildUrl(`/search/${searchType}?query=${encodeURIComponent(qStr)}&language=de-DE`)
        );
        if (resNoY?.results?.length > 0) {
          const bestNoY = pickBestHitBySmallestYearDiff(resNoY.results, qStr, searchType);
          if (bestNoY) acceptCandidateHit({ ...bestNoY, _resolvedType: searchType });
        }
      }
    };

    // 2 & 3. Suche MIT Artikel & Original-Titel (MODUL 3.1: Artikel bleibt in den Hauptstufen erhalten!)
    if (!tmdbHit && queryTitle) {
      await queryTmdbWithAndWithoutYear(queryTitle, type);
      if (!tmdbHit && rawQueryTitle !== queryTitle) {
        await queryTmdbWithAndWithoutYear(rawQueryTitle, type);
      }
      if (!tmdbHit && cleanedMovieQ && cleanedMovieQ !== queryTitle.toLowerCase()) {
        await queryTmdbWithAndWithoutYear(cleanedMovieQ, type);
      }
    }

    // 3B. MODUL 3.2: Römische-Zahlen-Retry bei Jahres-Konflikt ("Star Trek IX Nemesis (2002)" -> "Star Trek Nemesis")
    if (!tmdbHit) {
      const romanStripped = stripRomanNumeralBeforeSubtitle(rawQueryTitle) || stripRomanNumeralBeforeSubtitle(queryTitle);
      if (romanStripped && romanStripped.toLowerCase() !== rawQueryTitle.toLowerCase()) {
        await queryTmdbWithAndWithoutYear(romanStripped, type);
      }
    }

    // 3C. MODUL 3.3: Dual-Source-Fallback (titleFromText <-> titleFromFileName, z.B. "Shootaut" vs. "Shootout")
    if (!tmdbHit) {
      const altSources = [parsedItem.titleFromFileName, parsedItem.titleFromText]
        .map(s => String(s || "").trim())
        .filter(s => s.length >= 2 && normalizeCompareString(s) !== normalizeCompareString(rawQueryTitle));
      for (const altSrc of altSources) {
        if (tmdbHit) break;
        await queryTmdbWithAndWithoutYear(altSrc, type);
        if (!tmdbHit) {
          const altRoman = stripRomanNumeralBeforeSubtitle(altSrc);
          if (altRoman) await queryTmdbWithAndWithoutYear(altRoman, type);
        }
      }
    }

    // 3D. Umlaut-Normalisierung (ae, oe, ue -> ä, ö, ü, z.B. "Rotkaeppchen.1954.mp4" -> "Rotkäppchen")
    if (!tmdbHit && /(?:ae|oe|ue)/i.test(queryTitle) && !/[äöüß]/i.test(queryTitle)) {
      const umlautTitle = queryTitle
        .replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü")
        .replace(/Ae/g, "Ä").replace(/Oe/g, "Ö").replace(/Ue/g, "Ü");
      await queryTmdbWithAndWithoutYear(umlautTitle, type);
    }

    // 4. Untertitel-Fallback / Bindestrich-Cutter ("Silk Road - Gebieter des Darknets" -> "Silk Road")
    if (!tmdbHit && (queryTitle.includes("-") || queryTitle.includes("–") || queryTitle.includes("—") || queryTitle.includes(":"))) {
      const shortTitle = queryTitle.split(/\s*[-–—:]\s*/)[0].trim();
      if (shortTitle.length >= 2 && shortTitle.toLowerCase() !== queryTitle.toLowerCase()) {
        await queryTmdbWithAndWithoutYear(shortTitle, type);
      }
    }

    // 4B. MODUL 3.1: Artikel-Fallback NUR im letzten Schritt, wenn die Suche MIT Artikel 0 passende Treffer geliefert hat!
    const articleRegex = /^(?:the|a|an|der|die|das|les|le|la)\s+/i;
    if (!tmdbHit && !fallbackWrongYearHit && articleRegex.test(queryTitle)) {
      const titleWithoutArticle = queryTitle.replace(articleRegex, "").trim();
      if (titleWithoutArticle.length >= 3) {
        await queryTmdbWithAndWithoutYear(titleWithoutArticle, type);
      }
    }

    // 4C. MODUL 3.5: Miniserien-Fallback auf /search/tv (z.B. "Halo Nightfall (2014)")
    if (!tmdbHit && type === "movie") {
      await queryTmdbWithAndWithoutYear(queryTitle, "tv");
      if (!tmdbHit && parsedItem.titleFromFileName && normalizeCompareString(parsedItem.titleFromFileName) !== normalizeCompareString(queryTitle)) {
        await queryTmdbWithAndWithoutYear(parsedItem.titleFromFileName, "tv");
      }
      if (tmdbHit && tmdbHit._resolvedType === "tv") {
        type = "tv";
      }
    }

    // Falls nur ein Treffer aus einem falschen Jahrzehnt (> 2 Jahre Abweichung) existierte, diesen für die Konflikt-Meldung heranziehen
    if (!tmdbHit && fallbackWrongYearHit) {
      tmdbHit = fallbackWrongYearHit;
    }

    if (!tmdbHit) {
      return {
        status: "?",
        tmdbMatch: null,
        contextError: true,
        reviewReasonCode: "TMDB_NOT_FOUND",
        errorReason: "Kein Treffer auf TMDb gefunden"
      };
    }

    // 5. Harte Sperre gegen falsche Jahrzehnte (Jahr im Post vs. echtes TMDb-Jahr > 2 Jahre Abweichung blockieren + Teil-Nummer prüfen)
    const releaseDate = tmdbHit.release_date || tmdbHit.first_air_date || "";
    const tmdbYear    = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) : null;
    const yearDiff    = (parsedItem.year && tmdbYear) ? Math.abs(Number(parsedItem.year) - tmdbYear) : 0;

    const trailingNumMatch = queryTitle.match(/\b([2-9])\s*$/);
    const seqNum = trailingNumMatch ? trailingNumMatch[1] : null;
    const tmdbTitlesCombined = `${tmdbHit.title || ""} ${tmdbHit.original_title || ""} ${tmdbHit.name || ""} ${tmdbHit.original_name || ""}`.toLowerCase();
    const sequelMismatch = Boolean(seqNum && !tmdbTitlesCombined.includes(seqNum) && yearDiff >= 1);

    if (yearDiff > 2 || sequelMismatch) {
      const reasonCode = (sequelMismatch && yearDiff <= 2) ? "SEQUEL_CONFLICT" : "YEAR_CONFLICT";
      return {
        status: "?",
        tmdbMatch: tmdbHit,
        contextError: true,
        reviewReasonCode: reasonCode,
        errorReason: `Jahres-/Kontext-Sperre: Post nennt "${queryTitle} (${parsedItem.year || "o.J."})", aber TMDb-Treffer "${tmdbHit.title || tmdbHit.name}" ist von ${tmdbYear || "unbekannt"} (Abweichung: ${yearDiff} Jahre).`
      };
    }

    return {
      status: "OK",
      tmdbMatch: tmdbHit,
      resolvedType: tmdbHit._resolvedType || type,
      contextError: false,
      reviewReasonCode: null,
      errorReason: null
    };
  }

  // Gold-Master Regel 10: Mehrstufige TMDb-Suche mit MODUL 3 (Exakt-Bonus +150, Römische-Zahlen-Retry, Dual-Source & Miniserien-Fallback)
  async function findOnTMDb(env, parsedItem) {
    if (!parsedItem || (!parsedItem.tmdbId && !parsedItem.title && !parsedItem.cleanTitle)) return null;
    const baseUrl = "https://api.themoviedb.org/3";
    const type = (parsedItem.mediaType === "tv" || parsedItem.isSeries || parsedItem.typeCode === "s") ? "tv" : "movie";
    if (parsedItem.title && (String(parsedItem.title).length > 120 || String(parsedItem.title).split(/\s+/).length > 15)) {
      if (!parsedItem.contextOverview) parsedItem.contextOverview = String(parsedItem.title);
      parsedItem.title = String(parsedItem.title).split(/[:\n(]/)[0].trim().slice(0, 120);
    }
    if (parsedItem.cleanTitle && (String(parsedItem.cleanTitle).length > 120 || String(parsedItem.cleanTitle).split(/\s+/).length > 15)) {
      if (!parsedItem.contextOverview) parsedItem.contextOverview = String(parsedItem.cleanTitle);
      parsedItem.cleanTitle = String(parsedItem.cleanTitle).split(/[:\n(]/)[0].trim().slice(0, 120);
    }
    const rawQueryTitle = String(parsedItem.title || parsedItem.cleanTitle || "").trim();
    const queryTitle = rawQueryTitle.replace(/\b(X?I{1,3}|I?V|VI{0,3}|I?X|XI{1,3})\s+([A-ZÄÖÜ])/g, "$1: $2");
    const cleanedMovieQ = type === "movie" ? cleanMovieQuery(queryTitle) : queryTitle;
    const headers = {
      accept: "application/json",
      Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}`
    };

    // STUFE 1: Direkte ID-Abfrage
    if (parsedItem.tmdbId) {
      const directHit = await cachedExternalFetchJson(`${baseUrl}/${type}/${parsedItem.tmdbId}?language=de-DE`, { headers });
      if (directHit && directHit.id) return { ...directHit, _resolvedType: type, _stage: "stage1_id" };
    }

    const isDachItem = (item) => {
      if (!item || typeof item !== "object") return false;
      if (String(item.original_language || "").toLowerCase() === "de") return true;
      const countries = Array.isArray(item.origin_country) ? item.origin_country : [];
      return countries.some(c => /^(?:DE|AT|CH|XG)$/i.test(String(c || "").trim()));
    };

    const isYearAcceptable = (hit) => {
      if (!hit || !parsedItem.year) return true;
      const rel = String(hit.release_date || hit.first_air_date || "");
      const y = rel ? parseInt(rel.slice(0, 4), 10) : null;
      return !y || Math.abs(Number(parsedItem.year) - y) <= 2;
    };

    let fallbackWrongDecadeHit = null;
    let totalRawResultsSeen = 0;

    const searchTmdbStage = async (qStr, includeYear = true, searchType = type) => {
      if (!qStr || qStr.length < 1) return null;
      const params = new URLSearchParams({
        query: qStr,
        language: "de-DE",
        page: "1"
      });
      if (includeYear && parsedItem.year) {
        const yp = searchType === "movie" ? "primary_release_year" : "first_air_date_year";
        params.set(yp, String(parsedItem.year));
      }
      const data = await cachedExternalFetchJson(`${baseUrl}/search/${searchType}?${params.toString()}`, { headers });
      if (!Array.isArray(data?.results) || data.results.length === 0) return null;
      totalRawResultsSeen += data.results.length;
      if (searchType === "movie") {
        const bestMovie = pickBestTMDbMovie(data.results, { ...parsedItem, title: qStr });
        const sortedMovies = bestMovie
          ? [bestMovie, ...data.results.filter(r => r && r.id !== bestMovie.id)]
          : data.results;
        const candidate = { ...(bestMovie || data.results[0]), _resolvedType: searchType, _allResults: sortedMovies.slice(0, 6) };
        if (isYearAcceptable(candidate)) return candidate;
        if (!fallbackWrongDecadeHit) fallbackWrongDecadeHit = candidate;
        return null;
      }
      const normQ = normalizeCompareString(qStr);
      const sortedResults = [...data.results].sort((a, b) => {
        const aTitle = normalizeCompareString(a.title || a.name || "");
        const bTitle = normalizeCompareString(b.title || b.name || "");
        const aOrig  = normalizeCompareString(a.original_title || a.original_name || "");
        const bOrig  = normalizeCompareString(b.original_title || b.original_name || "");
        const aExact = (aTitle === normQ || aOrig === normQ) ? 1 : 0;
        const bExact = (bTitle === normQ || bOrig === normQ) ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        if (!parsedItem.year && aExact && bExact) {
          const aDach = isDachItem(a);
          const bDach = isDachItem(b);
          if (aDach !== bDach) {
            const nonDach = aDach ? b : a;
            const dach = aDach ? a : b;
            const nonDachIsGlobalHit = (Number(nonDach.vote_count || 0) >= 150 || Number(nonDach.popularity || 0) >= 25) && Number(dach.vote_count || 0) < 30;
            if (!nonDachIsGlobalHit) return aDach ? -1 : 1;
          }
        }
        return Number(b.popularity || 0) - Number(a.popularity || 0);
      });
      const candidate = { ...sortedResults[0], _resolvedType: searchType, _allResults: sortedResults.slice(0, 6) };
      if (isYearAcceptable(candidate)) return candidate;
      if (!fallbackWrongDecadeHit) fallbackWrongDecadeHit = candidate;
      return null;
    };

    // STUFE 2: Suche mit Titel + Jahr
    if (parsedItem.year && queryTitle) {
      const hitWithYear = await searchTmdbStage(queryTitle, true, type);
      if (hitWithYear) return { ...hitWithYear, _stage: "stage2_title_year" };
      if (rawQueryTitle !== queryTitle) {
        const hitRawYear = await searchTmdbStage(rawQueryTitle, true, type);
        if (hitRawYear) return { ...hitRawYear, _stage: "stage2_raw_year" };
      }
      if (cleanedMovieQ && cleanedMovieQ !== queryTitle.toLowerCase()) {
        const hitCleanWithYear = await searchTmdbStage(cleanedMovieQ, true, type);
        if (hitCleanWithYear) return { ...hitCleanWithYear, _stage: "stage2_clean_movie_year" };
      }
    }

    // STUFE 3A: Suche OHNE Jahr
    if (queryTitle) {
      const hitWithoutYear = await searchTmdbStage(queryTitle, false, type);
      if (hitWithoutYear) return { ...hitWithoutYear, _stage: "stage3a_title" };
      if (cleanedMovieQ && cleanedMovieQ !== queryTitle.toLowerCase()) {
        const hitCleanWithoutYear = await searchTmdbStage(cleanedMovieQ, false, type);
        if (hitCleanWithoutYear) return { ...hitCleanWithoutYear, _stage: "stage3a_clean_movie" };
      }
    }

    // STUFE 3B: MODUL 3.2 Römische-Zahlen-Retry bei Jahres-Konflikt ("Star Trek IX Nemesis (2002)" -> "Star Trek Nemesis")
    const romanStripped = stripRomanNumeralBeforeSubtitle(rawQueryTitle) || stripRomanNumeralBeforeSubtitle(queryTitle);
    if (romanStripped && romanStripped.toLowerCase() !== rawQueryTitle.toLowerCase()) {
      if (parsedItem.year) {
        const hitRomanY = await searchTmdbStage(romanStripped, true, type);
        if (hitRomanY) return { ...hitRomanY, _stage: "stage3b_roman_retry_year" };
      }
      const hitRomanNoY = await searchTmdbStage(romanStripped, false, type);
      if (hitRomanNoY) return { ...hitRomanNoY, _stage: "stage3b_roman_retry" };
    }

    // STUFE 3C: MODUL 3.3 Dual-Source-Fallback (titleFromText <-> titleFromFileName, z.B. "Shootaut" vs. "Shootout")
    const altSources = [parsedItem.titleFromFileName, parsedItem.titleFromText]
      .map(s => String(s || "").trim())
      .filter(s => s.length >= 2 && normalizeCompareString(s) !== normalizeCompareString(rawQueryTitle));
    for (const altSrc of altSources) {
      if (parsedItem.year) {
        const hitAltY = await searchTmdbStage(altSrc, true, type);
        if (hitAltY) return { ...hitAltY, _stage: "stage3c_dualsource_year" };
      }
      const hitAltNoY = await searchTmdbStage(altSrc, false, type);
      if (hitAltNoY) return { ...hitAltNoY, _stage: "stage3c_dualsource" };
      const altRoman = stripRomanNumeralBeforeSubtitle(altSrc);
      if (altRoman) {
        const hitAltRoman = await searchTmdbStage(altRoman, Boolean(parsedItem.year), type);
        if (hitAltRoman) return { ...hitAltRoman, _stage: "stage3c_dualsource_roman" };
      }
    }

    // STUFE 3D: Suche mit Originaltitel
    if (parsedItem.originalTitle && parsedItem.originalTitle !== queryTitle) {
      const hitOriginal = await searchTmdbStage(parsedItem.originalTitle, false, type);
      if (hitOriginal) return { ...hitOriginal, _stage: "stage3d_original" };
    }

    // STUFE 3E: Umlaut-Normalisierung ("Rotkaeppchen.1954.mp4" -> "Rotkäppchen")
    if (/(?:ae|oe|ue)/i.test(queryTitle) && !/[äöüß]/i.test(queryTitle)) {
      const umlautTitle = queryTitle
        .replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü")
        .replace(/Ae/g, "Ä").replace(/Oe/g, "Ö").replace(/Ue/g, "Ü");
      if (parsedItem.year) {
        const hitUmlautYear = await searchTmdbStage(umlautTitle, true, type);
        if (hitUmlautYear) return { ...hitUmlautYear, _stage: "stage3e_umlaut_year" };
      }
      const hitUmlaut = await searchTmdbStage(umlautTitle, false, type);
      if (hitUmlaut) return { ...hitUmlaut, _stage: "stage3e_umlaut" };
    }

    // STUFE 4: Untertitel-Fallback / Bindestrich-Split ("Silk Road - Gebieter des Darknets" -> "Silk Road")
    if (queryTitle.includes("-") || queryTitle.includes("–") || queryTitle.includes("—") || queryTitle.includes(":")) {
      const mainTitle = queryTitle.split(/\s*[-–—:]\s*/)[0].trim();
      if (mainTitle.length >= 2 && mainTitle.toLowerCase() !== queryTitle.toLowerCase()) {
        if (parsedItem.year) {
          const hitSplitYear = await searchTmdbStage(mainTitle, true, type);
          if (hitSplitYear) return { ...hitSplitYear, _stage: "stage4_split_year" };
        }
        const hitSplit = await searchTmdbStage(mainTitle, false, type);
        if (hitSplit) return { ...hitSplit, _stage: "stage4_split" };
      }
    }

    // STUFE 4B: MODUL 3.1 Artikel-Fallback NUR wenn die Suche MIT Artikel 0 Treffer geliefert hat!
    const articleRegex = /^(?:the|a|an|der|die|das|les|le|la)\s+/i;
    if (totalRawResultsSeen === 0 && articleRegex.test(queryTitle)) {
      const titleWithoutArticle = queryTitle.replace(articleRegex, "").trim();
      if (titleWithoutArticle.length >= 3) {
        if (parsedItem.year) {
          const hitArtYear = await searchTmdbStage(titleWithoutArticle, true, type);
          if (hitArtYear) return { ...hitArtYear, _stage: "stage4b_article_year" };
        }
        const hitArt = await searchTmdbStage(titleWithoutArticle, false, type);
        if (hitArt) return { ...hitArt, _stage: "stage4b_article" };
      }
    }

    // STUFE 4C: MODUL 3.5 Miniserien-Fallback auf /search/tv (z.B. "Halo Nightfall (2014)")
    if (type === "movie") {
      if (parsedItem.year) {
        const hitTvY = await searchTmdbStage(queryTitle, true, "tv");
        if (hitTvY) return { ...hitTvY, _resolvedType: "tv", _stage: "stage4c_miniseries_tv_year" };
      }
      const hitTvNoY = await searchTmdbStage(queryTitle, false, "tv");
      if (hitTvNoY) return { ...hitTvNoY, _resolvedType: "tv", _stage: "stage4c_miniseries_tv" };
    }

    return fallbackWrongDecadeHit ? { ...fallbackWrongDecadeHit, _stage: "stage_wrong_decade_conflict" } : null;
  }

  // ============================================================================
  // MULTI-API FALLBACK KASKADE: 1. TMDb -> 2. OMDb -> 3. Wikidata -> 4. MediaWiki (Wikipedia DE/EN)
  // ============================================================================
  async function fetchOmdbFallback(env, title, year = null, typeCode = "m", imdbId = null) {
    const cleanQ = String(title || "").replace(/\s*\(\d{4}\)$/, "").trim();
    if (!cleanQ && !imdbId) return null;
    const omdbKey = env?.OMDB_API_KEY || env?.OMDB_KEY || "trilogy";
    const omdbType = typeCode === "s" ? "series" : "movie";
    const queryParams = new URLSearchParams({ apikey: omdbKey, plot: "short" });
    if (imdbId) {
      queryParams.set("i", String(imdbId));
    } else {
      queryParams.set("t", cleanQ);
      queryParams.set("type", omdbType);
      if (year) queryParams.set("y", String(year));
    }

    let data = await cachedExternalFetchJson(`https://www.omdbapi.com/?${queryParams.toString()}`, {}, 3500);
    if ((!data || data.Response === "False") && year && !imdbId) {
      queryParams.delete("y");
      data = await cachedExternalFetchJson(`https://www.omdbapi.com/?${queryParams.toString()}`, {}, 3500);
    }
    if (!data || data.Response === "False" || !data.Title) return null;

    const resolvedTc = data.Type === "series" ? "s" : typeCode;
    // Zuerst versuchen, die gefundene IMDb-ID direkt in eine echte TMDb-ID (1..99.999.999) aufzulösen!
    if (data.imdbID && env?.TMDB_BEARER_TOKEN) {
      const tmdbBridged = await resolveExternalIdToTmdb(env, data.imdbID, "imdb_id", resolvedTc).catch(() => null);
      if (tmdbBridged && tmdbBridged.id && tmdbBridged.id < 8000000) {
        return tmdbBridged;
      }
    }

    // Disjunkter 100M-Block für OMDb/IMDb (100.000.000 .. 199.999.999) OHNE Modulo-390k-Kürzung!
    // IMDb-IDs sind global über Filme und Serien hinweg eindeutig (tt1234567 -> 101234567).
    const rawImdbDigits = data.imdbID ? parseInt(String(data.imdbID).replace(/\D/g, ""), 10) : 0;
    const omdbId = rawImdbDigits > 0
      ? (100000000 + (rawImdbDigits % 99999999))
      : hashStringToPositiveInt(`omdb_${resolvedTc}_${data.Title}_${data.Year}`, 190000000, 9999999);
    const parsedYear = String(data.Year || "").match(/\d{4}/)?.[0] || (year ? String(year) : "k.A.");
    const posterUrl = data.Poster && data.Poster !== "N/A" ? String(data.Poster) : "";
    const voteAvg = parseFloat(data.imdbRating) || 0;

    return {
      source: "OMDb",
      id: omdbId,
      imdbId: data.imdbID || null,
      typeCode: resolvedTc,
      title: String(data.Title).trim(),
      originalTitle: String(data.Title).trim(),
      year: parsedYear,
      releaseDate: parsedYear !== "k.A." ? `${parsedYear}-01-01` : "Keine Angabe",
      runtime: data.Runtime && data.Runtime !== "N/A" ? data.Runtime.replace("min", "Min.") : "Keine Angabe",
      genres: data.Genre && data.Genre !== "N/A" ? data.Genre : (resolvedTc === "s" ? "Serie" : "Film"),
      directors: data.Director && data.Director !== "N/A" ? data.Director : "Keine Angabe",
      casts: data.Actors && data.Actors !== "N/A" ? data.Actors : "Keine Angabe",
      country: data.Country && data.Country !== "N/A" ? data.Country : "k.A.",
      overview: data.Plot && data.Plot !== "N/A" ? data.Plot : "Metadaten über OMDb Fallback geladen.",
      poster: posterUrl,
      external_poster_url: posterUrl,
      vote_average: voteAvg,
      confidence: 82
    };
  }

  const PERSON_OR_NON_MEDIA_DESC_REGEX = /\b(?:schauspieler|schauspielerin|filmschauspieler|filmschauspielerin|fernsehschauspieler|theaterschauspieler|actor|actress|regisseur|regisseurin|filmregisseur|director|drehbuchautor|screenwriter|filmproduzent|produzent|producer|synchronsprecher|voice actor|kameramann|komponist|composer|sänger|sängerin|singer|musiker|musician|band|politiker|politician|sportler|fußball|footballer|autor|schriftsteller|writer|journalist|moderator|unternehmer|wissenschaftler|militärperson|person|mensch|human|biografie|biography|unternehmen|company|videospiel|video game|album|lied|song|single)\b/i;
  const WIKIDATA_BLOCKED_INSTANCE_IDS = new Set([
    "Q5",        // Mensch / Human (Schauspieler, Regisseur, etc.)
    "Q215627",   // Person
    "Q95074",    // Fiktive Figur
    "Q15632617", // Fiktiver Mensch
    "Q482994",   // Musikalbum
    "Q7366",     // Lied / Song
    "Q7889",     // Videospiel
    "Q43229",    // Organisation / Unternehmen
    "Q515",      // Stadt
    "Q6256"      // Staat / Land
  ]);

  async function fetchWikidataFallback(env, title, year = null, typeCode = "m") {
    const cleanQ = String(title || "").replace(/\s*\(\d{4}\)$/, "").trim();
    if (!cleanQ || cleanQ.length < 2) return null;

    const searchLangs = ["de", "en"];
    for (const lang of searchLangs) {
      const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(cleanQ)}&language=${lang}&uselang=de&type=item&limit=6&format=json&origin=*`;
      const searchData = await cachedExternalFetchJson(searchUrl, {
        headers: { "User-Agent": "TelePortMediaBot/2.0 (CloudflareWorker)" }
      }, 3500);
      const hits = searchData?.search || [];
      if (!Array.isArray(hits) || hits.length === 0) continue;

      // Strikter Filter: Personen/Schauspieler sofort ausschließen, nur echte Film/Serien-Beschreibungen zulassen
      const mediaHits = hits.filter(h => {
        const desc = String(h.description || "").toLowerCase();
        if (!desc) return false;
        if (PERSON_OR_NON_MEDIA_DESC_REGEX.test(desc)) return false;
        return /\b(?:film|spielfilm|fernsehfilm|kinofilm|kurzfilm|dokumentarfilm|animationsfilm|serie|fernsehserie|miniserie|tv-serie|television series|motion picture|movie|anime|sitcom|telenovela|mehrteiler)\b/i.test(desc);
      });
      if (mediaHits.length === 0) continue;

      for (const candidateItem of mediaHits) {
        if (!candidateItem || !candidateItem.id) continue;
        const entityId = candidateItem.id;
        const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(entityId)}&props=claims|labels|descriptions&languages=de|en&format=json&origin=*`;
        const entityData = await cachedExternalFetchJson(entityUrl, {
          headers: { "User-Agent": "TelePortMediaBot/2.0 (CloudflareWorker)" }
        }, 3500);
        const ent = entityData?.entities?.[entityId];
        if (!ent) continue;

        const claims = ent.claims || {};
        // Prüfe P31 (instance of): Niemals Q5 (Mensch/Schauspieler) oder gesperrte Klassen durchlassen!
        const instanceIds = (claims.P31 || [])
          .map(c => c?.mainsnak?.datavalue?.value?.id)
          .filter(Boolean);
        if (instanceIds.some(id => WIKIDATA_BLOCKED_INSTANCE_IDS.has(id))) {
          continue;
        }

        const labelDe = ent.labels?.de?.value || ent.labels?.en?.value || candidateItem.label || cleanQ;
        const descDe = ent.descriptions?.de?.value || ent.descriptions?.en?.value || candidateItem.description || "Wikidata-Medieneintrag";
        const descEn = ent.descriptions?.en?.value || "";
        if (PERSON_OR_NON_MEDIA_DESC_REGEX.test(`${descDe} ${descEn}`)) {
          continue;
        }

        // Prüfe ob Wikidata direkt eine offizielle TMDb-ID gespeichert hat (P4947 = TMDb Movie ID, P4983 = TMDb TV Series ID)
        const tmdbMovieClaim = claims.P4947?.[0]?.mainsnak?.datavalue?.value;
        const tmdbTvClaim = claims.P4983?.[0]?.mainsnak?.datavalue?.value;
        if (tmdbMovieClaim && /^\d+$/.test(String(tmdbMovieClaim))) {
          const det = await fetchMovieDetails(env, Number(tmdbMovieClaim));
          if (det && det.id) {
            const yr = String(det.releaseDate || "").split("-")[0] || (year ? String(year) : "k.A.");
            return {
              source: "Wikidata->TMDb",
              id: Number(det.id),
              tmdbId: Number(det.id),
              typeCode: "m",
              title: det.title,
              originalTitle: det.title,
              year: yr,
              releaseDate: det.releaseDate || "Keine Angabe",
              runtime: det.runtime || "Keine Angabe",
              genres: det.genres || "Film",
              directors: det.directors || "Keine Angabe",
              casts: det.casts || "Keine Angabe",
              country: det.country || "k.A.",
              overview: det.overview || "",
              poster: det.poster_path ? `https://image.tmdb.org/t/p/w185${det.poster_path}` : "",
              external_poster_url: det.external_poster_url || "",
              vote_average: det.vote_average || 0,
              confidence: 88
            };
          }
        }
        if (tmdbTvClaim && /^\d+$/.test(String(tmdbTvClaim))) {
          const det = await fetchSeriesDetails(env, Number(tmdbTvClaim));
          if (det && det.id) {
            const yr = String(det.releaseDate || "").split("-")[0] || (year ? String(year) : "k.A.");
            return {
              source: "Wikidata->TMDb",
              id: Number(det.id),
              tmdbId: Number(det.id),
              typeCode: "s",
              title: det.title,
              originalTitle: det.title,
              year: yr,
              releaseDate: det.releaseDate || "Keine Angabe",
              runtime: det.runtime || "Keine Angabe",
              genres: det.genres || "Serie",
              directors: det.directors || "Keine Angabe",
              casts: det.casts || "Keine Angabe",
              country: det.country || "k.A.",
              overview: det.overview || "",
              poster: det.poster_path ? `https://image.tmdb.org/t/p/w185${det.poster_path}` : "",
              external_poster_url: det.external_poster_url || "",
              vote_average: det.vote_average || 0,
              confidence: 88
            };
          }
        }

        // Prüfe P345 (IMDb-ID in Wikidata) -> Brücke auf echte TMDb-ID!
        const imdbClaim = claims.P345?.[0]?.mainsnak?.datavalue?.value;
        if (imdbClaim && /^tt\d+$/i.test(String(imdbClaim).trim()) && env?.TMDB_BEARER_TOKEN) {
          const isTvDescPrelim = /(?:serie|fernsehserie|miniserie|staffel|tv series|television series)/i.test(descDe);
          const bridged = await resolveExternalIdToTmdb(env, String(imdbClaim).trim(), "imdb_id", isTvDescPrelim ? "s" : typeCode).catch(() => null);
          if (bridged && bridged.id && bridged.id < 8000000) {
            return bridged;
          }
        }

        // Falls keine TMDb-ID verknüpft ist, nur zulassen wenn P577 (Veröffentlichungsdatum), P57 (Regisseur), P136 (Genre) oder P345 (IMDb) existiert
        const hasMediaClaims = Boolean(claims.P577 || claims.P57 || claims.P136 || claims.P161 || claims.P345);
        if (!hasMediaClaims) continue;

        const pubTime = claims.P577?.[0]?.mainsnak?.datavalue?.value?.time || "";
        const wdYear = pubTime.match(/([12]\d{3})/)?.[1] || String(candidateItem.description || "").match(/\b(19\d{2}|20[0-3]\d)\b/)?.[1] || (year ? String(year) : "k.A.");
        const commonsFile = claims.P18?.[0]?.mainsnak?.datavalue?.value || "";
        const posterUrl = commonsFile
          ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(commonsFile))}?width=400`
          : "";
        const isTvDesc = /(?:serie|fernsehserie|miniserie|staffel|tv series|television series)/i.test(descDe);
        // Disjunkter 500M-Block für Wikidata (500.000.000 .. 599.999.999) OHNE Modulo-290k-Kürzung!
        const qDigits = parseInt(String(entityId).replace(/\D/g, ""), 10) || hashStringToPositiveInt(labelDe, 0, 99999999);
        const wikidataIdNum = 500000000 + (qDigits % 99999999);

        return {
          source: "Wikidata",
          id: wikidataIdNum,
          wikidataId: entityId,
          typeCode: isTvDesc ? "s" : typeCode,
          title: String(labelDe).trim(),
          originalTitle: String(ent.labels?.en?.value || labelDe).trim(),
          year: wdYear,
          releaseDate: wdYear !== "k.A." ? `${wdYear}-01-01` : "Keine Angabe",
          runtime: "Keine Angabe",
          genres: isTvDesc ? "Serie (Wikidata)" : "Film (Wikidata)",
          directors: "Keine Angabe",
          casts: "Keine Angabe",
          country: "k.A.",
          overview: `${descDe} [Quelle: Wikidata ${entityId}]`,
          poster: posterUrl,
          external_poster_url: posterUrl,
          vote_average: 0,
          confidence: 76
        };
      }
    }
    return null;
  }

  async function fetchMediaWikiFallback(env, title, year = null, typeCode = "m") {
    const cleanQ = String(title || "").replace(/\s*\(\d{4}\)$/, "").trim();
    if (!cleanQ || cleanQ.length < 2) return null;

    const wikis = [
      { host: "de.wikipedia.org", suffix: typeCode === "s" ? " Fernsehserie" : " Film" },
      { host: "en.wikipedia.org", suffix: typeCode === "s" ? " TV series" : " film" }
    ];

    for (const w of wikis) {
      const searchStr = `${cleanQ}${year ? " " + year : ""}${w.suffix}`.trim();
      const apiUrl = `https://${w.host}/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(searchStr)}&gsrlimit=4&prop=pageimages|extracts&exintro=1&explaintext=1&exchars=520&piprop=thumbnail|original&pithumbsize=400&format=json&origin=*`;
      const data = await cachedExternalFetchJson(apiUrl, {
        headers: { "User-Agent": "TelePortMediaBot/2.0 (CloudflareWorker)" }
      }, 3500);
      const pagesObj = data?.query?.pages;
      if (!pagesObj || typeof pagesObj !== "object") continue;

      const pages = Object.values(pagesObj).sort((a, b) => Number(a.index || 99) - Number(b.index || 99));
      for (const p of pages) {
        if (!p || !p.title) continue;
        const extract = String(p.extract || "").trim();
        const rawTitle = String(p.title || "");
        if (!extract || extract.length < 25) continue;

        // Biografien & Schauspieler-Artikel (z. B. "(* 14. Mai ... ist ein US-amerikanischer Schauspieler)") strikt ablehnen!
        const firstSentence = extract.split(/\.\s+/)[0] || extract.slice(0, 220);
        if (
          /\(\*\s*\d{1,2}\.\s*[A-Za-zäöüÄÖÜ]+/i.test(firstSentence) ||
          /\bborn\s+(?:[A-Z][a-z]+\s+\d{1,2}|\d{1,2}\s+[A-Z][a-z]+)/i.test(firstSentence) ||
          PERSON_OR_NON_MEDIA_DESC_REGEX.test(firstSentence) ||
          /\b(?:schauspieler|schauspielerin|actor|actress|regisseur|filmproduzent|drehbuchautor|synchronsprecher|biografie|filmografie)\b/i.test(rawTitle)
        ) {
          continue;
        }

        const isMediaArticle = /\b(?:film|spielfilm|fernsehfilm|kinofilm|dokumentarfilm|animationsfilm|fernsehserie|miniserie|serie|staffel|motion picture|television series|tv series|directed by|regie)\b/i.test(firstSentence)
                            || /\((?:film|fernsehserie|serie|miniserie|\d{4}\s+film|tv\s+series)\)/i.test(rawTitle);
        if (!isMediaArticle) continue;

        const cleanedWikiTitle = rawTitle
          .replace(/\s*\((?:Film|Fernsehserie|Serie|Miniserie|\d{4}.*?)\)$/i, "")
          .trim();
        const yrInExtract = extract.match(/\b(19[2-9]\d|20[0-3]\d)\b/)?.[1] || (year ? String(year) : "k.A.");
        const posterUrl = p.thumbnail?.source || p.original?.source || "";
        // Disjunkter 600M-Block für Wikipedia DE (600M..649M) und EN (650M..699M) OHNE Modulo-290k-Kürzung!
        const wikiBase = w.host.startsWith("de.") ? 600000000 : 650000000;
        const pageIdNum = Number(p.pageid) > 0
          ? (Number(p.pageid) % 49999999)
          : hashStringToPositiveInt(cleanedWikiTitle, 0, 49999999);
        const wikiId = wikiBase + pageIdNum;
        const isTv = /(?:fernsehserie|miniserie|staffel|episoden|television series|tv series)/i.test(`${p.title} ${extract}`);

        return {
          source: `MediaWiki (${w.host.split(".")[0].toUpperCase()})`,
          id: wikiId,
          pageId: p.pageid,
          typeCode: isTv ? "s" : typeCode,
          title: cleanedWikiTitle || cleanQ,
          originalTitle: cleanedWikiTitle || cleanQ,
          year: yrInExtract,
          releaseDate: yrInExtract !== "k.A." ? `${yrInExtract}-01-01` : "Keine Angabe",
          runtime: "Keine Angabe",
          genres: isTv ? "Serie (Wikipedia)" : "Film (Wikipedia)",
          directors: "Keine Angabe",
          casts: "Keine Angabe",
          country: "k.A.",
          overview: extract || `Wikipedia-Eintrag zu ${cleanedWikiTitle}.`,
          poster: posterUrl,
          external_poster_url: posterUrl,
          vote_average: 0,
          confidence: 72
        };
      }
    }
    return null;
  }

  // --- 2B. APPLE ITUNES SEARCH API FALLBACK (DEUTSCHE FILME & SERIEN + HIGH-RES ARTWORK) ---
  async function fetchItunesFallback(env, title, year = null, typeCode = "m") {
    const q = String(title || "").trim();
    if (!q || q.length < 2) return null;
    const mediaParam = typeCode === "s" ? "tvShow" : "movie";
    const entityParam = typeCode === "s" ? "tvSeason" : "movie";
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=DE&lang=de_de&media=${mediaParam}&entity=${entityParam}&limit=5`;
    const data = await cachedExternalFetchJson(url, {}, 3800);
    const results = Array.isArray(data?.results) ? data.results : [];
    if (results.length === 0) return null;

    const normQ = normalizeCompareString(q);
    for (const item of results) {
      const rawName = String(item.collectionName || item.trackName || "").replace(/\s*[-–]\s*Staffel\s*\d+.*$/i, "").replace(/\s*\(Season\s*\d+.*?\)$/i, "").trim();
      if (!rawName) continue;
      const normName = normalizeCompareString(rawName);
      const isMatch = normName === normQ || normName.includes(normQ) || normQ.includes(normName);
      if (!isMatch && results.indexOf(item) > 0) continue;

      const relDate = String(item.releaseDate || "").split("T")[0] || "";
      const relYear = relDate.split("-")[0] || "";
      if (year && relYear && Math.abs(Number(year) - Number(relYear)) > 3 && normName !== normQ) continue;

      const highResArt = item.artworkUrl100
        ? String(item.artworkUrl100).replace(/100x100bb/i, "600x900bb")
        : "";
      // Disjunkter 700M..899M-Block für Apple iTunes DE (getrennt für Film 700M..799M und Serie 800M..899M)
      const itunesBase = typeCode === "s" ? 800000000 : 700000000;
      const rawItunesId = Number(item.collectionId || item.trackId || 0);
      const itunesId = itunesBase + (rawItunesId > 0 ? (rawItunesId % 99999999) : hashStringToPositiveInt(`itunes_${typeCode}_${rawName}`, 0, 99999999));
      return {
        source: "Apple iTunes DE",
        id: itunesId,
        typeCode: typeCode === "s" ? "s" : "m",
        title: rawName,
        originalTitle: String(item.trackCensoredName || rawName),
        year: relYear || (year ? String(year) : "k.A."),
        releaseDate: relDate || (year ? `${year}-01-01` : "Keine Angabe"),
        fsk: item.contentAdvisoryRating ? `FSK ${item.contentAdvisoryRating}` : "FSK Keine Angabe",
        runtime: item.trackTimeMillis ? `${Math.round(Number(item.trackTimeMillis) / 60000)} Min.` : "Keine Angabe",
        genres: item.primaryGenreName || (typeCode === "s" ? "Serie" : "Film"),
        directors: item.artistName || "Keine Angabe",
        casts: "Keine Angabe",
        country: "DE",
        overview: String(item.longDescription || item.shortDescription || `Apple iTunes DE Eintrag zu ${rawName}.`).trim(),
        poster: highResArt,
        external_poster_url: highResArt,
        vote_average: 7.0,
        confidence: normName === normQ ? 84 : 76
      };
    }
    return null;
  }

  // --- 2C. ANILIST GRAPHQL API FALLBACK (ANIME FILME & SERIEN INKL. HQ COVER) ---
  async function fetchAniListFallback(env, title, year = null, typeCode = "s") {
    const q = String(title || "").trim();
    if (!q || q.length < 2) return null;
    const cacheKey = `anilist_${typeCode}_${q.toLowerCase()}_${year || ""}`;
    try {
      if (typeof externalFallbackCache !== "undefined" && externalFallbackCache.has(cacheKey)) {
        return externalFallbackCache.get(cacheKey).data;
      }
      const gqlQuery = `query ($search: String) {
        Page(page: 1, perPage: 4) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            format
            episodes
            duration
            averageScore
            seasonYear
            startDate { year month day }
            title { romaji english native }
            synonyms
            genres
            description(asHtml: false)
            coverImage { extraLarge large }
            bannerImage
          }
        }
      }`;
      const res = await fetchWithTimeout("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: gqlQuery, variables: { search: q } })
      }, 3800);
      if (!res.ok) return null;
      const json = await res.json();
      const mediaList = json?.data?.Page?.media;
      if (!Array.isArray(mediaList) || mediaList.length === 0) return null;

      const normQ = normalizeCompareString(q);
      for (const m of mediaList) {
        const titles = [m.title?.english, m.title?.romaji, m.title?.native, ...(Array.isArray(m.synonyms) ? m.synonyms : [])]
          .filter(Boolean)
          .map(t => String(t).trim());
        const matchedTitle = titles.find(t => {
          const nt = normalizeCompareString(t);
          return nt === normQ || nt.includes(normQ) || normQ.includes(nt);
        });
        if (!matchedTitle) continue;

        const isAnimeMovie = m.format === "MOVIE";
        const resolvedTc = typeCode || (isAnimeMovie ? "m" : "s");
        const relYear = String(m.seasonYear || m.startDate?.year || year || "k.A.");
        const cleanDesc = String(m.description || "")
          .replace(/<[^>]*>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        const bestTitle = String(m.title?.english || m.title?.romaji || matchedTitle).trim();
        const posterUrl = m.coverImage?.extraLarge || m.coverImage?.large || "";
        // Disjunkter 300M-Block für AniList (300.000.000 .. 399.999.999) mit 1:1 nativer AniList-ID
        const resultObj = {
          source: "AniList Anime",
          id: 300000000 + (Number(m.id || hashStringToPositiveInt(bestTitle, 0, 99999999)) % 99999999),
          typeCode: resolvedTc,
          title: bestTitle,
          originalTitle: String(m.title?.romaji || m.title?.native || bestTitle),
          year: relYear,
          releaseDate: m.startDate?.year ? `${m.startDate.year}-${String(m.startDate.month || 1).padStart(2, "0")}-${String(m.startDate.day || 1).padStart(2, "0")}` : "Keine Angabe",
          fsk: "FSK 12",
          runtime: m.duration ? `${m.duration} Min.` : "24 Min.",
          genres: Array.isArray(m.genres) && m.genres.length > 0 ? ["Anime", ...m.genres].join(", ") : "Anime",
          directors: "Keine Angabe",
          casts: "Keine Angabe",
          country: "JP",
          overview: cleanDesc || `Anime-Eintrag (${bestTitle}) aus AniList.`,
          poster: posterUrl,
          external_poster_url: posterUrl,
          vote_average: m.averageScore ? Math.round((Number(m.averageScore) / 10) * 10) / 10 : 7.5,
          numberOfSeasons: 1,
          numberOfEpisodes: Number(m.episodes || 12),
          confidence: 85
        };
        if (typeof externalFallbackCache !== "undefined") {
          if (externalFallbackCache.size > 300) {
            const firstKey = externalFallbackCache.keys().next().value;
            if (firstKey) externalFallbackCache.delete(firstKey);
          }
          externalFallbackCache.set(cacheKey, { data: resultObj, ts: Date.now() });
        }
        return resultObj;
      }
    } catch (e) {}
    return null;
  }

  // --- 2D. JIKAN API v4 (MYANIMELIST) FALLBACK FÜR ANIME ---
  async function fetchJikanAnimeFallback(env, title, year = null, typeCode = "s") {
    const q = String(title || "").trim();
    if (!q || q.length < 2) return null;
    const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=4&sfw=true`;
    const data = await cachedExternalFetchJson(url, {}, 3800);
    const list = Array.isArray(data?.data) ? data.data : [];
    if (list.length === 0) return null;

    const normQ = normalizeCompareString(q);
    for (const item of list) {
      const titles = [item.title_german, item.title_english, item.title, ...(Array.isArray(item.titles) ? item.titles.map(t => t?.title) : [])]
        .filter(Boolean)
        .map(t => String(t).trim());
      const matched = titles.find(t => {
        const nt = normalizeCompareString(t);
        return nt === normQ || nt.includes(normQ) || normQ.includes(nt);
      });
      if (!matched) continue;

      const isMovie = String(item.type || "").toUpperCase() === "MOVIE";
      const resolvedTc = typeCode || (isMovie ? "m" : "s");
      const relYear = String(item.year || (item.aired?.from ? String(item.aired.from).split("-")[0] : "") || year || "k.A.");
      const posterUrl = item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || "";
      const bestTitle = String(item.title_german || item.title_english || item.title || matched).trim();
      // Disjunkter 400M-Block für MyAnimeList / Jikan (400.000.000 .. 499.999.999) mit 1:1 nativer MAL-ID
      return {
        source: "MyAnimeList (Jikan)",
        id: 400000000 + (Number(item.mal_id || hashStringToPositiveInt(bestTitle, 0, 99999999)) % 99999999),
        typeCode: resolvedTc,
        title: bestTitle,
        originalTitle: String(item.title_japanese || item.title || bestTitle),
        year: relYear,
        releaseDate: item.aired?.from ? String(item.aired.from).split("T")[0] : "Keine Angabe",
        fsk: item.rating ? String(item.rating).split(" - ")[0] : "FSK 12",
        runtime: item.duration || "24 Min.",
        genres: Array.isArray(item.genres) && item.genres.length > 0 ? ["Anime", ...item.genres.map(g => g.name)].join(", ") : "Anime",
        directors: "Keine Angabe",
        casts: "Keine Angabe",
        country: "JP",
        overview: String(item.synopsis || `MyAnimeList Eintrag zu ${bestTitle}.`).trim(),
        poster: posterUrl,
        external_poster_url: posterUrl,
        vote_average: Number(item.score || 7.4),
        numberOfSeasons: 1,
        numberOfEpisodes: Number(item.episodes || 12),
        confidence: 83
      };
    }
    return null;
  }

  // Führt die erweiterte 8-Stufen Multi-API Fallback-Kaskade aus:
  // Im "smart_emergency"-Modus (Cloudflare Free-Tier Turbo) werden nur dann, wenn TMDb 0 brauchbare Treffer hat,
  // die 3 schnellsten Zusatz-APIs (OMDb + TVMaze + iTunes DE) parallel mit hartem 1800ms Zeitlimit abgefragt!
  async function fetchMultiApiFallbackCascade(env, parsed, forceTypeCode = null, options = null) {
    const searchTitle = String(parsed?.cleanTitle || parsed?.title || "").trim();
    if (!searchTitle && !parsed?.imdbId) return null;
    const tc = forceTypeCode || (parsed?.isSeries ? "s" : "m");
    const yr = parsed?.year || null;
    const fallbackMode = String(options?.fallbackMode || "deep");

    if (fallbackMode === "smart_emergency") {
      if (!hasSubrequestBudget(16)) return null;
      const buildTvMazeObj = async () => {
        if (tc !== "s" && forceTypeCode) return null;
        const maze = await fetchTvMazeSeriesFallback(searchTitle, yr || "").catch(() => null);
        if (!maze || !maze.tvmazeId) return null;
        if (env?.TMDB_BEARER_TOKEN && hasSubrequestBudget(19)) {
          if (maze.imdbId) {
            const bridgedImdb = await resolveExternalIdToTmdb(env, maze.imdbId, "imdb_id", "s").catch(() => null);
            if (bridgedImdb && bridgedImdb.id && bridgedImdb.id < 8000000) return bridgedImdb;
          }
          if (maze.tvdbId) {
            const bridgedTvdb = await resolveExternalIdToTmdb(env, maze.tvdbId, "tvdb_id", "s").catch(() => null);
            if (bridgedTvdb && bridgedTvdb.id && bridgedTvdb.id < 8000000) return bridgedTvdb;
          }
        }
        const mazeYear = String(maze.releaseDate || "").split("-")[0] || (yr ? String(yr) : "k.A.");
        return {
          source: "TVMaze",
          id: 200000000 + (Number(maze.tvmazeId) % 99999999),
          tvmazeId: Number(maze.tvmazeId),
          imdbId: maze.imdbId || null,
          tvdbId: maze.tvdbId || null,
          typeCode: "s",
          title: maze.title,
          originalTitle: maze.title,
          year: mazeYear,
          releaseDate: maze.releaseDate || "Keine Angabe",
          fsk: "FSK Keine Angabe",
          runtime: maze.runtime || "Keine Angabe",
          genres: maze.genres || "Serie",
          directors: "Keine Angabe",
          casts: maze.casts || "Keine Angabe",
          country: "k.A.",
          overview: maze.overview || "Keine Beschreibung verfügbar.",
          poster: maze.imageOriginal || "",
          external_poster_url: maze.imageOriginal || "",
          vote_average: maze.vote_average || 0,
          numberOfSeasons: maze.seasons?.length || 1,
          numberOfEpisodes: maze.episodes?.length || 0,
          seasons: maze.seasons || [],
          confidence: 80
        };
      };

      const fastRace = await Promise.race([
        Promise.allSettled([
          fetchOmdbFallback(env, searchTitle, yr, tc, parsed?.imdbId || null),
          buildTvMazeObj(),
          fetchItunesFallback(env, searchTitle, yr, tc)
        ]),
        new Promise(resolve => setTimeout(() => resolve(null), 1800))
      ]);
      if (!Array.isArray(fastRace)) return null;
      const omdbFast = fastRace[0]?.status === "fulfilled" ? fastRace[0].value : null;
      const mazeFast = fastRace[1]?.status === "fulfilled" ? fastRace[1].value : null;
      const itunesFast = fastRace[2]?.status === "fulfilled" ? fastRace[2].value : null;
      if (omdbFast && omdbFast.id < 8000000) return omdbFast;
      if (mazeFast && mazeFast.id < 8000000) return mazeFast;
      return omdbFast || mazeFast || itunesFast || null;
    }

    // 1. OMDb API Fallback (löst bei vorhandener IMDb-ID automatisch zuerst auf die echte TMDb-ID auf!)
    const omdbHit = await fetchOmdbFallback(env, searchTitle, yr, tc, parsed?.imdbId || null).catch(() => null);
    if (omdbHit && omdbHit.id < 8000000) return omdbHit;

    // 2. TVMaze API Fallback (speziell für Serien & Episodenlisten – löst über IMDb/TheTVDB zuerst auf echte TMDb-ID auf!)
    let tvmazeFallbackObj = null;
    if (tc === "s" || !forceTypeCode) {
      const maze = await fetchTvMazeSeriesFallback(searchTitle, yr || "").catch(() => null);
      if (maze && maze.tvmazeId) {
        if (env?.TMDB_BEARER_TOKEN) {
          if (maze.imdbId) {
            const bridgedImdb = await resolveExternalIdToTmdb(env, maze.imdbId, "imdb_id", "s").catch(() => null);
            if (bridgedImdb && bridgedImdb.id && bridgedImdb.id < 8000000) return bridgedImdb;
          }
          if (maze.tvdbId) {
            const bridgedTvdb = await resolveExternalIdToTmdb(env, maze.tvdbId, "tvdb_id", "s").catch(() => null);
            if (bridgedTvdb && bridgedTvdb.id && bridgedTvdb.id < 8000000) return bridgedTvdb;
          }
        }
        const mazeYear = String(maze.releaseDate || "").split("-")[0] || (yr ? String(yr) : "k.A.");
        // Disjunkter 200M-Block für TVMaze (200.000.000 .. 299.999.999) mit 1:1 nativer TVMaze-ID
        tvmazeFallbackObj = {
          source: "TVMaze",
          id: 200000000 + (Number(maze.tvmazeId) % 99999999),
          tvmazeId: Number(maze.tvmazeId),
          imdbId: maze.imdbId || null,
          tvdbId: maze.tvdbId || null,
          typeCode: "s",
          title: maze.title,
          originalTitle: maze.title,
          year: mazeYear,
          releaseDate: maze.releaseDate || "Keine Angabe",
          fsk: "FSK Keine Angabe",
          runtime: maze.runtime || "Keine Angabe",
          genres: maze.genres || "Serie",
          directors: "Keine Angabe",
          casts: maze.casts || "Keine Angabe",
          country: "k.A.",
          overview: maze.overview || "Keine Beschreibung verfügbar.",
          poster: maze.imageOriginal || "",
          external_poster_url: maze.imageOriginal || "",
          vote_average: maze.vote_average || 0,
          numberOfSeasons: maze.seasons?.length || 1,
          numberOfEpisodes: maze.episodes?.length || 0,
          seasons: maze.seasons || [],
          confidence: 80
        };
      }
    }

    // 3. Wikidata API Fallback (inkl. P4947/P4983/P345 TMDb-ID Bridge & strikter Q5 Schauspieler-Sperre!)
    const wikidataHit = await fetchWikidataFallback(env, searchTitle, yr, tc).catch(() => null);
    if (wikidataHit && wikidataHit.id < 8000000) return wikidataHit;

    // Falls keine echte TMDb-ID über die Brücken gefunden wurde, liefere den besten Zusatz-API-Treffer mit disjunkter 100M-ID:
    if (omdbHit) return omdbHit;
    if (tvmazeFallbackObj) return tvmazeFallbackObj;

    // 4. Apple iTunes Search API DE (Deutsche Filme & Serien + High-Res Cover)
    const itunesHit = await fetchItunesFallback(env, searchTitle, yr, tc).catch(() => null);
    if (itunesHit) return itunesHit;

    if (fallbackMode === "balanced" && !hasSubrequestBudget(24)) {
      return wikidataHit || null;
    }

    // 5. AniList GraphQL API (Anime Filme & Serien)
    const anilistHit = await fetchAniListFallback(env, searchTitle, yr, tc).catch(() => null);
    if (anilistHit) return anilistHit;

    // 6. Jikan API v4 / MyAnimeList (Anime Fallback)
    const jikanHit = await fetchJikanAnimeFallback(env, searchTitle, yr, tc).catch(() => null);
    if (jikanHit) return jikanHit;

    // 7. Wikidata Fallback (500M-Block)
    if (wikidataHit) return wikidataHit;

    // 8. MediaWiki (Wikipedia DE/EN 600M/650M-Block) API Fallback
    const mediaWikiHit = await fetchMediaWikiFallback(env, searchTitle, yr, tc).catch(() => null);
    if (mediaWikiHit) return mediaWikiHit;

    return null;
  }

  function extractYoutubeTrailerFromVideos(videosObj) {
    const results = videosObj?.results || [];
    if (!Array.isArray(results) || results.length === 0) return null;
    const deTrailer = results.find(v => v && v.site === "YouTube" && v.type === "Trailer" && v.iso_639_1 === "de");
    if (deTrailer?.key) return deTrailer.key;
    const anyTrailer = results.find(v => v && v.site === "YouTube" && v.type === "Trailer");
    if (anyTrailer?.key) return anyTrailer.key;
    const anyYt = results.find(v => v && v.site === "YouTube" && v.key);
    return anyYt ? anyYt.key : null;
  }

  async function fetchMovieDetails(env, movieId) {
    const cacheKey = `movie_${movieId}`;
    // 1. L1 In-Memory Cache prüfen (nur wenn Poster bereits vorhanden oder Fallback-ID >= 8000000)
    const cached = getCachedTmdb(cacheKey);
    if (cached && (cached.poster_path || cached.external_poster_url || Number(movieId) >= 8000000)) return cached;

    // 2. L2 Cloudflare D1 SQLite Datenbank prüfen (wenn Poster fehlt und echte TMDb-ID < 8000000, lade Poster von TMDb nach!)
    const d1Movie = await getMovieFromD1(env, movieId);
    if (d1Movie && (d1Movie.poster_path || d1Movie.external_poster_url || Number(movieId) >= 8000000)) {
      return setCachedTmdb(cacheKey, d1Movie);
    }
    const d1EntityMovie = !d1Movie ? await getEntityFromD1(env, cacheKey, D1_MOVIE_TTL_MS) : null;
    if (d1EntityMovie && (d1EntityMovie.poster_path || d1EntityMovie.external_poster_url || Number(movieId) >= 8000000)) {
      return setCachedTmdb(cacheKey, d1EntityMovie);
    }

    // 3. Bei Cache-Miss: TMDB API abfragen (Videos direkt in append_to_response gebündelt)
    if (!hasSubrequestBudget(42)) {
      subrequestBudgetExhausted = true;
      return null;
    }
    const urlDe = `https://api.themoviedb.org/3/movie/${movieId}?append_to_response=credits,release_dates,images,watch/providers,videos&include_image_language=de,en,null&include_video_language=de,en,null&language=de-DE`;
    try {
      const res = await fetchWithTimeout(urlDe, {
        headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
      }, 4500);
      if (!res.ok) return null;
      const data = await res.json();

      let posterPath = data.poster_path;
      if (!posterPath && Array.isArray(data.images?.posters) && data.images.posters.length > 0) {
        posterPath = data.images.posters[0].file_path;
      }

      let backdropPath = data.backdrop_path;
      if (!backdropPath && Array.isArray(data.images?.backdrops) && data.images.backdrops.length > 0) {
        backdropPath = data.images.backdrops[0].file_path;
      }

      let overview = (data.overview || "").trim();
      let isEnglishFallback = false;
      if (!overview) {
        try {
          const resEn = await fetchWithTimeout(`https://api.themoviedb.org/3/movie/${movieId}?language=en-US`, {
            headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
          }, 3500);
          if (resEn.ok) {
            const dataEn = await resEn.json();
            if (dataEn.overview && dataEn.overview.trim()) {
              overview = dataEn.overview.trim();
              isEnglishFallback = true;
            }
          }
        } catch (e) {}
      }

      const deWatch = data["watch/providers"]?.results?.DE;
      const flatrate = (deWatch?.flatrate || []).slice(0, 4).map(p => p.provider_name).join(", ") || null;
      const deWatchAll = [
        ...(deWatch?.flatrate || []),
        ...(deWatch?.free || []),
        ...(deWatch?.ads || []),
        ...(deWatch?.rent || []),
        ...(deWatch?.buy || [])
      ];
      const providerIds = Array.from(new Set(deWatchAll.map(p => p.provider_id).filter(Boolean)));
      const allProviders = Array.from(new Set(deWatchAll.map(p => p.provider_name).filter(Boolean))).join(", ") || flatrate || "";
      const studiosList = (data.production_companies || [])
        .filter(c => c && c.name)
        .slice(0, 6)
        .map(c => ({ id: c.id, name: c.name }));

      const directorsList = (data.credits?.crew || [])
        .filter((c) => c && c.job === "Director" && c.name)
        .slice(0, 3)
        .map((d) => ({ id: d.id, name: d.name, profile_path: d.profile_path || "" }));
      const castList = (data.credits?.cast || [])
        .filter((c) => c && c.name)
        .slice(0, 14)
        .map((c) => ({
          id: c.id,
          name: c.name,
          character: c.character || "",
          profile_path: c.profile_path || ""
        }));
      const genresList = (data.genres || []).map(g => ({ id: g.id, name: g.name }));
      const trailerKey = extractYoutubeTrailerFromVideos(data.videos);

      const result = {
        id: data.id || movieId,
        directors: directorsList.map((d) => d.name).join(", ") || "Keine Angabe",
        directorsList,
        casts: castList.map((c) => c.name).join(", ") || "Keine Angabe",
        castList,
        genres: genresList.map((g) => g.name).join(", ") || "Keine Angabe",
        genresList,
        studios: studiosList.map((s) => s.name).join(", ") || "Keine Angabe",
        studiosList,
        runtime: data.runtime ? `${data.runtime} Min.` : "Keine Angabe",
        country: shortenCountry(data.production_countries?.[0]?.name || "Keine Angabe"),
        releaseDate: data.release_date || "Keine Angabe",
        fsk: getFskRating(data.release_dates),
        collection: data.belongs_to_collection ? { id: data.belongs_to_collection.id, name: data.belongs_to_collection.name } : null,
        overview: overview || "Keine Beschreibung verfügbar.",
        isEnglishFallback,
        providers: flatrate,
        allProviders,
        providerIds,
        poster_path: posterPath,
        backdrop_path: backdropPath,
        vote_average: data.vote_average,
        title: data.title || "Unbekannt",
        trailerKey
      };
      setCachedTmdb(cacheKey, result);
      if (d1Movie) {
        await saveMovieToD1(env, result);
      } else {
        await saveEntityToD1(env, cacheKey, "tmdb_movie", result);
      }
      return result;
    } catch (e) {
      return null;
    }
  }

  // TVMaze API Fallback für Serien & Staffeln (wenn TMDB unvollständige Daten oder Ausfall hat)
  function stripHtmlTags(raw) {
    return String(raw || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  }

  async function fetchTvMazeSeriesFallback(title, year = "") {
    const cleanTitle = String(title || "").replace(/\s*\(\d{4}\)$/, "").trim();
    if (!cleanTitle) return null;
    const cacheKey = `tvmaze_show_${cleanTitle.toLowerCase()}_${year}`;
    const cached = getCachedTmdb(cacheKey);
    if (cached) return cached;

    try {
      const url = `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanTitle)}&embed[]=episodes&embed[]=cast&embed[]=seasons`;
      const res = await fetchWithTimeout(url, { headers: { accept: "application/json" } }, 4000);
      if (!res.ok) return null;
      const show = await res.json();
      if (!show || !show.id) return null;

      const summary = stripHtmlTags(show.summary || "");
      const runtime = show.averageRuntime || show.runtime ? `${show.averageRuntime || show.runtime} Min. pro Folge` : "";
      let statusText = "Unbekannt";
      if (show.status === "Running") statusText = "🟢 Läuft noch";
      else if (show.status === "Ended") statusText = "🔴 Beendet";
      else if (show.status === "To Be Determined" || show.status === "In Development") statusText = "🟡 In Planung";

      const castNames = (show._embedded?.cast || [])
        .map(c => c?.person?.name)
        .filter(Boolean)
        .slice(0, 5);
      const studioName = show.network?.name || show.webChannel?.name || "";
      const rawSeasons = show._embedded?.seasons || [];
      const rawEpisodes = show._embedded?.episodes || [];
      const seasons = rawSeasons
        .filter(s => s && s.number >= 1)
        .map(s => ({
          season_number: s.number,
          name: s.name || `Staffel ${s.number}`,
          episode_count: s.episodeOrder || rawEpisodes.filter(ep => ep.season === s.number).length || 0,
          air_date: s.premiereDate || ""
        }));

      const out = {
        tvmazeId: show.id,
        imdbId: show.externals?.imdb ? String(show.externals.imdb).trim() : null,
        tvdbId: show.externals?.thetvdb ? Number(show.externals.thetvdb) : null,
        title: show.name || cleanTitle,
        overview: summary,
        runtime,
        statusText,
        releaseDate: show.premiered || "",
        genres: Array.isArray(show.genres) && show.genres.length > 0 ? show.genres.join(", ") : "",
        studios: studioName,
        casts: castNames.join(", "),
        vote_average: show.rating?.average || 0,
        imageOriginal: show.image?.original || show.image?.medium || "",
        seasons,
        episodes: rawEpisodes.map(ep => ({
          id: ep.id,
          season_number: ep.season || 1,
          episode_number: ep.number || 1,
          name: ep.name || `Folge ${ep.number || 1}`,
          air_date: ep.airdate || "",
          runtime: ep.runtime ? `${ep.runtime} Min.` : "",
          vote_average: ep.rating?.average || 0,
          overview: stripHtmlTags(ep.summary || "")
        }))
      };
      return setCachedTmdb(cacheKey, out);
    } catch (e) {
      return null;
    }
  }

  async function fetchSeriesDetails(env, seriesId) {
    const cacheKey = `tv_${seriesId}`;
    // 1. L1 In-Memory Cache prüfen (nur wenn Poster bereits vorhanden oder Fallback-ID >= 8000000)
    const cached = getCachedTmdb(cacheKey);
    if (cached && (cached.poster_path || cached.external_poster_url || Number(seriesId) >= 8000000)) return cached;

    // 2. L2 Cloudflare D1 SQLite Datenbank prüfen (wenn Poster fehlt und echte TMDb-ID < 8000000, lade Poster von TMDb nach!)
    const d1Series = await getSeriesFromD1(env, seriesId);
    if (d1Series && (d1Series.poster_path || d1Series.external_poster_url || Number(seriesId) >= 8000000)) {
      return setCachedTmdb(cacheKey, d1Series);
    }
    const d1EntitySeries = !d1Series ? await getEntityFromD1(env, cacheKey, D1_MOVIE_TTL_MS) : null;
    if (d1EntitySeries && (d1EntitySeries.poster_path || d1EntitySeries.external_poster_url || Number(seriesId) >= 8000000)) {
      return setCachedTmdb(cacheKey, d1EntitySeries);
    }

    // 3. Bei Cache-Miss: TMDB API abfragen (+ automatischer TVMaze API Fallback für fehlende Serieninfos)
    if (!hasSubrequestBudget(42)) {
      subrequestBudgetExhausted = true;
      return null;
    }
    const urlDe = `https://api.themoviedb.org/3/tv/${seriesId}?append_to_response=credits,content_ratings,images,watch/providers,videos&include_image_language=de,en,null&include_video_language=de,en,null&language=de-DE`;
    try {
      const res = await fetchWithTimeout(urlDe, {
        headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
      }, 4500);
      if (!res.ok) {
        const knownTitle = memoryFallback.get(`title_cache_s_${seriesId}`) || "";
        const tvMazeOnly = knownTitle ? await fetchTvMazeSeriesFallback(knownTitle) : null;
        if (!tvMazeOnly) return null;
        const fallbackResult = {
          id: seriesId,
          directors: "Keine Angabe",
          directorsList: [],
          casts: tvMazeOnly.casts || "Keine Angabe",
          castList: [],
          genres: tvMazeOnly.genres || "Keine Angabe",
          genresList: [],
          studios: tvMazeOnly.studios || "Keine Angabe",
          studiosList: [],
          runtime: tvMazeOnly.runtime || "Keine Angabe",
          country: "k.A.",
          releaseDate: tvMazeOnly.releaseDate || "Keine Angabe",
          fsk: "FSK Keine Angabe",
          statusText: tvMazeOnly.statusText || "Unbekannt",
          overview: tvMazeOnly.overview || "Keine Beschreibung verfügbar.",
          isEnglishFallback: true,
          providers: null,
          allProviders: "",
          providerIds: [],
          poster_path: null,
          external_poster_url: tvMazeOnly.imageOriginal || "",
          backdrop_path: null,
          vote_average: tvMazeOnly.vote_average || 0,
          title: tvMazeOnly.title || knownTitle || "Unbekannt",
          trailerKey: null,
          numberOfSeasons: tvMazeOnly.seasons.length || 1,
          numberOfEpisodes: tvMazeOnly.episodes.length || 0,
          seasons: tvMazeOnly.seasons.length > 0 ? tvMazeOnly.seasons : [{ season_number: 1, name: "Staffel 1", episode_count: tvMazeOnly.episodes.length, air_date: "" }],
          sourceFallback: "TVMaze"
        };
        return setCachedTmdb(cacheKey, fallbackResult);
      }
      const data = await res.json();

      let posterPath = data.poster_path;
      if (!posterPath && Array.isArray(data.images?.posters) && data.images.posters.length > 0) {
        posterPath = data.images.posters[0].file_path;
      }
      if (!posterPath && Array.isArray(data.seasons)) {
        const seasonWithPoster = data.seasons.find(s => s && s.poster_path);
        if (seasonWithPoster) posterPath = seasonWithPoster.poster_path;
      }

      let backdropPath = data.backdrop_path;
      if (!backdropPath && Array.isArray(data.images?.backdrops) && data.images.backdrops.length > 0) {
        backdropPath = data.images.backdrops[0].file_path;
      }
      if (!posterPath && backdropPath) {
        posterPath = backdropPath;
      }

      let fsk = "FSK Keine Angabe";
      const deRating = data.content_ratings?.results?.find(r => r && r.iso_3166_1 === "DE");
      if (deRating && deRating.rating) {
        const r = String(deRating.rating).trim();
        fsk = r.startsWith("FSK") ? r : `FSK ${r}`;
      }

      let statusText = "Unbekannt";
      if (data.status === "Returning Series" || data.status === "In Production") statusText = "🟢 Läuft noch";
      else if (data.status === "Ended") statusText = "🔴 Beendet";
      else if (data.status === "Canceled") statusText = "❌ Abgebrochen";
      else if (data.status) statusText = data.status;

      let overview = (data.overview || "").trim();
      let isEnglishFallback = false;
      if (!overview) {
        try {
          const resEn = await fetchWithTimeout(`https://api.themoviedb.org/3/tv/${seriesId}?language=en-US`, {
            headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
          }, 3500);
          if (resEn.ok) {
            const dataEn = await resEn.json();
            if (dataEn.overview && dataEn.overview.trim()) {
              overview = dataEn.overview.trim();
              isEnglishFallback = true;
            }
          }
        } catch (e) {}
      }

      // TVMaze, iTunes & OMDb API Fallback zuschalten, wenn Poster, Beschreibung, Laufzeit, Status oder Staffelinfos bei TMDB fehlen
      let tvMazeData = null;
      let fallbackExternalPoster = "";
      const lookupTitle = data.original_name || data.name || "";
      const lookupYear = (data.first_air_date || "").slice(0, 4);
      const needsTvMazeFallback = (!posterPath && !overview) || !(data.seasons && data.seasons.length > 0);
      if (needsTvMazeFallback) {
        tvMazeData = await fetchTvMazeSeriesFallback(lookupTitle, lookupYear);
        if (!tvMazeData && data.name && data.name !== lookupTitle) {
          tvMazeData = await fetchTvMazeSeriesFallback(data.name, lookupYear);
        }
        if (tvMazeData) {
          if (!overview && tvMazeData.overview) {
            overview = tvMazeData.overview;
            isEnglishFallback = true;
          }
          if (statusText === "Unbekannt" && tvMazeData.statusText) {
            statusText = tvMazeData.statusText;
          }
          if (!posterPath && tvMazeData.imageOriginal) {
            fallbackExternalPoster = tvMazeData.imageOriginal;
          }
        }
      }
      if (!posterPath && !fallbackExternalPoster && hasSubrequestBudget(15)) {
        const itunes = await fetchItunesFallback(env, data.name || lookupTitle, lookupYear, "s").catch(() => null);
        if (itunes?.external_poster_url) fallbackExternalPoster = itunes.external_poster_url;
        if (!fallbackExternalPoster) {
          const omdb = await fetchOmdbFallback(env, data.name || lookupTitle, lookupYear, "s").catch(() => null);
          if (omdb?.external_poster_url) fallbackExternalPoster = omdb.external_poster_url;
        }
      }

      const deWatch = data["watch/providers"]?.results?.DE;
      const flatrate = (deWatch?.flatrate || []).slice(0, 4).map(p => p.provider_name).join(", ") || null;
      const deWatchAll = [
        ...(deWatch?.flatrate || []),
        ...(deWatch?.free || []),
        ...(deWatch?.ads || []),
        ...(deWatch?.rent || []),
        ...(deWatch?.buy || [])
      ];
      const providerIds = Array.from(new Set(deWatchAll.map(p => p.provider_id).filter(Boolean)));
      const allProviders = Array.from(new Set(deWatchAll.map(p => p.provider_name).filter(Boolean))).join(", ") || flatrate || "";
      const studiosList = [...(data.production_companies || []), ...(data.networks || [])]
        .filter(c => c && c.name)
        .slice(0, 6)
        .map(c => ({ id: c.id, name: c.name }));

      const rawDirectors = [
        ...(data.created_by || []),
        ...(data.credits?.crew || []).filter((c) => c && (c.job === "Director" || c.job === "Series Director" || c.job === "Executive Producer"))
      ];
      const seenDirIds = new Set();
      const directorsList = [];
      for (const d of rawDirectors) {
        if (d && d.name && !seenDirIds.has(d.id || d.name)) {
          seenDirIds.add(d.id || d.name);
          directorsList.push({ id: d.id, name: d.name, profile_path: d.profile_path || "" });
          if (directorsList.length >= 3) break;
        }
      }
      const castList = (data.credits?.cast || [])
        .filter((c) => c && c.name)
        .slice(0, 14)
        .map((c) => ({
          id: c.id,
          name: c.name,
          character: c.character || (Array.isArray(c.roles) && c.roles[0]?.character ? c.roles[0].character : ""),
          profile_path: c.profile_path || ""
        }));
      const genresList = (data.genres || []).map(g => ({ id: g.id, name: g.name }));
      const trailerKey = extractYoutubeTrailerFromVideos(data.videos);

      let seasons = (data.seasons || [])
        .filter(s => s && s.season_number >= 1)
        .map(s => ({
          season_number: s.season_number,
          name: s.name || `Staffel ${s.season_number}`,
          episode_count: s.episode_count || 0,
          air_date: s.air_date || ""
        }));
      if (seasons.length === 0 && tvMazeData?.seasons?.length > 0) {
        seasons = tvMazeData.seasons;
      }

      const result = {
        id: data.id || seriesId,
        directors: directorsList.map((d) => d.name).join(", ") || "Keine Angabe",
        directorsList,
        casts: castList.map((c) => c.name).join(", ") || tvMazeData?.casts || "Keine Angabe",
        castList,
        genres: genresList.map((g) => g.name).join(", ") || tvMazeData?.genres || "Keine Angabe",
        genresList,
        studios: studiosList.map((s) => s.name).join(", ") || tvMazeData?.studios || "Keine Angabe",
        studiosList,
        runtime: data.episode_run_time?.[0] ? `${data.episode_run_time[0]} Min. pro Folge` : (tvMazeData?.runtime || "Keine Angabe"),
        country: shortenCountry(data.production_countries?.[0]?.name || "Keine Angabe"),
        releaseDate: data.first_air_date || tvMazeData?.releaseDate || "Keine Angabe",
        fsk,
        statusText,
        overview: overview || "Keine Beschreibung verfügbar.",
        isEnglishFallback,
        providers: flatrate,
        allProviders,
        providerIds,
        poster_path: posterPath,
        external_poster_url: !posterPath ? fallbackExternalPoster : "",
        backdrop_path: backdropPath,
        vote_average: data.vote_average || tvMazeData?.vote_average || 0,
        title: data.name || tvMazeData?.title || "Unbekannt",
        original_name: data.original_name || data.name || "",
        trailerKey,
        numberOfSeasons: data.number_of_seasons || seasons.length || 1,
        numberOfEpisodes: data.number_of_episodes || tvMazeData?.episodes?.length || 0,
        seasons
      };
      setCachedTmdb(cacheKey, result);
      if (d1Series) {
        await saveSeriesToD1(env, result);
      } else {
        await saveEntityToD1(env, cacheKey, "tmdb_tv", result);
      }
      return result;
    } catch (e) {
      return null;
    }
  }

  // Lädt alle Episoden einer Serien-Staffel von TMDB (bzw. aktiver Episode-Group) oder aus der D1 SQLite Datenbank (+ TVMaze API Fallback)
  async function fetchSeasonDetails(env, seriesId, seasonNumber = 1) {
    const sNum = Math.max(1, parseInt(seasonNumber, 10) || 1);
    const sidNum = Number(seriesId);
    const cacheKey = `tv_season_${seriesId}_${sNum}`;
    const existingD1Series = await getSeriesFromD1(env, seriesId);

    // Prüfe zuerst, ob für diese Serie eine Episode-Group (z.B. "Parts (edited version)" mit 13 Folgen bei Haus des Geldes) aktiv ist!
    // Wenn ja, darf NIEMALS der Standard-Endpunkt /tv/{id}/season/{sNum} (mit 15 Folgen) für leere Platzhalter-Slots genutzt werden!
    if (sidNum > 0 && sidNum < 8000000) {
      const sDetailsCached = getCachedTmdb(`tv_${seriesId}`) || existingD1Series;
      const shouldCheckGroup = FORCE_EPISODE_GROUP_SERIES.has(sidNum) || Boolean(sDetailsCached?.versionInfo?.isAlternativeOrder);
      if (shouldCheckGroup) {
        try {
          const resolvedVer = await resolveSeriesVersionOnTMDb(sidNum, { season: sNum, episode: 1 }, env);
          if (resolvedVer?.versionInfo?.isAlternativeOrder && Array.isArray(resolvedVer.series?._normalizedGroupSeasons)) {
            const matchedGroupSeason = resolvedVer.series._normalizedGroupSeasons.find(s => Number(s.season_number) === sNum);
            if (matchedGroupSeason) {
              const groupSeasonResult = {
                id: matchedGroupSeason.id || `${seriesId}_${sNum}`,
                season_number: sNum,
                name: matchedGroupSeason.name || `Staffel ${sNum}`,
                seasonEpisodeCount: matchedGroupSeason.episode_count,
                isEpisodeGroup: true,
                versionLabel: resolvedVer.versionInfo.versionLabel,
                episodes: (matchedGroupSeason.episodes || []).map(ep => ({
                  id: ep.id,
                  episode_number: ep.episode_number,
                  season_number: sNum,
                  name: ep.name || `Folge ${ep.episode_number}`,
                  air_date: ep.air_date || "",
                  runtime: ep.runtime ? `${ep.runtime} Min.` : "",
                  vote_average: ep.vote_average || 0,
                  overview: ep.overview || ""
                }))
              };
              setCachedTmdb(cacheKey, groupSeasonResult);
              if (existingD1Series) {
                await saveSeasonToD1(env, seriesId, sNum, groupSeasonResult);
              } else {
                await saveEntityToD1(env, cacheKey, "tmdb_season", groupSeasonResult);
              }
              return groupSeasonResult;
            }
          }
        } catch (e) {}
      }
    }

    const cached = getCachedTmdb(cacheKey);
    if (cached) return cached;

    const d1Season = existingD1Series ? await getSeasonFromD1(env, seriesId, sNum) : await getEntityFromD1(env, cacheKey, D1_MOVIE_TTL_MS);
    if (d1Season) {
      return setCachedTmdb(cacheKey, d1Season);
    }

    const url = `https://api.themoviedb.org/3/tv/${seriesId}/season/${sNum}?language=de-DE`;
    try {
      const res = await fetchWithTimeout(url, {
        headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
      }, 4500);

      let episodes = [];
      let seasonName = `Staffel ${sNum}`;
      let seasonId = `${seriesId}_${sNum}`;

      if (res.ok) {
        const data = await res.json();
        seasonId = data.id || seasonId;
        seasonName = data.name || seasonName;
        episodes = (data.episodes || []).map(ep => ({
          id: ep.id,
          episode_number: ep.episode_number,
          season_number: ep.season_number || sNum,
          name: ep.name || `Folge ${ep.episode_number}`,
          air_date: ep.air_date || "",
          runtime: ep.runtime ? `${ep.runtime} Min.` : "",
          vote_average: ep.vote_average || 0,
          overview: ep.overview || ""
        }));
      }

      // TVMaze Episoden-Fallback nur nutzen, wenn TMDB gar keine Episoden für die Staffel liefert
      const hasMissingEpInfo = episodes.length === 0;
      if (hasMissingEpInfo) {
        const sDetails = getCachedTmdb(`tv_${seriesId}`) || await fetchSeriesDetails(env, seriesId);
        const lookupTitle = sDetails?.original_name || sDetails?.title || "";
        const tvMaze = lookupTitle ? await fetchTvMazeSeriesFallback(lookupTitle) : null;
        if (tvMaze && Array.isArray(tvMaze.episodes)) {
          const mazeSeasonEps = tvMaze.episodes.filter(e => Number(e.season_number) === Number(sNum));
          if (episodes.length === 0 && mazeSeasonEps.length > 0) {
            episodes = mazeSeasonEps;
          } else if (mazeSeasonEps.length > 0) {
            episodes = episodes.map(ep => {
              const mEp = mazeSeasonEps.find(m => Number(m.episode_number) === Number(ep.episode_number));
              if (!mEp) return ep;
              return {
                ...ep,
                name: (!ep.name || /^Folge \d+$/i.test(ep.name)) && mEp.name ? mEp.name : ep.name,
                air_date: ep.air_date || mEp.air_date || "",
                runtime: ep.runtime || mEp.runtime || "",
                vote_average: ep.vote_average || mEp.vote_average || 0,
                overview: ep.overview || mEp.overview || ""
              };
            });
          }
        }
      }

      if (episodes.length === 0 && !res.ok) return null;

      const result = {
        id: seasonId,
        season_number: sNum,
        name: seasonName,
        episodes
      };
      setCachedTmdb(cacheKey, result);
      if (existingD1Series) {
        await saveSeasonToD1(env, seriesId, sNum, result);
      } else {
        await saveEntityToD1(env, cacheKey, "tmdb_season", result);
      }
      return result;
    } catch (e) {
      return null;
    }
  }

  async function fetchCollectionDetails(env, collectionId) {
    const cacheKey = `col_${collectionId}`;
    const cached = getCachedTmdb(cacheKey);
    if (cached) return cached;

    const d1Col = await getEntityFromD1(env, cacheKey, D1_MOVIE_TTL_MS);
    if (d1Col) {
      if (d1Col.name) memoryFallback.set(`col_name_${collectionId}`, d1Col.name);
      return setCachedTmdb(cacheKey, d1Col);
    }

    const url = `https://api.themoviedb.org/3/collection/${collectionId}?language=de-DE`;
    try {
      const res = await fetchWithTimeout(url, {
        headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
      }, 4500);
      if (!res.ok) return null;
      const data = await res.json();
      const parts = (data.parts || []).slice().sort((a, b) => {
        const da = a.release_date || "9999-99-99";
        const db = b.release_date || "9999-99-99";
        return da.localeCompare(db);
      });
      if (data.name) memoryFallback.set(`col_name_${collectionId}`, data.name);
      const result = {
        id: data.id,
        name: data.name || "Filmreihe",
        overview: data.overview || "",
        parts
      };
      setCachedTmdb(cacheKey, result);
      await saveEntityToD1(env, cacheKey, "collection", result);
      return result;
    } catch (e) {
      return null;
    }
  }

  // Suche nach Filmreihen (Collections) für "🍿 Filmreihen stöbern"
  async function searchCollectionsTMDB(env, query, page = 1) {
    const cleanQ = String(query || "").trim();
    if (!cleanQ) return null;
    const cacheKey = `colsearch_${cleanQ.toLowerCase()}_${page}`;
    const cached = getCachedTmdb(cacheKey);
    if (cached) return cached;

    const d1ColSearch = await getEntityFromD1(env, cacheKey, D1_SEARCH_TTL_MS);
    if (d1ColSearch) {
      return setCachedTmdb(cacheKey, d1ColSearch);
    }

    const url = `https://api.themoviedb.org/3/search/collection?query=${encodeURIComponent(cleanQ)}&language=de-DE&page=${page}`;
    try {
      const res = await fetchWithTimeout(url, {
        headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
      }, 4500);
      if (!res.ok) return null;
      const data = await res.json();
      const result = {
        results: (data.results || []).slice(0, 12),
        total_pages: Math.min(data.total_pages || 1, 10),
        total_results: data.total_results || 0,
        current_page: page
      };
      setCachedTmdb(cacheKey, result);
      await saveEntityToD1(env, cacheKey, "colsearch", result);
      return result;
    } catch (e) {
      return null;
    }
  }

  // Einheitliche Filter- & Sortier-Engine für Filmreihen, Filmuniversen, Personen, Genre- & Jahres-Listen (inkl. Unreleased-, Epochen-, FSK-, Studio- & Plattform-Prüfung!)
  async function filterAndSortMediaList(env, items, userSettings, sortBy = "default", alreadyFilteredByDiscover = false) {
    if (!Array.isArray(items)) return { visibleItems: [], isFiltered: false };
    const isFilterOn = userSettings?.filtersActive !== false;
    const showUnreleased = Boolean(userSettings && userSettings.showUnreleased);

    const hasIncEraFilters = isFilterOn && Array.isArray(userSettings.includedEras) && userSettings.includedEras.length > 0;
    const hasEraFilters = isFilterOn && Array.isArray(userSettings.excludedEras) && userSettings.excludedEras.length > 0;
    const hasIncGenreFilters = isFilterOn && Array.isArray(userSettings.includedGenres) && userSettings.includedGenres.length > 0;
    const hasGenreFilters = isFilterOn && Array.isArray(userSettings.excludedGenres) && userSettings.excludedGenres.length > 0;
    const hasIncFskFilters = isFilterOn && Array.isArray(userSettings.includedFsk) && userSettings.includedFsk.length > 0;
    const hasFskFilters = isFilterOn && Array.isArray(userSettings.excludedFsk) && userSettings.excludedFsk.length > 0;
    const hasFsk18Filter = hasFskFilters && userSettings.excludedFsk.includes("FSK 18");
    const hasStudioFilters = isFilterOn && (
      (Array.isArray(userSettings.includedStudios) && userSettings.includedStudios.length > 0) ||
      (Array.isArray(userSettings.excludedStudios) && userSettings.excludedStudios.length > 0)
    );
    const hasPlatformFilters = isFilterOn && (
      (Array.isArray(userSettings.includedPlatforms) && userSettings.includedPlatforms.length > 0) ||
      (Array.isArray(userSettings.excludedPlatforms) && userSettings.excludedPlatforms.length > 0)
    );

    const includedGenreIds = hasIncGenreFilters
      ? resolveGenreIdsFromNames(userSettings.includedGenres, "both")
      : new Set();

    const excludedGenreIds = hasGenreFilters
      ? resolveGenreIdsFromNames(userSettings.excludedGenres, "both")
      : new Set();

    // 1. Schnelle Vorfilterung nach Unreleased-Status, Genre-IDs, Erwachsenen-Flag und Erscheinungsjahr/Epoche
    let candidates = items.filter(item => {
      if (!item) return false;
      if (!showUnreleased && !isItemReleased(item)) return false;
      if (!isFilterOn) return true;
      if (hasFsk18Filter && item.adult) return false;
      if (includedGenreIds.size > 0 && Array.isArray(item.genre_ids) && item.genre_ids.length > 0) {
        if (!item.genre_ids.some(gid => includedGenreIds.has(gid))) return false;
      }
      if (excludedGenreIds.size > 0 && Array.isArray(item.genre_ids) && item.genre_ids.length > 0) {
        if (item.genre_ids.some(gid => excludedGenreIds.has(gid))) return false;
      }
      if (hasIncEraFilters || hasEraFilters) {
        const rawDate = item.release_date || item.first_air_date || "";
        const itemYear = parseInt(rawDate.split("-")[0], 10);
        if (itemYear) {
          if (hasIncEraFilters) {
            const isEraIncluded = userSettings.includedEras.some(eraId => {
              const era = ERA_OPTIONS.find(e => e.id === eraId);
              if (!era) return false;
              return itemYear >= era.min && itemYear <= era.max;
            });
            if (!isEraIncluded) return false;
          }
          if (hasEraFilters) {
            const isEraExcluded = userSettings.excludedEras.some(eraId => {
              const era = ERA_OPTIONS.find(e => e.id === eraId);
              if (!era) return false;
              return itemYear >= era.min && itemYear <= era.max;
            });
            if (isEraExcluded) return false;
          }
        }
      }
      return true;
    });

    // 2. Detail-Prüfung (FSK, Filmstudios & Streaming-Plattformen) über D1/TMDB-Cache
    // Wenn alreadyFilteredByDiscover = true ist, hat TMDB /discover bereits Studios & Streaming-Plattformen nativ gefiltert!
    const needsStudioOrPlatformDetailCheck = !alreadyFilteredByDiscover && (hasStudioFilters || hasPlatformFilters);
    if ((hasFskFilters || hasIncFskFilters || needsStudioOrPlatformDetailCheck) && candidates.length > 0 && env) {
      const toEnrich = candidates.slice(0, 24);
      const rest = candidates.slice(24);
      const enrichedBatch = await Promise.all(
        toEnrich.map(async (item) => {
          const isTv = item.media_type === "tv";
          const details = isTv
            ? await fetchSeriesDetails(env, item.id)
            : await fetchMovieDetails(env, item.id);
          if (details) {
            return {
              ...item,
              fsk: details.fsk || item.fsk,
              studios: details.studios,
              studiosList: details.studiosList,
              providers: details.providers,
              allProviders: details.allProviders,
              providerIds: details.providerIds
            };
          }
          return item;
        })
      );
      const allChecked = [...enrichedBatch, ...rest];
      candidates = allChecked.filter(item => {
        if (hasIncFskFilters && item.fsk && !userSettings.includedFsk.includes(item.fsk)) {
          return false;
        }
        if (hasFskFilters && item.fsk && userSettings.excludedFsk.includes(item.fsk)) {
          return false;
        }
        if (needsStudioOrPlatformDetailCheck) {
          if (!matchesStudioAndPlatformFilter(item, userSettings)) return false;
        }
        return true;
      });
    }

    // 3. Sortierung anwenden (Standard, Hinzugefügt am ▲/▼, Beliebtheit ▲/▼, Bewertung ▲/▼, Erscheinungsjahr/Datum ▲/▼)
    const sorted = candidates.slice();
    if (sortBy === "added_desc") {
      sorted.sort((a, b) => {
        const diff = (Number(b.latest_stream_at) || 0) - (Number(a.latest_stream_at) || 0);
        if (diff !== 0) return diff;
        const da = a.release_date || a.first_air_date || "0000-00-00";
        const db = b.release_date || b.first_air_date || "0000-00-00";
        return db.localeCompare(da);
      });
    } else if (sortBy === "added_asc") {
      sorted.sort((a, b) => {
        const diff = (Number(a.latest_stream_at) || 0) - (Number(b.latest_stream_at) || 0);
        if (diff !== 0) return diff;
        const da = a.release_date || a.first_air_date || "9999-99-99";
        const db = b.release_date || b.first_air_date || "9999-99-99";
        return da.localeCompare(db);
      });
    } else if (sortBy === "pop_desc") {
      sorted.sort((a, b) => (b.popularity || b.vote_count || 0) - (a.popularity || a.vote_count || 0));
    } else if (sortBy === "pop_asc") {
      sorted.sort((a, b) => (a.popularity || a.vote_count || 0) - (b.popularity || b.vote_count || 0));
    } else if (sortBy === "rating_desc") {
      sorted.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    } else if (sortBy === "rating_asc") {
      sorted.sort((a, b) => (a.vote_average || 0) - (b.vote_average || 0));
    } else if (sortBy === "year_desc") {
      sorted.sort((a, b) => {
        const da = a.release_date || a.first_air_date || "0000-00-00";
        const db = b.release_date || b.first_air_date || "0000-00-00";
        return db.localeCompare(da);
      });
    } else if (sortBy === "year_asc") {
      sorted.sort((a, b) => {
        const da = a.release_date || a.first_air_date || "9999-99-99";
        const db = b.release_date || b.first_air_date || "9999-99-99";
        return da.localeCompare(db);
      });
    }

    const isFiltered = isFilterOn && (candidates.length < items.length || hasEraFilters || hasGenreFilters || hasFskFilters || hasStudioFilters || hasPlatformFilters);
    return { visibleItems: sorted, isFiltered };
  }

  // Lädt alle Filme eines Filmuniversums (aus Kollektionen + Einzelfilmen kombiniert)
  async function fetchUniverseDetails(env, universeId) {
    const uni = CINEMATIC_UNIVERSES.find(u => u.id === universeId);
    if (!uni) return null;

    const cacheKey = `uni_${universeId}`;
    const cached = getCachedTmdb(cacheKey);
    if (cached) return cached;

    try {
      const colPromises = (uni.collectionIds || []).map(cid => fetchCollectionDetails(env, cid));
      const movIds = uni.movieIds || uni.extraMovieIds || [];
      const movPromises = movIds.map(mid => fetchMovieDetails(env, mid));

      const [cols, movs] = await Promise.all([
        Promise.all(colPromises),
        Promise.all(movPromises)
      ]);

      const seenIds = new Set();
      const parts = [];

      for (const col of cols) {
        if (!col || !Array.isArray(col.parts)) continue;
        for (const p of col.parts) {
          if (!p || !p.id || seenIds.has(p.id)) continue;
          seenIds.add(p.id);
          parts.push({ ...p, media_type: "movie" });
        }
      }

      for (const m of movs) {
        if (!m || !m.id || seenIds.has(m.id)) continue;
        seenIds.add(m.id);
        parts.push({
          id: m.id,
          title: m.title,
          release_date: m.releaseDate !== "Keine Angabe" ? m.releaseDate : "",
          vote_average: m.vote_average || 0,
          popularity: m.popularity || 50,
          genre_ids: (m.genresList || []).map(g => g.id).filter(Boolean),
          fsk: m.fsk,
          media_type: "movie"
        });
      }

      parts.sort((a, b) => {
        const da = a.release_date || "9999-99-99";
        const db = b.release_date || "9999-99-99";
        return da.localeCompare(db);
      });

      memoryFallback.set(`uni_name_${uni.id}`, uni.name);
      const result = {
        id: uni.id,
        name: uni.name,
        icon: uni.icon || "🌌",
        desc: uni.description || uni.desc || "",
        parts
      };
      return setCachedTmdb(cacheKey, result);
    } catch (e) {
      return null;
    }
  }

  // Lädt Entdecker-Listen für Genres oder alle Filme/Serien direkt über TMDb /discover inkl. nativer API-Sortierung & Filterung
  async function fetchGenreBrowsePage(env, typeCode, genreId, mode = "trend", page = 1, userSettings = null, sortBy = null) {
    const isMovie = typeCode === "m";
    const mediaPath = isMovie ? "movie" : "tv";
    const pageNum = Math.min(Math.max(1, page), 500);
    const nowDate = new Date();
    const todayStr = nowDate.toISOString().slice(0, 10);
    const minRecentDate = new Date(nowDate.getTime() - 150 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const extraFilterParams = buildTmdbStudioAndPlatformParams(userSettings, isMovie, genreId);

    const resolveTmdbSortParam = (reqSort, curMode) => {
      if (reqSort === "dir_asc") {
        if (curMode === "new") return isMovie ? "primary_release_date.asc" : "first_air_date.asc";
        if (curMode === "pop") return "vote_count.asc";
        if (curMode === "top" || curMode === "gems") return "vote_average.asc";
        return "popularity.asc";
      }
      if (reqSort === "added_asc") return isMovie ? "primary_release_date.asc" : "first_air_date.asc";
      if (reqSort === "added_desc") return isMovie ? "primary_release_date.desc" : "first_air_date.desc";
      if (reqSort === "pop_asc") return curMode === "pop" ? "vote_count.asc" : "popularity.asc";
      if (reqSort === "pop_desc") return curMode === "pop" ? "vote_count.desc" : "popularity.desc";
      if (reqSort === "rating_asc") return "vote_average.asc";
      if (reqSort === "rating_desc") return "vote_average.desc";
      if (reqSort === "year_asc") return isMovie ? "primary_release_date.asc" : "first_air_date.asc";
      if (reqSort === "year_desc") return isMovie ? "primary_release_date.desc" : "first_air_date.desc";
      if (curMode === "new") return isMovie ? "primary_release_date.desc" : "first_air_date.desc";
      if (curMode === "pop") return "vote_count.desc";
      if (curMode === "top" || curMode === "gems") return "vote_average.desc";
      return "popularity.desc";
    };

    const tmdbSortBy = resolveTmdbSortParam(sortBy, mode);
    const cacheKey = `gbrowse_v3_${typeCode}_${genreId}_${mode}_${tmdbSortBy}_${pageNum}_${extraFilterParams}`;
    const cached = getCachedTmdb(cacheKey);
    if (cached) return cached;

    let url = "";
    if (mode === "new") {
      const hasMinDateInExtra = extraFilterParams.includes("primary_release_date.gte=") || extraFilterParams.includes("first_air_date.gte=");
      const minDateClause = hasMinDateInExtra
        ? ""
        : (isMovie ? `&primary_release_date.gte=${minRecentDate}` : `&first_air_date.gte=${minRecentDate}`);
      const hasMaxDateInExtra = extraFilterParams.includes("primary_release_date.lte=") || extraFilterParams.includes("first_air_date.lte=");
      const maxDateClause = hasMaxDateInExtra
        ? ""
        : (isMovie ? `&primary_release_date.lte=${todayStr}` : `&first_air_date.lte=${todayStr}`);
      url = `https://api.themoviedb.org/3/discover/${mediaPath}?language=de-DE${extraFilterParams}${minDateClause}${maxDateClause}&sort_by=${tmdbSortBy}&vote_count.gte=1&page=${pageNum}`;
    } else if (mode === "pop") {
      url = `https://api.themoviedb.org/3/discover/${mediaPath}?language=de-DE${extraFilterParams}&sort_by=${tmdbSortBy}&vote_count.gte=150&page=${pageNum}`;
    } else if (mode === "top") {
      url = `https://api.themoviedb.org/3/discover/${mediaPath}?language=de-DE${extraFilterParams}&sort_by=${tmdbSortBy}&vote_count.gte=150&page=${pageNum}`;
    } else if (mode === "gems") {
      url = `https://api.themoviedb.org/3/discover/${mediaPath}?language=de-DE${extraFilterParams}&sort_by=${tmdbSortBy}&vote_average.gte=7.2&vote_count.gte=25&vote_count.lte=650&page=${pageNum}`;
    } else {
      url = `https://api.themoviedb.org/3/discover/${mediaPath}?language=de-DE${extraFilterParams}&sort_by=${tmdbSortBy}&vote_count.gte=10&page=${pageNum}`;
    }

    try {
      const fetchPromises = [
        fetchWithTimeout(url, {
          headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
        }, 4500)
      ];
      const hasPlatformOrStudioFilter = extraFilterParams.includes("with_watch_providers=") || extraFilterParams.includes("with_companies=") || extraFilterParams.includes("certification=");
      if (mode === "new" && (!genreId || genreId === "all") && !hasPlatformOrStudioFilter && (!sortBy || sortBy === "default" || sortBy === "added_desc" || sortBy === "year_desc") && pageNum <= 3) {
        const liveEndpoint = isMovie ? "movie/now_playing" : "tv/on_the_air";
        const liveUrl = `https://api.themoviedb.org/3/${liveEndpoint}?language=de-DE&region=DE&page=${pageNum}`;
        fetchPromises.push(
          fetchWithTimeout(liveUrl, {
            headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
          }, 4000).catch(() => null)
        );
      }

      const [res, liveRes] = await Promise.all(fetchPromises);
      let rawResults = [];
      let totalPages = 1;
      let totalResults = 0;

      if (res && res.ok) {
        const data = await res.json();
        rawResults = Array.isArray(data.results) ? data.results : [];
        totalPages = Math.min(data.total_pages || 1, 500);
        totalResults = data.total_results || rawResults.length;
      }

      if (liveRes && liveRes.ok) {
        try {
          const liveData = await liveRes.json();
          const liveItems = Array.isArray(liveData.results) ? liveData.results : [];
          const seenIds = new Set();
          const merged = [];
          for (const it of [...liveItems, ...rawResults]) {
            if (!it || !it.id || seenIds.has(it.id)) continue;
            seenIds.add(it.id);
            merged.push(it);
          }
          rawResults = merged;
          totalPages = Math.max(totalPages, Math.min(liveData.total_pages || 1, 500));
          totalResults = Math.max(totalResults, liveData.total_results || rawResults.length);
        } catch (e) {}
      }

      if (!rawResults.length && (!res || !res.ok)) return null;

      const items = rawResults.map(item => ({
        ...item,
        media_type: isMovie ? "movie" : "tv"
      }));
      const out = {
        results: items,
        total_pages: Math.max(1, totalPages),
        total_results: totalResults || items.length,
        current_page: pageNum
      };
      return setCachedTmdb(cacheKey, out);
    } catch (e) {
      return null;
    }
  }

  // Direkte D1-Datenbankabfrage für VIP-Streams (inkl. „Neu bei VIP“) ohne mehrseitiges TMDb-Scanning
  async function fetchVipStreamsDiscoverFromD1(env, typeCode, genreId, mode = "trend", page = 1, sortBy = "pop_desc", userSettings = null, targetPerPage = 20) {
    const db = await ensureD1Schema(env);
    const isMovie = typeCode === "m";
    try {
      const lastDedupeTs = Number(memoryFallback.get("last_series_dedupe_ts") || 0);
      if (!isMovie && db && (Date.now() - lastDedupeTs > 10 * 60 * 1000)) {
        memoryFallback.set("last_series_dedupe_ts", Date.now());
        await healAndDeduplicateSeriesInD1(env, false).catch(() => null);
      }
      let rows = [];
      if (db) {
        const rowsRes = isMovie
          ? await db.prepare(`
              SELECT m.tmdb_id, m.title, m.release_date, m.release_year, m.fsk, m.vote_average, m.poster_path, m.backdrop_path, m.details_json, m.updated_at AS item_updated_at,
                     MAX(mf.updated_at) AS latest_stream_at,
                     COUNT(mf.id) AS stream_count,
                     MAX(mf.quality) AS best_quality
              FROM movies m
              LEFT JOIN movie_files mf ON mf.movie_id = m.tmdb_id
              GROUP BY m.tmdb_id
            `).all()
          : await db.prepare(`
              SELECT s.tmdb_id, s.title, s.release_date, s.release_year, s.fsk, s.vote_average, s.poster_path, s.backdrop_path, s.details_json, s.updated_at AS item_updated_at,
                     MAX(ef.updated_at) AS latest_stream_at,
                     COUNT(ef.id) AS stream_count,
                     (SELECT COUNT(*) FROM series_episodes se WHERE se.series_id = s.tmdb_id) AS ep_count,
                     MAX(ef.quality) AS best_quality
              FROM series s
              LEFT JOIN episode_files ef ON ef.series_id = s.tmdb_id
              GROUP BY s.tmdb_id
            `).all();
        rows = Array.isArray(rowsRes?.results) ? rowsRes.results : [];
      }

      // Ergänze Einträge aus Memory-Fallback (falls D1 nicht gebunden oder im selben Isolate frisch importiert)
      const seenIds = new Set(rows.map(r => Number(r.tmdb_id)));
      const memPrefix = isMovie ? "d1_catalog_movie_" : "d1_catalog_series_";
      for (const [k, v] of memoryFallback.entries()) {
        if (k.startsWith(memPrefix) && v && v.id && !seenIds.has(Number(v.id))) {
          const tid = Number(v.id);
          seenIds.add(tid);
          const memQual = isMovie
            ? (memoryFallback.get(`d1_movie_files_${tid}`)?.[0]?.quality || "1080p")
            : (memoryFallback.get(`d1_series_best_quality_${tid}`) || "1080p");
          rows.push({
            tmdb_id: tid,
            title: v.title || v.name || "Unbekannt",
            release_date: v.releaseDate || v.release_date || v.first_air_date || "Keine Angabe",
            fsk: v.fsk || "FSK Keine Angabe",
            vote_average: Number(v.vote_average || 0),
            poster_path: v.poster_path || null,
            backdrop_path: v.backdrop_path || null,
            details_json: JSON.stringify(v),
            item_updated_at: Date.now(),
            latest_stream_at: Date.now(),
            stream_count: 1,
            ep_count: 1,
            best_quality: memQual
          });
        }
      }

      // Prüfe zusätzlich die globale "bot_vip"-Playlist auf importierte VIP-Titel
      const vipList = await getSavedList(env, "bot_vip").catch(() => []);
      const vipPlaylistIds = new Set();
      const targetContentType = isMovie ? "movie" : "series";
      for (const item of (vipList || [])) {
        if (item && item.tmdbId && item.contentType === targetContentType) {
          vipPlaylistIds.add(Number(item.tmdbId));
        }
      }

      if (!rows.length && vipPlaylistIds.size === 0) return null;

      // Nur Einträge mit echten verknüpften Datei-Streams in movie_files / episode_files (oder explizit mit Datei in der VIP-Playlist) anzeigen!
      // Keine 0-Datei-Serien (wie 夢で見たあの子のために (2023)) über bloße series_episodes-Metadaten durchlassen!
      const verifiedRows = rows.filter(r =>
        Number(r.stream_count || 0) > 0
      );
      const effectiveRows = verifiedRows;
      if (!effectiveRows.length) return null;

      const candidates = effectiveRows.map(r => {
        let parsed = {};
        try { parsed = JSON.parse(r.details_json || "{}"); } catch (e) {}
        const gIds = Array.isArray(parsed.genresList) ? parsed.genresList.map(g => Number(g.id)).filter(Boolean) : [];
        const rawRelDate = (r.release_date && r.release_date !== "Keine Angabe")
          ? r.release_date
          : (parsed.releaseDate && parsed.releaseDate !== "Keine Angabe" ? parsed.releaseDate : "");
        const streamTs = Number(r.latest_stream_at) || Number(r.item_updated_at) || Date.now();
        const bestQual = String(r.best_quality || memoryFallback.get(`d1_series_best_quality_${Number(r.tmdb_id)}`) || "1080p").trim();
        return {
          id: Number(r.tmdb_id),
          title: isMovie ? r.title : undefined,
          name: !isMovie ? r.title : undefined,
          release_date: isMovie ? rawRelDate : undefined,
          first_air_date: !isMovie ? rawRelDate : undefined,
          vote_average: Number(r.vote_average) || 0,
          popularity: Number(parsed.popularity) || Number(r.vote_average || 5) * 10,
          poster_path: r.poster_path || parsed.posterPath || parsed.external_poster_url || null,
          external_poster_url: parsed.external_poster_url || "",
          backdrop_path: r.backdrop_path || parsed.backdropPath || null,
          fsk: r.fsk || parsed.fsk || null,
          genre_ids: gIds,
          companyIds: Array.isArray(parsed.companyIds) ? parsed.companyIds : [],
          providerIds: Array.isArray(parsed.providerIds) ? parsed.providerIds : [],
          media_type: isMovie ? "movie" : "tv",
          latest_stream_at: streamTs,
          hasLocalStream: true,
          vipQuality: bestQual,
          vipStreamCount: Math.max(1, Number(r.stream_count || r.ep_count || 1))
        };
      });

      const cleanExplicitGenre = (genreId && genreId !== "all" && genreId !== "random_all") ? Number(genreId) : 0;
      const genreFiltered = cleanExplicitGenre
        ? candidates.filter(it => Array.isArray(it.genre_ids) && it.genre_ids.includes(cleanExplicitGenre))
        : candidates;

      const effectiveD1Sort = (!sortBy || sortBy === "default")
        ? (mode === "new" ? "added_desc" : (mode === "top" || mode === "gems") ? "rating_desc" : "added_desc")
        : sortBy;
      const filterOut = await filterAndSortMediaList(env, genreFiltered, userSettings, effectiveD1Sort, true);
      let visible = filterOut.visibleItems || [];

      const perPage = Math.max(18, Number(targetPerPage) || 20);
      const totalPages = Math.max(1, Math.ceil(visible.length / perPage));
      const reqPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
      const startIdx = (reqPage - 1) * perPage;
      const pageItems = visible.slice(startIdx, startIdx + perPage);

      return {
        items: pageItems,
        rawCount: candidates.length,
        filteredOutCount: Math.max(0, candidates.length - visible.length),
        total_pages: totalPages,
        total_results: visible.length,
        current_page: reqPage,
        hasMore: reqPage < totalPages && pageItems.length > 0
      };
    } catch (e) {
      return null;
    }
  }

  // Nutzt direkt TMDb /discover (inkl. nativer API-Filter & Sortierung) oder die lokale D1-Datenbank für VIP-Streams
  async function fetchFilteredDiscoverWithLookahead(env, typeCode, genreId, mode = "trend", page = 1, sortBy = "pop_desc", userSettings = null, targetPerPage = 18, bypassFilters = false, vipIdSets = null) {
    const requestedPage = Math.min(Math.max(1, Number(page) || 1), 500);

    if (!bypassFilters && userSettings && userSettings.onlyVipStreams) {
      const d1VipOut = await fetchVipStreamsDiscoverFromD1(env, typeCode, genreId, mode, requestedPage, sortBy, userSettings, Math.max(targetPerPage, 20));
      if (d1VipOut) {
        return d1VipOut;
      }
      return {
        items: [],
        rawCount: 0,
        filteredOutCount: 0,
        total_pages: 1,
        total_results: 0,
        current_page: 1,
        hasMore: false
      };
    }

    const firstPageData = await fetchGenreBrowsePage(env, typeCode, genreId, mode, requestedPage, bypassFilters ? null : userSettings, sortBy);
    if (!firstPageData) {
      return {
        items: [],
        rawCount: 0,
        filteredOutCount: 0,
        total_pages: 1,
        total_results: 0,
        current_page: requestedPage,
        hasMore: false
      };
    }

    const rawTotalPages = Math.min(firstPageData.total_pages || 1, 500);
    const rawFirstResults = firstPageData.results || [];
    const firstFilterOut = await filterAndSortMediaList(env, rawFirstResults, bypassFilters ? null : userSettings, sortBy, true);
    let pageItems = firstFilterOut.visibleItems || [];

    if (!bypassFilters && vipIdSets && userSettings && userSettings.onlyVipStreams) {
      pageItems = pageItems.filter(it => {
        const isTv = it.media_type === "tv" || (typeCode === "s" && it.media_type !== "movie");
        return isTv ? vipIdSets.seriesIds.has(Number(it.id)) : vipIdSets.movieIds.has(Number(it.id));
      });
    }

    const hasMore = requestedPage < rawTotalPages && pageItems.length > 0;
    const effectiveTotalPages = (!hasMore && pageItems.length > 0) ? requestedPage : Math.max(1, rawTotalPages);
    const rawTotalResults = Number(firstPageData.total_results) || rawFirstResults.length;
    const hitRatio = rawFirstResults.length > 0 ? (pageItems.length / rawFirstResults.length) : 1;
    const effectiveTotalResults = (effectiveTotalPages > 1 && pageItems.length < rawFirstResults.length)
      ? Math.max(pageItems.length, Math.round(rawTotalResults * hitRatio))
      : (effectiveTotalPages > 1 ? Math.max(pageItems.length, rawTotalResults) : pageItems.length);

    return {
      items: pageItems,
      rawCount: rawFirstResults.length,
      filteredOutCount: Math.max(0, rawFirstResults.length - pageItems.length),
      total_pages: effectiveTotalPages,
      total_results: effectiveTotalResults,
      current_page: requestedPage,
      hasMore
    };
  }

  // Lädt Filme oder Serien eines bestimmten Erscheinungsjahres (Populär, Neueste, Älteste, Bewertung)
  async function fetchYearBrowsePage(env, typeCode, year, mode = "pop", page = 1) {
    const isMovie = typeCode === "m";
    const mediaPath = isMovie ? "movie" : "tv";
    const cleanYear = parseInt(year, 10) || new Date().getFullYear();
    const pageNum = Math.min(Math.max(1, page), 500);

    const cacheKey = `ybrowse_${typeCode}_${cleanYear}_${mode}_${pageNum}`;
    const cached = getCachedTmdb(cacheKey);
    if (cached) return cached;

    const yearFilter = isMovie
      ? `primary_release_year=${cleanYear}`
      : `first_air_date_year=${cleanYear}`;

    let sortParam = "popularity.desc&vote_count.gte=5";
    if (mode === "new") {
      sortParam = isMovie ? "primary_release_date.desc&vote_count.gte=2" : "first_air_date.desc&vote_count.gte=2";
    } else if (mode === "old") {
      sortParam = isMovie ? "primary_release_date.asc&vote_count.gte=2" : "first_air_date.asc&vote_count.gte=2";
    } else if (mode === "rating") {
      sortParam = "vote_average.desc&vote_count.gte=15";
    }

    const url = `https://api.themoviedb.org/3/discover/${mediaPath}?language=de-DE&${yearFilter}&sort_by=${sortParam}&page=${pageNum}`;
    try {
      const res = await fetchWithTimeout(url, {
        headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
      }, 4500);
      if (!res.ok) return null;
      const data = await res.json();
      const items = (data.results || []).map(item => ({
        ...item,
        media_type: isMovie ? "movie" : "tv"
      }));
      const out = {
        results: items,
        total_pages: Math.min(data.total_pages || 1, 500),
        total_results: data.total_results || items.length,
        current_page: pageNum
      };
      return setCachedTmdb(cacheKey, out);
    } catch (e) {
      return null;
    }
  }

  async function fetchPersonDetails(env, personId) {
    const cacheKey = `per_${personId}`;
    const cached = getCachedTmdb(cacheKey);
    if (cached) return cached;

    const d1Per = await getEntityFromD1(env, cacheKey, D1_MOVIE_TTL_MS);
    if (d1Per) {
      if (d1Per.name) memoryFallback.set(`person_name_${personId}`, d1Per.name);
      return setCachedTmdb(cacheKey, d1Per);
    }

    const url = `https://api.themoviedb.org/3/person/${personId}?append_to_response=combined_credits&language=de-DE`;
    try {
      const res = await fetchWithTimeout(url, {
        headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
      }, 4500);
      if (!res.ok) return null;
      const data = await res.json();
      const rawCredits = [
        ...(data.combined_credits?.cast || []),
        ...(data.combined_credits?.crew || []).filter(c => c.job === "Director" || c.job === "Creator" || c.department === "Directing")
      ];
      const seen = new Set();
      const credits = [];
      for (const item of rawCredits) {
        if (!item || !item.id || (item.media_type !== "movie" && item.media_type !== "tv")) continue;
        const key = `${item.media_type}_${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        credits.push(item);
      }
      credits.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
      if (data.name) memoryFallback.set(`person_name_${personId}`, data.name);
      const result = {
        id: data.id,
        name: data.name || memoryFallback.get(`person_name_${personId}`) || "Unbekannt",
        known_for: data.known_for_department || "",
        credits
      };
      setCachedTmdb(cacheKey, result);
      await saveEntityToD1(env, cacheKey, "person", result);
      return result;
    } catch (e) {
      return null;
    }
  }

  function formatPersonLinks(personList, fallbackStr, botUsername, typeCode, itemId) {
    if (Array.isArray(personList) && personList.length > 0) {
      return personList.slice(0, 3).map((p) => {
        if (p.id && p.name) {
          memoryFallback.set(`person_name_${p.id}`, p.name);
        }
        const escaped = escapeMd(p.name);
        if (botUsername && p.id) {
          return `[${escaped}](https://t.me/${botUsername}?start=per_${p.id}_${typeCode}_${itemId})`;
        }
        return `[${escaped}](tg://search?query=${safeEncodeParam(p.name)})`;
      }).join(", ");
    }
    return formatClickableList(fallbackStr);
  }

  // Zentraler Parser für Bot-Kurzbefehle (Trends, Populär, Geheimtipps/Secret & Random mit f = Film / s = Serie):
  // - Trends:   /trend f|s, /trending f|s, /trnd f|s, /t f|s
  // - Populär:  /pop f|s, /popular f|s, /populär f|s, /p f|s
  // - Secret:   /SC f|s, /sec f|s, /secret f|s, /geheim f|s
  // - Random:   /r f|s, /rand f|s, /random f|s (optional + Genre)
  function parseBotQuickBrowseCommand(rawText) {
    const cleaned = String(rawText || "").trim();
    if (!cleaned.startsWith("/")) return null;
    const match = cleaned.match(/^\/([a-zA-ZäöüÄÖÜß]+)(?:@\w+)?(?:\s+(.*))?$/i);
    if (!match) return null;

    const cmd = match[1].toLowerCase();
    const argsRaw = String(match[2] || "").trim();

    let mode = null;
    if (["t", "trnd", "trend", "trending", "trends"].includes(cmd)) {
      mode = "trend";
    } else if (["p", "pop", "popular", "populär", "populaer"].includes(cmd)) {
      mode = "pop";
    } else if (["sc", "sec", "secret", "geheim", "geheimtipp", "geheimtipps", "gems"].includes(cmd)) {
      mode = "gems";
    } else if (["r", "rand", "random", "zufall"].includes(cmd)) {
      mode = "random";
    } else {
      return null;
    }

    const tokens = argsRaw ? argsRaw.split(/\s+/).filter(Boolean) : [];
    let explicitType = null;
    const genreTokens = [];

    for (const tok of tokens) {
      const low = tok.toLowerCase();
      if (["f", "film", "filme", "m", "movie", "movies"].includes(low)) {
        explicitType = "m";
      } else if (["s", "serie", "serien", "tv", "series"].includes(low)) {
        explicitType = "s";
      } else {
        genreTokens.push(low);
      }
    }

    const rawGenreInput = genreTokens.join(" ");
    let genreId = "all";
    let genreName = "";
    if (rawGenreInput) {
      const resolved = resolveGenreByTerm(rawGenreInput, explicitType || "m");
      if (resolved) {
        if (!explicitType && resolved.typeCode && resolved.typeCode !== "any") {
          explicitType = resolved.typeCode;
        }
        genreId = resolved.genreId || "all";
        genreName = resolved.genreName || "";
      }
    }

    return {
      mode,
      typeCode: explicitType || (mode === "random" ? "any" : "both"),
      explicitType,
      genreId: mode === "random" && genreId === "all" ? "random_all" : genreId,
      genreName
    };
  }

  // Parser für /random [f|s] [genre], /r [f|s] [genre] oder "random" oder direkte Genre-Suchen wie "Serie Drama"
  function parseRandomOrGenreCommand(rawText) {
    const cleaned = String(rawText || "").trim();
    const isSlashRandom = /^\/(?:random|rand|r|zufall)(?:@\w+)?(?:\s+.*)?$/i.test(cleaned);
    const isPlainRandom = /^random(?:\s+.*)?$/i.test(cleaned);
    const isTypeGenrePattern = /^(?:film|filme|serie|serien)\s+(.+)$/i.test(cleaned);

    if (!isSlashRandom && !isPlainRandom && !isTypeGenrePattern) return null;

    let argsStr = cleaned;
    let explicitType = null;

    if (isSlashRandom || isPlainRandom) {
      argsStr = cleaned.replace(/^\/?(?:random|rand|r|zufall)(?:@\w+)?/i, "").trim();
    } else if (isTypeGenrePattern) {
      const match = cleaned.match(/^(film|filme|serie|serien)\s+(.+)$/i);
      if (match) {
        const firstWord = match[1].toLowerCase();
        explicitType = firstWord.startsWith("s") ? "s" : "m";
        argsStr = match[2].trim();
        const resolvedCheck = resolveGenreByTerm(argsStr, explicitType);
        if (!resolvedCheck) return null;
        return resolvedCheck;
      }
    }

    const tokens = argsStr ? argsStr.split(/\s+/).filter(Boolean) : [];
    const genreTokens = [];

    for (const tok of tokens) {
      const low = tok.toLowerCase();
      if (["f", "film", "filme", "m", "movie"].includes(low)) {
        explicitType = "m";
      } else if (["s", "serie", "serien", "tv", "series"].includes(low)) {
        explicitType = "s";
      } else {
        genreTokens.push(low);
      }
    }

    const rawGenreInput = genreTokens.join(" ");
    if (!rawGenreInput) {
      const finalType = explicitType || "any";
      return {
        typeCode: finalType,
        genreId: "random_all",
        genreName: finalType === "m" ? "Zufälliger Film" : finalType === "s" ? "Zufällige Serie" : "Zufall (Film & Serie)"
      };
    }

    const resolved = resolveGenreByTerm(rawGenreInput, explicitType);
    if (resolved) return resolved;

    const fallbackType = explicitType || "any";
    return {
      typeCode: fallbackType,
      genreId: "random_all",
      genreName: fallbackType === "m" ? "Zufälliger Film" : fallbackType === "s" ? "Zufällige Serie" : "Zufall (Film & Serie)"
    };
  }

  async function fetchYouTubeTrailer(env, itemId, contentType, preloadedDetails = null) {
    if (preloadedDetails && preloadedDetails.trailerKey !== undefined) {
      return preloadedDetails.trailerKey;
    }
    const cached = getCachedTmdb(contentType === "movie" ? `movie_${itemId}` : `tv_${itemId}`);
    if (cached && cached.trailerKey !== undefined) return cached.trailerKey;

    const typePath = contentType === "movie" ? "movie" : "tv";
    const urlDe = `https://api.themoviedb.org/3/${typePath}/${itemId}/videos?language=de-DE`;
    try {
      let res = await fetchWithTimeout(urlDe, {
        headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
      }, 3200);
      if (res.ok) {
        const data = await res.json();
        const key = extractYoutubeTrailerFromVideos(data);
        if (key) return key;
      }
      const urlEn = `https://api.themoviedb.org/3/${typePath}/${itemId}/videos?language=en-US`;
      let resEn = await fetchWithTimeout(urlEn, {
        headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
      }, 3200);
      if (resEn.ok) {
        const dataEn = await resEn.json();
        const keyEn = extractYoutubeTrailerFromVideos(dataEn);
        if (keyEn) return keyEn;
      }
    } catch (e) {}
    return null;
  }

  // Hilfsfunktion: Lädt eine einzelne Roh-Suchseite von TMDB (mit Memory- & D1-Cache)
  async function fetchRawSearchMultiPage(env, effectiveQuery, includeAdult, pageNum) {
    const rawCacheKey = `search_${effectiveQuery.toLowerCase()}_${includeAdult}_${pageNum}`;
    let data = getCachedTmdb(rawCacheKey);
    if (!data) {
      data = await getSearchCacheFromD1(env, rawCacheKey);
      if (data) setCachedTmdb(rawCacheKey, data);
    }
    if (!data) {
      const url = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(effectiveQuery)}&language=de-DE&include_adult=${includeAdult}&page=${pageNum}`;
      const res = await fetchWithTimeout(url, {
        headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
      }, 5500);
      if (!res.ok) return null;
      data = await res.json();
      setCachedTmdb(rawCacheKey, data);
      await saveSearchCacheToD1(env, rawCacheKey, effectiveQuery, pageNum, data);
    }
    return data;
  }

  // Erkennt ein Jahr in Klammern (z.B. "Dune (2021)", "1917 (2019)", "(2024)") als Jahresfilter und trennt es vom Suchtitel.
  // Unterstützt Ausnahmen: Wenn ein Jahr in Klammern tatsächlich Teil des Titels ist (0 Treffer mit Jahresfilter), greift automatisch der Volltext-Fallback.
  function parseSearchQueryYearAndTitle(rawInput) {
    const raw = String(rawInput || "").trim();
    const pureYearMatch = raw.match(/^\(\s*(19\d{2}|20[0-3]\d)\s*\)$/);
    if (pureYearMatch) {
      return {
        cleanTitle: "",
        filterYear: parseInt(pureYearMatch[1], 10),
        rawQuery: raw,
        isYearOnly: true
      };
    }
    const parenYearRegex = /\(\s*(19\d{2}|20[0-3]\d)\s*\)/g;
    let match;
    let lastMatch = null;
    while ((match = parenYearRegex.exec(raw)) !== null) {
      lastMatch = match;
    }
    if (lastMatch) {
      const extractedYear = parseInt(lastMatch[1], 10);
      const stripped = (raw.slice(0, lastMatch.index) + " " + raw.slice(lastMatch.index + lastMatch[0].length))
        .replace(/\s+/g, " ")
        .trim();
      if (stripped.length > 0) {
        return {
          cleanTitle: stripped,
          filterYear: extractedYear,
          rawQuery: raw,
          isYearOnly: false
        };
      }
    }
    return {
      cleanTitle: raw,
      filterYear: null,
      rawQuery: raw,
      isYearOnly: false
    };
  }

  // Suche mit Paginierung, bis zu 5-Seiten Voraus-Bündelung bei aktiven Filtern, dynamischer Seitenzahl-Anpassung,
  // Synonym-Umschreibung, Sortierung (Beliebtheit ▲/▼, Bewertung ▲/▼, Jahr ▲/▼) & Live-Filterung (inkl. temporärem Filter-Bypass)
  async function searchTMDBPage(env, query, userSettings, page = 1, sortBy = "pop_desc", ignoreFilters = false) {
    const isFilterOn = !ignoreFilters && (userSettings.filtersActive !== false);
    const includeAdult = isFilterOn && (userSettings.excludedFsk || []).includes("FSK 18") ? "false" : "true";

    const parsedYearQuery = parseSearchQueryYearAndTitle(query);
    const baseQueryForSynonyms = parsedYearQuery.isYearOnly ? String(parsedYearQuery.filterYear) : (parsedYearQuery.cleanTitle || query);
    const rewritten = rewriteQueryWithSynonyms(baseQueryForSynonyms);
    const effectiveQuery = rewritten.query || baseQueryForSynonyms;
    const explicitFilterYear = parsedYearQuery.filterYear;

    const pageNum = Math.min(Math.max(1, page), 500);

    const hasIncGenres = isFilterOn && Array.isArray(userSettings.includedGenres) && userSettings.includedGenres.length > 0;
    const hasExcGenres = isFilterOn && Array.isArray(userSettings.excludedGenres) && userSettings.excludedGenres.length > 0;
    const hasIncEras = isFilterOn && Array.isArray(userSettings.includedEras) && userSettings.includedEras.length > 0;
    const hasExcEras = isFilterOn && Array.isArray(userSettings.excludedEras) && userSettings.excludedEras.length > 0;
    const hasFskFilters = isFilterOn && (
      (Array.isArray(userSettings.excludedFsk) && userSettings.excludedFsk.length > 0) ||
      (Array.isArray(userSettings.includedFsk) && userSettings.includedFsk.length > 0)
    );
    const hasStudioFilters = isFilterOn && (
      (Array.isArray(userSettings.includedStudios) && userSettings.includedStudios.length > 0) ||
      (Array.isArray(userSettings.excludedStudios) && userSettings.excludedStudios.length > 0)
    );
    const hasPlatformFilters = isFilterOn && (
      (Array.isArray(userSettings.includedPlatforms) && userSettings.includedPlatforms.length > 0) ||
      (Array.isArray(userSettings.excludedPlatforms) && userSettings.excludedPlatforms.length > 0)
    );
    const anyStrictFilterActive = Boolean(explicitFilterYear) || hasIncGenres || hasExcGenres || hasIncEras || hasExcEras || hasFskFilters || hasStudioFilters || hasPlatformFilters;

    const filterSyncPass = (rawList, enforceExplicitYear = true) => {
      const showUnreleased = Boolean(userSettings && userSettings.showUnreleased);
      let list = rawList.slice();

      if (!ignoreFilters && !showUnreleased && (!explicitFilterYear || explicitFilterYear <= new Date().getFullYear())) {
        list = list.filter(item => isItemReleased(item));
      }

      if (enforceExplicitYear && explicitFilterYear) {
        list = list.filter(item => {
          const rawDate = item.release_date || item.first_air_date || "";
          const itemYear = parseInt(rawDate.split("-")[0], 10);
          return itemYear === explicitFilterYear;
        });
      }

      if (hasIncGenres) {
        const includedGenreIds = resolveGenreIdsFromNames(userSettings.includedGenres, "both");
        if (includedGenreIds.size > 0) {
          list = list.filter(item => {
            const gIds = item.genre_ids || [];
            return gIds.some(id => includedGenreIds.has(id));
          });
        }
      }

      if (hasExcGenres) {
        const excludedGenreIds = resolveGenreIdsFromNames(userSettings.excludedGenres, "both");
        if (excludedGenreIds.size > 0) {
          list = list.filter(item => {
            const gIds = item.genre_ids || [];
            return !gIds.some(id => excludedGenreIds.has(id));
          });
        }
      }

      if (!explicitFilterYear && (hasIncEras || hasExcEras)) {
        list = list.filter(item => {
          const rawDate = item.release_date || item.first_air_date || "";
          const itemYear = parseInt(rawDate.split("-")[0], 10);
          if (!itemYear) return true;
          if (hasIncEras) {
            const isInc = userSettings.includedEras.some(eraId => {
              const era = ERA_OPTIONS.find(e => e.id === eraId);
              return era ? (itemYear >= era.min && itemYear <= era.max) : false;
            });
            if (!isInc) return false;
          }
          if (hasExcEras) {
            const isEraExcluded = userSettings.excludedEras.some(eraId => {
              const era = ERA_OPTIONS.find(e => e.id === eraId);
              if (!era) return false;
              return itemYear >= era.min && itemYear <= era.max;
            });
            if (isEraExcluded) return false;
          }
          return true;
        });
      }
      return list;
    };

    try {
      // Spezialfall 1: Suche besteht nur aus "(YYYY)" -> Direkt alle Filme & Serien dieses Erscheinungsjahres laden!
      if (parsedYearQuery.isYearOnly && explicitFilterYear) {
        const [yrMovies, yrSeries] = await Promise.all([
          fetchYearBrowsePage(env, "m", explicitFilterYear, "pop", pageNum).catch(() => null),
          fetchYearBrowsePage(env, "s", explicitFilterYear, "pop", pageNum).catch(() => null)
        ]);
        const combinedRaw = [
          ...((yrMovies && yrMovies.results) || []),
          ...((yrSeries && yrSeries.results) || [])
        ];
        const rawTotalPages = Math.min(500, Math.max(yrMovies?.total_pages || 1, yrSeries?.total_pages || 1));
        const rawTotalResults = (yrMovies?.total_results || 0) + (yrSeries?.total_results || 0);
        let results = filterSyncPass(combinedRaw, true);
        results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        return {
          results: results.slice(0, 10),
          allFilteredResults: results,
          total_pages: rawTotalPages,
          total_results: Math.max(results.length, rawTotalResults),
          current_page: pageNum,
          movieCount: results.filter(i => i.media_type === "movie").length,
          seriesCount: results.filter(i => i.media_type === "tv").length,
          rewrittenTo: `Erscheinungsjahr ${explicitFilterYear}`,
          filteredOutBySettings: false,
          rawUnfilteredCount: combinedRaw.length
        };
      }

      let data = await fetchRawSearchMultiPage(env, effectiveQuery, includeAdult, pageNum);
      if (!data) return null;

      let rawTotalPages = Math.min(data.total_pages || 1, 500);
      let rawMediaResults = (data.results || []).filter(i => i.media_type === "movie" || i.media_type === "tv");
      let results = filterSyncPass(rawMediaResults, true);
      let lastScannedPage = pageNum;

      // Parallele Multi-Page-Bündelung (bis zu 6 TMDb-Suchseiten gleichzeitig via Promise.all),
      // sobald irgendein strikter Filter aktiv ist (insb. Streaming-Anbieter wie Netflix, Studios, FSK, Genres, Jahr),
      // damit kombinierte Suchen wie Name: "der" + Anbieter: "Netflix" sofort viele Treffer liefern statt seitenweise zu warten!
      const needsDeepParallelScan = (!ignoreFilters || explicitFilterYear) && (
        hasPlatformFilters ||
        hasStudioFilters ||
        hasFskFilters ||
        (anyStrictFilterActive && results.length < 14)
      );
      if (needsDeepParallelScan && pageNum < rawTotalPages) {
        const extraPages = [];
        for (let p = pageNum + 1; p <= Math.min(rawTotalPages, pageNum + 5); p++) {
          extraPages.push(p);
        }
        if (extraPages.length > 0) {
          const extraDataList = await Promise.all(
            extraPages.map(p => fetchRawSearchMultiPage(env, effectiveQuery, includeAdult, p).catch(() => null))
          );
          const seenKeys = new Set(rawMediaResults.map(i => `${i.media_type}_${i.id}`));
          for (let idx = 0; idx < extraDataList.length; idx++) {
            const exData = extraDataList[idx];
            if (!exData || !Array.isArray(exData.results)) continue;
            lastScannedPage = extraPages[idx];
            const exMedia = exData.results.filter(i => (i.media_type === "movie" || i.media_type === "tv") && !seenKeys.has(`${i.media_type}_${i.id}`));
            exMedia.forEach(i => seenKeys.add(`${i.media_type}_${i.id}`));
            rawMediaResults.push(...exMedia);
            const exFiltered = filterSyncPass(exMedia, true);
            results.push(...exFiltered);
          }
        }
      }

      // Spezialfall 2 (Ausnahme-Lösung): Jahr in Klammern "(YYYY)" ist Teil des echten Filmtitels (0 Treffer mit Jahresfilter)
      // -> Automatischer Fallback auf die wörtliche Suche inkl. Klammern ohne Jahreszwang!
      if (explicitFilterYear && results.length === 0 && pageNum === 1) {
        const literalData = await fetchRawSearchMultiPage(env, parsedYearQuery.rawQuery, includeAdult, 1).catch(() => null);
        const literalMedia = (literalData?.results || []).filter(i => i.media_type === "movie" || i.media_type === "tv");
        const fallbackPool = literalMedia.length > 0 ? literalMedia : rawMediaResults;
        const fallbackFiltered = filterSyncPass(fallbackPool, false);
        if (fallbackFiltered.length > 0) {
          results = fallbackFiltered;
          rawMediaResults = fallbackPool;
          rawTotalPages = Math.min(literalData?.total_pages || 1, 500);
        }
      }

      const rawUnfilteredCount = rawMediaResults.length;

      // Paralleler D1-Katalog- & Detail-Abgleich für FSK, Filmstudios & Streaming-Anbieter (bis zu 36 Kandidaten gleichzeitig)
      if ((hasFskFilters || hasStudioFilters || hasPlatformFilters) && results.length > 0 && env) {
        const candidateSlice = results.slice(0, 36);
        const enriched = await Promise.all(
          candidateSlice.map(async (item) => {
            const details = item.media_type === "tv"
              ? await fetchSeriesDetails(env, item.id)
              : await fetchMovieDetails(env, item.id);
            return details
              ? {
                  ...item,
                  fsk: details.fsk || item.fsk,
                  studios: details.studios,
                  studiosList: details.studiosList,
                  providers: details.providers,
                  allProviders: details.allProviders,
                  providerIds: details.providerIds
                }
              : item;
          })
        );
        results = enriched.filter(item => {
          if (hasFskFilters && item.fsk && userSettings.excludedFsk.includes(item.fsk)) return false;
          if ((hasStudioFilters || hasPlatformFilters) && !matchesStudioAndPlatformFilter(item, userSettings)) return false;
          return true;
        });
      }

      const filteredOutBySettings = isFilterOn && rawUnfilteredCount > 0 && results.length === 0;

      // Sortierung anwenden (Beliebtheit ▲/▼, Bewertung ▲/▼, Erscheinungsjahr ▲/▼)
      results = results.slice().sort((a, b) => {
        if (sortBy === "pop_asc") {
          return (a.popularity || 0) - (b.popularity || 0);
        }
        if (sortBy === "rating_desc") {
          return (b.vote_average || 0) - (a.vote_average || 0);
        }
        if (sortBy === "rating_asc") {
          return (a.vote_average || 0) - (b.vote_average || 0);
        }
        if (sortBy === "year_desc") {
          const ya = parseInt((a.release_date || a.first_air_date || "").split("-")[0], 10) || 0;
          const yb = parseInt((b.release_date || b.first_air_date || "").split("-")[0], 10) || 0;
          return yb - ya;
        }
        if (sortBy === "year_asc") {
          const ya = parseInt((a.release_date || a.first_air_date || "").split("-")[0], 10) || 9999;
          const yb = parseInt((b.release_date || b.first_air_date || "").split("-")[0], 10) || 9999;
          return ya - yb;
        }
        return (b.popularity || 0) - (a.popularity || 0);
      });

      const movieCount = results.filter(i => i.media_type === "movie").length;
      const seriesCount = results.filter(i => i.media_type === "tv").length;
      const totalFilteredOnPage = results.length;

      // Dynamische Anpassung der Gesamt-Seitenzahl nach dem Filtern
      const hitRatio = rawUnfilteredCount > 0 ? (totalFilteredOnPage / rawUnfilteredCount) : 1;
      let effectiveTotalPages = rawTotalPages;
      if (anyStrictFilterActive && hitRatio < 0.85) {
        effectiveTotalPages = Math.max(
          totalFilteredOnPage > 0 ? pageNum : Math.max(1, pageNum - 1),
          Math.min(rawTotalPages, Math.ceil(rawTotalPages * Math.max(0.05, hitRatio)))
        );
        if (lastScannedPage >= rawTotalPages && totalFilteredOnPage <= 10) {
          effectiveTotalPages = totalFilteredOnPage > 0 ? pageNum : Math.max(1, pageNum - 1);
        }
      }
      const totalResults = anyStrictFilterActive
        ? Math.max(totalFilteredOnPage, Math.round((data.total_results || totalFilteredOnPage) * hitRatio))
        : (data.total_results && data.total_pages > 1 ? data.total_results : totalFilteredOnPage);

      return {
        results: results.slice(0, 10),
        allFilteredResults: results,
        total_pages: Math.max(1, effectiveTotalPages),
        current_page: pageNum,
        total_results: totalResults,
        page_total: totalFilteredOnPage,
        movie_count: movieCount,
        series_count: seriesCount,
        rewrittenFrom: rewritten.rewrittenFrom,
        effectiveQuery,
        filteredOutBySettings,
        rawUnfilteredCount,
        ignoreFilters: Boolean(ignoreFilters)
      };
    } catch (e) {
      return null;
    }
  }
