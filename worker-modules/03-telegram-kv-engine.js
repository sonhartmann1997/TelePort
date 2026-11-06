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
    await kvStageWrite(env, "TG_ANTI_SPAM_STATE_JSON", snapshot, {
      bindingName: "MY_KV",
      expirationTtl: 7 * 86400,
      periodicOnly: true
    });
  }

  async function hydrateAntiSpamStateFromStorage(env) {
    if (antiSpamState.hydratedFromStorage) return;
    antiSpamState.hydratedFromStorage = true;
    try {
      const raw = await kvCachedGetRaw(env, "TG_ANTI_SPAM_STATE_JSON", "MY_KV");
      if (raw) {
        const parsed = JSON.parse(raw);
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

  function normalizeWorkerRetentionDays(val) {
    const n = Number(val);
    return (n === 7 || n === 30 || n === 90) ? n : 30;
  }

  async function getWorkerRetentionDays(env, fallbackFromSettings) {
    if (fallbackFromSettings && (Number(fallbackFromSettings) === 7 || Number(fallbackFromSettings) === 30 || Number(fallbackFromSettings) === 90)) {
      return Number(fallbackFromSettings);
    }
    if (memoryFallback.has("TG_LOG_RETENTION_DAYS")) {
      return normalizeWorkerRetentionDays(memoryFallback.get("TG_LOG_RETENTION_DAYS"));
    }
    try {
      const raw = await kvCachedGetRaw(env, "TG_LOG_RETENTION_DAYS", "MY_KV");
      if (raw) {
        const norm = normalizeWorkerRetentionDays(raw);
        memoryFallback.set("TG_LOG_RETENTION_DAYS", norm);
        return norm;
      }
    } catch (e) {}
    memoryFallback.set("TG_LOG_RETENTION_DAYS", 30);
    return 30;
  }

  async function recordAndPruneWorkerActivityLog(env, newEntry = null, retentionDaysOverride = null) {
    const retentionDays = retentionDaysOverride
      ? normalizeWorkerRetentionDays(retentionDaysOverride)
      : await getWorkerRetentionDays(env, null);
    const ttlSeconds = retentionDays * 86400;
    const cutoffMs = Date.now() - (retentionDays * 86400 * 1000);

    let rawList = [];
    const memList = memoryFallback.get("TG_ACTIVITY_LOG_JSON");
    if (Array.isArray(memList)) {
      rawList = memList;
    } else {
      try {
        const str = await kvCachedGetRaw(env, "TG_ACTIVITY_LOG_JSON", "MY_KV");
        if (str) {
          const parsed = JSON.parse(str);
          if (Array.isArray(parsed)) rawList = parsed;
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
    memoryFallback.set("TG_LOG_RETENTION_DAYS", retentionDays);

    if (newEntry || retentionDaysOverride !== null || prunedCount > 0) {
      await kvStageWrite(env, "TG_ACTIVITY_LOG_JSON", finalEntries, {
        bindingName: "MY_KV",
        expirationTtl: ttlSeconds,
        periodicOnly: retentionDaysOverride === null
      });
      if (retentionDaysOverride !== null) {
        await kvStageWrite(env, "TG_LOG_RETENTION_DAYS", String(retentionDays), {
          bindingName: "MY_KV",
          periodicOnly: false
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

      for (const job of dueJobs) {
        job.status = "sending";
        job.attempts = (job.attempts || 0) + 1;
        const startMs = Date.now();
        let deliveredOk = false;
        let simulated = false;
        let errorMsg = "";

        try {
          const effectiveToken = job.customBotToken || (env && env.TELEGRAM_BOT_TOKEN) || "";
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

  // @ANCHOR: TELEGRAM_API
  // --- Telegram API Client (Nutzt stabiles HTML-Parsing gegen kaputte Links + 429 Anti-Spam Schutz!) ---
  function tgApi(env) {
    const TELEGRAM_API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

    return {
      async answerInlineQuery(inlineQueryId, results, options = {}) {
        try {
          trackStat("telegramCalls");
          const safeResults = (results || []).map(r => {
            const rawMsg = r.input_message_content?.message_text || "";
            const alreadyHtml = /<\/?(?:b|i|code|pre|a)\b/i.test(rawMsg);
            return {
              ...r,
              input_message_content: r.input_message_content
                ? {
                    ...r.input_message_content,
                    message_text: alreadyHtml ? rawMsg : mdToHtml(rawMsg),
                    parse_mode: "HTML"
                  }
                : r.input_message_content,
              reply_markup: r.reply_markup ? sanitizeReplyMarkup(r.reply_markup) : undefined
            };
          });
          const body = { inline_query_id: inlineQueryId, results: safeResults, cache_time: 15, ...options };
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

      async sendMessage(chatId, text, options = {}) {
        try {
          trackStat("telegramCalls");
          const { _fromAntiSpamQueue, ...cleanOptions } = options || {};
          recordActualTelegramSendSlot(chatId);
          const safeMarkup = cleanOptions.reply_markup ? sanitizeReplyMarkup(cleanOptions.reply_markup) : undefined;
          const htmlText = mdToHtml(text);
          const body = {
            chat_id: chatId,
            text: htmlText,
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...cleanOptions,
            reply_markup: safeMarkup
          };
          let res = await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

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
                method: "sendMessage",
                reasonCode: "flood_429",
                reason: `Telegram 429 retry_after (${retrySec}s)`,
                scheduledAt: Date.now() + (retrySec + 1) * 1000
              });
            }
            return { ok: false, _throttled429: true, retryAfter: retrySec };
          }

          if (!res.ok) {
            const plainText = unescapeMdChars(String(text || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")).replace(/[*_`]/g, "");
            const plainBody = { ...body, text: plainText, parse_mode: undefined, reply_markup: safeMarkup };
            res = await fetch(`${TELEGRAM_API}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(plainBody),
            });
          }
          return res.ok ? await res.json() : null;
        } catch (e) {
          return null;
        }
      },

      async sendPhoto(chatId, photoUrl, caption, options = {}) {
        try {
          trackStat("telegramCalls");
          const safeMarkup = options.reply_markup ? sanitizeReplyMarkup(options.reply_markup) : undefined;
          const htmlCaption = mdToHtml(caption || "");
          const body = {
            chat_id: chatId,
            photo: photoUrl,
            caption: htmlCaption,
            parse_mode: "HTML",
            ...options,
            reply_markup: safeMarkup
          };
          let res = await fetch(`${TELEGRAM_API}/sendPhoto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const plainCaption = unescapeMdChars(
              (caption || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            ).replace(/[*_`]/g, "");
            const fallbackBody = {
              ...body,
              caption: plainCaption.length > 1020 ? plainCaption.slice(0, 1017) + "…" : plainCaption,
              parse_mode: undefined,
              reply_markup: safeMarkup
            };
            res = await fetch(`${TELEGRAM_API}/sendPhoto`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(fallbackBody),
            });
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
          let res = await fetch(`${TELEGRAM_API}/editMessageReplyMarkup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          return res.ok ? await res.json() : null;
        } catch (e) {
          return null;
        }
      },

      async editInlineMessageText(inlineMessageId, text, options = {}) {
        try {
          trackStat("telegramCalls");
          const safeMarkup = options.reply_markup ? sanitizeReplyMarkup(options.reply_markup) : undefined;
          const body = {
            inline_message_id: inlineMessageId,
            text: mdToHtml(text),
            parse_mode: "HTML",
            ...options,
            reply_markup: safeMarkup
          };
          let res = await fetch(`${TELEGRAM_API}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          return res.ok ? await res.json() : null;
        } catch (e) {
          return null;
        }
      },

      async editMessageText(chatId, messageId, text, options = {}) {
        try {
          trackStat("telegramCalls");
          const safeMarkup = options.reply_markup ? sanitizeReplyMarkup(options.reply_markup) : undefined;
          const body = {
            chat_id: chatId,
            message_id: messageId,
            text: mdToHtml(text),
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...options,
            reply_markup: safeMarkup
          };
          let res = await fetch(`${TELEGRAM_API}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const errJson = await res.clone().json().catch(() => null);
            const errDesc = String(errJson?.description || "").toLowerCase();
            // WICHTIG: Wenn sich der Nachrichtentext/Markup nicht geändert hat (z.B. erneuter Klick auf denselben Button),
            // NIEMALS den Plain-Text-Fallback ausführen, da sonst alle Markdown-Links verschwinden!
            if (errDesc.includes("message is not modified")) {
              return { ok: true, notModified: true };
            }
            const plainText = unescapeMdChars(String(text || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")).replace(/[*_`]/g, "");
            const fallbackBody = {
              ...body,
              text: plainText,
              parse_mode: undefined,
              reply_markup: safeMarkup
            };
            res = await fetch(`${TELEGRAM_API}/editMessageText`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(fallbackBody),
            });
          }
          return res.ok ? await res.json() : null;
        } catch (e) {
          return null;
        }
      },

      async answerCallbackQuery(callbackQueryId, text = "", showAlert = false) {
        if (!callbackQueryId) return;
        try {
          trackStat("telegramCalls");
          const body = { callback_query_id: callbackQueryId, text, show_alert: showAlert };
          await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch (e) {}
      },

      async deleteMessage(chatId, messageId) {
        if (!messageId) return;
        try {
          trackStat("telegramCalls");
          const body = { chat_id: chatId, message_id: messageId };
          await fetch(`${TELEGRAM_API}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch (e) {}
      },

      async getBotUsername(env) {
        if (env.BOT_USERNAME) return String(env.BOT_USERNAME).replace(/^@/, "");
        if (memoryFallback.has("bot_username")) return memoryFallback.get("bot_username");
        try {
          trackStat("telegramCalls");
          const res = await fetch(`${TELEGRAM_API}/getMe`);
          if (res.ok) {
            const data = await res.json();
            if (data.result && data.result.username) {
              memoryFallback.set("bot_username", data.result.username);
              return data.result.username;
            }
          }
        } catch (e) {}
        return "";
      },

      async getFileText(fileId) {
        if (!fileId) return null;
        try {
          trackStat("telegramCalls");
          const res = await fetchWithTimeout(`${TELEGRAM_API}/getFile?file_id=${encodeURIComponent(fileId)}`, {}, 4000);
          if (!res.ok) return null;
          const data = await res.json();
          const filePath = data?.result?.file_path;
          if (!filePath) return null;
          const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
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

      async deliverMediaOrCopyFromSource(targetChatId, fileIdOrExportRef, caption = "", extraOpts = {}) {
        if (!targetChatId || !fileIdOrExportRef) return null;
        try {
          trackStat("telegramCalls");
          const customToken = String(extraOpts.customBotToken || "").trim();
          const apiBase = (customToken && /^\d+:[A-Za-z0-9_-]{20,}$/.test(customToken))
            ? `https://api.telegram.org/bot${customToken}`
            : TELEGRAM_API;
          const htmlCaption = mdToHtml(caption || "");
          const threadId = extraOpts.messageThreadId && /^\d+$/.test(String(extraOpts.messageThreadId).trim())
            ? parseInt(String(extraOpts.messageThreadId).trim(), 10)
            : undefined;

          // 1. Prüfe auf Quellgruppen-Referenz aus Telegram Desktop Chat-Backup (tg_export_<channelId>_<msgId>)
          const exportMatch = String(fileIdOrExportRef).trim().match(/^tg_export_(-?\d+)_(\d+)$/i);
          if (exportMatch) {
            const rawChannelId = exportMatch[1];
            const sourceMsgId = parseInt(exportMatch[2], 10);
            const overrideBridge = String(extraOpts.sourceBridgeChatId || env.SOURCE_GROUP_CHAT_ID || "").trim();
            const fromChatId = overrideBridge || (rawChannelId.startsWith("-100") || rawChannelId.startsWith("-") ? rawChannelId : `-100${rawChannelId}`);

            // Versuch A: Falls File-ID Harvesting gewünscht und Bot im Zielchat senden darf, kopiere Nachricht sauber per copyMessage
            const copyPayload = {
              chat_id: targetChatId,
              from_chat_id: fromChatId,
              message_id: sourceMsgId,
              caption: htmlCaption,
              parse_mode: "HTML"
            };
            if (threadId) copyPayload.message_thread_id = threadId;

            let copyRes = await fetch(`${apiBase}/copyMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(copyPayload)
            });

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
              copyRes = await fetch(`${apiBase}/copyMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(fallbackCopyPayload)
              });
            }

            if (copyRes.ok) {
              const copyData = await copyRes.json().catch(() => ({ ok: true }));
              let harvestedFileId = null;

              // Optionales File-ID Harvesting: Wenn der Bot die Nachricht kurz über forwardMessage (oder falls copyData ein Video-Objekt enthält) inspizieren kann
              const videoInRes = copyData?.result?.video || copyData?.result?.document;
              if (videoInRes && videoInRes.file_id) {
                harvestedFileId = videoInRes.file_id;
                await replaceExportFileIdInD1(env, String(fileIdOrExportRef).trim(), harvestedFileId, videoInRes.file_unique_id || null);
              } else if (extraOpts.harvestViaForward && env.HARVEST_CACHE_CHAT_ID) {
                try {
                  const fwdRes = await fetch(`${apiBase}/forwardMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      chat_id: env.HARVEST_CACHE_CHAT_ID,
                      from_chat_id: fromChatId,
                      message_id: sourceMsgId,
                      disable_notification: true
                    })
                  });
                  if (fwdRes.ok) {
                    const fwdJson = await fwdRes.json();
                    const mediaObj = fwdJson?.result?.video || fwdJson?.result?.document;
                    if (mediaObj?.file_id) {
                      harvestedFileId = mediaObj.file_id;
                      await replaceExportFileIdInD1(env, String(fileIdOrExportRef).trim(), harvestedFileId, mediaObj.file_unique_id || null);
                    }
                  }
                } catch (e) {}
              }

              return {
                ok: true,
                copiedFromSourceGroup: true,
                fromChatId,
                sourceMessageId: sourceMsgId,
                harvestedFileId,
                result: copyData?.result || { message_id: Date.now() }
              };
            }
            return null;
          }

          // 2. Regulärer Versand per echter telegram_file_id (sendVideo mit Fallback auf sendDocument)
          recordActualTelegramSendSlot(targetChatId);
          const videoBody = {
            chat_id: targetChatId,
            video: fileIdOrExportRef,
            caption: htmlCaption,
            parse_mode: "HTML",
            supports_streaming: true
          };
          if (threadId) videoBody.message_thread_id = threadId;

          let res = await fetch(`${apiBase}/sendVideo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(videoBody)
          });
          if (res.status === 429) {
            const err429 = await res.json().catch(() => ({}));
            const retrySec = Number(err429?.parameters?.retry_after) || 5;
            registerAntiSpam429FloodWait(retrySec, targetChatId);
            return null;
          }
          if (!res.ok) {
            const docBody = {
              chat_id: targetChatId,
              document: fileIdOrExportRef,
              caption: htmlCaption,
              parse_mode: "HTML"
            };
            if (threadId) docBody.message_thread_id = threadId;
            res = await fetch(`${apiBase}/sendDocument`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(docBody)
            });
            if (res.status === 429) {
              const err429Doc = await res.json().catch(() => ({}));
              registerAntiSpam429FloodWait(Number(err429Doc?.parameters?.retry_after) || 5, targetChatId);
              return null;
            }
          }
          return res.ok ? await res.json() : null;
        } catch (e) {
          return null;
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
    const nextSig = JSON.stringify({
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
    const deferKv = Boolean(options?.deferKvWrite);
    await kvStageWrite(env, `u_bundle_${chatId}`, payloadToPersist, {
      bindingName: "MOVIE_SAVED",
      periodicOnly: deferKv && !forceKv,
      forceKvWrite: forceKv,
      flushNow: Boolean(options?.flushNow)
    });
  }

  async function getUserBundle(env, chatId) {
    const cleanId = String(chatId || "guest");
    const bundleKey = `u_bundle_${cleanId}`;
    if (memoryFallback.has(bundleKey)) {
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
          return hydrated;
        }
      }
    } catch (e) {}

    // Automatische Lazy-Migration bestehender Legacy-KV-Keys (1-malig beim ersten Laden)
    let migratedFromLegacy = false;
    let savedList = [];
    let folders = [];
    let settings = { ...DEFAULT_USER_SETTINGS_TEMPLATE };
    let session = {};

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

  async function getSavedList(env, chatId) {
    const bundle = await getUserBundle(env, chatId);
    bundle.savedList = normalizeSavedItems(bundle.savedList);
    memoryFallback.set(`user_${chatId}`, bundle.savedList);
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
    const bundle = await getUserBundle(env, chatId);
    bundle.savedList = Array.isArray(list) ? list : [];
    await stageUserBundleWrite(env, chatId, bundle, options);
  }

  async function getFolders(env, chatId) {
    const bundle = await getUserBundle(env, chatId);
    return Array.isArray(bundle.folders) ? bundle.folders : [];
  }

  async function saveFolders(env, chatId, folders, options = {}) {
    const bundle = await getUserBundle(env, chatId);
    bundle.folders = Array.isArray(folders) ? folders : [];
    await stageUserBundleWrite(env, chatId, bundle, options);
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
    const folders = await getFolders(env, chatId);
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
          await saveFolders(env, chatId, folders, { deferKvWrite: Boolean(extraProps.deferKvWrite) });
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
    await saveFolders(env, chatId, folders);
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
    if (memoryFallback.has(key)) {
      const mem = memoryFallback.get(key);
      if (Array.isArray(mem)) return new Set(mem);
    }
    try {
      const raw = await kvCachedGetRaw(env, key, "MOVIE_SAVED");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          memoryFallback.set(key, parsed);
          return new Set(parsed);
        }
      }
    } catch (e) {}
    memoryFallback.set(key, []);
    return new Set();
  }

  async function saveBotVipHiddenKeys(env, keySet) {
    const key = "bot_vip_hidden_keys";
    const arr = Array.from(keySet || []);
    memoryFallback.set(key, arr);
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
      const sNum = Math.max(1, Number(ep.season || ep.season_number || 1));
      const eNum = Math.max(1, Number(ep.episode || ep.episode_number || 1));
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

  async function getAllSeriesEpisodesMapFromD1(env) {
    const epMap = new Map();
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        const res = await db.prepare(
          `SELECT ef.series_id, ef.season_number, ef.episode_number, ef.quality, ef.codec, ef.telegram_file_id, ef.file_size, ef.tags,
                  se.title AS episode_title
           FROM episode_files ef
           LEFT JOIN series_episodes se
             ON se.series_id = ef.series_id AND se.season_number = ef.season_number AND se.episode_number = ef.episode_number
           ORDER BY ef.series_id ASC, ef.season_number ASC, ef.episode_number ASC, ef.updated_at DESC`
        ).all().catch(() => ({ results: [] }));
        for (const r of (res?.results || [])) {
          const sid = Number(r.series_id);
          if (!sid) continue;
          const prevList = epMap.get(sid) || [];
          prevList.push({
            season: Number(r.season_number || 1),
            episode: Number(r.episode_number || 1),
            title: r.episode_title || `Folge ${Number(r.episode_number || 1)}`,
            quality: r.quality || "1080p",
            codec: r.codec || "x264",
            fileId: r.telegram_file_id || null,
            fileSize: r.file_size || null,
            tags: r.tags || ""
          });
          epMap.set(sid, prevList);
        }
      } catch (e) {}
    }

    for (const [k, v] of memoryFallback.entries()) {
      if (k.startsWith("d1_ep_files_") && Array.isArray(v)) {
        for (const r of v) {
          const sid = Number(r?.series_id);
          if (!sid) continue;
          const prevList = epMap.get(sid) || [];
          prevList.push({
            season: Number(r.season_number || 1),
            episode: Number(r.episode_number || 1),
            title: r.episode_title || r.title || `Folge ${Number(r.episode_number || 1)}`,
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

  async function backfillMediaPosterInLists(env, typeCode, tmdbId, posterPathOrUrl, fallbackUrl = "", targetChatId = null) {
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
          if (itemMatches && (!item.poster || String(item.poster).includes("placeholder"))) {
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
    let epMap = memoryFallback.get("d1_all_series_ep_map_cache");
    const epMapTs = Number(memoryFallback.get("d1_all_series_ep_map_cache_ts") || 0);
    if (!(epMap instanceof Map) || (now - epMapTs) > 90000) {
      epMap = await getAllSeriesEpisodesMapFromD1(env);
      memoryFallback.set("d1_all_series_ep_map_cache", epMap);
      memoryFallback.set("d1_all_series_ep_map_cache_ts", now);
    }

    // Map aus D1 movies & series für fehlende Poster (3 Minuten im RAM gecacht, spart 1.000 D1-Reads pro Admin-Tab-Klick)
    let posterLookup = memoryFallback.get("d1_poster_lookup_cache");
    const posterLookupTs = Number(memoryFallback.get("d1_poster_lookup_cache_ts") || 0);
    if (!(posterLookup instanceof Map) || (now - posterLookupTs) > 180000) {
      posterLookup = new Map();
      const db = await ensureD1Schema(env);
      if (db) {
        try {
          const [mRows, sRows] = await Promise.all([
            db.prepare("SELECT tmdb_id, poster_path, details_json FROM movies LIMIT 500").all().catch(() => ({ results: [] })),
            db.prepare("SELECT tmdb_id, poster_path, details_json FROM series LIMIT 500").all().catch(() => ({ results: [] }))
          ]);
          for (const r of (mRows?.results || [])) {
            let ext = "";
            if (!r.poster_path && r.details_json) {
              try { ext = JSON.parse(r.details_json)?.external_poster_url || ""; } catch (e) {}
            }
            const p = resolvePosterUrl(r.poster_path, "w185", ext);
            if (p) posterLookup.set(`m_${Number(r.tmdb_id)}`, p);
          }
          for (const r of (sRows?.results || [])) {
            let ext = "";
            if (!r.poster_path && r.details_json) {
              try { ext = JSON.parse(r.details_json)?.external_poster_url || ""; } catch (e) {}
            }
            const p = resolvePosterUrl(r.poster_path, "w185", ext);
            if (p) posterLookup.set(`s_${Number(r.tmdb_id)}`, p);
          }
          memoryFallback.set("d1_poster_lookup_cache", posterLookup);
          memoryFallback.set("d1_poster_lookup_cache_ts", now);
        } catch (e) {}
      }
    }

    for (const item of list) {
      if (!item) continue;
      const isSer = item.contentType === "series" || item.contentType === "episode";
      const tid = Number(item.contentType === "episode" ? item.seriesId : item.tmdbId);
      if (!tid) continue;
      const mapKey = `${isSer ? "s" : "m"}_${tid}`;

      if (!item.poster) {
        const memObj = getCachedTmdb(isSer ? `tv_${tid}` : `movie_${tid}`) ||
                       memoryFallback.get(isSer ? `d1_catalog_series_${tid}` : `d1_catalog_movie_${tid}`);
        const foundPoster = posterLookup.get(mapKey) ||
                            (memObj ? resolvePosterUrl(memObj.poster_path, "w185", memObj.external_poster_url || memObj.poster || "") : "");
        if (foundPoster) {
          item.poster = foundPoster;
          changed = true;
        }
      } else if (String(item.poster).startsWith("/")) {
        item.poster = resolvePosterUrl(item.poster, "w185");
        changed = true;
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

    // Automatische Bereinigung: Komplett leere Serien (0 gültige Episoden mit verknüpfter Videodatei) aus allen Listen filtern
    const validFilteredList = list.filter(item => {
      if (!item) return false;
      if (item.contentType === "series") {
        const validEps = (item.episodes || []).filter(ep =>
          Boolean(ep && (ep.fileId || ep.file_id || ep.telegram_file_id || ep.message_id || ep.versions?.length))
        );
        return validEps.length > 0;
      }
      return true;
    });
    if (validFilteredList.length !== list.length) {
      changed = true;
    }

    if (changed && chatId && chatId !== "guest") {
      await saveRawList(env, chatId, validFilteredList);
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

    for (const [mapKey, d1Item] of sliceEntries) {
      if (existingKeySet.has(mapKey)) continue;
      if (hiddenSet.has(mapKey)) continue;
      list.push({
        uid: `${d1Item.prefix}_${d1Item.tmdbId}_${mainFolder.id}`,
        tmdbId: d1Item.tmdbId,
        contentType: d1Item.contentType,
        category: d1Item.contentType,
        title: d1Item.title,
        year: d1Item.year,
        fsk: d1Item.fsk,
        genres: d1Item.genres,
        poster: d1Item.poster,
        quality: d1Item.quality,
        allQualities: d1Item.allQualities,
        streamCount: d1Item.streamCount,
        episodes: d1Item.contentType === "series" ? (d1Item.episodes || []) : undefined,
        syncedFromD1: true,
        playlistMode: "vip_stream",
        folderId: mainFolder.id,
        addedAt: d1Item.updatedAt || Date.now()
      });
      existingKeySet.add(mapKey);
      syncedAddedCount++;
      changed = true;
    }

    if (changed) {
      await saveRawList(env, "bot_vip", list);
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
    await saveRawList(env, chatId, list);
    folders = folders.filter(f => String(f.id) !== String(folderId));
    await saveFolders(env, chatId, folders);
    return { ok: true, deletedFolderName: target.name, removedItemsCount };
  }

  async function batchSaveIngestedItemsToPlaylist(env, chatId, folderId, resolvedResults, playlistMode = "both") {
    if (!chatId || chatId === "guest" || !folderId || !Array.isArray(resolvedResults) || resolvedResults.length === 0) {
      return 0;
    }
    const modeStr = typeof playlistMode === "object" && playlistMode !== null
      ? String(playlistMode.playlistMode || "both")
      : String(playlistMode || "both");
    const deferKvWrite = Boolean(typeof playlistMode === "object" && playlistMode !== null && playlistMode.deferKvWrite);
    try {
      let list = await getSavedList(env, chatId);
      let addedCount = 0;
      let changedAny = false;
      for (const res of resolvedResults) {
        if (!res || !res.tmdbId) continue;
        const contentType = res.typeCode === "s" ? "series" : "movie";
        const prefix = res.typeCode === "s" ? "s" : "m";
        const d = res.details || {};
        const rawDate = d.releaseDate && d.releaseDate !== "Keine Angabe"
          ? d.releaseDate
          : (d.release_date || d.first_air_date || "");
        const year = res.year || (rawDate.split("-")[0]) || "K. A.";
        const cleanTitle = (res.cleanTitle || d.title || d.name || `Titel #${res.tmdbId}`).replace(/\s*\(\d{4}\)$/, "").trim();
        const posterUrl = resolvePosterUrl(res.poster || d.poster_path, "w185", d.external_poster_url || "");

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

        const existingItem = list.find(
          i => String(i.folderId || "") === String(folderId) &&
               String(i.tmdbId) === String(res.tmdbId) &&
               i.contentType === contentType
        );
        if (existingItem) {
          if (!existingItem.poster && posterUrl) {
            existingItem.poster = posterUrl;
            changedAny = true;
          }
          if (contentType === "series" && epEntry) {
            existingItem.episodes = mergeAndSortEpisodeEntries(existingItem.episodes || [], [epEntry]);
            existingItem.streamCount = existingItem.episodes.length;
            const quals = new Set(String(existingItem.allQualities || existingItem.quality || "1080p").split(",").map(s => s.trim()).filter(Boolean));
            if (res.quality) quals.add(String(res.quality));
            existingItem.allQualities = Array.from(quals).join(", ");
            changedAny = true;
          } else if (contentType === "movie") {
            existingItem.streamCount = Math.max(1, Number(existingItem.streamCount || 1) + (res.ingestStatus === "merged_quality" ? 1 : 0));
            const quals = new Set(String(existingItem.allQualities || existingItem.quality || "1080p").split(",").map(s => s.trim()).filter(Boolean));
            if (res.quality) quals.add(String(res.quality));
            existingItem.allQualities = Array.from(quals).join(", ");
            changedAny = true;
          }
          continue;
        }

        list.push({
          uid: `${prefix}_${res.tmdbId}_${folderId}`,
          tmdbId: res.tmdbId,
          contentType,
          category: contentType,
          title: cleanTitle,
          year,
          fsk: d.fsk || "K. A.",
          genres: d.genres || (contentType === "series" ? "Serie" : "Film"),
          poster: posterUrl,
          quality: res.quality || "1080p",
          allQualities: res.quality || "1080p",
          streamCount: 1,
          episodes: contentType === "series" && epEntry ? [epEntry] : undefined,
          metadataSource: res.metadataSource || d.metadata_source || "TMDb",
          playlistMode: modeStr,
          folderId,
          addedAt: Date.now()
        });
        addedCount++;
        changedAny = true;
      }
      if (changedAny) {
        await saveRawList(env, chatId, list, { deferKvWrite });
      }
      return addedCount;
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
        list.push({
          ...itemObj,
          uid,
          folderId: targetFolder,
          addedAt: Date.now()
        });
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
      // Wenn eine Serie aus der Merkliste gelöscht wird, auch alle gemerkten Episoden dieser Serie löschen
      if (removedItem && removedItem.contentType === "series" && removedItem.tmdbId) {
        const sId = String(removedItem.tmdbId);
        list = list.filter(i => {
          if (i.contentType === "episode" && String(i.seriesId) === sId) return false;
          if (i.contentType === "series" && String(i.tmdbId) === sId) return false;
          return true;
        });
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
    const bundle = await getUserBundle(env, chatId);
    const sess = bundle.session || memoryFallback.get(`sess_${chatId}`);
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

  async function saveSearchState(env, chatId, query, page, totalResults = 0, movieCount = 0, seriesCount = 0, sortBy = null, ignoreFilters = null) {
    const sess = await getUserSession(env, chatId);
    const prev = sess.searchState || null;
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
    sess.searchState = obj;
    sess._dirty = true;
    memoryFallback.set(`search_state_${chatId}`, obj);
  }

  async function getSearchState(env, chatId) {
    const sess = await getUserSession(env, chatId);
    return sess.searchState || memoryFallback.get(`search_state_${chatId}`) || null;
  }

  async function setUserPromptState(env, chatId, msgId, mode = "search", meta = {}) {
    const sess = await getUserSession(env, chatId);
    sess.promptState = { msgId: Number(msgId) || null, mode, meta };
    sess._dirty = true;
  }

  async function getUserPromptState(env, chatId) {
    const sess = await getUserSession(env, chatId);
    return sess.promptState || null;
  }

  async function clearUserPromptState(env, chatId) {
    const sess = await getUserSession(env, chatId);
    if (sess.promptState) {
      delete sess.promptState;
      sess._dirty = true;
    }
  }

  async function trackTempMessage(env, chatId, msgId) {
    if (!chatId || !msgId) return;
    const sess = await getUserSession(env, chatId);
    const list = Array.isArray(sess.tempMsgIds) ? sess.tempMsgIds : [];
    const numId = Number(msgId);
    if (numId && !list.includes(numId)) {
      list.push(numId);
      if (list.length > 25) list.splice(0, list.length - 25);
      sess.tempMsgIds = list;
      sess._dirty = true;
    }
  }

  async function untrackTempMessage(env, chatId, msgId) {
    if (!chatId || !msgId) return;
    const sess = await getUserSession(env, chatId);
    if (Array.isArray(sess.tempMsgIds)) {
      sess.tempMsgIds = sess.tempMsgIds.filter(id => Number(id) !== Number(msgId));
      sess._dirty = true;
    }
  }

  async function clearAllTempMessages(env, chatId, deleteMessageFn, keepMsgId = null) {
    const sess = await getUserSession(env, chatId);
    const ids = Array.isArray(sess.tempMsgIds) ? [...sess.tempMsgIds] : [];
    sess.tempMsgIds = keepMsgId ? [Number(keepMsgId)] : [];
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
    sess.activeMenu = Number(msgId) || null;
    sess._dirty = true;
    if (msgId) await trackTempMessage(env, chatId, msgId);
  }

  async function getActiveMenu(env, chatId) {
    const sess = await getUserSession(env, chatId);
    return sess.activeMenu || null;
  }

  async function clearActiveMenu(env, chatId) {
    const sess = await getUserSession(env, chatId);
    if (sess.activeMenu) {
      await untrackTempMessage(env, chatId, sess.activeMenu);
      delete sess.activeMenu;
      sess._dirty = true;
    }
  }

  async function setExtraMessage(env, chatId, msgId) {
    const sess = await getUserSession(env, chatId);
    sess.extraMsg = Number(msgId) || null;
    sess._dirty = true;
    if (msgId) await trackTempMessage(env, chatId, msgId);
  }

  async function clearExtraMessage(env, chatId, deleteMessageFn) {
    const sess = await getUserSession(env, chatId);
    const val = sess.extraMsg;
    if (val) {
      delete sess.extraMsg;
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
