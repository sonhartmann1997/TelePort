  // @DEPARTMENT: 06-bot-ui-menus | 6. Bot-Menüs, Filter-Cockpit, Detailkarten & Suche
  // @ANCHOR: ADMIN_PANEL
  // --- Verstecktes Admin-Panel (/stats xyz) inkl. Cloudflare D1 SQLite Statistiken ---
  async function showAdminStatsPanel(env, chatId, messageId = null) {
    const { sendMessage, editMessageText } = tgApi(env);
    checkStatsDayRollover();
    const activeTiers = await getActiveTiers(env);
    const d1Stats = await getD1DatabaseStats(env);

    const tmdbTier = API_TIERS.tmdb[activeTiers.tmdb || "free"];
    const cfTier = API_TIERS.cloudflare[activeTiers.cloudflare || "free"];
    const tgTier = API_TIERS.telegram[activeTiers.telegram || "free"];
    const trTier = API_TIERS.translator[activeTiers.translator || "free"];

    const pct = (val, max) => max > 0 ? ((val / max) * 100).toFixed(2) + "%" : "0%";
    const recentSearches = runtimeStats.lastSearchTerms.length > 0
      ? runtimeStats.lastSearchTerms.map(s => `\`${escapeMd(s)}\``).join(", ")
      : "_Keine_";

    const d1StatusText = d1Stats.enabled
      ? `🟢 Aktiv (🎬 \`${d1Stats.moviesCount}\` Filme • 📺 \`${d1Stats.seriesCount}\` Serien • 🔍 \`${d1Stats.searchesCount}\` Suchen)`
      : `⚪ Nicht gebunden (\`env.DB\`)`;

    const text =
      `🔐 *ADMIN-DASHBOARD (/stats xyz)*\n` +
      `📅 *Zeitraum:* \`${runtimeStats.dayKey}\` (UTC) • Reset: \`00:00 UTC\`\n` +
      `${SEP}\n` +
      `🗄️ *D1 SQLITE DATENBANK*\n` +
      `${d1StatusText}\n` +
      `⚡ *Eingesparte TMDB-Calls (D1 Hits):* \`${runtimeStats.d1Hits}\`\n` +
      `📖 *D1 Reads:* \`${runtimeStats.d1Reads}\` / \`${cfTier.d1ReadsPerDay || 5000000}\`\n` +
      `✍️ *D1 Writes:* \`${runtimeStats.d1Writes}\` / \`${cfTier.d1WritesPerDay || 100000}\`\n` +
      `${SEP}\n` +
      `📊 *API-AUFRUFE VS. TIER-LIMITS*\n` +
      `🎬 *TMDB:* \`${runtimeStats.tmdbCalls}\` / \`${tmdbTier.requestsPerDay}\` (${pct(runtimeStats.tmdbCalls, tmdbTier.requestsPerDay)})\n` +
      `🤖 *Telegram:* \`${runtimeStats.telegramCalls}\` / \`${tgTier.requestsPerDay}\` (${pct(runtimeStats.telegramCalls, tgTier.requestsPerDay)})\n` +
      `☁️ *KV Reads:* \`${runtimeStats.kvReads}\` / \`${cfTier.kvReadsPerDay}\`\n` +
      `💾 *KV Writes:* \`${runtimeStats.kvWrites}\` / \`${cfTier.kvWritesPerDay}\`\n` +
      `🌐 *Translator:* \`${runtimeStats.translatorCalls}\` / \`${trTier.requestsPerDay}\`\n` +
      `${SEP}\n` +
      `🛡️ *TELEGRAM ANTI-SPAM & WARTESCHLEIFE*\n` +
      `⚡ *Global (Sek.):* \`${antiSpamState.globalTimestamps.length}/${ANTI_SPAM_LIMITS.GLOBAL_MAX_PER_SEC}\` • *Gruppe (Min.):* \`max ${ANTI_SPAM_LIMITS.GROUP_MAX_PER_MIN}/60s\` • *Chat-Pacing:* \`1.15s\`\n` +
      `⏳ *Aktive Warteschlange:* \`${antiSpamState.queue.filter(q => q.status === "queued").length} Jobs\` • *Abgearbeitet:* \`${antiSpamState.totalDrained}\` • *429 Flood-Hits:* \`${antiSpamState.total429Hits}\`\n` +
      `${SEP}\n` +
      `🔍 *SUCH-METRIKEN (HEUTE)*\n` +
      `🔎 Suchen: \`${runtimeStats.searchQueries}\` • 🎲 Zufall: \`${runtimeStats.randomSearches}\` • ✨ Ähnlich: \`${runtimeStats.similarSearches}\`\n` +
      `🕒 Begriffe: ${recentSearches}`;

    const inline_keyboard = [
      [
        {
          text: `🎬 TMDB: ${(activeTiers.tmdb || "free").toUpperCase()} 🔄`,
          callback_data: "adm_tier_tmdb"
        },
        {
          text: `☁️ Worker/KV/D1: ${(activeTiers.cloudflare || "free").toUpperCase()} 🔄`,
          callback_data: "adm_tier_cloudflare"
        }
      ],
      [
        {
          text: `🤖 Telegram: ${(activeTiers.telegram || "free").toUpperCase()} 🔄`,
          callback_data: "adm_tier_telegram"
        },
        {
          text: `🌐 Translator: ${(activeTiers.translator || "free").toUpperCase()} 🔄`,
          callback_data: "adm_tier_translator"
        }
      ],
      [
        { text: "🔄 Aktualisieren", callback_data: "adm_refresh" },
        { text: "🗑️ Reset", callback_data: "adm_reset" }
      ],
      buildFooterRow(chatId, true)
    ];

    const markup = { reply_markup: { inline_keyboard } };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // @ANCHOR: MAIN_MENU_INFO
  // --- Menü-Ansichten (Sauberes, zeilenumbruchsicheres Design) ---
  async function initialMenu(env, chatId, firstName = "Filmfreund") {
    const { sendMessage } = tgApi(env);
    await clearOriginSession(env, chatId);

    const safeName = escapeMd(firstName);

    const text =
      `🍿 *FILM & SERIEN BOT*\n` +
      `👋 Hallo *${safeName}*!\n` +
      `${SEP}\n` +
      `⚡ *SCHNELLBEFEHLE (f = Film, s = Serie)*\n` +
      `▸ \`/t f\`  •  \`/t s\` – 🔥 Trending (\`/trend\`, \`/trending\`, \`/trnd\`)\n` +
      `▸ \`/p f\`  •  \`/p s\` – 🌟 Populär (\`/pop\`, \`/popular\`, \`/populär\`)\n` +
      `▸ \`/sc f\` •  \`/sc s\` – 💎 Geheimtipps (\`/sec\`, \`/secret\`, \`/geheim\`)\n` +
      `▸ \`/r f\`  •  \`/r s\` – 🎲 Zufall (\`/rand\`, \`/random\`, z. B. \`/r action f\`)\n` +
      `▸ \`/search\` – Direktsuche  •  \`/filter\` – Filter-Cockpit\n` +
      `▸ \`/zurück\` – Schritt zurück  •  \`/restart\` – Neustart\n` +
      `▸ \`/info\` – Alle Befehle & Icons im Überblick`;

    const inline_keyboard = [
      [
        { text: "🎬 Film empfehlen", callback_data: "type_m" },
        { text: "📺 Serie empfehlen", callback_data: "type_s" }
      ],
      [
        { text: "🎲 Zufalls-Tipp (Film & Serie)", callback_data: "g_any_random_all" }
      ],
      [
        { text: "🍿 Filmreihen", callback_data: "browse_collections" },
        { text: "🌌 Filmuniversen", callback_data: "browse_universes" }
      ],
      [
        { text: "🔍 Titel suchen", callback_data: "trigger_search" },
        { text: "💾 Meine Merkliste", callback_data: "show_saved" }
      ],
      [
        { text: "⚙️ Filter & Setup", callback_data: "settings_menu" },
        { text: "ℹ️ Info & Hilfe", callback_data: "bot_info" }
      ],
      [
        { text: "📢 Inline in Gruppe/Chat teilen", switch_inline_query: "" }
      ]
    ];

    const effectiveWebAppBase = String(env.WEBAPP_URL || env.WEBHOOK_URL || "https://teleport.sonhartmann-1997.workers.dev/").replace(/\/$/, "");
    if (effectiveWebAppBase && !isGroupOrChannelChat(chatId)) {
      const signedMainWebAppUrl = await buildSignedWebAppUrl(env, effectiveWebAppBase, chatId);
      inline_keyboard.unshift([
        { text: "🍿 Netflix Mini-App öffnen", web_app: { url: signedMainWebAppUrl } }
      ]);
      tgApi(env).setChatMenuButton(chatId, effectiveWebAppBase, "🍿 Mediathek").catch(() => {});
    }

    if (isGroupOrChannelChat(chatId)) {
      inline_keyboard.push([{ text: "✖️ Vorgang beenden / Schließen", callback_data: "close_bot_msg" }]);
    }

    const sent = await sendMessage(chatId, text, { reply_markup: { inline_keyboard } });
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // ============================================================================
  // INFO-POST (/info & /Info): ERKLÄRT ALLE ICONS, BEFEHLE & INLINE-FUNKTIONEN
  // ============================================================================
  async function showBotInfoPost(env, chatId, messageId = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    const botUsername = (await getBotUsername(env)) || "DeinBotName";

    const text =
      `ℹ️ *BOT-GUIDE: BEFEHLE & SYMBOLE*\n` +
      `${SEP}\n` +
      `⚡ *SCHNELLBEFEHLE FÜR TRENDS, POPULÄR, SECRET & RANDOM*\n` +
      `Nutze \`f\` für *Film* und \`s\` für *Serie*:\n` +
      `▸ 🔥 *Trends:* \`/t f\`, \`/t s\`, \`/trnd f\`, \`/trnd s\`, \`/trend f\`, \`/trend s\`, \`/trending f\`, \`/trending s\`\n` +
      `▸ 🌟 *Populär:* \`/p f\`, \`/p s\`, \`/pop f\`, \`/pop s\`, \`/popular f\`, \`/popular s\`, \`/populär f\`, \`/populär s\`\n` +
      `▸ 💎 *Geheimtipps:* \`/SC f\`, \`/SC s\`, \`/sec f\`, \`/sec s\`, \`/secret f\`, \`/secret s\`, \`/geheim f\`, \`/geheim s\`\n` +
      `▸ 🎲 *Zufall:* \`/r\`, \`/r f\`, \`/r s\`, \`/rand f\`, \`/rand s\`, \`/random f\`, \`/random s\` (auch mit Genre: \`/r action f\`)\n` +
      `${SEP}\n` +
      `💬 *WEITERE CHAT-BEFEHLE*\n` +
      `▸ \`/start\` – Hauptmenü öffnen\n` +
      `▸ \`/zurück\` – Immer einen Schritt zurück\n` +
      `▸ \`/restart\` – Alles bereinigen & neu starten\n` +
      `▸ \`/info\` – Diese Hilfe & Symbol-Legende\n` +
      `▸ \`/search\` _Name_ – Direktsuche (oder einfach losschreiben)\n` +
      `▸ \`/filter\` – FSK, Genres, Studios, Plattformen & Epochen filtern\n` +
      `${SEP}\n` +
      `📢 *INLINE-BEFEHLE (In jedem Chat & Kanal nutzbar)*\n` +
      `Tippe im Eingabefeld eines beliebigen Chats:\n` +
      `▸ \`@${botUsername}\` – Überraschungs-Tipp & Trends\n` +
      `▸ \`@${botUsername} Matrix\` – Direktsuche nach Titel\n` +
      `▸ \`@${botUsername} f\` – Zufällige Filme (inkl. Blind-Tipp)\n` +
      `▸ \`@${botUsername} s\` – Zufällige Serien (inkl. Blind-Tipp)\n` +
      `▸ \`@${botUsername} action f\` – Genre-Vorschläge\n` +
      `${SEP}\n` +
      `🎨 *ALLE ICONS & SYMBOLE ERKLÄRT*\n` +
      `▸ 🔍 *Lupe* – Öffnet das Suchmenü („Wie suchen?": Telegram, TMDB, Bot, Kopieren)\n` +
      `▸ 💾 *Diskette* – In deiner Merkliste speichern (ordnet Filme, Serien, Episoden, Reihen & Personen automatisch zu)\n` +
      `▸ 📤 *Teilen* – Empfehlung direkt mit Cover-Vorschau weiterleiten\n` +
      `▸ ✨ *Ähnliche Titel* – Sucht passende Alternativen zum aktuellen Titel\n` +
      `▸ 📺 *Episoden* – Alle Staffeln & Folgen einer Serie durchstöbern & einzelne Folgen merken\n` +
      `▸ 🗓️ *Jahr antippen* – Beliebte, neueste & bestbewertete Titel aus diesem Erscheinungsjahr entdecken\n` +
      `▸ 🎞️ *Genre antippen* – Zufall, Trending, Beliebt, Neueste & Geheimtipps des Genres\n` +
      `▸ 👤 *Regie / Cast antippen* – Komplette Filmografie im Bot ansehen & speichern\n` +
      `▸ ✏️ / 🗑️ – Ordner umbenennen oder Eintrag/Ordner (mit Sicherheitsabfrage) löschen\n` +
      `▸ ◀️ / ▶️ / \`•\` – Seitennavigation (\`•\` zeigt an, dass der Anfang/das Ende erreicht ist)`;

    const inline_keyboard = [
      [
        { text: "🔥 Trends (Filme)", callback_data: "gbrowse_m_all_trend_1" },
        { text: "🔥 Trends (Serien)", callback_data: "gbrowse_s_all_trend_1" }
      ],
      [
        { text: "🌟 Populär (Filme)", callback_data: "gbrowse_m_all_pop_1" },
        { text: "🌟 Populär (Serien)", callback_data: "gbrowse_s_all_pop_1" }
      ],
      [
        { text: "💎 Geheimtipp (Filme)", callback_data: "gbrowse_m_all_gems_1" },
        { text: "💎 Geheimtipp (Serien)", callback_data: "gbrowse_s_all_gems_1" }
      ],
      [
        { text: "🎲 Zufalls-Tipp", callback_data: "g_any_random_all" },
        { text: "📢 Inline testen", switch_inline_query: "" }
      ],
      buildFooterRow(chatId, true)
    ];

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // ============================================================================
  // EINHEITLICHE SEITENNAVIGATION (Zeigt immer ◀️ und ▶️ bzw. • als Platzhalter)
  // ============================================================================
  function buildPaginationRow(currentPage, totalPages, prevCallback, nextCallback, centerButton = null) {
    const leftBtn = currentPage > 1
      ? { text: "◀️", callback_data: prevCallback }
      : { text: "•", callback_data: "wl_noop" };
    const midBtn = centerButton || { text: `📄 ${currentPage} / ${totalPages}`, callback_data: "wl_noop" };
    const rightBtn = currentPage < totalPages
      ? { text: "▶️", callback_data: nextCallback }
      : { text: "•", callback_data: "wl_noop" };
    return [leftBtn, midBtn, rightBtn];
  }

  // @ANCHOR: BROWSER_COLLECTIONS_UNIVERSES
  // ============================================================================
  // FILMREIHEN-BROWSER ("🍿 Filmreihen" auf der Hauptseite)
  // ============================================================================
  async function showCollectionsBrowser(env, chatId, page = 1, searchQuery = "", messageId = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    const botUsername = await getBotUsername(env);

    let text = "";
    let totalPages = 1;
    let currentPage = Math.max(1, page);
    let items = [];

    if (searchQuery && searchQuery.trim()) {
      const cleanQ = searchQuery.trim();
      const sess = await getUserSession(env, chatId);
      sess.bcolQuery = cleanQ;
      sess._dirty = true;
      memoryFallback.set(`bcol_query_${chatId}`, cleanQ);
      const searchRes = await searchCollectionsTMDB(env, cleanQ, currentPage);
      items = searchRes?.results || [];
      totalPages = searchRes?.total_pages || 1;
      currentPage = searchRes?.current_page || 1;

      text =
        `🍿 *FILMREIHEN: "${escapeMd(cleanQ.toUpperCase())}"*\n` +
        `📊 ${searchRes?.total_results || items.length} Treffer • 📄 Seite ${currentPage}/${totalPages}\n` +
        `${SEP}\n\n`;

      if (items.length === 0) {
        text += `⚠️ _Keine Filmreihen zu "${escapeMd(cleanQ)}" gefunden._\n\n`;
      } else {
        for (const col of items) {
          const colName = (col.name || "Filmreihe").trim();
          memoryFallback.set(`col_name_${col.id}`, colName);
          const openLink = makeBotLink(botUsername, `bcol_${col.id}`);
          const whereLink = makeBotLink(botUsername, `wscol_${col.id}`);
          text += `🍿 *[${escapeMd(colName)}](${openLink})*  •  [🔍](${whereLink})\n\n`;
        }
      }
    } else {
      const sess = await getUserSession(env, chatId);
      if (sess.bcolQuery) {
        delete sess.bcolQuery;
        sess._dirty = true;
      }
      memoryFallback.delete(`bcol_query_${chatId}`);
      const perPage = 10;
      totalPages = Math.max(1, Math.ceil(FEATURED_COLLECTIONS.length / perPage));
      currentPage = Math.min(Math.max(1, page), totalPages);
      items = FEATURED_COLLECTIONS.slice((currentPage - 1) * perPage, currentPage * perPage);

      text =
        `🍿 *FILMREIHEN STÖBERN*\n` +
        `✨ Beliebte Kollektionen • 📄 Seite ${currentPage}/${totalPages}\n` +
        `${SEP}\n` +
        `_Tippe auf eine Filmreihe, um alle Teile zu öffnen:_\n\n`;

      for (const col of items) {
        memoryFallback.set(`col_name_${col.id}`, col.name);
        const openLink = makeBotLink(botUsername, `bcol_${col.id}`);
        const whereLink = makeBotLink(botUsername, `wscol_${col.id}`);
        text += `${col.icon || col.emoji || "🍿"} *[${escapeMd(col.name)}](${openLink})*  •  [🔍](${whereLink})\n\n`;
      }
    }

    const inline_keyboard = [];
    inline_keyboard.push(
      buildPaginationRow(currentPage, totalPages, `bcol_page_${currentPage - 1}`, `bcol_page_${currentPage + 1}`)
    );

    // Gleiche Position des Wechsel-Buttons bei Filmreihen & Filmuniversen (Reihe 2 rechts neben Zufall!)
    inline_keyboard.push([
      { text: "🎲 Zufällige Filmreihe", callback_data: "bcol_rand" },
      { text: "🌌 Filmuniversen", callback_data: "browse_universes" }
    ]);
    inline_keyboard.push([
      { text: "🔍 Filmreihe suchen", callback_data: "bcol_search" }
    ]);

    if (searchQuery && searchQuery.trim()) {
      inline_keyboard.push([{ text: "🍿 Alle Top-Filmreihen zeigen", callback_data: "browse_collections" }]);
    }

    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // ============================================================================
  // FILMUNIVERSEN-BROWSER ("🌌 Filmuniversen" – gleiches Design wie Filmreihen!)
  // ============================================================================
  async function showUniversesBrowser(env, chatId, page = 1, messageId = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    const botUsername = await getBotUsername(env);

    const perPage = 8;
    const totalPages = Math.max(1, Math.ceil(CINEMATIC_UNIVERSES.length / perPage));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const slice = CINEMATIC_UNIVERSES.slice((currentPage - 1) * perPage, currentPage * perPage);

    let text =
      `🌌 *FILMUNIVERSEN STÖBERN*\n` +
      `🎬 Große Franchise-Welten • 📄 Seite ${currentPage}/${totalPages}\n` +
      `${SEP}\n` +
      `_Tippe auf ein Filmuniversum, um alle Teile zu öffnen:_\n\n`;

    for (const uni of slice) {
      memoryFallback.set(`uni_name_${uni.id}`, uni.name);
      const openLink = makeBotLink(botUsername, `buni_${uni.id}`);
      const whereLink = makeBotLink(botUsername, `wsuni_${uni.id}`);
      text += `${uni.icon || "🌌"} *[${escapeMd(uni.name)}](${openLink})*  •  [🔍](${whereLink})\n\n`;
    }

    const inline_keyboard = [];
    inline_keyboard.push(
      buildPaginationRow(currentPage, totalPages, `buni_page_${currentPage - 1}`, `buni_page_${currentPage + 1}`)
    );

    // Gleiche Position des Wechsel-Buttons wie in Filmreihen (Reihe 2 rechts neben Zufall!)
    inline_keyboard.push([
      { text: "🎲 Zufälliges Universum", callback_data: "buni_rand" },
      { text: "🍿 Filmreihen", callback_data: "browse_collections" }
    ]);
    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // @ANCHOR: FILTER_SORT_UI
  // Einheitliche Sortier-Button-Zeile (für Suche, Filmreihen, Universen, Schauspieler/Regie, Genres & Jahre)
  // Erneutes Tippen auf denselben Sortier-Button kehrt die Sortierreihenfolge um (▼ <-> ▲)!
  function buildSortRow(currentSort, callbackPrefix) {
    const sortPopLabel = currentSort === "pop_desc" ? "🔥 Beliebt ▼" : currentSort === "pop_asc" ? "🔥 Beliebt ▲" : "🔥 Beliebt";
    const sortRatLabel = currentSort === "rating_desc" ? "⭐ Bewertung ▼" : currentSort === "rating_asc" ? "⭐ Bewertung ▲" : "⭐ Bewertung";
    const sortYrLabel = currentSort === "year_desc" ? "📅 Jahr ▼" : currentSort === "year_asc" ? "📅 Jahr ▲" : "📅 Jahr";
    return [
      { text: sortPopLabel, callback_data: `${callbackPrefix}_pop` },
      { text: sortRatLabel, callback_data: `${callbackPrefix}_rating` },
      { text: sortYrLabel, callback_data: `${callbackPrefix}_year` }
    ];
  }

  function resolveNextSort(prevSort, sortAction) {
    if (sortAction === "pop") {
      const nextSort = prevSort === "pop_desc" ? "pop_asc" : "pop_desc";
      return {
        nextSort,
        toast: nextSort === "pop_desc" ? "🔥 Sortiert: Beliebteste ▼" : "🔥 Sortiert: Weniger bekannte ▲"
      };
    }
    if (sortAction === "rating") {
      const nextSort = prevSort === "rating_desc" ? "rating_asc" : "rating_desc";
      return {
        nextSort,
        toast: nextSort === "rating_desc" ? "⭐ Sortiert: Beste Bewertung ▼" : "⭐ Sortiert: Niedrigste Bewertung ▲"
      };
    }
    const nextSort = prevSort === "year_desc" ? "year_asc" : "year_desc";
    return {
      nextSort,
      toast: nextSort === "year_desc" ? "📅 Sortiert: Neueste ▼" : "📅 Sortiert: Älteste ▲"
    };
  }

  function invertSortDirection(currentSort) {
    const map = {
      pop_desc: "pop_asc",
      pop_asc: "pop_desc",
      rating_desc: "rating_asc",
      rating_asc: "rating_desc",
      year_desc: "year_asc",
      year_asc: "year_desc"
    };
    return map[currentSort] || "pop_desc";
  }

  // Erstellt kompakte Filter-Buttons mit Checkmarks (für Suche, Zufall, Filmreihen, Universen, Personen, Genres & Jahre)
  function buildQuickFilterRows(settings, contextPrefix = "") {
    const isFilterOn = settings.filtersActive !== false;
    const fskCount = (settings.excludedFsk || []).length;
    const genreCount = (settings.excludedGenres || []).length;
    const eraCount = (settings.excludedEras || []).length;

    let toggleCb = "toggle_global_filters";
    let fskCb = "open_fsk_dash";
    let genreCb = "open_genre_dash";
    let eraCb = "open_era_dash";

    if (contextPrefix === "search") {
      toggleCb = "sfilt_toggle_global";
      fskCb = "sfilt_open_fsk";
      genreCb = "sfilt_open_genre";
      eraCb = "sfilt_open_era";
    } else if (contextPrefix.startsWith("col_")) {
      const colId = contextPrefix.replace("col_", "");
      toggleCb = `cfilt_tog_${colId}`;
      fskCb = `cfilt_fsk_${colId}`;
      genreCb = `cfilt_gen_${colId}`;
      eraCb = `cfilt_era_${colId}`;
    } else if (contextPrefix.startsWith("uni_")) {
      const uniId = contextPrefix.replace("uni_", "");
      toggleCb = `ufilt_tog_${uniId}`;
      fskCb = `ufilt_fsk_${uniId}`;
      genreCb = `ufilt_gen_${uniId}`;
      eraCb = `ufilt_era_${uniId}`;
    } else if (contextPrefix.startsWith("per_")) {
      const perId = contextPrefix.replace("per_", "");
      toggleCb = `pfilt_tog_${perId}`;
      fskCb = `pfilt_fsk_${perId}`;
      genreCb = `pfilt_gen_${perId}`;
      eraCb = `pfilt_era_${perId}`;
    } else if (contextPrefix.startsWith("gbr_")) {
      const gbrKey = contextPrefix.replace("gbr_", "");
      toggleCb = `gfilt_tog_${gbrKey}`;
      fskCb = `gfilt_fsk_${gbrKey}`;
      genreCb = `gfilt_gen_${gbrKey}`;
      eraCb = `gfilt_era_${gbrKey}`;
    } else if (contextPrefix.startsWith("ybr_")) {
      const ybrKey = contextPrefix.replace("ybr_", "");
      toggleCb = `yfilt_tog_${ybrKey}`;
      fskCb = `yfilt_fsk_${ybrKey}`;
      genreCb = `yfilt_gen_${ybrKey}`;
      eraCb = `yfilt_era_${ybrKey}`;
    }

    return [
      [
        {
          text: isFilterOn ? "✅ Filter: Aktiv" : "⬜ Filter: Aus",
          callback_data: toggleCb
        },
        {
          text: `${fskCount > 0 ? "✅" : "☑️"} FSK (${fskCount > 0 ? fskCount : "Alle"})`,
          callback_data: fskCb
        }
      ],
      [
        {
          text: `${genreCount > 0 ? "✅" : "☑️"} Genres (${genreCount > 0 ? genreCount : "Alle"})`,
          callback_data: genreCb
        },
        {
          text: `${eraCount > 0 ? "✅" : "☑️"} Jahre (${eraCount > 0 ? eraCount : "Alle"})`,
          callback_data: eraCb
        }
      ]
    ];
  }

  // Hilfsfunktion für den Rückkehr-Button aus den Filter-Dashboards zur aktiven Ansicht
  async function getFilterReturnButton(env, chatId, fromSearch = false) {
    const activeCtx = memoryFallback.get(`active_list_ctx_${chatId}`);
    const activeColId = memoryFallback.get(`active_col_${chatId}`);
    const searchState = await getSearchState(env, chatId);

    if (activeCtx) {
      if (activeCtx.type === "col") {
        return [{ text: "🍿 Filter anwenden & zur Filmreihe", callback_data: `col_${activeCtx.id}_m_` }];
      }
      if (activeCtx.type === "uni") {
        return [{ text: "🌌 Filter anwenden & zum Universum", callback_data: `uni_${activeCtx.id}_1` }];
      }
      if (activeCtx.type === "per") {
        return [{ text: "👤 Filter anwenden & zur Filmografie", callback_data: `pcred_${activeCtx.id}_1_m_` }];
      }
      if (activeCtx.type === "gbr") {
        return [{ text: "🎞️ Filter anwenden & zur Genre-Liste", callback_data: `gbrowse_${activeCtx.id}` }];
      }
      if (activeCtx.type === "ybr") {
        return [{ text: "🗓️ Filter anwenden & zur Jahres-Liste", callback_data: `ybrowse_${activeCtx.id}` }];
      }
    }
    if (activeColId) {
      return [{ text: "🍿 Filter anwenden & zur Filmreihe", callback_data: `col_${activeColId}_m_` }];
    }
    if (fromSearch || (searchState && searchState.query)) {
      const shortQ = searchState?.query ? (searchState.query.length > 18 ? searchState.query.slice(0, 17) + "…" : searchState.query) : "Suche";
      return [{ text: `🔍 Filter anwenden & zur Suche ("${shortQ}")`, callback_data: "back_to_search" }];
    }
    return null;
  }

  async function showSettingsOverview(env, chatId, messageId = null, returnContext = null) {
    const { sendMessage, editMessageText } = tgApi(env);
    const settings = await getUserSettings(env, chatId);

    const incGenresText = (settings.includedGenres || []).join(", ");
    const excGenresText = (settings.excludedGenres || []).join(", ");
    const genresSummary = incGenresText
      ? `🟢 Nur: ${incGenresText}${excGenresText ? ` | ❌ Ohne: ${excGenresText}` : ""}`
      : (excGenresText ? `❌ Ohne: ${excGenresText}` : "Alle erlaubt");

    const excludedFskText = settings.excludedFsk && settings.excludedFsk.length > 0
      ? `❌ Ohne: ${settings.excludedFsk.map(f => formatFskCompact(f)).join(", ")}`
      : "Alle erlaubt";
    const excludedErasText = settings.excludedEras && settings.excludedEras.length > 0
      ? `❌ Ohne: ${settings.excludedEras.map(id => ERA_OPTIONS.find(e => e.id === id)?.label || id).join(", ")}`
      : "Alle erlaubt";
    const incStudiosText = (settings.includedStudios || []).map(id => STUDIO_OPTIONS.find(s => s.id === id)?.label || id).join(", ");
    const excStudiosText = (settings.excludedStudios || []).map(id => STUDIO_OPTIONS.find(s => s.id === id)?.label || id).join(", ");
    const studiosSummary = incStudiosText
      ? `🟢 Nur: ${incStudiosText}${excStudiosText ? ` | ❌ Ohne: ${excStudiosText}` : ""}`
      : (excStudiosText ? `❌ Ohne: ${excStudiosText}` : "Alle erlaubt");

    const incPlatformsText = (settings.includedPlatforms || []).map(id => PLATFORM_OPTIONS.find(p => p.id === id)?.label || id).join(", ");
    const excPlatformsText = (settings.excludedPlatforms || []).map(id => PLATFORM_OPTIONS.find(p => p.id === id)?.label || id).join(", ");
    const platformsSummary = incPlatformsText
      ? `🟢 Nur: ${incPlatformsText}${excPlatformsText ? ` | ❌ Ohne: ${excPlatformsText}` : ""}`
      : (excPlatformsText ? `❌ Ohne: ${excPlatformsText}` : "Alle erlaubt");

    const isFilterActive = settings.filtersActive !== false;
    const filterToggleText = isFilterActive ? "🟢 Filter AKTIV (Umschalten)" : "🔴 Filter INAKTIV (Umschalten)";
    const showUnreleased = Boolean(settings.showUnreleased);
    const unreleasedToggleText = showUnreleased
      ? "🗓️ Unreleased: 🟢 SICHTBAR (Ausblenden)"
      : "🗓️ Unreleased: 🔴 AUSGEBLENDET (Aktivieren)";

    const text =
      `⚙️ *FILTER & EINSTELLUNGEN*\n` +
      `🛡️ *Status:* ${isFilterActive ? "🟢 Aktiviert" : "🔴 Deaktiviert"}\n` +
      `🗓️ *Unveröffentlichte Titel:* ${showUnreleased ? "🟢 Werden angezeigt" : "🔴 Ausgeblendet (Standard)"}\n` +
      `${SEP}\n` +
      `🎛️ *EINGESCHLOSSENE (🟢) & AUSGESCHLOSSENE (❌) FILTER*\n` +
      `🔞 *FSK:* ${escapeMd(excludedFskText)}\n` +
      `🎞️ *Genres:* ${escapeMd(genresSummary)}\n` +
      `📅 *Epochen:* ${escapeMd(excludedErasText)}\n` +
      `🏢 *Filmstudios:* ${escapeMd(studiosSummary)}\n` +
      `📺 *Plattformen:* ${escapeMd(platformsSummary)}`;

    const inline_keyboard = [
      [{ text: filterToggleText, callback_data: "toggle_global_filters" }],
      [{ text: unreleasedToggleText, callback_data: "toggle_unreleased" }],
      [
        { text: "🔞 FSK-Stufen", callback_data: "open_fsk_dash" },
        { text: "🎞️ Genres (🟢/❌)", callback_data: "open_genre_dash" }
      ],
      [
        { text: "🏢 Filmstudios (🟢/❌)", callback_data: "open_studio_dash" },
        { text: "📺 Plattformen (🟢/❌)", callback_data: "open_platform_dash" }
      ],
      [{ text: "📅 Erscheinungsjahre / Epochen", callback_data: "open_era_dash" }]
    ];

    const retBtn = await getFilterReturnButton(env, chatId, returnContext === "search");
    if (retBtn) inline_keyboard.push(retBtn);

    inline_keyboard.push(buildFooterRow(chatId, true));

    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard } });
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, { reply_markup: { inline_keyboard } });
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  async function showFskDashboard(env, chatId, messageId = null, fromSearch = false) {
    const { sendMessage, editMessageText } = tgApi(env);
    const settings = await getUserSettings(env, chatId);

    const text =
      `🔞 *FSK-FILTER COCKPIT*\n` +
      `${SEP}\n` +
      `✅ = Erlaubt  •  ❌ = Gesperrt`;

    const keyboard = FSK_OPTIONS.map(fsk => {
      const isExcluded = (settings.excludedFsk || []).includes(fsk);
      const icon = isExcluded ? "❌" : "✅";
      const label = formatFskCompact(fsk);
      return [{ text: `${icon} ${label}`, callback_data: `toggle_fsk_${fsk}` }];
    });

    const retBtn = await getFilterReturnButton(env, chatId, fromSearch);
    if (retBtn) keyboard.push(retBtn);

    keyboard.push([{ text: "⚙️ Filter-Übersicht", callback_data: "settings_menu" }]);
    keyboard.push(buildFooterRow(chatId, true));

    if (messageId) {
      await editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      await setActiveMenu(env, chatId, messageId);
    } else {
      const sent = await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
      if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
    }
  }

  async function showGenreDashboard(env, chatId, messageId = null, fromSearch = false) {
    const { sendMessage, editMessageText } = tgApi(env);
    const settings = await getUserSettings(env, chatId);
    const allGenres = Array.from(new Set([...Object.keys(MOVIE_GENRES), ...Object.keys(SERIES_GENRES)]));

    const text =
      `🎞️ *GENRE-FILTER COCKPIT (INCLUDE / EXCLUDE)*\n` +
      `${SEP}\n` +
      `Tippe mehrfach zum Umschalten:\n` +
      `⚪ = Alle (Standard)\n` +
      `🟢 = *Include* (Eingeschlossen)\n` +
      `❌ = *Exclude* (Ausgeschlossen / Gesperrt)`;

    const keyboard = [];
    for (let i = 0; i < allGenres.length; i += 2) {
      const row = [];
      for (const g of allGenres.slice(i, i + 2)) {
        const isInc = (settings.includedGenres || []).includes(g);
        const isExc = (settings.excludedGenres || []).includes(g);
        const icon = isInc ? "🟢" : isExc ? "❌" : "⚪";
        const emoji = getGenreEmoji(g);
        row.push({ text: `${icon} ${emoji} ${g}`, callback_data: `toggle_genre_${g}` });
      }
      keyboard.push(row);
    }

    const retBtn = await getFilterReturnButton(env, chatId, fromSearch);
    if (retBtn) keyboard.push(retBtn);

    keyboard.push([{ text: "⚙️ Filter-Übersicht", callback_data: "settings_menu" }]);
    keyboard.push(buildFooterRow(chatId, true));

    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  async function showStudioDashboard(env, chatId, messageId = null, fromSearch = false) {
    const { sendMessage, editMessageText } = tgApi(env);
    const settings = await getUserSettings(env, chatId);

    const text =
      `🏢 *FILMSTUDIOS FILTER (INCLUDE / EXCLUDE)*\n` +
      `${SEP}\n` +
      `Tippe mehrfach zum Umschalten:\n` +
      `⚪ = Alle (Standard)\n` +
      `🟢 = *Include* (Nur ausgewählte Studios zeigen)\n` +
      `❌ = *Exclude* (Dieses Studio komplett sperren)`;

    const keyboard = [];
    for (let i = 0; i < STUDIO_OPTIONS.length; i += 2) {
      const row = [];
      for (const st of STUDIO_OPTIONS.slice(i, i + 2)) {
        const isInc = (settings.includedStudios || []).includes(st.id);
        const isExc = (settings.excludedStudios || []).includes(st.id);
        const icon = isInc ? "🟢" : isExc ? "❌" : "⚪";
        row.push({ text: `${icon} ${st.icon || st.emoji || "🏢"} ${st.label}`, callback_data: `toggle_studio_${st.id}` });
      }
      keyboard.push(row);
    }

    const retBtn = await getFilterReturnButton(env, chatId, fromSearch);
    if (retBtn) keyboard.push(retBtn);

    keyboard.push([{ text: "⚙️ Filter-Übersicht", callback_data: "settings_menu" }]);
    keyboard.push(buildFooterRow(chatId, true));

    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  async function showPlatformDashboard(env, chatId, messageId = null, fromSearch = false) {
    const { sendMessage, editMessageText } = tgApi(env);
    const settings = await getUserSettings(env, chatId);

    const text =
      `📺 *STREAMING-PLATTFORMEN (INCLUDE / EXCLUDE)*\n` +
      `${SEP}\n` +
      `Tippe mehrfach zum Umschalten:\n` +
      `⚪ = Alle (Standard)\n` +
      `🟢 = *Include* (Nur auf diesen Plattformen)\n` +
      `❌ = *Exclude* (Plattform ausschließen)`;

    const keyboard = [];
    for (let i = 0; i < PLATFORM_OPTIONS.length; i += 2) {
      const row = [];
      for (const pl of PLATFORM_OPTIONS.slice(i, i + 2)) {
        const isInc = (settings.includedPlatforms || []).includes(pl.id);
        const isExc = (settings.excludedPlatforms || []).includes(pl.id);
        const icon = isInc ? "🟢" : isExc ? "❌" : "⚪";
        row.push({ text: `${icon} ${pl.icon || pl.emoji || "📺"} ${pl.label}`, callback_data: `toggle_platform_${pl.id}` });
      }
      keyboard.push(row);
    }

    const retBtn = await getFilterReturnButton(env, chatId, fromSearch);
    if (retBtn) keyboard.push(retBtn);

    keyboard.push([{ text: "⚙️ Filter-Übersicht", callback_data: "settings_menu" }]);
    keyboard.push(buildFooterRow(chatId, true));

    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  async function showEraDashboard(env, chatId, messageId = null, fromSearch = false) {
    const { sendMessage, editMessageText } = tgApi(env);
    const settings = await getUserSettings(env, chatId);

    const text =
      `📅 *JAHRE & EPOCHEN FILTER*\n` +
      `${SEP}\n` +
      `✅ = Erlaubt  •  ❌ = Gesperrt`;

    const keyboard = ERA_OPTIONS.map(era => {
      const isExcluded = (settings.excludedEras || []).includes(era.id);
      const icon = isExcluded ? "❌" : "✅";
      return [{ text: `${icon} ${era.label}`, callback_data: `toggle_era_${era.id}` }];
    });

    const retBtn = await getFilterReturnButton(env, chatId, fromSearch);
    if (retBtn) keyboard.push(retBtn);

    keyboard.push([{ text: "⚙️ Filter-Übersicht", callback_data: "settings_menu" }]);
    keyboard.push(buildFooterRow(chatId, true));

    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // @ANCHOR: GENRE_DISCOVERY
  // ============================================================================
  // FILM / SERIE EMPFEHLEN: ZWISCHENOPTION MIT ENTDECKER-LISTEN & GENRE-HUB
  // Genres oben, Entdecker-Buttons (Populär, Trending usw.) unten + 60s Auto-Zufall
  // ============================================================================
  async function showGenres(env, chatId, typeCode = "m", messageId = null) {
    const { sendMessage, editMessageText } = tgApi(env);
    const isMovie = typeCode === "m";
    const typeText = isMovie ? "🎬 *FILME ENTDECKEN & GENRES*" : "📺 *SERIEN ENTDECKEN & GENRES*";
    const genresObj = isMovie ? MOVIE_GENRES : SERIES_GENRES;

    memoryFallback.set(`active_list_ctx_${chatId}`, { type: "genres_hub", typeCode });

    const text =
      `${typeText}\n` +
      `${SEP}\n` +
      `🎞️ *Wähle oben ein Genre* für Zufall & Genre-Listen:\n\n` +
      `✨ *Oder stöbere unten direkt (Alle Genres):*\n` +
      `Trending, Beliebt, Top Bewertet, Geheimtipps, Neuheiten oder Zufall.\n` +
      `⏳ _Ohne Auswahl öffnet sich nach 60 Sek. automatisch ein Zufalls-Tipp._`;

    const inline_keyboard = [];

    // 1. GENRES NACH OBEN (mit passenden Genre-Emojis)
    const entries = Object.entries(genresObj);
    for (let i = 0; i < entries.length; i += 2) {
      const row = [];
      for (const [label, id] of entries.slice(i, i + 2)) {
        const emoji = getGenreEmoji(label);
        row.push({ text: `${emoji} ${label}`, callback_data: `gsel_${typeCode}_${id}` });
      }
      inline_keyboard.push(row);
    }

    // 2. ENTDECKER-BUTTONS (TRENDING, BELIEBT, TOP, GEHEIMTIPPS, NEU, ZUFALL) NACH UNTEN
    inline_keyboard.push(
      [
        { text: "🔥 Trending", callback_data: `gbrowse_${typeCode}_all_trend_1` },
        { text: "🌟 Beliebt", callback_data: `gbrowse_${typeCode}_all_pop_1` }
      ],
      [
        { text: "🏆 Top Bewertet", callback_data: `gbrowse_${typeCode}_all_top_1` },
        { text: "💎 Geheimtipps", callback_data: `gbrowse_${typeCode}_all_gems_1` }
      ],
      [
        { text: isMovie ? "🆕 Neu im Kino / Digital" : "🆕 Neue Serien", callback_data: `gbrowse_${typeCode}_all_new_1` },
        { text: isMovie ? "🎲 Zufälliger Film" : "🎲 Zufällige Serie", callback_data: `g_${typeCode}_random_all` }
      ]
    );

    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard } };
    if (messageId) {
      await editMessageText(chatId, messageId, text, markup);
      await setActiveMenu(env, chatId, messageId);
    } else {
      const sent = await sendMessage(chatId, text, markup);
      if (sent && sent.result) {
        await setActiveMenu(env, chatId, sent.result.message_id);
      }
    }
  }

  // @ANCHOR: COLLECTION_UNIVERSE_DETAILS
  // ============================================================================
  // FILMREIHEN (COLLECTIONS): KLICKBARE TEXTLINKS + SORTIERUNG + ECHTE FSK-FILTERUNG
  // ============================================================================
  async function showCollectionDetails(env, chatId, collectionId, typeCode = "m", originItemId = "", messageId = null, sortOverride = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    const botUsername = await getBotUsername(env);
    const col = await fetchCollectionDetails(env, collectionId);
    memoryFallback.set(`active_col_${chatId}`, collectionId);

    // Prüfen, ob der Nutzer aus der Merkliste (Wunschliste -> Kollektion) kommt
    let fromWlFolder = null;
    if (typeCode === "wl") {
      fromWlFolder = originItemId || "cat_col";
      memoryFallback.set(`col_from_wl_${chatId}_${collectionId}`, fromWlFolder);
    } else if (originItemId) {
      const originCardCtx = memoryFallback.get(`card_origin_${chatId}_${typeCode}_${originItemId}`);
      if (originCardCtx === "saved" || (originCardCtx && originCardCtx.fromWishlist)) {
        fromWlFolder = (originCardCtx && originCardCtx.wlFolderId) || "cat_col";
        memoryFallback.set(`col_from_wl_${chatId}_${collectionId}`, fromWlFolder);
      } else {
        memoryFallback.delete(`col_from_wl_${chatId}_${collectionId}`);
      }
    } else if (!sortOverride) {
      fromWlFolder = memoryFallback.get(`col_from_wl_${chatId}_${collectionId}`) || null;
    } else {
      fromWlFolder = memoryFallback.get(`col_from_wl_${chatId}_${collectionId}`) || null;
    }

    memoryFallback.set(`active_list_ctx_${chatId}`, {
      type: "col",
      mode: "col",
      id: collectionId,
      originType: typeCode,
      originId: originItemId,
      fromWlFolder
    });

    if (!col || !col.parts || col.parts.length === 0) {
      const errText = `⚠️ *Filmreihe konnte nicht von TMDB geladen werden.*`;
      const errKb = {
        inline_keyboard: [
          ...(fromWlFolder ? [[{ text: "🔙 💾 Zurück zur Merkliste", callback_data: "wl_back" }]] : []),
          ...(originItemId && typeCode !== "wl" ? [[{ text: "🔙 Zurück zum Titel", callback_data: `sdet_${typeCode}_${originItemId}` }]] : []),
          [{ text: "🍿 Filmreihen stöbern", callback_data: "browse_collections" }],
          buildFooterRow(chatId, true)
        ]
      };
      if (messageId) await editMessageText(chatId, messageId, errText, { reply_markup: errKb });
      else await sendMessage(chatId, errText, { reply_markup: errKb });
      return;
    }

    memoryFallback.set(`col_name_${collectionId}`, col.name);

    const sortKey = `col_sort_${chatId}_${collectionId}`;
    const sortBy = sortOverride || memoryFallback.get(sortKey) || "year_asc";
    memoryFallback.set(sortKey, sortBy);

    const settings = await getUserSettings(env, chatId);
    const savedList = await getSavedList(env, chatId);
    const { visibleItems: visibleParts, isFiltered } = await filterAndSortMediaList(env, col.parts, settings, sortBy);

    // Sobald die Kollektion gefiltert wurde, heißt sie "<Filmkollektionname> (Filtered)"
    const effectiveColName = isFiltered ? `${col.name} (Filtered)` : col.name;
    const shareColLink = makeBotLink(botUsername, `shcol_${collectionId}`);

    let text =
      `🍿 *${escapeMd(effectiveColName)}*  •  [📤](${shareColLink})\n` +
      `📊 ${visibleParts.length} von ${col.parts.length} Filmen sichtbar` +
      (fromWlFolder ? ` • 💾 _Aus deiner Merkliste_` : "") + `\n` +
      `${SEP}\n\n`;

    if (visibleParts.length === 0) {
      text += `⚠️ *Keine Filme entsprechen den aktiven Filtern.*\nPasse unten die Filter an, um Filme zu sehen.\n\n`;
    } else {
      visibleParts.forEach((part) => {
        const partTitle = (part.title || part.name || "Unbekannt").trim();
        const rawYear = (part.release_date || "").split("-")[0] || "K.A.";
        const vote = part.vote_average ? `${Math.round(part.vote_average * 10) / 10}` : "–";

        memoryFallback.set(`title_cache_m_${part.id}`, `${partTitle} (${rawYear})`);

        // fcolwl_ merkt sich zusätzlich, dass der Nutzer ursprünglich von der Merkliste -> Kollektion -> Film kam!
        const startCode = fromWlFolder
          ? `fcolwl_${collectionId}_${part.id}`
          : `fcol_${collectionId}_${part.id}`;
        const detailLink = makeBotLink(botUsername, startCode, `https://www.themoviedb.org/movie/${part.id}?language=de-DE`);
        const saveLink = makeBotLink(botUsername, `csv_${collectionId}_${part.id}`);
        const whereLink = makeBotLink(botUsername, `ws_m_${part.id}`);

        const isSaved = savedList.some(i => String(i.tmdbId) === String(part.id) && i.contentType !== "episode");
        const saveIconText = isSaved ? "💾 In Merkliste" : "💾 Speichern";

        const gNames = (part.genre_ids || []).slice(0, 2).map(id => ALL_GENRE_ID_TO_NAME[id]).filter(Boolean).join(", ") || "Film";
        const fskBadge = part.fsk ? ` • 🔞 ${escapeMd(formatFskCompact(part.fsk))}` : "";

        text +=
          `🎬 *[${escapeMd(partTitle)}](${detailLink})* (${rawYear}) • ⭐ ${vote}${fskBadge}\n` +
          `🎞️ ${escapeMd(gNames)}  •  [${saveIconText}](${saveLink})  •  [🔍](${whereLink})\n\n`;
      });
    }

    const inline_keyboard = [
      buildSortRow(sortBy, `csort_${collectionId}`),
      ...buildQuickFilterRows(settings, `col_${collectionId}`)
    ];

    if (visibleParts.length > 0) {
      inline_keyboard.push([
        { text: `💾 Alle ${visibleParts.length} sichtbaren speichern`, callback_data: `saveall_col_${collectionId}_${typeCode}_${originItemId}` },
        { text: "📤 Reihe teilen", switch_inline_query: `share_col_${collectionId}` }
      ]);
    }

    const effectiveColWebAppBase = String(env.WEBAPP_URL || env.WEBHOOK_URL || "https://teleport.sonhartmann-1997.workers.dev/").replace(/\/$/, "");
    if (effectiveColWebAppBase && !isGroupOrChannelChat(chatId)) {
      const signedColUrl = await buildSignedWebAppUrl(env, effectiveColWebAppBase, chatId, { openCol: collectionId });
      inline_keyboard.push([
        { text: "🍿 Reihe in Mini-App öffnen", web_app: { url: signedColUrl } }
      ]);
    }

    const navRow = [];
    if (fromWlFolder) {
      navRow.push({ text: "🔙 💾 Zurück zur Merkliste", callback_data: "wl_back" });
      if (originItemId && typeCode !== "wl") {
        navRow.push({ text: "🔙 Zurück zum Film", callback_data: `sdet_${typeCode}_${originItemId}` });
      } else {
        navRow.push({ text: "🍿 Mehr Filmreihen", callback_data: "browse_collections" });
      }
    } else {
      if (originItemId) {
        navRow.push({ text: "🔙 Zurück zum Film", callback_data: `sdet_${typeCode}_${originItemId}` });
      } else {
        navRow.push({ text: "🍿 Mehr Filmreihen", callback_data: "browse_collections" });
      }
      navRow.push({ text: "💾 Merkliste", callback_data: "show_saved" });
    }
    inline_keyboard.push(navRow);
    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // ============================================================================
  // FILMUNIVERSUM DETAILANSICHT (mit Sortierung, FSK-Filter & Ordner-Speicherung)
  // ============================================================================
  async function showUniverseDetails(env, chatId, universeId, page = 1, messageId = null, sortOverride = null, fromWlOverride = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    const botUsername = await getBotUsername(env);
    const uni = await fetchUniverseDetails(env, universeId);

    if (fromWlOverride !== null) {
      if (fromWlOverride) memoryFallback.set(`uni_from_wl_${chatId}_${universeId}`, fromWlOverride);
      else memoryFallback.delete(`uni_from_wl_${chatId}_${universeId}`);
    }
    const fromWlFolder = memoryFallback.get(`uni_from_wl_${chatId}_${universeId}`) || null;

    memoryFallback.set(`active_list_ctx_${chatId}`, { type: "uni", mode: "uni", id: universeId, page, fromWlFolder });

    if (!uni || !uni.parts || uni.parts.length === 0) {
      const errText = `⚠️ *Filmuniversum konnte nicht geladen werden.*`;
      const errKb = {
        inline_keyboard: [
          ...(fromWlFolder ? [[{ text: "🔙 💾 Zurück zur Merkliste", callback_data: "wl_back" }]] : []),
          [{ text: "🌌 Zurück zu Filmuniversen", callback_data: "browse_universes" }],
          buildFooterRow(chatId, true)
        ]
      };
      if (messageId) await editMessageText(chatId, messageId, errText, { reply_markup: errKb });
      else await sendMessage(chatId, errText, { reply_markup: errKb });
      return;
    }

    memoryFallback.set(`uni_name_${universeId}`, uni.name);

    const sortKey = `uni_sort_${chatId}_${universeId}`;
    const sortBy = sortOverride || memoryFallback.get(sortKey) || "year_asc";
    memoryFallback.set(sortKey, sortBy);

    const settings = await getUserSettings(env, chatId);
    const savedList = await getSavedList(env, chatId);
    const { visibleItems, isFiltered } = await filterAndSortMediaList(env, uni.parts, settings, sortBy);

    const perPage = 8;
    const totalPages = Math.max(1, Math.ceil(visibleItems.length / perPage));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const slice = visibleItems.slice((currentPage - 1) * perPage, currentPage * perPage);

    const effectiveUniName = isFiltered ? `${uni.name} (Filtered)` : uni.name;

    let text =
      `${uni.icon || "🌌"} *${escapeMd(effectiveUniName.toUpperCase())}*\n` +
      `📊 ${visibleItems.length} von ${uni.parts.length} Filmen sichtbar • 📄 Seite ${currentPage}/${totalPages}` +
      (fromWlFolder ? ` • 💾 _Aus deiner Merkliste_` : "") + `\n` +
      `${SEP}\n\n`;

    if (slice.length === 0) {
      text += `⚠️ *Keine Filme entsprechen den aktiven Filtern.*\nPasse unten die Filter an, um Filme zu sehen.\n\n`;
    } else {
      slice.forEach((part) => {
        const partTitle = (part.title || part.name || "Unbekannt").trim();
        const rawYear = (part.release_date || "").split("-")[0] || "K.A.";
        const vote = part.vote_average ? `${Math.round(part.vote_average * 10) / 10}` : "–";

        memoryFallback.set(`title_cache_m_${part.id}`, `${partTitle} (${rawYear})`);

        // funiwl_ merkt sich, dass der Nutzer von der Merkliste -> Universum -> Film kam!
        const startCode = fromWlFolder
          ? `funiwl_${universeId}_${currentPage}_${part.id}`
          : `funi_${universeId}_${currentPage}_${part.id}`;
        const detailLink = makeBotLink(botUsername, startCode, `https://www.themoviedb.org/movie/${part.id}?language=de-DE`);
        const saveLink = makeBotLink(botUsername, `qsv_m_${part.id}`);
        const whereLink = makeBotLink(botUsername, `ws_m_${part.id}`);

        const isSaved = savedList.some(i => String(i.tmdbId) === String(part.id) && i.contentType !== "episode");
        const saveIconText = isSaved ? "💾 In Merkliste" : "💾 Speichern";
        const gNames = (part.genre_ids || []).slice(0, 2).map(id => ALL_GENRE_ID_TO_NAME[id]).filter(Boolean).join(", ") || "Film";
        const fskBadge = part.fsk ? ` • 🔞 ${escapeMd(formatFskCompact(part.fsk))}` : "";

        text +=
          `🎬 *[${escapeMd(partTitle)}](${detailLink})* (${rawYear}) • ⭐ ${vote}${fskBadge}\n` +
          `🎞️ ${escapeMd(gNames)}  •  [${saveIconText}](${saveLink})  •  [🔍](${whereLink})\n\n`;
      });
    }

    const inline_keyboard = [];
    inline_keyboard.push(buildSortRow(sortBy, `usort_${universeId}_${currentPage}`));

    inline_keyboard.push(
      buildPaginationRow(currentPage, totalPages, `uni_${universeId}_${currentPage - 1}`, `uni_${universeId}_${currentPage + 1}`)
    );

    inline_keyboard.push(...buildQuickFilterRows(settings, `uni_${universeId}`));

    if (visibleItems.length > 0) {
      inline_keyboard.push([
        { text: `💾 Alle ${visibleItems.length} sichtbaren speichern`, callback_data: `saveall_uni_${universeId}` },
        { text: "📤 Universum teilen", switch_inline_query: `share_uni_${universeId}` }
      ]);
    }

    const effectiveUniWebAppBase = String(env.WEBAPP_URL || env.WEBHOOK_URL || "https://teleport.sonhartmann-1997.workers.dev/").replace(/\/$/, "");
    if (effectiveUniWebAppBase && !isGroupOrChannelChat(chatId)) {
      const signedUniUrl = await buildSignedWebAppUrl(env, effectiveUniWebAppBase, chatId, { openUni: universeId });
      inline_keyboard.push([
        { text: "🌌 Universum in Mini-App öffnen", web_app: { url: signedUniUrl } }
      ]);
    }

    if (fromWlFolder) {
      inline_keyboard.push([
        { text: "🔙 💾 Zurück zur Merkliste", callback_data: "wl_back" },
        { text: "🌌 Alle Universen", callback_data: "browse_universes" }
      ]);
    } else {
      inline_keyboard.push([
        { text: "🌌 Alle Universen", callback_data: "browse_universes" },
        { text: "💾 Merkliste", callback_data: "show_saved" }
      ]);
    }
    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // Auswahlmenü für angeklickte Schauspieler oder Regie (ohne copy_text Crash!)
  async function showPersonActionMenu(env, chatId, personId, typeCode = "m", originItemId = "", messageId = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    const botUsername = await getBotUsername(env);

    let personName = memoryFallback.get(`person_name_${personId}`) || "";
    let totalCredits = 0;
    const pData = await fetchPersonDetails(env, personId);
    if (pData) {
      if (pData.name) {
        personName = pData.name;
        memoryFallback.set(`person_name_${personId}`, personName);
      }
      totalCredits = (pData.credits || []).length;
    }
    if (!personName) personName = `Person #${personId}`;

    const tgSearchUrl = `tg://search?query=${safeEncodeParam(personName)}`;
    const tmdbPersonUrl = `https://www.themoviedb.org/person/${personId}?language=de-DE`;
    const creditsLink = makeBotLink(botUsername, `pcr_${personId}_1`);

    const text =
      `👤 *${escapeMd(personName)}*\n` +
      `📋 *Kopieren (antippen):* \`${personName.replace(/`/g, "'")}\`\n` +
      `🎬 *Bekannte Titel:* ${totalCredits}\n` +
      `${SEP}\n` +
      `▸ 🎬 *[Alle ${totalCredits} Titel im Bot anzeigen](${creditsLink})*\n` +
      `▸ 🔎 *[In Telegram suchen](${tgSearchUrl})*\n` +
      `▸ 🌐 *[Direkt bei TMDB öffnen](${tmdbPersonUrl})*`;

    const inline_keyboard = [
      [
        { text: `🎬 Alle ${totalCredits} Titel zeigen`, callback_data: `pcred_${personId}_1_${typeCode}_${originItemId}` },
        { text: `💾 Alle speichern`, callback_data: `saveall_per_${personId}_${typeCode}_${originItemId}` }
      ],
      [
        { text: "🔎 Telegram", url: tgSearchUrl },
        { text: "🌐 TMDB", url: tmdbPersonUrl },
        { text: "📤 Teilen", switch_inline_query: personName }
      ]
    ];

    const effectivePerWebAppBase = String(env.WEBAPP_URL || env.WEBHOOK_URL || "https://teleport.sonhartmann-1997.workers.dev/").replace(/\/$/, "");
    if (effectivePerWebAppBase && !isGroupOrChannelChat(chatId)) {
      const signedPerUrl = await buildSignedWebAppUrl(env, effectivePerWebAppBase, chatId, { openPerson: personId });
      inline_keyboard.push([
        { text: "🍿 Person in Mini-App öffnen", web_app: { url: signedPerUrl } }
      ]);
    }

    if (originItemId) {
      inline_keyboard.push([{ text: "🔙 Zurück zum Titel", callback_data: `sdet_${typeCode}_${originItemId}` }]);
    } else {
      inline_keyboard.push([{ text: "🔙 Zurück", callback_data: "main_menu" }]);
    }
    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard } };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // Erweiterte Auswahl für angeklickte Genres (sowohl aus der Detailansicht als auch aus dem Empfehlen-Menü!)
  async function showGenreActionMenu(env, chatId, genreId, typeCode = "m", originItemId = "", messageId = null) {
    const { sendMessage, editMessageText } = tgApi(env);

    const isMovie = typeCode === "m";
    const genresObj = isMovie ? MOVIE_GENRES : SERIES_GENRES;
    let genreName = memoryFallback.get(`genre_name_${genreId}`) ||
      Object.entries(genresObj).find(([, id]) => String(id) === String(genreId))?.[0] ||
      ALL_GENRE_ID_TO_NAME[genreId] ||
      `Genre #${genreId}`;
    memoryFallback.set(`genre_name_${genreId}`, genreName);
    memoryFallback.set(`active_list_ctx_${chatId}`, { type: "genre_action", typeCode, genreId, originItemId });

    const typeLabelPlural = isMovie ? "Filme" : "Serien";
    const tgSearchUrl = `tg://search?query=${safeEncodeParam(genreName)}`;
    const tmdbGenreUrl = isMovie
      ? `https://www.themoviedb.org/genre/${genreId}/movie?language=de-DE`
      : `https://www.themoviedb.org/genre/${genreId}/tv?language=de-DE`;

    const text =
      `🎞️ *GENRE: ${escapeMd(genreName.toUpperCase())}*\n` +
      `📋 *Kopieren (antippen):* \`${genreName.replace(/`/g, "'")}\`\n` +
      `${SEP}\n` +
      `Wähle eine Option für *${escapeMd(genreName)}-${typeLabelPlural}*:\n` +
      `▸ 🎲 Zufallstipp im Bot\n` +
      `▸ 🔥 Trending • 🌟 Beliebt • 🆕 Neueste\n` +
      `▸ 🏆 Top Bewertet • 💎 Geheimtipps\n` +
      `▸ 🔎 [In Telegram suchen](${tgSearchUrl})  •  🌐 [TMDB](${tmdbGenreUrl})\n` +
      `⏳ _Ohne Auswahl öffnet sich nach 60 Sek. automatisch ein Zufalls-Tipp._`;

    const inline_keyboard = [
      [{ text: `🎲 Zufalls-${isMovie ? "Film" : "Serie"} (${genreName})`, callback_data: `g_${typeCode}_${genreId}` }],
      [
        { text: `🔥 Trending`, callback_data: `gbrowse_${typeCode}_${genreId}_trend_1` },
        { text: `🌟 Beliebt`, callback_data: `gbrowse_${typeCode}_${genreId}_pop_1` }
      ],
      [
        { text: `🆕 Neueste`, callback_data: `gbrowse_${typeCode}_${genreId}_new_1` },
        { text: `🏆 Top Bewertet`, callback_data: `gbrowse_${typeCode}_${genreId}_top_1` }
      ],
      [
        { text: `💎 Geheimtipps`, callback_data: `gbrowse_${typeCode}_${genreId}_gems_1` }
      ],
      [
        { text: "🔎 Telegram", url: tgSearchUrl },
        { text: "🌐 TMDB", url: tmdbGenreUrl }
      ]
    ];

    if (originItemId) {
      inline_keyboard.push([
        { text: "🔙 Zurück zum Titel", callback_data: `sdet_${typeCode}_${originItemId}` },
        { text: `🎞️ Alle ${typeLabelPlural}-Genres`, callback_data: `type_${typeCode}` }
      ]);
    } else {
      inline_keyboard.push([{ text: `🔙 Zurück zur Genre-Auswahl`, callback_data: `type_${typeCode}` }]);
    }
    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) {
      await setActiveMenu(env, chatId, sent.result.message_id);
    }
  }

  // ============================================================================
  // GENRE- & ENTDECKER-LISTENANSICHT (Trending, Beliebt, Neueste, Top, Geheimtipps)
  // ============================================================================
  async function showGenreBrowseList(env, chatId, typeCode, genreId, mode = "trend", page = 1, messageId = null, sortOverride = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    const botUsername = await getBotUsername(env);
    const isMovie = typeCode === "m";
    const genresObj = isMovie ? MOVIE_GENRES : SERIES_GENRES;
    const isAllGenres = String(genreId) === "all";
    const genreName = isAllGenres
      ? (isMovie ? "Alle Filme" : "Alle Serien")
      : (memoryFallback.get(`genre_name_${genreId}`) ||
        Object.entries(genresObj).find(([, id]) => String(id) === String(genreId))?.[0] ||
        ALL_GENRE_ID_TO_NAME[genreId] ||
        `Genre #${genreId}`);

    const ctxKey = `${typeCode}_${genreId}_${mode}_${page}`;
    memoryFallback.set(`active_list_ctx_${chatId}`, { type: "gbr", id: ctxKey });

    const sortKey = `gbr_sort_${chatId}_${typeCode}_${genreId}_${mode}`;
    const defaultSort = mode === "new" ? "year_desc" : (mode === "top" || mode === "gems") ? "rating_desc" : "pop_desc";
    const sortBy = sortOverride || memoryFallback.get(sortKey) || defaultSort;
    memoryFallback.set(sortKey, sortBy);

    const settings = await getUserSettings(env, chatId);
    const lookaheadRes = await fetchFilteredDiscoverWithLookahead(env, typeCode, genreId, mode, page, sortBy, settings, 10);
    const savedList = await getSavedList(env, chatId);

    const visibleItems = (lookaheadRes?.items || []).slice(0, 10);
    const totalPages = lookaheadRes?.total_pages || 1;
    const currentPage = lookaheadRes?.current_page || page;

    const modeTitleMap = {
      new: `🆕 *NEUESTE ${escapeMd(genreName.toUpperCase())}*`,
      trend: `🔥 *TRENDING ${escapeMd(genreName.toUpperCase())}*`,
      pop: `🌟 *BELIEBTE ${escapeMd(genreName.toUpperCase())}*`,
      top: `🏆 *TOP BEWERTET: ${escapeMd(genreName.toUpperCase())}*`,
      gems: `💎 *GEHEIMTIPPS: ${escapeMd(genreName.toUpperCase())}*`
    };
    const modeTitle = modeTitleMap[mode] || modeTitleMap.trend;

    let text =
      `${modeTitle}\n` +
      `📊 ${visibleItems.length} Treffer auf Seite ${currentPage}/${totalPages}\n` +
      `${SEP}\n\n`;

    if (visibleItems.length === 0) {
      text += `⚠️ *Keine Titel auf dieser Seite entsprechen deinen Filtern.*\nPasse unten die Filter an oder blättere weiter.\n\n`;
    } else {
      visibleItems.slice(0, 10).forEach((item) => {
        const title = (item.title || item.name || "Unbekannt").trim();
        const rawYear = (item.release_date || item.first_air_date || "").split("-")[0] || "K.A.";
        const icon = isMovie ? "🎬" : "📺";
        const vote = item.vote_average ? `${Math.round(item.vote_average * 10) / 10}` : "–";
        const isSaved = savedList.some(i => String(i.tmdbId) === String(item.id) && i.contentType !== "episode");
        const saveLabel = isSaved ? "💾 In Merkliste" : "💾 Speichern";

        memoryFallback.set(`title_cache_${typeCode}_${item.id}`, `${title} (${rawYear})`);

        const detailLink = makeBotLink(botUsername, `sdet_${typeCode}_${item.id}`);
        const saveLink = makeBotLink(botUsername, `qsv_${typeCode}_${item.id}`);
        const whereLink = makeBotLink(botUsername, `ws_${typeCode}_${item.id}`);
        const fskBadge = item.fsk ? ` • 🔞 ${escapeMd(formatFskCompact(item.fsk))}` : "";

        text +=
          `${icon} *[${escapeMd(title)}](${detailLink})* (${rawYear}) • ⭐ ${vote}${fskBadge}\n` +
          `   [${saveLabel}](${saveLink})  •  [🔍](${whereLink})\n\n`;
      });
    }

    const inline_keyboard = [];
    // Schnell-Umschalter zwischen 🎬 Filme (f) und 📺 Serien (s) im selben Modus
    inline_keyboard.push([
      { text: isMovie ? "🎬 Filme •" : "🎬 Zu Filmen wechseln", callback_data: `gbrowse_m_all_${mode}_1` },
      { text: !isMovie ? "📺 Serien •" : "📺 Zu Serien wechseln", callback_data: `gbrowse_s_all_${mode}_1` }
    ]);
    inline_keyboard.push(buildSortRow(sortBy, `gsort_${typeCode}_${genreId}_${mode}_${currentPage}`));

    inline_keyboard.push(
      buildPaginationRow(
        currentPage,
        totalPages,
        `gbrowse_${typeCode}_${genreId}_${mode}_${currentPage - 1}`,
        `gbrowse_${typeCode}_${genreId}_${mode}_${currentPage + 1}`
      )
    );

    // Modus-Schnellwahl (inkl. 🌟 Beliebt; nochmaliges Tippen auf den aktiven Modus kehrt die Sortierreihenfolge um!)
    inline_keyboard.push([
      { text: mode === "trend" ? "🔥 Trending •" : "🔥 Trending", callback_data: `gbrowse_${typeCode}_${genreId}_trend_1` },
      { text: mode === "pop" ? "🌟 Beliebt •" : "🌟 Beliebt", callback_data: `gbrowse_${typeCode}_${genreId}_pop_1` },
      { text: mode === "new" ? "🆕 Neueste •" : "🆕 Neueste", callback_data: `gbrowse_${typeCode}_${genreId}_new_1` }
    ]);
    inline_keyboard.push([
      { text: mode === "top" ? "🏆 Top •" : "🏆 Top", callback_data: `gbrowse_${typeCode}_${genreId}_top_1` },
      { text: mode === "gems" ? "💎 Geheimtipps •" : "💎 Geheimtipps", callback_data: `gbrowse_${typeCode}_${genreId}_gems_1` },
      { text: `🎲 Zufall (${isAllGenres ? (isMovie ? "Film" : "Serie") : genreName})`, callback_data: `g_${typeCode}_${isAllGenres ? "random_all" : genreId}` }
    ]);

    inline_keyboard.push(...buildQuickFilterRows(settings, `gbr_${ctxKey}`));
    if (isAllGenres) {
      inline_keyboard.push([{ text: `🔙 Zurück zu ${isMovie ? "Filme" : "Serien"} & Genres`, callback_data: `type_${typeCode}` }]);
    } else {
      inline_keyboard.push([
        { text: `🔙 Genre (${genreName})`, callback_data: `gen_${genreId}_${typeCode}_` },
        { text: `🎞️ Alle Genres`, callback_data: `type_${typeCode}` }
      ]);
    }
    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // @ANCHOR: YEAR_DISCOVERY
  // ============================================================================
  // JAHRES-AUSWAHLMENÜ & JAHRES-LISTENANSICHT (Klickbares Jahr in Detailansicht!)
  // ============================================================================
  async function showYearActionMenu(env, chatId, year, typeCode = "m", originItemId = "", messageId = null) {
    const { sendMessage, editMessageText } = tgApi(env);
    const isMovie = typeCode === "m";
    const typeLabelPlural = isMovie ? "Filme" : "Serien";
    const tgSearchUrl = `tg://search?query=${safeEncodeParam(String(year))}`;

    const text =
      `🗓️ *ERSCHEINUNGSJAHR: ${escapeMd(String(year))}*\n` +
      `📋 *Kopieren (antippen):* \`${year}\`\n` +
      `${SEP}\n` +
      `Entdecke *${typeLabelPlural} aus dem Jahr ${escapeMd(String(year))}*:\n` +
      `▸ 🔥 Populärste ${typeLabelPlural} ${escapeMd(String(year))}\n` +
      `▸ 🆕 Neueste / 🕰️ Älteste aus ${escapeMd(String(year))}\n` +
      `▸ ⭐ Bestbewertete ${typeLabelPlural} ${escapeMd(String(year))}\n` +
      `▸ 🎲 Zufallstipp aus ${escapeMd(String(year))}\n` +
      `▸ 🔎 [In Telegram nach "${escapeMd(String(year))}" suchen](${tgSearchUrl})`;

    const inline_keyboard = [
      [
        { text: `🔥 Populär (${year})`, callback_data: `ybrowse_${typeCode}_${year}_pop_1` },
        { text: `⭐ Bestbewertet (${year})`, callback_data: `ybrowse_${typeCode}_${year}_top_1` }
      ],
      [
        { text: `🆕 Neueste aus ${year}`, callback_data: `ybrowse_${typeCode}_${year}_new_1` },
        { text: `🕰️ Älteste aus ${year}`, callback_data: `ybrowse_${typeCode}_${year}_old_1` }
      ],
      [
        { text: `🎲 Zufalls-${isMovie ? "Film" : "Serie"} aus ${year}`, callback_data: `yrand_${typeCode}_${year}` }
      ],
      [
        { text: `📺 Wechsel zu ${isMovie ? "Serien" : "Filmen"} (${year})`, callback_data: `ybrowse_${isMovie ? "s" : "m"}_${year}_pop_1` },
        { text: "🔎 Telegram", url: tgSearchUrl }
      ]
    ];

    if (originItemId) {
      inline_keyboard.push([{ text: "🔙 Zurück zum Titel", callback_data: `sdet_${typeCode}_${originItemId}` }]);
    }
    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  async function showYearBrowseList(env, chatId, typeCode, year, mode = "pop", page = 1, messageId = null, sortOverride = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    const botUsername = await getBotUsername(env);
    const isMovie = typeCode === "m";
    const typeLabelPlural = isMovie ? "FILME" : "SERIEN";

    const ctxKey = `${typeCode}_${year}_${mode}_${page}`;
    memoryFallback.set(`active_list_ctx_${chatId}`, { type: "ybr", id: ctxKey });

    const sortKey = `ybr_sort_${chatId}_${typeCode}_${year}_${mode}`;
    const defaultSort = mode === "new" ? "year_desc" : mode === "old" ? "year_asc" : mode === "top" ? "rating_desc" : "pop_desc";
    const sortBy = sortOverride || memoryFallback.get(sortKey) || defaultSort;
    memoryFallback.set(sortKey, sortBy);

    const rawData = await fetchYearBrowsePage(env, typeCode, year, mode, page);
    const settings = await getUserSettings(env, chatId);
    const savedList = await getSavedList(env, chatId);

    const rawItems = rawData?.results || [];
    const { visibleItems } = await filterAndSortMediaList(env, rawItems, settings, sortBy);
    const totalPages = rawData?.total_pages || 1;
    const currentPage = rawData?.current_page || page;

    const modeHeaderMap = {
      pop: `🔥 *POPULÄRSTE ${typeLabelPlural} ${escapeMd(String(year))}*`,
      new: `🆕 *NEUESTE ${typeLabelPlural} AUS ${escapeMd(String(year))}*`,
      old: `🕰️ *ÄLTESTE ${typeLabelPlural} AUS ${escapeMd(String(year))}*`,
      top: `⭐ *BESTBEWERTETE ${typeLabelPlural} ${escapeMd(String(year))}*`
    };

    let text =
      `${modeHeaderMap[mode] || modeHeaderMap.pop}\n` +
      `📊 ${visibleItems.length} Treffer auf Seite ${currentPage}/${totalPages}\n` +
      `${SEP}\n\n`;

    if (visibleItems.length === 0) {
      text += `⚠️ *Keine Titel auf dieser Seite entsprechen deinen Filtern.*\nPasse unten die Filter an oder blättere weiter.\n\n`;
    } else {
      visibleItems.slice(0, 10).forEach((item) => {
        const title = (item.title || item.name || "Unbekannt").trim();
        const rawDate = item.release_date || item.first_air_date || "";
        const rawYear = rawDate.split("-")[0] || String(year);
        const icon = isMovie ? "🎬" : "📺";
        const vote = item.vote_average ? `${Math.round(item.vote_average * 10) / 10}` : "–";
        const isSaved = savedList.some(i => String(i.tmdbId) === String(item.id) && i.contentType !== "episode");
        const saveLabel = isSaved ? "💾 In Merkliste" : "💾 Speichern";

        memoryFallback.set(`title_cache_${typeCode}_${item.id}`, `${title} (${rawYear})`);

        const detailLink = makeBotLink(botUsername, `sdet_${typeCode}_${item.id}`);
        const saveLink = makeBotLink(botUsername, `qsv_${typeCode}_${item.id}`);
        const whereLink = makeBotLink(botUsername, `ws_${typeCode}_${item.id}`);
        const fskBadge = item.fsk ? ` • 🔞 ${escapeMd(formatFskCompact(item.fsk))}` : "";

        text +=
          `${icon} *[${escapeMd(title)}](${detailLink})* (${rawYear}) • ⭐ ${vote}${fskBadge}\n` +
          `   [${saveLabel}](${saveLink})  •  [🔍](${whereLink})\n\n`;
      });
    }

    const inline_keyboard = [];
    inline_keyboard.push(buildSortRow(sortBy, `ysort_${typeCode}_${year}_${mode}_${currentPage}`));

    inline_keyboard.push(
      buildPaginationRow(
        currentPage,
        totalPages,
        `ybrowse_${typeCode}_${year}_${mode}_${currentPage - 1}`,
        `ybrowse_${typeCode}_${year}_${mode}_${currentPage + 1}`
      )
    );

    inline_keyboard.push([
      { text: mode === "pop" ? "🔥 Populär •" : "🔥 Populär", callback_data: `ybrowse_${typeCode}_${year}_pop_1` },
      { text: mode === "new" ? "🆕 Neueste •" : "🆕 Neueste", callback_data: `ybrowse_${typeCode}_${year}_new_1` },
      { text: mode === "old" ? "🕰️ Älteste •" : "🕰️ Älteste", callback_data: `ybrowse_${typeCode}_${year}_old_1` }
    ]);
    inline_keyboard.push([
      { text: mode === "top" ? "⭐ Bestbewertet •" : "⭐ Bestbewertet", callback_data: `ybrowse_${typeCode}_${year}_top_1` },
      { text: `🎲 Zufall (${year})`, callback_data: `yrand_${typeCode}_${year}` }
    ]);

    inline_keyboard.push(...buildQuickFilterRows(settings, `ybr_${ctxKey}`));
    inline_keyboard.push([
      { text: `🔄 Zu ${isMovie ? "Serien" : "Filmen"} (${year})`, callback_data: `ybrowse_${isMovie ? "s" : "m"}_${year}_${mode}_1` }
    ]);
    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // @ANCHOR: SERIES_EPISODES
  // ============================================================================
  // SERIEN-EPISODEN-GUIDE (Paginierte Staffeln & Episoden als klickbare TextLinks)
  // Speichert ausgewählte Episoden direkt im Serien-Unterordner: 📺 Serien ▸ <Serienname>
  // ============================================================================
  async function showSeriesEpisodes(env, chatId, seriesId, seasonNumber = 1, viewMode = "all", page = 1, messageId = null, flashNotice = "", previewStoryUrl = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    const botUsername = await getBotUsername(env);

    const seriesDetails = await fetchSeriesDetails(env, seriesId);
    if (!seriesDetails) {
      const errText = `⚠️ *Seriendetails konnten nicht geladen werden.*`;
      const errKb = { inline_keyboard: [buildFooterRow(chatId, true)] };
      if (messageId) await editMessageText(chatId, messageId, errText, { reply_markup: errKb });
      else await sendMessage(chatId, errText, { reply_markup: errKb });
      return;
    }

    const seriesTitle = (seriesDetails.title || "Serie").replace(/\s*\(\d{4}\)$/, "").trim();
    memoryFallback.set(`title_cache_s_${seriesId}`, seriesTitle);

    const seasonsList = Array.isArray(seriesDetails.seasons) && seriesDetails.seasons.length > 0
      ? seriesDetails.seasons
      : [{ season_number: 1, name: "Staffel 1", episode_count: 0 }];

    const validSeasonNums = seasonsList.map(s => s.season_number);
    const activeSeasonNum = validSeasonNums.includes(Number(seasonNumber))
      ? Number(seasonNumber)
      : validSeasonNums[0];

    const savedList = await getSavedList(env, chatId);
    const savedEpisodesForSeries = savedList.filter(
      i => i.contentType === "episode" && String(i.seriesId) === String(seriesId)
    );

    let episodesToDisplay = [];
    let headerSubtitle = "";
    let seasonTelegraphUrl = null;

    if (viewMode === "fav") {
      episodesToDisplay = savedEpisodesForSeries.map(ep => ({
        id: ep.tmdbId,
        episode_number: ep.episodeNumber || 1,
        season_number: ep.seasonNumber != null ? Number(ep.seasonNumber) : 1,
        name: ep.episodeName || ep.title,
        air_date: ep.year,
        vote_average: null,
        runtime: null,
        _savedUid: ep.uid
      }));
      headerSubtitle = `💾 *Gespeicherte Episoden (${episodesToDisplay.length})*`;
    } else {
      const seasonData = await fetchSeasonDetails(env, seriesId, activeSeasonNum);
      seasonTelegraphUrl = seasonData
        ? await ensureSeasonTelegraphUrl(env, seriesId, seriesDetails, seasonData)
        : null;
      episodesToDisplay = (seasonData?.episodes || []).map(ep => ({
        ...ep,
        season_number: activeSeasonNum
      }));
      headerSubtitle = `💿 *Staffel ${activeSeasonNum}* (${episodesToDisplay.length} Folgen) • 💾 In Merkliste: ${savedEpisodesForSeries.length}`;
    }

    const perPage = 8;
    const totalPages = Math.max(1, Math.ceil(episodesToDisplay.length / perPage));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const slice = episodesToDisplay.slice((currentPage - 1) * perPage, currentPage * perPage);

    // Free-Plan Schutz: Maximal 2 noch nicht gecachte Episoden-Telegraph-Seiten pro Bot-Klick vorwärmen (statt 8x Parallel-Sturm!)
    if (slice.length > 0) {
      let generatedNow = 0;
      for (const ep of slice) {
        const epNum = Number(ep?.episode_number || 0);
        const sNum = Number(ep?.season_number || activeSeasonNum);
        const memKey = `tg_ep_url_${seriesId}_${sNum}_${epNum}`;
        if (ep?.telegraph_url || memoryFallback.get(memKey)) continue;
        if (generatedNow >= 2) break;
        if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(24)) break;
        generatedNow++;
        await ensureEpisodeTelegraphUrl(env, seriesId, seriesDetails, sNum, ep).catch(() => null);
      }
    }

    memoryFallback.set(`active_list_ctx_${chatId}`, {
      mode: "ep_list",
      seriesId,
      seasonNumber: activeSeasonNum,
      viewMode,
      page: currentPage
    });

    const seriesFolderLink = makeBotLink(botUsername, `wlo_f_ser_${seriesId}`);
    const telegraphSeasonLine = seasonTelegraphUrl
      ? `📰 *Staffel-Captions:* [Komplette Staffel ${activeSeasonNum} auf Telegraph lesen](${seasonTelegraphUrl})\n`
      : "";

    let text =
      `📺 *${escapeMd(seriesTitle.toUpperCase())} – EPISODEN*\n` +
      `${headerSubtitle} • 📄 Seite ${currentPage}/${totalPages}\n` +
      `${SEP}\n` +
      (flashNotice ? `${flashNotice}\n${SEP}\n` : "") +
      `📂 Zielordner: *[📺 Serien ▸ ${escapeMd(seriesTitle)}](${seriesFolderLink})*\n` +
      telegraphSeasonLine +
      `💡 _Tippe auf einen Episoden-Titel für die Story oder darunter zum Speichern:_\n\n`;

    if (slice.length === 0) {
      if (viewMode === "fav") {
        text += `ℹ️ _Noch keine Episoden im Unterordner „📺 Serien ▸ ${escapeMd(seriesTitle)}" gespeichert._\nTippe in der Staffelansicht unter einer Episode auf „In Serien-Ordner speichern“, um sie dort abzulegen!\n\n`;
      } else {
        text += `⚠️ _Keine Episodendaten für Staffel ${activeSeasonNum} gefunden._\n\n`;
      }
    } else {
      for (const ep of slice) {
        const sNum = ep.season_number || activeSeasonNum;
        const eNum = ep.episode_number || 1;
        const sPad = String(sNum).padStart(2, "0");
        const ePad = String(eNum).padStart(2, "0");
        const codeStr = `S${sPad}E${ePad}`;
        const epName = (ep.name || `Folge ${eNum}`).replace(/^(?:S\d+E\d+\s*[–-]\s*)/i, "").trim();
        const airYear = (ep.air_date || "").split("-")[0] || "";
        const voteStr = ep.vote_average ? ` • ⭐ ${Math.round(ep.vote_average * 10) / 10}` : "";
        const runStr = ep.runtime ? ` • ⏳ ${ep.runtime}` : "";

        const isEpSaved = savedEpisodesForSeries.some(
          saved => Number(saved.seasonNumber) === Number(sNum) && Number(saved.episodeNumber) === Number(eNum)
        );
        const saveEpLink = makeBotLink(botUsername, `epsv_${seriesId}_${sNum}_${eNum}_${currentPage}`);
        const whereEpLink = makeBotLink(botUsername, `wsep_${seriesId}_${sNum}_${eNum}`);
        const epStoryLink = ep.telegraphUrl || makeBotLink(botUsername, `eptg_${seriesId}_${sNum}_${eNum}_${currentPage}`);
        const statusIcon = isEpSaved ? "✅" : "📖";
        const saveBadge = isEpSaved ? "💾 Im Serien-Ordner (entfernen)" : "💾 In Serien-Ordner speichern";

        memoryFallback.set(`ep_name_${seriesId}_${sNum}_${eNum}`, `${seriesTitle} ${codeStr} - ${epName}`);

        text +=
          `[🔍](${whereEpLink}) ${statusIcon} *[${codeStr} – ${escapeMd(epName)}](${epStoryLink})*${airYear ? ` (${airYear})` : ""}${voteStr}${runStr}\n` +
          `   └ [${saveBadge}](${saveEpLink})\n\n`;
      }
    }

    const inline_keyboard = [];

    // Modus-Umschalter: Alle Episoden vs. Gespeicherte Episoden im Serien-Unterordner
    inline_keyboard.push([
      {
        text: viewMode === "all" ? "📋 Alle Episoden •" : "📋 Alle Episoden",
        callback_data: `ep_${seriesId}_${activeSeasonNum}_all_1`
      },
      {
        text: viewMode === "fav" ? `💾 Gespeichert (${savedEpisodesForSeries.length}) •` : `💾 Gespeichert (${savedEpisodesForSeries.length})`,
        callback_data: `ep_${seriesId}_${activeSeasonNum}_fav_1`
      }
    ]);

    // Staffel-Auswahl (wenn im "all"-Modus und mehrere Staffeln vorhanden)
    if (viewMode === "all" && seasonsList.length > 1) {
      const seasonButtons = [];
      const maxSeasonsShown = 8;
      const curIdx = seasonsList.findIndex(s => s.season_number === activeSeasonNum);
      let startIdx = Math.max(0, curIdx - 3);
      let visibleSeasons = seasonsList.slice(startIdx, startIdx + maxSeasonsShown);
      for (let i = 0; i < visibleSeasons.length; i += 4) {
        const row = visibleSeasons.slice(i, i + 4).map(s => ({
          text: s.season_number === activeSeasonNum ? `💿 S${s.season_number} •` : `S${s.season_number}`,
          callback_data: `ep_${seriesId}_${s.season_number}_all_1`
        }));
        seasonButtons.push(row);
      }
      inline_keyboard.push(...seasonButtons);
    }

    // Einheitliche Seitennavigation mit •
    inline_keyboard.push(
      buildPaginationRow(
        currentPage,
        totalPages,
        `ep_${seriesId}_${activeSeasonNum}_${viewMode}_${currentPage - 1}`,
        `ep_${seriesId}_${activeSeasonNum}_${viewMode}_${currentPage + 1}`
      )
    );

    if (viewMode === "all" && episodesToDisplay.length > 0) {
      inline_keyboard.push([
        { text: `💾 Ganze Staffel ${activeSeasonNum} in „${seriesTitle.slice(0, 18)}" speichern`, callback_data: `epall_${seriesId}_${activeSeasonNum}` }
      ]);
    }

    if (savedEpisodesForSeries.length > 0) {
      inline_keyboard.push([
        { text: `📂 Ordner „📺 ${seriesTitle.slice(0, 20)}" öffnen`, callback_data: `wl_open_f_ser_${seriesId}` }
      ]);
    }

    inline_keyboard.push([
      { text: "🔙 Zurück zur Serie", callback_data: `sdet_s_${seriesId}` },
      { text: "💾 Merkliste", callback_data: "show_saved" }
    ]);
    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = previewStoryUrl
      ? {
          reply_markup: { inline_keyboard },
          disable_web_page_preview: false,
          link_preview_options: {
            is_disabled: false,
            url: previewStoryUrl,
            prefer_large_media: true,
            show_above_text: true
          }
        }
      : { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // @ANCHOR: PERSON_CREDITS
  // ============================================================================
  // REGIE & SCHAUSPIELER FILMOGRAFIE: TEXTLINKS + SORTIERUNG + FILTER + 💾 SPEICHERN
  // ============================================================================
  async function displayPersonCredits(env, chatId, personId, page = 1, typeCode = "m", originItemId = "", messageId = null, sortOverride = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    const botUsername = await getBotUsername(env);
    const pData = await fetchPersonDetails(env, personId);
    memoryFallback.set(`active_list_ctx_${chatId}`, { type: "per", id: personId });

    if (!pData || !pData.credits || pData.credits.length === 0) {
      const errText = `⚠️ *Keine Filme oder Serien für diese Person gefunden.*`;
      const errKb = {
        inline_keyboard: [
          [{ text: "🔙 Zurück zur Auswahl", callback_data: `per_${personId}_${typeCode}_${originItemId}` }],
          buildFooterRow(chatId, true)
        ]
      };
      if (messageId) await editMessageText(chatId, messageId, errText, { reply_markup: errKb });
      else await sendMessage(chatId, errText, { reply_markup: errKb });
      return;
    }

    const sortKey = `per_sort_${chatId}_${personId}`;
    const sortBy = sortOverride || memoryFallback.get(sortKey) || "pop_desc";
    memoryFallback.set(sortKey, sortBy);

    const settings = await getUserSettings(env, chatId);
    const savedList = await getSavedList(env, chatId);
    const { visibleItems, isFiltered } = await filterAndSortMediaList(env, pData.credits, settings, sortBy);

    const perPage = 8;
    const totalPages = Math.max(1, Math.ceil(visibleItems.length / perPage));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const slice = visibleItems.slice((currentPage - 1) * perPage, currentPage * perPage);

    const effectivePersonName = isFiltered ? `${pData.name} (Filtered)` : pData.name;

    let text =
      `👤 *${escapeMd(effectivePersonName.toUpperCase())}*\n` +
      `🎬 *Filmografie:* ${visibleItems.length} von ${pData.credits.length} Titeln sichtbar • 📄 Seite ${currentPage}/${totalPages}\n` +
      `${SEP}\n\n`;

    if (slice.length === 0) {
      text += `⚠️ *Keine Titel entsprechen den aktiven Filtern.*\nPasse unten die Filter an, um Titel zu sehen.\n\n`;
    } else {
      slice.forEach((item) => {
        const title = (item.title || item.name || "Unbekannt").trim();
        const rawYear = (item.release_date || item.first_air_date || "").split("-")[0] || "K.A.";
        const icon = item.media_type === "tv" ? "📺" : "🎬";
        const itemTypeCode = item.media_type === "tv" ? "s" : "m";
        const vote = item.vote_average ? `${Math.round(item.vote_average * 10) / 10}` : "–";
        const isSaved = savedList.some(i => String(i.tmdbId) === String(item.id) && i.contentType !== "episode");

        memoryFallback.set(`title_cache_${itemTypeCode}_${item.id}`, `${title} (${rawYear})`);

        const detailLink = makeBotLink(botUsername, `sdet_${itemTypeCode}_${item.id}`);
        const saveLink = makeBotLink(botUsername, `qsv_${itemTypeCode}_${item.id}`);
        const whereLink = makeBotLink(botUsername, `ws_${itemTypeCode}_${item.id}`);
        const saveLabel = isSaved ? "💾 In Merkliste" : "💾 Speichern";
        const fskBadge = item.fsk ? ` • 🔞 ${escapeMd(formatFskCompact(item.fsk))}` : "";

        text +=
          `${icon} *[${escapeMd(title)}](${detailLink})* (${rawYear}) • ⭐ ${vote}${fskBadge}\n` +
          `   [${saveLabel}](${saveLink})  •  [🔍](${whereLink})\n\n`;
      });
    }

    const inline_keyboard = [];
    inline_keyboard.push(buildSortRow(sortBy, `psort_${personId}_${currentPage}`));

    inline_keyboard.push(
      buildPaginationRow(
        currentPage,
        totalPages,
        `pcred_${personId}_${currentPage - 1}_${typeCode}_${originItemId}`,
        `pcred_${personId}_${currentPage + 1}_${typeCode}_${originItemId}`
      )
    );

    inline_keyboard.push(...buildQuickFilterRows(settings, `per_${personId}`));

    inline_keyboard.push([
      { text: `💾 Alle sichtbaren speichern`, callback_data: `saveall_per_${personId}_${typeCode}_${originItemId}` },
      { text: `🔙 ${pData.name}`, callback_data: `per_${personId}_${typeCode}_${originItemId}` }
    ]);
    if (originItemId) {
      inline_keyboard.push([{ text: "🔙 Zurück zum ursprünglichen Titel", callback_data: `sdet_${typeCode}_${originItemId}` }]);
    }
    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard } };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // @ANCHOR: SEARCH_RESULTS
  // ============================================================================
  // SUCHERGEBNISSE: SAUBERE TEXTLINKS (OHNE TITEL-BUTTONS) + SORTIERUNG + FILTER
  // ============================================================================
  async function displaySearchResults(env, chatId, query, page = 1, messageId = null, sortOverride = null, ignoreFiltersOverride = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    memoryFallback.delete(`active_col_${chatId}`);
    memoryFallback.set(`active_list_ctx_${chatId}`, { type: "search", query });

    // Validierung: Wenn die Suche zu lang ist -> dezenter Hinweis ohne "max. 150 Zeichen"
    if (String(query || "").length > 150) {
      const errText =
        `⚠️ *SUCHBEGRIFF ZU LANG*\n` +
        `${SEP}\n` +
        `Bitte gib einen kürzeren Filmtitel oder Suchbegriff ein.`;
      const errKb = {
        inline_keyboard: [
          [{ text: "🔍 Neue Suche starten", callback_data: "trigger_search" }],
          buildFooterRow(chatId, true)
        ]
      };
      if (messageId) await editMessageText(chatId, messageId, errText, { reply_markup: errKb });
      else await sendMessage(chatId, errText, { reply_markup: errKb });
      return;
    }

    const prevState = await getSearchState(env, chatId);
    const sortBy = sortOverride || prevState?.sortBy || "pop_desc";
    const ignoreFilters = ignoreFiltersOverride !== null
      ? Boolean(ignoreFiltersOverride)
      : (prevState && prevState.query === query ? Boolean(prevState.ignoreFilters) : false);

    const settings = await getUserSettings(env, chatId);
    const searchData = await searchTMDBPage(env, query, settings, page, sortBy, ignoreFilters);
    const botUsername = await getBotUsername(env);
    const savedList = await getSavedList(env, chatId);

    const totalHits = searchData ? searchData.total_results : 0;
    const movieCount = searchData ? searchData.movie_count : 0;
    const seriesCount = searchData ? searchData.series_count : 0;

    await saveSearchState(env, chatId, query, page, totalHits, movieCount, seriesCount, sortBy, ignoreFilters);
    await setOriginSession(env, chatId, {
      mode: "search",
      query,
      totalResults: totalHits,
      movieCount,
      seriesCount
    });

    if (!searchData || searchData.results.length === 0) {
      const rewriteHint = searchData?.rewrittenFrom
        ? `\n✨ Korrigiert: _${escapeMd(searchData.effectiveQuery)}_`
        : "";

      // Wenn es nur wegen der aktiven Filter keine Treffer gab -> Fragen ob Filter temporär deaktiviert werden sollen!
      if (searchData?.filteredOutBySettings && searchData.rawUnfilteredCount > 0) {
        const hiddenCount = searchData.rawUnfilteredCount;
        const text =
          `🔍 *KEINE TREFFER WEGEN AKTIVER FILTER*\n` +
          `Begriff: *"${escapeMd(query)}"*${rewriteHint}\n` +
          `${SEP}\n` +
          `🛡️ Für diese Suche wurden *${hiddenCount} Filme/Serien* gefunden, die jedoch durch deine aktiven Filter (FSK, Genres oder Jahre) ausgeblendet wurden.\n\n` +
          `❓ *Möchtest du die Filter temporär deaktivieren, um alle Filme & Serien für diese Suche anzuzeigen?*`;
        const keyboard = {
          inline_keyboard: [
            [
              {
                text: `🔓 Filter temporär deaktivieren (Alle ${hiddenCount} zeigen)`,
                callback_data: "search_temp_nofilter"
              }
            ],
            [
              { text: "🔄 Neu versuchen", callback_data: "retry_last_search" },
              { text: "🔍 Neue Suche", callback_data: "trigger_search" }
            ],
            ...buildQuickFilterRows(settings, "search"),
            buildFooterRow(chatId, true)
          ]
        };
        if (messageId) {
          await editMessageText(chatId, messageId, text, { reply_markup: keyboard });
          await setActiveMenu(env, chatId, messageId);
        } else {
          const sent = await sendMessage(chatId, text, { reply_markup: keyboard });
          if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
        }
        return;
      }

      const text =
        `🔍 *KEINE TREFFER GEFUNDEN*\n` +
        `Begriff: *"${escapeMd(query)}"*${rewriteHint}\n` +
        `${SEP}\n` +
        `💡 Starte eine neue Suche oder passe unten die Filter an.`;
      const keyboard = {
        inline_keyboard: [
          [
            { text: "🔄 Neu versuchen", callback_data: "retry_last_search" },
            { text: "🔍 Neue Suche", callback_data: "trigger_search" }
          ],
          ...buildQuickFilterRows(settings, "search"),
          buildFooterRow(chatId, true)
        ]
      };
      if (messageId) {
        await editMessageText(chatId, messageId, text, { reply_markup: keyboard });
        await setActiveMenu(env, chatId, messageId);
      } else {
        const sent = await sendMessage(chatId, text, { reply_markup: keyboard });
        if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
      }
      return;
    }

    let text = `🔍 *SUCHE: "${escapeMd(query.toUpperCase())}"*\n`;
    if (searchData.rewrittenFrom) {
      text += `✨ *Synonym:* _${escapeMd(searchData.rewrittenFrom)} ➔ ${escapeMd(searchData.effectiveQuery)}_\n`;
    }
    if (ignoreFilters) {
      text += `🔓 _Filter für diese Suche temporär deaktiviert_\n`;
    }
    text +=
      `📊 *Treffer:* ${searchData.total_results} (🎬 ${movieCount} • 📺 ${seriesCount}) • 📄 ${searchData.current_page}/${searchData.total_pages}\n` +
      `${SEP}\n\n`;

    searchData.results.forEach((item) => {
      const title = (item.title || item.name || "Unbekannt").trim();
      const rawYear = (item.release_date || item.first_air_date || "").split("-")[0] || "K.A.";
      const icon = item.media_type === "tv" ? "📺" : "🎬";
      const itemTypeCode = item.media_type === "tv" ? "s" : "m";
      const vote = item.vote_average ? `${Math.round(item.vote_average * 10) / 10}` : "–";

      memoryFallback.set(`title_cache_${itemTypeCode}_${item.id}`, `${title} (${rawYear})`);

      const detailLink = makeBotLink(botUsername, `sdet_${itemTypeCode}_${item.id}`);
      const saveLink = makeBotLink(botUsername, `qsv_${itemTypeCode}_${item.id}`);
      const whereLink = makeBotLink(botUsername, `ws_${itemTypeCode}_${item.id}`);

      const isSaved = savedList.some(i => String(i.tmdbId) === String(item.id) && i.contentType !== "episode");
      const saveIcon = isSaved ? "💾 In Merkliste" : "💾";
      const gNames = (item.genre_ids || []).slice(0, 2).map(id => ALL_GENRE_ID_TO_NAME[id]).filter(Boolean).join(", ") || (item.media_type === "tv" ? "Serie" : "Film");

      text +=
        `${icon} *[${escapeMd(title)}](${detailLink})* (${rawYear}) • ⭐ ${vote}\n` +
        `   🎞️ ${escapeMd(gNames)}  •  [${saveIcon}](${saveLink})  •  [🔍](${whereLink})\n\n`;
    });

    // Kompakte Steuerleiste (Sortierung, einheitliche Seitennavigation mit •, Filter)
    const inline_keyboard = [];
    inline_keyboard.push(buildSortRow(sortBy, "ssort"));

    inline_keyboard.push(
      buildPaginationRow(
        searchData.current_page,
        searchData.total_pages,
        `spg_p_${searchData.current_page - 1}`,
        `spg_n_${searchData.current_page + 1}`
      )
    );

    if (ignoreFilters) {
      inline_keyboard.push([{ text: "🔒 Filter für Suche wieder aktivieren", callback_data: "search_reenable_filter" }]);
    }

    inline_keyboard.push([{ text: "🔍 Neue Suche", callback_data: "trigger_search" }]);
    inline_keyboard.push(...buildQuickFilterRows(settings, "search"));
    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      await editMessageText(chatId, messageId, text, markup);
      await setActiveMenu(env, chatId, messageId);
    } else {
      let res = await sendMessage(chatId, text, markup);
      if (!res) {
        res = await sendMessage(chatId, text.replace(/[*_`\[\]]/g, ""), { parse_mode: undefined, reply_markup: { inline_keyboard } });
      }
      if (res && res.result) {
        await setActiveMenu(env, chatId, res.result.message_id);
      }
    }
  }

  // @ANCHOR: WISHLIST_COCKPIT
  // ============================================================================
  // MERKLISTE: NEUE 6-KATEGORIEN-STRUKTUR & ENTSCHÄRFTE LÖSCH-MÜLLTONNE MIT BESTÄTIGUNG
  // Struktur:
  //   Merkliste ▸
  //     🎬 Filme -> Filme
  //     📺 Serien -> Seriennamen -> Serie & Episoden
  //     🍿 Filmkollektionen -> Filmkollektion-Namen -> Filme & Serien
  //     🌌 Universen -> Universennamen -> Filme & Serien
  //     🎭 Schauspieler -> Filme & Serien
  //     🎬 Regisseure -> Filme & Serien
  // ============================================================================
  async function ensureSeriesFoldersSynced(env, chatId, fullList, folders) {
    let foldersChanged = false;
    let listChanged = false;

    for (const item of fullList) {
      if (item.contentType === "series" && (!item.folderId || item.folderId === "cat_series")) {
        const sId = item.tmdbId;
        const sTitle = (item.title || "Serie").replace(/\s*\(\d{4}\)$/, "").trim();
        let sFolder = folders.find(f => f.type === "series_show" && (String(f.tmdbRefId) === String(sId) || f.name.toLowerCase() === sTitle.toLowerCase()));
        if (!sFolder) {
          sFolder = {
            id: `f_ser_${sId || Date.now().toString(36)}`,
            name: sTitle,
            originalName: sTitle,
            tmdbRefId: sId || null,
            type: "series_show",
            linked: true,
            createdAt: Date.now()
          };
          folders.push(sFolder);
          foldersChanged = true;
        }
        if (item.folderId !== sFolder.id) {
          item.folderId = sFolder.id;
          listChanged = true;
        }
      } else if (item.contentType === "episode" && item.seriesId) {
        const sId = item.seriesId;
        const sTitle = (item.seriesTitle || "Serie").replace(/\s*\(\d{4}\)$/, "").trim();
        let sFolder = folders.find(f => f.type === "series_show" && (String(f.tmdbRefId) === String(sId) || f.name.toLowerCase() === sTitle.toLowerCase()));
        if (!sFolder) {
          sFolder = {
            id: `f_ser_${sId}`,
            name: sTitle,
            originalName: sTitle,
            tmdbRefId: sId,
            type: "series_show",
            linked: true,
            createdAt: Date.now()
          };
          folders.push(sFolder);
          foldersChanged = true;
        }
        if (item.folderId !== sFolder.id) {
          item.folderId = sFolder.id;
          listChanged = true;
        }
      }
    }

    if (foldersChanged) await saveFolders(env, chatId, folders);
    if (listChanged) await saveRawList(env, chatId, fullList);
    return { folders, fullList };
  }

  async function displaySavedList(env, chatId, messageId = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    memoryFallback.delete(`active_col_${chatId}`);
    memoryFallback.delete(`active_list_ctx_${chatId}`);

    let folders = await cleanupEmptyFolders(env, chatId);
    let fullList = await getSavedList(env, chatId);
    const synced = await ensureSeriesFoldersSynced(env, chatId, fullList, folders);
    folders = synced.folders;
    fullList = synced.fullList;

    const wlState = await getWishlistViewState(env, chatId);
    const botUsername = await getBotUsername(env);

    const disabledFolderIds = new Set(folders.filter(f => f.enabled === false).map(f => f.id));
    const enabledFullList = fullList.filter(i => !i.folderId || !disabledFolderIds.has(i.folderId));
    const totalCountAll = enabledFullList.length;

    if (fullList.length === 0 && folders.length === 0) {
      const emptyText =
        `💾 *DEINE MERKLISTE (0)*\n` +
        `${SEP}\n` +
        `Noch keine Titel oder Playlisten gespeichert.\n\n` +
        `💡 Tippe bei Empfehlungen, Suchen oder Episoden auf 💾 oder sende eine \`.json\`-Datei, um automatisch eine eigene Playlist in deiner Merkliste zu erstellen.`;
      const emptyKeyboard = {
        inline_keyboard: [buildFooterRow(chatId, true)]
      };
      if (messageId) await editMessageText(chatId, messageId, emptyText, { reply_markup: emptyKeyboard });
      else await sendMessage(chatId, emptyText, { reply_markup: emptyKeyboard });
      return;
    }

    let currentFolderId = wlState.currentFolderId || "root";
    const specialCats = ["root", "cat_movies", "cat_series", "cat_col", "cat_uni", "cat_act", "cat_dir"];

    if (!specialCats.includes(currentFolderId)) {
      const folderStillExists = folders.some(f => f.id === currentFolderId);
      if (!folderStillExists) {
        currentFolderId = "root";
        await saveWishlistViewState(env, chatId, { currentFolderId: "root", page: 1 });
      }
    }

    const colFolders = folders.filter(f => f.type === "collection");
    const uniFolders = folders.filter(f => f.type === "universe");
    const seriesFolders = folders.filter(f => f.type === "series_show");
    const actorFolders = folders.filter(f => f.type === "actor" || (f.type === "person" && f.role !== "director"));
    const directorFolders = folders.filter(f => f.type === "director" || (f.type === "person" && f.role === "director"));
    const playlistFolders = folders.filter(f => f.type === "playlist" || f.isJsonPlaylist === true);
    const customFolders = folders.filter(f => !["collection", "universe", "series_show", "actor", "director", "person", "playlist"].includes(f.type) && !f.isJsonPlaylist);

    const enabledPlaylistFolderIds = new Set(playlistFolders.filter(f => f.enabled !== false).map(f => f.id));

    const movieItems = enabledFullList.filter(i =>
      i.contentType === "movie" && (!i.folderId || i.folderId === "cat_movies" || enabledPlaylistFolderIds.has(i.folderId))
    );
    const actorItems = enabledFullList.filter(i =>
      i.folderId === "cat_act" || i.category === "actor" || actorFolders.some(af => af.id === i.folderId)
    );
    const directorItems = enabledFullList.filter(i =>
      i.folderId === "cat_dir" || i.category === "director" || directorFolders.some(df => df.id === i.folderId)
    );
    const seriesAllItemsCount = enabledFullList.filter(i =>
      seriesFolders.some(sf => sf.id === i.folderId) || i.contentType === "series" || i.contentType === "episode"
    ).length;
    const colAllItemsCount = enabledFullList.filter(i => colFolders.some(cf => cf.id === i.folderId)).length;
    const uniAllItemsCount = enabledFullList.filter(i => uniFolders.some(uf => uf.id === i.folderId)).length;

    const activeFolderObj = folders.find(f => f.id === currentFolderId);

    // Welche Einträge gehören in die aktuelle Ansicht?
    let visibleItems = [];
    if (wlState.searchQuery) {
      const q = wlState.searchQuery.toLowerCase();
      visibleItems = enabledFullList.filter(i =>
        (i.title || "").toLowerCase().includes(q) ||
        (i.seriesTitle || "").toLowerCase().includes(q) ||
        (i.genres || "").toLowerCase().includes(q) ||
        (i.year || "").toLowerCase().includes(q)
      );
    } else if (currentFolderId === "cat_movies") {
      visibleItems = movieItems;
    } else if (currentFolderId === "cat_act") {
      visibleItems = actorItems;
    } else if (currentFolderId === "cat_dir") {
      visibleItems = directorItems;
    } else if (["root", "cat_series", "cat_col", "cat_uni"].includes(currentFolderId)) {
      visibleItems = [];
    } else {
      visibleItems = fullList.filter(i => i.folderId === currentFolderId);
    }

    // Sortierung anwenden (In Serien-Ordnern steht die Hauptserie immer ganz oben, danach die Episoden nach Staffel/Folge)
    visibleItems = visibleItems.slice().sort((a, b) => {
      if (activeFolderObj && activeFolderObj.type === "series_show") {
        if (a.contentType === "series" && b.contentType !== "series") return -1;
        if (b.contentType === "series" && a.contentType !== "series") return 1;
        if (a.contentType === "episode" && b.contentType === "episode") {
          if ((a.seasonNumber || 0) !== (b.seasonNumber || 0)) return (a.seasonNumber || 0) - (b.seasonNumber || 0);
          return (a.episodeNumber || 0) - (b.episodeNumber || 0);
        }
      }
      if (wlState.sortBy === "abc_asc") return (a.title || "").localeCompare(b.title || "", "de");
      if (wlState.sortBy === "abc_desc") return (b.title || "").localeCompare(a.title || "", "de");
      if (wlState.sortBy === "added_asc") return (a.addedAt || 0) - (b.addedAt || 0);
      if (wlState.sortBy === "year_asc") {
        const ya = parseInt(a.year, 10) || 9999;
        const yb = parseInt(b.year, 10) || 9999;
        return ya - yb;
      }
      if (wlState.sortBy === "year_desc") {
        const ya = parseInt(a.year, 10) || 0;
        const yb = parseInt(b.year, 10) || 0;
        return yb - ya;
      }
      return (b.addedAt || 0) - (a.addedAt || 0);
    });

    const itemsPerPage = 8;
    const totalPages = Math.max(1, Math.ceil(visibleItems.length / itemsPerPage));
    const currentPage = Math.min(Math.max(1, wlState.page || 1), totalPages);
    const pageSlice = visibleItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    // 1. HEADER JE NACH EBENE
    let text = "";
    if (wlState.searchQuery) {
      text +=
        `🔍 *MERKLISTE: "${escapeMd(wlState.searchQuery)}"*\n` +
        `📊 ${visibleItems.length} von ${totalCountAll} aktiven Einträgen\n` +
        `${SEP}\n\n`;
    } else if (currentFolderId === "cat_movies") {
      text +=
        `🎬 *MERKLISTE ▸ FILME (${movieItems.length})*\n` +
        `📄 Seite ${currentPage} von ${totalPages}\n` +
        `${SEP}\n\n`;
    } else if (currentFolderId === "cat_series") {
      text +=
        `📺 *MERKLISTE ▸ SERIEN (${seriesFolders.length} SERIEN)*\n` +
        `📊 ${seriesAllItemsCount} gespeicherte Serien & Episoden\n` +
        `${SEP}\n\n`;
    } else if (currentFolderId === "cat_col") {
      text +=
        `🍿 *MERKLISTE ▸ FILMKOLLEKTIONEN (${colFolders.length})*\n` +
        `📊 ${colAllItemsCount} gespeicherte Filme & Serien\n` +
        `${SEP}\n\n`;
    } else if (currentFolderId === "cat_uni") {
      text +=
        `🌌 *MERKLISTE ▸ UNIVERSEN (${uniFolders.length})*\n` +
        `📊 ${uniAllItemsCount} gespeicherte Filme & Serien\n` +
        `${SEP}\n\n`;
    } else if (currentFolderId === "cat_act") {
      text +=
        `🎭 *MERKLISTE ▸ SCHAUSPIELER (${actorItems.length})*\n` +
        `📄 Seite ${currentPage} von ${totalPages}\n` +
        `${SEP}\n\n`;
    } else if (currentFolderId === "cat_dir") {
      text +=
        `🎬 *MERKLISTE ▸ REGISSEURE (${directorItems.length})*\n` +
        `📄 Seite ${currentPage} von ${totalPages}\n` +
        `${SEP}\n\n`;
    } else if (activeFolderObj) {
      const folderIcon = activeFolderObj.type === "collection"
        ? "🍿"
        : activeFolderObj.type === "universe"
          ? "🌌"
          : activeFolderObj.type === "series_show"
            ? "📺"
            : (activeFolderObj.type === "playlist" || activeFolderObj.isJsonPlaylist)
              ? "🎵"
              : "📁";
      const statusBadge = activeFolderObj.enabled === false ? " _(⚪ AUSGESCHALTET)_" : " _(🟢 AKTIV)_";
      text +=
        `${folderIcon} *${escapeMd(activeFolderObj.name.toUpperCase())}*${statusBadge}\n` +
        `📊 ${visibleItems.length} Einträge in dieser Playlist (${totalCountAll} aktiv gesamt)\n` +
        `${SEP}\n`;
    } else {
      text +=
        `💾 *DEINE MERKLISTE (${totalCountAll} AKTIVE EINTRÄGE)*\n` +
        `📂 Wähle eine Kategorie oder verwalte deine Playlisten:\n` +
        `${SEP}\n\n`;
    }

    // 2. KATEGORIEN, SMART-PLAYLISTEN & ORDNER-SEKTION
    const renderFolderLine = (fObj, iconStr, withToggle = true) => {
      const count = fullList.filter(i => i.folderId === fObj.id).length;
      const isEnabled = fObj.enabled !== false;
      const openLink = makeBotLink(botUsername, `wlo_${fObj.id}`);
      const togLink = makeBotLink(botUsername, `plt_${fObj.id}`);
      const editLink = makeBotLink(botUsername, `fed_${fObj.id}`);
      const delLink = makeBotLink(botUsername, `fdl_${fObj.id}`);
      const togglePart = withToggle
        ? `  •  [${isEnabled ? "🟢 Ein" : "⚪ Aus"}](${togLink})`
        : "";
      return `• ${iconStr} *[${escapeMd(fObj.name)}](${openLink})* \`(${count})\`${togglePart}  [✏️](${editLink})  [🗑️](${delLink})\n`;
    };

    if (currentFolderId === "root" && !wlState.searchQuery) {
      const linkMovies = makeBotLink(botUsername, "wlo_cat_movies");
      const linkSeries = makeBotLink(botUsername, "wlo_cat_series");
      const linkCols = makeBotLink(botUsername, "wlo_cat_col");
      const linkUnis = makeBotLink(botUsername, "wlo_cat_uni");
      const linkActors = makeBotLink(botUsername, "wlo_cat_act");
      const linkDirs = makeBotLink(botUsername, "wlo_cat_dir");

      text +=
        `🎬 *[Filme](${linkMovies})* \`(${movieItems.length})\`\n` +
        `📺 *[Serien](${linkSeries})* \`(${seriesFolders.length} Serien • ${seriesAllItemsCount} Einträge)\`\n` +
        `🍿 *[Filmkollektionen](${linkCols})* \`(${colFolders.length} Reihen • ${colAllItemsCount} Titel)\`\n` +
        `🌌 *[Universen](${linkUnis})* \`(${uniFolders.length} Universen • ${uniAllItemsCount} Titel)\`\n` +
        `🎭 *[Schauspieler](${linkActors})* \`(${actorItems.length})\`\n` +
        `🎬 *[Regisseure](${linkDirs})* \`(${directorItems.length})\`\n`;

      if (playlistFolders.length > 0) {
        text += `\n🎵 *CUSTOM PLAYLISTEN (JSON- & BACKUP-IMPORTS)*\n`;
        for (const pl of playlistFolders) {
          text += renderFolderLine(pl, pl.enabled === false ? "⚪" : "🎵", true);
        }
      }

      if (customFolders.length > 0) {
        text += `\n📁 *EIGENE ORDNER & PLAYLISTEN*\n`;
        for (const cust of customFolders) {
          text += renderFolderLine(cust, cust.enabled === false ? "⚪" : "📁", true);
        }
      }
      text += `\n${SEP}\n💡 _Tippe auf 🟢/⚪ zum Ein-/Ausschalten einer Playlist, ✏️ zum Umbenennen oder 🗑️ zum Löschen._\n`;
    } else if (currentFolderId === "cat_series") {
      if (seriesFolders.length === 0) {
        text += `ℹ️ _Noch keine Serien oder Episoden gespeichert._\n\n`;
      } else {
        for (const sf of seriesFolders) {
          const itemsInSeries = fullList.filter(i => i.folderId === sf.id);
          const epCount = itemsInSeries.filter(i => i.contentType === "episode").length;
          const openLink = makeBotLink(botUsername, `wlo_${sf.id}`);
          const delLink = makeBotLink(botUsername, `fdl_${sf.id}`);
          const epBadge = epCount > 0 ? `${epCount} Episoden` : `Serie`;
          text += `• 📺 *[${escapeMd(sf.name)}](${openLink})* \`(${epBadge})\`  •  [🗑️](${delLink})\n`;
        }
      }
      const backRootLink = makeBotLink(botUsername, "wlo_root");
      text += `\n🔙 *[Zurück zur Merkliste](${backRootLink})*\n`;
    } else if (currentFolderId === "cat_col") {
      if (colFolders.length === 0) {
        text += `ℹ️ _Noch keine Filmkollektionen gespeichert._\n\n`;
      } else {
        for (const cf of colFolders) {
          text += renderFolderLine(cf, "🍿", false);
        }
      }
      const backRootLink = makeBotLink(botUsername, "wlo_root");
      text += `\n🔙 *[Zurück zur Merkliste](${backRootLink})*\n`;
    } else if (currentFolderId === "cat_uni") {
      if (uniFolders.length === 0) {
        text += `ℹ️ _Noch keine Filmuniversen gespeichert._\n\n`;
      } else {
        for (const uf of uniFolders) {
          text += renderFolderLine(uf, "🌌", false);
        }
      }
      const backRootLink = makeBotLink(botUsername, "wlo_root");
      text += `\n🔙 *[Zurück zur Merkliste](${backRootLink})*\n`;
    } else if (activeFolderObj) {
      const togLink = makeBotLink(botUsername, `plt_${activeFolderObj.id}`);
      const editLink = makeBotLink(botUsername, `fed_${activeFolderObj.id}`);
      const delLink = makeBotLink(botUsername, `fdl_${activeFolderObj.id}`);
      const isEnabled = activeFolderObj.enabled !== false;
      const parentTarget = activeFolderObj.type === "collection"
        ? "wlo_cat_col"
        : activeFolderObj.type === "universe"
          ? "wlo_cat_uni"
          : activeFolderObj.type === "series_show"
            ? "wlo_cat_series"
            : "wlo_root";
      const backParentLink = makeBotLink(botUsername, parentTarget);
      let extraSourceRow = "";
      if (activeFolderObj.linked && activeFolderObj.tmdbRefId && activeFolderObj.type === "collection") {
        const colDeep = makeBotLink(botUsername, `col_${activeFolderObj.tmdbRefId}_wl_${activeFolderObj.id}`);
        extraSourceRow = `├ 🍿 *[Komplette Filmreihe öffnen](${colDeep})*\n`;
      } else if (activeFolderObj.linked && activeFolderObj.tmdbRefId && activeFolderObj.type === "universe") {
        const uniDeep = makeBotLink(botUsername, `buniwl_${activeFolderObj.tmdbRefId}_${activeFolderObj.id}`);
        extraSourceRow = `├ 🌌 *[Komplettes Filmuniversum öffnen](${uniDeep})*\n`;
      } else if (activeFolderObj.linked && activeFolderObj.tmdbRefId && activeFolderObj.type === "series_show") {
        const serDeep = makeBotLink(botUsername, `s_${activeFolderObj.tmdbRefId}`);
        const epDeep = makeBotLink(botUsername, `ep_${activeFolderObj.tmdbRefId}_1_all_1`);
        extraSourceRow =
          `├ 📺 *[Serien-Details öffnen](${serDeep})*\n` +
          `├ 📋 *[Alle Staffeln & Episoden](${epDeep})*\n`;
      }
      text +=
        `🎛️ *PLAYLIST- & ORDNER-MENÜ*\n` +
        `┌ ${isEnabled ? "🟢 *[Playlist ist EINGESCHALTET (Ausschalten)]" : "⚪ *[Playlist ist AUSGESCHALTET (Einschalten)]"}(${togLink})*\n` +
        `├ ✏️ *[Playlist / Ordner umbenennen](${editLink})*\n` +
        `├ 🗑️ *[Playlist / Ordner löschen](${delLink})*\n` +
        extraSourceRow +
        `└ 🔙 *[Zurück zur Übersicht](${backParentLink})*\n` +
        `${SEP}\n\n`;
    }

    // 3. TITEL-LISTE: [🔍] links vor dem Titel, [🗑️] entschärft in der 2. Zeile rechts + Bestätigungsschritt!
    if (pageSlice.length > 0) {
      for (const item of pageSlice) {
        const whereSearchLink = makeBotLink(botUsername, `wlw_${item.uid}`);
        // Entschärft: delc_ öffnet eine Sicherheitsabfrage statt sofort zu löschen!
        const deleteConfirmLink = makeBotLink(botUsername, `delc_${item.uid}`);

        if (item.contentType === "episode") {
          const epSNum = item.seasonNumber != null ? Number(item.seasonNumber) : 1;
          const sCode = `S${String(epSNum).padStart(2, "0")}E${String(item.episodeNumber || 1).padStart(2, "0")}`;
          const epTitle = (item.episodeName || item.title || "Episode").trim();
          const openSeriesLink = item.seriesId
            ? makeBotLink(botUsername, `ep_${item.seriesId}_${epSNum}_all_1`)
            : makeBotLink(botUsername, `sd_${item.uid}`);
          text +=
            `[🔍](${whereSearchLink}) 🎞️ *[${escapeMd(sCode)} – ${escapeMd(epTitle)}](${openSeriesLink})*\n` +
            `   📺 ${escapeMd(item.seriesTitle || "Serie")} • 📅 ${escapeMd(item.year || "K.A.")}  •  [🗑️](${deleteConfirmLink})\n\n`;
        } else {
          const icon = item.contentType === "series" ? "📺" : "🎬";
          const cleanTitle = (item.title || "Unbekannt").trim();
          const fskCompact = formatFskCompact(item.fsk);
          const genresShort = (item.genres || "K. A.").split(",").slice(0, 2).map(s => s.trim()).join(", ");
          const openItemLink = makeBotLink(botUsername, `sd_${item.uid}`);
          const personNote = item.personName ? ` • 👤 ${escapeMd(item.personName)}` : "";

          text +=
            `[🔍](${whereSearchLink}) ${icon} *[${escapeMd(cleanTitle)}](${openItemLink})*\n` +
            `   📅 ${escapeMd(item.year || "K.A.")} • 🔞 ${escapeMd(fskCompact)} • 🎞️ ${escapeMd(genresShort)}${personNote}  •  [🗑️](${deleteConfirmLink})\n\n`;
        }
      }
    } else if (!["root", "cat_series", "cat_col", "cat_uni"].includes(currentFolderId)) {
      text += `ℹ️ _Noch keine Einträge in dieser Kategorie._\n\n`;
    }

    // 4. STEUER-BUTTONS UNTEN
    const inline_keyboard = [];

    if (currentFolderId === "root" && !wlState.searchQuery) {
      inline_keyboard.push([
        { text: `🎬 Filme (${movieItems.length})`, callback_data: "wl_open_cat_movies" },
        { text: `📺 Serien (${seriesFolders.length})`, callback_data: "wl_open_cat_series" }
      ]);
      inline_keyboard.push([
        { text: `🍿 Kollektionen (${colFolders.length})`, callback_data: "wl_open_cat_col" },
        { text: `🌌 Universen (${uniFolders.length})`, callback_data: "wl_open_cat_uni" }
      ]);
      inline_keyboard.push([
        { text: `🎭 Schauspieler (${actorItems.length})`, callback_data: "wl_open_cat_act" },
        { text: `🎬 Regisseure (${directorItems.length})`, callback_data: "wl_open_cat_dir" }
      ]);
    }

    inline_keyboard.push([
      { text: "🎲 Zufall", callback_data: "wl_rand" },
      { text: wlState.searchQuery ? `🔍 "${wlState.searchQuery.slice(0, 8)}" ❌` : "🔍 Suchen", callback_data: wlState.searchQuery ? "wl_clear_search" : "wl_search" },
      { text: "➕ Ordner", callback_data: "wl_new_folder" }
    ]);

    if (visibleItems.length > 1) {
      const sortAbcLabel = wlState.sortBy === "abc_asc" ? "🔤 A–Z ▲" : wlState.sortBy === "abc_desc" ? "🔤 Z–A ▼" : "🔤 ABC";
      const sortDateLabel = wlState.sortBy === "added_desc" ? "🕒 Neu ▼" : wlState.sortBy === "added_asc" ? "🕒 Alt ▲" : "🕒 Datum";
      const sortYearLabel = wlState.sortBy === "year_desc" ? "📅 Jahr ▼" : wlState.sortBy === "year_asc" ? "📅 Jahr ▲" : "📅 Jahr";

      inline_keyboard.push([
        { text: sortAbcLabel, callback_data: "wl_sort_abc" },
        { text: sortDateLabel, callback_data: "wl_sort_date" },
        { text: sortYearLabel, callback_data: "wl_sort_year" }
      ]);
    }

    if (currentFolderId !== "root") {
      if (activeFolderObj && activeFolderObj.type === "series_show") {
        inline_keyboard.push([
          { text: "🔙 Zu Serien", callback_data: "wl_open_cat_series" },
          { text: "📂 Haupt-Merkliste", callback_data: "wl_open_root" }
        ]);
      } else if (activeFolderObj && activeFolderObj.type === "collection") {
        inline_keyboard.push([
          { text: "🔙 Zu Kollektionen", callback_data: "wl_open_cat_col" },
          { text: "📂 Haupt-Merkliste", callback_data: "wl_open_root" }
        ]);
      } else if (activeFolderObj && activeFolderObj.type === "universe") {
        inline_keyboard.push([
          { text: "🔙 Zu Universen", callback_data: "wl_open_cat_uni" },
          { text: "📂 Haupt-Merkliste", callback_data: "wl_open_root" }
        ]);
      } else {
        inline_keyboard.push([{ text: "🔙 Zurück zur Haupt-Merkliste", callback_data: "wl_open_root" }]);
      }
    }

    if (visibleItems.length > 0) {
      const shareContextName = activeFolderObj ? activeFolderObj.name : "Meine Merkliste";
      const shareItemsPreview = pageSlice.map(i => `• ${i.title} (${i.year || "K.A."})`).join("\n");
      const botLink = botUsername ? `https://t.me/${botUsername}` : "https://www.themoviedb.org/?language=de-DE";
      const sharePageText = `💾 ${shareContextName} (Seite ${currentPage}/${totalPages} • ${visibleItems.length} Titel):\n${shareItemsPreview || "Film & Serien Bot"}`;
      const centerShareUrl = `https://t.me/share/url?url=${encodeURIComponent(botLink)}&text=${encodeURIComponent(sharePageText)}`;

      const paginationRow = [];
      if (currentPage > 1) {
        paginationRow.push({ text: "◀️", callback_data: `wl_page_${currentPage - 1}` });
      } else {
        paginationRow.push({ text: "•", callback_data: "wl_noop" });
      }
      paginationRow.push({
        text: `📄 ${currentPage} / ${totalPages} 📤`,
        url: centerShareUrl
      });
      if (currentPage < totalPages) {
        paginationRow.push({ text: "▶️", callback_data: `wl_page_${currentPage + 1}` });
      } else {
        paginationRow.push({ text: "•", callback_data: "wl_noop" });
      }
      inline_keyboard.push(paginationRow);
    }

    inline_keyboard.push(buildFooterRow(chatId, true));

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }

    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // Sicherheitsabfrage vor dem Löschen eines Eintrags in der Merkliste
  async function promptItemDeleteConfirm(env, chatId, itemUid, messageId = null) {
    const { sendMessage, editMessageText } = tgApi(env);
    const list = await getSavedList(env, chatId);
    const item = list.find(i => String(i.uid) === String(itemUid));

    if (!item) {
      await displaySavedList(env, chatId, messageId);
      return;
    }

    const savedEpCount = item.contentType === "series" && item.tmdbId
      ? list.filter(i => i.contentType === "episode" && String(i.seriesId) === String(item.tmdbId)).length
      : 0;
    const epDeleteNotice = savedEpCount > 0
      ? `\n📺 _Hinweis: Alle ${savedEpCount} gespeicherten Episoden dieser Serie werden ebenfalls gelöscht._`
      : "";

    const text =
      `⚠️ *EINTRAG WIRKLICH LÖSCHEN?*\n` +
      `${SEP}\n` +
      `🎬 *${escapeMd(item.title || "Unbekannt")}*${item.year && item.year !== "K. A." ? ` (${escapeMd(item.year)})` : ""}\n\n` +
      `Möchtest du diesen Eintrag wirklich aus deiner Merkliste entfernen?${epDeleteNotice}`;

    const inline_keyboard = [
      [
        { text: "🗑️ Ja, endgültig löschen", callback_data: `del_confirm_${item.uid}` },
        { text: "↩️ Behalten", callback_data: "wl_back" }
      ]
    ];

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // @ANCHOR: WHERE_TO_SEARCH
  // ============================================================================
  // UNIVERSELLES "WIE / WO SUCHEN?" AUSWAHLMENÜ FÜR JEDE LUPE [🔍] IM GESAMTEN BOT
  // ============================================================================
  async function showUniversalWhereToSearchMenu(env, chatId, spec, messageId = null) {
    const { sendMessage, editMessageText } = tgApi(env);

    let labelTitle = "Unbekannt";
    let copyText = "";
    let tgSearchUrl = "";
    let tmdbUrl = "https://www.themoviedb.org/?language=de-DE";
    let openInBotCallback = null;

    if (spec.kind === "item") {
      const typeCode = spec.typeCode === "s" ? "s" : "m";
      const itemId = spec.itemId;
      const details = typeCode === "m" ? await fetchMovieDetails(env, itemId) : await fetchSeriesDetails(env, itemId);
      const cleanTitle = (details?.title || memoryFallback.get(`title_cache_${typeCode}_${itemId}`) || `Titel #${itemId}`).replace(/\s*\(\d{4}\)$/, "").trim();
      const year = details?.releaseDate && details.releaseDate !== "Keine Angabe" ? details.releaseDate.split("-")[0] : "";
      labelTitle = year ? `${cleanTitle} (${year})` : cleanTitle;
      copyText = year ? `${cleanTitle} ${year}` : cleanTitle;
      tgSearchUrl = `tg://search?query=${safeEncodeParam(copyText)}`;
      tmdbUrl = `https://www.themoviedb.org/${typeCode === "m" ? "movie" : "tv"}/${itemId}?language=de-DE`;
      openInBotCallback = `sdet_${typeCode}_${itemId}`;
    } else if (spec.kind === "col") {
      const colId = spec.colId;
      const curated = FEATURED_COLLECTIONS.find(c => String(c.id) === String(colId));
      const colDetails = curated ? null : await fetchCollectionDetails(env, colId);
      const colName = curated?.name || colDetails?.name || memoryFallback.get(`col_name_${colId}`) || `Filmreihe #${colId}`;
      labelTitle = colName;
      copyText = colName;
      tgSearchUrl = `tg://search?query=${safeEncodeParam(colName)}`;
      tmdbUrl = `https://www.themoviedb.org/collection/${colId}?language=de-DE`;
      openInBotCallback = `col_${colId}_m_`;
    } else if (spec.kind === "uni") {
      const uniKey = spec.uniKey;
      const uniObj = CINEMATIC_UNIVERSES.find(u => u.id === uniKey);
      const uniName = uniObj ? uniObj.name : "Filmuniversum";
      labelTitle = uniName;
      copyText = uniObj ? (uniObj.shortName || uniObj.name) : uniName;
      tgSearchUrl = `tg://search?query=${safeEncodeParam(copyText)}`;
      tmdbUrl = `https://www.themoviedb.org/search?query=${safeEncodeParam(copyText)}&language=de-DE`;
      openInBotCallback = `uni_${uniKey}_1`;
    } else if (spec.kind === "ep") {
      const { seriesId, seasonNumber, episodeNumber } = spec;
      const sDetails = await fetchSeriesDetails(env, seriesId);
      const seasonData = await fetchSeasonDetails(env, seriesId, seasonNumber);
      const epObj = (seasonData?.episodes || []).find(e => Number(e.episode_number) === Number(episodeNumber));
      const sName = (sDetails?.title || "Serie").replace(/\s*\(\d{4}\)$/, "").trim();
      const sCode = `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
      const epName = epObj?.name || `Episode ${episodeNumber}`;
      labelTitle = `${sName} ${sCode} – ${epName}`;
      copyText = `${sName} ${sCode}`;
      tgSearchUrl = `tg://search?query=${safeEncodeParam(copyText)}`;
      tmdbUrl = `https://www.themoviedb.org/tv/${seriesId}/season/${seasonNumber}/episode/${episodeNumber}?language=de-DE`;
      openInBotCallback = `ep_${seriesId}_${seasonNumber}_all_1`;
    }

    let backBtn = { text: "🏠 Hauptmenü", callback_data: "main_menu" };
    const listCtx = memoryFallback.get(`active_list_ctx_${chatId}`);
    if (listCtx) {
      if (listCtx.mode === "col_browser") backBtn = { text: "🔙 Zurück zu den Filmreihen", callback_data: `colpage_${listCtx.page || 1}` };
      else if (listCtx.mode === "uni_browser") backBtn = { text: "🔙 Zurück zu den Filmuniversen", callback_data: `unipage_${listCtx.page || 1}` };
      else if (listCtx.mode === "col") backBtn = { text: "🔙 Zurück zur Filmreihe", callback_data: `col_${listCtx.id}_${listCtx.originType || "m"}_${listCtx.originId || ""}` };
      else if (listCtx.mode === "uni") backBtn = { text: "🔙 Zurück zum Filmuniversum", callback_data: `uni_${listCtx.id}_${listCtx.page || 1}` };
      else if (listCtx.mode === "per") backBtn = { text: "🔙 Zurück zur Filmografie", callback_data: `per_${listCtx.id}_${listCtx.originType || "m"}_${listCtx.originId || ""}` };
      else if (listCtx.mode === "gbrowse") backBtn = { text: "🔙 Zurück zur Genre-Liste", callback_data: `gbrowse_${listCtx.typeCode}_${listCtx.genreId}_${listCtx.modeKey}_${listCtx.page || 1}` };
      else if (listCtx.mode === "ybrowse") backBtn = { text: "🔙 Zurück zur Jahres-Liste", callback_data: `ybrowse_${listCtx.typeCode}_${listCtx.year}_${listCtx.modeKey}_${listCtx.page || 1}_${listCtx.originId || ""}` };
      else if (listCtx.mode === "ep_list") backBtn = { text: "🔙 Zurück zur Episodenliste", callback_data: `ep_${listCtx.seriesId}_${listCtx.seasonNumber}_${listCtx.viewMode}_${listCtx.page || 1}` };
    }

    const text =
      `🔍 *WIE MÖCHTEST DU SUCHEN?*\n` +
      `🎬 *${escapeMd(labelTitle)}*\n` +
      `${SEP}\n` +
      `📋 *Kopieren (antippen):* \`${copyText.replace(/`/g, "'")}\`\n` +
      `▸ 🔎 [In Telegram suchen](${tgSearchUrl})\n` +
      `▸ 🌐 [Direkt bei TMDB öffnen](${tmdbUrl})`;

    const inline_keyboard = [
      [
        { text: "🔎 In Telegram suchen", url: tgSearchUrl },
        { text: "🌐 Auf TMDB öffnen", url: tmdbUrl }
      ]
    ];
    if (openInBotCallback) {
      inline_keyboard.push([{ text: "🤖 Im Bot öffnen", callback_data: openInBotCallback }]);
    }
    inline_keyboard.push([backBtn]);

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // "Wo suchen?" Auswahlmenü bei Klick auf 🔍 in der Merkliste
  async function showWishlistWhereToSearchMenu(env, chatId, itemUid, messageId = null) {
    const { sendMessage, editMessageText } = tgApi(env);
    const list = await getSavedList(env, chatId);
    const item = list.find(i => String(i.uid) === String(itemUid));

    if (!item) {
      await displaySavedList(env, chatId, messageId);
      return;
    }

    const epSeasonNum = item.seasonNumber != null ? Number(item.seasonNumber) : 1;
    const titleWithYear = item.contentType === "episode"
      ? `${item.seriesTitle || ""} S${String(epSeasonNum).padStart(2, "0")}E${String(item.episodeNumber || 1).padStart(2, "0")}`.trim()
      : (item.year && item.year !== "K. A." ? `${item.title} ${item.year}` : item.title);
    const tgSearchUrl = `tg://search?query=${safeEncodeParam(titleWithYear)}`;
    const tmdbType = item.contentType === "series" || item.contentType === "episode" ? "tv" : "movie";
    const tmdbIdTarget = item.contentType === "episode" ? item.seriesId : item.tmdbId;
    const tmdbUrl = tmdbIdTarget
      ? `https://www.themoviedb.org/${tmdbType}/${tmdbIdTarget}?language=de-DE`
      : `https://www.themoviedb.org/search?query=${safeEncodeParam(item.title)}&language=de-DE`;

    const text =
      `🔍 *WIE MÖCHTEST DU SUCHEN?*\n` +
      `🎬 *${escapeMd(item.title)}* (${escapeMd(item.year || "K.A.")})\n` +
      `${SEP}\n` +
      `📋 *Kopieren (antippen):* \`${titleWithYear.replace(/`/g, "'")}\`\n` +
      `▸ 🔎 [In Telegram suchen](${tgSearchUrl})\n` +
      `▸ 🌐 [Direkt bei TMDB öffnen](${tmdbUrl})`;

    const inline_keyboard = [
      [
        { text: "🔎 In Telegram suchen", url: tgSearchUrl },
        { text: "🌐 Auf TMDB öffnen", url: tmdbUrl }
      ],
      [{ text: "🤖 Details im Bot öffnen", callback_data: item.contentType === "episode" && item.seriesId ? `ep_${item.seriesId}_${epSeasonNum}_all_1` : `sd_${item.uid}` }],
      [{ text: "🔙 Zurück zur Merkliste", callback_data: "wl_back" }]
    ];

    if (messageId) {
      await editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard } });
      await setActiveMenu(env, chatId, messageId);
    } else {
      const sent = await sendMessage(chatId, text, { reply_markup: { inline_keyboard } });
      if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
    }
  }

  // ============================================================================
  // SPEICHERORT-ÜBERSICHT FÜR BEREITS GESPEICHERTE FILME ("💾 In Merkliste" angetippt)
  // Zeigt alle Pfade (falls mehrfach gespeichert), "💾 Merkliste zeigen" & "🗑️ Film löschen"
  // ============================================================================
  async function showSavedItemLocationsMenu(env, chatId, typeCode, itemId, messageId = null) {
    const { sendMessage, editMessageText, getBotUsername } = tgApi(env);
    const botUsername = await getBotUsername(env);
    const fullList = await getSavedList(env, chatId);
    const folders = await getFolders(env, chatId);

    const contentType = typeCode === "m" ? "movie" : "series";
    const instances = fullList.filter(
      i => String(i.tmdbId) === String(itemId) && (!i.contentType || i.contentType === contentType)
    );

    if (instances.length === 0) {
      await showSaveDestinationMenu(env, chatId, typeCode, itemId, messageId);
      return;
    }

    const itemTitle = instances[0]?.title || memoryFallback.get(`title_cache_${typeCode}_${itemId}`) || `Titel #${itemId}`;
    const itemYear = instances[0]?.year || "";

    let pathsText = "";
    instances.forEach((inst, idx) => {
      const isLast = idx === instances.length - 1;
      const branch = isLast ? "└" : "├";
      const delInstLink = makeBotLink(botUsername, `delc_${inst.uid}`);
      if (!inst.folderId || inst.folderId === "cat_movies") {
        const movLink = makeBotLink(botUsername, "wlo_cat_movies");
        pathsText += `${branch} 🎬 *[Merkliste ▸ Filme](${movLink})*  •  [🗑️](${delInstLink})\n`;
      } else if (inst.folderId === "cat_act") {
        const actLink = makeBotLink(botUsername, "wlo_cat_act");
        pathsText += `${branch} 🎭 *[Merkliste ▸ Schauspieler](${actLink})*  •  [🗑️](${delInstLink})\n`;
      } else if (inst.folderId === "cat_dir") {
        const dirLink = makeBotLink(botUsername, "wlo_cat_dir");
        pathsText += `${branch} 🎬 *[Merkliste ▸ Regisseure](${dirLink})*  •  [🗑️](${delInstLink})\n`;
      } else {
        const fObj = folders.find(f => f.id === inst.folderId);
        const fName = fObj ? fObj.name : "Ordner";
        const catLabel = fObj?.type === "collection"
          ? "🍿 Filmkollektionen ▸ "
          : fObj?.type === "universe"
            ? "🌌 Universen ▸ "
            : fObj?.type === "series_show"
              ? "📺 Serien ▸ "
              : "📁 Ordner ▸ ";
        const folderLink = makeBotLink(botUsername, `wlo_${inst.folderId}`);
        pathsText += `${branch} ${catLabel}*[${escapeMd(fName)}](${folderLink})*  •  [🗑️](${delInstLink})\n`;
      }
    });

    const countInfo = instances.length > 1
      ? `📌 *${instances.length}x in deiner Merkliste gespeichert:*`
      : `📌 *Aktueller Speicherort in deiner Merkliste:*`;

    const text =
      `💾 *TITEL IN DEINER MERKLISTE*\n` +
      `🎬 *${escapeMd(itemTitle)}*${itemYear && itemYear !== "K. A." ? ` (${escapeMd(itemYear)})` : ""}\n` +
      `${SEP}\n` +
      `${countInfo}\n` +
      `${pathsText}\n` +
      `💡 _Tippe auf einen Pfad zum Öffnen oder wähle unten eine Aktion:_`;

    const inline_keyboard = [
      [
        { text: "💾 Merkliste zeigen", callback_data: "show_saved" },
        { text: "🗑️ Film löschen", callback_data: `delallitem_${typeCode}_${itemId}` }
      ],
      [
        { text: "➕ In weiterem Ordner speichern", callback_data: `sc_force_${typeCode}_${itemId}` }
      ],
      [
        { text: "🔙 Zurück zum Titel", callback_data: `sdet_${typeCode}_${itemId}` }
      ]
    ];

    const markup = { reply_markup: { inline_keyboard }, disable_web_page_preview: true };
    if (messageId) {
      const editRes = await editMessageText(chatId, messageId, text, markup);
      if (editRes) {
        await setActiveMenu(env, chatId, messageId);
        return;
      }
    }
    const sent = await sendMessage(chatId, text, markup);
    if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
  }

  // Automatische Ziel-Erkennung beim Speichern (je nachdem wo sich der User befindet!)
  async function resolveAutoSaveTarget(env, chatId, typeCode, itemId) {
    const listCtx = memoryFallback.get(`active_list_ctx_${chatId}`);
    const activeCol = memoryFallback.get(`active_col_${chatId}`);

    if (listCtx && listCtx.mode === "uni" && listCtx.id) {
      const uniObj = CINEMATIC_UNIVERSES.find(u => u.id === listCtx.id);
      const uniName = uniObj ? uniObj.name : (memoryFallback.get(`uni_name_${listCtx.id}`) || "Filmuniversum");
      return {
        mode: "uni",
        refId: listCtx.id,
        name: uniName,
        buttonLabel: `💾 Einfach speichern (🌌 ${uniName.slice(0, 22)})`
      };
    }

    if ((listCtx && listCtx.mode === "col" && listCtx.id) || (activeCol && activeCol.id)) {
      const colId = (listCtx && listCtx.mode === "col" ? listCtx.id : activeCol.id);
      const colName = memoryFallback.get(`col_name_${colId}`) || activeCol?.name || "Filmkollektion";
      return {
        mode: "col",
        refId: colId,
        name: colName,
        buttonLabel: `💾 Einfach speichern (🍿 ${colName.slice(0, 22)})`
      };
    }

    if (listCtx && listCtx.mode === "per" && listCtx.id) {
      const pData = await fetchPersonDetails(env, listCtx.id);
      const isDir = pData?.department === "Directing";
      const pName = pData?.name || memoryFallback.get(`person_name_${listCtx.id}`) || "Person";
      return {
        mode: isDir ? "cat_dir" : "cat_act",
        refId: listCtx.id,
        personName: pName,
        name: isDir ? `Regisseure (${pName})` : `Schauspieler (${pName})`,
        buttonLabel: isDir ? `💾 Einfach speichern (🎬 Regisseure)` : `💾 Einfach speichern (🎭 Schauspieler)`
      };
    }

    if (typeCode === "s") {
      const sDetails = await fetchSeriesDetails(env, itemId);
      const sTitle = (sDetails?.title || memoryFallback.get(`title_cache_s_${itemId}`) || "Serie").replace(/\s*\(\d{4}\)$/, "").trim();
      return {
        mode: "series_show",
        refId: itemId,
        name: sTitle,
        buttonLabel: `💾 Einfach speichern (📺 Serien ▸ ${sTitle.slice(0, 18)})`
      };
    }

    return {
      mode: "cat_movies",
      refId: null,
      name: "Filme",
      buttonLabel: "💾 Einfach speichern (🎬 Filme)"
    };
  }

  // Ordner-Auswahl beim Speichern eines Films (mit deutlichem Ausrufezeichen-Hinweis ❗ & automatischer Kategorie-Zuordnung)
  async function showSaveDestinationMenu(env, chatId, typeCode, itemId, messageId = null, filterQuery = "") {
    const { sendMessage, editMessageText } = tgApi(env);
    const folders = await cleanupEmptyFolders(env, chatId);
    const itemTitle = memoryFallback.get(`title_cache_${typeCode}_${itemId}`) || `Titel #${itemId}`;
    const autoTarget = await resolveAutoSaveTarget(env, chatId, typeCode, itemId);

    let visibleFolders = folders;
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      visibleFolders = folders.filter(f => f.name.toLowerCase().includes(q));
    }

    const text =
      `❗ *NOCH NICHT GESPEICHERT!* ❗\n` +
      `⚠️ _Bitte bestätige unten mit einem Tipp auf Speichern:_\n` +
      `${SEP}\n` +
      `🎬 *${escapeMd(itemTitle)}*\n` +
      `🧭 Automatische Zuordnung: *${escapeMd(autoTarget.name)}*\n` +
      (filterQuery ? `🔍 _Ordner-Filter: "${escapeMd(filterQuery)}"_\n` : "") +
      `📂 Tippe auf *„💾 Einfach speichern“* oder wähle eine andere Kategorie:`;

    const inline_keyboard = [
      [{ text: autoTarget.buttonLabel, callback_data: `svto_${typeCode}_${itemId}_main` }],
      [
        { text: "🎬 Filme", callback_data: `svto_${typeCode}_${itemId}_cat_movies` },
        { text: "🎭 Schauspieler", callback_data: `svto_${typeCode}_${itemId}_cat_act` },
        { text: "🎬 Regisseure", callback_data: `svto_${typeCode}_${itemId}_cat_dir` }
      ],
      [{ text: "➕ Neuen eigenen Ordner erstellen", callback_data: `svnewf_${typeCode}_${itemId}` }]
    ];

    if (folders.length > 0) {
      inline_keyboard.push([
        { text: "🔍 Ordner suchen", callback_data: `svsearchf_${typeCode}_${itemId}` }
      ]);
    }

    for (const f of visibleFolders.slice(0, 6)) {
      const icon = f.type === "collection" ? "🍿" : f.type === "universe" ? "🌌" : f.type === "series_show" ? "📺" : "📁";
      inline_keyboard.push([
        { text: `💾 ${icon} ${f.name}`, callback_data: `svto_${typeCode}_${itemId}_${f.id}` }
      ]);
    }

    inline_keyboard.push([
      { text: "🔙 Abbrechen / Zurück zum Titel", callback_data: `sdet_${typeCode}_${itemId}` }
    ]);

    if (messageId) {
      await editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard } });
      await setActiveMenu(env, chatId, messageId);
    } else {
      const sent = await sendMessage(chatId, text, { reply_markup: { inline_keyboard } });
      if (sent && sent.result) await setActiveMenu(env, chatId, sent.result.message_id);
    }
  }

  // Ordner-Umbenennen-Menü mit Check-Button: "Kollektionsverlinkung auflösen? ✅ / ❌"
  async function showFolderRenamePrompt(env, chatId, folderId, unlinkToggle = false, messageId = null) {
    const { sendMessage, editMessageText } = tgApi(env);
    const folders = await getFolders(env, chatId);
    const folder = folders.find(f => f.id === folderId);

    if (!folder) {
      await displaySavedList(env, chatId, messageId);
      return;
    }

    const hasLink = !!(folder.linked && folder.tmdbRefId);
    let text =
      `✏️ *ORDNER UMBENENNEN*\n` +
      `📁 Aktuell: *${escapeMd(folder.name)}*\n`;

    if (hasLink) {
      text += `🔗 TMDB-Ref: _${escapeMd(folder.originalName || "Kollektion")}_\n`;
    }
    text +=
      `${SEP}\n` +
      `✍️ Schreibe den neuen Ordnernamen jetzt in den Chat:`;

    const inline_keyboard = [];
    if (hasLink) {
      inline_keyboard.push([
        {
          text: `🔗 Kollektionsverlinkung auflösen? ${unlinkToggle ? "✅" : "❌"}`,
          callback_data: `ftoglink_${folderId}_${unlinkToggle ? "0" : "1"}`
        }
      ]);
    }
    inline_keyboard.push([
      { text: "❌ Abbrechen", callback_data: "wl_back" }
    ]);

    let targetMsgId = messageId;
    if (messageId) {
      await editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard } });
    } else {
      const sent = await sendMessage(chatId, text, { reply_markup: { inline_keyboard } });
      if (sent && sent.result) targetMsgId = sent.result.message_id;
    }
    await setUserPromptState(env, chatId, targetMsgId, "rename_folder", { folderId, unlink: unlinkToggle });
  }

  // Radar-Ladeanimation
  async function sendLoadingPlaceholder(env, chatId, retryAction = "trigger_search", searchTargetLabel = "", customSubtitle = "") {
    const { sendMessage } = tgApi(env);
    const settings = await getUserSettings(env, chatId);

    const safeTarget = searchTargetLabel ? escapeMd(searchTargetLabel) : "";
    const subtitle = customSubtitle
      ? `${customSubtitle}`
      : (safeTarget ? `⚡ Suche besten Treffer für: *${safeTarget}*` : `⚡ Suche besten Treffer...`);

    const loadingText =
      `🔮 *QUANTEN-RADAR SCANNT*\n` +
      `${subtitle}\n` +
      `${SEP}\n` +
      `🛡️ _Aktive Filter (antippen zum Ändern):_`;

    const inline_keyboard = [
      ...buildQuickFilterRows(settings),
      [
        { text: "🔄 Neu starten", callback_data: retryAction },
        { text: "❌ Abbrechen", callback_data: "main_menu" }
      ]
    ];
    if (isGroupOrChannelChat(chatId)) {
      inline_keyboard.push([{ text: "✖️ Vorgang beenden", callback_data: "close_bot_msg" }]);
    }

    const res = await sendMessage(chatId, loadingText, { reply_markup: { inline_keyboard } });
    return res && res.result ? res.result.message_id : null;
  }

  // ============================================================================
  // EINHEITLICHER TELEGRAM TEILEN-POST GENERATOR (Für Bot, Inline-Bot & Mini-App)
  // ============================================================================
  function detectUniverseForItem(details, itemId) {
    if (!details && !itemId) return null;
    const numId = Number(itemId);
    const colId = Number(details?.collection?.id || 0);
    const compIds = Array.isArray(details?.companyIds) ? details.companyIds.map(Number) : [];
    const titleLower = String(details?.title || details?.name || "").toLowerCase();
    for (const u of CINEMATIC_UNIVERSES) {
      if (Array.isArray(u.movieIds) && u.movieIds.includes(numId)) return u;
      if (colId && Array.isArray(u.collectionIds) && u.collectionIds.includes(colId)) return u;
      if (u.companyId && compIds.includes(Number(u.companyId))) return u;
    }
    if (titleLower.includes("star wars") || titleLower.includes("mandalorian") || titleLower.includes("andor") || titleLower.includes("ahsoka")) {
      return CINEMATIC_UNIVERSES.find(u => u.id === "starwars") || null;
    }
    if (titleLower.includes("star trek")) {
      return CINEMATIC_UNIVERSES.find(u => u.id === "startrek") || null;
    }
    return null;
  }

  function buildUnifiedTelegramSharePost({
    typeCode = "m",
    itemId = "",
    title = "Unbekannt",
    releaseYear = "",
    voteAverage = "K. A.",
    genres = "",
    fsk = "",
    overview = "",
    posterUrl = "",
    telegraphUrl = "",
    botUsername = ""
  }) {
    const isSeries = typeCode === "s";
    const typeLabel = isSeries ? "📺 SERIE" : "🎬 FILM";
    const tmdbType = isSeries ? "tv" : "movie";
    const cleanTitle = String(title || "Unbekannt").replace(/\s*\(\d{4}\)$/, "").replace(/`/g, "'").trim();
    const yr = releaseYear && releaseYear !== "K. A." && releaseYear !== "Keine Angabe" ? String(releaseYear).split("-")[0] : "";
    const titleWithYear = yr ? `${cleanTitle} (${yr})` : cleanTitle;
    const copyTitle = yr ? `${cleanTitle} ${yr}` : cleanTitle;
    const tmdbUrl = `https://www.themoviedb.org/${tmdbType}/${itemId}?language=de-DE`;
    const targetTitleUrl = telegraphUrl || posterUrl || tmdbUrl;
    const botDeepLink = botUsername
      ? `https://t.me/${botUsername}?start=${typeCode}_${itemId}`
      : tmdbUrl;
    const tmaDeepLink = botUsername
      ? `https://t.me/${botUsername}?startapp=${typeCode}_${itemId}`
      : botDeepLink;
    const shortGenres = genres && genres !== "K. A." && genres !== "Keine Angabe"
      ? String(genres).split(",").slice(0, 3).map(s => s.trim()).join(", ")
      : "";
    const fskShort = fsk ? formatFskDisplay(fsk) : "";
    let shortOverview = String(overview || "").replace(/`/g, "'").trim();
    if (shortOverview.length > 220) {
      shortOverview = shortOverview.slice(0, 217).replace(/\s+\S*$/, "") + "…";
    }

    const metaParts = [`⭐ ${voteAverage}`];
    if (fskShort && fskShort !== "K. A.") metaParts.push(`🔞 ${escapeMd(fskShort)}`);
    if (shortGenres) metaParts.push(`🎞️ ${escapeMd(shortGenres)}`);

    const markdownText =
      `[\u200B](${targetTitleUrl})${typeLabel}  •  ${metaParts.join("  •  ")}\n` +
      `🎬 *[${escapeMd(titleWithYear)}](${targetTitleUrl})*\n` +
      `📋 Kopieren: \`${copyTitle}\`\n` +
      (shortOverview ? `${SEP}\n\`\`\`\n${shortOverview}\n\`\`\`\n` : `${SEP}\n`) +
      `👉 *[🤖 Im Film & Serien Bot öffnen](${botDeepLink})*  •  *[📱 Mini-App](${tmaDeepLink})*`;

    const plainShareText =
      `${typeLabel} • ⭐ ${voteAverage}${fskShort ? ` • 🔞 ${fskShort}` : ""}${shortGenres ? ` • 🎞️ ${shortGenres}` : ""}\n` +
      `🎬 ${titleWithYear}\n` +
      (shortOverview ? `\n${shortOverview}\n` : "\n") +
      `👉 Im Film & Serien Bot öffnen: ${botDeepLink}`;

    return {
      markdownText,
      plainShareText,
      targetTitleUrl,
      botDeepLink,
      tmaDeepLink,
      titleWithYear,
      copyTitle
    };
  }

  // ============================================================================
  // 2-KLICK TITEL-AKTIONSMENÜ (Mit "🔙 Zurück zur Detailansicht" & "✖️ Schließen")
  // ============================================================================
  async function showTitleActionMenu(env, chatId, typeCode, itemId) {
    const { sendMessage, deleteMessage, getBotUsername } = tgApi(env);
    await clearExtraMessage(env, chatId, deleteMessage);

    const contentType = typeCode === "m" ? "movie" : "series";
    const details = contentType === "movie"
      ? await fetchMovieDetails(env, itemId)
      : await fetchSeriesDetails(env, itemId);

    const botUsername = await getBotUsername(env);
    const cleanTitle = (details?.title || memoryFallback.get(`title_cache_${typeCode}_${itemId}`) || `Titel #${itemId}`).replace(/\s*\(\d{4}\)$/, "").replace(/`/g, "'");
    const releaseYear = details?.releaseDate && details.releaseDate !== "Keine Angabe"
      ? details.releaseDate.split("-")[0]
      : "";
    const titleWithYear = releaseYear ? `${cleanTitle} ${releaseYear}` : cleanTitle;

    const tgSearchUrl = `tg://search?query=${safeEncodeParam(titleWithYear)}`;
    const tmdbType = contentType === "movie" ? "movie" : "tv";
    const tmdbUrl = `https://www.themoviedb.org/${tmdbType}/${itemId}?language=de-DE`;
    const telegraphUrl = details ? await ensureMovieOrSeriesTelegraphUrl(env, typeCode, details) : null;
    const shareDeepLink = makeBotLink(botUsername, `sh_${typeCode}_${itemId}`, telegraphUrl || tmdbUrl);

    const providerButtons = buildStreamingProviderButtons(details);
    const providerLinksText = providerButtons.length > 0
      ? providerButtons.map(pb => `▸ ${pb.icon} [In ${escapeMd(pb.shortLabel)} öffnen](${pb.url})`).join("\n") + "\n"
      : "";

    const text =
      `🎬 *TITEL-AKTIONEN*\n` +
      `${SEP}\n` +
      `📋 *Kopieren (einfach antippen):*\n` +
      `\`${titleWithYear}\`\n\n` +
      providerLinksText +
      `▸ 🔎 [In Telegram suchen](${tgSearchUrl})\n` +
      (telegraphUrl ? `▸ 📰 [Telegraph-Artikel öffnen](${telegraphUrl})\n` : "") +
      `▸ 🌐 [Auf TMDB öffnen](${tmdbUrl})\n` +
      `▸ 📤 [Titel als Post teilen](${shareDeepLink})`;

    const inline_keyboard = [
      [
        { text: "📋 Titel + Jahr kopieren", copy_text: { text: titleWithYear } },
        { text: "📋 Nur Titel kopieren", copy_text: { text: cleanTitle } }
      ]
    ];
    const effectiveWebAppBase = String(env.WEBAPP_URL || env.WEBHOOK_URL || "https://teleport.sonhartmann-1997.workers.dev/").replace(/\/$/, "");
    if (effectiveWebAppBase && !isGroupOrChannelChat(chatId)) {
      const signedDetailWebAppUrl = await buildSignedWebAppUrl(env, effectiveWebAppBase, chatId, { openType: typeCode, openId: itemId });
      inline_keyboard.push([
        { text: "🍿 Direkt in Mini-App öffnen", web_app: { url: signedDetailWebAppUrl } }
      ]);
    }
    for (let i = 0; i < providerButtons.length; i += 2) {
      inline_keyboard.push(
        providerButtons.slice(i, i + 2).map(pb => ({ text: pb.buttonText, url: pb.url }))
      );
    }
    inline_keyboard.push(
      [
        { text: "📤 Direkt an Chat teilen", switch_inline_query: `share_${typeCode}_${itemId}` }
      ],
      [
        { text: "🔙 Zurück zur Detailansicht", callback_data: `back_overlay_${typeCode}_${itemId}` },
        { text: "✖️ Schließen", callback_data: "close_fdesc" }
      ]
    );

    const sent = await sendMessage(chatId, text, { reply_markup: { inline_keyboard } });
    if (sent && sent.result) {
      await setExtraMessage(env, chatId, sent.result.message_id);
    }
  }

  // ============================================================================
  // TEILEN-POST GENERIEREN (100% einheitlich mit Inline-Bot & Mini-App + Zurück-Button!)
  // ============================================================================
  async function showSharePostOverlay(env, chatId, typeCode, itemId) {
    const { sendMessage, deleteMessage, getBotUsername } = tgApi(env);
    await clearExtraMessage(env, chatId, deleteMessage);

    const contentType = typeCode === "m" ? "movie" : "series";
    const details = contentType === "movie"
      ? await fetchMovieDetails(env, itemId)
      : await fetchSeriesDetails(env, itemId);

    const [botUsername, telegraphUrl] = await Promise.all([
      getBotUsername(env),
      details ? ensureMovieOrSeriesTelegraphUrl(env, typeCode, details) : Promise.resolve(null)
    ]);

    const cleanTitle = (details?.title || memoryFallback.get(`title_cache_${typeCode}_${itemId}`) || `Titel #${itemId}`)
      .replace(/\s*\(\d{4}\)$/, "")
      .replace(/`/g, "'");
    const releaseYear = details?.releaseDate && details.releaseDate !== "Keine Angabe"
      ? details.releaseDate.split("-")[0]
      : "";
    const voteAverage = details?.vote_average ? `${Math.round(details.vote_average * 10) / 10} / 10` : "Keine Angabe";
    const posterUrl = details?.poster_path ? `https://image.tmdb.org/t/p/w780${details.poster_path}` : PLACEHOLDER_POSTER;

    const unified = buildUnifiedTelegramSharePost({
      typeCode,
      itemId,
      title: cleanTitle,
      releaseYear,
      voteAverage,
      genres: details?.genres || "",
      fsk: details?.fsk || "",
      overview: details?.overview || "",
      posterUrl,
      telegraphUrl,
      botUsername
    });

    const directShareUrl = `https://t.me/share/url?url=${encodeURIComponent(unified.targetTitleUrl)}&text=${encodeURIComponent(unified.plainShareText)}`;

    const titleWithYear = releaseYear ? `${cleanTitle} (${releaseYear})` : cleanTitle;
    const inline_keyboard = [
      [
        { text: "📤 Inline an Chat senden", switch_inline_query: `share_${typeCode}_${itemId}`, style: "primary" },
        { text: "📲 Über Telegram teilen", url: directShareUrl, style: "primary" }
      ],
      [
        { text: "📋 Titel kopieren", copy_text: { text: titleWithYear } }
      ],
      [
        { text: "🔙 Zurück zur Detailansicht", callback_data: `back_overlay_${typeCode}_${itemId}` },
        { text: "✖️ Schließen", callback_data: "close_fdesc" }
      ]
    ];

    const sent = await sendMessage(chatId, unified.markdownText, {
      disable_web_page_preview: false,
      link_preview_options: {
        is_disabled: false,
        url: unified.targetTitleUrl,
        prefer_large_media: true,
        show_above_text: true
      },
      reply_markup: { inline_keyboard }
    });
    if (sent && sent.result) {
      await setExtraMessage(env, chatId, sent.result.message_id);
    }
  }

  // ============================================================================
  // KOMPLETTE BESCHREIBUNG UNTER DER DETAILKARTE SENDEN (OHNE KARTE ZU LÖSCHEN)
  // ============================================================================
  async function sendFullDescriptionOverlay(env, chatId, typeCode, itemId, callbackId = null) {
    const { sendMessage, deleteMessage, answerCallbackQuery } = tgApi(env);
    const details = typeCode === "m" ? await fetchMovieDetails(env, itemId) : await fetchSeriesDetails(env, itemId);
    if (!details) {
      if (callbackId) await answerCallbackQuery(callbackId, "Beschreibung konnte nicht geladen werden.", true);
      return;
    }

    const telegraphUrl = await ensureMovieOrSeriesTelegraphUrl(env, typeCode, details);

    const fullOverview = details.overview || "Keine Beschreibung verfügbar.";
    if (callbackId && !details.isEnglishFallback && fullOverview.length <= 195 && !telegraphUrl) {
      await answerCallbackQuery(callbackId, fullOverview, true);
      return;
    }

    await clearExtraMessage(env, chatId, deleteMessage);
    if (callbackId) await answerCallbackQuery(callbackId, "📖 Komplette Beschreibung geladen!");

    const cleanTitle = (details.title || "Unbekannt").replace(/`/g, "'");
    const releaseYear = details.releaseDate && details.releaseDate !== "Keine Angabe" ? details.releaseDate.split("-")[0] : "";
    const copyableTitleWithYear = releaseYear ? `${cleanTitle} ${releaseYear}` : cleanTitle;
    const safeFull = fullOverview.replace(/`/g, "'");

    let fullText =
      `📖 *KOMPLETTE BESCHREIBUNG*\n` +
      `🎬 \`${copyableTitleWithYear}\`\n` +
      (telegraphUrl ? `📰 *[Auf Telegraph lesen (Instant View)](${telegraphUrl})*\n` : "") +
      `${SEP}\n`;

    if (details.isEnglishFallback) {
      const translatedDe = await translator(fullOverview, "de");
      const safeTranslated = (translatedDe || "").replace(/`/g, "'");
      fullText += `ℹ️ _Auf TMDB war keine deutsche Fassung hinterlegt._\n\n`;
      fullText += `🇩🇪 *Automatische Übersetzung:*\n\`\`\`\n${safeTranslated}\n\`\`\`\n\n`;
      fullText += `🇬🇧 *Englisches Original:*\n\`\`\`\n${safeFull}\n\`\`\``;
    } else {
      fullText += `\`\`\`\n${safeFull}\n\`\`\``;
    }

    const sentDesc = await sendMessage(chatId, fullText, {
      reply_markup: {
        inline_keyboard: [[
          { text: "🔙 Zurück zur Detailansicht", callback_data: `back_overlay_${typeCode}_${itemId}` },
          { text: "✖️ Schließen", callback_data: "close_fdesc" }
        ]]
      }
    });
    if (sentDesc && sentDesc.result) {
      await setExtraMessage(env, chatId, sentDesc.result.message_id);
    }
  }

  // @ANCHOR: ITEM_CARD
  // ============================================================================
  // DETAIL-KARTE SENDEN (Teilen-Icon [📤] neben Titel, Telegraph-Link in Caption & D1, klickbares Jahr, Reihe & Universum)
  // ============================================================================
  async function sendItemCard(env, chatId, item, typeCode, genreId = null, callbackId = null, loadingMsgId = null, fetchedDetails = null, backContext = null) {
    const { answerCallbackQuery, deleteMessage, sendPhoto, sendMessage, getBotUsername } = tgApi(env);

    try {
      const itemId = item.id;
      if (!itemId) throw new Error("Ungültige Item ID");

      // Speichere oder lese Herkunfts-Kontext für "Zurück zu Filmreihe / Universum / Merkliste"
      let effectiveBackContext = backContext;
      if (backContext && typeof backContext === "object" && (backContext.mode === "from_col" || backContext.mode === "from_uni")) {
        memoryFallback.set(`card_origin_${chatId}_${typeCode}_${itemId}`, backContext);
      } else if (backContext === "saved") {
        memoryFallback.set(`card_origin_${chatId}_${typeCode}_${itemId}`, "saved");
      } else if (backContext === "keep_origin") {
        effectiveBackContext = memoryFallback.get(`card_origin_${chatId}_${typeCode}_${itemId}`) || null;
      } else {
        memoryFallback.delete(`card_origin_${chatId}_${typeCode}_${itemId}`);
      }

      const contentType = typeCode === "m" ? "movie" : "series";
      const details = fetchedDetails || (contentType === "movie" ? await fetchMovieDetails(env, itemId) : await fetchSeriesDetails(env, itemId));

      if (!details) throw new Error("Details nicht geladen");

      const [trailerKey, botUsername, telegraphUrl] = await Promise.all([
        details.trailerKey !== undefined
          ? Promise.resolve(details.trailerKey)
          : fetchYouTubeTrailer(env, itemId, contentType, details),
        getBotUsername(env),
        ensureMovieOrSeriesTelegraphUrl(env, typeCode, details)
      ]);

      const title = item.title || item.name || details.title || "Unbekannt";
      const releaseDateRaw = item.release_date || item.first_air_date || details.releaseDate || "";

      const releaseYear = releaseDateRaw && releaseDateRaw !== "Keine Angabe" ? releaseDateRaw.split("-")[0] : "K. A.";
      const titleWithYear = releaseYear !== "K. A." ? `${title} ${releaseYear}` : title;

      const cleanTitle = (title || "Unbekannt").replace(/`/g, "'");

      memoryFallback.set(`title_cache_${typeCode}_${itemId}`, `${cleanTitle} (${releaseYear})`);

      // Klickbares Erscheinungsjahr öffnet das Jahres-Menü im Bot (Populär, Neueste, Älteste, Bestbewertet, Zufall)
      let formattedRelease = "Keine Angabe";
      if (releaseDateRaw && releaseDateRaw.includes("-")) {
        const parts = releaseDateRaw.split("-");
        if (parts.length === 3) {
          const yearDeepLink = makeBotLink(botUsername, `yr_${typeCode}_${parts[0]}_${itemId}`, `tg://search?query=${safeEncodeParam(parts[0])}`);
          const yearPart = `[${parts[0]}](${yearDeepLink})`;
          formattedRelease = `${parts[2]}.${parts[1]}.${yearPart}`;
        }
      }

      let overview = (details.overview || item.overview || "Keine Beschreibung verfügbar.").trim();
      const isEnglishFallback = !!details.isEnglishFallback;
      let safeOverview = overview.replace(/`/g, "'");

      const rawVote = item.vote_average || details.vote_average;
      const voteAverage = rawVote ? `${Math.round(rawVote * 10) / 10} / 10` : "Keine Angabe";

      const posterPath = item.poster_path || details.poster_path;
      const backdropPath = item.backdrop_path || details.backdrop_path;
      const candidatePosters = [];
      if (posterPath) candidatePosters.push(`https://image.tmdb.org/t/p/w780${posterPath}`);
      if (posterPath) candidatePosters.push(`https://image.tmdb.org/t/p/w500${posterPath}`);
      if (backdropPath) candidatePosters.push(`https://image.tmdb.org/t/p/w780${backdropPath}`);
      candidatePosters.push(PLACEHOLDER_POSTER);

      const clickableGenres = formatGenreLinks(details.genresList, details.genres, botUsername, typeCode, itemId);
      const clickableDirectors = formatPersonLinks(details.directorsList, details.directors || "Keine Angabe", botUsername, typeCode, itemId);
      const clickableCasts = formatPersonLinks(details.castList, details.casts, botUsername, typeCode, itemId);

      const searchUrl = `tg://search?query=${safeEncodeParam(titleWithYear)}`;
      const tmdbType = contentType === "movie" ? "movie" : "tv";
      const tmdbUrl = `https://www.themoviedb.org/${tmdbType}/${itemId}?language=de-DE`;

      // Beim Klick auf [📤] wird eine saubere Empfehlungskarte erzeugt (identisch zu Inline-Bot & Mini-App!)
      const shareUrl = makeBotLink(botUsername, `sh_${typeCode}_${itemId}`, telegraphUrl || tmdbUrl);

      // Klickbarer Titel (öffnet 2-Klick-Menü) + Teilen-Icon [📤] ohne Text direkt neben dem Namen!
      const titleActionLink = makeBotLink(botUsername, `tact_${typeCode}_${itemId}`, telegraphUrl || tmdbUrl);
      const fullDescLink = makeBotLink(botUsername, `fdesc_${typeCode}_${itemId}`, tmdbUrl);
      const simDeepLink = makeBotLink(botUsername, `sim_${typeCode}_${itemId}`, tmdbUrl);

      const typeHeader = contentType === "movie" ? "🎬 *FILM*" : "📺 *SERIE*";
      const fskCleanDisplay = formatFskDisplay(details.fsk);
      const shortCountryName = shortenCountry(details.country);

      let statusLine = "";
      if (contentType === "series") {
        const epListDeepLink = makeBotLink(botUsername, `ep_${itemId}_1_all_1`, tmdbUrl);
        statusLine = `📡 *Status:* ${escapeMd(details.statusText)}  •  [📺 Episoden anzeigen](${epListDeepLink})\n`;
      }

      let collectionLine = "";
      if (details.collection && details.collection.id) {
        const colDeepLink = makeBotLink(botUsername, `col_${details.collection.id}_${typeCode}_${itemId}`, `https://www.themoviedb.org/collection/${details.collection.id}?language=de-DE`);
        collectionLine = `🍿 *Reihe:* [${escapeMd(details.collection.name)}](${colDeepLink})\n`;
      }

      const matchedUniverse = detectUniverseForItem(details, itemId);
      let universeLine = "";
      if (matchedUniverse) {
        const uniDeepLink = makeBotLink(botUsername, `buni_${matchedUniverse.id}`, tmdbUrl);
        universeLine = `🌌 *Universum:* [${escapeMd(matchedUniverse.name)}](${uniDeepLink})\n`;
      }

      let providersLine = details.providers ? `📺 *Stream:* ${escapeMd(details.providers)}\n` : "";

      let trailerLine = "";
      if (trailerKey) {
        trailerLine = `🎥 *Trailer:* [▶️ YouTube](https://www.youtube.com/watch?v=${trailerKey})  •  [🛡️ Piped](https://piped.video/watch?v=${trailerKey})\n`;
      }

      const telegraphLinkPart = telegraphUrl ? `  •  [📰 Telegraph](${telegraphUrl})` : "";
      const linksLine = `🌐 *Links:* [🔎 Telegram](${searchUrl})  •  [🎬 TMDB](${tmdbUrl})${telegraphLinkPart}  •  [✨ Ähnlich](${simDeepLink})`;

      // Länge des Metatextes berechnen, damit das 1024-Zeichen-Limit für Foto-Captions nie überschritten wird
      const primaryReadUrl = telegraphUrl || fullDescLink;
      const sampleMeta =
        `${typeHeader}  •  ⭐ ${voteAverage}  •  🔞 ${escapeMd(fskCleanDisplay)}\n` +
        `*[${escapeMd(cleanTitle)} (${releaseYear})](${titleActionLink})*  •  [📤](${shareUrl})\n` +
        `${SEP}\n` +
        `🧐 *Beschreibung:* [📰 Telegraph-Artikel](${primaryReadUrl}) • [📖 Chat](${fullDescLink})\n` +
        `\`\`\`\n\n\`\`\`\n` +
        `${SEP}\n` +
        statusLine +
        collectionLine +
        universeLine +
        providersLine +
        `🎞️ *Genres:* ${clickableGenres}\n` +
        `⏳ *Dauer:* ${escapeMd(details.runtime)}  •  🌍 ${escapeMd(shortCountryName)}\n` +
        `🗓️ *Release:* ${formattedRelease}\n` +
        `🎬 *Regie:* ${clickableDirectors}\n` +
        `😎 *Cast:* ${clickableCasts}\n` +
        `${SEP}\n` +
        trailerLine +
        linksLine;

      const visibleMetaLength = sampleMeta.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").length;
      const maxOverviewChars = Math.max(130, 910 - visibleMetaLength);
      let isOverviewTruncated = false;
      if (safeOverview.length > maxOverviewChars) {
        isOverviewTruncated = true;
        const cut = safeOverview.slice(0, maxOverviewChars);
        const lastSpace = cut.lastIndexOf(" ");
        safeOverview = (lastSpace > 80 ? cut.slice(0, lastSpace) : cut) + "…";
      }

      const descHeaderLine = isEnglishFallback
        ? (telegraphUrl
            ? `🧐 *Beschreibung (🇬🇧 EN):* [📰 Telegraph (DE)](${telegraphUrl}) • [📖 Chat](${fullDescLink})`
            : `🧐 *Beschreibung (🇬🇧 EN):* [📖 Komplett & DE](${fullDescLink})`)
        : (telegraphUrl
            ? `🧐 *Beschreibung:* [📰 Telegraph-Artikel](${telegraphUrl})${isOverviewTruncated ? ` • [📖 Chat](${fullDescLink})` : ""}`
            : (isOverviewTruncated || safeOverview.length > 140
                ? `🧐 *Beschreibung:* [📖 Komplett lesen](${fullDescLink})`
                : `🧐 *Beschreibung:*`));

      // Teilen-Icon [📤] ohne Text direkt neben dem Titel!
      const messageText =
        `${typeHeader}  •  ⭐ ${voteAverage}  •  🔞 ${escapeMd(fskCleanDisplay)}\n` +
        `*[${escapeMd(cleanTitle)} (${releaseYear})](${titleActionLink})*  •  [📤](${shareUrl})\n` +
        `${SEP}\n` +
        `${descHeaderLine}\n` +
        `\`\`\`\n${safeOverview}\n\`\`\`\n` +
        `${SEP}\n` +
        statusLine +
        collectionLine +
        universeLine +
        providersLine +
        `🎞️ *Genres:* ${clickableGenres}\n` +
        `⏳ *Dauer:* ${escapeMd(details.runtime)}  •  🌍 ${escapeMd(shortCountryName)}\n` +
        `🗓️ *Release:* ${formattedRelease}\n` +
        `🎬 *Regie:* ${clickableDirectors}\n` +
        `😎 *Cast:* ${clickableCasts}\n` +
        `${SEP}\n` +
        trailerLine +
        linksLine;

      const savedList = await getSavedList(env, chatId);
      const isAlreadySaved = savedList.some(i => (i.tmdbId && String(i.tmdbId) === String(itemId)) || i.title === title);
      const saveBtnText = isAlreadySaved ? "💾 In Merkliste" : "💾 Speichern";
      const saveCallback = isAlreadySaved
        ? `savedinfo_${typeCode}_${itemId}`
        : (details.collection && details.collection.id
            ? `csave_${details.collection.id}_${itemId}`
            : `sc_${typeCode}_${itemId}`);

      const controlButtons = [];

      // Direkte Streaming-Plattform-Buttons ("🔴 In Netflix öffnen", "✨ In Disney+ öffnen" usw.)
      const providerButtons = buildStreamingProviderButtons(details);
      for (let i = 0; i < providerButtons.length; i += 2) {
        controlButtons.push(
          providerButtons.slice(i, i + 2).map(pb => ({ text: pb.buttonText, url: pb.url }))
        );
      }

      // Bei Serien: Direkter Button "📺 Episoden anzeigen"
      if (contentType === "series") {
        controlButtons.push([
          { text: "📺 Episoden anzeigen", callback_data: `ep_${itemId}_1_all_1` }
        ]);
      }

      // "Zurück zur (Titel) Filmreihe / (Titel) Universum" (inkl. Merkliste-Herkunftsanzeige wenn aus Merkliste->Kollektion geöffnet!)
      if (effectiveBackContext && typeof effectiveBackContext === "object") {
        if (effectiveBackContext.mode === "from_col" && effectiveBackContext.id) {
          const rawColName = (details.collection?.name || memoryFallback.get(`col_name_${effectiveBackContext.id}`) || "Filmreihe")
            .replace(/\s*(?:Filmreihe|Collection)\s*$/i, "")
            .trim();
          const shortCol = rawColName.length > 18 ? `${rawColName.slice(0, 17)}…` : rawColName;
          if (effectiveBackContext.fromWishlist) {
            const wlFold = effectiveBackContext.wlFolderId || "";
            controlButtons.push([
              { text: `🔙 Zurück zur "${shortCol}" Reihe (💾 Merkliste)`, callback_data: `col_${effectiveBackContext.id}_wl_${wlFold}` }
            ]);
            controlButtons.push([
              { text: "💾 Direkt zurück zur Merkliste", callback_data: "wl_back" }
            ]);
          } else {
            controlButtons.push([
              { text: `🔙 Zurück zur "${shortCol}" Filmreihe`, callback_data: `col_${effectiveBackContext.id}_${typeCode}_${itemId}` }
            ]);
          }
        } else if (effectiveBackContext.mode === "from_uni" && effectiveBackContext.id) {
          const uniObj = CINEMATIC_UNIVERSES.find(u => u.id === effectiveBackContext.id);
          const rawUniName = uniObj ? (uniObj.shortName || uniObj.name) : (memoryFallback.get(`uni_name_${effectiveBackContext.id}`) || "Filmuniversum");
          const shortUni = rawUniName.length > 18 ? `${rawUniName.slice(0, 17)}…` : rawUniName;
          if (effectiveBackContext.fromWishlist) {
            controlButtons.push([
              { text: `🔙 Zurück zum "${shortUni}" Universum (💾 Merkliste)`, callback_data: `uni_${effectiveBackContext.id}_${effectiveBackContext.page || 1}` }
            ]);
            controlButtons.push([
              { text: "💾 Direkt zurück zur Merkliste", callback_data: "wl_back" }
            ]);
          } else {
            controlButtons.push([
              { text: `🔙 Zurück zum "${shortUni}" Universum`, callback_data: `uni_${effectiveBackContext.id}_${effectiveBackContext.page || 1}` }
            ]);
          }
        }
      }

      // Wenn über einen Anker-Film gesucht wurde, bleibt der Button "🔄 Weitere ähnliche wie <Anker>" erhalten!
      const simAnchor = await getSimAnchor(env, chatId);
      if (simAnchor && simAnchor.id && String(simAnchor.id) !== String(itemId)) {
        const anchorClean = String(simAnchor.title || "Ursprungstitel").replace(/\s*\(\d{4}\)$/, "");
        const shortAnchorTitle = anchorClean.length > 18 ? `${anchorClean.slice(0, 17)}…` : anchorClean;
        controlButtons.push([
          { text: `🔄 Weitere ähnliche wie "${shortAnchorTitle}"`, callback_data: `simanchor_${simAnchor.typeCode || typeCode}_${simAnchor.id}` }
        ]);
      }

      const originSession = await getOriginSession(env, chatId);
      const searchState = await getSearchState(env, chatId);
      const isMovie = typeCode === "m";
      const genresObj = isMovie ? MOVIE_GENRES : SERIES_GENRES;

      if (originSession && originSession.mode === "genre") {
        controlButtons.push([
          { text: `🎲 Weitersuchen "${originSession.label}"`, callback_data: `g_${originSession.typeCode}_${originSession.genreId}` }
        ]);
      } else if (genreId) {
        const genreLabel = genreId === "random_all"
          ? (isMovie ? "Zufälliger Film" : "Zufällige Serie")
          : (Object.entries(genresObj).find(([, id]) => String(id) === String(genreId))?.[0] || (isMovie ? "Film" : "Serie"));
        controlButtons.push([
          { text: `🎲 Weitersuchen "${genreLabel}"`, callback_data: `g_${typeCode}_${genreId}` }
        ]);
      } else if ((effectiveBackContext === "search" || (originSession && originSession.mode === "search")) && searchState && searchState.query) {
        if ((searchState.totalResults || 0) > 1) {
          const shortQ = searchState.query.length > 18 ? `${searchState.query.slice(0, 17)}…` : searchState.query;
          controlButtons.push([
            { text: `🔍 Zurück zur Suche ("${shortQ}")`, callback_data: "back_to_search" }
          ]);
        }
      } else if (!(effectiveBackContext && typeof effectiveBackContext === "object")) {
        controlButtons.push([
          { text: `🎲 Weitersuchen "Zufall (Film & Serie)"`, callback_data: `g_any_random_all` }
        ]);
      }

      if (effectiveBackContext === "saved") {
        controlButtons.push([{ text: "💾 Zurück zur Merkliste", callback_data: "wl_back" }]);
      }

      // GANZ UNTEN IN EINER REIHE: Speichern | Im Chat speichern | Hauptmenü
      controlButtons.push([
        { text: saveBtnText, callback_data: saveCallback },
        { text: "💬 Im Chat speichern", callback_data: `kic_${typeCode}_${itemId}` },
        { text: "🏠 Hauptmenü", callback_data: "main_menu" }
      ]);

      if (isGroupOrChannelChat(chatId)) {
        controlButtons.push([{ text: "✖️ Vorgang beenden", callback_data: "close_bot_msg" }]);
      }

      const controlKeyboard = { inline_keyboard: controlButtons };

      if (callbackId) await answerCallbackQuery(callbackId);

      let res = null;
      for (const imgUrl of candidatePosters) {
        res = await sendPhoto(chatId, imgUrl, messageText, { reply_markup: controlKeyboard });
        if (res) break;
      }

      if (!res) {
        res = await sendMessage(chatId, messageText, { reply_markup: controlKeyboard, disable_web_page_preview: true });
      }

      if (res && res.result) {
        await setActiveMenu(env, chatId, res.result.message_id);
      }

      if (loadingMsgId) await deleteMessage(chatId, loadingMsgId);

    } catch (err) {
      if (loadingMsgId) await deleteMessage(chatId, loadingMsgId);
      if (callbackId) await answerCallbackQuery(callbackId, "Zeitüberschreitung oder Fehler.", true);
      await sendMessage(chatId, "⚠️ *Zeitüberschreitung oder Titel konnte nicht geladen werden.*", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Suche neu starten", callback_data: genreId ? `g_${typeCode}_${genreId}` : `sdet_${typeCode}_${item?.id || ""}` }],
            buildFooterRow(chatId, true)
          ]
        }
      });
    }
  }

  // @ANCHOR: RANDOM_DISCOVERY
  // Zufallsauswahl nach Genre (mit Unterstützung für typeCode === "any", Seiten-Fallback & parallelem Kandidaten-Check!)
  async function handleGenreSelection(env, callbackQuery, typeCode, genreId) {
    const { answerCallbackQuery, sendMessage, deleteMessage } = tgApi(env);
    trackStat("randomSearches");

    const callbackId = callbackQuery?.id || null;
    const chatId = callbackQuery.message.chat.id;
    const msgId = callbackQuery.message?.message_id || null;

    const isAnyType = typeCode === "any";
    const effectiveTypeCode = isAnyType ? (Math.random() < 0.5 ? "m" : "s") : typeCode;
    const isMovie = effectiveTypeCode === "m";
    const genresObj = isMovie ? MOVIE_GENRES : SERIES_GENRES;

    const pureGenreName = genreId === "random_all"
      ? (isAnyType ? "Zufall (Film & Serie)" : (isMovie ? "Zufälliger Film" : "Zufällige Serie"))
      : (Object.entries(genresObj).find(([, id]) => String(id) === String(genreId))?.[0] || (isMovie ? "Film" : "Serie"));

    const genreLabel = genreId === "random_all"
      ? pureGenreName
      : `${pureGenreName} (${isAnyType ? "Film & Serie" : (isMovie ? "Film" : "Serie")})`;

    await setOriginSession(env, chatId, {
      mode: "genre",
      typeCode: isAnyType ? "any" : effectiveTypeCode,
      genreId: String(genreId),
      label: pureGenreName
    });

    const loadingMsgId = await sendLoadingPlaceholder(
      env,
      chatId,
      `g_${isAnyType ? "any" : effectiveTypeCode}_${genreId}`,
      genreLabel,
      `⚡ Suche besten Treffer für: *${escapeMd(genreLabel)}*`
    );
    if (msgId) await deleteMessage(chatId, msgId);

    try {
      const contentType = isMovie ? "movie" : "series";
      const userSettings = await getUserSettings(env, chatId);
      const isFilterOn = userSettings.filtersActive !== false;

      const excludedGenreIds = (isFilterOn && Array.isArray(userSettings.excludedGenres))
        ? resolveGenreIdsFromNames(userSettings.excludedGenres, isMovie ? "m" : "s")
        : new Set();
      // TMDb v3: Pipe (|) = OR-Ausschluss und nur gültige Genre-IDs für das gewählte Medium!
      const withoutGenresParam = excludedGenreIds.size > 0
        ? `&without_genres=${Array.from(excludedGenreIds).join("|")}`
        : "";
      const mappedExplicitIds = genreId === "random_all" ? [] : mapExplicitGenreIdForMedia(genreId, isMovie);
      const withGenresParam = mappedExplicitIds.length > 0 ? `with_genres=${mappedExplicitIds.join("|")}&` : "";

      let validItem = null;
      let validDetails = null;
      let fallbackCandidate = null;
      let fallbackDetails = null;

      const startTime = Date.now();
      const startPage = Math.floor(Math.random() * 8) + 1;
      const pagesToScan = startPage === 1 ? [1, 2] : [startPage, 1];

      for (let page of pagesToScan) {
        if (validItem || (Date.now() - startTime > 6500)) break;

        let tmdbUrl = contentType === "movie"
          ? (withGenresParam
              ? `https://api.themoviedb.org/3/discover/movie?${withGenresParam}language=de-DE&sort_by=popularity.desc&vote_count.gte=10${withoutGenresParam}&page=${page}`
              : `https://api.themoviedb.org/3/discover/movie?language=de-DE&sort_by=popularity.desc&vote_count.gte=20${withoutGenresParam}&page=${page}`)
          : (withGenresParam
              ? `https://api.themoviedb.org/3/discover/tv?${withGenresParam}language=de-DE&sort_by=popularity.desc&vote_count.gte=5${withoutGenresParam}&page=${page}`
              : `https://api.themoviedb.org/3/discover/tv?language=de-DE&sort_by=popularity.desc&vote_count.gte=15${withoutGenresParam}&page=${page}`);

        let res = null;
        try {
          res = await fetchWithTimeout(tmdbUrl, {
            headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
          }, 4000);
        } catch (e) {
          continue;
        }

        if (!res || !res.ok) continue;
        const json = await res.json();
        let results = (json.results || []).filter(i => i && i.id);
        if (results.length === 0) continue;

        if (isFilterOn) {
          const preFiltered = results.filter(cand => {
            if (excludedGenreIds.size > 0 && Array.isArray(cand.genre_ids)) {
              if (cand.genre_ids.some(gid => excludedGenreIds.has(gid))) return false;
            }
            if (userSettings.excludedEras && userSettings.excludedEras.length > 0) {
              const rawDate = cand.release_date || cand.first_air_date || "";
              const itemYear = parseInt(rawDate.split("-")[0], 10);
              if (itemYear) {
                const isEraExcluded = userSettings.excludedEras.some(eraId => {
                  const era = ERA_OPTIONS.find(e => e.id === eraId);
                  if (!era) return false;
                  return itemYear >= era.min && itemYear <= era.max;
                });
                if (isEraExcluded) return false;
              }
            }
            return true;
          });
          if (preFiltered.length > 0) results = preFiltered;
        }

        results.sort(() => Math.random() - 0.5);

        const batch = results.slice(0, 3);
        const batchLoaded = await Promise.all(
          batch.map(async (candidate) => {
            const details = contentType === "movie"
              ? await fetchMovieDetails(env, candidate.id)
              : await fetchSeriesDetails(env, candidate.id);
            return { candidate, details };
          })
        );

        for (const { candidate, details } of batchLoaded) {
          if (!details) continue;

          if (!fallbackCandidate) {
            fallbackCandidate = candidate;
            fallbackDetails = details;
          }

          if (isFilterOn) {
            const fskExcluded = (userSettings.excludedFsk || []).includes(details.fsk);
            if (fskExcluded) continue;

            const itemGenres = details.genres.split(", ").map(g => g.trim());
            const hasExcludedGenre = itemGenres.some(g => (userSettings.excludedGenres || []).includes(g));
            if (hasExcludedGenre) continue;

            if (userSettings.excludedEras && userSettings.excludedEras.length > 0) {
              const rawDate = details.releaseDate || candidate.release_date || candidate.first_air_date || "";
              const itemYear = parseInt(rawDate.split("-")[0], 10);
              if (itemYear) {
                const isEraExcluded = userSettings.excludedEras.some(eraId => {
                  const era = ERA_OPTIONS.find(e => e.id === eraId);
                  if (!era) return false;
                  return itemYear >= era.min && itemYear <= era.max;
                });
                if (isEraExcluded) continue;
              }
            }
          }

          validItem = candidate;
          validDetails = details;
          break;
        }
      }

      const finalItem = validItem || fallbackCandidate;
      const finalDetails = validDetails || fallbackDetails;

      if (!finalItem) {
        if (loadingMsgId) await deleteMessage(chatId, loadingMsgId);
        if (callbackId) await answerCallbackQuery(callbackId, "In diesem Durchlauf nichts gefunden.", true);
        await sendMessage(chatId, `⚠️ *Kein passender Titel für "${escapeMd(genreLabel)}" gefunden.*`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: `🎲 Weitersuchen "${pureGenreName}"`, callback_data: `g_${isAnyType ? "any" : effectiveTypeCode}_${genreId}` }],
              [{ text: "⚙️ Filter anpassen", callback_data: "settings_menu" }],
              buildFooterRow(chatId, true)
            ]
          }
        });
        return;
      }

      await sendItemCard(env, chatId, finalItem, effectiveTypeCode, genreId, callbackId, loadingMsgId, finalDetails, null);

    } catch (e) {
      if (loadingMsgId) await deleteMessage(chatId, loadingMsgId);
      if (callbackId) await answerCallbackQuery(callbackId, "Fehler aufgetreten.", true);
      await sendMessage(chatId, "⚠️ *Hoppla, da gab es ein Problem.*", {
        reply_markup: {
          inline_keyboard: [
            [{ text: `🔄 Neu versuchen`, callback_data: `g_${isAnyType ? "any" : effectiveTypeCode}_${genreId}` }],
            buildFooterRow(chatId, true)
          ]
        }
      });
    }
  }

  // Titel speichern Helper (mit automatischer Kategorie-Zuordnung nach aktuellem Benutzerkontext!)
  async function fetchAndSaveById(env, chatId, typeCode, itemId, folderId = null) {
    const contentType = typeCode === "m" ? "movie" : "series";
    const details = contentType === "movie"
      ? await fetchMovieDetails(env, itemId)
      : await fetchSeriesDetails(env, itemId);

    if (!details) return { saved: false, title: "Unbekannt", targetFolderId: "root" };

    const releaseYear = details.releaseDate && details.releaseDate !== "Keine Angabe" ? details.releaseDate.split("-")[0] : "K. A.";
    let effectiveFolderId = folderId;
    let category = contentType;
    let personName = null;

    if (!effectiveFolderId || effectiveFolderId === "main" || effectiveFolderId === "auto") {
      const autoTarget = await resolveAutoSaveTarget(env, chatId, typeCode, itemId);
      if (autoTarget.mode === "uni" && autoTarget.refId) {
        const uniFolder = await findOrCreateSpecialFolder(env, chatId, "universe", autoTarget.refId, autoTarget.name, autoTarget.name);
        effectiveFolderId = uniFolder.id;
        category = "universe";
      } else if (autoTarget.mode === "col" && autoTarget.refId) {
        const colFolder = await findOrCreateSpecialFolder(env, chatId, "collection", autoTarget.refId, autoTarget.name, autoTarget.name);
        effectiveFolderId = colFolder.id;
        category = "collection";
      } else if (autoTarget.mode === "series_show") {
        const folders = await getFolders(env, chatId);
        const sTitle = (details.title || "Serie").replace(/\s*\(\d{4}\)$/, "").trim();
        let sFolder = folders.find(f => f.type === "series_show" && (String(f.tmdbRefId) === String(itemId) || f.name.toLowerCase() === sTitle.toLowerCase()));
        if (!sFolder) {
          sFolder = {
            id: `f_ser_${itemId}`,
            name: sTitle,
            originalName: sTitle,
            tmdbRefId: itemId,
            type: "series_show",
            linked: true,
            createdAt: Date.now()
          };
          folders.push(sFolder);
          await saveFolders(env, chatId, folders);
        }
        effectiveFolderId = sFolder.id;
        category = "series";
      } else if (autoTarget.mode === "cat_dir") {
        effectiveFolderId = "cat_dir";
        category = "director";
        personName = autoTarget.personName || null;
      } else if (autoTarget.mode === "cat_act") {
        effectiveFolderId = "cat_act";
        category = "actor";
        personName = autoTarget.personName || null;
      } else {
        effectiveFolderId = "cat_movies";
        category = "movie";
      }
    } else if (effectiveFolderId === "cat_act") {
      category = "actor";
    } else if (effectiveFolderId === "cat_dir") {
      category = "director";
    } else if (effectiveFolderId === "cat_movies") {
      category = "movie";
    }

    const itemObj = {
      tmdbId: itemId,
      contentType,
      category,
      personName,
      title: details.title,
      year: releaseYear,
      fsk: details.fsk,
      rating: Number(details.rating || details.vote_average || 0),
      vote_average: Number(details.rating || details.vote_average || 0),
      poster: details.poster || details.poster_path || "",
      genres: details.genres
    };

    const res = await saveItemToList(env, chatId, itemObj, effectiveFolderId);
    return { ...res, title: details.title, targetFolderId: effectiveFolderId };
  }

  // Einzelne Serien-Episode speichern (oder als Favorit toggeln) -> landet automatisch unter 📺 Serien ▸ <Serienname>
  async function saveEpisodeById(env, chatId, seriesId, seasonNumber, episodeNumber) {
    const sDetails = await fetchSeriesDetails(env, seriesId);
    const seasonData = await fetchSeasonDetails(env, seriesId, seasonNumber);
    const sTitle = (sDetails?.title || memoryFallback.get(`title_cache_s_${seriesId}`) || `Serie #${seriesId}`).replace(/\s*\(\d{4}\)$/, "").trim();
    const epObj = (seasonData?.episodes || []).find(e => Number(e.episode_number) === Number(episodeNumber));
    const epName = epObj?.name || `Episode ${episodeNumber}`;
    const sCode = `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
    const airYear = epObj?.air_date ? epObj.air_date.split("-")[0] : (sDetails?.releaseDate ? sDetails.releaseDate.split("-")[0] : "K. A.");

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

    const list = await getSavedList(env, chatId);
    // Stelle sicher, dass die Hauptserie ebenfalls im Serien-Ordner hinterlegt ist
    const hasMainSeries = list.some(i => i.contentType === "series" && String(i.tmdbId) === String(seriesId) && i.folderId === sFolder.id);
    if (!hasMainSeries && sDetails) {
      await saveItemToList(env, chatId, {
        tmdbId: seriesId,
        contentType: "series",
        category: "series",
        title: sDetails.title,
        year: sDetails.releaseDate ? sDetails.releaseDate.split("-")[0] : "K. A.",
        fsk: sDetails.fsk || "K. A.",
        genres: sDetails.genres || "K. A."
      }, sFolder.id);
    }

    const fullListNow = await getSavedList(env, chatId);
    const existingEp = fullListNow.find(
      i => i.contentType === "episode" &&
          String(i.seriesId) === String(seriesId) &&
          Number(i.seasonNumber) === Number(seasonNumber) &&
          Number(i.episodeNumber) === Number(episodeNumber)
    );

    if (existingEp) {
      await removeItemByUid(env, chatId, existingEp.uid);
      return { saved: false, removed: true, title: `${sCode} – ${epName}`, seriesTitle: sTitle, folderId: sFolder.id };
    }

    const epItem = {
      tmdbId: `ep_${seriesId}_${seasonNumber}_${episodeNumber}`,
      contentType: "episode",
      category: "series",
      seriesId: Number(seriesId),
      seriesTitle: sTitle,
      seasonNumber: Number(seasonNumber),
      episodeNumber: Number(episodeNumber),
      episodeName: epName,
      title: `${sCode} – ${epName}`,
      year: airYear,
      fsk: sDetails?.fsk || "K. A.",
      genres: sDetails?.genres || "Serie"
    };

    await saveItemToList(env, chatId, epItem, sFolder.id);
    return { saved: true, removed: false, title: `${sCode} – ${epName}`, seriesTitle: sTitle, folderId: sFolder.id };
  }

  // @ANCHOR: INLINE_MODE
  // --- Inline-Bot-Modus für Gruppen & Kanäle (@BotName, @BotName f, @BotName s, @BotName random, @BotName Suchbegriff) ---
  async function handleInlineQuery(env, inlineQuery) {
    const { answerInlineQuery, getBotUsername } = tgApi(env);
    const rawQuery = (inlineQuery.query || "").trim();
    const botUsername = await getBotUsername(env);

    try {
      // Direktes Teilen über "📤 An Kontakt / Gruppe senden" (share_m_123 / share_s_1981 / share_col_10 / share_uni_mcu):
      // Verwendet exakt denselben einheitlichen Share-Post wie der Teilen-Button [📤] im Bot und in der Mini-App!
      const shareMatch = rawQuery.match(/^share_([ms])_(\d+)$/i);
      if (shareMatch) {
        const shType = shareMatch[1].toLowerCase();
        const shId = shareMatch[2];
        const details = shType === "m" ? await fetchMovieDetails(env, shId) : await fetchSeriesDetails(env, shId);
        if (details) {
          const telegraphUrl = await ensureMovieOrSeriesTelegraphUrl(env, shType, details);
          const cleanTitle = (details.title || "Unbekannt").replace(/\s*\(\d{4}\)$/, "").replace(/`/g, "'");
          const releaseYear = details.releaseDate && details.releaseDate !== "Keine Angabe" ? details.releaseDate.split("-")[0] : "";
          const voteAverage = details.vote_average ? `${Math.round(details.vote_average * 10) / 10} / 10` : "Keine Angabe";
          const posterUrl = details.poster_path ? `https://image.tmdb.org/t/p/w780${details.poster_path}` : PLACEHOLDER_POSTER;
          const thumbUrl = details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : PLACEHOLDER_POSTER;

          const unified = buildUnifiedTelegramSharePost({
            typeCode: shType,
            itemId: shId,
            title: cleanTitle,
            releaseYear,
            voteAverage,
            genres: details.genres || "",
            fsk: details.fsk || "",
            overview: details.overview || "",
            posterUrl,
            telegraphUrl,
            botUsername
          });

          await answerInlineQuery(inlineQuery.id, [
            {
              type: "article",
              id: `share_${shType}_${shId}`,
              title: `📤 Empfehlung senden: ${unified.titleWithYear}`,
              description: `⭐ ${voteAverage} • Einheitlicher Empfehlungs-Post mit Cover & Bot-Link`,
              thumbnail_url: thumbUrl,
              input_message_content: {
                message_text: unified.markdownText,
                link_preview_options: {
                  is_disabled: false,
                  url: unified.targetTitleUrl,
                  prefer_large_media: true,
                  show_above_text: true
                }
              },
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "🤖 Im Film & Serien Bot öffnen", url: unified.botDeepLink }
                  ]
                ]
              }
            }
          ], { cache_time: 5 });
          return;
        }
      }

      const shareColMatch = rawQuery.match(/^share_col_(\d+)$/i);
      if (shareColMatch) {
        const colId = shareColMatch[1];
        const col = await fetchCollectionDetails(env, colId);
        if (col) {
          const tgUrl = await ensureCollectionTelegraphUrl(env, col);
          const botDeepLink = botUsername ? `https://t.me/${botUsername}?start=bcol_${colId}` : `https://www.themoviedb.org/collection/${colId}?language=de-DE`;
          const tmaDeepLink = botUsername ? `https://t.me/${botUsername}?startapp=col_${colId}` : botDeepLink;
          const targetUrl = tgUrl || col.posterUrl || botDeepLink;
          const descShort = String(col.overview || "").replace(/`/g, "'").slice(0, 200);
          const msgText =
            `[\u200B](${targetUrl})🍿 *FILMREIHE*  •  🎬 ${(col.parts || []).length} Filme\n` +
            `🍿 *[${escapeMd(col.name)}](${targetUrl})*\n` +
            `📋 Kopieren: \`${String(col.name).replace(/`/g, "'")}\`\n` +
            (descShort ? `${SEP}\n\`\`\`\n${descShort}\n\`\`\`\n` : `${SEP}\n`) +
            `👉 *[🤖 Im Film & Serien Bot öffnen](${botDeepLink})*  •  *[📱 Mini-App](${tmaDeepLink})*`;
          await answerInlineQuery(inlineQuery.id, [
            {
              type: "article",
              id: `share_col_${colId}`,
              title: `📤 Filmreihe teilen: ${col.name}`,
              description: `🎬 ${(col.parts || []).length} Filme • Im Bot & Mini-App öffnen`,
              thumbnail_url: col.posterUrl || PLACEHOLDER_POSTER,
              input_message_content: {
                message_text: msgText,
                link_preview_options: { is_disabled: false, url: targetUrl, prefer_large_media: true, show_above_text: true }
              },
              reply_markup: {
                inline_keyboard: [[{ text: "🤖 Filmreihe im Bot öffnen", url: botDeepLink }]]
              }
            }
          ], { cache_time: 5 });
          return;
        }
      }

      const shareUniMatch = rawQuery.match(/^share_uni_([a-z0-9_]+)$/i);
      if (shareUniMatch) {
        const uniId = shareUniMatch[1];
        const uni = CINEMATIC_UNIVERSES.find(u => u.id === uniId);
        if (uni) {
          const botDeepLink = botUsername ? `https://t.me/${botUsername}?start=buni_${uniId}` : "https://www.themoviedb.org/?language=de-DE";
          const tmaDeepLink = botUsername ? `https://t.me/${botUsername}?startapp=uni_${uniId}` : botDeepLink;
          const msgText =
            `🌌 *FILMUNIVERSUM*\n` +
            `${uni.icon || "🌌"} *[${escapeMd(uni.name)}](${botDeepLink})*\n` +
            `📋 Kopieren: \`${String(uni.name).replace(/`/g, "'")}\`\n` +
            `${SEP}\n\`\`\`\n${String(uni.description || "").replace(/`/g, "'")}\n\`\`\`\n` +
            `👉 *[🤖 Im Film & Serien Bot öffnen](${botDeepLink})*  •  *[📱 Mini-App](${tmaDeepLink})*`;
          await answerInlineQuery(inlineQuery.id, [
            {
              type: "article",
              id: `share_uni_${uniId}`,
              title: `📤 Filmuniversum teilen: ${uni.name}`,
              description: uni.description || "Filmuniversum im Bot öffnen",
              input_message_content: { message_text: msgText },
              reply_markup: {
                inline_keyboard: [[{ text: "🤖 Universum im Bot öffnen", url: botDeepLink }]]
              }
            }
          ], { cache_time: 5 });
          return;
        }
      }

      let filterMediaType = null; // 'movie' | 'tv' | null
      let effectiveSearch = rawQuery;
      let isRandomMode = false;
      let randomGenreId = null;
      let randomGenreLabel = "";

      const lowRaw = rawQuery.toLowerCase();
      if (!lowRaw || lowRaw === "random" || lowRaw === "zufall") {
        isRandomMode = true;
        effectiveSearch = "";
      } else if (/^(?:f|film|filme|movie)$/.test(lowRaw) || /^(?:random|zufall)\s+(?:f|film|filme|movie)$/.test(lowRaw)) {
        isRandomMode = true;
        filterMediaType = "movie";
        effectiveSearch = "";
      } else if (/^(?:s|serie|serien|tv)$/.test(lowRaw) || /^(?:random|zufall)\s+(?:s|serie|serien|tv)$/.test(lowRaw)) {
        isRandomMode = true;
        filterMediaType = "tv";
        effectiveSearch = "";
      } else {
        const parsedRand = parseRandomOrGenreCommand(rawQuery.startsWith("random") ? rawQuery : `random ${rawQuery}`);
        const prefixMatch = rawQuery.match(/^(f|film|s|serie)\s+(.+)$/i);
        if (prefixMatch) {
          const pType = prefixMatch[1].toLowerCase().startsWith("s") ? "tv" : "movie";
          const restStr = prefixMatch[2].trim();
          const genreCheck = resolveGenreByTerm(restStr, pType === "tv" ? "s" : "m");
          if (genreCheck) {
            isRandomMode = true;
            filterMediaType = pType;
            randomGenreId = genreCheck.genreId;
            randomGenreLabel = genreCheck.genreName;
            effectiveSearch = "";
          } else {
            filterMediaType = pType;
            effectiveSearch = restStr;
          }
        } else if (parsedRand && parsedRand.genreId !== "random_all") {
          isRandomMode = true;
          filterMediaType = parsedRand.typeCode === "s" ? "tv" : parsedRand.typeCode === "m" ? "movie" : null;
          randomGenreId = parsedRand.genreId;
          randomGenreLabel = parsedRand.genreName;
          effectiveSearch = "";
        }
      }

      const rewritten = rewriteQueryWithSynonyms(effectiveSearch);
      const query = rewritten.query || effectiveSearch;

      let url = "";
      if (query.length > 0) {
        if (filterMediaType === "movie") {
          url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&language=de-DE&include_adult=false&page=1`;
        } else if (filterMediaType === "tv") {
          url = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(query)}&language=de-DE&include_adult=false&page=1`;
        } else {
          url = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}&language=de-DE&include_adult=false&page=1`;
        }
      } else {
        const randPage = Math.floor(Math.random() * 5) + 1;
        if (filterMediaType === "movie") {
          const mappedInlineIds = mapExplicitGenreIdForMedia(randomGenreId, true);
          url = mappedInlineIds.length > 0
            ? `https://api.themoviedb.org/3/discover/movie?with_genres=${mappedInlineIds.join("|")}&language=de-DE&sort_by=popularity.desc&vote_count.gte=15&page=${randPage}`
            : `https://api.themoviedb.org/3/discover/movie?language=de-DE&sort_by=popularity.desc&vote_count.gte=25&page=${randPage}`;
        } else if (filterMediaType === "tv") {
          const mappedInlineIds = mapExplicitGenreIdForMedia(randomGenreId, false);
          url = mappedInlineIds.length > 0
            ? `https://api.themoviedb.org/3/discover/tv?with_genres=${mappedInlineIds.join("|")}&language=de-DE&sort_by=popularity.desc&vote_count.gte=10&page=${randPage}`
            : `https://api.themoviedb.org/3/discover/tv?language=de-DE&sort_by=popularity.desc&vote_count.gte=20&page=${randPage}`;
        } else {
          url = `https://api.themoviedb.org/3/trending/all/week?language=de-DE&page=${randPage}`;
        }
      }

      const res = await fetchWithTimeout(url, {
        headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
      }, 4500);

      if (!res.ok) {
        await answerInlineQuery(inlineQuery.id, []);
        return;
      }

      const data = await res.json();
      let rawItems = (data.results || []).map(i => ({
        ...i,
        media_type: i.media_type || filterMediaType || (i.first_air_date ? "tv" : "movie")
      })).filter(i => (i.media_type === "movie" || i.media_type === "tv") && (i.title || i.name));

      if (isRandomMode) {
        rawItems = rawItems.slice().sort(() => Math.random() - 0.5);
      }
      const items = rawItems.slice(0, 15);

      const buildInlineMessageData = (item) => {
        const isTv = item.media_type === "tv";
        const typeCode = isTv ? "s" : "m";
        const typeIcon = isTv ? "📺" : "🎬";

        const title = (item.title || item.name || "Unbekannt").replace(/`/g, "'");
        const rawDate = item.release_date || item.first_air_date || "";
        const year = rawDate ? rawDate.split("-")[0] : "K. A.";
        const vote = item.vote_average ? `${Math.round(item.vote_average * 10) / 10} / 10` : "Keine Angabe";
        const genreNames = Array.isArray(item.genre_ids)
          ? item.genre_ids.map(gid => ALL_GENRE_ID_TO_NAME[gid]).filter(Boolean).slice(0, 3).join(", ")
          : "";

        let rawOverview = (item.overview || "Keine deutsche Beschreibung in der Schnellvorschau verfügbar.").replace(/`/g, "'");
        const posterUrl = item.poster_path
          ? `https://image.tmdb.org/t/p/w780${item.poster_path}`
          : PLACEHOLDER_POSTER;
        const thumbUrl = item.poster_path
          ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
          : PLACEHOLDER_POSTER;

        const unified = buildUnifiedTelegramSharePost({
          typeCode,
          itemId: item.id,
          title,
          releaseYear: year,
          voteAverage: vote,
          genres: genreNames,
          fsk: "",
          overview: rawOverview,
          posterUrl,
          telegraphUrl: "",
          botUsername
        });

        return {
          typeCode,
          typeIcon,
          title,
          year,
          vote,
          rawOverview,
          posterUrl: unified.targetTitleUrl,
          thumbUrl,
          botDeepLink: unified.botDeepLink,
          messageText: unified.markdownText
        };
      };

      const inlineResults = [];

      // Im Zufalls-/Start-Modus ganz oben "🎲 Überraschungs-Zufall":
      if (isRandomMode && items.length > 0) {
        const blindPick = items[0];
        const blindData = buildInlineMessageData(blindPick);
        const blindModeLabel = filterMediaType === "movie"
          ? `🎲 Überraschungs-Film senden (Ohne Vorschau!)`
          : filterMediaType === "tv"
            ? `🎲 Überraschungs-Serie senden (Ohne Vorschau!)`
            : `🎲 Überraschungs-Tipp senden (Ohne Vorschau!)`;
        const blindDesc = randomGenreLabel
          ? `Genre: ${randomGenreLabel} • Erst nach dem Senden im Chat mit Bild sichtbar!`
          : `Zufälliger Treffer ohne Spoiler vorab – nach dem Senden mit Cover sichtbar!`;

        inlineResults.push({
          type: "article",
          id: `blind_${blindData.typeCode}_${blindPick.id}_${Date.now() % 10000}`,
          title: blindModeLabel,
          description: blindDesc,
          input_message_content: {
            message_text: blindData.messageText,
            link_preview_options: {
              is_disabled: false,
              url: blindData.posterUrl,
              prefer_large_media: true,
              show_above_text: true
            }
          },
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🤖 Im Film & Serien Bot öffnen", url: blindData.botDeepLink }
              ]
            ]
          }
        });
      }

      for (const item of items) {
        const d = buildInlineMessageData(item);
        inlineResults.push({
          type: "article",
          id: `${d.typeCode}_${item.id}`,
          title: `${d.typeIcon} ${d.title} (${d.year})`,
          description: `⭐ ${d.vote} • ${d.rawOverview.slice(0, 90)}`,
          thumbnail_url: d.thumbUrl,
          thumb_url: d.thumbUrl,
          input_message_content: {
            message_text: d.messageText,
            link_preview_options: {
              is_disabled: false,
              url: d.posterUrl,
              prefer_large_media: true,
              show_above_text: true
            }
          },
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🤖 Im Film & Serien Bot öffnen", url: d.botDeepLink }
              ]
            ]
          }
        });
      }

      await answerInlineQuery(inlineQuery.id, inlineResults.slice(0, 20), {
        cache_time: isRandomMode ? 5 : 30,
        switch_pm_text: "🤖 Zum Film & Serien Bot wechseln",
        switch_pm_parameter: "inline"
      });
    } catch (e) {
      await answerInlineQuery(inlineQuery.id, []);
    }
  }

  // Hilfsfunktion für die Bestätigungsabfrage bei "Alle speichern" (Kollektion, Universum oder Person)
  async function promptConfirmSaveAll(env, chatId, kindOrBool, refId, originType = "m", originId = "", messageId = null) {
    const { sendMessage, editMessageText } = tgApi(env);
    const settings = await getUserSettings(env, chatId);
    const kind = kindOrBool === true ? "col" : kindOrBool === false ? "per" : String(kindOrBool);

    let targetName = kind === "col"
      ? (memoryFallback.get(`col_name_${refId}`) || "Filmreihe")
      : kind === "uni"
        ? (memoryFallback.get(`uni_name_${refId}`) || "Filmuniversum")
        : (memoryFallback.get(`person_name_${refId}`) || "Person");

    let countLabel = "alle sichtbaren Titel";
    if (kind === "col") {
      const col = await fetchCollectionDetails(env, refId);
      if (col) {
        const sortBy = memoryFallback.get(`col_sort_${chatId}_${refId}`) || "year_asc";
        const { visibleItems, isFiltered } = await filterAndSortMediaList(env, col.parts, settings, sortBy);
        targetName = isFiltered ? `${col.name} (Filtered)` : col.name;
        countLabel = `alle ${visibleItems.length} sichtbaren Filme`;
      }
    } else if (kind === "uni") {
      const uni = await fetchUniverseDetails(env, refId);
      if (uni) {
        const sortBy = memoryFallback.get(`uni_sort_${chatId}_${refId}`) || "year_asc";
        const { visibleItems, isFiltered } = await filterAndSortMediaList(env, uni.parts, settings, sortBy);
        targetName = isFiltered ? `${uni.name} (Filtered)` : uni.name;
        countLabel = `alle ${visibleItems.length} sichtbaren Filme`;
      }
    } else if (kind === "per") {
      const pData = await fetchPersonDetails(env, refId);
      if (pData) {
        const sortBy = memoryFallback.get(`per_sort_${chatId}_${refId}`) || "pop_desc";
        const { visibleItems, isFiltered } = await filterAndSortMediaList(env, pData.credits, settings, sortBy);
        targetName = isFiltered ? `${pData.name} (Filtered)` : pData.name;
        countLabel = `alle ${Math.min(visibleItems.length, 25)} sichtbaren Titel`;
      }
    }

    const cancelCb = kind === "col"
      ? `col_${refId}_${originType}_${originId}`
      : kind === "uni"
        ? `uni_${refId}_1`
        : `per_${refId}_${originType}_${originId}`;

    const confirmText =
      `❗ *NOCH NICHT GESPEICHERT – BITTE BESTÄTIGEN!* ❗\n` +
      `💾 *ALLE TITEL ALS ORDNER SPEICHERN?*\n` +
      `${SEP}\n` +
      `📂 Ziel-Ordner: *${escapeMd(targetName)}*\n` +
      `🎬 Umfang: *${escapeMd(countLabel)}*`;

    const confirmKb = {
      inline_keyboard: [
        [
          { text: "💾 Ja, alle speichern", callback_data: `confirm_saveall_${kind}_${refId}` },
          { text: "❌ Abbrechen", callback_data: cancelCb }
        ]
      ]
    };
    if (messageId) await editMessageText(chatId, messageId, confirmText, { reply_markup: confirmKb });
    else await sendMessage(chatId, confirmText, { reply_markup: confirmKb });
  }

  // Hilfsfunktion für die Auswahl beim Speichern eines einzelnen Kollektions-Films (mit Ausrufezeichen-Warnung!)
  async function promptCollectionSingleSave(env, chatId, collectionId, movieId, messageId = null) {
    const { sendMessage, editMessageText } = tgApi(env);
    const colName = memoryFallback.get(`col_name_${collectionId}`) || "Kollektion";
    const text =
      `❗ *NOCH NICHT GESPEICHERT!* ❗\n` +
      `⚠️ _Bitte wähle unten den gewünschten Speicherort:_\n` +
      `${SEP}\n` +
      `🍿 Reihe: *${escapeMd(colName)}*\n` +
      `📂 Im Kollektions-Ordner oder über die normale Ordnerauswahl speichern?`;
    const kb = {
      inline_keyboard: [
        [{ text: `💾 🍿 Im Kollektions-Ordner ("${colName.slice(0, 20)}")`, callback_data: `csave_do_col_${collectionId}_${movieId}` }],
        [{ text: "💾 Einfach speichern (Haupt-Merkliste)", callback_data: `svto_m_${movieId}_main` }],
        [{ text: "📂 Anderen Ordner wählen...", callback_data: `sc_force_m_${movieId}` }],
        [{ text: "🔙 Zurück zur Filmreihe", callback_data: `col_${collectionId}_m_${movieId}` }]
      ]
    };
    if (messageId) await editMessageText(chatId, messageId, text, { reply_markup: kb });
    else await sendMessage(chatId, text, { reply_markup: kb });
  }

  // Hilfsfunktion für die Bestätigung beim Löschen eines Ordners
  async function promptFolderDeleteConfirm(env, chatId, folderId, messageId = null) {
    const { sendMessage, editMessageText } = tgApi(env);
    const folders = await getFolders(env, chatId);
    const folder = folders.find(f => f.id === folderId);
    if (!folder) {
      await displaySavedList(env, chatId, messageId);
      return;
    }
    const list = await getSavedList(env, chatId);
    const count = list.filter(i => i.folderId === folderId).length;
    const isSeriesFolder = folder.type === "series_show";
    const confirmText = isSeriesFolder
      ? `⚠️ *SERIE & EPISODEN LÖSCHEN?*\n` +
        `${SEP}\n` +
        `📺 Serie: *${escapeMd(folder.name)}*\n` +
        `🎬 Inhalt: *${count} Einträge (Serie & gespeicherte Episoden)*`
      : `⚠️ *ORDNER LÖSCHEN?*\n` +
        `${SEP}\n` +
        `📁 Ordner: *${escapeMd(folder.name)}*\n` +
        `🎬 Inhalt: *${count} Titel*`;
    const kb = {
      inline_keyboard: isSeriesFolder
        ? [
            [{ text: "🗑️ Serie & gemerkte Episoden löschen", callback_data: `fdel_confirm_all_${folderId}` }],
            [{ text: "❌ Abbrechen", callback_data: "show_saved" }]
          ]
        : [
            [{ text: "🗑️ Ordner & Filme komplett löschen", callback_data: `fdel_confirm_all_${folderId}` }],
            [{ text: "💾 Nur Ordner auflösen (Filme behalten)", callback_data: `fdel_confirm_keep_${folderId}` }],
            [{ text: "❌ Abbrechen", callback_data: "show_saved" }]
          ]
    };
    if (messageId) await editMessageText(chatId, messageId, confirmText, { reply_markup: kb });
    else await sendMessage(chatId, confirmText, { reply_markup: kb });
  }

  // @ANCHOR: SIMILAR_SEARCH
  // Hilfsfunktion für die Ähnliche-Filme-Suche (mit KV-Session-Persistenz & Dual-Anker-Unterstützung)
  async function executeSimilarSearch(env, chatId, typeCode, sourceItemId, isAnchorRepeat = false, cqId = null, msgIdToDelete = null) {
    const { answerCallbackQuery, deleteMessage, sendMessage } = tgApi(env);
    trackStat("similarSearches");

    const typePath = typeCode === "m" ? "movie" : "tv";
    let sourceTitle = memoryFallback.get(`title_cache_${typeCode}_${sourceItemId}`) || "";
    if (!sourceTitle) {
      const cachedDetails = getCachedTmdb(typeCode === "m" ? `movie_${sourceItemId}` : `tv_${sourceItemId}`);
      if (cachedDetails?.title) sourceTitle = cachedDetails.title;
    }
    if (!sourceTitle) {
      const fetched = typeCode === "m" ? await fetchMovieDetails(env, sourceItemId) : await fetchSeriesDetails(env, sourceItemId);
      if (fetched?.title) sourceTitle = fetched.title;
    }
    if (!sourceTitle) sourceTitle = `Titel #${sourceItemId}`;
    const cleanSourceTitle = sourceTitle.replace(/\s*\(\d{4}\)$/, "");

    // Wenn nicht über "🔄 Weitere ähnliche wie ..." geklickt wurde, wird dieser Film zum neuen Anker in der KV-Session!
    const currentAnchor = await getSimAnchor(env, chatId);
    if (!isAnchorRepeat || !currentAnchor) {
      await setSimAnchor(env, chatId, {
        typeCode,
        id: sourceItemId,
        title: cleanSourceTitle
      });
    }

    if (cqId) await answerCallbackQuery(cqId, `✨ Suche ähnliche Titel zu ${cleanSourceTitle}...`);
    if (msgIdToDelete) await deleteMessage(chatId, msgIdToDelete);

    const retryCallback = isAnchorRepeat ? `simanchor_${typeCode}_${sourceItemId}` : `sim_${typeCode}_${sourceItemId}`;
    const loadingMsgId = await sendLoadingPlaceholder(
      env,
      chatId,
      retryCallback,
      cleanSourceTitle,
      `⚡ Suche ähnliche Titel zu: *${escapeMd(cleanSourceTitle)}*`
    );

    try {
      const simCacheKey = `sim_list_${typePath}_${sourceItemId}`;
      let results = getCachedTmdb(simCacheKey);
      if (!results) {
        results = await getEntityFromD1(env, simCacheKey, D1_MOVIE_TTL_MS);
        if (results) setCachedTmdb(simCacheKey, results);
      }

      if (!results) {
        results = [];
        if (isRealTmdbId(sourceItemId)) {
          const urlRec = `https://api.themoviedb.org/3/${typePath}/${sourceItemId}/recommendations?language=de-DE&page=1`;
        const res = await fetchWithTimeout(urlRec, {
          headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
        }, 4500);
        if (res.ok) {
          const json = await res.json();
          results = (json.results || []).filter(i => i && i.id);
        }
        if (results.length < 5) {
          const urlSim = `https://api.themoviedb.org/3/${typePath}/${sourceItemId}/similar?language=de-DE&page=1`;
          const resSim = await fetchWithTimeout(urlSim, {
            headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` },
          }, 4000);
          if (resSim.ok) {
            const jsonSim = await resSim.json();
            const more = (jsonSim.results || []).filter(i => i && i.id && !results.some(r => r.id === i.id));
            results = [...results, ...more];
          }
        }
        if (results.length > 0) {
          setCachedTmdb(simCacheKey, results);
          await saveEntityToD1(env, simCacheKey, "similar", results);
        }
        }
      }

      if (results && results.length > 0) {
        // Bereits gezeigte Vorschläge für diesen Anker merken, damit bei "Weitere ähnliche" immer ein neuer Film kommt!
        const seenKey = `seen_sim_${chatId}_${sourceItemId}`;
        let seenIds = memoryFallback.get(seenKey) || [];
        let unseen = results.filter(r => !seenIds.includes(r.id));
        if (unseen.length === 0) {
          seenIds = [];
          unseen = results;
        }
        const pool = unseen.slice(0, 12);
        const picked = pool[Math.floor(Math.random() * pool.length)];
        seenIds.push(picked.id);
        memoryFallback.set(seenKey, seenIds);

        await sendItemCard(env, chatId, picked, typeCode, null, null, loadingMsgId, null, retryCallback);
      } else {
        if (loadingMsgId) await deleteMessage(chatId, loadingMsgId);
        await sendMessage(chatId, `⚠️ *Keine ähnlichen Titel zu "${escapeMd(cleanSourceTitle)}" gefunden.*`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔄 Erneut versuchen", callback_data: retryCallback }],
              [{ text: "🔙 Zurück zum Titel", callback_data: `sdet_${typeCode}_${sourceItemId}` }],
              buildFooterRow(chatId, true)
            ]
          }
        });
      }
    } catch (e) {
      if (loadingMsgId) await deleteMessage(chatId, loadingMsgId);
      await sendMessage(chatId, `⚠️ *Zeitüberschreitung bei der Suche nach ähnlichen Titeln.*`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Suche neu starten", callback_data: retryCallback }],
            buildFooterRow(chatId, true)
          ]
        }
      });
    }
  }

  // Fallback-Extraktion des Suchbegriffs direkt aus dem Nachrichtentext (falls KV nicht gebunden oder abgelaufen)
  function extractQueryFromSearchMessage(msgText) {
    if (!msgText) return "";
    const m1 = msgText.match(/SUCHE:\s*"([^"]+)"/i);
    if (m1 && m1[1]) return m1[1].trim();
    const m2 = msgText.match(/Begriff:\s*"([^"]+)"/i);
    if (m2 && m2[1]) return m2[1].trim();
    return "";
  }
