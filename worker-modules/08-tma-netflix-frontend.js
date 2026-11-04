  // @DEPARTMENT: 08-tma-netflix-frontend | 8. STREAMFLIX Netflix Mini-App (TMA) Frontend & Auth-Crypto
  // @ANCHOR: TMA_ROUTES
  // @ANCHOR: TMA_AUTH_SECURITY
  // ============================================================================
  // NETFLIX-STYLE TELEGRAM MINI APP (TMA) API, SECURITY & FRONTEND ROUTER
  // - HMAC-SHA256 Telegram initData Validierung (Web Crypto API)
  // - Automatische User-Registrierung beim 1. Besuch in D1 (users)
  // - Account-Absicherung (Username + PBKDF2-Passwort) für Login ohne initData
  // - Strikter Gast-Modus ohne initData & ohne Account (kein Speicher, kein ID-Zugriff)
  // - Admin-Panel (VIP-Status Toggle & Film/Serien CRUD in D1)
  // ============================================================================
  function buildTmaCorsHeaders() {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Init-Data, X-Tma-Settings",
      "Content-Type": "application/json; charset=utf-8"
    };
  }

  function bytesToHex(bytes) {
    return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function hexToBytes(hex) {
    const clean = String(hex || "").trim();
    if (!clean || clean.length % 2 !== 0) return new Uint8Array(0);
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      out[i / 2] = parseInt(clean.slice(i, i + 2), 16) || 0;
    }
    return out;
  }

  // Offizielle Telegram Mini App HMAC-SHA256 Validierung von initData (Web Crypto API)
  async function verifyTelegramInitDataHmac(rawInitData, botToken) {
    if (!rawInitData || !botToken) return { ok: false, error: "Fehlende initData oder Bot-Token" };
    try {
      const params = new URLSearchParams(String(rawInitData));
      const receivedHash = params.get("hash");
      if (!receivedHash) return { ok: false, error: "Kein Hash in initData" };

      const pairs = [];
      for (const [k, v] of params.entries()) {
        if (k === "hash") continue;
        pairs.push(`${k}=${v}`);
      }
      pairs.sort();
      const dataCheckString = pairs.join("\n");

      const enc = new TextEncoder();
      const secretKeyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode("WebAppData"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const secretKeyBuf = await crypto.subtle.sign("HMAC", secretKeyMaterial, enc.encode(String(botToken).trim()));

      const validationKey = await crypto.subtle.importKey(
        "raw",
        secretKeyBuf,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sigBuf = await crypto.subtle.sign("HMAC", validationKey, enc.encode(dataCheckString));
      const calculatedHash = bytesToHex(sigBuf);

      if (calculatedHash.toLowerCase() !== String(receivedHash).toLowerCase()) {
        return { ok: false, error: "Ungültige Telegram initData Signatur" };
      }

      const userRaw = params.get("user");
      const userObj = userRaw ? JSON.parse(userRaw) : null;
      if (!userObj || !userObj.id) {
        return { ok: false, error: "Kein gültiges User-Objekt in initData" };
      }
      return { ok: true, user: userObj };
    } catch (e) {
      return { ok: false, error: "Fehler bei initData-Prüfung" };
    }
  }

  // PBKDF2-SHA256 Passwort-Hashing (Cloudflare Workers Web Crypto Standard)
  async function hashPasswordPbkdf2(password, existingSaltHex = null) {
    const enc = new TextEncoder();
    let saltBytes;
    if (existingSaltHex) {
      saltBytes = hexToBytes(existingSaltHex);
    } else {
      saltBytes = new Uint8Array(16);
      crypto.getRandomValues(saltBytes);
    }
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(String(password)),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );
    return {
      hashHex: bytesToHex(derivedBits),
      saltHex: bytesToHex(saltBytes)
    };
  }

  async function verifyPasswordPbkdf2(password, saltHex, expectedHashHex) {
    if (!password || !saltHex || !expectedHashHex) return false;
    const { hashHex } = await hashPasswordPbkdf2(password, saltHex);
    return hashHex.toLowerCase() === String(expectedHashHex).toLowerCase();
  }

  // RFC 6238 TOTP (Google Authenticator / Authy kompatibel) via Web Crypto API (HMAC-SHA1)
  const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function generateBase32TotpSecret(length = 32) {
    const rand = new Uint8Array(length);
    crypto.getRandomValues(rand);
    let out = "";
    for (let i = 0; i < length; i++) {
      out += BASE32_ALPHABET[rand[i] % 32];
    }
    return out;
  }

  function decodeBase32ToBytes(base32Str) {
    const clean = String(base32Str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
    let bits = 0;
    let value = 0;
    const output = [];
    for (let i = 0; i < clean.length; i++) {
      const idx = BASE32_ALPHABET.indexOf(clean[i]);
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(output);
  }

  async function computeHotpCode(secretBytes, counter) {
    const counterBuf = new ArrayBuffer(8);
    const view = new DataView(counterBuf);
    const high = Math.floor(counter / 0x100000000);
    const low = counter >>> 0;
    view.setUint32(0, high, false);
    view.setUint32(4, low, false);

    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"]
    );
    const hmacBuf = await crypto.subtle.sign("HMAC", key, counterBuf);
    const hmac = new Uint8Array(hmacBuf);
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    const otp = binary % 1000000;
    return String(otp).padStart(6, "0");
  }

  async function verifyTotpCode(base32Secret, codeStr, windowSteps = 1) {
    const cleanCode = String(codeStr || "").replace(/\s+/g, "").trim();
    if (!base32Secret || !/^\d{6}$/.test(cleanCode)) return false;
    const secretBytes = decodeBase32ToBytes(base32Secret);
    if (!secretBytes.length) return false;
    const currentCounter = Math.floor(Date.now() / 30000);
    for (let step = -windowSteps; step <= windowSteps; step++) {
      const candidate = await computeHotpCode(secretBytes, currentCounter + step);
      if (candidate === cleanCode) return true;
    }
    return false;
  }

  function buildOtpAuthUri(secret, accountLabel, issuer = "StreamFlix TMA") {
    const cleanIssuer = String(issuer || "StreamFlix TMA").trim();
    const cleanAccount = String(accountLabel || "User").trim();
    const label = `${encodeURIComponent(cleanIssuer)}:${encodeURIComponent(cleanAccount)}`;
    const otpauthUrl = `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(cleanIssuer)}&algorithm=SHA1&digits=6&period=30`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encodeURIComponent(otpauthUrl)}`;
    return { otpauthUrl, qrCodeUrl };
  }

  function getSessionSigningSecret(env) {
    return String(env?.JWT_SECRET || env?.TELEGRAM_WEBHOOK_SECRET || env?.TELEGRAM_BOT_TOKEN || "streamflix_default_worker_secret_key");
  }

  async function signTmaSessionToken(payload, env) {
    const enc = new TextEncoder();
    const dataObj = {
      ...payload,
      iat: Date.now(),
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 Tage gültig
    };
    const jsonBytes = enc.encode(JSON.stringify(dataObj));
    const payloadHex = bytesToHex(jsonBytes);
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(getSessionSigningSecret(env)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadHex));
    return `${payloadHex}.${bytesToHex(sigBuf)}`;
  }

  async function verifyTmaSessionToken(token, env) {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    try {
      const [payloadHex, sigHex] = token.split(".");
      if (!payloadHex || !sigHex) return null;
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(getSessionSigningSecret(env)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const expectedSigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadHex));
      const expectedSigHex = bytesToHex(expectedSigBuf);
      if (expectedSigHex.toLowerCase() !== sigHex.toLowerCase()) return null;

      const jsonStr = new TextDecoder().decode(hexToBytes(payloadHex));
      const data = JSON.parse(jsonStr);
      if (!data || !data.telegramId || (data.exp && Date.now() > Number(data.exp))) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  // Zentrale Auth-Weiche für alle TMA-Requests:
  // 1. Prüft gültiges Session-Token (Authorization: Bearer ...)
  // 2. Oder prüft kryptografisch signiertes Telegram initData (X-Telegram-Init-Data)
  // 3. Ohne beides -> Strikter Gast-Modus (chatId = "guest", kein Speicher, kein Zugriff auf fremde IDs!)
  async function resolveTmaAuthContext(request, env) {
    const authHeader = request.headers.get("Authorization") || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (bearerToken) {
      const verifiedToken = await verifyTmaSessionToken(bearerToken, env);
      if (verifiedToken && verifiedToken.telegramId) {
        const dbRow = await getUserByTelegramIdFromD1(env, verifiedToken.telegramId);
        const userProfile = formatUserRowForClient(
          dbRow || {
            telegram_id: verifiedToken.telegramId,
            tg_username: verifiedToken.tgUsername || "",
            first_name: verifiedToken.firstName || ""
          },
          env
        );
        return {
          isAuthenticated: true,
          isGuest: false,
          authMethod: verifiedToken.authMethod || "token",
          hasInitData: Boolean(verifiedToken.hasInitData),
          chatId: String(verifiedToken.telegramId),
          user: userProfile
        };
      }
    }

    const rawInitData = request.headers.get("X-Telegram-Init-Data") || "";
    if (rawInitData && env?.TELEGRAM_BOT_TOKEN) {
      const verifiedInit = await verifyTelegramInitDataHmac(rawInitData, env.TELEGRAM_BOT_TOKEN);
      if (verifiedInit.ok && verifiedInit.user) {
        const userProfile = await upsertTelegramUserInD1(env, verifiedInit.user);
        return {
          isAuthenticated: true,
          isGuest: false,
          authMethod: "initData",
          hasInitData: true,
          chatId: String(verifiedInit.user.id),
          user: userProfile
        };
      }
    }

    // Kein gültiges initData & kein eingeloggter Account -> Gast-Modus ohne Speicher!
    return {
      isAuthenticated: false,
      isGuest: true,
      authMethod: "guest",
      hasInitData: false,
      chatId: "guest",
      user: null
    };
  }

  // Optionale TMDB-Account-Synchronisierung (Watchlist & Favoriten <-> Bot Merkliste)
  async function pushSingleItemToTmdbWatchlist(env, chatId, typeCode, tmdbId, watchlistState) {
    try {
      const settings = await getUserSettings(env, chatId);
      const sync = settings?.tmdbSync;
      if (!sync || !sync.enabled || !sync.sessionId || !sync.accountId || !tmdbId) return false;
      const mediaType = typeCode === "s" || typeCode === "series" ? "tv" : "movie";
      const res = await fetchWithTimeout(
        `https://api.themoviedb.org/3/account/${sync.accountId}/watchlist?session_id=${encodeURIComponent(sync.sessionId)}`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}`
          },
          body: JSON.stringify({
            media_type: mediaType,
            media_id: Number(tmdbId),
            watchlist: Boolean(watchlistState)
          })
        },
        4500
      );
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async function syncTmdbAccountWithBotWishlist(env, chatId) {
    const settings = await getUserSettings(env, chatId);
    const sync = settings?.tmdbSync;
    if (!sync || !sync.enabled || !sync.sessionId || !sync.accountId) {
      return { ok: false, error: "Kein aktives TMDB-Konto verbunden." };
    }
    const headers = { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` };
    const sid = encodeURIComponent(sync.sessionId);
    const aid = sync.accountId;

    const [wlMovRes, wlTvRes, favMovRes, favTvRes] = await Promise.all([
      fetchWithTimeout(`https://api.themoviedb.org/3/account/${aid}/watchlist/movies?language=de-DE&session_id=${sid}&sort_by=created_at.desc&page=1`, { headers }, 4500).catch(() => null),
      fetchWithTimeout(`https://api.themoviedb.org/3/account/${aid}/watchlist/tv?language=de-DE&session_id=${sid}&sort_by=created_at.desc&page=1`, { headers }, 4500).catch(() => null),
      fetchWithTimeout(`https://api.themoviedb.org/3/account/${aid}/favorite/movies?language=de-DE&session_id=${sid}&sort_by=created_at.desc&page=1`, { headers }, 4500).catch(() => null),
      fetchWithTimeout(`https://api.themoviedb.org/3/account/${aid}/favorite/tv?language=de-DE&session_id=${sid}&sort_by=created_at.desc&page=1`, { headers }, 4500).catch(() => null)
    ]);

    const wlMov = wlMovRes && wlMovRes.ok ? (await wlMovRes.json()).results || [] : [];
    const wlTv = wlTvRes && wlTvRes.ok ? (await wlTvRes.json()).results || [] : [];
    const favMov = favMovRes && favMovRes.ok ? (await favMovRes.json()).results || [] : [];
    const favTv = favTvRes && favTvRes.ok ? (await favTvRes.json()).results || [] : [];

    const remoteMovies = [...wlMov, ...favMov];
    const remoteSeries = [...wlTv, ...favTv];

    let list = await getSavedList(env, chatId);
    let importedCount = 0;

    for (const m of remoteMovies) {
      if (!m || !m.id) continue;
      const exists = list.some(i => i.contentType === "movie" && String(i.tmdbId) === String(m.id));
      if (!exists) {
        const yr = (m.release_date || "").split("-")[0] || "K. A.";
        list.push({
          uid: `m_${m.id}_cat_movies`,
          tmdbId: m.id,
          contentType: "movie",
          category: "movie",
          title: m.title || m.original_title || `Film #${m.id}`,
          year: yr,
          fsk: "FSK Ungeprüft",
          genres: "TMDB Sync",
          folderId: "cat_movies",
          addedAt: Date.now()
        });
        importedCount++;
      }
    }

    const folders = await getFolders(env, chatId);
    let foldersChanged = false;
    for (const s of remoteSeries) {
      if (!s || !s.id) continue;
      const exists = list.some(i => i.contentType === "series" && String(i.tmdbId) === String(s.id));
      if (!exists) {
        const sTitle = (s.name || s.original_name || `Serie #${s.id}`).trim();
        let sFolder = folders.find(f => f.type === "series_show" && String(f.tmdbRefId) === String(s.id));
        if (!sFolder) {
          sFolder = {
            id: `f_ser_${s.id}`,
            name: sTitle,
            originalName: sTitle,
            tmdbRefId: s.id,
            type: "series_show",
            linked: true,
            createdAt: Date.now()
          };
          folders.push(sFolder);
          foldersChanged = true;
        }
        const yr = (s.first_air_date || "").split("-")[0] || "K. A.";
        list.push({
          uid: `s_${s.id}_${sFolder.id}`,
          tmdbId: s.id,
          contentType: "series",
          category: "series",
          title: sTitle,
          year: yr,
          fsk: "FSK Ungeprüft",
          genres: "TMDB Sync",
          folderId: sFolder.id,
          addedAt: Date.now()
        });
        importedCount++;
      }
    }

    if (foldersChanged) await saveFolders(env, chatId, folders);
    if (importedCount > 0) await saveRawList(env, chatId, list);

    // Push lokale Bot-Merkliste (max. 15 neueste Filme/Serien) zu TMDB Watchlist
    const remoteIds = new Set([
      ...remoteMovies.map(m => `movie_${m.id}`),
      ...remoteSeries.map(s => `tv_${s.id}`)
    ]);
    const localMedia = list.filter(i => (i.contentType === "movie" || i.contentType === "series") && i.tmdbId).slice(-15);
    let pushedCount = 0;
    for (const item of localMedia) {
      const mType = item.contentType === "series" ? "tv" : "movie";
      if (!remoteIds.has(`${mType}_${item.tmdbId}`)) {
        const ok = await pushSingleItemToTmdbWatchlist(env, chatId, item.contentType === "series" ? "s" : "m", item.tmdbId, true);
        if (ok) pushedCount++;
      }
    }

    settings.tmdbSync.lastSyncAt = Date.now();
    await saveUserSettings(env, chatId, settings);
    return { ok: true, importedCount, pushedCount, totalSaved: list.length };
  }

  function renderNetflixMiniAppHtml(workerOrigin) {
    return `<!DOCTYPE html>
  <html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28' fill='none'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='28' y2='28' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='0%25' stop-color='%2338bdf8'/%3E%3Cstop offset='50%25' stop-color='%23a855f7'/%3E%3Cstop offset='100%25' stop-color='%23e50914'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='14' cy='14' r='11.5' stroke='url(%23g)' stroke-width='2.6' stroke-dasharray='18 5'/%3E%3Ccircle cx='14' cy='14' r='7.5' stroke='%2338bdf8' stroke-width='1.5' stroke-opacity='0.8'/%3E%3Cpath d='M11.8 9.8L18.5 14L11.8 18.2V9.8Z' fill='url(%23g)'/%3E%3C/svg%3E" />
    <link rel="alternate icon" type="image/svg+xml" href="/favicon.svg" />
    <title>TelePort – Film & Serien Mini-App</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
      :root {
        --bg: #141414;
        --surface: #18181c;
        --card: #222228;
        --red: #E50914;
        --blue: #0284c7;
        --purple: #5b46f5;
        --text: #FFFFFF;
        --muted: #A3A3A3;
        --inc-bg: rgba(16, 185, 129, 0.22);
        --inc-border: rgba(16, 185, 129, 0.65);
        --inc-text: #6ee7b7;
        --inc-solid: #059669;
        --exc-bg: rgba(239, 68, 68, 0.22);
        --exc-border: rgba(239, 68, 68, 0.65);
        --exc-text: #fca5a5;
        --exc-solid: #dc2626;
        --scale-all: 1;
        --scale-text: 1;
        --scale-cover: 1;
        --scale-menu: 1;
        --sticky-header-height: calc(54px * var(--scale-menu));
        --sticky-header-offset: calc(var(--sticky-header-height) + 20px);
      }
      /* Design-Themen: Light Mode & Cyberpunk Neon */
      body[data-theme="light"] {
        --bg: #f1f5f9;
        --surface: #ffffff;
        --card: #ffffff;
        --text: #0f172a;
        --muted: #475569;
        --inc-bg: rgba(16, 185, 129, 0.14);
        --inc-border: #059669;
        --inc-text: #047857;
        --inc-solid: #059669;
        --exc-bg: rgba(239, 68, 68, 0.12);
        --exc-border: #dc2626;
        --exc-text: #b91c1c;
        --exc-solid: #dc2626;
        color-scheme: light;
      }
      body[data-theme="light"][data-colorblind="1"] {
        --inc-bg: rgba(2, 132, 199, 0.14);
        --inc-border: #0284c7;
        --inc-text: #0369a1;
        --inc-solid: #0284c7;
        --exc-bg: rgba(234, 88, 12, 0.14);
        --exc-border: #ea580c;
        --exc-text: #c2410c;
        --exc-solid: #ea580c;
      }
      body[data-theme="light"] header,
      body[data-theme="light"] .bottom-nav {
        background: rgba(255, 255, 255, 0.96);
        border-color: rgba(15, 23, 42, 0.14);
        box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
      }
      body[data-theme="light"] .btn:not(.red):not(.blue):not(.green):not(.purple):not(.amber):not(.active) {
        background: #f1f5f9;
        color: #0f172a;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .btn:not(.red):not(.blue):not(.green):not(.purple):not(.amber):not(.active):hover {
        background: #e2e8f0;
        color: #0f172a;
        border-color: #94a3b8;
      }
      body[data-theme="light"] .btn.active {
        background: #0f172a;
        color: #ffffff;
        border-color: #0f172a;
      }
      body[data-theme="light"] .media-mode-switch-inline {
        background: #e2e8f0;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .media-mode-tab:not(.active-movie):not(.active-series) {
        color: #334155;
      }
      body[data-theme="light"] .media-mode-tab:not(.active-movie):not(.active-series):hover {
        background: rgba(15, 23, 42, 0.08);
        color: #0f172a;
      }
      body[data-theme="light"] .search-bar {
        background: #ffffff;
        border-color: #cbd5e1;
        box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
      }
      body[data-theme="light"] .search-scope-select {
        background-color: #f1f5f9;
        color: #0f172a;
        border-right-color: #cbd5e1;
        color-scheme: light;
      }
      body[data-theme="light"] .search-input-wrap input {
        color: #0f172a;
      }
      body[data-theme="light"] .search-input-wrap input::placeholder {
        color: #64748b;
      }
      body[data-theme="light"] .search-submit-btn {
        color: #334155;
      }
      body[data-theme="light"] .search-clear-btn {
        background: #e2e8f0;
        border-color: #cbd5e1;
        color: #0f172a;
      }
      body[data-theme="light"] .search-autocomplete-box {
        background: #ffffff;
        border-color: rgba(229, 9, 20, 0.45);
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
      }
      body[data-theme="light"] .ac-item {
        color: #0f172a;
      }
      body[data-theme="light"] .panel-box,
      body[data-theme="light"] .floating-filter-bar,
      body[data-theme="light"] .modal,
      body[data-theme="light"] .sidebar-drawer {
        background: #ffffff;
        color: #0f172a;
        border-color: #cbd5e1;
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
      }
      body[data-theme="light"] .ff-tab-btn:not(.open):not(.has-inc) {
        background: #f1f5f9;
        color: #0f172a;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .ff-tab-btn:not(.open):not(.has-inc):hover {
        background: #e2e8f0;
        border-color: #94a3b8;
      }
      body[data-theme="light"] .sort-select,
      body[data-theme="light"] .mode-filter-select,
      body[data-theme="light"] .new-filter-select {
        background-color: #f1f5f9;
        color: #0f172a;
        border-color: #cbd5e1;
        color-scheme: light;
      }
      body[data-theme="light"] .sort-select:hover,
      body[data-theme="light"] .mode-filter-select:hover,
      body[data-theme="light"] .new-filter-select:hover,
      body[data-theme="light"] .mode-filter-select.active-mode,
      body[data-theme="light"] .new-filter-select.active-new {
        background-color: #fee2e2;
        color: #991b1b;
        border-color: var(--red);
      }
      body[data-theme="light"] .sort-select option,
      body[data-theme="light"] .mode-filter-select option,
      body[data-theme="light"] .new-filter-select option,
      body[data-theme="light"] .search-scope-select option {
        background-color: #ffffff;
        color: #0f172a;
      }
      body[data-theme="light"] .recent-strip-bar {
        background: #ffffff;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .recent-strip-label {
        color: #334155;
      }
      body[data-theme="light"] .recent-chip {
        background: #f8fafc;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .recent-chip:hover {
        background: #e2e8f0;
        border-color: var(--red);
      }
      body[data-theme="light"] .recent-chip-title {
        color: #0f172a;
      }
      body[data-theme="light"] .recent-chip-del {
        background: #e2e8f0;
        color: #334155;
      }
      body[data-theme="light"] .card {
        background: #ffffff;
        border-color: #cbd5e1;
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
      }
      body[data-theme="light"] .card-sub {
        color: #475569;
      }
      body[data-theme="light"] .page-counter-pill {
        background: #f1f5f9;
        color: #0f172a;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .page-jump-btn:not(.active) {
        background: #ffffff;
        color: #0f172a;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .page-jump-btn:not(.active):hover {
        background: #e2e8f0;
      }
      body[data-theme="light"] .sidebar-header {
        background: #f8fafc;
        border-bottom-color: #cbd5e1;
        color: #0f172a;
      }
      body[data-theme="light"] .sidebar-section {
        background: #f8fafc;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .sidebar-sec-title {
        color: #334155;
      }
      body[data-theme="light"] .sidebar-acc-toggle {
        color: #0f172a;
      }
      body[data-theme="light"] .sidebar-acc-toggle:hover {
        background: #e2e8f0;
      }
      body[data-theme="light"] .sidebar-acc-summary {
        color: #475569;
      }
      body[data-theme="light"] .sync-badge {
        background: rgba(16, 185, 129, 0.14);
        border-color: #059669;
        color: #047857;
      }
      body[data-theme="light"] .direct-filter-card {
        background: #ffffff;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .df-btn {
        background: #f1f5f9;
        color: #334155;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .f-pill.neutral {
        background: #f1f5f9;
        color: #0f172a;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .f-pill.neutral:hover {
        background: #e2e8f0;
        border-color: #94a3b8;
      }
      body[data-theme="light"] .detail-meta-grid,
      body[data-theme="light"] .ep-row,
      body[data-theme="light"] .modal-sub-box {
        background: #f8fafc !important;
        border-color: #cbd5e1 !important;
        color: #0f172a !important;
      }
      body[data-theme="light"] .detail-meta-label {
        color: #475569;
      }
      body[data-theme="light"] .stream-meta-pill {
        background: #e2e8f0;
        color: #0f172a;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .section-title,
      body[data-theme="light"] .df-label,
      body[data-theme="light"] .card-title {
        color: #0f172a;
      }
      body[data-theme="light"] .hero {
        margin: 10px 14px 4px;
        border-radius: 16px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.15);
      }
      body[data-theme="light"] .hero::after {
        background:
          linear-gradient(90deg, rgba(10, 14, 24, 0.92) 0%, rgba(10, 14, 24, 0.68) 50%, rgba(10, 14, 24, 0.22) 100%),
          linear-gradient(to top, rgba(10, 14, 24, 0.94) 0%, rgba(10, 14, 24, 0.28) 55%, rgba(10, 14, 24, 0.55) 100%);
      }
      body[data-theme="light"] .hero-collapsed-strip {
        background: #ffffff;
        border-color: #cbd5e1;
        color: #0f172a;
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
      }
      body[data-theme="light"] .hero-collapsed-title {
        color: #0f172a;
      }
      body[data-theme="light"] .hero-collapsed-meta {
        color: #475569;
      }
      body[data-theme="light"] .worlds-portal-tray {
        background: #f8fafc;
        border-top-color: #cbd5e1;
      }
      body[data-theme="light"] .world-portal-card {
        background: #ffffff;
        border-color: #cbd5e1;
        color: #0f172a;
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
      }
      body[data-theme="light"] .world-portal-card:hover,
      body[data-theme="light"] .world-portal-card.spatial-focus {
        background: #f1f5f9;
        border-color: var(--red);
      }
      body[data-theme="light"] .world-portal-name {
        color: #0f172a;
      }
      body[data-theme="light"] .world-portal-sub {
        color: #475569;
      }
      body[data-theme="light"] .worlds-search-input {
        background: #ffffff;
        color: #0f172a;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .modal-hero-banner h2,
      body[data-theme="light"] .modal-hero-banner h2 span {
        color: #ffffff !important;
        text-shadow: 0 2px 12px rgba(0, 0, 0, 0.95) !important;
      }
      body[data-theme="light"] .shortcut-cheat-card {
        background: #f8fafc;
        border-color: #cbd5e1;
        color: #0f172a;
      }
      body[data-theme="light"] .shortcut-cheat-card b {
        color: #0f172a;
      }
      body[data-theme="light"] .shortcut-cheat-card code {
        color: #0284c7;
      }
      body[data-theme="light"] .detail-collapse-btn {
        background: #f8fafc;
        border-color: #cbd5e1;
        color: #0f172a;
      }
      body[data-theme="light"] .scale-label {
        color: #0f172a;
      }
      body[data-theme="light"] .scale-row {
        border-bottom-color: #e2e8f0;
      }
      body[data-theme="cyberpunk"] {
        --bg: #070510;
        --surface: #110b22;
        --card: #191030;
        --red: #ff007f;
        --blue: #00f0ff;
        --purple: #b829ff;
        --text: #f0f6ff;
        --muted: #94a3b8;
      }
      body[data-theme="cyberpunk"] header {
        background: rgba(12, 6, 26, 0.95);
        border-bottom: 1px solid rgba(0, 240, 255, 0.35);
        box-shadow: 0 4px 24px rgba(255, 0, 127, 0.18);
      }
      body[data-theme="cyberpunk"] .card:hover {
        border-color: #00f0ff;
        box-shadow: 0 0 16px rgba(0, 240, 255, 0.35);
      }
      /* Barrierefreier Farbenblind-Modus (Okabe-Ito Blau vs. Orange statt Grün vs. Rot) */
      body[data-colorblind="1"]:not([data-theme="light"]) {
        --inc-bg: rgba(0, 114, 178, 0.28);
        --inc-border: #38bdf8;
        --inc-text: #7dd3fc;
        --inc-solid: #0284c7;
        --exc-bg: rgba(213, 94, 0, 0.28);
        --exc-border: #fb923c;
        --exc-text: #fdba74;
        --exc-solid: #ea580c;
      }
      body[data-colorblind="1"] .f-pill.inc,
      body[data-colorblind="1"] .direct-filter-card.state-inc {
        border-style: solid;
        border-width: 2px;
      }
      body[data-colorblind="1"] .f-pill.exc,
      body[data-colorblind="1"] .direct-filter-card.state-exc {
        border-style: dashed;
        border-width: 2px;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
      html {
        font-size: calc(16px * var(--scale-all));
        scroll-padding-top: var(--sticky-header-offset, 74px);
        scroll-padding-bottom: 28px;
      }
      body {
        background: var(--bg);
        color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding-bottom: 28px;
        overflow-x: hidden;
        font-size: calc(14px * var(--scale-text));
        transition: background-color 0.2s ease, color 0.2s ease;
        scroll-padding-top: var(--sticky-header-offset, 74px);
        scroll-padding-bottom: 28px;
      }
      #appRoot,
      #resultsGridContainer,
      .carousel {
        scroll-padding-top: var(--sticky-header-offset, 74px);
        scroll-padding-bottom: 28px;
      }
      .card,
      .btn,
      .f-pill,
      .ff-tab-btn,
      .world-portal-card,
      .ep-title,
      #searchInput,
      .search-scope-select {
        scroll-margin-top: var(--sticky-header-offset, 74px);
        scroll-margin-bottom: 28px;
      }
      /* Geräte-spezifische automatische Anpassung (User-Agent) */
      body[data-device="tv"] .carousel {
        grid-template-columns: repeat(auto-fill, minmax(calc(155px * var(--scale-cover)), 1fr));
        gap: 14px;
      }
      body[data-device="mobile"] header {
        padding: calc(6px * var(--scale-menu)) calc(8px * var(--scale-menu));
        gap: 5px;
      }
      body[data-device="mobile"] .brand-logo {
        font-size: calc(15.5px * var(--scale-menu));
      }
      body[data-device="mobile"] .carousel {
        grid-template-columns: repeat(auto-fill, minmax(calc(104px * var(--scale-cover)), 1fr));
        gap: 8px;
      }

      /* Klare Fokus-Markierung für Pfeiltasten, Android TV Fernbedienung, Gamepad & Maus-Hover */
      .spatial-focus:not(#searchInput):not(.search-scope-select),
      .brand-logo:focus-visible,
      .btn:focus-visible,
      .card:focus-visible,
      .media-mode-tab:focus-visible,
      .ff-tab-btn:focus-visible,
      .f-pill:focus-visible,
      .sort-chip:focus-visible,
      .df-btn:focus-visible,
      .hero-thumb-card:focus-visible,
      .search-clear-btn:focus-visible {
        outline: 3px solid var(--red) !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(229, 9, 20, 0.42), 0 8px 24px rgba(0, 0, 0, 0.85) !important;
        transform: translateY(-2px) scale(1.02);
        z-index: 25;
      }

      /* Tastatur-/Controller-Modus aktiv: Mauszeiger ausblenden & konkurrierende Hover-Effekte unterdrücken */
      body.kb-nav-active,
      body.kb-nav-active * {
        cursor: none !important;
      }
      body.kb-nav-active .card:hover:not(.spatial-focus) {
        border-color: rgba(255, 255, 255, 0.08);
        transform: none;
        box-shadow: none;
      }
      body[data-theme="light"].kb-nav-active .card:hover:not(.spatial-focus) {
        border-color: #cbd5e1;
        transform: none;
        box-shadow: 0 3px 10px rgba(15, 23, 42, 0.08);
      }

      header {
        position: sticky;
        top: 0;
        z-index: 60;
        background: rgba(18,18,22,0.96);
        backdrop-filter: blur(14px);
        padding: calc(7px * var(--scale-menu)) calc(12px * var(--scale-menu));
        border-bottom: 1px solid rgba(255,255,255,0.09);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: nowrap;
      }
      .brand-wrap { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .brand-logo {
        color: #f8fafc;
        font-weight: 900;
        font-size: calc(15.5px * var(--scale-menu));
        letter-spacing: 0.4px;
        cursor: pointer;
        user-select: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 7px;
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(229, 9, 20, 0.14), rgba(56, 189, 248, 0.12));
        border: 1px solid rgba(255, 255, 255, 0.12);
        transition: background 0.15s, transform 0.12s, border-color 0.15s, box-shadow 0.15s;
        flex-shrink: 0;
      }
      .brand-logo:hover,
      .brand-logo.spatial-focus,
      .brand-logo:focus-visible {
        background: linear-gradient(135deg, rgba(229, 9, 20, 0.28), rgba(56, 189, 248, 0.26));
        border-color: #38bdf8;
      }
      .brand-logo:active { transform: scale(0.96); }
      .teleport-logo-svg {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
        filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.55));
      }
      .teleport-accent {
        background: linear-gradient(135deg, #38bdf8, #a855f7, #e50914);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      @media (max-width: 440px) {
        header {
          padding: 6px 8px;
          gap: 5px;
        }
        .brand-logo {
          font-size: 13.5px;
          padding: 3px 5px;
          gap: 4px;
        }
        .teleport-logo-svg {
          width: 17px;
          height: 17px;
        }
      }
      .sync-badge {
        font-size: calc(10.5px * var(--scale-text));
        color: #34d399;
        background: rgba(16,185,129,0.14);
        border: 1px solid rgba(16,185,129,0.35);
        padding: 4px 8px;
        border-radius: 7px;
        font-weight: 700;
        cursor: pointer;
      }
      .device-badge {
        display: none;
      }
      .nav-btns { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
      .btn {
        background: rgba(255,255,255,0.09);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 7px;
        padding: calc(5.5px * var(--scale-menu)) calc(9px * var(--scale-menu));
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        white-space: nowrap;
        transition: all 0.14s ease;
      }
      .btn:hover { background: rgba(255,255,255,0.16); }
      .btn:active { transform: scale(0.96); }
      .btn.red { background: var(--red); border-color: #ff1f2d; color: #fff; }
      .btn.blue { background: var(--blue); border-color: #38bdf8; color: #fff; }
      .btn.green { background: var(--inc-solid); border-color: var(--inc-border); color: #fff; }
      .btn.purple { background: var(--purple); border-color: #7c69ff; color: #fff; border-radius: 999px; padding: calc(5.5px * var(--scale-menu)) calc(11px * var(--scale-menu)); }
      .btn.amber { background: linear-gradient(135deg, #d97706, #b45309); border-color: #fbbf24; color: #fff; font-weight: 700; }
      .btn.active { background: #fff; color: #000; border-color: #fff; font-weight: 800; }

      /* Linke Off-Canvas Sidebar für Filter, Größe, Themes & Farbenblind-Modus */
      .sidebar-backdrop {
        position: fixed;
        inset: 0;
        z-index: 140;
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(5px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.22s ease;
      }
      .sidebar-backdrop.open {
        opacity: 1;
        pointer-events: auto;
      }
      .sidebar-drawer {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: min(350px, 90vw);
        z-index: 145;
        background: #14141b;
        border-right: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 16px 0 48px rgba(0, 0, 0, 0.85);
        transform: translateX(-104%);
        transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .sidebar-drawer.open {
        transform: translateX(0);
      }
      .sidebar-header {
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.09);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        background: rgba(255, 255, 255, 0.02);
      }
      .sidebar-body {
        flex: 1;
        overflow-y: auto;
        padding: 10px 12px 24px;
        scroll-padding-top: 16px;
        scroll-padding-bottom: 24px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .sidebar-section {
        background: rgba(255, 255, 255, 0.025);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 8px 10px;
      }
      .sidebar-section-title {
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 800;
        color: #cbd5e1;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .sidebar-collapse-btn {
        width: 100%;
        background: transparent;
        border: 0;
        color: #e2e8f0;
        padding: 3px 2px;
        font-size: calc(12px * var(--scale-menu));
        font-weight: 800;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        border-radius: 6px;
        transition: color 0.14s, background 0.14s;
      }
      .sidebar-collapse-btn:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.05);
      }
      .sidebar-collapse-meta {
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        color: #94a3b8;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .scale-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 4px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
      }
      .scale-label {
        font-size: calc(11px * var(--scale-text));
        color: #cbd5e1;
      }
      .scale-opts {
        display: inline-flex;
        gap: 3px;
        flex-wrap: wrap;
      }
      .scale-opts .btn {
        padding: 3px 6px;
        font-size: calc(10.5px * var(--scale-menu));
      }

      /* Schwebender Ladehinweis (position: fixed -> 0px Layout-Shift, kein Seiten-Springen!) */
      #busyOverlayBar {
        position: fixed;
        top: 52px;
        left: 50%;
        transform: translateX(-50%) translateY(-8px);
        z-index: 120;
        display: inline-flex;
        opacity: 0;
        pointer-events: none;
        background: linear-gradient(90deg, rgba(229,9,20,0.96), rgba(91,70,245,0.96));
        color: #fff;
        padding: 5px 14px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.22);
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 700;
        align-items: center;
        justify-content: center;
        gap: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.75);
        transition: opacity 0.18s ease, transform 0.18s ease;
        max-width: 92vw;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #busyOverlayBar.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .spinner {
        width: 13px;
        height: 13px;
        border: 2px solid rgba(255,255,255,0.35);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.65s linear infinite;
        flex-shrink: 0;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .results-busy { transition: opacity 0.18s ease; }

      /* Kompakter Film / Serien Umschalter direkt in der oberen Leiste */
      .media-mode-switch-inline {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: rgba(255,255,255,0.05);
        padding: 2px;
        border-radius: 9px;
        border: 1px solid rgba(255,255,255,0.12);
      }
      .media-mode-tab {
        padding: calc(4.5px * var(--scale-menu)) calc(10px * var(--scale-menu));
        border-radius: 7px;
        border: 1px solid transparent;
        background: transparent;
        color: #a3a3a3;
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 800;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        transition: all 0.15s ease;
      }
      .media-mode-tab:not(:disabled):hover {
        color: #fff;
        background: rgba(255,255,255,0.1);
      }
      .media-mode-tab.active-movie {
        background: linear-gradient(135deg, var(--red), #991b1b);
        color: #fff;
        border-color: #f87171;
        box-shadow: 0 2px 10px rgba(229,9,20,0.4);
      }
      .media-mode-tab.active-series {
        background: linear-gradient(135deg, var(--blue), #1e40af);
        color: #fff;
        border-color: #38bdf8;
        box-shadow: 0 2px 10px rgba(2,132,199,0.4);
      }
      .media-mode-tab:disabled {
        cursor: default !important;
        opacity: 1 !important;
      }

      /* Integrierte, ruhige Suchleiste aus einem Guss (Bereichswähler + Eingabe + Suchlupe) */
      .search-bar-outer {
        position: relative;
        z-index: 55;
        padding: 6px 14px 4px;
      }
      .search-bar {
        display: flex;
        gap: 0;
        align-items: center;
        flex-wrap: nowrap;
        background: #1a1a22;
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 10px;
        padding: 2px 4px;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .search-bar:focus-within {
        border-color: rgba(255, 255, 255, 0.34);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
      }
      #searchInput:focus,
      .search-scope-select:focus {
        outline: none !important;
        box-shadow: none !important;
        transform: none !important;
      }
      #searchInput.spatial-focus {
        outline: none !important;
        box-shadow: none !important;
        background: transparent !important;
        transform: none !important;
      }
      .search-bar:has(#searchInput.spatial-focus) {
        border-color: var(--red) !important;
        box-shadow: 0 0 0 3px rgba(229, 9, 20, 0.38), 0 4px 16px rgba(0, 0, 0, 0.55) !important;
      }
      .search-scope-select.spatial-focus {
        outline: 2px solid var(--red) !important;
        outline-offset: -1px !important;
        background-color: rgba(229, 9, 20, 0.24) !important;
        box-shadow: 0 0 0 3px rgba(229, 9, 20, 0.38) !important;
        transform: none !important;
      }
      .search-scope-select {
        background-color: #22222c;
        border: 0;
        border-right: 1px solid rgba(255,255,255,0.14);
        color: #f8fafc;
        border-radius: 7px 0 0 7px;
        padding: 6px 8px;
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 700;
        cursor: pointer;
        max-width: 130px;
        flex-shrink: 0;
        outline: none;
        color-scheme: dark;
      }
      .search-scope-select option {
        background-color: #181820;
        color: #f8fafc;
      }
      .search-input-wrap {
        flex: 1;
        min-width: 110px;
        position: relative;
        display: flex;
        align-items: center;
      }
      .search-input-wrap input {
        width: 100%;
        background: transparent;
        border: 0;
        color: #fff;
        padding: calc(7px * var(--scale-menu)) 32px calc(7px * var(--scale-menu)) 10px;
        font-size: calc(13px * var(--scale-text));
        outline: none;
      }
      .search-submit-btn {
        background: transparent;
        border: 0;
        color: #cbd5e1;
        padding: 5px 10px;
        border-radius: 7px;
        font-size: calc(13px * var(--scale-text));
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.14s, color 0.14s;
      }
      .search-submit-btn:hover,
      .search-submit-btn.spatial-focus {
        background: var(--red);
        color: #fff;
      }
      /* Suchfeld-Löschen-X: ausgeblendet wenn leer, kontrastreich sichtbar sobald Text eingegeben wurde! */
      .search-clear-btn {
        position: absolute;
        right: 4px;
        top: 50%;
        transform: translateY(-50%);
        z-index: 30;
        width: 22px;
        height: 22px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.25);
        color: #f8fafc;
        cursor: pointer;
        font-size: 11px;
        font-weight: 900;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        opacity: 0.92 !important;
        visibility: visible !important;
        transition: background 0.15s, transform 0.12s, border-color 0.15s;
      }
      .search-clear-btn.is-empty {
        display: none !important;
      }
      .search-clear-btn:hover,
      .search-clear-btn:focus,
      .search-clear-btn.spatial-focus,
      .search-input-wrap:hover .search-clear-btn:not(.is-empty),
      .search-input-wrap:focus-within .search-clear-btn:not(.is-empty) {
        background: var(--red) !important;
        border-color: #ff4d57 !important;
        color: #ffffff !important;
        opacity: 1 !important;
        visibility: visible !important;
        transform: translateY(-50%) scale(1.08);
      }
      @media (max-width: 640px) {
        .search-scope-select {
          max-width: 102px;
          font-size: 11px;
          padding: 6px 5px;
        }
      }

      /* Autocomplete-Vorschlagsliste unter der Suche (Filme, Serien, Filmreihen, Personen) */
      .search-autocomplete-box {
        position: absolute;
        left: 12px;
        right: 12px;
        top: calc(100% - 2px);
        background: rgba(20, 20, 28, 0.98);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(229, 9, 20, 0.55);
        border-radius: 10px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.85);
        max-height: 360px;
        overflow-y: auto;
        scroll-padding-top: 12px;
        scroll-padding-bottom: 12px;
        z-index: 80;
        padding: 8px;
        display: none;
      }
      .search-autocomplete-box.open { display: block; }
      .ac-group-title {
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 800;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        padding: 4px 6px;
      }
      .ac-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 7px;
        cursor: pointer;
        font-size: calc(12.5px * var(--scale-text));
        color: #f1f5f9;
        border: 1px solid transparent;
      }
      .ac-item:hover, .ac-item.spatial-focus {
        background: rgba(229, 9, 20, 0.18);
        border-color: rgba(229, 9, 20, 0.5);
      }

      /* Kein Ausgrauen der Filmergebnisse mehr bei aktiver Suche (#21) */
      body.search-active-dim #resultsGridContainer {
        opacity: 1;
      }

      /* Flixnet-Inspiriertes Hero-Showcase (Nahtloser Boden-Übergang ohne Strich + Zentrierte Pill-Dot-Leiste + 1-Zeilen Spotlight-Strip) */
      .hero {
        position: relative;
        min-height: 300px;
        background-size: cover;
        background-position: center 22%;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        padding: 24px 18px 14px;
        transition: background-image 0.45s ease-in-out;
        border-bottom: none;
        overflow: hidden;
      }
      .hero::after {
        content: "";
        position: absolute;
        inset: 0 0 -1px 0;
        pointer-events: none;
        background:
          linear-gradient(90deg, rgba(15, 15, 19, 0.95) 0%, rgba(15, 15, 19, 0.72) 48%, rgba(15, 15, 19, 0.18) 100%),
          linear-gradient(to top, var(--bg) 0%, rgba(15, 15, 19, 0.35) 55%, rgba(15, 15, 19, 0.65) 100%);
      }
      .hero-inner {
        position: relative;
        z-index: 2;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .hero-content {
        max-width: 620px;
      }
      .hero-kicker {
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 800;
        letter-spacing: 1.6px;
        text-transform: uppercase;
        color: #cbd5e1;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 8px;
        text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85);
      }
      .hero-kicker-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: var(--red);
        box-shadow: 0 0 8px var(--red);
        display: inline-block;
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
      .hero-badge.movie { background: linear-gradient(135deg, var(--red), #991b1b); color: #fff; }
      .hero-badge.series { background: linear-gradient(135deg, var(--blue), #1e40af); color: #fff; }
      .hero-title {
        font-size: clamp(22px, calc(30px * var(--scale-text)), 38px);
        font-weight: 900;
        margin-bottom: 8px;
        line-height: 1.1;
        color: #ffffff;
        letter-spacing: -0.3px;
        text-shadow: 0 4px 18px rgba(0, 0, 0, 0.92);
      }
      .hero-meta-clean {
        font-size: calc(12.5px * var(--scale-text));
        color: #f1f5f9;
        margin-bottom: 10px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        font-weight: 700;
        text-shadow: 0 1px 6px rgba(0, 0, 0, 0.9);
      }
      .hero-meta-star {
        color: #ef4444;
        font-weight: 900;
      }
      .hero-meta-sep {
        color: rgba(255, 255, 255, 0.45);
      }
      .hero-meta-year {
        cursor: pointer;
        text-decoration: underline;
        text-decoration-color: rgba(255, 255, 255, 0.35);
        text-underline-offset: 3px;
      }
      .hero-meta-year:hover {
        color: #38bdf8;
      }
      .hero-desc {
        font-size: calc(12.5px * var(--scale-text));
        color: #e2e8f0;
        line-height: 1.5;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin-bottom: 14px;
        max-width: 540px;
        text-shadow: 0 1px 8px rgba(0, 0, 0, 0.9);
      }
      .hero-actions-box {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      /* Flixnet-Style Primär-Button (Weiß mit dunkler Schrift wie "▶ Play") */
      .hero-btn-play {
        background: #ffffff !important;
        color: #0f172a !important;
        border: 1px solid #ffffff !important;
        border-radius: 8px !important;
        padding: 8px 18px !important;
        font-size: calc(12.5px * var(--scale-text)) !important;
        font-weight: 900 !important;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55);
        transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
      }
      .hero-btn-play:hover,
      .hero-btn-play.spatial-focus {
        background: #f1f5f9 !important;
        transform: translateY(-1px) scale(1.03);
        box-shadow: 0 0 0 3px rgba(229, 9, 20, 0.55), 0 6px 20px rgba(0, 0, 0, 0.75) !important;
      }
      /* Flixnet-Style Sekundär-Button (Dunkles Glas wie "ⓘ More info") */
      .hero-btn-info {
        background: rgba(30, 41, 59, 0.72) !important;
        backdrop-filter: blur(8px);
        color: #ffffff !important;
        border: 1px solid rgba(255, 255, 255, 0.28) !important;
        border-radius: 8px !important;
        padding: 8px 16px !important;
        font-size: calc(12.5px * var(--scale-text)) !important;
        font-weight: 800 !important;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
        transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
      }
      .hero-btn-info:hover,
      .hero-btn-info.spatial-focus {
        background: rgba(51, 65, 85, 0.9) !important;
        border-color: #ffffff !important;
        transform: translateY(-1px) scale(1.03);
      }
      /* Untere Steuerleiste im Hero: Zentrierte Pill-Dot-Navigation (< ━━ • • • • >) + Rechts Slider ausblenden */
      .hero-bottom-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        padding-top: 4px;
        flex-wrap: wrap;
      }
      .hero-bottom-spacer {
        flex: 1 1 80px;
      }
      .hero-dots-nav {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        background: rgba(15, 23, 42, 0.55);
        backdrop-filter: blur(8px);
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.14);
      }
      .hero-circle-arrow {
        width: 26px;
        height: 26px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        font-size: 12px;
        font-weight: 900;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      }
      .hero-circle-arrow:hover,
      .hero-circle-arrow.spatial-focus {
        background: var(--red);
        border-color: #ffffff;
        transform: scale(1.08);
      }
      .hero-dots-nav:has(.spatial-focus) {
        border-color: var(--red);
        box-shadow: 0 0 0 2px rgba(229, 9, 20, 0.55), 0 6px 18px rgba(0, 0, 0, 0.75);
        background: rgba(15, 23, 42, 0.88);
      }
      .hero-dots-track {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .hero-dot {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.38);
        border: none;
        padding: 0;
        cursor: pointer;
        transition: all 0.22s ease;
      }
      .hero-dot:hover {
        background: rgba(255, 255, 255, 0.75);
      }
      .hero-dot.active {
        width: 26px;
        background: #ffffff;
        box-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
      }
      .hero-dot.spatial-focus {
        background: var(--red) !important;
        outline: 2px solid #ffffff !important;
        outline-offset: 2px;
        box-shadow: 0 0 12px var(--red) !important;
        transform: scale(1.18);
      }
      .hero-hide-wrap {
        flex: 1 1 80px;
        display: flex;
        justify-content: flex-end;
      }
      .hero-hide-btn {
        background: rgba(15, 23, 42, 0.68);
        backdrop-filter: blur(8px);
        color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 999px;
        padding: 4px 11px;
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.15s ease;
      }
      .hero-hide-btn:hover,
      .hero-hide-btn.spatial-focus {
        background: var(--red);
        color: #ffffff;
        border-color: #ffffff;
      }
      /* 1-Zeilen Spotlight-Strip wenn der große Slider ausgeblendet ist */
      .hero-collapsed-strip {
        margin: 8px 14px 2px;
        padding: 7px 12px;
        border-radius: 12px;
        background: linear-gradient(90deg, rgba(229, 9, 20, 0.14) 0%, rgba(22, 22, 30, 0.92) 45%, rgba(22, 22, 30, 0.95) 100%);
        border: 1px solid rgba(255, 255, 255, 0.12);
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
      .hero-collapsed-title {
        font-size: calc(12.5px * var(--scale-text));
        font-weight: 800;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
      }
      .hero-collapsed-title:hover {
        color: var(--red);
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
        padding: 2px;
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
        transition: all 0.15s ease;
      }
      .world-portal-card:hover,
      .world-portal-card.spatial-focus {
        border-color: var(--red);
        background: linear-gradient(135deg, rgba(229, 9, 20, 0.22), rgba(30, 41, 59, 0.95));
        transform: translateY(-1px);
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
      @media (max-width: 680px) {
        .hero { min-height: 255px; padding: 18px 14px 12px; }
        .hero-bottom-spacer { display: none; }
        .hero-bottom-bar { justify-content: space-between; }
      }

      .section { padding: 8px 14px; }
      .section-title { font-size: calc(13.5px * var(--scale-text)); font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; color: #e5e5e5; }
      .mode-bar { display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 0; align-items: center; }

      /* Schlanke Kategorie- & Sortier-Leiste ohne mehrzeiliges Flattern */
      .floating-filter-bar {
        background: rgba(24, 24, 32, 0.72);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        padding: 6px 8px;
        margin: 2px 0 6px;
      }
      .ff-controls-grid {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
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
        background: rgba(255,255,255,0.08);
        color: #e2e8f0;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 8px;
        padding: calc(5px * var(--scale-menu)) calc(9px * var(--scale-menu));
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .ff-tab-btn:hover { background: rgba(255,255,255,0.14); }
      .ff-tab-btn.open { background: var(--purple); border-color: #9381ff; color: #fff; box-shadow: 0 3px 12px rgba(91,70,245,0.4); }
      .ff-tab-btn.has-inc { border-color: var(--inc-border); background: var(--inc-bg); color: var(--inc-text); }
      .ff-tab-btn.has-exc { border-color: var(--exc-border); }

      /* Kompakte Dropdowns für Modus, Anbieter & Sortierung */
      .sort-select,
      .mode-filter-select,
      .new-filter-select {
        background-color: #1e1e26;
        color: #f8fafc;
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 8px;
        padding: calc(5px * var(--scale-menu)) calc(8px * var(--scale-menu));
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 700;
        cursor: pointer;
        outline: none;
        color-scheme: dark;
      }
      .sort-select option,
      .mode-filter-select option,
      .new-filter-select option {
        background-color: #181820;
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
        border-color: var(--red);
        background-color: rgba(229,9,20,0.22);
        color: #fff;
      }

      /* Direkt-Auswahl-Grid in der Sidebar (Farbkennung für Aktiviert vs. Gesperrt) */
      .direct-filter-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
        gap: 6px;
        margin-top: 6px;
      }
      .direct-filter-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.11);
        border-radius: 8px;
        padding: 5px 7px;
        transition: all 0.14s ease;
      }
      .direct-filter-card.state-inc { background: var(--inc-bg); border-color: var(--inc-border); }
      .direct-filter-card.state-exc { background: var(--exc-bg); border-color: var(--exc-border); }
      .df-label {
        flex: 1;
        font-size: calc(12px * var(--scale-text));
        font-weight: 700;
        color: #f1f5f9;
        padding: 3px 4px;
        cursor: default;
        user-select: none;
        pointer-events: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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

      /* Dynamische Covergröße über --scale-cover + Saubere Poster-Wrapper ohne Textüberlappung */
      .carousel {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(calc(124px * var(--scale-cover)), 1fr));
        gap: 10px;
        align-items: stretch;
      }
      .card {
        background: var(--surface);
        border-radius: 10px;
        overflow: hidden;
        cursor: pointer;
        transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.15s, box-shadow 0.18s;
        border: 1px solid rgba(255,255,255,0.08);
        display: flex;
        flex-direction: column;
        position: relative;
        content-visibility: auto;
        contain-intrinsic-size: 130px 240px;
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
      .card:hover {
        border-color: rgba(229,9,20,0.75);
        transform: translateY(-3px);
        box-shadow: 0 12px 26px rgba(0,0,0,0.65);
      }
      .card:active { transform: scale(0.97); }
      .card-poster-wrap {
        position: relative;
        width: 100%;
        aspect-ratio: 2/3;
        overflow: hidden;
        background: #202028;
        flex-shrink: 0;
        touch-action: pan-y;
      }
      .card-poster-wrap img,
      .card > img {
        width: 100%;
        aspect-ratio: 2/3;
        height: 100%;
        object-fit: cover;
        background: #262626;
        display: block;
        pointer-events: none;
        -webkit-user-drag: none;
        -webkit-touch-callout: none;
        user-select: none;
      }
      .card-top-left-stack {
        position: absolute;
        top: 6px;
        left: 6px;
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 5px;
        pointer-events: none;
      }
      .card-rank-badge {
        font-size: calc(10px * var(--scale-text));
        font-weight: 900;
        padding: 1px 6px;
        border-radius: 5px;
        background: linear-gradient(135deg, var(--red), #991b1b);
        color: #fff;
        box-shadow: 0 3px 10px rgba(0,0,0,0.85);
        border: 1px solid rgba(255,255,255,0.32);
        letter-spacing: 0.2px;
      }
      .card-type-badge {
        font-size: calc(9px * var(--scale-text));
        font-weight: 800;
        padding: 1px 5px;
        border-radius: 5px;
        background: rgba(12, 12, 18, 0.94);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.18);
      }
      /* Minimaler grüner VIP-Punkt oben links auf dem Cover (Details im Modal) */
      .card-vip-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #10b981;
        border: 1.5px solid #ffffff;
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.95), 0 2px 5px rgba(0, 0, 0, 0.85);
        display: inline-block;
        flex-shrink: 0;
        pointer-events: auto;
      }
      /* Gespeichert-Icon: Im Ruhezustand NUR sichtbar, wenn der Titel in der Merkliste gespeichert ist (.saved)! */
      .card-quick-save {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.25);
        color: #fff;
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 4;
        opacity: 0;
        pointer-events: none;
        transition: transform 0.14s, background 0.14s, opacity 0.14s;
      }
      @media (hover: none), (pointer: coarse) {
        .card-quick-save {
          opacity: 0.92;
          pointer-events: auto;
          width: 32px;
          height: 32px;
          font-size: 13px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.65);
        }
        .card-quick-info {
          display: none !important;
        }
      }
      @media (max-width: 640px) {
        .card-quick-info {
          display: none !important;
        }
      }
      .card.long-press-active {
        transform: scale(0.96) !important;
        transition: transform 0.12s ease;
      }
      .card-quick-save.saved,
      .card:hover .card-quick-save,
      .card.card-subnav-active .card-quick-save {
        opacity: 1;
        pointer-events: auto;
      }
      .card-quick-save:hover,
      .card-quick-save.spatial-focus {
        opacity: 1;
        pointer-events: auto;
        transform: scale(1.14);
        background: var(--red);
        border-color: #fff;
        box-shadow: 0 0 0 3px rgba(229, 9, 20, 0.55), 0 4px 12px rgba(0,0,0,0.85);
      }
      .card-quick-save.saved {
        background: var(--inc-solid);
        border-color: var(--inc-border);
      }
      .card-quick-save.saved.spatial-focus {
        border-color: #fff;
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.65), 0 4px 12px rgba(0,0,0,0.85);
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
      /* Instant-Trailer Button unten rechts: NUR bei Hover oder Fokus sichtbar! */
      .card-quick-trailer {
        position: absolute;
        bottom: 6px;
        right: 6px;
        z-index: 3;
        background: rgba(14, 14, 20, 0.94);
        color: #fff;
        border: 1px solid rgba(229, 9, 20, 0.65);
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
        box-shadow: 0 4px 12px rgba(0,0,0,0.75);
        transition: opacity 0.15s ease, transform 0.14s, background 0.14s, border-color 0.14s, box-shadow 0.14s;
      }
      .card:hover .card-quick-trailer,
      .card.spatial-focus .card-quick-trailer,
      .card.card-subnav-active .card-quick-trailer {
        opacity: 1;
        pointer-events: auto;
      }
      .card-quick-trailer:hover,
      .card-quick-trailer.spatial-focus {
        background: var(--red);
        border-color: #fff;
        transform: scale(1.08);
        box-shadow: 0 0 0 3px rgba(229, 9, 20, 0.55), 0 4px 14px rgba(0,0,0,0.85);
      }
      /* Info/Details Sub-Button unten links: NUR bei Hover oder Fokus sichtbar! */
      .card-quick-info {
        position: absolute;
        bottom: 6px;
        left: 6px;
        z-index: 3;
        background: rgba(14, 14, 20, 0.94);
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
        box-shadow: 0 4px 12px rgba(0,0,0,0.75);
        transition: opacity 0.15s ease, transform 0.14s, background 0.14s, border-color 0.14s, box-shadow 0.14s;
      }
      .card:hover .card-quick-info,
      .card.spatial-focus .card-quick-info,
      .card.card-subnav-active .card-quick-info {
        display: inline-flex !important;
        opacity: 1;
        pointer-events: auto;
      }
      .card-quick-info:hover,
      .card-quick-info.spatial-focus {
        background: var(--purple);
        border-color: #fff;
        color: #fff;
        transform: scale(1.08);
        box-shadow: 0 0 0 3px rgba(91, 70, 245, 0.6), 0 4px 14px rgba(0,0,0,0.85);
      }
      .card.card-subnav-active {
        border-color: var(--accent-primary) !important;
        box-shadow: 0 0 0 2px rgba(229, 9, 20, 0.45), 0 12px 28px rgba(0,0,0,0.75);
      }
      .card-body { padding: 7px 8px; display: flex; flex-direction: column; flex: 1; justify-content: space-between; gap: 4px; }
      .card-title { font-size: calc(12px * var(--scale-text)); font-weight: 700; line-height: 1.3; white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
      .card-sub { font-size: calc(10.5px * var(--scale-text)); color: var(--muted); display: flex; justify-content: space-between; margin-top: 2px; }
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
        border-radius: 10px;
        overflow: hidden;
        background: var(--surface);
        border: 1px solid rgba(255, 255, 255, 0.07);
        display: flex;
        flex-direction: column;
        pointer-events: none;
      }
      .skeleton-poster {
        width: 100%;
        aspect-ratio: 2/3;
        background: linear-gradient(90deg, rgba(32,32,42,0.9) 25%, rgba(56,56,72,0.95) 50%, rgba(32,32,42,0.9) 75%);
        background-size: 200% 100%;
        animation: skeletonShimmer 1.35s infinite linear;
      }
      .skeleton-line {
        height: 11px;
        margin: 8px 8px 4px;
        border-radius: 5px;
        background: linear-gradient(90deg, rgba(40,40,52,0.9) 25%, rgba(68,68,86,0.95) 50%, rgba(40,40,52,0.9) 75%);
        background-size: 200% 100%;
        animation: skeletonShimmer 1.35s infinite linear;
      }
      .skeleton-line.short {
        width: 55%;
        height: 9px;
        margin: 2px 8px 8px;
      }

      /* Seiten-Anzeige (Seite X von Y) & Direkt-Seitenwahl (#17) */
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
        background: linear-gradient(135deg, var(--red), #991b1b);
        border-color: #fca5a5;
        color: #fff;
        box-shadow: 0 4px 12px rgba(229, 9, 20, 0.45);
      }

      /* Alphabet-Schnellsprung A-Z in der Merkliste (#20) */
      .wl-az-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        overflow-x: auto;
        padding: 4px 2px 6px;
        margin-bottom: 8px;
        scrollbar-width: thin;
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
        background: rgba(229, 9, 20, 0.25);
        border-color: var(--red);
        color: #fff;
      }
      .wl-az-btn.active {
        background: var(--red);
        border-color: #fff;
        color: #fff;
      }

      /* Zuletzt angesehene Titel (Quick-Resume Leiste) mit Einzel-Löschbutton (✕) & Komplett-Leeren (🗑️) */
      .recent-strip {
        display: flex;
        align-items: center;
        gap: 8px;
        overflow-x: auto;
        padding: 4px 2px 8px;
        scrollbar-width: thin;
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
        border-color: var(--red);
        background: rgba(229,9,20,0.14);
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
        background: var(--red);
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

      /* Premium Detail-Modal im Flixnet- & Netflix-Design */
      .modal-backdrop { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.88); backdrop-filter: blur(10px); overflow-y: auto; padding: 14px 10px 40px; scroll-padding-top: 64px; scroll-padding-bottom: 28px; animation: fadeIn 0.16s ease; }
      .modal { background: #121318; border-radius: 16px; max-width: 820px; margin: 0 auto; overflow: hidden; border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 24px 65px rgba(0,0,0,0.92); }
      .modal-hero-banner {
        position: relative;
        min-height: 280px;
        background-size: cover;
        background-position: center 18%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 16px 20px 20px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .modal-hero-banner::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(to top, #121318 4%, rgba(18,19,24,0.82) 52%, rgba(18,19,24,0.55) 100%), radial-gradient(circle at 20% 50%, rgba(18,19,24,0.75) 0%, transparent 70%);
      }
      .modal-hero-top {
        position: relative;
        z-index: 2;
        width: 100%;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        margin-bottom: 14px;
      }
      .modal-hero-inner {
        position: relative;
        z-index: 2;
        width: 100%;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 10px;
        margin-top: auto;
      }
      /* Flixnet Hero Layout: Poster links, Metadaten & Genres rechts */
      .flix-hero-grid {
        position: relative;
        z-index: 2;
        display: flex;
        gap: 20px;
        align-items: flex-end;
        width: 100%;
        margin-top: auto;
      }
      .flix-poster-card {
        width: 128px;
        aspect-ratio: 2 / 3;
        border-radius: 10px;
        object-fit: cover;
        border: 1px solid rgba(255,255,255,0.22);
        box-shadow: 0 12px 28px rgba(0,0,0,0.78);
        flex-shrink: 0;
        cursor: zoom-in;
        background: #1a1b22;
        transition: transform 0.16s ease, border-color 0.16s ease;
      }
      .flix-poster-card:hover {
        transform: scale(1.03);
        border-color: #e50914;
      }
      .flix-meta-col {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .flix-title-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
      }
      .flix-version-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        padding: 3px 9px;
        border-radius: 6px;
        background: rgba(229, 9, 20, 0.24);
        border: 1px solid rgba(229, 9, 20, 0.65);
        color: #fecaca;
        letter-spacing: 0.2px;
      }
      /* Flixnet Tabs unter dem Hero-Header */
      .flix-tabs-bar {
        display: flex;
        gap: 6px;
        padding: 0 20px;
        background: #161820;
        border-bottom: 1px solid rgba(255,255,255,0.09);
        overflow-x: auto;
        scrollbar-width: none;
      }
      .flix-tabs-bar::-webkit-scrollbar { display: none; }
      .flix-tab-btn {
        background: transparent;
        border: 0;
        border-bottom: 2.5px solid transparent;
        color: #94a3b8;
        font-size: calc(12.5px * var(--scale-text));
        font-weight: 800;
        padding: 11px 12px;
        cursor: pointer;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
      }
      .flix-tab-btn:hover, .flix-tab-btn.spatial-focus {
        color: #f8fafc;
        background: rgba(255,255,255,0.04);
      }
      .flix-tab-btn.active {
        color: #ffffff;
        border-bottom-color: #e50914;
      }
      .ep-icon-btn {
        padding: 4px 7px !important;
        font-size: calc(11px * var(--scale-text)) !important;
        border-radius: 6px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.14);
        color: #cbd5e1;
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
        background: rgba(0,0,0,0.82);
        backdrop-filter: blur(6px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 14px;
        animation: fadeIn 0.14s ease;
      }
      .submodal-box {
        background: #161821;
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 14px;
        width: 100%;
        max-width: 520px;
        max-height: 90vh;
        overflow-y: auto;
        padding: 16px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.92);
      }
      @media (max-width: 540px) {
        .flix-hero-grid { gap: 12px; align-items: flex-start; }
        .flix-poster-card { width: 96px; }
        .modal-hero-banner { padding: 12px 14px 14px; min-height: 220px; }
        .flix-tabs-bar { padding: 0 12px; }
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
      .ep-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: rgba(255,255,255,0.04); border-radius: 8px; margin-bottom: 6px; gap: 8px; border: 1px solid rgba(255,255,255,0.08); flex-wrap: wrap; }
      .ep-row.ep-watched { border-color: rgba(16, 185, 129, 0.45); background: rgba(16, 185, 129, 0.07); }
      .ep-row.ep-next-up { border-color: rgba(245, 158, 11, 0.55); background: rgba(245, 158, 11, 0.08); }
      .ep-title { font-size: calc(12.5px * var(--scale-text)); font-weight: 600; color: #60a5fa; cursor: pointer; flex: 1; min-width: 170px; border-radius: 6px; padding: 2px 4px; transition: background 0.14s, color 0.14s; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .ep-title.spatial-focus, .ep-title:hover { background: rgba(96, 165, 250, 0.16); color: #fff; outline: 2px solid #60a5fa; }
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
      }
      .ep-progress-badge.next {
        background: rgba(245, 158, 11, 0.22);
        border-color: rgba(245, 158, 11, 0.55);
        color: #fcd34d;
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
      .panel-box { background: rgba(30,30,36,0.95); border: 1px solid rgba(255,255,255,0.09); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
      .lightbox-backdrop { position: fixed; inset: 0; z-index: 220; background: rgba(0,0,0,0.94); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px; }
      .lightbox-img { max-width: 96vw; max-height: 82vh; object-fit: contain; border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,0.9); transition: transform 0.2s ease; cursor: zoom-in; }
      .lightbox-img.zoomed { transform: scale(1.65); cursor: zoom-out; }
      a.link { color: #f87171; text-decoration: none; font-weight: 600; }
      #hudToast {
        position: fixed;
        bottom: 18px;
        right: 14px;
        z-index: 260;
        background: rgba(20, 20, 28, 0.96);
        border: 1px solid rgba(229, 9, 20, 0.65);
        color: #fff;
        padding: 8px 14px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 800;
        box-shadow: 0 8px 24px rgba(0,0,0,0.75);
        display: none;
        pointer-events: none;
      }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    </style>
  </head>
  <body>
    <header>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button class="btn" id="sidebarToggleBtn" onclick="toggleFilterSidebar()" title="Menü, Filter, Zufall, Account, Design & Ansichtsgröße öffnen">☰ Menü</button>
        <span id="headerBrandLogo" class="brand-logo" tabindex="0" role="button" aria-label="TelePort – Zur Hauptseite" onclick="goHome()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();goHome();}" title="TelePort – Zur Hauptseite">
          <svg class="teleport-logo-svg" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="tpGradHeader" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#38bdf8"/>
                <stop offset="50%" stop-color="#a855f7"/>
                <stop offset="100%" stop-color="#e50914"/>
              </linearGradient>
            </defs>
            <circle cx="14" cy="14" r="11.5" stroke="url(#tpGradHeader)" stroke-width="2.5" stroke-dasharray="18 5"/>
            <circle cx="14" cy="14" r="7.5" stroke="#38bdf8" stroke-width="1.4" stroke-opacity="0.75"/>
            <path d="M11.8 9.8L18.5 14L11.8 18.2V9.8Z" fill="url(#tpGradHeader)"/>
          </svg>
          <span>Tele<span class="teleport-accent">Port</span></span>
        </span>
      </div>
      <div class="media-mode-switch-inline" id="mediaModeBanner">
        <button id="tabBtnMovies" class="media-mode-tab active-movie" onclick="switchType('m')" title="Zu Filme wechseln">
          <span>🎬 Filme</span>
        </button>
        <button id="tabBtnSeries" class="media-mode-tab" onclick="switchType('s')" title="Zu Serien wechseln">
          <span>📺 Serien</span>
        </button>
      </div>
      <button class="btn" id="navBtnWishlist" onclick="loadWishlist('root')" title="Synchronisierte Merkliste & Playlisten">💾 Merkliste</button>
    </header>

    <!-- Linke Off-Canvas Sidebar für Filter, Design (Dark/Light/Cyberpunk), Farbenblind-Modus, Instant-Trailer Provider & Größen-Einstellung -->
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
          <button class="btn red" style="padding:4px 8px;font-size:11px" onclick="setDirectFilter('reset_all','','neutral')" title="Alle aktiven Filter zurücksetzen">🗑️ Reset</button>
          <button class="btn" onclick="closeFilterSidebar()" title="Sidebar schließen">✖</button>
        </div>
      </div>
      <div id="sidebarDrawerBody" class="sidebar-body"></div>
    </aside>

    <div id="busyOverlayBar">
      <div class="spinner"></div>
      <span id="busyOverlayText">⏳ Filter wird angewendet – lade passende Ergebnisse nach...</span>
    </div>

    <div id="hudToast"></div>
    <div id="antiSpamHudMount" style="position:fixed;bottom:14px;right:14px;left:14px;max-width:480px;margin-left:auto;z-index:1550;pointer-events:none;display:none"></div>
    <div id="modalHoldNavIndicator" class="modal-hold-nav-indicator">
      <span id="modalHoldNavText">⏩ Halten zum Weiterblättern...</span>
      <div class="modal-hold-nav-track"><div id="modalHoldNavBar" class="modal-hold-nav-bar"></div></div>
    </div>
    <div id="customDialogRoot"></div>

    <!-- Integrierte, ruhige Suchleiste (Genres links direkt in der Suchleiste + Eingabe + Suchlupe) -->
    <div class="search-bar-outer">
      <div class="search-bar">
        <select id="searchGenreSelect" class="search-scope-select" onchange="onSearchGenreSelectChange(this.value)" title="Nach Genre filtern">
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
            onkeydown="if(event.key==='Enter'){event.preventDefault();closeAutocomplete();this.blur();runSearch(false,this.value,undefined,true);}"
          />
          <button type="button" id="searchClearBtn" class="search-clear-btn is-empty" onclick="clearSearchInput()" title="Suchfeld leeren" aria-label="Suchfeld leeren">✕</button>
        </div>
        <button type="button" class="search-submit-btn" onclick="closeAutocomplete();runSearch()" title="Suche starten" aria-label="Suche starten">🔍</button>
      </div>
      <div id="searchAutocompleteBox" class="search-autocomplete-box"></div>
    </div>

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
    <script>
      const API_BASE = "${workerOrigin}/api/tma";
      const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
      if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }
      const rawInitData = (tg && typeof tg.initData === "string" && tg.initData.length > 0) ? tg.initData : "";
      let sessionToken = "";
      try { sessionToken = localStorage.getItem("tma_session_token") || ""; } catch (e) {}
      let chatId = "guest";

      const GENRE_EMOJIS = ${JSON.stringify(GENRE_EMOJIS)};
      const MOVIE_GENRES_CLIENT = ${JSON.stringify(MOVIE_GENRES)};
      const SERIES_GENRES_CLIENT = ${JSON.stringify(SERIES_GENRES)};
      const PLATFORM_OPTIONS_CLIENT = ${JSON.stringify(PLATFORM_OPTIONS)};
      const STUDIO_OPTIONS_CLIENT = ${JSON.stringify(STUDIO_OPTIONS)};
      const ERA_OPTIONS_CLIENT = ${JSON.stringify(ERA_OPTIONS)};
      const FSK_OPTIONS_CLIENT = ${JSON.stringify(FSK_OPTIONS)};
      const FEATURED_COLLECTIONS_CLIENT = ${JSON.stringify(FEATURED_COLLECTIONS)};
      const CINEMATIC_UNIVERSES_CLIENT = ${JSON.stringify(CINEMATIC_UNIVERSES)};

      function genreEmoji(name) {
        return GENRE_EMOJIS[name] || "🎞️";
      }

      function normalizeCompareString(str) {
        return String(str || "")
          .toLowerCase()
          .replace(/ä/g, "ae")
          .replace(/ö/g, "oe")
          .replace(/ü/g, "ue")
          .replace(/ß/g, "ss")
          .replace(/&/g, " and ")
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      window.normalizeCompareString = normalizeCompareString;

      function openInBot(startPayload) {
        const botName = (state && state.botUsername) ? state.botUsername : "";
        const cleanPayload = String(startPayload || "").trim();
        const url = botName
          ? ("https://t.me/" + botName + (cleanPayload ? ("?start=" + encodeURIComponent(cleanPayload)) : ""))
          : ("https://t.me/");
        if (tg && typeof tg.openTelegramLink === "function" && botName) {
          try { tg.openTelegramLink(url); return; } catch (e) {}
        }
        window.open(url, "_blank");
      }

      function openCurrentViewInBot() {
        const modalEl = document.getElementById("modalRoot");
        if (modalEl && modalEl.innerHTML.trim() && state.activeDetails && state.activeDetails.id) {
          const tc = state.activeDetails.typeCode || state.type || "m";
          openInBot(tc + "_" + state.activeDetails.id);
          return;
        }
        if (state.currentView === "person" && state.currentPersonId) {
          openInBot("pcr_" + state.currentPersonId + "_1");
          return;
        }
        if (state.currentView === "collection" && state.currentCollectionId) {
          openInBot("bcol_" + state.currentCollectionId);
          return;
        }
        if (state.currentView === "universe" && state.currentUniverseId) {
          openInBot("buni_" + state.currentUniverseId);
          return;
        }
        if (state.currentView === "franchises") {
          openInBot(state.franchiseTab === "universes" ? "discover_universes" : "discover_collections");
          return;
        }
        if (state.currentView === "wishlist") {
          if (state.wlFolder && state.wlFolder !== "root") {
            openInBot("wlo_" + state.wlFolder);
          } else {
            openInBot("wishlist");
          }
          return;
        }
        if (state.currentView === "settings") {
          openInBot("settings");
          return;
        }
        if (state.currentView === "admin") {
          openInBot("admin");
          return;
        }
        if (state.isSearchMode && state.searchQuery) {
          openInBot("search_" + state.searchQuery.slice(0, 36));
          return;
        }
        openInBot(state.type === "s" ? "discover_series" : "discover_movies");
      }

      function shareItemFromTma(typeCode, id) {
        const d = state.activeDetails;
        const botName = state.botUsername || "";
        const inlineQuery = "share_" + typeCode + "_" + id;
        if (tg && typeof tg.switchInlineQuery === "function") {
          try { tg.switchInlineQuery(inlineQuery, ["users", "groups", "channels"]); return; } catch (e) {}
        }
        const shareTargetUrl = (d && d.shareData && d.shareData.targetTitleUrl)
          ? d.shareData.targetTitleUrl
          : (botName ? ("https://t.me/" + botName + "?start=" + typeCode + "_" + id) : window.location.href);
        const sharePlain = (d && d.shareData && d.shareData.plainShareText)
          ? d.shareData.plainShareText
          : ("🎬 " + (d?.title || "Empfehlung") + " – Im Film & Serien Bot öffnen!");
        const tgShareUrl = "https://t.me/share/url?url=" + encodeURIComponent(shareTargetUrl) + "&text=" + encodeURIComponent(sharePlain);
        if (tg && typeof tg.openTelegramLink === "function") {
          try { tg.openTelegramLink(tgShareUrl); return; } catch (e) {}
        }
        window.open(tgShareUrl, "_blank");
      }

      async function sendSharePostToBotChat(typeCode, id) {
        setBusyState(true, "📤 Sende einheitlichen Teilen-Post in deinen Bot-Chat...");
        try {
          const r = await apiFetchJson(API_BASE + "/share-in-bot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ typeCode, id })
          });
          if (r && r.ok) {
            showHudToast("✅ Einheitlicher Teilen-Post in deinen Bot-Chat gesendet!");
          } else {
            openInBot("sh_" + typeCode + "_" + id);
          }
        } catch (e) {
          openInBot("sh_" + typeCode + "_" + id);
        } finally {
          setBusyState(false);
        }
      }

      function shareCollectionOrUniverseFromTma(kind, id, titleText) {
        const botName = state.botUsername || "";
        const inlineQuery = kind === "col" ? ("share_col_" + id) : ("share_uni_" + id);
        if (tg && typeof tg.switchInlineQuery === "function") {
          try { tg.switchInlineQuery(inlineQuery, ["users", "groups", "channels"]); return; } catch (e) {}
        }
        const deepParam = kind === "col" ? ("bcol_" + id) : ("buni_" + id);
        const targetUrl = botName ? ("https://t.me/" + botName + "?start=" + deepParam) : window.location.href;
        const text = (kind === "col" ? "🍿 Filmreihe: " : "🌌 Filmuniversum: ") + (titleText || id) + "\\n👉 Im Film & Serien Bot öffnen: " + targetUrl;
        const shareUrl = "https://t.me/share/url?url=" + encodeURIComponent(targetUrl) + "&text=" + encodeURIComponent(text);
        if (tg && typeof tg.openTelegramLink === "function") {
          try { tg.openTelegramLink(shareUrl); return; } catch (e) {}
        }
        window.open(shareUrl, "_blank");
      }

      function updateSyncBadge() {
        const b = document.getElementById("syncBadge");
        const admBtn = document.getElementById("adminHeaderBtn");
        if (b) {
          if (state && state.isAuthenticated && state.authUser) {
            const u = state.authUser;
            const label = u.customUsername || (u.tgUsername ? "@" + u.tgUsername : ("ID " + u.telegramId));
            const vipTag = u.isVip ? " 🌟VIP" : "";
            const admTag = u.isAdmin ? " 👑" : "";
            b.textContent = "🟢 " + label + vipTag + admTag;
            b.style.color = "#34d399";
            b.style.borderColor = "rgba(16,185,129,0.4)";
            if (admBtn) admBtn.style.display = u.isAdmin ? "inline-flex" : "none";
          } else {
            b.textContent = "👤 Gast • Login";
            b.style.color = "#fbbf24";
            b.style.borderColor = "rgba(251,191,36,0.4)";
            if (admBtn) admBtn.style.display = "none";
          }
        }
        if (state && state.sidebarOpen && typeof renderFilterSidebarContent === "function") {
          renderFilterSidebarContent(false);
        }
      }

      // =========================================================================
      // 1. GRÖSSEN-ANPASSUNG, DESIGN-THEMES (DARK/LIGHT/CYBERPUNK), FARBENBLIND-MODUS & SIDEBAR
      // =========================================================================
      const DEFAULT_UI_SCALE = { all: 100, text: 100, cover: 100, menu: 100 };
      let uiScale = (function() {
        try {
          const raw = localStorage.getItem("tma_ui_scale");
          if (raw) return { ...DEFAULT_UI_SCALE, ...JSON.parse(raw) };
        } catch (e) {}
        return { ...DEFAULT_UI_SCALE };
      })();

      let appTheme = (function() {
        try { return localStorage.getItem("tma_theme") || "dark"; } catch (e) { return "dark"; }
      })();
      let colorblindMode = (function() {
        try { return localStorage.getItem("tma_colorblind") === "1"; } catch (e) { return false; }
      })();
      let mouseHoverNavEnabled = (function() {
        try {
          const v = localStorage.getItem("tma_mouse_hover_nav");
          return v === null ? true : v === "1";
        } catch (e) { return true; }
      })();
      let modalHoldNavEnabled = (function() {
        try {
          const v = localStorage.getItem("tma_modal_hold_nav");
          return v === null ? true : v === "1";
        } catch (e) { return true; }
      })();

      const TRAILER_PROVIDERS_CLIENT = [
        { id: "youtube", label: "▶️ YouTube", shortLabel: "YouTube" },
        { id: "piped", label: "🛡️ Piped", shortLabel: "Piped" },
        { id: "invidiousDe", label: "🇩🇪 Invidious DE", shortLabel: "Invidious DE" },
        { id: "invidious1", label: "🕵️ Invidious (yewtu.be)", shortLabel: "yewtu.be" },
        { id: "invidious2", label: "🔒 Nadeko", shortLabel: "Nadeko" }
      ];
      let trailerProvider = (function() {
        try { return localStorage.getItem("tma_trailer_provider") || "youtube"; } catch (e) { return "youtube"; }
      })();

      function getTrailerProviderLabel(provId) {
        const found = TRAILER_PROVIDERS_CLIENT.find(p => p.id === (provId || trailerProvider));
        return found ? found.shortLabel : "YouTube";
      }

      function setTrailerProvider(nextProvider, persistRemote = true) {
        const valid = TRAILER_PROVIDERS_CLIENT.some(p => p.id === nextProvider) ? nextProvider : "youtube";
        trailerProvider = valid;
        try { localStorage.setItem("tma_trailer_provider", trailerProvider); } catch (e) {}
        if (state && state.settings) state.settings.trailerProvider = trailerProvider;
        if (state && state.sidebarOpen) renderFilterSidebarContent();
        const found = TRAILER_PROVIDERS_CLIENT.find(p => p.id === trailerProvider);
        showHudToast("🎬 Standard-Trailer Quelle: " + (found ? found.label : "▶️ YouTube"));
        if (persistRemote) {
          fetch(API_BASE + "/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, action: "save_trailer_provider", trailerProvider })
          }).catch(() => {});
        }
      }

      function applyThemeAndAccessibilityToDom() {
        document.body.setAttribute("data-theme", appTheme || "dark");
        document.body.setAttribute("data-colorblind", colorblindMode ? "1" : "0");
        document.body.setAttribute("data-hover-nav", mouseHoverNavEnabled ? "1" : "0");
      }
      applyThemeAndAccessibilityToDom();

      function setAppTheme(nextTheme) {
        appTheme = nextTheme || "dark";
        try { localStorage.setItem("tma_theme", appTheme); } catch (e) {}
        applyThemeAndAccessibilityToDom();
        if (state && state.sidebarOpen) renderFilterSidebarContent();
        const themeLabel = appTheme === "light" ? "☀️ Light Mode" : appTheme === "cyberpunk" ? "⚡ Cyberpunk Mode" : "🌙 Dark Mode";
        showHudToast("🎨 Design: " + themeLabel);
      }

      function toggleColorblindMode() {
        colorblindMode = !colorblindMode;
        try { localStorage.setItem("tma_colorblind", colorblindMode ? "1" : "0"); } catch (e) {}
        applyThemeAndAccessibilityToDom();
        if (state && state.sidebarOpen) renderFilterSidebarContent();
        const filterMount = document.getElementById("floatingFilterMount");
        if (filterMount) filterMount.innerHTML = buildFloatingFilterBarHtml();
        showHudToast(colorblindMode ? "👁️ Farbenblind-Modus aktiviert (Blau / Orange + Konturen)" : "👁️ Standard-Farbschema aktiviert");
      }

      function toggleMouseHoverNav() {
        mouseHoverNavEnabled = !mouseHoverNavEnabled;
        try { localStorage.setItem("tma_mouse_hover_nav", mouseHoverNavEnabled ? "1" : "0"); } catch (e) {}
        applyThemeAndAccessibilityToDom();
        if (state && state.sidebarOpen) {
          renderFilterSidebarContent(false);
          const sbBtn = document.getElementById("sidebarMouseHoverNavBtn");
          if (sbBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(sbBtn, false);
        }
        if (state && state.currentView === "settings") {
          const stBtn = document.getElementById("settingsMouseHoverNavBtn");
          if (stBtn) {
            stBtn.className = "btn " + (mouseHoverNavEnabled ? "green" : "");
            stBtn.innerHTML = '<span>🖱️ Maus-Hover Navigation (Mauszeiger verschiebt Auswahl)</span><b>' + (mouseHoverNavEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>';
            if (!state.sidebarOpen && typeof jumpSpatialFocus === "function") jumpSpatialFocus(stBtn, false);
          }
        }
        showHudToast(mouseHoverNavEnabled ? "🖱️ Maus-Hover Navigation: AKTIVIERT" : "🖱️ Maus-Hover Navigation: DEAKTIVIERT");
      }

      function toggleModalHoldNav() {
        modalHoldNavEnabled = !modalHoldNavEnabled;
        try { localStorage.setItem("tma_modal_hold_nav", modalHoldNavEnabled ? "1" : "0"); } catch (e) {}
        if (state && state.sidebarOpen) {
          renderFilterSidebarContent(false);
          const sbBtn = document.getElementById("sidebarModalHoldNavBtn");
          if (sbBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(sbBtn, false);
        }
        if (state && state.currentView === "settings") {
          const stBtn = document.getElementById("settingsModalHoldNavBtn");
          if (stBtn) {
            stBtn.className = "btn " + (modalHoldNavEnabled ? "green" : "");
            stBtn.innerHTML = '<span>⏩ Detailansicht: Pfeiltaste ⬅️/➡️ gedrückt halten (~450ms) für nächsten/vorherigen Titel</span><b>' + (modalHoldNavEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>';
            if (!state.sidebarOpen && typeof jumpSpatialFocus === "function") jumpSpatialFocus(stBtn, false);
          }
        }
        showHudToast(modalHoldNavEnabled ? "⏩ Pfeiltaste gedrückt halten (450ms) im Detail-Modal: AKTIV" : "⏩ Pfeiltaste gedrückt halten im Detail-Modal: AUS");
      }

      let hudToastTimer = null;
      function showHudToast(msg) {
        const el = document.getElementById("hudToast");
        if (!el) return;
        el.textContent = msg;
        el.style.display = "block";
        if (hudToastTimer) clearTimeout(hudToastTimer);
        hudToastTimer = setTimeout(() => { el.style.display = "none"; }, 2400);
      }

      // Nicht-blockierende Custom Dialoge (Ersatz für window.prompt & window.confirm im iFrame/Telegram WebApp)
      let activeCustomDialogResolver = null;
      function closeCustomDialog(resultValue) {
        const root = document.getElementById("customDialogRoot");
        if (root) root.innerHTML = "";
        if (activeCustomDialogResolver) {
          const fn = activeCustomDialogResolver;
          activeCustomDialogResolver = null;
          fn(resultValue);
        }
      }

      function showCustomConfirm(messageText, confirmLabel = "✅ Bestätigen") {
        return new Promise((resolve) => {
          activeCustomDialogResolver = resolve;
          const root = document.getElementById("customDialogRoot");
          if (!root) { resolve(true); return; }
          root.innerHTML = '<div class="modal-backdrop" style="z-index:1600;align-items:center" onclick="if(event.target===this)closeCustomDialog(false)">' +
            '<div class="modal" style="max-width:420px;padding:18px;border:1px solid rgba(255,255,255,0.2)">' +
              '<div style="font-size:15px;font-weight:800;margin-bottom:10px">🛡️ Bestätigung</div>' +
              '<div style="font-size:13px;color:var(--text-muted);line-height:1.5;margin-bottom:16px">' + esc(messageText) + '</div>' +
              '<div style="display:flex;justify-content:flex-end;gap:8px">' +
                '<button class="btn" onclick="closeCustomDialog(false)">Abbrechen</button>' +
                '<button class="btn red" onclick="closeCustomDialog(true)">' + esc(confirmLabel) + '</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        });
      }

      function showCustomPrompt(titleText, defaultValue = "") {
        return new Promise((resolve) => {
          activeCustomDialogResolver = resolve;
          const root = document.getElementById("customDialogRoot");
          if (!root) { resolve(defaultValue || null); return; }
          root.innerHTML = '<div class="modal-backdrop" style="z-index:1600;align-items:center" onclick="if(event.target===this)closeCustomDialog(null)">' +
            '<div class="modal" style="max-width:440px;padding:18px;border:1px solid rgba(255,255,255,0.2)">' +
              '<div style="font-size:15px;font-weight:800;margin-bottom:10px">' + esc(titleText) + '</div>' +
              '<input id="customPromptInp" value="' + esc(defaultValue) + '" placeholder="Name eingeben..." onkeydown="if(event.key===\\'Enter\\')closeCustomDialog(this.value);if(event.key===\\'Escape\\')closeCustomDialog(null)" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:var(--bg-elevated);color:var(--text-main);font-size:13.5px;margin-bottom:14px" />' +
              '<div style="display:flex;justify-content:flex-end;gap:8px">' +
                '<button class="btn" onclick="closeCustomDialog(null)">Abbrechen</button>' +
                '<button class="btn green" onclick="closeCustomDialog(document.getElementById(\\'customPromptInp\\')?.value||\\'\\')">💾 Speichern</button>' +
              '</div>' +
            '</div>' +
          '</div>';
          setTimeout(() => {
            const inp = document.getElementById("customPromptInp");
            if (inp) { inp.focus(); inp.select(); }
          }, 40);
        });
      }

      function applyUiScaleToDom() {
        const root = document.documentElement;
        const sAll = Math.min(1.6, Math.max(0.65, Number(uiScale.all || 100) / 100));
        const sText = Math.min(1.6, Math.max(0.7, Number(uiScale.text || 100) / 100));
        const sCover = Math.min(1.8, Math.max(0.65, Number(uiScale.cover || 100) / 100));
        const sMenu = Math.min(1.5, Math.max(0.7, Number(uiScale.menu || 100) / 100));
        root.style.setProperty("--scale-all", sAll.toFixed(3));
        root.style.setProperty("--scale-text", (sText * sAll).toFixed(3));
        root.style.setProperty("--scale-cover", (sCover * sAll).toFixed(3));
        root.style.setProperty("--scale-menu", (sMenu * sAll).toFixed(3));
      }
      applyUiScaleToDom();

      // Automatische Geräteerkennung (User-Agent + Viewport)
      function detectClientDeviceAndAdapt() {
        const ua = String(navigator.userAgent || "").toLowerCase();
        const w = window.innerWidth || 1024;
        let devType = "desktop";
        let devLabel = "💻 Desktop";
        if (/android.*tv|smart-tv|smarttv|googletv|aftm|aftb|aftt|bravia|webos|tizen|crkey|playstation|xbox|nintendo/i.test(ua)) {
          devType = "tv";
          devLabel = "📺 Smart-TV / Controller";
        } else if (/ipad|tablet|playbook|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) {
          devType = "tablet";
          devLabel = "📟 Tablet";
        } else if (/iphone|ipod|android.*mobile|windows phone|mobile/i.test(ua) || w <= 640) {
          devType = "mobile";
          devLabel = "📱 Mobil";
        }
        document.body.setAttribute("data-device", devType);
        const b = document.getElementById("deviceBadge");
        if (b) b.textContent = devLabel;
      }
      detectClientDeviceAndAdapt();
      window.addEventListener("resize", detectClientDeviceAndAdapt);

      function setUiScaleValue(key, val, persistRemote = true) {
        const clamped = Math.min(160, Math.max(65, Number(val) || 100));
        uiScale[key] = clamped;
        try { localStorage.setItem("tma_ui_scale", JSON.stringify(uiScale)); } catch (e) {}
        applyUiScaleToDom();
        if (state && state.sidebarOpen) renderFilterSidebarContent();
        showHudToast("🔠 " + (key === "all" ? "Gesamtgröße" : key === "text" ? "Textgröße" : key === "cover" ? "Covergröße" : "Menügröße") + ": " + clamped + "%");
        if (persistRemote) {
          fetch(API_BASE + "/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, action: "save_ui_scale", uiScale })
          }).catch(() => {});
        }
      }

      function adjustOverallScaleStep(delta) {
        const cur = Number(uiScale.all || 100);
        setUiScaleValue("all", cur + delta, true);
      }

      function resetUiScale() {
        uiScale = { ...DEFAULT_UI_SCALE };
        try { localStorage.setItem("tma_ui_scale", JSON.stringify(uiScale)); } catch (e) {}
        applyUiScaleToDom();
        if (state && state.sidebarOpen) renderFilterSidebarContent();
        showHudToast("🔠 Seitengröße auf 100% zurückgesetzt");
        fetch(API_BASE + "/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, action: "save_ui_scale", uiScale })
        }).catch(() => {});
      }

      function focusFirstSidebarFilterOption() {
        const body = document.getElementById("sidebarDrawerBody");
        if (!body) return;
        const firstBtn = body.querySelector(".direct-filter-grid .df-btn.inc, .direct-filter-grid .df-btn");
        if (firstBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(firstBtn, true);
          return;
        }
        const firstCatTab = body.querySelector(".ff-tab-btn");
        if (firstCatTab && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(firstCatTab, false);
        }
      }

      function toggleFilterSidebar(initialTab) {
        if (initialTab) {
          state.sidebarTab = initialTab;
          state.sidebarDesignOpen = false;
          state.sidebarScaleOpen = false;
          state.sidebarOpen = true;
        } else {
          state.sidebarOpen = !state.sidebarOpen;
          if (state.sidebarOpen) {
            state.sidebarTab = null;
            state.sidebarDesignOpen = false;
            state.sidebarScaleOpen = false;
          }
        }
        const drawer = document.getElementById("filterSidebarDrawer");
        const backdrop = document.getElementById("sidebarBackdrop");
        if (drawer) drawer.classList.toggle("open", Boolean(state.sidebarOpen));
        if (backdrop) backdrop.classList.toggle("open", Boolean(state.sidebarOpen));
        if (state.sidebarOpen) {
          renderFilterSidebarContent(Boolean(state.sidebarTab));
          if (!state.sidebarTab) {
            const firstCatTab = document.getElementById("sidebarCatTab_genres") || document.querySelector("#sidebarDrawerBody .ff-tab-btn");
            if (firstCatTab && typeof jumpSpatialFocus === "function") {
              jumpSpatialFocus(firstCatTab, false);
            }
          }
        } else {
          state.sidebarTab = null;
          state.sidebarDesignOpen = false;
          state.sidebarScaleOpen = false;
          if (typeof focusFirstResultCard === "function") {
            focusFirstResultCard(false);
          }
        }
      }

      function closeFilterSidebar() {
        state.sidebarOpen = false;
        state.sidebarTab = null;
        state.sidebarDesignOpen = false;
        state.sidebarScaleOpen = false;
        const drawer = document.getElementById("filterSidebarDrawer");
        const backdrop = document.getElementById("sidebarBackdrop");
        if (drawer) drawer.classList.remove("open");
        if (backdrop) backdrop.classList.remove("open");
        if (typeof focusFirstResultCard === "function") {
          focusFirstResultCard(false);
        }
      }

      function switchSidebarCategoryTab(tabName) {
        if (state.sidebarTab === tabName) {
          state.sidebarTab = null;
          renderFilterSidebarContent(false);
          const tabBtn = document.getElementById("sidebarCatTab_" + tabName);
          if (tabBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(tabBtn, false);
          }
        } else {
          state.sidebarTab = tabName;
          renderFilterSidebarContent(true);
        }
      }

      function toggleSidebarExtraSection(secName) {
        if (secName === "design") {
          state.sidebarDesignOpen = !state.sidebarDesignOpen;
          renderFilterSidebarContent(false);
          if (state.sidebarDesignOpen) {
            const firstBtn = document.querySelector("#sidebarDesignBody .btn");
            if (firstBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(firstBtn, true);
          } else {
            const hdrBtn = document.getElementById("sidebarSecBtn_design");
            if (hdrBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(hdrBtn, false);
          }
        } else if (secName === "scale") {
          state.sidebarScaleOpen = !state.sidebarScaleOpen;
          renderFilterSidebarContent(false);
          if (state.sidebarScaleOpen) {
            const firstBtn = document.querySelector("#sidebarScaleBody .btn");
            if (firstBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(firstBtn, true);
          } else {
            const hdrBtn = document.getElementById("sidebarSecBtn_scale");
            if (hdrBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(hdrBtn, false);
          }
        }
      }

      function renderFilterSidebarContent(jumpToOptions = false) {
        const body = document.getElementById("sidebarDrawerBody");
        if (!body) return;
        const s = state.settings || {};
        const curTab = state.sidebarTab || null;

        const gCount = (s.includedGenres || []).length + (s.excludedGenres || []).length;
        const pCount = (s.includedPlatforms || []).length + (s.excludedPlatforms || []).length;
        const eCount = (s.includedEras || []).length + (s.excludedEras || []).length;
        const stCount = (s.includedStudios || []).length + (s.excludedStudios || []).length;
        const fCount = (s.includedFsk || []).length + (s.excludedFsk || []).length + (s.showUnreleased ? 1 : 0);

        const buildScaleRow = (label, key, presets) => {
          const cur = Number(uiScale[key] || 100);
          return '<div class="scale-row">' +
            '<span class="scale-label">' + label + ' <b style="color:#a78bfa">' + cur + '%</b></span>' +
            '<div class="scale-opts">' +
              '<button id="sbScale_' + key + '_dec" class="btn" onclick="setUiScaleValue(\\'' + key + '\\',' + (cur - 5) + ')">➖</button>' +
              presets.map(p => '<button id="sbScale_' + key + '_' + p.v + '" class="btn ' + (cur === p.v ? 'purple' : '') + '" onclick="setUiScaleValue(\\'' + key + '\\',' + p.v + ')">' + p.l + '</button>').join("") +
              '<button id="sbScale_' + key + '_inc" class="btn" onclick="setUiScaleValue(\\'' + key + '\\',' + (cur + 5) + ')">➕</button>' +
            '</div>' +
          '</div>';
        };

        let catGridHtml = "";
        if (curTab === "genres") {
          const allGenreNames = Array.from(new Set([
            ...Object.keys(state.genres || {}),
            "Action", "Abenteuer", "Animation", "Komödie", "Krimi", "Dokumentarfilm", "Drama", "Familie", "Fantasy", "Historie", "Horror", "Musik", "Mystery", "Liebesfilm", "Sci-Fi", "Thriller", "Kriegsfilm", "Western",
            ...(s.includedGenres || []),
            ...(s.excludedGenres || [])
          ]));
          catGridHtml = '<div class="direct-filter-grid">' +
            allGenreNames.map(gName => {
              const isInc = (s.includedGenres || []).includes(gName);
              const isExc = (s.excludedGenres || []).includes(gName);
              return renderDirectFilterOptionCard("genre", gName, genreEmoji(gName) + " " + esc(gName), isInc, isExc);
            }).join("") +
          '</div>';
        } else if (curTab === "platforms") {
          catGridHtml = '<div class="direct-filter-grid">' +
            PLATFORM_OPTIONS_CLIENT.map(pl => {
              const isInc = (s.includedPlatforms || []).includes(pl.id);
              const isExc = (s.excludedPlatforms || []).includes(pl.id);
              return renderDirectFilterOptionCard("platform", pl.id, esc((pl.icon || "📺") + " " + pl.label), isInc, isExc);
            }).join("") +
          '</div>';
        } else if (curTab === "eras") {
          catGridHtml = '<div class="direct-filter-grid">' +
            ERA_OPTIONS_CLIENT.map(er => {
              const isInc = (s.includedEras || []).includes(er.id);
              const isExc = (s.excludedEras || []).includes(er.id);
              return renderDirectFilterOptionCard("era", er.id, "📅 " + esc(er.label), isInc, isExc);
            }).join("") +
          '</div>';
        } else if (curTab === "studios") {
          catGridHtml = '<div class="direct-filter-grid">' +
            STUDIO_OPTIONS_CLIENT.map(st => {
              const isInc = (s.includedStudios || []).includes(st.id);
              const isExc = (s.excludedStudios || []).includes(st.id);
              return renderDirectFilterOptionCard("studio", st.id, esc((st.icon || "🏢") + " " + st.label), isInc, isExc);
            }).join("") +
          '</div>';
        } else if (curTab === "fsk") {
          catGridHtml = '<div class="direct-filter-grid">' +
            FSK_OPTIONS_CLIENT.map(f => {
              const isInc = (s.includedFsk || []).includes(f);
              const isExc = (s.excludedFsk || []).includes(f);
              return renderDirectFilterOptionCard("fsk", f, "🔞 " + esc(f), isInc, isExc);
            }).join("") +
            renderDirectFilterOptionCard("unreleased", "unreleased", "🗓️ Unveröffentlicht", Boolean(s.showUnreleased), false) +
          '</div>';
        }

        const prevFocusDfId = (!jumpToOptions && typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.getAttribute)
          ? currentSpatialEl.getAttribute("data-df-id")
          : null;
        const prevFocusElId = (!jumpToOptions && typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.id)
          ? currentSpatialEl.id
          : null;

        const themeBadge = appTheme === "light" ? "☀️ Light" : appTheme === "cyberpunk" ? "⚡ Cyber" : "🌙 Dark";
        const scaleBadge = Number(uiScale.all || 100) + "%";
        const isAuth = Boolean(state && state.isAuthenticated && state.authUser);
        const u = (state && state.authUser) || {};
        const accLabel = isAuth
          ? ("🟢 " + (u.customUsername || (u.tgUsername ? "@" + u.tgUsername : ("ID " + u.telegramId))) + (u.isVip ? " 🌟VIP" : "") + (u.isAdmin ? " 👑" : ""))
          : "👤 Gast • Login";

        body.innerHTML =
          /* 0. Schnellzugriff & Konto (aus dem Header hierher aufgeräumt) */
          '<div class="sidebar-section">' +
            '<div class="sidebar-section-title">' +
              '<span>⚡ Schnellzugriff & Konto</span>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">' +
              '<button id="syncBadge" class="btn" style="grid-column:1 / -1;justify-content:space-between;color:' + (isAuth ? '#34d399' : '#fbbf24') + ';border-color:' + (isAuth ? 'rgba(16,185,129,0.4)' : 'rgba(251,191,36,0.4)') + '" onclick="closeFilterSidebar();openAccountModal()">' +
                '<span>' + esc(accLabel) + '</span><span>🔐 Account</span>' +
              '</button>' +
              '<button id="sidebarRandomBtn" class="btn amber" onclick="closeFilterSidebar();triggerRandom()" title="Zufälligen Titel mit aktiven Filtern ziehen">' +
                (state.type === 's' ? '🎲 Zufalls-Serie' : '🎲 Zufalls-Film') +
              '</button>' +
              '<button class="btn purple" onclick="closeFilterSidebar();loadFranchisesHub()" title="Alle Filmreihen & Filmuniversen öffnen">' +
                '🌌 Welten & Reihen' +
              '</button>' +
              '<button id="sidebarOpenInBotBtn" class="btn blue" onclick="closeFilterSidebar();openCurrentViewInBot()" title="Aktuelle Ansicht im Telegram-Bot öffnen">' +
                '🤖 Im Bot öffnen' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();loadSettingsView()" title="Alle Einstellungen öffnen">' +
                '⚙️ Einstellungen' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();goBack()" title="Zurück zur vorherigen Ansicht">' +
                '⬅️ Zurück' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();restartApp()" title="Alle aktiven Filter zurücksetzen & neu starten">' +
                '🔄 Neu starten' +
              '</button>' +
              (u.isAdmin ? (
                '<button id="adminHeaderBtn" class="btn amber" style="grid-column:1 / -1;justify-content:center" onclick="closeFilterSidebar();loadAdminPanelView()">👑 Admin-Panel & VIP-Verwaltung</button>'
              ) : '') +
            '</div>' +
          '</div>' +

          /* 1. Filter-Kategorien (kompakt, beim Öffnen eingeklappt) */
          '<div class="sidebar-section">' +
            '<div class="sidebar-section-title">' +
              '<span>🎛️ Filter</span>' +
              '<span style="font-size:10px;color:var(--text-muted)">✓ Positiv • ✕ Negativ</span>' +
            '</div>' +
            '<div style="display:flex;gap:5px;flex-wrap:wrap;' + (catGridHtml || isCurrentUserVip() ? 'margin-bottom:8px' : '') + '">' +
              '<button id="sidebarCatTab_genres" class="ff-tab-btn ' + (curTab === 'genres' ? 'open' : '') + (gCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'genres\\')">🎞️ Genres' + (gCount ? ' (' + gCount + ')' : '') + '</button>' +
              '<button id="sidebarCatTab_platforms" class="ff-tab-btn ' + (curTab === 'platforms' ? 'open' : '') + (pCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'platforms\\')">📺 Streaming' + (pCount ? ' (' + pCount + ')' : '') + '</button>' +
              '<button id="sidebarCatTab_eras" class="ff-tab-btn ' + (curTab === 'eras' ? 'open' : '') + (eCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'eras\\')">📅 Epochen' + (eCount ? ' (' + eCount + ')' : '') + '</button>' +
              '<button id="sidebarCatTab_studios" class="ff-tab-btn ' + (curTab === 'studios' ? 'open' : '') + (stCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'studios\\')">🏢 Studios' + (stCount ? ' (' + stCount + ')' : '') + '</button>' +
              '<button id="sidebarCatTab_fsk" class="ff-tab-btn ' + (curTab === 'fsk' ? 'open' : '') + (fCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'fsk\\')">🔞 FSK' + (fCount ? ' (' + fCount + ')' : '') + '</button>' +
            '</div>' +
            /* Optimierung #13: Exklusiver VIP-Filter "Nur Titel mit verfügbarem Stream anzeigen" */
            (isCurrentUserVip() ? (
              '<button id="sidebarVipStreamsOnlyBtn" class="btn ' + (s.onlyVipStreams ? 'amber' : '') + '" style="width:100%;justify-content:space-between;' + (catGridHtml ? 'margin-bottom:8px' : '') + '" onclick="setDirectFilter(\\'vip_streams\\',\\'\\',\\'toggle\\')">' +
                '<span>🌟 Nur mit VIP-Stream anzeigen</span>' +
                '<b>' + (s.onlyVipStreams ? 'AKTIV' : 'ALLE') + '</b>' +
              '</button>'
            ) : '') +
            catGridHtml +
          '</div>' +

          /* 2. Design & Ansicht (eingeklappt beim Öffnen) */
          '<div class="sidebar-section">' +
            '<button type="button" id="sidebarSecBtn_design" class="sidebar-collapse-btn" onclick="toggleSidebarExtraSection(\\'design\\')">' +
              '<span>🎨 Design & Ansicht</span>' +
              '<span class="sidebar-collapse-meta">' + themeBadge + ' ' + (state.sidebarDesignOpen ? '▾' : '▸') + '</span>' +
            '</button>' +
            (state.sidebarDesignOpen ? (
              '<div id="sidebarDesignBody" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08)">' +
                '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:6px">' +
                  '<button id="sidebarThemeBtn_dark" class="btn ' + (appTheme === 'dark' ? 'red' : '') + '" onclick="setAppTheme(\\'dark\\')">🌙 Dark</button>' +
                  '<button id="sidebarThemeBtn_light" class="btn ' + (appTheme === 'light' ? 'blue' : '') + '" onclick="setAppTheme(\\'light\\')">☀️ Light</button>' +
                  '<button id="sidebarThemeBtn_cyberpunk" class="btn ' + (appTheme === 'cyberpunk' ? 'purple' : '') + '" onclick="setAppTheme(\\'cyberpunk\\')">⚡ Cyber</button>' +
                '</div>' +
                '<button id="sidebarColorblindBtn" class="btn ' + (colorblindMode ? 'blue' : '') + '" style="width:100%;justify-content:space-between;margin-bottom:5px" onclick="toggleColorblindMode()">' +
                  '<span>👁️ Farbenblind-Modus</span>' +
                  '<b>' + (colorblindMode ? 'EIN' : 'AUS') + '</b>' +
                '</button>' +
                '<button id="sidebarMouseHoverNavBtn" class="btn ' + (mouseHoverNavEnabled ? 'green' : '') + '" style="width:100%;justify-content:space-between;margin-bottom:5px" onclick="toggleMouseHoverNav()">' +
                  '<span>🖱️ Maus-Hover Fokus</span>' +
                  '<b>' + (mouseHoverNavEnabled ? 'EIN' : 'AUS') + '</b>' +
                '</button>' +
                '<button id="sidebarModalHoldNavBtn" class="btn ' + (modalHoldNavEnabled ? 'green' : '') + '" style="width:100%;justify-content:space-between;margin-bottom:5px" onclick="toggleModalHoldNav()">' +
                  '<span>⏩ Pfeil halten (450ms) = Nächster</span>' +
                  '<b>' + (modalHoldNavEnabled ? 'EIN' : 'AUS') + '</b>' +
                '</button>' +
                '<button id="sidebarHeroToggleBtn" class="btn ' + (!state.heroHidden ? 'green' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleHeroSliderHidden()">' +
                  '<span>🎬 Empfehlungs-Slider</span>' +
                  '<b>' + (state.heroHidden ? 'AUS' : 'EIN') + '</b>' +
                '</button>' +
              '</div>'
            ) : '') +
          '</div>' +

          /* 3. Ansichtsgröße (eingeklappt beim Öffnen) */
          '<div class="sidebar-section">' +
            '<button type="button" id="sidebarSecBtn_scale" class="sidebar-collapse-btn" onclick="toggleSidebarExtraSection(\\'scale\\')">' +
              '<span>🔠 Größe</span>' +
              '<span class="sidebar-collapse-meta">' + scaleBadge + ' ' + (state.sidebarScaleOpen ? '▾' : '▸') + '</span>' +
            '</button>' +
            (state.sidebarScaleOpen ? (
              '<div id="sidebarScaleBody" style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08)">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
                  '<span style="font-size:10.5px;color:var(--text-muted)">Tastatur: <b>+</b> / <b>-</b></span>' +
                  '<button id="sidebarScaleResetBtn" class="btn" style="padding:2px 7px;font-size:10.5px" onclick="resetUiScale()">↺ 100%</button>' +
                '</div>' +
                buildScaleRow("📐 Gesamt", "all", [{l:"85%",v:85},{l:"100%",v:100},{l:"115%",v:115},{l:"130%",v:130}]) +
                buildScaleRow("🔤 Text", "text", [{l:"85%",v:85},{l:"100%",v:100},{l:"115%",v:115},{l:"130%",v:130}]) +
                buildScaleRow("🖼️ Cover", "cover", [{l:"80%",v:80},{l:"100%",v:100},{l:"125%",v:125},{l:"150%",v:150}]) +
                buildScaleRow("🎛️ Menü", "menu", [{l:"85%",v:85},{l:"100%",v:100},{l:"115%",v:115},{l:"125%",v:125}]) +
              '</div>'
            ) : '') +
          '</div>' +

          /* 4. Kompakte Fußzeile für Einstellungen & Account */
          '<div style="display:flex;gap:6px">' +
            '<button class="btn" style="flex:1" onclick="closeFilterSidebar();loadSettingsView()">⚙️ Einstellungen</button>' +
            '<button class="btn" style="flex:1" onclick="closeFilterSidebar();openAccountModal()">🔐 Account</button>' +
          '</div>';

        if (jumpToOptions) {
          focusFirstSidebarFilterOption();
        } else if (prevFocusDfId && typeof CSS !== "undefined" && CSS.escape) {
          const restoredEl = body.querySelector('[data-df-id="' + CSS.escape(prevFocusDfId) + '"]');
          if (restoredEl) setSpatialFocus(restoredEl, false);
        } else if (prevFocusElId) {
          const restoredById = document.getElementById(prevFocusElId);
          if (restoredById && body.contains(restoredById)) setSpatialFocus(restoredById, false);
        }
      }

      // =========================================================================
      // 2. LADEHINWEIS & ABORT-CONTROLLER FÜR BLITZSCHNELLERES FILTERN
      // =========================================================================
      let activeAbortController = null;
      function setBusyState(isBusy, messageText) {
        const bar = document.getElementById("busyOverlayBar");
        const txt = document.getElementById("busyOverlayText");
        const grid = document.getElementById("resultsGridContainer");
        if (txt && messageText) txt.textContent = messageText;
        if (bar) bar.classList.toggle("visible", Boolean(isBusy));
        if (grid) grid.classList.toggle("results-busy", Boolean(isBusy));
      }

      function openAccountModal() {
        const m = document.getElementById("modalRoot");
        if (!m) return;
        const isAuth = Boolean(state.isAuthenticated && state.authUser);
        const u = state.authUser || {};
        const canCreateOrUpdateAccount = Boolean(state.hasInitData || (isAuth && u.hasPasswordAccount));

        let bodyHtml = "";
        if (isAuth) {
          bodyHtml += '<div class="panel-box" style="border-color:rgba(16,185,129,0.35)">' +
            '<div style="font-size:13.5px;font-weight:800;color:#34d399;margin-bottom:6px">✅ Authentifiziertes Konto aktiv</div>' +
            '<div style="font-size:12px;color:#ddd;line-height:1.6">' +
              '<div>🆔 <b>Telegram-ID:</b> ' + esc(u.telegramId) + '</div>' +
              (u.tgUsername ? '<div>💬 <b>Telegram:</b> @' + esc(u.tgUsername) + '</div>' : '') +
              '<div>🔐 <b>Web-Account:</b> ' + (u.hasPasswordAccount ? ('<span style="color:#34d399">Abgesichert als <b>' + esc(u.customUsername) + '</b> (Login überall ohne initData möglich)</span>') : '<span style="color:#fbbf24">Noch kein Passwort gesetzt (Aktuell nur via Telegram initData zugänglich)</span>') + '</div>' +
              '<div>🛡️ <b>Zwei-Faktor-Schutz (2FA):</b> ' + (u.totpEnabled ? '<span style="color:#34d399;font-weight:800">🟢 TOTP 2FA Aktiv (Google Authenticator / Authy)</span>' : '<span style="color:#94a3b8">⚪ Optional (Nicht aktiviert)</span>') + '</div>' +
              '<div>🌟 <b>VIP-Status:</b> ' + (u.isVip ? '<span style="color:#fbbf24;font-weight:800">🌟 VIP Aktiv</span>' : 'Standard-Nutzer') + '</div>' +
              (u.isAdmin ? '<div>👑 <b>Rolle:</b> <span style="color:#f87171;font-weight:800">Autorisierter Administrator</span></div>' : '') +
            '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
              (u.isAdmin ? '<button class="btn amber" onclick="document.getElementById(\\'modalRoot\\').innerHTML=\\'\\';loadAdminPanelView()">👑 Admin-Panel öffnen</button>' : '') +
              '<button class="btn red" onclick="logoutWebSession()">🚪 Abmelden (In Gast-Modus wechseln)</button>' +
            '</div>' +
          '</div>';
        } else {
          bodyHtml += '<div class="panel-box" style="border-color:rgba(251,191,36,0.4)">' +
            '<div style="font-size:13.5px;font-weight:800;color:#fbbf24;margin-bottom:6px">👤 Gast-Modus (Ohne initData & ohne Account)</div>' +
            '<p style="font-size:12px;color:#ccc;line-height:1.5">' +
              'Du hast die Seite ohne Telegram <code>initData</code> und ohne eingeloggten Account geöffnet. ' +
              '<b>Du hast im Gast-Modus keinen Speicher (keine Merkliste) und kannst nicht auf fremde IDs zugreifen.</b><br><br>' +
              '👉 Wenn du deinen Account bereits in Telegram mit <b>Username & Passwort</b> abgesichert hast, kannst du dich hier direkt von überall einloggen:' +
            '</p>' +
            '<div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">' +
              '<input id="loginUsernameInp" placeholder="Username" style="padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:#141414;color:#fff;font-size:13px" />' +
              '<input id="loginPasswordInp" type="password" placeholder="Passwort" onkeydown="if(event.key===\\'Enter\\')submitWebLogin()" style="padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:#141414;color:#fff;font-size:13px" />' +
              '<div id="login2faWrap" style="display:none;flex-direction:column;gap:6px;padding:8px;border-radius:6px;background:rgba(91,70,245,0.14);border:1px solid rgba(91,70,245,0.4)">' +
                '<div style="font-size:11.5px;font-weight:700;color:#c4b5fd">🛡️ 2FA-Schutz aktiv: Bitte 6-stelligen Authenticator-Code eingeben</div>' +
                '<input id="loginTotpInp" placeholder="6-stelliger 2FA-Code (z. B. 123456)" maxlength="6" inputmode="numeric" onkeydown="if(event.key===\\'Enter\\')submitWebLogin()" style="padding:8px 10px;border-radius:6px;border:1px solid rgba(167,139,250,0.5);background:#141414;color:#fff;font-size:14px;letter-spacing:3px;font-weight:800;text-align:center" />' +
              '</div>' +
              '<button class="btn green" onclick="submitWebLogin()">🔑 Mit Username & Passwort einloggen</button>' +
              '<div id="loginModalFeedback" style="font-size:12px;color:#f87171"></div>' +
            '</div>' +
            '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);font-size:11.5px;color:#94a3b8">' +
              '🔒 <b>Neuen Account erstellen?</b> Das erstmalige Erstellen eines Accounts ist aus Sicherheitsgründen <u>nur</u> möglich, wenn du die Mini-App direkt über den Telegram-Bot (mit gültigem <code>initData</code>) öffnest.' +
            '</div>' +
          '</div>';
        }

        if (canCreateOrUpdateAccount) {
          bodyHtml += '<div class="panel-box">' +
            '<div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:6px">🔐 ' + (u.hasPasswordAccount ? 'Account-Zugangsdaten ändern' : 'Account jetzt absichern (Username & Passwort erstellen)') + '</div>' +
            '<p style="font-size:11.5px;color:#aaa;margin-bottom:10px">Sobald dein Account mit Username & Passwort abgesichert ist, brauchst du kein Telegram <code>initData</code> mehr und kannst dich auf jedem Gerät (TV, PC, Browser) einloggen.</p>' +
            '<div style="display:flex;flex-direction:column;gap:8px">' +
              '<input id="setAccUsernameInp" value="' + esc(u.customUsername || u.tgUsername || '') + '" placeholder="Gewünschter Username (3–32 Zeichen)" style="padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:#141414;color:#fff;font-size:13px" />' +
              '<input id="setAccPasswordInp" type="password" placeholder="Neues sicheres Passwort (mind. 6 Zeichen)" style="padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:#141414;color:#fff;font-size:13px" />' +
              '<button class="btn purple" onclick="submitSaveAccountCredentials()">💾 Account mit Username & Passwort absichern</button>' +
              '<div id="setAccFeedback" style="font-size:12px;color:#fbbf24"></div>' +
            '</div>' +
          '</div>';

          bodyHtml += '<div class="panel-box" style="border-color:rgba(91,70,245,0.35)">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
              '<div style="font-size:13px;font-weight:800;color:#c4b5fd">🛡️ Zwei-Faktor-Authentifizierung (TOTP 2FA)</div>' +
              '<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:' + (u.totpEnabled ? 'rgba(16,185,129,0.2);color:#34d399' : 'rgba(255,255,255,0.08);color:#94a3b8') + '">' +
                (u.totpEnabled ? '🟢 2FA AKTIV' : '⚪ INAKTIV') +
              '</span>' +
            '</div>' +
            '<p style="font-size:11.5px;color:#aaa;margin-bottom:10px">Schütze deinen Web-Login zusätzlich mit einem 6-stelligen Einmalcode (kompatibel mit Google Authenticator, Authy, 1Password & Apple Passwörter).</p>' +
            (u.totpEnabled ? (
              '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                '<input id="disable2faCodeInp" placeholder="6-stelliger 2FA-Code zur Bestätigung" maxlength="6" style="padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:#141414;color:#fff;font-size:12.5px;width:230px" />' +
                '<button class="btn red" onclick="disable2faProtection()">🔓 2FA deaktivieren</button>' +
              '</div>'
            ) : (
              '<div>' +
                '<button class="btn blue" onclick="start2faQrSetup()">📲 2FA jetzt mit QR-Code einrichten</button>' +
                '<div id="totpSetupMount" style="margin-top:10px"></div>' +
              '</div>'
            )) +
            '<div id="totpFeedback" style="font-size:12px;color:#fbbf24;margin-top:8px"></div>' +
          '</div>';
        }

        m.innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)this.parentElement.innerHTML=\\'\\'"><div class="modal"><div class="modal-body">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h2 style="font-size:18px">🔐 Account, Sicherheit & 2FA</h2><button class="btn" onclick="document.getElementById(\\'modalRoot\\').innerHTML=\\'\\'">✖</button></div>' +
          bodyHtml +
        '</div></div></div>';
      }

      async function start2faQrSetup() {
        const mount = document.getElementById("totpSetupMount");
        const fb = document.getElementById("totpFeedback");
        if (fb) { fb.style.color = "#fbbf24"; fb.textContent = "⏳ Generiere TOTP-Schlüssel & QR-Code..."; }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/2fa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "setup" })
          });
          if (!r || !r.ok) {
            if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + (r?.error || "2FA-Setup fehlgeschlagen."); }
            return;
          }
          if (fb) fb.textContent = "";
          if (mount) {
            mount.innerHTML = '<div style="background:#141414;border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center">' +
              '<div style="font-size:12px;color:#e2e8f0;font-weight:700">1. Scanne diesen QR-Code mit Google Authenticator oder Authy:</div>' +
              '<img src="' + esc(r.qrCodeUrl) + '" alt="TOTP QR Code" style="width:180px;height:180px;border-radius:8px;background:#fff;padding:6px" />' +
              '<div style="font-size:11px;color:#94a3b8">Manueller Setup-Schlüssel (Base32):<br><code style="color:#fbbf24;font-size:12px;user-select:all;letter-spacing:1px">' + esc(r.secret) + '</code></div>' +
              '<div style="font-size:12px;color:#e2e8f0;font-weight:700;margin-top:4px">2. Gib zur Aktivierung den 6-stelligen Code aus der App ein:</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
                '<input id="verifyTotpSetupInp" placeholder="123456" maxlength="6" inputmode="numeric" style="padding:8px 12px;border-radius:6px;border:1px solid rgba(16,185,129,0.5);background:#1c1c22;color:#fff;font-size:15px;letter-spacing:3px;font-weight:800;width:140px;text-align:center" />' +
                '<button class="btn green" onclick="confirm2faSetupEnable()">✅ Code prüfen & 2FA aktivieren</button>' +
              '</div>' +
            '</div>';
          }
        } catch (err) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + err.message; }
        }
      }

      async function confirm2faSetupEnable() {
        const inp = document.getElementById("verifyTotpSetupInp");
        const fb = document.getElementById("totpFeedback");
        const code = (inp ? inp.value : "").trim();
        if (!/^\d{6}$/.test(code)) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "⚠️ Bitte einen gültigen 6-stelligen Zahlencode eingeben."; }
          return;
        }
        if (fb) { fb.style.color = "#fbbf24"; fb.textContent = "⏳ Prüfe TOTP-Code..."; }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/2fa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "enable", code })
          });
          if (!r || !r.ok) {
            if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + (r?.error || "Ungültiger Code."); }
            return;
          }
          state.authUser = r.user;
          updateSyncBadge();
          openAccountModal();
        } catch (err) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + err.message; }
        }
      }

      async function disable2faProtection() {
        const inp = document.getElementById("disable2faCodeInp");
        const fb = document.getElementById("totpFeedback");
        const code = (inp ? inp.value : "").trim();
        if (fb) { fb.style.color = "#fbbf24"; fb.textContent = "⏳ Deaktiviere 2FA..."; }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/2fa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "disable", code })
          });
          if (!r || !r.ok) {
            if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + (r?.error || "Konnte 2FA nicht deaktivieren."); }
            return;
          }
          state.authUser = r.user;
          updateSyncBadge();
          openAccountModal();
        } catch (err) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + err.message; }
        }
      }

      async function submitWebLogin() {
        const uInp = document.getElementById("loginUsernameInp");
        const pInp = document.getElementById("loginPasswordInp");
        const tInp = document.getElementById("loginTotpInp");
        const tWrap = document.getElementById("login2faWrap");
        const fb = document.getElementById("loginModalFeedback");
        const username = (uInp ? uInp.value : "").trim();
        const password = pInp ? pInp.value : "";
        const totpCode = (tInp ? tInp.value : "").trim();
        if (!username || !password) {
          if (fb) fb.textContent = "⚠️ Bitte Username und Passwort eingeben.";
          return;
        }
        if (fb) { fb.style.color = "#fbbf24"; fb.textContent = "⏳ Prüfe Zugangsdaten..."; }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, totpCode })
          });
          if (r && r.requires2fa) {
            if (tWrap) tWrap.style.display = "flex";
            if (tInp) tInp.focus();
            if (fb) {
              fb.style.color = r.error ? "#f87171" : "#c4b5fd";
              fb.textContent = r.error ? ("❌ " + r.error) : "🛡️ Passwort korrekt! Bitte jetzt deinen 6-stelligen 2FA-Code eingeben.";
            }
            return;
          }
          if (!r || !r.ok) {
            if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + (r?.error || "Login fehlgeschlagen."); }
            return;
          }
          sessionToken = r.sessionToken || "";
          try { localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
          state.isAuthenticated = true;
          state.authUser = r.user;
          chatId = String(r.user.telegramId);
          clearClientMediaCaches();
          updateSyncBadge();
          document.getElementById("modalRoot").innerHTML = "";
          loadDiscover(state.type, state.genreId, state.mode, state.sort);
        } catch (err) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + err.message; }
        }
      }

      async function submitSaveAccountCredentials() {
        const uInp = document.getElementById("setAccUsernameInp");
        const pInp = document.getElementById("setAccPasswordInp");
        const fb = document.getElementById("setAccFeedback");
        const customUsername = (uInp ? uInp.value : "").trim();
        const password = pInp ? pInp.value : "";
        if (!customUsername || password.length < 6) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "⚠️ Username (mind. 3 Zeichen) und Passwort (mind. 6 Zeichen) erforderlich."; }
          return;
        }
        if (fb) { fb.style.color = "#fbbf24"; fb.textContent = "⏳ Verschlüssele Passwort (PBKDF2-SHA256) & sichere Account..."; }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/set-account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customUsername, password })
          });
          if (!r || !r.ok) {
            if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + (r?.error || "Speichern fehlgeschlagen."); }
            return;
          }
          if (r.sessionToken) {
            sessionToken = r.sessionToken;
            try { localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
          }
          state.authUser = r.user;
          updateSyncBadge();
          if (fb) { fb.style.color = "#34d399"; fb.textContent = "✅ Account erfolgreich abgesichert! Du kannst dich jetzt von überall (auch ohne Telegram initData) als „" + customUsername + "“ einloggen."; }
        } catch (err) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + err.message; }
        }
      }

      function logoutWebSession() {
        sessionToken = "";
        try { localStorage.removeItem("tma_session_token"); } catch (e) {}
        if (!rawInitData) {
          state.isAuthenticated = false;
          state.authUser = null;
          chatId = "guest";
        }
        clearClientMediaCaches();
        updateSyncBadge();
        document.getElementById("modalRoot").innerHTML = "";
        goHome();
      }

      function esc(str) {
        return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }

      function openLightbox(imgUrl, titleText) {
        if (!imgUrl) return;
        const lb = document.getElementById("lightboxRoot");
        if (!lb) return;
        lb.innerHTML = '<div class="lightbox-backdrop" onclick="if(event.target===this)closeLightbox()">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;width:100%;max-width:680px;margin-bottom:10px;gap:8px">' +
            '<div style="font-size:13.5px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(titleText || 'Großansicht') + '</div>' +
            '<div style="display:flex;gap:6px">' +
              '<button class="btn" onclick="const im=document.getElementById(\\'lbImg\\');if(im)im.classList.toggle(\\'zoomed\\')">🔍 Zoom</button>' +
              '<button class="btn red" onclick="closeLightbox()">✖ Schließen</button>' +
            '</div>' +
          '</div>' +
          '<img id="lbImg" class="lightbox-img" src="' + esc(imgUrl) + '" onclick="this.classList.toggle(\\'zoomed\\')" alt="Poster" />' +
          '<div style="font-size:11px;color:#aaa;margin-top:8px">💡 Auf das Bild tippen zum Vergrößern / Verkleinern</div>' +
        '</div>';
      }
      function closeLightbox() {
        const lb = document.getElementById("lightboxRoot");
        if (lb) lb.innerHTML = "";
      }

      let filterClickSeq = 0;
      let sidebarFilterDebounceTimer = null;
      let liveSearchDebounceTimer = null;
      let heroTouchStartX = 0;
      let modalTouchStartX = 0;
      let lastModalTriggerKey = "";
      let lastModalTriggerEl = null;

      // Clientseitiger Instant-Cache (5 Min TTL) für Detailansichten & Staffeln (#3)
      const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
      const clientDetailsCache = new Map();
      const clientSeasonCache = new Map();

      function clearClientMediaCaches() {
        clientDetailsCache.clear();
        clientSeasonCache.clear();
      }

      // Prüft strikt, ob der aktuelle Nutzer VIP-Mitglied (oder Admin) ist:
      // Qualitäten & Streams werden ausschließlich VIP-Mitgliedern angezeigt!
      function isCurrentUserVip() {
        return Boolean(state && state.isAuthenticated && state.authUser && (state.authUser.isVip || state.authUser.isAdmin));
      }

      function saveModalReturnFocusTarget(typeCode, id) {
        const modalEl = document.getElementById("modalRoot");
        const modalAlreadyOpen = Boolean(modalEl && modalEl.innerHTML.trim());
        if (!modalAlreadyOpen) {
          lastModalTriggerKey = (typeCode && id) ? (typeCode + "_" + id) : "";
          lastModalTriggerEl = (typeof currentSpatialEl !== "undefined" && currentSpatialEl) ? currentSpatialEl : null;
        } else if (typeCode && id) {
          lastModalTriggerKey = typeCode + "_" + id;
        }
      }

      function closeDetailModal() {
        const m = document.getElementById("modalRoot");
        if (m) m.innerHTML = "";
        if (lastModalTriggerKey) {
          const cardEl = document.querySelector('.card[data-card-key="' + lastModalTriggerKey + '"]');
          if (cardEl && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(cardEl, true);
            return;
          }
        }
        if (lastModalTriggerEl && document.body.contains(lastModalTriggerEl) && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(lastModalTriggerEl, true);
          return;
        }
        if (typeof focusFirstResultCard === "function") {
          focusFirstResultCard(false);
        }
      }

      let recentViewedList = (function() {
        try {
          const r = JSON.parse(localStorage.getItem("tma_recent_viewed") || "[]");
          return Array.isArray(r) ? r.slice(0, 12) : [];
        } catch (e) { return []; }
      })();
      let savedKeysSet = new Set();

      function addRecentViewedItem(d, typeCode) {
        if (!d || !d.id) return;
        let posterUrl = "";
        if (d.poster_path) {
          posterUrl = String(d.poster_path).startsWith("http")
            ? d.poster_path
            : ("https://image.tmdb.org/t/p/w185" + d.poster_path);
        } else if (d.poster) {
          posterUrl = d.poster;
        }
        const entry = {
          id: Number(d.id),
          type: typeCode === "s" ? "s" : "m",
          title: String(d.title || d.name || "Titel").slice(0, 60),
          poster: posterUrl
        };
        recentViewedList = [entry, ...recentViewedList.filter(x => !(x.id === entry.id && x.type === entry.type))].slice(0, 10);
        try { localStorage.setItem("tma_recent_viewed", JSON.stringify(recentViewedList)); } catch (e) {}
        refreshRecentViewedStripDom();
      }

      function removeRecentViewedItem(ev, typeCode, id) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const tc = typeCode === "s" ? "s" : "m";
        const numId = Number(id);
        recentViewedList = recentViewedList.filter(x => !(x.type === tc && Number(x.id) === numId));
        try { localStorage.setItem("tma_recent_viewed", JSON.stringify(recentViewedList)); } catch (e) {}
        refreshRecentViewedStripDom();
        showHudToast("🗑️ Aus „Zuletzt angesehen“ entfernt");
      }

      function clearAllRecentViewed() {
        recentViewedList = [];
        try { localStorage.removeItem("tma_recent_viewed"); } catch (e) {}
        refreshRecentViewedStripDom();
        showHudToast("🗑️ Verlauf „Zuletzt angesehen“ geleert");
      }

      function buildRecentViewedStripHtml() {
        if (state.isSearchMode || state.currentView !== "discover" || !recentViewedList.length) return "";
        return '<div class="recent-strip">' +
          '<button type="button" class="btn red" style="padding:2px 7px;font-size:11px;flex-shrink:0" onclick="clearAllRecentViewed()" title="Gesamten Verlauf leeren">🗑️</button>' +
          '<span style="font-size:11px;font-weight:800;color:var(--text-muted);flex-shrink:0">🕒 Zuletzt:</span>' +
          recentViewedList.slice(0, 8).map(rv =>
            '<div class="recent-chip" tabindex="0" onclick="openDetails(\\'' + esc(rv.type) + '\\',' + Number(rv.id) + ',false)" title="' + esc(rv.title) + '">' +
              (rv.poster ? '<img src="' + esc(rv.poster) + '" alt="" loading="lazy" />' : '<span>' + (rv.type === 's' ? '📺' : '🎬') + '</span>') +
              '<span style="max-width:130px;overflow:hidden;text-overflow:ellipsis">' + esc(rv.title) + '</span>' +
              '<button type="button" class="recent-chip-del" tabindex="-1" onclick="removeRecentViewedItem(event,\\'' + esc(rv.type) + '\\',' + Number(rv.id) + ')" title="Diesen Eintrag entfernen">✕</button>' +
            '</div>'
          ).join("") +
        '</div>';
      }

      function refreshRecentViewedStripDom() {
        const mount = document.getElementById("recentViewedMount");
        if (mount) {
          mount.innerHTML = buildRecentViewedStripHtml();
        }
      }

      async function playInstantTrailerFromCard(ev, typeCode, id, titleText, posterPath) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const tc = typeCode === "s" ? "s" : "m";
        saveModalReturnFocusTarget(tc, id);
        if (id) {
          addRecentViewedItem({ id, title: titleText || "Titel", poster_path: posterPath || "" }, tc);
        }
        const cacheKey = tc + "_" + id + "_" + (isCurrentUserVip() ? "vip" : "std");
        const cachedEntry = clientDetailsCache.get(cacheKey);
        const hasValidCache = Boolean(cachedEntry && (Date.now() - cachedEntry.ts < CLIENT_CACHE_TTL_MS));
        if (!hasValidCache) {
          setBusyState(true, "🎬 Lade Instant-Trailer (" + getTrailerProviderLabel(trailerProvider) + ")...");
        }
        try {
          const d = hasValidCache
            ? cachedEntry.data
            : await apiFetchJson(API_BASE + "/details?chatId=" + encodeURIComponent(chatId) + "&type=" + tc + "&id=" + id);
          if (!hasValidCache && d && d.ok !== false) {
            clientDetailsCache.set(cacheKey, { data: d, ts: Date.now() });
          }
          state.activeDetails = { ...d, typeCode: tc, id: d.id || id };
          addRecentViewedItem(d, tc);
          const tr = d.trailers || null;
          const m = document.getElementById("modalRoot");
          if (!tr || !tr.embeds) {
            const ytSearchQuery = encodeURIComponent((d.title || titleText || '') + ' ' + (d.year && d.year !== 'K.A.' ? d.year : '') + ' Trailer Deutsch');
            const ytSearchUrl = 'https://www.youtube.com/results?search_query=' + ytSearchQuery;
            m.innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeDetailModal()">' +
              '<div class="modal" style="max-width:680px">' +
                '<div class="modal-body">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">' +
                    '<div style="font-size:15px;font-weight:900">🎬 Trailer: ' + esc(d.title || titleText || 'Titel') + '</div>' +
                    '<button class="btn red" onclick="closeDetailModal()">✖</button>' +
                  '</div>' +
                  '<p style="font-size:12.5px;color:#cbd5e1;margin-bottom:12px">Für diesen Titel ist aktuell kein direkter TMDB-Trailer hinterlegt. Du kannst direkt auf YouTube suchen oder die Detailansicht öffnen:</p>' +
                  '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                    '<a class="btn red" href="' + esc(ytSearchUrl) + '" target="_blank" rel="noopener noreferrer">🔎 Auf YouTube suchen</a>' +
                    '<button class="btn purple" onclick="openDetails(\\'' + tc + '\\',' + Number(d.id || id) + ',false)">ℹ️ Vollständige Details öffnen</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>';
            return;
          }
          const activeProviderKey = (tr.embeds && tr.embeds[trailerProvider]) ? trailerProvider : "youtube";
          const embedUrl = tr.embeds[activeProviderKey] || tr.embeds.youtube;
          m.innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeDetailModal()">' +
            '<div class="modal" style="max-width:860px">' +
              '<div class="modal-body" style="padding:14px">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
                  '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                    '<span class="hero-badge ' + (tc === 's' ? 'series' : 'movie') + '">' + (tc === 's' ? '📺 SERIE' : '🎬 FILM') + '</span>' +
                    '<strong style="font-size:15px;font-weight:900">' + esc(d.title || titleText || 'Trailer') + (d.year && d.year !== 'K.A.' ? ' (' + esc(d.year) + ')' : '') + '</strong>' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;align-items:center">' +
                    '<button class="btn purple" onclick="openDetails(\\'' + tc + '\\',' + Number(d.id || id) + ',false)">ℹ️ Alle Details</button>' +
                    '<button class="btn blue" onclick="openInBot(\\'' + tc + '_' + Number(d.id || id) + '\\')" title="Im Telegram-Bot öffnen">🤖</button>' +
                    '<button class="btn red" onclick="closeDetailModal()" title="Schließen">✖</button>' +
                  '</div>' +
                '</div>' +
                '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:6px">' +
                  '<span style="font-size:11px;color:var(--text-muted);margin-right:4px">⚡ Standard-Quelle wählen:</span>' +
                  TRAILER_PROVIDERS_CLIENT.map(tp =>
                    '<button class="btn ' + (trailerProvider === tp.id ? 'red' : '') + '" style="padding:3px 8px;font-size:11px" data-tp-id="' + esc(tp.id) + '" onclick="switchInstantTrailerModalProvider(\\'' + esc(tp.id) + '\\')">' + esc(tp.label) + (trailerProvider === tp.id ? ' ✓ Standard' : '') + '</button>'
                  ).join("") +
                '</div>' +
                '<div id="trailerEmbedContainer">' +
                  '<div class="embed-box" style="margin-top:4px"><iframe class="embed-frame" src="' + esc(embedUrl) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
        } finally {
          setBusyState(false);
        }
      }

      function switchInstantTrailerModalProvider(sourceKey) {
        setTrailerProvider(sourceKey);
        switchEmbedSource(sourceKey, false);
        const modalBtns = document.querySelectorAll("#modalRoot button[data-tp-id]");
        modalBtns.forEach(b => {
          const pid = b.getAttribute("data-tp-id") || "";
          const tpObj = TRAILER_PROVIDERS_CLIENT.find(x => x.id === pid);
          const isMatch = pid === sourceKey;
          b.className = "btn " + (isMatch ? "red" : "");
          if (tpObj) b.textContent = tpObj.label + (isMatch ? " ✓ Standard" : "");
        });
      }

      // Universelle Client-Hilfsfunktion: Normalisiert TMDb-Poster-Pfade UND volle Fallback-URLs (OMDb, Wikidata, TVMaze)
      function resolvePosterUrlClient(posterPathOrUrl, size, fallbackUrl) {
        const sz = size || "w342";
        const raw = String(posterPathOrUrl || fallbackUrl || "").trim();
        if (!raw) return "";
        if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
        if (raw.startsWith("/")) return "https://image.tmdb.org/t/p/" + sz + raw;
        return "https://image.tmdb.org/t/p/" + sz + "/" + raw;
      }

      // Live-Synchronisation eines im Detail-Modal nachgeladenen Posters zurück in Katalog-Karten, Merkliste & Admin-Liste
      function syncCardPosterInDom(typeCode, id, resolvedPosterUrl) {
        if (!id || !resolvedPosterUrl) return;
        const key = (typeCode === "s" ? "s" : "m") + "_" + id;
        document.querySelectorAll('.card[data-card-key="' + key + '"] img').forEach(img => {
          const curSrc = img.getAttribute("src") || "";
          if (!curSrc || curSrc.includes("via.placeholder.com")) {
            img.setAttribute("src", resolvedPosterUrl);
          }
        });
        if (Array.isArray(state.items)) {
          state.items.forEach(it => {
            if (it && String(it.id) === String(id) && !it.poster_path && !it.external_poster_url) {
              it.poster_path = resolvedPosterUrl;
            }
          });
        }
        if (Array.isArray(state.cachedWishlistItems)) {
          state.cachedWishlistItems.forEach(it => {
            if (it && String(it.tmdbId) === String(id) && !it.poster) {
              it.poster = resolvedPosterUrl;
            }
          });
        }
      }

      // Klappt die Episodenliste (S01E01 – Titel) einer Serie in Playlisten / Merkliste / Admin-Editor auf oder zu
      function toggleSeriesEpisodesDrawerClient(ev, drawerId) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const box = document.getElementById("epDrawer_" + drawerId);
        const icon = document.getElementById("epDrawerIcon_" + drawerId);
        if (!box) return;
        const isHidden = box.style.display === "none";
        box.style.display = isHidden ? "flex" : "none";
        if (icon) icon.textContent = isHidden ? "▴" : "▾";
      }

      // Live-Synchronisation des Favoriten-Badges (🔖 / ✓) zwischen Detail-Modal, Hintergrund-Grid & Cache (#6)
      function syncCardWishlistBadgeInDom(typeCode, id, isSaved, triggerPop = false) {
        const key = (typeCode === "s" ? "s" : "m") + "_" + id;
        if (isSaved) savedKeysSet.add(key);
        else savedKeysSet.delete(key);
        document.querySelectorAll('.card[data-card-key="' + key + '"] .card-quick-save').forEach(btn => {
          btn.classList.toggle("saved", Boolean(isSaved));
          btn.textContent = isSaved ? "✓" : "🔖";
          if (triggerPop) {
            btn.classList.remove("quick-save-pop");
            void btn.offsetWidth; // Reflow erzwingen für erneute CSS-Keyframe-Animation
            btn.classList.add("quick-save-pop");
            setTimeout(() => {
              btn.classList.remove("quick-save-pop");
            }, 360);
          }
        });
        // Detail-Modal Button mitsynchronisieren, falls Modal für diesen Titel aktuell geöffnet ist
        if (state && state.activeDetails && String(state.activeDetails.id) === String(id) && state.activeDetails.typeCode === typeCode) {
          state.activeDetails.isSaved = Boolean(isSaved);
          const modalBtn = document.getElementById("modalWishlistBtn");
          if (modalBtn) {
            modalBtn.className = "btn " + (isSaved ? "green" : "");
            modalBtn.textContent = isSaved ? "✅ Gespeichert" : "💾 Merkliste";
          }
        }
        for (const [cKey, cVal] of clientDetailsCache.entries()) {
          if (cKey.startsWith(key + "_") && cVal && cVal.data) {
            cVal.data.isSaved = Boolean(isSaved);
          }
        }
      }

      async function quickToggleCardWishlist(ev, typeCode, id, titleText) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        if (!state.isAuthenticated) { openAccountModal(); return; }

        const cardKey = (typeCode === "s" ? "s" : "m") + "_" + id;
        const prevSaved = savedKeysSet.has(cardKey);
        const nextSaved = !prevSaved;

        // 1. Sofortiges optimistisches UI-Update und Pop-Animation auf dem Cover
        syncCardWishlistBadgeInDom(typeCode, id, nextSaved, true);
        showHudToast((nextSaved ? "💾 Gespeichert: " : "🗑️ Entfernt: ") + (titleText || "Titel"));

        // 2. Sofortiges Haptik-Feedback
        try {
          if (tg && tg.HapticFeedback && typeof tg.HapticFeedback.impactOccurred === "function") {
            tg.HapticFeedback.impactOccurred("medium");
          } else if (navigator.vibrate) {
            navigator.vibrate(30);
          }
        } catch (e) {}

        // 3. Im Hintergrund synchronisieren mit automatischem Rollback im Fehlerfall
        try {
          const r = await apiFetchJson(API_BASE + "/wishlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, action: "toggle_item", type: typeCode, id })
          });
          const serverSaved = Boolean(r && r.saved);
          if (serverSaved !== nextSaved) {
            syncCardWishlistBadgeInDom(typeCode, id, serverSaved, false);
          }
        } catch (e) {
          syncCardWishlistBadgeInDom(typeCode, id, prevSaved, false);
          showHudToast("⚠️ Fehler beim Aktualisieren der Merkliste");
        }
      }

      // Mobile Long-Press (~420ms) auf Katalog-Karten zum direkten Speichern/Entfernen in der Merkliste
      let cardLongPressTimer = null;
      let cardLongPressStartX = 0;
      let cardLongPressStartY = 0;
      let cardLongPressTarget = null;
      let cardLongPressTriggered = false;
      let lastCardLongPressAt = 0;

      function clearCardLongPressTimer() {
        if (cardLongPressTimer) {
          clearTimeout(cardLongPressTimer);
          cardLongPressTimer = null;
        }
        if (cardLongPressTarget) {
          cardLongPressTarget.classList.remove("long-press-active");
          cardLongPressTarget = null;
        }
      }

      // Unterdrückt das native Browser-/OS-Bildmenü ("Öffnen in... / Download / Link kopieren") und Textmarkierung auf Karten
      document.addEventListener("contextmenu", function(ev) {
        const card = ev.target && ev.target.closest ? ev.target.closest(".card") : null;
        if (card) {
          ev.preventDefault();
          ev.stopPropagation();
          return false;
        }
      }, { capture: true, passive: false });

      document.addEventListener("selectstart", function(ev) {
        const el = ev.target && ev.target.nodeType === 1 ? ev.target : (ev.target && ev.target.parentElement ? ev.target.parentElement : null);
        if (el && el.closest && el.closest(".card")) {
          ev.preventDefault();
        }
      }, { passive: false });

      document.addEventListener("touchstart", function(ev) {
        if (!ev.touches || ev.touches.length !== 1) return;
        if (ev.target && ev.target.closest && ev.target.closest("button, a, select, input")) return;
        const card = ev.target && ev.target.closest ? ev.target.closest(".card[data-card-key]") : null;
        if (!card) return;
        const rawKey = card.getAttribute("data-card-key") || "";
        const parts = rawKey.split("_");
        if (parts.length < 2) return;
        const tc = parts[0] === "s" ? "s" : "m";
        const idNum = Number(parts[1]);
        if (!idNum) return;
        const titleEl = card.querySelector(".card-title");
        const titleTxt = card.getAttribute("data-card-title") || (titleEl ? titleEl.textContent : "") || "Titel";

        clearCardLongPressTimer();
        cardLongPressTriggered = false;
        cardLongPressStartX = ev.touches[0].clientX;
        cardLongPressStartY = ev.touches[0].clientY;
        cardLongPressTarget = card;

        cardLongPressTimer = setTimeout(function() {
          cardLongPressTimer = null;
          cardLongPressTriggered = true;
          lastCardLongPressAt = Date.now();
          if (cardLongPressTarget) {
            cardLongPressTarget.classList.add("long-press-active");
            setTimeout(() => {
              if (card) card.classList.remove("long-press-active");
            }, 240);
          }
          quickToggleCardWishlist(null, tc, idNum, titleTxt);
        }, 420);
      }, { passive: true });

      document.addEventListener("touchmove", function(ev) {
        if (!cardLongPressTimer || !ev.touches || !ev.touches[0]) return;
        const dx = ev.touches[0].clientX - cardLongPressStartX;
        const dy = ev.touches[0].clientY - cardLongPressStartY;
        // Euklidische Distanz: 22px Bewegungstoleranz (dx² + dy² > 484) gegen Android-Finger-Mikrojitter
        if ((dx * dx + dy * dy) > 484) {
          clearCardLongPressTimer();
        }
      }, { passive: true });

      document.addEventListener("touchend", function(ev) {
        if (cardLongPressTriggered) {
          lastCardLongPressAt = Date.now();
          cardLongPressTriggered = false;
          if (ev && ev.cancelable) ev.preventDefault();
        }
        clearCardLongPressTimer();
      }, { passive: false });

      document.addEventListener("touchcancel", function() {
        cardLongPressTriggered = false;
        clearCardLongPressTimer();
      }, { passive: true });

      let state = {
        type: "m",
        genreId: "all",
        mode: "trend",
        sort: "default",
        startPage: 1,
        page: 1,
        totalPages: 1,
        totalResults: 0,
        hasMorePages: false,
        loadingMore: false,
        items: [],
        genres: {},
        settings: {},
        history: [],
        wlFolder: "root",
        wlFilterType: "all",
        wlSort: "added_desc",
        wlSearchQuery: "",
        wlLetter: "ALL",
        cachedWishlistItems: [],
        cachedWishlistFolders: [],
        activeDetails: null,
        pendingTmdbToken: "",
        franchiseTab: "collections",
        worldsTrayOpen: false,
        worldsTrayTab: "universes",
        worldsTrayQuery: "",
        worldsTrayRemoteCols: [],
        openFilterDropdown: null,
        sidebarOpen: false,
        sidebarTab: null,
        sidebarDesignOpen: false,
        sidebarScaleOpen: false,
        isSearchMode: false,
        searchFocused: false,
        searchQuery: "",
        searchScope: "all",
        searchMatchedCollections: [],
        searchMatchedUniverses: [],
        searchMatchedPersons: [],
        searchMatchedStudios: [],
        searchEntitiesExpanded: false,
        filtersCollapsedInSearch: false,
        scalePanelOpen: false,
        heroSlides: [],
        heroIndex: 0,
        heroActionsEngaged: false,
        heroHidden: (function() {
          try { return localStorage.getItem("tma_hero_hidden") === "1"; } catch (e) { return false; }
        })(),
        isAuthenticated: false,
        hasInitData: Boolean(rawInitData),
        authUser: null,
        adminTab: "users",
        adminMediaType: "m",
        currentView: "discover",
        currentCollectionId: null,
        currentCollectionName: "",
        currentUniverseId: null,
        currentUniverseName: "",
        currentPersonId: null,
        currentPersonName: "",
        currentCompanyId: null,
        currentCompanyName: "",
        botUsername: ""
      };

      // =========================================================================
      // 3. FLIXNET-STYLE HERO-SHOWCASE (6 HIGHLIGHTS + PILL-DOTS + 1-ZEILEN SPOTLIGHT-STRIP)
      // =========================================================================
      let heroRotationTimer = null;
      function rebuildHeroSlides(itemsList) {
        const withBackdrop = (itemsList || []).filter(i => i && (i.backdrop_path || i.poster_path));
        if (withBackdrop.length <= 6) {
          state.heroSlides = withBackdrop.slice(0, 6);
        } else {
          const pool = withBackdrop.slice(0, 14);
          const picked = [];
          while (picked.length < 6 && pool.length > 0) {
            const idx = Math.floor(Math.random() * pool.length);
            picked.push(pool.splice(idx, 1)[0]);
          }
          state.heroSlides = picked;
        }
        state.heroIndex = 0;
        state.heroActionsEngaged = false;
        startHeroRotationTimer();
      }

      function startHeroRotationTimer() {
        if (heroRotationTimer) clearInterval(heroRotationTimer);
        if (state.heroHidden || state.isSearchMode || state.searchFocused || state.heroSlides.length <= 1) return;
        heroRotationTimer = setInterval(() => {
          if (state.heroHidden || state.isSearchMode || state.searchFocused || state.heroSlides.length <= 1) return;
          if (typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#heroBannerSlot")) {
            return;
          }
          state.heroIndex = (state.heroIndex + 1) % state.heroSlides.length;
          state.heroActionsEngaged = false;
          updateHeroBannerDomOnly();
        }, 7000);
      }

      function setHeroSlideIndex(idx) {
        if (!state.heroSlides.length) return;
        state.heroIndex = (idx + state.heroSlides.length) % state.heroSlides.length;
        state.heroActionsEngaged = false;
        updateHeroBannerDomOnly();
        startHeroRotationTimer();
      }

      function selectHeroSlideCard(idx) {
        if (!state.heroSlides.length) return;
        state.heroIndex = (idx + state.heroSlides.length) % state.heroSlides.length;
        state.heroActionsEngaged = true;
        updateHeroBannerDomOnly();
        startHeroRotationTimer();
        const trBtn = document.getElementById("heroBtnTrailer") || document.getElementById("heroBtnDetails");
        if (trBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(trBtn, false);
        }
      }

      function toggleHeroSliderHidden(forceHide) {
        state.heroHidden = typeof forceHide === "boolean" ? forceHide : !state.heroHidden;
        state.heroActionsEngaged = false;
        try { localStorage.setItem("tma_hero_hidden", state.heroHidden ? "1" : "0"); } catch (e) {}
        updateHeroBannerDomOnly();
        if (state.sidebarOpen) {
          renderFilterSidebarContent(false);
          const sbHeroBtn = document.getElementById("sidebarHeroToggleBtn");
          if (sbHeroBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(sbHeroBtn, false);
        }
        if (state.currentView === "settings") {
          const stHeroBtn = document.getElementById("settingsHeroToggleBtn");
          if (stHeroBtn) {
            stHeroBtn.className = "btn " + (!state.heroHidden ? "green" : "");
            stHeroBtn.innerHTML = '<span>🎬 Empfehlungs-Slider auf der Startseite</span><b>' + (state.heroHidden ? 'AUSGEBLENDET' : 'SICHTBAR') + '</b>';
            if (!state.sidebarOpen && typeof jumpSpatialFocus === "function") jumpSpatialFocus(stHeroBtn, false);
          }
        }
        if (state.heroHidden) {
          if (heroRotationTimer) clearInterval(heroRotationTimer);
          showHudToast("🎬 Slider zu kompakter Spotlight-Zeile eingeklappt");
          if (!state.sidebarOpen && state.currentView !== "settings") {
            const restoreBtn = document.getElementById("heroRestoreBtn");
            if (restoreBtn && typeof jumpSpatialFocus === "function") {
              jumpSpatialFocus(restoreBtn, false);
            }
          }
        } else {
          startHeroRotationTimer();
          showHudToast("🎬 Empfehlungs-Slider ausgeklappt");
          if (!state.sidebarOpen && state.currentView !== "settings") {
            const hideBtn = document.getElementById("heroHideBtn");
            if (hideBtn && typeof jumpSpatialFocus === "function") {
              jumpSpatialFocus(hideBtn, false);
            }
          }
        }
      }

      function onHeroTouchStart(ev) {
        if (ev.touches && ev.touches[0]) heroTouchStartX = ev.touches[0].clientX;
      }
      function onHeroTouchEnd(ev) {
        if (!heroTouchStartX || !ev.changedTouches || !ev.changedTouches[0]) return;
        const dx = ev.changedTouches[0].clientX - heroTouchStartX;
        heroTouchStartX = 0;
        if (Math.abs(dx) > 40) {
          setHeroSlideIndex(state.heroIndex + (dx < 0 ? 1 : -1));
        }
      }

      function buildHeroBannerInnerHtml() {
        if (state.isSearchMode || !state.heroSlides.length) return "";
        const hero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
        if (!hero) return "";
        const heroType = hero.media_type === "tv" || state.type === "s" ? "s" : "m";
        const isMovie = heroType === "m";
        const yearStr = (hero.release_date || hero.first_air_date || "").slice(0, 4);
        const voteStr = hero.vote_average ? hero.vote_average.toFixed(1) : "–";
        const heroTitleSafe = esc(hero.title || hero.name || "");
        const heroPosterSafe = esc(hero.poster_path || "");

        // Wenn der große Slider ausgeblendet ist: Edle 1-Zeilen Spotlight-Leiste mit direktem "🎬 Slider einblenden ▾" Button!
        if (state.heroHidden) {
          return '<div class="hero-collapsed-strip">' +
            '<div class="hero-collapsed-left">' +
              '<span class="hero-badge ' + (isMovie ? 'movie' : 'series') + '" style="padding:2px 8px;font-size:10px">' + (isMovie ? '🎬 Highlight' : '📺 Highlight') + '</span>' +
              '<span class="hero-collapsed-title" onclick="openDetails(\\'' + heroType + '\\',' + hero.id + ',false,\\'' + heroTitleSafe + '\\',\\'' + heroPosterSafe + '\\')" title="Details öffnen">' + heroTitleSafe + '</span>' +
              '<span class="hero-collapsed-meta">★ ' + voteStr + (yearStr ? ' · ' + esc(yearStr) : '') + '</span>' +
            '</div>' +
            '<div class="hero-collapsed-actions">' +
              '<button type="button" class="btn" style="padding:4px 10px;font-size:11px" onclick="playInstantTrailerFromCard(event,\\'' + heroType + '\\',' + hero.id + ',\\'' + heroTitleSafe + '\\',\\'' + heroPosterSafe + '\\')" title="Trailer abspielen">▶ Trailer</button>' +
              '<button type="button" class="btn" style="padding:4px 10px;font-size:11px" onclick="openDetails(\\'' + heroType + '\\',' + hero.id + ',false,\\'' + heroTitleSafe + '\\',\\'' + heroPosterSafe + '\\')" title="Details öffnen">ⓘ Details</button>' +
              '<button type="button" id="heroRestoreBtn" class="hero-hide-btn" onclick="toggleHeroSliderHidden(false)" title="Großen Empfehlungs-Slider wieder ausklappen">🎬 Slider einblenden ▾</button>' +
            '</div>' +
          '</div>';
        }

        const dotsNavHtml = state.heroSlides.length > 1
          ? '<div class="hero-dots-nav">' +
              '<button type="button" class="hero-circle-arrow" onclick="setHeroSlideIndex(' + (state.heroIndex - 1) + ')" title="Vorheriges Highlight (Pfeiltaste Links)">‹</button>' +
              '<div class="hero-dots-track">' +
                state.heroSlides.map((sl, i) =>
                  '<button type="button" class="hero-dot ' + (i === state.heroIndex ? 'active' : '') + '" data-hero-card="' + i + '" onclick="selectHeroSlideCard(' + i + ')" title="' + (i + 1) + '. ' + esc(sl.title || sl.name || '') + ' (Pfeiltasten Links/Rechts zum Blättern, Enter für Trailer/Details)"></button>'
                ).join("") +
              '</div>' +
              '<button type="button" class="hero-circle-arrow" onclick="setHeroSlideIndex(' + (state.heroIndex + 1) + ')" title="Nächstes Highlight (Pfeiltaste Rechts)">›</button>' +
            '</div>'
          : '<div></div>';

        return '<div class="hero" ontouchstart="onHeroTouchStart(event)" ontouchend="onHeroTouchEnd(event)" style="background-image:url(https://image.tmdb.org/t/p/w1280' + (hero.backdrop_path || hero.poster_path || '') + ')">' +
          '<div class="hero-inner">' +
            '<div class="hero-content">' +
              '<div class="hero-kicker"><span class="hero-kicker-dot"></span><span>HIGHLIGHT DIESE WOCHE • ' + (isMovie ? 'FILM' : 'SERIE') + ' ' + (state.heroIndex + 1) + '/' + state.heroSlides.length + '</span></div>' +
              '<div class="hero-title">' + heroTitleSafe + '</div>' +
              '<div class="hero-meta-clean">' +
                '<span><span class="hero-meta-star">★</span> ' + voteStr + '</span>' +
                (yearStr ? '<span class="hero-meta-sep">·</span><span class="hero-meta-year" onclick="runSearch(false,\\'(' + esc(yearStr) + ')\\')" title="Alle Titel aus dem Jahr ' + esc(yearStr) + ' suchen">' + esc(yearStr) + '</span>' : '') +
                '<span class="hero-meta-sep">·</span><span>' + (isMovie ? 'Film' : 'Serie') + '</span>' +
              '</div>' +
              '<div class="hero-desc">' + esc(hero.overview || 'Tippe auf Details für Trailer, Besetzung, Filmreihen & Streams.') + '</div>' +
              '<div id="heroActionsBox" class="hero-actions-box ' + (state.heroActionsEngaged ? 'engaged' : '') + '">' +
                '<button type="button" id="heroBtnTrailer" class="hero-btn-play hero-action-btn" onclick="playInstantTrailerFromCard(event,\\'' + heroType + '\\',' + hero.id + ',\\'' + heroTitleSafe + '\\',\\'' + heroPosterSafe + '\\')" title="Instant-Trailer sofort abspielen">▶ Trailer</button>' +
                '<button type="button" id="heroBtnDetails" class="hero-btn-info hero-action-btn" onclick="openDetails(\\''+ heroType +'\\',' + hero.id + ',false,\\'' + heroTitleSafe + '\\',\\'' + heroPosterSafe + '\\')">ⓘ Details</button>' +
              '</div>' +
            '</div>' +
            '<div class="hero-bottom-bar">' +
              '<div class="hero-bottom-spacer"></div>' +
              dotsNavHtml +
              '<div class="hero-hide-wrap">' +
                '<button type="button" id="heroHideBtn" class="hero-hide-btn" onclick="toggleHeroSliderHidden(true)" title="Empfehlungs-Slider zur kompakten Zeile einklappen">🎬 Slider ausblenden ▴</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }

      function updateHeroBannerDomOnly() {
        const container = document.getElementById("heroBannerSlot");
        if (!container) return;
        const prevHeroFocusId = (typeof currentSpatialEl !== "undefined" && currentSpatialEl && container.contains(currentSpatialEl))
          ? (currentSpatialEl.id || (currentSpatialEl.classList.contains("hero-dot") ? "dot" : ""))
          : "";
        container.innerHTML = buildHeroBannerInnerHtml();
        if (prevHeroFocusId === "heroBtnDetails") {
          const b = document.getElementById("heroBtnDetails");
          if (b) setSpatialFocus(b, false);
        } else if (prevHeroFocusId === "heroBtnTrailer") {
          const b = document.getElementById("heroBtnTrailer");
          if (b) setSpatialFocus(b, false);
        } else if (prevHeroFocusId === "heroHideBtn") {
          const b = document.getElementById("heroHideBtn");
          if (b) setSpatialFocus(b, false);
        } else if (prevHeroFocusId === "heroRestoreBtn") {
          const b = document.getElementById("heroRestoreBtn");
          if (b) setSpatialFocus(b, false);
        } else if (prevHeroFocusId === "dot") {
          const c = container.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]');
          if (c) setSpatialFocus(c, false);
        }
      }

      // =========================================================================
      // 4. KLAR ERSICHTLICHER FILM / SERIEN MODUS DURCH REINE FARBKENNUNG & NUR INAKTIVE OPTION WÄHLBAR
      // =========================================================================
      function syncSearchGenreSelectDom() {
        const sel = document.getElementById("searchGenreSelect");
        if (!sel) return;
        const isMovie = state.type !== "s";
        const gMap = (state.genres && Object.keys(state.genres).length > 0)
          ? state.genres
          : (isMovie ? MOVIE_GENRES_CLIENT : SERIES_GENRES_CLIENT);
        const curGenreId = String(state.genreId || "all");
        let optsHtml = '<option value="all"' + (curGenreId === "all" ? ' selected' : '') + '>🎞️ Alle Genres</option>';
        Object.entries(gMap || {}).forEach(([gName, gId]) => {
          const idStr = String(gId);
          optsHtml += '<option value="' + esc(idStr) + '"' + (curGenreId === idStr ? ' selected' : '') + '>' + genreEmoji(gName) + ' ' + esc(gName) + '</option>';
        });
        sel.innerHTML = optsHtml;
        sel.value = curGenreId;
      }

      async function onSearchGenreSelectChange(genreVal) {
        const val = String(genreVal || "all");
        state.genreId = val;
        const isMovie = state.type !== "s";
        const gMap = (state.genres && Object.keys(state.genres).length > 0)
          ? state.genres
          : (isMovie ? MOVIE_GENRES_CLIENT : SERIES_GENRES_CLIENT);
        const foundEntry = Object.entries(gMap || {}).find(([, id]) => String(id) === val);
        const gName = foundEntry ? foundEntry[0] : "";

        if (state.isSearchMode && state.searchQuery) {
          const s = state.settings || (state.settings = {});
          s.filtersActive = true;
          s.includedGenres = gName ? [gName] : [];
          try {
            localStorage.setItem("tma_cached_settings", JSON.stringify(state.settings));
          } catch (e) {}
          await runSearch(false);
        } else {
          await loadDiscover(state.type || "m", val, state.mode || "trend", state.sort || "default", false, false);
        }
      }

      function updateMediaModeIndicatorDom() {
        const isMovie = state.type !== "s";
        const mTab = document.getElementById("tabBtnMovies");
        const sTab = document.getElementById("tabBtnSeries");
        const randBtn = document.getElementById("topRandomDiceBtn");
        if (mTab) {
          mTab.className = "media-mode-tab " + (isMovie ? "active-movie" : "");
          mTab.disabled = false;
          mTab.removeAttribute("tabindex");
          mTab.title = isMovie ? "Zur Filme-Hauptseite" : "Zu Filme wechseln";
        }
        if (sTab) {
          sTab.className = "media-mode-tab " + (!isMovie ? "active-series" : "");
          sTab.disabled = false;
          sTab.removeAttribute("tabindex");
          sTab.title = !isMovie ? "Zur Serien-Hauptseite" : "Zu Serien wechseln";
        }
        if (randBtn) {
          randBtn.innerHTML = '🎲 <span class="rand-short-txt">' + (isMovie ? 'Zufalls-Film' : 'Zufalls-Serie') + '</span><span class="rand-long-txt"> (mit Filtern)</span>';
        }
        syncSearchGenreSelectDom();
      }

      function pushHistory(fn) { state.history.push(fn); }
      function goBack() {
        if (document.getElementById("customDialogRoot")?.innerHTML) { closeCustomDialog(null); return; }
        if (state.sidebarOpen) { closeFilterSidebar(); return; }
        if (document.getElementById("lightboxRoot").innerHTML) { closeLightbox(); return; }
        if (document.getElementById("modalRoot").innerHTML) { closeDetailModal(); return; }
        const prev = state.history.pop();
        if (prev) prev(); else goHome();
      }

      // Klick auf das TelePort Logo -> Führt direkt zur Hauptseite
      function goHome() {
        state.isSearchMode = false;
        state.searchQuery = "";
        state.filtersCollapsedInSearch = false;
        state.currentView = "discover";
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        state.genreId = "all";
        const inp = document.getElementById("searchInput");
        if (inp) inp.value = "";
        updateSearchClearBtnVisibility();
        closeLightbox();
        document.getElementById("modalRoot").innerHTML = "";
        loadDiscover(state.type || "m", "all", "trend", "default");
      }

      // Klick auf "Neu starten" -> Setzt auch alle aktiven Filter zurück und startet frisch auf der Hauptseite
      async function restartApp() {
        state.history = [];
        state.isSearchMode = false;
        state.searchQuery = "";
        state.openFilterDropdown = null;
        state.filtersCollapsedInSearch = false;
        state.currentView = "discover";
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        state.genreId = "all";
        state.settings = {
          includedGenres: [], excludedGenres: [],
          includedPlatforms: [], excludedPlatforms: [],
          includedEras: [], excludedEras: [],
          includedStudios: [], excludedStudios: [],
          includedFsk: [], excludedFsk: [],
          showUnreleased: false,
          filtersActive: true
        };
        const inp = document.getElementById("searchInput");
        if (inp) inp.value = "";
        updateSearchClearBtnVisibility();
        closeLightbox();
        document.getElementById("modalRoot").innerHTML = "";
        setBusyState(true, "🔄 Setze alle Filter zurück & starte Mini-App neu...");
        try {
          const res = await apiFetchJson(API_BASE + "/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              action: "reset_all_filters",
              clientSettings: state.settings,
              includeDiscover: true,
              type: "m",
              genreId: "all",
              mode: "trend",
              sort: "pop_desc"
            })
          });
          if (res && res.settings) state.settings = res.settings;
          if (res && res.discover) {
            state.type = "m";
            state.genreId = "all";
            state.mode = "trend";
            state.sort = "pop_desc";
            state.startPage = 1;
            state.page = 1;
            state.items = res.discover.items || [];
            state.totalPages = Math.max(1, Number(res.discover.totalPages) || 1);
            state.totalResults = Math.max(state.items.length, Number(res.discover.totalResults) || state.items.length);
            state.hasMorePages = Boolean(res.discover.hasMore ?? (state.items.length >= 12));
            state.genres = res.discover.genres || {};
            updateMediaModeIndicatorDom();
            rebuildHeroSlides(state.items);
            renderDiscover();
            return;
          }
        } catch (e) {} finally {
          setBusyState(false);
        }
        loadDiscover("m", "all", "trend", "pop_desc");
      }

      function updateSearchClearBtnVisibility() {
        const inp = document.getElementById("searchInput");
        const btn = document.getElementById("searchClearBtn") || document.querySelector(".search-clear-btn");
        if (!btn) return;
        const hasVal = Boolean(inp && inp.value && inp.value.length > 0);
        btn.classList.toggle("is-empty", !hasVal);
        if (!hasVal && typeof currentSpatialEl !== "undefined" && currentSpatialEl === btn && inp) {
          setSpatialFocus(inp, false);
        }
      }

      function clearSearchInput() {
        const inp = document.getElementById("searchInput");
        if (inp) inp.value = "";
        updateSearchClearBtnVisibility();
        state.searchFocused = false;
        state.searchMatchedCollections = [];
        state.searchMatchedUniverses = [];
        state.searchMatchedPersons = [];
        state.searchMatchedStudios = [];
        state.searchEntitiesExpanded = false;
        document.body.classList.remove("search-active-dim");
        closeAutocomplete();
        if (state.isSearchMode) goHome();
      }

      function onSearchInputFocus() {
        updateSearchClearBtnVisibility();
        state.searchFocused = true;
      }

      function onSearchInputBlur() {
        setTimeout(() => {
          const inp = document.getElementById("searchInput");
          const val = (inp ? inp.value : "").trim();
          updateSearchClearBtnVisibility();
          if (!val && !state.isSearchMode) {
            state.searchFocused = false;
          }
          closeAutocomplete();
        }, 220);
      }

      function closeAutocomplete() {
        const box = document.getElementById("searchAutocompleteBox");
        if (box) {
          box.classList.remove("open");
          box.innerHTML = "";
        }
      }

      function onSearchScopeChange(newScope) {
        state.searchScope = newScope || "all";
        const inp = document.getElementById("searchInput");
        if (inp && inp.value.trim()) {
          runSearch(false);
        } else if (state.isSearchMode && state.searchQuery) {
          runSearch(false, state.searchQuery, state.searchScope);
        }
      }

      function toggleSearchDetectedEntities() {
        state.searchEntitiesExpanded = !state.searchEntitiesExpanded;
        const box = document.getElementById("searchDetectedEntitiesBody");
        const iconEl = document.getElementById("searchDetectedEntitiesChevron");
        if (box) {
          box.style.display = state.searchEntitiesExpanded ? "flex" : "none";
        }
        if (iconEl) {
          iconEl.textContent = state.searchEntitiesExpanded ? "Einklappen ▴" : "Ausklappen ▾";
        }
      }

      let liveSearchReqSeq = 0;

      function onSearchInputLive(rawVal) {
        updateSearchClearBtnVisibility();
        const q = String(rawVal || "").trim();
        state.searchFocused = true;
        if (liveSearchDebounceTimer) clearTimeout(liveSearchDebounceTimer);
        if (!q) {
          closeAutocomplete();
          return;
        }
        const mySeq = ++liveSearchReqSeq;
        liveSearchDebounceTimer = setTimeout(async () => {
          try {
            const res = await apiFetchJson(
              API_BASE + "/search?chatId=" + encodeURIComponent(chatId) +
              "&q=" + encodeURIComponent(q) +
              "&scope=" + encodeURIComponent(state.searchScope || "all") +
              "&sort=" + encodeURIComponent(state.sort)
            );
            if (mySeq !== liveSearchReqSeq || !res || !res.ok) return;
            state.searchMatchedCollections = res.collections || [];
            state.searchMatchedUniverses = res.universes || [];
            state.searchMatchedPersons = res.persons || [];
            state.searchMatchedStudios = res.studios || [];
            state.searchEntitiesExpanded = false;
            renderAutocompleteSuggestions(q, res);
            // Live-Ergebnisse direkt aktualisieren, während man tippt!
            state.isSearchMode = true;
            state.searchQuery = q;
            state.startPage = 1;
            state.page = 1;
            state.totalPages = Math.max(1, Number(res.totalPages) || 1);
            state.hasMorePages = Boolean(res.hasMore ?? (state.page < state.totalPages));
            state.filtersCollapsedInSearch = false;
            state.items = res.items || [];
            state.totalResults = Math.max(state.items.length, Number(res.totalResults) || state.items.length);
            renderDiscover("🔍 Live-Suche: " + q);
          } catch (e) {}
        }, 280);
      }

      function renderAutocompleteSuggestions(q, res) {
        const box = document.getElementById("searchAutocompleteBox");
        if (!box) return;
        const cols = (res.collections || []).slice(0, 4);
        const unis = (res.universes || []).slice(0, 3);
        const studs = (res.studios || []).slice(0, 4);
        const pers = (res.persons || []).slice(0, 4);
        const media = (res.items || []).slice(0, 5);
        if (!cols.length && !unis.length && !studs.length && !pers.length && !media.length) {
          closeAutocomplete();
          return;
        }
        let html = "";
        if (cols.length || unis.length || studs.length) {
          html += '<div class="ac-group-title">🍿 Reihen, 🌌 Universen & 🏢 Filmstudios (Automatisch erkannt)</div>';
          unis.forEach(u => {
            html += '<div class="ac-item" tabindex="0" onclick="closeAutocomplete();openUniverseView(\\'' + esc(u.id) + '\\')">' +
              '<span>' + esc(u.icon || '🌌') + ' <b>' + esc(u.name) + '</b></span>' +
              '<span style="font-size:11px;color:#34d399">Universum öffnen ➔</span>' +
            '</div>';
          });
          cols.forEach(c => {
            html += '<div class="ac-item" tabindex="0" onclick="closeAutocomplete();openCollectionView(' + Number(c.id) + ')">' +
              '<span>🍿 <b>' + esc(c.name) + '</b></span>' +
              '<span style="font-size:11px;color:#a78bfa">Filmreihe öffnen ➔</span>' +
            '</div>';
          });
          studs.forEach(st => {
            const cid = st.companyIds || st.id;
            html += '<div class="ac-item" tabindex="0" onclick="closeAutocomplete();openStudioView(\\'' + esc(String(cid)) + '\\',\\'' + esc(st.name) + '\\',\\'' + esc(st.presetStudioId || '') + '\\')">' +
              '<span>' + esc(st.icon || '🏢') + ' <b>' + esc(st.name) + '</b></span>' +
              '<span style="font-size:11px;color:#f59e0b">Studio-Katalog ➔</span>' +
            '</div>';
          });
        }
        if (pers.length) {
          html += '<div class="ac-group-title">🌟 Personen (Schauspieler & Regie)</div>';
          pers.forEach(p => {
            html += '<div class="ac-item" tabindex="0" onclick="closeAutocomplete();openPersonView(' + Number(p.id) + ',\\'' + esc(p.name) + '\\')">' +
              '<span>🌟 <b>' + esc(p.name) + '</b>' + (p.known_for ? ' <span style="color:#94a3b8;font-size:11px">(' + esc(p.known_for) + ')</span>' : '') + '</span>' +
              '<span style="font-size:11px;color:#38bdf8">Filmografie ➔</span>' +
            '</div>';
          });
        }
        if (media.length) {
          html += '<div class="ac-group-title">🎬 Filme & 📺 Serien (Mit aktiven Filtern)</div>';
          media.forEach(m => {
            const tc = m.media_type === "tv" ? "s" : "m";
            const yr = (m.release_date || m.first_air_date || "").slice(0, 4);
            html += '<div class="ac-item" tabindex="0" onclick="closeAutocomplete();openDetails(\\'' + tc + '\\',' + Number(m.id) + ',false)">' +
              '<span>' + (tc === 's' ? '📺' : '🎬') + ' <b>' + esc(m.title || m.name) + '</b>' + (yr ? ' <span style="color:#94a3b8">(' + esc(yr) + ')</span>' : '') + '</span>' +
              '<span style="font-size:11px;color:#fbbf24">⭐ ' + (m.vote_average ? m.vote_average.toFixed(1) : '–') + '</span>' +
            '</div>';
          });
        }
        box.innerHTML = html;
        box.classList.add("open");
      }

      async function openStudioView(companyId, companyName, presetStudioId = "") {
        document.getElementById("modalRoot").innerHTML = "";
        closeAutocomplete();
        if (presetStudioId) {
          prepareDiscoverContextFromModal();
          await setDirectFilter("studio", presetStudioId, "force_include");
          return;
        }
        state.isSearchMode = false;
        state.searchFocused = false;
        state.searchQuery = "";
        state.currentView = "discover";
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        state.currentCompanyId = String(companyId || "").trim();
        state.currentCompanyName = String(companyName || "Filmstudio").trim();
        const inp = document.getElementById("searchInput");
        if (inp) inp.value = "";
        updateSearchClearBtnVisibility();
        await loadDiscover(state.type || "m", state.genreId || "all", "pop", state.sort || "default", false, true, 1);
      }

      function clearStudioView() {
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        loadDiscover(state.type || "m", state.genreId || "all", state.mode || "trend", state.sort || "default", false, false, 1);
      }

      async function openPersonView(personId, personName) {
        document.getElementById("modalRoot").innerHTML = "";
        closeAutocomplete();
        state.isSearchMode = true;
        state.currentView = "person";
        state.currentPersonId = personId;
        state.currentPersonName = personName || "Person";
        state.searchQuery = personName || "";
        state.filtersCollapsedInSearch = false;
        const inp = document.getElementById("searchInput");
        if (inp && personName) inp.value = personName;
        if (inp && document.activeElement === inp) inp.blur();
        updateSearchClearBtnVisibility();
        setBusyState(true, '🌟 Lade Filme & Serien mit "' + (personName || personId) + '"...');
        try {
          const res = await apiFetchJson(
            API_BASE + "/search?chatId=" + encodeURIComponent(chatId) +
            "&personId=" + encodeURIComponent(personId) +
            "&q=" + encodeURIComponent(personName || "") +
            "&sort=" + encodeURIComponent(state.sort)
          );
          state.items = res.items || [];
          state.currentPersonName = res.personName || personName || "Person";
          renderDiscover("🌟 Person: " + state.currentPersonName);
          if (typeof focusFirstResultCard === "function") focusFirstResultCard(false);
        } finally {
          setBusyState(false);
        }
      }

      function switchType(t) {
        if (state.type === t && !state.isSearchMode && state.currentView === "discover" && !state.currentCompanyId && state.genreId === "all") return;
        pushHistory(() => loadDiscover(state.type, state.genreId, state.mode, state.sort));
        state.type = t;
        state.genreId = "all";
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        state.isSearchMode = false;
        state.searchFocused = false;
        state.searchQuery = "";
        document.body.classList.remove("search-active-dim");
        updateMediaModeIndicatorDom();
        loadDiscover(t, "all", "trend", "default", false, false);
      }

      const CLIENT_PLATFORM_ID_ALIASES = {
        disney: "disneyplus",
        apple: "appletv",
        sky: "wow",
        paramount: "paramountplus",
        rtl: "rtlplus",
        magenta: "magentatv",
        ard: "ard_zdf",
        zdf: "ard_zdf"
      };

      function normalizePlatformIdClient(pid) {
        const clean = String(pid || "").trim().toLowerCase();
        return CLIENT_PLATFORM_ID_ALIASES[clean] || clean;
      }

      function getPlatformDisplayLabelClient(pid) {
        const normId = normalizePlatformIdClient(pid);
        const pl = PLATFORM_OPTIONS_CLIENT.find(p => p.id === normId);
        return pl ? (pl.icon + " " + pl.label) : String(pid || "");
      }

      function selectMode(m) {
        if (!m) return;
        if (m === "franchises") {
          loadFranchisesHub();
          return;
        }
        const nextSort = (state.sort && state.sort !== "default") ? state.sort : "default";
        state.isSearchMode = false;
        state.searchFocused = false;
        document.body.classList.remove("search-active-dim");
        loadDiscover(state.type, state.genreId, m, nextSort, false, false);
      }

      function onModeSelectChange(m) {
        if (!m) return;
        selectMode(String(m));
      }

      function applySortValue(next) {
        if (!next) return;
        if (state.currentView === "collection" && state.currentCollectionId) {
          state.sort = next;
          openCollectionView(state.currentCollectionId);
        } else if (state.currentView === "universe" && state.currentUniverseId) {
          state.sort = next;
          openUniverseView(state.currentUniverseId);
        } else if (state.currentView === "person" && state.currentPersonId) {
          state.sort = next;
          openPersonView(state.currentPersonId, state.currentPersonName);
        } else if (state.isSearchMode && state.searchQuery) {
          state.sort = next;
          runSearch(false);
        } else {
          loadDiscover(state.type, state.genreId, state.mode, next, false, false);
        }
      }

      function onSortSelectChange(val) {
        applySortValue(String(val || "default"));
      }

      async function onProviderFilterSelectChange(providerVal) {
        if (!providerVal || providerVal === "__multi__") return;
        const rawVal = String(providerVal || "all");
        const val = (rawVal === "all" || rawVal === "vip") ? rawVal : normalizePlatformIdClient(rawVal);

        const s = state.settings || (state.settings = {});
        s.filtersActive = true;
        if (val === "all") {
          s.onlyVipStreams = false;
          s.includedPlatforms = [];
          if (state.sort === "added_desc" || state.sort === "added_asc") {
            state.sort = "default";
          }
        } else if (val === "vip") {
          s.onlyVipStreams = true;
          s.includedPlatforms = [];
          if (!state.sort || state.sort === "default") {
            state.sort = "added_desc";
          }
        } else {
          s.onlyVipStreams = false;
          s.includedPlatforms = [val];
          s.excludedPlatforms = (Array.isArray(s.excludedPlatforms) ? s.excludedPlatforms : [])
            .map(normalizePlatformIdClient)
            .filter(x => x !== val);
          if (state.sort === "added_desc" || state.sort === "added_asc") {
            state.sort = "default";
          }
        }
        try {
          localStorage.setItem("tma_cached_settings", JSON.stringify(state.settings));
        } catch (e) {}

        const filterMount = document.getElementById("floatingFilterMount");
        if (filterMount) filterMount.innerHTML = buildFloatingFilterBarHtml();
        if (state.sidebarOpen) renderFilterSidebarContent(false);

        try {
          await apiFetchJson(API_BASE + "/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              action: "set_direct_filter",
              clientSettings: state.settings,
              clientSettingsAuthoritative: true,
              includeDiscover: false,
              includeSearch: false
            })
          });
        } catch (e) {}

        if (state.isSearchMode && state.searchQuery) {
          await runSearch(false);
        } else {
          await loadDiscover(state.type, state.genreId, state.mode || "trend", state.sort || "default", false, false);
        }
      }

      async function onNewReleaseSourceChange(sourceVal) {
        return onProviderFilterSelectChange(sourceVal);
      }

      function toggleSort(prefix) {
        const key = prefix === "vote" ? "rating" : prefix;
        const next = state.sort === key + "_desc" ? key + "_asc" : key + "_desc";
        applySortValue(next);
      }

      async function apiFetchJson(url, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        if (sessionToken) headers["Authorization"] = "Bearer " + sessionToken;
        if (rawInitData) headers["X-Telegram-Init-Data"] = rawInitData;
        if (state.settings && Object.keys(state.settings).length > 0) {
          try {
            headers["X-Tma-Settings"] = encodeURIComponent(JSON.stringify(state.settings));
          } catch (e) {}
        }
        const isImportBatch = String(url || "").includes("/admin/import-batch");
        const timeoutMs = isImportBatch ? 22000 : 11500;
        const doSingleFetch = async (isRetry = false) => {
          const timeoutCtrl = new AbortController();
          const timer = setTimeout(() => {
            try { timeoutCtrl.abort(); } catch (e) {}
          }, timeoutMs);
          if (opts.signal) {
            if (opts.signal.aborted) {
              clearTimeout(timer);
              throw new DOMException("Aborted", "AbortError");
            }
            opts.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              try { timeoutCtrl.abort(); } catch (e) {}
            }, { once: true });
          }
          try {
            const fetchOpts = {
              ...opts,
              headers,
              signal: timeoutCtrl.signal
            };
            if (isRetry) fetchOpts.cache = "no-store";
            const res = await fetch(url, fetchOpts);
            const text = await res.text();
            const trimmed = String(text || "").trim();
            const isHtmlError =
              trimmed.startsWith("<!DOCTYPE") ||
              trimmed.startsWith("<html") ||
              trimmed.includes("<!--[if lt IE 7]>") ||
              res.status === 429 ||
              res.status === 502 ||
              res.status === 503 ||
              res.status === 524;
            if (isHtmlError) {
              const rateErr = new Error(
                "API-Zugriffslimit / Cloudflare Gateway-Pause (HTTP " + (res.status || 524) + ") – automatischer Cooldown aktiv"
              );
              rateErr.isRateLimitOrHtml = true;
              throw rateErr;
            }
            try {
              return JSON.parse(text);
            } catch (e) {
              const cleanSnippet = trimmed.replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ").trim().slice(0, 90);
              const parseErr = new Error("Server-Antwort kein JSON (HTTP " + res.status + "): " + (cleanSnippet || "Leere Antwort"));
              parseErr.isRateLimitOrHtml = res.status >= 500 || res.status === 429;
              throw parseErr;
            }
          } finally {
            clearTimeout(timer);
          }
        };

        const backoffDelays = [1100, 2600, 5200];
        let lastErr = null;
        for (let attempt = 0; attempt <= backoffDelays.length; attempt++) {
          try {
            return await doSingleFetch(attempt > 0);
          } catch (err) {
            lastErr = err;
            if (opts.signal && opts.signal.aborted) throw err;
            if (attempt < backoffDelays.length) {
              const waitMs = err && err.isRateLimitOrHtml ? backoffDelays[attempt] : 450 * (attempt + 1);
              await new Promise(r => setTimeout(r, waitMs));
            }
          }
        }
        throw lastErr || new Error("Netzwerkfehler");
      }

      // =========================================================================
      // 5. DIREKTE 1-KLICK INCLUDE / EXCLUDE FILTER-AKTION (MEHRFACHAUSWAHL-SICHER & OHNE DOUBLE-TOGGLE!)
      // =========================================================================
      function normalizeGenreNameForClient(rawGenre, targetType) {
        const g = String(rawGenre || "").trim();
        if (!g) return "";
        const low = g.toLowerCase();
        const isSeries = (targetType || state.type) === "s";
        if (low === "science fiction" || low === "sci-fi" || low === "scifi") {
          return isSeries ? "Sci-Fi & Fantasy" : "Sci-Fi";
        }
        if (low === "action" && isSeries) return "Action & Adventure";
        if (low === "abenteuer" && isSeries) return "Action & Adventure";
        if (low === "action & adventure" && !isSeries) return "Action";
        if (low === "sci-fi & fantasy" && !isSeries) return "Sci-Fi";
        if (low === "fantasy" && isSeries) return "Sci-Fi & Fantasy";
        if (low === "kriegsfilm" && isSeries) return "War & Politics";
        if (low === "war & politics" && !isSeries) return "Kriegsfilm";
        return g;
      }

      async function setDirectFilter(category, value, mode) {
        const mySeq = ++filterClickSeq;
        if (sidebarFilterDebounceTimer) {
          clearTimeout(sidebarFilterDebounceTimer);
          sidebarFilterDebounceTimer = null;
        }
        if (activeAbortController) {
          try { activeAbortController.abort(); } catch (e) {}
        }

        const s = state.settings || (state.settings = {});
        const applyLocalDirect = (incKey, excKey, val, m) => {
          s[incKey] = Array.isArray(s[incKey]) ? [...s[incKey]] : [];
          s[excKey] = Array.isArray(s[excKey]) ? [...s[excKey]] : [];
          if (m === "force_include") {
            s[excKey] = s[excKey].filter(x => x !== val);
            if (!s[incKey].includes(val)) s[incKey].push(val);
          } else if (m === "include") {
            if (s[incKey].includes(val)) s[incKey] = s[incKey].filter(x => x !== val);
            else { s[excKey] = s[excKey].filter(x => x !== val); s[incKey].push(val); }
          } else if (m === "exclude") {
            if (s[excKey].includes(val)) s[excKey] = s[excKey].filter(x => x !== val);
            else { s[incKey] = s[incKey].filter(x => x !== val); s[excKey].push(val); }
          } else {
            s[incKey] = s[incKey].filter(x => x !== val);
            s[excKey] = s[excKey].filter(x => x !== val);
          }
        };

        const effectiveVal = category === "genre"
          ? normalizeGenreNameForClient(value, state.type)
          : category === "platform"
            ? normalizePlatformIdClient(value)
            : String(value || "");

        if (category === "genre") {
          applyLocalDirect("includedGenres", "excludedGenres", effectiveVal, mode);
          state.genreId = "all";
        } else if (category === "platform") {
          s.includedPlatforms = Array.isArray(s.includedPlatforms) ? s.includedPlatforms.map(normalizePlatformIdClient) : [];
          s.excludedPlatforms = Array.isArray(s.excludedPlatforms) ? s.excludedPlatforms.map(normalizePlatformIdClient) : [];
          applyLocalDirect("includedPlatforms", "excludedPlatforms", effectiveVal, mode);
        }
        else if (category === "era") applyLocalDirect("includedEras", "excludedEras", effectiveVal, mode);
        else if (category === "studio") applyLocalDirect("includedStudios", "excludedStudios", effectiveVal, mode);
        else if (category === "fsk") applyLocalDirect("includedFsk", "excludedFsk", effectiveVal, mode);
        else if (category === "unreleased") {
          if (mode === "include" || mode === "force_include") s.showUnreleased = true;
          else if (mode === "exclude" || mode === "neutral") s.showUnreleased = false;
          else s.showUnreleased = !Boolean(s.showUnreleased);
        }
        else if (category === "vip_streams") {
          if (mode === "include" || mode === "force_include") s.onlyVipStreams = true;
          else if (mode === "exclude" || mode === "neutral") s.onlyVipStreams = false;
          else s.onlyVipStreams = !Boolean(s.onlyVipStreams);
        }
        else if (category === "reset_all") {
          s.includedGenres = []; s.excludedGenres = [];
          s.includedPlatforms = []; s.excludedPlatforms = [];
          s.includedEras = []; s.excludedEras = [];
          s.includedStudios = []; s.excludedStudios = [];
          s.includedFsk = []; s.excludedFsk = [];
          s.showUnreleased = false;
          s.onlyVipStreams = false;
          state.newReleaseSource = "all";
          state.genreId = "all";
        }
        s.filtersActive = true;

        try {
          localStorage.setItem("tma_cached_settings", JSON.stringify(state.settings));
        } catch (e) {}

        // Sofortiges lokales UI-Update (0 ms) für Pills & Sidebar-Buttons (#8)
        const filterMount = document.getElementById("floatingFilterMount");
        if (filterMount) filterMount.innerHTML = buildFloatingFilterBarHtml();
        if (state.sidebarOpen) renderFilterSidebarContent(false);

        const executeRemoteFilterSync = async () => {
          activeAbortController = new AbortController();
          setBusyState(true, "⏳ Filter aktiv – aktualisiere passende " + (state.type === "s" ? "Serien" : "Filme") + "...");
          try {
            const actionName = category === "reset_all"
              ? "reset_all_filters"
              : category === "unreleased"
                ? "toggle_unreleased"
                : "set_direct_filter";

            const shouldLoadDiscover = !state.isSearchMode && (
              state.currentView === "discover" ||
              state.currentView === "wishlist" ||
              state.currentView === "franchises"
            );

            const res = await apiFetchJson(API_BASE + "/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: activeAbortController.signal,
              body: JSON.stringify({
                chatId,
                action: actionName,
                category,
                value: effectiveVal,
                mode: mode === "force_include" ? "include" : mode,
                clientSettings: state.settings,
                clientSettingsAuthoritative: true,
                includeDiscover: shouldLoadDiscover,
                includeSearch: state.isSearchMode && state.currentView !== "person",
                searchQuery: state.searchQuery,
                type: state.type,
                genreId: state.genreId,
                discoverMode: state.mode,
                sort: state.sort
              })
            });

            if (mySeq !== filterClickSeq) return;
            if (res && res.settings) {
              state.settings = res.settings;
              try {
                localStorage.setItem("tma_cached_settings", JSON.stringify(state.settings));
              } catch (e) {}
            }
            if (state.sidebarOpen) renderFilterSidebarContent(false);

            if (state.currentView === "settings") {
              await loadSettingsView();
            } else if (state.currentView === "collection" && state.currentCollectionId) {
              await openCollectionView(state.currentCollectionId);
            } else if (state.currentView === "universe" && state.currentUniverseId) {
              await openUniverseView(state.currentUniverseId);
            } else if (state.currentView === "person" && state.currentPersonId) {
              await openPersonView(state.currentPersonId, state.currentPersonName);
            } else if (state.isSearchMode && res && res.search) {
              state.startPage = 1;
              state.page = 1;
              state.items = res.search.items || [];
              state.totalPages = Math.max(1, Number(res.search.totalPages) || 1);
              state.totalResults = Math.max(state.items.length, Number(res.search.totalResults) || state.items.length);
              state.hasMorePages = Boolean(res.search.hasMore ?? (state.items.length >= 12));
              renderDiscover("🔍 Suchergebnisse: " + state.searchQuery);
              if (!state.sidebarOpen && typeof focusFirstResultCard === "function") focusFirstResultCard(false);
            } else if (res && res.discover) {
              state.currentView = "discover";
              state.startPage = 1;
              state.page = 1;
              state.items = res.discover.items || [];
              state.totalPages = Math.max(1, Number(res.discover.totalPages) || 1);
              state.totalResults = Math.max(state.items.length, Number(res.discover.totalResults) || state.items.length);
              state.hasMorePages = Boolean(res.discover.hasMore ?? (state.items.length >= 12));
              state.genres = res.discover.genres || state.genres;
              rebuildHeroSlides(state.items);
              renderDiscover();
              if (!state.sidebarOpen && typeof focusFirstResultCard === "function") focusFirstResultCard(false);
            } else {
              if (state.isSearchMode) await runSearch(false);
              else await loadDiscover(state.type, state.genreId, state.mode, state.sort, false, false);
            }
          } catch (err) {
            if (err && err.name === "AbortError") return;
          } finally {
            if (mySeq === filterClickSeq) setBusyState(false);
          }
        };

        // Sanftes Batch-Debounce (200 ms) bei geöffnetem Filter-Drawer (#8), damit schnelle Mehrfach-Klicks gebündelt werden
        if (state.sidebarOpen && category !== "reset_all") {
          sidebarFilterDebounceTimer = setTimeout(executeRemoteFilterSync, 200);
        } else {
          await executeRemoteFilterSync();
        }
      }

      function toggleFilterDropdown(tabKey) {
        toggleFilterSidebar(tabKey || "genres");
      }

      function toggleSearchFilterCollapse() {
        state.filtersCollapsedInSearch = !state.filtersCollapsedInSearch;
        const filterMount = document.getElementById("floatingFilterMount");
        if (filterMount) filterMount.innerHTML = buildFloatingFilterBarHtml();
      }

      async function triggerRandom() {
        const isMovie = state.type !== "s";
        setBusyState(true, "🎲 Ziehe zufälligen " + (isMovie ? "Film" : "Serien-Tipp") + " mit deinen aktiven Filtern...");
        try {
          const r = await apiFetchJson(API_BASE + "/discover?chatId=" + encodeURIComponent(chatId) + "&type=" + state.type + "&genreId=" + state.genreId + "&mode=random");
          if (r.items && r.items[0]) {
            await openDetails(state.type, r.items[0].id);
          } else {
            showHudToast("⚠️ Kein Zufallstreffer mit den aktuellen Filtern gefunden.");
          }
        } catch (e) {} finally {
          setBusyState(false);
        }
      }

      function buildSkeletonCardsHtml(count) {
        const targetCount = count || Math.max(12, (state.items && state.items.length) ? state.items.length : 20);
        let html = "";
        for (let i = 0; i < targetCount; i++) {
          html += '<div class="skeleton-card" data-skeleton="1">' +
            '<div class="skeleton-poster"></div>' +
            '<div class="skeleton-body">' +
              '<div class="skeleton-line"></div>' +
              '<div class="skeleton-line short"></div>' +
            '</div>' +
          '</div>';
        }
        return html;
      }

      async function loadDiscover(type, genreId, mode, sort, bypass = false, jumpToCards = false, targetPage = 1) {
        state.type = type; state.genreId = genreId; state.mode = mode; state.sort = sort;
        const pageNum = Math.max(1, Number(targetPage) || 1);
        state.startPage = pageNum;
        state.page = pageNum;
        state.hasMorePages = false;
        state.loadingMore = false;
        state.isSearchMode = false;
        state.searchFocused = false;
        state.currentView = "discover";
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        document.body.classList.remove("search-active-dim");
        updateMediaModeIndicatorDom();
        syncSearchGenreSelectDom();
        const root = document.getElementById("appRoot");
        const existingGrid = document.getElementById("resultsGridContainer");
        if (existingGrid) {
          existingGrid.innerHTML = buildSkeletonCardsHtml();
        }
        setBusyState(true, "⏳ Lade " + (type === "s" ? "Serien" : "Filme") + (pageNum > 1 ? (" (Seite " + pageNum + ")") : "") + "...");
        try {
          const companyQueryParam = state.currentCompanyId ? ("&companyId=" + encodeURIComponent(state.currentCompanyId)) : "";
          const res = await apiFetchJson(API_BASE + "/discover?chatId=" + encodeURIComponent(chatId) + "&type=" + type + "&genreId=" + genreId + "&mode=" + mode + "&sort=" + sort + "&page=" + pageNum + "&bypass=" + (bypass ? "1" : "0") + companyQueryParam);
          state.items = res.items || [];
          state.totalPages = Math.max(1, Number(res.totalPages) || 1);
          state.totalResults = Math.max(state.items.length, Number(res.totalResults) || state.items.length);
          state.hasMorePages = Boolean(res.hasMore ?? (pageNum < state.totalPages));
          state.genres = res.genres || {};
          syncSearchGenreSelectDom();
          if (Array.isArray(res.savedKeys)) {
            savedKeysSet = new Set(res.savedKeys);
          }
          if (res.botUsername) state.botUsername = res.botUsername;
          if (res.settings) {
            state.settings = res.settings;
            if (res.settings.uiScale && !localStorage.getItem("tma_ui_scale")) {
              uiScale = { ...DEFAULT_UI_SCALE, ...res.settings.uiScale };
              applyUiScaleToDom();
            }
            if (res.settings.trailerProvider && !localStorage.getItem("tma_trailer_provider")) {
              trailerProvider = res.settings.trailerProvider;
            }
          }
          if (state.sidebarOpen) renderFilterSidebarContent(false);
          if (pageNum === 1) rebuildHeroSlides(state.items);
          if (state.items.length === 0 && res.rawCount > 0 && !bypass) {
            root.innerHTML = '<div class="section">' + buildFloatingFilterBarHtml() + '<div class="panel-box"><div class="section-title">⚠️ Alle ' + res.rawCount + ' Treffer wurden durch deine aktiven Filter ausgeblendet</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn red" onclick="loadDiscover(\\''+type+'\\',\\''+genreId+'\\',\\''+mode+'\\',\\''+sort+'\\',true,false)">🔓 Filter hier temporär deaktivieren</button><button class="btn" onclick="setDirectFilter(\\'reset_all\\',\\'\\',\\'neutral\\')">🗑️ Alle Filter zurücksetzen</button></div></div></div>';
            return;
          }
          renderDiscover();
          if (jumpToCards && typeof focusFirstResultCard === "function") {
            focusFirstResultCard(false);
          }
        } catch (err) {
          root.innerHTML = '<div class="section"><div class="panel-box"><div class="section-title">⚠️ Fehler beim Laden</div><p style="font-size:12px;color:#ccc;margin-bottom:8px">' + esc(err.message) + '</p><button class="btn red" onclick="loadDiscover(\\''+type+'\\',\\''+genreId+'\\',\\''+mode+'\\',\\''+sort+'\\')">🔄 Erneut versuchen</button></div></div>';
        } finally {
          setBusyState(false);
        }
      }

      async function runSearch(bypass = false, overrideQuery = null, overrideScope = null, jumpToResults = true, targetPage = 1) {
        if (liveSearchDebounceTimer) {
          clearTimeout(liveSearchDebounceTimer);
          liveSearchDebounceTimer = null;
        }
        ++liveSearchReqSeq;
        const inp = document.getElementById("searchInput");
        if (overrideQuery !== null && inp) inp.value = overrideQuery;
        updateSearchClearBtnVisibility();
        if (overrideScope !== null) {
          state.searchScope = overrideScope;
          const sel = document.getElementById("searchScopeSelect");
          if (sel) sel.value = overrideScope;
        }
        const q = (overrideQuery !== null ? overrideQuery : (inp ? inp.value : "")).trim();
        if (!q) return;
        if (inp && document.activeElement === inp) {
          inp.blur();
        }
        closeAutocomplete();
        document.getElementById("modalRoot").innerHTML = "";
        const pageNum = Math.max(1, Number(targetPage) || 1);
        const isNewSearchQuery = state.searchQuery !== q || !state.isSearchMode;
        state.isSearchMode = true;
        state.searchFocused = false;
        state.startPage = pageNum;
        state.page = pageNum;
        state.hasMorePages = false;
        state.loadingMore = false;
        state.currentView = "discover";
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        state.searchQuery = q;
        if (isNewSearchQuery && pageNum === 1) {
          state.searchEntitiesExpanded = false;
        }
        state.openFilterDropdown = null;
        state.filtersCollapsedInSearch = false;
        document.body.classList.remove("search-active-dim");
        updateMediaModeIndicatorDom();
        if (heroRotationTimer) clearInterval(heroRotationTimer);

        const root = document.getElementById("appRoot");
        const existingGrid = document.getElementById("resultsGridContainer");
        if (existingGrid) {
          existingGrid.innerHTML = buildSkeletonCardsHtml();
        }
        setBusyState(true, '🔍 Suche nach "' + q + '"' + (pageNum > 1 ? (' (Seite ' + pageNum + ')') : '') + '...');
        try {
          const res = await apiFetchJson(
            API_BASE + "/search?chatId=" + encodeURIComponent(chatId) +
            "&q=" + encodeURIComponent(q) +
            "&scope=" + encodeURIComponent(state.searchScope || "all") +
            "&sort=" + encodeURIComponent(state.sort) +
            "&page=" + pageNum + "&bypass=" + (bypass ? "1" : "0")
          );
          state.searchMatchedCollections = res.collections || [];
          state.searchMatchedUniverses = res.universes || [];
          state.searchMatchedPersons = res.persons || [];
          state.searchMatchedStudios = res.studios || [];
          if ((res.items || []).length === 0 && res.filteredOutCount > 0 && !bypass) {
            root.innerHTML = '<div class="section"><div id="floatingFilterMount">' + buildFloatingFilterBarHtml() + '</div><div class="panel-box"><div class="section-title">⚠️ Keine Treffer wegen aktiver Filter (' + res.filteredOutCount + ' ausgeblendet)</div><button class="btn red" onclick="runSearch(true)">🔓 Filter temporär deaktivieren (Alle ' + res.filteredOutCount + ' zeigen)</button></div></div>';
            if (jumpToResults && typeof focusFirstResultCard === "function") focusFirstResultCard(false);
            return;
          }
          state.items = res.items || [];
          state.totalPages = Math.max(1, Number(res.totalPages) || 1);
          state.totalResults = Math.max(state.items.length, Number(res.totalResults) || state.items.length);
          state.hasMorePages = Boolean(res.hasMore ?? (pageNum < state.totalPages));
          document.body.classList.remove("search-active-dim");
          renderDiscover("🔍 Suchergebnisse: " + q);
          if (jumpToResults && typeof focusFirstResultCard === "function") {
            focusFirstResultCard(false);
          }
        } catch (err) {
          root.innerHTML = '<div class="section"><div class="panel-box">⚠️ Fehler bei der Suche: ' + esc(err.message) + '</div></div>';
        } finally {
          document.body.classList.remove("search-active-dim");
          setBusyState(false);
        }
      }

      // Direkt-Seitenwahl (#17) für Discover & Suche (ohne Seiten-Springen!)
      async function jumpToPage(targetPage) {
        const p = Math.max(1, Math.min(Number(state.totalPages) || 1, Number(targetPage) || 1));
        if (state.loadingMore) return;
        if (state.isSearchMode && state.searchQuery) {
          await runSearch(false, state.searchQuery, state.searchScope, false, p);
        } else {
          await loadDiscover(state.type, state.genreId, state.mode, state.sort, false, false, p);
        }
      }

      // Endlos-Scrollen / „Mehr laden“-Pagination für Entdecken- & Such-Grid (#2 & #21)
      async function loadMoreResults() {
        if (state.loadingMore || !state.hasMorePages) return;
        const nextPage = (Number(state.page) || 1) + 1;
        state.loadingMore = true;
        const loadBtn = document.getElementById("loadMoreGridBtn");
        if (loadBtn) {
          loadBtn.disabled = true;
          loadBtn.textContent = "⏳ Lade Seite " + nextPage + "...";
        }
        // Sanfte Skeleton-Platzhalter (#21) direkt im Grid anhängen statt Ausgrauen!
        const gridEl = document.getElementById("resultsGridContainer");
        if (gridEl) {
          const loadWrap = gridEl.querySelector(".load-more-wrap");
          if (loadWrap) {
            loadWrap.insertAdjacentHTML("beforebegin", buildSkeletonCardsHtml(6));
          }
        }
        setBusyState(true, "⏳ Lade Seite " + nextPage + " nach...");
        try {
          let res = null;
          if (state.isSearchMode && state.searchQuery) {
            res = await apiFetchJson(
              API_BASE + "/search?chatId=" + encodeURIComponent(chatId) +
              "&q=" + encodeURIComponent(state.searchQuery) +
              "&scope=" + encodeURIComponent(state.searchScope || "all") +
              "&sort=" + encodeURIComponent(state.sort) +
              "&page=" + nextPage
            );
          } else {
            const companyQueryParam = state.currentCompanyId ? ("&companyId=" + encodeURIComponent(state.currentCompanyId)) : "";
            res = await apiFetchJson(
              API_BASE + "/discover?chatId=" + encodeURIComponent(chatId) +
              "&type=" + state.type +
              "&genreId=" + state.genreId +
              "&mode=" + state.mode +
              "&sort=" + state.sort +
              "&page=" + nextPage +
              companyQueryParam
            );
          }
          const incoming = (res && Array.isArray(res.items)) ? res.items : [];
          const existingKeys = new Set(state.items.map(it => {
            const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : state.type;
            return tc + "_" + it.id;
          }));
          const freshItems = incoming.filter(it => {
            if (!it || !it.id) return false;
            const tc = it.media_type === "tv" ? "s" : it.media_type === "movie" ? "m" : state.type;
            const k = tc + "_" + it.id;
            if (existingKeys.has(k)) return false;
            existingKeys.add(k);
            return true;
          });
          const firstNewItem = freshItems[0] || null;
          state.page = nextPage;
          if (res && res.totalPages) {
            state.totalPages = Math.max(nextPage, Number(res.totalPages) || 1);
          }
          state.items = [...state.items, ...freshItems];
          if (res && res.totalResults) {
            state.totalResults = Math.max(state.items.length, Number(res.totalResults) || state.items.length);
          } else {
            state.totalResults = Math.max(state.items.length, Number(state.totalResults) || state.items.length);
          }
          state.hasMorePages = Boolean(res && res.hasMore && freshItems.length > 0);
          renderDiscover(state.isSearchMode ? ("🔍 Suchergebnisse: " + state.searchQuery) : undefined);
          if (firstNewItem) {
            const firstNewTc = firstNewItem.media_type === "tv" ? "s" : firstNewItem.media_type === "movie" ? "m" : state.type;
            const firstNewCard = document.querySelector('.card[data-card-key="' + firstNewTc + '_' + firstNewItem.id + '"]');
            if (firstNewCard && typeof jumpSpatialFocus === "function") {
              jumpSpatialFocus(firstNewCard, false);
            }
          }
        } catch (e) {
          if (gridEl) {
            gridEl.querySelectorAll('[data-skeleton="1"]').forEach(el => el.remove());
          }
          showHudToast("⚠️ Weitere Ergebnisse konnten nicht geladen werden.");
        } finally {
          state.loadingMore = false;
          setBusyState(false);
        }
      }

      function renderDirectFilterOptionCard(category, itemValue, displayLabel, isInc, isExc) {
        const stateCls = isInc ? "state-inc" : isExc ? "state-exc" : "";
        const dfBaseId = esc(category + ":" + itemValue);
        const incBtnHtml = isInc
          ? '<button class="df-btn inc active is-neutral-on-select" data-df-id="' + dfBaseId + ':inc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + esc(itemValue) + '\\',\\'neutral\\')" title="Aktiviert – Auswählen setzt auf Neutral (○)"><span class="df-ico-cur">✓</span><span class="df-ico-sel">○</span></button>'
          : '<button class="df-btn inc" data-df-id="' + dfBaseId + ':inc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + esc(itemValue) + '\\',\\'include\\')" title="Positiv aktivieren (✓)">✓</button>';
        const excBtnHtml = isExc
          ? '<button class="df-btn exc active is-neutral-on-select" data-df-id="' + dfBaseId + ':exc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + esc(itemValue) + '\\',\\'neutral\\')" title="Gesperrt – Auswählen setzt auf Neutral (○)"><span class="df-ico-cur">✕</span><span class="df-ico-sel">○</span></button>'
          : '<button class="df-btn exc" data-df-id="' + dfBaseId + ':exc" onclick="setDirectFilter(\\'' + category + '\\',\\'' + esc(itemValue) + '\\',\\'exclude\\')" title="Negativ ausschließen (✕)">✕</button>';
        return '<div class="direct-filter-card ' + stateCls + '">' +
          '<span class="df-label">' +
            displayLabel +
          '</span>' +
          '<div class="df-actions">' +
            incBtnHtml +
            excBtnHtml +
          '</div>' +
        '</div>';
      }

      function buildFloatingFilterBarHtml() {
        const s = state.settings || {};
        const rawIncPlatforms = Array.isArray(s.includedPlatforms) ? s.includedPlatforms : [];
        const incPlatforms = Array.from(new Set(rawIncPlatforms.map(normalizePlatformIdClient).filter(Boolean)));
        const rawExcPlatforms = Array.isArray(s.excludedPlatforms) ? s.excludedPlatforms : [];
        const excPlatforms = Array.from(new Set(rawExcPlatforms.map(normalizePlatformIdClient).filter(Boolean)));
        const pills = [];

        if (state.currentCompanyId) {
          pills.push('<span class="f-pill inc" tabindex="0" onclick="clearStudioView()" title="Aktiver Studio-Filter – Antippen zum Entfernen">🏢 ' + esc(state.currentCompanyName || "Studio") + ' ✕</span>');
        }

        if (state.genreId && state.genreId !== "all") {
          const genreMap = (Object.keys(state.genres || {}).length > 0)
            ? state.genres
            : (state.type === "s" ? SERIES_GENRES_CLIENT : MOVIE_GENRES_CLIENT);
          const gEntry = Object.entries(genreMap).find(([, id]) => String(id) === String(state.genreId));
          const gName = gEntry ? gEntry[0] : "Genre";
          pills.push('<span class="f-pill inc" tabindex="0" onclick="onSearchGenreSelectChange(\\'all\\')" title="Aktiver Filter – Antippen zum Entfernen">' + genreEmoji(gName) + ' ' + esc(gName) + ' ✕</span>');
        }

        (s.includedGenres || []).forEach(g => {
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'genre\\',\\''+esc(g)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">' + genreEmoji(g) + ' ' + esc(g) + ' ✕</span>');
        });
        (s.excludedGenres || []).forEach(g => {
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'genre\\',\\''+esc(g)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">' + genreEmoji(g) + ' ' + esc(g) + ' ✕</span>');
        });

        if (incPlatforms.length > 1) {
          incPlatforms.forEach(pid => {
            const label = getPlatformDisplayLabelClient(pid);
            pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'platform\\',\\''+esc(pid)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">' + esc(label) + ' ✕</span>');
          });
        }
        excPlatforms.forEach(pid => {
          const label = getPlatformDisplayLabelClient(pid);
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'platform\\',\\''+esc(pid)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">' + esc(label) + ' ✕</span>');
        });

        (s.includedEras || []).forEach(eid => {
          const er = ERA_OPTIONS_CLIENT.find(e => e.id === eid);
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'era\\',\\''+esc(eid)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">📅 ' + esc(er ? er.label : eid) + ' ✕</span>');
        });
        (s.excludedEras || []).forEach(eid => {
          const er = ERA_OPTIONS_CLIENT.find(e => e.id === eid);
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'era\\',\\''+esc(eid)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">📅 ' + esc(er ? er.label : eid) + ' ✕</span>');
        });

        (s.includedStudios || []).forEach(sid => {
          const st = STUDIO_OPTIONS_CLIENT.find(x => x.id === sid);
          const label = st ? (st.icon + " " + st.label) : sid;
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'studio\\',\\''+esc(sid)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">' + esc(label) + ' ✕</span>');
        });
        (s.excludedStudios || []).forEach(sid => {
          const st = STUDIO_OPTIONS_CLIENT.find(x => x.id === sid);
          const label = st ? (st.icon + " " + st.label) : sid;
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'studio\\',\\''+esc(sid)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">' + esc(label) + ' ✕</span>');
        });

        (s.includedFsk || []).forEach(f => {
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'fsk\\',\\''+esc(f)+'\\',\\'neutral\\')" title="Aktiver Filter – Antippen zum Entfernen">🔞 ' + esc(f) + ' ✕</span>');
        });
        (s.excludedFsk || []).forEach(f => {
          pills.push('<span class="f-pill exc" tabindex="0" onclick="setDirectFilter(\\'fsk\\',\\''+esc(f)+'\\',\\'neutral\\')" title="Gesperrter Filter – Antippen zum Aufheben">🔞 ' + esc(f) + ' ✕</span>');
        });

        if (s.showUnreleased) {
          pills.push('<span class="f-pill inc" tabindex="0" onclick="setDirectFilter(\\'unreleased\\',\\'\\',\\'toggle\\')" title="Unveröffentlichte wieder ausblenden">🗓️ Unreleased ✕</span>');
        }

        const isColView = state.currentView === "collection" && state.currentCollectionId;
        const isUniView = state.currentView === "universe" && state.currentUniverseId;
        const isPerView = state.currentView === "person" && state.currentPersonId;

        const isDiscoverView = !state.isSearchMode && state.currentView === 'discover';
        const curMode = state.mode || 'trend';
        const curSort = state.sort || "default";

        // Smart-Cockpit Sortierlogik (inspiriert von JustWatch & Netflix):
        // - "📥 Hinzugefügt am ▼/▲" NUR anzeigen, wenn 🌟 Nur VIP-Streams aktiv ist!
        // - Volle Sortier-Kriterien (Beliebt, Bewertung, Jahr) zeigen bei Suche, Genre-Filter, Studio-Filter, Kollektion/Universum/Person.
        // - Bei reinem Modus-Browsen (Trending/Beliebt/Top/Neuheiten + z.B. Netflix) kompakte Auf-/Absteigend-Richtungswahl anbieten statt redundanter Kriterien.
        const isVipActive = Boolean(s.onlyVipStreams && isCurrentUserVip());
        const hasGenreOrStudioActive = Boolean(
          (state.genreId && state.genreId !== "all") ||
          state.currentCompanyId ||
          (Array.isArray(s.includedGenres) && s.includedGenres.length > 0) ||
          (Array.isArray(s.includedStudios) && s.includedStudios.length > 0) ||
          (Array.isArray(s.includedEras) && s.includedEras.length > 0)
        );
        const showFullSortCriteria = Boolean(
          state.isSearchMode ||
          isVipActive ||
          hasGenreOrStudioActive ||
          isColView ||
          isUniView ||
          isPerView
        );

        let sortGroupHtml = "";
        if (showFullSortCriteria) {
          sortGroupHtml = '<select class="sort-select" onchange="onSortSelectChange(this.value)" title="Sortierreihenfolge wählen">' +
            '<option value="default"' + (curSort === 'default' ? ' selected' : '') + '>✨ Sortierung: Standard</option>' +
            (isVipActive ? (
              '<option value="added_desc"' + (curSort === 'added_desc' ? ' selected' : '') + '>📥 Hinzugefügt am ▼</option>' +
              '<option value="added_asc"' + (curSort === 'added_asc' ? ' selected' : '') + '>📥 Hinzugefügt am ▲</option>'
            ) : '') +
            '<option value="pop_desc"' + (curSort === 'pop_desc' ? ' selected' : '') + '>🔥 Beliebt ▼</option>' +
            '<option value="pop_asc"' + (curSort === 'pop_asc' ? ' selected' : '') + '>🔥 Beliebt ▲</option>' +
            '<option value="rating_desc"' + (curSort === 'rating_desc' ? ' selected' : '') + '>⭐ Bewertung ▼</option>' +
            '<option value="rating_asc"' + (curSort === 'rating_asc' ? ' selected' : '') + '>⭐ Bewertung ▲</option>' +
            '<option value="year_desc"' + (curSort === 'year_desc' ? ' selected' : '') + '>📅 Jahr ▼</option>' +
            '<option value="year_asc"' + (curSort === 'year_asc' ? ' selected' : '') + '>📅 Jahr ▲</option>' +
          '</select>';
        } else if (curMode !== 'trend') {
          const isAsc = curSort === 'dir_asc' || curSort.endsWith('_asc');
          sortGroupHtml = '<select class="sort-select" onchange="onSortSelectChange(this.value)" title="Reihenfolge umkehren (Absteigend / Aufsteigend)">' +
            '<option value="default"' + (!isAsc ? ' selected' : '') + '>✨ Sortierung: ▼ Absteigend (Standard)</option>' +
            '<option value="dir_asc"' + (isAsc ? ' selected' : '') + '>✨ Sortierung: ▲ Aufsteigend</option>' +
          '</select>';
        }

        // Im Suchmodus KEIN "Modus wählen..." / "Trending" Dropdown anzeigen! Stattdessen den Such-Bereich (Alles / Filme / Serien / Person / Reihe) anbieten:
        const curScope = state.searchScope || 'all';
        const modeOrScopeHtml = state.isSearchMode
          ? (
            '<select id="searchScopeSelect" class="mode-filter-select active-mode" onchange="onSearchScopeChange()" title="Suchbereich einschränken">' +
              '<option value="all"' + (curScope === 'all' ? ' selected' : '') + '>⚡ Bereich: Alles</option>' +
              '<option value="movie"' + (curScope === 'movie' ? ' selected' : '') + '>🎬 Nur Filme</option>' +
              '<option value="series"' + (curScope === 'series' ? ' selected' : '') + '>📺 Nur Serien</option>' +
              '<option value="person"' + (curScope === 'person' ? ' selected' : '') + '>🌟 Person / Cast</option>' +
              '<option value="collection"' + (curScope === 'collection' ? ' selected' : '') + '>🍿 Filmreihe</option>' +
            '</select>'
          )
          : (
            '<select class="mode-filter-select ' + (isDiscoverView ? 'active-mode' : '') + '" onchange="onModeSelectChange(this.value)" title="Kategorie-Modus wählen (Trending, Beliebt, Top, Geheimtipps, Neuheiten)">' +
              (!isDiscoverView ? '<option value="" selected disabled hidden>📂 Modus wählen...</option>' : '') +
              '<option value="trend"' + (isDiscoverView && curMode === 'trend' ? ' selected' : '') + '>🔥 Trending</option>' +
              '<option value="pop"' + (isDiscoverView && curMode === 'pop' ? ' selected' : '') + '>🌟 Beliebt</option>' +
              '<option value="top"' + (isDiscoverView && curMode === 'top' ? ' selected' : '') + '>🏆 Top Bewertet</option>' +
              '<option value="gems"' + (isDiscoverView && curMode === 'gems' ? ' selected' : '') + '>💎 Geheimtipps</option>' +
              '<option value="new"' + (isDiscoverView && curMode === 'new' ? ' selected' : '') + '>🆕 Neuheiten</option>' +
            '</select>'
          );

        const activeProviderVal = s.onlyVipStreams
          ? 'vip'
          : (incPlatforms.length === 1 ? incPlatforms[0] : (incPlatforms.length > 1 ? '__multi__' : 'all'));
        const isProviderFiltered = activeProviderVal !== 'all';

        const providerSelectHtml = '<select class="new-filter-select ' + (isProviderFiltered ? 'active-new' : '') + '" onchange="onProviderFilterSelectChange(this.value)" title="Nach Streaming-Anbieter filtern">' +
          '<option value="all"' + (activeProviderVal === 'all' ? ' selected' : '') + '>📺 Alle Anbieter</option>' +
          (activeProviderVal === '__multi__' ? '<option value="__multi__" selected disabled hidden>📺 ' + incPlatforms.length + ' Anbieter aktiv</option>' : '') +
          (isCurrentUserVip() ? '<option value="vip"' + (activeProviderVal === 'vip' ? ' selected' : '') + '>🌟 Nur VIP-Streams</option>' : '') +
          PLATFORM_OPTIONS_CLIENT.map(pl =>
            '<option value="' + esc(pl.id) + '"' + (activeProviderVal === pl.id ? ' selected' : '') + '>' + esc(pl.icon + ' ' + pl.label) + '</option>'
          ).join('') +
        '</select>';

        const isFranchiseActive = !state.isSearchMode && (state.currentView === 'franchises' || isColView || isUniView || state.worldsTrayOpen);

        const controlsHtml =
          modeOrScopeHtml +
          providerSelectHtml +
          sortGroupHtml +
          (!state.isSearchMode ? '<button class="btn ' + (isFranchiseActive ? 'red' : '') + '" onclick="toggleWorldsTray()" title="Filmuniversen & Filmreihen Portal-Dock ein- oder ausklappen">🌌 Welten & Reihen ' + (state.worldsTrayOpen ? '▴' : '▾') + '</button>' : '') +
          ((state.isSearchMode || isColView || isUniView || isPerView || state.currentCompanyId) ? '<button class="btn" onclick="goHome()">🏠 Hauptseite</button>' : '');

        return '<div class="floating-filter-bar">' +
          '<div class="ff-controls-grid">' +
            controlsHtml +
          '</div>' +
          (state.worldsTrayOpen && !state.isSearchMode ? buildWorldsPortalTrayHtml() : '') +
          (pills.length > 0 ? (
            '<div class="ff-active-pills" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.2)">' +
              pills.join("") +
              '<button class="btn red" style="padding:2px 8px;font-size:10.5px" onclick="setDirectFilter(\\'reset_all\\',\\'\\',\\'neutral\\')" title="Alle aktiven Filter löschen">🗑️ Reset</button>' +
            '</div>'
          ) : '') +
        '</div>';
      }

      function toggleWorldsTray(forceState) {
        state.worldsTrayOpen = typeof forceState === "boolean" ? forceState : !state.worldsTrayOpen;
        const fm = document.getElementById("floatingFilterMount");
        if (fm) fm.innerHTML = buildFloatingFilterBarHtml();
      }

      function switchWorldsTrayTab(tab) {
        state.worldsTrayTab = tab === "collections" ? "collections" : "universes";
        const fm = document.getElementById("floatingFilterMount");
        if (fm) fm.innerHTML = buildFloatingFilterBarHtml();
      }

      let worldsTraySearchTimer = null;
      function onWorldsTraySearchInput(val) {
        state.worldsTrayQuery = String(val || "");
        const gridEl = document.getElementById("worldsPortalGridMount");
        if (gridEl) gridEl.innerHTML = buildWorldsPortalCardsOnlyHtml();
        if (worldsTraySearchTimer) clearTimeout(worldsTraySearchTimer);
        const q = state.worldsTrayQuery.trim();
        if (q.length >= 2) {
          worldsTraySearchTimer = setTimeout(async () => {
            try {
              const r = await apiFetchJson(API_BASE + "/collections?chatId=" + encodeURIComponent(chatId) + "&q=" + encodeURIComponent(q));
              if (r && Array.isArray(r.results)) {
                state.worldsTrayRemoteCols = r.results.slice(0, 12);
                const g2 = document.getElementById("worldsPortalGridMount");
                if (g2) g2.innerHTML = buildWorldsPortalCardsOnlyHtml();
              }
            } catch (e) {}
          }, 260);
        } else {
          state.worldsTrayRemoteCols = [];
        }
      }

      function buildWorldsPortalCardsOnlyHtml() {
        const q = String(state.worldsTrayQuery || "").trim().toLowerCase();
        const isColsTab = state.worldsTrayTab === "collections";

        if (!isColsTab && !q) {
          return (CINEMATIC_UNIVERSES_CLIENT || []).map(u =>
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openUniverseView(\\'' + esc(u.id) + '\\')">' +
              '<div class="world-portal-icon">' + esc(u.icon || '🌌') + '</div>' +
              '<div class="world-portal-info">' +
                '<div class="world-portal-name">' + esc(u.name) + '</div>' +
                '<div class="world-portal-sub">' + esc(u.desc || 'Filmuniversum') + '</div>' +
              '</div>' +
            '</button>'
          ).join("");
        }

        if (isColsTab && !q) {
          return (FEATURED_COLLECTIONS_CLIENT || []).map(c =>
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openCollectionView(' + Number(c.id) + ')">' +
              '<div class="world-portal-icon">' + esc(c.icon || '🍿') + '</div>' +
              '<div class="world-portal-info">' +
                '<div class="world-portal-name">' + esc(c.name) + '</div>' +
                '<div class="world-portal-sub">Filmreihe öffnen</div>' +
              '</div>' +
            '</button>'
          ).join("");
        }

        // Bei eingegebenem Suchbegriff: Universen + lokale Filmreihen + Live-TMDb-Reihen kombiniert zeigen!
        const matchedUnis = (CINEMATIC_UNIVERSES_CLIENT || []).filter(u =>
          u.name.toLowerCase().includes(q) || (u.desc && u.desc.toLowerCase().includes(q)) || u.id.toLowerCase().includes(q)
        );
        const matchedLocalCols = (FEATURED_COLLECTIONS_CLIENT || []).filter(c =>
          c.name.toLowerCase().includes(q)
        );
        const seenColIds = new Set(matchedLocalCols.map(c => Number(c.id)));
        const extraRemoteCols = (state.worldsTrayRemoteCols || []).filter(c => c && c.id && !seenColIds.has(Number(c.id)));

        const cards = [
          ...matchedUnis.map(u =>
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openUniverseView(\\'' + esc(u.id) + '\\')">' +
              '<div class="world-portal-icon">' + esc(u.icon || '🌌') + '</div>' +
              '<div class="world-portal-info">' +
                '<div class="world-portal-name">' + esc(u.name) + '</div>' +
                '<div class="world-portal-sub">🌌 Universum • ' + esc(u.desc || '') + '</div>' +
              '</div>' +
            '</button>'
          ),
          ...matchedLocalCols.map(c =>
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openCollectionView(' + Number(c.id) + ')">' +
              '<div class="world-portal-icon">' + esc(c.icon || '🍿') + '</div>' +
              '<div class="world-portal-info">' +
                '<div class="world-portal-name">' + esc(c.name) + '</div>' +
                '<div class="world-portal-sub">🍿 Beliebte Filmreihe</div>' +
              '</div>' +
            '</button>'
          ),
          ...extraRemoteCols.map(c =>
            '<button type="button" class="world-portal-card" onclick="state.worldsTrayOpen=false;openCollectionView(' + Number(c.id) + ')">' +
              '<div class="world-portal-icon">🍿</div>' +
              '<div class="world-portal-info">' +
                '<div class="world-portal-name">' + esc(c.name) + '</div>' +
                '<div class="world-portal-sub">🍿 TMDb Filmreihe</div>' +
              '</div>' +
            '</button>'
          )
        ];

        return cards.length > 0
          ? cards.join("")
          : '<div style="grid-column:1 / -1;font-size:12px;color:var(--text-muted);padding:6px">Keine passende Reihe oder Welt zu „' + esc(state.worldsTrayQuery) + '“ gefunden.</div>';
      }

      function buildWorldsPortalTrayHtml() {
        const isColsTab = state.worldsTrayTab === "collections";
        return '<div class="worlds-portal-tray">' +
          '<div class="worlds-portal-header">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button type="button" class="btn ' + (!isColsTab ? 'red' : '') + '" onclick="switchWorldsTrayTab(\\'universes\\')">🌌 Universen (' + (CINEMATIC_UNIVERSES_CLIENT ? CINEMATIC_UNIVERSES_CLIENT.length : 0) + ')</button>' +
              '<button type="button" class="btn ' + (isColsTab ? 'red' : '') + '" onclick="switchWorldsTrayTab(\\'collections\\')">🍿 Filmreihen (' + (FEATURED_COLLECTIONS_CLIENT ? FEATURED_COLLECTIONS_CLIENT.length : 0) + '+)</button>' +
            '</div>' +
            '<input type="text" class="worlds-search-input" value="' + esc(state.worldsTrayQuery || '') + '" oninput="onWorldsTraySearchInput(this.value)" placeholder="🔍 Welt oder Filmreihe suchen (z.B. Marvel, Star Wars, Saw, Dune)..." />' +
            '<button type="button" class="btn" onclick="state.worldsTrayOpen=false;loadFranchisesHub(\\'' + (isColsTab ? 'collections' : 'universes') + '\\')" title="Große Vollbild-Übersicht öffnen">🗂️ Vollbild-Hub</button>' +
          '</div>' +
          '<div id="worldsPortalGridMount" class="worlds-portal-grid">' +
            buildWorldsPortalCardsOnlyHtml() +
          '</div>' +
        '</div>';
      }

      function renderDiscover(customTitle) {
        const root = document.getElementById("appRoot");
        const vipAllowed = isCurrentUserVip();

        const heroSectionHtml = state.isSearchMode
          ? ""
          : '<div id="heroBannerSlot">' + buildHeroBannerInnerHtml() + '</div>';

        const isColView = state.currentView === "collection" && state.currentCollectionId;
        const isUniView = state.currentView === "universe" && state.currentUniverseId;
        const isPerView = state.currentView === "person" && state.currentPersonId;

        const franchiseActionBannerHtml = (isColView || isUniView) ? (
          '<div class="panel-box" style="margin-bottom:10px;border-color:' + (isColView ? 'rgba(91,70,245,0.5)' : 'rgba(16,185,129,0.5)') + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div>' +
                '<div style="font-size:14px;font-weight:800;color:var(--text-main)">' + esc(customTitle || (isColView ? '🍿 Filmreihe' : '🌌 Filmuniversum')) + '</div>' +
                '<div style="font-size:11.5px;color:var(--text-muted)">Direkt über Telegram teilen oder komplett in deiner Merkliste speichern:</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="btn green" onclick="saveWholeCollectionOrUniverseTma(\\'' + (isColView ? 'col' : 'uni') + '\\',\\'' + esc(isColView ? state.currentCollectionId : state.currentUniverseId) + '\\')">💾 Alle ' + state.items.length + ' sichtbaren speichern</button>' +
                '<button class="btn purple" onclick="shareCollectionOrUniverseFromTma(\\'' + (isColView ? 'col' : 'uni') + '\\',\\'' + esc(isColView ? state.currentCollectionId : state.currentUniverseId) + '\\',\\'' + esc(isColView ? state.currentCollectionName : state.currentUniverseName) + '\\')">📤 Teilen</button>' +
                '<button class="btn" onclick="loadFranchisesHub(\\'' + (isColView ? 'collections' : 'universes') + '\\')">🔙 Alle ' + (isColView ? 'Reihen' : 'Universen') + '</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        ) : '';

        // Bei aktiver Suche: Erkannte Filmstudios, Filmreihen, Universen & Personen standardmäßig EINGEKLAPPT und per Klick ausklappbar!
        const detectedCount =
          ((state.searchMatchedStudios && state.searchMatchedStudios.length) || 0) +
          ((state.searchMatchedUniverses && state.searchMatchedUniverses.length) || 0) +
          ((state.searchMatchedCollections && state.searchMatchedCollections.length) || 0) +
          ((state.searchMatchedPersons && state.searchMatchedPersons.length) || 0);
        const hasSearchEntities = state.isSearchMode && detectedCount > 0;
        const isEntitiesOpen = Boolean(state.searchEntitiesExpanded);
        const searchDetectedEntitiesHtml = hasSearchEntities ? (
          '<div class="panel-box" style="margin-bottom:10px;padding:8px 12px;border-color:rgba(91,70,245,0.45)">' +
            '<div onclick="toggleSearchDetectedEntities()" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;gap:8px">' +
              '<span style="font-size:12px;font-weight:800;color:#c4b5fd">✨ Automatisch zu deiner Suche erkannt (' + detectedCount + ')</span>' +
              '<span id="searchDetectedEntitiesToggleIcon" style="font-size:11.5px;font-weight:700;color:#a78bfa">' + (isEntitiesOpen ? 'Ausblenden ▴' : 'Anzeigen ▾') + '</span>' +
            '</div>' +
            '<div id="searchDetectedEntitiesBody" style="display:' + (isEntitiesOpen ? 'flex' : 'none') + ';gap:6px;flex-wrap:wrap;margin-top:8px">' +
              (state.searchMatchedStudios || []).map(st =>
                '<button class="btn" style="background:rgba(245,158,11,0.2);border-color:#f59e0b" onclick="openStudioView(\\'' + esc(st.companyIds || st.id) + '\\',\\'' + esc(st.name) + '\\')">' + esc(st.icon || '🏢') + ' Studio: ' + esc(st.name) + '</button>'
              ).join("") +
              (state.searchMatchedUniverses || []).map(u =>
                '<button class="btn" style="background:rgba(16,185,129,0.2);border-color:#10b981" onclick="openUniverseView(\\'' + esc(u.id) + '\\')">' + esc(u.icon || '🌌') + ' Universum: ' + esc(u.name) + '</button>'
              ).join("") +
              (state.searchMatchedCollections || []).map(c =>
                '<button class="btn" style="background:rgba(91,70,245,0.22);border-color:#7c69ff" onclick="openCollectionView(' + Number(c.id) + ')">🍿 Filmreihe: ' + esc(c.name) + '</button>'
              ).join("") +
              (state.searchMatchedPersons || []).map(p =>
                '<button class="btn" style="background:rgba(2,132,199,0.22);border-color:#38bdf8" onclick="openPersonView(' + Number(p.id) + ',\\'' + esc(p.name) + '\\')">🌟 ' + esc(p.name) + (p.known_for ? ' (' + esc(p.known_for) + ')' : '') + '</button>'
              ).join("") +
            '</div>' +
          '</div>'
        ) : '';

        // Zuletzt angesehen (Quick-Resume Strip) auf der Hauptseite – aktualisiert sich live bei jedem Klick!
        const recentStripMountHtml = '<div id="recentViewedMount">' + buildRecentViewedStripHtml() + '</div>';

        const baseModeTitle = state.currentCompanyId
          ? ("🏢 Studio: " + esc(state.currentCompanyName || "Filmstudio"))
          : state.mode === "trend"
            ? "🔥 Trending"
            : state.mode === "pop"
              ? "🌟 Beliebt"
              : state.mode === "top"
                ? "🏆 Top Bewertet"
                : state.mode === "gems"
                  ? "💎 Geheimtipps"
                  : "🆕 Neuheiten";
        const activeIncPlats = Array.isArray(state.settings?.includedPlatforms)
          ? Array.from(new Set(state.settings.includedPlatforms.map(normalizePlatformIdClient).filter(Boolean)))
          : [];
        const providerTitleSuffix = state.settings?.onlyVipStreams
          ? " • 🌟 VIP-Streams"
          : activeIncPlats.length === 1
            ? (" • " + esc(getPlatformDisplayLabelClient(activeIncPlats[0])))
            : "";
        const headerTitle = customTitle
          ? esc(customTitle)
          : (baseModeTitle + providerTitleSuffix);

        const showTop10Ranks = !state.isSearchMode && state.currentView === "discover" && state.mode === "trend" && !state.currentCompanyId;
        const isMixedMediaView = Boolean(state.isSearchMode || isColView || isUniView || isPerView);
        const curPage = Math.max(1, Number(state.page) || 1);
        const startPage = Math.max(1, Math.min(curPage, Number(state.startPage) || 1));
        const totPages = Math.max(curPage, Number(state.totalPages) || 1);
        const totalResNum = Math.max(state.items.length, Number(state.totalResults) || state.items.length);
        const pageRangeLabel = startPage < curPage
          ? ("Seiten " + startPage + "–" + curPage + " von " + totPages)
          : ("Seite " + curPage + " von " + totPages);
        const hitsLabel = (!isColView && !isUniView && !isPerView && (totPages > 1 || totalResNum > state.items.length))
          ? (state.items.length + " geladen • " + totalResNum.toLocaleString("de-DE") + " Treffer")
          : (state.items.length + " Treffer");
        const hasNextPage = Boolean(state.hasMorePages && curPage < totPages && state.items.length > 0);
        const canPaginateView = Boolean((state.currentView === "discover" || state.isSearchMode) && !isColView && !isUniView && !isPerView && (hasNextPage || totPages > 1) && state.items.length > 0);

        // Direkt-Seitenwahl (#17) berechnen – auf der letzten Seite wird „Mehr laden“ ausgeblendet, bei 1 Seite komplett ausgeblendet
        let paginationBarHtml = "";
        if (canPaginateView) {
          const pageButtons = [];
          const maxQuickPages = Math.min(totPages, 7);
          let startP = Math.max(1, curPage - 3);
          let endP = Math.min(totPages, startP + maxQuickPages - 1);
          if (endP - startP + 1 < maxQuickPages) {
            startP = Math.max(1, endP - maxQuickPages + 1);
          }
          if (startP > 1) {
            pageButtons.push('<button type="button" class="page-jump-btn ' + (1 >= startPage && 1 <= curPage ? 'active' : '') + '" onclick="jumpToPage(1)">1</button>');
            if (startP > 2) pageButtons.push('<span style="color:var(--text-muted);font-size:11px;padding:0 2px">…</span>');
          }
          for (let p = startP; p <= endP; p++) {
            pageButtons.push('<button type="button" class="page-jump-btn ' + (p >= startPage && p <= curPage ? 'active' : '') + '" onclick="jumpToPage(' + p + ')">' + p + '</button>');
          }
          if (endP < totPages) {
            if (endP < totPages - 1) pageButtons.push('<span style="color:var(--text-muted);font-size:11px;padding:0 2px">…</span>');
            pageButtons.push('<button type="button" class="page-jump-btn" onclick="jumpToPage(' + totPages + ')">' + totPages + '</button>');
          }
          paginationBarHtml = '<div class="load-more-wrap">' +
            (hasNextPage ? (
              '<button type="button" id="loadMoreGridBtn" class="btn red" style="padding:9px 20px;font-size:13px" onclick="loadMoreResults()">➕ Mehr laden (Seite ' + (curPage + 1) + ' von ' + totPages + ')</button>'
            ) : '') +
            (totPages > 1 ? (
              '<div class="pagination-bar">' +
                '<span class="page-counter-pill">📄 ' + pageRangeLabel + '</span>' +
                (curPage > 1 ? '<button type="button" class="page-jump-btn" onclick="jumpToPage(' + (curPage - 1) + ')" title="Vorherige Seite">◀</button>' : '') +
                pageButtons.join("") +
                (curPage < totPages ? '<button type="button" class="page-jump-btn" onclick="jumpToPage(' + (curPage + 1) + ')" title="Nächste Seite">▶</button>' : '') +
              '</div>'
            ) : '') +
          '</div>';
        }

        root.innerHTML = heroSectionHtml +
          '<div class="section">' +
            '<div id="floatingFilterMount">' + buildFloatingFilterBarHtml() + '</div>' +
            recentStripMountHtml +
            searchDetectedEntitiesHtml +
            franchiseActionBannerHtml +
            '<div class="section-title" style="margin-top:6px">' +
              '<span>' + headerTitle + ' (' + hitsLabel + ')</span>' +
              ((!isColView && !isUniView && !isPerView && totPages > 1) ? '<span class="page-counter-pill">📄 ' + pageRangeLabel + '</span>' : '') +
            '</div>' +
            '<div id="resultsGridContainer" class="carousel">' + (state.items.length > 0 ? state.items.map((it, idx) => {
              const tc = it.media_type === 'tv' ? 's' : it.media_type === 'movie' ? 'm' : state.type;
              const badgeTxt = tc === 's' ? '📺 Serie' : '🎬 Film';
              const cardKey = tc + "_" + it.id;
              const isCardSaved = savedKeysSet.has(cardKey);
              const rankHtml = (showTop10Ranks && idx < 10) ? ('<span class="card-rank-badge">#' + (idx + 1) + '</span>') : '';
              const typeBadgeHtml = isMixedMediaView ? ('<span class="card-type-badge">' + badgeTxt + '</span>') : '';
              // Dezenter grüner VIP-Punkt auf dem Cover (Details im Modal)
              const vipQualityHtml = (vipAllowed && it.vipQuality)
                ? ('<span class="card-vip-dot" title="VIP-Stream verfügbar: ' + esc(it.vipQuality) + '"></span>')
                : '';
              const itemTitleSafe = esc(it.title || it.name || '');
              const resolvedCardPoster = resolvePosterUrlClient(it.poster_path, 'w342', it.external_poster_url || it.poster || '');
              const itemPosterSafe = esc(it.poster_path || it.external_poster_url || it.poster || '');
              const yrStr = esc((it.release_date || it.first_air_date || '').slice(0, 4) || '–');
              const ratStr = it.vote_average ? it.vote_average.toFixed(1) : '–';
              return '<div class="card" tabindex="0" data-card-key="' + esc(cardKey) + '" data-card-title="' + itemTitleSafe + '" onclick="openDetails(\\''+tc+'\\','+it.id+',false,\\''+itemTitleSafe+'\\',\\''+itemPosterSafe+'\\')">' +
                '<div class="card-poster-wrap">' +
                  '<div class="card-top-left-stack">' +
                    rankHtml +
                    typeBadgeHtml +
                    vipQualityHtml +
                  '</div>' +
                  '<button type="button" class="card-quick-save ' + (isCardSaved ? 'saved' : '') + '" onclick="quickToggleCardWishlist(event,\\'' + tc + '\\',' + it.id + ',\\'' + itemTitleSafe + '\\')" title="In Merkliste speichern oder entfernen (Tipp oder Karte gedrückt halten)">' + (isCardSaved ? '✓' : '🔖') + '</button>' +
                  '<button type="button" class="card-quick-info" onclick="event.stopPropagation();openDetails(\\''+tc+'\\','+it.id+',false,\\''+itemTitleSafe+'\\',\\''+itemPosterSafe+'\\')" title="Details öffnen">ℹ️ Details</button>' +
                  '<button type="button" class="card-quick-trailer" onclick="playInstantTrailerFromCard(event,\\'' + tc + '\\',' + it.id + ',\\'' + itemTitleSafe + '\\',\\'' + itemPosterSafe + '\\')" title="Instant-Trailer sofort abspielen">▶ Trailer</button>' +
                  '<img src="' + (resolvedCardPoster ? esc(resolvedCardPoster) : 'https://via.placeholder.com/300x450?text=Kein+Poster') + '" loading="lazy" draggable="false" oncontextmenu="return false;" alt="' + itemTitleSafe + '" />' +
                '</div>' +
                '<div class="card-body">' +
                  '<div class="card-title">' + itemTitleSafe + '</div>' +
                  '<div class="card-sub"><span>⭐ ' + ratStr + '</span><span>' + yrStr + '</span></div>' +
                '</div>' +
              '</div>';
            }).join("") + paginationBarHtml : (
              '<div class="panel-box" style="grid-column:1 / -1;margin-top:6px">' +
                '<div class="section-title">⚠️ Keine Treffer mit dieser Filter-Kombination auf Seite ' + curPage + '</div>' +
                '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Passe in der linken Sidebar (☰ Filter) einzelne Filter an oder setze alle Filter zurück:</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                  '<button class="btn purple" onclick="toggleFilterSidebar()">☰ Filter-Sidebar öffnen</button>' +
                  '<button class="btn red" onclick="setDirectFilter(\\'reset_all\\',\\'\\',\\'neutral\\')">🗑️ Alle Filter zurücksetzen</button>' +
                '</div>' +
              '</div>'
            )) + '</div>' +
          '</div>';
      }

      async function loadFranchisesHub(tab) {
        if (tab) state.franchiseTab = tab;
        state.currentView = "franchises";
        const root = document.getElementById("appRoot");
        setBusyState(true, "⏳ Lade Filmreihen & Filmuniversen...");
        try {
          const [colsRes, unisRes] = await Promise.all([
            apiFetchJson(API_BASE + "/collections?chatId=" + encodeURIComponent(chatId)),
            apiFetchJson(API_BASE + "/universes?chatId=" + encodeURIComponent(chatId))
          ]);
          const cols = colsRes.collections || [];
          const unis = unisRes.universes || [];
          const isUni = state.franchiseTab === "universes";

          root.innerHTML = '<div class="section">' +
            '<div id="floatingFilterMount">' + buildFloatingFilterBarHtml() + '</div>' +
            '<div class="section-title" style="margin-top:6px"><span>🍿 Filmreihen & 🌌 Filmuniversen</span><div style="display:flex;gap:6px"><button class="btn" onclick="goHome()">🏠 Zur Hauptseite</button></div></div>' +
            '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
              '<button class="btn ' + (!isUni ? 'red' : '') + '" onclick="loadFranchisesHub(\\'collections\\')">🍿 Beliebte Filmreihen (' + cols.length + ')</button>' +
              '<button class="btn ' + (isUni ? 'red' : '') + '" onclick="loadFranchisesHub(\\'universes\\')">🌌 Große Filmuniversen (' + unis.length + ')</button>' +
            '</div>' +
            (!isUni ? (
              '<div style="display:flex;gap:6px;margin-bottom:12px">' +
                '<input id="colSearchInput" style="flex:1;background:var(--card);border:1px solid rgba(148,163,184,0.35);color:var(--text);padding:8px 12px;border-radius:6px;font-size:13px" placeholder="🔍 Beliebige Filmreihe auf TMDB suchen (z.B. Saw, Matrix, John Wick)..." onkeydown="if(event.key===\\'Enter\\')searchCollectionsInHub()" />' +
                '<button class="btn red" onclick="searchCollectionsInHub()">Reihe suchen</button>' +
              '</div>' +
              '<div id="colHubGrid" class="chip-grid">' +
                cols.map(c => '<button class="btn" style="padding:9px 12px;font-size:12.5px" onclick="openCollectionView(' + c.id + ')">' + esc(c.icon || '🍿') + ' ' + esc(c.name) + '</button>').join("") +
              '</div>'
            ) : (
              '<div id="uniHubGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">' +
                unis.map(u => '<div class="panel-box f-pill neutral" tabindex="0" style="cursor:pointer;margin-bottom:0;display:block;border-radius:10px" onclick="openUniverseView(\\''+esc(u.id)+'\\')"><div style="font-size:14px;font-weight:700;margin-bottom:4px">' + esc(u.icon || '🌌') + ' ' + esc(u.name) + '</div><div style="font-size:11.5px;color:var(--muted)">' + esc(u.description || '') + '</div></div>').join("") +
              '</div>'
            )) +
          '</div>';
          const firstHubOption = root.querySelector("#colHubGrid .btn, #uniHubGrid .f-pill");
          if (firstHubOption && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstHubOption, false);
          }
        } finally {
          setBusyState(false);
        }
      }

      async function searchCollectionsInHub() {
        const inp = document.getElementById("colSearchInput");
        const q = inp ? inp.value.trim() : "";
        if (!q) return;
        if (inp && document.activeElement === inp) inp.blur();
        setBusyState(true, '🔍 Suche Filmreihe "' + q + '"...');
        try {
          const r = await apiFetchJson(API_BASE + "/collections?chatId=" + encodeURIComponent(chatId) + "&q=" + encodeURIComponent(q));
          const grid = document.getElementById("colHubGrid");
          if (!grid) return;
          const list = r.results || [];
          if (list.length === 0) {
            grid.innerHTML = '<div class="panel-box">Keine Filmreihen zu "' + esc(q) + '" gefunden.</div>';
            return;
          }
          grid.innerHTML = list.map(c => '<button class="btn" style="padding:9px 12px;font-size:12.5px" onclick="openCollectionView(' + c.id + ')">🍿 ' + esc(c.name) + '</button>').join("");
          const firstColBtn = grid.querySelector(".btn");
          if (firstColBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstColBtn, true);
          }
        } finally {
          setBusyState(false);
        }
      }

      async function openCollectionView(colId) {
        document.getElementById("modalRoot").innerHTML = "";
        setBusyState(true, "🍿 Lade Filmreihe...");
        try {
          const r = await apiFetchJson(API_BASE + "/collections?chatId=" + encodeURIComponent(chatId) + "&id=" + encodeURIComponent(colId) + "&sort=" + state.sort);
          if (!r || !r.ok) return;
          state.isSearchMode = false;
          state.currentView = "collection";
          state.currentCollectionId = r.id || colId;
          state.currentCollectionName = r.name || "Filmreihe";
          state.currentUniverseId = null;
          state.items = r.items || [];
          rebuildHeroSlides(state.items);
          renderDiscover("🍿 Filmreihe: " + (r.name || "Kollektion"));
          if (typeof focusFirstResultCard === "function") focusFirstResultCard(true);
        } finally {
          setBusyState(false);
        }
      }

      async function openUniverseView(uniId) {
        document.getElementById("modalRoot").innerHTML = "";
        setBusyState(true, "🌌 Lade Filmuniversum...");
        try {
          const r = await apiFetchJson(API_BASE + "/universes?chatId=" + encodeURIComponent(chatId) + "&id=" + encodeURIComponent(uniId) + "&sort=" + state.sort);
          if (!r || !r.ok) return;
          state.isSearchMode = false;
          state.currentView = "universe";
          state.currentUniverseId = r.id || uniId;
          state.currentUniverseName = r.name || "Filmuniversum";
          state.currentCollectionId = null;
          state.items = r.items || [];
          rebuildHeroSlides(state.items);
          renderDiscover((r.icon || "🌌") + " " + (r.name || "Filmuniversum"));
          if (typeof focusFirstResultCard === "function") focusFirstResultCard(true);
        } finally {
          setBusyState(false);
        }
      }

      async function saveWholeCollectionOrUniverseTma(kind, refId) {
        if (!state.isAuthenticated) { openAccountModal(); return; }
        setBusyState(true, "💾 Speichere " + (kind === "col" ? "Filmreihe" : "Filmuniversum") + " als eigenen Ordner in deiner Merkliste...");
        try {
          const r = await apiFetchJson(API_BASE + "/wishlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              action: kind === "col" ? "save_collection" : "save_universe",
              refId
            })
          });
          if (r && r.ok) {
            showHudToast("✅ " + (r.addedCount || 0) + " Filme in Ordner „" + (r.folderName || "") + "“ gespeichert!");
          } else {
            showHudToast("⚠️ " + (r?.error || "Speichern fehlgeschlagen."));
          }
        } finally {
          setBusyState(false);
        }
      }

      async function loadSimilarInTma(type, id) {
        setBusyState(true, "✨ Suche ähnliche Titel...");
        try {
          const r = await apiFetchJson(API_BASE + "/similar?chatId=" + encodeURIComponent(chatId) + "&type=" + type + "&id=" + id);
          const box = document.getElementById("similarModalBox");
          const items = r.items || [];
          if (!box) return;
          if (items.length === 0) {
            box.innerHTML = '<div style="font-size:12px;color:#94a3b8;margin-top:8px">Keine ähnlichen Titel mit den aktuellen Filtern gefunden.</div>';
            return;
          }
          box.innerHTML = '<div class="modal-sub-box" style="margin-top:10px;padding:10px;background:var(--card);border-radius:8px;border:1px solid rgba(148,163,184,0.22)">' +
            '<div style="font-size:12.5px;font-weight:800;color:var(--text);margin-bottom:8px">✨ Ähnliche Empfehlungen (' + items.length + '):</div>' +
            '<div class="carousel" style="grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:8px">' +
              items.slice(0, 8).map(it => {
                const tc = it.media_type === 'tv' ? 's' : type;
                const simPoster = resolvePosterUrlClient(it.poster_path, 'w342', it.external_poster_url || it.poster || '');
                return '<div class="card" tabindex="0" onclick="openDetails(\\''+tc+'\\','+it.id+',false)">' +
                  '<img src="' + (simPoster ? esc(simPoster) : 'https://via.placeholder.com/300x450?text=Poster') + '" loading="lazy" draggable="false" oncontextmenu="return false;" />' +
                  '<div class="card-body"><div class="card-title">' + esc(it.title || it.name) + '</div><div class="card-sub"><span>⭐ ' + (it.vote_average ? it.vote_average.toFixed(1) : '–') + '</span><span>' + esc((it.release_date || it.first_air_date || '').slice(0,4)) + '</span></div></div>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>';
          const firstSimCard = box.querySelector(".card");
          if (firstSimCard && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstSimCard, true);
          }
        } finally {
          setBusyState(false);
        }
      }

      // Wischgesten (Swipe) und Pfeil-Wechsel (◀ / ▶) zum nächsten/vorherigen Film im geöffneten Detail-Modal (#10)
      function getAdjacentDetailItem(step) {
        if (!state.activeDetails || !Array.isArray(state.items) || state.items.length <= 1) return null;
        const curId = String(state.activeDetails.id);
        const idx = state.items.findIndex(x => x && String(x.id) === curId);
        if (idx === -1) return null;
        const nextIdx = (idx + step + state.items.length) % state.items.length;
        const cand = state.items[nextIdx];
        if (!cand || !cand.id) return null;
        const tc = cand.media_type === "tv" ? "s" : cand.media_type === "movie" ? "m" : state.type;
        return {
          typeCode: tc,
          id: cand.id,
          title: cand.title || cand.name || "",
          poster_path: cand.poster_path || "",
          index: nextIdx,
          total: state.items.length
        };
      }

      function navigateDetailModalAdjacent(step) {
        const adj = getAdjacentDetailItem(step);
        if (!adj) return;
        openDetails(adj.typeCode, adj.id, false, adj.title, adj.poster_path);
      }

      function onModalHeroTouchStart(ev) {
        if (ev.touches && ev.touches[0]) modalTouchStartX = ev.touches[0].clientX;
      }

      function onModalHeroTouchEnd(ev) {
        if (!modalTouchStartX || !ev.changedTouches || !ev.changedTouches[0]) return;
        const dx = ev.changedTouches[0].clientX - modalTouchStartX;
        modalTouchStartX = 0;
        if (Math.abs(dx) > 55) {
          navigateDetailModalAdjacent(dx < 0 ? 1 : -1);
        }
      }

      function prepareDiscoverContextFromModal() {
        document.getElementById("modalRoot").innerHTML = "";
        closeAutocomplete();
        if (state.activeDetails && (state.activeDetails.typeCode === "m" || state.activeDetails.typeCode === "s")) {
          state.type = state.activeDetails.typeCode;
        }
        state.isSearchMode = false;
        state.searchFocused = false;
        state.searchQuery = "";
        state.currentView = "discover";
        state.currentCollectionId = null;
        state.currentUniverseId = null;
        state.currentPersonId = null;
        state.currentCompanyId = null;
        state.currentCompanyName = "";
        state.genreId = "all";
        const inp = document.getElementById("searchInput");
        if (inp) inp.value = "";
        updateSearchClearBtnVisibility();
        document.body.classList.remove("search-active-dim");
        updateMediaModeIndicatorDom();
        syncSearchGenreSelectDom();
      }

      function filterByCategoryFromModal(category, value) {
        prepareDiscoverContextFromModal();
        const normalizedVal = category === "genre" ? normalizeGenreNameForClient(value, state.type) : value;
        setDirectFilter(category, normalizedVal, "force_include");
      }

      function searchByYearFromModal(yearVal) {
        const y = String(yearVal || "").trim();
        if (!y) return;
        document.getElementById("modalRoot").innerHTML = "";
        runSearch(false, "(" + y + ")", "all");
      }

      function filterOrSearchStudioFromModal(studioName, companyId = "") {
        if (companyId) {
          openStudioView(companyId, studioName);
          return;
        }
        const norm = String(studioName || "").toLowerCase();
        const matched = STUDIO_OPTIONS_CLIENT.find(st =>
          norm.includes(st.label.toLowerCase()) ||
          st.label.toLowerCase().includes(norm) ||
          (Array.isArray(st.match) && st.match.some(m => norm.includes(String(m).toLowerCase())))
        );
        if (matched) {
          prepareDiscoverContextFromModal();
          setDirectFilter("studio", matched.id, "force_include");
        } else {
          document.getElementById("modalRoot").innerHTML = "";
          runSearch(false, studioName, "all");
        }
      }

      function filterOrSearchProviderFromModal(provName) {
        const norm = String(provName || "").toLowerCase();
        const matched = PLATFORM_OPTIONS_CLIENT.find(pl =>
          norm.includes(pl.label.toLowerCase()) ||
          pl.label.toLowerCase().includes(norm) ||
          (Array.isArray(pl.match) && pl.match.some(m => norm.includes(String(m).toLowerCase())))
        );
        if (matched) {
          prepareDiscoverContextFromModal();
          setDirectFilter("platform", matched.id, "force_include");
        } else {
          document.getElementById("modalRoot").innerHTML = "";
          runSearch(false, provName, "all");
        }
      }

      function switchEmbedSource(sourceKey, saveAsDefault = true) {
        const activeKey = sourceKey || trailerProvider || "youtube";
        if (saveAsDefault && sourceKey) {
          setTrailerProvider(sourceKey);
          const detailBtns = document.querySelectorAll("#modalRoot button[data-detail-tp-id]");
          detailBtns.forEach(b => {
            const pid = b.getAttribute("data-detail-tp-id") || "";
            const tpObj = TRAILER_PROVIDERS_CLIENT.find(x => x.id === pid);
            const isMatch = pid === activeKey;
            b.className = "btn " + (isMatch ? "red" : "");
            if (tpObj) b.textContent = tpObj.label + (isMatch ? " ✓ Standard" : "");
          });
        }
        const d = state.activeDetails;
        if (!d || !d.trailers || !d.trailers.embeds) return;
        const box = document.getElementById("trailerEmbedContainer");
        if (!box) return;
        const embedUrl = d.trailers.embeds[activeKey] || d.trailers.embeds.youtube;
        box.innerHTML = '<div class="embed-box"><iframe class="embed-frame" src="' + esc(embedUrl) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
      }

      // Client-Hilfsfunktion: Dateigröße in MB / GB formatieren (tabular-nums)
      function formatFileSizeClient(bytesInput) {
        if (bytesInput === null || bytesInput === undefined || bytesInput === "") return "";
        const b = Number(bytesInput);
        if (!Number.isFinite(b) || b <= 0) {
          const s = String(bytesInput).trim();
          return /\\b(?:gb|mb|gib|mib)\\b/i.test(s) ? s : "";
        }
        const gb = b / (1024 * 1024 * 1024);
        if (gb >= 1) return gb.toFixed(2) + " GB";
        const mb = b / (1024 * 1024);
        if (mb >= 1) return (mb >= 100 ? Math.round(mb) : mb.toFixed(1)) + " MB";
        return Math.max(1, Math.round(b / 1024)) + " KB";
      }

      // Optimierung #14: Serien-Fortschritt lokal merken (Staffel & Folge pro Serie)
      function getSeriesProgressMap() {
        try {
          const raw = localStorage.getItem("tma_series_progress");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") return parsed;
          }
        } catch (e) {}
        return {};
      }

      function getSeriesProgress(seriesId) {
        if (!seriesId) return null;
        const map = getSeriesProgressMap();
        return map[String(seriesId)] || null;
      }

      function setSeriesProgress(seriesId, season, episode, epName = "") {
        if (!seriesId || !season || !episode) return;
        try {
          const map = getSeriesProgressMap();
          map[String(seriesId)] = {
            season: Number(season),
            episode: Number(episode),
            epName: String(epName || "").slice(0, 80),
            updatedAt: Date.now()
          };
          localStorage.setItem("tma_series_progress", JSON.stringify(map));
        } catch (e) {}
      }

      function cleanAndDedupeProvidersClient(rawProvidersStr) {
        if (!rawProvidersStr || rawProvidersStr === "Keine Angabe" || rawProvidersStr === "Derzeit keine Flatrate bekannt") {
          return [];
        }
        const parts = String(rawProvidersStr).split(",").map(s => s.trim()).filter(Boolean);
        const seen = new Set();
        const out = [];
        for (const p of parts) {
          let cleaned = p
            .replace(/\\s+(?:standard\\s+with\\s+ads|basic\\s+with\\s+ads|with\\s+ads|amazon\\s+channel|apple\\s+tv\\s+channel|plus\\s+channel|channel)$/i, "")
            .trim();
          const low = cleaned.toLowerCase();
          for (const pl of PLATFORM_OPTIONS_CLIENT) {
            const matchHit = Array.isArray(pl.match) && pl.match.some(m => {
              const kw = String(m || "").toLowerCase().trim();
              if (!kw) return false;
              const rx = new RegExp("(?:^|[^a-z0-9äöüß])" + kw.replace(/[.*+?^()|[\\]\\\\{}]/g, "\\\\$&") + "(?:$|[^a-z0-9äöüß])", "i");
              return rx.test(low);
            });
            if (matchHit || low === pl.label.toLowerCase()) {
              cleaned = pl.shortLabel || pl.label;
              break;
            }
          }
          const key = cleaned.toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push(cleaned);
        }
        return out;
      }

      function toggleModalCreditsBox() {
        const box = document.getElementById("modalCreditsCollapseBox");
        const btn = document.getElementById("modalCreditsToggleBtn");
        if (!box) return;
        const isHidden = box.style.display === "none";
        box.style.display = isHidden ? "grid" : "none";
        if (btn) {
          btn.innerHTML = isHidden
            ? '<span>👥 Besetzung, Regie, Studios & Jahr ausblenden</span><span>▴</span>'
            : '<span>👥 Besetzung, Regie, Studios & Jahr anzeigen</span><span>▾</span>';
        }
      }

      function toggleModalMoreActions() {
        const box = document.getElementById("modalMoreActionsBox");
        const btn = document.getElementById("modalMoreActionsBtn");
        if (!box) return;
        const isHidden = box.style.display === "none";
        box.style.display = isHidden ? "flex" : "none";
        if (btn) {
          btn.textContent = isHidden ? "⋯ Weniger ▴" : "⋯ Mehr ▾";
        }
      }

      async function openDetails(type, id, autoOpenTrailer = false, preTitle = "", prePoster = "", forceSeasonNum = null) {
        if (typeof lastCardLongPressAt !== "undefined" && Date.now() - lastCardLongPressAt < 650) {
          return;
        }
        saveModalReturnFocusTarget(type, id);
        // Sofort beim Anklicken "Zuletzt angesehen" aktualisieren (ohne auf API zu warten!)
        if (id && (preTitle || prePoster)) {
          addRecentViewedItem({ id, title: preTitle, poster_path: prePoster }, type);
        } else if (id && Array.isArray(state.items)) {
          const foundInGrid = state.items.find(x => String(x.id) === String(id));
          if (foundInGrid) addRecentViewedItem(foundInGrid, type);
        }
        const vipAllowed = isCurrentUserVip();
        const cacheKey = type + "_" + id + "_" + (vipAllowed ? "vip" : "std");
        const cachedEntry = clientDetailsCache.get(cacheKey);
        const hasValidCache = Boolean(cachedEntry && (Date.now() - cachedEntry.ts < CLIENT_CACHE_TTL_MS));
        if (!hasValidCache) {
          setBusyState(true, "⏳ Lade Details...");
        }
        try {
          const d = hasValidCache
            ? cachedEntry.data
            : await apiFetchJson(API_BASE + "/details?chatId=" + encodeURIComponent(chatId) + "&type=" + type + "&id=" + id);
          if (!d || d.ok === false) {
            throw new Error(d?.error || "Titeldetails konnten nicht geladen werden.");
          }
          if (!hasValidCache) {
            clientDetailsCache.set(cacheKey, { data: d, ts: Date.now() });
          }
          state.activeDetails = { ...d, typeCode: type, id: d.id || id };
          if (d.botUsername) state.botUsername = d.botUsername;
          if (d.isSaved) savedKeysSet.add(type + "_" + (d.id || id));
          addRecentViewedItem(d, type);
          const m = document.getElementById("modalRoot");
          const tr = d.trailers || null;
          const posterOrig = resolvePosterUrlClient(d.poster_path, 'original', d.external_poster_url || '');
          const posterThumb = resolvePosterUrlClient(d.poster_path, 'w342', d.external_poster_url || '');
          if (posterThumb) {
            syncCardPosterInDom(type, d.id || id, posterThumb);
          }
          const backdropOrig = resolvePosterUrlClient(d.backdrop_path, 'original', '');
          const backdropBanner = resolvePosterUrlClient(d.backdrop_path, 'w780', posterOrig);
          const ytSearchQuery = encodeURIComponent((d.title || '') + ' ' + (d.year && d.year !== 'K.A.' ? d.year : '') + ' Trailer Deutsch');
          const ytSearchUrl = 'https://www.youtube.com/results?search_query=' + ytSearchQuery;

          // Klickbare Genres & bereinigte, deduplizierte Streaming-Anbieter
          const clickableGenresHtml = (d.genres && d.genres !== "Keine Angabe" ? d.genres.split(",").map(g => g.trim()).filter(Boolean) : []).map(gName =>
            '<span class="f-pill inc" tabindex="0" onclick="filterByCategoryFromModal(\\'genre\\',\\'' + esc(gName) + '\\')" title="Nach Genre filtern: ' + esc(gName) + '">' + genreEmoji(gName) + ' ' + esc(gName) + '</span>'
          ).join(" ");

          const directorsArr = Array.isArray(d.directorsList) && d.directorsList.length > 0
            ? d.directorsList
            : (d.directors && d.directors !== "Keine Angabe" ? d.directors.split(",").map(n => ({ name: n.trim(), id: null })).filter(x => x.name) : []);
          const clickableDirectorsHtml = directorsArr.map(p =>
            '<span class="f-pill neutral" tabindex="0" onclick="' + (p.id ? ('openPersonView(' + Number(p.id) + ',\\'' + esc(p.name) + '\\')') : ('runSearch(false,\\'' + esc(p.name) + '\\',\\'person\\')')) + '" title="Alle Titel von ' + esc(p.name) + '">' + esc(p.name) + '</span>'
          ).join(" ");

          const castArr = Array.isArray(d.castList) && d.castList.length > 0
            ? d.castList
            : (d.casts && d.casts !== "Keine Angabe" ? d.casts.split(",").map(n => ({ name: n.trim(), id: null })).filter(x => x.name) : []);
          const clickableCastHtml = castArr.map(p =>
            '<span class="f-pill neutral" tabindex="0" onclick="' + (p.id ? ('openPersonView(' + Number(p.id) + ',\\'' + esc(p.name) + '\\')') : ('runSearch(false,\\'' + esc(p.name) + '\\',\\'person\\')')) + '" title="Alle Titel mit ' + esc(p.name) + '">' + esc(p.name) + '</span>'
          ).join(" ");

          const studiosArr = Array.isArray(d.studiosList) && d.studiosList.length > 0
            ? d.studiosList
            : (d.studios && d.studios !== "Keine Angabe" ? d.studios.split(",").map(s => ({ name: s.trim(), id: null })).filter(x => x.name) : []);
          const clickableStudiosHtml = studiosArr.map(sObj =>
            '<span class="f-pill neutral" tabindex="0" onclick="filterOrSearchStudioFromModal(\\'' + esc(sObj.name) + '\\',\\'' + esc(sObj.id || '') + '\\')" title="Alle Titel von Studio ' + esc(sObj.name) + '">' + esc(sObj.name) + '</span>'
          ).join(" ");

          const hasValidYear = Boolean(d.year && d.year !== 'K.A.');
          const clickableYearInDetailsHtml = hasValidYear
            ? ('<span class="f-pill neutral" tabindex="0" onclick="searchByYearFromModal(\\'' + esc(d.year) + '\\')" title="Alle Filme & Serien aus dem Jahr ' + esc(d.year) + ' suchen">📅 ' + esc(d.year) + '</span>')
            : '';

          const dedupedProvidersList = cleanAndDedupeProvidersClient(d.providers);
          const clickableProvidersHtml = dedupedProvidersList.map(pName =>
            '<span class="f-pill inc" tabindex="0" onclick="filterOrSearchProviderFromModal(\\'' + esc(pName) + '\\')" title="Nach Streaming-Anbieter filtern: ' + esc(pName) + '">📺 ' + esc(pName) + '</span>'
          ).join(" ");

          const fskClean = String(d.fsk || "").trim();
          const fskFilterTarget = FSK_OPTIONS_CLIENT.find(fo => fskClean.includes(fo)) || "";
          const hasValidFsk = Boolean(fskFilterTarget && !/keine angabe|unbekannt/i.test(fskClean));
          const prevAdj = getAdjacentDetailItem(-1);
          const nextAdj = getAdjacentDetailItem(1);
          const hasCreditsOrStudios = Boolean(clickableDirectorsHtml || clickableCastHtml || clickableStudiosHtml || clickableYearInDetailsHtml);

          // Prüfen, ob mehrteilige Film-Teile (z.B. CD1 & CD2 / Part 1 & Part 2) vorliegen
          const multiPartFiles = (vipAllowed && Array.isArray(d.files))
            ? d.files.filter(f => f && f.telegram_file_id && f.part)
            : [];
          const hasMultipleParts = multiPartFiles.length >= 2;
          const canReportMedia = Boolean(vipAllowed || state.authUser?.isAdmin);
          const isAdminUser = Boolean(state.authUser?.isAdmin);

          // Kompaktes Versions-Badge für den Flixnet Hero-Header (z.B. "Netflix-Fassung" / "Originalfassung")
          const allVersionsArr = Array.isArray(d.availableVersions) ? d.availableVersions.filter(Boolean) : [];
          const primaryVersionBadgeText = String(d.primaryVersionLabel || allVersionsArr[0] || "").trim();
          const allStreamFilesArr = Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 0
            ? d.allStreamFiles
            : (Array.isArray(d.files) ? d.files : []);
          const distinctVersionCount = Math.max(allVersionsArr.length, allStreamFilesArr.length > 0 ? 1 : 0);

          const initialTab = autoOpenTrailer ? "details" : "streams";
          state.activeDetailTab = initialTab;

          m.innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this)closeDetailModal()">' +
            '<div class="modal">' +
              /* 1. FLIXNET-INSPIRIERTER HERO-HEADER: Großes TMDb-Backdrop mit Fade-Out, links Cover-Poster, rechts Titel, Jahr, Rating, Laufzeit, Genres & Versions-Badge */
              '<div class="modal-hero-banner" ontouchstart="onModalHeroTouchStart(event)" ontouchend="onModalHeroTouchEnd(event)" style="' + (backdropBanner ? ('background-image:url(' + esc(backdropBanner) + ')') : '') + '">' +
                '<div class="modal-hero-top">' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                    '<span class="hero-badge ' + (type === 's' ? 'series' : 'movie') + '">' + (type === 's' ? '📺 SERIE' : '🎬 FILM') + '</span>' +
                    (primaryVersionBadgeText ? '<span class="flix-version-badge" title="Aktive Schnittfassung / Version">🎞️ ' + esc(primaryVersionBadgeText) + (allVersionsArr.length > 1 ? (' +' + (allVersionsArr.length - 1)) : '') + '</span>' : '') +
                  '</div>' +
                  '<div style="display:flex;gap:6px;align-items:center">' +
                    (prevAdj ? '<button id="modalAdjPrevBtn" class="btn" onclick="navigateDetailModalAdjacent(-1)" title="Vorheriger Titel: ' + esc(prevAdj.title) + '">◀</button>' : '') +
                    (nextAdj ? '<button id="modalAdjNextBtn" class="btn" onclick="navigateDetailModalAdjacent(1)" title="Nächster Titel: ' + esc(nextAdj.title) + '">▶</button>' : '') +
                    '<button class="btn red" onclick="closeDetailModal()" title="Schließen">✖</button>' +
                  '</div>' +
                '</div>' +

                '<div class="flix-hero-grid">' +
                  (posterThumb
                    ? '<img class="flix-poster-card" src="' + esc(posterThumb) + '" onclick="openLightbox(\\''+esc(posterOrig)+'\\',\\''+esc(d.title)+'\\')" title="Antippen für großes Original-Poster" alt="' + esc(d.title) + '" />'
                    : '<div class="flix-poster-card" style="display:flex;align-items:center;justify-content:center;font-size:32px">' + (type === 's' ? '📺' : '🎬') + '</div>') +
                  '<div class="flix-meta-col">' +
                    '<div class="flix-title-row">' +
                      '<h2 style="font-size:22px;font-weight:900;color:#ffffff;margin:0;line-height:1.2;text-shadow:0 2px 14px rgba(0,0,0,0.95)">' +
                        '<span style="cursor:pointer;color:#ffffff" onclick="runSearch(false,\\'' + esc(d.title) + '\\')" title="Antippen, um nach diesem Titel zu suchen">' + esc(d.title) + '</span>' +
                        (hasValidYear ? ' <span style="color:#cbd5e1;font-weight:700;font-size:17px">(' + esc(d.year) + ')</span>' : '') +
                      '</h2>' +
                    '</div>' +

                    '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                      (d.vote && d.vote !== '0.0' ? '<span class="f-pill neutral">⭐ ' + esc(d.vote) + '</span>' : '') +
                      (hasValidFsk ? '<span class="f-pill neutral" tabindex="0" onclick="filterByCategoryFromModal(\\'fsk\\',\\'' + esc(fskFilterTarget) + '\\')" title="Nach ' + esc(fskFilterTarget) + ' filtern">🔞 ' + esc(fskFilterTarget) + '</span>' : '') +
                      (d.runtime && d.runtime !== 'Keine Angabe' ? '<span class="f-pill neutral">⏳ ' + esc(d.runtime) + '</span>' : '') +
                      (d.country && d.country !== 'k.A.' && d.country !== 'Keine Angabe' ? '<span class="f-pill neutral" tabindex="0" onclick="closeDetailModal();runSearch(false,\\'' + esc(d.country) + '\\')">🌍 ' + esc(d.country) + '</span>' : '') +
                      (type === 's' && d.numberOfSeasons ? '<span class="f-pill neutral">📚 ' + Number(d.numberOfSeasons) + ' St. / ' + Number(d.numberOfEpisodes || 0) + ' Flg.</span>' : '') +
                      (type === 's' && d.statusText && d.statusText !== 'Unbekannt' ? '<span class="f-pill neutral">' + esc(d.statusText) + '</span>' : '') +
                    '</div>' +

                    (clickableGenresHtml ? '<div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableGenresHtml + '</div>' : '') +

                    '<p style="font-size:12.5px;line-height:1.5;color:#e2e8f0;margin:2px 0 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden" title="Vollständige Beschreibung im Reiter Details">' +
                      esc(d.overview || 'Keine deutsche Beschreibung hinterlegt.') +
                    '</p>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              /* 2. TABS UNTER DEM HEADER: [ Staffeln & Episoden / Streams ] | [ Versionen ] | [ Details ] */
              '<div class="flix-tabs-bar">' +
                '<button type="button" id="flixTabBtn_streams" class="flix-tab-btn ' + (initialTab === 'streams' ? 'active' : '') + '" onclick="switchDetailModalTab(\\'streams\\')">' +
                  (type === 's' ? '📺 Staffeln & Episoden' : '🎬 Streams & Dateien') +
                '</button>' +
                '<button type="button" id="flixTabBtn_versions" class="flix-tab-btn ' + (initialTab === 'versions' ? 'active' : '') + '" onclick="switchDetailModalTab(\\'versions\\')">' +
                  '🎞️ Versionen' + (distinctVersionCount > 0 ? (' (' + distinctVersionCount + ')') : '') +
                '</button>' +
                '<button type="button" id="flixTabBtn_details" class="flix-tab-btn ' + (initialTab === 'details' ? 'active' : '') + '" onclick="switchDetailModalTab(\\'details\\')">' +
                  'ℹ️ Details' + (tr ? ' & Trailer' : '') +
                '</button>' +
              '</div>' +

              '<div class="modal-body">' +
                /* Schnell-Aktionsleiste direkt sichtbar (Merkliste, Ähnliche Titel, Fehler melden für VIP/Admin, Admin-Tools, Mehr) */
                '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
                  ((d.providerButtons && d.providerButtons.length > 0) ? (
                    d.providerButtons.map(pb =>
                      '<a class="btn" href="' + esc(pb.url) + '" target="_blank" rel="noopener noreferrer" style="background:' + esc(pb.bg || 'rgba(229,9,20,0.22)') + ';border-color:' + esc(pb.border || '#e50914') + ';font-weight:800;color:#fff">' + esc(pb.buttonText) + '</a>'
                    ).join("")
                  ) : '') +
                  '<button id="modalWishlistBtn" class="btn ' + (d.isSaved ? 'green' : '') + '" onclick="toggleWishlistItem(\\''+type+'\\','+d.id+')">' + (d.isSaved ? '✅ Gespeichert' : '💾 Merkliste') + '</button>' +
                  '<button class="btn amber" onclick="loadSimilarInTma(\\''+type+'\\','+d.id+')">✨ Ähnliche Titel</button>' +
                  (canReportMedia ? '<button type="button" class="btn" style="border-color:rgba(245,158,11,0.5);color:#fbbf24" onclick="openMediaReportModal({typeCode:\\''+type+'\\',tmdbId:'+Number(d.id)+',title:\\''+esc(d.title)+'\\',versionLabel:\\''+esc(primaryVersionBadgeText || 'Originalfassung')+'\\'})" title="Falschen Titel, falsche Staffel/Folge oder defektes Video melden">⚠️ Fehler melden</button>' : '') +
                  (isAdminUser ? '<button type="button" class="btn purple" onclick="toggleModalPosterPicker(\\''+type+'\\','+d.id+')" title="Original-Cover von TMDb (EN/DE), Apple iTunes DE, OMDb oder eigene Bild-URL wählen">🖼️ Cover ändern</button>' : '') +
                  (isAdminUser ? '<button type="button" class="btn blue" onclick="toggleModalRemapBox(\\''+type+'\\','+d.id+')" title="Falsch zugeordneten Film/Serie inkl. Original-Dateiname & Telegram-Link neu zuordnen">🔄 Neu zuordnen</button>' : '') +
                  '<button type="button" id="modalMoreActionsBtn" class="btn" onclick="toggleModalMoreActions()">⋯ Mehr ▾</button>' +
                '</div>' +

                '<div id="modalPosterPickerBox" style="display:none;margin:10px 0;padding:12px;border-radius:10px;background:rgba(15,23,42,0.92);border:1px solid rgba(168,85,247,0.45)"></div>' +
                '<div id="modalRemapMediaBox" style="display:none;margin:10px 0;padding:12px;border-radius:10px;background:rgba(15,23,42,0.92);border:1px solid rgba(56,189,248,0.45)"></div>' +

                '<div id="modalMoreActionsBox" style="display:none;gap:6px;flex-wrap:wrap;padding:8px 10px;margin-bottom:10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(148,163,184,0.2)">' +
                  '<button class="btn purple" onclick="shareItemFromTma(\\''+type+'\\','+d.id+')">📤 Über Telegram teilen</button>' +
                  '<button class="btn" onclick="sendSharePostToBotChat(\\''+type+'\\','+d.id+')">💬 Teilen-Post im Bot</button>' +
                  '<button class="btn blue" onclick="openInBot(\\'' + type + '_' + d.id + '\\')">🤖 Im Bot öffnen</button>' +
                  (d.telegraphUrl ? '<a class="btn" href="' + esc(d.telegraphUrl) + '" target="_blank">📖 Telegraph-Guide</a>' : '') +
                  (posterOrig ? '<button class="btn" onclick="openLightbox(\\''+esc(posterOrig)+'\\',\\''+esc(d.title)+' – Original-Poster\\')">🖼️ Original-Poster</button>' : '') +
                  (backdropOrig ? '<button class="btn" onclick="openLightbox(\\''+esc(backdropOrig)+'\\',\\''+esc(d.title)+' – Szenenbild\\')">🏞️ Szenenbild</button>' : '') +
                  (d.tmdbDeUrl ? '<a class="btn" href="' + esc(d.tmdbDeUrl) + '" target="_blank" rel="noopener noreferrer">🌐 Auf TMDb ansehen</a>' : '') +
                  (!tr ? '<a class="btn red" href="' + esc(ytSearchUrl) + '" target="_blank" rel="noopener noreferrer">🔎 Trailer auf YouTube suchen</a>' : '') +
                '</div>' +

                '<div id="similarModalBox"></div>' +

                /* TAB 1: STAFFELN & EPISODEN (bzw. STREAMS & DATEIEN bei Filmen) */
                '<div id="flixTabPanel_streams" style="display:' + (initialTab === 'streams' ? 'block' : 'none') + '">' +
                  ((vipAllowed && ((d.files && d.files.length > 0) || type === 's')) ? (
                    '<div class="modal-sub-box" style="margin:6px 0 10px;padding:10px;background:var(--card);border-radius:10px;border:1px solid rgba(229,9,20,0.4)">' +
                      buildModalDeliveryTargetSelectorHtml() +
                      ((d.files && d.files.length > 0) ? (
                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0">' +
                          '<div style="font-size:12.5px;font-weight:800;color:var(--text)">🌟 VIP-Streams & Versionen (' + esc(d.title) + ' • ' + d.files.length + '):</div>' +
                          (hasMultipleParts ? (
                            '<button class="btn amber" onclick="sendAllMoviePartsToTelegram()" title="Alle Teile (z.B. CD1 & CD2) nacheinander an das gewählte Ziel senden">' +
                              '📦 Alle ' + multiPartFiles.length + ' Teile nacheinander senden' +
                            '</button>'
                          ) : '') +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;gap:6px">' +
                          d.files.map((f, fIdx) => {
                            const sizeLabel = formatFileSizeClient(f.file_size);
                            const isRarFile = String(f.codec || "").toUpperCase() === "RAR" || /^RAR/i.test(String(f.part || "")) || /\.rar$/i.test(String(f.raw_filename || ""));
                            const tagsLabel = isRarFile ? "📦 RAR-Archiv" : String(f.tags || f.versionLabel || f.version_label || "").trim();
                            const isPrereleaseTag = tagsLabel.includes("Vorabversion") || /\b(?:HDTS|TeleSync|HDCAM|MicDub|LineDub|Screener|DVDScr)\b/i.test(tagsLabel);
                            const partLabel = String(f.part || "").trim();
                            const isExportRef = String(f.telegram_file_id || "").startsWith("tg_export_");
                            const subsList = Array.isArray(f.subtitles) ? f.subtitles : [];
                            return '<div class="ep-row" style="margin-bottom:0;' + (isPrereleaseTag ? 'border-color:rgba(245,158,11,0.45);background:rgba(245,158,11,0.06);' : '') + '">' +
                              '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                                '<span class="btn ' + (isRarFile || isPrereleaseTag ? 'amber' : 'red') + '" style="padding:2px 7px;font-size:11px;pointer-events:none">' + esc(isRarFile ? '📦 RAR' : (f.quality || '1080p')) + '</span>' +
                                '<span class="stream-meta-pill">' + esc(f.codec || 'x264') + (partLabel ? ' • ' + esc(partLabel) : '') + '</span>' +
                                (sizeLabel ? '<span class="stream-meta-pill size" title="Dateigröße">📦 ' + esc(sizeLabel) + '</span>' : '') +
                                (tagsLabel ? '<span class="stream-meta-pill tags" title="Schnittfassung / Kategorie">🏷️ ' + esc(tagsLabel) + '</span>' : '') +
                                (subsList.length > 0 ? '<span class="stream-meta-pill" style="border-color:rgba(16,185,129,0.5);color:#34d399" title="Wird beim Video-Versand automatisch mitgesendet">💬 ' + subsList.length + ' UT</span>' : '') +
                                (isExportRef ? '<span class="stream-meta-pill" style="border-color:rgba(56,189,248,0.45);color:#38bdf8" title="Wird automatisch per copyMessage aus der Quellgruppe aufgelöst & File-ID gespeichert">🔗 Quellgruppe (Auto-Copy)</span>' : '') +
                              '</div>' +
                              '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                                '<button class="btn ' + (isRarFile ? 'amber' : 'red') + '" onclick="requestTelegramStream(\\'' + esc(f.telegram_file_id) + '\\',\\'' + esc(d.title + (partLabel ? ' (' + partLabel + ')' : '')) + '\\',\\'' + esc(f.quality || '1080p') + '\\',{fileSize:\\'' + esc(sizeLabel) + '\\',tags:\\'' + esc(tagsLabel) + '\\'})">' + (isRarFile ? '📦 RAR an Bot senden' : ('📥 ' + esc(getActiveDeliveryButtonLabelClient()) + (subsList.length > 0 ? ' + UT' : ''))) + '</button>' +
                                (subsList.length > 0 ? '<button type="button" class="btn blue" style="padding:5px 8px;font-size:11px" onclick="requestTelegramSubtitleOnly(\\'' + esc(f.telegram_file_id) + '\\',\\'' + esc(d.title) + '\\',{seriesId:null})" title="Nur die verknüpfte(n) Untertitel-Datei(en) einzeln senden">💬 Untertitel (' + subsList.length + ')</button>' : '') +
                                (isAdminUser ? '<button type="button" class="btn ep-icon-btn" onclick="openEpisodeCorrectionModal({typeCode:\\'m\\',tmdbId:'+Number(d.id)+',title:\\''+esc(d.title)+'\\',telegramFileId:\\''+esc(f.telegram_file_id)+'\\',versionLabel:\\''+esc(tagsLabel || 'Originalfassung')+'\\',quality:\\''+esc(f.quality || '1080p')+'\\',rawFilename:\\''+esc(f.raw_filename || '')+'\\',messageLink:\\''+esc(f.message_link || '')+'\\'})" title="Datei-Version ändern oder mit anderem TMDb-Titel/Folge verknüpfen">✏️</button>' : '') +
                                (canReportMedia ? '<button type="button" class="btn ep-icon-btn" onclick="openMediaReportModal({typeCode:\\'m\\',tmdbId:'+Number(d.id)+',title:\\''+esc(d.title)+'\\',telegramFileId:\\''+esc(f.telegram_file_id)+'\\',versionLabel:\\''+esc(tagsLabel || 'Originalfassung')+'\\'})" title="Fehler zu dieser Datei melden">⚠️</button>' : '') +
                              '</div>' +
                            '</div>';
                          }).join("") +
                        '</div>'
                      ) : '') +
                    '</div>'
                  ) : (!vipAllowed && type === 'm' ? (
                    '<div class="panel-box" style="margin:6px 0;text-align:center;color:#94a3b8;font-size:12.5px">' +
                      '🔒 Direkt-Streams & Downloads sind exklusiv für freigeschaltete <b>VIP-Mitglieder</b> sichtbar. Nutze die Tabs oben für <b>Versionen</b> & <b>Details / Trailer</b>.' +
                    '</div>'
                  ) : '')) +
                  (type === 's' ? '<div id="seasonBox" style="margin-top:8px">Lade Episoden...</div>' : '') +
                '</div>' +

                /* TAB 2: VERSIONEN (Übersicht aller Schnittfassungen, Episode-Groups & Dateien) */
                '<div id="flixTabPanel_versions" style="display:' + (initialTab === 'versions' ? 'block' : 'none') + '">' +
                  buildDetailModalVersionsTabHtml(d, type, vipAllowed, isAdminUser, canReportMedia) +
                '</div>' +

                /* TAB 3: DETAILS & TRAILER (Vollständige Beschreibung, Besetzung, Regie, Studios, Reihen, Trailer) */
                '<div id="flixTabPanel_details" style="display:' + (initialTab === 'details' ? 'block' : 'none') + '">' +
                  ((d.collection || d.universe) ? (
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px">' +
                      (d.collection ? (
                        '<button class="btn purple" onclick="openCollectionView(' + d.collection.id + ')">🍿 Reihe: ' + esc(d.collection.name) + '</button>'
                      ) : '') +
                      (d.universe ? (
                        '<button class="btn green" onclick="openUniverseView(\\''+esc(d.universe.id)+'\\')">' + esc(d.universe.icon || '🌌') + ' ' + esc(d.universe.name) + '</button>'
                      ) : '') +
                    '</div>'
                  ) : '') +

                  '<div class="panel-box" style="margin:6px 0 10px">' +
                    '<div class="detail-meta-label" style="margin-bottom:6px">📖 Handlung & Beschreibung</div>' +
                    '<p style="font-size:13px;line-height:1.6;color:var(--text);margin:0">' + esc(d.overview || 'Keine deutsche Beschreibung hinterlegt.') + '</p>' +
                  '</div>' +

                  ((clickableGenresHtml || clickableProvidersHtml) ? (
                    '<div class="detail-meta-grid" style="margin:8px 0">' +
                      (clickableGenresHtml ? '<div class="detail-meta-row"><span class="detail-meta-label">🎞️ Genres</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableGenresHtml + '</div></div>' : '') +
                      (clickableProvidersHtml ? '<div class="detail-meta-row"><span class="detail-meta-label">📺 Verfügbar bei</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableProvidersHtml + '</div></div>' : '') +
                    '</div>'
                  ) : '') +

                  (hasCreditsOrStudios ? (
                    '<div id="modalCreditsCollapseBox" class="detail-meta-grid" style="display:grid;margin-top:6px;margin-bottom:10px">' +
                      (clickableYearInDetailsHtml ? '<div class="detail-meta-row"><span class="detail-meta-label">📅 Erscheinungsjahr</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableYearInDetailsHtml + '</div></div>' : '') +
                      (clickableDirectorsHtml ? '<div class="detail-meta-row"><span class="detail-meta-label">🎬 Regie</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableDirectorsHtml + '</div></div>' : '') +
                      (clickableStudiosHtml ? '<div class="detail-meta-row"><span class="detail-meta-label">🏢 Studios</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableStudiosHtml + '</div></div>' : '') +
                      (clickableCastHtml ? '<div class="detail-meta-row" style="grid-column:1 / -1"><span class="detail-meta-label">🌟 Besetzung</span><div style="display:flex;gap:5px;flex-wrap:wrap">' + clickableCastHtml + '</div></div>' : '') +
                    '</div>'
                  ) : '') +

                  (tr ? '<div class="modal-sub-box" style="margin:10px 0;padding:10px;background:var(--card);border-radius:10px;border:1px solid rgba(229,9,20,0.32)">' +
                    '<div style="font-size:12px;color:var(--text);margin-bottom:7px">🎬 <b>Trailer direkt abspielen & Standard-Quelle wählen:</b></div>' +
                    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                      TRAILER_PROVIDERS_CLIENT.map(tp =>
                        '<button class="btn ' + (trailerProvider === tp.id ? 'red' : '') + '" data-detail-tp-id="' + esc(tp.id) + '" onclick="switchEmbedSource(\\'' + esc(tp.id) + '\\',true)">' + esc(tp.label) + (trailerProvider === tp.id ? ' ✓ Standard' : '') + '</button>'
                      ).join("") +
                    '</div>' +
                    '<div id="trailerEmbedContainer"></div>' +
                  '</div>' : '') +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
          if (tr && autoOpenTrailer) switchEmbedSource(trailerProvider || "youtube", false);
          if (type === 's') {
            const savedProg = getSeriesProgress(d.id);
            const initialSeason = (forceSeasonNum && Number(forceSeasonNum) > 0)
              ? Number(forceSeasonNum)
              : (savedProg && savedProg.season > 0)
                ? savedProg.season
                : (Number(d.firstVipSeason || 0) > 0 ? Number(d.firstVipSeason) : 1);
            loadSeason(d.id, initialSeason, false);
          }
          const firstModalBtn = m.querySelector("#modalWishlistBtn, .modal-body .btn");
          if (firstModalBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstModalBtn, false);
          }
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
          showHudToast("⚠️ Details konnten nicht geladen werden – bitte erneut antippen.");
        } finally {
          setBusyState(false);
        }
      }

      function switchDetailModalTab(tabName) {
        state.activeDetailTab = tabName;
        const tabs = ["streams", "versions", "details"];
        for (const t of tabs) {
          const btn = document.getElementById("flixTabBtn_" + t);
          const panel = document.getElementById("flixTabPanel_" + t);
          if (btn) btn.classList.toggle("active", t === tabName);
          if (panel) panel.style.display = t === tabName ? "block" : "none";
        }
        if (tabName === "details" && state.activeDetails?.trailers) {
          const container = document.getElementById("trailerEmbedContainer");
          if (container && !container.innerHTML.trim()) {
            switchEmbedSource(trailerProvider || "youtube", false);
          }
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

        // Gruppiere alle Dateien nach Schnittfassung / Version (z.B. "Netflix-Fassung", "Originalfassung", "📦 RAR-Archiv")
        const groupsMap = new Map();
        for (const f of allFiles) {
          if (!f) continue;
          const isRar = String(f.codec || "").toUpperCase() === "RAR" || /^RAR/i.test(String(f.part || "")) || /\.rar$/i.test(String(f.raw_filename || ""));
          const vLbl = isRar ? "📦 RAR-Archiv" : (String(f.versionLabel || f.version_label || f.tags || "Originalfassung").trim() || "Originalfassung");
          if (!groupsMap.has(vLbl)) groupsMap.set(vLbl, []);
          groupsMap.get(vLbl).push(f);
        }

        return '<div class="panel-box" style="margin:6px 0">' +
          '<div class="section-title" style="margin-bottom:8px">' +
            '<span>🎞️ Verfügbare Schnittfassungen & Versionen (' + groupsMap.size + ' Fassung' + (groupsMap.size === 1 ? '' : 'en') + ' • ' + allFiles.length + ' Datei' + (allFiles.length === 1 ? '' : 'en') + ')</span>' +
          '</div>' +
          '<div style="font-size:11.5px;color:#94a3b8;margin-bottom:10px">' +
            'Hier siehst du alle hinterlegten Schnittfassungen & Kategorien (z.B. <b>Netflix-Fassung</b>, <b>Originalfassung</b> oder <b>📦 RAR-Archiv</b>). ' +
            (isAdminUser ? 'Über den <b>✏️ Stift-Button</b> kannst du jede Folge/Datei einzeln einer anderen Staffel, Folge, Version oder TMDb-ID zuweisen.' : '') +
          '</div>' +
          Array.from(groupsMap.entries()).map(([vLabel, filesList]) => {
            return '<div style="margin-bottom:12px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1)">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
                '<span class="flix-version-badge">🎞️ ' + esc(vLabel) + '</span>' +
                '<span style="font-size:11.5px;color:#94a3b8;font-weight:700">' + filesList.length + (type === 's' ? (' Folge' + (filesList.length === 1 ? '' : 'n')) : (' Datei' + (filesList.length === 1 ? '' : 'en'))) + '</span>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:5px;max-height:280px;overflow-y:auto;padding-right:2px">' +
                filesList.map(f => {
                  const sNum = Number(f.season_number || 1);
                  const eNum = Number(f.episode_number || 1);
                  const epCode = type === 's' ? ('S' + String(sNum).padStart(2, '0') + 'E' + String(eNum).padStart(2, '0')) : '';
                  const sizeStr = formatFileSizeClient(f.file_size);
                  const isRar = String(f.codec || "").toUpperCase() === "RAR" || /^RAR/i.test(String(f.part || "")) || /\.rar$/i.test(String(f.raw_filename || ""));
                  const partStr = String(f.part || "").trim();
                  const subsList = Array.isArray(f.subtitles) ? f.subtitles : [];
                  const qualStr = [f.quality || '1080p', f.codec || '', partStr ? ('• ' + partStr) : '', sizeStr ? ('• ' + sizeStr) : ''].filter(Boolean).join(' ');
                  return '<div class="ep-row" style="margin-bottom:0;padding:6px 8px">' +
                    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;min-width:150px">' +
                      (epCode ? '<b style="color:#38bdf8;font-size:12px">' + esc(epCode) + '</b>' : '<b style="color:#38bdf8;font-size:12px">' + (isRar ? '📦 RAR' : '🎬 Film') + '</b>') +
                      '<span class="stream-meta-pill">' + esc(qualStr) + '</span>' +
                      (subsList.length > 0 ? '<span class="stream-meta-pill" style="border-color:rgba(16,185,129,0.5);color:#34d399">💬 ' + subsList.length + ' UT</span>' : '') +
                      (isAdminUser && f.raw_filename ? '<span style="font-size:10.5px;color:#94a3b8;font-family:monospace;word-break:break-all">📄 ' + esc(f.raw_filename) + '</span>' : '') +
                    '</div>' +
                    '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                      '<button class="btn ' + (isRar ? 'amber' : 'red') + '" style="padding:3px 8px;font-size:11px" onclick="requestTelegramStream(\\'' + esc(f.telegram_file_id) + '\\',\\'' + esc(d.title + (epCode ? (' ' + epCode) : '') + (partStr ? (' (' + partStr + ')') : '')) + '\\',\\'' + esc(f.quality || '1080p') + '\\',{seriesId:' + Number(d.id) + ',season:' + sNum + ',episode:' + eNum + ',fileSize:\\'' + esc(sizeStr) + '\\',tags:\\'' + esc(vLabel) + '\\'})">' + (isRar ? '📦 RAR senden' : ('▶️ Stream' + (subsList.length > 0 ? ' + UT' : ''))) + '</button>' +
                      (subsList.length > 0 ? '<button type="button" class="btn blue" style="padding:3px 8px;font-size:11px" onclick="requestTelegramSubtitleOnly(\\'' + esc(f.telegram_file_id) + '\\',\\'' + esc(d.title + (epCode ? (' ' + epCode) : '')) + '\\',{seriesId:' + (type === 's' ? Number(d.id) : 'null') + ',season:' + sNum + ',episode:' + eNum + '})" title="Nur Untertitel einzeln senden">💬 UT (' + subsList.length + ')</button>' : '') +
                      (isAdminUser ? '<button type="button" class="btn ep-icon-btn" onclick="openEpisodeCorrectionModal({typeCode:\\'' + type + '\\',tmdbId:' + Number(d.id) + ',title:\\'' + esc(d.title) + '\\',season:' + sNum + ',episode:' + eNum + ',telegramFileId:\\'' + esc(f.telegram_file_id) + '\\',versionLabel:\\'' + esc(vLabel) + '\\',quality:\\'' + esc(f.quality || '1080p') + '\\',rawFilename:\\'' + esc(f.raw_filename || '') + '\\',messageLink:\\'' + esc(f.message_link || '') + '\\'})" title="Folge/Datei korrigieren">✏️</button>' : '') +
                      (canReportMedia ? '<button type="button" class="btn ep-icon-btn" onclick="openMediaReportModal({typeCode:\\'' + type + '\\',tmdbId:' + Number(d.id) + ',title:\\'' + esc(d.title) + '\\',season:' + sNum + ',episode:' + eNum + ',telegramFileId:\\'' + esc(f.telegram_file_id) + '\\',versionLabel:\\'' + esc(vLabel) + '\\'})" title="Fehler melden">⚠️</button>' : '') +
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
        box.style.display = "block";
        box.innerHTML = '<div style="font-size:12px;color:#cbd5e1">⏳ Lade verfügbare Cover von TMDb (Original EN / DE / Textless), Apple iTunes DE & OMDb...</div>';
        try {
          const title = state.activeDetails?.title || "";
          const year = state.activeDetails?.year || "";
          const r = await apiFetchJson(API_BASE + "/admin/posters?type=" + encodeURIComponent(typeCode) + "&id=" + encodeURIComponent(mediaId) + "&title=" + encodeURIComponent(title) + "&year=" + encodeURIComponent(year));
          const posters = Array.isArray(r?.posters) ? r.posters : [];
          box.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
              '<div style="font-size:13px;font-weight:800;color:#e9d5ff">🖼️ Cover / Poster auswählen (' + posters.length + ' gefunden)</div>' +
              '<button type="button" class="btn" style="padding:2px 8px;font-size:11px" onclick="document.getElementById(\\'modalPosterPickerBox\\').style.display=\\'none\\'">✖ Schließen</button>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
              '<input id="customPosterUrlInp" placeholder="Eigene Bild-URL (https://...jpg/png) oder TMDb /path.jpg" style="flex:1;min-width:210px;padding:6px 9px;border-radius:6px;background:#090d16;color:#fff;border:1px solid rgba(168,85,247,0.4);font-size:12px" />' +
              '<button type="button" class="btn purple" onclick="applyCustomModalPoster(\\'' + esc(typeCode) + '\\',' + Number(mediaId) + ')">💾 URL als Cover speichern</button>' +
            '</div>' +
            (posters.length > 0 ? (
              '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:10px;max-height:360px;overflow-y:auto;padding:4px">' +
                posters.map(p =>
                  '<div style="display:flex;flex-direction:column;gap:4px;background:rgba(255,255,255,0.04);padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);cursor:pointer" onclick="selectModalPosterOption(\\'' + esc(typeCode) + '\\',' + Number(mediaId) + ',\\'' + esc(p.poster_path || '') + '\\',\\'' + esc(p.external_poster_url || p.url || '') + '\\')">' +
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

      async function toggleModalRemapBox(typeCode, mediaId) {
        const box = document.getElementById("modalRemapMediaBox");
        if (!box) return;
        if (box.style.display === "block") {
          box.style.display = "none";
          return;
        }
        box.style.display = "block";
        const d = state.activeDetails || {};
        const allFiles = Array.isArray(d.allStreamFiles) && d.allStreamFiles.length > 0
          ? d.allStreamFiles
          : (Array.isArray(d.files) ? d.files : []);
        const firstFile = allFiles[0] || {};
        const origFilename = firstFile.raw_filename || d.rawFilename || d.title || "";
        const origCaption = firstFile.raw_caption || "";
        const origSeedQuery = origFilename
          ? origFilename.replace(/\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i, "").replace(/[._]+/g, " ")
          : (d.title || "");

        const filesMetaHtml = allFiles.length > 0 ? (
          '<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(148,163,184,0.2);font-size:11.5px">' +
            '<div style="font-weight:800;color:#7dd3fc;margin-bottom:4px">📂 Verknüpfte Original-Dateien & Telegram-Links (' + allFiles.length + '):</div>' +
            '<div style="display:flex;flex-direction:column;gap:5px;max-height:135px;overflow-y:auto">' +
              allFiles.map(f => {
                const fn = f.raw_filename || f.telegram_file_id || "Unbekannte Datei";
                const cap = f.raw_caption ? (' — ' + f.raw_caption) : '';
                const mLink = f.message_link || "";
                const epTag = (f.season_number || f.episode_number)
                  ? ('<span class="stream-meta-pill">S' + String(f.season_number || 1).padStart(2, '0') + 'E' + String(f.episode_number || 1).padStart(2, '0') + '</span> ')
                  : '';
                return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 6px;border-radius:6px;background:rgba(0,0,0,0.35)">' +
                  '<div style="word-break:break-all;color:#e2e8f0;flex:1">' + epTag + '<code>' + esc(fn) + '</code>' + (cap ? '<span style="color:#94a3b8">' + esc(cap) + '</span>' : '') + '</div>' +
                  '<div style="display:flex;gap:5px;align-items:center">' +
                    (mLink ? '<a class="btn blue" style="padding:2px 7px;font-size:10.5px" href="' + esc(mLink) + '" target="_blank" rel="noopener noreferrer">🔗 Original-Post</a>' : '') +
                    '<button type="button" class="btn" style="padding:2px 7px;font-size:10.5px" onclick="document.getElementById(\\'modalRemapSearchInp\\').value=\\'' + esc(fn.replace(/\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i, '')) + '\\';searchModalRemapCandidates(\\'' + esc(typeCode) + '\\',' + Number(mediaId) + ')">🔎 Als Suchtitel</button>' +
                  '</div>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>'
        ) : '';

        box.innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
            '<div style="font-size:13px;font-weight:800;color:#38bdf8">🔄 Falsch zugeordnet? Titel / Serie neu zuordnen</div>' +
            '<button type="button" class="btn" style="padding:2px 8px;font-size:11px" onclick="document.getElementById(\\'modalRemapMediaBox\\').style.display=\\'none\\'">✖ Schließen</button>' +
          '</div>' +
          filesMetaHtml +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            '<input id="modalRemapSearchInp" value="' + esc(origSeedQuery) + '" placeholder="Suchbegriff oder TMDb-ID (z.B. Zur See, Pippi Langstrumpf, tmdb:40964)..." style="flex:1;min-width:190px;padding:6px 9px;border-radius:6px;background:#090d16;color:#fff;border:1px solid rgba(56,189,248,0.4);font-size:12px" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();searchModalRemapCandidates(\\'' + esc(typeCode) + '\\',' + Number(mediaId) + ');}" />' +
            '<select id="modalRemapTypeSel" style="padding:6px 8px;border-radius:6px;background:#090d16;color:#fff;border:1px solid rgba(56,189,248,0.4);font-size:12px">' +
              '<option value="">Alle (Film & Serie)</option>' +
              '<option value="m">🎬 Nur Filme</option>' +
              '<option value="s">📺 Nur Serien / Anime</option>' +
            '</select>' +
            '<span style="font-size:11px;color:#94a3b8">Staffel/Folge (bei Serie):</span>' +
            '<input id="modalRemapSeasonInp" type="number" min="1" max="99" value="1" title="Ziel-Staffel" style="width:48px;padding:5px;border-radius:6px;background:#090d16;color:#fff;border:1px solid rgba(56,189,248,0.4);font-size:12px;text-align:center" />' +
            '<input id="modalRemapEpisodeInp" type="number" min="1" max="999" value="1" title="Ziel-Folge" style="width:54px;padding:5px;border-radius:6px;background:#090d16;color:#fff;border:1px solid rgba(56,189,248,0.4);font-size:12px;text-align:center" />' +
            '<button type="button" class="btn blue" onclick="searchModalRemapCandidates(\\'' + esc(typeCode) + '\\',' + Number(mediaId) + ')">🔎 Suchen (8 APIs)</button>' +
          '</div>' +
          '<div id="modalRemapResultsBox" style="display:flex;flex-direction:column;gap:6px"></div>';

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
          if (firstInferredEp) {
            const sInp = document.getElementById("modalRemapSeasonInp");
            const eInp = document.getElementById("modalRemapEpisodeInp");
            if (sInp && firstInferredEp.inferredSeason) sInp.value = String(firstInferredEp.inferredSeason);
            if (eInp && firstInferredEp.inferredEpisode) eInp.value = String(firstInferredEp.inferredEpisode);
          }
          resBox.innerHTML = cands.map(c => {
            const epHint = c.inferredEpisode
              ? (' • <span style="color:#fde047;font-weight:800">Erkannt: S' + String(c.inferredSeason || 1).padStart(2, '0') + 'E' + String(c.inferredEpisode).padStart(2, '0') + (c.inferredEpisodeTitle ? (' (' + esc(c.inferredEpisodeTitle) + ')') : '') + '</span>')
              : '';
            return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1)">' +
              '<div style="display:flex;gap:8px;align-items:center">' +
                (c.poster ? '<img src="' + esc(c.poster) + '" style="width:32px;height:48px;object-fit:cover;border-radius:4px" />' : '') +
                '<div style="font-size:12px">' +
                  '<b>' + esc(c.title) + '</b> (' + esc(c.year || 'k.A.') + ') ' +
                  '<span class="f-pill neutral" style="font-size:10px;padding:1px 5px">' + (c.typeCode === 's' ? '📺 Serie' : '🎬 Film') + ' • ' + esc(c.source || 'TMDb') + ' #' + c.tmdbId + '</span>' +
                  epHint +
                '</div>' +
              '</div>' +
              '<button type="button" class="btn green" style="padding:4px 9px;font-size:11px" onclick="executeModalRemapMedia(\\'' + esc(oldTypeCode) + '\\',' + Number(oldMediaId) + ',\\'' + esc(c.typeCode) + '\\',' + Number(c.tmdbId) + ',' + Number(c.inferredSeason || 0) + ',' + Number(c.inferredEpisode || 0) + ')">✓ Jetzt zuordnen</button>' +
            '</div>';
          }).join("");
        } catch (e) {
          resBox.innerHTML = '<div style="font-size:11.5px;color:#f87171">⚠️ Suche fehlgeschlagen.</div>';
        }
      }

      async function executeModalRemapMedia(oldTypeCode, oldTmdbId, newTypeCode, newTmdbId, inferredSeason = 0, inferredEpisode = 0) {
        const sVal = Number(document.getElementById("modalRemapSeasonInp")?.value || inferredSeason || 1);
        const eVal = Number(document.getElementById("modalRemapEpisodeInp")?.value || inferredEpisode || 1);
        setBusyState(true, "🔄 Ordne Dateien & Streams dem neuen Titel zu...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/remap-saved-media", {
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
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Neuzuordnung fehlgeschlagen."));
            return;
          }
          clearClientMediaCaches();
          showHudToast("✅ Erfolgreich neu zugeordnet zu: " + (r.newTitle || ("#" + newTmdbId)));
          await openDetails(newTypeCode, newTmdbId, false);
          if (state.mode === "admin") {
            loadAdminPanelView();
          } else {
            loadView(false);
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
          sourceBridgeChatId: "",
          customBotToken: "",
          customBotUsername: "",
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
        return '<div id="modalDeliveryTargetMount" style="padding:8px 10px;margin-bottom:8px;border-radius:8px;background:rgba(15,23,42,0.75);border:1px solid rgba(56,189,248,0.35)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">' +
            '<span style="font-size:11.5px;font-weight:800;color:#38bdf8">📤 Wohin soll die Datei gesendet werden?</span>' +
            '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
              '<button type="button" class="btn ' + (mode === 'dm' ? 'blue' : '') + '" style="padding:3px 8px;font-size:11px" onclick="switchModalDeliveryModeClient(\\'dm\\')">💬 Bot-Privatchat</button>' +
              '<button type="button" class="btn ' + (mode === 'group' ? 'blue' : '') + '" style="padding:3px 8px;font-size:11px" onclick="switchModalDeliveryModeClient(\\'group\\')">👥 Eigene Gruppe</button>' +
              '<button type="button" class="btn ' + (mode === 'custom_bot' ? 'purple' : '') + '" style="padding:3px 8px;font-size:11px" onclick="switchModalDeliveryModeClient(\\'custom_bot\\')">🤖 Eigener Bot</button>' +
              '<button type="button" class="btn" style="padding:3px 7px;font-size:11px" onclick="toggleModalDeliveryConfigBoxClient()" title="Gruppen-ID, Quellgruppe & eigenen Bot konfigurieren">⚙️ ' + (showConfigInputs ? '▴' : '▾') + '</button>' +
            '</div>' +
          '</div>' +
          (showConfigInputs ? (
            '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:6px">' +
              '<div>' +
                '<div style="font-size:10.5px;color:#94a3b8;margin-bottom:2px">👥 Ziel-Gruppen Chat-ID (Tipp: <code>/id</code> in Gruppe):</div>' +
                '<input id="modalDelivGroupIdInp" value="' + esc(prefs.targetGroupChatId || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="z.B. -1001987654321" style="width:100%;padding:5px 8px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px" />' +
              '</div>' +
              '<div>' +
                '<div style="font-size:10.5px;color:#94a3b8;margin-bottom:2px">🧵 Topic / Thread-ID (optional):</div>' +
                '<input id="modalDelivTopicIdInp" value="' + esc(prefs.targetTopicId || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="Optional (z.B. 42)" style="width:100%;padding:5px 8px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px" />' +
              '</div>' +
              '<div>' +
                '<div style="font-size:10.5px;color:#94a3b8;margin-bottom:2px">📦 Quellgruppen-ID (für result.json Auto-Copy):</div>' +
                '<input id="modalDelivSourceGroupInp" value="' + esc(prefs.sourceBridgeChatId || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="Auto (-100...) oder überschreiben" style="width:100%;padding:5px 8px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px" />' +
              '</div>' +
              '<div>' +
                '<div style="font-size:10.5px;color:#94a3b8;margin-bottom:2px">🤖 Eigenes Bot-Token (@BotFather, optional):</div>' +
                '<input id="modalDelivBotTokenInp" type="password" value="' + esc(prefs.customBotToken || '') + '" oninput="onModalDeliveryFieldInputClient()" placeholder="123456:ABC-DEF..." style="width:100%;padding:5px 8px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px" />' +
              '</div>' +
            '</div>'
          ) : '') +
        '</div>';
      }

      function switchModalDeliveryModeClient(nextMode) {
        const prefs = saveDeliveryPreferencesClient({ targetMode: nextMode || "dm" });
        if ((nextMode === "group" && !prefs.targetGroupChatId) || (nextMode === "custom_bot" && !prefs.customBotToken)) {
          modalDeliveryConfigExpanded = true;
        }
        const mount = document.getElementById("modalDeliveryTargetMount");
        if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
      }

      function toggleModalDeliveryConfigBoxClient() {
        modalDeliveryConfigExpanded = !modalDeliveryConfigExpanded;
        const mount = document.getElementById("modalDeliveryTargetMount");
        if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
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
          const r = await apiFetchJson(API_BASE + "/activity-log?chatId=" + encodeURIComponent(chatId));
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
          const prefs = getDeliveryPreferencesClient();
          const targetChat = prefs.targetMode === "group" && prefs.targetGroupChatId ? prefs.targetGroupChatId : chatId;
          const r = await apiFetchJson(
            API_BASE + "/anti-spam-queue?chatId=" + encodeURIComponent(targetChat || "") + "&drain=" + (autoDrain ? "1" : "0")
          );
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
                Number(r.snapshot.gauges.singleChatPacing?.cooldownMs || 0) > 0 ||
                Number(r.snapshot.gauges.globalPerSec?.used || 0) > 0
              ));
            if (hasActiveWork) {
              scheduleAntiSpamPollClient(1050);
            } else if (state.currentView === "settings" || state.currentView === "admin") {
              scheduleAntiSpamPollClient(3500);
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

      async function requestTelegramSubtitleOnly(fileId, cleanTitle, extraMeta = null) {
        return requestTelegramStream(fileId, cleanTitle, "Untertitel", { ...(extraMeta || {}), subtitleOnly: true });
      }

      async function requestTelegramStream(fileId, cleanTitle, quality, extraMeta = null) {
        if (!isCurrentUserVip()) {
          showHudToast("🔒 Streams & Qualitäten sind exklusiv für VIP-Mitglieder verfügbar.");
          return;
        }
        const prefs = getDeliveryPreferencesClient();
        if (prefs.targetMode === "group" && !prefs.targetGroupChatId) {
          modalDeliveryConfigExpanded = true;
          const mount = document.getElementById("modalDeliveryTargetMount");
          if (mount) mount.outerHTML = buildModalDeliveryTargetSelectorHtml();
          showHudToast("👥 Bitte gib oben deine Ziel-Gruppen Chat-ID ein (Tipp: /id in deiner Gruppe senden).");
          return;
        }
        const metaObj = extraMeta && typeof extraMeta === "object" ? extraMeta : {};
        const isSubtitleOnly = Boolean(metaObj.subtitleOnly);
        if (!isSubtitleOnly && metaObj.seriesId && metaObj.season && metaObj.episode) {
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
              sourceBridgeChatId: prefs.sourceBridgeChatId || "",
              customBotToken: prefs.customBotToken || "",
              typeCode: state.activeDetails?.typeCode || (metaObj.seriesId ? "s" : "m"),
              tmdbId: metaObj.seriesId || state.activeDetails?.id || null,
              season: metaObj.season || null,
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
            if (r.queued && r.job) {
              const etaSec = Math.max(1, Math.ceil((Number(r.job.waitMs) || 1150) / 1000));
              showHudToast("⏳ Anti-Spam Schutz: „" + cleanTitle + "“ auf Warteschleifen-Pos. #" + (r.job.position || 1) + " (Zustellung in ~" + etaSec + "s)");
            } else if (isSubtitleOnly) {
              showHudToast("💬 " + Number(r.subtitlesSentCount || 1) + " Untertitel-Datei(en) für „" + cleanTitle + "“ an " + destLabel + " gesendet!");
            } else {
              const copyNote = r.copiedFromSourceGroup ? " (per Auto-Copy aus Quellgruppe)" : "";
              const subNote = Number(r.subtitlesSentCount || 0) > 0 ? (" + 💬 " + r.subtitlesSentCount + " Untertitel mitgesendet") : "";
              showHudToast("✅ „" + cleanTitle + "“ (" + quality + sizeSuffix + ") an " + destLabel + " gesendet" + copyNote + subNote + "!");
            }
            if (!isSubtitleOnly && metaObj.seriesId && metaObj.season) {
              loadSeason(metaObj.seriesId, metaObj.season, false, false);
            }
          } else {
            showHudToast("⚠️ " + (r?.error || "Datei konnte nicht gesendet werden."));
          }
        } finally {
          setBusyState(false);
        }
      }

      // Mehrteilige Filme (z.B. CD1 & CD2) geordnet nacheinander an das gewählte Ziel senden
      async function sendAllMoviePartsToTelegram() {
        if (!isCurrentUserVip()) {
          showHudToast("🔒 Exklusiv für VIP-Mitglieder verfügbar.");
          return;
        }
        const d = state.activeDetails;
        if (!d || !Array.isArray(d.files)) return;
        const prefs = getDeliveryPreferencesClient();
        const partFiles = d.files
          .filter(f => f && f.telegram_file_id && f.part)
          .slice()
          .sort((a, b) => String(a.part || "").localeCompare(String(b.part || ""), "de", { numeric: true }));
        const targetList = partFiles.length >= 2 ? partFiles : d.files.filter(f => f && f.telegram_file_id);
        if (targetList.length === 0) return;

        let sentCount = 0;
        let queuedCount = 0;
        for (let i = 0; i < targetList.length; i++) {
          const f = targetList[i];
          const partLabel = f.part ? (" (" + f.part + ")") : (" (Teil " + (i + 1) + ")");
          const sizeLabel = formatFileSizeClient(f.file_size);
          setBusyState(true, "📦 Sende Teil " + (i + 1) + "/" + targetList.length + ": " + d.title + partLabel + "...");
          try {
            const r = await apiFetchJson(API_BASE + "/stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chatId,
                fileId: f.telegram_file_id,
                title: d.title + partLabel,
                quality: f.quality || "1080p",
                fileSize: sizeLabel,
                tags: f.tags || "",
                targetMode: prefs.targetMode || "dm",
                targetGroupChatId: prefs.targetGroupChatId || "",
                targetTopicId: prefs.targetTopicId || "",
                sourceBridgeChatId: prefs.sourceBridgeChatId || "",
                customBotToken: prefs.customBotToken || ""
              })
            });
            if (r && r.antiSpam) {
              clientAntiSpamSnapshot = r.antiSpam;
              renderAntiSpamLiveHudBannerClient(r.antiSpam);
            }
            if (r && r.ok) {
              if (r.queued) queuedCount++;
              else sentCount++;
            }
          } catch (e) {}
        }
        setBusyState(false);
        scheduleAntiSpamPollClient(950);
        if (queuedCount > 0) {
          showHudToast("⏳ " + sentCount + " sofort gesendet, " + queuedCount + " Teil(e) in Anti-Spam Warteschleife eingereiht!");
        } else {
          showHudToast("✅ " + sentCount + "/" + targetList.length + " Teile gesendet!");
        }
      }

      // Optimierung #14: Ganze Staffel für VIPs nacheinander an das gewählte Ziel senden
      let activeSeasonCacheEpisodes = [];
      const selectedEpisodeVersionMap = {};

      function selectEpisodeVersion(seriesId, seasonNum, epNumber, versionIdx) {
        const key = seriesId + "_" + seasonNum + "_" + epNumber;
        selectedEpisodeVersionMap[key] = Number(versionIdx) || 0;
        loadSeason(seriesId, seasonNum, false, false);
      }

      async function sendWholeSeasonToTelegram(seriesId, seasonNum) {
        if (!isCurrentUserVip()) {
          showHudToast("🔒 Exklusiv für VIP-Mitglieder verfügbar.");
          return;
        }
        const prefs = getDeliveryPreferencesClient();
        const episodesWithStreams = (activeSeasonCacheEpisodes || []).filter(ep => Array.isArray(ep.files) && ep.files.length > 0);
        if (episodesWithStreams.length === 0) {
          showHudToast("⚠️ Keine Episoden-Streams in dieser Staffel hinterlegt.");
          return;
        }
        const seriesTitle = state.activeDetails?.title || "Serie";
        let sentCount = 0;
        let queuedCount = 0;
        for (let i = 0; i < episodesWithStreams.length; i++) {
          const ep = episodesWithStreams[i];
          const vKey = seriesId + "_" + seasonNum + "_" + ep.episode_number;
          const selIdx = Number(selectedEpisodeVersionMap[vKey] || 0);
          const epVersions = Array.isArray(ep.versions) && ep.versions.length > 0 ? ep.versions : ep.files;
          const bestFile = epVersions[selIdx] || ep.files[0];
          const targetFileId = bestFile?.telegram_file_id || bestFile?.file_id;
          if (!bestFile || !targetFileId) continue;
          const epCode = "S" + String(seasonNum).padStart(2, "0") + "E" + String(ep.episode_number).padStart(2, "0");
          const sizeLabel = formatFileSizeClient(bestFile.file_size);
          setBusyState(true, "📦 Staffel " + seasonNum + " (" + (i + 1) + "/" + episodesWithStreams.length + "): " + epCode + "...");
          try {
            const r = await apiFetchJson(API_BASE + "/stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chatId,
                fileId: targetFileId,
                title: seriesTitle + " " + epCode + " - " + (ep.name || ("Folge " + ep.episode_number)),
                quality: bestFile.quality || "1080p",
                fileSize: sizeLabel,
                tags: bestFile.versionLabel || bestFile.tags || "",
                targetMode: prefs.targetMode || "dm",
                targetGroupChatId: prefs.targetGroupChatId || "",
                targetTopicId: prefs.targetTopicId || "",
                sourceBridgeChatId: prefs.sourceBridgeChatId || "",
                customBotToken: prefs.customBotToken || ""
              })
            });
            if (r && r.antiSpam) {
              clientAntiSpamSnapshot = r.antiSpam;
              renderAntiSpamLiveHudBannerClient(r.antiSpam);
            }
            if (r && r.ok) {
              if (r.queued) queuedCount++;
              else sentCount++;
              setSeriesProgress(seriesId, seasonNum, ep.episode_number, ep.name || "");
            }
          } catch (e) {}
        }
        setBusyState(false);
        scheduleAntiSpamPollClient(950);
        if (queuedCount > 0) {
          showHudToast("⏳ Staffel " + seasonNum + ": " + sentCount + " sofort, " + queuedCount + " Folge(n) in Anti-Spam Warteschleife!");
        } else {
          showHudToast("✅ Staffel " + seasonNum + ": " + sentCount + "/" + episodesWithStreams.length + " Folgen gesendet!");
        }
        loadSeason(seriesId, seasonNum, false, false);
      }

      async function loadSeason(seriesId, seasonNum, jumpToFirstEpisode = false, forceRefresh = false) {
        const vipAllowed = isCurrentUserVip();
        const cacheKey = seriesId + "_" + seasonNum + "_" + (vipAllowed ? "vip" : "std");
        const cachedEntry = !forceRefresh ? clientSeasonCache.get(cacheKey) : null;
        const hasValidCache = Boolean(cachedEntry && (Date.now() - cachedEntry.ts < CLIENT_CACHE_TTL_MS));
        const s = hasValidCache
          ? cachedEntry.data
          : await apiFetchJson(API_BASE + "/season?chatId=" + encodeURIComponent(chatId) + "&seriesId=" + seriesId + "&season=" + seasonNum);
        if (!hasValidCache && s && s.ok !== false) {
          clientSeasonCache.set(cacheKey, { data: s, ts: Date.now() });
        }
        const box = document.getElementById("seasonBox");
        if (!box) return;
        const maxAllowedEpisodes = Number(s.seasonEpisodeCount || 0);
        const rawEpisodesArray = s.episodes || [];
        // Die "Max. 1 aktive Gruppe / Keine Addition"-Regel:
        // Holt sich exakt die Folgen der aktiven Gruppe und ignoriert alles danach per hartem .slice(0, maxAllowedEpisodes)!
        const finalEpisodesList = maxAllowedEpisodes > 0
          ? rawEpisodesArray.filter(ep => Number(ep.episode_number) <= maxAllowedEpisodes).slice(0, maxAllowedEpisodes)
          : rawEpisodesArray;
        const episodes = finalEpisodesList;
        activeSeasonCacheEpisodes = episodes;
        const prog = getSeriesProgress(seriesId);
        const seasonStreamableCount = vipAllowed
          ? episodes.filter(ep => Array.isArray(ep.files) && ep.files.length > 0).length
          : 0;

        const sCounts = (s.seasonCounts && typeof s.seasonCounts === "object") ? s.seasonCounts : (state.activeDetails?.seasonCounts || {});
        const sBtns = (s.seasons || [1]).map(n => {
          const isProgSeason = prog && Number(prog.season) === Number(n);
          const rawCnt = vipAllowed ? Number(sCounts[n] || sCounts[String(n)] || 0) : 0;
          const vipEpCnt = (n === seasonNum && maxAllowedEpisodes > 0) ? Math.min(rawCnt, maxAllowedEpisodes) : rawCnt;
          const vipBadgeTxt = vipEpCnt > 0 ? (' 🌟' + vipEpCnt) : '';
          return '<button class="btn '+(n===seasonNum?'red':'')+'" onclick="loadSeason('+seriesId+','+n+',true)">Staffel '+n+vipBadgeTxt+(isProgSeason ? ' 👁️' : '')+'</button>';
        }).join(" ");

        const progressBannerHtml = prog ? (
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;margin-bottom:8px;border-radius:8px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.35);font-size:11.5px">' +
            '<span>👁️ <b>Serien-Fortschritt:</b> Zuletzt bei <b>S' + String(prog.season).padStart(2,'0') + 'E' + String(prog.episode).padStart(2,'0') + '</b>' + (prog.epName ? ' (' + esc(prog.epName) + ')' : '') + '</span>' +
            (Number(prog.season) !== Number(seasonNum) ? '<button class="btn green" style="padding:3px 8px;font-size:11px" onclick="loadSeason(' + seriesId + ',' + Number(prog.season) + ',true)">↪️ Zu Staffel ' + Number(prog.season) + '</button>' : '') +
          '</div>'
        ) : '';

        box.innerHTML =
          '<div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' + sBtns + '</div>' +
            ((vipAllowed && seasonStreamableCount > 0) ? (
              '<button class="btn amber" onclick="sendWholeSeasonToTelegram(' + seriesId + ',' + seasonNum + ')" title="Alle ' + seasonStreamableCount + ' verfügbaren Folgen von Staffel ' + seasonNum + ' nacheinander an deinen Telegram-Chat senden">' +
                '📦 Ganze Staffel ' + seasonNum + ' senden (' + seasonStreamableCount + ' Flg.)' +
              '</button>'
            ) : '') +
          '</div>' +
          progressBannerHtml +
          '<div style="font-size:11.5px;color:#aaa;margin-bottom:6px">💡 Tippe auf den Episodentitel für den Telegraph-Guide' + (vipAllowed ? ' oder wähle rechts die VIP-Version (inkl. Versions-Switcher bei mehreren Schnittfassungen) zum Streamen/Downloaden:' : ':') + '</div>' +
          episodes.map(ep => {
            const epCode = 'S'+String(seasonNum).padStart(2,'0')+'E'+String(ep.episode_number).padStart(2,'0');
            const isLastWatched = Boolean(prog && Number(prog.season) === Number(seasonNum) && Number(prog.episode) === Number(ep.episode_number));
            const isNextEpisode = Boolean(prog && Number(prog.season) === Number(seasonNum) && Number(ep.episode_number) === Number(prog.episode) + 1);
            const rowCls = isLastWatched ? "ep-row ep-watched" : isNextEpisode ? "ep-row ep-next-up" : "ep-row";
            const progBadgeHtml = isLastWatched
              ? '<span class="ep-progress-badge">👁️ Zuletzt</span>'
              : isNextEpisode
                ? '<span class="ep-progress-badge next">▶️ Nächste</span>'
                : '';

            // Episoden-Streams & Versions-Switcher strikt NUR für VIP-Mitglieder!
            let filesBtns = "";
            let activeFileForActions = (Array.isArray(ep.files) && ep.files[0]) ? ep.files[0] : null;
            if (vipAllowed) {
              const epVersions = Array.isArray(ep.versions) && ep.versions.length > 0
                ? ep.versions
                : (Array.isArray(ep.files) ? ep.files.map(f => ({
                    versionLabel: f.versionLabel || f.version_label || "Originalfassung",
                    file_id: f.telegram_file_id,
                    telegram_file_id: f.telegram_file_id,
                    quality: f.quality || "1080p",
                    codec: f.codec || "x264",
                    file_size: f.file_size || 0,
                    tags: f.tags || "",
                    subtitles: Array.isArray(f.subtitles) ? f.subtitles : []
                  })) : []);

              const distinctLabels = Array.from(new Set(epVersions.map(v => v.versionLabel || "Originalfassung")));
              if (epVersions.length > 1 && distinctLabels.length > 1) {
                const vKey = seriesId + "_" + seasonNum + "_" + ep.episode_number;
                const activeIdx = Math.min(Number(selectedEpisodeVersionMap[vKey] || 0), epVersions.length - 1);
                const activeVer = epVersions[activeIdx] || epVersions[0];
                activeFileForActions = activeVer;
                const activeFid = activeVer.file_id || activeVer.telegram_file_id;
                const activeSizeStr = formatFileSizeClient(activeVer.file_size);
                const activeLabel = activeVer.versionLabel || "Originalfassung";
                const activeSubs = Array.isArray(activeVer.subtitles) ? activeVer.subtitles : [];
                const activeBtnMeta = [activeVer.quality || '1080p', activeVer.codec || '', activeSizeStr ? ('• ' + activeSizeStr) : '', '• ' + activeLabel].filter(Boolean).join(' ');

                const switcherTabsHtml =
                  '<div class="version-switcher" style="display:inline-flex;gap:4px;align-items:center;background:rgba(255,255,255,0.06);padding:2px 4px;border-radius:6px;border:1px solid rgba(255,255,255,0.14)">' +
                    epVersions.map((v, vIdx) => {
                      const isSel = vIdx === activeIdx;
                      const vLbl = v.versionLabel || "Originalfassung";
                      return '<button type="button" class="btn ' + (isSel ? 'red' : '') + '" style="padding:2px 7px;font-size:10.5px;border-radius:4px;' + (isSel ? '' : 'background:transparent;border-color:transparent;color:#bbb;') + '" onclick="selectEpisodeVersion(' + seriesId + ',' + seasonNum + ',' + ep.episode_number + ',' + vIdx + ')">' + esc(vLbl) + '</button>';
                    }).join('') +
                  '</div>';

                const playBtnHtml = '<button class="btn red" style="padding:4px 8px;font-size:11px;font-variant-numeric:tabular-nums" onclick="requestTelegramStream(\\''+esc(activeFid)+'\\',\\''+esc((state.activeDetails?.title || 'Serie') + ' ' + epCode + ' - ' + ep.name)+'\\',\\''+esc(activeVer.quality || '1080p')+'\\',{seriesId:'+seriesId+',season:'+seasonNum+',episode:'+ep.episode_number+',epName:\\''+esc(ep.name)+'\\',fileSize:\\''+esc(activeSizeStr)+'\\',tags:\\''+esc(activeLabel)+'\\'})">▶️ ' + esc(activeBtnMeta) + (activeSubs.length > 0 ? ' + 💬 UT' : '') + '</button>' +
                  (activeSubs.length > 0 ? ' <button type="button" class="btn blue" style="padding:4px 8px;font-size:11px" onclick="requestTelegramSubtitleOnly(\\''+esc(activeFid)+'\\',\\''+esc((state.activeDetails?.title || 'Serie') + ' ' + epCode)+'\\',{seriesId:'+seriesId+',season:'+seasonNum+',episode:'+ep.episode_number+'})" title="Nur Untertitel einzeln senden">💬 UT (' + activeSubs.length + ')</button>' : '');

                filesBtns = switcherTabsHtml + " " + playBtnHtml;
              } else if (Array.isArray(ep.files)) {
                filesBtns = ep.files.map(f => {
                  const sizeStr = formatFileSizeClient(f.file_size);
                  const rawTagsStr = String(f.tags || f.versionLabel || f.version_label || "").trim();
                  const fSubs = Array.isArray(f.subtitles) ? f.subtitles : [];
                  const tagsStr = rawTagsStr
                    .split(/\s*·\s*/)
                    .map(t => {
                      const tl = t.toLowerCase();
                      if (tl.includes("netflix") || tl.includes("edited") || tl.includes("stream") || tl.includes("original parts")) return "Netflix-Fassung";
                      if (tl.includes("tv-schnitt")) return "TV-Schnitt";
                      if (tl.includes("dvd-fassung")) return "DVD-Fassung";
                      return t.trim();
                    })
                    .filter(Boolean)
                    .filter((v, i, arr) => arr.indexOf(v) === i)
                    .join(" · ");
                  const isPrereleaseEp = tagsStr.includes("Vorabversion") || /\b(?:HDTS|TeleSync|HDCAM|MicDub|LineDub|Screener|DVDScr)\b/i.test(tagsStr);
                  const btnMeta = [f.quality || '1080p', f.codec || '', sizeStr ? ('• ' + sizeStr) : '', tagsStr ? ('• ' + tagsStr) : ''].filter(Boolean).join(' ');
                  return '<button class="btn ' + (isPrereleaseEp ? 'amber' : 'red') + '" style="padding:4px 8px;font-size:11px;font-variant-numeric:tabular-nums" onclick="requestTelegramStream(\\''+esc(f.telegram_file_id)+'\\',\\''+esc((state.activeDetails?.title || 'Serie') + ' ' + epCode + ' - ' + ep.name)+'\\',\\''+esc(f.quality || '1080p')+'\\',{seriesId:'+seriesId+',season:'+seasonNum+',episode:'+ep.episode_number+',epName:\\''+esc(ep.name)+'\\',fileSize:\\''+esc(sizeStr)+'\\',tags:\\''+esc(tagsStr)+'\\'})">▶️ ' + esc(btnMeta) + (fSubs.length > 0 ? ' + 💬 UT' : '') + '</button>' +
                    (fSubs.length > 0 ? ' <button type="button" class="btn blue" style="padding:4px 8px;font-size:11px" onclick="requestTelegramSubtitleOnly(\\''+esc(f.telegram_file_id)+'\\',\\''+esc((state.activeDetails?.title || 'Serie') + ' ' + epCode)+'\\',{seriesId:'+seriesId+',season:'+seasonNum+',episode:'+ep.episode_number+'})" title="Nur Untertitel einzeln senden">💬 UT (' + fSubs.length + ')</button>' : '');
                }).join(" ");
              }
            }

            const isAdminUser = Boolean(state.authUser?.isAdmin);
            const canReportMedia = Boolean(vipAllowed || isAdminUser);
            const activeFidStr = String(activeFileForActions?.telegram_file_id || activeFileForActions?.file_id || "");
            const activeVerLblStr = String(activeFileForActions?.versionLabel || activeFileForActions?.version_label || activeFileForActions?.tags || "Originalfassung");
            const activeQualStr = String(activeFileForActions?.quality || "1080p");
            const hasStreamFile = Boolean(Array.isArray(ep.files) && ep.files.length > 0);

            const adminEditBtnHtml = (isAdminUser && hasStreamFile)
              ? ('<button type="button" class="btn ep-icon-btn" onclick="openEpisodeCorrectionModal({typeCode:\\'s\\',tmdbId:' + seriesId + ',title:\\'' + esc(state.activeDetails?.title || 'Serie') + '\\',season:' + seasonNum + ',episode:' + ep.episode_number + ',episodeTitle:\\'' + esc(ep.name) + '\\',telegramFileId:\\'' + esc(activeFidStr) + '\\',versionLabel:\\'' + esc(activeVerLblStr) + '\\',quality:\\'' + esc(activeQualStr) + '\\'})" title="Folge korrigieren (Staffel/Folge anpassen, Schnittfassung wechseln oder mit neuer TMDb-ID verknüpfen)">✏️</button>')
              : '';

            const reportBtnHtml = canReportMedia
              ? ('<button type="button" class="btn ep-icon-btn" onclick="openMediaReportModal({typeCode:\\'s\\',tmdbId:' + seriesId + ',title:\\'' + esc(state.activeDetails?.title || 'Serie') + '\\',season:' + seasonNum + ',episode:' + ep.episode_number + ',episodeTitle:\\'' + esc(ep.name) + '\\',telegramFileId:\\'' + esc(activeFidStr) + '\\',versionLabel:\\'' + esc(activeVerLblStr) + '\\'})" title="Fehler für ' + epCode + ' melden">⚠️</button>')
              : '';

            return '<div class="' + rowCls + '">' +
              '<div class="ep-title" tabindex="0" onclick="openEpisodeStory('+seriesId+','+seasonNum+','+ep.episode_number+',\\''+esc(ep.name)+'\\')">' +
                '<span>' + epCode + ' – ' + esc(ep.name) + '</span>' +
                progBadgeHtml +
              '</div>' +
              '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                filesBtns +
                adminEditBtnHtml +
                reportBtnHtml +
                '<button class="btn '+(ep.isSaved?'green':'')+'" onclick="toggleEpisodeSave('+seriesId+','+seasonNum+','+ep.episode_number+')">'+(ep.isSaved?'✅ Gespeichert':'💾')+'</button>' +
              '</div>' +
            '</div>';
          }).join("");
        if (jumpToFirstEpisode) {
          const nextOrFirstEpEl = box.querySelector(".ep-row.ep-next-up .ep-title, .ep-row.ep-watched .ep-title, .ep-title");
          if (nextOrFirstEpEl && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(nextOrFirstEpEl, true);
          }
        }
      }

      // =========================================================================
      // GRANULARER "FOLGEN KORRIGIEREN"-DIALOG & "FEHLER MELDEN"-MODAL (CLIENT)
      // =========================================================================
      let activeEpisodeCorrectionState = null;
      let activeMediaReportState = null;

      function ensureSubModalMountClient() {
        let el = document.getElementById("subModalOverlayRoot");
        if (!el) {
          el = document.createElement("div");
          el.id = "subModalOverlayRoot";
          document.body.appendChild(el);
        }
        return el;
      }

      function closeSubModalOverlayClient() {
        const el = document.getElementById("subModalOverlayRoot");
        if (el) el.innerHTML = "";
        activeEpisodeCorrectionState = null;
        activeMediaReportState = null;
      }

      function openEpisodeCorrectionModal(opts) {
        if (!state.authUser?.isAdmin) {
          showHudToast("⛔ Nur Administratoren können Folgen und Dateien umsortieren.");
          return;
        }
        const typeCode = opts?.typeCode === "m" ? "m" : "s";
        const tmdbId = Number(opts?.tmdbId || state.activeDetails?.id || 0);
        const title = String(opts?.title || state.activeDetails?.title || "Titel");
        const season = Math.max(1, Number(opts?.season || 1));
        const episode = Math.max(1, Number(opts?.episode || 1));
        const episodeTitle = String(opts?.episodeTitle || "");
        const telegramFileId = String(opts?.telegramFileId || "");
        const versionLabel = String(opts?.versionLabel || "Originalfassung");
        const quality = String(opts?.quality || "1080p");
        const reportId = Number(opts?.reportId || 0);

        // Falls in activeDetails.allStreamFiles der Original-Dateiname oder Telegram-Link vorhanden ist, automatisch nachladen
        let rawFilename = String(opts?.rawFilename || "");
        let messageLink = String(opts?.messageLink || "");
        const allAdminFiles = Array.isArray(state.activeDetails?.allStreamFiles) ? state.activeDetails.allStreamFiles : [];
        const matchedRow = allAdminFiles.find(f =>
          (telegramFileId && String(f.telegram_file_id) === telegramFileId) ||
          (typeCode === "s" && Number(f.season_number) === season && Number(f.episode_number) === episode)
        );
        if (matchedRow) {
          if (!rawFilename && matchedRow.raw_filename) rawFilename = matchedRow.raw_filename;
          if (!messageLink && matchedRow.message_link) messageLink = matchedRow.message_link;
        }

        const initialMode = typeCode === "m" ? "relink_tmdb" : (opts?.initialMode || "move_se");
        activeEpisodeCorrectionState = {
          typeCode,
          tmdbId,
          title,
          season,
          episode,
          episodeTitle,
          telegramFileId,
          versionLabel,
          quality,
          rawFilename,
          messageLink,
          reportId,
          mode: initialMode,
          relinkScope: "single_episode",
          selectedNewTmdbId: tmdbId,
          selectedNewTypeCode: typeCode,
          selectedNewTitle: title
        };

        renderEpisodeCorrectionModalDomClient();
      }

      function switchEpisodeCorrectionModeClient(nextMode) {
        if (!activeEpisodeCorrectionState) return;
        activeEpisodeCorrectionState.mode = nextMode;
        renderEpisodeCorrectionModalDomClient();
      }

      function renderEpisodeCorrectionModalDomClient() {
        const st = activeEpisodeCorrectionState;
        if (!st) return;
        const mount = ensureSubModalMountClient();
        const epBadge = st.typeCode === "s"
          ? ('S' + String(st.season).padStart(2, '0') + 'E' + String(st.episode).padStart(2, '0') + (st.episodeTitle ? (' – ' + esc(st.episodeTitle)) : ''))
          : '🎬 Spielfilm-Datei';

        const VERSION_PRESETS = [
          "Netflix-Fassung",
          "Originalfassung",
          "TV-Schnitt",
          "DVD-Fassung",
          "Extended Cut",
          "Director's Cut",
          "Uncut"
        ];

        mount.innerHTML =
          '<div class="submodal-backdrop" onclick="if(event.target===this)closeSubModalOverlayClient()">' +
            '<div class="submodal-box">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">' +
                '<div style="font-size:15px;font-weight:900;color:#fff">✏️ Folge / Datei korrigieren</div>' +
                '<button type="button" class="btn red" onclick="closeSubModalOverlayClient()">✖</button>' +
              '</div>' +

              '<div style="padding:9px 11px;border-radius:8px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.35);margin-bottom:10px;font-size:12px">' +
                '<div style="font-weight:800;color:#f8fafc">' + esc(st.title) + ' <span style="color:#38bdf8">(' + epBadge + ')</span></div>' +
                '<div style="color:#94a3b8;font-size:11px;margin-top:3px">' +
                  'Aktuelle Version: <b style="color:#fbbf24">' + esc(st.versionLabel) + '</b> • Qualität: <b>' + esc(st.quality) + '</b>' +
                  (st.reportId ? (' • <span style="color:#34d399">🚨 Verknüpft mit Meldung #' + st.reportId + ' (wird beim Speichern automatisch gelöst)</span>') : '') +
                '</div>' +
                (st.rawFilename ? '<div style="margin-top:4px;font-family:monospace;font-size:10.5px;color:#cbd5e1;word-break:break-all">📄 Original-Datei: ' + esc(st.rawFilename) + '</div>' : '') +
                (st.messageLink ? '<div style="margin-top:4px"><a href="' + esc(st.messageLink) + '" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;font-size:11px;text-decoration:underline">🔗 Original-Nachricht in Telegram öffnen</a></div>' : '') +
              '</div>' +

              /* Modus-Umschalter */
              '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
                (st.typeCode === "s" ? (
                  '<button type="button" class="btn ' + (st.mode === 'move_se' ? 'red' : '') + '" onclick="switchEpisodeCorrectionModeClient(\\'move_se\\')">🔢 Staffel & Folge anpassen</button>'
                ) : '') +
                '<button type="button" class="btn ' + (st.mode === 'change_version' ? 'red' : '') + '" onclick="switchEpisodeCorrectionModeClient(\\'change_version\\')">🎞️ Version / Schnittfassung</button>' +
                '<button type="button" class="btn ' + (st.mode === 'relink_tmdb' ? 'red' : '') + '" onclick="switchEpisodeCorrectionModeClient(\\'relink_tmdb\\')">🔄 Neu verknüpfen (TMDb)</button>' +
              '</div>' +

              /* MODUS 1: Staffel & Folge anpassen */
              (st.mode === "move_se" ? (
                '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;margin-bottom:12px">' +
                  '<div style="font-size:12px;color:#cbd5e1;margin-bottom:8px">Wähle die korrekte <b>Staffel</b> und <b>Folge</b> innerhalb von <b>' + esc(st.title) + '</b>:</div>' +
                  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
                    '<div>' +
                      '<label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Ziel-Staffel</label>' +
                      '<input id="epCorrNewSeasonInp" type="number" min="1" max="99" value="' + st.season + '" style="width:100%;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:13px;font-weight:800" />' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Ziel-Folge</label>' +
                      '<input id="epCorrNewEpisodeInp" type="number" min="1" max="999" value="' + st.episode + '" style="width:100%;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:13px;font-weight:800" />' +
                    '</div>' +
                  '</div>' +
                '</div>'
              ) : '') +

              /* MODUS 2: Version / Schnittfassung wechseln */
              (st.mode === "change_version" ? (
                '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;margin-bottom:12px">' +
                  '<div style="font-size:12px;color:#cbd5e1;margin-bottom:8px">Ordne diese Datei einer anderen <b>Schnittfassung / Version</b> zu (keine Version geht verloren, beide erscheinen im Versions-Switcher):</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
                    VERSION_PRESETS.map(vp =>
                      '<button type="button" class="btn ' + (st.versionLabel === vp ? 'amber' : '') + '" onclick="document.getElementById(\\'epCorrVersionInp\\').value=\\'' + esc(vp) + '\\'">' + esc(vp) + '</button>'
                    ).join("") +
                  '</div>' +
                  '<input id="epCorrVersionInp" value="' + esc(st.versionLabel) + '" placeholder="Eigene Versions-Bezeichnung (z.B. Netflix-Fassung)..." style="width:100%;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:12.5px" />' +
                '</div>'
              ) : '') +

              /* MODUS 3: Mit anderer TMDb-ID (Serie + Staffel/Folge oder Film) verknüpfen */
              (st.mode === "relink_tmdb" ? (
                '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;margin-bottom:12px">' +
                  '<div style="font-size:12px;color:#cbd5e1;margin-bottom:8px"><b>Umfang der Neu-Verknüpfung:</b></div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
                    '<button type="button" class="btn ' + (st.relinkScope === 'single_episode' ? 'green' : '') + '" onclick="activeEpisodeCorrectionState.relinkScope=\\'single_episode\\';renderEpisodeCorrectionModalDomClient()">🎯 Nur diese einzelne Folge / Datei zuweisen</button>' +
                    '<button type="button" class="btn ' + (st.relinkScope === 'entire_series' ? 'amber' : '') + '" onclick="activeEpisodeCorrectionState.relinkScope=\\'entire_series\\';renderEpisodeCorrectionModalDomClient()">📦 Ganze Serie / Alle Folgen umziehen</button>' +
                  '</div>' +

                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
                    '<input id="epCorrTmdbSearchInp" value="' + esc(st.title) + '" placeholder="Richtigen Titel oder TMDb-ID suchen..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();searchEpisodeCorrectionTmdbClient()}" style="flex:1;min-width:170px;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:12px" />' +
                    '<button type="button" class="btn blue" onclick="searchEpisodeCorrectionTmdbClient()">🔍 Suchen</button>' +
                  '</div>' +

                  '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-bottom:8px">' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:#94a3b8;display:block;margin-bottom:2px">Ziel-Typ</label>' +
                      '<select id="epCorrNewTypeSel" onchange="activeEpisodeCorrectionState.selectedNewTypeCode=this.value" style="width:100%;padding:7px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px">' +
                        '<option value="s" ' + (st.selectedNewTypeCode === 's' ? 'selected' : '') + '>📺 Serie</option>' +
                        '<option value="m" ' + (st.selectedNewTypeCode === 'm' ? 'selected' : '') + '>🎬 Film</option>' +
                      '</select>' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:#94a3b8;display:block;margin-bottom:2px">Ziel TMDb-ID</label>' +
                      '<input id="epCorrNewTmdbIdInp" type="number" value="' + st.selectedNewTmdbId + '" style="width:100%;padding:7px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;font-weight:800" />' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:#94a3b8;display:block;margin-bottom:2px">Staffel</label>' +
                      '<input id="epCorrRelinkSeasonInp" type="number" min="1" max="99" value="' + st.season + '" style="width:100%;padding:7px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;font-weight:800" />' +
                    '</div>' +
                    '<div>' +
                      '<label style="font-size:10.5px;color:#94a3b8;display:block;margin-bottom:2px">Folge</label>' +
                      '<input id="epCorrRelinkEpisodeInp" type="number" min="1" max="999" value="' + st.episode + '" style="width:100%;padding:7px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;font-weight:800" />' +
                    '</div>' +
                  '</div>' +

                  '<div id="epCorrTmdbResultsBox" style="max-height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:5px"></div>' +
                '</div>'
              ) : '') +

              '<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">' +
                '<button type="button" class="btn" onclick="closeSubModalOverlayClient()">Abbrechen</button>' +
                '<button type="button" class="btn green" onclick="submitEpisodeCorrectionClient()">💾 Korrektur speichern</button>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      async function searchEpisodeCorrectionTmdbClient() {
        const q = (document.getElementById("epCorrTmdbSearchInp")?.value || "").trim();
        const resBox = document.getElementById("epCorrTmdbResultsBox");
        if (!q || !resBox) return;
        resBox.innerHTML = '<div style="font-size:11.5px;color:#38bdf8;padding:6px">⏳ Suche auf TMDb & Fallback-APIs...</div>';
        try {
          const r = await apiFetchJson(API_BASE + "/search?chatId=" + encodeURIComponent(chatId) + "&q=" + encodeURIComponent(q) + "&bypass=1");
          const items = r?.items || [];
          if (items.length === 0) {
            resBox.innerHTML = '<div style="font-size:11.5px;color:#f87171;padding:6px">Keine Treffer gefunden.</div>';
            return;
          }
          resBox.innerHTML = items.slice(0, 10).map(item => {
            const tc = item.media_type === "tv" ? "s" : "m";
            const yr = String(item.release_date || item.first_air_date || "").split("-")[0] || "k.A.";
            const tName = item.title || item.name || "Unbekannt";
            const pUrl = resolvePosterUrlClient(item.poster_path, "w92", item.external_poster_url || "");
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:7px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1)">' +
              '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">' +
                (pUrl ? '<img src="' + esc(pUrl) + '" style="width:28px;height:42px;object-fit:cover;border-radius:4px;flex-shrink:0" />' : '') +
                '<div style="min-width:0;flex:1">' +
                  '<div style="font-size:12px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (tc === "s" ? "📺 " : "🎬 ") + esc(tName) + ' (' + esc(yr) + ')</div>' +
                  '<div style="font-size:10.5px;color:#38bdf8">TMDb #' + Number(item.id) + '</div>' +
                '</div>' +
              '</div>' +
              '<button type="button" class="btn green" style="padding:4px 8px;font-size:11px" onclick="selectEpisodeCorrectionTmdbCandidateClient(\\'' + tc + '\\',' + Number(item.id) + ',\\'' + esc(tName) + '\\')">Auswählen</button>' +
            '</div>';
          }).join("");
        } catch (e) {
          resBox.innerHTML = '<div style="font-size:11.5px;color:#f87171;padding:6px">⚠️ Suche fehlgeschlagen.</div>';
        }
      }

      function selectEpisodeCorrectionTmdbCandidateClient(newTypeCode, newTmdbId, newTitle) {
        if (!activeEpisodeCorrectionState) return;
        activeEpisodeCorrectionState.selectedNewTypeCode = newTypeCode;
        activeEpisodeCorrectionState.selectedNewTmdbId = Number(newTmdbId);
        activeEpisodeCorrectionState.selectedNewTitle = newTitle;
        const typeSel = document.getElementById("epCorrNewTypeSel");
        const idInp = document.getElementById("epCorrNewTmdbIdInp");
        if (typeSel) typeSel.value = newTypeCode;
        if (idInp) idInp.value = String(newTmdbId);
        showHudToast("🎯 Ziel gewählt: " + newTitle + " (#" + newTmdbId + ") – jetzt Staffel/Folge prüfen & speichern.");
      }

      async function submitEpisodeCorrectionClient() {
        const st = activeEpisodeCorrectionState;
        if (!st) return;
        const payload = {
          mode: st.mode,
          scope: st.relinkScope || "single_episode",
          oldTypeCode: st.typeCode,
          oldTmdbId: st.tmdbId,
          seriesId: st.tmdbId,
          oldSeason: st.season,
          oldEpisode: st.episode,
          telegramFileId: st.telegramFileId,
          reportId: st.reportId || 0,
          autoResolveReport: true
        };

        if (st.mode === "move_se") {
          payload.newSeason = Math.max(1, Number(document.getElementById("epCorrNewSeasonInp")?.value || st.season));
          payload.newEpisode = Math.max(1, Number(document.getElementById("epCorrNewEpisodeInp")?.value || st.episode));
        } else if (st.mode === "change_version") {
          payload.newVersionLabel = String(document.getElementById("epCorrVersionInp")?.value || st.versionLabel || "Originalfassung").trim();
        } else if (st.mode === "relink_tmdb") {
          payload.newTypeCode = document.getElementById("epCorrNewTypeSel")?.value === "m" ? "m" : "s";
          payload.newTmdbId = Number(document.getElementById("epCorrNewTmdbIdInp")?.value || st.selectedNewTmdbId || 0);
          payload.newSeason = Math.max(1, Number(document.getElementById("epCorrRelinkSeasonInp")?.value || st.season));
          payload.newEpisode = Math.max(1, Number(document.getElementById("epCorrRelinkEpisodeInp")?.value || st.episode));
        }

        setBusyState(true, "💾 Speichere Korrektur in D1 & aktualisiere Episoden...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/reassign-episode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Korrektur konnte nicht gespeichert werden."));
            return;
          }
          clearClientMediaCaches();
          closeSubModalOverlayClient();
          showHudToast("✅ Folge erfolgreich korrigiert" + (st.reportId ? " & Fehlermeldung automatisch als gelöst markiert!" : "!"));

          if (st.mode === "relink_tmdb" && r.newTmdbId && (r.scope === "entire_series" || Number(r.newTmdbId) !== Number(st.tmdbId))) {
            await openDetails(r.newTypeCode || "s", r.newTmdbId, false, "", "", r.newSeason || 1);
          } else if (st.typeCode === "s") {
            const targetSeasonToLoad = st.mode === "move_se" ? Number(payload.newSeason || st.season) : st.season;
            await openDetails("s", st.tmdbId, false, "", "", targetSeasonToLoad);
          } else {
            await openDetails("m", st.tmdbId, false);
          }
          if (state.currentView === "admin") {
            loadAdminPanelView();
          }
        } finally {
          setBusyState(false);
        }
      }

      // "Fehler melden"-Modal (für freigeschaltete VIP-Mitglieder und Admins)
      function openMediaReportModal(opts) {
        const vipAllowed = isCurrentUserVip();
        if (!vipAllowed && !state.authUser?.isAdmin) {
          showHudToast("🔒 Nur freigeschaltete VIP-Mitglieder und Admins können Fehlermeldungen einreichen.");
          return;
        }
        const typeCode = opts?.typeCode === "s" ? "s" : "m";
        const tmdbId = Number(opts?.tmdbId || state.activeDetails?.id || 0);
        const title = String(opts?.title || state.activeDetails?.title || "Unbekannt");
        const season = opts?.season != null ? Number(opts.season) : null;
        const episode = opts?.episode != null ? Number(opts.episode) : null;
        const episodeTitle = String(opts?.episodeTitle || "");
        const telegramFileId = String(opts?.telegramFileId || "");
        const versionLabel = String(opts?.versionLabel || "");

        activeMediaReportState = {
          typeCode,
          tmdbId,
          title,
          season,
          episode,
          episodeTitle,
          telegramFileId,
          versionLabel,
          reasonCode: typeCode === "s" && season ? "wrong_episode" : "wrong_media"
        };

        renderMediaReportModalDomClient();
      }

      function renderMediaReportModalDomClient() {
        const st = activeMediaReportState;
        if (!st) return;
        const mount = ensureSubModalMountClient();
        const epTag = st.typeCode === "s" && st.season
          ? (' • S' + String(st.season).padStart(2, '0') + 'E' + String(st.episode || 1).padStart(2, '0') + (st.episodeTitle ? (' (' + esc(st.episodeTitle) + ')') : ''))
          : '';

        const REASONS = [
          { code: "wrong_media", label: "🎬 Falscher Film / Falsche Serie" },
          { code: "wrong_episode", label: "🔢 Falsche Staffel- oder Folgennummer" },
          { code: "broken_video", label: "❌ Video defekt / Lädt nicht" },
          { code: "other", label: "💬 Sonstiges" }
        ];

        mount.innerHTML =
          '<div class="submodal-backdrop" onclick="if(event.target===this)closeSubModalOverlayClient()">' +
            '<div class="submodal-box">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">' +
                '<div style="font-size:15px;font-weight:900;color:#fbbf24">⚠️ Fehler melden</div>' +
                '<button type="button" class="btn red" onclick="closeSubModalOverlayClient()">✖</button>' +
              '</div>' +

              '<div style="padding:9px 11px;border-radius:8px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.35);margin-bottom:12px;font-size:12px">' +
                '<div style="font-weight:800;color:#fff">' + esc(st.title) + '<span style="color:#fbbf24">' + epTag + '</span></div>' +
                (st.versionLabel ? '<div style="font-size:11px;color:#94a3b8;margin-top:2px">Version: <b>' + esc(st.versionLabel) + '</b></div>' : '') +
              '</div>' +

              '<div style="font-size:12px;color:#cbd5e1;font-weight:700;margin-bottom:6px">Was stimmt mit diesem Eintrag nicht?</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">' +
                REASONS.map(r => {
                  const isSel = st.reasonCode === r.code;
                  return '<button type="button" class="btn ' + (isSel ? 'red' : '') + '" style="justify-content:flex-start;padding:9px 12px;font-size:12.5px;text-align:left;' + (isSel ? '' : 'background:rgba(255,255,255,0.04);') + '" onclick="activeMediaReportState.reasonCode=\\'' + r.code + '\\';renderMediaReportModalDomClient()">' +
                    (isSel ? '🔘 ' : '⚪ ') + esc(r.label) +
                  '</button>';
                }).join("") +
              '</div>' +

              '<div style="margin-bottom:12px">' +
                '<label style="font-size:11.5px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Kurze Notiz (optional, z.B. „Ist eigentlich Staffel 2 Folge 5“):</label>' +
                '<textarea id="mediaReportNoteInp" rows="2" placeholder="Optionale Hinweise für den Admin..." style="width:100%;padding:8px 10px;border-radius:8px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;resize:vertical"></textarea>' +
              '</div>' +

              '<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">' +
                '<button type="button" class="btn" onclick="closeSubModalOverlayClient()">Abbrechen</button>' +
                '<button type="button" class="btn amber" onclick="submitMediaReportClient()">📨 Meldung absenden</button>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      async function submitMediaReportClient() {
        const st = activeMediaReportState;
        if (!st) return;
        const note = String(document.getElementById("mediaReportNoteInp")?.value || "").trim();
        setBusyState(true, "📨 Sende Fehlermeldung an Admin...");
        try {
          const r = await apiFetchJson(API_BASE + "/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              typeCode: st.typeCode,
              tmdbId: st.tmdbId,
              title: st.title,
              seasonNumber: st.season,
              episodeNumber: st.episode,
              episodeTitle: st.episodeTitle,
              telegramFileId: st.telegramFileId,
              versionLabel: st.versionLabel,
              reasonCode: st.reasonCode,
              note
            })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Meldung konnte nicht gesendet werden."));
            return;
          }
          closeSubModalOverlayClient();
          showHudToast("✅ Danke! Deine Fehlermeldung wurde gespeichert und an den Admin gemeldet.");
        } finally {
          setBusyState(false);
        }
      }

      async function openReportCorrectionWorkflowClient(reportObj) {
        if (!reportObj) return;
        const tc = reportObj.type_code === "s" ? "s" : "m";
        const tid = Number(reportObj.tmdb_id || 0);
        const sNum = Math.max(1, Number(reportObj.season_number || 1));
        const eNum = Math.max(1, Number(reportObj.episode_number || 1));
        const initialMode = reportObj.reason_code === "wrong_media" ? "relink_tmdb" : (tc === "s" ? "move_se" : "relink_tmdb");
        window._pendingEpisodeCorrectionArgs = {
          typeCode: tc,
          tmdbId: tid,
          title: reportObj.title || "Titel",
          season: sNum,
          episode: eNum,
          episodeTitle: reportObj.episode_title || "",
          telegramFileId: reportObj.telegram_file_id || "",
          versionLabel: reportObj.version_label || "Originalfassung",
          reportId: Number(reportObj.id || 0),
          initialMode
        };
        await openDetails(tc, tid, false, reportObj.title || "", "", tc === "s" ? sNum : null);
      }

      async function adminResolveMediaReportClient(reportId) {
        setBusyState(true, "✅ Markiere Meldung als gelöst...");
        try {
          await apiFetchJson(API_BASE + "/admin/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "resolve", reportId: Number(reportId) })
          });
          showHudToast("✅ Meldung #" + reportId + " als gelöst markiert.");
          loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function adminDeleteMediaReportClient(reportId) {
        setBusyState(true, "🗑️ Lösche Meldung...");
        try {
          await apiFetchJson(API_BASE + "/admin/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", reportId: Number(reportId) })
          });
          showHudToast("🗑️ Meldung gelöscht.");
          loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function openEpisodeStory(seriesId, season, episode, epName = "") {
        setSeriesProgress(seriesId, season, episode, epName);
        setBusyState(true, "📖 Öffne Telegraph-Story...");
        try {
          const r = await apiFetchJson(API_BASE + "/episode-story", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, seriesId, season, episode }) });
          if (r.telegraphUrl) {
            if (tg && tg.openLink) tg.openLink(r.telegraphUrl);
            else window.open(r.telegraphUrl, "_blank");
          }
          loadSeason(seriesId, season, false, true);
        } finally {
          setBusyState(false);
        }
      }

      async function toggleEpisodeSave(seriesId, season, episode) {
        if (!state.isAuthenticated) { openAccountModal(); return; }
        await apiFetchJson(API_BASE + "/wishlist", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "toggle_episode", seriesId, season, episode }) });
        loadSeason(seriesId, season, false, true);
      }

      async function toggleWishlistItem(type, id) {
        if (!state.isAuthenticated) { openAccountModal(); return; }
        const btn = document.getElementById("modalWishlistBtn");
        if (btn) btn.disabled = true;
        try {
          const r = await apiFetchJson(API_BASE + "/wishlist", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "toggle_item", type, id }) });
          const isSaved = Boolean(r.saved);
          syncCardWishlistBadgeInDom(type, id, isSaved);
          if (state.activeDetails) state.activeDetails.isSaved = isSaved;
          if (btn) {
            btn.disabled = false;
            btn.className = "btn " + (isSaved ? "green" : "");
            btn.textContent = isSaved ? "✅ Gespeichert" : "💾 Merkliste";
          }
          showHudToast(isSaved ? "💾 Zur Merkliste hinzugefügt" : "🗑️ Aus Merkliste entfernt");
        } catch (e) {
          if (btn) btn.disabled = false;
        }
      }

      // Schnell-Filterung, A-Z Sprungleiste (#20) & Sortierung innerhalb der eigenen Merkliste (#7)
      function setWishlistQuickFilter(nextType) {
        state.wlFilterType = nextType || "all";
        renderWishlistViewDomOnly();
      }

      function setWishlistQuickSort(nextSort) {
        state.wlSort = nextSort || "added_desc";
        renderWishlistViewDomOnly();
      }

      function setWishlistLetter(nextLetter) {
        state.wlLetter = nextLetter || "ALL";
        renderWishlistViewDomOnly();
      }

      function onWishlistSearchInput(val) {
        state.wlSearchQuery = String(val || "");
        renderWishlistListItemsMountOnly();
      }

      function getFilteredAndSortedWishlistItems() {
        const allItems = state.cachedWishlistItems || [];
        const folders = state.cachedWishlistFolders || [];
        const cur = state.wlFolder || "root";
        const disabledFolderIds = new Set(folders.filter(f => f.enabled === false).map(f => f.id));
        const enabledItems = allItems.filter(i => !i.folderId || !disabledFolderIds.has(i.folderId));

        let list = cur === "root"
          ? enabledItems
          : cur === "cat_movies"
            ? enabledItems.filter(i => i.contentType === "movie" || i.folderId === "cat_movies")
            : cur === "cat_series"
              ? enabledItems.filter(i => i.contentType === "series" || i.contentType === "episode")
              : allItems.filter(i => i.folderId === cur);

        if (state.wlFilterType === "m") {
          list = list.filter(i => i.contentType === "movie");
        } else if (state.wlFilterType === "s") {
          list = list.filter(i => i.contentType === "series" || i.contentType === "episode");
        }

        const activeLetter = String(state.wlLetter || "ALL").toUpperCase();
        if (activeLetter && activeLetter !== "ALL") {
          list = list.filter(i => {
            const cleanTitle = String(i.title || "").trim().replace(/^[^a-zA-Z0-9äöüÄÖÜ]+/, "");
            const firstChar = (cleanTitle[0] || "").toUpperCase();
            if (activeLetter === "#") {
              return !/^[A-ZÄÖÜ]$/.test(firstChar);
            }
            if (activeLetter === "A" && firstChar === "Ä") return true;
            if (activeLetter === "O" && firstChar === "Ö") return true;
            if (activeLetter === "U" && firstChar === "Ü") return true;
            return firstChar === activeLetter;
          });
        }

        const q = String(state.wlSearchQuery || "").trim().toLowerCase();
        if (q) {
          list = list.filter(i => String(i.title || "").toLowerCase().includes(q) || String(i.year || "").includes(q));
        }

        const sorted = [...list];
        if (state.wlSort === "title_asc") {
          sorted.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "de"));
        } else if (state.wlSort === "year_desc") {
          sorted.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
        }
        return sorted;
      }

      function renderWishlistListItemsMountOnly() {
        const mount = document.getElementById("wishlistItemsMount");
        const countEl = document.getElementById("wishlistCountSpan");
        if (!mount) return;
        const folders = state.cachedWishlistFolders || [];
        const filteredItems = getFilteredAndSortedWishlistItems();
        if (countEl) countEl.textContent = String(filteredItems.length);
        if (filteredItems.length === 0) {
          mount.innerHTML = '<div class="panel-box" style="color:#aaa;font-size:12.5px">Keine passenden Einträge in dieser Merklisten-Ansicht gefunden.</div>';
          return;
        }
        mount.innerHTML = filteredItems.map((it, idx) => {
          const isEp = it.contentType === 'episode';
          const isSer = it.contentType === 'series' || isEp;
          const targetId = isEp ? it.seriesId : it.tmdbId;
          const badge = isEp ? '💿 Folge' : isSer ? '📺 Serie' : '🎬 Film';
          const plObj = it.folderId ? folders.find(f => f.id === it.folderId) : null;
          const plTag = plObj ? ' <span style="color:#38bdf8;font-size:10.5px">[' + esc(plObj.name) + ']</span>' : '';
          const thumbUrl = resolvePosterUrlClient(it.poster, 'w185', '');
          const epsList = Array.isArray(it.episodes) ? it.episodes : [];
          const drawerId = 'wl_' + esc(it.uid || (targetId + '_' + idx));
          const epPreviewCodes = epsList.slice(0, 3).map(e => e.code || ('S' + String(e.season || 1).padStart(2, '0') + 'E' + String(e.episode || 1).padStart(2, '0'))).join(', ');
          const epSummaryBtnHtml = (isSer && epsList.length > 0)
            ? ('<button type="button" class="btn" style="padding:3px 8px;font-size:11px;background:rgba(56,189,248,0.16);border-color:rgba(56,189,248,0.45);color:#38bdf8" onclick="toggleSeriesEpisodesDrawerClient(event,\\'' + drawerId + '\\')">📺 ' + epsList.length + ' Folge' + (epsList.length === 1 ? '' : 'n') + ' (' + esc(epPreviewCodes) + (epsList.length > 3 ? '…' : '') + ') <span id="epDrawerIcon_' + drawerId + '">▾</span></button>')
            : '';
          const epDrawerHtml = (isSer && epsList.length > 0)
            ? ('<div id="epDrawer_' + drawerId + '" style="display:none;flex-direction:column;gap:4px;margin-top:6px;padding:8px;border-radius:8px;background:rgba(15,23,42,0.85);border:1px solid rgba(56,189,248,0.3)">' +
                epsList.map(ep => {
                  const epCode = ep.code || ('S' + String(ep.season || 1).padStart(2, '0') + 'E' + String(ep.episode || 1).padStart(2, '0'));
                  const epTitle = ep.title || ('Folge ' + (ep.episode || 1));
                  const qStr = [ep.quality || '1080p', ep.codec || ''].filter(Boolean).join(' • ');
                  return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.04);font-size:11.5px">' +
                    '<div style="cursor:pointer;flex:1" onclick="openDetails(\\'s\\',' + Number(targetId) + ',false,\\'\\',\\'\\',' + Number(ep.season || 1) + ')">' +
                      '<b style="color:#38bdf8">' + esc(epCode) + '</b> – <span style="color:#f8fafc">' + esc(epTitle) + '</span>' +
                      (qStr ? ' <span style="color:#94a3b8;font-size:10.5px">[' + esc(qStr) + ']</span>' : '') +
                    '</div>' +
                    '<button type="button" class="btn" style="padding:2px 7px;font-size:10.5px" onclick="openDetails(\\'s\\',' + Number(targetId) + ',false,\\'\\',\\'\\',' + Number(ep.season || 1) + ')">Staffel ' + Number(ep.season || 1) + ' öffnen</button>' +
                  '</div>';
                }).join('') +
              '</div>')
            : '';
          return '<div class="ep-row" style="flex-direction:column;align-items:stretch">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:180px;cursor:pointer" tabindex="0" onclick="openDetails(\\''+(isSer?'s':'m')+'\\','+targetId+',false)">' +
                (thumbUrl
                  ? '<img src="' + esc(thumbUrl) + '" style="width:32px;height:46px;object-fit:cover;border-radius:4px;flex-shrink:0" alt="" />'
                  : '<div style="width:32px;height:46px;background:#1e293b;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + (isSer ? '📺' : '🎬') + '</div>') +
                '<div>' +
                  '<div style="font-size:12.5px;font-weight:800;color:#fff"><span style="color:#aaa;font-size:11px;margin-right:6px">' + badge + '</span>' + esc(it.title) + (it.year && it.year !== 'K. A.' ? ' <span style="color:#888;font-size:11px">(' + esc(it.year) + ')</span>' : '') + plTag + '</div>' +
                  (it.allQualities || it.quality ? '<div style="font-size:10.5px;color:#94a3b8;margin-top:2px">' + esc(it.allQualities || it.quality) + '</div>' : '') +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                epSummaryBtnHtml +
                '<button class="btn red" onclick="deleteSavedUid(\\''+esc(it.uid)+'\\')">🗑️</button>' +
              '</div>' +
            '</div>' +
            epDrawerHtml +
          '</div>';
        }).join("");
      }

      function renderWishlistViewDomOnly() {
        const root = document.getElementById("appRoot");
        if (!root) return;
        const allItems = state.cachedWishlistItems || [];
        const folders = state.cachedWishlistFolders || [];
        const cur = state.wlFolder || "root";
        const disabledFolderIds = new Set(folders.filter(f => f.enabled === false).map(f => f.id));
        const enabledItems = allItems.filter(i => !i.folderId || !disabledFolderIds.has(i.folderId));
        const filteredItems = getFilteredAndSortedWishlistItems();
        const activeFolderObj = folders.find(f => f.id === cur) || null;

        const folderBtns = [
          '<button class="btn '+(cur==='root'?'active':'')+'" onclick="loadWishlist(\\'root\\')">📂 Alle Aktiven ('+enabledItems.length+')</button>',
          '<button class="btn '+(cur==='cat_movies'?'active':'')+'" onclick="loadWishlist(\\'cat_movies\\')">🎬 Filme</button>',
          '<button class="btn '+(cur==='cat_series'?'active':'')+'" onclick="loadWishlist(\\'cat_series\\')">📺 Serien & Folgen</button>',
          ...folders.map(f => {
            const isEn = f.enabled !== false;
            const fCount = allItems.filter(i => i.folderId === f.id).length;
            const fIcon = (f.type === 'playlist' || f.isJsonPlaylist) ? (isEn ? '🎵' : '⚪') : (isEn ? '📁' : '⚪');
            return '<button class="btn '+(cur===f.id?'active':'')+'" style="'+(isEn?'':'opacity:0.65;border-style:dashed')+'" onclick="loadWishlist(\\''+esc(f.id)+'\\')">' + fIcon + ' ' + esc(f.name) + ' (' + fCount + ')</button>';
          })
        ].join(" ");

        const smartPlaylistsPanelHtml = folders.length > 0 ? (
          '<div class="panel-box" style="margin-bottom:12px;border-color:rgba(16,185,129,0.35)">' +
            '<div class="section-title">' +
              '<span>🎵 Smarte Playlisten & Ordner verwalten (' + folders.length + ')</span>' +
              '<span style="font-size:11px;color:#94a3b8">Einschalten • Ausschalten • Umbenennen • Löschen</span>' +
            '</div>' +
            folders.map(f => {
              const isEn = f.enabled !== false;
              const count = allItems.filter(i => i.folderId === f.id).length;
              const badgeType = (f.type === 'playlist' || f.isJsonPlaylist) ? '📦 JSON-Playlist' : '📁 Ordner';
              return '<div class="ep-row" style="' + (isEn ? '' : 'opacity:0.68;') + '">' +
                '<div class="ep-title" tabindex="0" onclick="loadWishlist(\\'' + esc(f.id) + '\\')">' +
                  '<span style="font-size:11px;padding:2px 6px;border-radius:999px;margin-right:6px;background:' + (isEn ? 'rgba(16,185,129,0.2);color:#34d399' : 'rgba(148,163,184,0.2);color:#94a3b8') + '">' +
                    (isEn ? '🟢 Eingeschaltet' : '⚪ Ausgeschaltet') +
                  '</span>' +
                  '<b>' + esc(f.name) + '</b> <span style="color:#94a3b8;font-size:11px">(' + count + ' Titel • ' + badgeType + ')</span>' +
                '</div>' +
                '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                  '<button class="btn ' + (isEn ? 'green' : '') + '" onclick="togglePlaylistFolderTma(\\'' + esc(f.id) + '\\')">' + (isEn ? '🟢 Ein (Ausschalten)' : '⚪ Aus (Einschalten)') + '</button>' +
                  '<button class="btn" onclick="loadWishlist(\\'' + esc(f.id) + '\\')">📂 Öffnen</button>' +
                  '<button class="btn" onclick="renamePlaylistFolderTma(\\'' + esc(f.id) + '\\',\\'' + esc(f.name) + '\\')">✏️ Name</button>' +
                  '<button class="btn red" onclick="deletePlaylistFolderTma(\\'' + esc(f.id) + '\\',\\'' + esc(f.name) + '\\')">🗑️ Löschen</button>' +
                '</div>' +
              '</div>';
            }).join("") +
          '</div>'
        ) : '';

        const activeFolderBannerHtml = activeFolderObj ? (
          '<div class="panel-box" style="margin-bottom:10px;border-color:' + (activeFolderObj.enabled !== false ? 'rgba(16,185,129,0.45)' : 'rgba(251,191,36,0.45)') + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div>' +
                '<div style="font-size:14px;font-weight:800;color:#fff">' + ((activeFolderObj.type === 'playlist' || activeFolderObj.isJsonPlaylist) ? '🎵 Custom Playlist: ' : '📁 Ordner: ') + esc(activeFolderObj.name) + '</div>' +
                '<div style="font-size:11.5px;color:#aaa;margin-top:2px">' +
                  'Status: <b style="color:' + (activeFolderObj.enabled !== false ? '#34d399' : '#fbbf24') + '">' + (activeFolderObj.enabled !== false ? '🟢 Eingeschaltet (In Merkliste sichtbar)' : '⚪ Ausgeschaltet (In Haupt-Merkliste ausgeblendet)') + '</b>' +
                  (activeFolderObj.sourceLabel ? ' • Quelle: ' + esc(activeFolderObj.sourceLabel) : '') +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                (activeFolderObj.linked && activeFolderObj.tmdbRefId && activeFolderObj.type === 'collection'
                  ? '<button class="btn purple" onclick="openCollectionView(' + Number(activeFolderObj.tmdbRefId) + ')">🍿 Komplette Filmreihe öffnen</button>'
                  : '') +
                (activeFolderObj.linked && activeFolderObj.tmdbRefId && activeFolderObj.type === 'universe'
                  ? '<button class="btn purple" onclick="openUniverseView(\\'' + esc(activeFolderObj.tmdbRefId) + '\\')">🌌 Komplettes Universum öffnen</button>'
                  : '') +
                '<button class="btn ' + (activeFolderObj.enabled !== false ? 'green' : 'amber') + '" onclick="togglePlaylistFolderTma(\\'' + esc(activeFolderObj.id) + '\\')">' + (activeFolderObj.enabled !== false ? '🟢 Ausschalten' : '⚪ Einschalten') + '</button>' +
                '<button class="btn" onclick="renamePlaylistFolderTma(\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(activeFolderObj.name) + '\\')">✏️ Umbenennen</button>' +
                '<button class="btn red" onclick="deletePlaylistFolderTma(\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(activeFolderObj.name) + '\\')">🗑️ Playlist löschen</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        ) : '';

        const azLetters = ["ALL", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "#"];
        const curWlLetter = String(state.wlLetter || "ALL").toUpperCase();
        const azBarHtml = '<div class="wl-az-bar" style="margin-bottom:10px">' +
          azLetters.map(ltr =>
            '<button type="button" class="wl-az-btn ' + (curWlLetter === ltr ? 'active' : '') + '" onclick="setWishlistLetter(\\'' + ltr + '\\')">' + (ltr === "ALL" ? "Alle" : ltr) + '</button>'
          ).join("") +
        '</div>';

        const quickFilterBarHtml = '<div class="panel-box" style="margin-bottom:10px;padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between">' +
          '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">' +
            '<span style="font-size:11px;font-weight:800;color:var(--text-muted)">Typ:</span>' +
            '<button class="btn ' + (state.wlFilterType === 'all' ? 'red' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickFilter(\\'all\\')">📂 Alle</button>' +
            '<button class="btn ' + (state.wlFilterType === 'm' ? 'red' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickFilter(\\'m\\')">🎬 Nur Filme</button>' +
            '<button class="btn ' + (state.wlFilterType === 's' ? 'red' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickFilter(\\'s\\')">📺 Nur Serien</button>' +
          '</div>' +
          '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">' +
            '<span style="font-size:11px;font-weight:800;color:var(--text-muted)">Sortierung:</span>' +
            '<button class="btn ' + (state.wlSort === 'added_desc' ? 'purple' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickSort(\\'added_desc\\')">🆕 Zuletzt</button>' +
            '<button class="btn ' + (state.wlSort === 'title_asc' ? 'purple' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickSort(\\'title_asc\\')">🔤 A–Z</button>' +
            '<button class="btn ' + (state.wlSort === 'year_desc' ? 'purple' : '') + '" style="padding:4px 9px;font-size:11.5px" onclick="setWishlistQuickSort(\\'year_desc\\')">📅 Jahr</button>' +
          '</div>' +
          '<input id="wishlistSearchInp" value="' + esc(state.wlSearchQuery || '') + '" oninput="onWishlistSearchInput(this.value)" placeholder="🔍 In Merkliste filtern..." style="min-width:180px;flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);background:#141418;color:#fff;font-size:12px" />' +
        '</div>';

        root.innerHTML = '<div class="section">' +
          '<div class="section-title"><span>💾 Synchronisierte Bot-Merkliste (<span id="wishlistCountSpan">' + filteredItems.length + '</span> Einträge)</span><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn green" onclick="createNewFolderPrompt(true)">➕ Neue Custom Playlist</button><button class="btn" onclick="createNewFolderPrompt(false)">📁 Neuer Ordner</button><button class="btn" onclick="goHome()">🏠 Hauptseite</button></div></div>' +
          '<div class="chip-grid" style="margin-bottom:10px">' + folderBtns + '</div>' +
          quickFilterBarHtml +
          azBarHtml +
          smartPlaylistsPanelHtml +
          activeFolderBannerHtml +
          '<div id="wishlistItemsMount"></div>' +
        '</div>';

        renderWishlistListItemsMountOnly();
      }

      async function loadWishlist(folderFilter) {
        if (folderFilter !== undefined) state.wlFolder = folderFilter;
        state.currentView = "wishlist";
        const root = document.getElementById("appRoot");
        if (!state.isAuthenticated) {
          root.innerHTML = '<div class="section">' +
            '<div class="panel-box" style="border-color:rgba(251,191,36,0.45)">' +
              '<div class="section-title"><span>🔒 Merkliste im Gast-Modus nicht verfügbar</span><button class="btn" onclick="goHome()">🏠 Hauptseite</button></div>' +
              '<p style="font-size:12.5px;color:#ddd;line-height:1.5;margin-bottom:12px">' +
                'Du nutzt die Seite aktuell <b>ohne Telegram initData und ohne eingeloggten Account</b>.<br>' +
                'Im Gast-Modus steht kein persönlicher Speicher (Merkliste) zur Verfügung und ein Zugriff auf andere Telegram-IDs ist gesperrt.' +
              '</p>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                '<button class="btn green" onclick="openAccountModal()">🔑 Mit abgesichertem Account (Username & Passwort) einloggen</button>' +
                '<button class="btn" onclick="goHome()">🎬 Weiter als Gast stöbern</button>' +
              '</div>' +
            '</div>' +
          '</div>';
          return;
        }
        setBusyState(true, "💾 Lade Merkliste & Custom Playlisten...");
        try {
          const r = await apiFetchJson(API_BASE + "/wishlist?chatId=" + encodeURIComponent(chatId));
          const allItems = r.items || [];
          const folders = r.folders || [];
          state.cachedWishlistItems = allItems;
          state.cachedWishlistFolders = folders;

          savedKeysSet.clear();
          allItems.forEach(it => {
            if (it.contentType === "movie" && it.tmdbId) savedKeysSet.add("m_" + it.tmdbId);
            else if (it.contentType === "series" && it.tmdbId) savedKeysSet.add("s_" + it.tmdbId);
          });

          renderWishlistViewDomOnly();
        } finally {
          setBusyState(false);
        }
      }

      async function createNewFolderPrompt(isPlaylist = true) {
        if (!state.isAuthenticated) { openAccountModal(); return; }
        const name = await showCustomPrompt(isPlaylist ? "🎵 Custom Name für die neue Playlist:" : "📁 Name für den neuen Merklisten-Ordner:", "");
        if (!name || !name.trim()) return;
        await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "create_folder", name: name.trim(), isPlaylist: Boolean(isPlaylist) })
        });
        showHudToast("✅ " + (isPlaylist ? "Playlist" : "Ordner") + " „" + name.trim() + "“ erstellt");
        loadWishlist(state.wlFolder);
      }

      async function togglePlaylistFolderTma(folderId) {
        if (!state.isAuthenticated) return;
        await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "toggle_playlist", folderId })
        });
        loadWishlist(state.wlFolder);
      }

      async function renamePlaylistFolderTma(folderId, currentName) {
        if (!state.isAuthenticated) return;
        const nextName = await showCustomPrompt("✏️ Neuer Custom Name für die Playlist / den Ordner:", currentName || "");
        if (!nextName || !nextName.trim()) return;
        await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "rename_playlist", folderId, name: nextName.trim() })
        });
        showHudToast("✅ Umbenannt in „" + nextName.trim() + "“");
        loadWishlist(state.wlFolder);
      }

      async function deletePlaylistFolderTma(folderId, currentName) {
        if (!state.isAuthenticated) return;
        const ok = await showCustomConfirm('Playlist "' + (currentName || folderId) + '" inklusive aller zugehörigen Einträge aus der Merkliste löschen?', '🗑️ Löschen');
        if (!ok) return;
        await apiFetchJson(API_BASE + "/wishlist", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ chatId, action: "delete_playlist", folderId })
        });
        if (state.wlFolder === folderId) state.wlFolder = "root";
        showHudToast("🗑️ Playlist gelöscht");
        loadWishlist(state.wlFolder);
      }

      async function deleteSavedUid(uid) {
        if (!state.isAuthenticated) return;
        await apiFetchJson(API_BASE + "/wishlist", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "delete_uid", uid }) });
        loadWishlist(state.wlFolder);
      }

      async function loadSettingsView() {
        state.currentView = "settings";
        updateMediaModeIndicatorDom();
        setBusyState(true, "⚙️ Lade Filter-Cockpit & Account-Einstellungen...");
        try {
          const r = await apiFetchJson(API_BASE + "/settings?chatId=" + encodeURIComponent(chatId));
          const s = r.settings || {};
          state.settings = s;
          const fskList = r.fskOptions || [];
          const genreList = r.allGenres || [];
          const eraList = r.eraOptions || [];
          const studioList = r.studioOptions || [];
          const platformList = r.platformOptions || [];
          const sync = s.tmdbSync || {};
          const root = document.getElementById("appRoot");

          if (state.sidebarOpen) renderFilterSidebarContent();

          const isAuth = Boolean(state.isAuthenticated && state.authUser);
          const u = state.authUser || {};
          const prevSettingsFocusDfId = (typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.getAttribute)
            ? currentSpatialEl.getAttribute("data-df-id")
            : null;

          root.innerHTML = '<div class="section">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
              '<button class="btn red" onclick="goHome()" style="padding:8px 14px;font-size:12.5px">⬅️ Zurück zur Übersicht (' + (state.type === 's' ? '📺 Serien' : '🎬 Filme') + ')</button>' +
              '<span style="font-size:12px;font-weight:800;color:var(--text-muted)">⚙️ Einstellungen & Filter-Cockpit</span>' +
            '</div>' +
            '<div class="panel-box" style="border-color:rgba(91,70,245,0.45)">' +
              '<div class="section-title">' +
                '<span>🔐 Account & Sicherheit (' + (isAuth ? ('Verbunden: ID ' + esc(u.telegramId)) : '👤 Gast-Modus ohne Speicher') + ')</span>' +
                '<div style="display:flex;gap:6px">' +
                  (u.isAdmin ? '<button class="btn amber" onclick="loadAdminPanelView()">👑 Admin-Panel</button>' : '') +
                  '<button class="btn purple" onclick="openAccountModal()">🔑 ' + (isAuth ? (u.hasPasswordAccount ? 'Zugangsdaten verwalten' : 'Account mit Passwort absichern') : 'Jetzt einloggen') + '</button>' +
                '</div>' +
              '</div>' +
              '<p style="font-size:12px;color:var(--text-muted);line-height:1.5">' +
                (isAuth
                  ? (u.hasPasswordAccount
                      ? '✅ Dein Account ist als <b>' + esc(u.customUsername) + '</b> mit Passwort abgesichert. Du kannst dich von jedem Gerät und Browser (auch ohne Telegram <code>initData</code>) einloggen.'
                      : '💡 Du bist über Telegram <code>initData</code> eingeloggt. Lege jetzt einen <b>Username & Passwort</b> fest, damit du dich künftig auch außerhalb von Telegram von überall einloggen kannst!')
                  : '⚠️ Ohne Telegram <code>initData</code> und ohne Account-Login bist du im Gast-Modus (kein Merklisten-Speicher, kein Zugriff auf fremde IDs).') +
              '</p>' +
            '</div>' +

            (function() {
              const deliv = getDeliveryPreferencesClient();
              const dMode = deliv.targetMode || "dm";
              const customHookUrl = window.location.origin + "/api/telegram/custom-webhook" + (deliv.customBotToken ? ("?botToken=" + encodeURIComponent(deliv.customBotToken)) : "");
              return '<div class="panel-box" style="border-color:rgba(56,189,248,0.45)">' +
                '<div class="section-title">' +
                  '<span>📤 Standard-Versandziel, Gruppen-Delivery & Eigener Bot (TelegramIntegration)</span>' +
                  '<span style="font-size:11px;color:#38bdf8;font-weight:800">Tipp: /id in Gruppe zeigt Chat-ID</span>' +
                '</div>' +
                '<p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:8px">' +
                  'Bestimme, wohin Filme & Serien standardmäßig gesendet werden: in deinen <b>💬 Bot-Privatchat</b>, in eine <b>👥 eigene Ziel-Gruppe</b> oder über deinen <b>🤖 eigenen Telegram-Bot-Token</b>. ' +
                  'Wenn der Bot Mitglied deiner Quellgruppe (aus <code>result.json</code>) ist, löst er Dateien automatisch per <code>copyMessage</code> auf und speichert die File-ID in D1!' +
                '</p>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
                  '<button class="btn ' + (dMode === 'dm' ? 'blue' : '') + '" onclick="saveDeliveryPreferencesClient({targetMode:\\'dm\\'});loadSettingsView()">💬 Standard: Bot-Privatchat</button>' +
                  '<button class="btn ' + (dMode === 'group' ? 'blue' : '') + '" onclick="saveDeliveryPreferencesClient({targetMode:\\'group\\'});loadSettingsView()">👥 Standard: Eigene Ziel-Gruppe</button>' +
                  '<button class="btn ' + (dMode === 'custom_bot' ? 'purple' : '') + '" onclick="saveDeliveryPreferencesClient({targetMode:\\'custom_bot\\'});loadSettingsView()">🤖 Standard: Eigener Bot-Token</button>' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:10px">' +
                  '<div>' +
                    '<div style="font-size:11px;color:#cbd5e1;margin-bottom:3px">👥 Ziel-Gruppen Chat-ID (z.B. -100...):</div>' +
                    '<input id="settingsTargetGroupIdInp" value="' + esc(deliv.targetGroupChatId || '') + '" placeholder="-1001234567890" style="width:100%;padding:7px 9px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px" />' +
                  '</div>' +
                  '<div>' +
                    '<div style="font-size:11px;color:#cbd5e1;margin-bottom:3px">🧵 Topic / Thread-ID in Ziel-Gruppe (optional):</div>' +
                    '<input id="settingsTargetTopicIdInp" value="' + esc(deliv.targetTopicId || '') + '" placeholder="z.B. 42" style="width:100%;padding:7px 9px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px" />' +
                  '</div>' +
                  '<div>' +
                    '<div style="font-size:11px;color:#cbd5e1;margin-bottom:3px">📦 Quellgruppen-ID (Bridge für result.json):</div>' +
                    '<input id="settingsSourceBridgeIdInp" value="' + esc(deliv.sourceBridgeChatId || '') + '" placeholder="Auto (-100...) oder überschreiben" style="width:100%;padding:7px 9px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px" />' +
                  '</div>' +
                  '<div>' +
                    '<div style="font-size:11px;color:#cbd5e1;margin-bottom:3px">🤖 Eigenes Bot-Token (@BotFather, optional):</div>' +
                    '<input id="settingsCustomBotTokenInp" type="password" value="' + esc(deliv.customBotToken || '') + '" placeholder="123456789:ABCdef..." style="width:100%;padding:7px 9px;border-radius:6px;background:#14141c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px" />' +
                  '</div>' +
                '</div>' +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                  '<button class="btn green" onclick="verifyAndConnectCustomBotInSettingsClient()">💾 Speichern & optionalen Bot-Webhook verbinden</button>' +
                  '<span style="font-size:11px;color:#94a3b8">Webhook-Endpunkt: <code>' + esc(customHookUrl) + '</code></span>' +
                '</div>' +
                '<div id="customBotVerifyStatus" style="font-size:12px;color:#38bdf8;margin-top:6px">' +
                  (deliv.customBotUsername ? ('✅ Aktiver eigener Bot: @' + esc(deliv.customBotUsername)) : '') +
                '</div>' +
                '<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1)">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
                    '<div>' +
                      '<div style="font-size:12px;font-weight:800;color:#f8fafc">🧹 Retention Policy (KV-Performance & Log-Aufbewahrung)</div>' +
                      '<div style="font-size:11px;color:#94a3b8">Bereinigt Zustell- & Fehler-Logs älter als 7, 30 oder 90 Tage automatisch via KV <code>expirationTtl</code>.</div>' +
                    '</div>' +
                    '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
                      '<button type="button" class="btn ' + (Number(deliv.retentionDays || 30) === 7 ? 'blue' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setTmaRetentionPolicyClient(7)">7 Tage</button>' +
                      '<button type="button" class="btn ' + (Number(deliv.retentionDays || 30) === 30 ? 'blue' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setTmaRetentionPolicyClient(30)">30 Tage</button>' +
                      '<button type="button" class="btn ' + (Number(deliv.retentionDays || 30) === 90 ? 'blue' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setTmaRetentionPolicyClient(90)">90 Tage</button>' +
                      '<button type="button" class="btn" style="padding:4px 8px;font-size:11px;color:#fb7185" onclick="clearTmaActivityLogClient()" title="Alle gespeicherten Telegram-Zustelllogs in KV sofort löschen">🗑️ Log leeren</button>' +
                    '</div>' +
                  '</div>' +
                  '<div style="font-size:10.5px;color:#38bdf8;margin-bottom:6px">⚡ Aktive KV-TTL: <code>' + (Number(deliv.retentionDays || 30) * 86400) + 's</code> (' + Number(deliv.retentionDays || 30) + ' Tage Auto-Prune in <code>env.MY_KV</code>)</div>' +
                  '<div id="tmaActivityLogMount"><div style="font-size:11px;color:#64748b">Lade letzte Zustell-Aktivitäten...</div></div>' +
                '</div>' +
              '</div>' +
              buildAntiSpamCockpitBoxHtmlClient();
            })() +

            '<div class="panel-box" style="border-color:rgba(16,185,129,0.45)">' +
              '<div class="section-title">' +
                '<span>🧭 Steuerung, Maus-Hover & Slider-Einstellungen</span>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:8px">' +
                '<button id="settingsMouseHoverNavBtn" class="btn ' + (mouseHoverNavEnabled ? 'green' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleMouseHoverNav()">' +
                  '<span>🖱️ Maus-Hover Navigation (Mauszeiger verschiebt Auswahl)</span>' +
                  '<b>' + (mouseHoverNavEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>' +
                '</button>' +
                '<button id="settingsModalHoldNavBtn" class="btn ' + (modalHoldNavEnabled ? 'green' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleModalHoldNav()">' +
                  '<span>⏩ Detailansicht: Pfeiltaste ⬅️/➡️ gedrückt halten (~450ms) für nächsten/vorherigen Titel</span>' +
                  '<b>' + (modalHoldNavEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>' +
                '</button>' +
                '<button id="settingsHeroToggleBtn" class="btn ' + (!state.heroHidden ? 'green' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleHeroSliderHidden()">' +
                  '<span>🎬 Empfehlungs-Slider auf der Startseite</span>' +
                  '<b>' + (state.heroHidden ? 'AUSGEBLENDET' : 'SICHTBAR') + '</b>' +
                '</button>' +
              '</div>' +
            '</div>' +

            '<div class="panel-box" style="border-color:rgba(56,189,248,0.45)">' +
              '<div class="section-title">' +
                '<span>⚡ Telegram-Bot Schnellbefehls-Übersicht (Cheat-Sheet #22)</span>' +
                '<span style="font-size:11px;color:#38bdf8;font-weight:800">f = Film • s = Serie</span>' +
              '</div>' +
              '<p style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Nutze diese Kurzbefehle jederzeit direkt im Telegram-Bot-Chat (optional auch mit Genre dahinter, z. B. <code>/t f Action</code>):</p>' +
              '<div class="shortcut-cheat-grid">' +
                '<div class="shortcut-cheat-card"><b>🔥 Trending (Filme & Serien)</b><code>/t f   • /trnd f   • /trend f   • /trending f</code><br><code>/t s   • /trnd s   • /trend s   • /trending s</code></div>' +
                '<div class="shortcut-cheat-card"><b>🌟 Populär / Beliebt</b><code>/p f   • /pop f    • /popular f • /populär f</code><br><code>/p s   • /pop s    • /popular s • /populär s</code></div>' +
                '<div class="shortcut-cheat-card"><b>💎 Geheimtipps (Secret Gems)</b><code>/sc f  • /sec f    • /secret f  • /geheim f</code><br><code>/sc s  • /sec s    • /secret s  • /geheim s</code></div>' +
                '<div class="shortcut-cheat-card"><b>🎲 Zufalls-Tipp (mit Genre optional)</b><code>/r f   • /rand f   • /random f  • /r f Action</code><br><code>/r s   • /rand s   • /random s  • /r s Sci-Fi</code></div>' +
              '</div>' +
            '</div>' +

            '<div class="panel-box" style="border-color:rgba(229,9,20,0.45)">' +
              '<div class="section-title">' +
                '<span>🎬 Instant-Trailer Provider (Direktwiedergabe aus der Übersicht)</span>' +
                '<span style="font-size:11.5px;color:var(--accent-primary);font-weight:800">Aktiv: ' + esc(getTrailerProviderLabel(trailerProvider)) + '</span>' +
              '</div>' +
              '<p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Wähle deinen bevorzugten Video-Anbieter, wenn du auf einer Film-/Serienkarte direkt auf <b>▶ Trailer</b> tippst:</p>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                TRAILER_PROVIDERS_CLIENT.map(tp =>
                  '<button class="btn ' + (trailerProvider === tp.id ? 'red' : '') + '" onclick="setTrailerProvider(\\'' + esc(tp.id) + '\\');loadSettingsView()">' + esc(tp.label) + (trailerProvider === tp.id ? ' ✓ Standard' : '') + '</button>'
                ).join("") +
              '</div>' +
            '</div>' +
            '<div class="panel-box">' +
              '<div class="section-title"><span>🛡️ Bot-Filter Cockpit (Steuerung über ✓ Positiv & ✕ Negativ)</span>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                  '<button class="btn red" onclick="restartApp()">🗑️ Alle Filter zurücksetzen</button>' +
                  '<button class="btn" onclick="goHome()">🏠 Zur Hauptseite</button>' +
                '</div>' +
              '</div>' +
              '<p style="font-size:12px;color:#aaa;margin-bottom:10px">Filter lassen sich gezielt über <b>✓ (Positiv)</b> und <b>✕ (Negativ)</b> schalten (der Text selbst ist nicht auswählbar). Ist ein Filter aktiv, gibt dessen Auswahl direkt <b>○ Neutral</b> vor, während daneben die Gegenoption wählbar bleibt.</p>' +
              (isCurrentUserVip() ? (
                '<div style="font-size:12.5px;font-weight:700;margin:8px 0 6px;color:#fbbf24">🌟 Exklusiver VIP-Stream Filter (#13):</div>' +
                '<div class="direct-filter-grid" style="margin-bottom:10px">' +
                  renderDirectFilterOptionCard("vip_streams", "vip_streams", "🌟 Nur Titel mit verfügbarem VIP-Stream", Boolean(s.onlyVipStreams), false) +
                '</div>'
              ) : '') +
              '<div style="font-size:12.5px;font-weight:700;margin:10px 0 6px">📺 Streaming-Plattformen:</div>' +
              '<div class="direct-filter-grid">' + platformList.map(pl => {
                const inc = (s.includedPlatforms || []).includes(pl.id);
                const ex = (s.excludedPlatforms || []).includes(pl.id);
                return renderDirectFilterOptionCard("platform", pl.id, esc((pl.icon || "📺") + " " + pl.label), inc, ex);
              }).join("") + '</div>' +
              '<div style="font-size:12.5px;font-weight:700;margin:12px 0 6px">🎞️ Genres:</div>' +
              '<div class="direct-filter-grid">' + genreList.map(g => {
                const inc = (s.includedGenres || []).includes(g);
                const ex = (s.excludedGenres || []).includes(g);
                return renderDirectFilterOptionCard("genre", g, genreEmoji(g) + " " + esc(g), inc, ex);
              }).join("") + '</div>' +
              '<div style="font-size:12.5px;font-weight:700;margin:12px 0 6px">📅 Erscheinungsjahre / Epochen:</div>' +
              '<div class="direct-filter-grid">' + eraList.map(e => {
                const inc = (s.includedEras || []).includes(e.id);
                const ex = (s.excludedEras || []).includes(e.id);
                return renderDirectFilterOptionCard("era", e.id, "📅 " + esc(e.label), inc, ex);
              }).join("") + '</div>' +
              '<div style="font-size:12.5px;font-weight:700;margin:12px 0 6px">🏢 Filmstudios:</div>' +
              '<div class="direct-filter-grid">' + studioList.map(st => {
                const inc = (s.includedStudios || []).includes(st.id);
                const ex = (s.excludedStudios || []).includes(st.id);
                return renderDirectFilterOptionCard("studio", st.id, esc((st.icon || "🏢") + " " + st.label), inc, ex);
              }).join("") + '</div>' +
              '<div style="font-size:12.5px;font-weight:700;margin:12px 0 6px">🔞 FSK-Altersfreigaben & Unveröffentlichte:</div>' +
              '<div class="direct-filter-grid">' + fskList.map(f => {
                const inc = (s.includedFsk || []).includes(f);
                const ex = (s.excludedFsk || []).includes(f);
                return renderDirectFilterOptionCard("fsk", f, "🔞 " + esc(f), inc, ex);
              }).join("") +
              renderDirectFilterOptionCard("unreleased", "unreleased", "🗓️ Unveröffentlicht", Boolean(s.showUnreleased), false) +
              '</div>' +
            '</div>' +
            (isAuth ? (
              '<div class="panel-box">' +
                '<div class="section-title"><span>🌐 Optionale TMDB-Konto Synchronisierung</span>' +
                  (sync.enabled ? '<span style="color:#34d399;font-size:12px">✅ Verbunden als ' + esc(sync.username || 'TMDB-User') + '</span>' : '<span style="color:#aaa;font-size:12px">Optional</span>') +
                '</div>' +
                '<p style="font-size:12px;color:#aaa;margin-bottom:10px">Verbinde optional dein persönliches TheMovieDB-Konto, um deine TMDB-Watchlist & Favoriten automatisch mit deiner Bot-Merkliste zu synchronisieren.</p>' +
                (sync.enabled ? (
                  '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                    '<button class="btn green" onclick="runTmdbSyncNow()">🔄 Jetzt Watchlist & Favoriten synchronisieren</button>' +
                    '<button class="btn red" onclick="disconnectTmdbSync()">🔌 TMDB-Verbindung trennen</button>' +
                  '</div>'
                ) : (
                  '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                    '<button class="btn red" onclick="startTmdbAuth()">🔗 1. Mit TMDB verbinden (Login öffnen)</button>' +
                    (state.pendingTmdbToken ? '<button class="btn green" onclick="completeTmdbAuth()">✅ 2. Nach Freigabe hier bestätigen</button>' : '') +
                  '</div>'
                )) +
                '<div id="tmdbSyncStatus" style="font-size:12px;color:#fbbf24;margin-top:8px"></div>' +
              '</div>'
            ) : '') +
          '</div>';
          if (typeof loadTmaActivityLogPreviewClient === "function") {
            loadTmaActivityLogPreviewClient();
          }
          if (typeof pollAntiSpamQueueClient === "function") {
            pollAntiSpamQueueClient(true);
          }
          if (prevSettingsFocusDfId && typeof CSS !== "undefined" && CSS.escape) {
            const restoredEl = root.querySelector('[data-df-id="' + CSS.escape(prevSettingsFocusDfId) + '"]');
            if (restoredEl) setSpatialFocus(restoredEl, false);
          }
        } finally {
          setBusyState(false);
        }
      }

      // =========================================================================
      // ADMIN-PANEL: USER-LISTE, VIP-STATUS TOGGLE, SMART PLAYLIST MANAGER, FILM-CRUD & 100K+ BACKUP-IMPORTER
      // =========================================================================
      let backupImportJob = {
        fileName: "",
        fileSizeMb: "0",
        isTelegramBackup: false,
        backupChatName: "",
        backupChatId: "",
        backupChatUsername: "",
        rawMessageCount: 0,
        repaired: false,
        repairNotes: [],
        detectedMoviesCount: 0,
        detectedSeriesCount: 0,
        duplicatesSkippedInFile: 0,
        qualityVariantsInFile: 0,
        previewSamples: [],
        customPlaylistName: "",
        playlistMode: "both",
        targetPlaylistChatId: "",
        playlistFolderId: "",
        entries: [],
        cursor: 0,
        moviesSaved: 0,
        seriesSaved: 0,
        duplicatesInDb: 0,
        mergedQualitiesInDb: 0,
        uncertainCount: 0,
        failedCount: 0,
        running: false,
        paused: false,
        startedAt: 0,
        recentLog: [],
        livePosterFeed: [],
        reviewItems: [],
        activeSubTab: "dashboard",
        reviewFilter: "needs_attention"
      };

      function flattenClientTgText(tf) {
        if (!tf) return "";
        if (typeof tf === "string") return tf.trim();
        if (Array.isArray(tf)) {
          return tf.map(p => typeof p === "string" ? p : (p && typeof p.text === "string" ? p.text : "")).join("").trim();
        }
        return "";
      }

      function normalizeClientCompareTitle(str) {
        return String(str || "")
          .toLowerCase()
          .replace(/ä/g, "ae")
          .replace(/ö/g, "oe")
          .replace(/ü/g, "ue")
          .replace(/ß/g, "ss")
          .replace(/[^a-z0-9\\s]/g, " ")
          .replace(/\\b(?:der|die|das|the|a|an|ein|eine)\\b/g, " ")
          .replace(/\\s+/g, " ")
          .trim();
      }

      const CLIENT_SERIES_ALIASES = {
        "ahs": "American Horror Story",
        "adtdwv": "Als die Tiere den Wald verließen",
        "gzsz": "Gute Zeiten, schlechte Zeiten",
        "dsds": "Deutschland sucht den Superstar",
        "gntm": "Germany's Next Topmodel",
        "jacob 2 2": "Jacob 2/2",
        "ps profis": "Die PS-Profis",
        "die ps profis": "Die PS-Profis",
        "axel wills wissen": "Axel! will's wissen",
        "axel will's wissen": "Axel! will's wissen",
        "axel! wills wissen": "Axel! will's wissen",
        "maxe baumann": "Maxe Baumann",
        "buffy": "Buffy the Vampire Slayer",
        "himym": "How I Met Your Mother",
        "got": "Game of Thrones",
        "twd": "The Walking Dead",
        "tbbt": "The Big Bang Theory",
        "haus des geldes": "Money Heist",
        "stawaepideauskywa1080": "Star Wars: Der Aufstieg Skywalkers",
        "stawaepideauskywa": "Star Wars: Der Aufstieg Skywalkers",
        "pso bw bd": "Black Widow",
        "pso-bw bd": "Black Widow",
        "pso bw": "Black Widow",
        "saw 1": "Saw",
        "saw 1 - wessen blut wird fliessen": "Saw",
        "saw 1 - wessen blut wird fließen": "Saw",
        "saw 7": "Saw 3D - Vollendung",
        "saw 7 - vollendung": "Saw 3D - Vollendung",
        "saw 7 vollendung": "Saw 3D - Vollendung",
        "kingsman 3 the beginning": "The King's Man: The Beginning",
        "kingsman 3 - the beginning": "The King's Man: The Beginning",
        "kingsman 3": "The King's Man: The Beginning",
        "pirates of the caribbean 3": "Pirates of the Caribbean - Am Ende der Welt",
        "pirates of the caribbean 4": "Pirates of the Caribbean - Fremde Gezeiten",
        "fluch der karibik 3": "Pirates of the Caribbean - Am Ende der Welt",
        "fluch der karibik 4": "Pirates of the Caribbean - Fremde Gezeiten",
        "professor t": "Professor T.",
        "9 1 2 wochen": "9½ Wochen",
        "9 1/2 wochen": "9½ Wochen"
      };

      function detectClientVideoQuality(msg, rawText, rawFileName) {
        const w = Number(msg?.width || msg?.video?.width || 0);
        const h = Number(msg?.height || msg?.video?.height || 0);
        if (w > 0 || h > 0) {
          if (w >= 3800 || h >= 2100) return "2160p";
          if (w >= 1900 || h >= 1000) return "1080p";
          if (w >= 1200 || h >= 700)  return "720p";
          if (w >= 600  || h >= 340)  return "480p";
          return "360p";
        }
        const combined = ((rawText || "") + " " + (rawFileName || "")).toLowerCase();
        if (/\\b(2160p|4k|uhd)\\b/.test(combined)) return "2160p";
        if (/\\b(1080p|fhd|fullhd)\\b/.test(combined)) return "1080p";
        if (/\\b(720p|hd)\\b/.test(combined)) return "720p";
        if (/\\b(480p|576p|sd|dvdrip)\\b/.test(combined)) return "480p";
        return null;
      }

      function getCleanClientContentLines(normalizedText) {
        return String(normalizedText || "")
          .split(/\\r?\\n/)
          .map(l => l.trim())
          .filter(l => {
            if (!l) return false;
            if (/^(?:weitergeleitet|forwarded|kanal|channel|quelle|source|join|abonniert)\\b/i.test(l)) return false;
            const stripped = l
              .replace(/https?:\\/\\/\\S+/gi, "")
              .replace(/[@#][A-Za-z0-9_äöüÄÖÜß]+/g, "")
              .replace(/[\\u{1F1E6}-\\u{1F1FF}]{2}/gu, "")
              .replace(/[^A-Za-z0-9äöüÄÖÜß]/g, "");
            return stripped.length >= 2;
          });
      }

      function classifyClientJunkReason(msg) {
        if (!msg || typeof msg !== "object") return "🎭 Ungültige Nachricht übersprungen";
        if (msg.type && msg.type !== "message") return "🎭 Service-Nachricht übersprungen";
        const mType = String(msg.media_type || "").toLowerCase();
        if (mType === "sticker" || mType === "animation" || mType === "voice_message" || mType === "audio_file" || mType === "video_message") {
          return "🎭 Sticker / Animation / Sprachnachricht übersprungen";
        }
        const fName = String(msg.file_name || msg.file || "").toLowerCase().trim();
        if (fName === "sticker.webp" || fName.endsWith(".webp") || fName.endsWith(".tgs") || fName.endsWith(".gif.mp4") || fName.endsWith(".gif")) {
          return "🎭 Sticker / GIF-Animation übersprungen";
        }
        // .rar und .partXX.rar sind als eigene Kategorie ("📦 RAR-Archiv") erlaubt!
        if (/\\.rar$/i.test(fName)) {
          return null;
        }
        // Untertitel (.srt, .vtt, .sub, .ass, .ssa) werden NICHT als Junk verworfen, sondern an das darüberliegende Video gebunden!
        if (/\\.(?:srt|vtt|sub|ass|ssa)$/i.test(fName)) {
          return null;
        }
        if (/\\.(?:idx|mp3|m4a|flac|ogg|wav|opus|aac|apk|exe|msi|dmg|iso|pdf|epub|mobi|txt|nfo|jpg|jpeg|png|zip|7z|tar|gz)$/i.test(fName)) {
          return "📄 Dokument / PDF / Audio / Bilddatei übersprungen";
        }
        const dur = Number(msg.duration_seconds || msg.duration || 0);
        const isVid = mType === "video_file" || /^video\\//i.test(msg.mime_type || "") || /\\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d)$/i.test(fName);
        const rawCap = flattenClientTgText(msg.text || msg.caption).slice(0, 160);
        const hasTrailerKeyword = /(?:^|[\\s._\\-(\\[])(?:kinotrailer|official\\s+trailer|offizieller\\s+trailer|teaser\\s+trailer|trailer|teaser|coming\\s+soon|zwiastun|vorschau)(?=$|[\\s._\\-)\\]:])/i.test(fName) ||
          /^(?:trailer|teaser|coming\\s+soon)\\b/i.test(rawCap);
        if (hasTrailerKeyword && (!dur || dur < 900)) {
          return "🎬 Trailer / Teaser / Coming Soon übersprungen";
        }
        // Videos ohne "Trailer" im Namen sind ab 60 Sekunden erlaubt (rettet Star Wars: Die Mächte des Schicksals & One Piece Strohhut Theater!)
        if (isVid && dur > 0 && dur < 60) {
          return "🎭 Kurzclip (< 60s) übersprungen";
        }
        return null;
      }

      function isClientJunkOrSticker(msg) {
        return Boolean(classifyClientJunkReason(msg));
      }

      function extractClientPartInfo(rawText, rawFileName, durationSec = 0) {
        const rawFnStr = String(rawFileName || "").trim();
        const combinedRaw = (rawFnStr + " " + String(rawText || "")).trim();
        const isRar = /\\.rar$/i.test(rawFnStr) || /\\.part\\d+\\.rar\\b/i.test(combinedRaw);
        if (isRar) {
          const rarPartMatch = combinedRaw.match(/(?:\\.part|\\bpart)[\\s._-]*0*([1-9]\\d?)\\b/i);
          if (rarPartMatch) {
            const num = parseInt(rarPartMatch[1], 10);
            return { isMultiPart: true, isArchive: true, partNumber: num, partType: "RAR", partLabel: "RAR-PART" + num };
          }
          return { isMultiPart: false, isArchive: true, partNumber: 1, partType: "RAR", partLabel: "RAR" };
        }
        const fn = rawFnStr.replace(/(?:\\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d))+$/i, "");
        const combined = (fn + " " + String(rawText || "")).trim();
        const cdMatch = combined.match(/\\b(CD|Disc|Disk|DVD)[\\s._-]*0*([1-9])\\b/i);
        if (cdMatch) {
          const prefix = cdMatch[1].toUpperCase() === "DISK" ? "DISC" : cdMatch[1].toUpperCase();
          const num = parseInt(cdMatch[2], 10);
          return { isMultiPart: true, isArchive: false, partNumber: num, partType: prefix, partLabel: prefix + num };
        }
        const splitMatch = fn.match(/(?:[-_.]|\\s)00([1-9])$/);
        if (splitMatch) {
          const num = parseInt(splitMatch[1], 10);
          return { isMultiPart: true, isArchive: false, partNumber: num, partType: "SPLIT", partLabel: "SPLIT" + num };
        }
        const partMatch = combined.match(/\\bPart[\\s._-]*0*([1-9])\\b/i);
        if (partMatch && (!durationSec || durationSec < 5000)) {
          const num = parseInt(partMatch[1], 10);
          return { isMultiPart: true, isArchive: false, partNumber: num, partType: "PART", partLabel: "PART" + num };
        }
        return null;
      }

      function normalizeClientEpisodeText(str) {
        if (!str) return "";
        let s = String(str)
          .replace(/%26/gi, "&")
          .replace(/%20/g, " ")
          .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
          .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
        s = Array.from(s).map(ch => {
          return (ch.charCodeAt(0) > 127 && !"äöüÄÖÜßéèêàáâóòôúùûíìîçñøåÆØÅ–—„“”’´‧·".includes(ch))
            ? ch.normalize("NFKD")
            : ch;
        }).join("");
        s = s.replace(/[\\p{Script=Arabic}\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF،؛؟]+/gu, " ")
          .replace(/󠄿/g, "")
          .replace(/_/g, " ")
          .replace(/[\\u00A0 \\t]+/g, " ");
        // Regel 1: Episoden-Muster in S01E01 umwandeln
        s = s.replace(/\\b(?:Staffel|Season)\\s*0*(\\d{1,2})\\s*(?:[-–,·‧:|\\/]|\\s)+\\s*(?:Folge|Episode|Ep\\.?)\\s*0*(\\d{1,3})(?!\\s*[-–]\\s*\\d{1,3})\\b/gi, (_, st, ep) => "S" + String(st).padStart(2, "0") + "E" + String(ep).padStart(2, "0"));
        s = s.replace(/\\bS0*(\\d{1,2})\\s*[-–]\\s*E0*(\\d{1,3})\\b/gi, (_, st, ep) => "S" + String(st).padStart(2, "0") + "E" + String(ep).padStart(2, "0"));
        s = s.replace(/\\bS0*(\\d{1,2})\\s+E0*(\\d{1,3})\\b/gi, (_, st, ep) => "S" + String(st).padStart(2, "0") + "E" + String(ep).padStart(2, "0"));
        s = s.replace(/(?<![\\d.])\\b0*(\\d{1,2})x0*(\\d{2,3})\\b(?![\\d.])/gi, (_, st, ep) => {
          const stNum = parseInt(st, 10);
          const epNum = parseInt(ep, 10);
          if (stNum >= 1 && stNum <= 40 && epNum >= 1 && epNum <= 250) {
            return "S" + String(stNum).padStart(2, "0") + "E" + String(epNum).padStart(2, "0");
          }
          return _;
        });
        // E01S01 / E01S02 strikt umkehren (E01 ist Episode 1, S02 ist Staffel 2 -> S$2E$1)
        s = s.replace(/\\bE0*(\\d{1,3})[\\s._-]*S0*(\\d{1,2})\\b/gi, (_, epNum, sNum) => {
          const season = parseInt(sNum, 10) || 1;
          const episode = parseInt(epNum, 10) || 1;
          return "S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0");
        });
        // Mittelpunkt-Episodenschema: "Maxe Baumann · 01 Ferien ohne Ende" -> "Maxe Baumann S01E01 Ferien ohne Ende"
        s = s.replace(/([A-Za-zÄÖÜäöüß]{2,})\\s+[·‧•]\\s+0*(\\d{1,2})\\s+([A-Za-zÄÖÜäöüß])/g, (_, name, ep, nextChar) => {
          return name + " S01E" + String(ep).padStart(2, "0") + " " + nextChar;
        });
        // "Strohhut Theater 1 - Chopper Man" -> "Strohhut Theater S01E01 - Chopper Man" & "Folgen 1 - 10" -> "S01E01-E10"
        s = s.replace(/\\b(Strohhut[\\s._-]+Theater)[\\s._-]+0*([1-9]\\d?)\\b/gi, (_, name, ep) => {
          return name + " S01E" + String(parseInt(ep, 10)).padStart(2, "0");
        });
        s = s.replace(/\\b(?:Folgen|Folge|Episoden|Episodes)[\\s._-]*0*(\\d{1,3})\\s*[-–]\\s*0*(\\d{1,3})\\b/gi, (_, ep1, ep2) => {
          return "S01E" + String(parseInt(ep1, 10)).padStart(2, "0") + "-E" + String(parseInt(ep2, 10)).padStart(2, "0");
        });
        return s;
      }

      function cleanClientMediaTitle(raw) {
        if (!raw) return "";
        let t = normalizeClientEpisodeText(raw)
          .replace(/(?:\\.part0*\\d{1,2})?(?:\\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d|rar|json))+$/i, "");
        t = t.replace(/\\(\\s*\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\s*\\)/g, " ");
        t = t.replace(/\\b\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\b/g, " ");
        if ((t.match(/\\./g) || []).length >= 2 && !t.includes(" ")) {
          t = t.replace(/\\./g, " ");
        }
        t = t.replace(/\\b(?:ger|deu|german|deutsch|eng|english|englisch|jap|jpn|fr|fra|es|spa|it|ita|tr|tur|ru|rus)[\\s._-]+(?:ger|deu|eng|jap|jpn|fr|es|it|tr|ru)[\\s._-]+(?:sub|subs|dub|dubbed)\\b/gi, " ");
        t = t.replace(/\\b(?:ger|deu|german|deutsch|eng|english|englisch|jap|jpn|japanisch|fr|fra|es|spa|it|ita|tr|tur|ru|rus)[\\s._-]+(?:sub|subs|ut|untertitel|dub|dubbed|forced)\\b/gi, " ");
        t = t.replace(/(?:AC3|AAC|DTS|DD5\\.?1)?[\\s._-]*(?:CD|Disc|Disk|DVD)[\\s._-]*0*[1-9]\\b/gi, " ");
        t = t.replace(/(?:^|[\\s._\\-(])Part[\\s._-]*0*([1-9]\\d?)(?:$|[\\s._\\-)])/gi, " ");
        t = t.replace(/(?:[-_.]|\\s)00[1-9]$/g, " ");
        t = t.replace(/[\\u{1F1E6}-\\u{1F1FF}]{2}/gu, "");
        t = t.replace(/[《》«»⟨⟩]/g, " ");
        t = t.replace(/^[🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎➡️▶️🍿⭐️❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️\\s]+/gu, "");
        t = t.replace(/[↩️🔠🔢⤴️⬅️➡️🎦]+.*$/gu, "");
        t = t.replace(/[\\p{Emoji_Presentation}\\p{Extended_Pictographic}🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎🩸❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️]/gu, " ");
        t = t.replace(/@[A-Za-z0-9_]+/g, "");
        t = t.replace(/#(?:gutfilm|archemovie|filmwelt|weltderfilme|sauerkraut|hd|fullhd|fhd|uhd|4k|1080p|720p|480p|deutsch|german|kino|serie|serien|film|filme|neu|new|stream|download|vip|ov|omu|horror|action|comedy|thriller|drama|scifi|fantasy|anime)\\b/gi, " ");
        t = t.replace(/#(?=[A-Za-zÄÖÜäöüß0-9])/g, " ");
        t = t.replace(/s[\\._]to\\s*-?\\s*Serien.*/i, "").replace(/Sto\\s*-\\s*Serien.*/i, "");
        t = t.replace(/serien[\\._](?:life|show).*/i, "").replace(/HD\\s*Filme\\s*Serien.*/i, "");
        t = t.replace(/^(?:Title|Titel)\\s*:\\s*/i, "").replace(/^(?:vs-|cd-|spy-|d-|4sf-|arc-|tvp-)/i, "");
        t = t.replace(/^(?:s\\d{1,2}[\\s._-]*e\\d{1,3}|e\\d{1,3}[\\s._-]*s\\d{1,2}|\\d{1,2}x\\d{1,3})\\b[\\s._\\-–:]*/i, "");
        t = t.replace(/\\bS\\d{1,2}\\s*E\\d{0,3}(?=[A-Za-z]|\\b)/gi, " ");
        t = t.replace(/\\b\\d{3,4}\\s*[x×]\\s*\\d{3,4}\\b/g, "");
        t = t.replace(/\\b(?:super[\\s._-]*duper[\\s._-]*cut|extended[\\s._-]*director'?s?[\\s._-]*cut|(?:extended|director'?s?|director’s|theatrical|ultimate|final|special|unrated|uncut|recut|producer'?s?|television|tv|fan|snyder|remastered|restored|collector'?s?|collector’s|anniversary|limited|deluxe|diamond|platinum|imax|open[\\s._-]*matte|international|rough|workprint)[\\s._-]*(?:cut|edition|version|fassung|ed\\.?)|(?:kino|lang|kurz|fernseh|tv|schnitt|rohschnitt|farb|original|alternativ|jubiläums|jubilaeums|directors|extended|uncut|unrated)[\\s._-]*(?:fassung|version|edition|cut)|(?:4k[\\s._-]*)?(?:digitally[\\s._-]*)?(?:remastered|restored)|mastered[\\s._-]*in[\\s._-]*4k|open[\\s._-]*matte|3d|hsbs|sbs|hou)\\b/gi, " ");
        t = t.replace(/\\b(1080p|720p|2160p|480p|4k|uhd|h265|h264|x264|x265|hevc|av1|10bit|de-en|en-de|de-fr|fr-de|de-es|es-de|de-it|it-de|de-tr|tr-de|de-ru|ru-de|de-ja|de-jp|german|deutsch|germany|deu|ger|englisch|english|eng|französisch|franzoesisch|french|fra|fre|vff|vf|spanisch|spanish|spa|esp|castellano|latino|italienisch|italian|ita|türkisch|tuerkisch|turkish|tur|russisch|russian|rus|japanisch|japanese|jap|jpn|koreanisch|korean|kor|dl|dual[\\s._-]*audio|dual|multi|multilang|(?<!world\\s+wide\\s+)web|web-dl|webrip|bluray|bdrip|dvdrip|remux|fullhd|fhd|microhd(?:\\s*720|\\s*1080)?|hd|sd|dt__ov|dt[\\s._-]*ov|ov|omu|omeu|oton|originalton|gerdub|engdub|japdub|gersub|engsub|softsub|hardsub|subbed|forced|germanforced|extended[\\s._-]*cut|director'?s?[\\s._-]*cut|theatrical[\\s._-]*cut|ultimate[\\s._-]*cut|final[\\s._-]*cut|special[\\s._-]*(?:cut|edition)|collector'?s?[\\s._-]*edition|extended[\\s._-]*(?:edition|version)|uncut[\\s._-]*(?:edition|version)?|unrated[\\s._-]*(?:cut|edition|version)?|farbfassung|langfassung|kinofassung|fernsehfassung|schnittfassung|remastered|restored|uncut|unrated|extended|recut|ac3|aac|6ch|limited|mp4|mkv|avi|m4v|flv|mk3d|archemovie|gutfilm|filmwelt|weltderfilme|sauerkraut|wayne|wvf|dollhead|empir|tvnation|contribution|vivo|watch)\\b/gi, " ");
        t = t.replace(/[\\(\\[]\\s*(?:the\\s+)?(?:cut|dc|edition|version|fassung)\\s*[\\)\\]]/gi, " ");
        t = t.replace(/[\\(\\[]\\s*(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s*[\\)\\]]/gi, " ");
        t = t.replace(/^(.{2,}?)\\s+(?:[-–:]\\s*)?(?:the\\s+)?(?:cut|edition|version|fassung|redux)\\s*$/i, "$1");
        t = t.replace(/\\s*[-–:]\\s*(?:the|der|die|das)\\s*$/i, "");
        t = t.replace(/(?:[\\(\\[_-]\\s*(?:DE|EN|FR|ES|IT|TR|RU|JA|KO)\\s*[\\)\\]]?|\\s+(?:DE|EN|FR|ES|IT|TR|RU|JA|KO)(?=\\s*$))/g, " ");
        t = t.replace(/^(?:\\d{1,4}\\.\\s+|0\\d\\s*[-–]\\s+)/, "").replace(/-\\d{3}$/, "");
        t = t.replace(/\\(\\s*\\)|\\[\\s*\\]/g, "");
        t = t.replace(/\\s+/g, " ").replace(/^[\\s\\-–·‧:.,#"=|⎪&]+|[\\s\\-–·‧:.,#"=|⎪&]+$/g, "");
        if (/^(?:[A-Za-zÄÖÜäöüß]\\s+){3,}[A-Za-zÄÖÜäöüß]$/.test(t)) {
          t = t.replace(/\\s+/g, "");
        }
        t = t.replace(/\\b([A-Za-zÄÖÜäöüß]{3,})\\s+\\1\\b/gi, "$1");
        const openParens = (t.match(/\\(/g) || []).length;
        const closeParens = (t.match(/\\)/g) || []).length;
        if (openParens > closeParens) t = t.replace(/\\(/g, "");
        if (closeParens > openParens) t = t.replace(/\\)/g, "");
        t = t.replace(/\\s+/g, " ").trim();
        if (!/[A-Za-zÄÖÜäöüß0-9]/.test(t)) return "";
        if (/^(?:video|vmp4|new+|file|clip|movie|stream)$/i.test(t)) return "";
        const lower = t.toLowerCase();
        if (CLIENT_SERIES_ALIASES[lower]) return CLIENT_SERIES_ALIASES[lower];
        const prefixKey = lower.split(/\\s*[-–]\\s*/)[0];
        if (CLIENT_SERIES_ALIASES[prefixKey]) return CLIENT_SERIES_ALIASES[prefixKey];
        return t;
      }

      function parseClientMediaPreview(rawFilenameOrTitle, durationSec = 0, msgObj = null) {
        const raw = String(rawFilenameOrTitle || "").trim();
        const rawCapText = msgObj && typeof msgObj === "object" ? String(msgObj.raw_text || msgObj.text || msgObj.caption || "") : "";
        const isRarArchive = /\\.rar$/i.test(raw) || /\\.rar$/i.test(String(msgObj?.raw_file_name || msgObj?.file_name || "")) || /\\.part\\d+\\.rar\\b/i.test(raw + " " + rawCapText);
        let withoutExt = normalizeClientEpisodeText(raw).replace(/(?:\\.part0*\\d{1,2})?(?:\\.(?:mp4|mkv|avi|mov|webm|m4v|ts|flv|wmv|mk3d|rar|json))+$/i, "");
        withoutExt = withoutExt.replace(/\\(\\s*\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\s*\\)/g, " ").replace(/\\b\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\b/g, " ");
        let quality = detectClientVideoQuality(msgObj, withoutExt, raw);
        let codec = isRarArchive ? "RAR" : "x264";
        const cm = !isRarArchive ? withoutExt.match(/\\b(x265|h\\.?265|hevc|x264|h\\.?264|avc|av1)\\b/i) : null;
        if (cm) {
          const cLow = cm[1].toLowerCase().replace(/\\./g, "");
          codec = (cLow === "x265" || cLow === "h265" || cLow === "hevc") ? "x265" : (cLow === "av1" ? "AV1" : "x264");
        }
        const pInfo = extractClientPartInfo(rawCapText || raw, String(msgObj?.raw_file_name || msgObj?.file_name || raw), durationSec);
        let part = pInfo ? pInfo.partLabel : null;

        let isSeries = false;
        let season = null;
        let episode = null;
        let episodeTitle = "";
        let explicitTitle = null;

        const hashStaffelFull = withoutExt.match(/^(.+?)[_\\s]*#[_\\s]*S(\\d{1,2})E(\\d{1,3})[_\\s]*(?:[#\\-–]+[_\\s]*)(.+)$/i) ||
                                withoutExt.match(/^(.+?)[_\\s]*#[_\\s]*Staffel[_\\s]*(\\d{1,2})[_\\s,.\\-]*(?:Folge|Episode)[_\\s]*(\\d{1,3})[_\\s]*(?:[#\\-–]+[_\\s]*)(.+)$/i);
        const archeMatch = withoutExt.match(/^S(\\d{1,2})E(\\d{1,3})\\s*[-–]\\s*@\\w+\\s*[-–]\\s*(.+)$/i);
        const hashStaffelMatch = withoutExt.match(/^#?\\s*S(\\d{1,2})E(\\d{1,3})\\s*[-–]\\s*(.+)$/i);
        const epStaffelVonMatch = withoutExt.match(/(?:Episode|Folge)[\\s._]*(\\d{1,3})(?:[\\s._\\-&]+\\d{1,3})?[\\s._\\-]*(?:\\(?Staffel[\\s._]*(\\d{1,2})\\)?)?[\\s._\\-]*von[\\s._]*(.+?)(?:[\\s._]+(?:s[_. ]to|Sto|serien|HD|Online|❤)|$)/i);
        const seMatch = withoutExt.match(/\\bS(\\d{1,2})[\\s._-]*E(\\d{1,3})(?:[-–]E?(\\d{1,3}))?\\b/i);

        let cutIdx = withoutExt.length;
        if (hashStaffelFull) {
          isSeries = true;
          season = parseInt(hashStaffelFull[2], 10) || 1;
          episode = parseInt(hashStaffelFull[3], 10) || 1;
          episodeTitle = cleanClientMediaTitle(hashStaffelFull[1]);
          explicitTitle = hashStaffelFull[4];
        } else if (archeMatch) {
          isSeries = true;
          season = parseInt(archeMatch[1], 10) || 1;
          episode = parseInt(archeMatch[2], 10) || 1;
          explicitTitle = archeMatch[3];
        } else if (hashStaffelMatch) {
          isSeries = true;
          season = parseInt(hashStaffelMatch[1], 10) || 1;
          episode = parseInt(hashStaffelMatch[2], 10) || 1;
          explicitTitle = hashStaffelMatch[3];
        } else if (epStaffelVonMatch) {
          isSeries = true;
          episode = parseInt(epStaffelVonMatch[1], 10) || 1;
          season = epStaffelVonMatch[2] ? parseInt(epStaffelVonMatch[2], 10) : 1;
          explicitTitle = epStaffelVonMatch[3];
        } else if (seMatch) {
          isSeries = true;
          season = parseInt(seMatch[1], 10) || 1;
          episode = parseInt(seMatch[2], 10) || 1;
          const afterRaw = withoutExt.slice(seMatch.index + seMatch[0].length).replace(/^[\\s._\\-–:·‧|⎪=]+/, "");
          if (seMatch.index === 0) {
            // Fall E01S01 Frontier 2016: S01E01 steht am Anfang, danach folgt der Serienname (+ ggf. Jahr)
            withoutExt = afterRaw;
            cutIdx = withoutExt.length;
            explicitTitle = afterRaw;
          } else {
            if (afterRaw) {
              const eqMatch = afterRaw.match(/^=\\s*([^=]+?)\\s*=/);
              episodeTitle = cleanClientMediaTitle(eqMatch ? eqMatch[1] : afterRaw);
            }
            if (typeof seMatch.index === "number" && seMatch.index > 1) {
              cutIdx = Math.min(cutIdx, seMatch.index);
            }
          }
        } else {
          const epOnly = withoutExt.match(/\\b(?:Folge|Episode|Ep\\.?)\\s*0*(\\d{1,3})\\b/i);
          if (epOnly) {
            isSeries = true;
            season = 1;
            episode = parseInt(epOnly[1], 10) || 1;
            if (typeof epOnly.index === "number" && epOnly.index > 1) cutIdx = Math.min(cutIdx, epOnly.index);
          } else if (durationSec <= 0 || durationSec <= 4200) {
            // Fall Black Box 1 bis 4: Kurze Videos (<= 4200s) mit Endziffer (1..24) ohne Jahreszahl in Klammern
            const strippedTrailingQual = withoutExt.replace(/\\b(?:1080p|720p|2160p|480p|4k|uhd|x264|x265|h264|h265|hevc|ger|deu|german|deutsch|web-dl|webrip|bluray|hd|mp4|mkv|avi)\\b/gi, " ").trim();
            const trailingNumMatch = strippedTrailingQual.match(/^([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9\\s._\\-]{2,40}?)\\s+0*([1-9]|1\\d|2[0-4])\\s*$/);
            if (trailingNumMatch && !/\\b(?:19\\d{2}|20[0-2]\\d)\\b/.test(strippedTrailingQual) && !/\\b(?:part|teil|cd|disc|dvd)\\b/i.test(strippedTrailingQual)) {
              const candBase = cleanClientMediaTitle(trailingNumMatch[1]);
              if (candBase && candBase.length >= 3 && !/^(?:iron man|thor|avengers|matrix|john wick|shrek|toy story|cars|fast|furious|hangover|rambo|rocky|creed|mad max|spider man|batman|superman|deadpool|guardians|men in black|rush hour|bad boys|oceans|expendables|transporter|taken|equalizer|punisher|blade|underworld|resident evil|alien|predator|terminator|jurassic|indiana jones|star wars|harry potter|herr der ringe|hobbit|fluch der karibik|mission impossible|james bond|bourne|twilight|tribute von panem|maze runner|divergent|pitch perfect|step up|scary movie|american pie|final destination|saw|scream|conjuring|insidious|paranormal|purge|halloween|freitag der|nightmare|hellraiser|chucky|annabelle|nun|sinister|troll|ip man|ong bak|raid|undisputed|goal|hooligans|manta|fack ju|ostwind|bibi|conni|schule der magischen|vorstadtkrokodile|wilde kerle|fünf freunde|tkkg|drei fragezeichen)$/i.test(candBase)) {
                isSeries = true;
                season = 1;
                episode = parseInt(trailingNumMatch[2], 10) || 1;
                explicitTitle = candBase;
              }
            }
          }
        }

        let year = null;
        const parenYm = (" " + withoutExt + " ").match(/[(\\[\\s]*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s+)?[\(\[]\\s*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s+)?(19[2-9]\\d|20[0-2]\\d)\\s*[\)\]]/i);
        const ym = parenYm || (" " + withoutExt + " ").match(/(?:[(\\[\\-\\s_.·‧])(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s+)?(?<!\\d{1,2}[./-]\\d{1,2}[./-])(19[2-9]\\d|20[0-2]\\d)(?![.\\d])(?:[)\\]\\s._\\-·‧]|$)/i);
        if (ym) {
          year = parseInt(ym[1], 10);
          if (!explicitTitle && typeof ym.index === "number" && ym.index > 2) cutIdx = Math.min(cutIdx, ym.index - 1);
        }

        let titleCand = explicitTitle ? explicitTitle : (withoutExt.slice(0, cutIdx).trim() || withoutExt);
        if (year) {
          titleCand = titleCand
            .replace(new RegExp("[(\\\\[]\\\\s*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\\\s+)?" + year + "\\\\s*[)\\\\]]", "gi"), " ")
            .replace(new RegExp("\\\\b" + year + "\\\\b", "g"), " ");
        }
        let cleanTitle = cleanClientMediaTitle(titleCand) || "Unbekannt";
        const jacobMatch = cleanTitle.match(/^(Jacob\\s*2[\\s/_]*2)\\s+(und\\s+.+)$/i);
        if (jacobMatch) cleanTitle = "Jacob 2/2";

        return { cleanTitle, year, isSeries, isArchive: isRarArchive, season, episode, episodeTitle, quality, codec, part };
      }

      function repairAndParseClientBackupJson(rawText) {
        const repairNotes = [];
        let text = String(rawText || "").replace(/^\\uFEFF/, "").replace(/\\0/g, "").trim();
        if (!text) return { ok: false, parsed: null, repaired: false, repairNotes: ["Datei ist leer"] };

        // Stufe 1: Direktes JSON.parse
        try {
          return { ok: true, parsed: JSON.parse(text), repaired: false, repairNotes: [] };
        } catch (firstErr) {
          let cleaned = text;
          const firstBracket = cleaned.search(/[\\{\\[]/);
          const lastBrace = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
          if (firstBracket > 0 || (lastBrace !== -1 && lastBrace < cleaned.length - 1)) {
            cleaned = cleaned.slice(Math.max(0, firstBracket), lastBrace !== -1 ? lastBrace + 1 : cleaned.length);
            repairNotes.push("Überflüssiger Text vor/nach JSON entfernt");
          }
          const noTrailingCommas = cleaned.replace(/,\\s*([\\}\\]])/g, "$1");
          if (noTrailingCommas !== cleaned) {
            repairNotes.push("Trailing Commas korrigiert");
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
            if (escNext) { escNext = false; continue; }
            if (ch === "\\\\" && inStr) { escNext = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (!inStr) {
              if (ch === "{" || ch === "[") {
                if (depth === 0) startIdx = i;
                depth++;
              } else if (ch === "}" || ch === "]") {
                depth--;
                if (depth === 0 && startIdx !== -1) {
                  const blockStr = noTrailingCommas.slice(startIdx, i + 1);
                  try { blocks.push(JSON.parse(blockStr)); } catch (eb) {}
                  startIdx = -1;
                } else if (depth < 0) {
                  depth = 0;
                  startIdx = -1;
                }
              }
            }
          }

          if (blocks.length > 0) {
            repairNotes.push("Mehrteilige JSON-Blöcke (" + blocks.length + " Segmente) zusammengeführt");
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
                  if (item && (item.type === "message" || item.file_name || item.text || item.media_type)) combinedMessages.push(item);
                  else combinedItems.push(item);
                }
              } else if (blk && typeof blk === "object") {
                if (blk.type === "message" || blk.file_name || (blk.id && blk.text)) combinedMessages.push(blk);
                else combinedItems.push(blk);
              }
            }
            if (combinedMessages.length > 0) {
              return { ok: true, parsed: { name: combinedChatName || "Telegram Export (Repariert)", messages: combinedMessages }, repaired: true, repairNotes };
            }
            return { ok: true, parsed: combinedItems, repaired: true, repairNotes };
          }

          // Stufe 3: NDJSON / Zeilenweises JSON
          const lines = text.split(/\\r?\\n/).map(l => l.trim()).filter(Boolean);
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
            repairNotes.push("Zeilenweises JSON / NDJSON (" + lineObjs.length + " Zeilen) repariert");
            const looksLikeTg = lineObjs.some(o => o && (o.type === "message" || o.file_name || o.media_type || o.text));
            return {
              ok: true,
              parsed: looksLikeTg ? { name: "Telegram Export (NDJSON)", messages: lineObjs } : lineObjs,
              repaired: true,
              repairNotes
            };
          }

          // Stufe 4: Notfall-Objekt-Scanner für abgeschnittene result.json Dateien
          const nameMatch = text.match(/"name"\\s*:\\s*"([^"]+)"/);
          const recoveredChatName = nameMatch ? nameMatch[1] : "Repariertes Telegram-Backup";
          const recoveredMsgs = [];
          const msgRegex = /\\{[^{}]*"(?:file_name|file|text|title|filename|media_type)"[^{}]*\\}/g;
          let mMatch;
          while ((mMatch = msgRegex.exec(noTrailingCommas)) !== null) {
            try { recoveredMsgs.push(JSON.parse(mMatch[0])); } catch (em) {}
          }
          if (recoveredMsgs.length > 0) {
            repairNotes.push("Beschädigte JSON-Struktur repariert (" + recoveredMsgs.length + " Nachrichten rekonstruiert)");
            return { ok: true, parsed: { name: recoveredChatName, messages: recoveredMsgs }, repaired: true, repairNotes };
          }

          return { ok: false, parsed: null, repaired: false, repairNotes: [firstErr.message] };
        }
      }

      function deduplicateAndClassifyClientEntries(rawCandidates) {
        const entries = [];
        const seenExactKeys = new Set();
        const seenFileIds = new Set();
        const seenWorkKeys = new Set();
        let duplicatesSkippedInFile = 0;
        let qualityVariantsInFile = 0;
        let detectedMoviesCount = 0;
        let detectedSeriesCount = 0;
        const previewSamples = [];

        for (let i = 0; i < rawCandidates.length; i++) {
          const item = rawCandidates[i];
          if (!item) continue;
          const rawStr = typeof item === "string"
            ? item
            : String(item.filename || item.file_name || item.title || item.name || "").trim();
          if (!rawStr || rawStr.length < 2) continue;

          // .rar und .partXX.rar sind als eigene Kategorie ("📦 RAR-Archiv") erlaubt!
          if (/\\.(zip|7z|tar|gz|iso|exe|apk|pdf|txt|nfo|srt|sub|webp|tgs|gif|mp3|m4a|flac|ogg|wav)$/i.test(rawStr) || /\\.gif\\.mp4$/i.test(rawStr)) {
            continue;
          }

          const durationSec = (typeof item === "object" && item !== null)
            ? Number(item.duration_sec || item.duration_seconds || item.duration || 0)
            : 0;
          const parsed = parseClientMediaPreview(rawStr, durationSec, typeof item === "object" ? item : null);
          if (typeof item === "object" && item !== null) {
            if (item.cleanTitle && item.cleanTitle !== "Unbekannt") {
              parsed.cleanTitle = cleanClientMediaTitle(String(item.cleanTitle)) || String(item.cleanTitle);
            }
            if (item.type === "series" || item.type === "tv" || item.isSeries || item.season || item.episode) {
              parsed.isSeries = true;
              parsed.season = Number(item.season || parsed.season || 1);
              parsed.episode = Number(item.episode || parsed.episode || 1);
            }
            if (item.episodeTitle) parsed.episodeTitle = String(item.episodeTitle);
            if (item.year) parsed.year = Number(item.year);
            if (item.width || item.height) {
              parsed.quality = detectClientVideoQuality(item, item.raw_text || "", rawStr);
            } else if (item.quality !== undefined) {
              parsed.quality = item.quality ? String(item.quality) : null;
            }
            if (item.part) parsed.part = String(item.part);
            if (item.codec) parsed.codec = String(item.codec);
            if (item.isArchive) parsed.isArchive = true;
          }

          const normTitle = normalizeClientCompareTitle(parsed.cleanTitle);
          if (!normTitle || normTitle === "unbekannt") continue;

          const fileId = (typeof item === "object" && (item.telegram_file_id || item.file_id || item.fileId))
            ? String(item.telegram_file_id || item.file_id || item.fileId)
            : "";
          if (fileId && seenFileIds.has(fileId)) {
            duplicatesSkippedInFile++;
            continue;
          }

          const fileSizeBytes = (typeof item === "object" && item !== null)
            ? Number(item.file_size || item.fileSize || 0)
            : 0;
          const rawFileNameKey = (typeof item === "object" && item !== null)
            ? String(item.raw_file_name || item.file_name || item.rawInput || rawStr).trim().toLowerCase()
            : rawStr.trim().toLowerCase();
          const partSuffix = String(parsed.part || "").toUpperCase();

          const workKey = normTitle + "|" + (parsed.year || "") + "|" + (parsed.isSeries ? ("s_" + (parsed.season || 1) + "_" + (parsed.episode || 1)) : "m");
          // Ohne Telegram file_id gilt ein Eintrag NUR als exaktes Duplikat, wenn Dateigröße + Dauer + Dateiname + Part 100% übereinstimmen (CD2 & RAR-PART2 werden nie verworfen!)
          const exactKey = (fileSizeBytes > 0 || durationSec > 0)
            ? ("file|" + rawFileNameKey + "|sz:" + fileSizeBytes + "|dur:" + durationSec + "|part:" + partSuffix)
            : (workKey + "|" + String(parsed.quality || "UNBEKANNT").toUpperCase() + "|" + String(parsed.codec || "x264").toUpperCase() + "|part:" + partSuffix + "|" + rawFileNameKey);

          if (seenExactKeys.has(exactKey)) {
            duplicatesSkippedInFile++;
            continue;
          }
          seenExactKeys.add(exactKey);
          if (fileId) seenFileIds.add(fileId);

          const isQualityVariant = seenWorkKeys.has(workKey);
          if (isQualityVariant) {
            qualityVariantsInFile++;
          } else {
            seenWorkKeys.add(workKey);
            if (parsed.isSeries) detectedSeriesCount++;
            else detectedMoviesCount++;
          }

          const entryObj = typeof item === "object" && item !== null
            ? {
                ...item,
                filename: rawStr,
                rawInput: item.rawInput || rawStr,
                cleanTitle: parsed.cleanTitle,
                year: parsed.year,
                isSeries: parsed.isSeries,
                isArchive: Boolean(parsed.isArchive || item.isArchive),
                season: parsed.season,
                episode: parsed.episode,
                episodeTitle: parsed.episodeTitle || item.episodeTitle || "",
                quality: parsed.quality,
                codec: parsed.codec,
                part: parsed.part,
                tags: parsed.isArchive ? "📦 RAR-Archiv" : (item.tags || ""),
                isQualityVariant
              }
            : {
                filename: rawStr,
                rawInput: rawStr,
                cleanTitle: parsed.cleanTitle,
                year: parsed.year,
                isSeries: parsed.isSeries,
                isArchive: Boolean(parsed.isArchive),
                season: parsed.season,
                episode: parsed.episode,
                episodeTitle: parsed.episodeTitle || "",
                quality: parsed.quality,
                codec: parsed.codec,
                part: parsed.part,
                tags: parsed.isArchive ? "📦 RAR-Archiv" : "",
                isQualityVariant
              };

          entries.push(entryObj);
          if (previewSamples.length < 8) {
            previewSamples.push({
              cleanTitle: parsed.cleanTitle,
              year: parsed.year || "k.A.",
              isSeries: parsed.isSeries,
              season: parsed.season,
              episode: parsed.episode,
              quality: parsed.isArchive ? "📦 RAR" : (parsed.quality || "Auto"),
              isQualityVariant
            });
          }
        }

        return {
          entries,
          duplicatesSkippedInFile,
          qualityVariantsInFile,
          detectedMoviesCount,
          detectedSeriesCount,
          previewSamples
        };
      }

      function buildClientPrevMsgSummary(m) {
        if (!m || typeof m !== "object") return null;
        const txt = flattenClientTgText(m.text || m.caption || m.text_entities);
        const fName = String(m.file_name || "").trim();
        const combined = [txt, fName].filter(Boolean).join(" | ").slice(0, 320);
        if (!combined && !m.photo) return null;
        let tmdbId = null;
        let mediaType = null;
        const tmdbMatch = combined.match(/themoviedb\\.org\\/(movie|tv)\\/(\\d+)/i);
        if (tmdbMatch) {
          mediaType = tmdbMatch[1].toLowerCase() === "tv" ? "tv" : "movie";
          tmdbId = parseInt(tmdbMatch[2], 10);
        }
        const firstLine = (txt.split(/\\r?\\n/).map(l => l.trim()).filter(Boolean)[0] || fName || "").slice(0, 120);
        const parsedGuess = parseClientMediaPreview(firstLine, 0, m);
        return {
          msgId: m.id || null,
          date: m.date || null,
          hasPhoto: Boolean(m.photo),
          text: combined || (m.photo ? "[Poster / Bild-Nachricht]" : ""),
          titleGuess: parsedGuess.cleanTitle && parsedGuess.cleanTitle !== "Unbekannt" ? parsedGuess.cleanTitle : "",
          yearGuess: parsedGuess.year || null,
          tmdbId,
          mediaType
        };
      }

      function extractClientPreContextFromMsg(msg, currentPre) {
        if (isClientJunkOrSticker(msg)) return currentPre || {};
        const isPhoto = Boolean(msg.photo || msg.media_type === "photo" || /^image\\//i.test(msg.mime_type || ""));
        const txt = normalizeClientEpisodeText(flattenClientTgText(msg.text || msg.caption || msg.text_entities));
        const hasLinks = Array.isArray(msg.text_entities) && msg.text_entities.some(e => e && (e.href || e.url || e.type === "link"));
        // Fall 1 (Frontier ID 111): Leeres Foto setzt den vorherigen Serien-/Film-Kontext zurück!
        if (isPhoto && !txt && !hasLinks) {
          return { lastMessageId: Number(msg.id || 0) };
        }
        const ctx = (isPhoto && txt)
          ? { lastMessageId: Number(msg.id || 0) }
          : (currentPre ? { ...currentPre, lastMessageId: Number(msg.id || currentPre.lastMessageId || 0) } : { lastMessageId: Number(msg.id || 0) });
        if (!txt && !hasLinks) return ctx;

        if (Array.isArray(msg.text_entities)) {
          for (const ent of msg.text_entities) {
            const href = ent.href || (ent.type === "link" ? ent.text : "") || "";
            const tm = String(href).match(/themoviedb\\.org\\/(movie|tv)\\/(\\d+)/i);
            if (tm) {
              ctx.mediaType = tm[1].toLowerCase() === "tv" ? "tv" : "movie";
              ctx.tmdbId = parseInt(tm[2], 10);
              if (ctx.mediaType === "movie") delete ctx.seriesHeader;
            }
            const im = String(href).match(/imdb\\.com\\/title\\/(tt\\d+)/i);
            if (im) ctx.imdbId = im[1];
            if (String(href).includes("vorschauserien")) ctx.isSeriesHeader = true;
          }
        }
        const rawTm = txt.match(/themoviedb\\.org\\/(movie|tv)\\/(\\d+)/i);
        if (rawTm && !ctx.tmdbId) {
          ctx.mediaType = rawTm[1].toLowerCase() === "tv" ? "tv" : "movie";
          ctx.tmdbId = parseInt(rawTm[2], 10);
        }
        const rawIm = txt.match(/imdb\\.com\\/title\\/(tt\\d+)/i);
        if (rawIm && !ctx.imdbId) ctx.imdbId = rawIm[1];

        const seasonHeaderMatch = txt.match(/\\bStaffel[\\s._-]*0*(\\d{1,2})\\b/i);
        if (seasonHeaderMatch) {
          ctx.season = parseInt(seasonHeaderMatch[1], 10) || 1;
          ctx.isSeriesHeader = true;
        }

        const tMatch = txt.match(/(?:🎬\\s*)?(?:Titel|Title|Film|Serie)\\s*:\\s*([^\\n]+)/i);
        if (tMatch) {
          ctx.title = cleanClientMediaTitle(tMatch[1]);
          if (!seasonHeaderMatch && !ctx.isSeriesHeader) {
            delete ctx.seriesHeader;
          }
        }
        const oMatch = txt.match(/Originaltitel\\s*:\\s*([^\\n]+)/i);
        if (oMatch) ctx.originalTitle = cleanClientMediaTitle(oMatch[1]);
        const yMatch = txt.match(/(?:Erscheinungsjahr|Jahr|Release)\\s*:\\s*.*?(19\\d{2}|20[0-2]\\d)/i);
        if (yMatch) ctx.year = parseInt(yMatch[1], 10);

        const lines = getCleanClientContentLines(txt);
        // Video schlägt Header (Breaking Bad S03E01 Fix): Auch wenn msg.media_type === "video_file", Serien-/Staffel-Header in den Kontext übernehmen!
        if (lines.length >= 1 && !tMatch) {
          const firstLine = lines[0];
          const isYoutubeOrUrlOnly = /^(?:https?:\\/\\/|www\\.|youtu\\.be\\/|youtube\\.com\\/)/i.test(firstLine.trim()) || /(?:youtu\\.be\\/|youtube\\.com\\/watch)/i.test(firstLine);
          if (isYoutubeOrUrlOnly) {
            return ctx;
          }
          if (/\\b\\d+\\s+Folgen\\s+in\\s+\\d+\\s+Staffel/i.test(firstLine) && ctx.seriesHeader) {
            return ctx;
          }
          if (ctx.isSeriesHeader || /\\b(?:Staffel\\s+\\d+|Miniserie|\\d+\\/\\d+\\s*Folgen|\\d+\\s+Folgen\\s+in\\s+\\d+\\s+Staffel)/i.test(txt)) {
            const ymHeader = (" " + txt.slice(0, 120) + " ").match(/(?:[(\\[\\-\\s_.·‧])(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s+)?(?<!\\d{1,2}[./-]\\d{1,2}[./-])(19[2-9]\\d|20[0-2]\\d)(?![.\\d])(?:[)\\]\\s._\\-·‧]|$)/i);
            if (ymHeader && !ctx.year) ctx.year = parseInt(ymHeader[1], 10);
            const hClean = cleanClientMediaTitle(firstLine.replace(/Staffel\\s*\\d+.*/i, "").replace(/\\b(19[2-9]\\d|20[0-2]\\d)\\b/g, " "));
            if (hClean) {
              ctx.seriesHeader = hClean;
              ctx.isSeriesHeader = true;
              delete ctx.title;
              delete ctx.tmdbId;
            }
          } else if (!msg.file_name && msg.media_type !== "video_file") {
            const headSlice = txt.slice(0, 110);
            const ym = (" " + headSlice + " ").match(/(?:[(\\[\\-\\s_.·‧])(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s+)?(?<!\\d{1,2}[./-]\\d{1,2}[./-])(19[2-9]\\d|20[0-2]\\d)(?![.\\d])(?:[)\\]\\s._\\-·‧]|$)/i);
            if (ym && ym.index > 2) {
              ctx.year = parseInt(ym[1], 10);
              const tGuess = cleanClientMediaTitle(firstLine.replace(/\\b(19[2-9]\\d|20[0-2]\\d)\\b/g, " "));
              if (tGuess) {
                ctx.title = tGuess;
                ctx.seriesHeader = tGuess;
              }
            }
          }
        }
        return ctx;
      }

      function detectAndParseClientBackupJson(parsedJson, fileName = "result.json", fileSizeBytes = 0, repairMeta = null) {
        let tgMessages = null;
        let backupChatName = "";
        let backupChatId = "";
        let backupChatUsername = "";
        if (Array.isArray(parsedJson?.messages)) {
          tgMessages = parsedJson.messages;
          backupChatName = String(parsedJson.name || parsedJson.title || ("Chat #" + (parsedJson.id || "Backup")));
          if (parsedJson.id) backupChatId = String(parsedJson.id);
          if (parsedJson.username) backupChatUsername = String(parsedJson.username);
        } else if (Array.isArray(parsedJson?.chats?.list)) {
          tgMessages = [];
          for (const ch of parsedJson.chats.list) {
            if (Array.isArray(ch?.messages)) {
              if (!backupChatName && ch.name) backupChatName = ch.name;
              if (!backupChatId && ch.id) backupChatId = String(ch.id);
              if (!backupChatUsername && ch.username) backupChatUsername = String(ch.username);
              for (const m of ch.messages) tgMessages.push(m);
            }
          }
          if (!backupChatName) backupChatName = "Telegram Multi-Chat Export";
        }

        if (Array.isArray(tgMessages)) {
          // 1. Chronologische Sortierung vor dem Loop erzwingen (Id aufsteigend)
          tgMessages.sort((a, b) => Number(a?.id || a?.message_id || 0) - Number(b?.id || b?.message_id || 0));

          const rawCandidates = [];
          const clientPreLogs = [];
          const metaPrefixRegex = /^(?:Qualität|Quality|Genre|FSK|Jahr|Release|Bewertung|Rating|Audio|Sprache|Dauer|Laufzeit|Regie|Darsteller|Cast|Handlung|Inhalt|Beschreibung|Plot|Info|Größe|Size|Format|Codec|Quelle|Source|Link|Download|Stream|Kanal|Channel)\\s*[:\\-]/i;

          let rollingPreContext = {};

          for (let i = 0; i < tgMessages.length; i++) {
            const msg = tgMessages[i];
            if (!msg || (msg.type && msg.type !== "message")) continue;
            const currentMsgId = Number(msg.id || msg.message_id || 0);
            const junkReason = classifyClientJunkReason(msg);
            if (junkReason) {
              if (clientPreLogs.length < 350) {
                clientPreLogs.push({
                  msgId: currentMsgId || null,
                  fileName: String(msg.file_name || msg.media_type || "Sticker/Junk"),
                  rawText: flattenClientTgText(msg.text || msg.caption).slice(0, 140),
                  status: "SKIPPED_JUNK",
                  reason: junkReason,
                  detectedType: "junk",
                  parsedTitle: ""
                });
              }
              continue;
            }
            if (rollingPreContext.lastMessageId && currentMsgId > 0 && Math.abs(currentMsgId - rollingPreContext.lastMessageId) > 25) {
              rollingPreContext = {};
            }

            const rawFileName = String(msg.file_name || "").trim();
            const rawFilePath = String(msg.file || "").trim();
            const validFilePath = rawFilePath && !rawFilePath.startsWith("(File not included")
              ? rawFilePath.split("/").pop()
              : "";

            const flatTextRaw = flattenClientTgText(msg.text || msg.caption || msg.text_entities);
            const flatText = normalizeClientEpisodeText(flatTextRaw);
            const normFileName = normalizeClientEpisodeText(rawFileName || validFilePath);
            // 2. Eiserne Regel ("Video schlägt Header") + eigene Kategorie für .rar-Archive + Untertitel-Bindung (.srt/.vtt/.sub):
            const isSubMsg = /\\.(?:srt|vtt|sub|ass|ssa)$/i.test(rawFileName || validFilePath);
            if (isSubMsg) {
              const targetVideo = rawCandidates.length > 0 ? rawCandidates[rawCandidates.length - 1] : null;
              if (targetVideo) {
                if (!Array.isArray(targetVideo.subtitle_files)) targetVideo.subtitle_files = [];
                const subMsgId = msg.id || msg.message_id || null;
                const subFid = msg.telegram_file_id || msg.file_id || (backupChatId && subMsgId ? ("tg_export_" + backupChatId + "_" + subMsgId) : null);
                const subLangMatch = (rawFileName || validFilePath || flatTextRaw).match(/\\b(de|ger|german|deutsch|en|eng|english|forced)\\b/i);
                targetVideo.subtitle_files.push({
                  file_id: subFid,
                  file_name: rawFileName || validFilePath || "subtitle.srt",
                  lang: subLangMatch ? subLangMatch[1].toUpperCase() : "UT",
                  message_id: subMsgId,
                  chat_id: backupChatId || null
                });
              }
              continue;
            }
            const isRarMsg = /\\.rar$/i.test(rawFileName || validFilePath);
            const isVideoMsg =
              msg.media_type === "video_file" ||
              Boolean(msg.video) ||
              /^video\\//i.test(msg.mime_type || "") ||
              /\\.(?:mp4|mkv|avi|mov|m4v|webm|ts|flv|mk3d)$/i.test(rawFileName || validFilePath);
            const isPhotoMsg = !isVideoMsg && !isRarMsg && Boolean(msg.photo || msg.media_type === "photo" || /^image\\//i.test(msg.mime_type || ""));

            // Wenn eine Videodatei oder RAR-Datei anhängt UND gleichzeitig ein Staffel-/Serien-Header im Text steht (Breaking Bad S03E01 Fix):
            // Aktualisiere zuerst den rollingPreContext, aber brich NIEMALS mit continue ab!
            if (isVideoMsg || isRarMsg) {
              const hasHeaderCue = /\\b(?:Staffel\\s*\\d+|vorschauserien|Miniserie|\\d+\\s+Folgen\\s+in\\s+\\d+\\s+Staffel)/i.test(flatText) ||
                (Array.isArray(msg.text_entities) && msg.text_entities.some(e => String(e?.href || "").includes("vorschauserien")));
              if (hasHeaderCue) {
                rollingPreContext = extractClientPreContextFromMsg(msg, rollingPreContext);
              }
            } else if (!rawFileName && !validFilePath) {
              rollingPreContext = extractClientPreContextFromMsg(msg, rollingPreContext);
              if (isPhotoMsg) {
                if (clientPreLogs.length < 350) {
                  clientPreLogs.push({
                    msgId: currentMsgId || null,
                    fileName: "Foto/Poster-Header",
                    rawText: flatTextRaw.slice(0, 140),
                    status: "SKIPPED_HEADER",
                    reason: "Serien-/Film-Poster als Vorab-Kontext gespeichert (" + (rollingPreContext.seriesHeader || rollingPreContext.title || "Reset") + ")",
                    detectedType: "header",
                    parsedTitle: rollingPreContext.seriesHeader || rollingPreContext.title || ""
                  });
                }
                continue;
              }
            }

            const prevMessages = [];
            if (Array.isArray(msg._prevMessages) && msg._prevMessages.length > 0) {
              for (const pm of msg._prevMessages.slice(-2)) {
                const s = buildClientPrevMsgSummary(pm);
                if (s) prevMessages.push(s);
              }
            } else {
              for (const prevOffset of [2, 1]) {
                if (i - prevOffset >= 0) {
                  const s = buildClientPrevMsgSummary(tgMessages[i - prevOffset]);
                  if (s) prevMessages.push(s);
                }
              }
            }

            let effectivePre = { ...rollingPreContext };
            const cleanChatId = String(backupChatId || "").replace(/^-100/, "").replace(/^-/, "");
            const msgId = msg.id || msg.message_id || null;
            const messageLink = msgId
              ? (backupChatUsername
                  ? ("https://t.me/" + backupChatUsername + "/" + msgId)
                  : (cleanChatId && /^\\d+$/.test(cleanChatId) ? ("https://t.me/c/" + cleanChatId + "/" + msgId) : ""))
              : "";

            const lines = getCleanClientContentLines(flatText)
              .map(l => l.replace(/\\b(?:Beschreibung|Handlung|Inhalt|Plot|Story)\\s*:.*/i, "").trim())
              .filter(l => {
                if (l.length < 2 || /^https?:\\/\\//i.test(l) || /^[@#][^\\s]+$/.test(l) || /^❖\\s*@/.test(l) || /^(?:➠|✔️|🔞|قیمت)/.test(l)) return false;
                return true;
              });
            const contentLines = lines.filter(l => !metaPrefixRegex.test(l));
            const firstTextLine = contentLines[0] || "";

            const safeTextForYear = flatText.replace(/\\b\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\b/g, " ");
            const yearInText = (" " + safeTextForYear + " ").match(/(?:[(\\[\\-\\s_.·‧])(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s+)?(?<!\\d{1,2}[./-]\\d{1,2}[./-])(19[2-9]\\d|20[0-2]\\d)(?![.\\d])(?:[)\\]\\s._\\-·‧]|$)/i)?.[1] || effectivePre.year || null;
            let seInText = flatText.match(/\\b(S\\d{1,2}[\\s._-]*E\\d{1,3}(?:[-–]E?\\d{1,3})?|(?:Folge|Episode)\\s*0*\\d{1,3})\\b/i)?.[1] || null;
            if (seInText && /^(?:Folge|Episode)/i.test(seInText)) {
              const epDigits = seInText.match(/(\\d{1,3})/)?.[1] || "1";
              const ctxSeason = effectivePre.season || 1;
              seInText = "S" + String(ctxSeason).padStart(2, "0") + "E" + String(epDigits).padStart(2, "0");
            }
            const detectedQual = detectClientVideoQuality(msg, flatText, rawFileName);

            if (!rawFileName && !validFilePath && !isVideoMsg && !isRarMsg && !isPhotoMsg && contentLines.length >= 2 && !/\\b\\d+\\s*Folgen\\s+in\\s+\\d+\\s*Staffel/i.test(flatText)) {
              const multiLinesWithMedia = contentLines.filter(l =>
                l.length <= 110 && /\\b(?:19\\d{2}|20[0-2]\\d|S\\d{1,2}E\\d{1,3}|1080p|720p|2160p|4K|x264|x265|BluRay|WEB-DL)\\b/i.test(l)
              );
              if (multiLinesWithMedia.length >= 2) {
                for (const lineStr of multiLinesWithMedia) {
                  rawCandidates.push({
                    filename: lineStr,
                    rawInput: lineStr,
                    raw_file_name: "",
                    raw_text: flatTextRaw.slice(0, 500),
                    parsed_from: "Text-Liste",
                    message_id: msgId,
                    chat_id: backupChatId || null,
                    message_link: messageLink,
                    prev_messages: prevMessages,
                    pre_context: effectivePre,
                    telegram_file_id: null,
                    file_size: null,
                    mime_type: "video/mp4"
                  });
                }
                continue;
              }
            }

            if (!isVideoMsg && !isRarMsg && !rawFileName && !validFilePath) {
              if (clientPreLogs.length < 350 && flatTextRaw.trim()) {
                clientPreLogs.push({
                  msgId: currentMsgId || null,
                  fileName: "Text-Header",
                  rawText: flatTextRaw.slice(0, 140),
                  status: "SKIPPED_HEADER",
                  reason: "Text-/Serien-Header ohne Videodatei (" + (rollingPreContext.seriesHeader || rollingPreContext.title || "Info") + ")",
                  detectedType: "header",
                  parsedTitle: rollingPreContext.seriesHeader || rollingPreContext.title || ""
                });
              }
              continue;
            }

            const isGenericFile = !(rawFileName || validFilePath) || /^(?:video|new+|vmp4|\\d+|d-[a-z0-9-]+)\\.(mp4|mkv|avi|m4v|ts)$/i.test((rawFileName || validFilePath).trim());
            const cleanFirstLine = cleanClientMediaTitle(firstTextLine.replace(/\\bStaffel\\s*\\d+.*/i, ""));
            if (isGenericFile && !cleanFirstLine && !effectivePre.title && !effectivePre.seriesHeader && !effectivePre.tmdbId) {
              continue;
            }

            // Regel 3: Mehrzeilige Serien-Posts (Zeilen 2 bis 12 nach S01E01 oder Folge X durchsuchen - Breaking Bad S03E01 Fix!)
            let multiLineSeLine = "";
            let multiLineEpTitle = "";
            for (let li = 1; li < Math.min(contentLines.length, 12); li++) {
              const mLine = contentLines[li].match(/\\b(S\\d{1,2}[\\s._-]*E\\d{1,3}(?:[-–]E?\\d{1,3})?|(?:Folge|Episode)\\s*0*\\d{1,3})\\b/i);
              if (mLine) {
                let rawCode = mLine[1];
                if (/^(?:Folge|Episode)/i.test(rawCode)) {
                  const epD = rawCode.match(/(\\d{1,3})/)?.[1] || "1";
                  rawCode = "S" + String(effectivePre.season || 1).padStart(2, "0") + "E" + String(epD).padStart(2, "0");
                }
                multiLineSeLine = rawCode;
                const afterInLine = cleanClientMediaTitle(contentLines[li].slice(mLine.index + mLine[0].length));
                const nextLine = contentLines[li + 1] ? cleanClientMediaTitle(contentLines[li + 1]) : "";
                multiLineEpTitle = afterInLine || nextLine || "";
                break;
              }
            }

            // Schutzregel ("The Rookie S01E11" / "E01S01 Frontier 2016"):
            // Wenn die Datei oder Caption bereits einen EIGENEN Seriennamen mitbringt, darf dieser NIEMALS vom effectivePre der vorherigen Serie überschrieben werden!
            const fileCleanOwn = !isGenericFile ? cleanClientMediaTitle(( normFileName || "" ).replace(/\\bS\\d{1,2}[\\s._-]*E\\d{1,3}.*$/i, "")) : "";
            const textCleanOwn = cleanFirstLine ? cleanClientMediaTitle(firstTextLine.replace(/\\bS\\d{1,2}[\\s._-]*E\\d{1,3}.*$/i, "").replace(/\\bStaffel\\s*\\d+.*/i, "")) : "";
            const ownExplicitSeriesTitle = (textCleanOwn && textCleanOwn.length >= 2) ? textCleanOwn : ((fileCleanOwn && fileCleanOwn.length >= 2) ? fileCleanOwn : "");

            if (ownExplicitSeriesTitle && effectivePre.seriesHeader && ownExplicitSeriesTitle.toLowerCase() !== effectivePre.seriesHeader.toLowerCase()) {
              // Neue Serie im Dateinamen/Text erkannt -> alten Kontext verwerfen!
              effectivePre = { lastMessageId: currentMsgId };
              rollingPreContext = { seriesHeader: ownExplicitSeriesTitle, isSeriesHeader: true, lastMessageId: currentMsgId };
            }

            let baseCandidate = "";
            let parsedFrom = isRarMsg ? "RAR-Archiv" : "Dateiname";
            if (!ownExplicitSeriesTitle && effectivePre.title && (effectivePre.tmdbId || effectivePre.imdbId || isGenericFile || !cleanFirstLine)) {
              baseCandidate = effectivePre.title;
              parsedFrom = "Vorab-Steckbrief (Nachricht darüber)";
            } else if (!ownExplicitSeriesTitle && effectivePre.seriesHeader && (isGenericFile || !cleanFirstLine)) {
              baseCandidate = effectivePre.seriesHeader + (seInText ? (" " + seInText) : "");
              parsedFrom = "Serien-Header (Nachricht darüber)";
            } else if (multiLineSeLine && cleanFirstLine) {
              baseCandidate = cleanFirstLine + " " + multiLineSeLine + (multiLineEpTitle ? (" - " + multiLineEpTitle) : "");
              parsedFrom = "Caption Zeile 1";
            } else if (cleanFirstLine && firstTextLine.length >= 2 && firstTextLine.length <= 140) {
              // Regel 2: Cross-Check Text <-> Dateiname (z. B. D O P E T H I E F im Text vs Dope.Thief im Dateinamen)
              const rawSpaced = /^(?:[A-Za-zÄÖÜäöüß]\\s+){3,}[A-Za-zÄÖÜäöüß]/.test(firstTextLine);
              if (rawSpaced && normFileName && !isGenericFile) {
                baseCandidate = normFileName;
                parsedFrom = "Dateiname (Cross-Check)";
              } else {
                baseCandidate = firstTextLine;
                parsedFrom = isRarMsg ? "RAR-Archiv (Caption)" : "Caption Zeile 1";
              }
            } else {
              baseCandidate = normFileName || firstTextLine;
              parsedFrom = isRarMsg ? "RAR-Archiv" : (rawFileName ? "Dateiname" : "Caption");
            }

            if (!baseCandidate || baseCandidate.length < 2) continue;
            if (/^(?:trailer|coming soon)\\b/i.test(baseCandidate) || /\\b(official trailer|kinotrailer|coming\\s+soon)\\b/i.test(flatText.slice(0, 80))) {
              if (clientPreLogs.length < 350) {
                clientPreLogs.push({
                  msgId: currentMsgId || null,
                  fileName: rawFileName || baseCandidate,
                  rawText: flatTextRaw.slice(0, 140),
                  status: "SKIPPED_JUNK",
                  reason: "🎬 Trailer / Coming Soon übersprungen",
                  detectedType: "junk",
                  parsedTitle: baseCandidate
                });
              }
              continue;
            }

            let enrichedName = baseCandidate;
            if (seInText && !/\\b(?:S\\d{1,2}[\\s._-]*E\\d{1,3}|Folge\\s*\\d+|Episode\\s*\\d+)\\b/i.test(enrichedName)) {
              enrichedName += " " + seInText;
            }
            if (yearInText && !/\\b(?:19\\d{2}|20[0-2]\\d)\\b/.test(enrichedName)) {
              enrichedName += " (" + yearInText + ")";
            }
            if (detectedQual && !/\\b(?:2160p|4K|UHD|1080p|FHD|720p|HD|480p|360p)\\b/i.test(enrichedName)) {
              enrichedName += " " + detectedQual;
            }

            const rarPartObj = isRarMsg ? extractClientPartInfo(flatTextRaw, rawFileName || validFilePath, 0) : null;
            rawCandidates.push({
              filename: enrichedName,
              rawInput: rawFileName || validFilePath || firstTextLine || enrichedName,
              raw_file_name: rawFileName || validFilePath || "",
              raw_text: flatTextRaw.slice(0, 600),
              parsed_from: parsedFrom,
              tmdb_id: effectivePre.tmdbId || null,
              imdb_id: effectivePre.imdbId || null,
              type: effectivePre.mediaType === "tv" ? "series" : (effectivePre.mediaType === "movie" ? "movie" : undefined),
              quality: detectedQual,
              codec: isRarMsg ? "RAR" : undefined,
              part: rarPartObj ? rarPartObj.partLabel : undefined,
              isArchive: isRarMsg,
              tags: isRarMsg ? "📦 RAR-Archiv" : undefined,
              width: Number(msg.width || msg.video?.width || 0) || null,
              height: Number(msg.height || msg.video?.height || 0) || null,
              duration_sec: Number(msg.duration_seconds || 0),
              message_id: msgId,
              msg_id: msgId,
              chat_id: backupChatId || null,
              chat_username: backupChatUsername || null,
              message_link: messageLink,
              prev_messages: prevMessages,
              pre_context: { ...effectivePre },
              telegram_file_id: msg.telegram_file_id || msg.file_id || null,
              file_size: msg.file_size || null,
              mime_type: isRarMsg ? "application/x-rar" : (msg.mime_type || "video/mp4")
            });

            // Film-Steckbrief nach dem zugehörigen Video verbrauchen (Fall 16: IDs 108709-108715)
            delete rollingPreContext.tmdbId;
            delete rollingPreContext.imdbId;
            delete rollingPreContext.title;
            delete rollingPreContext.originalTitle;
            if (!rollingPreContext.seriesHeader) {
              delete rollingPreContext.year;
              delete rollingPreContext.mediaType;
            }
            if ((parsedFrom === "Caption Zeile 1" || parsedFrom === "Dateiname (Cross-Check)") && (seInText || multiLineSeLine) && cleanFirstLine) {
              const sHead = cleanClientMediaTitle(firstTextLine.replace(/\\b(?:S\\d{1,2}[\\s._-]*E\\d{1,3}|Staffel\\s*\\d+.*)\\b/i, ""));
              if (sHead && sHead.length >= 2) {
                if (rollingPreContext.seriesHeader !== sHead) delete rollingPreContext.year;
                rollingPreContext.seriesHeader = sHead;
                rollingPreContext.lastMessageId = Number(msgId || 0);
              }
            }
          }

          const classified = deduplicateAndClassifyClientEntries(rawCandidates);
          if (typeof appendClientDiagnosticLogs === "function" && clientPreLogs.length > 0) {
            appendClientDiagnosticLogs(clientPreLogs);
          }

          return {
            fileName,
            fileSizeMb: (fileSizeBytes / (1024 * 1024)).toFixed(2),
            isTelegramBackup: true,
            backupChatName,
            backupChatId,
            backupChatUsername,
            rawMessageCount: tgMessages.length,
            repaired: Boolean(repairMeta?.repaired),
            repairNotes: repairMeta?.repairNotes || [],
            ...classified
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

        const classified = deduplicateAndClassifyClientEntries(rawList);

        return {
          fileName,
          fileSizeMb: (fileSizeBytes / (1024 * 1024)).toFixed(2),
          isTelegramBackup: false,
          backupChatName: String(parsedJson?.playlistName || parsedJson?.name || ""),
          backupChatId: "",
          backupChatUsername: "",
          rawMessageCount: rawList.length,
          repaired: Boolean(repairMeta?.repaired),
          repairNotes: repairMeta?.repairNotes || [],
          ...classified
        };
      }

      // >200 MB Stream-Slice Reader (liest 200 MB - 2 GB+ result.json Dateien in 2 MB File.slice() Blöcken UND bewahrt die 2 Nachrichten über jedem Video!)
      async function streamParseLargeClientBackupFile(file, statusEl) {
        const SLICE_BYTES = 2 * 1024 * 1024;
        const totalBytes = file.size;
        let offset = 0;
        let backupChatName = file.name.replace(/\\.json$/i, "");
        let backupChatId = "";
        let rawMsgCount = 0;
        const extractedMessages = [];
        const recentWindowMsgs = [];

        let insideArray = false;
        let braceDepth = 0;
        let inString = false;
        let isEscaped = false;
        let currentObjStr = "";

        while (offset < totalBytes) {
          const end = Math.min(totalBytes, offset + SLICE_BYTES);
          const chunkText = await file.slice(offset, end).text();

          if (offset === 0) {
            const headerSlice = chunkText.slice(0, 2048);
            const nameMatch = headerSlice.match(/"name"\\s*:\\s*"([^"]+)"/);
            if (nameMatch && nameMatch[1]) backupChatName = nameMatch[1].trim();
            const idMatch = headerSlice.match(/"id"\\s*:\\s*(\\d+)/);
            if (idMatch && idMatch[1]) backupChatId = idMatch[1].trim();
          }

          for (let i = 0; i < chunkText.length; i++) {
            const ch = chunkText[i];
            if (!insideArray) {
              if (ch === "[") insideArray = true;
              continue;
            }
            if (braceDepth > 0) currentObjStr += ch;
            if (inString) {
              if (isEscaped) isEscaped = false;
              else if (ch === "\\\\") isEscaped = true;
              else if (ch === '"') inString = false;
              continue;
            }
            if (ch === '"') {
              inString = true;
              continue;
            }
            if (ch === "{") {
              if (braceDepth === 0) currentObjStr = "{";
              braceDepth++;
            } else if (ch === "}") {
              braceDepth--;
              if (braceDepth === 0 && currentObjStr) {
                rawMsgCount++;
                const isCandidateVideo =
                  currentObjStr.includes("video") ||
                  currentObjStr.includes("file_name") ||
                  currentObjStr.includes(".mkv") ||
                  currentObjStr.includes(".mp4") ||
                  currentObjStr.includes(".avi") ||
                  currentObjStr.includes("1080p") ||
                  currentObjStr.includes("2160p") ||
                  currentObjStr.includes("720p") ||
                  currentObjStr.includes("4K");

                try {
                  const parsedMsgObj = JSON.parse(currentObjStr);
                  if (isCandidateVideo) {
                    parsedMsgObj._prevMessages = recentWindowMsgs.slice(-2);
                    extractedMessages.push(parsedMsgObj);
                  }
                  recentWindowMsgs.push({
                    id: parsedMsgObj.id,
                    date: parsedMsgObj.date,
                    photo: parsedMsgObj.photo,
                    file_name: parsedMsgObj.file_name,
                    text: parsedMsgObj.text,
                    caption: parsedMsgObj.caption,
                    text_entities: parsedMsgObj.text_entities
                  });
                  if (recentWindowMsgs.length > 4) recentWindowMsgs.shift();
                } catch (e) {}
                currentObjStr = "";
              }
            }
          }

          offset = end;
          if (statusEl) {
            const pct = Math.min(100, Math.round((offset / totalBytes) * 100));
            statusEl.textContent =
              "✂️ Stream-Slicer (" + pct + "%): " +
              (offset / (1024 * 1024)).toFixed(1) + " / " + (totalBytes / (1024 * 1024)).toFixed(1) +
              " MB • " + extractedMessages.length.toLocaleString("de-DE") + " Video-Einträge (inkl. Nachbar-Kontext) gefiltert...";
          }
          await new Promise(r => setTimeout(r, 4));
        }

        const syntheticParsed = { id: backupChatId || undefined, name: backupChatName, messages: extractedMessages };
        const info = detectAndParseClientBackupJson(syntheticParsed, file.name, file.size, {
          repaired: true,
          repairNotes: [
            "2 MB Stream-Slicer für Großdatei (" + (totalBytes / (1024 * 1024)).toFixed(1) + " MB): " +
            rawMsgCount.toLocaleString("de-DE") + " Roh-Nachrichten gescannt, inkl. 2-Nachrichten-Kontext über jedem Video"
          ]
        });
        info.rawMessageCount = rawMsgCount;
        return info;
      }

      function downloadBackupSplitPartClient(partIndexZeroBased, chunkSize = 250) {
        const entries = backupImportJob?.entries || [];
        if (!entries.length) return;
        const safeSize = Math.max(25, Number(chunkSize) || 250);
        const slice = entries.slice(partIndexZeroBased * safeSize, (partIndexZeroBased + 1) * safeSize);
        if (!slice.length) return;
        const totalParts = Math.ceil(entries.length / safeSize);
        const partNum = String(partIndexZeroBased + 1).padStart(3, "0");
        const baseName = String(backupImportJob.fileName || "result").replace(/\\.json$/i, "");
        const payload = {
          name: (backupImportJob.customPlaylistName || baseName) + " (Part " + (partIndexZeroBased + 1) + "/" + totalParts + ")",
          id: backupImportJob.backupChatId || undefined,
          partIndex: partIndexZeroBased + 1,
          totalParts,
          chunkSize: safeSize,
          messages: slice.map((item, idx) => ({
            id: item.message_id || (idx + 1),
            type: "message",
            file_name: item.filename || item.rawInput,
            text: item.raw_text || "",
            media_type: "video_file",
            mime_type: item.mime_type || "video/mp4",
            file_size: item.file_size || null,
            telegram_file_id: item.telegram_file_id || null,
            _prevMessages: item.prev_messages || []
          }))
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = baseName + "_part_" + partNum + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showHudToast("💾 " + baseName + "_part_" + partNum + ".json (" + slice.length + " Videos) heruntergeladen");
      }

      function getHowToCliSnippetsClient() {
        const dq = String.fromCharCode(34);
        const bs = String.fromCharCode(92);
        const jqCmd =
          "jq '{name: .name, id: .id, messages: [.messages[] | select(.media_type == " +
          dq + "video_file" + dq +
          " or (.file_name // " + dq + dq + " | test(" +
          dq + bs + bs + ".(mp4|mkv|avi|mov)$" + dq + "; " + dq + "i" + dq +
          "))) ]}' result.json > result_videos_only.json";
        const pyCmd = [
          "import json",
          "with open('result.json', 'r', encoding='utf-8') as f:",
          "    data = json.load(f)",
          "msgs = data.get('messages', [])",
          "out = []",
          "for i, m in enumerate(msgs):",
          "    fn = str(m.get('file_name') or '').lower()",
          "    if m.get('media_type') == 'video_file' or fn.endswith(('.mp4', '.mkv', '.avi')):",
          "        m['_prevMessages'] = msgs[max(0, i-2):i]",
          "        out.append(m)",
          "for idx in range(0, len(out), 250):",
          "    part = {'name': data.get('name', 'Export'), 'id': data.get('id'), 'messages': out[idx:idx+250]}",
          "    with open(f'result_part_{idx//250+1:03d}.json', 'w', encoding='utf-8') as pf:",
          "        json.dump(part, pf, ensure_ascii=False, indent=2)"
        ].join("\\n");
        return { jqCmd, pyCmd };
      }

      function copyHowToSnippetClient(which) {
        const snippets = getHowToCliSnippetsClient();
        const textToCopy = which === "py" ? snippets.pyCmd : snippets.jqCmd;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          navigator.clipboard.writeText(textToCopy).then(() => {
            showHudToast("📋 " + (which === "py" ? "Python 3 Splitter-Skript" : "jq-Kommando") + " in die Zwischenablage kopiert!");
          }).catch(() => {});
        }
      }

      function openLargeJsonHowToModalClient() {
        const modal = document.getElementById("modalRoot");
        if (!modal) return;
        modal.innerHTML =
          '<div class="modal-backdrop" onclick="if(event.target===this)closeDetailModal()">' +
            '<div class="modal" style="max-width:740px;padding:18px">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px">' +
                '<div style="font-size:16px;font-weight:900;color:#38bdf8">✂️ How-To: Telegram JSON-Backups über 200 MB splitten & importieren</div>' +
                '<button class="btn red" onclick="closeDetailModal()">✖ Schließen</button>' +
              '</div>' +
              '<div style="font-size:12.5px;color:#cbd5e1;line-height:1.55;display:flex;flex-direction:column;gap:12px">' +
                '<div style="background:#14141d;border:1px solid rgba(56,189,248,0.35);border-radius:8px;padding:12px">' +
                  '<b style="color:#fff">1. Warum 200 MB+ Dateien besondere Verarbeitung brauchen:</b><br/>' +
                  'Große Telegram-Gruppen enthalten oft hunderttausende Textnachrichten. ' +
                  'Unser integrierter <b>2 MB Browser-Stream-Slicer (<code>File.slice()</code>)</b> liest auch 500 MB+ Dateien stückweise im Browser aus, bewahrt automatisch die <b>2 Nachrichten über jedem Video (Steckbrief-Kontext)</b> und teilt alles in <b>250er Video-Chunks</b> auf.' +
                '</div>' +
                '<div style="background:#14141d;border:1px solid rgba(16,185,129,0.35);border-radius:8px;padding:12px">' +
                  '<b style="color:#34d399">2. Optimaler Export in Telegram Desktop (ohne Video-Dateien herunterzuladen):</b><br/>' +
                  '1. Gruppe/Kanal in Telegram Desktop öffnen ➔ <b>⋮ ➔ Chatverlauf exportieren</b>.<br/>' +
                  '2. <b>Alle Haken bei Medien (Fotos, Videos, Sprachnachrichten) deaktivieren</b> – es werden nur die Dateinamen & Captions benötigt!<br/>' +
                  '3. Format auf <b>Maschinenlesbares JSON (<code>result.json</code>)</b> stellen und hier im Backup-Tab auswählen.' +
                '</div>' +
                '<div style="background:#14141d;border:1px solid rgba(251,191,36,0.35);border-radius:8px;padding:12px">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                    '<b style="color:#fbbf24">3. Optionales Terminal-Kommando (jq / Python 3) für 1 GB+ Backups:</b>' +
                    '<div style="display:flex;gap:6px">' +
                      '<button type="button" class="btn" style="padding:3px 9px;font-size:11px" onclick="copyHowToSnippetClient(\\'jq\\')">📋 jq kopieren</button>' +
                      '<button type="button" class="btn amber" style="padding:3px 9px;font-size:11px" onclick="copyHowToSnippetClient(\\'py\\')">📋 Python-Splitter kopieren</button>' +
                    '</div>' +
                  '</div>' +
                  '<pre id="howToJqCodeEl" style="background:#09090d;padding:8px;border-radius:6px;overflow-x:auto;font-size:11px;color:#38bdf8;margin-top:6px;white-space:pre-wrap"></pre>' +
                  '<pre id="howToPyCodeEl" style="background:#09090d;padding:8px;border-radius:6px;overflow-x:auto;font-size:11px;color:#34d399;margin-top:6px;white-space:pre"></pre>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
        const snippets = getHowToCliSnippetsClient();
        const jqEl = document.getElementById("howToJqCodeEl");
        const pyEl = document.getElementById("howToPyCodeEl");
        if (jqEl) jqEl.textContent = snippets.jqCmd;
        if (pyEl) pyEl.textContent = snippets.pyCmd;
      }

      const BACKUP_CHECKPOINT_STORAGE_KEY = "tma_backup_import_checkpoint_v1";

      function getSavedVerifiedChannelIdClient() {
        try {
          return localStorage.getItem("tma_verified_channel_id") || "";
        } catch (e) {
          return "";
        }
      }

      function parseClientTelegramChannelOrLink(rawVal) {
        const s = String(rawVal || "").trim();
        if (!s) return { channelId: "", sampleMessageId: null };
        const priv = s.match(/t\\.me\\/c\\/(\\d{5,})(?:\\/(\\d+))?(?:\\/(\\d+))?/i);
        if (priv) {
          const mId = priv[3] ? parseInt(priv[3], 10) : (priv[2] ? parseInt(priv[2], 10) : null);
          return { channelId: "-100" + priv[1], sampleMessageId: mId || null };
        }
        const pub = s.match(/t\\.me\\/([a-zA-Z0-9_]{4,})(?:\\/(\\d+))?/i);
        if (pub && pub[1].toLowerCase() !== "c") {
          return { channelId: "@" + pub[1], sampleMessageId: pub[2] ? parseInt(pub[2], 10) : null };
        }
        const num = s.match(/^(-?\\d{5,})$/);
        if (num) {
          let d = num[1];
          if (!d.startsWith("-")) d = "-100" + d.replace(/^100/, "");
          else if (!d.startsWith("-100")) d = "-100" + d.slice(1);
          return { channelId: d, sampleMessageId: null };
        }
        return { channelId: s, sampleMessageId: null };
      }

      function loadBackupCheckpointClient() {
        try {
          const raw = localStorage.getItem(BACKUP_CHECKPOINT_STORAGE_KEY);
          if (!raw) return null;
          const cp = JSON.parse(raw);
          if (cp && typeof cp === "object" && Number(cp.cursor) > 0 && Number(cp.totalEntries) > 0) {
            return cp;
          }
        } catch (e) {}
        return null;
      }

      function saveBackupCheckpointClient() {
        if (!backupImportJob.entries || !backupImportJob.entries.length) return;
        const cp = {
          fileSignature: backupImportJob.fileSignature || (backupImportJob.fileName + "::" + backupImportJob.entries.length),
          fileName: backupImportJob.fileName || "result.json",
          cursor: Number(backupImportJob.cursor || 0),
          totalEntries: Number(backupImportJob.entries.length || 0),
          verifiedChannelId: backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient(),
          customPlaylistName: backupImportJob.customPlaylistName || "",
          playlistFolderId: backupImportJob.playlistFolderId || "",
          playlistMode: backupImportJob.playlistMode || "both",
          moviesSaved: Number(backupImportJob.moviesSaved || 0),
          seriesSaved: Number(backupImportJob.seriesSaved || 0),
          duplicatesInDb: Number(backupImportJob.duplicatesInDb || 0),
          mergedQualitiesInDb: Number(backupImportJob.mergedQualitiesInDb || 0),
          uncertainCount: Number(backupImportJob.uncertainCount || 0),
          failedCount: Number(backupImportJob.failedCount || 0),
          updatedAt: Date.now()
        };
        backupImportJob.savedCheckpoint = cp;
        try {
          localStorage.setItem(BACKUP_CHECKPOINT_STORAGE_KEY, JSON.stringify(cp));
        } catch (e) {}
        apiFetchJson(API_BASE + "/admin/import-checkpoint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkpoint: cp })
        }).catch(() => {});
      }

      function clearBackupCheckpointClient() {
        backupImportJob.savedCheckpoint = null;
        try {
          localStorage.removeItem(BACKUP_CHECKPOINT_STORAGE_KEY);
        } catch (e) {}
        apiFetchJson(API_BASE + "/admin/import-checkpoint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clear: true })
        }).catch(() => {});
      }

      async function verifyBackupChannelClient() {
        const inp = document.getElementById("backupSourceChannelInp");
        const msgInp = document.getElementById("backupSampleMsgIdInp");
        const statusBanner = document.getElementById("backupChannelVerifyBanner");
        const rawInput = (inp ? inp.value : backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient()).trim();
        if (!rawInput) {
          showHudToast("⚠️ Bitte zuerst Kanal-ID (-100...) oder Beispiel-Nachrichtenlink eingeben!");
          return;
        }
        const parsed = parseClientTelegramChannelOrLink(rawInput);
        let sampleMessageId = msgInp && msgInp.value ? parseInt(msgInp.value, 10) : parsed.sampleMessageId;
        if (!sampleMessageId && Array.isArray(backupImportJob.entries) && backupImportJob.entries.length > 0) {
          const firstWithMsg = backupImportJob.entries.find(e => e && (e.message_id || e.msg_id));
          if (firstWithMsg) sampleMessageId = Number(firstWithMsg.message_id || firstWithMsg.msg_id);
        }

        if (statusBanner) {
          statusBanner.style.display = "block";
          statusBanner.style.color = "#38bdf8";
          statusBanner.innerHTML = "⏳ Prüfe Kanal-Lesbarkeit & Dry-Run Berechtigungen für <code>" + esc(parsed.channelId || rawInput) + "</code>...";
        }

        try {
          const r = await apiFetchJson(API_BASE + "/admin/validate-channel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelInput: rawInput, sampleMessageId: sampleMessageId || null })
          });
          backupImportJob.channelVerifyResult = r;
          if (r && r.ok && r.readable && r.channelId) {
            backupImportJob.verifiedChannelId = String(r.channelId);
            backupImportJob.backupChatId = String(r.channelId);
            try {
              localStorage.setItem("tma_verified_channel_id", String(r.channelId));
              localStorage.setItem("tma_verified_channel_input", rawInput);
            } catch (e) {}

            // Falls bereits eine JSON-Datei geparst wurde, verifizierte Kanal-ID sofort in alle Einträge (+ gebundene Untertitel) injizieren!
            if (Array.isArray(backupImportJob.entries) && backupImportJob.entries.length > 0) {
              for (const ent of backupImportJob.entries) {
                if (!ent || typeof ent !== "object") continue;
                ent.chat_id = String(r.channelId);
                const mId = ent.message_id || ent.msg_id;
                if (mId && (!ent.telegram_file_id || String(ent.telegram_file_id).startsWith("tg_export_"))) {
                  ent.telegram_file_id = "tg_export_" + r.channelId + "_" + mId;
                }
                if (Array.isArray(ent.subtitle_files)) {
                  for (const sf of ent.subtitle_files) {
                    if (!sf || typeof sf !== "object") continue;
                    sf.chat_id = String(r.channelId);
                    if (sf.message_id && (!sf.file_id || String(sf.file_id).startsWith("tg_export_"))) {
                      sf.file_id = "tg_export_" + r.channelId + "_" + sf.message_id;
                    }
                  }
                }
              }
            }

            if (statusBanner) {
              statusBanner.style.display = "block";
              statusBanner.style.color = "#34d399";
              statusBanner.innerHTML = "✅ <b>" + esc(r.diagnosticSummary || ("Kanal " + r.channelId + " verifiziert & freigeschaltet!")) + "</b>";
            }
            const fileInp = document.getElementById("backupJsonFileInputEl");
            if (fileInp) {
              fileInp.disabled = false;
              fileInp.style.opacity = "1";
            }
            showHudToast("✅ Kanal verifiziert: " + r.channelId + " – JSON-Upload ist freigeschaltet!");
            renderBackupImportBoxDom();
          } else {
            backupImportJob.verifiedChannelId = "";
            if (statusBanner) {
              statusBanner.style.display = "block";
              statusBanner.style.color = "#f87171";
              statusBanner.innerHTML = "❌ <b>" + esc(r?.diagnosticSummary || r?.error || "Kanal nicht lesbar. Ist der Bot Admin im Kanal?") + "</b>";
            }
            showHudToast("❌ Kanal-Prüfung fehlgeschlagen: " + (r?.error || "Kein Zugriff"));
            renderBackupImportBoxDom();
          }
        } catch (err) {
          if (statusBanner) {
            statusBanner.style.display = "block";
            statusBanner.style.color = "#f87171";
            statusBanner.innerHTML = "❌ Fehler bei der Kanal-Validierung: " + esc(err.message);
          }
        }
      }

      async function adminRunD1DedupeFilesClient() {
        setBusyState(true, "🧹 Bereinige doppelte & defekte Stream-Buttons in D1...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/d1-diagnostics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "dedupe_files",
              fallbackChannelId: backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient()
            })
          });
          clearClientMediaCaches();
          if (r && r.ok) {
            showHudToast("✅ Bereinigt: " + Number(r.removedBrokenRows || 0) + " defekte + " + Number(r.removedDuplicateRows || 0) + " doppelte Stream-Buttons entfernt!");
            await loadAdminPanelView();
          } else {
            showHudToast("⚠️ " + (r?.error || "Bereinigung fehlgeschlagen."));
          }
        } finally {
          setBusyState(false);
        }
      }

      async function adminRunCompleteMediaResetClient() {
        const ok = await showCustomConfirm(
          "🧨 KOMPLETT-RESET BESTÄTIGEN:\\n\\nMöchtest du wirklich ALLE Filme, Serien, Episoden, Datei-IDs, Caches und Playlisten in D1 & KV restlos löschen?\\n\\n(Deine Benutzerkonten, VIP-Status, 2FA und Admin-Rechte bleiben vollständig erhalten!)",
          "🧨 Ja, alles sauber zurücksetzen"
        );
        if (!ok) return;
        setBusyState(true, "🧨 Führe Komplett-Reset aller Medien & Playlisten in D1 + KV durch...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/d1-diagnostics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reset_all_media" })
          });
          clearBackupCheckpointClient();
          clearClientMediaCaches();
          resetBackupImport(true);
          backupImportJob.fileName = "";
          backupImportJob.entries = [];
          if (r && r.ok) {
            showHudToast("✅ Komplett-Reset abgeschlossen! Datenbank & Playlisten sind komplett sauber.");
            await loadAdminPanelView();
          } else {
            showHudToast("⚠️ " + (r?.error || "Reset fehlgeschlagen."));
          }
        } finally {
          setBusyState(false);
        }
      }

      async function handleBackupFileInput(ev) {
        const file = ev?.target?.files?.[0];
        if (!file) return;

        const activeChannelId = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
        if (!activeChannelId || (!activeChannelId.startsWith("-100") && !activeChannelId.startsWith("@"))) {
          showHudToast("⛔ Gesperrt: Bitte zuerst Schritt 1 (Kanal-ID -100... oder Link) eingeben und prüfen!");
          if (ev?.target) ev.target.value = "";
          return;
        }
        backupImportJob.verifiedChannelId = activeChannelId;

        const statusEl = document.getElementById("backupParseNotice");
        const sizeMb = file.size / (1024 * 1024);
        if (statusEl) {
          statusEl.style.color = "#fbbf24";
          statusEl.textContent = "⏳ Lese & analysiere " + file.name + " (" + sizeMb.toFixed(2) + " MB)...";
        }
        try {
          let info = null;
          if (sizeMb > 15) {
            info = await streamParseLargeClientBackupFile(file, statusEl);
          } else {
            const text = await file.text();
            const repairRes = repairAndParseClientBackupJson(text);
            if (!repairRes.ok || !repairRes.parsed) {
              info = await streamParseLargeClientBackupFile(file, statusEl);
            } else {
              info = detectAndParseClientBackupJson(repairRes.parsed, file.name, file.size, repairRes);
            }
          }

          // Verifizierte Kanal-ID garantiert in JEDEN Eintrag (+ gebundene Untertitel) injizieren, damit niemals tg_export_0_ entsteht!
          if (Array.isArray(info.entries)) {
            for (const ent of info.entries) {
              if (!ent || typeof ent !== "object") continue;
              ent.chat_id = activeChannelId;
              const mId = ent.message_id || ent.msg_id;
              if (mId && (!ent.telegram_file_id || String(ent.telegram_file_id).startsWith("tg_export_"))) {
                ent.telegram_file_id = "tg_export_" + activeChannelId + "_" + mId;
              }
              if (Array.isArray(ent.subtitle_files)) {
                for (const sf of ent.subtitle_files) {
                  if (!sf || typeof sf !== "object") continue;
                  sf.chat_id = activeChannelId;
                  if (sf.message_id && (!sf.file_id || String(sf.file_id).startsWith("tg_export_"))) {
                    sf.file_id = "tg_export_" + activeChannelId + "_" + sf.message_id;
                  }
                }
              }
            }
          }

          const fileSignature = String(file.name) + "::" + String(file.size) + "::" + String(info.entries.length);
          const existingCp = loadBackupCheckpointClient();
          const matchingCp = (
            existingCp &&
            (existingCp.fileSignature === fileSignature || existingCp.fileName === file.name) &&
            Number(existingCp.cursor) > 0 &&
            Number(existingCp.cursor) < info.entries.length
          ) ? existingCp : null;

          const cleanBase = String(file.name || "Import").replace(/\\.json$/i, "").trim();
          const suggestedPlaylistName = matchingCp?.customPlaylistName
            ? matchingCp.customPlaylistName
            : (info.isTelegramBackup ? ("📦 " + info.backupChatName) : (info.backupChatName || ("🎵 " + cleanBase)));

          backupImportJob = {
            ...info,
            fileSignature,
            verifiedChannelId: activeChannelId,
            channelVerifyResult: backupImportJob.channelVerifyResult || { ok: true, readable: true, channelId: activeChannelId },
            savedCheckpoint: matchingCp,
            splitChunkSize: 250,
            customPlaylistName: String(suggestedPlaylistName).slice(0, 48),
            playlistMode: matchingCp?.playlistMode || backupImportJob.playlistMode || "both",
            targetPlaylistChatId: String(state.adminPlaylistTargetChatId || chatId),
            playlistFolderId: matchingCp?.playlistFolderId || "",
            cursor: matchingCp ? Number(matchingCp.cursor || 0) : 0,
            moviesSaved: matchingCp ? Number(matchingCp.moviesSaved || 0) : 0,
            seriesSaved: matchingCp ? Number(matchingCp.seriesSaved || 0) : 0,
            duplicatesInDb: matchingCp ? Number(matchingCp.duplicatesInDb || 0) : 0,
            mergedQualitiesInDb: matchingCp ? Number(matchingCp.mergedQualitiesInDb || 0) : 0,
            uncertainCount: matchingCp ? Number(matchingCp.uncertainCount || 0) : 0,
            failedCount: matchingCp ? Number(matchingCp.failedCount || 0) : 0,
            running: false,
            paused: false,
            startedAt: 0,
            recentLog: matchingCp
              ? ["📌 Gespeicherter Checkpoint geladen: Fortsetzung bei Eintrag #" + matchingCp.cursor + " / " + info.entries.length + " bereit."]
              : [],
            livePosterFeed: [],
            reviewItems: [],
            activeSubTab: "dashboard",
            reviewFilter: "needs_attention"
          };
          if (statusEl) {
            statusEl.style.color = matchingCp ? "#fbbf24" : (info.repaired ? "#38bdf8" : "#34d399");
            const chunksCount = Math.max(1, Math.ceil(info.entries.length / 250));
            statusEl.textContent = matchingCp
              ? ("📌 Checkpoint erkannt: Bei #" + matchingCp.cursor.toLocaleString("de-DE") + " von " + info.entries.length.toLocaleString("de-DE") + " fortsetzen oder ab 0 neu starten!")
              : ("✅ " + info.entries.length.toLocaleString("de-DE") + " Video-Einträge erkannt [Kanal " + activeChannelId + "] (" + chunksCount + " Chunks à 250 Videos bereit)!");
          }
          renderBackupImportBoxDom();
        } catch (err) {
          if (statusEl) {
            statusEl.style.color = "#f87171";
            statusEl.textContent = "❌ Fehler beim Lesen der JSON-Datei: " + err.message;
          }
        }
      }

      function resumeBackupFromCheckpointClient() {
        const cp = backupImportJob.savedCheckpoint || loadBackupCheckpointClient();
        if (cp && backupImportJob.entries.length > 0) {
          backupImportJob.cursor = Math.min(Number(cp.cursor || 0), backupImportJob.entries.length);
        }
        showHudToast("▶️ Setze Smart-Import nahtlos bei Eintrag #" + backupImportJob.cursor + " fort...");
        startOrResumeBackupImport();
      }

      function restartBackupFromZeroNoDupesClient() {
        clearBackupCheckpointClient();
        backupImportJob.cursor = 0;
        backupImportJob.moviesSaved = 0;
        backupImportJob.seriesSaved = 0;
        backupImportJob.duplicatesInDb = 0;
        backupImportJob.mergedQualitiesInDb = 0;
        backupImportJob.uncertainCount = 0;
        backupImportJob.failedCount = 0;
        backupImportJob.startedAt = 0;
        backupImportJob.recentLog = ["🔄 Neustart ab Index 0 (Duplikat-Schutz aktiv: bestehende Einträge werden sauber aktualisiert)."];
        showHudToast("🔄 Starte ab 0 neu (ohne Duplikate einzufügen)...");
        startOrResumeBackupImport();
      }

      function updateBackupCustomPlaylistName(val) {
        backupImportJob.customPlaylistName = String(val || "").trim().slice(0, 48);
      }

      function setBackupPlaylistModeClient(modeVal) {
        backupImportJob.playlistMode = ["vip_stream", "watchlist", "both"].includes(modeVal) ? modeVal : "both";
        renderBackupImportBoxDom();
      }

      function switchBackupSubTab(tab) {
        if (tab === "diaglog") {
          backupImportJob.activeSubTab = "diaglog";
          renderBackupImportBoxDom();
          syncDiagnosticLogsFromD1Client(true);
          return;
        }
        backupImportJob.activeSubTab = tab === "review" ? "review" : "dashboard";
        renderBackupImportBoxDom();
      }

      function setBackupReviewFilter(f) {
        backupImportJob.reviewFilter = f || "needs_attention";
        renderBackupImportBoxDom();
      }

      function syncReviewCardDomInputsToItemState(item) {
        if (!item) return;
        const sInp = document.getElementById("revSeasonInp_" + item.id);
        const eInp = document.getElementById("revEpInp_" + item.id);
        const qInp = document.getElementById("revSearchInp_" + item.id);
        const tSel = document.getElementById("revSearchType_" + item.id);
        if (sInp && sInp.value) item.season = Math.max(1, parseInt(sInp.value, 10) || item.season || 1);
        if (eInp && eInp.value) item.episode = Math.max(1, parseInt(eInp.value, 10) || item.episode || 1);
        if (qInp) item.manualSearchQuery = qInp.value;
        if (tSel) item.manualSearchType = tSel.value;
      }

      function updateReviewHeaderCountersInDom() {
        const j = backupImportJob;
        const allItems = j.reviewItems || [];
        const needsCount = allItems.filter(x => !x.resolvedByAdmin && (x.status === "failed" || x.isUncertain)).length;
        const uncertainCount = allItems.filter(x => !x.resolvedByAdmin && x.isUncertain && x.status !== "failed").length;
        const failedCount = allItems.filter(x => !x.resolvedByAdmin && x.status === "failed").length;

        const btnNeeds = document.getElementById("revBtnNeeds");
        const btnUnc = document.getElementById("revBtnUncertain");
        const btnFail = document.getElementById("revBtnFailed");
        const btnAll = document.getElementById("revBtnAll");
        const tabSubBtn = document.getElementById("revSubTabBtn");

        if (btnNeeds) btnNeeds.innerHTML = "⚠️ Prüfbedarf (" + needsCount + ")";
        if (btnUnc) btnUnc.innerHTML = "🔎 Unsichere Treffer (" + uncertainCount + ")";
        if (btnFail) btnFail.innerHTML = "❌ Nicht erkannt (" + failedCount + ")";
        if (btnAll) btnAll.innerHTML = "📋 Alle importierten (" + allItems.length + ")";
        if (tabSubBtn) {
          tabSubBtn.innerHTML = "🛠️ Prüfen & Korrigieren" + (
            needsCount > 0
              ? (' <span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:999px;font-size:10.5px;margin-left:4px">' + needsCount + '</span>')
              : (" (" + allItems.length + ")")
          );
        }
      }

      function updateSingleReviewCardInDom(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        const cardEl = document.getElementById("revCard_" + itemId);
        if (cardEl) {
          const scrollContainer = document.getElementById("backupReviewScrollContainer");
          const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : null;
          const prevWinScrollY = window.scrollY;
          cardEl.outerHTML = renderSingleBackupReviewCardHtml(it, backupImportJob.reviewItems || []);
          if (scrollContainer && prevScrollTop !== null) {
            scrollContainer.scrollTop = prevScrollTop;
          }
          if (typeof prevWinScrollY === "number" && Math.abs(window.scrollY - prevWinScrollY) > 4) {
            window.scrollTo({ top: prevWinScrollY, behavior: "instant" });
          }
        }
        updateReviewHeaderCountersInDom();
      }

      function reopenResolvedReviewCard(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        it.expandedAfterResolve = true;
        updateSingleReviewCardInDom(itemId);
      }

      function collapseResolvedReviewCard(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        it.expandedAfterResolve = false;
        updateSingleReviewCardInDom(itemId);
      }

      // Bestätigt den aktuellen Vorschlag INKLUSIVE Speicherung von Staffel/Folge & Kanal-Datei-ID in D1!
      async function confirmBackupReviewItem(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        syncReviewCardDomInputsToItemState(it);
        if (it.tmdbId) {
          await applyBackupCandidateRemap(itemId, it.tmdbId, it.typeCode || "m", { isConfirmAction: true });
          return;
        }
        if (it.isUncertain && backupImportJob.uncertainCount > 0) {
          backupImportJob.uncertainCount = Math.max(0, backupImportJob.uncertainCount - 1);
        }
        it.isUncertain = false;
        it.status = "confirmed";
        it.resolvedByAdmin = true;
        it.expandedAfterResolve = false;
        showHudToast("✅ Zuordnung bestätigt");
        updateSingleReviewCardInDom(itemId);
      }

      function usePrevMessageForReviewSearch(itemId, queryText) {
        const inp = document.getElementById("revSearchInp_" + itemId);
        if (inp) {
          inp.value = String(queryText || "").trim();
          searchManualCandidatesForReviewItem(itemId);
        }
      }

      // Findet alle weiteren offenen Folgen derselben Serie in der Prüfliste (z. B. Axel will's wissen S01E09, S01E10, S01E12)
      function getMatchingOpenSeriesSiblingItems(baseItem, targetTmdbId = null) {
        if (!baseItem) return [];
        const allItems = backupImportJob.reviewItems || [];
        const normBase = normalizeClientCompareTitle(baseItem.cleanTitle || "");
        const effId = Number(targetTmdbId || baseItem.tmdbId || 0);
        return allItems.filter(x => {
          if (!x || x.resolvedByAdmin) return false;
          if (effId > 0 && Number(x.tmdbId || 0) === effId) return true;
          const normX = normalizeClientCompareTitle(x.cleanTitle || "");
          if (normBase && normX && normBase === normX) return true;
          return false;
        });
      }

      async function applyBackupCandidateRemap(itemId, newTmdbId, newTypeCode, options = null) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it || !newTmdbId) return false;
        syncReviewCardDomInputsToItemState(it);

        const cands = Array.isArray(it.candidates) ? it.candidates : [];
        const matchedCand = cands.find(c => Number(c.tmdbId) === Number(newTmdbId) && (c.typeCode || "m") === (newTypeCode === "s" ? "s" : "m")) || null;

        const seasonInp = document.getElementById("revSeasonInp_" + itemId);
        const epInp = document.getElementById("revEpInp_" + itemId);
        const rawFileName = it.rawFileName || it.rawEntry?.raw_file_name || it.rawEntry?.filename || it.rawInput || "";
        const rawTailMatch = String(rawFileName).replace(/\\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i, "").match(/(?:^|\\s|[-_])(?:teil\\s*|part\\s*|ep\\.?\\s*)?0*(\\d{1,2})\\s*$/i);
        const inferredTailEp = rawTailMatch ? parseInt(rawTailMatch[1], 10) : null;

        const fallbackSeason = matchedCand?.inferredSeason || it.season || 1;
        const fallbackEpisode = matchedCand?.inferredEpisode || it.episode || (inferredTailEp >= 1 && inferredTailEp <= 99 ? inferredTailEp : 1);

        const manualSeason = newTypeCode === "s"
          ? Math.max(1, parseInt(seasonInp ? seasonInp.value : fallbackSeason, 10) || fallbackSeason)
          : null;
        const manualEpisode = newTypeCode === "s"
          ? Math.max(1, parseInt(epInp ? epInp.value : fallbackEpisode, 10) || fallbackEpisode)
          : null;

        const candidateMeta = options?.candidateMeta || (matchedCand ? {
          id: Number(matchedCand.tmdbId),
          title: matchedCand.title || it.cleanTitle || "Unbekannt",
          originalTitle: matchedCand.originalTitle || matchedCand.title || "",
          year: matchedCand.year || it.year || "k.A.",
          poster: matchedCand.poster || it.poster || "",
          vote_average: Number(matchedCand.voteAverage || 0),
          source: matchedCand.source || it.metadataSource || "Fallback"
        } : {
          id: Number(newTmdbId),
          title: it.cleanTitle || "Unbekannt",
          year: it.year || "k.A.",
          poster: it.poster || "",
          source: it.metadataSource || "Fallback"
        });

        const activeChan = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
        const silentBusy = Boolean(options?.silentBusy);
        if (!silentBusy) {
          setBusyState(true, options?.isConfirmAction ? "💾 Speichere Bestätigung in D1 & Playlist..." : "🔄 Aktualisiere Zuordnung in D1 & Playlist...");
        }
        try {
          const r = await apiFetchJson(API_BASE + "/admin/remap-import-item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              oldTmdbId: it.tmdbId || null,
              oldTypeCode: it.typeCode || "m",
              oldSeason: it.season || null,
              oldEpisode: it.episode || null,
              newTmdbId: Number(newTmdbId),
              newTypeCode: newTypeCode === "s" ? "s" : "m",
              sourceChannelId: activeChan || "",
              messageId: it.messageId || it.rawEntry?.message_id || it.rawEntry?.msg_id || null,
              candidateMeta,
              rawEntry: it.rawEntry || { filename: it.rawInput },
              playlistFolderId: backupImportJob.playlistFolderId || null,
              playlistName: backupImportJob.customPlaylistName || "🎵 JSON-Import",
              playlistMode: backupImportJob.playlistMode || "both",
              targetChatId: backupImportJob.targetPlaylistChatId || chatId,
              season: manualSeason,
              episode: manualEpisode
            })
          });
          if (!r || !r.ok || !r.matchedItem) {
            if (!silentBusy) showHudToast("⚠️ " + (r?.error || "Speicherung fehlgeschlagen."));
            return false;
          }
          const wasFailed = it.status === "failed" || !it.tmdbId;
          const wasUncertain = Boolean(it.isUncertain);
          const prevType = it.typeCode;

          it.tmdbId = r.matchedItem.tmdbId;
          it.typeCode = r.matchedItem.typeCode;
          it.cleanTitle = r.matchedItem.cleanTitle;
          it.year = r.matchedItem.year;
          it.poster = r.matchedItem.poster;
          if (r.matchedItem.season) it.season = r.matchedItem.season;
          if (r.matchedItem.episode) it.episode = r.matchedItem.episode;
          if (r.matchedItem.episodeTitle) it.episodeTitle = r.matchedItem.episodeTitle;
          if (r.matchedItem.metadataSource) it.metadataSource = r.matchedItem.metadataSource;
          it.confidence = 100;
          it.isUncertain = false;
          it.status = options?.isConfirmAction ? "confirmed" : "remapped";
          it.resolvedByAdmin = true;
          it.expandedAfterResolve = false;

          if (wasFailed) {
            backupImportJob.failedCount = Math.max(0, backupImportJob.failedCount - 1);
            if (r.matchedItem.typeCode === "s") backupImportJob.seriesSaved++;
            else backupImportJob.moviesSaved++;
          } else {
            if (wasUncertain) backupImportJob.uncertainCount = Math.max(0, backupImportJob.uncertainCount - 1);
            if (prevType !== r.matchedItem.typeCode) {
              if (r.matchedItem.typeCode === "s") {
                backupImportJob.moviesSaved = Math.max(0, backupImportJob.moviesSaved - 1);
                backupImportJob.seriesSaved++;
              } else {
                backupImportJob.seriesSaved = Math.max(0, backupImportJob.seriesSaved - 1);
                backupImportJob.moviesSaved++;
              }
            }
          }

          saveBackupCheckpointClient(false);
          updateSingleReviewCardInDom(itemId);

          if (!silentBusy) {
            const seSuffix = r.matchedItem.typeCode === "s" && r.matchedItem.season && r.matchedItem.episode
              ? (" S" + String(r.matchedItem.season).padStart(2, "0") + "E" + String(r.matchedItem.episode).padStart(2, "0"))
              : "";
            showHudToast("✅ In D1 gespeichert: " + r.matchedItem.cleanTitle + seSuffix + " (" + r.matchedItem.year + ")");
          }
          return true;
        } finally {
          if (!silentBusy) setBusyState(false);
        }
      }

      // 1-Klick Sammel-Bestätigung für alle Folgen derselben Serie (jede Folge behält ihre eigene S/E Nummer!)
      async function confirmAllSeriesEpisodesInReview(itemId, targetTmdbId, targetTypeCode = "s") {
        const baseItem = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!baseItem) return;
        const effTmdbId = Number(targetTmdbId || baseItem.tmdbId || 0);
        if (!effTmdbId) return;

        const siblings = getMatchingOpenSeriesSiblingItems(baseItem, effTmdbId);
        if (siblings.length === 0) return;

        const cands = Array.isArray(baseItem.candidates) ? baseItem.candidates : [];
        const matchedCand = cands.find(c => Number(c.tmdbId) === effTmdbId) || null;
        const sharedCandidateMeta = matchedCand ? {
          id: effTmdbId,
          title: matchedCand.title || baseItem.cleanTitle || "Unbekannt",
          originalTitle: matchedCand.originalTitle || matchedCand.title || "",
          year: matchedCand.year || baseItem.year || "k.A.",
          poster: matchedCand.poster || baseItem.poster || "",
          vote_average: Number(matchedCand.voteAverage || 0),
          source: matchedCand.source || baseItem.metadataSource || "Fallback"
        } : {
          id: effTmdbId,
          title: baseItem.cleanTitle || "Unbekannt",
          year: baseItem.year || "k.A.",
          poster: baseItem.poster || "",
          source: baseItem.metadataSource || "Fallback"
        };

        let okCount = 0;
        setBusyState(true, "⚡ Speichere alle " + siblings.length + " Folgen von „" + (sharedCandidateMeta.title || baseItem.cleanTitle) + "“ in D1...");
        try {
          for (const sib of siblings) {
            const success = await applyBackupCandidateRemap(sib.id, effTmdbId, targetTypeCode || "s", {
              isConfirmAction: true,
              silentBusy: true,
              candidateMeta: sharedCandidateMeta
            });
            if (success) okCount++;
          }
          showHudToast("🎉 " + okCount + " / " + siblings.length + " Folgen von „" + (sharedCandidateMeta.title || baseItem.cleanTitle) + "“ in D1 gespeichert!");
        } finally {
          setBusyState(false);
        }
      }

      async function searchManualCandidatesForReviewItem(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        syncReviewCardDomInputsToItemState(it);
        const inp = document.getElementById("revSearchInp_" + itemId);
        const sel = document.getElementById("revSearchType_" + itemId);
        const q = (inp ? inp.value : it.cleanTitle || it.rawInput || "").trim();
        const typeVal = sel ? sel.value : "auto";
        if (!q) {
          showHudToast("⚠️ Bitte Suchbegriff oder TMDb-ID eingeben.");
          return;
        }
        it.manualSearchQuery = q;
        it.manualSearchType = typeVal;
        setBusyState(true, "🔍 Durchsuche alle 8 APIs nach „" + q + "“...");
        try {
          const r = await apiFetchJson(
            API_BASE + "/admin/tmdb-candidates?q=" + encodeURIComponent(q) + "&type=" + encodeURIComponent(typeVal)
          );
          if (r && Array.isArray(r.candidates)) {
            it.candidates = r.candidates;
            if (r.candidates.length === 0) showHudToast("ℹ️ Keine Treffer für „" + q + "“ gefunden.");
          }
          updateSingleReviewCardInDom(itemId);
        } finally {
          setBusyState(false);
        }
      }

      function renderSingleBackupReviewCardHtml(item, allItems) {
        const isFailed = item.status === "failed" || !item.tmdbId;
        const isResolved = Boolean(item.resolvedByAdmin);
        const seTag = item.season
          ? (" • S" + String(item.season).padStart(2, "0") + "E" + String(item.episode || 1).padStart(2, "0") + (item.episodeTitle ? (" – " + item.episodeTitle) : ""))
          : "";
        const rawEntry = item.rawEntry || {};
        const msgId = item.messageId || rawEntry.message_id || rawEntry.msg_id || null;
        const msgLink = item.messageLink || rawEntry.message_link || "";
        const rawFileName = item.rawFileName || rawEntry.raw_file_name || rawEntry.filename || "";
        const metaSrc = item.metadataSource || "TMDb";

        // KOMPAKTE GRÜNE ZEILE AN ORT UND STELLE: Sobald bestätigt/korrigiert, klappt die Karte platzsparend zusammen (ohne Scroll-Sprung!)
        if (isResolved && !item.expandedAfterResolve) {
          return '<div id="revCard_' + esc(item.id) + '" style="background:rgba(16,185,129,0.09);border:1px solid rgba(16,185,129,0.42);border-radius:10px;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:220px;flex:1">' +
              '<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(16,185,129,0.22);color:#34d399;border:1px solid rgba(16,185,129,0.45)">✅ In D1 gespeichert</span>' +
              '<span style="font-size:12.5px;font-weight:800;color:#fff">' +
                esc(item.cleanTitle || item.rawInput) + ' (' + esc(item.year || 'k.A.') + ')' +
              '</span>' +
              '<span style="font-size:11.5px;color:#38bdf8;font-weight:700">[' + (item.typeCode === 's' ? '📺 Serie' : '🎬 Film') + esc(seTag) + ' • ' + esc(item.quality || '1080p') + ']</span>' +
              (rawFileName ? '<code style="font-size:10.5px;color:#94a3b8;background:#0c0c12;padding:2px 6px;border-radius:4px">' + esc(rawFileName) + '</code>' : '') +
              (msgId ? '<span style="font-size:10.5px;color:#cbd5e1">💬 #' + esc(String(msgId)) + '</span>' : '') +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
              (item.tmdbId ? '<button type="button" class="btn" style="padding:3px 8px;font-size:11px" onclick="openDetails(\\'' + (item.typeCode || 'm') + '\\',' + Number(item.tmdbId) + ',false)">👁️ Vorschau</button>' : '') +
              '<button type="button" class="btn" style="padding:3px 8px;font-size:11px" onclick="reopenResolvedReviewCard(\\'' + esc(item.id) + '\\')">✏️ Bearbeiten</button>' +
            '</div>' +
          '</div>';
        }

        const badgeBg = isResolved
          ? "rgba(16,185,129,0.2);color:#34d399;border:1px solid rgba(16,185,129,0.4)"
          : isFailed
            ? "rgba(239,68,68,0.2);color:#f87171;border:1px solid rgba(239,68,68,0.4)"
            : "rgba(245,158,11,0.2);color:#fbbf24;border:1px solid rgba(245,158,11,0.4)";
        const badgeLabel = isResolved
          ? "✅ Korrigiert / Bestätigt"
          : isFailed
            ? "❌ Nicht erkannt"
            : ("⚠️ Unsicher (" + Number(item.confidence || 0) + "% Match)");

        const cands = Array.isArray(item.candidates) ? item.candidates : [];
        const rawText = item.rawText || rawEntry.raw_text || "";
        const parsedFrom = item.parsedFrom || rawEntry.parsed_from || "Dateiname";
        const prevMsgs = Array.isArray(item.prevMessages)
          ? item.prevMessages
          : (Array.isArray(rawEntry.prev_messages) ? rawEntry.prev_messages : []);
        const langs = Array.isArray(item.languages) && item.languages.length ? item.languages.join(", ").toUpperCase() : "DE";

        // Vorbelegung für Staffel (S) & Folge (E) aus erkannten Werten oder angehängter/eingebetteter Zahl im Dateinamen
        const rawBaseNoExt = String(rawFileName || item.rawInput || item.cleanTitle || "").replace(/\\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i, "");
        const rawTailMatch = rawBaseNoExt.match(/(?:^|\\s|[-_])(?:teil\\s*|part\\s*|ep\\.?\\s*)?0*(\\d{1,2})\\s*$/i);
        const rawMidMatch = !rawTailMatch ? rawBaseNoExt.match(/^(.{2,}?)\\s+(?:[-–]\\s*)?(?:teil\\s+|part\\s+|ep\\.?\\s*|folge\\s+)?0*(\\d{1,2})\\s+(?:[-–:]\\s*)?(.{3,})$/i) : null;
        const inferredEpNum = rawTailMatch ? parseInt(rawTailMatch[1], 10) : (rawMidMatch ? parseInt(rawMidMatch[2], 10) : null);
        const defaultSeasonVal = item.season || cands[0]?.inferredSeason || 1;
        const defaultEpisodeVal = item.episode || cands[0]?.inferredEpisode || (inferredEpNum >= 1 && inferredEpNum <= 99 ? inferredEpNum : 1);

        // Prüfen, ob mehrere offene Folgen derselben Serie in der Prüfliste liegen (für 1-Klick Sammel-Bestätigung)
        const seriesSiblings = (item.typeCode === "s" || item.season || item.episode || cands[0]?.typeCode === "s")
          ? getMatchingOpenSeriesSiblingItems(item, item.tmdbId || cands[0]?.tmdbId || null)
          : [];
        const batchTmdbId = Number(item.tmdbId || cands[0]?.tmdbId || 0);

        return '<div id="revCard_' + esc(item.id) + '" style="background:#101015;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:12px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
            '<div style="flex:1;min-width:220px">' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px">' +
                '<span style="font-size:10.5px;background:#1e293b;color:#38bdf8;padding:2px 7px;border-radius:5px;font-weight:700">🔎 Quelle: ' + esc(parsedFrom) + '</span>' +
                '<span style="font-size:10.5px;background:#1e293b;color:#a78bfa;padding:2px 7px;border-radius:5px;font-weight:700">🌐 Audio: ' + esc(langs) + '</span>' +
                (msgId ? '<span style="font-size:10.5px;background:#1e293b;color:#cbd5e1;padding:2px 7px;border-radius:5px">💬 Msg #' + esc(String(msgId)) + '</span>' : '') +
                (msgLink ? '<a href="' + esc(msgLink) + '" target="_blank" rel="noopener noreferrer" style="font-size:10.5px;background:rgba(14,165,233,0.2);color:#38bdf8;border:1px solid rgba(56,189,248,0.4);padding:2px 8px;border-radius:5px;text-decoration:none;font-weight:800">🔗 Nachricht in Telegram öffnen ↗</a>' : '') +
              '</div>' +
              '<div style="font-size:12.5px;font-weight:800;color:#fff;margin-top:4px">' +
                (item.tmdbId
                  ? ('Aktuell zugeordnet (' + esc(metaSrc) + '): <span style="color:#38bdf8">' + esc(item.cleanTitle) + ' (' + esc(item.year || 'k.A.') + ')</span> [' + (item.typeCode === 's' ? '📺 Serie' : '🎬 Film') + seTag + ' • ' + esc(item.quality || '1080p') + ']')
                  : ('Kein automatischer Treffer für: <span style="color:#f87171">' + esc(item.cleanTitle || item.rawInput) + '</span>')) +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
              '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;background:' + badgeBg + '">' + badgeLabel + '</span>' +
              (item.tmdbId && !isResolved ? '<button type="button" class="btn green" style="padding:4px 9px;font-size:11px" onclick="confirmBackupReviewItem(\\'' + esc(item.id) + '\\')">✓ Passt so</button>' : '') +
              (seriesSiblings.length >= 2 && batchTmdbId > 0 ? '<button type="button" class="btn green" style="padding:4px 9px;font-size:11px;background:linear-gradient(90deg,#059669,#0284c7);border-color:#38bdf8" onclick="confirmAllSeriesEpisodesInReview(\\'' + esc(item.id) + '\\',' + batchTmdbId + ',\\'s\\')" title="Speichert alle ' + seriesSiblings.length + ' offenen Folgen dieser Serie jeweils mit ihrer eigenen Staffel/Folge (z.B. S01E09, S01E10, S01E12) in D1">⚡ Alle ' + seriesSiblings.length + ' Folgen bestätigen</button>' : '') +
              (item.tmdbId ? '<button type="button" class="btn" style="padding:4px 9px;font-size:11px" onclick="openDetails(\\'' + (item.typeCode || 'm') + '\\',' + Number(item.tmdbId) + ',false)">👁️ Vorschau</button>' : '') +
              (isResolved ? '<button type="button" class="btn" style="padding:4px 9px;font-size:11px" onclick="collapseResolvedReviewCard(\\'' + esc(item.id) + '\\')">🔼 Einklappen</button>' : '') +
            '</div>' +
          '</div>' +
          '<div style="background:#15151e;border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:9px;margin-bottom:8px;font-size:11.5px;display:flex;flex-direction:column;gap:5px">' +
            (rawFileName ? '<div><b style="color:#94a3b8">💾 Dateiname (file_name):</b> <code style="color:#f1f5f9;background:#0c0c12;padding:2px 6px;border-radius:4px;word-break:break-all">' + esc(rawFileName) + '</code></div>' : '') +
            (rawText ? '<div><b style="color:#94a3b8">📝 Volltext / Caption dieser Nachricht:</b> <div style="color:#cbd5e1;background:#0c0c12;padding:5px 8px;border-radius:5px;margin-top:3px;max-height:76px;overflow-y:auto;white-space:pre-wrap;font-size:11px">' + esc(rawText) + '</div></div>' : '') +
            (prevMsgs.length > 0 ? (
              '<div style="margin-top:3px;padding-top:6px;border-top:1px dashed rgba(255,255,255,0.12)">' +
                '<div style="font-size:11px;font-weight:800;color:#fbbf24;margin-bottom:4px">⬆️ Die ' + prevMsgs.length + ' Nachrichten direkt über dieser Videodatei (Steckbrief / Titel-Kontext):</div>' +
                '<div style="display:flex;flex-direction:column;gap:5px">' +
                  prevMsgs.map((pm, pIdx) => {
                    const labelIdx = prevMsgs.length === 2 ? (pIdx === 0 ? "2 Nachrichten darüber" : "1 Nachricht direkt darüber") : "Nachricht direkt darüber";
                    return '<div style="background:#0d0d14;border:1px solid rgba(251,191,36,0.25);border-radius:6px;padding:6px 8px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                      '<div style="flex:1;min-width:180px;font-size:11px;color:#e2e8f0">' +
                        '<span style="color:#fbbf24;font-weight:800">[' + labelIdx + (pm.msgId ? ' • #' + esc(String(pm.msgId)) : '') + ']</span> ' +
                        esc(pm.text || '(Kein Text)') +
                      '</div>' +
                      '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                        (pm.titleGuess ? '<button type="button" class="btn amber" style="padding:3px 8px;font-size:10.5px" onclick="usePrevMessageForReviewSearch(\\'' + esc(item.id) + '\\',\\'' + esc(pm.titleGuess) + '\\')">🔍 „' + esc(pm.titleGuess.slice(0, 28)) + '“ suchen</button>' : '') +
                        (pm.tmdbId ? '<button type="button" class="btn green" style="padding:3px 8px;font-size:10.5px" onclick="applyBackupCandidateRemap(\\'' + esc(item.id) + '\\',' + Number(pm.tmdbId) + ',\\'' + (pm.mediaType === 'tv' ? 's' : 'm') + '\\')">🎯 TMDb #' + Number(pm.tmdbId) + ' direkt zuweisen</button>' : '') +
                      '</div>' +
                    '</div>';
                  }).join("") +
                '</div>' +
              '</div>'
            ) : '') +
          '</div>' +
          (cands.length > 0 ? (
            '<div style="margin-bottom:8px">' +
              '<div style="font-size:11px;color:#94a3b8;margin-bottom:5px">🎯 <b>Gefundene Kandidaten (8 APIs – 1-Klick Übernahme inkl. gewählter Staffel/Folge):</b></div>' +
              '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">' +
                cands.map(c => {
                  const isCurrent = item.tmdbId && Number(item.tmdbId) === Number(c.tmdbId) && item.typeCode === c.typeCode;
                  const srcLabel = c.source || "TMDb";
                  const seBadge = c.typeCode === "s" && c.inferredEpisode
                    ? (' <span style="background:rgba(168,85,247,0.25);color:#e9d5ff;padding:1px 5px;border-radius:4px;font-weight:800">S' + String(c.inferredSeason || 1).padStart(2, "0") + 'E' + String(c.inferredEpisode).padStart(2, "0") + '</span>')
                    : '';
                  return '<div style="min-width:215px;max-width:255px;background:' + (isCurrent ? 'rgba(16,185,129,0.14)' : '#181822') + ';border:1px solid ' + (isCurrent ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.12)') + ';border-radius:8px;padding:7px;display:flex;gap:8px;align-items:center;flex-shrink:0">' +
                    (c.poster
                      ? '<img src="' + esc(c.poster) + '" style="width:38px;height:56px;object-fit:cover;border-radius:5px;flex-shrink:0" alt="" />'
                      : '<div style="width:38px;height:56px;background:#252532;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">' + (c.typeCode === 's' ? '📺' : '🎬') + '</div>') +
                    '<div style="flex:1;min-width:0">' +
                      '<div style="font-size:11.5px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(c.title) + '">' + esc(c.title) + '</div>' +
                      '<div style="font-size:10px;color:#94a3b8;margin-top:2px">' +
                        (c.typeCode === 's' ? '📺 Serie' : '🎬 Film') + seBadge + ' • ' + esc(c.year || 'k.A.') + ' • <b style="color:#38bdf8">' + esc(srcLabel) + '</b> (' + Number(c.confidence || 0) + '%)' +
                      '</div>' +
                      '<div style="display:flex;gap:4px;margin-top:5px">' +
                        '<button type="button" class="btn ' + (isCurrent ? 'green' : 'amber') + '" style="padding:3px 8px;font-size:10.5px;flex:1" onclick="applyBackupCandidateRemap(\\'' + esc(item.id) + '\\',' + Number(c.tmdbId) + ',\\'' + (c.typeCode === 's' ? 's' : 'm') + '\\')">' +
                          (isCurrent ? '✓ Aktiv (Speichern)' : '✓ Auswählen') +
                        '</button>' +
                        (c.typeCode === 's' && seriesSiblings.length >= 2 ? '<button type="button" class="btn green" style="padding:3px 6px;font-size:10px" title="Alle ' + seriesSiblings.length + ' Folgen dieser Serie auf diesen Kandidaten zuweisen" onclick="confirmAllSeriesEpisodesInReview(\\'' + esc(item.id) + '\\',' + Number(c.tmdbId) + ',\\'s\\')">⚡ Alle ' + seriesSiblings.length + '</button>' : '') +
                      '</div>' +
                    '</div>' +
                  '</div>';
                }).join("") +
              '</div>' +
            '</div>'
          ) : '') +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px">' +
            '<select id="revSearchType_' + esc(item.id) + '" style="padding:5px 8px;border-radius:6px;background:#16161e;color:#fff;border:1px solid rgba(255,255,255,0.18);font-size:11.5px">' +
              '<option value="auto"' + ((item.manualSearchType || 'auto') === 'auto' ? ' selected' : '') + '>🔄 Auto (Film & Serie)</option>' +
              '<option value="m"' + (item.manualSearchType === 'm' ? ' selected' : '') + '>🎬 Nur Filme</option>' +
              '<option value="s"' + (item.manualSearchType === 's' ? ' selected' : '') + '>📺 Nur Serien</option>' +
            '</select>' +
            '<div style="display:flex;align-items:center;gap:4px;background:#16161e;border:1px solid rgba(168,85,247,0.45);border-radius:6px;padding:3px 7px" title="Staffel & Folge für Serien-Zuordnung (z.B. S01E01)">' +
              '<span style="font-size:10.5px;font-weight:800;color:#c084fc">S</span>' +
              '<input id="revSeasonInp_' + esc(item.id) + '" type="number" min="1" max="99" value="' + (Number(defaultSeasonVal) || 1) + '" onchange="syncReviewCardDomInputsToItemState((backupImportJob.reviewItems||[]).find(x=>String(x.id)===\\'' + esc(item.id) + '\\'))" style="width:42px;padding:2px 4px;border-radius:4px;background:#0c0c12;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px;font-weight:800;text-align:center" />' +
              '<span style="font-size:10.5px;font-weight:800;color:#c084fc">E</span>' +
              '<input id="revEpInp_' + esc(item.id) + '" type="number" min="1" max="999" value="' + (Number(defaultEpisodeVal) || 1) + '" onchange="syncReviewCardDomInputsToItemState((backupImportJob.reviewItems||[]).find(x=>String(x.id)===\\'' + esc(item.id) + '\\'))" style="width:46px;padding:2px 4px;border-radius:4px;background:#0c0c12;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px;font-weight:800;text-align:center" />' +
            '</div>' +
            '<input id="revSearchInp_' + esc(item.id) + '" value="' + esc(item.manualSearchQuery || item.cleanTitle || '') + '" placeholder="Manueller Titel oder TMDb-ID (z.B. 603)..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();searchManualCandidatesForReviewItem(\\'' + esc(item.id) + '\\')}" style="flex:1;min-width:160px;padding:5px 9px;border-radius:6px;background:#16161e;color:#fff;border:1px solid rgba(255,255,255,0.18);font-size:11.5px" />' +
            '<button type="button" class="btn" style="padding:5px 10px;font-size:11.5px" onclick="searchManualCandidatesForReviewItem(\\'' + esc(item.id) + '\\')">🔍 Alle 8 APIs durchsuchen</button>' +
          '</div>' +
        '</div>';
      }

      function renderBackupReviewTabHtml(j) {
        const allItems = j.reviewItems || [];
        const needsAttentionOpenCount = allItems.filter(x => !x.resolvedByAdmin && (x.status === "failed" || x.isUncertain)).length;
        const uncertainOpenCount = allItems.filter(x => !x.resolvedByAdmin && x.isUncertain && x.status !== "failed").length;
        const failedOpenCount = allItems.filter(x => !x.resolvedByAdmin && x.status === "failed").length;

        // Damit bestätigte Karten an Ort und Stelle grün eingeklappt stehen bleiben (statt die Liste unter dem Mauszeiger wegzuziehen!),
        // behalten wir bereits in dieser Sitzung bestätigte Einträge (x.resolvedByAdmin) als kompakte grüne Zeile in der Liste.
        let visibleList = allItems.filter(x => x.status === "failed" || x.isUncertain || x.resolvedByAdmin);
        if (j.reviewFilter === "uncertain") visibleList = allItems.filter(x => (x.isUncertain && x.status !== "failed") || x.resolvedByAdmin);
        else if (j.reviewFilter === "failed") visibleList = allItems.filter(x => x.status === "failed");
        else if (j.reviewFilter === "all") visibleList = allItems;

        return '<div style="margin-top:10px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button id="revBtnNeeds" class="btn ' + (j.reviewFilter === 'needs_attention' ? 'amber' : '') + '" onclick="setBackupReviewFilter(\\'needs_attention\\')">⚠️ Prüfbedarf (' + needsAttentionOpenCount + ')</button>' +
              '<button id="revBtnUncertain" class="btn ' + (j.reviewFilter === 'uncertain' ? 'amber' : '') + '" onclick="setBackupReviewFilter(\\'uncertain\\')">🔎 Unsichere Treffer (' + uncertainOpenCount + ')</button>' +
              '<button id="revBtnFailed" class="btn ' + (j.reviewFilter === 'failed' ? 'red' : '') + '" onclick="setBackupReviewFilter(\\'failed\\')">❌ Nicht erkannt (' + failedOpenCount + ')</button>' +
              '<button id="revBtnAll" class="btn ' + (j.reviewFilter === 'all' ? 'green' : '') + '" onclick="setBackupReviewFilter(\\'all\\')">📋 Alle importierten (' + allItems.length + ')</button>' +
            '</div>' +
            '<span style="font-size:11.5px;color:#94a3b8">💡 Bestätigte Karten klappen grün an Ort & Stelle zusammen (kein Listen-Springen!)</span>' +
          '</div>' +
          (visibleList.length === 0 ? (
            '<div style="background:#101016;border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:16px;text-align:center;color:#34d399;font-size:12.5px">' +
              (allItems.length === 0
                ? 'ℹ️ Starte zuerst den Smart-Import, um Zuordnungen live zu prüfen oder zu korrigieren.'
                : '🎉 Perfekt! Keine offenen unsicheren oder fehlerhaften Einträge in dieser Ansicht.') +
            '</div>'
          ) : (
            '<div id="backupReviewScrollContainer" style="display:flex;flex-direction:column;gap:12px;max-height:640px;overflow-y:auto;padding-right:4px">' +
              visibleList.slice(0, 80).map(item => renderSingleBackupReviewCardHtml(item, allItems)).join("") +
            '</div>'
          )) +
        '</div>';
      }

      function renderBackupImportBoxDom() {
        const mount = document.getElementById("backupImportLiveMount");
        if (!mount) return;
        const j = backupImportJob;
        // Aktuelle Scroll-Position und offene Eingaben im Review-Tab vor einem Komplett-Render sichern
        const oldScrollEl = document.getElementById("backupReviewScrollContainer");
        const savedReviewScrollTop = oldScrollEl ? oldScrollEl.scrollTop : null;
        if (j.activeSubTab === "review" && Array.isArray(j.reviewItems)) {
          for (const it of j.reviewItems) syncReviewCardDomInputsToItemState(it);
        }
        const activeChan = j.verifiedChannelId || getSavedVerifiedChannelIdClient();
        const isChanVerified = Boolean(activeChan && (activeChan.startsWith("-100") || activeChan.startsWith("@")));
        const fileInp = document.getElementById("backupJsonFileInputEl");
        if (fileInp) {
          fileInp.disabled = !isChanVerified;
          fileInp.style.opacity = isChanVerified ? "1" : "0.45";
        }

        const total = j.entries.length;
        const done = j.cursor;
        const pct = total > 0 ? ((done / total) * 100).toFixed(1) : "0.0";
        const elapsedSec = j.startedAt ? Math.max(1, (Date.now() - j.startedAt) / 1000) : 1;
        const speedPerSec = done > 0 ? (done / elapsedSec).toFixed(1) : "0.0";
        const remCount = Math.max(0, total - done);
        const etaSec = done > 0 && Number(speedPerSec) > 0 ? Math.round(remCount / Number(speedPerSec)) : 0;
        const etaStr = etaSec > 3600
          ? (Math.floor(etaSec / 3600) + "h " + Math.floor((etaSec % 3600) / 60) + "m")
          : etaSec > 60
            ? (Math.floor(etaSec / 60) + "m " + (etaSec % 60) + "s")
            : (etaSec + "s");

        if (!j.fileName) {
          const savedCp = loadBackupCheckpointClient();
          const cpHintHtml = (savedCp && Number(savedCp.cursor) > 0 && Number(savedCp.totalEntries) > 0)
            ? ('<div style="background:rgba(245,158,11,0.14);border:1px solid rgba(251,191,36,0.45);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:#fde68a">' +
                '📌 <b>Gespeicherter Import-Checkpoint gefunden:</b> Datei <b>' + esc(savedCp.fileName || 'result.json') + '</b> bei Eintrag <b>#' + Number(savedCp.cursor).toLocaleString('de-DE') + ' / ' + Number(savedCp.totalEntries).toLocaleString('de-DE') + '</b> (' + Math.round((savedCp.cursor / savedCp.totalEntries) * 100) + '%).<br/>' +
                '<span style="color:#cbd5e1;font-size:11.5px">👉 Wähle oben dieselbe <code>.json</code> Datei erneut aus, um nahtlos an dieser Stelle weiterzumachen oder ab 0 (ohne Duplikate) neu zu starten!</span>' +
              '</div>')
            : '';

          mount.innerHTML = cpHintHtml + '<div style="font-size:12px;color:#94a3b8">' +
            (isChanVerified
              ? ('✅ Quell-Kanal <code>' + esc(activeChan) + '</code> ist verifiziert. Bitte wähle jetzt oben deine <code>result.json</code> Datei aus.')
              : '🔒 <b>JSON-Upload gesperrt:</b> Bitte gib zuerst in Schritt 1 die Telegram Kanal-ID (<code>-100...</code>) oder einen Nachrichten-Link ein und klicke auf <b>🔍 Kanal prüfen & freischalten</b>.') +
            '</div>';
          return;
        }

        const openReviewCount = (j.reviewItems || []).filter(x => !x.resolvedByAdmin && (x.status === "failed" || x.isUncertain)).length;
        const totalDeduplicated = Number(j.duplicatesSkippedInFile || 0) + Number(j.duplicatesInDb || 0);
        const totalMergedStreams = Number(j.mergedQualitiesInDb || 0) + (done === 0 ? Number(j.qualityVariantsInFile || 0) : 0);
        const curMode = j.playlistMode || "both";

        const checkpointBannerHtml = (!j.running && done > 0 && done < total)
          ? ('<div style="background:rgba(245,158,11,0.16);border:1px solid rgba(251,191,36,0.5);border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div style="font-size:12px;color:#fde68a">' +
                '📌 <b>Gespeicherter Fortschritts-Checkpoint bei Eintrag #' + done.toLocaleString('de-DE') + ' / ' + total.toLocaleString('de-DE') + ' (' + pct + '%)</b> erkannt!' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="btn green" onclick="resumeBackupFromCheckpointClient()">▶️ Bei #' + done.toLocaleString('de-DE') + ' fortsetzen</button>' +
                '<button class="btn amber" onclick="restartBackupFromZeroNoDupesClient()">🔄 Neu starten ab 0 (ohne Duplikate)</button>' +
              '</div>' +
            '</div>')
          : '';

        mount.innerHTML =
          '<div style="background:#141414;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:12px;margin-top:10px">' +
            checkpointBannerHtml +
            (j.repaired ? (
              '<div style="background:rgba(2,132,199,0.18);border:1px solid rgba(56,189,248,0.45);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px;color:#e0f2fe">' +
                '🛠️ <b>JSON Auto-Repair erfolgreich:</b> ' + esc((j.repairNotes || []).join(" • ")) +
              '</div>'
            ) : '') +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
              '<div>' +
                '<span style="font-size:11.5px;font-weight:800;padding:3px 8px;border-radius:999px;background:' + (j.isTelegramBackup ? 'rgba(2,132,199,0.25);color:#38bdf8;border:1px solid rgba(56,189,248,0.4)' : 'rgba(16,185,129,0.2);color:#34d399') + '">' +
                  (j.isTelegramBackup ? ('📦 TELEGRAM CHAT-BACKUP: ' + esc(j.backupChatName)) : '📄 STANDARD JSON-TITELLISTE') +
                '</span>' +
                '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;background:rgba(16,185,129,0.2);color:#34d399;margin-left:6px">📡 Kanal: ' + esc(activeChan || 'Verifiziert') + '</span>' +
                '<div style="font-size:12px;color:#ccc;margin-top:6px">' +
                  'Datei: <b>' + esc(j.fileName) + '</b> (' + j.fileSizeMb + ' MB) • Roh-Nachrichten: <b>' + j.rawMessageCount.toLocaleString('de-DE') + '</b> ➔ Zu verarbeitende Einträge: <b style="color:#fbbf24">' + total.toLocaleString('de-DE') + '</b>' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                (!j.running && done < total ? '<button class="btn green" onclick="startOrResumeBackupImport()">🚀 ' + (done > 0 ? ('Fortsetzen ab #' + done.toLocaleString('de-DE')) : ('Smart-Import starten (' + total.toLocaleString('de-DE') + ')')) + '</button>' : '') +
                (j.running ? '<button class="btn amber" onclick="pauseBackupImport()">⏸️ Pausieren (Checkpoint speichern)</button>' : '') +
                (done > 0 && !j.running ? '<button class="btn amber" onclick="restartBackupFromZeroNoDupesClient()">🔄 Ab 0 neu starten (ohne Duplikate)</button>' : '') +
                (done > 0 ? '<button class="btn red" onclick="resetBackupImport(true)">↺ Zurücksetzen</button>' : '') +
              '</div>' +
            '</div>' +

            (done === 0 && !j.running ? (
              '<div style="background:#181820;border:1px solid rgba(251,191,36,0.3);border-radius:8px;padding:10px;margin-bottom:10px">' +
                '<div style="font-size:12px;font-weight:800;color:#fbbf24;margin-bottom:6px">🔎 Vorab-Analyse & Smart-Deduplizierung (bereit zum Start):</div>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;font-size:11.5px;margin-bottom:8px">' +
                  '<div style="background:#121218;padding:7px 9px;border-radius:6px">🎬 Erkannte Filme: <b style="color:#34d399">' + Number(j.detectedMoviesCount || 0).toLocaleString('de-DE') + '</b></div>' +
                  '<div style="background:#121218;padding:7px 9px;border-radius:6px">📺 Erkannte Serien/Folgen: <b style="color:#38bdf8">' + Number(j.detectedSeriesCount || 0).toLocaleString('de-DE') + '</b></div>' +
                  '<div style="background:#121218;padding:7px 9px;border-radius:6px">♻️ Exakte Duplikate gefiltert: <b style="color:#a78bfa">' + Number(j.duplicatesSkippedInFile || 0).toLocaleString('de-DE') + '</b></div>' +
                  '<div style="background:#121218;padding:7px 9px;border-radius:6px">🔗 Weitere Qualitäten/Parts: <b style="color:#fbbf24">' + Number(j.qualityVariantsInFile || 0).toLocaleString('de-DE') + '</b></div>' +
                '</div>' +
                (Array.isArray(j.previewSamples) && j.previewSamples.length > 0 ? (
                  '<div style="font-size:11px;color:#94a3b8">' +
                    '<b>Vorschau erkannter Titel:</b> ' +
                    j.previewSamples.map(s =>
                      '<span style="display:inline-block;background:#101015;border:1px solid rgba(255,255,255,0.12);border-radius:5px;padding:2px 6px;margin:2px;color:#e2e8f0">' +
                        (s.isSeries ? '📺 ' : '🎬 ') + esc(s.cleanTitle) + (s.year && s.year !== 'k.A.' ? ' (' + esc(s.year) + ')' : '') + ' [' + esc(s.quality) + (s.isQualityVariant ? ' • 🔗 Merge' : '') + ']' +
                      '</span>'
                    ).join("") +
                  '</div>'
                ) : '') +
              '</div>'
            ) : '') +

            '<div style="background:#1c1c24;padding:10px;border-radius:8px;border:1px solid rgba(16,185,129,0.35);margin-bottom:10px;display:flex;flex-direction:column;gap:8px">' +
              '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
                '<span style="font-size:12px;font-weight:800;color:#34d399">🎵 Ziel-Playlist (automatisch aus Backup-Namen):</span>' +
                '<input id="backupPlaylistNameInp" value="' + esc(j.customPlaylistName || "🎵 JSON-Import") + '" oninput="updateBackupCustomPlaylistName(this.value)" placeholder="Custom Playlist Name..." style="flex:1;min-width:200px;padding:7px 10px;border-radius:6px;background:#101014;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:12px" />' +
                (j.playlistFolderId ? '<span style="font-size:11px;color:#38bdf8">✅ Verknüpft (' + esc(j.playlistFolderId) + ')</span>' : '<span style="font-size:11px;color:#94a3b8">Wird beim Start automatisch angelegt</span>') +
              '</div>' +
              '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
                '<span style="font-size:11.5px;color:#cbd5e1;font-weight:700">⚙️ Playlist-Modus wählen (später im Admin jederzeit umschaltbar):</span>' +
                '<button type="button" class="btn ' + (curMode === 'both' ? 'green' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setBackupPlaylistModeClient(\\'both\\')">⚡ Beides: VIP-Stream + Merkliste</button>' +
                '<button type="button" class="btn ' + (curMode === 'vip_stream' ? 'amber' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setBackupPlaylistModeClient(\\'vip_stream\\')">🌟 Nur VIP-Stream-Playlist (Bot-VIP)</button>' +
                '<button type="button" class="btn ' + (curMode === 'watchlist' ? 'blue' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setBackupPlaylistModeClient(\\'watchlist\\')">🔖 Nur persönliche Merkliste</button>' +
              '</div>' +
            '</div>' +

            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:8px">' +
              '<button class="btn ' + (j.activeSubTab !== 'review' && j.activeSubTab !== 'diaglog' ? 'red' : '') + '" onclick="switchBackupSubTab(\\'dashboard\\')">📊 Live-Fortschritt & Poster-Feed</button>' +
              '<button id="revSubTabBtn" class="btn ' + (j.activeSubTab === 'review' ? 'amber' : '') + '" onclick="switchBackupSubTab(\\'review\\')">' +
                '🛠️ Prüfen & Korrigieren' +
                (openReviewCount > 0 ? ' <span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:999px;font-size:10.5px;margin-left:4px">' + openReviewCount + '</span>' : ' (' + (j.reviewItems || []).length + ')') +
              '</button>' +
              '<button class="btn ' + (j.activeSubTab === 'diaglog' ? 'blue' : '') + '" onclick="switchBackupSubTab(\\'diaglog\\')">' +
                '🛠️ Diagnose-Log (' + getDiagnosticLogTotalCountClient() + ')' +
              '</button>' +
            '</div>' +

            (j.activeSubTab === "review" ? renderBackupReviewTabHtml(j) : j.activeSubTab === "diaglog" ? renderImportDiagnosticLogBoxHtml() : (
              '<div style="width:100%;height:22px;background:#222;border-radius:999px;overflow:hidden;border:1px solid rgba(255,255,255,0.15);position:relative;margin:10px 0">' +
                '<div style="width:' + Math.min(100, Number(pct)) + '%;height:100%;background:linear-gradient(90deg,#e50914,#10b981);transition:width 0.25s ease"></div>' +
                '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:900;color:#fff;text-shadow:0 1px 4px #000">' +
                  pct + '% (' + done.toLocaleString('de-DE') + ' / ' + total.toLocaleString('de-DE') + ')' +
                '</div>' +
              '</div>' +
              '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px;font-size:12px;margin-top:8px">' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">🎬 Filme in D1: <b style="color:#34d399">' + j.moviesSaved.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">📺 Serien in D1: <b style="color:#38bdf8">' + j.seriesSaved.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">♻️ Duplikate gefiltert: <b style="color:#a78bfa">' + totalDeduplicated.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">🔗 Qualitäten gemerged: <b style="color:#fbbf24">' + totalMergedStreams.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px;cursor:pointer" onclick="switchBackupSubTab(\\'review\\')">⚠️ Unsicher / Prüfen: <b style="color:#f59e0b">' + j.uncertainCount.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px;cursor:pointer" onclick="setBackupReviewFilter(\\'failed\\');switchBackupSubTab(\\'review\\')">❌ Nicht erkannt: <b style="color:#f87171">' + j.failedCount.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px;cursor:pointer" onclick="switchBackupSubTab(\\'diaglog\\')">🛠️ Diagnose-Log: <b style="color:#60a5fa">' + getDiagnosticLogTotalCountClient() + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">⚡ Tempo: <b>' + speedPerSec + ' Titel/s</b>' + (j.running && etaSec > 0 ? ' (ETA ~' + etaStr + ')' : '') + '</div>' +
              '</div>' +
              (Array.isArray(j.livePosterFeed) && j.livePosterFeed.length > 0 ? (
                '<div style="margin-top:10px">' +
                  '<div style="font-size:11.5px;font-weight:800;color:#cbd5e1;margin-bottom:6px">🎞️ Zuletzt zugeordnete Titel (Live-Feed):</div>' +
                  '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">' +
                    j.livePosterFeed.slice(0, 8).map(f => {
                      const fSeCode = (f.typeCode === 's' && f.season)
                        ? ('S' + String(f.season).padStart(2, '0') + 'E' + String(f.episode || 1).padStart(2, '0'))
                        : '';
                      const fPoster = resolvePosterUrlClient(f.poster, 'w185', '');
                      return '<div style="min-width:155px;max-width:185px;background:#181820;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px;display:flex;gap:7px;align-items:center;flex-shrink:0">' +
                        (fPoster
                          ? '<img src="' + esc(fPoster) + '" style="width:34px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0" alt="" />'
                          : '<div style="width:34px;height:50px;background:#252530;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + (f.typeCode === 's' ? '📺' : '🎬') + '</div>') +
                        '<div style="min-width:0;flex:1">' +
                          '<div style="font-size:11px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(f.cleanTitle) + '</div>' +
                          '<div style="font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (fSeCode ? ('<b style="color:#38bdf8">' + esc(fSeCode) + '</b> • ') : '') + esc(f.year || 'k.A.') + ' • ' + esc(f.quality || '1080p') + '</div>' +
                          '<div style="font-size:9.5px;margin-top:2px;color:' + (f.isUncertain ? '#fbbf24' : f.ingestStatus === 'merged_quality' ? '#38bdf8' : '#34d399') + '">' +
                            esc(f.metadataSource || 'TMDb') + ' • ' + (f.isUncertain ? ('⚠️ ' + f.confidence + '%') : f.ingestStatus === 'merged_quality' ? '🔗 Merge' : f.ingestStatus === 'duplicate' ? '♻️ In D1' : ('✅ ' + f.confidence + '%')) +
                          '</div>' +
                        '</div>' +
                      '</div>';
                    }).join("") +
                  '</div>' +
                '</div>'
              ) : '') +
              (j.recentLog.length > 0 ? (
                '<div style="margin-top:8px;font-size:11px;color:#94a3b8;max-height:90px;overflow-y:auto;background:#101014;padding:6px 8px;border-radius:6px;font-family:monospace">' +
                  j.recentLog.slice(-6).map(l => '<div>' + esc(l) + '</div>').join("") +
                '</div>'
              ) : '')
            )) +
          '</div>';

        // Nach einem Komplett-Render die exakte Scroll-Position des Review-Containers wiederherstellen
        if (savedReviewScrollTop !== null && savedReviewScrollTop > 0) {
          const newScrollEl = document.getElementById("backupReviewScrollContainer");
          if (newScrollEl) newScrollEl.scrollTop = savedReviewScrollTop;
        }
      }

      // =========================================================================
      // PERSISTENTES DIAGNOSE-LOG (D1 + Browser localStorage + KI-Analyse-Export)
      // =========================================================================
      const CLIENT_DIAG_LOG_STORAGE_KEY = "tma_import_diagnostic_logs_v1";
      let clientDiagnosticLogState = {
        logs: [],
        loadedFromLocal: false,
        filterStatus: "ALL",
        searchQuery: "",
        syncing: false
      };

      function loadClientDiagnosticLogsFromStorage() {
        if (clientDiagnosticLogState.loadedFromLocal) return clientDiagnosticLogState.logs;
        clientDiagnosticLogState.loadedFromLocal = true;
        try {
          const raw = localStorage.getItem(CLIENT_DIAG_LOG_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) clientDiagnosticLogState.logs = parsed.slice(0, 1200);
          }
        } catch (e) {}
        return clientDiagnosticLogState.logs;
      }

      function saveClientDiagnosticLogsToStorage() {
        try {
          localStorage.setItem(CLIENT_DIAG_LOG_STORAGE_KEY, JSON.stringify((clientDiagnosticLogState.logs || []).slice(0, 1000)));
        } catch (e) {}
      }

      function getDiagnosticLogTotalCountClient() {
        loadClientDiagnosticLogsFromStorage();
        return (clientDiagnosticLogState.logs || []).length;
      }

      function appendClientDiagnosticLogs(newEntries = [], syncToServer = true) {
        if (!Array.isArray(newEntries) || newEntries.length === 0) return;
        loadClientDiagnosticLogsFromStorage();
        const existingIndexByKey = new Map();
        (clientDiagnosticLogState.logs || []).forEach((l, idx) => {
          const k = String(l.msgId || "") + "|" + String(l.fileName || "");
          if (!existingIndexByKey.has(k)) existingIndexByKey.set(k, idx);
        });
        const added = [];
        for (const raw of newEntries) {
          if (!raw) continue;
          const entry = {
            id: raw.id || ("diag_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
            msgId: raw.msgId ?? raw.msg_id ?? null,
            fileName: String(raw.fileName || raw.file_name || raw.rawFileName || "Unbekannt").slice(0, 260),
            rawText: String(raw.rawText || raw.raw_text || "").slice(0, 500),
            status: String(raw.status || "OK").toUpperCase(),
            reason: String(raw.reason || "").slice(0, 360),
            detectedType: String(raw.detectedType || raw.detected_type || "auto"),
            parsedTitle: String(raw.parsedTitle || raw.parsed_title || raw.cleanTitle || ""),
            seasonNumber: raw.seasonNumber ?? raw.season_number ?? raw.season ?? null,
            episodeNumber: raw.episodeNumber ?? raw.episode_number ?? raw.episode ?? null,
            tmdbId: raw.tmdbId ?? raw.tmdb_id ?? null,
            rawEntry: raw.rawEntry || (raw.raw_entry_json ? (() => { try { return JSON.parse(raw.raw_entry_json); } catch (_) { return null; } })() : null),
            createdAt: Number(raw.createdAt || raw.created_at || Date.now())
          };
          const dedupeKey = String(entry.msgId || "") + "|" + entry.fileName;
          if (existingIndexByKey.has(dedupeKey)) {
            const existingIdx = existingIndexByKey.get(dedupeKey);
            clientDiagnosticLogState.logs[existingIdx] = {
              ...clientDiagnosticLogState.logs[existingIdx],
              ...entry,
              tmdbId: entry.tmdbId ?? clientDiagnosticLogState.logs[existingIdx]?.tmdbId ?? null
            };
            added.push(clientDiagnosticLogState.logs[existingIdx]);
          } else {
            existingIndexByKey.set(dedupeKey, 0);
            clientDiagnosticLogState.logs.unshift(entry);
            added.push(entry);
          }
        }
        if (clientDiagnosticLogState.logs.length > 1200) {
          clientDiagnosticLogState.logs = clientDiagnosticLogState.logs.slice(0, 1200);
        }
        saveClientDiagnosticLogsToStorage();
        if (syncToServer && added.length > 0) {
          apiFetchJson(API_BASE + "/admin/import-logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "append", logs: added.slice(0, 120) })
          }).catch(() => {});
        }
      }

      async function syncDiagnosticLogsFromD1Client(silent = false) {
        loadClientDiagnosticLogsFromStorage();
        if (!silent) clientDiagnosticLogState.syncing = true;
        try {
          const r = await apiFetchJson(API_BASE + "/admin/import-logs?limit=600");
          if (r && r.ok && Array.isArray(r.logs)) {
            appendClientDiagnosticLogs(r.logs, false);
          }
        } catch (e) {}
        clientDiagnosticLogState.syncing = false;
        if (state.adminTab === "diaglog") loadAdminPanelView();
        else if (backupImportJob.activeSubTab === "diaglog") renderBackupImportBoxDom();
      }

      function setDiagLogFilterClient(statusVal) {
        clientDiagnosticLogState.filterStatus = statusVal || "ALL";
        refreshDiagnosticLogMountDom();
      }

      function setDiagLogSearchClient(qVal) {
        clientDiagnosticLogState.searchQuery = String(qVal || "");
        refreshDiagnosticLogMountDom();
      }

      function refreshDiagnosticLogMountDom() {
        const mount = document.getElementById("diagLogStandaloneMount");
        if (mount) {
          mount.innerHTML = renderImportDiagnosticLogBoxHtml();
        } else {
          renderBackupImportBoxDom();
        }
      }

      async function clearAllDiagnosticLogsClient() {
        const ok = await showCustomConfirm("Diagnose-Log in D1 und im Browser wirklich komplett leeren?", "🗑️ Diagnose-Log leeren");
        if (!ok) return;
        clientDiagnosticLogState.logs = [];
        saveClientDiagnosticLogsToStorage();
        try {
          await apiFetchJson(API_BASE + "/admin/import-logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "clear" })
          });
        } catch (e) {}
        showHudToast("🗑️ Diagnose-Log geleert");
        refreshDiagnosticLogMountDom();
      }

      async function exportDiagnosticLogsForAiClient(onlyProblems = true) {
        loadClientDiagnosticLogsFromStorage();
        const all = clientDiagnosticLogState.logs || [];
        const list = onlyProblems
          ? all.filter(l => l.status !== "OK")
          : all;
        const payload = {
          exportedAt: new Date().toISOString(),
          totalLogs: all.length,
          exportedCount: list.length,
          summaryCounts: {
            OK: all.filter(l => l.status === "OK").length,
            SKIPPED_JUNK: all.filter(l => l.status === "SKIPPED_JUNK").length,
            SKIPPED_HEADER: all.filter(l => l.status === "SKIPPED_HEADER").length,
            SKIPPED_DUPLICATE: all.filter(l => l.status === "SKIPPED_DUPLICATE").length,
            TMDB_NOT_FOUND: all.filter(l => l.status === "TMDB_NOT_FOUND").length,
            CONFLICT: all.filter(l => l.status === "CONFLICT_?" || l.status === "CONFLICT").length,
            SUBREQUEST_PAUSE: all.filter(l => l.status === "SUBREQUEST_PAUSE").length,
            API_ERROR: all.filter(l => l.status === "API_ERROR").length
          },
          entries: list.slice(0, 250).map(l => ({
            msgId: l.msgId,
            status: l.status,
            detectedType: l.detectedType,
            fileName: l.fileName,
            parsedTitle: l.parsedTitle,
            season: l.seasonNumber,
            episode: l.episodeNumber,
            tmdbId: l.tmdbId,
            reason: l.reason,
            rawText: (l.rawText || "").slice(0, 220)
          }))
        };
        const jsonText = JSON.stringify(payload, null, 2);
        try {
          await navigator.clipboard.writeText(jsonText);
          showHudToast("📋 Diagnose-JSON (" + list.length + " Einträge) für KI-Analyse in die Zwischenablage kopiert!");
        } catch (e) {
          const blob = new Blob([jsonText], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "diagnose-log-ki-export.json";
          a.click();
          showHudToast("💾 Diagnose-Log als JSON-Datei heruntergeladen!");
        }
      }

      async function quickAssignDiagLogEntryClient(diagIdx) {
        loadClientDiagnosticLogsFromStorage();
        const item = clientDiagnosticLogState.logs[diagIdx];
        if (!item) return;
        const tmdbInp = document.getElementById("diagFixTmdb_" + diagIdx);
        const typeSel = document.getElementById("diagFixType_" + diagIdx);
        const sInp = document.getElementById("diagFixSeason_" + diagIdx);
        const eInp = document.getElementById("diagFixEp_" + diagIdx);
        const newTmdbId = Number(tmdbInp?.value || 0);
        const newTypeCode = typeSel?.value === "s" ? "s" : "m";
        const sNum = Number(sInp?.value || item.seasonNumber || 1);
        const eNum = Number(eInp?.value || item.episodeNumber || 1);
        if (!newTmdbId) {
          showHudToast("⚠️ Bitte eine gültige TMDb-ID eingeben!");
          return;
        }
        setBusyState(true, "🔧 Weise Eintrag direkt TMDb #" + newTmdbId + " zu...");
        try {
          const rawEntry = item.rawEntry && typeof item.rawEntry === "object"
            ? { ...item.rawEntry }
            : {
                filename: item.fileName,
                raw_file_name: item.fileName,
                raw_text: item.rawText,
                msg_id: item.msgId,
                message_id: item.msgId
              };
          if (newTypeCode === "s") {
            rawEntry.season = sNum;
            rawEntry.episode = eNum;
            rawEntry.isSeries = true;
          }
          const r = await apiFetchJson(API_BASE + "/admin/remap-import-item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              newTmdbId,
              newTypeCode,
              oldTmdbId: item.tmdbId || null,
              oldTypeCode: item.detectedType === "series" ? "s" : "m",
              targetChatId: backupImportJob.targetPlaylistChatId || chatId,
              playlistFolderId: backupImportJob.playlistFolderId || null,
              playlistMode: backupImportJob.playlistMode || "both",
              rawEntry
            })
          });
          if (r && r.ok) {
            item.status = "OK";
            item.tmdbId = newTmdbId;
            item.detectedType = newTypeCode === "s" ? "series" : "movie";
            item.seasonNumber = newTypeCode === "s" ? sNum : null;
            item.episodeNumber = newTypeCode === "s" ? eNum : null;
            item.reason = "Manuell im Diagnose-Log zugewiesen → " + (r.item?.cleanTitle || ("TMDb #" + newTmdbId));
            saveClientDiagnosticLogsToStorage();
            await apiFetchJson(API_BASE + "/admin/import-logs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "resolve",
                id: item.id,
                msgId: item.msgId,
                tmdbId: newTmdbId,
                reason: item.reason
              })
            }).catch(() => {});
            clearClientMediaCaches();
            showHudToast("✅ Erfolgreich verknüpft: " + (r.item?.cleanTitle || ("TMDb #" + newTmdbId)));
            refreshDiagnosticLogMountDom();
          } else {
            showHudToast("⚠️ " + (r?.error || "Zuweisung fehlgeschlagen"));
          }
        } finally {
          setBusyState(false);
        }
      }

      function renderImportDiagnosticLogBoxHtml() {
        loadClientDiagnosticLogsFromStorage();
        const logs = clientDiagnosticLogState.logs || [];
        const fStatus = clientDiagnosticLogState.filterStatus || "ALL";
        const q = (clientDiagnosticLogState.searchQuery || "").trim().toLowerCase();

        const counts = {
          ALL: logs.length,
          OK: 0,
          SKIPPED_JUNK: 0,
          SKIPPED_HEADER: 0,
          SKIPPED_DUPLICATE: 0,
          SKIPPED_PRERELEASE: 0,
          TMDB_NOT_FOUND: 0,
          CONFLICT: 0,
          SUBREQUEST_PAUSE: 0,
          API_ERROR: 0
        };
        for (const l of logs) {
          const st = String(l.status || "OK");
          if (st === "CONFLICT_?" || st === "CONFLICT") counts.CONFLICT++;
          else if (counts[st] !== undefined) counts[st]++;
        }

        const filtered = logs.filter((l) => {
          const st = String(l.status || "OK");
          if (fStatus === "PROBLEMS") {
            if (st === "OK") return false;
          } else if (fStatus === "CONFLICT") {
            if (st !== "CONFLICT_?" && st !== "CONFLICT") return false;
          } else if (fStatus !== "ALL" && st !== fStatus) {
            return false;
          }
          if (q) {
            const hay = (String(l.msgId || "") + " " + String(l.fileName || "") + " " + String(l.parsedTitle || "") + " " + String(l.reason || "") + " " + String(l.rawText || "")).toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

        const statusBadgeMap = {
          OK: { bg: "rgba(16,185,129,0.2)", col: "#34d399", label: "🟢 OK" },
          SKIPPED_JUNK: { bg: "rgba(148,163,184,0.2)", col: "#94a3b8", label: "🗑️ SKIPPED_JUNK" },
          SKIPPED_HEADER: { bg: "rgba(56,189,248,0.2)", col: "#38bdf8", label: "📌 SKIPPED_HEADER" },
          SKIPPED_DUPLICATE: { bg: "rgba(167,139,250,0.2)", col: "#a78bfa", label: "♻️ SKIPPED_DUPLICATE" },
          SKIPPED_PRERELEASE: { bg: "rgba(245,158,11,0.22)", col: "#fbbf24", label: "⚠️ SKIPPED_PRERELEASE" },
          TMDB_NOT_FOUND: { bg: "rgba(239,68,68,0.25)", col: "#f87171", label: "❌ TMDB_NOT_FOUND" },
          "CONFLICT_?": { bg: "rgba(245,158,11,0.25)", col: "#fbbf24", label: "⚠️ CONFLICT_?" },
          CONFLICT: { bg: "rgba(245,158,11,0.25)", col: "#fbbf24", label: "⚠️ CONFLICT_?" },
          SUBREQUEST_PAUSE: { bg: "rgba(59,130,246,0.25)", col: "#60a5fa", label: "🛡️ SUBREQUEST_PAUSE" },
          API_ERROR: { bg: "rgba(239,68,68,0.25)", col: "#fca5a5", label: "🔥 API_ERROR" }
        };

        return '<div id="diagLogStandaloneMount" style="background:#101016;border:1px solid rgba(56,189,248,0.35);border-radius:10px;padding:12px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
            '<div>' +
              '<div style="font-size:14px;font-weight:900;color:#fff">🛠️ Persistentes Import-Diagnose-Log (D1 + Browser)</div>' +
              '<div style="font-size:11.5px;color:#94a3b8">Lückenlose Nachverfolgung jeder Message-ID inkl. Grund, Typ-Weiche, Subrequest-Guard & Direkt-Korrektur</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button type="button" class="btn amber" onclick="exportDiagnosticLogsForAiClient(true)">📋 Fehler-Log für KI kopieren</button>' +
              '<button type="button" class="btn blue" onclick="exportDiagnosticLogsForAiClient(false)">📋 Komplettes Log kopieren</button>' +
              '<button type="button" class="btn" onclick="syncDiagnosticLogsFromD1Client(false)">🔄 Aus D1 laden</button>' +
              '<button type="button" class="btn red" onclick="clearAllDiagnosticLogsClient()">🗑️ Log leeren</button>' +
            '</div>' +
          '</div>' +

          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;margin-bottom:10px;font-size:11.5px">' +
            '<div onclick="setDiagLogFilterClient(\\'ALL\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'ALL' ? 'rgba(56,189,248,0.22)' : '#181822') + ';border:1px solid rgba(255,255,255,0.1)">📋 Gesamt: <b>' + counts.ALL + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'PROBLEMS\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'PROBLEMS' ? 'rgba(245,158,11,0.22)' : '#181822') + ';border:1px solid rgba(245,158,11,0.35)">🚨 Alle Hinweise/Fehler: <b style="color:#fbbf24">' + (counts.ALL - counts.OK) + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'OK\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'OK' ? 'rgba(16,185,129,0.22)' : '#181822') + ';border:1px solid rgba(16,185,129,0.3)">🟢 OK: <b style="color:#34d399">' + counts.OK + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'TMDB_NOT_FOUND\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'TMDB_NOT_FOUND' ? 'rgba(239,68,68,0.25)' : '#181822') + ';border:1px solid rgba(239,68,68,0.35)">❌ TMDB_NOT_FOUND: <b style="color:#f87171">' + counts.TMDB_NOT_FOUND + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'CONFLICT\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'CONFLICT' ? 'rgba(245,158,11,0.25)' : '#181822') + ';border:1px solid rgba(245,158,11,0.35)">⚠️ CONFLICT_?: <b style="color:#fbbf24">' + counts.CONFLICT + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'SKIPPED_HEADER\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'SKIPPED_HEADER' ? 'rgba(56,189,248,0.22)' : '#181822') + ';border:1px solid rgba(56,189,248,0.3)">📌 Header/Poster: <b style="color:#38bdf8">' + counts.SKIPPED_HEADER + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'SKIPPED_DUPLICATE\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'SKIPPED_DUPLICATE' ? 'rgba(167,139,250,0.22)' : '#181822') + ';border:1px solid rgba(167,139,250,0.3)">♻️ Duplikate: <b style="color:#a78bfa">' + counts.SKIPPED_DUPLICATE + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'SUBREQUEST_PAUSE\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'SUBREQUEST_PAUSE' ? 'rgba(59,130,246,0.25)' : '#181822') + ';border:1px solid rgba(59,130,246,0.35)">🛡️ Subrequest-Guard: <b style="color:#60a5fa">' + counts.SUBREQUEST_PAUSE + '</b></div>' +
          '</div>' +

          '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
            '<input value="' + esc(clientDiagnosticLogState.searchQuery || "") + '" oninput="setDiagLogSearchClient(this.value)" placeholder="🔍 Suche nach Message-ID (z.B. 118, 303), Dateiname, Serie (Frontier, Rookie, Breaking Bad)..." style="flex:1;min-width:240px;padding:8px 10px;border-radius:6px;background:#161620;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px" />' +
          '</div>' +

          (filtered.length === 0 ? (
            '<div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px;background:#15151e;border-radius:8px">' +
              'Noch keine Einträge für diesen Filter vorhanden. Lade eine <code>result.json</code> hoch oder klicke oben auf <b>🔄 Aus D1 laden</b>.' +
            '</div>'
          ) : (
            '<div style="max-height:460px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">' +
              filtered.slice(0, 180).map((item) => {
                const origIdx = logs.indexOf(item);
                const badge = statusBadgeMap[item.status] || { bg: "rgba(148,163,184,0.2)", col: "#cbd5e1", label: item.status };
                const isFixable = item.status === "TMDB_NOT_FOUND" || item.status === "CONFLICT_?" || item.status === "CONFLICT" || item.status === "API_ERROR";
                const seLabel = item.seasonNumber
                  ? (' • <b style="color:#38bdf8">S' + String(item.seasonNumber).padStart(2, '0') + 'E' + String(item.episodeNumber || 1).padStart(2, '0') + '</b>')
                  : '';
                return '<div style="background:#161620;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:9px 11px;display:flex;flex-direction:column;gap:6px">' +
                  '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">' +
                    '<div style="min-width:0;flex:1">' +
                      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                        '<span style="font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:999px;background:' + badge.bg + ';color:' + badge.col + '">' + esc(badge.label) + '</span>' +
                        (item.msgId ? '<span style="font-family:monospace;font-size:11px;background:#0f172a;color:#38bdf8;padding:2px 6px;border-radius:5px;border:1px solid rgba(56,189,248,0.3)">Msg #' + esc(item.msgId) + '</span>' : '') +
                        '<span style="font-size:11px;color:#94a3b8">[' + esc(item.detectedType || 'auto') + ']</span>' +
                        '<b style="font-size:12.5px;color:#fff">' + esc(item.fileName || item.parsedTitle || 'Eintrag') + '</b>' +
                        seLabel +
                        (item.tmdbId ? ' <span style="font-size:11px;color:#34d399">(TMDb #' + esc(item.tmdbId) + ')</span>' : '') +
                      '</div>' +
                      '<div style="font-size:11.5px;color:#cbd5e1;margin-top:3px">💬 <b>Grund:</b> ' + esc(item.reason || '–') + '</div>' +
                      (item.rawText ? '<div style="font-size:10.5px;color:#64748b;margin-top:2px;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📄 Roh-Text: ' + esc(item.rawText) + '</div>' : '') +
                    '</div>' +
                  '</div>' +
                  (isFixable && origIdx >= 0 ? (
                    '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:#101018;padding:7px;border-radius:6px;border:1px solid rgba(245,158,11,0.3)">' +
                      '<span style="font-size:11px;font-weight:800;color:#fbbf24">🔧 Direkt-Zuweisung:</span>' +
                      '<select id="diagFixType_' + origIdx + '" style="padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px">' +
                        '<option value="s" ' + (item.detectedType === 'series' || item.seasonNumber ? 'selected' : '') + '>📺 Serie</option>' +
                        '<option value="m" ' + (item.detectedType === 'movie' && !item.seasonNumber ? 'selected' : '') + '>🎬 Film</option>' +
                      '</select>' +
                      '<input id="diagFixTmdb_' + origIdx + '" type="number" value="' + esc(item.tmdbId || '') + '" placeholder="TMDb-ID (z.B. 66732)" style="width:135px;padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px" />' +
                      '<input id="diagFixSeason_' + origIdx + '" type="number" value="' + esc(item.seasonNumber || 1) + '" placeholder="Staffel" style="width:68px;padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px" title="Staffel" />' +
                      '<input id="diagFixEp_' + origIdx + '" type="number" value="' + esc(item.episodeNumber || 1) + '" placeholder="Folge" style="width:68px;padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px" title="Folge" />' +
                      '<button type="button" class="btn green" style="padding:5px 9px;font-size:11px" onclick="quickAssignDiagLogEntryClient(' + origIdx + ')">💾 Jetzt verknüpfen</button>' +
                    '</div>'
                  ) : '') +
                '</div>';
              }).join("") +
            '</div>'
          )) +
        '</div>';
      }

      async function startOrResumeBackupImport() {
        if (backupImportJob.running || !backupImportJob.entries.length) return;
        const activeChan = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
        if (!activeChan || (!activeChan.startsWith("-100") && !activeChan.startsWith("@"))) {
          showHudToast("⛔ Import gesperrt: Bitte zuerst oben in Schritt 1 die Kanal-ID (-100...) prüfen!");
          return;
        }
        backupImportJob.verifiedChannelId = activeChan;

        const inpEl = document.getElementById("backupPlaylistNameInp");
        if (inpEl && inpEl.value.trim()) {
          backupImportJob.customPlaylistName = inpEl.value.trim().slice(0, 48);
        }
        backupImportJob.running = true;
        backupImportJob.paused = false;
        if (!backupImportJob.startedAt) backupImportJob.startedAt = Date.now();
        renderBackupImportBoxDom();

        const DEFAULT_BATCH_SIZE = 4;
        if (!backupImportJob.cursorRetries) backupImportJob.cursorRetries = {};

        const isolateFailedEntryAtCursor = (reasonMsg) => {
          const badIdx = backupImportJob.cursor;
          const badEntry = backupImportJob.entries[badIdx] || {};
          const rawLabel = typeof badEntry === "string"
            ? badEntry
            : (badEntry.rawInput || badEntry.filename || badEntry.file_name || badEntry.cleanTitle || ("Eintrag #" + (badIdx + 1)));
          const fallbackItem = {
            id: "rev_" + badIdx + "_" + Date.now(),
            rawInput: String(rawLabel),
            rawEntry: typeof badEntry === "object" ? badEntry : { filename: String(rawLabel) },
            status: "failed",
            ingestStatus: "failed",
            isUncertain: true,
            confidence: 0,
            typeCode: badEntry.isSeries ? "s" : "m",
            tmdbId: null,
            cleanTitle: badEntry.cleanTitle || String(rawLabel),
            year: badEntry.year || "k.A.",
            poster: "",
            quality: badEntry.quality || "1080p",
            codec: badEntry.codec || "x264",
            part: badEntry.part || null,
            season: badEntry.season || null,
            episode: badEntry.episode || null,
            metadataSource: "Prüfung",
            msgId: badEntry.msg_id || badEntry.messageId || null,
            messageLink: badEntry.message_link || badEntry.messageLink || "",
            rawFileName: badEntry.raw_file_name || badEntry.file_name || String(rawLabel),
            rawText: badEntry.raw_text || badEntry.rawText || "",
            sourceUsed: badEntry.source_used || "file_name",
            languages: badEntry.languages || ["de"],
            prevMessages: Array.isArray(badEntry.prev_messages || badEntry.prevMessages) ? (badEntry.prev_messages || badEntry.prevMessages) : [],
            candidates: []
          };
          backupImportJob.reviewItems.push(fallbackItem);
          backupImportJob.failedCount += 1;
          backupImportJob.uncertainCount += 1;
          backupImportJob.cursor += 1;
          appendClientDiagnosticLogs([{
            msgId: fallbackItem.msgId,
            fileName: fallbackItem.rawFileName,
            rawText: fallbackItem.rawText,
            status: "API_ERROR",
            reason: "Nach Wiederholungsversuch isoliert: " + String(reasonMsg || "Unbekannter Fehler"),
            detectedType: fallbackItem.typeCode === "s" ? "series" : "movie",
            parsedTitle: fallbackItem.cleanTitle,
            seasonNumber: fallbackItem.season,
            episodeNumber: fallbackItem.episode,
            rawEntry: fallbackItem.rawEntry
          }], true);
          saveBackupCheckpointClient();
          const isOutdatedWorkerErr = String(reasonMsg || "").includes("normalizeCompareString") || String(reasonMsg || "").includes("externalFallbackCache");
          backupImportJob.recentLog.push(
            "⚠️ Eintrag #" + (badIdx + 1) + " (" + String(rawLabel).slice(0, 36) + ") zur Prüfung isoliert" +
            (isOutdatedWorkerErr ? " [Hinweis: Bitte aktualisierte worker.js in Cloudflare deployen!]" : "") +
            " – fahre bei #" + backupImportJob.cursor + " fort."
          );
        };

        while (backupImportJob.running && !backupImportJob.paused && backupImportJob.cursor < backupImportJob.entries.length) {
          const curRetryCount = Number(backupImportJob.cursorRetries[backupImportJob.cursor] || 0);
          const effectiveBatchSize = curRetryCount > 0 ? 1 : DEFAULT_BATCH_SIZE;
          const slice = backupImportJob.entries.slice(backupImportJob.cursor, backupImportJob.cursor + effectiveBatchSize);
          let hadRateWarning = false;
          try {
            const r = await apiFetchJson(API_BASE + "/admin/import-batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                entries: slice,
                sourceChannelId: activeChan,
                playlistName: backupImportJob.customPlaylistName || backupImportJob.fileName || "JSON-Import",
                playlistMode: backupImportJob.playlistMode || "both",
                playlistFolderId: backupImportJob.playlistFolderId || null,
                targetChatId: backupImportJob.targetPlaylistChatId || chatId,
                sourceLabel: backupImportJob.isTelegramBackup ? ("Telegram Backup: " + backupImportJob.backupChatName) : backupImportJob.fileName
              })
            });
            if (r && r.ok) {
              delete backupImportJob.cursorRetries[backupImportJob.cursor];
              if (r.playlistFolder?.id) {
                backupImportJob.playlistFolderId = r.playlistFolder.id;
                backupImportJob.customPlaylistName = r.playlistFolder.name;
              }
              const batchStartIdx = backupImportJob.cursor;
              // 40-Subrequest-Guard: Wenn der Worker PARTIAL_BATCH meldet, rückt der Cursor exakt um nextStartIndex vor und macht nahtlos weiter!
              const processedCount = (r.status === "PARTIAL_BATCH" && typeof r.nextStartIndex === "number" && r.nextStartIndex > 0)
                ? r.nextStartIndex
                : slice.length;
              backupImportJob.cursor += processedCount;
              backupImportJob.moviesSaved += Number(r.moviesAddedCount || 0);
              backupImportJob.seriesSaved += Number(r.seriesAddedCount || 0);
              backupImportJob.failedCount += Number(r.failedCount || 0);
              backupImportJob.duplicatesInDb += Number(r.duplicatesCount || 0);
              backupImportJob.mergedQualitiesInDb += Number(r.mergedQualitiesCount || 0);
              backupImportJob.uncertainCount += Number(r.uncertainCount || 0);

              if (Array.isArray(r.batchItems)) {
                const batchDiagEntries = [];
                for (let bi = 0; bi < r.batchItems.length; bi++) {
                  const bItem = r.batchItems[bi];
                  const itemObj = {
                    ...bItem,
                    id: "rev_" + (batchStartIdx + bi) + "_" + Date.now()
                  };
                  backupImportJob.reviewItems.push(itemObj);
                  if (bItem.tmdbId) {
                    backupImportJob.livePosterFeed.unshift(itemObj);
                  }
                  const diagStatus = bItem.status === "failed"
                    ? "TMDB_NOT_FOUND"
                    : bItem.isUncertain
                      ? "CONFLICT_?"
                      : bItem.ingestStatus === "skipped_prerelease"
                        ? "SKIPPED_PRERELEASE"
                        : bItem.ingestStatus === "duplicate"
                          ? "SKIPPED_DUPLICATE"
                          : "OK";
                  batchDiagEntries.push({
                    msgId: bItem.msgId || null,
                    fileName: bItem.rawFileName || bItem.rawInput || bItem.cleanTitle || "Unbekannt",
                    rawText: bItem.rawText || "",
                    status: diagStatus,
                    reason: bItem.status === "failed"
                      ? "Kein TMDb-Treffer für '" + (bItem.cleanTitle || bItem.rawInput || "") + "'"
                      : bItem.isUncertain
                        ? "Unsichere Zuordnung (" + (bItem.confidence || 0) + "%) → " + (bItem.cleanTitle || "")
                        : bItem.ingestStatus === "skipped_prerelease"
                          ? "Vorabversion/TS/MD übersprungen (gute Version bereits in D1)"
                          : bItem.ingestStatus === "duplicate"
                            ? "Bereits in D1 vorhanden (" + (bItem.cleanTitle || "") + ")"
                            : "Erfolgreich zugeordnet → " + (bItem.cleanTitle || "") + (bItem.tmdbId ? " (TMDb #" + bItem.tmdbId + ")" : "") + (Number(bItem.replacedPrereleaseCount || 0) > 0 ? (" [🧹 " + bItem.replacedPrereleaseCount + " Vorabversion ersetzt!]") : ""),
                    detectedType: bItem.typeCode === "s" ? "series" : "movie",
                    parsedTitle: bItem.cleanTitle || "",
                    seasonNumber: bItem.season || null,
                    episodeNumber: bItem.episode || null,
                    tmdbId: bItem.tmdbId || null,
                    rawEntry: bItem.rawEntry || null
                  });
                }
                if (r.status === "PARTIAL_BATCH") {
                  batchDiagEntries.push({
                    msgId: null,
                    fileName: "Subrequest-Guard (Pause bei Index +" + processedCount + ")",
                    rawText: "",
                    status: "SUBREQUEST_PAUSE",
                    reason: "40-Subrequest-Schutz erreicht (" + (r.subrequestCount || 40) + " Subrequests) – nahtlose Fortsetzung im nächsten Batch",
                    detectedType: "system",
                    parsedTitle: "PARTIAL_BATCH"
                  });
                  backupImportJob.recentLog.push("🛡️ 40-Subrequest-Guard aktiv (" + processedCount + "/" + slice.length + " im Batch verarbeitet) – setze nahtlos bei #" + backupImportJob.cursor + " fort...");
                }
                appendClientDiagnosticLogs(batchDiagEntries, false);
                if (backupImportJob.livePosterFeed.length > 16) {
                  backupImportJob.livePosterFeed = backupImportJob.livePosterFeed.slice(0, 16);
                }
              }

              if (Array.isArray(r.sampleTitles) && r.sampleTitles.length > 0) {
                backupImportJob.recentLog.push("✅ Batch #" + Math.ceil(backupImportJob.cursor / DEFAULT_BATCH_SIZE) + " [" + (backupImportJob.customPlaylistName || "Playlist") + "]: " + r.sampleTitles.slice(0, 3).join(", "));
              }
              saveBackupCheckpointClient();
            } else {
              hadRateWarning = true;
              const errMsg = String(r?.error || "Kurze Pause...");
              backupImportJob.cursorRetries[backupImportJob.cursor] = curRetryCount + 1;
              if (curRetryCount + 1 >= 2) {
                isolateFailedEntryAtCursor(errMsg);
              } else {
                saveBackupCheckpointClient();
                backupImportJob.recentLog.push("⏳ Einzel-Prüfung bei Checkpoint #" + backupImportJob.cursor + ": " + errMsg);
                await new Promise(res => setTimeout(res, 1200));
              }
            }
          } catch (e) {
            hadRateWarning = true;
            const errMsg = String(e?.message || e || "Netzwerkfehler");
            backupImportJob.cursorRetries[backupImportJob.cursor] = curRetryCount + 1;
            if (curRetryCount + 1 >= 2) {
              isolateFailedEntryAtCursor(errMsg);
            } else {
              saveBackupCheckpointClient();
              backupImportJob.recentLog.push("⏳ Rate-Limit / Einzel-Isolierung bei #" + backupImportJob.cursor + ": " + errMsg);
              await new Promise(res => setTimeout(res, 1500));
            }
          }
          renderBackupImportBoxDom();
          await new Promise(res => setTimeout(res, hadRateWarning ? 500 : 380));
        }

        backupImportJob.running = false;
        if (backupImportJob.cursor >= backupImportJob.entries.length && backupImportJob.entries.length > 0) {
          clearBackupCheckpointClient();
          showHudToast("🎉 Smart-Import 100% abgeschlossen!");
        }
        renderBackupImportBoxDom();
      }

      function pauseBackupImport() {
        backupImportJob.paused = true;
        backupImportJob.running = false;
        saveBackupCheckpointClient();
        showHudToast("⏸️ Pausiert & Checkpoint bei #" + backupImportJob.cursor + " gespeichert.");
        renderBackupImportBoxDom();
      }

      function resetBackupImport(clearSaved = false) {
        if (clearSaved) clearBackupCheckpointClient();
        backupImportJob.paused = true;
        backupImportJob.running = false;
        backupImportJob.cursor = 0;
        backupImportJob.moviesSaved = 0;
        backupImportJob.seriesSaved = 0;
        backupImportJob.duplicatesInDb = 0;
        backupImportJob.mergedQualitiesInDb = 0;
        backupImportJob.uncertainCount = 0;
        backupImportJob.failedCount = 0;
        backupImportJob.startedAt = 0;
        backupImportJob.recentLog = [];
        backupImportJob.livePosterFeed = [];
        backupImportJob.reviewItems = [];
        backupImportJob.activeSubTab = "dashboard";
        renderBackupImportBoxDom();
      }

      async function runServerD1QueueStepAdmin(rounds = 2) {
        setBusyState(true, "⏳ Verarbeite nächsten Batch aus der D1-Import-Warteschlange...");
        try {
          await apiFetchJson(API_BASE + "/admin/import-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "step", rounds })
          });
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function clearServerD1QueueAdmin() {
        const ok = await showCustomConfirm("Gesamte D1-Import-Warteschlange wirklich leeren?", "🗑️ Queue leeren");
        if (!ok) return;
        await apiFetchJson(API_BASE + "/admin/import-queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "clear" })
        });
        showHudToast("🗑️ D1-Warteschlange geleert");
        loadAdminPanelView();
      }

      async function adminCreatePlaylistPrompt() {
        const targetUid = state.adminPlaylistTargetChatId || chatId;
        const defaultMode = targetUid === "bot_vip" ? "vip_stream" : "both";
        const name = await showCustomPrompt("🎵 Name für die neue Custom Playlist (Ziel: " + (targetUid === "bot_vip" ? "🤖 Globale Bot-VIP-Playlist" : ("User ID " + targetUid)) + "):", "");
        if (!name || !name.trim()) return;
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", targetChatId: targetUid, name: name.trim(), playlistMode: defaultMode })
        });
        if (r?.folder?.id) {
          state.adminEditingFolderId = r.folder.id;
        }
        showHudToast("✅ Playlist „" + name.trim() + "“ angelegt");
        loadAdminPanelView();
      }

      async function adminTogglePlaylist(targetUid, folderId) {
        await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "toggle", targetChatId: targetUid, folderId })
        });
        loadAdminPanelView();
      }

      async function adminSetPlaylistMode(targetUid, folderId, nextMode) {
        const progBox = document.getElementById("adminPlaylistBatchProgressBox");
        let offset = 0;
        const limit = 25;
        let hasMore = true;
        let totalSynced = 0;

        if (progBox) {
          progBox.style.display = "block";
          progBox.innerHTML = '<div style="font-size:12px;color:#38bdf8">⚙️ Schalte Playlist-Modus in 25er-Batches um...</div>';
        }
        try {
          while (hasMore) {
            const r = await apiFetchJson(API_BASE + "/admin/playlists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "set_mode",
                targetChatId: targetUid,
                folderId,
                playlistMode: nextMode,
                offset,
                limit
              })
            });
            if (!r || !r.ok) break;
            totalSynced += Number(r.syncedVipCount || 0);
            hasMore = Boolean(r.hasMore);
            offset = Number(r.nextOffset || (offset + limit));
            const total = Math.max(1, Number(r.total || offset));
            const pct = Math.min(100, Math.round((offset / total) * 100));
            if (progBox) {
              progBox.innerHTML =
                '<div style="display:flex;justify-content:space-between;font-size:12px;color:#34d399;margin-bottom:4px">' +
                  '<span>⚡ Synchronisiere Playlist-Modus in 25er-Batches...</span>' +
                  '<b>' + Math.min(offset, total) + ' / ' + total + ' (' + pct + '%)</b>' +
                '</div>' +
                '<div style="width:100%;height:8px;background:#1e293b;border-radius:999px;overflow:hidden">' +
                  '<div style="width:' + pct + '%;height:100%;background:#10b981;transition:width 0.2s"></div>' +
                '</div>';
            }
          }
          clearClientMediaCaches();
          const modeLabel = nextMode === "vip_stream" ? "🌟 VIP-Stream-Playlist" : nextMode === "watchlist" ? "🔖 Merkliste" : "⚡ VIP-Stream + Merkliste";
          showHudToast("✅ Modus gesetzt: " + modeLabel + " (" + totalSynced + " Einträge in 25er-Batches verarbeitet)");
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function adminCopyPlaylistBatchClient(sourceUid, sourceFolderId, sourceFolderName) {
        const defaultName = String(sourceFolderName || "Playlist") + " (VIP-Kopie)";
        const targetName = await showCustomPrompt("📋 Name der Ziel-Playlist (wird in 25er-Batches ohne Cloudflare-Limit kopiert):", defaultName);
        if (!targetName || !targetName.trim()) return;

        const progBox = document.getElementById("adminPlaylistBatchProgressBox");
        let offset = 0;
        const limit = 25;
        let hasMore = true;
        let totalCopied = 0;

        if (progBox) {
          progBox.style.display = "block";
          progBox.innerHTML = '<div style="font-size:12px;color:#38bdf8">📋 Starte 25er-Batch-Kopie für „' + esc(targetName.trim()) + '“...</div>';
        }

        while (hasMore) {
          const r = await apiFetchJson(API_BASE + "/admin/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "copy_playlist_batch",
              sourceChatId: sourceUid,
              sourceFolderId: sourceFolderId,
              targetChatId: "bot_vip",
              targetFolderName: targetName.trim(),
              targetMode: "both",
              offset,
              limit
            })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ Batch-Kopie gestoppt bei #" + offset + ": " + (r?.error || "Fehler"));
            break;
          }
          totalCopied += Number(r.copiedInBatch || 0);
          hasMore = Boolean(r.hasMore);
          offset = Number(r.nextOffset || (offset + limit));
          const total = Math.max(1, Number(r.total || offset));
          const pct = Math.min(100, Math.round((offset / total) * 100));
          if (progBox) {
            progBox.innerHTML =
              '<div style="display:flex;justify-content:space-between;font-size:12px;color:#34d399;margin-bottom:4px">' +
                '<span>📋 Kopiere in 25er-Batches nach „' + esc(r.targetFolderName || targetName.trim()) + '“...</span>' +
                '<b>' + Math.min(offset, total) + ' / ' + total + ' (' + pct + '%)</b>' +
              '</div>' +
              '<div style="width:100%;height:8px;background:#1e293b;border-radius:999px;overflow:hidden">' +
                '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#0ea5e9,#10b981);transition:width 0.2s"></div>' +
              '</div>';
          }
          await new Promise(res => setTimeout(res, 120));
        }

        clearClientMediaCaches();
        showHudToast("✅ Playlist komplett kopiert (" + totalCopied + " Titel in 25er-Batches übertragen)!");
        await loadAdminPanelView();
      }

      async function adminOpenPlaylistEditor(targetUid, folderId) {
        state.adminPlaylistTargetChatId = String(targetUid || chatId);
        state.adminEditingFolderId = String(folderId || "");
        state.adminTab = "playlists";
        await loadAdminPanelView();
      }

      async function adminOpenBotVipPlaylistDirect() {
        state.adminPlaylistTargetChatId = "bot_vip";
        state.adminEditingFolderId = "";
        state.adminTab = "playlists";
        await loadAdminPanelView();
      }

      async function adminReorderPlaylistItem(targetUid, folderId, itemUid, direction) {
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reorder_item", targetChatId: targetUid, folderId, uid: itemUid, direction })
        });
        if (r && r.ok) {
          loadAdminPanelView();
        }
      }

      async function adminRemovePlaylistItem(targetUid, folderId, itemUid) {
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove_item", targetChatId: targetUid, folderId, uid: itemUid })
        });
        if (r && r.ok) {
          showHudToast("➖ Titel nur aus Playlist entfernt (bleibt in D1 erhalten)");
          loadAdminPanelView();
        }
      }

      async function adminDeletePlaylistItemFromD1(targetUid, folderId, itemUid, typeCode, tmdbId, title) {
        const ok = await showCustomConfirm(
          'Möchtest du "' + (title || ('TMDb #' + tmdbId)) + '" wirklich KOMPLETT aus der D1-Datenbank & dem Telegram-Bot löschen (inkl. aller verknüpften Video-Streams) UND aus der Playlist entfernen?',
          '🗑️ Komplett aus D1 + Bot löschen'
        );
        if (!ok) return;
        setBusyState(true, "🗑️ Lösche Titel + Streams aus D1 & Playlist...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "delete_from_d1",
              targetChatId: targetUid,
              folderId,
              uid: itemUid,
              typeCode,
              tmdbId
            })
          });
          if (r && r.ok) {
            clearClientMediaCaches();
            showHudToast("🗑️ Titel komplett aus D1, Bot & Playlist gelöscht");
            await loadAdminPanelView();
          } else {
            showHudToast("⚠️ " + (r?.error || "Löschen aus D1 fehlgeschlagen."));
          }
        } finally {
          setBusyState(false);
        }
      }

      async function adminSyncBotVipFromD1Client(forceIncludeHidden) {
        const progBox = document.getElementById("adminPlaylistBatchProgressBox");
        let offset = 0;
        const limit = 25;
        let hasMore = true;
        let totalAdded = 0;
        let lastTotalInPlaylist = 0;

        if (progBox) {
          progBox.style.display = "block";
          progBox.innerHTML = '<div style="font-size:12px;color:#38bdf8">🔄 Synchronisiere D1-Katalog in 25er-Batches (umgeht Cloudflare 50-Subrequest-Limit)...</div>';
        }
        try {
          while (hasMore) {
            const r = await apiFetchJson(API_BASE + "/admin/playlists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "sync_d1",
                targetChatId: "bot_vip",
                folderId: state.adminEditingFolderId || "pl_bot_vip_default",
                forceIncludeHidden: Boolean(forceIncludeHidden && offset === 0),
                offset,
                limit
              })
            });
            if (!r || !r.ok) {
              showHudToast("⚠️ " + (r?.error || "D1-Synchronisation fehlgeschlagen."));
              break;
            }
            totalAdded += Number(r.addedCount || r.syncedAddedCount || 0);
            lastTotalInPlaylist = Number(r.totalInPlaylist || lastTotalInPlaylist);
            hasMore = Boolean(r.hasMore);
            offset = Number(r.nextOffset || (offset + limit));
            const totalInD1 = Math.max(1, Number(r.totalInD1 || offset));
            const pct = Math.min(100, Math.round((offset / totalInD1) * 100));
            if (progBox) {
              progBox.innerHTML =
                '<div style="display:flex;justify-content:space-between;font-size:12px;color:#38bdf8;margin-bottom:4px">' +
                  '<span>🔄 Synchronisiere D1 → Bot-VIP Playlist (25er-Batches)...</span>' +
                  '<b>' + Math.min(offset, totalInD1) + ' / ' + totalInD1 + ' (' + pct + '%)</b>' +
                '</div>' +
                '<div style="width:100%;height:8px;background:#1e293b;border-radius:999px;overflow:hidden">' +
                  '<div style="width:' + pct + '%;height:100%;background:#38bdf8;transition:width 0.2s"></div>' +
                '</div>';
            }
          }
          clearClientMediaCaches();
          state.adminPlaylistTargetChatId = "bot_vip";
          showHudToast("✅ D1-Bot-Sync abgeschlossen: " + lastTotalInPlaylist + " Titel in Bot-VIP-Playlist (" + totalAdded + " neu in 25er-Batches verknüpft)");
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function adminAddPlaylistItemClient(targetUid, folderId) {
        const qInp = document.getElementById("plEditorAddQueryInp");
        const tSel = document.getElementById("plEditorAddTypeSel");
        const qualInp = document.getElementById("plEditorAddQualInp");
        const query = (qInp ? qInp.value : "").trim();
        const typeCode = tSel ? tSel.value : "auto";
        const quality = (qualInp ? qualInp.value : "1080p").trim() || "1080p";
        if (!query) {
          showHudToast("⚠️ Bitte Titel oder TMDb-ID eingeben.");
          return;
        }
        setBusyState(true, "➕ Suche & füge „" + query + "“ zur Playlist hinzu...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "add_item", targetChatId: targetUid, folderId, query, typeCode, quality })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Konnte Titel nicht hinzufügen."));
            return;
          }
          clearClientMediaCaches();
          if (qInp) qInp.value = "";
          showHudToast("✅ Hinzugefügt: " + (r.addedItem?.cleanTitle || query));
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function adminRenamePlaylist(targetUid, folderId, currentName) {
        const nextName = await showCustomPrompt("✏️ Neuer Custom Name für diese Playlist:", currentName || "");
        if (!nextName || !nextName.trim()) return;
        await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", targetChatId: targetUid, folderId, name: nextName.trim() })
        });
        showHudToast("✅ Playlist umbenannt");
        loadAdminPanelView();
      }

      async function adminDeletePlaylist(targetUid, folderId, currentName) {
        const ok = await showCustomConfirm('Playlist "' + (currentName || folderId) + '" (User ' + targetUid + ') samt aller Einträge wirklich löschen?', '🗑️ Löschen');
        if (!ok) return;
        if (String(state.adminEditingFolderId) === String(folderId)) {
          state.adminEditingFolderId = "";
        }
        await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", targetChatId: targetUid, folderId })
        });
        showHudToast("🗑️ Playlist gelöscht");
        loadAdminPanelView();
      }

      async function loadAdminPanelView() {
        if (!state.isAuthenticated || !state.authUser?.isAdmin) {
          showHudToast("⛔ Zugriff verweigert: Nur für autorisierte Administratoren.");
          return;
        }
        state.currentView = "admin";
        if (!state.adminPlaylistTargetChatId) state.adminPlaylistTargetChatId = String(chatId);
        setBusyState(true, "👑 Lade Admin-Dashboard, User, VIP-Playlisten & Mediendatenbank...");
        try {
          const r = await apiFetchJson(
            API_BASE + "/admin/overview?mediaType=" + encodeURIComponent(state.adminMediaType || "m") +
            "&playlistChatId=" + encodeURIComponent(state.adminPlaylistTargetChatId || chatId) +
            "&folderId=" + encodeURIComponent(state.adminEditingFolderId || "")
          );
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Admin-Daten konnten nicht geladen werden."));
            return;
          }
          const users = r.users || [];
          const mediaList = r.media || [];
          const qStats = r.queueStats || { pendingCount: 0, processedCount: 0, moviesSaved: 0, seriesSaved: 0, failedCount: 0 };
          const adminPlaylists = r.playlists || [];
          const seriesGaps = r.seriesGaps || { totalSeriesChecked: 0, seriesWithGapsCount: 0, seriesWithInternalGapsCount: 0, totalMissingInternal: 0, totalMissingTrailing: 0, totalPrereleaseOnly: 0, items: [] };
          const allReports = Array.isArray(r.reports) ? r.reports : [];
          window._adminReportsCache = allReports;
          if (!clientDiagnosticLogState.loadedFromD1Once) {
            clientDiagnosticLogState.loadedFromD1Once = true;
            syncDiagnosticLogsFromD1Client(true);
          }
          const openReportsCount = Number(r.openReportsCount ?? allReports.filter(rep => rep && rep.status === "open").length);
          const reportFilter = state.adminReportFilter || "open";
          const filteredReports = reportFilter === "all"
            ? allReports
            : allReports.filter(rep => rep && rep.status === reportFilter);
          const activeFolderId = r.activeFolderId || (adminPlaylists[0]?.id || "");
          state.adminEditingFolderId = activeFolderId;
          const activeFolderObj = adminPlaylists.find(f => String(f.id) === String(activeFolderId)) || null;
          const activeFolderItems = Array.isArray(r.activePlaylistItems) ? r.activePlaylistItems : [];
          const root = document.getElementById("appRoot");

          const userSelectOptionsHtml = [
            '<option value="bot_vip" ' + (String(state.adminPlaylistTargetChatId) === "bot_vip" ? 'selected' : '') + '>🤖 Globale Bot-VIP-Playlist (bot_vip)</option>',
            '<option value="' + esc(chatId) + '" ' + (String(state.adminPlaylistTargetChatId) === String(chatId) ? 'selected' : '') + '>👑 Eigene Admin-Merkliste (ID ' + esc(chatId) + ')</option>',
            ...users.filter(u => String(u.telegramId) !== String(chatId)).map(u =>
              '<option value="' + esc(u.telegramId) + '" ' + (String(state.adminPlaylistTargetChatId) === String(u.telegramId) ? 'selected' : '') + '>👤 ID ' + esc(u.telegramId) + (u.tgUsername ? ' (@' + esc(u.tgUsername) + ')' : '') + (u.customUsername ? ' [' + esc(u.customUsername) + ']' : '') + '</option>'
            )
          ].join("");

          const playlistEditorBoxHtml = activeFolderObj ? (
            '<div class="panel-box" style="border-color:rgba(251,191,36,0.45);margin-top:12px">' +
              '<div class="section-title">' +
                '<span>👑 Vollwertiger Playlist-Editor: <b style="color:#fbbf24">' + esc(activeFolderObj.name) + '</b> (' + activeFolderItems.length + ' Titel)</span>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                  (String(state.adminPlaylistTargetChatId) === "bot_vip"
                    ? '<button class="btn amber" onclick="adminSyncBotVipFromD1Client(true)" title="Synchronisiert alle vom Telegram-Bot in D1 gespeicherten Filme & Serien in 25er-Batches">🔄 Alle D1-Bot-Filme & -Serien (25er-Batches) synchronisieren</button>'
                    : '') +
                  '<button class="btn ' + ((activeFolderObj.playlistMode || 'both') === 'vip_stream' ? 'amber' : '') + '" onclick="adminSetPlaylistMode(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'vip_stream\\')">🌟 Als VIP-Stream-Playlist</button>' +
                  '<button class="btn ' + ((activeFolderObj.playlistMode || 'both') === 'watchlist' ? 'blue' : '') + '" onclick="adminSetPlaylistMode(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'watchlist\\')">🔖 Als Merkliste</button>' +
                  '<button class="btn ' + ((activeFolderObj.playlistMode || 'both') === 'both' ? 'green' : '') + '" onclick="adminSetPlaylistMode(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'both\\')">⚡ Beides (VIP + Merkliste)</button>' +
                '</div>' +
              '</div>' +
              '<div style="background:#16161f;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:10px;margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                '<select id="plEditorAddTypeSel" style="padding:7px 9px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px">' +
                  '<option value="auto">🔄 Auto (Film/Serie)</option>' +
                  '<option value="m">🎬 Film</option>' +
                  '<option value="s">📺 Serie</option>' +
                '</select>' +
                '<input id="plEditorAddQueryInp" placeholder="Titel oder TMDb-ID zur Playlist hinzufügen (z.B. Inception oder 27205)..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();adminAddPlaylistItemClient(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\')}" style="flex:1;min-width:210px;padding:7px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px" />' +
                '<input id="plEditorAddQualInp" value="1080p" placeholder="Qualität (1080p/4K)" style="width:95px;padding:7px 9px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px" />' +
                '<button class="btn green" onclick="adminAddPlaylistItemClient(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\')">➕ Titel hinzufügen</button>' +
              '</div>' +
              (activeFolderItems.length === 0 ? (
                '<div style="font-size:12px;color:#94a3b8;padding:12px;text-align:center;background:#101015;border-radius:8px">Diese Playlist enthält noch keine Titel. Klicke oben auf <b>🔄 Alle D1-Bot-Filme & -Serien synchronisieren</b>, füge einen Titel per Name/TMDb-ID hinzu oder importiere ein JSON-Backup.</div>'
              ) : (
                '<div style="display:flex;flex-direction:column;gap:6px;max-height:460px;overflow-y:auto;padding-right:4px">' +
                  activeFolderItems.map((it, idx) => {
                    const tc = it.contentType === "series" ? "s" : "m";
                    const streamCountNum = Number(it.streamCount || 0);
                    const qualDisplay = esc(it.allQualities || it.quality || "1080p");
                    const pImg = resolvePosterUrlClient(it.poster, "w185", "");
                    const epsList = Array.isArray(it.episodes) ? it.episodes : [];
                    const drawerId = "adm_pl_" + esc(it.uid || (it.tmdbId + "_" + idx));
                    const epPreviewCodes = epsList.slice(0, 3).map(e => e.code || ("S" + String(e.season || 1).padStart(2, "0") + "E" + String(e.episode || 1).padStart(2, "0"))).join(", ");
                    const epDrawerToggleHtml = (tc === "s" && epsList.length > 0)
                      ? ('<button type="button" class="btn" style="padding:3px 8px;font-size:11px;background:rgba(56,189,248,0.16);border-color:rgba(56,189,248,0.45);color:#38bdf8" onclick="toggleSeriesEpisodesDrawerClient(event,\\'' + drawerId + '\\')" title="Importierte Serienfolgen auf-/zuklappen">📺 ' + epsList.length + ' Folge' + (epsList.length === 1 ? '' : 'n') + ' (' + esc(epPreviewCodes) + (epsList.length > 3 ? '…' : '') + ') <span id="epDrawerIcon_' + drawerId + '">▾</span></button>')
                      : '';
                    const epDrawerBodyHtml = (tc === "s" && epsList.length > 0)
                      ? ('<div id="epDrawer_' + drawerId + '" style="display:none;flex-direction:column;gap:4px;margin-top:6px;padding:8px;border-radius:8px;background:rgba(15,23,42,0.88);border:1px solid rgba(56,189,248,0.35)">' +
                          epsList.map(ep => {
                            const epCode = ep.code || ("S" + String(ep.season || 1).padStart(2, "0") + "E" + String(ep.episode || 1).padStart(2, "0"));
                            const epTitle = ep.title || ("Folge " + (ep.episode || 1));
                            const qStr = [ep.quality || "1080p", ep.codec || ""].filter(Boolean).join(" • ");
                            return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.04);font-size:11.5px">' +
                              '<div style="cursor:pointer;flex:1" onclick="openDetails(\\'s\\',' + Number(it.tmdbId) + ',false,\\'\\',\\'\\',' + Number(ep.season || 1) + ')">' +
                                '<b style="color:#38bdf8">' + esc(epCode) + '</b> – <span style="color:#f8fafc">' + esc(epTitle) + '</span>' +
                                (qStr ? ' <span style="color:#94a3b8;font-size:10.5px">[' + esc(qStr) + ']</span>' : '') +
                              '</div>' +
                              '<button type="button" class="btn" style="padding:2px 7px;font-size:10.5px" onclick="openDetails(\\'s\\',' + Number(it.tmdbId) + ',false,\\'\\',\\'\\',' + Number(ep.season || 1) + ')">Staffel ' + Number(ep.season || 1) + ' öffnen</button>' +
                            '</div>';
                          }).join("") +
                        '</div>')
                      : '';
                    return '<div class="ep-row" style="flex-direction:column;align-items:stretch">' +
                      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
                        '<div style="display:flex;align-items:center;flex:1;min-width:180px">' +
                          '<span style="font-size:11.5px;font-weight:900;color:#64748b;width:28px;text-align:center;flex-shrink:0">#' + (idx + 1) + '</span>' +
                          (pImg
                            ? '<img src="' + esc(pImg) + '" style="width:32px;height:46px;object-fit:cover;border-radius:4px;margin-right:8px;flex-shrink:0" alt="" />'
                            : '<div style="width:32px;height:46px;background:#1e293b;border-radius:4px;margin-right:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + (tc === "s" ? "📺" : "🎬") + '</div>') +
                          '<div style="flex:1;min-width:140px;cursor:pointer" onclick="openDetails(\\'' + tc + '\\',' + Number(it.tmdbId) + ',false)">' +
                            '<div style="font-size:12.5px;font-weight:800;color:#fff">' +
                              (tc === "s" ? "📺 " : "🎬 ") + esc(it.title) + ' <span style="color:#94a3b8;font-weight:600">(' + esc(it.year || "k.A.") + ')</span>' +
                              (it.syncedFromD1 ? ' <span style="font-size:10px;padding:1px 6px;border-radius:999px;background:rgba(16,185,129,0.18);color:#34d399;margin-left:4px">🤖 D1-Bot</span>' : '') +
                            '</div>' +
                            '<div style="font-size:11px;color:#38bdf8">' +
                              'TMDb #' + Number(it.tmdbId) + ' • ' + qualDisplay +
                              (streamCountNum > 0 ? (' • <b style="color:#fbbf24">' + streamCountNum + (tc === "s" ? (' Folge' + (streamCountNum === 1 ? '' : 'n') + '/Streams') : (' Bot-Stream' + (streamCountNum === 1 ? '' : 's'))) + '</b>') : '') +
                              (it.genres ? (' • ' + esc(it.genres)) : '') +
                            '</div>' +
                          '</div>' +
                        '</div>' +
                        '<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">' +
                          epDrawerToggleHtml +
                          (idx > 0 ? '<button class="btn" style="padding:4px 7px;font-size:11px" title="Nach ganz oben" onclick="adminReorderPlaylistItem(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(it.uid) + '\\',\\'top\\')">⏫</button>' : '') +
                          (idx > 0 ? '<button class="btn" style="padding:4px 7px;font-size:11px" title="Position nach oben" onclick="adminReorderPlaylistItem(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(it.uid) + '\\',\\'up\\')">⬆️</button>' : '') +
                          (idx < activeFolderItems.length - 1 ? '<button class="btn" style="padding:4px 7px;font-size:11px" title="Position nach unten" onclick="adminReorderPlaylistItem(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(it.uid) + '\\',\\'down\\')">⬇️</button>' : '') +
                          '<button class="btn" style="padding:4px 8px;font-size:11px" title="Details & Streams öffnen" onclick="openDetails(\\'' + tc + '\\',' + Number(it.tmdbId) + ',false)">👁️</button>' +
                          '<button class="btn" style="padding:4px 8px;font-size:11px;border-color:rgba(245,158,11,0.45);color:#fbbf24" title="Nur aus dieser Playlist entfernen (Film/Serie bleibt in D1 erhalten)" onclick="adminRemovePlaylistItem(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(it.uid) + '\\')">➖ Aus Playlist</button>' +
                          '<button class="btn red" style="padding:4px 8px;font-size:11px" title="Komplett aus D1-Datenbank + Telegram-Bot UND aus Playlist löschen" onclick="adminDeletePlaylistItemFromD1(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(it.uid) + '\\',\\'' + tc + '\\',' + Number(it.tmdbId) + ',\\'' + esc(it.title) + '\\')">🗑️ Aus D1 + Bot</button>' +
                        '</div>' +
                      '</div>' +
                      epDrawerBodyHtml +
                    '</div>';
                  }).join("") +
                '</div>'
              )) +
            '</div>'
          ) : '';

          const playlistsManagerBoxHtml =
            '<div class="panel-box" style="border-color:rgba(16,185,129,0.4)">' +
              '<div class="section-title">' +
                '<span>🎵 Smarte Custom Playlisten, Bot-VIP-Playlist & 25er-Batch-Kopie (' + adminPlaylists.length + ')</span>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                  '<button class="btn amber" onclick="adminOpenBotVipPlaylistDirect()">🤖 Bot-VIP-Playlist öffnen</button>' +
                  '<button class="btn blue" onclick="adminSyncBotVipFromD1Client(true)" title="Synchronisiert alle in D1 gespeicherten Bot-Filme & -Serien in 25er-Batches in die Bot-VIP-Playlist">🔄 D1-Katalog (25er-Batches) synchronisieren</button>' +
                  '<select onchange="state.adminPlaylistTargetChatId=this.value;state.adminEditingFolderId=\\'\\';backupImportJob.targetPlaylistChatId=this.value;loadAdminPanelView()" style="padding:6px 10px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:12px">' +
                    userSelectOptionsHtml +
                  '</select>' +
                  '<button class="btn green" onclick="adminCreatePlaylistPrompt()">➕ Neue Playlist</button>' +
                '</div>' +
              '</div>' +
              '<p style="font-size:12px;color:#aaa;margin-bottom:10px">Alle Playlisten werden automatisch in <b>25er-Batches</b> kopiert und synchronisiert – dadurch wird das <b>Cloudflare 50-Subrequest-Limit</b> niemals erreicht, egal ob 50 oder 5.000 Filme!</p>' +
              '<div id="adminPlaylistBatchProgressBox" style="display:none;margin-bottom:10px;padding:10px 12px;border-radius:8px;background:#101827;border:1px solid rgba(56,189,248,0.4)"></div>' +
              (adminPlaylists.length === 0
                ? '<div style="font-size:12px;color:#94a3b8;padding:8px 0">Noch keine Playlisten oder Ordner für dieses Ziel vorhanden.</div>'
                : adminPlaylists.map(pl => {
                    const isEn = pl.enabled !== false;
                    const isEditingThis = String(pl.id) === String(activeFolderId);
                    const pMode = pl.playlistMode || "both";
                    const modeBadge = pMode === "vip_stream"
                      ? '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(245,158,11,0.2);color:#fbbf24;margin-left:6px">🌟 VIP-Stream</span>'
                      : pMode === "watchlist"
                        ? '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(56,189,248,0.2);color:#38bdf8;margin-left:6px">🔖 Merkliste</span>'
                        : '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(16,185,129,0.2);color:#34d399;margin-left:6px">⚡ VIP + Merkliste</span>';
                    return '<div class="ep-row" style="' + (isEn ? '' : 'opacity:0.68;') + (isEditingThis ? 'border:1px solid rgba(251,191,36,0.55);background:rgba(251,191,36,0.06);' : '') + '">' +
                      '<div style="flex:1">' +
                        '<div style="font-size:13px;font-weight:800;color:#fff">' +
                          '<span style="font-size:11px;padding:2px 6px;border-radius:999px;margin-right:6px;background:' + (isEn ? 'rgba(16,185,129,0.2);color:#34d399' : 'rgba(148,163,184,0.2);color:#94a3b8') + '">' +
                            (isEn ? '🟢 Aktiv' : '⚪ Aus') +
                          '</span>' +
                          esc(pl.name) + ' <span style="color:#38bdf8;font-size:11.5px">(' + Number(pl.itemCount || 0) + ' Titel)</span>' +
                          modeBadge +
                        '</div>' +
                        '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' +
                          (pl.isJsonPlaylist || pl.type === 'playlist' ? '📦 JSON-/VIP-Playlist' : '📁 Custom Ordner') +
                          (pl.sourceLabel ? ' • Quelle: ' + esc(pl.sourceLabel) : '') +
                        '</div>' +
                      '</div>' +
                      '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                        '<button class="btn ' + (isEditingThis ? 'amber' : 'blue') + '" onclick="adminOpenPlaylistEditor(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(pl.id) + '\\')">📂 Öffnen & Bearbeiten</button>' +
                        '<button class="btn green" onclick="adminCopyPlaylistBatchClient(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(pl.id) + '\\',\\'' + esc(pl.name) + '\\')" title="Kopiert diese Playlist in 25er-Batches ohne API-Limit">📋 25er-Batch Kopie</button>' +
                        '<button class="btn ' + (isEn ? 'green' : '') + '" onclick="adminTogglePlaylist(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(pl.id) + '\\')">' + (isEn ? '🟢 Ein' : '⚪ Aus') + '</button>' +
                        '<button class="btn" onclick="adminRenamePlaylist(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(pl.id) + '\\',\\'' + esc(pl.name) + '\\')">✏️</button>' +
                        '<button class="btn red" onclick="adminDeletePlaylist(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(pl.id) + '\\',\\'' + esc(pl.name) + '\\')">🗑️</button>' +
                      '</div>' +
                    '</div>';
                  }).join("")
              ) +
              playlistEditorBoxHtml +
            '</div>';

          const savedChanVal = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
          const isChanReady = Boolean(savedChanVal && (savedChanVal.startsWith("-100") || savedChanVal.startsWith("@")));

          root.innerHTML = '<div class="section">' +
            '<div class="section-title">' +
              '<span>👑 Admin-Dashboard & VIP- / Playlisten- / Backup-Verwaltung</span>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="btn ' + (state.adminTab === 'users' ? 'red' : '') + '" onclick="state.adminTab=\\'users\\';loadAdminPanelView()">👥 User & VIP (' + users.length + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'reports' ? 'red' : (openReportsCount > 0 ? 'amber' : '')) + '" onclick="state.adminTab=\\'reports\\';loadAdminPanelView()">🚨 Meldungen (' + openReportsCount + ' offen)</button>' +
                '<button class="btn ' + (state.adminTab === 'gaps' ? 'red' : (Number(seriesGaps.seriesWithInternalGapsCount || 0) > 0 ? 'amber' : 'blue')) + '" onclick="state.adminTab=\\'gaps\\';loadAdminPanelView()" title="Fehlende Folgen in Serien (insb. Lücken mitten in einer Staffel wie Folge 1+2 fehlt, Folge 3 ist da)">📉 Serien-Lücken (' + Number(seriesGaps.seriesWithGapsCount || 0) + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'playlists' ? 'red' : 'green') + '" onclick="state.adminTab=\\'playlists\\';loadAdminPanelView()">🎵 Playlisten & Bot-VIP (' + adminPlaylists.length + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'backup' ? 'red' : 'amber') + '" onclick="state.adminTab=\\'backup\\';loadAdminPanelView()">📦 Backup-Import (100k+)</button>' +
                '<button class="btn ' + (state.adminTab === 'diaglog' ? 'red' : 'blue') + '" onclick="state.adminTab=\\'diaglog\\';loadAdminPanelView()">🛠️ Diagnose-Log (' + getDiagnosticLogTotalCountClient() + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'crud' ? 'red' : '') + '" onclick="state.adminTab=\\'crud\\';loadAdminPanelView()">🎬 Film/Serien CRUD (' + mediaList.length + ')</button>' +
                '<button class="btn" onclick="adminRunD1DedupeFilesClient()" title="Entfernt alle doppelten oder defekten Stream-Buttons in D1">🧹 Doppelte Buttons bereinigen</button>' +
                '<button class="btn red" onclick="adminRunCompleteMediaResetClient()" title="Löscht alle Filme, Serien, Episoden & Playlisten für einen sauberen Neustart">🧨 Komplett-Reset</button>' +
                '<button class="btn" onclick="goHome()">🏠 Hauptseite</button>' +
              '</div>' +
            '</div>' +
            buildAntiSpamCockpitBoxHtmlClient() +
            (state.adminTab === "users" ? (
              '<div class="panel-box">' +
                '<div class="section-title"><span>👥 Registrierte Telegram- & Web-Nutzer (' + users.length + ')</span></div>' +
                (users.length === 0 ? '<div style="font-size:12px;color:#aaa">Noch keine Nutzer in D1 registriert.</div>' : '') +
                users.map(u => '<div class="ep-row">' +
                  '<div style="flex:1">' +
                    '<div style="font-size:13px;font-weight:800;color:#fff">🆔 ' + esc(u.telegramId) +
                      (u.tgUsername ? ' <span style="color:#60a5fa">@' + esc(u.tgUsername) + '</span>' : '') +
                      (u.customUsername ? ' <span style="color:#34d399">[Web: ' + esc(u.customUsername) + ']</span>' : '') +
                      (u.isAdmin ? ' <span style="color:#f87171">👑 ADMIN</span>' : '') +
                    '</div>' +
                    '<div style="font-size:11px;color:#94a3b8">' +
                      (u.hasPasswordAccount ? '🔐 Passwort-Account aktiv' : '📱 Nur Telegram initData') +
                      (u.totpEnabled ? ' • 🛡️ 2FA aktiv' : '') +
                      ' • Zuletzt aktiv: ' + (u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString('de-DE') : '–') +
                    '</div>' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button class="btn" onclick="state.adminPlaylistTargetChatId=\\'' + esc(u.telegramId) + '\\';state.adminTab=\\'playlists\\';loadAdminPanelView()">🎵 Playlisten</button>' +
                    '<button class="btn ' + (u.isVip ? 'amber' : '') + '" onclick="toggleUserVipAdmin(\\'' + esc(u.telegramId) + '\\',' + (!u.isVip) + ')">' +
                      (u.isVip ? '🌟 VIP AKTIV (Entziehen)' : '⚪ Kein VIP (VIP vergeben)') +
                    '</button>' +
                  '</div>' +
                '</div>').join("") +
              '</div>'
            ) : state.adminTab === "reports" ? (
              '<div class="panel-box" style="border-color:rgba(245,158,11,0.45)">' +
                '<div class="section-title">' +
                  '<span>🚨 Eingegangene Fehlermeldungen von VIPs & Admins (' + openReportsCount + ' offen / ' + allReports.length + ' gesamt)</span>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button class="btn ' + (reportFilter === 'open' ? 'red' : '') + '" onclick="state.adminReportFilter=\\'open\\';loadAdminPanelView()">🔥 Offen (' + openReportsCount + ')</button>' +
                    '<button class="btn ' + (reportFilter === 'resolved' ? 'green' : '') + '" onclick="state.adminReportFilter=\\'resolved\\';loadAdminPanelView()">✅ Gelöst (' + (allReports.length - openReportsCount) + ')</button>' +
                    '<button class="btn ' + (reportFilter === 'all' ? 'blue' : '') + '" onclick="state.adminReportFilter=\\'all\\';loadAdminPanelView()">📋 Alle (' + allReports.length + ')</button>' +
                  '</div>' +
                '</div>' +
                '<p style="font-size:12px;color:#94a3b8;margin-bottom:10px">Klicke auf <b>🔧 Jetzt korrigieren</b>, um direkt in die Detailansicht & den Folgen-Korrektur-Dialog zu springen. Sobald du die Korrektur speicherst, wird die Meldung automatisch als gelöst markiert!</p>' +
                (filteredReports.length === 0 ? (
                  '<div style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;background:#101015;border-radius:8px">🎉 Keine ' + (reportFilter === 'open' ? 'offenen ' : '') + 'Fehlermeldungen vorhanden.</div>'
                ) : (
                  filteredReports.map(rep => {
                    const isOpen = rep.status === "open";
                    const tc = rep.type_code === "s" ? "s" : "m";
                    const epStr = tc === "s" && rep.season_number
                      ? (' • <b style="color:#38bdf8">S' + String(rep.season_number).padStart(2, '0') + 'E' + String(rep.episode_number || 1).padStart(2, '0') + '</b>' + (rep.episode_title ? (' (' + esc(rep.episode_title) + ')') : ''))
                      : '';
                    return '<div class="ep-row" style="' + (isOpen ? 'border-color:rgba(245,158,11,0.5);background:rgba(245,158,11,0.06);' : 'opacity:0.75;') + '">' +
                      '<div style="flex:1;min-width:210px">' +
                        '<div style="font-size:13px;font-weight:800;color:#fff">' +
                          '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;margin-right:6px;background:' + (isOpen ? 'rgba(239,68,68,0.22);color:#fca5a5' : 'rgba(16,185,129,0.22);color:#6ee7b7') + '">' +
                            (isOpen ? '🚨 OFFEN' : '✅ GELÖST') +
                          '</span>' +
                          (tc === 's' ? '📺 ' : '🎬 ') + esc(rep.title) + ' <span style="color:#94a3b8;font-weight:600">(TMDb #' + Number(rep.tmdb_id) + ')</span>' +
                          epStr +
                          (rep.version_label ? (' <span class="flix-version-badge" style="margin-left:6px">🎞️ ' + esc(rep.version_label) + '</span>') : '') +
                        '</div>' +
                        '<div style="font-size:12px;color:#fbbf24;font-weight:700;margin-top:4px">' +
                          esc(rep.reason_label || '⚠️ Fehler gemeldet') +
                          (rep.note ? (' — <span style="color:#f8fafc;font-weight:500">„' + esc(rep.note) + '“</span>') : '') +
                        '</div>' +
                        '<div style="font-size:11px;color:#94a3b8;margin-top:3px">' +
                          '👤 Gemeldet von: <b>' + (rep.reporter_username ? ('@' + esc(rep.reporter_username) + ' (' + esc(rep.reporter_telegram_id) + ')') : esc(rep.reporter_telegram_id)) + '</b>' +
                          ' • ' + (rep.created_at ? new Date(Number(rep.created_at)).toLocaleString('de-DE') : '') +
                          (!isOpen && rep.resolved_by ? (' • Gelöst von: <b style="color:#34d399">' + esc(rep.resolved_by) + '</b>') : '') +
                        '</div>' +
                      '</div>' +
                      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                        '<button type="button" class="btn blue" onclick="openReportCorrectionWorkflowByIdClient(' + Number(rep.id) + ')">🔧 Jetzt korrigieren</button>' +
                        (isOpen ? '<button type="button" class="btn green" onclick="adminResolveMediaReportClient(' + Number(rep.id) + ')">✅ Als gelöst markieren</button>' : '') +
                        '<button type="button" class="btn red" onclick="adminDeleteMediaReportClient(' + Number(rep.id) + ')" title="Meldung löschen">🗑️</button>' +
                      '</div>' +
                    '</div>';
                  }).join("")
                )) +
              '</div>'
            ) : state.adminTab === "playlists" ? (
              playlistsManagerBoxHtml
            ) : state.adminTab === "gaps" ? (
              '<div class="panel-box" style="border-color:rgba(245,158,11,0.5)">' +
                '<div class="section-title">' +
                  '<span>📉 Fehlende Serienfolgen & Staffel-Lücken Finder (' + Number(seriesGaps.seriesWithGapsCount || 0) + ' Serien mit Lücken von ' + Number(seriesGaps.totalSeriesChecked || 0) + ' geprüften Serien)</span>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button class="btn ' + ((state.adminGapFilter || 'all') === 'all' ? 'amber' : '') + '" onclick="state.adminGapFilter=\\'all\\';loadAdminPanelView()">📋 Alle Lücken (' + Number(seriesGaps.seriesWithGapsCount || 0) + ')</button>' +
                    '<button class="btn ' + (state.adminGapFilter === 'internal' ? 'red' : '') + '" onclick="state.adminGapFilter=\\'internal\\';loadAdminPanelView()">🚨 Nur Lücken mitten in der Staffel (' + Number(seriesGaps.seriesWithInternalGapsCount || 0) + ')</button>' +
                  '</div>' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:8px;margin-bottom:12px;font-size:12px">' +
                  '<div style="background:#161620;padding:9px 11px;border-radius:8px;border:1px solid rgba(239,68,68,0.4)">🚨 <b>Lücken mitten in Staffel (Prio 1):</b> <span style="color:#f87171;font-weight:900">' + Number(seriesGaps.totalMissingInternal || 0) + ' Folgen</span> in ' + Number(seriesGaps.seriesWithInternalGapsCount || 0) + ' Serien</div>' +
                  '<div style="background:#161620;padding:9px 11px;border-radius:8px;border:1px solid rgba(56,189,248,0.35)">⏳ <b>Fehlend am Staffelende (Prio 2):</b> <span style="color:#38bdf8;font-weight:900">' + Number(seriesGaps.totalMissingTrailing || 0) + ' Folgen</span></div>' +
                  '<div style="background:#161620;padding:9px 11px;border-radius:8px;border:1px solid rgba(245,158,11,0.4)">⚠️ <b>Nur als Vorabversion/TS/MD:</b> <span style="color:#fbbf24;font-weight:900">' + Number(seriesGaps.totalPrereleaseOnly || 0) + ' Folgen</span></div>' +
                '</div>' +
                '<p style="font-size:12px;color:#94a3b8;margin-bottom:10px">💡 <b>Besonders wichtig (rot markiert):</b> Wenn z.B. <code>Folge 1 + 2</code> fehlen, während <code>Folge 3</code> bereits vorhanden ist, steht diese Serie ganz oben, damit du die Lücken sofort gezielt füllen kannst.</p>' +
                ((() => {
                  const gapItems = (seriesGaps.items || []).filter(item => state.adminGapFilter === "internal" ? item.hasPriorityInternalGaps : true);
                  if (gapItems.length === 0) {
                    return '<div style="padding:18px;text-align:center;color:#34d399;font-size:12.5px;background:#101016;border-radius:8px;border:1px solid rgba(16,185,129,0.35)">🎉 Perfekt! Keine fehlenden Serienfolgen in dieser Ansicht gefunden.</div>';
                  }
                  return '<div style="display:flex;flex-direction:column;gap:10px;max-height:620px;overflow-y:auto;padding-right:4px">' +
                    gapItems.map(sItem => {
                      const pImg = resolvePosterUrlClient(sItem.poster, "w185", "");
                      return '<div style="background:#12121a;border:1px solid ' + (sItem.hasPriorityInternalGaps ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.14)') + ';border-radius:10px;padding:11px;display:flex;flex-direction:column;gap:8px">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
                          '<div style="display:flex;align-items:center;gap:10px;min-width:200px;flex:1">' +
                            (pImg
                              ? '<img src="' + esc(pImg) + '" style="width:38px;height:56px;object-fit:cover;border-radius:5px;flex-shrink:0" alt="" />'
                              : '<div style="width:38px;height:56px;background:#1e293b;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📺</div>') +
                            '<div>' +
                              '<div style="font-size:13.5px;font-weight:900;color:#fff;display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                                esc(sItem.title) + ' <span style="color:#94a3b8;font-weight:600;font-size:12px">(' + esc(sItem.year || 'k.A.') + ' • TMDb #' + Number(sItem.seriesId) + ')</span>' +
                                (sItem.hasPriorityInternalGaps ? '<span style="background:rgba(239,68,68,0.22);color:#fca5a5;border:1px solid rgba(239,68,68,0.5);padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:800">🚨 LÜCKE MITTEN IN DER STAFFEL (' + Number(sItem.totalInternalMissing) + ' fehlt)</span>' : '') +
                              '</div>' +
                              '<div style="font-size:11.5px;color:#cbd5e1;margin-top:3px">' +
                                'Innerhalb der Staffel fehlend: <b style="color:#f87171">' + Number(sItem.totalInternalMissing || 0) + '</b> • Am Staffelende offen: <b style="color:#38bdf8">' + Number(sItem.totalTrailingMissing || 0) + '</b>' +
                                (Number(sItem.totalPrerelease || 0) > 0 ? (' • Nur Vorabversion/TS/MD: <b style="color:#fbbf24">' + Number(sItem.totalPrerelease) + '</b>') : '') +
                              '</div>' +
                            '</div>' +
                          '</div>' +
                          '<button class="btn blue" onclick="openDetails(\\'s\\',' + Number(sItem.seriesId) + ',false)">📺 Serie öffnen</button>' +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;gap:6px">' +
                          (sItem.seasons || []).map(sec => {
                            const intCodes = (sec.internalGaps || []).map(epN => 'S' + String(sec.seasonNumber).padStart(2, '0') + 'E' + String(epN).padStart(2, '0'));
                            const trailCodes = (sec.trailingMissing || []).map(epN => 'S' + String(sec.seasonNumber).padStart(2, '0') + 'E' + String(epN).padStart(2, '0'));
                            const preCodes = (sec.prereleaseEpisodes || []).map(epN => 'S' + String(sec.seasonNumber).padStart(2, '0') + 'E' + String(epN).padStart(2, '0'));
                            const upCodes = (sec.uploadedEpisodes || []).map(epN => 'E' + String(epN).padStart(2, '0'));
                            return '<div style="background:#181824;border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                              '<div style="flex:1;min-width:210px;font-size:11.5px">' +
                                '<div style="font-weight:800;color:#fff;margin-bottom:3px">' +
                                  'Staffel ' + Number(sec.seasonNumber) + ' <span style="color:#34d399;font-weight:700">(' + Number(sec.uploadedCount) + ' / ' + Number(sec.expectedTotalEpisodes) + ' Folgen vorhanden: ' + esc(upCodes.slice(0, 12).join(', ')) + (upCodes.length > 12 ? '…' : '') + ')</span>' +
                                '</div>' +
                                (intCodes.length > 0 ? (
                                  '<div style="color:#fca5a5;margin-top:2px">🚨 <b>Fehlt mitten in Staffel ' + Number(sec.seasonNumber) + ' (vor E' + String(sec.maxUploadedEp).padStart(2, '0') + '):</b> <code style="background:rgba(239,68,68,0.2);color:#fecaca;padding:1px 6px;border-radius:4px;font-weight:800">' + esc(intCodes.join(', ')) + '</code></div>'
                                ) : '') +
                                (trailCodes.length > 0 ? (
                                  '<div style="color:#93c5fd;margin-top:2px">⏳ <b>Fehlt ab E' + String(sec.maxUploadedEp + 1).padStart(2, '0') + ' bis Staffelende:</b> <code style="background:rgba(56,189,248,0.14);color:#bae6fd;padding:1px 6px;border-radius:4px">' + esc(trailCodes.slice(0, 15).join(', ')) + (trailCodes.length > 15 ? (' +' + (trailCodes.length - 15) + ' weitere') : '') + '</code></div>'
                                ) : '') +
                                (preCodes.length > 0 ? (
                                  '<div style="color:#fde68a;margin-top:2px">⚠️ <b>Nur als Vorabversion / TS / MD vorhanden (wird bei gutem Upload automatisch ersetzt):</b> <code style="background:rgba(245,158,11,0.2);color:#fef08a;padding:1px 6px;border-radius:4px">' + esc(preCodes.join(', ')) + '</code></div>'
                                ) : '') +
                              '</div>' +
                              '<button class="btn" style="padding:4px 9px;font-size:11px" onclick="openDetails(\\'s\\',' + Number(sItem.seriesId) + ',false,\\'\\',\\'\\',' + Number(sec.seasonNumber) + ')">Staffel ' + Number(sec.seasonNumber) + ' öffnen</button>' +
                            '</div>';
                          }).join("") +
                        '</div>' +
                      '</div>';
                    }).join("") +
                  '</div>';
                })()) +
              '</div>'
            ) : state.adminTab === "diaglog" ? (
              renderImportDiagnosticLogBoxHtml()
            ) : state.adminTab === "backup" ? (
              '<div class="panel-box" style="border-color:rgba(56,189,248,0.5)">' +
                '<div class="section-title">' +
                  '<span>📡 Schritt 1 (Pflicht vor JSON-Upload): Quell-Kanal / Gruppen-ID prüfen & Dry-Run</span>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button class="btn" onclick="adminRunD1DedupeFilesClient()">🧹 Doppelte Stream-Buttons bereinigen</button>' +
                    '<button class="btn red" onclick="adminRunCompleteMediaResetClient()">🧨 Komplett-Reset (Alle Medien löschen)</button>' +
                  '</div>' +
                '</div>' +
                '<p style="font-size:12px;color:#cbd5e1;line-height:1.5;margin-bottom:8px">' +
                  '⚠️ <b>Strikte Kanal-ID-Pflicht:</b> Gib die Telegram Kanal-/Gruppen-ID (<code>-100...</code>) oder einen Beispiel-Link aus dem Kanal (z. B. <code>https://t.me/c/1234567890/42</code>) ein. Ohne geprüfte Kanal-ID ist der JSON-Upload gesperrt, damit niemals fehlerhafte Datei-IDs entstehen!' +
                '</p>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                  '<input id="backupSourceChannelInp" value="' + esc(savedChanVal) + '" placeholder="-1001234567890 oder https://t.me/c/1234567890/42" style="flex:1;min-width:240px;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(56,189,248,0.45);font-family:monospace;font-size:12px" />' +
                  '<input id="backupSampleMsgIdInp" type="number" placeholder="Test Msg-ID (opt.)" style="width:140px;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-family:monospace;font-size:12px" />' +
                  '<button class="btn green" onclick="verifyBackupChannelClient()">🔍 Kanal prüfen & freischalten (Dry-Run)</button>' +
                '</div>' +
                '<div id="backupChannelVerifyBanner" style="display:' + (isChanReady ? 'block' : 'none') + ';margin-top:8px;padding:8px 10px;border-radius:6px;background:rgba(16,185,129,0.14);border:1px solid rgba(16,185,129,0.4);font-size:12px;color:#34d399">' +
                  (isChanReady ? ('✅ Verifizierte Quell-Kanal-ID aktiv: <code>' + esc(savedChanVal) + '</code> – JSON-Upload ist freigeschaltet!') : '') +
                '</div>' +
              '</div>' +
              '<div class="panel-box">' +
                '<div class="section-title">' +
                  '<span>📦 Schritt 2: Telegram Chat-Backup (result.json) hochladen (mit Auto-Checkpoint & Fortsetzen)</span>' +
                  '<button class="btn" onclick="openLargeJsonHowToModalClient()">✂️ >200 MB How-To & CLI Guide</button>' +
                '</div>' +
                '<p style="font-size:12px;color:#ccc;line-height:1.5;margin-bottom:10px">' +
                  'Erkennt automatisch <b>Telegram Desktop Chat-Backups (<code>result.json</code> auch über 200 MB per 2 MB <code>File.slice()</code> Stream-Slicer)</b>. ' +
                  'Merkt sich nach jedem Batch automatisch den <b>Fortschritts-Checkpoint</b> und verhindert bei Neustart jegliche Duplikate.' +
                '</p>' +
                '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
                  '<input id="backupJsonFileInputEl" type="file" accept=".json,application/json" ' + (!isChanReady ? 'disabled' : '') + ' onchange="handleBackupFileInput(event)" style="font-size:12px;color:#fff;background:#141414;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);opacity:' + (isChanReady ? '1' : '0.45') + '" />' +
                  '<button class="btn amber" onclick="downloadBackupSplitPartClient(0, 250)">💾 Part #1 (250 Videos) als .json laden</button>' +
                  '<span id="backupParseNotice" style="font-size:12px;color:#fbbf24"></span>' +
                '</div>' +
                '<div id="backupImportLiveMount" style="margin-top:10px"></div>' +
                (qStats.pendingCount > 0 ? (
                  '<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1)">' +
                    '<div style="font-size:13px;font-weight:800;color:#fbbf24;margin-bottom:6px">📥 Aktive D1-Server-Warteschlange (vom Telegram-Bot hochgeladen): ' + qStats.pendingCount + ' offen</div>' +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                      '<button class="btn green" onclick="runServerD1QueueStepAdmin(2)">▶️ Nächste 24 aus D1-Queue verarbeiten</button>' +
                      '<button class="btn red" onclick="clearServerD1QueueAdmin()">🗑️ D1-Queue leeren</button>' +
                    '</div>' +
                  '</div>'
                ) : '') +
              '</div>' +
              playlistsManagerBoxHtml
            ) : (
              '<div class="panel-box">' +
                '<div class="section-title"><span>➕ Film oder Serie in D1 anlegen / bearbeiten (CRUD)</span></div>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px">' +
                  '<select id="crudTypeSel" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)">' +
                    '<option value="m" ' + (state.adminMediaType === 'm' ? 'selected' : '') + '>🎬 Film (movies)</option>' +
                    '<option value="s" ' + (state.adminMediaType === 's' ? 'selected' : '') + '>📺 Serie (series)</option>' +
                  '</select>' +
                  '<input id="crudTmdbIdInp" placeholder="TMDB-ID (z.B. 603)" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudTitleInp" placeholder="Sauberer Titel (optional bei TMDB-Auto)" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudYearInp" placeholder="Release-Jahr (z.B. 1999)" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudFileIdInp" placeholder="Optionale telegram_file_id" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudQualityInp" placeholder="Qualität (z.B. 1080p / 4K)" value="1080p" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudFileSizeInp" placeholder="Dateigröße (z.B. 2.45 GB / 890 MB)" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudTagsInp" placeholder="Tags (z.B. DE · DL · HDR · BluRay)" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                  '<button class="btn green" onclick="submitAdminMediaCrud()">💾 In D1 speichern / von TMDB synchronisieren</button>' +
                  '<button class="btn ' + (state.adminMediaType === 'm' ? 'active' : '') + '" onclick="state.adminMediaType=\\'m\\';loadAdminPanelView()">🎬 Filme in D1 zeigen</button>' +
                  '<button class="btn ' + (state.adminMediaType === 's' ? 'active' : '') + '" onclick="state.adminMediaType=\\'s\\';loadAdminPanelView()">📺 Serien in D1 zeigen</button>' +
                '</div>' +
                '<div style="margin-top:14px">' +
                  mediaList.map(m => '<div class="ep-row">' +
                    '<div class="ep-title" onclick="openDetails(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ',false)">' +
                      '<b>#' + m.tmdb_id + ' – ' + esc(m.title) + '</b> (' + esc(m.release_year || 'k.A.') + ') • ⭐ ' + Number(m.vote_average || 0).toFixed(1) + ' • ' + esc(m.genres || '') +
                    '</div>' +
                    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                      '<button class="btn purple" onclick="openDetailsWithAdminTool(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ',\\'poster\\')" title="Cover/Poster ändern">🖼️ Cover</button>' +
                      '<button class="btn blue" onclick="openDetailsWithAdminTool(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ',\\'remap\\')" title="Titel neu zuordnen & Original-Link prüfen">🔄 Neu zuordnen</button>' +
                      '<button class="btn red" onclick="deleteAdminMediaCrud(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ')">🗑️ Löschen</button>' +
                    '</div>' +
                  '</div>').join("") +
                '</div>' +
              '</div>'
            )) +
          '</div>';
          if (state.adminTab === "backup") {
            renderBackupImportBoxDom();
          }
          if (typeof pollAntiSpamQueueClient === "function") {
            pollAntiSpamQueueClient(true);
          }
        } finally {
          setBusyState(false);
        }
      }

      async function openReportCorrectionWorkflowByIdClient(reportId) {
        const list = Array.isArray(window._adminReportsCache) ? window._adminReportsCache : [];
        const found = list.find(r => Number(r?.id) === Number(reportId));
        if (!found) {
          showHudToast("⚠️ Meldung #" + reportId + " nicht im Cache gefunden.");
          return;
        }
        await openReportCorrectionWorkflowClient(found);
      }

      async function toggleUserVipAdmin(targetTelegramId, nextVipState) {
        const r = await apiFetchJson(API_BASE + "/admin/vip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegramId: targetTelegramId, isVip: Boolean(nextVipState) })
        });
        if (r && r.user && state.authUser && String(state.authUser.telegramId) === String(targetTelegramId)) {
          state.authUser = r.user;
          updateSyncBadge();
        }
        clearClientMediaCaches();
        showHudToast(nextVipState ? "🌟 VIP-Status aktiviert" : "⚪ VIP-Status entzogen");
        loadAdminPanelView();
      }

      async function submitAdminMediaCrud() {
        const typeCode = document.getElementById("crudTypeSel")?.value || "m";
        const tmdbId = document.getElementById("crudTmdbIdInp")?.value.trim() || "";
        const title = document.getElementById("crudTitleInp")?.value.trim() || "";
        const year = document.getElementById("crudYearInp")?.value.trim() || "";
        const fileId = document.getElementById("crudFileIdInp")?.value.trim() || "";
        const quality = document.getElementById("crudQualityInp")?.value.trim() || "1080p";
        const fileSize = document.getElementById("crudFileSizeInp")?.value.trim() || "";
        const tags = document.getElementById("crudTagsInp")?.value.trim() || "";
        if (!tmdbId && !title) {
          showHudToast("⚠️ Bitte mindestens eine TMDB-ID oder einen Titel angeben.");
          return;
        }
        setBusyState(true, "💾 Speichere Eintrag in D1...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "upsert", typeCode, tmdbId, title, year, fileId, quality, fileSize, tags })
          });
          clearClientMediaCaches();
          if (!r || !r.ok) showHudToast("⚠️ " + (r?.error || "Fehler beim Speichern"));
          else showHudToast("✅ Eintrag in D1 gespeichert");
          state.adminMediaType = typeCode;
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function deleteAdminMediaCrud(typeCode, tmdbId) {
        const ok = await showCustomConfirm("Diesen Titel (#" + tmdbId + ") wirklich aus D1 löschen?", "🗑️ Löschen");
        if (!ok) return;
        await apiFetchJson(API_BASE + "/admin/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", typeCode, tmdbId })
        });
        clearClientMediaCaches();
        showHudToast("🗑️ Eintrag #" + tmdbId + " gelöscht");
        loadAdminPanelView();
      }

      async function startTmdbAuth() {
        const st = document.getElementById("tmdbSyncStatus");
        if (st) st.textContent = "⏳ Erstelle TMDB-Freigabelink...";
        const r = await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "create_token" }) });
        if (r.ok && r.requestToken) {
          state.pendingTmdbToken = r.requestToken;
          if (tg && tg.openLink) tg.openLink(r.authUrl);
          else window.open(r.authUrl, "_blank");
          loadSettingsView();
          const st2 = document.getElementById("tmdbSyncStatus");
          if (st2) st2.textContent = "👉 Bitte im geöffneten TMDB-Fenster auf 'Approve / Zulassen' tippen und danach auf '✅ 2. Nach Freigabe hier bestätigen' klicken.";
        } else if (st) {
          st.textContent = "⚠️ Fehler: " + (r.error || "Token konnte nicht erstellt werden.");
        }
      }
      async function completeTmdbAuth() {
        const st = document.getElementById("tmdbSyncStatus");
        if (st) st.textContent = "⏳ Verbinde TMDB-Konto & synchronisiere Merkliste...";
        const r = await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "create_session", requestToken: state.pendingTmdbToken }) });
        if (r.ok) {
          state.pendingTmdbToken = "";
          await loadSettingsView();
          const st2 = document.getElementById("tmdbSyncStatus");
          if (st2) st2.textContent = "✅ Verbunden! " + (r.syncResult?.importedCount || 0) + " Titel von TMDB importiert & " + (r.syncResult?.pushedCount || 0) + " zu TMDB übertragen.";
        } else if (st) {
          st.textContent = "⚠️ " + (r.error || "Freigabe wurde auf TMDB noch nicht bestätigt.");
        }
      }
      async function runTmdbSyncNow() {
        const st = document.getElementById("tmdbSyncStatus");
        if (st) st.textContent = "⏳ Synchronisiere mit TMDB...";
        const r = await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "sync_now" }) });
        if (st) {
          st.textContent = r.ok
            ? ("✅ Sync abgeschlossen: " + r.importedCount + " neu von TMDB importiert, " + r.pushedCount + " zu TMDB übertragen.")
            : ("⚠️ " + (r.error || "Synchronisierung fehlgeschlagen."));
        }
      }
      async function disconnectTmdbSync() {
        await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "disconnect" }) });
        loadSettingsView();
      }

      async function initAuthSession() {
        try {
          if (rawInitData) {
            const r = await apiFetchJson(API_BASE + "/auth/init", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ initData: rawInitData })
            });
            if (r && r.ok && r.user) {
              sessionToken = r.sessionToken || sessionToken;
              try { if (sessionToken) localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
              state.isAuthenticated = true;
              state.hasInitData = true;
              state.authUser = r.user;
              chatId = String(r.user.telegramId);
            }
          } else if (sessionToken) {
            const r = await apiFetchJson(API_BASE + "/auth/me");
            if (r && r.ok && r.isAuthenticated && r.user) {
              state.isAuthenticated = true;
              state.authUser = r.user;
              chatId = String(r.user.telegramId);
            } else {
              sessionToken = "";
              try { localStorage.removeItem("tma_session_token"); } catch (e) {}
              state.isAuthenticated = false;
              state.authUser = null;
              chatId = "guest";
            }
          } else {
            state.isAuthenticated = false;
            state.authUser = null;
            chatId = "guest";
          }
        } catch (e) {
          state.isAuthenticated = false;
          state.authUser = null;
          chatId = "guest";
        }
        updateSyncBadge();
        await loadDiscover("m", "all", "trend", "pop_desc");

        // Deep-Link Unterstützung (aus dem Bot -> direkt zur entsprechenden Ansicht in der Mini-App!)
        let deepLinkOpened = false;
        try {
          const params = new URLSearchParams(window.location.search);
          const startParam = String(tg?.initDataUnsafe?.start_param || params.get("tgWebAppStartParam") || "").trim();
          const openCol = params.get("openCol") || (startParam.startsWith("col_") ? startParam.replace("col_", "") : "");
          const openUni = params.get("openUni") || (startParam.startsWith("uni_") ? startParam.replace("uni_", "") : "");
          const openPerson = params.get("openPerson") || "";
          const openItem = params.get("openItem") || ((startParam.startsWith("m_") || startParam.startsWith("s_")) ? startParam : "");

          if (openCol) {
            deepLinkOpened = true;
            await openCollectionView(openCol, "year_asc");
          } else if (openUni) {
            deepLinkOpened = true;
            await openUniverseView(openUni, "year_asc");
          } else if (openPerson) {
            deepLinkOpened = true;
            const pInput = document.getElementById("searchInput");
            if (pInput) pInput.value = openPerson;
            await runSearch(false, openPerson, "person");
          } else if (openItem && openItem.includes("_")) {
            const [tCode, tId] = openItem.split("_");
            if ((tCode === "m" || tCode === "s") && tId) {
              deepLinkOpened = true;
              await openDetails(tCode, tId);
            }
          } else if (startParam === "wishlist") {
            deepLinkOpened = true;
            await loadWishlist("root");
          } else if (startParam === "settings") {
            deepLinkOpened = true;
            await loadSettingsView();
          }
        } catch (e) {}

        // Standard-Auswahl beim Öffnen der App liegt direkt auf dem Suchfeld (#searchInput)
        if (!deepLinkOpened) {
          const defaultSearchInp = document.getElementById("searchInput");
          if (defaultSearchInp && typeof setSpatialFocus === "function") {
            setSpatialFocus(defaultSearchInp, false);
          }
        }
      }

      // =========================================================================
      // SPATIAL NAVIGATION: PFEILTASTEN, ANDROID-TV REMOTE, GAMEPAD, MAUS-HOVER & TYPE-TO-SEARCH
      // Inklusive Select-then-Jump Regel & Hero-Slider Rotations-Navigation!
      // =========================================================================
      const FOCUSABLE_SELECTOR = ".brand-logo, .btn, .detail-collapse-btn, .media-mode-tab, .card, .ff-tab-btn, .f-pill, .sort-chip, .sort-select, .mode-filter-select, .new-filter-select, .df-btn, .ep-title, .hero-btn-play, .hero-btn-info, .hero-circle-arrow, .hero-dot, .hero-hide-btn, .world-portal-card, .ac-item, .search-scope-select, #searchInput, .search-clear-btn, .search-submit-btn, .recent-chip";
      const CARD_SUB_SELECTOR = ".card-quick-info, .card-quick-trailer, .card-quick-save";
      let currentSpatialEl = null;
      let lastSelectJumpAt = 0;

      function clearCardSubnavState(exceptCard = null) {
        document.querySelectorAll(".card.card-subnav-active").forEach(c => {
          if (c !== exceptCard) c.classList.remove("card-subnav-active");
        });
      }

      function isCardSubElement(el) {
        return Boolean(el && el.matches && el.matches(CARD_SUB_SELECTOR));
      }

      function getVisibleFocusables() {
        const dialogEl = document.getElementById("customDialogRoot");
        const modalEl = document.getElementById("modalRoot");
        const lbEl = document.getElementById("lightboxRoot");
        const sidebarEl = document.getElementById("filterSidebarDrawer");
        const scopeRoot = (dialogEl && dialogEl.innerHTML.trim())
          ? dialogEl
          : (lbEl && lbEl.innerHTML.trim())
            ? lbEl
            : (modalEl && modalEl.innerHTML.trim())
              ? modalEl
              : (state.sidebarOpen && sidebarEl)
                ? sidebarEl
                : document.body;
        const nodes = Array.from(scopeRoot.querySelectorAll(FOCUSABLE_SELECTOR));
        return nodes.filter(el => {
          if (el.disabled) return false;
          if (!state.sidebarOpen && sidebarEl && sidebarEl.contains(el)) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
          const r = el.getBoundingClientRect();
          const minDim = (el.classList && el.classList.contains("hero-dot")) ? 2 : 4;
          return r.width > minDim && r.height > minDim;
        });
      }

      function getSpatialLayoutBox(el) {
        const r = el.getBoundingClientRect();
        const isStickyOrFixed = Boolean(
          el && el.closest && (
            el.closest("header") ||
            el.closest(".modal-backdrop") ||
            el.closest(".sidebar-drawer") ||
            el.closest("#customDialogRoot") ||
            el.closest(".lightbox-backdrop")
          )
        );
        const scrollOffset = isStickyOrFixed ? 0 : (window.scrollY || window.pageYOffset || 0);
        return {
          left: r.left,
          right: r.right,
          top: r.top + scrollOffset,
          bottom: r.bottom + scrollOffset,
          width: r.width,
          height: r.height
        };
      }

      let lastSpatialNavDir = "down";

      function syncStickyHeaderCssVars() {
        try {
          const headerEl = document.querySelector("header");
          if (!headerEl) return 54;
          const hr = headerEl.getBoundingClientRect();
          const h = hr.height > 0 ? Math.round(hr.height) : 54;
          document.documentElement.style.setProperty("--sticky-header-height", h + "px");
          document.documentElement.style.setProperty("--sticky-header-offset", (h + 20) + "px");
          return h;
        } catch (e) {
          return 54;
        }
      }

      window.addEventListener("resize", () => { syncStickyHeaderCssVars(); }, { passive: true });
      syncStickyHeaderCssVars();

      function getStickyTopObstructionOffset(el, navDir = "down") {
        let topObstruction = 0;

        const headerEl = document.querySelector("header");
        if (headerEl) {
          const hr = headerEl.getBoundingClientRect();
          if (hr.height > 0) {
            const h = Math.round(hr.height);
            document.documentElement.style.setProperty("--sticky-header-height", h + "px");
            document.documentElement.style.setProperty("--sticky-header-offset", (h + 20) + "px");
            if (hr.bottom > topObstruction) {
              topObstruction = hr.bottom;
            }
          }
        }

        const searchOuter = document.querySelector(".search-bar-outer");
        if (searchOuter && !(el && el.closest && el.closest(".search-bar-outer"))) {
          const cs = window.getComputedStyle(searchOuter);
          if (cs.position === "sticky" || cs.position === "fixed") {
            const sr = searchOuter.getBoundingClientRect();
            if (sr.height > 0 && sr.bottom > topObstruction) {
              topObstruction = sr.bottom;
            }
          }
        }

        const filterBar = document.querySelector(".floating-filter-bar");
        if (filterBar && !(el && el.closest && el.closest(".floating-filter-bar"))) {
          const cs = window.getComputedStyle(filterBar);
          const fr = filterBar.getBoundingClientRect();
          if (cs.position === "sticky" || cs.position === "fixed") {
            if (fr.height > 0 && fr.bottom > topObstruction) {
              topObstruction = fr.bottom;
            }
          } else if (navDir === "up" && el && el.closest && el.closest("#resultsGridContainer")) {
            // Wenn man im Ergebnisse-Grid nach oben navigiert und sich in der obersten Kartenreihe direkt unterhalb der Filterleiste befindet:
            // Filterleisten-Höhe als oberen Puffer einrechnen, damit sowohl die Filterleiste als auch die Karte komplett unter dem Sticky-Header sichtbar werden.
            const elBox = getSpatialLayoutBox(el);
            const fbBox = getSpatialLayoutBox(filterBar);
            if (elBox.top >= fbBox.bottom - 8 && (elBox.top - fbBox.bottom) < 110) {
              topObstruction += Math.max(0, fr.height + 14);
            }
          }
        }

        return Math.max(52, topObstruction);
      }

      function useSpatialScrollIntoView(el, navDir = lastSpatialNavDir) {
        if (!el) return;
        const applyScrollPass = () => {
          try {
            const modalBackdrop = el.closest ? el.closest(".modal-backdrop") : null;
            const sidebarBody = el.closest ? el.closest(".sidebar-body") : null;
            const acBox = el.closest ? el.closest(".search-autocomplete-box") : null;
            const dialogBox = el.closest ? el.closest("#customDialogRoot") : null;

            if (modalBackdrop) {
              const r = el.getBoundingClientRect();
              const modalStickyTop = modalBackdrop.querySelector(".modal-hero-top");
              const stickyOffset = modalStickyTop ? Math.max(28, modalStickyTop.getBoundingClientRect().bottom + 12) : 28;
              const botPad = window.innerHeight - 28;
              if (r.top < stickyOffset) {
                modalBackdrop.scrollTop += (r.top - stickyOffset);
              } else if (r.bottom > botPad) {
                modalBackdrop.scrollTop += (r.bottom - botPad);
              }
              return;
            }

            if (sidebarBody) {
              const sbRect = sidebarBody.getBoundingClientRect();
              const r = el.getBoundingClientRect();
              const topBoundary = sbRect.top + 14;
              const botBoundary = sbRect.bottom - 14;
              if (r.top < topBoundary) {
                sidebarBody.scrollTop += (r.top - topBoundary);
              } else if (r.bottom > botBoundary) {
                sidebarBody.scrollTop += (r.bottom - botBoundary);
              }
              return;
            }

            if (acBox || dialogBox) {
              if (typeof el.scrollIntoView === "function") {
                el.scrollIntoView({ block: "nearest", inline: "nearest" });
              }
              return;
            }

            // Hauptseite: Wenn Fokus auf Header, Suchleiste oder Hero-Slider liegt -> komplett nach oben (top: 0) scrollen
            const inTopZone = Boolean(
              el.closest && (
                el.closest("header") ||
                el.closest(".search-bar-outer") ||
                el.closest("#heroBannerSlot") ||
                el.closest(".hero") ||
                el.closest(".hero-collapsed-strip")
              )
            );
            const curScrollY = window.scrollY || window.pageYOffset || 0;
            if (inTopZone) {
              if (curScrollY > 0) {
                window.scrollTo({ top: 0, behavior: "auto" });
              }
              return;
            }

            // Dynamisches Offset aus Sticky-Header + Filter-Bar berechnen
            const obstructionOffset = getStickyTopObstructionOffset(el, navDir);
            const safeTopBoundary = obstructionOffset + 22;
            const safeBottomBoundary = window.innerHeight - 28;
            const r = el.getBoundingClientRect();

            if (r.top < safeTopBoundary) {
              const targetScrollY = Math.max(0, curScrollY + (r.top - safeTopBoundary));
              window.scrollTo({ top: targetScrollY, behavior: "auto" });
            } else if (r.bottom > safeBottomBoundary) {
              const targetScrollY = Math.max(0, curScrollY + (r.bottom - safeBottomBoundary));
              window.scrollTo({ top: targetScrollY, behavior: "auto" });
            }
          } catch (e) {}
        };

        // 1. Sofortiger Scroll-Durchlauf
        applyScrollPass();

        // 2. Zweiter Verifikations-Durchlauf im nächsten Animations-Frame, um eventuelle Layout-Shifts durch content-visibility: auto beim Hochscrollen auszugleichen
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => {
            if (currentSpatialEl === el) {
              applyScrollPass();
            }
          });
        }
      }

      function setSpatialFocus(el, scrollIntoView = true, navDir = lastSpatialNavDir) {
        if (!el) return;
        if (currentSpatialEl && currentSpatialEl !== el) {
          currentSpatialEl.classList.remove("spatial-focus");
        }
        if (document.activeElement && document.activeElement !== el && document.activeElement !== document.body && typeof document.activeElement.blur === "function") {
          try { document.activeElement.blur(); } catch (e) {}
        }
        currentSpatialEl = el;
        currentSpatialEl.classList.add("spatial-focus");
        const parentCard = isCardSubElement(el) ? el.closest(".card") : null;
        clearCardSubnavState(parentCard);
        if (parentCard) parentCard.classList.add("card-subnav-active");

        if (scrollIntoView) {
          useSpatialScrollIntoView(el, navDir);
        }
      }

      function jumpSpatialFocus(el, scrollIntoView = true, navDir = lastSpatialNavDir) {
        if (!el) return;
        lastSelectJumpAt = Date.now();
        setSpatialFocus(el, scrollIntoView, navDir);
      }

      function focusFirstResultCard(scrollIntoView = false) {
        const target = document.querySelector("#resultsGridContainer .card, #appRoot .card, #colHubGrid .btn, #uniHubGrid .f-pill, #appRoot .ep-title");
        if (target) {
          jumpSpatialFocus(target, scrollIntoView);
        }
      }

      // Automatische Maus-Sperre während der Tastatur-/Controller-Nutzung:
      // Verhindert, dass beim Scrollen per Pfeiltasten der stillstehende Mauszeiger durch synthetische mouseover-Events den Fokus klaut!
      let isKeyboardNavActive = false;
      let lastMouseX = null;
      let lastMouseY = null;

      function engageKeyboardNavMode() {
        if (!isKeyboardNavActive) {
          isKeyboardNavActive = true;
          if (document.body) document.body.classList.add("kb-nav-active");
        }
      }

      function disengageKeyboardNavMode(ev = null) {
        if (isKeyboardNavActive) {
          isKeyboardNavActive = false;
          if (document.body) document.body.classList.remove("kb-nav-active");
          if (ev && mouseHoverNavEnabled && Date.now() - lastSelectJumpAt >= 450) {
            const subTarget = ev.target && typeof ev.target.closest === "function" ? ev.target.closest(CARD_SUB_SELECTOR) : null;
            if (subTarget) {
              setSpatialFocus(subTarget, false);
              return;
            }
            const target = ev.target && typeof ev.target.closest === "function" ? ev.target.closest(FOCUSABLE_SELECTOR) : null;
            if (target && !target.disabled && !target.classList.contains("is-current-mode")) {
              setSpatialFocus(target, false);
            }
          }
        }
      }

      // Echte physische Mausbewegung (>= 6px) oder Klick reaktiviert die Maussteuerung
      document.addEventListener("mousemove", (ev) => {
        if (typeof ev.clientX !== "number" || typeof ev.clientY !== "number") return;
        if (lastMouseX === null || lastMouseY === null) {
          lastMouseX = ev.clientX;
          lastMouseY = ev.clientY;
          return;
        }
        const dist = Math.hypot(ev.clientX - lastMouseX, ev.clientY - lastMouseY);
        if (dist >= 6) {
          lastMouseX = ev.clientX;
          lastMouseY = ev.clientY;
          disengageKeyboardNavMode(ev);
        }
      }, { passive: true });

      document.addEventListener("mousedown", (ev) => {
        if (typeof ev.clientX === "number" && typeof ev.clientY === "number") {
          lastMouseX = ev.clientX;
          lastMouseY = ev.clientY;
        }
        disengageKeyboardNavMode(ev);
      }, { passive: true });

      // Maus-Hover verschiebt die aktive Auswahl direkt auf das gehoverte Objekt (sofern in den Einstellungen aktiviert und Tastatur-Modus NICHT aktiv ist),
      // sodass man nahtlos mit Pfeiltasten / Controller weitermachen kann!
      document.addEventListener("mouseover", (ev) => {
        if (!mouseHoverNavEnabled || isKeyboardNavActive) return;
        if (Date.now() - lastSelectJumpAt < 450) return;
        const subTarget = ev.target && typeof ev.target.closest === "function" ? ev.target.closest(CARD_SUB_SELECTOR) : null;
        if (subTarget) {
          setSpatialFocus(subTarget, false);
          return;
        }
        const target = ev.target && typeof ev.target.closest === "function" ? ev.target.closest(FOCUSABLE_SELECTOR) : null;
        if (target && !target.disabled && !target.classList.contains("is-current-mode")) {
          setSpatialFocus(target, false);
        }
      }, { passive: true });

      function engageCardSubNav(cardEl) {
        if (!cardEl) return false;
        const infoBtn = cardEl.querySelector(".card-quick-info");
        const trailerBtn = cardEl.querySelector(".card-quick-trailer");
        const saveBtn = cardEl.querySelector(".card-quick-save");
        const firstSub = infoBtn || trailerBtn || saveBtn;
        if (!firstSub) return false;
        cardEl.classList.add("card-subnav-active");
        jumpSpatialFocus(firstSub, false);
        return true;
      }

      function handleSpatialConfirmAction() {
        if (!currentSpatialEl) return;
        if (currentSpatialEl.id === "searchInput") {
          const val = (currentSpatialEl.value || "").trim();
          if (document.activeElement === currentSpatialEl && val.length > 0) {
            closeAutocomplete();
            currentSpatialEl.blur();
            runSearch(false, val, undefined, true);
            return;
          }
          onSearchInputFocus();
          currentSpatialEl.focus();
          return;
        }
        const tag = (currentSpatialEl.tagName || "").toUpperCase();
        if (tag === "SELECT") {
          currentSpatialEl.focus();
          if (typeof currentSpatialEl.showPicker === "function") {
            try { currentSpatialEl.showPicker(); } catch (e) {}
          }
          return;
        }
        // Wenn man auf einer Film-/Serienkarte Enter drückt:
        // Öffnet zuerst die Schnellauswahl auf der Karte (ℹ️ Details / ▶ Trailer / 🔖 Favorit),
        // sodass Trailer & Favoriten per Navigationstasten wählbar sind, OHNE das normale Navigieren zwischen den Filmen zu stören!
        if (currentSpatialEl.classList && currentSpatialEl.classList.contains("card")) {
          if (engageCardSubNav(currentSpatialEl)) return;
        }
        currentSpatialEl.click();
      }

      function moveSpatialFocus(dir) {
        engageKeyboardNavMode();
        lastSpatialNavDir = dir || "down";
        const list = getVisibleFocusables();
        if (!list.length) return;

        // Falls wir uns gerade in der Sub-Auswahl (ℹ️ Details / ▶ Trailer / 🔖 Favorit) einer Karte befinden:
        if (currentSpatialEl && isCardSubElement(currentSpatialEl)) {
          const parentCard = currentSpatialEl.closest(".card");
          if (parentCard) {
            const infoBtn = parentCard.querySelector(".card-quick-info");
            const trailerBtn = parentCard.querySelector(".card-quick-trailer");
            const saveBtn = parentCard.querySelector(".card-quick-save");
            if (currentSpatialEl === infoBtn) {
              if (dir === "right" && trailerBtn) { setSpatialFocus(trailerBtn, false, dir); return; }
              if (dir === "up" && saveBtn) { setSpatialFocus(saveBtn, false, dir); return; }
            } else if (currentSpatialEl === trailerBtn) {
              if (dir === "left" && infoBtn) { setSpatialFocus(infoBtn, false, dir); return; }
              if (dir === "up" && saveBtn) { setSpatialFocus(saveBtn, false, dir); return; }
            } else if (currentSpatialEl === saveBtn) {
              if (dir === "down" && trailerBtn) { setSpatialFocus(trailerBtn, false, dir); return; }
              if (dir === "left" && infoBtn) { setSpatialFocus(infoBtn, false, dir); return; }
            }
            // Pfeildruck nach außen verlässt die Sub-Buttons und springt nahtlos zur Nachbarkarte weiter!
            clearCardSubnavState(null);
            currentSpatialEl.classList.remove("spatial-focus");
            currentSpatialEl = parentCard;
            currentSpatialEl.classList.add("spatial-focus");
          }
        }

        if (!currentSpatialEl || !list.includes(currentSpatialEl)) {
          const activeHeroDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active") || document.getElementById("heroBtnTrailer");
          setSpatialFocus(activeHeroDot || list[0], true, dir);
          return;
        }

        // Referenzen auf die Suchleiste & Kopfzeile
        const sScope = document.getElementById("searchGenreSelect") || document.getElementById("searchScopeSelect");
        const sInp = document.getElementById("searchInput");
        const sClear = document.getElementById("searchClearBtn") || document.querySelector(".search-clear-btn");
        const sSub = document.querySelector(".search-submit-btn");
        const sClearVisible = Boolean(sClear && !sClear.classList.contains("is-empty") && list.includes(sClear));

        const focusSearchOrHeaderUp = () => {
          if (sInp && list.includes(sInp)) {
            setSpatialFocus(sInp, true);
            return true;
          }
          const activeTab = document.querySelector(".media-mode-tab.active-movie, .media-mode-tab.active-series, .media-mode-tab");
          if (activeTab && list.includes(activeTab)) {
            setSpatialFocus(activeTab, true);
            return true;
          }
          const menuBtn = document.getElementById("sidebarToggleBtn");
          if (menuBtn && list.includes(menuBtn)) {
            setSpatialFocus(menuBtn, true);
            return true;
          }
          return false;
        };

        const curHero = currentSpatialEl.closest ? currentSpatialEl.closest(".hero") : null;
        if (curHero) {
          const actDot = curHero.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || curHero.querySelector(".hero-dot.active");
          const trBtn = document.getElementById("heroBtnTrailer");
          const detBtn = document.getElementById("heroBtnDetails");
          const hideBtn = document.getElementById("heroHideBtn");

          // 1. Fokus auf "▶ Trailer" (links) oder "ⓘ Details" (rechts davon):
          if (currentSpatialEl.id === "heroBtnTrailer") {
            if (dir === "right") {
              if (detBtn) { setSpatialFocus(detBtn, true); return; }
              if (hideBtn) { setSpatialFocus(hideBtn, true); return; }
            }
            if (dir === "left") {
              setHeroSlideIndex(state.heroIndex - 1);
              const nextTr = document.getElementById("heroBtnTrailer");
              if (nextTr) setSpatialFocus(nextTr, true);
              return;
            }
            if (dir === "down") {
              if (actDot) { setSpatialFocus(actDot, true); return; }
              if (hideBtn) { setSpatialFocus(hideBtn, true); return; }
            }
            if (dir === "up") {
              if (focusSearchOrHeaderUp()) return;
            }
          } else if (currentSpatialEl.id === "heroBtnDetails") {
            if (dir === "left") {
              if (trBtn) { setSpatialFocus(trBtn, true); return; }
            }
            if (dir === "right") {
              if (hideBtn) { setSpatialFocus(hideBtn, true); return; }
              setHeroSlideIndex(state.heroIndex + 1);
              const nextDet = document.getElementById("heroBtnDetails");
              if (nextDet) setSpatialFocus(nextDet, true);
              return;
            }
            if (dir === "down") {
              if (actDot) { setSpatialFocus(actDot, true); return; }
              if (hideBtn) { setSpatialFocus(hideBtn, true); return; }
            }
            if (dir === "up") {
              if (focusSearchOrHeaderUp()) return;
            }
          } else if (currentSpatialEl.classList.contains("hero-dot") || currentSpatialEl.classList.contains("hero-circle-arrow")) {
            // 2. Fokus auf der Pill-Dot-Rotationsleiste (< ━━ • • • • >):
            // Links / Rechts blättert sofort durch die 6 Highlights; Hoch springt zu "▶ Trailer"; Enter fokussiert ebenfalls "▶ Trailer"!
            if (dir === "left" || dir === "right") {
              setHeroSlideIndex(state.heroIndex + (dir === "right" ? 1 : -1));
              const nextDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active");
              if (nextDot) setSpatialFocus(nextDot, true);
              return;
            }
            if (dir === "up") {
              if (trBtn) { setSpatialFocus(trBtn, true); return; }
              if (detBtn) { setSpatialFocus(detBtn, true); return; }
              if (focusSearchOrHeaderUp()) return;
            }
          } else if (currentSpatialEl.id === "heroHideBtn") {
            if (dir === "left") {
              if (actDot) { setSpatialFocus(actDot, true); return; }
              if (detBtn) { setSpatialFocus(detBtn, true); return; }
            }
            if (dir === "up") {
              if (detBtn) { setSpatialFocus(detBtn, true); return; }
              if (trBtn) { setSpatialFocus(trBtn, true); return; }
              if (focusSearchOrHeaderUp()) return;
            }
            if (dir === "right") return;
          }
        }

        // Kompakter 1-Zeilen Spotlight-Strip (.hero-collapsed-strip): Hoch springt direkt zur Suche (#searchInput)
        const curCollapsedStrip = currentSpatialEl.closest ? currentSpatialEl.closest(".hero-collapsed-strip") : null;
        if (curCollapsedStrip && dir === "up") {
          if (focusSearchOrHeaderUp()) return;
        }

        // Direkte Nachbarschaft in der einheitlichen Suchleiste (.search-bar-outer), damit #searchInput niemals übersprungen wird
        const inSearchBar = Boolean(
          currentSpatialEl === sScope ||
          currentSpatialEl === sInp ||
          currentSpatialEl === sClear ||
          currentSpatialEl === sSub
        );
        if (inSearchBar) {
          if (dir === "right" && currentSpatialEl === sScope && sInp) {
            setSpatialFocus(sInp, true);
            return;
          }
          if (dir === "right" && currentSpatialEl === sInp) {
            if (sClearVisible) { setSpatialFocus(sClear, true); return; }
            if (sSub && list.includes(sSub)) { setSpatialFocus(sSub, true); return; }
          }
          if (dir === "right" && currentSpatialEl === sClear && sSub && list.includes(sSub)) {
            setSpatialFocus(sSub, true);
            return;
          }
          if (dir === "left" && currentSpatialEl === sSub) {
            if (sClearVisible) { setSpatialFocus(sClear, true); return; }
            if (sInp) { setSpatialFocus(sInp, true); return; }
          }
          if (dir === "left" && currentSpatialEl === sClear && sInp) {
            setSpatialFocus(sInp, true);
            return;
          }
          if (dir === "left" && currentSpatialEl === sInp && sScope && list.includes(sScope)) {
            setSpatialFocus(sScope, true);
            return;
          }
          if (dir === "up") {
            const menuBtn = document.getElementById("sidebarToggleBtn");
            const wlBtn = document.getElementById("navBtnWishlist");
            const activeTab = document.querySelector(".media-mode-tab.active-movie, .media-mode-tab.active-series, .media-mode-tab");
            if (currentSpatialEl === sScope && menuBtn && list.includes(menuBtn)) {
              setSpatialFocus(menuBtn, true);
              return;
            }
            if ((currentSpatialEl === sSub || currentSpatialEl === sClear) && wlBtn && list.includes(wlBtn)) {
              setSpatialFocus(wlBtn, true);
              return;
            }
            if (activeTab && list.includes(activeTab)) {
              setSpatialFocus(activeTab, true);
              return;
            }
            if (menuBtn && list.includes(menuBtn)) {
              setSpatialFocus(menuBtn, true);
              return;
            }
          }
          if (dir === "down") {
            const firstAc = document.querySelector("#searchAutocompleteBox.open .ac-item");
            if (firstAc && list.includes(firstAc)) {
              setSpatialFocus(firstAc, true);
              return;
            }
            const heroTr = document.getElementById("heroBtnTrailer");
            const heroDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active");
            if (heroTr && list.includes(heroTr)) {
              setSpatialFocus(heroTr, true);
              return;
            }
            if (heroDot && list.includes(heroDot)) {
              setSpatialFocus(heroDot, true);
              return;
            }
            const restoreBtn = document.getElementById("heroRestoreBtn");
            if (restoreBtn && list.includes(restoreBtn)) {
              setSpatialFocus(restoreBtn, true);
              return;
            }
          }
        }

        // Deterministische Links/Rechts-Reihenfolge & Runter-Sprung in der obersten Kopfzeile (<header>) inkl. TelePort-Logo (#headerBrandLogo)
        const inHeader = Boolean(currentSpatialEl.closest && currentSpatialEl.closest("header"));
        if (inHeader) {
          if (dir === "left" || dir === "right") {
            const headerOrder = [
              document.getElementById("sidebarToggleBtn"),
              document.getElementById("headerBrandLogo"),
              document.getElementById("tabBtnMovies"),
              document.getElementById("tabBtnSeries"),
              document.getElementById("navBtnWishlist")
            ].filter(el => el && list.includes(el));
            const hIdx = headerOrder.indexOf(currentSpatialEl);
            if (hIdx !== -1) {
              const nextHIdx = dir === "right" ? hIdx + 1 : hIdx - 1;
              if (nextHIdx >= 0 && nextHIdx < headerOrder.length) {
                setSpatialFocus(headerOrder[nextHIdx], true, dir);
              }
              return;
            }
          }
          if (dir === "down") {
            if (currentSpatialEl.id === "sidebarToggleBtn" && sScope && list.includes(sScope)) {
              setSpatialFocus(sScope, true);
              return;
            }
            if (sInp && list.includes(sInp)) {
              setSpatialFocus(sInp, true);
              return;
            }
          }
        }

        // Deterministische Links/Rechts-Steuerung im Sidebar-Header (.sidebar-header) inkl. Sidebar-Logo (#sidebarBrandLogo)
        const inSidebarHeader = Boolean(currentSpatialEl.closest && currentSpatialEl.closest(".sidebar-header"));
        if (inSidebarHeader && (dir === "left" || dir === "right")) {
          const sbHeaderEl = currentSpatialEl.closest(".sidebar-header");
          const sbHeaderItems = Array.from(sbHeaderEl.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => list.includes(el));
          const shIdx = sbHeaderItems.indexOf(currentSpatialEl);
          if (shIdx !== -1) {
            const nextShIdx = dir === "right" ? shIdx + 1 : shIdx - 1;
            if (nextShIdx >= 0 && nextShIdx < sbHeaderItems.length) {
              setSpatialFocus(sbHeaderItems[nextShIdx], true, dir);
            }
            return;
          }
        }

        // Von der obersten Zeile der Filterleiste (.floating-filter-bar) führt Pfeil hoch (⬆) direkt in den Hero-Slider / Spotlight-Strip / Suchleiste
        const curFF = currentSpatialEl.closest ? currentSpatialEl.closest(".floating-filter-bar") : null;
        if (curFF && dir === "up") {
          const curBoxFF = getSpatialLayoutBox(currentSpatialEl);
          const hasHigherInFF = list.some(cand =>
            cand !== currentSpatialEl &&
            curFF.contains(cand) &&
            getSpatialLayoutBox(cand).bottom <= curBoxFF.top + 6
          );
          if (!hasHigherInFF) {
            const actHeroDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active");
            const heroTr = document.getElementById("heroBtnTrailer");
            const restoreBtn = document.getElementById("heroRestoreBtn");
            if (actHeroDot && list.includes(actHeroDot)) {
              setSpatialFocus(actHeroDot, true);
              return;
            }
            if (heroTr && list.includes(heroTr)) {
              setSpatialFocus(heroTr, true);
              return;
            }
            if (restoreBtn && list.includes(restoreBtn)) {
              setSpatialFocus(restoreBtn, true);
              return;
            }
            if (focusSearchOrHeaderUp()) return;
          }
        }

        const curRect = getSpatialLayoutBox(curHero ? curHero : currentSpatialEl);
        const cx = curRect.left + curRect.width / 2;
        const cy = curRect.top + curRect.height / 2;

        let bestEl = null;
        let bestScore = Infinity;

        for (const cand of list) {
          if (cand === currentSpatialEl) continue;
          const candHero = cand.closest ? cand.closest(".hero") : null;
          if (curHero && candHero) {
            // Beim Verlassen des Hero-Banners nach Oben/Unten alle anderen internen Hero-Elemente überspringen
            continue;
          }
          if (!curHero && candHero) {
            // Von außerhalb in den Hero-Slider navigieren:
            // Direkt auf den aktiven Slide-Indikator (.hero-dot.active) springen (oder #heroBtnTrailer falls nur 1 Slide existiert),
            // damit man sofort mit Pfeil Links/Rechts durch die Highlights blättern oder mit Enter/Hoch den Trailer/Details öffnen kann!
            const hasActiveDot = Boolean(candHero.querySelector(".hero-dot.active"));
            if (hasActiveDot) {
              if (!cand.classList.contains("hero-dot") || !cand.classList.contains("active")) {
                continue;
              }
            } else if (cand.id !== "heroBtnTrailer") {
              continue;
            }
          }
          const r = getSpatialLayoutBox((!curHero && candHero) ? candHero : cand);
          // Nächsten Punkt auf der Bounding-Box berechnen (verhindert das Überspringen breiter Elemente wie #searchInput oder .hero)
          const nearestX = Math.max(r.left, Math.min(cx, r.right));
          const nearestY = Math.max(r.top, Math.min(cy, r.bottom));
          const centerTx = r.left + r.width / 2;
          const centerTy = r.top + r.height / 2;

          const dxCenter = centerTx - cx;
          const dyCenter = centerTy - cy;
          const dxEdge = nearestX - cx;
          const dyEdge = nearestY - cy;

          if (dir === "right" && centerTx <= cx + 4) continue;
          if (dir === "left" && centerTx >= cx - 4) continue;
          if (dir === "down" && centerTy <= cy + 4) continue;
          if (dir === "up" && centerTy >= cy - 4) continue;

          // Prüfen, ob das Element auf derselben horizontalen Zeile liegt
          const verticalOverlap = Math.min(curRect.bottom, r.bottom) - Math.max(curRect.top, r.top);
          const isSameRow = verticalOverlap > 4 || Math.abs(dyCenter) < Math.max(curRect.height, r.height) * 0.65;

          let score;
          if (dir === "left" || dir === "right") {
            const hDist = Math.min(Math.abs(dxEdge), Math.abs(dxCenter));
            const vPenalty = isSameRow ? Math.abs(dyCenter) * 0.5 : (Math.abs(dyCenter) * 4.5 + 180);
            score = hDist + vPenalty;
          } else {
            const vDist = Math.min(Math.abs(dyEdge), Math.abs(dyCenter));
            const hPenalty = Math.abs(dxEdge) * 1.8;
            score = vDist + hPenalty;
          }

          if (score < bestScore) {
            bestScore = score;
            bestEl = cand;
          }
        }

        if (bestEl) {
          setSpatialFocus(bestEl, true);
        } else {
          const idx = list.indexOf(currentSpatialEl);
          const nextIdx = (dir === "right" || dir === "down")
            ? Math.min(list.length - 1, idx + 1)
            : Math.max(0, idx - 1);
          const fallbackCand = list[nextIdx];
          if (fallbackCand && !curHero && fallbackCand.closest && fallbackCand.closest(".hero")) {
            const actHeroDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active") || document.getElementById("heroBtnTrailer");
            if (actHeroDot) { setSpatialFocus(actHeroDot, true); return; }
          }
          setSpatialFocus(fallbackCand, true);
        }
      }

      // Long-Press Pfeiltasten-Navigation (~450ms) im Detail-Modal (vorheriger/nächster Film)
      // Hinweistext erscheint erst nach 220ms echtem Gedrückthalten, damit kurzes Antippen niemals nervt!
      const HOLD_NAV_DURATION_MS = 450;
      const HOLD_NAV_SHOW_DELAY_MS = 220;
      let modalHoldTimer = null;
      let modalHoldShowTimer = null;
      let modalHoldActiveKey = "";
      let modalHoldTriggered = false;

      // Enter-Taste auf Film-Cover: Kurz drücken = Schnellwahl (Trailer/Merkliste/Details), Gedrückthalten (>= 350ms) = Direkt Infos öffnen!
      const CARD_ENTER_HOLD_MS = 350;
      let cardEnterHoldTimer = null;
      let cardEnterHoldTarget = null;
      let cardEnterHoldTriggered = false;

      function cancelCardEnterHold() {
        if (cardEnterHoldTimer) {
          clearTimeout(cardEnterHoldTimer);
          cardEnterHoldTimer = null;
        }
        cardEnterHoldTarget = null;
        cardEnterHoldTriggered = false;
      }

      function cancelModalArrowHold() {
        if (modalHoldTimer) {
          clearTimeout(modalHoldTimer);
          modalHoldTimer = null;
        }
        if (modalHoldShowTimer) {
          clearTimeout(modalHoldShowTimer);
          modalHoldShowTimer = null;
        }
        modalHoldActiveKey = "";
        modalHoldTriggered = false;
        const ind = document.getElementById("modalHoldNavIndicator");
        const bar = document.getElementById("modalHoldNavBar");
        if (ind) {
          ind.style.display = "none";
          ind.classList.remove("left", "right");
        }
        if (bar) {
          bar.style.transition = "none";
          bar.style.width = "0%";
        }
      }

      function startModalArrowHold(keyName, step, adjItem) {
        cancelModalArrowHold();
        if (!modalHoldNavEnabled || !adjItem) return;
        modalHoldActiveKey = keyName;
        modalHoldTriggered = false;
        modalHoldShowTimer = setTimeout(() => {
          modalHoldShowTimer = null;
          if (!modalHoldActiveKey || modalHoldTriggered) return;
          const ind = document.getElementById("modalHoldNavIndicator");
          const txt = document.getElementById("modalHoldNavText");
          const bar = document.getElementById("modalHoldNavBar");
          if (ind && txt && bar) {
            ind.classList.remove("left", "right");
            ind.classList.add(step < 0 ? "left" : "right");
            txt.textContent = step < 0
              ? ("◀ Halten: " + (adjItem.title || "Vorheriger Titel"))
              : ("Halten: " + (adjItem.title || "Nächster Titel") + " ▶");
            bar.style.transition = "none";
            bar.style.width = "0%";
            ind.style.display = "flex";
            void bar.offsetWidth;
            bar.style.transition = "width " + Math.max(120, HOLD_NAV_DURATION_MS - HOLD_NAV_SHOW_DELAY_MS) + "ms linear";
            bar.style.width = "100%";
          }
        }, HOLD_NAV_SHOW_DELAY_MS);

        modalHoldTimer = setTimeout(() => {
          modalHoldTimer = null;
          modalHoldTriggered = true;
          cancelModalArrowHold();
          navigateDetailModalAdjacent(step);
        }, HOLD_NAV_DURATION_MS);
      }

      window.addEventListener("keyup", (ev) => {
        if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
          const wasHoldingThisKey = modalHoldActiveKey === ev.key;
          const didTriggerHold = modalHoldTriggered;
          cancelModalArrowHold();
          if (wasHoldingThisKey && !didTriggerHold) {
            moveSpatialFocus(ev.key === "ArrowRight" ? "right" : "left");
          }
        } else if (ev.key === "Enter") {
          const targetCard = cardEnterHoldTarget;
          const didTriggerLong = cardEnterHoldTriggered;
          cancelCardEnterHold();
          if (targetCard && !didTriggerLong && currentSpatialEl === targetCard) {
            if (!engageCardSubNav(targetCard)) {
              targetCard.click();
            }
          }
        }
      });
      window.addEventListener("blur", () => {
        cancelModalArrowHold();
        cancelCardEnterHold();
      });

      document.addEventListener("keydown", (ev) => {
        engageKeyboardNavMode();
        const activeEl = document.activeElement;
        const activeTag = (activeEl && activeEl.tagName || "").toUpperCase();
        const isSearchInpFocused = activeEl && activeEl.id === "searchInput";
        const isTypingInInput = activeTag === "INPUT" || activeTag === "TEXTAREA";

        if (ev.key === "Escape" || (ev.key === "Backspace" && !isTypingInInput)) {
          cancelModalArrowHold();
          if (currentSpatialEl && (currentSpatialEl.id === "heroBtnDetails" || currentSpatialEl.id === "heroBtnTrailer")) {
            state.heroActionsEngaged = false;
            const box = document.getElementById("heroActionsBox");
            if (box) box.classList.remove("engaged");
            const actCard = document.querySelector('.hero-thumb-card[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-thumb-card.active");
            if (actCard) setSpatialFocus(actCard, false);
            ev.preventDefault();
            return;
          }
          if (currentSpatialEl && isCardSubElement(currentSpatialEl)) {
            const parentCard = currentSpatialEl.closest(".card");
            clearCardSubnavState(null);
            if (parentCard) setSpatialFocus(parentCard, false);
            ev.preventDefault();
            return;
          }
          if (document.getElementById("searchAutocompleteBox")?.classList.contains("open")) {
            closeAutocomplete();
            ev.preventDefault();
            return;
          }
          if (ev.key === "Escape") {
            if (activeEl && activeEl !== document.body && typeof activeEl.blur === "function") activeEl.blur();
            goBack();
            ev.preventDefault();
            return;
          }
        }

        // Größenanpassung per + und - auf der Tastatur (sofern man nicht in einem Textfeld tippt)
        if (!isTypingInInput && (ev.key === "+" || ev.key === "=" || ev.code === "NumpadAdd")) {
          ev.preventDefault();
          adjustOverallScaleStep(5);
          return;
        }
        if (!isTypingInInput && (ev.key === "-" || ev.key === "_" || ev.code === "NumpadSubtract")) {
          ev.preventDefault();
          adjustOverallScaleStep(-5);
          return;
        }

        // Nahtlose Pfeiltasten-Navigation auch aus dem Suchfeld heraus (inkl. ruhigem 450ms Gedrückthalten im Detail-Modal ohne Fokus-Herumspringen)
        if (ev.key === "ArrowRight") {
          const modalOpen = Boolean(document.getElementById("modalRoot")?.innerHTML.trim());
          if (modalOpen && ev.shiftKey && !isTypingInInput) {
            cancelModalArrowHold();
            const nextBtn = document.getElementById("modalAdjNextBtn");
            if (nextBtn) { ev.preventDefault(); nextBtn.click(); return; }
          }
          if (isSearchInpFocused) {
            const valLen = (activeEl.value || "").length;
            const atEnd = valLen === 0 || activeEl.selectionEnd === valLen;
            if (!atEnd) return;
            activeEl.blur();
          } else if (isTypingInInput) {
            return;
          } else if (activeTag === "SELECT") {
            activeEl.blur();
          }
          ev.preventDefault();
          if (modalOpen && modalHoldNavEnabled && !isTypingInInput) {
            const adjNext = getAdjacentDetailItem(1);
            if (adjNext) {
              if (!ev.repeat && modalHoldActiveKey !== "ArrowRight") {
                startModalArrowHold("ArrowRight", 1, adjNext);
              }
              return;
            }
          }
          moveSpatialFocus("right");
          return;
        }
        if (ev.key === "ArrowLeft") {
          const modalOpen = Boolean(document.getElementById("modalRoot")?.innerHTML.trim());
          if (modalOpen && ev.shiftKey && !isTypingInInput) {
            cancelModalArrowHold();
            const prevBtn = document.getElementById("modalAdjPrevBtn");
            if (prevBtn) { ev.preventDefault(); prevBtn.click(); return; }
          }
          if (isSearchInpFocused) {
            const valLen = (activeEl.value || "").length;
            const atStart = valLen === 0 || activeEl.selectionStart === 0;
            if (!atStart) return;
            activeEl.blur();
          } else if (isTypingInInput) {
            return;
          } else if (activeTag === "SELECT") {
            activeEl.blur();
          }
          ev.preventDefault();
          if (modalOpen && modalHoldNavEnabled && !isTypingInInput) {
            const adjPrev = getAdjacentDetailItem(-1);
            if (adjPrev) {
              if (!ev.repeat && modalHoldActiveKey !== "ArrowLeft") {
                startModalArrowHold("ArrowLeft", -1, adjPrev);
              }
              return;
            }
          }
          moveSpatialFocus("left");
          return;
        }
        if (ev.key === "ArrowDown") {
          cancelModalArrowHold();
          ev.preventDefault();
          if (isSearchInpFocused || activeTag === "SELECT") activeEl.blur();
          moveSpatialFocus("down");
          return;
        }
        if (ev.key === "ArrowUp") {
          cancelModalArrowHold();
          ev.preventDefault();
          if (isSearchInpFocused || activeTag === "SELECT") activeEl.blur();
          moveSpatialFocus("up");
          return;
        }

        // Enter-Taste: Auf einem Film-Cover öffnet kurzes Drücken die Schnellwahl (Trailer/Merkliste/Details) und Gedrückthalten (>= 350ms) direkt die Infos!
        if (ev.key === "Enter" && !isTypingInInput && currentSpatialEl) {
          cancelModalArrowHold();
          ev.preventDefault();
          if (currentSpatialEl.classList && currentSpatialEl.classList.contains("card")) {
            if (!ev.repeat && cardEnterHoldTarget !== currentSpatialEl) {
              cancelCardEnterHold();
              cardEnterHoldTarget = currentSpatialEl;
              cardEnterHoldTriggered = false;
              cardEnterHoldTimer = setTimeout(() => {
                cardEnterHoldTimer = null;
                cardEnterHoldTriggered = true;
                const target = cardEnterHoldTarget;
                cardEnterHoldTarget = null;
                if (target && currentSpatialEl === target) {
                  clearCardSubnavState(null);
                  target.click();
                }
              }, CARD_ENTER_HOLD_MS);
            }
            return;
          }
          if (!ev.repeat) {
            handleSpatialConfirmAction();
          }
          return;
        }

        // Type-to-Search: Sobald auf der Tastatur ein Buchstabe/Zahl getippt wird, startet automatisch die Suche!
        if (!isTypingInInput && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.length === 1 && /[a-zA-Z0-9äöüÄÖÜß]/.test(ev.key)) {
          const modalOpen = Boolean(document.getElementById("modalRoot")?.innerHTML.trim());
          const dialogOpen = Boolean(document.getElementById("customDialogRoot")?.innerHTML.trim());
          if (!modalOpen && !dialogOpen) {
            const sInp = document.getElementById("searchInput");
            if (sInp) {
              setSpatialFocus(sInp, false);
              onSearchInputFocus();
              sInp.focus();
            }
          }
        }
      });

      // Gamepad / Controller Polling (Xbox, PlayStation, Android TV Gamepad)
      let lastGamepadStepAt = 0;
      function pollGamepadNavigation() {
        try {
          const pads = navigator.getGamepads ? navigator.getGamepads() : [];
          const gp = pads && (pads[0] || pads[1] || pads[2] || pads[3]);
          if (gp) {
            const now = Date.now();
            if (now - lastGamepadStepAt > 190) {
              const axX = gp.axes?.[0] || 0;
              const axY = gp.axes?.[1] || 0;
              const up = gp.buttons?.[12]?.pressed || axY < -0.55;
              const down = gp.buttons?.[13]?.pressed || axY > 0.55;
              const left = gp.buttons?.[14]?.pressed || axX < -0.55;
              const right = gp.buttons?.[15]?.pressed || axX > 0.55;
              const btnA = gp.buttons?.[0]?.pressed;
              const btnB = gp.buttons?.[1]?.pressed;
              const btnLB = gp.buttons?.[4]?.pressed;
              const btnRB = gp.buttons?.[5]?.pressed;

              if (up) { moveSpatialFocus("up"); lastGamepadStepAt = now; }
              else if (down) { moveSpatialFocus("down"); lastGamepadStepAt = now; }
              else if (left) { moveSpatialFocus("left"); lastGamepadStepAt = now; }
              else if (right) { moveSpatialFocus("right"); lastGamepadStepAt = now; }
              else if (btnA && currentSpatialEl) {
                handleSpatialConfirmAction();
                lastGamepadStepAt = now + 120;
              }
              else if (btnB) {
                if (currentSpatialEl && isCardSubElement(currentSpatialEl)) {
                  const parentCard = currentSpatialEl.closest(".card");
                  clearCardSubnavState(null);
                  if (parentCard) setSpatialFocus(parentCard, false);
                } else {
                  goBack();
                }
                lastGamepadStepAt = now + 150;
              }
              else if (btnLB) {
                const modalPrev = document.getElementById("modalAdjPrevBtn");
                if (modalPrev) modalPrev.click();
                else setHeroSlideIndex(state.heroIndex - 1);
                lastGamepadStepAt = now + 150;
              }
              else if (btnRB) {
                const modalNext = document.getElementById("modalAdjNextBtn");
                if (modalNext) modalNext.click();
                else setHeroSlideIndex(state.heroIndex + 1);
                lastGamepadStepAt = now + 150;
              }
            }
          }
        } catch (e) {}
        requestAnimationFrame(pollGamepadNavigation);
      }
      requestAnimationFrame(pollGamepadNavigation);

      window.__TELEPORT_BOOTED__ = true;
      initAuthSession();
      setTimeout(() => { if (typeof pollAntiSpamQueueClient === "function") pollAntiSpamQueueClient(true); }, 900);
    </script>
  </body>
  </html>`;
  }
