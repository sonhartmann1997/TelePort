  // @DEPARTMENT: 03-telegram-kv-engine | 3. Telegram Bot API, Anti-Spam & KV-Merkliste
  // @ANCHOR: ANTI_SPAM_ENGINE
  // --- Telegram Anti-Spam Rate-Limiter (Sliding Window) & Automatisierte Warteschleife (D1 + KV + waitUntil) ---
  const ANTI_SPAM_LIMITS = {
    SINGLE_CHAT_MIN_INTERVAL_MS: 1150, // Max 1 Nachricht pro 1,15 Sek. pro Chat (Telegram-Limit: 1/Sek.)
    GROUP_MAX_PER_MIN: 18,             // Max 18 Nachrichten pro 60 Sek. pro Gruppe/Kanal (Telegram-Limit: 20/Min.)
    GROUP_WINDOW_MS: 60000,
    GLOBAL_MAX_PER_SEC: 25,            // Max 25 Nachrichten pro Sek. global über alle Chats (Telegram-Limit: 30/Sek.)
    GLOBAL_WINDOW_MS: 1000,
    RETRY_AFTER_BUFFER_MS: 1000
  };

  const antiSpamState = {
    globalTimestamps: [],              // number[] (ms)
    groupTimestampsMap: new Map(),     // Map<string, number[]>
    chatNextSlotMap: new Map(),        // Map<string, number> (nächster erlaubter Slot pro Chat inkl. Queue-Reservierung)
    chatLastSentMap: new Map(),        // Map<string, number> (tatsächlicher letzter Versand pro Chat)
    floodWaitUntil: 0,                 // Globaler 429 Cooldown (ms)
    lastRetryAfterSec: 0,
    totalEvaluated: 0,
    totalSentImmediate: 0,
    totalQueued: 0,
    totalDrained: 0,
    total429Hits: 0,
    queue: [],                         // Array<{ id, chatId, title, quality, fileId, caption, targetMode, targetTopicId, sourceBridgeChatId, customBotToken, method, status, reason, reasonCode, createdAt, scheduledAt, waitMs, attempts }>
    recentProcessed: [],               // Letzte 20 abgearbeitete Queue-Jobs für Grafik-Cockpit
    hydratedFromStorage: false
  };

  function isGroupOrChannelChatId(chatId) {
    const s = String(chatId || "").trim();
    return s.startsWith("-");
  }

  function pruneAntiSpamSlidingWindows(nowMs = Date.now()) {
    antiSpamState.globalTimestamps = antiSpamState.globalTimestamps.filter(
      ts => (nowMs - ts) < ANTI_SPAM_LIMITS.GLOBAL_WINDOW_MS
    );
    for (const [gChatId, arr] of antiSpamState.groupTimestampsMap.entries()) {
      const pruned = (arr || []).filter(ts => (nowMs - ts) < ANTI_SPAM_LIMITS.GROUP_WINDOW_MS);
      if (pruned.length > 0) {
        antiSpamState.groupTimestampsMap.set(gChatId, pruned);
      } else {
        antiSpamState.groupTimestampsMap.delete(gChatId);
      }
    }
    if (antiSpamState.floodWaitUntil > 0 && nowMs >= antiSpamState.floodWaitUntil) {
      antiSpamState.floodWaitUntil = 0;
    }
  }

  function registerAntiSpam429FloodWait(retryAfterSec = 5, chatId = "") {
    const now = Date.now();
    const sec = Math.max(1, Number(retryAfterSec) || 5);
    const waitMs = (sec * 1000) + ANTI_SPAM_LIMITS.RETRY_AFTER_BUFFER_MS;
    const until = now + waitMs;
    antiSpamState.total429Hits += 1;
    antiSpamState.lastRetryAfterSec = sec;
    if (until > antiSpamState.floodWaitUntil) {
      antiSpamState.floodWaitUntil = until;
    }
    if (chatId) {
      const key = String(chatId).trim();
      const prevNext = antiSpamState.chatNextSlotMap.get(key) || 0;
      antiSpamState.chatNextSlotMap.set(key, Math.max(prevNext, until));
    }
    // Verschiebe alle wartenden Queue-Jobs mindestens hinter das Flood-Wait-Ende
    let offset = 0;
    for (const item of antiSpamState.queue) {
      if (item.status === "queued" && item.scheduledAt < until + offset) {
        item.scheduledAt = until + offset;
        item.waitMs = Math.max(0, item.scheduledAt - now);
        item.reasonCode = "flood_429";
        item.reason = `Telegram 429 retry_after (${sec}s + 1s Puffer)`;
        offset += ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS;
      }
    }
    return { retryAfterSec: sec, floodWaitUntil: until, waitMs };
  }

  function evaluateAntiSpamSlot(chatId, method = "sendVideo", reserveSlot = true) {
    const now = Date.now();
    pruneAntiSpamSlidingWindows(now);
    const key = String(chatId || "default").trim() || "default";
    const isGroup = isGroupOrChannelChatId(key);
    antiSpamState.totalEvaluated += 1;

    let earliestAllowed = now;
    let reasonCode = "ok";
    let reason = "Sofort-Versand (innerhalb Telegram Anti-Spam-Limits)";

    // 1. Prüfe aktiven HTTP 429 Flood-Wait
    if (antiSpamState.floodWaitUntil > now) {
      earliestAllowed = Math.max(earliestAllowed, antiSpamState.floodWaitUntil);
      reasonCode = "flood_429";
      const remSec = Math.ceil((antiSpamState.floodWaitUntil - now) / 1000);
      reason = `429 Too Many Requests aktiv (${remSec}s Cooldown)`;
    }

    // 2. Prüfe globales Bot-Limit (max 25 Nachrichten / 1.000ms)
    if (antiSpamState.globalTimestamps.length >= ANTI_SPAM_LIMITS.GLOBAL_MAX_PER_SEC) {
      const oldestGlobal = antiSpamState.globalTimestamps[0] || now;
      const globalReadyAt = oldestGlobal + ANTI_SPAM_LIMITS.GLOBAL_WINDOW_MS + 50;
      if (globalReadyAt > earliestAllowed) {
        earliestAllowed = globalReadyAt;
        reasonCode = "global_sec";
        reason = `Globales Bot-Limit (${ANTI_SPAM_LIMITS.GLOBAL_MAX_PER_SEC}/Sek. erreicht)`;
      }
    }

    // 3. Prüfe Gruppen-/Kanal-Limit (max 18 Nachrichten / 60.000ms)
    if (isGroup) {
      const groupArr = antiSpamState.groupTimestampsMap.get(key) || [];
      if (groupArr.length >= ANTI_SPAM_LIMITS.GROUP_MAX_PER_MIN) {
        const oldestGroup = groupArr[0] || now;
        const groupReadyAt = oldestGroup + ANTI_SPAM_LIMITS.GROUP_WINDOW_MS + 250;
        if (groupReadyAt > earliestAllowed) {
          earliestAllowed = groupReadyAt;
          reasonCode = "group_min";
          reason = `Gruppen-Anti-Spam (${ANTI_SPAM_LIMITS.GROUP_MAX_PER_MIN}/Min. in ${key} erreicht)`;
        }
      }
    }

    // 4. Prüfe Einzel-Chat-Pacing (1 Nachricht pro 1.150ms + bestehende Warteschlange für diesen Chat)
    const lastSent = antiSpamState.chatLastSentMap.get(key) || 0;
    const nextReserved = antiSpamState.chatNextSlotMap.get(key) || 0;
    const chatPacingAt = Math.max(
      lastSent > 0 ? (lastSent + ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS) : 0,
      nextReserved
    );
    if (chatPacingAt > earliestAllowed) {
      earliestAllowed = chatPacingAt;
      if (reasonCode === "ok") {
        reasonCode = "chat_pacing";
        reason = `Single-Chat Pacing (max. 1 Msg / ${(ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS / 1000).toFixed(2)}s für ${key})`;
      }
    }

    // Falls für diesen Chat bereits Jobs in der Warteschlange stehen, muss auch dieser Job eingereiht werden (FIFO)
    const pendingForChat = antiSpamState.queue.filter(q => q.status === "queued" && String(q.chatId) === key);
    if (pendingForChat.length > 0 && earliestAllowed <= now) {
      const lastQueuedSlot = Math.max(...pendingForChat.map(q => q.scheduledAt || now));
      earliestAllowed = Math.max(now + 300, lastQueuedSlot + ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS);
      reasonCode = "queue_fifo";
      reason = `Warteschleife aktiv (${pendingForChat.length} vorangehende Sendung(en) für ${key})`;
    }

    const waitMs = Math.max(0, earliestAllowed - now);
    const canSendNow = waitMs === 0;

    if (reserveSlot) {
      if (canSendNow) {
        antiSpamState.totalSentImmediate += 1;
        antiSpamState.globalTimestamps.push(now);
        antiSpamState.chatLastSentMap.set(key, now);
        antiSpamState.chatNextSlotMap.set(key, now + ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS);
        if (isGroup) {
          const gArr = antiSpamState.groupTimestampsMap.get(key) || [];
          gArr.push(now);
          antiSpamState.groupTimestampsMap.set(key, gArr);
        }
      } else {
        antiSpamState.chatNextSlotMap.set(key, earliestAllowed + ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS);
      }
    }

    return {
      canSendNow,
      waitMs,
      scheduledAt: earliestAllowed,
      reasonCode,
      reason,
      chatId: key,
      isGroup,
      method
    };
  }

  function recordActualTelegramSendSlot(chatId) {
    const now = Date.now();
    pruneAntiSpamSlidingWindows(now);
    const key = String(chatId || "default").trim() || "default";
    antiSpamState.globalTimestamps.push(now);
    antiSpamState.chatLastSentMap.set(key, now);
    const prevNext = antiSpamState.chatNextSlotMap.get(key) || 0;
    if (prevNext < now + ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS) {
      antiSpamState.chatNextSlotMap.set(key, now + ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS);
    }
    if (isGroupOrChannelChatId(key)) {
      const gArr = antiSpamState.groupTimestampsMap.get(key) || [];
      gArr.push(now);
      antiSpamState.groupTimestampsMap.set(key, gArr);
    }
  }

  async function persistAntiSpamStateToStorage(env) {
    const snapshot = {
      updatedAt: Date.now(),
      floodWaitUntil: antiSpamState.floodWaitUntil,
      lastRetryAfterSec: antiSpamState.lastRetryAfterSec,
      totalEvaluated: antiSpamState.totalEvaluated,
      totalSentImmediate: antiSpamState.totalSentImmediate,
      totalQueued: antiSpamState.totalQueued,
      totalDrained: antiSpamState.totalDrained,
      total429Hits: antiSpamState.total429Hits,
      queue: antiSpamState.queue.slice(0, 100),
      recentProcessed: antiSpamState.recentProcessed.slice(0, 20)
    };
    memoryFallback.set("TG_ANTI_SPAM_STATE_JSON", snapshot);
    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    if (hasD1 && typeof saveEntityToD1 === "function") {
      // D1-first schont Cloudflare KV Free-Plan Limit (1.000 Writes/Tag & max 1 Write/s pro Key!)
      await saveEntityToD1(env, "TG_ANTI_SPAM_STATE_JSON", "anti_spam", snapshot);
      return;
    }
    await kvStageWrite(env, "TG_ANTI_SPAM_STATE_JSON", snapshot, {
      bindingName: "MOVIE_SAVED",
      expirationTtl: 7 * 86400,
      periodicOnly: true
    });
  }

  async function hydrateAntiSpamStateFromStorage(env) {
    if (antiSpamState.hydratedFromStorage) return;
    antiSpamState.hydratedFromStorage = true;
    try {
      let parsed = null;
      const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
      if (hasD1 && typeof getEntityFromD1 === "function") {
        parsed = await getEntityFromD1(env, "TG_ANTI_SPAM_STATE_JSON", 7 * 86400000, { ramTtlMs: 30000 }).catch(() => null);
      }
      if (!parsed) {
        const raw = await kvCachedGetRaw(env, "TG_ANTI_SPAM_STATE_JSON", "MOVIE_SAVED");
        if (raw) parsed = JSON.parse(raw);
      }
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.queue) && antiSpamState.queue.length === 0) {
          antiSpamState.queue = parsed.queue.filter(q => q && q.status === "queued");
        }
        if (Array.isArray(parsed.recentProcessed) && antiSpamState.recentProcessed.length === 0) {
          antiSpamState.recentProcessed = parsed.recentProcessed.slice(0, 20);
        }
        antiSpamState.totalEvaluated = Math.max(antiSpamState.totalEvaluated, Number(parsed.totalEvaluated) || 0);
        antiSpamState.totalSentImmediate = Math.max(antiSpamState.totalSentImmediate, Number(parsed.totalSentImmediate) || 0);
        antiSpamState.totalQueued = Math.max(antiSpamState.totalQueued, Number(parsed.totalQueued) || 0);
        antiSpamState.totalDrained = Math.max(antiSpamState.totalDrained, Number(parsed.totalDrained) || 0);
        antiSpamState.total429Hits = Math.max(antiSpamState.total429Hits, Number(parsed.total429Hits) || 0);
        if (Number(parsed.floodWaitUntil) > Date.now()) {
          antiSpamState.floodWaitUntil = Number(parsed.floodWaitUntil);
        }
      }
    } catch (e) {}
    try {
      const db = await ensureD1Schema(env);
      if (db) {
        trackStat("d1Reads");
        const { results } = await db.prepare(
          "SELECT id, job_id, chat_id, payload_json, scheduled_at, created_at FROM tg_anti_spam_queue WHERE status = 'queued' ORDER BY scheduled_at ASC LIMIT 80"
        ).all();
        if (Array.isArray(results) && results.length > 0) {
          const existingIds = new Set(antiSpamState.queue.map(q => q.id));
          for (const row of results) {
            if (!existingIds.has(row.job_id)) {
              try {
                const jobObj = JSON.parse(row.payload_json);
                if (jobObj && jobObj.id) {
                  antiSpamState.queue.push(jobObj);
                  existingIds.add(jobObj.id);
                }
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {}
  }

  function getAntiSpamSnapshot(env, focusChatId = "") {
    const now = Date.now();
    pruneAntiSpamSlidingWindows(now);
    const activeQueue = antiSpamState.queue
      .filter(q => q && (q.status === "queued" || q.status === "sending"))
      .sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0));

    const globalUsed = antiSpamState.globalTimestamps.length;
    const globalMax = ANTI_SPAM_LIMITS.GLOBAL_MAX_PER_SEC;
    const globalPct = Math.min(100, Math.round((globalUsed / globalMax) * 100));

    // Ermittle höchste Gruppen-Auslastung oder Fokus-Gruppe
    let groupChatKey = focusChatId && isGroupOrChannelChatId(focusChatId) ? String(focusChatId) : "";
    let groupUsed = 0;
    if (groupChatKey && antiSpamState.groupTimestampsMap.has(groupChatKey)) {
      groupUsed = (antiSpamState.groupTimestampsMap.get(groupChatKey) || []).length;
    } else {
      for (const [gKey, gArr] of antiSpamState.groupTimestampsMap.entries()) {
        if (gArr.length >= groupUsed) {
          groupUsed = gArr.length;
          groupChatKey = gKey;
        }
      }
    }
    const groupMax = ANTI_SPAM_LIMITS.GROUP_MAX_PER_MIN;
    const groupPct = Math.min(100, Math.round((groupUsed / groupMax) * 100));

    // Ermittle Single-Chat Pacing Restzeit
    let chatCooldownMs = 0;
    let activePacingChat = focusChatId ? String(focusChatId) : "";
    if (activePacingChat && antiSpamState.chatLastSentMap.has(activePacingChat)) {
      const lastTs = antiSpamState.chatLastSentMap.get(activePacingChat) || 0;
      chatCooldownMs = Math.max(0, (lastTs + ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS) - now);
    } else {
      for (const [cKey, lastTs] of antiSpamState.chatLastSentMap.entries()) {
        const rem = Math.max(0, (lastTs + ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS) - now);
        if (rem > chatCooldownMs) {
          chatCooldownMs = rem;
          activePacingChat = cKey;
        }
      }
    }
    const chatPacingPct = Math.min(100, Math.round((chatCooldownMs / ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS) * 100));

    const floodWaitRemainingMs = Math.max(0, antiSpamState.floodWaitUntil - now);
    const nextDueInMs = activeQueue.length > 0
      ? Math.max(0, (activeQueue[0].scheduledAt || now) - now)
      : 0;

    return {
      now,
      limits: ANTI_SPAM_LIMITS,
      gauges: {
        globalPerSec: {
          used: globalUsed,
          max: globalMax,
          pct: globalPct,
          windowMs: ANTI_SPAM_LIMITS.GLOBAL_WINDOW_MS,
          label: "Globaler Bot-Durchsatz (Sek.)"
        },
        groupPerMin: {
          used: groupUsed,
          max: groupMax,
          pct: groupPct,
          chatId: groupChatKey || "Alle Gruppen",
          windowMs: ANTI_SPAM_LIMITS.GROUP_WINDOW_MS,
          label: "Gruppen-/Kanal-Limit (Min.)"
        },
        singleChatPacing: {
          cooldownMs: chatCooldownMs,
          intervalMs: ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS,
          pct: chatPacingPct,
          chatId: activePacingChat || "Bereit",
          label: "Single-Chat Pacing (1.15s)"
        },
        floodWait429: {
          active: floodWaitRemainingMs > 0,
          remainingMs: floodWaitRemainingMs,
          remainingSec: Math.ceil(floodWaitRemainingMs / 1000),
          lastRetryAfterSec: antiSpamState.lastRetryAfterSec,
          total429Hits: antiSpamState.total429Hits
        }
      },
      stats: {
        totalEvaluated: antiSpamState.totalEvaluated,
        totalSentImmediate: antiSpamState.totalSentImmediate,
        totalQueued: antiSpamState.totalQueued,
        totalDrained: antiSpamState.totalDrained,
        total429Hits: antiSpamState.total429Hits
      },
      queueCount: activeQueue.length,
      nextDueInMs,
      nextDueInSec: Math.ceil(nextDueInMs / 1000),
      queue: activeQueue.slice(0, 25).map((item, idx) => ({
        id: item.id,
        position: idx + 1,
        chatId: item.chatId,
        title: item.title,
        quality: item.quality || "1080p",
        method: item.method || "sendVideo",
        targetMode: item.targetMode || "dm",
        status: item.status,
        reason: item.reason,
        reasonCode: item.reasonCode,
        createdAt: item.createdAt,
        scheduledAt: item.scheduledAt,
        etaMs: Math.max(0, (item.scheduledAt || now) - now),
        etaSec: Math.max(0, Math.ceil(((item.scheduledAt || now) - now) / 1000))
      })),
      recentProcessed: antiSpamState.recentProcessed.slice(0, 12)
    };
  }

  async function enqueueAntiSpamJob(env, jobInput, ctx = null) {
    await hydrateAntiSpamStateFromStorage(env);
    const now = Date.now();
    const jobId = jobInput.id || `asq_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const scheduledAt = Math.max(now + 250, Number(jobInput.scheduledAt) || (now + ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS));
    const job = {
      id: jobId,
      chatId: String(jobInput.chatId || "").trim(),
      title: String(jobInput.title || "Telegram Zustellung").trim(),
      quality: String(jobInput.quality || "1080p").trim(),
      fileId: String(jobInput.fileId || "").trim(),
      caption: String(jobInput.caption || "").trim(),
      targetMode: String(jobInput.targetMode || "dm").trim(),
      targetTopicId: String(jobInput.targetTopicId || "").trim(),
      sourceBridgeChatId: String(jobInput.sourceBridgeChatId || "").trim(),
      customBotToken: String(jobInput.customBotToken || "").trim(),
      posterUrl: String(jobInput.posterUrl || "").trim(),
      backdropUrl: String(jobInput.backdropUrl || "").trim(),
      coverUrl: String(jobInput.coverUrl || "").trim(),
      tmdbId: jobInput.tmdbId ? Number(jobInput.tmdbId) : null,
      typeCode: String(jobInput.typeCode || "").trim(),
      method: String(jobInput.method || "sendVideo").trim(),
      status: "queued",
      reason: String(jobInput.reason || "Telegram Anti-Spam Pacing"),
      reasonCode: String(jobInput.reasonCode || "chat_pacing"),
      createdAt: now,
      scheduledAt,
      waitMs: Math.max(0, scheduledAt - now),
      attempts: Number(jobInput.attempts) || 0
    };

    antiSpamState.queue.push(job);
    antiSpamState.queue.sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0));
    antiSpamState.totalQueued += 1;

    try {
      const db = await ensureD1Schema(env);
      if (db) {
        trackStat("d1Writes");
        await db.prepare(
          "INSERT INTO tg_anti_spam_queue (job_id, chat_id, payload_json, status, scheduled_at, created_at) VALUES (?, ?, ?, 'queued', ?, ?)"
        ).bind(job.id, job.chatId, JSON.stringify(job), job.scheduledAt, job.createdAt).run();
      }
    } catch (e) {}

    await persistAntiSpamStateToStorage(env);

    // Wenn die Wartezeit kurz ist (<= 6,5 Sek.) und ctx.waitUntil verfügbar ist, arbeite den Job automatisch im Hintergrund ab
    const delayMs = Math.max(150, job.scheduledAt - Date.now());
    if (ctx && typeof ctx.waitUntil === "function" && delayMs <= 6500) {
      ctx.waitUntil((async () => {
        await new Promise(res => setTimeout(res, delayMs + 60));
        await drainAntiSpamQueue(env, 4);
      })());
    }

    const position = antiSpamState.queue.findIndex(q => q.id === job.id) + 1;
    return {
      ...job,
      position: position > 0 ? position : antiSpamState.queue.length
    };
  }

  async function enqueueAntiSpamJobsBatch(env, jobInputs, ctx = null) {
    if (!Array.isArray(jobInputs) || jobInputs.length === 0) return [];
    if (jobInputs.length === 1) {
      const single = await enqueueAntiSpamJob(env, jobInputs[0], ctx);
      return single ? [single] : [];
    }
    await hydrateAntiSpamStateFromStorage(env);
    const now = Date.now();
    const randPrefix = Math.random().toString(36).slice(2, 6);
    const jobs = [];
    let earliestScheduledAt = Infinity;

    for (let i = 0; i < jobInputs.length; i++) {
      const jobInput = jobInputs[i] || {};
      const jobId = jobInput.id || `asq_${now}_${i}_${randPrefix}`;
      const scheduledAt = Math.max(now + 250, Number(jobInput.scheduledAt) || (now + ANTI_SPAM_LIMITS.SINGLE_CHAT_MIN_INTERVAL_MS));
      if (scheduledAt < earliestScheduledAt) earliestScheduledAt = scheduledAt;
      const job = {
        id: jobId,
        chatId: String(jobInput.chatId || "").trim(),
        title: String(jobInput.title || "Telegram Zustellung").trim(),
        quality: String(jobInput.quality || "1080p").trim(),
        fileId: String(jobInput.fileId || "").trim(),
        caption: String(jobInput.caption || "").trim(),
        targetMode: String(jobInput.targetMode || "dm").trim(),
        targetTopicId: String(jobInput.targetTopicId || "").trim(),
        sourceBridgeChatId: String(jobInput.sourceBridgeChatId || "").trim(),
        customBotToken: String(jobInput.customBotToken || "").trim(),
        posterUrl: String(jobInput.posterUrl || "").trim(),
        backdropUrl: String(jobInput.backdropUrl || "").trim(),
        coverUrl: String(jobInput.coverUrl || "").trim(),
        tmdbId: jobInput.tmdbId ? Number(jobInput.tmdbId) : null,
        typeCode: String(jobInput.typeCode || "").trim(),
        method: String(jobInput.method || "copyMessages").trim(),
        status: "queued",
        reason: String(jobInput.reason || "Telegram Anti-Spam Pacing"),
        reasonCode: String(jobInput.reasonCode || "chat_pacing"),
        createdAt: now,
        scheduledAt,
        waitMs: Math.max(0, scheduledAt - now),
        attempts: Number(jobInput.attempts) || 0
      };
      jobs.push(job);
      antiSpamState.queue.push(job);
    }

    antiSpamState.queue.sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0));
    antiSpamState.totalQueued += jobs.length;

    try {
      const db = await ensureD1Schema(env);
      const rawDb = typeof getRawD1Binding === "function" ? getRawD1Binding(env) : null;
      if (db && rawDb && typeof rawDb.batch === "function") {
        const CHUNK = 50;
        for (let off = 0; off < jobs.length; off += CHUNK) {
          const slice = jobs.slice(off, off + CHUNK);
          const stmts = slice.map((job) =>
            rawDb.prepare(
              "INSERT INTO tg_anti_spam_queue (job_id, chat_id, payload_json, status, scheduled_at, created_at) VALUES (?, ?, ?, 'queued', ?, ?)"
            ).bind(job.id, job.chatId, JSON.stringify(job), job.scheduledAt, job.createdAt)
          );
          trackStat("d1Writes");
          if (typeof countD1Subrequest === "function") countD1Subrequest();
          await rawDb.batch(stmts);
        }
      } else if (db) {
        for (const job of jobs) {
          trackStat("d1Writes");
          await db.prepare(
            "INSERT INTO tg_anti_spam_queue (job_id, chat_id, payload_json, status, scheduled_at, created_at) VALUES (?, ?, ?, 'queued', ?, ?)"
          ).bind(job.id, job.chatId, JSON.stringify(job), job.scheduledAt, job.createdAt).run();
        }
      }
    } catch (e) {}

    await persistAntiSpamStateToStorage(env);

    // Ein einziger Hintergrund-Timer statt N paralleler Timer
    const delayMs = Math.max(150, (Number.isFinite(earliestScheduledAt) ? earliestScheduledAt : now + 1200) - Date.now());
    if (ctx && typeof ctx.waitUntil === "function" && delayMs <= 6500) {
      const drainCap = Math.min(100, Math.max(6, jobs.length));
      ctx.waitUntil((async () => {
        await new Promise(res => setTimeout(res, delayMs + 60));
        await drainAntiSpamQueue(env, drainCap);
      })());
    }

    return jobs;
  }

  function normalizeWorkerRetentionDays(val) {
    const n = Number(val);
    return (n === 7 || n === 30 || n === 90) ? n : 30;
  }

  async function getWorkerRetentionDays(env, fallbackFromSettings) {
    if (fallbackFromSettings && (Number(fallbackFromSettings) === 7 || Number(fallbackFromSettings) === 30 || Number(fallbackFromSettings) === 90)) {
      return Number(fallbackFromSettings);
    }
    const isBrowserSandbox = typeof localStorage !== "undefined" && typeof window !== "undefined";
    const retTs = Number(memoryFallback.get("TG_LOG_RETENTION_DAYS_ts") || 0);
    if (memoryFallback.has("TG_LOG_RETENTION_DAYS") && (isBrowserSandbox || (Date.now() - retTs) < 60000)) {
      return normalizeWorkerRetentionDays(memoryFallback.get("TG_LOG_RETENTION_DAYS"));
    }
    try {
      const raw = await kvCachedGetRaw(env, "TG_LOG_RETENTION_DAYS", "MOVIE_SAVED", { ttlMs: 60000 });
      if (raw) {
        const norm = normalizeWorkerRetentionDays(raw);
        memoryFallback.set("TG_LOG_RETENTION_DAYS", norm);
        memoryFallback.set("TG_LOG_RETENTION_DAYS_ts", Date.now());
        return norm;
      }
    } catch (e) {}
    memoryFallback.set("TG_LOG_RETENTION_DAYS", 30);
    memoryFallback.set("TG_LOG_RETENTION_DAYS_ts", Date.now());
    return 30;
  }

  async function recordAndPruneWorkerActivityLog(env, newEntry = null, retentionDaysOverride = null) {
    const retentionDays = retentionDaysOverride
      ? normalizeWorkerRetentionDays(retentionDaysOverride)
      : await getWorkerRetentionDays(env, null);
    const ttlSeconds = retentionDays * 86400;
    const cutoffMs = Date.now() - (retentionDays * 86400 * 1000);

    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    let rawList = [];
    const memListTs = Number(memoryFallback.get("TG_ACTIVITY_LOG_JSON_ts") || 0);
    const isBrowserSandbox = typeof localStorage !== "undefined" && typeof window !== "undefined";
    const memList = memoryFallback.get("TG_ACTIVITY_LOG_JSON");
    if (Array.isArray(memList) && (isBrowserSandbox || (Date.now() - memListTs) < 20000)) {
      rawList = memList;
    } else {
      try {
        let loaded = null;
        if (hasD1 && typeof getEntityFromD1 === "function") {
          loaded = await getEntityFromD1(env, "TG_ACTIVITY_LOG_JSON", 365 * 86400000, { ramTtlMs: 20000 }).catch(() => null);
        }
        if (Array.isArray(loaded)) {
          rawList = loaded;
        } else {
          const str = await kvCachedGetRaw(env, "TG_ACTIVITY_LOG_JSON", "MOVIE_SAVED");
          if (str) {
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) rawList = parsed;
          }
        }
      } catch (e) {}
    }

    const beforeCount = rawList.length;
    const kept = rawList.filter((item) => {
      if (!item || !item.timestamp) return true;
      const ts = new Date(item.timestamp).getTime();
      return Number.isNaN(ts) || ts >= cutoffMs;
    });
    const prunedCount = Math.max(0, beforeCount - kept.length);

    if (newEntry && typeof newEntry === "object") {
      kept.unshift({
        id: `tg_act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        ...newEntry
      });
    }

    const finalEntries = kept.slice(0, 100);
    memoryFallback.set("TG_ACTIVITY_LOG_JSON", finalEntries);
    memoryFallback.set("TG_ACTIVITY_LOG_JSON_ts", Date.now());
    memoryFallback.set("TG_LOG_RETENTION_DAYS", retentionDays);
    memoryFallback.set("TG_LOG_RETENTION_DAYS_ts", Date.now());

    if (newEntry || retentionDaysOverride !== null || prunedCount > 0) {
      if (hasD1 && typeof saveEntityToD1 === "function") {
        // D1-first: 0 KV-Writes pro Stream/Event (schont 1.000 KV-Writes/Tag Free-Plan Limit!)
        await saveEntityToD1(env, "TG_ACTIVITY_LOG_JSON", "activity_log", finalEntries);
      } else {
        await kvStageWrite(env, "TG_ACTIVITY_LOG_JSON", finalEntries, {
          bindingName: "MOVIE_SAVED",
          expirationTtl: ttlSeconds,
          periodicOnly: retentionDaysOverride === null
        });
      }
      if (retentionDaysOverride !== null) {
        await kvStageWrite(env, "TG_LOG_RETENTION_DAYS", String(retentionDays), {
          bindingName: "MOVIE_SAVED",
          periodicOnly: false,
          flushNow: true
        });
      }
    }

    return { entries: finalEntries, retentionDays, ttlSeconds, prunedCount };
  }

  let isDrainingAntiSpamQueue = false;
  async function drainAntiSpamQueue(env, maxJobs = 6, forceImmediate = false) {
    await hydrateAntiSpamStateFromStorage(env);
    if (isDrainingAntiSpamQueue) {
      return { drainedCount: 0, snapshot: getAntiSpamSnapshot(env) };
    }
    isDrainingAntiSpamQueue = true;
    let drainedCount = 0;
    try {
      const now = Date.now();
      pruneAntiSpamSlidingWindows(now);
      if (!forceImmediate && antiSpamState.floodWaitUntil > now) {
        return { drainedCount: 0, snapshot: getAntiSpamSnapshot(env) };
      }

      const dueJobs = antiSpamState.queue
        .filter(q => q && q.status === "queued" && (forceImmediate || (q.scheduledAt || 0) <= Date.now()))
        .sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0))
        .slice(0, maxJobs);

      // Moderne Telegram Bot API 7.0+ copyMessages-Bündelung für aufeinanderfolgende Quellgruppen-Jobs
      // (gleicher Ziel-Chat, Topic, Bot-Token & Quell-Kanal mit strikt aufsteigenden message_ids -> 1 API-Call statt N!)
      const handledJobIds = new Set();
      let idx = 0;
      while (idx < dueJobs.length) {
        const firstJob = dueJobs[idx];
        const firstRef = parseTgExportRef(firstJob?.fileId, env, firstJob?.sourceBridgeChatId);
        const firstToken = getBotToken(env, firstJob?.customBotToken);
        if (firstRef && firstToken && !String(firstJob.fileId || "").startsWith("sim_burst_")) {
          const group = [firstJob];
          const msgIds = [firstRef.messageId];
          let look = idx + 1;
          while (look < dueJobs.length && group.length < 100) {
            const nextJob = dueJobs[look];
            const nextRef = parseTgExportRef(nextJob?.fileId, env, nextJob?.sourceBridgeChatId);
            const nextToken = getBotToken(env, nextJob?.customBotToken);
            if (
              nextRef &&
              nextToken === firstToken &&
              String(nextJob.chatId || "") === String(firstJob.chatId || "") &&
              String(nextJob.targetTopicId || "") === String(firstJob.targetTopicId || "") &&
              nextRef.fromChatId === firstRef.fromChatId &&
              nextRef.messageId > msgIds[msgIds.length - 1]
            ) {
              group.push(nextJob);
              msgIds.push(nextRef.messageId);
              look++;
            } else {
              break;
            }
          }
          if (group.length >= 2) {
            const startBatchMs = Date.now();
            group.forEach(j => {
              j.status = "sending";
              j.attempts = (j.attempts || 0) + 1;
            });
            const batchRes = await tgApi(env).copyMessagesBatch(firstJob.chatId, firstRef.fromChatId, msgIds, {
              customBotToken: firstJob.customBotToken,
              messageThreadId: firstJob.targetTopicId
            }).catch(() => null);
            if (batchRes && batchRes.ok) {
              const delIds = new Set(group.map(j => j.id));
              group.forEach(j => handledJobIds.add(j.id));
              drainedCount += group.length;
              antiSpamState.totalDrained += group.length;
              antiSpamState.queue = antiSpamState.queue.filter(q => !delIds.has(q.id));
              for (const j of group) {
                antiSpamState.recentProcessed.unshift({
                  id: j.id,
                  chatId: j.chatId,
                  title: j.title,
                  quality: j.quality,
                  method: `copyMessages (Batch x${group.length})`,
                  reason: j.reason,
                  waitedMs: Math.max(0, Date.now() - (j.createdAt || startBatchMs)),
                  completedAt: Date.now(),
                  status: "delivered"
                });
              }
              if (antiSpamState.recentProcessed.length > 25) {
                antiSpamState.recentProcessed = antiSpamState.recentProcessed.slice(0, 25);
              }
              try {
                const db = await ensureD1Schema(env);
                if (db) {
                  trackStat("d1Writes");
                  const stmts = group.map(j => db.prepare("DELETE FROM tg_anti_spam_queue WHERE job_id = ?").bind(j.id));
                  if (typeof db.batch === "function" && stmts.length > 1) {
                    await db.batch(stmts);
                  } else {
                    for (const st of stmts) await st.run();
                  }
                }
              } catch (e) {}
              if (typeof recordAndPruneWorkerActivityLog === "function") {
                await recordAndPruneWorkerActivityLog(env, {
                  eventType: "delivery",
                  status: "success",
                  deliveryMode: firstJob.targetMode || "dm",
                  method: `copyMessages (Batch x${group.length})`,
                  title: `${firstJob.title} (+${group.length - 1} weitere)`,
                  targetChatId: firstJob.chatId,
                  durationMs: Math.max(1, Date.now() - startBatchMs),
                  summary: `⚡ ${group.length} Queue-Jobs in 1 copyMessages-Aufruf an ${firstJob.chatId} zugestellt`
                });
              }
              idx = look;
              continue;
            } else if (batchRes && batchRes.throttled429) {
              group.forEach(j => {
                handledJobIds.add(j.id);
                j.status = "queued";
                j.scheduledAt = Math.max(Date.now() + 2000, antiSpamState.floodWaitUntil);
                j.reason = `429 retry_after (${batchRes.retryAfter || 5}s)`;
              });
              break;
            } else {
              // Fallback: Einzeln versuchen (z. B. falls 1 gelöschte Nachricht im Batch war)
              group.forEach(j => {
                j.status = "queued";
                j.attempts = Math.max(0, (j.attempts || 1) - 1);
              });
            }
          }
        }
        idx++;
      }

      for (const job of dueJobs) {
        if (handledJobIds.has(job.id)) continue;
        job.status = "sending";
        job.attempts = (job.attempts || 0) + 1;
        const startMs = Date.now();
        let deliveredOk = false;
        let simulated = false;
        let errorMsg = "";

        try {
          const effectiveToken = getBotToken(env, job.customBotToken);
          if (!effectiveToken || job.fileId.startsWith("sim_burst_")) {
            // Sandbox- oder Simulations-Job
            simulated = true;
            deliveredOk = true;
            recordActualTelegramSendSlot(job.chatId);
          } else if (job.fileId.startsWith("tmdb_card_")) {
            const msgRes = await tgApi({ ...env, TELEGRAM_BOT_TOKEN: effectiveToken }).sendMessage(
              job.chatId,
              job.caption || `🎬 *${escapeMd(job.title)}*`,
              job.targetTopicId && /^\d+$/.test(job.targetTopicId)
                ? { message_thread_id: parseInt(job.targetTopicId, 10), _fromAntiSpamQueue: true }
                : { _fromAntiSpamQueue: true }
            );
            deliveredOk = Boolean(msgRes && !msgRes._throttled429);
            if (msgRes && msgRes._throttled429) {
              errorMsg = `429 retry_after (${msgRes.retryAfter || 5}s)`;
            }
          } else {
            const sent = await tgApi(env).deliverMediaOrCopyFromSource(job.chatId, job.fileId, job.caption, {
              customBotToken: job.customBotToken,
              messageThreadId: job.targetTopicId,
              sourceBridgeChatId: job.sourceBridgeChatId,
              posterUrl: job.posterUrl || "",
              backdropUrl: job.backdropUrl || "",
              coverUrl: job.coverUrl || "",
              tmdbId: job.tmdbId || null,
              typeCode: job.typeCode || "",
              _fromAntiSpamQueue: true
            });
            deliveredOk = Boolean(sent && sent.ok);
          }
        } catch (err) {
          errorMsg = err?.message || "Queue-Versand fehlgeschlagen";
        }

        if (deliveredOk) {
          drainedCount += 1;
          antiSpamState.totalDrained += 1;
          antiSpamState.queue = antiSpamState.queue.filter(q => q.id !== job.id);
          antiSpamState.recentProcessed.unshift({
            id: job.id,
            chatId: job.chatId,
            title: job.title,
            quality: job.quality,
            method: simulated ? `${job.method} (Queue/Sandbox)` : `${job.method} (Queue)`,
            reason: job.reason,
            waitedMs: Math.max(0, Date.now() - (job.createdAt || startMs)),
            completedAt: Date.now(),
            status: "delivered"
          });
          if (antiSpamState.recentProcessed.length > 25) {
            antiSpamState.recentProcessed = antiSpamState.recentProcessed.slice(0, 25);
          }

          try {
            const db = await ensureD1Schema(env);
            if (db) {
              trackStat("d1Writes");
              await db.prepare("DELETE FROM tg_anti_spam_queue WHERE job_id = ?").bind(job.id).run();
            }
          } catch (e) {}

          if (typeof recordAndPruneWorkerActivityLog === "function") {
            await recordAndPruneWorkerActivityLog(env, {
              eventType: "delivery",
              status: "success",
              deliveryMode: job.targetMode || "dm",
              method: `${job.method} (Anti-Spam Queue)`,
              title: `${job.title} (${job.quality})`,
              targetChatId: job.chatId,
              durationMs: Math.max(1, Date.now() - (job.createdAt || startMs)),
              summary: `⏳➔✅ Aus Warteschleife zugestellt an ${job.chatId} (${job.reason})`
            });
          }
        } else {
          // Bei 429 oder temporärem Fehler erneut für später einplanen (max 3 Versuche)
          if (job.attempts < 3) {
            job.status = "queued";
            const extraWait = Math.max(2000, antiSpamState.floodWaitUntil - Date.now(), 1500 * job.attempts);
            job.scheduledAt = Date.now() + extraWait;
            job.reason = errorMsg || `Retry #${job.attempts} nach Anti-Spam Pause`;
          } else {
            antiSpamState.queue = antiSpamState.queue.filter(q => q.id !== job.id);
            antiSpamState.recentProcessed.unshift({
              id: job.id,
              chatId: job.chatId,
              title: job.title,
              quality: job.quality,
              method: job.method,
              reason: errorMsg || "Max. Versuche erreicht",
              waitedMs: Math.max(0, Date.now() - (job.createdAt || startMs)),
              completedAt: Date.now(),
              status: "failed"
            });
            try {
              const db = await ensureD1Schema(env);
              if (db) {
                await db.prepare("DELETE FROM tg_anti_spam_queue WHERE job_id = ?").bind(job.id).run();
              }
            } catch (e) {}
          }
        }
      }

      if (dueJobs.length > 0) {
        await persistAntiSpamStateToStorage(env);
      }
    } finally {
      isDrainingAntiSpamQueue = false;
    }
    return {
      drainedCount,
      snapshot: getAntiSpamSnapshot(env)
    };
  }

  // --- Bot API 8.3 Video-Cover-Embedding Modus ("backdrop" | "poster" | "off") ---
  function normalizeVideoCoverMode(val) {
    const v = String(val || "").trim().toLowerCase();
    if (v === "poster" || v === "off" || v === "backdrop") return v;
    return "backdrop";
  }

  async function getVideoCoverMode(env) {
    const isBrowserSandbox = typeof localStorage !== "undefined" && typeof window !== "undefined";
    const coverTs = Number(memoryFallback.get("TG_VIDEO_COVER_MODE_ts") || 0);
    if (memoryFallback.has("TG_VIDEO_COVER_MODE") && (isBrowserSandbox || (Date.now() - coverTs) < 60000)) {
      return normalizeVideoCoverMode(memoryFallback.get("TG_VIDEO_COVER_MODE"));
    }
    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    if (hasD1 && typeof getEntityFromD1 === "function") {
      try {
        const fromD1 = await getEntityFromD1(env, "TG_VIDEO_COVER_MODE", 3650 * 86400000, { ramTtlMs: 60000 });
        const d1Val = typeof fromD1 === "string" ? fromD1 : (fromD1 && typeof fromD1 === "object" ? fromD1.mode : "");
        if (d1Val) {
          const mode = normalizeVideoCoverMode(d1Val);
          memoryFallback.set("TG_VIDEO_COVER_MODE", mode);
          memoryFallback.set("TG_VIDEO_COVER_MODE_ts", Date.now());
          return mode;
        }
      } catch (e) {}
    }
    try {
      const raw = await kvCachedGetRaw(env, "TG_VIDEO_COVER_MODE", "MOVIE_SAVED", { ttlMs: 60000 });
      if (raw) {
        const mode = normalizeVideoCoverMode(raw);
        memoryFallback.set("TG_VIDEO_COVER_MODE", mode);
        memoryFallback.set("TG_VIDEO_COVER_MODE_ts", Date.now());
        if (hasD1 && typeof saveEntityToD1 === "function") {
          saveEntityToD1(env, "TG_VIDEO_COVER_MODE", "config", { mode, updatedAt: Date.now() }).catch(() => {});
        }
        return mode;
      }
    } catch (e) {}
    memoryFallback.set("TG_VIDEO_COVER_MODE", "backdrop");
    memoryFallback.set("TG_VIDEO_COVER_MODE_ts", Date.now());
    return "backdrop";
  }

  async function setVideoCoverMode(env, modeInput) {
    const mode = normalizeVideoCoverMode(modeInput);
    memoryFallback.set("TG_VIDEO_COVER_MODE", mode);
    memoryFallback.set("TG_VIDEO_COVER_MODE_ts", Date.now());
    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    if (hasD1 && typeof saveEntityToD1 === "function") {
      try {
        await saveEntityToD1(env, "TG_VIDEO_COVER_MODE", "config", { mode, updatedAt: Date.now() });
        return mode;
      } catch (e) {}
    }
    try {
      await kvStageWrite(env, "TG_VIDEO_COVER_MODE", mode, {
        bindingName: "MOVIE_SAVED",
        periodicOnly: false,
        flushNow: true
      });
    } catch (e) {}
    return mode;
  }

  function toHighResTmdbImageUrl(rawUrlOrPath, size = "w1280") {
    const raw = String(rawUrlOrPath || "").trim();
    if (!raw || raw.includes("placehold.co")) return "";
    if (raw.startsWith("https://image.tmdb.org/t/p/")) {
      return raw.replace(/\/t\/p\/(?:w\d+|original)\//, `/t/p/${size}/`);
    }
    if (raw.startsWith("https://") || raw.startsWith("http://")) {
      return raw;
    }
    if (raw.startsWith("/")) {
      return `https://image.tmdb.org/t/p/${size}${raw}`;
    }
    return "";
  }

  async function resolveVideoCoverUrlForDelivery(env, extraOpts = {}) {
    if (!extraOpts || extraOpts.disableCover === true) return "";
    const mode = extraOpts.coverModeOverride
      ? normalizeVideoCoverMode(extraOpts.coverModeOverride)
      : await getVideoCoverMode(env);
    if (mode === "off") return "";

    const explicitCover = toHighResTmdbImageUrl(extraOpts.coverUrl, mode === "poster" ? "w780" : "w1280");
    if (explicitCover) return explicitCover;

    let backdropCandidate = toHighResTmdbImageUrl(extraOpts.backdropUrl, "w1280");
    let posterCandidate = toHighResTmdbImageUrl(extraOpts.posterUrl, "w780");

    // Falls weder Backdrop noch Poster übergeben wurden, versuche anhand von tmdbId aus D1 aufzulösen
    const tmdbId = Number(extraOpts.tmdbId || 0);
    if (!backdropCandidate && !posterCandidate && tmdbId > 0) {
      const typeCode = String(extraOpts.typeCode || "m").toLowerCase().startsWith("s") ? "s" : "m";
      try {
        const db = await ensureD1Schema(env);
        if (db) {
          const table = typeCode === "s" ? "series" : "movies";
          const row = await db.prepare(`SELECT poster_path, backdrop_path, external_poster_url FROM ${table} WHERE tmdb_id = ?1 LIMIT 1`).bind(tmdbId).first().catch(() => null);
          if (row) {
            backdropCandidate = toHighResTmdbImageUrl(row.backdrop_path, "w1280");
            posterCandidate = toHighResTmdbImageUrl(row.poster_path || row.external_poster_url, "w780");
          }
        }
      } catch (e) {}
    }

    if (mode === "poster") {
      return posterCandidate || backdropCandidate || "";
    }
    return backdropCandidate || posterCandidate || "";
  }

  // --- Worker Geschwindigkeits-Profile (Cloudflare Free-Tier Turbo vs. Ausgewogen vs. Paid Pro) ---
  const WORKER_SPEED_PROFILES = {
    free_turbo: {
      id: "free_turbo",
      label: "🛡️ Cloudflare Free-Tier Turbo (<10ms CPU Micro-Batch)",
      batchSize: 4,
      wallClockLimitMs: 3600,
      subrequestGuard: 18,
      midBatchSubrequestGuard: 18,
      tmdbTimeoutMs: 2000,
      fallbackMode: "smart_emergency", // Nur TMDb DE/EN + 1,5s Notfall-Fallback wenn 0 TMDb-Treffer & Budget frei
      fallbackTimeoutMs: 1500
    },
    balanced: {
      id: "balanced",
      label: "⚖️ Ausgewogen (Standard)",
      batchSize: 8,
      wallClockLimitMs: 4800,
      subrequestGuard: 26,
      midBatchSubrequestGuard: 26,
      tmdbTimeoutMs: 2400,
      fallbackMode: "balanced",
      fallbackTimeoutMs: 2000
    },
    paid_pro: {
      id: "paid_pro",
      label: "🚀 Cloudflare Paid ($5 Plan / High-Throughput)",
      batchSize: 24,
      wallClockLimitMs: 6800,
      subrequestGuard: 40,
      midBatchSubrequestGuard: 40,
      tmdbTimeoutMs: 3500,
      fallbackMode: "deep",
      fallbackTimeoutMs: 3200
    }
  };

  // --- Echtzeit Worker-Health-Monitor Telemetrie & CPU-Schätzung (<10ms Cloudflare Free-Tier Guard) ---
  if (!globalThis.__WORKER_HEALTH_HISTORY) {
    globalThis.__WORKER_HEALTH_HISTORY = [];
  }
  const activeWorkerTelemetry = {
    requestStartMs: 0,
    syncCpuAccumMs: 0,
    d1OpsCount: 0,
    jsonBytesParsed: 0,
    cacheHit: false,
    route: ""
  };

  function getActiveWorkerTelemetry() {
    const reqCtx = typeof getActiveWorkerRequestContext === "function" ? getActiveWorkerRequestContext() : null;
    if (reqCtx && reqCtx.telemetry) return reqCtx.telemetry;
    return activeWorkerTelemetry;
  }

  function beginWorkerRequestTelemetry(route = "") {
    const tel = getActiveWorkerTelemetry();
    tel.requestStartMs = Date.now();
    tel.syncCpuAccumMs = 0;
    tel.d1OpsCount = 0;
    tel.jsonBytesParsed = 0;
    tel.cacheHit = false;
    tel.route = String(route || "");
  }

  function recordWorkerSyncCpuSpan(ms = 0, jsonBytes = 0, d1Ops = 0) {
    const tel = getActiveWorkerTelemetry();
    if (ms > 0) tel.syncCpuAccumMs += Number(ms);
    if (jsonBytes > 0) tel.jsonBytesParsed += Number(jsonBytes);
    if (d1Ops > 0) tel.d1OpsCount += Number(d1Ops);
  }

  function buildWorkerHealthSnapshot(extra = {}) {
    const tel = getActiveWorkerTelemetry();
    const now = Date.now();
    const wallMs = tel.requestStartMs > 0
      ? Math.max(1, now - tel.requestStartMs)
      : 1;
    const subreqs = typeof getInvocationSubrequests === "function" ? getInvocationSubrequests() : 0;
    const d1Ops = Math.max(tel.d1OpsCount, Number(extra.d1Ops || 0));
    const jsonKb = tel.jsonBytesParsed / 1024;
    // Realistische Cloudflare V8 Isolate CPU-Kalkulation (Sync-JS + JSON-Serialisierung + Subrequest/D1-Binding-Overhead)
    const rawCpuEst = 0.45 +
      tel.syncCpuAccumMs +
      (jsonKb * 0.085) +
      (d1Ops * 0.38) +
      (subreqs * 0.28);
    const cpuMs = Number(Math.min(25, Math.max(0.4, rawCpuEst)).toFixed(2));
    const approachingLimit = cpuMs >= 6.4 || subreqs >= 14 || wallMs >= 3000;
    const criticalLimit = cpuMs >= 8.2 || subreqs >= 22 || wallMs >= 4600;
    const status = criticalLimit ? "critical" : approachingLimit ? "warning" : "optimal";
    const recommendedBatchSize = criticalLimit ? 1 : approachingLimit ? 2 : 4;
    const cooldownMs = criticalLimit ? 2600 : approachingLimit ? 1200 : 0;
    const entry = {
      ts: now,
      route: tel.route || extra.route || "/api/tma",
      cpuMs,
      wallMs,
      subrequests: subreqs,
      d1Ops,
      cacheHit: Boolean(tel.cacheHit || extra.cacheHit),
      status,
      recommendedBatchSize,
      cooldownMs
    };
    const hist = globalThis.__WORKER_HEALTH_HISTORY;
    hist.unshift(entry);
    if (hist.length > 20) hist.length = 20;
    return {
      ...entry,
      recentHistory: hist.slice(0, 12)
    };
  }

  // --- Webhook-Passwort (secret_token) 0ms Edge-Gatekeeper & Anti-Retry-Storm Schutz ---
  if (!globalThis.__RECENT_TG_UPDATE_IDS) {
    globalThis.__RECENT_TG_UPDATE_IDS = new Set();
  }

  function isDuplicateTelegramUpdateId(updateId) {
    const idNum = Number(updateId || 0);
    if (!idNum) return false;
    const set = globalThis.__RECENT_TG_UPDATE_IDS;
    if (set.has(idNum)) return true;
    set.add(idNum);
    if (set.size > 1000) {
      const firstVal = set.values().next().value;
      if (firstVal !== undefined) set.delete(firstVal);
    }
    return false;
  }

  function sanitizeWebhookSecretToken(rawSecret) {
    // Offizielle Telegram setWebhook secret_token Vorgabe: 1-256 Zeichen, nur A-Z, a-z, 0-9, _ und -
    if (rawSecret === null || rawSecret === undefined || typeof rawSecret === "object") {
      return "";
    }
    const clean = String(rawSecret)
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .slice(0, 128);
    // Selbstheilung gegen frühere Objekt-Serialisierung ("[object Object]" -> "_object_Object_")
    if (clean === "_object_Object_" || clean === "object_Object") return "";
    return clean;
  }

  function getBotToken(env, overrideToken = "") {
    const ov = String(overrideToken || "").trim();
    if (ov) return ov;
    return String(env?.TELEGRAM_BOT_TOKEN || env?.BOT_TOKEN || "").trim();
  }

  function parseTgExportRef(fileIdOrRef, env = null, sourceBridgeChatId = "") {
    const m = String(fileIdOrRef || "").trim().match(/^tg_export_(-?\d+)_(\d+)$/i);
    if (!m) return null;
    const rawChannelId = m[1];
    const messageId = parseInt(m[2], 10);
    if (!Number.isInteger(messageId) || messageId <= 0) return null;
    const overrideBridge = String(sourceBridgeChatId || env?.SOURCE_GROUP_CHAT_ID || "").trim();
    const fromChatId = overrideBridge || (rawChannelId.startsWith("-100") || rawChannelId.startsWith("-") ? rawChannelId : `-100${rawChannelId}`);
    return { rawChannelId, fromChatId, messageId };
  }

  const WEBHOOK_CONFIG_CACHE_TTL_MS = 300000;
  const WEBHOOK_SECRET_GRACE_WINDOW_MS = 300000;
  const WEBHOOK_MISMATCH_REVAL_MIN_INTERVAL_MS = 10000;

  async function getWebhookSecurityConfig(env, options = {}) {
    const forceRefresh = Boolean(options?.forceRefresh);
    if (
      !forceRefresh &&
      globalThis.__WEBHOOK_SECURITY_CONFIG_CACHE &&
      (Date.now() - Number(globalThis.__WEBHOOK_SECURITY_CONFIG_CACHE.loadedAt || 0)) < WEBHOOK_CONFIG_CACHE_TTL_MS
    ) {
      return globalThis.__WEBHOOK_SECURITY_CONFIG_CACHE;
    }
    const envSecret = sanitizeWebhookSecretToken(env?.TELEGRAM_WEBHOOK_SECRET || env?.WEBHOOK_SECRET || "");
    let secretToken = envSecret;
    let previousSecretToken = "";
    let previousSecretExpiresAt = 0;
    let maxConnections = 8;
    let explicitlyDisabled = false;
    let updatedAt = 0;
    let source = envSecret ? "env" : "none";
    const isBrowserSandbox = typeof localStorage !== "undefined" && typeof window !== "undefined";

    const applyStoredObj = (obj, srcLabel) => {
      if (!obj || typeof obj !== "object") return false;
      if (obj.secretToken !== undefined) secretToken = sanitizeWebhookSecretToken(obj.secretToken);
      if (obj.previousSecretToken !== undefined) previousSecretToken = sanitizeWebhookSecretToken(obj.previousSecretToken);
      if (obj.previousSecretExpiresAt) previousSecretExpiresAt = Number(obj.previousSecretExpiresAt) || 0;
      if (obj.maxConnections) maxConnections = Math.min(40, Math.max(1, Number(obj.maxConnections) || 8));
      if (obj.explicitlyDisabled !== undefined) explicitlyDisabled = Boolean(obj.explicitlyDisabled);
      else if (obj.secretToken === "") explicitlyDisabled = true;
      updatedAt = Number(obj.updatedAt || 0);
      source = srcLabel;
      return true;
    };

    try {
      const memCfg = isBrowserSandbox ? memoryFallback.get("TG_WEBHOOK_SECURITY_CONFIG_V1") : null;
      if (memCfg && typeof memCfg === "object") {
        applyStoredObj(memCfg, "memory");
      } else {
        // D1 & KV parallel laden und per updatedAt vergleichen (D1 gewinnt bei Gleichstand):
        // Verhindert zuverlässig, dass ein veralteter D1-Eintrag ein neueres KV-Secret überschreibt (401 nach Deploy)
        // UND dass ein veralteter/limitierter KV-Eintrag ein neueres D1-Secret überschreibt!
        const [d1Cfg, rawKv] = await Promise.all([
          typeof getEntityFromD1 === "function"
            ? getEntityFromD1(env, "TG_WEBHOOK_SECURITY_CONFIG_V1", 365 * 86400000, {
                bypassMemoryCache: true,
                ramTtlMs: WEBHOOK_CONFIG_CACHE_TTL_MS
              }).catch(() => null)
            : Promise.resolve(null),
          kvCachedGetRaw(env, "TG_WEBHOOK_SECURITY_CONFIG_V1", "MOVIE_SAVED", {
            ttlMs: WEBHOOK_CONFIG_CACHE_TTL_MS,
            bypassMemoryCache: true
          }).catch(() => null)
        ]);
        let kvCfg = null;
        if (rawKv) {
          try {
            const parsed = JSON.parse(rawKv);
            if (parsed && typeof parsed === "object") kvCfg = parsed;
          } catch (_parseErr) {}
        }
        const hasD1 = Boolean(d1Cfg && typeof d1Cfg === "object");
        const hasKv = Boolean(kvCfg && typeof kvCfg === "object");
        if (hasD1 && hasKv) {
          const d1Ts = Number(d1Cfg.updatedAt || d1Cfg.loadedAt || 0);
          const kvTs = Number(kvCfg.updatedAt || kvCfg.loadedAt || 0);
          if (kvTs > d1Ts) {
            applyStoredObj(kvCfg, "kv");
            // D1 still im Hintergrund auf den neueren KV-Stand nachziehen (Self-Healing)
            if (typeof saveEntityToD1 === "function") {
              saveEntityToD1(env, "TG_WEBHOOK_SECURITY_CONFIG_V1", "config", kvCfg).catch(() => {});
            }
          } else {
            applyStoredObj(d1Cfg, "d1");
          }
        } else if (hasD1) {
          applyStoredObj(d1Cfg, "d1");
        } else if (hasKv) {
          applyStoredObj(kvCfg, "kv");
          if (typeof saveEntityToD1 === "function") {
            saveEntityToD1(env, "TG_WEBHOOK_SECURITY_CONFIG_V1", "config", kvCfg).catch(() => {});
          }
        }
      }
    } catch (e) {}

    // Expire stale previousSecretToken cleanly
    if (previousSecretExpiresAt && Date.now() > previousSecretExpiresAt) {
      previousSecretToken = "";
      previousSecretExpiresAt = 0;
    }

    const envSecretConflict = Boolean(
      envSecret && (
        explicitlyDisabled ||
        (source !== "env" && secretToken !== envSecret)
      )
    );

    const cfg = {
      secretToken,
      previousSecretToken,
      previousSecretExpiresAt,
      maxConnections,
      explicitlyDisabled,
      updatedAt,
      source,
      hasEnvSecret: Boolean(envSecret),
      envSecretConflict,
      loadedAt: Date.now()
    };
    globalThis.__WEBHOOK_SECURITY_CONFIG_CACHE = cfg;
    memoryFallback.set("TG_WEBHOOK_SECURITY_CONFIG_V1", cfg);
    return cfg;
  }

  // 0-IO Fast-Path für Telegram Webhook-Secret Prüfung mit konsistentem Cold-Start/Warm-Cache-Verhalten,
  // Dual-Secret-Grace-Window (Rotation ohne 401) & rate-limitierter Mismatch-Revalidierung (max. 1x / 10s).
  async function verifyWebhookSecretFast(request, url, env, options = {}) {
    const allowQuerySecret = options.allowQuerySecret !== false;
    const incomingHeader = String(request?.headers?.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
    const incomingQuery = allowQuerySecret ? String(url?.searchParams?.get("secret") || "").trim() : "";
    const hasHeader = Boolean(incomingHeader);
    const hasQuery = Boolean(incomingQuery);
    const eqSecret = typeof timingSafeEqualStr === "function" ? timingSafeEqualStr : ((a, b) => a === b);
    const matchesCandidate = (expected) => Boolean(
      expected && (
        (incomingHeader && eqSecret(incomingHeader, expected)) ||
        (incomingQuery && eqSecret(incomingQuery, expected))
      )
    );
    const matchesCfg = (cfg) => {
      if (!cfg) return { ok: false, hasSecret: false, matchedPrev: false };
      const curSec = String(cfg.secretToken || "").trim();
      const prevSec = String(cfg.previousSecretToken || "").trim();
      const prevValid = Boolean(prevSec && Number(cfg.previousSecretExpiresAt || 0) > Date.now());
      if (!curSec) {
        return { ok: true, hasSecret: false, matchedPrev: false };
      }
      if (matchesCandidate(curSec)) {
        return { ok: true, hasSecret: true, matchedPrev: false };
      }
      if (prevValid && matchesCandidate(prevSec)) {
        return { ok: true, hasSecret: true, matchedPrev: true };
      }
      return { ok: false, hasSecret: true, matchedPrev: false };
    };

    const cachedCfg = globalThis.__WEBHOOK_SECURITY_CONFIG_CACHE;
    const hasWarmCache = Boolean(cachedCfg && (Date.now() - Number(cachedCfg.loadedAt || 0)) < WEBHOOK_CONFIG_CACHE_TTL_MS);

    // Fast-Path 1: Warmer RAM-Cache vorhanden -> sofortige 0-IO Entscheidung!
    if (hasWarmCache) {
      const check = matchesCfg(cachedCfg);
      if (check.ok) {
        return {
          ok: true,
          fastPath: !check.hasSecret ? "cache_open" : (check.matchedPrev ? "cache_prev_grace" : "cache_match"),
          hasSecret: check.hasSecret,
          hasHeader,
          hasQuery,
          configSource: cachedCfg.source || "cache"
        };
      }
      // Bei Mismatch einmalig frisch aus D1/KV revalidieren (rate-limitiert auf max. 1x pro 10s gegen Scanner-Floods),
      // damit Secret-Änderungen oder Passwort-Deaktivierungen auf anderen Isolates sofort greifen!
      const now = Date.now();
      const lastReval = Number(globalThis.__WEBHOOK_SECRET_LAST_REVAL_AT || 0);
      if ((now - lastReval) >= WEBHOOK_MISMATCH_REVAL_MIN_INTERVAL_MS) {
        globalThis.__WEBHOOK_SECRET_LAST_REVAL_AT = now;
        const freshCfg = await getWebhookSecurityConfig(env, { forceRefresh: true });
        const freshCheck = matchesCfg(freshCfg);
        return {
          ok: freshCheck.ok,
          fastPath: freshCheck.ok ? (freshCheck.hasSecret ? "revalidated_match" : "revalidated_open") : "revalidated_reject",
          hasSecret: freshCheck.hasSecret,
          hasHeader,
          hasQuery,
          configSource: freshCfg?.source || "none"
        };
      }
      return {
        ok: false,
        fastPath: "cache_reject",
        hasSecret: true,
        hasHeader,
        hasQuery,
        configSource: cachedCfg.source || "cache"
      };
    }

    // Cold-Start (einmalig pro Isolate / 5 Min.): Immer konsistent aus D1/KV/Env laden & cachen!
    // Verhindert den "ging kurz nach Cold-Start, dann plötzlich 401"-Konflikt zwischen envSecret und gespeichertem D1/KV-Secret.
    const webhookSecurity = await getWebhookSecurityConfig(env);
    const storageCheck = matchesCfg(webhookSecurity);
    return {
      ok: storageCheck.ok,
      fastPath: !storageCheck.hasSecret
        ? "storage_open"
        : (storageCheck.ok ? (storageCheck.matchedPrev ? "storage_prev_grace" : "storage_match") : "storage_reject"),
      hasSecret: storageCheck.hasSecret,
      hasHeader,
      hasQuery,
      configSource: webhookSecurity?.source || "none"
    };
  }

  async function saveWebhookSecurityConfig(env, secretOrConfig, maxConnectionsArg = 8) {
    // Unterstützt sowohl Objekt-Signatur ({ secretToken, maxConnections, dropPendingDefault, previousSecretToken, previousSecretExpiresAt, explicitlyDisabled }) als auch Legacy-Parameter
    const isConfigObj = Boolean(secretOrConfig && typeof secretOrConfig === "object");
    const rawToken = isConfigObj ? secretOrConfig.secretToken : secretOrConfig;
    const rawMaxConn = isConfigObj ? secretOrConfig.maxConnections : maxConnectionsArg;
    const dropPendingDefault = isConfigObj ? Boolean(secretOrConfig.dropPendingDefault) : true;
    const cleanToken = sanitizeWebhookSecretToken(rawToken);
    const cleanMaxConn = Math.min(40, Math.max(1, Number(rawMaxConn) || 8));
    const explicitlyDisabled = isConfigObj && secretOrConfig.explicitlyDisabled !== undefined
      ? Boolean(secretOrConfig.explicitlyDisabled)
      : !cleanToken;

    let previousSecretToken = "";
    let previousSecretExpiresAt = 0;
    if (isConfigObj && secretOrConfig.previousSecretToken !== undefined) {
      const cleanPrev = sanitizeWebhookSecretToken(secretOrConfig.previousSecretToken);
      if (cleanPrev && cleanPrev !== cleanToken) {
        previousSecretToken = cleanPrev;
        previousSecretExpiresAt = Number(secretOrConfig.previousSecretExpiresAt) || (Date.now() + WEBHOOK_SECRET_GRACE_WINDOW_MS);
      }
    }

    const now = Date.now();
    const envSecret = sanitizeWebhookSecretToken(env?.TELEGRAM_WEBHOOK_SECRET || env?.WEBHOOK_SECRET || "");
    const payload = {
      secretToken: cleanToken,
      previousSecretToken,
      previousSecretExpiresAt,
      maxConnections: cleanMaxConn,
      dropPendingDefault,
      explicitlyDisabled,
      updatedAt: now,
      loadedAt: now,
      source: "d1",
      hasEnvSecret: Boolean(envSecret),
      envSecretConflict: Boolean(envSecret && (explicitlyDisabled || cleanToken !== envSecret))
    };
    globalThis.__WEBHOOK_SECURITY_CONFIG_CACHE = payload;
    memoryFallback.set("TG_WEBHOOK_SECURITY_CONFIG_V1", payload);

    // D1 ZUERST schreiben (stark konsistent über alle Edge-Standorte, kein 1.000 Writes/Tag KV-Limit)
    let d1Ok = false;
    try {
      if (typeof saveEntityToD1 === "function") {
        await saveEntityToD1(env, "TG_WEBHOOK_SECURITY_CONFIG_V1", "config", payload);
        d1Ok = true;
      }
    } catch (e) {}

    // KV zusätzlich als Spiegel aktualisieren
    let kvOk = false;
    try {
      await kvStageWrite(env, "TG_WEBHOOK_SECURITY_CONFIG_V1", JSON.stringify(payload), {
        bindingName: "MOVIE_SAVED",
        flushNow: true
      });
      kvOk = true;
    } catch (e) {}

    payload.source = d1Ok ? "d1" : (kvOk ? "kv" : "memory");
    return payload;
  }

  // --- Kompaktes Webhook-Diagnose-Ringbuffer-Log (max. 15 Events im RAM + rate-limitiertes letztes Fehler-Event in D1, 0 KV-Writes) ---
  const WEBHOOK_DIAG_MAX_EVENTS = 15;
  const WEBHOOK_DIAG_LAST_FAILURE_KEY = "TG_WEBHOOK_LAST_FAILURE_V1";
  const WEBHOOK_DIAG_D1_PERSIST_MIN_INTERVAL_MS = 30000;

  function sanitizeWebhookDiagError(raw) {
    if (!raw) return "";
    return String(raw)
      .replace(/bot\d+:[A-Za-z0-9_-]{10,}/gi, "bot<REDACTED>")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <REDACTED>")
      .replace(/([?&](?:secret|token|key)=)[^&\s]+/gi, "$1<REDACTED>")
      .slice(0, 180);
  }

  function extractWebhookUpdateSummary(update) {
    if (!update || typeof update !== "object") {
      return { updateId: null, updateType: "invalid", command: "" };
    }
    const updateId = Number.isFinite(Number(update.update_id)) ? Number(update.update_id) : null;
    let updateType = "other";
    let command = "";
    if (update.message) {
      updateType = update.message.message_thread_id ? "message_topic" : "message";
      const txt = String(update.message.text || "").trim();
      if (txt.startsWith("/")) {
        command = txt.split(/\s+/)[0].slice(0, 28);
      }
    } else if (update.callback_query) {
      updateType = "callback_query";
    } else if (update.inline_query) {
      updateType = "inline_query";
    } else if (update.channel_post) {
      updateType = "channel_post";
    } else if (update.edited_message || update.edited_channel_post) {
      updateType = "edited";
    }
    return { updateId, updateType, command };
  }

  function ensureWebhookDiagStore() {
    if (!Array.isArray(globalThis.__WEBHOOK_DIAG_EVENTS)) {
      globalThis.__WEBHOOK_DIAG_EVENTS = [];
    }
    if (!globalThis.__WEBHOOK_DIAG_STATS || typeof globalThis.__WEBHOOK_DIAG_STATS !== "object") {
      globalThis.__WEBHOOK_DIAG_STATS = {
        isolateStartedAt: Date.now(),
        totalOk: 0,
        total401: 0,
        totalErrors: 0,
        totalDuplicates: 0,
        lastOkAt: 0,
        last401At: 0,
        lastErrorAt: 0
      };
    }
    return {
      events: globalThis.__WEBHOOK_DIAG_EVENTS,
      stats: globalThis.__WEBHOOK_DIAG_STATS
    };
  }

  function recordWebhookDiagEvent(env, entry = {}, options = {}) {
    try {
      const { events, stats } = ensureWebhookDiagStore();
      const now = Date.now();
      const status = Number(entry.status || 200);
      const fastPath = String(entry.fastPath || "unknown").slice(0, 40);
      const cleanError = sanitizeWebhookDiagError(entry.error || "");
      const record = {
        ts: now,
        status,
        fastPath,
        updateId: entry.updateId ?? null,
        updateType: String(entry.updateType || "").slice(0, 24),
        command: String(entry.command || "").slice(0, 28),
        configSource: String(entry.configSource || "").slice(0, 16),
        hasHeader: entry.hasHeader === undefined ? undefined : Boolean(entry.hasHeader),
        hasQuery: entry.hasQuery === undefined ? undefined : Boolean(entry.hasQuery),
        durationMs: Number.isFinite(Number(entry.durationMs)) ? Math.max(0, Math.round(Number(entry.durationMs))) : null,
        error: cleanError
      };

      if (fastPath === "duplicate_skip") {
        stats.totalDuplicates += 1;
      } else if (status === 401) {
        stats.total401 += 1;
        stats.last401At = now;
      } else if (status >= 500 || cleanError) {
        stats.totalErrors += 1;
        stats.lastErrorAt = now;
      } else {
        stats.totalOk += 1;
        stats.lastOkAt = now;
      }

      events.unshift(record);
      if (events.length > WEBHOOK_DIAG_MAX_EVENTS) {
        events.length = WEBHOOK_DIAG_MAX_EVENTS;
      }

      const isFailure = Boolean(options.persistFailure || status === 401 || status >= 500 || cleanError);
      if (isFailure && env && typeof saveEntityToD1 === "function") {
        const lastPersistAt = Number(globalThis.__WEBHOOK_DIAG_LAST_D1_PERSIST_AT || 0);
        if ((now - lastPersistAt) >= WEBHOOK_DIAG_D1_PERSIST_MIN_INTERVAL_MS) {
          globalThis.__WEBHOOK_DIAG_LAST_D1_PERSIST_AT = now;
          const persistPromise = saveEntityToD1(env, WEBHOOK_DIAG_LAST_FAILURE_KEY, "diag", record).catch(() => {});
          if (options.ctx && typeof options.ctx.waitUntil === "function") {
            options.ctx.waitUntil(persistPromise);
          }
        }
      }
      return record;
    } catch (_e) {
      return null;
    }
  }

  async function getWebhookDiagSnapshot(env) {
    const { events, stats } = ensureWebhookDiagStore();
    let lastPersistedFailure = null;
    try {
      if (env && typeof getEntityFromD1 === "function") {
        const stored = await getEntityFromD1(env, WEBHOOK_DIAG_LAST_FAILURE_KEY, 7 * 86400000, { ramTtlMs: 5000 }).catch(() => null);
        if (stored && typeof stored === "object") {
          lastPersistedFailure = stored;
        }
      }
    } catch (_e) {}
    return {
      stats: { ...stats },
      recentEvents: events.slice(0, WEBHOOK_DIAG_MAX_EVENTS),
      lastPersistedFailure
    };
  }

  // --- 24h-Drosselung für setChatMenuButton bei /start (spart 1 Telegram-API-Subrequest pro wiederholtem /start) ---
  const MENU_BUTTON_SYNC_TTL_MS = 24 * 60 * 60 * 1000;
  const MENU_BUTTON_CACHE_MAX_ENTRIES = 500;

  async function ensureChatMenuButtonThrottled(env, chatId, webAppUrl, buttonText = "🍿 Mediathek") {
    const cleanChatId = String(chatId || "").trim();
    const cleanUrl = String(webAppUrl || "").trim().replace(/\/$/, "");
    if (!cleanChatId || !cleanUrl) return { ok: false, skipped: true };

    if (!(globalThis.__MENU_BUTTON_SYNC_CACHE instanceof Map)) {
      globalThis.__MENU_BUTTON_SYNC_CACHE = new Map();
    }
    const cache = globalThis.__MENU_BUTTON_SYNC_CACHE;
    const cacheKey = `${cleanChatId}|${cleanUrl}`;
    const now = Date.now();
    const lastRamSync = Number(cache.get(cacheKey) || 0);
    if (lastRamSync > 0 && (now - lastRamSync) < MENU_BUTTON_SYNC_TTL_MS) {
      return { ok: true, skipped: true, reason: "ram_cache_24h" };
    }

    // Zusätzlicher 0-IO Check gegen bereits geladene In-Memory-Session (falls Isolate nach Neustart User-Bundle schon lud)
    const memSess = memoryFallback.get(`sess_${cleanChatId}`);
    if (
      memSess &&
      typeof memSess === "object" &&
      memSess._menuBtnUrl === cleanUrl &&
      Number(memSess._menuBtnSyncedAt || 0) > 0 &&
      (now - Number(memSess._menuBtnSyncedAt)) < MENU_BUTTON_SYNC_TTL_MS
    ) {
      cache.set(cacheKey, Number(memSess._menuBtnSyncedAt));
      return { ok: true, skipped: true, reason: "session_cache_24h" };
    }

    const res = await tgApi(env).setChatMenuButton(cleanChatId, cleanUrl, buttonText).catch(() => ({ ok: false }));
    if (res && res.ok) {
      if (cache.size >= MENU_BUTTON_CACHE_MAX_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      cache.set(cacheKey, now);
      if (memSess && typeof memSess === "object") {
        memSess._menuBtnUrl = cleanUrl;
        memSess._menuBtnSyncedAt = now;
      }
    }
    return res || { ok: false };
  }

  // Offizielles BotFather 512x512 Single-<path> SVG (Exakt 1 <path>-Element im 512x512 Canvas, 100% BotFather-konform!)
  const BOTFATHER_SINGLE_PATH_SVG_512 = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><path fill="#00E5FF" fill-rule="evenodd" d="M256 32C379.712 32 480 132.288 480 256C480 379.712 379.712 480 256 480C132.288 480 32 379.712 32 256C32 132.288 132.288 32 256 32ZM256 56C145.543 56 56 145.543 56 256C56 366.457 145.543 456 256 456C366.457 456 456 366.457 456 256C456 145.543 366.457 56 256 56ZM256 96C344.366 96 416 167.634 416 256C416 344.366 344.366 416 256 416C167.634 416 96 344.366 96 256C96 167.634 167.634 96 256 96ZM256 116C178.68 116 116 178.68 116 256C116 333.32 178.68 396 256 396C333.32 396 396 333.32 396 256C396 178.68 333.32 116 256 116ZM208 168L352 256L208 344V168Z"/></svg>`;

  async function getWorkerSpeedProfile(env, overrideKey = null) {
    const normalizeKey = (k) => {
      const s = String(k || "").trim().toLowerCase();
      if (s === "balanced" || s === "paid_pro" || s === "free_turbo") return s;
      return "";
    };
    const explicit = normalizeKey(overrideKey);
    if (explicit) return WORKER_SPEED_PROFILES[explicit];

    const memKey = "TG_WORKER_SPEED_PROFILE";
    const isBrowserSandbox = typeof localStorage !== "undefined" && typeof window !== "undefined";
    const speedTs = Number(memoryFallback.get("TG_WORKER_SPEED_PROFILE_ts") || 0);
    const cached = normalizeKey(memoryFallback.get(memKey));
    if (cached && (isBrowserSandbox || (Date.now() - speedTs) < 60000)) {
      return WORKER_SPEED_PROFILES[cached];
    }

    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    if (hasD1 && typeof getEntityFromD1 === "function") {
      try {
        const fromD1 = await getEntityFromD1(env, memKey, 3650 * 86400000, { ramTtlMs: 60000 });
        const d1Key = normalizeKey(typeof fromD1 === "string" ? fromD1 : (fromD1 && typeof fromD1 === "object" ? fromD1.profile : ""));
        if (d1Key) {
          memoryFallback.set(memKey, d1Key);
          memoryFallback.set("TG_WORKER_SPEED_PROFILE_ts", Date.now());
          return WORKER_SPEED_PROFILES[d1Key];
        }
      } catch (e) {}
    }

    try {
      const raw = await kvCachedGetRaw(env, memKey, "MOVIE_SAVED", { ttlMs: 60000 });
      const kvVal = normalizeKey(raw);
      if (kvVal) {
        memoryFallback.set(memKey, kvVal);
        memoryFallback.set("TG_WORKER_SPEED_PROFILE_ts", Date.now());
        if (hasD1 && typeof saveEntityToD1 === "function") {
          saveEntityToD1(env, memKey, "config", { profile: kvVal, updatedAt: Date.now() }).catch(() => {});
        }
        return WORKER_SPEED_PROFILES[kvVal];
      }
    } catch (e) {}

    memoryFallback.set(memKey, "free_turbo");
    memoryFallback.set("TG_WORKER_SPEED_PROFILE_ts", Date.now());
    return WORKER_SPEED_PROFILES.free_turbo;
  }

  async function setWorkerSpeedProfile(env, profileKey) {
    const clean = String(profileKey || "").trim().toLowerCase();
    const valid = (clean === "balanced" || clean === "paid_pro") ? clean : "free_turbo";
    memoryFallback.set("TG_WORKER_SPEED_PROFILE", valid);
    memoryFallback.set("TG_WORKER_SPEED_PROFILE_ts", Date.now());
    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    if (hasD1 && typeof saveEntityToD1 === "function") {
      await saveEntityToD1(env, "TG_WORKER_SPEED_PROFILE", "config", { profile: valid, updatedAt: Date.now() });
      return WORKER_SPEED_PROFILES[valid];
    }
    await kvStageWrite(env, "TG_WORKER_SPEED_PROFILE", valid, {
      bindingName: "MOVIE_SAVED",
      flushNow: true
    });
    return WORKER_SPEED_PROFILES[valid];
  }

  async function signTelegramChatLaunchToken(chatId, env, ttlMs = 24 * 60 * 60 * 1000) {
    const cleanChatId = String(chatId || "").trim();
    if (!cleanChatId || cleanChatId.startsWith("-") || !/^\d+$/.test(cleanChatId)) return "";
    try {
      const enc = new TextEncoder();
      const dataObj = {
        cid: cleanChatId,
        iat: Date.now(),
        exp: Date.now() + (Number(ttlMs) > 0 ? Number(ttlMs) : 24 * 60 * 60 * 1000)
      };
      const payloadHex = Array.from(enc.encode(JSON.stringify(dataObj))).map(b => b.toString(16).padStart(2, "0")).join("");
      const secret = typeof getSessionSigningSecret === "function"
        ? await getSessionSigningSecret(env)
        : String(env?.JWT_SECRET || env?.TELEGRAM_WEBHOOK_SECRET || getBotToken(env) || "").trim();
      if (!secret) return "";
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(`tglaunch:${payloadHex}`));
      const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
      return `${payloadHex}.${sigHex}`;
    } catch (e) {
      return "";
    }
  }

  async function verifyTelegramChatLaunchToken(token, env) {
    const raw = String(token || "").trim();
    if (!raw || !raw.includes(".")) return { ok: false, error: "Ungültiger Launch-Token" };
    try {
      const [payloadHex, sigHex] = raw.split(".");
      if (!payloadHex || !sigHex || payloadHex.length % 2 !== 0) return { ok: false, error: "Formatfehler im Launch-Token" };
      const enc = new TextEncoder();
      const secrets = typeof getVerificationSigningSecrets === "function"
        ? await getVerificationSigningSecrets(env)
        : [String(env?.JWT_SECRET || env?.TELEGRAM_WEBHOOK_SECRET || env?.TELEGRAM_BOT_TOKEN || env?.BOT_TOKEN || "").trim()].filter(Boolean);
      if (!secrets.length) return { ok: false, error: "Signatur-Schlüssel nicht konfiguriert" };
      let sigMatches = false;
      for (const secret of secrets) {
        const key = await crypto.subtle.importKey(
          "raw",
          enc.encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const expectedSigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(`tglaunch:${payloadHex}`));
        const expectedSigHex = Array.from(new Uint8Array(expectedSigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
        const matched = typeof timingSafeEqualStr === "function"
          ? timingSafeEqualStr(expectedSigHex.toLowerCase(), sigHex.toLowerCase())
          : (expectedSigHex.toLowerCase() === sigHex.toLowerCase());
        if (matched) {
          sigMatches = true;
          break;
        }
      }
      if (!sigMatches) {
        return { ok: false, error: "Ungültige Launch-Token Signatur" };
      }
      const bytes = new Uint8Array(payloadHex.length / 2);
      for (let i = 0; i < payloadHex.length; i += 2) {
        bytes[i / 2] = parseInt(payloadHex.slice(i, i + 2), 16) || 0;
      }
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (!data || !data.cid || !/^\d+$/.test(String(data.cid))) {
        return { ok: false, error: "Keine gültige Chat-ID im Launch-Token" };
      }
      if (!data.exp || Date.now() > Number(data.exp)) {
        return { ok: false, error: "Launch-Token abgelaufen (24h Limit)" };
      }
      return { ok: true, chatId: String(data.cid), exp: Number(data.exp) };
    } catch (e) {
      return { ok: false, error: "Launch-Token Prüfung fehlgeschlagen" };
    }
  }

  function resolveDefaultWebAppBaseUrl(env, explicitBase = "") {
    const raw = String(
      explicitBase ||
      env?.WEBAPP_URL ||
      env?.WEBHOOK_URL ||
      (typeof globalThis !== "undefined" ? globalThis._activeWorkerOrigin : "") ||
      "https://teleport.sonhartmann-1997.workers.dev"
    ).trim();
    if (!raw) return "";
    if (typeof resolveCleanWorkerOrigin === "function" && !explicitBase && !env?.WEBAPP_URL) {
      return resolveCleanWorkerOrigin(env, raw).replace(/\/$/, "");
    }
    return raw.replace(/\/$/, "");
  }

  async function buildSignedWebAppUrl(env, baseUrl, chatId = null, extraParams = {}) {
    const base = resolveDefaultWebAppBaseUrl(env, baseUrl);
    if (!base) return "";
    try {
      const u = new URL(base);
      const cleanChatId = String(chatId || "").trim();
      if (cleanChatId && !cleanChatId.startsWith("-") && /^\d+$/.test(cleanChatId)) {
        if (!u.searchParams.has("chatId")) u.searchParams.set("chatId", cleanChatId);
        if (!u.searchParams.has("tgLaunch")) {
          const launchToken = await signTelegramChatLaunchToken(cleanChatId, env, 24 * 60 * 60 * 1000);
          if (launchToken) u.searchParams.set("tgLaunch", launchToken);
        }
      }
      if (extraParams && typeof extraParams === "object") {
        for (const [k, v] of Object.entries(extraParams)) {
          if (v !== undefined && v !== null && v !== "") {
            u.searchParams.set(k, String(v));
          }
        }
      }
      return u.toString();
    } catch (e) {
      return base;
    }
  }

  // Bot API 9.3 / 10.5: Active Thread/Topic Context (Private-Chat-Topics & Supergroup Forum Topics)
  const activeChatThreadContextMap = new Map();
  const ACTIVE_CHAT_THREAD_TTL_MS = 15000;

  function parseValidTelegramThreadId(rawId) {
    if (rawId === null || rawId === undefined || rawId === "" || rawId === false) return null;
    const str = String(rawId).trim();
    if (!/^\d+$/.test(str)) return null;
    const num = parseInt(str, 10);
    return Number.isInteger(num) && num > 0 ? num : null;
  }

  function setActiveChatThreadId(chatId, threadId) {
    if (chatId === null || chatId === undefined) return;
    const key = String(chatId).trim();
    if (!key) return;
    const parsed = parseValidTelegramThreadId(threadId);
    if (!parsed) {
      activeChatThreadContextMap.delete(key);
      return;
    }
    if (activeChatThreadContextMap.size > 250) {
      const now = Date.now();
      for (const [k, v] of activeChatThreadContextMap.entries()) {
        if (!v || (now - v.ts) > ACTIVE_CHAT_THREAD_TTL_MS) activeChatThreadContextMap.delete(k);
      }
      if (activeChatThreadContextMap.size > 250) {
        const firstKey = activeChatThreadContextMap.keys().next().value;
        if (firstKey !== undefined) activeChatThreadContextMap.delete(firstKey);
      }
    }
    activeChatThreadContextMap.set(key, { threadId: parsed, ts: Date.now() });
  }

  function getActiveChatThreadId(chatId) {
    if (chatId === null || chatId === undefined) return null;
    const key = String(chatId).trim();
    if (!key) return null;
    const entry = activeChatThreadContextMap.get(key);
    if (!entry) return null;
    if ((Date.now() - entry.ts) > ACTIVE_CHAT_THREAD_TTL_MS) {
      activeChatThreadContextMap.delete(key);
      return null;
    }
    return entry.threadId;
  }

  function clearActiveChatThreadId(chatId) {
    if (chatId === null || chatId === undefined) return;
    const key = String(chatId).trim();
    if (key) activeChatThreadContextMap.delete(key);
  }

  // ============================================================================
  // BOT API 9.3 / 10.5: SMART TOPIC-ROUTING ENGINE (PRIVATE-CHAT & FORUM TOPICS)
  // Modi:
  //  - "off"        : Hauptchat oder manuell eingetragene Topic-ID
  //  - "by_type"    : Automatisch 🎬 Filme vs. 📺 Serien
  //  - "per_series" : 🎬 Filme + eigenes Thema pro Serie (z. B. 📺 Breaking Bad)
  // ============================================================================
  const TELEGRAM_TOPIC_ICON_COLORS = {
    BLUE: 7322096,
    YELLOW: 16766590,
    VIOLET: 13338331,
    GREEN: 9367192,
    ROSE: 16749490,
    RED: 16478047
  };

  function normalizeTopicRoutingMode(rawMode) {
    const m = String(rawMode || "").trim().toLowerCase();
    if (m === "by_type" || m === "per_series" || m === "off") return m;
    return "off";
  }

  function sanitizeTopicMap(rawMap) {
    const out = {};
    if (!rawMap || typeof rawMap !== "object") return out;
    const chatEntries = Object.entries(rawMap).slice(0, 10);
    for (const [chatKey, entries] of chatEntries) {
      const cleanChatKey = String(chatKey || "").trim();
      if (!cleanChatKey || !entries || typeof entries !== "object") continue;
      const validTopics = [];
      for (const [topicKey, val] of Object.entries(entries)) {
        const cleanKey = String(topicKey || "").trim().slice(0, 80);
        const tid = parseValidTelegramThreadId(val?.threadId ?? val);
        if (!cleanKey || !tid) continue;
        validTopics.push([cleanKey, {
          threadId: tid,
          name: String(val?.name || "").trim().slice(0, 128),
          updatedAt: Number(val?.updatedAt) || Date.now()
        }]);
      }
      // Behalte Standard-Topics (type:*) immer, limitiere Serien-Topics auf die 60 neuesten (LRU)
      const pinned = validTopics.filter(([k]) => k.startsWith("type:"));
      const dynamic = validTopics
        .filter(([k]) => !k.startsWith("type:"))
        .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
        .slice(0, 60);
      const merged = {};
      for (const [k, v] of [...pinned, ...dynamic]) merged[k] = v;
      if (Object.keys(merged).length > 0) out[cleanChatKey] = merged;
    }
    return out;
  }

  function deriveSeriesNameForTopic(rawTitle, explicitSeriesTitle = "") {
    const base = String(explicitSeriesTitle || rawTitle || "").trim();
    if (!base) return "Serie";
    const cleaned = base
      .replace(/\s*[-–—|:]\s*(?:S\d{1,2}E\d{1,3}|Staffel\s*\d+|Season\s*\d+|Folge\s*\d+|Episode\s*\d+).*$/i, "")
      .replace(/\s*\bS\d{1,2}E\d{1,3}\b.*$/i, "")
      .replace(/\s*\bStaffel\s*\d+\b.*$/i, "")
      .replace(/\s*\bSeason\s*\d+\b.*$/i, "")
      .replace(/\s*\((?:4K|2160p|1080p|720p|HDR|DV|HEVC|IMAX|x265|x264)[^)]*\)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    return (cleaned || base).slice(0, 118);
  }

  function resolveDeliveryTopicDescriptor({ mode, typeCode, tmdbId, title, seriesTitle }) {
    const normMode = normalizeTopicRoutingMode(mode);
    if (normMode === "off") return null;
    const tc = String(typeCode || "").trim().toLowerCase();
    const rawTitle = String(title || "").trim();
    const isSeries =
      tc === "s" ||
      tc === "series" ||
      tc === "tv" ||
      tc === "episode" ||
      Boolean(String(seriesTitle || "").trim()) ||
      /\b(?:S\d{1,2}E\d{1,3}|Staffel\s*\d+|Season\s*\d+)\b/i.test(rawTitle);

    if (normMode === "per_series" && isSeries) {
      const cleanSeriesName = deriveSeriesNameForTopic(rawTitle, seriesTitle);
      const numericId = Number(tmdbId);
      const slug = cleanSeriesName.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "serie";
      const topicKey = (Number.isInteger(numericId) && numericId > 0)
        ? `series:${numericId}`
        : `series_name:${slug}`;
      return {
        topicKey,
        topicName: `📺 ${cleanSeriesName}`.slice(0, 128),
        iconColor: TELEGRAM_TOPIC_ICON_COLORS.VIOLET,
        category: "series"
      };
    }

    if (isSeries) {
      return {
        topicKey: "type:series",
        topicName: "📺 Serien",
        iconColor: TELEGRAM_TOPIC_ICON_COLORS.VIOLET,
        category: "series"
      };
    }

    return {
      topicKey: "type:movie",
      topicName: "🎬 Filme",
      iconColor: TELEGRAM_TOPIC_ICON_COLORS.BLUE,
      category: "movie"
    };
  }

  async function resolveOrCreateDeliveryTopic(env, opts = {}) {
    const {
      ownerChatId = "",
      targetChatId = "",
      explicitTopicId = "",
      savedDeliv = {},
      topicRoutingMode = "",
      typeCode = "",
      tmdbId = null,
      title = "",
      seriesTitle = "",
      customBotToken = "",
      forceRecreate = false
    } = opts || {};

    const manualTid = parseValidTelegramThreadId(explicitTopicId);
    const mode = normalizeTopicRoutingMode(topicRoutingMode || savedDeliv?.topicRoutingMode);
    if (manualTid && !forceRecreate) {
      return {
        topicId: String(manualTid),
        topicName: "",
        topicKey: "",
        mode,
        autoCreated: false,
        source: "manual"
      };
    }

    if (mode === "off") {
      const fallbackSavedTid = parseValidTelegramThreadId(savedDeliv?.targetTopicId);
      return {
        topicId: fallbackSavedTid ? String(fallbackSavedTid) : "",
        topicName: "",
        topicKey: "",
        mode: "off",
        autoCreated: false,
        source: fallbackSavedTid ? "saved_manual" : "none"
      };
    }

    const cleanTargetChat = String(targetChatId || "").trim();
    if (!cleanTargetChat || cleanTargetChat === "guest") {
      return { topicId: "", topicName: "", topicKey: "", mode, autoCreated: false, source: "none" };
    }

    const desc = resolveDeliveryTopicDescriptor({ mode, typeCode, tmdbId, title, seriesTitle });
    if (!desc) {
      return { topicId: "", topicName: "", topicKey: "", mode, autoCreated: false, source: "none" };
    }

    const topicMap = sanitizeTopicMap(savedDeliv?.topicMap);
    const chatTopics = topicMap[cleanTargetChat] || {};
    const existing = chatTopics[desc.topicKey];
    if (!forceRecreate && existing && parseValidTelegramThreadId(existing.threadId)) {
      return {
        topicId: String(existing.threadId),
        topicName: existing.name || desc.topicName,
        topicKey: desc.topicKey,
        mode,
        autoCreated: false,
        source: "cached_topic"
      };
    }

    const created = await tgApi(env).createForumTopic(cleanTargetChat, desc.topicName, {
      icon_color: desc.iconColor,
      customBotToken
    });
    if (created && created.ok && parseValidTelegramThreadId(created.message_thread_id)) {
      const newTid = parseValidTelegramThreadId(created.message_thread_id);
      const persistOwner = String(ownerChatId || "").trim();
      if (persistOwner && persistOwner !== "guest" && typeof getUserSettings === "function" && typeof saveUserSettings === "function") {
        try {
          const curSettings = await getUserSettings(env, persistOwner);
          const curDeliv = (curSettings && curSettings.deliveryConfig && typeof curSettings.deliveryConfig === "object")
            ? { ...curSettings.deliveryConfig }
            : {};
          const nextMap = sanitizeTopicMap(curDeliv.topicMap);
          if (!nextMap[cleanTargetChat]) nextMap[cleanTargetChat] = {};
          nextMap[cleanTargetChat][desc.topicKey] = {
            threadId: newTid,
            name: desc.topicName,
            updatedAt: Date.now()
          };
          curDeliv.topicMap = sanitizeTopicMap(nextMap);
          if (!curDeliv.topicRoutingMode) curDeliv.topicRoutingMode = mode;
          await saveUserSettings(env, persistOwner, { ...curSettings, deliveryConfig: curDeliv });
        } catch (e) {}
      }
      return {
        topicId: String(newTid),
        topicName: desc.topicName,
        topicKey: desc.topicKey,
        mode,
        autoCreated: true,
        source: "auto_created"
      };
    }

    // Sauberer Fallback: Falls Private-Chat-Topics noch nicht aktiviert sind oder Zielgruppe kein Forum ist -> General-Chat!
    return {
      topicId: "",
      topicName: desc.topicName,
      topicKey: desc.topicKey,
      mode,
      autoCreated: false,
      fallbackReason: String(created?.error || "Topic konnte nicht erstellt werden"),
      source: "fallback_general"
    };
  }

  async function invalidateDeliveryTopicEntry(env, ownerChatId, targetChatId, topicKey) {
    const cleanOwner = String(ownerChatId || "").trim();
    const cleanTarget = String(targetChatId || "").trim();
    const cleanKey = String(topicKey || "").trim();
    if (!cleanOwner || cleanOwner === "guest" || !cleanTarget || !cleanKey) return false;
    try {
      const curSettings = await getUserSettings(env, cleanOwner);
      const curDeliv = (curSettings && curSettings.deliveryConfig && typeof curSettings.deliveryConfig === "object")
        ? { ...curSettings.deliveryConfig }
        : null;
      if (!curDeliv || !curDeliv.topicMap || !curDeliv.topicMap[cleanTarget] || !curDeliv.topicMap[cleanTarget][cleanKey]) {
        return false;
      }
      const nextMap = sanitizeTopicMap(curDeliv.topicMap);
      if (nextMap[cleanTarget]) {
        delete nextMap[cleanTarget][cleanKey];
        if (Object.keys(nextMap[cleanTarget]).length === 0) delete nextMap[cleanTarget];
      }
      curDeliv.topicMap = nextMap;
      await saveUserSettings(env, cleanOwner, { ...curSettings, deliveryConfig: curDeliv });
      return true;
    } catch (e) {
      return false;
    }
  }

  // @ANCHOR: TELEGRAM_API
  // --- Telegram API Client (Nutzt stabiles HTML-Parsing gegen kaputte Links + 429 Anti-Spam Schutz!) ---
  function tgApi(env) {
    const resolvedBotToken = getBotToken(env);
    const TELEGRAM_API = `https://api.telegram.org/bot${resolvedBotToken}`;

    const normalizeLinkPreviewOptions = (rawOpts = {}, defaultDisabled = true) => {
      const { _fromAntiSpamQueue, disable_web_page_preview, link_preview_options, ...rest } = rawOpts || {};
      let resolvedLpo = link_preview_options;
      if (!resolvedLpo || typeof resolvedLpo !== "object") {
        if (typeof disable_web_page_preview === "boolean") {
          resolvedLpo = { is_disabled: disable_web_page_preview };
        } else if (defaultDisabled) {
          resolvedLpo = { is_disabled: true };
        }
      }
      if (resolvedLpo) rest.link_preview_options = resolvedLpo;
      return rest;
    };

    const isTelegramParseOrEntityError = (errDesc) => {
      const d = String(errDesc || "").toLowerCase();
      return (
        d.includes("can't parse entities") ||
        d.includes("parse entities") ||
        d.includes("unsupported start tag") ||
        d.includes("can't find end tag") ||
        d.includes("unclosed start tag") ||
        d.includes("unexpected end tag") ||
        d.includes("byte offset") ||
        d.includes("entity")
      );
    };

    const isTelegramThreadNotFoundError = (errDesc) => {
      const d = String(errDesc || "").toLowerCase();
      return (
        d.includes("message thread not found") ||
        d.includes("topic_deleted") ||
        d.includes("topic_closed") ||
        d.includes("message_thread_id") ||
        d.includes("forum_topic_closed")
      );
    };

    const resolveOutboundThreadId = (targetChatId, explicitThreadVal, hasExplicitKey = false) => {
      if (hasExplicitKey) {
        return parseValidTelegramThreadId(explicitThreadVal);
      }
      return getActiveChatThreadId(targetChatId);
    };

    return {
      async answerInlineQuery(inlineQueryId, results, options = {}) {
        try {
          trackStat("telegramCalls");
          const safeResults = (results || []).slice(0, 50).map(r => {
            const rawMsg = r.input_message_content?.message_text || "";
            const alreadyHtml = /<\/?(?:b|i|code|pre|a)\b/i.test(rawMsg);
            const preparedInline = alreadyHtml
              ? { text: rawMsg, parse_mode: "HTML" }
              : prepareTelegramHtmlPayload(rawMsg, 4090);
            return {
              ...r,
              input_message_content: r.input_message_content
                ? {
                    ...r.input_message_content,
                    message_text: preparedInline.text,
                    parse_mode: preparedInline.parse_mode
                  }
                : r.input_message_content,
              reply_markup: r.reply_markup ? sanitizeReplyMarkup(r.reply_markup) : undefined
            };
          });
          const effectiveWebAppBase = resolveDefaultWebAppBaseUrl(env);
          const cleanInlineOpts = { ...options };
          const switchPmText = cleanInlineOpts.switch_pm_text;
          const switchPmParam = cleanInlineOpts.switch_pm_parameter;
          delete cleanInlineOpts.switch_pm_text;
          delete cleanInlineOpts.switch_pm_parameter;

          if (!cleanInlineOpts.button) {
            if (effectiveWebAppBase && /^https:\/\//i.test(effectiveWebAppBase)) {
              cleanInlineOpts.button = {
                text: switchPmText ? `🍿 ${String(switchPmText).replace(/^[🍿🎬🔎⚙️\s]+/, "").slice(0, 30)}` : "🍿 Mediathek Mini-App öffnen",
                web_app: { url: effectiveWebAppBase }
              };
            } else if (switchPmText) {
              cleanInlineOpts.button = {
                text: String(switchPmText).slice(0, 64),
                start_parameter: String(switchPmParam || "inline_start").slice(0, 64)
              };
            }
          }

          const body = { inline_query_id: inlineQueryId, results: safeResults, cache_time: 15, ...cleanInlineOpts };
          const res = await fetchWithTimeout(`${TELEGRAM_API}/answerInlineQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }, 5000);
          return res.ok ? await res.json() : null;
        } catch (e) {
          return null;
        }
      },

      async savePreparedInlineMessage(userId, result, opts = {}) {
        try {
          const numericUserId = Number(userId);
          if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0 || !result || typeof result !== "object") {
            return { ok: false, error: "Ungültige user_id oder leeres Inline-Ergebnis." };
          }
          trackStat("telegramCalls");
          const rawMsg = result.input_message_content?.message_text || "";
          const alreadyHtml = /<\/?(?:b|i|code|pre|a)\b/i.test(rawMsg);
          const preparedText = rawMsg
            ? (alreadyHtml ? { text: rawMsg, parse_mode: "HTML" } : prepareTelegramHtmlPayload(rawMsg, 4090))
            : null;
          const safeResult = {
            ...result,
            input_message_content: (result.input_message_content && preparedText)
              ? {
                  ...result.input_message_content,
                  message_text: preparedText.text,
                  parse_mode: preparedText.parse_mode
                }
              : result.input_message_content,
            reply_markup: result.reply_markup ? sanitizeReplyMarkup(result.reply_markup) : undefined
          };
          const payload = {
            user_id: numericUserId,
            result: safeResult,
            allow_user_chats: opts.allow_user_chats !== false,
            allow_bot_chats: Boolean(opts.allow_bot_chats),
            allow_group_chats: opts.allow_group_chats !== false,
            allow_channel_chats: opts.allow_channel_chats !== false
          };
          const res = await fetchWithTimeout(`${TELEGRAM_API}/savePreparedInlineMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          }, 5500);
          const json = await res.json().catch(() => null);
          if (res.ok && json?.ok && json?.result?.id) {
            return {
              ok: true,
              id: String(json.result.id),
              expiration_date: Number(json.result.expiration_date || 0)
            };
          }
          return {
            ok: false,
            status: res.status,
            error: json?.description || `HTTP ${res.status}`
          };
        } catch (e) {
          return { ok: false, error: e?.message || "savePreparedInlineMessage failed" };
        }
      },

      async setChatMenuButton(chatId = null, webAppUrl = "", buttonText = "🍿 Mediathek") {
        try {
          trackStat("telegramCalls");
          const base = resolveDefaultWebAppBaseUrl(env, webAppUrl);
          const finalUrl = chatId
            ? await buildSignedWebAppUrl(env, base, chatId)
            : base;
          const payload = {
            menu_button: {
              type: "web_app",
              text: String(buttonText || "🍿 Mediathek").slice(0, 64),
              web_app: { url: finalUrl }
            }
          };
          if (chatId && /^\d+$/.test(String(chatId))) {
            payload.chat_id = Number(chatId);
          }
          const res = await fetchWithTimeout(`${TELEGRAM_API}/setChatMenuButton`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          }, 4500);
          return res.ok ? await res.json() : { ok: false, status: res.status };
        } catch (e) {
          return { ok: false, error: e?.message || "setChatMenuButton failed" };
        }
      },

      async getBotFullInfo(forceRefresh = false) {
        try {
          const cacheKey = "bot_full_info_cache";
          if (!forceRefresh) {
            const cached = memoryFallback.get(cacheKey);
            if (cached && cached.ts && (Date.now() - cached.ts) < 300000 && cached.data) {
              return { ok: true, cached: true, data: cached.data };
            }
          }
          if (!getBotToken(env)) {
            const fallbackUser = String(env.BOT_USERNAME || "DeinBot").replace(/^@/, "");
            return {
              ok: true,
              simulated: true,
              data: {
                id: 0,
                username: fallbackUser,
                first_name: "TelePort Bot (Sandbox)",
                active_usernames: fallbackUser ? [fallbackUser] : [],
                can_join_groups: true,
                can_read_all_group_messages: false,
                supports_inline_queries: true,
                has_main_web_app: true,
                has_topics_enabled: false,
                has_topic_sidebar: false,
                inline_query_placeholder: "Film oder Serie suchen...",
                needs_inline_query_location: false,
                inviteLink: fallbackUser ? `https://t.me/botinvite/${fallbackUser}` : ""
              }
            };
          }
          trackStat("telegramCalls");
          const res = await fetchWithTimeout(`${TELEGRAM_API}/getMe`, { method: "GET" }, 4500);
          const json = await res.json().catch(() => null);
          if (res.ok && json?.ok && json?.result) {
            const r = json.result;
            const uname = String(r.username || env.BOT_USERNAME || "").replace(/^@/, "");
            const normalized = {
              id: Number(r.id || 0),
              username: uname,
              first_name: String(r.first_name || ""),
              active_usernames: Array.isArray(r.active_usernames) ? r.active_usernames : (uname ? [uname] : []),
              can_join_groups: Boolean(r.can_join_groups),
              can_read_all_group_messages: Boolean(r.can_read_all_group_messages),
              supports_inline_queries: Boolean(r.supports_inline_queries),
              can_connect_to_business: Boolean(r.can_connect_to_business),
              has_main_web_app: Boolean(r.has_main_web_app),
              has_topics_enabled: Boolean(r.has_topics_enabled),
              has_topic_sidebar: Boolean(r.has_topic_sidebar),
              inline_query_placeholder: String(r.inline_query_placeholder || ""),
              needs_inline_query_location: Boolean(r.needs_inline_query_location),
              inviteLink: uname ? `https://t.me/botinvite/${uname}` : ""
            };
            memoryFallback.set(cacheKey, { ts: Date.now(), data: normalized });
            return { ok: true, cached: false, data: normalized };
          }
          return { ok: false, status: res.status, error: json?.description || `HTTP ${res.status}` };
        } catch (e) {
          return { ok: false, error: e?.message || "getBotFullInfo failed" };
        }
      },

      async setMySettings(rawSettings = {}) {
        try {
          const payload = {};
          const boolKeys = [
            "can_join_groups",
            "can_read_all_group_messages",
            "supports_inline_queries",
            "has_topics_enabled",
            "has_topic_sidebar",
            "needs_inline_query_location"
          ];
          for (const k of boolKeys) {
            if (typeof rawSettings[k] === "boolean") {
              payload[k] = rawSettings[k];
            }
          }
          if (typeof rawSettings.inline_query_placeholder === "string") {
            payload.inline_query_placeholder = rawSettings.inline_query_placeholder.trim().slice(0, 64);
          }
          if (Object.keys(payload).length === 0) {
            return { ok: false, error: "Keine gültigen Bot-Einstellungen übergeben." };
          }
          if (!getBotToken(env)) {
            const cur = memoryFallback.get("bot_full_info_cache")?.data || {};
            const merged = { ...cur, ...payload };
            memoryFallback.set("bot_full_info_cache", { ts: Date.now(), data: merged });
            return { ok: true, simulated: true, applied: payload };
          }
          trackStat("telegramCalls");
          const res = await fetchWithTimeout(`${TELEGRAM_API}/setMySettings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          }, 5500);
          const json = await res.json().catch(() => null);
          if (res.ok && json?.ok) {
            memoryFallback.delete("bot_full_info_cache");
            return { ok: true, applied: payload, telegramResponse: json };
          }
          return {
            ok: false,
            status: res.status,
            applied: payload,
            telegramResponse: json,
            error: json?.description || `HTTP ${res.status}`
          };
        } catch (e) {
          return { ok: false, error: e?.message || "setMySettings failed" };
        }
      },

      async setMyCommands(customCommands = null) {
        try {
          trackStat("telegramCalls");
          const commands = Array.isArray(customCommands) && customCommands.length > 0
            ? customCommands
            : [
                { command: "start", description: "🍿 Hauptmenü & Netflix Mini-App öffnen" },
                { command: "search", description: "🔍 Film oder Serie direkt suchen" },
                { command: "filter", description: "🎛️ Katalog-Filter & Streaming-Dienste" },
                { command: "t", description: "🔥 Aktuelle Trends (z.B. /t f oder /t s)" },
                { command: "p", description: "🌟 Populäre Hits (z.B. /p f oder /p s)" },
                { command: "sc", description: "💎 Geheimtipps (z.B. /sc f oder /sc s)" },
                { command: "r", description: "🎲 Zufalls-Tipp (z.B. /r f oder /r s)" },
                { command: "info", description: "ℹ️ Hilfe, Befehle & Mini-App Guide" },
                { command: "id", description: "🆔 Eigene Chat- / Gruppen-ID anzeigen" }
              ];
          const res = await fetchWithTimeout(`${TELEGRAM_API}/setMyCommands`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commands })
          }, 4500);
          return res.ok ? await res.json() : { ok: false, status: res.status };
        } catch (e) {
          return { ok: false, error: e?.message || "setMyCommands failed" };
        }
      },

      async getChatMember(chatId, userId) {
        if (!chatId || !userId) return null;
        const cacheKey = `chat_member_${chatId}_${userId}`;
        const cached = memoryFallback.get(cacheKey);
        if (cached && (Date.now() - cached.ts < 120000)) {
          return cached.member;
        }
        try {
          trackStat("telegramCalls");
          const res = await fetchWithTimeout(`${TELEGRAM_API}/getChatMember`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, user_id: userId }),
          }, 3500);
          if (res.ok) {
            const data = await res.json();
            if (data.ok && data.result) {
              memoryFallback.set(cacheKey, { member: data.result, ts: Date.now() });
              return data.result;
            }
          }
        } catch (e) {}
        return null;
      },

      async getChatAdministrators(chatId) {
        if (!chatId) return [];
        const cacheKey = `chat_admins_${chatId}`;
        const cached = memoryFallback.get(cacheKey);
        if (cached && (Date.now() - cached.ts < 120000)) {
          return cached.admins;
        }
        try {
          trackStat("telegramCalls");
          const res = await fetchWithTimeout(`${TELEGRAM_API}/getChatAdministrators`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId }),
          }, 4000);
          if (res.ok) {
            const data = await res.json().catch(() => null);
            if (data?.ok && Array.isArray(data.result)) {
              memoryFallback.set(cacheKey, { admins: data.result, ts: Date.now() });
              return data.result;
            }
          }
        } catch (_e) {}
        return [];
      },

      async setMessageReaction(chatId, messageId, emoji = "👍", options = {}) {
        const msgIdNum = Number(messageId);
        if (!chatId || !Number.isFinite(msgIdNum) || msgIdNum <= 0) {
          return { ok: false, skipped: true };
        }
        const fallbackEmoji = options?.fallbackEmoji !== undefined ? options.fallbackEmoji : "👍";
        const isBig = Boolean(options?.isBig);
        const attemptReaction = async (targetEmoji) => {
          try {
            trackStat("telegramCalls");
            const reactionArr = targetEmoji ? [{ type: "emoji", emoji: String(targetEmoji) }] : [];
            const res = await fetchWithTimeout(`${TELEGRAM_API}/setMessageReaction`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                message_id: msgIdNum,
                reaction: reactionArr,
                is_big: isBig
              })
            }, 3500);
            const data = await res.json().catch(() => null);
            if (res.ok && data?.ok) {
              return { ok: true, emoji: targetEmoji };
            }
            const desc = String(data?.description || `HTTP ${res.status}`);
            if (res.status === 429) {
              const retryAfter = Math.max(1, Number(data?.parameters?.retry_after || 15));
              return { ok: false, rateLimited: true, retryAfter, error: desc };
            }
            const invalidReaction = /reaction_invalid|reactions_too_many|reaction_empty/i.test(desc);
            return { ok: false, status: res.status, invalidReaction, error: desc };
          } catch (e) {
            return { ok: false, error: e?.message || "setMessageReaction failed" };
          }
        };

        const invalidCacheKey = emoji ? `tg_invalid_react_${chatId}_${emoji}` : "";
        const cachedInvalidTs = invalidCacheKey ? Number(memoryFallback.get(invalidCacheKey) || 0) : 0;
        const effectiveEmoji = (cachedInvalidTs && (Date.now() - cachedInvalidTs) < 600000 && fallbackEmoji)
          ? fallbackEmoji
          : emoji;

        const first = await attemptReaction(effectiveEmoji);
        if (first.ok || first.rateLimited) return first;
        if (first.invalidReaction && fallbackEmoji && String(fallbackEmoji) !== String(effectiveEmoji)) {
          if (invalidCacheKey) memoryFallback.set(invalidCacheKey, Date.now());
          if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(40)) {
            return first;
          }
          return await attemptReaction(fallbackEmoji);
        }
        return first;
      },

      async sendMessage(chatId, text, options = {}) {
        try {
          trackStat("telegramCalls");
          const _fromAntiSpamQueue = Boolean(options?._fromAntiSpamQueue);
          const hasExplicitThread = Object.prototype.hasOwnProperty.call(options || {}, "message_thread_id");
          const cleanOptions = normalizeLinkPreviewOptions(options, true);
          const resolvedThreadId = resolveOutboundThreadId(chatId, cleanOptions.message_thread_id, hasExplicitThread);
          delete cleanOptions.message_thread_id;
          recordActualTelegramSendSlot(chatId);
          const safeMarkup = cleanOptions.reply_markup ? sanitizeReplyMarkup(cleanOptions.reply_markup) : undefined;
          const prepared = prepareTelegramHtmlPayload(text, 4090);
          const body = {
            ...cleanOptions,
            chat_id: chatId,
            text: prepared.text,
            parse_mode: prepared.parse_mode,
            reply_markup: safeMarkup
          };
          if (resolvedThreadId) body.message_thread_id = resolvedThreadId;
          let res = await fetchWithTimeout(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            _criticalSubrequest: true
          }, 6000);

          if (res.status === 429) {
            const errData = await res.json().catch(() => ({}));
            const retrySec = Number(errData?.parameters?.retry_after) || 5;
            registerAntiSpam429FloodWait(retrySec, chatId);
            if (!_fromAntiSpamQueue) {
              await enqueueAntiSpamJob(env, {
                chatId,
                title: "Bot-Nachricht (429 Auto-Queue)",
                quality: "Text",
                fileId: `tmdb_card_${Date.now()}`,
                caption: text,
                targetTopicId: resolvedThreadId ? String(resolvedThreadId) : "",
                method: "sendMessage",
                reasonCode: "flood_429",
                reason: `Telegram 429 retry_after (${retrySec}s)`,
                scheduledAt: Date.now() + (retrySec + 1) * 1000
              });
            }
            return { ok: false, _throttled429: true, retryAfter: retrySec };
          }

          if (res.status === 403) {
            const err403 = await res.json().catch(() => ({}));
            const errDesc403 = String(err403?.description || "Forbidden");
            return { ok: false, guestOrBlocked: true, status: 403, error: errDesc403 };
          }

          if (!res.ok) {
            let errJson = await res.clone().json().catch(() => null);
            let errDesc = String(errJson?.description || "");
            if (res.status === 400 && body.message_thread_id && isTelegramThreadNotFoundError(errDesc)) {
              clearActiveChatThreadId(chatId);
              delete body.message_thread_id;
              res = await fetchWithTimeout(`${TELEGRAM_API}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                _criticalSubrequest: true
              }, 6000);
              if (!res.ok) {
                errJson = await res.clone().json().catch(() => null);
                errDesc = String(errJson?.description || "");
              }
            }
            if (!res.ok) {
              if (res.status === 400 && isTelegramParseOrEntityError(errDesc)) {
                const plainTextRaw = unescapeMdChars(String(text || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")).replace(/[*_`]/g, "");
                const plainText = plainTextRaw.length > 4090 ? (plainTextRaw.slice(0, 4087) + "…") : plainTextRaw;
                const plainBody = { ...body, text: plainText, parse_mode: undefined, reply_markup: safeMarkup };
                res = await fetchWithTimeout(`${TELEGRAM_API}/sendMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(plainBody),
                  _criticalSubrequest: true
                }, 6000);
              } else {
                return null;
              }
            }
          }
          return res.ok ? await res.json() : null;
        } catch (e) {
          return null;
        }
      },

      // Bot API 10.0 / 10.4: Ephemeral Group Notice + Guest-Mode Fallback
      // Versucht in Gruppen zuerst eine private DM an den auslösenden Nutzer (0 Gruppen-Spam).
      // Falls der Nutzer im Guest-Mode ist (Bot noch nicht gestartet -> 403), fällt es auf eine kompakte, per 1 Klick schließbare Gruppen-Nachricht zurück.
      async sendEphemeralGroupOrPrivateNotice(chatId, userId, text, options = {}) {
        const apiRef = this && typeof this.sendMessage === "function" ? this : tgApi(env);
        const isGroup = isGroupOrChannelChatId(chatId);
        const cleanUserId = userId ? String(userId).trim() : "";
        if (isGroup && cleanUserId && cleanUserId !== String(chatId).trim()) {
          const dmOpts = { ...(options || {}), message_thread_id: null };
          const dmRes = await apiRef.sendMessage(cleanUserId, text, dmOpts);
          if (dmRes && dmRes.ok) {
            return { ...dmRes, deliveredPrivately: true, ephemeralMode: "private_dm" };
          }
          const groupFallbackOpts = { ...(options || {}) };
          if (!groupFallbackOpts.reply_markup) {
            groupFallbackOpts.reply_markup = {
              inline_keyboard: [[{ text: "✖️ Schließen", callback_data: "close_bot_msg" }]]
            };
          }
          const grpRes = await apiRef.sendMessage(chatId, text, groupFallbackOpts);
          return grpRes ? { ...grpRes, deliveredPrivately: false, ephemeralMode: "group_dismissible_fallback" } : null;
        }
        return await apiRef.sendMessage(chatId, text, options);
      },

      async sendPhoto(chatId, photoUrl, caption, options = {}) {
        try {
          trackStat("telegramCalls");
          const hasExplicitThread = Object.prototype.hasOwnProperty.call(options || {}, "message_thread_id");
          const resolvedThreadId = resolveOutboundThreadId(chatId, options?.message_thread_id, hasExplicitThread);
          const cleanPhotoOpts = { ...(options || {}) };
          delete cleanPhotoOpts.message_thread_id;
          recordActualTelegramSendSlot(chatId);
          const safeMarkup = cleanPhotoOpts.reply_markup ? sanitizeReplyMarkup(cleanPhotoOpts.reply_markup) : undefined;
          const prepared = prepareTelegramHtmlPayload(caption || "", 1020);
          const body = {
            ...cleanPhotoOpts,
            chat_id: chatId,
            photo: photoUrl,
            caption: prepared.text,
            parse_mode: prepared.parse_mode,
            reply_markup: safeMarkup
          };
          if (resolvedThreadId) body.message_thread_id = resolvedThreadId;
          let res = await fetchWithTimeout(`${TELEGRAM_API}/sendPhoto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            _criticalSubrequest: true
          }, 7000);

          if (res.status === 429) {
            const err429 = await res.json().catch(() => ({}));
            const retrySec = Number(err429?.parameters?.retry_after) || 5;
            registerAntiSpam429FloodWait(retrySec, chatId);
            return null;
          }

          if (!res.ok) {
            let errJson = await res.clone().json().catch(() => null);
            let errDesc = String(errJson?.description || "");
            if (res.status === 400 && body.message_thread_id && isTelegramThreadNotFoundError(errDesc)) {
              clearActiveChatThreadId(chatId);
              delete body.message_thread_id;
              res = await fetchWithTimeout(`${TELEGRAM_API}/sendPhoto`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                _criticalSubrequest: true
              }, 7000);
              if (!res.ok) {
                errJson = await res.clone().json().catch(() => null);
                errDesc = String(errJson?.description || "");
              }
            }
            if (!res.ok) {
              if (res.status === 400 && isTelegramParseOrEntityError(errDesc)) {
                const plainCaption = unescapeMdChars(
                  (caption || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
                ).replace(/[*_`]/g, "");
                const fallbackBody = {
                  ...body,
                  caption: plainCaption.length > 1020 ? plainCaption.slice(0, 1017) + "…" : plainCaption,
                  parse_mode: undefined,
                  reply_markup: safeMarkup
                };
                res = await fetchWithTimeout(`${TELEGRAM_API}/sendPhoto`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(fallbackBody),
                  _criticalSubrequest: true
                }, 7000);
              } else {
                return null;
              }
            }
          }
          return res.ok ? await res.json() : null;
        } catch (e) {
          return null;
        }
      },

      async editMessageReplyMarkup(chatId, messageId, replyMarkup) {
        try {
          trackStat("telegramCalls");
          const body = { chat_id: chatId, message_id: messageId, reply_markup: sanitizeReplyMarkup(replyMarkup) };
          let res = await fetchWithTimeout(`${TELEGRAM_API}/editMessageReplyMarkup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            _criticalSubrequest: true
          }, 5000);
          return res.ok ? await res.json() : null;
        } catch (e) {
          return null;
        }
      },

      async editInlineMessageText(inlineMessageId, text, options = {}) {
        try {
          trackStat("telegramCalls");
          const cleanOptions = normalizeLinkPreviewOptions(options, false);
          const safeMarkup = cleanOptions.reply_markup ? sanitizeReplyMarkup(cleanOptions.reply_markup) : undefined;
          const prepared = prepareTelegramHtmlPayload(text, 4090);
          const body = {
            ...cleanOptions,
            inline_message_id: inlineMessageId,
            text: prepared.text,
            parse_mode: prepared.parse_mode,
            reply_markup: safeMarkup
          };
          let res = await fetchWithTimeout(`${TELEGRAM_API}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            _criticalSubrequest: true
          }, 5000);
          return res.ok ? await res.json() : null;
        } catch (e) {
          return null;
        }
      },

      async editMessageText(chatId, messageId, text, options = {}) {
        try {
          trackStat("telegramCalls");
          const cleanOptions = normalizeLinkPreviewOptions(options, true);
          const safeMarkup = cleanOptions.reply_markup ? sanitizeReplyMarkup(cleanOptions.reply_markup) : undefined;
          const prepared = prepareTelegramHtmlPayload(text, 4090);
          const body = {
            ...cleanOptions,
            chat_id: chatId,
            message_id: messageId,
            text: prepared.text,
            parse_mode: prepared.parse_mode,
            reply_markup: safeMarkup
          };
          let res = await fetchWithTimeout(`${TELEGRAM_API}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            _criticalSubrequest: true
          }, 6000);
          if (res.status === 429) {
            const err429 = await res.json().catch(() => ({}));
            const retrySec = Number(err429?.parameters?.retry_after) || 5;
            registerAntiSpam429FloodWait(retrySec, chatId);
            return null;
          }
          if (!res.ok) {
            const errJson = await res.clone().json().catch(() => null);
            const errDesc = String(errJson?.description || "").toLowerCase();
            // WICHTIG: Wenn sich der Nachrichtentext/Markup nicht geändert hat (z.B. erneuter Klick auf denselben Button),
            // NIEMALS den Plain-Text-Fallback ausführen, da sonst alle Markdown-Links verschwinden!
            if (errDesc.includes("message is not modified")) {
              return { ok: true, notModified: true };
            }
            if (res.status === 400 && isTelegramParseOrEntityError(errDesc)) {
              const plainTextRaw = unescapeMdChars(String(text || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")).replace(/[*_`]/g, "");
              const plainText = plainTextRaw.length > 4090 ? (plainTextRaw.slice(0, 4087) + "…") : plainTextRaw;
              const fallbackBody = {
                ...body,
                text: plainText,
                parse_mode: undefined,
                reply_markup: safeMarkup
              };
              res = await fetchWithTimeout(`${TELEGRAM_API}/editMessageText`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(fallbackBody),
                _criticalSubrequest: true
              }, 6000);
            } else {
              return null;
            }
          }
          return res.ok ? await res.json() : null;
        } catch (e) {
          return null;
        }
      },

      async answerCallbackQuery(callbackQueryId, text = "", showAlert = false, url = "") {
        if (!callbackQueryId) return;
        try {
          trackStat("telegramCalls");
          // Telegram-Limit: max. 200 Zeichen für answerCallbackQuery-Text
          const safeText = String(text || "").length > 198 ? (String(text).slice(0, 195) + "…") : String(text || "");
          const body = { callback_query_id: callbackQueryId, text: safeText, show_alert: showAlert };
          if (url && typeof url === "string") body.url = url;
          await fetchWithTimeout(`${TELEGRAM_API}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            _criticalSubrequest: true
          }, 4000);
        } catch (e) {}
      },

      async deleteMessage(chatId, messageId) {
        if (!messageId) return;
        try {
          trackStat("telegramCalls");
          const body = { chat_id: chatId, message_id: messageId };
          await fetchWithTimeout(`${TELEGRAM_API}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            _criticalSubrequest: true
          }, 4000);
        } catch (e) {}
      },

      async getBotUsername(env) {
        if (!env?._isCustomBotWebhook && env?.BOT_USERNAME) return String(env.BOT_USERNAME).replace(/^@/, "");
        const activeToken = getBotToken(env) || resolvedBotToken;
        if (!activeToken) return "";
        const botIdScope = String(activeToken).split(":")[0] || "main";
        const cacheKey = `bot_username_${botIdScope}`;
        const failKey = `bot_username_fail_ts_${botIdScope}`;
        if (memoryFallback.has(cacheKey)) return memoryFallback.get(cacheKey);
        const lastFailTs = Number(memoryFallback.get(failKey) || 0);
        if (lastFailTs && (Date.now() - lastFailTs) < 60000) return "";
        try {
          trackStat("telegramCalls");
          const apiMeUrl = `https://api.telegram.org/bot${activeToken}/getMe`;
          const res = typeof fetchWithTimeout === "function"
            ? await fetchWithTimeout(apiMeUrl, {}, 3000)
            : await fetch(apiMeUrl);
          if (res.ok) {
            const data = await res.json();
            if (data?.result?.username) {
              memoryFallback.delete(failKey);
              memoryFallback.set(cacheKey, data.result.username);
              return data.result.username;
            }
          }
          memoryFallback.set(failKey, Date.now());
        } catch (e) {
          memoryFallback.set(failKey, Date.now());
        }
        return "";
      },

      async getFileText(fileId) {
        if (!fileId || !resolvedBotToken) return null;
        try {
          trackStat("telegramCalls");
          const res = await fetchWithTimeout(`${TELEGRAM_API}/getFile?file_id=${encodeURIComponent(fileId)}`, {}, 4000);
          if (!res.ok) return null;
          const data = await res.json();
          const filePath = data?.result?.file_path;
          if (!filePath) return null;
          const fileUrl = `https://api.telegram.org/file/bot${resolvedBotToken}/${filePath}`;
          const fileRes = await fetchWithTimeout(fileUrl, {}, 6000);
          if (!fileRes.ok) return null;
          return await fileRes.text();
        } catch (e) {
          return null;
        }
      },

      async sendVideoByFileId(chatId, telegramFileId, caption = "", options = {}) {
        if (!chatId || !telegramFileId) return null;
        return await this.deliverMediaOrCopyFromSource(chatId, telegramFileId, caption, options);
      },

      // Telegram Bot API 7.0+: copyMessages kopiert bis zu 100 Nachrichten aus demselben Quell-Chat in 1 einzigen API-Aufruf
      async copyMessagesBatch(targetChatId, fromChatId, messageIds, extraOpts = {}) {
        if (!targetChatId || !fromChatId || !Array.isArray(messageIds) || messageIds.length === 0) {
          return { ok: false, error: "Ungültige Parameter für copyMessages." };
        }
        const cleanIds = Array.from(new Set(
          messageIds
            .map(n => parseInt(String(n), 10))
            .filter(n => Number.isInteger(n) && n > 0)
        )).sort((a, b) => a - b).slice(0, 100);
        if (cleanIds.length === 0) {
          return { ok: false, error: "Keine gültigen message_ids für copyMessages." };
        }
        const customToken = String(extraOpts.customBotToken || "").trim();
        const activeToken = (customToken && /^\d+:[A-Za-z0-9_-]{20,}$/.test(customToken)) ? customToken : resolvedBotToken;
        if (!activeToken) {
          return { ok: false, error: "Kein Bot-Token konfiguriert." };
        }
        const apiBase = `https://api.telegram.org/bot${activeToken}`;
        const threadId = extraOpts.messageThreadId && /^\d+$/.test(String(extraOpts.messageThreadId).trim())
          ? parseInt(String(extraOpts.messageThreadId).trim(), 10)
          : undefined;
        const payload = {
          chat_id: targetChatId,
          from_chat_id: fromChatId,
          message_ids: cleanIds
        };
        if (threadId) payload.message_thread_id = threadId;
        if (extraOpts.disableNotification) payload.disable_notification = true;
        if (extraOpts.protectContent) payload.protect_content = true;
        if (extraOpts.removeCaption) payload.remove_caption = true;

        try {
          trackStat("telegramCalls");
          recordActualTelegramSendSlot(targetChatId);
          const res = await fetchWithTimeout(`${apiBase}/copyMessages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            _criticalSubrequest: true
          }, 10000);
          if (res.status === 429) {
            const err429 = await res.json().catch(() => ({}));
            const retryAfter = Number(err429?.parameters?.retry_after) || 5;
            registerAntiSpam429FloodWait(retryAfter, targetChatId);
            return { ok: false, throttled429: true, retryAfter, error: `Telegram 429 (${retryAfter}s)` };
          }
          const json = await res.json().catch(() => ({}));
          if (res.ok && json?.ok && Array.isArray(json.result)) {
            const copiedIds = json.result
              .map(r => Number(r?.message_id || 0))
              .filter(n => Number.isInteger(n) && n > 0);
            return {
              ok: true,
              copiedCount: copiedIds.length || cleanIds.length,
              messageIds: copiedIds,
              firstMessageId: copiedIds[0] || null,
              result: json.result
            };
          }
          return {
            ok: false,
            status: res.status,
            error: String(json?.description || `copyMessages HTTP ${res.status}`)
          };
        } catch (err) {
          return { ok: false, error: String(err?.message || "copyMessages Netzwerkfehler") };
        }
      },

      async deliverMediaOrCopyFromSource(targetChatId, fileIdOrExportRef, caption = "", extraOpts = {}) {
        if (!targetChatId || !fileIdOrExportRef) return null;
        try {
          trackStat("telegramCalls");
          const customToken = String(extraOpts.customBotToken || "").trim();
          const apiBase = (customToken && /^\d+:[A-Za-z0-9_-]{20,}$/.test(customToken))
            ? `https://api.telegram.org/bot${customToken}`
            : TELEGRAM_API;
          const preparedCap = prepareTelegramHtmlPayload(caption || "", 1020);
          const htmlCaption = preparedCap.text;
          const captionParseMode = preparedCap.parse_mode;
          const hasExplicitThread = Object.prototype.hasOwnProperty.call(extraOpts || {}, "messageThreadId") || Object.prototype.hasOwnProperty.call(extraOpts || {}, "message_thread_id");
          const explicitThreadRaw = Object.prototype.hasOwnProperty.call(extraOpts || {}, "messageThreadId")
            ? extraOpts.messageThreadId
            : extraOpts?.message_thread_id;
          let threadId = resolveOutboundThreadId(targetChatId, explicitThreadRaw, hasExplicitThread) || undefined;
          let topicFallbackTriggered = false;
          const resolvedCoverUrl = await resolveVideoCoverUrlForDelivery(env, extraOpts);
          const startTimestamp = Number(extraOpts.startTimestamp) > 0 ? Math.floor(Number(extraOpts.startTimestamp)) : undefined;

          // 1. Prüfe auf Quellgruppen-Referenz aus Telegram Desktop Chat-Backup (tg_export_<channelId>_<msgId>)
          const exportMatch = String(fileIdOrExportRef).trim().match(/^tg_export_(-?\d+)_(\d+)$/i);
          if (exportMatch) {
            recordActualTelegramSendSlot(targetChatId);
            const rawChannelId = exportMatch[1];
            const sourceMsgId = parseInt(exportMatch[2], 10);
            const overrideBridge = String(extraOpts.sourceBridgeChatId || env.SOURCE_GROUP_CHAT_ID || "").trim();
            const fromChatId = overrideBridge || (rawChannelId.startsWith("-100") || rawChannelId.startsWith("-") ? rawChannelId : `-100${rawChannelId}`);

            // Versuch A: Kopiere Nachricht sauber per copyMessage (Hinweis: Telegram copyMessage unterstützt keinen cover-Parameter -> Cover wird direkt danach via editMessageMedia gesetzt!)
            const copyPayload = {
              chat_id: targetChatId,
              from_chat_id: fromChatId,
              message_id: sourceMsgId,
              caption: htmlCaption,
              parse_mode: captionParseMode
            };
            if (threadId) copyPayload.message_thread_id = threadId;

            let copyRes = await fetchWithTimeout(`${apiBase}/copyMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(copyPayload),
              _criticalSubrequest: true
            }, 7000);

            if (copyRes.status === 429) {
              const err429Copy = await copyRes.json().catch(() => ({}));
              registerAntiSpam429FloodWait(Number(err429Copy?.parameters?.retry_after) || 5, targetChatId);
              return null;
            }

            if (!copyRes.ok) {
              const copyErrJson = await copyRes.clone().json().catch(() => null);
              const copyErrDesc = String(copyErrJson?.description || "");
              if (copyRes.status === 400 && threadId && isTelegramThreadNotFoundError(copyErrDesc)) {
                clearActiveChatThreadId(targetChatId);
                threadId = undefined;
                topicFallbackTriggered = true;
                const retryNoThreadPayload = { ...copyPayload };
                delete retryNoThreadPayload.message_thread_id;
                copyRes = await fetchWithTimeout(`${apiBase}/copyMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(retryNoThreadPayload),
                  _criticalSubrequest: true
                }, 7000);
                if (copyRes.status === 429) {
                  const err429CopyThread = await copyRes.json().catch(() => ({}));
                  registerAntiSpam429FloodWait(Number(err429CopyThread?.parameters?.retry_after) || 5, targetChatId);
                  return null;
                }
              }
            }

            if (!copyRes.ok) {
              // Fallback ohne HTML parse_mode falls Sonderzeichen im Caption-Text
              const plainCaption = unescapeMdChars(String(caption || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")).replace(/[*_`]/g, "");
              const fallbackCopyPayload = {
                chat_id: targetChatId,
                from_chat_id: fromChatId,
                message_id: sourceMsgId,
                caption: plainCaption.slice(0, 1020)
              };
              if (threadId) fallbackCopyPayload.message_thread_id = threadId;
              copyRes = await fetchWithTimeout(`${apiBase}/copyMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(fallbackCopyPayload),
                _criticalSubrequest: true
              }, 7000);
              if (copyRes.status === 429) {
                const err429Copy2 = await copyRes.json().catch(() => ({}));
                registerAntiSpam429FloodWait(Number(err429Copy2?.parameters?.retry_after) || 5, targetChatId);
                return null;
              }
            }

            if (copyRes.ok) {
              const copyData = await copyRes.json().catch(() => ({ ok: true }));
              const copiedMessageId = copyData?.result?.message_id || null;
              let harvestedFileId = null;
              let harvestedIsVideo = false;
              let coverEmbedded = false;

              // Automatisches File-ID Harvesting für dauerhaftes Bot API 8.3 Cover-Embedding ohne Re-Upload
              const videoInRes = copyData?.result?.video || copyData?.result?.document;
              if (videoInRes && videoInRes.file_id) {
                harvestedFileId = videoInRes.file_id;
                harvestedIsVideo = Boolean(copyData?.result?.video);
                await replaceExportFileIdInD1(env, String(fileIdOrExportRef).trim(), harvestedFileId, videoInRes.file_unique_id || null);
              } else if (extraOpts.autoHarvestFileId !== false) {
                // Datenschutz- & Anti-429-Schutz: NIEMALS per forwardMessage in den User-Chat (targetChatId) weiterleiten
                // (würde privaten Quellkanalnamen leaken, Doppel-Nachrichten riskieren & 3 zusätzliche Telegram-API-Calls auslösen).
                // File-ID Harvesting via forwardMessage läuft ausschließlich über einen dedizierten privaten Cache-Kanal (env.HARVEST_CACHE_CHAT_ID).
                const harvestTargetChat = String(env.HARVEST_CACHE_CHAT_ID || "").trim();
                const isSafeDedicatedHarvestChat = Boolean(
                  harvestTargetChat &&
                  harvestTargetChat !== String(targetChatId).trim()
                );
                if (isSafeDedicatedHarvestChat) {
                  try {
                    const fwdPayload = {
                      chat_id: harvestTargetChat,
                      from_chat_id: fromChatId,
                      message_id: sourceMsgId,
                      disable_notification: true
                    };
                    const fwdRes = await fetchWithTimeout(`${apiBase}/forwardMessage`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(fwdPayload),
                      _criticalSubrequest: true
                    }, 6000);
                    if (fwdRes.status === 429) {
                      const err429Fwd = await fwdRes.json().catch(() => ({}));
                      registerAntiSpam429FloodWait(Number(err429Fwd?.parameters?.retry_after) || 5, harvestTargetChat);
                    } else if (fwdRes.ok) {
                      const fwdJson = await fwdRes.json().catch(() => null);
                      const fwdMsgId = fwdJson?.result?.message_id;
                      const mediaObj = fwdJson?.result?.video || fwdJson?.result?.document;
                      if (mediaObj?.file_id) {
                        harvestedFileId = mediaObj.file_id;
                        harvestedIsVideo = Boolean(fwdJson?.result?.video);
                        await replaceExportFileIdInD1(env, String(fileIdOrExportRef).trim(), harvestedFileId, mediaObj.file_unique_id || null);
                      }
                      if (fwdMsgId) {
                        await fetchWithTimeout(`${apiBase}/deleteMessage`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ chat_id: harvestTargetChat, message_id: fwdMsgId }),
                          _criticalSubrequest: true
                        }, 4000).catch(() => {});
                      }
                    }
                  } catch (e) {}
                }
              }

              // Wenn wir eine Video-File-ID geerntet haben und ein TMDb-Cover aktiv ist:
              // Direkt die kopierte Nachricht in-place per editMessageMedia + InputMediaVideo (Bot API 8.3 cover) veredeln!
              if (harvestedFileId && harvestedIsVideo && resolvedCoverUrl && copiedMessageId) {
                try {
                  const editMediaPayload = {
                    chat_id: targetChatId,
                    message_id: copiedMessageId,
                    media: {
                      type: "video",
                      media: harvestedFileId,
                      cover: resolvedCoverUrl,
                      caption: htmlCaption,
                      parse_mode: captionParseMode,
                      supports_streaming: true
                    }
                  };
                  const editRes = await fetchWithTimeout(`${apiBase}/editMessageMedia`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(editMediaPayload),
                    _criticalSubrequest: true
                  }, 6000);
                  if (editRes.ok) {
                    coverEmbedded = true;
                  }
                } catch (e) {}
              }

              return {
                ok: true,
                copiedFromSourceGroup: true,
                fromChatId,
                sourceMessageId: sourceMsgId,
                harvestedFileId,
                coverEmbedded,
                coverUrl: coverEmbedded ? resolvedCoverUrl : null,
                topicFallbackTriggered,
                result: copyData?.result || { message_id: Date.now() }
              };
            }
            return null;
          }

          // 2. Regulärer Versand per echter telegram_file_id (sendVideo inkl. Bot API 8.3 cover Parameter + Fallback)
          recordActualTelegramSendSlot(targetChatId);
          const videoBody = {
            chat_id: targetChatId,
            video: fileIdOrExportRef,
            caption: htmlCaption,
            parse_mode: captionParseMode,
            supports_streaming: true
          };
          if (threadId) videoBody.message_thread_id = threadId;
          if (resolvedCoverUrl) videoBody.cover = resolvedCoverUrl;
          if (startTimestamp !== undefined) videoBody.start_timestamp = startTimestamp;

          let usedCover = Boolean(resolvedCoverUrl);
          let res = await fetchWithTimeout(`${apiBase}/sendVideo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(videoBody),
            _criticalSubrequest: true
          }, 8000);
          if (res.status === 429) {
            const err429 = await res.json().catch(() => ({}));
            const retrySec = Number(err429?.parameters?.retry_after) || 5;
            registerAntiSpam429FloodWait(retrySec, targetChatId);
            return null;
          }
          if (!res.ok && threadId) {
            const vidErrJson = await res.clone().json().catch(() => null);
            const vidErrDesc = String(vidErrJson?.description || "");
            if (res.status === 400 && isTelegramThreadNotFoundError(vidErrDesc)) {
              clearActiveChatThreadId(targetChatId);
              threadId = undefined;
              topicFallbackTriggered = true;
              delete videoBody.message_thread_id;
              res = await fetchWithTimeout(`${apiBase}/sendVideo`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(videoBody),
                _criticalSubrequest: true
              }, 8000);
              if (res.status === 429) {
                const err429ThreadVid = await res.json().catch(() => ({}));
                registerAntiSpam429FloodWait(Number(err429ThreadVid?.parameters?.retry_after) || 5, targetChatId);
                return null;
              }
            }
          }
          // Falls Telegram das Cover-Bild ablehnt (z. B. temporärer Fetch-Fehler bei Bild-URL), versuche sendVideo ohne cover
          if (!res.ok && usedCover) {
            usedCover = false;
            const fallbackVideoBody = { ...videoBody };
            delete fallbackVideoBody.cover;
            res = await fetchWithTimeout(`${apiBase}/sendVideo`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(fallbackVideoBody),
              _criticalSubrequest: true
            }, 8000);
            if (res.status === 429) {
              const err429Retry = await res.json().catch(() => ({}));
              registerAntiSpam429FloodWait(Number(err429Retry?.parameters?.retry_after) || 5, targetChatId);
              return null;
            }
          }
          if (!res.ok) {
            usedCover = false;
            const docBody = {
              chat_id: targetChatId,
              document: fileIdOrExportRef,
              caption: htmlCaption,
              parse_mode: captionParseMode
            };
            if (threadId) docBody.message_thread_id = threadId;
            res = await fetchWithTimeout(`${apiBase}/sendDocument`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(docBody),
              _criticalSubrequest: true
            }, 8000);
            if (res.status === 429) {
              const err429Doc = await res.json().catch(() => ({}));
              registerAntiSpam429FloodWait(Number(err429Doc?.parameters?.retry_after) || 5, targetChatId);
              return null;
            }
          }
          if (!res.ok) return null;
          const jsonRes = await res.json().catch(() => ({ ok: true }));
          return {
            ...jsonRes,
            ok: true,
            coverEmbedded: usedCover,
            coverUrl: usedCover ? resolvedCoverUrl : null,
            topicFallbackTriggered
          };
        } catch (e) {
          return null;
        }
      },

      // Bot API 9.3 / 10.5: Themen im Privatchat (bei has_topics_enabled) & in Forum-Supergruppen anlegen/bearbeiten/löschen
      async createForumTopic(chatId, name, options = {}) {
        if (!chatId || !name) return { ok: false, error: "chat_id und Themenname erforderlich." };
        try {
          trackStat("telegramCalls");
          const customToken = String(options.customBotToken || "").trim();
          const apiBase = (customToken && /^\d+:[A-Za-z0-9_-]{20,}$/.test(customToken))
            ? `https://api.telegram.org/bot${customToken}`
            : TELEGRAM_API;
          const cleanName = String(name).replace(/\s+/g, " ").trim().slice(0, 128);
          if (!cleanName) return { ok: false, error: "Leerer Themenname." };
          const body = { chat_id: chatId, name: cleanName };
          if (Number.isInteger(options.icon_color)) body.icon_color = options.icon_color;
          if (options.icon_custom_emoji_id) body.icon_custom_emoji_id = String(options.icon_custom_emoji_id);
          const res = await fetchWithTimeout(`${apiBase}/createForumTopic`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            _criticalSubrequest: true
          }, 6000);
          if (res.status === 429) {
            const err429 = await res.json().catch(() => ({}));
            registerAntiSpam429FloodWait(Number(err429?.parameters?.retry_after) || 5, chatId);
            return { ok: false, throttled429: true, error: "Telegram 429 Rate-Limit" };
          }
          const json = await res.json().catch(() => ({}));
          if (res.ok && json?.ok && json?.result?.message_thread_id) {
            return {
              ok: true,
              message_thread_id: Number(json.result.message_thread_id),
              name: String(json.result.name || cleanName),
              icon_color: json.result.icon_color,
              result: json.result
            };
          }
          const errDesc = String(json?.description || `HTTP ${res.status}`);
          const low = errDesc.toLowerCase();
          const notSupported = low.includes("not a forum") || low.includes("topics_disabled") || low.includes("not enough rights") || low.includes("chat_not_modified");
          return { ok: false, status: res.status, notSupported, error: errDesc };
        } catch (e) {
          return { ok: false, error: String(e?.message || "createForumTopic Fehler") };
        }
      },

      async editForumTopic(chatId, messageThreadId, options = {}) {
        const tid = parseValidTelegramThreadId(messageThreadId);
        if (!chatId || !tid) return { ok: false, error: "Ungültige chat_id oder message_thread_id." };
        try {
          trackStat("telegramCalls");
          const customToken = String(options.customBotToken || "").trim();
          const apiBase = (customToken && /^\d+:[A-Za-z0-9_-]{20,}$/.test(customToken))
            ? `https://api.telegram.org/bot${customToken}`
            : TELEGRAM_API;
          const body = { chat_id: chatId, message_thread_id: tid };
          if (typeof options.name === "string" && options.name.trim()) {
            body.name = options.name.replace(/\s+/g, " ").trim().slice(0, 128);
          }
          if (typeof options.icon_custom_emoji_id === "string") {
            body.icon_custom_emoji_id = options.icon_custom_emoji_id;
          }
          const res = await fetchWithTimeout(`${apiBase}/editForumTopic`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            _criticalSubrequest: true
          }, 5000);
          const json = await res.json().catch(() => ({}));
          return (res.ok && json?.ok) ? { ok: true } : { ok: false, status: res.status, error: String(json?.description || `HTTP ${res.status}`) };
        } catch (e) {
          return { ok: false, error: String(e?.message || "editForumTopic Fehler") };
        }
      },

      async deleteForumTopic(chatId, messageThreadId, options = {}) {
        const tid = parseValidTelegramThreadId(messageThreadId);
        if (!chatId || !tid) return { ok: false, error: "Ungültige chat_id oder message_thread_id." };
        try {
          trackStat("telegramCalls");
          const customToken = String(options.customBotToken || "").trim();
          const apiBase = (customToken && /^\d+:[A-Za-z0-9_-]{20,}$/.test(customToken))
            ? `https://api.telegram.org/bot${customToken}`
            : TELEGRAM_API;
          const res = await fetchWithTimeout(`${apiBase}/deleteForumTopic`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, message_thread_id: tid }),
            _criticalSubrequest: true
          }, 5000);
          const json = await res.json().catch(() => ({}));
          return (res.ok && json?.ok) ? { ok: true } : { ok: false, status: res.status, error: String(json?.description || `HTTP ${res.status}`) };
        } catch (e) {
          return { ok: false, error: String(e?.message || "deleteForumTopic Fehler") };
        }
      },
    };
  }

  // @ANCHOR: KV_STORAGE_WISHLIST
  // --- Unified User Bundle (`u_bundle_${chatId}`) + Write-Back Batcher ---
  // Konsolidiert Merkliste (`user_`), Ordner (`folders_`), Einstellungen (`settings_`) & Session (`sess_`)
  // in EINEN einzigen KV-Key pro Nutzer (mit automatischer Lazy-Migration bestehender Legacy-Keys beim ersten Lesen).
  const DEFAULT_USER_SETTINGS_TEMPLATE = {
    includedFsk: [],
    excludedFsk: [],
    includedGenres: [],
    excludedGenres: [],
    includedEras: [],
    excludedEras: [],
    includedStudios: [],
    excludedStudios: [],
    includedPlatforms: [],
    excludedPlatforms: [],
    showUnreleased: false,
    filtersActive: true,
    uiScale: { all: 100, text: 100, cover: 100, menu: 100 }
  };

  function syncUserBundleToMemoryMirrors(chatId, bundle) {
    if (!chatId || !bundle) return;
    memoryFallback.set(`u_bundle_${chatId}`, bundle);
    memoryFallback.set(`u_bundle_ts_${chatId}`, Date.now());
    memoryFallback.set(`user_${chatId}`, bundle.savedList || []);
    memoryFallback.set(`folders_${chatId}`, bundle.folders || []);
    memoryFallback.set(`settings_${chatId}`, bundle.settings || { ...DEFAULT_USER_SETTINGS_TEMPLATE });
    memoryFallback.set(`sess_${chatId}`, bundle.session || {});
  }

  async function stageUserBundleWrite(env, chatId, bundle, options = {}) {
    if (!chatId || !bundle) return;
    const cleanSession = { ...(bundle.session || {}) };
    delete cleanSession._dirty;
    const normSavedList = Array.isArray(bundle.savedList) ? bundle.savedList : [];
    const normFolders = Array.isArray(bundle.folders) ? bundle.folders : [];
    const normSettings = bundle.settings && typeof bundle.settings === "object"
      ? { ...DEFAULT_USER_SETTINGS_TEMPLATE, ...bundle.settings }
      : { ...DEFAULT_USER_SETTINGS_TEMPLATE };

    syncUserBundleToMemoryMirrors(chatId, bundle);

    const forceKv = Boolean(options?.forceKvWrite || options?.flushNow);
    const contentSigKey = `u_bundle_sig_${chatId}`;
    const serializeForSig = typeof stableJsonStringify === "function" ? stableJsonStringify : JSON.stringify;
    const nextSig = serializeForSig({
      savedList: normSavedList,
      folders: normFolders,
      settings: normSettings,
      session: cleanSession
    });
    if (!forceKv && memoryFallback.get(contentSigKey) === nextSig) {
      return;
    }
    memoryFallback.set(contentSigKey, nextSig);

    bundle.v = 2;
    bundle.updatedAt = Date.now();
    const payloadToPersist = {
      v: 2,
      updatedAt: bundle.updatedAt,
      savedList: normSavedList,
      folders: normFolders,
      settings: normSettings,
      session: cleanSession
    };
    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    if (hasD1 && typeof saveEntityToD1 === "function") {
      // D1-first für User-Bundles (100.000 Writes/Tag statt KV 1.000/Tag, 0s globale Edge-Konsistenz, kein 1-Write/s-Limit!)
      await saveEntityToD1(env, `u_bundle_${chatId}`, "user_bundle", payloadToPersist);
      return;
    }
    // Fallback ohne D1-Binding: KV-Write am Request-Ende via flushDirtyKvBatch
    await kvStageWrite(env, `u_bundle_${chatId}`, payloadToPersist, {
      bindingName: "MOVIE_SAVED",
      periodicOnly: false,
      forceKvWrite: forceKv,
      flushNow: Boolean(options?.flushNow)
    });
  }

  async function getUserBundle(env, chatId, options = {}) {
    const cleanId = String(chatId || "guest");
    const bundleKey = `u_bundle_${cleanId}`;
    const isBrowserSandbox = typeof localStorage !== "undefined" && typeof window !== "undefined";
    const bundleTs = Number(memoryFallback.get(`u_bundle_ts_${cleanId}`) || 0);
    const hasPendingDirtyWrite = typeof kvDirtyBuffer !== "undefined" && kvDirtyBuffer.has(bundleKey);
    const canUseMemBundle = !options?.forceRefresh && memoryFallback.has(bundleKey) && (
      isBrowserSandbox ||
      cleanId === "guest" ||
      cleanId === "bot_vip" ||
      hasPendingDirtyWrite ||
      (bundleTs > 0 && (Date.now() - bundleTs) < 15000)
    );
    if (canUseMemBundle) {
      const memBundle = memoryFallback.get(bundleKey);
      if (memBundle && typeof memBundle === "object") {
        if (memoryFallback.has(`user_${cleanId}`)) {
          memBundle.savedList = normalizeSavedItems(memoryFallback.get(`user_${cleanId}`));
        }
        if (memoryFallback.has(`folders_${cleanId}`)) {
          memBundle.folders = memoryFallback.get(`folders_${cleanId}`) || [];
        }
        if (memoryFallback.has(`settings_${cleanId}`)) {
          memBundle.settings = { ...DEFAULT_USER_SETTINGS_TEMPLATE, ...memoryFallback.get(`settings_${cleanId}`) };
        }
        if (memoryFallback.has(`sess_${cleanId}`)) {
          memBundle.session = memoryFallback.get(`sess_${cleanId}`) || {};
        }
        return memBundle;
      }
    }

    // Für bot_vip niemals KV lesen – bot_vip lebt zu 100% in D1 (d1_playlist_folders / d1_playlist_items)
    if (cleanId === "bot_vip") {
      const botVipBundle = {
        v: 2,
        updatedAt: Date.now(),
        savedList: [],
        folders: [],
        settings: { ...DEFAULT_USER_SETTINGS_TEMPLATE },
        session: {}
      };
      syncUserBundleToMemoryMirrors(cleanId, botVipBundle);
      return botVipBundle;
    }

    // 1. D1-first (sofortige globale Edge-Konsistenz, 0 KV-Reads/Writes!)
    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    if (hasD1 && typeof getEntityFromD1 === "function" && cleanId !== "guest") {
      try {
        const d1Bundle = await getEntityFromD1(env, bundleKey, 3650 * 86400000, {
          ramTtlMs: 15000,
          bypassMemoryCache: Boolean(options?.forceRefresh)
        });
        if (d1Bundle && typeof d1Bundle === "object") {
          const hydrated = {
            v: 2,
            updatedAt: d1Bundle.updatedAt || Date.now(),
            savedList: normalizeSavedItems(d1Bundle.savedList || []),
            folders: Array.isArray(d1Bundle.folders) ? d1Bundle.folders : [],
            settings: { ...DEFAULT_USER_SETTINGS_TEMPLATE, ...(d1Bundle.settings || {}) },
            session: d1Bundle.session && typeof d1Bundle.session === "object" ? d1Bundle.session : {}
          };
          syncUserBundleToMemoryMirrors(cleanId, hydrated);
          return hydrated;
        }
      } catch (e) {}
    }

    // 2. Fallback & automatische 1x-Migration bestehender KV-User-Bundles nach D1
    try {
      const rawBundle = await kvCachedGetRaw(env, bundleKey, "MOVIE_SAVED");
      if (rawBundle) {
        const parsed = JSON.parse(rawBundle);
        if (parsed && typeof parsed === "object") {
          const hydrated = {
            v: 2,
            updatedAt: parsed.updatedAt || Date.now(),
            savedList: normalizeSavedItems(parsed.savedList || []),
            folders: Array.isArray(parsed.folders) ? parsed.folders : [],
            settings: { ...DEFAULT_USER_SETTINGS_TEMPLATE, ...(parsed.settings || {}) },
            session: parsed.session && typeof parsed.session === "object" ? parsed.session : {}
          };
          syncUserBundleToMemoryMirrors(cleanId, hydrated);
          if (hasD1 && typeof saveEntityToD1 === "function" && cleanId !== "guest") {
            scheduleBackgroundWork(() => saveEntityToD1(env, bundleKey, "user_bundle", hydrated));
          }
          return hydrated;
        }
      }
    } catch (e) {}

    // Automatische Lazy-Migration bestehender Legacy-KV-Keys (nur 1-malig pro Chat-ID prüfen, spart 4 KV-Reads bei neuen Usern!)
    let migratedFromLegacy = false;
    let savedList = [];
    let folders = [];
    let settings = { ...DEFAULT_USER_SETTINGS_TEMPLATE };
    let session = {};
    const legacyCheckedKey = `u_legacy_checked_${cleanId}`;

    if (!memoryFallback.has(legacyCheckedKey) && cleanId !== "guest") {
      memoryFallback.set(legacyCheckedKey, true);
      try {
        const [rawUser, rawFolders, rawSettings, rawSess] = await Promise.all([
          kvCachedGetRaw(env, `user_${cleanId}`, "MOVIE_SAVED"),
          kvCachedGetRaw(env, `folders_${cleanId}`, "MOVIE_SAVED"),
          kvCachedGetRaw(env, `settings_${cleanId}`, "MOVIE_SAVED"),
          kvCachedGetRaw(env, `sess_${cleanId}`, "MOVIE_SAVED")
        ]);
        if (rawUser) {
          savedList = normalizeSavedItems(JSON.parse(rawUser));
          migratedFromLegacy = true;
        }
        if (rawFolders) {
          const pf = JSON.parse(rawFolders);
          if (Array.isArray(pf)) folders = pf;
          migratedFromLegacy = true;
        }
        if (rawSettings) {
          const ps = JSON.parse(rawSettings);
          if (ps && typeof ps === "object") settings = { ...DEFAULT_USER_SETTINGS_TEMPLATE, ...ps };
          migratedFromLegacy = true;
        }
        if (rawSess) {
          const pss = JSON.parse(rawSess);
          if (pss && typeof pss === "object") session = pss;
          migratedFromLegacy = true;
        }
      } catch (e) {}
    }

    const bundle = {
      v: 2,
      updatedAt: Date.now(),
      savedList,
      folders,
      settings,
      session
    };
    syncUserBundleToMemoryMirrors(cleanId, bundle);

    if (migratedFromLegacy) {
      await stageUserBundleWrite(env, cleanId, bundle, { deferKvWrite: true });
    }
    return bundle;
  }

  async function getSavedList(env, chatId, options = {}) {
    const cleanId = String(chatId || "").trim();
    const now = Date.now();
    const lastHydratedTs = Number(memoryFallback.get(`user_list_hydrated_ts_${cleanId}`) || 0);
    if (!options?.forceRefresh && memoryFallback.has(`user_${cleanId}`) && (now - lastHydratedTs) < 60000) {
      const cachedList = memoryFallback.get(`user_${cleanId}`);
      if (Array.isArray(cachedList)) return cachedList;
    }
    const bundle = await getUserBundle(env, cleanId);
    const kvItems = normalizeSavedItems(bundle.savedList);
    let d1Items = [];
    try {
      d1Items = await getPlaylistItemsFromD1(env, cleanId);
    } catch (e) {}
    if (Array.isArray(d1Items) && d1Items.length > 0) {
      const byUid = new Map();
      for (const it of kvItems) {
        if (it && it.uid) byUid.set(String(it.uid), it);
      }
      for (const dIt of d1Items) {
        if (!dIt || !dIt.uid) continue;
        const existing = byUid.get(String(dIt.uid));
        byUid.set(String(dIt.uid), existing ? { ...dIt, ...existing, poster: existing.poster || dIt.poster_path } : {
          ...dIt,
          poster: dIt.poster || dIt.poster_path || null,
          quality: dIt.vipQuality || dIt.quality || "1080p",
          allQualities: dIt.vipQuality || dIt.allQualities || "1080p",
          streamCount: Number(dIt.vipStreamCount || dIt.streamCount || 1)
        });
      }
      bundle.savedList = normalizeSavedItems(Array.from(byUid.values()));
    } else {
      bundle.savedList = kvItems;
    }
    memoryFallback.set(`user_${cleanId}`, bundle.savedList);
    memoryFallback.set(`user_list_hydrated_ts_${cleanId}`, now);
    return bundle.savedList;
  }

  function normalizeSavedItems(list) {
    if (!Array.isArray(list)) return [];
    return list.map((item, idx) => {
      if (typeof item === "string") {
        return {
          uid: `legacy_${idx}`,
          tmdbId: null,
          contentType: "movie",
          title: item,
          year: "K. A.",
          fsk: "K. A.",
          genres: "K. A.",
          folderId: null,
          addedAt: idx + 1
        };
      }
      return {
        ...item,
        uid: item.uid || `${item.contentType === "series" ? "s" : item.contentType === "episode" ? "ep" : "m"}_${item.tmdbId || idx}`,
        tmdbId: item.tmdbId || null,
        contentType: item.contentType || "movie",
        title: item.title || "Unbekannt",
        year: item.year || "K. A.",
        fsk: item.fsk || "K. A.",
        genres: item.genres || "K. A.",
        folderId: item.folderId || null,
        seriesId: item.seriesId || null,
        seriesTitle: item.seriesTitle || null,
        seasonNumber: item.seasonNumber || null,
        episodeNumber: item.episodeNumber || null,
        personName: item.personName || null,
        personRole: item.personRole || null,
        addedAt: item.addedAt || (idx + 1)
      };
    });
  }

  async function saveRawList(env, chatId, list, options = {}) {
    const cleanId = String(chatId || "").trim();
    const bundle = await getUserBundle(env, cleanId);
    bundle.savedList = Array.isArray(list) ? list : [];
    syncUserBundleToMemoryMirrors(cleanId, bundle);
    // Für bot_vip oder explizites skipKvWrite (z.B. JSON-Import in D1) niemals KV-Writes auslösen!
    if (cleanId === "bot_vip" || options.skipKvWrite) {
      return;
    }
    await stageUserBundleWrite(env, cleanId, bundle, options);
  }

  async function getFolders(env, chatId, options = {}) {
    const cleanId = String(chatId || "").trim();
    const now = Date.now();
    const lastFoldersTs = Number(memoryFallback.get(`folders_hydrated_ts_${cleanId}`) || 0);
    if (!options?.forceRefresh && memoryFallback.has(`folders_${cleanId}`) && (now - lastFoldersTs) < 60000) {
      const cachedFolders = memoryFallback.get(`folders_${cleanId}`);
      if (Array.isArray(cachedFolders) && cachedFolders.length > 0) return cachedFolders;
    }
    const bundle = await getUserBundle(env, cleanId);
    const kvFolders = Array.isArray(bundle.folders) ? bundle.folders : [];
    let d1Folders = [];
    try {
      d1Folders = await getPlaylistFoldersFromD1(env, cleanId);
    } catch (e) {}
    if (Array.isArray(d1Folders) && d1Folders.length > 0) {
      const byId = new Map();
      for (const f of kvFolders) {
        if (f && f.id) byId.set(String(f.id), f);
      }
      for (const df of d1Folders) {
        if (df && df.id) byId.set(String(df.id), { ...(byId.get(String(df.id)) || {}), ...df });
      }
      bundle.folders = Array.from(byId.values());
      memoryFallback.set(`folders_${cleanId}`, bundle.folders);
      memoryFallback.set(`folders_hydrated_ts_${cleanId}`, now);
    }
    return Array.isArray(bundle.folders) ? bundle.folders : [];
  }

  async function saveFolders(env, chatId, folders, options = {}) {
    const cleanId = String(chatId || "").trim();
    const bundle = await getUserBundle(env, cleanId);
    bundle.folders = Array.isArray(folders) ? folders : [];
    syncUserBundleToMemoryMirrors(cleanId, bundle);
    for (const f of bundle.folders) {
      if (f && f.id && (f.isJsonPlaylist || f.type === "playlist" || cleanId === "bot_vip")) {
        const fSigKey = `d1_folder_sig_${cleanId}_${f.id}`;
        const nextFSig = JSON.stringify({ name: f.name, enabled: f.enabled !== false, playlistMode: f.playlistMode || "both", sourceLabel: f.sourceLabel || "" });
        if (memoryFallback.get(fSigKey) !== nextFSig) {
          memoryFallback.set(fSigKey, nextFSig);
          try { await upsertPlaylistFolderInD1(env, cleanId, f); } catch (e) {}
        }
      }
    }
    if (cleanId === "bot_vip" || options.skipKvWrite) {
      return;
    }
    await stageUserBundleWrite(env, cleanId, bundle, options);
  }

  // Löscht automatisch alle Ordner, die leer sind (0 gespeicherte Filme/Serien),
  // behält aber explizit angelegte Custom-Playlisten / JSON-Import-Playlisten bei.
  async function cleanupEmptyFolders(env, chatId) {
    const list = await getSavedList(env, chatId);
    const folders = await getFolders(env, chatId);
    if (!folders.length) return [];

    const nonEmptyFolders = folders.filter(f =>
      f.type === "playlist" ||
      f.isJsonPlaylist === true ||
      f.keepWhenEmpty === true ||
      list.some(item => item.folderId === f.id)
    );
    if (nonEmptyFolders.length !== folders.length) {
      await saveFolders(env, chatId, nonEmptyFolders);
    }
    return nonEmptyFolders;
  }

  async function findOrCreateSpecialFolder(env, chatId, type, tmdbRefId, displayName, originalName = null) {
    const folders = await getFolders(env, chatId);
    const existing = folders.find(
      f => f.linked !== false && String(f.tmdbRefId) === String(tmdbRefId) && f.type === type && f.name === displayName
    );
    if (existing) return existing;

    const newFolder = {
      id: `f_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`,
      name: String(displayName || "Ordner").slice(0, 48),
      type, // 'collection' | 'person' | 'custom' | 'playlist'
      tmdbRefId: tmdbRefId ? String(tmdbRefId) : null,
      originalName: originalName || displayName || "Ordner",
      linked: !!tmdbRefId,
      enabled: true,
      createdAt: Date.now()
    };
    folders.push(newFolder);
    await saveFolders(env, chatId, folders);
    return newFolder;
  }

  async function saveCollectionOrUniverseToFolders(env, chatId, displayName, visibleItems, folderType = "collection", refId = null) {
    const cleanName = String(displayName || (folderType === "universe" ? "Filmuniversum" : "Filmreihe")).trim();
    const folder = await findOrCreateSpecialFolder(env, chatId, folderType, refId, cleanName, cleanName);
    const list = await getSavedList(env, chatId);
    let addedCount = 0;
    for (const part of (visibleItems || [])) {
      if (!part || !part.id) continue;
      const isSeries = part.media_type === "tv" || part.typeCode === "s";
      const contentType = isSeries ? "series" : "movie";
      const typePrefix = isSeries ? "s" : "m";
      const yr = String(part.release_date || part.first_air_date || part.year || "").split("-")[0] || "K. A.";
      const existsIdx = list.findIndex(
        i => String(i.tmdbId) === String(part.id) && i.contentType === contentType && String(i.folderId) === String(folder.id)
      );
      if (existsIdx === -1) {
        list.push({
          uid: `${typePrefix}_${part.id}_${folder.id}`,
          tmdbId: part.id,
          contentType,
          title: part.title || part.name || "Unbekannt",
          year: yr,
          fsk: part.fsk || "FSK Keine Angabe",
          genres: folderType === "universe" ? cleanName : "Filmreihe",
          poster_path: part.poster_path || null,
          folderId: folder.id,
          addedAt: Date.now()
        });
        addedCount++;
      }
    }
    if (addedCount > 0) {
      await saveRawList(env, chatId, list);
    }
    return { folder, addedCount, totalInFolder: list.filter(i => String(i.folderId) === String(folder.id)).length };
  }

  async function createCustomFolder(env, chatId, folderName, extraProps = {}) {
    const cleanId = String(chatId || "").trim();
    const folders = await getFolders(env, cleanId);
    const cleanName = String(folderName || "Neue Playlist").trim().slice(0, 48);
    const existing = folders.find(f => f.name.toLowerCase() === cleanName.toLowerCase());
    if (existing) {
      if (extraProps.isJsonPlaylist) {
        let changed = false;
        if (!existing.isJsonPlaylist) { existing.isJsonPlaylist = true; changed = true; }
        if (existing.type !== "playlist") { existing.type = "playlist"; changed = true; }
        if (extraProps.sourceLabel && existing.sourceLabel !== extraProps.sourceLabel) { existing.sourceLabel = extraProps.sourceLabel; changed = true; }
        if (extraProps.playlistMode && existing.playlistMode !== extraProps.playlistMode) { existing.playlistMode = extraProps.playlistMode; changed = true; }
        if (existing.enabled === undefined) { existing.enabled = true; changed = true; }
        if (changed) {
          await upsertPlaylistFolderInD1(env, cleanId, existing);
          await saveFolders(env, cleanId, folders, {
            deferKvWrite: Boolean(extraProps.deferKvWrite),
            skipKvWrite: Boolean(extraProps.isJsonPlaylist || cleanId === "bot_vip")
          });
        }
      }
      return existing;
    }

    const newFolder = {
      id: `f_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`,
      name: cleanName,
      type: extraProps.isJsonPlaylist ? "playlist" : (extraProps.type || "custom"),
      isJsonPlaylist: Boolean(extraProps.isJsonPlaylist),
      playlistMode: extraProps.playlistMode || (extraProps.isJsonPlaylist ? "both" : "watchlist"),
      sourceLabel: extraProps.sourceLabel || null,
      enabled: extraProps.enabled !== false,
      keepWhenEmpty: true,
      tmdbRefId: null,
      originalName: cleanName,
      linked: false,
      createdAt: Date.now()
    };
    folders.push(newFolder);
    await upsertPlaylistFolderInD1(env, cleanId, newFolder);
    await saveFolders(env, cleanId, folders, {
      deferKvWrite: Boolean(extraProps.deferKvWrite),
      skipKvWrite: Boolean(extraProps.isJsonPlaylist || cleanId === "bot_vip")
    });
    return newFolder;
  }

  async function createOrGetJsonPlaylistFolder(env, chatId, customPlaylistName, sourceLabel = "", playlistMode = "both") {
    const fallbackName = String(sourceLabel || "JSON-Import Playlist")
      .replace(/\.json$/i, "")
      .replace(/^Telegram Chat-Backup:\s*/i, "📦 ")
      .trim()
      .slice(0, 45) || "🎵 JSON-Playlist";
    const finalName = String(customPlaylistName || fallbackName).trim().slice(0, 48);
    const validMode = ["vip_stream", "watchlist", "both"].includes(playlistMode) ? playlistMode : "both";
    return await createCustomFolder(env, chatId, finalName, {
      type: "playlist",
      isJsonPlaylist: true,
      playlistMode: validMode,
      enabled: true,
      sourceLabel: sourceLabel || finalName
    });
  }

  async function getBotVipHiddenKeys(env) {
    const key = "bot_vip_hidden_keys";
    const isBrowserSandbox = typeof localStorage !== "undefined" && typeof window !== "undefined";
    const hiddenTs = Number(memoryFallback.get(`${key}_ts`) || 0);
    if (memoryFallback.has(key) && (isBrowserSandbox || (Date.now() - hiddenTs) < 60000)) {
      const mem = memoryFallback.get(key);
      if (Array.isArray(mem)) return new Set(mem);
    }
    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    if (hasD1 && typeof getEntityFromD1 === "function") {
      try {
        const fromD1 = await getEntityFromD1(env, key, 3650 * 86400000, { ramTtlMs: 60000 });
        if (Array.isArray(fromD1)) {
          memoryFallback.set(key, fromD1);
          memoryFallback.set(`${key}_ts`, Date.now());
          return new Set(fromD1);
        }
      } catch (e) {}
    }
    try {
      const raw = await kvCachedGetRaw(env, key, "MOVIE_SAVED", { ttlMs: 60000 });
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          memoryFallback.set(key, parsed);
          memoryFallback.set(`${key}_ts`, Date.now());
          return new Set(parsed);
        }
      }
    } catch (e) {}
    memoryFallback.set(key, []);
    memoryFallback.set(`${key}_ts`, Date.now());
    return new Set();
  }

  async function saveBotVipHiddenKeys(env, keySet) {
    const key = "bot_vip_hidden_keys";
    const arr = Array.from(keySet || []);
    memoryFallback.set(key, arr);
    memoryFallback.set(`${key}_ts`, Date.now());
    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    if (hasD1 && typeof saveEntityToD1 === "function") {
      await saveEntityToD1(env, key, "config", arr);
      return;
    }
    await kvStageWrite(env, key, arr, { bindingName: "MOVIE_SAVED" });
  }

  function resolvePosterUrl(posterPathOrUrl, size = "w185", fallbackUrl = "") {
    const rawPrimary = String(posterPathOrUrl || "").trim();
    if (rawPrimary && rawPrimary !== "null" && rawPrimary !== "undefined" && rawPrimary !== "N/A") {
      if (rawPrimary.startsWith("http://") || rawPrimary.startsWith("https://") || rawPrimary.startsWith("data:")) {
        return rawPrimary;
      }
      if (rawPrimary.startsWith("/")) {
        return `https://image.tmdb.org/t/p/${size}${rawPrimary}`;
      }
      return `https://image.tmdb.org/t/p/${size}/${rawPrimary}`;
    }
    const rawFb = String(fallbackUrl || "").trim();
    if (rawFb && rawFb !== "null" && rawFb !== "undefined" && rawFb !== "N/A") {
      if (rawFb.startsWith("http://") || rawFb.startsWith("https://") || rawFb.startsWith("data:")) {
        return rawFb;
      }
      if (rawFb.startsWith("/")) {
        return `https://image.tmdb.org/t/p/${size}${rawFb}`;
      }
    }
    return "";
  }

  function mergeAndSortEpisodeEntries(existingEpisodes = [], incomingEpisodes = []) {
    const map = new Map();
    const all = [...(Array.isArray(existingEpisodes) ? existingEpisodes : []), ...(Array.isArray(incomingEpisodes) ? incomingEpisodes : [])];
    for (const ep of all) {
      if (!ep) continue;
      const sNum = Math.max(0, Number(ep.season ?? ep.season_number ?? 1));
      const eNum = Math.max(0, Number(ep.episode ?? ep.episode_number ?? 1));
      const key = `${sNum}_${eNum}`;
      const code = `S${String(sNum).padStart(2, "0")}E${String(eNum).padStart(2, "0")}`;
      const rawTitle = String(ep.title || ep.episode_title || ep.name || "").trim();
      const prev = map.get(key);
      const bestTitle = (rawTitle && !/^Folge\s+\d+$/i.test(rawTitle))
        ? rawTitle
        : (prev?.title || rawTitle || `Folge ${eNum}`);
      map.set(key, {
        season: sNum,
        episode: eNum,
        code,
        title: bestTitle,
        quality: String(ep.quality || prev?.quality || "1080p"),
        codec: String(ep.codec || prev?.codec || "x264"),
        fileId: ep.fileId || ep.telegram_file_id || prev?.fileId || null,
        fileSize: ep.fileSize || ep.file_size || prev?.fileSize || null,
        tags: ep.tags || prev?.tags || ""
      });
    }
    return Array.from(map.values()).sort((a, b) => (a.season !== b.season ? a.season - b.season : a.episode - b.episode));
  }

  async function getAllSeriesEpisodesMapFromD1(env, targetSeriesIds = null) {
    const epMap = new Map();
    const hasFilter = Array.isArray(targetSeriesIds);
    const cleanTargetIds = hasFilter
      ? Array.from(new Set(targetSeriesIds.map(x => Number(x)).filter(n => Number.isFinite(n) && n > 0)))
      : null;
    if (hasFilter && cleanTargetIds.length === 0) {
      return epMap;
    }
    const targetIdSet = cleanTargetIds ? new Set(cleanTargetIds) : null;
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        if (cleanTargetIds) {
          // Free-Plan Schutz: Gezielter IN-Lookup NUR für die tatsächlich benötigten Serien-IDs (kein Full-Table-Scan!)
          for (let i = 0; i < cleanTargetIds.length; i += 45) {
            const chunk = cleanTargetIds.slice(i, i + 45);
            const ph = chunk.map((_, idx) => `?${idx + 1}`).join(",");
            const res = await db.prepare(
              `SELECT ef.series_id, ef.season_number, ef.episode_number, ef.quality, ef.codec, ef.telegram_file_id, ef.file_size, ef.tags,
                      se.title AS episode_title
               FROM episode_files ef
               LEFT JOIN series_episodes se
                 ON se.series_id = ef.series_id AND se.season_number = ef.season_number AND se.episode_number = ef.episode_number
               WHERE ef.series_id IN (${ph})
                 AND ef.telegram_file_id IS NOT NULL AND ef.telegram_file_id != ''
                 AND ef.telegram_file_id NOT LIKE 'vip_playlist_%' AND ef.telegram_file_id NOT LIKE 'tmdb_card_%'
               ORDER BY ef.series_id ASC, ef.season_number ASC, ef.episode_number ASC, ef.updated_at DESC
               LIMIT 4000`
            ).bind(...chunk).all().catch(() => ({ results: [] }));
            for (const r of (res?.results || [])) {
              const sid = Number(r.series_id);
              if (!sid || scoreTelegramFileIdValidity(r.telegram_file_id) === 0) continue;
              const prevList = epMap.get(sid) || [];
              prevList.push({
                season: Number(r.season_number ?? 1),
                episode: Number(r.episode_number ?? 1),
                title: r.episode_title || `Folge ${Number(r.episode_number ?? 1)}`,
                quality: r.quality || "1080p",
                codec: r.codec || "x264",
                fileId: r.telegram_file_id || null,
                fileSize: r.file_size || null,
                tags: r.tags || ""
              });
              epMap.set(sid, prevList);
            }
          }
        } else {
          const res = await db.prepare(
            `SELECT ef.series_id, ef.season_number, ef.episode_number, ef.quality, ef.codec, ef.telegram_file_id, ef.file_size, ef.tags,
                    se.title AS episode_title
             FROM episode_files ef
             LEFT JOIN series_episodes se
               ON se.series_id = ef.series_id AND se.season_number = ef.season_number AND se.episode_number = ef.episode_number
             WHERE ef.telegram_file_id IS NOT NULL AND ef.telegram_file_id != ''
               AND ef.telegram_file_id NOT LIKE 'vip_playlist_%' AND ef.telegram_file_id NOT LIKE 'tmdb_card_%'
             ORDER BY ef.series_id ASC, ef.season_number ASC, ef.episode_number ASC, ef.updated_at DESC
             LIMIT 4000`
          ).all().catch(() => ({ results: [] }));
          for (const r of (res?.results || [])) {
            const sid = Number(r.series_id);
            if (!sid || scoreTelegramFileIdValidity(r.telegram_file_id) === 0) continue;
            const prevList = epMap.get(sid) || [];
            prevList.push({
              season: Number(r.season_number ?? 1),
              episode: Number(r.episode_number ?? 1),
              title: r.episode_title || `Folge ${Number(r.episode_number ?? 1)}`,
              quality: r.quality || "1080p",
              codec: r.codec || "x264",
              fileId: r.telegram_file_id || null,
              fileSize: r.file_size || null,
              tags: r.tags || ""
            });
            epMap.set(sid, prevList);
          }
        }
      } catch (e) {}
    }

    for (const [k, v] of memoryFallback.entries()) {
      if (k.startsWith("d1_ep_files_") && Array.isArray(v)) {
        for (const r of v) {
          const sid = Number(r?.series_id);
          if (!sid || (targetIdSet && !targetIdSet.has(sid)) || scoreTelegramFileIdValidity(r?.telegram_file_id) === 0) continue;
          const prevList = epMap.get(sid) || [];
          prevList.push({
            season: Number(r.season_number ?? 1),
            episode: Number(r.episode_number ?? 1),
            title: r.episode_title || r.title || `Folge ${Number(r.episode_number ?? 1)}`,
            quality: r.quality || "1080p",
            codec: r.codec || "x264",
            fileId: r.telegram_file_id || null,
            fileSize: r.file_size || null,
            tags: r.tags || ""
          });
          epMap.set(sid, prevList);
        }
      }
    }

    for (const [sid, rawList] of epMap.entries()) {
      epMap.set(sid, mergeAndSortEpisodeEntries([], rawList));
    }
    return epMap;
  }

  async function backfillMediaPosterInLists(env, typeCode, tmdbId, posterPathOrUrl, fallbackUrl = "", targetChatId = null, forceOverwrite = false) {
    const cleanPoster = resolvePosterUrl(posterPathOrUrl, "w185", fallbackUrl);
    const tid = Number(tmdbId);
    if (!cleanPoster || !tid) return false;
    const isSer = typeCode === "s";
    let anyUpdated = false;

    const chatTargets = new Set(["bot_vip"]);
    if (targetChatId && targetChatId !== "guest") chatTargets.add(String(targetChatId));

    for (const cid of chatTargets) {
      try {
        const list = await getSavedList(env, cid);
        if (!Array.isArray(list) || list.length === 0) continue;
        let listChanged = false;
        for (const item of list) {
          if (!item) continue;
          const itemMatches = (Number(item.tmdbId) === tid && ((isSer && item.contentType === "series") || (!isSer && item.contentType === "movie"))) ||
                              (isSer && item.contentType === "episode" && Number(item.seriesId) === tid);
          const shouldReplace = forceOverwrite
            ? (item.poster !== cleanPoster)
            : (!item.poster || String(item.poster).includes("placeholder"));
          if (itemMatches && shouldReplace) {
            item.poster = cleanPoster;
            listChanged = true;
            anyUpdated = true;
          }
        }
        if (listChanged) {
          await saveRawList(env, cid, list);
        }
      } catch (e) {}
    }
    return anyUpdated;
  }

  async function enrichSavedListWithD1EpisodesAndPosters(env, chatId, rawItems = null) {
    let list = Array.isArray(rawItems) ? rawItems : await getSavedList(env, chatId);
    if (!Array.isArray(list) || list.length === 0) return [];
    let changed = false;
    const now = Date.now();

    // Gezielter Serien-Episoden-Lookup: Nur die Serien-IDs aus der aktuellen Liste nachladen (0 D1-Reads wenn keine Serien in der Liste!)
    let epMap = memoryFallback.get("d1_all_series_ep_map_cache");
    const epMapTs = Number(memoryFallback.get("d1_all_series_ep_map_cache_ts") || 0);
    if (!(epMap instanceof Map) || (now - epMapTs) > 120000) {
      epMap = new Map();
      memoryFallback.set("d1_all_series_ep_map_cache", epMap);
      memoryFallback.set("d1_all_series_ep_map_cache_ts", now);
    }
    const neededSeriesIds = [];
    for (const item of list) {
      if (!item) continue;
      if (item.contentType === "series" || item.contentType === "episode") {
        const sid = Number(item.contentType === "episode" ? item.seriesId : item.tmdbId);
        if (sid > 0 && !epMap.has(sid)) {
          neededSeriesIds.push(sid);
        }
      }
    }
    if (neededSeriesIds.length > 0) {
      const fetchedEpMap = await getAllSeriesEpisodesMapFromD1(env, neededSeriesIds);
      for (const sid of neededSeriesIds) {
        epMap.set(sid, fetchedEpMap.get(sid) || []);
      }
    }

    // Gezielter D1-Lookup NUR für die tatsächlich in der Liste vorhandenen IDs (keine LIMIT 1500 Full-Table-Scans!)
    let posterLookup = memoryFallback.get("d1_poster_lookup_cache");
    let validMovieIdsSet = memoryFallback.get("d1_valid_movie_ids_set_cache");
    const posterLookupTs = Number(memoryFallback.get("d1_poster_lookup_cache_ts") || 0);
    if (!(posterLookup instanceof Map) || (now - posterLookupTs) > 300000) {
      posterLookup = new Map();
      memoryFallback.set("d1_poster_lookup_cache", posterLookup);
      memoryFallback.set("d1_poster_lookup_cache_ts", now);
    }
    if (!(validMovieIdsSet instanceof Set) || (now - posterLookupTs) > 300000) {
      validMovieIdsSet = new Set();
      memoryFallback.set("d1_valid_movie_ids_set_cache", validMovieIdsSet);
    }

    const missingMovieIds = [];
    const missingSeriesIds = [];
    const needVipCheckMovieIds = [];
    for (const item of list) {
      if (!item) continue;
      const isSer = item.contentType === "series" || item.contentType === "episode";
      const tid = Number(item.contentType === "episode" ? item.seriesId : item.tmdbId);
      if (!tid) continue;
      if (isSer) {
        if (!posterLookup.has(`s_${tid}`)) missingSeriesIds.push(tid);
      } else {
        if (!posterLookup.has(`m_${tid}`)) missingMovieIds.push(tid);
        if (!validMovieIdsSet.has(tid) && !memoryFallback.has(`d1_movie_vip_checked_${tid}`)) {
          needVipCheckMovieIds.push(tid);
        }
      }
    }

    const uniqMissingM = [...new Set(missingMovieIds)].slice(0, 80);
    const uniqMissingS = [...new Set(missingSeriesIds)].slice(0, 80);
    const uniqVipCheckM = [...new Set(needVipCheckMovieIds)].slice(0, 80);

    if (uniqMissingM.length > 0 || uniqMissingS.length > 0 || uniqVipCheckM.length > 0) {
      const db = await ensureD1Schema(env);
      const rawDb = getRawD1Binding(env);
      if (db && rawDb) {
        try {
          const stmts = [];
          const keys = [];
          if (uniqMissingM.length > 0) {
            stmts.push(rawDb.prepare(`SELECT tmdb_id, poster_path, vote_average, release_year, fsk FROM movies WHERE tmdb_id IN (${uniqMissingM.map((_, i) => `?${i + 1}`).join(",")})`).bind(...uniqMissingM));
            keys.push("m");
          }
          if (uniqMissingS.length > 0) {
            stmts.push(rawDb.prepare(`SELECT tmdb_id, poster_path, vote_average, release_year, fsk FROM series WHERE tmdb_id IN (${uniqMissingS.map((_, i) => `?${i + 1}`).join(",")})`).bind(...uniqMissingS));
            keys.push("s");
          }
          if (uniqVipCheckM.length > 0) {
            stmts.push(rawDb.prepare(`SELECT DISTINCT movie_id FROM movie_files WHERE movie_id IN (${uniqVipCheckM.map((_, i) => `?${i + 1}`).join(",")}) AND telegram_file_id IS NOT NULL AND telegram_file_id != '' AND telegram_file_id NOT LIKE 'vip_playlist_%' AND telegram_file_id NOT LIKE 'tmdb_card_%'`).bind(...uniqVipCheckM));
            keys.push("mf");
          }
          if (stmts.length > 0) {
            trackStat("d1Reads");
            if (typeof countD1Subrequest === "function") countD1Subrequest();
            const batchResults = await rawDb.batch(stmts);
            for (let bIdx = 0; bIdx < keys.length; bIdx++) {
              const kind = keys[bIdx];
              const rows = batchResults?.[bIdx]?.results || [];
              if (kind === "m") {
                const foundM = new Set();
                for (const r of rows) {
                  const mid = Number(r.tmdb_id);
                  foundM.add(mid);
                  const p = r.poster_path ? resolvePosterUrl(r.poster_path, "w185", "") : "";
                  posterLookup.set(`m_${mid}`, {
                    poster: p,
                    vote_average: Number(r.vote_average || 0),
                    release_year: r.release_year ? String(r.release_year) : "",
                    fsk: r.fsk || ""
                  });
                }
                for (const mid of uniqMissingM) {
                  if (!foundM.has(mid)) posterLookup.set(`m_${mid}`, { poster: "", vote_average: 0, release_year: "", fsk: "" });
                }
              } else if (kind === "s") {
                const foundS = new Set();
                for (const r of rows) {
                  const sid = Number(r.tmdb_id);
                  foundS.add(sid);
                  const p = r.poster_path ? resolvePosterUrl(r.poster_path, "w185", "") : "";
                  posterLookup.set(`s_${sid}`, {
                    poster: p,
                    vote_average: Number(r.vote_average || 0),
                    release_year: r.release_year ? String(r.release_year) : "",
                    fsk: r.fsk || ""
                  });
                }
                for (const sid of uniqMissingS) {
                  if (!foundS.has(sid)) posterLookup.set(`s_${sid}`, { poster: "", vote_average: 0, release_year: "", fsk: "" });
                }
              } else if (kind === "mf") {
                for (const mf of rows) {
                  if (mf && mf.movie_id) validMovieIdsSet.add(Number(mf.movie_id));
                }
                for (const mid of uniqVipCheckM) {
                  memoryFallback.set(`d1_movie_vip_checked_${mid}`, now);
                }
              }
            }
          }
        } catch (e) {}
      }
      for (const [k, v] of memoryFallback.entries()) {
        if (k.startsWith("d1_movie_files_") && Array.isArray(v)) {
          const mid = Number(k.replace("d1_movie_files_", ""));
          if (mid && v.some(x => x && scoreTelegramFileIdValidity(x.telegram_file_id || x.fileId || x.file_id) > 0)) {
            validMovieIdsSet.add(mid);
          }
        }
      }
    }

      for (const item of list) {
        if (!item) continue;
        const isSer = item.contentType === "series" || item.contentType === "episode";
        const tid = Number(item.contentType === "episode" ? item.seriesId : item.tmdbId);
        if (!tid) continue;
        const mapKey = `${isSer ? "s" : "m"}_${tid}`;

        const d1Meta = posterLookup.get(mapKey);
        const d1Poster = typeof d1Meta === "string" ? d1Meta : (d1Meta?.poster || "");
        const memObj = getCachedTmdb(isSer ? `tv_${tid}` : `movie_${tid}`) ||
                       memoryFallback.get(isSer ? `d1_catalog_series_${tid}` : `d1_catalog_movie_${tid}`);

        if (!item.poster) {
          const foundPoster = d1Poster ||
                              (memObj ? resolvePosterUrl(memObj.poster_path, "w185", memObj.external_poster_url || memObj.poster || "") : "");
          if (foundPoster) {
            item.poster = foundPoster;
            changed = true;
          }
        } else if (String(item.poster).startsWith("/")) {
          item.poster = resolvePosterUrl(item.poster, "w185");
          changed = true;
        }

        if (!item.rating && !item.vote_average) {
          const foundRating = Number((typeof d1Meta === "object" && d1Meta?.vote_average) || memObj?.vote_average || memObj?.rating || 0);
          if (foundRating > 0) {
            item.rating = foundRating;
            item.vote_average = foundRating;
          }
        }
        if ((!item.year || item.year === "K. A.") && ((typeof d1Meta === "object" && d1Meta?.release_year) || memObj?.release_date || memObj?.first_air_date)) {
          const foundYear = (typeof d1Meta === "object" && d1Meta?.release_year) || String(memObj?.release_date || memObj?.first_air_date || "").slice(0, 4);
          if (foundYear) item.year = String(foundYear);
        }
        if ((!item.fsk || item.fsk === "K. A.") && ((typeof d1Meta === "object" && d1Meta?.fsk) || memObj?.fsk)) {
          item.fsk = (typeof d1Meta === "object" && d1Meta?.fsk) || memObj?.fsk;
        }

        if (item.contentType === "series") {
          const d1Eps = epMap.get(tid) || [];
          if (d1Eps.length > 0 || Array.isArray(item.episodes)) {
            const mergedEps = mergeAndSortEpisodeEntries(item.episodes || [], d1Eps);
            if (mergedEps.length !== (item.episodes?.length || 0)) {
              item.episodes = mergedEps;
              item.streamCount = Math.max(Number(item.streamCount || 0), mergedEps.length);
              changed = true;
            } else {
              item.episodes = mergedEps;
            }
          }
        }
      }

      const isVipPlaylistTarget = String(chatId) === "bot_vip";
      const validFilteredList = list.filter(item => {
        if (!item) return false;
        const isVipItem = isVipPlaylistTarget || item.playlistMode === "vip_stream" || item.syncedFromD1;
        if (item.contentType === "series") {
          const validEps = (item.episodes || []).filter(ep =>
            Boolean(ep && (scoreTelegramFileIdValidity(ep.fileId || ep.file_id || ep.telegram_file_id || "") > 0 || ep.versions?.length))
          );
          return validEps.length > 0;
        }
        if (isVipItem && item.contentType === "movie") {
          const tid = Number(item.tmdbId || 0);
          const hasDirectFile = scoreTelegramFileIdValidity(item.fileId || item.telegram_file_id || "") > 0;
          const hasMemFile = Array.isArray(memoryFallback.get(`d1_movie_files_${tid}`)) &&
            memoryFallback.get(`d1_movie_files_${tid}`).some(f => f && scoreTelegramFileIdValidity(f.telegram_file_id || f.fileId || f.file_id) > 0);
          return Boolean(hasDirectFile || hasMemFile || (tid > 0 && validMovieIdsSet.has(tid)));
        }
        return true;
      });

      // Nur im RAM-Cache aktualisieren (kein teures JSON.stringify + KV-Write während Lese-Abfragen!)
      if (changed && chatId && chatId !== "guest") {
        memoryFallback.set(`user_${String(chatId).trim()}`, validFilteredList);
      }
      return validFilteredList;
    }

  async function syncD1CatalogIntoBotVipPlaylist(env, targetFolderId = null, options = {}) {
    const forceIncludeHidden = Boolean(options?.forceIncludeHidden);
    let folders = await getFolders(env, "bot_vip");
    let mainFolder = targetFolderId
      ? folders.find(f => String(f.id) === String(targetFolderId))
      : (folders.find(f => f.type === "playlist" || f.isJsonPlaylist) || folders[0] || null);
    if (!mainFolder) {
      mainFolder = await createOrGetJsonPlaylistFolder(
        env,
        "bot_vip",
        "🌟 Bot-VIP-Hauptplaylist",
        "Globaler VIP-Stream-Katalog (D1 + Telegram Bot)",
        "vip_stream"
      );
      folders = await getFolders(env, "bot_vip");
    }

    let hiddenSet = await getBotVipHiddenKeys(env);
    if (forceIncludeHidden && hiddenSet.size > 0) {
      hiddenSet = new Set();
      await saveBotVipHiddenKeys(env, hiddenSet);
    }

    const d1CatalogMap = new Map();
    const seriesEpisodesMap = await getAllSeriesEpisodesMapFromD1(env);
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        const [mRows, sRows] = await Promise.all([
          db.prepare(
            `SELECT m.tmdb_id, m.title, m.release_year, m.fsk, m.genres, m.poster_path, m.details_json, m.updated_at,
                    COUNT(mf.id) AS stream_count,
                    GROUP_CONCAT(DISTINCT mf.quality) AS qualities
             FROM movies m
             INNER JOIN movie_files mf ON mf.movie_id = m.tmdb_id
             WHERE mf.telegram_file_id IS NOT NULL AND mf.telegram_file_id != ''
               AND mf.telegram_file_id NOT LIKE 'vip_playlist_%' AND mf.telegram_file_id NOT LIKE 'tmdb_card_%'
             GROUP BY m.tmdb_id
             HAVING COUNT(mf.id) > 0
             ORDER BY COUNT(mf.id) DESC, m.updated_at DESC
             LIMIT 500`
          ).all().catch(() => ({ results: [] })),
          db.prepare(
            `SELECT s.tmdb_id, s.title, s.release_year, s.fsk, s.genres, s.poster_path, s.details_json, s.updated_at,
                    COUNT(ef.id) AS stream_count,
                    GROUP_CONCAT(DISTINCT ef.quality) AS qualities
             FROM series s
             INNER JOIN episode_files ef ON ef.series_id = s.tmdb_id
             WHERE ef.telegram_file_id IS NOT NULL AND ef.telegram_file_id != ''
               AND ef.telegram_file_id NOT LIKE 'vip_playlist_%' AND ef.telegram_file_id NOT LIKE 'tmdb_card_%'
             GROUP BY s.tmdb_id
             HAVING COUNT(ef.id) > 0
             ORDER BY COUNT(ef.id) DESC, s.updated_at DESC
             LIMIT 500`
          ).all().catch(() => ({ results: [] }))
        ]);

        for (const r of (mRows?.results || [])) {
          const tid = Number(r.tmdb_id);
          if (!tid || Number(r.stream_count || 0) <= 0) continue;
          let extPoster = "";
          if (!r.poster_path && r.details_json) {
            try { extPoster = JSON.parse(r.details_json)?.external_poster_url || ""; } catch (e) {}
          }
          const poster = resolvePosterUrl(r.poster_path, "w185", extPoster);
          const allQualities = String(r.qualities || "").split(",").map(s => s.trim()).filter(Boolean).join(", ");
          d1CatalogMap.set(`m_${tid}`, {
            tmdbId: tid,
            contentType: "movie",
            prefix: "m",
            title: String(r.title || `Film #${tid}`).replace(/\s*\(\d{4}\)$/, ""),
            year: String(r.release_year || "K. A."),
            fsk: String(r.fsk || "K. A."),
            genres: String(r.genres || "Film"),
            poster,
            quality: allQualities ? allQualities.split(",")[0].trim() : "1080p",
            allQualities: allQualities || "1080p",
            streamCount: Number(r.stream_count || 0),
            updatedAt: Number(r.updated_at || Date.now())
          });
        }

        for (const r of (sRows?.results || [])) {
          const tid = Number(r.tmdb_id);
          const epList = seriesEpisodesMap.get(tid) || [];
          if (!tid || (Number(r.stream_count || 0) <= 0 && epList.length === 0)) continue;
          let extPoster = "";
          if (!r.poster_path && r.details_json) {
            try { extPoster = JSON.parse(r.details_json)?.external_poster_url || ""; } catch (e) {}
          }
          const poster = resolvePosterUrl(r.poster_path, "w185", extPoster);
          const allQualities = String(r.qualities || "").split(",").map(s => s.trim()).filter(Boolean).join(", ");
          d1CatalogMap.set(`s_${tid}`, {
            tmdbId: tid,
            contentType: "series",
            prefix: "s",
            title: String(r.title || `Serie #${tid}`).replace(/\s*\(\d{4}\)$/, ""),
            year: String(r.release_year || "K. A."),
            fsk: String(r.fsk || "K. A."),
            genres: String(r.genres || "Serie"),
            poster,
            quality: allQualities ? allQualities.split(",")[0].trim() : "1080p",
            allQualities: allQualities || "1080p",
            streamCount: Math.max(Number(r.stream_count || 0), epList.length),
            episodes: epList,
            updatedAt: Number(r.updated_at || Date.now())
          });
        }
      } catch (e) {}
    }

    // Zusätzlich Memory-Fallback für lokal gecachte D1-Bot-Filme & -Serien berücksichtigen (NUR wenn echte Datei-Streams existieren!)
    for (const [k, v] of memoryFallback.entries()) {
      if ((k.startsWith("d1_catalog_movie_") || k.startsWith("d1_catalog_series_")) && v && v.id) {
        const isSer = k.startsWith("d1_catalog_series_");
        const tid = Number(v.id);
        const mapKey = `${isSer ? "s" : "m"}_${tid}`;
        if (!d1CatalogMap.has(mapKey)) {
          const mFiles = isSer ? [] : (memoryFallback.get(`d1_movie_files_${tid}`) || []);
          const epList = isSer ? (seriesEpisodesMap.get(tid) || []) : [];
          if (isSer && epList.length === 0) continue;
          if (!isSer && mFiles.length === 0) continue;
          const poster = resolvePosterUrl(v.poster_path, "w185", v.external_poster_url || v.poster || "");
          d1CatalogMap.set(mapKey, {
            tmdbId: tid,
            contentType: isSer ? "series" : "movie",
            prefix: isSer ? "s" : "m",
            title: String(v.title || v.name || `Titel #${tid}`).replace(/\s*\(\d{4}\)$/, ""),
            year: String(v.releaseDate || "").split("-")[0] || "K. A.",
            fsk: String(v.fsk || "K. A."),
            genres: String(v.genres || (isSer ? "Serie" : "Film")),
            poster,
            quality: isSer ? (epList[0]?.quality || "1080p") : (mFiles[0]?.quality || "1080p"),
            allQualities: isSer
              ? (epList.length > 0 ? Array.from(new Set(epList.map(e => e.quality || "1080p"))).join(", ") : "1080p")
              : (mFiles.length > 0 ? Array.from(new Set(mFiles.map(f => f.quality || "1080p"))).join(", ") : "1080p"),
            streamCount: isSer ? epList.length : mFiles.length,
            episodes: isSer ? epList : undefined,
            updatedAt: Date.now()
          });
        }
      }
    }

    let list = await getSavedList(env, "bot_vip");
    let changed = false;
    let syncedAddedCount = 0;

    // Entferne Geister-Serien/Filme ohne geloggte Dateien aus der bot_vip Playlist
    const filteredExistingList = list.filter(item => {
      if (!item || !item.tmdbId) return false;
      const prefix = item.contentType === "series" ? "s" : "m";
      const mapKey = `${prefix}_${item.tmdbId}`;
      if (d1CatalogMap.has(mapKey)) return true;
      if (item.contentType === "series") {
        return Array.isArray(item.episodes) && item.episodes.some(ep => ep && (ep.fileId || ep.telegram_file_id));
      }
      return Boolean(item.fileId || item.telegram_file_id);
    });
    if (filteredExistingList.length !== list.length) {
      list = filteredExistingList;
      changed = true;
    }

    // 1. Bestehende Einträge in der bot_vip Playlist mit aktuellen D1-Metadaten (Poster, Stream-Count, Qualitäten, Episoden) anreichern
    const existingKeySet = new Set();
    for (const item of list) {
      if (!item || !item.tmdbId) continue;
      const prefix = item.contentType === "series" ? "s" : "m";
      const mapKey = `${prefix}_${item.tmdbId}`;
      existingKeySet.add(mapKey);
      const d1Hit = d1CatalogMap.get(mapKey);
      if (d1Hit) {
        if (!item.poster && d1Hit.poster) { item.poster = d1Hit.poster; changed = true; }
        if (item.streamCount !== d1Hit.streamCount) { item.streamCount = d1Hit.streamCount; changed = true; }
        if (d1Hit.allQualities && item.allQualities !== d1Hit.allQualities) { item.allQualities = d1Hit.allQualities; changed = true; }
        if ((!item.year || item.year === "K. A.") && d1Hit.year && d1Hit.year !== "K. A.") { item.year = d1Hit.year; changed = true; }
        if (item.contentType === "series" && Array.isArray(d1Hit.episodes)) {
          const mergedEps = mergeAndSortEpisodeEntries(item.episodes || [], d1Hit.episodes);
          if (mergedEps.length !== (item.episodes?.length || 0)) {
            item.episodes = mergedEps;
            changed = true;
          } else {
            item.episodes = mergedEps;
          }
        }
      }
    }

    // 2. Alle in D1 geloggten Bot-Filme & -Serien, die noch nicht in bot_vip sind (und nicht manuell ausgeblendet wurden), ergänzen
    const allCatalogEntries = Array.from(d1CatalogMap.entries());
    const useBatch = options && (typeof options.limit === "number" || typeof options.offset === "number");
    const safeOffset = Math.max(0, Number(options?.offset || 0));
    const safeLimit = useBatch ? Math.max(1, Math.min(50, Number(options?.limit || 25))) : allCatalogEntries.length;
    const sliceEntries = useBatch ? allCatalogEntries.slice(safeOffset, safeOffset + safeLimit) : allCatalogEntries;

    const newlyAddedForD1 = [];
    for (const [mapKey, d1Item] of sliceEntries) {
      if (existingKeySet.has(mapKey)) continue;
      if (hiddenSet.has(mapKey)) continue;
      const newEntry = {
        uid: `${d1Item.prefix}_${d1Item.tmdbId}_${mainFolder.id}`,
        tmdbId: d1Item.tmdbId,
        contentType: d1Item.contentType,
        category: d1Item.contentType,
        title: d1Item.title,
        year: d1Item.year,
        fsk: d1Item.fsk,
        genres: d1Item.genres,
        poster: d1Item.poster,
        poster_path: d1Item.poster,
        quality: d1Item.quality,
        vipQuality: d1Item.quality,
        allQualities: d1Item.allQualities,
        streamCount: d1Item.streamCount,
        vipStreamCount: d1Item.streamCount,
        episodes: d1Item.contentType === "series" ? (d1Item.episodes || []) : undefined,
        syncedFromD1: true,
        playlistMode: "vip_stream",
        folderId: mainFolder.id,
        addedAt: d1Item.updatedAt || Date.now()
      };
      list.push(newEntry);
      newlyAddedForD1.push(newEntry);
      existingKeySet.add(mapKey);
      syncedAddedCount++;
      changed = true;
    }

    if (newlyAddedForD1.length > 0) {
      await batchUpsertPlaylistItemsInD1(env, "bot_vip", mainFolder.id, newlyAddedForD1);
    }
    if (changed) {
      await saveRawList(env, "bot_vip", list, { skipKvWrite: true });
    }
    memoryFallback.set("last_bot_vip_sync_ts", Date.now());

    const nextOffset = safeOffset + sliceEntries.length;
    return {
      mainFolder,
      syncedAddedCount,
      addedCount: syncedAddedCount,
      totalInD1: d1CatalogMap.size,
      totalInPlaylist: list.filter(i => String(i.folderId) === String(mainFolder.id)).length,
      offset: safeOffset,
      nextOffset,
      hasMore: nextOffset < allCatalogEntries.length
    };
  }

  async function ensureBotVipDefaultPlaylist(env, options = {}) {
    const now = Date.now();
    const lastSyncTs = Number(memoryFallback.get("last_bot_vip_sync_ts") || 0);
    if (!options?.forceSync && lastSyncTs > 0 && (now - lastSyncTs) < 180000) {
      const folders = await getFolders(env, "bot_vip");
      const existingMain = folders.find(f => f.type === "playlist" || f.isJsonPlaylist) || folders[0] || null;
      if (existingMain) return existingMain;
    }
    const res = await syncD1CatalogIntoBotVipPlaylist(env, null, options);
    return res.mainFolder;
  }

  // O(1) Cold-Start-sicherer Folder-Lookup für Ingest-Batches: löst NIEMALS einen Full-Catalog-Sync über alle D1-Medien aus!
  async function getOrCreateBotVipMainFolderFast(env) {
    const cached = memoryFallback.get("bot_vip_main_folder_fast");
    if (cached && cached.folder && (Date.now() - cached.ts) < 5 * 60 * 1000) {
      return cached.folder;
    }
    const folders = await getFolders(env, "bot_vip");
    let mainFolder = folders.find(f => f.type === "playlist" || f.isJsonPlaylist) || folders[0] || null;
    if (!mainFolder) {
      mainFolder = {
        id: "bot_vip_default",
        name: "🤖 Bot VIP-Mediathek",
        type: "playlist",
        isJsonPlaylist: true,
        playlistMode: "vip_stream",
        enabled: true,
        createdAt: Date.now()
      };
      await saveFolders(env, "bot_vip", [mainFolder]);
    }
    memoryFallback.set("bot_vip_main_folder_fast", { folder: mainFolder, ts: Date.now() });
    return mainFolder;
  }

  async function setPlaylistFolderMode(env, chatId, folderId, playlistMode, options = {}) {
    const validMode = ["vip_stream", "watchlist", "both"].includes(playlistMode) ? playlistMode : "both";
    const folders = await getFolders(env, chatId);
    const target = folders.find(f => String(f.id) === String(folderId));
    if (!target) return { ok: false, error: "Playlist nicht gefunden." };
    target.playlistMode = validMode;
    target.isJsonPlaylist = true;
    target.type = "playlist";
    await saveFolders(env, chatId, folders);

    const list = await getSavedList(env, chatId);
    const folderItems = list.filter(i => String(i.folderId) === String(folderId) && i.tmdbId);
    let syncedVipCount = 0;

    if (validMode === "vip_stream" || validMode === "both") {
      const botVipFolder = chatId === "bot_vip"
        ? target
        : await createOrGetJsonPlaylistFolder(env, "bot_vip", target.name, target.sourceLabel || "Admin-Sync", "vip_stream");
      const resolvedForBotVip = [];

      // WICHTIG: Niemals synthetische 'vip_playlist_...' Datei-IDs in movie_files / episode_files erzeugen!
      // Das hat zuvor doppelte (nicht funktionierende) Sende-Buttons erzeugt UND ab ~54 Filmen das Cloudflare 50-Subrequest-Limit gesprengt!
      const useBatch = options && (typeof options.limit === "number" || typeof options.offset === "number");
      const safeOffset = Math.max(0, Number(options?.offset || 0));
      const safeLimit = useBatch ? Math.max(1, Math.min(25, Number(options?.limit || 25))) : folderItems.length;
      const sliceItems = useBatch ? folderItems.slice(safeOffset, safeOffset + safeLimit) : folderItems;

      for (const item of sliceItems) {
        item.playlistMode = validMode;
        const tmdbId = Number(item.tmdbId);
        if (!tmdbId) continue;
        const isSeries = item.contentType === "series";
        const quality = item.quality || "1080p";
        syncedVipCount++;
        resolvedForBotVip.push({
          tmdbId,
          typeCode: isSeries ? "s" : "m",
          cleanTitle: item.title,
          year: item.year,
          poster: item.poster || "",
          quality,
          details: { title: item.title, releaseDate: item.year ? `${item.year}-01-01` : "", fsk: item.fsk, genres: item.genres }
        });
      }

      if (chatId !== "bot_vip" && botVipFolder && resolvedForBotVip.length > 0) {
        await batchSaveIngestedItemsToPlaylist(env, "bot_vip", botVipFolder.id, resolvedForBotVip, "vip_stream");
      }
      await saveRawList(env, chatId, list);
      const nextOffset = safeOffset + sliceItems.length;
      return {
        ok: true,
        folder: target,
        playlistMode: validMode,
        syncedVipCount,
        offset: safeOffset,
        nextOffset,
        total: folderItems.length,
        hasMore: nextOffset < folderItems.length
      };
    } else {
      for (const item of folderItems) {
        item.playlistMode = "watchlist";
      }
      await saveRawList(env, chatId, list);
    }

    return { ok: true, folder: target, playlistMode: validMode, syncedVipCount, offset: 0, nextOffset: folderItems.length, total: folderItems.length, hasMore: false };
  }

  // Kopiert große Playlisten in 25er-Batches (umgeht das Cloudflare 50-Subrequest-Limit zuverlässig)
  async function copyPlaylistFolderItemsBatched(env, sourceChatId, sourceFolderId, targetChatId, targetFolderName, targetMode = "both", offset = 0, limit = 25) {
    const srcChat = String(sourceChatId || "bot_vip");
    const dstChat = String(targetChatId || "bot_vip");
    const safeOffset = Math.max(0, Number(offset || 0));
    const safeLimit = Math.max(1, Math.min(25, Number(limit || 25)));

    const srcFolders = await getFolders(env, srcChat);
    const srcFolder = srcFolders.find(f => String(f.id) === String(sourceFolderId));
    if (!srcFolder) {
      return { ok: false, error: "Quell-Playlist nicht gefunden." };
    }

    const srcList = await getSavedList(env, srcChat);
    const sourceItems = srcList.filter(i => String(i.folderId || "") === String(sourceFolderId));
    const totalItems = sourceItems.length;
    const batchItems = sourceItems.slice(safeOffset, safeOffset + safeLimit);

    const cleanTargetName = String(targetFolderName || `${srcFolder.name} (VIP-Kopie)`).trim().slice(0, 48);
    const dstFolder = await createOrGetJsonPlaylistFolder(
      env,
      dstChat,
      cleanTargetName,
      `Kopie von ${srcFolder.name}`,
      targetMode || srcFolder.playlistMode || "both"
    );

    if (!dstFolder) {
      return { ok: false, error: "Ziel-Playlist konnte nicht erstellt werden." };
    }

    let dstList = await getSavedList(env, dstChat);
    const existingMap = new Map();
    for (const item of dstList) {
      if (String(item.folderId || "") === String(dstFolder.id) && item.tmdbId) {
        const key = `${item.contentType === "series" ? "s" : "m"}_${item.tmdbId}`;
        existingMap.set(key, item);
      }
    }

    let copiedInBatch = 0;
    let updatedInBatch = 0;
    for (const srcItem of batchItems) {
      const tmdbId = Number(srcItem.tmdbId || 0);
      if (!tmdbId) continue;
      const isSeries = srcItem.contentType === "series" || srcItem.category === "series";
      const prefix = isSeries ? "s" : "m";
      const key = `${prefix}_${tmdbId}`;
      const existing = existingMap.get(key);
      if (existing) {
        if (!existing.poster && srcItem.poster) existing.poster = srcItem.poster;
        if (Array.isArray(srcItem.episodes) && srcItem.episodes.length > 0) {
          existing.episodes = mergeAndSortEpisodeEntries(existing.episodes || [], srcItem.episodes);
          existing.streamCount = existing.episodes.length;
        }
        updatedInBatch++;
      } else {
        const cloned = {
          ...srcItem,
          uid: `${prefix}_${tmdbId}_${dstFolder.id}`,
          folderId: dstFolder.id,
          playlistMode: dstFolder.playlistMode || targetMode || "both",
          addedAt: Date.now()
        };
        dstList.push(cloned);
        existingMap.set(key, cloned);
        copiedInBatch++;
      }
    }

    if (copiedInBatch > 0 || updatedInBatch > 0) {
      await saveRawList(env, dstChat, dstList);
    }

    const nextOffset = safeOffset + batchItems.length;
    return {
      ok: true,
      sourceFolderName: srcFolder.name,
      targetChatId: dstChat,
      targetFolderId: dstFolder.id,
      targetFolderName: dstFolder.name,
      offset: safeOffset,
      processed: batchItems.length,
      copiedInBatch,
      updatedInBatch,
      total: totalItems,
      nextOffset,
      hasMore: nextOffset < totalItems
    };
  }

  async function reorderPlaylistFolderItem(env, chatId, folderId, itemUid, direction) {
    const list = await getSavedList(env, chatId);
    const folderIndices = [];
    for (let idx = 0; idx < list.length; idx++) {
      if (String(list[idx].folderId || "") === String(folderId)) {
        folderIndices.push(idx);
      }
    }
    const posInFolder = folderIndices.findIndex(listIdx => String(list[listIdx].uid) === String(itemUid));
    if (posInFolder === -1) return { ok: false, error: "Eintrag in dieser Playlist nicht gefunden." };

    let targetPos = posInFolder;
    if (direction === "up" && posInFolder > 0) targetPos = posInFolder - 1;
    else if (direction === "down" && posInFolder < folderIndices.length - 1) targetPos = posInFolder + 1;
    else if (direction === "top" && posInFolder > 0) targetPos = 0;

    if (targetPos !== posInFolder) {
      const fromListIdx = folderIndices[posInFolder];
      const toListIdx = folderIndices[targetPos];
      const [moved] = list.splice(fromListIdx, 1);
      list.splice(toListIdx, 0, moved);
      await saveRawList(env, chatId, list);
    }
    const updatedFolderItems = list.filter(i => String(i.folderId || "") === String(folderId));
    return { ok: true, items: updatedFolderItems };
  }

  async function addOrRemovePlaylistFolderItem(env, chatId, folderId, subAction, payload = {}) {
    const folders = await getFolders(env, chatId);
    const folder = folders.find(f => String(f.id) === String(folderId));
    if (!folder) return { ok: false, error: "Playlist nicht gefunden." };

    let list = await getSavedList(env, chatId);
    if (subAction === "remove_item" || subAction === "delete_from_d1") {
      const uid = String(payload.uid || "");
      const tmdbId = payload.tmdbId ? String(payload.tmdbId) : "";
      const removedItems = [];
      list = list.filter(i => {
        if (String(i.folderId || "") !== String(folderId)) return true;
        if ((uid && String(i.uid) === uid) || (tmdbId && String(i.tmdbId) === tmdbId)) {
          removedItems.push(i);
          return false;
        }
        return true;
      });

      if (removedItems.length > 0) {
        await saveRawList(env, chatId, list);
        if (chatId === "bot_vip" && subAction === "remove_item") {
          const hiddenSet = await getBotVipHiddenKeys(env);
          for (const rem of removedItems) {
            const pfx = rem.contentType === "series" ? "s" : "m";
            hiddenSet.add(`${pfx}_${rem.tmdbId}`);
          }
          await saveBotVipHiddenKeys(env, hiddenSet);
        }
      }

      if (subAction === "delete_from_d1") {
        const targetItem = removedItems[0] || {
          tmdbId: payload.tmdbId,
          contentType: payload.typeCode === "s" ? "series" : "movie"
        };
        const delTypeCode = (payload.typeCode === "s" || targetItem.contentType === "series") ? "s" : "m";
        const delTmdbId = Number(targetItem.tmdbId || payload.tmdbId || 0);
        if (delTmdbId) {
          await deleteMediaFromD1(env, delTypeCode, delTmdbId);
          // Auch aus allen anderen bot_vip Ordnern bereinigen
          if (chatId !== "bot_vip") {
            let botVipList = await getSavedList(env, "bot_vip");
            const nextBotVip = botVipList.filter(i => !(Number(i.tmdbId) === delTmdbId && (i.contentType === "series" ? "s" : "m") === delTypeCode));
            if (nextBotVip.length !== botVipList.length) {
              await saveRawList(env, "bot_vip", nextBotVip);
            }
          }
        }
      }

      return {
        ok: true,
        deletedFromD1: subAction === "delete_from_d1",
        items: list.filter(i => String(i.folderId || "") === String(folderId))
      };
    }

    if (subAction === "add_item") {
      const rawQuery = String(payload.query || payload.title || payload.tmdbId || "").trim();
      const typeHint = payload.typeCode === "s" ? "s" : payload.typeCode === "m" ? "m" : "auto";
      const quality = String(payload.quality || "1080p").trim();
      if (!rawQuery) return { ok: false, error: "Bitte Titel oder TMDb-ID angeben." };

      const isVipPlaylist = chatId === "bot_vip" || folder.playlistMode === "vip_stream" || folder.playlistMode === "both";
      const entryInput = /^\d+$/.test(rawQuery)
        ? {
            tmdb_id: Number(rawQuery),
            type: typeHint === "s" ? "series" : "movie",
            quality,
            registerAsVipStream: isVipPlaylist
          }
        : {
            filename: rawQuery,
            title: rawQuery,
            isSeries: typeHint === "s",
            quality,
            registerAsVipStream: isVipPlaylist
          };

      const syntheticMeta = isVipPlaylist
        ? {
            fileId: payload.fileId || `vip_manual_${folderId}_${Date.now()}`,
            fileUniqueId: `vip_manual_${folderId}_${Date.now()}`,
            mimeType: "video/mp4"
          }
        : null;

      const resolved = await resolveAndIngestMediaEntry(env, entryInput, syntheticMeta);
      if (!resolved || !resolved.ok) {
        return { ok: false, error: `Kein Treffer für „${rawQuery}“ in TMDb/OMDb/Wikidata/MediaWiki gefunden.` };
      }

      if (chatId === "bot_vip") {
        const hiddenSet = await getBotVipHiddenKeys(env);
        const mapKey = `${resolved.typeCode === "s" ? "s" : "m"}_${resolved.tmdbId}`;
        if (hiddenSet.has(mapKey)) {
          hiddenSet.delete(mapKey);
          await saveBotVipHiddenKeys(env, hiddenSet);
        }
      }

      await batchSaveIngestedItemsToPlaylist(env, chatId, folderId, [resolved], folder.playlistMode || "both");
      if (isVipPlaylist && chatId !== "bot_vip") {
        const botFolder = await ensureBotVipDefaultPlaylist(env);
        if (botFolder) {
          await batchSaveIngestedItemsToPlaylist(env, "bot_vip", botFolder.id, [resolved], "vip_stream");
        }
      }
      const updatedList = await getSavedList(env, chatId);
      return {
        ok: true,
        addedItem: resolved,
        items: updatedList.filter(i => String(i.folderId || "") === String(folderId))
      };
    }

    return { ok: false, error: "Unbekannte Aktion." };
  }

  async function togglePlaylistFolderEnabled(env, chatId, folderId) {
    const folders = await getFolders(env, chatId);
    const target = folders.find(f => String(f.id) === String(folderId));
    if (!target) return { ok: false, error: "Playlist nicht gefunden." };
    target.enabled = !(target.enabled !== false);
    await saveFolders(env, chatId, folders);
    return { ok: true, folder: target, enabled: target.enabled };
  }

  async function renamePlaylistFolder(env, chatId, folderId, newName) {
    const cleanName = String(newName || "").trim().slice(0, 48);
    if (!cleanName) return { ok: false, error: "Name darf nicht leer sein." };
    const folders = await getFolders(env, chatId);
    const target = folders.find(f => String(f.id) === String(folderId));
    if (!target) return { ok: false, error: "Playlist nicht gefunden." };
    target.name = cleanName;
    await saveFolders(env, chatId, folders);
    return { ok: true, folder: target };
  }

  async function deletePlaylistFolderAndItems(env, chatId, folderId) {
    let folders = await getFolders(env, chatId);
    const target = folders.find(f => String(f.id) === String(folderId));
    if (!target) return { ok: false, error: "Playlist nicht gefunden." };

    let list = await getSavedList(env, chatId);
    const beforeCount = list.length;
    const deletedSeriesIds = new Set(
      list
        .filter(i => i.folderId === folderId && i.contentType === "series" && i.tmdbId)
        .map(i => String(i.tmdbId))
    );
    if (target.type === "series_show" && target.tmdbRefId) {
      deletedSeriesIds.add(String(target.tmdbRefId));
    }

    list = list.filter(i => {
      if (String(i.folderId) === String(folderId)) return false;
      if (target.type === "series_show") {
        if (i.contentType === "episode" && deletedSeriesIds.has(String(i.seriesId))) return false;
        if (i.contentType === "series" && deletedSeriesIds.has(String(i.tmdbId))) return false;
      }
      return true;
    });

    const removedItemsCount = Math.max(0, beforeCount - list.length);
    await deletePlaylistFolderFromD1(env, chatId, folderId);
    await saveRawList(env, chatId, list);
    folders = folders.filter(f => String(f.id) !== String(folderId));
    await saveFolders(env, chatId, folders);
    return { ok: true, deletedFolderName: target.name, removedItemsCount };
  }

  async function batchSaveIngestedItemsToPlaylist(env, chatId, folderId, resolvedResults, playlistMode = "both") {
    if (!chatId || chatId === "guest" || !folderId || !Array.isArray(resolvedResults) || resolvedResults.length === 0) {
      return 0;
    }
    const cleanChatId = String(chatId).trim();
    const cleanFolderId = String(folderId).trim();
    const modeStr = typeof playlistMode === "object" && playlistMode !== null
      ? String(playlistMode.playlistMode || "both")
      : String(playlistMode || "both");
    try {
      // ULTRA-FAST DELTA-UPSERT (0 ms CPU-Overhead & 0 D1-Full-Playlist-Reads!):
      // Statt bei jedem Import-Batch 5.000 bestehende Playlist-Einträge per getSavedList() aus D1 zu laden,
      // aggregieren wir nur die Elemente des aktuellen Batches und schreiben sie per ON CONFLICT Delta-Upsert!
      const batchByUid = new Map();
      for (const res of resolvedResults) {
        if (!res || !res.tmdbId) continue;
        const hasValidFileId = Boolean(res.hasValidVideoFile || scoreTelegramFileIdValidity(res.fileMeta?.fileId || res.fileMeta?.telegram_file_id || "") > 0);
        if ((cleanChatId === "bot_vip" || modeStr === "vip_stream") && !hasValidFileId) {
          continue;
        }
        const contentType = res.typeCode === "s" ? "series" : "movie";
        const prefix = res.typeCode === "s" ? "s" : "m";
        const d = res.details || {};
        const rawDate = d.releaseDate && d.releaseDate !== "Keine Angabe"
          ? d.releaseDate
          : (d.release_date || d.first_air_date || "");
        const year = res.year || (rawDate.split("-")[0]) || "K. A.";
        const cleanTitle = (res.cleanTitle || d.title || d.name || `Titel #${res.tmdbId}`).replace(/\s*\(\d{4}\)$/, "").trim();
        const posterUrl = resolvePosterUrl(res.poster || d.poster_path, "w185", d.external_poster_url || "");
        const uid = `${prefix}_${res.tmdbId}_${cleanFolderId}`;

        const sNum = Math.max(1, Number(res.season || 1));
        const eNum = Math.max(1, Number(res.episode || 1));
        const epEntry = contentType === "series" ? {
          season: sNum,
          episode: eNum,
          code: `S${String(sNum).padStart(2, "0")}E${String(eNum).padStart(2, "0")}`,
          title: String(res.episodeTitle || `Folge ${eNum}`).trim(),
          quality: String(res.quality || "1080p"),
          codec: String(res.codec || "x264"),
          fileId: res.fileMeta?.fileId || null,
          fileSize: res.fileSize || null,
          tags: res.tags || ""
        } : null;

        const prevInBatch = batchByUid.get(uid);
        if (prevInBatch) {
          if (!prevInBatch.poster && posterUrl) {
            prevInBatch.poster = posterUrl;
            prevInBatch.poster_path = posterUrl;
          }
          if (contentType === "series" && epEntry) {
            prevInBatch.episodes = mergeAndSortEpisodeEntries(prevInBatch.episodes || [], [epEntry]);
            prevInBatch.streamCount = prevInBatch.episodes.length;
            prevInBatch.vipStreamCount = prevInBatch.episodes.length;
          } else {
            prevInBatch.streamCount = Number(prevInBatch.streamCount || 1) + 1;
            prevInBatch.vipStreamCount = prevInBatch.streamCount;
          }
          continue;
        }

        batchByUid.set(uid, {
          uid,
          tmdbId: Number(res.tmdbId),
          contentType,
          category: contentType,
          title: cleanTitle,
          year,
          fsk: d.fsk || "K. A.",
          genres: d.genres || (contentType === "series" ? "Serie" : "Film"),
          poster: posterUrl,
          poster_path: posterUrl,
          quality: res.quality || "1080p",
          vipQuality: res.quality || "1080p",
          allQualities: res.quality || "1080p",
          streamCount: 1,
          vipStreamCount: 1,
          episodes: contentType === "series" && epEntry ? [epEntry] : undefined,
          metadataSource: res.metadataSource || d.metadata_source || "TMDb",
          playlistMode: modeStr,
          folderId: cleanFolderId,
          addedAt: Date.now()
        });
      }

      const itemsToPersistInD1 = Array.from(batchByUid.values());
      if (itemsToPersistInD1.length > 0) {
        await batchUpsertPlaylistItemsInD1(env, cleanChatId, cleanFolderId, itemsToPersistInD1);
        // Invalidiere den 60s-Lese-Cache für diese Chat-ID, damit der nächste explizite Lesezugriff die neuen Einträge sieht
        memoryFallback.delete(`user_list_hydrated_ts_${cleanChatId}`);
      }
      return itemsToPersistInD1.length;
    } catch (e) {
      return 0;
    }
  }

  async function saveItemToList(env, chatId, itemObj, folderId = null) {
    if (!itemObj) return { saved: false, updatedFolder: false };
    try {
      let list = await getSavedList(env, chatId);
      const targetFolder = folderId || null;
      const sameFolderIdx = list.findIndex(i => {
        const sameItem = (i.tmdbId && itemObj.tmdbId)
          ? (String(i.tmdbId) === String(itemObj.tmdbId) && i.contentType === itemObj.contentType)
          : (i.title === itemObj.title);
        return sameItem && (i.folderId || null) === targetFolder;
      });

      const prefix = itemObj.contentType === "series" ? "s" : "m";
      const baseId = itemObj.tmdbId || Date.now();
      const uid = targetFolder ? `${prefix}_${baseId}_${targetFolder}` : `${prefix}_${baseId}`;

      if (sameFolderIdx === -1) {
        const newEntry = {
          ...itemObj,
          uid,
          folderId: targetFolder,
          addedAt: Date.now()
        };
        list.push(newEntry);
        if (targetFolder) {
          await batchUpsertPlaylistItemsInD1(env, chatId, targetFolder, [newEntry]);
        }
        await saveRawList(env, chatId, list);
        await cleanupEmptyFolders(env, chatId);
        return { saved: true, updatedFolder: false };
      }
      return { saved: false, updatedFolder: true };
    } catch (e) {}
    return { saved: false, updatedFolder: false };
  }

  async function removeItemByUid(env, chatId, uidOrIndex) {
    try {
      let list = await getSavedList(env, chatId);
      let removedItem = null;
      const byUidIdx = list.findIndex(i => String(i.uid) === String(uidOrIndex));
      if (byUidIdx !== -1) {
        removedItem = list[byUidIdx];
        list.splice(byUidIdx, 1);
      } else {
        const numIdx = parseInt(uidOrIndex, 10);
        if (!isNaN(numIdx) && numIdx >= 0 && numIdx < list.length) {
          removedItem = list[numIdx];
          list.splice(numIdx, 1);
        }
      }
      if (removedItem && removedItem.uid) {
        await deletePlaylistItemFromD1(env, chatId, removedItem.uid, removedItem.folderId || null);
      }
      // Wenn eine Serie aus der Merkliste gelöscht wird, auch alle gemerkten Episoden dieser Serie löschen
      if (removedItem && removedItem.contentType === "series" && removedItem.tmdbId) {
        const sId = String(removedItem.tmdbId);
        list = list.filter(i => {
          if (i.contentType === "episode" && String(i.seriesId) === sId) return false;
          if (i.contentType === "series" && String(i.tmdbId) === sId) return false;
          return true;
        });
        await deletePlaylistItemFromD1(env, chatId, sId, null);
      }
      await saveRawList(env, chatId, list);
      await cleanupEmptyFolders(env, chatId);
    } catch (e) {}
  }

  async function removeAllInstancesOfItem(env, chatId, arg1, arg2) {
    try {
      const isArg1Type = arg1 === "m" || arg1 === "s" || arg1 === "movie" || arg1 === "series";
      const rawType = isArg1Type ? arg1 : arg2;
      const itemId = isArg1Type ? arg2 : arg1;
      const contentType = (rawType === "s" || rawType === "series") ? "series" : "movie";
      let list = await getSavedList(env, chatId);
      const beforeLen = list.length;
      list = list.filter(i => {
        if (String(i.tmdbId) === String(itemId) && i.contentType === contentType) return false;
        if (contentType === "series" && i.contentType === "episode" && String(i.seriesId) === String(itemId)) return false;
        return true;
      });
      await deletePlaylistItemFromD1(env, chatId, String(itemId), null);
      if (list.length !== beforeLen) {
        await saveRawList(env, chatId, list);
        await cleanupEmptyFolders(env, chatId);
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Gebündelte User-Session im Unified User Bundle (`u_bundle_${chatId}`) mit In-Memory Cache & Write-Back Batcher!
  async function getUserSession(env, chatId) {
    const bundle = await getUserBundle(env, chatId);
    if (!bundle.session || typeof bundle.session !== "object") {
      bundle.session = {};
    }
    memoryFallback.set(`sess_${chatId}`, bundle.session);
    return bundle.session;
  }

  async function flushUserSession(env, chatId, options = {}) {
    if (!chatId) {
      await flushDirtyKvBatch(env, { force: Boolean(options?.force) });
      return;
    }
    const cleanId = String(chatId).trim();
    if (cleanId === "bot_vip") {
      return;
    }
    // Zero-IO Fast-Exit: Wenn die Session im RAM gar nicht verändert wurde (!_dirty),
    // niemals getUserBundle() aufrufen (spart D1- & KV-Reads bei jedem Gruppen-Post / Webhook)!
    const ramBundle = memoryFallback.get(`u_bundle_${cleanId}`);
    const ramSess = memoryFallback.get(`sess_${cleanId}`) || ramBundle?.session;
    if (!ramSess || !ramSess._dirty) {
      if (options?.force || (typeof kvDirtyBuffer !== "undefined" && kvDirtyBuffer.size > 0)) {
        await flushDirtyKvBatch(env, { force: Boolean(options?.force) });
      }
      return;
    }
    const bundle = await getUserBundle(env, chatId);
    const sess = bundle.session || memoryFallback.get(`sess_${cleanId}`);
    if (sess && sess._dirty) {
      delete sess._dirty;
      bundle.session = sess;
      await stageUserBundleWrite(env, chatId, bundle, options);
    }
    await flushDirtyKvBatch(env, { force: Boolean(options?.force) });
  }

  async function getWishlistViewState(env, chatId) {
    const defaultState = {
      currentFolderId: "root",
      sortBy: "added_desc",
      searchQuery: "",
      page: 1
    };
    const sess = await getUserSession(env, chatId);
    return sess.wlState ? { ...defaultState, ...sess.wlState } : defaultState;
  }

  async function saveWishlistViewState(env, chatId, partialState) {
    const sess = await getUserSession(env, chatId);
    const current = await getWishlistViewState(env, chatId);
    const updated = { ...current, ...partialState };
    sess.wlState = updated;
    sess._dirty = true;
    return updated;
  }

  async function setOriginSession(env, chatId, sessionObj) {
    const sess = await getUserSession(env, chatId);
    sess.originSession = sessionObj;
    sess._dirty = true;
  }

  async function getOriginSession(env, chatId) {
    const sess = await getUserSession(env, chatId);
    return sess.originSession || null;
  }

  async function clearOriginSession(env, chatId) {
    const sess = await getUserSession(env, chatId);
    if (sess.originSession || sess.simAnchor) {
      delete sess.originSession;
      delete sess.simAnchor;
      sess._dirty = true;
    }
    memoryFallback.delete(`sim_anchor_${chatId}`);
  }

  async function setSimAnchor(env, chatId, anchorObj) {
    const sess = await getUserSession(env, chatId);
    sess.simAnchor = anchorObj;
    sess._dirty = true;
    memoryFallback.set(`sim_anchor_${chatId}`, anchorObj);
  }

  async function getSimAnchor(env, chatId) {
    const sess = await getUserSession(env, chatId);
    return sess.simAnchor || memoryFallback.get(`sim_anchor_${chatId}`) || null;
  }

  async function getUserSettings(env, chatId) {
    const bundle = await getUserBundle(env, chatId);
    bundle.settings = { ...DEFAULT_USER_SETTINGS_TEMPLATE, ...(bundle.settings || {}) };
    memoryFallback.set(`settings_${chatId}`, bundle.settings);
    return bundle.settings;
  }

  async function saveUserSettings(env, chatId, settings, options = {}) {
    const bundle = await getUserBundle(env, chatId);
    bundle.settings = { ...DEFAULT_USER_SETTINGS_TEMPLATE, ...(settings || {}) };
    await stageUserBundleWrite(env, chatId, bundle, options);
  }

  const MAX_TOPIC_SESSION_BUCKETS = 15;

  function resolveSessionThreadScopeKey(chatId, explicitThreadId = null) {
    const rawTid = explicitThreadId !== null && explicitThreadId !== undefined
      ? explicitThreadId
      : (typeof getActiveChatThreadId === "function" ? getActiveChatThreadId(chatId) : null);
    const tid = typeof parseValidTelegramThreadId === "function"
      ? parseValidTelegramThreadId(rawTid)
      : (Number.isInteger(Number(rawTid)) && Number(rawTid) > 0 ? Number(rawTid) : null);
    return tid ? `t_${tid}` : "main";
  }

  function getThreadSessionBucket(sess, chatId, createIfMissing = false, explicitThreadId = null) {
    if (!sess || typeof sess !== "object") return null;
    const scopeKey = resolveSessionThreadScopeKey(chatId, explicitThreadId);
    if (scopeKey === "main") return sess;
    if (!sess.topicStates || typeof sess.topicStates !== "object" || Array.isArray(sess.topicStates)) {
      if (!createIfMissing) return null;
      sess.topicStates = {};
    }
    let bucket = sess.topicStates[scopeKey];
    if (!bucket || typeof bucket !== "object") {
      if (!createIfMissing) return null;
      bucket = { updatedAt: Date.now() };
      sess.topicStates[scopeKey] = bucket;
      const keys = Object.keys(sess.topicStates);
      if (keys.length > MAX_TOPIC_SESSION_BUCKETS) {
        keys
          .filter(k => k !== scopeKey)
          .sort((a, b) => Number(sess.topicStates[a]?.updatedAt || 0) - Number(sess.topicStates[b]?.updatedAt || 0))
          .slice(0, keys.length - MAX_TOPIC_SESSION_BUCKETS)
          .forEach(oldKey => {
            delete sess.topicStates[oldKey];
          });
      }
    } else if (createIfMissing) {
      bucket.updatedAt = Date.now();
    }
    return bucket;
  }

  async function saveSearchState(env, chatId, query, page, totalResults = 0, movieCount = 0, seriesCount = 0, sortBy = null, ignoreFilters = null) {
    const sess = await getUserSession(env, chatId);
    const scopeKey = resolveSessionThreadScopeKey(chatId);
    const bucket = getThreadSessionBucket(sess, chatId, true);
    const prev = bucket?.searchState || null;
    const effectiveSort = sortBy || prev?.sortBy || "pop_desc";
    const effectiveIgnoreFilters = ignoreFilters !== null
      ? Boolean(ignoreFilters)
      : (prev && prev.query === query ? Boolean(prev.ignoreFilters) : false);
    const obj = {
      query,
      page: Number(page) || 1,
      totalResults,
      movieCount,
      seriesCount,
      sortBy: effectiveSort,
      ignoreFilters: effectiveIgnoreFilters
    };
    if (bucket) bucket.searchState = obj;
    sess._dirty = true;
    memoryFallback.set(`search_state_${chatId}_${scopeKey}`, obj);
  }

  async function getSearchState(env, chatId) {
    const sess = await getUserSession(env, chatId);
    const scopeKey = resolveSessionThreadScopeKey(chatId);
    const bucket = getThreadSessionBucket(sess, chatId, false);
    return bucket?.searchState || memoryFallback.get(`search_state_${chatId}_${scopeKey}`) || null;
  }

  async function setUserPromptState(env, chatId, msgId, mode = "search", meta = {}) {
    const sess = await getUserSession(env, chatId);
    const bucket = getThreadSessionBucket(sess, chatId, true);
    if (bucket) {
      bucket.promptState = { msgId: Number(msgId) || null, mode, meta };
      sess._dirty = true;
    }
  }

  async function getUserPromptState(env, chatId) {
    const sess = await getUserSession(env, chatId);
    const bucket = getThreadSessionBucket(sess, chatId, false);
    return bucket?.promptState || null;
  }

  async function clearUserPromptState(env, chatId) {
    const sess = await getUserSession(env, chatId);
    const bucket = getThreadSessionBucket(sess, chatId, false);
    if (bucket && bucket.promptState) {
      delete bucket.promptState;
      if (bucket !== sess) bucket.updatedAt = Date.now();
      sess._dirty = true;
    }
  }

  async function trackTempMessage(env, chatId, msgId) {
    if (!chatId || !msgId) return;
    const sess = await getUserSession(env, chatId);
    const bucket = getThreadSessionBucket(sess, chatId, true);
    if (!bucket) return;
    const list = Array.isArray(bucket.tempMsgIds) ? bucket.tempMsgIds : [];
    const numId = Number(msgId);
    if (numId && !list.includes(numId)) {
      list.push(numId);
      if (list.length > 25) list.splice(0, list.length - 25);
      bucket.tempMsgIds = list;
      sess._dirty = true;
    }
  }

  async function untrackTempMessage(env, chatId, msgId) {
    if (!chatId || !msgId) return;
    const sess = await getUserSession(env, chatId);
    const bucket = getThreadSessionBucket(sess, chatId, false);
    if (bucket && Array.isArray(bucket.tempMsgIds)) {
      bucket.tempMsgIds = bucket.tempMsgIds.filter(id => Number(id) !== Number(msgId));
      if (bucket !== sess) bucket.updatedAt = Date.now();
      sess._dirty = true;
    }
  }

  async function clearAllTempMessages(env, chatId, deleteMessageFn, keepMsgId = null) {
    const sess = await getUserSession(env, chatId);
    const bucket = getThreadSessionBucket(sess, chatId, Boolean(keepMsgId));
    if (!bucket) return;
    const ids = Array.isArray(bucket.tempMsgIds) ? [...bucket.tempMsgIds] : [];
    bucket.tempMsgIds = keepMsgId ? [Number(keepMsgId)] : [];
    if (bucket !== sess) bucket.updatedAt = Date.now();
    sess._dirty = true;
    if (deleteMessageFn) {
      for (const id of ids) {
        if (keepMsgId && Number(id) === Number(keepMsgId)) continue;
        try {
          await deleteMessageFn(chatId, id);
        } catch (e) {}
      }
    }
  }

  // @ANCHOR: GENRE_AUTO_RANDOM_TIMESTAMP
  // Prüft anhand der Uhrzeit der letzten Bot-Nachricht (edit_date || date), ob der Nutzer
  // länger als 60 Sekunden ohne Auswahl in der Genre-Übersicht war – komplett ohne Zeit-Speicherung!
  function getGenreMenuTimeoutFromBotMessage(cq) {
    const msg = cq?.message;
    if (!msg) return null;
    const botMsgSec = Number(msg.edit_date || msg.date || 0);
    if (!botMsgSec) return null;
    const elapsedSec = Math.floor(Date.now() / 1000) - botMsgSec;
    if (elapsedSec < 60) return null;

    const rows = msg.reply_markup?.inline_keyboard || [];
    for (const row of rows) {
      for (const btn of row) {
        const cb = btn?.callback_data || "";
        const allMatch = cb.match(/^g_([ms])_random_all$/);
        if (allMatch) {
          return { typeCode: allMatch[1], genreId: "random_all", elapsedSec };
        }
        const singleMatch = cb.match(/^g_([ms])_(\d+)$/);
        if (singleMatch) {
          return { typeCode: singleMatch[1], genreId: singleMatch[2], elapsedSec };
        }
      }
    }
    return null;
  }

  async function setActiveMenu(env, chatId, msgId) {
    const sess = await getUserSession(env, chatId);
    const bucket = getThreadSessionBucket(sess, chatId, true);
    if (bucket) {
      bucket.activeMenu = Number(msgId) || null;
      sess._dirty = true;
    }
    if (msgId) await trackTempMessage(env, chatId, msgId);
  }

  async function getActiveMenu(env, chatId) {
    const sess = await getUserSession(env, chatId);
    const bucket = getThreadSessionBucket(sess, chatId, false);
    return bucket?.activeMenu || null;
  }

  async function clearActiveMenu(env, chatId) {
    const sess = await getUserSession(env, chatId);
    const bucket = getThreadSessionBucket(sess, chatId, false);
    if (bucket && bucket.activeMenu) {
      await untrackTempMessage(env, chatId, bucket.activeMenu);
      delete bucket.activeMenu;
      if (bucket !== sess) bucket.updatedAt = Date.now();
      sess._dirty = true;
    }
  }

  async function setExtraMessage(env, chatId, msgId) {
    const sess = await getUserSession(env, chatId);
    const bucket = getThreadSessionBucket(sess, chatId, true);
    if (bucket) {
      bucket.extraMsg = Number(msgId) || null;
      sess._dirty = true;
    }
    if (msgId) await trackTempMessage(env, chatId, msgId);
  }

  async function clearExtraMessage(env, chatId, deleteMessageFn) {
    const sess = await getUserSession(env, chatId);
    const bucket = getThreadSessionBucket(sess, chatId, false);
    const val = bucket?.extraMsg;
    if (val) {
      delete bucket.extraMsg;
      if (bucket !== sess) bucket.updatedAt = Date.now();
      sess._dirty = true;
    }
    if (val && deleteMessageFn) {
      try {
        await deleteMessageFn(chatId, parseInt(val, 10));
      } catch (e) {}
    }
  }

  // @ANCHOR: TRANSLATOR_FSK
  // --- FSK & Daten-Helfer (ohne "J" hinter der Zahl: "Ab 12" statt "Ab 12J") ---
  function formatFskDisplay(fskStr) {
    if (!fskStr) return "Nicht angegeben";
    const cleaned = String(fskStr).replace(/^FSK\s*/i, "").trim();
    if (!cleaned || cleaned.toLowerCase() === "keine angabe" || cleaned.toLowerCase() === "k. a.") return "Nicht angegeben";
    return `Ab ${cleaned}`;
  }

  function formatFskCompact(fskStr) {
    if (!fskStr) return "FSK k.A.";
    const cleaned = String(fskStr).replace(/^FSK\s*/i, "").trim();
    if (!cleaned || cleaned.toLowerCase() === "keine angabe" || cleaned.toLowerCase() === "k. a.") return "FSK k.A.";
    return `Ab ${cleaned}`;
  }

  function getFskRating(releaseDates) {
    if (!releaseDates || !releaseDates.results) return "FSK Keine Angabe";
    const deRelease = releaseDates.results.find(r => r && r.iso_3166_1 === "DE");
    if (!deRelease) return "FSK Keine Angabe";
    const dates = deRelease.release_dates || deRelease.rating || [];
    if (Array.isArray(dates)) {
      for (const rel of dates) {
        if (rel && rel.certification) {
          const cert = String(rel.certification).trim();
          if (cert) return cert.startsWith("FSK") ? cert : `FSK ${cert}`;
        }
      }
    }
    return "FSK Keine Angabe";
  }

  // --- Multi-Engine Übersetzer ---
  async function translator(text, targetLang = "de") {
    if (!text) return "Keine Beschreibung verfügbar.";
    const cleanInput = String(text).trim();
    if (!cleanInput) return "Keine Beschreibung verfügbar.";

    trackStat("translatorCalls");

    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(cleanInput)}`;
      const res = await fetchWithTimeout(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*"
        }
      }, 3800);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json) && Array.isArray(json[0])) {
          const translated = json[0].map((item) => (item && item[0]) ? item[0] : "").join("").trim();
          if (translated && translated.toLowerCase() !== cleanInput.toLowerCase()) {
            return translated;
          }
        }
      }
    } catch (e) {}

    try {
      const url2 = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${targetLang}&q=${encodeURIComponent(cleanInput)}`;
      const res2 = await fetchWithTimeout(url2, {
        headers: { "User-Agent": "Mozilla/5.0" }
      }, 3500);
      if (res2.ok) {
        const json2 = await res2.json();
        if (Array.isArray(json2) && json2[0]) {
          const part = Array.isArray(json2[0]) ? json2[0][0] : json2[0];
          if (typeof part === "string" && part.trim()) return part.trim();
        }
      }
    } catch (e) {}

    try {
      const shortInput = cleanInput.slice(0, 490);
      const url3 = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(shortInput)}&langpair=en|${targetLang}`;
      const res3 = await fetchWithTimeout(url3, {}, 3800);
      if (res3.ok) {
        const json3 = await res3.json();
        if (json3?.responseData?.translatedText) {
          return String(json3.responseData.translatedText).trim();
        }
      }
    } catch (e) {}

    return cleanInput;
  }
