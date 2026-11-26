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

    // Gold-Master Stufe 1: Direkte TMDb-ID aus Steckbrief / Link (nur echte TMDb-IDs < 8.000.000!)
    if (isRealTmdbId(parsed?.tmdbId)) {
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
        if (Number(fbHit.id) >= 8000000 && fbHit.title && hasTmdbCredentials(env)) {
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
        if (!cand.poster && isRealTmdbId(cand.tmdbId) && hasTmdbCredentials(env)) {
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
        const hitSubreqLimit = Boolean(isSubrequestBudgetExhausted() || !hasSubrequestBudget(34));
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
          if (Number(seriesDetails.id) >= 8000000 && hasTmdbCredentials(env) && normalizeCompareString(seriesDetails.title) !== normalizeCompareString(searchTitle)) {
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
                    const gNum = gSeason.season_number != null ? Number(gSeason.season_number) : 1;
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
        const hitSubreqLimit = Boolean(isSubrequestBudgetExhausted() || !hasSubrequestBudget(34));
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
    const speedProfileObj = typeof getWorkerSpeedProfile === "function"
      ? await getWorkerSpeedProfile(env, playlistContext?.speedProfile || null)
      : { id: "free_turbo", wallClockLimitMs: 3600, subrequestGuard: 18, fallbackMode: "smart_emergency" };
    const BATCH_WALL_CLOCK_LIMIT_MS = Math.max(2200, Math.min(8000, Number(speedProfileObj.wallClockLimitMs || 3600)));
    const SUBREQUEST_GUARD_LIMIT = Math.max(10, Math.min(42, Number(speedProfileObj.subrequestGuard || 18)));
    resetSubrequestBudget();

    // MODUL 1.1: Sortiere messages/entries vor dem Loop aufsteigend nach msg.id (überspringe wenn Browser bereits sortiert hat)
    if (!playlistContext?.alreadySorted && Array.isArray(entriesList) && entriesList.length > 1) {
      const hasMsgIds = entriesList.some(e => e && typeof e === "object" && Number(e.msg_id || e.message_id || e.id || 0) > 0);
      if (hasMsgIds) {
        entriesList.sort((a, b) => Number(a?.msg_id || a?.message_id || a?.id || 0) - Number(b?.msg_id || b?.message_id || b?.id || 0));
      }
    }

    if (typeof prefetchBatchMediaFromD1 === "function") {
      await prefetchBatchMediaFromD1(env, entriesList);
    }
    let d1BatchFlushed = false;
    if (typeof beginD1BatchBuffer === "function") {
      beginD1BatchBuffer();
    }
    try {
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
      let midBatchPauseReason = "SUBREQUEST_LIMIT_GUARD";

      // MODUL 1.1 & 6.3: Streng sequenzielle Abarbeitung + Variablen-Hygiene (tmdbId, matchedTitle, parsedItem strikt lokal im Loop!)
      for (let bStep = 0; bStep < batch.length; bStep++) {
        let tmdbId = null;
        let matchedTitle = null;
        let parsedItem = null;
        const stepElapsedWallMs = Date.now() - batchWallStartMs;
        if ((!hasSubrequestBudget(SUBREQUEST_GUARD_LIMIT) || stepElapsedWallMs >= BATCH_WALL_CLOCK_LIMIT_MS) && (i + bStep) > 0) {
          abortedMidBatchDueToBudget = true;
          abortBatchIndex = i + bStep;
          midBatchPauseReason = stepElapsedWallMs >= BATCH_WALL_CLOCK_LIMIT_MS ? "TIME_LIMIT_GUARD" : "SUBREQUEST_LIMIT_GUARD";
          break;
        }
        setSubrequestBudgetExhausted(false);
        setTmdbRateLimitHitInBatch(false);
        let entry = batch[bStep];
        const hasPreResolvedTmdbId = typeof entry === "object" && entry !== null && Boolean(entry.tmdb_id || entry.tmdbId);
        if (!hasPreResolvedTmdbId && typeof tmdbRateLimitUntilMs === "number" && tmdbRateLimitUntilMs > Date.now()) {
          abortedMidBatchDueToBudget = true;
          abortBatchIndex = i + bStep;
          midBatchPauseReason = "TMDB_RATE_LIMIT";
          break;
        }
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
          (stepRes?.abortedDueToSubrequestBudget || isSubrequestBudgetExhausted() || !hasSubrequestBudget(SUBREQUEST_GUARD_LIMIT)) &&
          (i + bStep) > 0
        ) {
          abortedMidBatchDueToBudget = true;
          abortBatchIndex = i + bStep;
          break;
        }
        if (isTmdbRateLimitHitInBatch() && (!stepRes || stepRes.unmatched)) {
          abortedMidBatchDueToBudget = true;
          abortBatchIndex = i + bStep;
          midBatchPauseReason = "TMDB_RATE_LIMIT";
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
        pauseReason = midBatchPauseReason || "SUBREQUEST_LIMIT_GUARD";
        // MODUL 1.2: SUBREQUEST_PAUSE / TMDB_RATE_LIMIT NIEMALS in diagLogsToSave / entries pushen!
        break;
      }

      const currentDone = Math.min(total, i + batchResults.length);
      if (typeof onProgressStep === "function") {
        try {
          await onProgressStep(currentDone, total, moviesAdded.length, seriesAdded.length, failedItems.length, duplicatesCount, mergedQualitiesCount, uncertainCount);
        } catch (e) {}
      }

      if (i + JSON_INGEST_CONCURRENCY < total && getInvocationSubrequests() > 2) {
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
          const mirrorNameKey = `fast_bot_vip_folder_${String(playlistContext.playlistName || "default").toLowerCase().trim()}`;
          let botVipFolder = memoryFallback.get(mirrorNameKey);
          if (!botVipFolder || !botVipFolder.id) {
            botVipFolder = await createOrGetJsonPlaylistFolder(
              env,
              "bot_vip",
              playlistContext.playlistName || "🌟 Bot-VIP-Playlist",
              playlistContext.sourceLabel || "VIP-Import",
              "vip_stream"
            );
            if (botVipFolder && botVipFolder.id) {
              memoryFallback.set(mirrorNameKey, botVipFolder);
            }
          }
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

    // Alle gepufferten D1-Writes des gesamten Batches ZUERST committen, damit neue Episoden vor dem Leere-Serien-Cleanup in D1 liegen!
    if (!d1BatchFlushed && typeof flushD1BatchBuffer === "function") {
      d1BatchFlushed = true;
      await flushD1BatchBuffer(env);
    }

    // Automatische DB-Bereinigung nur am Ende des gesamten Imports (oder bei Einzel-Läufen): Entfernt Serien mit 0 gültigen Episoden-Videos
    if (!partialBatch && (!playlistContext || playlistContext.isFinalBatch !== false)) {
      await cleanupEmptySeriesInD1AndMemory(env).catch(() => null);
    }

    return {
      status: partialBatch ? "PARTIAL_BATCH" : "COMPLETED",
      partialBatch,
      nextStartIndex: partialBatch ? nextStartIndex : total,
      pauseReason,
      subrequestPauseCount,
      subrequestCount: getInvocationSubrequests(),
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
    } finally {
      if (!d1BatchFlushed && typeof flushD1BatchBuffer === "function") {
        d1BatchFlushed = true;
        await flushD1BatchBuffer(env).catch(() => {});
      }
    }
  }

  async function processNextD1QueueStepAndEditMessage(env, chatId, messageId, rounds = 1) {
    const { sendMessage, editMessageText } = tgApi(env);
    const safeRounds = Math.min(Math.max(1, Number(rounds) || 1), 3);
    const batchPerRound = 12;

    for (let r = 0; r < safeRounds; r++) {
      const pendingBatch = await fetchPendingImportBatchFromD1(env, batchPerRound);
      if (pendingBatch.length === 0) break;

      const firstEntryMeta = pendingBatch[0]?.entry?._playlistMeta || null;
      const savedMeta = typeof getImportQueueMetaFromD1 === "function"
        ? await getImportQueueMetaFromD1(env)
        : memoryFallback.get("import_queue_meta");
      const meta = savedMeta || {
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
      if (typeof saveImportQueueMetaInD1 === "function") {
        await saveImportQueueMetaInD1(env, meta);
      } else {
        memoryFallback.set("import_queue_meta", meta);
      }
    }

    const stats = await getImportQueueStatsFromD1(env);
    const metaInfo = (typeof getImportQueueMetaFromD1 === "function" ? await getImportQueueMetaFromD1(env) : null) || memoryFallback.get("import_queue_meta") || {};
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

  // --- STUFE 1 (HIGH-VOLUME 500+): Roh-Nachrichten aus freigeschalteten Gruppen/Kanälen im JSON-Export-Format stagen ---
  function buildStagingPayloadFromTelegramMessage(tgMsg) {
    if (!tgMsg || !tgMsg.chat?.id || !tgMsg.message_id) return { msgKind: "skip", payload: null };
    if (tgMsg.via_bot) return { msgKind: "skip", payload: null };
    if (tgMsg.sticker || tgMsg.animation || tgMsg.voice || tgMsg.video_note || tgMsg.audio || tgMsg.poll || tgMsg.contact || tgMsg.location) {
      return { msgKind: "skip", payload: null };
    }

    let rawText = String(tgMsg.caption || tgMsg.text || "").trim();
    const msgEntities = Array.isArray(tgMsg.caption_entities)
      ? tgMsg.caption_entities
      : (Array.isArray(tgMsg.entities) ? tgMsg.entities : []);
    if (msgEntities.length > 0) {
      const hiddenUrls = [];
      for (const ent of msgEntities) {
        if (ent && ent.type === "text_link" && ent.url && /(?:themoviedb\.org|imdb\.com)/i.test(String(ent.url))) {
          const cleanU = String(ent.url).trim();
          if (cleanU && !rawText.includes(cleanU) && !hiddenUrls.includes(cleanU)) {
            hiddenUrls.push(cleanU);
          }
        }
      }
      if (hiddenUrls.length > 0) {
        rawText = rawText ? `${rawText}\n${hiddenUrls.join("\n")}` : hiddenUrls.join("\n");
      }
    }
    if (/^\/[a-z0-9_]+(?:@\w+)?(?:\s|$)/i.test(rawText) && !tgMsg.video && !tgMsg.document && !tgMsg.photo) {
      return { msgKind: "skip", payload: null };
    }

    const docObj = tgMsg.document || null;
    const docName = String(docObj?.file_name || "").trim();
    const docMime = String(docObj?.mime_type || "").toLowerCase();
    const isVideoDoc = Boolean(docObj && (/^video\//i.test(docMime) || /\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d)$/i.test(docName)));
    const videoObj = tgMsg.video || (isVideoDoc ? docObj : null);
    const isSubDoc = Boolean(!videoObj && docObj && SUBTITLE_EXTENSIONS.test(docName));
    const isArchiveDoc = Boolean(!videoObj && !isSubDoc && docObj && /\.(?:rar|zip|7z|iso|tar|gz)$/i.test(docName));
    const hasPhoto = Boolean(Array.isArray(tgMsg.photo) && tgMsg.photo.length > 0);

    let msgKind = "skip";
    let mediaType = null;
    let fileName = "";
    let mimeType = "";
    let fileSize = null;
    let width = null;
    let height = null;
    let durationSec = null;
    let telegramFileId = null;
    let telegramUniqueId = null;

    if (videoObj) {
      msgKind = "video";
      mediaType = "video_file";
      fileName = String(videoObj.file_name || "").trim();
      mimeType = String(videoObj.mime_type || "video/mp4");
      fileSize = Number(videoObj.file_size || 0) || null;
      width = Number(videoObj.width || 0) || null;
      height = Number(videoObj.height || 0) || null;
      durationSec = Number(videoObj.duration || 0) || null;
      telegramFileId = String(videoObj.file_id || "");
      telegramUniqueId = videoObj.file_unique_id ? String(videoObj.file_unique_id) : null;
    } else if (isSubDoc) {
      msgKind = "subtitle";
      mediaType = "document";
      fileName = docName;
      mimeType = docMime || "application/x-subrip";
      fileSize = Number(docObj.file_size || 0) || null;
      telegramFileId = String(docObj.file_id || "");
      telegramUniqueId = docObj.file_unique_id ? String(docObj.file_unique_id) : null;
    } else if (isArchiveDoc) {
      msgKind = "video";
      mediaType = "document";
      fileName = docName;
      mimeType = docMime || "application/octet-stream";
      fileSize = Number(docObj.file_size || 0) || null;
      telegramFileId = String(docObj.file_id || "");
      telegramUniqueId = docObj.file_unique_id ? String(docObj.file_unique_id) : null;
    } else if (hasPhoto || rawText.length >= 4) {
      // Nur sinnvollen Kontext stagen (Poster-Posts, Titel-Ankündigungen, Staffel-Header, TMDB/IMDb-Links) – kein Chat-Smalltalk!
      const isCasualChatter = !hasPhoto && rawText.length <= 45 && /^(?:danke(?:\s+dir|\s+sch[oö]n)?|vielen\s+dank|thx|ty|ok+|okay|nice|geil|super|top|cool|lol+|haha+|hihi+|bitte|gerne|👍+|🔥+|❤️+|😂+|👌+)[\s!?.]*$/i.test(rawText);
      if (isCasualChatter || (!hasPhoto && !/[a-zA-Z0-9äöüÄÖÜß]{2,}/.test(rawText))) {
        return { msgKind: "skip", payload: null };
      }
      msgKind = "context";
      mediaType = hasPhoto ? "photo" : null;
    } else {
      return { msgKind: "skip", payload: null };
    }

    const rawChannelNum = String(tgMsg.chat.id).replace(/^-100/, "").replace(/^-/, "");
    const messageLink = String(tgMsg.chat.id).startsWith("-100")
      ? `https://t.me/c/${rawChannelNum}/${tgMsg.message_id}`
      : "";

    const payload = {
      id: Number(tgMsg.message_id),
      msg_id: Number(tgMsg.message_id),
      type: "message",
      date_unixtime: String(tgMsg.date || Math.floor(Date.now() / 1000)),
      chat_id: String(tgMsg.chat.id),
      chat_title: String(tgMsg.chat.title || tgMsg.chat.username || "").slice(0, 120),
      text: rawText.slice(0, 1500),
      photo: hasPhoto ? "photo" : undefined,
      media_type: mediaType || undefined,
      file_name: fileName || undefined,
      mime_type: mimeType || undefined,
      file_size: fileSize || undefined,
      width: width || undefined,
      height: height || undefined,
      duration_seconds: durationSec || undefined,
      reply_to_message_id: tgMsg.reply_to_message?.message_id ? Number(tgMsg.reply_to_message.message_id) : undefined,
      media_group_id: tgMsg.media_group_id ? String(tgMsg.media_group_id) : undefined,
      telegram_file_id: telegramFileId || undefined,
      telegram_unique_id: telegramUniqueId || undefined,
      message_link: messageLink || undefined
    };

    return { msgKind, payload };
  }

  async function stageGroupOrChannelMessageIfEnabled(env, tgMsg) {
    if (!tgMsg || !tgMsg.chat?.id || env._isCustomBotWebhook) {
      return { enabled: false, staged: false };
    }
    const chatId = tgMsg.chat.id;
    // Harte Webhook-Loop-Blacklist: Index-Kanäle & sortiertes Themen-Archiv NIEMALS selbst einspeisen!
    if (typeof isHistorySystemBlockedChat === "function" && await isHistorySystemBlockedChat(env, chatId)) {
      return { enabled: false, staged: false, blockedSystemChat: true };
    }
    const enabled = await isAutoIngestChatEnabled(env, chatId);
    if (!enabled) {
      return { enabled: false, staged: false };
    }
    const built = buildStagingPayloadFromTelegramMessage(tgMsg);
    if (!built.payload || built.msgKind === "skip") {
      return { enabled: true, staged: false, skipped: true };
    }
    const res = await enqueueChannelIngestMessageToD1(env, {
      chatId: String(chatId),
      chatTitle: String(tgMsg.chat.title || tgMsg.chat.username || `Chat ${chatId}`),
      messageId: Number(tgMsg.message_id),
      replyToMessageId: tgMsg.reply_to_message?.message_id || null,
      mediaGroupId: tgMsg.media_group_id || null,
      msgKind: built.msgKind,
      payload: built.payload,
      createdAt: tgMsg.date ? Number(tgMsg.date) * 1000 : Date.now()
    });
    return { enabled: true, staged: Boolean(res?.ok), inserted: Boolean(res?.inserted), msgKind: built.msgKind };
  }

  // ============================================================================
  // SCHRITT 2: STUFE A — HISTORY-PROBE-CRAWLER ENGINE & SOFORT-LÖSCHUNG
  // ============================================================================
  const HISTORY_CHANNEL_MIN_GAP_MS = 4000; // 15 erfolgreiche Forwards/Min je Index-Kanal (25 % Puffer unter Telegrams ~20/Min Limit!)
  const HISTORY_BACKPRESSURE_LIMIT = 120;  // Drosselt Stufe A, wenn > 120 History-Zeilen in der Inbox warten

  // Wandelt eine per forwardMessage gelesene Nachricht mit Rekonstruktion von Original-ID, Original-Datum,
  // versteckten entities-Links und virtueller Album-Gruppierung in das exakt gleiche Inbox-Format um.
  function buildHistoryInboxRecordFromForwardedMsg(tgMsg, { sourceChatId, sourceTitle, probedMessageId, suppressReaction = true, jobId = 0, prevMediaMeta = null } = {}) {
    if (!tgMsg || typeof tgMsg !== "object") {
      return { msgKind: "skip", isNoise: true, record: null, mediaMeta: null };
    }
    const meta = extractForwardedMessageMeta(tgMsg, sourceChatId, probedMessageId);
    if (!meta || meta.isNoiseOnly) {
      return { msgKind: "skip", isNoise: true, record: null, mediaMeta: null };
    }

    // Versteckte Text-Link-URLs (z. B. IMDb/TMDB-Links aus Markdown-Entities) retten, falls nicht im Klartext sichtbar
    const rawCaptionOrText = String(tgMsg.caption || tgMsg.text || "").trim();
    const extraUrls = (meta.entityUrls || []).filter(u => !rawCaptionOrText.includes(u));
    const enrichedText = extraUrls.length > 0
      ? `${rawCaptionOrText}${rawCaptionOrText ? "\n" : ""}${extraUrls.join("\n")}`
      : rawCaptionOrText;

    // Virtuelle media_group_id rekonstruieren (single forwardMessage strippt Telegrams media_group_id!)
    const isMediaCandidate = Boolean(meta.hasVideo || meta.hasDoc || meta.hasPhoto);
    let virtualMediaGroupId = tgMsg.media_group_id ? String(tgMsg.media_group_id) : null;
    if (!virtualMediaGroupId && isMediaCandidate && prevMediaMeta && prevMediaMeta.isMediaCandidate) {
      const isConsecutiveId = Number(probedMessageId) === Number(prevMediaMeta.probedMessageId) + 1;
      const sameOrigTime = Math.abs(Number(meta.originalDateSec) - Number(prevMediaMeta.originalDateSec)) <= 1;
      if (isConsecutiveId && sameOrigTime) {
        virtualMediaGroupId = prevMediaMeta.virtualMediaGroupId || `hist_grp_${sourceChatId}_${prevMediaMeta.originalDateSec}`;
      }
    }

    const normalizedMsg = {
      ...tgMsg,
      chat: { id: String(sourceChatId), title: String(sourceTitle || sourceChatId) },
      message_id: Number(probedMessageId),
      date: Number(meta.originalDateSec),
      media_group_id: virtualMediaGroupId || undefined,
      text: tgMsg.text !== undefined ? enrichedText : undefined,
      caption: tgMsg.caption !== undefined ? enrichedText : (tgMsg.text === undefined && enrichedText ? enrichedText : undefined)
    };

    const built = buildStagingPayloadFromTelegramMessage(normalizedMsg);
    if (!built || !built.payload || built.msgKind === "skip") {
      return { msgKind: "skip", isNoise: true, record: null, mediaMeta: null };
    }

    built.payload._historyJobId = Number(jobId || 0);
    built.payload._suppressReaction = Boolean(suppressReaction);
    built.payload._isVideoDocument = Boolean(!tgMsg.video && tgMsg.document);
    if (extraUrls.length > 0) {
      built.payload.entity_urls = extraUrls;
    }

    const mediaMeta = isMediaCandidate
      ? {
          isMediaCandidate: true,
          probedMessageId: Number(probedMessageId),
          originalDateSec: Number(meta.originalDateSec),
          virtualMediaGroupId: virtualMediaGroupId || `hist_grp_${sourceChatId}_${meta.originalDateSec}`
        }
      : null;

    return {
      msgKind: built.msgKind,
      isNoise: false,
      mediaMeta,
      record: {
        chatId: String(sourceChatId),
        chatTitle: String(sourceTitle || sourceChatId),
        messageId: Number(probedMessageId),
        replyToMessageId: null,
        mediaGroupId: virtualMediaGroupId,
        msgKind: built.msgKind,
        payload: built.payload,
        initialStatus: "staging",
        // Strikte Zeitstempel-Trennung: created_at = Date.now() für applySmartWindowCut, payload.date_unixtime = Originaldatum!
        createdAt: Date.now(),
        suppressReaction: Boolean(suppressReaction),
        sourceJobId: Number(jobId || 0)
      }
    };
  }

  // Crash-Recovery-Cleanup: entfernt offen gebliebene Probe-IDs aus allen Index-Kanälen per 100er-Bulk deleteMessages
  async function flushPendingHistoryProbeDeletes(env, options = {}) {
    const subrequestCeiling = Number(options.subrequestCeiling || 38);
    const channels = await getHistoryIndexChannelsFromD1(env, { role: "probe_index" });
    const dirty = channels.filter(c => c.pendingDeleteCount > 0);
    if (dirty.length === 0) return { ok: true, deleted: 0, remaining: 0 };

    const api = tgApi(env);
    const runtimeUpdates = [];
    let deleted = 0;
    let remaining = 0;

    for (const ch of dirty) {
      if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(subrequestCeiling)) {
        remaining += ch.pendingDeleteCount;
        continue;
      }
      const delRes = await api.deleteMessages(ch.channelId, ch.pendingDeleteIds);
      deleted += Number(delRes.deletedCount || 0);
      const leftIds = Array.isArray(delRes.remainingIds) ? delRes.remainingIds : [];
      remaining += leftIds.length;
      runtimeUpdates.push({
        channelId: ch.channelId,
        nextAllowedAt: ch.nextAllowedAt,
        cooldownUntil: delRes.rateLimited ? Math.max(ch.cooldownUntil, Date.now() + (Number(delRes.retryAfter || 5) + 2) * 1000) : ch.cooldownUntil,
        pendingDeleteIds: leftIds
      });
    }
    if (runtimeUpdates.length > 0) {
      await updateHistoryChannelsRuntimeInD1(env, runtimeUpdates);
    }
    return { ok: remaining === 0, deleted, remaining };
  }

  // Führt genau 1 budget- & rate-limit-gesicherten Stufe-A-Crawl-Step aus (für 2-Min-Cron ODER Browser-Turbo)
  async function runHistoryCrawlStep(env, options = {}) {
    const source = options.source === "browser_turbo"
      ? "browser_turbo"
      : (options.source === "chat_manual" ? "chat_manual" : "cron");
    const now = Date.now();
    const subrequestCeiling = Number(options.subrequestCeiling || (source === "cron" ? 30 : 28));
    const maxHitsPerStep = Math.max(1, Math.min(18, Number(options.maxHitsPerStep || (source === "cron" ? 12 : 15))));
    const maxProbesPerStep = Math.max(maxHitsPerStep, Math.min(24, Number(options.maxProbesPerStep || (source === "cron" ? 18 : 22))));
    const leaseMs = Math.max(20000, Math.min(90000, Number(options.leaseMs || 45000)));

    // 0. Zuerst eventuelle Crash-Recovery-Löschungen in den Index-Kanälen abräumen
    const recoveryRes = await flushPendingHistoryProbeDeletes(env, { subrequestCeiling: subrequestCeiling + 4 });

    // 1. Aktiven oder nächsten geplanten Job laden (max. 1 Job gleichzeitig!)
    const job = await getActiveOrNextQueuedHistoryJobFromD1(env, {
      jobId: options.jobId || 0,
      onlyCronEnabled: source === "cron",
      now
    });
    if (!job) {
      return { ok: true, idle: true, reason: "no_active_job", recoveryDeleted: recoveryRes.deleted };
    }
    if (job.status === "paused" || job.status === "completed" || job.status === "error") {
      return { ok: true, idle: true, reason: `job_${job.status}`, job };
    }
    // Kollisionsschutz: Wenn Browser-Turbo aktiven Lease hält, überlassen Cron & Chat-Manuell Stufe A kampflos dem Browser
    if ((source === "cron" || source === "chat_manual") && job.workerLeaseUntil > now) {
      return { ok: true, skippedByLease: true, waitMs: job.workerLeaseUntil - now, job };
    }
    // Verteilte D1-429-Sperre respektieren
    if (job.floodUntil > now) {
      const waitMs = Math.max(1000, job.floodUntil - now);
      return { ok: true, rateLimited: true, waitMs, retryAfterSec: Math.ceil(waitMs / 1000), job };
    }

    // 2. Aktive Index-Kanäle (1–3) laden
    const probeChannels = await getHistoryIndexChannelsFromD1(env, { role: "probe_index", onlyEnabled: true });
    if (probeChannels.length === 0) {
      const errMsg = "Kein aktiver privater Index-Kanal konfiguriert. Bitte zuerst 1–3 Index-Kanäle im Setup anlegen.";
      await updateHistoryCrawlJobStateInD1(env, job.id, { status: "paused", lastError: errMsg, now });
      const pausedJob = { ...job, status: "paused", lastError: errMsg };
      await maybeNotifyAdminForHistoryJob(env, pausedJob, "error", { reasonCode: "no_probe", errorText: errMsg }).catch(() => {});
      return { ok: false, status: "paused", error: errMsg, job: pausedJob };
    }

    // 3. Backpressure prüfen (D1 nicht mit > 120 unverarbeiteten History-Zeilen fluten!)
    const openHistoryRows = await countOpenHistoryInboxRowsInD1(env, job.sourceChatId);
    if (openHistoryRows >= HISTORY_BACKPRESSURE_LIMIT) {
      if (source === "browser_turbo") {
        await updateHistoryCrawlJobStateInD1(env, job.id, { workerLeaseUntil: now + leaseMs, now });
      }
      return {
        ok: true,
        backpressured: true,
        openHistoryRows,
        waitMs: 3000,
        job
      };
    }

    // 4. Prüfen, welche Index-Kanäle im Token-Bucket jetzt frei sind
    const channelState = probeChannels.map(ch => ({
      ...ch,
      sentInStep: 0,
      newProbeMsgIds: []
    }));
    const freeAtStart = channelState.filter(c => c.nextAllowedAt <= now && c.cooldownUntil <= now);
    if (freeAtStart.length === 0) {
      const soonestReady = Math.min(...channelState.map(c => Math.max(c.nextAllowedAt, c.cooldownUntil)));
      const waitMs = Math.max(1000, soonestReady - now);
      return {
        ok: true,
        pacingWait: true,
        waitMs,
        job
      };
    }

    // Browser-Turbo setzt 45s-Lease-Lock (verhindert Cron-Kollisionen)
    if (source === "browser_turbo") {
      await updateHistoryCrawlJobStateInD1(env, job.id, { workerLeaseUntil: now + leaseMs, status: "running", now });
    }

    // 5. Aktuellen Block-Bereich bestimmen ('asc' oder 'desc' 50er-Block) + D1-Vorab-Skip
    const blockFloor = job.direction === "desc" ? job.chunkFloorId : job.startMsgId;
    const blockCeiling = job.direction === "desc"
      ? computeReverseBlockCeiling(job.startMsgId, job.endMsgId, blockFloor)
      : job.endMsgId;

    let cursor = Math.max(blockFloor, job.currentCursorId);
    let skippedExistingCount = 0;
    const scanWindowEnd = Math.min(blockCeiling, cursor + 80);
    const existingIds = await getExistingInboxMessageIdsInRangeFromD1(env, job.sourceChatId, cursor, scanWindowEnd);

    // Vorab-Skip aller bereits in D1 vorhandenen IDs am Cursor-Anfang (0 Telegram-Calls!)
    while (cursor <= scanWindowEnd && existingIds.has(cursor)) {
      cursor++;
      skippedExistingCount++;
    }

    // Falls der aktuelle Block komplett übersprungen/beendet wurde -> Block-Abschluss direkt verbuchen!
    if (cursor > blockCeiling) {
      const finishedJob = job.direction === "asc" || blockFloor <= job.startMsgId;
      const nextFloor = job.direction === "desc" ? Math.max(job.startMsgId, blockFloor - HISTORY_REVERSE_BLOCK_SIZE) : job.startMsgId;
      const nextCursor = job.direction === "desc" ? nextFloor : cursor;
      const promotedCount = await promoteHistoryStagingRowsToPendingInD1(env, job.id, {
        promoteAll: finishedJob,
        direction: job.direction,
        now
      });
      if (finishedJob && typeof releaseHeldArchiveMirrorItemsForJobInD1 === "function") {
        await releaseHeldArchiveMirrorItemsForJobInD1(env, job.id, now).catch(() => 0);
      }
      await updateHistoryCrawlJobStateInD1(env, job.id, {
        status: finishedJob ? "completed" : "running",
        currentCursorId: finishedJob ? job.endMsgId : nextCursor,
        chunkFloorId: finishedJob ? job.startMsgId : nextFloor,
        incSkippedExisting: skippedExistingCount,
        completedAt: finishedJob ? now : undefined,
        workerLeaseUntil: finishedJob ? 0 : (source === "browser_turbo" ? now + leaseMs : job.workerLeaseUntil),
        now
      });
      const updatedJob = await getHistoryCrawlJobByIdFromD1(env, job.id);
      if (updatedJob) {
        await maybeNotifyAdminForHistoryJob(env, updatedJob, finishedJob ? "completed" : "progress").catch(() => {});
      }
      return {
        ok: true,
        blockCompleted: true,
        jobCompleted: finishedJob,
        skippedExisting: skippedExistingCount,
        promotedToPending: promotedCount,
        waitMs: finishedJob ? 0 : 400,
        job: updatedJob
      };
    }

    // 6. Kontrolliertes paralleles Pool-Probing (1 Call je freiem Index-Kanal pro Mini-Runde)
    const api = tgApi(env);
    const recordsToInsert = [];
    let probesFired = 0;
    let hitsCount = 0;
    let mediaFound = 0;
    let contextFound = 0;
    let missingCount = 0;
    let noiseSkipped = 0;
    let errorCount = 0;
    let hit429RetryAfter = 0;
    let fatalError = "";
    let prevMediaMeta = null;

    // Max. 4–5 Treffer je Index-Kanal in einem Step halten den Burst extrem sanft (exakt 15/Min über next_allowed_at)
    const maxHitsPerChannel = Math.max(3, Math.ceil(maxHitsPerStep / Math.max(1, freeAtStart.length)));

    while (
      cursor <= scanWindowEnd &&
      hitsCount < maxHitsPerStep &&
      probesFired < maxProbesPerStep &&
      !hit429RetryAfter &&
      !fatalError
    ) {
      if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(subrequestCeiling)) {
        break;
      }

      // Skip bereits existierende IDs mitten im Block ohne Telegram-Call
      while (cursor <= scanWindowEnd && existingIds.has(cursor)) {
        cursor++;
        skippedExistingCount++;
      }
      if (cursor > scanWindowEnd) break;

      const roundChannels = freeAtStart.filter(c => c.sentInStep < maxHitsPerChannel);
      if (roundChannels.length === 0) break;

      // Batch für diese Mini-Runde zusammenstellen (1 ID pro freiem Kanal, strikt innerhalb des Vorab-Skip-Fensters)
      const assignments = [];
      let peekCursor = cursor;
      for (const ch of roundChannels) {
        while (peekCursor <= scanWindowEnd && existingIds.has(peekCursor)) {
          peekCursor++;
        }
        if (peekCursor > scanWindowEnd) break;
        if (probesFired + assignments.length >= maxProbesPerStep) break;
        if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(subrequestCeiling - assignments.length)) break;
        assignments.push({ ch, msgId: peekCursor });
        peekCursor++;
      }
      if (assignments.length === 0) break;

      const results = await Promise.all(
        assignments.map(a =>
          api.forwardMessage(a.ch.channelId, job.sourceChatId, a.msgId, { disableNotification: true })
            .then(res => ({ ...a, res }))
            .catch(err => ({ ...a, res: { ok: false, networkError: true, error: String(err?.message || "Netzwerkfehler") } }))
        )
      );

      probesFired += results.length;
      let highestProcessedMsgId = cursor - 1;
      let stopFurtherAdvance = false;

      for (const item of results) {
        const { ch, msgId, res } = item;
        if (res?.rateLimited) {
          hit429RetryAfter = Math.max(hit429RetryAfter, Number(res.retryAfter || 5));
          ch.cooldownUntil = Math.max(ch.cooldownUntil, Date.now() + (hit429RetryAfter + 2) * 1000);
          stopFurtherAdvance = true;
          continue;
        }
        if (res?.protectedContent || res?.forbidden) {
          fatalError = res.protectedContent
            ? "Weiterleitungssperre in der Quellgruppe aktiv (has_protected_content). Scan gestoppt."
            : `Zugriff auf Quellgruppe oder Index-Kanal verweigert: ${res.error || "403 Forbidden"}`;
          stopFurtherAdvance = true;
          continue;
        }
        if (res?.ok && res?.message) {
          hitsCount++;
          ch.sentInStep++;
          if (res.probeMessageId > 0) ch.newProbeMsgIds.push(res.probeMessageId);
          if (!stopFurtherAdvance) highestProcessedMsgId = Math.max(highestProcessedMsgId, msgId);

          const built = buildHistoryInboxRecordFromForwardedMsg(res.message, {
            sourceChatId: job.sourceChatId,
            sourceTitle: job.sourceTitle,
            probedMessageId: msgId,
            suppressReaction: !job.enableReactions,
            jobId: job.id,
            prevMediaMeta
          });
          if (built.isNoise || !built.record) {
            noiseSkipped++;
            prevMediaMeta = null;
          } else {
            recordsToInsert.push(built.record);
            prevMediaMeta = built.mediaMeta;
            if (built.msgKind === "video" || built.msgKind === "subtitle") mediaFound++;
            else contextFound++;
          }
        } else if (res?.notFound) {
          missingCount++;
          prevMediaMeta = null;
          if (!stopFurtherAdvance) highestProcessedMsgId = Math.max(highestProcessedMsgId, msgId);
        } else {
          errorCount++;
          prevMediaMeta = null;
          if (!stopFurtherAdvance) highestProcessedMsgId = Math.max(highestProcessedMsgId, msgId);
        }
      }

      if (highestProcessedMsgId >= cursor) {
        for (let idCheck = cursor; idCheck <= highestProcessedMsgId; idCheck++) {
          if (existingIds.has(idCheck)) skippedExistingCount++;
        }
        cursor = highestProcessedMsgId + 1;
      }
      if (stopFurtherAdvance) break;
    }

    // 7. 1x D1-Batch-Insert aller gefundenen Medien & Kontext-Nachrichten
    let insertedRows = 0;
    if (recordsToInsert.length > 0) {
      const insRes = await bulkInsertHistoryInboxRowsInD1(env, recordsToInsert);
      insertedRows = Number(insRes.inserted || 0);
    }

    // 8. Sofortige 100er-Bulk-Löschung (deleteMessages) pro Index-Kanal + Crash-Recovery-Speicherung
    const finishedAt = Date.now();
    const channelRuntimeUpdates = [];
    let deletedProbeMsgs = 0;
    let pendingDeleteRemain = 0;

    for (const ch of channelState) {
      const toDelete = Array.from(new Set([...ch.pendingDeleteIds, ...ch.newProbeMsgIds]));
      let leftIds = toDelete;
      let nextAllowedAt = ch.nextAllowedAt;
      let cooldownUntil = ch.cooldownUntil;

      if (ch.sentInStep > 0) {
        nextAllowedAt = Math.max(nextAllowedAt, finishedAt + ch.sentInStep * HISTORY_CHANNEL_MIN_GAP_MS);
      }
      if (toDelete.length > 0) {
        const delRes = await api.deleteMessages(ch.channelId, toDelete);
        deletedProbeMsgs += Number(delRes.deletedCount || 0);
        leftIds = Array.isArray(delRes.remainingIds) ? delRes.remainingIds : [];
        if (delRes.rateLimited) {
          const delWait = (Number(delRes.retryAfter || 5) + 2) * 1000;
          cooldownUntil = Math.max(cooldownUntil, finishedAt + delWait);
          hit429RetryAfter = Math.max(hit429RetryAfter, Number(delRes.retryAfter || 5));
        }
      }
      pendingDeleteRemain += leftIds.length;
      if (ch.sentInStep > 0 || toDelete.length > 0 || cooldownUntil !== ch.cooldownUntil) {
        channelRuntimeUpdates.push({
          channelId: ch.channelId,
          nextAllowedAt,
          cooldownUntil,
          pendingDeleteIds: leftIds
        });
      }
    }
    if (channelRuntimeUpdates.length > 0) {
      await updateHistoryChannelsRuntimeInD1(env, channelRuntimeUpdates);
    }

    // 9. Block-Grenze / Job-Ende prüfen, staging → pending freigeben und Job-Cursor in D1 aktualisieren
    const blockCompleted = cursor > blockCeiling && !fatalError && !hit429RetryAfter;
    const jobCompleted = blockCompleted && (job.direction === "asc" || blockFloor <= job.startMsgId);

    let nextFloor = blockFloor;
    let nextCursor = cursor;
    if (blockCompleted && !jobCompleted && job.direction === "desc") {
      nextFloor = Math.max(job.startMsgId, blockFloor - HISTORY_REVERSE_BLOCK_SIZE);
      nextCursor = nextFloor;
    }

    let promotedToPending = 0;
    if (jobCompleted) {
      promotedToPending = await promoteHistoryStagingRowsToPendingInD1(env, job.id, {
        promoteAll: true,
        direction: job.direction,
        now: finishedAt
      });
      if (typeof releaseHeldArchiveMirrorItemsForJobInD1 === "function") {
        await releaseHeldArchiveMirrorItemsForJobInD1(env, job.id, finishedAt).catch(() => 0);
      }
    } else if (job.direction === "asc" && insertedRows > 0) {
      promotedToPending = await promoteHistoryStagingRowsToPendingInD1(env, job.id, {
        promoteAll: false,
        direction: "asc",
        now: finishedAt
      });
    } else if (job.direction === "desc" && blockCompleted) {
      promotedToPending = await promoteHistoryStagingRowsToPendingInD1(env, job.id, {
        promoteAll: false,
        direction: "desc",
        now: finishedAt
      });
    }

    const floodUntil = hit429RetryAfter > 0 ? (finishedAt + (hit429RetryAfter + 2) * 1000) : 0;
    const nextStatus = fatalError
      ? "error"
      : (jobCompleted ? "completed" : (hit429RetryAfter > 0 ? "flood_wait" : "running"));

    await updateHistoryCrawlJobStateInD1(env, job.id, {
      status: nextStatus,
      currentCursorId: jobCompleted ? job.endMsgId : nextCursor,
      chunkFloorId: jobCompleted ? job.startMsgId : nextFloor,
      floodUntil,
      lastError: fatalError || (hit429RetryAfter > 0 ? `Telegram 429 Pause (${hit429RetryAfter}s)` : ""),
      completedAt: jobCompleted ? finishedAt : undefined,
      workerLeaseUntil: (jobCompleted || fatalError) ? 0 : (source === "browser_turbo" ? finishedAt + leaseMs : job.workerLeaseUntil),
      incScanned: hitsCount + missingCount + errorCount,
      incMediaFound: mediaFound,
      incContextFound: contextFound,
      incMissing: missingCount,
      incSkippedExisting: skippedExistingCount,
      incNoiseSkipped: noiseSkipped,
      incErrors: errorCount,
      now: finishedAt
    });

    // Empfohlene Wartezeit bis zum nächsten Browser-Turbo-Step exakt aus dem D1-Token-Bucket berechnen
    let recommendedWaitMs = 600;
    if (hit429RetryAfter > 0) {
      recommendedWaitMs = (hit429RetryAfter + 2) * 1000;
    } else if (!jobCompleted && !fatalError) {
      const nextReadyTimes = channelState.map(ch => {
        const upd = channelRuntimeUpdates.find(u => u.channelId === ch.channelId);
        return Math.max(upd ? upd.nextAllowedAt : ch.nextAllowedAt, upd ? upd.cooldownUntil : ch.cooldownUntil);
      });
      const earliest = Math.min(...nextReadyTimes);
      recommendedWaitMs = Math.max(500, earliest - finishedAt);
    }

    const updatedJob = await getHistoryCrawlJobByIdFromD1(env, job.id);
    if (updatedJob) {
      if (fatalError) {
        await maybeNotifyAdminForHistoryJob(env, updatedJob, "error", { reasonCode: "fatal", errorText: fatalError }).catch(() => {});
      } else if (jobCompleted) {
        await maybeNotifyAdminForHistoryJob(env, updatedJob, "completed").catch(() => {});
      } else {
        await maybeNotifyAdminForHistoryJob(env, updatedJob, "progress").catch(() => {});
      }
    }
    return {
      ok: !fatalError,
      source,
      job: updatedJob,
      stats: {
        probesFired,
        hitsCount,
        insertedRows,
        mediaFound,
        contextFound,
        missingCount,
        skippedExistingCount,
        noiseSkipped,
        errorCount,
        deletedProbeMsgs,
        pendingDeleteRemain,
        promotedToPending,
        recoveryDeleted: recoveryRes.deleted
      },
      blockCompleted,
      jobCompleted,
      rateLimited: hit429RetryAfter > 0,
      retryAfterSec: hit429RetryAfter > 0 ? hit429RetryAfter + 2 : 0,
      waitMs: jobCompleted || fatalError ? 0 : recommendedWaitMs,
      error: fatalError || undefined
    };
  }

  // =========================================================================
  // STUFE C: OPTIONALES SORTIERTES THEMEN-ARCHIV (HTML-BUILDER & WORKER)
  // =========================================================================
  const ARCHIVE_MIN_GAP_MS = 4300; // Strikt <= 14 Posts/Min in Telegram Forum-Supergruppe
  const ARCHIVE_TOPIC_ICON_COLORS = [0x6FB9F0, 0xFFD67E, 0xCB86DB, 0x8EEE98, 0xFF93B2, 0xFB6F5F];

  function escapeArchiveHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pickArchiveTopicColor(seedStr) {
    const s = String(seedStr || "archive");
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h * 31) + s.charCodeAt(i)) >>> 0;
    }
    return ARCHIVE_TOPIC_ICON_COLORS[h % ARCHIVE_TOPIC_ICON_COLORS.length];
  }

  function extractPrimaryArchiveGenre(rawGenres, mediaType) {
    const raw = Array.isArray(rawGenres)
      ? rawGenres.map(g => (typeof g === "string" ? g : (g?.name || ""))).filter(Boolean)
      : String(rawGenres || "")
          .split(/[,•|·\/]+/)
          .map(s => s.trim())
          .filter(Boolean);
    const cleaned = raw.filter(g => g && g !== "Keine Angabe" && g !== "Manuell bestätigt");
    const first = cleaned[0] || "";
    const lowAll = cleaned.map(g => g.toLowerCase()).join(" ");
    if (lowAll.includes("anime") || lowAll.includes("animation")) {
      return { slug: "animation", label: "Animation & Anime", isAnimation: true };
    }
    if (!first) {
      return {
        slug: mediaType === "series" ? "sonstige_serien" : "sonstige_filme",
        label: mediaType === "series" ? "Sonstige Serien" : "Sonstige Filme",
        isAnimation: false
      };
    }
    const slug = first
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "sonstige";
    return { slug, label: first.slice(0, 42), isAnimation: false };
  }

  function resolveArchiveTopicDescriptor({ mediaType, tmdbId, cleanTitle, year, genres, topicMode }) {
    const mode = ["type_genre", "per_series_plus_genre", "compact_type"].includes(topicMode) ? topicMode : "type_genre";
    const isSeries = mediaType === "series";
    const gInfo = extractPrimaryArchiveGenre(genres, mediaType);

    if (mode === "compact_type") {
      if (gInfo.isAnimation) {
        return {
          topicKey: "compact_animation",
          topicName: "✨ Animation & Anime",
          iconColor: 0xCB86DB,
          isPerSeriesTopic: false
        };
      }
      return isSeries
        ? { topicKey: "compact_series", topicName: "📺 Serien", iconColor: 0x6FB9F0, isPerSeriesTopic: false }
        : { topicKey: "compact_movies", topicName: "🎬 Filme", iconColor: 0xFFD67E, isPerSeriesTopic: false };
    }

    if (mode === "per_series_plus_genre" && isSeries && Number(tmdbId) > 0) {
      const yrSuffix = year && /^\d{4}$/.test(String(year)) ? ` (${year})` : "";
      const baseTitle = String(cleanTitle || `Serie #${tmdbId}`).replace(/\s+/g, " ").trim().slice(0, 96);
      const tKey = `series_${Number(tmdbId)}`;
      return {
        topicKey: tKey,
        topicName: `📺 ${baseTitle}${yrSuffix}`.slice(0, 120),
        iconColor: pickArchiveTopicColor(tKey),
        isPerSeriesTopic: true
      };
    }

    // Standard 'type_genre' (und Filme im Modus 'per_series_plus_genre')
    const prefix = isSeries ? "series_genre" : "movie_genre";
    const icon = isSeries ? "📺" : "🎬";
    const tKey = `${prefix}_${gInfo.slug}`;
    return {
      topicKey: tKey,
      topicName: `${icon} ${gInfo.label}`.slice(0, 120),
      iconColor: pickArchiveTopicColor(tKey),
      isPerSeriesTopic: false
    };
  }

  function buildArchiveMediaCaptionHtml({ resolved, srcRow, upgradeInfo = null }) {
    const isSeries = resolved.typeCode === "s";
    const details = (resolved.details && typeof resolved.details === "object") ? resolved.details : {};
    const title = String(resolved.cleanTitle || details.title || "Unbekannter Titel").replace(/\s+/g, " ").trim();
    const yearStr = resolved.year && resolved.year !== "k.A." ? ` (${String(resolved.year).trim()})` : "";

    const lines = [];
    if (upgradeInfo && upgradeInfo.isUpgrade) {
      const prevQ = String(upgradeInfo.previousQuality || "").trim();
      const nextQ = String(resolved.quality || "").trim();
      const qDiff = prevQ && nextQ && prevQ.toLowerCase() !== nextQ.toLowerCase()
        ? ` (<i>${escapeArchiveHtml(prevQ)} → ${escapeArchiveHtml(nextQ)}</i>)`
        : (nextQ ? ` (<i>${escapeArchiveHtml(nextQ)}</i>)` : "");
      lines.push(`🔥 <b>QUALITÄTS-UPGRADE</b>${qDiff}`);
    }
    lines.push(`${isSeries ? "📺" : "🎬"} <b>${escapeArchiveHtml(title)}${escapeArchiveHtml(yearStr)}</b>`);

    if (isSeries) {
      const sNum = Number(resolved.season ?? 1);
      const eNum = Number(resolved.episode ?? 1);
      const epCode = `S${String(sNum).padStart(2, "0")}E${String(eNum).padStart(2, "0")}`;
      const epRange = resolved.episodeEnd && Number(resolved.episodeEnd) > eNum
        ? `${epCode}-E${String(resolved.episodeEnd).padStart(2, "0")}`
        : epCode;
      const epTitleClean = String(resolved.episodeTitle || "").replace(/\s+/g, " ").trim();
      const epSuffix = epTitleClean && !/^Folge\s+\d+$/i.test(epTitleClean)
        ? ` – ${escapeArchiveHtml(epTitleClean.slice(0, 90))}`
        : "";
      lines.push(`🎞 <b>${escapeArchiveHtml(epRange)}</b>${epSuffix}`);
    } else if (Number(resolved.partNumber || 1) > 1 || resolved.part) {
      const pLabel = resolved.part ? String(resolved.part) : `Teil ${Number(resolved.partNumber || 1)}`;
      lines.push(`🎞 <b>${escapeArchiveHtml(pLabel)}</b>`);
    }

    const techParts = [];
    if (resolved.quality) techParts.push(String(resolved.quality).trim());
    if (resolved.codec) techParts.push(String(resolved.codec).trim());
    if (resolved.editionLabel) techParts.push(String(resolved.editionLabel).trim());
    const sizeBytes = Number(resolved.fileSize || srcRow?.payload?.file_size || 0);
    if (sizeBytes > 0 && typeof formatFileSizeBytes === "function") {
      const sz = formatFileSizeBytes(sizeBytes);
      if (sz) techParts.push(sz);
    }
    if (techParts.length > 0) {
      lines.push(`⚙️ <i>${escapeArchiveHtml(techParts.join(" · "))}</i>`);
    }

    const metaParts = [];
    const voteVal = Number(details.vote_average || resolved.voteAverage || 0);
    if (voteVal > 0) metaParts.push(`⭐ ${(Math.round(voteVal * 10) / 10).toFixed(1)}/10`);
    const fskRaw = String(details.fsk || "").trim();
    if (fskRaw && fskRaw !== "Keine Angabe" && fskRaw !== "FSK Keine Angabe") {
      metaParts.push(/^fsk\b/i.test(fskRaw) ? fskRaw : `FSK ${fskRaw}`);
    }
    const genresStr = String(details.genres || "").trim();
    if (genresStr && genresStr !== "Keine Angabe" && genresStr !== "Manuell bestätigt") {
      metaParts.push(genresStr.slice(0, 64));
    }
    if (metaParts.length > 0) {
      lines.push(`🏷 ${escapeArchiveHtml(metaParts.join(" • "))}`);
    }

    const headerBlock = lines.join("\n");
    const rawOverview = String(details.overview || "").replace(/\s+/g, " ").trim();
    const maxTotalChars = 980;
    if (rawOverview && rawOverview !== "Keine Beschreibung verfügbar." && headerBlock.length < maxTotalChars - 40) {
      const avail = maxTotalChars - headerBlock.length - 12;
      let clipped = rawOverview;
      if (clipped.length > avail) {
        clipped = clipped.slice(0, Math.max(20, avail - 1)).replace(/\s+\S*$/, "") + "…";
      }
      const escapedOv = escapeArchiveHtml(clipped);
      if (headerBlock.length + 2 + escapedOv.length <= maxTotalChars) {
        return `${headerBlock}\n\n${escapedOv}`;
      }
      const safeRaw = escapeArchiveHtml(rawOverview.slice(0, Math.max(20, Math.floor(avail * 0.8))) + "…");
      if (headerBlock.length + 2 + safeRaw.length <= maxTotalChars) {
        return `${headerBlock}\n\n${safeRaw}`;
      }
    }
    return headerBlock.slice(0, maxTotalChars);
  }

  function buildArchiveSeriesCardHtml({ resolved }) {
    const details = (resolved.details && typeof resolved.details === "object") ? resolved.details : {};
    const title = String(resolved.cleanTitle || details.title || "Serie").replace(/\s+/g, " ").trim();
    const yearStr = resolved.year && resolved.year !== "k.A." ? ` (${String(resolved.year).trim()})` : "";
    const lines = [`📺 <b>${escapeArchiveHtml(title)}${escapeArchiveHtml(yearStr)}</b>`];
    const meta = [];
    const voteVal = Number(details.vote_average || 0);
    if (voteVal > 0) meta.push(`⭐ ${(Math.round(voteVal * 10) / 10).toFixed(1)}/10`);
    const seasonsCnt = Number(details.numberOfSeasons || details.number_of_seasons || details.totalSeasons || (Array.isArray(details.seasons) ? details.seasons.filter(s => Number(s?.season_number) > 0).length : 0) || 0);
    const epsCnt = Number(details.numberOfEpisodes || details.number_of_episodes || details.totalEpisodes || 0);
    if (seasonsCnt > 0) meta.push(`${seasonsCnt} Staffel${seasonsCnt === 1 ? "" : "n"}${epsCnt > 0 ? ` · ${epsCnt} Folgen` : ""}`);
    const fskRaw = String(details.fsk || "").trim();
    if (fskRaw && fskRaw !== "Keine Angabe" && fskRaw !== "FSK Keine Angabe") {
      meta.push(/^fsk\b/i.test(fskRaw) ? fskRaw : `FSK ${fskRaw}`);
    }
    if (meta.length > 0) lines.push(`🏷 ${escapeArchiveHtml(meta.join(" • "))}`);
    const genresStr = String(details.genres || "").trim();
    if (genresStr && genresStr !== "Keine Angabe" && genresStr !== "Manuell bestätigt") {
      lines.push(`🎭 <i>${escapeArchiveHtml(genresStr.slice(0, 90))}</i>`);
    }
    const header = lines.join("\n");
    const rawOv = String(details.overview || "").replace(/\s+/g, " ").trim();
    const maxLen = 920;
    if (rawOv && header.length < maxLen - 40) {
      const avail = maxLen - header.length - 12;
      const clipped = rawOv.length > avail ? `${rawOv.slice(0, Math.max(20, avail - 1)).replace(/\s+\S*$/, "")}…` : rawOv;
      const esc = escapeArchiveHtml(clipped);
      if (header.length + 2 + esc.length <= maxLen) return `${header}\n\n${esc}`;
    }
    return header.slice(0, maxLen);
  }

  async function collectArchiveMirrorQueueCandidate(env, { resolved, srcRow, sourceChatId, ctxCache, upgradeInfo = null }) {
    if (!resolved || !resolved.ok || !srcRow) return null;
    const jobId = Number(srcRow?.sourceJobId || srcRow?.payload?._historyJobId || 0);
    const effSourceChatId = String(sourceChatId || srcRow.chatId || "").trim();

    const rawFid = String(srcRow.payload?.telegram_file_id || resolved.fileMeta?.fileId || "").trim();
    if (!rawFid || rawFid.startsWith("tg_export_") || rawFid.startsWith("vip_playlist_") || rawFid.startsWith("tmdb_card_")) {
      return null;
    }

    let topicMode = "type_genre";
    let pinSeriesCard = false;
    let initialStatus = "pending";
    let resolvedSourceChatId = effSourceChatId;

    if (jobId > 0) {
      if (!ctxCache.jobsById) ctxCache.jobsById = new Map();
      let job = ctxCache.jobsById.get(jobId);
      if (job === undefined) {
        job = typeof getHistoryCrawlJobByIdFromD1 === "function"
          ? await getHistoryCrawlJobByIdFromD1(env, jobId)
          : null;
        ctxCache.jobsById.set(jobId, job || null);
      }
      if (!job || !job.enableArchiveMirror) return null;
      topicMode = job.archiveTopicMode || "type_genre";
      pinSeriesCard = Boolean(job.archivePinSeriesCard);
      // Wenn 'after_scan' aktiv ist UND der Job noch nicht fertig ist -> zurückhalten; bei bereits abgeschlossenem Job sofort 'pending'
      initialStatus = (job.archiveTiming === "after_scan" && job.status !== "completed")
        ? "held_until_scan"
        : "pending";
      resolvedSourceChatId = String(sourceChatId || job.sourceChatId || "");
    } else {
      // Live-Post aus /ingest_on (jobId === 0): nur spiegeln, wenn pro Gruppe archiveMirrorEnabled === true!
      if (!effSourceChatId) return null;
      if (ctxCache.autoIngestChatsMap === undefined) {
        ctxCache.autoIngestChatsMap = typeof getAutoIngestChatsMap === "function"
          ? await getAutoIngestChatsMap(env, false)
          : {};
      }
      const chatCfg = ctxCache.autoIngestChatsMap?.[effSourceChatId] || null;
      if (!chatCfg || chatCfg.archiveMirrorEnabled !== true) return null;

      if (ctxCache.archiveDefaults === undefined) {
        ctxCache.archiveDefaults = typeof getHistoryArchiveDefaultsFromD1 === "function"
          ? await getHistoryArchiveDefaultsFromD1(env)
          : { topicMode: "type_genre", timing: "live", pinSeriesCard: true };
      }
      topicMode = ctxCache.archiveDefaults?.topicMode || "type_genre";
      pinSeriesCard = Boolean(ctxCache.archiveDefaults?.pinSeriesCard);
      initialStatus = "pending";
    }

    if (ctxCache.archiveForum === undefined) {
      const channels = typeof getHistoryIndexChannelsFromD1 === "function"
        ? await getHistoryIndexChannelsFromD1(env, { role: "archive_forum", onlyEnabled: true })
        : [];
      ctxCache.archiveForum = channels[0] || null;
    }
    const archiveForum = ctxCache.archiveForum;
    if (!archiveForum || !archiveForum.channelId) return null;
    if (resolvedSourceChatId && resolvedSourceChatId === archiveForum.channelId) return null;

    const mediaType = resolved.typeCode === "s" ? "series" : "movie";
    const details = (resolved.details && typeof resolved.details === "object") ? resolved.details : {};
    const topicDesc = resolveArchiveTopicDescriptor({
      mediaType,
      tmdbId: Number(resolved.tmdbId || 0),
      cleanTitle: resolved.cleanTitle || details.title || "",
      year: resolved.year || "",
      genres: details.genres || "",
      topicMode
    });

    const rawFileName = String(srcRow.payload?.file_name || "").trim();
    const rawMime = String(srcRow.payload?.mime_type || "").toLowerCase();
    const isDoc = Boolean(
      srcRow.payload?._isVideoDocument ||
      rawMime === "video/x-matroska" ||
      /\.(?:mkv|avi|ts|m2ts|wmv|flv|rar|zip|7z)$/i.test(rawFileName)
    );

    let coverUrl = "";
    if (details.poster_path && /^\/(?!\/)[^\s"'<>]+$/.test(String(details.poster_path))) {
      coverUrl = `https://image.tmdb.org/t/p/w500${details.poster_path}`;
    } else if (details.external_poster_url && /^https:\/\/[^\s"'<>]+$/i.test(String(details.external_poster_url))) {
      coverUrl = String(details.external_poster_url);
    }

    const wantPinSeriesCard = Boolean(
      pinSeriesCard &&
      mediaType === "series" &&
      topicDesc.isPerSeriesTopic
    );

    const fileUniqueId = String(
      srcRow.payload?.telegram_unique_id ||
      resolved.fileMeta?.fileUniqueId ||
      `fid_${rawFid.slice(-48)}`
    ).trim();

    return {
      jobId: jobId > 0 ? jobId : 0,
      archiveChatId: archiveForum.channelId,
      mediaType,
      tmdbId: Number(resolved.tmdbId || 0),
      seasonNumber: mediaType === "series" ? Number(resolved.season ?? 1) : 0,
      episodeNumber: mediaType === "series" ? Number(resolved.episode ?? 1) : 0,
      partNumber: mediaType === "series" ? 1 : Math.max(1, Number(resolved.partNumber || 1)),
      sourceChatId: resolvedSourceChatId,
      sourceMessageId: Number(srcRow.messageId || 0),
      fileUniqueId,
      fileId: rawFid,
      fileKind: isDoc ? "document" : "video",
      topicKey: topicDesc.topicKey,
      topicName: topicDesc.topicName,
      topicIconColor: topicDesc.iconColor,
      seriesHeaderHtml: wantPinSeriesCard ? buildArchiveSeriesCardHtml({ resolved }) : "",
      seriesPosterUrl: wantPinSeriesCard ? coverUrl : "",
      captionHtml: buildArchiveMediaCaptionHtml({ resolved, srcRow, upgradeInfo }),
      coverUrl,
      status: initialStatus
    };
  }

  // Entkoppelter Stufe-C-Worker: 14 Posts/Min Pacing, max. 2 neue Topics/Tick, seriell ohne Race-Conditions, TOPIC_DELETED Self-Healing
  async function processArchiveMirrorQueueBatch(env, options = {}) {
    const now = Date.now();
    const maxPosts = Math.max(1, Math.min(6, Number(options.maxPosts || 4)));
    const maxNewTopics = Math.max(1, Math.min(3, Number(options.maxNewTopics || 2)));
    const subrequestCeiling = Math.max(24, Math.min(46, Number(options.subrequestCeiling || 42)));

    const archiveChannels = typeof getHistoryIndexChannelsFromD1 === "function"
      ? await getHistoryIndexChannelsFromD1(env, { role: "archive_forum", onlyEnabled: true })
      : [];
    const archiveForum = archiveChannels[0] || null;
    if (!archiveForum || !archiveForum.channelId) {
      return { ok: true, idle: true, reason: "no_archive_forum", postedCount: 0 };
    }

    const readyAt = Math.max(Number(archiveForum.nextAllowedAt || 0), Number(archiveForum.cooldownUntil || 0));
    if (readyAt > now) {
      return {
        ok: true,
        waiting: true,
        reason: archiveForum.cooldownUntil > now ? "flood_wait" : "pacing_wait",
        waitMs: Math.max(500, readyAt - now),
        postedCount: 0
      };
    }

    const items = await claimPendingArchiveMirrorBatchFromD1(env, maxPosts, now, archiveForum.channelId);
    if (!items || items.length === 0) {
      return { ok: true, idle: true, reason: "queue_empty", postedCount: 0 };
    }

    const archiveDefaults = typeof getHistoryArchiveDefaultsFromD1 === "function"
      ? await getHistoryArchiveDefaultsFromD1(env)
      : { maxSeriesTopics: 250 };
    const defaultMaxSeriesTopics = Math.max(10, Math.min(500, Number(archiveDefaults?.maxSeriesTopics || 250)));

    const api = tgApi(env);
    const topicCache = new Map();
    const jobMaxTopicsCache = new Map();
    let seriesTopicCount = null;
    let newTopicsCreated = 0;
    let postedCount = 0;
    let failedCount = 0;
    let recreatedTopics = 0;
    let hit429RetryAfter = 0;
    let fatalError = "";
    let stoppedByBudget = false;

    const getMaxSeriesTopicsForJob = async (jobId) => {
      if (!jobId) return defaultMaxSeriesTopics;
      if (jobMaxTopicsCache.has(jobId)) return jobMaxTopicsCache.get(jobId);
      const j = typeof getHistoryCrawlJobByIdFromD1 === "function"
        ? await getHistoryCrawlJobByIdFromD1(env, jobId)
        : null;
      const limitVal = Math.max(10, Math.min(500, Number(j?.archiveMaxSeriesTopics || defaultMaxSeriesTopics)));
      jobMaxTopicsCache.set(jobId, limitVal);
      return limitVal;
    };

    const ensureTopicForItem = async (item, forceRecreate = false) => {
      let targetKey = item.topicKey;
      let targetName = item.topicName || "🎬 Archiv";
      let targetColor = item.topicIconColor || pickArchiveTopicColor(targetKey);

      if (!forceRecreate) {
        let cached = topicCache.get(targetKey);
        if (cached === undefined) {
          cached = await getArchiveTopicFromD1(env, archiveForum.channelId, targetKey);
          topicCache.set(targetKey, cached || null);
        }
        if (cached && cached.messageThreadId > 0) {
          return { ok: true, topic: cached, newlyCreated: false, topicKey: targetKey, topicName: targetName };
        }
      }

      // Max-Serien-Topics-Schutz (Standard 250): Wenn voll, sauber auf "📺 Serien · Archiv" umleiten!
      if (/^series_\d+$/.test(targetKey)) {
        if (seriesTopicCount === null) {
          seriesTopicCount = await countSeriesTopicsInArchiveFromD1(env, archiveForum.channelId);
        }
        const maxAllowed = await getMaxSeriesTopicsForJob(item.jobId);
        if (seriesTopicCount >= maxAllowed) {
          targetKey = "series_archive_overflow";
          targetName = "📺 Serien · Archiv";
          targetColor = 0x6FB9F0;
          let overflowTopic = topicCache.get(targetKey);
          if (overflowTopic === undefined && !forceRecreate) {
            overflowTopic = await getArchiveTopicFromD1(env, archiveForum.channelId, targetKey);
            topicCache.set(targetKey, overflowTopic || null);
          }
          if (overflowTopic && overflowTopic.messageThreadId > 0) {
            return { ok: true, topic: overflowTopic, newlyCreated: false, topicKey: targetKey, topicName: targetName };
          }
        }
      }

      if (newTopicsCreated >= maxNewTopics) {
        return { ok: false, deferredTopicBudget: true };
      }
      if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(subrequestCeiling - 2)) {
        return { ok: false, budgetExhausted: true };
      }

      const created = await api.createForumTopic(archiveForum.channelId, targetName, {
        icon_color: ARCHIVE_TOPIC_ICON_COLORS.includes(targetColor) ? targetColor : undefined
      });
      if (created?.throttled429 || created?.rateLimited) {
        return { ok: false, rateLimited: true, retryAfter: Number(created.retryAfter || 8), error: created.error };
      }
      if (!created?.ok || !created?.message_thread_id) {
        return { ok: false, notSupported: Boolean(created?.notSupported), error: created?.error || "createForumTopic fehlgeschlagen" };
      }

      newTopicsCreated++;
      if (/^series_\d+$/.test(targetKey) && seriesTopicCount !== null) {
        seriesTopicCount++;
      }
      const topicRec = {
        archiveChatId: archiveForum.channelId,
        topicKey: targetKey,
        messageThreadId: Number(created.message_thread_id),
        topicName: targetName,
        iconColor: Number(created.icon_color || targetColor || 0),
        pinnedHeaderMsgId: 0,
        updatedAt: Date.now()
      };
      await upsertArchiveTopicInD1(env, topicRec);
      topicCache.set(targetKey, topicRec);
      return { ok: true, topic: topicRec, newlyCreated: true, topicKey: targetKey, topicName: targetName };
    };

    for (const item of items) {
      if (hit429RetryAfter > 0 || fatalError) break;
      if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(subrequestCeiling - 2)) {
        stoppedByBudget = true;
        break;
      }

      let topicRes = await ensureTopicForItem(item, false);
      if (topicRes.deferredTopicBudget || topicRes.budgetExhausted) {
        stoppedByBudget = Boolean(topicRes.budgetExhausted);
        break;
      }
      if (topicRes.rateLimited) {
        hit429RetryAfter = Math.max(hit429RetryAfter, Number(topicRes.retryAfter || 8));
        break;
      }
      if (!topicRes.ok || !topicRes.topic) {
        if (topicRes.notSupported) {
          fatalError = `Archiv-Forum unterstützt keine Themen oder fehlende Admin-Rechte: ${topicRes.error || ""}`.trim();
          await markArchiveMirrorItemResultInD1(env, item.id, {
            status: "failed",
            attempts: item.attempts + 1,
            lastError: fatalError
          });
          failedCount++;
          break;
        }
        const nextAtt = item.attempts + 1;
        const isFinalFail = nextAtt >= 5;
        await markArchiveMirrorItemResultInD1(env, item.id, {
          status: isFinalFail ? "failed" : "pending",
          attempts: nextAtt,
          nextAttemptAt: isFinalFail ? 0 : (Date.now() + Math.min(3600000, 30000 * Math.pow(2, nextAtt - 1))),
          lastError: topicRes.error || "Topic konnte nicht angelegt werden"
        });
        if (isFinalFail) failedCount++;
        continue;
      }

      let activeTopic = topicRes.topic;

      // Optionale angepinnte Serien-Info-Karte beim ersten Anlegen eines Serien-Topics
      if (
        item.seriesHeaderHtml &&
        activeTopic.pinnedHeaderMsgId <= 0 &&
        /^series_\d+$/.test(topicRes.topicKey) &&
        (typeof hasSubrequestBudget !== "function" || hasSubrequestBudget(subrequestCeiling - 3))
      ) {
        const cardRes = await api.sendArchiveTopicHeaderCard(archiveForum.channelId, {
          textHtml: item.seriesHeaderHtml,
          posterUrl: item.seriesPosterUrl,
          messageThreadId: activeTopic.messageThreadId,
          pin: true
        });
        if (cardRes?.rateLimited) {
          hit429RetryAfter = Math.max(hit429RetryAfter, Number(cardRes.retryAfter || 8));
          break;
        }
        if (cardRes?.ok && cardRes.messageId > 0) {
          activeTopic.pinnedHeaderMsgId = cardRes.messageId;
          await upsertArchiveTopicInD1(env, { ...activeTopic, updatedAt: Date.now() });
          topicCache.set(activeTopic.topicKey, activeTopic);
        }
      }

      let sendRes = await api.sendArchiveMediaToTopic(archiveForum.channelId, {
        fileId: item.fileId,
        fileKind: item.fileKind,
        captionHtml: item.captionHtml,
        coverUrl: item.coverUrl,
        messageThreadId: activeTopic.messageThreadId,
        disableNotification: true
      });

      // Self-Healing bei TOPIC_DELETED / message thread not found: veraltete Mapping-Zeile löschen, Topic 1x neu anlegen & erneut posten!
      if (sendRes?.topicDeleted) {
        await deleteArchiveTopicFromD1(env, archiveForum.channelId, activeTopic.topicKey);
        topicCache.delete(activeTopic.topicKey);
        const healRes = await ensureTopicForItem({ ...item, topicKey: activeTopic.topicKey, topicName: activeTopic.topicName }, true);
        if (healRes.rateLimited) {
          hit429RetryAfter = Math.max(hit429RetryAfter, Number(healRes.retryAfter || 8));
          break;
        }
        if (healRes.deferredTopicBudget || healRes.budgetExhausted) {
          stoppedByBudget = Boolean(healRes.budgetExhausted);
          break;
        }
        if (healRes.ok && healRes.topic) {
          recreatedTopics++;
          activeTopic = healRes.topic;
          sendRes = await api.sendArchiveMediaToTopic(archiveForum.channelId, {
            fileId: item.fileId,
            fileKind: item.fileKind,
            captionHtml: item.captionHtml,
            coverUrl: item.coverUrl,
            messageThreadId: activeTopic.messageThreadId,
            disableNotification: true
          });
        }
      }

      if (sendRes?.rateLimited) {
        hit429RetryAfter = Math.max(hit429RetryAfter, Number(sendRes.retryAfter || 8));
        await markArchiveMirrorItemResultInD1(env, item.id, {
          status: "pending",
          nextAttemptAt: Date.now() + (hit429RetryAfter + 2) * 1000,
          lastError: `Telegram 429 Pause (${hit429RetryAfter}s)`
        });
        break;
      }

      if (sendRes?.forbidden) {
        fatalError = `Archiv-Forum Zugriff verweigert: ${sendRes.error || "403 Forbidden"}`;
        await markArchiveMirrorItemResultInD1(env, item.id, {
          status: "failed",
          attempts: item.attempts + 1,
          lastError: fatalError
        });
        failedCount++;
        break;
      }

      if (sendRes?.ok && sendRes.messageId > 0) {
        postedCount++;
        await markArchiveMirrorItemResultInD1(env, item.id, {
          status: "posted",
          archiveMessageId: sendRes.messageId,
          archiveThreadId: sendRes.messageThreadId || activeTopic.messageThreadId,
          topicKey: activeTopic.topicKey,
          topicName: activeTopic.topicName,
          lastError: ""
        });
      } else {
        const nextAtt = item.attempts + 1;
        const isFinalFail = nextAtt >= 5;
        await markArchiveMirrorItemResultInD1(env, item.id, {
          status: isFinalFail ? "failed" : "pending",
          attempts: nextAtt,
          nextAttemptAt: isFinalFail ? 0 : (Date.now() + Math.min(3600000, 30000 * Math.pow(2, nextAtt - 1))),
          lastError: String(sendRes?.error || "Archiv-Post fehlgeschlagen")
        });
        if (isFinalFail) failedCount++;
      }
    }

    const finishedAt = Date.now();
    const nextAllowedAt = Math.max(
      Number(archiveForum.nextAllowedAt || 0),
      finishedAt + Math.max(1, postedCount + newTopicsCreated) * ARCHIVE_MIN_GAP_MS
    );
    const nextCooldownUntil = hit429RetryAfter > 0
      ? Math.max(Number(archiveForum.cooldownUntil || 0), finishedAt + (hit429RetryAfter + 2) * 1000)
      : (fatalError ? finishedAt + 60000 : Number(archiveForum.cooldownUntil || 0));

    if (postedCount > 0 || newTopicsCreated > 0 || hit429RetryAfter > 0 || fatalError) {
      await updateHistoryChannelsRuntimeInD1(env, [{
        channelId: archiveForum.channelId,
        nextAllowedAt,
        cooldownUntil: nextCooldownUntil,
        pendingDeleteIds: archiveForum.pendingDeleteIds || []
      }]);
    }
    if (fatalError) {
      await maybeNotifyAdminForArchiveError(env, archiveForum, fatalError).catch(() => {});
    }

    return {
      ok: !fatalError,
      postedCount,
      newTopicsCreated,
      recreatedTopics,
      failedCount,
      rateLimited: hit429RetryAfter > 0,
      retryAfterSec: hit429RetryAfter > 0 ? hit429RetryAfter + 2 : 0,
      stoppedByBudget,
      waitMs: Math.max(0, Math.max(nextAllowedAt, nextCooldownUntil) - finishedAt),
      error: fatalError || undefined
    };
  }

  async function resolveBotAdminIdForChannelChat(env, chatId) {
    try {
      const admins = await tgApi(env).getChatAdministrators(chatId);
      if (!Array.isArray(admins) || admins.length === 0) return "";
      for (const adm of admins) {
        const uid = adm?.user?.id;
        if (uid && await isTelegramBotAdmin(env, uid)) {
          return String(uid);
        }
      }
    } catch (_e) {}
    return "";
  }

  async function verifyChannelAutoIngestAdminAccess(env, chatId) {
    const matchedAdminId = await resolveBotAdminIdForChannelChat(env, chatId);
    return Boolean(matchedAdminId);
  }

  // =========================================================================
  // LAUTLOSE ADMIN-BENACHRICHTIGUNGEN (25/50/75 %, 100 % & HARTE FEHLER)
  // =========================================================================
  function stripHistoryErrorNotifyFlags(rawFlags) {
    return String(rawFlags || "")
      .split(",")
      .map(s => s.trim())
      .filter(s => s && !s.startsWith("err_"))
      .join(",");
  }

  async function resolveHistoryNotificationAdminId(env, preferredAdminId = "") {
    if (env._isCustomBotWebhook) return "";
    const defaults = typeof getHistoryArchiveDefaultsFromD1 === "function"
      ? await getHistoryArchiveDefaultsFromD1(env)
      : { notifyAdminDm: true };
    if (defaults && defaults.notifyAdminDm === false) return "";

    const pref = String(preferredAdminId || "").trim();
    if (/^\d{5,20}$/.test(pref) && typeof isTelegramBotAdmin === "function") {
      try {
        if (await isTelegramBotAdmin(env, pref)) return pref;
      } catch (_e) {}
    }
    if (typeof getPrimaryBotAdminId === "function") {
      return await getPrimaryBotAdminId(env);
    }
    return "";
  }

  async function maybeNotifyAdminForHistoryJob(env, job, eventType, extra = {}) {
    if (!job || !job.id || env._isCustomBotWebhook) return false;
    if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(44)) return false;

    const existingFlags = new Set(
      String(job.notifyFlags || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
    );

    const totalSpan = Math.max(1, Number(job.totalSpan || (Math.abs(Number(job.endMsgId || 0) - Number(job.startMsgId || 0)) + 1)));
    const safeTitle = escapeMd(job.sourceTitle || job.sourceChatId || `Job #${job.id}`);
    let msgText = "";
    let inline_keyboard = [];
    let flagsChanged = false;

    if (eventType === "completed") {
      if (existingFlags.has("done")) return false;
      existingFlags.add("done");
      existingFlags.add("m25");
      existingFlags.add("m50");
      existingFlags.add("m75");
      flagsChanged = true;
      msgText =
        `✅ *Verlaufs-Scan abgeschlossen (Job #${job.id})*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📂 *Quelle:* ${safeTitle}\n` +
        `📊 *Bereich:* \`#${job.startMsgId}\` – \`#${job.endMsgId}\` (\`${totalSpan}\` IDs)\n` +
        `🎞 *Gefunden:* \`${Number(job.mediaFoundCount || 0)}\` Medien · \`${Number(job.contextFoundCount || 0)}\` Kontext\n` +
        `⏭️ *Vorab-Skip:* \`${Number(job.skippedExistingCount || 0)}\` · 🕳️ *Lücken:* \`${Number(job.missingCount || 0)}\`` +
        (job.enableArchiveMirror ? `\n🗂️ *Themen-Archiv:* Aktiv — Einträge werden automatisch einsortiert.` : "");
      inline_keyboard = [[
        { text: "📋 Jobs & Archiv", callback_data: `hc:job_v:${job.id}` },
        { text: "⚙️ Einstellungen", callback_data: "hc:cfg_ref" }
      ]];
    } else if (eventType === "progress") {
      // Meilensteine 25/50/75 % nur bei großen Scans (>= 1.000 IDs)
      if (totalSpan < 1000) return false;
      const pct = Number(job.progressPct || 0);
      if (pct < 25 || pct >= 100) return false;
      let hitMilestone = 0;
      if (pct >= 75 && !existingFlags.has("m75")) hitMilestone = 75;
      else if (pct >= 50 && !existingFlags.has("m50")) hitMilestone = 50;
      else if (pct >= 25 && !existingFlags.has("m25")) hitMilestone = 25;
      if (!hitMilestone) return false;

      if (hitMilestone >= 25) existingFlags.add("m25");
      if (hitMilestone >= 50) existingFlags.add("m50");
      if (hitMilestone >= 75) existingFlags.add("m75");
      flagsChanged = true;
      const doneIds = Math.min(totalSpan, Number(job.scannedCount || 0) + Number(job.skippedExistingCount || 0));
      msgText =
        `📊 *Verlaufs-Scan Meilenstein: ${hitMilestone}% (Job #${job.id})*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📂 *Quelle:* ${safeTitle}\n` +
        `📈 *Fortschritt:* \`${pct.toFixed(1)}%\` (\`${doneIds}\` / \`${totalSpan}\` IDs)\n` +
        `🎞 *Bisher gefunden:* \`${Number(job.mediaFoundCount || 0)}\` Medien · ⏭️ \`${Number(job.skippedExistingCount || 0)}\` Vorab-Skip`;
      inline_keyboard = [[
        { text: "📋 Job ansehen", callback_data: `hc:job_v:${job.id}` },
        { text: "⏸️ Pause", callback_data: `hc:job_p:${job.id}` }
      ]];
    } else if (eventType === "error") {
      const code = String(extra.reasonCode || "fatal").replace(/[^a-z0-9_]/gi, "").slice(0, 24) || "fatal";
      const errFlag = `err_${code}`;
      if (existingFlags.has(errFlag)) return false;
      existingFlags.add(errFlag);
      flagsChanged = true;
      const errText = escapeMd(String(extra.errorText || job.lastError || "Unbekannter Fehler").slice(0, 280));
      msgText =
        `⚠️ *Verlaufs-Scan gestoppt / pausiert (Job #${job.id})*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📂 *Quelle:* ${safeTitle}\n` +
        `⛔ *Grund:* ${errText}\n` +
        `💡 Prüfe die Bot-Rechte oder Index-Kanäle und setze den Job bei Bedarf über /jobs fort.`;
      inline_keyboard = [[
        { text: "📋 Job ansehen", callback_data: `hc:job_v:${job.id}` },
        { text: "⚙️ Index/Archiv", callback_data: "hc:cfg_ref" }
      ]];
    } else {
      return false;
    }

    if (!flagsChanged || !msgText) return false;
    const targetAdminId = await resolveHistoryNotificationAdminId(env, job.createdByAdminId);
    if (!targetAdminId) return false;

    const nextFlagsStr = Array.from(existingFlags).join(",");
    job.notifyFlags = nextFlagsStr;
    if (typeof updateHistoryCrawlJobStateInD1 === "function") {
      await updateHistoryCrawlJobStateInD1(env, job.id, { notifyFlags: nextFlagsStr }).catch(() => {});
    }

    await tgApi(env).sendMessage(targetAdminId, msgText, {
      disable_notification: true,
      reply_markup: { inline_keyboard }
    }).catch(() => null);
    return true;
  }

  async function maybeNotifyAdminForArchiveError(env, archiveForum, errorText) {
    if (!errorText || env._isCustomBotWebhook) return false;
    if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(44)) return false;

    const cooldownMs = 6 * 60 * 60 * 1000;
    const now = Date.now();
    const cacheKey = "archive_err_notify_ts_v1";
    const memTs = Number(memoryFallback.get(cacheKey) || 0);
    if (memTs > 0 && (now - memTs) < cooldownMs) return false;

    if (typeof getEntityFromD1 === "function") {
      const stored = await getEntityFromD1(env, cacheKey, cooldownMs, { ramTtlMs: 60000 }).catch(() => null);
      if (stored && Number(stored.ts || 0) > 0 && (now - Number(stored.ts)) < cooldownMs) {
        memoryFallback.set(cacheKey, Number(stored.ts));
        return false;
      }
    }

    const targetAdminId = await resolveHistoryNotificationAdminId(env, "");
    if (!targetAdminId) return false;

    memoryFallback.set(cacheKey, now);
    if (typeof saveEntityToD1 === "function") {
      await saveEntityToD1(env, cacheKey, "system", { ts: now }).catch(() => {});
    }

    const forumName = escapeMd(archiveForum?.label || archiveForum?.channelId || "Themen-Archiv");
    const safeErr = escapeMd(String(errorText).slice(0, 280));
    const msgText =
      `⚠️ *Themen-Archiv Fehler*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🗂️ *Ziel-Forum:* ${forumName}\n` +
      `⛔ *Grund:* ${safeErr}\n` +
      `💡 Prüfe bitte, ob Themen (Topics) aktiviert sind und der Bot Admin mit Recht „Themen verwalten“ ist.`;
    await tgApi(env).sendMessage(targetAdminId, msgText, {
      disable_notification: true,
      reply_markup: {
        inline_keyboard: [[
          { text: "📋 Jobs & Archiv", callback_data: "hc:jobs" },
          { text: "⚙️ Index/Archiv", callback_data: "hc:cfg_ref" }
        ]]
      }
    }).catch(() => null);
    return true;
  }

  // =========================================================================
  // 📌 INHALTSVERZEICHNIS IM THEMEN-ARCHIV (FILME NACH GENRE + SERIEN A–Z)
  // =========================================================================
  const ARCHIVE_DIRECTORY_TOPIC_KEY = "archive_directory";
  const ARCHIVE_DIRECTORY_TOPIC_NAME = "📌 Inhaltsverzeichnis";
  const ARCHIVE_DIRECTORY_TOPIC_COLOR = 0xFFD67E;
  const ARCHIVE_DIRECTORY_DEBOUNCE_MS = 5 * 60 * 1000;

  function computeSimpleArchiveHash(str) {
    let h = 2166136261;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function stripLeadingEmojiForSort(str) {
    return String(str || "")
      .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s•\-·]+/gu, "")
      .trim();
  }

  function buildArchiveDirectoryMarkdownParts(archiveChatId, dirData) {
    const topics = Array.isArray(dirData?.topics) ? dirData.topics : [];
    const totalPostedFiles = Number(dirData?.totalPostedFiles || 0);
    const chatNum = String(archiveChatId || "").replace(/^-100/, "");
    const makeDeepLink = (threadId) => (chatNum && threadId > 0 ? `https://t.me/c/${chatNum}/${threadId}` : "");
    const safeLinkLabel = (rawName) => escapeMd(String(rawName || "Thema").replace(/[\[\]()]/g, "").trim().slice(0, 72));
    const fmtCount = (n) => {
      const cnt = Number(n || 0);
      if (cnt <= 0) return "_(leer)_";
      return cnt === 1 ? "_(1 Datei)_" : `_(${cnt} Dateien)_`;
    };
    const sortByNameDe = (a, b) =>
      stripLeadingEmojiForSort(a.topicName || a.topicKey)
        .localeCompare(stripLeadingEmojiForSort(b.topicName || b.topicKey), "de-DE", { sensitivity: "base" });

    const movieTopics = [];
    const seriesTopics = [];
    const overflowTopics = [];
    const otherTopics = [];

    for (const t of topics) {
      const k = String(t.topicKey || "");
      if (k === ARCHIVE_DIRECTORY_TOPIC_KEY) continue;
      if (k === "series_archive_overflow") {
        overflowTopics.push(t);
      } else if (k.startsWith("movie_") || k === "movies_all" || k === "anime_all") {
        movieTopics.push(t);
      } else if (k.startsWith("series_") || k === "series_all") {
        seriesTopics.push(t);
      } else {
        otherTopics.push(t);
      }
    }

    movieTopics.sort(sortByNameDe);
    seriesTopics.sort(sortByNameDe);
    otherTopics.sort(sortByNameDe);

    const allSeries = [...seriesTopics, ...overflowTopics];
    const sections = [];

    if (movieTopics.length > 0) {
      const lines = [`🎬 *FILME NACH GENRE (${movieTopics.length})*`];
      for (const t of movieTopics) {
        const url = makeDeepLink(t.messageThreadId);
        const lbl = safeLinkLabel(t.topicName || t.topicKey);
        lines.push(url ? `• [${lbl}](${url}) ${fmtCount(t.postedCount)}` : `• *${lbl}* ${fmtCount(t.postedCount)}`);
      }
      sections.push(lines);
    }

    if (allSeries.length > 0) {
      const lines = [`📺 *SERIEN A–Z (${allSeries.length})*`];
      for (const t of allSeries) {
        const url = makeDeepLink(t.messageThreadId);
        const lbl = safeLinkLabel(t.topicName || t.topicKey);
        lines.push(url ? `• [${lbl}](${url}) ${fmtCount(t.postedCount)}` : `• *${lbl}* ${fmtCount(t.postedCount)}`);
      }
      sections.push(lines);
    }

    if (otherTopics.length > 0) {
      const lines = [`📦 *WEITERE THEMEN (${otherTopics.length})*`];
      for (const t of otherTopics) {
        const url = makeDeepLink(t.messageThreadId);
        const lbl = safeLinkLabel(t.topicName || t.topicKey);
        lines.push(url ? `• [${lbl}](${url}) ${fmtCount(t.postedCount)}` : `• *${lbl}* ${fmtCount(t.postedCount)}`);
      }
      sections.push(lines);
    }

    const totalTopics = movieTopics.length + allSeries.length + otherTopics.length;
    const nowDate = new Date();
    const pad2 = (v) => String(v).padStart(2, "0");
    const stampStr = `${pad2(nowDate.getUTCDate())}.${pad2(nowDate.getUTCMonth() + 1)}.${nowDate.getUTCFullYear()}, ${pad2(nowDate.getUTCHours())}:${pad2(nowDate.getUTCMinutes())} UTC`;

    const stableSignatureLines = sections.map(s => s.join("\n")).join("\n\n");
    const contentHash = computeSimpleArchiveHash(`${archiveChatId}|${totalTopics}|${totalPostedFiles}|${stableSignatureLines}`);

    const headerBase =
      `📌 *INHALTSVERZEICHNIS – THEMEN-ARCHIV*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🗂️ *Themen:* \`${totalTopics}\`  ·  🎞 *Archivierte Dateien:* \`${totalPostedFiles}\`\n` +
      `🕒 _Stand: ${stampStr}_`;

    if (totalTopics === 0) {
      return {
        parts: [`${headerBase}\n\n_Noch keine Themen im Archiv angelegt. Sobald der Bot erste Medien einsortiert, erscheinen hier alle klickbaren Themen mit Dateianzahl._`],
        contentHash,
        totalTopics: 0,
        totalPostedFiles
      };
    }

    // Sauber an Zeilengrenzen auf max. 3.700 Zeichen aufteilen (Telegram-Limit: 4.096)
    const MAX_PART_CHARS = 3700;
    const parts = [];
    let current = headerBase;

    for (const secLines of sections) {
      const secBlock = `\n\n${secLines.join("\n")}`;
      if (current.length + secBlock.length <= MAX_PART_CHARS) {
        current += secBlock;
      } else {
        // Abschnittsweise zeilenbasiert aufteilen
        for (let i = 0; i < secLines.length; i++) {
          const prefix = i === 0 ? "\n\n" : "\n";
          const addition = `${prefix}${secLines[i]}`;
          if (current.length + addition.length > MAX_PART_CHARS && current.trim().length > 0) {
            parts.push(current);
            current = i === 0
              ? `📌 *INHALTSVERZEICHNIS (Fortsetzung)*\n━━━━━━━━━━━━━━━━━━━━\n\n${secLines[i]}`
              : `📌 *INHALTSVERZEICHNIS (Fortsetzung)*\n━━━━━━━━━━━━━━━━━━━━\n\n${secLines[0]}\n${secLines[i]}`;
          } else {
            current += addition;
          }
        }
      }
    }
    if (current.trim().length > 0) parts.push(current);

    const finalParts = parts.length > 1
      ? parts.map((p, idx) => `${p}\n\n_Seite ${idx + 1}/${parts.length}_`)
      : parts;

    return {
      parts: finalParts,
      contentHash,
      totalTopics,
      totalPostedFiles
    };
  }

  async function syncArchiveDirectoryTopic(env, options = {}) {
    const force = Boolean(options.force);
    const subrequestCeiling = Math.max(24, Math.min(46, Number(options.subrequestCeiling || 42)));
    if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(subrequestCeiling - 4)) {
      return { ok: false, budgetExhausted: true, error: "Subrequest-Budget für Inhaltsverzeichnis erschöpft." };
    }

    const archiveChannels = typeof getHistoryIndexChannelsFromD1 === "function"
      ? await getHistoryIndexChannelsFromD1(env, { role: "archive_forum", onlyEnabled: true })
      : [];
    const archiveForum = archiveChannels[0] || null;
    if (!archiveForum || !archiveForum.channelId) {
      return { ok: false, error: "Kein aktives Themen-Archiv eingerichtet (/archiv_set)." };
    }
    const archiveChatId = archiveForum.channelId;
    const metaKey = `archive_dir_meta_${archiveChatId}`;
    const prevMeta = typeof getEntityFromD1 === "function"
      ? await getEntityFromD1(env, metaKey, 365 * 24 * 60 * 60 * 1000, { ramTtlMs: 30000 }).catch(() => null)
      : null;

    if (!force && prevMeta && Number(prevMeta.updatedAt || 0) > 0 && (Date.now() - Number(prevMeta.updatedAt)) < ARCHIVE_DIRECTORY_DEBOUNCE_MS) {
      return { ok: true, skippedDebounce: true, topicCount: Number(prevMeta.topicCount || 0), totalPostedFiles: Number(prevMeta.totalPosted || 0) };
    }

    const dirData = typeof getArchiveDirectoryDataFromD1 === "function"
      ? await getArchiveDirectoryDataFromD1(env, archiveChatId)
      : { topics: [], countsByTopicKey: {}, totalPostedFiles: 0 };
    const built = buildArchiveDirectoryMarkdownParts(archiveChatId, dirData);

    const api = tgApi(env);
    let dirTopic = typeof getArchiveTopicFromD1 === "function"
      ? await getArchiveTopicFromD1(env, archiveChatId, ARCHIVE_DIRECTORY_TOPIC_KEY)
      : null;

    // Hash-Gate: wenn Inhalt unverändert und Topic + mindestens 1 Nachricht existieren -> 0 Telegram-Calls!
    const prevMsgIds = Array.isArray(prevMeta?.msgIds) ? prevMeta.msgIds.map(n => Number(n)).filter(n => n > 0) : [];
    if (
      !force &&
      dirTopic &&
      dirTopic.messageThreadId > 0 &&
      prevMeta &&
      prevMeta.hash === built.contentHash &&
      prevMsgIds.length === built.parts.length &&
      prevMsgIds.length > 0
    ) {
      return {
        ok: true,
        skippedUnchanged: true,
        threadId: dirTopic.messageThreadId,
        topicCount: built.totalTopics,
        totalPostedFiles: built.totalPostedFiles,
        deepLink: `https://t.me/c/${String(archiveChatId).replace(/^-100/, "")}/${dirTopic.messageThreadId}`
      };
    }

    const createDirectoryTopicFresh = async () => {
      const created = await api.createForumTopic(archiveChatId, ARCHIVE_DIRECTORY_TOPIC_NAME, {
        icon_color: ARCHIVE_DIRECTORY_TOPIC_COLOR
      });
      if (!created?.ok || !created?.message_thread_id) {
        return { ok: false, error: created?.error || "Konnte Thema '📌 Inhaltsverzeichnis' nicht anlegen." };
      }
      const rec = {
        archiveChatId,
        topicKey: ARCHIVE_DIRECTORY_TOPIC_KEY,
        messageThreadId: Number(created.message_thread_id),
        topicName: ARCHIVE_DIRECTORY_TOPIC_NAME,
        iconColor: Number(created.icon_color || ARCHIVE_DIRECTORY_TOPIC_COLOR),
        pinnedHeaderMsgId: 0,
        updatedAt: Date.now()
      };
      if (typeof upsertArchiveTopicInD1 === "function") {
        await upsertArchiveTopicInD1(env, rec);
      }
      return { ok: true, topic: rec };
    };

    let topicNewlyCreated = false;
    if (!dirTopic || !dirTopic.messageThreadId) {
      const createdRes = await createDirectoryTopicFresh();
      if (!createdRes.ok) return { ok: false, error: createdRes.error };
      dirTopic = createdRes.topic;
      topicNewlyCreated = true;
    }

    let activeThreadId = Number(dirTopic.messageThreadId);
    const nextMsgIds = [];
    let recreatedTopic = false;
    let firstMsgNewlySent = false;
    let completedAllParts = true;
    let stopError = "";
    let rateLimited = false;

    for (let i = 0; i < built.parts.length; i++) {
      if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(subrequestCeiling - 1)) {
        completedAllParts = false;
        stopError = "Subrequest-Budget für Inhaltsverzeichnis erschöpft.";
        break;
      }
      const partText = built.parts[i];
      const existingId = !topicNewlyCreated && !recreatedTopic ? Number(prevMsgIds[i] || 0) : 0;
      let okId = 0;

      if (existingId > 0) {
        const edited = await api.editMessageText(archiveChatId, existingId, partText, {
          link_preview_options: { is_disabled: true }
        });
        if (edited && (edited.ok || edited.notModified)) {
          okId = existingId;
        }
      }

      if (okId <= 0) {
        const sent = await api.sendMessage(archiveChatId, partText, {
          message_thread_id: activeThreadId,
          disable_notification: true,
          link_preview_options: { is_disabled: true },
          _fromAntiSpamQueue: true
        });
        if (sent?._throttled429) {
          completedAllParts = false;
          rateLimited = true;
          stopError = `Telegram 429 Rate-Limit (${Number(sent.retryAfter || 5)}s)`;
          break;
        }
        if (sent?.guestOrBlocked || Number(sent?.status) === 403) {
          completedAllParts = false;
          stopError = String(sent?.error || "Keine Schreibrechte im Themen-Archiv (403).");
          break;
        }
        const sentMsgId = Number(sent?.result?.message_id || 0);
        const sentThreadId = Number(sent?.result?.message_thread_id || 0);

        // Self-Healing: Falls das Inhaltsverzeichnis-Thema gelöscht wurde und Telegram auf General zurückfiel -> neu anlegen!
        if (!recreatedTopic && (!sentMsgId || (sentThreadId !== activeThreadId))) {
          if (sentMsgId > 0) {
            await api.deleteMessage(archiveChatId, sentMsgId).catch(() => {});
          }
          const freshRes = await createDirectoryTopicFresh();
          if (!freshRes.ok) {
            return { ok: false, error: freshRes.error };
          }
          dirTopic = freshRes.topic;
          activeThreadId = Number(dirTopic.messageThreadId);
          recreatedTopic = true;
          nextMsgIds.length = 0;
          // Von vorne (Teil 0) in das neu angelegte Thema schreiben
          i = -1;
          continue;
        }
        if (sentMsgId > 0) {
          okId = sentMsgId;
          if (i === 0) firstMsgNewlySent = true;
        } else {
          completedAllParts = false;
          stopError = "Konnte Teilnachricht für Inhaltsverzeichnis nicht senden.";
          break;
        }
      }

      if (okId > 0) nextMsgIds.push(okId);
    }

    if (nextMsgIds.length === 0) {
      return {
        ok: false,
        rateLimited,
        error: stopError || "Inhaltsverzeichnis konnte nicht geschrieben werden."
      };
    }

    // Überzählige alte Teil-Nachrichten nur entfernen, wenn alle neuen Teile vollständig geschrieben wurden
    if (completedAllParts && !recreatedTopic && prevMsgIds.length > nextMsgIds.length) {
      for (let j = nextMsgIds.length; j < prevMsgIds.length; j++) {
        if (prevMsgIds[j] > 0) {
          await api.deleteMessage(archiveChatId, prevMsgIds[j]).catch(() => {});
        }
      }
    }

    // Erste Nachricht des Inhaltsverzeichnisses anpinnen (bei Neuanlage)
    const firstId = Number(nextMsgIds[0] || 0);
    if (firstId > 0 && (firstMsgNewlySent || topicNewlyCreated || recreatedTopic || Number(dirTopic.pinnedHeaderMsgId || 0) !== firstId)) {
      await api.pinChatMessage(archiveChatId, firstId, { disableNotification: true }).catch(() => {});
      if (typeof upsertArchiveTopicInD1 === "function") {
        await upsertArchiveTopicInD1(env, {
          ...dirTopic,
          messageThreadId: activeThreadId,
          pinnedHeaderMsgId: firstId,
          updatedAt: Date.now()
        }).catch(() => {});
      }
    }

    const nextMeta = {
      threadId: activeThreadId,
      msgIds: completedAllParts
        ? nextMsgIds
        : [...nextMsgIds, ...(!recreatedTopic ? prevMsgIds.slice(nextMsgIds.length) : [])],
      hash: completedAllParts ? built.contentHash : "",
      topicCount: built.totalTopics,
      totalPosted: built.totalPostedFiles,
      updatedAt: Date.now()
    };
    if (typeof saveEntityToD1 === "function") {
      await saveEntityToD1(env, metaKey, "system", nextMeta).catch(() => {});
    }

    const chatNum = String(archiveChatId).replace(/^-100/, "");
    return {
      ok: completedAllParts,
      partial: !completedAllParts,
      rateLimited,
      error: completedAllParts ? "" : stopError,
      threadId: activeThreadId,
      partsCount: nextMsgIds.length,
      topicCount: built.totalTopics,
      totalPostedFiles: built.totalPostedFiles,
      recreatedTopic,
      deepLink: chatNum && activeThreadId > 0 ? `https://t.me/c/${chatNum}/${activeThreadId}` : ""
    };
  }

  async function maybeAutoSyncArchiveDirectory(env, options = {}) {
    if (env._isCustomBotWebhook) return null;
    const defaults = typeof getHistoryArchiveDefaultsFromD1 === "function"
      ? await getHistoryArchiveDefaultsFromD1(env)
      : { autoUpdateAzIndex: true };
    if (defaults && defaults.autoUpdateAzIndex === false) return null;
    return await syncArchiveDirectoryTopic(env, {
      force: false,
      subrequestCeiling: Number(options.subrequestCeiling || 42)
    }).catch(() => null);
  }

  // =========================================================================
  // CHAT-STEUERUNG SCHRITT 1: INDEX-KANÄLE & THEMEN-ARCHIV + FORWARD-GATE
  // =========================================================================
  const HISTORY_CHAT_FORWARD_TTL_MS = 10 * 60 * 1000;
  const HISTORY_CHAT_STATE_TTL_MS = 30 * 60 * 1000;

  async function getHistoryChatAdminState(env, adminId) {
    const aid = String(adminId || "").trim();
    if (!aid) return null;
    const key = `hist_chat_state_${aid}`;
    const mem = memoryFallback.get(key);
    if (mem && typeof mem === "object" && (Date.now() - Number(mem.updatedAt || 0)) < HISTORY_CHAT_STATE_TTL_MS) {
      return mem;
    }
    if (typeof getEntityFromD1 === "function") {
      const stored = await getEntityFromD1(env, key, HISTORY_CHAT_STATE_TTL_MS, { ramTtlMs: 3000 }).catch(() => null);
      if (stored && typeof stored === "object") {
        memoryFallback.set(key, stored);
        return stored;
      }
    }
    return null;
  }

  async function saveHistoryChatAdminState(env, adminId, patch = {}) {
    const aid = String(adminId || "").trim();
    if (!aid) return null;
    const key = `hist_chat_state_${aid}`;
    const prev = (await getHistoryChatAdminState(env, aid)) || {};
    const next = {
      ...prev,
      ...patch,
      updatedAt: Date.now()
    };
    memoryFallback.set(key, next);
    if (typeof saveEntityToD1 === "function") {
      await saveEntityToD1(env, key, "system", next).catch(() => {});
    }
    return next;
  }

  async function resolveHistoryChatAdminContext(env, tgMsg, { isChannelPost = false } = {}) {
    if (!tgMsg || !tgMsg.chat?.id || env._isCustomBotWebhook) {
      return { authorized: false };
    }
    const chatId = String(tgMsg.chat.id);
    const isGroupOrChannel = isChannelPost || isGroupOrChannelChat(tgMsg.chat.id);
    const actorId = tgMsg.from?.id ? String(tgMsg.from.id) : "";
    const isAnonymousGroupAdmin = Boolean(
      isGroupOrChannel &&
      !isChannelPost &&
      (
        actorId === "1087968824" ||
        (tgMsg.sender_chat?.id && String(tgMsg.sender_chat.id) === chatId) ||
        !actorId
      )
    );

    let adminDmId = "";
    if (!isGroupOrChannel) {
      if (actorId && await isTelegramBotAdmin(env, actorId)) {
        adminDmId = actorId;
      }
    } else if (!isChannelPost && !isAnonymousGroupAdmin && actorId) {
      if (await isTelegramBotAdmin(env, actorId)) {
        adminDmId = actorId;
      }
    } else {
      adminDmId = await resolveBotAdminIdForChannelChat(env, chatId);
    }

    if (!adminDmId) {
      return { authorized: false };
    }
    return {
      authorized: true,
      adminDmId,
      isGroupOrChannel,
      isChannelPost,
      sourceChatId: chatId,
      sourceTitle: String(tgMsg.chat.title || tgMsg.chat.username || chatId),
      messageId: Number(tgMsg.message_id || 0),
      threadId: tgMsg.message_thread_id ? Number(tgMsg.message_thread_id) : undefined
    };
  }

  async function sendHistoryGroupDmFallbackNotice(env, sourceChatId, threadId, isChannelPost) {
    if (isChannelPost || !sourceChatId) return;
    const { sendMessage, deleteMessage } = tgApi(env);
    const opts = threadId ? { message_thread_id: threadId } : {};
    const sent = await sendMessage(
      sourceChatId,
      `ℹ️ *Bitte starte mich einmalig im Privat-Chat mit \`/start\`*, damit ich dir das Admin-Menü dort privat zustellen kann.`,
      opts
    );
    const ctx = typeof getActiveWorkerCtx === "function" ? getActiveWorkerCtx() : null;
    if (sent?.result?.message_id && ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil((async () => {
        await new Promise(r => setTimeout(r, 10000));
        await deleteMessage(sourceChatId, sent.result.message_id).catch(() => {});
      })());
    }
  }

  function formatArchiveModeShortLabel(mode) {
    if (mode === "per_series_plus_genre") return "Je Serie + Film-Genres";
    if (mode === "compact_type") return "Kompakt";
    return "Typ + Genre";
  }

  function formatValidationChecksMarkdown(resObj) {
    if (!resObj) return "";
    const parts = [];
    if (Array.isArray(resObj.checks) && resObj.checks.length > 0) {
      parts.push(resObj.checks.map(c => `${c.ok ? "✅" : "❌"} ${escapeMd(c.label)}`).join("\n"));
    }
    if (resObj.error) {
      parts.push(`⛔ ${escapeMd(resObj.error)}`);
    }
    if (Array.isArray(resObj.warnings) && resObj.warnings.length > 0) {
      parts.push(resObj.warnings.map(w => `⚠️ ${escapeMd(w)}`).join("\n"));
    }
    return parts.join("\n");
  }

  async function resolveHistoryCanonicalChannelIdFromChat(env, rawTarget) {
    const str = String(rawTarget || "").trim();
    if (!str) return { ok: false, error: "Keine Chat-ID oder Telegram-Link angegeben." };
    const parsed = parseTelegramMessageLink(str);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (/^-\d{5,20}$/.test(parsed.chatId)) {
      return { ok: true, chatId: parsed.chatId, messageId: parsed.messageId || 0, title: "" };
    }
    const chatInfo = await tgApi(env).getChat(parsed.chatId, { bypassCache: true });
    if (!chatInfo.ok || !chatInfo.canonicalChatId) {
      return { ok: false, error: `Chat '${str}' konnte nicht aufgelöst werden (${chatInfo.error || "nicht erreichbar"}).` };
    }
    return {
      ok: true,
      chatId: chatInfo.canonicalChatId,
      messageId: parsed.messageId || 0,
      title: String(chatInfo.title || "")
    };
  }

  async function addHistoryProbeIndexChannelFromChat(env, rawTarget, labelHint = "") {
    const resolved = await resolveHistoryCanonicalChannelIdFromChat(env, rawTarget);
    if (!resolved.ok) return { ok: false, error: escapeMd(resolved.error) };
    const targetId = resolved.chatId;

    const [channels, archiveDefaults] = await Promise.all([
      getHistoryIndexChannelsFromD1(env),
      getHistoryArchiveDefaultsFromD1(env)
    ]);
    const existingProbes = channels.filter(c => c.role === "probe_index");
    const existingArchive = channels.find(c => c.role === "archive_forum") || null;

    if (existingArchive && existingArchive.channelId === targetId) {
      return {
        ok: false,
        error: "Dieser Chat ist bereits als Sortiertes Themen-Archiv hinterlegt und darf nicht gleichzeitig ein Index-Kanal mit Auto-Löschung sein."
      };
    }

    const alreadyIdx = existingProbes.findIndex(c => c.channelId === targetId);
    if (alreadyIdx < 0 && existingProbes.length >= 3) {
      return {
        ok: false,
        error: "Es sind bereits 3 Index-Kanäle konfiguriert (Maximum). Bitte entferne zuerst einen bestehenden Index-Kanal mit `/index_del`."
      };
    }

    const check = await validateHistoryChannelAccess(env, targetId, "probe_index");
    if (!check.ok) {
      return {
        ok: false,
        error: `Rechteprüfung für Index-Kanal fehlgeschlagen:\n${formatValidationChecksMarkdown(check)}`,
        validation: check
      };
    }

    const nextProbes = existingProbes.map(c => ({
      channelId: c.channelId,
      label: c.label,
      enabled: c.enabled
    }));
    const finalLabel = String(labelHint || check.title || resolved.title || `Index-Kanal ${nextProbes.length + 1}`).trim().slice(0, 80);
    if (alreadyIdx >= 0) {
      nextProbes[alreadyIdx] = { channelId: targetId, label: finalLabel, enabled: true };
    } else {
      nextProbes.push({ channelId: targetId, label: finalLabel, enabled: true });
    }

    const saveRes = await saveHistoryIndexChannelsInD1(env, {
      probeChannels: nextProbes,
      archiveForum: existingArchive
        ? { channelId: existingArchive.channelId, label: existingArchive.label, enabled: existingArchive.enabled }
        : null,
      archiveDefaults
    });
    if (!saveRes.ok) return { ok: false, error: escapeMd(saveRes.error || "Konnte Index-Kanal nicht speichern.") };

    await updateHistoryIndexChannelVerificationInD1(env, targetId, {
      verifiedAt: Date.now(),
      caps: { ok: true, title: check.title, chatType: check.chatType, checks: check.checks },
      label: finalLabel
    });

    return {
      ok: true,
      channelId: targetId,
      title: finalLabel,
      totalProbes: nextProbes.length,
      alreadyExisted: alreadyIdx >= 0
    };
  }

  async function removeHistoryProbeIndexChannelFromChat(env, targetIdOrIndex) {
    const [channels, archiveDefaults] = await Promise.all([
      getHistoryIndexChannelsFromD1(env),
      getHistoryArchiveDefaultsFromD1(env)
    ]);
    const existingProbes = channels.filter(c => c.role === "probe_index");
    const existingArchive = channels.find(c => c.role === "archive_forum") || null;

    let targetChannel = null;
    if (typeof targetIdOrIndex === "number" && Number.isInteger(targetIdOrIndex)) {
      targetChannel = existingProbes[targetIdOrIndex] || null;
    } else {
      const resolved = await resolveHistoryCanonicalChannelIdFromChat(env, String(targetIdOrIndex || ""));
      const targetId = resolved.ok ? resolved.chatId : String(targetIdOrIndex || "").trim();
      targetChannel = existingProbes.find(c => c.channelId === targetId) || null;
    }

    if (!targetChannel) {
      return { ok: false, error: "Dieser Kanal ist aktuell nicht als Index-Kanal eingetragen." };
    }

    const nextProbes = existingProbes
      .filter(c => c.channelId !== targetChannel.channelId)
      .map(c => ({ channelId: c.channelId, label: c.label, enabled: c.enabled }));

    const saveRes = await saveHistoryIndexChannelsInD1(env, {
      probeChannels: nextProbes,
      archiveForum: existingArchive
        ? { channelId: existingArchive.channelId, label: existingArchive.label, enabled: existingArchive.enabled }
        : null,
      archiveDefaults
    });
    if (!saveRes.ok) return saveRes;

    return {
      ok: true,
      removedTitle: targetChannel.label || targetChannel.channelId,
      removedId: targetChannel.channelId,
      hadPendingDeletes: Number(targetChannel.pendingDeleteCount || 0) > 0
    };
  }

  async function setHistoryArchiveForumFromChat(env, rawTarget, labelHint = "") {
    const resolved = await resolveHistoryCanonicalChannelIdFromChat(env, rawTarget);
    if (!resolved.ok) return { ok: false, error: escapeMd(resolved.error) };
    const targetId = resolved.chatId;

    const [channels, archiveDefaults] = await Promise.all([
      getHistoryIndexChannelsFromD1(env),
      getHistoryArchiveDefaultsFromD1(env)
    ]);
    const existingProbes = channels.filter(c => c.role === "probe_index");

    if (existingProbes.some(c => c.channelId === targetId)) {
      return {
        ok: false,
        error: "Dieser Chat ist bereits ein Index-Kanal mit Auto-Löschung und darf nicht gleichzeitig als Themen-Archiv genutzt werden."
      };
    }

    const check = await validateHistoryChannelAccess(env, targetId, "archive_forum");
    if (!check.ok) {
      return {
        ok: false,
        error: `Rechteprüfung für Themen-Archiv fehlgeschlagen:\n${formatValidationChecksMarkdown(check)}`,
        validation: check
      };
    }

    const finalLabel = String(labelHint || check.title || resolved.title || "Sortiertes Themen-Archiv").trim().slice(0, 80);
    const saveRes = await saveHistoryIndexChannelsInD1(env, {
      probeChannels: existingProbes.map(c => ({ channelId: c.channelId, label: c.label, enabled: c.enabled })),
      archiveForum: { channelId: targetId, label: finalLabel, enabled: true },
      archiveDefaults
    });
    if (!saveRes.ok) return { ok: false, error: escapeMd(saveRes.error || "Konnte Themen-Archiv nicht speichern.") };

    await updateHistoryIndexChannelVerificationInD1(env, targetId, {
      verifiedAt: Date.now(),
      caps: { ok: true, title: check.title, isForum: check.isForum, checks: check.checks, warnings: check.warnings },
      label: finalLabel
    });

    return {
      ok: true,
      channelId: targetId,
      title: finalLabel,
      warnings: Array.isArray(check.warnings) ? check.warnings : []
    };
  }

  async function removeHistoryArchiveForumFromChat(env) {
    const [channels, archiveDefaults] = await Promise.all([
      getHistoryIndexChannelsFromD1(env),
      getHistoryArchiveDefaultsFromD1(env)
    ]);
    const existingProbes = channels.filter(c => c.role === "probe_index");
    const existingArchive = channels.find(c => c.role === "archive_forum") || null;
    if (!existingArchive) {
      return { ok: false, error: "Es ist aktuell kein Sortiertes Themen-Archiv konfiguriert." };
    }
    const saveRes = await saveHistoryIndexChannelsInD1(env, {
      probeChannels: existingProbes.map(c => ({ channelId: c.channelId, label: c.label, enabled: c.enabled })),
      archiveForum: null,
      archiveDefaults
    });
    if (!saveRes.ok) return saveRes;
    return { ok: true, removedTitle: existingArchive.label || existingArchive.channelId };
  }

  async function renderHistoryConfigChatMenu(env, adminDmId, editMsgId = null, note = "") {
    const { sendMessage, editMessageText } = tgApi(env);
    const [channels, archiveDefaults, adminState] = await Promise.all([
      getHistoryIndexChannelsFromD1(env),
      getHistoryArchiveDefaultsFromD1(env),
      getHistoryChatAdminState(env, adminDmId)
    ]);
    const probes = channels.filter(c => c.role === "probe_index");
    const enabledProbes = probes.filter(p => p.enabled);
    const archiveForum = channels.find(c => c.role === "archive_forum") || null;
    const pendingDeletesTotal = probes.reduce((acc, p) => acc + Number(p.pendingDeleteCount || 0), 0);

    const activeForwardWait = Boolean(
      adminState?.awaitingForwardRole &&
      Number(adminState?.awaitingForwardExpiresAt || 0) > Date.now()
    );

    const probeLines = probes.length === 0
      ? `_Noch kein Index-Kanal eingerichtet._\n💡 Sende \`/index_add\` direkt in deinen privaten Index-Kanal oder klicke unten auf *Per Weiterleitung hinzufügen*.`
      : probes.map((p, idx) => {
          const icon = !p.enabled ? "⚪" : (p.verifiedCaps?.ok ? "✅" : (p.verifiedCaps?.ok === false ? "⛔" : "🟢"));
          const delInfo = p.pendingDeleteCount > 0 ? ` · 🧹 ${p.pendingDeleteCount} Rest-Probes` : "";
          return `${icon} *#${idx + 1} ${escapeMd(p.label || p.channelId)}*\n   \`${escapeMd(p.channelId)}\`${delInfo}`;
        }).join("\n");

    const archiveLine = archiveForum
      ? `${archiveForum.enabled ? (archiveForum.verifiedCaps?.ok === false ? "⛔" : "✅") : "⚪"} *${escapeMd(archiveForum.label || archiveForum.channelId)}*\n   \`${escapeMd(archiveForum.channelId)}\`\n   📁 *Standard:* ${escapeMd(formatArchiveModeShortLabel(archiveDefaults.topicMode))} · ${archiveDefaults.timing === "after_scan" ? "Nach Scan-Ende" : "Live"} · Pin: ${archiveDefaults.pinSeriesCard ? "AN" : "AUS"}`
      : `_Kein Themen-Archiv eingerichtet (optional)._\n💡 Sende \`/archiv_set\` direkt in deiner privaten Forum-Supergruppe oder nutze den Button unten.`;

    const forwardBanner = activeForwardWait
      ? `\n\n📨 *Weiterleitungs-Modus aktiv (${adminState.awaitingForwardRole === "archive_forum" ? "Themen-Archiv" : "Index-Kanal"}):*\n_Leite jetzt einfach eine Nachricht aus dem gewünschten Kanal weiter (oder sende hier einen t.me/c/... Link bzw. die -100... ID)._`
      : "";

    const speedInfo = enabledProbes.length > 0
      ? `~${enabledProbes.length * 15} IDs/Min (${enabledProbes.length}/3 aktiv)`
      : `0/3 aktiv`;

    const notifyStatusLine = archiveDefaults.notifyAdminDm !== false
      ? `🔔 *Admin-Hinweise (lautlos):* ✅ AN (25/50/75 %, 100 % & Fehler)`
      : `🔕 *Admin-Hinweise (lautlos):* AUS`;

    const msgText =
      `⚙️ *INDEX-KANÄLE & SORTIERTES THEMEN-ARCHIV*\n${SEP}\n` +
      `📡 *Private Index-Kanäle (Auto-Löschung):* ${speedInfo}\n${probeLines}\n\n` +
      `🗂️ *Sortiertes Themen-Archiv (optional):*\n${archiveLine}\n` +
      `${notifyStatusLine}` +
      forwardBanner +
      (note ? `\n\n${note}` : "") +
      `\n\n📌 *Chat-Befehle:* \`/index_add\`, \`/index_del\`, \`/archiv_set\`, \`/archiv_del\` (direkt im Kanal/Forum oder hier mit Link/ID).`;

    const inline_keyboard = [];
    if (activeForwardWait) {
      inline_keyboard.push([{ text: "❌ Weiterleitungs-Modus abbrechen", callback_data: "hc:cfg_fcancel" }]);
    } else {
      const addRow = [];
      if (probes.length < 3) {
        addRow.push({ text: `➕ Index per Weiterleitung (${probes.length}/3)`, callback_data: "hc:cfg_fidx" });
      }
      addRow.push({ text: archiveForum ? "🔄 Archiv neu setzen" : "🗂️ Archiv setzen", callback_data: "hc:cfg_farch" });
      inline_keyboard.push(addRow);
    }

    if (probes.length > 0) {
      inline_keyboard.push(
        probes.slice(0, 3).map((p, idx) => ({
          text: `🗑️ Index #${idx + 1}`,
          callback_data: `hc:cfg_rm:${idx}`
        }))
      );
    }
    if (archiveForum) {
      inline_keyboard.push([
        { text: `📁 ${formatArchiveModeShortLabel(archiveDefaults.topicMode)}`, callback_data: "hc:cfg_mode" },
        { text: archiveDefaults.timing === "after_scan" ? "🕒 Nach Scan" : "🕒 Live", callback_data: "hc:cfg_time" }
      ]);
      inline_keyboard.push([
        { text: archiveDefaults.pinSeriesCard ? "📌 Serien-Pin: AN" : "📌 Serien-Pin: AUS", callback_data: "hc:cfg_pin" },
        { text: archiveDefaults.autoUpdateAzIndex !== false ? "📑 Auto-Verzeichnis: AN" : "📑 Auto-Verzeichnis: AUS", callback_data: "hc:cfg_dir" }
      ]);
      inline_keyboard.push([
        { text: "🗑️ Archiv lösen", callback_data: "hc:cfg_rmarch" }
      ]);
    }

    const diagRow = [
      { text: archiveDefaults.notifyAdminDm !== false ? "🔔 Hinweise: AN" : "🔕 Hinweise: AUS", callback_data: "hc:cfg_notify" },
      { text: "🩺 Rechte prüfen", callback_data: "hc:cfg_val" }
    ];
    inline_keyboard.push(diagRow);
    if (pendingDeletesTotal > 0) {
      inline_keyboard.push([{ text: `🧹 ${pendingDeletesTotal} Rest-Probes löschen`, callback_data: "hc:cfg_delp" }]);
    }
    inline_keyboard.push([
      { text: "📋 Jobs & Archiv", callback_data: "hc:jobs" },
      { text: "🔄 Aktualisieren", callback_data: "hc:cfg_ref" },
      { text: "✖️ Schließen", callback_data: "close_bot_msg" }
    ]);

    if (editMsgId) {
      const edited = await editMessageText(adminDmId, editMsgId, msgText, { reply_markup: { inline_keyboard } });
      if (edited) return edited;
    }
    return await sendMessage(adminDmId, msgText, { reply_markup: { inline_keyboard } });
  }

  async function handleHistoryChatSetupCommand(env, tgMsg, { isChannelPost = false } = {}) {
    if (!tgMsg || !tgMsg.chat?.id || env._isCustomBotWebhook) return false;
    const rawText = String(tgMsg.text || tgMsg.caption || "").trim();
    const cmdMatch = rawText.match(/^\/(index|index_add|index_del|index_remove|archiv_set|archiv_del|archiv_remove)(?:@\w+)?(?:\s+([^\s]+))?(?:\s+(.*))?$/i);
    if (!cmdMatch) return false;

    const cmd = cmdMatch[1].toLowerCase();
    const argTarget = String(cmdMatch[2] || "").trim();
    const argExtra = String(cmdMatch[3] || "").trim();

    const adminCtx = await resolveHistoryChatAdminContext(env, tgMsg, { isChannelPost });
    if (!adminCtx.authorized) {
      // Unberechtigte Nutzer in Gruppen/Kanälen lautlos ignorieren (0 Spam, 0 D1-Writes)
      if (!isChannelPost && !isGroupOrChannelChat(tgMsg.chat.id)) {
        await tgApi(env).sendMessage(tgMsg.chat.id, "🔒 Dieser Befehl steht nur Bot-Administratoren zur Verfügung.");
      }
      return true;
    }

    let deleteWarning = "";
    if (adminCtx.isGroupOrChannel && adminCtx.messageId > 0) {
      const deleted = await tgApi(env).deleteMessage(adminCtx.sourceChatId, adminCtx.messageId).catch(() => false);
      if (!deleted) {
        deleteWarning = "\n_ℹ️ Hinweis: Befehl konnte im Quellchat nicht automatisch gelöscht werden (fehlendes Löschrecht)._";
      }
    }

    let note = "";
    if (cmd === "index") {
      await saveHistoryChatAdminState(env, adminCtx.adminDmId, { awaitingForwardRole: "", awaitingForwardExpiresAt: 0 });
    } else if (cmd === "index_add") {
      const target = argTarget || (adminCtx.isGroupOrChannel ? adminCtx.sourceChatId : "");
      if (!target) {
        await saveHistoryChatAdminState(env, adminCtx.adminDmId, {
          awaitingForwardRole: "probe_index",
          awaitingForwardExpiresAt: Date.now() + HISTORY_CHAT_FORWARD_TTL_MS
        });
        note = "📨 *Weiterleitungs-Modus gestartet:* Leite jetzt eine Nachricht aus deinem privaten Index-Kanal hierher weiter (oder sende dessen `t.me/c/...` Link bzw. `-100...` ID).";
      } else {
        await saveHistoryChatAdminState(env, adminCtx.adminDmId, { awaitingForwardRole: "", awaitingForwardExpiresAt: 0 });
        const addRes = await addHistoryProbeIndexChannelFromChat(env, target, argExtra || (adminCtx.isGroupOrChannel ? adminCtx.sourceTitle : ""));
        note = addRes.ok
          ? `✅ *Index-Kanal gespeichert:* *${escapeMd(addRes.title)}* (\`${escapeMd(addRes.channelId)}\`) — ${addRes.totalProbes}/3 aktiv.`
          : `⚠️ ${addRes.error}`;
      }
    } else if (cmd === "index_del" || cmd === "index_remove") {
      const target = argTarget || (adminCtx.isGroupOrChannel ? adminCtx.sourceChatId : "");
      if (!target) {
        note = "ℹ️ Tippe unten auf den gewünschten *🗑️ Index #…* Button oder sende `/index_del -100...` (bzw. direkt im Index-Kanal).";
      } else {
        const rmRes = await removeHistoryProbeIndexChannelFromChat(env, target);
        note = rmRes.ok
          ? (rmRes.hadPendingDeletes
              ? `⏸️ *Index-Kanal deaktiviert:* *${escapeMd(rmRes.removedTitle)}* (hat noch offene Rest-Probes zur Löschung).`
              : `🗑️ *Index-Kanal entfernt:* *${escapeMd(rmRes.removedTitle)}*.`)
          : `⚠️ ${escapeMd(rmRes.error || "Konnte Index-Kanal nicht entfernen.")}`;
      }
    } else if (cmd === "archiv_set") {
      const target = argTarget || (adminCtx.isGroupOrChannel ? adminCtx.sourceChatId : "");
      if (!target) {
        await saveHistoryChatAdminState(env, adminCtx.adminDmId, {
          awaitingForwardRole: "archive_forum",
          awaitingForwardExpiresAt: Date.now() + HISTORY_CHAT_FORWARD_TTL_MS
        });
        note = "📨 *Themen-Archiv einrichten:* Sende `/archiv_set` am einfachsten direkt in deiner privaten Forum-Supergruppe — oder füge hier deren `t.me/c/...` Link bzw. `-100...` ID ein.";
      } else {
        await saveHistoryChatAdminState(env, adminCtx.adminDmId, { awaitingForwardRole: "", awaitingForwardExpiresAt: 0 });
        const setRes = await setHistoryArchiveForumFromChat(env, target, argExtra || (adminCtx.isGroupOrChannel ? adminCtx.sourceTitle : ""));
        if (setRes.ok) {
          const wText = setRes.warnings?.length > 0 ? `\n⚠️ ${setRes.warnings.map(w => escapeMd(w)).join("\n⚠️ ")}` : "";
          note = `✅ *Sortiertes Themen-Archiv gesetzt:* *${escapeMd(setRes.title)}* (\`${escapeMd(setRes.channelId)}\`).${wText}`;
        } else {
          note = `⚠️ ${setRes.error}`;
        }
      }
    } else if (cmd === "archiv_del" || cmd === "archiv_remove") {
      const rmRes = await removeHistoryArchiveForumFromChat(env);
      note = rmRes.ok
        ? `🗑️ *Themen-Archiv gelöst:* *${escapeMd(rmRes.removedTitle)}* (bestehende Posts in Telegram bleiben unberührt).`
        : `⚠️ ${escapeMd(rmRes.error || "Konnte Themen-Archiv nicht entfernen.")}`;
    }

    const dmRes = await renderHistoryConfigChatMenu(env, adminCtx.adminDmId, null, `${note}${deleteWarning}`.trim());
    if (!dmRes || !dmRes.ok) {
      await sendHistoryGroupDmFallbackNotice(env, adminCtx.sourceChatId, adminCtx.threadId, isChannelPost);
    }
    return true;
  }

  // Forward-Vorrang im Privat-Chat (VOR handleIncomingMediaOrJson!):
  // Fängt weitergeleitete Videos/Texte oder Links ab, wenn der Admin im Setup- oder Scan-Weiterleitungsmodus ist (0 Extra-D1-Reads für normale Nutzer!).
  async function handleHistoryChatForwardInput(env, message) {
    if (!message || !message.chat?.id || env._isCustomBotWebhook) return false;
    if (isGroupOrChannelChat(message.chat.id)) return false;
    const rawText = String(message.text || message.caption || "").trim();
    if (rawText.startsWith("/")) return false;

    const isForwarded = Boolean(
      message.forward_origin ||
      message.forward_from_chat ||
      message.forward_from ||
      message.forward_sender_name
    );
    const firstToken = rawText ? rawText.split(/\s+/)[0] : "";
    const restTokens = rawText ? rawText.slice(firstToken.length).trim() : "";
    const looksLikeTargetInput = Boolean(
      firstToken &&
      (/^-100\d{5,20}$/.test(firstToken) || /(?:t\.me|telegram\.me)\//i.test(firstToken) || /^@[A-Za-z0-9_]{4,64}$/.test(firstToken))
    );
    if (!isForwarded && !looksLikeTargetInput) return false;

    const adminId = message.from?.id ? String(message.from.id) : "";
    if (!adminId || !(await isTelegramBotAdmin(env, adminId))) return false;

    const state = await getHistoryChatAdminState(env, adminId);
    const role = String(state?.awaitingForwardRole || "");
    if (!role || Number(state?.awaitingForwardExpiresAt || 0) <= Date.now()) {
      return false;
    }

    let extractedChatId = "";
    let extractedTitle = "";
    let extractedMsgId = 0;
    let privacyHiddenGroup = false;

    if (isForwarded) {
      const origin = message.forward_origin || null;
      if (origin && origin.type === "channel" && origin.chat?.id) {
        extractedChatId = String(origin.chat.id);
        extractedTitle = String(origin.chat.title || origin.chat.username || "");
        extractedMsgId = Number(origin.message_id || message.forward_from_message_id || 0);
      } else if (origin && origin.type === "chat" && origin.sender_chat?.id) {
        extractedChatId = String(origin.sender_chat.id);
        extractedTitle = String(origin.sender_chat.title || origin.sender_chat.username || "");
        extractedMsgId = Number(message.forward_from_message_id || 0);
      } else if (message.forward_from_chat?.id) {
        extractedChatId = String(message.forward_from_chat.id);
        extractedTitle = String(message.forward_from_chat.title || message.forward_from_chat.username || "");
        extractedMsgId = Number(message.forward_from_message_id || 0);
      } else {
        privacyHiddenGroup = true;
      }
    } else if (looksLikeTargetInput) {
      extractedChatId = firstToken;
    }

    if (privacyHiddenGroup || !extractedChatId) {
      const targetCmd = role === "archive_forum" ? "/archiv_set" : (role === "scan_source" ? "/scan" : "/index_add");
      const privacyHint =
        `ℹ️ *Telegram verbirgt bei normalen Gruppen-Weiterleitungen die Gruppen-ID.*\n` +
        `Sende stattdessen einfach \`${targetCmd}\` direkt in der gewünschten Gruppe/Forum-Supergruppe *oder* füge hier einen Nachrichten-Link (\`https://t.me/c/.../123\`) ein.`;
      if (role === "scan_source") {
        await tgApi(env).sendMessage(adminId, privacyHint, {
          reply_markup: { inline_keyboard: [[{ text: "❌ Abbrechen", callback_data: "hc:d_cancel" }, { text: "📋 Laufende Jobs", callback_data: "hc:jobs" }]] }
        });
      } else {
        await renderHistoryConfigChatMenu(env, adminId, null, privacyHint);
      }
      return true;
    }

    await saveHistoryChatAdminState(env, adminId, { awaitingForwardRole: "", awaitingForwardExpiresAt: 0 });

    if (role === "probe_index") {
      const addRes = await addHistoryProbeIndexChannelFromChat(env, extractedChatId, extractedTitle);
      const note = addRes.ok
        ? `✅ *Index-Kanal per Weiterleitung hinzugefügt:* *${escapeMd(addRes.title)}* (\`${escapeMd(addRes.channelId)}\`) — ${addRes.totalProbes}/3 aktiv.`
        : `⚠️ ${addRes.error}`;
      await renderHistoryConfigChatMenu(env, adminId, null, note);
      return true;
    }

    if (role === "archive_forum") {
      const setRes = await setHistoryArchiveForumFromChat(env, extractedChatId, extractedTitle);
      const wText = setRes.ok && setRes.warnings?.length > 0 ? `\n⚠️ ${setRes.warnings.map(w => escapeMd(w)).join("\n⚠️ ")}` : "";
      const note = setRes.ok
        ? `✅ *Sortiertes Themen-Archiv gesetzt:* *${escapeMd(setRes.title)}* (\`${escapeMd(setRes.channelId)}\`).${wText}`
        : `⚠️ ${setRes.error}`;
      await renderHistoryConfigChatMenu(env, adminId, null, note);
      return true;
    }

    if (role === "scan_source") {
      await openHistoryScanDraftForAdmin(env, adminId, {
        rawTarget: extractedChatId,
        titleHint: extractedTitle,
        detectedEndId: extractedMsgId,
        rangeArg: isForwarded ? "" : restTokens,
        preferArchive: Boolean(state?.awaitingScanPreferArchive)
      });
      return true;
    }

    return false;
  }

  // =========================================================================
  // CHAT-STEUERUNG SCHRITT 2: INTERAKTIVER SCAN-START (/scan, /archiv) & /jobs
  // =========================================================================
  function computeHistoryJobProgressPct(job) {
    if (!job) return 0;
    if (job.status === "completed") return 100;
    const startId = Math.max(1, Number(job.startMsgId || 1));
    const endId = Math.max(startId, Number(job.endMsgId || startId));
    const totalSpan = Math.max(1, (endId - startId) + 1);
    const cur = Number(job.currentCursorId || startId);
    if (job.direction === "desc") {
      const floor = Math.max(startId, Number(job.chunkFloorId || startId));
      const ceil = Math.min(endId, floor + HISTORY_REVERSE_BLOCK_SIZE - 1);
      const doneAboveBlock = Math.max(0, endId - ceil);
      const doneInBlock = Math.max(0, Math.min(ceil - floor + 1, cur - floor));
      return Math.max(0, Math.min(99, Math.round(((doneAboveBlock + doneInBlock) / totalSpan) * 100)));
    }
    const doneAsc = Math.max(0, cur - startId);
    return Math.max(0, Math.min(99, Math.round((doneAsc / totalSpan) * 100)));
  }

  function formatHistoryJobStatusBadge(status) {
    if (status === "running") return "🟢 Läuft";
    if (status === "queued") return "🕒 Warteschlange";
    if (status === "paused") return "⏸️ Pausiert";
    if (status === "flood_wait") return "⏳ Flood-Pause";
    if (status === "completed") return "✅ Fertig";
    if (status === "error") return "⛔ Fehler";
    return `ℹ️ ${String(status || "?")}`;
  }

  function formatDeInt(n) {
    return Number(n || 0).toLocaleString("de-DE");
  }

  function parseHistoryScanRangeArg(rawRangeStr, fallbackEndId = 0) {
    const str = String(rawRangeStr || "").trim();
    const safeFallbackEnd = Math.max(0, Math.min(2000000000, Math.floor(Number(fallbackEndId || 0))));

    if (!str) {
      if (safeFallbackEnd <= 0) {
        return { ok: false, missingEndId: true };
      }
      const startMsgId = Math.max(1, safeFallbackEnd - 2000 + 1);
      return { ok: true, startMsgId, endMsgId: safeFallbackEnd, rangePreset: "2000" };
    }

    if (/^(?:all|alle|komplett|full)$/i.test(str)) {
      if (safeFallbackEnd <= 0) return { ok: false, missingEndId: true };
      return { ok: true, startMsgId: 1, endMsgId: safeFallbackEnd, rangePreset: "all" };
    }

    // Bereich: "1200-4500", "1200..4500", "1200:4500", "1200 4500"
    const rangeMatch = str.match(/^(\d{1,10})\s*(?:-|\.\.|:|\s+)\s*(\d{1,10})$/);
    if (rangeMatch) {
      const a = Math.max(1, Math.min(2000000000, parseInt(rangeMatch[1], 10)));
      const b = Math.max(1, Math.min(2000000000, parseInt(rangeMatch[2], 10)));
      const startMsgId = Math.min(a, b);
      const endMsgId = Math.max(a, b);
      return { ok: true, startMsgId, endMsgId, rangePreset: "custom" };
    }

    // Einzelzahl: "500" -> letzte N IDs bis fallbackEndId
    const singleMatch = str.match(/^(\d{1,8})$/);
    if (singleMatch) {
      const count = Math.max(1, Math.min(20000000, parseInt(singleMatch[1], 10)));
      if (safeFallbackEnd <= 0) {
        return { ok: false, missingEndId: true, requestedCount: count };
      }
      const startMsgId = Math.max(1, safeFallbackEnd - count + 1);
      const preset = (count === 500 || count === 2000 || count === 5000) ? String(count) : "custom";
      return { ok: true, startMsgId, endMsgId: safeFallbackEnd, rangePreset: preset };
    }

    return { ok: false, error: `Unbekanntes Bereichsformat '${escapeMd(str)}'. Erlaubt sind z. B. \`500\`, \`1200-4500\` oder \`komplett\`.` };
  }

  function applyHistoryDraftRangePreset(draft, preset) {
    if (!draft) return draft;
    const baseEnd = Math.max(1, Number(draft.detectedEndId || draft.endMsgId || 1));
    if (preset === "all") {
      return { ...draft, startMsgId: 1, endMsgId: baseEnd, rangePreset: "all" };
    }
    const n = parseInt(String(preset || "2000"), 10);
    if (Number.isInteger(n) && n > 0) {
      return { ...draft, startMsgId: Math.max(1, baseEnd - n + 1), endMsgId: baseEnd, rangePreset: String(n) };
    }
    return draft;
  }

  async function openHistoryScanDraftForAdmin(env, adminDmId, {
    rawTarget = "",
    titleHint = "",
    detectedEndId = 0,
    usedReplyEndId = false,
    rangeArg = "",
    preferArchive = false,
    extraNote = ""
  } = {}) {
    const { sendMessage } = tgApi(env);
    const resolved = await resolveHistoryCanonicalChannelIdFromChat(env, rawTarget);
    if (!resolved.ok) {
      return await sendMessage(
        adminDmId,
        `⚠️ *Quelle konnte nicht erkannt werden:* ${escapeMd(resolved.error || "Ungültige Eingabe.")}\n\n` +
        `💡 Sende \`/scan\` direkt in der Quellgruppe oder hier mit einem Nachrichten-Link (\`https://t.me/c/.../4500\`).${extraNote}`,
        { reply_markup: { inline_keyboard: [[{ text: "📋 Jobs & Archiv", callback_data: "hc:jobs" }, { text: "⚙️ Index/Archiv", callback_data: "hc:cfg_ref" }]] } }
      );
    }

    const canonicalChatId = resolved.chatId;
    if (await isHistorySystemBlockedChat(env, canonicalChatId)) {
      return await sendMessage(
        adminDmId,
        `⛔ *Scan blockiert:* \`${escapeMd(canonicalChatId)}\` ist als Index-Kanal oder Themen-Archiv konfiguriert und darf nicht selbst als Scan-Quelle genutzt werden (Endlosschleifen-Schutz).${extraNote}`,
        { reply_markup: { inline_keyboard: [[{ text: "⚙️ Index/Archiv öffnen", callback_data: "hc:cfg_ref" }]] } }
      );
    }

    // Chat-Info & Speicherschutz-Prüfung (has_protected_content)
    const chatInfo = await tgApi(env).getChat(canonicalChatId, { bypassCache: false });
    if (chatInfo?.ok && chatInfo.hasProtectedContent) {
      return await sendMessage(
        adminDmId,
        `⛔ *Weiterleitungssperre aktiv:* In *${escapeMd(chatInfo.title || titleHint || canonicalChatId)}* ist \`has_protected_content\` aktiviert.\n` +
        `Telegram blockiert dort \`forwardMessage\`, weshalb kein automatischer Verlaufs-Scan möglich ist.${extraNote}`,
        { reply_markup: { inline_keyboard: [[{ text: "📋 Laufende Jobs", callback_data: "hc:jobs" }]] } }
      );
    }

    const finalTitle = String(titleHint || chatInfo?.title || resolved.title || canonicalChatId).trim().slice(0, 120);
    const effectiveDetectedEnd = Math.max(0, Number(detectedEndId || resolved.messageId || 0));
    const parsedRange = parseHistoryScanRangeArg(rangeArg, effectiveDetectedEnd);
    if (!parsedRange.ok) {
      if (parsedRange.missingEndId) {
        return await sendMessage(
          adminDmId,
          `ℹ️ *Für* *${escapeMd(finalTitle)}* (\`${escapeMd(canonicalChatId)}\`) *fehlt noch die Bis-ID.*\n\n` +
          `So startest du sofort:\n` +
          `• \`/scan\` direkt in der Quellgruppe senden *(Befehl wird dort sofort gelöscht)*\n` +
          `• Oder hier mit Bereich: \`/scan ${escapeMd(canonicalChatId)} 1-5000\`\n` +
          `• Oder einen Nachrichten-Link einfügen: \`https://t.me/c/.../4500\`${extraNote}`,
          { reply_markup: { inline_keyboard: [[{ text: "📋 Jobs & Archiv", callback_data: "hc:jobs" }, { text: "✖️ Schließen", callback_data: "close_bot_msg" }]] } }
        );
      }
      return await sendMessage(adminDmId, `⚠️ ${parsedRange.error}${extraNote}`);
    }

    const [channels, archiveDefaults] = await Promise.all([
      getHistoryIndexChannelsFromD1(env),
      getHistoryArchiveDefaultsFromD1(env)
    ]);
    const archiveForum = channels.find(c => c.role === "archive_forum" && c.enabled) || null;
    const enableArchiveMirror = Boolean(preferArchive && archiveForum);

    let archiveMissingNote = "";
    if (preferArchive && !archiveForum) {
      archiveMissingNote = "\nℹ️ _Hinweis: Noch kein aktives Themen-Archiv eingerichtet. Mit `/archiv_set` im Forum kannst du es jederzeit ergänzen._";
    }

    const draft = {
      sourceChatId: canonicalChatId,
      sourceTitle: finalTitle,
      startMsgId: parsedRange.startMsgId,
      endMsgId: parsedRange.endMsgId,
      detectedEndId: effectiveDetectedEnd > 0 ? effectiveDetectedEnd : parsedRange.endMsgId,
      usedReplyEndId: Boolean(usedReplyEndId),
      rangePreset: parsedRange.rangePreset,
      direction: "desc",
      enableArchiveMirror,
      archiveTopicMode: archiveDefaults.topicMode || "type_genre",
      archiveTiming: archiveDefaults.timing || "live",
      archivePinSeriesCard: Boolean(archiveDefaults.pinSeriesCard),
      archiveMaxSeriesTopics: Number(archiveDefaults.maxSeriesTopics || 250),
      enableReactions: false,
      cronEnabled: true,
      createdAt: Date.now()
    };

    await saveHistoryChatAdminState(env, adminDmId, {
      draft,
      awaitingForwardRole: "",
      awaitingForwardExpiresAt: 0,
      awaitingScanPreferArchive: false
    });

    return await renderHistoryScanDraftMenu(env, adminDmId, null, `${extraNote}${archiveMissingNote}`.trim());
  }

  async function renderHistoryScanDraftMenu(env, adminDmId, editMsgId = null, note = "") {
    const { sendMessage, editMessageText } = tgApi(env);
    const [adminState, channels, jobs] = await Promise.all([
      getHistoryChatAdminState(env, adminDmId),
      getHistoryIndexChannelsFromD1(env),
      listHistoryCrawlJobsFromD1(env, 30)
    ]);
    const draft = adminState?.draft || null;
    if (!draft || !draft.sourceChatId) {
      const emptyText = "ℹ️ *Kein aktiver Scan-Entwurf vorhanden* (nach 30 Min. abgelaufen).\nSende `/scan` oder `/archiv` in einer Gruppe oder im Privat-Chat, um neu zu starten.";
      const kb = [[{ text: "📋 Laufende Jobs", callback_data: "hc:jobs" }, { text: "⚙️ Index/Archiv", callback_data: "hc:cfg_ref" }]];
      if (editMsgId) {
        const ed = await editMessageText(adminDmId, editMsgId, emptyText, { reply_markup: { inline_keyboard: kb } });
        if (ed) return ed;
      }
      return await sendMessage(adminDmId, emptyText, { reply_markup: { inline_keyboard: kb } });
    }

    const enabledProbes = channels.filter(c => c.role === "probe_index" && c.enabled);
    const archiveForum = channels.find(c => c.role === "archive_forum" && c.enabled) || null;
    const effectiveArchiveOn = Boolean(draft.enableArchiveMirror && archiveForum);

    // Doppel-Job-Schutz: Prüfen, ob für dieselbe Quelle bereits ein offener Job existiert
    const existingOpenJob = jobs.find(
      j => j.sourceChatId === draft.sourceChatId && ["running", "queued", "paused", "flood_wait"].includes(j.status)
    ) || null;

    const spanCount = Math.max(1, Number(draft.endMsgId) - Number(draft.startMsgId) + 1);
    const estMinutes = enabledProbes.length > 0 ? Math.max(1, Math.ceil(spanCount / (enabledProbes.length * 15))) : 0;
    const estLabel = enabledProbes.length > 0
      ? (estMinutes >= 120 ? `~${(estMinutes / 60).toFixed(1)} Std.` : `~${estMinutes} Min.`)
      : "—";

    const replyTag = draft.usedReplyEndId ? " *(aus Antwort-Nachricht)*" : "";
    const dupBanner = existingOpenJob
      ? `\n⚠️ *Doppel-Job-Hinweis:* Für diese Quelle existiert bereits *Job #${existingOpenJob.id}* (${formatHistoryJobStatusBadge(existingOpenJob.status)}, \`${computeHistoryJobProgressPct(existingOpenJob)} %\`, #${formatDeInt(existingOpenJob.startMsgId)}–#${formatDeInt(existingOpenJob.endMsgId)}).\n`
      : "";
    const noProbeBanner = enabledProbes.length === 0
      ? `\n⛔ *Kein aktiver Index-Kanal!* Richte zuerst mit \`/index_add\` mindestens 1 privaten Index-Kanal ein.\n`
      : "";

    const archSummary = !archiveForum
      ? "⚪ Nicht eingerichtet (`/archiv_set`)"
      : (effectiveArchiveOn
          ? `✅ *AN* → *${escapeMd(archiveForum.label || archiveForum.channelId)}*\n   📁 ${escapeMd(formatArchiveModeShortLabel(draft.archiveTopicMode))} · 🕒 ${draft.archiveTiming === "after_scan" ? "Nach Scan-Ende" : "Live"}${draft.archiveTopicMode === "per_series_plus_genre" ? ` · 📌 Pin: ${draft.archivePinSeriesCard ? "AN" : "AUS"}` : ""}`
          : "⚪ AUS *(nur Mediathek)*");

    const msgText =
      `🚀 *VERLAUFS-SCAN & ARCHIVIERUNG KONFIGURIEREN*\n${SEP}\n` +
      `📡 *Quelle:* *${escapeMd(draft.sourceTitle)}*\n` +
      `   \`${escapeMd(draft.sourceChatId)}\`${replyTag}\n` +
      `🔢 *Bereich:* \`#${formatDeInt(draft.startMsgId)}\` bis \`#${formatDeInt(draft.endMsgId)}\` (\`${formatDeInt(spanCount)}\` IDs · ${estLabel})\n` +
      `🧭 *Richtung:* ${draft.direction === "desc" ? "⬇️ Neueste zuerst (50er-Kontext)" : "⬆️ Älteste zuerst"}\n` +
      `🗂️ *Themen-Archiv:* ${archSummary}\n` +
      `👍 *Reaktionen:* ${draft.enableReactions ? "AN" : "AUS"} · ⏱️ *2-Min-Cron:* ${draft.cronEnabled ? "AN" : "AUS"}\n` +
      `📡 *Index-Pool:* \`${enabledProbes.length}/3\` aktiv` +
      dupBanner +
      noProbeBanner +
      (note ? `\n\n${note}` : "");

    const p = String(draft.rangePreset || "");
    const inline_keyboard = [];
    if (existingOpenJob) {
      inline_keyboard.push([{ text: `📋 Zu bestehendem Job #${existingOpenJob.id} wechseln`, callback_data: `hc:job_v:${existingOpenJob.id}` }]);
    }

    inline_keyboard.push([
      { text: `${p === "500" ? "● " : ""}500`, callback_data: "hc:d_r:500" },
      { text: `${p === "2000" ? "● " : ""}2.000`, callback_data: "hc:d_r:2000" },
      { text: `${p === "5000" ? "● " : ""}5.000`, callback_data: "hc:d_r:5000" },
      { text: `${p === "all" ? "● " : ""}Ab #1`, callback_data: "hc:d_r:all" }
    ]);

    inline_keyboard.push([
      { text: draft.direction === "desc" ? "⬇️ Neueste zuerst" : "⬆️ Älteste zuerst", callback_data: "hc:d_dir" },
      { text: effectiveArchiveOn ? "🗂️ Archiv: AN" : "🗂️ Archiv: AUS", callback_data: "hc:d_arch" }
    ]);

    if (effectiveArchiveOn) {
      const archOptsRow = [
        { text: `📁 ${formatArchiveModeShortLabel(draft.archiveTopicMode)}`, callback_data: "hc:d_mode" },
        { text: draft.archiveTiming === "after_scan" ? "🕒 Nach Scan" : "🕒 Live", callback_data: "hc:d_time" }
      ];
      inline_keyboard.push(archOptsRow);
      if (draft.archiveTopicMode === "per_series_plus_genre") {
        inline_keyboard.push([
          { text: draft.archivePinSeriesCard ? "📌 Serien-Karte anpinnen: AN" : "📌 Serien-Karte anpinnen: AUS", callback_data: "hc:d_pin" }
        ]);
      }
    }

    inline_keyboard.push([
      { text: draft.enableReactions ? "👍 Reaktionen: AN" : "👍 Reaktionen: AUS", callback_data: "hc:d_react" },
      { text: draft.cronEnabled ? "⏱️ 2-Min-Cron: AN" : "⏱️ 2-Min-Cron: AUS", callback_data: "hc:d_cron" }
    ]);

    if (enabledProbes.length > 0) {
      inline_keyboard.push([
        { text: "🚀 Scan jetzt starten", callback_data: "hc:go" },
        { text: "🔎 1-ID-Testprobe", callback_data: "hc:probe" }
      ]);
    } else {
      inline_keyboard.push([{ text: "⚙️ Index-Kanal jetzt einrichten", callback_data: "hc:cfg_ref" }]);
    }

    inline_keyboard.push([
      { text: "📋 Laufende Jobs", callback_data: "hc:jobs" },
      { text: "❌ Abbrechen", callback_data: "hc:d_cancel" }
    ]);

    if (editMsgId) {
      const edited = await editMessageText(adminDmId, editMsgId, msgText, { reply_markup: { inline_keyboard } });
      if (edited) return edited;
    }
    return await sendMessage(adminDmId, msgText, { reply_markup: { inline_keyboard } });
  }

  async function renderHistoryJobsAndArchiveMenu(env, adminDmId, editMsgId = null, { selectedJobId = 0, note = "", confirmDeleteJobId = 0 } = {}) {
    const { sendMessage, editMessageText } = tgApi(env);
    const [jobs, channels] = await Promise.all([
      listHistoryCrawlJobsFromD1(env, 16),
      getHistoryIndexChannelsFromD1(env)
    ]);
    const enabledProbes = channels.filter(c => c.role === "probe_index" && c.enabled);
    const archiveForum = channels.find(c => c.role === "archive_forum") || null;
    const archiveStats = await getArchiveMirrorStatsFromD1(env, archiveForum?.channelId || "");

    const openJobs = jobs.filter(j => ["running", "flood_wait", "queued", "paused", "error"].includes(j.status));
    const displayJobs = openJobs.length > 0 ? openJobs.slice(0, 6) : jobs.slice(0, 4);

    let focusJob = null;
    if (selectedJobId > 0) {
      focusJob = jobs.find(j => j.id === selectedJobId) || null;
    }
    if (!focusJob) {
      focusJob = jobs.find(j => j.status === "running" || j.status === "flood_wait") ||
        openJobs[0] ||
        jobs[0] ||
        null;
    }

    let jobsBlock = "";
    if (displayJobs.length === 0) {
      jobsBlock = `_Noch keine Verlaufs-Scans angelegt._\n💡 Sende \`/scan\` oder \`/archiv\` in einer Quellgruppe, um den ersten Scan zu starten.`;
    } else {
      jobsBlock = displayJobs.map(j => {
        const pct = computeHistoryJobProgressPct(j);
        const selMark = focusJob && focusJob.id === j.id ? "👉 " : "";
        const archTag = j.enableArchiveMirror ? " · 🗂️" : "";
        const cronTag = j.cronEnabled ? " · ⏱️" : " · 🔕";
        return `${selMark}*#${j.id} ${escapeMd(j.sourceTitle || j.sourceChatId)}* (${pct} %)\n` +
          `   ${formatHistoryJobStatusBadge(j.status)} · \`#${formatDeInt(j.startMsgId)}–#${formatDeInt(j.endMsgId)}\` · 🎬 \`${j.mediaFoundCount}\`${archTag}${cronTag}`;
      }).join("\n");
    }

    let focusDetail = "";
    if (focusJob) {
      const span = Math.max(1, focusJob.endMsgId - focusJob.startMsgId + 1);
      const pct = computeHistoryJobProgressPct(focusJob);
      const errLine = focusJob.lastError ? `\n   ⚠️ _${escapeMd(focusJob.lastError)}_` : "";
      const turboActive = Number(focusJob.workerLeaseUntil || 0) > Date.now();
      const turboLine = turboActive ? `\n   🚀 _Browser-Turbo aktiv (Cron pausiert kurz automatisch)_` : "";
      focusDetail =
        `\n\n🎯 *Fokus: Job #${focusJob.id}* (\`${pct} %\` · \`${formatDeInt(focusJob.scannedCount)}/${formatDeInt(span)}\`)\n` +
        `   ${focusJob.direction === "desc" ? "⬇️ Neueste zuerst" : "⬆️ Älteste zuerst"} · 🎬 \`${focusJob.mediaFoundCount}\` Medien · ⏭️ \`${focusJob.skippedExistingCount}\` Skip · ⏱️ Cron: *${focusJob.cronEnabled ? "AN" : "AUS"}*` +
        turboLine +
        errLine;
    }

    const archBlock = archiveForum
      ? `\n\n🗂️ *Themen-Archiv:* *${escapeMd(archiveForum.label || archiveForum.channelId)}*${archiveForum.enabled ? "" : " _(deaktiviert)_"}\n` +
        `   ⏳ Wartend: \`${archiveStats.pending}\` · 🧷 Bis Scan-Ende: \`${archiveStats.held}\` · ✅ Archiviert: \`${archiveStats.posted}\` · ⛔ Fehler: \`${archiveStats.failed}\` · 📁 Themen: \`${archiveStats.topicCount}\``
      : `\n\n🗂️ *Themen-Archiv:* _Nicht konfiguriert (\`/archiv_set\`)._`;

    const turboHint = openJobs.some(j => (j.endMsgId - j.startMsgId) >= 2500)
      ? `\n\n💡 _Tipp für sehr große Verläufe: Im Admin-Panel steht zusätzlich der 🚀 Browser-Turbo zur Verfügung._`
      : "";

    const msgText =
      `📋 *VERLAUFS-JOBS & THEMEN-ARCHIV*\n${SEP}\n` +
      `📡 *Index-Pool:* \`${enabledProbes.length}/3\` aktiv\n\n` +
      `${jobsBlock}` +
      focusDetail +
      archBlock +
      turboHint +
      (note ? `\n\n${note}` : "");

    const inline_keyboard = [];

    // Job-Auswahlleiste bei mehreren Jobs
    if (displayJobs.length > 1) {
      inline_keyboard.push(
        displayJobs.slice(0, 4).map(j => {
          const isSel = focusJob && focusJob.id === j.id;
          const ic = j.status === "running" ? "🟢" : (j.status === "paused" ? "⏸️" : (j.status === "queued" ? "🕒" : (j.status === "completed" ? "✅" : "⚠️")));
          return {
            text: `${isSel ? "● " : ""}#${j.id} ${ic}`,
            callback_data: `hc:job_v:${j.id}`
          };
        })
      );
    }

    // Aktionen für den fokussierten Job
    if (focusJob) {
      const jid = focusJob.id;
      const isRunnable = ["running", "queued", "flood_wait"].includes(focusJob.status);
      const isPausedOrErr = ["paused", "error"].includes(focusJob.status);
      if (confirmDeleteJobId === jid) {
        inline_keyboard.push([
          { text: `🗑️ Ja, Job #${jid} wirklich löschen`, callback_data: `hc:job_delc:${jid}` },
          { text: "↩️ Abbrechen", callback_data: `hc:job_v:${jid}` }
        ]);
      } else {
        const row1 = [];
        if (isRunnable) {
          row1.push({ text: `⏸️ #${jid} Pause`, callback_data: `hc:job_p:${jid}` });
          row1.push({ text: `⚡ 1 Scan-Schritt`, callback_data: `hc:job_s:${jid}` });
        } else if (isPausedOrErr) {
          row1.push({ text: `▶️ #${jid} Fortsetzen`, callback_data: `hc:job_r:${jid}` });
        }
        if (focusJob.status !== "completed") {
          row1.push({ text: focusJob.cronEnabled ? "⏱️ Cron: AN" : "🔕 Cron: AUS", callback_data: `hc:job_c:${jid}` });
        }
        if (row1.length > 0) inline_keyboard.push(row1);
        if (!isRunnable) {
          inline_keyboard.push([{ text: `🗑️ Job #${jid} entfernen`, callback_data: `hc:job_del:${jid}` }]);
        }
      }
    }

    // Archiv-Queue-Aktionen
    if (archiveForum || archiveStats.total > 0) {
      const archRow = [];
      if (archiveStats.pending > 0 && archiveForum?.enabled) {
        archRow.push({ text: "⚡ 4 Archiv-Posts senden", callback_data: "hc:arch_s" });
      }
      if (archiveStats.held > 0) {
        archRow.push({ text: `🔓 ${archiveStats.held} freigeben`, callback_data: "hc:arch_rel" });
      }
      if (archiveStats.failed > 0) {
        archRow.push({ text: `🔁 ${archiveStats.failed} Fehler neu`, callback_data: "hc:arch_ret" });
      }
      if (archRow.length > 0) inline_keyboard.push(archRow);
      if (archiveForum?.enabled) {
        inline_keyboard.push([{ text: "📑 Inhaltsverzeichnis aktualisieren", callback_data: "hc:arch_dir" }]);
      }
    }

    inline_keyboard.push([
      { text: "🔄 Aktualisieren", callback_data: focusJob ? `hc:job_v:${focusJob.id}` : "hc:jobs" },
      { text: "⚙️ Index/Archiv", callback_data: "hc:cfg_ref" },
      { text: "✖️ Schließen", callback_data: "close_bot_msg" }
    ]);

    if (editMsgId) {
      const edited = await editMessageText(adminDmId, editMsgId, msgText, { reply_markup: { inline_keyboard } });
      if (edited) return edited;
    }
    return await sendMessage(adminDmId, msgText, { reply_markup: { inline_keyboard } });
  }

  async function handleHistoryScanAndJobsCommand(env, tgMsg, { isChannelPost = false } = {}) {
    if (!tgMsg || !tgMsg.chat?.id || env._isCustomBotWebhook) return false;
    const rawText = String(tgMsg.text || tgMsg.caption || "").trim();
    const cmdMatch = rawText.match(/^\/(scan|archiv|scan_start|archiv_start|jobs|archiv_status|scan_status|archiv_live|live_archiv|archiv_verzeichnis|archiv_index)(?:@\w+)?(?:\s+(.*))?$/i);
    if (!cmdMatch) return false;

    const cmd = cmdMatch[1].toLowerCase();
    const rawRest = String(cmdMatch[2] || "").trim();

    const adminCtx = await resolveHistoryChatAdminContext(env, tgMsg, { isChannelPost });
    if (!adminCtx.authorized) {
      if (!isChannelPost && !isGroupOrChannelChat(tgMsg.chat.id)) {
        await tgApi(env).sendMessage(tgMsg.chat.id, "🔒 Dieser Befehl steht nur Bot-Administratoren zur Verfügung.");
      }
      return true;
    }

    let deleteWarning = "";
    let commandDeleted = false;
    if (adminCtx.isGroupOrChannel && adminCtx.messageId > 0) {
      commandDeleted = await tgApi(env).deleteMessage(adminCtx.sourceChatId, adminCtx.messageId).catch(() => false);
      if (!commandDeleted) {
        deleteWarning = "\n_ℹ️ Hinweis: Befehl konnte im Quellchat nicht automatisch gelöscht werden (fehlendes Löschrecht)._";
      }
    }

    // 0. /archiv_live oder /live_archiv -> Pro-Gruppe Live-Spiegeln ins Themen-Archiv umschalten
    if (cmd === "archiv_live" || cmd === "live_archiv") {
      let targetCid = "";
      let targetTitle = "";
      let modeArg = "";
      if (adminCtx.isGroupOrChannel) {
        targetCid = adminCtx.sourceChatId;
        targetTitle = adminCtx.sourceTitle;
        modeArg = rawRest.split(/\s+/)[0] || "";
      } else {
        if (!rawRest) {
          await renderAutoIngestStatusMenu(
            env,
            adminCtx.adminDmId,
            null,
            "ℹ️ Tippe unten bei der gewünschten Gruppe auf *🗂️ Archiv: AN/AUS* — oder sende `/archiv_live` direkt in einer Gruppe."
          );
          return true;
        }
        const parts = rawRest.split(/\s+/);
        const resolved = await resolveHistoryCanonicalChannelIdFromChat(env, parts[0]);
        if (!resolved.ok) {
          await renderAutoIngestStatusMenu(env, adminCtx.adminDmId, null, `⚠️ ${escapeMd(resolved.error || "Ungültige Gruppe/Kanal.")}`);
          return true;
        }
        targetCid = resolved.chatId;
        targetTitle = resolved.title || targetCid;
        modeArg = parts[1] || "";
      }

      const [chatsMap, archiveForums] = await Promise.all([
        getAutoIngestChatsMap(env, true),
        getHistoryIndexChannelsFromD1(env, { role: "archive_forum", onlyEnabled: true })
      ]);
      const prevEntry = chatsMap[targetCid] || null;
      let nextArchFlag = !Boolean(prevEntry?.archiveMirrorEnabled);
      if (/^(?:on|an|1|ein|enable|true)$/i.test(modeArg)) nextArchFlag = true;
      else if (/^(?:off|aus|0|disable|false)$/i.test(modeArg)) nextArchFlag = false;

      let note = "";
      if (nextArchFlag && await isHistorySystemBlockedChat(env, targetCid)) {
        note = `⛔ *Live-Archiv blockiert:* \`${escapeMd(targetCid)}\` ist ein Index-Kanal oder das Themen-Archiv selbst (Endlosschleifen-Schutz).`;
      } else if (nextArchFlag && archiveForums.length === 0) {
        note = `⚠️ *Noch kein aktives Themen-Archiv eingerichtet.* Sende zuerst \`/archiv_set\` in deiner privaten Forum-Supergruppe.`;
      } else {
        const res = await setAutoIngestChatEnabled(env, targetCid, {
          archiveMirrorEnabled: nextArchFlag,
          title: targetTitle || prevEntry?.title || targetCid,
          chatType: isChannelPost ? "channel" : (adminCtx.isGroupOrChannel ? String(tgMsg.chat.type || "group") : (prevEntry?.chatType || (targetCid.startsWith("-100") ? "channel" : "group"))),
          activatedBy: adminCtx.adminDmId
        });
        if (!res.ok) {
          note = `⚠️ ${escapeMd(res.error || "Konnte Live-Archiv-Status nicht speichern.")}`;
        } else {
          const ingestHint = nextArchFlag && !res.entry?.enabled
            ? "\n_💡 Hinweis: Für diese Gruppe ist `/ingest_on` aktuell pausiert — aktiviere Auto-Ingest unten, damit neue Live-Posts eingesammelt & gespiegelt werden._"
            : "";
          note = nextArchFlag
            ? `🗂️ *Live-Archiv für* *${escapeMd(res.entry.title)}* *eingeschaltet.* Neue Live-Posts werden nach Erkennung automatisch ins Themen-Archiv gespiegelt.${ingestHint}`
            : `⚪ *Live-Archiv für* *${escapeMd(res.entry.title)}* *ausgeschaltet.*`;
        }
      }

      const dmRes = await renderAutoIngestStatusMenu(env, adminCtx.adminDmId, null, `${note}${deleteWarning}`.trim());
      if (!dmRes || !dmRes.ok) {
        await sendHistoryGroupDmFallbackNotice(env, adminCtx.sourceChatId, adminCtx.threadId, isChannelPost);
      }
      return true;
    }

    // 0b. /archiv_verzeichnis (Alias /archiv_index) -> 📌 Inhaltsverzeichnis im Themen-Archiv sofort aktualisieren
    if (cmd === "archiv_verzeichnis" || cmd === "archiv_index") {
      const dirRes = await syncArchiveDirectoryTopic(env, { force: true, subrequestCeiling: 40 });
      const note = dirRes?.ok
        ? `📌 *Inhaltsverzeichnis aktualisiert!* \`${Number(dirRes.topicCount || 0)}\` Themen · \`${Number(dirRes.totalPostedFiles || 0)}\` archivierte Dateien` +
          (dirRes.deepLink ? ` · [Direkt öffnen](${dirRes.deepLink})` : "") +
          deleteWarning
        : `⚠️ *Inhaltsverzeichnis:* ${escapeMd(dirRes?.error || "Aktualisierung fehlgeschlagen.")}${deleteWarning}`;
      const dmRes = await renderHistoryJobsAndArchiveMenu(env, adminCtx.adminDmId, null, { note: note.trim() });
      if (!dmRes || !dmRes.ok) {
        await sendHistoryGroupDmFallbackNotice(env, adminCtx.sourceChatId, adminCtx.threadId, isChannelPost);
      }
      return true;
    }

    // 1. /jobs, /archiv_status, /scan_status -> Zentrale im Admin-DM
    if (cmd === "jobs" || cmd === "archiv_status" || cmd === "scan_status") {
      const dmRes = await renderHistoryJobsAndArchiveMenu(env, adminCtx.adminDmId, null, { note: deleteWarning.trim() });
      if (!dmRes || !dmRes.ok) {
        await sendHistoryGroupDmFallbackNotice(env, adminCtx.sourceChatId, adminCtx.threadId, isChannelPost);
      }
      return true;
    }

    // 2. /scan oder /archiv
    const preferArchive = cmd === "archiv" || cmd === "archiv_start";

    if (adminCtx.isGroupOrChannel) {
      // Echte Antwort (Reply) erkennen — in Forum-Supergruppen NICHT die automatische Topic-Root-Nachricht als Reply werten!
      const isRealReply = Boolean(
        tgMsg.reply_to_message?.message_id &&
        !tgMsg.reply_to_message?.forum_topic_created &&
        (!tgMsg.is_topic_message || Number(tgMsg.reply_to_message.message_id) !== Number(tgMsg.message_thread_id || 0))
      );
      const rawOwnMsgId = Number(tgMsg.message_id || 0);
      const detectedEndId = isRealReply
        ? Number(tgMsg.reply_to_message.message_id)
        : (commandDeleted && rawOwnMsgId > 1 ? rawOwnMsgId - 1 : rawOwnMsgId);

      const dmRes = await openHistoryScanDraftForAdmin(env, adminCtx.adminDmId, {
        rawTarget: adminCtx.sourceChatId,
        titleHint: adminCtx.sourceTitle,
        detectedEndId,
        usedReplyEndId: isRealReply,
        rangeArg: rawRest,
        preferArchive,
        extraNote: deleteWarning
      });
      if (!dmRes || !dmRes.ok) {
        await sendHistoryGroupDmFallbackNotice(env, adminCtx.sourceChatId, adminCtx.threadId, isChannelPost);
      }
      return true;
    }

    // Im Privat-Chat: ohne Argumente -> Weiterleitungs-/Link-Prompt aktivieren
    if (!rawRest) {
      await saveHistoryChatAdminState(env, adminCtx.adminDmId, {
        awaitingForwardRole: "scan_source",
        awaitingForwardExpiresAt: Date.now() + HISTORY_CHAT_FORWARD_TTL_MS,
        awaitingScanPreferArchive: preferArchive
      });
      const modeTitle = preferArchive ? "ARCHIVIERUNG & VERLAUFS-SCAN" : "VERLAUFS-SCAN STARTEN";
      await tgApi(env).sendMessage(
        adminCtx.adminDmId,
        `🚀 *${modeTitle}*\n${SEP}\n` +
        `Wähle deine Quellgruppe bzw. deinen Quellkanal auf einem dieser 3 Wege:\n\n` +
        `1️⃣ *Direkt in der Quellgruppe:* Sende dort \`/${preferArchive ? "archiv" : "scan"}\` *(optional als Antwort auf einen Post oder mit \`500\` / \`1200-4500\`)* — der Befehl wird in der Gruppe sofort gelöscht.\n` +
        `2️⃣ *Kanal-Post weiterleiten:* Leite jetzt einfach einen Beitrag aus dem Quellkanal hierher weiter.\n` +
        `3️⃣ *Link / ID senden:* Füge jetzt hier einen Nachrichten-Link (\`https://t.me/c/.../4500\`) oder \`-100... 1-5000\` ein.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📋 Laufende Jobs & Archiv", callback_data: "hc:jobs" }, { text: "⚙️ Index/Archiv", callback_data: "hc:cfg_ref" }],
              [{ text: "❌ Abbrechen", callback_data: "hc:d_cancel" }]
            ]
          }
        }
      );
      return true;
    }

    // Im Privat-Chat mit Argumenten: /scan <link|-100...|@user> [N | Von-Bis]
    const firstTok = rawRest.split(/\s+/)[0];
    const restRange = rawRest.slice(firstTok.length).trim();
    await openHistoryScanDraftForAdmin(env, adminCtx.adminDmId, {
      rawTarget: firstTok,
      rangeArg: restRange,
      preferArchive
    });
    return true;
  }

  async function renderAutoIngestStatusMenu(env, targetChatId, editMsgId = null, note = "") {
    const { sendMessage, editMessageText } = tgApi(env);
    const [chatsMap, statsRes, archiveForums] = await Promise.all([
      getAutoIngestChatsMap(env, true),
      getChannelIngestInboxStatsFromD1(env),
      getHistoryIndexChannelsFromD1(env, { role: "archive_forum", onlyEnabled: true })
    ]);
    const activeArchiveForum = archiveForums[0] || null;
    const statsByChat = new Map((statsRes.chats || []).map(c => [String(c.chatId), c]));
    const entries = Object.values(chatsMap || {}).sort((a, b) => Number(b.enabled) - Number(a.enabled) || (b.updatedAt || 0) - (a.updatedAt || 0));

    let lines = "";
    const inline_keyboard = [];
    if (entries.length === 0) {
      lines = `_Noch keine Gruppen oder Kanäle freigeschaltet._\n\n` +
        `💡 *Aktivieren:*\n` +
        `• In einer Gruppe oder einem Kanal \`/ingest_on\` senden\n` +
        `• Oder hier im Privat-Chat: \`/ingest_on -1001234567890\``;
    } else {
      lines = entries.slice(0, 12).map(e => {
        const st = statsByChat.get(String(e.chatId));
        const icon = e.enabled ? "🟢" : "⚪";
        const archBadge = e.archiveMirrorEnabled ? " · 🗂️ *Live-Archiv*" : "";
        const qInfo = st
          ? `📥 ${st.pending} wartend · ✅ ${st.done} · 👀 ${st.review}`
          : `📥 0 wartend`;
        return `${icon} *${escapeMd(e.title || e.chatId)}*${archBadge}\n   \`${escapeMd(String(e.chatId))}\` · ${qInfo}`;
      }).join("\n");
      for (const e of entries.slice(0, 6)) {
        const cid = String(e.chatId);
        const shortName = String(e.title || cid).slice(0, 14);
        const archOn = Boolean(e.archiveMirrorEnabled);
        inline_keyboard.push([
          {
            text: e.enabled ? `⏸️ ${shortName}` : `▶️ ${shortName}`,
            callback_data: e.enabled ? `ingst_off_${cid}` : `ingst_on_${cid}`
          },
          {
            text: archOn ? "🗂️ Archiv: AN" : "🗂️ Archiv: AUS",
            callback_data: archOn ? `ingst_arch_off_${cid}` : `ingst_arch_on_${cid}`
          }
        ]);
      }
    }

    inline_keyboard.push([
      { text: "⚡ Wartende jetzt verarbeiten", callback_data: "ingst_flush_all" },
      { text: "📋 Jobs & Archiv", callback_data: "hc:jobs" }
    ]);
    inline_keyboard.push([
      { text: "🔄 Aktualisieren", callback_data: "ingst_refresh" },
      { text: "✖️ Schließen", callback_data: "close_bot_msg" }
    ]);

    const t = statsRes.totals || {};
    const archHeader = activeArchiveForum
      ? `🗂️ *Themen-Archiv:* *${escapeMd(activeArchiveForum.label || activeArchiveForum.channelId)}* _(Live-Spiegeln pro Gruppe umschaltbar)_\n`
      : `🗂️ *Themen-Archiv:* _Nicht konfiguriert (\`/archiv_set\`)_\n`;
    const msgText =
      `📥 *AUTO-INGEST QUELLEN & STAGING-INBOX*\n${SEP}\n` +
      `📊 *Gesamt-Inbox:* \`${t.pending || 0}\` wartend • \`${t.processing || 0}\` aktiv • \`${t.done || 0}\` fertig • \`${t.review || 0}\` Review\n` +
      `${archHeader}\n` +
      `${lines}` +
      (note ? `\n\n${note}` : "") +
      `\n\n💡 _Eingehende Posts aus 🟢 aktiven Quellen werden still gesammelt und mit \`/archiv_live\` optional auch automatisch ins Themen-Archiv gespiegelt._`;

    if (editMsgId) {
      const edited = await editMessageText(targetChatId, editMsgId, msgText, { reply_markup: { inline_keyboard } });
      if (edited) return edited;
    }
    return await sendMessage(targetChatId, msgText, { reply_markup: { inline_keyboard } });
  }

  async function handleAutoIngestCommand(env, tgMsg, { isChannelPost = false } = {}) {
    if (!tgMsg || !tgMsg.chat?.id || env._isCustomBotWebhook) return false;
    const rawText = String(tgMsg.text || tgMsg.caption || "").trim();
    const cmdMatch = rawText.match(/^\/(ingest_on|ingest_off|ingest_status|ingest_flush|autoingest)(?:@\w+)?(?:\s+([^\s]+))?(?:\s+(.*))?$/i);
    if (!cmdMatch) return false;

    const rawCmd = cmdMatch[1].toLowerCase();
    let action = rawCmd === "ingest_on"
      ? "on"
      : (rawCmd === "ingest_off" ? "off" : (rawCmd === "ingest_flush" ? "flush" : "status"));
    let argTarget = String(cmdMatch[2] || "").trim();
    let argExtra = String(cmdMatch[3] || "").trim();
    if (rawCmd === "autoingest") {
      if (/^(?:on|an|1|enable)$/i.test(argTarget)) {
        action = "on";
        argTarget = argExtra.split(/\s+/)[0] || "";
      } else if (/^(?:off|aus|0|disable)$/i.test(argTarget)) {
        action = "off";
        argTarget = argExtra.split(/\s+/)[0] || "";
      } else if (/^(?:flush|run|now)$/i.test(argTarget)) {
        action = "flush";
        argTarget = argExtra.split(/\s+/)[0] || "";
      } else {
        action = "status";
      }
    }

    const chatId = tgMsg.chat.id;
    const isGroupOrChannel = isChannelPost || isGroupOrChannelChat(chatId);
    const { sendMessage, deleteMessage, setMessageReaction } = tgApi(env);

    // Striktes Admin-Gate (Privat/Gruppe via senderId, Kanal via getChatAdministrators)
    let authorized = false;
    let actorId = tgMsg.from?.id ? String(tgMsg.from.id) : (isChannelPost ? "channel_admin" : "");
    if (isChannelPost) {
      authorized = await verifyChannelAutoIngestAdminAccess(env, chatId);
    } else if (tgMsg.from?.id) {
      authorized = await isTelegramBotAdmin(env, tgMsg.from.id);
    }

    if (!authorized) {
      if (!isGroupOrChannel) {
        await sendMessage(chatId, `🔒 *Nur für Bot-Administratoren.*`, {
          reply_markup: { inline_keyboard: [buildFooterRow(chatId, true)] }
        });
      }
      return true;
    }

    if (action === "flush") {
      const targetFlushChat = isGroupOrChannel ? String(chatId) : (argTarget && /^-\d{4,}$/.test(argTarget) ? argTarget : null);
      const flushRes = await runScheduledChannelIngestFlush(env, {
        source: "command_flush",
        forceFlush: true,
        filterChatId: targetFlushChat,
        maxResolvePerRun: 6
      });
      if (isChannelPost) {
        await setMessageReaction(chatId, tgMsg.message_id, "👍").catch(() => {});
        await deleteMessage(chatId, tgMsg.message_id).catch(() => {});
        return true;
      }
      const note =
        `⚡ *Sammel-Flush abgeschlossen:* ` +
        `\`${flushRes.processedVideos}\` Video(s) · \`${flushRes.added}\` neu · \`${flushRes.upgraded}\` Upgrade/4K · ` +
        `\`${flushRes.duplicates}\` Duplikat · \`${flushRes.review}\` Review · \`${flushRes.subtitlesLinked}\` Untertitel` +
        (flushRes.remainingPending > 0 ? ` · _${flushRes.remainingPending} noch wartend_` : "");
      if (isGroupOrChannel) {
        const sent = await sendMessage(chatId, note);
        const ctx = typeof getActiveWorkerCtx === "function" ? getActiveWorkerCtx() : null;
        if (sent?.result?.message_id && ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil((async () => {
            await new Promise(r => setTimeout(r, 12000));
            await deleteMessage(chatId, sent.result.message_id).catch(() => {});
          })());
        }
        return true;
      }
      await renderAutoIngestStatusMenu(env, chatId, null, note);
      return true;
    }

    if (action === "status") {
      if (isChannelPost) {
        const enabled = await isAutoIngestChatEnabled(env, chatId);
        await setMessageReaction(chatId, tgMsg.message_id, enabled ? "👍" : "👌").catch(() => {});
        return true;
      }
      if (isGroupOrChannel) {
        const enabled = await isAutoIngestChatEnabled(env, chatId);
        const stRes = await getChannelIngestInboxStatsFromD1(env, String(chatId));
        const st = stRes.chats?.[0] || { pending: 0, done: 0, review: 0 };
        const sent = await sendMessage(
          chatId,
          `📥 *Auto-Ingest Status:* ${enabled ? "🟢 *AKTIV*" : "⚪ *INAKTIV*"}\n` +
          `Wartend: \`${st.pending}\` • Fertig: \`${st.done}\` • Review: \`${st.review}\``
        );
        const ctx = typeof getActiveWorkerCtx === "function" ? getActiveWorkerCtx() : null;
        if (sent?.result?.message_id && ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil((async () => {
            await new Promise(r => setTimeout(r, 12000));
            await deleteMessage(chatId, sent.result.message_id).catch(() => {});
          })());
        }
        return true;
      }
      await renderAutoIngestStatusMenu(env, chatId);
      return true;
    }

    // Ziel-Chat bestimmen: in Gruppe/Kanal immer der aktuelle Chat, im Privat-Chat per Argument (z. B. /ingest_on -1001234567890)
    const targetChatId = isGroupOrChannel ? String(chatId) : argTarget;
    if (!targetChatId || !/^-\d{4,}$/.test(targetChatId)) {
      if (!isGroupOrChannel) {
        await sendMessage(
          chatId,
          `ℹ️ *Verwendung im Privat-Chat:*\n\`/ingest_${action} -1001234567890\`\n\n_Oder schreibe \`/ingest_${action}\` direkt in die gewünschte Gruppe bzw. den Kanal._`
        );
      }
      return true;
    }

    const enableFlag = action === "on";
    if (enableFlag && typeof isHistorySystemBlockedChat === "function" && await isHistorySystemBlockedChat(env, targetChatId)) {
      const warnMsg = `⛔ *Auto-Ingest blockiert:* \`${escapeMd(targetChatId)}\` ist als Index-Kanal oder Themen-Archiv konfiguriert und darf nicht selbst eingespeist werden (Schutz vor Endlosschleifen).`;
      if (!isChannelPost) {
        await sendMessage(chatId, warnMsg);
      }
      return true;
    }
    const title = isGroupOrChannel
      ? String(tgMsg.chat.title || tgMsg.chat.username || `Chat ${targetChatId}`)
      : (argExtra || `Chat ${targetChatId}`);
    const chatType = isChannelPost ? "channel" : (isGroupOrChannel ? String(tgMsg.chat.type || "group") : (targetChatId.startsWith("-100") ? "channel" : "group"));

    const res = await setAutoIngestChatEnabled(env, targetChatId, {
      enabled: enableFlag,
      title,
      chatType,
      activatedBy: actorId
    });

    if (isChannelPost) {
      await setMessageReaction(chatId, tgMsg.message_id, enableFlag ? "👍" : "👌").catch(() => {});
      await deleteMessage(chatId, tgMsg.message_id).catch(() => {});
      return true;
    }

    if (isGroupOrChannel) {
      const sent = await sendMessage(
        chatId,
        enableFlag
          ? `✅ *Stiller Auto-Ingest für diese Gruppe aktiviert.*\n_Neue Filme, Serien & Untertitel werden still gesammelt und im Kontext verarbeitet (nur Emoji-Reaktion, kein Chat-Spam)._`
          : `⏸️ *Auto-Ingest für diese Gruppe deaktiviert.*`
      );
      const ctx = typeof getActiveWorkerCtx === "function" ? getActiveWorkerCtx() : null;
      if (sent?.result?.message_id && ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil((async () => {
          await new Promise(r => setTimeout(r, 12000));
          await deleteMessage(chatId, sent.result.message_id).catch(() => {});
        })());
      }
      return true;
    }

    if (!res.ok) {
      await sendMessage(chatId, `⚠️ ${escapeMd(res.error || "Konnte Chat nicht speichern.")}`);
      return true;
    }
    await renderAutoIngestStatusMenu(
      env,
      chatId,
      null,
      enableFlag
        ? `✅ *Quelle \`${escapeMd(targetChatId)}\` erfolgreich aktiviert.*`
        : `⏸️ *Quelle \`${escapeMd(targetChatId)}\` deaktiviert.*`
    );
    return true;
  }

  // ============================================================================
  // STUFE 2 (HIGH-VOLUME 500+): VERZÖGERTE SMART-SAMMEL-ENGINE + PARSER-ADAPTER
  // ============================================================================
  const INGEST_SETTLE_WINDOW_MS = 2 * 60 * 1000; // 2 Min. Ruhezeit nach letztem Post
  const INGEST_BACKLOG_THRESHOLD = 40;           // Ab 40 wartenden Posts schon während des Uploads starten
  const INGEST_MAX_AGE_TRIGGER_MS = 5 * 60 * 1000; // Oder sobald ältester Post >= 5 Min. wartet

  function getQualityRankForUpgrade(qualityStr) {
    const q = String(qualityStr || "").toLowerCase();
    if (/2160|4k|uhd/.test(q)) return 5;
    if (/1080|fhd|fullhd/.test(q)) return 4;
    if (/720|\bhd\b/.test(q)) return 3;
    if (/480|576|\bsd\b|dvd/.test(q)) return 2;
    if (/360/.test(q)) return 1;
    return 0;
  }

  // ZENTRALER AUSTAUSCHBARER PARSER-ADAPTER (für das morgige Parsing-Update an genau 1 Stelle gekapselt!)
  function extractSmartGroupedEntriesFromInboxWindow(chatMeta, windowRows = [], contextCarryover = null) {
    const anchorMessages = Array.isArray(contextCarryover?.anchorMessages)
      ? contextCarryover.anchorMessages
          .filter(m => m && typeof m === "object")
          .slice(-3)
          .map((m, idx) => ({
            ...m,
            id: Number(m.id || m.msg_id || (idx + 1)),
            msg_id: Number(m.id || m.msg_id || (idx + 1)),
            _isCarryoverAnchor: true
          }))
      : [];
    const anchorMsgIdSet = new Set(anchorMessages.map(m => Number(m.id || m.msg_id)));

    const currentMessages = (windowRows || [])
      .map(r => {
        const p = (r.payload && typeof r.payload === "object") ? { ...r.payload } : {};
        p.id = Number(r.messageId || p.id || p.msg_id || 0);
        p.msg_id = p.id;
        p.type = "message";
        if (!p.chat_id) p.chat_id = String(chatMeta?.chatId || r.chatId || "");
        return p;
      })
      .filter(m => m.id > 0);

    // Falls Carryover-Anker eine ältere message_id haben als das aktuelle Fenster, bleiben sie sauber vorn
    // (Distanz bis 250 erlaubt, damit Serien-Poster auch über mehrere 40er-/200er-Fenster bei 500+ Folgen erhalten bleiben!)
    const firstCurId = currentMessages.length > 0 ? currentMessages[0].id : 0;
    const safeAnchors = anchorMessages.filter(a => firstCurId === 0 || ((firstCurId - Number(a.id)) <= 250 && Number(a.id) < firstCurId));

    const syntheticBackupJson = {
      id: String(chatMeta?.chatId || ""),
      name: String(chatMeta?.title || chatMeta?.chatId || "Kanal-Inbox"),
      messages: [...safeAnchors, ...currentMessages]
    };

    // Nutzt 1:1 dieselbe Smart-Kontext-Logik wie der JSON-Backup-Importer!
    const detected = detectAndExtractTelegramBackupOrJson(syntheticBackupJson, null);
    const entries = (detected?.entries || []).filter(e => {
      const mid = Number(e?.msg_id || e?.message_id || 0);
      return mid > 0 && !anchorMsgIdSet.has(mid);
    });

    // Finde Untertitel-Zeilen, die bereits an ein Video gekoppelt wurden vs. eigenständige (z. B. nachgereicht im nächsten Fenster)
    const boundSubtitleMsgIds = new Set();
    for (const ent of entries) {
      if (Array.isArray(ent.subtitle_files)) {
        for (const sf of ent.subtitle_files) {
          if (sf?.message_id) boundSubtitleMsgIds.add(Number(sf.message_id));
        }
      }
    }
    const standaloneSubtitles = (windowRows || []).filter(
      r => r.msgKind === "subtitle" && !boundSubtitleMsgIds.has(Number(r.messageId))
    );

    // Kontext-Anker für das nächste Fenster sichern (letzte max. 2 Kontext-/Header-Posts)
    const trailingAnchors = currentMessages
      .filter(m => !m.telegram_file_id || m.media_type === "photo" || /\b(?:Staffel|Season)\s*0*\d{1,2}\b/i.test(String(m.text || "")))
      .slice(-2)
      .map(m => ({
        id: m.id,
        msg_id: m.id,
        type: "message",
        chat_id: m.chat_id,
        text: String(m.text || "").slice(0, 600),
        photo: m.photo,
        media_type: m.media_type === "photo" ? "photo" : undefined
      }));

    return {
      entries,
      boundSubtitleMsgIds,
      standaloneSubtitles,
      nextAnchorMessages: trailingAnchors.length > 0 ? trailingAnchors : safeAnchors
    };
  }

  // SMART WINDOW CUT: Schneidet niemals einen offenen Kontext-Header oder eine laufende Media-Group am Batch-Ende ab!
  function applySmartWindowCut(rows, { windowLimit = 50, forceFlush = false, now = Date.now() } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { processRows: [], holdBackRows: [] };
    }
    const lastRow = rows[rows.length - 1];
    const isFullWindow = rows.length >= windowLimit;
    const newestAgeMs = lastRow?.createdAt ? (now - Number(lastRow.createdAt)) : INGEST_SETTLE_WINDOW_MS;
    const isActivelyUploading = newestAgeMs < 90 * 1000;

    if (forceFlush || (!isFullWindow && !isActivelyUploading)) {
      return { processRows: rows, holdBackRows: [] };
    }

    let cutIdx = rows.length;
    // 1. Falls am Fensterende eine Media-Group mitten im Block endet, diese komplett fürs nächste Fenster aufheben
    const tailGroupId = rows[cutIdx - 1]?.mediaGroupId;
    if (tailGroupId) {
      let gStart = cutIdx - 1;
      while (gStart > 0 && rows[gStart - 1]?.mediaGroupId === tailGroupId) {
        gStart--;
      }
      if (gStart > 0) cutIdx = gStart;
    }

    // 2. Nachlaufende reine Kontext-/Poster-Posts am Fensterende aufheben (deren Videos kommen wahrscheinlich gleich!)
    while (cutIdx > 1 && rows[cutIdx - 1]?.msgKind === "context") {
      const ctxAge = rows[cutIdx - 1]?.createdAt ? (now - Number(rows[cutIdx - 1].createdAt)) : 0;
      if (ctxAge > INGEST_MAX_AGE_TRIGGER_MS && !isFullWindow) break;
      cutIdx--;
    }

    if (cutIdx <= 0) {
      return { processRows: rows, holdBackRows: [] };
    }
    return {
      processRows: rows.slice(0, cutIdx),
      holdBackRows: rows.slice(cutIdx)
    };
  }

  async function dispatchAdaptiveInboxReactions(env, chatId, reactionQueue = []) {
    if (!Array.isArray(reactionQueue) || reactionQueue.length === 0) {
      return { sent: 0, deferredIds: [], skippedIds: [], rateLimited: false };
    }
    const prioOf = (emoji) => {
      if (emoji === "👀") return 1;
      if (emoji === "🔥") return 2;
      if (emoji === "👍") return 3;
      if (emoji === "✍") return 4;
      return 5;
    };
    const sorted = [...reactionQueue].sort((a, b) => prioOf(a.emoji) - prioOf(b.emoji) || Number(a.messageId) - Number(b.messageId));
    const { setMessageReaction } = tgApi(env);
    let sent = 0;
    let rateLimited = false;
    const deferredIds = [];
    const skippedIds = [];

    for (const item of sorted) {
      const p = prioOf(item.emoji);
      if (rateLimited || !hasSubrequestBudget(38)) {
        if (p <= 3) deferredIds.push(item.rowId);
        else skippedIds.push(item.rowId);
        continue;
      }
      const res = await setMessageReaction(chatId, item.messageId, item.emoji, { fallbackEmoji: "👍" });
      if (res?.ok) {
        sent++;
      } else if (res?.rateLimited) {
        rateLimited = true;
        if (p <= 3) deferredIds.push(item.rowId);
        else skippedIds.push(item.rowId);
      } else {
        skippedIds.push(item.rowId);
      }
    }
    return { sent, deferredIds, skippedIds, rateLimited };
  }

  async function flushChannelIngestWindow(env, chatId, options = {}) {
    const cid = String(chatId || "").trim();
    const maxResolvePerRun = Math.max(1, Math.min(10, Number(options.maxResolvePerRun || 6)));
    const defaultWindowLimit = Math.max(12, Math.min(20, maxResolvePerRun * 2 + 6));
    const windowLimit = Math.max(5, Math.min(60, Number(options.windowLimit || defaultWindowLimit)));
    const forceFlush = Boolean(options.forceFlush);
    const now = Date.now();

    const summary = {
      chatId: cid,
      claimed: 0,
      heldBack: 0,
      processedVideos: 0,
      added: 0,
      upgraded: 0,
      duplicates: 0,
      review: 0,
      subtitlesLinked: 0,
      reactionsSent: 0,
      reactionsDeferred: 0,
      stoppedByBudget: false
    };

    const claimedRows = await claimPendingChannelIngestWindowFromD1(env, cid, windowLimit, 90000, {
      skipLockRelease: Boolean(options.skipLockRelease)
    });
    if (!claimedRows || claimedRows.length === 0) return summary;
    summary.claimed = claimedRows.length;

    const { processRows, holdBackRows } = applySmartWindowCut(claimedRows, { windowLimit, forceFlush, now });
    summary.heldBack = holdBackRows.length;

    const rowUpdates = [];
    for (const hr of holdBackRows) {
      rowUpdates.push({ id: hr.id, status: "pending", reactionPending: 0 });
    }
    if (processRows.length === 0) {
      await markChannelIngestRowsStatusInD1(env, rowUpdates);
      return summary;
    }

    const chatCfg = options.chatCfg && typeof options.chatCfg === "object"
      ? options.chatCfg
      : ((await getAutoIngestChatsMap(env, false))[cid] || { chatId: cid, title: processRows[0]?.chatTitle || cid });

    // Carryover-Monotonie-Wächter: verhindert Kontext-Verseuchung zwischen Rückwärts-Blöcken & Live-Webhook-Posts!
    const rawCarryover = chatCfg.lastContextSnapshot || null;
    const getSnapMaxMsgId = (snap) => {
      if (!snap || typeof snap !== "object") return 0;
      const direct = Number(snap.maxMessageId || 0);
      if (direct > 0) return direct;
      const anchors = Array.isArray(snap.anchorMessages) ? snap.anchorMessages : [];
      return anchors.reduce((acc, m) => Math.max(acc, Number(m?.id || m?.msg_id || 0)), 0);
    };
    const existingCarryMaxMsgId = getSnapMaxMsgId(rawCarryover);
    const firstWindowMsgId = Number(processRows[0]?.messageId || 0);
    const carryoverIsMonotonic = Boolean(
      rawCarryover &&
      (
        existingCarryMaxMsgId <= 0 ||
        (firstWindowMsgId > existingCarryMaxMsgId && (firstWindowMsgId - existingCarryMaxMsgId) <= 80)
      )
    );
    const carryover = carryoverIsMonotonic ? rawCarryover : null;

    const { entries, boundSubtitleMsgIds, standaloneSubtitles, nextAnchorMessages } =
      extractSmartGroupedEntriesFromInboxWindow(chatCfg, processRows, carryover);

    const rowByMsgId = new Map(processRows.map(r => [Number(r.messageId), r]));
    const suppressedReactionRowIds = new Set(
      processRows.filter(r => r.suppressReaction || r.payload?._suppressReaction).map(r => r.id)
    );
    const handledRowIds = new Set();
    const reactionQueue = [];
    const reviewLogsToSave = [];
    const vipPlaylistItems = [];
    const archiveQueueItems = [];
    const archiveCtxCache = {};

    // In-Batch Serien-Kontext-Cache (spart bei 500+ Serien-Drops bis zu 80% TMDB-Suchanfragen!)
    const seriesTmdbCache = new Map();
    if (carryover?.lastSeriesNormTitle && carryover?.lastSeriesTmdbId) {
      seriesTmdbCache.set(String(carryover.lastSeriesNormTitle), Number(carryover.lastSeriesTmdbId));
    }

    let lastResolvedRef = memoryFallback.get(`last_ingested_media_${cid}`) || null;
    let lastSeriesCarry = carryover?.lastSeriesTmdbId
      ? { normTitle: carryover.lastSeriesNormTitle || "", tmdbId: Number(carryover.lastSeriesTmdbId) }
      : null;

    let resolvedCountInRun = 0;
    let budgetExhaustedAtIdx = -1;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const msgId = Number(entry?.msg_id || entry?.message_id || 0);
      const srcRow = rowByMsgId.get(msgId);
      if (!srcRow) continue;

      if (resolvedCountInRun >= maxResolvePerRun || !hasSubrequestBudget(30)) {
        budgetExhaustedAtIdx = i;
        summary.stoppedByBudget = true;
        break;
      }

      // Serien-Cache-Treffer im Batch nutzen, wenn kein expliziter tmdb_id vorliegt
      const enrichedEntry = { ...entry };
      if (enrichedEntry.isSeries && !enrichedEntry.tmdb_id && enrichedEntry.cleanTitle) {
        const normSeriesKey = normalizeText(enrichedEntry.cleanTitle).toLowerCase().trim();
        if (normSeriesKey && seriesTmdbCache.has(normSeriesKey)) {
          enrichedEntry.tmdb_id = seriesTmdbCache.get(normSeriesKey);
        }
      }

      // Automatische tg_export_-Heilung für historische JSON-Import-Einträge (0 D1-Writes, wenn kein Legacy-Export existiert!)
      if (srcRow.ingestPriority < 10 && srcRow.payload?.telegram_file_id && msgId > 0) {
        const rawChanNum = String(cid).replace(/^-100/, "").replace(/^-/, "");
        const candidateExportId = `tg_export_${rawChanNum}_${msgId}`;
        await replaceExportFileIdInD1(env, candidateExportId, srcRow.payload.telegram_file_id, srcRow.payload.telegram_unique_id || null).catch(() => {});
      }

      // Bestehende Maximal-Qualität vor dem Speichern prüfen (für präzise 🔥 4K-Upgrade-Erkennung!)
      let prevBestQualityRank = 0;
      const incomingRank = getQualityRankForUpgrade(enrichedEntry.quality || detectVideoQuality(srcRow.payload || {}, enrichedEntry.raw_text || "", enrichedEntry.raw_file_name || ""));

      const resolved = await resolveAndIngestMediaEntry(env, enrichedEntry, null, {
        returnUnmatched: true,
        registerAsVipStream: false
      });
      resolvedCountInRun++;
      summary.processedVideos++;
      handledRowIds.add(srcRow.id);

      const isReviewCase = Boolean(
        !resolved ||
        !resolved.ok ||
        resolved.unmatched ||
        resolved.contextError ||
        resolved.isUncertain
      );

      if (isReviewCase) {
        summary.review++;
        rowUpdates.push({
          id: srcRow.id,
          status: "review",
          resultEmoji: "👀",
          reactionPending: 0,
          resolvedTmdbId: resolved?.tmdbId || null,
          resolvedType: resolved?.typeCode || null
        });
        reactionQueue.push({ rowId: srcRow.id, messageId: msgId, emoji: "👀" });
        reviewLogsToSave.push({
          msgId,
          stage: "CHANNEL_INGEST",
          status: resolved?.contextError || resolved?.isUncertain ? "CONFLICT" : "TMDB_NOT_FOUND",
          reviewReasonCode: resolved?.reviewReasonCode || "TMDB_NOT_FOUND",
          reason: resolved?.errorReason || `Kanal-/Gruppen-Upload aus "${chatCfg.title || cid}" konnte nicht sicher zugeordnet werden.`,
          fileName: String(enrichedEntry.raw_file_name || enrichedEntry.filename || srcRow.payload?.file_name || ""),
          textPreview: String(enrichedEntry.raw_text || srcRow.payload?.text || "").slice(0, 240),
          parsedTitle: String(resolved?.parsedTitle || resolved?.parsed?.cleanTitle || enrichedEntry.cleanTitle || ""),
          matchedTitle: resolved?.matchedTitle || resolved?.cleanTitle || null,
          season: resolved?.season ?? enrichedEntry.season ?? null,
          episode: resolved?.episode ?? enrichedEntry.episode ?? null,
          tmdbQuery: String(resolved?.parsed?.cleanTitle || enrichedEntry.cleanTitle || ""),
          tmdbResult: resolved?.matchedTitle || "Kein Treffer",
          tmdbId: resolved?.tmdbId || null,
          typeCode: resolved?.typeCode || (enrichedEntry.isSeries ? "s" : "m"),
          details: {
            chatId: cid,
            chatTitle: chatCfg.title || cid,
            rawEntry: {
              ...enrichedEntry,
              telegram_file_id: srcRow.payload?.telegram_file_id || enrichedEntry.telegram_file_id || null,
              telegram_unique_id: srcRow.payload?.telegram_unique_id || enrichedEntry.telegram_unique_id || null,
              file_size: srcRow.payload?.file_size || enrichedEntry.file_size || null,
              mime_type: srcRow.payload?.mime_type || enrichedEntry.mime_type || "video/mp4",
              msg_id: msgId,
              message_id: msgId,
              chat_id: cid
            },
            candidates: Array.isArray(resolved?.candidates) ? resolved.candidates.slice(0, 5) : []
          }
        });
      } else {
        // Prüfe echtes Qualitäts-Upgrade (z. B. 720p -> 1080p, 1080p -> 4K/2160p oder Clean ersetzt CAM/TS)
        let prevBestQualityLabel = "";
        if (resolved.ingestStatus === "merged_quality") {
          try {
            const existingFiles = resolved.typeCode === "s"
              ? await getEpisodeFilesFromD1(env, resolved.tmdbId, resolved.season || 1, resolved.episode || 1)
              : await getMovieFilesFromD1(env, resolved.tmdbId, false);
            for (const f of (existingFiles || [])) {
              if (String(f.telegram_file_id || "") === String(srcRow.payload?.telegram_file_id || "")) continue;
              const rRank = getQualityRankForUpgrade(f.quality);
              if (rRank > prevBestQualityRank) {
                prevBestQualityRank = rRank;
                prevBestQualityLabel = String(f.quality || "").trim();
              }
            }
          } catch (_e) {}
        }

        let emoji = "👍";
        const isTrueQualityUpgrade =
          resolved.ingestStatus === "replaced_prerelease" ||
          (resolved.ingestStatus === "merged_quality" && prevBestQualityRank > 0 && incomingRank > prevBestQualityRank);
        const isDuplicateOrLowerQuality =
          resolved.ingestStatus === "duplicate" ||
          resolved.ingestStatus === "skipped_prerelease" ||
          (resolved.ingestStatus === "merged_quality" && !isTrueQualityUpgrade);
        if (resolved.ingestStatus === "replaced_prerelease" && !prevBestQualityLabel) {
          prevBestQualityLabel = "CAM/TS";
        }

        if (isTrueQualityUpgrade) {
          emoji = "🔥";
          summary.upgraded++;
        } else if (isDuplicateOrLowerQuality) {
          emoji = "👌";
          summary.duplicates++;
        } else {
          emoji = "👍";
          summary.added++;
        }

        rowUpdates.push({
          id: srcRow.id,
          status: "done",
          resultEmoji: emoji,
          reactionPending: 0,
          resolvedTmdbId: resolved.tmdbId,
          resolvedType: resolved.typeCode
        });
        reactionQueue.push({ rowId: srcRow.id, messageId: msgId, emoji });
        vipPlaylistItems.push(resolved);
        if (!isDuplicateOrLowerQuality || isTrueQualityUpgrade) {
          const archCand = await collectArchiveMirrorQueueCandidate(env, {
            resolved,
            srcRow,
            sourceChatId: cid,
            ctxCache: archiveCtxCache,
            upgradeInfo: isTrueQualityUpgrade ? { isUpgrade: true, previousQuality: prevBestQualityLabel } : null
          }).catch(() => null);
          if (archCand) archiveQueueItems.push(archCand);
        }

        lastResolvedRef = {
          typeCode: resolved.typeCode,
          tmdbId: resolved.tmdbId,
          season: resolved.season || 1,
          episode: resolved.episode || 1,
          fileId: srcRow.payload?.telegram_file_id || "",
          title: resolved.cleanTitle
        };

        if (resolved.typeCode === "s" && resolved.tmdbId) {
          const normKey = normalizeText(resolved.cleanTitle || enrichedEntry.cleanTitle || "").toLowerCase().trim();
          if (normKey) {
            seriesTmdbCache.set(normKey, Number(resolved.tmdbId));
            lastSeriesCarry = { normTitle: normKey, tmdbId: Number(resolved.tmdbId) };
          }
        }

        // Gekoppelte Untertitel-Zeilen direkt als done + ✍ markieren
        if (Array.isArray(enrichedEntry.subtitle_files)) {
          for (const sf of enrichedEntry.subtitle_files) {
            const subRow = rowByMsgId.get(Number(sf?.message_id || 0));
            if (subRow && !handledRowIds.has(subRow.id)) {
              handledRowIds.add(subRow.id);
              summary.subtitlesLinked++;
              rowUpdates.push({
                id: subRow.id,
                status: "done",
                resultEmoji: "✍",
                reactionPending: 0,
                resolvedTmdbId: resolved.tmdbId,
                resolvedType: resolved.typeCode
              });
              reactionQueue.push({ rowId: subRow.id, messageId: subRow.messageId, emoji: "✍" });
            }
          }
        }
      }
    }

    // Falls Budget mitten im Fenster voll war: restliche noch nicht verarbeitete Video-/Untertitel-Zeilen sauber auf pending zurücksetzen!
    const cutoffUnprocessedMsgId = budgetExhaustedAtIdx >= 0
      ? Number(entries[budgetExhaustedAtIdx]?.msg_id || entries[budgetExhaustedAtIdx]?.message_id || Infinity)
      : Infinity;

    // Eigenständige Untertitel (z. B. Reply auf Video aus vorherigem Batch oder direkt nach letztem Video)
    for (const subRow of standaloneSubtitles) {
      if (handledRowIds.has(subRow.id)) continue;
      if (Number(subRow.messageId) >= cutoffUnprocessedMsgId) {
        handledRowIds.add(subRow.id);
        rowUpdates.push({ id: subRow.id, status: "pending", reactionPending: 0 });
        continue;
      }
      let targetMedia = lastResolvedRef;
      if (!targetMedia && typeof getEntityFromD1 === "function") {
        targetMedia = await getEntityFromD1(env, `last_ingested_media_${cid}`, 6 * 3600 * 1000).catch(() => null);
      }
      if (targetMedia && targetMedia.tmdbId && subRow.payload?.telegram_file_id) {
        const subItem = {
          telegram_file_id: String(subRow.payload.telegram_file_id),
          file_name: String(subRow.payload.file_name || "Untertitel.srt"),
          lang: "de",
          message_id: subRow.messageId
        };
        const boundOk = await attachSubtitleToMediaInD1(env, targetMedia, subItem).catch(() => false);
        handledRowIds.add(subRow.id);
        if (boundOk) {
          summary.subtitlesLinked++;
          rowUpdates.push({
            id: subRow.id,
            status: "done",
            resultEmoji: "✍",
            reactionPending: 0,
            resolvedTmdbId: targetMedia.tmdbId,
            resolvedType: targetMedia.typeCode
          });
          reactionQueue.push({ rowId: subRow.id, messageId: subRow.messageId, emoji: "✍" });
          continue;
        }
      }
      handledRowIds.add(subRow.id);
      rowUpdates.push({ id: subRow.id, status: "ignored", reactionPending: 0 });
    }

    // Alle übrigen Zeilen im Fenster abschließen (Kontext-Header -> done, nach Budget-Stopp -> pending)
    for (const r of processRows) {
      if (handledRowIds.has(r.id)) continue;
      if (Number(r.messageId) >= cutoffUnprocessedMsgId) {
        rowUpdates.push({ id: r.id, status: "pending", reactionPending: 0 });
      } else if (r.msgKind === "context") {
        rowUpdates.push({ id: r.id, status: "done", reactionPending: 0 });
      } else {
        rowUpdates.push({ id: r.id, status: "ignored", reactionPending: 0 });
      }
    }

    // Persistiere Review-Logs, Bot-VIP-Playlist & letztes Medium
    if (reviewLogsToSave.length > 0 && typeof saveImportDiagnosticLogsToD1 === "function") {
      await saveImportDiagnosticLogsToD1(env, reviewLogsToSave).catch(() => {});
    }
    if (vipPlaylistItems.length > 0) {
      try {
        const botVipFolder = await getOrCreateBotVipMainFolderFast(env);
        if (botVipFolder) {
          await batchSaveIngestedItemsToPlaylist(env, "bot_vip", botVipFolder.id, vipPlaylistItems, "vip_stream");
        }
      } catch (_e) {}
    }
    if (archiveQueueItems.length > 0 && typeof enqueueArchiveMirrorItemsInD1 === "function") {
      await enqueueArchiveMirrorItemsInD1(env, archiveQueueItems).catch(() => {});
    }
    if (lastResolvedRef) {
      memoryFallback.set(`last_ingested_media_${cid}`, lastResolvedRef);
      if (typeof saveEntityToD1 === "function") {
        await saveEntityToD1(env, `last_ingested_media_${cid}`, "last_ingested_media", lastResolvedRef).catch(() => {});
      }
    }

    // Stille Emoji-Reaktionen mit per-Row suppressReaction-Respektierung & adaptivem Telegram-429-Schutz ausliefern
    const effectiveReactionQueue = reactionQueue.filter(item => !suppressedReactionRowIds.has(item.rowId));
    const reactRes = effectiveReactionQueue.length > 0
      ? await dispatchAdaptiveInboxReactions(env, cid, effectiveReactionQueue)
      : { sent: 0, deferredIds: [], skippedIds: [], rateLimited: false };
    summary.reactionsSent = reactRes.sent;
    summary.reactionsDeferred = reactRes.deferredIds.length;
    if (reactRes.deferredIds.length > 0) {
      const defSet = new Set(reactRes.deferredIds);
      for (const u of rowUpdates) {
        if (defSet.has(u.id)) u.reactionPending = 1;
      }
    }

    await markChannelIngestRowsStatusInD1(env, rowUpdates);

    // Kontext-Überhang nur aus tatsächlich verbrauchten Zeilen (< cutoffUnprocessedMsgId) übernehmen,
    // damit ein zukünftiges Staffel-2-Poster aus dem zurückgestellten Rest niemals das aktive Staffel-1-Poster überschreibt!
    let effectiveNextAnchors = nextAnchorMessages;
    if (budgetExhaustedAtIdx >= 0 && Number.isFinite(cutoffUnprocessedMsgId)) {
      const consumedAnchors = processRows
        .filter(r => Number(r.messageId) < cutoffUnprocessedMsgId)
        .map(r => {
          const p = (r.payload && typeof r.payload === "object") ? r.payload : {};
          return {
            id: Number(r.messageId),
            msg_id: Number(r.messageId),
            type: "message",
            chat_id: String(chatCfg.chatId || cid),
            text: String(p.text || "").slice(0, 600),
            photo: p.photo,
            media_type: p.media_type === "photo" ? "photo" : undefined,
            _hasFile: Boolean(p.telegram_file_id)
          };
        })
        .filter(m => !m._hasFile || m.media_type === "photo" || /\b(?:Staffel|Season)\s*0*\d{1,2}\b/i.test(m.text))
        .slice(-2)
        .map(({ _hasFile, ...rest }) => rest);
      effectiveNextAnchors = consumedAnchors.length > 0
        ? consumedAnchors
        : (Array.isArray(carryover?.anchorMessages) ? carryover.anchorMessages : []);
    }

    // Carryover-Monotonie-Wächter beim Schreiben: Ein älterer History-Block darf den neueren Live-Carryover NIEMALS überschreiben!
    const consumedMaxMsgId = processRows
      .filter(r => !Number.isFinite(cutoffUnprocessedMsgId) || Number(r.messageId) < cutoffUnprocessedMsgId)
      .reduce((acc, r) => Math.max(acc, Number(r.messageId || 0)), 0);
    const canOverwriteSnapshot = consumedMaxMsgId >= existingCarryMaxMsgId;

    const prevAnchorSig = Array.isArray(rawCarryover?.anchorMessages)
      ? rawCarryover.anchorMessages.map(m => Number(m?.id || m?.msg_id || 0)).join(",")
      : "";
    const nextAnchorSig = Array.isArray(effectiveNextAnchors)
      ? effectiveNextAnchors.map(m => Number(m?.id || m?.msg_id || 0)).join(",")
      : "";
    const prevSeriesId = Number(rawCarryover?.lastSeriesTmdbId || 0);
    const nextSeriesId = Number(lastSeriesCarry?.tmdbId || 0);
    if (canOverwriteSnapshot && (prevAnchorSig !== nextAnchorSig || prevSeriesId !== nextSeriesId || consumedMaxMsgId > existingCarryMaxMsgId)) {
      await updateAutoIngestChatContextSnapshot(env, cid, {
        anchorMessages: effectiveNextAnchors,
        lastSeriesNormTitle: lastSeriesCarry?.normTitle || null,
        lastSeriesTmdbId: lastSeriesCarry?.tmdbId || null,
        maxMessageId: consumedMaxMsgId,
        updatedAt: Date.now()
      });
    }

    return summary;
  }

  async function runScheduledChannelIngestFlush(env, options = {}) {
    const forceFlush = Boolean(options.forceFlush);
    const filterChatId = options.filterChatId ? String(options.filterChatId).trim() : null;
    const maxResolvePerRun = Math.max(1, Math.min(10, Number(options.maxResolvePerRun || 6)));
    const now = Date.now();

    const totals = {
      source: String(options.source || "cron"),
      chatsProcessed: 0,
      processedVideos: 0,
      added: 0,
      upgraded: 0,
      duplicates: 0,
      review: 0,
      subtitlesLinked: 0,
      reactionsSent: 0,
      reactionsDeferred: 0,
      reactionsRetried: 0,
      remainingPending: 0,
      cleanedOldRows: 0
    };

    try {
      // O(1)-Index-Fast-Probe (1 gebündelter D1-Batch: liest im Leerlauf 0 Zeilen und macht 0 D1-Writes!)
      let probe = await getChannelIngestCronFastProbeFromD1(env, now, filterChatId);
      if (probe.hasExpiredLocks) {
        const released = await releaseExpiredChannelIngestLocksInD1(env, now);
        if (released > 0) {
          probe = await getChannelIngestCronFastProbeFromD1(env, now, filterChatId);
        }
      }

      const eligibleChats = (probe.chats || []).filter(c => {
        if (c.pending <= 0) return false;
        if (forceFlush) return true;
        const quietMs = c.newestPendingAt ? (now - c.newestPendingAt) : INGEST_SETTLE_WINDOW_MS;
        const oldestAgeMs = c.oldestPendingAt ? (now - c.oldestPendingAt) : 0;
        return (
          quietMs >= INGEST_SETTLE_WINDOW_MS ||
          c.pending >= INGEST_BACKLOG_THRESHOLD ||
          oldestAgeMs >= INGEST_MAX_AGE_TRIGGER_MS
        );
      });

      let chatsMapForLease = null;
      if (!forceFlush && eligibleChats.length > 0) {
        chatsMapForLease = await getAutoIngestChatsMap(env, true).catch(() => ({}));
      }

      let remainingBudgetResolves = maxResolvePerRun;
      let anyReactionRateLimited = false;
      for (const ch of eligibleChats) {
        if (remainingBudgetResolves <= 0 || !hasSubrequestBudget(28)) break;
        // Wenn der Admin gerade den Browser-Turbo für diesen Chat laufen lässt, Cron-Kollision vermeiden!
        if (!forceFlush) {
          const ramLease = Number(memoryFallback.get(`browser_turbo_active_${ch.chatId}`) || 0);
          const d1Lease = Number(chatsMapForLease?.[ch.chatId]?.lastContextSnapshot?.browserTurboUntil || 0);
          if (ramLease > now || d1Lease > now) continue;
        }
        const dynamicWindowLimit = Math.max(12, Math.min(20, remainingBudgetResolves * 2 + 6));
        const res = await flushChannelIngestWindow(env, ch.chatId, {
          forceFlush,
          windowLimit: dynamicWindowLimit,
          maxResolvePerRun: remainingBudgetResolves,
          skipLockRelease: true,
          chatCfg: chatsMapForLease?.[ch.chatId] || null
        });
        totals.chatsProcessed++;
        totals.processedVideos += res.processedVideos;
        totals.added += res.added;
        totals.upgraded += res.upgraded;
        totals.duplicates += res.duplicates;
        totals.review += res.review;
        totals.subtitlesLinked += res.subtitlesLinked;
        totals.reactionsSent += res.reactionsSent;
        totals.reactionsDeferred += Number(res.reactionsDeferred || 0);
        if (Number(res.reactionsDeferred || 0) > 0) anyReactionRateLimited = true;
        remainingBudgetResolves = Math.max(0, remainingBudgetResolves - res.processedVideos);
      }

      // Nachgelagerte Reaktionen (aus früheren Telegram 429-Pausen) nur abrufen, wenn überhaupt welche offen sind
      // und nicht unmittelbar nach einem frischen 429 im selben Cron-Zyklus.
      if (!anyReactionRateLimited && probe.hasPendingReactions && hasSubrequestBudget(34)) {
        const pendingReactions = await getPendingReactionInboxRowsFromD1(env, 10);
        if (pendingReactions.length > 0) {
          const { setMessageReaction } = tgApi(env);
          const clearedIds = [];
          for (const pr of pendingReactions) {
            if (!hasSubrequestBudget(38)) break;
            const r = await setMessageReaction(pr.chatId, pr.messageId, pr.emoji, { fallbackEmoji: "👍" });
            if (r?.ok) {
              clearedIds.push(pr.id);
              totals.reactionsRetried++;
            } else if (r?.rateLimited) {
              break;
            } else {
              clearedIds.push(pr.id);
            }
          }
          if (clearedIds.length > 0) {
            await clearPendingReactionInD1(env, clearedIds);
          }
        }
      }

      totals.remainingPending = totals.chatsProcessed > 0
        ? await countPendingChannelIngestInD1(env, filterChatId)
        : Number(probe.totalPending || 0);
      // Hinweis: Die zentrale 30-Tage-D1-Hygiene (Inbox-Löschung + verlustfreie Archiv-Kompaktierung + Cache-TTL)
      // läuft gebündelt und 6h-gedrosselt im scheduled()-Cron-Handler.
    } catch (e) {
      console.error("[ChannelIngestFlush] Fehler:", e?.message || e);
    }
    return totals;
  }

  // Browser-Turbo-Offload (Schritt 3): Nimmt bereits im Browser des Admins gruppierte Kanal-/Gruppen-Batches
  // entgegen (max. 10 Videos pro Request -> 0ms Server-Parser-CPU, sicher unter dem 50-Subrequest-Limit!).
  async function processBrowserGroupedChannelIngestBatch(env, chatId, payload = {}) {
    const cid = String(chatId || "").trim();
    const rawEntries = Array.isArray(payload.entries) ? payload.entries.slice(0, 10) : [];
    const contextRowIds = Array.isArray(payload.contextRowIds)
      ? payload.contextRowIds.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0).slice(0, 200)
      : [];
    const standaloneSubRowIds = Array.isArray(payload.standaloneSubtitleRowIds)
      ? payload.standaloneSubtitleRowIds.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0).slice(0, 40)
      : [];
    const incomingHints = (payload.seriesTmdbHints && typeof payload.seriesTmdbHints === "object")
      ? payload.seriesTmdbHints
      : {};

    const summary = {
      chatId: cid,
      processedVideos: 0,
      skippedAlreadyDone: 0,
      added: 0,
      upgraded: 0,
      duplicates: 0,
      review: 0,
      subtitlesLinked: 0,
      contextDone: 0,
      reactionsSent: 0,
      reactionsDeferred: 0,
      stoppedByBudget: false
    };

    const allIds = [];
    for (const e of rawEntries) {
      const rid = Number(e?.inboxRowId || 0);
      if (rid > 0) allIds.push(rid);
      if (Array.isArray(e?.subtitleRowIds)) {
        for (const srid of e.subtitleRowIds) {
          if (Number(srid) > 0) allIds.push(Number(srid));
        }
      }
    }
    for (const id of contextRowIds) allIds.push(id);
    for (const id of standaloneSubRowIds) allIds.push(id);

    const dbRows = allIds.length > 0 ? await getChannelIngestRowsByIdsFromD1(env, cid, allIds) : [];
    const rowById = new Map(dbRows.map(r => [Number(r.id), r]));
    const chatsMap = await getAutoIngestChatsMap(env, false);
    const chatCfg = chatsMap[cid] || { chatId: cid, title: dbRows[0]?.chatTitle || cid };

    const seriesTmdbCache = new Map();
    for (const [k, v] of Object.entries(incomingHints).slice(-100)) {
      const tid = Number(v || 0);
      if (k && tid > 0) seriesTmdbCache.set(String(k).toLowerCase().trim(), tid);
    }
    if (chatCfg?.lastContextSnapshot?.lastSeriesNormTitle && chatCfg?.lastContextSnapshot?.lastSeriesTmdbId) {
      const normK = String(chatCfg.lastContextSnapshot.lastSeriesNormTitle).toLowerCase().trim();
      if (normK && !seriesTmdbCache.has(normK)) {
        seriesTmdbCache.set(normK, Number(chatCfg.lastContextSnapshot.lastSeriesTmdbId));
      }
    }

    const rowUpdates = [];
    const handledRowIds = new Set();
    const reactionQueue = [];
    const reviewLogsToSave = [];
    const vipPlaylistItems = [];
    const archiveQueueItems = [];
    const archiveCtxCache = {};
    let lastResolvedRef = memoryFallback.get(`last_ingested_media_${cid}`) || null;
    let lastSeriesCarry = chatCfg?.lastContextSnapshot?.lastSeriesTmdbId
      ? { normTitle: chatCfg.lastContextSnapshot.lastSeriesNormTitle || "", tmdbId: Number(chatCfg.lastContextSnapshot.lastSeriesTmdbId) }
      : null;

    const batchNowMs = Date.now();
    memoryFallback.set(`browser_turbo_active_${cid}`, batchNowMs + 90000);

    for (let i = 0; i < rawEntries.length; i++) {
      const clientEntry = rawEntries[i] || {};
      const rid = Number(clientEntry.inboxRowId || 0);
      const srcRow = rowById.get(rid);
      if (!srcRow) continue;
      if (
        srcRow.status === "done" ||
        srcRow.status === "review" ||
        srcRow.status === "ignored" ||
        (srcRow.status === "processing" && Number(srcRow.lockedUntil || 0) > batchNowMs)
      ) {
        summary.skippedAlreadyDone++;
        handledRowIds.add(srcRow.id);
        continue;
      }
      if (!hasSubrequestBudget(30)) {
        summary.stoppedByBudget = true;
        break;
      }

      // Autoritative Datei-/Nachrichtenfelder immer aus D1 übernehmen (Client liefert nur Gruppierungs-Metadaten!)
      const subtitleFiles = [];
      const linkedSubRows = [];
      if (Array.isArray(clientEntry.subtitleRowIds)) {
        for (const srid of clientEntry.subtitleRowIds) {
          const sRow = rowById.get(Number(srid));
          if (sRow && sRow.msgKind === "subtitle" && sRow.payload?.telegram_file_id) {
            linkedSubRows.push(sRow);
            subtitleFiles.push({
              telegram_file_id: String(sRow.payload.telegram_file_id),
              file_name: String(sRow.payload.file_name || "Untertitel.srt"),
              lang: "de",
              message_id: sRow.messageId
            });
          }
        }
      }

      const enrichedEntry = {
        ...clientEntry,
        msg_id: srcRow.messageId,
        message_id: srcRow.messageId,
        chat_id: cid,
        telegram_file_id: srcRow.payload?.telegram_file_id || null,
        telegram_unique_id: srcRow.payload?.telegram_unique_id || null,
        raw_file_name: srcRow.payload?.file_name || clientEntry.raw_file_name || "",
        file_name: srcRow.payload?.file_name || clientEntry.file_name || "",
        file_size: srcRow.payload?.file_size || null,
        width: srcRow.payload?.width || null,
        height: srcRow.payload?.height || null,
        duration: srcRow.payload?.duration_seconds || srcRow.payload?.duration || null,
        duration_seconds: srcRow.payload?.duration_seconds || srcRow.payload?.duration || null,
        mime_type: srcRow.payload?.mime_type || "video/mp4",
        raw_text: srcRow.payload?.text || clientEntry.raw_text || "",
        message_link: srcRow.payload?.message_link || clientEntry.message_link || "",
        subtitle_files: subtitleFiles
      };

      if (enrichedEntry.isSeries && !enrichedEntry.tmdb_id && enrichedEntry.cleanTitle) {
        const normSeriesKey = normalizeText(enrichedEntry.cleanTitle).toLowerCase().trim();
        if (normSeriesKey && seriesTmdbCache.has(normSeriesKey)) {
          enrichedEntry.tmdb_id = seriesTmdbCache.get(normSeriesKey);
        }
      }

      // Automatische tg_export_-Heilung auch im Browser-Offload für History-Zeilen (0 Writes, wenn kein Legacy-Export existiert)
      if (srcRow.ingestPriority < 10 && srcRow.payload?.telegram_file_id && srcRow.messageId > 0) {
        const rawChanNum = String(cid).replace(/^-100/, "").replace(/^-/, "");
        const candidateExportId = `tg_export_${rawChanNum}_${srcRow.messageId}`;
        await replaceExportFileIdInD1(env, candidateExportId, srcRow.payload.telegram_file_id, srcRow.payload.telegram_unique_id || null).catch(() => {});
      }

      let prevBestQualityRank = 0;
      const incomingRank = getQualityRankForUpgrade(
        enrichedEntry.quality || detectVideoQuality(srcRow.payload || {}, enrichedEntry.raw_text || "", enrichedEntry.raw_file_name || "")
      );

      const resolved = await resolveAndIngestMediaEntry(env, enrichedEntry, null, {
        returnUnmatched: true,
        registerAsVipStream: false
      });
      summary.processedVideos++;
      handledRowIds.add(srcRow.id);

      const isReviewCase = Boolean(
        !resolved || !resolved.ok || resolved.unmatched || resolved.contextError || resolved.isUncertain
      );

      if (isReviewCase) {
        summary.review++;
        rowUpdates.push({
          id: srcRow.id,
          status: "review",
          resultEmoji: "👀",
          reactionPending: 0,
          resolvedTmdbId: resolved?.tmdbId || null,
          resolvedType: resolved?.typeCode || null
        });
        reactionQueue.push({ rowId: srcRow.id, messageId: srcRow.messageId, emoji: "👀" });
        reviewLogsToSave.push({
          msgId: srcRow.messageId,
          stage: "CHANNEL_INGEST_TURBO",
          status: resolved?.contextError || resolved?.isUncertain ? "CONFLICT" : "TMDB_NOT_FOUND",
          reviewReasonCode: resolved?.reviewReasonCode || "TMDB_NOT_FOUND",
          reason: resolved?.errorReason || `Kanal-/Gruppen-Upload aus "${chatCfg.title || cid}" konnte nicht sicher zugeordnet werden.`,
          fileName: String(enrichedEntry.raw_file_name || ""),
          textPreview: String(enrichedEntry.raw_text || "").slice(0, 240),
          parsedTitle: String(resolved?.parsedTitle || resolved?.parsed?.cleanTitle || enrichedEntry.cleanTitle || ""),
          matchedTitle: resolved?.matchedTitle || resolved?.cleanTitle || null,
          season: resolved?.season ?? enrichedEntry.season ?? null,
          episode: resolved?.episode ?? enrichedEntry.episode ?? null,
          tmdbQuery: String(resolved?.parsed?.cleanTitle || enrichedEntry.cleanTitle || ""),
          tmdbResult: resolved?.matchedTitle || "Kein Treffer",
          tmdbId: resolved?.tmdbId || null,
          typeCode: resolved?.typeCode || (enrichedEntry.isSeries ? "s" : "m"),
          details: {
            chatId: cid,
            chatTitle: chatCfg.title || cid,
            rawEntry: enrichedEntry,
            candidates: Array.isArray(resolved?.candidates) ? resolved.candidates.slice(0, 5) : []
          }
        });
      } else {
        let prevBestQualityLabel = "";
        if (resolved.ingestStatus === "merged_quality") {
          try {
            const existingFiles = resolved.typeCode === "s"
              ? await getEpisodeFilesFromD1(env, resolved.tmdbId, resolved.season || 1, resolved.episode || 1)
              : await getMovieFilesFromD1(env, resolved.tmdbId, false);
            for (const f of (existingFiles || [])) {
              if (String(f.telegram_file_id || "") === String(srcRow.payload?.telegram_file_id || "")) continue;
              const rRank = getQualityRankForUpgrade(f.quality);
              if (rRank > prevBestQualityRank) {
                prevBestQualityRank = rRank;
                prevBestQualityLabel = String(f.quality || "").trim();
              }
            }
          } catch (_e) {}
        }

        const isTrueQualityUpgrade =
          resolved.ingestStatus === "replaced_prerelease" ||
          (resolved.ingestStatus === "merged_quality" && prevBestQualityRank > 0 && incomingRank > prevBestQualityRank);
        const isDuplicateOrLowerQuality =
          resolved.ingestStatus === "duplicate" ||
          resolved.ingestStatus === "skipped_prerelease" ||
          (resolved.ingestStatus === "merged_quality" && !isTrueQualityUpgrade);
        if (resolved.ingestStatus === "replaced_prerelease" && !prevBestQualityLabel) {
          prevBestQualityLabel = "CAM/TS";
        }

        let emoji = "👍";
        if (isTrueQualityUpgrade) {
          emoji = "🔥";
          summary.upgraded++;
        } else if (isDuplicateOrLowerQuality) {
          emoji = "👌";
          summary.duplicates++;
        } else {
          emoji = "👍";
          summary.added++;
        }

        rowUpdates.push({
          id: srcRow.id,
          status: "done",
          resultEmoji: emoji,
          reactionPending: 0,
          resolvedTmdbId: resolved.tmdbId,
          resolvedType: resolved.typeCode
        });
        reactionQueue.push({ rowId: srcRow.id, messageId: srcRow.messageId, emoji });
        vipPlaylistItems.push(resolved);
        if (!isDuplicateOrLowerQuality || isTrueQualityUpgrade) {
          const archCand = await collectArchiveMirrorQueueCandidate(env, {
            resolved,
            srcRow,
            sourceChatId: cid,
            ctxCache: archiveCtxCache,
            upgradeInfo: isTrueQualityUpgrade ? { isUpgrade: true, previousQuality: prevBestQualityLabel } : null
          }).catch(() => null);
          if (archCand) archiveQueueItems.push(archCand);
        }

        lastResolvedRef = {
          typeCode: resolved.typeCode,
          tmdbId: resolved.tmdbId,
          season: resolved.season || 1,
          episode: resolved.episode || 1,
          fileId: srcRow.payload?.telegram_file_id || "",
          title: resolved.cleanTitle
        };
        if (resolved.typeCode === "s" && resolved.tmdbId) {
          const normKey = normalizeText(resolved.cleanTitle || enrichedEntry.cleanTitle || "").toLowerCase().trim();
          if (normKey) {
            seriesTmdbCache.set(normKey, Number(resolved.tmdbId));
            lastSeriesCarry = { normTitle: normKey, tmdbId: Number(resolved.tmdbId) };
          }
        }
        for (const sRow of linkedSubRows) {
          if (handledRowIds.has(sRow.id)) continue;
          handledRowIds.add(sRow.id);
          summary.subtitlesLinked++;
          rowUpdates.push({
            id: sRow.id,
            status: "done",
            resultEmoji: "✍",
            reactionPending: 0,
            resolvedTmdbId: resolved.tmdbId,
            resolvedType: resolved.typeCode
          });
          reactionQueue.push({ rowId: sRow.id, messageId: sRow.messageId, emoji: "✍" });
        }
      }
    }

    // Eigenständige Untertitel an zuletzt erkanntes Medium binden
    if (!summary.stoppedByBudget) {
      for (const srid of standaloneSubRowIds) {
        const sRow = rowById.get(srid);
        if (!sRow || handledRowIds.has(sRow.id) || sRow.status !== "pending") continue;
        let targetMedia = lastResolvedRef;
        if (!targetMedia && typeof getEntityFromD1 === "function") {
          targetMedia = await getEntityFromD1(env, `last_ingested_media_${cid}`, 6 * 3600 * 1000).catch(() => null);
        }
        handledRowIds.add(sRow.id);
        if (targetMedia && targetMedia.tmdbId && sRow.payload?.telegram_file_id) {
          const boundOk = await attachSubtitleToMediaInD1(env, targetMedia, {
            telegram_file_id: String(sRow.payload.telegram_file_id),
            file_name: String(sRow.payload.file_name || "Untertitel.srt"),
            lang: "de",
            message_id: sRow.messageId
          }).catch(() => false);
          if (boundOk) {
            summary.subtitlesLinked++;
            rowUpdates.push({
              id: sRow.id,
              status: "done",
              resultEmoji: "✍",
              reactionPending: 0,
              resolvedTmdbId: targetMedia.tmdbId,
              resolvedType: targetMedia.typeCode
            });
            reactionQueue.push({ rowId: sRow.id, messageId: sRow.messageId, emoji: "✍" });
            continue;
          }
        }
        rowUpdates.push({ id: sRow.id, status: "ignored", reactionPending: 0 });
      }

      // Verbrauchte Kontext-Zeilen (Poster/Text-Header) als done markieren
      for (const crid of contextRowIds) {
        const cRow = rowById.get(crid);
        if (!cRow || handledRowIds.has(cRow.id) || cRow.status !== "pending") continue;
        handledRowIds.add(cRow.id);
        summary.contextDone++;
        rowUpdates.push({ id: cRow.id, status: "done", reactionPending: 0 });
      }
    }

    if (reviewLogsToSave.length > 0 && typeof saveImportDiagnosticLogsToD1 === "function") {
      await saveImportDiagnosticLogsToD1(env, reviewLogsToSave).catch(() => {});
    }
    if (vipPlaylistItems.length > 0) {
      try {
        const botVipFolder = await getOrCreateBotVipMainFolderFast(env);
        if (botVipFolder) {
          await batchSaveIngestedItemsToPlaylist(env, "bot_vip", botVipFolder.id, vipPlaylistItems, "vip_stream");
        }
      } catch (_e) {}
    }
    if (archiveQueueItems.length > 0 && typeof enqueueArchiveMirrorItemsInD1 === "function") {
      await enqueueArchiveMirrorItemsInD1(env, archiveQueueItems).catch(() => {});
    }
    if (lastResolvedRef) {
      memoryFallback.set(`last_ingested_media_${cid}`, lastResolvedRef);
      if (typeof saveEntityToD1 === "function") {
        await saveEntityToD1(env, `last_ingested_media_${cid}`, "last_ingested_media", lastResolvedRef).catch(() => {});
      }
    }

    // Per-Row suppressReaction-Filter auch im Browser-Offload respektieren!
    const effectiveTurboReactions = reactionQueue.filter(item => {
      const r = rowById.get(item.rowId);
      return !(r && (r.suppressReaction || r.payload?._suppressReaction));
    });
    if (effectiveTurboReactions.length > 0) {
      const reactRes = await dispatchAdaptiveInboxReactions(env, cid, effectiveTurboReactions);
      summary.reactionsSent = reactRes.sent;
      summary.reactionsDeferred = reactRes.deferredIds.length;
      if (reactRes.deferredIds.length > 0) {
        const defSet = new Set(reactRes.deferredIds);
        for (const u of rowUpdates) {
          if (defSet.has(u.id)) u.reactionPending = 1;
        }
      }
    }

    if (rowUpdates.length > 0) {
      await markChannelIngestRowsStatusInD1(env, rowUpdates);
    }

    const remainingPending = await countPendingChannelIngestInD1(env, cid);
    const nextTurboLeaseUntil = remainingPending > 0 ? (Date.now() + 150000) : 0;
    if (remainingPending === 0) {
      memoryFallback.delete(`browser_turbo_active_${cid}`);
    }

    // Carryover-Monotonie-Wächter auch beim Browser-Offload (ältere History-Blöcke dürfen neueren Live-Kontext nicht überschreiben!)
    const prevCarryMaxMsgId = Number(chatCfg?.lastContextSnapshot?.maxMessageId || 0) ||
      (Array.isArray(chatCfg?.lastContextSnapshot?.anchorMessages)
        ? chatCfg.lastContextSnapshot.anchorMessages.reduce((acc, m) => Math.max(acc, Number(m?.id || m?.msg_id || 0)), 0)
        : 0);
    const batchMaxMsgId = Array.from(handledRowIds).reduce((acc, rid) => Math.max(acc, Number(rowById.get(rid)?.messageId || 0)), 0);
    const canUpdateCarryoverContent = batchMaxMsgId >= prevCarryMaxMsgId;

    const prevCarryTmdbId = Number(chatCfg?.lastContextSnapshot?.lastSeriesTmdbId || 0);
    const prevTurboLeaseUntil = Number(chatCfg?.lastContextSnapshot?.browserTurboUntil || 0);
    const needLeaseUpdate = (remainingPending > 0 && prevTurboLeaseUntil < (Date.now() + 45000)) || (remainingPending === 0 && prevTurboLeaseUntil > Date.now());
    if (canUpdateCarryoverContent && payload.nextContextSnapshot && typeof payload.nextContextSnapshot === "object") {
      const snap = payload.nextContextSnapshot;
      await updateAutoIngestChatContextSnapshot(env, cid, {
        anchorMessages: Array.isArray(snap.anchorMessages) ? snap.anchorMessages.slice(-2) : [],
        lastSeriesNormTitle: lastSeriesCarry?.normTitle || snap.lastSeriesNormTitle || null,
        lastSeriesTmdbId: lastSeriesCarry?.tmdbId || snap.lastSeriesTmdbId || null,
        maxMessageId: Math.max(prevCarryMaxMsgId, batchMaxMsgId),
        browserTurboUntil: nextTurboLeaseUntil,
        updatedAt: Date.now()
      });
    } else if ((canUpdateCarryoverContent && lastSeriesCarry && Number(lastSeriesCarry.tmdbId || 0) !== prevCarryTmdbId) || needLeaseUpdate) {
      await updateAutoIngestChatContextSnapshot(env, cid, {
        anchorMessages: Array.isArray(chatCfg?.lastContextSnapshot?.anchorMessages) ? chatCfg.lastContextSnapshot.anchorMessages : [],
        lastSeriesNormTitle: canUpdateCarryoverContent
          ? (lastSeriesCarry?.normTitle || chatCfg?.lastContextSnapshot?.lastSeriesNormTitle || null)
          : (chatCfg?.lastContextSnapshot?.lastSeriesNormTitle || null),
        lastSeriesTmdbId: canUpdateCarryoverContent
          ? (lastSeriesCarry?.tmdbId || chatCfg?.lastContextSnapshot?.lastSeriesTmdbId || null)
          : (chatCfg?.lastContextSnapshot?.lastSeriesTmdbId || null),
        maxMessageId: Math.max(prevCarryMaxMsgId, batchMaxMsgId),
        browserTurboUntil: nextTurboLeaseUntil,
        updatedAt: Date.now()
      });
    }

    const updatedHints = {};
    for (const [k, v] of seriesTmdbCache.entries()) updatedHints[k] = v;
    return {
      ok: true,
      summary,
      seriesTmdbHints: updatedHints,
      remainingPending
    };
  }

  // --- Verarbeitet eingehende Videodateien & .json Titel-Listen / Telegram Chat-Backups beim Bot ---
  async function handleIncomingMediaOrJson(env, message) {
    const { sendMessage, editMessageText, getFileText } = tgApi(env);
    const chatId = message.chat.id;
    const senderId = message.from?.id || chatId;
    const docObj = message.document;
    const docName = String(docObj?.file_name || "").trim();
    const docMime = String(docObj?.mime_type || "").toLowerCase();
    const isVideoDoc = Boolean(docObj && (/^video\//i.test(docMime) || /\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d)$/i.test(docName)));
    const videoObj = message.video || (isVideoDoc ? docObj : null);
    const isJsonDoc = Boolean(docObj && (docName.toLowerCase().endsWith(".json") || docMime === "application/json"));
    const isSubDoc = Boolean(!videoObj && docObj && SUBTITLE_EXTENSIONS.test(docName));
    const isArchiveDoc = Boolean(!videoObj && !isSubDoc && !isJsonDoc && docObj && /\.(?:rar|zip|7z|iso|tar|gz)$/i.test(docName));

    if (!isJsonDoc && !isSubDoc && !videoObj && !(isArchiveDoc && isGroupOrChannelChat(chatId))) return false;

    // GRUPPEN-/KANAL-SCHUTZ (Zero Chat-Spam + 500+ Staging-Inbox):
    // In Gruppen niemals sofortige Lade-Nachrichten, Fehlermeldungen oder Detailkarten posten!
    if (isGroupOrChannelChat(chatId)) {
      let stagedEnabled = false;
      if (!isJsonDoc) {
        const stagedRes = await stageGroupOrChannelMessageIfEnabled(env, message);
        stagedEnabled = Boolean(stagedRes?.enabled);
      }
      // Passive tg_export_ Ernte nur in NICHT aktivierten Gruppen (in aktivierten Chats speichert Stufe 2 die echte file_id direkt -> spart 2 D1-Writes pro Video!)
      if (!stagedEnabled && videoObj && Number(chatId) < 0 && message.message_id && videoObj.file_id) {
        const rawChannelId = String(chatId).replace(/^-100/, "").replace(/^-/, "");
        const candidateExportId = `tg_export_${rawChannelId}_${message.message_id}`;
        await replaceExportFileIdInD1(env, candidateExportId, videoObj.file_id, videoObj.file_unique_id || null);
      }
      return true;
    }

    // Sicherheits-Weiche (Privat-Chat): Nur autorisierte Admins über den Haupt-Bot dürfen globale D1-Medien, Backups oder Untertitel einspeisen!
    const isAdminSender = !env._isCustomBotWebhook && typeof isTelegramBotAdmin === "function"
      ? await isTelegramBotAdmin(env, senderId)
      : false;
    if (!isAdminSender) {
      await sendMessage(
        chatId,
        `🔒 *NUR FÜR ADMINISTRATOREN*\n${SEP}\nDas direkte Einspeisen von Videodateien, JSON-Backups oder Untertiteln in die globale Mediathek ist ausschließlich für autorisierte Administratoren freigeschaltet.`,
        { reply_markup: { inline_keyboard: [buildFooterRow(chatId, true)] } }
      );
      return true;
    }

    // A) Eingehende .json Datei (Telegram Chat-Backup result.json ODER Titelliste) erkennen & mit Auto-Repair + Live-Progress + Custom Playlist verarbeiten
    if (isJsonDoc) {
      const fileSizeBytes = Number(docObj.file_size || 0);
      if (fileSizeBytes > 20 * 1024 * 1024) {
        await sendMessage(
          chatId,
          `⚠️ *DATEI ZU GROSS FÜR TELEGRAM BOT-DOWNLOAD (> 20 MB)*\n${SEP}\n` +
          `Deine Datei \`${escapeMd(docObj.file_name || "result.json")}\` ist *${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB* groß.\n\n` +
          `📌 *Telegram Bot-API Limit:* Bots dürfen über Telegram maximal *20 MB* direkt herunterladen.\n` +
          `🚀 *Lösung für 100.000+ Einträge (bis 500 MB+):*\n` +
          `Öffne die **TelePort Mini-App ▸ 👑 Admin ▸ 📦 Backup-Import (100k+)**. Dort werden Formatfehler automatisch repariert, Duplikate gefiltert und unsichere Treffer im **Korrektur-Tab** angezeigt!`,
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
        const nextQueueMeta = {
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
        };
        if (typeof saveImportQueueMetaInD1 === "function") {
          await saveImportQueueMetaInD1(env, nextQueueMeta);
        } else {
          memoryFallback.set("import_queue_meta", nextQueueMeta);
        }
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
      let lastTarget = memoryFallback.get(`last_ingested_media_${chatId}`);
      if (!lastTarget && typeof getEntityFromD1 === "function") {
        lastTarget = await getEntityFromD1(env, `last_ingested_media_${chatId}`, 3600000).catch(() => null);
      }
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

      const ingestedRef = {
        typeCode: resolved.typeCode,
        tmdbId: resolved.tmdbId,
        season: resolved.season || 1,
        episode: resolved.episode || 1,
        fileId: videoObj.file_id,
        title: resolved.cleanTitle
      };
      memoryFallback.set(`last_ingested_media_${chatId}`, ingestedRef);
      if (typeof saveEntityToD1 === "function") {
        await saveEntityToD1(env, `last_ingested_media_${chatId}`, "last_ingested_media", ingestedRef).catch(() => {});
      }

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

  // --- Bot API 9.3 / 10.5: Interaktives /themen & /topics Verwaltungsmenü ---
  async function showTopicsManagerMenu(env, chatId, editMsgId = null, statusNote = "") {
    const { sendMessage, editMessageText } = tgApi(env);
    const settings = await getUserSettings(env, chatId);
    const deliv = (settings && settings.deliveryConfig && typeof settings.deliveryConfig === "object")
      ? settings.deliveryConfig
      : {};
    const mode = normalizeTopicRoutingMode(deliv.topicRoutingMode);
    const topicMap = sanitizeTopicMap(deliv.topicMap);
    const targetChatKey = (deliv.targetMode === "group" && deliv.targetGroupChatId)
      ? String(deliv.targetGroupChatId).trim()
      : String(chatId).trim();
    const mappedForTarget = topicMap[targetChatKey] || {};
    const mappedEntries = Object.entries(mappedForTarget);

    const modeDescMap = {
      off: "⚪ *Aus / Manuell* (Hauptchat oder manuelle Topic-ID)",
      by_type: "🎬/📺 *Nach Typ* (automatisch `🎬 Filme` & `📺 Serien`)",
      per_series: "📺 *Pro Serie ein Thema* (`🎬 Filme` + eigenes Thema je Serie)"
    };
    const manualTopicLine = deliv.targetTopicId
      ? `📌 *Manuelle Topic-ID:* \`${escapeMd(String(deliv.targetTopicId))}\` (überschreibt Auto-Themen)\n`
      : "";

    let mappedLines = "";
    if (mappedEntries.length > 0) {
      const preview = mappedEntries.slice(0, 8).map(([k, v]) => {
        const label = escapeMd(v?.name || k);
        return `• ${label}  (ID: \`${v?.threadId}\`)`;
      }).join("\n");
      const moreCount = mappedEntries.length > 8 ? `\n_… und ${mappedEntries.length - 8} weitere Themen_` : "";
      mappedLines = `\n📚 *Gespeicherte Auto-Themen (${mappedEntries.length}):*\n${preview}${moreCount}\n`;
    } else {
      mappedLines = `\n📚 *Gespeicherte Auto-Themen:* _Noch keine angelegt (werden beim nächsten Stream oder per Button unten automatisch erstellt)._\n`;
    }

    const msgText =
      `🗂️ *THEMEN-ROUTING (BOT API 9.3–10.5)*\n${SEP}\n` +
      `🎯 *Aktives Ziel:* \`${escapeMd(targetChatKey)}\` (${deliv.targetMode === "group" ? "Ziel-Gruppe" : "Privatchat"})\n` +
      `⚙️ *Modus:* ${modeDescMap[mode]}\n` +
      manualTopicLine +
      mappedLines +
      (statusNote ? `\n${statusNote}\n` : "") +
      `\n💡 _Tipp: Aktiviere im Admin-Panel (Bot API 10.5) „Private-Chat-Topics“ bzw. Forum-Modus in deiner Zielgruppe._`;

    const markup = {
      inline_keyboard: [
        [
          { text: `${mode === "off" ? "✅ " : ""}⚪ Aus`, callback_data: "topm_mode_off", style: mode === "off" ? "primary" : "" },
          { text: `${mode === "by_type" ? "✅ " : ""}🎬/📺 Typ`, callback_data: "topm_mode_by_type", style: mode === "by_type" ? "primary" : "" },
          { text: `${mode === "per_series" ? "✅ " : ""}📺 Pro Serie`, callback_data: "topm_mode_per_series", style: mode === "per_series" ? "primary" : "" }
        ],
        [
          { text: "➕ Standard-Themen anlegen", callback_data: "topm_create_defaults", style: "success" }
        ],
        [
          { text: "🔄 Zuordnung zurücksetzen", callback_data: "topm_reset_map", style: "danger" },
          { text: "✖️ Schließen", callback_data: "close_bot_msg" }
        ]
      ]
    };

    if (editMsgId) {
      const edited = await editMessageText(chatId, editMsgId, msgText, { reply_markup: markup });
      if (edited) return edited;
    }
    return await sendMessage(chatId, msgText, { reply_markup: markup });
  }

  // --- Haupt-Router für Telegram Webhook Updates ---
  async function handleUpdate(env, update) {
    const { sendMessage, sendEphemeralGroupOrPrivateNotice, editMessageText, answerCallbackQuery, deleteMessage, editMessageReplyMarkup, editInlineMessageText, getChatMember } = tgApi(env);
    const activeSessionChatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id || update?.callback_query?.from?.id || null;
    const incomingThreadChatId = update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id ?? null;
    const incomingThreadId = update?.message?.message_thread_id ?? update?.callback_query?.message?.message_thread_id ?? null;
    if (incomingThreadChatId !== null && incomingThreadChatId !== undefined) {
      if (incomingThreadId) {
        setActiveChatThreadId(incomingThreadChatId, incomingThreadId);
      } else {
        clearActiveChatThreadId(incomingThreadChatId);
      }
    }

    try {
      // 0. Inline-Queries (für Gruppen & Kanäle: @BotName Suchbegriff / @BotName f / @BotName s)
      if (update.inline_query) {
        await handleInlineQuery(env, update.inline_query);
        return;
      }

      // 0b. Kanal-Beiträge (channel_post): Opt-in Befehle (/ingest_on/off/status/flush) + High-Volume Staging-Inbox (1 D1-INSERT) + passive tg_export_ Ernte
      if (update.channel_post && !env._isCustomBotWebhook) {
        const chPost = update.channel_post;
        const chId = chPost.chat?.id;
        const handledCmd = await handleAutoIngestCommand(env, chPost, { isChannelPost: true });
        if (handledCmd) return;
        const handledHistCmd = await handleHistoryChatSetupCommand(env, chPost, { isChannelPost: true });
        if (handledHistCmd) return;
        const handledScanCmd = await handleHistoryScanAndJobsCommand(env, chPost, { isChannelPost: true });
        if (handledScanCmd) return;
        const stagedRes = await stageGroupOrChannelMessageIfEnabled(env, chPost);
        // Passive tg_export_ Ernte nur für NICHT aktivierte Kanäle (spart bei 500-Video-Drops 1.000 unnötige D1-UPDATEs!)
        if (!stagedRes?.enabled) {
          const chDocName = String(chPost.document?.file_name || "").trim();
          const chDocMime = String(chPost.document?.mime_type || "").toLowerCase();
          const chIsVideoDoc = Boolean(chPost.document && (/^video\//i.test(chDocMime) || /\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d)$/i.test(chDocName)));
          const chMedia = chPost.video || (chIsVideoDoc ? chPost.document : null);
          if (chId && Number(chId) < 0 && chPost.message_id && chMedia?.file_id) {
            const rawChannelId = String(chId).replace(/^-100/, "").replace(/^-/, "");
            const candidateExportId = `tg_export_${rawChannelId}_${chPost.message_id}`;
            await replaceExportFileIdInD1(env, candidateExportId, chMedia.file_id, chMedia.file_unique_id || null);
          }
        }
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
        const isGroupChat = isGroupOrChannelChat(chatId);

        // Wenn in einer NICHT für Auto-Ingest aktivierten Gruppe auf eine alte Video-Nachricht geantwortet wird (z.B. /id), ernte deren file_id!
        // (In aktivierten Auto-Ingest-Gruppen spart das 2 D1-Writes pro Antwort/Untertitel-Reply!)
        const repliedDoc = message.reply_to_message?.document || null;
        const repliedVideo = message.reply_to_message?.video || (repliedDoc && (/^video\//i.test(repliedDoc.mime_type || "") || /\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d)$/i.test(String(repliedDoc.file_name || ""))) ? repliedDoc : null);
        if (repliedVideo && repliedVideo.file_id && Number(chatId) < 0 && message.reply_to_message?.message_id) {
          const skipExportHarvest = !env._isCustomBotWebhook && await isAutoIngestChatEnabled(env, chatId);
          if (!skipExportHarvest) {
            const rawChannelId = String(chatId).replace(/^-100/, "").replace(/^-/, "");
            const exportKey = `tg_export_${rawChannelId}_${message.reply_to_message.message_id}`;
            await replaceExportFileIdInD1(env, exportKey, repliedVideo.file_id, repliedVideo.file_unique_id || null);
          }
        }

        // Opt-in Befehle (/ingest_on, /ingest_off, /ingest_status, /ingest_flush) für Gruppen & Privat-Chat
        if (await handleAutoIngestCommand(env, message, { isChannelPost: false })) {
          return;
        }
        // History-Index- & Themen-Archiv-Setup-Befehle (/index, /index_add, /index_del, /archiv_set, /archiv_del)
        if (await handleHistoryChatSetupCommand(env, message, { isChannelPost: false })) {
          return;
        }
        // Interaktiver Scan-Start & Job-/Archiv-Steuerung (/scan, /archiv, /jobs, /archiv_status)
        if (await handleHistoryScanAndJobsCommand(env, message, { isChannelPost: false })) {
          return;
        }
        // Forward-Gate im Admin-Privat-Chat VOR dem Video-Upload (fängt weitergeleitete Kanal-Videos im Setup-Modus sicher ab!)
        if (!isGroupChat && await handleHistoryChatForwardInput(env, message)) {
          return;
        }

        // Prüfe zuerst auf eingehende Videodateien, Untertitel oder .json-Titeldateien
        if (message.video || message.document) {
          const handledMedia = await handleIncomingMediaOrJson(env, message);
          if (handledMedia) return;
        }

        const text = (message.text || "").trim();

        // GRUPPEN-SCHUTZ & ZERO-WASTE FAST-EXIT (essentiell bei deaktiviertem Privacy Mode!):
        // In Gruppen nur Slash-Befehle oder direkte Antworten auf Bot-Prompts weiterverarbeiten;
        // reguläre Gruppen-Nachrichten, Poster, Smalltalk, Sticker & Join-Events erzeugen 0 Session-/Prompt-D1-Calls & 0 Gruppen-Spam!
        if (isGroupChat) {
          const rawGroupText = String(message.text || message.caption || "").trim();
          const isSlashCmd = /^\/[a-z0-9_]+(?:@\w+)?(?:\s|$)/i.test(rawGroupText);
          if (!isSlashCmd) {
            if (!env._isCustomBotWebhook && (message.photo || rawGroupText.length >= 4)) {
              await stageGroupOrChannelMessageIfEnabled(env, message);
            }
            // Nur durchlassen, wenn jemand direkt auf eine Bot-Prompt-Nachricht antwortet
            if (!text || !message.reply_to_message?.from?.is_bot) {
              return;
            }
          }
        }

        // /id oder /chatid Befehl: Zeigt sofort Chat-ID, Topic/Thread-ID (inkl. Private-Chat-Topics Bot API 9.3/10.5) & Quellgruppen-ID
        if (/^\/(?:id|chatid|groupid)(?:@\w+)?$/i.test(text)) {
          const threadId = parseValidTelegramThreadId(message.message_thread_id);
          const isPrivateTopic = Boolean(threadId && message.chat?.type === "private");
          const rawChannelNum = String(chatId).replace(/^-100/, "").replace(/^-/, "");
          const topicLabel = isPrivateTopic
            ? `🧵 *Private-Chat-Topic ID (Bot API 9.3/10.5):* \`${threadId}\`\n✅ *Thread-Routing:* Antworten & Medien bleiben automatisch in diesem Topic.\n`
            : (threadId ? `🧵 *Forum-Topic / Thread-ID:* \`${threadId}\`\n✅ *Thread-Routing:* Antworten & Medien bleiben automatisch in diesem Topic.\n` : "");
          const idInfoText =
            `🆔 *TELEGRAM CHAT- & TOPIC-ID DIAGNOSE*\n${SEP}\n` +
            `💬 *Chat-Name:* \`${escapeMd(message.chat.title || message.chat.first_name || "Privat-Chat")}\`\n` +
            `📌 *Ziel- / Gruppen Chat-ID:* \`${chatId}\`\n` +
            topicLabel +
            (Number(chatId) < 0 ? `📦 *result.json Channel-ID:* \`${rawChannelNum}\` (Bridge: \`${chatId}\`)\n` : "") +
            (repliedVideo?.file_id ? `🎞️ *Geerntete Video File-ID (in D1 gespeichert!):*\n\`${repliedVideo.file_id}\`\n` : "") +
            `\n💡 *Tipp:* Kopiere \`${chatId}\`${threadId ? ` (Topic: \`${threadId}\`)` : ""} und füge sie in der **Mini-App ▸ Film-Modal oder ⚙️ Einstellungen** unter **👥 Eigene Ziel-Gruppe** oder **📦 Quellgruppe** ein!`;
          await sendMessage(chatId, idInfoText, threadId ? { message_thread_id: threadId } : {});
          return;
        }

        // /themen oder /topics Befehl: Interaktives Themen-Routing-Menü (Bot API 9.3–10.5)
        if (/^\/(?:themen|topics)(?:@\w+)?$/i.test(text)) {
          await showTopicsManagerMenu(env, chatId, null);
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

        // GEHEIMES ADMIN-PANEL: /stats xyz (nur für autorisierte Admins über den Haupt-Bot)
        if (text.toLowerCase() === ADMIN_SECRET_COMMAND) {
          await deleteMessage(chatId, message.message_id);
          const canOpenAdmin = !env._isCustomBotWebhook && typeof isTelegramBotAdmin === "function"
            ? await isTelegramBotAdmin(env, message.from?.id || chatId)
            : false;
          if (!canOpenAdmin) {
            await sendEphemeralGroupOrPrivateNotice(chatId, message.from?.id, `🔒 *Zugriff verweigert:* Das Admin-Panel ist nur für autorisierte Administratoren freigeschaltet.`);
            return;
          }
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

        // 6-stelliger Web-/Smart-TV-Login-Code direkt im privaten Haupt-Bot-Chat eingegeben (z.B. "482915" oder "482 915")
        const sixDigitMatch = (!env._isCustomBotWebhook && !isGroupOrChannelChat(chatId))
          ? text.trim().match(/^(\d{3})\s*(\d{3})$/)
          : null;
        if (sixDigitMatch) {
          const cleanCode = `${sixDigitMatch[1]}${sixDigitMatch[2]}`;
          const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
          let mappedChallengeId = null;
          if (hasD1 && typeof getEntityFromD1 === "function") {
            const d1CodeObj = await getEntityFromD1(env, `webauth_code_${cleanCode}`, 360000, { bypassMemoryCache: true }).catch(() => null);
            if (d1CodeObj) mappedChallengeId = typeof d1CodeObj === "string" ? d1CodeObj : d1CodeObj.challengeId;
          }
          if (!mappedChallengeId) {
            mappedChallengeId = await kvCachedGetRaw(env, `webauth_code_${cleanCode}`, "MOVIE_SAVED", { bypassMemoryCache: true }).catch(() => null);
          }
          if (!mappedChallengeId) {
            mappedChallengeId = memoryFallback.get(`webauth_code_${cleanCode}`);
          }
          if (mappedChallengeId) {
            const cId = String(mappedChallengeId).replace(/^"|"$/g, "").trim();
            let challengeObj = null;
            if (hasD1 && typeof getEntityFromD1 === "function") {
              challengeObj = await getEntityFromD1(env, `webauth_id_${cId}`, 360000, { bypassMemoryCache: true }).catch(() => null);
            }
            if (!challengeObj) {
              const raw = await kvCachedGetRaw(env, `webauth_id_${cId}`, "MOVIE_SAVED", { bypassMemoryCache: true }).catch(() => null);
              if (raw) { try { challengeObj = JSON.parse(raw); } catch (e) {} }
            }
            if (!challengeObj) {
              challengeObj = memoryFallback.get(`webauth_id_${cId}`);
            }
            if (challengeObj && challengeObj.status === "pending" && Date.now() <= Number(challengeObj.expiresAt || 0)) {
              challengeObj.status = "confirmed";
              challengeObj.user = {
                id: Number(message.from?.id || chatId),
                first_name: String(message.from?.first_name || message.from?.username || "Filmfreund"),
                last_name: String(message.from?.last_name || ""),
                username: String(message.from?.username || "")
              };
              memoryFallback.set(`webauth_id_${cId}`, challengeObj);
              memoryFallback.delete(`webauth_code_${cleanCode}`);
              try {
                if (hasD1 && typeof saveEntityToD1 === "function") {
                  await saveEntityToD1(env, `webauth_id_${cId}`, "webauth", challengeObj);
                  if (typeof deleteEntityFromD1 === "function") {
                    await deleteEntityFromD1(env, `webauth_code_${cleanCode}`).catch(() => {});
                  }
                } else {
                  await kvStageWrite(env, `webauth_id_${cId}`, challengeObj, { bindingName: "MOVIE_SAVED", expirationTtl: 300, periodicOnly: false, flushNow: true });
                  await kvStageDelete(env, `webauth_code_${cleanCode}`, "MOVIE_SAVED").catch(() => {});
                }
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
          const isPrivateTopicRootMsg = Boolean(
            message.chat?.type === "private" &&
            message.message_thread_id &&
            Number(message.message_id) === Number(message.message_thread_id)
          );
          if (!isPrivateTopicRootMsg) {
            await deleteMessage(chatId, message.message_id);
          }

          if (startParam.startsWith("webauth_")) {
            if (env._isCustomBotWebhook || isGroupOrChannelChat(chatId)) {
              await sendEphemeralGroupOrPrivateNotice(chatId, message.from?.id, `🔒 *Web-Login-Bestätigung ist nur im privaten Chat mit dem Haupt-Bot möglich.*`);
              return;
            }
            const cId = startParam.replace(/^webauth_/i, "").trim();
            const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
            let challengeObj = null;
            if (hasD1 && typeof getEntityFromD1 === "function") {
              challengeObj = await getEntityFromD1(env, `webauth_id_${cId}`, 360000, { bypassMemoryCache: true }).catch(() => null);
            }
            if (!challengeObj) {
              const raw = await kvCachedGetRaw(env, `webauth_id_${cId}`, "MOVIE_SAVED", { bypassMemoryCache: true }).catch(() => null);
              if (raw) { try { challengeObj = JSON.parse(raw); } catch (e) {} }
            }
            if (!challengeObj) {
              challengeObj = memoryFallback.get(`webauth_id_${cId}`);
            }
            if (challengeObj && challengeObj.status === "pending" && Date.now() <= Number(challengeObj.expiresAt || 0)) {
              challengeObj.status = "confirmed";
              challengeObj.user = {
                id: Number(message.from?.id || chatId),
                first_name: String(message.from?.first_name || message.from?.username || "Filmfreund"),
                last_name: String(message.from?.last_name || ""),
                username: String(message.from?.username || "")
              };
              memoryFallback.set(`webauth_id_${cId}`, challengeObj);
              if (challengeObj.code) memoryFallback.delete(`webauth_code_${challengeObj.code}`);
              try {
                if (hasD1 && typeof saveEntityToD1 === "function") {
                  await saveEntityToD1(env, `webauth_id_${cId}`, "webauth", challengeObj);
                  if (challengeObj.code && typeof deleteEntityFromD1 === "function") {
                    await deleteEntityFromD1(env, `webauth_code_${challengeObj.code}`).catch(() => {});
                  }
                } else {
                  await kvStageWrite(env, `webauth_id_${cId}`, challengeObj, { bindingName: "MOVIE_SAVED", expirationTtl: 300, periodicOnly: false, flushNow: true });
                  if (challengeObj.code) {
                    await kvStageDelete(env, `webauth_code_${challengeObj.code}`, "MOVIE_SAVED").catch(() => {});
                  }
                }
              } catch (e) {}
              await sendMessage(chatId, `✅ *Web- & Smart-TV-Login erfolgreich bestätigt!*\nDu bist jetzt in deiner Mediathek Mini-App angemeldet und kannst zum Browser / Smart-TV zurückkehren.`);
            } else {
              await sendMessage(chatId, `⌛ *Dieser Login-Link wurde bereits verwendet oder ist abgelaufen.*\nBitte fordere im Login-Fenster der Mini-App einen neuen Code an.`);
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
            const canOpenAdmin = !env._isCustomBotWebhook && typeof isTelegramBotAdmin === "function"
              ? await isTelegramBotAdmin(env, message.from?.id || chatId)
              : false;
            if (!canOpenAdmin) {
              await sendEphemeralGroupOrPrivateNotice(chatId, message.from?.id, `🔒 *Zugriff verweigert:* Das Admin-Panel ist nur für autorisierte Administratoren freigeschaltet.`);
              return;
            }
            await showAdminStatsPanel(env, chatId);
            return;
          }

          if (startParam.startsWith("search_")) {
            const rawQ = decodeURIComponent(startParam.replace("search_", "")).trim();
            if (rawQ) {
              await saveSearchState(env, chatId, rawQ, 1, 0, 0, 0, "pop_desc", false);
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
                await showSeriesEpisodes(env, chatId, itemObj.seriesId, itemObj.seasonNumber != null ? Number(itemObj.seasonNumber) : 1, "all", 1, null);
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
            await saveSearchState(env, chatId, queryText, 1, 0, 0, 0, "pop_desc", false);
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

        // Freitext als Direktsuche behandeln – NUR im Privat-Chat & nur bei echtem Text (niemals in Gruppen oder bei Stickern/Join-Events!)
        if (!isGroupOrChannelChat(chatId) && text.length > 0 && !text.startsWith("/")) {
          await deleteMessage(chatId, message.message_id);
          await clearAllTempMessages(env, chatId, deleteMessage);
          const cleanQuery = text.slice(0, 150);
          trackStat("searchQueries", cleanQuery);
          await saveSearchState(env, chatId, cleanQuery, 1, 0, 0, 0, "pop_desc", false);
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

        // ======================================================================
        // BOT API 10.0 / 10.4: EPHEMERAL GRUPPEN- & GUEST-MODE-CALLBACKS
        // Funktionieren in Gruppen, Kanälen, inline_message_id & im Guest-Mode
        // für JEDEN Klicker privat über answerCallbackQuery – 0 Gruppen-Spam!
        // ======================================================================
        const iqSaveMatch = data.match(/^iq_save_([ms])_(\d+)$/i);
        if (iqSaveMatch) {
          const saveType = iqSaveMatch[1].toLowerCase();
          const saveId = iqSaveMatch[2];
          const personalUserId = cq.from?.id || chatId;
          if (!personalUserId) {
            await answerCallbackQuery(cq.id, "⚠️ Benutzer-ID nicht verfügbar.", true);
            return;
          }
          const details = saveType === "s"
            ? await fetchSeriesDetails(env, saveId)
            : await fetchMovieDetails(env, saveId);
          if (!details) {
            await answerCallbackQuery(cq.id, "⚠️ Titel konnte gerade nicht geladen werden.", true);
            return;
          }
          const cleanTitle = String(details.title || details.name || `Titel #${saveId}`).replace(/\s*\(\d{4}\)$/, "").trim();
          const saveRes = await saveItemToList(env, personalUserId, {
            title: cleanTitle,
            tmdbId: Number(saveId),
            contentType: saveType === "s" ? "series" : "movie",
            releaseDate: details.releaseDate || "",
            vote_average: details.vote_average || 0,
            poster_path: details.poster_path || "",
            genres: details.genres || "",
            fsk: details.fsk || "",
            overview: details.overview || ""
          });
          if (saveRes?.saved) {
            await answerCallbackQuery(cq.id, `✅ "${cleanTitle}" auf deiner persönlichen Merkliste gespeichert!`, false);
          } else {
            await answerCallbackQuery(cq.id, `🔖 "${cleanTitle}" ist bereits auf deiner Merkliste.`, false);
          }
          return;
        }

        const iqInfoMatch = data.match(/^iq_info_([ms])_(\d+)$/i);
        if (iqInfoMatch) {
          const infoType = iqInfoMatch[1].toLowerCase();
          const infoId = iqInfoMatch[2];
          const details = infoType === "s"
            ? await fetchSeriesDetails(env, infoId)
            : await fetchMovieDetails(env, infoId);
          if (!details) {
            await answerCallbackQuery(cq.id, "⚠️ Kurzinfo aktuell nicht verfügbar.", true);
            return;
          }
          const cleanTitle = String(details.title || details.name || `Titel #${infoId}`).replace(/\s*\(\d{4}\)$/, "").trim();
          const yearStr = details.releaseDate && details.releaseDate !== "Keine Angabe"
            ? ` (${String(details.releaseDate).split("-")[0]})`
            : "";
          const ratingStr = details.vote_average ? `⭐ ${Math.round(details.vote_average * 10) / 10}/10` : "⭐ k.A.";
          const rawFsk = String(details.fsk || "").trim();
          const fskStr = rawFsk && rawFsk !== "Keine Angabe"
            ? ` • ${/^fsk\b/i.test(rawFsk) ? rawFsk : `FSK ${rawFsk}`}`
            : "";
          const genreStr = details.genres ? `\n🎭 ${String(details.genres).slice(0, 48)}` : "";
          const header = `${infoType === "s" ? "📺" : "🎬"} ${cleanTitle}${yearStr}\n${ratingStr}${fskStr}${genreStr}`;
          const maxOverviewLen = Math.max(0, 194 - header.length);
          const rawOverview = String(details.overview || "").replace(/\s+/g, " ").trim();
          const shortOverview = (rawOverview && maxOverviewLen > 20)
            ? `\n${rawOverview.length > maxOverviewLen ? rawOverview.slice(0, maxOverviewLen - 1) + "…" : rawOverview}`
            : "";
          await answerCallbackQuery(cq.id, `${header}${shortOverview}`, true);
          return;
        }

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
        // (Guest-Safe/Ephemeral-Aktionen wie iq_save / iq_info wurden oben bereits verarbeitet.)
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
          await answerCallbackQuery(
            cq.id,
            inlineMsgId
              ? "ℹ️ Für weitere Optionen öffne den Titel über 'Im Bot öffnen' oder 'Mini-App'."
              : "",
            false
          );
          return;
        }

        // @ANCHOR: CALLBACK_ROUTER
        if (data === "wl_noop" || data === "noop") {
          await answerCallbackQuery(cq.id);
          return;
        }

        // --- AUTO-INGEST QUELLEN-MANAGER CALLBACKS (/ingest_status & Live-Archiv) ---
        if (
          data === "ingst_refresh" ||
          data === "ingst_flush_all" ||
          data.startsWith("ingst_on_") ||
          data.startsWith("ingst_off_") ||
          data.startsWith("ingst_arch_on_") ||
          data.startsWith("ingst_arch_off_")
        ) {
          const isAdminClick = !env._isCustomBotWebhook && cq.from?.id && await isTelegramBotAdmin(env, cq.from.id);
          if (!isAdminClick) {
            await answerCallbackQuery(cq.id, "🔒 Nur für Bot-Administratoren.", true);
            return;
          }
          if (data === "ingst_flush_all") {
            await answerCallbackQuery(cq.id, "⚡ Verarbeite wartende Inbox-Posts...");
            const fl = await runScheduledChannelIngestFlush(env, { source: "callback_flush", forceFlush: true, maxResolvePerRun: 6 });
            const note = `⚡ *Flush:* \`${fl.processedVideos}\` Video(s) · \`${fl.added}\` neu · \`${fl.upgraded}\` Upgrade · \`${fl.review}\` Review` +
              (fl.remainingPending > 0 ? ` · _${fl.remainingPending} noch wartend_` : "");
            await renderAutoIngestStatusMenu(env, chatId, msgId, note);
            return;
          }
          if (data === "ingst_refresh") {
            await answerCallbackQuery(cq.id, "🔄 Aktualisiert");
            await renderAutoIngestStatusMenu(env, chatId, msgId);
            return;
          }
          if (data.startsWith("ingst_arch_on_") || data.startsWith("ingst_arch_off_")) {
            const enableArch = data.startsWith("ingst_arch_on_");
            const targetCid = data.replace(/^ingst_arch_(?:on|off)_/, "");
            if (enableArch) {
              if (await isHistorySystemBlockedChat(env, targetCid)) {
                await answerCallbackQuery(cq.id, "⛔ Chat ist als Index-Kanal/Archiv gesperrt.", true);
                return;
              }
              const forums = await getHistoryIndexChannelsFromD1(env, { role: "archive_forum", onlyEnabled: true });
              if (forums.length === 0) {
                await answerCallbackQuery(cq.id, "ℹ️ Bitte zuerst mit /archiv_set ein Themen-Archiv einrichten.", true);
                return;
              }
            }
            const res = await setAutoIngestChatEnabled(env, targetCid, { archiveMirrorEnabled: enableArch, activatedBy: String(cq.from.id) });
            await answerCallbackQuery(cq.id, res.ok ? (enableArch ? "🗂️ Live-Archiv: AN" : "⚪ Live-Archiv: AUS") : "⚠️ Fehler");
            await renderAutoIngestStatusMenu(env, chatId, msgId);
            return;
          }
          const enableNext = data.startsWith("ingst_on_");
          const targetCid = data.replace(/^ingst_(?:on|off)_/, "");
          if (enableNext && await isHistorySystemBlockedChat(env, targetCid)) {
            await answerCallbackQuery(cq.id, "⛔ Index-Kanal/Archiv darf nicht als Quelle laufen.", true);
            return;
          }
          const res = await setAutoIngestChatEnabled(env, targetCid, { enabled: enableNext, activatedBy: String(cq.from.id) });
          await answerCallbackQuery(cq.id, res.ok ? (enableNext ? "🟢 Quelle aktiviert" : "⏸️ Quelle pausiert") : "⚠️ Fehler");
          await renderAutoIngestStatusMenu(env, chatId, msgId);
          return;
        }

        // --- HISTORY INDEX-KANÄLE & THEMEN-ARCHIV CHAT-SETUP CALLBACKS (`hc:cfg_*`) ---
        if (data.startsWith("hc:cfg_")) {
          const isAdminClick = !env._isCustomBotWebhook && cq.from?.id && await isTelegramBotAdmin(env, cq.from.id);
          if (!isAdminClick) {
            await answerCallbackQuery(cq.id, "🔒 Nur für Bot-Administratoren.", true);
            return;
          }
          const adminId = String(cq.from.id);
          if (data === "hc:cfg_ref") {
            await answerCallbackQuery(cq.id, "🔄 Aktualisiert");
            await renderHistoryConfigChatMenu(env, chatId, msgId);
            return;
          }
          if (data === "hc:cfg_fidx" || data === "hc:cfg_farch") {
            const nextRole = data === "hc:cfg_farch" ? "archive_forum" : "probe_index";
            await saveHistoryChatAdminState(env, adminId, {
              awaitingForwardRole: nextRole,
              awaitingForwardExpiresAt: Date.now() + HISTORY_CHAT_FORWARD_TTL_MS
            });
            await answerCallbackQuery(cq.id, "📨 Weiterleitungs-Modus aktiv");
            await renderHistoryConfigChatMenu(env, chatId, msgId);
            return;
          }
          if (data === "hc:cfg_fcancel") {
            await saveHistoryChatAdminState(env, adminId, { awaitingForwardRole: "", awaitingForwardExpiresAt: 0 });
            await answerCallbackQuery(cq.id, "❌ Abgebrochen");
            await renderHistoryConfigChatMenu(env, chatId, msgId);
            return;
          }
          if (data.startsWith("hc:cfg_rm:")) {
            const idx = parseInt(data.slice("hc:cfg_rm:".length), 10);
            const rmRes = await removeHistoryProbeIndexChannelFromChat(env, idx);
            await answerCallbackQuery(cq.id, rmRes.ok ? "🗑️ Index-Kanal aktualisiert" : "⚠️ Nicht gefunden");
            const note = rmRes.ok
              ? (rmRes.hadPendingDeletes
                  ? `⏸️ *Index-Kanal deaktiviert:* *${escapeMd(rmRes.removedTitle)}* (noch offene Rest-Probes).`
                  : `🗑️ *Index-Kanal entfernt:* *${escapeMd(rmRes.removedTitle)}*.`)
              : `⚠️ ${escapeMd(rmRes.error || "Fehler beim Entfernen.")}`;
            await renderHistoryConfigChatMenu(env, chatId, msgId, note);
            return;
          }
          if (data === "hc:cfg_rmarch") {
            const rmRes = await removeHistoryArchiveForumFromChat(env);
            await answerCallbackQuery(cq.id, rmRes.ok ? "🗑️ Themen-Archiv gelöst" : "⚠️ Fehler");
            await renderHistoryConfigChatMenu(
              env,
              chatId,
              msgId,
              rmRes.ok ? `🗑️ *Themen-Archiv gelöst:* *${escapeMd(rmRes.removedTitle)}*.` : `⚠️ ${escapeMd(rmRes.error || "Fehler.")}`
            );
            return;
          }
          if (data === "hc:cfg_mode" || data === "hc:cfg_time" || data === "hc:cfg_pin" || data === "hc:cfg_notify" || data === "hc:cfg_dir") {
            const [channels, curDef] = await Promise.all([
              getHistoryIndexChannelsFromD1(env),
              getHistoryArchiveDefaultsFromD1(env)
            ]);
            const nextDef = { ...curDef };
            if (data === "hc:cfg_mode") {
              const order = ["type_genre", "per_series_plus_genre", "compact_type"];
              nextDef.topicMode = order[(order.indexOf(curDef.topicMode) + 1) % order.length];
            } else if (data === "hc:cfg_time") {
              nextDef.timing = curDef.timing === "after_scan" ? "live" : "after_scan";
            } else if (data === "hc:cfg_pin") {
              nextDef.pinSeriesCard = !curDef.pinSeriesCard;
            } else if (data === "hc:cfg_notify") {
              nextDef.notifyAdminDm = !(curDef.notifyAdminDm !== false);
            } else if (data === "hc:cfg_dir") {
              nextDef.autoUpdateAzIndex = !(curDef.autoUpdateAzIndex !== false);
            }
            const probes = channels.filter(c => c.role === "probe_index").map(c => ({ channelId: c.channelId, label: c.label, enabled: c.enabled }));
            const arch = channels.find(c => c.role === "archive_forum") || null;
            await saveHistoryIndexChannelsInD1(env, {
              probeChannels: probes,
              archiveForum: arch ? { channelId: arch.channelId, label: arch.label, enabled: arch.enabled } : null,
              archiveDefaults: nextDef
            });
            await answerCallbackQuery(
              cq.id,
              data === "hc:cfg_notify"
                ? (nextDef.notifyAdminDm ? "🔔 Lautlose Admin-Hinweise aktiviert" : "🔕 Admin-Hinweise deaktiviert")
                : (data === "hc:cfg_dir"
                    ? (nextDef.autoUpdateAzIndex ? "📑 Auto-Inhaltsverzeichnis aktiviert" : "📑 Auto-Inhaltsverzeichnis deaktiviert")
                    : "✅ Archiv-Standard gespeichert")
            );
            await renderHistoryConfigChatMenu(env, chatId, msgId);
            return;
          }
          if (data === "hc:cfg_delp") {
            await answerCallbackQuery(cq.id, "🧹 Lösche Rest-Probes...");
            const flRes = await flushPendingHistoryProbeDeletes(env, { subrequestCeiling: 36 });
            await renderHistoryConfigChatMenu(
              env,
              chatId,
              msgId,
              `🧹 *Rest-Probes bereinigt:* \`${Number(flRes.deleted || 0)}\` gelöscht` + (Number(flRes.remaining || 0) > 0 ? ` · \`${flRes.remaining}\` noch offen.` : ".")
            );
            return;
          }
          if (data === "hc:cfg_val") {
            await answerCallbackQuery(cq.id, "🩺 Prüfe Telegram-Rechte...");
            const channels = await getHistoryIndexChannelsFromD1(env);
            const probes = channels.filter(c => c.role === "probe_index");
            const arch = channels.find(c => c.role === "archive_forum") || null;
            const summaryLines = [];
            for (const p of probes) {
              const res = await validateHistoryChannelAccess(env, p.channelId, "probe_index");
              await updateHistoryIndexChannelVerificationInD1(env, p.channelId, {
                verifiedAt: Date.now(),
                caps: res.ok
                  ? { ok: true, title: res.title, chatType: res.chatType, checks: res.checks }
                  : { ok: false, error: res.error || "", warnings: res.warnings || [], checks: res.checks || [] },
                label: res.title || p.label
              });
              summaryLines.push(`${res.ok ? "✅" : "⛔"} *${escapeMd(res.title || p.label || p.channelId)}*${res.ok ? "" : ` — ${escapeMd(res.error || "Rechte fehlen")}`}`);
            }
            if (arch) {
              const res = await validateHistoryChannelAccess(env, arch.channelId, "archive_forum");
              await updateHistoryIndexChannelVerificationInD1(env, arch.channelId, {
                verifiedAt: Date.now(),
                caps: { ok: res.ok, title: res.title, isForum: res.isForum, checks: res.checks, warnings: res.warnings },
                label: res.title || arch.label
              });
              summaryLines.push(`${res.ok ? "✅" : "⛔"} *Archiv ${escapeMd(res.title || arch.label || arch.channelId)}*${res.ok ? "" : ` — ${escapeMd(res.error || "Forum/Rechte fehlen")}`}`);
            }
            const note = summaryLines.length > 0
              ? `🩺 *Rechteprüfung abgeschlossen:*\n${summaryLines.join("\n")}`
              : "ℹ️ Noch keine Kanäle zum Prüfen eingetragen.";
            await renderHistoryConfigChatMenu(env, chatId, msgId, note);
            return;
          }
        }

        // --- HISTORY SCAN-ENTWURF & JOBS-/ARCHIV-ZENTRALE CALLBACKS (`hc:*`) ---
        if (data.startsWith("hc:")) {
          const isAdminClick = !env._isCustomBotWebhook && cq.from?.id && await isTelegramBotAdmin(env, cq.from.id);
          if (!isAdminClick) {
            await answerCallbackQuery(cq.id, "🔒 Nur für Bot-Administratoren.", true);
            return;
          }
          const adminId = String(cq.from.id);

          if (data === "hc:jobs") {
            await answerCallbackQuery(cq.id, "📋 Jobs aktualisiert");
            await renderHistoryJobsAndArchiveMenu(env, chatId, msgId);
            return;
          }

          if (data === "hc:d_cancel") {
            await saveHistoryChatAdminState(env, adminId, {
              draft: null,
              awaitingForwardRole: "",
              awaitingForwardExpiresAt: 0,
              awaitingScanPreferArchive: false
            });
            await answerCallbackQuery(cq.id, "❌ Abgebrochen");
            await tgApi(env).editMessageText(chatId, msgId, "❌ *Scan-Vorgang abgebrochen.*", {
              reply_markup: { inline_keyboard: [[{ text: "📋 Jobs & Archiv", callback_data: "hc:jobs" }, { text: "✖️ Schließen", callback_data: "close_bot_msg" }]] }
            }).catch(() => {});
            return;
          }

          if (data.startsWith("hc:d_")) {
            const st = await getHistoryChatAdminState(env, adminId);
            const curDraft = st?.draft || null;
            if (!curDraft || !curDraft.sourceChatId) {
              await answerCallbackQuery(cq.id, "ℹ️ Entwurf abgelaufen — bitte /scan neu senden.", true);
              await renderHistoryScanDraftMenu(env, chatId, msgId);
              return;
            }
            let nextDraft = { ...curDraft };
            let toast = "✅ Aktualisiert";
            if (data.startsWith("hc:d_r:")) {
              const preset = data.slice("hc:d_r:".length);
              nextDraft = applyHistoryDraftRangePreset(nextDraft, preset);
              toast = preset === "all" ? "🔢 Bereich: Komplett ab #1" : `🔢 Bereich: Letzte ${preset}`;
            } else if (data === "hc:d_dir") {
              nextDraft.direction = curDraft.direction === "desc" ? "asc" : "desc";
              toast = nextDraft.direction === "desc" ? "⬇️ Neueste zuerst" : "⬆️ Älteste zuerst";
            } else if (data === "hc:d_arch") {
              const activeForum = (await getHistoryIndexChannelsFromD1(env, { role: "archive_forum", onlyEnabled: true }))[0] || null;
              if (!activeForum) {
                await answerCallbackQuery(cq.id, "ℹ️ Bitte zuerst ein Themen-Archiv mit /archiv_set einrichten.", true);
                return;
              }
              nextDraft.enableArchiveMirror = !curDraft.enableArchiveMirror;
              toast = nextDraft.enableArchiveMirror ? "🗂️ Themen-Archiv: AN" : "🗂️ Themen-Archiv: AUS";
            } else if (data === "hc:d_time") {
              nextDraft.archiveTiming = curDraft.archiveTiming === "after_scan" ? "live" : "after_scan";
              toast = nextDraft.archiveTiming === "after_scan" ? "🕒 Nach Scan-Ende" : "🕒 Live spiegeln";
            } else if (data === "hc:d_mode") {
              const order = ["type_genre", "per_series_plus_genre", "compact_type"];
              nextDraft.archiveTopicMode = order[(order.indexOf(curDraft.archiveTopicMode) + 1) % order.length];
              toast = `📁 ${formatArchiveModeShortLabel(nextDraft.archiveTopicMode)}`;
            } else if (data === "hc:d_pin") {
              nextDraft.archivePinSeriesCard = !curDraft.archivePinSeriesCard;
              toast = nextDraft.archivePinSeriesCard ? "📌 Serien-Karte: AN" : "📌 Serien-Karte: AUS";
            } else if (data === "hc:d_react") {
              nextDraft.enableReactions = !curDraft.enableReactions;
              toast = nextDraft.enableReactions ? "👍 Reaktionen: AN" : "👍 Reaktionen: AUS";
            } else if (data === "hc:d_cron") {
              nextDraft.cronEnabled = !curDraft.cronEnabled;
              toast = nextDraft.cronEnabled ? "⏱️ 2-Min-Cron: AN" : "🔕 2-Min-Cron: AUS";
            }
            await saveHistoryChatAdminState(env, adminId, { draft: nextDraft });
            await answerCallbackQuery(cq.id, toast);
            await renderHistoryScanDraftMenu(env, chatId, msgId);
            return;
          }

          if (data === "hc:probe") {
            const st = await getHistoryChatAdminState(env, adminId);
            const curDraft = st?.draft || null;
            if (!curDraft || !curDraft.sourceChatId) {
              await answerCallbackQuery(cq.id, "ℹ️ Entwurf abgelaufen.", true);
              return;
            }
            const enabledProbes = await getHistoryIndexChannelsFromD1(env, { role: "probe_index", onlyEnabled: true });
            if (enabledProbes.length === 0) {
              await answerCallbackQuery(cq.id, "⛔ Kein aktiver Index-Kanal vorhanden.", true);
              return;
            }
            await answerCallbackQuery(cq.id, `🔎 Teste ID #${curDraft.endMsgId}...`);
            const testRes = await validateHistoryChannelAccess(env, curDraft.sourceChatId, "source", {
              testMessageId: Number(curDraft.endMsgId || 0),
              probeIndexChannelId: enabledProbes[0].channelId
            });
            const tp = testRes?.testProbe || null;
            let probeNote = "";
            if (tp && tp.ok) {
              probeNote = `✅ *1-ID-Testprobe (#${formatDeInt(curDraft.endMsgId)}) erfolgreich!*\n   Typ: \`${escapeMd(tp.kind || "nachricht")}\`${tp.deleted ? " · 🧹 Probe sauber gelöscht" : ""}`;
            } else if (testRes?.ok) {
              probeNote = `⚠️ *Quelle erreichbar, aber ID #${formatDeInt(curDraft.endMsgId)}:* ${escapeMd(tp?.error || "Nachricht nicht vorhanden / gelöscht")}`;
            } else {
              probeNote = `⛔ *Testprobe fehlgeschlagen:*\n${formatValidationChecksMarkdown(testRes)}`;
            }
            await renderHistoryScanDraftMenu(env, chatId, msgId, probeNote);
            return;
          }

          if (data === "hc:go") {
            const st = await getHistoryChatAdminState(env, adminId);
            const curDraft = st?.draft || null;
            if (!curDraft || !curDraft.sourceChatId) {
              await answerCallbackQuery(cq.id, "ℹ️ Entwurf abgelaufen — bitte /scan neu senden.", true);
              await renderHistoryScanDraftMenu(env, chatId, msgId);
              return;
            }
            if (await isHistorySystemBlockedChat(env, curDraft.sourceChatId)) {
              await answerCallbackQuery(cq.id, "⛔ Chat ist als Index-Kanal/Archiv gesperrt.", true);
              return;
            }
            const enabledProbes = await getHistoryIndexChannelsFromD1(env, { role: "probe_index", onlyEnabled: true });
            if (enabledProbes.length === 0) {
              await answerCallbackQuery(cq.id, "⛔ Bitte zuerst mindestens 1 Index-Kanal einrichten (/index_add).", true);
              return;
            }
            const activeForum = (await getHistoryIndexChannelsFromD1(env, { role: "archive_forum", onlyEnabled: true }))[0] || null;
            const createRes = await createHistoryCrawlJobInD1(env, {
              sourceChatId: curDraft.sourceChatId,
              sourceTitle: curDraft.sourceTitle,
              startMsgId: curDraft.startMsgId,
              endMsgId: curDraft.endMsgId,
              direction: curDraft.direction,
              enableReactions: curDraft.enableReactions,
              enableArchiveMirror: Boolean(curDraft.enableArchiveMirror && activeForum),
              archiveTopicMode: curDraft.archiveTopicMode,
              archiveTiming: curDraft.archiveTiming,
              archivePinSeriesCard: curDraft.archivePinSeriesCard,
              archiveMaxSeriesTopics: curDraft.archiveMaxSeriesTopics,
              cronEnabled: curDraft.cronEnabled,
              createdByAdminId: adminId
            });
            if (!createRes.ok || !createRes.job) {
              await answerCallbackQuery(cq.id, "⚠️ Job konnte nicht gestartet werden.", true);
              await renderHistoryScanDraftMenu(env, chatId, msgId, `⚠️ ${escapeMd(createRes.error || "Fehler beim Anlegen des Jobs.")}`);
              return;
            }
            await saveHistoryChatAdminState(env, adminId, { draft: null });
            const j = createRes.job;
            await answerCallbackQuery(cq.id, `🚀 Job #${j.id} gestartet!`);
            const startNote = j.status === "queued"
              ? `🕒 *Job #${j.id} in Warteschlange eingereiht* (startet automatisch, sobald der aktuelle Job fertig ist).`
              : `🚀 *Job #${j.id} gestartet!* Der 2-Minuten-Cron verarbeitet ihn automatisch — oder tippe unten auf *⚡ 1 Scan-Schritt*.`;
            await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, { selectedJobId: j.id, note: startNote });
            return;
          }

          if (data.startsWith("hc:job_")) {
            const m = data.match(/^hc:job_(v|p|r|c|s|del|delc):(\d+)$/);
            if (!m) {
              await answerCallbackQuery(cq.id, "⚠️ Ungültige Job-Aktion.");
              return;
            }
            const act = m[1];
            const jid = parseInt(m[2], 10);
            const job = await getHistoryCrawlJobByIdFromD1(env, jid);
            if (!job) {
              await answerCallbackQuery(cq.id, "ℹ️ Job nicht mehr vorhanden.");
              await renderHistoryJobsAndArchiveMenu(env, chatId, msgId);
              return;
            }
            const now = Date.now();
            if (act === "v") {
              await answerCallbackQuery(cq.id, `🎯 Job #${jid}`);
              await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, { selectedJobId: jid });
              return;
            }
            if (act === "p") {
              await updateHistoryCrawlJobStateInD1(env, jid, { status: "paused", workerLeaseUntil: 0, now });
              await answerCallbackQuery(cq.id, `⏸️ Job #${jid} pausiert`);
              await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, { selectedJobId: jid, note: `⏸️ *Job #${jid} pausiert.*` });
              return;
            }
            if (act === "r") {
              const existingJobs = await listHistoryCrawlJobsFromD1(env, 12);
              const anotherActive = existingJobs.some(j => j.id !== jid && (j.status === "running" || j.status === "flood_wait"));
              await updateHistoryCrawlJobStateInD1(env, jid, {
                status: anotherActive ? "queued" : "running",
                floodUntil: 0,
                lastError: "",
                notifyFlags: stripHistoryErrorNotifyFlags(job.notifyFlags),
                now
              });
              await answerCallbackQuery(cq.id, anotherActive ? `🕒 Job #${jid} eingereiht` : `▶️ Job #${jid} fortgesetzt`);
              await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, {
                selectedJobId: jid,
                note: anotherActive ? `🕒 *Job #${jid} in Warteschlange eingereiht.*` : `▶️ *Job #${jid} läuft wieder.*`
              });
              return;
            }
            if (act === "c") {
              const nextCron = !job.cronEnabled;
              await updateHistoryCrawlJobStateInD1(env, jid, { cronEnabled: nextCron, now });
              await answerCallbackQuery(cq.id, nextCron ? "⏱️ Cron aktiviert" : "🔕 Cron deaktiviert");
              await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, { selectedJobId: jid });
              return;
            }
            if (act === "del") {
              await answerCallbackQuery(cq.id, `🗑️ Löschen von Job #${jid} bestätigen`);
              await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, { selectedJobId: jid, confirmDeleteJobId: jid });
              return;
            }
            if (act === "delc") {
              await deleteHistoryCrawlJobInD1(env, jid);
              await answerCallbackQuery(cq.id, `🗑️ Job #${jid} entfernt`);
              await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, { note: `🗑️ *Job #${jid} wurde entfernt.*` });
              return;
            }
            if (act === "s") {
              await answerCallbackQuery(cq.id, `⚡ Führe 1 Scan-Schritt für #${jid} aus...`);
              const stepRes = await runHistoryCrawlStep(env, {
                source: "chat_manual",
                jobId: jid,
                maxHitsPerStep: 12,
                maxProbesPerStep: 16,
                subrequestCeiling: 28,
                leaseMs: 35000
              });
              let stepNote = "";
              if (stepRes?.skippedByLease) {
                stepNote = `🚀 *Browser-Turbo läuft gerade* für Job #${jid} (bitte dort laufen lassen, kein Parallel-Konflikt).`;
              } else if (stepRes?.rateLimited) {
                stepNote = `⏳ *Telegram-Limit aktiv:* Pause für ca. \`${stepRes.retryAfterSec || 10}s\`.`;
              } else if (stepRes?.pacingWait) {
                stepNote = `⏱️ *Index-Kanal-Pacing:* Nächster Slot in \`${Math.max(1, Math.ceil(Number(stepRes.waitMs || 1000) / 1000))}s\` frei.`;
              } else if (stepRes?.backpressured) {
                const fl = await runScheduledChannelIngestFlush(env, {
                  source: "chat_manual",
                  forceFlush: true,
                  filterChatId: job.sourceChatId,
                  maxResolvePerRun: 4
                }).catch(() => null);
                stepNote = fl
                  ? `📦 *Staging-Puffer abgebaut:* \`${fl.processedVideos || 0}\` Video(s) verarbeitet (\`${fl.added || 0}\` neu, \`${fl.remainingPending || 0}\` noch wartend).`
                  : `📦 *Staging-Puffer voll* (\`${stepRes.openHistoryRows || 0}\` offen) — der 2-Minuten-Cron arbeitet ihn zuerst ab.`;
              } else if (stepRes?.ok && stepRes?.stats) {
                const st = stepRes.stats;
                stepNote = stepRes.jobCompleted
                  ? `🎉 *Job #${jid} abgeschlossen!* Letzter Schritt: \`${st.hitsCount}\` Treffer, \`${st.mediaFound}\` Medien, \`${st.deletedProbeMsgs}\` Probes gelöscht.`
                  : `⚡ *Schritt fertig:* \`${st.probesFired}\` Probes · \`${st.hitsCount}\` Treffer · 🎬 \`${st.mediaFound}\` Medien · 🧹 \`${st.deletedProbeMsgs}\` gelöscht` +
                    (st.skippedExistingCount > 0 ? ` · ⏭️ \`${st.skippedExistingCount}\` Skip` : "");
              } else {
                stepNote = `⚠️ ${escapeMd(stepRes?.error || stepRes?.reason || "Kein Schritt ausgeführt.")}`;
              }
              await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, { selectedJobId: jid, note: stepNote });
              return;
            }
          }

          if (data === "hc:arch_s") {
            await answerCallbackQuery(cq.id, "⚡ Sende bis zu 4 Archiv-Posts...");
            const res = await processArchiveMirrorQueueBatch(env, { maxPosts: 4, maxNewTopics: 2, subrequestCeiling: 36 });
            let note = "";
            if (res?.waiting || res?.rateLimited) {
              const waitSec = Math.max(1, Number(res.retryAfterSec || Math.ceil(Number(res.waitMs || 4300) / 1000)));
              const postedBeforeLimit = Number(res.postedCount || 0);
              note = postedBeforeLimit > 0
                ? `🗂️ *Archiv-Schritt:* \`${postedBeforeLimit}\` gepostet · ⏳ Pacing-Pause für ca. \`${waitSec}s\`.`
                : `⏳ *Telegram-Pacing im Archiv:* Nächster Post in ca. \`${waitSec}s\` bereit.`;
            } else if (res?.idle) {
              note = "ℹ️ *Archiv-Warteschlange:* Aktuell keine fälligen Posts zum Senden.";
            } else if (res?.ok) {
              note = `🗂️ *Archiv-Schritt:* \`${Number(res.postedCount || 0)}\` gepostet · \`${Number(res.newTopicsCreated || 0)}\` Thema neu` +
                (Number(res.failedCount || 0) > 0 ? ` · ⛔ \`${res.failedCount}\` Fehler` : "");
            } else {
              note = `⚠️ ${escapeMd(res?.error || "Archiv-Schritt fehlgeschlagen.")}`;
            }
            await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, { note });
            return;
          }

          if (data === "hc:arch_rel") {
            const released = await releaseHeldArchiveMirrorItemsForJobInD1(env, 0, Date.now(), { releaseAll: true });
            await answerCallbackQuery(cq.id, `🔓 ${released} Einträge freigegeben`);
            await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, {
              note: `🔓 *${released} zurückgehaltene Archiv-Einträge* wurden zur Auslieferung freigegeben.`
            });
            return;
          }

          if (data === "hc:arch_ret") {
            const archCh = (await getHistoryIndexChannelsFromD1(env, { role: "archive_forum", onlyEnabled: false }))[0] || null;
            const retried = await retryFailedArchiveMirrorItemsInD1(env, archCh?.channelId || "");
            await answerCallbackQuery(cq.id, `🔁 ${retried} Fehler zurückgesetzt`);
            await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, {
              note: `🔁 *${retried} fehlgeschlagene Archiv-Einträge* wurden erneut eingereiht.`
            });
            return;
          }

          if (data === "hc:arch_dir") {
            await answerCallbackQuery(cq.id, "📑 Aktualisiere Inhaltsverzeichnis...");
            const dirRes = await syncArchiveDirectoryTopic(env, { force: true, subrequestCeiling: 40 });
            const note = dirRes?.ok
              ? `📌 *Inhaltsverzeichnis aktualisiert:* \`${Number(dirRes.topicCount || 0)}\` Themen · \`${Number(dirRes.totalPostedFiles || 0)}\` Dateien` +
                (dirRes.deepLink ? ` · [Direkt öffnen](${dirRes.deepLink})` : "")
              : `⚠️ *Inhaltsverzeichnis:* ${escapeMd(dirRes?.error || "Fehler beim Aktualisieren.")}`;
            await renderHistoryJobsAndArchiveMenu(env, chatId, msgId, { note });
            return;
          }
        }

        // --- BOT API 9.3–10.5: /themen & /topics MANAGER CALLBACKS ---
        if (data === "topm_mode_off" || data === "topm_mode_by_type" || data === "topm_mode_per_series") {
          const nextMode = data.replace("topm_mode_", "");
          const curSettings = await getUserSettings(env, chatId);
          const curDeliv = (curSettings && curSettings.deliveryConfig && typeof curSettings.deliveryConfig === "object")
            ? { ...curSettings.deliveryConfig }
            : {};
          curDeliv.topicRoutingMode = normalizeTopicRoutingMode(nextMode);
          await saveUserSettings(env, chatId, { ...curSettings, deliveryConfig: curDeliv });
          const modeLabelMap = {
            off: "⚪ Auto-Themen ausgeschaltet",
            by_type: "🎬/📺 Auto-Themen nach Typ (Filme / Serien) aktiv!",
            per_series: "📺 Auto-Themen 'Pro Serie ein Thema' aktiv!"
          };
          await answerCallbackQuery(cq.id, modeLabelMap[curDeliv.topicRoutingMode] || "✅ Modus gespeichert");
          await showTopicsManagerMenu(env, chatId, msgId, `✅ _${modeLabelMap[curDeliv.topicRoutingMode]}_`);
          return;
        }

        if (data === "topm_create_defaults") {
          const curSettings = await getUserSettings(env, chatId);
          const curDeliv = (curSettings && curSettings.deliveryConfig && typeof curSettings.deliveryConfig === "object")
            ? { ...curSettings.deliveryConfig }
            : {};
          const targetChat = (curDeliv.targetMode === "group" && curDeliv.targetGroupChatId)
            ? String(curDeliv.targetGroupChatId).trim()
            : String(chatId).trim();
          const customBotToken = String(curDeliv.customBotToken || "").trim();
          const movieRes = await resolveOrCreateDeliveryTopic(env, {
            ownerChatId: chatId,
            targetChatId: targetChat,
            savedDeliv: curDeliv,
            topicRoutingMode: "by_type",
            typeCode: "m",
            title: "Filme",
            customBotToken
          });
          // Frische Settings laden, damit das erste gespeicherte Topic beim zweiten nicht überschrieben wird
          const afterMovSettings = await getUserSettings(env, chatId);
          const afterMovDeliv = (afterMovSettings && afterMovSettings.deliveryConfig) ? afterMovSettings.deliveryConfig : curDeliv;
          const seriesRes = await resolveOrCreateDeliveryTopic(env, {
            ownerChatId: chatId,
            targetChatId: targetChat,
            savedDeliv: afterMovDeliv,
            topicRoutingMode: "by_type",
            typeCode: "s",
            title: "Serien",
            customBotToken
          });
          const okCount = (movieRes.topicId ? 1 : 0) + (seriesRes.topicId ? 1 : 0);
          const createdCount = (movieRes.autoCreated ? 1 : 0) + (seriesRes.autoCreated ? 1 : 0);
          if (okCount > 0) {
            const toast = createdCount > 0
              ? `✅ ${createdCount} Standard-Thema/Themen neu angelegt!`
              : "✅ Standard-Themen (🎬 Filme & 📺 Serien) sind bereits eingerichtet.";
            await answerCallbackQuery(cq.id, toast);
            await showTopicsManagerMenu(env, chatId, msgId, toast);
          } else {
            const reason = movieRes.fallbackReason || seriesRes.fallbackReason || "Topics sind in diesem Chat nicht aktiviert.";
            await answerCallbackQuery(cq.id, `⚠️ Themen nicht verfügbar: ${reason}`, true);
            await showTopicsManagerMenu(env, chatId, msgId, `⚠️ *Hinweis:* \`${escapeMd(reason)}\``);
          }
          return;
        }

        if (data === "topm_reset_map") {
          const curSettings = await getUserSettings(env, chatId);
          const curDeliv = (curSettings && curSettings.deliveryConfig && typeof curSettings.deliveryConfig === "object")
            ? { ...curSettings.deliveryConfig }
            : {};
          curDeliv.topicMap = {};
          await saveUserSettings(env, chatId, { ...curSettings, deliveryConfig: curDeliv });
          await answerCallbackQuery(cq.id, "🔄 Themen-Zuordnung zurückgesetzt!");
          await showTopicsManagerMenu(env, chatId, msgId, "🔄 _Gespeicherte Themen-Zuordnungen wurden geleert (Nachrichten bleiben erhalten)._");
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

        // --- D1 IMPORT-QUEUE BATCH CALLBACKS (nur für autorisierte Admins über den Haupt-Bot) ---
        if (data === "impq_step_1" || data === "impq_step_3") {
          const canManageQueue = !env._isCustomBotWebhook && typeof isTelegramBotAdmin === "function"
            ? await isTelegramBotAdmin(env, cq.from?.id || chatId)
            : false;
          if (!canManageQueue) {
            await answerCallbackQuery(cq.id, "🔒 Nur für Administratoren erlaubt.", true);
            return;
          }
          const rounds = data === "impq_step_3" ? 3 : 1;
          await answerCallbackQuery(cq.id, `⏳ Verarbeite nächsten Batch (${rounds * 12} Einträge)...`);
          await processNextD1QueueStepAndEditMessage(env, chatId, msgId, rounds);
          return;
        }

        if (data === "impq_clear") {
          const canManageQueue = !env._isCustomBotWebhook && typeof isTelegramBotAdmin === "function"
            ? await isTelegramBotAdmin(env, cq.from?.id || chatId)
            : false;
          if (!canManageQueue) {
            await answerCallbackQuery(cq.id, "🔒 Nur für Administratoren erlaubt.", true);
            return;
          }
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

        // --- ADMIN PANEL CALLBACKS (/stats xyz — strikt nur für autorisierte Admins über den Haupt-Bot) ---
        if (data === "adm_refresh" || data === "adm_reset" || data.startsWith("adm_tier_")) {
          const canUseAdminCb = !env._isCustomBotWebhook && typeof isTelegramBotAdmin === "function"
            ? await isTelegramBotAdmin(env, cq.from?.id || chatId)
            : false;
          if (!canUseAdminCb) {
            await answerCallbackQuery(cq.id, "🔒 Zugriff verweigert: Nur für Administratoren.", true);
            return;
          }
        }

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
          const ALLOWED_TIER_KEYS = ["tmdb", "cloudflare", "telegram", "translator"];
          if (!ALLOWED_TIER_KEYS.includes(serviceKey)) {
            await answerCallbackQuery(cq.id, "⚠️ Ungültiger Dienst-Schlüssel.", true);
            return;
          }
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

          if (prevCtx && prevCtx.type === "ybr" && (prevCtx.id === `${typeCode}_${year}_${mode}_${pageNum}` || prevCtx.id === `${typeCode}_${year}_${mode}_${pageNum}_${originId}`)) {
            const inverted = invertSortDirection(prevSort);
            nextSortOverride = inverted.nextSort;
            await answerCallbackQuery(cq.id, `🔄 Sortierung umgekehrt (${inverted.arrow})`);
          } else {
            await answerCallbackQuery(cq.id, `📅 Lade Jahrgang ${year}...`);
          }
          await showYearBrowseList(env, chatId, typeCode, year, mode, pageNum, msgId, nextSortOverride);
          return;
        }

        if (data.startsWith("ysort_")) {
          const parts = data.split("_");
          const typeCode = parts[1] || "m";
          const year = parts[2] || "2024";
          const mode = parts[3] || "pop";
          const pageNum = parseInt(parts[4], 10) || 1;
          const sortAction = parts[5];
          const sortKey = `ybr_sort_${chatId}_${typeCode}_${year}_${mode}`;
          const defaultSort = (mode === "top" || mode === "gems") ? "rating_desc" : "pop_desc";
          const prevSort = memoryFallback.get(sortKey) || defaultSort;
          const { nextSort, label } = resolveNextSort(prevSort, sortAction);
          await answerCallbackQuery(cq.id, label);
          await showYearBrowseList(env, chatId, typeCode, year, mode, pageNum, msgId, nextSort);
          return;
        }

        if (data.startsWith("yfilt_tog_")) {
          const ctxKey = data.replace("yfilt_tog_", "");
          const [typeCode, year, mode, pageStr] = ctxKey.split("_");
          const settings = await getUserSettings(env, chatId);
          settings.filtersActive = !(settings.filtersActive !== false);
          await saveUserSettings(env, chatId, settings);
          await answerCallbackQuery(cq.id, settings.filtersActive ? "🟢 Jahres-Filter AKTIV!" : "🔴 Jahres-Filter AUS!");
          await showYearBrowseList(env, chatId, typeCode || "m", year || "2024", mode || "pop", parseInt(pageStr, 10) || 1, msgId);
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
              await showSeriesEpisodes(env, chatId, itemObj.seriesId, itemObj.seasonNumber != null ? Number(itemObj.seasonNumber) : 1, "all", 1, msgId);
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
          if (msgId) await untrackTempMessage(env, chatId, msgId);

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

        // Sicherheits-Fallback: Falls ein unbekannter oder veralteter Button geklickt wurde,
        // Laderädchen in Telegram sofort quittieren, um einen 30s-Freeze zu verhindern.
        await answerCallbackQuery(cq.id).catch(() => {});
      }
    } catch (err) {
      console.error("[Telegram Router Error]:", err);
      if (update?.callback_query?.id) {
        await answerCallbackQuery(update.callback_query.id, "⚠️ Vorgang konnte nicht abgeschlossen werden.").catch(() => {});
      }
    } finally {
      if (incomingThreadChatId !== null && incomingThreadChatId !== undefined) {
        clearActiveChatThreadId(incomingThreadChatId);
      }
      if (activeSessionChatId) {
        clearActiveChatThreadId(activeSessionChatId);
        await flushUserSession(env, activeSessionChatId);
      }
    }
  }
