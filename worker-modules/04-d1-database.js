  // @DEPARTMENT: 04-d1-database | 4. Cloudflare D1 Datenbank (Filme, Serien & Logs)
  // @ANCHOR: D1_MOVIES
  // ============================================================================
  // CLOUDFLARE D1 (SQLite) PERSISTENTE FILMDATENBANK ZUR API-MINIMIERUNG
  // Speichert jeden gesuchten/abgerufenen Film, jede Serie, Staffeln, Kollektionen,
  // Personen und Suchanfragen dauerhaft in SQLite (env.DB oder env.MOVIE_DB).
  // ============================================================================
  let d1SchemaInitialized = false;
  let d1SchemaInitPromise = null;
  let activeD1WriteBuffer = null;
  let activeD1WriteBufferStartedAt = 0;
  let activeD1WriteBufferDepth = 0;
  const D1_SCHEMA_VERSION = "20261125_v7";
  const D1_MOVIE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage gültig für Film-/Serien-Details
  const D1_SEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage gültig für Suchseiten & Listen

  function isD1BufferEligibleWrite(sqlStr) {
    const s = String(sqlStr || "");
    if (!/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s)) return false;
    // Kritische Nutzer-, Auth-, Checkpoint-, Meldungs-, Anti-Spam-, Staging-Inbox- & History-Tabellen NIEMALS im Import-Batch-Puffer verzögern!
    if (/\b(?:users|media_reports|tg_anti_spam_queue|entity_cache|import_queue|d1_import_checkpoints|channel_ingest_inbox|history_index_channels|history_crawl_jobs|archive_topic_map|archive_mirror_queue)\b/i.test(s)) {
      return false;
    }
    return true;
  }

  function getD1BufferScope() {
    const reqCtx = typeof getActiveWorkerRequestContext === "function" ? getActiveWorkerRequestContext() : null;
    if (reqCtx) return reqCtx;
    return null;
  }

  function hasLiveD1WriteBuffer() {
    const scope = getD1BufferScope();
    if (scope) {
      if (!Array.isArray(scope.d1WriteBuffer) || scope.d1WriteBufferDepth <= 0) return false;
      if (scope.d1WriteBufferStartedAt > 0 && (Date.now() - scope.d1WriteBufferStartedAt) > 25000) {
        scope.d1WriteBuffer = null;
        scope.d1WriteBufferStartedAt = 0;
        scope.d1WriteBufferDepth = 0;
        return false;
      }
      if (scope.d1WriteBuffer.length >= 250) return false;
      return true;
    }
    if (!Array.isArray(activeD1WriteBuffer) || activeD1WriteBufferDepth <= 0) return false;
    // Sicherheits-Timeout & Größen-Cap: verhindert unkontrolliertes Anwachsen oder hängende Buffer nach Absturz
    if (activeD1WriteBufferStartedAt > 0 && (Date.now() - activeD1WriteBufferStartedAt) > 25000) {
      activeD1WriteBuffer = null;
      activeD1WriteBufferStartedAt = 0;
      activeD1WriteBufferDepth = 0;
      return false;
    }
    if (activeD1WriteBuffer.length >= 250) return false;
    return true;
  }

  function pushToD1WriteBuffer(rawStmt) {
    const scope = getD1BufferScope();
    if (scope && Array.isArray(scope.d1WriteBuffer)) {
      scope.d1WriteBuffer.push(rawStmt);
      return;
    }
    if (Array.isArray(activeD1WriteBuffer)) {
      activeD1WriteBuffer.push(rawStmt);
    }
  }

  function countD1Subrequest() {
    // D1-Queries zählen bei Cloudflare Workers NICHT gegen das 50-fetch/KV-Subrequest-Limit,
    // werden aber sauber als d1OpsCount für Telemetrie & CPU-Budget gezählt!
    const tel = typeof getActiveWorkerTelemetry === "function"
      ? getActiveWorkerTelemetry()
      : (typeof activeWorkerTelemetry === "object" ? activeWorkerTelemetry : null);
    if (tel) {
      tel.d1OpsCount = (tel.d1OpsCount || 0) + 1;
    }
  }

  function getRawD1Binding(env) {
    if (!env) return null;
    return env.DB || env.MOVIE_DB || null;
  }

  function unwrapRawD1Statements(stmts) {
    if (!Array.isArray(stmts)) return [];
    return stmts.map(s => (s && s._rawStmt) ? s._rawStmt : s).filter(Boolean);
  }

  function wrapD1Stmt(rawStmt, sqlStr) {
    if (!rawStmt) return rawStmt;
    const isWriteStmt = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(String(sqlStr || ""));
    const bufferEligible = isD1BufferEligibleWrite(sqlStr);
    return {
      _rawStmt: rawStmt,
      _isWriteStmt: isWriteStmt,
      _bufferEligible: bufferEligible,
      _sql: sqlStr,
      bind(...args) {
        const boundRaw = rawStmt.bind(...args);
        return wrapD1Stmt(boundRaw, sqlStr);
      },
      async first(...args) {
        countD1Subrequest();
        return await rawStmt.first(...args);
      },
      async all(...args) {
        countD1Subrequest();
        return await rawStmt.all(...args);
      },
      async raw(...args) {
        countD1Subrequest();
        return await rawStmt.raw(...args);
      },
      async run(...args) {
        if (hasLiveD1WriteBuffer() && bufferEligible) {
          pushToD1WriteBuffer(rawStmt);
          return { success: true, buffered: true, meta: { changes: 1 } };
        }
        countD1Subrequest();
        return await rawStmt.run(...args);
      }
    };
  }

  function getD1Binding(env) {
    const rawDb = getRawD1Binding(env);
    if (!rawDb) return null;
    if (rawDb._trackedWrapper) return rawDb._trackedWrapper;
    const wrapper = {
      _rawDb: rawDb,
      prepare(sql) {
        return wrapD1Stmt(rawDb.prepare(sql), sql);
      },
      async batch(stmts) {
        if (!Array.isArray(stmts) || stmts.length === 0) return [];
        const allBufferEligible = stmts.every(s => Boolean(s && s._bufferEligible));
        const rawStmts = unwrapRawD1Statements(stmts);
        if (hasLiveD1WriteBuffer() && allBufferEligible) {
          for (const rs of rawStmts) {
            pushToD1WriteBuffer(rs);
          }
          return rawStmts.map(() => ({ success: true, buffered: true }));
        }
        countD1Subrequest();
        return await rawDb.batch(rawStmts);
      },
      async exec(sql) {
        countD1Subrequest();
        return await rawDb.exec(sql);
      }
    };
    try {
      rawDb._trackedWrapper = wrapper;
    } catch (e) {}
    return wrapper;
  }

  function beginD1BatchBuffer() {
    const scope = getD1BufferScope();
    if (scope) {
      scope.d1WriteBufferDepth = Math.max(0, Number(scope.d1WriteBufferDepth || 0)) + 1;
      if (!Array.isArray(scope.d1WriteBuffer)) {
        scope.d1WriteBuffer = [];
      }
      scope.d1WriteBufferStartedAt = Date.now();
      return;
    }
    activeD1WriteBufferDepth = Math.max(0, Number(activeD1WriteBufferDepth || 0)) + 1;
    if (!Array.isArray(activeD1WriteBuffer)) {
      activeD1WriteBuffer = [];
    }
    activeD1WriteBufferStartedAt = Date.now();
  }

  async function flushD1BatchBuffer(env) {
    const scope = getD1BufferScope();
    let pending = [];
    if (scope) {
      scope.d1WriteBufferDepth = Math.max(0, Number(scope.d1WriteBufferDepth || 0) - 1);
      pending = Array.isArray(scope.d1WriteBuffer) ? scope.d1WriteBuffer.splice(0, scope.d1WriteBuffer.length) : [];
      if (scope.d1WriteBufferDepth <= 0) {
        scope.d1WriteBuffer = null;
        scope.d1WriteBufferStartedAt = 0;
        scope.d1WriteBufferDepth = 0;
      }
    } else {
      activeD1WriteBufferDepth = Math.max(0, Number(activeD1WriteBufferDepth || 0) - 1);
      pending = Array.isArray(activeD1WriteBuffer) ? activeD1WriteBuffer.splice(0, activeD1WriteBuffer.length) : [];
      if (activeD1WriteBufferDepth <= 0) {
        activeD1WriteBuffer = null;
        activeD1WriteBufferStartedAt = 0;
        activeD1WriteBufferDepth = 0;
      }
    }
    if (pending.length === 0) return 0;
    memoryFallback.delete("d1_series_gaps_cache");
    memoryFallback.delete("d1_vip_discover_cache_m");
    memoryFallback.delete("d1_vip_discover_cache_s");
    memoryFallback.delete("d1_vip_discover_rows_m");
    memoryFallback.delete("d1_vip_discover_rows_s");
    memoryFallback.delete("d1_catalog_preseed_cache");
    memoryFallback.delete("d1_all_series_ep_map_cache");
    memoryFallback.delete("d1_admin_media_list_cache_m");
    memoryFallback.delete("d1_admin_media_list_cache_s");
    memoryFallback.delete("d1_db_stats_cache");
    for (const k of memoryFallback.keys()) {
      if (k.startsWith("d1_all_ep_files_")) memoryFallback.delete(k);
    }
    const rawDb = getRawD1Binding(env);
    if (!rawDb) return 0;
    let flushedCount = 0;
    const rawPending = unwrapRawD1Statements(pending);
    const CHUNK_SIZE = 80;
    for (let i = 0; i < rawPending.length; i += CHUNK_SIZE) {
      const chunk = rawPending.slice(i, i + CHUNK_SIZE);
      try {
        countD1Subrequest();
        await rawDb.batch(chunk);
        flushedCount += chunk.length;
      } catch (batchErr) {
        // Fallback: falls ein einzelnes Statement im Sammel-Batch fehlschlägt, führe alle übrigen Schreibbefehle garantiert einzeln aus (kein Verwerfen!)
        for (const singleStmt of chunk) {
          try {
            countD1Subrequest();
            await singleStmt.run();
            flushedCount++;
          } catch (singleErr) {}
        }
      }
    }
    return flushedCount;
  }

  async function ensureD1Schema(env) {
    const db = getD1Binding(env);
    if (!db || d1SchemaInitialized) return db;
    if (d1SchemaInitPromise) {
      await d1SchemaInitPromise;
      return db;
    }
    const rawDb = getRawD1Binding(env) || db;
    d1SchemaInitPromise = (async () => {
      // Cold-Start Fast-Path (Free Plan Schutz): 1 einzelner D1-Read prüft die Schema-Version
      // und überspringt alle 26 CREATE TABLE/INDEX DDL-Statements + sqlite_master-Inspektion!
      try {
        countD1Subrequest();
        const verRow = await rawDb
          .prepare("SELECT data_json FROM entity_cache WHERE cache_key = ?1")
          .bind("d1_schema_version")
          .first();
        if (verRow && String(verRow.data_json || "") === D1_SCHEMA_VERSION) {
          d1SchemaInitialized = true;
          d1SchemaInitPromise = null;
          return;
        }
      } catch (_fastPathErr) {
        // Tabelle existiert noch nicht -> vollständige Erst-Initialisierung unten ausführen
      }
      try {
        countD1Subrequest();
        await rawDb.batch(unwrapRawD1Statements([
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
            manual_override INTEGER DEFAULT 0,
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
            manual_override INTEGER DEFAULT 0,
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
            file_fingerprint TEXT,
            quality TEXT DEFAULT '1080p',
            codec TEXT DEFAULT 'x264',
            part TEXT,
            part_number INTEGER DEFAULT 1,
            edition_label TEXT,
            is_bonus INTEGER DEFAULT 0,
            is_download_only INTEGER DEFAULT 0,
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
            file_fingerprint TEXT,
            quality TEXT DEFAULT '1080p',
            codec TEXT DEFAULT 'x264',
            part TEXT,
            part_number INTEGER DEFAULT 1,
            edition_label TEXT,
            is_bonus INTEGER DEFAULT 0,
            is_download_only INTEGER DEFAULT 0,
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
            review_reason_code TEXT,
            reason TEXT,
            file_name TEXT,
            text_preview TEXT,
            parsed_title TEXT,
            matched_title TEXT,
            season INTEGER,
            episode INTEGER,
            tmdb_query TEXT,
            tmdb_result TEXT,
            tmdb_id INTEGER,
            type_code TEXT,
            details_json TEXT,
            created_at INTEGER NOT NULL
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS d1_playlists (
            folder_id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT DEFAULT 'playlist',
            is_json_playlist INTEGER DEFAULT 1,
            playlist_mode TEXT DEFAULT 'both',
            source_label TEXT,
            enabled INTEGER DEFAULT 1,
            keep_when_empty INTEGER DEFAULT 1,
            tmdb_ref_id TEXT,
            original_name TEXT,
            linked INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS d1_playlist_items (
            uid TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            folder_id TEXT NOT NULL,
            tmdb_id INTEGER NOT NULL,
            content_type TEXT NOT NULL,
            title TEXT NOT NULL,
            year TEXT,
            fsk TEXT,
            genres TEXT,
            poster_path TEXT,
            backdrop_path TEXT,
            vote_average REAL DEFAULT 0,
            vip_quality TEXT,
            vip_stream_count INTEGER DEFAULT 0,
            series_id INTEGER,
            series_title TEXT,
            season_number INTEGER,
            episode_number INTEGER,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (chat_id, uid)
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS d1_import_checkpoints (
            job_key TEXT PRIMARY KEY,
            file_name TEXT,
            cursor INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0,
            saved_movies INTEGER DEFAULT 0,
            saved_episodes INTEGER DEFAULT 0,
            skipped INTEGER DEFAULT 0,
            conflicts INTEGER DEFAULT 0,
            errors INTEGER DEFAULT 0,
            playlist_name TEXT,
            playlist_mode TEXT,
            playlist_folder_id TEXT,
            playlist_items_added INTEGER DEFAULT 0,
            verified_channel_id TEXT,
            updated_at INTEGER NOT NULL
          )`),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_movie_files_movie_id ON movie_files(movie_id)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_movie_files_fid ON movie_files(telegram_file_id)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_episode_files_series_ep ON episode_files(series_id, season_number, episode_number)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_episode_files_fid ON episode_files(telegram_file_id)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_series_episodes_series ON series_episodes(series_id, season_number)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_media_reports_status ON media_reports(status, created_at)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_diag_logs_status ON import_diagnostic_logs(status, id)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_diag_logs_msg ON import_diagnostic_logs(msg_id)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_d1_playlists_chat ON d1_playlists(chat_id, created_at)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_d1_playlist_items_folder ON d1_playlist_items(chat_id, folder_id, added_at DESC)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_d1_playlist_items_chat_added ON d1_playlist_items(chat_id, added_at DESC)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_d1_playlist_items_tmdb ON d1_playlist_items(tmdb_id, content_type)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_tg_anti_spam_queue_status_sched ON tg_anti_spam_queue(status, scheduled_at ASC)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at DESC)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_movies_updated_at ON movies(updated_at DESC)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_series_updated_at ON series(updated_at DESC)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_movie_files_updated_at ON movie_files(updated_at DESC)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_episode_files_updated_at ON episode_files(updated_at DESC)"),
          db.prepare(`CREATE TABLE IF NOT EXISTS channel_ingest_inbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            chat_title TEXT,
            message_id INTEGER NOT NULL,
            reply_to_message_id INTEGER,
            media_group_id TEXT,
            msg_kind TEXT NOT NULL DEFAULT 'context',
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            locked_until INTEGER DEFAULT 0,
            result_emoji TEXT,
            reaction_pending INTEGER DEFAULT 0,
            resolved_tmdb_id INTEGER,
            resolved_type TEXT,
            created_at INTEGER NOT NULL,
            processed_at INTEGER DEFAULT 0
          )`),
          db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_inbox_chat_msg ON channel_ingest_inbox(chat_id, message_id)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_ingest_inbox_status_chat_msg ON channel_ingest_inbox(status, chat_id, message_id)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_ingest_inbox_reaction_pending ON channel_ingest_inbox(reaction_pending, chat_id, message_id)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_ingest_inbox_status_processed ON channel_ingest_inbox(status, processed_at)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_entity_cache_type_updated ON entity_cache(entity_type, updated_at DESC)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_search_cache_updated ON search_cache(updated_at)"),
          db.prepare(`CREATE TABLE IF NOT EXISTS history_index_channels (
            channel_id TEXT PRIMARY KEY,
            label TEXT,
            role TEXT NOT NULL DEFAULT 'probe_index',
            enabled INTEGER NOT NULL DEFAULT 1,
            next_allowed_at INTEGER NOT NULL DEFAULT 0,
            cooldown_until INTEGER NOT NULL DEFAULT 0,
            pending_delete_ids_json TEXT NOT NULL DEFAULT '[]',
            last_verified_at INTEGER NOT NULL DEFAULT 0,
            verified_caps_json TEXT,
            updated_at INTEGER NOT NULL
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS history_crawl_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_chat_id TEXT NOT NULL,
            source_title TEXT,
            start_msg_id INTEGER NOT NULL,
            end_msg_id INTEGER NOT NULL,
            direction TEXT NOT NULL DEFAULT 'asc',
            current_cursor_id INTEGER NOT NULL,
            chunk_floor_id INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'queued',
            enable_reactions INTEGER NOT NULL DEFAULT 0,
            enable_archive_mirror INTEGER NOT NULL DEFAULT 0,
            archive_topic_mode TEXT NOT NULL DEFAULT 'type_genre',
            archive_timing TEXT NOT NULL DEFAULT 'live',
            archive_pin_series_card INTEGER NOT NULL DEFAULT 0,
            archive_max_series_topics INTEGER NOT NULL DEFAULT 250,
            cron_enabled INTEGER NOT NULL DEFAULT 1,
            scanned_count INTEGER NOT NULL DEFAULT 0,
            media_found_count INTEGER NOT NULL DEFAULT 0,
            context_found_count INTEGER NOT NULL DEFAULT 0,
            missing_count INTEGER NOT NULL DEFAULT 0,
            skipped_existing_count INTEGER NOT NULL DEFAULT 0,
            noise_skipped_count INTEGER NOT NULL DEFAULT 0,
            error_count INTEGER NOT NULL DEFAULT 0,
            worker_lease_until INTEGER NOT NULL DEFAULT 0,
            flood_until INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_by_admin_id TEXT DEFAULT '',
            notify_flags TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            completed_at INTEGER NOT NULL DEFAULT 0
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS archive_topic_map (
            archive_chat_id TEXT NOT NULL,
            topic_key TEXT NOT NULL,
            message_thread_id INTEGER NOT NULL,
            topic_name TEXT,
            icon_color INTEGER DEFAULT 0,
            pinned_header_msg_id INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (archive_chat_id, topic_key)
          )`),
          db.prepare(`CREATE TABLE IF NOT EXISTS archive_mirror_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL DEFAULT 0,
            archive_chat_id TEXT NOT NULL,
            media_type TEXT NOT NULL,
            tmdb_id INTEGER NOT NULL DEFAULT 0,
            season_number INTEGER NOT NULL DEFAULT 0,
            episode_number INTEGER NOT NULL DEFAULT 0,
            part_number INTEGER NOT NULL DEFAULT 1,
            source_chat_id TEXT,
            source_message_id INTEGER NOT NULL DEFAULT 0,
            file_unique_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            file_kind TEXT NOT NULL DEFAULT 'video',
            topic_key TEXT NOT NULL,
            topic_name TEXT,
            topic_icon_color INTEGER DEFAULT 0,
            series_header_html TEXT,
            series_poster_url TEXT,
            caption_html TEXT NOT NULL,
            cover_url TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            archive_message_id INTEGER NOT NULL DEFAULT 0,
            archive_thread_id INTEGER NOT NULL DEFAULT 0,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )`),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_history_index_channels_role_en ON history_index_channels(role, enabled)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_history_crawl_jobs_status ON history_crawl_jobs(status, id ASC)"),
          db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_mirror_unique ON archive_mirror_queue(archive_chat_id, file_unique_id)"),
          db.prepare("CREATE INDEX IF NOT EXISTS idx_archive_mirror_status_order ON archive_mirror_queue(status, next_attempt_at, media_type, tmdb_id, season_number, episode_number, part_number, id)")
        ]));
      } catch (e) {}

      // Subrequest-sparende Auto-Migration: Prüfe in 1 einziger Abfrage sqlite_master und führe fehlende Spalten gebündelt per rawDb.batch aus
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
          ["episode_files", "subtitles_json", "ALTER TABLE episode_files ADD COLUMN subtitles_json TEXT DEFAULT '[]'"],
          ["movies", "manual_override", "ALTER TABLE movies ADD COLUMN manual_override INTEGER DEFAULT 0"],
          ["series", "manual_override", "ALTER TABLE series ADD COLUMN manual_override INTEGER DEFAULT 0"],
          ["movie_files", "file_fingerprint", "ALTER TABLE movie_files ADD COLUMN file_fingerprint TEXT"],
          ["movie_files", "part_number", "ALTER TABLE movie_files ADD COLUMN part_number INTEGER DEFAULT 1"],
          ["movie_files", "edition_label", "ALTER TABLE movie_files ADD COLUMN edition_label TEXT"],
          ["movie_files", "is_bonus", "ALTER TABLE movie_files ADD COLUMN is_bonus INTEGER DEFAULT 0"],
          ["episode_files", "file_fingerprint", "ALTER TABLE episode_files ADD COLUMN file_fingerprint TEXT"],
          ["episode_files", "part_number", "ALTER TABLE episode_files ADD COLUMN part_number INTEGER DEFAULT 1"],
          ["episode_files", "edition_label", "ALTER TABLE episode_files ADD COLUMN edition_label TEXT"],
          ["episode_files", "is_bonus", "ALTER TABLE episode_files ADD COLUMN is_bonus INTEGER DEFAULT 0"],
          ["movie_files", "is_download_only", "ALTER TABLE movie_files ADD COLUMN is_download_only INTEGER DEFAULT 0"],
          ["episode_files", "is_download_only", "ALTER TABLE episode_files ADD COLUMN is_download_only INTEGER DEFAULT 0"],
          ["import_diagnostic_logs", "review_reason_code", "ALTER TABLE import_diagnostic_logs ADD COLUMN review_reason_code TEXT"],
          ["import_diagnostic_logs", "matched_title", "ALTER TABLE import_diagnostic_logs ADD COLUMN matched_title TEXT"],
          ["channel_ingest_inbox", "ingest_priority", "ALTER TABLE channel_ingest_inbox ADD COLUMN ingest_priority INTEGER NOT NULL DEFAULT 10"],
          ["channel_ingest_inbox", "suppress_reaction", "ALTER TABLE channel_ingest_inbox ADD COLUMN suppress_reaction INTEGER NOT NULL DEFAULT 0"],
          ["channel_ingest_inbox", "source_job_id", "ALTER TABLE channel_ingest_inbox ADD COLUMN source_job_id INTEGER NOT NULL DEFAULT 0"],
          ["history_crawl_jobs", "created_by_admin_id", "ALTER TABLE history_crawl_jobs ADD COLUMN created_by_admin_id TEXT DEFAULT ''"],
          ["history_crawl_jobs", "notify_flags", "ALTER TABLE history_crawl_jobs ADD COLUMN notify_flags TEXT DEFAULT ''"]
        ];
        const alterStmts = [];
        for (const [tbl, col, ddl] of requiredCols) {
          const tblSql = sqlByTable.get(tbl) || "";
          if (tblSql && !new RegExp(`\\b${col}\\b`, "i").test(tblSql)) {
            alterStmts.push(db.prepare(ddl));
          }
        }
        if (alterStmts.length > 0) {
          const rawAlterStmts = unwrapRawD1Statements(alterStmts);
          try {
            countD1Subrequest();
            await rawDb.batch(rawAlterStmts);
          } catch (alterBatchErr) {
            for (const s of rawAlterStmts) {
              try {
                countD1Subrequest();
                await s.run();
              } catch (singleAlterErr) {}
            }
          }
        }
        // Nach den Spalten-Migrationen die neuen Inbox-Prioritäts- & Job-Staging-Indizes sicher anlegen
        try {
          countD1Subrequest();
          await rawDb.batch(unwrapRawD1Statements([
            db.prepare("CREATE INDEX IF NOT EXISTS idx_ingest_inbox_status_prio_msg ON channel_ingest_inbox(status, chat_id, ingest_priority DESC, message_id ASC)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_ingest_inbox_job_status_msg ON channel_ingest_inbox(source_job_id, status, message_id ASC)")
          ]));
        } catch (_idxErr) {}
        try {
          countD1Subrequest();
          await rawDb
            .prepare("INSERT INTO entity_cache (cache_key, entity_type, data_json, updated_at) VALUES (?1, 'system', ?2, ?3) ON CONFLICT(cache_key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at")
            .bind("d1_schema_version", D1_SCHEMA_VERSION, Date.now())
            .run();
        } catch (_saveVerErr) {}
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

  // Batch-Lookup für gecachte Medien-Metadaten (FSK, Studios, Anbieter, Overview, Poster, Logo) in 1 einziger D1-Batch-Abfrage!
  async function getMediaMetaBatchFromD1(env, items = [], fallbackTypeCode = "m") {
    const metaMap = new Map();
    if (!Array.isArray(items) || items.length === 0) return metaMap;
    const movieIdsToQuery = [];
    const seriesIdsToQuery = [];
    for (const it of items) {
      if (!it || !it.id) continue;
      const isTv = it.media_type === "tv" || (it.media_type !== "movie" && fallbackTypeCode === "s");
      const tc = isTv ? "s" : "m";
      const tid = Number(it.id);
      if (!tid) continue;
      const key = `${tc}_${tid}`;
      if (metaMap.has(key)) continue;
      const ramHit = getCachedTmdb(isTv ? `tv_${tid}` : `movie_${tid}`) ||
        memoryFallback.get(isTv ? `d1_catalog_series_${tid}` : `d1_catalog_movie_${tid}`);
      if (ramHit && typeof ramHit === "object") {
        metaMap.set(key, ramHit);
        continue;
      }
      if (isTv) seriesIdsToQuery.push(tid);
      else movieIdsToQuery.push(tid);
    }

    const uniqM = [...new Set(movieIdsToQuery)].slice(0, 40);
    const uniqS = [...new Set(seriesIdsToQuery)].slice(0, 40);
    if (uniqM.length === 0 && uniqS.length === 0) return metaMap;

    const db = await ensureD1Schema(env);
    const rawDb = getRawD1Binding(env);
    if (!db || !rawDb) return metaMap;
    try {
      const stmts = [];
      const kinds = [];
      const entityKeys = [];
      if (uniqM.length > 0) {
        stmts.push(rawDb.prepare(`SELECT tmdb_id, details_json FROM movies WHERE tmdb_id IN (${uniqM.map((_, i) => `?${i + 1}`).join(",")})`).bind(...uniqM));
        kinds.push("m");
        for (const id of uniqM) entityKeys.push(`movie_${id}`);
      }
      if (uniqS.length > 0) {
        stmts.push(rawDb.prepare(`SELECT tmdb_id, details_json FROM series WHERE tmdb_id IN (${uniqS.map((_, i) => `?${i + 1}`).join(",")})`).bind(...uniqS));
        kinds.push("s");
        for (const id of uniqS) entityKeys.push(`tv_${id}`);
      }
      const safeEntityKeys = entityKeys.slice(0, 80);
      if (safeEntityKeys.length > 0) {
        stmts.push(rawDb.prepare(`SELECT cache_key, data_json FROM entity_cache WHERE cache_key IN (${safeEntityKeys.map((_, i) => `?${i + 1}`).join(",")})`).bind(...safeEntityKeys));
        kinds.push("ent");
      }
      trackStat("d1Reads");
      countD1Subrequest();
      const results = await rawDb.batch(stmts);
      for (let i = 0; i < kinds.length; i++) {
        const k = kinds[i];
        const rows = results?.[i]?.results || [];
        for (const row of rows) {
          try {
            if (k === "m" && row.details_json) {
              const parsed = JSON.parse(row.details_json);
              if (parsed && parsed.id) {
                const mk = `m_${Number(row.tmdb_id)}`;
                metaMap.set(mk, parsed);
                setCachedTmdb(`movie_${Number(row.tmdb_id)}`, parsed);
              }
            } else if (k === "s" && row.details_json) {
              const parsed = JSON.parse(row.details_json);
              if (parsed && parsed.id) {
                const sk = `s_${Number(row.tmdb_id)}`;
                metaMap.set(sk, parsed);
                setCachedTmdb(`tv_${Number(row.tmdb_id)}`, parsed);
              }
            } else if (k === "ent" && row.data_json && row.cache_key) {
              const ck = String(row.cache_key);
              const isTvEnt = ck.startsWith("tv_");
              const tid = Number(ck.replace(/^(?:movie_|tv_)/, ""));
              const mk = `${isTvEnt ? "s" : "m"}_${tid}`;
              if (tid && !metaMap.has(mk)) {
                const parsed = JSON.parse(row.data_json);
                if (parsed && parsed.id) {
                  metaMap.set(mk, parsed);
                  setCachedTmdb(ck, parsed);
                }
              }
            }
          } catch (_parseErr) {}
        }
      }
    } catch (_e) {}
    return metaMap;
  }

  // Batch-Lookup für ClearLogos in 1 einziger D1-Abfrage statt 6 einzelner Requests!
  async function getClearLogosBatchFromD1(env, items = [], fallbackTypeCode = "m") {
    const logoMap = new Map();
    if (!Array.isArray(items) || items.length === 0) return logoMap;
    const keysToQuery = [];
    for (const it of items) {
      if (!it || !it.id) continue;
      const isTv = it.typeCode === "s" || it.media_type === "tv" || (it.media_type !== "movie" && it.typeCode !== "m" && fallbackTypeCode === "s");
      const tid = Number(it.id);
      if (!tid || tid >= 8000000) continue;
      const key = `logo_${isTv ? "s" : "m"}_${tid}`;
      if (memoryFallback.has(key)) {
        logoMap.set(`${isTv ? "s" : "m"}_${tid}`, String(memoryFallback.get(key) || ""));
      } else {
        keysToQuery.push(key);
      }
    }
    const uniqKeys = [...new Set(keysToQuery)].slice(0, 24);
    if (uniqKeys.length === 0) return logoMap;
    const db = await ensureD1Schema(env);
    const rawDb = getRawD1Binding(env);
    if (!db || !rawDb) return logoMap;
    try {
      trackStat("d1Reads");
      countD1Subrequest();
      const res = await rawDb
        .prepare(`SELECT cache_key, data_json, updated_at FROM entity_cache WHERE cache_key IN (${uniqKeys.map((_, i) => `?${i + 1}`).join(",")})`)
        .bind(...uniqKeys)
        .all();
      const now = Date.now();
      for (const row of (res?.results || [])) {
        if (!row || !row.cache_key || !row.data_json) continue;
        if (now - Number(row.updated_at || 0) > D1_MOVIE_TTL_MS) continue;
        try {
          const parsed = JSON.parse(row.data_json);
          if (parsed && typeof parsed.logo_path === "string") {
            const lp = String(parsed.logo_path || "");
            memoryFallback.set(row.cache_key, lp);
            logoMap.set(String(row.cache_key).replace(/^logo_/, ""), lp);
          }
        } catch (_e) {}
      }
    } catch (_e) {}
    return logoMap;
  }

  function inferReviewReasonCodeFromLogItem(item) {
    if (!item || typeof item !== "object") return "";
    const explicit = String(
      item.reviewReasonCode ||
      item.review_reason_code ||
      item.details?.reviewReasonCode ||
      item.details?.review_reason_code ||
      ""
    ).trim().toUpperCase();
    if (explicit) return explicit;
    const st = String(item.status || "").trim().toUpperCase();
    const rText = String(item.reason || item.errorReason || "").trim();
    if (st === "OK" || st.startsWith("SKIPPED_")) return "";
    if (st === "TMDB_NOT_FOUND" || /kein(?: passender)?\s+tmdb[-\s]*treffer|kein treffer auf tmdb|kein passender tmdb-eintrag|not[_\s-]*found/i.test(rText)) {
      return "TMDB_NOT_FOUND";
    }
    if (st === "API_ERROR" || /nach wiederholungsversuch isoliert|api[_\s-]*error|timeout/i.test(rText)) {
      return "API_ERROR";
    }
    if (/staffel-konflikt|staffel\s+\d+.*hat nur\s+\d+\s+staffel/i.test(rText)) {
      return "SEASON_CONFLICT";
    }
    if (/jahres-konflikt|jahres-\/kontext-sperre|jahre\s+abweichung/i.test(rText)) {
      return "YEAR_CONFLICT";
    }
    if (/fortsetzungs-\/teil-konflikt|teil-konflikt|sequel/i.test(rText)) {
      return "SEQUEL_CONFLICT";
    }
    if (st === "CONFLICT_?" || st === "CONFLICT" || /niedrige treffer-sicherheit|unsichere zuordnung|kontext-konflikt|mehrdeutig/i.test(rText)) {
      return "PARSER_AMBIGUITY";
    }
    return "";
  }

  // Persistentes Diagnose-Log (D1 + Memory-Fallback) für das Admin-Dashboard [ 🛠️ Diagnose-Log ]
  async function saveImportDiagnosticLogsToD1(env, logsArray, options = {}) {
    if (!Array.isArray(logsArray) || logsArray.length === 0) return;
    const now = Date.now();
    const memKey = "d1_import_diagnostic_logs";
    const existingMem = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];
    // MODUL 1.2: SUBREQUEST_PAUSE NIEMALS in das entries-Array des Loggers schreiben (verdrängt sonst echte Fehler!)
    const validLogsInput = logsArray.filter(item => item && String(item.status || "").trim() !== "SUBREQUEST_PAUSE" && String(item.status || "").trim() !== "SKIPPED_HEADER");
    if (validLogsInput.length === 0) return;
    const normalizedBatch = validLogsInput.map((item, idx) => {
      const rawMsgNum = Number(item.msgId ?? item.msg_id ?? item.message_id ?? 0);
      const normMsgId = Number.isFinite(rawMsgNum) && rawMsgNum > 0
        ? rawMsgNum
        : (item.msgId !== undefined && item.msgId !== null && String(item.msgId).trim() !== "" ? String(item.msgId).trim() : "");
      const rawStatus = String(item.status || "OK").trim();
      const normStatus = rawStatus === "CONFLICT_?" ? "CONFLICT" : rawStatus;
      const resolvedReasonCode = inferReviewReasonCodeFromLogItem({ ...item, status: normStatus });
      const rawDetails = item.details && typeof item.details === "object" ? { ...item.details } : {};
      if (resolvedReasonCode && !rawDetails.reviewReasonCode) {
        rawDetails.reviewReasonCode = resolvedReasonCode;
      }
      // MODUL 6.3: Variablen-Leck im Logger schließen! Bei TMDB_NOT_FOUND, API_ERROR oder SUBREQUEST_PAUSE müssen matchedTitle und tmdbId zwingend null sein!
      const isUnmatchedErrorStatus = normStatus === "TMDB_NOT_FOUND" || normStatus === "API_ERROR" || normStatus === "SUBREQUEST_PAUSE";
      const matchedTitleVal = isUnmatchedErrorStatus
        ? null
        : (String(item.matchedTitle || item.matched_title || rawDetails.matchedTitle || "").trim() || null);
      const resolvedTmdbId = isUnmatchedErrorStatus ? null : (item.tmdbId ? Number(item.tmdbId) : null);
      if (isUnmatchedErrorStatus) {
        delete rawDetails.matchedTitle;
        rawDetails.matchedTitle = null;
      } else if (matchedTitleVal && !rawDetails.matchedTitle) {
        rawDetails.matchedTitle = matchedTitleVal;
      }
      return {
        id: item.id || (now * 100 + idx),
        msgId: normMsgId,
        stage: String(item.stage || "IMPORT"),
        status: normStatus,
        reviewReasonCode: resolvedReasonCode || null,
        reason: String(item.reason || ""),
        fileName: String(item.fileName || ""),
        textPreview: String(item.textPreview || "").slice(0, 260),
        parsedTitle: String(item.parsedTitle || ""),
        matchedTitle: matchedTitleVal,
        season: item.season !== undefined && item.season !== null ? Number(item.season) : null,
        episode: item.episode !== undefined && item.episode !== null ? Number(item.episode) : null,
        tmdbQuery: String(item.tmdbQuery || ""),
        tmdbResult: isUnmatchedErrorStatus ? "Kein Treffer" : String(item.tmdbResult || ""),
        tmdbId: resolvedTmdbId,
        typeCode: item.typeCode ? String(item.typeCode) : null,
        details: rawDetails,
        timestamp: Number(item.timestamp || now)
      };
    });
    // MODUL 5.1: Fehler-Priorität im Log-Buffer + automatisches Ersetzen aufgelöster SUBREQUEST_PAUSE-Einträge!
    const resolvedMsgIdsInBatch = new Set(
      normalizedBatch
        .filter(x => x && x.msgId && x.status !== "SUBREQUEST_PAUSE")
        .map(x => String(x.msgId))
    );
    const cleanedExistingMem = existingMem.filter(x => {
      if (!x) return false;
      if (x.status === "SUBREQUEST_PAUSE" && x.msgId && resolvedMsgIdsInBatch.has(String(x.msgId))) {
        return false;
      }
      return true;
    });
    const allCombined = [...normalizedBatch, ...cleanedExistingMem];
    const isPriorityLogStatus = (st) => st !== "OK" && st !== "SKIPPED_DUPLICATE";
    const priorityLogs = allCombined.filter(x => x && isPriorityLogStatus(String(x.status || "OK")));
    const routineLogs = allCombined.filter(x => x && !isPriorityLogStatus(String(x.status || "OK")));
    const maxBufferSize = 2500;
    const keptPriority = priorityLogs.slice(0, maxBufferSize);
    const remainingSlots = Math.max(0, maxBufferSize - keptPriority.length);
    const mergedMem = [...keptPriority, ...routineLogs.slice(0, remainingSlots)]
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    memoryFallback.set(memKey, mergedMem);

    // D1-Write-Quota-Schutz: Im RAM bleiben alle Einträge sichtbar (mit Fehler-Priorität).
    // In D1 werden dauerhaft bevorzugt Konflikte, Fehler, Nicht-Gefunden und Vorabversionen gespeichert (spart ~85% D1-Writes beim Massen-Import!).
    const rawD1Candidates = options?.persistAll
      ? normalizedBatch
      : normalizedBatch.filter(l => l.status !== "OK" && l.status !== "SKIPPED_DUPLICATE" && l.status !== "SKIPPED_HEADER" && l.status !== "SKIPPED_JUNK");

    const nowPersistedTs = Date.now();
    const d1ToPersist = rawD1Candidates.filter(l => {
      const sigKey = `d1_diag_sig_${l.msgId || ""}_${l.fileName || ""}_${l.status}_${l.tmdbId || 0}`;
      const prevTs = Number(memoryFallback.get(sigKey) || 0);
      if (prevTs > 0 && (nowPersistedTs - prevTs) < 900000) return false;
      memoryFallback.set(sigKey, nowPersistedTs);
      return true;
    });

    const db = await ensureD1Schema(env);
    if (!db || d1ToPersist.length === 0) return;
    memoryFallback.delete("d1_diag_logs_query_cache");
    try {
      const chunkSize = 40;
      for (let i = 0; i < d1ToPersist.length; i += chunkSize) {
        const slice = d1ToPersist.slice(i, i + chunkSize);
        const stmts = slice.map(l =>
          db.prepare(`INSERT INTO import_diagnostic_logs (
            msg_id, stage, status, review_reason_code, reason, file_name, text_preview, parsed_title, matched_title,
            season, episode, tmdb_query, tmdb_result, tmdb_id, type_code, details_json, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`).bind(
            l.msgId,
            l.stage,
            l.status,
            l.reviewReasonCode || null,
            l.reason,
            l.fileName,
            l.textPreview,
            l.parsedTitle,
            l.matchedTitle || null,
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
    if (filterStatus && typeof filterStatus === "object") {
      searchQuery = filterStatus.search || filterStatus.searchQuery || "";
      limit = filterStatus.limit || 1500;
      filterStatus = filterStatus.statusFilter || filterStatus.filterStatus || "ALL";
    }
    const db = await ensureD1Schema(env);
    let d1Rows = [];
    const cachedDiagQuery = memoryFallback.get("d1_diag_logs_query_cache");
    if (cachedDiagQuery && Array.isArray(cachedDiagQuery.rows) && (Date.now() - Number(cachedDiagQuery.ts || 0)) < 45000) {
      d1Rows = cachedDiagQuery.rows;
    } else if (db) {
      try {
        const res = await db
          .prepare("SELECT * FROM import_diagnostic_logs ORDER BY id DESC LIMIT ?1")
          .bind(Math.min(1000, Math.max(50, Number(limit) || 600)))
          .all();
        if (Array.isArray(res?.results)) {
          d1Rows = res.results.map(r => {
            let details = {};
            try {
              if (r.details_json) details = JSON.parse(r.details_json);
            } catch (e) {}
            const normStatus = r.status === "CONFLICT_?" ? "CONFLICT" : (r.status || "OK");
            const isUnmatchedError = normStatus === "TMDB_NOT_FOUND" || normStatus === "API_ERROR" || normStatus === "SUBREQUEST_PAUSE";
            const inferredCode = inferReviewReasonCodeFromLogItem({
              reviewReasonCode: r.review_reason_code || details.reviewReasonCode,
              status: normStatus,
              reason: r.reason,
              details
            });
            return {
              id: r.id,
              msgId: r.msg_id && Number.isFinite(Number(r.msg_id)) ? Number(r.msg_id) : (r.msg_id || ""),
              stage: r.stage || "IMPORT",
              status: normStatus,
              reviewReasonCode: inferredCode || null,
              reason: r.reason || "",
              fileName: r.file_name || "",
              textPreview: r.text_preview || "",
              parsedTitle: r.parsed_title || "",
              matchedTitle: isUnmatchedError ? null : (r.matched_title || details.matchedTitle || null),
              season: r.season !== undefined && r.season !== null ? r.season : null,
              episode: r.episode !== undefined && r.episode !== null ? r.episode : null,
              tmdbQuery: r.tmdb_query || "",
              tmdbResult: isUnmatchedError ? "Kein Treffer" : (r.tmdb_result || ""),
              tmdbId: isUnmatchedError ? null : (r.tmdb_id || null),
              typeCode: r.type_code || null,
              details,
              timestamp: r.created_at || Date.now()
            };
          });
          memoryFallback.set("d1_diag_logs_query_cache", { rows: d1Rows, ts: Date.now() });
        }
      } catch (e) {}
    }
    const memRows = Array.isArray(memoryFallback.get("d1_import_diagnostic_logs"))
      ? memoryFallback.get("d1_import_diagnostic_logs")
      : [];
    const mergedMap = new Map();
    for (const r of [...memRows, ...d1Rows]) {
      if (!r) continue;
      if (r.status === "CONFLICT_?") r.status = "CONFLICT";
      // MODUL 1.2: SUBREQUEST_PAUSE niemals in den Diagnose-Einträgen ausgeben
      if (r.status === "SUBREQUEST_PAUSE" || r.status === "SKIPPED_HEADER") {
        continue;
      }
      if (r.status === "TMDB_NOT_FOUND" || r.status === "API_ERROR") {
        r.matchedTitle = null;
        r.tmdbId = null;
      }
      if (!r.reviewReasonCode) {
        r.reviewReasonCode = inferReviewReasonCodeFromLogItem(r) || null;
      }
      const dedupeKey = `${r.msgId || ""}|${r.fileName || ""}|${r.parsedTitle || ""}|${r.season || ""}|${r.episode || ""}`;
      if (!mergedMap.has(dedupeKey)) {
        mergedMap.set(dedupeKey, r);
      }
    }
    const rows = Array.from(mergedMap.values()).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

    const counts = {
      total: rows.length,
      ok: 0,
      skipped: 0,
      notFound: 0,
      conflict: 0,
      pause: 0,
      byReasonCode: {
        TMDB_NOT_FOUND: 0,
        YEAR_CONFLICT: 0,
        PARSER_AMBIGUITY: 0,
        SEASON_CONFLICT: 0,
        SEQUEL_CONFLICT: 0,
        API_ERROR: 0
      }
    };
    for (const r of rows) {
      const st = String(r.status || "OK");
      if (st === "OK") counts.ok++;
      else if (st.startsWith("SKIPPED_")) counts.skipped++;
      else if (st === "TMDB_NOT_FOUND") counts.notFound++;
      else if (st === "CONFLICT_?" || st === "CONFLICT") counts.conflict++;
      else if (st === "SUBREQUEST_PAUSE" || st === "API_ERROR") counts.pause++;
      if (r.reviewReasonCode && counts.byReasonCode[r.reviewReasonCode] !== undefined) {
        counts.byReasonCode[r.reviewReasonCode]++;
      }
    }

    let filtered = rows;
    if (filterStatus && filterStatus !== "ALL") {
      if (filterStatus === "PROBLEMS") {
        filtered = filtered.filter(r => r.status !== "OK");
      } else if (filterStatus === "SKIPPED") {
        filtered = filtered.filter(r => String(r.status || "").startsWith("SKIPPED_"));
      } else if (filterStatus === "CONFLICT" || filterStatus === "CONFLICT_?") {
        filtered = filtered.filter(r => r.status === "CONFLICT" || r.status === "CONFLICT_?");
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
    memoryFallback.delete("d1_diag_logs_query_cache");

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
    memoryFallback.delete("d1_diag_logs_query_cache");
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

  const IMPORT_QUEUE_META_KEY = "import_queue_meta_v1";

  async function getImportQueueMetaFromD1(env) {
    try {
      const fromD1 = await getEntityFromD1(env, IMPORT_QUEUE_META_KEY, 7 * 86400000);
      if (fromD1 && typeof fromD1 === "object") {
        memoryFallback.set("import_queue_meta", fromD1);
        return fromD1;
      }
    } catch (_e) {}
    return memoryFallback.get("import_queue_meta") || null;
  }

  async function saveImportQueueMetaInD1(env, meta) {
    if (!meta || typeof meta !== "object") return;
    memoryFallback.set("import_queue_meta", meta);
    try {
      await saveEntityToD1(env, IMPORT_QUEUE_META_KEY, "import_queue_meta", meta);
    } catch (_e) {}
  }

  async function getImportQueueStatsFromD1(env) {
    const db = await ensureD1Schema(env);
    const totalMeta = (await getImportQueueMetaFromD1(env)) || {};
    if (db) {
      try {
        trackStat("d1Reads");
        const row = await db.prepare("SELECT COUNT(*) AS cnt, MIN(source_label) AS src FROM import_queue").first();
        const pendingCount = Number(row?.cnt || 0);
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
    try {
      await deleteEntityFromD1(env, IMPORT_QUEUE_META_KEY);
    } catch (_e) {}
    return true;
  }

  function getConfiguredAdminIdSet(env) {
    const candidates = [
      env?.ADMIN_IDS,
      env?.ADMIN_ID,
      env?.TELEGRAM_ADMIN_IDS,
      env?.TELEGRAM_ADMIN_ID,
      env?.ADMIN_TELEGRAM_IDS,
      env?.ADMIN_TELEGRAM_ID,
      env?.ADMIN_USER_IDS,
      env?.ADMIN_USER_ID,
      env?.ADMIN_CHAT_ID,
      env?.ADMIN_CHAT_IDS,
      env?.OWNER_ID
    ];
    const set = new Set();
    for (const raw of candidates) {
      if (raw === undefined || raw === null) continue;
      const cleaned = String(raw).replace(/[\[\]"']/g, " ").trim();
      if (!cleaned) continue;
      for (const token of cleaned.split(/[\s,;]+/)) {
        const idStr = token.trim();
        if (idStr) set.add(idStr);
      }
    }
    return set;
  }

  function isAuthorizedAdminId(env, telegramId) {
    if (!telegramId) return false;
    const tid = String(telegramId).trim();
    if (!tid) return false;
    const allowedSet = getConfiguredAdminIdSet(env);
    if (allowedSet.size === 0) return false;
    return allowedSet.has(tid);
  }

  async function isTelegramBotAdmin(env, telegramId) {
    if (!telegramId) return false;
    if (isAuthorizedAdminId(env, telegramId)) return true;
    try {
      const userRow = await getUserByTelegramIdFromD1(env, String(telegramId));
      return Boolean(userRow && Number(userRow.is_admin) === 1);
    } catch (_e) {
      return false;
    }
  }

  async function getPrimaryBotAdminId(env) {
    const allowedSet = getConfiguredAdminIdSet(env);
    for (const candidate of allowedSet) {
      if (/^\d{5,20}$/.test(String(candidate))) {
        return String(candidate);
      }
    }
    const cached = memoryFallback.get("primary_bot_admin_id_v1");
    if (cached && cached.id && (Date.now() - Number(cached.ts || 0)) < 5 * 60 * 1000) {
      return String(cached.id);
    }
    try {
      const db = await ensureD1Schema(env);
      if (!db) return "";
      trackStat("d1Reads");
      const row = await db.prepare("SELECT telegram_id FROM users WHERE is_admin = 1 ORDER BY created_at ASC LIMIT 1").first();
      const tid = String(row?.telegram_id || "").trim();
      if (/^\d{5,20}$/.test(tid)) {
        memoryFallback.set("primary_bot_admin_id_v1", { id: tid, ts: Date.now() });
        return tid;
      }
    } catch (_e) {}
    return "";
  }

  function formatUserRowForClient(row, env) {
    if (!row) return null;
    const isEnvAdmin = isAuthorizedAdminId(env, row.telegram_id);
    const isAdminFlag = Boolean(row.is_admin || isEnvAdmin);
    return {
      telegramId: String(row.telegram_id),
      tgUsername: row.tg_username || "",
      firstName: row.first_name || "",
      customUsername: row.custom_username || "",
      hasPasswordAccount: Boolean(row.custom_username && row.password_hash),
      totpEnabled: Boolean(row.totp_enabled && row.totp_secret),
      isVip: Boolean(row.is_vip || isAdminFlag),
      isAdmin: isAdminFlag,
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
      is_vip: adminFlag,
      is_admin: adminFlag,
      created_at: now,
      last_seen_at: now
    };
    existingMem.tg_username = tgUsername || existingMem.tg_username;
    existingMem.first_name = firstName || existingMem.first_name;
    if (adminFlag) {
      existingMem.is_admin = 1;
      existingMem.is_vip = 1;
    }
    existingMem.last_seen_at = now;
    existingMem._cachedAt = now;
    memoryFallback.set(memKey, existingMem);

    // RAM-First Debounce: Wenn derselbe User in den letzten 10 Minuten bereits in D1 synchronisiert wurde,
    // spare den D1-Write + D1-Read bei wiederkehrenden Requests komplett ein!
    if (existingMem._d1SyncedAt && (now - Number(existingMem._d1SyncedAt)) < 600000) {
      return formatUserRowForClient(existingMem, env);
    }

    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db
          .prepare(`INSERT INTO users (
            telegram_id, tg_username, first_name, is_vip, is_admin, created_at, last_seen_at
          ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?5)
          ON CONFLICT(telegram_id) DO UPDATE SET
            tg_username = COALESCE(NULLIF(excluded.tg_username, ''), users.tg_username),
            first_name = COALESCE(NULLIF(excluded.first_name, ''), users.first_name),
            is_vip = CASE WHEN excluded.is_admin = 1 THEN 1 ELSE users.is_vip END,
            is_admin = CASE WHEN excluded.is_admin = 1 THEN 1 ELSE users.is_admin END,
            last_seen_at = excluded.last_seen_at`)
          .bind(telegramId, tgUsername, firstName, adminFlag, now)
          .run();

        const row = await db
          .prepare("SELECT * FROM users WHERE telegram_id = ?1")
          .bind(telegramId)
          .first();
        if (row) {
          row._cachedAt = now;
          row._d1SyncedAt = now;
          memoryFallback.set(memKey, row);
          if (row.custom_username) memoryFallback.set(`d1_username_${String(row.custom_username).toLowerCase()}`, telegramId);
          return formatUserRowForClient(row, env);
        }
      } catch (e) {}
    }
    return formatUserRowForClient(existingMem, env);
  }

  async function getUserByTelegramIdFromD1(env, telegramId, forceFresh = false) {
    if (!telegramId || telegramId === "guest") return null;
    const tid = String(telegramId).trim();
    const memKey = `d1_user_${tid}`;
    const envIsAdmin = isAuthorizedAdminId(env, tid);
    const cached = memoryFallback.get(memKey);
    // RAM-First Cache (5 Minuten gültig): Verhindert einen D1-Read bei jedem einzelnen /api/tma/* Aufruf!
    if (!forceFresh && cached && cached.telegram_id && (Date.now() - Number(cached._cachedAt || 0)) < 300000) {
      if (envIsAdmin && !Number(cached.is_admin)) {
        cached.is_admin = 1;
        cached.is_vip = 1;
      }
      return cached;
    }
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const row = await db
          .prepare("SELECT * FROM users WHERE telegram_id = ?1")
          .bind(tid)
          .first();
        if (row) {
          if (envIsAdmin && !Number(row.is_admin)) {
            row.is_admin = 1;
            row.is_vip = 1;
          }
          row._cachedAt = Date.now();
          row._d1SyncedAt = Date.now();
          memoryFallback.set(memKey, row);
          return row;
        }
      } catch (e) {}
    }
    if (cached && envIsAdmin && !Number(cached.is_admin)) {
      cached.is_admin = 1;
      cached.is_vip = 1;
    }
    return cached || null;
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
    const prevRow = (await getUserByTelegramIdFromD1(env, tid)) || {
      telegram_id: tid,
      tg_username: "",
      first_name: "",
      is_vip: 0,
      is_admin: isAuthorizedAdminId(env, tid) ? 1 : 0,
      created_at: now
    };
    const prevUsernameLower = prevRow.custom_username ? String(prevRow.custom_username).toLowerCase() : "";
    const nextRow = {
      ...prevRow,
      custom_username: cleanUser,
      password_hash: passwordHash,
      password_salt: passwordSalt,
      last_seen_at: now,
      _cachedAt: now,
      _d1SyncedAt: now
    };

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
            nextRow.tg_username || "",
            nextRow.first_name || "",
            cleanUser,
            passwordHash,
            passwordSalt,
            Number(nextRow.is_vip || 0),
            Number(nextRow.is_admin || 0),
            now
          )
          .run();
      } catch (e) {
        return { ok: false, error: "Datenbankfehler beim Speichern des Accounts (evtl. Username vergeben)." };
      }
    }
    if (prevUsernameLower && prevUsernameLower !== cleanUser.toLowerCase()) {
      memoryFallback.delete(`d1_username_${prevUsernameLower}`);
    }
    memoryFallback.set(memKey, nextRow);
    memoryFallback.set(`d1_username_${cleanUser.toLowerCase()}`, tid);
    return { ok: true, user: formatUserRowForClient(nextRow, env) };
  }

  async function saveUserTotpInD1(env, telegramId, totpSecret, totpEnabled) {
    const tid = String(telegramId || "").trim();
    if (!tid || tid === "guest") return null;
    const enabledVal = totpEnabled ? 1 : 0;
    const now = Date.now();
    const prev = (await getUserByTelegramIdFromD1(env, tid, true)) || {
      telegram_id: tid,
      tg_username: "",
      first_name: "",
      is_vip: 0,
      is_admin: isAuthorizedAdminId(env, tid) ? 1 : 0,
      created_at: now
    };
    const nextRow = {
      ...prev,
      telegram_id: tid,
      totp_secret: totpSecret ? String(totpSecret) : null,
      totp_enabled: enabledVal,
      last_seen_at: now,
      _cachedAt: now,
      _d1SyncedAt: now
    };

    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db
          .prepare(
            `INSERT INTO users (telegram_id, tg_username, first_name, is_vip, is_admin, totp_secret, totp_enabled, created_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(telegram_id) DO UPDATE SET
               totp_secret = excluded.totp_secret,
               totp_enabled = excluded.totp_enabled,
               last_seen_at = excluded.last_seen_at`
          )
          .bind(
            tid,
            String(nextRow.tg_username || ""),
            String(nextRow.first_name || ""),
            Number(nextRow.is_vip) ? 1 : 0,
            Number(nextRow.is_admin) ? 1 : 0,
            nextRow.totp_secret,
            enabledVal,
            Number(nextRow.created_at || now),
            now
          )
          .run();
      } catch (e) {
        return null;
      }
    }
    memoryFallback.set(`d1_user_${tid}`, nextRow);
    memoryFallback.delete("d1_admin_users_list_cache");
    return formatUserRowForClient(nextRow, env);
  }

  async function setUserVipStatusInD1(env, telegramId, isVip) {
    const tid = String(telegramId || "").trim();
    if (!tid || tid === "guest") return null;
    const vipVal = isVip ? 1 : 0;
    const now = Date.now();
    const prev = (await getUserByTelegramIdFromD1(env, tid, true)) || {
      telegram_id: tid,
      tg_username: "",
      first_name: "",
      is_vip: 0,
      is_admin: isAuthorizedAdminId(env, tid) ? 1 : 0,
      created_at: now
    };
    const nextRow = {
      ...prev,
      telegram_id: tid,
      is_vip: vipVal,
      last_seen_at: now,
      _cachedAt: now,
      _d1SyncedAt: now
    };

    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db
          .prepare(
            `INSERT INTO users (telegram_id, tg_username, first_name, is_vip, is_admin, created_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(telegram_id) DO UPDATE SET
               is_vip = excluded.is_vip,
               last_seen_at = excluded.last_seen_at`
          )
          .bind(
            tid,
            String(nextRow.tg_username || ""),
            String(nextRow.first_name || ""),
            vipVal,
            Number(nextRow.is_admin) ? 1 : 0,
            Number(nextRow.created_at || now),
            now
          )
          .run();
      } catch (e) {
        return null;
      }
    }
    memoryFallback.set(`d1_user_${tid}`, nextRow);
    memoryFallback.delete("d1_admin_users_list_cache");
    return formatUserRowForClient(nextRow, env);
  }

  async function listAllUsersFromD1(env) {
    const cachedUsers = memoryFallback.get("d1_admin_users_list_cache");
    if (cachedUsers && Array.isArray(cachedUsers.rows) && (Date.now() - Number(cachedUsers.ts || 0)) < 30000) {
      return cachedUsers.rows;
    }
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const res = await db
          .prepare("SELECT * FROM users ORDER BY is_admin DESC, is_vip DESC, last_seen_at DESC LIMIT 200")
          .all();
        if (Array.isArray(res?.results) && res.results.length > 0) {
          const formatted = res.results.map(r => formatUserRowForClient(r, env));
          memoryFallback.set("d1_admin_users_list_cache", { rows: formatted, ts: Date.now() });
          return formatted;
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
    const tcKey = typeCode === "s" ? "s" : "m";
    const cachedMediaList = memoryFallback.get(`d1_admin_media_list_cache_${tcKey}`);
    if (cachedMediaList && Array.isArray(cachedMediaList.rows) && (Date.now() - Number(cachedMediaList.ts || 0)) < 45000) {
      return cachedMediaList.rows;
    }
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const query = tcKey === "s"
          ? `SELECT s.tmdb_id, s.title, s.release_year, s.fsk, s.vote_average, s.genres, s.providers, s.poster_path, s.updated_at,
                    COUNT(ef.id) AS stream_count,
                    GROUP_CONCAT(DISTINCT ef.quality) AS qualities
             FROM series s
             INNER JOIN episode_files ef ON ef.series_id = s.tmdb_id
             GROUP BY s.tmdb_id
             HAVING COUNT(ef.id) > 0
             ORDER BY COUNT(ef.id) DESC, s.updated_at DESC
             LIMIT 250`
          : `SELECT m.tmdb_id, m.title, s_cnt.stream_count, s_cnt.qualities, m.release_year, m.fsk, m.vote_average, m.genres, m.providers, m.poster_path, m.updated_at
             FROM movies m
             INNER JOIN (
               SELECT movie_id, COUNT(id) AS stream_count, GROUP_CONCAT(DISTINCT quality) AS qualities
               FROM movie_files
               GROUP BY movie_id
               HAVING COUNT(id) > 0
             ) s_cnt ON s_cnt.movie_id = m.tmdb_id
             ORDER BY s_cnt.stream_count DESC, m.updated_at DESC
             LIMIT 250`;
        const res = await db.prepare(query).all();
        if (Array.isArray(res?.results) && res.results.length > 0) {
          memoryFallback.set(`d1_admin_media_list_cache_${tcKey}`, { rows: res.results, ts: Date.now() });
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
    memoryFallback.delete(`d1_vip_summary_${typeCode === "s" ? "s" : "m"}_${idNum}`);
    memoryFallback.delete(`d1_vip_discover_cache_${typeCode === "s" ? "s" : "m"}`);
    memoryFallback.delete(`d1_vip_discover_rows_${typeCode === "s" ? "s" : "m"}`);
    memoryFallback.delete(`d1_admin_media_list_cache_${typeCode === "s" ? "s" : "m"}`);
    memoryFallback.delete("d1_catalog_preseed_cache");
    memoryFallback.delete("d1_series_gaps_cache");
    memoryFallback.delete("d1_all_series_ep_map_cache");
    memoryFallback.delete("d1_db_stats_cache");
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
    const tc = typeCode === "s" ? "s" : "m";
    memoryFallback.delete(`d1_vip_summary_${tc}_${idNum}`);
    memoryFallback.delete(`d1_admin_media_list_cache_${tc}`);
    const memReports = Array.isArray(memoryFallback.get("d1_media_reports")) ? memoryFallback.get("d1_media_reports") : [];
    if (memReports.length > 0) {
      memoryFallback.set("d1_media_reports", memReports.filter(r => !(r && Number(r.tmdb_id) === idNum && r.type_code === tc)));
    }
    if (!db) return true;
    try {
      trackStat("d1Writes");
      if (typeCode === "s") {
        await db.batch([
          db.prepare("DELETE FROM series WHERE tmdb_id = ?1").bind(idNum),
          db.prepare("DELETE FROM series_seasons WHERE series_id = ?1").bind(idNum),
          db.prepare("DELETE FROM series_episodes WHERE series_id = ?1").bind(idNum),
          db.prepare("DELETE FROM episode_files WHERE series_id = ?1").bind(idNum),
          db.prepare("DELETE FROM media_reports WHERE type_code = 's' AND tmdb_id = ?1").bind(idNum)
        ]);
      } else {
        await db.batch([
          db.prepare("DELETE FROM movies WHERE tmdb_id = ?1").bind(idNum),
          db.prepare("DELETE FROM movie_files WHERE movie_id = ?1").bind(idNum),
          db.prepare("DELETE FROM media_reports WHERE type_code = 'm' AND tmdb_id = ?1").bind(idNum)
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
          id, reporter_telegram_id, reporter_username, type_code, tmdb_id, title,
          season_number, episode_number, episode_title, telegram_file_id, version_label,
          reason_code, reason_label, note, status, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'open', ?15)`)
          .bind(
            entry.id,
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
        const stmt = db.prepare("SELECT * FROM media_reports ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 200");
        const res = await stmt.all();
        if (Array.isArray(res?.results)) {
          const normalized = res.results.map(r => ({
            ...r,
            id: Number(r.id || r.created_at || Date.now()),
            status: String(r.status || "open")
          }));
          memoryFallback.set("d1_media_reports", normalized);
          if (statusFilter === "open" || statusFilter === "resolved") {
            return normalized.filter(r => r.status === statusFilter);
          }
          return normalized;
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
    const resolvedByStr = String(resolvedBy || "Admin");
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        await db.prepare("UPDATE media_reports SET status = 'resolved', resolved_at = ?1, resolved_by = ?2 WHERE id = ?3 OR created_at = ?3")
          .bind(now, resolvedByStr, idNum)
          .run();
      } catch (e) {}
    }
    const memList = Array.isArray(memoryFallback.get("d1_media_reports")) ? memoryFallback.get("d1_media_reports") : [];
    memoryFallback.set(
      "d1_media_reports",
      memList.map(r =>
        r && (Number(r.id) === idNum || Number(r.created_at) === idNum)
          ? { ...r, status: "resolved", resolved_at: now, resolved_by: resolvedByStr }
          : r
      )
    );
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
            db.prepare("UPDATE media_reports SET status = 'resolved', resolved_at = ?1, resolved_by = ?2 WHERE id = ?3 OR created_at = ?3")
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
        } else if (tmdbId > 0 && typeCode === "s") {
          stmts.push(
            db.prepare("UPDATE media_reports SET status = 'resolved', resolved_at = ?1, resolved_by = ?2 WHERE status = 'open' AND type_code = 's' AND tmdb_id = ?3")
              .bind(now, resolvedBy, tmdbId)
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
      const matchesId = reportId > 0 && (Number(r.id) === reportId || Number(r.created_at) === reportId);
      const matchesFile = fileId && String(r.telegram_file_id || "") === fileId;
      const matchesEp = tmdbId > 0 && typeCode === "s" && Number(r.tmdb_id) === tmdbId && (seasonNum == null || Number(r.season_number) === seasonNum) && (episodeNum == null || Number(r.episode_number) === episodeNum);
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
        await db.prepare("DELETE FROM media_reports WHERE id = ?1 OR created_at = ?1").bind(idNum).run();
      } catch (e) {}
    }
    const memList = Array.isArray(memoryFallback.get("d1_media_reports")) ? memoryFallback.get("d1_media_reports") : [];
    memoryFallback.set("d1_media_reports", memList.filter(r => r && Number(r.id) !== idNum && Number(r.created_at) !== idNum));
    return true;
  }

  async function clearAllMediaReportsInD1(env, onlyResolved = false) {
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Writes");
        if (onlyResolved) {
          await db.prepare("DELETE FROM media_reports WHERE status = 'resolved'").run();
        } else {
          await db.prepare("DELETE FROM media_reports").run();
        }
      } catch (e) {}
    }
    const memList = Array.isArray(memoryFallback.get("d1_media_reports")) ? memoryFallback.get("d1_media_reports") : [];
    if (onlyResolved) {
      memoryFallback.set("d1_media_reports", memList.filter(r => r && r.status !== "resolved"));
    } else {
      memoryFallback.set("d1_media_reports", []);
    }
    return true;
  }

  async function notifyAdminsOnTelegramForReport(env, report) {
    try {
      const adminIds = Array.from(getConfiguredAdminIdSet(env));
      if (adminIds.length === 0 || !(env?.TELEGRAM_BOT_TOKEN || env?.BOT_TOKEN)) return;

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

  function normalizeStreamPartLabel(rawPart, rawFilename = "") {
    const pStr = String(rawPart || "").trim();
    if (!pStr && !rawFilename) return null;
    if (/^RAR/i.test(pStr)) return pStr.toUpperCase();
    const m = pStr.match(/^(?:SPLIT|PART|TEIL|CD|DISC|DISK|DVD)[\s._-]*0*([1-9]\d?)$/i);
    if (m) return `CD ${parseInt(m[1], 10)}`;
    if (!pStr && rawFilename) {
      const fnSplit = String(rawFilename).match(/-00([1-9])(?:\.(?:mp4|mkv|avi|m4v|mk3d|flv|ts|mov|wmv))+$/i);
      if (fnSplit) return `CD ${parseInt(fnSplit[1], 10)}`;
    }
    return pStr || null;
  }

  function extractStreamPartNumber(partLabel) {
    if (!partLabel) return 0;
    const m = String(partLabel).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function cleanStreamTagsWithoutRedundantPart(rawTags = "") {
    if (!rawTags) return "";
    return String(rawTags)
      .split(/\s*[·•|]\s*/)
      .map(t => t.trim())
      .filter(t => t && !/^(?:SPLIT|PART|TEIL|CD|DISC|DISK|DVD)[\s._-]*0*\d+$/i.test(t))
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(" · ");
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
      const normalizedPart = normalizeStreamPartLabel(raw.part, raw.raw_filename || raw.rawFilename || "");
      const cleanedTags = cleanStreamTagsWithoutRedundantPart(raw.tags ? String(raw.tags) : "");
      prepared.push({
        ...raw,
        telegram_file_id: normalizedFid,
        quality: String(raw.quality || "1080p"),
        codec: String(raw.codec || "x264"),
        part: normalizedPart,
        tags: cleanedTags,
        file_size: normalizedSize,
        _validity: validity,
        _msgId: msgId
      });
    }

    // Alle defekten Platzhalter (vip_playlist_, tg_export_0_, tg_export__ oder _validity === 0 bei gültigen Alternativen) konsequent ausfiltern,
    // damit niemals defekte oder doppelte Stream-Buttons im UI gerendert werden!
    const validCandidates = prepared.filter(x => {
      const fidStr = String(x.telegram_file_id || "").trim();
      if (!fidStr || fidStr.startsWith("vip_playlist_") || fidStr.startsWith("tg_export_0_") || fidStr === "tg_export__") return false;
      return x._validity >= 1;
    });
    const pool = validCandidates.length > 0
      ? validCandidates
      : prepared.filter(x => {
          const fidStr = String(x.telegram_file_id || "").trim();
          return Boolean(fidStr && !fidStr.startsWith("vip_playlist_") && !fidStr.startsWith("tg_export_0_") && fidStr !== "tg_export__");
        });

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

      // MODUL 3: Behält unterschiedliche Fingerprints (Qualitäts-Versionen) und Schnittfassungen strikt getrennt!
      const qNorm = String(item.quality || "1080p").trim().toUpperCase();
      const cNorm = String(item.codec || "x264").trim().toUpperCase();
      const pNorm = String(item.part || "").trim().toUpperCase();
      const vNorm = extractEpisodeVersionLabel(item).toUpperCase();
      const fpSig = String(item.file_fingerprint || "").trim();
      const szBucket = item.file_size ? Math.round(Number(item.file_size) / (1024 * 512)) : 0;
      const streamSig = `${qNorm}|${cNorm}|${pNorm}|${vNorm}|${fpSig || szBucket}`;
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
      const aHasPart = Boolean(a.part);
      const bHasPart = Boolean(b.part);
      if (aHasPart && bHasPart) {
        const pNumDiff = extractStreamPartNumber(a.part) - extractStreamPartNumber(b.part);
        if (pNumDiff !== 0) return pNumDiff;
        const pStrDiff = String(a.part || "").localeCompare(String(b.part || ""), undefined, { numeric: true });
        if (pStrDiff !== 0) return pStrDiff;
      } else if (aHasPart !== bHasPart) {
        // Mehrteiler einer Qualitätsstufe zusammenhalten
        return aHasPart ? -1 : 1;
      }
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
            const normPart = normalizeStreamPartLabel(v.part, v.raw_filename || v.rawFilename || "");
            const key = `${vLabel}|${String(v.quality || "1080p").toUpperCase()}|${fid}`;
            const parsedSubs = Array.isArray(v.subtitles) ? v.subtitles : (() => { try { return JSON.parse(v.subtitles_json || "[]"); } catch (_) { return []; } })();
            versionMap.set(key, {
              versionLabel: vLabel,
              file_id: fid,
              telegram_file_id: fid,
              quality: String(v.quality || "1080p"),
              codec: String(v.codec || "x264"),
              part: normPart,
              file_size: Number(v.file_size || 0),
              tags: cleanStreamTagsWithoutRedundantPart(normalizeCompactVersionTags(v.tags || vLabel)),
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
      const normPart = normalizeStreamPartLabel(f.part, f.raw_filename || f.rawFilename || "");
      const key = `${vLabel}|${String(f.quality || "1080p").toUpperCase()}|${fid}`;
      const parsedSubs = Array.isArray(f.subtitles) ? f.subtitles : (() => { try { return JSON.parse(f.subtitles_json || "[]"); } catch (_) { return []; } })();
      versionMap.set(key, {
        versionLabel: vLabel,
        file_id: fid,
        telegram_file_id: fid,
        quality: String(f.quality || "1080p"),
        codec: String(f.codec || "x264"),
        part: normPart,
        file_size: Number(f.file_size || 0),
        tags: cleanStreamTagsWithoutRedundantPart(normalizeCompactVersionTags(f.tags || vLabel)),
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
    const normPart = normalizeStreamPartLabel(row.part, row.raw_filename || row.rawFilename || "");
    const cleanTags = cleanStreamTagsWithoutRedundantPart(row.tags || "");
    let subs = [];
    if (Array.isArray(row.subtitles)) {
      subs = row.subtitles;
    } else if (row.subtitles_json) {
      try {
        const parsed = JSON.parse(row.subtitles_json);
        if (Array.isArray(parsed)) subs = parsed;
      } catch (_) {}
    }
    const rawFn = row.raw_filename || row.rawFilename || "";
    const isDlOnly = Boolean(
      row.is_download_only ||
      row.isDownloadOnly ||
      row.isArchive ||
      row.type === "archive" ||
      row.codec === "ARCHIVE" ||
      Number(row.is_bonus || 0) === 2 ||
      isArchiveFilenameOrText(rawFn, row.raw_caption || row.rawCaption || "")
    );
    return {
      ...row,
      part: normPart,
      tags: cleanTags,
      version_label: vLabel,
      versionLabel: vLabel,
      is_download_only: isDlOnly ? 1 : 0,
      isDownloadOnly: isDlOnly,
      isArchive: isDlOnly,
      type: isDlOnly ? "archive" : (row.type || "video"),
      raw_filename: rawFn,
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
    if (normalizedFid.startsWith("tg_export_")) {
      memoryFallback.set("d1_has_tg_export_placeholders", { hasAny: true, ts: Date.now() });
    }

    const rawFilename = String(fileInfo.rawFilename || fileInfo.raw_filename || "").trim();
    const rawCaption = String(fileInfo.rawCaption || fileInfo.raw_caption || "").trim();
    const messageLink = inferTelegramMessageLinkFromFileId(normalizedFid, fileInfo.messageLink || fileInfo.message_link || "");
    const incomingSubs = mergeSubtitleArrays([], fileInfo.subtitles || fileInfo.subtitle_files || []);
    const incomingIsPrerelease = isPrereleaseOrMicDub(rawCaption, rawFilename, fileInfo.tags || "");

    // MODUL 3: Der "fileFingerprint" (Echte Telegram-IDs vs. JSON) — Verhindere zwingend den null === null Bug!
    const parsedBytes = parseHumanFileSizeToBytes(fileInfo.fileSize ?? fileInfo.file_size);
    const durSecVal = Number(fileInfo.durationSec ?? fileInfo.duration_sec ?? fileInfo.duration_seconds ?? 0) || 0;
    const widthVal = Number(fileInfo.width || 0) || 0;
    const heightVal = Number(fileInfo.height || 0) || 0;
    const realUniqueId = fileInfo.fileUniqueId || fileInfo.file_unique_id || fileInfo.telegram_unique_id
      ? String(fileInfo.fileUniqueId || fileInfo.file_unique_id || fileInfo.telegram_unique_id).trim()
      : "";
    const isSyntheticUniqueId = !realUniqueId || realUniqueId === "null" || realUniqueId === "undefined" || realUniqueId.startsWith("u_") || realUniqueId.startsWith("tg_export_");
    const realFileIdForFp = (scoreTelegramFileIdValidity(normalizedFid) === 3 && normalizedFid !== "null" && normalizedFid !== "undefined") ? normalizedFid : "";
    const fileFingerprint = String(
      fileInfo.fileFingerprint ||
      fileInfo.file_fingerprint ||
      (!isSyntheticUniqueId ? realUniqueId : "") ||
      realFileIdForFp ||
      `${parsedBytes || 0}_${durSecVal || 0}_${widthVal || 0}x${heightVal || 0}`
    ).trim();
    const partMatchFromStr = String(fileInfo.part || "").match(/(\d+)/);
    const partNumber = Number(fileInfo.partNumber || fileInfo.part_number || (partMatchFromStr ? partMatchFromStr[1] : 1)) || 1;
    const editionLabel = fileInfo.editionLabel || fileInfo.edition_label ? String(fileInfo.editionLabel || fileInfo.edition_label).trim() : null;
    const isBonus = Boolean(fileInfo.isBonus || fileInfo.is_bonus);
    // MODUL 2: Archive (.rar/.zip/.7z/.iso/.tar/.gz/.part1.rar/.r00/.z01/.7z.001) als Download-Dateien in movieObj.downloads UND mit is_download_only = 1 in D1 speichern!
    const isArchiveDownload = Boolean(
      fileInfo.isDownloadOnly ||
      fileInfo.is_download_only ||
      fileInfo.isArchive ||
      fileInfo.type === "archive" ||
      isArchiveFilenameOrText(rawFilename, rawCaption)
    );
    const archMeta = isArchiveDownload ? detectArchiveCodecAndPart(rawFilename, rawCaption) : null;
    const effectivePartNumber = isArchiveDownload
      ? Number(fileInfo.partNumber || fileInfo.part_number || archMeta?.partNumber || partNumber || 1)
      : partNumber;

    if (isArchiveDownload) {
      const dlEntry = {
        telegram_file_id: normalizedFid,
        telegram_unique_id: (!isSyntheticUniqueId ? realUniqueId : null) || null,
        file_fingerprint: fileFingerprint,
        type: "archive",
        isDownloadOnly: true,
        is_download_only: 1,
        codec: archMeta?.codec || String(fileInfo.codec || "RAR").toUpperCase(),
        part: fileInfo.part ? String(fileInfo.part) : (archMeta?.partLabel || (effectivePartNumber > 1 ? `RAR-PART${effectivePartNumber}` : "RAR")),
        part_number: effectivePartNumber,
        file_size: parsedBytes,
        raw_filename: rawFilename || "Archiv.rar",
        raw_caption: rawCaption,
        message_link: messageLink,
        updated_at: Date.now()
      };
      const existingMovie = await getMovieFromD1(env, mid);
      const memDownloads = Array.isArray(memoryFallback.get(`d1_movie_downloads_${mid}`)) ? memoryFallback.get(`d1_movie_downloads_${mid}`) : [];
      const currentDownloads = Array.isArray(existingMovie?.downloads) && existingMovie.downloads.length > 0
        ? [...existingMovie.downloads]
        : [...memDownloads];
      const nextDownloads = [
        dlEntry,
        ...currentDownloads.filter(d => d && d.telegram_file_id !== normalizedFid && !(Number(d.part_number || 1) === effectivePartNumber && d.file_fingerprint === fileFingerprint && fileFingerprint !== "0_0_0x0"))
      ].sort((a, b) => (Number(a.part_number || 1) - Number(b.part_number || 1)) || String(a.raw_filename || "").localeCompare(String(b.raw_filename || ""), "de", { numeric: true }));
      memoryFallback.set(`d1_movie_downloads_${mid}`, nextDownloads);
      if (existingMovie) {
        existingMovie.downloads = nextDownloads;
        existingMovie.hasDownloads = true;
        await saveMovieToD1(env, existingMovie);
      }
    }

    const memKey = `d1_movie_files_${mid}`;
    const memLoadedTsKey = `d1_movie_files_ts_${mid}`;
    let existingMem = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];
    const db = await ensureD1Schema(env);
    let existingDbRows = [];
    const memFresh = memoryFallback.has(memLoadedTsKey) && (Date.now() - Number(memoryFallback.get(memLoadedTsKey) || 0)) < 300000;
    if (db && !memFresh && (!hasLiveD1WriteBuffer() || hasSubrequestBudget(32))) {
      try {
        const res = await db
          .prepare("SELECT id, telegram_file_id, file_fingerprint, quality, codec, part, part_number, edition_label, is_bonus, is_download_only, tags, file_size, raw_filename, raw_caption, subtitles_json FROM movie_files WHERE movie_id = ?1")
          .bind(mid)
          .all();
        existingDbRows = Array.isArray(res?.results) ? res.results.map(r => ({ ...r, _fromD1: true })) : [];
        memoryFallback.set(memKey, existingDbRows);
        memoryFallback.set(memLoadedTsKey, Date.now());
      } catch (e) {}
    }

    const allExistingRows = [...existingDbRows, ...existingMem];
    const hasCleanExisting = allExistingRows.some(r => r && r.telegram_file_id !== normalizedFid && Number(r.part_number || 1) === partNumber && !isPrereleaseOrMicDub(r.raw_caption, r.raw_filename, r.tags));

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
        if (r && r.telegram_file_id && r.telegram_file_id !== normalizedFid && Number(r.part_number || 1) === partNumber && isPrereleaseOrMicDub(r.raw_caption, r.raw_filename, r.tags)) {
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
    const sizeBadgeLabel = parsedBytes ? formatFileSizeBytes(parsedBytes) : "";
    const autoBadgeLabel = [editionLabel, fileInfo.quality || "", sizeBadgeLabel].filter(Boolean).join(" • ");
    let effectiveTags = fileInfo.tags ? String(fileInfo.tags) : autoBadgeLabel;
    if (editionLabel && !effectiveTags.toLowerCase().includes(editionLabel.toLowerCase())) {
      effectiveTags = [editionLabel, effectiveTags].filter(Boolean).join(" • ");
    }
    if (incomingIsPrerelease && !effectiveTags.includes("Vorabversion")) {
      effectiveTags = [effectiveTags, "⚠️ Vorabversion"].filter(Boolean).join(" · ");
    }

    const msgId = Number(fileInfo.messageId || fileInfo.msgId || fileInfo.message_id || extractExportMessageIdFromFileId(normalizedFid) || 0) || null;
    const validExistingMovieRows = allExistingRows.filter(r => r && r.telegram_file_id && scoreTelegramFileIdValidity(r.telegram_file_id) > 0);
    // MODUL 3: Nur wenn (tmdb_id, part_number, fileFingerprint) in D1 exakt identisch ist: status = "SKIPPED_DUPLICATE".
    // Weicht der Fingerabdruck ab, speichere es als neue Qualitäts-Version desselben Films in D1!
    let matchedDuplicateRow = null;
    const isExactDuplicate = validExistingMovieRows.some(r => {
      const exFid = String(r.telegram_file_id || "").trim();
      const exMsgId = Number(extractExportMessageIdFromFileId(exFid) || 0) || null;
      const exPartNum = Number(r.part_number || (String(r.part || "").match(/(\d+)/)?.[1]) || 1) || 1;
      if (exPartNum !== partNumber) return false;
      const exFp = String(r.file_fingerprint || "").trim();
      if (exFp && fileFingerprint && exFp !== "null" && fileFingerprint !== "null" && exFp === fileFingerprint) {
        if (fileFingerprint !== "0_0_0x0" || (msgId && exMsgId && msgId === exMsgId) || exFid === normalizedFid) {
          matchedDuplicateRow = r;
          return true;
        }
      }
      const fidMatch = exFid && normalizedFid && exFid !== "null" && exFid === normalizedFid;
      const msgMatch = (msgId && exMsgId) ? (msgId === exMsgId) : fidMatch;
      if (fidMatch && msgMatch) {
        matchedDuplicateRow = r;
        return true;
      }
      return false;
    }) && incomingSubs.length === 0;

    const hasDifferentFingerprintOrQuality = !isExactDuplicate && validExistingMovieRows.length > 0;
    const isUpdated = false;
    const isMergedQuality = hasDifferentFingerprintOrQuality;

    // Wenn die identische Datei nachweislich bereits in D1 (_fromD1 === true) liegt und keine Untertitel/Vorabversionen hinzukamen, spare den redundanten D1-Write!
    if (isExactDuplicate && matchedDuplicateRow && matchedDuplicateRow._fromD1 === true && replacedPrereleaseCount === 0) {
      return { ok: true, isExactDuplicate: true, isUpdated: false, isMergedQuality: false, isArchiveDownload, skippedPrerelease: false, replacedPrereleaseCount: 0 };
    }

    const entry = {
      movie_id: mid,
      telegram_file_id: normalizedFid,
      telegram_unique_id: (!isSyntheticUniqueId ? realUniqueId : null) || null,
      file_fingerprint: fileFingerprint,
      quality: isArchiveDownload ? "ARCHIV" : String(fileInfo.quality || "1080p"),
      codec: isArchiveDownload ? (archMeta?.codec || "ARCHIVE") : String(fileInfo.codec || "x264"),
      part: isArchiveDownload
        ? (fileInfo.part ? String(fileInfo.part) : (archMeta?.partLabel || (effectivePartNumber > 1 ? `RAR-PART${effectivePartNumber}` : "RAR")))
        : (fileInfo.part ? String(fileInfo.part) : (partNumber > 1 ? `CD ${partNumber}` : null)),
      part_number: effectivePartNumber,
      edition_label: editionLabel,
      is_bonus: isArchiveDownload ? 2 : (isBonus ? 1 : 0),
      is_download_only: isArchiveDownload ? 1 : 0,
      isDownloadOnly: isArchiveDownload,
      isArchive: isArchiveDownload,
      type: isArchiveDownload ? "archive" : "video",
      tags: isArchiveDownload ? ([effectiveTags, "📦 Archiv-Download"].filter(Boolean).join(" · ")) : effectiveTags,
      file_size: parsedBytes,
      mime_type: isArchiveDownload ? "application/x-rar-compressed" : String(fileInfo.mimeType || fileInfo.mime_type || "video/mp4"),
      raw_filename: rawFilename,
      raw_caption: rawCaption,
      message_link: messageLink,
      subtitles: mergedSubs,
      subtitles_json: JSON.stringify(mergedSubs),
      updated_at: Date.now(),
      _fromD1: Boolean(db)
    };
    const nextMem = sortAndDedupeStreamFiles([
      entry,
      ...existingMem.filter(x => x && x.telegram_file_id !== entry.telegram_file_id && (!entry.telegram_unique_id || x.telegram_unique_id !== entry.telegram_unique_id))
    ]);
    memoryFallback.set(memKey, nextMem);
    memoryFallback.set(memLoadedTsKey, Date.now());
    memoryFallback.delete(`d1_vip_summary_m_${mid}`);
    memoryFallback.delete("d1_admin_media_list_cache_m");
    if (entry.telegram_file_id) {
      memoryFallback.set(`d1_fid_lookup_${entry.telegram_file_id}`, {
        matchedBy: "file_id",
        typeCode: "m",
        tmdbId: mid,
        confidence: 100,
        source: "D1 (Datei-ID)"
      });
      memoryFallback.delete(`d1_fid_miss_${entry.telegram_file_id}`);
    }

    if (!db) return { ok: true, isExactDuplicate, isUpdated, isMergedQuality, isArchiveDownload, skippedPrerelease: false, replacedPrereleaseCount };
    try {
      trackStat("d1Writes");
      const isHighValidity = scoreTelegramFileIdValidity(entry.telegram_file_id) >= 2;
      const stmts = [];
      // MODUL 3: Nur dann DELETE-Statements an D1 senden, wenn tatsächlich zu bereinigende Platzhalter/Duplikate existieren!
      const needsPlaceholderOrFpDelete = allExistingRows.some(r => {
        if (!r) return false;
        const rfid = String(r.telegram_file_id || "");
        if (!rfid || rfid.startsWith("vip_playlist_") || rfid.startsWith("tmdb_card_")) return true;
        if (isHighValidity && (rfid.startsWith("tg_export_0_") || rfid.startsWith("tg_export_vip_"))) return true;
        if (Number(r.part_number || 1) === entry.part_number && entry.file_fingerprint && entry.file_fingerprint !== "0_0_0x0" && r.file_fingerprint === entry.file_fingerprint && rfid !== entry.telegram_file_id) return true;
        return false;
      });
      if (needsPlaceholderOrFpDelete) {
        stmts.push(
          db.prepare(
            `DELETE FROM movie_files WHERE movie_id = ?1 AND (
              telegram_file_id IS NULL OR telegram_file_id = ''
              OR telegram_file_id LIKE 'vip_playlist_%' OR telegram_file_id LIKE 'tmdb_card_%'
              ${isHighValidity ? "OR telegram_file_id LIKE 'tg_export_0_%' OR telegram_file_id LIKE 'tg_export_vip_%'" : ""}
              OR (COALESCE(part_number, 1) = ?2 AND COALESCE(file_fingerprint, '') = ?3 AND file_fingerprint != '0_0_0x0' AND telegram_file_id != ?4)
            )`
          ).bind(mid, entry.part_number, entry.file_fingerprint || "", entry.telegram_file_id)
        );
      }
      for (const preFid of prereleaseFidsToDelete) {
        stmts.push(
          db.prepare("DELETE FROM movie_files WHERE movie_id = ?1 AND telegram_file_id = ?2")
            .bind(mid, preFid)
        );
      }
      if (entry.telegram_unique_id && allExistingRows.some(r => r && r.telegram_unique_id === entry.telegram_unique_id && r.telegram_file_id !== entry.telegram_file_id)) {
        stmts.push(
          db.prepare("DELETE FROM movie_files WHERE movie_id = ?1 AND telegram_unique_id = ?2 AND telegram_file_id != ?3")
            .bind(entry.movie_id, entry.telegram_unique_id, entry.telegram_file_id)
        );
      }
      if (msgId && allExistingRows.some(r => r && String(r.telegram_file_id || "").endsWith(`_${msgId}`) && String(r.telegram_file_id || "").startsWith("tg_export_") && r.telegram_file_id !== entry.telegram_file_id)) {
        stmts.push(
          db.prepare("DELETE FROM movie_files WHERE movie_id = ?1 AND telegram_file_id LIKE ?2 AND telegram_file_id != ?3")
            .bind(mid, `tg_export_%_${msgId}`, entry.telegram_file_id)
        );
      }
      stmts.push(
        db.prepare(`INSERT INTO movie_files (
          movie_id, telegram_file_id, telegram_unique_id, file_fingerprint, quality, codec, part, part_number, edition_label, is_bonus, is_download_only, tags, file_size, mime_type, raw_filename, raw_caption, message_link, subtitles_json, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
        ON CONFLICT(movie_id, telegram_file_id) DO UPDATE SET
          file_fingerprint = COALESCE(excluded.file_fingerprint, movie_files.file_fingerprint),
          quality = excluded.quality,
          codec = excluded.codec,
          part = COALESCE(excluded.part, movie_files.part),
          part_number = COALESCE(excluded.part_number, movie_files.part_number, 1),
          edition_label = COALESCE(excluded.edition_label, movie_files.edition_label),
          is_bonus = COALESCE(excluded.is_bonus, movie_files.is_bonus, 0),
          is_download_only = COALESCE(excluded.is_download_only, movie_files.is_download_only, 0),
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
            entry.file_fingerprint,
            entry.quality,
            entry.codec,
            entry.part,
            entry.part_number,
            entry.edition_label,
            entry.is_bonus,
            entry.is_download_only,
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
      memoryFallback.delete(`d1_vip_summary_m_${mid}`);
      memoryFallback.delete("d1_vip_discover_cache_m");
      memoryFallback.delete("d1_admin_media_list_cache_m");
      return { ok: true, isExactDuplicate, isUpdated, isMergedQuality, isArchiveDownload, skippedPrerelease: false, replacedPrereleaseCount };
    } catch (e) {
      return { ok: true, isExactDuplicate, isUpdated, isMergedQuality, isArchiveDownload, skippedPrerelease: false, replacedPrereleaseCount };
    }
  }

  async function getMovieFilesFromD1(env, movieId, includeArchives = false) {
    if (!movieId) return [];
    const mid = Number(movieId);
    const memKey = `d1_movie_files_${mid}`;
    const memLoadedTsKey = `d1_movie_files_ts_${mid}`;
    const filterStreamRows = (rows) => {
      const sorted = sortAndDedupeStreamFiles((rows || []).map(enrichStreamFileRowMeta));
      if (includeArchives) return sorted;
      const nonArchive = sorted.filter(r => r && !r.is_download_only && !r.isDownloadOnly && r.codec !== "ARCHIVE" && Number(r.is_bonus || 0) !== 2 && !isArchiveFilenameOrText(r.raw_filename || "", r.raw_caption || ""));
      return nonArchive;
    };
    const memFiles = memoryFallback.get(memKey);
    if (Array.isArray(memFiles) && memFiles.length > 0 && (Date.now() - Number(memoryFallback.get(memLoadedTsKey) || 0)) < 180000) {
      return filterStreamRows(memFiles);
    }
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const res = await db
          .prepare("SELECT id, movie_id, telegram_file_id, telegram_unique_id, file_fingerprint, quality, codec, part, part_number, edition_label, is_bonus, is_download_only, tags, file_size, mime_type, raw_filename, raw_caption, message_link, subtitles_json, updated_at FROM movie_files WHERE movie_id = ?1 ORDER BY COALESCE(part_number, 1) ASC, updated_at DESC")
          .bind(mid)
          .all();
        if (Array.isArray(res?.results) && res.results.length > 0) {
          const sortedAll = sortAndDedupeStreamFiles(res.results.map(enrichStreamFileRowMeta));
          memoryFallback.set(memKey, sortedAll);
          memoryFallback.set(memLoadedTsKey, Date.now());
          return filterStreamRows(res.results);
        }
      } catch (e) {}
    }
    return Array.isArray(memFiles) ? filterStreamRows(memFiles) : [];
  }

  async function saveEpisodeFileToD1(env, seriesId, seasonNumber, episodeNumber, fileInfo) {
    const rawFid = fileInfo?.fileId || fileInfo?.telegram_file_id;
    if (!seriesId || !rawFid) return false;
    memoryFallback.delete("d1_series_gaps_cache");
    const sid = Number(seriesId);
    const isBonus = Boolean(fileInfo?.isBonus || fileInfo?.is_bonus || Number(seasonNumber) === 0);
    // MODUL 2.2: Bonus- & Special-Clips dürfen niemals reguläre Episoden (S>=1, E>=1) überschreiben -> Season 0!
    const sNum = isBonus ? 0 : (seasonNumber !== undefined && seasonNumber !== null ? Number(seasonNumber) : 1);
    const eNum = Number(episodeNumber || 1);
    const normalizedFid = normalizeExportFileIdChannel(rawFid);
    if (scoreTelegramFileIdValidity(normalizedFid) === 0) return false;
    if (normalizedFid.startsWith("tg_export_")) {
      memoryFallback.set("d1_has_tg_export_placeholders", { hasAny: true, ts: Date.now() });
    }

    const epTitle = String(fileInfo.episodeTitle || fileInfo.title || (isBonus ? `Bonus / Special ${eNum}` : `Folge ${eNum}`)).trim();
    const rawFilename = String(fileInfo.rawFilename || fileInfo.raw_filename || "").trim();
    const rawCaption = String(fileInfo.rawCaption || fileInfo.raw_caption || "").trim();
    const messageLink = inferTelegramMessageLinkFromFileId(normalizedFid, fileInfo.messageLink || fileInfo.message_link || "");
    const incomingSubs = mergeSubtitleArrays([], fileInfo.subtitles || fileInfo.subtitle_files || []);
    const incomingIsPrerelease = isPrereleaseOrMicDub(rawCaption, rawFilename, fileInfo.tags || fileInfo.versionLabel || "");

    // MODUL 3: Der "fileFingerprint" (Echte Telegram-IDs vs. JSON) — Verhindere zwingend den null === null Bug!
    const parsedBytes = parseHumanFileSizeToBytes(fileInfo.fileSize ?? fileInfo.file_size);
    const durSecVal = Number(fileInfo.durationSec ?? fileInfo.duration_sec ?? fileInfo.duration_seconds ?? 0) || 0;
    const widthVal = Number(fileInfo.width || 0) || 0;
    const heightVal = Number(fileInfo.height || 0) || 0;
    const realUniqueId = fileInfo.fileUniqueId || fileInfo.file_unique_id || fileInfo.telegram_unique_id
      ? String(fileInfo.fileUniqueId || fileInfo.file_unique_id || fileInfo.telegram_unique_id).trim()
      : "";
    const isSyntheticUniqueId = !realUniqueId || realUniqueId === "null" || realUniqueId === "undefined" || realUniqueId.startsWith("u_") || realUniqueId.startsWith("tg_export_");
    const realFileIdForFp = (scoreTelegramFileIdValidity(normalizedFid) === 3 && normalizedFid !== "null" && normalizedFid !== "undefined") ? normalizedFid : "";
    const fileFingerprint = String(
      fileInfo.fileFingerprint ||
      fileInfo.file_fingerprint ||
      (!isSyntheticUniqueId ? realUniqueId : "") ||
      realFileIdForFp ||
      `${parsedBytes || 0}_${durSecVal || 0}_${widthVal || 0}x${heightVal || 0}`
    ).trim();
    const editionLabel = fileInfo.editionLabel || fileInfo.edition_label ? String(fileInfo.editionLabel || fileInfo.edition_label).trim() : null;
    const isArchiveDownload = Boolean(
      fileInfo.isDownloadOnly ||
      fileInfo.is_download_only ||
      fileInfo.isArchive ||
      fileInfo.type === "archive" ||
      isArchiveFilenameOrText(rawFilename, rawCaption)
    );
    const archEpMeta = isArchiveDownload ? detectArchiveCodecAndPart(rawFilename, rawCaption) : null;
    // MODUL 5.1: Bei Serien-Videos ist part_number IMMER 1; bei mehrteiligen Serien-Archiven (.part1.rar / .r00 / .7z.001) bleibt die Archiv-Part-Nummer erhalten!
    const partNumber = isArchiveDownload
      ? Number(fileInfo.partNumber || fileInfo.part_number || archEpMeta?.partNumber || 1)
      : 1;

    if (isArchiveDownload) {
      const dlEntry = {
        telegram_file_id: normalizedFid,
        telegram_unique_id: (!isSyntheticUniqueId ? realUniqueId : null) || null,
        file_fingerprint: fileFingerprint,
        type: "archive",
        isDownloadOnly: true,
        is_download_only: 1,
        codec: archEpMeta?.codec || String(fileInfo.codec || "RAR").toUpperCase(),
        season_number: sNum,
        episode_number: eNum,
        part: fileInfo.part ? String(fileInfo.part) : (archEpMeta?.partLabel || (partNumber > 1 ? `RAR-PART${partNumber}` : "RAR")),
        part_number: partNumber,
        file_size: parsedBytes,
        raw_filename: rawFilename || "Archiv.rar",
        raw_caption: rawCaption,
        message_link: messageLink,
        updated_at: Date.now()
      };
      const existingSeries = await getSeriesFromD1(env, sid);
      const memDownloads = Array.isArray(memoryFallback.get(`d1_series_downloads_${sid}`)) ? memoryFallback.get(`d1_series_downloads_${sid}`) : [];
      const currentDownloads = Array.isArray(existingSeries?.downloads) && existingSeries.downloads.length > 0
        ? [...existingSeries.downloads]
        : [...memDownloads];
      const nextDownloads = [
        dlEntry,
        ...currentDownloads.filter(d => d && d.telegram_file_id !== normalizedFid && !(Number(d.season_number ?? 1) === sNum && Number(d.episode_number || 1) === eNum && Number(d.part_number || 1) === partNumber && d.file_fingerprint === fileFingerprint && fileFingerprint !== "0_0_0x0"))
      ].sort((a, b) => (Number(a.season_number ?? 1) - Number(b.season_number ?? 1)) || (Number(a.episode_number || 1) - Number(b.episode_number || 1)) || (Number(a.part_number || 1) - Number(b.part_number || 1)));
      memoryFallback.set(`d1_series_downloads_${sid}`, nextDownloads);
      if (existingSeries) {
        existingSeries.downloads = nextDownloads;
        existingSeries.hasDownloads = true;
        await saveSeriesToD1(env, existingSeries);
      }
    }

    const memKey = `d1_ep_files_${sid}_${sNum}`;
    const memSeasonTsKey = `d1_ep_files_season_ts_${sid}_${sNum}`;
    let existingMem = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];
    const memSeasonFresh = memoryFallback.has(memSeasonTsKey) && (Date.now() - Number(memoryFallback.get(memSeasonTsKey) || 0)) < 300000;
    const db = await ensureD1Schema(env);
    if (db && !memSeasonFresh && (!hasLiveD1WriteBuffer() || hasSubrequestBudget(32))) {
      try {
        // Lade alle vorhandenen Episoden-Dateien dieser Staffel in 1 einziger Abfrage (statt 1 Abfrage pro Folge!)
        const res = await db
          .prepare("SELECT id, series_id, season_number, episode_number, telegram_file_id, file_fingerprint, quality, codec, part, part_number, edition_label, is_bonus, is_download_only, tags, version_label, file_size, raw_filename, raw_caption, subtitles_json FROM episode_files WHERE series_id = ?1 AND season_number = ?2")
          .bind(sid, sNum)
          .all();
        const loadedSeasonRows = Array.isArray(res?.results) ? res.results.map(r => ({ ...r, _fromD1: true })) : [];
        const mergedById = new Map();
        for (const r of [...loadedSeasonRows, ...existingMem]) {
          if (r && r.telegram_file_id) {
            mergedById.set(`${Number(r.episode_number || 1)}_${r.telegram_file_id}`, r);
          }
        }
        existingMem = Array.from(mergedById.values());
        memoryFallback.set(memKey, existingMem);
        memoryFallback.set(memSeasonTsKey, Date.now());
      } catch (e) {}
    }
    const memEpRows = existingMem.filter(x => x && Number(x.episode_number) === eNum);
    const existingDbRows = [];

    const allExistingEpRows = [
      ...existingDbRows,
      ...memEpRows
    ];
    const hasCleanExisting = allExistingEpRows.some(r => r && r.telegram_file_id !== normalizedFid && Number(r.part_number || 1) === partNumber && !isPrereleaseOrMicDub(r.raw_caption, r.raw_filename, r.tags || r.version_label));

    // Notfall-Regel für #vorabversion / TS / CAM / MD (Mic-Dub):
    // Wenn für diese Folge bereits eine ordentliche Version existiert, wird die Vorabversion NICHT gespeichert!
    if (incomingIsPrerelease && hasCleanExisting) {
      return { ok: true, skippedPrerelease: true, replacedPrereleaseCount: 0 };
    }

    let replacedPrereleaseCount = 0;
    const prereleaseFidsToDelete = new Set();
    if (!incomingIsPrerelease) {
      for (const r of allExistingEpRows) {
        if (r && r.telegram_file_id && r.telegram_file_id !== normalizedFid && Number(r.part_number || 1) === partNumber && isPrereleaseOrMicDub(r.raw_caption, r.raw_filename, r.tags || r.version_label)) {
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

    const versionLabel = isArchiveDownload ? "📦 Archiv-Download" : (incomingIsPrerelease ? "⚠️ Vorabversion" : extractEpisodeVersionLabel(fileInfo));
    const sizeBadgeLabel = parsedBytes ? formatFileSizeBytes(parsedBytes) : "";
    const autoBadgeLabel = [editionLabel, fileInfo.quality || "", sizeBadgeLabel].filter(Boolean).join(" • ");
    const cleanTags = normalizeCompactVersionTags(fileInfo.tags || autoBadgeLabel || versionLabel);

    // MODUL 3: Smart-UPSERT mit zweistufigem fileFingerprint & part_number
    const msgId = Number(fileInfo.messageId || fileInfo.msgId || fileInfo.message_id || extractExportMessageIdFromFileId(normalizedFid) || 0) || null;
    const validExistingEpRows = allExistingEpRows.filter(r => r && r.telegram_file_id && scoreTelegramFileIdValidity(r.telegram_file_id) > 0);
    let matchedDuplicateEpRow = null;
    const isExactDuplicate = validExistingEpRows.some(r => {
      const exFid = String(r.telegram_file_id || "").trim();
      const exMsgId = Number(r.message_id || extractExportMessageIdFromFileId(exFid) || 0) || null;
      const exPartNum = Number(r.part_number || 1) || 1;
      if (exPartNum !== partNumber) return false;
      const exFp = String(r.file_fingerprint || "").trim();
      if (exFp && fileFingerprint && exFp !== "null" && fileFingerprint !== "null" && exFp === fileFingerprint) {
        if (fileFingerprint !== "0_0_0x0" || (msgId && exMsgId && msgId === exMsgId) || exFid === normalizedFid) {
          matchedDuplicateEpRow = r;
          return true;
        }
      }
      const fidMatch = exFid && normalizedFid && exFid !== "null" && exFid === normalizedFid;
      const msgMatch = (msgId && exMsgId) ? (msgId === exMsgId) : fidMatch;
      if (fidMatch && msgMatch) {
        matchedDuplicateEpRow = r;
        return true;
      }
      return false;
    }) && incomingSubs.length === 0;

    const hasDifferentFingerprintOrQuality = !isExactDuplicate && validExistingEpRows.length > 0;
    const isUpdated = false;
    const isMergedQuality = hasDifferentFingerprintOrQuality;

    // Wenn die identische Episode nachweislich bereits in D1 (_fromD1 === true) liegt und keine Untertitel/Vorabversionen hinzukamen, spare den redundanten D1-Write!
    if (isExactDuplicate && matchedDuplicateEpRow && matchedDuplicateEpRow._fromD1 === true && replacedPrereleaseCount === 0) {
      return { ok: true, isExactDuplicate: true, isUpdated: false, isMergedQuality: false, isArchiveDownload, skippedPrerelease: false, replacedPrereleaseCount: 0 };
    }

    const entry = {
      series_id: sid,
      season_number: sNum,
      episode_number: eNum,
      episode_title: epTitle,
      telegram_file_id: normalizedFid,
      telegram_unique_id: (!isSyntheticUniqueId ? realUniqueId : null) || null,
      file_fingerprint: fileFingerprint,
      quality: isArchiveDownload ? "ARCHIV" : String(fileInfo.quality || "1080p"),
      codec: isArchiveDownload ? (archEpMeta?.codec || "ARCHIVE") : String(fileInfo.codec || "x264"),
      part: isArchiveDownload ? (fileInfo.part ? String(fileInfo.part) : (archEpMeta?.partLabel || (partNumber > 1 ? `RAR-PART${partNumber}` : "RAR"))) : null,
      part_number: partNumber,
      edition_label: editionLabel,
      is_bonus: isArchiveDownload ? 2 : (isBonus ? 1 : 0),
      is_download_only: isArchiveDownload ? 1 : 0,
      isDownloadOnly: isArchiveDownload,
      isArchive: isArchiveDownload,
      type: isArchiveDownload ? "archive" : "video",
      tags: cleanTags,
      version_label: versionLabel,
      versionLabel: versionLabel,
      file_size: parsedBytes,
      mime_type: isArchiveDownload ? "application/x-rar-compressed" : String(fileInfo.mimeType || fileInfo.mime_type || "video/mp4"),
      raw_filename: rawFilename,
      raw_caption: rawCaption,
      message_link: messageLink,
      subtitles: mergedSubs,
      subtitles_json: JSON.stringify(mergedSubs),
      updated_at: Date.now(),
      _fromD1: Boolean(db)
    };
    const sameEpDeduped = sortAndDedupeStreamFiles([
      entry,
      ...existingMem.filter(x => x && Number(x.episode_number) === eNum)
    ]);
    const otherEps = existingMem.filter(x => x && Number(x.episode_number) !== eNum);
    memoryFallback.set(memKey, [...sameEpDeduped, ...otherEps]);
    memoryFallback.set(memSeasonTsKey, Date.now());
    if (!isArchiveDownload) {
      memoryFallback.set(`d1_series_best_quality_${sid}`, entry.quality + (entry.codec ? ` ${entry.codec}` : ""));
    }
    memoryFallback.delete(`d1_vip_summary_s_${sid}`);
    memoryFallback.delete("d1_admin_media_list_cache_s");
    memoryFallback.delete("d1_series_gaps_cache");
    if (entry.telegram_file_id) {
      memoryFallback.set(`d1_fid_lookup_${entry.telegram_file_id}`, {
        matchedBy: "file_id",
        typeCode: "s",
        tmdbId: sid,
        season: sNum,
        episode: eNum,
        confidence: 100,
        source: "D1 (Datei-ID)"
      });
      memoryFallback.delete(`d1_fid_miss_${entry.telegram_file_id}`);
    }

    const versionsPayload = JSON.stringify(buildEpisodeVersionsArray(sameEpDeduped.filter(x => !x.is_download_only && !x.isDownloadOnly && x.codec !== "ARCHIVE" && Number(x.is_bonus || 0) !== 2)));

    if (!db) return { ok: true, isExactDuplicate, isUpdated, isMergedQuality, isArchiveDownload, skippedPrerelease: false, replacedPrereleaseCount };
    try {
      trackStat("d1Writes");
      const isHighValidity = scoreTelegramFileIdValidity(entry.telegram_file_id) >= 2;
      const stmts = [];
      // MODUL 3: Nur dann DELETE-Statements an D1 senden, wenn in allExistingEpRows tatsächlich Platzhalter oder veraltete IDs vorliegen!
      const needsEpPlaceholderOrFpDelete = allExistingEpRows.some(r => {
        if (!r) return false;
        const rfid = String(r.telegram_file_id || "");
        if (!rfid || rfid.startsWith("vip_playlist_") || rfid.startsWith("tmdb_card_")) return true;
        if (isHighValidity && (rfid.startsWith("tg_export_0_") || rfid.startsWith("tg_export_vip_"))) return true;
        if (Number(r.part_number || 1) === entry.part_number && entry.file_fingerprint && entry.file_fingerprint !== "0_0_0x0" && r.file_fingerprint === entry.file_fingerprint && rfid !== entry.telegram_file_id) return true;
        return false;
      });
      if (needsEpPlaceholderOrFpDelete) {
        stmts.push(
          db.prepare(
            `DELETE FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3 AND (
              telegram_file_id IS NULL OR telegram_file_id = ''
              OR telegram_file_id LIKE 'vip_playlist_%' OR telegram_file_id LIKE 'tmdb_card_%'
              ${isHighValidity ? "OR telegram_file_id LIKE 'tg_export_0_%' OR telegram_file_id LIKE 'tg_export_vip_%'" : ""}
              OR (COALESCE(part_number, 1) = ?4 AND COALESCE(file_fingerprint, '') = ?5 AND file_fingerprint != '0_0_0x0' AND telegram_file_id != ?6)
            )`
          ).bind(sid, sNum, eNum, entry.part_number, entry.file_fingerprint || "", entry.telegram_file_id)
        );
      }
      for (const preFid of prereleaseFidsToDelete) {
        stmts.push(
          db.prepare("DELETE FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3 AND telegram_file_id = ?4")
            .bind(sid, sNum, eNum, preFid)
        );
      }
      if (entry.telegram_unique_id && allExistingEpRows.some(r => r && r.telegram_unique_id === entry.telegram_unique_id && r.telegram_file_id !== entry.telegram_file_id)) {
        stmts.push(
          db.prepare("DELETE FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3 AND telegram_unique_id = ?4 AND telegram_file_id != ?5")
            .bind(entry.series_id, entry.season_number, entry.episode_number, entry.telegram_unique_id, entry.telegram_file_id)
        );
      }
      if (msgId && allExistingEpRows.some(r => r && String(r.telegram_file_id || "").endsWith(`_${msgId}`) && String(r.telegram_file_id || "").startsWith("tg_export_") && r.telegram_file_id !== entry.telegram_file_id)) {
        stmts.push(
          db.prepare("DELETE FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3 AND telegram_file_id LIKE ?4 AND telegram_file_id != ?5")
            .bind(sid, sNum, eNum, `tg_export_%_${msgId}`, entry.telegram_file_id)
        );
      }
      stmts.push(
        db.prepare(`INSERT INTO episode_files (
          series_id, season_number, episode_number, telegram_file_id, telegram_unique_id, file_fingerprint, quality, codec, part, part_number, edition_label, is_bonus, is_download_only, tags, version_label, file_size, mime_type, raw_filename, raw_caption, message_link, subtitles_json, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
        ON CONFLICT(series_id, season_number, episode_number, telegram_file_id) DO UPDATE SET
          file_fingerprint = COALESCE(excluded.file_fingerprint, episode_files.file_fingerprint),
          quality = excluded.quality,
          codec = excluded.codec,
          part = COALESCE(excluded.part, episode_files.part),
          part_number = COALESCE(excluded.part_number, episode_files.part_number, 1),
          edition_label = COALESCE(excluded.edition_label, episode_files.edition_label),
          is_bonus = COALESCE(excluded.is_bonus, episode_files.is_bonus, 0),
          is_download_only = COALESCE(excluded.is_download_only, episode_files.is_download_only, 0),
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
            entry.file_fingerprint,
            entry.quality,
            entry.codec,
            entry.part,
            entry.part_number,
            entry.edition_label,
            entry.is_bonus,
            entry.is_download_only,
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
      memoryFallback.delete(`d1_vip_summary_s_${sid}`);
      memoryFallback.delete(`d1_all_ep_files_${sid}`);
      memoryFallback.delete("d1_vip_discover_cache_s");
      memoryFallback.delete("d1_admin_media_list_cache_s");
      return { ok: true, isExactDuplicate, isUpdated, isMergedQuality, isArchiveDownload, skippedPrerelease: false, replacedPrereleaseCount };
    } catch (e) {
      return { ok: true, isExactDuplicate, isUpdated, isMergedQuality, isArchiveDownload, skippedPrerelease: false, replacedPrereleaseCount };
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

      // Free-Plan RAM/CPU-Schutz: Lade NUR Gruppen mit echten Duplikaten (COUNT(*) > 1) statt 100% der Tabellen!
      const [allMoviesRes, allEpsRes] = await Promise.all([
        db.prepare(`
          SELECT id, movie_id, telegram_file_id, telegram_unique_id, quality, codec, part, file_size, updated_at
          FROM movie_files
          WHERE movie_id IN (SELECT movie_id FROM movie_files GROUP BY movie_id HAVING COUNT(*) > 1)
          ORDER BY updated_at DESC
          LIMIT 2500
        `).all().catch(() => ({ results: [] })),
        db.prepare(`
          SELECT ef.id, ef.series_id, ef.season_number, ef.episode_number, ef.telegram_file_id, ef.telegram_unique_id, ef.quality, ef.codec, ef.part, ef.file_size, ef.updated_at
          FROM episode_files ef
          INNER JOIN (
            SELECT series_id, season_number, episode_number
            FROM episode_files
            GROUP BY series_id, season_number, episode_number
            HAVING COUNT(*) > 1
          ) dup ON dup.series_id = ef.series_id AND dup.season_number = ef.season_number AND dup.episode_number = ef.episode_number
          ORDER BY ef.updated_at DESC
          LIMIT 4000
        `).all().catch(() => ({ results: [] }))
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

    const seriesHealRes = await healAndDeduplicateSeriesInD1(env, true).catch(() => ({ mergedDuplicates: 0, healedPosters: 0, upgradedSynthetic: 0 }));

    return {
      ok: true,
      removedBrokenRows,
      removedDuplicateRows,
      upgradedChannelRows,
      mergedSeriesDuplicates: seriesHealRes.mergedDuplicates || 0,
      healedSeriesPosters: seriesHealRes.healedPosters || 0,
      upgradedSyntheticSeries: seriesHealRes.upgradedSynthetic || 0
    };
  }

  // Automatische Bereinigung (Cleanup): Löscht alle Serien & Filme aus D1 & Memory-Fallback, die 0 gültige Videodateien (file_id) haben
  async function cleanupEmptySeriesInD1AndMemory(env, forceRun = false) {
    const now = Date.now();
    const lastCleanupTs = Number(memoryFallback.get("last_empty_series_cleanup_ts") || 0);
    if (!forceRun && lastCleanupTs > 0 && (now - lastCleanupTs) < 300000) {
      return 0;
    }
    memoryFallback.set("last_empty_series_cleanup_ts", now);
    let removedSeriesCount = 0;
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        await Promise.all([
          db.prepare("DELETE FROM episode_files WHERE telegram_file_id IS NULL OR telegram_file_id = '' OR telegram_file_id LIKE 'vip_playlist_%' OR telegram_file_id LIKE 'tmdb_card_%'").run().catch(() => null),
          db.prepare("DELETE FROM movie_files WHERE telegram_file_id IS NULL OR telegram_file_id = '' OR telegram_file_id LIKE 'vip_playlist_%' OR telegram_file_id LIKE 'tmdb_card_%'").run().catch(() => null)
        ]);
        const [delSeriesRes, delMoviesRes] = await Promise.all([
          db.prepare(
            "DELETE FROM series WHERE tmdb_id NOT IN (SELECT DISTINCT series_id FROM episode_files WHERE telegram_file_id IS NOT NULL AND telegram_file_id != '')"
          ).run().catch(() => ({ meta: { changes: 0 } })),
          db.prepare(
            "DELETE FROM movies WHERE tmdb_id NOT IN (SELECT DISTINCT movie_id FROM movie_files WHERE telegram_file_id IS NOT NULL AND telegram_file_id != '')"
          ).run().catch(() => ({ meta: { changes: 0 } }))
        ]);
        removedSeriesCount += Number(delSeriesRes?.meta?.changes || 0) + Number(delMoviesRes?.meta?.changes || 0);
        if (Number(delSeriesRes?.meta?.changes || 0) > 0) {
          await Promise.all([
            db.prepare("DELETE FROM series_seasons WHERE series_id NOT IN (SELECT tmdb_id FROM series)").run().catch(() => null),
            db.prepare("DELETE FROM series_episodes WHERE series_id NOT IN (SELECT tmdb_id FROM series)").run().catch(() => null)
          ]);
        }
      } catch (e) {}
    }

    // Memory-Fallback prüfen: Serien & Filme ohne gültige Videodateien entfernen
    const validSeriesIdsInMem = new Set();
    const validMovieIdsInMem = new Set();
    for (const [k, v] of memoryFallback.entries()) {
      if (k.startsWith("d1_ep_files_") && Array.isArray(v)) {
        const hasValidFile = v.some(ep => Boolean(ep && scoreTelegramFileIdValidity(ep.telegram_file_id || ep.fileId || ep.file_id) > 0));
        if (hasValidFile) {
          const parts = k.split("_");
          const sid = Number(parts[3]);
          if (sid) validSeriesIdsInMem.add(sid);
        }
      } else if (k.startsWith("d1_movie_files_") && Array.isArray(v)) {
        const hasValidFile = v.some(m => Boolean(m && scoreTelegramFileIdValidity(m.telegram_file_id || m.fileId || m.file_id) > 0));
        if (hasValidFile) {
          const mid = Number(k.replace("d1_movie_files_", ""));
          if (mid) validMovieIdsInMem.add(mid);
        }
      }
    }
    const candidateSeriesEntries = [];
    const candidateMovieEntries = [];
    for (const [k, v] of Array.from(memoryFallback.entries())) {
      if ((k.startsWith("d1_catalog_series_") || k.startsWith("d1_series_")) && v && v.id) {
        const sid = Number(v.id);
        if (sid && !validSeriesIdsInMem.has(sid)) {
          candidateSeriesEntries.push({ key: k, id: sid });
        }
      } else if ((k.startsWith("d1_catalog_movie_") || k.startsWith("d1_movie_")) && !k.startsWith("d1_movie_files_") && v && v.id) {
        const mid = Number(v.id);
        if (mid && !validMovieIdsInMem.has(mid)) {
          candidateMovieEntries.push({ key: k, id: mid });
        }
      }
    }

    const dbExistingSeriesIds = new Set();
    const dbExistingMovieIds = new Set();
    if (db && candidateSeriesEntries.length > 0) {
      const uniqSids = [...new Set(candidateSeriesEntries.map(e => e.id))];
      for (let i = 0; i < uniqSids.length; i += 80) {
        const chunk = uniqSids.slice(i, i + 80);
        const ph = chunk.map((_, idx) => `?${idx + 1}`).join(",");
        trackStat("d1Reads");
        const res = await db
          .prepare(`SELECT DISTINCT series_id FROM episode_files WHERE series_id IN (${ph}) AND telegram_file_id IS NOT NULL AND telegram_file_id != ''`)
          .bind(...chunk)
          .all()
          .catch(() => null);
        if (Array.isArray(res?.results)) {
          for (const r of res.results) {
            if (r?.series_id) dbExistingSeriesIds.add(Number(r.series_id));
          }
        }
      }
    }
    if (db && candidateMovieEntries.length > 0) {
      const uniqMids = [...new Set(candidateMovieEntries.map(e => e.id))];
      for (let i = 0; i < uniqMids.length; i += 80) {
        const chunk = uniqMids.slice(i, i + 80);
        const ph = chunk.map((_, idx) => `?${idx + 1}`).join(",");
        trackStat("d1Reads");
        const res = await db
          .prepare(`SELECT DISTINCT movie_id FROM movie_files WHERE movie_id IN (${ph}) AND telegram_file_id IS NOT NULL AND telegram_file_id != ''`)
          .bind(...chunk)
          .all()
          .catch(() => null);
        if (Array.isArray(res?.results)) {
          for (const r of res.results) {
            if (r?.movie_id) dbExistingMovieIds.add(Number(r.movie_id));
          }
        }
      }
    }

    for (const item of candidateSeriesEntries) {
      if (!dbExistingSeriesIds.has(item.id)) {
        memoryFallback.delete(item.key);
        memoryFallback.delete(`d1_series_best_quality_${item.id}`);
        removedSeriesCount++;
      }
    }
    for (const item of candidateMovieEntries) {
      if (!dbExistingMovieIds.has(item.id)) {
        memoryFallback.delete(item.key);
        removedSeriesCount++;
      }
    }
    return removedSeriesCount;
  }

  // Automatische Serien-Konsolidierung & Poster-Reparatur in D1:
  // 1. Führt doppelte Serien-Einträge mit gleichem Titel (z.B. "Generation Kill" mit synthetischer + echter TMDb-ID) zusammen
  // 2. Ersetzt synthetische Fallback-IDs (>= 8000000) oder Fehl-Jahrgänge (z.B. "Black Box" 2014 -> 2023) durch offizielle TMDb-Serien
  // 3. Lädt fehlende Serien-Poster (z.B. "Spuk von draußen", "Axel! will's wissen", "Zur See") aus TMDb-Staffeln/Images, TVMaze, iTunes & OMDb nach
  async function healAndDeduplicateSeriesInD1(env, forceRun = false) {
    const now = Date.now();
    const lastHealTs = Number(memoryFallback.get("last_series_heal_ts") || 0);
    if (!forceRun && lastHealTs > 0 && (now - lastHealTs) < 180000) {
      return { mergedDuplicates: 0, healedPosters: 0, upgradedSynthetic: 0, cached: true };
    }
    memoryFallback.set("last_series_heal_ts", now);

    let mergedDuplicates = 0;
    let healedPosters = 0;
    let upgradedSynthetic = 0;
    const db = await ensureD1Schema(env);
    if (!db) return { mergedDuplicates, healedPosters, upgradedSynthetic };

    const migrateSeriesIdInD1 = async (oldSid, newSid) => {
      if (!oldSid || !newSid || Number(oldSid) === Number(newSid)) return false;
      try {
        const oldEps = await db.prepare("SELECT * FROM episode_files WHERE series_id = ?1").bind(Number(oldSid)).all().catch(() => ({ results: [] }));
        const epRows = Array.isArray(oldEps?.results) ? oldEps.results : [];
        const validEps = epRows.filter(ep => ep && ep.telegram_file_id);
        const insStmts = validEps.map(ep =>
          db.prepare(`
            INSERT INTO episode_files (
              series_id, season_number, episode_number, telegram_file_id, telegram_unique_id,
              file_fingerprint, quality, codec, part, part_number, edition_label,
              is_bonus, is_download_only, tags, version_label, file_size, mime_type,
              raw_filename, raw_caption, message_link, subtitles_json, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
            ON CONFLICT(series_id, season_number, episode_number, telegram_file_id) DO UPDATE SET
              quality = COALESCE(NULLIF(excluded.quality, ''), episode_files.quality),
              file_size = COALESCE(excluded.file_size, episode_files.file_size),
              raw_filename = COALESCE(NULLIF(excluded.raw_filename, ''), episode_files.raw_filename),
              raw_caption = COALESCE(NULLIF(excluded.raw_caption, ''), episode_files.raw_caption),
              message_link = COALESCE(NULLIF(excluded.message_link, ''), episode_files.message_link),
              updated_at = excluded.updated_at
          `).bind(
            Number(newSid),
            ep.season_number != null ? Number(ep.season_number) : 1,
            Number(ep.episode_number || 1),
            String(ep.telegram_file_id),
            ep.telegram_unique_id || null,
            ep.file_fingerprint || null,
            ep.quality || "1080p",
            ep.codec || "x264",
            ep.part || null,
            Number(ep.part_number || 1),
            ep.edition_label || null,
            Number(ep.is_bonus || 0),
            Number(ep.is_download_only || 0),
            ep.tags || null,
            ep.version_label || "Originalfassung",
            ep.file_size != null ? Number(ep.file_size) : null,
            ep.mime_type || null,
            ep.raw_filename || null,
            ep.raw_caption || null,
            ep.message_link || null,
            ep.subtitles_json || "[]",
            now
          )
        );
        // Gebündelte D1-Migration (40er-Chunks statt 200 sequentieller Einzel-Writes) mit striktem Datenverlust-Schutz!
        let migratedOk = 0;
        const rawDbMig = getRawD1Binding(env) || db;
        const MIG_CHUNK = 40;
        for (let i = 0; i < insStmts.length; i += MIG_CHUNK) {
          const slice = insStmts.slice(i, i + MIG_CHUNK);
          if (slice.length > 1 && rawDbMig && typeof rawDbMig.batch === "function") {
            const batchOut = await rawDbMig.batch(unwrapRawD1Statements(slice)).catch(() => null);
            if (!Array.isArray(batchOut) || batchOut.length < slice.length) break;
            migratedOk += batchOut.filter(r => r && r.success !== false).length;
          } else {
            for (const st of slice) {
              const insRes = await st.run().catch(() => null);
              if (insRes && insRes.success !== false) migratedOk++;
            }
          }
        }
        if (validEps.length > 0 && migratedOk < validEps.length) {
          return false;
        }
        await db.batch([
          db.prepare("DELETE FROM episode_files WHERE series_id = ?1").bind(Number(oldSid)),
          db.prepare("DELETE FROM series_episodes WHERE series_id = ?1").bind(Number(oldSid)),
          db.prepare("DELETE FROM series_seasons WHERE series_id = ?1").bind(Number(oldSid)),
          db.prepare("DELETE FROM series WHERE tmdb_id = ?1").bind(Number(oldSid))
        ]).catch(() => null);
        memoryFallback.delete(`d1_series_${oldSid}`);
        memoryFallback.delete(`d1_catalog_series_${oldSid}`);
        memoryFallback.delete(`d1_series_best_quality_${oldSid}`);
        memoryFallback.delete("d1_vip_discover_rows_s");
        memoryFallback.delete("d1_admin_media_list_cache_s");
        memoryFallback.delete("d1_series_gaps_cache");
        tmdbCache.delete(`tv_${oldSid}`);
        return true;
      } catch (e) {
        return false;
      }
    };

    try {
      const allSeriesRes = await db.prepare(
        `SELECT tmdb_id, title, release_date, release_year, vote_average, poster_path, backdrop_path,
                json_extract(details_json, '$.poster_path') AS detail_poster_path,
                json_extract(details_json, '$.external_poster_url') AS detail_ext_poster
         FROM series
         ORDER BY updated_at DESC
         LIMIT 1500`
      ).all().catch(() => ({ results: [] }));
      const seriesRows = Array.isArray(allSeriesRes?.results) ? allSeriesRes.results : [];
      if (!seriesRows.length) return { mergedDuplicates, healedPosters, upgradedSynthetic };

      // Schritt 1: Doppelte Serien mit gleichem normalisiertem Titel zusammenführen (z.B. "Generation Kill")
      const byNormTitle = new Map();
      for (const row of seriesRows) {
        const norm = normalizeCompareString(String(row.title || "").replace(/\s+\d{1,2}$/, "").trim());
        if (!norm) continue;
        if (!byNormTitle.has(norm)) byNormTitle.set(norm, []);
        byNormTitle.get(norm).push(row);
      }

      const deletedSeriesIds = new Set();
      for (const [, group] of byNormTitle.entries()) {
        if (group.length <= 1) continue;
        group.sort((a, b) => {
          const aOfficial = Number(a.tmdb_id) > 0 && Number(a.tmdb_id) < 8000000 ? 1 : 0;
          const bOfficial = Number(b.tmdb_id) > 0 && Number(b.tmdb_id) < 8000000 ? 1 : 0;
          if (aOfficial !== bOfficial) return bOfficial - aOfficial;
          const aHasPoster = a.poster_path ? 1 : 0;
          const bHasPoster = b.poster_path ? 1 : 0;
          if (aHasPoster !== bHasPoster) return bHasPoster - aHasPoster;
          return Number(b.vote_average || 0) - Number(a.vote_average || 0);
        });
        const winner = group[0];
        for (let i = 1; i < group.length; i++) {
          const loser = group[i];
          const ok = await migrateSeriesIdInD1(Number(loser.tmdb_id), Number(winner.tmdb_id));
          if (ok) {
            deletedSeriesIds.add(Number(loser.tmdb_id));
            mergedDuplicates++;
          }
        }
      }

      // Schritt 2: Synthetische Serien (>= 8000000), falsche Jahrgänge (Black Box 2014 -> 2023) & fehlende Poster reparieren
      let apiHealsUsed = 0;
      const maxApiHeals = forceRun ? 10 : 5;
      for (const row of seriesRows) {
        const sid = Number(row.tmdb_id);
        if (!sid || deletedSeriesIds.has(sid)) continue;
        if (apiHealsUsed >= maxApiHeals || !hasSubrequestBudget(25)) break;

        const rawTitle = String(row.title || "").trim();
        const cleanLookupTitle = rawTitle.replace(/\s+\d{1,2}$/, "").trim() || rawTitle;
        const normTitle = normalizeCompareString(cleanLookupTitle);
        const rowYear = Number(row.release_year || String(row.release_date || "").slice(0, 4) || 0) || null;
        const isWrongBlackBox2014 = normTitle === "blackbox" && rowYear === 2014;
        const isSyntheticId = sid >= 8000000;
        const hasAnyPoster = Boolean(
          (row.poster_path && String(row.poster_path).trim()) ||
          (row.detail_poster_path && String(row.detail_poster_path).trim()) ||
          (row.detail_ext_poster && String(row.detail_ext_poster).trim())
        );

        if (isSyntheticId || isWrongBlackBox2014) {
          apiHealsUsed++;
          try {
            let bestTv = null;
            for (const lang of ["de-DE", "en-US", ""]) {
              const langParam = lang ? `&language=${lang}` : "";
              const res = await fetchWithTimeout(
                `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(cleanLookupTitle)}&include_adult=false${langParam}`,
                { headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` } },
                3500
              );
              if (res.ok) {
                const data = await res.json();
                const tvResults = Array.isArray(data.results) ? data.results : [];
                if (tvResults.length > 0) {
                  if (isWrongBlackBox2014) {
                    bestTv = tvResults.find(r => Number((r.first_air_date || "").slice(0, 4)) >= 2020 && r.poster_path) ||
                             tvResults.find(r => Number((r.first_air_date || "").slice(0, 4)) >= 2020) ||
                             tvResults.find(r => r.id !== sid && r.poster_path) || null;
                  } else {
                    bestTv = tvResults.find(r => normalizeCompareString(r.name || r.original_name || "") === normTitle && r.poster_path) ||
                             tvResults.find(r => normalizeCompareString(r.name || r.original_name || "") === normTitle) ||
                             tvResults[0];
                  }
                  if (bestTv && Number(bestTv.id) && Number(bestTv.id) !== sid) break;
                }
              }
            }
            if (bestTv && Number(bestTv.id) && Number(bestTv.id) !== sid) {
              const newSid = Number(bestTv.id);
              const fullDetails = await fetchSeriesDetails(env, newSid);
              if (fullDetails) {
                await saveSeriesToD1(env, fullDetails);
                await migrateSeriesIdInD1(sid, newSid);
                deletedSeriesIds.add(sid);
                upgradedSynthetic++;
                continue;
              }
            }
          } catch (e) {}
        }

        if (!hasAnyPoster) {
          apiHealsUsed++;
          try {
            let foundPosterPath = null;
            let foundExternalPoster = "";
            if (sid > 0 && sid < 8000000) {
              tmdbCache.delete(`tv_${sid}`);
              memoryFallback.delete(`d1_series_${sid}`);
              const imgRes = await fetchWithTimeout(
                `https://api.themoviedb.org/3/tv/${sid}?append_to_response=images&include_image_language=de,en,fr,es,it,ru,cs,pl,null&language=de-DE`,
                { headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` } },
                3500
              );
              if (imgRes.ok) {
                const imgData = await imgRes.json();
                foundPosterPath = imgData.poster_path ||
                  imgData.images?.posters?.[0]?.file_path ||
                  (imgData.seasons || []).find(s => s && s.poster_path)?.poster_path ||
                  imgData.backdrop_path ||
                  imgData.images?.backdrops?.[0]?.file_path ||
                  null;
              }
            }
            if (!foundPosterPath) {
              const tvm = await fetchTvMazeSeriesFallback(cleanLookupTitle, rowYear);
              if (tvm?.imageOriginal) foundExternalPoster = tvm.imageOriginal;
            }
            if (!foundPosterPath && !foundExternalPoster) {
              const itunes = await fetchItunesFallback(env, cleanLookupTitle, rowYear, "s");
              if (itunes?.external_poster_url) foundExternalPoster = itunes.external_poster_url;
            }
            if (!foundPosterPath && !foundExternalPoster) {
              const omdb = await fetchOmdbFallback(env, cleanLookupTitle, rowYear, "s");
              if (omdb?.external_poster_url) foundExternalPoster = omdb.external_poster_url;
            }
            if (foundPosterPath || foundExternalPoster) {
              let parsedDetails = {};
              try {
                const detRow = await db.prepare("SELECT details_json FROM series WHERE tmdb_id = ?1").bind(sid).first();
                if (detRow?.details_json) parsedDetails = JSON.parse(detRow.details_json);
              } catch (_e) {}
              const updatedDetails = {
                ...parsedDetails,
                id: sid,
                title: cleanLookupTitle || row.title,
                poster_path: foundPosterPath || parsedDetails.poster_path || null,
                external_poster_url: foundExternalPoster || parsedDetails.external_poster_url || ""
              };
              await db.prepare(
                "UPDATE series SET poster_path = COALESCE(?2, poster_path), details_json = ?3, updated_at = ?4 WHERE tmdb_id = ?1"
              ).bind(sid, foundPosterPath, JSON.stringify(updatedDetails), now).run().catch(() => null);
              memoryFallback.set(`d1_series_${sid}`, updatedDetails);
              memoryFallback.set(`d1_catalog_series_${sid}`, updatedDetails);
              setCachedTmdb(`tv_${sid}`, updatedDetails);
              healedPosters++;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    return { mergedDuplicates, healedPosters, upgradedSynthetic };
  }

  // 1-Klick Komplett-Reset: Löscht alle Filme, Serien, Episoden, Datei-Links, Fehlermeldungen, Diagnose-Logs, Caches & Playlisten
  // (Benutzerkonten, VIP-Status und Admin-Rechte in 'users' bleiben unberührt!)
  async function resetAllMediaAndPlaylistsInD1AndKv(env) {
    let deletedTables = 0;
    const db = await ensureD1Schema(env);
    const tables = [
      "episode_files",
      "series_episodes",
      "series_seasons",
      "series",
      "movie_files",
      "movies",
      "media_reports",
      "import_diagnostic_logs",
      "d1_playlist_items",
      "d1_playlists",
      "d1_import_checkpoints",
      "search_cache",
      "entity_cache",
      "import_queue"
    ];
    if (db) {
      try {
        trackStat("d1Writes");
        await db.batch(tables.map(tbl => db.prepare(`DELETE FROM ${tbl}`)));
        deletedTables = tables.length;
      } catch (e) {
        for (const tbl of tables) {
          try {
            await db.prepare(`DELETE FROM ${tbl}`).run();
            deletedTables++;
          } catch (err) {}
        }
      }
    }

    tmdbCache.clear();
    if (typeof externalFallbackCache !== "undefined" && externalFallbackCache && typeof externalFallbackCache.clear === "function") {
      externalFallbackCache.clear();
    }
    memoryFallback.delete("d1_media_reports");
    memoryFallback.delete("d1_import_diagnostic_logs");
    for (const k of Array.from(memoryFallback.keys())) {
      if (
        k.startsWith("d1_") ||
        k.startsWith("series_res_") ||
        k.startsWith("title_res_") ||
        k.startsWith("series_ver_resolved_") ||
        k.startsWith("saved_") ||
        k.startsWith("folders_") ||
        k.startsWith("u_bundle_bot_vip") ||
        k.startsWith("bot_vip") ||
        k.startsWith("ingested_streams_") ||
        k.startsWith("tma_import_checkpoint") ||
        k.startsWith("tma_backup_import_checkpoint")
      ) {
        if (!k.startsWith("d1_user_") && !k.startsWith("d1_username_")) {
          memoryFallback.delete(k);
        }
      }
    }
    await kvStageDelete(env, "tma_backup_import_checkpoint_v1", "MOVIE_SAVED");

    await saveRawList(env, "bot_vip", []);
    await saveFolders(env, "bot_vip", []);
    await saveBotVipHiddenKeys(env, new Set());
    await ensureBotVipDefaultPlaylist(env);
    await flushUserSession(env, "bot_vip", { force: true });

    return {
      ok: true,
      deletedTables,
      message: "Komplett-Reset erfolgreich: Alle Filme, Serien, Datei-IDs, Fehlermeldungen, Diagnose-Logs, Caches und Playlisten wurden restlos gelöscht. Benutzer- und VIP-Konten blieben erhalten."
    };
  }

  async function getSeriesSeasonsAndEpisodeTitlesFromD1(env, seriesId, seasonNumber = null, includeFileCounts = true) {
    const sid = Number(seriesId);
    if (!sid) return { seasonCounts: {}, episodeTitleMap: new Map() };
    const seasonCounts = {};
    const episodeTitleMap = new Map();
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        const [sRes, epRes] = await Promise.all([
          includeFileCounts
            ? db.prepare("SELECT season_number, COUNT(DISTINCT episode_number) AS ep_cnt FROM episode_files WHERE series_id = ?1 GROUP BY season_number ORDER BY season_number ASC")
                .bind(sid)
                .all()
                .catch(() => ({ results: [] }))
            : Promise.resolve({ results: [] }),
          seasonNumber !== null
            ? db.prepare("SELECT episode_number, title, overview, vote_average, versions_json FROM series_episodes WHERE series_id = ?1 AND season_number = ?2")
                .bind(sid, Number(seasonNumber))
                .all()
                .catch(() => ({ results: [] }))
            : Promise.resolve({ results: [] })
        ]);
        for (const r of (sRes?.results || [])) {
          const sn = r.season_number != null ? Number(r.season_number) : 1;
          if (sn >= 0) seasonCounts[sn] = Number(r.ep_cnt || 0);
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
        const rawSn = k.split("_").pop();
        const sn = (rawSn !== undefined && rawSn !== "") ? Number(rawSn) : 1;
        if (sn >= 0) {
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

  // Berechnet für alle Serien in D1 + RAM fehlende Folgen (Priorität 1: Interne Staffel-Lücken wie E01+E02 fehlt vor E03 sowie komplett fehlende Zwischen-Staffeln; Priorität 2: Fehlende Folgen bis Staffelende)
  async function computeSeriesGapsOverview(env, forceRefresh = false) {
    const cachedGaps = memoryFallback.get("d1_series_gaps_cache");
    if (!forceRefresh && cachedGaps && cachedGaps.data && (Date.now() - Number(cachedGaps.ts || 0)) < 300000) {
      return cachedGaps.data;
    }
    const db = await ensureD1Schema(env);
    const rawDb = getRawD1Binding(env) || db;
    const seriesMap = new Map();
    const seasonMetaBySeries = new Map();
    const uploadedBySeriesSeason = new Map();
    const allCheckedSeriesIds = new Set();

    if (rawDb) {
      try {
        trackStat("d1Reads");
        if (typeof countD1Subrequest === "function") countD1Subrequest();
        // Free-Plan CPU/RAM-Schutz: Aggregiert episode_files direkt in SQLite (GROUP BY + Prerelease-Check in C++),
        // sodass weder raw_caption/raw_filename noch Duplikate über die IPC-Grenze in den Worker-RAM gelangen!
        const [sRes, ssRes, seCountRes, efRes] = await rawDb.batch([
          rawDb.prepare(`
            SELECT s.tmdb_id, s.title, s.release_year, s.poster_path, s.number_of_seasons, s.number_of_episodes,
                   json_extract(s.details_json, '$.seasons') AS seasons_json,
                   json_extract(s.details_json, '$.external_poster_url') AS ext_poster
            FROM series s
            WHERE EXISTS (SELECT 1 FROM episode_files ef WHERE ef.series_id = s.tmdb_id)
            LIMIT 1000
          `),
          rawDb.prepare(`
            SELECT ss.series_id, ss.season_number,
                   COALESCE(
                     json_extract(ss.episodes_json, '$.seasonEpisodeCount'),
                     CASE WHEN json_type(ss.episodes_json) = 'array' THEN json_array_length(ss.episodes_json) ELSE json_array_length(json_extract(ss.episodes_json, '$.episodes')) END,
                     0
                   ) AS ep_count
            FROM series_seasons ss
            WHERE EXISTS (SELECT 1 FROM episode_files ef WHERE ef.series_id = ss.series_id)
            LIMIT 2500
          `),
          rawDb.prepare(`
            SELECT se.series_id, se.season_number, COUNT(*) AS ep_count, MAX(se.episode_number) AS max_ep
            FROM series_episodes se
            WHERE EXISTS (SELECT 1 FROM episode_files ef WHERE ef.series_id = se.series_id)
            GROUP BY se.series_id, se.season_number
            LIMIT 2500
          `),
          rawDb.prepare(`
            SELECT series_id,
                   COALESCE(season_number, 1) AS season_number,
                   episode_number,
                   MAX(COALESCE(quality, '1080p')) AS quality,
                   MAX(
                     CASE
                       WHEN LOWER(COALESCE(tags, '') || ' ' || COALESCE(version_label, '') || ' ' || COALESCE(raw_filename, '') || ' ' || COALESCE(raw_caption, '')) LIKE '%vorabversion%'
                         OR LOWER(COALESCE(tags, '') || ' ' || COALESCE(version_label, '') || ' ' || COALESCE(raw_filename, '')) LIKE '%telesync%'
                         OR LOWER(COALESCE(tags, '') || ' ' || COALESCE(version_label, '') || ' ' || COALESCE(raw_filename, '')) LIKE '%camrip%'
                         OR LOWER(COALESCE(tags, '') || ' ' || COALESCE(version_label, '') || ' ' || COALESCE(raw_filename, '')) LIKE '%hdcam%'
                         OR LOWER(COALESCE(tags, '') || ' ' || COALESCE(version_label, '') || ' ' || COALESCE(raw_filename, '')) LIKE '%micdub%'
                         OR LOWER(COALESCE(tags, '') || ' ' || COALESCE(version_label, '') || ' ' || COALESCE(raw_filename, '')) LIKE '%mic.dub%'
                         OR LOWER(COALESCE(tags, '') || ' ' || COALESCE(version_label, '') || ' ' || COALESCE(raw_filename, '')) LIKE '%mic dub%'
                         OR LOWER(COALESCE(tags, '') || ' ' || COALESCE(version_label, '') || ' ' || COALESCE(raw_filename, '')) LIKE '%linedub%'
                         OR LOWER(COALESCE(tags, '') || ' ' || COALESCE(version_label, '') || ' ' || COALESCE(raw_filename, '')) LIKE '%dvdscr%'
                         OR LOWER(COALESCE(tags, '') || ' ' || COALESCE(version_label, '') || ' ' || COALESCE(raw_filename, '')) LIKE '%screener%'
                         OR LOWER(COALESCE(tags, '') || ' ' || COALESCE(version_label, '') || ' ' || COALESCE(raw_filename, '')) LIKE '%workprint%'
                       THEN 0
                       ELSE 1
                     END
                   ) AS has_clean
            FROM episode_files
            WHERE telegram_file_id IS NOT NULL AND telegram_file_id != ''
              AND telegram_file_id NOT LIKE 'vip_playlist_%' AND telegram_file_id NOT LIKE 'tmdb_card_%'
              AND series_id > 0 AND episode_number > 0
            GROUP BY series_id, COALESCE(season_number, 1), episode_number
            LIMIT 12000
          `)
        ]);
        for (const r of (sRes?.results || [])) {
          if (!r || !r.tmdb_id) continue;
          const sid = Number(r.tmdb_id);
          allCheckedSeriesIds.add(sid);
          let parsedSeasons = [];
          try {
            const p = r.seasons_json ? JSON.parse(r.seasons_json) : null;
            if (Array.isArray(p)) parsedSeasons = p;
          } catch (_) {}
          seriesMap.set(sid, {
            tmdbId: sid,
            title: r.title || `Serie #${sid}`,
            year: r.release_year || "k.A.",
            poster: resolvePosterUrl(r.poster_path, "w185", r.ext_poster || ""),
            numberOfSeasons: Number(r.number_of_seasons || parsedSeasons.length || 1),
            detailsSeasons: parsedSeasons
          });
        }
        for (const sr of (ssRes?.results || [])) {
          const sid = Number(sr?.series_id || 0);
          const sNum = Number(sr?.season_number || 0);
          const epCount = Number(sr?.ep_count || 0);
          if (!sid || !sNum || epCount <= 0) continue;
          allCheckedSeriesIds.add(sid);
          if (!seasonMetaBySeries.has(sid)) seasonMetaBySeries.set(sid, new Map());
          seasonMetaBySeries.get(sid).set(sNum, epCount);
        }
        for (const secRow of (seCountRes?.results || [])) {
          const sid = Number(secRow?.series_id || 0);
          const sNum = Number(secRow?.season_number || 0);
          const cnt = Math.max(Number(secRow?.ep_count || 0), Number(secRow?.max_ep || 0));
          if (!sid || !sNum || cnt <= 0) continue;
          allCheckedSeriesIds.add(sid);
          if (!seasonMetaBySeries.has(sid)) seasonMetaBySeries.set(sid, new Map());
          const prevCnt = seasonMetaBySeries.get(sid).get(sNum) || 0;
          if (cnt > prevCnt) seasonMetaBySeries.get(sid).set(sNum, cnt);
        }
        for (const ef of (efRes?.results || [])) {
          const sid = Number(ef?.series_id || 0);
          const sNum = ef?.season_number != null ? Number(ef.season_number) : 1;
          const eNum = Number(ef?.episode_number || 0);
          if (!sid || sNum <= 0 || eNum <= 0) continue;
          allCheckedSeriesIds.add(sid);
          const key = `${sid}_${sNum}`;
          if (!uploadedBySeriesSeason.has(key)) uploadedBySeriesSeason.set(key, new Map());
          const epMap = uploadedBySeriesSeason.get(key);
          const isPre = ef.has_clean !== undefined && ef.has_clean !== null
            ? Number(ef.has_clean) === 0
            : isPrereleaseOrMicDub(ef.raw_caption, ef.raw_filename, ef.tags || ef.version_label);
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
        allCheckedSeriesIds.add(sid);
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
        const sNum = (parts[1] !== undefined && parts[1] !== "") ? Number(parts[1]) : 1;
        if (sid > 0 && sNum > 0) {
          allCheckedSeriesIds.add(sid);
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

    // Bestimme pro Serie die höchste hochgeladene Staffelnummer, um auch komplett fehlende Zwischen-Staffeln (z.B. S01 & S03 vorhanden, S02 fehlt komplett) zu prüfen!
    const maxSeasonBySeries = new Map();
    const seasonsToInspectBySeries = new Map();
    for (const [key, epMap] of uploadedBySeriesSeason.entries()) {
      if (!epMap || epMap.size === 0) continue;
      const [sidStr, sNumStr] = key.split("_");
      const sid = Number(sidStr);
      const sNum = Number(sNumStr);
      if (!sid || !sNum) continue;
      const curMax = maxSeasonBySeries.get(sid) || 0;
      if (sNum > curMax) maxSeasonBySeries.set(sid, sNum);
      if (!seasonsToInspectBySeries.has(sid)) seasonsToInspectBySeries.set(sid, new Set());
      seasonsToInspectBySeries.get(sid).add(sNum);
    }
    for (const [sid, maxS] of maxSeasonBySeries.entries()) {
      const sSet = seasonsToInspectBySeries.get(sid);
      for (let s = 1; s <= maxS; s++) {
        sSet.add(s);
      }
    }

    const seriesGapsList = [];
    let totalSeriesWithInternalGaps = 0;
    let totalInternalMissingEpisodes = 0;
    let totalTrailingMissingEpisodes = 0;
    let totalPrereleaseOnlyEpisodes = 0;

    for (const [sid, seasonSet] of seasonsToInspectBySeries.entries()) {
      const maxUploadedSeason = maxSeasonBySeries.get(sid) || 1;
      const sMeta = seriesMap.get(sid) || {
        tmdbId: sid,
        title: memoryFallback.get(`title_cache_s_${sid}`) || `Serie #${sid}`,
        year: "k.A.",
        poster: "",
        numberOfSeasons: maxUploadedSeason,
        detailsSeasons: []
      };

      const sortedSeasonNums = Array.from(seasonSet).sort((a, b) => a - b);
      for (const sNum of sortedSeasonNums) {
        const epMap = uploadedBySeriesSeason.get(`${sid}_${sNum}`) || new Map();
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

        // Spezialfall: Komplett fehlende Zwischen-Staffel (z.B. Staffel 2 hat 0 Folgen, aber Staffel 3 hat Folgen!)
        const isCompletelyMissingIntermediateSeason = presentEps.length === 0 && sNum < maxUploadedSeason;
        const effectiveTotalExpected = isCompletelyMissingIntermediateSeason
          ? Math.max(officialCount || 10, 1)
          : Math.max(officialCount || 0, maxUploadedEp);

        // Priorität 1: Interne Lücken innerhalb der Staffel (1 .. maxUploadedEp) ODER komplett fehlende Zwischen-Staffel!
        const missingInternal = [];
        if (isCompletelyMissingIntermediateSeason) {
          for (let ep = 1; ep <= Math.min(effectiveTotalExpected, 100); ep++) {
            missingInternal.push(ep);
          }
        } else {
          for (let ep = 1; ep <= maxUploadedEp; ep++) {
            if (!epMap.has(ep)) missingInternal.push(ep);
          }
        }

        // Zusammenhängende Lücken-Blöcke (insb. Multi-Episode-Gaps wie "Episode 1 & 2 missing, 3 exists") berechnen
        const internalGapRanges = [];
        const gapHighlights = [];
        let hasMultiEpisodeGap = false;
        if (isCompletelyMissingIntermediateSeason) {
          hasMultiEpisodeGap = true;
          const labelDe = `Komplette Staffel ${sNum} fehlt (vor Staffel ${maxUploadedSeason})`;
          const labelEn = `Entire Season ${sNum} missing (before Season ${maxUploadedSeason})`;
          internalGapRanges.push({
            startEpisode: 1,
            endEpisode: effectiveTotalExpected,
            count: effectiveTotalExpected,
            nextExistingEpisode: 1,
            isMultiEpisodeGap: true,
            isMissingSeason: true,
            labelDe,
            labelEn
          });
          gapHighlights.push(labelDe);
        } else if (missingInternal.length > 0) {
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
        if (!isCompletelyMissingIntermediateSeason && effectiveTotalExpected > maxUploadedEp) {
          for (let ep = maxUploadedEp + 1; ep <= Math.min(effectiveTotalExpected, 250); ep++) {
            missingTrailing.push(ep);
          }
        }

        if (missingInternal.length === 0 && missingTrailing.length === 0 && prereleaseEps.length === 0) {
          continue;
        }

        totalInternalMissingEpisodes += missingInternal.length;
        totalTrailingMissingEpisodes += missingTrailing.length;
        totalPrereleaseOnlyEpisodes += prereleaseEps.length;

        let seriesObj = seriesGapsList.find(x => x.tmdbId === sid);
        if (!seriesObj) {
          seriesObj = {
            tmdbId: sid,
            seriesId: sid,
            title: sMeta.title,
            year: sMeta.year,
            poster: sMeta.poster,
            hasInternalGaps: false,
            hasPriorityInternalGaps: false,
            hasMultiEpisodeGap: false,
            internalMissingCount: 0,
            totalInternalMissing: 0,
            trailingMissingCount: 0,
            totalTrailingMissing: 0,
            totalPrerelease: 0,
            seasons: []
          };
          seriesGapsList.push(seriesObj);
        }
        if (missingInternal.length > 0) {
          seriesObj.hasInternalGaps = true;
          seriesObj.hasPriorityInternalGaps = true;
        }
        if (hasMultiEpisodeGap) seriesObj.hasMultiEpisodeGap = true;
        seriesObj.internalMissingCount += missingInternal.length;
        seriesObj.totalInternalMissing += missingInternal.length;
        seriesObj.trailingMissingCount += missingTrailing.length;
        seriesObj.totalTrailingMissing += missingTrailing.length;
        seriesObj.totalPrerelease += prereleaseEps.length;
        seriesObj.seasons.push({
          seasonNumber: sNum,
          presentEpisodes: presentEps,
          uploadedEpisodes: presentEps,
          uploadedCount: presentEps.length,
          prereleaseEpisodes: prereleaseEps,
          maxUploadedEp: isCompletelyMissingIntermediateSeason ? effectiveTotalExpected : maxUploadedEp,
          expectedTotalEpisodes: effectiveTotalExpected,
          missingInternal,
          internalGaps: missingInternal,
          missingTrailing,
          trailingMissing: missingTrailing,
          isCompletelyMissingSeason: isCompletelyMissingIntermediateSeason,
          hasMultiEpisodeGap,
          internalGapRanges,
          gapHighlights
        });
      }
    }

    let totalSeriesWithMultiEpisodeGaps = 0;
    for (const s of seriesGapsList) {
      s.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
      if (s.hasInternalGaps) totalSeriesWithInternalGaps++;
      if (s.hasMultiEpisodeGap) totalSeriesWithMultiEpisodeGaps++;
    }

    // Sortiere Serien mit Multi-Episode-Gaps (z.B. E01+E02 fehlt vor E03 oder fehlende Zwischen-Staffel) und internen Staffel-Lücken immer ganz nach oben!
    seriesGapsList.sort((a, b) => {
      if (a.hasMultiEpisodeGap !== b.hasMultiEpisodeGap) return a.hasMultiEpisodeGap ? -1 : 1;
      if (a.hasInternalGaps !== b.hasInternalGaps) return a.hasInternalGaps ? -1 : 1;
      if (b.internalMissingCount !== a.internalMissingCount) return b.internalMissingCount - a.internalMissingCount;
      if (b.trailingMissingCount !== a.trailingMissingCount) return b.trailingMissingCount - a.trailingMissingCount;
      return String(a.title || "").localeCompare(String(b.title || ""), "de");
    });

    // Zusatz-Feature: Mehrteiler-Prüfung für fehlende CD1 oder CD2 Teile bei Filmen
    const incompleteMultipartMovies = [];
    if (db) {
      try {
        const mpRes = await db.prepare(`
          SELECT mf.movie_id, mf.part, mf.part_number, mf.raw_filename, m.title, m.release_year, m.poster_path
          FROM movie_files mf
          LEFT JOIN movies m ON m.tmdb_id = mf.movie_id
          WHERE (mf.part IS NOT NULL AND mf.part != '') OR COALESCE(mf.part_number, 1) > 1
        `).all();
        const byMovie = new Map();
        for (const r of (mpRes?.results || [])) {
          if (!r || !r.movie_id) continue;
          const mid = Number(r.movie_id);
          const pMatch = String(r.part || "").match(/(\d+)/);
          const pNum = Number(r.part_number || (pMatch ? pMatch[1] : 1)) || 1;
          if (!byMovie.has(mid)) {
            byMovie.set(mid, {
              movieId: mid,
              title: r.title || `Film #${mid}`,
              year: r.release_year || "k.A.",
              posterPath: r.poster_path || null,
              presentParts: new Set(),
              sampleFilename: r.raw_filename || ""
            });
          }
          byMovie.get(mid).presentParts.add(pNum);
        }
        for (const mEntry of byMovie.values()) {
          const partsArr = Array.from(mEntry.presentParts).sort((a, b) => a - b);
          const maxPart = Math.max(...partsArr, 1);
          const missingParts = [];
          // Wenn CD1 vorhanden ist, aber CD2 fehlt, oder wenn CD2 vorhanden ist, aber CD1 fehlt:
          const expectedMax = Math.max(maxPart, partsArr.includes(1) && partsArr.length === 1 ? 2 : maxPart);
          for (let p = 1; p <= expectedMax; p++) {
            if (!mEntry.presentParts.has(p)) missingParts.push(`CD ${p}`);
          }
          if (missingParts.length > 0) {
            incompleteMultipartMovies.push({
              movieId: mEntry.movieId,
              title: mEntry.title,
              year: mEntry.year,
              posterPath: mEntry.posterPath,
              presentParts: partsArr.map(p => `CD ${p}`),
              missingParts,
              sampleFilename: mEntry.sampleFilename
            });
          }
        }
      } catch (e) {}
    }

    const totalCheckedCount = Math.max(allCheckedSeriesIds.size, seasonsToInspectBySeries.size, seriesGapsList.length);
    const resultObj = {
      // Felder für TMA Admin-Panel (08c-tma-netflix-frontend.js)
      totalSeriesChecked: totalCheckedCount,
      seriesWithGapsCount: seriesGapsList.length,
      seriesWithInternalGapsCount: totalSeriesWithInternalGaps,
      totalMissingInternal: totalInternalMissingEpisodes,
      totalMissingTrailing: totalTrailingMissingEpisodes,
      totalPrereleaseOnly: totalPrereleaseOnlyEpisodes,
      incompleteMultipartMovies,
      multipartMovieGapsCount: incompleteMultipartMovies.length,
      items: seriesGapsList,
      // Felder für SeriesHealth Studio-Modul & Abwärtskompatibilität
      totalSeriesWithGaps: seriesGapsList.length,
      totalSeriesWithInternalGaps,
      totalSeriesWithMultiEpisodeGaps,
      totalInternalMissingEpisodes,
      totalTrailingMissingEpisodes,
      series: seriesGapsList
    };
    memoryFallback.set("d1_series_gaps_cache", { ts: Date.now(), data: resultObj });
    return resultObj;
  }

  async function getMediaDownloadsFromD1(env, typeCode, tmdbId, detailsObj = null) {
    if (!tmdbId) return [];
    const idNum = Number(tmdbId);
    const isSeries = typeCode === "s";
    const memKey = isSeries ? `d1_series_downloads_${idNum}` : `d1_movie_downloads_${idNum}`;
    const combined = [];
    if (Array.isArray(detailsObj?.downloads)) {
      combined.push(...detailsObj.downloads);
    }
    const memDownloads = memoryFallback.get(memKey);
    if (Array.isArray(memDownloads)) {
      combined.push(...memDownloads);
    }
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const sql = isSeries
          ? "SELECT series_id, season_number, episode_number, telegram_file_id, telegram_unique_id, file_fingerprint, quality, codec, part, part_number, is_download_only, file_size, raw_filename, raw_caption, message_link, updated_at FROM episode_files WHERE series_id = ?1 AND (COALESCE(is_download_only, 0) = 1 OR codec = 'ARCHIVE' OR COALESCE(is_bonus, 0) = 2) ORDER BY season_number ASC, episode_number ASC, COALESCE(part_number, 1) ASC"
          : "SELECT movie_id, telegram_file_id, telegram_unique_id, file_fingerprint, quality, codec, part, part_number, is_download_only, file_size, raw_filename, raw_caption, message_link, updated_at FROM movie_files WHERE movie_id = ?1 AND (COALESCE(is_download_only, 0) = 1 OR codec = 'ARCHIVE' OR COALESCE(is_bonus, 0) = 2) ORDER BY COALESCE(part_number, 1) ASC, updated_at DESC";
        const res = await db.prepare(sql).bind(idNum).all();
        if (Array.isArray(res?.results) && res.results.length > 0) {
          for (const r of res.results) {
            const archMeta = detectArchiveCodecAndPart(r.raw_filename || "", r.raw_caption || "");
            const pNum = Number(r.part_number || archMeta?.partNumber || 1) || 1;
            combined.push({
              ...r,
              type: "archive",
              isDownloadOnly: true,
              is_download_only: 1,
              codec: (r.codec && r.codec !== "ARCHIVE") ? r.codec : (archMeta?.codec || "RAR"),
              part: r.part || archMeta?.partLabel || (pNum > 1 ? `RAR-PART${pNum}` : "RAR"),
              part_number: pNum
            });
          }
        }
      } catch (e) {}
    }
    const dedupMap = new Map();
    for (const item of combined) {
      const fid = String(item?.telegram_file_id || item?.file_id || "").trim();
      if (!fid) continue;
      const archMeta = detectArchiveCodecAndPart(item.raw_filename || item.file_name || "", item.raw_caption || "");
      const pNum = Number(item.part_number || item.partNumber || archMeta?.partNumber || 1) || 1;
      const key = `${Number(item.season_number || 0)}_${Number(item.episode_number || 0)}_${pNum}_${fid}`;
      if (!dedupMap.has(key)) {
        dedupMap.set(key, {
          ...item,
          telegram_file_id: fid,
          type: "archive",
          isDownloadOnly: true,
          is_download_only: 1,
          codec: (item.codec && item.codec !== "ARCHIVE") ? item.codec : (archMeta?.codec || "RAR"),
          part: item.part || archMeta?.partLabel || (pNum > 1 ? `RAR-PART${pNum}` : "RAR"),
          part_number: pNum
        });
      }
    }
    const sortedDownloads = Array.from(dedupMap.values()).sort((a, b) =>
      (Number(a.season_number || 0) - Number(b.season_number || 0)) ||
      (Number(a.episode_number || 0) - Number(b.episode_number || 0)) ||
      (Number(a.part_number || 1) - Number(b.part_number || 1)) ||
      String(a.raw_filename || "").localeCompare(String(b.raw_filename || ""), "de", { numeric: true })
    );
    if (sortedDownloads.length > 0) {
      memoryFallback.set(memKey, sortedDownloads);
    }
    return sortedDownloads;
  }

  async function getEpisodeFilesFromD1(env, seriesId, seasonNumber, episodeNumber = null) {
    if (!seriesId) return [];
    const sid = Number(seriesId);
    const sNum = (seasonNumber !== undefined && seasonNumber !== null && seasonNumber !== "")
      ? Math.max(0, Number(seasonNumber))
      : 1;
    const memKey = `d1_ep_files_${sid}_${sNum}`;
    if (episodeNumber !== null) {
      const eNum = Number(episodeNumber);
      const memEpTsKey = `d1_ep_files_ts_${sid}_${sNum}_${eNum}`;
      const memFiles = memoryFallback.get(memKey);
      if (Array.isArray(memFiles) && (Date.now() - Number(memoryFallback.get(memEpTsKey) || 0)) < 180000) {
        const filtered = memFiles.filter(f => Number(f.episode_number) === eNum);
        if (filtered.length > 0) {
          return sortAndDedupeStreamFiles(filtered.map(enrichStreamFileRowMeta));
        }
      }
    }
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        if (episodeNumber !== null) {
          const eNum = Number(episodeNumber);
          const res = await db
            .prepare("SELECT id, series_id, season_number, episode_number, telegram_file_id, telegram_unique_id, quality, codec, part, part_number, is_bonus, is_download_only, tags, version_label, file_size, mime_type, raw_filename, raw_caption, message_link, subtitles_json, updated_at FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3 ORDER BY updated_at DESC")
            .bind(sid, sNum, eNum)
            .all();
          if (Array.isArray(res?.results) && res.results.length > 0) {
            const sorted = sortAndDedupeStreamFiles(res.results.map(enrichStreamFileRowMeta));
            const existingMem = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];
            const otherEps = existingMem.filter(x => x && Number(x.episode_number) !== eNum);
            memoryFallback.set(memKey, [...sorted, ...otherEps]);
            memoryFallback.set(`d1_ep_files_ts_${sid}_${sNum}_${eNum}`, Date.now());
            return sorted;
          }
        } else {
          const resAll = await db
            .prepare("SELECT id, series_id, season_number, episode_number, telegram_file_id, telegram_unique_id, quality, codec, part, part_number, is_bonus, is_download_only, tags, version_label, file_size, mime_type, raw_filename, raw_caption, message_link, subtitles_json, updated_at FROM episode_files WHERE series_id = ?1 AND season_number = ?2 ORDER BY episode_number ASC, updated_at DESC")
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
            for (const [epKey, epRows] of byEp.entries()) {
              merged.push(...sortAndDedupeStreamFiles(epRows));
              memoryFallback.set(`d1_ep_files_ts_${sid}_${sNum}_${epKey}`, Date.now());
            }
            memoryFallback.set(memKey, merged);
            return merged;
          }
        }
      } catch (e) {}
    }
    const memFiles = memoryFallback.get(memKey);
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

  // Ersetzt eine synthetische Export-Referenz (tg_export_<channelId>_<msgId> inkl. -100-Variante) dauerhaft durch eine echte Telegram file_id in D1 + Memory
  async function replaceExportFileIdInD1(env, oldExportFileId, realTelegramFileId, realUniqueId = null) {
    if (!oldExportFileId || !realTelegramFileId || oldExportFileId === realTelegramFileId) return false;
    const nowTs = Date.now();
    // Zero-Write-Fast-Exit: Wenn in D1 überhaupt keine tg_export_-Platzhalter existieren, sparen wir bei Videos
    // aus nicht-aktivierten Kanälen/Gruppen 2 unnötige D1-UPDATEs + Memory-Scan pro Video!
    const cachedPresence = memoryFallback.get("d1_has_tg_export_placeholders");
    if (cachedPresence && cachedPresence.hasAny === false && (nowTs - Number(cachedPresence.ts || 0)) < 300000) {
      return false;
    }
    const db = await ensureD1Schema(env);
    if (db && (!cachedPresence || (nowTs - Number(cachedPresence.ts || 0)) >= (cachedPresence.hasAny ? 60000 : 300000))) {
      try {
        trackStat("d1Reads");
        const probeRes = await db.batch([
          db.prepare("SELECT 1 AS hit FROM movie_files WHERE telegram_file_id >= 'tg_export_' AND telegram_file_id < 'tg_export`' LIMIT 1"),
          db.prepare("SELECT 1 AS hit FROM episode_files WHERE telegram_file_id >= 'tg_export_' AND telegram_file_id < 'tg_export`' LIMIT 1")
        ]);
        const hasAny = Boolean((probeRes?.[0]?.results?.length || 0) > 0 || (probeRes?.[1]?.results?.length || 0) > 0);
        memoryFallback.set("d1_has_tg_export_placeholders", { hasAny, ts: nowTs });
        if (!hasAny) return false;
      } catch (_probeErr) {}
    }

    const candidateSet = new Set([String(oldExportFileId).trim()]);
    const expMatch = String(oldExportFileId).trim().match(/^tg_export_(-?\d+)_(\d+)$/i);
    if (expMatch) {
      const rawChan = expMatch[1].replace(/^-100/, "").replace(/^-/, "");
      const msgNum = expMatch[2];
      if (rawChan) {
        candidateSet.add(`tg_export_${rawChan}_${msgNum}`);
        candidateSet.add(`tg_export_-100${rawChan}_${msgNum}`);
      }
    }
    const candidates = Array.from(candidateSet).filter(Boolean);
    if (candidates.length === 0) return false;
    let updatedAny = false;
    try {
      for (const [k, v] of memoryFallback.entries()) {
        if ((k.startsWith("d1_movie_files_") || k.startsWith("d1_ep_files_")) && Array.isArray(v)) {
          for (const item of v) {
            if (item && candidateSet.has(String(item.telegram_file_id || ""))) {
              item.telegram_file_id = realTelegramFileId;
              if (realUniqueId) item.telegram_unique_id = realUniqueId;
              updatedAny = true;
            }
          }
        }
      }
      if (db) {
        trackStat("d1Writes");
        const placeholders = candidates.map((_, idx) => `?${idx + 4}`).join(", ");
        await db.batch([
          db.prepare(`UPDATE movie_files SET telegram_file_id = ?1, telegram_unique_id = COALESCE(?2, telegram_unique_id), updated_at = ?3 WHERE telegram_file_id IN (${placeholders})`)
            .bind(realTelegramFileId, realUniqueId, nowTs, ...candidates),
          db.prepare(`UPDATE episode_files SET telegram_file_id = ?1, telegram_unique_id = COALESCE(?2, telegram_unique_id), updated_at = ?3 WHERE telegram_file_id IN (${placeholders})`)
            .bind(realTelegramFileId, realUniqueId, nowTs, ...candidates)
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

    // 1. Memory-Fallback & L1-Cache prüfen (inkl. positivem & negativem VIP-Summary-Cache -> spart >90% D1-Reads beim Katalog-Blättern!)
    const nowVipCheckTs = Date.now();
    const uncachedVipMovieIds = [];
    const uncachedPosterMovieIds = [];
    const uncachedVipSeriesIds = [];
    const uncachedPosterSeriesIds = [];

    for (const it of items) {
      if (!it || !it.id) continue;
      const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : fallbackTypeCode;
      const tid = Number(it.id);
      const hasInlinePoster = Boolean(it.poster_path || it.external_poster_url);
      if (tc === "s") {
        const cachedS = getCachedTmdb(`tv_${tid}`) || memoryFallback.get(`d1_catalog_series_${tid}`);
        if (cachedS && (cachedS.poster_path || cachedS.external_poster_url)) {
          posterMap.set(`s_${tid}`, cachedS.poster_path || cachedS.external_poster_url);
        } else if (!hasInlinePoster && !memoryFallback.has(`d1_poster_miss_s_${tid}`)) {
          uncachedPosterSeriesIds.push(tid);
        }
        if (hasVipStreamAccess) {
          const cachedVipS = memoryFallback.get(`d1_vip_summary_s_${tid}`);
          if (cachedVipS && (nowVipCheckTs - Number(cachedVipS.ts || 0)) < 1800000) {
            if (!cachedVipS.none && cachedVipS.label) {
              bestSeriesMap.set(tid, { label: cachedVipS.label, count: Number(cachedVipS.count || 1) });
            }
          } else {
            const memBest = memoryFallback.get(`d1_series_best_quality_${tid}`);
            if (memBest) {
              bestSeriesMap.set(tid, { label: String(memBest), count: 1 });
              memoryFallback.set(`d1_vip_summary_s_${tid}`, { label: String(memBest), count: 1, ts: nowVipCheckTs });
            } else {
              uncachedVipSeriesIds.push(tid);
            }
          }
        }
      } else {
        const cachedM = getCachedTmdb(`movie_${tid}`) || memoryFallback.get(`d1_catalog_movie_${tid}`);
        if (cachedM && (cachedM.poster_path || cachedM.external_poster_url)) {
          posterMap.set(`m_${tid}`, cachedM.poster_path || cachedM.external_poster_url);
        } else if (!hasInlinePoster && !memoryFallback.has(`d1_poster_miss_m_${tid}`)) {
          uncachedPosterMovieIds.push(tid);
        }
        if (hasVipStreamAccess) {
          const cachedVipM = memoryFallback.get(`d1_vip_summary_m_${tid}`);
          if (cachedVipM && (nowVipCheckTs - Number(cachedVipM.ts || 0)) < 1800000) {
            if (!cachedVipM.none && cachedVipM.label) {
              bestMovieMap.set(tid, { label: cachedVipM.label, count: Number(cachedVipM.count || 1) });
            }
          } else {
            const mFiles = memoryFallback.get(`d1_movie_files_${tid}`);
            if (Array.isArray(mFiles) && mFiles.length > 0) {
              const validMFiles = mFiles.filter(f => f && scoreTelegramFileIdValidity(f.telegram_file_id || f.fileId || f.file_id) > 0);
              const sorted = sortAndDedupeStreamFiles(validMFiles);
              const top = sorted[0];
              if (top) {
                const summaryObj = {
                  label: `${top.quality || "1080p"}${top.codec ? " " + top.codec : ""}`.trim(),
                  count: sorted.length,
                  ts: nowVipCheckTs
                };
                bestMovieMap.set(tid, summaryObj);
                memoryFallback.set(`d1_vip_summary_m_${tid}`, summaryObj);
              } else {
                uncachedVipMovieIds.push(tid);
              }
            } else {
              uncachedVipMovieIds.push(tid);
            }
          }
        }
      }
    }

    // 2. D1-Datenbank in EINER EINZIGEN rawDb.batch() Abfrage für alle noch nicht im RAM-Cache geprüften IDs abfragen!
    const db = await ensureD1Schema(env);
    const rawDb = getRawD1Binding(env);
    if (db && rawDb) {
      try {
        const uniqPosterM = [...new Set(uncachedPosterMovieIds)].slice(0, 60);
        const uniqVipM = hasVipStreamAccess ? [...new Set(uncachedVipMovieIds)].slice(0, 60) : [];
        const uniqPosterS = [...new Set(uncachedPosterSeriesIds)].slice(0, 60);
        const uniqVipS = hasVipStreamAccess ? [...new Set(uncachedVipSeriesIds)].slice(0, 60) : [];

        const batchStmts = [];
        const batchKinds = [];
        if (uniqPosterM.length > 0) {
          batchStmts.push(rawDb.prepare(`SELECT tmdb_id, poster_path FROM movies WHERE tmdb_id IN (${uniqPosterM.map((_, i) => `?${i + 1}`).join(",")})`).bind(...uniqPosterM));
          batchKinds.push("pm");
        }
        if (uniqVipM.length > 0) {
          batchStmts.push(rawDb.prepare(`SELECT movie_id, quality, codec, MAX(telegram_file_id) AS telegram_file_id, COUNT(*) AS file_cnt FROM movie_files WHERE movie_id IN (${uniqVipM.map((_, i) => `?${i + 1}`).join(",")}) AND telegram_file_id IS NOT NULL AND telegram_file_id != '' AND telegram_file_id NOT LIKE 'vip_playlist_%' AND telegram_file_id NOT LIKE 'tmdb_card_%' GROUP BY movie_id, quality, codec`).bind(...uniqVipM));
          batchKinds.push("vm");
        }
        if (uniqPosterS.length > 0) {
          batchStmts.push(rawDb.prepare(`SELECT tmdb_id, poster_path FROM series WHERE tmdb_id IN (${uniqPosterS.map((_, i) => `?${i + 1}`).join(",")})`).bind(...uniqPosterS));
          batchKinds.push("ps");
        }
        if (uniqVipS.length > 0) {
          batchStmts.push(rawDb.prepare(`SELECT series_id, quality, codec, MAX(telegram_file_id) AS telegram_file_id, COUNT(*) AS file_cnt FROM episode_files WHERE series_id IN (${uniqVipS.map((_, i) => `?${i + 1}`).join(",")}) AND telegram_file_id IS NOT NULL AND telegram_file_id != '' AND telegram_file_id NOT LIKE 'vip_playlist_%' AND telegram_file_id NOT LIKE 'tmdb_card_%' GROUP BY series_id, quality, codec`).bind(...uniqVipS));
          batchKinds.push("vs");
        }

        if (batchStmts.length > 0) {
          trackStat("d1Reads");
          countD1Subrequest();
          const batchRes = await rawDb.batch(batchStmts);
          for (let bIdx = 0; bIdx < batchKinds.length; bIdx++) {
            const kind = batchKinds[bIdx];
            const rows = batchRes?.[bIdx]?.results || [];
            if (kind === "pm") {
              const foundPosterM = new Set();
              for (const row of rows) {
                const mid = Number(row.tmdb_id);
                const pVal = row.poster_path || "";
                if (pVal) {
                  posterMap.set(`m_${mid}`, pVal);
                  foundPosterM.add(mid);
                }
              }
              for (const mid of uniqPosterM) {
                if (!foundPosterM.has(mid)) memoryFallback.set(`d1_poster_miss_m_${mid}`, nowVipCheckTs);
              }
            } else if (kind === "vm") {
              for (const row of rows) {
                if (scoreTelegramFileIdValidity(row.telegram_file_id) === 0) continue;
                const mid = Number(row.movie_id);
                const rowCnt = Math.max(1, Number(row.file_cnt || 1));
                const cur = bestMovieMap.get(mid);
                const candLabel = `${row.quality || "1080p"}${row.codec ? " " + row.codec : ""}`.trim();
                if (!cur || rankQualityLabel(row.quality) > rankQualityLabel(cur.label)) {
                  bestMovieMap.set(mid, { label: candLabel, count: (cur?.count || 0) + rowCnt });
                } else {
                  cur.count += rowCnt;
                }
              }
              for (const mid of uniqVipM) {
                const matched = bestMovieMap.get(mid);
                if (matched) {
                  memoryFallback.set(`d1_vip_summary_m_${mid}`, { label: matched.label, count: matched.count, ts: nowVipCheckTs });
                } else {
                  memoryFallback.set(`d1_vip_summary_m_${mid}`, { none: true, ts: nowVipCheckTs });
                }
              }
            } else if (kind === "ps") {
              const foundPosterS = new Set();
              for (const row of rows) {
                const sid = Number(row.tmdb_id);
                const pVal = row.poster_path || "";
                if (pVal) {
                  posterMap.set(`s_${sid}`, pVal);
                  foundPosterS.add(sid);
                }
              }
              for (const sid of uniqPosterS) {
                if (!foundPosterS.has(sid)) memoryFallback.set(`d1_poster_miss_s_${sid}`, nowVipCheckTs);
              }
            } else if (kind === "vs") {
              for (const row of rows) {
                if (scoreTelegramFileIdValidity(row.telegram_file_id) === 0) continue;
                const sid = Number(row.series_id);
                const rowCnt = Math.max(1, Number(row.file_cnt || 1));
                const cur = bestSeriesMap.get(sid);
                const candLabel = `${row.quality || "1080p"}${row.codec ? " " + row.codec : ""}`.trim();
                if (!cur || rankQualityLabel(row.quality) > rankQualityLabel(cur.label)) {
                  bestSeriesMap.set(sid, { label: candLabel, count: (cur?.count || 0) + rowCnt });
                } else {
                  cur.count += rowCnt;
                }
              }
              for (const sid of uniqVipS) {
                const matched = bestSeriesMap.get(sid);
                if (matched) {
                  memoryFallback.set(`d1_vip_summary_s_${sid}`, { label: matched.label, count: matched.count, ts: nowVipCheckTs });
                } else {
                  memoryFallback.set(`d1_vip_summary_s_${sid}`, { none: true, ts: nowVipCheckTs });
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    // 3. Free-Plan-Schutz: Max. 2 fehlende Poster pro Seite (und nur bei genügend Subrequest-Budget) nachladen!
    const missingPosterItems = (typeof hasSubrequestBudget === "function" && hasSubrequestBudget(28))
      ? items.filter(it => {
          if (!it || !it.id) return false;
          const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : fallbackTypeCode;
          return !it.poster_path && !it.external_poster_url && !posterMap.has(`${tc}_${Number(it.id)}`) && Number(it.id) < 8000000;
        }).slice(0, 2)
      : [];

    if (missingPosterItems.length > 0 && hasTmdbCredentials(env)) {
      await Promise.all(missingPosterItems.map(async (it) => {
        if (typeof hasSubrequestBudget === "function" && !hasSubrequestBudget(32)) return;
        const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : fallbackTypeCode;
        const endpoint = tc === "s" ? "tv" : "movie";
        const tid = Number(it.id);
        try {
          const imgData = await cachedExternalFetchJson(
            `https://api.themoviedb.org/3/${endpoint}/${tid}/images?include_image_language=de,en,null`,
            { headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` } },
            2400
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

  // Lädt direkt aus D1 (und Memory-Fallback) vorhandene VIP-Filme/-Serien für die Hauptseite (Discover),
  // damit bei aktiviertem "Nur VIP-Streams"-Filter oder nach einem JSON-Import alle D1-Einträge sofort sichtbar sind.
    async function getD1VipCatalogCardsForDiscover(env, fallbackTypeCode = "m", limit = 24) {
    const wantSeries = fallbackTypeCode === "s";
    const cacheKey = wantSeries ? "d1_vip_discover_cache_s" : "d1_vip_discover_cache_m";
    const cachedList = memoryFallback.get(cacheKey);
    if (cachedList && Array.isArray(cachedList.items) && cachedList.items.length >= Math.min(limit, 8) && (Date.now() - Number(cachedList.ts || 0)) < 300000) {
      return cachedList.items.slice(0, limit);
    }
    const results = [];
    const seenIds = new Set();

    // 1. Aus Memory-Fallback prüfen (für Sandbox & frisch importierte Einträge)
    try {
      for (const [k, val] of memoryFallback.entries()) {
        if (!val || typeof val !== "object") continue;
        if (!wantSeries && k.startsWith("d1_catalog_movie_")) {
          const mid = Number(val.id || k.replace("d1_catalog_movie_", ""));
          if (!mid || seenIds.has(mid)) continue;
          const mFiles = memoryFallback.get(`d1_movie_files_${mid}`);
          const validFiles = Array.isArray(mFiles)
            ? mFiles.filter(f => f && scoreTelegramFileIdValidity(f.telegram_file_id || f.fileId || f.file_id) > 0)
            : [];
          if (validFiles.length > 0) {
            const top = sortAndDedupeStreamFiles(validFiles)[0];
            seenIds.add(mid);
            results.push({
              id: mid,
              media_type: "movie",
              title: val.title || "Unbekannt",
              release_date: val.releaseDate || val.release_date || "",
              vote_average: Number(val.vote_average || 0),
              poster_path: val.poster_path || val.external_poster_url || null,
              backdrop_path: val.backdrop_path || null,
              overview: val.overview || "",
              vipQuality: `${top?.quality || "1080p"}${top?.codec ? " " + top.codec : ""}`.trim(),
              vipStreamCount: validFiles.length
            });
          }
        } else if (wantSeries && k.startsWith("d1_catalog_series_")) {
          const sid = Number(val.id || k.replace("d1_catalog_series_", ""));
          if (!sid || seenIds.has(sid)) continue;
          const bestQ = memoryFallback.get(`d1_series_best_quality_${sid}`);
          if (bestQ) {
            seenIds.add(sid);
            results.push({
              id: sid,
              media_type: "tv",
              name: val.title || val.name || "Unbekannt",
              title: val.title || val.name || "Unbekannt",
              first_air_date: val.releaseDate || val.first_air_date || "",
              vote_average: Number(val.vote_average || 0),
              poster_path: val.poster_path || val.external_poster_url || null,
              backdrop_path: val.backdrop_path || null,
              overview: val.overview || "",
              vipQuality: String(bestQ),
              vipStreamCount: 1
            });
          }
        }
      }
    } catch (e) {}

    // 2. Aus D1 SQL-Tabellen (movies + movie_files / series + episode_files) komprimiert mit GROUP BY & json_extract abfragen
    const db = await ensureD1Schema(env);
    if (db && results.length < limit) {
      try {
        if (!wantSeries) {
          // Index-gestützte 2-Stufen-Abfrage (nutzt idx_movies_updated_at + idx_movie_files_movie_id):
          // Scannt nur Top-60 statt 100% aller movie_files (schont 5M D1 Rows Read/Tag Limit massiv!)
          const mRes = await db.prepare(`
            WITH top_movies AS (
              SELECT m.tmdb_id, m.title, m.release_date, m.vote_average, m.poster_path, m.backdrop_path, m.overview, m.details_json, m.updated_at
              FROM movies m
              WHERE EXISTS (
                SELECT 1 FROM movie_files mf
                WHERE mf.movie_id = m.tmdb_id
                  AND mf.telegram_file_id IS NOT NULL
                  AND mf.telegram_file_id != ''
                  AND mf.telegram_file_id NOT LIKE 'vip_playlist_%'
                  AND mf.telegram_file_id NOT LIKE 'tmdb_card_%'
              )
              ORDER BY m.updated_at DESC
              LIMIT 60
            )
            SELECT tm.tmdb_id, tm.title, tm.release_date, tm.vote_average, tm.poster_path, tm.backdrop_path, tm.overview,
                   json_extract(tm.details_json, '$.external_poster_url') AS ext_poster,
                   MAX(mf.quality) AS quality, MAX(mf.codec) AS codec,
                   MAX(mf.telegram_file_id) AS telegram_file_id, COUNT(mf.id) AS stream_cnt
            FROM top_movies tm
            INNER JOIN movie_files mf ON mf.movie_id = tm.tmdb_id
            WHERE mf.telegram_file_id IS NOT NULL
              AND mf.telegram_file_id != ''
              AND mf.telegram_file_id NOT LIKE 'vip_playlist_%'
              AND mf.telegram_file_id NOT LIKE 'tmdb_card_%'
            GROUP BY tm.tmdb_id
            ORDER BY tm.updated_at DESC
          `).all();
          for (const row of (mRes?.results || [])) {
            const mid = Number(row.tmdb_id);
            if (!mid || seenIds.has(mid)) continue;
            if (scoreTelegramFileIdValidity(row.telegram_file_id) === 0) continue;
            seenIds.add(mid);
            const pVal = row.poster_path || row.ext_poster || "";
            results.push({
              id: mid,
              media_type: "movie",
              title: row.title || "Unbekannt",
              release_date: row.release_date || "",
              vote_average: Number(row.vote_average || 0),
              poster_path: pVal || null,
              backdrop_path: row.backdrop_path || null,
              overview: row.overview || "",
              vipQuality: `${row.quality || "1080p"}${row.codec ? " " + row.codec : ""}`.trim(),
              vipStreamCount: Math.max(1, Number(row.stream_cnt || 1))
            });
            if (results.length >= limit) break;
          }
        } else {
          // Index-gestützte 2-Stufen-Abfrage (nutzt idx_series_updated_at + idx_episode_files_series_ep):
          // Verhindert 50.000+ Rows-Full-Scan über alle Episoden bei jedem Discover-Aufruf!
          const sRes = await db.prepare(`
            WITH top_series AS (
              SELECT s.tmdb_id, s.title, s.release_date, s.vote_average, s.poster_path, s.backdrop_path, s.overview, s.details_json, s.updated_at
              FROM series s
              WHERE EXISTS (
                SELECT 1 FROM episode_files ef
                WHERE ef.series_id = s.tmdb_id
                  AND ef.telegram_file_id IS NOT NULL
                  AND ef.telegram_file_id != ''
                  AND ef.telegram_file_id NOT LIKE 'vip_playlist_%'
                  AND ef.telegram_file_id NOT LIKE 'tmdb_card_%'
              )
              ORDER BY s.updated_at DESC
              LIMIT 60
            )
            SELECT ts.tmdb_id, ts.title, ts.release_date, ts.vote_average, ts.poster_path, ts.backdrop_path, ts.overview,
                   json_extract(ts.details_json, '$.external_poster_url') AS ext_poster,
                   MAX(ef.quality) AS quality, MAX(ef.codec) AS codec,
                   MAX(ef.telegram_file_id) AS telegram_file_id, COUNT(ef.id) AS stream_cnt
            FROM top_series ts
            INNER JOIN episode_files ef ON ef.series_id = ts.tmdb_id
            WHERE ef.telegram_file_id IS NOT NULL
              AND ef.telegram_file_id != ''
              AND ef.telegram_file_id NOT LIKE 'vip_playlist_%'
              AND ef.telegram_file_id NOT LIKE 'tmdb_card_%'
            GROUP BY ts.tmdb_id
            ORDER BY ts.updated_at DESC
          `).all();
          for (const row of (sRes?.results || [])) {
            const sid = Number(row.tmdb_id);
            if (!sid || seenIds.has(sid)) continue;
            if (scoreTelegramFileIdValidity(row.telegram_file_id) === 0) continue;
            seenIds.add(sid);
            const pVal = row.poster_path || row.ext_poster || "";
            results.push({
              id: sid,
              media_type: "tv",
              name: row.title || "Unbekannt",
              title: row.title || "Unbekannt",
              first_air_date: row.release_date || "",
              vote_average: Number(row.vote_average || 0),
              poster_path: pVal || null,
              backdrop_path: row.backdrop_path || null,
              overview: row.overview || "",
              vipQuality: `${row.quality || "1080p"}${row.codec ? " " + row.codec : ""}`.trim(),
              vipStreamCount: Math.max(1, Number(row.stream_cnt || 1))
            });
            if (results.length >= limit) break;
          }
        }
      } catch (e) {}
    }

    if (results.length > 0) {
      memoryFallback.set(cacheKey, { items: results, ts: Date.now() });
    }
    return results.slice(0, limit);
  }

  // Exklusiver VIP-Stream-Filter (#13):
  // Wenn `onlyVipStreams` in den Einstellungen aktiviert ist UND der Nutzer VIP-Zugriff hat,
  // werden nur Filme/Serien behalten, für die tatsächlich mindestens ein Stream in D1 hinterlegt ist,
  // und bei Bedarf direkt mit den in D1 gespeicherten VIP-Titeln aufgefüllt.
  async function applyVipStreamsOnlyFilterIfActive(env, items, fallbackTypeCode = "m", settingsObj = null, hasVipStreamAccess = false) {
    const withVip = Array.isArray(items) && items.length > 0
      ? await attachVipQualitiesToMediaList(env, items, fallbackTypeCode, hasVipStreamAccess)
      : [];
    if (!hasVipStreamAccess || !settingsObj || !settingsObj.onlyVipStreams) {
      return withVip;
    }
    const filtered = withVip.filter(it => Boolean(it && it.vipQuality));
    if (filtered.length >= 16) return filtered;
    try {
      const d1Extra = await getD1VipCatalogCardsForDiscover(env, fallbackTypeCode, 24);
      const existingIds = new Set(filtered.map(it => Number(it.id)));
      for (const extra of d1Extra) {
        if (!existingIds.has(Number(extra.id))) {
          existingIds.add(Number(extra.id));
          filtered.push(extra);
        }
      }
    } catch (e) {}
    return filtered;
  }

  // Vergibt für manuell ohne TMDb-ID bestätigte Filme & Serien eine garantiert kollisionsfreie synthetische ID im exklusiven 900.000.000-Bereich.
  // Prüft vorab in D1 (movies UND series), ob die ID frei ist oder bereits exakt zu demselben Titel gehört, damit sich zwei unterschiedliche Titel NIEMALS überschreiben!
  async function allocateCollisionFreeManualSyntheticId(env, typeCode = "m", title = "", year = "") {
    const tc = typeCode === "s" ? "s" : "m";
    const normT = normalizeCompareString(title || "unbekannt") || "unbekannt";
    const cleanY = String(year || "").match(/\d{4}/)?.[0] || "";

    // 1. Prüfe im lokalen D1-Katalog-RAM-Cache, ob dieser manuelle Titel bereits existiert (wichtig für Folge-Episoden derselben Serie!)
    try {
      const catMap = await ensureLocalD1CatalogTitleMapLoaded(env);
      if (catMap instanceof Map) {
        const hitExact = cleanY ? catMap.get(`${tc}_${normT}_${cleanY}`) : null;
        const hitAny = catMap.get(`${tc}_${normT}_any`);
        const existingHit = hitExact || hitAny;
        if (existingHit && Number(existingHit.tmdbId) >= 900000000) {
          return Number(existingHit.tmdbId);
        }
      }
    } catch (e) {}

    // 2. Deterministische Start-ID im getrennten 900M-Raum (Filme: 900.000.000..944.999.999, Serien: 945.000.000..989.999.999)
    const baseOffset = tc === "s" ? 945000000 : 900000000;
    let h = 2166136261;
    const seedStr = `manual_${tc}_${normT}_${cleanY}`;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const baseCandidateId = baseOffset + ((h >>> 0) % 44000000);

    // 3. Aktive D1-Kollisionsprüfung über `movies` UND `series`
    const db = await ensureD1Schema(env);
    if (!db) return baseCandidateId;
    try {
      const rawDb = db._rawDb || db;
      const upperCheckId = baseCandidateId + 25;
      const [mRes, sRes] = await rawDb.batch([
        rawDb.prepare("SELECT tmdb_id, title, release_year FROM movies WHERE tmdb_id >= ?1 AND tmdb_id <= ?2").bind(baseCandidateId, upperCheckId),
        rawDb.prepare("SELECT tmdb_id, title, release_year FROM series WHERE tmdb_id >= ?1 AND tmdb_id <= ?2").bind(baseCandidateId, upperCheckId)
      ]);
      const occupiedMovies = new Map();
      for (const r of (mRes?.results || [])) {
        occupiedMovies.set(Number(r.tmdb_id), r);
      }
      const occupiedSeries = new Map();
      for (const r of (sRes?.results || [])) {
        occupiedSeries.set(Number(r.tmdb_id), r);
      }

      for (let offset = 0; offset <= 25; offset++) {
        const candidateId = baseCandidateId + offset;
        const mRow = occupiedMovies.get(candidateId);
        const sRow = occupiedSeries.get(candidateId);
        if (!mRow && !sRow) {
          return candidateId;
        }
        // Falls derselbe Typ und derselbe normalisierte Titel bereits unter dieser ID gespeichert ist -> wiederverwenden!
        if (tc === "m" && mRow && !sRow && normalizeCompareString(mRow.title) === normT) {
          if (!cleanY || !mRow.release_year || String(mRow.release_year) === cleanY) {
            return candidateId;
          }
        }
        if (tc === "s" && sRow && !mRow && normalizeCompareString(sRow.title) === normT) {
          if (!cleanY || !sRow.release_year || String(sRow.release_year) === cleanY) {
            return candidateId;
          }
        }
      }
    } catch (e) {}
    return baseCandidateId;
  }

  async function getMovieFromD1(env, movieId) {
    if (!movieId) return null;
    const mid = Number(movieId);
    const memMovie = memoryFallback.get(`d1_catalog_movie_${mid}`);
    if (memMovie && memMovie.title) {
      return memMovie;
    }
    const db = await ensureD1Schema(env);
    if (!db) return null;
    try {
      trackStat("d1Reads");
      const row = await db
        .prepare("SELECT telegraph_url, details_json, updated_at FROM movies WHERE tmdb_id = ?1")
        .bind(mid)
        .first();
      if (!row || !row.details_json) return null;
      // Externe & manuelle IDs (>= 8000000) niemals per TMDb-TTL verfallen lassen!
      if (mid < 8000000 && (Date.now() - Number(row.updated_at || 0) > D1_MOVIE_TTL_MS)) return null;
      const parsed = JSON.parse(row.details_json);
      if (parsed && parsed.title) {
        if (row.telegraph_url && !parsed.telegraphUrl) {
          parsed.telegraphUrl = row.telegraph_url;
        }
        parsed._persistedInD1 = true;
        memoryFallback.set(`d1_catalog_movie_${mid}`, parsed);
        memoryFallback.set(`d1_movie_in_db_${mid}`, {
          manualOverride: Boolean(parsed.manualOverride || parsed.manual_override),
          title: parsed.title,
          poster_path: parsed.poster_path || null,
          external_poster_url: parsed.external_poster_url || null,
          telegraphUrl: parsed.telegraphUrl || null,
          ts: Date.now()
        });
        memoryFallback.set(`d1_movie_saved_ts_${mid}`, Date.now());
        trackStat("d1Hits");
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  async function saveMovieToD1(env, movieObj, ...extraArgs) {
    if (!movieObj || !movieObj.id) return;
    const extraOpts = extraArgs.find(arg => arg && typeof arg === "object" && !Array.isArray(arg));
    if (extraOpts?.manualOverride) movieObj.manualOverride = true;
    const mid = Number(movieObj.id);
    const prevSavedTs = Number(memoryFallback.get(`d1_movie_saved_ts_${mid}`) || 0);
    const prevMovie = memoryFallback.get(`d1_catalog_movie_${mid}`);
    const knownInD1 = memoryFallback.get(`d1_movie_in_db_${mid}`);
    // MODUL 4.5: Schreibschutz für Admin-Entscheidungen (manual_override = 1)
    if ((prevMovie?.manualOverride || knownInD1?.manualOverride) && !movieObj.manualOverride) {
      return;
    }
    const isManualOverride = Boolean(movieObj.manualOverride || movieObj.manual_override || prevMovie?.manualOverride || knownInD1?.manualOverride);
    if (isManualOverride) movieObj.manualOverride = true;
    // MODUL 2: Vorhandene Zusatz-Downloads (downloads-Array für Archive) beim Speichern erhalten
    const existingDownloads = Array.isArray(movieObj.downloads)
      ? movieObj.downloads
      : (Array.isArray(prevMovie?.downloads) ? prevMovie.downloads : (memoryFallback.get(`d1_movie_downloads_${mid}`) || []));
    if (existingDownloads.length > 0) {
      movieObj.downloads = existingDownloads;
      movieObj.hasDownloads = true;
    }
    memoryFallback.set(`d1_catalog_movie_${mid}`, movieObj);
    const releaseYearForIdx = movieObj.releaseDate && movieObj.releaseDate !== "Keine Angabe"
      ? parseInt(String(movieObj.releaseDate).split("-")[0], 10) || null
      : null;
    registerLocalD1CatalogTitleInRam("m", mid, movieObj.title, releaseYearForIdx);
    // NUR dann den D1-Write überspringen, wenn der Film nachweislich bereits in D1 (_persistedInD1 / d1_movie_in_db_) liegt!
    if (
      !movieObj.manualOverride &&
      knownInD1 &&
      prevSavedTs > 0 &&
      (Date.now() - prevSavedTs) < 1800000 &&
      knownInD1.title === movieObj.title &&
      (knownInD1.poster_path || null) === (movieObj.poster_path || null) &&
      (knownInD1.external_poster_url || null) === (movieObj.external_poster_url || null) &&
      (knownInD1.telegraphUrl || null) === (movieObj.telegraphUrl || null) &&
      Number(knownInD1.downloadsCount || 0) === existingDownloads.length
    ) {
      movieObj._persistedInD1 = true;
      return;
    }
    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      trackStat("d1Writes");
      const releaseYear = movieObj.releaseDate && movieObj.releaseDate !== "Keine Angabe"
        ? parseInt(String(movieObj.releaseDate).split("-")[0], 10) || null
        : null;
      await db
        .prepare(`INSERT INTO movies (
          tmdb_id, title, release_date, release_year, fsk, vote_average, runtime,
          country, genres, directors, casts, overview, is_english_fallback,
          providers, poster_path, backdrop_path, trailer_key,
          collection_id, collection_name, telegraph_url, manual_override, details_json, updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23
        )
        ON CONFLICT(tmdb_id) DO UPDATE SET
          title = excluded.title,
          release_date = excluded.release_date,
          release_year = excluded.release_year,
          fsk = excluded.fsk,
          vote_average = excluded.vote_average,
          runtime = excluded.runtime,
          country = excluded.country,
          genres = excluded.genres,
          directors = excluded.directors,
          casts = excluded.casts,
          overview = excluded.overview,
          is_english_fallback = excluded.is_english_fallback,
          providers = excluded.providers,
          poster_path = COALESCE(excluded.poster_path, movies.poster_path),
          backdrop_path = COALESCE(excluded.backdrop_path, movies.backdrop_path),
          trailer_key = COALESCE(excluded.trailer_key, movies.trailer_key),
          collection_id = COALESCE(excluded.collection_id, movies.collection_id),
          collection_name = COALESCE(excluded.collection_name, movies.collection_name),
          telegraph_url = COALESCE(excluded.telegraph_url, movies.telegraph_url),
          manual_override = CASE WHEN excluded.manual_override = 1 OR COALESCE(movies.manual_override, 0) = 1 THEN 1 ELSE 0 END,
          details_json = excluded.details_json,
          updated_at = excluded.updated_at
        WHERE COALESCE(movies.manual_override, 0) = 0 OR excluded.manual_override = 1`)
        .bind(
          mid,
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
          isManualOverride ? 1 : 0,
          JSON.stringify(movieObj),
          Date.now()
        )
        .run();
      movieObj._persistedInD1 = true;
      memoryFallback.set(`d1_movie_in_db_${mid}`, {
        manualOverride: isManualOverride,
        title: movieObj.title,
        poster_path: movieObj.poster_path || null,
        external_poster_url: movieObj.external_poster_url || null,
        telegraphUrl: movieObj.telegraphUrl || null,
        downloadsCount: Array.isArray(movieObj.downloads) ? movieObj.downloads.length : 0,
        ts: Date.now()
      });
      memoryFallback.set(`d1_movie_saved_ts_${mid}`, Date.now());
      memoryFallback.delete("d1_vip_discover_cache_m");
      memoryFallback.delete("d1_admin_media_list_cache_m");
      memoryFallback.delete("d1_db_stats_cache");
    } catch (e) {}
  }

  async function getSeriesFromD1(env, seriesId) {
    if (!seriesId) return null;
    const sid = Number(seriesId);
    const memSeries = memoryFallback.get(`d1_catalog_series_${sid}`);
    if (memSeries && memSeries.title) {
      return memSeries;
    }
    const db = await ensureD1Schema(env);
    if (!db) return null;
    try {
      trackStat("d1Reads");
      const row = await db
        .prepare("SELECT telegraph_url, details_json, updated_at FROM series WHERE tmdb_id = ?1")
        .bind(sid)
        .first();
      if (!row || !row.details_json) return null;
      // Externe & manuelle Serien-IDs (>= 8000000) niemals per TMDb-TTL verfallen lassen!
      if (sid < 8000000 && (Date.now() - Number(row.updated_at || 0) > D1_MOVIE_TTL_MS)) return null;
      const parsed = JSON.parse(row.details_json);
      if (parsed && parsed.title) {
        if (row.telegraph_url && !parsed.telegraphUrl) {
          parsed.telegraphUrl = row.telegraph_url;
        }
        parsed._persistedInD1 = true;
        memoryFallback.set(`d1_catalog_series_${sid}`, parsed);
        memoryFallback.set(`d1_series_in_db_${sid}`, {
          manualOverride: Boolean(parsed.manualOverride || parsed.manual_override),
          title: parsed.title,
          poster_path: parsed.poster_path || null,
          external_poster_url: parsed.external_poster_url || null,
          telegraphUrl: parsed.telegraphUrl || null,
          ts: Date.now()
        });
        memoryFallback.set(`d1_series_saved_ts_${sid}`, Date.now());
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
    memoryFallback.delete(`d1_all_ep_files_${sid}`);

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

  async function saveSeriesToD1(env, seriesObj, ...extraArgs) {
    if (!seriesObj || !seriesObj.id) return;
    const extraOpts = extraArgs.find(arg => arg && typeof arg === "object" && !Array.isArray(arg));
    if (extraOpts?.manualOverride) seriesObj.manualOverride = true;
    const sid = Number(seriesObj.id);
    const prevSavedTs = Number(memoryFallback.get(`d1_series_saved_ts_${sid}`) || 0);
    const prevSeries = memoryFallback.get(`d1_catalog_series_${sid}`);
    const knownInD1 = memoryFallback.get(`d1_series_in_db_${sid}`);
    // MODUL 4.5: Schreibschutz für Admin-Entscheidungen (manual_override = 1)
    if ((prevSeries?.manualOverride || knownInD1?.manualOverride) && !seriesObj.manualOverride) {
      return;
    }
    const isManualOverride = Boolean(seriesObj.manualOverride || seriesObj.manual_override || prevSeries?.manualOverride || knownInD1?.manualOverride);
    if (isManualOverride) seriesObj.manualOverride = true;
    const existingSeriesDownloads = Array.isArray(seriesObj.downloads)
      ? seriesObj.downloads
      : (Array.isArray(prevSeries?.downloads) ? prevSeries.downloads : (memoryFallback.get(`d1_series_downloads_${sid}`) || []));
    if (existingSeriesDownloads.length > 0) {
      seriesObj.downloads = existingSeriesDownloads;
      seriesObj.hasDownloads = true;
    }
    memoryFallback.set(`d1_catalog_series_${sid}`, seriesObj);
    const releaseYearForIdx = seriesObj.releaseDate && seriesObj.releaseDate !== "Keine Angabe"
      ? parseInt(String(seriesObj.releaseDate).split("-")[0], 10) || null
      : null;
    registerLocalD1CatalogTitleInRam("s", sid, seriesObj.title, releaseYearForIdx);
    // NUR dann den D1-Write überspringen, wenn die Serie nachweislich bereits in D1 (_persistedInD1 / d1_series_in_db_) liegt!
    if (
      !seriesObj.manualOverride &&
      knownInD1 &&
      prevSavedTs > 0 &&
      (Date.now() - prevSavedTs) < 1800000 &&
      knownInD1.title === seriesObj.title &&
      (knownInD1.poster_path || null) === (seriesObj.poster_path || null) &&
      (knownInD1.external_poster_url || null) === (seriesObj.external_poster_url || null) &&
      (knownInD1.telegraphUrl || null) === (seriesObj.telegraphUrl || null) &&
      Number(knownInD1.downloadsCount || 0) === existingSeriesDownloads.length
    ) {
      seriesObj._persistedInD1 = true;
      return;
    }
    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      trackStat("d1Writes");
      const releaseYear = seriesObj.releaseDate && seriesObj.releaseDate !== "Keine Angabe"
        ? parseInt(String(seriesObj.releaseDate).split("-")[0], 10) || null
        : null;
      const stmts = [
        db
          .prepare(`INSERT INTO series (
            tmdb_id, title, release_date, release_year, fsk, status_text, vote_average,
            runtime, country, genres, directors, casts, overview, is_english_fallback,
            providers, poster_path, backdrop_path, trailer_key,
            number_of_seasons, number_of_episodes, telegraph_url, manual_override, details_json, updated_at
          ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24
          )
          ON CONFLICT(tmdb_id) DO UPDATE SET
            title = excluded.title,
            release_date = excluded.release_date,
            release_year = excluded.release_year,
            fsk = excluded.fsk,
            status_text = excluded.status_text,
            vote_average = excluded.vote_average,
            runtime = excluded.runtime,
            country = excluded.country,
            genres = excluded.genres,
            directors = excluded.directors,
            casts = excluded.casts,
            overview = excluded.overview,
            is_english_fallback = excluded.is_english_fallback,
            providers = excluded.providers,
            poster_path = COALESCE(excluded.poster_path, series.poster_path),
            backdrop_path = COALESCE(excluded.backdrop_path, series.backdrop_path),
            trailer_key = COALESCE(excluded.trailer_key, series.trailer_key),
            number_of_seasons = excluded.number_of_seasons,
            number_of_episodes = excluded.number_of_episodes,
            telegraph_url = COALESCE(excluded.telegraph_url, series.telegraph_url),
            manual_override = CASE WHEN excluded.manual_override = 1 OR COALESCE(series.manual_override, 0) = 1 THEN 1 ELSE 0 END,
            details_json = excluded.details_json,
            updated_at = excluded.updated_at
          WHERE COALESCE(series.manual_override, 0) = 0 OR excluded.manual_override = 1`)
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
            isManualOverride ? 1 : 0,
            JSON.stringify(seriesObj),
            Date.now()
          )
      ];

      // Karteileichen-Bereinigung nur ausführen, wenn eine alternative Schnittfassung / Episode-Group aktiv ist (spart N D1-Statements bei Standard-Serien!)
      const needsEpisodeGroupPrune = Boolean(FORCE_EPISODE_GROUP_SERIES.has(sid) || seriesObj.versionInfo?.isAlternativeOrder);
      if (needsEpisodeGroupPrune && Array.isArray(seriesObj.seasons)) {
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
      seriesObj._persistedInD1 = true;
      memoryFallback.set(`d1_series_in_db_${sid}`, {
        manualOverride: isManualOverride,
        title: seriesObj.title,
        poster_path: seriesObj.poster_path || null,
        external_poster_url: seriesObj.external_poster_url || null,
        telegraphUrl: seriesObj.telegraphUrl || null,
        downloadsCount: existingSeriesDownloads.length,
        ts: Date.now()
      });
      memoryFallback.set(`d1_series_saved_ts_${sid}`, Date.now());
      memoryFallback.delete("d1_vip_discover_cache_s");
      memoryFallback.delete("d1_admin_media_list_cache_s");
      memoryFallback.delete("d1_db_stats_cache");
    } catch (e) {}
  }

  async function getSeasonFromD1(env, seriesId, seasonNumber) {
    if (!seriesId) return null;
    const sid = Number(seriesId);
    const sNum = Number(seasonNumber);
    const memSeason = getCachedTmdb(`tv_season_${sid}_${sNum}`);
    if (memSeason && Array.isArray(memSeason.episodes)) {
      return memSeason;
    }
    const db = await ensureD1Schema(env);
    if (!db) return null;
    try {
      trackStat("d1Reads");
      const row = await db
        .prepare("SELECT telegraph_url, episodes_json, updated_at FROM series_seasons WHERE series_id = ?1 AND season_number = ?2")
        .bind(sid, sNum)
        .first();
      if (!row || !row.episodes_json) return null;
      if (Date.now() - Number(row.updated_at || 0) > D1_MOVIE_TTL_MS) return null;
      const parsed = JSON.parse(row.episodes_json);
      if (parsed && Array.isArray(parsed.episodes)) {
        if (row.telegraph_url && !parsed.telegraphUrl) {
          parsed.telegraphUrl = row.telegraph_url;
        }
        setCachedTmdb(`tv_season_${sid}_${sNum}`, parsed);
        trackStat("d1Hits");
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  async function saveSeasonToD1(env, seriesId, seasonNumber, seasonObj) {
    if (!seriesId || !seasonObj) return;
    const sid = Number(seriesId);
    const sNum = Number(seasonNumber);
    const prevSavedTs = Number(memoryFallback.get(`d1_season_saved_ts_${sid}_${sNum}`) || 0);
    if (prevSavedTs > 0 && (Date.now() - prevSavedTs) < 600000 && !seasonObj.telegraphUrl) {
      return;
    }
    const db = await ensureD1Schema(env);
    if (!db) return;
    memoryFallback.set(`d1_season_saved_ts_${sid}_${sNum}`, Date.now());
    try {
      trackStat("d1Writes");
      const rawMaxEpCount = Number(seasonObj.seasonEpisodeCount || (Array.isArray(seasonObj.episodes) ? seasonObj.episodes.length : 0));
      let highestUploadedEp = 0;
      try {
        const uploadedFiles = await getEpisodeFilesFromD1(env, seriesId, seasonNumber);
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
    if (!cacheKey) return null;
    const memKey = `d1_search_cache_${cacheKey}`;
    const memEntry = memoryFallback.get(memKey);
    if (memEntry && memEntry.data && (Date.now() - Number(memEntry.ts || 0) <= D1_SEARCH_TTL_MS)) {
      return memEntry.data;
    }
    const db = await ensureD1Schema(env);
    if (!db) return null;
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
        memoryFallback.set(memKey, { data: parsed, ts: Number(row.updated_at || Date.now()) });
        trackStat("d1Hits");
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  async function saveSearchCacheToD1(env, cacheKey, query, page, dataObj) {
    if (!cacheKey || !dataObj) return;
    const now = Date.now();
    memoryFallback.set(`d1_search_cache_${cacheKey}`, { data: dataObj, ts: now });
    const db = await ensureD1Schema(env);
    if (!db) return;
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
          now
        )
        .run();
    } catch (e) {}
  }

  async function getEntityFromD1(env, cacheKey, ttlMs = D1_SEARCH_TTL_MS, options = {}) {
    if (!cacheKey) return null;
    const memKey = `d1_entity_${cacheKey}`;
    const isBrowserSandbox = typeof localStorage !== "undefined" && typeof window !== "undefined";
    const bypassMemoryCache = Boolean(options?.bypassMemoryCache);
    if (!bypassMemoryCache) {
      const memEntry = memoryFallback.get(memKey);
      if (memEntry) {
        const ageMs = Date.now() - Number(memEntry.ramTs || memEntry.ts || 0);
        // Negative Cache-Einträge (notInD1) im Live-Worker max. 10s im RAM halten (verhindert 365-Tage-Stale-Misses!)
        if (memEntry.notInD1) {
          if (isBrowserSandbox || ageMs <= 10000) return null;
        } else if (memEntry.data !== undefined) {
          const effectiveRamTtl = Number.isFinite(Number(options?.ramTtlMs))
            ? Math.max(0, Number(options.ramTtlMs))
            : ttlMs;
          const dbAgeMs = Date.now() - Number(memEntry.ts || 0);
          if (dbAgeMs <= ttlMs && (isBrowserSandbox || ageMs <= effectiveRamTtl)) {
            return memEntry.data;
          }
        }
      }
    }
    const db = await ensureD1Schema(env);
    if (!db) return null;
    try {
      trackStat("d1Reads");
      const row = await db
        .prepare("SELECT data_json, updated_at FROM entity_cache WHERE cache_key = ?1")
        .bind(String(cacheKey))
        .first();
      const now = Date.now();
      if (!row || !row.data_json) {
        memoryFallback.set(memKey, { notInD1: true, ts: now, ramTs: now });
        return null;
      }
      if (now - Number(row.updated_at || 0) > ttlMs) return null;
      const parsed = JSON.parse(row.data_json);
      if (parsed !== undefined && parsed !== null) {
        memoryFallback.set(memKey, { data: parsed, ts: Number(row.updated_at || now), ramTs: now });
        trackStat("d1Hits");
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  async function saveEntityToD1(env, cacheKey, entityType, dataObj) {
    if (!cacheKey || dataObj === undefined || dataObj === null) return;
    const now = Date.now();
    memoryFallback.set(`d1_entity_${cacheKey}`, { data: dataObj, ts: now, ramTs: now });
    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      trackStat("d1Writes");
      await db
        .prepare(`INSERT OR REPLACE INTO entity_cache (
          cache_key, entity_type, data_json, updated_at
        ) VALUES (?1, ?2, ?3, ?4)`)
        .bind(String(cacheKey), String(entityType || "misc"), JSON.stringify(dataObj), now)
        .run();
    } catch (e) {}
  }

  async function deleteEntityFromD1(env, cacheKey) {
    if (!cacheKey) return;
    memoryFallback.delete(`d1_entity_${cacheKey}`);
    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      trackStat("d1Writes");
      await db
        .prepare("DELETE FROM entity_cache WHERE cache_key = ?1")
        .bind(String(cacheKey))
        .run();
    } catch (e) {}
  }

  // ============================================================================
  // D1-FIRST VORAB-CHECK & UNIVERSELLER TITEL-CACHE (POSITIV & NEGATIV FÜR ALLE 8 APIS)
  // Verhindert, dass identische Titel (egal ob Film, Serie, Fallback >= 8000000 oder Nicht erkannt)
  // beim Massen-Import mehrfach über TMDb, OMDb, iTunes, TVMaze, Wikidata, AniList, Jikan & Wikipedia gesucht werden!
  // ============================================================================

  function registerLocalD1CatalogTitleInRam(typeCode, tmdbId, title, releaseYear = null) {
    if (!title || !tmdbId) return;
    const normT = normalizeCompareString(title);
    if (!normT || normT === "unbekannt") return;
    let map = memoryFallback.get("d1_local_catalog_title_map");
    if (!(map instanceof Map)) {
      map = new Map();
      memoryFallback.set("d1_local_catalog_title_map", map);
    }
    const tc = typeCode === "s" ? "s" : "m";
    const entry = { typeCode: tc, tmdbId: Number(tmdbId), title: String(title), year: releaseYear ? Number(releaseYear) : null };
    if (releaseYear) {
      map.set(`${tc}_${normT}_${releaseYear}`, entry);
    }
    if (!map.has(`${tc}_${normT}_any`) || Number(tmdbId) < 8000000) {
      map.set(`${tc}_${normT}_any`, entry);
    }
  }

  async function ensureLocalD1CatalogTitleMapLoaded(env) {
    const lastLoadedTs = Number(memoryFallback.get("d1_local_catalog_title_map_ts") || 0);
    let map = memoryFallback.get("d1_local_catalog_title_map");
    if (map instanceof Map && map.size > 0 && (Date.now() - lastLoadedTs) < 1800000) {
      return map;
    }
    if (!(map instanceof Map)) {
      map = new Map();
      memoryFallback.set("d1_local_catalog_title_map", map);
    }
    const db = await ensureD1Schema(env);
    const rawDb = getRawD1Binding(env);
    if (db && rawDb) {
      try {
        trackStat("d1Reads");
        countD1Subrequest();
        const [mRows, sRows] = await rawDb.batch([
          rawDb.prepare("SELECT tmdb_id, title, release_year, poster_path, telegraph_url, manual_override FROM movies ORDER BY updated_at DESC LIMIT 600"),
          rawDb.prepare("SELECT tmdb_id, title, release_year, poster_path, telegraph_url, manual_override FROM series ORDER BY updated_at DESC LIMIT 600")
        ]);
        const cpuStart = Date.now();
        const nowLoadedTs = Date.now();
        for (const r of (mRows?.results || [])) {
          registerLocalD1CatalogTitleInRam("m", r.tmdb_id, r.title, r.release_year);
          memoryFallback.set(`d1_movie_in_db_${r.tmdb_id}`, {
            manualOverride: Number(r.manual_override || 0) === 1,
            title: r.title,
            poster_path: r.poster_path || null,
            external_poster_url: null,
            telegraphUrl: r.telegraph_url || null,
            ts: nowLoadedTs
          });
        }
        for (const r of (sRows?.results || [])) {
          registerLocalD1CatalogTitleInRam("s", r.tmdb_id, r.title, r.release_year);
          memoryFallback.set(`d1_series_in_db_${r.tmdb_id}`, {
            manualOverride: Number(r.manual_override || 0) === 1,
            title: r.title,
            poster_path: r.poster_path || null,
            external_poster_url: null,
            telegraphUrl: r.telegraph_url || null,
            ts: nowLoadedTs
          });
        }
        if (typeof recordWorkerSyncCpuSpan === "function") {
          recordWorkerSyncCpuSpan(Date.now() - cpuStart);
        }
      } catch (e) {}
    }
    memoryFallback.set("d1_local_catalog_title_map_ts", Date.now());
    return map;
  }

  function buildTitleResolutionCacheKeys(rawTitle, year = null, typeCode = "m") {
    const normT = normalizeCompareString(rawTitle || "");
    if (!normT || normT === "unbekannt") return null;
    const tc = typeCode === "s" ? "s" : "m";
    const yrKey = year ? String(year) : "any";
    const exactKey = `title_res_${tc}_${normT}_${yrKey}`;
    const anyYearKey = `title_res_${tc}_${normT}_any`;
    const legacySeriesKey = tc === "s" ? `series_res_${normT}_${yrKey}` : null;
    const legacySeriesAnyKey = tc === "s" ? `series_res_${normT}_any` : null;
    return { normT, tc, yrKey, exactKey, anyYearKey, legacySeriesKey, legacySeriesAnyKey };
  }

  // Bündelt alle D1-Lesezugriffe (file_ids + entity_cache Keys + movie_files/episode_files bekannter IDs) eines Import-Batches in 1 einzigen db.batch()-Subrequest!
  async function prefetchBatchMediaFromD1(env, entriesList) {
    if (!Array.isArray(entriesList) || entriesList.length === 0) return;
    await ensureD1Schema(env);
    const localMap = await ensureLocalD1CatalogTitleMapLoaded(env);
    const rawDb = getRawD1Binding(env);
    if (!rawDb) return;

    const fidsToCheck = new Set();
    const entityKeysToCheck = new Set();
    const movieIdsToPrefetchFiles = new Set();
    const seriesIdsToPrefetchFiles = new Set();

    for (const item of entriesList) {
      if (!item) continue;
      const fid = typeof item === "object" ? String(item.telegram_file_id || item.file_id || item.fileId || "").trim() : "";
      if (fid && scoreTelegramFileIdValidity(fid) > 0) {
        if (!memoryFallback.has(`d1_fid_lookup_${fid}`) && !memoryFallback.has(`d1_fid_miss_${fid}`)) {
          fidsToCheck.add(fid);
        }
      }
      const rawTitle = typeof item === "string"
        ? item
        : String(item.cleanTitle || item.title || item.filename || item.file_name || item.rawInput || "").trim();
      const isSer = typeof item === "object" && Boolean(item.isSeries || item.type === "series" || item.typeCode === "s" || item.season || item.episode);
      const yr = typeof item === "object" && item.year ? Number(item.year) : null;
      let knownTmdbId = typeof item === "object" ? Number(item.tmdb_id || item.tmdbId || 0) : 0;
      let effTc = isSer ? "s" : "m";
      if (rawTitle) {
        const parsedGuess = parseMediaFilename(rawTitle, item?.raw_text || item?.rawText || "");
        const effTitle = (typeof item === "object" && item.cleanTitle && item.cleanTitle !== "Unbekannt") ? item.cleanTitle : parsedGuess.cleanTitle;
        effTc = (isSer || parsedGuess.isSeries) ? "s" : "m";
        const effYr = yr || parsedGuess.year || null;
        if (!knownTmdbId && localMap instanceof Map) {
          const normT = normalizeCompareString(effTitle || "");
          const localHit = (effYr ? localMap.get(`${effTc}_${normT}_${effYr}`) : null) || localMap.get(`${effTc}_${normT}_any`);
          if (localHit && localHit.tmdbId) {
            knownTmdbId = Number(localHit.tmdbId);
          }
        }
        const keys = buildTitleResolutionCacheKeys(effTitle, effYr, effTc);
        if (keys) {
          for (const k of [keys.exactKey, keys.anyYearKey, keys.legacySeriesKey, keys.legacySeriesAnyKey]) {
            if (k && !memoryFallback.has(k) && !memoryFallback.has(`d1_entity_${k}`)) {
              entityKeysToCheck.add(k);
            }
          }
        }
      }
      if (knownTmdbId > 0) {
        if (effTc === "s") {
          const sNum = Number(item?.season ?? 1) || 1;
          if (!memoryFallback.has(`d1_ep_files_season_ts_${knownTmdbId}_${sNum}`)) {
            seriesIdsToPrefetchFiles.add(knownTmdbId);
          }
        } else {
          if (!memoryFallback.has(`d1_movie_files_ts_${knownTmdbId}`)) {
            movieIdsToPrefetchFiles.add(knownTmdbId);
          }
        }
      }
    }

    const fidArr = Array.from(fidsToCheck).slice(0, 18);
    const entArr = Array.from(entityKeysToCheck).slice(0, 24);
    const movFileIdArr = Array.from(movieIdsToPrefetchFiles).slice(0, 12);
    const serFileIdArr = Array.from(seriesIdsToPrefetchFiles).slice(0, 8);
    if (fidArr.length === 0 && entArr.length === 0 && movFileIdArr.length === 0 && serFileIdArr.length === 0) return;

    const batchStmts = [];
    let movFidStmtIdx = -1;
    let epFidStmtIdx = -1;
    let entStmtIdx = -1;
    let movFilesPreloadIdx = -1;
    let serFilesPreloadIdx = -1;

    if (fidArr.length > 0) {
      const placeholders = fidArr.map((_, i) => `?${i + 1}`).join(",");
      movFidStmtIdx = batchStmts.length;
      batchStmts.push(rawDb.prepare(`SELECT telegram_file_id, movie_id FROM movie_files WHERE telegram_file_id IN (${placeholders})`).bind(...fidArr));
      epFidStmtIdx = batchStmts.length;
      batchStmts.push(rawDb.prepare(`SELECT telegram_file_id, series_id, season_number, episode_number FROM episode_files WHERE telegram_file_id IN (${placeholders})`).bind(...fidArr));
    }

    if (entArr.length > 0) {
      const placeholders = entArr.map((_, i) => `?${i + 1}`).join(",");
      entStmtIdx = batchStmts.length;
      batchStmts.push(rawDb.prepare(`SELECT cache_key, data_json, updated_at FROM entity_cache WHERE cache_key IN (${placeholders})`).bind(...entArr));
    }

    if (movFileIdArr.length > 0) {
      const placeholders = movFileIdArr.map((_, i) => `?${i + 1}`).join(",");
      movFilesPreloadIdx = batchStmts.length;
      batchStmts.push(rawDb.prepare(`SELECT id, movie_id, telegram_file_id, file_fingerprint, quality, codec, part, part_number, edition_label, is_bonus, is_download_only, tags, file_size, raw_filename FROM movie_files WHERE movie_id IN (${placeholders})`).bind(...movFileIdArr));
    }

    if (serFileIdArr.length > 0) {
      const placeholders = serFileIdArr.map((_, i) => `?${i + 1}`).join(",");
      serFilesPreloadIdx = batchStmts.length;
      batchStmts.push(rawDb.prepare(`SELECT id, series_id, season_number, episode_number, telegram_file_id, file_fingerprint, quality, codec, part, part_number, edition_label, is_bonus, is_download_only, tags, version_label, file_size, raw_filename FROM episode_files WHERE series_id IN (${placeholders})`).bind(...serFileIdArr));
    }

    if (batchStmts.length === 0) return;
    try {
      trackStat("d1Reads");
      countD1Subrequest();
      const batchRes = await rawDb.batch(batchStmts);
      const foundFids = new Set();
      if (movFidStmtIdx >= 0 && Array.isArray(batchRes[movFidStmtIdx]?.results)) {
        for (const r of batchRes[movFidStmtIdx].results) {
          if (r && r.telegram_file_id && r.movie_id) {
            const f = String(r.telegram_file_id);
            foundFids.add(f);
            memoryFallback.set(`d1_fid_lookup_${f}`, {
              matchedBy: "file_id",
              typeCode: "m",
              tmdbId: Number(r.movie_id),
              confidence: 100,
              source: "D1 (Datei-ID)"
            });
          }
        }
      }
      if (epFidStmtIdx >= 0 && Array.isArray(batchRes[epFidStmtIdx]?.results)) {
        for (const r of batchRes[epFidStmtIdx].results) {
          if (r && r.telegram_file_id && r.series_id) {
            const f = String(r.telegram_file_id);
            foundFids.add(f);
            memoryFallback.set(`d1_fid_lookup_${f}`, {
              matchedBy: "file_id",
              typeCode: "s",
              tmdbId: Number(r.series_id),
              season: r.season_number != null ? Number(r.season_number) : 1,
              episode: Number(r.episode_number || 1),
              confidence: 100,
              source: "D1 (Datei-ID)"
            });
          }
        }
      }
      for (const f of fidArr) {
        if (!foundFids.has(f)) {
          memoryFallback.set(`d1_fid_miss_${f}`, true);
        }
      }

      const foundEntKeys = new Set();
      if (entStmtIdx >= 0 && Array.isArray(batchRes[entStmtIdx]?.results)) {
        for (const r of batchRes[entStmtIdx].results) {
          if (r && r.cache_key && r.data_json) {
            try {
              const parsed = JSON.parse(r.data_json);
              if (parsed) {
                foundEntKeys.add(String(r.cache_key));
                memoryFallback.set(String(r.cache_key), parsed);
                memoryFallback.set(`d1_entity_${r.cache_key}`, { data: parsed, ts: Number(r.updated_at || Date.now()) });
              }
            } catch (e) {}
          }
        }
      }
      const nowTs = Date.now();
      for (const k of entArr) {
        if (!foundEntKeys.has(k)) {
          memoryFallback.set(`d1_entity_${k}`, { notInD1: true, ts: nowTs });
        }
      }

      if (movFilesPreloadIdx >= 0) {
        const groupedMovieFiles = new Map();
        for (const mid of movFileIdArr) groupedMovieFiles.set(mid, []);
        for (const r of (batchRes[movFilesPreloadIdx]?.results || [])) {
          const mid = Number(r?.movie_id || 0);
          if (mid && groupedMovieFiles.has(mid)) {
            groupedMovieFiles.get(mid).push({ ...r, _fromD1: true });
          }
        }
        for (const [mid, rows] of groupedMovieFiles.entries()) {
          memoryFallback.set(`d1_movie_files_${mid}`, rows);
          memoryFallback.set(`d1_movie_files_ts_${mid}`, nowTs);
        }
      }

      if (serFilesPreloadIdx >= 0) {
        const groupedEpFiles = new Map();
        for (const r of (batchRes[serFilesPreloadIdx]?.results || [])) {
          const sid = Number(r?.series_id || 0);
          const sNum = Number(r?.season_number ?? 1);
          if (!sid) continue;
          const k = `${sid}_${sNum}`;
          if (!groupedEpFiles.has(k)) groupedEpFiles.set(k, []);
          groupedEpFiles.get(k).push({ ...r, _fromD1: true });
        }
        for (const [k, rows] of groupedEpFiles.entries()) {
          memoryFallback.set(`d1_ep_files_${k}`, rows);
          memoryFallback.set(`d1_ep_files_season_ts_${k}`, nowTs);
        }
        for (const sid of serFileIdArr) {
          if (!groupedEpFiles.has(`${sid}_1`) && !memoryFallback.has(`d1_ep_files_season_ts_${sid}_1`)) {
            memoryFallback.set(`d1_ep_files_${sid}_1`, []);
            memoryFallback.set(`d1_ep_files_season_ts_${sid}_1`, nowTs);
          }
        }
      }
    } catch (e) {}
  }

  async function findExistingMediaInD1BeforeExternalSearch(env, parsed, telegramFileId = null) {
    const rawSearchTitle = String(parsed?.cleanTitle || parsed?.title || "").trim();
    const tc = parsed?.isSeries ? "s" : "m";
    const yr = parsed?.year ? Number(parsed.year) : null;

    // 1. Prüfe zuerst, ob exakt diese telegram_file_id bereits in D1 (movie_files / episode_files) liegt -> 0 externe API-Requests!
    const cleanFid = String(telegramFileId || "").trim();
    if (cleanFid && scoreTelegramFileIdValidity(cleanFid) > 0) {
      const fidRamHit = memoryFallback.get(`d1_fid_lookup_${cleanFid}`);
      if (fidRamHit && fidRamHit.tmdbId) {
        return fidRamHit;
      }
      if (!memoryFallback.has(`d1_fid_miss_${cleanFid}`)) {
        const db = await ensureD1Schema(env);
        if (db) {
          try {
            trackStat("d1Reads");
            if (tc === "s") {
              const epRow = await db.prepare("SELECT series_id, season_number, episode_number FROM episode_files WHERE telegram_file_id = ?1 LIMIT 1").bind(cleanFid).first();
              if (epRow && epRow.series_id) {
                const hit = {
                  matchedBy: "file_id",
                  typeCode: "s",
                  tmdbId: Number(epRow.series_id),
                  season: Number(epRow.season_number || parsed?.season || 1),
                  episode: Number(epRow.episode_number || parsed?.episode || 1),
                  confidence: 100,
                  source: "D1 (Datei-ID)"
                };
                memoryFallback.set(`d1_fid_lookup_${cleanFid}`, hit);
                return hit;
              }
            } else {
              const movRow = await db.prepare("SELECT movie_id FROM movie_files WHERE telegram_file_id = ?1 LIMIT 1").bind(cleanFid).first();
              if (movRow && movRow.movie_id) {
                const hit = {
                  matchedBy: "file_id",
                  typeCode: "m",
                  tmdbId: Number(movRow.movie_id),
                  confidence: 100,
                  source: "D1 (Datei-ID)"
                };
                memoryFallback.set(`d1_fid_lookup_${cleanFid}`, hit);
                return hit;
              }
            }
            memoryFallback.set(`d1_fid_miss_${cleanFid}`, true);
          } catch (e) {}
        }
      }
    }

    const keys = buildTitleResolutionCacheKeys(rawSearchTitle, yr, tc);
    if (!keys) return null;

    // 2. Prüfe zuerst den lokalen D1-Katalog (movies / series Tabellen) per In-Memory-Titel-Index (0 externe API-Requests bei bereits vorhandenen Filmen/Serien, überstimmt auch alte Negativ-Cache-Einträge!)
    const catalogMap = await ensureLocalD1CatalogTitleMapLoaded(env);
    if (catalogMap instanceof Map && catalogMap.size > 0) {
      const catExact = yr ? catalogMap.get(`${tc}_${keys.normT}_${yr}`) : null;
      const catAny = catalogMap.get(`${tc}_${keys.normT}_any`);
      const catCandidate = catExact || catAny;
      if (catCandidate && catCandidate.tmdbId) {
        // MODUL 4.4: Jahres-Sperre beim Movie-UPSERT (±1 Jahr für Filme statt ±2 Jahre, damit Remakes wie "The Gentlemen (2019)" vs. 1995 niemals blind zusammengeführt werden)
        const yearAcceptable = !yr || !catCandidate.year || Math.abs(yr - Number(catCandidate.year)) <= 1 || tc === "s";
        if (yearAcceptable) {
          return {
            matchedBy: "d1_catalog",
            typeCode: catCandidate.typeCode || tc,
            tmdbId: Number(catCandidate.tmdbId),
            confidence: catExact ? 98 : 92,
            source: "D1-Katalog"
          };
        }
      }
    }

    // 3. Prüfe RAM + D1 entity_cache auf bereits aufgelöste Titel (inkl. TMDb, alle 7 Fallback-APIs >= 8000000 UND Negativ-Cache für unauffindbare Titel!)
    const ramHit =
      memoryFallback.get(keys.exactKey) ||
      (keys.legacySeriesKey ? memoryFallback.get(keys.legacySeriesKey) : null) ||
      (tc === "s" ? (memoryFallback.get(keys.anyYearKey) || memoryFallback.get(keys.legacySeriesAnyKey)) : null) ||
      (!yr ? memoryFallback.get(keys.anyYearKey) : null);

    if (ramHit) {
      if (ramHit.notFound) {
        return {
          matchedBy: "negative_cache",
          notFound: true,
          reviewReasonCode: ramHit.reviewReasonCode || "TMDB_NOT_FOUND",
          candidates: ramHit.candidates || []
        };
      }
      if (ramHit.tmdbId) {
        return {
          matchedBy: "title_cache",
          typeCode: ramHit.typeCode || tc,
          tmdbId: Number(ramHit.tmdbId),
          confidence: Number(ramHit.confidence || 92),
          source: ramHit.source || "TMDb (RAM-Cache)",
          details: ramHit.details || null,
          candidates: ramHit.candidates || []
        };
      }
    }

    // D1 entity_cache prüfen (falls nicht bereits durch prefetchBatchMediaFromD1 als Miss markiert)
    const d1Exact = await getEntityFromD1(env, keys.exactKey, D1_MOVIE_TTL_MS);
    const d1SeriesFallback = (!d1Exact && tc === "s")
      ? (await getEntityFromD1(env, keys.anyYearKey, D1_MOVIE_TTL_MS) || (keys.legacySeriesKey ? await getEntityFromD1(env, keys.legacySeriesKey, D1_MOVIE_TTL_MS) : null))
      : null;
    const d1Hit = d1Exact || d1SeriesFallback;
    if (d1Hit) {
      memoryFallback.set(keys.exactKey, d1Hit);
      if (d1Hit.notFound) {
        return {
          matchedBy: "negative_cache",
          notFound: true,
          reviewReasonCode: d1Hit.reviewReasonCode || "TMDB_NOT_FOUND",
          candidates: d1Hit.candidates || []
        };
      }
      if (d1Hit.tmdbId) {
        return {
          matchedBy: "title_cache",
          typeCode: d1Hit.typeCode || tc,
          tmdbId: Number(d1Hit.tmdbId),
          confidence: Number(d1Hit.confidence || 92),
          source: d1Hit.source || "TMDb (D1-Cache)",
          details: d1Hit.details || null,
          candidates: d1Hit.candidates || []
        };
      }
    }

    return null;
  }

  async function saveTitleResolutionCacheToD1(env, parsed, resolvedTypeCode, payload) {
    if (!parsed || !payload) return;
    const rawSearchTitle = String(parsed?.cleanTitle || parsed?.title || "").trim();
    const tc = resolvedTypeCode || (parsed?.isSeries ? "s" : "m");
    const yr = parsed?.year ? Number(parsed.year) : null;
    const keys = buildTitleResolutionCacheKeys(rawSearchTitle, yr, tc);
    if (!keys) return;

    const prevExisting = memoryFallback.get(keys.exactKey);
    const alreadySavedToD1Key = `d1_title_res_saved_${keys.exactKey}`;
    const alreadySavedTs = Number(memoryFallback.get(alreadySavedToD1Key) || 0);

    const record = {
      ...payload,
      typeCode: tc,
      updatedAt: Date.now()
    };

    memoryFallback.set(keys.exactKey, record);
    if (!yr || tc === "s") {
      memoryFallback.set(keys.anyYearKey, record);
    }
    if (keys.legacySeriesKey && record.tmdbId) {
      memoryFallback.set(keys.legacySeriesKey, record);
      memoryFallback.set(keys.legacySeriesAnyKey, record);
    }
    if (record.title && record.tmdbId) {
      const canonKeys = buildTitleResolutionCacheKeys(record.title, yr, tc);
      if (canonKeys) {
        memoryFallback.set(canonKeys.exactKey, record);
        if (!yr || tc === "s") memoryFallback.set(canonKeys.anyYearKey, record);
      }
    }

    // Wenn exakt derselbe Titel in den letzten 10 Minuten bereits in D1 entity_cache gespeichert wurde, spare redundante D1-Statements!
    if (alreadySavedTs > 0 && (Date.now() - alreadySavedTs) < 600000 && prevExisting && prevExisting.tmdbId === record.tmdbId && Boolean(prevExisting.notFound) === Boolean(record.notFound)) {
      return;
    }
    memoryFallback.set(alreadySavedToD1Key, Date.now());

    await saveEntityToD1(env, keys.exactKey, record.notFound ? "title_neg" : "title_res", record);
    if (tc === "s" && keys.anyYearKey !== keys.exactKey && !record.notFound) {
      await saveEntityToD1(env, keys.anyYearKey, "title_res", record);
    }
  }

  async function invalidateOrUpdateTitleResolutionCacheInD1(env, rawTitle, year, typeCode, newPayload = null) {
    const keys = buildTitleResolutionCacheKeys(rawTitle, year, typeCode);
    if (!keys) return;
    memoryFallback.delete(`d1_title_res_saved_${keys.exactKey}`);
    if (newPayload && newPayload.tmdbId) {
      await saveTitleResolutionCacheToD1(env, { cleanTitle: rawTitle, year, isSeries: typeCode === "s" }, typeCode, newPayload);
      return;
    }
    memoryFallback.delete(keys.exactKey);
    memoryFallback.delete(keys.anyYearKey);
    memoryFallback.delete(`d1_entity_${keys.exactKey}`);
    memoryFallback.delete(`d1_entity_${keys.anyYearKey}`);
    if (keys.legacySeriesKey) {
      memoryFallback.delete(keys.legacySeriesKey);
      memoryFallback.delete(keys.legacySeriesAnyKey);
    }
  }

  async function getD1DatabaseStats(env) {
    const db = await ensureD1Schema(env);
    if (!db) {
      let memMovies = 0;
      let memSeries = 0;
      for (const k of memoryFallback.keys()) {
        if (k.startsWith("d1_catalog_movie_")) memMovies++;
        else if (k.startsWith("d1_catalog_series_")) memSeries++;
      }
      return { enabled: false, moviesCount: memMovies, seriesCount: memSeries, searchesCount: 0 };
    }
    const cachedStats = memoryFallback.get("d1_db_stats_cache");
    if (cachedStats && (Date.now() - Number(cachedStats.ts || 0)) < 120000) {
      return cachedStats.data;
    }
    try {
      const rawDb = getRawD1Binding(env);
      let mCnt = 0;
      let sCnt = 0;
      let qCnt = 0;
      if (rawDb && typeof rawDb.batch === "function") {
        trackStat("d1Reads");
        countD1Subrequest();
        const [mRes, sRes, qRes] = await rawDb.batch([
          rawDb.prepare("SELECT COUNT(*) AS cnt FROM movies"),
          rawDb.prepare("SELECT COUNT(*) AS cnt FROM series"),
          rawDb.prepare("SELECT COUNT(*) AS cnt FROM search_cache")
        ]);
        mCnt = Number(mRes?.results?.[0]?.cnt || 0);
        sCnt = Number(sRes?.results?.[0]?.cnt || 0);
        qCnt = Number(qRes?.results?.[0]?.cnt || 0);
      } else {
        const [mRow, sRow, qRow] = await Promise.all([
          db.prepare("SELECT COUNT(*) AS cnt FROM movies").first(),
          db.prepare("SELECT COUNT(*) AS cnt FROM series").first(),
          db.prepare("SELECT COUNT(*) AS cnt FROM search_cache").first()
        ]);
        mCnt = Number(mRow?.cnt || 0);
        sCnt = Number(sRow?.cnt || 0);
        qCnt = Number(qRow?.cnt || 0);
      }
      const data = {
        enabled: true,
        moviesCount: mCnt,
        seriesCount: sCnt,
        searchesCount: qCnt
      };
      memoryFallback.set("d1_db_stats_cache", { data, ts: Date.now() });
      return data;
    } catch (e) {
      return { enabled: true, moviesCount: 0, seriesCount: 0, searchesCount: 0 };
    }
  }

  // ============================================================================
  // D1-FIRST PLAYLISTS & IMPORT CHECKPOINTS (0 KV-Writes beim 180k JSON-Import!)
  // ============================================================================

  async function saveImportCheckpointToD1(env, checkpointObj, jobKey = "default") {
    if (!checkpointObj || typeof checkpointObj !== "object") return null;
    const cleanKey = String(jobKey || "default").trim() || "default";
    const normalized = {
      jobKey: cleanKey,
      fileName: String(checkpointObj.fileName || ""),
      cursor: Math.max(0, Number(checkpointObj.cursor || 0)),
      total: Math.max(0, Number(checkpointObj.total || 0)),
      savedMovies: Math.max(0, Number(checkpointObj.savedMovies || 0)),
      savedEpisodes: Math.max(0, Number(checkpointObj.savedEpisodes || 0)),
      skipped: Math.max(0, Number(checkpointObj.skipped || 0)),
      conflicts: Math.max(0, Number(checkpointObj.conflicts || 0)),
      errors: Math.max(0, Number(checkpointObj.errors || 0)),
      playlistName: String(checkpointObj.playlistName || ""),
      playlistMode: String(checkpointObj.playlistMode || "both"),
      playlistFolderId: checkpointObj.playlistFolderId ? String(checkpointObj.playlistFolderId) : null,
      playlistItemsAdded: Math.max(0, Number(checkpointObj.playlistItemsAdded || 0)),
      verifiedChannelId: checkpointObj.verifiedChannelId ? String(checkpointObj.verifiedChannelId) : null,
      updatedAt: Number(checkpointObj.updatedAt || Date.now())
    };
    memoryFallback.set(`d1_import_checkpoint_${cleanKey}`, normalized);
    memoryFallback.set("json_import_active_checkpoint", normalized);

    const db = await ensureD1Schema(env);
    if (!db) return normalized;
    try {
      trackStat("d1Writes");
      await db.prepare(`
        INSERT OR REPLACE INTO d1_import_checkpoints (
          job_key, file_name, cursor, total, saved_movies, saved_episodes,
          skipped, conflicts, errors, playlist_name, playlist_mode,
          playlist_folder_id, playlist_items_added, verified_channel_id, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
      `).bind(
        normalized.jobKey,
        normalized.fileName,
        normalized.cursor,
        normalized.total,
        normalized.savedMovies,
        normalized.savedEpisodes,
        normalized.skipped,
        normalized.conflicts,
        normalized.errors,
        normalized.playlistName,
        normalized.playlistMode,
        normalized.playlistFolderId,
        normalized.playlistItemsAdded,
        normalized.verifiedChannelId,
        normalized.updatedAt
      ).run();
    } catch (e) {}
    return normalized;
  }

  async function getImportCheckpointFromD1(env, jobKey = "default") {
    const cleanKey = String(jobKey || "default").trim() || "default";
    const db = await ensureD1Schema(env);
    if (db) {
      try {
        trackStat("d1Reads");
        const row = await db
          .prepare("SELECT * FROM d1_import_checkpoints WHERE job_key = ?1")
          .bind(cleanKey)
          .first();
        if (row && (row.file_name || Number(row.total || 0) > 0 || Number(row.cursor || 0) > 0)) {
          trackStat("d1Hits");
          const parsed = {
            jobKey: String(row.job_key || cleanKey),
            fileName: String(row.file_name || ""),
            cursor: Number(row.cursor || 0),
            total: Number(row.total || 0),
            savedMovies: Number(row.saved_movies || 0),
            savedEpisodes: Number(row.saved_episodes || 0),
            skipped: Number(row.skipped || 0),
            conflicts: Number(row.conflicts || 0),
            errors: Number(row.errors || 0),
            playlistName: String(row.playlist_name || ""),
            playlistMode: String(row.playlist_mode || "both"),
            playlistFolderId: row.playlist_folder_id ? String(row.playlist_folder_id) : null,
            playlistItemsAdded: Number(row.playlist_items_added || 0),
            verifiedChannelId: row.verified_channel_id ? String(row.verified_channel_id) : null,
            updatedAt: Number(row.updated_at || Date.now())
          };
          memoryFallback.set(`d1_import_checkpoint_${cleanKey}`, parsed);
          memoryFallback.set("json_import_active_checkpoint", parsed);
          return parsed;
        }
      } catch (e) {}
    }
    const mem = memoryFallback.get(`d1_import_checkpoint_${cleanKey}`) || memoryFallback.get("json_import_active_checkpoint");
    return mem && typeof mem === "object" ? mem : null;
  }

  async function clearImportCheckpointInD1(env, jobKey = "default") {
    const cleanKey = String(jobKey || "default").trim() || "default";
    memoryFallback.delete(`d1_import_checkpoint_${cleanKey}`);
    memoryFallback.delete("json_import_active_checkpoint");
    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      trackStat("d1Writes");
      await db.prepare("DELETE FROM d1_import_checkpoints WHERE job_key = ?1").bind(cleanKey).run();
    } catch (e) {}
  }

  async function upsertPlaylistFolderInD1(env, chatId, folderObj) {
    if (!chatId || !folderObj || !folderObj.id) return folderObj;
    const cleanChatId = String(chatId).trim();
    const now = Date.now();
    const normFolder = {
      id: String(folderObj.id),
      name: String(folderObj.name || "Playlist").slice(0, 64),
      type: String(folderObj.type || (folderObj.isJsonPlaylist ? "playlist" : "custom")),
      isJsonPlaylist: Boolean(folderObj.isJsonPlaylist || folderObj.type === "playlist"),
      playlistMode: String(folderObj.playlistMode || "both"),
      sourceLabel: folderObj.sourceLabel ? String(folderObj.sourceLabel) : null,
      enabled: folderObj.enabled !== false,
      keepWhenEmpty: folderObj.keepWhenEmpty !== false,
      tmdbRefId: folderObj.tmdbRefId ? String(folderObj.tmdbRefId) : null,
      originalName: String(folderObj.originalName || folderObj.name || "Playlist"),
      linked: Boolean(folderObj.linked),
      createdAt: Number(folderObj.createdAt || now),
      updatedAt: now
    };

    const memKey = `d1_playlists_${cleanChatId}`;
    const memList = Array.isArray(memoryFallback.get(memKey)) ? [...memoryFallback.get(memKey)] : [];
    const existingIdx = memList.findIndex(f => String(f.id) === normFolder.id);
    if (existingIdx >= 0) memList[existingIdx] = normFolder;
    else memList.push(normFolder);
    memoryFallback.set(memKey, memList);

    const db = await ensureD1Schema(env);
    if (!db) return normFolder;
    try {
      trackStat("d1Writes");
      await db.prepare(`
        INSERT OR REPLACE INTO d1_playlists (
          folder_id, chat_id, name, type, is_json_playlist, playlist_mode,
          source_label, enabled, keep_when_empty, tmdb_ref_id, original_name,
          linked, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
      `).bind(
        normFolder.id,
        cleanChatId,
        normFolder.name,
        normFolder.type,
        normFolder.isJsonPlaylist ? 1 : 0,
        normFolder.playlistMode,
        normFolder.sourceLabel,
        normFolder.enabled ? 1 : 0,
        normFolder.keepWhenEmpty ? 1 : 0,
        normFolder.tmdbRefId,
        normFolder.originalName,
        normFolder.linked ? 1 : 0,
        normFolder.createdAt,
        normFolder.updatedAt
      ).run();
    } catch (e) {}
    return normFolder;
  }

  async function getPlaylistFoldersFromD1(env, chatId) {
    if (!chatId) return [];
    const cleanChatId = String(chatId).trim();
    const memKey = `d1_playlists_${cleanChatId}`;
    const memList = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];

    const db = await ensureD1Schema(env);
    if (!db) return memList;
    try {
      trackStat("d1Reads");
      const res = await db
        .prepare("SELECT * FROM d1_playlists WHERE chat_id = ?1 ORDER BY created_at ASC")
        .bind(cleanChatId)
        .all();
      const rows = Array.isArray(res?.results) ? res.results : [];
      if (rows.length === 0) return memList;
      trackStat("d1Hits");
      const byId = new Map();
      for (const f of memList) {
        if (f && f.id) byId.set(String(f.id), f);
      }
      for (const r of rows) {
        const mapped = {
          id: String(r.folder_id),
          name: String(r.name || "Playlist"),
          type: String(r.type || "playlist"),
          isJsonPlaylist: Number(r.is_json_playlist) === 1,
          playlistMode: String(r.playlist_mode || "both"),
          sourceLabel: r.source_label ? String(r.source_label) : null,
          enabled: Number(r.enabled) !== 0,
          keepWhenEmpty: Number(r.keep_when_empty) !== 0,
          tmdbRefId: r.tmdb_ref_id ? String(r.tmdb_ref_id) : null,
          originalName: String(r.original_name || r.name || "Playlist"),
          linked: Number(r.linked) === 1,
          createdAt: Number(r.created_at || Date.now())
        };
        byId.set(mapped.id, mapped);
      }
      const merged = Array.from(byId.values());
      memoryFallback.set(memKey, merged);
      return merged;
    } catch (e) {
      return memList;
    }
  }

  async function deletePlaylistFolderFromD1(env, chatId, folderId) {
    if (!chatId || !folderId) return;
    const cleanChatId = String(chatId).trim();
    const cleanFolderId = String(folderId).trim();
    const memKey = `d1_playlists_${cleanChatId}`;
    const memList = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];
    memoryFallback.set(memKey, memList.filter(f => String(f.id) !== cleanFolderId));

    const itemsMemKey = `d1_playlist_items_${cleanChatId}`;
    const memItems = Array.isArray(memoryFallback.get(itemsMemKey)) ? memoryFallback.get(itemsMemKey) : [];
    memoryFallback.set(itemsMemKey, memItems.filter(it => String(it.folderId) !== cleanFolderId));

    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      trackStat("d1Writes");
      await db.batch([
        db.prepare("DELETE FROM d1_playlists WHERE chat_id = ?1 AND folder_id = ?2").bind(cleanChatId, cleanFolderId),
        db.prepare("DELETE FROM d1_playlist_items WHERE chat_id = ?1 AND folder_id = ?2").bind(cleanChatId, cleanFolderId)
      ]);
    } catch (e) {}
  }

  async function batchUpsertPlaylistItemsInD1(env, chatId, folderId, itemsArray) {
    if (!chatId || !Array.isArray(itemsArray) || itemsArray.length === 0) return 0;
    const cleanChatId = String(chatId).trim();
    const defaultFolderId = String(folderId || "bot_vip_auto");
    const now = Date.now();

    const normalizedItems = [];
    for (let i = 0; i < itemsArray.length; i++) {
      const it = itemsArray[i];
      if (!it || !it.tmdbId) continue;
      const contentType = it.contentType === "series" ? "series" : "movie";
      const typePrefix = contentType === "series" ? "s" : "m";
      const targetFolderId = String(it.folderId || defaultFolderId);
      const uid = String(it.uid || `${typePrefix}_${it.tmdbId}_${targetFolderId}`);
      normalizedItems.push({
        uid,
        chatId: cleanChatId,
        folderId: targetFolderId,
        tmdbId: Number(it.tmdbId),
        contentType,
        title: String(it.title || "Unbekannt"),
        year: String(it.year || "K. A."),
        fsk: String(it.fsk || "FSK Keine Angabe"),
        genres: String(it.genres || "K. A."),
        poster_path: it.poster_path ? String(it.poster_path) : null,
        backdrop_path: it.backdrop_path ? String(it.backdrop_path) : null,
        vote_average: Number(it.vote_average || 0),
        vipQuality: it.vipQuality ? String(it.vipQuality) : null,
        vipStreamCount: Number(it.vipStreamCount || 0),
        seriesId: it.seriesId ? Number(it.seriesId) : null,
        seriesTitle: it.seriesTitle ? String(it.seriesTitle) : null,
        seasonNumber: it.seasonNumber ? Number(it.seasonNumber) : null,
        episodeNumber: it.episodeNumber ? Number(it.episodeNumber) : null,
        addedAt: Number(it.addedAt || (now + i))
      });
    }
    if (normalizedItems.length === 0) return 0;

    // Memory-Mirror aktualisieren
    const itemsMemKey = `d1_playlist_items_${cleanChatId}`;
    const existingMem = Array.isArray(memoryFallback.get(itemsMemKey)) ? memoryFallback.get(itemsMemKey) : [];
    const byUid = new Map();
    for (const oldIt of existingMem) {
      if (oldIt && oldIt.uid) byUid.set(String(oldIt.uid), oldIt);
    }
    for (const newIt of normalizedItems) {
      byUid.set(newIt.uid, newIt);
    }
    memoryFallback.set(itemsMemKey, Array.from(byUid.values()));

    const db = await ensureD1Schema(env);
    if (!db) return normalizedItems.length;
    try {
      // Überspringe identische Playlist-Items, die in den letzten 10 Min bereits in D1 gespeichert wurden (verhindert 400x UPSERT bei 200 Serien-Episoden!)
      const itemsNeedingD1Write = normalizedItems.filter(it => {
        const sigKey = `d1_pl_item_sig_${cleanChatId}_${it.uid}`;
        const prevSig = memoryFallback.get(sigKey);
        const curSig = `${it.tmdbId}|${it.folderId}|${it.title}|${it.poster_path || ""}|${it.vipQuality || ""}`;
        if (prevSig && prevSig.sig === curSig && (now - Number(prevSig.ts || 0)) < 600000) {
          return false;
        }
        memoryFallback.set(sigKey, { sig: curSig, ts: now });
        return true;
      });
      if (itemsNeedingD1Write.length === 0) return normalizedItems.length;
      trackStat("d1Writes");
      const CHUNK_SIZE = 50;
      for (let offset = 0; offset < itemsNeedingD1Write.length; offset += CHUNK_SIZE) {
        const chunk = itemsNeedingD1Write.slice(offset, offset + CHUNK_SIZE);
        const stmts = chunk.map(it =>
          db.prepare(`
            INSERT OR REPLACE INTO d1_playlist_items (
              uid, chat_id, folder_id, tmdb_id, content_type, title, year, fsk, genres,
              poster_path, backdrop_path, vote_average, vip_quality, vip_stream_count,
              series_id, series_title, season_number, episode_number, added_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
          `).bind(
            it.uid,
            it.chatId,
            it.folderId,
            it.tmdbId,
            it.contentType,
            it.title,
            it.year,
            it.fsk,
            it.genres,
            it.poster_path,
            it.backdrop_path,
            it.vote_average,
            it.vipQuality,
            it.vipStreamCount,
            it.seriesId,
            it.seriesTitle,
            it.seasonNumber,
            it.episodeNumber,
            it.addedAt
          )
        );
        await db.batch(stmts);
      }
    } catch (e) {}
    return normalizedItems.length;
  }

  async function getPlaylistItemsFromD1(env, chatId, folderId = null, limit = 5000) {
    if (!chatId) return [];
    const cleanChatId = String(chatId).trim();
    const itemsMemKey = `d1_playlist_items_${cleanChatId}`;
    const memItems = Array.isArray(memoryFallback.get(itemsMemKey)) ? memoryFallback.get(itemsMemKey) : [];

    const db = await ensureD1Schema(env);
    if (!db) {
      return folderId
        ? memItems.filter(it => String(it.folderId) === String(folderId)).slice(0, limit)
        : memItems.slice(0, limit);
    }
    try {
      trackStat("d1Reads");
      const query = folderId
        ? db.prepare("SELECT * FROM d1_playlist_items WHERE chat_id = ?1 AND folder_id = ?2 ORDER BY added_at DESC LIMIT ?3").bind(cleanChatId, String(folderId), Number(limit))
        : db.prepare("SELECT * FROM d1_playlist_items WHERE chat_id = ?1 ORDER BY added_at DESC LIMIT ?2").bind(cleanChatId, Number(limit));
      const res = await query.all();
      const rows = Array.isArray(res?.results) ? res.results : [];
      if (rows.length === 0) {
        return folderId
          ? memItems.filter(it => String(it.folderId) === String(folderId)).slice(0, limit)
          : memItems.slice(0, limit);
      }
      trackStat("d1Hits");
      const byUid = new Map();
      for (const m of memItems) {
        if (m && m.uid && (!folderId || String(m.folderId) === String(folderId))) {
          byUid.set(String(m.uid), m);
        }
      }
      for (const r of rows) {
        const mapped = {
          uid: String(r.uid),
          tmdbId: Number(r.tmdb_id),
          contentType: String(r.content_type || "movie"),
          title: String(r.title || "Unbekannt"),
          year: String(r.year || "K. A."),
          fsk: String(r.fsk || "FSK Keine Angabe"),
          genres: String(r.genres || "K. A."),
          poster_path: r.poster_path ? String(r.poster_path) : null,
          backdrop_path: r.backdrop_path ? String(r.backdrop_path) : null,
          vote_average: Number(r.vote_average || 0),
          vipQuality: r.vip_quality ? String(r.vip_quality) : null,
          vipStreamCount: Number(r.vip_stream_count || 0),
          folderId: String(r.folder_id),
          seriesId: r.series_id ? Number(r.series_id) : null,
          seriesTitle: r.series_title ? String(r.series_title) : null,
          seasonNumber: r.season_number ? Number(r.season_number) : null,
          episodeNumber: r.episode_number ? Number(r.episode_number) : null,
          addedAt: Number(r.added_at || Date.now())
        };
        byUid.set(mapped.uid, mapped);
      }
      const merged = Array.from(byUid.values());
      if (!folderId) {
        memoryFallback.set(itemsMemKey, merged);
      }
      return merged;
    } catch (e) {
      return folderId
        ? memItems.filter(it => String(it.folderId) === String(folderId)).slice(0, limit)
        : memItems.slice(0, limit);
    }
  }

  async function deletePlaylistItemFromD1(env, chatId, uidOrTmdbId, folderId = null) {
    if (!chatId || !uidOrTmdbId) return;
    const cleanChatId = String(chatId).trim();
    const targetStr = String(uidOrTmdbId).trim();
    const itemsMemKey = `d1_playlist_items_${cleanChatId}`;
    const memItems = Array.isArray(memoryFallback.get(itemsMemKey)) ? memoryFallback.get(itemsMemKey) : [];
    memoryFallback.set(
      itemsMemKey,
      memItems.filter(it => {
        if (folderId && String(it.folderId) !== String(folderId)) return true;
        return String(it.uid) !== targetStr && String(it.tmdbId) !== targetStr;
      })
    );

    const db = await ensureD1Schema(env);
    if (!db) return;
    try {
      trackStat("d1Writes");
      if (folderId) {
        await db.prepare(
          "DELETE FROM d1_playlist_items WHERE chat_id = ?1 AND folder_id = ?2 AND (uid = ?3 OR CAST(tmdb_id AS TEXT) = ?3)"
        ).bind(cleanChatId, String(folderId), targetStr).run();
      } else {
        await db.prepare(
          "DELETE FROM d1_playlist_items WHERE chat_id = ?1 AND (uid = ?2 OR CAST(tmdb_id AS TEXT) = ?2)"
        ).bind(cleanChatId, targetStr).run();
      }
    } catch (e) {}
  }

  // ============================================================================
  // 900M-ID VORSCHAU, KOLLISIONS-CHECK & 1-KLICK MIGRATION (900M -> ECHTE TMDB-ID)
  // ============================================================================

  async function previewManualSyntheticIdInD1(env, typeCode = "m", rawTitle = "", rawYear = "") {
    const tc = typeCode === "s" ? "s" : "m";
    const cleanT = String(rawTitle || "").trim();
    const yrStr = String(rawYear || "").trim();
    if (!cleanT) {
      return {
        ok: false,
        syntheticId: null,
        rangeLabel: tc === "s" ? "945M–989M (Manuell Serie)" : "900M–944M (Manuell Film)",
        collisionFree: true,
        existingMatch: null,
        existing900mSeries: []
      };
    }
    const baseId = tc === "s" ? 945000000 : 900000000;
    const hashSeed = `${tc}:${cleanT.toLowerCase()}:${yrStr || "k.A."}`;
    let candidateId = baseId + hashStringToPositiveInt(hashSeed, 44999999);
    const db = await ensureD1Schema(env);
    let existingMatch = null;
    const existing900mSeries = [];

    if (db) {
      try {
        // Suche vorhandene 900M-Serien mit ähnlichem oder gleichem Titel für 1-Klick-Vorschlag bei weiteren Episoden
        if (tc === "s") {
          const sRows = await db.prepare("SELECT tmdb_id, title, release_year, poster_path FROM series WHERE tmdb_id >= 900000000 ORDER BY updated_at DESC LIMIT 60").all();
          const normTarget = normalizeCompareString(cleanT);
          for (const r of (sRows?.results || [])) {
            if (!r || !r.tmdb_id) continue;
            const normRow = normalizeCompareString(r.title || "");
            const isMatch = normTarget && normRow && (normRow === normTarget || normRow.includes(normTarget) || normTarget.includes(normRow));
            existing900mSeries.push({
              tmdbId: Number(r.tmdb_id),
              title: String(r.title || ""),
              year: r.release_year || "k.A.",
              posterPath: r.poster_path || "",
              isTitleMatch: Boolean(isMatch)
            });
            if (isMatch && !existingMatch) {
              existingMatch = {
                tmdbId: Number(r.tmdb_id),
                title: String(r.title || ""),
                year: r.release_year || "k.A.",
                typeCode: "s",
                sameTitleReuse: true
              };
            }
          }
        }
        // Prüfe, ob candidateId bereits durch einen ANDEREN Titel belegt ist; falls ja, kollisionsfreien Offset berechnen
        for (let step = 0; step < 8; step++) {
          const testId = candidateId + step;
          const tbl = tc === "s" ? "series" : "movies";
          const row = await db.prepare(`SELECT tmdb_id, title, release_year FROM ${tbl} WHERE tmdb_id = ?1`).bind(testId).first();
          if (!row) {
            candidateId = testId;
            break;
          }
          const sameNorm = normalizeCompareString(row.title || "") === normalizeCompareString(cleanT);
          if (sameNorm) {
            candidateId = testId;
            existingMatch = {
              tmdbId: Number(row.tmdb_id),
              title: String(row.title || ""),
              year: row.release_year || "k.A.",
              typeCode: tc,
              sameTitleReuse: true
            };
            break;
          }
        }
      } catch (e) {}
    }

    return {
      ok: true,
      syntheticId: existingMatch?.sameTitleReuse ? existingMatch.tmdbId : candidateId,
      rangeLabel: tc === "s" ? "945M–989M (Manuell Serie)" : "900M–944M (Manuell Film)",
      collisionFree: true,
      existingMatch,
      existing900mSeries: existing900mSeries.sort((a, b) => (b.isTitleMatch ? 1 : 0) - (a.isTitleMatch ? 1 : 0)).slice(0, 10)
    };
  }

  async function migrateSyntheticIdToRealTmdbInD1(env, oldSyntheticId, newRealTmdbId, typeCode = "m") {
    const oldId = Number(oldSyntheticId || 0);
    const newId = Number(newRealTmdbId || 0);
    const tc = typeCode === "s" ? "s" : "m";
    if (!oldId || !newId || oldId === newId) {
      return { ok: false, error: "Ungültige Quell- oder Ziel-ID." };
    }
    const db = await ensureD1Schema(env);
    if (!db) return { ok: false, error: "D1 Datenbank nicht verfügbar." };

    let movedFilesCount = 0;
    let movedSeasonsCount = 0;
    let movedPlaylistsCount = 0;
    try {
      trackStat("d1Writes");
      if (tc === "s") {
        const epFilesRes = await db.prepare("SELECT * FROM episode_files WHERE series_id = ?1").bind(oldId).all();
        const epFiles = Array.isArray(epFilesRes?.results) ? epFilesRes.results : [];
        for (const f of epFiles) {
          await saveEpisodeFileToD1(env, newId, f.season_number != null ? Number(f.season_number) : 1, f.episode_number || 1, {
            fileId: f.telegram_file_id,
            fileUniqueId: f.telegram_unique_id,
            fileFingerprint: f.file_fingerprint,
            quality: f.quality,
            codec: f.codec,
            part: f.part,
            partNumber: f.part_number || 1,
            editionLabel: f.edition_label,
            isBonus: Boolean(f.is_bonus),
            tags: f.tags,
            versionLabel: f.version_label,
            fileSize: f.file_size,
            mimeType: f.mime_type,
            rawFilename: f.raw_filename,
            rawCaption: f.raw_caption,
            messageLink: f.message_link
          });
          movedFilesCount++;
        }
        const stmts = [
          db.prepare("DELETE FROM episode_files WHERE series_id = ?1").bind(oldId),
          db.prepare("DELETE FROM series_episodes WHERE series_id = ?1").bind(oldId),
          db.prepare("DELETE FROM series_seasons WHERE series_id = ?1").bind(oldId),
          db.prepare("DELETE FROM series WHERE tmdb_id = ?1").bind(oldId),
          db.prepare("UPDATE d1_playlist_items SET tmdb_id = ?1, series_id = ?1 WHERE tmdb_id = ?2 OR series_id = ?2").bind(newId, oldId),
          db.prepare("UPDATE media_reports SET tmdb_id = ?1 WHERE tmdb_id = ?2 AND type_code = 's'").bind(newId, oldId),
          db.prepare("UPDATE import_diagnostic_logs SET tmdb_id = ?1, status = 'OK' WHERE tmdb_id = ?2").bind(newId, oldId)
        ];
        await db.batch(stmts);
        memoryFallback.delete(`d1_catalog_series_${oldId}`);
        memoryFallback.delete(`d1_series_${oldId}`);
        memoryFallback.delete(`d1_series_best_quality_${oldId}`);
        memoryFallback.delete(`d1_series_downloads_${oldId}`);
        for (const k of Array.from(memoryFallback.keys())) {
          if (
            k.startsWith(`d1_ep_files_${oldId}_`) ||
            k.startsWith(`d1_ep_files_season_ts_${oldId}_`) ||
            k.startsWith(`d1_ep_files_ts_${oldId}_`) ||
            k.startsWith(`d1_season_${oldId}_`) ||
            k.startsWith(`tv_${oldId}`) ||
            k.startsWith(`tv_season_${oldId}_`)
          ) {
            memoryFallback.delete(k);
          }
        }
      } else {
        const movFilesRes = await db.prepare("SELECT * FROM movie_files WHERE movie_id = ?1").bind(oldId).all();
        const movFiles = Array.isArray(movFilesRes?.results) ? movFilesRes.results : [];
        for (const f of movFiles) {
          await saveMovieFileToD1(env, newId, {
            fileId: f.telegram_file_id,
            fileUniqueId: f.telegram_unique_id,
            fileFingerprint: f.file_fingerprint,
            quality: f.quality,
            codec: f.codec,
            part: f.part,
            partNumber: f.part_number || 1,
            editionLabel: f.edition_label,
            isBonus: Boolean(f.is_bonus),
            tags: f.tags,
            fileSize: f.file_size,
            mimeType: f.mime_type,
            rawFilename: f.raw_filename,
            rawCaption: f.raw_caption,
            messageLink: f.message_link
          });
          movedFilesCount++;
        }
        const stmts = [
          db.prepare("DELETE FROM movie_files WHERE movie_id = ?1").bind(oldId),
          db.prepare("DELETE FROM movies WHERE tmdb_id = ?1").bind(oldId),
          db.prepare("UPDATE d1_playlist_items SET tmdb_id = ?1 WHERE tmdb_id = ?2").bind(newId, oldId),
          db.prepare("UPDATE media_reports SET tmdb_id = ?1 WHERE tmdb_id = ?2 AND type_code = 'm'").bind(newId, oldId),
          db.prepare("UPDATE import_diagnostic_logs SET tmdb_id = ?1, status = 'OK' WHERE tmdb_id = ?2").bind(newId, oldId)
        ];
        await db.batch(stmts);
        memoryFallback.delete(`d1_catalog_movie_${oldId}`);
        memoryFallback.delete(`d1_movie_${oldId}`);
        memoryFallback.delete(`d1_movie_files_${oldId}`);
        memoryFallback.delete(`d1_movie_files_ts_${oldId}`);
        memoryFallback.delete(`d1_movie_best_quality_${oldId}`);
        memoryFallback.delete(`d1_movie_downloads_${oldId}`);
        memoryFallback.delete(`movie_${oldId}`);
      }
      memoryFallback.delete("d1_local_catalog_title_map_ts");
      memoryFallback.delete("d1_series_gaps_cache");
      return { ok: true, oldId, newId, typeCode: tc, movedFilesCount, movedSeasonsCount, movedPlaylistsCount };
    } catch (e) {
      return { ok: false, error: String(e?.message || e || "Migrationsfehler") };
    }
  }

  // ============================================================================
  // HIGH-VOLUME GRUPPEN- & KANAL-INGEST: OPT-IN REGISTRY & D1 STAGING-INBOX (500+ TITEL)
  // ============================================================================
  const AUTO_INGEST_CHATS_CACHE_KEY = "AUTO_INGEST_CHATS_V1";
  const AUTO_INGEST_CHATS_RAM_TTL_MS = 5 * 60 * 1000;

  async function getAutoIngestChatsMap(env, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh) {
      const cached = memoryFallback.get("auto_ingest_chats_ram");
      if (cached && cached.map && (now - cached.ts) < AUTO_INGEST_CHATS_RAM_TTL_MS) {
        return cached.map;
      }
    }
    let map = {};
    try {
      const saved = await getEntityFromD1(env, AUTO_INGEST_CHATS_CACHE_KEY, 365 * 24 * 60 * 60 * 1000, {
        bypassMemoryCache: true
      });
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        map = { ...saved };
      }
    } catch (_e) {}
    memoryFallback.set("auto_ingest_chats_ram", { map, ts: now });
    return map;
  }

  async function isAutoIngestChatEnabled(env, chatId) {
    const cid = String(chatId || "").trim();
    if (!cid || !cid.startsWith("-")) return false;
    const map = await getAutoIngestChatsMap(env, false);
    const entry = map[cid];
    return Boolean(entry && entry.enabled === true);
  }

  async function setAutoIngestChatEnabled(env, chatId, opts = {}) {
    const cid = String(chatId || "").trim();
    if (!cid || !/^-\d{4,}$/.test(cid)) {
      return { ok: false, error: "Ungültige Gruppen-/Kanal-ID (muss negativ sein, z. B. -1001234567890)." };
    }
    const map = await getAutoIngestChatsMap(env, true);
    const prev = (map[cid] && typeof map[cid] === "object") ? map[cid] : {};
    const enabled = opts.enabled !== undefined ? Boolean(opts.enabled) : Boolean(prev.enabled);
    const archiveMirrorEnabled = opts.archiveMirrorEnabled !== undefined
      ? Boolean(opts.archiveMirrorEnabled)
      : Boolean(prev.archiveMirrorEnabled);
    const now = Date.now();
    const nextEntry = {
      ...prev,
      chatId: cid,
      title: String(opts.title || prev.title || `Chat ${cid}`).trim().slice(0, 120),
      chatType: String(opts.chatType || prev.chatType || (cid.startsWith("-100") ? "channel" : "group")),
      enabled,
      archiveMirrorEnabled,
      updatedAt: now,
      activatedAt: enabled ? (prev.activatedAt || now) : (prev.activatedAt || null),
      activatedBy: opts.activatedBy ? String(opts.activatedBy) : (prev.activatedBy || null),
      lastContextSnapshot: prev.lastContextSnapshot || null
    };
    const nextMap = { ...map, [cid]: nextEntry };
    await saveEntityToD1(env, AUTO_INGEST_CHATS_CACHE_KEY, "config", nextMap);
    memoryFallback.set("auto_ingest_chats_ram", { map: nextMap, ts: now });
    return { ok: true, entry: nextEntry, map: nextMap };
  }

  async function updateAutoIngestChatContextSnapshot(env, chatId, snapshot = null, meta = {}) {
    const cid = String(chatId || "").trim();
    if (!cid) return false;
    try {
      const map = await getAutoIngestChatsMap(env, true);
      const existing = map[cid] || null;
      if (!existing && !snapshot) return false;
      const now = Date.now();
      const baseEntry = existing || {
        chatId: cid,
        enabled: false,
        title: String(meta?.title || cid).slice(0, 140),
        chatType: String(meta?.chatType || (cid.startsWith("-100") ? "channel" : "group")).slice(0, 32),
        activatedBy: null,
        updatedAt: now
      };
      const nextMap = {
        ...map,
        [cid]: {
          ...baseEntry,
          lastContextSnapshot: snapshot || null,
          updatedAt: now
        }
      };
      await saveEntityToD1(env, AUTO_INGEST_CHATS_CACHE_KEY, "config", nextMap);
      memoryFallback.set("auto_ingest_chats_ram", { map: nextMap, ts: now });
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function enqueueChannelIngestMessageToD1(env, rec) {
    const db = await ensureD1Schema(env);
    if (!db || !rec || !rec.chatId || !rec.messageId) return { ok: false, skipped: true };
    const now = Number(rec.createdAt || Date.now());
    const chatIdStr = String(rec.chatId);
    const chatTitleStr = String(rec.chatTitle || "").slice(0, 120);
    const msgIdNum = Number(rec.messageId);
    const replyIdNum = rec.replyToMessageId ? Number(rec.replyToMessageId) : null;
    const mediaGrpStr = rec.mediaGroupId ? String(rec.mediaGroupId).slice(0, 64) : null;
    const msgKindStr = String(rec.msgKind || "context");
    const payloadStr = JSON.stringify(rec.payload || {});
    let lastErr = null;
    // INSERT OR IGNORE ist 100% idempotent (UNIQUE chat_id, message_id) -> 2 kurze Jitter-Retries fangen
    // kurzzeitige D1-Write-Locks bei Tausenden parallelen Kanal-Posts verlustfrei ab (0 ms Overhead im Normalfall).
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        trackStat("d1Writes");
        const res = await db.prepare(
          `INSERT OR IGNORE INTO channel_ingest_inbox
           (chat_id, chat_title, message_id, reply_to_message_id, media_group_id, msg_kind, payload_json, status, locked_until, reaction_pending, created_at, processed_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 0, 0, ?8, 0)`
        ).bind(
          chatIdStr,
          chatTitleStr,
          msgIdNum,
          replyIdNum,
          mediaGrpStr,
          msgKindStr,
          payloadStr,
          now
        ).run();
        const inserted = Number(res?.meta?.changes || 0) > 0;
        return { ok: true, inserted };
      } catch (e) {
        lastErr = e;
        if (attempt < 2) {
          const baseDelay = attempt === 0 ? 120 : 350;
          await new Promise(r => setTimeout(r, baseDelay + Math.floor(Math.random() * 80)));
        }
      }
    }
    return { ok: false, error: String(lastErr?.message || lastErr || "D1 enqueue failed") };
  }

  async function releaseExpiredChannelIngestLocksInD1(env, now = Date.now()) {
    const db = await ensureD1Schema(env);
    if (!db) return 0;
    try {
      trackStat("d1Writes");
      const res = await db.prepare(
        "UPDATE channel_ingest_inbox SET status = 'pending', locked_until = 0 WHERE status = 'processing' AND locked_until > 0 AND locked_until < ?1"
      ).bind(Number(now)).run();
      return Number(res?.meta?.changes || 0);
    } catch (_e) {
      return 0;
    }
  }

  async function getChannelIngestInboxStatsFromD1(env, filterChatId = null) {
    const db = await ensureD1Schema(env);
    if (!db) return { chats: [], totals: { pending: 0, staging: 0, processing: 0, done: 0, review: 0, ignored: 0, reactionPending: 0 } };
    try {
      trackStat("d1Reads");
      const baseSql = `SELECT
        chat_id,
        MAX(chat_title) AS chat_title,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN status = 'staging' THEN 1 ELSE 0 END) AS staging_count,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing_count,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_count,
        SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review_count,
        SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) AS ignored_count,
        SUM(CASE WHEN reaction_pending = 1 THEN 1 ELSE 0 END) AS reaction_pending_count,
        MIN(CASE WHEN status = 'pending' THEN created_at ELSE NULL END) AS oldest_pending_at,
        MAX(CASE WHEN status = 'pending' THEN created_at ELSE NULL END) AS newest_pending_at
      FROM channel_ingest_inbox`;
      const res = filterChatId
        ? await db.prepare(`${baseSql} WHERE chat_id = ?1 GROUP BY chat_id`).bind(String(filterChatId)).all()
        : await db.prepare(`${baseSql} GROUP BY chat_id ORDER BY pending_count DESC, newest_pending_at DESC`).all();

      const totals = { pending: 0, staging: 0, processing: 0, done: 0, review: 0, ignored: 0, reactionPending: 0 };
      const chats = (res?.results || []).map(r => {
        const item = {
          chatId: String(r.chat_id),
          chatTitle: String(r.chat_title || r.chat_id),
          pending: Number(r.pending_count || 0),
          staging: Number(r.staging_count || 0),
          processing: Number(r.processing_count || 0),
          done: Number(r.done_count || 0),
          review: Number(r.review_count || 0),
          ignored: Number(r.ignored_count || 0),
          reactionPending: Number(r.reaction_pending_count || 0),
          oldestPendingAt: r.oldest_pending_at ? Number(r.oldest_pending_at) : null,
          newestPendingAt: r.newest_pending_at ? Number(r.newest_pending_at) : null
        };
        totals.pending += item.pending;
        totals.staging += item.staging;
        totals.processing += item.processing;
        totals.done += item.done;
        totals.review += item.review;
        totals.ignored += item.ignored;
        totals.reactionPending += item.reactionPending;
        return item;
      });
      return { chats, totals };
    } catch (_e) {
      return { chats: [], totals: { pending: 0, staging: 0, processing: 0, done: 0, review: 0, ignored: 0, reactionPending: 0 } };
    }
  }

  async function claimPendingChannelIngestWindowFromD1(env, chatId, limit = 50, leaseMs = 90000, options = {}) {
    const db = await ensureD1Schema(env);
    if (!db || !chatId) return [];
    const now = Date.now();
    const safeLimit = Math.max(1, Math.min(250, Number(limit || 50)));
    const lockUntil = now + Math.max(15000, Number(leaseMs || 90000));
    try {
      if (!options?.skipLockRelease) {
        const hasExpired = await db.prepare(
          "SELECT 1 AS hit FROM channel_ingest_inbox WHERE status = 'processing' AND locked_until > 0 AND locked_until < ?1 LIMIT 1"
        ).bind(now).first();
        if (hasExpired) {
          await releaseExpiredChannelIngestLocksInD1(env, now);
        }
      }
      trackStat("d1Reads");
      const sel = await db.prepare(
        `SELECT id, chat_id, chat_title, message_id, reply_to_message_id, media_group_id, msg_kind, payload_json, created_at, ingest_priority, suppress_reaction, source_job_id
         FROM channel_ingest_inbox
         WHERE chat_id = ?1 AND status = 'pending'
         ORDER BY ingest_priority DESC, message_id ASC
         LIMIT ?2`
      ).bind(String(chatId), safeLimit).all();
      const rawRows = sel?.results || [];
      if (rawRows.length === 0) return [];
      // Live-vor-History-Priorität OHNE Fenster-Vermischung: Enthält der Batch Live-Posts (>=10),
      // werden in diesem Fenster ausschließlich die Live-Posts geclaimed, damit Live & History niemals im selben Parser-Kontext kollidieren!
      const hasLive = rawRows.some(r => Number(r.ingest_priority ?? 10) >= 10);
      const rows = hasLive
        ? rawRows.filter(r => Number(r.ingest_priority ?? 10) >= 10)
        : rawRows;
      const ids = rows.map(r => Number(r.id)).filter(n => Number.isFinite(n));
      if (ids.length > 0) {
        trackStat("d1Writes");
        const CHUNK = 80; // Strikt unter Cloudflare D1 Limit (max. 100 SQL Bind-Parameter pro Statement!)
        const lockStmts = [];
        for (let i = 0; i < ids.length; i += CHUNK) {
          const part = ids.slice(i, i + CHUNK);
          const placeholders = part.map((_, idx) => `?${idx + 2}`).join(", ");
          lockStmts.push(
            db.prepare(
              `UPDATE channel_ingest_inbox SET status = 'processing', locked_until = ?1 WHERE id IN (${placeholders}) AND status = 'pending'`
            ).bind(lockUntil, ...part)
          );
        }
        const rawDb = getRawD1Binding(env) || db;
        if (lockStmts.length > 1 && rawDb && typeof rawDb.batch === "function") {
          await rawDb.batch(unwrapRawD1Statements(lockStmts));
        } else {
          for (const st of lockStmts) await st.run();
        }
      }
      return rows.map(r => {
        let payload = {};
        try { payload = JSON.parse(r.payload_json || "{}"); } catch (_e) {}
        return {
          id: Number(r.id),
          chatId: String(r.chat_id),
          chatTitle: String(r.chat_title || ""),
          messageId: Number(r.message_id),
          replyToMessageId: r.reply_to_message_id ? Number(r.reply_to_message_id) : null,
          mediaGroupId: r.media_group_id ? String(r.media_group_id) : null,
          msgKind: String(r.msg_kind || "context"),
          ingestPriority: Number(r.ingest_priority ?? 10),
          suppressReaction: Number(r.suppress_reaction || 0) === 1 || Boolean(payload?._suppressReaction),
          sourceJobId: Number(r.source_job_id || payload?._historyJobId || 0),
          payload,
          createdAt: Number(r.created_at || 0)
        };
      });
    } catch (_e) {
      return [];
    }
  }

  async function markChannelIngestRowsStatusInD1(env, updates = []) {
    const db = await ensureD1Schema(env);
    if (!db || !Array.isArray(updates) || updates.length === 0) return 0;
    const now = Date.now();
    const pendingResetIds = [];
    const plainDoneIds = [];
    const plainIgnoredIds = [];
    const customUpdates = [];

    for (const u of updates) {
      if (!u || !u.id) continue;
      const rowId = Number(u.id);
      if (!Number.isFinite(rowId) || rowId <= 0) continue;
      const nextStatus = String(u.status || "done");
      const hasRichMeta = Boolean(u.resultEmoji || u.reactionPending || u.resolvedTmdbId || u.resolvedType);
      if (nextStatus === "pending" && !hasRichMeta) {
        pendingResetIds.push(rowId);
      } else if (nextStatus === "done" && !hasRichMeta) {
        plainDoneIds.push(rowId);
      } else if (nextStatus === "ignored" && !hasRichMeta) {
        plainIgnoredIds.push(rowId);
      } else {
        customUpdates.push(u);
      }
    }

    const stmts = [];
    const ID_CHUNK = 80; // Strikt unter Cloudflare D1 Limit (max. 100 SQL Bind-Parameter!)
    for (let i = 0; i < pendingResetIds.length; i += ID_CHUNK) {
      const part = pendingResetIds.slice(i, i + ID_CHUNK);
      const ph = part.map((_, idx) => `?${idx + 1}`).join(", ");
      stmts.push(
        db.prepare(
          `UPDATE channel_ingest_inbox
           SET status = 'pending', locked_until = 0, result_emoji = NULL, reaction_pending = 0, resolved_tmdb_id = NULL, resolved_type = NULL, processed_at = 0
           WHERE id IN (${ph})`
        ).bind(...part)
      );
    }
    for (let i = 0; i < plainDoneIds.length; i += ID_CHUNK) {
      const part = plainDoneIds.slice(i, i + ID_CHUNK);
      const ph = part.map((_, idx) => `?${idx + 2}`).join(", ");
      stmts.push(
        db.prepare(
          `UPDATE channel_ingest_inbox
           SET status = 'done', locked_until = 0, result_emoji = NULL, reaction_pending = 0, resolved_tmdb_id = NULL, resolved_type = NULL, processed_at = ?1
           WHERE id IN (${ph})`
        ).bind(now, ...part)
      );
    }
    for (let i = 0; i < plainIgnoredIds.length; i += ID_CHUNK) {
      const part = plainIgnoredIds.slice(i, i + ID_CHUNK);
      const ph = part.map((_, idx) => `?${idx + 2}`).join(", ");
      stmts.push(
        db.prepare(
          `UPDATE channel_ingest_inbox
           SET status = 'ignored', locked_until = 0, result_emoji = NULL, reaction_pending = 0, resolved_tmdb_id = NULL, resolved_type = NULL, processed_at = ?1
           WHERE id IN (${ph})`
        ).bind(now, ...part)
      );
    }
    for (const u of customUpdates) {
      const nextStatus = String(u.status || "done");
      const processedAt = nextStatus === "pending" ? 0 : now;
      stmts.push(
        db.prepare(
          `UPDATE channel_ingest_inbox
           SET status = ?1, locked_until = 0, result_emoji = ?2, reaction_pending = ?3, resolved_tmdb_id = ?4, resolved_type = ?5, processed_at = ?6
           WHERE id = ?7`
        ).bind(
          nextStatus,
          u.resultEmoji ? String(u.resultEmoji) : null,
          u.reactionPending ? 1 : 0,
          u.resolvedTmdbId ? Number(u.resolvedTmdbId) : null,
          u.resolvedType ? String(u.resolvedType) : null,
          processedAt,
          Number(u.id)
        )
      );
    }

    const totalUpdated = pendingResetIds.length + plainDoneIds.length + plainIgnoredIds.length + customUpdates.length;
    if (stmts.length === 0) return 0;
    try {
      trackStat("d1Writes");
      const rawDb = getRawD1Binding(env) || db;
      const STMT_CHUNK = 50;
      for (let i = 0; i < stmts.length; i += STMT_CHUNK) {
        const slice = stmts.slice(i, i + STMT_CHUNK);
        if (slice.length > 1 && rawDb && typeof rawDb.batch === "function") {
          await rawDb.batch(unwrapRawD1Statements(slice));
        } else {
          for (const st of slice) await st.run();
        }
      }
      return totalUpdated;
    } catch (_e) {
      return 0;
    }
  }

  const D1_HYGIENE_META_KEY = "d1_hygiene_meta_v1";
  const D1_HYGIENE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

  async function runD1HygienePassInD1(env, options = {}) {
    const db = await ensureD1Schema(env);
    if (!db) return { ok: false, error: "D1 Datenbank nicht verfügbar." };
    const now = Date.now();
    const force = Boolean(options.force);
    const inboxRetentionDays = Math.max(7, Math.min(365, Number(options.inboxRetentionDays || 30)));
    const archiveCompactDays = Math.max(7, Math.min(365, Number(options.archiveCompactDays || 30)));

    try {
      // 6h-Rate-Guard (außer bei manuellem Admin-Aufruf force:true) -> 0 unnötige D1-Writes auf Cloudflare Free Plan!
      if (!force) {
        const memMeta = memoryFallback.get(D1_HYGIENE_META_KEY);
        if (memMeta && Number(memMeta.lastRunAt || 0) > 0 && (now - Number(memMeta.lastRunAt)) < D1_HYGIENE_MIN_INTERVAL_MS) {
          return { ok: true, skippedCooldown: true, ...memMeta };
        }
        trackStat("d1Reads");
        const metaRow = await db.prepare("SELECT data_json FROM entity_cache WHERE cache_key = ?1").bind(D1_HYGIENE_META_KEY).first();
        if (metaRow?.data_json) {
          try {
            const parsed = JSON.parse(metaRow.data_json);
            if (Number(parsed?.lastRunAt || 0) > 0 && (now - Number(parsed.lastRunAt)) < D1_HYGIENE_MIN_INTERVAL_MS) {
              memoryFallback.set(D1_HYGIENE_META_KEY, parsed);
              return { ok: true, skippedCooldown: true, ...parsed };
            }
          } catch (_e) {}
        }
      }

      const inboxCutoff = now - inboxRetentionDays * 24 * 60 * 60 * 1000;
      const archiveCompactCutoff = now - archiveCompactDays * 24 * 60 * 60 * 1000;
      const webauthCutoff = now - 60 * 60 * 1000; // Abgelaufene Login-Challenges (> 1 Stunde)
      const chatStateCutoff = now - 24 * 60 * 60 * 1000; // Temporäre Chat-Assistenten-Zustände (> 24 Stunden)
      const searchCacheCutoff = now - 14 * 24 * 60 * 60 * 1000; // Veralteter Such-Cache (> 14 Tage)

      trackStat("d1Writes");
      const rawDb = getRawD1Binding(env) || db;
      const stmts = [
        // 1. Erledigte Inbox-Zeilen > 30 Tage löschen (hält D1-Rows-Read extrem klein, 30 Tage Vorab-Skip bleiben erhalten)
        db.prepare(
          `DELETE FROM channel_ingest_inbox
           WHERE id IN (
             SELECT id FROM channel_ingest_inbox
             WHERE status IN ('done', 'ignored') AND reaction_pending = 0 AND processed_at > 0 AND processed_at < ?1
             LIMIT 250
           )`
        ).bind(inboxCutoff),
        // 2. Archiv-Queue > 30 Tage VERLUSTFREI kompaktieren: lange Texte/URLs leeren, Dedup-IDs & Inhaltsverzeichnis-Zähler 100% behalten!
        db.prepare(
          `UPDATE archive_mirror_queue
           SET caption_html = '', series_header_html = '', series_poster_url = '', cover_url = ''
           WHERE id IN (
             SELECT id FROM archive_mirror_queue
             WHERE status = 'posted' AND updated_at > 0 AND updated_at < ?1
               AND (caption_html != '' OR COALESCE(series_header_html, '') != '' OR COALESCE(series_poster_url, '') != '' OR COALESCE(cover_url, '') != '')
             LIMIT 250
           )`
        ).bind(archiveCompactCutoff),
        // 3. Abgelaufene Web-Login-Challenges (> 1h) entfernen
        db.prepare(
          `DELETE FROM entity_cache
           WHERE cache_key IN (
             SELECT cache_key FROM entity_cache
             WHERE entity_type = 'webauth' AND updated_at < ?1
             LIMIT 250
           )`
        ).bind(webauthCutoff),
        // 4. Abgelaufene temporäre Chat-Assistenten-Zustände (> 24h) entfernen (permanente Konfig-Keys bleiben unberührt!)
        db.prepare(
          `DELETE FROM entity_cache
           WHERE cache_key IN (
             SELECT cache_key FROM entity_cache
             WHERE cache_key LIKE 'hist_chat_state_%' AND updated_at < ?1
             LIMIT 200
           )`
        ).bind(chatStateCutoff),
        // 5. Veralteten Such-Cache (> 14 Tage) bereinigen
        db.prepare(
          `DELETE FROM search_cache
           WHERE cache_key IN (
             SELECT cache_key FROM search_cache
             WHERE updated_at < ?1
             LIMIT 250
           )`
        ).bind(searchCacheCutoff)
      ];

      let changesList = [0, 0, 0, 0, 0];
      if (rawDb && typeof rawDb.batch === "function") {
        const resArr = await rawDb.batch(unwrapRawD1Statements(stmts));
        changesList = (resArr || []).map(r => Number(r?.meta?.changes || 0));
      } else {
        for (let i = 0; i < stmts.length; i++) {
          const r = await stmts[i].run();
          changesList[i] = Number(r?.meta?.changes || 0);
        }
      }

      const summary = {
        lastRunAt: now,
        inboxRetentionDays,
        archiveCompactDays,
        inboxDeleted: Number(changesList[0] || 0),
        archiveCompacted: Number(changesList[1] || 0),
        webauthDeleted: Number(changesList[2] || 0),
        chatStateDeleted: Number(changesList[3] || 0),
        searchCacheDeleted: Number(changesList[4] || 0)
      };
      summary.cacheDeleted = summary.webauthDeleted + summary.chatStateDeleted + summary.searchCacheDeleted;
      summary.totalAffected = summary.inboxDeleted + summary.archiveCompacted + summary.cacheDeleted;

      memoryFallback.set(D1_HYGIENE_META_KEY, summary);
      trackStat("d1Writes");
      await db.prepare(
        `INSERT INTO entity_cache (cache_key, entity_type, data_json, updated_at)
         VALUES (?1, 'system', ?2, ?3)
         ON CONFLICT(cache_key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`
      ).bind(D1_HYGIENE_META_KEY, JSON.stringify(summary), now).run().catch(() => {});

      return { ok: true, skippedCooldown: false, ...summary };
    } catch (e) {
      return { ok: false, error: String(e?.message || "D1-Hygiene fehlgeschlagen.") };
    }
  }

  async function cleanupOldChannelIngestRowsInD1(env, retentionDays = 30) {
    const res = await runD1HygienePassInD1(env, {
      inboxRetentionDays: Math.max(7, Number(retentionDays || 30)),
      archiveCompactDays: 30,
      force: true
    });
    return Number(res?.totalAffected || 0);
  }

  async function getPendingReactionInboxRowsFromD1(env, limit = 12) {
    const db = await ensureD1Schema(env);
    if (!db) return [];
    const safeLimit = Math.max(1, Math.min(30, Number(limit || 12)));
    try {
      trackStat("d1Reads");
      const res = await db.prepare(
        `SELECT id, chat_id, message_id, result_emoji
         FROM channel_ingest_inbox
         WHERE reaction_pending = 1 AND result_emoji IS NOT NULL AND result_emoji != ''
         ORDER BY
           CASE result_emoji
             WHEN '👀' THEN 1
             WHEN '🔥' THEN 2
             WHEN '👍' THEN 3
             WHEN '✍' THEN 4
             ELSE 5
           END ASC,
           id ASC
         LIMIT ?1`
      ).bind(safeLimit).all();
      return (res?.results || []).map(r => ({
        id: Number(r.id),
        chatId: String(r.chat_id),
        messageId: Number(r.message_id),
        emoji: String(r.result_emoji)
      }));
    } catch (_e) {
      return [];
    }
  }

  async function clearPendingReactionInD1(env, rowIds = []) {
    const db = await ensureD1Schema(env);
    if (!db || !Array.isArray(rowIds) || rowIds.length === 0) return 0;
    const cleanIds = rowIds.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0);
    if (cleanIds.length === 0) return 0;
    try {
      trackStat("d1Writes");
      const CHUNK = 80; // Strikt unter Cloudflare D1 100-Parameter-Limit
      let totalChanged = 0;
      for (let i = 0; i < cleanIds.length; i += CHUNK) {
        const part = cleanIds.slice(i, i + CHUNK);
        const placeholders = part.map((_, idx) => `?${idx + 1}`).join(", ");
        const res = await db.prepare(
          `UPDATE channel_ingest_inbox SET reaction_pending = 0 WHERE id IN (${placeholders})`
        ).bind(...part).run();
        totalChanged += Number(res?.meta?.changes || 0);
      }
      return totalChanged;
    } catch (_e) {
      return 0;
    }
  }

  async function fetchPendingChannelIngestMessagesForBrowserFromD1(env, chatId, limit = 200) {
    const db = await ensureD1Schema(env);
    if (!db || !chatId) return { rows: [], totalPending: 0 };
    const safeLimit = Math.max(1, Math.min(250, Number(limit || 200)));
    const now = Date.now();
    try {
      trackStat("d1Reads");
      const rawDb = getRawD1Binding(env) || db;
      const expStmt = db.prepare(
        "SELECT 1 AS hit FROM channel_ingest_inbox WHERE status = 'processing' AND chat_id = ?1 AND locked_until > 0 AND locked_until < ?2 LIMIT 1"
      ).bind(String(chatId), now);
      const selStmt = db.prepare(
        `SELECT id, chat_id, chat_title, message_id, reply_to_message_id, media_group_id, msg_kind, payload_json, created_at, ingest_priority, suppress_reaction, source_job_id
         FROM channel_ingest_inbox
         WHERE chat_id = ?1 AND status = 'pending'
         ORDER BY ingest_priority DESC, message_id ASC
         LIMIT ?2`
      ).bind(String(chatId), safeLimit);
      const cntStmt = db.prepare(
        `SELECT COUNT(*) AS cnt FROM channel_ingest_inbox WHERE chat_id = ?1 AND status = 'pending'`
      ).bind(String(chatId));

      let expRes, sel, cntRow;
      if (rawDb && typeof rawDb.batch === "function") {
        const b = await rawDb.batch(unwrapRawD1Statements([expStmt, selStmt, cntStmt]));
        expRes = b?.[0]?.results?.[0] || null;
        sel = b?.[1];
        cntRow = b?.[2]?.results?.[0] || null;
      } else {
        [expRes, sel, cntRow] = await Promise.all([expStmt.first(), selStmt.all(), cntStmt.first()]);
      }
      if (expRes) {
        const released = await releaseExpiredChannelIngestLocksInD1(env, now);
        if (released > 0) {
          [sel, cntRow] = await Promise.all([selStmt.all(), cntStmt.first()]);
        }
      }
      const rawBrowserRows = sel?.results || [];
      const hasLiveBrowser = rawBrowserRows.some(r => Number(r.ingest_priority ?? 10) >= 10);
      const scopedBrowserRows = hasLiveBrowser
        ? rawBrowserRows.filter(r => Number(r.ingest_priority ?? 10) >= 10)
        : rawBrowserRows;
      const rows = scopedBrowserRows.map(r => {
        let payload = {};
        try { payload = JSON.parse(r.payload_json || "{}"); } catch (_e) {}
        return {
          id: Number(r.id),
          chatId: String(r.chat_id),
          chatTitle: String(r.chat_title || ""),
          messageId: Number(r.message_id),
          replyToMessageId: r.reply_to_message_id ? Number(r.reply_to_message_id) : null,
          mediaGroupId: r.media_group_id ? String(r.media_group_id) : null,
          msgKind: String(r.msg_kind || "context"),
          ingestPriority: Number(r.ingest_priority ?? 10),
          suppressReaction: Number(r.suppress_reaction || 0) === 1 || Boolean(payload?._suppressReaction),
          sourceJobId: Number(r.source_job_id || payload?._historyJobId || 0),
          payload,
          createdAt: Number(r.created_at || 0)
        };
      });
      return { rows, totalPending: Number(cntRow?.cnt || rows.length) };
    } catch (_e) {
      return { rows: [], totalPending: 0 };
    }
  }

  async function getChannelIngestRowsByIdsFromD1(env, chatId, rowIds = []) {
    const db = await ensureD1Schema(env);
    if (!db || !chatId || !Array.isArray(rowIds) || rowIds.length === 0) return [];
    const cleanIds = Array.from(new Set(rowIds.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0))).slice(0, 250);
    if (cleanIds.length === 0) return [];
    try {
      trackStat("d1Reads");
      const out = [];
      const CHUNK = 80;
      for (let i = 0; i < cleanIds.length; i += CHUNK) {
        const part = cleanIds.slice(i, i + CHUNK);
        const placeholders = part.map((_, idx) => `?${idx + 2}`).join(", ");
        const res = await db.prepare(
          `SELECT id, chat_id, chat_title, message_id, reply_to_message_id, media_group_id, msg_kind, payload_json, status, locked_until, created_at, ingest_priority, suppress_reaction, source_job_id
           FROM channel_ingest_inbox
           WHERE chat_id = ?1 AND id IN (${placeholders})
           ORDER BY message_id ASC`
        ).bind(String(chatId), ...part).all();
        for (const r of (res?.results || [])) {
          let payload = {};
          try { payload = JSON.parse(r.payload_json || "{}"); } catch (_e) {}
          out.push({
            id: Number(r.id),
            chatId: String(r.chat_id),
            chatTitle: String(r.chat_title || ""),
            messageId: Number(r.message_id),
            replyToMessageId: r.reply_to_message_id ? Number(r.reply_to_message_id) : null,
            mediaGroupId: r.media_group_id ? String(r.media_group_id) : null,
            msgKind: String(r.msg_kind || "context"),
            status: String(r.status || "pending"),
            lockedUntil: Number(r.locked_until || 0),
            ingestPriority: Number(r.ingest_priority ?? 10),
            suppressReaction: Number(r.suppress_reaction || 0) === 1 || Boolean(payload?._suppressReaction),
            sourceJobId: Number(r.source_job_id || payload?._historyJobId || 0),
            payload,
            createdAt: Number(r.created_at || 0)
          });
        }
      }
      return out;
    } catch (_e) {
      return [];
    }
  }

  // O(1)-Index-Fast-Probe für den 2-Minuten-Cron: liest im Leerlauf 0 Zeilen und macht 0 D1-Writes
  // (verhindert Millionen unnötiger Full-Table-Scan-Reads über alte 'done'-Zeilen auf dem Cloudflare Free Plan!).
  async function getChannelIngestCronFastProbeFromD1(env, now = Date.now(), filterChatId = null) {
    const db = await ensureD1Schema(env);
    if (!db) {
      return { chats: [], totalPending: 0, hasExpiredLocks: false, hasPendingReactions: false };
    }
    try {
      trackStat("d1Reads");
      const rawDb = getRawD1Binding(env) || db;
      const pendingStmt = filterChatId
        ? db.prepare(
            `SELECT chat_id, COUNT(*) AS pending_count, MIN(created_at) AS oldest_pending_at, MAX(created_at) AS newest_pending_at
             FROM channel_ingest_inbox
             WHERE status = 'pending' AND chat_id = ?1
             GROUP BY chat_id`
          ).bind(String(filterChatId))
        : db.prepare(
            `SELECT chat_id, COUNT(*) AS pending_count, MIN(created_at) AS oldest_pending_at, MAX(created_at) AS newest_pending_at
             FROM channel_ingest_inbox
             WHERE status = 'pending'
             GROUP BY chat_id`
          );
      const lockStmt = db.prepare(
        `SELECT 1 AS hit FROM channel_ingest_inbox WHERE status = 'processing' AND locked_until > 0 AND locked_until < ?1 LIMIT 1`
      ).bind(Number(now));
      const reactStmt = db.prepare(
        `SELECT 1 AS hit FROM channel_ingest_inbox WHERE reaction_pending = 1 LIMIT 1`
      );

      let pendingRes, lockRes, reactRes;
      if (rawDb && typeof rawDb.batch === "function") {
        const batchOut = await rawDb.batch(unwrapRawD1Statements([pendingStmt, lockStmt, reactStmt]));
        pendingRes = batchOut?.[0];
        lockRes = batchOut?.[1];
        reactRes = batchOut?.[2];
      } else {
        [pendingRes, lockRes, reactRes] = await Promise.all([pendingStmt.all(), lockStmt.all(), reactStmt.all()]);
      }

      let totalPending = 0;
      const chats = (pendingRes?.results || []).map(r => {
        const p = Number(r.pending_count || 0);
        totalPending += p;
        return {
          chatId: String(r.chat_id),
          pending: p,
          oldestPendingAt: r.oldest_pending_at ? Number(r.oldest_pending_at) : null,
          newestPendingAt: r.newest_pending_at ? Number(r.newest_pending_at) : null
        };
      }).sort((a, b) => (b.pending - a.pending) || ((a.oldestPendingAt || 0) - (b.oldestPendingAt || 0)));

      return {
        chats,
        totalPending,
        hasExpiredLocks: Array.isArray(lockRes?.results) && lockRes.results.length > 0,
        hasPendingReactions: Array.isArray(reactRes?.results) && reactRes.results.length > 0
      };
    } catch (_e) {
      return { chats: [], totalPending: 0, hasExpiredLocks: false, hasPendingReactions: false };
    }
  }

  async function countPendingChannelIngestInD1(env, filterChatId = null) {
    const db = await ensureD1Schema(env);
    if (!db) return 0;
    try {
      trackStat("d1Reads");
      const row = filterChatId
        ? await db.prepare("SELECT COUNT(*) AS cnt FROM channel_ingest_inbox WHERE status = 'pending' AND chat_id = ?1").bind(String(filterChatId)).first()
        : await db.prepare("SELECT COUNT(*) AS cnt FROM channel_ingest_inbox WHERE status = 'pending'").first();
      return Number(row?.cnt || 0);
    } catch (_e) {
      return 0;
    }
  }

  // ============================================================================
  // HISTORY CRAWLER & SORTIERTES THEMEN-ARCHIV — D1 KONFIGURATION & FAST-PROBE
  // ============================================================================
  const HISTORY_ARCHIVE_SETTINGS_KEY = "history_archive_settings_v1";

  function parseHistoryChannelRow(r) {
    if (!r) return null;
    let pendingDeleteIds = [];
    let verifiedCaps = null;
    try {
      const parsedDel = JSON.parse(r.pending_delete_ids_json || "[]");
      if (Array.isArray(parsedDel)) {
        pendingDeleteIds = parsedDel.map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0);
      }
    } catch (_e) {}
    try {
      if (r.verified_caps_json) {
        verifiedCaps = JSON.parse(r.verified_caps_json);
      }
    } catch (_e) {}
    return {
      channelId: String(r.channel_id || ""),
      label: String(r.label || ""),
      role: r.role === "archive_forum" ? "archive_forum" : "probe_index",
      enabled: Number(r.enabled || 0) === 1,
      nextAllowedAt: Number(r.next_allowed_at || 0),
      cooldownUntil: Number(r.cooldown_until || 0),
      pendingDeleteIds,
      pendingDeleteCount: pendingDeleteIds.length,
      lastVerifiedAt: Number(r.last_verified_at || 0),
      verifiedCaps,
      updatedAt: Number(r.updated_at || 0)
    };
  }

  async function getHistoryIndexChannelsFromD1(env, options = {}) {
    const db = await ensureD1Schema(env);
    if (!db) return [];
    const roleFilter = options.role === "probe_index" || options.role === "archive_forum" ? options.role : null;
    const onlyEnabled = Boolean(options.onlyEnabled || options.enabledOnly);
    try {
      trackStat("d1Reads");
      let sql = `SELECT channel_id, label, role, enabled, next_allowed_at, cooldown_until, pending_delete_ids_json, last_verified_at, verified_caps_json, updated_at
                 FROM history_index_channels`;
      const binds = [];
      const clauses = [];
      if (roleFilter) {
        clauses.push(`role = ?${binds.length + 1}`);
        binds.push(roleFilter);
      }
      if (onlyEnabled) {
        clauses.push(`enabled = 1`);
      }
      if (clauses.length > 0) sql += ` WHERE ${clauses.join(" AND ")}`;
      sql += ` ORDER BY role DESC, updated_at ASC`;
      const stmt = binds.length > 0 ? db.prepare(sql).bind(...binds) : db.prepare(sql);
      const res = await stmt.all();
      return (res?.results || []).map(parseHistoryChannelRow).filter(Boolean);
    } catch (_e) {
      return [];
    }
  }

  async function getHistoryArchiveDefaultsFromD1(env) {
    const fallback = {
      topicMode: "type_genre",
      timing: "live",
      pinSeriesCard: false,
      maxSeriesTopics: 250,
      notifyAdminDm: true,
      autoUpdateAzIndex: true
    };
    const db = await ensureD1Schema(env);
    if (!db) return fallback;
    try {
      trackStat("d1Reads");
      const row = await db.prepare("SELECT data_json FROM entity_cache WHERE cache_key = ?1").bind(HISTORY_ARCHIVE_SETTINGS_KEY).first();
      if (!row?.data_json) return fallback;
      const parsed = JSON.parse(row.data_json);
      const validModes = new Set(["type_genre", "per_series_plus_genre", "compact_type"]);
      const validTimings = new Set(["live", "after_scan"]);
      return {
        topicMode: validModes.has(parsed?.topicMode) ? parsed.topicMode : "type_genre",
        timing: validTimings.has(parsed?.timing) ? parsed.timing : "live",
        pinSeriesCard: Boolean(parsed?.pinSeriesCard),
        maxSeriesTopics: Math.max(10, Math.min(1000, Number(parsed?.maxSeriesTopics || 250))),
        notifyAdminDm: parsed?.notifyAdminDm !== false,
        autoUpdateAzIndex: parsed?.autoUpdateAzIndex !== false
      };
    } catch (_e) {
      return fallback;
    }
  }

  async function saveHistoryIndexChannelsInD1(env, { probeChannels = [], archiveForum = null, archiveDefaults = null } = {}) {
    const db = await ensureD1Schema(env);
    if (!db) return { ok: false, error: "D1 Datenbank nicht verfügbar." };
    const now = Date.now();
    const cleanProbeList = [];
    const seenIds = new Set();

    for (const item of (Array.isArray(probeChannels) ? probeChannels : [])) {
      const cid = String(item?.channelId || "").trim();
      if (!cid) continue;
      if (!/^-\d{5,20}$/.test(cid)) {
        return { ok: false, error: `Ungültige Index-Kanal-ID: ${cid}. Erwartet wird eine numerische Kanal-/Gruppen-ID (z. B. -100...).` };
      }
      if (seenIds.has(cid)) continue;
      seenIds.add(cid);
      cleanProbeList.push({
        channelId: cid,
        label: String(item?.label || "").replace(/\s+/g, " ").trim().slice(0, 80) || `Index-Kanal ${cleanProbeList.length + 1}`,
        role: "probe_index",
        enabled: item?.enabled !== false ? 1 : 0
      });
      if (cleanProbeList.length >= 3) break;
    }

    let cleanArchive = null;
    if (archiveForum && String(archiveForum.channelId || "").trim()) {
      const acid = String(archiveForum.channelId).trim();
      if (!/^-\d{5,20}$/.test(acid)) {
        return { ok: false, error: `Ungültige Themen-Archiv-ID: ${acid}. Erwartet wird eine numerische Supergruppen-ID (z. B. -100...).` };
      }
      if (seenIds.has(acid)) {
        return { ok: false, error: "Das Themen-Archiv darf nicht dieselbe Chat-ID wie ein Index-Kanal mit Auto-Löschung haben." };
      }
      seenIds.add(acid);
      cleanArchive = {
        channelId: acid,
        label: String(archiveForum.label || "").replace(/\s+/g, " ").trim().slice(0, 80) || "Sortiertes Themen-Archiv",
        role: "archive_forum",
        enabled: archiveForum.enabled !== false ? 1 : 0
      };
    }

    const desiredRows = [...cleanProbeList, ...(cleanArchive ? [cleanArchive] : [])];
    const desiredIds = new Set(desiredRows.map(r => r.channelId));
    const existing = await getHistoryIndexChannelsFromD1(env);
    const toRemove = existing.filter(e => !desiredIds.has(e.channelId) && e.pendingDeleteCount === 0);
    const toDisableWithPendingDeletes = existing.filter(e => !desiredIds.has(e.channelId) && e.pendingDeleteCount > 0);

    try {
      const stmts = [];
      for (const r of desiredRows) {
        stmts.push(
          db.prepare(
            `INSERT INTO history_index_channels
             (channel_id, label, role, enabled, next_allowed_at, cooldown_until, pending_delete_ids_json, last_verified_at, verified_caps_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, 0, '[]', 0, NULL, ?5)
             ON CONFLICT(channel_id) DO UPDATE SET
               label = excluded.label,
               role = excluded.role,
               enabled = excluded.enabled,
               updated_at = excluded.updated_at`
          ).bind(r.channelId, r.label, r.role, r.enabled, now)
        );
      }
      for (const rem of toRemove) {
        stmts.push(db.prepare("DELETE FROM history_index_channels WHERE channel_id = ?1").bind(rem.channelId));
      }
      for (const dis of toDisableWithPendingDeletes) {
        stmts.push(db.prepare("UPDATE history_index_channels SET enabled = 0, updated_at = ?2 WHERE channel_id = ?1").bind(dis.channelId, now));
      }

      if (archiveDefaults && typeof archiveDefaults === "object") {
        const validModes = new Set(["type_genre", "per_series_plus_genre", "compact_type"]);
        const validTimings = new Set(["live", "after_scan"]);
        const cleanDefaults = {
          topicMode: validModes.has(archiveDefaults.topicMode) ? archiveDefaults.topicMode : "type_genre",
          timing: validTimings.has(archiveDefaults.timing) ? archiveDefaults.timing : "live",
          pinSeriesCard: Boolean(archiveDefaults.pinSeriesCard),
          maxSeriesTopics: Math.max(10, Math.min(1000, Number(archiveDefaults.maxSeriesTopics || 250))),
          notifyAdminDm: archiveDefaults.notifyAdminDm !== false,
          autoUpdateAzIndex: archiveDefaults.autoUpdateAzIndex !== false
        };
        stmts.push(
          db.prepare(
            `INSERT INTO entity_cache (cache_key, entity_type, data_json, updated_at)
             VALUES (?1, 'system', ?2, ?3)
             ON CONFLICT(cache_key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`
          ).bind(HISTORY_ARCHIVE_SETTINGS_KEY, JSON.stringify(cleanDefaults), now)
        );
      }

      if (stmts.length > 0) {
        trackStat("d1Writes");
        const rawDb = getRawD1Binding(env) || db;
        if (rawDb && typeof rawDb.batch === "function") {
          await rawDb.batch(unwrapRawD1Statements(stmts));
        } else {
          for (const st of stmts) await st.run();
        }
      }
      memoryFallback.delete("history_blocked_chat_ids_v1");
      const savedChannels = await getHistoryIndexChannelsFromD1(env);
      const savedDefaults = await getHistoryArchiveDefaultsFromD1(env);
      return {
        ok: true,
        probeChannels: savedChannels.filter(c => c.role === "probe_index"),
        archiveForum: savedChannels.find(c => c.role === "archive_forum") || null,
        archiveDefaults: savedDefaults
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || "Konnte History-Konfiguration nicht speichern.") };
    }
  }

  async function updateHistoryIndexChannelVerificationInD1(env, channelId, { verifiedAt = Date.now(), caps = null, label = null } = {}) {
    const db = await ensureD1Schema(env);
    if (!db || !channelId) return false;
    try {
      trackStat("d1Writes");
      const capsJson = caps ? JSON.stringify(caps).slice(0, 2000) : null;
      if (label && String(label).trim()) {
        await db.prepare(
          `UPDATE history_index_channels
           SET last_verified_at = ?2, verified_caps_json = ?3, label = COALESCE(NULLIF(label, ''), ?4), updated_at = ?2
           WHERE channel_id = ?1`
        ).bind(String(channelId), Number(verifiedAt), capsJson, String(label).trim().slice(0, 80)).run();
      } else {
        await db.prepare(
          `UPDATE history_index_channels
           SET last_verified_at = ?2, verified_caps_json = ?3, updated_at = ?2
           WHERE channel_id = ?1`
        ).bind(String(channelId), Number(verifiedAt), capsJson).run();
      }
      return true;
    } catch (_e) {
      return false;
    }
  }

  // Webhook-Loop-Blacklist: 60s RAM-gecached (0 extra D1-Reads pro Live-Webhook!)
  async function getHistorySystemBlockedChatIds(env, forceRefresh = false) {
    const cacheKey = "history_blocked_chat_ids_v1";
    const now = Date.now();
    if (!forceRefresh) {
      const cached = memoryFallback.get(cacheKey);
      if (cached && cached.ids instanceof Set && (now - cached.ts) < 60000) {
        return cached.ids;
      }
    }
    const channels = await getHistoryIndexChannelsFromD1(env);
    const idSet = new Set(channels.map(c => String(c.channelId)));
    memoryFallback.set(cacheKey, { ids: idSet, ts: now });
    return idSet;
  }

  async function isHistorySystemBlockedChat(env, chatId) {
    const cid = String(chatId || "").trim();
    if (!cid) return false;
    const blocked = await getHistorySystemBlockedChatIds(env, false);
    return blocked.has(cid);
  }

  // O(1)-Leerlauf-Fast-Probe für 2-Min-Cron: 1 gebündelter D1-Batch, 0 D1-Writes im Leerlauf!
  async function getHistorySystemCronFastProbeFromD1(env, now = Date.now()) {
    const db = await ensureD1Schema(env);
    if (!db) {
      return { hasActiveOrQueuedJob: false, activeJob: null, hasPendingArchive: false, hasPendingProbeDeletes: false };
    }
    try {
      trackStat("d1Reads");
      const rawDb = getRawD1Binding(env) || db;
      const jobStmt = db.prepare(
        `SELECT id, source_chat_id, status, cron_enabled, worker_lease_until, flood_until
         FROM history_crawl_jobs
         WHERE status IN ('running', 'queued', 'flood_wait')
         ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'flood_wait' THEN 1 ELSE 2 END, id ASC
         LIMIT 1`
      );
      const archStmt = db.prepare(
        `SELECT 1 AS hit FROM archive_mirror_queue WHERE status = 'pending' AND next_attempt_at <= ?1 LIMIT 1`
      ).bind(Number(now));
      const cleanupStmt = db.prepare(
        `SELECT 1 AS hit FROM history_index_channels WHERE pending_delete_ids_json IS NOT NULL AND pending_delete_ids_json != '[]' LIMIT 1`
      );

      let jobRes, archRes, cleanupRes;
      if (rawDb && typeof rawDb.batch === "function") {
        const out = await rawDb.batch(unwrapRawD1Statements([jobStmt, archStmt, cleanupStmt]));
        jobRes = out?.[0];
        archRes = out?.[1];
        cleanupRes = out?.[2];
      } else {
        [jobRes, archRes, cleanupRes] = await Promise.all([jobStmt.all(), archStmt.all(), cleanupStmt.all()]);
      }
      const activeJobRow = jobRes?.results?.[0] || null;
      return {
        hasActiveOrQueuedJob: Boolean(activeJobRow),
        activeJob: activeJobRow
          ? {
              id: Number(activeJobRow.id),
              sourceChatId: String(activeJobRow.source_chat_id),
              status: String(activeJobRow.status),
              cronEnabled: Number(activeJobRow.cron_enabled || 0) === 1,
              workerLeaseUntil: Number(activeJobRow.worker_lease_until || 0),
              floodUntil: Number(activeJobRow.flood_until || 0)
            }
          : null,
        hasPendingArchive: Array.isArray(archRes?.results) && archRes.results.length > 0,
        hasPendingProbeDeletes: Array.isArray(cleanupRes?.results) && cleanupRes.results.length > 0
      };
    } catch (_e) {
      return { hasActiveOrQueuedJob: false, activeJob: null, hasPendingArchive: false, hasPendingProbeDeletes: false };
    }
  }

  // ============================================================================
  // SCHRITT 2: HISTORY CRAWL JOBS, D1-VORAB-SKIP, BACKPRESSURE & STAGING-GATE
  // ============================================================================
  const HISTORY_REVERSE_BLOCK_SIZE = 50;

  function computeReverseBlockCeiling(startMsgId, endMsgId, chunkFloorId) {
    const start = Number(startMsgId);
    const end = Number(endMsgId);
    const floor = Number(chunkFloorId);
    if (floor > start) {
      return Math.min(end, floor + HISTORY_REVERSE_BLOCK_SIZE - 1);
    }
    const totalSpan = Math.max(1, end - start + 1);
    if (totalSpan <= HISTORY_REVERSE_BLOCK_SIZE) return end;
    return Math.min(end, start + ((totalSpan - 1) % HISTORY_REVERSE_BLOCK_SIZE));
  }

  function parseHistoryJobRow(r) {
    if (!r) return null;
    const startMsgId = Number(r.start_msg_id || 1);
    const endMsgId = Number(r.end_msg_id || startMsgId);
    const totalSpan = Math.max(1, endMsgId - startMsgId + 1);
    const scannedCount = Number(r.scanned_count || 0);
    const skippedExistingCount = Number(r.skipped_existing_count || 0);
    const completedIds = Math.min(totalSpan, scannedCount + skippedExistingCount);
    const progressPct = r.status === "completed"
      ? 100
      : Math.min(99.9, Math.round((completedIds / totalSpan) * 1000) / 10);
    return {
      id: Number(r.id),
      sourceChatId: String(r.source_chat_id || ""),
      sourceTitle: String(r.source_title || r.source_chat_id || ""),
      startMsgId,
      endMsgId,
      totalSpan,
      direction: r.direction === "desc" ? "desc" : "asc",
      currentCursorId: Number(r.current_cursor_id || startMsgId),
      chunkFloorId: Number(r.chunk_floor_id || startMsgId),
      status: String(r.status || "queued"),
      enableReactions: Number(r.enable_reactions || 0) === 1,
      enableArchiveMirror: Number(r.enable_archive_mirror || 0) === 1,
      archiveTopicMode: String(r.archive_topic_mode || "type_genre"),
      archiveTiming: r.archive_timing === "after_scan" ? "after_scan" : "live",
      archivePinSeriesCard: Number(r.archive_pin_series_card || 0) === 1,
      archiveMaxSeriesTopics: Math.max(10, Math.min(1000, Number(r.archive_max_series_topics || 250))),
      cronEnabled: Number(r.cron_enabled || 0) === 1,
      scannedCount,
      mediaFoundCount: Number(r.media_found_count || 0),
      contextFoundCount: Number(r.context_found_count || 0),
      missingCount: Number(r.missing_count || 0),
      skippedExistingCount,
      noiseSkippedCount: Number(r.noise_skipped_count || 0),
      errorCount: Number(r.error_count || 0),
      progressPct,
      workerLeaseUntil: Number(r.worker_lease_until || 0),
      floodUntil: Number(r.flood_until || 0),
      lastError: r.last_error ? String(r.last_error) : "",
      createdByAdminId: r.created_by_admin_id ? String(r.created_by_admin_id).trim() : "",
      notifyFlags: r.notify_flags ? String(r.notify_flags).trim() : "",
      createdAt: Number(r.created_at || 0),
      updatedAt: Number(r.updated_at || 0),
      completedAt: Number(r.completed_at || 0)
    };
  }

  async function listHistoryCrawlJobsFromD1(env, limit = 30) {
    const db = await ensureD1Schema(env);
    if (!db) return [];
    const safeLimit = Math.max(1, Math.min(100, Number(limit || 30)));
    try {
      trackStat("d1Reads");
      const res = await db.prepare(
        `SELECT * FROM history_crawl_jobs
         ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'flood_wait' THEN 1 WHEN 'queued' THEN 2 WHEN 'paused' THEN 3 ELSE 4 END, id DESC
         LIMIT ?1`
      ).bind(safeLimit).all();
      return (res?.results || []).map(parseHistoryJobRow).filter(Boolean);
    } catch (_e) {
      return [];
    }
  }

  async function getHistoryCrawlJobByIdFromD1(env, jobId) {
    const db = await ensureD1Schema(env);
    const jid = Number(jobId);
    if (!db || !Number.isInteger(jid) || jid <= 0) return null;
    try {
      trackStat("d1Reads");
      const row = await db.prepare("SELECT * FROM history_crawl_jobs WHERE id = ?1").bind(jid).first();
      return parseHistoryJobRow(row);
    } catch (_e) {
      return null;
    }
  }

  // Serielle Multi-Job-Queue: gibt laufenden Job zurück oder aktiviert automatisch den ältesten wartenden ('queued') Job
  async function getActiveOrNextQueuedHistoryJobFromD1(env, options = {}) {
    const db = await ensureD1Schema(env);
    if (!db) return null;
    const requestedJobId = Number(options.jobId || 0);
    const onlyCronEnabled = Boolean(options.onlyCronEnabled);
    const now = Number(options.now || Date.now());
    try {
      trackStat("d1Reads");
      if (requestedJobId > 0) {
        const specific = await db.prepare("SELECT * FROM history_crawl_jobs WHERE id = ?1").bind(requestedJobId).first();
        return parseHistoryJobRow(specific);
      }
      const activeSql = onlyCronEnabled
        ? `SELECT * FROM history_crawl_jobs WHERE status IN ('running', 'flood_wait') AND cron_enabled = 1 ORDER BY id ASC LIMIT 1`
        : `SELECT * FROM history_crawl_jobs WHERE status IN ('running', 'flood_wait') ORDER BY id ASC LIMIT 1`;
      const activeRow = await db.prepare(activeSql).first();
      if (activeRow) {
        const parsed = parseHistoryJobRow(activeRow);
        if (parsed.status === "flood_wait" && parsed.floodUntil <= now) {
          trackStat("d1Writes");
          await db.prepare("UPDATE history_crawl_jobs SET status = 'running', updated_at = ?2 WHERE id = ?1").bind(parsed.id, now).run();
          parsed.status = "running";
        }
        return parsed;
      }
      // Prüfen, ob überhaupt irgendein anderer Job noch aktiv ist (auch wenn cron_enabled = 0 -> max. 1 Job gleichzeitig!)
      if (onlyCronEnabled) {
        const anyActive = await db.prepare("SELECT id FROM history_crawl_jobs WHERE status IN ('running', 'flood_wait') LIMIT 1").first();
        if (anyActive) return null;
      }
      const queuedSql = onlyCronEnabled
        ? `SELECT * FROM history_crawl_jobs WHERE status = 'queued' AND cron_enabled = 1 ORDER BY id ASC LIMIT 1`
        : `SELECT * FROM history_crawl_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1`;
      const nextQueued = await db.prepare(queuedSql).first();
      if (!nextQueued) return null;
      trackStat("d1Writes");
      await db.prepare("UPDATE history_crawl_jobs SET status = 'running', updated_at = ?2 WHERE id = ?1 AND status = 'queued'")
        .bind(Number(nextQueued.id), now)
        .run();
      const activated = parseHistoryJobRow(nextQueued);
      activated.status = "running";
      activated.updatedAt = now;
      return activated;
    } catch (_e) {
      return null;
    }
  }

  async function createHistoryCrawlJobInD1(env, payload = {}) {
    const db = await ensureD1Schema(env);
    if (!db) return { ok: false, error: "D1 Datenbank nicht verfügbar." };
    const sourceChatId = String(payload.sourceChatId || "").trim();
    if (!/^-\d{5,20}$/.test(sourceChatId)) {
      return { ok: false, error: "Ungültige Quell-Chat-ID (numerische -100... ID erforderlich)." };
    }
    const startMsgId = Number(payload.startMsgId);
    const endMsgId = Number(payload.endMsgId);
    if (!Number.isInteger(startMsgId) || !Number.isInteger(endMsgId) || startMsgId < 1 || endMsgId < startMsgId || endMsgId > 2000000000) {
      return { ok: false, error: "Ungültiger ID-Bereich (Von muss >= 1 und <= Bis sein)." };
    }
    const direction = payload.direction === "desc" ? "desc" : "asc";
    const initialFloor = direction === "desc"
      ? Math.max(startMsgId, endMsgId - HISTORY_REVERSE_BLOCK_SIZE + 1)
      : startMsgId;
    const initialCursor = initialFloor;
    const now = Date.now();
    const validModes = new Set(["type_genre", "per_series_plus_genre", "compact_type"]);
    const archiveTopicMode = validModes.has(payload.archiveTopicMode) ? payload.archiveTopicMode : "type_genre";
    const archiveTiming = payload.archiveTiming === "after_scan" ? "after_scan" : "live";
    const archiveMaxSeriesTopics = Math.max(10, Math.min(1000, Number(payload.archiveMaxSeriesTopics || 250)));

    try {
      const existingActive = await db.prepare("SELECT id FROM history_crawl_jobs WHERE status IN ('running', 'flood_wait') LIMIT 1").first();
      const initialStatus = existingActive ? "queued" : "running";
      const rawAdminId = String(payload.createdByAdminId || "").trim();
      const safeAdminId = /^\d{5,20}$/.test(rawAdminId) ? rawAdminId : "";
      trackStat("d1Writes");
      const res = await db.prepare(
        `INSERT INTO history_crawl_jobs
         (source_chat_id, source_title, start_msg_id, end_msg_id, direction, current_cursor_id, chunk_floor_id, status,
          enable_reactions, enable_archive_mirror, archive_topic_mode, archive_timing, archive_pin_series_card, archive_max_series_topics,
          cron_enabled, created_by_admin_id, notify_flags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, '', ?17, ?17)`
      ).bind(
        sourceChatId,
        String(payload.sourceTitle || sourceChatId).replace(/\s+/g, " ").trim().slice(0, 120),
        startMsgId,
        endMsgId,
        direction,
        initialCursor,
        initialFloor,
        initialStatus,
        payload.enableReactions ? 1 : 0,
        payload.enableArchiveMirror ? 1 : 0,
        archiveTopicMode,
        archiveTiming,
        payload.archivePinSeriesCard ? 1 : 0,
        archiveMaxSeriesTopics,
        payload.cronEnabled !== false ? 1 : 0,
        safeAdminId,
        now
      ).run();
      const newId = Number(res?.meta?.last_row_id || 0);
      const job = newId > 0 ? await getHistoryCrawlJobByIdFromD1(env, newId) : null;
      return { ok: true, job };
    } catch (e) {
      return { ok: false, error: String(e?.message || "Job konnte nicht angelegt werden.") };
    }
  }

  async function updateHistoryCrawlJobStateInD1(env, jobId, patch = {}) {
    const db = await ensureD1Schema(env);
    const jid = Number(jobId);
    if (!db || !Number.isInteger(jid) || jid <= 0) return false;
    const now = Number(patch.now || Date.now());
    const sets = ["updated_at = ?1"];
    const binds = [now];
    const addSet = (expr, val) => {
      binds.push(val);
      sets.push(`${expr} = ?${binds.length}`);
    };
    const addInc = (col, delta) => {
      const n = Number(delta || 0);
      if (!n) return;
      binds.push(n);
      sets.push(`${col} = ${col} + ?${binds.length}`);
    };

    if (typeof patch.status === "string" && patch.status) addSet("status", patch.status);
    if (Number.isInteger(patch.currentCursorId)) addSet("current_cursor_id", patch.currentCursorId);
    if (Number.isInteger(patch.chunkFloorId)) addSet("chunk_floor_id", patch.chunkFloorId);
    if (Number.isFinite(patch.workerLeaseUntil)) addSet("worker_lease_until", Math.max(0, Math.floor(patch.workerLeaseUntil)));
    if (Number.isFinite(patch.floodUntil)) addSet("flood_until", Math.max(0, Math.floor(patch.floodUntil)));
    if (typeof patch.lastError === "string") addSet("last_error", patch.lastError.slice(0, 400));
    if (typeof patch.notifyFlags === "string") addSet("notify_flags", patch.notifyFlags.slice(0, 200));
    if (Number.isFinite(patch.completedAt)) addSet("completed_at", Math.max(0, Math.floor(patch.completedAt)));
    if (typeof patch.cronEnabled === "boolean") addSet("cron_enabled", patch.cronEnabled ? 1 : 0);

    addInc("scanned_count", patch.incScanned);
    addInc("media_found_count", patch.incMediaFound);
    addInc("context_found_count", patch.incContextFound);
    addInc("missing_count", patch.incMissing);
    addInc("skipped_existing_count", patch.incSkippedExisting);
    addInc("noise_skipped_count", patch.incNoiseSkipped);
    addInc("error_count", patch.incErrors);

    binds.push(jid);
    try {
      trackStat("d1Writes");
      await db.prepare(`UPDATE history_crawl_jobs SET ${sets.join(", ")} WHERE id = ?${binds.length}`).bind(...binds).run();
      return true;
    } catch (_e) {
      return false;
    }
  }

  // D1-Vorab-Skip: 1 leichter Covering-Index-Query überspringt bereits gescannte IDs mit 0 Telegram-Calls!
  async function getExistingInboxMessageIdsInRangeFromD1(env, chatId, minMsgId, maxMsgId) {
    const db = await ensureD1Schema(env);
    const out = new Set();
    if (!db || !chatId || minMsgId > maxMsgId) return out;
    try {
      trackStat("d1Reads");
      const res = await db.prepare(
        `SELECT message_id FROM channel_ingest_inbox
         WHERE chat_id = ?1 AND message_id >= ?2 AND message_id <= ?3`
      ).bind(String(chatId), Number(minMsgId), Number(maxMsgId)).all();
      for (const r of (res?.results || [])) {
        const mid = Number(r?.message_id || 0);
        if (mid > 0) out.add(mid);
      }
    } catch (_e) {}
    return out;
  }

  // Backpressure-Zähler: zählt offene History-Zeilen ('pending'/'staging') für einen Quell-Chat
  async function countOpenHistoryInboxRowsInD1(env, sourceChatId) {
    const db = await ensureD1Schema(env);
    if (!db || !sourceChatId) return 0;
    try {
      trackStat("d1Reads");
      const row = await db.prepare(
        `SELECT COUNT(*) AS cnt FROM channel_ingest_inbox
         WHERE chat_id = ?1 AND status IN ('pending', 'staging') AND ingest_priority < 10`
      ).bind(String(sourceChatId)).first();
      return Number(row?.cnt || 0);
    } catch (_e) {
      return 0;
    }
  }

  // 1x D1-Batch-Insert für gecrawlte History-Nachrichten (strikte Zeitstempel-Trennung: created_at = Date.now(), payload.date_unixtime = Originaldatum)
  async function bulkInsertHistoryInboxRowsInD1(env, records = []) {
    const db = await ensureD1Schema(env);
    if (!db || !Array.isArray(records) || records.length === 0) return { ok: true, inserted: 0 };
    const stmts = [];
    for (const rec of records) {
      if (!rec || !rec.chatId || !rec.messageId || !rec.payload) continue;
      stmts.push(
        db.prepare(
          `INSERT OR IGNORE INTO channel_ingest_inbox
           (chat_id, chat_title, message_id, reply_to_message_id, media_group_id, msg_kind, payload_json, status, locked_until, reaction_pending, created_at, processed_at, ingest_priority, suppress_reaction, source_job_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, ?9, 0, 1, ?10, ?11)`
        ).bind(
          String(rec.chatId),
          String(rec.chatTitle || "").slice(0, 120),
          Number(rec.messageId),
          rec.replyToMessageId ? Number(rec.replyToMessageId) : null,
          rec.mediaGroupId ? String(rec.mediaGroupId).slice(0, 64) : null,
          String(rec.msgKind || "context"),
          JSON.stringify(rec.payload),
          rec.initialStatus === "pending" ? "pending" : "staging",
          Number(rec.createdAt || Date.now()),
          rec.suppressReaction ? 1 : 0,
          Number(rec.sourceJobId || 0)
        )
      );
    }
    if (stmts.length === 0) return { ok: true, inserted: 0 };
    try {
      trackStat("d1Writes");
      const rawDb = getRawD1Binding(env) || db;
      let inserted = 0;
      if (rawDb && typeof rawDb.batch === "function") {
        const resArr = await rawDb.batch(unwrapRawD1Statements(stmts));
        for (const r of (resArr || [])) inserted += Number(r?.meta?.changes || 0);
      } else {
        for (const st of stmts) {
          const r = await st.run();
          inserted += Number(r?.meta?.changes || 0);
        }
      }
      return { ok: true, inserted };
    } catch (e) {
      return { ok: false, inserted: 0, error: String(e?.message || "Bulk-Insert in Inbox fehlgeschlagen") };
    }
  }

  // Kontext-treues staging → pending Gate (Vorwärts: hält offene Nachlauf-Header; Rückwärts: hält führende Videos ohne Poster bis Vorblock da ist!)
  async function promoteHistoryStagingRowsToPendingInD1(env, jobId, options = {}) {
    const db = await ensureD1Schema(env);
    const jid = Number(jobId);
    if (!db || !Number.isInteger(jid) || jid <= 0) return 0;
    const promoteAll = Boolean(options.promoteAll);
    const direction = options.direction === "desc" ? "desc" : "asc";
    const now = Number(options.now || Date.now());

    try {
      if (promoteAll) {
        trackStat("d1Writes");
        const res = await db.prepare(
          `UPDATE channel_ingest_inbox
           SET status = 'pending', created_at = ?2
           WHERE source_job_id = ?1 AND status = 'staging'`
        ).bind(jid, now).run();
        return Number(res?.meta?.changes || 0);
      }

      trackStat("d1Reads");
      const sel = await db.prepare(
        `SELECT id, message_id, msg_kind, media_group_id, payload_json
         FROM channel_ingest_inbox
         WHERE source_job_id = ?1 AND status = 'staging'
         ORDER BY message_id ASC
         LIMIT 250`
      ).bind(jid).all();
      const rows = sel?.results || [];
      if (rows.length === 0) return 0;

      let promoteIds = [];
      if (direction === "asc") {
        // Vorwärts: Nachlaufende reine Kontext-Header oder eine offene Media-Group ganz am Ende zurückhalten
        let cut = rows.length;
        const tailGrp = rows[cut - 1]?.media_group_id;
        if (tailGrp) {
          let gStart = cut - 1;
          while (gStart > 0 && rows[gStart - 1]?.media_group_id === tailGrp) gStart--;
          if (gStart > 0) cut = gStart;
        }
        while (cut > 0 && rows[cut - 1]?.msg_kind === "context") {
          cut--;
        }
        promoteIds = rows.slice(0, cut).map(r => Number(r.id)).filter(n => n > 0);
      } else {
        // Rückwärts-Block abgeschlossen: ersten Kontext-Anker (Poster/Text-Header oder >= 15 IDs / >= 10 Min Lücke) suchen
        // und alles AB diesem Anker nach oben freigeben — führende Videos davor warten in 'staging' auf den direkt darunterliegenden Block!
        let anchorIdx = -1;
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].msg_kind === "context") {
            anchorIdx = i;
            break;
          }
          if (i > 0) {
            const idGap = Number(rows[i].message_id) - Number(rows[i - 1].message_id);
            let timeGapSec = 0;
            try {
              const pPrev = JSON.parse(rows[i - 1].payload_json || "{}");
              const pCur = JSON.parse(rows[i].payload_json || "{}");
              const tPrev = Number(pPrev.date_unixtime || 0);
              const tCur = Number(pCur.date_unixtime || 0);
              if (tPrev > 0 && tCur > 0) timeGapSec = Math.abs(tCur - tPrev);
            } catch (_e) {}
            if (idGap >= 15 || timeGapSec >= 600) {
              anchorIdx = i;
              break;
            }
          }
        }
        // Sicherheits-Überlauf: falls in > 100 staging-Zeilen gar kein Poster-Anker existiert, ältesten Teil ab Hälfte freigeben
        if (anchorIdx < 0 && rows.length >= 100) {
          anchorIdx = Math.floor(rows.length / 2);
        }
        if (anchorIdx >= 0) {
          promoteIds = rows.slice(anchorIdx).map(r => Number(r.id)).filter(n => n > 0);
        }
      }

      if (promoteIds.length === 0) return 0;
      trackStat("d1Writes");
      const rawDb = getRawD1Binding(env) || db;
      const stmts = [];
      for (let i = 0; i < promoteIds.length; i += 80) {
        const part = promoteIds.slice(i, i + 80);
        const placeholders = part.map((_, idx) => `?${idx + 2}`).join(", ");
        stmts.push(
          db.prepare(
            `UPDATE channel_ingest_inbox SET status = 'pending', created_at = ?1 WHERE id IN (${placeholders}) AND status = 'staging'`
          ).bind(now, ...part)
        );
      }
      let promoted = 0;
      if (stmts.length > 1 && rawDb && typeof rawDb.batch === "function") {
        const resArr = await rawDb.batch(unwrapRawD1Statements(stmts));
        for (const r of (resArr || [])) promoted += Number(r?.meta?.changes || 0);
      } else {
        for (const st of stmts) {
          const r = await st.run();
          promoted += Number(r?.meta?.changes || 0);
        }
      }
      return promoted;
    } catch (_e) {
      return 0;
    }
  }

  async function updateHistoryChannelsRuntimeInD1(env, channelUpdates = []) {
    const db = await ensureD1Schema(env);
    if (!db || !Array.isArray(channelUpdates) || channelUpdates.length === 0) return false;
    const now = Date.now();
    const stmts = [];
    for (const u of channelUpdates) {
      if (!u || !u.channelId) continue;
      const cleanPendingIds = Array.from(
        new Set((Array.isArray(u.pendingDeleteIds) ? u.pendingDeleteIds : []).map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0))
      ).slice(0, 500);
      stmts.push(
        db.prepare(
          `UPDATE history_index_channels
           SET next_allowed_at = ?2, cooldown_until = ?3, pending_delete_ids_json = ?4, updated_at = ?5
           WHERE channel_id = ?1`
        ).bind(
          String(u.channelId),
          Math.max(0, Math.floor(Number(u.nextAllowedAt || 0))),
          Math.max(0, Math.floor(Number(u.cooldownUntil || 0))),
          JSON.stringify(cleanPendingIds),
          now
        )
      );
    }
    if (stmts.length === 0) return false;
    try {
      trackStat("d1Writes");
      const rawDb = getRawD1Binding(env) || db;
      if (stmts.length > 1 && rawDb && typeof rawDb.batch === "function") {
        await rawDb.batch(unwrapRawD1Statements(stmts));
      } else {
        for (const st of stmts) await st.run();
      }
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function deleteHistoryCrawlJobInD1(env, jobId) {
    const db = await ensureD1Schema(env);
    const jid = Number(jobId);
    if (!db || !Number.isInteger(jid) || jid <= 0) return false;
    try {
      trackStat("d1Writes");
      const rawDb = getRawD1Binding(env) || db;
      const stmts = [
        db.prepare("DELETE FROM channel_ingest_inbox WHERE source_job_id = ?1 AND status = 'staging'").bind(jid),
        db.prepare("DELETE FROM archive_mirror_queue WHERE job_id = ?1 AND status = 'held_until_scan'").bind(jid),
        db.prepare("DELETE FROM history_crawl_jobs WHERE id = ?1").bind(jid)
      ];
      if (rawDb && typeof rawDb.batch === "function") {
        await rawDb.batch(unwrapRawD1Statements(stmts));
      } else {
        for (const st of stmts) await st.run();
      }
      return true;
    } catch (_e) {
      return false;
    }
  }

  // =========================================================================
  // STUFE C: OPTIONALES SORTIERTES THEMEN-ARCHIV (D1 QUEUE & TOPIC-MAP)
  // =========================================================================
  function parseArchiveMirrorRow(r) {
    if (!r) return null;
    return {
      id: Number(r.id || 0),
      jobId: Number(r.job_id || 0),
      archiveChatId: String(r.archive_chat_id || ""),
      mediaType: String(r.media_type || "movie"),
      tmdbId: Number(r.tmdb_id || 0),
      seasonNumber: Number(r.season_number || 0),
      episodeNumber: Number(r.episode_number || 0),
      partNumber: Number(r.part_number || 1),
      sourceChatId: String(r.source_chat_id || ""),
      sourceMessageId: Number(r.source_message_id || 0),
      fileUniqueId: String(r.file_unique_id || ""),
      fileId: String(r.file_id || ""),
      fileKind: String(r.file_kind || "video"),
      topicKey: String(r.topic_key || ""),
      topicName: String(r.topic_name || ""),
      topicIconColor: Number(r.topic_icon_color || 0),
      seriesHeaderHtml: String(r.series_header_html || ""),
      seriesPosterUrl: String(r.series_poster_url || ""),
      captionHtml: String(r.caption_html || ""),
      coverUrl: String(r.cover_url || ""),
      status: String(r.status || "pending"),
      archiveMessageId: Number(r.archive_message_id || 0),
      archiveThreadId: Number(r.archive_thread_id || 0),
      attempts: Number(r.attempts || 0),
      nextAttemptAt: Number(r.next_attempt_at || 0),
      lastError: String(r.last_error || ""),
      createdAt: Number(r.created_at || 0),
      updatedAt: Number(r.updated_at || 0)
    };
  }

  async function enqueueArchiveMirrorItemsInD1(env, items = []) {
    const db = await ensureD1Schema(env);
    if (!db || !Array.isArray(items) || items.length === 0) return { ok: true, inserted: 0 };
    const now = Date.now();
    const stmts = [];
    for (const it of items) {
      if (!it || !it.archiveChatId || !it.fileUniqueId || !it.fileId || !it.topicKey || !it.captionHtml) continue;
      const status = it.status === "held_until_scan" ? "held_until_scan" : "pending";
      stmts.push(
        db.prepare(
          `INSERT OR IGNORE INTO archive_mirror_queue (
            job_id, archive_chat_id, media_type, tmdb_id, season_number, episode_number, part_number,
            source_chat_id, source_message_id, file_unique_id, file_id, file_kind,
            topic_key, topic_name, topic_icon_color, series_header_html, series_poster_url,
            caption_html, cover_url, status, archive_message_id, archive_thread_id,
            attempts, next_attempt_at, last_error, created_at, updated_at
          ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7,
            ?8, ?9, ?10, ?11, ?12,
            ?13, ?14, ?15, ?16, ?17,
            ?18, ?19, ?20, 0, 0,
            0, 0, '', ?21, ?21
          )`
        ).bind(
          Number(it.jobId || 0),
          String(it.archiveChatId),
          it.mediaType === "series" ? "series" : "movie",
          Math.max(0, Math.floor(Number(it.tmdbId || 0))),
          Math.max(0, Math.floor(Number(it.seasonNumber || 0))),
          Math.max(0, Math.floor(Number(it.episodeNumber || 0))),
          Math.max(1, Math.floor(Number(it.partNumber || 1))),
          String(it.sourceChatId || ""),
          Math.max(0, Math.floor(Number(it.sourceMessageId || 0))),
          String(it.fileUniqueId).slice(0, 180),
          String(it.fileId).slice(0, 320),
          it.fileKind === "document" ? "document" : "video",
          String(it.topicKey).slice(0, 96),
          String(it.topicName || "").slice(0, 128),
          Math.max(0, Math.floor(Number(it.topicIconColor || 0))),
          String(it.seriesHeaderHtml || "").slice(0, 1020),
          String(it.seriesPosterUrl || "").slice(0, 500),
          String(it.captionHtml).slice(0, 1020),
          String(it.coverUrl || "").slice(0, 500),
          status,
          now
        )
      );
    }
    if (stmts.length === 0) return { ok: true, inserted: 0 };
    try {
      trackStat("d1Writes");
      const rawDb = getRawD1Binding(env) || db;
      let inserted = 0;
      if (rawDb && typeof rawDb.batch === "function") {
        const resArr = await rawDb.batch(unwrapRawD1Statements(stmts));
        for (const r of (resArr || [])) inserted += Number(r?.meta?.changes || 0);
      } else {
        for (const st of stmts) {
          const r = await st.run();
          inserted += Number(r?.meta?.changes || 0);
        }
      }
      return { ok: true, inserted };
    } catch (e) {
      return { ok: false, inserted: 0, error: String(e?.message || "Archiv-Queue-Insert fehlgeschlagen") };
    }
  }

  async function releaseHeldArchiveMirrorItemsForJobInD1(env, jobId, now = Date.now(), options = {}) {
    const db = await ensureD1Schema(env);
    if (!db) return 0;
    const jid = Number(jobId || 0);
    const releaseAll = Boolean(options?.releaseAll) || jid <= 0;
    try {
      trackStat("d1Writes");
      const res = releaseAll
        ? await db.prepare(
            `UPDATE archive_mirror_queue
             SET status = 'pending', next_attempt_at = 0, updated_at = ?1
             WHERE status = 'held_until_scan'`
          ).bind(now).run()
        : await db.prepare(
            `UPDATE archive_mirror_queue
             SET status = 'pending', next_attempt_at = 0, updated_at = ?2
             WHERE job_id = ?1 AND status = 'held_until_scan'`
          ).bind(jid, now).run();
      return Number(res?.meta?.changes || 0);
    } catch (_e) {
      return 0;
    }
  }

  async function claimPendingArchiveMirrorBatchFromD1(env, limit = 6, now = Date.now(), archiveChatId = "") {
    const db = await ensureD1Schema(env);
    if (!db) return [];
    const safeLimit = Math.max(1, Math.min(20, Number(limit || 6)));
    const cid = String(archiveChatId || "").trim();
    try {
      trackStat("d1Reads");
      const res = cid
        ? await db.prepare(
            `SELECT * FROM archive_mirror_queue
             WHERE archive_chat_id = ?1 AND status = 'pending' AND next_attempt_at <= ?2
             ORDER BY media_type ASC, tmdb_id ASC, season_number ASC, episode_number ASC, part_number ASC, id ASC
             LIMIT ?3`
          ).bind(cid, now, safeLimit).all()
        : await db.prepare(
            `SELECT * FROM archive_mirror_queue
             WHERE status = 'pending' AND next_attempt_at <= ?1
             ORDER BY media_type ASC, tmdb_id ASC, season_number ASC, episode_number ASC, part_number ASC, id ASC
             LIMIT ?2`
          ).bind(now, safeLimit).all();
      return (res?.results || []).map(parseArchiveMirrorRow).filter(Boolean);
    } catch (_e) {
      return [];
    }
  }

  async function getArchiveTopicFromD1(env, archiveChatId, topicKey) {
    const db = await ensureD1Schema(env);
    const cid = String(archiveChatId || "").trim();
    const key = String(topicKey || "").trim();
    if (!db || !cid || !key) return null;
    try {
      trackStat("d1Reads");
      const r = await db.prepare(
        `SELECT archive_chat_id, topic_key, message_thread_id, topic_name, icon_color, pinned_header_msg_id, updated_at
         FROM archive_topic_map
         WHERE archive_chat_id = ?1 AND topic_key = ?2
         LIMIT 1`
      ).bind(cid, key).first();
      if (!r) return null;
      return {
        archiveChatId: String(r.archive_chat_id),
        topicKey: String(r.topic_key),
        messageThreadId: Number(r.message_thread_id || 0),
        topicName: String(r.topic_name || ""),
        iconColor: Number(r.icon_color || 0),
        pinnedHeaderMsgId: Number(r.pinned_header_msg_id || 0),
        updatedAt: Number(r.updated_at || 0)
      };
    } catch (_e) {
      return null;
    }
  }

  async function countSeriesTopicsInArchiveFromD1(env, archiveChatId) {
    const db = await ensureD1Schema(env);
    const cid = String(archiveChatId || "").trim();
    if (!db || !cid) return 0;
    try {
      trackStat("d1Reads");
      const r = await db.prepare(
        `SELECT COUNT(*) AS cnt FROM archive_topic_map
         WHERE archive_chat_id = ?1
           AND topic_key LIKE 'series_%'
           AND topic_key NOT LIKE 'series_genre_%'
           AND topic_key != 'series_archive_overflow'
           AND topic_key != 'archive_directory'`
      ).bind(cid).first();
      return Number(r?.cnt || 0);
    } catch (_e) {
      return 0;
    }
  }

  async function getArchiveDirectoryDataFromD1(env, archiveChatId) {
    const db = await ensureD1Schema(env);
    const cid = String(archiveChatId || "").trim();
    if (!db || !cid) return { topics: [], countsByTopicKey: {}, totalPostedFiles: 0 };
    try {
      trackStat("d1Reads");
      trackStat("d1Reads");
      const [topicsRes, countsRes] = await Promise.all([
        db.prepare(
          `SELECT archive_chat_id, topic_key, message_thread_id, topic_name, icon_color, pinned_header_msg_id, updated_at
           FROM archive_topic_map
           WHERE archive_chat_id = ?1 AND topic_key != 'archive_directory'
           ORDER BY topic_name ASC
           LIMIT 500`
        ).bind(cid).all(),
        db.prepare(
          `SELECT topic_key, COUNT(*) AS posted_count
           FROM archive_mirror_queue
           WHERE archive_chat_id = ?1 AND status = 'posted'
           GROUP BY topic_key`
        ).bind(cid).all()
      ]);
      const countsByTopicKey = {};
      let totalPostedFiles = 0;
      for (const r of (countsRes?.results || [])) {
        const k = String(r?.topic_key || "").trim();
        const cnt = Number(r?.posted_count || 0);
        if (k) countsByTopicKey[k] = cnt;
        totalPostedFiles += cnt;
      }
      const topics = (topicsRes?.results || []).map(r => ({
        archiveChatId: String(r.archive_chat_id),
        topicKey: String(r.topic_key),
        messageThreadId: Number(r.message_thread_id || 0),
        topicName: String(r.topic_name || r.topic_key || ""),
        iconColor: Number(r.icon_color || 0),
        pinnedHeaderMsgId: Number(r.pinned_header_msg_id || 0),
        postedCount: Number(countsByTopicKey[String(r.topic_key)] || 0),
        updatedAt: Number(r.updated_at || 0)
      })).filter(t => t.messageThreadId > 0);
      return { topics, countsByTopicKey, totalPostedFiles };
    } catch (_e) {
      return { topics: [], countsByTopicKey: {}, totalPostedFiles: 0 };
    }
  }

  async function upsertArchiveTopicInD1(env, rec = {}) {
    const db = await ensureD1Schema(env);
    const cid = String(rec.archiveChatId || "").trim();
    const key = String(rec.topicKey || "").trim();
    const threadId = Number(rec.messageThreadId || 0);
    if (!db || !cid || !key || threadId <= 0) return false;
    try {
      trackStat("d1Writes");
      await db.prepare(
        `INSERT INTO archive_topic_map (
          archive_chat_id, topic_key, message_thread_id, topic_name, icon_color, pinned_header_msg_id, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(archive_chat_id, topic_key) DO UPDATE SET
          message_thread_id = excluded.message_thread_id,
          topic_name = CASE WHEN excluded.topic_name != '' THEN excluded.topic_name ELSE archive_topic_map.topic_name END,
          icon_color = CASE WHEN excluded.icon_color > 0 THEN excluded.icon_color ELSE archive_topic_map.icon_color END,
          pinned_header_msg_id = CASE WHEN excluded.pinned_header_msg_id > 0 THEN excluded.pinned_header_msg_id ELSE archive_topic_map.pinned_header_msg_id END,
          updated_at = excluded.updated_at`
      ).bind(
        cid,
        key,
        threadId,
        String(rec.topicName || "").slice(0, 128),
        Math.max(0, Math.floor(Number(rec.iconColor || 0))),
        Math.max(0, Math.floor(Number(rec.pinnedHeaderMsgId || 0))),
        Number(rec.updatedAt || Date.now())
      ).run();
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function deleteArchiveTopicFromD1(env, archiveChatId, topicKey) {
    const db = await ensureD1Schema(env);
    const cid = String(archiveChatId || "").trim();
    const key = String(topicKey || "").trim();
    if (!db || !cid || !key) return false;
    try {
      trackStat("d1Writes");
      await db.prepare(
        "DELETE FROM archive_topic_map WHERE archive_chat_id = ?1 AND topic_key = ?2"
      ).bind(cid, key).run();
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function listArchiveTopicsFromD1(env, archiveChatId = "", limit = 80) {
    const db = await ensureD1Schema(env);
    if (!db) return [];
    const safeLimit = Math.max(1, Math.min(200, Number(limit || 80)));
    const cid = String(archiveChatId || "").trim();
    try {
      trackStat("d1Reads");
      const res = cid
        ? await db.prepare(
            `SELECT archive_chat_id, topic_key, message_thread_id, topic_name, icon_color, pinned_header_msg_id, updated_at
             FROM archive_topic_map
             WHERE archive_chat_id = ?1
             ORDER BY updated_at DESC
             LIMIT ?2`
          ).bind(cid, safeLimit).all()
        : await db.prepare(
            `SELECT archive_chat_id, topic_key, message_thread_id, topic_name, icon_color, pinned_header_msg_id, updated_at
             FROM archive_topic_map
             ORDER BY updated_at DESC
             LIMIT ?1`
          ).bind(safeLimit).all();
      return (res?.results || []).map(r => ({
        archiveChatId: String(r.archive_chat_id),
        topicKey: String(r.topic_key),
        messageThreadId: Number(r.message_thread_id || 0),
        topicName: String(r.topic_name || ""),
        iconColor: Number(r.icon_color || 0),
        pinnedHeaderMsgId: Number(r.pinned_header_msg_id || 0),
        updatedAt: Number(r.updated_at || 0)
      }));
    } catch (_e) {
      return [];
    }
  }

  async function markArchiveMirrorItemResultInD1(env, id, patch = {}) {
    const db = await ensureD1Schema(env);
    const itemId = Number(id);
    if (!db || !Number.isInteger(itemId) || itemId <= 0) return false;
    const sets = ["updated_at = ?1"];
    const binds = [Number(patch.now || Date.now())];
    const pushSet = (expr, val) => {
      binds.push(val);
      sets.push(`${expr} = ?${binds.length}`);
    };
    if (patch.status) pushSet("status", String(patch.status));
    if (patch.archiveMessageId !== undefined) pushSet("archive_message_id", Math.max(0, Math.floor(Number(patch.archiveMessageId || 0))));
    if (patch.archiveThreadId !== undefined) pushSet("archive_thread_id", Math.max(0, Math.floor(Number(patch.archiveThreadId || 0))));
    if (patch.topicKey !== undefined) pushSet("topic_key", String(patch.topicKey).slice(0, 96));
    if (patch.topicName !== undefined) pushSet("topic_name", String(patch.topicName).slice(0, 128));
    if (patch.attempts !== undefined) pushSet("attempts", Math.max(0, Math.floor(Number(patch.attempts || 0))));
    if (patch.nextAttemptAt !== undefined) pushSet("next_attempt_at", Math.max(0, Math.floor(Number(patch.nextAttemptAt || 0))));
    if (patch.lastError !== undefined) pushSet("last_error", String(patch.lastError || "").slice(0, 400));
    binds.push(itemId);
    try {
      trackStat("d1Writes");
      await db.prepare(`UPDATE archive_mirror_queue SET ${sets.join(", ")} WHERE id = ?${binds.length}`).bind(...binds).run();
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function getArchiveMirrorStatsFromD1(env, archiveChatId = "") {
    const db = await ensureD1Schema(env);
    const stats = { pending: 0, held: 0, posted: 0, failed: 0, total: 0, topicCount: 0 };
    if (!db) return stats;
    const cid = String(archiveChatId || "").trim();
    try {
      trackStat("d1Reads");
      const rawDb = getRawD1Binding(env) || db;
      const stQueue = cid
        ? db.prepare("SELECT status, COUNT(*) AS cnt FROM archive_mirror_queue WHERE archive_chat_id = ?1 GROUP BY status").bind(cid)
        : db.prepare("SELECT status, COUNT(*) AS cnt FROM archive_mirror_queue GROUP BY status");
      const stTopics = cid
        ? db.prepare("SELECT COUNT(*) AS cnt FROM archive_topic_map WHERE archive_chat_id = ?1").bind(cid)
        : db.prepare("SELECT COUNT(*) AS cnt FROM archive_topic_map");
      let qRows = [];
      let tCount = 0;
      if (rawDb && typeof rawDb.batch === "function") {
        const resArr = await rawDb.batch(unwrapRawD1Statements([stQueue, stTopics]));
        qRows = resArr?.[0]?.results || [];
        tCount = Number(resArr?.[1]?.results?.[0]?.cnt || 0);
      } else {
        const r1 = await stQueue.all();
        const r2 = await stTopics.first();
        qRows = r1?.results || [];
        tCount = Number(r2?.cnt || 0);
      }
      for (const row of qRows) {
        const st = String(row.status || "");
        const cnt = Number(row.cnt || 0);
        stats.total += cnt;
        if (st === "pending") stats.pending += cnt;
        else if (st === "held_until_scan") stats.held += cnt;
        else if (st === "posted") stats.posted += cnt;
        else if (st === "failed") stats.failed += cnt;
      }
      stats.topicCount = tCount;
      return stats;
    } catch (_e) {
      return stats;
    }
  }

  async function retryFailedArchiveMirrorItemsInD1(env, archiveChatId = "") {
    const db = await ensureD1Schema(env);
    if (!db) return 0;
    const cid = String(archiveChatId || "").trim();
    const now = Date.now();
    try {
      trackStat("d1Writes");
      const res = cid
        ? await db.prepare(
            `UPDATE archive_mirror_queue
             SET status = 'pending', attempts = 0, next_attempt_at = 0, last_error = '', updated_at = ?2
             WHERE archive_chat_id = ?1 AND status = 'failed'`
          ).bind(cid, now).run()
        : await db.prepare(
            `UPDATE archive_mirror_queue
             SET status = 'pending', attempts = 0, next_attempt_at = 0, last_error = '', updated_at = ?1
             WHERE status = 'failed'`
          ).bind(now).run();
      return Number(res?.meta?.changes || 0);
    } catch (_e) {
      return 0;
    }
  }

  async function listRecentArchivedItemsFromD1(env, archiveChatId = "", limit = 25) {
    const db = await ensureD1Schema(env);
    if (!db) return [];
    const safeLimit = Math.max(1, Math.min(60, Number(limit || 25)));
    const cid = String(archiveChatId || "").trim();
    try {
      trackStat("d1Reads");
      const res = cid
        ? await db.prepare(
            `SELECT id, job_id, archive_chat_id, media_type, tmdb_id, season_number, episode_number, part_number,
                    topic_key, topic_name, status, archive_message_id, archive_thread_id, attempts, last_error, updated_at
             FROM archive_mirror_queue
             WHERE archive_chat_id = ?1 AND status IN ('posted', 'failed')
             ORDER BY updated_at DESC
             LIMIT ?2`
          ).bind(cid, safeLimit).all()
        : await db.prepare(
            `SELECT id, job_id, archive_chat_id, media_type, tmdb_id, season_number, episode_number, part_number,
                    topic_key, topic_name, status, archive_message_id, archive_thread_id, attempts, last_error, updated_at
             FROM archive_mirror_queue
             WHERE status IN ('posted', 'failed')
             ORDER BY updated_at DESC
             LIMIT ?1`
          ).bind(safeLimit).all();
      return (res?.results || []).map(r => {
        const rawForumNum = String(r.archive_chat_id || "").replace(/^-100/, "").replace(/^-/, "");
        const msgId = Number(r.archive_message_id || 0);
        const threadId = Number(r.archive_thread_id || 0);
        const telegramLink = (rawForumNum && msgId > 0)
          ? (threadId > 0 ? `https://t.me/c/${rawForumNum}/${threadId}/${msgId}` : `https://t.me/c/${rawForumNum}/${msgId}`)
          : "";
        return {
          id: Number(r.id || 0),
          jobId: Number(r.job_id || 0),
          archiveChatId: String(r.archive_chat_id || ""),
          mediaType: String(r.media_type || "movie"),
          tmdbId: Number(r.tmdb_id || 0),
          seasonNumber: Number(r.season_number || 0),
          episodeNumber: Number(r.episode_number || 0),
          partNumber: Number(r.part_number || 1),
          topicKey: String(r.topic_key || ""),
          topicName: String(r.topic_name || ""),
          status: String(r.status || ""),
          archiveMessageId: msgId,
          archiveThreadId: threadId,
          telegramLink,
          attempts: Number(r.attempts || 0),
          lastError: String(r.last_error || ""),
          updatedAt: Number(r.updated_at || 0)
        };
      });
    } catch (_e) {
      return [];
    }
  }

