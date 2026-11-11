  // @DEPARTMENT: 07-webhook-callbacks | 7. Telegram Webhook-Router & Callback-Handler
  // @ANCHOR: WEBHOOK_ROUTER
  // --- Hilfsfunktion für /zurück Navigation ---
  async function handleBackNavigation(env, chatId, firstName = "Filmfreund") {
    const listCtx = memoryFallback.get(`active_list_ctx_${chatId}`);
    if (listCtx) {
      memoryFallback.delete(`active_list_ctx_${chatId}`);
      if (listCtx.type === "ep" && listCtx.seriesId) {
        const targetName = memoryFallback.get(`title_cache_s_${listCtx.seriesId}`) || `Serie #${listCtx.seriesId}`;
        const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sdet_s_${listCtx.seriesId}`, targetName);
        await sendItemCard(env, chatId, { id: listCtx.seriesId }, "s", null, null, loadingMsgId, null, "keep_origin");
        return;
      }
      if (listCtx.type === "gbr" && listCtx.id) {
        const [typeCode, genreId] = String(listCtx.id).split("_");
        if (genreId && genreId !== "all") {
          await showGenreActionMenu(env, chatId, genreId, typeCode || "m", "", null);
        } else {
          await showGenres(env, chatId, typeCode || "m", null);
        }
        return;
      }
      if (listCtx.type === "genre_action") {
        await showGenres(env, chatId, listCtx.typeCode || "m", null);
        return;
      }
      if (listCtx.type === "ybr" && listCtx.id) {
        const [typeCode, year, , , originId] = String(listCtx.id).split("_");
        await showYearActionMenu(env, chatId, year || "2024", typeCode || "m", originId || "", null);
        return;
      }
      if (listCtx.type === "col") {
        await showCollectionsBrowser(env, chatId, 1, "", null);
        return;
      }
      if (listCtx.type === "uni") {
        await showUniversesBrowser(env, chatId, 1, null);
        return;
      }
      if (listCtx.type === "per" && listCtx.id) {
        await showPersonActionMenu(env, chatId, listCtx.id, "m", "", null);
        return;
      }
    }

    const wlState = await getWishlistViewState(env, chatId);
    if (wlState && wlState.currentFolderId && wlState.currentFolderId !== "root") {
      const folders = await getFolders(env, chatId);
      const curFolder = folders.find(f => f.id === wlState.currentFolderId);
      let parentFolder = "root";
      if (curFolder?.type === "collection") parentFolder = "cat_col";
      else if (curFolder?.type === "universe") parentFolder = "cat_uni";
      else if (curFolder?.type === "series_show") parentFolder = "cat_series";
      await saveWishlistViewState(env, chatId, { currentFolderId: parentFolder, searchQuery: "", page: 1 });
      await displaySavedList(env, chatId, null);
      return;
    }

    const searchState = await getSearchState(env, chatId);
    if (searchState && searchState.query) {
      await displaySearchResults(env, chatId, searchState.query, searchState.page || 1, null, searchState.sortBy, searchState.ignoreFilters);
      return;
    }

    await initialMenu(env, chatId, firstName);
  }

  // --- Smarte Titel-Normalisierung & TMDb Confidence-Berechnung (0..100%) ---
  function normalizeTitleForConfidence(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/½/g, " 1 2 ")
      .replace(/\b1\/2\b/g, " 1 2 ")
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(?:ii)\b/g, "2")
      .replace(/\b(?:iii)\b/g, "3")
      .replace(/\b(?:iv)\b/g, "4")
      .replace(/\b(?:v)\b/g, "5")
      .replace(/\b(?:vi)\b/g, "6")
      .replace(/\b(?:vii)\b/g, "7")
      .replace(/\b(?:viii)\b/g, "8")
      .replace(/\b(?:ix)\b/g, "9")
      .replace(/\b(?:x)\b/g, "10")
      .replace(/\b(?:der|die|das|the|a|an|ein|eine)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function computeStringSimilarityScore(aNorm, bNorm) {
    if (!aNorm || !bNorm) return 0;
    if (aNorm === bNorm) return 100;
    if (aNorm.length >= 4 && bNorm.length >= 4) {
      if (bNorm.startsWith(aNorm) || aNorm.startsWith(bNorm)) {
        const ratio = Math.min(aNorm.length, bNorm.length) / Math.max(aNorm.length, bNorm.length);
        return Math.round(80 + ratio * 16);
      }
      if (bNorm.includes(aNorm) || aNorm.includes(bNorm)) {
        const ratio = Math.min(aNorm.length, bNorm.length) / Math.max(aNorm.length, bNorm.length);
        return Math.round(72 + ratio * 18);
      }
    }
    const aTokens = aNorm.split(" ").filter(Boolean);
    const bTokens = bNorm.split(" ").filter(Boolean);
    const bSet = new Set(bTokens);
    let sharedTokens = 0;
    for (const t of aTokens) {
      if (bSet.has(t)) sharedTokens++;
    }
    const tokenDice = (aTokens.length + bTokens.length) > 0
      ? (2 * sharedTokens) / (aTokens.length + bTokens.length)
      : 0;

    const getBigrams = (s) => {
      const clean = s.replace(/\s+/g, "");
      const arr = [];
      for (let i = 0; i < clean.length - 1; i++) arr.push(clean.slice(i, i + 2));
      return arr;
    };
    const aBi = getBigrams(aNorm);
    const bBi = getBigrams(bNorm);
    let biShared = 0;
    if (aBi.length > 0 && bBi.length > 0) {
      const used = new Array(bBi.length).fill(false);
      for (let i = 0; i < aBi.length; i++) {
        for (let j = 0; j < bBi.length; j++) {
          if (!used[j] && aBi[i] === bBi[j]) {
            used[j] = true;
            biShared++;
            break;
          }
        }
      }
    }
    const biDice = (aBi.length + bBi.length) > 0
      ? (2 * biShared) / (aBi.length + bBi.length)
      : 0;

    return Math.round((tokenDice * 0.55 + biDice * 0.45) * 92);
  }

  function computeTmdbMatchConfidence(parsed, candidate, candidateTypeCode = "m") {
    if (!candidate || !parsed) return 0;
    const queryRaw = String(parsed.cleanTitle || "").trim();
    const queryNorm = normalizeTitleForConfidence(queryRaw);
    if (!queryNorm) return 0;

    const titleDe = String(candidate.title || candidate.name || "").trim();
    const titleOrig = String(candidate.original_title || candidate.original_name || "").trim();
    const normDe = normalizeTitleForConfidence(titleDe);
    const normOrig = normalizeTitleForConfidence(titleOrig);
    const simDe = computeStringSimilarityScore(queryNorm, normDe);
    const simOrig = computeStringSimilarityScore(queryNorm, normOrig);
    let score = Math.max(simDe, simOrig);

    // MODUL 6.2: 100%-Titel-Match & Untertitel-Match (z.B. "Alien 2 - Die Rückkehr" <-> "Aliens - Die Rückkehr")
    const extractSubtitleAfterHyphen = (str) => {
      const parts = String(str || "").split(/\s*[-–—:]\s*/);
      return parts.length >= 2 ? normalizeTitleForConfidence(parts.slice(1).join(" ")) : "";
    };
    const querySubNorm = extractSubtitleAfterHyphen(queryRaw);
    const candSubDeNorm = extractSubtitleAfterHyphen(titleDe);
    const candSubOrigNorm = extractSubtitleAfterHyphen(titleOrig);
    const isExactSubtitleMatch = Boolean(
      querySubNorm && querySubNorm.length >= 4 && (
        querySubNorm === candSubDeNorm ||
        querySubNorm === candSubOrigNorm ||
        querySubNorm === normDe ||
        querySubNorm === normOrig
      )
    );
    const isExactFullTitleMatch = Boolean(queryNorm && (queryNorm === normDe || queryNorm === normOrig));
    const isExactTitleOrSubtitleMatch = isExactFullTitleMatch || isExactSubtitleMatch;
    if (isExactTitleOrSubtitleMatch) {
      score = Math.max(score, 96);
    }

    // Unicode-sicherer Vergleich (damit CJK-/japanische Titel wie "夢で見たあの子のために" nicht zu Leerstrings/Ziffern gestrippt werden!)
    const rawLowerA = queryRaw.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const rawLowerB = titleDe.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const rawLowerC = titleOrig.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (rawLowerA && (rawLowerA === rawLowerB || rawLowerA === rawLowerC)) {
      score = Math.max(score, 95);
    }

    // Non-Latin-Script-Guard: Wenn der Dateiname lateinische Buchstaben enthält, der TMDb-Treffer aber weder in titleDe noch in titleOrig lateinische Buchstaben besitzt (reines Kanji/Kana/Kyrillisch), deckele Confidence strikt!
    const queryHasLatin = /[a-zäöüß]/i.test(queryRaw);
    const candHasLatin = /[a-zäöüß]/i.test(titleDe) || /[a-zäöüß]/i.test(titleOrig);
    if (queryHasLatin && !candHasLatin) {
      return 10;
    }

    const candDate = String(candidate.release_date || candidate.first_air_date || "");
    const candYear = parseInt(candDate.split("-")[0], 10) || null;
    if (parsed.year && candYear) {
      const diff = Math.abs(Number(parsed.year) - candYear);
      // Spezial-Schutz für Serien-Episoden mit Ausstrahlungsjahr im Dateinamen (z. B. "Maxe Baumann · 03 Max auf Reisen (DDR 1978)" bis "(DDR 1982)" bei Serienstart 1976):
      const isOngoingSeriesEp = Boolean(
        parsed.isSeries &&
        parsed.hasExplicitEpisodePattern &&
        candidateTypeCode === "s" &&
        score >= 88 &&
        Number(parsed.year) >= candYear &&
        (Number(parsed.year) - candYear) <= 20
      );
      if (isOngoingSeriesEp) {
        score += 6;
      } else if (diff === 0) {
        score += 10;
      } else if (diff === 1) {
        score += 6;
      } else if (diff <= 3 && isExactTitleOrSubtitleMatch) {
        // MODUL 6.2: Bei 100% Titel- oder Untertitel-Übereinstimmung bis zu ±3 Jahre Produktions-/Release-Toleranz gewähren!
        score += 4;
      } else if (diff === 2) {
        score -= 5;
      } else {
        // HARTE SPERRE GEGEN FALSCHE JAHRZEHNTE:
        score = Math.min(score - 35, 48);
      }
    } else if (!parsed.year) {
      // Ohne Jahresangabe im Dateinamen: Deutschsprachige Produktionen (DE/AT/CH/XG) bei exakter Namensgleichheit bevorzugen,
      // sowie leichter Bonus für populäre Haupttreffer, aber Deckelung bei unsicheren Teil-Treffern
      const isDach = String(candidate.original_language || "").toLowerCase() === "de" ||
        (Array.isArray(candidate.origin_country) && candidate.origin_country.some(c => /^(?:DE|AT|CH|XG)$/i.test(String(c || "").trim())));
      if (isDach && score >= 95) {
        score = Math.min(99, score + 3);
      } else if (Number(candidate.vote_count || 0) > 150 && score >= 82) {
        score += 3;
      }
      if (score < 88) score = Math.min(score, 75);
    }

    // 3. Beschreibungs-Fingerabdruck (Telegram Nachbar-Post contextOverview vs. TMDb overview)
    if (parsed.contextOverview && candidate.overview) {
      const ctxWords = Array.from(
        new Set(
          String(parsed.contextOverview)
            .toLowerCase()
            .split(/[^\p{L}\d]+/u)
            .filter(w => w.length >= 5)
        )
      );
      if (ctxWords.length > 0) {
        const ovLow = String(candidate.overview).toLowerCase();
        let ovMatches = 0;
        for (const w of ctxWords) {
          if (ovLow.includes(w)) ovMatches++;
        }
        if (ovMatches > 0) {
          score += Math.min(ovMatches * 5, 22);
        }
      }
    }

    // 4. Bekanntheits-Bonus (Schutz gegen billige Mockbuster im selben Jahr)
    if (candidateTypeCode === "m" && score >= 68) {
      const votes = Number(candidate.vote_count || 0);
      if (votes > 1000) score += 5;
      else if (votes > 200) score += 3;
      else if (votes < 10 && parsed.year) score -= 8;
    }

    // Wenn ein Eintrag als Film mit Jahreszahl erkannt wurde (!parsed.isSeries && parsed.year), blockiere TV-Serien-Kandidaten strikt
    if (!parsed.isSeries && parsed.year && candidateTypeCode === "s") {
      score = Math.min(score - 35, 40);
    }

    if (parsed.hasExplicitEpisodePattern && candidateTypeCode === "m") {
      score -= 18;
    }

    return Math.max(5, Math.min(100, Math.round(score)));
  }

  async function saveFallbackHitToD1AndCache(env, fb) {
    if (!fb || !fb.id) return null;
    if (fb.typeCode === "s") {
      const seriesObj = {
        id: Number(fb.id),
        title: fb.title || "Unbekannt",
        releaseDate: fb.releaseDate || (fb.year && fb.year !== "k.A." ? `${fb.year}-01-01` : "Keine Angabe"),
        fsk: "FSK Keine Angabe",
        statusText: fb.statusText || "Unbekannt",
        vote_average: Number(fb.vote_average || 0),
        runtime: fb.runtime || "Keine Angabe",
        country: fb.country || "k.A.",
        genres: fb.genres || "Serie",
        directors: fb.directors || "Keine Angabe",
        casts: fb.casts || "Keine Angabe",
        overview: fb.overview || "Keine Beschreibung verfügbar.",
        poster_path: null,
        external_poster_url: fb.poster || fb.external_poster_url || "",
        backdrop_path: null,
        numberOfSeasons: 1,
        numberOfEpisodes: 0,
        seasons: [{ season_number: 1, name: "Staffel 1", episode_count: 0, air_date: "" }],
        sourceFallback: fb.source || "Fallback"
      };
      setCachedTmdb(`tv_${seriesObj.id}`, seriesObj);
      await saveSeriesToD1(env, seriesObj);
      return seriesObj;
    } else {
      const movieObj = {
        id: Number(fb.id),
        title: fb.title || "Unbekannt",
        releaseDate: fb.releaseDate || (fb.year && fb.year !== "k.A." ? `${fb.year}-01-01` : "Keine Angabe"),
        fsk: "FSK Keine Angabe",
        vote_average: Number(fb.vote_average || 0),
        runtime: fb.runtime || "Keine Angabe",
        country: fb.country || "k.A.",
        genres: fb.genres || "Film",
        directors: fb.directors || "Keine Angabe",
        casts: fb.casts || "Keine Angabe",
        overview: fb.overview || "Keine Beschreibung verfügbar.",
        poster_path: null,
        external_poster_url: fb.poster || fb.external_poster_url || "",
        backdrop_path: null,
        sourceFallback: fb.source || "Fallback"
      };
      setCachedTmdb(`movie_${movieObj.id}`, movieObj);
      await saveMovieToD1(env, movieObj);
      return movieObj;
    }
  }

  async function searchTmdbCandidatesForImport(env, parsed, forceTypeCode = null, options = null) {
    const rawSearchTitle = String(parsed?.cleanTitle || parsed?.title || "").trim();
    if ((!rawSearchTitle || rawSearchTitle === "Unbekannt") && !parsed?.tmdbId && !parsed?.imdbId) return [];

    const isTurboMode = options?.speedProfile === "free_turbo" || options?.fallbackMode === "smart_emergency";
    const isBatchImport = Boolean(options?.isBatchImport);
    const earlyStopConf = isTurboMode ? 76 : 85;

    // 1. Doppelpunkt nach Römischen Zahlen erzwingen ("Star Trek II Der Zorn des Khan" -> "Star Trek II: Der Zorn des Khan")
    const searchTitle = rawSearchTitle.replace(/\b(I{1,3}|IV|V|VI{1,3}|IX|X)\s+([A-ZÄÖÜ])/g, "$1: $2");

    const primaryType = forceTypeCode || (parsed.isSeries ? "s" : "m");
    const secondaryType = primaryType === "s" ? "m" : "s";
    const rawPool = [];
    const headers = {
      accept: "application/json",
      Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}`
    };

    // Gold-Master Stufe 1: Direkte TMDb-ID aus Steckbrief / Link
    if (parsed?.tmdbId) {
      const endpoint = primaryType === "s" ? "tv" : "movie";
      const directData = await cachedExternalFetchJson(`https://api.themoviedb.org/3/${endpoint}/${parsed.tmdbId}?language=de-DE`, { headers });
      if (directData && directData.id) {
        rawPool.push({ ...directData, _typeCode: primaryType, _directIdHit: true });
      }
    }

    const runTmdbQuery = async (tc, qStr, yearVal, baseTitleOverride = null) => {
      if (!qStr || qStr.length < 1) return 0;
      const endpoint = tc === "s" ? "tv" : "movie";
      const yearParam = yearVal
        ? (tc === "s" ? `&first_air_date_year=${yearVal}` : `&primary_release_year=${yearVal}`)
        : "";
      const url = `https://api.themoviedb.org/3/search/${endpoint}?query=${encodeURIComponent(qStr)}${yearParam}&language=de-DE&page=1`;
      const data = await cachedExternalFetchJson(url, { headers });
      if (Array.isArray(data?.results)) {
        for (const item of data.results.slice(0, 6)) {
          rawPool.push({ ...item, _typeCode: tc, ...(baseTitleOverride ? { _baseTitleForConf: baseTitleOverride } : {}) });
        }
        return data.results.length;
      }
      return 0;
    };

    // Stufe 2 & 3A: Suche mit Jahr, danach ohne Jahr (mit SOFORT-STOPP ab >= 85% Trefferquote!)
    const getBestPrimaryConf = () => {
      let best = 0;
      for (const item of rawPool) {
        const c = item._directIdHit ? 100 : computeTmdbMatchConfidence(parsed, item, item._typeCode);
        if (c > best) best = c;
      }
      return best;
    };

    const hasBestYearConflict = () => {
      if (!parsed?.year || rawPool.length === 0) return false;
      let bestItem = null;
      let bestC = -1;
      for (const item of rawPool) {
        const c = item._directIdHit ? 100 : computeTmdbMatchConfidence(parsed, item, item._typeCode);
        if (c > bestC) {
          bestC = c;
          bestItem = item;
        }
      }
      if (!bestItem) return false;
      const rel = String(bestItem.release_date || bestItem.first_air_date || "");
      const yr = rel ? parseInt(rel.slice(0, 4), 10) : null;
      return Boolean(yr && Math.abs(Number(parsed.year) - yr) > 2);
    };

    const hasAsciiUmlauts = /(?:ae|oe|ue)/i.test(searchTitle) && !/[äöüß]/i.test(searchTitle);
    const umlautVariant = hasAsciiUmlauts
      ? searchTitle
          .replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü")
          .replace(/Ae/g, "Ä").replace(/Oe/g, "Ö").replace(/Ue/g, "Ü")
      : searchTitle;
    const romanMovieVariant = cleanMovieQuery(searchTitle);
    const romanStrippedSubtitleVariant = typeof stripRomanNumeralBeforeSubtitle === "function"
      ? stripRomanNumeralBeforeSubtitle(searchTitle)
      : "";
    let hitsWithArticleTotal = 0;
    if (searchTitle && searchTitle !== "Unbekannt" && getBestPrimaryConf() < earlyStopConf) {
      let hitsWithYear = parsed.year
        ? await runTmdbQuery(primaryType, searchTitle, parsed.year, searchTitle)
        : 0;
      hitsWithArticleTotal += hitsWithYear;
      // MODUL 6.2: Prüfe vor einer jahreslosen Suche zuerst year + 1 und year - 1 (z.B. "300 (2006)" -> TMDb Release 2007!)
      if (parsed.year && (hitsWithYear === 0 || getBestPrimaryConf() < earlyStopConf)) {
        const yNum = Number(parsed.year);
        const hitsPlus1 = await runTmdbQuery(primaryType, searchTitle, yNum + 1, searchTitle);
        hitsWithArticleTotal += hitsPlus1;
        hitsWithYear += hitsPlus1;
        if (getBestPrimaryConf() < earlyStopConf) {
          const hitsMinus1 = await runTmdbQuery(primaryType, searchTitle, yNum - 1, searchTitle);
          hitsWithArticleTotal += hitsMinus1;
          hitsWithYear += hitsMinus1;
        }
      }
      // SOFORT-STOPP: Wenn Suche mit Jahr (±1) bereits einen Treffer >= earlyStopConf ohne Jahreskonflikt geliefert hat, KEINE Zweitsuche ohne Jahr abfeuern!
      if ((getBestPrimaryConf() < earlyStopConf || hasBestYearConflict()) && (!parsed.year || hitsWithYear === 0)) {
        hitsWithArticleTotal += await runTmdbQuery(primaryType, searchTitle, null, searchTitle);
      }
      if (getBestPrimaryConf() < earlyStopConf && rawSearchTitle !== searchTitle && hitsWithYear === 0) {
        const rawHitsYear = await runTmdbQuery(primaryType, rawSearchTitle, parsed.year, searchTitle);
        hitsWithArticleTotal += rawHitsYear;
        if (getBestPrimaryConf() < earlyStopConf && parsed.year && rawHitsYear === 0) {
          hitsWithArticleTotal += await runTmdbQuery(primaryType, rawSearchTitle, null, searchTitle);
        }
      }
      // MODUL 3.2: Römische-Zahlen-Retry bei Jahres-Konflikt ("Star Trek IX Nemesis (2002)" -> "Star Trek Nemesis" mit year = 2002)
      if (romanStrippedSubtitleVariant && (rawPool.length === 0 || getBestPrimaryConf() < earlyStopConf || hasBestYearConflict())) {
        const rsHits = await runTmdbQuery(primaryType, romanStrippedSubtitleVariant, parsed.year || null, romanStrippedSubtitleVariant);
        hitsWithArticleTotal += rsHits;
        if (parsed.year && rsHits === 0) {
          hitsWithArticleTotal += await runTmdbQuery(primaryType, romanStrippedSubtitleVariant, null, romanStrippedSubtitleVariant);
        }
      }
      if (getBestPrimaryConf() < earlyStopConf && romanMovieVariant && romanMovieVariant !== searchTitle.toLowerCase()) {
        const rHits = await runTmdbQuery(primaryType, romanMovieVariant, parsed.year || null, romanMovieVariant);
        hitsWithArticleTotal += rHits;
        if (getBestPrimaryConf() < earlyStopConf && parsed.year && rHits === 0) {
          hitsWithArticleTotal += await runTmdbQuery(primaryType, romanMovieVariant, null, romanMovieVariant);
        }
      }
      // 2. Umlaut-Normalisierung ("Rotkaeppchen.1954.mp4" -> "Rotkäppchen")
      if (umlautVariant !== searchTitle && getBestPrimaryConf() < earlyStopConf) {
        const uHits = await runTmdbQuery(primaryType, umlautVariant, parsed.year || null, umlautVariant);
        hitsWithArticleTotal += uHits;
        if (getBestPrimaryConf() < earlyStopConf && parsed.year && uHits === 0) {
          hitsWithArticleTotal += await runTmdbQuery(primaryType, umlautVariant, null, umlautVariant);
        }
      }
    }

    // MODUL 3.3: Dual-Source-Fallback (Text vs. Dateiname bei Tippfehlern wie "Shootaut" vs. "Shootout")
    const altSourceCandidates = [parsed?.titleFromFileName, parsed?.titleFromText]
      .map(s => String(s || "").trim())
      .filter(s => s.length >= 2 && s.toLowerCase() !== searchTitle.toLowerCase() && s.toLowerCase() !== rawSearchTitle.toLowerCase());
    if (altSourceCandidates.length > 0 && (rawPool.length === 0 || getBestPrimaryConf() < earlyStopConf || hasBestYearConflict())) {
      for (const altTitle of altSourceCandidates.slice(0, isTurboMode ? 1 : 2)) {
        const altHits = await runTmdbQuery(primaryType, altTitle, parsed.year || null, altTitle);
        hitsWithArticleTotal += altHits;
        if (parsed.year && altHits === 0) {
          hitsWithArticleTotal += await runTmdbQuery(primaryType, altTitle, null, altTitle);
        }
        if (getBestPrimaryConf() >= earlyStopConf && !hasBestYearConflict()) break;
      }
    }

    // Stufe 3B: Suche mit Originaltitel (nur falls noch kein sicherer Treffer >= earlyStopConf vorliegt)
    if (getBestPrimaryConf() < earlyStopConf && parsed?.originalTitle && parsed.originalTitle.toLowerCase() !== searchTitle.toLowerCase()) {
      hitsWithArticleTotal += await runTmdbQuery(primaryType, parsed.originalTitle, parsed.year || null);
    }

    let bestPrimaryConf = getBestPrimaryConf();

    // Eiserne Sperre NUR, wenn bereits ein sicherer Film-Treffer (bestPrimaryConf >= 78) mit Jahreszahl ohne Jahreskonflikt vorliegt (z.B. "Iron Man 3 (2013)").
    // Hat die TMDb-Filmsuche hingegen KEINEN sicheren Treffer geliefert (< 78%), MUSS zwingend auf Serien-Suche (/search/tv + Stufe 5 Episoden-Fallback, z.B. "Halo Nightfall (2014)") gewechselt werden!
    const strictMovieWithYearLock = Boolean(
      forceTypeCode === "m" ||
      (primaryType === "m" && bestPrimaryConf >= 78 && !hasBestYearConflict() && parsed?.year && !parsed?.isSeries && !parsed?.hasExplicitEpisodePattern)
    );

    // MODUL 3.5: Automatischer Movie <-> TV Fallback (Miniserien-Fallback wie "Halo Nightfall (2014)"), falls primäre Kategorie keinen oder nur schwachen Treffer liefert
    if (!forceTypeCode && !strictMovieWithYearLock && (rawPool.length === 0 || bestPrimaryConf < 78) && searchTitle) {
      const secHits = await runTmdbQuery(secondaryType, searchTitle, parsed.year);
      if (parsed.year && secHits === 0) {
        await runTmdbQuery(secondaryType, searchTitle, null);
      }
    }

    // Stufe 4: Untertitel-Fallback / Bindestrich- & Doppelpunkt-Cutter ("Silk Road - Gebieter des Darknets" -> "Silk Road", "7 vs. Wild - Panama" -> "7 vs. Wild")
    if ((rawPool.length === 0 || bestPrimaryConf < 78 || hasBestYearConflict()) && searchTitle) {
      const strippedCutVariant = cleanMediaTitle(
        searchTitle
          .replace(EDITION_CUT_REGEX, " ")
          .replace(/^(.{2,}?)\s+(?:[-–:]\s*)?(?:the\s+)?(?:cut|edition|version|fassung|redux|special|extended|uncut|unrated)\s*$/i, "$1")
      );
      const rawHyphenParts = (rawSearchTitle.includes("-") || rawSearchTitle.includes("–") || rawSearchTitle.includes("—") || rawSearchTitle.includes(":"))
        ? rawSearchTitle.split(/\s*[:–—\-]\s*/).map(s => s.trim()).filter(Boolean)
        : [];
      const rawHyphenShort = rawHyphenParts[0] || "";
      // MODUL 6.1 (Rechte-Bindestrich-Suche): Teil RECHTS vom ersten Bindestrich (z.B. "Michel aus Lönneberga - Michel bringt die Welt in Ordnung" -> "Michel bringt die Welt in Ordnung")
      const rawHyphenRight = rawHyphenParts.length >= 2 ? rawHyphenParts.slice(1).join(" - ").trim() : "";
      const rawHyphenFirstRight = rawHyphenParts.length >= 2 ? rawHyphenParts[1].trim() : "";
      const searchHyphenParts = (strippedCutVariant || searchTitle).split(/\s*[:–—\-]\s*/).map(s => s.trim()).filter(Boolean);
      const splitMain = searchHyphenParts[0] || "";
      const splitRight = searchHyphenParts.length >= 2 ? searchHyphenParts.slice(1).join(" - ").trim() : "";
      const umlautSplitMain = (umlautVariant !== searchTitle && (umlautVariant.includes("-") || umlautVariant.includes("–") || umlautVariant.includes(":")))
        ? umlautVariant.split(/\s*[:–—\-]\s*/)[0].trim()
        : "";
      const words = (strippedCutVariant || searchTitle).split(/\s+/).filter(Boolean);
      const lastWordIsSequelNum = /^[2-9]$/.test(words[words.length - 1] || "");
      const shorterCandidates = [];
      // 1. Linker Teil vor dem Bindestrich ("Silk Road - Gebieter des Darknets" -> "Silk Road")
      if (rawHyphenShort && rawHyphenShort.length >= 2 && rawHyphenShort.toLowerCase() !== rawSearchTitle.toLowerCase()) {
        shorterCandidates.push(rawHyphenShort);
      }
      if (splitMain && splitMain.length >= 2 && splitMain.toLowerCase() !== searchTitle.toLowerCase() && !shorterCandidates.includes(splitMain)) {
        shorterCandidates.push(splitMain);
      }
      // 2. MODUL 6.1: Rechter Teil nach dem Bindestrich ("Michel aus Lönneberga - Michel bringt die Welt in Ordnung" -> "Michel bringt die Welt in Ordnung")
      if (splitRight && splitRight.length >= 3 && !/^(?:teil|part|cd|disc|staffel|folge|episode)\s*\d+$/i.test(splitRight) && !shorterCandidates.includes(splitRight)) {
        shorterCandidates.push(splitRight);
      }
      if (rawHyphenRight && rawHyphenRight.length >= 3 && !/^(?:teil|part|cd|disc|staffel|folge|episode)\s*\d+$/i.test(rawHyphenRight) && !shorterCandidates.includes(rawHyphenRight)) {
        shorterCandidates.push(rawHyphenRight);
      }
      if (rawHyphenFirstRight && rawHyphenFirstRight.length >= 3 && !/^(?:teil|part|cd|disc|staffel|folge|episode)\s*\d+$/i.test(rawHyphenFirstRight) && !shorterCandidates.includes(rawHyphenFirstRight)) {
        shorterCandidates.push(rawHyphenFirstRight);
      }
      if (umlautSplitMain && umlautSplitMain.length >= 2 && !shorterCandidates.includes(umlautSplitMain)) {
        shorterCandidates.push(umlautSplitMain);
      }
      // MODUL 3.1 ("The Gentlemen"-Fix): Führende Artikel (The/Der/Die/Das) NUR dann im letzten Fallback-Schritt entfernen, wenn die Suche MIT Artikel 0 Treffer geliefert hat!
      const leadingArticleRegex = /^(?:the|a|an|der|die|das|les|le|la)\s+/i;
      if (hitsWithArticleTotal === 0 && rawPool.length === 0 && leadingArticleRegex.test(searchTitle)) {
        const withoutLeadingArticle = cleanMediaTitle(searchTitle.replace(leadingArticleRegex, "").trim());
        if (withoutLeadingArticle && withoutLeadingArticle.length >= 3 && !shorterCandidates.includes(withoutLeadingArticle)) {
          shorterCandidates.push(withoutLeadingArticle);
        }
      }
      if (strippedCutVariant && strippedCutVariant.length >= 2 && strippedCutVariant.toLowerCase() !== searchTitle.toLowerCase() && !shorterCandidates.includes(strippedCutVariant)) {
        shorterCandidates.push(strippedCutVariant);
      }
      // Wichtig: Niemals eine Fortsetzungs-Ziffer (2-9, z.B. "Iron Man 3", "Pirates of the Caribbean 3") am Ende blind als Film abschneiden!
      if (words.length >= 2 && !lastWordIsSequelNum) {
        const dropLastWord = words.slice(0, -1).join(" ").trim();
        if (dropLastWord.length >= 3 && !shorterCandidates.includes(dropLastWord)) {
          shorterCandidates.push(dropLastWord);
        }
      }
      if (words.length >= 4 && !lastWordIsSequelNum) {
        const firstThree = words.slice(0, 3).join(" ").trim();
        if (firstThree.length >= 3 && !shorterCandidates.includes(firstThree)) {
          shorterCandidates.push(firstThree);
        }
      }
      const cappedShorterCandidates = isTurboMode ? shorterCandidates.slice(0, 4) : shorterCandidates;
      for (const shorterTitle of cappedShorterCandidates) {
        if (isTurboMode && !hasSubrequestBudget(16)) break;
        const beforeLen = rawPool.length;
        await runTmdbQuery(primaryType, shorterTitle, parsed.year || null, shorterTitle);
        if (parsed.year) {
          const hasYearMatch = rawPool.slice(beforeLen).some(it => {
            const rel = String(it.release_date || it.first_air_date || "");
            const y = rel ? parseInt(rel.slice(0, 4), 10) : null;
            return y && Math.abs(Number(parsed.year) - y) <= 3;
          });
          if (!hasYearMatch && (!isTurboMode || rawPool.length === beforeLen)) {
            await runTmdbQuery(primaryType, shorterTitle, null, shorterTitle);
          }
        }
        if (!forceTypeCode && !strictMovieWithYearLock && rawPool.length === beforeLen) {
          await runTmdbQuery(secondaryType, shorterTitle, parsed.year || null, shorterTitle);
        }
        let bestShortConf = 0;
        for (let k = beforeLen; k < rawPool.length; k++) {
          const candItem = rawPool[k];
          const confParsed = candItem._baseTitleForConf
            ? { ...parsed, cleanTitle: candItem._baseTitleForConf }
            : parsed;
          const c = computeTmdbMatchConfidence(confParsed, candItem, candItem._typeCode);
          if (c > bestShortConf) bestShortConf = c;
        }
        if (bestShortConf >= (isTurboMode ? 72 : 78) && !hasBestYearConflict()) break;
      }
    }

    // Stufe 5: Angehängte Episodennummer am Titelende ("Black Box 1", "Spuk im Hochhaus 1", "Generation Kill 1" -> Serien-Suche für Basis-Titel, Folge 1)
    // Eiserne Regel ("Kein Film -> Serie"): Wenn kein sicherer Filmtreffer (bestPrimaryConf < 78) vorliegt und der Titel nicht auf der Film-Reihen-Blocklist steht,
    // wird jeder Titel mit angehängter/eingebetteter Zahl automatisch als Serie (Staffel 1, Episode N) gesucht!
    const MOVIE_SEQUEL_SERIES_BLOCKLIST = /^(?:saw|spider[\s-]*man|iron\s+man|ninja\s+turtles|teenage\s+mutant\s+ninja\s+turtles|james\s+bond|007|shrek|kingsman|pirates\s+of\s+the\s+caribbean|fluch\s+der\s+karibik|wonder\s+woman|venom|underworld|final\s+destination|insidious|paranormal\s+activity|jurassic\s+park|jurassic\s+world|indiana\s+jones|star\s+wars|star\s+trek|harry\s+potter|fast\s+and\s+furious|transporter|bourne|mission\s+impossible|scary\s+movie|american\s+pie|step\s+up|ip\s+man|undisputed|scream|halloween|hellraiser|chucky|annabelle|avengers|captain\s+america|thor|guardians\s+of\s+the\s+galaxy|deadpool|x[\s-]*men|matrix|john\s+wick|equalizer|expendables|rambo|rocky|creed|alien|predator|terminator|robocop|die\s+hard|stirb\s+langsam|lethal\s+weapon|beverly\s+hills\s+cop|bad\s+boys|men\s+in\s+black|ghostbusters|back\s+to\s+the\s+future|zurück\s+in\s+die\s+zukunft|lord\s+of\s+the\s+rings|herr\s+der\s+ringe|hobbit|narnia|twilight|hunger\s+games|tribute\s+von\s+panem|maze\s+runner|divergent|resident\s+evil|silent\s+hill|conjuring|purge|quiet\s+place|hangover|oceans|now\s+you\s+see\s+me|unfassbaren|hotel\s+transsilvanien|ice\s+age|madagascar|ich\s+einfach\s+unverbesserlich|minions|toy\s+story|cars|kung\s+fu\s+panda|drachenzähmen)\b/i;
    const isLikelyMovieSequel = Boolean(
      strictMovieWithYearLock ||
      bestPrimaryConf >= 78 ||
      MOVIE_SEQUEL_SERIES_BLOCKLIST.test(String(searchTitle || "").trim())
    );

    const trailingEpMatch = !isLikelyMovieSequel
      ? String(searchTitle || "").match(/^(.{2,}?)\s+(?:[-–]\s*)?(?:teil\s+|part\s+|ep\.?\s*|folge\s+)?0*([1-9]\d?)$/i)
      : null;
    const trailingBaseTitle = trailingEpMatch ? trailingEpMatch[1].trim() : null;
    const trailingEpNum = trailingEpMatch ? parseInt(trailingEpMatch[2], 10) : null;
    if (trailingBaseTitle && trailingEpNum >= 1 && trailingEpNum <= 99 && forceTypeCode !== "m" && !strictMovieWithYearLock && !MOVIE_SEQUEL_SERIES_BLOCKLIST.test(trailingBaseTitle)) {
      const endpoint = "tv";
      const yearParam = parsed?.year ? `&first_air_date_year=${parsed.year}` : "";
      const tvUrl = `https://api.themoviedb.org/3/search/${endpoint}?query=${encodeURIComponent(trailingBaseTitle)}${yearParam}&language=de-DE&page=1`;
      let tvData = await cachedExternalFetchJson(tvUrl, { headers });
      if ((!tvData?.results || tvData.results.length === 0) && parsed?.year) {
        tvData = await cachedExternalFetchJson(`https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(trailingBaseTitle)}&language=de-DE&page=1`, { headers });
      }
      if (Array.isArray(tvData?.results)) {
        for (const item of tvData.results.slice(0, 5)) {
          const itemTitle = String(item.name || item.title || "").trim();
          const itemOrig = String(item.original_name || item.original_title || "").trim();
          const endsWithSameNum = new RegExp(`\\b0*${trailingEpNum}$`, "i").test(itemTitle) || new RegExp(`\\b0*${trailingEpNum}$`, "i").test(itemOrig);
          rawPool.push({
            ...item,
            _typeCode: "s",
            _baseTitleForConf: trailingBaseTitle,
            _inferredSeason: parsed?.season || 1,
            _inferredEpisode: parsed?.episode || (!endsWithSameNum ? trailingEpNum : null),
            _confidenceBoost: 12
          });
        }
      }
    }

    // Stufe 5B: Eingebettete Episodennummer + Episodentitel in der Mitte (z. B. "Zur See 1 Die Bewährung" oder "Pippi Langstrumpf 1 Pippi zieht in die Villa Kunterbunt")
    const midEpMatch = !isLikelyMovieSequel
      ? String(searchTitle || "").match(/^(.{2,}?)\s+(?:[-–]\s*)?(?:teil\s+|part\s+|ep\.?\s*|folge\s+)?(?<!\d)0?([1-9]\d?)\s+(?:[-–:]\s*)?(.{3,})$/i)
      : null;
    const midBaseTitle = midEpMatch ? midEpMatch[1].trim() : null;
    const midEpNum = midEpMatch ? parseInt(midEpMatch[2], 10) : null;
    const midEpTitle = midEpMatch ? midEpMatch[3].trim() : null;
    if (midBaseTitle && midEpNum >= 1 && midEpNum <= 99 && midEpTitle && forceTypeCode !== "m" && !MOVIE_SEQUEL_SERIES_BLOCKLIST.test(midBaseTitle)) {
      const yearParam = parsed?.year ? `&first_air_date_year=${parsed.year}` : "";
      let tvData = await cachedExternalFetchJson(`https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(midBaseTitle)}${yearParam}&language=de-DE&page=1`, { headers });
      if ((!tvData?.results || tvData.results.length === 0) && parsed?.year) {
        tvData = await cachedExternalFetchJson(`https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(midBaseTitle)}&language=de-DE&page=1`, { headers });
      }
      if (Array.isArray(tvData?.results) && tvData.results.length > 0) {
        const normMidBase = normalizeCompareString(midBaseTitle);
        const normMidEpTitle = normalizeCompareString(midEpTitle);
        for (const item of tvData.results.slice(0, 3)) {
          const itemTitle = String(item.name || item.title || "").trim();
          const itemOrig = String(item.original_name || item.original_title || "").trim();
          const normItemTitle = normalizeCompareString(itemTitle);
          const normItemOrig = normalizeCompareString(itemOrig);
          const baseTitleMatches = normItemTitle === normMidBase || normItemOrig === normMidBase || normItemTitle.includes(normMidBase) || normMidBase.includes(normItemTitle);
          if (!baseTitleMatches) continue;

          // Prüfe Staffel 1 Episodenliste in TMDb auf Treffer mit Episodennummer oder Episodentitel ("Die Bewährung" / "Pippis Abschiedsfest")
          let verifiedEpNum = midEpNum;
          let verifiedEpTitle = midEpTitle;
          let epVerifiedBoost = 0;
          try {
            const s1 = await fetchSeasonDetails(env, item.id, parsed?.season || 1);
            const eps = Array.isArray(s1?.episodes) ? s1.episodes : [];
            if (eps.length > 0) {
              const byTitle = eps.find(e => {
                const ne = normalizeCompareString(e?.name || "");
                return ne && normMidEpTitle && (ne === normMidEpTitle || ne.includes(normMidEpTitle) || normMidEpTitle.includes(ne));
              });
              const byNum = eps.find(e => Number(e?.episode_number) === midEpNum);
              if (byTitle) {
                verifiedEpNum = Number(byTitle.episode_number || midEpNum);
                verifiedEpTitle = String(byTitle.name || midEpTitle).trim();
                epVerifiedBoost = 16;
              } else if (byNum) {
                verifiedEpTitle = String(byNum.name || midEpTitle).trim();
                epVerifiedBoost = 10;
              }
            }
          } catch (e) {}

          rawPool.push({
            ...item,
            _typeCode: "s",
            _baseTitleForConf: midBaseTitle,
            _inferredSeason: parsed?.season || 1,
            _inferredEpisode: verifiedEpNum,
            _inferredEpisodeTitle: verifiedEpTitle,
            _confidenceBoost: epVerifiedBoost
          });
        }
      }
    }

    const contextWordsForMovieScore = Array.from(
      new Set(
        String(parsed?.contextOverview || "")
          .toLowerCase()
          .split(/[^\p{L}\d]+/u)
          .filter(w => w.length >= 5)
      )
    );
    const targetMovieTitleLow = String(parsed?.cleanTitle || parsed?.title || "")
      .replace(/^(?:disney'?s|disneys|marvel'?s|marvels|pixar'?s|pixars)\s+/i, "")
      .toLowerCase()
      .trim();
    const normTargetMovieTitle = normalizeCompareString(targetMovieTitleLow);
    const targetSubtitleParts = targetMovieTitleLow.split(/\s*[-–—:]\s*/);
    const normTargetSubtitle = targetSubtitleParts.length >= 2 ? normalizeCompareString(targetSubtitleParts.slice(1).join(" ")) : "";

    const computeMoviePickerScore = (movie) => {
      let mScore = 0;
      const tmdbTitle = String(movie.title || movie.name || "").toLowerCase().trim();
      const tmdbOrig  = String(movie.original_title || movie.original_name || "").toLowerCase().trim();
      const normTmdbT = normalizeCompareString(tmdbTitle);
      const normTmdbO = normalizeCompareString(tmdbOrig);
      const tmdbSubPartsDe = tmdbTitle.split(/\s*[-–—:]\s*/);
      const tmdbSubPartsOrig = tmdbOrig.split(/\s*[-–—:]\s*/);
      const normTmdbSubDe = tmdbSubPartsDe.length >= 2 ? normalizeCompareString(tmdbSubPartsDe.slice(1).join(" ")) : "";
      const normTmdbSubOrig = tmdbSubPartsOrig.length >= 2 ? normalizeCompareString(tmdbSubPartsOrig.slice(1).join(" ")) : "";
      const relStr = String(movie.release_date || movie.first_air_date || "");
      const releaseYear = relStr ? parseInt(relStr.slice(0, 4), 10) : null;

      const isExactTitleMatch =
        tmdbTitle === targetMovieTitleLow ||
        tmdbOrig === targetMovieTitleLow ||
        (normTargetMovieTitle && (normTmdbT === normTargetMovieTitle || normTmdbO === normTargetMovieTitle));
      const isExactSubMatch = Boolean(
        normTargetSubtitle && normTargetSubtitle.length >= 4 && (
          normTargetSubtitle === normTmdbSubDe ||
          normTargetSubtitle === normTmdbSubOrig ||
          normTargetSubtitle === normTmdbT ||
          normTargetSubtitle === normTmdbO
        )
      );
      const isExactTitleOrSub = isExactTitleMatch || isExactSubMatch;

      if (parsed?.year && releaseYear) {
        const diff = Math.abs(Number(parsed.year) - releaseYear);
        if (diff === 0) mScore += 40;
        else if (diff === 1) mScore += 20;
        else if (diff <= 3 && isExactTitleOrSub) mScore += 10;
        else mScore -= diff * 25;
      }

      // MODUL 6.2: Stimmt der TMDb-Titel zu 100% mit dem Such-Titel ODER dem Untertitel (Teil nach dem Bindestrich) überein,
      // gib ihm +150 Punkte Bonus und erlaube eine Jahres-Toleranz von ±3 Jahren!
      const isYearWithinThree = Boolean(!parsed?.year || (releaseYear && Math.abs(Number(parsed.year) - releaseYear) <= 3));

      if (isExactTitleOrSub) {
        mScore += isYearWithinThree ? 150 : 50;
      } else if (tmdbTitle.startsWith(targetMovieTitleLow) || (normTargetMovieTitle && normTmdbT.startsWith(normTargetMovieTitle))) {
        mScore += 30;
      } else if (tmdbTitle.includes(targetMovieTitleLow) || (normTargetMovieTitle && normTmdbT.includes(normTargetMovieTitle))) {
        mScore += 15;
      }

      if (contextWordsForMovieScore.length > 0 && movie.overview) {
        const ovLower = String(movie.overview).toLowerCase();
        let matches = 0;
        for (const word of contextWordsForMovieScore) {
          if (ovLower.includes(word)) matches++;
        }
        mScore += Math.min(matches * 20, 100);
      }

      const votes = Number(movie.vote_count || 0);
      if (votes > 1000) mScore += 35;
      else if (votes > 200) mScore += 20;
      else if (votes > 50) mScore += 10;
      else if (votes < 10) mScore -= 15;

      return mScore;
    };

    const dedupedMap = new Map();
    for (const item of rawPool) {
      if (!item || !item.id) continue;
      const key = `${item._typeCode}_${item.id}`;
      const parsedForConf = item._baseTitleForConf
        ? { ...parsed, cleanTitle: item._baseTitleForConf, isSeries: item._typeCode === "s" }
        : parsed;
      const baseConf = item._directIdHit ? 100 : computeTmdbMatchConfidence(parsedForConf, item, item._typeCode);
      const moviePickerScore = item._typeCode === "m" ? computeMoviePickerScore(item) : 0;
      const conf = Math.min(99, baseConf + Number(item._confidenceBoost || 0));
      const existing = dedupedMap.get(key);
      const isDachOrigin = String(item.original_language || "").toLowerCase() === "de" ||
        (Array.isArray(item.origin_country) && item.origin_country.some(c => /^(?:DE|AT|CH|XG)$/i.test(String(c || "").trim())));
      if (!existing || conf > existing.confidence || (conf === existing.confidence && moviePickerScore > (existing.moviePickerScore || 0))) {
        const rawDate = String(item.release_date || item.first_air_date || "");
        dedupedMap.set(key, {
          tmdbId: Number(item.id),
          typeCode: item._typeCode,
          mediaType: item._typeCode === "s" ? "tv" : "movie",
          title: String(item.title || item.name || "Unbekannt").trim(),
          originalTitle: String(item.original_title || item.original_name || "").trim(),
          year: (rawDate.split("-")[0]) || "k.A.",
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : "",
          voteAverage: Number(item.vote_average || 0).toFixed(1),
          voteCount: Number(item.vote_count || 0),
          popularity: Number(item.popularity || 0),
          isDachOrigin,
          moviePickerScore,
          confidence: conf,
          inferredSeason: item._inferredEpisode ? (item._inferredSeason || 1) : (existing?.inferredSeason || null),
          inferredEpisode: item._inferredEpisode || existing?.inferredEpisode || null,
          inferredEpisodeTitle: item._inferredEpisodeTitle || existing?.inferredEpisodeTitle || null,
          source: "TMDb"
        });
      }
    }

    // Erweiterte Fallback-Kaskade:
    // Im Turbo-Modus ("free_turbo" / "smart_emergency") greifen wir NUR DANN auf die Notfall-Zusatz-APIs zurück,
    // wenn TMDb 0 brauchbare Treffer (< 62%) geliefert hat UND genügend Subrequest-Budget frei ist!
    const currentBest = Array.from(dedupedMap.values()).reduce((m, x) => Math.max(m, x.confidence || 0), 0);
    const fallbackConfidenceThreshold = isTurboMode ? 62 : 78;
    if ((dedupedMap.size === 0 || currentBest < fallbackConfidenceThreshold) && (!isTurboMode || hasSubrequestBudget(16))) {
      if (options && typeof options === "object") {
        options._fallbackAlreadyChecked = true;
      }
      const fbParsed = (trailingBaseTitle && trailingEpNum)
        ? { ...parsed, cleanTitle: trailingBaseTitle, isSeries: true, season: parsed?.season || 1, episode: parsed?.episode || trailingEpNum }
        : (midBaseTitle && midEpNum)
          ? { ...parsed, cleanTitle: midBaseTitle, isSeries: true, season: parsed?.season || 1, episode: parsed?.episode || midEpNum, episodeTitle: midEpTitle || parsed?.episodeTitle }
          : parsed;
      const fbForceType = strictMovieWithYearLock
        ? "m"
        : (forceTypeCode || ((trailingBaseTitle || midBaseTitle || parsed?.isSeries) ? "s" : null));
      const fbHit = await fetchMultiApiFallbackCascade(env, fbParsed, fbForceType, {
        fallbackMode: options?.fallbackMode || (isTurboMode ? "smart_emergency" : "deep")
      });
      if (fbHit && fbHit.id && (!strictMovieWithYearLock || fbHit.typeCode !== "s")) {
        // Brücke: Wenn Wikipedia/Wikidata/TVMaze die korrekte Schreibweise mit Satzzeichen liefert (z. B. "Axel! will's wissen" statt "Axel will's wissen"),
        // direkt mit diesem kanonischen Titel erneut bei TMDb anfragen, um die offizielle TMDb-Serie samt Episoden zu erhalten!
        if (Number(fbHit.id) >= 8000000 && fbHit.title && env.TMDB_BEARER_TOKEN) {
          const bridgeTc = strictMovieWithYearLock ? "m" : (fbHit.typeCode === "s" ? "s" : primaryType);
          let bridgeHits = await runTmdbQuery(bridgeTc, fbHit.title, parsed.year || null);
          if (bridgeHits === 0 && parsed.year) {
            bridgeHits = await runTmdbQuery(bridgeTc, fbHit.title, null);
          }
          if (bridgeHits > 0) {
            for (const bItem of rawPool.slice(-6)) {
              if (!bItem || !bItem.id) continue;
              const bKey = `${bItem._typeCode}_${bItem.id}`;
              const bConf = Math.max(92, computeTmdbMatchConfidence({ ...fbParsed, cleanTitle: fbHit.title }, bItem, bItem._typeCode));
              const existingB = dedupedMap.get(bKey);
              if (!existingB || bConf > existingB.confidence) {
                const bRawDate = String(bItem.release_date || bItem.first_air_date || "");
                dedupedMap.set(bKey, {
                  tmdbId: Number(bItem.id),
                  typeCode: bItem._typeCode,
                  mediaType: bItem._typeCode === "s" ? "tv" : "movie",
                  title: String(bItem.title || bItem.name || fbHit.title).trim(),
                  originalTitle: String(bItem.original_title || bItem.original_name || "").trim(),
                  year: (bRawDate.split("-")[0]) || fbHit.year || "k.A.",
                  poster: bItem.poster_path ? `https://image.tmdb.org/t/p/w185${bItem.poster_path}` : (fbHit.poster || ""),
                  voteAverage: Number(bItem.vote_average || 0).toFixed(1),
                  popularity: Number(bItem.popularity || 60),
                  confidence: bConf,
                  inferredSeason: (parsed?.season || trailingEpMatch || midEpMatch) ? (parsed?.season || 1) : null,
                  inferredEpisode: parsed?.episode || trailingEpNum || midEpNum || null,
                  inferredEpisodeTitle: midEpTitle || parsed?.episodeTitle || null,
                  source: "TMDb"
                });
              }
            }
          }
        }
        const fbKey = `${fbHit.typeCode}_${fbHit.id}`;
        if (!dedupedMap.has(fbKey)) {
          dedupedMap.set(fbKey, {
            tmdbId: Number(fbHit.id),
            typeCode: fbHit.typeCode,
            mediaType: fbHit.typeCode === "s" ? "tv" : "movie",
            title: fbHit.title,
            originalTitle: fbHit.originalTitle || fbHit.title,
            year: fbHit.year || "k.A.",
            poster: fbHit.poster || "",
            voteAverage: Number(fbHit.vote_average || 0).toFixed(1),
            popularity: 50,
            confidence: fbHit.confidence || 76,
            inferredSeason: fbHit.typeCode === "s" ? (parsed?.season || 1) : null,
            inferredEpisode: fbHit.typeCode === "s" ? (parsed?.episode || trailingEpNum || midEpNum || null) : null,
            inferredEpisodeTitle: fbHit.typeCode === "s" ? (midEpTitle || parsed?.episodeTitle || null) : null,
            source: fbHit.source || "Fallback"
          });
        }
      }
    }

    const sortedCandidates = Array.from(dedupedMap.values())
      .sort((a, b) => {
        // Bei vorhandenem Jahr und gleichem/ähnlichem Titel (Confidence-Differenz <= 8) immer nach kleinster Jahres-Abweichung sortieren!
        if (parsed?.year && Math.abs(b.confidence - a.confidence) <= 8) {
          const targetY = Number(parsed.year);
          const aY = /^\d{4}$/.test(String(a.year || "")) ? parseInt(String(a.year), 10) : 9999;
          const bY = /^\d{4}$/.test(String(b.year || "")) ? parseInt(String(b.year), 10) : 9999;
          const aDiff = Math.abs(aY - targetY);
          const bDiff = Math.abs(bY - targetY);
          if (aDiff !== bDiff) return aDiff - bDiff;
        }
        // Bei Filmen (gleiches Jahr oder ähnliche Confidence <= 20): pickBestTMDbMovie-Score (contextOverview-Fingerabdruck + vote_count Blockbuster-Bonus) entscheidet!
        if (a.typeCode === "m" && b.typeCode === "m" && Math.abs(b.confidence - a.confidence) <= 20) {
          const aPick = Number(a.moviePickerScore || 0);
          const bPick = Number(b.moviePickerScore || 0);
          if (aPick !== bPick) return bPick - aPick;
        }
        // Ohne Jahresangabe bei exakter Namensgleichheit: Deutschsprachige Produktionen (DE/AT/CH/XG) bevorzugen,
        // sofern der fremdsprachige Kandidat kein internationaler Mainstream-Hit (voteCount >= 150 oder popularity >= 25) ist!
        if (!parsed?.year && a.confidence >= 94 && b.confidence >= 94 && Math.abs(b.confidence - a.confidence) <= 4) {
          const aDach = Boolean(a.isDachOrigin);
          const bDach = Boolean(b.isDachOrigin);
          if (aDach !== bDach) {
            const nonDach = aDach ? b : a;
            const dach = aDach ? a : b;
            const nonDachIsGlobalHit = (Number(nonDach.voteCount || 0) >= 150 || Number(nonDach.popularity || 0) >= 25) && Number(dach.voteCount || 0) < 30;
            if (!nonDachIsGlobalHit) return aDach ? -1 : 1;
          }
        }
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        if (a.inferredEpisode && !b.inferredEpisode) return -1;
        if (b.inferredEpisode && !a.inferredEpisode) return 1;
        return b.popularity - a.popularity;
      })
      .slice(0, 6);

    // Im interaktiven Einzel-Dialog (nicht während eines großen Batch-Imports):
    // Falls Top-Kandidaten in de-DE kein Poster haben, direkt EN/Internationales Poster über /images nachladen
    if (!isBatchImport) {
      for (const cand of sortedCandidates.slice(0, 3)) {
        if (!cand.poster && cand.tmdbId && cand.tmdbId < 8000000 && env.TMDB_BEARER_TOKEN) {
          const ep = cand.typeCode === "s" ? "tv" : "movie";
          const imgData = await cachedExternalFetchJson(
            `https://api.themoviedb.org/3/${ep}/${cand.tmdbId}/images?include_image_language=de,en,null`,
            { headers },
            2500
          );
          const pPath = imgData?.posters?.[0]?.file_path || "";
          if (pPath) {
            cand.poster = `https://image.tmdb.org/t/p/w185${pPath}`;
          }
        }
      }
    }

    return sortedCandidates;
  }

  // --- Erkennungs-Weiche Lookup & Ingest für einzelne Datei oder JSON-Eintrag ---
  async function resolveAndIngestMediaEntry(env, rawEntry, fileMeta = null, options = null) {
    const rawName = typeof rawEntry === "string"
      ? rawEntry
      : (rawEntry?.raw_file_name || rawEntry?.file_name || rawEntry?.rawInput || rawEntry?.filename || rawEntry?.title || rawEntry?.name || "");
    const rawCaption = typeof rawEntry === "object" && rawEntry !== null
      ? String(rawEntry.raw_text || rawEntry.rawText || rawEntry.caption || rawEntry.text || "")
      : "";
    const preContext = (typeof rawEntry === "object" && rawEntry?.pre_context) ? rawEntry.pre_context : null;
    const durationSec = (typeof rawEntry === "object" && (rawEntry?.duration_sec || rawEntry?.duration_seconds || rawEntry?.duration))
      ? Number(rawEntry.duration_sec || rawEntry.duration_seconds || rawEntry.duration)
      : null;

    const parsed = parseMediaFilename(rawName, rawCaption, preContext, durationSec);
    if (typeof rawEntry === "object" && rawEntry !== null && (rawEntry.width || rawEntry.height)) {
      const dimQual = detectVideoQuality(rawEntry, rawCaption, rawName);
      if (dimQual) parsed.quality = dimQual;
    }
    parsed.hasExplicitEpisodePattern = Boolean(parsed.isSeries);

    let effectiveFileMeta = fileMeta ? { ...fileMeta } : null;
    let forceTypeCode = null;
    if (typeof rawEntry === "object" && rawEntry !== null) {
      if (rawEntry.type === "series" || rawEntry.type === "tv" || rawEntry.typeCode === "s" || rawEntry.isSeries === true || rawEntry.season || rawEntry.episode) {
        parsed.isSeries = true;
        parsed.season = Number(rawEntry.manualSeason || parsed.season || rawEntry.season || 1);
        parsed.episode = Number(rawEntry.manualEpisode || parsed.episode || rawEntry.episode || 1);
        if (rawEntry.episodeEnd || parsed.episodeEnd) {
          parsed.episodeEnd = Number(rawEntry.episodeEnd || parsed.episodeEnd);
        }
        if (rawEntry.episodeTitle && !parsed.episodeTitle) {
          parsed.episodeTitle = String(rawEntry.episodeTitle);
        }
        if (rawEntry.type === "series" || rawEntry.type === "tv" || rawEntry.typeCode === "s") forceTypeCode = "s";
      } else if (rawEntry.type === "movie" || rawEntry.typeCode === "m") {
        parsed.isSeries = false;
        forceTypeCode = "m";
      }
      if (!parsed.year && rawEntry.year) parsed.year = Number(rawEntry.year);
      if (rawEntry.originalTitle || rawEntry.original_title) parsed.originalTitle = String(rawEntry.originalTitle || rawEntry.original_title);
      if (rawEntry.imdbId || rawEntry.imdb_id) parsed.imdbId = String(rawEntry.imdbId || rawEntry.imdb_id);
      if (rawEntry.quality && !(rawEntry.width || rawEntry.height)) parsed.quality = String(rawEntry.quality);
      if (rawEntry.codec) parsed.codec = String(rawEntry.codec);
      if (rawEntry.part) parsed.part = String(rawEntry.part);
      else if (rawEntry.partInfo?.partLabel && !parsed.part) parsed.part = String(rawEntry.partInfo.partLabel);
      if (rawEntry.tags) parsed.tags = String(rawEntry.tags);
      if (rawEntry.file_size || rawEntry.fileSize || rawEntry.size) {
        parsed.parsedFileSize = parseHumanFileSizeToBytes(rawEntry.file_size || rawEntry.fileSize || rawEntry.size);
      }
      if (!effectiveFileMeta && (rawEntry.telegram_file_id || rawEntry.file_id || rawEntry.fileId)) {
        const entryMsgId = Number(rawEntry.msg_id || rawEntry.message_id || rawEntry.messageId || 0) || null;
        effectiveFileMeta = {
          fileId: String(rawEntry.telegram_file_id || rawEntry.file_id || rawEntry.fileId),
          fileUniqueId: rawEntry.telegram_unique_id || null,
          messageId: entryMsgId,
          fileSize: parsed.parsedFileSize || null,
          mimeType: rawEntry.mime_type || "video/mp4",
          rawFilename: String(rawName || ""),
          rawCaption: String(rawCaption || ""),
          messageLink: String(rawEntry.message_link || rawEntry.messageLink || "")
        };
      }
      if (rawEntry.contextOverview || rawEntry.context_overview) {
        parsed.contextOverview = String(rawEntry.contextOverview || rawEntry.context_overview).trim();
      }
      const isNeighborEnrichedMovieTitle = Boolean(
        !parsed.isSeries &&
        rawEntry.neighborEnriched &&
        (rawEntry.cleanTitle || rawEntry.title)
      );
      if (
        rawEntry.manualTitle ||
        isNeighborEnrichedMovieTitle ||
        (!parsed.cleanTitle || parsed.cleanTitle === "Unbekannt") && (rawEntry.cleanTitle || rawEntry.title)
      ) {
        const rawProvided = String(rawEntry.manualTitle || rawEntry.cleanTitle || rawEntry.title).trim();
        // MODUL 5.3 ("Cocaine Bear"- & "Star Wars Episode V"-Fix):
        // Einzeilige Titel niemals bei 40/50 Zeichen abschneiden (Limit: 120 Zeichen / <= 15 Wörter)!
        const isPlot = typeof isLikelyPlotDescription === "function"
          ? isLikelyPlotDescription(rawProvided)
          : (rawProvided.length > 120 || rawProvided.split(/\s+/).length > 15);
        if (!rawEntry.manualTitle && isPlot) {
          if (!parsed.contextOverview) parsed.contextOverview = rawProvided;
        } else {
          const cleanedCandidate = cleanMediaTitle(rawProvided, { hadYearCutoff: Boolean(parsed.year || rawEntry.year) });
          if (cleanedCandidate && cleanedCandidate !== "Unbekannt") {
            parsed.cleanTitle = cleanedCandidate;
          }
        }
      }
      // Sicherheits-Regel vor der TMDb-Suche: Nur bei echten Beschreibungstexten (> 120 Zeichen oder > 15 Wörter) kürzen!
      const cleanTitleIsPlot = typeof isLikelyPlotDescription === "function"
        ? isLikelyPlotDescription(parsed.cleanTitle || "")
        : Boolean(parsed.cleanTitle && (parsed.cleanTitle.length > 120 || parsed.cleanTitle.split(/\s+/).length > 15));
      if (!rawEntry?.manualTitle && parsed.cleanTitle && cleanTitleIsPlot) {
        if (!parsed.contextOverview) parsed.contextOverview = parsed.cleanTitle;
        const shortFromRawName = rawName
          ? cleanMediaTitle(
              String(rawName)
                .replace(/(?:\.part0*\d{1,2})?(?:\.(?:mp4|mkv|avi|mov|webm|m4v|ts|flv|wmv|mk3d|rar|json))+$/i, "")
                .replace(/[\(\[]?\b(19[2-9]\d|20[0-2]\d)\b[\)\]]?.*$/i, "")
            )
          : "";
        parsed.cleanTitle = (shortFromRawName && shortFromRawName.length >= 2 && shortFromRawName.length <= 120)
          ? shortFromRawName
          : parsed.cleanTitle.split(/[\n(]/)[0].trim().slice(0, 120);
      }
      if (parsed.isSeries && parsed.episode && parsed.cleanTitle && !parsed.isBonus) {
        const epNumRe = new RegExp(`^(.{2,}?)\\s+(?:[-–]\\s*)?(?:teil\\s+|part\\s+|ep\\.?\\s*|folge\\s+)?0*${Number(parsed.episode)}(?:\\s+[-–:]?\\s*.+)?$`, "i");
        const mStrip = String(parsed.cleanTitle).match(epNumRe);
        if (mStrip && mStrip[1] && !/^(?:babylon|apollo|district|oceans?|fast|station|sector|area|studio|room|vault|level|channel|colony|ash\s+vs\s+evil\s+dead)$/i.test(mStrip[1].trim())) {
          parsed.cleanTitle = cleanMediaTitle(mStrip[1]) || mStrip[1].trim();
        }
      }
    }
    const parserCleanedSearchTitle = String(parsed.cleanTitle || rawName || "").trim();

    // Wenn als VIP-Stream-Playlist importiert wird und kein telegram_file_id im Desktop-Export lag,
    // erzeuge eine eindeutige tg_export_<chatId>_<msgId> Stream-Referenz für D1 movie_files / episode_files!
    if (!effectiveFileMeta && options?.registerAsVipStream) {
      const chatRef = (typeof rawEntry === "object" && (rawEntry?.chat_id || rawEntry?.chatId))
        ? String(rawEntry.chat_id || rawEntry.chatId).replace(/[^a-zA-Z0-9_@-]/g, "")
        : "vip";
      const numericMsgRef = Number(typeof rawEntry === "object" && (rawEntry?.msg_id || rawEntry?.message_id || rawEntry?.messageId || 0)) || 0;
      const msgRef = numericMsgRef > 0
        ? String(numericMsgRef)
        : String(hashStringToPositiveInt(rawName || parsed.cleanTitle, 100000));
      effectiveFileMeta = {
        fileId: `tg_export_${chatRef}_${msgRef}`,
        fileUniqueId: `u_${chatRef}_${msgRef}`,
        messageId: numericMsgRef > 0 ? numericMsgRef : null,
        fileSize: parsed.parsedFileSize || null,
        mimeType: (typeof rawEntry === "object" && rawEntry?.mime_type) ? String(rawEntry.mime_type) : "video/mp4",
        rawFilename: String(rawName || ""),
        rawCaption: String(rawCaption || ""),
        messageLink: (typeof rawEntry === "object" && (rawEntry?.message_link || rawEntry?.messageLink)) ? String(rawEntry.message_link || rawEntry.messageLink) : ""
      };
    }

    if (effectiveFileMeta) {
      if (!effectiveFileMeta.fileSize && parsed.parsedFileSize) {
        effectiveFileMeta.fileSize = parsed.parsedFileSize;
      }
      if (!effectiveFileMeta.rawFilename && rawName) {
        effectiveFileMeta.rawFilename = String(rawName);
      }
      if (!effectiveFileMeta.rawCaption && rawCaption) {
        effectiveFileMeta.rawCaption = String(rawCaption);
      }
      if (!effectiveFileMeta.messageLink && typeof rawEntry === "object" && (rawEntry?.message_link || rawEntry?.messageLink)) {
        effectiveFileMeta.messageLink = String(rawEntry.message_link || rawEntry.messageLink);
      }
      if (!effectiveFileMeta.subtitles && typeof rawEntry === "object" && Array.isArray(rawEntry?.subtitle_files || rawEntry?.subtitles)) {
        effectiveFileMeta.subtitles = rawEntry.subtitle_files || rawEntry.subtitles;
      }
    }

    const explicitTmdbId = (typeof rawEntry === "object" && (rawEntry?.tmdb_id || rawEntry?.tmdbId))
      ? Number(rawEntry.tmdb_id || rawEntry.tmdbId)
      : (parsed.tmdbId ? Number(parsed.tmdbId) : null);
    if (typeof rawEntry === "object" && rawEntry?.bypassNegativeTitleCache) {
      options = { ...(options || {}), bypassNegativeTitleCache: true };
    }
    const searchTitle = parsed.cleanTitle;
    if (!explicitTmdbId && typeof rawEntry === "object" && rawEntry?.knownUnmatched && !options?.bypassNegativeTitleCache) {
      return options?.returnUnmatched
        ? {
            ok: false,
            unmatched: true,
            ingestStatus: "failed",
            reviewReasonCode: "TMDB_NOT_FOUND",
            confidence: 0,
            rawInput: rawName,
            parsed,
            candidates: [],
            fromNegativeCache: true
          }
        : null;
    }
    if (!searchTitle && !explicitTmdbId && !parsed.imdbId) {
      return options?.returnUnmatched
        ? { ok: false, unmatched: true, ingestStatus: "failed", reviewReasonCode: "PARSER_AMBIGUITY", confidence: 0, rawInput: rawName, parsed, candidates: [] }
        : null;
    }

    let candidates = [];
    let resolvedTypeCode = forceTypeCode || (parsed.isSeries ? "s" : "m");
    let targetId = explicitTmdbId;
    let bestConfidence = explicitTmdbId ? 100 : 0;
    let metadataSource = "TMDb";

    // STUFE 0: D1-First Vorab-Check & Universeller Titel-Cache (RAM + D1 entity_cache + D1 movies/series Katalog):
    // Prüft vor jedem externen API-Call, ob die Datei-ID oder der normalisierte Titel (egal ob Film, Serie, Fallback >= 8000000
    // oder bereits als "Nicht erkannt" geprüfter Titel) schon bekannt ist -> 0 externe API-Requests bei gleichem Titel!
    const normSeriesCacheKey = (parsed.isSeries && searchTitle)
      ? `series_res_${normalizeCompareString(searchTitle)}_${parsed.year || "any"}`
      : null;
    if (!targetId && !forceTypeCode && typeof findExistingMediaInD1BeforeExternalSearch === "function") {
      const d1PreHit = await findExistingMediaInD1BeforeExternalSearch(env, parsed, effectiveFileMeta?.fileId || null);
      if (d1PreHit) {
        if (d1PreHit.notFound && !options?.bypassNegativeTitleCache) {
          return options?.returnUnmatched
            ? {
                ok: false,
                unmatched: true,
                ingestStatus: "failed",
                reviewReasonCode: d1PreHit.reviewReasonCode || "TMDB_NOT_FOUND",
                confidence: 0,
                rawInput: rawName,
                parsed,
                candidates: d1PreHit.candidates || [],
                fromNegativeCache: true
              }
            : null;
        }
        if (d1PreHit.tmdbId) {
          targetId = Number(d1PreHit.tmdbId);
          resolvedTypeCode = d1PreHit.typeCode || resolvedTypeCode;
          bestConfidence = Number(d1PreHit.confidence || 94);
          metadataSource = d1PreHit.source || "D1-Cache";
          if (Array.isArray(d1PreHit.candidates) && d1PreHit.candidates.length > 0) {
            candidates = d1PreHit.candidates;
          }
          if (d1PreHit.season && resolvedTypeCode === "s" && !parsed.season) {
            parsed.season = Number(d1PreHit.season);
          }
          if (d1PreHit.episode && resolvedTypeCode === "s" && !parsed.episode) {
            parsed.episode = Number(d1PreHit.episode);
          }
          if (d1PreHit.details && typeof d1PreHit.details === "object") {
            setCachedTmdb(resolvedTypeCode === "s" ? `tv_${targetId}` : `movie_${targetId}`, d1PreHit.details);
          }
        }
      }
    }

    if (!targetId) {
      if (!options || typeof options !== "object") options = {};
      candidates = await searchTmdbCandidatesForImport(env, parsed, forceTypeCode, options);
      if (candidates.length > 0 && candidates[0].confidence >= 42) {
        targetId = candidates[0].tmdbId;
        resolvedTypeCode = candidates[0].typeCode;
        bestConfidence = candidates[0].confidence;
        metadataSource = candidates[0].source || "TMDb";
        // Falls eine Serie über eine angehängte oder eingebettete Nummer erkannt wurde (z. B. "Black Box 1", "Spuk im Hochhaus 1", "Pippi Langstrumpf 1 ...")
        if (resolvedTypeCode === "s" && (candidates[0].inferredEpisode || !parsed.hasExplicitEpisodePattern)) {
          parsed.isSeries = true;
          if (candidates[0].inferredEpisode) {
            parsed.season = candidates[0].inferredSeason || parsed.season || 1;
            parsed.episode = candidates[0].inferredEpisode;
          }
          if (candidates[0].inferredEpisodeTitle && !parsed.episodeTitle) {
            parsed.episodeTitle = candidates[0].inferredEpisodeTitle;
          }
          if (candidates[0].title && candidates[0].title !== "Unbekannt") {
            parsed.cleanTitle = candidates[0].title;
          }
        }
      }
    } else if (resolvedTypeCode === "s" && !rawEntry?.manualEpisode && !parsed.hasExplicitEpisodePattern) {
      // Falls manuell eine Serie zugewiesen wurde und im Dateinamen eine Episodennummer am Ende oder in der Mitte steht (z. B. "Generation Kill 1" oder "Zur See 1 Die Bewährung")
      const cleanRawBase = String(rawName || parsed.cleanTitle || "").replace(/(?:\.(?:mp4|mkv|avi|m4v|ts|mov|webm|flv|mk3d))+$/i, "");
      const rawTailMatch = cleanRawBase.match(/(?:^|\s|[-_])(?:teil\s*|part\s*|ep\.?\s*)?0*(\d{1,2})\s*$/i);
      const rawMidMatch = !rawTailMatch ? cleanRawBase.match(/^(.{2,}?)\s+(?:[-–]\s*)?(?:teil\s+|part\s+|ep\.?\s*|folge\s+)?0*(\d{1,2})\s+(?:[-–:]\s*)?(.{3,})$/i) : null;
      if (rawTailMatch) {
        const tailNum = parseInt(rawTailMatch[1], 10);
        if (tailNum >= 1 && tailNum <= 99) {
          parsed.season = parsed.season || 1;
          parsed.episode = tailNum;
        }
      } else if (rawMidMatch) {
        const midNum = parseInt(rawMidMatch[2], 10);
        if (midNum >= 1 && midNum <= 99) {
          parsed.season = parsed.season || 1;
          parsed.episode = midNum;
          if (!parsed.episodeTitle && rawMidMatch[3]) parsed.episodeTitle = rawMidMatch[3].trim();
        }
      }
    }

    if (resolvedTypeCode === "s") {
      // WEICHE -> TMDb TV-API + Multi-API Fallback (OMDb -> Apple iTunes DE -> TVMaze -> AniList -> Jikan -> Wikidata -> MediaWiki)
      const preExistingSeries = targetId ? await getSeriesFromD1(env, targetId) : null;
      let seriesDetails = targetId ? (preExistingSeries || await fetchSeriesDetails(env, targetId)) : null;

      // KEIN DB-EINTRAG OHNE ECHTES VIDEO:
      // Eine Serie darf erst in dem Moment in D1 (`series` / `series_seasons`) angelegt werden, wenn mindestens
      // eine gültige Videodatei (`fileId` mit Video) erfolgreich einer Episode zugeordnet wurde!
      const hasValidSeriesVideoFile = Boolean(
        effectiveFileMeta &&
        effectiveFileMeta.fileId &&
        scoreTelegramFileIdValidity(effectiveFileMeta.fileId) > 0
      );

      // Falls eine synthetische Fallback-ID (>= 8000000, z. B. MediaWiki / Wikidata / TVMaze / AniList) bestätigt oder zugewiesen wurde,
      // zunächst im RAM-Cache aufbauen und erst nach gültiger Video-Zuordnung in D1 persistieren!
      if (!seriesDetails && options?.candidateMeta && options.candidateMeta.title && Number(targetId) >= 8000000) {
        metadataSource = options.candidateMeta.source || "Fallback";
        const fb = { ...options.candidateMeta, id: Number(targetId), typeCode: "s" };
        seriesDetails = {
          id: Number(fb.id),
          title: fb.title || "Unbekannt",
          releaseDate: fb.releaseDate || (fb.year && fb.year !== "k.A." ? `${fb.year}-01-01` : "Keine Angabe"),
          fsk: "FSK Keine Angabe",
          statusText: fb.statusText || "Unbekannt",
          vote_average: Number(fb.vote_average || 0),
          runtime: fb.runtime || "Keine Angabe",
          country: fb.country || "k.A.",
          genres: fb.genres || "Serie",
          directors: fb.directors || "Keine Angabe",
          casts: fb.casts || "Keine Angabe",
          overview: fb.overview || "Keine Beschreibung verfügbar.",
          poster_path: null,
          external_poster_url: fb.poster || fb.external_poster_url || "",
          backdrop_path: null,
          numberOfSeasons: 1,
          numberOfEpisodes: 0,
          seasons: [{ season_number: 1, name: "Staffel 1", episode_count: 0, air_date: "" }],
          sourceFallback: fb.source || "Fallback"
        };
        setCachedTmdb(`tv_${seriesDetails.id}`, seriesDetails);
      }

      if (!seriesDetails && (!explicitTmdbId || Number(explicitTmdbId) >= 8000000) && !options?._fallbackAlreadyChecked && hasSubrequestBudget(16)) {
        const fbHit = await fetchMultiApiFallbackCascade(env, parsed, "s", {
          fallbackMode: options?.fallbackMode || (options?.speedProfile === "free_turbo" ? "smart_emergency" : "deep")
        });
        if (fbHit && fbHit.id) {
          targetId = Number(explicitTmdbId) >= 8000000 ? Number(explicitTmdbId) : Number(fbHit.id);
          bestConfidence = Math.max(bestConfidence, fbHit.confidence || 76);
          metadataSource = fbHit.source || "Fallback";
          if (targetId < 8000000) {
            seriesDetails = await fetchSeriesDetails(env, targetId);
          }
          if (!seriesDetails) {
            seriesDetails = {
              id: Number(targetId),
              title: fbHit.title || "Unbekannt",
              releaseDate: fbHit.releaseDate || (fbHit.year && fbHit.year !== "k.A." ? `${fbHit.year}-01-01` : "Keine Angabe"),
              fsk: fbHit.fsk || "FSK Keine Angabe",
              statusText: fbHit.statusText || "Unbekannt",
              vote_average: Number(fbHit.vote_average || 0),
              runtime: fbHit.runtime || "Keine Angabe",
              country: fbHit.country || "k.A.",
              genres: fbHit.genres || "Serie",
              directors: fbHit.directors || "Keine Angabe",
              casts: fbHit.casts || "Keine Angabe",
              overview: fbHit.overview || "Keine Beschreibung verfügbar.",
              poster_path: null,
              external_poster_url: fbHit.poster || fbHit.external_poster_url || "",
              backdrop_path: null,
              numberOfSeasons: Number(fbHit.numberOfSeasons || fbHit.seasons?.length || 1),
              numberOfEpisodes: Number(fbHit.numberOfEpisodes || 0),
              seasons: Array.isArray(fbHit.seasons) && fbHit.seasons.length > 0
                ? fbHit.seasons
                : [{ season_number: 1, name: "Staffel 1", episode_count: 0, air_date: "" }],
              sourceFallback: targetId >= 8000000 ? (fbHit.source || "Fallback") : null
            };
            setCachedTmdb(`tv_${seriesDetails.id}`, seriesDetails);
          }
        }
      }

      if (!seriesDetails && (!explicitTmdbId || Number(explicitTmdbId) >= 8000000) && !options?._fallbackAlreadyChecked && hasSubrequestBudget(16)) {
        const maze = await fetchTvMazeSeriesFallback(searchTitle, parsed.year || "");
        if (maze && maze.tvmazeId) {
          targetId = Number(explicitTmdbId) >= 8000000 ? Number(explicitTmdbId) : (200000000 + (Number(maze.tvmazeId) % 99999999));
          bestConfidence = 68;
          metadataSource = "TVMaze";
          seriesDetails = {
            id: targetId,
            title: maze.title,
            releaseDate: maze.releaseDate || "Keine Angabe",
            fsk: "FSK Keine Angabe",
            statusText: maze.statusText || "Unbekannt",
            vote_average: maze.vote_average || 0,
            runtime: maze.runtime || "Keine Angabe",
            country: "k.A.",
            genres: maze.genres || "Serie",
            directors: "Keine Angabe",
            casts: maze.casts || "Keine Angabe",
            overview: maze.overview || "Keine Beschreibung verfügbar.",
            poster_path: null,
            external_poster_url: maze.imageOriginal || "",
            backdrop_path: null,
            numberOfSeasons: maze.seasons?.length || 1,
            numberOfEpisodes: maze.episodes?.length || 0,
            seasons: maze.seasons || [],
            sourceFallback: "TVMaze"
          };
          setCachedTmdb(`tv_${targetId}`, seriesDetails);
        }
      }

      if (!seriesDetails) {
        const hitSubreqLimit = Boolean((typeof subrequestBudgetExhausted !== "undefined" && subrequestBudgetExhausted) || !hasSubrequestBudget(34));
        // Nur dann negativ cachen, wenn noch genügend Subrequest-Budget vorhanden war (kein Abbruch mitten in der Kaskade!)
        if (!hitSubreqLimit && typeof saveTitleResolutionCacheToD1 === "function") {
          await saveTitleResolutionCacheToD1(env, parsed, "s", {
            notFound: true,
            reviewReasonCode: "TMDB_NOT_FOUND",
            candidates: (candidates || []).slice(0, 5)
          });
        }
        return options?.returnUnmatched
          ? { ok: false, unmatched: true, abortedDueToSubrequestBudget: hitSubreqLimit, ingestStatus: "failed", reviewReasonCode: "TMDB_NOT_FOUND", confidence: bestConfidence, rawInput: rawName, parsed, candidates }
          : null;
      }

      // DUPLIKAT-SPERRE FÜR SERIEN:
      // Falls eine synthetische Fallback-ID (>= 8000000) aufgelöst wurde, prüfe zuerst, ob in D1 bereits eine offizielle TMDb-Serie (< 8000000)
      // mit demselben Titel existiert (verhindert doppelte Karten wie bei "Generation Kill"!), oder ob TMDb die Serie unter dem kanonischen Titel kennt!
      if (Number(seriesDetails.id) >= 8000000 && !options?.confirmManualWithoutTmdb) {
        try {
          const normTargetSeriesTitle = normalizeCompareString(seriesDetails.title || parsed.cleanTitle || searchTitle);
          const catalogMap = typeof ensureLocalD1CatalogTitleMapLoaded === "function"
            ? await ensureLocalD1CatalogTitleMapLoaded(env)
            : null;
          const matchedExisting = catalogMap instanceof Map ? catalogMap.get(`s_${normTargetSeriesTitle}_any`) : null;
          if (matchedExisting && matchedExisting.tmdbId && Number(matchedExisting.tmdbId) < 8000000) {
            const upgradedDetails = await fetchSeriesDetails(env, Number(matchedExisting.tmdbId));
            if (upgradedDetails && upgradedDetails.id) {
              targetId = Number(upgradedDetails.id);
              seriesDetails = upgradedDetails;
              metadataSource = "TMDb";
            }
          }
          if (Number(seriesDetails.id) >= 8000000 && env.TMDB_BEARER_TOKEN && normalizeCompareString(seriesDetails.title) !== normalizeCompareString(searchTitle)) {
            const qTitle = String(seriesDetails.title || "").trim();
            const tvRes = await cachedExternalFetchJson(
              `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(qTitle)}&language=de-DE&page=1`,
              { headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` } }
            );
            const bestTv = (tvRes?.results || []).find(r => {
              const nt = normalizeCompareString(r.name || "");
              const no = normalizeCompareString(r.original_name || "");
              return nt === normTargetSeriesTitle || no === normTargetSeriesTitle;
            }) || tvRes?.results?.[0];
            if (bestTv && bestTv.id) {
              const upgradedDetails = await fetchSeriesDetails(env, Number(bestTv.id));
              if (upgradedDetails && upgradedDetails.id) {
                targetId = Number(upgradedDetails.id);
                seriesDetails = upgradedDetails;
                metadataSource = "TMDb";
              }
            }
          }
        } catch (e) {}
      }

      // Universellen Serien-Titel-Cache befüllen (RAM + D1 entity_cache, inkl. Fallback-Serien >= 8000000!),
      // damit alle weiteren Episoden dieser Serie garantiert 0 externe Such-Requests benötigen!
      if (seriesDetails?.id && typeof saveTitleResolutionCacheToD1 === "function") {
        await saveTitleResolutionCacheToD1(env, parsed, "s", {
          tmdbId: Number(seriesDetails.id),
          typeCode: "s",
          title: seriesDetails.title,
          confidence: Math.max(bestConfidence, 85),
          source: metadataSource || "TMDb",
          details: Number(seriesDetails.id) >= 8000000 ? seriesDetails : null,
          candidates: (candidates || []).slice(0, 5)
        });
      }

      // MODUL 2.2: Bonus- & Special-Clips bekommen season = 0 (Specials) und überschreiben niemals reguläre Folgen!
      const isBonusClip = Boolean(parsed.isBonus || parsed.season === 0 || (typeof rawEntry === "object" && rawEntry?.isBonus));
      const seasonNum = isBonusClip ? 0 : (parsed.season || 1);
      const epNum = parsed.episode || 1;
      const epEndNum = (!isBonusClip && parsed.episodeEnd && parsed.episodeEnd >= epNum && parsed.episodeEnd <= epNum + 6)
        ? Number(parsed.episodeEnd)
        : epNum;

      let seasonData = null;
      let epObj = null;
      let versionInfo = {
        isAlternativeOrder: false,
        versionType: 1,
        versionLabel: "Originalfassung",
        detectedRuntimeMin: durationSec ? Math.round(durationSec / 60) : null
      };

      // Serien-Versions-Erkennung via TMDb episode_groups (1x pro Serie+Staffel cachen statt bei jeder einzelnen Episode neu auszuführen!):
      if (seriesDetails.id < 8000000) {
        const verCacheKey = `series_ver_resolved_${seriesDetails.id}_${seasonNum}`;
        const cachedVer = memoryFallback.get(verCacheKey);
        const stdSeasonMeta = (seriesDetails.seasons || []).find(s => Number(s?.season_number) === Number(seasonNum));
        const epExceedsStdSeason = Boolean(stdSeasonMeta && Number(stdSeasonMeta.episode_count || 0) > 0 && epNum > Number(stdSeasonMeta.episode_count));
        if (cachedVer && !epExceedsStdSeason) {
          if (cachedVer.versionInfo) versionInfo = cachedVer.versionInfo;
          seasonData = getCachedTmdb(`tv_season_${seriesDetails.id}_${seasonNum}`);
        } else {
          try {
            const resolvedVer = await resolveSeriesVersionOnTMDb(
              seriesDetails.id,
              { season: seasonNum, episode: epNum, durationSec },
              env
            );
            if (resolvedVer) {
              if (resolvedVer.versionInfo) versionInfo = resolvedVer.versionInfo;
              if (resolvedVer.episode) {
                epObj = resolvedVer.episode;
              }
              if (resolvedVer.versionInfo?.isAlternativeOrder && resolvedVer.series?.seasons) {
                seriesDetails.seasons = resolvedVer.series.seasons;
                seriesDetails.numberOfSeasons = resolvedVer.series.number_of_seasons || resolvedVer.series.seasons.length;
                seriesDetails.numberOfEpisodes = resolvedVer.series.number_of_episodes || resolvedVer.series.seasons.reduce((sum, s) => sum + Number(s.episode_count || 0), 0);
                seriesDetails.number_of_seasons = seriesDetails.numberOfSeasons;
                seriesDetails.number_of_episodes = seriesDetails.numberOfEpisodes;
                seriesDetails.versionInfo = resolvedVer.versionInfo;
                setCachedTmdb(`tv_${seriesDetails.id}`, seriesDetails);

                const groupSavedKey = `d1_group_seasons_saved_${seriesDetails.id}_${resolvedVer.versionInfo.groupId || "alt"}`;
                const alreadySavedGroupSeasons = Boolean(memoryFallback.get(groupSavedKey));
                if (!alreadySavedGroupSeasons && (hasValidSeriesVideoFile || preExistingSeries)) {
                  await saveSeriesToD1(env, seriesDetails);
                }

                if (Array.isArray(resolvedVer.series._normalizedGroupSeasons)) {
                  for (const gSeason of resolvedVer.series._normalizedGroupSeasons) {
                    const gNum = Number(gSeason.season_number || 1);
                    const normalizedSeasonObj = {
                      id: gSeason.id || `${seriesDetails.id}_${gNum}`,
                      season_number: gNum,
                      name: gSeason.name || `Staffel ${gNum}`,
                      seasonEpisodeCount: gSeason.episode_count,
                      isEpisodeGroup: true,
                      versionLabel: resolvedVer.versionInfo.versionLabel,
                      episodes: (gSeason.episodes || []).map(ep => ({
                        id: ep.id,
                        episode_number: ep.episode_number,
                        season_number: gNum,
                        name: ep.name || `Folge ${ep.episode_number}`,
                        air_date: ep.air_date || "",
                        runtime: ep.runtime ? `${ep.runtime} Min.` : "",
                        vote_average: ep.vote_average || 0,
                        overview: ep.overview || ""
                      }))
                    };
                    setCachedTmdb(`tv_season_${seriesDetails.id}_${gNum}`, normalizedSeasonObj);
                    if (!alreadySavedGroupSeasons && (hasValidSeriesVideoFile || preExistingSeries)) {
                      await saveSeasonToD1(env, seriesDetails.id, gNum, normalizedSeasonObj);
                    }
                    if (gNum === Number(seasonNum)) {
                      seasonData = normalizedSeasonObj;
                    }
                  }
                  if (hasValidSeriesVideoFile || preExistingSeries) {
                    memoryFallback.set(groupSavedKey, true);
                  }
                }
              }
              memoryFallback.set(verCacheKey, { versionInfo });
            }
          } catch (verErr) {}
        }
      }

      if (!seasonData && seriesDetails.id < 8000000) {
        seasonData = await fetchSeasonDetails(env, seriesDetails.id, seasonNum);
      }
      if (!epObj && seasonData?.episodes) {
        epObj = seasonData.episodes.find(e => Number(e.episode_number) === Number(epNum)) || null;
      }

      if (!epObj) {
        epObj = {
          episode_number: epNum,
          season_number: seasonNum,
          name: parsed.episodeTitle || `Folge ${epNum}`
        };
      }

      const curVerLabel = String(versionInfo?.versionLabel || "Originalfassung");
      let ingestStatus = "added";
      let savedAtLeastOneEpisodeVideo = false;
      if (hasValidSeriesVideoFile) {
        // Speichere Einzelfolgen sowie Doppelfolgen (z. B. ALF S01E16-E17) per Smart-UPSERT in D1.
        // NUR wenn in D1 bereits exakt dieselbe file_id UND message_id vorliegt, gilt es als Duplikat (SKIPPED_DUPLICATE).
        // Leere Slots oder abweichende/bessere Dateien werden per UPSERT aktualisiert; andere Qualitäten (720p/1080p/4K) bleiben parallel wählbar!
        const activeSeasonMaxEps = Number(versionInfo?.seasonEpisodeCount || seasonData?.seasonEpisodeCount || 0);
        let allExactDupes = true;
        let anyMergedQuality = false;
        let anyUpdated = false;
        for (let curEp = epNum; curEp <= epEndNum; curEp++) {
          // Verhindere das Anlegen von Folgen oberhalb der aktiven Gewinner-Gruppe (z. B. > 13 bei Haus des Geldes S01)
          if (FORCE_EPISODE_GROUP_SERIES.has(Number(seriesDetails.id)) && activeSeasonMaxEps > 0 && curEp > activeSeasonMaxEps) {
            continue;
          }
          const curEpObj = (seasonData?.episodes || []).find(e => Number(e.episode_number) === Number(curEp));
          const resolvedEpTitle = (curEp === epNum && epObj?.name && !/^Episode\s+\d+$/i.test(epObj.name))
            ? epObj.name
            : ((curEpObj && curEpObj.name && !/^Episode\s+\d+$/i.test(curEpObj.name))
                ? curEpObj.name
                : (parsed.episodeTitle || epObj.name || `Folge ${curEp}`));
          const combinedTags = [
            parsed.tags || "",
            curVerLabel !== "Originalfassung" ? curVerLabel : (versionInfo?.isAlternativeOrder ? curVerLabel : "")
          ].filter(Boolean).join(" · ");
          const saveEpRes = await saveEpisodeFileToD1(env, seriesDetails.id, seasonNum, curEp, {
            ...effectiveFileMeta,
            quality: parsed.quality,
            codec: parsed.codec,
            part: parsed.part,
            partNumber: parsed.partNumber || parsed.partInfo?.partNumber || 1,
            editionLabel: parsed.editionLabel || (Array.isArray(parsed.editions) && parsed.editions[0] ? parsed.editions[0] : null),
            isBonus: isBonusClip,
            durationSec,
            width: typeof rawEntry === "object" && rawEntry?.width ? Number(rawEntry.width) : null,
            height: typeof rawEntry === "object" && rawEntry?.height ? Number(rawEntry.height) : null,
            tags: combinedTags,
            versionLabel: curVerLabel,
            episodeTitle: resolvedEpTitle
          });
          if (saveEpRes && typeof saveEpRes === "object") {
            if (saveEpRes.skippedPrerelease) {
              ingestStatus = "skipped_prerelease";
              allExactDupes = false;
            } else {
              savedAtLeastOneEpisodeVideo = true;
              if (!saveEpRes.isExactDuplicate) allExactDupes = false;
              if (saveEpRes.isMergedQuality) anyMergedQuality = true;
              if (saveEpRes.isUpdated) anyUpdated = true;
              if (saveEpRes.replacedPrereleaseCount > 0) ingestStatus = "replaced_prerelease";
            }
          } else if (saveEpRes) {
            savedAtLeastOneEpisodeVideo = true;
            allExactDupes = false;
          }
        }
        if (ingestStatus !== "skipped_prerelease" && ingestStatus !== "replaced_prerelease") {
          if (savedAtLeastOneEpisodeVideo && allExactDupes) {
            ingestStatus = "duplicate";
          } else if (anyMergedQuality) {
            ingestStatus = "merged_quality";
          } else if (anyUpdated) {
            ingestStatus = "updated";
          } else {
            ingestStatus = "added";
          }
        }
      }

      if (!seriesDetails.poster_path && !seriesDetails.external_poster_url && candidates[0]?.poster) {
        seriesDetails.external_poster_url = candidates[0].poster;
      }
      if (options?.manualOverride || (typeof rawEntry === "object" && (rawEntry?.manualOverride || rawEntry?.manualTitle))) {
        seriesDetails.manualOverride = true;
      }

      // Erst JETZT (wenn mindestens ein gültiges Episoden-Video gespeichert wurde oder die Serie bereits mit Episoden existiert oder manuell bestätigt wurde) in D1 `series` schreiben!
      if (savedAtLeastOneEpisodeVideo || preExistingSeries || options?.allowCreateWithoutVideoFile) {
        await saveSeriesToD1(env, seriesDetails);
      }

      const rawYear = String(seriesDetails.releaseDate || "").split("-")[0] || (parsed.year ? String(parsed.year) : "k.A.");
      const tmdbYearNum = rawYear && /^\d{4}$/.test(rawYear) ? parseInt(rawYear, 10) : null;
      const yearDiff = (parsed.year && tmdbYearNum) ? Math.abs(parsed.year - tmdbYearNum) : 0;
      const isOngoingSeriesEpisodeYear = Boolean(
        parsed.isSeries &&
        parsed.year &&
        tmdbYearNum &&
        Number(parsed.year) >= tmdbYearNum &&
        (Number(parsed.year) - tmdbYearNum) <= 20 &&
        bestConfidence >= 80
      );
      const tmdbTitlesCombined = normalizeTitleForConfidence(`${seriesDetails.title || ""} ${seriesDetails.originalTitle || seriesDetails.original_name || ""}`);
      const queryTitleNorm = normalizeTitleForConfidence(parsed.cleanTitle || "");
      const isExactSeriesTitleMatch = Boolean(
        queryTitleNorm && (
          normalizeTitleForConfidence(seriesDetails.title || "") === queryTitleNorm ||
          normalizeTitleForConfidence(seriesDetails.originalTitle || seriesDetails.original_name || "") === queryTitleNorm
        )
      );
      const maxAllowedSeriesYearDiff = isExactSeriesTitleMatch ? 3 : 2;
      const trailingSeqMatch = String(parsed.cleanTitle || "").match(/\b([2-9])\s*$/);
      const seqNum = trailingSeqMatch ? trailingSeqMatch[1] : null;
      const sequelMismatch = Boolean(seqNum && !tmdbTitlesCombined.includes(seqNum) && yearDiff >= 1 && bestConfidence < 88);
      // "Little Britain" Staffel 4 & "The Walking Dead" S01E08 Fix:
      // Prüfe sowohl die Gesamtzahl der Staffeln als auch die Episodenanzahl der gewählten Staffel gegen TMDb!
      const maxTmdbSeasons = Number(
        seriesDetails.numberOfSeasons ||
        seriesDetails.number_of_seasons ||
        (Array.isArray(seriesDetails.seasons) ? seriesDetails.seasons.filter(s => Number(s?.season_number) > 0).length : 0) ||
        0
      );
      const officialSeasonEpCount = Number(
        seasonData?.episodes?.length ||
        seasonData?.seasonEpisodeCount ||
        (Array.isArray(seriesDetails.seasons) ? seriesDetails.seasons.find(s => Number(s?.season_number) === Number(seasonNum))?.episode_count : 0) ||
        0
      );
      const episodeExceedsOfficialSeason = Boolean(
        !explicitTmdbId &&
        !isBonusClip &&
        officialSeasonEpCount > 0 &&
        epNum > officialSeasonEpCount &&
        Number(seriesDetails.id) < 8000000
      );
      const seasonOverflowConflict = Boolean(
        (!explicitTmdbId && maxTmdbSeasons > 0 && seasonNum > maxTmdbSeasons && Number(seriesDetails.id) < 8000000) ||
        episodeExceedsOfficialSeason
      );
      const contextError = Boolean(!explicitTmdbId && !isOngoingSeriesEpisodeYear && (yearDiff > maxAllowedSeriesYearDiff || (yearDiff >= maxAllowedSeriesYearDiff && bestConfidence < 88) || sequelMismatch || seasonOverflowConflict));
      const isUncertain = Boolean(contextError || (!explicitTmdbId && bestConfidence < 74));
      const reviewReasonCode = contextError
        ? (seasonOverflowConflict
            ? "SEASON_CONFLICT"
            : (yearDiff > maxAllowedSeriesYearDiff || (yearDiff >= maxAllowedSeriesYearDiff && bestConfidence < 88))
              ? "YEAR_CONFLICT"
              : sequelMismatch
                ? "SEQUEL_CONFLICT"
                : "PARSER_AMBIGUITY")
        : (isUncertain ? "PARSER_AMBIGUITY" : null);
      const errorReason = contextError
        ? (seasonOverflowConflict
            ? (episodeExceedsOfficialSeason
                ? `Staffel-/Episoden-Konflikt: Datei nennt S${String(seasonNum).padStart(2, "0")}E${String(epNum).padStart(2, "0")} von "${parsed.cleanTitle}", aber Staffel ${seasonNum} von "${seriesDetails.title}" hat auf TMDb nur ${officialSeasonEpCount} Folge(n).`
                : `Staffel-Konflikt: Datei verlangt Staffel ${seasonNum} von "${parsed.cleanTitle}", aber TMDb-Treffer "${seriesDetails.title}" (${tmdbYearNum || "?"}) hat nur ${maxTmdbSeasons} Staffel(n). Bitte im Konflikt-Tab die richtige TMDb-ID zuweisen!`)
            : yearDiff > maxAllowedSeriesYearDiff
              ? `Jahres-Konflikt: Datei/Post nennt Jahr ${parsed.year}, aber TMDb-Treffer "${seriesDetails.title}" ist von ${tmdbYearNum || "?"} (${yearDiff} Jahre Abweichung).`
              : sequelMismatch
                ? `Fortsetzungs-/Teil-Konflikt: Dateiname nennt "${parsed.cleanTitle}" (Teil ${seqNum}), weicht aber vom TMDb-Titel "${seriesDetails.title}" (${tmdbYearNum || "?"}) ab.`
                : `Kontext-Konflikt: Post nennt "${parsed.cleanTitle}" (${parsed.year || "ohne Jahr"}), aber TMDb-Treffer ist "${seriesDetails.title}" (${tmdbYearNum || "?"}). Bitte manuell prüfen!`)
        : (isUncertain
            ? `Niedrige Treffer-Sicherheit (${bestConfidence}% Match): "${parsed.cleanTitle}" wurde vorläufig "${seriesDetails.title}" (${rawYear}) zugeordnet – bitte kurz prüfen oder bestätigen.`
            : null);

      // Wenn status: "CONFLICT_?" ausgelöst wird, bleibt der Treffer in der DB (mit needsReview: true) und landet automatisch im Dashboard-Tab [ 🚨 Meldungen / Konflikte ]
      if (contextError && typeof createMediaReportInD1 === "function") {
        await createMediaReportInD1(env, {
          reporterTelegramId: "system_import",
          reporterUsername: "Auto-Konflikt-Schutz",
          typeCode: "s",
          tmdbId: seriesDetails.id,
          title: `${seriesDetails.title} (S${String(seasonNum).padStart(2, "0")}E${String(epNum).padStart(2, "0")})`,
          seasonNumber: seasonNum,
          episodeNumber: epNum,
          telegramFileId: effectiveFileMeta?.fileId || "",
          reasonCode: reviewReasonCode || "wrong_tmdb",
          reasonLabel: `⚠️ Auto-Konflikt [${reviewReasonCode || "CONFLICT"}]`,
          note: `${errorReason} [Datei: ${rawName || parsed.cleanTitle}]`
        }).catch(() => {});
      }

      const posterUrl = resolvePosterUrl(seriesDetails.poster_path, "w185", seriesDetails.external_poster_url || candidates[0]?.poster || "");
      const finalEpTitle = (epObj.name && !/^Episode\s+\d+$/i.test(epObj.name))
        ? epObj.name
        : (parsed.episodeTitle || epObj.name || `Folge ${epNum}`);

      return {
        ok: true,
        status: contextError ? "CONFLICT" : "ok",
        needsReview: Boolean(contextError),
        contextError,
        reviewReasonCode,
        errorReason,
        typeCode: "s",
        tmdbId: seriesDetails.id,
        cleanTitle: seriesDetails.title,
        parsedTitle: parserCleanedSearchTitle || parsed.cleanTitle || seriesDetails.title,
        matchedTitle: seriesDetails.title,
        year: rawYear,
        poster: posterUrl,
        episodeTitle: finalEpTitle,
        season: seasonNum,
        episode: epNum,
        episodeEnd: epEndNum > epNum ? epEndNum : null,
        isBonus: isBonusClip,
        versionInfo,
        versionLabel: versionInfo?.versionLabel || "Original- / Standardfassung",
        quality: parsed.quality,
        codec: parsed.codec,
        part: parsed.part,
        partNumber: parsed.partNumber || parsed.partInfo?.partNumber || 1,
        partInfo: parsed.partInfo || null,
        editionLabel: parsed.editionLabel || null,
        editions: parsed.editions || [],
        tags: parsed.tags || "",
        languages: parsed.languages || ["de"],
        sourceUsed: parsed.sourceUsed || "file_name",
        metadataSource: seriesDetails.sourceFallback || metadataSource,
        fileSize: effectiveFileMeta?.fileSize || parsed.parsedFileSize || null,
        details: seriesDetails,
        fileMeta: effectiveFileMeta,
        hasValidVideoFile: Boolean(savedAtLeastOneEpisodeVideo),
        rawInput: rawName,
        ingestStatus,
        isUncertain,
        confidence: contextError ? Math.min(bestConfidence, 55) : bestConfidence,
        candidates
      };
    } else {
      // WEICHE -> TMDb Movie-API + Multi-API Fallback (OMDb -> Apple iTunes DE -> AniList -> Jikan -> Wikidata -> MediaWiki)
      let movieDetails = targetId ? await fetchMovieDetails(env, targetId) : null;
      const preExistingMovie = targetId ? await getMovieFromD1(env, targetId) : null;

      if (!movieDetails && options?.candidateMeta && options.candidateMeta.title && Number(targetId) >= 8000000) {
        metadataSource = options.candidateMeta.source || "Fallback";
        movieDetails = await saveFallbackHitToD1AndCache(env, {
          ...options.candidateMeta,
          id: Number(targetId),
          typeCode: "m"
        });
      }

      // Harter Jahres-Schutz ("Rotkäppchen (1954)" vs. "Die Rotkäppchen-Verschwörung (2005)"):
      // Wenn movieDetails aus einem falschen Jahrzehnt stammt (> 2 Jahre Abweichung zu parsed.year),
      // prüfe zuerst die Multi-API-Fallback-Kaskade (OMDb / Wikidata / Wikipedia DE) auf einen Treffer im richtigen Jahr!
      const prelimMovieYearStr = String(movieDetails?.releaseDate || "").split("-")[0];
      const prelimMovieYear = /^\d{4}$/.test(prelimMovieYearStr) ? parseInt(prelimMovieYearStr, 10) : null;
      const prelimYearMismatch = Boolean(!explicitTmdbId && parsed.year && prelimMovieYear && Math.abs(Number(parsed.year) - prelimMovieYear) > 2);

      if ((!movieDetails || prelimYearMismatch) && (!explicitTmdbId || Number(explicitTmdbId) >= 8000000) && (!options?._fallbackAlreadyChecked || prelimYearMismatch) && hasSubrequestBudget(16)) {
        const fbQueryParsed = (/(?:ae|oe|ue)/i.test(parsed.cleanTitle || "") && !/[äöüß]/i.test(parsed.cleanTitle || ""))
          ? {
              ...parsed,
              cleanTitle: String(parsed.cleanTitle)
                .replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü")
                .replace(/Ae/g, "Ä").replace(/Oe/g, "Ö").replace(/Ue/g, "Ü")
            }
          : parsed;
        const fbHit = await fetchMultiApiFallbackCascade(env, fbQueryParsed, "m", {
          fallbackMode: options?.fallbackMode || (options?.speedProfile === "free_turbo" ? "smart_emergency" : "deep")
        });
        const fbYear = fbHit?.year && /^\d{4}$/.test(String(fbHit.year)) ? parseInt(String(fbHit.year), 10) : null;
        const fbMatchesTargetYear = Boolean(!parsed.year || (fbYear && Math.abs(Number(parsed.year) - fbYear) <= 2));
        if (fbHit && fbHit.id && (!movieDetails || fbMatchesTargetYear)) {
          targetId = Number(explicitTmdbId) >= 8000000 ? Number(explicitTmdbId) : Number(fbHit.id);
          bestConfidence = Math.max(bestConfidence, fbHit.confidence || 82);
          metadataSource = fbHit.source || "Fallback";
          movieDetails = await saveFallbackHitToD1AndCache(env, { ...fbHit, id: targetId, typeCode: "m" });
        }
      }

      if (!movieDetails) {
        const hitSubreqLimit = Boolean((typeof subrequestBudgetExhausted !== "undefined" && subrequestBudgetExhausted) || !hasSubrequestBudget(34));
        if (!hitSubreqLimit && typeof saveTitleResolutionCacheToD1 === "function") {
          await saveTitleResolutionCacheToD1(env, parsed, "m", {
            notFound: true,
            reviewReasonCode: "TMDB_NOT_FOUND",
            candidates: (candidates || []).slice(0, 5)
          });
        }
        return options?.returnUnmatched
          ? { ok: false, unmatched: true, abortedDueToSubrequestBudget: hitSubreqLimit, ingestStatus: "failed", reviewReasonCode: "TMDB_NOT_FOUND", confidence: bestConfidence, rawInput: rawName, parsed, candidates }
          : null;
      }

      if (movieDetails?.id && typeof saveTitleResolutionCacheToD1 === "function") {
        await saveTitleResolutionCacheToD1(env, parsed, "m", {
          tmdbId: Number(movieDetails.id),
          typeCode: "m",
          title: movieDetails.title,
          confidence: Math.max(bestConfidence, 85),
          source: metadataSource || "TMDb",
          details: Number(movieDetails.id) >= 8000000 ? movieDetails : null,
          candidates: (candidates || []).slice(0, 5)
        });
      }

      const hasValidMovieVideoFile = Boolean(
        effectiveFileMeta &&
        effectiveFileMeta.fileId &&
        scoreTelegramFileIdValidity(effectiveFileMeta.fileId) > 0
      );

      let ingestStatus = "added";
      let savedMovieVideo = false;
      if (hasValidMovieVideoFile) {
        const saveMovRes = await saveMovieFileToD1(env, movieDetails.id, {
          ...effectiveFileMeta,
          quality: parsed.quality,
          codec: parsed.codec,
          part: parsed.part,
          partNumber: parsed.partNumber || parsed.partInfo?.partNumber || 1,
          editionLabel: parsed.editionLabel || (Array.isArray(parsed.editions) && parsed.editions[0] ? parsed.editions[0] : null),
          isBonus: Boolean(parsed.isBonus),
          durationSec,
          width: typeof rawEntry === "object" && rawEntry?.width ? Number(rawEntry.width) : null,
          height: typeof rawEntry === "object" && rawEntry?.height ? Number(rawEntry.height) : null,
          tags: parsed.tags || ""
        });
        if (saveMovRes && typeof saveMovRes === "object") {
          if (saveMovRes.skippedPrerelease) {
            ingestStatus = "skipped_prerelease";
          } else {
            savedMovieVideo = true;
            if (saveMovRes.replacedPrereleaseCount > 0) ingestStatus = "replaced_prerelease";
            else if (saveMovRes.isExactDuplicate) ingestStatus = "duplicate";
            else if (saveMovRes.isMergedQuality) ingestStatus = "merged_quality";
            else if (saveMovRes.isUpdated) ingestStatus = "updated";
          }
        } else if (saveMovRes) {
          savedMovieVideo = true;
        }
      }

      if (!movieDetails.poster_path && !movieDetails.external_poster_url && candidates[0]?.poster) {
        movieDetails.external_poster_url = candidates[0].poster;
      }
      if (options?.manualOverride || (typeof rawEntry === "object" && (rawEntry?.manualOverride || rawEntry?.manualTitle))) {
        movieDetails.manualOverride = true;
      }

      // Kein leerer Film-Eintrag ohne gültige Videodatei in D1:
      // Speichere `movies` in D1 erst dann, wenn tatsächlich eine gültige Videodatei gespeichert wurde (oder bereits existiert oder manuell bestätigt wurde)!
      if (savedMovieVideo || preExistingMovie || options?.allowCreateWithoutVideoFile) {
        await saveMovieToD1(env, movieDetails);
      }

      const rawYear = String(movieDetails.releaseDate || "").split("-")[0] || (parsed.year ? String(parsed.year) : "k.A.");
      const tmdbYearNum = rawYear && /^\d{4}$/.test(rawYear) ? parseInt(rawYear, 10) : null;
      const yearDiff = (parsed.year && tmdbYearNum) ? Math.abs(parsed.year - tmdbYearNum) : 0;
      const trailingSeqMatch = String(parsed.cleanTitle || "").match(/\b([2-9])\s*$/);
      const seqNum = trailingSeqMatch ? trailingSeqMatch[1] : null;
      const tmdbTitlesCombined = normalizeTitleForConfidence(`${movieDetails.title || ""} ${movieDetails.originalTitle || movieDetails.original_title || ""}`);
      const queryMovieNorm = normalizeTitleForConfidence(parsed.cleanTitle || "");
      const querySubParts = String(parsed.cleanTitle || "").split(/\s*[-–—:]\s*/);
      const querySubNorm = querySubParts.length >= 2 ? normalizeTitleForConfidence(querySubParts.slice(1).join(" ")) : "";
      const movieDeSubParts = String(movieDetails.title || "").split(/\s*[-–—:]\s*/);
      const movieOrigSubParts = String(movieDetails.originalTitle || movieDetails.original_title || "").split(/\s*[-–—:]\s*/);
      const movieDeSubNorm = movieDeSubParts.length >= 2 ? normalizeTitleForConfidence(movieDeSubParts.slice(1).join(" ")) : "";
      const movieOrigSubNorm = movieOrigSubParts.length >= 2 ? normalizeTitleForConfidence(movieOrigSubParts.slice(1).join(" ")) : "";
      const isExactMovieOrSubtitleMatch = Boolean(
        (queryMovieNorm && (
          normalizeTitleForConfidence(movieDetails.title || "") === queryMovieNorm ||
          normalizeTitleForConfidence(movieDetails.originalTitle || movieDetails.original_title || "") === queryMovieNorm
        )) ||
        (querySubNorm && querySubNorm.length >= 4 && (
          querySubNorm === movieDeSubNorm ||
          querySubNorm === movieOrigSubNorm ||
          querySubNorm === normalizeTitleForConfidence(movieDetails.title || "") ||
          querySubNorm === normalizeTitleForConfidence(movieDetails.originalTitle || movieDetails.original_title || "")
        ))
      );
      // MODUL 5.1: Deaktiviere bei part_number > 1 (echter Datei-Split wie CD2 / Part 2 nach Jahr) oder exaktem Untertitel-Match ("Alien 2 - Die Rückkehr" <-> "Aliens - Die Rückkehr") den Sequel-Konflikt-Check!
      const effectivePartNum = Number(parsed.partNumber || parsed.partInfo?.partNumber || 1) || 1;
      const sequelMismatch = (effectivePartNum > 1 || parsed.partInfo?.isSplit || isExactMovieOrSubtitleMatch)
        ? false
        : Boolean(seqNum && !tmdbTitlesCombined.includes(seqNum) && !(seqNum === "7" && tmdbTitlesCombined.includes("3d")) && yearDiff >= 1 && bestConfidence < 88);
      // MODUL 6.2: Bei 100% Titel-/Untertitel-Match sind bis zu ±3 Jahre Abweichung erlaubt (kein YEAR_CONFLICT!)
      const maxAllowedMovieYearDiff = isExactMovieOrSubtitleMatch ? 3 : 2;
      const contextError = Boolean(!explicitTmdbId && (yearDiff > maxAllowedMovieYearDiff || (yearDiff >= maxAllowedMovieYearDiff && !isExactMovieOrSubtitleMatch && bestConfidence < 88) || sequelMismatch));
      const isUncertain = Boolean(contextError || (!explicitTmdbId && bestConfidence < 74));
      const reviewReasonCode = contextError
        ? ((yearDiff > maxAllowedMovieYearDiff || (yearDiff >= maxAllowedMovieYearDiff && !isExactMovieOrSubtitleMatch && bestConfidence < 88))
            ? "YEAR_CONFLICT"
            : sequelMismatch
              ? "SEQUEL_CONFLICT"
              : "PARSER_AMBIGUITY")
        : (isUncertain ? "PARSER_AMBIGUITY" : null);
      const errorReason = contextError
        ? (yearDiff > maxAllowedMovieYearDiff
            ? `Jahres-Konflikt: Datei/Post nennt Jahr ${parsed.year}, aber TMDb-Treffer "${movieDetails.title}" ist von ${tmdbYearNum || "?"} (${yearDiff} Jahre Abweichung). Bitte prüfen!`
            : sequelMismatch
              ? `Fortsetzungs-/Teil-Konflikt: Dateiname nennt "${parsed.cleanTitle}" (Teil ${seqNum}), weicht aber vom TMDb-Titel "${movieDetails.title}" (${tmdbYearNum || "?"}) ab.`
              : `Kontext-Konflikt: Post nennt "${parsed.cleanTitle}" (${parsed.year || "ohne Jahr"}), aber TMDb-Treffer ist "${movieDetails.title}" (${tmdbYearNum || "?"}). Bitte manuell prüfen!`)
        : (isUncertain
            ? `Niedrige Treffer-Sicherheit (${bestConfidence}% Match): "${parsed.cleanTitle}" wurde vorläufig "${movieDetails.title}" (${rawYear}) zugeordnet – bitte kurz prüfen oder bestätigen.`
            : null);

      if (contextError && typeof createMediaReportInD1 === "function") {
        await createMediaReportInD1(env, {
          reporterTelegramId: "system_import",
          reporterUsername: "Auto-Konflikt-Schutz",
          typeCode: "m",
          tmdbId: movieDetails.id,
          title: `${movieDetails.title} (${rawYear})`,
          seasonNumber: 0,
          episodeNumber: 0,
          telegramFileId: effectiveFileMeta?.fileId || "",
          reasonCode: reviewReasonCode || "wrong_tmdb",
          reasonLabel: `⚠️ Auto-Konflikt [${reviewReasonCode || "CONFLICT"}]`,
          note: `${errorReason} [Datei: ${rawName || parsed.cleanTitle}]`
        }).catch(() => {});
      }

      const posterUrl = resolvePosterUrl(movieDetails.poster_path, "w185", movieDetails.external_poster_url || candidates[0]?.poster || "");

      return {
        ok: true,
        status: contextError ? "CONFLICT" : "ok",
        needsReview: Boolean(contextError),
        contextError,
        reviewReasonCode,
        errorReason,
        typeCode: "m",
        tmdbId: movieDetails.id,
        cleanTitle: movieDetails.title,
        parsedTitle: parserCleanedSearchTitle || parsed.cleanTitle || movieDetails.title,
        matchedTitle: movieDetails.title,
        year: rawYear,
        poster: posterUrl,
        season: null,
        episode: null,
        quality: parsed.quality,
        codec: parsed.codec,
        part: parsed.part,
        partNumber: parsed.partNumber || parsed.partInfo?.partNumber || 1,
        partInfo: parsed.partInfo || null,
        editionLabel: parsed.editionLabel || null,
        editions: parsed.editions || [],
        tags: parsed.tags || "",
        languages: parsed.languages || ["de"],
        sourceUsed: parsed.sourceUsed || "file_name",
        metadataSource: movieDetails.sourceFallback || metadataSource,
        fileSize: effectiveFileMeta?.fileSize || parsed.parsedFileSize || null,
        details: movieDetails,
        fileMeta: effectiveFileMeta,
        hasValidVideoFile: Boolean(savedMovieVideo),
        rawInput: rawName,
        ingestStatus,
        isUncertain,
        confidence: contextError ? Math.min(bestConfidence, 55) : bestConfidence,
        candidates
      };
    }
  }

  // --- 4-Stufen JSON-Auto-Repair & Telegram Chat-Backup (result.json) Tiefen-Parser ---
  function repairAndParseBackupJson(rawText) {
    const repairNotes = [];
    let text = String(rawText || "").replace(/^\uFEFF/, "").replace(/\0/g, "").trim();
    if (!text) {
      return { ok: false, parsed: null, repaired: false, repairNotes: ["Datei ist leer"] };
    }

    // Stufe 1: Direktes JSON.parse
    try {
      return { ok: true, parsed: JSON.parse(text), repaired: false, repairNotes: [] };
    } catch (firstErr) {
      let cleaned = text;
      const firstBracket = cleaned.search(/[\{\[]/);
      const lastBrace = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
      if (firstBracket > 0 || (lastBrace !== -1 && lastBrace < cleaned.length - 1)) {
        cleaned = cleaned.slice(Math.max(0, firstBracket), lastBrace !== -1 ? lastBrace + 1 : cleaned.length);
        repairNotes.push("Überflüssiger Text vor/nach den JSON-Klammern entfernt");
      }
      const noTrailingCommas = cleaned.replace(/,\s*([\}\]])/g, "$1");
      if (noTrailingCommas !== cleaned) {
        repairNotes.push("Überzählige Kommas (Trailing Commas) korrigiert");
      }
      try {
        return { ok: true, parsed: JSON.parse(noTrailingCommas), repaired: true, repairNotes };
      } catch (e2) {}

      // Stufe 2: Multi-Block / Concatenated JSON Splitter
      const blocks = [];
      let depth = 0;
      let startIdx = -1;
      let inStr = false;
      let escNext = false;
      for (let i = 0; i < noTrailingCommas.length; i++) {
        const ch = noTrailingCommas[i];
        if (escNext) {
          escNext = false;
          continue;
        }
        if (ch === "\\" && inStr) {
          escNext = true;
          continue;
        }
        if (ch === '"') {
          inStr = !inStr;
          continue;
        }
        if (!inStr) {
          if (ch === "{" || ch === "[") {
            if (depth === 0) startIdx = i;
            depth++;
          } else if (ch === "}" || ch === "]") {
            depth--;
            if (depth === 0 && startIdx !== -1) {
              const blockStr = noTrailingCommas.slice(startIdx, i + 1);
              try {
                blocks.push(JSON.parse(blockStr));
              } catch (eb) {}
              startIdx = -1;
            } else if (depth < 0) {
              depth = 0;
              startIdx = -1;
            }
          }
        }
      }

      if (blocks.length > 0) {
        repairNotes.push(`Mehrteilige JSON-Blöcke (${blocks.length} Segmente) automatisch zusammengeführt`);
        if (blocks.length === 1) {
          return { ok: true, parsed: blocks[0], repaired: true, repairNotes };
        }
        const combinedMessages = [];
        const combinedItems = [];
        let combinedChatName = "";
        for (const blk of blocks) {
          if (Array.isArray(blk?.messages)) {
            if (!combinedChatName && (blk.name || blk.title)) combinedChatName = String(blk.name || blk.title);
            for (const m of blk.messages) combinedMessages.push(m);
          } else if (Array.isArray(blk?.chats?.list)) {
            for (const ch of blk.chats.list) {
              if (!combinedChatName && ch?.name) combinedChatName = String(ch.name);
              if (Array.isArray(ch?.messages)) {
                for (const m of ch.messages) combinedMessages.push(m);
              }
            }
          } else if (Array.isArray(blk)) {
            for (const item of blk) {
              if (item && (item.type === "message" || item.file_name || item.text || item.media_type)) {
                combinedMessages.push(item);
              } else {
                combinedItems.push(item);
              }
            }
          } else if (blk && typeof blk === "object") {
            if (blk.type === "message" || blk.file_name || (blk.id && blk.text)) {
              combinedMessages.push(blk);
            } else {
              combinedItems.push(blk);
            }
          }
        }
        if (combinedMessages.length > 0) {
          return {
            ok: true,
            parsed: { name: combinedChatName || "Telegram Export (Repariert)", messages: combinedMessages },
            repaired: true,
            repairNotes
          };
        }
        return { ok: true, parsed: combinedItems, repaired: true, repairNotes };
      }

      // Stufe 3: NDJSON / Zeilenweises JSON
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const lineObjs = [];
      for (const line of lines) {
        const cleanLine = line.replace(/,$/, "").trim();
        if ((cleanLine.startsWith("{") && cleanLine.endsWith("}")) || (cleanLine.startsWith("[") && cleanLine.endsWith("]"))) {
          try {
            const o = JSON.parse(cleanLine);
            if (Array.isArray(o)) lineObjs.push(...o);
            else lineObjs.push(o);
          } catch (el) {}
        }
      }
      if (lineObjs.length > 0) {
        repairNotes.push(`Zeilenweises JSON / NDJSON (${lineObjs.length} Zeilen) automatisch repariert`);
        const looksLikeTg = lineObjs.some(o => o && (o.type === "message" || o.file_name || o.media_type || o.text));
        return {
          ok: true,
          parsed: looksLikeTg ? { name: "Telegram Export (NDJSON)", messages: lineObjs } : lineObjs,
          repaired: true,
          repairNotes
        };
      }

      // Stufe 4: Notfall-Objekt-Scanner
      const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
      const recoveredChatName = nameMatch ? nameMatch[1] : "Repariertes Telegram-Backup";
      const recoveredMsgs = [];
      const msgRegex = /\{[^{}]*"(?:file_name|file|text|title|filename|media_type)"[^{}]*\}/g;
      let mMatch;
      while ((mMatch = msgRegex.exec(noTrailingCommas)) !== null) {
        try {
          recoveredMsgs.push(JSON.parse(mMatch[0]));
        } catch (em) {}
      }
      if (recoveredMsgs.length > 0) {
        repairNotes.push(`Beschädigte JSON-Struktur repariert (${recoveredMsgs.length} Nachrichten rekonstruiert)`);
        return {
          ok: true,
          parsed: { name: recoveredChatName, messages: recoveredMsgs },
          repaired: true,
          repairNotes
        };
      }

      return { ok: false, parsed: null, repaired: false, repairNotes: [firstErr.message] };
    }
  }

  function flattenTelegramExportText(textField) {
    if (!textField) return "";
    if (typeof textField === "string") return textField.trim();
    if (Array.isArray(textField)) {
      return textField
        .map(part => {
          if (typeof part === "string") return part;
          if (part && typeof part.text === "string") return part.text;
          return "";
        })
        .join("")
        .trim();
    }
    return "";
  }

  function buildTelegramMessageLink(chatMeta, msgId) {
    if (!msgId) return "";
    const username = String(chatMeta?.username || "").replace(/^@/, "").trim();
    if (username) {
      return `https://t.me/${username}/${msgId}`;
    }
    const rawChatId = String(chatMeta?.id || "").trim();
    if (rawChatId && /^-?\d+$/.test(rawChatId)) {
      const cleanId = rawChatId.replace(/^-100/, "").replace(/^-/, "");
      if (cleanId) return `https://t.me/c/${cleanId}/${msgId}`;
    }
    return "";
  }

  function summarizePrecedingMessageForContext(msg) {
    if (!msg || typeof msg !== "object") return null;
    const rawMsgNum = Number(msg.id || msg.message_id || msg.msg_id || 0);
    const msgId = rawMsgNum > 0 ? rawMsgNum : null;
    const rawText = flattenTelegramExportText(msg.text || msg.caption || msg.text_entities);
    const normText = normalizeText(rawText).trim();
    const preCtx = extractPreContext(msg, {});
    const isPhoto = Boolean(msg.photo || msg.media_type === "photo" || /^image\//i.test(msg.mime_type || ""));
    if (!normText && !preCtx.tmdbId && !preCtx.imdbId && !isPhoto) return null;

    const firstLine = normText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0] || "";
    const titleGuess = preCtx.title || preCtx.seriesHeader || cleanMediaTitle(firstLine) || "";

    return {
      msgId,
      text: normText.slice(0, 320),
      titleGuess: titleGuess.slice(0, 90),
      yearGuess: preCtx.year || null,
      tmdbId: preCtx.tmdbId || null,
      mediaType: preCtx.mediaType || null,
      imdbId: preCtx.imdbId || null,
      isPhoto
    };
  }

  function extractCandidateRawItemsFromTgMessage(msg, prevContext = {}, prevMessagesWindow = [], chatMeta = {}) {
    if (!msg || (msg.type && msg.type !== "message")) return [];
    if (isJunkOrSticker(msg)) return [];
    const rawFileName = String(msg.file_name || msg.video?.file_name || msg.document?.file_name || "").trim();
    const rawFilePath = String(msg.file || "").trim();
    const validFilePath = rawFilePath && !rawFilePath.startsWith("(File not included")
      ? rawFilePath.split("/").pop()
      : "";
    const flatText = (typeof extractRawMessageText === "function" ? extractRawMessageText(msg) : "") || flattenTelegramExportText(msg.text || msg.caption || msg.text_entities);
    const rawMsgNum = Number(msg.id || msg.message_id || msg.msg_id || 0);
    const msgId = rawMsgNum > 0 ? rawMsgNum : null;
    const messageLink = buildTelegramMessageLink(chatMeta, msgId);
    const summarizedPrev = Array.isArray(prevMessagesWindow)
      ? prevMessagesWindow.map(summarizePrecedingMessageForContext).filter(Boolean).slice(-2)
      : [];

    // 1. Gold-Master parseTelegramMessage für Video-Nachrichten (inkl. 25-Nachrichten Pre-Context)
    const gmVideo = parseTelegramMessage(msg, prevContext);
    if (gmVideo && (gmVideo.title || gmVideo.tmdbId)) {
      const resolvedQuality = gmVideo.quality || detectVideoQuality(msg, flatText, rawFileName);
      const sizeFromText = flatText.match(/\b(\d{1,4}(?:[.,]\d{1,2})?\s*(?:GB|GiB|MB|MiB))\b/i)?.[1] || null;
      const tagsFromText = extractMediaReleaseTags(flatText, rawFileName, gmVideo.durationSec).join(" · ");
      let syntheticName = gmVideo.title || rawFileName || validFilePath;
      if (gmVideo.mediaType === "tv" && gmVideo.season !== null && gmVideo.episode) {
        syntheticName += ` S${String(gmVideo.season).padStart(2, "0")}E${String(gmVideo.episode).padStart(2, "0")}`;
      }
      if (gmVideo.year) syntheticName += ` (${gmVideo.year})`;
      if (resolvedQuality) syntheticName += ` ${resolvedQuality}`;

      return [{
        filename: syntheticName.trim(),
        rawInput: rawFileName || validFilePath || flatText.split(/\r?\n/)[0] || syntheticName,
        raw_file_name: rawFileName || validFilePath || "",
        raw_text: flatText.slice(0, 500),
        rawText: flatText.slice(0, 500),
        cleanTitle: gmVideo.title,
        titleFromText: gmVideo.titleFromText || null,
        titleFromFileName: gmVideo.titleFromFileName || null,
        originalTitle: gmVideo.originalTitle || null,
        year: gmVideo.year || null,
        isSeries: gmVideo.mediaType === "tv",
        isBonus: Boolean(gmVideo.isBonus || gmVideo.season === 0),
        season: gmVideo.season !== undefined ? gmVideo.season : null,
        episode: gmVideo.episode || null,
        episodeEnd: gmVideo.episodeEnd || null,
        episodeTitle: gmVideo.episodeTitle || "",
        quality: resolvedQuality,
        width: Number(msg.width || msg.video?.width || 0) || null,
        height: Number(msg.height || msg.video?.height || 0) || null,
        part: gmVideo.partInfo ? gmVideo.partInfo.partLabel : null,
        partNumber: gmVideo.partNumber || gmVideo.partInfo?.partNumber || 1,
        partInfo: gmVideo.partInfo || null,
        editionLabel: gmVideo.editionLabel || (Array.isArray(gmVideo.editions) && gmVideo.editions[0] ? gmVideo.editions[0] : null),
        editions: gmVideo.editions || [],
        tmdb_id: gmVideo.tmdbId || null,
        imdb_id: gmVideo.imdbId || null,
        languages: gmVideo.languages || ["de"],
        subtitles: gmVideo.subtitles || [],
        duration_sec: gmVideo.durationSec || null,
        contextOverview: gmVideo.contextOverview || "",
        source_used: gmVideo.sourceUsed || "file_name",
        pre_context: { ...prevContext },
        telegram_file_id: msg.telegram_file_id || msg.file_id || null,
        telegram_unique_id: msg.file_unique_id || msg.telegram_unique_id || null,
        file_size: msg.file_size || (sizeFromText ? parseHumanFileSizeToBytes(sizeFromText) : null),
        tags: tagsFromText || null,
        mime_type: msg.mime_type || "video/mp4",
        msg_id: msgId,
        message_id: msgId,
        chat_id: chatMeta?.id || null,
        message_link: messageLink,
        prev_messages: summarizedPrev
      }];
    }

    // 2. Mehrzeilige Titellisten in reinen Text-Nachrichten (niemals bei Foto-Steckbriefen wie ID 15085!)
    const isPhotoMsg = Boolean(msg.photo || msg.media_type === "photo" || /^image\//i.test(msg.mime_type || ""));
    const lines = flatText
      .split(/\r?\n/)
      .map(l => l.replace(/^[🎬📺🎞️🍿⭐️•\-▶️\d.)\s]+/, "").trim())
      .filter(l => l.length >= 2 && l.length <= 110 && !/^https?:\/\//i.test(l) && !/^@[a-zA-Z0-9_]+$/.test(l));
    const metaPrefixRegex = /^(?:Qualität|Quality|Genre|FSK|Jahr|Release|Bewertung|Rating|Audio|Sprache|Dauer|Laufzeit|Regie|Darsteller|Cast|Handlung|Inhalt|Beschreibung|Plot|Info|Größe|Size|Format|Codec|Quelle|Source|Link|Download|Stream|Kanal|Channel)\s*[:\-]/i;
    const contentLines = lines.filter(l => !metaPrefixRegex.test(l));

    if (!rawFileName && !validFilePath && !isPhotoMsg && contentLines.length >= 2 && !/\b\d+\s*Folgen\s+in\s+\d+\s*Staffel/i.test(flatText)) {
      const multiLinesWithMedia = contentLines.filter(l =>
        /\b(?:19\d{2}|20[0-3]\d|S\d{1,2}E\d{1,3}|1080p|720p|2160p|4K|x264|x265|BluRay|WEB-DL)\b/i.test(l)
      );
      if (multiLinesWithMedia.length >= 2) {
        return multiLinesWithMedia.map(lineStr => ({
          filename: lineStr,
          rawInput: lineStr,
          raw_file_name: "",
          raw_text: flatText.slice(0, 500),
          telegram_file_id: null,
          file_size: null,
          tags: extractMediaReleaseTags(lineStr).join(" · ") || null,
          mime_type: "video/mp4",
          msg_id: msgId,
          message_id: msgId,
          chat_id: chatMeta?.id || null,
          message_link: messageLink,
          prev_messages: summarizedPrev
        }));
      }
    }

    return [];
  }

  function deduplicateAndClassifyBackupEntries(rawCandidateEntries) {
    const entries = [];
    const seenExactStreamKeys = new Set();
    const seenFileIds = new Set();
    const seenWorkKeys = new Set();
    let duplicatesSkippedCount = 0;
    let qualityVariantsCount = 0;
    let detectedMoviesCount = 0;
    let detectedSeriesCount = 0;

    for (let i = 0; i < rawCandidateEntries.length; i++) {
      const item = rawCandidateEntries[i];
      if (!item) continue;
      const rawStr = typeof item === "string"
        ? item
        : String(item.filename || item.file_name || item.title || item.name || "").trim();
      if (!rawStr || rawStr.length < 2) continue;

      const parsed = parseMediaFilename(
        (typeof item === "object" && (item.raw_file_name || item.file_name)) ? String(item.raw_file_name || item.file_name) : rawStr,
        item?.raw_text || item?.rawText || "",
        item?.pre_context || null,
        item?.duration_sec || null
      );
      if (typeof item === "object" && item !== null) {
        if (item.cleanTitle && item.cleanTitle !== "Unbekannt") {
          parsed.cleanTitle = cleanMediaTitle(item.cleanTitle) || item.cleanTitle;
        }
        if (item.type === "series" || item.type === "tv" || item.isSeries === true || item.season || item.episode) {
          parsed.isSeries = true;
          // Dateiname hat Vorrang vor Caption-Tippfehlern (z.B. ID 911: "Queen of the South S01E13.mp4" vs. Caption "S01E3"):
          parsed.season = Number(parsed.season || item.season || 1);
          parsed.episode = Number(parsed.episode || item.episode || 1);
          if (item.episodeEnd || parsed.episodeEnd) parsed.episodeEnd = Number(parsed.episodeEnd || item.episodeEnd);
        } else if (item.isSeries === false) {
          parsed.isSeries = false;
          parsed.season = null;
          parsed.episode = null;
        }
        if (item.episodeTitle !== undefined && item.episodeTitle) parsed.episodeTitle = String(item.episodeTitle);
        if (item.year !== undefined) parsed.year = item.year ? Number(item.year) : null;
        if (item.width || item.height) {
          parsed.quality = detectVideoQuality(item, item.raw_text || item.rawText || "", rawStr);
        } else if (item.quality !== undefined) {
          parsed.quality = item.quality ? String(item.quality) : null;
        }
        if (item.part) parsed.part = String(item.part);
        else if (item.partInfo?.partLabel) parsed.part = String(item.partInfo.partLabel);
      }

      const normTitle = normalizeTitleForConfidence(parsed.cleanTitle);
      if ((!normTitle || normTitle === "unbekannt") && !item?.tmdb_id) continue;

      const fileId = (typeof item === "object" && (item.telegram_file_id || item.file_id || item.fileId))
        ? String(item.telegram_file_id || item.file_id || item.fileId)
        : "";
      if (fileId && !fileId.startsWith("tg_export_") && seenFileIds.has(fileId)) {
        duplicatesSkippedCount++;
        continue;
      }

      const rawFileNameKey = String(
        (typeof item === "object" && (item.raw_file_name || item.file_name || item.rawInput)) || rawStr
      ).trim().toLowerCase();
      const fileSizeBytes = Number((typeof item === "object" && (item.file_size || item.fileSize)) || parsed.parsedFileSize || 0);
      const durationSec = Number((typeof item === "object" && (item.duration_sec || item.duration_seconds || item.duration)) || 0);
      const partSuffix = String(parsed.part || "").toUpperCase();

      const workKey = `${item?.tmdb_id ? `id_${item.tmdb_id}` : normTitle}|${parsed.year || ""}|${parsed.isSeries ? `s_${parsed.season || 1}_${parsed.episode || 1}` : "m"}`;
      // Nur bei identischer Dateigröße + Dauer + Dateiname + Part als exaktes Duplikat filtern (CD2 / -002 wird niemals verworfen!)
      const exactKey = (fileSizeBytes > 0 || durationSec > 0)
        ? `file|${rawFileNameKey}|sz:${fileSizeBytes}|dur:${durationSec}|part:${partSuffix}`
        : `txt|${rawFileNameKey}|${workKey}|${String(parsed.quality || "UNBEKANNT").toUpperCase()}|${String(parsed.codec || "x264").toUpperCase()}|part:${partSuffix}`;

      if (seenExactStreamKeys.has(exactKey)) {
        duplicatesSkippedCount++;
        continue;
      }
      seenExactStreamKeys.add(exactKey);
      if (fileId && !fileId.startsWith("tg_export_")) seenFileIds.add(fileId);

      const isQualityVariant = seenWorkKeys.has(workKey);
      if (isQualityVariant) {
        qualityVariantsCount++;
      } else {
        seenWorkKeys.add(workKey);
        if (parsed.isSeries) detectedSeriesCount++;
        else detectedMoviesCount++;
      }

      const normalizedObj = typeof item === "object" && item !== null
        ? {
            ...item,
            filename: rawStr,
            rawInput: item.rawInput || rawStr,
            cleanTitle: parsed.cleanTitle,
            year: parsed.year,
            isSeries: parsed.isSeries,
            season: parsed.season,
            episode: parsed.episode,
            episodeEnd: item.episodeEnd || parsed.episodeEnd || null,
            episodeTitle: parsed.episodeTitle || item.episodeTitle || "",
            quality: parsed.quality,
            codec: parsed.codec,
            part: parsed.part,
            partInfo: item.partInfo || parsed.partInfo || null,
            editions: item.editions || parsed.editions || [],
            contextOverview: item.contextOverview || item.context_overview || parsed.contextOverview || "",
            neighborEnriched: Boolean(item.neighborEnriched),
            isQualityVariant
          }
        : {
            filename: rawStr,
            rawInput: rawStr,
            cleanTitle: parsed.cleanTitle,
            year: parsed.year,
            isSeries: parsed.isSeries,
            season: parsed.season,
            episode: parsed.episode,
            episodeEnd: parsed.episodeEnd || null,
            episodeTitle: parsed.episodeTitle || "",
            quality: parsed.quality,
            codec: parsed.codec,
            part: parsed.part,
            partInfo: parsed.partInfo || null,
            editions: parsed.editions || [],
            contextOverview: parsed.contextOverview || "",
            isQualityVariant
          };

      entries.push(normalizedObj);
    }

    return {
      entries,
      duplicatesSkippedCount,
      qualityVariantsCount,
      detectedMoviesCount,
      detectedSeriesCount
    };
  }

  function detectAndExtractTelegramBackupOrJson(parsedJson, repairMeta = null) {
    if (!parsedJson) {
      return {
        isTelegramBackup: false,
        backupChatName: "",
        rawMessageCount: 0,
        entries: [],
        groupedSeries: {},
        groupedMovies: [],
        duplicatesSkippedCount: 0,
        qualityVariantsCount: 0,
        detectedMoviesCount: 0,
        detectedSeriesCount: 0,
        repaired: Boolean(repairMeta?.repaired),
        repairNotes: repairMeta?.repairNotes || []
      };
    }

    let tgMessages = null;
    let backupChatName = "";
    let chatMeta = { id: parsedJson?.id || null, username: parsedJson?.username || null };
    if (Array.isArray(parsedJson?.messages)) {
      tgMessages = parsedJson.messages;
      backupChatName = String(parsedJson.name || parsedJson.title || `Chat #${parsedJson.id || "Backup"}`);
    } else if (Array.isArray(parsedJson?.chats?.list)) {
      tgMessages = [];
      for (const ch of parsedJson.chats.list) {
        if (Array.isArray(ch?.messages)) {
          if (!backupChatName && ch.name) backupChatName = ch.name;
          if (!chatMeta.id && ch.id) chatMeta.id = ch.id;
          for (const m of ch.messages) tgMessages.push(m);
        }
      }
      if (!backupChatName) backupChatName = "Telegram Multi-Chat Export";
    }

    if (Array.isArray(tgMessages)) {
      // MODUL 1.1: Streng chronologische Sortierung VOR dem Loop erzwingen + processedMsgIds Set zur Deduplizierung pro Lauf!
      tgMessages.sort((a, b) => Number(a?.id || a?.message_id || 0) - Number(b?.id || b?.message_id || 0));

      const rawCandidates = [];
      const processedMsgIds = new Set();
      let rollingPreContext = {};
      for (let i = 0; i < tgMessages.length; i++) {
        const msg = tgMessages[i];
        if (!msg || (msg.type && msg.type !== "message")) continue;
        const currentMsgId = Number(msg.id || msg.message_id || 0);
        if (currentMsgId > 0) {
          if (processedMsgIds.has(currentMsgId)) continue;
          processedMsgIds.add(currentMsgId);
        }
        // MODUL 1.4: Junk-Filter am Eingang (Sprachlern-Videos & Tutorials als SKIPPED_JUNK protokollieren)
        if (typeof isLanguageCourseOrTutorialJunk === "function" && isLanguageCourseOrTutorialJunk(msg)) {
          const junkText = (typeof extractRawMessageText === "function" ? extractRawMessageText(msg) : "") || flattenTelegramExportText(msg.caption || msg.text || msg.text_entities);
          const junkFile = String(msg.file_name || msg.video?.file_name || msg.document?.file_name || msg.file || "").trim();
          const memKey = "d1_import_diagnostic_logs";
          const existingMem = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];
          memoryFallback.set(memKey, [{
            id: Date.now() * 100 + (i % 100),
            msgId: currentMsgId || "",
            stage: "GATEKEEPER",
            status: "SKIPPED_JUNK",
            reviewReasonCode: null,
            reason: "Sprachlern-/Tutorial-Clip automatisch durch Gatekeeper gefiltert",
            fileName: junkFile,
            textPreview: String(junkText || "").slice(0, 220),
            parsedTitle: "",
            matchedTitle: "",
            season: null,
            episode: null,
            tmdbQuery: "",
            tmdbResult: "SKIPPED_JUNK",
            tmdbId: null,
            typeCode: null,
            details: {},
            timestamp: Date.now()
          }, ...existingMem].slice(0, 2500));
          continue;
        }
        if (isJunkOrSticker(msg)) continue;

        // Untertitel-Bindung (.srt, .vtt, .sub, .ass, .ssa): automatisch an das zugehörige Video (darüber oder via reply_to_message_id) binden!
        const subAtt = extractSubtitleAttachmentFromMsg(msg, chatMeta);
        if (subAtt) {
          let targetVideo = null;
          if (subAtt.reply_to_message_id) {
            targetVideo = rawCandidates.find(c => c && Number(c.msg_id || c.message_id) === Number(subAtt.reply_to_message_id));
          }
          if (!targetVideo && rawCandidates.length > 0) {
            targetVideo = rawCandidates[rawCandidates.length - 1];
          }
          if (targetVideo) {
            if (!Array.isArray(targetVideo.subtitle_files)) targetVideo.subtitle_files = [];
            targetVideo.subtitle_files.push(subAtt);
          }
          continue;
        }

        if (rollingPreContext.lastMessageId && currentMsgId > 0 && Math.abs(currentMsgId - rollingPreContext.lastMessageId) > 25) {
          rollingPreContext = {};
        }

        // 2. EISERNE REGEL ("Video schlägt Header" — Breaking Bad S03E01 Fix):
        // Wenn eine Nachricht eine Videodatei anhängen hat UND gleichzeitig im Text einen Staffel-/Serien-Header (z.B. "Staffel 3", "vorschauserien")
        // trägt, aktualisiere zuerst rollingPreContext, brich aber NIEMALS mit continue ab, sondern verarbeite die Videodatei sofort!
        const rawTextCheck = (typeof extractRawMessageText === "function" ? extractRawMessageText(msg) : "") || flattenTelegramExportText(msg.caption || msg.text || msg.text_entities);
        const entitiesCheck = extractEntitiesFromExportMsg(msg);
        const hasSeriesOrSeasonHeaderInMsg = Boolean(
          /\b(?:Staffel|Season)\s*0*\d{1,2}\b/i.test(rawTextCheck) ||
          entitiesCheck.some(e => e?.url && (e.url.includes("vorschauserien") || /themoviedb\.org\/tv\//i.test(e.url)))
        );
        if (hasSeriesOrSeasonHeaderInMsg) {
          rollingPreContext = extractPreContext(msg, rollingPreContext);
        }

        const prevWindow = Array.isArray(msg._prevMessages)
          ? msg._prevMessages
          : [tgMessages[i - 2], tgMessages[i - 1]].filter(Boolean);
        const itemsFromMsg = extractCandidateRawItemsFromTgMessage(msg, rollingPreContext, prevWindow, chatMeta);
        if (itemsFromMsg.length > 0) {
          for (const rawIt of itemsFromMsg) {
            const it = (!rawIt.isSeries && typeof enrichVideoFromNeighborPost === "function")
              ? (() => {
                  const enriched = enrichVideoFromNeighborPost(tgMessages, i, {
                    ...rawIt,
                    title: rawIt.cleanTitle || rawIt.title || "",
                    part: rawIt.partNumber || rawIt.part || null
                  });
                  const didEnrich = Boolean(enriched && (enriched.contextOverview || enriched.tmdbId || (enriched.title && enriched.title !== rawIt.cleanTitle)));
                  return {
                    ...rawIt,
                    cleanTitle: enriched?.cleanTitle || enriched?.title || rawIt.cleanTitle,
                    year: enriched?.year || rawIt.year || null,
                    tmdb_id: enriched?.tmdbId || rawIt.tmdb_id || null,
                    contextOverview: enriched?.contextOverview || rawIt.contextOverview || "",
                    neighborEnriched: didEnrich
                  };
                })()
              : rawIt;
            rawCandidates.push(it);
            // Fall 16 (IDs 108709-108715): Ein Film-Steckbrief gilt immer nur für das unmittelbar zugehörige Video!
            delete rollingPreContext.tmdbId;
            delete rollingPreContext.imdbId;
            delete rollingPreContext.title;
            delete rollingPreContext.originalTitle;
            if (!rollingPreContext.seriesHeader) {
              delete rollingPreContext.year;
              delete rollingPreContext.mediaType;
            }
            // Fall 10 & Fall 17 (IDs 45807->45808, 131127->131141) + "Episode X Staffel Y von Little Britain":
            // Wenn eine Serien-Videonachricht einen Serientitel etabliert (auch aus Dateiname wie "von Little Britain"),
            // zwingend als seriesHeader für nachfolgende Episoden merken und den alten Kontext überschreiben!
            if (it.isSeries && it.cleanTitle && it.cleanTitle !== "Unbekannt") {
              if (
                it.source_used === "caption_line1" ||
                it.source_used === "caption_line1_3" ||
                it.source_used === "caption_multiline" ||
                it.source_used === "file_name"
              ) {
                if (rollingPreContext.seriesHeader !== it.cleanTitle) {
                  delete rollingPreContext.year;
                }
                rollingPreContext.seriesHeader = it.cleanTitle;
                if (it.season) rollingPreContext.season = it.season;
                rollingPreContext.lastMessageId = Number(it.msg_id || msg.id || 0);
              } else if (rollingPreContext.seriesHeader === it.cleanTitle) {
                rollingPreContext.lastMessageId = Number(it.msg_id || msg.id || 0);
              }
            }
          }
        } else if (!hasSeriesOrSeasonHeaderInMsg) {
          rollingPreContext = extractPreContext(msg, rollingPreContext);
        }
      }

      const classified = deduplicateAndClassifyBackupEntries(rawCandidates);
      const grouped = groupSeriesAndMoviesFromEntries(classified.entries);

      return {
        isTelegramBackup: true,
        backupChatName: backupChatName || "Telegram Chat-Backup",
        rawMessageCount: tgMessages.length,
        entries: classified.entries,
        groupedSeries: grouped.series,
        groupedMovies: grouped.movies,
        duplicatesSkippedCount: classified.duplicatesSkippedCount,
        qualityVariantsCount: classified.qualityVariantsCount,
        detectedMoviesCount: classified.detectedMoviesCount,
        detectedSeriesCount: classified.detectedSeriesCount,
        repaired: Boolean(repairMeta?.repaired),
        repairNotes: repairMeta?.repairNotes || []
      };
    }

    const rawList = Array.isArray(parsedJson)
      ? parsedJson
      : Array.isArray(parsedJson?.items)
        ? parsedJson.items
        : Array.isArray(parsedJson?.titles)
          ? parsedJson.titles
          : Array.isArray(parsedJson?.movies)
            ? parsedJson.movies
            : [parsedJson];

    const classified = deduplicateAndClassifyBackupEntries(rawList);
    const grouped = groupSeriesAndMoviesFromEntries(classified.entries);

    return {
      isTelegramBackup: false,
      backupChatName: String(parsedJson?.playlistName || parsedJson?.name || ""),
      rawMessageCount: rawList.length,
      entries: classified.entries,
      groupedSeries: grouped.series,
      groupedMovies: grouped.movies,
      duplicatesSkippedCount: classified.duplicatesSkippedCount,
      qualityVariantsCount: classified.qualityVariantsCount,
      detectedMoviesCount: classified.detectedMoviesCount,
      detectedSeriesCount: classified.detectedSeriesCount,
      repaired: Boolean(repairMeta?.repaired),
      repairNotes: repairMeta?.repairNotes || []
    };
  }

  function buildVisualProgressBar(processed, total, barWidth = 14) {
    const safeTotal = Math.max(1, Number(total) || 1);
    const safeProc = Math.min(safeTotal, Math.max(0, Number(processed) || 0));
    const ratio = safeProc / safeTotal;
    const pct = (ratio * 100).toFixed(1);
    const filled = Math.round(ratio * barWidth);
    const empty = Math.max(0, barWidth - filled);
    return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${pct}%`;
  }

  async function processEntriesBatchWithLimit(env, entriesList, onProgressStep = null, playlistContext = null) {
    const batchWallStartMs = Date.now();
    // MODUL 1.2: Cloudflare Free-Tier Turbo Subrequest-Guard auf 38 und Zeit-Guard auf 6000ms angehoben!
    const speedProfileObj = typeof getWorkerSpeedProfile === "function"
      ? await getWorkerSpeedProfile(env, playlistContext?.speedProfile || null)
      : { id: "free_turbo", wallClockLimitMs: 6000, subrequestGuard: 38, fallbackMode: "smart_emergency" };
    const BATCH_WALL_CLOCK_LIMIT_MS = Math.max(6000, Number(speedProfileObj.wallClockLimitMs || 6000));
    const SUBREQUEST_GUARD_LIMIT = Math.max(38, Number(speedProfileObj.subrequestGuard || 38));
    resetSubrequestBudget();

    // MODUL 1.1: Sortiere messages/entries vor dem Loop zwingend aufsteigend nach msg.id!
    if (Array.isArray(entriesList) && entriesList.length > 1) {
      const hasMsgIds = entriesList.some(e => e && typeof e === "object" && Number(e.msg_id || e.message_id || e.id || 0) > 0);
      if (hasMsgIds) {
        entriesList.sort((a, b) => Number(a?.msg_id || a?.message_id || a?.id || 0) - Number(b?.msg_id || b?.message_id || b?.id || 0));
      }
    }

    if (typeof prefetchBatchMediaFromD1 === "function") {
      await prefetchBatchMediaFromD1(env, entriesList);
    }
    if (typeof beginD1BatchBuffer === "function") {
      beginD1BatchBuffer();
    }
    const moviesAdded = [];
    const seriesAdded = [];
    const failedItems = [];
    const resolvedObjects = [];
    const batchItems = [];
    const diagLogsToSave = [];
    let duplicatesCount = 0;
    let mergedQualitiesCount = 0;
    let uncertainCount = 0;
    let subrequestPauseCount = 0;
    let partialBatch = false;
    let nextStartIndex = entriesList.length;
    let pauseReason = null;
    const total = entriesList.length;
    const playlistMode = String(playlistContext?.playlistMode || "both");
    const shouldRegisterVipStream = playlistMode === "vip_stream" || playlistMode === "both";
    const intraBatchResolvedMap = new Map();
    const buildIntraBatchTitleKey = (rawObjOrStr) => {
      if (!rawObjOrStr) return "";
      const rawTitle = typeof rawObjOrStr === "string"
        ? rawObjOrStr
        : String(rawObjOrStr.cleanTitle || rawObjOrStr.series_title || rawObjOrStr.title || rawObjOrStr.filename || rawObjOrStr.file_name || "");
      const stripped = rawTitle.replace(/\b(?:S\d{1,2}\s*E\d{1,3}|\d{1,2}x\d{1,3}|Staffel\s*\d+|Season\s*\d+|Folge\s*\d+|Episode\s*\d+)\b.*$/i, "").trim();
      return normalizeTitleForConfidence(stripped || rawTitle);
    };

    const processedMsgIds = playlistContext?.processedMsgIds instanceof Set
      ? playlistContext.processedMsgIds
      : new Set();

    for (let i = 0; i < total; i += JSON_INGEST_CONCURRENCY) {
      // MODUL 1.2: CLOUDFLARE FREE-TIER TURBO GUARD (Subrequest-Guard = 38, Zeit-Guard = 6000ms)
      // WICHTIG: Wenn der Guard auslöst, zähle SUBREQUEST_PAUSE nur in summaryCounts hoch,
      // aber schreibe diesen Eintrag NIEMALS in das entries-Array des Loggers! Gib als nextStartIndex exakt i zurück.
      const elapsedWallMs = Date.now() - batchWallStartMs;
      if ((!hasSubrequestBudget(SUBREQUEST_GUARD_LIMIT) || elapsedWallMs >= BATCH_WALL_CLOCK_LIMIT_MS) && i > 0) {
        partialBatch = true;
        nextStartIndex = i;
        subrequestPauseCount++;
        pauseReason = elapsedWallMs >= BATCH_WALL_CLOCK_LIMIT_MS ? "TIME_LIMIT_GUARD" : "SUBREQUEST_LIMIT_GUARD";
        break;
      }

      const batch = entriesList.slice(i, i + JSON_INGEST_CONCURRENCY);
      const batchResults = [];
      let abortedMidBatchDueToBudget = false;
      let abortBatchIndex = i;

      // MODUL 1.1 & 6.3: Streng sequenzielle Abarbeitung + Variablen-Hygiene (tmdbId, matchedTitle, parsedItem strikt lokal im Loop!)
      for (let bStep = 0; bStep < batch.length; bStep++) {
        let tmdbId = null;
        let matchedTitle = null;
        let parsedItem = null;
        const stepElapsedWallMs = Date.now() - batchWallStartMs;
        if ((!hasSubrequestBudget(SUBREQUEST_GUARD_LIMIT) || stepElapsedWallMs >= BATCH_WALL_CLOCK_LIMIT_MS) && (i + bStep) > 0) {
          abortedMidBatchDueToBudget = true;
          abortBatchIndex = i + bStep;
          break;
        }
        if (typeof subrequestBudgetExhausted !== "undefined") {
          subrequestBudgetExhausted = false;
        }
        let entry = batch[bStep];
        const entryMsgIdNum = Number(entry?.msg_id || entry?.message_id || entry?.messageId || entry?.id || 0);
        if (entryMsgIdNum > 0) {
          // MODUL 1.1: Ist msg.id schon in processedMsgIds, überspringe die Nachricht sofort (ohne Logging!), um 3-fache Durchläufe bei Resumes zu verhindern.
          if (processedMsgIds.has(entryMsgIdNum)) {
            batchResults.push({ _skippedAlreadyProcessedMsgId: true, msgId: entryMsgIdNum });
            continue;
          }
        }
        const entryNormKey = buildIntraBatchTitleKey(entry);
        const isEntrySeriesHint = typeof entry === "object" && entry !== null && Boolean(
          entry.isSeries || entry.typeCode === "s" || entry.type === "series" || entry.season !== null && entry.season !== undefined || entry.episode ||
          /\b(?:S\d{1,2}\s*E\d{1,3}|\d{1,2}x\d{1,3}|Staffel\s*\d+|Folge\s*\d+)\b/i.test(String(entry.filename || entry.file_name || entry.cleanTitle || ""))
        );
        // MODUL 5.1: Nachbar-Pairing für Multi-Part-Filme (CD2 übernimmt direkt die tmdbId von CD1 bei gleichem Basis-Titel!)
        const entryPartNum = Number(entry?.partNumber || entry?.partInfo?.partNumber || (String(entry?.part || "").match(/(\d+)/)?.[1]) || 1) || 1;
        if (typeof entry === "object" && entry !== null && !entry.tmdb_id && !entry.tmdbId && entryNormKey && entryNormKey !== "unbekannt") {
          const inherited = intraBatchResolvedMap.get((isEntrySeriesHint ? "s::" : "m::") + entryNormKey)
            || (isEntrySeriesHint ? intraBatchResolvedMap.get("any::" + entryNormKey) : null)
            || (entryPartNum > 1 ? intraBatchResolvedMap.get("m::" + entryNormKey) : null);
          if (inherited && inherited.tmdbId) {
            entry = {
              ...entry,
              tmdb_id: inherited.tmdbId,
              typeCode: inherited.typeCode,
              isSeries: inherited.typeCode === "s",
              cleanTitle: inherited.cleanTitle || entry.cleanTitle,
              external_poster_url: entry.external_poster_url || inherited.poster || ""
            };
            batch[bStep] = entry;
          }
        }
        const entryFileMeta = (typeof entry === "object" && entry?.telegram_file_id)
          ? { fileId: entry.telegram_file_id, fileUniqueId: entry.telegram_unique_id || null, fileSize: entry.file_size || null, mimeType: entry.mime_type || "video/mp4" }
          : null;
        let stepRes = null;
        try {
          stepRes = await resolveAndIngestMediaEntry(env, entry, entryFileMeta, {
            returnUnmatched: true,
            registerAsVipStream: shouldRegisterVipStream,
            speedProfile: speedProfileObj.id,
            fallbackMode: speedProfileObj.fallbackMode,
            isBatchImport: true
          });
        } catch (itemErr) {
          const fallbackRaw = typeof entry === "string"
            ? entry
            : String(entry?.filename || entry?.file_name || entry?.rawInput || entry?.title || "");
          const fallbackRawText = (typeof extractRawMessageText === "function" ? extractRawMessageText(entry) : "") || String(entry?.raw_text || entry?.rawText || "");
          parsedItem = parseMediaFilename(fallbackRaw, fallbackRawText);
          stepRes = {
            ok: false,
            unmatched: true,
            ingestStatus: "failed",
            confidence: 0,
            rawInput: fallbackRaw,
            parsed: parsedItem,
            candidates: [],
            error: String(itemErr?.message || itemErr || "Unbekannter Fehler")
          };
        }
        if (
          (!stepRes || stepRes.unmatched) &&
          !stepRes?.fromNegativeCache &&
          (stepRes?.abortedDueToSubrequestBudget || (typeof subrequestBudgetExhausted !== "undefined" && subrequestBudgetExhausted) || !hasSubrequestBudget(SUBREQUEST_GUARD_LIMIT)) &&
          (i + bStep) > 0
        ) {
          abortedMidBatchDueToBudget = true;
          abortBatchIndex = i + bStep;
          break;
        }
        if (entryMsgIdNum > 0) {
          processedMsgIds.add(entryMsgIdNum);
        }
        if (stepRes && stepRes.ok && stepRes.tmdbId) {
          tmdbId = Number(stepRes.tmdbId);
          matchedTitle = String(stepRes.matchedTitle || stepRes.cleanTitle || "");
        }
        if (stepRes && stepRes.ok && tmdbId && !stepRes.contextError && Number(stepRes.confidence || 100) >= 80) {
          const resolvedMeta = {
            tmdbId,
            typeCode: stepRes.typeCode === "s" ? "s" : "m",
            cleanTitle: matchedTitle,
            poster: stepRes.poster || ""
          };
          if (entryNormKey && entryNormKey !== "unbekannt") {
            intraBatchResolvedMap.set(resolvedMeta.typeCode + "::" + entryNormKey, resolvedMeta);
            if (resolvedMeta.typeCode === "s") intraBatchResolvedMap.set("any::" + entryNormKey, resolvedMeta);
          }
          const resNormKey = buildIntraBatchTitleKey(matchedTitle);
          if (resNormKey && resNormKey !== "unbekannt") {
            intraBatchResolvedMap.set(resolvedMeta.typeCode + "::" + resNormKey, resolvedMeta);
            if (resolvedMeta.typeCode === "s") intraBatchResolvedMap.set("any::" + resNormKey, resolvedMeta);
          }
        }
        batchResults.push(stepRes);
      }

      for (let bIdx = 0; bIdx < batchResults.length; bIdx++) {
        const res = batchResults[bIdx];
        if (res && res._skippedAlreadyProcessedMsgId) continue;
        const rawEntry = batch[bIdx];
        const rawLabel = typeof rawEntry === "string"
          ? rawEntry
          : (rawEntry?.rawInput || rawEntry?.filename || rawEntry?.title || `#${i + bIdx + 1}`);

        const normMsgId = typeof rawEntry === "object" && rawEntry !== null
          ? (Number(rawEntry.msg_id || rawEntry.message_id || rawEntry.messageId || 0) || null)
          : null;
        const unifiedRawText = typeof rawEntry === "object" && rawEntry !== null
          ? ((typeof extractRawMessageText === "function" ? extractRawMessageText(rawEntry) : "") || String(rawEntry.raw_text || rawEntry.rawText || rawEntry.caption || rawEntry.text || ""))
          : "";
        const contextDiagnostics = typeof rawEntry === "object" && rawEntry !== null ? {
          msgId: normMsgId,
          messageId: normMsgId,
          messageLink: rawEntry.message_link || rawEntry.messageLink || "",
          rawFileName: rawEntry.raw_file_name || rawEntry.file_name || "",
          rawText: unifiedRawText,
          sourceUsed: res?.sourceUsed || rawEntry.source_used || "file_name",
          languages: res?.languages || rawEntry.languages || ["de"],
          prevMessages: Array.isArray(rawEntry.prev_messages || rawEntry.prevMessages) ? (rawEntry.prev_messages || rawEntry.prevMessages) : []
        } : {
          msgId: null,
          messageId: null,
          messageLink: "",
          rawFileName: String(rawLabel),
          rawText: "",
          sourceUsed: "file_name",
          languages: ["de"],
          prevMessages: []
        };

        if (!res || res.unmatched) {
          failedItems.push(String(rawLabel).slice(0, 45));
          const failReasonCode = res?.error ? "API_ERROR" : (res?.reviewReasonCode || "TMDB_NOT_FOUND");
          const cleanedQueryTitle = res?.parsed?.cleanTitle || rawEntry?.cleanTitle || String(rawLabel);
          const failReasonText = res?.error || `Kein passender TMDb-Eintrag für "${cleanedQueryTitle}" gefunden – bitte manuell suchen oder TMDb-ID zuweisen.`;
          // MODUL 6.3: Variablen-Leck im Logger schließen! Bei TMDB_NOT_FOUND oder API_ERROR müssen matchedTitle und tmdbId zwingend null sein!
          const failItemObj = {
            rawInput: String(rawLabel),
            rawEntry: typeof rawEntry === "object" ? rawEntry : { filename: String(rawLabel) },
            status: "failed",
            contextError: true,
            reviewReasonCode: failReasonCode,
            errorReason: failReasonText,
            reason: failReasonText,
            isUncertain: true,
            confidence: res?.confidence || 0,
            typeCode: res?.parsed?.isSeries ? "s" : "m",
            tmdbId: null,
            cleanTitle: cleanedQueryTitle,
            parsedTitle: cleanedQueryTitle,
            matchedTitle: null,
            year: res?.parsed?.year || "k.A.",
            poster: "",
            quality: res?.parsed?.quality || null,
            codec: res?.parsed?.codec || "x264",
            part: res?.parsed?.part || null,
            season: res?.parsed?.season ?? null,
            episode: res?.parsed?.episode ?? null,
            metadataSource: "Keine",
            ...contextDiagnostics,
            candidates: res?.candidates || []
          };
          batchItems.push(failItemObj);
          diagLogsToSave.push({
            msgId: contextDiagnostics.msgId ?? "",
            stage: "TMDB_LOOKUP",
            status: res?.error ? "API_ERROR" : "TMDB_NOT_FOUND",
            reviewReasonCode: failReasonCode,
            reason: res?.error || `Kein TMDb-Treffer für "${cleanedQueryTitle}"`,
            fileName: contextDiagnostics.rawFileName || String(rawLabel),
            textPreview: String(contextDiagnostics.rawText || "").slice(0, 220),
            parsedTitle: cleanedQueryTitle,
            matchedTitle: null,
            season: res?.parsed?.season ?? null,
            episode: res?.parsed?.episode ?? null,
            tmdbQuery: `${cleanedQueryTitle}${res?.parsed?.year ? ` (${res.parsed.year})` : ""}`,
            tmdbResult: "Kein Treffer",
            tmdbId: null,
            typeCode: res?.parsed?.isSeries ? "s" : "m",
            details: { reviewReasonCode: failReasonCode, matchedTitle: null, rawEntry: failItemObj.rawEntry, candidates: (res?.candidates || []).slice(0, 5) }
          });
        } else {
          resolvedObjects.push(res);
          if (res.ingestStatus === "duplicate") duplicatesCount++;
          else if (res.ingestStatus === "merged_quality") mergedQualitiesCount++;
          if (res.isUncertain || res.contextError) uncertainCount++;

          const qualLabel = res.quality ? `${res.quality} ` : "";
          if (res.typeCode === "s") {
            const sCode = `S${String(res.season ?? 1).padStart(2, "0")}E${String(res.episode || 1).padStart(2, "0")}`;
            seriesAdded.push(`${res.cleanTitle} (${sCode} • ${qualLabel}${res.codec})`);
          } else {
            moviesAdded.push(`${res.cleanTitle} (${qualLabel}${res.codec}${res.part ? ` ${res.part}` : ""})`);
          }

          const parserQueryTitle = res.parsedTitle || rawEntry?.cleanTitle || res.cleanTitle;
          const resolvedMatchedTitle = res.matchedTitle || res.cleanTitle;
          const resolvedReasonCode = res.reviewReasonCode || (
            res.contextError || res.isUncertain ? "PARSER_AMBIGUITY" : null
          );
          const resolvedReviewReason = res.errorReason || (
            res.isUncertain
              ? `Niedrige Treffer-Sicherheit (${Number(res.confidence || 0)}% Match): "${parserQueryTitle}" wurde vorläufig "${resolvedMatchedTitle}" (${res.year || "k.A."}) zugeordnet.`
              : null
          );
          const okItemObj = {
            rawInput: String(rawLabel),
            rawEntry: typeof rawEntry === "object" ? rawEntry : { filename: String(rawLabel) },
            status: res.contextError ? "CONFLICT" : (res.isUncertain ? "uncertain" : (res.ingestStatus || "added")),
            contextError: Boolean(res.contextError),
            reviewReasonCode: resolvedReasonCode,
            errorReason: resolvedReviewReason,
            reason: resolvedReviewReason,
            ingestStatus: res.ingestStatus || "added",
            isUncertain: Boolean(res.isUncertain || res.contextError),
            confidence: Number(res.confidence || 100),
            typeCode: res.typeCode,
            tmdbId: res.tmdbId,
            cleanTitle: res.cleanTitle,
            parsedTitle: parserQueryTitle,
            matchedTitle: resolvedMatchedTitle,
            year: res.year || "k.A.",
            poster: res.poster || "",
            quality: res.quality || null,
            codec: res.codec || "x264",
            part: res.part || null,
            season: res.season ?? null,
            episode: res.episode ?? null,
            episodeTitle: res.episodeTitle || null,
            versionInfo: res.versionInfo || null,
            versionLabel: res.versionLabel || null,
            metadataSource: res.metadataSource || "TMDb",
            ...contextDiagnostics,
            candidates: res.candidates || []
          };
          batchItems.push(okItemObj);

          const diagStatus = res.contextError
            ? "CONFLICT"
            : (res.ingestStatus === "skipped_prerelease" ? "SKIPPED_PRERELEASE" : (res.ingestStatus === "duplicate" ? "SKIPPED_DUPLICATE" : "OK"));
          const sEpBadge = res.typeCode === "s"
            ? ` S${String(res.season ?? 1).padStart(2, "0")}E${String(res.episode || 1).padStart(2, "0")}`
            : "";
          const replacedNote = res.ingestStatus === "replaced_prerelease"
            ? " [⚠️ Alte Vorabversion/TS/MD automatisch gelöscht & ersetzt!]"
            : (res.ingestStatus === "updated" ? " [🔄 Bestehender Episoden-/Film-Slot per UPSERT aktualisiert]" : "");
          const boundSubsCount = Array.isArray(rawEntry?.subtitle_files || rawEntry?.subtitles) ? (rawEntry.subtitle_files || rawEntry.subtitles).length : 0;
          const subsNote = boundSubsCount > 0 ? ` [💬 +${boundSubsCount} Untertitel gebunden]` : "";
          diagLogsToSave.push({
            msgId: contextDiagnostics.msgId ?? "",
            stage: "SAVED_D1",
            status: diagStatus,
            reviewReasonCode: resolvedReasonCode,
            reason: resolvedReviewReason || (
              res.ingestStatus === "skipped_prerelease"
                ? "Vorabversion / TS / MD übersprungen (reguläre Version bereits in D1 vorhanden)"
                : res.ingestStatus === "duplicate"
                  ? "Exaktes Stream-Duplikat (identischer fileFingerprint & Part) bereits in D1"
                  : `Gespeichert via ${res.metadataSource || "TMDb"} (${res.confidence || 100}%)${replacedNote}${subsNote}`
            ),
            fileName: contextDiagnostics.rawFileName || String(rawLabel),
            textPreview: String(contextDiagnostics.rawText || "").slice(0, 220),
            parsedTitle: parserQueryTitle,
            matchedTitle: resolvedMatchedTitle,
            season: res.season ?? null,
            episode: res.episode ?? null,
            tmdbQuery: parserQueryTitle,
            tmdbResult: `${resolvedMatchedTitle} (${res.year || "k.A."})${sEpBadge} [TMDb #${res.tmdbId}]`,
            tmdbId: res.tmdbId,
            typeCode: res.typeCode,
            details: { reviewReasonCode: resolvedReasonCode, matchedTitle: resolvedMatchedTitle, rawEntry: okItemObj.rawEntry, candidates: (res.candidates || []).slice(0, 5) }
          });
        }
      }

      if (abortedMidBatchDueToBudget) {
        partialBatch = true;
        nextStartIndex = abortBatchIndex;
        subrequestPauseCount++;
        pauseReason = "SUBREQUEST_LIMIT_GUARD";
        // MODUL 1.2: SUBREQUEST_PAUSE NIEMALS in diagLogsToSave / entries pushen!
        break;
      }

      const currentDone = Math.min(total, i + batchResults.length);
      if (typeof onProgressStep === "function") {
        try {
          await onProgressStep(currentDone, total, moviesAdded.length, seriesAdded.length, failedItems.length, duplicatesCount, mergedQualitiesCount, uncertainCount);
        } catch (e) {}
      }

      if (i + JSON_INGEST_CONCURRENCY < total && currentInvocationSubrequests > 2) {
        await new Promise(r => setTimeout(r, JSON_INGEST_DELAY_MS));
      }
    }

    if (diagLogsToSave.length > 0) {
      await saveImportDiagnosticLogsToD1(env, diagLogsToSave);
    }

    let playlistSavedCount = 0;
    if (playlistContext && playlistContext.chatId && playlistContext.folderId && resolvedObjects.length > 0) {
      try {
        if (playlistMode === "watchlist" || playlistMode === "both" || String(playlistContext.chatId) === "bot_vip") {
          playlistSavedCount = await batchSaveIngestedItemsToPlaylist(
            env,
            playlistContext.chatId,
            playlistContext.folderId,
            resolvedObjects,
            { playlistMode, deferKvWrite: true }
          );
        }
        // Wenn als VIP-Stream oder Beides gewählt, zusätzlich in der globalen Bot-VIP-Playlist ("bot_vip") in D1 synchronisieren (0 KV-Writes!)
        if (shouldRegisterVipStream && String(playlistContext.chatId) !== "bot_vip") {
          const botVipFolder = await createOrGetJsonPlaylistFolder(
            env,
            "bot_vip",
            playlistContext.playlistName || "🌟 Bot-VIP-Playlist",
            playlistContext.sourceLabel || "VIP-Import",
            "vip_stream"
          );
          const syncedCount = await batchSaveIngestedItemsToPlaylist(
            env,
            "bot_vip",
            botVipFolder.id,
            resolvedObjects,
            { playlistMode: "vip_stream", deferKvWrite: true }
          );
          if (!playlistSavedCount) playlistSavedCount = syncedCount;
        }
      } catch (plErr) {
        console.error("[Import Batch Playlist Sync Warning]:", plErr);
      }
    }

    // Automatische DB-Bereinigung nur am Ende des gesamten Imports (oder bei Einzel-Läufen): Entfernt Serien mit 0 gültigen Episoden-Videos
    if (!partialBatch && (!playlistContext || playlistContext.isFinalBatch !== false)) {
      await cleanupEmptySeriesInD1AndMemory(env).catch(() => null);
    }

    // Alle gepufferten D1-Writes des gesamten Batches in einer einzigen db.batch()-Transaktion committen (nur 1 D1-Subrequest!)
    if (typeof flushD1BatchBuffer === "function") {
      await flushD1BatchBuffer(env);
    }

    return {
      status: partialBatch ? "PARTIAL_BATCH" : "COMPLETED",
      partialBatch,
      nextStartIndex: partialBatch ? nextStartIndex : total,
      pauseReason,
      subrequestPauseCount,
      subrequestCount: currentInvocationSubrequests,
      moviesAdded,
      seriesAdded,
      failedItems,
      resolvedObjects,
      playlistSavedCount,
      duplicatesCount,
      mergedQualitiesCount,
      uncertainCount,
      batchItems
    };
  }

  async function processNextD1QueueStepAndEditMessage(env, chatId, messageId, rounds = 1) {
    const { sendMessage, editMessageText } = tgApi(env);
    const safeRounds = Math.min(Math.max(1, Number(rounds) || 1), 3);
    const batchPerRound = 12;

    for (let r = 0; r < safeRounds; r++) {
      const pendingBatch = await fetchPendingImportBatchFromD1(env, batchPerRound);
      if (pendingBatch.length === 0) break;

      const firstEntryMeta = pendingBatch[0]?.entry?._playlistMeta || null;
      const meta = memoryFallback.get("import_queue_meta") || {
        sourceLabel: pendingBatch[0]?.sourceLabel || "Backup",
        initialTotal: pendingBatch.length,
        processedCount: 0,
        moviesSaved: 0,
        seriesSaved: 0,
        failedCount: 0,
        duplicatesCount: 0,
        mergedQualitiesCount: 0,
        uncertainCount: 0,
        targetChatId: firstEntryMeta?.chatId || chatId,
        playlistFolderId: firstEntryMeta?.folderId || null,
        playlistName: firstEntryMeta?.playlistName || null
      };

      const rawEntries = pendingBatch.map(b => b.entry);
      const plCtx = (meta.targetChatId && meta.playlistFolderId)
        ? { chatId: meta.targetChatId, folderId: meta.playlistFolderId, playlistName: meta.playlistName }
        : (firstEntryMeta?.chatId && firstEntryMeta?.folderId ? firstEntryMeta : null);

      const { moviesAdded, seriesAdded, failedItems, duplicatesCount, mergedQualitiesCount, uncertainCount } = await processEntriesBatchWithLimit(env, rawEntries, null, plCtx);
      await deleteImportQueueIdsFromD1(env, pendingBatch.map(b => b.id));

      meta.processedCount = Number(meta.processedCount || 0) + pendingBatch.length;
      meta.moviesSaved = Number(meta.moviesSaved || 0) + moviesAdded.length;
      meta.seriesSaved = Number(meta.seriesSaved || 0) + seriesAdded.length;
      meta.failedCount = Number(meta.failedCount || 0) + failedItems.length;
      meta.duplicatesCount = Number(meta.duplicatesCount || 0) + Number(duplicatesCount || 0);
      meta.mergedQualitiesCount = Number(meta.mergedQualitiesCount || 0) + Number(mergedQualitiesCount || 0);
      meta.uncertainCount = Number(meta.uncertainCount || 0) + Number(uncertainCount || 0);
      memoryFallback.set("import_queue_meta", meta);
    }

    const stats = await getImportQueueStatsFromD1(env);
    const metaInfo = memoryFallback.get("import_queue_meta") || {};
    const totalAll = Math.max(1, stats.processedCount + stats.pendingCount);
    const bar = buildVisualProgressBar(stats.processedCount, totalAll, 14);
    const isFinished = stats.pendingCount === 0;

    let plFolderObj = null;
    if (metaInfo.playlistFolderId) {
      const folders = await getFolders(env, metaInfo.targetChatId || chatId);
      plFolderObj = folders.find(f => f.id === metaInfo.playlistFolderId) || null;
    }

    const playlistLine = plFolderObj
      ? `🎵 *Merklisten-Playlist:* \`${escapeMd(plFolderObj.name)}\` (${plFolderObj.enabled !== false ? "🟢 Eingeschaltet" : "⚪ Ausgeschaltet"})\n`
      : "";

    const statusText =
      `${isFinished ? "✅ *SMART BACKUP- / JSON-IMPORT ABGESCHLOSSEN*" : "⏳ *SMART BACKUP- / JSON-IMPORT FORTSCHRITT*"}\n` +
      `${SEP}\n` +
      `📂 *Quelle:* \`${escapeMd(stats.sourceLabel || "JSON-Datei")}\`\n` +
      playlistLine +
      `📊 *Fortschritt:* \`${bar}\`\n` +
      `🔢 *Verarbeitet:* \`${stats.processedCount} / ${totalAll}\` (Noch offen: \`${stats.pendingCount}\`)\n` +
      `${SEP}\n` +
      `🎬 *Filme in D1:* \`${stats.moviesSaved}\`\n` +
      `📺 *Serien/Episoden in D1:* \`${stats.seriesSaved}\`\n` +
      `♻️ *Qualitäten zusammengeführt / Duplikate:* \`${Number(metaInfo.mergedQualitiesCount || 0) + Number(metaInfo.duplicatesCount || 0)}\`\n` +
      `⚠️ *Unsicher / Nicht erkannt:* \`${Number(metaInfo.uncertainCount || 0)} / ${stats.failedCount}\`` +
      (!isFinished ? `\n\n💡 _Tippe unten auf „Nächsten Batch“ oder nutze im TMA Admin-Panel den Smart-Importer inkl. Korrektur-Tab._` : "");

    const inline_keyboard = [];
    if (!isFinished) {
      inline_keyboard.push([
        { text: `▶️ Nächsten Batch (+12)`, callback_data: "impq_step_1" },
        { text: `⚡ Turbo-Batch (+36)`, callback_data: "impq_step_3" }
      ]);
      inline_keyboard.push([
        { text: "🗑️ Warteschlange leeren", callback_data: "impq_clear" }
      ]);
    }
    if (plFolderObj) {
      inline_keyboard.push([
        { text: `📂 Playlist "${plFolderObj.name.slice(0, 18)}"`, callback_data: `wl_open_${plFolderObj.id}` },
        { text: plFolderObj.enabled !== false ? "🟢 Aktiv (Ausschalten)" : "⚪ Aus (Einschalten)", callback_data: `pltog_${plFolderObj.id}` }
      ]);
      inline_keyboard.push([
        { text: "✏️ Playlist umbenennen", callback_data: `plren_${plFolderObj.id}` },
        { text: "🗑️ Playlist löschen", callback_data: `pldel_${plFolderObj.id}` }
      ]);
    }
    inline_keyboard.push(buildFooterRow(chatId, true));

    if (messageId) {
      await editMessageText(chatId, messageId, statusText, { reply_markup: { inline_keyboard } });
    } else {
      await sendMessage(chatId, statusText, { reply_markup: { inline_keyboard } });
    }
  }

  // --- Verarbeitet eingehende Videodateien & .json Titel-Listen / Telegram Chat-Backups beim Bot ---
  async function handleIncomingMediaOrJson(env, message) {
    const { sendMessage, editMessageText, getFileText } = tgApi(env);
    const chatId = message.chat.id;
    const videoObj = message.video || (message.document && /^video\//i.test(message.document.mime_type || "") ? message.document : null);
    const docObj = message.document;

    // A) Eingehende .json Datei (Telegram Chat-Backup result.json ODER Titelliste) erkennen & mit Auto-Repair + Live-Progress + Custom Playlist verarbeiten
    if (docObj && (String(docObj.file_name || "").toLowerCase().endsWith(".json") || docObj.mime_type === "application/json")) {
      const fileSizeBytes = Number(docObj.file_size || 0);
      if (fileSizeBytes > 20 * 1024 * 1024) {
        await sendMessage(
          chatId,
          `⚠️ *DATEI ZU GROSS FÜR TELEGRAM BOT-DOWNLOAD (> 20 MB)*\n${SEP}\n` +
          `Deine Datei \`${escapeMd(docObj.file_name || "result.json")}\` ist *${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB* groß.\n\n` +
          `📌 *Telegram Bot-API Limit:* Bots dürfen über Telegram maximal *20 MB* direkt herunterladen.\n` +
          `🚀 *Lösung für 100.000+ Einträge (bis 500 MB+):*\n` +
          `Öffne die **StreamFlix Mini-App ▸ 👑 Admin ▸ 📦 Backup-Import (100k+)**. Dort werden Formatfehler automatisch repariert, Duplikate gefiltert und unsichere Treffer im **Korrektur-Tab** angezeigt!`,
          { reply_markup: { inline_keyboard: [buildFooterRow(chatId, true)] } }
        );
        return true;
      }

      const statusMsg = await sendMessage(
        chatId,
        `📥 *SMART JSON / BACKUP-ANALYSE GESTARTET*\n${SEP}\n⏳ Lade & prüfe \`${escapeMd(docObj.file_name || "result.json")}\` (inkl. Auto-Repair & Duplikat-Filter)...`
      );
      const statusMsgId = statusMsg?.result?.message_id || null;

      const rawJsonText = await getFileText(docObj.file_id);
      if (!rawJsonText) {
        if (statusMsgId) {
          await editMessageText(
            chatId,
            statusMsgId,
            `⚠️ *JSON-Datei konnte nicht von Telegram geladen werden (Telegram Bot-API Limit: max. 20 MB).* Nutze für größere Backups den Smart-Importer im TMA Admin-Panel.`
          );
        }
        return true;
      }

      const repairRes = repairAndParseBackupJson(rawJsonText);
      if (!repairRes.ok || !repairRes.parsed) {
        if (statusMsgId) {
          await editMessageText(
            chatId,
            statusMsgId,
            `⚠️ *JSON-Datei konnte auch nach Auto-Repair nicht gelesen werden:* \`${escapeMd((repairRes.repairNotes || [])[0] || "Unbekanntes Format")}\``
          );
        }
        return true;
      }
      const parsedJson = repairRes.parsed;
      const detected = detectAndExtractTelegramBackupOrJson(parsedJson, repairRes);
      const rawList = detected.entries || [];
      const totalExtracted = rawList.length;
      const sourceLabel = detected.isTelegramBackup
        ? `Telegram Chat-Backup: ${detected.backupChatName} (${detected.rawMessageCount} Msgs)`
        : (docObj.file_name || "JSON-Titelliste");

      if (totalExtracted === 0) {
        if (statusMsgId) {
          await editMessageText(
            chatId,
            statusMsgId,
            `ℹ️ *Analyse abgeschlossen:*\n` +
            `Typ: *${detected.isTelegramBackup ? `📦 Telegram Chat-Backup (${escapeMd(detected.backupChatName)})` : "📄 Standard-JSON"}*\n` +
            (detected.repaired ? `🛠️ *Auto-Repair:* \`${escapeMd(detected.repairNotes.join(", "))}\`\n` : "") +
            `Es wurden keine neuen Film- oder Serien-Dateinamen in den \`${detected.rawMessageCount}\` Einträgen gefunden.`,
            { reply_markup: { inline_keyboard: [buildFooterRow(chatId, true)] } }
          );
        }
        return true;
      }

      // Custom Playlist für diesen JSON-Import in der Merkliste anlegen (Caption als Custom Name oder sauberer Backup-/Dateiname)
      const cleanFileBase = String(docObj.file_name || "Import").replace(/\.json$/i, "").trim();
      const defaultPlaylistName = detected.isTelegramBackup
        ? `📦 ${detected.backupChatName}`
        : (parsedJson?.playlistName || parsedJson?.name || `🎵 ${cleanFileBase}`);
      const customPlaylistName = String(message.caption || defaultPlaylistName).trim().slice(0, 48);
      const playlistFolder = await createOrGetJsonPlaylistFolder(env, chatId, customPlaylistName, sourceLabel);
      await flushUserSession(env, chatId);

      const immediateSlice = rawList.slice(0, MAX_JSON_INGEST_LIMIT);
      const remainingSlice = rawList.slice(MAX_JSON_INGEST_LIMIT);

      if (statusMsgId) {
        const initBar = buildVisualProgressBar(0, totalExtracted, 14);
        await editMessageText(
          chatId,
          statusMsgId,
          `🔎 *${detected.isTelegramBackup ? "📦 TELEGRAM CHAT-BACKUP ERKANNT" : "📄 JSON-TITELLISTE ERKANNT"}*\n` +
          `${SEP}\n` +
          (detected.repaired ? `🛠️ *JSON Auto-Repair aktiv:* \`${escapeMd(detected.repairNotes.join(" • "))}\`\n` : "") +
          `🎵 *Custom Playlist erstellt:* \`${escapeMd(playlistFolder.name)}\`\n` +
          (detected.isTelegramBackup ? `💬 *Chat:* \`${escapeMd(detected.backupChatName)}\` (\`${detected.rawMessageCount}\` Nachrichten)\n` : "") +
          `🎬 *Erkannte Filme:* \`${detected.detectedMoviesCount}\` • 📺 *Serien:* \`${detected.detectedSeriesCount}\`\n` +
          `♻️ *Gefilterte Duplikate:* \`${detected.duplicatesSkippedCount}\` • *Qualitäts-Varianten:* \`${detected.qualityVariantsCount}\`\n` +
          `📊 *Fortschritt:* \`${initBar}\`\n` +
          `⏳ _Verarbeite ersten Batch (${immediateSlice.length} Titel)..._`
        );
      }

      let lastEditTime = Date.now();
      const { moviesAdded, seriesAdded, failedItems, duplicatesCount, mergedQualitiesCount, uncertainCount } = await processEntriesBatchWithLimit(
        env,
        immediateSlice,
        async (doneInBatch, totalInBatch, mCnt, sCnt, fCnt, dupCnt, mrgCnt, uncCnt) => {
          if (!statusMsgId) return;
          if (Date.now() - lastEditTime < 1400 && doneInBatch < totalInBatch) return;
          lastEditTime = Date.now();
          const bar = buildVisualProgressBar(doneInBatch, totalExtracted, 14);
          await editMessageText(
            chatId,
            statusMsgId,
            `⏳ *${detected.isTelegramBackup ? "📦 TELEGRAM BACKUP WIRD VERARBEITET" : "📥 SMART JSON-IMPORT LÄUFT"}*\n` +
            `${SEP}\n` +
            `🎵 *Playlist:* \`${escapeMd(playlistFolder.name)}\`\n` +
            `📊 \`${bar}\`\n` +
            `🔢 *Status:* \`${doneInBatch} / ${totalExtracted}\` analysiert\n` +
            `🎬 *Filme:* \`${mCnt}\` • 📺 *Serien:* \`${sCnt}\` • ♻️ *Merge/Dup:* \`${(dupCnt || 0) + (mrgCnt || 0)}\` • ⚠️ *Unsicher/Fehler:* \`${(uncCnt || 0) + fCnt}\``
          );
        },
        { chatId, folderId: playlistFolder.id, playlistName: playlistFolder.name }
      );

      if (remainingSlice.length > 0) {
        memoryFallback.set("import_queue_meta", {
          sourceLabel,
          initialTotal: totalExtracted,
          processedCount: immediateSlice.length,
          moviesSaved: moviesAdded.length,
          seriesSaved: seriesAdded.length,
          failedCount: failedItems.length,
          duplicatesCount: Number(duplicatesCount || 0) + Number(detected.duplicatesSkippedCount || 0),
          mergedQualitiesCount: Number(mergedQualitiesCount || 0),
          uncertainCount: Number(uncertainCount || 0),
          targetChatId: chatId,
          playlistFolderId: playlistFolder.id,
          playlistName: playlistFolder.name
        });
        const remainingWithPlaylist = remainingSlice.map(item =>
          typeof item === "object" && item !== null
            ? { ...item, _playlistMeta: { chatId, folderId: playlistFolder.id, playlistName: playlistFolder.name } }
            : { title: String(item), _playlistMeta: { chatId, folderId: playlistFolder.id, playlistName: playlistFolder.name } }
        );
        await enqueueImportEntriesInD1(env, remainingWithPlaylist, sourceLabel);
      }

      const finalBar = buildVisualProgressBar(immediateSlice.length, totalExtracted, 14);
      const queueHint = remainingSlice.length > 0
        ? `\n\n📦 *Warteschlange (D1 Queue) aktiv:*\nNoch \`${remainingSlice.length}\` weitere Einträge warten in der Queue und werden beim Fortsetzen automatisch in deine Playlist \`${escapeMd(playlistFolder.name)}\` einsortiert.`
        : "";

      const summaryText =
        `${remainingSlice.length > 0 ? "⏸️ *ERSTER BATCH ABGESCHLOSSEN – QUEUE BEREIT*" : "✅ *SMART JSON-IMPORT & CUSTOM PLAYLIST BEREIT*"}\n` +
        `${SEP}\n` +
        (detected.repaired ? `🛠️ *Auto-Repair:* \`${escapeMd(detected.repairNotes.join(" • "))}\`\n` : "") +
        `🎵 *Merklisten-Playlist:* \`${escapeMd(playlistFolder.name)}\` (${playlistFolder.enabled !== false ? "🟢 Eingeschaltet" : "⚪ Ausgeschaltet"})\n` +
        `🗂️ *Quelle:* \`${escapeMd(sourceLabel)}\`\n` +
        `📊 *Fortschritt:* \`${finalBar}\` (\`${immediateSlice.length} / ${totalExtracted}\`)\n` +
        `🎬 *Filme gespeichert:* \`${moviesAdded.length}\`\n` +
        `📺 *Serien/Episoden gespeichert:* \`${seriesAdded.length}\`\n` +
        `♻️ *Exakte Duplikate gefiltert:* \`${Number(detected.duplicatesSkippedCount || 0) + Number(duplicatesCount || 0)}\`\n` +
        `🔗 *Qualitäten zusammengeführt:* \`${Number(mergedQualitiesCount || 0)}\`\n` +
        `⚠️ *Unsicher / Nicht erkannt:* \`${Number(uncertainCount || 0)} / ${failedItems.length}\`` +
        queueHint +
        (moviesAdded.length > 0 ? `\n\n🎬 *Filme (Auszug):*\n• ${moviesAdded.slice(0, 5).map(escapeMd).join("\n• ")}` : "") +
        (seriesAdded.length > 0 ? `\n\n📺 *Serien (Auszug):*\n• ${seriesAdded.slice(0, 5).map(escapeMd).join("\n• ")}` : "");

      const inline_keyboard = [];
      if (remainingSlice.length > 0) {
        inline_keyboard.push([
          { text: `▶️ Nächsten Batch (+12)`, callback_data: "impq_step_1" },
          { text: `⚡ Turbo-Batch (+36)`, callback_data: "impq_step_3" }
        ]);
        inline_keyboard.push([
          { text: "🗑️ Warteschlange leeren", callback_data: "impq_clear" }
        ]);
      }
      inline_keyboard.push([
        { text: `📂 Playlist "${playlistFolder.name.slice(0, 18)}"`, callback_data: `wl_open_${playlistFolder.id}` },
        { text: playlistFolder.enabled !== false ? "🟢 Aktiv (Ausschalten)" : "⚪ Aus (Einschalten)", callback_data: `pltog_${playlistFolder.id}` }
      ]);
      inline_keyboard.push([
        { text: "✏️ Playlist umbenennen", callback_data: `plren_${playlistFolder.id}` },
        { text: "🗑️ Playlist löschen", callback_data: `pldel_${playlistFolder.id}` }
      ]);
      inline_keyboard.push(buildFooterRow(chatId, true));

      if (statusMsgId) {
        await editMessageText(chatId, statusMsgId, summaryText, {
          reply_markup: { inline_keyboard }
        });
      } else {
        await sendMessage(chatId, summaryText, {
          reply_markup: { inline_keyboard }
        });
      }
      return true;
    }

    // A2) Eingehende Untertitel-Datei (.srt, .vtt, .sub, .ass, .ssa) automatisch an das vorherige Video binden
    if (docObj && SUBTITLE_EXTENSIONS.test(String(docObj.file_name || ""))) {
      const subItem = {
        telegram_file_id: String(docObj.file_id),
        file_name: String(docObj.file_name || "Untertitel.srt"),
        lang: "de",
        message_id: message.message_id || null
      };
      const lastTarget = memoryFallback.get(`last_ingested_media_${chatId}`);
      if (lastTarget && lastTarget.tmdbId) {
        const boundOk = await attachSubtitleToMediaInD1(env, lastTarget, subItem);
        if (boundOk) {
          const seInfo = lastTarget.typeCode === "s"
            ? ` (S${String(lastTarget.season || 1).padStart(2, "0")}E${String(lastTarget.episode || 1).padStart(2, "0")})`
            : "";
          await sendMessage(
            chatId,
            `💬 *UNTERTITEL GEBUNDEN*\n${SEP}\n` +
            `📄 \`${escapeMd(subItem.file_name)}\`\n` +
            `🔗 Verknüpft mit: *${escapeMd(lastTarget.title || "Video")}${escapeMd(seInfo)}*\n` +
            `✅ _Wird beim Abrufen automatisch mit dem Video gesendet und als separater Untertitel-Button bereitgestellt._`,
            { reply_markup: { inline_keyboard: [buildFooterRow(chatId, true)] } }
          );
          return true;
        }
      }
    }

    // B) Eingehende Videodatei per Regex-Weiche parsen, bereinigen & als saubere TMDb-Karte ausgeben
    if (videoObj) {
      const rawFileName = videoObj.file_name || message.caption || "";
      const fileMeta = {
        fileId: videoObj.file_id,
        fileUniqueId: videoObj.file_unique_id || null,
        fileSize: videoObj.file_size || null,
        mimeType: videoObj.mime_type || "video/mp4"
      };

      // Falls der Bot in der Quellgruppe ist: Verknüpfe automatisch etwaige tg_export_<channelId>_<msgId> Einträge mit der echten file_id!
      if (Number(chatId) < 0 && message.message_id && videoObj.file_id) {
        const rawChannelId = String(chatId).replace(/^-100/, "").replace(/^-/, "");
        const candidateExportId = `tg_export_${rawChannelId}_${message.message_id}`;
        await replaceExportFileIdInD1(env, candidateExportId, videoObj.file_id, videoObj.file_unique_id || null);
      }

      const loadingMsgId = await sendLoadingPlaceholder(env, chatId, "main_menu", rawFileName || "Videodatei", `🎞️ Analysiere Datei & bereinige Metadaten...`);
      const resolved = await resolveAndIngestMediaEntry(env, rawFileName, fileMeta);

      if (!resolved) {
        if (loadingMsgId) await tgApi(env).deleteMessage(chatId, loadingMsgId);
        await sendMessage(chatId, `⚠️ *Videodatei konnte keinem eindeutigen TMDb-Titel zugeordnet werden.*`, {
          reply_markup: { inline_keyboard: [buildFooterRow(chatId, true)] }
        });
        return true;
      }

      memoryFallback.set(`last_ingested_media_${chatId}`, {
        typeCode: resolved.typeCode,
        tmdbId: resolved.tmdbId,
        season: resolved.season || 1,
        episode: resolved.episode || 1,
        fileId: videoObj.file_id,
        title: resolved.cleanTitle
      });

      try {
        const botVipFolder = await ensureBotVipDefaultPlaylist(env);
        if (botVipFolder) {
          await batchSaveIngestedItemsToPlaylist(env, "bot_vip", botVipFolder.id, [resolved], "vip_stream");
        }
      } catch (e) {}

      await sendItemCard(env, chatId, { id: resolved.tmdbId }, resolved.typeCode, null, null, loadingMsgId, resolved.details, null);
      return true;
    }

    return false;
  }

  // --- Haupt-Router für Telegram Webhook Updates ---
  async function handleUpdate(env, update) {
    const { sendMessage, editMessageText, answerCallbackQuery, deleteMessage, editMessageReplyMarkup, editInlineMessageText, getChatMember } = tgApi(env);
    const activeSessionChatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id || null;

    try {
      // 0. Inline-Queries (für Gruppen & Kanäle: @BotName Suchbegriff / @BotName f / @BotName s)
      if (update.inline_query) {
        await handleInlineQuery(env, update.inline_query);
        return;
      }

      // 1. Eingehende Nachrichten (Text, Video oder JSON-Dokument)
      if (update.message) {
        const message = update.message;

        // WICHTIG: Der Bot darf NIEMALS auf seine eigenen (oder fremde) Inline-Nachrichten antworten!
        if (message.via_bot) {
          return;
        }

        registerChatType(message.chat);
        const chatId = message.chat.id;

        // Wenn in einer Gruppe auf eine alte Video-Nachricht geantwortet wird (z.B. mit /resolve oder /id), ernte sofort deren echte file_id für D1!
        const repliedVideo = message.reply_to_message?.video || (message.reply_to_message?.document && /^video\//i.test(message.reply_to_message.document.mime_type || "") ? message.reply_to_message.document : null);
        if (repliedVideo && repliedVideo.file_id && Number(chatId) < 0 && message.reply_to_message?.message_id) {
          const rawChannelId = String(chatId).replace(/^-100/, "").replace(/^-/, "");
          const exportKey = `tg_export_${rawChannelId}_${message.reply_to_message.message_id}`;
          await replaceExportFileIdInD1(env, exportKey, repliedVideo.file_id, repliedVideo.file_unique_id || null);
        }

        // Prüfe zuerst auf eingehende Videodateien oder .json-Titeldateien (Projekt 1 - Punkt 1 & 2)
        if (message.video || message.document) {
          const handledMedia = await handleIncomingMediaOrJson(env, message);
          if (handledMedia) return;
        }

        const text = (message.text || "").trim();

        // /id oder /chatid Befehl: Zeigt sofort Chat-ID, Topic/Thread-ID & Quellgruppen-ID zum Kopieren für Gruppen-Versand & Backup-Bridge
        if (/^\/(?:id|chatid|groupid)(?:@\w+)?$/i.test(text)) {
          const threadId = message.message_thread_id || null;
          const rawChannelNum = String(chatId).replace(/^-100/, "").replace(/^-/, "");
          const idInfoText =
            `🆔 *TELEGRAM CHAT- & GRUPPEN-ID DIAGNOSE*\n${SEP}\n` +
            `💬 *Chat-Name:* \`${escapeMd(message.chat.title || message.chat.first_name || "Privat-Chat")}\`\n` +
            `📌 *Ziel- / Gruppen Chat-ID:* \`${chatId}\`\n` +
            (threadId ? `🧵 *Topic / Thread-ID:* \`${threadId}\`\n` : "") +
            (Number(chatId) < 0 ? `📦 *result.json Channel-ID:* \`${rawChannelNum}\` (Bridge: \`${chatId}\`)\n` : "") +
            (repliedVideo?.file_id ? `🎞️ *Geerntete Video File-ID (in D1 gespeichert!):*\n\`${repliedVideo.file_id}\`\n` : "") +
            `\n💡 *Tipp:* Kopiere \`${chatId}\` und füge sie in der **Mini-App ▸ Film-Modal oder ⚙️ Einstellungen** unter **👥 Eigene Ziel-Gruppe** oder **📦 Quellgruppe** ein!`;
          await sendMessage(chatId, idInfoText, threadId ? { message_thread_id: threadId } : {});
          return;
        }

        // In Gruppen/Supergruppen merken wir uns, wer den aktuellen Befehl eingegeben hat (Session-Owner)
        if (isGroupOrChannelChat(chatId) && message.from?.id) {
          const sess = await getUserSession(env, chatId);
          if (sess.sessionOwnerId !== message.from.id) {
            sess.sessionOwnerId = message.from.id;
            sess._dirty = true;
          }
          memoryFallback.set(`group_owner_${chatId}`, message.from.id);
        }

        const promptState = await getUserPromptState(env, chatId);
        if (promptState && promptState.msgId) {
          await deleteMessage(chatId, promptState.msgId);
          await clearUserPromptState(env, chatId);
        }

        // Wenn /start tact_... oder /start fdesc_... aus der Detailkarte angetippt wurde,
        // darf die Detailkarte (activeMenuId) NICHT gelöscht werden!
        const isOverlayStart = /^\/start(?:@\w+)?\s+(?:tact_|fdesc_)/i.test(text);

        await clearExtraMessage(env, chatId, deleteMessage);

        if (!isOverlayStart) {
          const activeMenuId = await getActiveMenu(env, chatId);
          if (activeMenuId) {
            await deleteMessage(chatId, activeMenuId);
            await clearActiveMenu(env, chatId);
          }
        }

        // /restart (oder /reset, /neustart): Löscht alle temporären Bot- & Nutzer-Nachrichten (außer gespeicherte Karten) und startet komplett neu
        if (/^\/(?:restart|reset|neustart)(?:@\w+)?$/i.test(text)) {
          await deleteMessage(chatId, message.message_id);
          await clearAllTempMessages(env, chatId, deleteMessage);
          await clearOriginSession(env, chatId);
          await clearActiveMenu(env, chatId);
          await clearUserPromptState(env, chatId);
          await clearExtraMessage(env, chatId, deleteMessage);
          memoryFallback.delete(`active_list_ctx_${chatId}`);
          const sess = await getUserSession(env, chatId);
          sess.searchState = null;
          sess._dirty = true;
          await saveWishlistViewState(env, chatId, { currentFolderId: "root", searchQuery: "", page: 1 });
          await initialMenu(env, chatId, message.chat.first_name);
          return;
        }

        // /zurück (oder /zurueck, /back, "zurück"): Bringt den Nutzer immer einen Schritt zurück
        if (/^(?:\/(?:zurück|zurueck|back)(?:@\w+)?|zurück|zurueck)$/i.test(text)) {
          await deleteMessage(chatId, message.message_id);
          await handleBackNavigation(env, chatId, message.chat.first_name);
          return;
        }

        // GEHEIMES ADMIN-PANEL: /stats xyz
        if (text.toLowerCase() === ADMIN_SECRET_COMMAND) {
          await deleteMessage(chatId, message.message_id);
          await showAdminStatsPanel(env, chatId);
          return;
        }

        // Spezielle Prompt-Modi verarbeiten (Nutzer-Eingaben sofort löschen, damit der Chat clean bleibt)
        if (promptState && !text.startsWith("/")) {
          await deleteMessage(chatId, message.message_id);
          if (promptState.mode === "new_folder_and_save") {
            const { typeCode, itemId } = promptState.meta || {};
            const folder = await createCustomFolder(env, chatId, text);
            if (typeCode && itemId) {
              await fetchAndSaveById(env, chatId, typeCode, itemId, folder.id);
            }
            await saveWishlistViewState(env, chatId, { currentFolderId: folder.id, page: 1 });
            await displaySavedList(env, chatId);
            return;
          }
          if (promptState.mode === "new_folder_only") {
            await createCustomFolder(env, chatId, text);
            await displaySavedList(env, chatId);
            return;
          }
          if (promptState.mode === "rename_folder") {
            const { folderId, unlink } = promptState.meta || {};
            const folders = await getFolders(env, chatId);
            const target = folders.find(f => f.id === folderId);
            if (target) {
              target.name = text.slice(0, 45);
              if (unlink) {
                target.linked = false;
                target.type = "custom";
                target.tmdbRefId = null;
              }
              await saveFolders(env, chatId, folders);
            }
            await displaySavedList(env, chatId);
            return;
          }
          if (promptState.mode === "search_folder_for_save") {
            const { typeCode, itemId } = promptState.meta || {};
            await showSaveDestinationMenu(env, chatId, typeCode, itemId, null, text);
            return;
          }
          if (promptState.mode === "wl_search") {
            await saveWishlistViewState(env, chatId, { searchQuery: text.slice(0, 60), page: 1 });
            await displaySavedList(env, chatId);
            return;
          }
          if (promptState.mode === "bcol_search") {
            await showCollectionsBrowser(env, chatId, 1, text.slice(0, 80), null);
            return;
          }
        }

        // 6-stelliger Web-/Smart-TV-Login-Code direkt im Bot-Chat eingegeben (z.B. "482915" oder "482 915")
        const sixDigitMatch = text.trim().match(/^(\d{3})\s*(\d{3})$/);
        if (sixDigitMatch) {
          const cleanCode = `${sixDigitMatch[1]}${sixDigitMatch[2]}`;
          let mappedChallengeId = memoryFallback.get(`webauth_code_${cleanCode}`);
          if (!mappedChallengeId) {
            mappedChallengeId = await kvCachedGetRaw(env, `webauth_code_${cleanCode}`, "MY_KV").catch(() => null);
          }
          if (mappedChallengeId) {
            const cId = String(mappedChallengeId).replace(/^"|"$/g, "").trim();
            let challengeObj = memoryFallback.get(`webauth_id_${cId}`);
            if (!challengeObj) {
              const raw = await kvCachedGetRaw(env, `webauth_id_${cId}`, "MY_KV").catch(() => null);
              if (raw) { try { challengeObj = JSON.parse(raw); } catch (e) {} }
            }
            if (challengeObj && Date.now() <= Number(challengeObj.expiresAt || 0)) {
              challengeObj.status = "confirmed";
              challengeObj.user = {
                id: Number(message.from?.id || chatId),
                first_name: String(message.from?.first_name || firstName || "Filmfreund"),
                last_name: String(message.from?.last_name || ""),
                username: String(message.from?.username || "")
              };
              memoryFallback.set(`webauth_id_${cId}`, challengeObj);
              try {
                await kvStageWrite(env, `webauth_id_${cId}`, challengeObj, { bindingName: "MY_KV", expirationTtl: 300, periodicOnly: false });
              } catch (e) {}
              await deleteMessage(chatId, message.message_id);
              await sendMessage(chatId, `✅ *6-stelliger Login-Code (${cleanCode}) bestätigt!*\nDein Browser / Smart-TV wird jetzt automatisch in der Mediathek Mini-App angemeldet.`);
              return;
            }
          }
        }

        // /info, /Info, /help oder /hilfe Befehl -> Zeigt die komplette Befehls- & Icon-Übersicht
        if (/^\/(?:info|help|hilfe)(?:@\w+)?$/i.test(text)) {
          await deleteMessage(chatId, message.message_id);
          await showBotInfoPost(env, chatId, null);
          return;
        }

        // /start und alle klickbaren TextLink-Aktionen (?start=...)
        if (text.startsWith("/start")) {
          const startParam = text.replace(/^\/start(?:@\w+)?/i, "").trim();

          // WICHTIG: Wenn ein Deep-Link / TextLink im Bot angeklickt wurde, den "/start ..." Befehl sofort aus dem Chat löschen!
          await deleteMessage(chatId, message.message_id);

          if (startParam.startsWith("webauth_")) {
            const cId = startParam.replace(/^webauth_/i, "").trim();
            let challengeObj = memoryFallback.get(`webauth_id_${cId}`);
            if (!challengeObj) {
              const raw = await kvCachedGetRaw(env, `webauth_id_${cId}`, "MY_KV").catch(() => null);
              if (raw) { try { challengeObj = JSON.parse(raw); } catch (e) {} }
            }
            if (challengeObj && Date.now() <= Number(challengeObj.expiresAt || 0)) {
              challengeObj.status = "confirmed";
              challengeObj.user = {
                id: Number(message.from?.id || chatId),
                first_name: String(message.from?.first_name || firstName || "Filmfreund"),
                last_name: String(message.from?.last_name || ""),
                username: String(message.from?.username || "")
              };
              memoryFallback.set(`webauth_id_${cId}`, challengeObj);
              try {
                await kvStageWrite(env, `webauth_id_${cId}`, challengeObj, { bindingName: "MY_KV", expirationTtl: 300, periodicOnly: false });
              } catch (e) {}
              await sendMessage(chatId, `✅ *Web- & Smart-TV-Login erfolgreich bestätigt!*\nDu bist jetzt in deiner Mediathek Mini-App angemeldet und kannst zum Browser / Smart-TV zurückkehren.`);
            } else {
              await sendMessage(chatId, `⌛ *Dieser Login-Link ist abgelaufen.*\nBitte fordere im Login-Fenster der Mini-App einen neuen Code an.`);
            }
            return;
          }

          if (startParam === "info") {
            await showBotInfoPost(env, chatId, null);
            return;
          }

          // Universelle Lupe [🔍] -> "Wie möchtest du suchen?" für Filme/Serien, Filmreihen, Universen & Episoden
          if (startParam.startsWith("ws_")) {
            const parts = startParam.split("_");
            const typeCode = parts[1] || "m";
            const itemId = parts[2] || "";
            await showUniversalWhereToSearchMenu(env, chatId, { kind: "item", typeCode, itemId }, null);
            return;
          }
          if (startParam.startsWith("wscol_")) {
            const colId = startParam.replace("wscol_", "");
            await showUniversalWhereToSearchMenu(env, chatId, { kind: "col", colId }, null);
            return;
          }
          if (startParam.startsWith("wsuni_")) {
            const uniKey = startParam.replace("wsuni_", "");
            await showUniversalWhereToSearchMenu(env, chatId, { kind: "uni", uniKey }, null);
            return;
          }
          if (startParam.startsWith("wsep_")) {
            const parts = startParam.split("_");
            await showUniversalWhereToSearchMenu(env, chatId, {
              kind: "ep",
              seriesId: parts[1],
              seasonNumber: parseInt(parts[2], 10) || 1,
              episodeNumber: parseInt(parts[3], 10) || 1
            }, null);
            return;
          }

          // 2-Klick-Aktionsmenü beim Antippen des Titels (nur Schließen-Button!)
          if (startParam.startsWith("tact_")) {
            const parts = startParam.split("_");
            const typeCode = parts[1] || "m";
            const itemId = parts[2] || "";
            await showTitleActionMenu(env, chatId, typeCode, itemId);
            return;
          }

          // Teilen-Button [📤] (Nicht-Inline): Erzeugt sauberen Empfehlungs-Post mit Telegraph-Titellink & Bot-Textlink
          if (startParam.startsWith("sh_")) {
            const parts = startParam.split("_");
            const typeCode = parts[1] || "m";
            const itemId = parts[2] || "";
            await showSharePostOverlay(env, chatId, typeCode, itemId);
            return;
          }

          // Klickbares "📖 Komplett lesen" direkt neben "🧐 Beschreibung:" im Text
          if (startParam.startsWith("fdesc_")) {
            const parts = startParam.split("_");
            const typeCode = parts[1] || "m";
            const itemId = parts[2] || "";
            await sendFullDescriptionOverlay(env, chatId, typeCode, itemId, null);
            return;
          }

          // Klickbares "✨ Ähnliche Titel" direkt im Post verankert: sim_TYPE_ID
          if (startParam.startsWith("sim_")) {
            const parts = startParam.split("_");
            const typeCode = parts[1] || "m";
            const itemId = parts[2] || "";
            await executeSimilarSearch(env, chatId, typeCode, itemId, false, null, null);
            return;
          }

          // Klickbares Erscheinungsjahr in der Detailansicht: yr_TYPE_YEAR_ITEMID
          if (startParam.startsWith("yr_")) {
            const parts = startParam.split("_");
            const typeCode = parts[1] || "m";
            const year = parts[2] || "2024";
            const originId = parts[3] || "";
            await showYearActionMenu(env, chatId, year, typeCode, originId, null);
            return;
          }

          // Serien-Episodenliste öffnen: ep_SERIESID_SEASON_VIEWMODE_PAGE
          if (startParam.startsWith("ep_")) {
            const parts = startParam.split("_");
            const seriesId = parts[1];
            const seasonNum = parseInt(parts[2], 10) || 1;
            const viewMode = parts[3] || "all";
            const pageNum = parseInt(parts[4], 10) || 1;
            await showSeriesEpisodes(env, chatId, seriesId, seasonNum, viewMode, pageNum, null);
            return;
          }

          // Einzelne Episode per TextLink speichern/entfernen: epsv_SERIESID_SEASON_EPISODE_PAGE
          if (startParam.startsWith("epsv_")) {
            const parts = startParam.split("_");
            const seriesId = parts[1];
            const seasonNum = parseInt(parts[2], 10) || 1;
            const epNum = parseInt(parts[3], 10) || 1;
            const explicitPage = parseInt(parts[4], 10) || 0;
            const res = await saveEpisodeById(env, chatId, seriesId, seasonNum, epNum);
            const listCtx = memoryFallback.get(`active_list_ctx_${chatId}`);
            const viewMode = listCtx?.viewMode || "all";
            const pageNum = explicitPage || listCtx?.page || 1;
            const flash = res.saved
              ? `✅ *„${escapeMd(res.title)}"* wurde im Unterordner *„📺 Serien ▸ ${escapeMd(res.seriesTitle || "Serie")}"* gespeichert!`
              : `🗑️ *„${escapeMd(res.title)}"* wurde aus *„📺 Serien ▸ ${escapeMd(res.seriesTitle || "Serie")}"* entfernt.`;
            await showSeriesEpisodes(env, chatId, seriesId, seasonNum, viewMode, pageNum, null, flash);
            return;
          }

          // Einzelne Episode Telegraph-Artikel erstellen, automatisch als Instant-View-Vorschau einblenden & zurück zur Übersicht springen: eptg_SERIESID_SEASON_EPISODE_PAGE
          if (startParam.startsWith("eptg_")) {
            const parts = startParam.split("_");
            const seriesId = parts[1];
            const seasonNum = parseInt(parts[2], 10) || 1;
            const epNum = parseInt(parts[3], 10) || 1;
            const explicitPage = parseInt(parts[4], 10) || 1;
            const listCtx = memoryFallback.get(`active_list_ctx_${chatId}`);
            const viewMode = listCtx?.viewMode || "all";
            const [sDetails, seasonData] = await Promise.all([
              fetchSeriesDetails(env, seriesId),
              fetchSeasonDetails(env, seriesId, seasonNum)
            ]);
            const epObj = (seasonData?.episodes || []).find(e => Number(e.episode_number) === Number(epNum)) || {
              episode_number: epNum,
              season_number: seasonNum,
              name: `Folge ${epNum}`
            };
            const tgUrl = await ensureEpisodeTelegraphUrl(env, seriesId, sDetails, seasonNum, epObj);
            const codeStr = `S${String(seasonNum).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`;
            const epTitleClean = (epObj.name || `Folge ${epNum}`).replace(/^(?:S\d+E\d+\s*[–-]\s*)/i, "").trim();
            const flash = tgUrl
              ? `📖 *Story bereit (${codeStr} – ${escapeMd(epTitleClean)}):* 👉 *[Jetzt im Instant-View öffnen](${tgUrl})*`
              : `⚠️ _Telegraph-Artikel für ${codeStr} konnte momentan nicht erstellt werden._`;
            await showSeriesEpisodes(env, chatId, seriesId, seasonNum, viewMode, explicitPage, null, flash, tgUrl);
            return;
          }

          // Film aus der Filmreihen-Übersicht (aus Merkliste geöffnet) -> zeigt "🔙 Zurück zur (Titel) Reihe (💾 Merkliste)"!
          if (startParam.startsWith("fcolwl_")) {
            const parts = startParam.split("_");
            const colId = parts[1];
            const movieId = parts[2];
            const wlFolderId = parts.slice(3).join("_") || `f_col_${colId}`;
            const targetName = memoryFallback.get(`title_cache_m_${movieId}`) || `Film #${movieId}`;
            const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sdet_m_${movieId}`, targetName);
            await sendItemCard(env, chatId, { id: movieId }, "m", null, null, loadingMsgId, null, {
              mode: "from_col",
              id: colId,
              fromWishlist: true,
              wlFolderId
            });
            return;
          }

          // Film aus der Filmreihen-Übersicht (showCollectionDetails) geöffnet -> zeigt "🔙 Zurück zur (Titel) Filmreihe"!
          if (startParam.startsWith("fcol_")) {
            const parts = startParam.split("_");
            const colId = parts[1];
            const movieId = parts[2];
            const fromWl = memoryFallback.get(`col_from_wl_${chatId}_${colId}`);
            const targetName = memoryFallback.get(`title_cache_m_${movieId}`) || `Film #${movieId}`;
            const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sdet_m_${movieId}`, targetName);
            await sendItemCard(env, chatId, { id: movieId }, "m", null, null, loadingMsgId, null, {
              mode: "from_col",
              id: colId,
              fromWishlist: Boolean(fromWl),
              wlFolderId: typeof fromWl === "string" ? fromWl : ""
            });
            return;
          }

          // Film aus der Filmuniversen-Übersicht (aus Merkliste geöffnet) -> zeigt "🔙 Zurück zum (Titel) Universum (💾 Merkliste)"!
          if (startParam.startsWith("funiwl_")) {
            const parts = startParam.split("_");
            const movieId = parts[parts.length - 1];
            const pageNum = parseInt(parts[parts.length - 2], 10) || 1;
            const uniKey = parts.slice(1, parts.length - 2).join("_");
            const wlFold = memoryFallback.get(`uni_from_wl_${chatId}_${uniKey}`) || `f_uni_${uniKey}`;
            const targetName = memoryFallback.get(`title_cache_m_${movieId}`) || `Film #${movieId}`;
            const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sdet_m_${movieId}`, targetName);
            await sendItemCard(env, chatId, { id: movieId }, "m", null, null, loadingMsgId, null, {
              mode: "from_uni",
              id: uniKey,
              page: pageNum,
              fromWishlist: true,
              wlFolderId: typeof wlFold === "string" ? wlFold : `f_uni_${uniKey}`
            });
            return;
          }

          // Film aus der Filmuniversen-Übersicht (showUniverseDetails) geöffnet -> zeigt "🔙 Zurück zum (Titel) Universum"!
          if (startParam.startsWith("funi_")) {
            const parts = startParam.split("_");
            const movieId = parts[parts.length - 1];
            const pageNum = parseInt(parts[parts.length - 2], 10) || 1;
            const uniKey = parts.slice(1, parts.length - 2).join("_");
            const fromWl = memoryFallback.get(`uni_from_wl_${chatId}_${uniKey}`);
            const targetName = memoryFallback.get(`title_cache_m_${movieId}`) || `Film #${movieId}`;
            const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sdet_m_${movieId}`, targetName);
            await sendItemCard(env, chatId, { id: movieId }, "m", null, null, loadingMsgId, null, {
              mode: "from_uni",
              id: uniKey,
              page: pageNum,
              fromWishlist: Boolean(fromWl),
              wlFolderId: typeof fromWl === "string" ? fromWl : ""
            });
            return;
          }

          // Filmreihe aus dem "🍿 Filmreihen" Browser öffnen: bcol_COLLECTIONID
          if (startParam.startsWith("bcol_")) {
            const colId = startParam.replace("bcol_", "");
            await showCollectionDetails(env, chatId, colId, "m", "", null);
            return;
          }

          // Filmuniversum aus der Merkliste öffnen: buniwl_UNIVERSEID_FOLDERID
          if (startParam.startsWith("buniwl_")) {
            const rest = startParam.replace("buniwl_", "");
            const fIdx = rest.indexOf("_f_");
            const uniId = fIdx !== -1 ? rest.slice(0, fIdx) : rest.split("_")[0];
            const folderId = fIdx !== -1 ? rest.slice(fIdx + 1) : `f_uni_${uniId}`;
            memoryFallback.set(`uni_from_wl_${chatId}_${uniId}`, folderId);
            await showUniverseDetails(env, chatId, uniId, 1, null);
            return;
          }

          // Filmuniversum aus dem "🌌 Filmuniversen" Browser öffnen: buni_UNIVERSEID
          if (startParam.startsWith("buni_")) {
            const uniId = startParam.replace("buni_", "");
            memoryFallback.delete(`uni_from_wl_${chatId}_${uniId}`);
            await showUniverseDetails(env, chatId, uniId, 1, null);
            return;
          }

          // Deep-Links aus der Mini-App ("🤖 Im Bot öffnen" von jeder Seite!)
          if (startParam.startsWith("discover_")) {
            const mode = startParam.replace("discover_", "");
            if (mode === "collections") {
              await showCollectionsBrowser(env, chatId, 1, "", null);
            } else if (mode === "universes") {
              await showUniversesBrowser(env, chatId, 1, null);
            } else if (mode === "series" || mode === "s") {
              await showGenres(env, chatId, "s", null);
            } else if (mode === "movies" || mode === "m") {
              await showGenres(env, chatId, "m", null);
            } else {
              await initialMenu(env, chatId, message.chat.first_name);
            }
            return;
          }

          if (startParam === "wishlist" || startParam === "saved") {
            await saveWishlistViewState(env, chatId, { currentFolderId: "root", searchQuery: "", page: 1 });
            await displaySavedList(env, chatId, null);
            return;
          }

          if (startParam === "settings" || startParam === "filters") {
            await showSettingsOverview(env, chatId, null);
            return;
          }

          if (startParam === "admin") {
            await showAdminStatsPanel(env, chatId);
            return;
          }

          if (startParam.startsWith("search_")) {
            const rawQ = decodeURIComponent(startParam.replace("search_", "")).trim();
            if (rawQ) {
              await saveSearchState(env, chatId, rawQ, 1, "pop_desc", false);
              await displaySearchResults(env, chatId, rawQ, 1, null, "pop_desc", false);
              return;
            }
          }

          // 1. Ticket für Film/Serie: m_12345 oder s_12345
          if (/^[ms]_\d+$/.test(startParam)) {
            const [typeCode, itemId] = startParam.split("_");
            const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sdet_${typeCode}_${itemId}`, `Ticket #${itemId}`);
            await sendItemCard(env, chatId, { id: itemId }, typeCode, null, null, loadingMsgId, null, null);
            return;
          }
          // 2. Detailkarte aus Suche: sdet_m_12345
          if (startParam.startsWith("sdet_")) {
            const parts = startParam.split("_");
            const typeCode = parts[1] || "m";
            const itemId = parts[2] || "";
            const targetName = memoryFallback.get(`title_cache_${typeCode}_${itemId}`) || `Titel #${itemId}`;
            const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sdet_${typeCode}_${itemId}`, targetName);
            await sendItemCard(env, chatId, { id: itemId }, typeCode, null, null, loadingMsgId, null, "search");
            return;
          }
          // 3. Filmreihe (Collection): col_12345_m_67890
          if (startParam.startsWith("col_")) {
            const parts = startParam.split("_");
            const collectionId = parts[1];
            const originType = parts[2] || "m";
            const originId = parts[3] || "";
            await showCollectionDetails(env, chatId, collectionId, originType, originId, null);
            return;
          }
          // 4. Schauspieler / Regie (Person): per_12345_m_67890
          if (startParam.startsWith("per_")) {
            const parts = startParam.split("_");
            const personId = parts[1];
            const originType = parts[2] || "m";
            const originId = parts[3] || "";
            await showPersonActionMenu(env, chatId, personId, originType, originId, null);
            return;
          }
          // 5. Person Filmografie direkt öffnen: pcr_PERSONID_PAGE
          if (startParam.startsWith("pcr_")) {
            const parts = startParam.split("_");
            const personId = parts[1];
            const pageNum = parseInt(parts[2], 10) || 1;
            await displayPersonCredits(env, chatId, personId, pageNum, "m", "", null);
            return;
          }
          // 6. Genre-Auswahlmenü: gen_28_m_12345
          if (startParam.startsWith("gen_")) {
            const parts = startParam.split("_");
            const genreId = parts[1];
            const originType = parts[2] || "m";
            const originId = parts[3] || "";
            await showGenreActionMenu(env, chatId, genreId, originType, originId, null);
            return;
          }
          // 7. Merklisten-Eintrag öffnen: sd_UID
          if (startParam.startsWith("sd_")) {
            const uid = startParam.replace("sd_", "");
            const list = await getSavedList(env, chatId);
            const itemObj = list.find(i => String(i.uid) === String(uid));
            if (itemObj) {
              if (itemObj.contentType === "episode" && itemObj.seriesId) {
                await showSeriesEpisodes(env, chatId, itemObj.seriesId, itemObj.seasonNumber || 1, "all", 1, null);
              } else {
                const typeCode = itemObj.contentType === "series" ? "s" : "m";
                const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sd_${uid}`, itemObj.title);
                await sendItemCard(env, chatId, { id: itemObj.tmdbId }, typeCode, null, null, loadingMsgId, null, "saved");
              }
            } else {
              await displaySavedList(env, chatId);
            }
            return;
          }
          // 8. Merkliste "Wo suchen?": wlw_UID
          if (startParam.startsWith("wlw_")) {
            const uid = startParam.replace("wlw_", "");
            await showWishlistWhereToSearchMenu(env, chatId, uid, null);
            return;
          }
          // 9. Merklisten-Eintrag mit Sicherheitsabfrage löschen: delc_UID
          if (startParam.startsWith("delc_")) {
            const uid = startParam.replace("delc_", "");
            await promptItemDeleteConfirm(env, chatId, uid, null);
            return;
          }
          // Legacy Direkt-Löschen falls alter Link im Chat: del_UID
          if (startParam.startsWith("del_")) {
            const uid = startParam.replace("del_", "");
            await promptItemDeleteConfirm(env, chatId, uid, null);
            return;
          }
          // 10. Merklisten-Ordner öffnen: wlo_FOLDERID
          if (startParam.startsWith("wlo_")) {
            const folderId = startParam.replace("wlo_", "");
            await saveWishlistViewState(env, chatId, { currentFolderId: folderId, searchQuery: "", page: 1 });
            await displaySavedList(env, chatId);
            return;
          }
          // 10b. Merklisten-Playlist Einschalten / Ausschalten (Toggle ON/OFF): plt_FOLDERID
          if (startParam.startsWith("plt_")) {
            const folderId = startParam.replace("plt_", "");
            await togglePlaylistFolderEnabled(env, chatId, folderId);
            await flushUserSession(env, chatId);
            await displaySavedList(env, chatId);
            return;
          }
          // 11. Merklisten-Ordner umbenennen: fed_FOLDERID
          if (startParam.startsWith("fed_")) {
            const folderId = startParam.replace("fed_", "");
            await showFolderRenamePrompt(env, chatId, folderId, false, null);
            return;
          }
          // 12. Merklisten-Ordner löschen: fdl_FOLDERID
          if (startParam.startsWith("fdl_")) {
            const folderId = startParam.replace("fdl_", "");
            await promptFolderDeleteConfirm(env, chatId, folderId, null);
            return;
          }
          // 13. Einzelnen Kollektions-Film speichern (oder Speicherorte zeigen falls schon gespeichert): csv_COLID_MOVIEID
          if (startParam.startsWith("csv_")) {
            const parts = startParam.split("_");
            const colId = parts[1];
            const movId = parts[2];
            const savedList = await getSavedList(env, chatId);
            const alreadyIn = savedList.some(i => String(i.tmdbId) === String(movId) && (!i.contentType || i.contentType === "movie"));
            if (alreadyIn) {
              await showSavedItemLocationsMenu(env, chatId, "m", movId, null);
            } else {
              await promptCollectionSingleSave(env, chatId, colId, movId, null);
            }
            return;
          }
          // 14. Schnell-Speichern aus Suche, Universum, Genre, Jahr oder Person: qsv_TYPE_ITEMID
          if (startParam.startsWith("qsv_")) {
            const parts = startParam.split("_");
            const typeCode = parts[1] || "m";
            const itemId = parts[2] || "";
            const contentType = typeCode === "m" ? "movie" : "series";
            const savedList = await getSavedList(env, chatId);
            const alreadyIn = savedList.some(i => String(i.tmdbId) === String(itemId) && (!i.contentType || i.contentType === contentType));
            if (alreadyIn) {
              await showSavedItemLocationsMenu(env, chatId, typeCode, itemId, null);
            } else {
              await showSaveDestinationMenu(env, chatId, typeCode, itemId, null);
            }
            return;
          }
          // 15. Alle Titel einer Kollektion, eines Universums oder einer Person speichern: svall_col_ID | svall_uni_ID | svall_per_ID
          if (startParam.startsWith("svall_col_") || startParam.startsWith("svall_uni_") || startParam.startsWith("svall_per_")) {
            const kind = startParam.startsWith("svall_col_")
              ? "col"
              : startParam.startsWith("svall_uni_")
                ? "uni"
                : "per";
            const refId = startParam.replace(/^svall_(?:col|uni|per)_/, "");
            await promptConfirmSaveAll(env, chatId, kind, refId, "m", "", null);
            return;
          }

          await initialMenu(env, chatId, message.chat.first_name);
          return;
        }

        // Schnellbefehle für Trends (/t, /trnd, /trend, /trending), Populär (/p, /pop, /popular, /populär),
        // Geheimtipps (/SC, /sec, /secret, /geheim) & Zufall (/r, /rand, /random) jeweils mit f (Film) oder s (Serie)
        const quickBrowseCmd = parseBotQuickBrowseCommand(text);
        if (quickBrowseCmd) {
          await deleteMessage(chatId, message.message_id);
          await clearAllTempMessages(env, chatId, deleteMessage);
          if (quickBrowseCmd.mode === "random") {
            const fakeCq = {
              id: null,
              message: { chat: message.chat, message_id: null }
            };
            await handleGenreSelection(env, fakeCq, quickBrowseCmd.typeCode, quickBrowseCmd.genreId);
          } else {
            const targetType = quickBrowseCmd.explicitType === "s" ? "s" : "m";
            await showGenreBrowseList(env, chatId, targetType, quickBrowseCmd.genreId || "all", quickBrowseCmd.mode, 1, null);
          }
          return;
        }

        // /random Befehl oder "Serie Drama" / "Film Fantasie"
        const randomCmd = parseRandomOrGenreCommand(text);
        if (randomCmd) {
          await deleteMessage(chatId, message.message_id);
          const fakeCq = {
            id: null,
            message: { chat: message.chat, message_id: null }
          };
          await handleGenreSelection(env, fakeCq, randomCmd.typeCode, randomCmd.genreId);
          return;
        }

        if (text.startsWith("/filter")) {
          await deleteMessage(chatId, message.message_id);
          await showSettingsOverview(env, chatId);
          return;
        }

        const settings = await getUserSettings(env, chatId);
        const searchLoadingRows = [
          ...buildQuickFilterRows(settings, "search"),
          [
            { text: "🔄 Neu starten", callback_data: "retry_last_search" },
            { text: "❌ Abbrechen", callback_data: "main_menu" }
          ]
        ];
        if (isGroupOrChannelChat(chatId)) {
          searchLoadingRows.push([{ text: "✖️ Vorgang beenden", callback_data: "close_bot_msg" }]);
        }
        const searchLoadingKeyboard = { inline_keyboard: searchLoadingRows };

        if (text.startsWith("/search")) {
          await deleteMessage(chatId, message.message_id);
          await clearAllTempMessages(env, chatId, deleteMessage);
          const queryText = text.replace(/^\/search(?:@\w+)?/i, "").trim().slice(0, 150);
          if (queryText.length > 0) {
            trackStat("searchQueries", queryText);
            await saveSearchState(env, chatId, queryText, 1, "pop_desc", false);
            const waitMsg = await sendMessage(
              chatId,
              `🔍 *SUCHE LÄUFT*\n${SEP}\n⚡ Begriff: *"${escapeMd(queryText)}"*`,
              { reply_markup: searchLoadingKeyboard }
            );
            const waitMsgId = waitMsg && waitMsg.result ? waitMsg.result.message_id : null;
            await displaySearchResults(env, chatId, queryText, 1, waitMsgId, "pop_desc", false);
          } else {
            const sent = await sendMessage(chatId, `🔍 *TITEL SUCHEN*\n${SEP}\nSchreibe den gesuchten Film, die Serie oder Person in den Chat:`, {
              reply_markup: {
                inline_keyboard: [buildFooterRow(chatId, true)]
              }
            });
            if (sent && sent.result) {
              await setUserPromptState(env, chatId, sent.result.message_id, "search");
            }
          }
          return;
        }

        // Freitext als Direktsuche behandeln (Vorherige Menüs & eigene Sucheingabe löschen, gespeicherte Karten bleiben erhalten!)
        if (!text.startsWith("/")) {
          await deleteMessage(chatId, message.message_id);
          await clearAllTempMessages(env, chatId, deleteMessage);
          const cleanQuery = text.slice(0, 150);
          trackStat("searchQueries", cleanQuery);
          await saveSearchState(env, chatId, cleanQuery, 1, "pop_desc", false);
          const waitMsg = await sendMessage(
            chatId,
            `🔍 *SUCHE LÄUFT*\n${SEP}\n⚡ Begriff: *"${escapeMd(cleanQuery)}"*`,
            { reply_markup: searchLoadingKeyboard }
          );
          const waitMsgId = waitMsg && waitMsg.result ? waitMsg.result.message_id : null;
          await displaySearchResults(env, chatId, cleanQuery, 1, waitMsgId, "pop_desc", false);
          return;
        }

      // 2. Eingehende Callback Queries (Button Klicks)
      } else if (update.callback_query) {
        const cq = update.callback_query;
        if (cq.message?.chat) registerChatType(cq.message.chat);
        const chatId = cq.message?.chat?.id;
        const msgId = cq.message?.message_id;
        const inlineMsgId = cq.inline_message_id;
        const data = cq.data || "";

        // Prüfe anhand des Bot-Nachrichten-Zeitstempels (edit_date || date), ob die Genre-Übersicht >= 60s ohne Auswahl offen war
        if (chatId && data !== "main_menu" && data !== "nav_back_step" && data !== "close_bot_msg") {
          const genreTimeout = getGenreMenuTimeoutFromBotMessage(cq);
          if (genreTimeout) {
            await answerCallbackQuery(cq.id, `🎲 >60s ohne Auswahl (${genreTimeout.elapsedSec}s) – Zufalls-Tipp wird geöffnet!`);
            await handleGenreSelection(env, cq, genreTimeout.typeCode, genreTimeout.genreId);
            return;
          }
        }

        // ======================================================================
        // GRUPPEN-AUTORISIERUNG:
        // In Gruppen darf der Bot NUR von dem gesteuert werden, der den Befehl
        // eingegeben hat (sessionOwnerId) ODER von einem Gruppen-Admin!
        // ======================================================================
        if (chatId && isGroupOrChannelChat(chatId) && cq.from?.id) {
          const sess = await getUserSession(env, chatId);
          const ownerId = sess.sessionOwnerId || memoryFallback.get(`group_owner_${chatId}`);
          const clickerId = cq.from.id;

          if (ownerId && String(clickerId) !== String(ownerId)) {
            const member = await getChatMember(chatId, clickerId);
            const isGroupAdmin = member && (member.status === "creator" || member.status === "administrator");
            if (!isGroupAdmin) {
              await answerCallbackQuery(
                cq.id,
                "⛔ Nur wer den Befehl gestartet hat oder ein Gruppen-Admin darf den Bot steuern!",
                true
              );
              return;
            }
          } else if (!ownerId) {
            sess.sessionOwnerId = clickerId;
            sess._dirty = true;
            memoryFallback.set(`group_owner_${chatId}`, clickerId);
          }
        }

        // Prozess beenden (für Gruppen & Kanäle)
        if (data === "close_bot_msg") {
          await answerCallbackQuery(cq.id, "✅ Vorgang beendet & Nachricht geschlossen.");
          if (chatId) {
            await clearOriginSession(env, chatId);
            await clearExtraMessage(env, chatId, deleteMessage);
            await clearActiveMenu(env, chatId);
            await clearUserPromptState(env, chatId);
            if (msgId) await deleteMessage(chatId, msgId);
          } else if (inlineMsgId) {
            await editInlineMessageText(inlineMsgId, "_✖️ Ansicht wurde beendet._", {
              reply_markup: { inline_keyboard: [] }
            });
          }
          return;
        }

        if (!chatId) {
          await answerCallbackQuery(cq.id);
          return;
        }

        // @ANCHOR: CALLBACK_ROUTER
        if (data === "wl_noop" || data === "noop") {
          await answerCallbackQuery(cq.id);
          return;
        }

        // --- SMART PLAYLIST CALLBACKS (Einschalten, Ausschalten, Umbenennen, Löschen) ---
        if (data.startsWith("pltog_")) {
          const folderId = data.replace("pltog_", "");
          const res = await togglePlaylistFolderEnabled(env, chatId, folderId);
          await flushUserSession(env, chatId);
          await answerCallbackQuery(
            cq.id,
            res.ok
              ? (res.enabled ? `🟢 Playlist "${res.folder.name}" EINGESCHALTET!` : `⚪ Playlist "${res.folder.name}" AUSGESCHALTET!`)
              : "⚠️ Playlist nicht gefunden.",
            true
          );
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data.startsWith("plren_")) {
          const folderId = data.replace("plren_", "");
          await answerCallbackQuery(cq.id, "✏️ Schreibe den neuen Playlist-Namen in den Chat.");
          await showFolderRenamePrompt(env, chatId, folderId, false, msgId);
          return;
        }

        if (data.startsWith("pldel_")) {
          const folderId = data.replace("pldel_", "");
          await answerCallbackQuery(cq.id);
          await promptFolderDeleteConfirm(env, chatId, folderId, msgId);
          return;
        }

        // --- D1 IMPORT-QUEUE BATCH CALLBACKS (für große JSON- & Telegram Chat-Backups) ---
        if (data === "impq_step_1" || data === "impq_step_3") {
          const rounds = data === "impq_step_3" ? 3 : 1;
          await answerCallbackQuery(cq.id, `⏳ Verarbeite nächsten Batch (${rounds * 12} Einträge)...`);
          await processNextD1QueueStepAndEditMessage(env, chatId, msgId, rounds);
          return;
        }

        if (data === "impq_clear") {
          await clearImportQueueInD1(env);
          await answerCallbackQuery(cq.id, "🗑️ Import-Warteschlange geleert!", true);
          await editMessageText(
            chatId,
            msgId,
            `🗑️ *IMPORT-WARTESCHLANGE GELEERT*\n${SEP}\nAlle verbleibenden Einträge in der Queue wurden entfernt.`,
            { reply_markup: { inline_keyboard: [buildFooterRow(chatId, true)] } }
          );
          return;
        }

        if (data === "bot_info") {
          await answerCallbackQuery(cq.id, "ℹ️ Öffne Bot-Info & Hilfe...");
          if (msgId && cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showBotInfoPost(env, chatId, null);
          } else {
            await showBotInfoPost(env, chatId, msgId);
          }
          return;
        }

        if (data === "info_copy_fallback") {
          await answerCallbackQuery(cq.id, "📋 Text im Nachrichtenkopf antippen zum Kopieren!", false);
          return;
        }

        if (!data.startsWith("ftoglink_")) {
          const promptState = await getUserPromptState(env, chatId);
          if (promptState && promptState.msgId && promptState.msgId !== msgId) {
            await deleteMessage(chatId, promptState.msgId);
            await clearUserPromptState(env, chatId);
          }
        }

        if (!data.startsWith("fdesc_") && !data.startsWith("info_title_") && !data.startsWith("already_saved_") && !data.startsWith("savedinfo_")) {
          await clearExtraMessage(env, chatId, deleteMessage);
        }

        // --- ADMIN PANEL CALLBACKS (/stats xyz) ---
        if (data === "adm_refresh") {
          await answerCallbackQuery(cq.id, "🔄 Statistiken aktualisiert!");
          await showAdminStatsPanel(env, chatId, msgId);
          return;
        }

        if (data === "adm_reset") {
          runtimeStats.tmdbCalls = 0;
          runtimeStats.telegramCalls = 0;
          runtimeStats.translatorCalls = 0;
          runtimeStats.kvReads = 0;
          runtimeStats.kvWrites = 0;
          runtimeStats.d1Reads = 0;
          runtimeStats.d1Writes = 0;
          runtimeStats.d1Hits = 0;
          runtimeStats.searchQueries = 0;
          runtimeStats.randomSearches = 0;
          runtimeStats.similarSearches = 0;
          runtimeStats.lastSearchTerms = [];
          await answerCallbackQuery(cq.id, "🗑️ Alle Tages-Zähler wurden zurückgesetzt!", true);
          await showAdminStatsPanel(env, chatId, msgId);
          return;
        }

        if (data.startsWith("adm_tier_")) {
          const serviceKey = data.replace("adm_tier_", "");
          const currentTiers = await getActiveTiers(env);
          const nextLevel = (currentTiers[serviceKey] || "free") === "free" ? "paid" : "free";
          currentTiers[serviceKey] = nextLevel;
          await saveActiveTiers(env, currentTiers);
          await answerCallbackQuery(cq.id, `✅ ${serviceKey.toUpperCase()} Tier auf ${nextLevel.toUpperCase()} umgestellt!`);
          await showAdminStatsPanel(env, chatId, msgId);
          return;
        }

        if (data === "close_fdesc" || data.startsWith("back_overlay_")) {
          await answerCallbackQuery(cq.id, data.startsWith("back_overlay_") ? "🔙 Zurück zur Detailansicht" : "Geschlossen.");
          await deleteMessage(chatId, msgId);
          await clearExtraMessage(env, chatId, null);
          return;
        }

        // --- FILMREIHEN-BROWSER ("🍿 Filmreihen") CALLBACKS ---
        if (data === "browse_collections") {
          await answerCallbackQuery(cq.id, "🍿 Öffne Filmreihen...");
          if (msgId && cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showCollectionsBrowser(env, chatId, 1, "", null);
          } else {
            await showCollectionsBrowser(env, chatId, 1, "", msgId);
          }
          return;
        }

        if (data.startsWith("bcol_page_") || data.startsWith("colpage_")) {
          const newPage = parseInt(data.replace(/^(?:bcol_page_|colpage_)/, ""), 10) || 1;
          const activeQuery = memoryFallback.get(`bcol_query_${chatId}`) || "";
          await answerCallbackQuery(cq.id);
          await showCollectionsBrowser(env, chatId, newPage, activeQuery, msgId);
          return;
        }

        if (data === "bcol_rand") {
          const pick = FEATURED_COLLECTIONS[Math.floor(Math.random() * FEATURED_COLLECTIONS.length)];
          await answerCallbackQuery(cq.id, `🎲 Zufällige Reihe: ${pick.name}`);
          await showCollectionDetails(env, chatId, pick.id, "m", "", msgId);
          return;
        }

        if (data === "bcol_search") {
          await answerCallbackQuery(cq.id);
          await editMessageText(chatId, msgId, `🍿 *FILMREIHE SUCHEN*\n${SEP}\nSchreibe den Namen der Filmreihe in den Chat (z.B. _Star Wars_, _Rocky_, _X-Men_):`, {
            reply_markup: {
              inline_keyboard: [[{ text: "❌ Abbrechen", callback_data: "browse_collections" }]]
            }
          });
          await setUserPromptState(env, chatId, msgId, "bcol_search");
          return;
        }

        // --- FILMUNIVERSEN-BROWSER ("🌌 Filmuniversen") CALLBACKS ---
        if (data === "browse_universes") {
          await answerCallbackQuery(cq.id, "🌌 Öffne Filmuniversen...");
          if (msgId && cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showUniversesBrowser(env, chatId, 1, null);
          } else {
            await showUniversesBrowser(env, chatId, 1, msgId);
          }
          return;
        }

        if (data.startsWith("buni_page_") || data.startsWith("unipage_")) {
          const newPage = parseInt(data.replace(/^(?:buni_page_|unipage_)/, ""), 10) || 1;
          await answerCallbackQuery(cq.id);
          await showUniversesBrowser(env, chatId, newPage, msgId);
          return;
        }

        if (data === "buni_rand") {
          const pick = CINEMATIC_UNIVERSES[Math.floor(Math.random() * CINEMATIC_UNIVERSES.length)];
          await answerCallbackQuery(cq.id, `🎲 Zufälliges Universum: ${pick.name}`);
          await showUniverseDetails(env, chatId, pick.id, 1, msgId);
          return;
        }

        if (data.startsWith("uni_")) {
          const parts = data.split("_");
          const universeId = parts[1];
          const pageNum = parseInt(parts[2], 10) || 1;
          await answerCallbackQuery(cq.id, "🌌 Lade Filmuniversum...");
          if (msgId && cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showUniverseDetails(env, chatId, universeId, pageNum, null);
          } else {
            await showUniverseDetails(env, chatId, universeId, pageNum, msgId);
          }
          return;
        }

        // Sortierung im Filmuniversum: usort_UNIID_PAGE_SORT (Erneutes Tippen kehrt Sortierreihenfolge um)
        if (data.startsWith("usort_")) {
          const parts = data.split("_");
          const universeId = parts[1];
          const pageNum = parseInt(parts[2], 10) || 1;
          const sortAction = parts[3];
          const sortKey = `uni_sort_${chatId}_${universeId}`;
          const prevSort = memoryFallback.get(sortKey) || "year_asc";
          const { nextSort, label } = resolveNextSort(prevSort, sortAction);
          await answerCallbackQuery(cq.id, label);
          await showUniverseDetails(env, chatId, universeId, pageNum, msgId, nextSort);
          return;
        }

        // Filter im Filmuniversum: ufilt_...
        if (data.startsWith("ufilt_tog_")) {
          const uniId = data.replace("ufilt_tog_", "");
          const settings = await getUserSettings(env, chatId);
          settings.filtersActive = !(settings.filtersActive !== false);
          await saveUserSettings(env, chatId, settings);
          await answerCallbackQuery(cq.id, settings.filtersActive ? "🟢 Universum-Filter AKTIV!" : "🔴 Universum-Filter AUS!");
          await showUniverseDetails(env, chatId, uniId, 1, msgId);
          return;
        }
        if (data.startsWith("ufilt_fsk_") || data.startsWith("ufilt_gen_") || data.startsWith("ufilt_era_")) {
          const parts = data.split("_");
          const kind = parts[1];
          const uniId = parts.slice(2).join("_");
          memoryFallback.set(`active_list_ctx_${chatId}`, { type: "uni", id: uniId });
          await answerCallbackQuery(cq.id);
          if (kind === "fsk") await showFskDashboard(env, chatId, msgId, false);
          else if (kind === "gen") await showGenreDashboard(env, chatId, msgId, false);
          else await showEraDashboard(env, chatId, msgId, false);
          return;
        }

        // Filmreihe im Bot abrufen: col_COLLECTIONID_TYPE_ITEMID
        if (data.startsWith("col_")) {
          const parts = data.split("_");
          const collectionId = parts[1];
          const originType = parts[2] || "m";
          const originId = parts[3] || "";
          await answerCallbackQuery(cq.id, "🍿 Lade Filmreihe...");
          if (msgId && cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showCollectionDetails(env, chatId, collectionId, originType, originId, null);
          } else {
            await showCollectionDetails(env, chatId, collectionId, originType, originId, msgId);
          }
          return;
        }

        // Sortierung in einer Filmreihe: csort_COLID_SORT (Erneutes Tippen kehrt Sortierreihenfolge um)
        if (data.startsWith("csort_")) {
          const parts = data.split("_");
          const colId = parts[1];
          const sortAction = parts[2];
          const sortKey = `col_sort_${chatId}_${colId}`;
          const prevSort = memoryFallback.get(sortKey) || "year_asc";
          const { nextSort, label } = resolveNextSort(prevSort, sortAction);
          await answerCallbackQuery(cq.id, label);
          await showCollectionDetails(env, chatId, colId, "m", "", msgId, nextSort);
          return;
        }

        // Filter-Buttons innerhalb einer Filmreihe: cfilt_...
        if (data.startsWith("cfilt_tog_")) {
          const colId = data.replace("cfilt_tog_", "");
          const settings = await getUserSettings(env, chatId);
          settings.filtersActive = !(settings.filtersActive !== false);
          await saveUserSettings(env, chatId, settings);
          await answerCallbackQuery(cq.id, settings.filtersActive ? "🟢 Kollektions-Filter AKTIV!" : "🔴 Kollektions-Filter AUS!");
          await showCollectionDetails(env, chatId, colId, "m", "", msgId);
          return;
        }
        if (data.startsWith("cfilt_fsk_")) {
          const colId = data.replace("cfilt_fsk_", "");
          memoryFallback.set(`active_col_${chatId}`, colId);
          memoryFallback.set(`active_list_ctx_${chatId}`, { type: "col", id: colId });
          await answerCallbackQuery(cq.id);
          await showFskDashboard(env, chatId, msgId, false);
          return;
        }
        if (data.startsWith("cfilt_gen_")) {
          const colId = data.replace("cfilt_gen_", "");
          memoryFallback.set(`active_col_${chatId}`, colId);
          memoryFallback.set(`active_list_ctx_${chatId}`, { type: "col", id: colId });
          await answerCallbackQuery(cq.id);
          await showGenreDashboard(env, chatId, msgId, false);
          return;
        }
        if (data.startsWith("cfilt_era_")) {
          const colId = data.replace("cfilt_era_", "");
          memoryFallback.set(`active_col_${chatId}`, colId);
          memoryFallback.set(`active_list_ctx_${chatId}`, { type: "col", id: colId });
          await answerCallbackQuery(cq.id);
          await showEraDashboard(env, chatId, msgId, false);
          return;
        }

        // Person Auswahlmenü: per_PERSONID_TYPE_ITEMID
        if (data.startsWith("per_")) {
          const parts = data.split("_");
          const personId = parts[1];
          const originType = parts[2] || "m";
          const originId = parts[3] || "";
          await answerCallbackQuery(cq.id);
          if (msgId && cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showPersonActionMenu(env, chatId, personId, originType, originId, null);
          } else {
            await showPersonActionMenu(env, chatId, personId, originType, originId, msgId);
          }
          return;
        }

        // Genre-Zwischenmenü aus der Haupt-Genre-Übersicht ("🎬 Filme" / "📺 Serien"): gsel_TYPE_GENREID
        if (data.startsWith("gsel_")) {
          const parts = data.split("_");
          const typeCode = parts[1] || "m";
          const genreId = parts[2] || "28";
          await answerCallbackQuery(cq.id);
          await showGenreActionMenu(env, chatId, genreId, typeCode, "", msgId);
          return;
        }

        // Genre Auswahlmenü: gen_GENREID_TYPE_ITEMID
        if (data.startsWith("gen_")) {
          const parts = data.split("_");
          const genreId = parts[1];
          const originType = parts[2] || "m";
          const originId = parts[3] || "";
          await answerCallbackQuery(cq.id);
          if (msgId && cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showGenreActionMenu(env, chatId, genreId, originType, originId, null);
          } else {
            await showGenreActionMenu(env, chatId, genreId, originType, originId, msgId);
          }
          return;
        }

        // Genre Browse ("🆕 Neueste", "🌟 Beliebt", "🔥 Trending", "🏆 Top Bewertet", "💎 Geheimtipps"): gbrowse_TYPE_GENREID_MODE_PAGE
        if (data.startsWith("gbrowse_")) {
          const parts = data.split("_");
          const typeCode = parts[1] || "m";
          const genreId = parts[2] || "all";
          const mode = parts[3] || "trend";
          const pageNum = parseInt(parts[4], 10) || 1;
          const prevCtx = memoryFallback.get(`active_list_ctx_${chatId}`);
          const sortKey = `gbr_sort_${chatId}_${typeCode}_${genreId}_${mode}`;
          const defaultSort = mode === "new" ? "year_desc" : (mode === "top" || mode === "gems") ? "rating_desc" : "pop_desc";
          const prevSort = memoryFallback.get(sortKey) || defaultSort;
          let nextSortOverride = null;

          // Wenn derselbe Tab (z.B. 💎 Geheimtipps, 🆕 Neueste, 🌟 Beliebt) noch einmal angetippt wird -> Sortierreihenfolge umkehren!
          if (prevCtx && prevCtx.type === "gbr" && prevCtx.id === `${typeCode}_${genreId}_${mode}_${pageNum}`) {
            const inverted = invertSortDirection(prevSort);
            nextSortOverride = inverted.nextSort;
            await answerCallbackQuery(cq.id, `🔄 Sortierung umgekehrt (${inverted.arrow})`);
          } else {
            await answerCallbackQuery(cq.id, "🎬 Lade Entdecker-Liste...");
          }
          await showGenreBrowseList(env, chatId, typeCode, genreId, mode, pageNum, msgId, nextSortOverride);
          return;
        }

        // Sortierung in Genre-Browse-Listen: gsort_TYPE_GENREID_MODE_PAGE_SORT (Erneutes Tippen kehrt Sortierreihenfolge um)
        if (data.startsWith("gsort_")) {
          const parts = data.split("_");
          const typeCode = parts[1] || "m";
          const genreId = parts[2] || "all";
          const mode = parts[3] || "trend";
          const pageNum = parseInt(parts[4], 10) || 1;
          const sortAction = parts[5];
          const sortKey = `gbr_sort_${chatId}_${typeCode}_${genreId}_${mode}`;
          const defaultSort = mode === "new" ? "year_desc" : (mode === "top" || mode === "gems") ? "rating_desc" : "pop_desc";
          const prevSort = memoryFallback.get(sortKey) || defaultSort;
          const { nextSort, label } = resolveNextSort(prevSort, sortAction);
          await answerCallbackQuery(cq.id, label);
          await showGenreBrowseList(env, chatId, typeCode, genreId, mode, pageNum, msgId, nextSort);
          return;
        }

        // Filter in Genre-Browse-Listen: gfilt_...
        if (data.startsWith("gfilt_tog_")) {
          const ctxKey = data.replace("gfilt_tog_", "");
          const [typeCode, genreId, mode, pageStr] = ctxKey.split("_");
          const settings = await getUserSettings(env, chatId);
          settings.filtersActive = !(settings.filtersActive !== false);
          await saveUserSettings(env, chatId, settings);
          await answerCallbackQuery(cq.id, settings.filtersActive ? "🟢 Genre-Filter AKTIV!" : "🔴 Genre-Filter AUS!");
          await showGenreBrowseList(env, chatId, typeCode || "m", genreId || "all", mode || "trend", parseInt(pageStr, 10) || 1, msgId);
          return;
        }
        if (data.startsWith("gfilt_fsk_") || data.startsWith("gfilt_gen_") || data.startsWith("gfilt_era_")) {
          const parts = data.split("_");
          const kind = parts[1];
          const ctxKey = parts.slice(2).join("_");
          memoryFallback.set(`active_list_ctx_${chatId}`, { type: "gbr", id: ctxKey });
          await answerCallbackQuery(cq.id);
          if (kind === "fsk") await showFskDashboard(env, chatId, msgId, false);
          else if (kind === "gen") await showGenreDashboard(env, chatId, msgId, false);
          else await showEraDashboard(env, chatId, msgId, false);
          return;
        }

        // --- JAHRES-MENÜ & JAHRES-ENTDECKER-LISTEN (Klick auf Jahr in der Detailansicht) ---
        if (data.startsWith("ya_")) {
          const parts = data.split("_");
          const typeCode = parts[1] || "m";
          const year = parts[2] || "2024";
          const originId = parts[3] || "";
          await answerCallbackQuery(cq.id);
          if (msgId && cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showYearActionMenu(env, chatId, year, typeCode, originId, null);
          } else {
            await showYearActionMenu(env, chatId, year, typeCode, originId, msgId);
          }
          return;
        }

        if (data.startsWith("ybrowse_")) {
          const parts = data.split("_");
          const typeCode = parts[1] || "m";
          const year = parts[2] || "2024";
          const mode = parts[3] || "pop";
          const pageNum = parseInt(parts[4], 10) || 1;
          const originId = parts[5] || "";
          const prevCtx = memoryFallback.get(`active_list_ctx_${chatId}`);
          const sortKey = `ybr_sort_${chatId}_${typeCode}_${year}_${mode}`;
          const defaultSort = (mode === "top" || mode === "gems") ? "rating_desc" : "pop_desc";
          const prevSort = memoryFallback.get(sortKey) || defaultSort;
          let nextSortOverride = null;

          if (prevCtx && prevCtx.type === "ybr" && prevCtx.id === `${typeCode}_${year}_${mode}_${pageNum}_${originId}`) {
            const inverted = invertSortDirection(prevSort);
            nextSortOverride = inverted.nextSort;
            await answerCallbackQuery(cq.id, `🔄 Sortierung umgekehrt (${inverted.arrow})`);
          } else {
            await answerCallbackQuery(cq.id, `📅 Lade Jahrgang ${year}...`);
          }
          await showYearBrowseList(env, chatId, typeCode, year, mode, pageNum, originId, msgId, nextSortOverride);
          return;
        }

        if (data.startsWith("ysort_")) {
          const parts = data.split("_");
          const typeCode = parts[1] || "m";
          const year = parts[2] || "2024";
          const mode = parts[3] || "pop";
          const pageNum = parseInt(parts[4], 10) || 1;
          const sortAction = parts[5];
          const originId = parts[6] || "";
          const sortKey = `ybr_sort_${chatId}_${typeCode}_${year}_${mode}`;
          const defaultSort = (mode === "top" || mode === "gems") ? "rating_desc" : "pop_desc";
          const prevSort = memoryFallback.get(sortKey) || defaultSort;
          const { nextSort, label } = resolveNextSort(prevSort, sortAction);
          await answerCallbackQuery(cq.id, label);
          await showYearBrowseList(env, chatId, typeCode, year, mode, pageNum, originId, msgId, nextSort);
          return;
        }

        if (data.startsWith("yfilt_tog_")) {
          const ctxKey = data.replace("yfilt_tog_", "");
          const [typeCode, year, mode, pageStr, originId] = ctxKey.split("_");
          const settings = await getUserSettings(env, chatId);
          settings.filtersActive = !(settings.filtersActive !== false);
          await saveUserSettings(env, chatId, settings);
          await answerCallbackQuery(cq.id, settings.filtersActive ? "🟢 Jahres-Filter AKTIV!" : "🔴 Jahres-Filter AUS!");
          await showYearBrowseList(env, chatId, typeCode || "m", year || "2024", mode || "pop", parseInt(pageStr, 10) || 1, originId || "", msgId);
          return;
        }
        if (data.startsWith("yfilt_fsk_") || data.startsWith("yfilt_gen_") || data.startsWith("yfilt_era_")) {
          const parts = data.split("_");
          const kind = parts[1];
          const ctxKey = parts.slice(2).join("_");
          memoryFallback.set(`active_list_ctx_${chatId}`, { type: "ybr", id: ctxKey });
          await answerCallbackQuery(cq.id);
          if (kind === "fsk") await showFskDashboard(env, chatId, msgId, false);
          else if (kind === "gen") await showGenreDashboard(env, chatId, msgId, false);
          else await showEraDashboard(env, chatId, msgId, false);
          return;
        }

        if (data.startsWith("yrand_")) {
          const parts = data.split("_");
          const typeCode = parts[1] || "m";
          const year = parts[2] || "2024";
          await answerCallbackQuery(cq.id, `🎲 Suche Zufalls-Titel aus ${year}...`);
          if (msgId) await deleteMessage(chatId, msgId);
          const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `yrand_${typeCode}_${year}`, `Jahrgang ${year}`);
          const randPage = Math.floor(Math.random() * 3) + 1;
          const pageData = await fetchYearBrowsePage(env, typeCode, year, "pop", randPage);
          const list = pageData?.results || [];
          if (list.length > 0) {
            const pick = list[Math.floor(Math.random() * list.length)];
            await sendItemCard(env, chatId, pick, typeCode, null, null, loadingMsgId, null, null);
          } else {
            if (loadingMsgId) await deleteMessage(chatId, loadingMsgId);
            await showYearActionMenu(env, chatId, year, typeCode, "", null);
          }
          return;
        }

        // --- SERIEN-EPISODENLISTE & FAVORITEN ---
        if (data.startsWith("ep_")) {
          const parts = data.split("_");
          const seriesId = parts[1];
          const seasonNum = parseInt(parts[2], 10) || 1;
          const viewMode = parts[3] || "all";
          const pageNum = parseInt(parts[4], 10) || 1;
          await answerCallbackQuery(cq.id, "📺 Lade Episodenliste...");
          if (msgId && cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showSeriesEpisodes(env, chatId, seriesId, seasonNum, viewMode, pageNum, null);
          } else {
            await showSeriesEpisodes(env, chatId, seriesId, seasonNum, viewMode, pageNum, msgId);
          }
          return;
        }

        if (data.startsWith("epsv_")) {
          const parts = data.split("_");
          const seriesId = parts[1];
          const seasonNum = parseInt(parts[2], 10) || 1;
          const epNum = parseInt(parts[3], 10) || 1;
          const res = await saveEpisodeById(env, chatId, seriesId, seasonNum, epNum);
          await answerCallbackQuery(
            cq.id,
            res.saved ? `⭐ "${res.title}" in deiner Merkliste (Serien) gespeichert!` : `🗑️ "${res.title}" aus den Favoriten entfernt.`
          );
          const listCtx = memoryFallback.get(`active_list_ctx_${chatId}`);
          const viewMode = listCtx?.viewMode || "all";
          const pageNum = listCtx?.page || 1;
          await showSeriesEpisodes(env, chatId, seriesId, seasonNum, viewMode, pageNum, msgId);
          return;
        }

        if (data.startsWith("epall_")) {
          const parts = data.split("_");
          const seriesId = parts[1];
          const seasonNum = parseInt(parts[2], 10) || 1;
          const sDetails = await fetchSeriesDetails(env, seriesId);
          const seasonData = await fetchSeasonDetails(env, seriesId, seasonNum);
          const episodes = seasonData?.episodes || [];
          if (episodes.length > 0) {
            const sTitle = (sDetails?.title || `Serie #${seriesId}`).replace(/\s*\(\d{4}\)$/, "").trim();
            const folders = await getFolders(env, chatId);
            let sFolder = folders.find(f => f.type === "series_show" && (String(f.tmdbRefId) === String(seriesId) || f.name.toLowerCase() === sTitle.toLowerCase()));
            if (!sFolder) {
              sFolder = {
                id: `f_ser_${seriesId}`,
                name: sTitle,
                originalName: sTitle,
                tmdbRefId: seriesId,
                type: "series_show",
                linked: true,
                createdAt: Date.now()
              };
              folders.push(sFolder);
              await saveFolders(env, chatId, folders);
            }
            let list = await getSavedList(env, chatId);
            if (sDetails && !list.some(i => i.contentType === "series" && String(i.tmdbId) === String(seriesId) && i.folderId === sFolder.id)) {
              list.push({
                uid: `s_${seriesId}_${sFolder.id}`,
                tmdbId: seriesId,
                contentType: "series",
                category: "series",
                title: sDetails.title,
                year: sDetails.releaseDate ? sDetails.releaseDate.split("-")[0] : "K. A.",
                fsk: sDetails.fsk || "K. A.",
                genres: sDetails.genres || "Serie",
                folderId: sFolder.id,
                addedAt: Date.now()
              });
            }
            let addedCount = 0;
            for (const ep of episodes) {
              const epNum = ep.episode_number || 1;
              const exists = list.some(
                i => i.contentType === "episode" &&
                    String(i.seriesId) === String(seriesId) &&
                    Number(i.seasonNumber) === Number(seasonNum) &&
                    Number(i.episodeNumber) === Number(epNum)
              );
              if (!exists) {
                const sCode = `S${String(seasonNum).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`;
                const epName = ep.name || `Episode ${epNum}`;
                list.push({
                  uid: `ep_${seriesId}_${seasonNum}_${epNum}_${sFolder.id}`,
                  tmdbId: `ep_${seriesId}_${seasonNum}_${epNum}`,
                  contentType: "episode",
                  category: "series",
                  seriesId: Number(seriesId),
                  seriesTitle: sTitle,
                  seasonNumber: Number(seasonNum),
                  episodeNumber: Number(epNum),
                  episodeName: epName,
                  title: `${sCode} – ${epName}`,
                  year: ep.air_date ? ep.air_date.split("-")[0] : "K. A.",
                  fsk: sDetails?.fsk || "K. A.",
                  genres: sDetails?.genres || "Serie",
                  folderId: sFolder.id,
                  addedAt: Date.now()
                });
                addedCount++;
              }
            }
            await saveRawList(env, chatId, list);
            await answerCallbackQuery(cq.id, `💾 Staffel ${seasonNum} (${addedCount} neue Episoden) unter "${sTitle}" gespeichert!`, true);
          } else {
            await answerCallbackQuery(cq.id, "Keine Episoden gefunden.");
          }
          await showSeriesEpisodes(env, chatId, seriesId, seasonNum, "all", 1, msgId);
          return;
        }

        // Person Filme & Serien im Bot suchen: pcred_PERSONID_PAGE_TYPE_ITEMID
        if (data.startsWith("pcred_")) {
          const parts = data.split("_");
          const personId = parts[1];
          const pageNum = parseInt(parts[2], 10) || 1;
          const originType = parts[3] || "m";
          const originId = parts[4] || "";
          await answerCallbackQuery(cq.id, "🎬 Lade Filmografie...");
          await displayPersonCredits(env, chatId, personId, pageNum, originType, originId, msgId);
          return;
        }

        // Sortierung in Person-Filmografie: psort_PERSONID_PAGE_SORT (Erneutes Tippen kehrt Sortierreihenfolge um)
        if (data.startsWith("psort_")) {
          const parts = data.split("_");
          const personId = parts[1];
          const pageNum = parseInt(parts[2], 10) || 1;
          const sortAction = parts[3];
          const sortKey = `per_sort_${chatId}_${personId}`;
          const prevSort = memoryFallback.get(sortKey) || "pop_desc";
          const { nextSort, label } = resolveNextSort(prevSort, sortAction);
          await answerCallbackQuery(cq.id, label);
          await displayPersonCredits(env, chatId, personId, pageNum, "m", "", msgId, nextSort);
          return;
        }

        // Filter in Person-Filmografie: pfilt_...
        if (data.startsWith("pfilt_tog_")) {
          const perId = data.replace("pfilt_tog_", "");
          const settings = await getUserSettings(env, chatId);
          settings.filtersActive = !(settings.filtersActive !== false);
          await saveUserSettings(env, chatId, settings);
          await answerCallbackQuery(cq.id, settings.filtersActive ? "🟢 Filmografie-Filter AKTIV!" : "🔴 Filmografie-Filter AUS!");
          await displayPersonCredits(env, chatId, perId, 1, "m", "", msgId);
          return;
        }
        if (data.startsWith("pfilt_fsk_") || data.startsWith("pfilt_gen_") || data.startsWith("pfilt_era_")) {
          const parts = data.split("_");
          const kind = parts[1];
          const perId = parts.slice(2).join("_");
          memoryFallback.set(`active_list_ctx_${chatId}`, { type: "per", id: perId });
          await answerCallbackQuery(cq.id);
          if (kind === "fsk") await showFskDashboard(env, chatId, msgId, false);
          else if (kind === "gen") await showGenreDashboard(env, chatId, msgId, false);
          else await showEraDashboard(env, chatId, msgId, false);
          return;
        }

        // Einzelnen Film aus einer Kollektion speichern -> Fragen ob als normaler Film oder im Kollektions-Ordner
        if (data.startsWith("csave_") && !data.startsWith("csave_do_col_")) {
          const parts = data.split("_");
          const collectionId = parts[1];
          const movieId = parts[2];
          await answerCallbackQuery(cq.id);
          if (cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await promptCollectionSingleSave(env, chatId, collectionId, movieId, null);
          } else {
            await promptCollectionSingleSave(env, chatId, collectionId, movieId, msgId);
          }
          return;
        }

        if (data.startsWith("csave_do_col_")) {
          const parts = data.split("_");
          const collectionId = parts[3];
          const movieId = parts[4];
          const col = await fetchCollectionDetails(env, collectionId);
          const colName = col?.name || memoryFallback.get(`col_name_${collectionId}`) || "Filmreihe";
          const folder = await findOrCreateSpecialFolder(env, chatId, "collection", collectionId, colName, colName);
          const res = await fetchAndSaveById(env, chatId, "m", movieId, folder.id);
          await answerCallbackQuery(cq.id, `💾 "${res.title}" im Ordner "${folder.name}" gespeichert!`, true);
          await showCollectionDetails(env, chatId, collectionId, "m", movieId, msgId);
          return;
        }

        // Schnell-Speichern: qsave_TYPE_ID
        if (data.startsWith("qsave_")) {
          const parts = data.split("_");
          const typeCode = parts[1];
          const itemId = parts[2];
          await answerCallbackQuery(cq.id);
          await showSaveDestinationMenu(env, chatId, typeCode, itemId, msgId);
          return;
        }

        // ALLE Titel einer Kollektion, eines Universums oder einer Person speichern -> Bestätigung anfordern
        if (data.startsWith("saveall_col_") || data.startsWith("saveall_uni_") || data.startsWith("saveall_per_")) {
          const kind = data.startsWith("saveall_col_")
            ? "col"
            : data.startsWith("saveall_uni_")
              ? "uni"
              : "per";
          const parts = data.split("_");
          const refId = parts[2];
          const originType = parts[3] || "m";
          const originId = parts[4] || "";
          await answerCallbackQuery(cq.id);
          await promptConfirmSaveAll(env, chatId, kind, refId, originType, originId, msgId);
          return;
        }

        // Bestätigtes Speichern aller (sichtbaren/gefilterten!) Titel einer Kollektion, eines Universums oder einer Person
        if (data.startsWith("confirm_saveall_")) {
          const parts = data.split("_");
          const kind = parts[2]; // 'col' | 'uni' | 'per'
          const refId = parts.slice(3).join("_");
          await answerCallbackQuery(cq.id, "💾 Speichere Titel im Ordner...");
          const settings = await getUserSettings(env, chatId);

          if (kind === "col") {
            const col = await fetchCollectionDetails(env, refId);
            if (col && Array.isArray(col.parts)) {
              const sortBy = memoryFallback.get(`col_sort_${chatId}_${refId}`) || "year_asc";
              const { visibleItems, isFiltered } = await filterAndSortMediaList(env, col.parts, settings, sortBy);
              const folderDisplayName = isFiltered ? `${col.name} (Filtered)` : col.name;
              const folder = await findOrCreateSpecialFolder(env, chatId, "collection", col.id, folderDisplayName, col.name);
              let list = await getSavedList(env, chatId);
              for (const part of visibleItems) {
                const yr = (part.release_date || "").split("-")[0] || "K. A.";
                const existsIdx = list.findIndex(
                  i => String(i.tmdbId) === String(part.id) && i.contentType === "movie" && i.folderId === folder.id
                );
                if (existsIdx === -1) {
                  list.push({
                    uid: `m_${part.id}_${folder.id}`,
                    tmdbId: part.id,
                    contentType: "movie",
                    title: part.title || part.name || "Unbekannt",
                    year: yr,
                    fsk: part.fsk || "FSK Keine Angabe",
                    genres: "Filmreihe",
                    folderId: folder.id,
                    addedAt: Date.now()
                  });
                }
              }
              await saveRawList(env, chatId, list);
              await saveWishlistViewState(env, chatId, { currentFolderId: folder.id, page: 1 });
            }
          } else if (kind === "uni") {
            const uni = await fetchUniverseDetails(env, refId);
            if (uni && Array.isArray(uni.parts)) {
              const sortBy = memoryFallback.get(`uni_sort_${chatId}_${refId}`) || "year_asc";
              const { visibleItems, isFiltered } = await filterAndSortMediaList(env, uni.parts, settings, sortBy);
              const folderDisplayName = isFiltered ? `${uni.name} (Filtered)` : uni.name;
              const folder = await findOrCreateSpecialFolder(env, chatId, "universe", uni.id, folderDisplayName, uni.name);
              let list = await getSavedList(env, chatId);
              for (const part of visibleItems) {
                const yr = (part.release_date || "").split("-")[0] || "K. A.";
                const existsIdx = list.findIndex(
                  i => String(i.tmdbId) === String(part.id) && i.contentType === "movie" && i.folderId === folder.id
                );
                if (existsIdx === -1) {
                  list.push({
                    uid: `m_${part.id}_${folder.id}`,
                    tmdbId: part.id,
                    contentType: "movie",
                    title: part.title || part.name || "Unbekannt",
                    year: yr,
                    fsk: part.fsk || "FSK Keine Angabe",
                    genres: uni.name,
                    folderId: folder.id,
                    addedAt: Date.now()
                  });
                }
              }
              await saveRawList(env, chatId, list);
              await saveWishlistViewState(env, chatId, { currentFolderId: folder.id, page: 1 });
            }
          } else {
            const pData = await fetchPersonDetails(env, refId);
            if (pData && Array.isArray(pData.credits)) {
              const sortBy = memoryFallback.get(`per_sort_${chatId}_${refId}`) || "pop_desc";
              const { visibleItems } = await filterAndSortMediaList(env, pData.credits, settings, sortBy);
              const isDir = pData.department === "Directing";
              const targetCatFolder = isDir ? "cat_dir" : "cat_act";
              const targetCategory = isDir ? "director" : "actor";
              let list = await getSavedList(env, chatId);
              for (const cred of visibleItems.slice(0, 25)) {
                const cType = cred.media_type === "tv" ? "series" : "movie";
                const prefix = cType === "series" ? "s" : "m";
                const yr = (cred.release_date || cred.first_air_date || "").split("-")[0] || "K. A.";
                const existsIdx = list.findIndex(
                  i => String(i.tmdbId) === String(cred.id) && i.contentType === cType && i.folderId === targetCatFolder
                );
                if (existsIdx === -1) {
                  list.push({
                    uid: `${prefix}_${cred.id}_${targetCatFolder}`,
                    tmdbId: cred.id,
                    contentType: cType,
                    category: targetCategory,
                    personName: pData.name,
                    title: cred.title || cred.name || "Unbekannt",
                    year: yr,
                    fsk: cred.fsk || "FSK Keine Angabe",
                    genres: pData.name,
                    folderId: targetCatFolder,
                    addedAt: Date.now()
                  });
                }
              }
              await saveRawList(env, chatId, list);
              await saveWishlistViewState(env, chatId, { currentFolderId: targetCatFolder, page: 1 });
            }
          }
          await displaySavedList(env, chatId, msgId);
          return;
        }

        // --- MERKLISTEN & ORDNER CALLBACKS ---
        if (data === "wl_open_root") {
          await answerCallbackQuery(cq.id);
          await saveWishlistViewState(env, chatId, { currentFolderId: "root", searchQuery: "", page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "wl_open_cat_movies") {
          await answerCallbackQuery(cq.id);
          await saveWishlistViewState(env, chatId, { currentFolderId: "cat_movies", searchQuery: "", page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "wl_open_cat_series") {
          await answerCallbackQuery(cq.id);
          await saveWishlistViewState(env, chatId, { currentFolderId: "cat_series", searchQuery: "", page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "wl_open_cat_col") {
          await answerCallbackQuery(cq.id);
          await saveWishlistViewState(env, chatId, { currentFolderId: "cat_col", searchQuery: "", page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "wl_open_cat_uni") {
          await answerCallbackQuery(cq.id);
          await saveWishlistViewState(env, chatId, { currentFolderId: "cat_uni", searchQuery: "", page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "wl_open_cat_act") {
          await answerCallbackQuery(cq.id);
          await saveWishlistViewState(env, chatId, { currentFolderId: "cat_act", searchQuery: "", page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "wl_open_cat_dir") {
          await answerCallbackQuery(cq.id);
          await saveWishlistViewState(env, chatId, { currentFolderId: "cat_dir", searchQuery: "", page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data.startsWith("wl_open_")) {
          const folderId = data.replace("wl_open_", "");
          await answerCallbackQuery(cq.id);
          await saveWishlistViewState(env, chatId, { currentFolderId: folderId, searchQuery: "", page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data.startsWith("delc_")) {
          const uid = data.replace("delc_", "");
          await answerCallbackQuery(cq.id);
          await promptItemDeleteConfirm(env, chatId, uid, msgId);
          return;
        }

        if (data.startsWith("del_confirm_")) {
          const uid = data.replace("del_confirm_", "");
          const listBefore = await getSavedList(env, chatId);
          const targetItem = listBefore.find(i => String(i.uid) === String(uid));
          await removeItemByUid(env, chatId, uid);
          if (targetItem && targetItem.contentType === "series") {
            const wlState = await getWishlistViewState(env, chatId);
            if (wlState.currentFolderId === `f_ser_${targetItem.tmdbId}`) {
              await saveWishlistViewState(env, chatId, { currentFolderId: "cat_series", page: 1 });
            }
            await answerCallbackQuery(cq.id, "🗑️ Serie & zugehörige Episoden aus der Merkliste entfernt!");
          } else {
            await answerCallbackQuery(cq.id, "🗑️ Eintrag aus der Merkliste entfernt!");
          }
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data.startsWith("wl_page_")) {
          const newPage = parseInt(data.replace("wl_page_", ""), 10) || 1;
          await answerCallbackQuery(cq.id);
          await saveWishlistViewState(env, chatId, { page: newPage });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "wl_sort_abc") {
          const st = await getWishlistViewState(env, chatId);
          const nextSort = st.sortBy === "abc_asc" ? "abc_desc" : "abc_asc";
          await answerCallbackQuery(cq.id, nextSort === "abc_asc" ? "🔤 Sortiert: A–Z" : "🔤 Sortiert: Z–A");
          await saveWishlistViewState(env, chatId, { sortBy: nextSort, page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "wl_sort_date") {
          const st = await getWishlistViewState(env, chatId);
          const nextSort = st.sortBy === "added_desc" ? "added_asc" : "added_desc";
          await answerCallbackQuery(cq.id, nextSort === "added_desc" ? "🕒 Sortiert: Neueste zuerst" : "🕒 Sortiert: Älteste zuerst");
          await saveWishlistViewState(env, chatId, { sortBy: nextSort, page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "wl_sort_year") {
          const st = await getWishlistViewState(env, chatId);
          const nextSort = st.sortBy === "year_desc" ? "year_asc" : "year_desc";
          await answerCallbackQuery(cq.id, nextSort === "year_desc" ? "📅 Sortiert: Erscheinungsjahr ▼" : "📅 Sortiert: Erscheinungsjahr ▲");
          await saveWishlistViewState(env, chatId, { sortBy: nextSort, page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "wl_rand") {
          const list = (await getSavedList(env, chatId)).filter(i => i.contentType !== "episode");
          if (!list.length) {
            await answerCallbackQuery(cq.id, "Deine Merkliste ist leer!", true);
            return;
          }
          const pick = list[Math.floor(Math.random() * list.length)];
          await answerCallbackQuery(cq.id, `🎲 Zufalls-Treffer: ${pick.title}`);
          if (msgId) await deleteMessage(chatId, msgId);
          const typeCode = pick.contentType === "series" ? "s" : "m";
          const loadingMsgId = await sendLoadingPlaceholder(env, chatId, "wl_rand", pick.title, `🎲 Zufalls-Titel aus Merkliste: *${escapeMd(pick.title)}*`);
          await sendItemCard(env, chatId, { id: pick.tmdbId }, typeCode, null, cq.id, loadingMsgId, null, "saved");
          return;
        }

        if (data === "wl_search") {
          await answerCallbackQuery(cq.id);
          await editMessageText(chatId, msgId, `🔍 *MERKLISTE DURCHSUCHEN*\n${SEP}\nSchreibe Titel, Jahr oder Genre in den Chat:`, {
            reply_markup: {
              inline_keyboard: [[{ text: "❌ Abbrechen", callback_data: "wl_back" }]]
            }
          });
          await setUserPromptState(env, chatId, msgId, "wl_search");
          return;
        }

        if (data === "wl_clear_search") {
          await answerCallbackQuery(cq.id, "Suchfilter zurückgesetzt.");
          await saveWishlistViewState(env, chatId, { searchQuery: "", page: 1 });
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "wl_new_folder") {
          await answerCallbackQuery(cq.id);
          await editMessageText(chatId, msgId, `➕ *NEUEN ORDNER ERSTELLEN*\n${SEP}\nSchreibe den Ordnernamen in den Chat:`, {
            reply_markup: {
              inline_keyboard: [[{ text: "❌ Abbrechen", callback_data: "wl_back" }]]
            }
          });
          await setUserPromptState(env, chatId, msgId, "new_folder_only");
          return;
        }

        if (data.startsWith("wl_where_")) {
          const uid = data.replace("wl_where_", "");
          await answerCallbackQuery(cq.id);
          await showWishlistWhereToSearchMenu(env, chatId, uid, msgId);
          return;
        }

        if (data.startsWith("fedit_")) {
          const folderId = data.replace("fedit_", "");
          await answerCallbackQuery(cq.id);
          await showFolderRenamePrompt(env, chatId, folderId, false, msgId);
          return;
        }

        if (data.startsWith("ftoglink_")) {
          const parts = data.split("_");
          const unlinkVal = parts[parts.length - 1] === "1";
          const folderId = parts.slice(1, parts.length - 1).join("_");
          await answerCallbackQuery(cq.id, unlinkVal ? "🔗 Verlinkung wird aufgelöst (✅)" : "🔗 Kollektionsverlinkung bleibt erhalten (❌)");
          await showFolderRenamePrompt(env, chatId, folderId, unlinkVal, msgId);
          return;
        }

        if (data.startsWith("fdel_") && !data.startsWith("fdel_confirm_")) {
          const folderId = data.replace("fdel_", "");
          await answerCallbackQuery(cq.id);
          await promptFolderDeleteConfirm(env, chatId, folderId, msgId);
          return;
        }

        if (data.startsWith("fdel_confirm_all_") || data.startsWith("fdel_confirm_keep_")) {
          const keepItems = data.startsWith("fdel_confirm_keep_");
          const folderId = data.replace(/^fdel_confirm_(?:all|keep)_/, "");
          let folders = await getFolders(env, chatId);
          const targetFolder = folders.find(f => f.id === folderId);
          let list = await getSavedList(env, chatId);
          if (keepItems && targetFolder?.type !== "series_show") {
            list = list.map(i => i.folderId === folderId ? { ...i, folderId: i.contentType === "series" ? "cat_series" : "cat_movies" } : i);
          } else {
            const deletedSeriesIds = new Set(
              list
                .filter(i => i.folderId === folderId && i.contentType === "series" && i.tmdbId)
                .map(i => String(i.tmdbId))
            );
            if (targetFolder?.type === "series_show" && targetFolder.tmdbRefId) {
              deletedSeriesIds.add(String(targetFolder.tmdbRefId));
            }
            list = list.filter(i => {
              if (i.folderId === folderId) return false;
              if (i.contentType === "episode" && deletedSeriesIds.has(String(i.seriesId))) return false;
              if (i.contentType === "series" && deletedSeriesIds.has(String(i.tmdbId))) return false;
              return true;
            });
          }
          await saveRawList(env, chatId, list);
          folders = folders.filter(f => f.id !== folderId);
          await saveFolders(env, chatId, folders);
          await cleanupEmptyFolders(env, chatId);
          const nextFolderId = targetFolder?.type === "series_show" ? "cat_series" : "root";
          await saveWishlistViewState(env, chatId, { currentFolderId: nextFolderId, page: 1 });
          await answerCallbackQuery(cq.id, targetFolder?.type === "series_show" ? "🗑️ Serie & Episoden wurden gelöscht!" : "🗑️ Ordner wurde gelöscht!");
          await displaySavedList(env, chatId, msgId);
          return;
        }

        if (data === "retry_last_search") {
          await answerCallbackQuery(cq.id, "🔄 Suche wird neu gestartet...");
          const state = await getSearchState(env, chatId);
          const query = state?.query || extractQueryFromSearchMessage(cq.message?.text);
          if (query) {
            await displaySearchResults(env, chatId, query, state?.page || 1, msgId, state?.sortBy, state?.ignoreFilters);
          } else {
            await deleteMessage(chatId, msgId);
            const sent = await sendMessage(chatId, `🔍 *TITEL SUCHEN*\n${SEP}\nSchreibe den gesuchten Film, die Serie oder Person in den Chat:`, {
              reply_markup: {
                inline_keyboard: [buildFooterRow(chatId, true)]
              }
            });
            if (sent && sent.result) {
              await setUserPromptState(env, chatId, sent.result.message_id, "search");
            }
          }
          return;
        }

        // Filter temporär nur für diese Suche deaktivieren, wenn alle Treffer herausgefiltert wurden
        if (data === "search_temp_nofilter") {
          const state = await getSearchState(env, chatId);
          const query = state?.query || extractQueryFromSearchMessage(cq.message?.text);
          if (!query) {
            await answerCallbackQuery(cq.id, "Bitte starte zuerst eine Suche.");
            return;
          }
          await answerCallbackQuery(cq.id, "🔓 Filter für diese Suche temporär deaktiviert – zeige alle Treffer!");
          await displaySearchResults(env, chatId, query, 1, msgId, state?.sortBy || "pop_desc", true);
          return;
        }

        // Temporär deaktivierte Filter für die aktuelle Suche wieder einschalten
        if (data === "search_reenable_filter") {
          const state = await getSearchState(env, chatId);
          const query = state?.query || extractQueryFromSearchMessage(cq.message?.text);
          if (!query) {
            await answerCallbackQuery(cq.id, "Bitte starte zuerst eine Suche.");
            return;
          }
          await answerCallbackQuery(cq.id, "🔒 Filter wieder aktiviert!");
          await displaySearchResults(env, chatId, query, 1, msgId, state?.sortBy || "pop_desc", false);
          return;
        }

        if (data === "main_menu") {
          await answerCallbackQuery(cq.id);
          await deleteMessage(chatId, msgId);
          await initialMenu(env, chatId, cq.message.chat?.first_name || "Filmfreund");
          return;
        }

        if (data === "trigger_search") {
          await answerCallbackQuery(cq.id);
          await deleteMessage(chatId, msgId);
          const sent = await sendMessage(chatId, `🔍 *TITEL SUCHEN*\n${SEP}\nSchreibe den gesuchten Film, die Serie oder Person in den Chat:`, {
            reply_markup: {
              inline_keyboard: [buildFooterRow(chatId, true)]
            }
          });
          if (sent && sent.result) {
            await setUserPromptState(env, chatId, sent.result.message_id, "search");
          }
          return;
        }

        // Sortierung in den Suchergebnissen: ssort_pop | ssort_rating | ssort_year (Erneutes Tippen kehrt Sortierreihenfolge um)
        if (data.startsWith("ssort_")) {
          const state = await getSearchState(env, chatId);
          const query = state?.query || extractQueryFromSearchMessage(cq.message?.text);
          if (!query) {
            await answerCallbackQuery(cq.id, "Bitte starte zuerst eine Suche.");
            return;
          }
          const sortAction = data.replace("ssort_", "");
          const prevSort = state?.sortBy || "pop_desc";
          const { nextSort, label } = resolveNextSort(prevSort, sortAction);
          await answerCallbackQuery(cq.id, label);
          await displaySearchResults(env, chatId, query, state?.page || 1, msgId, nextSort, state?.ignoreFilters);
          return;
        }

        // Paginierung in den Suchergebnissen: spg_p_X oder spg_n_X
        if (data.startsWith("spg_")) {
          const parts = data.split("_");
          const newPage = parseInt(parts[2], 10) || 1;
          const state = await getSearchState(env, chatId);
          const query = state?.query || extractQueryFromSearchMessage(cq.message?.text);
          await answerCallbackQuery(cq.id);
          if (query) {
            await displaySearchResults(env, chatId, query, newPage, msgId, state?.sortBy, state?.ignoreFilters);
          } else {
            await sendMessage(chatId, "Suchzeit abgelaufen. Bitte neu suchen:", {
              reply_markup: { inline_keyboard: [[{ text: "🔍 Suchen", callback_data: "trigger_search" }]] }
            });
          }
          return;
        }

        // Live-Filterung direkt während der Suche
        if (data === "sfilt_toggle_global") {
          const settings = await getUserSettings(env, chatId);
          settings.filtersActive = !(settings.filtersActive !== false);
          await saveUserSettings(env, chatId, settings);
          await answerCallbackQuery(cq.id, settings.filtersActive ? "🟢 Filter für Suche AKTIVIERT!" : "🔴 Filter für Suche DEAKTIVIERT!");
          const state = await getSearchState(env, chatId);
          const query = state?.query || extractQueryFromSearchMessage(cq.message?.text);
          if (query) {
            await displaySearchResults(env, chatId, query, 1, msgId, state?.sortBy, false);
          } else {
            await showSettingsOverview(env, chatId, msgId, "search");
          }
          return;
        }

        if (data === "sfilt_open_fsk") {
          await answerCallbackQuery(cq.id);
          await showFskDashboard(env, chatId, msgId, true);
          return;
        }

        if (data === "sfilt_open_genre") {
          await answerCallbackQuery(cq.id);
          await showGenreDashboard(env, chatId, msgId, true);
          return;
        }

        if (data === "sfilt_open_era") {
          await answerCallbackQuery(cq.id);
          await showEraDashboard(env, chatId, msgId, true);
          return;
        }

        if (data === "sfilt_open_studio") {
          await answerCallbackQuery(cq.id);
          await showStudioDashboard(env, chatId, msgId, true);
          return;
        }

        if (data === "sfilt_open_platform") {
          await answerCallbackQuery(cq.id);
          await showPlatformDashboard(env, chatId, msgId, true);
          return;
        }

        if (data === "back_to_search") {
          await answerCallbackQuery(cq.id);
          await deleteMessage(chatId, msgId);
          const state = await getSearchState(env, chatId);
          if (state && state.query) {
            await displaySearchResults(env, chatId, state.query, state.page || 1, null, state.sortBy, state.ignoreFilters);
          } else {
            await initialMenu(env, chatId);
          }
          return;
        }

        if (data.startsWith("sdet_")) {
          const parts = data.split("_");
          const typeCode = parts[1];
          const itemId = parts[2];

          let targetName = memoryFallback.get(`title_cache_${typeCode}_${itemId}`) || `Titel #${itemId}`;
          await answerCallbackQuery(cq.id);
          await deleteMessage(chatId, msgId);
          const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sdet_${typeCode}_${itemId}`, targetName);

          const mockItem = { id: itemId };
          const hasOrigin = memoryFallback.has(`card_origin_${chatId}_${typeCode}_${itemId}`);
          await sendItemCard(env, chatId, mockItem, typeCode, null, cq.id, loadingMsgId, null, hasOrigin ? "keep_origin" : "search");
          return;
        }

        if (data === "type_m" || data === "type_s") {
          const typeCode = data === "type_m" ? "m" : "s";
          await answerCallbackQuery(cq.id);
          await showGenres(env, chatId, typeCode, msgId);
          return;
        }

        // Wenn die Merkliste über das Hauptmenü ("💾 Merkliste" / show_saved) geöffnet wird, IMMER den Grundordner ("root") öffnen!
        if (data === "show_saved") {
          await answerCallbackQuery(cq.id);
          await saveWishlistViewState(env, chatId, { currentFolderId: "root", searchQuery: "", page: 1 });
          if (msgId && cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await displaySavedList(env, chatId, null);
          } else {
            await displaySavedList(env, chatId, msgId);
          }
          return;
        }

        // Interner Zurück-Button innerhalb der Merkliste (behält aktuellen Unterordner bei)
        if (data === "wl_back") {
          await answerCallbackQuery(cq.id);
          if (msgId && cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await displaySavedList(env, chatId, null);
          } else {
            await displaySavedList(env, chatId, msgId);
          }
          return;
        }

        if (data === "settings_menu") {
          await answerCallbackQuery(cq.id);
          await showSettingsOverview(env, chatId, msgId);
          return;
        }

        if (data === "toggle_global_filters") {
          const settings = await getUserSettings(env, chatId);
          settings.filtersActive = !(settings.filtersActive !== false);
          await saveUserSettings(env, chatId, settings);
          const statusText = settings.filtersActive ? "🟢 Filter AKTIVIERT!" : "🔴 Filter DEAKTIVIERT!";
          await answerCallbackQuery(cq.id, statusText, true);
          await showSettingsOverview(env, chatId, msgId);
          return;
        }

        if (data === "toggle_unreleased") {
          const settings = await getUserSettings(env, chatId);
          settings.showUnreleased = !Boolean(settings.showUnreleased);
          await saveUserSettings(env, chatId, settings);
          const statusText = settings.showUnreleased
            ? "🗓️ Unveröffentlichte Filme/Serien werden nun ANGEZEIGT!"
            : "🗓️ Unveröffentlichte Filme/Serien werden wieder AUSGEBLENDET!";
          await answerCallbackQuery(cq.id, statusText, true);
          await showSettingsOverview(env, chatId, msgId);
          return;
        }

        if (data === "open_fsk_dash") {
          await answerCallbackQuery(cq.id);
          await showFskDashboard(env, chatId, msgId);
          return;
        }

        if (data === "open_genre_dash") {
          await answerCallbackQuery(cq.id);
          await showGenreDashboard(env, chatId, msgId);
          return;
        }

        if (data === "open_studio_dash") {
          await answerCallbackQuery(cq.id);
          await showStudioDashboard(env, chatId, msgId);
          return;
        }

        if (data === "open_platform_dash") {
          await answerCallbackQuery(cq.id);
          await showPlatformDashboard(env, chatId, msgId);
          return;
        }

        if (data.startsWith("toggle_studio_")) {
          const studioId = data.replace("toggle_studio_", "");
          const settings = await getUserSettings(env, chatId);
          const stObj = STUDIO_OPTIONS.find(s => s.id === studioId);
          const label = stObj ? stObj.label : studioId;
          const nextState = cycleIncludeExcludeSetting(settings, "includedStudios", "excludedStudios", studioId);
          await saveUserSettings(env, chatId, settings);
          const msg = nextState === "included"
            ? `🟢 "${label}" eingeschlossen (Nur diese)!`
            : nextState === "excluded"
              ? `❌ "${label}" ausgeschlossen (Gesperrt)!`
              : `⚪ "${label}" auf neutral gesetzt!`;
          await answerCallbackQuery(cq.id, msg);
          await showStudioDashboard(env, chatId, msgId);
          return;
        }

        if (data.startsWith("toggle_platform_")) {
          const platformId = data.replace("toggle_platform_", "");
          const settings = await getUserSettings(env, chatId);
          const plObj = PLATFORM_OPTIONS.find(p => p.id === platformId);
          const label = plObj ? plObj.label : platformId;
          const nextState = cycleIncludeExcludeSetting(settings, "includedPlatforms", "excludedPlatforms", platformId);
          await saveUserSettings(env, chatId, settings);
          const msg = nextState === "included"
            ? `🟢 "${label}" eingeschlossen (Nur diese)!`
            : nextState === "excluded"
              ? `❌ "${label}" ausgeschlossen (Gesperrt)!`
              : `⚪ "${label}" auf neutral gesetzt!`;
          await answerCallbackQuery(cq.id, msg);
          await showPlatformDashboard(env, chatId, msgId);
          return;
        }

        if (data.startsWith("toggle_fsk_")) {
          const fsk = data.replace("toggle_fsk_", "");
          const settings = await getUserSettings(env, chatId);
          let excluded = settings.excludedFsk || [];

          if (excluded.includes(fsk)) {
            excluded = excluded.filter(item => item !== fsk);
            await answerCallbackQuery(cq.id, `✅ ${formatFskCompact(fsk)} erlaubt!`);
          } else {
            excluded.push(fsk);
            await answerCallbackQuery(cq.id, `❌ ${formatFskCompact(fsk)} gesperrt!`);
          }

          settings.excludedFsk = excluded;
          await saveUserSettings(env, chatId, settings);
          await showFskDashboard(env, chatId, msgId);
          return;
        }

        if (data === "open_era_dash") {
          await answerCallbackQuery(cq.id);
          await showEraDashboard(env, chatId, msgId);
          return;
        }

        if (data.startsWith("toggle_era_")) {
          const eraId = data.replace("toggle_era_", "");
          const settings = await getUserSettings(env, chatId);
          let excluded = settings.excludedEras || [];
          const eraObj = ERA_OPTIONS.find(e => e.id === eraId);
          const label = eraObj ? eraObj.label : eraId;

          if (excluded.includes(eraId)) {
            excluded = excluded.filter(item => item !== eraId);
            await answerCallbackQuery(cq.id, `✅ "${label}" erlaubt!`);
          } else {
            excluded.push(eraId);
            await answerCallbackQuery(cq.id, `❌ "${label}" gesperrt!`);
          }

          settings.excludedEras = excluded;
          await saveUserSettings(env, chatId, settings);
          await showEraDashboard(env, chatId, msgId);
          return;
        }

        if (data.startsWith("toggle_genre_")) {
          const genre = data.replace("toggle_genre_", "");
          const settings = await getUserSettings(env, chatId);
          const nextState = cycleIncludeExcludeSetting(settings, "includedGenres", "excludedGenres", genre);
          await saveUserSettings(env, chatId, settings);
          const msg = nextState === "included"
            ? `🟢 "${genre}" eingeschlossen (Include)!`
            : nextState === "excluded"
              ? `❌ "${genre}" ausgeschlossen (Exclude)!`
              : `⚪ "${genre}" auf neutral gesetzt!`;
          await answerCallbackQuery(cq.id, msg);
          await showGenreDashboard(env, chatId, msgId);
          return;
        }

        if (data.startsWith("sd_")) {
          const uidOrIdx = data.replace("sd_", "");
          const list = await getSavedList(env, chatId);
          const itemObj = list.find(i => String(i.uid) === String(uidOrIdx)) || list[parseInt(uidOrIdx, 10)];
          if (itemObj) {
            if (itemObj.contentType === "episode" && itemObj.seriesId) {
              await answerCallbackQuery(cq.id);
              await showSeriesEpisodes(env, chatId, itemObj.seriesId, itemObj.seasonNumber || 1, "all", 1, msgId);
              return;
            }
            const itemTitle = itemObj.title || "Gespeicherter Titel";
            await answerCallbackQuery(cq.id);
            await deleteMessage(chatId, msgId);
            const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sd_${uidOrIdx}`, itemTitle);

            const typeCode = itemObj.contentType === "series" ? "s" : "m";
            const mockItem = { id: itemObj.tmdbId };
            await sendItemCard(env, chatId, mockItem, typeCode, null, cq.id, loadingMsgId, null, "saved");
          } else {
            await answerCallbackQuery(cq.id, "Eintrag nicht mehr vorhanden.", true);
          }
          return;
        }

        // Wenn ein Film bereits in der Merkliste ist ("💾 In Merkliste" angetippt) -> zeige Speicherort(e), "💾 Merkliste zeigen" & "🗑️ Film löschen"
        if (data.startsWith("savedinfo_")) {
          const parts = data.split("_");
          const typeCode = parts[1] || "m";
          const itemId = parts[2] || "";
          await answerCallbackQuery(cq.id, "💾 Zeige Speicherort(e) in der Merkliste...");
          if (cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showSavedItemLocationsMenu(env, chatId, typeCode, itemId, null);
          } else {
            await showSavedItemLocationsMenu(env, chatId, typeCode, itemId, msgId);
          }
          return;
        }

        // Komplettes Löschen aller Instanzen eines Films aus der Merkliste ("🗑️ Film löschen")
        if (data.startsWith("delallitem_")) {
          const parts = data.split("_");
          const typeCode = parts[1] || "m";
          const itemId = parts[2] || "";
          const contentType = typeCode === "m" ? "movie" : "series";
          await removeAllInstancesOfItem(env, chatId, itemId, contentType);
          await answerCallbackQuery(cq.id, "🗑️ Titel wurde aus der Merkliste entfernt!", true);
          if (msgId) await deleteMessage(chatId, msgId);
          const targetName = memoryFallback.get(`title_cache_${typeCode}_${itemId}`) || `Titel #${itemId}`;
          const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sdet_${typeCode}_${itemId}`, targetName);
          await sendItemCard(env, chatId, { id: itemId }, typeCode, null, null, loadingMsgId, null, "keep_origin");
          return;
        }

        // In weiterem Ordner speichern erzwingen: sc_force_TYPE_ID
        if (data.startsWith("sc_force_")) {
          const parts = data.split("_");
          const typeCode = parts[2] || "m";
          const itemId = parts[3] || "";
          await answerCallbackQuery(cq.id);
          if (cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showSaveDestinationMenu(env, chatId, typeCode, itemId, null);
          } else {
            await showSaveDestinationMenu(env, chatId, typeCode, itemId, msgId);
          }
          return;
        }

        if (data.startsWith("sc_")) {
          const parts = data.split("_");
          const typeCode = parts[1];
          const itemId = parts[2];
          await answerCallbackQuery(cq.id);
          if (cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showSaveDestinationMenu(env, chatId, typeCode, itemId, null);
          } else {
            await showSaveDestinationMenu(env, chatId, typeCode, itemId, msgId);
          }
          return;
        }

        if (data.startsWith("svto_")) {
          const parts = data.split("_");
          const typeCode = parts[1];
          const itemId = parts[2];
          const folderTarget = parts.slice(3).join("_");
          const targetFolderId = folderTarget === "main" ? null : folderTarget;

          const res = await fetchAndSaveById(env, chatId, typeCode, itemId, targetFolderId);
          await answerCallbackQuery(cq.id, `💾 "${res.title}" gespeichert!`, false);
          if (msgId) await deleteMessage(chatId, msgId);
          const loadingMsgId = await sendLoadingPlaceholder(env, chatId, `sdet_${typeCode}_${itemId}`, res.title);
          await sendItemCard(env, chatId, { id: itemId }, typeCode, null, null, loadingMsgId, null, "keep_origin");
          return;
        }

        if (data.startsWith("svnewf_")) {
          const parts = data.split("_");
          const typeCode = parts[1];
          const itemId = parts[2];
          await answerCallbackQuery(cq.id);
          await editMessageText(chatId, msgId, `➕ *NEUEN ORDNER ANLEGEN*\n${SEP}\nSchreibe den Ordnernamen in den Chat:`, {
            reply_markup: {
              inline_keyboard: [[{ text: "❌ Abbrechen", callback_data: `sc_${typeCode}_${itemId}` }]]
            }
          });
          await setUserPromptState(env, chatId, msgId, "new_folder_and_save", { typeCode, itemId });
          return;
        }

        if (data.startsWith("svsearchf_")) {
          const parts = data.split("_");
          const typeCode = parts[1];
          const itemId = parts[2];
          await answerCallbackQuery(cq.id);
          await editMessageText(chatId, msgId, `🔍 *ORDNER SUCHEN*\n${SEP}\nSchreibe einen Teil des Ordnernamens:`, {
            reply_markup: {
              inline_keyboard: [[{ text: "❌ Abbrechen", callback_data: `sc_${typeCode}_${itemId}` }]]
            }
          });
          await setUserPromptState(env, chatId, msgId, "search_folder_for_save", { typeCode, itemId });
          return;
        }

        if (data.startsWith("info_title_")) {
          await answerCallbackQuery(cq.id, "Titel im Text antippen für Optionen! 🎬", false);
          return;
        }

        if (data.startsWith("fdesc_")) {
          const parts = data.split("_");
          const typeCode = parts[1];
          const itemId = parts[2];
          await sendFullDescriptionOverlay(env, chatId, typeCode, itemId, cq.id);
          return;
        }

        // DUAL-SIMILAR-SEARCH:
        // 1) "simanchor_TYPE_ID" -> Sucht weitere Alternativen zum ursprünglichen Anker-Film (z.B. "Der Herr der Ringe")
        if (data.startsWith("simanchor_")) {
          const parts = data.split("_");
          const typeCode = parts[1];
          const anchorId = parts[2];
          await executeSimilarSearch(env, chatId, typeCode, anchorId, true, cq.id, msgId);
          return;
        }

        // 2) "sim_TYPE_ID" -> Sucht Alternativen zum aktuell ausgewählten Film (und setzt diesen als neuen Anker)
        if (data.startsWith("sim_")) {
          const parts = data.split("_");
          const typeCode = parts[1];
          const itemId = parts[2];
          await executeSimilarSearch(env, chatId, typeCode, itemId, false, cq.id, msgId);
          return;
        }

        if (data.startsWith("already_saved_")) {
          const itemId = data.replace("already_saved_", "");
          await answerCallbackQuery(cq.id, "💾 Öffne Speicherort-Übersicht...", false);
          if (cq.message?.photo) {
            await deleteMessage(chatId, msgId);
            await showSavedItemLocationsMenu(env, chatId, "m", itemId, null);
          } else {
            await showSavedItemLocationsMenu(env, chatId, "m", itemId, msgId);
          }
          return;
        }

        if (data.startsWith("g_")) {
          const parts = data.split("_");
          const typeCode = parts[1];
          const genreId = parts.slice(2).join("_");
          await handleGenreSelection(env, cq, typeCode, genreId);
          return;
        }

        if (data.startsWith("kic_")) {
          const parts = data.split("_");
          const typeCode = parts[1] || "m";
          const itemId = parts[2] || "";

          await answerCallbackQuery(cq.id, "💬 Karte bleibt im Chat gespeichert!");
          await clearActiveMenu(env, chatId);
          if (msgId) untrackTempMessage(chatId, msgId);

          const frozenKeyboard = {
            inline_keyboard: [
              [{ text: "🗑️ Aus Chat löschen", callback_data: `cdm_${itemId}` }]
            ]
          };

          await editMessageReplyMarkup(chatId, msgId, frozenKeyboard);
          await initialMenu(env, chatId, cq.message.chat?.first_name || "Filmfreund");
          return;
        }

        if (data.startsWith("cdm_")) {
          const itemId = data.replace("cdm_", "");
          await answerCallbackQuery(cq.id);
          const confirmKeyboard = {
            inline_keyboard: [
              [{ text: "⚠️ Wirklich löschen?", callback_data: "disabled_notice" }],
              [
                { text: "✅ Ja", callback_data: "do_delete_msg" },
                { text: "❌ Nein", callback_data: `can_del_${itemId}` }
              ]
            ]
          };
          await editMessageReplyMarkup(chatId, msgId, confirmKeyboard);
          return;
        }

        if (data === "do_delete_msg") {
          await answerCallbackQuery(cq.id, "🗑️ Nachricht gelöscht!");
          await deleteMessage(chatId, msgId);
          return;
        }

        if (data.startsWith("can_del_")) {
          const itemId = data.replace("can_del_", "");
          await answerCallbackQuery(cq.id, "Löschen abgebrochen.");
          const resetKeyboard = {
            inline_keyboard: [
              [{ text: "🗑️ Aus Chat löschen", callback_data: `cdm_${itemId}` }]
            ]
          };
          await editMessageReplyMarkup(chatId, msgId, resetKeyboard);
          return;
        }

        if (data === "disabled_notice") {
          await answerCallbackQuery(cq.id, "Bitte wähle Ja oder Nein.", false);
          return;
        }

        if (data.startsWith("delete_")) {
          const uidOrIdx = data.replace("delete_", "");
          await removeItemByUid(env, chatId, uidOrIdx);
          await answerCallbackQuery(cq.id, "❌ Titel aus der Merkliste entfernt!");
          await displaySavedList(env, chatId, msgId);
          return;
        }
      }
    } catch (err) {
      console.error("[Telegram Router Error]:", err);
    } finally {
      if (activeSessionChatId) {
        await flushUserSession(env, activeSessionChatId);
      }
    }
  }
