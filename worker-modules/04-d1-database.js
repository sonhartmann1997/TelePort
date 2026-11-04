  // @DEPARTMENT: 04-d1-database | 4. Cloudflare D1 Datenbank (Filme, Serien & Logs)
  // @ANCHOR: D1_MOVIES
  // ============================================================================
  // CLOUDFLARE D1 (SQLite) PERSISTENTE FILMDATENBANK ZUR API-MINIMIERUNG
  // Speichert jeden gesuchten/abgerufenen Film, jede Serie, Staffeln, Kollektionen,
  // Personen und Suchanfragen dauerhaft in SQLite (env.DB oder env.MOVIE_DB).
  // ============================================================================
  let d1SchemaInitialized = false;
  let d1SchemaInitPromise = null;
  const D1_MOVIE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage gültig für Film-/Serien-Details
  const D1_SEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage gültig für Suchseiten & Listen

  function getD1Binding(env) {
    if (!env) return null;
    return env.DB || env.MOVIE_DB || null;
  }

  async function ensureD1Schema(env) {
    const db = getD1Binding(env);
    if (!db || d1SchemaInitialized) return db;
    if (d1SchemaInitPromise) {
      await d1SchemaInitPromise;
      return db;
    }
    d1SchemaInitPromise = (async () => {
      try {
        await db.batch([
          db.prepare(`CREATE TABLE IF NOT EXISTS movies (
            tmdb_id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            release_date TEXT,
            release_year INTEGER,
            fsk TEXT,
            vote_average REAL DEFAULT 0,
            runtime TEXT,
            country TEXT,
            genres TEXT,
            directors TEXT,
            casts TEXT,
            overview TEXT,
            is_english_fallback INTEGER DEFAULT 0,
            providers TEXT,
            poster_path TEXT,
            backdrop_path TEXT,
            trailer_key TEXT,
            collection_id INTEGER,
            collection_name TEXT,
            telegraph_url TEXT,
            details_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS series (
            tmdb_id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            release_date TEXT,
            release_year INTEGER,
            fsk TEXT,
            status_text TEXT,
            vote_average REAL DEFAULT 0,
            runtime TEXT,
            country TEXT,
            genres TEXT,
            directors TEXT,
            casts TEXT,
            overview TEXT,
            is_english_fallback INTEGER DEFAULT 0,
            providers TEXT,
            poster_path TEXT,
            backdrop_path TEXT,
            trailer_key TEXT,
            number_of_seasons INTEGER DEFAULT 1,
            number_of_episodes INTEGER DEFAULT 0,
            telegraph_url TEXT,
            details_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS series_seasons (
            series_id INTEGER NOT NULL,
            season_number INTEGER NOT NULL,
            name TEXT,
            telegraph_url TEXT,
            episodes_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (series_id, season_number)
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS series_episodes (
            series_id INTEGER NOT NULL,
            season_number INTEGER NOT NULL,
            episode_number INTEGER NOT NULL,
            title TEXT,
            overview TEXT,
            air_date TEXT,
            runtime TEXT,
            vote_average REAL DEFAULT 0,
            telegraph_url TEXT,
            versions_json TEXT DEFAULT '[]',
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (series_id, season_number, episode_number)
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS search_cache (
            cache_key TEXT PRIMARY KEY,
            query TEXT NOT NULL,
            page INTEGER DEFAULT 1,
            response_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS entity_cache (
            cache_key TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            data_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS movie_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            movie_id INTEGER NOT NULL,
            telegram_file_id TEXT NOT NULL,
            telegram_unique_id TEXT,
            quality TEXT DEFAULT '1080p',
            codec TEXT DEFAULT 'x264',
            part TEXT,
            tags TEXT,
            file_size INTEGER,
            mime_type TEXT,
            raw_filename TEXT,
            raw_caption TEXT,
            message_link TEXT,
            subtitles_json TEXT DEFAULT '[]',
            updated_at INTEGER NOT NULL,
            UNIQUE(movie_id, telegram_file_id)
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS episode_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            series_id INTEGER NOT NULL,
            season_number INTEGER NOT NULL,
            episode_number INTEGER NOT NULL,
            telegram_file_id TEXT NOT NULL,
            telegram_unique_id TEXT,
            quality TEXT DEFAULT '1080p',
            codec TEXT DEFAULT 'x264',
            part TEXT,
            tags TEXT,
            version_label TEXT DEFAULT 'Originalfassung',
            file_size INTEGER,
            mime_type TEXT,
            raw_filename TEXT,
            raw_caption TEXT,
            message_link TEXT,
            subtitles_json TEXT DEFAULT '[]',
            updated_at INTEGER NOT NULL,
            UNIQUE(series_id, season_number, episode_number, telegram_file_id)
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS users (
            telegram_id TEXT PRIMARY KEY,
            tg_username TEXT,
            first_name TEXT,
            custom_username TEXT UNIQUE,
            password_hash TEXT,
            password_salt TEXT,
            totp_secret TEXT,
            totp_enabled INTEGER DEFAULT 0,
            is_vip INTEGER DEFAULT 0,
            is_admin INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS import_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_label TEXT,
            entry_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS tg_anti_spam_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT UNIQUE NOT NULL,
            chat_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT DEFAULT 'queued',
            scheduled_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS media_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter_telegram_id TEXT NOT NULL,
            reporter_username TEXT,
            type_code TEXT NOT NULL,
            tmdb_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            season_number INTEGER,
            episode_number INTEGER,
            episode_title TEXT,
            telegram_file_id TEXT,
            version_label TEXT,
            reason_code TEXT NOT NULL,
            reason_label TEXT NOT NULL,
            note TEXT,
            status TEXT DEFAULT 'open',
            resolved_at INTEGER,
            resolved_by TEXT,
            created_at INTEGER NOT NULL
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS import_diagnostic_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            msg_id TEXT,
            stage TEXT NOT NULL,
            status TEXT NOT NULL,
            reason TEXT,
            file_name TEXT,
            text_preview TEXT,
            parsed_title TEXT,
            season INTEGER,
            episode INTEGER,
            tmdb_query TEXT,
            tmdb_result TEXT,
            tmdb_id INTEGER,
            type_code TEXT,
            details_json TEXT,
            created_at INTEGER NOT NULL
          )`)
        ]);
        // Subrequest-sparende Auto-Migration: Prüfe in 1 einziger Abfrage sqlite_master und führe fehlende Spalten gebündelt per db.batch aus
        try {
          const schemaRes = await db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
          const sqlByTable = new Map();
          for (const row of (schemaRes?.results || [])) {
            if (row?.name && row?.sql) sqlByTable.set(String(row.name), String(row.sql));
          }
          const requiredCols = [
            ["movies", "telegraph_url", "ALTER TABLE movies ADD COLUMN telegraph_url TEXT"],
            ["series", "telegraph_url", "ALTER TABLE series ADD COLUMN telegraph_url TEXT"],
            ["series_seasons", "telegraph_url", "ALTER TABLE series_seasons ADD COLUMN telegraph_url TEXT"],
            ["series_episodes", "versions_json", "ALTER TABLE series_episodes ADD COLUMN versions_json TEXT DEFAULT '[]'"],
            ["movie_files", "tags", "ALTER TABLE movie_files ADD COLUMN tags TEXT"],
            ["episode_files", "tags", "ALTER TABLE episode_files ADD COLUMN tags TEXT"],
            ["episode_files", "version_label", "ALTER TABLE episode_files ADD COLUMN version_label TEXT DEFAULT 'Originalfassung'"],
            ["movie_files", "raw_filename", "ALTER TABLE movie_files ADD COLUMN raw_filename TEXT"],
            ["movie_files", "raw_caption", "ALTER TABLE movie_files ADD COLUMN raw_caption TEXT"],
            ["movie_files", "message_link", "ALTER TABLE movie_files ADD COLUMN message_link TEXT"],
            ["movie_files", "subtitles_json", "ALTER TABLE movie_files ADD COLUMN subtitles_json TEXT DEFAULT '[]'"],
            ["episode_files", "raw_filename", "ALTER TABLE episode_files ADD COLUMN raw_filename TEXT"],
            ["episode_files", "raw_caption", "ALTER TABLE episode_files ADD COLUMN raw_caption TEXT"],
            ["episode_files", "message_link", "ALTER TABLE episode_files ADD COLUMN message_link TEXT"],
            ["episode_files", "subtitles_json", "ALTER TABLE episode_files ADD COLUMN subtitles_json TEXT DEFAULT '[]'"]
          ];
          const alterStmts = [];
          for (const [tbl, col, ddl] of requiredCols) {
            const tblSql = sqlByTable.get(tbl) || "";
            if (tblSql && !new RegExp(`\\b${col}\\b`, "i").test(tblSql)) {
              alterStmts.push(db.prepare(ddl));
            }
          }
          if (alterStmts.length > 0) {
            await db.batch(alterStmts);
          }
        } catch (e) {}
        d1SchemaInitialized = true;
      } catch (e) {
        d1SchemaInitialized = true;
      } finally {
        d1SchemaInitPromise = null;
      }
    })();
    await d1SchemaInitPromise;
    return db;
  }

  // Persistentes Diagnose-Log (D1 + Memory-Fallback) für das Admin-Dashboard [ 🛠️ Diagnose-Log ]
  async function saveImportDiagnosticLogsToD1(env, logsArray) {
    if (!Array.isArray(logsArray) || logsArray.length === 0) return;
    const now = Date.now();
    const memKey = "d1_import_diagnostic_logs";
    const existingMem = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];
    const normalizedBatch = logsArray.map((item, idx) => ({
      id: item.id || (now * 100 + idx),
      msgId: item.msgId !== undefined && item.msgId !== null ? String(item.msgId) : "",
      stage: String(item.stage || "IMPORT"),
      status: String(item.status || "OK"),
      reason: String(item.reason || ""),
      fileName: String(item.fileName || ""),
      textPreview: String(item.textPreview || "").slice(0, 260),
      parsedTitle: String(item.parsedTitle || ""),
      season: item.season ? Number(item.season) : null,
      episode: item.episode ? Number(item.episode) : null,
      tmdbQuery: String(item.tmdbQuery || ""),
      tmdbResult: String(item.tmdbResult || ""),
      tmdbId: item.tmdbId ? Number(item.tmdbId) : null,
      typeCode: item.typeCode ? String(item.typeCode) : null,
      details: item.details && typeof item.details === "object" ? item.details : {},
      timestamp: Number(item.timestamp || now)
    }));
    const mergedMem = [...normalizedBatch, ...existingMem].slice(0, 2500);
    memoryFallback.set(memKey, mergedMem);

    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      const chunkSize = 40;
      for (let i = 0; i < normalizedBatch.length; i += chunkSize) {
        const slice = normalizedBatch.slice(i, i + chunkSize);
        const stmts = slice.map(l =>
          db.prepare(`INSERT INTO import_diagnostic_logs (
            msg_id, stage, status, reason, file_name, text_preview, parsed_title,
            season, episode, tmdb_query, tmdb_result, tmdb_id, type_code, details_json, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`).bind(
            l.msgId,
            l.stage,
            l.status,
            l.reason,
            l.fileName,
            l.textPreview,
            l.parsedTitle,
            l.season,
            l.episode,
            l.tmdbQuery,
            l.tmdbResult,
            l.tmdbId,
            l.typeCode,
            JSON.stringify(l.details || {}),
            l.timestamp
          )
        );
        await db.batch(stmts);
      }
    } catch (e) {}
  }

  async function listImportDiagnosticLogsFromD1(env, filterStatus = "ALL", searchQuery = "", limit = 1500) {
    const db = await ensureD1Schema(env);
    let rows = [];
    if (db) {
      try {
        const res = await db
          .prepare("SELECT * FROM import_diagnostic_logs ORDER BY id DESC LIMIT ?1")
          .bind(Math.min(2500, Math.max(50, Number(limit) || 1500)))
          .all();
        if (Array.isArray(res?.results)) {
          rows = res.results.map(r => {
            let details = {};
            try {
              if (r.details_json) details = JSON.parse(r.details_json);
            } catch (e) {}
            return {
              id: r.id,
              msgId: r.msg_id || "",
              stage: r.stage || "IMPORT",
              status: r.status || "OK",
              reason: r.reason || "",
              fileName: r.file_name || "",
              textPreview: r.text_preview || "",
              parsedTitle: r.parsed_title || "",
              season: r.season || null,
              episode: r.episode || null,
              tmdbQuery: r.tmdb_query || "",
              tmdbResult: r.tmdb_result || "",
              tmdbId: r.tmdb_id || null,
              typeCode: r.type_code || null,
              details,
              timestamp: r.created_at || Date.now()
            };
          });
        }
      } catch (e) {}
    }
    if (rows.length === 0) {
      const mem = memoryFallback.get("d1_import_diagnostic_logs");
      if (Array.isArray(mem)) rows = mem;
    }

    const counts = {
      total: rows.length,
      ok: 0,
      skipped: 0,
      notFound: 0,
      conflict: 0,
      pause: 0
    };
    for (const r of rows) {
      const st = String(r.status || "OK");
      if (st === "OK") counts.ok++;
      else if (st.startsWith("SKIPPED_")) counts.skipped++;
      else if (st === "TMDB_NOT_FOUND") counts.notFound++;
      else if (st === "CONFLICT_?" || st === "CONFLICT") counts.conflict++;
      else if (st === "SUBREQUEST_PAUSE" || st === "API_ERROR") counts.pause++;
    }

    let filtered = rows;
    if (filterStatus && filterStatus !== "ALL") {
      if (filterStatus === "PROBLEMS") {
        filtered = filtered.filter(r => r.status !== "OK");
      } else if (filterStatus === "SKIPPED") {
        filtered = filtered.filter(r => String(r.status || "").startsWith("SKIPPED_"));
      } else {
        filtered = filtered.filter(r => r.status === filterStatus);
      }
    }
    const q = String(searchQuery || "").trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(r =>
        String(r.msgId || "").toLowerCase().includes(q) ||
        String(r.fileName || "").toLowerCase().includes(q) ||
        String(r.parsedTitle || "").toLowerCase().includes(q) ||
        String(r.textPreview || "").toLowerCase().includes(q) ||
        String(r.tmdbResult || "").toLowerCase().includes(q) ||
        String(r.reason || "").toLowerCase().includes(q)
      );
    }
    return { logs: filtered.slice(0, 600), counts };
  }

  async function updateImportDiagnosticLogStatusInD1(env, logId, newStatus, newTmdbResult, newTmdbId = null, newTypeCode = null, newSeason = null, newEpisode = null) {
    const memKey = "d1_import_diagnostic_logs";
    const existingMem = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];
    for (const item of existingMem) {
      if (String(item.id) === String(logId) || (item.msgId && String(item.msgId) === String(logId))) {
        item.status = newStatus;
        if (newTmdbResult) item.tmdbResult = newTmdbResult;
        if (newTmdbId) item.tmdbId = Number(newTmdbId);
        if (newTypeCode) item.typeCode = String(newTypeCode);
        if (newSeason) item.season = Number(newSeason);
        if (newEpisode) item.episode = Number(newEpisode);
      }
    }
    memoryFallback.set(memKey, existingMem);

    const db = await ensureD1Schema(env);
    if (!db || !logId) return;
    try {
      await db
        .prepare("UPDATE import_diagnostic_logs SET status = ?1, tmdb_result = COALESCE(?2, tmdb_result), tmdb_id = COALESCE(?3, tmdb_id), type_code = COALESCE(?4, type_code), season = COALESCE(?5, season), episode = COALESCE(?6, episode) WHERE id = ?7 OR msg_id = ?8")
        .bind(String(newStatus), newTmdbResult || null, newTmdbId ? Number(newTmdbId) : null, newTypeCode || null, newSeason ? Number(newSeason) : null, newEpisode ? Number(newEpisode) : null, Number(logId) || -1, String(logId))
        .run();
    } catch (e) {}
  }

  async function clearImportDiagnosticLogsInD1(env) {
    memoryFallback.set("d1_import_diagnostic_logs", []);
    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      await db.prepare("DELETE FROM import_diagnostic_logs").run();
    } catch (e) {}
  }

  // Persistente Warteschlange (D1 + Memory-Fallback) für große JSON- & Telegram-Chat-Backup-Imports (100k+ Einträge)
  async function enqueueImportEntriesInD1(env, entries, sourceLabel = "JSON-Backup") {
    if (!Array.isArray(entries) || entries.length === 0) return { queued: 0, totalPending: 0 };
    const now = Date.now();
    const db = await ensureD1Schema(env);
    let queued = 0;

    if (db) {
      try {
        // D1 Batch-Insert in 80er-Paketen für maximale Performance
        const CHUNK_SIZE = 80;
        for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
          const slice = entries.slice(i, i + CHUNK_SIZE);
          const stmts = slice.map(item =>
            db.prepare("INSERT INTO import_queue (source_label, entry_json, created_at) VALUES (?1, ?2, ?3)")
              .bind(String(sourceLabel || "Backup"), JSON.stringify(item), now)
          );
          trackStat("d1Writes");
          await db.batch(stmts);
          queued += slice.length;
        }
      } catch (e) {}
    }

    if (queued === 0) {
      const memQueue = memoryFallback.get("d1_import_queue") || [];
      let nextId = Number(memoryFallback.get("d1_import_queue_seq") || 1);
      for (const item of entries) {
        memQueue.push({
          id: nextId++,
          source_label: String(sourceLabel || "Backup"),
          entry_json: JSON.stringify(item),
          created_at: now
        });
        queued++;
      }
      memoryFallback.set("d1_import_queue_seq", nextId);
      memoryFallback.set("d1_import_queue", memQueue);
    }

    const stats = await getImportQueueStatsFromD1(env);
    return { queued, totalPending: stats.pendingCount };
  }

  async function getImportQueueStatsFromD1(env) {
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const row = await db.prepare("SELECT COUNT(*) AS cnt, MIN(source_label) AS src FROM import_queue").first();
        const pendingCount = Number(row?.cnt || 0);
        const totalMeta = memoryFallback.get("import_queue_meta") || {};
        return {
          pendingCount,
          sourceLabel: row?.src || totalMeta.sourceLabel || "",
          initialTotal: Math.max(pendingCount, Number(totalMeta.initialTotal || pendingCount)),
          processedCount: Number(totalMeta.processedCount || 0),
          moviesSaved: Number(totalMeta.moviesSaved || 0),
          seriesSaved: Number(totalMeta.seriesSaved || 0),
          failedCount: Number(totalMeta.failedCount || 0)
        };
      } catch (e) {}
    }
    const memQueue = memoryFallback.get("d1_import_queue") || [];
    const totalMeta = memoryFallback.get("import_queue_meta") || {};
    return {
      pendingCount: memQueue.length,
      sourceLabel: memQueue[0]?.source_label || totalMeta.sourceLabel || "",
      initialTotal: Math.max(memQueue.length, Number(totalMeta.initialTotal || memQueue.length)),
      processedCount: Number(totalMeta.processedCount || 0),
      moviesSaved: Number(totalMeta.moviesSaved || 0),
      seriesSaved: Number(totalMeta.seriesSaved || 0),
      failedCount: Number(totalMeta.failedCount || 0)
    };
  }

  async function fetchPendingImportBatchFromD1(env, limit = 15) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 15), 25);
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const res = await db
          .prepare("SELECT id, source_label, entry_json FROM import_queue ORDER BY id ASC LIMIT ?1")
          .bind(safeLimit)
          .all();
        if (Array.isArray(res?.results) && res.results.length > 0) {
          return res.results.map(r => {
            let parsed = null;
            try { parsed = JSON.parse(r.entry_json); } catch (e) { parsed = r.entry_json; }
            return { id: r.id, sourceLabel: r.source_label, entry: parsed };
          });
        }
      } catch (e) {}
    }
    const memQueue = memoryFallback.get("d1_import_queue") || [];
    return memQueue.slice(0, safeLimit).map(r => {
      let parsed = null;
      try { parsed = JSON.parse(r.entry_json); } catch (e) { parsed = r.entry_json; }
      return { id: r.id, sourceLabel: r.source_label, entry: parsed };
    });
  }

  async function deleteImportQueueIdsFromD1(env, ids = []) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        const stmts = ids.map(id => db.prepare("DELETE FROM import_queue WHERE id = ?1").bind(Number(id)));
        await db.batch(stmts);
      } catch (e) {}
    }
    const idSet = new Set(ids.map(Number));
    const memQueue = memoryFallback.get("d1_import_queue") || [];
    memoryFallback.set("d1_import_queue", memQueue.filter(item => !idSet.has(Number(item.id))));
  }

  async function clearImportQueueInD1(env) {
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db.prepare("DELETE FROM import_queue").run();
      } catch (e) {}
    }
    memoryFallback.delete("d1_import_queue");
    memoryFallback.delete("import_queue_meta");
    return true;
  }

  function isAuthorizedAdminId(env, telegramId) {
    if (!telegramId) return false;
    const rawList = String(env?.ADMIN_IDS || env?.ADMIN_TELEGRAM_IDS || "").trim();
    if (!rawList) return false;
    const allowed = rawList.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    return allowed.includes(String(telegramId));
  }

  function formatUserRowForClient(row, env) {
    if (!row) return null;
    const isEnvAdmin = isAuthorizedAdminId(env, row.telegram_id);
    return {
      telegramId: String(row.telegram_id),
      tgUsername: row.tg_username || "",
      firstName: row.first_name || "",
      customUsername: row.custom_username || "",
      hasPasswordAccount: Boolean(row.custom_username && row.password_hash),
      totpEnabled: Boolean(row.totp_enabled && row.totp_secret),
      isVip: Boolean(row.is_vip),
      isAdmin: Boolean(row.is_admin || isEnvAdmin),
      createdAt: Number(row.created_at || 0),
      lastSeenAt: Number(row.last_seen_at || 0)
    };
  }

  async function upsertTelegramUserInD1(env, tgUser) {
    if (!tgUser || !tgUser.id) return null;
    const telegramId = String(tgUser.id);
    const tgUsername = String(tgUser.username || "").trim();
    const firstName = String(tgUser.first_name || "").trim();
    const now = Date.now();
    const adminFlag = isAuthorizedAdminId(env, telegramId) ? 1 : 0;

    // Memory-Fallback Synchronisierung
    const memKey = `d1_user_${telegramId}`;
    const existingMem = memoryFallback.get(memKey) || {
      telegram_id: telegramId,
      tg_username: tgUsername,
      first_name: firstName,
      custom_username: null,
      password_hash: null,
      password_salt: null,
      totp_secret: null,
      totp_enabled: 0,
      is_vip: 0,
      is_admin: adminFlag,
      created_at: now,
      last_seen_at: now
    };
    existingMem.tg_username = tgUsername || existingMem.tg_username;
    existingMem.first_name = firstName || existingMem.first_name;
    if (adminFlag) existingMem.is_admin = 1;
    existingMem.last_seen_at = now;
    memoryFallback.set(memKey, existingMem);

    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db
          .prepare(`INSERT INTO users (
            telegram_id, tg_username, first_name, is_vip, is_admin, created_at, last_seen_at
          ) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?5)
          ON CONFLICT(telegram_id) DO UPDATE SET
            tg_username = COALESCE(NULLIF(excluded.tg_username, ''), users.tg_username),
            first_name = COALESCE(NULLIF(excluded.first_name, ''), users.first_name),
            is_admin = CASE WHEN excluded.is_admin = 1 THEN 1 ELSE users.is_admin END,
            last_seen_at = excluded.last_seen_at`)
          .bind(telegramId, tgUsername, firstName, adminFlag, now)
          .run();

        const row = await db
          .prepare("SELECT * FROM users WHERE telegram_id = ?1")
          .bind(telegramId)
          .first();
        if (row) {
          memoryFallback.set(memKey, row);
          if (row.custom_username) memoryFallback.set(`d1_username_${String(row.custom_username).toLowerCase()}`, telegramId);
          return formatUserRowForClient(row, env);
        }
      } catch (e) {}
    }
    return formatUserRowForClient(existingMem, env);
  }

  async function getUserByTelegramIdFromD1(env, telegramId) {
    if (!telegramId || telegramId === "guest") return null;
    const tid = String(telegramId);
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const row = await db
          .prepare("SELECT * FROM users WHERE telegram_id = ?1")
          .bind(tid)
          .first();
        if (row) {
          memoryFallback.set(`d1_user_${tid}`, row);
          return row;
        }
      } catch (e) {}
    }
    return memoryFallback.get(`d1_user_${tid}`) || null;
  }

  async function getUserByCustomUsernameFromD1(env, customUsername) {
    const cleanUser = String(customUsername || "").trim();
    if (!cleanUser) return null;
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const row = await db
          .prepare("SELECT * FROM users WHERE LOWER(custom_username) = LOWER(?1)")
          .bind(cleanUser)
          .first();
        if (row) return row;
      } catch (e) {}
    }
    const mappedTid = memoryFallback.get(`d1_username_${cleanUser.toLowerCase()}`);
    if (mappedTid) return memoryFallback.get(`d1_user_${mappedTid}`) || null;
    return null;
  }

  async function setCustomCredentialsInD1(env, telegramId, customUsername, passwordHash, passwordSalt) {
    if (!telegramId || telegramId === "guest") return { ok: false, error: "Nicht authentifiziert." };
    const tid = String(telegramId);
    const cleanUser = String(customUsername || "").trim();
    if (cleanUser.length < 3 || cleanUser.length > 32 || !/^[a-zA-Z0-9_.-]+$/.test(cleanUser)) {
      return { ok: false, error: "Username muss 3–32 Zeichen lang sein (Buchstaben, Zahlen, _ . -)." };
    }

    const existingOwner = await getUserByCustomUsernameFromD1(env, cleanUser);
    if (existingOwner && String(existingOwner.telegram_id) !== tid) {
      return { ok: false, error: "Dieser Username ist bereits vergeben." };
    }

    const now = Date.now();
    const memKey = `d1_user_${tid}`;
    const cur = (await getUserByTelegramIdFromD1(env, tid)) || {
      telegram_id: tid,
      tg_username: "",
      first_name: "",
      is_vip: 0,
      is_admin: isAuthorizedAdminId(env, tid) ? 1 : 0,
      created_at: now
    };
    cur.custom_username = cleanUser;
    cur.password_hash = passwordHash;
    cur.password_salt = passwordSalt;
    cur.last_seen_at = now;
    memoryFallback.set(memKey, cur);
    memoryFallback.set(`d1_username_${cleanUser.toLowerCase()}`, tid);

    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db
          .prepare(`INSERT INTO users (
            telegram_id, tg_username, first_name, custom_username, password_hash, password_salt, is_vip, is_admin, created_at, last_seen_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
          ON CONFLICT(telegram_id) DO UPDATE SET
            custom_username = excluded.custom_username,
            password_hash = excluded.password_hash,
            password_salt = excluded.password_salt,
            last_seen_at = excluded.last_seen_at`)
          .bind(
            tid,
            cur.tg_username || "",
            cur.first_name || "",
            cleanUser,
            passwordHash,
            passwordSalt,
            Number(cur.is_vip || 0),
            Number(cur.is_admin || 0),
            now
          )
          .run();
      } catch (e) {
        return { ok: false, error: "Datenbankfehler beim Speichern des Accounts (evtl. Username vergeben)." };
      }
    }
    return { ok: true, user: formatUserRowForClient(cur, env) };
  }

  async function saveUserTotpInD1(env, telegramId, totpSecret, totpEnabled) {
    const tid = String(telegramId || "").trim();
    if (!tid || tid === "guest") return null;
    const enabledVal = totpEnabled ? 1 : 0;
    const now = Date.now();
    const cur = (await getUserByTelegramIdFromD1(env, tid)) || {
      telegram_id: tid,
      tg_username: "",
      first_name: "",
      is_vip: 0,
      is_admin: isAuthorizedAdminId(env, tid) ? 1 : 0,
      created_at: now
    };
    cur.totp_secret = totpSecret ? String(totpSecret) : null;
    cur.totp_enabled = enabledVal;
    cur.last_seen_at = now;
    memoryFallback.set(`d1_user_${tid}`, cur);

    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db
          .prepare("UPDATE users SET totp_secret = ?1, totp_enabled = ?2, last_seen_at = ?3 WHERE telegram_id = ?4")
          .bind(cur.totp_secret, enabledVal, now, tid)
          .run();
      } catch (e) {}
    }
    return formatUserRowForClient(cur, env);
  }

  async function setUserVipStatusInD1(env, telegramId, isVip) {
    const tid = String(telegramId || "").trim();
    if (!tid) return null;
    const vipVal = isVip ? 1 : 0;
    const cur = await getUserByTelegramIdFromD1(env, tid);
    if (cur) {
      cur.is_vip = vipVal;
      memoryFallback.set(`d1_user_${tid}`, cur);
    }
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db
          .prepare("UPDATE users SET is_vip = ?1, last_seen_at = ?2 WHERE telegram_id = ?3")
          .bind(vipVal, Date.now(), tid)
          .run();
      } catch (e) {}
    }
    const updated = await getUserByTelegramIdFromD1(env, tid);
    return formatUserRowForClient(updated || { telegram_id: tid, is_vip: vipVal }, env);
  }

  async function listAllUsersFromD1(env) {
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const res = await db
          .prepare("SELECT * FROM users ORDER BY is_admin DESC, is_vip DESC, last_seen_at DESC LIMIT 200")
          .all();
        if (Array.isArray(res?.results) && res.results.length > 0) {
          return res.results.map(r => formatUserRowForClient(r, env));
        }
      } catch (e) {}
    }
    const list = [];
    for (const [k, v] of memoryFallback.entries()) {
      if (k.startsWith("d1_user_") && v && v.telegram_id) {
        list.push(formatUserRowForClient(v, env));
      }
    }
    return list;
  }

  async function listAllMediaFromD1(env, typeCode = "m") {
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const query = typeCode === "s"
          ? `SELECT s.tmdb_id, s.title, s.release_year, s.fsk, s.vote_average, s.genres, s.providers, s.poster_path, s.updated_at,
                    COUNT(ef.id) AS stream_count,
                    GROUP_CONCAT(DISTINCT ef.quality) AS qualities
             FROM series s
             INNER JOIN episode_files ef ON ef.series_id = s.tmdb_id
             GROUP BY s.tmdb_id
             HAVING COUNT(ef.id) > 0
             ORDER BY COUNT(ef.id) DESC, s.updated_at DESC
             LIMIT 250`
          : `SELECT m.tmdb_id, m.title, m.release_year, m.fsk, m.vote_average, m.genres, m.providers, m.poster_path, m.updated_at,
                    COUNT(mf.id) AS stream_count,
                    GROUP_CONCAT(DISTINCT mf.quality) AS qualities
             FROM movies m
             INNER JOIN movie_files mf ON mf.movie_id = m.tmdb_id
             GROUP BY m.tmdb_id
             HAVING COUNT(mf.id) > 0
             ORDER BY COUNT(mf.id) DESC, m.updated_at DESC
             LIMIT 250`;
        const res = await db.prepare(query).all();
        if (Array.isArray(res?.results) && res.results.length > 0) {
          return res.results;
        }
      } catch (e) {}
    }
    const memPrefix = typeCode === "s" ? "d1_catalog_series_" : "d1_catalog_movie_";
    const memResults = [];
    for (const [k, v] of memoryFallback.entries()) {
      if (k.startsWith(memPrefix) && v && v.id) {
        const tid = Number(v.id);
        const mFiles = typeCode === "s" ? [] : (memoryFallback.get(`d1_movie_files_${tid}`) || []);
        let epCount = 0;
        if (typeCode === "s") {
          for (const [ek, ev] of memoryFallback.entries()) {
            if (ek.startsWith(`d1_ep_files_${tid}_`) && Array.isArray(ev)) epCount += ev.length;
          }
        }
        if ((typeCode === "s" && epCount === 0) || (typeCode !== "s" && mFiles.length === 0)) continue;
        memResults.push({
          tmdb_id: tid,
          title: v.title || v.name || `Titel #${tid}`,
          release_year: String(v.releaseDate || "").split("-")[0] || null,
          fsk: v.fsk || "FSK k.A.",
          vote_average: v.vote_average || 0,
          genres: v.genres || "",
          providers: v.providers || "",
          poster_path: v.poster_path || v.external_poster_url || null,
          stream_count: typeCode === "s" ? epCount : mFiles.length,
          qualities: mFiles.length > 0 ? Array.from(new Set(mFiles.map(f => f.quality || "1080p"))).join(",") : "1080p",
          updated_at: Date.now()
        });
      }
    }
    return memResults;
  }

  async function deleteMediaFromD1(env, typeCode, tmdbId) {
    const db = await ensureD1Schema(env);
    const idNum = Number(tmdbId);
    if (!idNum) return false;
    memoryFallback.delete(`${typeCode === "s" ? "tv" : "movie"}_${idNum}`);
    memoryFallback.delete(`${typeCode === "s" ? "d1_catalog_series_" : "d1_catalog_movie_"}${idNum}`);
    if (typeCode === "s") {
      memoryFallback.delete(`d1_series_best_quality_${idNum}`);
      for (const k of Array.from(memoryFallback.keys())) {
        if (k.startsWith(`d1_ep_files_${idNum}_`) || k.startsWith(`ingested_streams_s_${idNum}_`)) {
          memoryFallback.delete(k);
        }
      }
    } else {
      memoryFallback.delete(`d1_movie_files_${idNum}`);
      memoryFallback.delete(`ingested_streams_m_${idNum}`);
    }
    if (!db) return true;
    try {
      trackStat("d1Writes");
      if (typeCode === "s") {
        await db.batch([
          db.prepare("DELETE FROM series WHERE tmdb_id = ?1").bind(idNum),
          db.prepare("DELETE FROM series_seasons WHERE series_id = ?1").bind(idNum),
          db.prepare("DELETE FROM series_episodes WHERE series_id = ?1").bind(idNum),
          db.prepare("DELETE FROM episode_files WHERE series_id = ?1").bind(idNum)
        ]);
      } else {
        await db.batch([
          db.prepare("DELETE FROM movies WHERE tmdb_id = ?1").bind(idNum),
          db.prepare("DELETE FROM movie_files WHERE movie_id = ?1").bind(idNum)
        ]);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // =========================================================================
  // @ANCHOR: D1_REPORTS_AND_CORRECTIONS
  // VIP/Admin Fehlermeldungen ("Fehler melden") & Granulare Episoden-Korrektur
  // =========================================================================
  async function createMediaReportInD1(env, reportInput) {
    const now = Date.now();
    const entry = {
      id: now,
      reporter_telegram_id: String(reportInput.reporterTelegramId || "guest"),
      reporter_username: String(reportInput.reporterUsername || "").trim(),
      type_code: reportInput.typeCode === "s" ? "s" : "m",
      tmdb_id: Number(reportInput.tmdbId || 0),
      title: String(reportInput.title || "Unbekannter Titel").trim(),
      season_number: reportInput.seasonNumber != null && Number(reportInput.seasonNumber) > 0 ? Number(reportInput.seasonNumber) : null,
      episode_number: reportInput.episodeNumber != null && Number(reportInput.episodeNumber) > 0 ? Number(reportInput.episodeNumber) : null,
      episode_title: String(reportInput.episodeTitle || "").trim(),
      telegram_file_id: String(reportInput.telegramFileId || "").trim(),
      version_label: String(reportInput.versionLabel || "").trim(),
      reason_code: String(reportInput.reasonCode || "other").trim(),
      reason_label: String(reportInput.reasonLabel || "Sonstiges").trim(),
      note: String(reportInput.note || "").trim().slice(0, 600),
      status: "open",
      resolved_at: null,
      resolved_by: null,
      created_at: now
    };

    const memReports = Array.isArray(memoryFallback.get("d1_media_reports")) ? memoryFallback.get("d1_media_reports") : [];
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        const res = await db.prepare(`INSERT INTO media_reports (
          reporter_telegram_id, reporter_username, type_code, tmdb_id, title,
          season_number, episode_number, episode_title, telegram_file_id, version_label,
          reason_code, reason_label, note, status, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'open', ?14)`)
          .bind(
            entry.reporter_telegram_id,
            entry.reporter_username,
            entry.type_code,
            entry.tmdb_id,
            entry.title,
            entry.season_number,
            entry.episode_number,
            entry.episode_title,
            entry.telegram_file_id,
            entry.version_label,
            entry.reason_code,
            entry.reason_label,
            entry.note,
            entry.created_at
          )
          .run();
        if (res?.meta?.last_row_id) {
          entry.id = Number(res.meta.last_row_id);
        }
      } catch (e) {}
    }

    memoryFallback.set("d1_media_reports", [entry, ...memReports].slice(0, 300));
    return entry;
  }

  async function listMediaReportsFromD1(env, statusFilter = "all") {
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        let stmt;
        if (statusFilter === "open" || statusFilter === "resolved") {
          stmt = db.prepare("SELECT * FROM media_reports WHERE status = ?1 ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 200").bind(statusFilter);
        } else {
          stmt = db.prepare("SELECT * FROM media_reports ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 200");
        }
        const res = await stmt.all();
        if (Array.isArray(res?.results)) {
          memoryFallback.set("d1_media_reports", res.results);
          return res.results;
        }
      } catch (e) {}
    }
    const memList = Array.isArray(memoryFallback.get("d1_media_reports")) ? memoryFallback.get("d1_media_reports") : [];
    if (statusFilter === "open" || statusFilter === "resolved") {
      return memList.filter(r => r && r.status === statusFilter);
    }
    return memList;
  }

  async function resolveMediaReportInD1(env, reportId, resolvedBy = "Admin") {
    const idNum = Number(reportId || 0);
    if (!idNum) return false;
    const now = Date.now();
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db.prepare("UPDATE media_reports SET status = 'resolved', resolved_at = ?1, resolved_by = ?2 WHERE id = ?3")
          .bind(now, String(resolvedBy || "Admin"), idNum)
          .run();
      } catch (e) {}
    }
    const memList = Array.isArray(memoryFallback.get("d1_media_reports")) ? memoryFallback.get("d1_media_reports") : [];
    memoryFallback.set("d1_media_reports", memList.map(r => (Number(r.id) === idNum ? { ...r, status: "resolved", resolved_at: now, resolved_by: String(resolvedBy || "Admin") } : r)));
    return true;
  }

  async function resolveMatchingMediaReportsInD1(env, matchCriteria, resolvedBy = "Admin (Auto-Korrektur)") {
    const now = Date.now();
    const reportId = Number(matchCriteria?.reportId || 0);
    const typeCode = matchCriteria?.typeCode === "s" ? "s" : "m";
    const tmdbId = Number(matchCriteria?.tmdbId || 0);
    const seasonNum = matchCriteria?.seasonNumber != null ? Number(matchCriteria.seasonNumber) : null;
    const episodeNum = matchCriteria?.episodeNumber != null ? Number(matchCriteria.episodeNumber) : null;
    const fileId = String(matchCriteria?.telegramFileId || "").trim();

    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        const stmts = [];
        if (reportId > 0) {
          stmts.push(
            db.prepare("UPDATE media_reports SET status = 'resolved', resolved_at = ?1, resolved_by = ?2 WHERE id = ?3")
              .bind(now, resolvedBy, reportId)
          );
        }
        if (fileId) {
          stmts.push(
            db.prepare("UPDATE media_reports SET status = 'resolved', resolved_at = ?1, resolved_by = ?2 WHERE status = 'open' AND telegram_file_id = ?3")
              .bind(now, resolvedBy, fileId)
          );
        }
        if (tmdbId > 0 && typeCode === "s" && seasonNum != null && episodeNum != null) {
          stmts.push(
            db.prepare("UPDATE media_reports SET status = 'resolved', resolved_at = ?1, resolved_by = ?2 WHERE status = 'open' AND type_code = 's' AND tmdb_id = ?3 AND season_number = ?4 AND episode_number = ?5")
              .bind(now, resolvedBy, tmdbId, seasonNum, episodeNum)
          );
        } else if (tmdbId > 0 && typeCode === "m") {
          stmts.push(
            db.prepare("UPDATE media_reports SET status = 'resolved', resolved_at = ?1, resolved_by = ?2 WHERE status = 'open' AND type_code = 'm' AND tmdb_id = ?3")
              .bind(now, resolvedBy, tmdbId)
          );
        }
        if (stmts.length > 0) await db.batch(stmts);
      } catch (e) {}
    }

    const memList = Array.isArray(memoryFallback.get("d1_media_reports")) ? memoryFallback.get("d1_media_reports") : [];
    memoryFallback.set("d1_media_reports", memList.map(r => {
      if (!r || r.status === "resolved") return r;
      const matchesId = reportId > 0 && Number(r.id) === reportId;
      const matchesFile = fileId && String(r.telegram_file_id || "") === fileId;
      const matchesEp = tmdbId > 0 && typeCode === "s" && Number(r.tmdb_id) === tmdbId && Number(r.season_number) === seasonNum && Number(r.episode_number) === episodeNum;
      const matchesMov = tmdbId > 0 && typeCode === "m" && Number(r.tmdb_id) === tmdbId && r.type_code === "m";
      if (matchesId || matchesFile || matchesEp || matchesMov) {
        return { ...r, status: "resolved", resolved_at: now, resolved_by: resolvedBy };
      }
      return r;
    }));
    return true;
  }

  async function deleteMediaReportFromD1(env, reportId) {
    const idNum = Number(reportId || 0);
    if (!idNum) return false;
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db.prepare("DELETE FROM media_reports WHERE id = ?1").bind(idNum).run();
      } catch (e) {}
    }
    const memList = Array.isArray(memoryFallback.get("d1_media_reports")) ? memoryFallback.get("d1_media_reports") : [];
    memoryFallback.set("d1_media_reports", memList.filter(r => Number(r?.id) !== idNum));
    return true;
  }

  async function notifyAdminsOnTelegramForReport(env, report) {
    try {
      const rawAdmins = String(env?.ADMIN_CHAT_ID || env?.ADMIN_IDS || env?.ADMIN_TELEGRAM_IDS || "").trim();
      if (!rawAdmins || !env?.TELEGRAM_BOT_TOKEN) return;
      const adminIds = Array.from(new Set(rawAdmins.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)));
      if (adminIds.length === 0) return;

      const epTag = report.type_code === "s" && report.season_number
        ? ` • <b>S${String(report.season_number).padStart(2, "0")}E${String(report.episode_number || 1).padStart(2, "0")}</b>${report.episode_title ? ` (${escapeHtml(report.episode_title)})` : ""}`
        : "";
      const verTag = report.version_label ? `\n🎞️ <b>Version:</b> ${escapeHtml(report.version_label)}` : "";
      const noteTag = report.note ? `\n💬 <b>Notiz:</b> <i>${escapeHtml(report.note)}</i>` : "";
      const reporterTag = report.reporter_username
        ? `@${escapeHtml(report.reporter_username)} (<code>${escapeHtml(report.reporter_telegram_id)}</code>)`
        : `<code>${escapeHtml(report.reporter_telegram_id)}</code>`;

      const msgText =
        `🚨 <b>Neue Fehlermeldung (#${report.id})</b>\n\n` +
        `${report.type_code === "s" ? "📺 <b>Serie:</b>" : "🎬 <b>Film:</b>"} ${escapeHtml(report.title)} (TMDb #${report.tmdb_id})${epTag}` +
        `${verTag}\n` +
        `⚠️ <b>Grund:</b> ${escapeHtml(report.reason_label)}` +
        `${noteTag}\n` +
        `👤 <b>Gemeldet von:</b> ${reporterTag}\n\n` +
        `💡 <i>Im Admin-Panel unter „🚨 Meldungen“ per 1-Klick korrigierbar.</i>`;

      for (const adminChatId of adminIds.slice(0, 4)) {
        await tgApi(env).sendMessage(adminChatId, msgText, { parse_mode: "HTML" }).catch(() => {});
      }
    } catch (e) {}
  }

  // Deterministische Stream-Sortierung & Dubletten-Schutz (#16):
  // 1. Qualität absteigend (4K > 1080p > 720p > SD)
  // 2. Dateigröße absteigend (größere Datei zuerst)
  // 3. Part aufsteigend (CD1 -> CD2)
  // Bewertet die Gültigkeit einer telegram_file_id (verhindert tote/doppelte Buttons!):
  // 3 = echte Telegram File-ID (vom Bot empfangen)
  // 2 = gültiger Kanal-Export mit -100... oder @username (tg_export_-100123456789_42 / tg_export_@channel_42)
  // 1 = generischer / positiver Kanal-Export (tg_export_vip_..., tg_export_0_..., tg_export_123456789_42, vip_manual_...)
  // 0 = ungültiger Platzhalter (vip_playlist_..., tmdb_card_...)
  function scoreTelegramFileIdValidity(fileId) {
    const fid = String(fileId || "").trim();
    if (!fid) return 0;
    if (
      fid.startsWith("vip_playlist_") ||
      fid.startsWith("tmdb_card_")
    ) {
      return 0;
    }
    if (/^tg_export_(?:-100\d{5,}|@[A-Za-z0-9_]{3,})_\d+$/.test(fid)) return 2;
    if (fid.startsWith("tg_export_") || fid.startsWith("vip_manual_")) return 1;
    return 3;
  }

  function extractExportMessageIdFromFileId(fileId) {
    const m = String(fileId || "").trim().match(/^tg_export_[^_]+_(\d+)$/);
    return m ? Number(m[1]) : null;
  }

  function normalizeExportFileIdChannel(fileId, fallbackChannelId = "") {
    const fid = String(fileId || "").trim();
    if (!fid) return "";
    const posMatch = fid.match(/^tg_export_([1-9]\d{4,})_(\d+)$/);
    if (posMatch) {
      return `tg_export_-100${posMatch[1]}_${posMatch[2]}`;
    }
    const zeroMatch = fid.match(/^tg_export_(?:0|vip)_(\d+)$/);
    if (zeroMatch && fallbackChannelId && (/^-100\d{5,}$/.test(String(fallbackChannelId)) || /^@[A-Za-z0-9_]{3,}$/.test(String(fallbackChannelId)))) {
      return `tg_export_${fallbackChannelId}_${zeroMatch[1]}`;
    }
    return fid;
  }

  function parseAndNormalizeTelegramChannelInput(rawInput) {
    const raw = String(rawInput || "").trim();
    if (!raw) return { channelId: "", sampleMessageId: null, username: "" };

    const privateLinkMatch = raw.match(/t\.me\/c\/(\d{5,})(?:\/(\d+))?(?:\/(\d+))?/i);
    if (privateLinkMatch) {
      const cleanDigits = privateLinkMatch[1];
      const msgId = privateLinkMatch[3] ? Number(privateLinkMatch[3]) : (privateLinkMatch[2] ? Number(privateLinkMatch[2]) : null);
      return {
        channelId: `-100${cleanDigits}`,
        sampleMessageId: msgId || null,
        username: ""
      };
    }

    const publicLinkMatch = raw.match(/t\.me\/([a-zA-Z0-9_]{4,})(?:\/(\d+))?/i);
    if (publicLinkMatch && publicLinkMatch[1].toLowerCase() !== "c") {
      return {
        channelId: `@${publicLinkMatch[1]}`,
        sampleMessageId: publicLinkMatch[2] ? Number(publicLinkMatch[2]) : null,
        username: `@${publicLinkMatch[1]}`
      };
    }

    const numMatch = raw.match(/^(-?\d{5,})$/);
    if (numMatch) {
      let digits = numMatch[1];
      if (!digits.startsWith("-")) {
        digits = `-100${digits.replace(/^100/, "")}`;
      } else if (digits.startsWith("-") && !digits.startsWith("-100")) {
        digits = `-100${digits.slice(1)}`;
      }
      return { channelId: digits, sampleMessageId: null, username: "" };
    }

    if (raw.startsWith("@")) {
      return { channelId: raw, sampleMessageId: null, username: raw };
    }

    return { channelId: raw, sampleMessageId: null, username: "" };
  }

  function sortAndDedupeStreamFiles(filesList) {
    if (!Array.isArray(filesList) || filesList.length === 0) return [];
    const prepared = [];
    for (const raw of filesList) {
      if (!raw || !raw.telegram_file_id) continue;
      const normalizedFid = normalizeExportFileIdChannel(raw.telegram_file_id);
      const validity = scoreTelegramFileIdValidity(normalizedFid);
      const msgId = extractExportMessageIdFromFileId(normalizedFid);
      const normalizedSize = parseHumanFileSizeToBytes(raw.file_size);
      prepared.push({
        ...raw,
        telegram_file_id: normalizedFid,
        quality: String(raw.quality || "1080p"),
        codec: String(raw.codec || "x264"),
        part: raw.part ? String(raw.part) : null,
        tags: raw.tags ? String(raw.tags) : "",
        file_size: normalizedSize,
        _validity: validity,
        _msgId: msgId
      });
    }

    // Sobald mindestens eine gültige Datei (_validity >= 1) vorhanden ist, alle defekten Platzhalter (_validity === 0) ausfiltern!
    // Synthetische vip_playlist_ Platzhalter werden immer verworfen, da sie nicht über Telegram gesendet werden können.
    const hasValid = prepared.some(x => x._validity >= 1);
    const pool = hasValid
      ? prepared.filter(x => x._validity >= 1)
      : prepared.filter(x => !String(x.telegram_file_id).startsWith("vip_playlist_"));

    // Höchste Gültigkeit zuerst (echte file_id > tg_export_-100... > Rest), danach neuestes updated_at
    pool.sort((a, b) => {
      if (b._validity !== a._validity) return b._validity - a._validity;
      return Number(b.updated_at || 0) - Number(a.updated_at || 0);
    });

    const seenFileKeys = new Set();
    const seenMsgIds = new Set();
    const seenStreamSigs = new Set();
    const deduped = [];

    for (const item of pool) {
      const fKey = String(item.telegram_unique_id || item.telegram_file_id).trim();
      if (!fKey || seenFileKeys.has(fKey)) continue;
      if (item._msgId && seenMsgIds.has(item._msgId)) continue;

      // Verhindert doppelte identische Sende-Buttons, behält aber unterschiedliche Schnittfassungen (versionLabel) strikt getrennt!
      const qNorm = String(item.quality || "1080p").trim().toUpperCase();
      const cNorm = String(item.codec || "x264").trim().toUpperCase();
      const pNorm = String(item.part || "").trim().toUpperCase();
      const vNorm = extractEpisodeVersionLabel(item).toUpperCase();
      const szBucket = item.file_size ? Math.round(Number(item.file_size) / (1024 * 512)) : 0;
      const streamSig = `${qNorm}|${cNorm}|${pNorm}|${vNorm}|${szBucket}`;
      if (seenStreamSigs.has(streamSig)) continue;

      seenFileKeys.add(fKey);
      if (item._msgId) seenMsgIds.add(item._msgId);
      seenStreamSigs.add(streamSig);

      const cleanItem = { ...item };
      delete cleanItem._validity;
      delete cleanItem._msgId;
      deduped.push(cleanItem);
    }

    return deduped.sort((a, b) => {
      const qDiff = rankQualityLabel(b.quality) - rankQualityLabel(a.quality);
      if (qDiff !== 0) return qDiff;
      const sDiff = Number(b.file_size || 0) - Number(a.file_size || 0);
      if (sDiff !== 0) return sDiff;
      return String(a.part || "").localeCompare(String(b.part || ""), undefined, { numeric: true });
    });
  }

  // Extrahiert das saubere Versions-Label (z.B. "Netflix-Fassung", "Originalfassung", "TV-Schnitt", "DVD-Fassung", "📦 RAR-Archiv")
  function extractEpisodeVersionLabel(fileOrTags) {
    if (!fileOrTags) return "Originalfassung";
    const explicit = typeof fileOrTags === "object"
      ? String(fileOrTags.versionLabel || fileOrTags.version_label || "").trim()
      : "";
    const codecVal = typeof fileOrTags === "object" ? String(fileOrTags.codec || "").toUpperCase() : "";
    const partVal = typeof fileOrTags === "object" ? String(fileOrTags.part || "").toUpperCase() : "";
    const fnVal = typeof fileOrTags === "object" ? String(fileOrTags.raw_filename || fileOrTags.rawFilename || "").toLowerCase() : "";
    const rawStr = explicit || String(typeof fileOrTags === "object" ? (fileOrTags.tags || "") : fileOrTags).trim();
    const low = rawStr.toLowerCase();
    if (codecVal === "RAR" || partVal.startsWith("RAR") || fnVal.endsWith(".rar") || low.includes("rar-archiv") || low.includes("rar-part")) {
      return "📦 RAR-Archiv";
    }
    if (low.includes("netflix") || low.includes("edited") || low.includes("stream") || low.includes("original parts")) {
      return "Netflix-Fassung";
    }
    if (low.includes("doppelfolge")) return "Doppelfolgen-Schnitt";
    if (low.includes("tv-schnitt") || low.includes("tv-mehrteiler") || low.includes("kabel-tv")) return "TV-Schnitt";
    if (low.includes("dvd")) return "DVD-Fassung";
    if (explicit) return explicit;
    return "Originalfassung";
  }

  // Baut das strukturierte episode.versions-Array für den Frontend Versions-Switcher auf
  function buildEpisodeVersionsArray(epFiles = [], d1VersionsJson = null) {
    const versionMap = new Map();
    if (d1VersionsJson) {
      try {
        const parsed = typeof d1VersionsJson === "string" ? JSON.parse(d1VersionsJson) : d1VersionsJson;
        if (Array.isArray(parsed)) {
          for (const v of parsed) {
            if (!v || !(v.file_id || v.telegram_file_id)) continue;
            const fid = String(v.file_id || v.telegram_file_id);
            const vLabel = extractEpisodeVersionLabel(v);
            const key = `${vLabel}|${String(v.quality || "1080p").toUpperCase()}|${fid}`;
            const parsedSubs = Array.isArray(v.subtitles) ? v.subtitles : (() => { try { return JSON.parse(v.subtitles_json || "[]"); } catch (_) { return []; } })();
            versionMap.set(key, {
              versionLabel: vLabel,
              file_id: fid,
              telegram_file_id: fid,
              quality: String(v.quality || "1080p"),
              codec: String(v.codec || "x264"),
              part: v.part || null,
              file_size: Number(v.file_size || 0),
              tags: normalizeCompactVersionTags(v.tags || vLabel),
              subtitles: Array.isArray(parsedSubs) ? parsedSubs : []
            });
          }
        }
      } catch (e) {}
    }
    for (const f of (epFiles || [])) {
      if (!f || !f.telegram_file_id) continue;
      const fid = String(f.telegram_file_id);
      const vLabel = extractEpisodeVersionLabel(f);
      const key = `${vLabel}|${String(f.quality || "1080p").toUpperCase()}|${fid}`;
      const parsedSubs = Array.isArray(f.subtitles) ? f.subtitles : (() => { try { return JSON.parse(f.subtitles_json || "[]"); } catch (_) { return []; } })();
      versionMap.set(key, {
        versionLabel: vLabel,
        file_id: fid,
        telegram_file_id: fid,
        quality: String(f.quality || "1080p"),
        codec: String(f.codec || "x264"),
        part: f.part || null,
        file_size: Number(f.file_size || 0),
        tags: normalizeCompactVersionTags(f.tags || vLabel),
        subtitles: Array.isArray(parsedSubs) ? parsedSubs : []
      });
    }
    // Gruppiere so, dass bei mehreren Versionen (z.B. "Netflix-Fassung" vs. "Originalfassung") jede Version repräsentiert ist
    return Array.from(versionMap.values());
  }

  // Rekonstruiert automatisch einen klickbaren Telegram-Nachrichtenlink (https://t.me/c/<channel>/<msgId>) aus tg_export_-100<chan>_<msgId>
  function inferTelegramMessageLinkFromFileId(telegramFileId, existingLink = "") {
    if (existingLink && String(existingLink).trim().startsWith("http")) {
      return String(existingLink).trim();
    }
    const fid = String(telegramFileId || "").trim();
    const m = fid.match(/^tg_export_(-?\d+)_(\d+)$/i);
    if (m) {
      const rawChan = String(m[1]).replace(/^-100/, "").replace(/^-/, "");
      const msgId = String(m[2]);
      if (rawChan && rawChan !== "0" && msgId) {
        return `https://t.me/c/${rawChan}/${msgId}`;
      }
    }
    return existingLink ? String(existingLink).trim() : "";
  }

  function mergeSubtitleArrays(existingSubs = [], incomingSubs = []) {
    const map = new Map();
    for (const s of [...(Array.isArray(existingSubs) ? existingSubs : []), ...(Array.isArray(incomingSubs) ? incomingSubs : [])]) {
      if (!s || !s.telegram_file_id) continue;
      const fid = normalizeExportFileIdChannel(String(s.telegram_file_id));
      map.set(fid, {
        telegram_file_id: fid,
        file_name: String(s.file_name || "Untertitel.srt"),
        lang: String(s.lang || "de"),
        message_id: s.message_id || null
      });
    }
    return Array.from(map.values());
  }

  function enrichStreamFileRowMeta(row) {
    if (!row || typeof row !== "object") return row;
    const vLabel = extractEpisodeVersionLabel(row);
    let subs = [];
    if (Array.isArray(row.subtitles)) {
      subs = row.subtitles;
    } else if (row.subtitles_json) {
      try {
        const parsed = JSON.parse(row.subtitles_json);
        if (Array.isArray(parsed)) subs = parsed;
      } catch (_) {}
    }
    return {
      ...row,
      version_label: vLabel,
      versionLabel: vLabel,
      raw_filename: row.raw_filename || row.rawFilename || "",
      raw_caption: row.raw_caption || row.rawCaption || "",
      message_link: inferTelegramMessageLinkFromFileId(row.telegram_file_id, row.message_link || row.messageLink || ""),
      subtitles: subs,
      subtitles_json: JSON.stringify(subs)
    };
  }

  async function saveMovieFileToD1(env, movieId, fileInfo) {
    const rawFid = fileInfo?.fileId || fileInfo?.telegram_file_id;
    if (!movieId || !rawFid) return false;
    const mid = Number(movieId);
    const normalizedFid = normalizeExportFileIdChannel(rawFid);
    if (scoreTelegramFileIdValidity(normalizedFid) === 0) return false;

    const rawFilename = String(fileInfo.rawFilename || fileInfo.raw_filename || "").trim();
    const rawCaption = String(fileInfo.rawCaption || fileInfo.raw_caption || "").trim();
    const messageLink = inferTelegramMessageLinkFromFileId(normalizedFid, fileInfo.messageLink || fileInfo.message_link || "");
    const incomingSubs = mergeSubtitleArrays([], fileInfo.subtitles || fileInfo.subtitle_files || []);
    const incomingIsPrerelease = isPrereleaseOrMicDub(rawCaption, rawFilename, fileInfo.tags || "");

    const memKey = `d1_movie_files_${mid}`;
    let existingMem = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];
    const db = await ensureD1Schema(env);
    let existingDbRows = [];
    if (db) {
      try {
        const res = await db
          .prepare("SELECT id, telegram_file_id, quality, codec, part, tags, raw_filename, raw_caption, subtitles_json FROM movie_files WHERE movie_id = ?1")
          .bind(mid)
          .all();
        existingDbRows = Array.isArray(res?.results) ? res.results : [];
      } catch (e) {}
    }

    const allExistingRows = [...existingDbRows, ...existingMem];
    const hasCleanExisting = allExistingRows.some(r => r && r.telegram_file_id !== normalizedFid && !isPrereleaseOrMicDub(r.raw_caption, r.raw_filename, r.tags));

    // Notfall-Regel für #vorabversion / TS / CAM / MD (Mic-Dub):
    // Wenn bereits eine ordentliche Version existiert, wird die Vorabversion NICHT gespeichert!
    if (incomingIsPrerelease && hasCleanExisting) {
      return { ok: true, skippedPrerelease: true, replacedPrereleaseCount: 0 };
    }

    // Wenn die neue Datei eine ordentliche Version ist -> lösche alle vorhandenen Vorab-/TS/MD-Versionen automatisch!
    let replacedPrereleaseCount = 0;
    const prereleaseFidsToDelete = new Set();
    if (!incomingIsPrerelease) {
      for (const r of allExistingRows) {
        if (r && r.telegram_file_id && r.telegram_file_id !== normalizedFid && isPrereleaseOrMicDub(r.raw_caption, r.raw_filename, r.tags)) {
          prereleaseFidsToDelete.add(String(r.telegram_file_id));
        }
      }
      replacedPrereleaseCount = prereleaseFidsToDelete.size;
      if (replacedPrereleaseCount > 0) {
        existingMem = existingMem.filter(x => x && !prereleaseFidsToDelete.has(String(x.telegram_file_id)));
      }
    }

    const prevSameRow = allExistingRows.find(r => r && String(r.telegram_file_id) === normalizedFid);
    const prevSubs = prevSameRow ? enrichStreamFileRowMeta(prevSameRow).subtitles : [];
    const mergedSubs = mergeSubtitleArrays(prevSubs, incomingSubs);
    let effectiveTags = fileInfo.tags ? String(fileInfo.tags) : "";
    if (incomingIsPrerelease && !effectiveTags.includes("Vorabversion")) {
      effectiveTags = [effectiveTags, "⚠️ Vorabversion"].filter(Boolean).join(" · ");
    }

    const entry = {
      movie_id: mid,
      telegram_file_id: normalizedFid,
      telegram_unique_id: fileInfo.fileUniqueId || fileInfo.telegram_unique_id ? String(fileInfo.fileUniqueId || fileInfo.telegram_unique_id) : null,
      quality: String(fileInfo.quality || "1080p"),
      codec: String(fileInfo.codec || "x264"),
      part: fileInfo.part ? String(fileInfo.part) : null,
      tags: effectiveTags,
      file_size: parseHumanFileSizeToBytes(fileInfo.fileSize ?? fileInfo.file_size),
      mime_type: String(fileInfo.mimeType || fileInfo.mime_type || "video/mp4"),
      raw_filename: rawFilename,
      raw_caption: rawCaption,
      message_link: messageLink,
      subtitles: mergedSubs,
      subtitles_json: JSON.stringify(mergedSubs),
      updated_at: Date.now()
    };
    const msgId = extractExportMessageIdFromFileId(normalizedFid);
    const nextMem = sortAndDedupeStreamFiles([
      entry,
      ...existingMem.filter(x => x && x.telegram_file_id !== entry.telegram_file_id && (!entry.telegram_unique_id || x.telegram_unique_id !== entry.telegram_unique_id))
    ]);
    memoryFallback.set(memKey, nextMem);

    if (!db) return { ok: true, skippedPrerelease: false, replacedPrereleaseCount };
    try {
      trackStat("d1Writes");
      const isHighValidity = scoreTelegramFileIdValidity(entry.telegram_file_id) >= 2;
      const stmts = [
        db.prepare(
          `DELETE FROM movie_files WHERE movie_id = ?1 AND (
            telegram_file_id LIKE 'vip_playlist_%'
            ${isHighValidity ? "OR telegram_file_id LIKE 'tg_export_0_%' OR telegram_file_id LIKE 'tg_export_vip_%'" : ""}
            OR (quality = ?2 AND codec = ?3 AND COALESCE(part, '') = ?4 AND COALESCE(file_size, 0) = ?5 AND telegram_file_id != ?6)
          )`
        ).bind(mid, entry.quality, entry.codec, entry.part || "", entry.file_size || 0, entry.telegram_file_id)
      ];
      for (const preFid of prereleaseFidsToDelete) {
        stmts.push(
          db.prepare("DELETE FROM movie_files WHERE movie_id = ?1 AND telegram_file_id = ?2")
            .bind(mid, preFid)
        );
      }
      if (entry.telegram_unique_id) {
        stmts.push(
          db.prepare("DELETE FROM movie_files WHERE movie_id = ?1 AND telegram_unique_id = ?2 AND telegram_file_id != ?3")
            .bind(entry.movie_id, entry.telegram_unique_id, entry.telegram_file_id)
        );
      }
      if (msgId) {
        stmts.push(
          db.prepare("DELETE FROM movie_files WHERE movie_id = ?1 AND telegram_file_id LIKE ?2 AND telegram_file_id != ?3")
            .bind(mid, `tg_export_%_${msgId}`, entry.telegram_file_id)
        );
      }
      stmts.push(
        db.prepare(`INSERT INTO movie_files (
          movie_id, telegram_file_id, telegram_unique_id, quality, codec, part, tags, file_size, mime_type, raw_filename, raw_caption, message_link, subtitles_json, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ON CONFLICT(movie_id, telegram_file_id) DO UPDATE SET
          quality = excluded.quality,
          codec = excluded.codec,
          part = COALESCE(excluded.part, movie_files.part),
          tags = CASE WHEN excluded.tags != '' THEN excluded.tags ELSE COALESCE(movie_files.tags, '') END,
          file_size = COALESCE(excluded.file_size, movie_files.file_size),
          raw_filename = CASE WHEN excluded.raw_filename != '' THEN excluded.raw_filename ELSE COALESCE(movie_files.raw_filename, '') END,
          raw_caption = CASE WHEN excluded.raw_caption != '' THEN excluded.raw_caption ELSE COALESCE(movie_files.raw_caption, '') END,
          message_link = CASE WHEN excluded.message_link != '' THEN excluded.message_link ELSE COALESCE(movie_files.message_link, '') END,
          subtitles_json = CASE WHEN excluded.subtitles_json != '[]' THEN excluded.subtitles_json ELSE COALESCE(movie_files.subtitles_json, '[]') END,
          updated_at = excluded.updated_at`)
          .bind(
            entry.movie_id,
            entry.telegram_file_id,
            entry.telegram_unique_id,
            entry.quality,
            entry.codec,
            entry.part,
            entry.tags,
            entry.file_size,
            entry.mime_type,
            entry.raw_filename,
            entry.raw_caption,
            entry.message_link,
            entry.subtitles_json,
            entry.updated_at
          )
      );
      await db.batch(stmts);
      return { ok: true, skippedPrerelease: false, replacedPrereleaseCount };
    } catch (e) {
      return { ok: true, skippedPrerelease: false, replacedPrereleaseCount };
    }
  }

  async function getMovieFilesFromD1(env, movieId) {
    if (!movieId) return [];
    const mid = Number(movieId);
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const res = await db
          .prepare("SELECT id, movie_id, telegram_file_id, telegram_unique_id, quality, codec, part, tags, file_size, mime_type, raw_filename, raw_caption, message_link, subtitles_json, updated_at FROM movie_files WHERE movie_id = ?1 ORDER BY updated_at DESC")
          .bind(mid)
          .all();
        if (Array.isArray(res?.results) && res.results.length > 0) {
          return sortAndDedupeStreamFiles(res.results.map(enrichStreamFileRowMeta));
        }
      } catch (e) {}
    }
    const memFiles = memoryFallback.get(`d1_movie_files_${mid}`);
    return Array.isArray(memFiles) ? sortAndDedupeStreamFiles(memFiles.map(enrichStreamFileRowMeta)) : [];
  }

  async function saveEpisodeFileToD1(env, seriesId, seasonNumber, episodeNumber, fileInfo) {
    const rawFid = fileInfo?.fileId || fileInfo?.telegram_file_id;
    if (!seriesId || !rawFid) return false;
    const sid = Number(seriesId);
    const sNum = Number(seasonNumber || 1);
    const eNum = Number(episodeNumber || 1);
    const normalizedFid = normalizeExportFileIdChannel(rawFid);
    if (scoreTelegramFileIdValidity(normalizedFid) === 0) return false;

    const epTitle = String(fileInfo.episodeTitle || fileInfo.title || `Folge ${eNum}`).trim();
    const rawFilename = String(fileInfo.rawFilename || fileInfo.raw_filename || "").trim();
    const rawCaption = String(fileInfo.rawCaption || fileInfo.raw_caption || "").trim();
    const messageLink = inferTelegramMessageLinkFromFileId(normalizedFid, fileInfo.messageLink || fileInfo.message_link || "");
    const incomingSubs = mergeSubtitleArrays([], fileInfo.subtitles || fileInfo.subtitle_files || []);
    const incomingIsPrerelease = isPrereleaseOrMicDub(rawCaption, rawFilename, fileInfo.tags || fileInfo.versionLabel || "");

    const memKey = `d1_ep_files_${sid}_${sNum}`;
    let existingMem = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];
    const db = await ensureD1Schema(env);
    let existingDbRows = [];
    if (db) {
      try {
        const res = await db
          .prepare("SELECT id, telegram_file_id, quality, codec, part, tags, version_label, raw_filename, raw_caption, subtitles_json FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3")
          .bind(sid, sNum, eNum)
          .all();
        existingDbRows = Array.isArray(res?.results) ? res.results : [];
      } catch (e) {}
    }

    const allExistingEpRows = [
      ...existingDbRows,
      ...existingMem.filter(x => x && Number(x.episode_number) === eNum)
    ];
    const hasCleanExisting = allExistingEpRows.some(r => r && r.telegram_file_id !== normalizedFid && !isPrereleaseOrMicDub(r.raw_caption, r.raw_filename, r.tags || r.version_label));

    // Notfall-Regel für #vorabversion / TS / CAM / MD (Mic-Dub):
    // Wenn für diese Folge bereits eine ordentliche Version existiert, wird die Vorabversion NICHT gespeichert!
    if (incomingIsPrerelease && hasCleanExisting) {
      return { ok: true, skippedPrerelease: true, replacedPrereleaseCount: 0 };
    }

    let replacedPrereleaseCount = 0;
    const prereleaseFidsToDelete = new Set();
    if (!incomingIsPrerelease) {
      for (const r of allExistingEpRows) {
        if (r && r.telegram_file_id && r.telegram_file_id !== normalizedFid && isPrereleaseOrMicDub(r.raw_caption, r.raw_filename, r.tags || r.version_label)) {
          prereleaseFidsToDelete.add(String(r.telegram_file_id));
        }
      }
      replacedPrereleaseCount = prereleaseFidsToDelete.size;
      if (replacedPrereleaseCount > 0) {
        existingMem = existingMem.filter(x => x && !(Number(x.episode_number) === eNum && prereleaseFidsToDelete.has(String(x.telegram_file_id))));
      }
    }

    const prevSameRow = allExistingEpRows.find(r => r && String(r.telegram_file_id) === normalizedFid);
    const prevSubs = prevSameRow ? enrichStreamFileRowMeta(prevSameRow).subtitles : [];
    const mergedSubs = mergeSubtitleArrays(prevSubs, incomingSubs);

    const versionLabel = incomingIsPrerelease ? "⚠️ Vorabversion" : extractEpisodeVersionLabel(fileInfo);
    const cleanTags = normalizeCompactVersionTags(fileInfo.tags || versionLabel);

    const entry = {
      series_id: sid,
      season_number: sNum,
      episode_number: eNum,
      episode_title: epTitle,
      telegram_file_id: normalizedFid,
      telegram_unique_id: fileInfo.fileUniqueId || fileInfo.telegram_unique_id ? String(fileInfo.fileUniqueId || fileInfo.telegram_unique_id) : null,
      quality: String(fileInfo.quality || "1080p"),
      codec: String(fileInfo.codec || "x264"),
      part: fileInfo.part ? String(fileInfo.part) : null,
      tags: cleanTags,
      version_label: versionLabel,
      versionLabel: versionLabel,
      file_size: parseHumanFileSizeToBytes(fileInfo.fileSize ?? fileInfo.file_size),
      mime_type: String(fileInfo.mimeType || fileInfo.mime_type || "video/mp4"),
      raw_filename: rawFilename,
      raw_caption: rawCaption,
      message_link: messageLink,
      subtitles: mergedSubs,
      subtitles_json: JSON.stringify(mergedSubs),
      updated_at: Date.now()
    };
    const msgId = extractExportMessageIdFromFileId(normalizedFid);
    const sameEpDeduped = sortAndDedupeStreamFiles([
      entry,
      ...existingMem.filter(x => x && Number(x.episode_number) === eNum)
    ]);
    const otherEps = existingMem.filter(x => x && Number(x.episode_number) !== eNum);
    memoryFallback.set(memKey, [...sameEpDeduped, ...otherEps]);
    memoryFallback.set(`d1_series_best_quality_${sid}`, entry.quality + (entry.codec ? ` ${entry.codec}` : ""));

    const versionsPayload = JSON.stringify(buildEpisodeVersionsArray(sameEpDeduped));

    if (!db) return { ok: true, skippedPrerelease: false, replacedPrereleaseCount };
    try {
      trackStat("d1Writes");
      const isHighValidity = scoreTelegramFileIdValidity(entry.telegram_file_id) >= 2;
      // Multi-Versionen-Schutz: Lösche alte Einträge NUR, wenn sie dieselbe version_label haben!
      // Eine "Originalfassung" überschreibt niemals eine "Netflix-Fassung" (und umgekehrt).
      const stmts = [
        db.prepare(
          `DELETE FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3 AND (
            telegram_file_id LIKE 'vip_playlist_%'
            ${isHighValidity ? "OR telegram_file_id LIKE 'tg_export_0_%' OR telegram_file_id LIKE 'tg_export_vip_%'" : ""}
            OR (quality = ?4 AND codec = ?5 AND COALESCE(part, '') = ?6 AND COALESCE(file_size, 0) = ?7 AND telegram_file_id != ?8 AND COALESCE(version_label, 'Originalfassung') = ?9)
          )`
        ).bind(sid, sNum, eNum, entry.quality, entry.codec, entry.part || "", entry.file_size || 0, entry.telegram_file_id, entry.version_label)
      ];
      for (const preFid of prereleaseFidsToDelete) {
        stmts.push(
          db.prepare("DELETE FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3 AND telegram_file_id = ?4")
            .bind(sid, sNum, eNum, preFid)
        );
      }
      if (entry.telegram_unique_id) {
        stmts.push(
          db.prepare("DELETE FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3 AND telegram_unique_id = ?4 AND telegram_file_id != ?5")
            .bind(entry.series_id, entry.season_number, entry.episode_number, entry.telegram_unique_id, entry.telegram_file_id)
        );
      }
      if (msgId) {
        stmts.push(
          db.prepare("DELETE FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3 AND telegram_file_id LIKE ?4 AND telegram_file_id != ?5")
            .bind(sid, sNum, eNum, `tg_export_%_${msgId}`, entry.telegram_file_id)
        );
      }
      stmts.push(
        db.prepare(`INSERT INTO episode_files (
          series_id, season_number, episode_number, telegram_file_id, telegram_unique_id, quality, codec, part, tags, version_label, file_size, mime_type, raw_filename, raw_caption, message_link, subtitles_json, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
        ON CONFLICT(series_id, season_number, episode_number, telegram_file_id) DO UPDATE SET
          quality = excluded.quality,
          codec = excluded.codec,
          part = COALESCE(excluded.part, episode_files.part),
          tags = CASE WHEN excluded.tags != '' THEN excluded.tags ELSE COALESCE(episode_files.tags, '') END,
          version_label = COALESCE(NULLIF(excluded.version_label, ''), episode_files.version_label, 'Originalfassung'),
          file_size = COALESCE(excluded.file_size, episode_files.file_size),
          raw_filename = CASE WHEN excluded.raw_filename != '' THEN excluded.raw_filename ELSE COALESCE(episode_files.raw_filename, '') END,
          raw_caption = CASE WHEN excluded.raw_caption != '' THEN excluded.raw_caption ELSE COALESCE(episode_files.raw_caption, '') END,
          message_link = CASE WHEN excluded.message_link != '' THEN excluded.message_link ELSE COALESCE(episode_files.message_link, '') END,
          subtitles_json = CASE WHEN excluded.subtitles_json != '[]' THEN excluded.subtitles_json ELSE COALESCE(episode_files.subtitles_json, '[]') END,
          updated_at = excluded.updated_at`)
          .bind(
            entry.series_id,
            entry.season_number,
            entry.episode_number,
            entry.telegram_file_id,
            entry.telegram_unique_id,
            entry.quality,
            entry.codec,
            entry.part,
            entry.tags,
            entry.version_label,
            entry.file_size,
            entry.mime_type,
            entry.raw_filename,
            entry.raw_caption,
            entry.message_link,
            entry.subtitles_json,
            entry.updated_at
          ),
        db.prepare(`INSERT INTO series_episodes (
          series_id, season_number, episode_number, title, versions_json, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(series_id, season_number, episode_number) DO UPDATE SET
          title = CASE WHEN excluded.title != '' AND excluded.title NOT LIKE 'Folge %' THEN excluded.title ELSE COALESCE(series_episodes.title, excluded.title) END,
          versions_json = excluded.versions_json,
          updated_at = excluded.updated_at`)
          .bind(entry.series_id, entry.season_number, entry.episode_number, epTitle, versionsPayload, entry.updated_at)
      );
      await db.batch(stmts);
      return { ok: true, skippedPrerelease: false, replacedPrereleaseCount };
    } catch (e) {
      return { ok: true, skippedPrerelease: false, replacedPrereleaseCount };
    }
  }

  async function attachSubtitleToMediaInD1(env, targetInfo, subItem) {
    if (!targetInfo || !subItem || !subItem.telegram_file_id) return false;
    const typeCode = targetInfo.typeCode === "s" ? "s" : "m";
    const tmdbId = Number(targetInfo.tmdbId || 0);
    if (!tmdbId) return false;
    if (typeCode === "m") {
      const files = await getMovieFilesFromD1(env, tmdbId);
      const targetRow = (targetInfo.fileId ? files.find(f => f.telegram_file_id === targetInfo.fileId) : null) || files[0];
      if (!targetRow) return false;
      const merged = mergeSubtitleArrays(targetRow.subtitles || [], [subItem]);
      await saveMovieFileToD1(env, tmdbId, {
        ...targetRow,
        fileId: targetRow.telegram_file_id,
        subtitles: merged
      });
      return true;
    } else {
      const sNum = Number(targetInfo.season || 1);
      const eNum = Number(targetInfo.episode || 1);
      const files = await getEpisodeFilesFromD1(env, tmdbId, sNum, eNum);
      const targetRow = (targetInfo.fileId ? files.find(f => f.telegram_file_id === targetInfo.fileId) : null) || files[0];
      if (!targetRow) return false;
      const merged = mergeSubtitleArrays(targetRow.subtitles || [], [subItem]);
      await saveEpisodeFileToD1(env, tmdbId, sNum, eNum, {
        ...targetRow,
        fileId: targetRow.telegram_file_id,
        subtitles: merged
      });
      return true;
    }
  }

  // Bereinigt sämtliche doppelten und defekten Stream-Buttons in movie_files und episode_files
  async function dedupeAllD1StreamFiles(env, fallbackChannelId = "") {
    let removedBrokenRows = 0;
    let removedDuplicateRows = 0;
    let upgradedChannelRows = 0;

    for (const [k, v] of memoryFallback.entries()) {
      if (k.startsWith("d1_movie_files_") && Array.isArray(v)) {
        const beforeLen = v.length;
        const cleaned = sortAndDedupeStreamFiles(v);
        if (cleaned.length !== beforeLen) removedDuplicateRows += (beforeLen - cleaned.length);
        memoryFallback.set(k, cleaned);
      } else if (k.startsWith("d1_ep_files_") && Array.isArray(v)) {
        const beforeLen = v.length;
        const byEp = new Map();
        for (const r of v) {
          const epNum = Number(r?.episode_number || 1);
          if (!byEp.has(epNum)) byEp.set(epNum, []);
          byEp.get(epNum).push(r);
        }
        const nextEpList = [];
        for (const [, rows] of byEp.entries()) {
          nextEpList.push(...sortAndDedupeStreamFiles(rows));
        }
        if (nextEpList.length !== beforeLen) removedDuplicateRows += (beforeLen - nextEpList.length);
        memoryFallback.set(k, nextEpList);
      }
    }

    const db = await ensureD1Schema(env);
    if (!db) {
      return { ok: true, removedBrokenRows, removedDuplicateRows, upgradedChannelRows };
    }

    try {
      const parsedFallback = parseAndNormalizeTelegramChannelInput(String(fallbackChannelId || ""));
      const cleanChannelId = parsedFallback.channelId || "";
      if (cleanChannelId && (cleanChannelId.startsWith("-100") || cleanChannelId.startsWith("@"))) {
        const [brokenM, brokenE] = await Promise.all([
          db.prepare("SELECT id, telegram_file_id FROM movie_files WHERE telegram_file_id LIKE 'tg_export_0_%' OR telegram_file_id LIKE 'tg_export_vip_%'").all().catch(() => ({ results: [] })),
          db.prepare("SELECT id, telegram_file_id FROM episode_files WHERE telegram_file_id LIKE 'tg_export_0_%' OR telegram_file_id LIKE 'tg_export_vip_%'").all().catch(() => ({ results: [] }))
        ]);
        for (const r of (brokenM?.results || [])) {
          const msgId = extractExportMessageIdFromFileId(r.telegram_file_id);
          if (msgId > 0) {
            const fixedFid = `tg_export_${cleanChannelId}_${msgId}`;
            await db.prepare("UPDATE movie_files SET telegram_file_id = ?1, telegram_unique_id = ?2, updated_at = ?3 WHERE id = ?4")
              .bind(fixedFid, fixedFid, Date.now(), r.id).run().catch(() => null);
            upgradedChannelRows++;
          }
        }
        for (const r of (brokenE?.results || [])) {
          const msgId = extractExportMessageIdFromFileId(r.telegram_file_id);
          if (msgId > 0) {
            const fixedFid = `tg_export_${cleanChannelId}_${msgId}`;
            await db.prepare("UPDATE episode_files SET telegram_file_id = ?1, telegram_unique_id = ?2, updated_at = ?3 WHERE id = ?4")
              .bind(fixedFid, fixedFid, Date.now(), r.id).run().catch(() => null);
            upgradedChannelRows++;
          }
        }
      }

      const [delM, delE] = await Promise.all([
        db.prepare("DELETE FROM movie_files WHERE telegram_file_id LIKE 'vip_playlist_%' OR telegram_file_id LIKE 'tmdb_card_%'").run().catch(() => ({ meta: { changes: 0 } })),
        db.prepare("DELETE FROM episode_files WHERE telegram_file_id LIKE 'vip_playlist_%' OR telegram_file_id LIKE 'tmdb_card_%'").run().catch(() => ({ meta: { changes: 0 } }))
      ]);
      removedBrokenRows += Number(delM?.meta?.changes || 0) + Number(delE?.meta?.changes || 0);

      const [allMoviesRes, allEpsRes] = await Promise.all([
        db.prepare("SELECT id, movie_id, telegram_file_id, telegram_unique_id, quality, codec, part, file_size, updated_at FROM movie_files ORDER BY updated_at DESC").all().catch(() => ({ results: [] })),
        db.prepare("SELECT id, series_id, season_number, episode_number, telegram_file_id, telegram_unique_id, quality, codec, part, file_size, updated_at FROM episode_files ORDER BY updated_at DESC").all().catch(() => ({ results: [] }))
      ]);

      const movieGroups = new Map();
      for (const row of (allMoviesRes?.results || [])) {
        const mid = Number(row.movie_id);
        if (!movieGroups.has(mid)) movieGroups.set(mid, []);
        movieGroups.get(mid).push(row);
      }

      const epGroups = new Map();
      for (const row of (allEpsRes?.results || [])) {
        const key = `${row.series_id}_${row.season_number}_${row.episode_number}`;
        if (!epGroups.has(key)) epGroups.set(key, []);
        epGroups.get(key).push(row);
      }

      const deleteMovieIds = [];
      const deleteEpIds = [];

      for (const [, rows] of movieGroups.entries()) {
        if (rows.length <= 1) continue;
        const kept = sortAndDedupeStreamFiles(rows);
        const keptIds = new Set(kept.map(x => Number(x.id)));
        for (const r of rows) {
          if (!keptIds.has(Number(r.id))) deleteMovieIds.push(Number(r.id));
        }
      }

      for (const [, rows] of epGroups.entries()) {
        if (rows.length <= 1) continue;
        const kept = sortAndDedupeStreamFiles(rows);
        const keptIds = new Set(kept.map(x => Number(x.id)));
        for (const r of rows) {
          if (!keptIds.has(Number(r.id))) deleteEpIds.push(Number(r.id));
        }
      }

      for (let i = 0; i < deleteMovieIds.length; i += 40) {
        const chunk = deleteMovieIds.slice(i, i + 40);
        const ph = chunk.map((_, idx) => `?${idx + 1}`).join(",");
        await db.prepare(`DELETE FROM movie_files WHERE id IN (${ph})`).bind(...chunk).run().catch(() => null);
      }
      for (let i = 0; i < deleteEpIds.length; i += 40) {
        const chunk = deleteEpIds.slice(i, i + 40);
        const ph = chunk.map((_, idx) => `?${idx + 1}`).join(",");
        await db.prepare(`DELETE FROM episode_files WHERE id IN (${ph})`).bind(...chunk).run().catch(() => null);
      }
      removedDuplicateRows += deleteMovieIds.length + deleteEpIds.length;

      // Bereinige zusätzlich fälschlich gespeicherte Schauspieler-/Personen-Einträge (synthetische Wikidata/Wikipedia IDs >= 8400000)
      const delActors = await db.prepare(`
        DELETE FROM movies
        WHERE tmdb_id >= 8400000
          AND (
            LOWER(details_json) LIKE '%schauspieler%'
            OR LOWER(details_json) LIKE '%actress%'
            OR LOWER(details_json) LIKE '%actor%'
            OR LOWER(details_json) LIKE '%regisseur%'
            OR LOWER(details_json) LIKE '%filmproduzent%'
            OR LOWER(details_json) LIKE '%drehbuchautor%'
            OR LOWER(details_json) LIKE '%synchronsprecher%'
            OR LOWER(details_json) LIKE '%geboren am%'
          )
      `).run().catch(() => ({ meta: { changes: 0 } }));
      if (Number(delActors?.meta?.changes || 0) > 0) {
        removedBrokenRows += Number(delActors.meta.changes);
        await db.prepare("DELETE FROM movie_files WHERE movie_id NOT IN (SELECT tmdb_id FROM movies)").run().catch(() => null);
      }

      // Bereinige verwaiste Geister-Serien & -Filme ohne einzige geloggte Videodatei (z.B. 夢で見たあの子のために (2023) oder reine Serien-Header ohne Episoden-Video)
      const [delOrphanSeries, delOrphanMovies] = await Promise.all([
        db.prepare("DELETE FROM series WHERE tmdb_id NOT IN (SELECT DISTINCT series_id FROM episode_files WHERE telegram_file_id IS NOT NULL AND telegram_file_id != '')").run().catch(() => ({ meta: { changes: 0 } })),
        db.prepare("DELETE FROM movies WHERE tmdb_id NOT IN (SELECT DISTINCT movie_id FROM movie_files WHERE telegram_file_id IS NOT NULL AND telegram_file_id != '')").run().catch(() => ({ meta: { changes: 0 } }))
      ]);
      const orphanSeriesCount = Number(delOrphanSeries?.meta?.changes || 0);
      const orphanMoviesCount = Number(delOrphanMovies?.meta?.changes || 0);
      if (orphanSeriesCount > 0 || orphanMoviesCount > 0) {
        removedBrokenRows += orphanSeriesCount + orphanMoviesCount;
        await Promise.all([
          db.prepare("DELETE FROM series_seasons WHERE series_id NOT IN (SELECT tmdb_id FROM series)").run().catch(() => null),
          db.prepare("DELETE FROM series_episodes WHERE series_id NOT IN (SELECT tmdb_id FROM series)").run().catch(() => null)
        ]);
      }
    } catch (e) {}

    // Zusätzlich Memory-Fallback von leeren Serien ohne gültige Episoden-Dateien bereinigen
    await cleanupEmptySeriesInD1AndMemory(env);

    return {
      ok: true,
      removedBrokenRows,
      removedDuplicateRows,
      upgradedChannelRows
    };
  }

  // Automatische Bereinigung (Cleanup): Löscht alle Serien aus D1 & Memory-Fallback, die 0 gültige Episoden mit verknüpfter Videodatei haben
  async function cleanupEmptySeriesInD1AndMemory(env) {
    let removedSeriesCount = 0;
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        const delRes = await db.prepare(
          "DELETE FROM series WHERE tmdb_id NOT IN (SELECT DISTINCT series_id FROM episode_files WHERE telegram_file_id IS NOT NULL AND telegram_file_id != '')"
        ).run().catch(() => ({ meta: { changes: 0 } }));
        removedSeriesCount += Number(delRes?.meta?.changes || 0);
        if (removedSeriesCount > 0) {
          await Promise.all([
            db.prepare("DELETE FROM series_seasons WHERE series_id NOT IN (SELECT tmdb_id FROM series)").run().catch(() => null),
            db.prepare("DELETE FROM series_episodes WHERE series_id NOT IN (SELECT tmdb_id FROM series)").run().catch(() => null)
          ]);
        }
      } catch (e) {}
    }

    // Memory-Fallback prüfen: Serien ohne gültige Episoden-Dateien entfernen
    const validSeriesIdsInMem = new Set();
    for (const [k, v] of memoryFallback.entries()) {
      if (k.startsWith("d1_ep_files_") && Array.isArray(v)) {
        const hasValidFile = v.some(ep => Boolean(ep && (ep.telegram_file_id || ep.fileId || ep.file_id || ep.message_id)));
        if (hasValidFile) {
          const parts = k.split("_");
          const sid = Number(parts[3]);
          if (sid) validSeriesIdsInMem.add(sid);
        }
      }
    }
    for (const [k, v] of Array.from(memoryFallback.entries())) {
      if ((k.startsWith("d1_catalog_series_") || k.startsWith("d1_series_")) && v && v.id) {
        const sid = Number(v.id);
        if (sid && !validSeriesIdsInMem.has(sid)) {
          // Prüfe falls DB aktiv ist, ob dort Episoden liegen
          let hasDbEps = false;
          if (db) {
            const row = await db.prepare("SELECT 1 AS ok FROM episode_files WHERE series_id = ?1 AND telegram_file_id IS NOT NULL AND telegram_file_id != '' LIMIT 1").bind(sid).first().catch(() => null);
            hasDbEps = Boolean(row?.ok);
          }
          if (!hasDbEps) {
            memoryFallback.delete(k);
            removedSeriesCount++;
          }
        }
      }
    }
    return removedSeriesCount;
  }

  // 1-Klick Komplett-Reset: Löscht alle Filme, Serien, Episoden, Datei-Links, Caches & Playlisten
  // (Benutzerkonten, VIP-Status und Admin-Rechte in 'users' bleiben unberührt!)
  async function resetAllMediaAndPlaylistsInD1AndKv(env) {
    let deletedTables = 0;
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db.batch([
          db.prepare("DELETE FROM episode_files"),
          db.prepare("DELETE FROM series_episodes"),
          db.prepare("DELETE FROM series_seasons"),
          db.prepare("DELETE FROM series"),
          db.prepare("DELETE FROM movie_files"),
          db.prepare("DELETE FROM movies"),
          db.prepare("DELETE FROM search_cache"),
          db.prepare("DELETE FROM entity_cache"),
          db.prepare("DELETE FROM import_queue")
        ]);
        deletedTables = 9;
      } catch (e) {
        const tables = ["episode_files", "series_episodes", "series_seasons", "series", "movie_files", "movies", "search_cache", "entity_cache", "import_queue"];
        for (const tbl of tables) {
          try {
            await db.prepare(`DELETE FROM ${tbl}`).run();
            deletedTables++;
          } catch (err) {}
        }
      }
    }

    tmdbCache.clear();
    for (const k of Array.from(memoryFallback.keys())) {
      if (
        k.startsWith("d1_") ||
        k.startsWith("saved_") ||
        k.startsWith("folders_") ||
        k.startsWith("bot_vip") ||
        k.startsWith("tma_import_checkpoint") ||
        k.startsWith("tma_backup_import_checkpoint")
      ) {
        memoryFallback.delete(k);
      }
    }
    const kvStore = env.MOVIE_SAVED || env.KV;
    if (kvStore) {
      await kvStore.delete("tma_backup_import_checkpoint_v1").catch(() => {});
    }

    await saveRawList(env, "bot_vip", []);
    await saveFolders(env, "bot_vip", []);
    await saveBotVipHiddenKeys(env, new Set());
    await ensureBotVipDefaultPlaylist(env);

    return {
      ok: true,
      deletedTables,
      message: "Komplett-Reset erfolgreich: Alle Filme, Serien, Datei-IDs, Caches und Playlisten wurden restlos gelöscht. Benutzer- und VIP-Konten blieben erhalten."
    };
  }

  async function getSeriesSeasonsAndEpisodeTitlesFromD1(env, seriesId, seasonNumber = null) {
    const sid = Number(seriesId);
    if (!sid) return { seasonCounts: {}, episodeTitleMap: new Map() };
    const seasonCounts = {};
    const episodeTitleMap = new Map();
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        const [sRes, epRes] = await Promise.all([
          db.prepare("SELECT season_number, COUNT(DISTINCT episode_number) AS ep_cnt FROM episode_files WHERE series_id = ?1 GROUP BY season_number ORDER BY season_number ASC")
            .bind(sid)
            .all()
            .catch(() => ({ results: [] })),
          seasonNumber !== null
            ? db.prepare("SELECT episode_number, title, overview, vote_average, versions_json FROM series_episodes WHERE series_id = ?1 AND season_number = ?2")
                .bind(sid, Number(seasonNumber))
                .all()
                .catch(() => ({ results: [] }))
            : Promise.resolve({ results: [] })
        ]);
        for (const r of (sRes?.results || [])) {
          const sn = Number(r.season_number || 1);
          if (sn > 0) seasonCounts[sn] = Number(r.ep_cnt || 0);
        }
        for (const r of (epRes?.results || [])) {
          const en = Number(r.episode_number || 1);
          if (en > 0) {
            episodeTitleMap.set(en, {
              title: r.title || `Folge ${en}`,
              overview: r.overview || "",
              vote_average: Number(r.vote_average || 0),
              versions_json: r.versions_json || "[]"
            });
          }
        }
      } catch (e) {}
    }
    for (const [k, v] of memoryFallback.entries()) {
      if (k.startsWith(`d1_ep_files_${sid}_`) && Array.isArray(v)) {
        const sn = Number(k.split("_").pop() || 1);
        if (sn > 0) {
          const distinctEps = new Set(v.map(x => Number(x?.episode_number || 1)));
          seasonCounts[sn] = Math.max(seasonCounts[sn] || 0, distinctEps.size);
          if (seasonNumber !== null && sn === Number(seasonNumber)) {
            for (const x of v) {
              const en = Number(x?.episode_number || 1);
              if (en > 0 && !episodeTitleMap.has(en) && x?.episode_title) {
                episodeTitleMap.set(en, { title: x.episode_title, overview: "", vote_average: 0, versions_json: "[]" });
              }
            }
          }
        }
      }
    }
    return { seasonCounts, episodeTitleMap };
  }

  // Berechnet für alle Serien in D1 + RAM fehlende Folgen (Priorität 1: Interne Staffel-Lücken wie E01+E02 fehlt vor E03; Priorität 2: Fehlende Folgen bis Staffelende)
  async function computeSeriesGapsOverview(env) {
    const db = await ensureD1Schema(env);
    const seriesMap = new Map();
    const seasonMetaBySeries = new Map();
    const uploadedBySeriesSeason = new Map();

    if (db) {
      try {
        trackStat("d1Reads");
        const [sRes, ssRes, efRes] = await db.batch([
          db.prepare("SELECT tmdb_id, title, release_year, poster_path, number_of_seasons, number_of_episodes, details_json FROM series"),
          db.prepare("SELECT series_id, season_number, episodes_json FROM series_seasons"),
          db.prepare("SELECT series_id, season_number, episode_number, quality, version_label, raw_filename, raw_caption, tags FROM episode_files")
        ]);
        for (const r of (sRes?.results || [])) {
          if (!r || !r.tmdb_id) continue;
          let details = null;
          try { details = r.details_json ? JSON.parse(r.details_json) : null; } catch (_) {}
          seriesMap.set(Number(r.tmdb_id), {
            tmdbId: Number(r.tmdb_id),
            title: r.title || details?.title || `Serie #${r.tmdb_id}`,
            year: r.release_year || (details?.releaseDate ? String(details.releaseDate).split("-")[0] : "k.A."),
            poster: resolvePosterUrl(r.poster_path || details?.poster_path, "w185", details?.external_poster_url || ""),
            numberOfSeasons: Number(r.number_of_seasons || details?.numberOfSeasons || 1),
            detailsSeasons: Array.isArray(details?.seasons) ? details.seasons : []
          });
        }
        for (const sr of (ssRes?.results || [])) {
          const sid = Number(sr?.series_id || 0);
          const sNum = Number(sr?.season_number || 0);
          if (!sid || !sNum) continue;
          let epCount = 0;
          try {
            const parsed = JSON.parse(sr.episodes_json || "{}");
            const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.episodes) ? parsed.episodes : []);
            epCount = Number(parsed?.seasonEpisodeCount || arr.length || 0);
          } catch (_) {}
          if (!seasonMetaBySeries.has(sid)) seasonMetaBySeries.set(sid, new Map());
          if (epCount > 0) seasonMetaBySeries.get(sid).set(sNum, epCount);
        }
        for (const ef of (efRes?.results || [])) {
          const sid = Number(ef?.series_id || 0);
          const sNum = Number(ef?.season_number || 1);
          const eNum = Number(ef?.episode_number || 0);
          if (!sid || !sNum || eNum <= 0) continue;
          const key = `${sid}_${sNum}`;
          if (!uploadedBySeriesSeason.has(key)) uploadedBySeriesSeason.set(key, new Map());
          const epMap = uploadedBySeriesSeason.get(key);
          const isPre = isPrereleaseOrMicDub(ef.raw_caption, ef.raw_filename, ef.tags || ef.version_label);
          const existing = epMap.get(eNum);
          if (!existing || (existing.isPrerelease && !isPre)) {
            epMap.set(eNum, { episode: eNum, quality: ef.quality || "1080p", isPrerelease: isPre });
          }
        }
      } catch (e) {}
    }

    // Merge Memory-Fallback Serien & Episoden
    for (const [k, v] of memoryFallback.entries()) {
      if (k.startsWith("d1_series_") && !k.startsWith("d1_series_best_quality_") && v && typeof v === "object" && v.id) {
        const sid = Number(v.id);
        if (!seriesMap.has(sid)) {
          seriesMap.set(sid, {
            tmdbId: sid,
            title: v.title || `Serie #${sid}`,
            year: v.releaseDate ? String(v.releaseDate).split("-")[0] : "k.A.",
            poster: resolvePosterUrl(v.poster_path, "w185", v.external_poster_url || ""),
            numberOfSeasons: Number(v.numberOfSeasons || v.seasons?.length || 1),
            detailsSeasons: Array.isArray(v.seasons) ? v.seasons : []
          });
        }
      } else if (k.startsWith("d1_ep_files_") && Array.isArray(v)) {
        const parts = k.replace("d1_ep_files_", "").split("_");
        const sid = Number(parts[0] || 0);
        const sNum = Number(parts[1] || 1);
        if (sid > 0 && sNum > 0) {
          const key = `${sid}_${sNum}`;
          if (!uploadedBySeriesSeason.has(key)) uploadedBySeriesSeason.set(key, new Map());
          const epMap = uploadedBySeriesSeason.get(key);
          for (const ef of v) {
            const eNum = Number(ef?.episode_number || 0);
            if (eNum <= 0) continue;
            const isPre = isPrereleaseOrMicDub(ef.raw_caption, ef.raw_filename, ef.tags || ef.version_label);
            const existing = epMap.get(eNum);
            if (!existing || (existing.isPrerelease && !isPre)) {
              epMap.set(eNum, { episode: eNum, quality: ef.quality || "1080p", isPrerelease: isPre });
            }
          }
        }
      }
    }

    const seriesGapsList = [];
    let totalSeriesWithInternalGaps = 0;
    let totalInternalMissingEpisodes = 0;
    let totalTrailingMissingEpisodes = 0;

    for (const [key, epMap] of uploadedBySeriesSeason.entries()) {
      if (!epMap || epMap.size === 0) continue;
      const [sidStr, sNumStr] = key.split("_");
      const sid = Number(sidStr);
      const sNum = Number(sNumStr);
      const sMeta = seriesMap.get(sid) || {
        tmdbId: sid,
        title: memoryFallback.get(`title_cache_s_${sid}`) || `Serie #${sid}`,
        year: "k.A.",
        poster: "",
        numberOfSeasons: sNum,
        detailsSeasons: []
      };

      const presentEps = Array.from(epMap.keys()).sort((a, b) => a - b);
      const maxUploadedEp = presentEps[presentEps.length - 1] || 0;
      const prereleaseEps = Array.from(epMap.values()).filter(x => x.isPrerelease).map(x => x.episode);

      let officialCount = seasonMetaBySeries.get(sid)?.get(sNum) || 0;
      if (!officialCount && Array.isArray(sMeta.detailsSeasons)) {
        const foundSeason = sMeta.detailsSeasons.find(s => Number(s?.season_number) === sNum);
        if (foundSeason && Number(foundSeason.episode_count) > 0) {
          officialCount = Number(foundSeason.episode_count);
        }
      }
      const effectiveTotalExpected = Math.max(officialCount || 0, maxUploadedEp);

      // Priorität 1: Interne Lücken innerhalb der Staffel (1 .. maxUploadedEp, z.B. Folge 1+2 fehlt während Folge 3 vorhanden ist!)
      const missingInternal = [];
      for (let ep = 1; ep <= maxUploadedEp; ep++) {
        if (!epMap.has(ep)) missingInternal.push(ep);
      }

      // Zusammenhängende Lücken-Blöcke (insb. Multi-Episode-Gaps wie "Episode 1 & 2 missing, 3 exists") berechnen
      const internalGapRanges = [];
      const gapHighlights = [];
      let hasMultiEpisodeGap = false;
      if (missingInternal.length > 0) {
        let rangeStart = missingInternal[0];
        let rangeEnd = missingInternal[0];
        for (let idx = 1; idx <= missingInternal.length; idx++) {
          const cur = missingInternal[idx];
          if (cur === rangeEnd + 1) {
            rangeEnd = cur;
          } else {
            const count = rangeEnd - rangeStart + 1;
            const nextExisting = presentEps.find(p => p > rangeEnd) || (rangeEnd + 1);
            const isMulti = count >= 2;
            if (isMulti) hasMultiEpisodeGap = true;
            const labelDe = count === 1
              ? `Folge ${rangeStart} fehlt (Folge ${nextExisting} vorhanden)`
              : count === 2
                ? `Folge ${rangeStart} & ${rangeEnd} fehlen (Folge ${nextExisting} vorhanden)`
                : `Folge ${rangeStart}–${rangeEnd} fehlen (${count} Folgen vor Folge ${nextExisting})`;
            const labelEn = count === 1
              ? `Episode ${rangeStart} missing, ${nextExisting} exists`
              : count === 2
                ? `Episode ${rangeStart} & ${rangeEnd} missing, ${nextExisting} exists`
                : `Episodes ${rangeStart}–${rangeEnd} missing, ${nextExisting} exists`;
            internalGapRanges.push({
              startEpisode: rangeStart,
              endEpisode: rangeEnd,
              count,
              nextExistingEpisode: nextExisting,
              isMultiEpisodeGap: isMulti,
              labelDe,
              labelEn
            });
            gapHighlights.push(labelDe);
            if (cur !== undefined) {
              rangeStart = cur;
              rangeEnd = cur;
            }
          }
        }
      }

      // Priorität 2: Fehlende Folgen am Staffelende (maxUploadedEp + 1 .. effectiveTotalExpected)
      const missingTrailing = [];
      if (effectiveTotalExpected > maxUploadedEp) {
        for (let ep = maxUploadedEp + 1; ep <= Math.min(effectiveTotalExpected, 250); ep++) {
          missingTrailing.push(ep);
        }
      }

      if (missingInternal.length === 0 && missingTrailing.length === 0 && prereleaseEps.length === 0) {
        continue;
      }

      totalInternalMissingEpisodes += missingInternal.length;
      totalTrailingMissingEpisodes += missingTrailing.length;

      let seriesObj = seriesGapsList.find(x => x.tmdbId === sid);
      if (!seriesObj) {
        seriesObj = {
          tmdbId: sid,
          title: sMeta.title,
          year: sMeta.year,
          poster: sMeta.poster,
          hasInternalGaps: false,
          hasMultiEpisodeGap: false,
          internalMissingCount: 0,
          trailingMissingCount: 0,
          seasons: []
        };
        seriesGapsList.push(seriesObj);
      }
      if (missingInternal.length > 0) seriesObj.hasInternalGaps = true;
      if (hasMultiEpisodeGap) seriesObj.hasMultiEpisodeGap = true;
      seriesObj.internalMissingCount += missingInternal.length;
      seriesObj.trailingMissingCount += missingTrailing.length;
      seriesObj.seasons.push({
        seasonNumber: sNum,
        presentEpisodes: presentEps,
        prereleaseEpisodes: prereleaseEps,
        maxUploadedEp,
        expectedTotalEpisodes: effectiveTotalExpected,
        missingInternal,
        missingTrailing,
        hasMultiEpisodeGap,
        internalGapRanges,
        gapHighlights
      });
    }

    let totalSeriesWithMultiEpisodeGaps = 0;
    for (const s of seriesGapsList) {
      s.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
      if (s.hasInternalGaps) totalSeriesWithInternalGaps++;
      if (s.hasMultiEpisodeGap) totalSeriesWithMultiEpisodeGaps++;
    }

    // Sortiere Serien mit Multi-Episode-Gaps (z.B. E01+E02 fehlt vor E03) und internen Staffel-Lücken immer ganz nach oben!
    seriesGapsList.sort((a, b) => {
      if (a.hasMultiEpisodeGap !== b.hasMultiEpisodeGap) return a.hasMultiEpisodeGap ? -1 : 1;
      if (a.hasInternalGaps !== b.hasInternalGaps) return a.hasInternalGaps ? -1 : 1;
      if (b.internalMissingCount !== a.internalMissingCount) return b.internalMissingCount - a.internalMissingCount;
      if (b.trailingMissingCount !== a.trailingMissingCount) return b.trailingMissingCount - a.trailingMissingCount;
      return String(a.title || "").localeCompare(String(b.title || ""), "de");
    });

    return {
      totalSeriesWithGaps: seriesGapsList.length,
      totalSeriesWithInternalGaps,
      totalSeriesWithMultiEpisodeGaps,
      totalInternalMissingEpisodes,
      totalTrailingMissingEpisodes,
      series: seriesGapsList
    };
  }

  async function getEpisodeFilesFromD1(env, seriesId, seasonNumber, episodeNumber = null) {
    if (!seriesId) return [];
    const sid = Number(seriesId);
    const sNum = Number(seasonNumber || 1);
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        if (episodeNumber !== null) {
          const res = await db
            .prepare("SELECT id, series_id, season_number, episode_number, telegram_file_id, telegram_unique_id, quality, codec, part, tags, version_label, file_size, mime_type, raw_filename, raw_caption, message_link, subtitles_json, updated_at FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3 ORDER BY updated_at DESC")
            .bind(sid, sNum, Number(episodeNumber))
            .all();
          if (Array.isArray(res?.results) && res.results.length > 0) return sortAndDedupeStreamFiles(res.results.map(enrichStreamFileRowMeta));
        } else {
          const resAll = await db
            .prepare("SELECT id, series_id, season_number, episode_number, telegram_file_id, telegram_unique_id, quality, codec, part, tags, version_label, file_size, mime_type, raw_filename, raw_caption, message_link, subtitles_json, updated_at FROM episode_files WHERE series_id = ?1 AND season_number = ?2 ORDER BY episode_number ASC, updated_at DESC")
            .bind(sid, sNum)
            .all();
          if (Array.isArray(resAll?.results) && resAll.results.length > 0) {
            const byEp = new Map();
            for (const row of resAll.results.map(enrichStreamFileRowMeta)) {
              const epKey = Number(row.episode_number || 1);
              if (!byEp.has(epKey)) byEp.set(epKey, []);
              byEp.get(epKey).push(row);
            }
            const merged = [];
            for (const [, epRows] of byEp.entries()) {
              merged.push(...sortAndDedupeStreamFiles(epRows));
            }
            return merged;
          }
        }
      } catch (e) {}
    }
    const memFiles = memoryFallback.get(`d1_ep_files_${sid}_${sNum}`);
    if (!Array.isArray(memFiles)) return [];
    if (episodeNumber !== null) {
      return sortAndDedupeStreamFiles(memFiles.filter(f => Number(f.episode_number) === Number(episodeNumber)).map(enrichStreamFileRowMeta));
    }
    const byEp = new Map();
    for (const row of memFiles.map(enrichStreamFileRowMeta)) {
      const epKey = Number(row.episode_number || 1);
      if (!byEp.has(epKey)) byEp.set(epKey, []);
      byEp.get(epKey).push(row);
    }
    const merged = [];
    for (const [, epRows] of byEp.entries()) {
      merged.push(...sortAndDedupeStreamFiles(epRows));
    }
    return merged;
  }

  // Ersetzt eine synthetische Export-Referenz (tg_export_<channelId>_<msgId>) dauerhaft durch eine echte Telegram file_id in D1 + Memory
  async function replaceExportFileIdInD1(env, oldExportFileId, realTelegramFileId, realUniqueId = null) {
    if (!oldExportFileId || !realTelegramFileId || oldExportFileId === realTelegramFileId) return false;
    let updatedAny = false;
    try {
      for (const [k, v] of memoryFallback.entries()) {
        if ((k.startsWith("d1_movie_files_") || k.startsWith("d1_ep_files_")) && Array.isArray(v)) {
          for (const item of v) {
            if (item && item.telegram_file_id === oldExportFileId) {
              item.telegram_file_id = realTelegramFileId;
              if (realUniqueId) item.telegram_unique_id = realUniqueId;
              updatedAny = true;
            }
          }
        }
      }
      const db = await ensureD1Schema(env);
      if (db) {
        trackStat("d1Writes");
        await db.batch([
          db.prepare("UPDATE movie_files SET telegram_file_id = ?1, telegram_unique_id = COALESCE(?2, telegram_unique_id), updated_at = ?3 WHERE telegram_file_id = ?4")
            .bind(realTelegramFileId, realUniqueId, Date.now(), oldExportFileId),
          db.prepare("UPDATE episode_files SET telegram_file_id = ?1, telegram_unique_id = COALESCE(?2, telegram_unique_id), updated_at = ?3 WHERE telegram_file_id = ?4")
            .bind(realTelegramFileId, realUniqueId, Date.now(), oldExportFileId)
        ]);
        updatedAny = true;
      }
    } catch (e) {}
    return updatedAny;
  }

  function rankQualityLabel(q) {
    const s = String(q || "").toUpperCase();
    if (s.includes("2160") || s.includes("4K") || s.includes("UHD")) return 40;
    if (s.includes("1440") || s.includes("2K")) return 30;
    if (s.includes("1080") || s.includes("FHD")) return 20;
    if (s.includes("720") || s.includes("HD")) return 10;
    return 5;
  }

  async function attachVipQualitiesToMediaList(env, items, fallbackTypeCode = "m", hasVipStreamAccess = false) {
    if (!Array.isArray(items) || items.length === 0) return items || [];

    const movieIds = [];
    const seriesIds = [];
    for (const it of items) {
      if (!it || !it.id) continue;
      const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : fallbackTypeCode;
      if (tc === "s") seriesIds.push(Number(it.id));
      else movieIds.push(Number(it.id));
    }

    const bestMovieMap = new Map();
    const bestSeriesMap = new Map();
    const posterMap = new Map();

    // 1. Memory-Fallback & L1-Cache prüfen (auch für fehlende Poster!)
    for (const mid of movieIds) {
      const cachedM = getCachedTmdb(`movie_${mid}`) || memoryFallback.get(`d1_catalog_movie_${mid}`);
      if (cachedM && (cachedM.poster_path || cachedM.external_poster_url)) {
        posterMap.set(`m_${mid}`, cachedM.poster_path || cachedM.external_poster_url);
      }
      if (hasVipStreamAccess) {
        const mFiles = memoryFallback.get(`d1_movie_files_${mid}`);
        if (Array.isArray(mFiles) && mFiles.length > 0) {
          const sorted = sortAndDedupeStreamFiles(mFiles);
          const top = sorted[0];
          if (top) {
            bestMovieMap.set(mid, {
              label: `${top.quality || "1080p"}${top.codec ? " " + top.codec : ""}`.trim(),
              count: sorted.length
            });
          }
        }
      }
    }
    for (const sid of seriesIds) {
      const cachedS = getCachedTmdb(`tv_${sid}`) || memoryFallback.get(`d1_catalog_series_${sid}`);
      if (cachedS && (cachedS.poster_path || cachedS.external_poster_url)) {
        posterMap.set(`s_${sid}`, cachedS.poster_path || cachedS.external_poster_url);
      }
      if (hasVipStreamAccess) {
        const memBest = memoryFallback.get(`d1_series_best_quality_${sid}`);
        if (memBest) {
          bestSeriesMap.set(sid, { label: String(memBest), count: 1 });
        }
      }
    }

    // 2. D1-Datenbank prüfen (für VIP-Qualitäten UND fehlende Poster aus movies / series)
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        if (movieIds.length > 0) {
          const uniqM = [...new Set(movieIds)].slice(0, 60);
          const placeholders = uniqM.map((_, i) => `?${i + 1}`).join(",");
          const [resMPoster, resMFiles] = await Promise.all([
            db.prepare(`SELECT tmdb_id, poster_path, details_json FROM movies WHERE tmdb_id IN (${placeholders})`).bind(...uniqM).all().catch(() => ({ results: [] })),
            hasVipStreamAccess
              ? db.prepare(`SELECT movie_id, quality, codec FROM movie_files WHERE movie_id IN (${placeholders})`).bind(...uniqM).all().catch(() => ({ results: [] }))
              : Promise.resolve({ results: [] })
          ]);
          for (const row of (resMPoster?.results || [])) {
            const mid = Number(row.tmdb_id);
            let pVal = row.poster_path || "";
            if (!pVal && row.details_json) {
              try { pVal = JSON.parse(row.details_json)?.external_poster_url || ""; } catch (e) {}
            }
            if (pVal) posterMap.set(`m_${mid}`, pVal);
          }
          for (const row of (resMFiles?.results || [])) {
            const mid = Number(row.movie_id);
            const cur = bestMovieMap.get(mid);
            const candLabel = `${row.quality || "1080p"}${row.codec ? " " + row.codec : ""}`.trim();
            if (!cur || rankQualityLabel(row.quality) > rankQualityLabel(cur.label)) {
              bestMovieMap.set(mid, { label: candLabel, count: (cur?.count || 0) + 1 });
            } else {
              cur.count += 1;
            }
          }
        }
        if (seriesIds.length > 0) {
          const uniqS = [...new Set(seriesIds)].slice(0, 60);
          const placeholders = uniqS.map((_, i) => `?${i + 1}`).join(",");
          const [resSPoster, resSFiles, resSEps] = await Promise.all([
            db.prepare(`SELECT tmdb_id, poster_path, details_json FROM series WHERE tmdb_id IN (${placeholders})`).bind(...uniqS).all().catch(() => ({ results: [] })),
            hasVipStreamAccess
              ? db.prepare(`SELECT series_id, quality, codec FROM episode_files WHERE series_id IN (${placeholders})`).bind(...uniqS).all().catch(() => ({ results: [] }))
              : Promise.resolve({ results: [] }),
            hasVipStreamAccess
              ? db.prepare(`SELECT series_id, COUNT(*) AS ep_cnt FROM series_episodes WHERE series_id IN (${placeholders}) GROUP BY series_id`).bind(...uniqS).all().catch(() => ({ results: [] }))
              : Promise.resolve({ results: [] })
          ]);
          for (const row of (resSPoster?.results || [])) {
            const sid = Number(row.tmdb_id);
            let pVal = row.poster_path || "";
            if (!pVal && row.details_json) {
              try { pVal = JSON.parse(row.details_json)?.external_poster_url || ""; } catch (e) {}
            }
            if (pVal) posterMap.set(`s_${sid}`, pVal);
          }
          for (const row of (resSFiles?.results || [])) {
            const sid = Number(row.series_id);
            const cur = bestSeriesMap.get(sid);
            const candLabel = `${row.quality || "1080p"}${row.codec ? " " + row.codec : ""}`.trim();
            if (!cur || rankQualityLabel(row.quality) > rankQualityLabel(cur.label)) {
              bestSeriesMap.set(sid, { label: candLabel, count: (cur?.count || 0) + 1 });
            } else {
              cur.count += 1;
            }
          }
          for (const row of (resSEps?.results || [])) {
            const sid = Number(row.series_id);
            if (!bestSeriesMap.has(sid) && Number(row.ep_cnt || 0) > 0) {
              bestSeriesMap.set(sid, { label: "1080p", count: Number(row.ep_cnt || 1) });
            }
          }
        }
      } catch (e) {}
    }

    // 3. Für bis zu 6 Einträge auf der Seite, denen in de-DE weiterhin das Poster fehlt, direkt EN/Internationales Poster nachladen!
    const missingPosterItems = items.filter(it => {
      if (!it || !it.id) return false;
      const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : fallbackTypeCode;
      return !it.poster_path && !it.external_poster_url && !posterMap.has(`${tc}_${Number(it.id)}`) && Number(it.id) < 8000000;
    }).slice(0, 6);

    if (missingPosterItems.length > 0 && env?.TMDB_BEARER_TOKEN) {
      await Promise.all(missingPosterItems.map(async (it) => {
        const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : fallbackTypeCode;
        const endpoint = tc === "s" ? "tv" : "movie";
        const tid = Number(it.id);
        try {
          const imgData = await cachedExternalFetchJson(
            `https://api.themoviedb.org/3/${endpoint}/${tid}/images?include_image_language=de,en,null`,
            { headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` } },
            2800
          );
          const foundPath = imgData?.posters?.[0]?.file_path || "";
          if (foundPath) {
            posterMap.set(`${tc}_${tid}`, foundPath);
          }
        } catch (e) {}
      }));
    }

    return items.map(it => {
      if (!it || !it.id) return it;
      const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : fallbackTypeCode;
      const tid = Number(it.id);
      const copy = { ...it };
      const resolvedP = copy.poster_path || copy.external_poster_url || posterMap.get(`${tc}_${tid}`) || "";
      if (!copy.poster_path && resolvedP) {
        copy.poster_path = resolvedP;
      }
      if (!hasVipStreamAccess) {
        delete copy.vipQuality;
        delete copy.vipStreamCount;
        return copy;
      }
      const match = tc === "s" ? bestSeriesMap.get(tid) : bestMovieMap.get(tid);
      if (!match) return copy;
      return {
        ...copy,
        vipQuality: match.label,
        vipStreamCount: match.count
      };
    });
  }

  // Exklusiver VIP-Stream-Filter (#13):
  // Wenn `onlyVipStreams` in den Einstellungen aktiviert ist UND der Nutzer VIP-Zugriff hat,
  // werden nur Filme/Serien behalten, für die tatsächlich mindestens ein Stream in D1 hinterlegt ist.
  async function applyVipStreamsOnlyFilterIfActive(env, items, fallbackTypeCode = "m", settingsObj = null, hasVipStreamAccess = false) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const withVip = await attachVipQualitiesToMediaList(env, items, fallbackTypeCode, hasVipStreamAccess);
    if (!hasVipStreamAccess || !settingsObj || !settingsObj.onlyVipStreams) {
      return withVip;
    }
    return withVip.filter(it => Boolean(it && it.vipQuality));
  }

  async function getMovieFromD1(env, movieId) {
    const db = await ensureD1Schema(env);
    if (!db || !movieId) return null;
    try {
      trackStat("d1Reads");
      const row = await db
        .prepare("SELECT telegraph_url, details_json, updated_at FROM movies WHERE tmdb_id = ?1")
        .bind(Number(movieId))
        .first();
      if (!row || !row.details_json) return null;
      if (Date.now() - Number(row.updated_at || 0) > D1_MOVIE_TTL_MS) return null;
      const parsed = JSON.parse(row.details_json);
      if (parsed && parsed.title) {
        if (row.telegraph_url && !parsed.telegraphUrl) {
          parsed.telegraphUrl = row.telegraph_url;
        }
        trackStat("d1Hits");
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  async function saveMovieToD1(env, movieObj) {
    if (!movieObj || !movieObj.id) return;
    memoryFallback.set(`d1_catalog_movie_${Number(movieObj.id)}`, movieObj);
    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      trackStat("d1Writes");
      const releaseYear = movieObj.releaseDate && movieObj.releaseDate !== "Keine Angabe"
        ? parseInt(String(movieObj.releaseDate).split("-")[0], 10) || null
        : null;
      await db
        .prepare(`INSERT OR REPLACE INTO movies (
          tmdb_id, title, release_date, release_year, fsk, vote_average, runtime,
          country, genres, directors, casts, overview, is_english_fallback,
          providers, poster_path, backdrop_path, trailer_key,
          collection_id, collection_name, telegraph_url, details_json, updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22
        )`)
        .bind(
          Number(movieObj.id),
          String(movieObj.title || "Unbekannt"),
          String(movieObj.releaseDate || "Keine Angabe"),
          releaseYear,
          String(movieObj.fsk || "FSK Keine Angabe"),
          Number(movieObj.vote_average || 0),
          String(movieObj.runtime || "Keine Angabe"),
          String(movieObj.country || "k.A."),
          String(movieObj.genres || "Keine Angabe"),
          String(movieObj.directors || "Keine Angabe"),
          String(movieObj.casts || "Keine Angabe"),
          String(movieObj.overview || ""),
          movieObj.isEnglishFallback ? 1 : 0,
          movieObj.providers ? String(movieObj.providers) : null,
          movieObj.poster_path ? String(movieObj.poster_path) : null,
          movieObj.backdrop_path ? String(movieObj.backdrop_path) : null,
          movieObj.trailerKey ? String(movieObj.trailerKey) : null,
          movieObj.collection?.id ? Number(movieObj.collection.id) : null,
          movieObj.collection?.name ? String(movieObj.collection.name) : null,
          movieObj.telegraphUrl ? String(movieObj.telegraphUrl) : null,
          JSON.stringify(movieObj),
          Date.now()
        )
        .run();
    } catch (e) {}
  }

  async function getSeriesFromD1(env, seriesId) {
    const db = await ensureD1Schema(env);
    if (!db || !seriesId) return null;
    try {
      trackStat("d1Reads");
      const row = await db
        .prepare("SELECT telegraph_url, details_json, updated_at FROM series WHERE tmdb_id = ?1")
        .bind(Number(seriesId))
        .first();
      if (!row || !row.details_json) return null;
      if (Date.now() - Number(row.updated_at || 0) > D1_MOVIE_TTL_MS) return null;
      const parsed = JSON.parse(row.details_json);
      if (parsed && parsed.title) {
        if (row.telegraph_url && !parsed.telegraphUrl) {
          parsed.telegraphUrl = row.telegraph_url;
        }
        trackStat("d1Hits");
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  // Bereinigt automatisch Geister-Episoden (z.B. S01E14 bis S01E22 bei Haus des Geldes),
  // deren episode_number über der Folgenanzahl der aktiven Episode-Group (maxEpisodeCount) liegt.
  async function pruneGhostEpisodesInD1(env, seriesId, seasonNumber, maxEpisodeCount) {
    const sid = Number(seriesId);
    const sNum = Number(seasonNumber);
    const maxEp = Number(maxEpisodeCount);
    if (!sid || !sNum || !maxEp || maxEp <= 0) return;

    const memKey = `d1_ep_files_${sid}_${sNum}`;
    const existingMem = memoryFallback.get(memKey);
    if (Array.isArray(existingMem)) {
      memoryFallback.set(memKey, existingMem.filter(x => Number(x?.episode_number || 1) <= maxEp));
    }

    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      const stmts = [
        db.prepare(`DELETE FROM series_episodes
          WHERE series_id = ?1
            AND season_number = ?2
            AND episode_number > ?3`).bind(sid, sNum, maxEp)
      ];
      if (FORCE_EPISODE_GROUP_SERIES.has(sid)) {
        stmts.push(
          db.prepare(`DELETE FROM episode_files
            WHERE series_id = ?1
              AND season_number = ?2
              AND episode_number > ?3`).bind(sid, sNum, maxEp)
        );
      }
      await db.batch(stmts);
    } catch (e) {}
  }

  async function saveSeriesToD1(env, seriesObj) {
    if (!seriesObj || !seriesObj.id) return;
    const sid = Number(seriesObj.id);
    memoryFallback.set(`d1_catalog_series_${sid}`, seriesObj);
    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      trackStat("d1Writes");
      const releaseYear = seriesObj.releaseDate && seriesObj.releaseDate !== "Keine Angabe"
        ? parseInt(String(seriesObj.releaseDate).split("-")[0], 10) || null
        : null;
      const stmts = [
        db
          .prepare(`INSERT OR REPLACE INTO series (
            tmdb_id, title, release_date, release_year, fsk, status_text, vote_average,
            runtime, country, genres, directors, casts, overview, is_english_fallback,
            providers, poster_path, backdrop_path, trailer_key,
            number_of_seasons, number_of_episodes, telegraph_url, details_json, updated_at
          ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23
          )`)
          .bind(
            sid,
            String(seriesObj.title || "Unbekannt"),
            String(seriesObj.releaseDate || "Keine Angabe"),
            releaseYear,
            String(seriesObj.fsk || "FSK Keine Angabe"),
            String(seriesObj.statusText || "Unbekannt"),
            Number(seriesObj.vote_average || 0),
            String(seriesObj.runtime || "Keine Angabe"),
            String(seriesObj.country || "k.A."),
            String(seriesObj.genres || "Keine Angabe"),
            String(seriesObj.directors || "Keine Angabe"),
            String(seriesObj.casts || "Keine Angabe"),
            String(seriesObj.overview || ""),
            seriesObj.isEnglishFallback ? 1 : 0,
            seriesObj.providers ? String(seriesObj.providers) : null,
            seriesObj.poster_path ? String(seriesObj.poster_path) : null,
            seriesObj.backdrop_path ? String(seriesObj.backdrop_path) : null,
            seriesObj.trailerKey ? String(seriesObj.trailerKey) : null,
            Number(seriesObj.numberOfSeasons || 1),
            Number(seriesObj.numberOfEpisodes || 0),
            seriesObj.telegraphUrl ? String(seriesObj.telegraphUrl) : null,
            JSON.stringify(seriesObj),
            Date.now()
          )
      ];

      // Bestehende Karteileichen (episode_number > seasonEpisodeCount) gebündelt im selben db.batch bereinigen (1 Subrequest statt N!)
      if (Array.isArray(seriesObj.seasons)) {
        for (const s of seriesObj.seasons) {
          const sNum = Number(s?.season_number || 0);
          const maxEp = Number(s?.episode_count || 0);
          if (sNum > 0 && maxEp > 0) {
            const memKey = `d1_ep_files_${sid}_${sNum}`;
            const existingMem = memoryFallback.get(memKey);
            if (Array.isArray(existingMem)) {
              memoryFallback.set(memKey, existingMem.filter(x => Number(x?.episode_number || 1) <= maxEp));
            }
            stmts.push(
              db.prepare("DELETE FROM series_episodes WHERE series_id = ?1 AND season_number = ?2 AND episode_number > ?3").bind(sid, sNum, maxEp)
            );
            if (FORCE_EPISODE_GROUP_SERIES.has(sid)) {
              stmts.push(
                db.prepare("DELETE FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number > ?3").bind(sid, sNum, maxEp)
              );
            }
          }
        }
      }
      await db.batch(stmts);
    } catch (e) {}
  }

  async function getSeasonFromD1(env, seriesId, seasonNumber) {
    const db = await ensureD1Schema(env);
    if (!db || !seriesId) return null;
    try {
      trackStat("d1Reads");
      const row = await db
        .prepare("SELECT telegraph_url, episodes_json, updated_at FROM series_seasons WHERE series_id = ?1 AND season_number = ?2")
        .bind(Number(seriesId), Number(seasonNumber))
        .first();
      if (!row || !row.episodes_json) return null;
      if (Date.now() - Number(row.updated_at || 0) > D1_MOVIE_TTL_MS) return null;
      const parsed = JSON.parse(row.episodes_json);
      if (parsed && Array.isArray(parsed.episodes)) {
        if (row.telegraph_url && !parsed.telegraphUrl) {
          parsed.telegraphUrl = row.telegraph_url;
        }
        trackStat("d1Hits");
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  async function saveSeasonToD1(env, seriesId, seasonNumber, seasonObj) {
    const db = await ensureD1Schema(env);
    if (!db || !seriesId || !seasonObj) return;
    try {
      trackStat("d1Writes");
      const rawMaxEpCount = Number(seasonObj.seasonEpisodeCount || (Array.isArray(seasonObj.episodes) ? seasonObj.episodes.length : 0));
      let highestUploadedEp = 0;
      try {
        const uploadedFiles = await getSeasonEpisodeFilesFromD1(env, seriesId, seasonNumber);
        highestUploadedEp = Math.max(0, ...(uploadedFiles || []).map(f => Number(f.episode_number || 0)));
      } catch (e) {}
      const maxEpCount = FORCE_EPISODE_GROUP_SERIES.has(Number(seriesId)) && rawMaxEpCount > 0
        ? rawMaxEpCount
        : Math.max(rawMaxEpCount, highestUploadedEp);
      const cleanEpisodes = Array.isArray(seasonObj.episodes)
        ? (maxEpCount > 0 ? seasonObj.episodes.filter(ep => Number(ep.episode_number || 1) <= maxEpCount) : seasonObj.episodes)
        : [];
      const cleanSeasonObj = {
        ...seasonObj,
        episodes: cleanEpisodes
      };

      await db
        .prepare(`INSERT OR REPLACE INTO series_seasons (
          series_id, season_number, name, telegraph_url, episodes_json, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(
          Number(seriesId),
          Number(seasonNumber),
          String(cleanSeasonObj.name || `Staffel ${seasonNumber}`),
          cleanSeasonObj.telegraphUrl ? String(cleanSeasonObj.telegraphUrl) : null,
          JSON.stringify(cleanSeasonObj),
          Date.now()
        )
        .run();

      // Speichere zusätzlich alle Episoden einzeln in series_episodes (inkl. vorhandener telegraph_url)
      if (cleanEpisodes.length > 0) {
        const statements = cleanEpisodes.slice(0, 60).map(ep =>
          db.prepare(`INSERT INTO series_episodes (
            series_id, season_number, episode_number, title, overview, air_date, runtime, vote_average, telegraph_url, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
          ON CONFLICT(series_id, season_number, episode_number) DO UPDATE SET
            title = excluded.title,
            overview = excluded.overview,
            air_date = excluded.air_date,
            runtime = excluded.runtime,
            vote_average = excluded.vote_average,
            telegraph_url = COALESCE(excluded.telegraph_url, series_episodes.telegraph_url),
            updated_at = excluded.updated_at`).bind(
            Number(seriesId),
            Number(seasonNumber),
            Number(ep.episode_number || 1),
            String(ep.name || `Folge ${ep.episode_number || 1}`),
            String(ep.overview || ""),
            String(ep.air_date || ""),
            String(ep.runtime || ""),
            Number(ep.vote_average || 0),
            ep.telegraphUrl ? String(ep.telegraphUrl) : null,
            Date.now()
          )
        );
        await db.batch(statements);
      }

      if (maxEpCount > 0) {
        await pruneGhostEpisodesInD1(env, seriesId, seasonNumber, maxEpCount);
      }
    } catch (e) {}
  }

  async function getEpisodeFromD1(env, seriesId, seasonNumber, episodeNumber) {
    const db = await ensureD1Schema(env);
    if (!db || !seriesId) return null;
    try {
      trackStat("d1Reads");
      const row = await db
        .prepare("SELECT title, overview, air_date, runtime, vote_average, telegraph_url FROM series_episodes WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3")
        .bind(Number(seriesId), Number(seasonNumber), Number(episodeNumber))
        .first();
      if (row) {
        trackStat("d1Hits");
        return row;
      }
    } catch (e) {}
    return null;
  }

  async function saveEpisodeTelegraphToD1(env, seriesId, seasonNumber, episodeNumber, epObj, telegraphUrl) {
    const db = await ensureD1Schema(env);
    if (!db || !seriesId || !telegraphUrl) return;
    try {
      trackStat("d1Writes");
      await db
        .prepare(`INSERT INTO series_episodes (
          series_id, season_number, episode_number, title, overview, air_date, runtime, vote_average, telegraph_url, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(series_id, season_number, episode_number) DO UPDATE SET
          telegraph_url = excluded.telegraph_url,
          updated_at = excluded.updated_at`)
        .bind(
          Number(seriesId),
          Number(seasonNumber),
          Number(episodeNumber),
          String(epObj?.name || epObj?.title || `Folge ${episodeNumber}`),
          String(epObj?.overview || ""),
          String(epObj?.air_date || ""),
          String(epObj?.runtime || ""),
          Number(epObj?.vote_average || 0),
          String(telegraphUrl),
          Date.now()
        )
        .run();
    } catch (e) {}
  }

  async function getSearchCacheFromD1(env, cacheKey) {
    const db = await ensureD1Schema(env);
    if (!db || !cacheKey) return null;
    try {
      trackStat("d1Reads");
      const row = await db
        .prepare("SELECT response_json, updated_at FROM search_cache WHERE cache_key = ?1")
        .bind(String(cacheKey))
        .first();
      if (!row || !row.response_json) return null;
      if (Date.now() - Number(row.updated_at || 0) > D1_SEARCH_TTL_MS) return null;
      const parsed = JSON.parse(row.response_json);
      if (parsed && Array.isArray(parsed.results)) {
        trackStat("d1Hits");
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  async function saveSearchCacheToD1(env, cacheKey, query, page, dataObj) {
    const db = await ensureD1Schema(env);
    if (!db || !cacheKey || !dataObj) return;
    try {
      trackStat("d1Writes");
      await db
        .prepare(`INSERT OR REPLACE INTO search_cache (
          cache_key, query, page, response_json, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5)`)
        .bind(
          String(cacheKey),
          String(query || "").toLowerCase(),
          Number(page || 1),
          JSON.stringify(dataObj),
          Date.now()
        )
        .run();
    } catch (e) {}
  }

  async function getEntityFromD1(env, cacheKey, ttlMs = D1_SEARCH_TTL_MS) {
    const db = await ensureD1Schema(env);
    if (!db || !cacheKey) return null;
    try {
      trackStat("d1Reads");
      const row = await db
        .prepare("SELECT data_json, updated_at FROM entity_cache WHERE cache_key = ?1")
        .bind(String(cacheKey))
        .first();
      if (!row || !row.data_json) return null;
      if (Date.now() - Number(row.updated_at || 0) > ttlMs) return null;
      const parsed = JSON.parse(row.data_json);
      if (parsed) {
        trackStat("d1Hits");
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  async function saveEntityToD1(env, cacheKey, entityType, dataObj) {
    const db = await ensureD1Schema(env);
    if (!db || !cacheKey || !dataObj) return;
    try {
      trackStat("d1Writes");
      await db
        .prepare(`INSERT OR REPLACE INTO entity_cache (
          cache_key, entity_type, data_json, updated_at
        ) VALUES (?1, ?2, ?3, ?4)`)
        .bind(String(cacheKey), String(entityType || "misc"), JSON.stringify(dataObj), Date.now())
        .run();
    } catch (e) {}
  }

  async function getD1DatabaseStats(env) {
    const db = await ensureD1Schema(env);
    if (!db) return { enabled: false, moviesCount: 0, seriesCount: 0, searchesCount: 0 };
    try {
      const [mRow, sRow, qRow] = await Promise.all([
        db.prepare("SELECT COUNT(*) AS cnt FROM movies").first(),
        db.prepare("SELECT COUNT(*) AS cnt FROM series").first(),
        db.prepare("SELECT COUNT(*) AS cnt FROM search_cache").first()
      ]);
      return {
        enabled: true,
        moviesCount: Number(mRow?.cnt || 0),
        seriesCount: Number(sRow?.cnt || 0),
        searchesCount: Number(qRow?.cnt || 0)
      };
    } catch (e) {
      return { enabled: true, moviesCount: 0, seriesCount: 0, searchesCount: 0 };
    }
  }
