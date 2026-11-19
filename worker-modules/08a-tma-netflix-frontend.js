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
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Init-Data, X-Telegram-Launch-Token, X-Tma-Settings",
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
  async function verifyTelegramInitDataHmac(rawInitData, botToken, env = null) {
    if (!rawInitData) return { ok: false, error: "Fehlende initData" };
    try {
      const params = new URLSearchParams(String(rawInitData));
      const receivedHash = params.get("hash");
      if (!receivedHash) return { ok: false, error: "Kein Hash in initData" };

      const userRaw = params.get("user");
      const userObj = userRaw ? JSON.parse(userRaw) : null;

      // Simulator-Sandbox-Unterstützung für lokale Vorschau nur im Entwicklungs-Modus
      const isDevEnv = Boolean(env && (env.ENVIRONMENT === "development" || env.ENABLE_SIMULATOR === "true" || env.DEV_MODE === "true"));
      if (receivedHash === "sim_valid_hmac" && userObj && (String(userObj.id) === "100998877" || String(userObj.id) === "55443322")) {
        if (!isDevEnv) {
          return { ok: false, error: "Simulator-initData ist in der Produktivumgebung deaktiviert." };
        }
        return { ok: true, user: userObj, isSimulator: true };
      }

      if (!botToken) return { ok: false, error: "Fehlendes Bot-Token" };

      // Replay-Schutz: auth_date Validierung (maximal 24 Stunden = 86400 Sekunden alt)
      const authDate = Number(params.get("auth_date") || 0);
      if (!authDate || Math.abs(Math.floor(Date.now() / 1000) - authDate) > 86400) {
        return { ok: false, error: "Telegram initData ist abgelaufen (> 24h)." };
      }

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

      if (!userObj || !userObj.id) {
        return { ok: false, error: "Kein gültiges User-Objekt in initData" };
      }
      return { ok: true, user: userObj };
    } catch (e) {
      return { ok: false, error: "Fehler bei initData-Prüfung" };
    }
  }

  // Offizielle Telegram Login Widget HMAC-SHA256 Validierung (secret_key = SHA256(bot_token))
  async function verifyTelegramLoginWidgetHmac(widgetData, botToken, env = null) {
    if (!widgetData || typeof widgetData !== "object") {
      return { ok: false, error: "Fehlende Telegram Login-Widget Daten" };
    }
    try {
      const receivedHash = String(widgetData.hash || "").trim();
      const userId = widgetData.id ? String(widgetData.id).trim() : "";
      if (!receivedHash || !userId) {
        return { ok: false, error: "Ungültige Login-Widget Daten (id oder hash fehlt)" };
      }

      // Simulator- / Sandbox-Unterstützung nur bei explizitem Entwicklungs-Modus (ENVIRONMENT === "development" oder ENABLE_SIMULATOR === "true")
      const isDevEnv = Boolean(env && (env.ENVIRONMENT === "development" || env.ENABLE_SIMULATOR === "true" || env.DEV_MODE === "true"));
      if (receivedHash === "sim_valid_widget_hmac") {
        if (!isDevEnv) {
          return { ok: false, error: "Simulator-Login ist in der Produktivumgebung deaktiviert." };
        }
        return {
          ok: true,
          isSimulator: true,
          user: {
            id: Number(userId) || 100998877,
            first_name: String(widgetData.first_name || "Telegram User"),
            last_name: String(widgetData.last_name || ""),
            username: String(widgetData.username || "teleport_user"),
            photo_url: String(widgetData.photo_url || "")
          }
        };
      }

      if (!botToken) {
        return { ok: false, error: "TELEGRAM_BOT_TOKEN ist nicht konfiguriert." };
      }

      const authDate = Number(widgetData.auth_date || 0);
      if (authDate > 0 && Math.abs(Math.floor(Date.now() / 1000) - authDate) > 86400) {
        return { ok: false, error: "Telegram Login-Widget Sitzung abgelaufen (> 24h). Bitte erneut anmelden." };
      }

      const checkFields = ["auth_date", "first_name", "id", "last_name", "photo_url", "username"];
      const pairs = [];
      for (const k of Object.keys(widgetData).sort()) {
        if (k === "hash") continue;
        if (!checkFields.includes(k) && widgetData[k] === undefined) continue;
        const val = widgetData[k];
        if (val === undefined || val === null || val === "") continue;
        pairs.push(`${k}=${val}`);
      }
      const dataCheckString = pairs.join("\n");

      const enc = new TextEncoder();
      const secretKeyBuf = await crypto.subtle.digest("SHA-256", enc.encode(String(botToken).trim()));
      const validationKey = await crypto.subtle.importKey(
        "raw",
        secretKeyBuf,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sigBuf = await crypto.subtle.sign("HMAC", validationKey, enc.encode(dataCheckString));
      const calculatedHash = bytesToHex(sigBuf);

      if (calculatedHash.toLowerCase() !== receivedHash.toLowerCase()) {
        return { ok: false, error: "Ungültige Telegram Login-Widget Signatur (HMAC-SHA256)" };
      }

      return {
        ok: true,
        user: {
          id: Number(userId),
          first_name: String(widgetData.first_name || "Filmfreund"),
          last_name: String(widgetData.last_name || ""),
          username: String(widgetData.username || ""),
          photo_url: String(widgetData.photo_url || "")
        }
      };
    } catch (e) {
      return { ok: false, error: "Fehler bei Login-Widget Prüfung" };
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
        const dbRow = await getUserByTelegramIdFromD1(env, verifiedToken.telegramId).catch(() => null);
        const userProfile = formatUserRowForClient(
          dbRow || {
            telegram_id: verifiedToken.telegramId,
            tg_username: verifiedToken.tgUsername || "",
            first_name: verifiedToken.firstName || "",
            is_admin: verifiedToken.isAdmin ? 1 : 0,
            is_vip: verifiedToken.isVip ? 1 : 0
          },
          env
        );
        if (userProfile && verifiedToken.isAdmin) userProfile.isAdmin = true;
        if (userProfile && verifiedToken.isVip) userProfile.isVip = true;
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
      const verifiedInit = await verifyTelegramInitDataHmac(rawInitData, env.TELEGRAM_BOT_TOKEN, env);
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

    let rawLaunchToken = request.headers.get("X-Telegram-Launch-Token") || "";
    if (!rawLaunchToken) {
      try {
        rawLaunchToken = new URL(request.url).searchParams.get("tgLaunch") || "";
      } catch (e) {}
    }
    if (rawLaunchToken && typeof verifyTelegramChatLaunchToken === "function") {
      const verifiedLaunch = await verifyTelegramChatLaunchToken(rawLaunchToken, env);
      if (verifiedLaunch && verifiedLaunch.ok && verifiedLaunch.chatId) {
        const existingRow = await getUserByTelegramIdFromD1(env, verifiedLaunch.chatId).catch(() => null);
        const userProfile = await upsertTelegramUserInD1(env, {
          id: Number(verifiedLaunch.chatId),
          first_name: existingRow?.first_name || "Telegram User",
          last_name: existingRow?.last_name || "",
          username: existingRow?.tg_username || ""
        });
        return {
          isAuthenticated: true,
          isGuest: false,
          authMethod: "tgLaunch",
          hasInitData: true,
          chatId: String(verifiedLaunch.chatId),
          user: userProfile
        };
      }
    }

    // Kein gültiges initData, kein gültiger Launch-Token & kein eingeloggter Account -> Gast-Modus ohne Speicher!
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#060a14" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="STREAMFLIX" />
    <link rel="apple-touch-icon" href="/favicon.svg" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28' fill='none'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='28' y2='28' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='0%25' stop-color='%2338bdf8'/%3E%3Cstop offset='50%25' stop-color='%23a855f7'/%3E%3Cstop offset='100%25' stop-color='%236366f1'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='14' cy='14' r='11.5' stroke='url(%23g)' stroke-width='2.6' stroke-dasharray='18 5'/%3E%3Ccircle cx='14' cy='14' r='7.5' stroke='%2338bdf8' stroke-width='1.5' stroke-opacity='0.8'/%3E%3Cpath d='M11.8 9.8L18.5 14L11.8 18.2V9.8Z' fill='url(%23g)'/%3E%3C/svg%3E" />
    <link rel="alternate icon" type="image/svg+xml" href="/favicon.svg" />
    <title>TelePort – Film & Serien Mini-App</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
      :root {
        --bg: #060a14;
        --surface: #0b1222;
        --card: #101a30;
        --bg-elevated: #13203b;
        --red: #0284c7;
        --accent-primary: #0ea5e9;
        --danger: #e11d48;
        --blue: #0284c7;
        --purple: #6366f1;
        --text: #f8fafc;
        --text-main: #f8fafc;
        --muted: #94a3b8;
        --text-muted: #94a3b8;
        --inc-bg: rgba(16, 185, 129, 0.18);
        --inc-border: rgba(16, 185, 129, 0.62);
        --inc-text: #6ee7b7;
        --inc-solid: #10b981;
        --exc-bg: rgba(244, 63, 94, 0.16);
        --exc-border: rgba(244, 63, 94, 0.55);
        --exc-text: #fda4af;
        --exc-solid: #e11d48;
        --scale-all: 1;
        --scale-text: 1;
        --scale-cover: 1;
        --scale-menu: 1;
        --sticky-header-height: calc(54px * var(--scale-menu));
        --sticky-header-offset: calc(var(--sticky-header-height) + 20px);
      }
      /* Goldener Schnitt (1 : 1.618 -> 61.8% : 38.2%) Grid-Architektur */
      .golden-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.618fr) minmax(270px, 1fr);
        gap: 14px;
        align-items: start;
      }
      @media (max-width: 860px) {
        .golden-grid {
          grid-template-columns: 1fr;
        }
      }
      /* Design-Themen: Light Mode & Cyberpunk Neon */
      body[data-theme="light"] {
        --bg: #f1f5f9;
        --surface: #ffffff;
        --card: #ffffff;
        --bg-elevated: #f8fafc;
        --red: #0284c7;
        --accent-primary: #0284c7;
        --danger: #dc2626;
        --blue: #0284c7;
        --purple: #4f46e5;
        --text: #0f172a;
        --text-main: #0f172a;
        --muted: #475569;
        --text-muted: #475569;
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
      body[data-theme="light"] .brand-logo {
        color: #0f172a;
        background: #f1f5f9;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .brand-logo:hover,
      body[data-theme="light"] .brand-logo.spatial-focus,
      body[data-theme="light"] .brand-logo:focus-visible {
        background: #e2e8f0;
        border-color: #94a3b8;
      }
      body[data-theme="light"] .btn:not(.red):not(.danger):not(.blue):not(.green):not(.purple):not(.amber):not(.active):not(.close-slate) {
        background: #f1f5f9;
        color: #0f172a;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .btn:not(.red):not(.danger):not(.blue):not(.green):not(.purple):not(.amber):not(.active):not(.close-slate):hover {
        background: #e2e8f0;
        color: #0f172a;
        border-color: #94a3b8;
      }
      body[data-theme="light"] .btn.close-slate {
        background: #f1f5f9;
        color: #1e293b;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .btn.close-slate:hover {
        background: #e2e8f0;
        color: #0f172a;
        border-color: #94a3b8;
      }
      body[data-theme="light"] .btn.blue {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #075985;
      }
      body[data-theme="light"] .btn.blue:hover {
        background: #0284c7;
        border-color: #0369a1;
        color: #ffffff;
      }
      body[data-theme="light"] .btn.green {
        background: #d1fae5;
        border-color: #10b981;
        color: #065f46;
      }
      body[data-theme="light"] .btn.green:hover {
        background: #059669;
        border-color: #047857;
        color: #ffffff;
      }
      body[data-theme="light"] .btn.purple {
        background: #e0e7ff;
        border-color: #818cf8;
        color: #3730a3;
      }
      body[data-theme="light"] .btn.purple:hover {
        background: #4f46e5;
        border-color: #4338ca;
        color: #ffffff;
      }
      body[data-theme="light"] .btn.amber {
        background: #fef3c7;
        border-color: #f59e0b;
        color: #92400e;
      }
      body[data-theme="light"] .btn.amber:hover {
        background: #d97706;
        border-color: #b45309;
        color: #ffffff;
      }
      body[data-theme="light"] .btn.danger {
        background: #fee2e2;
        border-color: #f87171;
        color: #991b1b;
      }
      body[data-theme="light"] .btn.danger:hover {
        background: #dc2626;
        border-color: #b91c1c;
        color: #ffffff;
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
        border-color: rgba(2, 132, 199, 0.45);
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
      }
      body[data-theme="light"] .ac-item {
        color: #0f172a;
      }
      body[data-theme="light"] .ac-item:hover,
      body[data-theme="light"] .ac-item.spatial-focus {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #075985;
      }
      body[data-theme="light"] .panel-box,
      body[data-theme="light"] .floating-filter-bar,
      body[data-theme="light"] .modal,
      body[data-theme="light"] .sidebar-drawer,
      body[data-theme="light"] .submodal-box {
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
      body[data-theme="light"] .ff-tab-btn.open {
        background: #e0f2fe;
        border-color: #0284c7;
        color: #075985;
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
        background-color: #e0f2fe;
        color: #075985;
        border-color: #0284c7;
      }
      body[data-theme="light"] .sort-select option,
      body[data-theme="light"] .mode-filter-select option,
      body[data-theme="light"] .new-filter-select option,
      body[data-theme="light"] .search-scope-select option {
        background-color: #ffffff;
        color: #0f172a;
      }
      body[data-theme="light"] .sort-group {
        background: #f1f5f9;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .sort-group-label {
        color: #475569;
      }
      body[data-theme="light"] .sort-chip {
        color: #334155;
      }
      body[data-theme="light"] .sort-chip.active {
        background: #0284c7;
        color: #ffffff;
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
        color: #0f172a;
      }
      body[data-theme="light"] .recent-chip:hover {
        background: #e0f2fe;
        border-color: #0284c7;
        color: #075985;
      }
      body[data-theme="light"] .recent-chip-title {
        color: #0f172a;
      }
      body[data-theme="light"] .recent-chip-del {
        background: #e2e8f0;
        color: #334155;
      }
      body[data-theme="light"] .card {
        background: #0f172a;
        border-color: rgba(15, 23, 42, 0.16);
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
      }
      body[data-theme="light"] .card:hover {
        border-color: #0284c7;
        box-shadow: 0 10px 24px rgba(2, 132, 199, 0.22);
      }
      body[data-theme="light"] .pagination-bar {
        background: #ffffff;
        border-color: #cbd5e1;
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
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
        background: #e0f2fe;
        border-color: #0284c7;
        color: #075985;
      }
      body[data-theme="light"] .wl-az-btn:not(.active) {
        background: #f8fafc;
        border-color: #cbd5e1;
        color: #334155;
      }
      body[data-theme="light"] .wl-az-btn:not(.active):hover {
        background: #e0f2fe;
        border-color: #0284c7;
        color: #075985;
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
      body[data-theme="light"] .sidebar-sub-divider {
        border-top-color: #cbd5e1;
      }
      body[data-theme="light"] .sidebar-sec-title,
      body[data-theme="light"] .sidebar-section-title {
        color: #0f172a;
      }
      body[data-theme="light"] .sidebar-acc-toggle,
      body[data-theme="light"] .sidebar-collapse-btn {
        color: #0f172a;
      }
      body[data-theme="light"] .sidebar-acc-toggle:hover,
      body[data-theme="light"] .sidebar-collapse-btn:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
      body[data-theme="light"] .sidebar-acc-summary,
      body[data-theme="light"] .sidebar-collapse-meta {
        color: #0369a1;
      }
      body[data-theme="light"] .sidebar-account-btn.is-auth {
        background: #ecfdf5 !important;
        border-color: #10b981 !important;
        color: #065f46 !important;
      }
      body[data-theme="light"] .sidebar-account-btn.is-auth:hover {
        background: #d1fae5 !important;
        border-color: #059669 !important;
        color: #064e3b !important;
      }
      body[data-theme="light"] .sidebar-account-btn.is-guest {
        background: #f0f9ff !important;
        border-color: #38bdf8 !important;
        color: #075985 !important;
      }
      body[data-theme="light"] .sidebar-account-btn.is-guest:hover {
        background: #e0f2fe !important;
        border-color: #0284c7 !important;
        color: #0c4a6e !important;
      }
      body[data-theme="light"] .sidebar-account-btn .sidebar-account-cta {
        color: #334155 !important;
      }
      body[data-theme="light"] .sync-badge {
        background: rgba(16, 185, 129, 0.14);
        border-color: #059669;
        color: #047857;
      }
      body[data-theme="light"] .direct-filter-card:not(.state-inc):not(.state-exc) {
        background: #ffffff;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .direct-filter-card.state-inc {
        background: var(--inc-bg);
        border-color: var(--inc-border);
      }
      body[data-theme="light"] .direct-filter-card.state-exc {
        background: var(--exc-bg);
        border-color: var(--exc-border);
      }
      body[data-theme="light"] .direct-filter-card.state-inc .df-label {
        color: var(--inc-text);
      }
      body[data-theme="light"] .direct-filter-card.state-exc .df-label {
        color: var(--exc-text);
        text-decoration: line-through;
      }
      body[data-theme="light"] .df-btn:not(.active) {
        background: #f1f5f9;
        color: #334155;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .df-btn.inc:hover,
      body[data-theme="light"] .df-btn.inc.active {
        background: var(--inc-solid);
        border-color: var(--inc-border);
        color: #ffffff;
      }
      body[data-theme="light"] .df-btn.exc:hover,
      body[data-theme="light"] .df-btn.exc.active {
        background: var(--exc-solid);
        border-color: var(--exc-border);
        color: #ffffff;
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
      body[data-theme="light"] .ep-row.ep-watched {
        background: #ecfdf5 !important;
        border-color: #10b981 !important;
      }
      body[data-theme="light"] .ep-row.ep-next-up {
        background: #fffbeb !important;
        border-color: #f59e0b !important;
      }
      body[data-theme="light"] .detail-meta-label {
        color: #475569;
      }
      body[data-theme="light"] .stream-meta-pill {
        background: #e2e8f0;
        color: #0f172a;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .stream-meta-pill.size {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0369a1;
      }
      body[data-theme="light"] .stream-meta-pill.tags {
        background: #fef3c7;
        border-color: #f59e0b;
        color: #92400e;
      }
      body[data-theme="light"] .ep-progress-badge {
        background: #d1fae5;
        border-color: #059669;
        color: #065f46;
      }
      body[data-theme="light"] .ep-progress-badge.next {
        background: #fef3c7;
        border-color: #d97706;
        color: #92400e;
      }
      body[data-theme="light"] .flix-tabs-bar {
        background: #f1f5f9;
        border-bottom-color: #cbd5e1;
      }
      body[data-theme="light"] .flix-tab-btn {
        color: #475569;
      }
      body[data-theme="light"] .flix-tab-btn:hover,
      body[data-theme="light"] .flix-tab-btn.spatial-focus {
        color: #0f172a;
        background: rgba(15, 23, 42, 0.06);
      }
      body[data-theme="light"] .flix-tab-btn.active {
        color: #0284c7;
        border-bottom-color: #0284c7;
      }
      body[data-theme="light"] .flix-version-badge {
        background: #e0e7ff;
        border-color: #6366f1;
        color: #1e1b4b;
      }
      body[data-theme="light"] .section-title,
      body[data-theme="light"] .direct-filter-card:not(.state-inc):not(.state-exc) .df-label {
        color: #0f172a;
      }
      body[data-theme="light"] .card-poster-wrap,
      body[data-theme="light"] .card-poster-wrap img,
      body[data-theme="light"] .card > img {
        background: #e2e8f0;
      }
      body[data-theme="light"] .skeleton-poster,
      body[data-theme="light"] .skeleton-line {
        background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
        background-size: 200% 100%;
      }
      body[data-theme="light"] .floating-filter-bar,
      body[data-theme="light"] .pagination-bar {
        background: rgba(255, 255, 255, 0.92);
        border-color: #cbd5e1;
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
      }
      body[data-theme="light"] .sort-select,
      body[data-theme="light"] .mode-filter-select,
      body[data-theme="light"] .new-filter-select {
        background-color: #f8fafc;
        color: #0f172a;
        border-color: #cbd5e1;
        color-scheme: light;
      }
      body[data-theme="light"] .sort-select option,
      body[data-theme="light"] .mode-filter-select option,
      body[data-theme="light"] .new-filter-select option {
        background-color: #ffffff;
        color: #0f172a;
      }
      body[data-theme="light"] .sort-select:hover,
      body[data-theme="light"] .sort-select.spatial-focus,
      body[data-theme="light"] .mode-filter-select:hover,
      body[data-theme="light"] .mode-filter-select.spatial-focus,
      body[data-theme="light"] .mode-filter-select.active-mode,
      body[data-theme="light"] .new-filter-select:hover,
      body[data-theme="light"] .new-filter-select.spatial-focus,
      body[data-theme="light"] .new-filter-select.active-new {
        background-color: #e0f2fe;
        border-color: #0284c7;
        color: #0c4a6e;
      }
      body[data-theme="light"] .hero {
        margin: 10px 14px 4px;
        border-radius: 16px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.15);
      }
      body[data-theme="light"] .hero::after {
        background:
          linear-gradient(90deg, rgba(10, 15, 29, 0.92) 0%, rgba(10, 15, 29, 0.68) 50%, rgba(10, 15, 29, 0.22) 100%),
          linear-gradient(to top, rgba(10, 15, 29, 0.94) 0%, rgba(10, 15, 29, 0.28) 55%, rgba(10, 15, 29, 0.55) 100%);
      }
      body[data-theme="light"] .hero-collapsed-strip {
        background: linear-gradient(90deg, #f0f9ff 0%, #ffffff 50%, #f8fafc 100%);
        border-color: #bae6fd;
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
        background: #e0f2fe;
        border-color: #0284c7;
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
      /* Light-Mode Lesbarkeits-Schutz für Inline-Farben in Modals, Panels & Formularen */
      body[data-theme="light"] .modal-body [style*="background:#090d16"],
      body[data-theme="light"] .modal-body [style*="background:#14141c"],
      body[data-theme="light"] .modal-body [style*="background:#14141d"],
      body[data-theme="light"] .modal-body [style*="background:#141414"],
      body[data-theme="light"] .modal-body [style*="background:#09090d"],
      body[data-theme="light"] .panel-box [style*="background:#141414"],
      body[data-theme="light"] .panel-box [style*="background:#101015"],
      body[data-theme="light"] .panel-box [style*="background:#101016"],
      body[data-theme="light"] .panel-box [style*="background:#101018"],
      body[data-theme="light"] .panel-box [style*="background:#12121a"],
      body[data-theme="light"] .panel-box [style*="background:#141222"],
      body[data-theme="light"] .panel-box [style*="background:#15151e"],
      body[data-theme="light"] .panel-box [style*="background:#16161e"],
      body[data-theme="light"] .panel-box [style*="background:#16161f"],
      body[data-theme="light"] .panel-box [style*="background:#161620"],
      body[data-theme="light"] .panel-box [style*="background:#181822"],
      body[data-theme="light"] .panel-box [style*="background:#181824"],
      body[data-theme="light"] .panel-box [style*="background:#0c0c12"],
      body[data-theme="light"] .panel-box [style*="background:#0d0d14"],
      body[data-theme="light"] .panel-box [style*="background:#050a14"],
      body[data-theme="light"] .panel-box [style*="background:#0d131f"],
      body[data-theme="light"] .panel-box [style*="background:#141b2d"],
      body[data-theme="light"] .submodal-box [style*="background:#090d16"],
      body[data-theme="light"] .submodal-box [style*="background:#101015"],
      body[data-theme="light"] .submodal-box [style*="background:#141414"] {
        background: #f8fafc !important;
        color: #0f172a !important;
        border-color: #cbd5e1 !important;
      }
      body[data-theme="light"] .modal-body [style*="color:#f8fafc"],
      body[data-theme="light"] .modal-body [style*="color:#e2e8f0"],
      body[data-theme="light"] .modal-body [style*="color:#cbd5e1"],
      body[data-theme="light"] .modal-body [style*="color:#fff"],
      body[data-theme="light"] .panel-box [style*="color:#f8fafc"],
      body[data-theme="light"] .panel-box [style*="color:#e2e8f0"],
      body[data-theme="light"] .panel-box [style*="color:#cbd5e1"],
      body[data-theme="light"] .panel-box [style*="color:#fff"],
      body[data-theme="light"] .panel-box [style*="color:#ddd"],
      body[data-theme="light"] .panel-box [style*="color:#ccc"],
      body[data-theme="light"] .sidebar-body [style*="color:#f8fafc"],
      body[data-theme="light"] .sidebar-body [style*="color:#e2e8f0"],
      body[data-theme="light"] .sidebar-body [style*="color:#cbd5e1"],
      body[data-theme="light"] .submodal-box [style*="color:#f8fafc"],
      body[data-theme="light"] .submodal-box [style*="color:#e2e8f0"],
      body[data-theme="light"] .submodal-box [style*="color:#cbd5e1"],
      body[data-theme="light"] .submodal-box [style*="color:#fff"] {
        color: #0f172a !important;
      }
      body[data-theme="light"] .modal-body [style*="color:#fde68a"],
      body[data-theme="light"] .panel-box [style*="color:#fde68a"],
      body[data-theme="light"] .sidebar-body [style*="color:#fde68a"] {
        color: #92400e !important;
      }
      body[data-theme="light"] .modal-body [style*="color:#7dd3fc"],
      body[data-theme="light"] .panel-box [style*="color:#7dd3fc"],
      body[data-theme="light"] .panel-box [style*="color:#00f0ff"],
      body[data-theme="light"] .panel-box [style*="color:#00e5ff"],
      body[data-theme="light"] .panel-box [style*="color:#38bdf8"],
      body[data-theme="light"] .submodal-box [style*="color:#38bdf8"] {
        color: #0369a1 !important;
      }
      body[data-theme="light"] .modal-body [style*="color:#c4b5fd"],
      body[data-theme="light"] .panel-box [style*="color:#c4b5fd"],
      body[data-theme="light"] .panel-box [style*="color:#e9d5ff"],
      body[data-theme="light"] .sidebar-body [style*="color:#c4b5fd"] {
        color: #4338ca !important;
      }
      body[data-theme="light"] .btn.red,
      body[data-theme="light"] .btn.danger:hover,
      body[data-theme="light"] .btn.blue:hover,
      body[data-theme="light"] .btn.green:hover,
      body[data-theme="light"] .btn.purple:hover,
      body[data-theme="light"] .btn.amber:hover {
        color: #ffffff !important;
      }
      /* Theme-adaptive Formular-, Karten- & Sub-Container-Klassen (Dark + Light) */
      .tma-input,
      .tma-select,
      .tma-textarea,
      .admin-field-input {
        background: var(--surface);
        color: var(--text);
        border: 1px solid rgba(14, 165, 233, 0.32);
        border-radius: 7px;
        padding: 7px 10px;
        font-size: 12px;
        box-sizing: border-box;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .tma-input:focus,
      .tma-select:focus,
      .tma-textarea:focus,
      .admin-field-input:focus {
        outline: none;
        border-color: #0ea5e9;
        box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.2);
      }
      .admin-surface-card {
        background: var(--surface);
        border: 1px solid rgba(14, 165, 233, 0.24);
        border-radius: 10px;
        padding: 12px;
        color: var(--text);
      }
      .admin-sub-box {
        background: var(--card);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 8px;
        padding: 9px 11px;
        color: var(--text);
      }
      .admin-code-pill {
        background: rgba(15, 23, 42, 0.85);
        color: #e2e8f0;
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 5px;
        padding: 2px 6px;
        font-family: monospace;
      }
      body[data-theme="light"] .tma-input,
      body[data-theme="light"] .tma-select,
      body[data-theme="light"] .tma-textarea,
      body[data-theme="light"] .admin-field-input {
        background: #ffffff !important;
        color: #0f172a !important;
        border-color: #94a3b8 !important;
      }
      body[data-theme="light"] .admin-surface-card {
        background: #ffffff !important;
        border-color: #cbd5e1 !important;
        color: #0f172a !important;
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
      }
      body[data-theme="light"] .admin-sub-box {
        background: #f8fafc !important;
        border-color: #cbd5e1 !important;
        color: #0f172a !important;
      }
      body[data-theme="light"] .admin-code-pill {
        background: #e2e8f0 !important;
        color: #0f172a !important;
        border-color: #cbd5e1 !important;
      }
      /* JSON-Backup-Import Schnellstart, Ziel-Auswahl & Cockpit Design (Dark + Light) */
      .backup-step-card {
        background: var(--card);
        border: 1px solid rgba(14, 165, 233, 0.24);
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .backup-target-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
        gap: 10px;
        align-items: end;
      }
      .backup-field-label {
        display: block;
        font-size: 11px;
        font-weight: 800;
        color: var(--muted);
        margin-bottom: 4px;
      }
      .backup-input,
      .backup-select {
        width: 100%;
        padding: 7px 10px;
        border-radius: 7px;
        background: var(--surface);
        color: var(--text);
        border: 1px solid rgba(14, 165, 233, 0.32);
        font-size: 12px;
        box-sizing: border-box;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .backup-input:focus,
      .backup-select:focus {
        outline: none;
        border-color: #0ea5e9;
        box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.2);
      }
      .backup-cockpit-box {
        background: var(--surface);
        border: 1px solid rgba(14, 165, 233, 0.28);
        border-radius: 12px;
        padding: 14px;
        margin-top: 10px;
        font-variant-numeric: tabular-nums;
      }
      .backup-progress-track {
        width: 100%;
        height: 24px;
        background: var(--bg);
        border-radius: 999px;
        overflow: hidden;
        border: 1px solid rgba(14, 165, 233, 0.35);
        position: relative;
      }
      .worker-health-monitor-mount {
        font-variant-numeric: tabular-nums;
      }
      body[data-theme="light"] .backup-step-card {
        background: #f8fafc;
        border-color: #cbd5e1;
        color: #0f172a;
      }
      body[data-theme="light"] .backup-input,
      body[data-theme="light"] .backup-select {
        background: #ffffff !important;
        color: #0f172a !important;
        border-color: #94a3b8 !important;
      }
      body[data-theme="light"] .backup-cockpit-box {
        background: #ffffff;
        border-color: #cbd5e1;
        box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
      }
      body[data-theme="light"] .backup-progress-track {
        background: #e2e8f0;
        border-color: #94a3b8;
      }
      body[data-theme="light"] .worker-health-monitor-mount {
        background: #f8fafc !important;
        border-color: #cbd5e1 !important;
        color: #0f172a !important;
      }
      body[data-theme="light"] .worker-health-monitor-mount [style*="background:#050913"],
      body[data-theme="light"] .worker-health-monitor-mount [style*="background:#070c18"],
      body[data-theme="light"] .backup-cockpit-box [style*="background:#070c18"] {
        background: #e2e8f0 !important;
        color: #0f172a !important;
        border-color: #cbd5e1 !important;
      }
      body[data-theme="cyberpunk"] {
        --bg: #070510;
        --surface: #110b22;
        --card: #191030;
        --bg-elevated: #191030;
        --red: #ff007f;
        --accent-primary: #ff007f;
        --blue: #00f0ff;
        --purple: #b829ff;
        --text: #f0f6ff;
        --text-main: #f0f6ff;
        --muted: #94a3b8;
        --text-muted: #94a3b8;
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
        scroll-padding-bottom: max(28px, calc(env(safe-area-inset-bottom, 0px) + 20px));
        overscroll-behavior-y: none;
      }
      body {
        background: var(--bg);
        color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding-bottom: max(32px, calc(env(safe-area-inset-bottom, 0px) + 24px));
        overflow-x: hidden;
        overscroll-behavior-y: none;
        font-size: calc(14px * var(--scale-text));
        transition: background-color 0.2s ease, color 0.2s ease;
        scroll-padding-top: var(--sticky-header-offset, 74px);
        scroll-padding-bottom: max(28px, calc(env(safe-area-inset-bottom, 0px) + 20px));
      }
      #appRoot,
      #resultsGridContainer,
      .carousel {
        scroll-padding-top: var(--sticky-header-offset, 74px);
        scroll-padding-bottom: max(28px, calc(env(safe-area-inset-bottom, 0px) + 20px));
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

      /* Gemeinsame 1:1 Kino-Typografie & Button-Variablen für Hero-Slider & Detailansicht */
      :root {
        --cinema-title-size: clamp(24px, calc(36px * var(--scale-text)), 96px);
        --cinema-meta-size: calc(13.5px * var(--scale-text));
        --cinema-desc-size: calc(13.5px * var(--scale-text));
        --cinema-btn-font: calc(13.5px * var(--scale-text));
        --cinema-btn-pad: calc(9.5px * var(--scale-menu)) calc(18px * var(--scale-menu));
      }

      /* Klare Fokus-Markierung für Pfeiltasten, Android TV Fernbedienung, Gamepad & Maus-Hover (Textlinks ausgenommen):
         WICHTIG: outline-offset: -2px + inset Box-Shadow + kein horizontales scale(), damit die linken & rechten Ränder
         in Scrollboxen (Suchvorschläge, Sidebar, Genre-Grid, Cast-Slider, Katalog) NIEMALS überstehen oder abgeschnitten werden! */
      .spatial-focus:not(#searchInput):not(.search-scope-select):not(.expandable-desc-box):not(.detail-meta-link):not(.detail-meta-studio):not(.hero-meta-year):not(.hero-meta-genre):not(.modal-genre-link):not(.modal-meta-item.clickable),
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
        outline: 2px solid var(--accent-primary) !important;
        outline-offset: -2px !important;
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.55), 0 6px 18px rgba(0, 0, 0, 0.72) !important;
        transform: none;
        z-index: 25;
      }

      /* Edler Cyan-Glow & animierte Unterstreichung für klickbare Textlinks (Jahr, Genres, Studios, Regie, Land, FSK) */
      .detail-meta-link,
      .detail-meta-studio,
      .hero-meta-year,
      .hero-meta-genre,
      .modal-genre-link,
      .modal-meta-item.clickable {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        text-decoration: none !important;
        outline: none !important;
        box-shadow: none !important;
        transition: color 0.18s ease, text-shadow 0.18s ease, transform 0.18s ease;
      }
      .detail-meta-link::after,
      .detail-meta-studio::after,
      .hero-meta-year::after,
      .hero-meta-genre::after,
      .modal-genre-link::after,
      .modal-meta-item.clickable::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        bottom: -2px;
        height: 2px;
        border-radius: 2px;
        background: linear-gradient(90deg, #38bdf8, #818cf8);
        box-shadow: 0 0 8px rgba(56, 189, 248, 0.75);
        transform: scaleX(0);
        transform-origin: left center;
        transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
        pointer-events: none;
      }
      .detail-meta-link:hover,
      .detail-meta-link.spatial-focus,
      .detail-meta-link:focus-visible,
      .detail-meta-studio:hover,
      .detail-meta-studio.spatial-focus,
      .detail-meta-studio:focus-visible,
      .hero-meta-year:hover,
      .hero-meta-year.spatial-focus,
      .hero-meta-year:focus-visible,
      .hero-meta-genre:hover,
      .hero-meta-genre.spatial-focus,
      .hero-meta-genre:focus-visible,
      .modal-genre-link:hover,
      .modal-genre-link.spatial-focus,
      .modal-genre-link:focus-visible,
      .modal-meta-item.clickable:hover,
      .modal-meta-item.clickable.spatial-focus,
      .modal-meta-item.clickable:focus-visible {
        color: #38bdf8 !important;
        text-shadow: 0 0 12px rgba(56, 189, 248, 0.62);
        outline: none !important;
        box-shadow: none !important;
        transform: translateY(-1px);
      }
      .detail-meta-link:hover::after,
      .detail-meta-link.spatial-focus::after,
      .detail-meta-link:focus-visible::after,
      .detail-meta-studio:hover::after,
      .detail-meta-studio.spatial-focus::after,
      .detail-meta-studio:focus-visible::after,
      .hero-meta-year:hover::after,
      .hero-meta-year.spatial-focus::after,
      .hero-meta-year:focus-visible::after,
      .hero-meta-genre:hover::after,
      .hero-meta-genre.spatial-focus::after,
      .hero-meta-genre:focus-visible::after,
      .modal-genre-link:hover::after,
      .modal-genre-link.spatial-focus::after,
      .modal-genre-link:focus-visible::after,
      .modal-meta-item.clickable:hover::after,
      .modal-meta-item.clickable.spatial-focus::after,
      .modal-meta-item.clickable:focus-visible::after {
        transform: scaleX(1);
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
        --top-bar-h: 38px;
        position: sticky;
        top: 0;
        z-index: 60;
        background: linear-gradient(
          180deg,
          rgba(6, 9, 17, 0.95) 0%,
          rgba(var(--ambi-1), 0.18) 55%,
          rgba(6, 9, 17, 0.92) 100%
        );
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        padding: 8px 16px;
        border-bottom: 1px solid rgba(var(--ambi-2), 0.20);
        box-shadow: 0 8px 24px rgba(2, 6, 23, 0.45);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: nowrap;
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transition: background 0.28s ease, border-color 0.28s ease, box-shadow 0.28s ease;
      }
      header .top-btn-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        flex-shrink: 0;
      }
      header .top-btn-label,
      header .brand-text-wrap {
        display: inline;
        white-space: nowrap;
      }
      body.modal-open-pause-hero header#topUnifiedBar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 125;
      }
      header #topBarBackBtn,
      header #topBarAdjNavGroup {
        display: none !important;
      }
      body.modal-open-pause-hero header #sidebarToggleBtn,
      body.modal-open-pause-hero header #heroHideBtn {
        display: none !important;
      }
      body.modal-open-pause-hero header #topBarBackBtn {
        display: inline-flex !important;
      }
      body.modal-open-pause-hero header #topBarAdjNavGroup {
        display: inline-flex !important;
        align-items: center;
        gap: 5px;
        flex-shrink: 0;
      }
      header #sidebarToggleBtn,
      header #topBarBackBtn,
      header #navBtnWishlist,
      header .top-adj-nav-btn {
        height: var(--top-bar-h) !important;
        min-height: var(--top-bar-h) !important;
        max-height: var(--top-bar-h) !important;
        padding: 0 11px !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        display: inline-flex;
        align-items: center !important;
        justify-content: center !important;
        gap: 5px !important;
        flex-shrink: 0;
        white-space: nowrap;
        font-size: calc(12px * var(--scale-menu)) !important;
        font-weight: 700 !important;
        color: #f8fafc;
        background: linear-gradient(135deg, rgba(8, 13, 24, 0.86) 0%, rgba(var(--ambi-1), 0.20) 100%);
        border: 1px solid rgba(var(--ambi-2), 0.34);
        border-radius: 10px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.42);
        cursor: pointer;
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transition: border-color 0.25s ease, transform 0.14s ease, box-shadow 0.25s ease, background 0.25s ease;
      }
      header .top-adj-nav-btn {
        padding: 0 10px !important;
        min-width: var(--top-bar-h);
      }
      header .top-adj-nav-btn:disabled {
        opacity: 0.35;
        pointer-events: none;
      }
      header #sidebarToggleBtn:hover,
      header #topBarBackBtn:hover,
      header #navBtnWishlist:hover,
      header .top-adj-nav-btn:hover {
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.92) 0%, rgba(var(--ambi-2), 0.28) 100%);
        border-color: rgba(var(--ambi-2), 0.65);
      }
      .brand-wrap { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
      .brand-logo {
        height: var(--top-bar-h, 38px);
        min-height: var(--top-bar-h, 38px);
        max-height: var(--top-bar-h, 38px);
        box-sizing: border-box;
        color: #f8fafc;
        font-weight: 800;
        font-size: calc(15px * var(--scale-menu));
        letter-spacing: -0.2px;
        cursor: pointer;
        user-select: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 10px;
        border-radius: 10px;
        background: linear-gradient(135deg, rgba(8, 13, 24, 0.86) 0%, rgba(var(--ambi-1), 0.18) 100%);
        border: 1px solid rgba(var(--ambi-2), 0.32);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transition: transform 0.12s, border-color 0.2s, box-shadow 0.2s;
        flex-shrink: 0;
      }
      .brand-logo:hover,
      .brand-logo.spatial-focus,
      .brand-logo:focus-visible {
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.88) 0%, rgba(var(--ambi-2), 0.28) 100%);
        border-color: rgba(var(--ambi-2), 0.62);
      }
      .brand-logo:active { transform: scale(0.96); }
      .teleport-logo-svg {
        width: 19px;
        height: 19px;
        flex-shrink: 0;
        filter: drop-shadow(0 0 6px rgba(var(--ambi-2), 0.55));
      }
      .teleport-accent {
        background: linear-gradient(135deg, #38bdf8, #818cf8, #6366f1);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .sync-badge {
        font-size: calc(10.5px * var(--scale-text));
        color: #34d399;
        background: rgba(16,185,129,0.12);
        border: 1px solid rgba(16,185,129,0.28);
        padding: 4px 8px;
        border-radius: 8px;
        font-weight: 700;
        cursor: pointer;
      }
      .device-badge {
        display: none;
      }
      .nav-btns { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .btn {
        background: rgba(255,255,255,0.06);
        color: #f1f5f9;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        padding: calc(6px * var(--scale-menu)) calc(10px * var(--scale-menu));
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        white-space: nowrap;
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
      }
      .btn:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.2); }
      .btn:active { transform: scale(0.97); }
      .btn.red { background: linear-gradient(135deg, #0284c7, #4338ca); border-color: rgba(56, 189, 248, 0.45); color: #ffffff; box-shadow: 0 2px 10px rgba(2, 132, 199, 0.28); }
      .btn.red:hover { background: linear-gradient(135deg, #0369a1, #3730a3); border-color: #7dd3fc; color: #ffffff; }
      .btn.danger { background: rgba(225, 29, 72, 0.18); border-color: rgba(244, 63, 94, 0.55); color: #fda4af; font-weight: 700; }
      .btn.danger:hover { background: #e11d48; border-color: #fb7185; color: #ffffff; box-shadow: 0 3px 12px rgba(225, 29, 72, 0.35); }
      .btn.blue { background: rgba(14, 165, 233, 0.18); border-color: rgba(56, 189, 248, 0.4); color: #e0f2fe; }
      .btn.blue:hover { background: rgba(14, 165, 233, 0.28); border-color: #38bdf8; color: #fff; }
      .btn.green { background: rgba(16, 185, 129, 0.18); border-color: rgba(16, 185, 129, 0.45); color: #d1fae5; }
      .btn.green:hover { background: rgba(16, 185, 129, 0.3); border-color: #34d399; color: #fff; }
      .btn.purple { background: rgba(99, 102, 241, 0.18); border-color: rgba(129, 140, 248, 0.42); color: #e0e7ff; border-radius: 8px; padding: calc(6px * var(--scale-menu)) calc(11px * var(--scale-menu)); }
      .btn.purple:hover { background: rgba(99, 102, 241, 0.3); border-color: #818cf8; color: #fff; }
      .btn.amber { background: rgba(245, 158, 11, 0.16); border-color: rgba(251, 191, 36, 0.42); color: #fef3c7; font-weight: 700; }
      .btn.amber:hover { background: rgba(245, 158, 11, 0.26); border-color: #fbbf24; color: #fff; }
      .btn.close-slate { background: rgba(30, 41, 59, 0.85); border-color: rgba(148, 163, 184, 0.35); color: #e2e8f0; font-weight: 700; }
      .btn.close-slate:hover { background: #334155; border-color: #94a3b8; color: #f8fafc; }
      .btn.active { background: #f8fafc; color: #0f172a; border-color: #f8fafc; font-weight: 800; }

      /* Linke 2-Spalten Ambilight-Glas Sidebar (Links: Einzeilige Übersicht | Rechts: Dynamisches Optionen-Panel) */
      .sidebar-backdrop {
        position: fixed;
        inset: 0;
        z-index: 140;
        background: radial-gradient(circle at 18% 30%, rgba(var(--ambi-1), 0.16) 0%, rgba(2, 6, 18, 0.72) 70%);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.24s ease;
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
        width: min(calc(370px * var(--scale-menu)), 94vw);
        z-index: 145;
        background: linear-gradient(
          155deg,
          rgba(8, 13, 26, 0.78) 0%,
          rgba(12, 19, 36, 0.72) 52%,
          rgba(var(--ambi-1), 0.16) 100%
        );
        backdrop-filter: blur(28px) saturate(175%);
        -webkit-backdrop-filter: blur(28px) saturate(175%);
        border-right: 1px solid rgba(var(--ambi-2), 0.36);
        box-shadow: 20px 0 60px rgba(0, 0, 0, 0.82), inset -1px 0 22px rgba(var(--ambi-2), 0.10);
        transform: translateX(-104%);
        transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1), width 0.24s cubic-bezier(0.22, 1, 0.36, 1);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .sidebar-drawer.open {
        transform: translateX(0);
      }
      .sidebar-drawer.has-subpanel {
        width: min(calc(800px * var(--scale-menu)), 96vw);
      }
      .sidebar-header {
        padding: 10px 14px;
        border-bottom: 1px solid rgba(var(--ambi-2), 0.22);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        background: linear-gradient(90deg, rgba(8, 13, 25, 0.78) 0%, rgba(var(--ambi-1), 0.20) 100%);
        flex-shrink: 0;
      }
      .sidebar-columns-wrap {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: row;
        align-items: stretch;
        overflow: hidden;
        position: relative;
      }
      .sidebar-body {
        width: min(calc(370px * var(--scale-menu)), 94vw);
        flex: 0 0 auto;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 12px 13px 28px;
        scroll-padding-top: 16px;
        scroll-padding-bottom: 24px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .sidebar-drawer.has-subpanel .sidebar-body {
        border-right: 1px solid rgba(var(--ambi-2), 0.22);
      }
      .sidebar-right-subpanel {
        flex: 1 1 auto;
        min-width: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 12px 14px 28px;
        display: none;
        flex-direction: column;
        gap: 10px;
        background: linear-gradient(180deg, rgba(6, 10, 22, 0.46) 0%, rgba(var(--ambi-1), 0.10) 100%);
        animation: sidebarSubFadeIn 0.18s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .sidebar-drawer.has-subpanel .sidebar-right-subpanel {
        display: flex;
      }
      @keyframes sidebarSubFadeIn {
        from { opacity: 0; transform: translateX(10px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @media (max-width: 720px) {
        .sidebar-drawer.has-subpanel .sidebar-body {
          display: none;
        }
        .sidebar-drawer.has-subpanel {
          width: min(calc(430px * var(--scale-menu)), 96vw);
        }
      }
      .sidebar-section {
        background: rgba(15, 23, 42, 0.44);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 12px;
        padding: 10px 11px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      }
      .sidebar-nav-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(calc(126px * var(--scale-menu)), 1fr));
        gap: 6px;
      }
      .sidebar-section .btn {
        height: auto;
        min-height: calc(34px * var(--scale-menu));
        white-space: normal;
        word-break: break-word;
        text-align: left;
        justify-content: flex-start;
        line-height: 1.25;
        padding: calc(6.5px * var(--scale-menu)) calc(10px * var(--scale-menu));
      }
      .sidebar-menu-stack {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .sidebar-menu-row {
        width: 100%;
        min-height: calc(38px * var(--scale-menu));
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 9px;
        color: #f1f5f9;
        padding: calc(7px * var(--scale-menu)) calc(11px * var(--scale-menu));
        font-size: calc(12px * var(--scale-menu));
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        text-align: left;
        transition: background 0.16s ease, border-color 0.16s ease, transform 0.14s ease, box-shadow 0.16s ease;
      }
      .sidebar-menu-row:hover,
      .sidebar-menu-row.spatial-focus {
        background: rgba(14, 165, 233, 0.18);
        border-color: rgba(56, 189, 248, 0.58);
        color: #ffffff;
      }
      .sidebar-menu-row.active {
        background: linear-gradient(90deg, rgba(2, 132, 199, 0.34) 0%, rgba(79, 70, 229, 0.28) 100%);
        border-color: #38bdf8;
        color: #ffffff;
        box-shadow: 0 4px 16px rgba(2, 132, 199, 0.28);
      }
      .sidebar-menu-row.has-inc {
        border-color: var(--inc-border);
        background: var(--inc-bg);
      }
      .sidebar-menu-row-left {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sidebar-menu-row-right {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        font-size: calc(11px * var(--scale-text));
        color: #7dd3fc;
        font-weight: 800;
      }
      .sidebar-subpanel-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        flex-wrap: wrap;
      }
      .sidebar-subpanel-title {
        font-size: calc(13px * var(--scale-text));
        font-weight: 900;
        color: #f8fafc;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .sidebar-sub-divider {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(148, 163, 184, 0.16);
      }
      .sidebar-account-btn.is-auth {
        background: rgba(16, 185, 129, 0.14);
        border-color: rgba(16, 185, 129, 0.42);
        color: #6ee7b7;
      }
      .sidebar-account-btn.is-auth:hover {
        background: rgba(16, 185, 129, 0.24);
        border-color: #34d399;
        color: #ecfdf5;
      }
      .sidebar-account-btn.is-guest {
        background: rgba(14, 165, 233, 0.14);
        border-color: rgba(56, 189, 248, 0.4);
        color: #bae6fd;
      }
      .sidebar-account-btn.is-guest:hover {
        background: rgba(14, 165, 233, 0.24);
        border-color: #38bdf8;
        color: #f0f9ff;
      }
      .sidebar-account-btn .sidebar-account-cta {
        color: var(--muted);
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 700;
      }
      .sidebar-section-title {
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 800;
        color: #e2e8f0;
        margin-bottom: 7px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        flex-wrap: wrap;
      }
      .sidebar-collapse-btn {
        width: 100%;
        background: transparent;
        border: 0;
        color: #e2e8f0;
        padding: 4px 2px;
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
        background: rgba(14, 165, 233, 0.12);
      }
      .sidebar-collapse-meta {
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        color: #38bdf8;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .scale-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 6px 0;
        border-top: 1px solid rgba(148, 163, 184, 0.14);
        flex-wrap: wrap;
      }
      .scale-label {
        font-size: calc(11.5px * var(--scale-text));
        color: #e2e8f0;
        font-weight: 700;
      }
      .scale-opts {
        display: inline-flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      .scale-opts .btn {
        padding: calc(4px * var(--scale-menu)) calc(8px * var(--scale-menu));
        font-size: calc(11px * var(--scale-menu));
        min-height: 0;
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
        background: linear-gradient(90deg, rgba(2, 132, 199, 0.96), rgba(79, 70, 229, 0.96));
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

      /* Kompakter Film / Serien Umschalter direkt in der einzeiligen Top-Leiste (exakt 38px/36px hoch) */
      .media-mode-switch-inline {
        height: var(--top-bar-h, 38px);
        min-height: var(--top-bar-h, 38px);
        max-height: var(--top-bar-h, 38px);
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        flex-shrink: 0;
        background: linear-gradient(135deg, rgba(8, 13, 24, 0.86) 0%, rgba(var(--ambi-1), 0.18) 100%);
        padding: 3px;
        border-radius: 10px;
        border: 1px solid rgba(var(--ambi-2), 0.32);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.42);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transition: border-color 0.28s ease;
      }
      .media-mode-tab {
        height: calc(var(--top-bar-h, 38px) - 8px);
        padding: 0 10px;
        box-sizing: border-box;
        border-radius: 7px;
        border: 1px solid transparent;
        background: transparent;
        color: #cbd5e1;
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 800;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        white-space: nowrap;
        transition: all 0.15s ease;
      }
      .media-mode-tab:not(:disabled):hover {
        color: #fff;
        background: rgba(255,255,255,0.1);
      }
      .media-mode-tab.active-movie {
        background: linear-gradient(135deg, #0284c7, #1d4ed8);
        color: #fff;
        border-color: #38bdf8;
        box-shadow: 0 2px 10px rgba(2, 132, 199, 0.38);
      }
      .media-mode-tab.active-series {
        background: linear-gradient(135deg, #4338ca, #6d28d9);
        color: #fff;
        border-color: #818cf8;
        box-shadow: 0 2px 10px rgba(79, 70, 229, 0.38);
      }
      .media-mode-tab:disabled {
        cursor: default !important;
        opacity: 1 !important;
      }

      /* Einzeilige Ambilight-Glas-Top-Leiste: Suche, Menü, Filme/Serien, Merkliste & Slider-Toggle auf einer Ebene */
      body {
        --ambi-1: 14, 165, 233;
        --ambi-2: 56, 189, 248;
        --ambi-3: 30, 64, 175;
      }
      .hero-top-dock-hide-btn {
        display: none !important;
        flex-shrink: 0;
        white-space: nowrap;
      }
      body:has(#heroCurtainShell) .hero-top-dock-hide-btn {
        display: inline-flex !important;
      }
      .search-bar {
        flex: 1 1 180px;
        min-width: 96px;
        height: var(--top-bar-h, 38px);
        min-height: var(--top-bar-h, 38px);
        max-height: var(--top-bar-h, 38px);
        box-sizing: border-box;
        display: flex;
        gap: 0;
        align-items: center;
        flex-wrap: nowrap;
        background: linear-gradient(
          135deg,
          rgba(7, 11, 20, 0.86) 0%,
          rgba(var(--ambi-1), 0.20) 52%,
          rgba(7, 11, 20, 0.90) 100%
        );
        border: 1px solid rgba(var(--ambi-2), 0.36);
        border-radius: 10px;
        padding: 0 3px;
        box-shadow:
          0 4px 16px rgba(2, 6, 23, 0.44),
          0 0 14px rgba(var(--ambi-1), 0.10);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transition: border-color 0.28s ease, box-shadow 0.28s ease;
      }
      body[data-theme="light"] .search-bar {
        background: linear-gradient(
          135deg,
          rgba(15, 23, 42, 0.82) 0%,
          rgba(var(--ambi-1), 0.22) 52%,
          rgba(15, 23, 42, 0.88) 100%
        );
      }
      .search-bar:focus-within {
        border-color: rgba(var(--ambi-2), 0.76);
        box-shadow:
          0 8px 26px rgba(0, 0, 0, 0.62),
          0 0 24px rgba(var(--ambi-2), 0.28);
      }
      #searchInput:focus,
      .search-scope-select:focus,
      .search-genre-trigger-btn:focus {
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
        border-color: var(--accent-primary) !important;
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.35), 0 4px 16px rgba(0, 0, 0, 0.55) !important;
      }
      .search-scope-select.spatial-focus,
      .search-genre-trigger-btn.spatial-focus,
      .mobile-search-collapse-btn.spatial-focus {
        outline: 2px solid var(--accent-primary) !important;
        outline-offset: -1px !important;
        background-color: rgba(14, 165, 233, 0.24) !important;
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.35) !important;
        transform: none !important;
      }
      .mobile-search-collapse-btn {
        display: none;
        height: calc(var(--top-bar-h, 38px) - 6px);
        width: 30px;
        min-width: 30px;
        box-sizing: border-box;
        border: 0;
        border-right: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 7px 0 0 7px;
        background: rgba(15, 23, 42, 0.65);
        color: #f8fafc;
        font-size: 14px;
        font-weight: 800;
        cursor: pointer;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        padding: 0;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .mobile-search-collapse-btn:hover {
        background: rgba(56, 189, 248, 0.25);
        color: #ffffff;
      }
      /* Maßgeschneiderter Genre-Trigger-Button in der Suchleiste (ersetzt das abgeschnittene native Select) */
      .search-genre-trigger-btn {
        height: calc(var(--top-bar-h, 38px) - 6px);
        box-sizing: border-box;
        background-color: rgba(15, 23, 42, 0.58);
        border: 0;
        border-right: 1px solid rgba(255, 255, 255, 0.16);
        color: #f8fafc;
        border-radius: 7px 0 0 7px;
        padding: 0 9px;
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 700;
        cursor: pointer;
        max-width: 148px;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        white-space: nowrap;
        overflow: hidden;
        transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
      }
      .search-genre-trigger-btn:hover,
      .search-genre-trigger-btn.is-open {
        background-color: rgba(30, 41, 59, 0.88);
        color: #ffffff;
      }
      .search-genre-trigger-btn.has-active-genre {
        background: linear-gradient(135deg, rgba(2, 132, 199, 0.34), rgba(30, 58, 138, 0.52));
        color: #e0f2fe;
        border-right-color: rgba(56, 189, 248, 0.45);
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.42);
      }
      .search-genre-trigger-icon {
        font-size: 13px;
        line-height: 1;
        flex-shrink: 0;
      }
      .search-genre-trigger-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .search-genre-caret {
        font-size: 10px;
        opacity: 0.78;
        flex-shrink: 0;
        transition: transform 0.18s ease;
      }
      .search-genre-trigger-btn.is-open .search-genre-caret {
        transform: rotate(180deg);
      }
      .search-genre-quick-reset {
        display: none;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        margin-left: 2px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.55);
        border: 1px solid rgba(255, 255, 255, 0.32);
        color: #f8fafc;
        font-size: 9.5px;
        font-weight: 900;
        line-height: 1;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
      }
      .search-genre-quick-reset:hover {
        background: rgba(239, 68, 68, 0.88);
        border-color: #fecaca;
        color: #ffffff;
        transform: scale(1.1);
      }
      .top-filter-count-badge {
        display: none;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        margin-left: 3px;
        border-radius: 999px;
        background: linear-gradient(135deg, #0ea5e9, #2563eb);
        border: 1px solid rgba(186, 230, 253, 0.85);
        color: #ffffff;
        font-size: 9.5px;
        font-weight: 900;
        line-height: 1;
        box-shadow: 0 2px 8px rgba(14, 165, 233, 0.48);
      }
      #sidebarToggleBtn.has-active-filters {
        border-color: rgba(56, 189, 248, 0.72) !important;
        box-shadow: 0 0 12px rgba(14, 165, 233, 0.26);
      }
      .ff-spotlight-return-btn {
        display: none !important;
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.24), rgba(37, 99, 235, 0.30)) !important;
        border-color: rgba(56, 189, 248, 0.68) !important;
        color: #f0f9ff !important;
        font-weight: 800 !important;
      }
      body.hero-scrolled-past .ff-spotlight-return-btn,
      body.hero-is-hidden .ff-spotlight-return-btn {
        display: inline-flex !important;
      }
      .ff-quick-reset-btn {
        background: rgba(239, 68, 68, 0.16) !important;
        border-color: rgba(248, 113, 113, 0.52) !important;
        color: #fecaca !important;
        font-weight: 800 !important;
      }
      .ff-quick-reset-btn:hover,
      .ff-quick-reset-btn.spatial-focus {
        background: rgba(239, 68, 68, 0.32) !important;
        border-color: #fca5a5 !important;
        color: #ffffff !important;
      }
      .catalog-back-to-top-fab {
        position: fixed;
        right: 16px;
        bottom: 18px;
        z-index: 75;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 13px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(30, 41, 59, 0.94));
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(56, 189, 248, 0.55);
        color: #f8fafc;
        font-size: 11.5px;
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.65), 0 0 16px rgba(14, 165, 233, 0.24);
        opacity: 0;
        pointer-events: none;
        transform: translate3d(0, 14px, 0) scale(0.94);
        transition: opacity 0.22s ease, transform 0.22s ease, bottom 0.22s ease, border-color 0.18s ease, background 0.18s ease;
      }
      body:has(#smartPageIndicatorBtn[style*="inline-flex"]) .catalog-back-to-top-fab {
        bottom: 58px;
      }
      body.catalog-deep-scrolled .catalog-back-to-top-fab {
        opacity: 1;
        pointer-events: auto;
        transform: translate3d(0, 0, 0) scale(1);
      }
      .catalog-back-to-top-fab:hover,
      .catalog-back-to-top-fab.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #2563eb);
        border-color: #bae6fd;
        color: #ffffff;
        transform: translate3d(0, -2px, 0);
      }
      /* Seitliche Rand-Steuerung: Links Menü-Übersicht direkt | Rechts Aktionen nur bei Annäherung an den rechten Rand */
      .catalog-edge-trigger-left {
        position: fixed;
        left: 0;
        top: 20%;
        bottom: 20%;
        width: 18px;
        z-index: 75;
        cursor: pointer;
        background: transparent;
        transition: background 0.2s ease;
      }
      .catalog-edge-trigger-left:hover {
        background: linear-gradient(90deg, rgba(56, 189, 248, 0.35) 0%, transparent 100%);
      }
      /* Hintergrund-Scroll-Sperre sobald ein Seitenmenü (Links oder Rechts) aktiv/geöffnet ist */
      body:has(#filterSidebarDrawer.open),
      body:has(#tvQuickJumpElevator.has-subpanel),
      body:has(#tvQuickJumpElevator.is-visible),
      body:has(#tvQuickJumpElevator.is-hover-expanded),
      body:has(#tvQuickJumpElevator:hover) {
        overflow: hidden !important;
        overscroll-behavior: none !important;
      }
      .sidebar-body,
      .sidebar-right-subpanel,
      .rm-entries-scroll {
        overscroll-behavior: contain;
      }
      .catalog-edge-trigger-right {
        position: fixed;
        right: 0;
        top: 15%;
        bottom: 15%;
        width: 32px;
        z-index: 75;
        cursor: pointer;
        background: transparent;
      }
      .tv-quick-jump-elevator {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translate3d(calc(100% + 2px), -50%, 0);
        z-index: 76;
        display: flex;
        flex-direction: row;
        align-items: stretch;
        gap: 0;
        padding: 0;
        max-height: min(86vh, 760px);
        border-radius: 16px 0 0 16px;
        background: linear-gradient(
          155deg,
          rgba(8, 13, 26, 0.64) 0%,
          rgba(12, 19, 36, 0.58) 52%,
          rgba(var(--ambi-1), 0.22) 100%
        );
        backdrop-filter: blur(28px) saturate(185%);
        -webkit-backdrop-filter: blur(28px) saturate(185%);
        border: 1px solid rgba(var(--ambi-2), 0.42);
        border-right: none;
        box-shadow: -12px 14px 38px rgba(0, 0, 0, 0.82), inset 1px 0 22px rgba(var(--ambi-2), 0.12);
        opacity: 1;
        pointer-events: auto;
        overflow: hidden;
        transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1), width 0.24s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.2s ease, box-shadow 0.2s ease;
      }
      .tv-quick-jump-elevator.has-subpanel {
        width: min(calc(720px * var(--scale-menu)), 96vw);
        height: min(84vh, 720px);
      }
      .tv-elevator-main-col {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 6px;
        padding: 10px 9px 10px 9px;
        min-width: 146px;
        flex-shrink: 0;
      }
      .tv-quick-jump-elevator.has-subpanel .tv-elevator-main-col {
        border-left: 1px solid rgba(var(--ambi-2), 0.24);
        background: rgba(6, 10, 22, 0.38);
        justify-content: flex-start;
        padding-top: 14px;
      }
      .tv-elevator-subpanel {
        display: none;
        flex: 1 1 auto;
        min-width: 0;
        flex-direction: column;
        gap: 8px;
        padding: 12px 13px 14px;
        overflow: hidden;
        background: linear-gradient(180deg, rgba(6, 10, 22, 0.42) 0%, rgba(var(--ambi-1), 0.10) 100%);
      }
      .tv-quick-jump-elevator.has-subpanel .tv-elevator-subpanel {
        display: flex;
      }
      .rm-filter-panel {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px 9px;
        border-radius: 11px;
        background: rgba(15, 23, 42, 0.48);
        border: 1px solid rgba(255, 255, 255, 0.11);
        flex-shrink: 0;
      }
      .rm-filter-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      .rm-ctrl-select,
      .rm-ctrl-input {
        background: rgba(8, 13, 26, 0.72);
        color: #f1f5f9;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 7px;
        padding: 4px 7px;
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        outline: none;
      }
      .rm-ctrl-select:focus,
      .rm-ctrl-input:focus,
      .rm-ctrl-select.spatial-focus,
      .rm-ctrl-input.spatial-focus {
        border-color: #38bdf8;
        box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.35);
      }
      .rm-az-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        align-items: center;
      }
      .rm-az-chip {
        min-width: 22px;
        height: 22px;
        padding: 0 5px;
        border-radius: 5px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(15, 23, 42, 0.55);
        color: #cbd5e1;
        font-size: 10px;
        font-weight: 800;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .rm-az-chip.active,
      .rm-az-chip:hover,
      .rm-az-chip.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #2563eb);
        border-color: #7dd3fc;
        color: #ffffff;
      }
      .rm-entries-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-right: 3px;
      }
      .rm-entry-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 9px;
        padding: 6px 8px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.52);
        border: 1px solid rgba(255, 255, 255, 0.10);
        cursor: pointer;
        transition: background 0.14s ease, border-color 0.14s ease, transform 0.14s ease;
      }
      .rm-entry-card:hover,
      .rm-entry-card.spatial-focus {
        background: linear-gradient(135deg, rgba(2, 132, 199, 0.34), rgba(37, 99, 235, 0.38));
        border-color: #7dd3fc;
        transform: translate3d(-2px, 0, 0);
      }
      .tv-elev-count-badge {
        margin-left: auto;
        padding: 1px 6px;
        border-radius: 999px;
        background: rgba(56, 189, 248, 0.22);
        border: 1px solid rgba(56, 189, 248, 0.45);
        color: #e0f2fe;
        font-size: 10px;
        font-weight: 900;
      }
      .tv-elevator-btn.active-tab {
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.35), rgba(37, 99, 235, 0.42));
        border-color: #38bdf8;
        color: #ffffff;
      }
      .elevator-backdrop {
        position: fixed;
        inset: 0;
        z-index: 74;
        background: radial-gradient(circle at 86% 50%, rgba(var(--ambi-1), 0.16) 0%, rgba(2, 6, 18, 0.56) 72%);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.24s ease;
      }
      .tv-quick-jump-elevator.has-subpanel + .elevator-backdrop {
        opacity: 1;
        pointer-events: auto;
      }
      body.in-hero-slider .tv-quick-jump-elevator,
      body.in-hero-slider .elevator-backdrop,
      body.in-hero-slider .catalog-edge-trigger-left,
      body.in-hero-slider .catalog-edge-trigger-right,
      body:has(#modalRoot .modal-backdrop) .tv-quick-jump-elevator,
      body:has(#modalRoot .modal-backdrop) .elevator-backdrop,
      body:has(#filterSidebarDrawer.open) .tv-quick-jump-elevator,
      body:has(#filterSidebarDrawer.open) .elevator-backdrop,
      body:has(#customDialogRoot .page-jump-modal-backdrop) .tv-quick-jump-elevator,
      body:has(#customDialogRoot .page-jump-modal-backdrop) .elevator-backdrop,
      body:has(#personSpotlightOverlayRoot .person-spotlight-overlay) .tv-quick-jump-elevator,
      body:has(#personSpotlightOverlayRoot .person-spotlight-overlay) .elevator-backdrop {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      .tv-quick-jump-elevator:hover,
      .tv-quick-jump-elevator:focus-within,
      .tv-quick-jump-elevator.is-hover-expanded,
      .tv-quick-jump-elevator.is-visible,
      .tv-quick-jump-elevator:has(.spatial-focus),
      .catalog-edge-trigger-right:hover + .tv-quick-jump-elevator {
        opacity: 1 !important;
        pointer-events: auto !important;
        transform: translate3d(0, -50%, 0) !important;
        border-color: rgba(56, 189, 248, 0.78);
        box-shadow: -16px 16px 44px rgba(0, 0, 0, 0.86), 0 0 26px rgba(14, 165, 233, 0.28);
      }
      .tv-quick-jump-elevator:hover + .elevator-backdrop,
      .tv-quick-jump-elevator:focus-within + .elevator-backdrop,
      .tv-quick-jump-elevator.is-hover-expanded + .elevator-backdrop,
      .tv-quick-jump-elevator.is-visible + .elevator-backdrop,
      .tv-quick-jump-elevator:has(.spatial-focus) + .elevator-backdrop,
      .catalog-edge-trigger-right:hover ~ .elevator-backdrop {
        opacity: 1;
      }
      .tv-elevator-btn {
        min-height: 36px;
        width: 100%;
        box-sizing: border-box;
        padding: 0 10px;
        border-radius: 9px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(15, 23, 42, 0.46);
        color: #e2e8f0;
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 800;
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        gap: 7px;
        cursor: pointer;
        white-space: nowrap;
        transition: transform 0.14s ease, background 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
      }
      .tv-quick-jump-elevator .tv-elevator-btn:hover,
      .tv-quick-jump-elevator .tv-elevator-btn.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #2563eb);
        border-color: #7dd3fc;
        color: #ffffff;
        box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.48), 0 6px 16px rgba(2, 132, 199, 0.45);
        transform: translate3d(-2px, 0, 0);
      }
      .catalog-back-to-top-fab {
        display: none !important;
      }
      @media (min-width: 721px) {
        .tv-quick-jump-elevator {
          min-width: 108px;
        }
      }
      @media (max-width: 720px) {
        .tv-quick-jump-elevator:not(:focus-within):not(:hover):not(.is-hover-expanded) .tv-elev-label {
          display: none;
        }
        .tv-quick-jump-elevator:not(:focus-within):not(:hover):not(.is-hover-expanded) .tv-elevator-btn {
          width: 36px;
          height: 36px;
          min-height: 36px;
          padding: 0;
          justify-content: center;
        }
      }
      .recent-strip-scroll-btn {
        width: 26px;
        height: 26px;
        min-width: 26px;
        border-radius: 999px;
        border: 1px solid rgba(56, 189, 248, 0.35);
        background: rgba(15, 23, 42, 0.85);
        color: #bae6fd;
        font-size: 13px;
        font-weight: 900;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
        transition: all 0.15s ease;
      }
      .recent-strip-scroll-btn:hover,
      .recent-strip-scroll-btn.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #2563eb);
        border-color: #7dd3fc;
        color: #ffffff;
      }
      /* Schwebendes Ambilight-Glas-Dropdown-Overlay mit Genre-Chips */
      .search-genre-dropdown-overlay {
        position: absolute;
        left: 14px;
        right: 14px;
        top: calc(100% + 6px);
        max-width: 680px;
        margin: 0 auto;
        background: linear-gradient(165deg, rgba(10, 15, 28, 0.96) 0%, rgba(15, 23, 42, 0.94) 100%);
        backdrop-filter: blur(22px) saturate(1.5);
        -webkit-backdrop-filter: blur(22px) saturate(1.5);
        border: 1px solid rgba(var(--ambi-2), 0.52);
        border-radius: 14px;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.88), 0 0 28px rgba(var(--ambi-1), 0.18);
        padding: 10px 12px 12px;
        z-index: 85;
        display: none;
        animation: fadeIn 0.16s ease;
      }
      .search-genre-dropdown-overlay.open {
        display: block;
      }
      .genre-overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        padding-bottom: 8px;
        margin-bottom: 8px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      }
      .genre-overlay-title {
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 800;
        color: #e2e8f0;
        letter-spacing: 0.3px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .genre-overlay-type-pills {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px;
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.85);
        border: 1px solid rgba(148, 163, 184, 0.25);
      }
      .genre-overlay-type-btn {
        background: transparent;
        border: 0;
        color: #94a3b8;
        font-size: 11px;
        font-weight: 800;
        padding: 3px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.14s ease;
      }
      .genre-overlay-type-btn:hover,
      .genre-overlay-type-btn.spatial-focus {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.08);
      }
      .genre-overlay-type-btn.active {
        background: linear-gradient(135deg, #0284c7, #2563eb);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);
      }
      .genre-overlay-close-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #cbd5e1;
        border-radius: 8px;
        padding: 3px 8px;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .genre-overlay-close-btn:hover,
      .genre-overlay-close-btn.spatial-focus {
        background: var(--red);
        color: #ffffff;
        border-color: #ffffff;
      }
      .genre-overlay-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(126px, 1fr));
        gap: 6px;
        max-height: 290px;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 6px;
        box-sizing: border-box;
      }
      .genre-overlay-chip {
        background: rgba(30, 41, 59, 0.68);
        border: 1px solid rgba(148, 163, 184, 0.24);
        color: #f1f5f9;
        border-radius: 9px;
        padding: 7px 10px;
        font-size: calc(12px * var(--scale-text));
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-sizing: border-box;
        transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .genre-overlay-chip:hover,
      .genre-overlay-chip.spatial-focus {
        background: rgba(14, 165, 233, 0.22);
        border-color: #38bdf8;
        color: #ffffff;
        transform: none;
      }
      .genre-overlay-chip.active {
        background: linear-gradient(135deg, #0284c7, #2563eb);
        border-color: #7dd3fc;
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(2, 132, 199, 0.42);
      }
      .search-input-wrap {
        flex: 1;
        min-width: 64px;
        height: 100%;
        position: relative;
        display: flex;
        align-items: center;
      }
      .search-input-wrap input {
        width: 100%;
        height: 100%;
        background: transparent;
        border: 0;
        color: #fff;
        padding: 0 28px 0 9px;
        font-size: calc(12.5px * var(--scale-text));
        outline: none;
        text-overflow: ellipsis;
      }
      .search-input-wrap input::placeholder {
        color: rgba(203, 213, 225, 0.76);
        transition: color 0.3s ease;
      }
      .search-input-wrap input.hero-placeholder-active::placeholder {
        color: rgba(226, 232, 240, 0.88);
        font-weight: 500;
      }
      .search-submit-btn {
        height: calc(var(--top-bar-h, 38px) - 6px);
        width: calc(var(--top-bar-h, 38px) - 6px);
        box-sizing: border-box;
        background: transparent;
        border: 0;
        color: #e2e8f0;
        padding: 0;
        border-radius: 7px;
        font-size: calc(12.5px * var(--scale-text));
        cursor: pointer;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
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
        right: 3px;
        top: 50%;
        transform: translateY(-50%);
        z-index: 30;
        width: 21px;
        height: 21px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.25);
        color: #f8fafc;
        cursor: pointer;
        font-size: 10.5px;
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
        border-color: #38bdf8 !important;
        color: #ffffff !important;
        opacity: 1 !important;
        visibility: visible !important;
        transform: translateY(-50%) scale(1.08);
      }

      /* Autocomplete-Vorschlagsliste unter der einzeiligen Top-Leiste */
      .search-autocomplete-box {
        position: absolute;
        left: 14px;
        right: 14px;
        top: calc(100% + 4px);
        max-width: 860px;
        margin: 0 auto;
        box-sizing: border-box;
        background: rgba(11, 15, 25, 0.98);
        backdrop-filter: blur(22px);
        -webkit-backdrop-filter: blur(22px);
        border: 1px solid rgba(56, 189, 248, 0.58);
        border-radius: 12px;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.92), 0 0 22px rgba(14, 165, 233, 0.18);
        max-height: min(410px, 72vh);
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        scroll-padding-top: 12px;
        scroll-padding-bottom: 12px;
        z-index: 95;
        padding: 10px 12px;
        display: none;
        pointer-events: auto;
      }
      .search-autocomplete-box.open { display: block; }
      .ac-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 3px 6px 6px;
        margin-bottom: 4px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.16);
        font-size: calc(10.5px * var(--scale-text));
        color: #94a3b8;
        font-weight: 700;
      }
      .ac-close-mini-btn {
        background: rgba(30, 41, 59, 0.78);
        border: 1px solid rgba(148, 163, 184, 0.3);
        color: #cbd5e1;
        border-radius: 6px;
        padding: 2px 7px;
        font-size: 10.5px;
        font-weight: 800;
        cursor: pointer;
      }
      .ac-close-mini-btn:hover {
        background: rgba(239, 68, 68, 0.25);
        border-color: rgba(248, 113, 113, 0.55);
        color: #ffffff;
      }
      .ac-group-title {
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 800;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        padding: 5px 6px 3px;
      }
      .ac-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        box-sizing: border-box;
        padding: 7px 10px;
        margin: 2px 0;
        border-radius: 8px;
        cursor: pointer;
        font-size: calc(12.5px * var(--scale-text));
        color: #f1f5f9;
        border: 2px solid transparent;
        user-select: none;
        transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
      }
      .ac-item:hover,
      .ac-item.spatial-focus,
      .ac-item.ac-kb-active {
        background: rgba(14, 165, 233, 0.22);
        border-color: #38bdf8 !important;
        outline: none !important;
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.5), 0 2px 10px rgba(14, 165, 233, 0.18) !important;
        transform: none !important;
      }
      .ac-item-left {
        display: flex;
        align-items: center;
        gap: 9px;
        min-width: 0;
        flex: 1;
      }
      .ac-item-thumb {
        width: 26px;
        height: 38px;
        border-radius: 4px;
        object-fit: cover;
        flex-shrink: 0;
        background: rgba(30, 41, 59, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.12);
      }
      .ac-item-icon-box {
        width: 26px;
        height: 32px;
        border-radius: 5px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background: rgba(30, 41, 59, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.22);
        font-size: 13px;
      }
      .ac-item-text {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ac-item-action {
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 800;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.65);
        border: 1px solid rgba(148, 163, 184, 0.22);
        white-space: nowrap;
      }

      /* Kein Ausgrauen der Filmergebnisse mehr bei aktiver Suche (#21) */
      body.search-active-dim #resultsGridContainer {
        opacity: 1;
      }

      /* 100% Vollbild Flixnet Kino-Spotlight: Unbeschnittene Cover/Backdrops am oberen Rand + weicher Top-Fade + Bild-Ausfüllung hinter der Top-Leiste */
      @keyframes heroSlideProgress {
        0% { width: 0%; }
        100% { width: 100%; }
      }
      @keyframes heroScrollChevronBounce {
        0%, 100% { transform: translate3d(0, 0, 0); opacity: 0.78; }
        50% { transform: translate3d(0, 5px, 0); opacity: 1; }
      }
      .hero-curtain-shell {
        display: grid;
        grid-template-rows: 1fr;
        opacity: 1;
        margin-top: 0px;
        margin-bottom: 0px;
        transition:
          grid-template-rows 0.42s cubic-bezier(0.22, 1, 0.36, 1),
          opacity 0.36s cubic-bezier(0.22, 1, 0.36, 1),
          margin-top 0.42s cubic-bezier(0.22, 1, 0.36, 1),
          margin-bottom 0.42s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: grid-template-rows, opacity, margin-top;
      }
      .hero-curtain-shell.is-collapsed {
        grid-template-rows: 0fr;
        opacity: 0;
        margin-top: 0px;
        margin-bottom: 0px;
        pointer-events: none;
      }
      /* Bounce-Lock Fixierung: Bricht bei zu schnellem Wischen jede Zwischen-Dehnung ab und rastet verzögerungsfrei ein */
      .hero-curtain-shell.is-bounce-locked {
        transition:
          grid-template-rows 0.12s cubic-bezier(0.16, 1, 0.3, 1),
          opacity 0.1s cubic-bezier(0.16, 1, 0.3, 1),
          margin-top 0.12s cubic-bezier(0.16, 1, 0.3, 1),
          margin-bottom 0.12s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      .hero-curtain-shell.is-bounce-locked .hero-stage-wrap {
        --hero-rubber-y: 0px !important;
        --hero-scroll-fade: 0 !important;
      }
      .hero-curtain-shell.is-bounce-locked .hero-inner {
        transform: translate3d(0, 0, 0) !important;
      }
      /* Katalog & Filme unterhalb des 100%-Vollbild-Sliders: Gleiten als Vorhang auf scrollY = 0 + Gummiband-Widerstand an der Oberkante */
      #heroBannerSlot + .section {
        --catalog-rubber-y: 0px;
        transform: translate3d(0, var(--catalog-rubber-y, 0px), 0);
        transition: opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1), transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: opacity, transform;
      }
      #heroBannerSlot + .section.is-rubber-dragging {
        transition: opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1), transform 0.05s linear;
      }
      #heroBannerSlot + .section.is-bounce-locked {
        --catalog-rubber-y: 0px !important;
        transform: translate3d(0, 0, 0) !important;
        transition: opacity 0.12s cubic-bezier(0.16, 1, 0.3, 1), transform 0.1s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      body.hero-slider-expanded #heroBannerSlot + .section {
        min-height: calc(100vh - 54px);
        min-height: calc(100svh - 54px);
        box-sizing: border-box;
        padding-bottom: 36px;
      }
      body.hero-slider-expanded:not(.hero-scrolled-past) #heroBannerSlot + .section {
        opacity: 0;
        transform: translate3d(0, 18px, 0);
        pointer-events: none;
        max-height: 0;
        min-height: 0 !important;
        overflow: hidden;
        padding-top: 0 !important;
        padding-bottom: 0 !important;
        margin: 0 !important;
      }
      .hero-curtain-inner {
        overflow: hidden;
        min-height: 0;
      }
      .hero-stage-wrap {
        --ambi-1: 14, 165, 233;
        --ambi-2: 56, 189, 248;
        --ambi-3: 30, 64, 175;
        --hero-scroll-fade: 0;
        --hero-rubber-y: 0px;
        position: relative;
        margin: 0;
        z-index: 1;
        background: var(--bg);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
      }
      /* Flackerfreie atmosphärische Farblicht-Ausfüllung ohne seitliche Scheinwerfer oder helle Blende */
      .hero-ambilight-glow,
      .hero-ambilight-beams {
        display: none !important;
      }
      /* Hardwarebeschleunigtes Scroll-Abdunklungs-Overlay (reines GPU-Opacity statt Live-Blur-Neuberechnung beim Scrollen) */
      .hero-scroll-dim-overlay {
        position: absolute;
        inset: 0;
        z-index: 3;
        pointer-events: none;
        background: var(--bg);
        opacity: var(--hero-scroll-fade, 0);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        will-change: opacity;
      }
      body.is-gesture-dragging,
      body.is-gesture-dragging * {
        user-select: none !important;
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
      }
      .hero,
      .detail-hero-stage,
      .admin-drag-handle,
      #floatingImportStatusWidget {
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
      }
      .hero {
        position: relative;
        z-index: 1;
        margin: 0;
        min-height: calc(100vh - var(--sticky-header-height, 54px));
        min-height: calc(100svh - var(--sticky-header-height, 54px));
        height: calc(100svh - var(--sticky-header-height, 54px));
        box-sizing: border-box;
        border-radius: 0;
        border: none;
        background: transparent;
        box-shadow: none;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 16px 28px 14px;
        overflow: hidden;
        touch-action: pan-x;
      }
      .hero:has(.expandable-desc-box.is-expanded) {
        touch-action: pan-x pan-y;
      }
      /* Scharfes Slider-Bild direkt unterhalb der oberen Suchleiste (top: 0) */
      .hero-backdrop-layer {
        position: absolute;
        inset: 0;
        background-image: var(--hero-bg-landscape, none);
        background-size: cover;
        background-position: center top;
        z-index: 0;
        pointer-events: none;
        opacity: 0;
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transition: opacity 0.45s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: opacity;
      }
      .hero-backdrop-layer.active-layer {
        opacity: 1;
        transform: translate3d(0, 0, 0);
      }
      /* Sanfter Kino-Fade (ohne obere Highlight-Blende, unten nahtlos in den Katalog) */
      .hero-scrim-layer {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background:
          linear-gradient(180deg, rgba(5, 8, 16, 0.22) 0%, rgba(5, 8, 16, 0) 48px),
          linear-gradient(0deg, var(--bg) 0%, rgba(6, 9, 17, 0.92) 9%, rgba(6, 9, 17, 0.44) 24%, rgba(6, 9, 17, 0.08) 42%, rgba(6, 9, 17, 0) 58%),
          linear-gradient(90deg, rgba(4, 7, 15, 0.84) 0%, rgba(4, 7, 15, 0.62) 22%, rgba(4, 7, 15, 0.28) 44%, rgba(4, 7, 15, 0.05) 64%, rgba(4, 7, 15, 0) 78%),
          linear-gradient(90deg, var(--bg) 0%, rgba(5, 8, 16, 0) 3%, rgba(5, 8, 16, 0) 97%, var(--bg) 100%);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
      }
      /* Automatische Kontrast-Unterstützung bei extrem hellen Szenenbildern (wie Schnee/Eis in Interstellar) */
      .hero-stage-wrap.hero-bright-backdrop .hero-scrim-layer {
        background:
          linear-gradient(180deg, rgba(5, 8, 16, 0.28) 0%, rgba(5, 8, 16, 0) 56px),
          linear-gradient(0deg, var(--bg) 0%, rgba(5, 8, 16, 0.95) 11%, rgba(5, 8, 16, 0.52) 27%, rgba(5, 8, 16, 0.12) 45%, rgba(5, 8, 16, 0) 62%),
          linear-gradient(90deg, rgba(4, 7, 15, 0.92) 0%, rgba(4, 7, 15, 0.76) 26%, rgba(4, 7, 15, 0.42) 48%, rgba(4, 7, 15, 0.10) 68%, rgba(4, 7, 15, 0) 84%),
          linear-gradient(90deg, var(--bg) 0%, rgba(5, 8, 16, 0) 3%, rgba(5, 8, 16, 0) 97%, var(--bg) 100%);
      }
      .hero-inner {
        position: relative;
        z-index: 2;
        width: 100%;
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        min-height: clamp(280px, 62svh, 600px);
        gap: 12px;
        transform: translate3d(0, var(--hero-rubber-y, 0px), 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        will-change: transform;
      }
      /* Hochkant-Ansicht (Portrait): Normale 2:3 Filmcover (w780) unbeschnitten direkt unter der Suchleiste */
      @media (orientation: portrait), (max-width: 640px) {
        .hero-backdrop-layer {
          inset: 0 !important;
          background-image: var(--hero-bg-portrait, var(--hero-bg-landscape, none)) !important;
          background-position: center top !important;
          background-size: cover !important;
        }
        .hero-scrim-layer,
        .hero-stage-wrap.hero-bright-backdrop .hero-scrim-layer {
          background:
            linear-gradient(180deg, rgba(4, 7, 15, 0.22) 0%, rgba(4, 7, 15, 0) 48px),
            linear-gradient(0deg, var(--bg) 0%, rgba(5, 8, 16, 0.96) 14%, rgba(5, 8, 16, 0.74) 30%, rgba(5, 8, 16, 0.24) 46%, rgba(5, 8, 16, 0) 64%) !important;
        }
      }
      .hero-widescreen-body {
        display: flex;
        align-items: flex-end;
        justify-content: flex-start;
        margin-top: auto;
        padding: 6px 0 4px;
      }
      .hero-content {
        position: relative;
        z-index: 2;
        min-width: 0;
        max-width: 600px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 4px 0;
        transition: opacity 0.24s ease, transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .hero-content.hero-fade-step {
        opacity: 0.25;
        transform: translate3d(8px, 0, 0);
      }
      /* Flixnet Kicker über dem großen Filmtitel */
      .hero-kicker {
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 800;
        letter-spacing: 2.2px;
        text-transform: uppercase;
        color: rgba(241, 245, 249, 0.92);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 1px;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.95);
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
      .hero-badge.movie { background: linear-gradient(135deg, #0284c7, #1d4ed8); color: #fff; }
      .hero-badge.series { background: linear-gradient(135deg, #4338ca, #6d28d9); color: #fff; }
      .hero-title {
        min-width: 0;
        width: 100%;
        margin-bottom: 2px;
      }
      .hero-title-text {
        font-size: var(--cinema-title-size);
        font-weight: 900;
        line-height: 1.04;
        color: #ffffff;
        letter-spacing: -0.6px;
        text-transform: uppercase;
        text-shadow: 0 4px 20px rgba(0, 0, 0, 0.92), 0 1px 4px rgba(0, 0, 0, 0.9);
      }
      .cinema-clear-logo-wrap {
        position: relative;
        display: flex;
        align-items: flex-end;
        min-height: calc(clamp(44px, 7vh, 78px) * var(--scale-text));
        margin-bottom: 2px;
      }
      .cinema-clear-logo-fallback-title {
        display: none !important;
        width: 100%;
      }
      .cinema-clear-logo-wrap.is-logo-loading .cinema-clear-logo-fallback-title {
        display: flex !important;
      }
      .cinema-clear-logo-wrap.is-logo-ready .cinema-clear-logo-fallback-title {
        display: none !important;
      }
      .cinema-clear-logo {
        display: block;
        max-height: calc(clamp(54px, 8.8vh, 88px) * var(--scale-text));
        max-width: min(420px, 84vw);
        width: auto;
        height: auto;
        object-fit: contain;
        object-position: left bottom;
        filter: drop-shadow(0 6px 22px rgba(0, 0, 0, 0.92)) drop-shadow(0 2px 6px rgba(0, 0, 0, 0.86));
        user-select: none;
        -webkit-user-drag: none;
        transition: opacity 0.18s ease, transform 0.2s ease, filter 0.2s ease;
      }
      .cinema-clear-logo-wrap.is-logo-loading .cinema-clear-logo {
        position: absolute;
        left: 0;
        bottom: 0;
        opacity: 0;
        pointer-events: none;
      }
      .cinema-clear-logo-wrap.is-logo-ready .cinema-clear-logo {
        position: relative;
        opacity: 1;
      }
      .cinema-clear-logo:hover {
        transform: scale(1.015);
        filter: drop-shadow(0 8px 26px rgba(var(--ambi-1, 14, 165, 248), 0.45)) drop-shadow(0 4px 12px rgba(0, 0, 0, 0.92));
      }
      .hero-meta-clean {
        font-size: var(--cinema-meta-size);
        color: #f8fafc;
        margin-bottom: 4px;
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
        align-items: center;
        font-weight: 700;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.95);
      }
      .hero-meta-star {
        color: #ef4444;
        font-weight: 900;
      }
      .hero-meta-sep {
        color: rgba(255, 255, 255, 0.5);
      }
      .hero-meta-year {
        cursor: pointer;
        color: #f8fafc;
      }
      .hero-meta-hd {
        font-size: calc(10px * var(--scale-text));
        font-weight: 900;
        letter-spacing: 0.6px;
        color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, 0.38);
        border-radius: 4px;
        padding: 0px 5px;
        line-height: 1.35;
        background: rgba(15, 23, 42, 0.45);
      }
      .hero-meta-genres {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px;
        color: #cbd5e1;
      }
      .hero-meta-genre {
        cursor: pointer;
        color: #e2e8f0;
      }
      .hero-desc {
        font-size: var(--cinema-desc-size);
        color: rgba(241, 245, 249, 0.92);
        line-height: 1.55;
        margin-bottom: 10px;
        max-width: min(68ch, 100%);
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.96), 0 1px 3px rgba(0, 0, 0, 0.88);
      }
      /* Aufklappbare Kompakt-Scrollbox für Titelbeschreibungen: Offenes Design ohne Dauer-Rand, mit edler Shadowbox & Rand nur bei Hover/Select */
      .expandable-desc-box {
        position: relative;
        border-radius: 9px;
        border: 1px solid transparent;
        padding: 0;
        margin-left: 0;
        cursor: default;
        transition: background 0.2s ease, border-color 0.2s ease, padding 0.2s ease, box-shadow 0.2s ease;
        outline: none !important;
      }
      .expandable-desc-box.is-long-desc,
      .expandable-desc-box.is-expanded {
        cursor: pointer;
      }
      .expandable-desc-box.is-long-desc:hover .desc-expand-hint,
      .expandable-desc-box.is-long-desc.spatial-focus .desc-expand-hint {
        color: #ffffff;
        text-decoration: underline;
      }
      .expandable-desc-scroll {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        word-break: break-word;
      }
      .expandable-desc-box.is-expanded {
        background: rgba(8, 13, 24, 0.86);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border-color: transparent;
        padding: 8px 10px 6px;
        margin-left: 0;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.72);
      }
      .expandable-desc-box.is-expanded .expandable-desc-scroll {
        display: block !important;
        -webkit-line-clamp: unset !important;
        max-height: 132px;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y !important;
        padding-right: 6px;
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: rgba(56, 189, 248, 0.65) rgba(15, 23, 42, 0.45);
      }
      .expandable-desc-box.is-expanded .expandable-desc-scroll::-webkit-scrollbar {
        width: 5px;
      }
      .expandable-desc-box.is-expanded .expandable-desc-scroll::-webkit-scrollbar-track {
        background: rgba(15, 23, 42, 0.45);
        border-radius: 999px;
      }
      .expandable-desc-box.is-expanded .expandable-desc-scroll::-webkit-scrollbar-thumb {
        background: rgba(56, 189, 248, 0.68);
        border-radius: 999px;
      }
      .desc-actions-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 4px;
      }
      .desc-expand-hint {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        color: #7dd3fc;
        letter-spacing: 0.2px;
        user-select: none;
        opacity: 0.92;
      }
      .expandable-desc-box:not(.is-long-desc):not(.is-expanded) .desc-expand-hint {
        display: none;
      }
      .desc-translate-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 9px;
        border-radius: 999px;
        border: 1px solid rgba(56, 189, 248, 0.45);
        background: rgba(15, 23, 42, 0.72);
        color: #bae6fd;
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 800;
        letter-spacing: 0.2px;
        cursor: pointer;
        transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.15s ease;
        user-select: none;
      }
      .desc-translate-btn:hover,
      .desc-translate-btn.spatial-focus {
        background: rgba(14, 165, 233, 0.28);
        border-color: #38bdf8;
        color: #ffffff;
        transform: translateY(-1px);
      }
      .desc-translate-btn.is-translated {
        border-color: rgba(52, 211, 153, 0.55);
        color: #a7f3d0;
      }
      .hero-actions-box {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .hero-btn-play {
        background: #ffffff !important;
        color: #090d16 !important;
        border: 1px solid #ffffff !important;
        border-radius: 8px !important;
        padding: var(--cinema-btn-pad) !important;
        font-size: var(--cinema-btn-font) !important;
        font-weight: 800 !important;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
        transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
      }
      .hero-btn-play:hover,
      .hero-btn-play.spatial-focus {
        background: #f1f5f9 !important;
        transform: translateY(-1px) scale(1.03);
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.55), 0 8px 22px rgba(0, 0, 0, 0.78) !important;
      }
      .hero-btn-info,
      .hero-btn-wishlist {
        background: rgba(30, 41, 59, 0.68) !important;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: #ffffff !important;
        border: 1px solid rgba(255, 255, 255, 0.24) !important;
        border-radius: 8px !important;
        padding: var(--cinema-btn-pad) !important;
        font-size: var(--cinema-btn-font) !important;
        font-weight: 700 !important;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
        transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }
      .hero-btn-info:hover,
      .hero-btn-info.spatial-focus,
      .hero-btn-wishlist:hover,
      .hero-btn-wishlist.spatial-focus {
        background: rgba(51, 65, 85, 0.85) !important;
        border-color: rgba(255, 255, 255, 0.55) !important;
        transform: translateY(-1px) scale(1.03);
      }
      .hero-btn-wishlist.saved {
        background: rgba(16, 185, 129, 0.24) !important;
        border-color: rgba(52, 211, 153, 0.72) !important;
        color: #ecfdf5 !important;
      }
      /* Minimalistische Flixnet-Punktleiste unten mittig + animierter "∨" Scroll-Hinweis-Pfeil */
      .hero-bottom-bar {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        width: 100%;
        padding-top: 2px;
      }
      .hero-scroll-down-hint {
        appearance: none;
        -webkit-appearance: none;
        border: 1px solid rgba(255, 255, 255, 0.22);
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.68) 0%, rgba(30, 41, 59, 0.54) 100%);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: rgba(248, 250, 252, 0.94);
        cursor: pointer;
        padding: 4px 14px 4px;
        border-radius: 999px;
        display: inline-flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 6px;
        opacity: calc(1 - min(1, var(--hero-scroll-fade, 0) * 3.5));
        transition: color 0.18s ease, transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, opacity 0.2s ease;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55);
      }
      .hero-scroll-down-hint:hover,
      .hero-scroll-down-hint.spatial-focus {
        color: #ffffff;
        background: linear-gradient(135deg, rgba(2, 132, 199, 0.72) 0%, rgba(37, 99, 235, 0.72) 100%);
        border-color: rgba(125, 211, 252, 0.8);
        transform: translateY(2px) scale(1.05);
      }
      .hero-scroll-down-label {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.25px;
        white-space: nowrap;
      }
      .hero-scroll-down-chevron {
        width: 16px;
        height: 10px;
        display: block;
        animation: heroScrollChevronBounce 2s ease-in-out infinite;
      }
      .hero-dots-nav {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 4px 10px;
        border-radius: 999px;
        background: radial-gradient(ellipse at center, rgba(4, 7, 15, 0.62) 0%, rgba(4, 7, 15, 0.28) 75%, rgba(4, 7, 15, 0) 100%);
      }
      .hero-circle-arrow {
        width: 30px;
        height: 30px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.26);
        background: rgba(15, 23, 42, 0.52);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: #f8fafc;
        font-size: 15px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
      }
      .hero-circle-arrow:hover,
      .hero-circle-arrow.spatial-focus {
        background: rgba(255, 255, 255, 0.22);
        border-color: #ffffff;
        transform: scale(1.08);
      }
      .hero-dots-nav:has(.spatial-focus) {
        background: rgba(7, 11, 20, 0.78);
        box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.45), 0 6px 18px rgba(0, 0, 0, 0.75);
      }
      .hero-dots-track {
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }
      .hero-dot {
        position: relative;
        width: 6px;
        height: 6px;
        border-radius: 999px;
        padding: 0;
        border: none;
        background: rgba(255, 255, 255, 0.36);
        cursor: pointer;
        overflow: hidden;
        flex-shrink: 0;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.65);
        transition: width 0.28s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s ease, transform 0.2s ease;
      }
      .hero-dot:hover {
        background: rgba(255, 255, 255, 0.72);
        transform: scale(1.18);
      }
      .hero-dot.active {
        width: 24px;
        background: rgba(255, 255, 255, 0.35);
      }
      .hero-dot.spatial-focus {
        outline: 2px solid #38bdf8 !important;
        outline-offset: 3px;
        background: #ffffff !important;
      }
      .hero-thumb-progress {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
      }
      .hero-dot.active .hero-thumb-progress {
        opacity: 1;
      }
      .hero-thumb-progress-fill {
        height: 100%;
        width: 0%;
        border-radius: 999px;
        background: #ffffff;
        box-shadow: 0 0 8px rgba(255, 255, 255, 0.9);
      }
      .hero-dot.active .hero-thumb-progress-fill {
        animation: heroSlideProgress 7s linear forwards;
      }
      .hero:hover .hero-dot.active .hero-thumb-progress-fill,
      .hero:focus-within .hero-dot.active .hero-thumb-progress-fill {
        animation-play-state: paused;
      }
      .hero-hide-btn {
        height: var(--top-bar-h, 38px) !important;
        min-height: var(--top-bar-h, 38px) !important;
        max-height: var(--top-bar-h, 38px) !important;
        box-sizing: border-box !important;
        background: linear-gradient(135deg, rgba(8, 13, 24, 0.86) 0%, rgba(var(--ambi-1), 0.20) 100%);
        color: rgba(248, 250, 252, 0.95);
        border: 1px solid rgba(var(--ambi-2), 0.36);
        border-radius: 10px;
        padding: 0 11px;
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        flex-shrink: 0;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.44), inset 0 1px 0 rgba(255, 255, 255, 0.12);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transition: border-color 0.25s ease, transform 0.15s ease, color 0.15s ease;
      }
      .hero-hide-btn.is-collapsed-state {
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.86) 0%, rgba(var(--ambi-1), 0.28) 100%);
        border-color: rgba(var(--ambi-2), 0.58);
        color: #f8fafc;
      }
      .hero-hide-btn:hover,
      .hero-hide-btn.spatial-focus {
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.92) 0%, rgba(var(--ambi-2), 0.34) 100%);
        color: #ffffff;
        border-color: rgba(255, 255, 255, 0.68);
        transform: translateY(-1px);
      }
      /* 1-Zeilen Spotlight-Strip (Legacy-Fallback) */
      .hero-collapsed-strip {
        margin: 6px 14px 2px;
        padding: 7px 12px;
        border-radius: 12px;
        background: linear-gradient(90deg, rgba(var(--ambi-1), 0.18) 0%, rgba(15, 23, 42, 0.92) 45%, rgba(15, 23, 42, 0.96) 100%);
        border: 1px solid rgba(var(--ambi-2), 0.28);
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
      .hero-collapsed-thumb {
        width: 24px;
        height: 34px;
        border-radius: 5px;
        object-fit: cover;
        border: 1px solid rgba(255, 255, 255, 0.22);
        flex-shrink: 0;
      }
      .hero-collapsed-title {
        font-size: calc(12.5px * var(--scale-text));
        font-weight: 800;
        color: #ffffff;
        min-width: 0;
        flex: 1;
        cursor: pointer;
      }
      .hero-collapsed-title:hover {
        color: #38bdf8;
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
        overflow-x: hidden;
        padding: 6px;
        box-sizing: border-box;
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
        box-sizing: border-box;
        transition: all 0.15s ease;
      }
      .world-portal-card:hover,
      .world-portal-card.spatial-focus {
        border-color: var(--accent-primary);
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(30, 41, 59, 0.95));
        transform: none;
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
      @media (max-width: 760px) {
        header {
          --top-bar-h: 36px;
          padding: 6px 8px;
          gap: 5px;
        }
        /* Mobilansicht: Nur klare Symbole ohne Text (☰, 🎬|📺, 💾, ▴) + exakt gleiche Höhe (36px) */
        header .top-btn-label,
        header .brand-text-wrap {
          display: none !important;
        }
        header #sidebarToggleBtn,
        header #navBtnWishlist,
        header .hero-hide-btn {
          width: var(--top-bar-h) !important;
          min-width: var(--top-bar-h) !important;
          padding: 0 !important;
          font-size: 14px !important;
          transition: width 0.24s cubic-bezier(0.22, 1, 0.36, 1), min-width 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease, transform 0.2s ease;
        }
        header #headerBrandLogo {
          width: var(--top-bar-h);
          min-width: var(--top-bar-h);
          padding: 0;
          transition: width 0.24s cubic-bezier(0.22, 1, 0.36, 1), min-width 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
        }
        header #mediaModeBanner {
          transition: max-width 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease, padding 0.2s ease;
        }
        .media-mode-tab {
          padding: 0 7px;
          font-size: 13px;
        }
        /* Kompaktes Such-Pill im mobilen Ruhezustand: Nur Genre-Emoji ohne abgeschnittenen Text */
        header:not(.mobile-search-expanded) .search-genre-trigger-label,
        header:not(.mobile-search-expanded) .search-genre-caret,
        header:not(.mobile-search-expanded) .search-genre-quick-reset {
          display: none !important;
        }
        header:not(.mobile-search-expanded) .search-genre-trigger-btn {
          width: 32px;
          min-width: 32px;
          max-width: 32px;
          padding: 0;
          justify-content: center;
        }
        header:not(.mobile-search-expanded) .search-genre-trigger-btn.has-active-genre {
          background: rgba(14, 165, 233, 0.25);
          box-shadow: inset 0 0 0 1.5px rgba(56, 189, 248, 0.78);
        }
        header:not(.mobile-search-expanded) .search-input-wrap input {
          padding: 0 24px 0 7px;
          font-size: 12px;
        }
        /* 100% Vollbreiten-Expansion der mobilen Suchleiste bei Klick/Fokus */
        header.mobile-search-expanded {
          gap: 0 !important;
        }
        header.mobile-search-expanded #sidebarToggleBtn,
        header.mobile-search-expanded #headerBrandLogo,
        header.mobile-search-expanded #mediaModeBanner,
        header.mobile-search-expanded #navBtnWishlist,
        header.mobile-search-expanded #heroHideBtn {
          width: 0 !important;
          min-width: 0 !important;
          max-width: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
          border-width: 0 !important;
          opacity: 0 !important;
          pointer-events: none !important;
          overflow: hidden !important;
        }
        header.mobile-search-expanded .search-bar {
          flex: 1 1 100% !important;
          width: 100% !important;
          border-color: rgba(var(--ambi-2), 0.78);
        }
        header.mobile-search-expanded .mobile-search-collapse-btn {
          display: inline-flex !important;
        }
        header.mobile-search-expanded .search-genre-trigger-btn {
          border-radius: 0;
          max-width: 96px;
          padding: 0 6px;
        }
        .search-autocomplete-box,
        .search-genre-dropdown-overlay {
          left: 8px;
          right: 8px;
        }
        .genre-overlay-grid {
          grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
        }
        .hero-curtain-shell { margin-top: -48px; margin-bottom: 0px; }
        .hero-stage-wrap { margin: 0; }
        .hero { min-height: 100vh; min-height: 100dvh; height: 100dvh; padding: 58px 14px 10px; border-radius: 0; }
        .hero-inner { min-height: clamp(320px, 64dvh, 540px); gap: 8px; }
        .hero-title-text { font-size: clamp(24px, 7vw, 34px); }
        .hero-desc { font-size: 12.5px; margin-bottom: 8px; }
        .hero-desc:not(.is-expanded) .expandable-desc-scroll { -webkit-line-clamp: 2; }
        .hero-desc.is-expanded .expandable-desc-scroll { max-height: 112px; }
        .hero-btn-play, .hero-btn-info, .hero-btn-wishlist { padding: 8px 13px !important; font-size: 12px !important; }
      }
      @media (max-width: 480px) {
        header #headerBrandLogo {
          display: none !important;
        }
      }

      .section { position: relative; z-index: 5; padding: 8px 14px; }
      .section-title { font-size: calc(13.5px * var(--scale-text)); font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; color: #e5e5e5; }
      .mode-bar { display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 0; align-items: center; }

      /* Flache, edle Glas-Filterleiste im Apple TV+ / Kino-Look */
      .floating-filter-bar {
        background: linear-gradient(135deg, rgba(10, 15, 28, 0.62) 0%, rgba(15, 23, 42, 0.48) 100%);
        backdrop-filter: blur(18px) saturate(1.3);
        -webkit-backdrop-filter: blur(18px) saturate(1.3);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 6px 10px;
        margin: 4px 0 12px;
        box-shadow: 0 8px 24px rgba(2, 6, 23, 0.28);
      }
      .ff-controls-grid {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
      }
      .ff-controls-grid > .btn {
        height: calc(33px * var(--scale-menu));
        box-sizing: border-box;
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.11);
        color: #e2e8f0;
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 700;
        padding: 0 11px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .ff-controls-grid > .btn:hover,
      .ff-controls-grid > .btn.spatial-focus {
        background: rgba(14, 165, 233, 0.18);
        border-color: rgba(56, 189, 248, 0.65);
        color: #ffffff;
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
        background: rgba(255,255,255,0.06);
        color: #e2e8f0;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        padding: calc(5px * var(--scale-menu)) calc(9px * var(--scale-menu));
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.14s ease;
      }
      .ff-tab-btn:hover { background: rgba(14, 165, 233, 0.14); border-color: rgba(56, 189, 248, 0.35); }
      .ff-tab-btn.open { background: rgba(2, 132, 199, 0.28); border-color: #38bdf8; color: #fff; box-shadow: 0 3px 12px rgba(2, 132, 199, 0.25); }
      .ff-tab-btn.has-inc { border-color: var(--inc-border); background: var(--inc-bg); color: var(--inc-text); }
      .ff-tab-btn.has-exc { border-color: var(--exc-border); }

      /* Kompakte einheitliche 33px Glas-Dropdowns für Modus, Anbieter & Sortierung */
      .sort-select,
      .mode-filter-select,
      .new-filter-select {
        height: calc(33px * var(--scale-menu));
        box-sizing: border-box;
        background-color: rgba(255, 255, 255, 0.05);
        color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 9px;
        padding: 0 calc(10px * var(--scale-menu));
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 700;
        cursor: pointer;
        outline: none;
        color-scheme: dark;
        transition: border-color 0.14s ease, background-color 0.14s ease, color 0.14s ease;
      }
      .sort-select option,
      .mode-filter-select option,
      .new-filter-select option {
        background-color: #0f172a;
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
        border-color: rgba(56, 189, 248, 0.58);
        background-color: rgba(14, 165, 233, 0.14);
        color: #ffffff;
      }

      /* Direkt-Auswahl-Grid in der Sidebar (Farbkennung für Aktiviert vs. Gesperrt, 100% Zoom-fest) */
      .direct-filter-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(165px * var(--scale-menu))), 1fr));
        gap: 6px;
        margin-top: 6px;
      }
      .direct-filter-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 9px;
        padding: calc(5.5px * var(--scale-menu)) calc(8px * var(--scale-menu));
        transition: all 0.14s ease;
      }
      .direct-filter-card.state-inc { background: var(--inc-bg); border-color: var(--inc-border); }
      .direct-filter-card.state-exc { background: var(--exc-bg); border-color: var(--exc-border); }
      .df-label {
        flex: 1;
        min-width: 0;
        font-size: calc(12px * var(--scale-text));
        font-weight: 700;
        color: #f1f5f9;
        padding: 2px 3px;
        line-height: 1.3;
        cursor: default;
        user-select: none;
        pointer-events: none;
        white-space: normal;
        word-break: break-word;
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

      /* Ruhige 2:3 Katalog-Filmcover im Apple TV+ Stil mit integriertem unteren Farbverlauf & Hover-Glas-Aktionen */
      .carousel {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(calc(132px * var(--scale-cover)), 1fr));
        gap: calc(12px * var(--scale-cover));
        align-items: stretch;
      }
      .card {
        background: #0f172a;
        border-radius: 12px;
        aspect-ratio: 2 / 3;
        overflow: hidden;
        cursor: pointer;
        transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s ease, box-shadow 0.2s ease;
        border: 1px solid rgba(255, 255, 255, 0.10);
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.48);
        display: block;
        position: relative;
        content-visibility: auto;
        contain-intrinsic-size: 132px 198px;
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
      .card:hover,
      .card.spatial-focus {
        border-color: #38bdf8 !important;
        outline: 2px solid #38bdf8 !important;
        outline-offset: -2px !important;
        transform: translateY(-2px);
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.55), 0 14px 28px rgba(0, 0, 0, 0.75) !important;
      }
      .card:active { transform: scale(0.98); }
      .card-poster-wrap {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: linear-gradient(110deg, #0f172a 25%, #19253d 48%, #0f172a 72%);
        background-size: 200% 100%;
        touch-action: pan-y;
      }
      .card-poster-wrap img,
      .card > img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        background: #0f172a;
        display: block;
        pointer-events: none;
        -webkit-user-drag: none;
        -webkit-touch-callout: none;
        user-select: none;
        transition: opacity 0.24s ease, transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .card:hover .card-poster-wrap img,
      .card.spatial-focus .card-poster-wrap img {
        transform: scale(1.045);
      }
      .card-poster-wrap img.lazy-cover-img.is-loading {
        opacity: 0.18;
      }
      .card-poster-wrap img.lazy-cover-img.is-loaded {
        opacity: 1;
      }
      .card-top-left-stack {
        position: absolute;
        top: 7px;
        left: 7px;
        z-index: 4;
        display: flex;
        align-items: center;
        gap: 5px;
        pointer-events: none;
      }
      .card-rank-badge {
        font-size: calc(10px * var(--scale-text));
        font-weight: 900;
        padding: 2px 7px;
        border-radius: 6px;
        background: linear-gradient(135deg, #0284c7, #4338ca);
        color: #fff;
        box-shadow: 0 3px 10px rgba(0,0,0,0.85);
        border: 1px solid rgba(255,255,255,0.32);
        letter-spacing: 0.2px;
      }
      .card-type-badge {
        font-size: calc(9px * var(--scale-text));
        font-weight: 800;
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(10, 14, 24, 0.88);
        backdrop-filter: blur(8px);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.18);
      }
      /* Minimaler grüner VIP-Punkt oben links auf dem Cover */
      .card-vip-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #10b981;
        border: 1.5px solid #ffffff;
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.95), 0 2px 5px rgba(0, 0, 0, 0.85);
        display: inline-block;
        flex-shrink: 0;
        pointer-events: auto;
      }
      /* Lesezeichen-Button oben rechts: im Ruhezustand ruhig ausgeblendet (außer wenn gespeichert), bei Hover/Fokus edel sichtbar */
      .card-quick-save {
        position: absolute;
        top: 7px;
        right: 7px;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: rgba(10, 15, 28, 0.78);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.22);
        color: #fff;
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 5;
        opacity: 0;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55);
        transition: transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), background 0.14s, opacity 0.16s ease, border-color 0.14s;
      }
      @media (hover: none), (pointer: coarse) {
        .card-quick-save {
          opacity: 0.88;
          pointer-events: auto;
          width: 28px;
          height: 28px;
          font-size: 12px;
        }
        .card-quick-info,
        .card-quick-trailer {
          display: none !important;
        }
      }
      .card.long-press-active {
        transform: scale(0.96) !important;
        transition: transform 0.12s ease;
      }
      .card-quick-save.saved,
      .card:hover .card-quick-save,
      .card:focus-within .card-quick-save,
      .card.spatial-focus .card-quick-save,
      .card.card-subnav-active .card-quick-save {
        opacity: 1;
        pointer-events: auto;
      }
      .card.card-saved {
        border-color: rgba(16, 185, 129, 0.65) !important;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(16, 185, 129, 0.35);
      }
      .card-quick-save:hover,
      .card-quick-save.spatial-focus {
        opacity: 1;
        pointer-events: auto;
        transform: scale(1.12);
        background: #0ea5e9;
        color: #04101d;
        border-color: #fff;
        box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.55), 0 4px 12px rgba(0,0,0,0.85);
      }
      .card-quick-save.saved {
        background: linear-gradient(135deg, #10b981, #059669);
        border-color: #6ee7b7;
        color: #ffffff;
        font-weight: 900;
        box-shadow: 0 0 12px rgba(16, 185, 129, 0.55), 0 2px 8px rgba(0, 0, 0, 0.65);
      }
      .card-quick-save.saved.spatial-focus {
        border-color: #fff;
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.75), 0 4px 12px rgba(0,0,0,0.85);
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
      /* Hover-Glas-Aktionen (▶ Trailer & ℹ️ Details) schweben über dem unteren Titel-Verlauf */
      .card-quick-trailer {
        position: absolute;
        bottom: 52px;
        right: 6px;
        z-index: 5;
        background: rgba(10, 15, 28, 0.88);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: #fff;
        border: 1px solid rgba(56, 189, 248, 0.65);
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
        transform: translateY(4px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.75);
        transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1), transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), background 0.14s, border-color 0.14s, box-shadow 0.14s;
      }
      .card:hover .card-quick-trailer,
      .card:focus-within .card-quick-trailer,
      .card.spatial-focus .card-quick-trailer,
      .card.card-subnav-active .card-quick-trailer {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
      .card-quick-trailer:hover,
      .card-quick-trailer.spatial-focus {
        background: var(--red);
        border-color: #fff;
        transform: translateY(0) scale(1.06);
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.55), 0 4px 14px rgba(0,0,0,0.85);
      }
      .card-quick-info {
        position: absolute;
        bottom: 52px;
        left: 6px;
        z-index: 5;
        background: rgba(10, 15, 28, 0.88);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
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
        transform: translateY(4px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.75);
        transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1), transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), background 0.14s, border-color 0.14s, box-shadow 0.14s;
      }
      /* ℹ️ Details auf dem Cover im normalen Maus-Hover ausgeblendet (da Klick auf Karte bereits Details öffnet), nur im TV/Gamepad-Subnav-Modus sichtbar */
      .card.card-subnav-active .card-quick-info {
        display: inline-flex !important;
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
      .card-quick-info:hover,
      .card-quick-info.spatial-focus {
        background: var(--purple);
        border-color: #fff;
        color: #fff;
        transform: translateY(0) scale(1.06);
        box-shadow: 0 0 0 3px rgba(91, 70, 245, 0.6), 0 4px 14px rgba(0,0,0,0.85);
      }
      .card.card-subnav-active {
        border-color: var(--accent-primary) !important;
        box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.45), 0 12px 28px rgba(0,0,0,0.75);
      }
      /* Aufgeräumte Detail-Modal Nutzer-Aktionsleiste & eigene kompakte Admin-Leiste */
      .modal-actions-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 12px;
        margin-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .modal-actions-primary {
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
        align-items: center;
      }
      .modal-actions-tools {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
        align-items: center;
      }
      .btn-action-glass {
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(255, 255, 255, 0.16);
        color: #f8fafc;
        font-weight: 700;
        padding: 6px 12px;
        border-radius: 8px;
        font-size: calc(12px * var(--scale-text));
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.15s ease;
        text-decoration: none;
      }
      .btn-action-glass:hover,
      .btn-action-glass.spatial-focus {
        background: rgba(255, 255, 255, 0.14);
        border-color: rgba(255, 255, 255, 0.32);
        color: #ffffff;
      }
      .btn-action-glass.saved,
      .btn-action-glass.green {
        background: rgba(16, 185, 129, 0.16);
        border-color: rgba(16, 185, 129, 0.45);
        color: #6ee7b7;
      }
      .btn-tool-quiet {
        background: rgba(255, 255, 255, 0.035);
        border: 1px solid rgba(255, 255, 255, 0.09);
        color: #94a3b8;
        font-weight: 600;
        padding: 5px 9px;
        border-radius: 7px;
        font-size: calc(11.5px * var(--scale-text));
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.14s ease;
      }
      .btn-tool-quiet:hover,
      .btn-tool-quiet.spatial-focus {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.24);
        color: #f8fafc;
      }
      /* Edle einzeilige Metadaten- & Genre-Leisten im Detail-Header (Apple TV+ / Netflix Stil) */
      .modal-meta-inline {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 7px;
        font-size: calc(12.5px * var(--scale-text));
        font-weight: 600;
        color: #cbd5e1;
        line-height: 1.4;
      }
      .modal-meta-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .modal-meta-item.clickable {
        cursor: pointer;
        transition: color 0.14s ease;
      }
      .modal-meta-item.clickable:hover,
      .modal-meta-item.clickable.spatial-focus {
        color: #ffffff;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .modal-meta-rating {
        color: #fbbf24;
        font-weight: 800;
      }
      .modal-meta-fsk {
        padding: 1px 6px;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.06);
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        color: #e2e8f0;
        letter-spacing: 0.2px;
      }
      .modal-meta-dot {
        color: rgba(148, 163, 184, 0.55);
        font-weight: 900;
        user-select: none;
      }
      .modal-genre-inline {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-size: calc(12px * var(--scale-text));
        color: #94a3b8;
      }
      .modal-genre-link {
        color: #e2e8f0;
        font-weight: 600;
        cursor: pointer;
        transition: color 0.14s ease;
      }
      .modal-genre-link:hover,
      .modal-genre-link.spatial-focus {
        color: #ffffff;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      /* Kompakter integrierter Versandziel-Umschalter (in Staffel-Zeile oder Film-Header) */
      .delivery-inline-wrap {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .delivery-inline-pills {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 3px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.1);
        flex-wrap: wrap;
      }
      .delivery-inline-label {
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        color: #94a3b8;
        padding: 0 6px 0 5px;
        white-space: nowrap;
      }
      .delivery-pill-btn {
        background: transparent;
        border: 1px solid transparent;
        color: #94a3b8;
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.14s ease;
        white-space: nowrap;
      }
      .delivery-pill-btn:hover {
        color: #f8fafc;
        background: rgba(255, 255, 255, 0.06);
      }
      .delivery-pill-btn.active {
        background: rgba(255, 255, 255, 0.14);
        border-color: rgba(255, 255, 255, 0.22);
        color: #ffffff;
      }
      .delivery-config-drawer {
        padding: 10px 12px;
        border-radius: 9px;
        background: rgba(15, 23, 42, 0.78);
        border: 1px solid rgba(255, 255, 255, 0.12);
        margin-top: 4px;
        margin-bottom: 6px;
      }
      .season-toolbar-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      /* Kompakte Release-Box für mehrteilige Filme (CD 1 bis CD N nebeneinander) */
      .release-box-card {
        display: flex;
        flex-direction: column;
        gap: 9px;
        padding: 11px 13px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.09);
        transition: border-color 0.16s ease, background 0.16s ease;
      }
      .release-box-card:hover {
        border-color: rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.045);
      }
      .release-box-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        padding-bottom: 7px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      .release-cd-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        align-items: center;
      }
      .cd-part-chip-wrap {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .btn-cd-part {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 8px;
        background: rgba(14, 165, 233, 0.16);
        border: 1px solid rgba(56, 189, 248, 0.45);
        color: #ffffff;
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        transition: all 0.15s ease;
        font-variant-numeric: tabular-nums;
      }
      .btn-cd-part:hover,
      .btn-cd-part.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #ffffff;
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(14, 165, 233, 0.35);
      }
      .btn-cd-part .cd-size-sub {
        font-size: calc(11px * var(--scale-text));
        font-weight: 600;
        color: rgba(255, 255, 255, 0.78);
      }
      body[data-theme="light"] .release-box-card {
        background: #f8fafc;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .release-box-header {
        border-bottom-color: #e2e8f0;
      }
      body[data-theme="light"] .btn-cd-part {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0c4a6e;
      }
      body[data-theme="light"] .btn-cd-part .cd-size-sub {
        color: #0369a1;
      }
      body[data-theme="light"] .btn-cd-part:hover {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #0284c7;
        color: #ffffff;
      }
      body[data-theme="light"] .btn-cd-part:hover .cd-size-sub {
        color: rgba(255, 255, 255, 0.85);
      }
      body[data-theme="light"] .btn-action-glass {
        background: #f1f5f9;
        border-color: #cbd5e1;
        color: #0f172a;
      }
      body[data-theme="light"] .btn-action-glass:hover {
        background: #e2e8f0;
      }
      body[data-theme="light"] .btn-tool-quiet {
        background: #f8fafc;
        border-color: #cbd5e1;
        color: #475569;
      }
      body[data-theme="light"] .btn-tool-quiet:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
      body[data-theme="light"] .delivery-inline-pills {
        background: #f1f5f9;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .delivery-pill-btn {
        color: #475569;
      }
      body[data-theme="light"] .delivery-pill-btn.active {
        background: #0f172a;
        color: #ffffff;
      }
      body[data-theme="light"] .delivery-config-drawer {
        background: #f8fafc;
        border-color: #cbd5e1;
      }
      .card-body {
        position: absolute;
        inset: auto 0 0 0;
        z-index: 2;
        padding: 32px 10px 8px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 2px;
        background: linear-gradient(180deg, rgba(4, 7, 16, 0) 0%, rgba(4, 7, 16, 0.84) 48%, rgba(4, 7, 16, 0.98) 100%);
        pointer-events: none;
      }
      .card-title {
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        color: #ffffff;
        line-height: 1.24;
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: normal;
        word-break: break-word;
        overflow-wrap: anywhere;
        position: relative;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
      }
      .card-title-text {
        display: inline;
      }
      @keyframes cardTitleMarquee {
        0%, 14% { transform: translateX(0); }
        82%, 94% { transform: translateX(var(--marquee-dist, -45%)); }
        100% { transform: translateX(0); }
      }
      .card-title.is-marquee-overflow {
        display: flex !important;
        align-items: center;
        -webkit-line-clamp: unset !important;
        white-space: nowrap !important;
        overflow: hidden !important;
      }
      .card-title.is-marquee-overflow .card-title-text {
        display: inline-block;
        white-space: nowrap;
        padding-right: 18px;
        will-change: transform;
        animation: cardTitleMarquee var(--marquee-dur, 5.5s) ease-in-out infinite;
      }
      .card-sub {
        font-size: calc(10.5px * var(--scale-text));
        color: #cbd5e1;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 1px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
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
        aspect-ratio: 2 / 3;
        border-radius: 12px;
        overflow: hidden;
        background: #0f172a;
        border: 1px solid rgba(148, 163, 184, 0.12);
        position: relative;
        pointer-events: none;
      }
      .skeleton-poster {
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, rgba(15, 23, 42, 0.9) 25%, rgba(30, 41, 59, 0.95) 50%, rgba(15, 23, 42, 0.9) 75%);
        background-size: 200% 100%;
        animation: skeletonShimmer 1.35s infinite linear;
      }
      .skeleton-line {
        display: none;
      }

      /* Seiten-Anzeige (Seite X von Y) & Direkt-Seitenwahl (#17) */
      .pagination-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 16px;
        padding: 12px 10px;
        border-radius: 12px;
        background: var(--surface);
        border: 1px solid rgba(148, 163, 184, 0.16);
        box-shadow: 0 6px 20px rgba(2, 6, 23, 0.35);
      }
      .page-counter-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 5px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(var(--ambi-2), 0.34);
        color: var(--text);
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        transition: all 0.16s ease;
      }
      .page-counter-pill:hover,
      .page-counter-pill.spatial-focus {
        background: rgba(14, 165, 233, 0.22);
        border-color: #38bdf8;
        color: #ffffff;
        transform: translateY(-1px);
      }
      /* Smarter Floating-Seitenindikator unten rechts (öffnen per Touch, Maus oder TV-Remote) */
      #smartPageIndicatorBtn {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 74;
        display: none;
        align-items: center;
        gap: 7px;
        padding: 8px 14px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(8, 13, 24, 0.94) 0%, rgba(var(--ambi-1), 0.24) 100%);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(var(--ambi-2), 0.52);
        color: #f8fafc;
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.68), 0 0 18px rgba(var(--ambi-1), 0.16);
        opacity: 0.82;
        transform: translate3d(0, 0, 0);
        transition: opacity 0.22s ease, transform 0.18s ease, border-color 0.2s ease, box-shadow 0.2s ease;
      }
      #smartPageIndicatorBtn.is-scrolling-active,
      #smartPageIndicatorBtn:hover,
      #smartPageIndicatorBtn.spatial-focus {
        opacity: 1;
        border-color: #38bdf8;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.82), 0 0 0 2px rgba(56, 189, 248, 0.45);
        transform: translate3d(0, -2px, 0);
      }
      /* TV- & Touch-Seiten-Schnellwahl-Popup */
      .page-jump-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 220;
        background: rgba(2, 6, 23, 0.82);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        animation: fadeIn 0.15s ease;
      }
      .page-jump-modal-box {
        width: min(94vw, 460px);
        background: linear-gradient(165deg, rgba(11, 17, 30, 0.98) 0%, rgba(15, 23, 42, 0.96) 100%);
        border: 1px solid rgba(var(--ambi-2), 0.55);
        border-radius: 16px;
        padding: 18px;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.9);
        display: flex;
        flex-direction: column;
        gap: 14px;
        color: #f8fafc;
        font-variant-numeric: tabular-nums;
      }
      .page-step-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .page-step-btn {
        height: 40px;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.26);
        background: rgba(30, 41, 59, 0.78);
        color: #f1f5f9;
        font-size: calc(12.5px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.14s ease;
      }
      .page-step-btn:hover,
      .page-step-btn.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #2563eb);
        border-color: #7dd3fc;
        color: #ffffff;
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(2, 132, 199, 0.45);
      }
      .page-jump-slider {
        width: 100%;
        height: 8px;
        accent-color: #0ea5e9;
        cursor: pointer;
      }
      .page-jump-number-inp {
        width: 92px;
        height: 38px;
        border-radius: 9px;
        border: 1px solid rgba(56, 189, 248, 0.45);
        background: rgba(6, 9, 17, 0.9);
        color: #ffffff;
        font-size: 15px;
        font-weight: 900;
        text-align: center;
        font-variant-numeric: tabular-nums;
        outline: none;
      }
      .page-jump-number-inp:focus,
      .page-jump-number-inp.spatial-focus {
        border-color: #38bdf8;
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.35);
      }
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
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #7dd3fc;
        color: #fff;
        box-shadow: 0 4px 12px rgba(2, 132, 199, 0.38);
      }

      /* Alphabet-Schnellsprung A-Z in der Merkliste (#20) */
      .wl-az-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        overflow-x: auto;
        padding: 6px 6px 8px;
        margin-bottom: 8px;
        scrollbar-width: thin;
        box-sizing: border-box;
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
        background: rgba(14, 165, 233, 0.25);
        border-color: var(--red);
        color: #fff;
      }
      .wl-az-btn.active {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #7dd3fc;
        color: #fff;
      }

      /* Zuletzt angesehene Titel (Quick-Resume Leiste) mit Einzel-Löschbutton (✕) & Komplett-Leeren (🗑️) */
      .recent-strip {
        display: flex;
        align-items: center;
        gap: 8px;
        overflow-x: auto;
        padding: 6px 6px 8px;
        scrollbar-width: thin;
        box-sizing: border-box;
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
        border-color: var(--accent-primary);
        background: rgba(14, 165, 233, 0.14);
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
        background: var(--danger);
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

      /* Premium Fullscreen App Detail-View im Flixnet- & Kino-Slider-Design (1:1 Größe mit Slider + Unified Topbar) */
      body.modal-open-pause-hero .hero-dot.active .hero-thumb-progress-fill {
        animation-play-state: paused !important;
      }
      .modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
        background: var(--bg);
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
        touch-action: pan-y;
        padding: var(--sticky-header-height, 54px) 0 0 0;
        scroll-padding-top: calc(var(--sticky-header-height, 54px) + 18px);
        scroll-padding-bottom: 32px;
        animation: fadeIn 0.18s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .modal {
        background: var(--bg);
        border-radius: 0;
        max-width: 100%;
        width: 100%;
        min-height: calc(100vh - var(--sticky-header-height, 54px));
        min-height: calc(100dvh - var(--sticky-header-height, 54px));
        margin: 0;
        overflow: visible;
        border: 0;
        box-shadow: none;
        display: flex;
        flex-direction: column;
      }
      /* Natürliche Kicker-Zeile direkt über dem Filmtitel (ersetzt die alte künstliche Top-Extraleiste) */
      .detail-kicker-row {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
        margin-bottom: 2px;
      }
      .detail-active-filter-chip.muted {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 600;
        color: rgba(148, 163, 184, 0.78);
        background: rgba(15, 23, 42, 0.52);
        border: 1px solid rgba(148, 163, 184, 0.22);
        padding: 2px 8px;
        border-radius: 999px;
        filter: grayscale(0.45);
        user-select: none;
      }
      .return-last-detail-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(99, 102, 241, 0.22));
        border: 1px solid rgba(56, 189, 248, 0.58);
        color: #f0f9ff;
        padding: calc(3px * var(--scale-menu)) calc(10px * var(--scale-menu));
        border-radius: 999px;
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(2, 132, 199, 0.25);
        transition: all 0.16s ease;
      }
      .return-last-detail-chip:hover,
      .return-last-detail-chip.spatial-focus {
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.36), rgba(99, 102, 241, 0.36));
        border-color: #38bdf8;
        color: #ffffff;
        transform: translateY(-1px);
      }
      /* Sticky Mini-Header beim Runterscrollen auf der Detailseite */
      .detail-sticky-mini-header {
        position: fixed;
        top: var(--sticky-header-height, 54px);
        left: 0;
        right: 0;
        z-index: 115;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 28px;
        background: linear-gradient(90deg, rgba(6, 9, 18, 0.92) 0%, rgba(var(--ambi-1, 14, 165, 233), 0.18) 55%, rgba(6, 9, 18, 0.94) 100%);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border-bottom: 1px solid rgba(var(--ambi-1, 56, 189, 248), 0.28);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.65);
        opacity: 0;
        transform: translateY(-12px);
        pointer-events: none;
        transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .detail-sticky-mini-header.is-visible {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .detail-sticky-mini-left {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .detail-sticky-mini-title {
        font-size: calc(14px * var(--scale-text));
        font-weight: 900;
        color: #ffffff;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: min(460px, 52vw);
      }
      .detail-sticky-mini-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      /* 1:1 Identische Detail-Hero-Stage wie im Haupt-Slider (.hero) – Zero Jump */
      .detail-hero-stage {
        position: relative;
        z-index: 1;
        width: 100%;
        margin: 0;
        min-height: calc(100vh - var(--sticky-header-height, 54px));
        min-height: calc(100svh - var(--sticky-header-height, 54px));
        height: calc(100svh - var(--sticky-header-height, 54px));
        box-sizing: border-box;
        padding: 16px 28px 14px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        overflow: hidden;
        isolation: isolate;
        touch-action: pan-x pan-y;
        cursor: pointer;
        transition: opacity 0.18s ease;
      }
      #detailTitleBoxEl,
      #detailTitleBoxEl * {
        pointer-events: none !important;
        cursor: pointer !important;
      }
      .detail-hero-stage:has(.expandable-desc-box.is-expanded) {
        touch-action: pan-x pan-y;
      }
      .detail-stage-transitioning .detail-hero-stage,
      .detail-stage-transitioning .detail-content-body {
        opacity: 0.28;
        transform: translateX(var(--adj-slide-dir, 14px));
        transition: opacity 0.16s ease, transform 0.16s ease;
      }
      .detail-morph-enter .detail-content-body {
        animation: detailBodyRevealIn 0.28s cubic-bezier(0.22, 1, 0.36, 1);
      }
      @keyframes detailBodyRevealIn {
        from { opacity: 0; transform: translateY(14px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .detail-backdrop-layer {
        position: absolute;
        inset: 0;
        z-index: 0;
        background-image: var(--hero-bg-landscape);
        background-size: cover;
        background-position: center top;
        background-repeat: no-repeat;
        pointer-events: none;
        transform: translate3d(0, var(--detail-parallax-y, 0px), 0) scale(var(--detail-parallax-scale, 1));
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        will-change: transform;
      }
      @media (max-width: 640px), (orientation: portrait) {
        .detail-backdrop-layer {
          background-image: var(--hero-bg-portrait, var(--hero-bg-landscape)) !important;
          background-position: center top !important;
          background-size: cover !important;
        }
      }
      @keyframes detailKenBurnsZoom {
        0% {
          transform: translate3d(0, var(--detail-parallax-y, 0px), 0) scale(1);
        }
        100% {
          transform: translate3d(-1.2%, calc(var(--detail-parallax-y, 0px) - 0.8%), 0) scale(1.085);
        }
      }
      .detail-backdrop-layer.is-ken-burns-active {
        animation: detailKenBurnsZoom 22s ease-in-out infinite alternate;
      }
      /* Lautloser Hintergrund-Video-Teaser & Nahtloser Vordergrund-Kino-Modus */
      .detail-bg-video-layer {
        position: absolute;
        inset: 0;
        z-index: 0;
        overflow: hidden;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.72s cubic-bezier(0.22, 1, 0.36, 1), filter 0.38s ease;
      }
      .detail-bg-video-layer.is-concealing {
        opacity: 0 !important;
        transition: opacity 0.36s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }
      .detail-bg-video-layer.is-playing {
        opacity: 1;
      }
      .detail-bg-video-frame {
        position: absolute;
        top: 50%;
        left: 50%;
        width: max(100vw, 177.78vh);
        height: max(56.25vw, 100vh);
        transform: translate(-50%, -50%) scale(1.18);
        clip-path: inset(7.2% 0 7.2% 0);
        -webkit-clip-path: inset(7.2% 0 7.2% 0);
        border: 0;
        pointer-events: none;
        transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1), width 0.32s ease, height 0.32s ease, clip-path 0.32s ease;
      }
      .detail-ambilight-glow {
        position: absolute;
        inset: -10%;
        z-index: 1;
        pointer-events: none;
        background:
          radial-gradient(58% 52% at 74% 26%, rgba(var(--ambi-1, 14, 165, 233), 0.16) 0%, transparent 72%),
          radial-gradient(50% 46% at 22% 72%, rgba(var(--ambi-2, 99, 102, 241), 0.14) 0%, transparent 74%);
        mix-blend-mode: screen;
        opacity: 0.78;
        transition: opacity 0.36s ease;
      }
      /* 1:1 Exakt derselbe kristallklare Scrim-Verlauf wie im Haupt-Slider (.hero-scrim-layer) */
      .detail-scrim-layer {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background:
          linear-gradient(180deg, rgba(5, 8, 16, 0.22) 0%, rgba(5, 8, 16, 0) 48px),
          linear-gradient(0deg, var(--bg) 0%, rgba(6, 9, 17, 0.92) 9%, rgba(6, 9, 17, 0.44) 24%, rgba(6, 9, 17, 0.08) 42%, rgba(6, 9, 17, 0) 58%),
          linear-gradient(90deg, rgba(4, 7, 15, 0.84) 0%, rgba(4, 7, 15, 0.62) 22%, rgba(4, 7, 15, 0.28) 44%, rgba(4, 7, 15, 0.05) 64%, rgba(4, 7, 15, 0) 78%),
          linear-gradient(90deg, var(--bg) 0%, rgba(5, 8, 16, 0) 3%, rgba(5, 8, 16, 0) 97%, var(--bg) 100%);
        transform: translate3d(0, 0, 0);
        transition: opacity 0.36s ease;
      }
      .detail-hero-stage.hero-bright-backdrop .detail-scrim-layer {
        background:
          linear-gradient(180deg, rgba(5, 8, 16, 0.28) 0%, rgba(5, 8, 16, 0) 56px),
          linear-gradient(0deg, var(--bg) 0%, rgba(5, 8, 16, 0.95) 11%, rgba(5, 8, 16, 0.52) 27%, rgba(5, 8, 16, 0.12) 45%, rgba(5, 8, 16, 0) 62%),
          linear-gradient(90deg, rgba(4, 7, 15, 0.92) 0%, rgba(4, 7, 15, 0.76) 26%, rgba(4, 7, 15, 0.42) 48%, rgba(4, 7, 15, 0.10) 68%, rgba(4, 7, 15, 0) 84%),
          linear-gradient(90deg, var(--bg) 0%, rgba(5, 8, 16, 0) 3%, rgba(5, 8, 16, 0) 97%, var(--bg) 100%);
      }
      @media (orientation: portrait), (max-width: 640px) {
        .detail-scrim-layer,
        .detail-hero-stage.hero-bright-backdrop .detail-scrim-layer {
          background:
            linear-gradient(180deg, rgba(4, 7, 15, 0.22) 0%, rgba(4, 7, 15, 0) 48px),
            linear-gradient(0deg, var(--bg) 0%, rgba(5, 8, 16, 0.96) 14%, rgba(5, 8, 16, 0.74) 30%, rgba(5, 8, 16, 0.24) 46%, rgba(5, 8, 16, 0) 64%) !important;
        }
      }
      .detail-scroll-dim-overlay {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background: var(--bg);
        opacity: var(--detail-scroll-dim, 0);
      }
      .detail-hero-content {
        position: relative;
        z-index: 2;
        min-width: 0;
        max-width: 600px;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 4px 0;
        transition: opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1), transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .detail-hero-stage .hero-bottom-bar,
      .hero .hero-content,
      .hero .hero-bottom-bar {
        transition: opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1), transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
      }
      /* Vordergrund-Trailer-Modus (Beim Klick auf Szenenbild, Video oder "Trailer": ALLE Elemente blenden im Detail-View UND im Hauptslider aus) */
      .modal-backdrop:has(.detail-hero-stage.is-trailer-foreground-mode) {
        overflow: hidden !important;
      }
      .modal:has(.detail-hero-stage.is-trailer-foreground-mode) .detail-content-body,
      .modal:has(.detail-hero-stage.is-trailer-foreground-mode) .detail-sticky-mini-header {
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity 0.26s ease;
      }
      .detail-hero-stage.is-trailer-foreground-mode .detail-hero-content,
      .detail-hero-stage.is-trailer-foreground-mode .hero-bottom-bar,
      .detail-hero-stage.is-trailer-foreground-mode .detail-ambilight-glow,
      .hero.is-trailer-foreground-mode .hero-content,
      .hero.is-trailer-foreground-mode .hero-bottom-bar,
      .hero-stage-wrap:has(.hero.is-trailer-foreground-mode) .hero-ambilight-glow,
      .hero-stage-wrap:has(.hero.is-trailer-foreground-mode) .hero-ambilight-beams {
        opacity: 0 !important;
        pointer-events: none !important;
        transform: translateY(10px);
      }
      .detail-hero-stage.is-trailer-foreground-mode .detail-scrim-layer,
      .hero.is-trailer-foreground-mode .hero-scrim-layer {
        opacity: 0.08 !important;
      }
      .detail-hero-stage.is-trailer-foreground-mode .detail-bg-video-layer.is-playing,
      .hero.is-trailer-foreground-mode .detail-bg-video-layer.is-playing {
        opacity: 1 !important;
        z-index: 3;
        filter: brightness(1.03) contrast(1.03);
      }
      .detail-hero-stage.is-trailer-foreground-mode .detail-bg-video-frame,
      .hero.is-trailer-foreground-mode .detail-bg-video-frame {
        transform: translate(-50%, -50%) scale(1.16);
      }
      /* Format-Zoom-Modus (Original 16:9 / 21:9 Kinoformat ohne Randbeschnitt) */
      .detail-hero-stage.is-cinema-zoom-fit,
      .hero.is-cinema-zoom-fit {
        background: #03060d;
      }
      .detail-hero-stage.is-cinema-zoom-fit .detail-bg-video-layer,
      .hero.is-cinema-zoom-fit .detail-bg-video-layer {
        background: #03060d;
      }
      .detail-hero-stage.is-cinema-zoom-fit .detail-bg-video-frame,
      .hero.is-cinema-zoom-fit .detail-bg-video-frame {
        width: min(100vw, 177.78vh) !important;
        height: min(56.25vw, calc(100svh - var(--sticky-header-height, 54px))) !important;
        transform: translate(-50%, -50%) scale(1.08) !important;
        clip-path: inset(6.8% 0 6.8% 0) !important;
        -webkit-clip-path: inset(6.8% 0 6.8% 0) !important;
      }
      .detail-hero-stage.is-cinema-zoom-fit .detail-backdrop-layer,
      .hero.is-cinema-zoom-fit .hero-backdrop-layer {
        background-size: contain !important;
        background-position: center center !important;
        background-color: #03060d !important;
      }
      .detail-foreground-stage-catcher {
        position: absolute;
        inset: 0;
        z-index: 4;
        display: none;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
      }
      .detail-hero-stage.is-trailer-foreground-mode .detail-foreground-stage-catcher,
      .hero.is-trailer-foreground-mode .detail-foreground-stage-catcher {
        display: block;
      }
      /* Glas-Ripple-Feedback bei Doppel-Tipp ±10s Spulen & Format-Zoom */
      .detail-seek-ripple-badge {
        position: absolute;
        top: 50%;
        z-index: 15;
        transform: translate(-50%, -50%) scale(0.86);
        padding: 9px 18px;
        border-radius: 999px;
        background: rgba(8, 13, 24, 0.82);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(56, 189, 248, 0.48);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.72);
        color: #ffffff;
        font-size: calc(14px * var(--scale-text));
        font-weight: 900;
        letter-spacing: 0.02em;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .detail-seek-ripple-badge.is-left { left: 22%; }
      .detail-seek-ripple-badge.is-center { left: 50%; }
      .detail-seek-ripple-badge.is-right { left: 78%; }
      .detail-seek-ripple-badge.is-visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      .detail-seek-ripple-badge.is-loading-pulse {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
        animation: detailTrailerLoadingPulse 1.2s ease-in-out infinite alternate;
      }
      @keyframes detailTrailerLoadingPulse {
        from { opacity: 0.72; transform: translate(-50%, -50%) scale(0.97); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1.02); }
      }
      /* Edles Glas-Mini-Dock unten rechts für Play/Pause, Ton, Zeitleiste & Kino-Ansicht */
      .detail-cinema-player-dock {
        position: absolute;
        right: 24px;
        bottom: 18px;
        z-index: 16;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 5px 12px;
        border-radius: 999px;
        background: rgba(8, 13, 24, 0.72);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65);
        color: #f8fafc;
        opacity: 0;
        pointer-events: none;
        transform: translateY(8px);
        transition: opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1), transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), bottom 0.22s ease, border-color 0.2s ease, background 0.2s ease;
      }
      /* Wenn die untere Hinweis-/Thumbnail-Leiste sichtbar ist, schwebt das Player-Dock kollisionsfrei darüber */
      .hero:not(.is-trailer-foreground-mode) .hero-cinema-player-dock,
      .detail-hero-stage:not(.is-trailer-foreground-mode) .detail-cinema-player-dock {
        bottom: 60px;
      }
      .detail-cinema-player-dock.is-ready,
      .detail-hero-stage.is-trailer-foreground-mode .detail-cinema-player-dock,
      .hero.is-trailer-foreground-mode .detail-cinema-player-dock {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
      .detail-cinema-player-dock:hover {
        background: rgba(8, 13, 24, 0.88);
        border-color: rgba(56, 189, 248, 0.48);
      }
      .cinema-dock-btn {
        height: 28px;
        min-width: 28px;
        padding: 0 8px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.07);
        color: #f8fafc;
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 800;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        cursor: pointer;
        white-space: nowrap;
        box-sizing: border-box;
        transition: all 0.16s ease;
      }
      .cinema-dock-btn:hover,
      .cinema-dock-btn.spatial-focus {
        background: rgba(56, 189, 248, 0.24);
        border-color: #38bdf8;
        color: #ffffff;
        transform: none;
      }
      .cinema-dock-btn.is-active-mode {
        background: rgba(225, 29, 72, 0.25);
        border-color: rgba(244, 63, 94, 0.65);
        color: #ffffff;
      }
      .cinema-dock-timeline-wrap {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 0 2px;
      }
      .cinema-dock-scrubber {
        width: 96px;
        height: 4px;
        accent-color: #38bdf8;
        cursor: pointer;
        margin: 0;
      }
      .cinema-dock-time {
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 700;
        color: #cbd5e1;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        min-width: 58px;
        text-align: right;
      }
      @media (max-width: 640px) {
        .detail-cinema-player-dock {
          right: 12px;
          left: 12px;
          bottom: 12px;
          justify-content: space-between;
          padding: 5px 10px;
        }
        .hero:not(.is-trailer-foreground-mode) .hero-cinema-player-dock,
        .detail-hero-stage:not(.is-trailer-foreground-mode) .detail-cinema-player-dock {
          bottom: 54px;
        }
        .cinema-dock-scrubber {
          flex: 1;
          width: auto;
          min-width: 64px;
        }
      }
      .detail-kicker-link {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: #f1f5f9;
        background: rgba(15, 23, 42, 0.56);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(var(--ambi-1, 148, 163, 184), 0.34);
        padding: 3px 10px;
        border-radius: 999px;
        cursor: pointer;
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        letter-spacing: 0.3px;
        transition: all 0.15s ease;
      }
      .detail-kicker-link:hover, .detail-kicker-link.spatial-focus {
        background: rgba(56, 189, 248, 0.24);
        border-color: #38bdf8;
        color: #ffffff;
        transform: translateY(-1px);
      }
      .detail-monumental-title {
        margin: 0;
        font-size: var(--cinema-title-size);
        font-weight: 900;
        line-height: 1.04;
        letter-spacing: -0.6px;
        text-transform: uppercase;
        color: #ffffff;
        text-shadow: 0 4px 20px rgba(0, 0, 0, 0.92), 0 1px 4px rgba(0, 0, 0, 0.9);
        cursor: pointer;
        word-break: break-word;
      }
      .detail-monumental-title:hover {
        color: #38bdf8;
      }
      .detail-unboxed-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 7px;
        font-size: var(--cinema-meta-size);
        font-weight: 700;
        color: #f8fafc;
        margin-bottom: 4px;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.95);
      }
      .detail-meta-rating {
        color: #ef4444;
        font-weight: 900;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .detail-meta-dot {
        color: rgba(255, 255, 255, 0.5);
        user-select: none;
      }
      .detail-meta-link {
        color: #e2e8f0;
        cursor: pointer;
      }
      .detail-meta-link:hover, .detail-meta-link.spatial-focus {
        color: #38bdf8;
        text-decoration: underline;
      }
      .detail-meta-studio {
        color: #e2e8f0;
        font-weight: 700;
        cursor: pointer;
      }
      /* Flixnet Hero Action Bar: 1:1 mit Slider-Buttons (unter der Beschreibung) */
      .detail-action-bar {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .detail-action-primary-group {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .detail-btn-play-white {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: #ffffff;
        color: #090d16;
        border: 1px solid #ffffff;
        border-radius: 8px;
        padding: var(--cinema-btn-pad);
        font-size: var(--cinema-btn-font);
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
        transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
      }
      .detail-btn-play-white:hover, .detail-btn-play-white.spatial-focus {
        background: #f1f5f9;
        transform: translateY(-1px) scale(1.03);
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.55), 0 8px 22px rgba(0, 0, 0, 0.78);
      }
      .detail-version-select-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
      }
      .detail-version-select {
        appearance: none;
        -webkit-appearance: none;
        background: rgba(15, 23, 42, 0.82);
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 8px;
        padding: var(--cinema-btn-pad);
        padding-right: 34px;
        font-size: var(--cinema-btn-font);
        font-weight: 700;
        cursor: pointer;
        backdrop-filter: blur(12px);
        max-width: min(360px, 84vw);
        text-overflow: ellipsis;
        white-space: nowrap;
        overflow: hidden;
        transition: border-color 0.15s ease, background 0.15s ease;
      }
      .detail-version-select:hover, .detail-version-select:focus, .detail-version-select.spatial-focus {
        border-color: #38bdf8;
        background: rgba(30, 41, 59, 0.95);
        outline: none;
      }
      .detail-version-select-caret {
        position: absolute;
        right: 12px;
        pointer-events: none;
        font-size: 11px;
        color: #94a3b8;
      }
      .detail-btn-glass {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        background: rgba(30, 41, 59, 0.68);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 8px;
        padding: var(--cinema-btn-pad);
        font-size: var(--cinema-btn-font);
        font-weight: 700;
        cursor: pointer;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
        text-decoration: none;
        transition: all 0.15s ease;
      }
      .detail-btn-glass:hover, .detail-btn-glass.spatial-focus {
        background: rgba(51, 65, 85, 0.85);
        border-color: rgba(255, 255, 255, 0.55);
        color: #ffffff;
        transform: translateY(-1px) scale(1.03);
      }
      .detail-btn-glass.saved {
        background: rgba(16, 185, 129, 0.24);
        border-color: rgba(52, 211, 153, 0.72);
        color: #ecfdf5;
      }
      .detail-btn-glass.teaser-active {
        border-color: rgba(56, 189, 248, 0.68);
        color: #e0f2fe;
      }
      .detail-overview-wrap {
        max-width: min(68ch, 100%);
        margin-bottom: 10px;
      }
      /* Untere Sektionen im Fullscreen-App-View (Zusatz-Infos, Episoden/Teile, Cast-Glas-Karten, Filmreihe & Ähnliche Titel) */
      .detail-content-body {
        width: 100%;
        padding: 18px 28px 64px;
        display: flex;
        flex-direction: column;
        gap: calc(28px * var(--scale-all));
        transition: opacity 0.22s ease, transform 0.22s ease;
      }
      /* Ruhige, edle Kino-Metadaten-Zeile für Zusatz-Infos (Regie, Studio, Land, Streaming-Anbieter) ohne schwere Kapsel-Flut */
      .detail-credits-glass-strip {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px 4px;
        padding: calc(10px * var(--scale-all)) calc(14px * var(--scale-all));
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.42);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(148, 163, 184, 0.14);
      }
      .detail-credit-sep {
        color: rgba(148, 163, 184, 0.45);
        font-size: calc(12px * var(--scale-text));
        padding: 0 4px;
        user-select: none;
      }
      .detail-credit-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 8px;
        border-radius: 7px;
        background: transparent;
        border: 1px solid transparent;
        color: #e2e8f0;
        font-size: calc(12px * var(--scale-text));
        font-weight: 700;
        cursor: pointer;
        text-decoration: none;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      .detail-credit-pill b {
        color: #94a3b8;
        font-weight: 600;
      }
      .detail-credit-pill:hover, .detail-credit-pill.spatial-focus {
        background: rgba(56, 189, 248, 0.14);
        border-color: rgba(56, 189, 248, 0.42);
        color: #38bdf8;
      }
      .detail-section-block {
        display: flex;
        flex-direction: column;
        gap: calc(13px * var(--scale-all));
      }
      .detail-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .detail-section-header-right {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .detail-header-nav-group {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .detail-section-heading {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin: 0;
        font-size: calc(19px * var(--scale-text));
        font-weight: 900;
        color: #f8fafc;
        letter-spacing: -0.01em;
      }
      .detail-section-heading::before {
        content: "";
        display: inline-block;
        width: 4px;
        height: calc(20px * var(--scale-text));
        border-radius: 2px;
        background: linear-gradient(180deg, rgb(var(--ambi-1, 56, 189, 248)), rgb(var(--ambi-2, 99, 102, 241)));
        box-shadow: 0 0 12px rgba(var(--ambi-1, 56, 189, 248), 0.65);
      }
      /* Cast- & Empfehlungs-Slider im kompakten 2:3 Filmcover-Design mit schlanken Glas-Balken direkt links & rechts daneben */
      .detail-carousel-wrap {
        position: relative;
        width: 100%;
        display: flex;
        align-items: stretch;
        gap: calc(8px * var(--scale-cover));
      }
      .detail-cast-track {
        flex: 1;
        min-width: 0;
        display: flex;
        gap: calc(10px * var(--scale-cover));
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-x pan-y;
        padding: 8px 8px 14px;
        scroll-behavior: smooth;
        scrollbar-width: none;
        cursor: grab;
        user-select: none;
        box-sizing: border-box;
      }
      .detail-cast-track.is-dragging,
      .detail-similar-track.is-dragging {
        cursor: grabbing;
        scroll-behavior: auto;
      }
      .detail-cast-track::-webkit-scrollbar { display: none; }
      .detail-cast-card {
        position: relative;
        flex: 0 0 auto;
        width: calc(clamp(98px, 9.5vw, 116px) * var(--scale-cover));
        aspect-ratio: 2 / 3;
        border-radius: 10px;
        overflow: hidden;
        background: #0f172a;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.6);
        cursor: pointer;
        transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
      }
      .detail-cast-card:hover, .detail-cast-card.spatial-focus {
        transform: translateY(-2px);
        border-color: #38bdf8 !important;
        outline: 2px solid #38bdf8 !important;
        outline-offset: -2px !important;
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.55), 0 12px 24px rgba(0, 0, 0, 0.82) !important;
      }
      .detail-cast-photo-wrap {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #0f172a;
      }
      .detail-cast-photo {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center 18%;
        display: block;
        transition: transform 0.24s ease;
      }
      .detail-cast-card:hover .detail-cast-photo,
      .detail-cast-card.spatial-focus .detail-cast-photo {
        transform: scale(1.05);
      }
      .detail-cast-info {
        position: absolute;
        inset: auto 0 0 0;
        padding: 24px 8px 7px;
        background: linear-gradient(180deg, transparent 0%, rgba(4, 7, 16, 0.86) 48%, rgba(4, 7, 16, 0.98) 100%);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .detail-cast-name {
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 800;
        color: #ffffff;
        line-height: 1.2;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .detail-cast-role {
        font-size: calc(10px * var(--scale-text));
        font-weight: 600;
        color: #94a3b8;
        line-height: 1.18;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* Horizontale Filmreihen- & "Das könnte dir auch gefallen" Cover-Reihe (kompakt ~132px mit --scale-cover Zoom) */
      .detail-similar-track {
        flex: 1;
        min-width: 0;
        display: flex;
        gap: calc(11px * var(--scale-cover));
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-x pan-y;
        padding: 8px 8px 14px;
        scroll-behavior: smooth;
        scrollbar-width: none;
        cursor: grab;
        user-select: none;
        box-sizing: border-box;
      }
      .detail-similar-track::-webkit-scrollbar { display: none; }
      .detail-sim-card {
        position: relative;
        flex: 0 0 auto;
        width: calc(clamp(114px, 11vw, 136px) * var(--scale-cover));
        aspect-ratio: 2 / 3;
        border-radius: 10px;
        overflow: hidden;
        background: #0f172a;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.6);
        cursor: pointer;
        transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
      }
      .detail-sim-card.is-current-part {
        border-color: #38bdf8;
        box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.45), 0 10px 24px rgba(0, 0, 0, 0.75);
      }
      .detail-sim-card:hover, .detail-sim-card.spatial-focus {
        transform: translateY(-2px);
        border-color: #38bdf8 !important;
        outline: 2px solid #38bdf8 !important;
        outline-offset: -2px !important;
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.55), 0 12px 24px rgba(0, 0, 0, 0.82) !important;
      }
      .detail-sim-current-badge {
        position: absolute;
        top: 6px;
        left: 6px;
        z-index: 4;
        background: linear-gradient(135deg, #0284c7, #4338ca);
        color: #ffffff;
        font-size: calc(9.5px * var(--scale-text));
        font-weight: 900;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid rgba(125, 211, 252, 0.6);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
      }
      .detail-sim-poster {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .detail-sim-overlay {
        position: absolute;
        inset: auto 0 0 0;
        padding: 26px 9px 8px;
        background: linear-gradient(180deg, transparent 0%, rgba(4, 7, 16, 0.86) 48%, rgba(4, 7, 16, 0.98) 100%);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .detail-sim-title {
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        color: #ffffff;
        line-height: 1.22;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .detail-sim-sub {
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 600;
        color: #94a3b8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* Schlanke hohe Glas-Balken (‹ / ›) direkt links & rechts NEBEN der Cover-Reihe */
      .detail-carousel-side-btn {
        flex: 0 0 calc(28px * var(--scale-menu));
        width: calc(28px * var(--scale-menu));
        margin: 5px 0 12px;
        border-radius: 10px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(7, 11, 22, 0.90));
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #f8fafc;
        font-size: calc(18px * var(--scale-text));
        font-weight: 900;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.52);
        transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, opacity 0.18s ease, transform 0.14s ease, box-shadow 0.16s ease;
        user-select: none;
      }
      .detail-carousel-side-btn:hover {
        background: linear-gradient(180deg, rgba(14, 165, 233, 0.34), rgba(30, 58, 138, 0.52));
        border-color: rgba(56, 189, 248, 0.78);
        color: #ffffff;
        box-shadow: 0 8px 22px rgba(2, 132, 199, 0.38);
      }
      .detail-carousel-side-btn:active {
        transform: scale(0.97);
      }
      .detail-carousel-side-btn.is-edge-disabled {
        opacity: 0.24;
        cursor: default;
        pointer-events: none;
      }
      @media (max-width: 640px) {
        .detail-carousel-side-btn {
          flex: 0 0 24px;
          width: 24px;
          font-size: 16px;
          border-radius: 8px;
        }
      }
      /* Schauspieler- & Regie-Spotlight-Overlay (Mini-Filmografie direkt über der Detailansicht) */
      .person-spotlight-backdrop {
        position: fixed;
        inset: 0;
        z-index: 260;
        background: rgba(3, 7, 18, 0.78);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        animation: fadeIn 0.18s ease;
      }
      .person-spotlight-card {
        width: min(880px, 96vw);
        max-height: 86vh;
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 22px 24px;
        border-radius: 20px;
        background: linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(7, 11, 22, 0.96));
        border: 1px solid rgba(var(--ambi-1, 56, 189, 248), 0.38);
        box-shadow: 0 28px 70px rgba(0, 0, 0, 0.92);
        overflow-y: auto;
      }
      .person-spotlight-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      .person-spotlight-profile {
        display: flex;
        align-items: center;
        gap: 16px;
        min-width: 0;
      }
      .person-spotlight-avatar {
        width: calc(74px * var(--scale-cover));
        height: calc(74px * var(--scale-cover));
        border-radius: 50%;
        object-fit: cover;
        object-position: center 20%;
        border: 2px solid #38bdf8;
        background: #0f172a;
        flex-shrink: 0;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65);
      }
      .person-spotlight-name {
        font-size: calc(22px * var(--scale-text));
        font-weight: 900;
        color: #ffffff;
        margin: 0;
        line-height: 1.15;
      }
      .person-spotlight-sub {
        font-size: calc(12.5px * var(--scale-text));
        color: #7dd3fc;
        font-weight: 700;
        margin-top: 3px;
      }
      .person-spotlight-bio {
        font-size: calc(12.5px * var(--scale-text));
        color: #cbd5e1;
        line-height: 1.55;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        cursor: pointer;
      }
      .person-spotlight-bio.is-expanded {
        display: block !important;
        -webkit-line-clamp: unset !important;
        max-height: 180px;
        overflow-y: auto;
        padding-right: 4px;
      }
      .person-spotlight-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(calc(132px * var(--scale-cover)), 1fr));
        gap: calc(12px * var(--scale-cover));
        padding: 6px;
        box-sizing: border-box;
      }
      /* Live-Zoom-Badge (oben rechts bei L2/R2 oder +/-) & Controller-HUD (PlayStation / Xbox) */
      #liveZoomBadgeEl {
        position: fixed;
        top: calc(var(--sticky-header-height, 54px) + 12px);
        right: 18px;
        z-index: 1650;
        background: linear-gradient(135deg, rgba(8, 13, 25, 0.92), rgba(2, 132, 199, 0.35));
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(56, 189, 248, 0.65);
        color: #f8fafc;
        padding: 6px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 900;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.75);
        pointer-events: none;
        opacity: 0;
        transform: translateY(-8px) scale(0.96);
        transition: opacity 0.18s ease, transform 0.18s ease;
      }
      #liveZoomBadgeEl.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      #controllerHudBar {
        position: fixed;
        bottom: 12px;
        right: 14px;
        z-index: 155;
        display: none;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        background: linear-gradient(135deg, rgba(8, 13, 26, 0.86), rgba(15, 23, 42, 0.78));
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1px solid rgba(56, 189, 248, 0.32);
        border-radius: 999px;
        padding: 5px 13px;
        font-size: 11.5px;
        font-weight: 700;
        color: #cbd5e1;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.68);
        pointer-events: none;
      }
      #controllerHudBar.visible {
        display: inline-flex;
      }
      #controllerHudBar b {
        color: #38bdf8;
        font-weight: 900;
      }
      @media (max-width: 640px) {
        .detail-hero-stage {
          padding: 14px 16px 12px;
        }
        .detail-content-body {
          padding: 16px 16px 56px;
        }
        #controllerHudBar {
          display: none !important;
        }
      }
      .ep-icon-btn {
        padding: 4px 7px !important;
        font-size: calc(11px * var(--scale-text)) !important;
        border-radius: 6px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        color: #94a3b8;
        transition: all 0.14s ease;
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
        background: rgba(2, 6, 23, 0.84);
        backdrop-filter: blur(6px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 14px;
        animation: fadeIn 0.14s ease;
      }
      .submodal-box {
        background: var(--surface);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 14px;
        width: 100%;
        max-width: 520px;
        max-height: 90vh;
        overflow-y: auto;
        padding: 16px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.92);
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
      /* Modernisierte Serien-Staffel-Leiste & Streaming-Episoden-Karten (Apple TV+ / Netflix Stil) */
      .season-toolbar-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 12px;
        padding: 6px 8px;
        border-radius: 12px;
        background: rgba(10, 15, 28, 0.55);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      body[data-theme="light"] .season-toolbar-row {
        background: #f1f5f9;
        border-color: #cbd5e1;
      }
      .season-tab-btn {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.10);
        color: #cbd5e1;
        padding: 6px 14px;
        border-radius: 999px;
        font-size: calc(12px * var(--scale-text));
        font-weight: 800;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.16s ease;
      }
      .season-tab-btn:hover,
      .season-tab-btn.spatial-focus {
        background: rgba(14, 165, 233, 0.18);
        border-color: rgba(56, 189, 248, 0.58);
        color: #ffffff;
      }
      .season-tab-btn.active {
        background: #ffffff;
        border-color: #ffffff;
        color: #090d16;
        box-shadow: 0 4px 14px rgba(255, 255, 255, 0.22);
      }
      body[data-theme="light"] .season-tab-btn {
        background: #ffffff;
        border-color: #cbd5e1;
        color: #334155;
      }
      body[data-theme="light"] .season-tab-btn:hover {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0369a1;
      }
      body[data-theme="light"] .season-tab-btn.active {
        background: #0f172a;
        border-color: #0f172a;
        color: #ffffff;
      }
      .season-version-filter-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        padding: 7px 12px;
        margin-bottom: 12px;
        border-radius: 10px;
        background: rgba(14, 165, 233, 0.06);
        border: 1px solid rgba(56, 189, 248, 0.18);
        font-size: calc(11.5px * var(--scale-text));
      }
      body[data-theme="light"] .season-version-filter-bar {
        background: #f0f9ff;
        border-color: #bae6fd;
      }
      .ep-row {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: center;
        padding: calc(11px * var(--scale-menu)) calc(14px * var(--scale-menu));
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.84) 0%, rgba(10, 15, 28, 0.94) 100%);
        content-visibility: auto;
        contain-intrinsic-size: 0 74px;
        border-radius: 12px;
        margin-bottom: calc(8px * var(--scale-all));
        gap: calc(7px * var(--scale-all));
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
        transition: background 0.14s ease, border-color 0.14s ease, transform 0.12s ease;
      }
      button, .btn, .detail-btn-glass, .detail-btn-play-white, .cinema-dock-btn, .season-tab-btn, .mode-pill, .f-pill, .recent-chip {
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }
      .ep-row:hover,
      .ep-row:focus-within {
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.78) 0%, rgba(14, 165, 233, 0.12) 100%);
        border-color: rgba(56, 189, 248, 0.48);
        box-shadow: 0 10px 24px rgba(2, 6, 23, 0.52);
        transform: translateY(-1px);
      }
      body[data-theme="light"] .ep-row {
        background: #ffffff;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .ep-row:hover,
      body[data-theme="light"] .ep-row:focus-within {
        background: #f8fafc;
        border-color: #38bdf8;
      }
      .ep-row.ep-watched { border-color: rgba(16, 185, 129, 0.42); background: linear-gradient(135deg, rgba(16, 185, 129, 0.09), rgba(15, 23, 42, 0.58)); }
      .ep-row.ep-next-up { border-color: rgba(56, 189, 248, 0.65); background: linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(15, 23, 42, 0.68)); }
      .ep-row.ep-autofilled { border-left: 3px solid #38bdf8; }
      .ep-row-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        min-width: 0;
        flex-wrap: wrap;
      }
      .ep-row-bottom {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        width: 100%;
      }
      body[data-theme="light"] .ep-row-bottom {
        border-top-color: transparent;
      }
      .ep-title {
        font-size: calc(14px * var(--scale-text));
        font-weight: 800;
        color: #f8fafc;
        cursor: pointer;
        flex: 1;
        min-width: 0;
        border-radius: 7px;
        padding: 3px 6px;
        box-sizing: border-box;
        transition: color 0.14s ease, background 0.14s ease;
        display: flex;
        align-items: center;
        gap: 10px;
        overflow: hidden;
      }
      .ep-title.spatial-focus,
      .ep-title:hover {
        color: #38bdf8;
        background: rgba(14, 165, 233, 0.10);
      }
      .ep-title:hover .ep-name-text,
      .ep-title.spatial-focus .ep-name-text {
        color: #38bdf8;
      }
      body[data-theme="light"] .ep-title:hover .ep-name-text,
      body[data-theme="light"] .ep-title.spatial-focus .ep-name-text {
        color: #0284c7;
      }
      .ep-code-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 3px 9px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #e2e8f0;
        font-size: calc(11px * var(--scale-text));
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.3px;
        flex-shrink: 0;
      }
      /* Lauftext (Marquee) Wrapper für Folgennamen & lange Modal-Titel */
      .ep-name-wrap,
      .inline-marquee-wrap {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        position: relative;
        display: flex;
        align-items: center;
      }
      .ep-name-text,
      .inline-marquee-text {
        color: #f8fafc;
        font-weight: 700;
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: inline-block;
        max-width: 100%;
      }
      .ep-name-wrap.is-marquee-overflow,
      .inline-marquee-wrap.is-marquee-overflow {
        mask-image: linear-gradient(to right, transparent 0%, #000 3%, #000 95%, transparent 100%);
        -webkit-mask-image: linear-gradient(to right, transparent 0%, #000 3%, #000 95%, transparent 100%);
      }
      .ep-name-wrap.is-marquee-overflow .ep-name-text,
      .inline-marquee-wrap.is-marquee-overflow .inline-marquee-text {
        max-width: none !important;
        overflow: visible !important;
        text-overflow: clip !important;
        padding-right: 24px;
        will-change: transform;
        animation: cardTitleMarquee var(--marquee-dur, 6s) ease-in-out infinite;
      }
      .ep-quality-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 7px;
        border-radius: 6px;
        font-size: calc(10.5px * var(--scale-text));
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        background: rgba(14, 165, 233, 0.18);
        border: 1px solid rgba(56, 189, 248, 0.45);
        color: #7dd3fc;
        flex-shrink: 0;
      }
      .ep-quality-badge.q-uhd {
        background: rgba(99, 102, 241, 0.22);
        border-color: rgba(129, 140, 248, 0.55);
        color: #c7d2fe;
      }
      .ep-quality-badge.q-sd {
        background: rgba(148, 163, 184, 0.18);
        border-color: rgba(148, 163, 184, 0.4);
        color: #cbd5e1;
      }
      body[data-theme="light"] .ep-quality-badge {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0369a1;
      }
      .ep-autofill-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 7px;
        border-radius: 6px;
        font-size: calc(10px * var(--scale-text));
        font-weight: 800;
        background: rgba(245, 158, 11, 0.16);
        border: 1px solid rgba(251, 191, 36, 0.45);
        color: #fde68a;
        flex-shrink: 0;
      }
      body[data-theme="light"] .ep-autofill-badge {
        background: #fef3c7;
        border-color: #f59e0b;
        color: #92400e;
      }
      .btn-stream-clean {
        background: linear-gradient(135deg, rgba(2, 132, 199, 0.24), rgba(67, 56, 202, 0.24));
        border: 1px solid rgba(56, 189, 248, 0.5);
        color: #e0f2fe;
        font-weight: 700;
        padding: 5px 11px;
        border-radius: 7px;
        font-size: calc(11px * var(--scale-text));
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.14s ease;
      }
      .btn-stream-clean:hover,
      .btn-stream-clean.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #7dd3fc;
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
      }
      .btn-stream-clean.prerelease {
        background: rgba(245, 158, 11, 0.15);
        border-color: rgba(245, 158, 11, 0.45);
        color: #fde68a;
      }
      .btn-stream-clean.prerelease:hover {
        background: #d97706;
        border-color: #fbbf24;
        color: #ffffff;
      }
      .ep-ghost-btn {
        background: rgba(30, 41, 59, 0.45);
        border: 1px solid rgba(148, 163, 184, 0.18);
        color: #94a3b8;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        cursor: pointer;
        opacity: 0.62;
        transition: opacity 0.14s ease, background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
      }
      .ep-ghost-btn.admin-remap-btn {
        background: rgba(14, 165, 233, 0.14);
        border-color: rgba(56, 189, 248, 0.4);
        color: #7dd3fc;
      }
      .ep-ghost-btn.admin-remap-btn:hover,
      .ep-ghost-btn.admin-remap-btn.spatial-focus {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #7dd3fc;
        color: #ffffff;
      }
      .ep-row:hover .ep-ghost-btn,
      .ep-row:focus-within .ep-ghost-btn,
      .ep-ghost-btn:hover,
      .ep-ghost-btn.spatial-focus {
        opacity: 1;
      }
      .ep-ghost-btn:hover,
      .ep-ghost-btn.spatial-focus {
        opacity: 1;
        background: rgba(51, 65, 85, 0.85);
        border-color: rgba(148, 163, 184, 0.45);
        color: #ffffff;
      }
      .ep-ghost-btn.saved {
        opacity: 1;
        background: rgba(16, 185, 129, 0.18);
        border-color: rgba(16, 185, 129, 0.48);
        color: #6ee7b7;
      }
      body[data-theme="light"] .ep-ghost-btn {
        background: #f1f5f9;
        border-color: #cbd5e1;
        color: #334155;
      }
      body[data-theme="light"] .ep-ghost-btn.admin-remap-btn {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0369a1;
      }
      body[data-theme="light"] .ep-ghost-btn:hover {
        background: #e2e8f0;
        border-color: #94a3b8;
        color: #0f172a;
      }
      body[data-theme="light"] .ep-name-text,
      body[data-theme="light"] .inline-marquee-text {
        color: #0f172a;
      }
      body[data-theme="light"] .ep-code-badge {
        background: #e0f2fe;
        border-color: #7dd3fc;
        color: #0369a1;
      }
      body[data-theme="light"] .btn-stream-clean {
        background: #e0f2fe;
        border-color: #38bdf8;
        color: #0c4a6e;
      }
      body[data-theme="light"] .btn-stream-clean:hover {
        background: linear-gradient(135deg, #0284c7, #4338ca);
        border-color: #0284c7;
        color: #ffffff;
      }
      body[data-theme="light"] .btn-stream-clean.prerelease {
        background: #fef3c7;
        border-color: #f59e0b;
        color: #92400e;
      }
      body[data-theme="light"] .btn-stream-clean.prerelease:hover {
        background: #d97706;
        border-color: #b45309;
        color: #ffffff;
      }
      /* Vorher -> Nachher Vergleichsbox im Admin Folgen-Korrektur-Modal */
      .ep-remap-compare-grid {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        gap: 8px;
        align-items: stretch;
        margin-bottom: 12px;
      }
      @media (max-width: 540px) {
        .ep-remap-compare-grid {
          grid-template-columns: 1fr;
        }
        .ep-remap-compare-arrow {
          transform: rotate(90deg);
          margin: -2px auto;
        }
      }
      .ep-remap-card {
        padding: 10px 11px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.24);
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .ep-remap-card.target {
        background: rgba(14, 165, 233, 0.11);
        border-color: rgba(56, 189, 248, 0.5);
      }
      body[data-theme="light"] .ep-remap-card {
        background: #f8fafc;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .ep-remap-card.target {
        background: #f0f9ff;
        border-color: #38bdf8;
      }
      .ep-remap-compare-arrow {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        font-weight: 900;
        color: #38bdf8;
        padding: 0 2px;
      }
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
      body[data-theme="light"] .stream-meta-pill {
        background: #f1f5f9;
        border-color: #cbd5e1;
        color: #334155;
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
        flex-shrink: 0;
      }
      .ep-progress-badge.next {
        background: rgba(14, 165, 233, 0.22);
        border-color: rgba(56, 189, 248, 0.55);
        color: #7dd3fc;
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
      .panel-box { background: rgba(18, 21, 30, 0.88); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
      .lightbox-backdrop { position: fixed; inset: 0; z-index: 1700; background: rgba(4, 7, 17, 0.95); backdrop-filter: blur(10px); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px; overflow: hidden; }
      .lightbox-toolbar { position: relative; z-index: 5; display: flex; justify-content: space-between; align-items: center; width: 100%; max-width: 720px; margin-bottom: 12px; gap: 10px; padding: 8px 12px; border-radius: 12px; background: rgba(7, 12, 26, 0.88); border: 1px solid rgba(56, 189, 248, 0.25); box-shadow: 0 8px 24px rgba(0,0,0,0.65); }
      .lightbox-img { position: relative; z-index: 1; max-width: 96vw; max-height: 78vh; object-fit: contain; border-radius: 10px; box-shadow: 0 14px 44px rgba(0,0,0,0.92); transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1); cursor: zoom-in; }
      .lightbox-img.zoomed { transform: scale(1.62); cursor: zoom-out; }
      a.link { color: #38bdf8; text-decoration: none; font-weight: 600; }
      body[data-theme="light"] a.link { color: #0284c7; }
      #hudToast {
        position: fixed;
        bottom: 20px;
        left: 50%;
        right: auto;
        transform: translateX(-50%);
        z-index: 2600;
        max-width: min(92vw, 560px);
        text-align: center;
        background: rgba(7, 12, 26, 0.96);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(56, 189, 248, 0.65);
        color: #fff;
        padding: 9px 16px;
        border-radius: 999px;
        font-size: 12.5px;
        font-weight: 800;
        box-shadow: 0 10px 28px rgba(0,0,0,0.82), 0 0 16px rgba(56, 189, 248, 0.2);
        display: none;
        pointer-events: auto;
        cursor: pointer;
      }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      /* Futuristischer Neon-Cinema Boot-Splashscreen */
      #tmaBootSplashscreen {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: radial-gradient(circle at 50% 38%, rgba(0, 240, 255, 0.16) 0%, rgba(139, 92, 246, 0.14) 34%, #070b19 78%);
        background-color: #070b19;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
        transition: opacity 0.38s cubic-bezier(0.16, 1, 0.3, 1), transform 0.38s cubic-bezier(0.16, 1, 0.3, 1);
        user-select: none;
      }
      #tmaBootSplashscreen.splash-hidden {
        opacity: 0;
        transform: scale(1.03);
        pointer-events: none;
      }
      .neon-splash-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        max-width: 360px;
        width: 100%;
      }
      .neon-splash-avatar-wrap {
        position: relative;
        width: 116px;
        height: 116px;
        border-radius: 50%;
        padding: 3px;
        background: linear-gradient(135deg, #00f0ff 0%, #8b5cf6 55%, #ec4899 100%);
        box-shadow: 0 0 36px rgba(0, 240, 255, 0.38), 0 0 64px rgba(139, 92, 246, 0.28);
        margin-bottom: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .neon-splash-avatar-img {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        object-fit: cover;
        background: #070b19;
        display: block;
      }
      .neon-splash-title {
        font-size: 24px;
        font-weight: 900;
        letter-spacing: -0.02em;
        color: #f8fafc;
        margin-bottom: 4px;
      }
      .neon-splash-title span {
        background: linear-gradient(90deg, #00f0ff, #a855f7);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .neon-splash-sub {
        font-size: 12.5px;
        color: #94a3b8;
        margin-bottom: 18px;
        letter-spacing: 0.01em;
      }
      .neon-splash-bar-track {
        width: 180px;
        height: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.09);
        overflow: hidden;
        position: relative;
      }
      .neon-splash-bar-fill {
        height: 100%;
        width: 65%;
        border-radius: 999px;
        background: linear-gradient(90deg, #00f0ff, #8b5cf6);
        animation: neonSplashPulse 1.1s ease-in-out infinite alternate;
      }
      @keyframes neonSplashPulse {
        0% { transform: translateX(-35%); width: 45%; }
        100% { transform: translateX(85%); width: 65%; }
      }
      @media (prefers-reduced-motion: reduce) {
        #tmaBootSplashscreen { transition: opacity 0.15s linear; transform: none !important; }
        .neon-splash-bar-fill { animation: none; width: 100%; }
      }
    </style>
  </head>
  <body>
    <div id="tmaBootSplashscreen" onclick="dismissBootSplashscreen()" title="Antippen zum Überspringen">
      <div class="neon-splash-card">
        <div class="neon-splash-avatar-wrap">
          <img
            class="neon-splash-avatar-img"
            src="/src/assets/images/telegram_bot_avatar_neon_1794251893026.jpg"
            alt="TelePort Neon Cinema Logo"
            referrerPolicy="no-referrer"
            onerror="if(!this.dataset.triedAlt){this.dataset.triedAlt='1';this.src='/assets/telegram_bot_avatar_neon.jpg';}else{this.style.display='none';this.nextElementSibling.style.display='flex';}"
          />
          <div style="display:none;width:100%;height:100%;border-radius:50%;background:#070b19;align-items:center;justify-content:center">
            <svg width="64" height="64" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="14" cy="14" r="11.5" stroke="#00f0ff" stroke-width="2.2" stroke-dasharray="18 5"/>
              <circle cx="14" cy="14" r="7.5" stroke="#8b5cf6" stroke-width="1.5"/>
              <path d="M11.8 9.8L18.5 14L11.8 18.2V9.8Z" fill="#00f0ff"/>
            </svg>
          </div>
        </div>
        <div class="neon-splash-title">Tele<span>Port</span> Cinema</div>
        <div class="neon-splash-sub">Synchronisiere Mediathek & Streams…</div>
        <div class="neon-splash-bar-track"><div class="neon-splash-bar-fill"></div></div>
      </div>
    </div>
    <header id="topUnifiedBar" class="search-bar-outer">
      <button class="btn" id="sidebarToggleBtn" onclick="toggleFilterSidebar()" title="Menü, Filter, Zufall, Account, Design & Ansichtsgröße öffnen"><span class="top-btn-icon">☰</span><span class="top-btn-label"> Menü</span><span id="topSidebarFilterCountBadge" class="top-filter-count-badge" style="display:none">0</span></button>
      <button type="button" class="btn" id="topBarBackBtn" onclick="closeDetailModal()" title="Zurück zur vorherigen Ansicht (Esc / B / ○)"><span class="top-btn-icon">←</span><span class="top-btn-label" id="topBarBackBtnLabel"> Zurück</span></button>
      <span id="headerBrandLogo" class="brand-logo" tabindex="0" role="button" aria-label="TelePort – Zur Hauptseite" onclick="goHome()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();goHome();}" title="TelePort – Zur Hauptseite">
        <svg class="teleport-logo-svg" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="tpGradHeader" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#38bdf8"/>
              <stop offset="50%" stop-color="#0284c7"/>
              <stop offset="100%" stop-color="#6366f1"/>
            </linearGradient>
          </defs>
          <circle cx="14" cy="14" r="11.5" stroke="url(#tpGradHeader)" stroke-width="2.5" stroke-dasharray="18 5"/>
          <circle cx="14" cy="14" r="7.5" stroke="#38bdf8" stroke-width="1.4" stroke-opacity="0.75"/>
          <path d="M11.8 9.8L18.5 14L11.8 18.2V9.8Z" fill="url(#tpGradHeader)"/>
        </svg>
        <span class="brand-text-wrap">Tele<span class="teleport-accent">Port</span></span>
      </span>
      <div class="media-mode-switch-inline" id="mediaModeBanner">
        <button id="tabBtnMovies" class="media-mode-tab active-movie" onclick="switchType('m')" title="Zu Filme wechseln">
          <span class="top-btn-icon">🎬</span><span class="top-btn-label"> Filme</span>
        </button>
        <button id="tabBtnSeries" class="media-mode-tab" onclick="switchType('s')" title="Zu Serien wechseln">
          <span class="top-btn-icon">📺</span><span class="top-btn-label"> Serien</span>
        </button>
      </div>
      <div class="search-bar" onclick="if(window.innerWidth<=760 && !document.getElementById('topUnifiedBar')?.classList.contains('mobile-search-expanded')){expandMobileSearchBarClient();}">
        <button type="button" id="mobileSearchCollapseBtn" class="mobile-search-collapse-btn" onclick="collapseMobileSearchBarClient(event)" title="Suche einklappen" aria-label="Suche einklappen">←</button>
        <button type="button" id="searchGenreTriggerBtn" class="search-genre-trigger-btn" onclick="toggleSearchGenreDropdownOverlay(event)" title="Nach Genre filtern" aria-haspopup="listbox" aria-expanded="false">
          <span id="searchGenreTriggerIcon" class="search-genre-trigger-icon">🎞️</span>
          <span id="searchGenreTriggerLabel" class="search-genre-trigger-label">Alle Genres</span>
          <span id="searchGenreQuickResetBtn" class="search-genre-quick-reset" onclick="resetTopGenreFilterQuickClient(event)" title="Genre-Filter mit 1 Klick zurücksetzen (Alle Genres)" style="display:none">✕</span>
          <span class="search-genre-caret">▾</span>
        </button>
        <select id="searchGenreSelect" class="search-scope-select" style="display:none !important" aria-hidden="true" onchange="onSearchGenreSelectChange(this.value)" title="Nach Genre filtern">
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
            onkeydown="onSearchInputKeyDownClient(event, this)"
          />
          <button type="button" id="searchClearBtn" class="search-clear-btn is-empty" onclick="clearSearchInput()" title="Suchfeld leeren" aria-label="Suchfeld leeren">✕</button>
        </div>
        <button type="button" class="search-submit-btn" onclick="closeSearchGenreDropdownOverlay();closeAutocomplete();runSearch()" title="Suche starten" aria-label="Suche starten">🔍</button>
      </div>
      <button class="btn" id="navBtnWishlist" onclick="loadWishlist('root')" title="Synchronisierte Merkliste & Playlisten"><span class="top-btn-icon">💾</span><span class="top-btn-label"> Merkliste</span></button>
      <button type="button" id="heroHideBtn" class="hero-hide-btn hero-top-dock-hide-btn" onclick="toggleHeroSliderHidden()" title="Kino-Spotlight ein- oder ausklappen"><span class="top-btn-icon">▴</span><span class="top-btn-label"> Einklappen</span></button>
      <div id="topBarAdjNavGroup" class="detail-adj-nav">
        <button type="button" id="modalAdjPrevBtn" class="top-adj-nav-btn" onclick="navigateDetailModalAdjacent(-1)" title="Vorheriger Titel (L1 / LB)">◀</button>
        <button type="button" id="modalAdjNextBtn" class="top-adj-nav-btn" onclick="navigateDetailModalAdjacent(1)" title="Nächster Titel (R1 / RB)">▶</button>
      </div>
      <div id="searchGenreDropdownOverlay" class="search-genre-dropdown-overlay" role="listbox" aria-label="Genre wählen" onmousedown="event.preventDefault()"></div>
      <div id="searchAutocompleteBox" class="search-autocomplete-box" role="listbox" aria-label="Suchvorschläge" onmousedown="event.preventDefault()"></div>
    </header>
    <div id="catalogEdgeTriggerLeft" class="catalog-edge-trigger-left" onclick="if(!state.sidebarOpen)toggleFilterSidebar()" onmouseenter="if(!state.sidebarOpen&&!document.body.classList.contains('in-hero-slider')){toggleFilterSidebar();}" title="Menü-Übersicht direkt öffnen"></div>
    <div id="catalogEdgeTriggerRight" class="catalog-edge-trigger-right" onmouseenter="const el=document.getElementById('tvQuickJumpElevator');if(el){el.classList.add('is-hover-expanded');if(typeof syncRightMenuBadgesClient==='function')syncRightMenuBadgesClient();}" onmouseleave="const el=document.getElementById('tvQuickJumpElevator');if(el&&!el.classList.contains('has-subpanel'))el.classList.remove('is-hover-expanded')" aria-hidden="true"></div>
    <nav id="tvQuickJumpElevator" class="tv-quick-jump-elevator" onmouseenter="if(typeof syncRightMenuBadgesClient==='function')syncRightMenuBadgesClient()" onmouseleave="if(!this.classList.contains('has-subpanel'))this.classList.remove('is-hover-expanded')" aria-label="Katalog-Navigation">
      <div id="rightMenuSubPanel" class="tv-elevator-subpanel" aria-live="polite"></div>
      <div class="tv-elevator-main-col">
        <button type="button" id="tvElevBtnSearch" class="tv-elevator-btn" onclick="focusSearchWithoutScrollClient()" title="Suche aktivieren (ohne Hochscrollen)"><span>🔍</span><span class="tv-elev-label">Suche</span></button>
        <button type="button" id="tvElevBtnBot" class="tv-elevator-btn" onclick="openPageJumpFromElevatorClient()" title="Seite direkt wählen"><span>📄</span><span class="tv-elev-label">Seite</span></button>
        <button type="button" id="tvElevBtnTop" class="tv-elevator-btn" onclick="scrollToTopFromElevatorClient()" title="Ganz nach oben scrollen"><span>⬆️</span><span class="tv-elev-label">Nach oben</span></button>
        <button type="button" id="tvElevBtnWishlist" class="tv-elevator-btn" data-rm-tab="wishlist" onclick="toggleRightMenuSubPanelClient('wishlist')" title="Merkliste direkt im rechten Menü öffnen, filtern & sortieren"><span>💾</span><span class="tv-elev-label">Merkliste</span><span id="tvElevBadgeWishlist" class="tv-elev-count-badge" style="display:none">0</span></button>
        <button type="button" id="tvElevBtnRecent" class="tv-elevator-btn" data-rm-tab="recent" onclick="toggleRightMenuSubPanelClient('recent')" title="Zuletzt gesehen direkt im rechten Menü öffnen, filtern & sortieren"><span>🕒</span><span class="tv-elev-label">Zuletzt</span><span id="tvElevBadgeRecent" class="tv-elev-count-badge" style="display:none">0</span></button>
      </div>
    </nav>
    <div id="elevatorBackdrop" class="elevator-backdrop" onclick="closeRightMenuSubPanelClient()" aria-hidden="true"></div>

    <!-- Linke 2-Spalten Ambilight-Glas Sidebar (Links: Einzeilige Kategorien | Rechts: Dynamisches Optionen-Panel) -->
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
          <button class="btn danger" style="padding:4px 8px;font-size:11px" onclick="setDirectFilter('reset_all','','neutral')" title="Alle aktiven Filter zurücksetzen">🗑️ Reset</button>
          <button class="btn close-slate" onclick="closeFilterSidebar()" title="Sidebar schließen">✖</button>
        </div>
      </div>
      <div class="sidebar-columns-wrap">
        <div id="sidebarDrawerBody" class="sidebar-body"></div>
        <div id="sidebarRightSubPanel" class="sidebar-right-subpanel" aria-live="polite"></div>
      </div>
    </aside>

    <div id="busyOverlayBar">
      <div class="spinner"></div>
      <span id="busyOverlayText">⏳ Filter wird angewendet – lade passende Ergebnisse nach...</span>
    </div>

    <div id="hudToast"></div>
    <div id="liveZoomBadgeEl" aria-live="polite">🔍 Zoom: 100%</div>
    <div id="controllerHudBar" aria-hidden="true"></div>
    <div id="antiSpamHudMount" style="position:fixed;bottom:14px;right:14px;left:14px;max-width:480px;margin-left:auto;z-index:1550;pointer-events:none;display:none"></div>
    <div id="modalHoldNavIndicator" class="modal-hold-nav-indicator">
      <span id="modalHoldNavText">⏩ Halten zum Weiterblättern...</span>
      <div class="modal-hold-nav-track"><div id="modalHoldNavBar" class="modal-hold-nav-bar"></div></div>
    </div>
    <div id="customDialogRoot"></div>

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
      if (tg) {
        try {
          tg.ready();
          tg.expand();
          if (typeof tg.disableVerticalSwipes === "function") {
            tg.disableVerticalSwipes();
          }
        } catch (e) {}
      }

      function syncTelegramBackButtonClient() {
        try {
          const liveTg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : tg;
          if (!liveTg || !liveTg.BackButton) return;
          const modalRoot = document.getElementById("modalRoot");
          const hasModal = Boolean(modalRoot && modalRoot.innerHTML.trim().length > 0);
          const spotlightRoot = document.getElementById("personSpotlightOverlayRoot");
          const hasSpotlight = Boolean(spotlightRoot && spotlightRoot.innerHTML.trim().length > 0);
          const pageJumpRoot = document.getElementById("pageJumpModalRoot");
          const hasPageJump = Boolean(pageJumpRoot && pageJumpRoot.innerHTML.trim().length > 0);
          const isSidebarOpen = Boolean(typeof state !== "undefined" && state.sidebarOpen);
          const isNonDiscoverView = Boolean(typeof state !== "undefined" && state.currentView && state.currentView !== "discover");

          if (hasModal || hasSpotlight || hasPageJump || isSidebarOpen || isNonDiscoverView) {
            liveTg.BackButton.show();
            if (typeof liveTg.BackButton.offClick === "function") {
              liveTg.BackButton.offClick(handleTelegramBackButtonClickClient);
            }
            liveTg.BackButton.onClick(handleTelegramBackButtonClickClient);
          } else {
            liveTg.BackButton.hide();
            if (typeof liveTg.BackButton.offClick === "function") {
              liveTg.BackButton.offClick(handleTelegramBackButtonClickClient);
            }
          }
        } catch (e) {}
      }

      function handleTelegramBackButtonClickClient() {
        try {
          const modalRoot = document.getElementById("modalRoot");
          if (modalRoot && modalRoot.innerHTML.trim().length > 0) {
            if (typeof closeDetailModal === "function") closeDetailModal();
            syncTelegramBackButtonClient();
            return;
          }
          const spotlightRoot = document.getElementById("personSpotlightOverlayRoot");
          if (spotlightRoot && spotlightRoot.innerHTML.trim().length > 0 && typeof closePersonSpotlightOverlayClient === "function") {
            closePersonSpotlightOverlayClient();
            syncTelegramBackButtonClient();
            return;
          }
          const pageJumpRoot = document.getElementById("pageJumpModalRoot");
          if (pageJumpRoot && pageJumpRoot.innerHTML.trim().length > 0 && typeof closePageJumpModalClient === "function") {
            closePageJumpModalClient();
            syncTelegramBackButtonClient();
            return;
          }
          if (typeof state !== "undefined" && state.sidebarOpen && typeof closeSidebarMenuClient === "function") {
            closeSidebarMenuClient();
            syncTelegramBackButtonClient();
            return;
          }
          if (typeof state !== "undefined" && state.currentView && state.currentView !== "discover" && typeof switchMainViewClient === "function") {
            switchMainViewClient("discover");
            syncTelegramBackButtonClient();
            return;
          }
        } catch (e) {}
      }

      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        window.addEventListener("load", function() {
          navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function() {});
        });
      }

      window.addEventListener("offline", function() {
        if (typeof showHudToast === "function") {
          showHudToast("📡 Offline – Gecachte Filme & Merkliste bleiben verfügbar.");
        }
      });
      window.addEventListener("online", function() {
        if (typeof showHudToast === "function") {
          showHudToast("🟢 Verbindung wiederhergestellt");
        }
      });
      function extractClientTelegramInitData() {
        try {
          const liveTg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : tg;
          if (liveTg && typeof liveTg.initData === "string" && liveTg.initData.trim().length > 0) {
            return liveTg.initData.trim();
          }
        } catch (e) {}
        try {
          const hashStr = String(window.location.hash || "").replace(/^#/, "");
          if (hashStr) {
            const hashParams = new URLSearchParams(hashStr);
            const fromHash = hashParams.get("tgWebAppData");
            if (fromHash && fromHash.trim().length > 0) return fromHash.trim();
          }
        } catch (e) {}
        try {
          const searchParams = new URLSearchParams(window.location.search || "");
          const fromSearch = searchParams.get("tgWebAppData");
          if (fromSearch && fromSearch.trim().length > 0) return fromSearch.trim();
        } catch (e) {}
        return "";
      }
      function extractClientTelegramLaunchToken() {
        try {
          const searchParams = new URLSearchParams(window.location.search || "");
          const fromSearch = searchParams.get("tgLaunch");
          if (fromSearch && fromSearch.trim().length > 0) return fromSearch.trim();
        } catch (e) {}
        try {
          const hashStr = String(window.location.hash || "").replace(/^#/, "");
          if (hashStr) {
            const hashParams = new URLSearchParams(hashStr);
            const fromHash = hashParams.get("tgLaunch");
            if (fromHash && fromHash.trim().length > 0) return fromHash.trim();
          }
        } catch (e) {}
        return "";
      }
      let rawInitData = extractClientTelegramInitData();
      let rawLaunchToken = extractClientTelegramLaunchToken();
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
          .replace(/[^a-z0-9\\s]/g, " ")
          .replace(/\\s+/g, " ")
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

      function shareCollectionOrUniverseFromBtn(btn) {
        if (!btn) return;
        const kind = btn.getAttribute("data-kind") || "col";
        const id = btn.getAttribute("data-id") || "";
        const title = btn.getAttribute("data-title") || "";
        shareCollectionOrUniverseFromTma(kind, id, title);
      }

      function updateSyncBadge() {
        const b = document.getElementById("syncBadge");
        const admBtn = document.getElementById("adminHeaderBtn");
        if (b) {
          b.style.color = "";
          b.style.borderColor = "";
          if (state && state.isAuthenticated && state.authUser) {
            const u = state.authUser;
            const label = u.customUsername || (u.tgUsername ? "@" + u.tgUsername : ("ID " + u.telegramId));
            const vipTag = u.isVip ? " 🌟VIP" : "";
            const admTag = u.isAdmin ? " 👑" : "";
            b.className = "btn sidebar-account-btn is-auth";
            b.innerHTML = '<span>🟢 ' + esc(label + vipTag + admTag) + '</span><span class="sidebar-account-cta">🔐 Konto öffnen ▸</span>';
            if (admBtn) admBtn.style.display = u.isAdmin ? "inline-flex" : "none";
          } else {
            b.className = "btn sidebar-account-btn is-guest";
            b.innerHTML = '<span>👤 Gast • Login</span><span class="sidebar-account-cta">🔐 Konto öffnen ▸</span>';
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
      let trailerPreviewEnabled = (function() {
        try {
          const v = localStorage.getItem("tma_trailer_preview_enabled");
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

      // Empfohlene Telegram Mini-App Farbpaletten (Header, Body & Bottom-Bar)
      const TELEGRAM_THEME_PALETTES_CLIENT = {
        neon: {
          name: "🌌 Neon-Cinema (Empfohlen für @BotFather)",
          headerColor: "#0B1021",
          backgroundColor: "#070B19",
          bottomBarColor: "#090D1C",
          accentCyan: "#00F0FF",
          accentViolet: "#8B5CF6"
        },
        cyberpunk: {
          name: "⚡ Cyberpunk Neon",
          headerColor: "#0B1021",
          backgroundColor: "#070B19",
          bottomBarColor: "#090D1C",
          accentCyan: "#00F0FF",
          accentViolet: "#8B5CF6"
        },
        dark: {
          name: "🌙 Classic Dark Cinema",
          headerColor: "#0E0E16",
          backgroundColor: "#08080C",
          bottomBarColor: "#0C0C12",
          accentCyan: "#38BDF8",
          accentViolet: "#E50914"
        },
        light: {
          name: "☀️ Daylight Studio",
          headerColor: "#F1F5F9",
          backgroundColor: "#F8FAFC",
          bottomBarColor: "#E2E8F0",
          accentCyan: "#0284C7",
          accentViolet: "#6366F1"
        }
      };

      function syncTelegramWebAppColorsClient(themeKey = "", customColors = null) {
        const pal = customColors || TELEGRAM_THEME_PALETTES_CLIENT[themeKey || appTheme] || TELEGRAM_THEME_PALETTES_CLIENT.neon;
        try {
          const tgApp = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
          if (tgApp) {
            if (typeof tgApp.setHeaderColor === "function") tgApp.setHeaderColor(pal.headerColor);
            if (typeof tgApp.setBackgroundColor === "function") tgApp.setBackgroundColor(pal.backgroundColor);
            if (typeof tgApp.setBottomBarColor === "function") tgApp.setBottomBarColor(pal.bottomBarColor);
          }
          let metaTheme = document.querySelector('meta[name="theme-color"]');
          if (!metaTheme) {
            metaTheme = document.createElement("meta");
            metaTheme.name = "theme-color";
            document.head.appendChild(metaTheme);
          }
          metaTheme.content = pal.headerColor;
        } catch (e) {}
        return pal;
      }

      function dismissBootSplashscreen() {
        const el = document.getElementById("tmaBootSplashscreen");
        if (!el || el.classList.contains("splash-hidden")) return;
        el.classList.add("splash-hidden");
        setTimeout(() => {
          try { if (el && el.classList.contains("splash-hidden")) el.style.display = "none"; } catch (e) {}
        }, 420);
      }

      function previewBootSplashscreenClient() {
        const el = document.getElementById("tmaBootSplashscreen");
        if (!el) return;
        el.style.display = "flex";
        requestAnimationFrame(() => {
          el.classList.remove("splash-hidden");
        });
        setTimeout(() => {
          dismissBootSplashscreen();
        }, 1800);
      }
      setTimeout(dismissBootSplashscreen, 1500);

      function applyThemeAndAccessibilityToDom() {
        document.body.setAttribute("data-theme", appTheme || "dark");
        document.body.setAttribute("data-colorblind", colorblindMode ? "1" : "0");
        document.body.setAttribute("data-hover-nav", mouseHoverNavEnabled ? "1" : "0");
        syncTelegramWebAppColorsClient(appTheme || "dark");
      }
      applyThemeAndAccessibilityToDom();

      function setAppTheme(nextTheme) {
        appTheme = nextTheme || "dark";
        try { localStorage.setItem("tma_theme", appTheme); } catch (e) {}
        applyThemeAndAccessibilityToDom();
        if (state && state.sidebarOpen) renderFilterSidebarContent();
        const themeLabel = appTheme === "light" ? "☀️ Light Mode" : appTheme === "cyberpunk" ? "⚡ Cyberpunk / Neon-Cinema Mode" : "🌙 Dark Mode";
        showHudToast("🎨 Design & Telegram-Farben: " + themeLabel);
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
            stBtn.className = "btn " + (mouseHoverNavEnabled ? "blue" : "");
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
            stBtn.className = "btn " + (modalHoldNavEnabled ? "blue" : "");
            stBtn.innerHTML = '<span>⏩ Detailansicht: Pfeiltaste ⬅️/➡️ gedrückt halten (~450ms) für nächsten/vorherigen Titel</span><b>' + (modalHoldNavEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>';
            if (!state.sidebarOpen && typeof jumpSpatialFocus === "function") jumpSpatialFocus(stBtn, false);
          }
        }
        showHudToast(modalHoldNavEnabled ? "⏩ Pfeiltaste gedrückt halten (450ms) im Detail-Modal: AKTIV" : "⏩ Pfeiltaste gedrückt halten im Detail-Modal: AUS");
      }

      function toggleTrailerPreviewSettingClient() {
        trailerPreviewEnabled = !trailerPreviewEnabled;
        try { localStorage.setItem("tma_trailer_preview_enabled", trailerPreviewEnabled ? "1" : "0"); } catch (e) {}
        if (state && state.sidebarOpen) {
          renderFilterSidebarContent(false);
          const sbBtn = document.getElementById("sidebarTrailerPreviewBtn") || document.getElementById("sidebarTrailerPreviewQuickBtn");
          if (sbBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(sbBtn, false);
        }
        if (state && state.currentView === "settings") {
          const stBtn = document.getElementById("settingsTrailerPreviewBtn");
          if (stBtn) {
            stBtn.className = "btn " + (trailerPreviewEnabled ? "blue" : "");
            stBtn.innerHTML = '<span>🎥 Automatische Trailer-Vorschau auf der Detailbühne (Netflix-Modus)</span><b>' + (trailerPreviewEnabled ? 'AKTIV (EIN)' : 'INAKTIV (AUS)') + '</b>';
            if (!state.sidebarOpen && typeof jumpSpatialFocus === "function") jumpSpatialFocus(stBtn, false);
          }
        }
        const stageEl = document.getElementById("detailHeroStageEl");
        if (stageEl && state && state.activeDetails) {
          if (!trailerPreviewEnabled && !stageEl.classList.contains("is-trailer-foreground-mode")) {
            if (typeof stopDetailBackgroundVideoTeaserClient === "function") {
              stopDetailBackgroundVideoTeaserClient();
            }
          } else if (trailerPreviewEnabled && typeof scheduleDetailBackgroundVideoTeaserClient === "function") {
            scheduleDetailBackgroundVideoTeaserClient(state.activeDetails.trailers, false);
          }
        }
        showHudToast(trailerPreviewEnabled ? "🎥 Automatische Trailer-Vorschau: EIN (Netflix-Modus)" : "🎥 Automatische Trailer-Vorschau: AUS (Nur bei Klick auf Trailer)");
      }

      let hudToastTimer = null;
      function showHudToast(msg) {
        const el = document.getElementById("hudToast");
        if (!el) return;
        el.textContent = msg;
        el.title = "Antippen zum Ausblenden";
        el.onclick = () => {
          if (hudToastTimer) clearTimeout(hudToastTimer);
          el.style.display = "none";
        };
        el.style.display = "block";
        if (hudToastTimer) clearTimeout(hudToastTimer);
        hudToastTimer = setTimeout(() => { el.style.display = "none"; }, 2500);
      }

      // Nicht-blockierende Custom Dialoge (Ersatz für window.prompt & window.confirm im iFrame/Telegram WebApp)
      let activeCustomDialogResolver = null;
      let lastCustomDialogTriggerEl = null;
      function closeCustomDialog(resultValue) {
        const root = document.getElementById("customDialogRoot");
        if (root) root.innerHTML = "";
        if (activeCustomDialogResolver) {
          const fn = activeCustomDialogResolver;
          activeCustomDialogResolver = null;
          fn(resultValue);
        }
        if (lastCustomDialogTriggerEl && document.body.contains(lastCustomDialogTriggerEl) && typeof jumpSpatialFocus === "function") {
          const restoreEl = lastCustomDialogTriggerEl;
          lastCustomDialogTriggerEl = null;
          setTimeout(() => jumpSpatialFocus(restoreEl, false), 20);
        }
      }

      function showCustomConfirm(messageText, confirmLabel = "✅ Bestätigen") {
        return new Promise((resolve) => {
          activeCustomDialogResolver = resolve;
          const root = document.getElementById("customDialogRoot");
          if (!root) { resolve(true); return; }
          const curEl = (typeof currentSpatialEl !== "undefined" && currentSpatialEl) ? currentSpatialEl : document.activeElement;
          if (curEl && curEl !== document.body && !root.contains(curEl)) {
            lastCustomDialogTriggerEl = curEl;
          }
          const isDangerConfirm = /lösch|reset|leeren|entfern|trennen|deaktivier|abmeld/i.test(String(confirmLabel || "") + " " + String(messageText || ""));
          root.innerHTML = '<div class="modal-backdrop" style="z-index:1600;align-items:center" onclick="if(event.target===this)closeCustomDialog(false)">' +
            '<div class="modal" style="max-width:420px;padding:18px;border:1px solid rgba(255,255,255,0.2)">' +
              '<div style="font-size:15px;font-weight:800;margin-bottom:10px">🛡️ Bestätigung</div>' +
              '<div style="font-size:13px;color:var(--text-muted);line-height:1.5;margin-bottom:16px">' + esc(messageText) + '</div>' +
              '<div style="display:flex;justify-content:flex-end;gap:8px">' +
                '<button id="customConfirmCancelBtn" class="btn" onclick="closeCustomDialog(false)">Abbrechen</button>' +
                '<button id="customConfirmOkBtn" class="btn ' + (isDangerConfirm ? 'danger' : 'red') + '" onclick="closeCustomDialog(true)">' + esc(confirmLabel) + '</button>' +
              '</div>' +
            '</div>' +
          '</div>';
          setTimeout(() => {
            const okBtn = document.getElementById("customConfirmOkBtn");
            if (okBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(okBtn, false);
          }, 25);
        });
      }

      function showCustomPrompt(titleText, defaultValue = "") {
        return new Promise((resolve) => {
          activeCustomDialogResolver = resolve;
          const root = document.getElementById("customDialogRoot");
          if (!root) { resolve(defaultValue || null); return; }
          const curEl = (typeof currentSpatialEl !== "undefined" && currentSpatialEl) ? currentSpatialEl : document.activeElement;
          if (curEl && curEl !== document.body && !root.contains(curEl)) {
            lastCustomDialogTriggerEl = curEl;
          }
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

      let liveZoomBadgeTimer = null;
      function showLiveZoomBadgeClient(labelText) {
        const el = document.getElementById("liveZoomBadgeEl");
        if (!el) return;
        el.textContent = labelText || ("🔍 Zoom: " + Number(uiScale.all || 100) + "%");
        el.classList.add("visible");
        if (liveZoomBadgeTimer) clearTimeout(liveZoomBadgeTimer);
        liveZoomBadgeTimer = setTimeout(() => {
          el.classList.remove("visible");
        }, 1500);
      }

      function applyUiScaleToDom() {
        const root = document.documentElement;
        const w = window.innerWidth || 1024;
        // Auf 1080p-Laptop/PC (>= 900px) entspricht 100% Standardgröße direkt dem gewünschten 145%-Kino-Feeling!
        const desktopCinemaBoost = w >= 900 ? 1.42 : (w >= 700 ? 1.15 : 1.0);
        const sAll = Math.min(1.65, Math.max(0.65, Number(uiScale.all || 100) / 100));
        const sText = Math.min(1.65, Math.max(0.7, Number(uiScale.text || 100) / 100));
        const sCover = Math.min(1.85, Math.max(0.65, Number(uiScale.cover || 100) / 100));
        const sMenu = Math.min(1.55, Math.max(0.7, Number(uiScale.menu || 100) / 100));
        root.style.setProperty("--desktop-cinema-boost", desktopCinemaBoost.toFixed(3));
        root.style.setProperty("--scale-all", (sAll * desktopCinemaBoost).toFixed(3));
        root.style.setProperty("--scale-text", (sText * sAll * desktopCinemaBoost).toFixed(3));
        root.style.setProperty("--scale-cover", (sCover * sAll * desktopCinemaBoost).toFixed(3));
        root.style.setProperty("--scale-menu", (sMenu * sAll * Math.min(1.22, desktopCinemaBoost)).toFixed(3));
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
        applyUiScaleToDom();
      }
      detectClientDeviceAndAdapt();
      window.addEventListener("resize", detectClientDeviceAndAdapt);

      function setUiScaleValue(key, val, persistRemote = true) {
        const clamped = Math.min(160, Math.max(65, Number(val) || 100));
        uiScale[key] = clamped;
        try { localStorage.setItem("tma_ui_scale", JSON.stringify(uiScale)); } catch (e) {}
        applyUiScaleToDom();
        if (state && state.sidebarOpen) renderFilterSidebarContent(false);
        const labelPrefix = key === "all" ? "🔍 Zoom" : key === "text" ? "🔤 Textgröße" : key === "cover" ? "🖼️ Covergröße" : "🎛️ Menügröße";
        showLiveZoomBadgeClient(labelPrefix + ": " + clamped + "%");
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
        if (state && state.sidebarOpen) renderFilterSidebarContent(false);
        showLiveZoomBadgeClient("🔍 Zoom: 100% (Standard)");
        fetch(API_BASE + "/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, action: "save_ui_scale", uiScale })
        }).catch(() => {});
      }

      function focusFirstSidebarFilterOption() {
        const subPanel = document.getElementById("sidebarRightSubPanel");
        if (subPanel && state.sidebarTab) {
          const firstSubBtn = subPanel.querySelector(".direct-filter-grid .df-btn.inc, .direct-filter-grid .df-btn, .scale-opts .btn, #sidebarThemeBtn_dark, .btn");
          if (firstSubBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstSubBtn, true);
            return;
          }
        }
        const body = document.getElementById("sidebarDrawerBody");
        if (!body) return;
        const firstCatTab = body.querySelector(".sidebar-menu-row");
        if (firstCatTab && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(firstCatTab, false);
        }
      }

      function closeSidebarSubPanelToMain() {
        const prevTab = state.sidebarTab;
        state.sidebarTab = null;
        state.sidebarDesignOpen = false;
        state.sidebarScaleOpen = false;
        renderFilterSidebarContent(false);
        if (prevTab) {
          const rowBtn = document.getElementById("sidebarCatTab_" + prevTab) || document.getElementById("sidebarSecBtn_" + prevTab);
          if (rowBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(rowBtn, true);
          }
        }
      }

      function toggleFilterSidebar(initialTab) {
        if (initialTab) {
          state.sidebarTab = initialTab;
          state.sidebarOpen = true;
        } else {
          state.sidebarOpen = !state.sidebarOpen;
          if (state.sidebarOpen) {
            state.sidebarTab = null;
          }
        }
        const drawer = document.getElementById("filterSidebarDrawer");
        const backdrop = document.getElementById("sidebarBackdrop");
        if (drawer) drawer.classList.toggle("open", Boolean(state.sidebarOpen));
        if (backdrop) backdrop.classList.toggle("open", Boolean(state.sidebarOpen));
        if (state.sidebarOpen) {
          renderFilterSidebarContent(Boolean(state.sidebarTab));
          if (!state.sidebarTab) {
            const firstCatTab = document.getElementById("sidebarCatTab_genres") || document.querySelector("#sidebarDrawerBody .sidebar-menu-row");
            if (firstCatTab && typeof jumpSpatialFocus === "function") {
              jumpSpatialFocus(firstCatTab, false);
            }
          }
        } else {
          state.sidebarTab = null;
          if (drawer) drawer.classList.remove("has-subpanel");
          if (typeof lastElevatorReturnEl !== "undefined" && lastElevatorReturnEl && document.body.contains(lastElevatorReturnEl) && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(lastElevatorReturnEl, false);
            lastElevatorReturnEl = null;
          } else if (typeof focusFirstResultCard === "function") {
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
        if (drawer) {
          drawer.classList.remove("open", "has-subpanel");
        }
        if (backdrop) backdrop.classList.remove("open");
        if (typeof lastElevatorReturnEl !== "undefined" && lastElevatorReturnEl && document.body.contains(lastElevatorReturnEl) && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(lastElevatorReturnEl, false);
          lastElevatorReturnEl = null;
        } else if (typeof focusFirstResultCard === "function") {
          focusFirstResultCard(false);
        }
      }

      function switchSidebarCategoryTab(tabName, jumpIntoRightPanel = true) {
        if (state.sidebarTab === tabName && !jumpIntoRightPanel) {
          closeSidebarSubPanelToMain();
          return;
        }
        state.sidebarTab = tabName;
        renderFilterSidebarContent(Boolean(jumpIntoRightPanel));
      }

      function toggleSidebarExtraSection(secName) {
        switchSidebarCategoryTab(secName, true);
      }

      function toggleTmaFullscreenClient() {
        try {
          const tgWebApp = window.Telegram && window.Telegram.WebApp;
          if (tgWebApp && typeof tgWebApp.requestFullscreen === "function") {
            if (tgWebApp.isFullscreen && typeof tgWebApp.exitFullscreen === "function") {
              tgWebApp.exitFullscreen();
              showHudToast("🗗 Telegram Vollbild-Modus beendet.");
            } else {
              tgWebApp.requestFullscreen();
              showHudToast("⛶ Telegram Bot API 8.0 Vollbild-Modus aktiviert!");
            }
            return;
          }
          if (tgWebApp && typeof tgWebApp.expand === "function") {
            tgWebApp.expand();
          }
          if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().then(() => {
              showHudToast("⛶ Vollbild-Modus aktiviert!");
            }).catch(() => {
              showHudToast("⛶ Mini-App auf maximale Höhe erweitert!");
            });
          } else if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
            showHudToast("🗗 Vollbild-Modus beendet.");
          } else {
            showHudToast("⛶ Mini-App auf maximale Höhe erweitert!");
          }
        } catch (e) {
          showHudToast("⛶ Vollbild-Umschaltung ausgeführt.");
        }
      }

      function addTmaToHomeScreenClient() {
        try {
          const tgWebApp = window.Telegram && window.Telegram.WebApp;
          if (tgWebApp && typeof tgWebApp.addToHomeScreen === "function") {
            tgWebApp.addToHomeScreen();
            showHudToast("📲 Telegram Home-Screen-Verknüpfung angefragt!");
            return;
          }
        } catch (e) {}
        showHudToast("📲 Tipp: Öffne die Mini-App in Telegram (ab v11.4 / Bot API 8.0) oder nutze im Browser „Zum Startbildschirm hinzufügen“.");
      }

      function renderFilterSidebarContent(jumpToOptions = false) {
        const body = document.getElementById("sidebarDrawerBody");
        const subPanel = document.getElementById("sidebarRightSubPanel");
        const drawer = document.getElementById("filterSidebarDrawer");
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
            '<span class="scale-label">' + label + ' <b style="color:var(--blue)">' + cur + '%</b></span>' +
            '<div class="scale-opts">' +
              '<button id="sbScale_' + key + '_dec" class="btn" onclick="setUiScaleValue(\\'' + key + '\\',' + (cur - 5) + ')">➖</button>' +
              presets.map(p => '<button id="sbScale_' + key + '_' + p.v + '" class="btn ' + (cur === p.v ? 'blue' : '') + '" onclick="setUiScaleValue(\\'' + key + '\\',' + p.v + ')">' + p.l + '</button>' ).join("") +
              '<button id="sbScale_' + key + '_inc" class="btn" onclick="setUiScaleValue(\\'' + key + '\\',' + (cur + 5) + ')">➕</button>' +
            '</div>' +
          '</div>';
        };

        const themeBadge = appTheme === "light" ? "☀️ Light" : appTheme === "cyberpunk" ? "⚡ Cyber" : "🌙 Dark";
        const scaleBadge = Number(uiScale.all || 100) + "%";
        const isAuth = Boolean(state && state.isAuthenticated && state.authUser);
        const u = (state && state.authUser) || {};
        const accLabel = isAuth
          ? ("🟢 " + (u.customUsername || (u.tgUsername ? "@" + u.tgUsername : ("ID " + u.telegramId))) + (u.isVip ? " 🌟VIP" : "") + (u.isAdmin ? " 👑" : ""))
          : "👤 Gast • Login";

        const prevFocusDfId = (!jumpToOptions && typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.getAttribute)
          ? currentSpatialEl.getAttribute("data-df-id")
          : null;
        const prevFocusElId = (!jumpToOptions && typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.id)
          ? currentSpatialEl.id
          : null;

        const totalCatFilters = gCount + pCount + eCount + stCount + fCount + (s.onlyVipStreams ? 1 : 0);

        // Linke Hauptspalte: Kompakter Konto-Kopfbereich -> Direkt darunter Katalog-Filter im Hauptfokus -> Ansicht -> Kompakte Werkzeuge unten
        body.innerHTML =
          /* 0. Konto & Schnell-Entdecken */
          '<div class="sidebar-section">' +
            '<div class="sidebar-nav-grid">' +
              '<button id="syncBadge" class="btn sidebar-account-btn ' + (isAuth ? 'is-auth' : 'is-guest') + '" style="grid-column:1 / -1;justify-content:space-between" onclick="closeFilterSidebar();openAccountModal()">' +
                '<span>' + esc(accLabel) + '</span><span class="sidebar-account-cta">🔐 Konto ▸</span>' +
              '</button>' +
              (u.isAdmin ? (
                '<button id="adminHeaderBtn" class="btn blue" style="grid-column:1 / -1;justify-content:center" onclick="closeFilterSidebar();loadAdminPanelView()">👑 Admin-Dashboard & VIP-Verwaltung</button>'
              ) : '') +
              '<button id="sidebarRandomBtn" class="btn" onclick="closeFilterSidebar();triggerRandom()" title="Zufälligen Titel mit aktiven Filtern ziehen">' +
                (state.type === 's' ? '🎲 Zufalls-Serie' : '🎲 Zufalls-Film') +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();loadFranchisesHub()" title="Alle Filmreihen & Filmuniversen öffnen">' +
                '🌌 Welten & Reihen' +
              '</button>' +
            '</div>' +
          '</div>' +

          /* 1. Katalog-Filter direkt im oberen Hauptblickfeld (Rechts öffnen sich die Optionen nach Auswahl) */
          '<div class="sidebar-section">' +
            '<div class="sidebar-section-title">' +
              '<span>🎛️ Katalog-Filter' + (totalCatFilters > 0 ? (' (' + totalCatFilters + ' aktiv)') : '') + '</span>' +
              '<span style="font-size:10px;color:var(--muted)">Optionen ▸</span>' +
            '</div>' +
            '<div class="sidebar-menu-stack">' +
              '<button type="button" id="sidebarCatTab_genres" data-sb-cat="genres" class="sidebar-menu-row ' + (curTab === 'genres' ? 'active' : '') + (gCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'genres\\',true)">' +
                '<span class="sidebar-menu-row-left">🎞️ Genres</span>' +
                '<span class="sidebar-menu-row-right">' + (gCount ? (gCount + ' aktiv ') : '') + '▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarCatTab_platforms" data-sb-cat="platforms" class="sidebar-menu-row ' + (curTab === 'platforms' ? 'active' : '') + (pCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'platforms\\',true)">' +
                '<span class="sidebar-menu-row-left">📺 Streaming-Anbieter</span>' +
                '<span class="sidebar-menu-row-right">' + (pCount ? (pCount + ' aktiv ') : '') + '▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarCatTab_eras" data-sb-cat="eras" class="sidebar-menu-row ' + (curTab === 'eras' ? 'active' : '') + (eCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'eras\\',true)">' +
                '<span class="sidebar-menu-row-left">📅 Epochen & Jahrzehnte</span>' +
                '<span class="sidebar-menu-row-right">' + (eCount ? (eCount + ' aktiv ') : '') + '▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarCatTab_studios" data-sb-cat="studios" class="sidebar-menu-row ' + (curTab === 'studios' ? 'active' : '') + (stCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'studios\\',true)">' +
                '<span class="sidebar-menu-row-left">🏢 Studios & Produktion</span>' +
                '<span class="sidebar-menu-row-right">' + (stCount ? (stCount + ' aktiv ') : '') + '▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarCatTab_fsk" data-sb-cat="fsk" class="sidebar-menu-row ' + (curTab === 'fsk' ? 'active' : '') + (fCount ? ' has-inc' : '') + '" onclick="switchSidebarCategoryTab(\\'fsk\\',true)">' +
                '<span class="sidebar-menu-row-left">🔞 Altersfreigabe (FSK)</span>' +
                '<span class="sidebar-menu-row-right">' + (fCount ? (fCount + ' aktiv ') : '') + '▸</span>' +
              '</button>' +
              (isCurrentUserVip() ? (
                '<button type="button" id="sidebarVipStreamsOnlyBtn" class="sidebar-menu-row ' + (s.onlyVipStreams ? 'active has-inc' : '') + '" onclick="setDirectFilter(\\'vip_streams\\',\\'\\',\\'toggle\\')">' +
                  '<span class="sidebar-menu-row-left">🌟 Nur mit verfügbarem Stream</span>' +
                  '<span class="sidebar-menu-row-right">' + (s.onlyVipStreams ? 'AKTIV ✓' : 'ALLE') + '</span>' +
                '</button>'
              ) : '') +
            '</div>' +
          '</div>' +

          /* 2. Darstellung & Skalierung ebenfalls einzeilig in der linken Übersicht */
          '<div class="sidebar-section">' +
            '<div class="sidebar-section-title">' +
              '<span>✨ Ansicht & Komfort</span>' +
            '</div>' +
            '<div class="sidebar-menu-stack">' +
              '<button type="button" id="sidebarSecBtn_design" data-sb-cat="design" class="sidebar-menu-row ' + (curTab === 'design' ? 'active' : '') + '" onclick="switchSidebarCategoryTab(\\'design\\',true)">' +
                '<span class="sidebar-menu-row-left">🎨 Darstellung & Komfort</span>' +
                '<span class="sidebar-menu-row-right">' + themeBadge + ' ▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarSecBtn_scale" data-sb-cat="scale" class="sidebar-menu-row ' + (curTab === 'scale' ? 'active' : '') + '" onclick="switchSidebarCategoryTab(\\'scale\\',true)">' +
                '<span class="sidebar-menu-row-left">🔠 Skalierung & Textgröße</span>' +
                '<span class="sidebar-menu-row-right">' + scaleBadge + ' ▸</span>' +
              '</button>' +
              '<button type="button" id="sidebarTrailerPreviewQuickBtn" class="sidebar-menu-row ' + (trailerPreviewEnabled ? 'active has-inc' : '') + '" onclick="toggleTrailerPreviewSettingClient()" title="Automatische Trailer-Vorschau auf der Detailbühne ein- oder ausschalten">' +
                '<span class="sidebar-menu-row-left">🎥 Trailer-Vorschau</span>' +
                '<span class="sidebar-menu-row-right">' + (trailerPreviewEnabled ? 'EIN ✓' : 'AUS') + '</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          /* 3. Kompakte System- & App-Werkzeuge am unteren Rand */
          '<div class="sidebar-section">' +
            '<div class="sidebar-section-title">' +
              '<span>🛠️ App & Werkzeuge</span>' +
            '</div>' +
            '<div class="sidebar-nav-grid">' +
              '<button class="btn" onclick="closeFilterSidebar();loadSettingsView()" title="Alle Einstellungen öffnen">' +
                '⚙️ Einstellungen' +
              '</button>' +
              '<button id="sidebarOpenInBotBtn" class="btn" onclick="closeFilterSidebar();openCurrentViewInBot()" title="Aktuelle Ansicht im Telegram-Bot öffnen">' +
                '🤖 Im Bot öffnen' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();toggleTmaFullscreenClient()" title="Bot API 8.0 Vollbild-Modus ein-/ausschalten">' +
                '⛶ Vollbild' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();addTmaToHomeScreenClient()" title="Bot API 8.0 Mini-App Icon auf dem Smartphone-Startbildschirm ablegen">' +
                '📲 Home-Icon' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();goBack()" title="Zurück zur vorherigen Ansicht">' +
                '⬅️ Zurück' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();restartApp()" title="Alle aktiven Filter zurücksetzen & neu starten">' +
                '🔄 Neu starten' +
              '</button>' +
            '</div>' +
          '</div>';

        // Rechtes Optionen-Panel (#sidebarRightSubPanel) aufbauen, sobald eine Kategorie aktiv ist
        if (drawer) {
          drawer.classList.toggle("has-subpanel", Boolean(curTab));
        }
        if (subPanel) {
          if (!curTab) {
            subPanel.innerHTML = "";
          } else {
            let subTitle = "";
            let subContentHtml = "";
            let catActiveCount = 0;
            const isFilterCat = curTab === "genres" || curTab === "platforms" || curTab === "eras" || curTab === "studios" || curTab === "fsk";
            if (curTab === "genres") {
              subTitle = "🎞️ Genres wählen";
              catActiveCount = gCount;
              const allGenreNames = Array.from(new Set([
                ...Object.keys(state.genres || {}),
                "Action", "Abenteuer", "Animation", "Komödie", "Krimi", "Dokumentarfilm", "Drama", "Familie", "Fantasy", "Historie", "Horror", "Musik", "Mystery", "Liebesfilm", "Sci-Fi", "Thriller", "Kriegsfilm", "Western",
                ...(s.includedGenres || []),
                ...(s.excludedGenres || [])
              ]));
              subContentHtml = '<div class="direct-filter-grid">' +
                allGenreNames.map(gName => {
                  const isInc = (s.includedGenres || []).includes(gName);
                  const isExc = (s.excludedGenres || []).includes(gName);
                  return renderDirectFilterOptionCard("genre", gName, genreEmoji(gName) + " " + esc(gName), isInc, isExc);
                }).join("") +
              '</div>';
            } else if (curTab === "platforms") {
              subTitle = "📺 Streaming-Anbieter";
              catActiveCount = pCount;
              subContentHtml = '<div class="direct-filter-grid">' +
                PLATFORM_OPTIONS_CLIENT.map(pl => {
                  const isInc = (s.includedPlatforms || []).includes(pl.id);
                  const isExc = (s.excludedPlatforms || []).includes(pl.id);
                  return renderDirectFilterOptionCard("platform", pl.id, esc((pl.icon || "📺") + " " + pl.label), isInc, isExc);
                }).join("") +
              '</div>';
            } else if (curTab === "eras") {
              subTitle = "📅 Epochen & Jahrzehnte";
              catActiveCount = eCount;
              subContentHtml = '<div class="direct-filter-grid">' +
                ERA_OPTIONS_CLIENT.map(er => {
                  const isInc = (s.includedEras || []).includes(er.id);
                  const isExc = (s.excludedEras || []).includes(er.id);
                  return renderDirectFilterOptionCard("era", er.id, "📅 " + esc(er.label), isInc, isExc);
                }).join("") +
              '</div>';
            } else if (curTab === "studios") {
              subTitle = "🏢 Studios & Produktion";
              catActiveCount = stCount;
              subContentHtml = '<div class="direct-filter-grid">' +
                STUDIO_OPTIONS_CLIENT.map(st => {
                  const isInc = (s.includedStudios || []).includes(st.id);
                  const isExc = (s.excludedStudios || []).includes(st.id);
                  return renderDirectFilterOptionCard("studio", st.id, esc((st.icon || "🏢") + " " + st.label), isInc, isExc);
                }).join("") +
              '</div>';
            } else if (curTab === "fsk") {
              subTitle = "🔞 Altersfreigabe (FSK)";
              catActiveCount = fCount;
              subContentHtml = '<div class="direct-filter-grid">' +
                FSK_OPTIONS_CLIENT.map(f => {
                  const isInc = (s.includedFsk || []).includes(f);
                  const isExc = (s.excludedFsk || []).includes(f);
                  return renderDirectFilterOptionCard("fsk", f, "🔞 " + esc(f), isInc, isExc);
                }).join("") +
                renderDirectFilterOptionCard("unreleased", "unreleased", "🗓️ Unveröffentlicht", Boolean(s.showUnreleased), false) +
              '</div>';
            } else if (curTab === "design") {
              subTitle = "🎨 Darstellung & Komfort";
              subContentHtml =
                '<div id="sidebarDesignBody" style="display:flex;flex-direction:column;gap:7px">' +
                  '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(95px,1fr));gap:6px">' +
                    '<button id="sidebarThemeBtn_dark" class="btn ' + (appTheme === 'dark' ? 'blue' : '') + '" onclick="setAppTheme(\\'dark\\')">🌙 Dark</button>' +
                    '<button id="sidebarThemeBtn_light" class="btn ' + (appTheme === 'light' ? 'blue' : '') + '" onclick="setAppTheme(\\'light\\')">☀️ Light</button>' +
                    '<button id="sidebarThemeBtn_cyberpunk" class="btn ' + (appTheme === 'cyberpunk' ? 'blue' : '') + '" onclick="setAppTheme(\\'cyberpunk\\')">⚡ Cyber</button>' +
                  '</div>' +
                  '<button id="sidebarColorblindBtn" class="btn ' + (colorblindMode ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleColorblindMode()">' +
                    '<span>👁️ Farbenblind-Modus</span>' +
                    '<b>' + (colorblindMode ? 'EIN' : 'AUS') + '</b>' +
                  '</button>' +
                  '<button id="sidebarMouseHoverNavBtn" class="btn ' + (mouseHoverNavEnabled ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleMouseHoverNav()">' +
                    '<span>🖱️ Maus-Hover Fokus</span>' +
                    '<b>' + (mouseHoverNavEnabled ? 'EIN' : 'AUS') + '</b>' +
                  '</button>' +
                  '<button id="sidebarModalHoldNavBtn" class="btn ' + (modalHoldNavEnabled ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleModalHoldNav()">' +
                    '<span>⏩ Pfeil halten (450ms) = Nächster</span>' +
                    '<b>' + (modalHoldNavEnabled ? 'EIN' : 'AUS') + '</b>' +
                  '</button>' +
                  '<button id="sidebarHeroToggleBtn" class="btn ' + (!state.heroHidden ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleHeroSliderHidden()">' +
                    '<span>🎬 Spotlight-Banner</span>' +
                    '<b>' + (state.heroHidden ? 'AUS' : 'EIN') + '</b>' +
                  '</button>' +
                  '<button id="sidebarTrailerPreviewBtn" class="btn ' + (trailerPreviewEnabled ? 'blue' : '') + '" style="width:100%;justify-content:space-between" onclick="toggleTrailerPreviewSettingClient()">' +
                    '<span>🎥 Trailer-Vorschau (Detailseite)</span>' +
                    '<b>' + (trailerPreviewEnabled ? 'EIN' : 'AUS') + '</b>' +
                  '</button>' +
                '</div>';
            } else if (curTab === "scale") {
              subTitle = "🔠 Skalierung & Textgröße";
              subContentHtml =
                '<div id="sidebarScaleBody" style="display:flex;flex-direction:column;gap:6px">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:4px">' +
                    '<span style="font-size:calc(10.5px * var(--scale-text));color:var(--muted)">Tastatur: <b>+</b> / <b>-</b> · Controller: <b>L2</b> / <b>R2</b> (<b>R3</b> = 100%)</span>' +
                    '<button id="sidebarScaleResetBtn" class="btn blue" style="padding:4px 10px" onclick="resetUiScale()">↺ 100% Standard</button>' +
                  '</div>' +
                  buildScaleRow("📐 Gesamt", "all", [{l:"85%",v:85},{l:"100%",v:100},{l:"115%",v:115},{l:"130%",v:130}]) +
                  buildScaleRow("🔤 Text", "text", [{l:"85%",v:85},{l:"100%",v:100},{l:"115%",v:115},{l:"130%",v:130}]) +
                  buildScaleRow("🖼️ Cover", "cover", [{l:"80%",v:80},{l:"100%",v:100},{l:"125%",v:125},{l:"150%",v:150}]) +
                  buildScaleRow("🎛️ Menü", "menu", [{l:"85%",v:85},{l:"100%",v:100},{l:"115%",v:115},{l:"125%",v:125}]) +
                '</div>';
            }

            subPanel.innerHTML =
              '<div class="sidebar-subpanel-top">' +
                '<div class="sidebar-subpanel-title">' + subTitle + '</div>' +
                '<div style="display:flex;gap:6px;align-items:center">' +
                  (isFilterCat && catActiveCount > 0
                    ? ('<button type="button" class="btn danger" style="padding:3px 8px;font-size:10.5px" onclick="resetSidebarCategoryFiltersQuickClient(\\'' + curTab + '\\')" title="Filter dieser Kategorie zurücksetzen">↺ Reset (' + catActiveCount + ')</button>')
                    : '') +
                  '<button type="button" id="sidebarSubBackBtn" class="btn" onclick="closeSidebarSubPanelToMain()" title="Zurück in die linke Menü-Übersicht (Pfeil links)">← Übersicht</button>' +
                '</div>' +
              '</div>' +
              '<div style="font-size:calc(10.5px * var(--scale-text));color:var(--muted);margin-bottom:4px">' +
                (isFilterCat
                  ? '✅ = Einschließen · 🚫 = Ausschließen · ◀ Pfeil links = Übersicht'
                  : '◀ Pfeil nach links führt direkt zurück in die Menü-Übersicht') +
              '</div>' +
              subContentHtml;
          }
        }

        const searchRoot = drawer || body;
        if (jumpToOptions) {
          focusFirstSidebarFilterOption();
        } else if (prevFocusDfId && typeof CSS !== "undefined" && CSS.escape) {
          const restoredEl = searchRoot.querySelector('[data-df-id="' + CSS.escape(prevFocusDfId) + '"]');
          if (restoredEl) setSpatialFocus(restoredEl, false);
        } else if (prevFocusElId) {
          const restoredById = document.getElementById(prevFocusElId);
          if (restoredById && searchRoot.contains(restoredById)) setSpatialFocus(restoredById, false);
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

      let activeBotCodePollTimer = null;
      let activeBotCodeChallenge = null;

      function stopBotCodePollClient() {
        if (activeBotCodePollTimer) {
          clearInterval(activeBotCodePollTimer);
          activeBotCodePollTimer = null;
        }
      }

      function switchLoginModalTabClient(tabName) {
        state.loginModalTab = tabName;
        openAccountModal();
      }

      async function onTelegramWidgetAuthClient(tgUser) {
        const fb = document.getElementById("loginModalFeedback");
        if (fb) {
          fb.style.color = "#38bdf8";
          fb.textContent = "⏳ Prüfe Telegram Login-Widget Signatur (HMAC-SHA256)...";
        }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/telegram-widget", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user: tgUser })
          });
          if (!r || !r.ok || !r.user) {
            if (fb) {
              fb.style.color = "#f87171";
              fb.textContent = "❌ " + (r?.error || "Telegram Widget Login fehlgeschlagen.");
            }
            return;
          }
          stopBotCodePollClient();
          sessionToken = r.sessionToken || "";
          try { localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
          state.isAuthenticated = true;
          state.authUser = r.user;
          chatId = String(r.user.telegramId);
          clearClientMediaCaches();
          updateSyncBadge();
          const m = document.getElementById("modalRoot");
          if (m) m.innerHTML = "";
          showHudToast("✅ Via Telegram Login-Widget als " + (r.user.tgUsername ? "@" + r.user.tgUsername : r.user.firstName || r.user.telegramId) + " angemeldet!");
          loadDiscover(state.type, state.genreId, state.mode, state.sort);
        } catch (err) {
          if (fb) {
            fb.style.color = "#f87171";
            fb.textContent = "❌ " + (err?.message || "Verbindungsfehler");
          }
        }
      }
      window.onTelegramWidgetAuthClient = onTelegramWidgetAuthClient;

      function mountTelegramLoginWidgetClient() {
        const container = document.getElementById("tgLoginWidgetContainer");
        if (!container) return;
        const botName = String(state.botUsername || window._lastAdminOverviewCache?.botSetup?.botUsername || "").replace(/^@/, "").trim();
        if (!botName || botName === "DeinBot") {
          container.innerHTML = '<div style="font-size:11.5px;color:#94a3b8;padding:6px 0">ℹ️ Sobald <code>BOT_USERNAME</code> / <code>TELEGRAM_BOT_TOKEN</code> gesetzt und bei @BotFather mit <code>/setdomain</code> verknüpft ist, erscheint hier automatisch der offizielle Telegram-Login-Button. Nutze alternativ direkt den <b>1-Klick Bot-Code</b> darunter oder den Test-Login:</div>';
          return;
        }
        container.innerHTML = "";
        const s = document.createElement("script");
        s.async = true;
        s.src = "https://telegram.org/js/telegram-widget.js?22";
        s.setAttribute("data-telegram-login", botName);
        s.setAttribute("data-size", "large");
        s.setAttribute("data-radius", "8");
        s.setAttribute("data-onauth", "onTelegramWidgetAuthClient(user)");
        s.setAttribute("data-request-access", "write");
        container.appendChild(s);
      }

      async function startBotCodeLoginChallengeClient() {
        stopBotCodePollClient();
        const box = document.getElementById("botCodeChallengeBox");
        if (box) {
          box.innerHTML = '<div style="font-size:12px;color:#38bdf8;padding:8px 0">⏳ Erzeuge sicheren 6-stelligen Einmal-Code & Bot-Deep-Link...</div>';
        }
        try {
          const r = await apiFetchJson(API_BASE + "/auth/bot-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create" })
          });
          if (!r || !r.ok || !r.challengeId) {
            if (box) box.innerHTML = '<div style="font-size:12px;color:#f87171">❌ Konnte Login-Code nicht erstellen.</div>';
            return;
          }
          activeBotCodeChallenge = r;
          if (r.botUsername && !state.botUsername) state.botUsername = r.botUsername;
          const formattedCode = String(r.code || "").replace(/^(\\d{3})(\\d{3})$/, "$1 $2");
          if (box) {
            box.innerHTML =
              '<div style="background:rgba(7,11,25,0.92);border:1px solid rgba(0,240,255,0.4);border-radius:10px;padding:12px;margin-top:6px;display:flex;flex-direction:column;gap:8px;align-items:center;text-align:center">' +
                '<div style="font-size:11.5px;color:#94a3b8">Sende diesen 6-stelligen Code an den Telegram-Bot oder klicke auf <b>Direkt in Telegram bestätigen</b>:</div>' +
                '<div style="font-family:monospace;font-variant-numeric:tabular-nums;font-size:26px;font-weight:900;letter-spacing:4px;color:#00f0ff;background:rgba(0,240,255,0.08);border:1px solid rgba(0,240,255,0.3);padding:6px 18px;border-radius:8px;user-select:all">' +
                  esc(formattedCode) +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
                  (r.deepLink ? (
                    '<a href="' + esc(r.deepLink) + '" target="_blank" rel="noopener" class="btn blue" style="text-decoration:none;font-weight:800">' +
                      '🚀 1-Klick: Direkt in Telegram bestätigen' +
                    '</a>'
                  ) : '') +
                  '<button type="button" class="btn" onclick="simulateBotCodeConfirmClient(\\'' + esc(r.challengeId) + '\\')" title="Bestätigt den Code im lokalen Simulator / Vorschau-Modus">' +
                    '🧪 Im Simulator bestätigen' +
                  '</button>' +
                '</div>' +
                '<div id="botCodePollStatusText" style="font-size:11.5px;color:#fbbf24">⏳ Warte auf Bestätigung in Telegram (automatischer Abgleich alle 2s)...</div>' +
              '</div>';
          }
          activeBotCodePollTimer = setInterval(() => {
            pollBotCodeChallengeClient(r.challengeId);
          }, 2000);
        } catch (err) {
          if (box) box.innerHTML = '<div style="font-size:12px;color:#f87171">❌ ' + esc(err?.message || "Fehler") + '</div>';
        }
      }

      async function pollBotCodeChallengeClient(challengeId) {
        if (!challengeId) return;
        try {
          const r = await apiFetchJson(API_BASE + "/auth/bot-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "poll", challengeId })
          });
          if (!r || !r.ok) return;
          const stEl = document.getElementById("botCodePollStatusText");
          if (r.status === "expired") {
            stopBotCodePollClient();
            if (stEl) {
              stEl.style.color = "#f87171";
              stEl.textContent = "⌛ Code abgelaufen. Bitte neuen Code anfordern.";
            }
            return;
          }
          if (r.status === "confirmed" && r.user && r.sessionToken) {
            stopBotCodePollClient();
            sessionToken = r.sessionToken;
            try { localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
            state.isAuthenticated = true;
            state.authUser = r.user;
            chatId = String(r.user.telegramId);
            clearClientMediaCaches();
            updateSyncBadge();
            const m = document.getElementById("modalRoot");
            if (m) m.innerHTML = "";
            showHudToast("✅ Telegram Bot-Login erfolgreich bestätigt!");
            loadDiscover(state.type, state.genreId, state.mode, state.sort);
          }
        } catch (e) {}
      }

      async function simulateBotCodeConfirmClient(challengeId) {
        if (!challengeId) return;
        await apiFetchJson(API_BASE + "/auth/bot-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "simulate_confirm", challengeId })
        });
        await pollBotCodeChallengeClient(challengeId);
      }

      function toggleAccountSecurityDrawerClient() {
        state.accountSecurityOpen = !state.accountSecurityOpen;
        openAccountModal();
      }

      function openAccountModal() {
        const m = document.getElementById("modalRoot");
        if (!m) return;
        const isAuth = Boolean(state.isAuthenticated && state.authUser);
        const u = state.authUser || {};
        const canCreateOrUpdateAccount = Boolean(state.hasInitData || (isAuth && u.hasPasswordAccount));
        const activeTab = state.loginModalTab || "telegram";
        const isSecOpen = Boolean(state.accountSecurityOpen || !isAuth);

        let bodyHtml = "";
        if (isAuth) {
          stopBotCodePollClient();
          bodyHtml += '<div class="panel-box" style="border-color:rgba(16,185,129,0.35)">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
              '<div style="font-size:14px;font-weight:800;color:#34d399">✅ Angemeldet ' + (u.tgUsername ? ('als @' + esc(u.tgUsername)) : ('(ID: ' + esc(u.telegramId) + ')')) + '</div>' +
              '<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:' + (u.isVip ? 'rgba(251,191,36,0.18);color:#fbbf24;border:1px solid rgba(251,191,36,0.4)' : 'rgba(148,163,184,0.15);color:#cbd5e1') + '">' +
                (u.isVip ? '🌟 VIP Aktiv' : 'Standard-Konto') +
              '</span>' +
            '</div>' +
            '<div style="font-size:12px;color:#cbd5e1;line-height:1.65;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px;background:rgba(15,23,42,0.55);padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.06)">' +
              '<div>🆔 <b>Telegram-ID:</b> ' + esc(u.telegramId) + '</div>' +
              '<div>🔐 <b>Web-Login:</b> ' + (u.hasPasswordAccount ? ('<span style="color:#34d399"><b>' + esc(u.customUsername) + '</b></span>') : '<span style="color:#fbbf24">Noch kein Passwort</span>') + '</div>' +
              '<div>🛡️ <b>2FA-Schutz:</b> ' + (u.totpEnabled ? '<span style="color:#34d399;font-weight:800">🟢 Aktiv</span>' : '<span style="color:#94a3b8">⚪ Optional</span>') + '</div>' +
              (u.isAdmin ? '<div>👑 <b>Rolle:</b> <span style="color:#f87171;font-weight:800">Administrator</span></div>' : '') +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px">' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button type="button" class="btn ' + (isSecOpen ? 'active' : 'blue') + '" onclick="toggleAccountSecurityDrawerClient()">⚙️ Passwort & 2FA ' + (isSecOpen ? '▴' : '▾') + '</button>' +
                (u.isAdmin ? '<button class="btn amber" onclick="document.getElementById(\\'modalRoot\\').innerHTML=\\'\\';loadAdminPanelView()">👑 Admin-Panel</button>' : '') +
              '</div>' +
              '<button class="btn danger" onclick="logoutWebSession()">🚪 Abmelden</button>' +
            '</div>' +
          '</div>';
        } else {
          bodyHtml += '<div class="panel-box" style="border-color:rgba(56,189,248,0.4);background:linear-gradient(145deg,rgba(11,16,33,0.95),rgba(16,16,24,0.96))">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
              '<div style="font-size:13.5px;font-weight:800;color:#38bdf8">🔐 Anmeldung für Browser, PC & Smart-TV</div>' +
              '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                '<button type="button" class="btn ' + (activeTab === "telegram" ? "active" : "") + '" style="padding:4px 10px;font-size:11.5px" onclick="switchLoginModalTabClient(\\'telegram\\')">📲 Per Telegram-Bot / Code</button>' +
                '<button type="button" class="btn ' + (activeTab === "password" ? "active" : "") + '" style="padding:4px 10px;font-size:11.5px" onclick="switchLoginModalTabClient(\\'password\\')">🔑 Username & Passwort</button>' +
              '</div>' +
            '</div>' +
            (activeTab === "telegram" ? (
              '<div style="display:flex;flex-direction:column;gap:10px">' +
                '<div style="background:rgba(14,165,233,0.08);border:1px solid rgba(56,189,248,0.35);border-radius:10px;padding:11px">' +
                  '<div style="font-size:12.5px;font-weight:800;color:#38bdf8;margin-bottom:4px">📲 Schnell-Login per 6-stelligem Code oder 1-Klick im Bot (Empfohlen)</div>' +
                  '<div style="font-size:11.5px;color:#cbd5e1;line-height:1.45;margin-bottom:8px">' +
                    'Funktioniert sofort auf jedem Gerät (Smart-TV, PC & Smartphone) ohne Drittanbieter-Cookies:' +
                  '</div>' +
                  '<button type="button" class="btn blue" onclick="startBotCodeLoginChallengeClient()">📲 6-stelligen Login-Code & Bot-Link anfordern</button>' +
                  '<div id="botCodeChallengeBox"></div>' +
                '</div>' +
                '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(139,92,246,0.28);border-radius:10px;padding:10px">' +
                  '<div style="font-size:12px;font-weight:800;color:#c4b5fd;margin-bottom:4px">🌐 Alternativ: Browser-Login über Telegram Widget</div>' +
                  '<div id="tgLoginWidgetContainer" style="min-height:34px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"></div>' +
                '</div>' +
                '<div id="loginModalFeedback" style="font-size:12px;color:#f87171"></div>' +
              '</div>'
            ) : (
              '<div style="display:flex;flex-direction:column;gap:8px">' +
                '<p style="font-size:12px;color:#cbd5e1;line-height:1.45;margin:0 0 4px 0">' +
                  'Melde dich mit deinem gespeicherten <b>Username & Passwort</b> an:' +
                '</p>' +
                '<input id="loginUsernameInp" class="tma-input" placeholder="Username" onkeydown="if(event.key===\\'Enter\\'){const p=document.getElementById(\\'loginPasswordInp\\');if(p&&!p.value)p.focus();else submitWebLogin();}" style="padding:8px 10px;font-size:13px" />' +
                '<div style="display:flex;gap:6px;align-items:center">' +
                  '<input id="loginPasswordInp" class="tma-input" type="password" placeholder="Passwort" onkeydown="if(event.key===\\'Enter\\')submitWebLogin()" style="flex:1;padding:8px 10px;font-size:13px" />' +
                  '<button type="button" class="btn" style="padding:8px 10px" onclick="togglePasswordVisibilityClient(\\'loginPasswordInp\\',this)" title="Passwort ein-/ausblenden">👁️</button>' +
                '</div>' +
                '<div id="login2faWrap" style="display:none;flex-direction:column;gap:6px;padding:8px;border-radius:6px;background:rgba(91,70,245,0.14);border:1px solid rgba(91,70,245,0.4)">' +
                  '<div style="font-size:11.5px;font-weight:700;color:#c4b5fd">🛡️ 2FA-Schutz aktiv: Bitte 6-stelligen Authenticator-Code eingeben</div>' +
                  '<input id="loginTotpInp" class="tma-input" placeholder="6-stelliger 2FA-Code (z. B. 123456)" maxlength="6" inputmode="numeric" onkeydown="if(event.key===\\'Enter\\')submitWebLogin()" style="padding:8px 10px;border-color:rgba(167,139,250,0.5);font-size:14px;letter-spacing:3px;font-weight:800;text-align:center" />' +
                '</div>' +
                '<button class="btn green" onclick="submitWebLogin()">🔑 Einloggen</button>' +
                '<div id="loginModalFeedback" style="font-size:12px;color:#f87171"></div>' +
              '</div>'
            )) +
          '</div>';
        }

        if ((canCreateOrUpdateAccount || isAuth) && isSecOpen) {
          bodyHtml += '<div class="panel-box">' +
            '<div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:6px">🔐 ' + (u.hasPasswordAccount ? 'Username & Passwort ändern' : 'Web-Zugang (Username & Passwort) einrichten') + '</div>' +
            '<p style="font-size:11.5px;color:var(--muted);margin-bottom:10px">Ermöglicht den bequemen Login im Browser und auf dem Smart-TV auch ohne Telegram auf dem Zweitgerät.</p>' +
            '<div style="display:flex;flex-direction:column;gap:8px">' +
              '<input id="setAccUsernameInp" class="tma-input" value="' + esc(u.customUsername || u.tgUsername || '') + '" placeholder="Gewünschter Username (3–32 Zeichen)" onkeydown="if(event.key===\\'Enter\\'){const p=document.getElementById(\\'setAccPasswordInp\\');if(p&&!p.value)p.focus();else submitSaveAccountCredentials();}" style="padding:8px 10px;font-size:13px" />' +
              '<div style="display:flex;gap:6px;align-items:center">' +
                '<input id="setAccPasswordInp" class="tma-input" type="password" placeholder="Neues sicheres Passwort (mind. 6 Zeichen)" onkeydown="if(event.key===\\'Enter\\')submitSaveAccountCredentials()" style="flex:1;padding:8px 10px;font-size:13px" />' +
                '<button type="button" class="btn" style="padding:8px 10px" onclick="togglePasswordVisibilityClient(\\'setAccPasswordInp\\',this)" title="Passwort ein-/ausblenden">👁️</button>' +
              '</div>' +
              '<button class="btn purple" onclick="submitSaveAccountCredentials()">💾 Zugangsdaten speichern</button>' +
              '<div id="setAccFeedback" style="font-size:12px;color:#fbbf24"></div>' +
            '</div>' +
          '</div>';

          bodyHtml += '<div class="panel-box" style="border-color:rgba(91,70,245,0.35)">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
              '<div style="font-size:13px;font-weight:800;color:#c4b5fd">🛡️ Zwei-Faktor-Schutz (TOTP 2FA)</div>' +
              '<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:' + (u.totpEnabled ? 'rgba(16,185,129,0.2);color:#34d399' : 'rgba(148,163,184,0.16);color:var(--muted)') + '">' +
                (u.totpEnabled ? '🟢 2FA AKTIV' : '⚪ OPTIONAL') +
              '</span>' +
            '</div>' +
            '<p style="font-size:11.5px;color:var(--muted);margin-bottom:10px">Zusätzlicher Schutz per 6-stelligem Einmalcode (Google Authenticator, Authy, 1Password, Apple Passwörter).</p>' +
            (u.totpEnabled ? (
              '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                '<input id="disable2faCodeInp" class="tma-input" placeholder="6-stelliger 2FA-Code zur Bestätigung" maxlength="6" inputmode="numeric" onkeydown="if(event.key===\\'Enter\\')disable2faProtection()" style="padding:7px 10px;font-size:12.5px;width:230px" />' +
                '<button class="btn danger" onclick="disable2faProtection()">🔓 2FA deaktivieren</button>' +
              '</div>'
            ) : (
              '<div>' +
                '<button class="btn blue" onclick="start2faQrSetup()">📲 2FA mit QR-Code einrichten</button>' +
                '<div id="totpSetupMount" style="margin-top:10px"></div>' +
              '</div>'
            )) +
            '<div id="totpFeedback" style="font-size:12px;color:#fbbf24;margin-top:8px"></div>' +
          '</div>';
        }

        m.innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this){stopBotCodePollClient();this.parentElement.innerHTML=\\'\\';}"><div class="modal"><div class="modal-body" style="max-width:680px;margin:0 auto;width:100%">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h2 style="font-size:17px">👤 Konto & Anmeldung</h2><button class="btn close-slate" onclick="stopBotCodePollClient();document.getElementById(\\'modalRoot\\').innerHTML=\\'\\'">✖ Schließen</button></div>' +
          bodyHtml +
        '</div></div></div>';

        if (!isAuth && activeTab === "telegram") {
          setTimeout(mountTelegramLoginWidgetClient, 40);
        } else if (!isAuth && activeTab === "password") {
          setTimeout(() => {
            const uInp = document.getElementById("loginUsernameInp");
            if (uInp) uInp.focus();
          }, 40);
        }
      }

      function togglePasswordVisibilityClient(inputId, btnEl) {
        const inp = document.getElementById(inputId);
        if (!inp) return;
        const isPwd = inp.type === "password";
        inp.type = isPwd ? "text" : "password";
        if (btnEl) {
          btnEl.textContent = isPwd ? "🙈" : "👁️";
          btnEl.title = isPwd ? "Wieder verbergen" : "Passwort / Token anzeigen";
        }
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
            mount.innerHTML = '<div class="admin-sub-box" style="padding:12px;display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center">' +
              '<div style="font-size:12px;color:var(--text);font-weight:700">1. Scanne diesen QR-Code mit Google Authenticator oder Authy:</div>' +
              '<img src="' + esc(r.qrCodeUrl) + '" alt="TOTP QR Code" style="width:180px;height:180px;border-radius:8px;background:#fff;padding:6px" />' +
              '<div style="font-size:11px;color:var(--muted)">Manueller Setup-Schlüssel (Base32):<br><code style="color:#fbbf24;font-size:12px;user-select:all;letter-spacing:1px">' + esc(r.secret) + '</code></div>' +
              '<div style="font-size:12px;color:var(--text);font-weight:700;margin-top:4px">2. Gib zur Aktivierung den 6-stelligen Code aus der App ein:</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
                '<input id="verifyTotpSetupInp" class="tma-input" placeholder="123456" maxlength="6" inputmode="numeric" onkeydown="if(event.key===\\'Enter\\')confirm2faSetupEnable()" style="padding:8px 12px;border-color:rgba(16,185,129,0.5);font-size:15px;letter-spacing:3px;font-weight:800;width:140px;text-align:center" />' +
                '<button class="btn green" onclick="confirm2faSetupEnable()">✅ Code prüfen & 2FA aktivieren</button>' +
              '</div>' +
            '</div>';
            setTimeout(() => {
              const vInp = document.getElementById("verifyTotpSetupInp");
              if (vInp) vInp.focus();
            }, 40);
          }
        } catch (err) {
          if (fb) { fb.style.color = "#f87171"; fb.textContent = "❌ " + err.message; }
        }
      }

      async function confirm2faSetupEnable() {
        const inp = document.getElementById("verifyTotpSetupInp");
        const fb = document.getElementById("totpFeedback");
        const code = (inp ? inp.value : "").trim();
        if (!/^\\d{6}$/.test(code)) {
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

      let lastLightboxTriggerEl = null;
      function toggleLightboxZoomClient() {
        const im = document.getElementById("lbImg");
        const zBtn = document.getElementById("lbZoomToggleBtn");
        if (!im) return;
        const isZoomed = im.classList.toggle("zoomed");
        if (zBtn) zBtn.textContent = isZoomed ? "🔎 Verkleinern" : "🔍 Vergrößern";
      }

      function openLightbox(imgUrl, titleText) {
        if (!imgUrl) return;
        const lb = document.getElementById("lightboxRoot");
        if (!lb) return;
        const curEl = (typeof currentSpatialEl !== "undefined" && currentSpatialEl) ? currentSpatialEl : document.activeElement;
        if (curEl && curEl !== document.body && !lb.contains(curEl)) {
          lastLightboxTriggerEl = curEl;
        }
        lb.innerHTML = '<div class="lightbox-backdrop" onclick="if(event.target===this)closeLightbox()">' +
          '<div class="lightbox-toolbar">' +
            '<div style="font-size:13.5px;font-weight:800;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(titleText || 'Großansicht') + '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0">' +
              '<button type="button" id="lbZoomToggleBtn" class="btn" onclick="toggleLightboxZoomClient()">🔍 Vergrößern</button>' +
              '<a href="' + esc(imgUrl) + '" target="_blank" rel="noopener noreferrer" class="btn" style="text-decoration:none" title="Originalbild in voller Auflösung öffnen">🔗 Original ↗</a>' +
              '<button type="button" id="lbCloseBtn" class="btn close-slate" onclick="closeLightbox()">✖ Schließen</button>' +
            '</div>' +
          '</div>' +
          '<img id="lbImg" class="lightbox-img" src="' + esc(imgUrl) + '" onclick="toggleLightboxZoomClient()" alt="' + esc(titleText || 'Poster') + '" />' +
          '<div style="position:relative;z-index:5;font-size:11px;color:#94a3b8;margin-top:10px;background:rgba(7,12,26,0.75);padding:4px 12px;border-radius:999px">💡 Auf das Bild tippen zum Vergrößern / Verkleinern · ESC zum Schließen</div>' +
        '</div>';
        setTimeout(() => {
          const closeBtn = document.getElementById("lbCloseBtn");
          if (closeBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(closeBtn, false);
        }, 25);
      }
      function closeLightbox() {
        const lb = document.getElementById("lightboxRoot");
        if (lb) lb.innerHTML = "";
        if (lastLightboxTriggerEl && document.body.contains(lastLightboxTriggerEl) && typeof jumpSpatialFocus === "function") {
          const restoreEl = lastLightboxTriggerEl;
          lastLightboxTriggerEl = null;
          setTimeout(() => jumpSpatialFocus(restoreEl, false), 20);
        }
      }

      let filterClickSeq = 0;
      let sidebarFilterDebounceTimer = null;
      let liveSearchDebounceTimer = null;
      let heroTouchStartX = 0;
      let heroTouchStartY = 0;
      let heroTouchDraggingUp = false;
      let modalTouchStartX = 0;
      let lastModalTriggerKey = "";
      let lastModalTriggerEl = null;
      let lastModalHeroReturnId = "";

      // Clientseitiger Instant-Cache (5 Min TTL) für Detailansichten & Staffeln (#3)
      const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
      const clientDetailsCache = new Map();
      const clientSeasonCache = new Map();

      function clearClientMediaCaches() {
        clientDetailsCache.clear();
        clientSeasonCache.clear();
        if (window._clientApiGetCache instanceof Map) {
          window._clientApiGetCache.clear();
        }
        try {
          const keysToRemove = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith("tma_api_c_")) keysToRemove.push(k);
          }
          for (const k of keysToRemove) sessionStorage.removeItem(k);
        } catch (e) {}
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
          const activeEl = document.activeElement;
          const inHeroSlider = !heroCurtainScrolledToCatalog && !state.heroHidden && !state.isSearchMode && (!state.currentView || state.currentView === "discover");
          if (inHeroSlider) {
            if (
              (lastModalTriggerEl && lastModalTriggerEl.id === "heroBtnTrailer") ||
              (activeEl && activeEl.id === "heroBtnTrailer")
            ) {
              lastModalHeroReturnId = "heroBtnTrailer";
            } else {
              const curHero = Array.isArray(state.heroSlides) ? (state.heroSlides[state.heroIndex] || state.heroSlides[0]) : null;
              const curHeroType = curHero && (curHero.media_type === "tv" || state.type === "s") ? "s" : "m";
              const matchesHeroSlide = Boolean(curHero && String(curHero.id) === String(id) && curHeroType === typeCode);
              const triggeredFromHero = Boolean(
                (lastModalTriggerEl && lastModalTriggerEl.closest && lastModalTriggerEl.closest(".hero")) ||
                (activeEl && activeEl.closest && activeEl.closest(".hero")) ||
                matchesHeroSlide
              );
              lastModalHeroReturnId = triggeredFromHero ? "heroBtnDetails" : "";
            }
          } else {
            lastModalHeroReturnId = "";
          }
        } else if (typeCode && id) {
          lastModalTriggerKey = typeCode + "_" + id;
        }
      }

      function closeDetailModal() {
        const stageEl = document.getElementById("detailHeroStageEl");
        if (stageEl && stageEl.classList.contains("is-trailer-foreground-mode") && typeof exitDetailForegroundTrailerModeClient === "function") {
          exitDetailForegroundTrailerModeClient();
          return;
        }
        const heroStageEl = document.getElementById("heroStageEl");
        const m = document.getElementById("modalRoot");
        if ((!m || !m.innerHTML.trim()) && heroStageEl && heroStageEl.classList.contains("is-trailer-foreground-mode") && typeof exitHeroForegroundTrailerModeClient === "function") {
          exitHeroForegroundTrailerModeClient();
          return;
        }
        if (typeof stopDetailBackgroundVideoTeaserClient === "function") {
          stopDetailBackgroundVideoTeaserClient();
        }
        if (document.body) document.body.classList.remove("modal-open-pause-hero");
        if (m) m.innerHTML = "";
        if (typeof syncTelegramBackButtonClient === "function") {
          syncTelegramBackButtonClient();
        }
        if (typeof scheduleHeroBackgroundVideoTeaserClient === "function") {
          scheduleHeroBackgroundVideoTeaserClient(false);
        }
        if (lastModalHeroReturnId && !heroCurtainScrolledToCatalog && !state.heroHidden) {
          const heroReturnBtn = document.getElementById(lastModalHeroReturnId) || document.getElementById("heroBtnDetails");
          lastModalHeroReturnId = "";
          if (heroReturnBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(heroReturnBtn, false);
            return;
          }
        }
        if (lastModalTriggerEl && document.body.contains(lastModalTriggerEl) && lastModalTriggerEl.closest && lastModalTriggerEl.closest(".hero") && !heroCurtainScrolledToCatalog && !state.heroHidden) {
          const heroDetailsBtn = document.getElementById("heroBtnDetails") || lastModalTriggerEl;
          if (typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(heroDetailsBtn, false);
            return;
          }
        }
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
          return Array.isArray(r) ? r.slice(0, 40) : [];
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
        const rawYear = String(d.year || d.releaseDate || d.release_date || d.first_air_date || "").slice(0, 4);
        const cleanYear = /^[0-9]{4}$/.test(rawYear) ? rawYear : "";
        const cleanRating = Number(d.vote_average || d.rating || 0);
        const cleanFsk = String(d.fsk || "").trim();
        const entry = {
          id: Number(d.id),
          tmdbId: Number(d.id),
          type: typeCode === "s" ? "s" : "m",
          contentType: typeCode === "s" ? "series" : "movie",
          title: String(d.title || d.name || "Titel").slice(0, 80),
          poster: posterUrl,
          year: cleanYear || "K. A.",
          rating: cleanRating > 0 ? cleanRating : 0,
          fsk: cleanFsk || "K. A.",
          addedAt: Date.now()
        };
        recentViewedList = [entry, ...recentViewedList.filter(x => !(x.id === entry.id && x.type === entry.type))].slice(0, 40);
        try { localStorage.setItem("tma_recent_viewed", JSON.stringify(recentViewedList)); } catch (e) {}
        refreshRecentViewedStripDom();
        syncRightMenuBadgesClient();
        if (state.rightMenuTab === "recent") {
          renderRightMenuSubPanelEntriesOnlyClient();
        }
      }

      function removeRecentViewedItem(ev, typeCode, id) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const tc = typeCode === "s" ? "s" : "m";
        const numId = Number(id);
        recentViewedList = recentViewedList.filter(x => !(x.type === tc && Number(x.id) === numId));
        try { localStorage.setItem("tma_recent_viewed", JSON.stringify(recentViewedList)); } catch (e) {}
        refreshRecentViewedStripDom();
        syncRightMenuBadgesClient();
        if (state.rightMenuTab === "recent") {
          renderRightMenuSubPanelContentClient(false);
        }
        showHudToast("🗑️ Aus „Zuletzt gesehen“ entfernt");
      }

      function clearAllRecentViewed() {
        recentViewedList = [];
        try { localStorage.removeItem("tma_recent_viewed"); } catch (e) {}
        refreshRecentViewedStripDom();
        syncRightMenuBadgesClient();
        if (state.rightMenuTab === "recent") {
          renderRightMenuSubPanelContentClient(false);
        }
        showHudToast("🗑️ Verlauf „Zuletzt gesehen“ geleert");
      }

      function syncRightMenuBadgesClient() {
        const wlBadge = document.getElementById("tvElevBadgeWishlist");
        const recBadge = document.getElementById("tvElevBadgeRecent");
        const wlCount = (Array.isArray(state.cachedWishlistItems) && state.cachedWishlistItems.length > 0)
          ? state.cachedWishlistItems.length
          : savedKeysSet.size;
        const recCount = Array.isArray(recentViewedList) ? recentViewedList.length : 0;
        if (wlBadge) {
          wlBadge.textContent = String(wlCount);
          wlBadge.style.display = wlCount > 0 ? "inline-flex" : "none";
        }
        if (recBadge) {
          recBadge.textContent = String(recCount);
          recBadge.style.display = recCount > 0 ? "inline-flex" : "none";
        }
        const wlBtn = document.getElementById("tvElevBtnWishlist");
        const recBtn = document.getElementById("tvElevBtnRecent");
        if (wlBtn) wlBtn.classList.toggle("active-tab", state.rightMenuTab === "wishlist");
        if (recBtn) recBtn.classList.toggle("active-tab", state.rightMenuTab === "recent");
      }

      function ensureRightMenuFilterStateClient() {
        if (!state.rmSort) state.rmSort = "added_desc";
        if (state.rmYear === undefined) state.rmYear = "";
        if (state.rmMinRating === undefined) state.rmMinRating = "";
        if (state.rmMaxRating === undefined) state.rmMaxRating = "";
        if (!state.rmFsk) state.rmFsk = "ALL";
        if (!state.rmLetter) state.rmLetter = "ALL";
        if (!state.rmType) state.rmType = "all";
        if (state.rmQuery === undefined) state.rmQuery = "";
      }

      function resetRightMenuFiltersClient() {
        state.rmSort = "added_desc";
        state.rmYear = "";
        state.rmMinRating = "";
        state.rmMaxRating = "";
        state.rmFsk = "ALL";
        state.rmLetter = "ALL";
        state.rmType = "all";
        state.rmQuery = "";
        renderRightMenuSubPanelContentClient(false);
      }

      function normalizeItemFskNumberClient(rawFsk) {
        const s = String(rawFsk || "").trim();
        if (!s || s === "K. A.") return null;
        const m = s.match(/(?:^|[^0-9])(0|6|12|16|18)(?:$|[^0-9])/);
        return m ? m[1] : null;
      }

      function getRightMenuFilteredAndSortedItemsClient(tabMode) {
        ensureRightMenuFilterStateClient();
        const isWishlist = tabMode === "wishlist";
        let rawList = [];
        if (isWishlist) {
          const allItems = Array.isArray(state.cachedWishlistItems) ? state.cachedWishlistItems : [];
          const folders = Array.isArray(state.cachedWishlistFolders) ? state.cachedWishlistFolders : [];
          const disabledFolderIds = new Set(folders.filter(f => f.enabled === false).map(f => f.id));
          rawList = allItems.filter(i => i && (!i.folderId || !disabledFolderIds.has(i.folderId)));
        } else {
          rawList = Array.isArray(recentViewedList) ? recentViewedList.slice() : [];
        }

        let list = rawList.map((it, idx) => {
          const isEp = it.contentType === "episode";
          const isSer = it.contentType === "series" || isEp || it.type === "s";
          const tc = isSer ? "s" : "m";
          const targetId = Number(isEp ? it.seriesId : (it.tmdbId || it.id)) || 0;
          const yrMatch = String(it.year || "").match(/(19[0-9]{2}|20[0-9]{2})/);
          const yearNum = yrMatch ? Number(yrMatch[1]) : 0;
          const ratingNum = Number(it.rating || it.vote_average || 0);
          const fskCode = normalizeItemFskNumberClient(it.fsk);
          const addedTs = Number(it.addedAt || 0) || (rawList.length - idx);
          return {
            _raw: it,
            uid: it.uid || (tc + "_" + targetId),
            tc,
            targetId,
            title: String(it.title || "Titel"),
            poster: it.poster || "",
            yearNum,
            yearStr: yearNum > 0 ? String(yearNum) : "",
            ratingNum,
            fskCode,
            fskLabel: fskCode !== null ? ("FSK " + fskCode) : "",
            addedTs,
            epCount: Array.isArray(it.episodes) ? it.episodes.length : 0
          };
        });

        if (state.rmType === "m") {
          list = list.filter(x => x.tc === "m");
        } else if (state.rmType === "s") {
          list = list.filter(x => x.tc === "s");
        }

        const yrFilter = String(state.rmYear || "").trim();
        if (yrFilter) {
          const exactYr = Number(yrFilter);
          if (exactYr > 0) {
            list = list.filter(x => x.yearNum === exactYr);
          }
        }

        const minR = state.rmMinRating !== "" && state.rmMinRating !== null ? Number(state.rmMinRating) : null;
        const maxR = state.rmMaxRating !== "" && state.rmMaxRating !== null ? Number(state.rmMaxRating) : null;
        if (minR !== null && !Number.isNaN(minR) && minR > 0) {
          list = list.filter(x => x.ratingNum >= minR);
        }
        if (maxR !== null && !Number.isNaN(maxR) && maxR < 10) {
          list = list.filter(x => x.ratingNum <= maxR);
        }

        if (state.rmFsk && state.rmFsk !== "ALL") {
          const wantedFsk = String(state.rmFsk).replace(/[^0-9]/g, "");
          list = list.filter(x => x.fskCode === wantedFsk);
        }

        const activeLetter = String(state.rmLetter || "ALL").toUpperCase();
        if (activeLetter && activeLetter !== "ALL") {
          list = list.filter(x => {
            const cleanTitle = x.title.trim().replace(/^[^a-zA-Z0-9äöüÄÖÜ]+/, "");
            const firstChar = (cleanTitle[0] || "").toUpperCase();
            if (activeLetter === "#") return !/^[A-ZÄÖÜ]$/.test(firstChar);
            if (activeLetter === "A" && firstChar === "Ä") return true;
            if (activeLetter === "O" && firstChar === "Ö") return true;
            if (activeLetter === "U" && firstChar === "Ü") return true;
            return firstChar === activeLetter;
          });
        }

        const q = String(state.rmQuery || "").trim().toLowerCase();
        if (q) {
          list = list.filter(x => x.title.toLowerCase().includes(q) || x.yearStr.includes(q));
        }

        const sortKey = state.rmSort || "added_desc";
        list.sort((a, b) => {
          if (sortKey === "added_asc") return a.addedTs - b.addedTs;
          if (sortKey === "added_desc") return b.addedTs - a.addedTs;
          if (sortKey === "rating_desc") return (b.ratingNum - a.ratingNum) || a.title.localeCompare(b.title, "de");
          if (sortKey === "rating_asc") return (a.ratingNum - b.ratingNum) || a.title.localeCompare(b.title, "de");
          if (sortKey === "year_desc") return (b.yearNum - a.yearNum) || a.title.localeCompare(b.title, "de");
          if (sortKey === "year_asc") return ((a.yearNum || 9999) - (b.yearNum || 9999)) || a.title.localeCompare(b.title, "de");
          if (sortKey === "title_asc") return a.title.localeCompare(b.title, "de");
          if (sortKey === "title_desc") return b.title.localeCompare(a.title, "de");
          return b.addedTs - a.addedTs;
        });

        return { items: list, totalRaw: rawList.length, rawList };
      }

      async function toggleRightMenuSubPanelClient(tabName, jumpFocusIntoPanel = false) {
        const elev = document.getElementById("tvQuickJumpElevator");
        if (!elev) return;
        if (state.rightMenuTab === tabName && elev.classList.contains("has-subpanel") && !jumpFocusIntoPanel) {
          closeRightMenuSubPanelClient();
          return;
        }
        state.rightMenuTab = tabName;
        ensureRightMenuFilterStateClient();
        elev.classList.add("has-subpanel", "is-visible", "is-hover-expanded");
        syncRightMenuBadgesClient();
        renderRightMenuSubPanelContentClient(jumpFocusIntoPanel);

        if (tabName === "wishlist" && state.isAuthenticated) {
          try {
            const r = await apiFetchJson(API_BASE + "/wishlist?chatId=" + encodeURIComponent(chatId));
            if (r && Array.isArray(r.items)) {
              state.cachedWishlistItems = r.items;
              state.cachedWishlistFolders = r.folders || [];
              savedKeysSet.clear();
              r.items.forEach(it => {
                if (it.contentType === "movie" && it.tmdbId) savedKeysSet.add("m_" + it.tmdbId);
                else if (it.contentType === "series" && it.tmdbId) savedKeysSet.add("s_" + it.tmdbId);
              });
              syncRightMenuBadgesClient();
              if (state.rightMenuTab === "wishlist") {
                renderRightMenuSubPanelContentClient(false);
              }
            }
          } catch (e) {}
        }
      }

      function closeRightMenuSubPanelClient(returnFocusToTabBtn = false) {
        const prevTab = state.rightMenuTab;
        state.rightMenuTab = null;
        const elev = document.getElementById("tvQuickJumpElevator");
        if (elev) {
          elev.classList.remove("has-subpanel");
        }
        syncRightMenuBadgesClient();
        if (returnFocusToTabBtn && prevTab) {
          const btnId = prevTab === "wishlist" ? "tvElevBtnWishlist" : "tvElevBtnRecent";
          const btn = document.getElementById(btnId);
          if (btn && typeof setSpatialFocus === "function") {
            setSpatialFocus(btn, false, "right");
          }
        }
      }

      function setRightMenuFilterFieldClient(field, val, onlyRefreshEntries = false) {
        ensureRightMenuFilterStateClient();
        state[field] = val;
        if (onlyRefreshEntries) {
          renderRightMenuSubPanelEntriesOnlyClient();
        } else {
          renderRightMenuSubPanelContentClient(false);
        }
      }

      async function deleteWishlistItemFromRightMenuClient(ev, uid) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (!uid) return;
        if (typeof deleteSavedUid === "function") {
          await deleteSavedUid(uid);
          syncRightMenuBadgesClient();
          if (state.rightMenuTab === "wishlist") {
            renderRightMenuSubPanelContentClient(false);
          }
        }
      }

      function openItemFromRightMenuClient(tc, id) {
        const elev = document.getElementById("tvQuickJumpElevator");
        if (elev) elev.classList.remove("has-subpanel", "is-visible", "is-hover-expanded");
        state.rightMenuTab = null;
        syncRightMenuBadgesClient();
        openDetails(tc, Number(id), false);
      }

      function buildRightMenuEntriesHtmlClient(items, tabMode) {
        if (!items.length) {
          return '<div style="padding:18px 12px;text-align:center;color:var(--text-muted);font-size:12px;background:rgba(15,23,42,0.38);border-radius:10px;border:1px dashed rgba(148,163,184,0.25)">' +
            (tabMode === "wishlist"
              ? (state.isAuthenticated ? 'Keine passenden Einträge in deiner Merkliste gefunden.' : '🔒 Bitte logge dich ein oder nutze die Mini-App in Telegram, um deine Merkliste zu nutzen.')
              : 'Keine passenden Einträge unter „Zuletzt gesehen“ gefunden.') +
          '</div>';
        }
        return items.map(it => {
          const thumbUrl = resolvePosterUrlClient(it.poster, "w185", "");
          const typeBadge = it.tc === "s" ? "📺 Serie" : "🎬 Film";
          const ratingBadge = it.ratingNum > 0 ? ('<span style="color:#fbbf24;font-weight:800">★ ' + it.ratingNum.toFixed(1) + '</span>') : '';
          const fskBadge = it.fskLabel ? ('<span style="padding:1px 5px;border-radius:4px;background:rgba(148,163,184,0.18);border:1px solid rgba(148,163,184,0.3);font-size:10px">' + esc(it.fskLabel) + '</span>') : '';
          const epBadge = it.epCount > 0 ? ('<span style="color:#38bdf8;font-size:10.5px;font-weight:700">• ' + it.epCount + ' Flg.</span>') : '';
          const delActionHtml = tabMode === "wishlist"
            ? ('<button type="button" class="btn danger" style="padding:4px 7px;font-size:11px" onclick="deleteWishlistItemFromRightMenuClient(event,\\'' + esc(it.uid) + '\\')" title="Aus Merkliste entfernen">🗑️</button>')
            : ('<button type="button" class="btn danger" style="padding:4px 7px;font-size:11px" onclick="removeRecentViewedItem(event,\\'' + esc(it.tc) + '\\',' + Number(it.targetId) + ')" title="Aus Verlauf entfernen">✕</button>');
          return '<div class="rm-entry-card" tabindex="0" onclick="openItemFromRightMenuClient(\\'' + esc(it.tc) + '\\',' + Number(it.targetId) + ')">' +
            '<div style="display:flex;align-items:center;gap:9px;min-width:0;flex:1">' +
              (thumbUrl
                ? '<img src="' + esc(thumbUrl) + '" alt="" loading="lazy" style="width:36px;height:52px;object-fit:cover;border-radius:6px;flex-shrink:0;background:#0f172a" />'
                : '<div style="width:36px;height:52px;border-radius:6px;background:rgba(30,41,59,0.8);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">' + (it.tc === "s" ? "📺" : "🎬") + '</div>') +
              '<div style="min-width:0;flex:1">' +
                '<div style="font-size:12.5px;font-weight:800;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.title) + '</div>' +
                '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:3px;font-size:11px;color:#94a3b8">' +
                  '<span>' + typeBadge + '</span>' +
                  (it.yearStr ? '<span>• ' + esc(it.yearStr) + '</span>' : '') +
                  ratingBadge +
                  fskBadge +
                  epBadge +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:5px;flex-shrink:0">' +
              '<button type="button" class="btn" style="padding:4px 7px;font-size:11px" onclick="event.stopPropagation();playInstantTrailerFromCard(event,\\'' + esc(it.tc) + '\\',' + Number(it.targetId) + ')" title="Trailer direkt abspielen">▶</button>' +
              delActionHtml +
            '</div>' +
          '</div>';
        }).join("");
      }

      function renderRightMenuSubPanelEntriesOnlyClient() {
        const tabMode = state.rightMenuTab || "wishlist";
        const { items, totalRaw } = getRightMenuFilteredAndSortedItemsClient(tabMode);
        const listEl = document.getElementById("rmEntriesScrollMount");
        const countEl = document.getElementById("rmHeaderCountBadge");
        if (listEl) {
          listEl.innerHTML = buildRightMenuEntriesHtmlClient(items, tabMode);
        }
        if (countEl) {
          countEl.textContent = items.length + " / " + totalRaw;
        }
      }

      function renderRightMenuSubPanelContentClient(jumpToFirstEntry = false) {
        const subPanel = document.getElementById("rightMenuSubPanel");
        if (!subPanel) return;
        const tabMode = state.rightMenuTab || "wishlist";
        const isWishlist = tabMode === "wishlist";
        const { items, totalRaw, rawList } = getRightMenuFilteredAndSortedItemsClient(tabMode);

        const availableYears = Array.from(new Set(
          rawList.map(it => {
            const m = String(it?.year || "").match(/(19[0-9]{2}|20[0-9]{2})/);
            return m ? Number(m[1]) : 0;
          }).filter(y => y > 0)
        )).sort((a, b) => b - a);

        const hasActiveFilter = Boolean(
          state.rmYear ||
          state.rmMinRating !== "" ||
          state.rmMaxRating !== "" ||
          (state.rmFsk && state.rmFsk !== "ALL") ||
          (state.rmLetter && state.rmLetter !== "ALL") ||
          (state.rmType && state.rmType !== "all") ||
          (state.rmQuery && state.rmQuery.trim()) ||
          (state.rmSort && state.rmSort !== "added_desc")
        );

        const azLetters = ["ALL", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "#"];
        const curLetter = String(state.rmLetter || "ALL").toUpperCase();

        subPanel.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-bottom:6px;border-bottom:1px solid rgba(56,189,248,0.22);flex-shrink:0">' +
            '<div style="display:flex;align-items:center;gap:7px">' +
              '<span style="font-size:14px;font-weight:900;color:#f8fafc">' + (isWishlist ? '💾 Merkliste' : '🕒 Zuletzt gesehen') + '</span>' +
              '<span id="rmHeaderCountBadge" class="tv-elev-count-badge">' + items.length + ' / ' + totalRaw + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">' +
              (isWishlist
                ? '<button type="button" class="btn blue" style="padding:3px 8px;font-size:11px" onclick="closeRightMenuSubPanelClient();loadWishlist(\\'root\\')" title="Komplette Merkliste & Playlisten-Verwaltung im Hauptfenster öffnen">📂 Vollansicht</button>'
                : (totalRaw > 0 ? '<button type="button" class="btn danger" style="padding:3px 8px;font-size:11px" onclick="clearAllRecentViewed()" title="Gesamten Verlauf leeren">🗑️ Leeren</button>' : '')) +
              (hasActiveFilter
                ? '<button type="button" class="btn danger" style="padding:3px 8px;font-size:11px" onclick="resetRightMenuFiltersClient()" title="Alle Sortierungen & Filter zurücksetzen">↺ Reset</button>'
                : '') +
              '<button type="button" class="btn close-slate" style="padding:3px 8px;font-size:11px" onclick="closeRightMenuSubPanelClient(true)" title="Panel schließen (Pfeil rechts)">Übersicht →</button>' +
            '</div>' +
          '</div>' +
          '<div class="rm-filter-panel">' +
            '<div class="rm-filter-row">' +
              '<select class="rm-ctrl-select" style="flex:1 1 175px" onchange="setRightMenuFilterFieldClient(\\'rmSort\\',this.value)" title="Sortierung wählen">' +
                '<option value="added_desc"' + (state.rmSort === "added_desc" ? " selected" : "") + '>🕒 Hinzugefügt: Neueste zuerst</option>' +
                '<option value="added_asc"' + (state.rmSort === "added_asc" ? " selected" : "") + '>🕰️ Hinzugefügt: Älteste zuerst</option>' +
                '<option value="rating_desc"' + (state.rmSort === "rating_desc" ? " selected" : "") + '>⭐ TMDb-Bewertung (Höchste)</option>' +
                '<option value="rating_asc"' + (state.rmSort === "rating_asc" ? " selected" : "") + '>⭐ TMDb-Bewertung (Niedrigste)</option>' +
                '<option value="year_desc"' + (state.rmSort === "year_desc" ? " selected" : "") + '>📅 Erscheinungsjahr (Neueste)</option>' +
                '<option value="year_asc"' + (state.rmSort === "year_asc" ? " selected" : "") + '>📅 Erscheinungsjahr (Älteste)</option>' +
                '<option value="title_asc"' + (state.rmSort === "title_asc" ? " selected" : "") + '>🔤 Alphabetisch (A–Z)</option>' +
                '<option value="title_desc"' + (state.rmSort === "title_desc" ? " selected" : "") + '>🔤 Alphabetisch (Z–A)</option>' +
              '</select>' +
              '<select class="rm-ctrl-select" onchange="setRightMenuFilterFieldClient(\\'rmType\\',this.value)" title="Nach Film oder Serie filtern">' +
                '<option value="all"' + (state.rmType === "all" ? " selected" : "") + '>🎞️ Alle Typen</option>' +
                '<option value="m"' + (state.rmType === "m" ? " selected" : "") + '>🎬 Filme</option>' +
                '<option value="s"' + (state.rmType === "s" ? " selected" : "") + '>📺 Serien</option>' +
              '</select>' +
              '<select class="rm-ctrl-select" onchange="setRightMenuFilterFieldClient(\\'rmFsk\\',this.value)" title="Nach FSK-Altersfreigabe filtern">' +
                '<option value="ALL"' + (state.rmFsk === "ALL" ? " selected" : "") + '>🔞 Alle FSK</option>' +
                '<option value="0"' + (state.rmFsk === "0" ? " selected" : "") + '>FSK 0</option>' +
                '<option value="6"' + (state.rmFsk === "6" ? " selected" : "") + '>FSK 6</option>' +
                '<option value="12"' + (state.rmFsk === "12" ? " selected" : "") + '>FSK 12</option>' +
                '<option value="16"' + (state.rmFsk === "16" ? " selected" : "") + '>FSK 16</option>' +
                '<option value="18"' + (state.rmFsk === "18" ? " selected" : "") + '>FSK 18</option>' +
              '</select>' +
            '</div>' +
            '<div class="rm-filter-row">' +
              '<select class="rm-ctrl-select" onchange="setRightMenuFilterFieldClient(\\'rmYear\\',this.value)" title="Genaues Erscheinungsjahr aus vorhandenen Jahren wählen">' +
                '<option value=""' + (!state.rmYear ? " selected" : "") + '>📅 Jahr (Alle)</option>' +
                availableYears.map(y => '<option value="' + y + '"' + (String(state.rmYear) === String(y) ? ' selected' : '') + '>📅 ' + y + '</option>').join("") +
              '</select>' +
              '<input type="number" class="rm-ctrl-input" style="width:74px" min="1900" max="2035" placeholder="Jahr..." value="' + esc(state.rmYear || "") + '" oninput="setRightMenuFilterFieldClient(\\'rmYear\\',this.value,true)" title="Genaues Erscheinungsjahr als Zahl eingeben (z. B. 2024)" />' +
              '<div style="display:inline-flex;align-items:center;gap:4px;background:rgba(8,13,26,0.55);padding:2px 6px;border-radius:7px;border:1px solid rgba(148,163,184,0.22)">' +
                '<span style="font-size:10.5px;color:#fbbf24;font-weight:800">★</span>' +
                '<input type="number" class="rm-ctrl-input" style="width:48px;padding:2px 4px;border:none;background:transparent" min="0" max="10" step="0.5" placeholder="Min" value="' + esc(state.rmMinRating !== undefined && state.rmMinRating !== null ? String(state.rmMinRating) : "") + '" oninput="setRightMenuFilterFieldClient(\\'rmMinRating\\',this.value,true)" title="Mindest-Bewertung (0.0 – 10.0)" />' +
                '<span style="font-size:10px;color:#64748b">–</span>' +
                '<input type="number" class="rm-ctrl-input" style="width:48px;padding:2px 4px;border:none;background:transparent" min="0" max="10" step="0.5" placeholder="Max" value="' + esc(state.rmMaxRating !== undefined && state.rmMaxRating !== null ? String(state.rmMaxRating) : "") + '" oninput="setRightMenuFilterFieldClient(\\'rmMaxRating\\',this.value,true)" title="Maximal-Bewertung (0.0 – 10.0)" />' +
              '</div>' +
              '<input type="text" class="rm-ctrl-input" style="flex:1 1 110px;min-width:95px" placeholder="🔍 Titel filtern..." value="' + esc(state.rmQuery || "") + '" oninput="setRightMenuFilterFieldClient(\\'rmQuery\\',this.value,true)" title="Einträge nach Titel durchsuchen" />' +
            '</div>' +
            '<div class="rm-az-strip">' +
              azLetters.map(ltr =>
                '<button type="button" class="rm-az-chip ' + (curLetter === ltr ? 'active' : '') + '" onclick="setRightMenuFilterFieldClient(\\'rmLetter\\',\\'' + ltr + '\\')">' + (ltr === "ALL" ? "Alle" : ltr) + '</button>'
              ).join("") +
            '</div>' +
          '</div>' +
          '<div id="rmEntriesScrollMount" class="rm-entries-scroll">' +
            buildRightMenuEntriesHtmlClient(items, tabMode) +
          '</div>';

        if (jumpToFirstEntry && typeof setSpatialFocus === "function") {
          const firstTarget = subPanel.querySelector(".rm-entry-card, .rm-ctrl-select, .rm-az-chip");
          if (firstTarget) setSpatialFocus(firstTarget, false, "left");
        }
      }

      function toggleRecentViewedCollapsedClient() {
        state.recentStripCollapsed = !state.recentStripCollapsed;
        refreshRecentViewedStripDom();
      }

      function scrollRecentStripClient(dirStep) {
        const track = document.getElementById("recentViewedStripTrack") || document.querySelector(".recent-strip");
        if (!track) return;
        triggerTmaHapticClient("selection");
        const stepPx = Math.max(220, Math.round(track.clientWidth * 0.65));
        track.scrollBy({ left: (Number(dirStep) || 1) * stepPx, behavior: "smooth" });
      }

      function buildRecentViewedStripHtml() {
        if (state.isSearchMode || state.currentView !== "discover" || !recentViewedList.length) return "";
        const isCollapsed = Boolean(state.recentStripCollapsed);
        const showArrows = !isCollapsed && recentViewedList.length > 2;
        return '<div class="recent-strip" id="recentViewedStripTrack">' +
          '<button type="button" class="btn" style="padding:3px 9px;font-size:11px;flex-shrink:0;border-radius:999px;color:var(--text-muted)" onclick="toggleRecentViewedCollapsedClient()" title="Verlauf „Zuletzt angesehen“ ein- oder ausklappen">🕒 Zuletzt (' + recentViewedList.length + ') ' + (isCollapsed ? '▸' : '▾') + '</button>' +
          (showArrows ? '<button type="button" class="recent-strip-scroll-btn" onclick="scrollRecentStripClient(-1)" title="Verlauf nach links scrollen">‹</button>' : '') +
          (!isCollapsed ? (
            recentViewedList.slice(0, 8).map(rv =>
              '<div class="recent-chip" tabindex="0" onclick="openDetails(\\'' + esc(rv.type) + '\\',' + Number(rv.id) + ',false)" title="' + esc(rv.title) + '">' +
                (rv.poster ? '<img src="' + esc(rv.poster) + '" alt="" loading="lazy" />' : '<span>' + (rv.type === 's' ? '📺' : '🎬') + '</span>') +
                '<span style="max-width:130px;overflow:hidden;text-overflow:ellipsis">' + esc(rv.title) + '</span>' +
                '<button type="button" class="recent-chip-del" tabindex="-1" onclick="removeRecentViewedItem(event,\\'' + esc(rv.type) + '\\',' + Number(rv.id) + ')" title="Diesen Eintrag entfernen">✕</button>' +
              '</div>'
            ).join("") +
            (showArrows ? '<button type="button" class="recent-strip-scroll-btn" onclick="scrollRecentStripClient(1)" title="Verlauf nach rechts scrollen">›</button>' : '') +
            '<button type="button" class="btn" style="padding:3px 8px;font-size:10.5px;flex-shrink:0;border-radius:999px;opacity:0.75" onclick="clearAllRecentViewed()" title="Gesamten Verlauf leeren">🗑️ Leeren</button>'
          ) : '') +
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
        const activeStage = document.getElementById("detailHeroStageEl");
        if (activeStage && state.activeDetails && String(state.activeDetails.id) === String(id) && state.activeDetails.typeCode === tc) {
          if (typeof enterDetailForegroundTrailerModeClient === "function") {
            enterDetailForegroundTrailerModeClient(ev);
            return;
          }
        }
        const resolvedTitle = titleText || (ev?.target?.closest?.(".card")?.getAttribute("data-card-title")) || "";
        await openDetails(tc, id, true, resolvedTitle, posterPath);
      }

      function switchInstantTrailerModalProvider(sourceKey) {
        setTrailerProvider(sourceKey);
        switchEmbedSource(sourceKey, false);
        const modalBtns = document.querySelectorAll("#modalRoot button[data-tp-id]");
        modalBtns.forEach(b => {
          const pid = b.getAttribute("data-tp-id") || "";
          const tpObj = TRAILER_PROVIDERS_CLIENT.find(x => x.id === pid);
          const isMatch = pid === sourceKey;
          b.className = "btn " + (isMatch ? "blue" : "");
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
        document.querySelectorAll('.card[data-card-key="' + key + '"]').forEach(cardEl => {
          cardEl.classList.toggle("card-saved", Boolean(isSaved));
          const btn = cardEl.querySelector(".card-quick-save");
          if (btn) {
            btn.classList.toggle("saved", Boolean(isSaved));
            btn.textContent = isSaved ? "✓" : "🔖";
            btn.setAttribute("title", isSaved ? "In deiner Merkliste gespeichert (Tipp oder gedrückt halten zum Entfernen)" : "In Merkliste speichern (Tipp oder Karte gedrückt halten)");
            if (triggerPop) {
              btn.classList.remove("quick-save-pop");
              void btn.offsetWidth; // Reflow erzwingen für erneute CSS-Keyframe-Animation
              btn.classList.add("quick-save-pop");
              setTimeout(() => {
                btn.classList.remove("quick-save-pop");
              }, 360);
            }
          }
        });
        // Hero-Slider Speichern-Button (#heroBtnWishlist) live mitsynchronisieren
        const heroWlBtn = document.getElementById("heroBtnWishlist");
        if (heroWlBtn && heroWlBtn.getAttribute("data-hero-wl-key") === key) {
          heroWlBtn.classList.toggle("saved", Boolean(isSaved));
          heroWlBtn.innerHTML = isSaved ? "✓ Gespeichert" : "＋ Speichern";
          heroWlBtn.setAttribute("title", isSaved ? "Aus deiner Merkliste entfernen" : "Direkt in deiner Merkliste speichern");
        }
        // Detail-Modal Button mitsynchronisieren, falls Modal für diesen Titel aktuell geöffnet ist
        if (state && state.activeDetails && String(state.activeDetails.id) === String(id) && state.activeDetails.typeCode === typeCode) {
          state.activeDetails.isSaved = Boolean(isSaved);
          const modalBtn = document.getElementById("modalWishlistBtn");
          if (modalBtn) {
            modalBtn.className = "detail-btn-glass " + (isSaved ? "saved" : "");
            modalBtn.textContent = isSaved ? "✓ Gespeichert" : "＋ Speichern";
          }
        }
        for (const [cKey, cVal] of clientDetailsCache.entries()) {
          if (cKey.startsWith(key + "_") && cVal && cVal.data) {
            cVal.data.isSaved = Boolean(isSaved);
          }
        }
        if (typeof syncRightMenuBadgesClient === "function") {
          syncRightMenuBadgesClient();
        }
      }

      const wishlistTogglesInFlight = new Set();

      async function quickToggleCardWishlist(ev, typeCode, id, titleText) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        if (!state.isAuthenticated) { openAccountModal(); return; }

        const cardKey = (typeCode === "s" ? "s" : "m") + "_" + id;
        if (wishlistTogglesInFlight.has(cardKey)) return;
        wishlistTogglesInFlight.add(cardKey);

        const resolvedTitle = titleText || (ev?.target?.closest?.(".card")?.getAttribute("data-card-title")) || "";
        const prevSaved = savedKeysSet.has(cardKey);
        const nextSaved = !prevSaved;

        // 1. Sofortiges optimistisches UI-Update und Pop-Animation auf dem Cover
        syncCardWishlistBadgeInDom(typeCode, id, nextSaved, true);
        showHudToast((nextSaved ? "💾 Gespeichert: " : "🗑️ Entfernt: ") + (resolvedTitle || "Titel"));

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
        } finally {
          setTimeout(() => wishlistTogglesInFlight.delete(cardKey), 400);
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

      // Intelligenter Lauftext (Marquee) für überlange Kartentitel, Folgennamen & Modal-Titel bei Hover, Fokus oder Auswahl
      let cardHoverPrewarmTimer = null;
      let cardTouchPrewarmTimer = null;
      const prewarmedDetailKeysInFlightSet = new Set();

      function prewarmItemDetailsClient(typeCode, id) {
        if (!id || typeof apiFetchJson !== "function") return;
        if (typeof backupImportJob !== "undefined" && backupImportJob && backupImportJob.running) return;
        const tc = typeCode === "s" ? "s" : "m";
        const vipAllowed = typeof isCurrentUserVip === "function" ? isCurrentUserVip() : false;
        const cacheKey = tc + "_" + id + "_" + (vipAllowed ? "vip" : "std");
        if (typeof clientDetailsCache !== "undefined" && clientDetailsCache instanceof Map) {
          const existing = clientDetailsCache.get(cacheKey);
          if (existing && (Date.now() - existing.ts < CLIENT_CACHE_TTL_MS)) return;
        }
        if (prewarmedDetailKeysInFlightSet.has(cacheKey)) return;
        prewarmedDetailKeysInFlightSet.add(cacheKey);
        apiFetchJson(API_BASE + "/details?chatId=" + encodeURIComponent(chatId) + "&type=" + tc + "&id=" + encodeURIComponent(id))
          .then((d) => {
            if (d && d.ok !== false && typeof clientDetailsCache !== "undefined" && clientDetailsCache instanceof Map) {
              clientDetailsCache.set(cacheKey, { data: d, ts: Date.now() });
              if (d.logo_path && typeof preloadClearLogoBitmapClient === "function") {
                preloadClearLogoBitmapClient(d.logo_path);
              }
            }
          })
          .catch(() => {})
          .finally(() => {
            prewarmedDetailKeysInFlightSet.delete(cacheKey);
          });
      }

      function scheduleCardIntentPrewarmClient(cardEl, delayMs = 70) {
        if (!cardEl || typeof cardEl.getAttribute !== "function") return;
        const rawKey = cardEl.getAttribute("data-card-key") || "";
        if (!rawKey) return;
        const parts = rawKey.split("_");
        if (parts.length < 2) return;
        const tc = parts[0] === "s" ? "s" : "m";
        const idNum = Number(parts[1]);
        if (!idNum) return;
        if (cardHoverPrewarmTimer) clearTimeout(cardHoverPrewarmTimer);
        cardHoverPrewarmTimer = setTimeout(() => {
          cardHoverPrewarmTimer = null;
          prewarmItemDetailsClient(tc, idNum);
        }, delayMs);
      }

      function activateCardTitleMarquee(card) {
        if (!card || !card.querySelector || card._noMarqueeNeeded) return;
        const titleEl = card.querySelector(".card-title");
        if (!titleEl || titleEl.classList.contains("is-marquee-overflow")) return;
        const rawText = (card.getAttribute("data-card-title") || titleEl.textContent || "").trim();
        if (rawText.length <= 20) {
          card._noMarqueeNeeded = true;
          return;
        }
        const isClamped = (titleEl.scrollHeight > titleEl.clientHeight + 2) || (rawText.length > 30);
        if (!isClamped) {
          card._noMarqueeNeeded = true;
          return;
        }
        let textSpan = titleEl.querySelector(".card-title-text");
        if (!textSpan) {
          titleEl.innerHTML = '<span class="card-title-text">' + esc(rawText) + '</span>';
          textSpan = titleEl.querySelector(".card-title-text");
        }
        titleEl.classList.add("is-marquee-overflow");
        const overflowPx = Math.max(0, (textSpan ? textSpan.scrollWidth : titleEl.scrollWidth) - titleEl.clientWidth);
        if (overflowPx > 4) {
          const durSec = Math.max(4.2, Math.min(11.5, 2.5 + overflowPx / 36)).toFixed(2) + "s";
          titleEl.style.setProperty("--marquee-dist", "-" + (overflowPx + 10) + "px");
          titleEl.style.setProperty("--marquee-dur", durSec);
        } else {
          titleEl.classList.remove("is-marquee-overflow");
          card._noMarqueeNeeded = true;
        }
      }

      function deactivateCardTitleMarquee(card) {
        if (!card || !card.querySelector) return;
        const titleEl = card.querySelector(".card-title");
        if (!titleEl || !titleEl.classList.contains("is-marquee-overflow")) return;
        titleEl.classList.remove("is-marquee-overflow");
        titleEl.style.removeProperty("--marquee-dist");
        titleEl.style.removeProperty("--marquee-dur");
      }

      function activateInlineTextMarquee(wrapEl) {
        if (!wrapEl || wrapEl.classList.contains("is-marquee-overflow")) return;
        const textSpan = wrapEl.querySelector(".ep-name-text, .inline-marquee-text");
        if (!textSpan) return;
        const overflowPx = Math.max(0, textSpan.scrollWidth - wrapEl.clientWidth);
        if (overflowPx > 3) {
          const durSec = Math.max(4.2, Math.min(12.5, 2.6 + overflowPx / 34)).toFixed(2) + "s";
          wrapEl.classList.add("is-marquee-overflow");
          wrapEl.style.setProperty("--marquee-dist", "-" + (overflowPx + 16) + "px");
          wrapEl.style.setProperty("--marquee-dur", durSec);
        }
      }

      function deactivateInlineTextMarquee(wrapEl) {
        if (!wrapEl || !wrapEl.classList.contains("is-marquee-overflow")) return;
        if (wrapEl.hasAttribute("data-marquee-always")) return;
        wrapEl.classList.remove("is-marquee-overflow");
        wrapEl.style.removeProperty("--marquee-dist");
        wrapEl.style.removeProperty("--marquee-dur");
      }

      window.refreshModalAndEpisodeMarquees = function(rootNode) {
        const scope = rootNode || document;
        if (!scope || !scope.querySelectorAll) return;
        scope.querySelectorAll("[data-marquee-always='1']").forEach(wrapEl => {
          wrapEl.classList.remove("is-marquee-overflow");
          activateInlineTextMarquee(wrapEl);
        });
      };

      window.syncActiveCardMarquee = function(focusedEl) {
        const activeCard = focusedEl && focusedEl.closest ? focusedEl.closest(".card") : null;
        document.querySelectorAll(".card-title.is-marquee-overflow").forEach(el => {
          const parentCard = el.closest(".card");
          if (parentCard && parentCard !== activeCard && !parentCard.matches(":hover")) {
            deactivateCardTitleMarquee(parentCard);
          }
        });
        if (activeCard) {
          activateCardTitleMarquee(activeCard);
          scheduleCardIntentPrewarmClient(activeCard, 60);
        }
        const activeEpRow = focusedEl && focusedEl.closest ? focusedEl.closest(".ep-row, .inline-marquee-wrap") : null;
        document.querySelectorAll(".ep-name-wrap.is-marquee-overflow, .inline-marquee-wrap.is-marquee-overflow").forEach(el => {
          if (el.hasAttribute("data-marquee-always")) return;
          const parentRow = el.closest(".ep-row") || el;
          if (parentRow !== activeEpRow && !parentRow.matches(":hover")) {
            deactivateInlineTextMarquee(el);
          }
        });
        if (activeEpRow) {
          const wraps = activeEpRow.classList && (activeEpRow.classList.contains("ep-name-wrap") || activeEpRow.classList.contains("inline-marquee-wrap"))
            ? [activeEpRow]
            : Array.from(activeEpRow.querySelectorAll(".ep-name-wrap, .inline-marquee-wrap"));
          wraps.forEach(w => activateInlineTextMarquee(w));
        }
      };

      let lastMouseOverCardEl = null;
      document.addEventListener("mouseover", function(ev) {
        const card = ev.target && ev.target.closest ? ev.target.closest(".card") : null;
        if (card) {
          if (card !== lastMouseOverCardEl) {
            lastMouseOverCardEl = card;
            activateCardTitleMarquee(card);
            scheduleCardIntentPrewarmClient(card, 75);
          }
        }
        const epRow = ev.target && ev.target.closest ? ev.target.closest(".ep-row, .inline-marquee-wrap") : null;
        if (epRow) {
          if (epRow.classList.contains("inline-marquee-wrap")) {
            activateInlineTextMarquee(epRow);
          } else {
            epRow.querySelectorAll(".ep-name-wrap, .inline-marquee-wrap").forEach(w => activateInlineTextMarquee(w));
          }
        }
      }, { passive: true });

      document.addEventListener("mouseout", function(ev) {
        const card = ev.target && ev.target.closest ? ev.target.closest(".card") : null;
        if (card) {
          const rel = ev.relatedTarget;
          if (!rel || !card.contains(rel)) {
            if (lastMouseOverCardEl === card) lastMouseOverCardEl = null;
            if (cardHoverPrewarmTimer) {
              clearTimeout(cardHoverPrewarmTimer);
              cardHoverPrewarmTimer = null;
            }
            if (!card.classList.contains("spatial-focus") && !card.classList.contains("card-subnav-active")) {
              deactivateCardTitleMarquee(card);
            }
          }
        }
        const epRow = ev.target && ev.target.closest ? ev.target.closest(".ep-row, .inline-marquee-wrap") : null;
        if (epRow) {
          const rel = ev.relatedTarget;
          if (!rel || !epRow.contains(rel)) {
            if (epRow.classList.contains("inline-marquee-wrap")) {
              deactivateInlineTextMarquee(epRow);
            } else {
              epRow.querySelectorAll(".ep-name-wrap, .inline-marquee-wrap").forEach(w => deactivateInlineTextMarquee(w));
            }
          }
        }
      }, { passive: true });

      document.addEventListener("touchstart", function(ev) {
        if (!ev.touches || ev.touches.length !== 1) return;
        const epTouch = ev.target && ev.target.closest ? ev.target.closest(".ep-row, .inline-marquee-wrap") : null;
        if (epTouch && typeof window.syncActiveCardMarquee === "function") {
          window.syncActiveCardMarquee(epTouch);
        }
        if (ev.target && ev.target.closest && ev.target.closest("button, a, select, input")) return;
        const card = ev.target && ev.target.closest ? ev.target.closest(".card[data-card-key]") : null;
        if (!card) return;
        if (typeof window.syncActiveCardMarquee === "function") window.syncActiveCardMarquee(card);
        const rawKey = card.getAttribute("data-card-key") || "";
        const parts = rawKey.split("_");
        if (parts.length < 2) return;
        const tc = parts[0] === "s" ? "s" : "m";
        const idNum = Number(parts[1]);
        if (!idNum) return;
        if (cardTouchPrewarmTimer) clearTimeout(cardTouchPrewarmTimer);
        cardTouchPrewarmTimer = setTimeout(() => {
          cardTouchPrewarmTimer = null;
          prewarmItemDetailsClient(tc, idNum);
        }, 42);
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
        if (cardTouchPrewarmTimer) {
          clearTimeout(cardTouchPrewarmTimer);
          cardTouchPrewarmTimer = null;
        }
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

      // Desktop Mouse Long-Press (~420ms) auf Katalog-Karten zum direkten Speichern/Entfernen in der Merkliste
      document.addEventListener("mousedown", function(ev) {
        if (ev.button !== 0) return;
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
        cardLongPressStartX = ev.clientX;
        cardLongPressStartY = ev.clientY;
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
      });

      document.addEventListener("mousemove", function(ev) {
        if (!cardLongPressTimer) return;
        const dx = ev.clientX - cardLongPressStartX;
        const dy = ev.clientY - cardLongPressStartY;
        if ((dx * dx + dy * dy) > 256) {
          clearCardLongPressTimer();
        }
      });

      document.addEventListener("mouseup", function() {
        if (cardLongPressTriggered) {
          lastCardLongPressAt = Date.now();
          cardLongPressTriggered = false;
        }
        clearCardLongPressTimer();
      });

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
        visibleCatalogPage: 1,
        items: [],
        genres: {},
        settings: {},
        history: [],
        wlFolder: "root",
        wlFilterType: "all",
        wlSort: "added_desc",
        wlSearchQuery: "",
        wlLetter: "ALL",
        wlViewMode: (function() {
          try { return localStorage.getItem("tma_wl_view_mode") || "grid"; } catch (e) { return "grid"; }
        })(),
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
      // 3. KINO-SPOTLIGHT HERO-SHOWCASE (POSTER-KARTE + CROSSFADE/ZOOM + MINIATUR-LEISTE)
      // =========================================================================
      let heroRotationTimer = null;
      let heroPointerHovered = false;
      const overviewTranslationCacheClient = new Map();
      const heroDetailsOverviewBackfillSet = new Set();

      function isGenericPlaceholderOverviewClient(text) {
        const t = String(text || "").trim();
        if (!t) return true;
        return t.indexOf("Tippe auf Details für Trailer") !== -1 || t === "Keine deutsche Beschreibung hinterlegt.";
      }

      function isLikelyEnglishOverviewClient(text) {
        const raw = String(text || "").trim();
        if (!raw || raw.length < 24 || isGenericPlaceholderOverviewClient(raw)) return false;
        const lower = " " + raw.toLowerCase().replace(/[^a-zäöüß\\s]/g, " ") + " ";
        const enMatches = lower.match(/\\b(the|and|with|from|when|after|into|their|while|who|his|her|they|that|this|for|about|between|against|through|during|before|under|around|world|family|life|young|story|years|discover|discovers|finds|must|new|two|one|three|first|last)\\b/g);
        const deMatches = lower.match(/\\b(und|der|die|das|ein|eine|einer|einem|einen|mit|auf|für|von|sich|nicht|auch|als|nach|wird|werden|wurde|über|durch|gegen|zwischen|während|oder|aber|wenn|wie|noch|nur|schon|mehr|seiner|seinem|ihrer|ihrem|ihren|dieser|diese|dieses)\\b/g);
        const enCount = enMatches ? enMatches.length : 0;
        const deCount = deMatches ? deMatches.length : 0;
        return enCount >= 2 && enCount > deCount * 1.5;
      }

      function buildContextualHeroFallbackOverviewClient(hero, isMovie) {
        if (!hero) return "Exklusives Highlight im Katalog – entdecke Trailer, Streams, Besetzung und alle Filmreihen-Details.";
        const titleRaw = String(hero.title || hero.name || "Dieses Highlight").trim();
        const yearStr = String(hero.release_date || hero.first_air_date || "").slice(0, 4);
        const voteNum = Number(hero.vote_average || 0);
        const voteStr = voteNum > 0 ? voteNum.toFixed(1) : "";
        const genres = typeof resolveHeroGenreItemsClient === "function"
          ? resolveHeroGenreItemsClient(hero, isMovie).map(g => g.name).filter(Boolean)
          : [];
        const genreText = genres.length > 0 ? genres.slice(0, 3).join(", ") : (isMovie ? "Kino-Highlight" : "Serien-Highlight");
        const typeWord = isMovie ? "Spielfilm" : "Serie";
        return "„" + titleRaw + "“" + (yearStr ? (" (" + yearStr + ")") : "") +
          " zählt zu den ausgewählten " + typeWord + "-Empfehlungen im Bereich " + genreText +
          (voteStr ? (" und überzeugt mit einer TMDb-Wertung von ★ " + voteStr) : "") +
          ". Starte direkt den Trailer oder öffne die Detailansicht für Streams, Episoden und Besetzung.";
      }

      function resolveHeroOverviewTextClient(hero, isMovie) {
        if (!hero) return "";
        if (hero._showTranslatedOverviewDe && hero._translatedOverviewDe) {
          return String(hero._translatedOverviewDe).trim();
        }
        const raw = String(hero.overview || "").trim();
        if (raw && !isGenericPlaceholderOverviewClient(raw)) {
          return raw;
        }
        return buildContextualHeroFallbackOverviewClient(hero, isMovie);
      }

      async function ensureHeroSlidesOverviewsClient() {
        if (!Array.isArray(state.heroSlides) || state.heroSlides.length === 0) return;
        const slidesSnapshot = state.heroSlides.slice();
        for (let i = 0; i < slidesSnapshot.length; i++) {
          const sl = slidesSnapshot[i];
          if (!sl || !sl.id) continue;
          const rawOv = String(sl.overview || "").trim();
          if (rawOv && !isGenericPlaceholderOverviewClient(rawOv)) continue;
          const slType = sl.media_type === "tv" || state.type === "s" ? "s" : "m";
          const key = slType + "_" + sl.id;
          if (heroDetailsOverviewBackfillSet.has(key)) continue;
          heroDetailsOverviewBackfillSet.add(key);
          try {
            const det = await apiFetchJson(API_BASE + "/details?type=" + slType + "&id=" + encodeURIComponent(sl.id));
            const fetchedOv = String(det?.overview || "").trim();
            if (fetchedOv && !isGenericPlaceholderOverviewClient(fetchedOv)) {
              sl.overview = fetchedOv;
              const curHero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
              if (curHero && Number(curHero.id) === Number(sl.id)) {
                updateHeroBannerDomOnly(false);
              }
            }
          } catch (_e) {}
        }
      }

      function triggerTmaHapticClient(style) {
        try {
          const s = style || "light";
          if (tg && tg.HapticFeedback) {
            if (s === "selection" && typeof tg.HapticFeedback.selectionChanged === "function") {
              tg.HapticFeedback.selectionChanged();
              return;
            }
            if (typeof tg.HapticFeedback.impactOccurred === "function") {
              tg.HapticFeedback.impactOccurred(s === "heavy" ? "heavy" : s === "medium" ? "medium" : "light");
              return;
            }
          }
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            navigator.vibrate(s === "heavy" ? 20 : s === "medium" ? 14 : 9);
          }
        } catch (_e) {}
      }

      async function translateOverviewTextClient(ev, itemKey, boxId, textElId, btnId) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        triggerTmaHapticClient("light");
        const textEl = document.getElementById(textElId);
        const btnEl = document.getElementById(btnId);
        const boxEl = document.getElementById(boxId);
        if (!textEl || !btnEl) return;

        // Ziel-Objekt (Hero-Slide oder Detail-Modal) ermitteln
        let targetObj = null;
        if (itemKey === "activeDetails" && state.activeDetails) {
          targetObj = state.activeDetails;
        } else if (Array.isArray(state.heroSlides)) {
          targetObj = state.heroSlides.find(s => ((s.media_type === "tv" || state.type === "s" ? "s" : "m") + "_" + s.id) === itemKey) || state.heroSlides[state.heroIndex];
        }
        const origText = String(targetObj?._originalOverviewEn || targetObj?.overview || textEl.getAttribute("data-orig-overview") || textEl.textContent || "").trim();
        if (!origText) return;
        if (targetObj && !targetObj._originalOverviewEn) {
          targetObj._originalOverviewEn = origText;
        }
        textEl.setAttribute("data-orig-overview", origText);

        // Toggle zurück auf Englisch, falls bereits übersetzt
        if (btnEl.classList.contains("is-translated")) {
          btnEl.classList.remove("is-translated");
          btnEl.innerHTML = "🌐 Auf Deutsch übersetzen";
          textEl.textContent = origText;
          if (targetObj) targetObj._showTranslatedOverviewDe = false;
          if (boxEl) requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(boxEl));
          return;
        }

        // Aus Cache laden, falls schon übersetzt
        const cachedDe = (targetObj && targetObj._translatedOverviewDe) || overviewTranslationCacheClient.get(origText);
        if (cachedDe) {
          if (targetObj) {
            targetObj._translatedOverviewDe = cachedDe;
            targetObj._showTranslatedOverviewDe = true;
          }
          textEl.textContent = cachedDe;
          btnEl.classList.add("is-translated");
          btnEl.innerHTML = "🇬🇧 Original anzeigen";
          if (boxEl) requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(boxEl));
          return;
        }

        const prevLabel = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = "⏳ Übersetze…";
        try {
          const res = await apiFetchJson(API_BASE + "/translate?text=" + encodeURIComponent(origText) + "&sl=en&tl=de");
          const translated = String(res?.translatedText || "").trim();
          if (translated) {
            overviewTranslationCacheClient.set(origText, translated);
            if (targetObj) {
              targetObj._translatedOverviewDe = translated;
              targetObj._showTranslatedOverviewDe = true;
            }
            textEl.textContent = translated;
            btnEl.classList.add("is-translated");
            btnEl.innerHTML = "🇬🇧 Original anzeigen";
            if (boxEl) requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(boxEl));
          } else {
            btnEl.innerHTML = prevLabel;
          }
        } catch (_err) {
          btnEl.innerHTML = prevLabel;
        } finally {
          btnEl.disabled = false;
        }
      }

      function rebuildHeroSlides(itemsList) {
        const withBackdrop = (itemsList || []).filter(i => i && (i.backdrop_path || i.poster_path));
        const withOverview = withBackdrop.filter(i => i.overview && !isGenericPlaceholderOverviewClient(i.overview));
        const withoutOverview = withBackdrop.filter(i => !i.overview || isGenericPlaceholderOverviewClient(i.overview));
        const prioritizedPool = withOverview.concat(withoutOverview);
        if (prioritizedPool.length <= 6) {
          state.heroSlides = prioritizedPool.slice(0, 6);
        } else {
          const pool = prioritizedPool.slice(0, 14);
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
        setTimeout(() => {
          if (typeof prewarmAllHeroSlidesClearLogosClient === "function") {
            prewarmAllHeroSlidesClearLogosClient();
          }
          const activeSlide = state.heroSlides[0];
          if (activeSlide && activeSlide.id) {
            const activeType = activeSlide.media_type === "tv" || state.type === "s" ? "s" : "m";
            prewarmItemDetailsClient(activeType, activeSlide.id);
          }
        }, 35);
        setTimeout(() => {
          ensureHeroSlidesOverviewsClient();
        }, 380);
      }

      // =========================================================================
      // 3b. GESTAFFELTE BILD-LADEPIPELINE (SLIDER 1 -> SLIDER 2..N + SEITE 1 COVER -> INTERSECTIONOBSERVER)
      //     INKLUSIVE SCHNELL-SCROLL-SCHUTZ, AUTO-PAGINATION & SMART-SEITENINDIKATOR
      // =========================================================================
      const LAZY_POSTER_PLACEHOLDER_SVG =
        "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22450%22 viewBox=%220 0 300 450%22%3E%3Crect width=%22300%22 height=%22450%22 fill=%22%230f172a%22/%3E%3C/svg%3E";
      const LAZY_POSTER_FALLBACK_SVG =
        "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22450%22 viewBox=%220 0 300 450%22%3E%3Crect width=%22300%22 height=%22450%22 fill=%22%230f172a%22/%3E%3Ctext x=%22150%22 y=%22225%22 fill=%22%2364748b%22 font-family=%22sans-serif%22 font-size=%2216%22 text-anchor=%22middle%22%3EKein Poster%3C/text%3E%3C/svg%3E";

      let heroWaterfallSeq = 0;
      let catalogCoversUnlocked = false;
      let lazyCoverObserver = null;
      let infiniteScrollSentinelObserver = null;
      let catalogPageTrackObserver = null;
      let smartPageIndicatorIdleTimer = null;
      const pendingIntersectedCoversSet = new Set();
      const preloadedHeroSlideUrlsSet = new Set();

      function hydrateLazyCoverImageClient(img) {
        if (!img || !(img instanceof Element)) return;
        if (img._dwellTimer) {
          clearTimeout(img._dwellTimer);
          img._dwellTimer = null;
        }
        pendingIntersectedCoversSet.delete(img);
        const targetSrc = img.getAttribute("data-lazy-src");
        if (!targetSrc) {
          img.classList.remove("is-loading");
          img.classList.add("is-loaded");
          return;
        }
        img.removeAttribute("data-lazy-src");
        if (lazyCoverObserver) {
          try { lazyCoverObserver.unobserve(img); } catch (_e) {}
        }
        try { img.decoding = "async"; } catch (_e) {}
        const finalizeLoaded = () => {
          img.classList.remove("is-loading");
          img.classList.add("is-loaded");
        };
        img.addEventListener("load", finalizeLoaded, { once: true });
        img.addEventListener("error", finalizeLoaded, { once: true });
        img.src = targetSrc;
      }

      function ensureLazyCoverIntersectionObserverClient() {
        if (lazyCoverObserver || typeof IntersectionObserver === "undefined") return lazyCoverObserver;
        lazyCoverObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const img = entry.target;
              if (!img) continue;
              if (entry.isIntersecting) {
                img._isIntersectingViewportZone = true;
                if (!catalogCoversUnlocked) {
                  pendingIntersectedCoversSet.add(img);
                  continue;
                }
                hydrateLazyCoverImageClient(img);
              } else {
                img._isIntersectingViewportZone = false;
                pendingIntersectedCoversSet.delete(img);
                if (img._dwellTimer) {
                  clearTimeout(img._dwellTimer);
                  img._dwellTimer = null;
                }
              }
            }
          },
          {
            root: null,
            rootMargin: "120% 0px 120% 0px",
            threshold: 0.01
          }
        );
        return lazyCoverObserver;
      }

      function preloadCatalogPageCoversClient(pageNum) {
        const targetPageStr = String(pageNum || state.startPage || 1);
        const imgs = Array.from(
          document.querySelectorAll(
            '#resultsGridContainer img.lazy-cover-img[data-lazy-src][data-page-num="' + targetPageStr + '"]'
          )
        );
        const listToLoad = imgs.length > 0
          ? imgs
          : Array.from(document.querySelectorAll("#resultsGridContainer img.lazy-cover-img[data-lazy-src]")).slice(0, 20);
        if (!listToLoad.length) return;
        let idx = 0;
        const loadBatch = () => {
          if (!catalogCoversUnlocked) return;
          const slice = listToLoad.slice(idx, idx + 8);
          idx += 8;
          for (const img of slice) {
            hydrateLazyCoverImageClient(img);
          }
          if (idx < listToLoad.length) {
            requestAnimationFrame(loadBatch);
          }
        };
        loadBatch();
      }

      function unlockCatalogCoversLoadingClient(preloadFirstPage = true) {
        const wasLocked = !catalogCoversUnlocked;
        catalogCoversUnlocked = true;
        if (pendingIntersectedCoversSet.size > 0) {
          const queued = Array.from(pendingIntersectedCoversSet);
          pendingIntersectedCoversSet.clear();
          queued.forEach((img) => hydrateLazyCoverImageClient(img));
        }
        if (wasLocked && preloadFirstPage) {
          preloadCatalogPageCoversClient(state.startPage || 1);
        }
      }

      function preloadSingleImageUrlClient(url, highPriority = false) {
        return new Promise((resolve) => {
          if (!url || preloadedHeroSlideUrlsSet.has(url)) {
            resolve(true);
            return;
          }
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            preloadedHeroSlideUrlsSet.add(url);
            resolve(true);
          };
          const timer = setTimeout(finish, highPriority ? 360 : 900);
          try {
            const img = new Image();
            if (highPriority && "fetchPriority" in img) {
              try { img.fetchPriority = "high"; } catch (_e) {}
            }
            img.onload = () => { clearTimeout(timer); finish(); };
            img.onerror = () => { clearTimeout(timer); finish(); };
            img.src = url;
          } catch (_err) {
            clearTimeout(timer);
            finish();
          }
        });
      }

      async function preloadHeroSlideAssetsPairClient(slideObj, highPriority = false) {
        if (!slideObj) return;
        const slideType = slideObj.media_type === "tv" || state.type === "s" ? "s" : "m";
        if (typeof ensureHeroSlideClearLogoClient === "function") {
          ensureHeroSlideClearLogoClient(slideObj, slideType);
        }
        const bpUrl = typeof resolveHeroSlideBackdropUrlClient === "function" ? resolveHeroSlideBackdropUrlClient(slideObj) : "";
        const posterUrl = typeof resolveHeroSlidePosterUrlClient === "function" ? resolveHeroSlidePosterUrlClient(slideObj, "w780") : "";
        const isPortraitViewport = (window.innerWidth || 1024) <= 640 || (window.innerHeight > window.innerWidth);
        const primaryUrl = isPortraitViewport ? (posterUrl || bpUrl) : (bpUrl || posterUrl);
        if (primaryUrl) {
          await preloadSingleImageUrlClient(primaryUrl, highPriority);
        }
      }

      function observeLazyCoversInContainerClient(rootEl) {
        const scope = rootEl || document;
        if (!scope || typeof scope.querySelectorAll !== "function") return;
        const obs = ensureLazyCoverIntersectionObserverClient();
        const imgs = Array.from(scope.querySelectorAll("img.lazy-cover-img[data-lazy-src]"));
        if (!obs) {
          imgs.forEach((img) => hydrateLazyCoverImageClient(img));
          return;
        }
        imgs.forEach((img) => obs.observe(img));
      }

      function ensureInfiniteScrollSentinelObserverClient() {
        if (typeof IntersectionObserver === "undefined") return;
        if (infiniteScrollSentinelObserver) {
          infiniteScrollSentinelObserver.disconnect();
        }
        const sentinelEl = document.getElementById("infiniteScrollSentinel");
        if (!sentinelEl) return;
        infiniteScrollSentinelObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting && state.hasMorePages && !state.loadingMore) {
                const sliderBlocking = Boolean(
                  !state.isSearchMode &&
                  !state.heroHidden &&
                  !heroCurtainScrolledToCatalog &&
                  Array.isArray(state.heroSlides) &&
                  state.heroSlides.length > 0
                );
                if (!sliderBlocking && typeof loadMoreResults === "function") {
                  loadMoreResults(true);
                }
              }
            }
          },
          {
            root: null,
            rootMargin: "0px 0px 850px 0px",
            threshold: 0.01
          }
        );
        infiniteScrollSentinelObserver.observe(sentinelEl);
      }

      function ensureCatalogPageTrackObserverClient(rootEl) {
        if (typeof IntersectionObserver === "undefined") return;
        if (!catalogPageTrackObserver) {
          catalogPageTrackObserver = new IntersectionObserver(
            (entries) => {
              let bestPage = null;
              let bestTop = Infinity;
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  const pAttr = Number(entry.target.getAttribute("data-page-num") || 0);
                  if (pAttr > 0 && entry.boundingClientRect.top < bestTop) {
                    bestTop = entry.boundingClientRect.top;
                    bestPage = pAttr;
                  }
                }
              }
              if (bestPage && bestPage !== state.visibleCatalogPage) {
                state.visibleCatalogPage = bestPage;
                syncSmartPageIndicatorDomClient(true);
              }
            },
            {
              root: null,
              rootMargin: "-15% 0px -55% 0px",
              threshold: 0.05
            }
          );
        }
        const scope = rootEl || document.getElementById("resultsGridContainer");
        if (!scope || typeof scope.querySelectorAll !== "function") return;
        const cards = scope.querySelectorAll(".card[data-page-num]");
        cards.forEach((c) => catalogPageTrackObserver.observe(c));
      }

      let lastPageIndicatorDomSig = "";
      function syncSmartPageIndicatorDomClient(pulseActive = false) {
        const totPages = Math.max(1, Number(state.totalPages) || 1);
        const curLoadedMaxPage = Math.max(1, Number(state.page) || 1);
        const startP = Math.max(1, Math.min(curLoadedMaxPage, Number(state.startPage) || 1));
        const visPage = Math.max(startP, Math.min(curLoadedMaxPage, Number(state.visibleCatalogPage) || curLoadedMaxPage));

        const isCatalogVisible = Boolean(
          (state.currentView === "discover" || state.isSearchMode) &&
          !state.currentCollectionId &&
          !state.currentUniverseId &&
          !state.currentPersonId &&
          totPages > 1 &&
          state.items.length > 0 &&
          (state.isSearchMode || state.heroHidden || heroCurtainScrolledToCatalog || (window.scrollY || window.pageYOffset || 0) > 20)
        );

        let floatBtn = document.getElementById("smartPageIndicatorBtn");
        if (!floatBtn && document.body) {
          floatBtn = document.createElement("button");
          floatBtn.type = "button";
          floatBtn.id = "smartPageIndicatorBtn";
          floatBtn.setAttribute("onclick", "openPageJumpModalClient()");
          floatBtn.setAttribute("title", "Aktuelle Seite – Klicken oder Enter für direkte Seitenwahl (TV & Touch)");
          document.body.appendChild(floatBtn);
        }

        const nextSig = visPage + "|" + totPages + "|" + startP + "|" + curLoadedMaxPage + "|" + (state.hasMorePages ? "1" : "0") + "|" + (isCatalogVisible ? "1" : "0");
        const topPill = document.getElementById("sectionPageCounterPill");
        if (nextSig !== lastPageIndicatorDomSig || (topPill && !topPill._sigSynced)) {
          lastPageIndicatorDomSig = nextSig;
          if (topPill) {
            topPill.innerHTML = "📄 Seite " + visPage + " / " + totPages + " ▾";
            topPill._sigSynced = true;
          }

          const sentinelInfo = document.getElementById("infiniteScrollStatusLabel");
          if (sentinelInfo) {
            if (state.hasMorePages && curLoadedMaxPage < totPages) {
              sentinelInfo.innerHTML = "📄 Seiten " + startP + (curLoadedMaxPage > startP ? ("–" + curLoadedMaxPage) : "") + " von " + totPages + " geladen";
            } else if (totPages > 1) {
              sentinelInfo.innerHTML = "✅ Alle " + totPages + " Seiten geladen";
            }
          }
          const manualMoreBtn = document.getElementById("manualLoadMoreBtn");
          if (manualMoreBtn) {
            if (state.hasMorePages && curLoadedMaxPage < totPages) {
              manualMoreBtn.style.display = "inline-flex";
              manualMoreBtn.innerHTML = "➕ Seite " + (curLoadedMaxPage + 1) + " laden";
            } else {
              manualMoreBtn.style.display = "none";
            }
          }
          const bottomPill = document.getElementById("bottomPageCounterPill");
          if (bottomPill) {
            bottomPill.innerHTML = "🎯 Seite wählen (" + visPage + " / " + totPages + ") ▾";
          }

          if (floatBtn) {
            if (!isCatalogVisible) {
              floatBtn.style.display = "none";
            } else {
              floatBtn.style.display = "inline-flex";
              floatBtn.innerHTML = '<span>📄 Seite ' + visPage + ' / ' + totPages + '</span><span style="font-size:10px;opacity:0.8">▾</span>';
            }
          }
        }

        if (pulseActive && floatBtn && isCatalogVisible) {
          if (!floatBtn.classList.contains("is-scrolling-active")) {
            floatBtn.classList.add("is-scrolling-active");
          }
          if (smartPageIndicatorIdleTimer) clearTimeout(smartPageIndicatorIdleTimer);
          smartPageIndicatorIdleTimer = setTimeout(() => {
            floatBtn.classList.remove("is-scrolling-active");
          }, 1400);
        }
      }

      let pendingModalJumpPage = 1;

      function updatePageJumpModalDomValueClient(nextVal) {
        const totPages = Math.max(1, Number(state.totalPages) || 1);
        pendingModalJumpPage = Math.max(1, Math.min(totPages, Math.round(Number(nextVal) || 1)));
        const titleNumEl = document.getElementById("pageJumpLiveTargetLabel");
        if (titleNumEl) titleNumEl.textContent = "Seite " + pendingModalJumpPage + " von " + totPages;
        const sliderEl = document.getElementById("pageJumpRangeSlider");
        if (sliderEl && Number(sliderEl.value) !== pendingModalJumpPage) {
          sliderEl.value = String(pendingModalJumpPage);
        }
        const numInp = document.getElementById("pageJumpNumberInput");
        if (numInp && document.activeElement !== numInp) {
          numInp.value = String(pendingModalJumpPage);
        }
        const confirmBtn = document.getElementById("pageJumpConfirmBtn");
        if (confirmBtn) {
          confirmBtn.innerHTML = "🚀 Zu Seite " + pendingModalJumpPage + " springen";
        }
      }

      function adjustPageJumpModalValueClient(deltaOrTarget, isAbsolute = false) {
        triggerTmaHapticClient("selection");
        const nextVal = isAbsolute ? Number(deltaOrTarget) : (pendingModalJumpPage + Number(deltaOrTarget));
        updatePageJumpModalDomValueClient(nextVal);
      }

      function closePageJumpModalClient() {
        const dialogRoot = document.getElementById("customDialogRoot");
        if (dialogRoot) dialogRoot.innerHTML = "";
        const returnBtn = document.getElementById("smartPageIndicatorBtn") || document.getElementById("sectionPageCounterPill");
        if (returnBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(returnBtn, false);
        }
      }

      async function confirmPageJumpModalClient(targetOverride = null) {
        const targetP = targetOverride !== null ? Number(targetOverride) : pendingModalJumpPage;
        const dialogRoot = document.getElementById("customDialogRoot");
        if (dialogRoot) dialogRoot.innerHTML = "";
        triggerTmaHapticClient("medium");
        // Falls die Seite bereits im aktuellen Endlos-Grid geladen ist, direkt weich zur ersten Karte dieser Seite scrollen!
        const firstCardOnPage = document.querySelector('#resultsGridContainer .card[data-page-num="' + targetP + '"]');
        if (firstCardOnPage) {
          if (!heroCurtainScrolledToCatalog && !state.heroHidden && !state.isSearchMode) {
            animateHeroCatalogSnapScrollClient(getHeroCatalogSnapScrollYClient());
          }
          state.visibleCatalogPage = targetP;
          syncSmartPageIndicatorDomClient(true);
          if (typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(firstCardOnPage, true);
          } else {
            firstCardOnPage.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          return;
        }
        if (typeof jumpToPage === "function") {
          await jumpToPage(targetP);
        }
      }

      function openPageJumpModalClient() {
        const totPages = Math.max(1, Number(state.totalPages) || 1);
        if (totPages <= 1) return;
        triggerTmaHapticClient("light");
        const curPage = Math.max(1, Math.min(totPages, Number(state.visibleCatalogPage || state.page) || 1));
        const curLoadedMax = Math.max(1, Number(state.page) || 1);
        const startLoaded = Math.max(1, Math.min(curLoadedMax, Number(state.startPage) || 1));
        pendingModalJumpPage = curPage;
        const dialogRoot = document.getElementById("customDialogRoot");
        if (!dialogRoot) return;

        // 1-Klick-Schnellwahl-Seiten (Anfang, Nachbarseiten, Mitte, Ende) berechnen
        const quickSet = new Set([1, totPages]);
        if (totPages >= 4) quickSet.add(Math.max(1, Math.round(totPages / 2)));
        if (totPages >= 8) {
          quickSet.add(Math.max(1, Math.round(totPages * 0.25)));
          quickSet.add(Math.max(1, Math.round(totPages * 0.75)));
        }
        for (let d = -2; d <= 2; d++) {
          const p = curPage + d;
          if (p >= 1 && p <= totPages) quickSet.add(p);
        }
        const quickPages = Array.from(quickSet).sort((a, b) => a - b);
        const quickButtonsHtml = quickPages.map(p =>
          '<button type="button" class="page-jump-btn ' + (p === curPage ? 'active' : '') + '" onclick="confirmPageJumpModalClient(' + p + ')" title="Direkt zu Seite ' + p + ' springen">' +
            (p === 1 && curPage !== 1 ? '⏮ 1' : (p === totPages && curPage !== totPages ? (totPages + ' ⏭') : p)) +
          '</button>'
        ).join("");

        const loadedRangeText = startLoaded === curLoadedMax
          ? ("Seite " + startLoaded + " im Stream geladen")
          : ("Seiten " + startLoaded + "–" + curLoadedMax + " im Stream geladen");

        dialogRoot.innerHTML =
          '<div class="page-jump-modal-backdrop" onclick="if(event.target===this)closePageJumpModalClient()">' +
            '<div class="page-jump-modal-box" role="dialog" aria-modal="true" aria-label="Seiten-Schnellwahl">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid rgba(148,163,184,0.18);padding-bottom:10px">' +
                '<div>' +
                  '<div style="font-size:14px;font-weight:900;color:#f8fafc">🎯 Seiten-Schnellwahl</div>' +
                  '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' + loadedRangeText + ' • ' + totPages + ' Seiten gesamt</div>' +
                '</div>' +
                '<button type="button" class="btn" style="padding:4px 10px" onclick="closePageJumpModalClient()" title="Schließen">✕</button>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px">' +
                '<div style="font-size:11px;color:#94a3b8;font-weight:800;letter-spacing:0.3px">⚡ DIREKT-SPRUNG (1 KLICK)</div>' +
                '<div class="page-jump-row" style="justify-content:flex-start">' + quickButtonsHtml + '</div>' +
              '</div>' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(15,23,42,0.75);padding:10px 12px;border-radius:12px;border:1px solid rgba(56,189,248,0.28)">' +
                '<div>' +
                  '<div style="font-size:11px;color:#94a3b8;font-weight:700">ZIELSEITE WÄHLEN</div>' +
                  '<div id="pageJumpLiveTargetLabel" style="font-size:17px;font-weight:900;color:#38bdf8;margin-top:2px">Seite ' + curPage + ' von ' + totPages + '</div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:6px">' +
                  '<span style="font-size:11.5px;color:#cbd5e1;font-weight:700">Nr.:</span>' +
                  '<input id="pageJumpNumberInput" type="number" min="1" max="' + totPages + '" value="' + curPage + '" class="page-jump-number-inp" oninput="updatePageJumpModalDomValueClient(this.value)" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();confirmPageJumpModalClient(this.value);}" />' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px">' +
                '<input id="pageJumpRangeSlider" type="range" min="1" max="' + totPages + '" value="' + curPage + '" class="page-jump-slider" oninput="updatePageJumpModalDomValueClient(this.value)" />' +
                '<div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;font-weight:700">' +
                  '<span>Seite 1</span>' +
                  '<span>Mitte (' + Math.max(1, Math.round(totPages / 2)) + ')</span>' +
                  '<span>Seite ' + totPages + '</span>' +
                '</div>' +
              '</div>' +
              '<div class="page-step-grid">' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(1, true)">⏮ 1</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(-10, false)">-10</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(-5, false)">-5</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(-1, false)">-1</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(1, false)">+1</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(5, false)">+5</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(10, false)">+10</button>' +
                '<button type="button" class="page-step-btn" onclick="adjustPageJumpModalValueClient(' + totPages + ', true)">' + totPages + ' ⏭</button>' +
              '</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">' +
                '<button type="button" id="pageJumpConfirmBtn" class="btn blue" style="flex:1;padding:10px 14px;font-size:13px;font-weight:900;justify-content:center" onclick="confirmPageJumpModalClient()">🚀 Zu Seite ' + curPage + ' springen</button>' +
                (curPage > 1 ? '<button type="button" class="btn" style="padding:10px 12px;font-size:12px" onclick="confirmPageJumpModalClient(1)">⬆ Seite 1</button>' : '') +
              '</div>' +
            '</div>' +
          '</div>';
        const confirmBtn = document.getElementById("pageJumpConfirmBtn");
        if (confirmBtn && typeof jumpSpatialFocus === "function") {
          setTimeout(() => jumpSpatialFocus(confirmBtn, false), 30);
        }
      }

      async function preloadHeroSlidesAndUnlockCoversClient() {
        const mySeq = ++heroWaterfallSeq;
        const gridEl = document.getElementById("resultsGridContainer");
        observeLazyCoversInContainerClient(gridEl || document);
        ensureInfiniteScrollSentinelObserverClient();
        ensureCatalogPageTrackObserverClient(gridEl);
        syncSmartPageIndicatorDomClient(false);

        const sliderIsActiveFront = Boolean(
          !state.isSearchMode &&
          !state.heroHidden &&
          (!state.currentView || state.currentView === "discover") &&
          Array.isArray(state.heroSlides) &&
          state.heroSlides.length > 0 &&
          !heroCurtainScrolledToCatalog
        );

        if (!sliderIsActiveFront) {
          unlockCatalogCoversLoadingClient(true);
          return;
        }

        // Stufe 1: Zuerst exklusiv Slide 1 laden (Katalog-Cover warten kurz, sofern der Nutzer nicht bereits runterscrollt)
        catalogCoversUnlocked = false;
        const slidesSnapshot = state.heroSlides.slice();
        await preloadHeroSlideAssetsPairClient(slidesSnapshot[0], true);
        if (mySeq !== heroWaterfallSeq) return;

        // Stufe 2: Ab Slide 2 parallel die komplette 1. Seite der Katalog-Cover vorladen + IntersectionObserver freischalten,
        // während Slide 2 -> Slide 3 -> ... nacheinander im Hintergrund geladen werden!
        unlockCatalogCoversLoadingClient(true);
        for (let i = 1; i < slidesSnapshot.length; i++) {
          if (mySeq !== heroWaterfallSeq) return;
          await preloadHeroSlideAssetsPairClient(slidesSnapshot[i], false);
        }
      }

      let catalogWindowScrollRafPending = false;
      window.addEventListener("scroll", () => {
        if (catalogWindowScrollRafPending) return;
        catalogWindowScrollRafPending = true;
        requestAnimationFrame(() => {
          catalogWindowScrollRafPending = false;
          const y = window.scrollY || window.pageYOffset || 0;
          if (y > 8 || heroCurtainScrolledToCatalog) {
            if (!catalogCoversUnlocked) {
              unlockCatalogCoversLoadingClient(true);
            }
            syncSmartPageIndicatorDomClient(true);
          }
          if (typeof syncHeroScrollFadeAndTopBarStateClient === "function") {
            syncHeroScrollFadeAndTopBarStateClient();
          }
        });
      }, { passive: true });

      function setHeroPointerHover(isHovered) {
        heroPointerHovered = Boolean(isHovered);
      }

      function formatCollapsedHeroSearchPlaceholderClient(hero, isCompactMobilePill) {
        if (!hero) return isCompactMobilePill ? "Suchen…" : "Film, Serie, Studio, Person oder (Jahr)...";
        const heroType = hero.media_type === "tv" || state.type === "s" ? "s" : "m";
        const isMovie = heroType === "m";
        const titleRaw = String(hero.title || hero.name || "").trim();
        if (!titleRaw) return isCompactMobilePill ? "Suchen…" : "Film, Serie, Studio, Person oder (Jahr)...";
        if (isCompactMobilePill) {
          return "💡 " + titleRaw;
        }
        const voteStr = hero.vote_average ? ("★ " + hero.vote_average.toFixed(1)) : "";
        const yearStr = String(hero.release_date || hero.first_air_date || "").slice(0, 4);
        const typeLabel = isMovie ? "Film" : "Serie";
        const genreItems = typeof resolveHeroGenreItemsClient === "function"
          ? resolveHeroGenreItemsClient(hero, isMovie).slice(0, 2)
          : [];
        const genreStr = genreItems.length ? genreItems.map(g => g.name).join(", ") : "";
        const metaParts = [voteStr, yearStr, typeLabel, genreStr].filter(Boolean);
        return "💡 " + titleRaw + (metaParts.length ? (" · " + metaParts.join(" · ")) : "") + " — Tippen zum Suchen…";
      }

      function isMobileCompactSearchPillActiveClient() {
        const w = window.innerWidth || document.documentElement.clientWidth || 1024;
        if (w > 760) return false;
        const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
        return !(hdr && hdr.classList.contains("mobile-search-expanded"));
      }

      function isUserInHeroSliderFront() {
        if (!document.body) return false;
        if (state.heroHidden || state.isSearchMode) return false;
        if (state.currentView && state.currentView !== "discover") return false;
        if (!Array.isArray(state.heroSlides) || state.heroSlides.length === 0) return false;
        if (heroCurtainScrolledToCatalog || document.body.classList.contains("hero-scrolled-past")) return false;
        const y = window.scrollY || window.pageYOffset || 0;
        return y <= 20;
      }

      function syncHeroSearchPlaceholderAndToggleBtnClient() {
        if (document.body) {
          document.body.classList.toggle("in-hero-slider", isUserInHeroSliderFront());
        }
        const hideBtn = document.getElementById("heroHideBtn");
        const isCollapsed = Boolean(state.heroHidden);
        const isScrolledPast = Boolean(document.body && document.body.classList.contains("hero-scrolled-past"));
        const showCompactSpotlightHint = isCollapsed || isScrolledPast;
        if (hideBtn) {
          hideBtn.classList.toggle("is-collapsed-state", showCompactSpotlightHint);
          hideBtn.setAttribute("aria-expanded", showCompactSpotlightHint ? "false" : "true");
          hideBtn.setAttribute(
            "title",
            showCompactSpotlightHint
              ? "Kino-Spotlight oben anzeigen"
              : "Kino-Spotlight sanft nach oben einklappen"
          );
          hideBtn.innerHTML = showCompactSpotlightHint
            ? '<span class="top-btn-icon">▾</span><span class="top-btn-label"> Spotlight</span>'
            : '<span class="top-btn-icon">▴</span><span class="top-btn-label"> Einklappen</span>';
        }
        const inp = document.getElementById("searchInput");
        if (!inp) return;
        const compactPill = isMobileCompactSearchPillActiveClient();
        const onCatalogDiscover = (!state.currentView || state.currentView === "discover") && !state.isSearchMode;
        if (showCompactSpotlightHint && onCatalogDiscover && Array.isArray(state.heroSlides) && state.heroSlides.length > 0) {
          const hero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
          inp.placeholder = formatCollapsedHeroSearchPlaceholderClient(hero, compactPill);
          inp.classList.add("hero-placeholder-active");
          const bpUrl = resolveHeroSlideBackdropUrlClient(hero);
          if (bpUrl) applyDynamicHeroAmbilightClient(bpUrl);
        } else {
          inp.placeholder = compactPill ? "Suchen…" : "Film, Serie, Studio, Person oder (Jahr)...";
          inp.classList.remove("hero-placeholder-active");
        }
      }

      let windowResizeDebounceTimer = null;
      window.addEventListener("resize", () => {
        if ((window.innerWidth || 1024) > 760) {
          const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
          if (hdr) hdr.classList.remove("mobile-search-expanded");
        }
        if (windowResizeDebounceTimer) clearTimeout(windowResizeDebounceTimer);
        windowResizeDebounceTimer = setTimeout(() => {
          windowResizeDebounceTimer = null;
          syncHeroSearchPlaceholderAndToggleBtnClient();
          syncExpandableDescriptionsOverflowClient();
        }, 90);
      }, { passive: true });

      let heroWheelDownAccum = 0;
      let heroWheelUpAccum = 0;
      let heroWheelDecayTimer = null;
      let heroSnapAnimatingUntil = 0;
      let heroTouchSettleTimer = null;
      let heroSpringRafId = 0;
      let heroMomentumDrainActive = false;
      let heroMomentumDrainDir = 0;
      let heroLastWheelEventAt = 0;
      let heroPageTouchActive = false;
      let heroTouchStartTime = 0;
      let heroTouchStartScrollY = 0;
      let heroLastCatalogScrollY = 0;
      let heroCurrentZone = 0; // 0 = Vollbild-Slider (Vorhang offen), 1 = Katalog-Cover (Vorhang weggeglitten, Cover starten bei scrollY=0)
      let heroCurtainScrolledToCatalog = false;

      function getHeroCatalogSnapScrollYClient() {
        const stageWrap = document.getElementById("heroStageWrapEl");
        const topBarH = (document.getElementById("topUnifiedBar")?.offsetHeight) || 54;
        const heroH = (stageWrap && stageWrap.offsetHeight > 120) ? stageWrap.offsetHeight : (window.innerHeight || 640);
        return Math.max(200, heroH - topBarH);
      }

      function isAnySideMenuOpenClient() {
        if (state.sidebarOpen) return true;
        if (document.getElementById("filterSidebarDrawer")?.classList.contains("open")) return true;
        const elev = document.getElementById("tvQuickJumpElevator");
        if (elev && (
          elev.classList.contains("has-subpanel") ||
          elev.classList.contains("is-visible") ||
          elev.classList.contains("is-hover-expanded") ||
          (typeof elev.matches === "function" && elev.matches(":hover"))
        )) {
          return true;
        }
        return false;
      }

      window.addEventListener("wheel", (ev) => {
        if (!isAnySideMenuOpenClient()) return;
        const scrollHost = ev.target && typeof ev.target.closest === "function"
          ? ev.target.closest(".sidebar-body, .sidebar-right-subpanel, .rm-entries-scroll")
          : null;
        if (!scrollHost) {
          ev.preventDefault();
          return;
        }
        const dy = Number(ev.deltaY) || 0;
        const atTop = scrollHost.scrollTop <= 0 && dy < 0;
        const atBottom = (scrollHost.scrollTop + scrollHost.clientHeight >= scrollHost.scrollHeight - 1) && dy > 0;
        if (atTop || atBottom) {
          ev.preventDefault();
        }
      }, { passive: false });

      window.addEventListener("touchmove", (ev) => {
        if (!isAnySideMenuOpenClient()) return;
        const scrollHost = ev.target && typeof ev.target.closest === "function"
          ? ev.target.closest(".sidebar-body, .sidebar-right-subpanel, .rm-entries-scroll")
          : null;
        if (!scrollHost) {
          ev.preventDefault();
        }
      }, { passive: false });

      function isHeroScrollCouplingActiveClient() {
        if (!document.body || state.heroHidden || state.isSearchMode) return false;
        if (state.currentView && state.currentView !== "discover") return false;
        if (!Array.isArray(state.heroSlides) || state.heroSlides.length === 0) return false;
        if (isAnySideMenuOpenClient()) return false;
        if (document.getElementById("modalRoot")?.innerHTML.trim()) return false;
        if (document.getElementById("lightboxRoot")?.innerHTML.trim()) return false;
        if (document.getElementById("customDialogRoot")?.innerHTML.trim()) return false;
        if (document.getElementById("searchGenreDropdownOverlay")?.classList.contains("open")) return false;
        if (document.getElementById("searchAutocompleteBox")?.classList.contains("open")) return false;
        return true;
      }

      // Echte DOM-Überlaufmessung für 3-Zeilen-Clamp: "▾ Mehr lesen" erscheint NUR, wenn Text wirklich abgeschnitten ist
      function syncExpandableDescriptionsOverflowClient(rootEl) {
        const scope = rootEl || document;
        if (!scope) return;
        const boxes = (scope.classList && scope.classList.contains("expandable-desc-box"))
          ? [scope]
          : Array.from(scope.querySelectorAll ? scope.querySelectorAll(".expandable-desc-box") : []);
        for (const box of boxes) {
          const scrollEl = box.querySelector(".expandable-desc-scroll");
          if (!scrollEl) continue;
          if (box.classList.contains("is-expanded")) {
            box.classList.add("is-long-desc");
            continue;
          }
          const isTruncated = (scrollEl.scrollHeight - scrollEl.clientHeight) > 2;
          box.classList.toggle("is-long-desc", isTruncated);
          if (isTruncated) {
            box.setAttribute("title", "Klicken oder Enter für vollständige Beschreibung");
          } else {
            box.removeAttribute("title");
          }
        }
      }

      function toggleExpandableDescriptionClient(ev, boxId) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const box = document.getElementById(boxId);
        if (!box) return;
        const scrollEl = box.querySelector(".expandable-desc-scroll");
        if (!box.classList.contains("is-expanded")) {
          const isTruncated = scrollEl ? ((scrollEl.scrollHeight - scrollEl.clientHeight) > 2) : box.classList.contains("is-long-desc");
          if (!isTruncated) {
            box.classList.remove("is-long-desc");
            return;
          }
          box.classList.add("is-long-desc");
        }
        triggerTmaHapticClient("light");
        const willExpand = !box.classList.contains("is-expanded");
        box.classList.toggle("is-expanded", willExpand);
        box.setAttribute("aria-expanded", willExpand ? "true" : "false");
        const hintEl = box.querySelector(".desc-expand-hint");
        if (hintEl) {
          hintEl.textContent = willExpand ? "▴ Einklappen" : "▾ Mehr lesen";
        }
        if (scrollEl && !willExpand) {
          scrollEl.scrollTop = 0;
          requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(box));
        }
      }

      function clearHeroDescTransientFocusClient() {
        const descEl = document.getElementById("heroDescEl");
        if (!descEl) return;
        descEl.classList.remove("spatial-focus");
        if (document.activeElement === descEl && typeof descEl.blur === "function") {
          try { descEl.blur(); } catch (_e) {}
        }
        if (typeof currentSpatialEl !== "undefined" && currentSpatialEl === descEl) {
          currentSpatialEl = null;
        }
      }

      function setHeroRubberBandOffsetClient(px) {
        const stageWrap = document.getElementById("heroStageWrapEl");
        if (stageWrap) {
          stageWrap.style.setProperty("--hero-rubber-y", Math.round(px) + "px");
        }
      }

      function setCatalogRubberBandOffsetClient(px, isDragging) {
        const catSec = document.querySelector("#heroBannerSlot + .section");
        if (catSec) {
          catSec.classList.toggle("is-rubber-dragging", Boolean(isDragging && px !== 0));
          catSec.style.setProperty("--catalog-rubber-y", Math.round(px) + "px");
        }
      }

      function resetHeroResistancePreviewClient() {
        heroWheelDownAccum = 0;
        heroWheelUpAccum = 0;
        setHeroRubberBandOffsetClient(0);
        setCatalogRubberBandOffsetClient(0, false);
        const hintBtn = document.getElementById("heroScrollDownHintBtn");
        if (hintBtn) {
          hintBtn.style.transform = "";
        }
        syncHeroScrollFadeAndTopBarStateClient();
      }

      function cancelHeroSpringScrollClient() {
        if (heroSpringRafId) {
          cancelAnimationFrame(heroSpringRafId);
          heroSpringRafId = 0;
        }
      }

      let heroBounceLockUntil = 0;
      let heroBounceLockTimer = null;
      const HERO_BOUNCE_LOCK_VELOCITY = 1.15; // px/ms
      const HERO_BOUNCE_LOCK_MIN_DIST = 34; // px
      const HERO_BOUNCE_LOCK_COOLDOWN_MS = 400; // ms

      // Vorhang-Bühnen-Übergang: Slider gleitet als Vorhang weg, Filmcover starten physisch bei scrollY = 0 (kein Nachruckeln!)
      // Unterstützt zusätzlich Bounce-Lock ({ bounceLock: true }): bricht bei zu schnellem Wischen die Animation sofort ab und fixiert den Endzustand für 400ms.
      function animateHeroCatalogSnapScrollClient(targetY, opts) {
        const isBounceLock = Boolean(opts && opts.bounceLock);
        cancelHeroSpringScrollClient();
        heroWheelDownAccum = 0;
        heroWheelUpAccum = 0;
        if (heroWheelDecayTimer) {
          clearTimeout(heroWheelDecayTimer);
          heroWheelDecayTimer = null;
        }
        if (heroTouchSettleTimer) {
          clearTimeout(heroTouchSettleTimer);
          heroTouchSettleTimer = null;
        }
        setHeroRubberBandOffsetClient(0);
        setCatalogRubberBandOffsetClient(0, false);
        clearHeroDescTransientFocusClient();
        const stageWrap = document.getElementById("heroStageWrapEl");
        if (stageWrap) {
          stageWrap.style.setProperty("--hero-scroll-fade", "0");
          stageWrap.style.setProperty("--hero-rubber-y", "0px");
        }
        const hintBtn = document.getElementById("heroScrollDownHintBtn");
        if (hintBtn) hintBtn.style.transform = "";

        const goingToCatalog = Number(targetY) > 10;
        const zoneChanged = heroCurtainScrolledToCatalog !== goingToCatalog;
        heroCurtainScrolledToCatalog = goingToCatalog;
        heroCurrentZone = goingToCatalog ? 1 : 0;
        heroLastCatalogScrollY = 0;

        if (zoneChanged) {
          triggerTmaHapticClient(isBounceLock ? "heavy" : "medium");
        }

        const nowMs = Date.now();
        heroMomentumDrainActive = true;
        heroMomentumDrainDir = goingToCatalog ? 1 : -1;
        heroLastWheelEventAt = nowMs;
        heroSnapAnimatingUntil = nowMs + (isBounceLock ? HERO_BOUNCE_LOCK_COOLDOWN_MS : 420);

        const curtainEl = document.getElementById("heroCurtainShell");
        const catSecEl = document.querySelector("#heroBannerSlot + .section");
        if (isBounceLock) {
          heroBounceLockUntil = performance.now() + HERO_BOUNCE_LOCK_COOLDOWN_MS;
          if (heroBounceLockTimer) {
            clearTimeout(heroBounceLockTimer);
            heroBounceLockTimer = null;
          }
          if (curtainEl) curtainEl.classList.add("is-bounce-locked");
          if (catSecEl) catSecEl.classList.add("is-bounce-locked");
          heroBounceLockTimer = setTimeout(() => {
            if (curtainEl) curtainEl.classList.remove("is-bounce-locked");
            if (catSecEl) catSecEl.classList.remove("is-bounce-locked");
            heroBounceLockTimer = null;
          }, HERO_BOUNCE_LOCK_COOLDOWN_MS);
        }

        if (goingToCatalog) {
          if (typeof stopHeroBackgroundVideoTeaserClient === "function") {
            stopHeroBackgroundVideoTeaserClient();
          }
          if (document.body) {
            document.body.classList.add("hero-scrolled-past", "page-scrolled");
          }
          if (curtainEl) {
            curtainEl.classList.add("is-collapsed");
          }
          if ((window.scrollY || window.pageYOffset || 0) !== 0) {
            window.scrollTo(0, 0);
          }
          unlockCatalogCoversLoadingClient(true);
          syncSmartPageIndicatorDomClient(true);
          if (typeof focusFirstResultCard === "function") {
            const curEl = typeof currentSpatialEl !== "undefined" ? currentSpatialEl : null;
            if (!curEl || (curEl.closest && (curEl.closest(".hero") || curEl.closest("#heroBannerSlot")))) {
              focusFirstResultCard(false);
            }
          }
          // Sobald der Nutzer vom Slider nach unten zu den Covern scrollt, direkt die nächste Seite im Hintergrund vorladen!
          if (state.hasMorePages && !state.loadingMore && Number(state.page || 1) === Number(state.startPage || 1) && typeof loadMoreResults === "function") {
            setTimeout(() => {
              if (heroCurtainScrolledToCatalog && state.hasMorePages && !state.loadingMore) {
                loadMoreResults(true);
              }
            }, 120);
          }
        } else {
          if (document.body) {
            document.body.classList.remove("hero-scrolled-past", "page-scrolled");
          }
          if (curtainEl && !state.heroHidden) {
            curtainEl.classList.remove("is-collapsed");
          }
          if ((window.scrollY || window.pageYOffset || 0) !== 0) {
            window.scrollTo(0, 0);
          }
          syncSmartPageIndicatorDomClient(false);
          requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient());
          if (typeof scheduleHeroBackgroundVideoTeaserClient === "function") {
            scheduleHeroBackgroundVideoTeaserClient(false);
          }
        }
        syncHeroScrollFadeAndTopBarStateClient();
        syncHeroSearchPlaceholderAndToggleBtnClient();
      }

      let heroLastHorizWheelAt = 0;

      function onHeroCatalogWheelClient(ev) {
        if (!isHeroScrollCouplingActiveClient()) return;
        const targetEl = ev.target;
        if (targetEl && typeof targetEl.closest === "function") {
          const expDesc = targetEl.closest(".expandable-desc-box.is-expanded");
          if (expDesc) {
            const sc = expDesc.querySelector(".expandable-desc-scroll");
            if (sc && sc.scrollHeight > sc.clientHeight + 2) {
              return;
            }
          }
        }
        const now = Date.now();
        // Linux Firefox sendet bei Mausrädern/Trackpads häufig deltaMode === 1 (DOM_DELTA_LINE statt Pixel) -> auf Pixel-Skala normieren!
        const deltaMult = ev.deltaMode === 1 ? 24 : (ev.deltaMode === 2 ? 360 : 1);
        const rawDx = (Number(ev.deltaX) || 0) * deltaMult;
        const rawDy = (Number(ev.deltaY) || 0) * deltaMult;
        const dx = Math.abs(rawDx) > 0.5 ? rawDx : (ev.shiftKey ? rawDy : 0);
        const dy = ev.shiftKey && Math.abs(rawDx) <= 0.5 ? 0 : rawDy;

        // Horizontal Wheel / Trackpad Scroll Left & Right im geöffneten Slider: Blättert direkt durch die Slides!
        if (!heroCurtainScrolledToCatalog && !state.heroHidden && Array.isArray(state.heroSlides) && state.heroSlides.length > 1) {
          if (Math.abs(dx) >= 14 && Math.abs(dx) > Math.abs(dy) * 1.15) {
            ev.preventDefault();
            if (now - heroLastHorizWheelAt >= 260) {
              heroLastHorizWheelAt = now;
              triggerTmaHapticClient("selection");
              setHeroSlideIndex(state.heroIndex + (dx > 0 ? 1 : -1));
            }
            return;
          }
        }

        const gapMs = now - heroLastWheelEventAt;
        heroLastWheelEventAt = now;

        if (now < heroSnapAnimatingUntil) {
          ev.preventDefault();
          return;
        }
        if (heroMomentumDrainActive) {
          const sameDirection = (heroMomentumDrainDir > 0 && dy > 0) || (heroMomentumDrainDir < 0 && dy < 0);
          if (sameDirection && gapMs < 130) {
            ev.preventDefault();
            return;
          }
          heroMomentumDrainActive = false;
          heroMomentumDrainDir = 0;
        }

        if (Math.abs(dy) < 1) return;

        const y = window.scrollY || window.pageYOffset || 0;
        const DOWN_THRESHOLD = 105;
        const UP_THRESHOLD = 105;

        // 1. Zone 0 (Vollbild-Slider offen): Sanfter, angenehm erreichbarer Übergang zum Katalog (DOWN_THRESHOLD = 105)
        if (!heroCurtainScrolledToCatalog) {
          if (dy > 0) {
            ev.preventDefault();
            heroWheelUpAccum = 0;
            const velocityBoost = Math.abs(dy) > 55 ? 1.12 : 0.85;
            const step = Math.min(78, Math.max(12, Math.abs(dy) * velocityBoost));
            heroWheelDownAccum += step;

            if (heroWheelDecayTimer) clearTimeout(heroWheelDecayTimer);
            if (heroWheelDownAccum >= DOWN_THRESHOLD) {
              animateHeroCatalogSnapScrollClient(getHeroCatalogSnapScrollYClient());
              return;
            }

            const ratio = Math.min(1, heroWheelDownAccum / DOWN_THRESHOLD);
            const rubberOffset = -Math.round(Math.pow(ratio, 0.85) * 34);
            setHeroRubberBandOffsetClient(rubberOffset);
            const stageWrap = document.getElementById("heroStageWrapEl");
            if (stageWrap) {
              stageWrap.style.setProperty("--hero-scroll-fade", (ratio * 0.32).toFixed(3));
            }
            const hintBtn = document.getElementById("heroScrollDownHintBtn");
            if (hintBtn) {
              hintBtn.style.transform = "translate3d(0, " + Math.round(ratio * 10) + "px, 0) scale(" + (1 + ratio * 0.14).toFixed(2) + ")";
            }
            heroWheelDecayTimer = setTimeout(resetHeroResistancePreviewClient, 240);
          }
          return;
        }

        // 2. Zone 1 (Katalog-Cover bei scrollY = 0): Am oberen Rand erfordert Weiter-Hochscrollen ebenfalls spürbaren Gummiband-Widerstand (UP_THRESHOLD = 210)
        if (heroCurtainScrolledToCatalog && y <= 6 && dy < 0) {
          ev.preventDefault();
          heroWheelDownAccum = 0;
          const velocityBoost = Math.abs(dy) > 55 ? 1.12 : 0.85;
          const step = Math.min(78, Math.max(12, Math.abs(dy) * velocityBoost));
          heroWheelUpAccum += step;

          if (heroWheelDecayTimer) clearTimeout(heroWheelDecayTimer);
          if (heroWheelUpAccum >= UP_THRESHOLD) {
            animateHeroCatalogSnapScrollClient(0);
            return;
          }

          const ratio = Math.min(1, heroWheelUpAccum / UP_THRESHOLD);
          const catalogRubber = Math.round(Math.pow(ratio, 0.85) * 32);
          setCatalogRubberBandOffsetClient(catalogRubber, true);
          heroWheelDecayTimer = setTimeout(resetHeroResistancePreviewClient, 240);
          return;
        }
      }

      let heroCatalogDraggingDown = false;
      let heroTouchLastY = 0;
      let heroTouchLastTime = 0;
      let heroTouchInstantVy = 0;

      window.addEventListener("wheel", onHeroCatalogWheelClient, { passive: false });
      window.addEventListener("touchstart", (ev) => {
        if (performance.now() < heroBounceLockUntil) {
          heroPageTouchActive = false;
          heroCatalogDraggingDown = false;
          return;
        }
        if (ev.target && typeof ev.target.closest === "function" && ev.target.closest(".expandable-desc-box.is-expanded")) {
          heroPageTouchActive = false;
          heroCatalogDraggingDown = false;
          return;
        }
        heroPageTouchActive = true;
        heroCatalogDraggingDown = false;
        heroTouchStartScrollY = window.scrollY || window.pageYOffset || 0;
        if (ev.touches && ev.touches[0]) {
          heroTouchStartX = ev.touches[0].clientX;
          heroTouchStartY = ev.touches[0].clientY;
          heroTouchLastY = ev.touches[0].clientY;
          heroTouchStartTime = performance.now();
          heroTouchLastTime = heroTouchStartTime;
          heroTouchInstantVy = 0;
        }
      }, { passive: true });

      // Aktiver TouchMove-Wächter am oberen Katalogrand (scrollY <= 6):
      // Blockiert Browser-Pull-to-Refresh ("Seite aktualisieren") sofort, baut Gummiband-Widerstand auf und löst bei zu schnellem Wischen direkt den Bounce-Lock aus!
      window.addEventListener("touchmove", (ev) => {
        if (!heroPageTouchActive || !ev.touches || !ev.touches[0]) return;
        const nowPerf = performance.now();
        if (nowPerf < heroBounceLockUntil) {
          heroPageTouchActive = false;
          heroCatalogDraggingDown = false;
          setCatalogRubberBandOffsetClient(0, false);
          return;
        }
        if (ev.target && typeof ev.target.closest === "function" && ev.target.closest(".expandable-desc-box.is-expanded")) {
          return;
        }
        if (!heroCurtainScrolledToCatalog || !isHeroScrollCouplingActiveClient() || Date.now() < heroSnapAnimatingUntil) return;
        const curY = window.scrollY || window.pageYOffset || 0;
        const curTouchY = ev.touches[0].clientY;
        const dx = ev.touches[0].clientX - (heroTouchStartX || ev.touches[0].clientX);
        const dy = curTouchY - (heroTouchStartY || curTouchY);
        const stepDt = Math.max(8, nowPerf - (heroTouchLastTime || nowPerf));
        const totalDt = Math.max(12, nowPerf - (heroTouchStartTime || nowPerf));
        const instVy = (curTouchY - (heroTouchLastY || curTouchY)) / stepDt;
        const avgVy = dy / totalDt;
        heroTouchInstantVy = Math.abs(instVy) > Math.abs(avgVy) ? instVy : avgVy;
        heroTouchLastY = curTouchY;
        heroTouchLastTime = nowPerf;

        if ((curY <= 6 || heroCatalogDraggingDown) && dy > 4 && dy > Math.abs(dx) * 1.05) {
          if (ev.cancelable) {
            ev.preventDefault();
          }
          // Mid-Gesture Bounce-Lock (Vollständig geöffnet): Bei zu schnellem Wischen nach unten sofort Animation abbrechen & Slider fixieren!
          if (dy >= HERO_BOUNCE_LOCK_MIN_DIST && heroTouchInstantVy >= HERO_BOUNCE_LOCK_VELOCITY && dy > Math.abs(dx) * 1.15) {
            heroPageTouchActive = false;
            heroCatalogDraggingDown = false;
            setCatalogRubberBandOffsetClient(0, false);
            animateHeroCatalogSnapScrollClient(0, { bounceLock: true });
            return;
          }
          heroCatalogDraggingDown = true;
          // Logarithmische Gummiband-Kurve: spürbarer Widerstand beim Ziehen nach unten an der Katalog-Oberkante
          const rubberPx = Math.round(Math.min(38, Math.pow(Math.max(0, dy - 4), 0.76) * 1.28));
          setCatalogRubberBandOffsetClient(rubberPx, true);
        } else if (heroCatalogDraggingDown && dy <= 0) {
          heroCatalogDraggingDown = false;
          setCatalogRubberBandOffsetClient(0, false);
        }
      }, { passive: false });

      window.addEventListener("touchend", (ev) => {
        const wasDraggingCatalogDown = heroCatalogDraggingDown;
        heroPageTouchActive = false;
        heroCatalogDraggingDown = false;
        setCatalogRubberBandOffsetClient(0, false);

        if (performance.now() < heroBounceLockUntil) return;
        if (!isHeroScrollCouplingActiveClient() || Date.now() < heroSnapAnimatingUntil) return;
        const curY = window.scrollY || window.pageYOffset || 0;

        // Katalog -> Vollbild-Slider: Erst wenn der Gummiband-Widerstand überwunden wurde (dy >= 88px ODER kräftiger Flick dy >= 48px mit vy >= 0.55)
        if (heroCurtainScrolledToCatalog && (curY <= 8 || wasDraggingCatalogDown)) {
          const dyTouch = (ev.changedTouches && ev.changedTouches[0] && heroTouchStartY)
            ? (ev.changedTouches[0].clientY - heroTouchStartY)
            : 0;
          const dxTouch = (ev.changedTouches && ev.changedTouches[0] && heroTouchStartX)
            ? (ev.changedTouches[0].clientX - heroTouchStartX)
            : 0;
          const dtTouch = Math.max(16, performance.now() - (heroTouchStartTime || performance.now()));
          const avgVyTouch = dyTouch / dtTouch;
          const vyTouch = Math.abs(heroTouchInstantVy) > Math.abs(avgVyTouch) ? heroTouchInstantVy : avgVyTouch;
          if (dyTouch >= HERO_BOUNCE_LOCK_MIN_DIST && vyTouch >= HERO_BOUNCE_LOCK_VELOCITY && dyTouch > Math.abs(dxTouch) * 1.15) {
            animateHeroCatalogSnapScrollClient(0, { bounceLock: true });
            return;
          }
          if ((dyTouch >= 56 || (dyTouch >= 36 && vyTouch >= 0.45)) && dyTouch > Math.abs(dxTouch) * 1.12) {
            animateHeroCatalogSnapScrollClient(0);
          }
        }
      }, { passive: true });

      window.addEventListener("touchcancel", () => {
        heroPageTouchActive = false;
        heroCatalogDraggingDown = false;
        setCatalogRubberBandOffsetClient(0, false);
      }, { passive: true });

      function syncHeroScrollFadeAndTopBarStateClient() {
        if (!document.body) return;
        const inFrontHero = typeof isUserInHeroSliderFront === "function" ? isUserInHeroSliderFront() : false;
        document.body.classList.toggle("in-hero-slider", inFrontHero);
        if (!inFrontHero && typeof stopHeroBackgroundVideoTeaserClient === "function") {
          const bgLayer = document.getElementById("heroBgVideoLayer");
          if (heroBgTeaserActiveKey || (bgLayer && bgLayer.innerHTML)) {
            stopHeroBackgroundVideoTeaserClient();
          }
        }
        const y = window.scrollY || window.pageYOffset || 0;
        document.body.classList.toggle("catalog-deep-scrolled", y > 420);
        const stageWrap = document.getElementById("heroStageWrapEl");
        if (!stageWrap || state.heroHidden || state.isSearchMode) {
          document.body.classList.toggle("page-scrolled", y > 10);
          if (stageWrap) {
            stageWrap.style.setProperty("--hero-scroll-fade", "0");
            stageWrap.style.setProperty("--hero-rubber-y", "0px");
          }
          if (document.body.classList.contains("hero-scrolled-past")) {
            document.body.classList.remove("hero-scrolled-past");
            syncHeroSearchPlaceholderAndToggleBtnClient();
          }
          return;
        }

        if (heroCurtainScrolledToCatalog) {
          heroLastCatalogScrollY = y;
          heroCurrentZone = 1;
          document.body.classList.add("page-scrolled");
          if (!document.body.classList.contains("hero-scrolled-past")) {
            document.body.classList.add("hero-scrolled-past");
            syncHeroSearchPlaceholderAndToggleBtnClient();
          }
          stageWrap.style.setProperty("--hero-scroll-fade", "0");
          return;
        }

        heroLastCatalogScrollY = 0;
        heroCurrentZone = 0;
        document.body.classList.toggle("page-scrolled", y > 10);
        if (document.body.classList.contains("hero-scrolled-past")) {
          document.body.classList.remove("hero-scrolled-past");
          syncHeroSearchPlaceholderAndToggleBtnClient();
        }
        stageWrap.style.setProperty("--hero-scroll-fade", "0");
      }

      function returnToHeroSpotlightFromCatalogClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        triggerTmaHapticClient("selection");
        if (state.heroHidden) {
          toggleHeroSliderHidden(false);
        } else {
          animateHeroCatalogSnapScrollClient(0);
        }
      }

      function scrollCatalogBackToTopOrSpotlightClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        triggerTmaHapticClient("light");
        const y = window.scrollY || window.pageYOffset || 0;
        if (y > 60) {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          returnToHeroSpotlightFromCatalogClient(ev);
        }
      }

      // =========================================================================
      // HAUPTSLIDER INLINE-KINO-TRAILER ENGINE (1:1 wie Detailansicht: Im Hintergrund vorladen, erst beim Tippen einblenden)
      // =========================================================================
      let heroBgTeaserTimer = null;
      let heroBgTeaserRevealTimer = null;
      let heroBgTeaserRevealTargetAt = 0;
      let heroBgTeaserDelayedPauseTimer = null;
      let heroBgTeaserWatchdogTimer = null;
      let heroBgTeaserHandshakeTimer = null;
      let heroBgTeaserStageOpenedAt = 0;
      let heroBgTeaserPlayingStartedAt = 0;
      let heroBgTeaserChromeShieldRequired = true;
      let heroBgTeaserPreloadedParked = false;
      let heroBgTeaserMuted = true;
      let heroBgTeaserPendingUnmute = false;
      let heroBgTeaserPaused = false;
      let heroBgTeaserEnded = false;
      let heroBgTeaserStoppedByUser = false;
      let heroBgTeaserIsPlayingConfirmed = false;
      let heroBgTeaserActiveKey = "";
      let heroBgTeaserActiveSlideKey = "";
      let heroBgTeaserCandidates = [];
      let heroBgTeaserCandidateIdx = 0;
      let heroBgTeaserCurTime = 0;
      let heroBgTeaserDuration = 0;
      let heroBgTeaserScrubbing = false;
      let heroCinemaZoomMode = "fill";
      let heroFgTapTimer = null;
      let heroFgLastTapAt = 0;
      let heroSeekRippleTimer = null;
      let lastHeroStageTapHandledAt = 0;

      function formatHeroTrailerDockTimeClient(secInput) {
        const s = Math.max(0, Math.floor(Number(secInput) || 0));
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return mins + ":" + (secs < 10 ? "0" + secs : secs);
      }

      function setHeroTrailerLoadingBadgeClient(visible, text = "🎬 Trailer startet…") {
        const badge = document.getElementById("heroSeekRippleBadge");
        if (!badge) return;
        if (visible) {
          if (heroSeekRippleTimer) {
            clearTimeout(heroSeekRippleTimer);
            heroSeekRippleTimer = null;
          }
          badge.className = "detail-seek-ripple-badge is-center is-loading-pulse";
          badge.textContent = text;
        } else if (badge.classList.contains("is-loading-pulse")) {
          badge.classList.remove("is-loading-pulse", "is-visible");
        }
      }

      function showHeroSeekRippleBadgeClient(text, zone = "center") {
        const badge = document.getElementById("heroSeekRippleBadge");
        if (!badge) return;
        if (heroSeekRippleTimer) {
          clearTimeout(heroSeekRippleTimer);
          heroSeekRippleTimer = null;
        }
        badge.className = "detail-seek-ripple-badge is-" + (zone === "left" || zone === "right" ? zone : "center");
        badge.textContent = text;
        requestAnimationFrame(() => {
          badge.classList.add("is-visible");
        });
        heroSeekRippleTimer = setTimeout(() => {
          badge.classList.remove("is-visible");
          heroSeekRippleTimer = null;
        }, 680);
      }

      function clearHeroBgTeaserTimersClient() {
        if (heroBgTeaserTimer) {
          clearTimeout(heroBgTeaserTimer);
          heroBgTeaserTimer = null;
        }
        if (heroBgTeaserRevealTimer) {
          clearTimeout(heroBgTeaserRevealTimer);
          heroBgTeaserRevealTimer = null;
        }
        heroBgTeaserRevealTargetAt = 0;
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        if (heroBgTeaserWatchdogTimer) {
          clearTimeout(heroBgTeaserWatchdogTimer);
          heroBgTeaserWatchdogTimer = null;
        }
        if (heroBgTeaserHandshakeTimer) {
          clearInterval(heroBgTeaserHandshakeTimer);
          heroBgTeaserHandshakeTimer = null;
        }
      }

      function sendYoutubeHeroTeaserCommandClient(funcName, args = []) {
        const frame = document.getElementById("heroBgVideoIframe");
        if (!frame || !frame.contentWindow) return;
        try {
          frame.contentWindow.postMessage(JSON.stringify({
            event: "command",
            func: funcName,
            args: args
          }), "*");
        } catch (_e) {}
      }

      function syncHeroCinemaDockUiClient() {
        const dock = document.getElementById("heroCinemaPlayerDock");
        if (!dock) return;
        const stageEl = document.getElementById("heroStageEl");
        const isForeground = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));
        const hasVideoControls = Boolean(heroBgTeaserActiveKey || heroBgTeaserIsPlayingConfirmed);
        dock.classList.toggle("is-ready", Boolean(isForeground));

        const playBtn = document.getElementById("heroCinemaPlayBtn");
        if (playBtn) {
          playBtn.style.display = hasVideoControls ? "inline-flex" : "none";
          if (heroBgTeaserEnded) {
            playBtn.textContent = "↺";
            playBtn.title = "Trailer erneut abspielen";
          } else {
            playBtn.textContent = heroBgTeaserPaused ? "▶" : "⏸";
            playBtn.title = heroBgTeaserPaused ? "Trailer fortsetzen" : "Trailer pausieren";
          }
        }
        const muteBtn = document.getElementById("heroCinemaMuteBtn");
        if (muteBtn) {
          muteBtn.style.display = hasVideoControls ? "inline-flex" : "none";
          muteBtn.textContent = heroBgTeaserMuted ? "🔇" : "🔊";
          muteBtn.title = heroBgTeaserMuted ? "Ton einschalten" : "Ton stummschalten";
        }
        const timelineWrap = document.getElementById("heroCinemaTimelineWrap");
        if (timelineWrap) {
          timelineWrap.style.display = hasVideoControls ? "inline-flex" : "none";
        }
        const nextClipBtn = document.getElementById("heroCinemaNextClipBtn");
        if (nextClipBtn) {
          const totalClips = Array.isArray(heroBgTeaserCandidates) ? heroBgTeaserCandidates.length : 0;
          if (totalClips > 1 && hasVideoControls) {
            nextClipBtn.style.display = "inline-flex";
            nextClipBtn.textContent = "⏭ " + ((heroBgTeaserCandidateIdx % totalClips) + 1) + "/" + totalClips;
            nextClipBtn.title = "Nächsten verfügbaren Trailer / Clip abspielen";
          } else {
            nextClipBtn.style.display = "none";
          }
        }
        const zoomBtn = document.getElementById("heroCinemaZoomBtn");
        if (zoomBtn) {
          zoomBtn.classList.toggle("is-active-mode", heroCinemaZoomMode === "fit");
          zoomBtn.textContent = heroCinemaZoomMode === "fit" ? "▭ Fit" : "⤢ Fill";
          zoomBtn.title = heroCinemaZoomMode === "fit" ? "Zu Randlos-Vollbild wechseln" : "Zu Original-Kinoformat ohne Beschnitt wechseln";
        }
        const modeBtn = document.getElementById("heroCinemaModeBtn");
        if (modeBtn) {
          modeBtn.classList.toggle("is-active-mode", isForeground);
          modeBtn.innerHTML = isForeground ? "✕ Infos" : "⛶ Kino";
          modeBtn.title = isForeground ? "Slider-Infos wieder einblenden (Esc)" : "Alle Elemente ausblenden & Trailer in den Vordergrund holen";
        }
        const timeLbl = document.getElementById("heroCinemaTimeLbl");
        if (timeLbl) {
          if (heroBgTeaserDuration > 0) {
            timeLbl.textContent = formatHeroTrailerDockTimeClient(heroBgTeaserCurTime) + " / " + formatHeroTrailerDockTimeClient(heroBgTeaserDuration);
          } else {
            timeLbl.textContent = formatHeroTrailerDockTimeClient(heroBgTeaserCurTime);
          }
        }
        const scrubber = document.getElementById("heroCinemaScrubber");
        if (scrubber && !heroBgTeaserScrubbing) {
          const maxDur = heroBgTeaserDuration > 0 ? Math.floor(heroBgTeaserDuration) : 120;
          scrubber.max = String(maxDur);
          scrubber.value = String(Math.min(maxDur, Math.floor(heroBgTeaserCurTime || 0)));
        }
      }

      function scheduleHeroRevealAfterYoutubeChromeHidesClient(holdMs = 1750, forceReset = false) {
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        const safeHoldMs = Math.max(250, Number(holdMs) || 1750);
        const now = Date.now();
        const proposedTargetAt = now + safeHoldMs;

        if (heroBgTeaserRevealTimer && !forceReset && heroBgTeaserRevealTargetAt > now) {
          if (proposedTargetAt >= heroBgTeaserRevealTargetAt - 80) {
            const stageEl = document.getElementById("heroStageEl");
            if (stageEl && stageEl.classList.contains("is-trailer-foreground-mode")) {
              setHeroTrailerLoadingBadgeClient(true, "🎬 Trailer startet…");
            }
            return;
          }
          clearTimeout(heroBgTeaserRevealTimer);
          heroBgTeaserRevealTimer = null;
        } else if (heroBgTeaserRevealTimer) {
          clearTimeout(heroBgTeaserRevealTimer);
          heroBgTeaserRevealTimer = null;
        }

        heroBgTeaserChromeShieldRequired = true;
        heroBgTeaserRevealTargetAt = proposedTargetAt;
        const layer = document.getElementById("heroBgVideoLayer");
        if (layer) {
          layer.classList.remove("is-playing");
        }
        const stageEl = document.getElementById("heroStageEl");
        if (stageEl && stageEl.classList.contains("is-trailer-foreground-mode")) {
          setHeroTrailerLoadingBadgeClient(true, "🎬 Trailer startet…");
        }

        heroBgTeaserRevealTimer = setTimeout(() => {
          heroBgTeaserRevealTimer = null;
          heroBgTeaserRevealTargetAt = 0;
          const liveLayer = document.getElementById("heroBgVideoLayer");
          const liveStage = document.getElementById("heroStageEl");
          const isFg = Boolean(liveStage && liveStage.classList.contains("is-trailer-foreground-mode"));
          if (
            liveLayer &&
            !heroBgTeaserPaused &&
            !heroBgTeaserEnded &&
            !heroBgTeaserStoppedByUser
          ) {
            const elapsedSinceMount = Date.now() - (heroBgTeaserStageOpenedAt || Date.now());
            if (heroBgTeaserIsPlayingConfirmed || (isFg && elapsedSinceMount >= 1650)) {
              heroBgTeaserIsPlayingConfirmed = true;
              // Im Hintergrund vorladen, aber erst beim Tippen einblenden:
              if (!isFg) {
                heroBgTeaserPreloadedParked = true;
                heroBgTeaserPaused = true;
                heroBgTeaserChromeShieldRequired = true;
                liveLayer.classList.remove("is-playing", "is-concealing");
                setHeroTrailerLoadingBadgeClient(false);
                sendYoutubeHeroTeaserCommandClient("pauseVideo");
                syncHeroCinemaDockUiClient();
                return;
              }
              heroBgTeaserPreloadedParked = false;
              heroBgTeaserChromeShieldRequired = false;
              liveLayer.classList.remove("is-concealing");
              liveLayer.classList.add("is-playing");
              setHeroTrailerLoadingBadgeClient(false);
              if (heroBgTeaserPendingUnmute || !heroBgTeaserMuted) {
                heroBgTeaserPendingUnmute = false;
                heroBgTeaserMuted = false;
                sendYoutubeHeroTeaserCommandClient("unMute");
                sendYoutubeHeroTeaserCommandClient("setVolume", [90]);
              }
            } else {
              sendYoutubeHeroTeaserCommandClient("playVideo");
              scheduleHeroRevealAfterYoutubeChromeHidesClient(650, true);
              return;
            }
          } else {
            setHeroTrailerLoadingBadgeClient(false);
          }
          syncHeroCinemaDockUiClient();
        }, safeHoldMs);
      }

      function concealAndPauseHeroTrailerClient(opts = {}) {
        if (heroBgTeaserRevealTimer) {
          clearTimeout(heroBgTeaserRevealTimer);
          heroBgTeaserRevealTimer = null;
        }
        heroBgTeaserRevealTargetAt = 0;
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        setHeroTrailerLoadingBadgeClient(false);
        heroBgTeaserPaused = true;
        heroBgTeaserChromeShieldRequired = true;
        if (typeof opts.stoppedByUser === "boolean") {
          heroBgTeaserStoppedByUser = opts.stoppedByUser;
        }
        if (typeof opts.ended === "boolean") {
          heroBgTeaserEnded = opts.ended;
        }
        const layer = document.getElementById("heroBgVideoLayer");
        if (layer) {
          layer.classList.add("is-concealing");
          layer.classList.remove("is-playing");
        }
        if (opts.exitForeground) {
          const stageEl = document.getElementById("heroStageEl");
          if (stageEl) {
            stageEl.classList.remove("is-trailer-foreground-mode");
          }
        }
        syncHeroCinemaDockUiClient();
        const pauseDelayMs = typeof opts.pauseDelayMs === "number" ? opts.pauseDelayMs : 380;
        heroBgTeaserDelayedPauseTimer = setTimeout(() => {
          heroBgTeaserDelayedPauseTimer = null;
          const liveLayer = document.getElementById("heroBgVideoLayer");
          if (liveLayer) {
            liveLayer.classList.remove("is-concealing");
          }
          if (heroBgTeaserPaused || heroBgTeaserEnded) {
            sendYoutubeHeroTeaserCommandClient("pauseVideo");
          }
        }, pauseDelayMs);
      }

      function resumeHeroTrailerWithBackdropShieldClient(opts = {}) {
        const wasPendingPauseOnly = Boolean(heroBgTeaserDelayedPauseTimer && !heroBgTeaserEnded);
        const wasPreloadedParked = heroBgTeaserPreloadedParked;
        heroBgTeaserPreloadedParked = false;
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        heroBgTeaserPaused = false;
        heroBgTeaserStoppedByUser = false;
        const layer = document.getElementById("heroBgVideoLayer");
        if (layer) {
          layer.classList.remove("is-concealing");
        }
        if (heroBgTeaserEnded && opts.restartIfEnded !== false) {
          heroBgTeaserEnded = false;
          heroBgTeaserCurTime = 0;
          heroBgTeaserChromeShieldRequired = true;
          if (layer) layer.classList.remove("is-playing");
          sendYoutubeHeroTeaserCommandClient("seekTo", [0, true]);
          sendYoutubeHeroTeaserCommandClient("playVideo");
          if (heroBgTeaserPendingUnmute || !heroBgTeaserMuted) {
            sendYoutubeHeroTeaserCommandClient("unMute");
            sendYoutubeHeroTeaserCommandClient("setVolume", [90]);
          }
          scheduleHeroRevealAfterYoutubeChromeHidesClient(1750, true);
          syncHeroCinemaDockUiClient();
          return;
        }
        if (wasPendingPauseOnly && heroBgTeaserIsPlayingConfirmed) {
          heroBgTeaserChromeShieldRequired = false;
          setHeroTrailerLoadingBadgeClient(false);
          if (layer) layer.classList.add("is-playing");
          if (heroBgTeaserPendingUnmute || !heroBgTeaserMuted) {
            sendYoutubeHeroTeaserCommandClient("unMute");
            sendYoutubeHeroTeaserCommandClient("setVolume", [90]);
          }
          syncHeroCinemaDockUiClient();
          return;
        }
        heroBgTeaserChromeShieldRequired = true;
        if (layer) layer.classList.remove("is-playing");
        sendYoutubeHeroTeaserCommandClient("playVideo");
        if (heroBgTeaserPendingUnmute || !heroBgTeaserMuted) {
          sendYoutubeHeroTeaserCommandClient("unMute");
          sendYoutubeHeroTeaserCommandClient("setVolume", [90]);
        }
        scheduleHeroRevealAfterYoutubeChromeHidesClient(wasPreloadedParked ? 880 : 1450, false);
        syncHeroCinemaDockUiClient();
      }

      function stopHeroBackgroundVideoTeaserClient() {
        clearHeroBgTeaserTimersClient();
        setHeroTrailerLoadingBadgeClient(false);
        if (heroFgTapTimer) {
          clearTimeout(heroFgTapTimer);
          heroFgTapTimer = null;
        }
        heroBgTeaserActiveKey = "";
        heroBgTeaserActiveSlideKey = "";
        heroBgTeaserIsPlayingConfirmed = false;
        heroBgTeaserPreloadedParked = false;
        heroBgTeaserChromeShieldRequired = true;
        heroBgTeaserPendingUnmute = false;
        heroBgTeaserPlayingStartedAt = 0;
        heroBgTeaserPaused = false;
        heroBgTeaserEnded = false;
        heroBgTeaserCurTime = 0;
        heroBgTeaserDuration = 0;
        const stageEl = document.getElementById("heroStageEl");
        if (stageEl) {
          stageEl.classList.remove("is-trailer-foreground-mode");
        }
        const layer = document.getElementById("heroBgVideoLayer");
        if (layer) {
          layer.classList.remove("is-playing", "is-concealing");
          layer.innerHTML = "";
        }
        const dock = document.getElementById("heroCinemaPlayerDock");
        if (dock) {
          dock.classList.remove("is-ready");
        }
      }

      function onHeroBgYoutubeIframeLoadClient() {
        if (heroBgTeaserHandshakeTimer) {
          clearInterval(heroBgTeaserHandshakeTimer);
          heroBgTeaserHandshakeTimer = null;
        }
        let ticks = 0;
        const sendHandshake = () => {
          const frame = document.getElementById("heroBgVideoIframe");
          if (!frame || !frame.contentWindow) {
            if (heroBgTeaserHandshakeTimer) {
              clearInterval(heroBgTeaserHandshakeTimer);
              heroBgTeaserHandshakeTimer = null;
            }
            return;
          }
          try {
            frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "heroBgVideoIframe" }), "*");
            frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"] }), "*");
            frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onError"] }), "*");
            if (!heroBgTeaserPaused && !heroBgTeaserEnded && !heroBgTeaserStoppedByUser) {
              frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "*");
            }
            if (heroBgTeaserPendingUnmute || !heroBgTeaserMuted) {
              frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [] }), "*");
              frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [90] }), "*");
            }
          } catch (_e) {}
          ticks++;
          if (ticks >= 14 || heroBgTeaserIsPlayingConfirmed) {
            if (heroBgTeaserHandshakeTimer) {
              clearInterval(heroBgTeaserHandshakeTimer);
              heroBgTeaserHandshakeTimer = null;
            }
          }
        };
        sendHandshake();
        heroBgTeaserHandshakeTimer = setInterval(sendHandshake, 280);
      }

      function mountHeroTrailerCandidateAtIndexClient(idx, startUnmuted = false, startSeconds = 2) {
        clearHeroBgTeaserTimersClient();
        if (idx < 0 || idx >= heroBgTeaserCandidates.length) {
          stopHeroBackgroundVideoTeaserClient();
          return;
        }
        const layer = document.getElementById("heroBgVideoLayer");
        if (!layer) return;
        heroBgTeaserCandidateIdx = idx;
        const cleanKey = heroBgTeaserCandidates[idx];
        heroBgTeaserActiveKey = cleanKey;
        heroBgTeaserStageOpenedAt = Date.now();
        heroBgTeaserIsPlayingConfirmed = false;
        heroBgTeaserPreloadedParked = false;
        heroBgTeaserChromeShieldRequired = true;
        heroBgTeaserPlayingStartedAt = 0;
        heroBgTeaserPaused = false;
        heroBgTeaserEnded = false;
        heroBgTeaserCurTime = 0;
        heroBgTeaserDuration = 0;
        heroBgTeaserPendingUnmute = Boolean(startUnmuted);
        heroBgTeaserMuted = !startUnmuted;
        layer.classList.remove("is-playing", "is-concealing");

        const originParam = (typeof location !== "undefined" && location.origin) ? ("&origin=" + encodeURIComponent(location.origin)) : "";
        const embedSrc = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(cleanKey) +
          "?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&showinfo=0&rel=0" +
          "&enablejsapi=1&playsinline=1&iv_load_policy=3&modestbranding=1&start=" + Math.max(0, Number(startSeconds || 0)) + originParam;
        layer.innerHTML = '<iframe id="heroBgVideoIframe" class="detail-bg-video-frame" src="' + esc(embedSrc) + '" onload="onHeroBgYoutubeIframeLoadClient()" allow="autoplay; encrypted-media" tabindex="-1" aria-hidden="true"></iframe>';

        const stageEl = document.getElementById("heroStageEl");
        if (startUnmuted || (stageEl && stageEl.classList.contains("is-trailer-foreground-mode"))) {
          scheduleHeroRevealAfterYoutubeChromeHidesClient(1750, true);
        }

        heroBgTeaserWatchdogTimer = setTimeout(() => {
          if (!heroBgTeaserIsPlayingConfirmed && heroBgTeaserActiveKey === cleanKey && !heroBgTeaserStoppedByUser) {
            if (heroBgTeaserCandidates.length > 1) {
              if (typeof clientBlockedYoutubeKeys !== "undefined") clientBlockedYoutubeKeys.add(cleanKey);
              const nextIdx = heroBgTeaserCandidateIdx + 1;
              if (nextIdx < heroBgTeaserCandidates.length) {
                mountHeroTrailerCandidateAtIndexClient(nextIdx, startUnmuted || !heroBgTeaserMuted, 2);
              }
            }
          }
        }, 5200);
      }

      if (typeof window !== "undefined" && !window._heroYtMessageListenerBound) {
        window._heroYtMessageListenerBound = true;
        window.addEventListener("message", (ev) => {
          if (!heroBgTeaserActiveKey) return;
          const heroFrame = document.getElementById("heroBgVideoIframe");
          if (!heroFrame || (ev.source && ev.source !== heroFrame.contentWindow)) return;
          const orig = String(ev.origin || "");
          if (!orig.includes("youtube.com") && !orig.includes("youtube-nocookie.com")) return;
          let msg = null;
          try {
            msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
          } catch (_e) {
            return;
          }
          if (!msg || typeof msg !== "object") return;

          if (msg.event === "onError" || (msg.info && typeof msg.info === "number" && msg.event === "onError")) {
            if (typeof clientBlockedYoutubeKeys !== "undefined") clientBlockedYoutubeKeys.add(heroBgTeaserActiveKey);
            const nextIdx = heroBgTeaserCandidateIdx + 1;
            if (nextIdx < heroBgTeaserCandidates.length) {
              mountHeroTrailerCandidateAtIndexClient(nextIdx, heroBgTeaserPendingUnmute || !heroBgTeaserMuted, 2);
            } else {
              stopHeroBackgroundVideoTeaserClient();
            }
            return;
          }

          let pState = null;
          if (msg.event === "onStateChange" && typeof msg.info === "number") {
            pState = msg.info;
          } else if (msg.event === "infoDelivery" && msg.info && typeof msg.info === "object") {
            if (typeof msg.info.playerState === "number") {
              pState = msg.info.playerState;
            }
            if (typeof msg.info.currentTime === "number") {
              heroBgTeaserCurTime = msg.info.currentTime;
            }
            if (typeof msg.info.duration === "number" && msg.info.duration > 0) {
              heroBgTeaserDuration = msg.info.duration;
            }
            if (typeof msg.info.muted === "boolean" && !heroBgTeaserPendingUnmute) {
              heroBgTeaserMuted = msg.info.muted;
            }
            if (
              heroBgTeaserDuration > 6 &&
              heroBgTeaserCurTime > 2 &&
              (heroBgTeaserDuration - heroBgTeaserCurTime) <= 2.2 &&
              !heroBgTeaserEnded &&
              !heroBgTeaserScrubbing
            ) {
              concealAndPauseHeroTrailerClient({ ended: true, exitForeground: true, pauseDelayMs: 430 });
              return;
            }
            syncHeroCinemaDockUiClient();
          }

          if (pState !== null) {
            const layer = document.getElementById("heroBgVideoLayer");
            const stageEl = document.getElementById("heroStageEl");
            const isFg = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));
            if (pState === 1) {
              if (heroBgTeaserWatchdogTimer) {
                clearTimeout(heroBgTeaserWatchdogTimer);
                heroBgTeaserWatchdogTimer = null;
              }
              const wasConfirmedBefore = heroBgTeaserIsPlayingConfirmed;
              heroBgTeaserIsPlayingConfirmed = true;
              heroBgTeaserPaused = false;
              heroBgTeaserEnded = false;
              if (!wasConfirmedBefore || !heroBgTeaserPlayingStartedAt) {
                heroBgTeaserPlayingStartedAt = Date.now();
              }
              if (heroBgTeaserPendingUnmute || (isFg && !heroBgTeaserMuted)) {
                heroBgTeaserPendingUnmute = false;
                heroBgTeaserMuted = false;
                sendYoutubeHeroTeaserCommandClient("unMute");
                sendYoutubeHeroTeaserCommandClient("setVolume", [90]);
              }
              if (heroBgTeaserChromeShieldRequired || !isFg) {
                const elapsedPlaying = Date.now() - (heroBgTeaserPlayingStartedAt || Date.now());
                const holdRemainingMs = Math.max(380, 1780 - elapsedPlaying);
                scheduleHeroRevealAfterYoutubeChromeHidesClient(holdRemainingMs, false);
              } else if (layer && isFg && !heroBgTeaserStoppedByUser && !heroBgTeaserDelayedPauseTimer) {
                layer.classList.remove("is-concealing");
                layer.classList.add("is-playing");
                setHeroTrailerLoadingBadgeClient(false);
              }
              syncHeroCinemaDockUiClient();
            } else if (pState === 2) {
              heroBgTeaserPaused = true;
              heroBgTeaserChromeShieldRequired = true;
              setHeroTrailerLoadingBadgeClient(false);
              if (layer) {
                layer.classList.remove("is-playing");
              }
              syncHeroCinemaDockUiClient();
            } else if (pState === 0) {
              concealAndPauseHeroTrailerClient({ ended: true, exitForeground: true, pauseDelayMs: 430 });
            } else if ((pState === -1 || pState === 5) && !heroBgTeaserPaused && !heroBgTeaserEnded && !heroBgTeaserStoppedByUser) {
              sendYoutubeHeroTeaserCommandClient("playVideo");
              syncHeroCinemaDockUiClient();
            }
          }
        });
      }

      async function resolveHeroSlideTrailerCandidatesClient(hero, heroType) {
        if (!hero || !hero.id) return [];
        const extractFn = typeof extractCandidateKeysFromTrailersClient === "function"
          ? extractCandidateKeysFromTrailersClient
          : (tr) => {
              if (!tr) return [];
              if (typeof tr === "string") return [tr.trim()].filter(Boolean);
              const arr = Array.isArray(tr.candidates) && tr.candidates.length ? tr.candidates : (tr.key ? [tr.key] : []);
              return arr.map(x => String(x || "").trim()).filter(Boolean);
            };
        if (hero.trailers) {
          const direct = extractFn(hero.trailers);
          if (direct.length > 0) return direct;
        }
        if (hero._cachedTrailers) {
          const cached = extractFn(hero._cachedTrailers);
          if (cached.length > 0) return cached;
        }
        const tc = heroType === "s" ? "s" : "m";
        const vipAllowed = typeof isCurrentUserVip === "function" ? isCurrentUserVip() : false;
        const cacheKey = tc + "_" + hero.id + "_" + (vipAllowed ? "vip" : "std");
        if (typeof clientDetailsCache !== "undefined" && clientDetailsCache instanceof Map) {
          const hit = clientDetailsCache.get(cacheKey);
          if (hit && hit.data && hit.data.trailers) {
            hero._cachedTrailers = hit.data.trailers;
            return extractFn(hit.data.trailers);
          }
        }
        try {
          const d = await apiFetchJson(API_BASE + "/details?chatId=" + encodeURIComponent(chatId) + "&type=" + tc + "&id=" + encodeURIComponent(hero.id));
          if (d && d.ok !== false) {
            if (typeof clientDetailsCache !== "undefined" && clientDetailsCache instanceof Map) {
              clientDetailsCache.set(cacheKey, { data: d, ts: Date.now() });
            }
            if (d.trailers) {
              hero._cachedTrailers = d.trailers;
              return extractFn(d.trailers);
            }
          }
        } catch (_e) {}
        return [];
      }

      function scheduleHeroBackgroundVideoTeaserClient(immediateForeground = false) {
        if (state.isSearchMode || state.heroHidden || !Array.isArray(state.heroSlides) || !state.heroSlides.length) {
          stopHeroBackgroundVideoTeaserClient();
          return;
        }
        const hero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
        if (!hero || !hero.id) {
          stopHeroBackgroundVideoTeaserClient();
          return;
        }
        const heroType = hero.media_type === "tv" || state.type === "s" ? "s" : "m";
        const slideKey = heroType + "_" + hero.id;
        if (heroBgTeaserActiveSlideKey !== slideKey) {
          stopHeroBackgroundVideoTeaserClient();
          heroBgTeaserActiveSlideKey = slideKey;
        }
        if (!immediateForeground) {
          if (typeof trailerPreviewEnabled !== "undefined" && !trailerPreviewEnabled) return;
          if (document.getElementById("modalRoot")?.innerHTML.trim()) return;
          if (heroCurtainScrolledToCatalog || (document.body && document.body.classList.contains("hero-scrolled-past"))) return;
        }
        if (heroBgTeaserTimer) {
          clearTimeout(heroBgTeaserTimer);
          heroBgTeaserTimer = null;
        }
        const delayMs = immediateForeground ? 0 : 420;
        heroBgTeaserTimer = setTimeout(async () => {
          heroBgTeaserTimer = null;
          const curHero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
          if (!curHero || String(curHero.id) !== String(hero.id)) return;
          if (!immediateForeground) {
            if (typeof trailerPreviewEnabled !== "undefined" && !trailerPreviewEnabled) return;
            if (document.getElementById("modalRoot")?.innerHTML.trim()) return;
            if (heroCurtainScrolledToCatalog || state.heroHidden || state.isSearchMode) return;
          }
          const cands = await resolveHeroSlideTrailerCandidatesClient(curHero, heroType);
          const latestHero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
          if (!latestHero || String(latestHero.id) !== String(hero.id)) return;
          heroBgTeaserCandidates = cands;
          heroBgTeaserCandidateIdx = 0;
          if (cands.length === 0) return;
          const existingFrame = document.getElementById("heroBgVideoIframe");
          if (existingFrame && heroBgTeaserActiveKey === cands[0]) return;
          mountHeroTrailerCandidateAtIndexClient(0, immediateForeground, immediateForeground ? 0 : 2);
          syncHeroCinemaDockUiClient();
        }, delayMs);
      }

      async function enterHeroForegroundTrailerModeClient(ev, fromStageTap = false) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const stageEl = document.getElementById("heroStageEl");
        if (!stageEl) return;
        if (stageEl.classList.contains("is-trailer-foreground-mode")) {
          const layer = document.getElementById("heroBgVideoLayer");
          if (layer && !layer.classList.contains("is-playing") && heroBgTeaserActiveKey && !heroBgTeaserPaused && !heroBgTeaserEnded) {
            heroBgTeaserPendingUnmute = true;
            heroBgTeaserMuted = false;
            sendYoutubeHeroTeaserCommandClient("playVideo");
            sendYoutubeHeroTeaserCommandClient("unMute");
            sendYoutubeHeroTeaserCommandClient("setVolume", [90]);
            setHeroTrailerLoadingBadgeClient(true, "🎬 Trailer startet…");
            syncHeroCinemaDockUiClient();
            return;
          }
          exitHeroForegroundTrailerModeClient(ev);
          return;
        }
        const hero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
        if (!hero) return;
        const heroType = hero.media_type === "tv" || state.type === "s" ? "s" : "m";
        const slideKey = heroType + "_" + hero.id;
        if (heroBgTeaserActiveSlideKey !== slideKey) {
          stopHeroBackgroundVideoTeaserClient();
          heroBgTeaserActiveSlideKey = slideKey;
        }
        stageEl.classList.add("is-trailer-foreground-mode");
        setHeroTrailerLoadingBadgeClient(true, "🎬 Trailer startet…");
        syncHeroCinemaDockUiClient();

        const candidates = heroBgTeaserCandidates.length > 0
          ? heroBgTeaserCandidates
          : await resolveHeroSlideTrailerCandidatesClient(hero, heroType);
        const curHero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
        if (!curHero || String(curHero.id) !== String(hero.id)) return;

        if (candidates.length === 0) {
          setHeroTrailerLoadingBadgeClient(false);
          if (fromStageTap) {
            syncHeroCinemaDockUiClient();
            return;
          }
          stageEl.classList.remove("is-trailer-foreground-mode");
          syncHeroCinemaDockUiClient();
          const yearStr = (hero.release_date || hero.first_air_date || "").slice(0, 4);
          const ytQ = encodeURIComponent((hero.title || hero.name || "") + " " + yearStr + " Trailer Deutsch");
          showHudToast("ℹ️ Kein einbettbarer Trailer – öffne YouTube-Suche");
          window.open("https://www.youtube.com/results?search_query=" + ytQ, "_blank", "noopener,noreferrer");
          return;
        }
        if (heroBgTeaserTimer) {
          clearTimeout(heroBgTeaserTimer);
          heroBgTeaserTimer = null;
        }
        heroBgTeaserCandidates = candidates;
        heroBgTeaserStoppedByUser = false;
        heroBgTeaserPendingUnmute = true;
        heroBgTeaserMuted = false;

        const existingFrame = document.getElementById("heroBgVideoIframe");
        if (existingFrame && heroBgTeaserActiveKey) {
          sendYoutubeHeroTeaserCommandClient("unMute");
          sendYoutubeHeroTeaserCommandClient("setVolume", [90]);
          const layer = document.getElementById("heroBgVideoLayer");
          if (heroBgTeaserIsPlayingConfirmed && !heroBgTeaserPaused && !heroBgTeaserEnded && !heroBgTeaserChromeShieldRequired) {
            setHeroTrailerLoadingBadgeClient(false);
            if (layer) {
              layer.classList.remove("is-concealing");
              layer.classList.add("is-playing");
            }
          } else if (!heroBgTeaserPaused && !heroBgTeaserEnded) {
            sendYoutubeHeroTeaserCommandClient("playVideo");
            const elapsed = heroBgTeaserPlayingStartedAt > 0
              ? (Date.now() - heroBgTeaserPlayingStartedAt)
              : (Date.now() - (heroBgTeaserStageOpenedAt || Date.now()));
            const remainingMs = Math.max(400, 1750 - elapsed);
            scheduleHeroRevealAfterYoutubeChromeHidesClient(remainingMs, false);
          } else {
            resumeHeroTrailerWithBackdropShieldClient({ restartIfEnded: true });
          }
        } else {
          mountHeroTrailerCandidateAtIndexClient(0, true, 0);
        }
        syncHeroCinemaDockUiClient();
        const modeBtn = document.getElementById("heroCinemaModeBtn");
        if (modeBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(modeBtn, false);
        }
      }

      function exitHeroForegroundTrailerModeClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const stageEl = document.getElementById("heroStageEl");
        if (!stageEl) return;
        if (heroBgTeaserActiveKey && !heroBgTeaserPaused && !heroBgTeaserEnded) {
          concealAndPauseHeroTrailerClient({
            exitForeground: true,
            stoppedByUser: true,
            pauseDelayMs: 380
          });
        } else {
          setHeroTrailerLoadingBadgeClient(false);
          stageEl.classList.remove("is-trailer-foreground-mode");
          const layer = document.getElementById("heroBgVideoLayer");
          if (layer) {
            layer.classList.remove("is-playing", "is-concealing");
          }
          syncHeroCinemaDockUiClient();
        }
        startHeroRotationTimer();
        const trBtn = document.getElementById("heroBtnTrailer") || document.getElementById("heroBtnDetails");
        if (trBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(trBtn, false);
        }
      }

      function toggleHeroCinemaPlayPauseClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const stageEl = document.getElementById("heroStageEl");
        const isFg = Boolean(stageEl && stageEl.classList.contains("is-trailer-foreground-mode"));
        if (!isFg) {
          enterHeroForegroundTrailerModeClient(ev, false);
          return;
        }
        const frame = document.getElementById("heroBgVideoIframe");
        if (!frame) {
          if (heroBgTeaserCandidates.length > 0) {
            heroBgTeaserStoppedByUser = false;
            mountHeroTrailerCandidateAtIndexClient(heroBgTeaserCandidateIdx || 0, !heroBgTeaserMuted, 0);
          }
          return;
        }
        if (heroBgTeaserEnded || heroBgTeaserPaused) {
          resumeHeroTrailerWithBackdropShieldClient({ restartIfEnded: true });
        } else {
          concealAndPauseHeroTrailerClient({ stoppedByUser: true });
        }
      }

      function toggleHeroBackgroundTeaserAudioClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const frame = document.getElementById("heroBgVideoIframe");
        if (!frame) {
          enterHeroForegroundTrailerModeClient(ev, false);
          return;
        }
        if (heroBgTeaserMuted) {
          heroBgTeaserPendingUnmute = true;
          heroBgTeaserMuted = false;
          sendYoutubeHeroTeaserCommandClient("unMute");
          sendYoutubeHeroTeaserCommandClient("setVolume", [90]);
          if (heroBgTeaserEnded || heroBgTeaserPaused) {
            resumeHeroTrailerWithBackdropShieldClient({ restartIfEnded: true });
            return;
          }
        } else {
          heroBgTeaserPendingUnmute = false;
          heroBgTeaserMuted = true;
          sendYoutubeHeroTeaserCommandClient("mute");
        }
        syncHeroCinemaDockUiClient();
      }

      function toggleHeroCinemaZoomModeClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        heroCinemaZoomMode = heroCinemaZoomMode === "fit" ? "fill" : "fit";
        const stageEl = document.getElementById("heroStageEl");
        if (stageEl) {
          stageEl.classList.toggle("is-cinema-zoom-fit", heroCinemaZoomMode === "fit");
        }
        syncHeroCinemaDockUiClient();
        showHeroSeekRippleBadgeClient(
          heroCinemaZoomMode === "fit" ? "▭ Original-Kinoformat" : "⤢ Randlos-Vollbild",
          "center"
        );
      }

      function seekHeroCinemaRelativeClient(deltaSec, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const frame = document.getElementById("heroBgVideoIframe");
        if (!frame || !heroBgTeaserActiveKey) return;
        const maxDur = heroBgTeaserDuration > 2 ? Math.max(1, heroBgTeaserDuration - 2.2) : 9999;
        const nextSec = Math.max(0, Math.min(maxDur, (heroBgTeaserCurTime || 0) + Number(deltaSec || 0)));
        heroBgTeaserCurTime = nextSec;
        heroBgTeaserEnded = false;
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        sendYoutubeHeroTeaserCommandClient("seekTo", [nextSec, true]);
        if (heroBgTeaserPaused) {
          heroBgTeaserPaused = false;
          heroBgTeaserStoppedByUser = false;
          sendYoutubeHeroTeaserCommandClient("playVideo");
        }
        scheduleHeroRevealAfterYoutubeChromeHidesClient(1600, true);
        syncHeroCinemaDockUiClient();
        showHeroSeekRippleBadgeClient(
          deltaSec < 0 ? ("⏪ " + deltaSec + "s") : ("⏩ +" + deltaSec + "s"),
          deltaSec < 0 ? "left" : "right"
        );
      }

      function switchNextHeroTrailerCandidateManualClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (!Array.isArray(heroBgTeaserCandidates) || heroBgTeaserCandidates.length <= 1) return;
        const nextIdx = (heroBgTeaserCandidateIdx + 1) % heroBgTeaserCandidates.length;
        const keepUnmuted = !heroBgTeaserMuted || Boolean(document.getElementById("heroStageEl")?.classList.contains("is-trailer-foreground-mode"));
        heroBgTeaserStoppedByUser = false;
        mountHeroTrailerCandidateAtIndexClient(nextIdx, keepUnmuted, 0);
        syncHeroCinemaDockUiClient();
        showHeroSeekRippleBadgeClient("⏭ Clip " + (nextIdx + 1) + "/" + heroBgTeaserCandidates.length, "center");
      }

      function onHeroCinemaScrubInputClient(inpEl, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (!inpEl) return;
        heroBgTeaserScrubbing = true;
        const targetSec = Math.max(0, Number(inpEl.value || 0));
        heroBgTeaserCurTime = targetSec;
        const timeLbl = document.getElementById("heroCinemaTimeLbl");
        if (timeLbl) {
          timeLbl.textContent = heroBgTeaserDuration > 0
            ? (formatHeroTrailerDockTimeClient(targetSec) + " / " + formatHeroTrailerDockTimeClient(heroBgTeaserDuration))
            : formatHeroTrailerDockTimeClient(targetSec);
        }
      }

      function onHeroCinemaScrubChangeClient(inpEl, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (!inpEl) return;
        const targetSec = Math.max(0, Number(inpEl.value || 0));
        heroBgTeaserCurTime = targetSec;
        heroBgTeaserScrubbing = false;
        heroBgTeaserEnded = false;
        if (heroBgTeaserDelayedPauseTimer) {
          clearTimeout(heroBgTeaserDelayedPauseTimer);
          heroBgTeaserDelayedPauseTimer = null;
        }
        sendYoutubeHeroTeaserCommandClient("seekTo", [targetSec, true]);
        if (heroBgTeaserPaused) {
          heroBgTeaserPaused = false;
          heroBgTeaserStoppedByUser = false;
          sendYoutubeHeroTeaserCommandClient("playVideo");
        }
        scheduleHeroRevealAfterYoutubeChromeHidesClient(1600, true);
        syncHeroCinemaDockUiClient();
      }

      function onHeroForegroundStageCatcherTapClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const stageEl = document.getElementById("heroStageEl");
        if (!stageEl) return;
        const now = Date.now();
        let clientX = 0;
        if (ev && typeof ev.clientX === "number" && ev.clientX > 0) {
          clientX = ev.clientX;
        } else if (ev && ev.changedTouches && ev.changedTouches[0]) {
          clientX = ev.changedTouches[0].clientX;
        }
        const rect = stageEl.getBoundingClientRect();
        const relX = rect.width > 0 ? ((clientX - rect.left) / rect.width) : 0.5;

        if (now - heroFgLastTapAt < 270) {
          heroFgLastTapAt = 0;
          if (heroFgTapTimer) {
            clearTimeout(heroFgTapTimer);
            heroFgTapTimer = null;
          }
          if (relX < 0.38 && heroBgTeaserActiveKey) {
            seekHeroCinemaRelativeClient(-10, ev);
          } else if (relX > 0.62 && heroBgTeaserActiveKey) {
            seekHeroCinemaRelativeClient(10, ev);
          } else {
            toggleHeroCinemaZoomModeClient(ev);
          }
          return;
        }

        const layer = document.getElementById("heroBgVideoLayer");
        if (layer && !layer.classList.contains("is-playing") && heroBgTeaserActiveKey && !heroBgTeaserPaused && !heroBgTeaserEnded) {
          sendYoutubeHeroTeaserCommandClient("playVideo");
          sendYoutubeHeroTeaserCommandClient("unMute");
          sendYoutubeHeroTeaserCommandClient("setVolume", [90]);
          setHeroTrailerLoadingBadgeClient(true, "🎬 Trailer startet…");
          return;
        }

        heroFgLastTapAt = now;
        if (heroFgTapTimer) {
          clearTimeout(heroFgTapTimer);
        }
        heroFgTapTimer = setTimeout(() => {
          heroFgTapTimer = null;
          heroFgLastTapAt = 0;
          exitHeroForegroundTrailerModeClient(ev);
        }, 255);
      }

      function scrollToCatalogBelowHeroClient(ev, opts) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (document.getElementById("heroStageEl")?.classList.contains("is-trailer-foreground-mode")) {
          concealAndPauseHeroTrailerClient({ exitForeground: true, pauseDelayMs: 280 });
        }
        animateHeroCatalogSnapScrollClient(getHeroCatalogSnapScrollYClient(), opts);
      }

      function startHeroRotationTimer() {
        if (heroRotationTimer) clearInterval(heroRotationTimer);
        if (state.isSearchMode || state.heroSlides.length <= 1) return;
        const intervalMs = state.heroHidden ? 5500 : 7000;
        heroRotationTimer = setInterval(() => {
          if (state.isSearchMode || state.heroSlides.length <= 1) return;
          if (
            document.getElementById("modalRoot")?.innerHTML.trim() ||
            document.getElementById("lightboxRoot")?.innerHTML.trim() ||
            document.getElementById("pageJumpModalRoot")?.innerHTML.trim() ||
            document.getElementById("customDialogRoot")?.innerHTML.trim()
          ) {
            return;
          }
          if (document.getElementById("heroStageEl")?.classList.contains("is-trailer-foreground-mode")) {
            return;
          }
          const isScrolledPast = Boolean(
            heroCurtainScrolledToCatalog ||
            (document.body && document.body.classList.contains("hero-scrolled-past")) ||
            (window.scrollY || window.pageYOffset || 0) > 20
          );
          if (state.heroHidden || isScrolledPast || isAnySideMenuOpenClient()) {
            return;
          }
          if (state.searchFocused || heroPointerHovered) return;
          if (document.getElementById("heroDescEl")?.classList.contains("is-expanded")) return;
          if (typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#heroBannerSlot")) {
            return;
          }
          state.heroIndex = (state.heroIndex + 1) % state.heroSlides.length;
          state.heroActionsEngaged = false;
          updateHeroBannerDomOnly();
          const curSlide = state.heroSlides[state.heroIndex];
          if (curSlide && curSlide.id) {
            prewarmItemDetailsClient(curSlide.media_type === "tv" || state.type === "s" ? "s" : "m", curSlide.id);
          }
        }, intervalMs);
      }

      function setHeroSlideIndex(idx) {
        if (!state.heroSlides.length) return;
        triggerTmaHapticClient("selection");
        clearHeroDescTransientFocusClient();
        stopHeroBackgroundVideoTeaserClient();
        state.heroIndex = (idx + state.heroSlides.length) % state.heroSlides.length;
        state.heroActionsEngaged = false;
        updateHeroBannerDomOnly();
        const curSlide = state.heroSlides[state.heroIndex];
        if (curSlide && curSlide.id) {
          prewarmItemDetailsClient(curSlide.media_type === "tv" || state.type === "s" ? "s" : "m", curSlide.id);
        }
        startHeroRotationTimer();
      }

      function selectHeroSlideCard(idx) {
        if (!state.heroSlides.length) return;
        triggerTmaHapticClient("selection");
        clearHeroDescTransientFocusClient();
        stopHeroBackgroundVideoTeaserClient();
        state.heroIndex = (idx + state.heroSlides.length) % state.heroSlides.length;
        state.heroActionsEngaged = true;
        updateHeroBannerDomOnly();
        const curSlide = state.heroSlides[state.heroIndex];
        if (curSlide && curSlide.id) {
          prewarmItemDetailsClient(curSlide.media_type === "tv" || state.type === "s" ? "s" : "m", curSlide.id);
        }
        startHeroRotationTimer();
        const trBtn = document.getElementById("heroBtnTrailer") || document.getElementById("heroBtnDetails");
        if (trBtn && typeof jumpSpatialFocus === "function") {
          jumpSpatialFocus(trBtn, false);
        }
      }

      function toggleHeroSliderHidden(forceHide) {
        const isScrolledPast = Boolean(heroCurtainScrolledToCatalog || (document.body && document.body.classList.contains("hero-scrolled-past")));
        if (typeof forceHide !== "boolean" && !state.heroHidden && isScrolledPast) {
          animateHeroCatalogSnapScrollClient(0);
          return;
        }
        state.heroHidden = typeof forceHide === "boolean" ? forceHide : !state.heroHidden;
        state.heroActionsEngaged = false;
        if (state.heroHidden) {
          stopHeroBackgroundVideoTeaserClient();
        }
        if (!state.heroHidden) {
          heroCurtainScrolledToCatalog = false;
          heroCurrentZone = 0;
          if (document.body) {
            document.body.classList.remove("hero-scrolled-past", "page-scrolled");
          }
          if ((window.scrollY || window.pageYOffset || 0) > 0) {
            window.scrollTo(0, 0);
          }
        }
        try { localStorage.setItem("tma_hero_hidden", state.heroHidden ? "1" : "0"); } catch (e) {}
        syncHeroExpandedBodyClass();
        const curtainEl = document.getElementById("heroCurtainShell");
        if (curtainEl) {
          curtainEl.classList.toggle("is-collapsed", Boolean(state.heroHidden || heroCurtainScrolledToCatalog));
          if (!state.heroHidden) {
            updateHeroBannerDomOnly(false);
          }
        } else {
          updateHeroBannerDomOnly(true);
        }
        syncHeroScrollFadeAndTopBarStateClient();
        syncHeroSearchPlaceholderAndToggleBtnClient();
        startHeroRotationTimer();
        if (state.sidebarOpen) {
          renderFilterSidebarContent(false);
          const sbHeroBtn = document.getElementById("sidebarHeroToggleBtn");
          if (sbHeroBtn && typeof jumpSpatialFocus === "function") jumpSpatialFocus(sbHeroBtn, false);
        }
        if (state.currentView === "settings") {
          const stHeroBtn = document.getElementById("settingsHeroToggleBtn");
          if (stHeroBtn) {
            stHeroBtn.className = "btn " + (!state.heroHidden ? "blue" : "");
            stHeroBtn.innerHTML = '<span>🎬 Empfehlungs-Slider auf der Startseite</span><b>' + (state.heroHidden ? 'AUSGEBLENDET' : 'SICHTBAR') + '</b>';
            if (!state.sidebarOpen && typeof jumpSpatialFocus === "function") jumpSpatialFocus(stHeroBtn, false);
          }
        }
        if (state.heroHidden) {
          showHudToast("🎬 Spotlight sanft eingeklappt • Highlights rotieren als Vorschlag im Suchfeld");
        } else {
          showHudToast("🎬 Kino-Spotlight ausgeklappt");
        }
        if (!state.sidebarOpen && state.currentView !== "settings") {
          const hideBtn = document.getElementById("heroHideBtn");
          if (hideBtn && typeof jumpSpatialFocus === "function") {
            jumpSpatialFocus(hideBtn, false);
          }
        }
      }

      function triggerHeroSwipeUpCollapseClient(opts) {
        if (state.isSearchMode || state.heroHidden) return;
        scrollToCatalogBelowHeroClient(null, opts);
      }

      let lastHeroSwipeGestureHandledAt = 0;

      window.__tmaHandleHeroSwipe = function(direction, opts) {
        const nowPerf = performance.now();
        if (nowPerf < heroBounceLockUntil && !(opts && opts.bounceLock)) return;
        if (nowPerf - lastHeroSwipeGestureHandledAt < 210) return;
        lastHeroSwipeGestureHandledAt = nowPerf;
        if (direction === "up") {
          triggerHeroSwipeUpCollapseClient(opts);
        } else if (direction === "down") {
          if (state.heroHidden && !state.isSearchMode) {
            toggleHeroSliderHidden(false);
          } else if (heroCurtainScrolledToCatalog || (window.scrollY || window.pageYOffset || 0) > 10) {
            animateHeroCatalogSnapScrollClient(0, opts);
          }
        } else if (direction === "left") {
          setHeroSlideIndex(state.heroIndex + 1);
        } else if (direction === "right") {
          setHeroSlideIndex(state.heroIndex - 1);
        }
      };

      window.addEventListener("message", (ev) => {
        const d = ev && ev.data;
        if (d && d.type === "TMA_HERO_SWIPE_GESTURE" && d.direction) {
          window.__tmaHandleHeroSwipe(d.direction, { bounceLock: Boolean(d.bounceLock) });
        }
      });

      function resolveHeroEventTargetElementClient(rawTarget) {
        if (!rawTarget || typeof rawTarget !== "object") return null;
        if (typeof rawTarget.closest === "function") return rawTarget;
        if (rawTarget.parentElement && typeof rawTarget.parentElement.closest === "function") {
          return rawTarget.parentElement;
        }
        return null;
      }

      function isHeroInteractiveControlTargetClient(rawTarget) {
        const el = resolveHeroEventTargetElementClient(rawTarget);
        if (!el) return false;
        return Boolean(
          el.closest(
            "button, a, input, select, textarea, .expandable-desc-box, .hero-dots-nav, .hero-scroll-down-hint, .hero-meta-genre, .hero-meta-year, [data-drag-handle], .admin-drag-handle, #floatingImportStatusWidget, .hero-cinema-player-dock"
          )
        );
      }

      let heroMouseDragActive = false;
      let heroMouseStartX = 0;
      let heroMouseStartY = 0;
      let heroMouseLastY = 0;
      let heroMouseStartTime = 0;
      let heroMouseLastTime = 0;
      let heroMouseInstantVy = 0;
      let heroMouseDraggingUp = false;
      let heroMouseStartTarget = null;

      function onHeroMouseDown(ev) {
        if (!ev || ev.button !== 0) return;
        if (performance.now() < heroBounceLockUntil) return;
        if (isHeroInteractiveControlTargetClient(ev.target)) {
          heroMouseDragActive = false;
          heroMouseStartTarget = null;
          return;
        }
        // Verhindert in Linux Firefox zuverlässig das Markieren von Texten beim Ziehen im Slider!
        if (ev.cancelable) ev.preventDefault();
        try { window.getSelection()?.removeAllRanges(); } catch (_e) {}
        if (document.body) document.body.classList.add("is-gesture-dragging");
        cancelHeroSpringScrollClient();
        heroMouseDragActive = true;
        heroMouseStartTarget = ev.target;
        heroMouseStartX = ev.clientX;
        heroMouseStartY = ev.clientY;
        heroMouseLastY = ev.clientY;
        heroMouseStartTime = performance.now();
        heroMouseLastTime = heroMouseStartTime;
        heroMouseInstantVy = 0;
        heroMouseDraggingUp = false;
      }

      if (typeof window !== "undefined" && !window._heroMouseSwipeListenersBound) {
        window._heroMouseSwipeListenersBound = true;
        window.addEventListener("selectstart", (ev) => {
          if (heroMouseDragActive || (document.body && document.body.classList.contains("is-gesture-dragging"))) {
            if (ev.cancelable) ev.preventDefault();
          }
        });
        window.addEventListener("mousemove", (ev) => {
          if (!heroMouseDragActive) return;
          if (ev.buttons !== undefined && ev.buttons === 0) {
            heroMouseDragActive = false;
            if (document.body) document.body.classList.remove("is-gesture-dragging");
            setHeroRubberBandOffsetClient(0);
            return;
          }
          const nowPerf = performance.now();
          if (nowPerf < heroBounceLockUntil) {
            heroMouseDragActive = false;
            heroMouseDraggingUp = false;
            if (document.body) document.body.classList.remove("is-gesture-dragging");
            setHeroRubberBandOffsetClient(0);
            return;
          }
          const dx = ev.clientX - heroMouseStartX;
          const dy = ev.clientY - heroMouseStartY;
          const stepDt = Math.max(8, nowPerf - (heroMouseLastTime || nowPerf));
          const totalDt = Math.max(12, nowPerf - (heroMouseStartTime || nowPerf));
          const instVy = (ev.clientY - (heroMouseLastY || ev.clientY)) / stepDt;
          const avgVy = dy / totalDt;
          heroMouseInstantVy = Math.abs(instVy) > Math.abs(avgVy) ? instVy : avgVy;
          heroMouseLastY = ev.clientY;
          heroMouseLastTime = nowPerf;

          if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            try { window.getSelection()?.removeAllRanges(); } catch (_e) {}
            clearHeroDescTransientFocusClient();
          }
          if (Math.abs(dy) >= Math.abs(dx) * 0.95 && !state.heroHidden && !state.isSearchMode) {
            if (dy <= -HERO_BOUNCE_LOCK_MIN_DIST && heroMouseInstantVy <= -HERO_BOUNCE_LOCK_VELOCITY && Math.abs(dy) > Math.abs(dx) * 1.15) {
              heroMouseDragActive = false;
              heroMouseDraggingUp = false;
              if (document.body) document.body.classList.remove("is-gesture-dragging");
              setHeroRubberBandOffsetClient(0);
              const hintBtn = document.getElementById("heroScrollDownHintBtn");
              if (hintBtn) hintBtn.style.transform = "";
              window.__tmaHandleHeroSwipe("up", { bounceLock: true });
              return;
            }
            if (dy < -6) {
              heroMouseDraggingUp = true;
              const stageWrap = document.getElementById("heroStageWrapEl");
              if (stageWrap) {
                const heroH = Math.max(280, stageWrap.offsetHeight || window.innerHeight || 580);
                const absDy = Math.abs(dy);
                const rubberPx = -Math.round(Math.min(38, Math.pow(absDy, 0.76) * 1.25));
                setHeroRubberBandOffsetClient(rubberPx);
                const dragFade = Math.max(0, Math.min(0.42, absDy / (heroH * 0.65)));
                stageWrap.style.setProperty("--hero-scroll-fade", dragFade.toFixed(3));
              }
              const hintBtn = document.getElementById("heroScrollDownHintBtn");
              if (hintBtn) {
                const ratio = Math.min(1, Math.abs(dy) / 90);
                hintBtn.style.transform = "translate3d(0, " + Math.round(ratio * 10) + "px, 0) scale(" + (1 + ratio * 0.14).toFixed(2) + ")";
              }
            }
          }
        }, { passive: true });

        window.addEventListener("mouseup", (ev) => {
          if (!heroMouseDragActive) return;
          if (document.body) document.body.classList.remove("is-gesture-dragging");
          const dx = ev.clientX - heroMouseStartX;
          const dy = ev.clientY - heroMouseStartY;
          const dt = Math.max(16, performance.now() - (heroMouseStartTime || performance.now()));
          const avgVy = dy / dt;
          const vy = Math.abs(heroMouseInstantVy) > Math.abs(avgVy) ? heroMouseInstantVy : avgVy;
          const wasDraggingUp = heroMouseDraggingUp;
          const startTarget = heroMouseStartTarget || ev.target;
          heroMouseDragActive = false;
          heroMouseDraggingUp = false;
          heroMouseStartTarget = null;
          setHeroRubberBandOffsetClient(0);
          const hintBtn = document.getElementById("heroScrollDownHintBtn");
          if (hintBtn) hintBtn.style.transform = "";

          if (dy <= -HERO_BOUNCE_LOCK_MIN_DIST && vy <= -HERO_BOUNCE_LOCK_VELOCITY && Math.abs(dy) > Math.abs(dx) * 1.15) {
            window.__tmaHandleHeroSwipe("up", { bounceLock: true });
            return;
          }
          if ((dy <= -56 || (dy <= -36 && vy <= -0.45)) && Math.abs(dy) > Math.abs(dx) * 1.12) {
            window.__tmaHandleHeroSwipe("up");
            return;
          }
          if (wasDraggingUp) {
            animateHeroCatalogSnapScrollClient(0);
            return;
          }
          if (Math.abs(dx) >= 40 && Math.abs(dx) >= Math.abs(dy)) {
            clearHeroDescTransientFocusClient();
            window.__tmaHandleHeroSwipe(dx < 0 ? "left" : "right");
            return;
          }
          // Klick (<10px Bewegung) auf den freien Hintergrund im Hauptslider -> Direkt im Hauptslider Trailer einblenden und Text ausblenden!
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - lastHeroStageTapHandledAt > 420) {
            const el = resolveHeroEventTargetElementClient(startTarget);
            if (!el || !el.closest(".hero-foreground-stage-catcher")) {
              if (!isHeroInteractiveControlTargetClient(startTarget)) {
                lastHeroStageTapHandledAt = Date.now();
                enterHeroForegroundTrailerModeClient(ev, true);
              }
            }
          }
        }, { passive: true });
      }

      function onHeroTouchStart(ev) {
        if (performance.now() < heroBounceLockUntil) {
          heroTouchStartX = 0;
          heroTouchStartY = 0;
          heroTouchDraggingUp = false;
          return;
        }
        const el = resolveHeroEventTargetElementClient(ev.target);
        if (el && el.closest(".expandable-desc-box.is-expanded")) {
          heroTouchStartX = 0;
          heroTouchStartY = 0;
          heroTouchDraggingUp = false;
          return;
        }
        if (ev.touches && ev.touches[0]) {
          cancelHeroSpringScrollClient();
          heroTouchStartX = ev.touches[0].clientX;
          heroTouchStartY = ev.touches[0].clientY;
          heroTouchLastY = ev.touches[0].clientY;
          heroTouchStartTime = performance.now();
          heroTouchLastTime = heroTouchStartTime;
          heroTouchInstantVy = 0;
          heroTouchStartScrollY = window.scrollY || window.pageYOffset || 0;
          heroTouchDraggingUp = false;
        }
      }
      function onHeroTouchMove(ev) {
        const el = resolveHeroEventTargetElementClient(ev.target);
        if (el && el.closest(".expandable-desc-box.is-expanded")) {
          return;
        }
        const nowPerf = performance.now();
        if (nowPerf < heroBounceLockUntil) {
          heroTouchStartX = 0;
          heroTouchStartY = 0;
          heroTouchDraggingUp = false;
          setHeroRubberBandOffsetClient(0);
          return;
        }
        if (!heroTouchStartX || !heroTouchStartY || !ev.touches || !ev.touches[0]) return;
        const curTouchY = ev.touches[0].clientY;
        const dx = ev.touches[0].clientX - heroTouchStartX;
        const dy = curTouchY - heroTouchStartY;
        const stepDt = Math.max(8, nowPerf - (heroTouchLastTime || nowPerf));
        const totalDt = Math.max(12, nowPerf - (heroTouchStartTime || nowPerf));
        const instVy = (curTouchY - (heroTouchLastY || curTouchY)) / stepDt;
        const avgVy = dy / totalDt;
        heroTouchInstantVy = Math.abs(instVy) > Math.abs(avgVy) ? instVy : avgVy;
        heroTouchLastY = curTouchY;
        heroTouchLastTime = nowPerf;

        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          clearHeroDescTransientFocusClient();
        }
        if (Math.abs(dy) >= Math.abs(dx) * 0.95 && !state.heroHidden && !state.isSearchMode) {
          if (ev.cancelable) {
            ev.preventDefault();
          }
          // Mid-Gesture Bounce-Lock (Vollständig geschlossen): Bei zu schnellem Wischen nach oben sofort Gummiband abbrechen & Slider schließen!
          if (dy <= -HERO_BOUNCE_LOCK_MIN_DIST && heroTouchInstantVy <= -HERO_BOUNCE_LOCK_VELOCITY && Math.abs(dy) > Math.abs(dx) * 1.15) {
            heroTouchStartX = 0;
            heroTouchStartY = 0;
            heroTouchDraggingUp = false;
            setHeroRubberBandOffsetClient(0);
            const hintBtn = document.getElementById("heroScrollDownHintBtn");
            if (hintBtn) hintBtn.style.transform = "";
            window.__tmaHandleHeroSwipe("up", { bounceLock: true });
            return;
          }
          if (dy < -6) {
            heroTouchDraggingUp = true;
            const stageWrap = document.getElementById("heroStageWrapEl");
            if (stageWrap) {
              const heroH = Math.max(280, stageWrap.offsetHeight || window.innerHeight || 580);
              const absDy = Math.abs(dy);
              // Spürbarer logarithmischer Gummiband-Widerstand am unteren Slider-Rand
              const rubberPx = -Math.round(Math.min(38, Math.pow(absDy, 0.76) * 1.25));
              setHeroRubberBandOffsetClient(rubberPx);
              const dragFade = Math.max(0, Math.min(0.42, absDy / (heroH * 0.65)));
              stageWrap.style.setProperty("--hero-scroll-fade", dragFade.toFixed(3));
            }
            const hintBtn = document.getElementById("heroScrollDownHintBtn");
            if (hintBtn) {
              const ratio = Math.min(1, Math.abs(dy) / 90);
              hintBtn.style.transform = "translate3d(0, " + Math.round(ratio * 10) + "px, 0) scale(" + (1 + ratio * 0.14).toFixed(2) + ")";
            }
          }
        }
      }
      function onHeroTouchEnd(ev) {
        if (performance.now() < heroBounceLockUntil) {
          heroTouchStartX = 0;
          heroTouchStartY = 0;
          heroTouchDraggingUp = false;
          return;
        }
        if (!heroTouchStartX || !ev.changedTouches || !ev.changedTouches[0]) return;
        const dx = ev.changedTouches[0].clientX - heroTouchStartX;
        const dy = heroTouchStartY ? (ev.changedTouches[0].clientY - heroTouchStartY) : 0;
        const dt = Math.max(16, performance.now() - (heroTouchStartTime || performance.now()));
        const avgVy = dy / dt;
        const vy = Math.abs(heroTouchInstantVy) > Math.abs(avgVy) ? heroTouchInstantVy : avgVy;
        const wasDraggingUp = heroTouchDraggingUp;
        heroTouchStartX = 0;
        heroTouchStartY = 0;
        heroTouchDraggingUp = false;
        setHeroRubberBandOffsetClient(0);
        const hintBtn = document.getElementById("heroScrollDownHintBtn");
        if (hintBtn) hintBtn.style.transform = "";
        if (dy <= -HERO_BOUNCE_LOCK_MIN_DIST && vy <= -HERO_BOUNCE_LOCK_VELOCITY && Math.abs(dy) > Math.abs(dx) * 1.15) {
          window.__tmaHandleHeroSwipe("up", { bounceLock: true });
          return;
        }
        // Angenehm sanfter Übergang: Ab 56px Zugweg ODER kurzem Flick (mind. 36px + vy <= -0.45) in den Katalog wechseln
        if ((dy <= -56 || (dy <= -36 && vy <= -0.45)) && Math.abs(dy) > Math.abs(dx) * 1.12) {
          window.__tmaHandleHeroSwipe("up");
          return;
        }
        if (wasDraggingUp) {
          animateHeroCatalogSnapScrollClient(0);
          return;
        }
        if (Math.abs(dx) > 40 && Math.abs(dx) >= Math.abs(dy)) {
          clearHeroDescTransientFocusClient();
          window.__tmaHandleHeroSwipe(dx < 0 ? "left" : "right");
          return;
        }
        // Kurzes Antippen (<14px Bewegung) auf den freien Hintergrund im Hauptslider -> Direkt im Hauptslider Trailer einblenden und Text ausblenden!
        if (Math.abs(dx) < 14 && Math.abs(dy) < 14 && dt < 450 && Date.now() - lastHeroStageTapHandledAt > 420) {
          const el = resolveHeroEventTargetElementClient(ev.target);
          if (!el || !el.closest(".hero-foreground-stage-catcher")) {
            if (!isHeroInteractiveControlTargetClient(ev.target)) {
              lastHeroStageTapHandledAt = Date.now();
              enterHeroForegroundTrailerModeClient(ev, true);
            }
          }
        }
      }

      function resolveHeroSlideBackdropUrlClient(item) {
        if (!item) return "";
        const rawBp = String(item.backdrop_path || item.poster_path || "").trim();
        if (!rawBp) return "";
        if (rawBp.startsWith("http://") || rawBp.startsWith("https://")) return rawBp;
        return "https://image.tmdb.org/t/p/w1280" + (rawBp.startsWith("/") ? rawBp : ("/" + rawBp));
      }

      function resolveHeroSlidePosterUrlClient(item, size) {
        if (!item) return "";
        const sz = size || "w342";
        const ext = String(item.external_poster_url || item.poster || "").trim();
        const rawP = String(item.poster_path || item.backdrop_path || "").trim();
        if (typeof resolvePosterUrlClient === "function") {
          return resolvePosterUrlClient(rawP, sz, ext);
        }
        if (ext && (ext.startsWith("http://") || ext.startsWith("https://"))) return ext;
        if (!rawP) return "";
        if (rawP.startsWith("http://") || rawP.startsWith("https://")) return rawP;
        return "https://image.tmdb.org/t/p/" + sz + (rawP.startsWith("/") ? rawP : ("/" + rawP));
      }

      const heroAmbilightColorCache = new Map();

      function boostAmbilightRgbTriplet(r, g, b) {
        let nr = Math.max(0, Math.min(255, Math.round(r)));
        let ng = Math.max(0, Math.min(255, Math.round(g)));
        let nb = Math.max(0, Math.min(255, Math.round(b)));
        const maxC = Math.max(nr, ng, nb);
        const minC = Math.min(nr, ng, nb);
        // Falls der Bildbereich sehr dunkel ist, sanft aufhellen für leuchtendes Ambilight
        if (maxC < 95) {
          const lift = maxC > 8 ? (115 / maxC) : 2.2;
          nr = Math.min(255, Math.round(nr * lift + 18));
          ng = Math.min(255, Math.round(ng * lift + 22));
          nb = Math.min(255, Math.round(nb * lift + 30));
        }
        // Sättigung leicht anheben, damit das Ambilight lebendig wirkt
        const avg = (nr + ng + nb) / 3;
        if (maxC - minC < 45) {
          nr = Math.min(255, Math.max(0, Math.round(avg + (nr - avg) * 1.65)));
          ng = Math.min(255, Math.max(0, Math.round(avg + (ng - avg) * 1.65)));
          nb = Math.min(255, Math.max(0, Math.round(avg + (nb - avg) * 1.65)));
        }
        return nr + ", " + ng + ", " + nb;
      }

      function applyDynamicHeroAmbilightClient(backdropUrl) {
        if (!backdropUrl) return;
        const applyPalette = (pal) => {
          if (!pal) return;
          if (document.body) {
            document.body.style.setProperty("--ambi-1", pal.c1);
            document.body.style.setProperty("--ambi-2", pal.c2);
            document.body.style.setProperty("--ambi-3", pal.c3);
          }
          const target = document.getElementById("heroStageWrapEl") || document.querySelector(".hero-stage-wrap");
          if (target) {
            target.style.setProperty("--ambi-1", pal.c1);
            target.style.setProperty("--ambi-2", pal.c2);
            target.style.setProperty("--ambi-3", pal.c3);
            target.classList.toggle("hero-bright-backdrop", Boolean(pal.isBrightLeft));
          }
          const detailStage = document.getElementById("detailHeroStageEl");
          if (detailStage) {
            detailStage.style.setProperty("--ambi-1", pal.c1);
            detailStage.style.setProperty("--ambi-2", pal.c2);
            detailStage.style.setProperty("--ambi-3", pal.c3);
            detailStage.classList.toggle("hero-bright-backdrop", Boolean(pal.isBrightLeft));
          }
        };
        if (heroAmbilightColorCache.has(backdropUrl)) {
          applyPalette(heroAmbilightColorCache.get(backdropUrl));
          return;
        }
        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.referrerPolicy = "no-referrer";
          img.onload = function () {
            try {
              const canvas = document.createElement("canvas");
              const w = 24;
              const h = 14;
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext("2d");
              if (!ctx) return;
              ctx.drawImage(img, 0, 0, w, h);
              const data = ctx.getImageData(0, 0, w, h).data;
              const sampleZone = (xStart, xEnd, yStart, yEnd) => {
                let rSum = 0, gSum = 0, bSum = 0, weightSum = 0;
                for (let y = yStart; y < yEnd; y++) {
                  for (let x = xStart; x < xEnd; x++) {
                    const idx = (y * w + x) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    const lum = (r + g + b) / 3;
                    const sat = Math.max(r, g, b) - Math.min(r, g, b);
                    const weight = 1 + (sat / 85) + (lum > 25 && lum < 235 ? 0.6 : 0.15);
                    rSum += r * weight;
                    gSum += g * weight;
                    bSum += b * weight;
                    weightSum += weight;
                  }
                }
                if (!weightSum) return "14, 165, 233";
                return boostAmbilightRgbTriplet(rSum / weightSum, gSum / weightSum, bSum / weightSum);
              };
              // Helligkeits-Messung im linken Textbereich (für extrem helle Szenen wie Interstellar-Eis)
              let leftLumSum = 0, leftLumCount = 0;
              for (let y = 3; y < 13; y++) {
                for (let x = 0; x < 11; x++) {
                  const idx = (y * w + x) * 4;
                  leftLumSum += (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
                  leftLumCount++;
                }
              }
              const avgLeftLum = leftLumCount > 0 ? (leftLumSum / leftLumCount) : 60;
              const centerMain = sampleZone(5, 19, 1, 11);
              const centerAccent = sampleZone(6, 18, 2, 10);
              const palette = {
                c1: centerMain,
                c2: centerAccent,
                c3: centerMain,
                isBrightLeft: avgLeftLum > 136
              };
              heroAmbilightColorCache.set(backdropUrl, palette);
              applyPalette(palette);
            } catch (_e) {}
          };
          img.src = backdropUrl;
        } catch (_err) {}
      }

      function selectHeroGenreFilter(genreId) {
        triggerTmaHapticClient("selection");
        const val = String(genreId || "all");
        const sel = document.getElementById("searchGenreSelect");
        if (sel) sel.value = val;
        onSearchGenreSelectChange(val);
      }

      function resolveHeroGenreItemsClient(hero, isMovie) {
        if (!hero) return [];
        const primaryMap = isMovie ? MOVIE_GENRES_CLIENT : SERIES_GENRES_CLIENT;
        const secondaryMap = isMovie ? SERIES_GENRES_CLIENT : MOVIE_GENRES_CLIENT;
        const idToName = new Map();
        const nameToId = new Map();
        const addEntries = (obj) => {
          if (!obj || typeof obj !== "object") return;
          Object.entries(obj).forEach(([gName, gId]) => {
            idToName.set(String(gId), gName);
            nameToId.set(String(gName).toLowerCase(), String(gId));
          });
        };
        addEntries(secondaryMap);
        addEntries(primaryMap);
        addEntries(state.genres);

        const out = [];
        const seen = new Set();
        const rawList = Array.isArray(hero.genre_ids) && hero.genre_ids.length
          ? hero.genre_ids
          : (Array.isArray(hero.genres) ? hero.genres : []);

        for (const entry of rawList) {
          let gId = "";
          let gName = "";
          if (entry && typeof entry === "object") {
            gId = String(entry.id || "");
            gName = String(entry.name || "");
            if (!gName && gId && idToName.has(gId)) gName = idToName.get(gId);
            if (!gId && gName && nameToId.has(gName.toLowerCase())) gId = nameToId.get(gName.toLowerCase());
          } else if (typeof entry === "number" || (typeof entry === "string" && /^\\d+$/.test(entry.trim()))) {
            gId = String(entry).trim();
            gName = idToName.get(gId) || "";
          } else if (typeof entry === "string" && entry.trim()) {
            gName = entry.trim();
            gId = nameToId.get(gName.toLowerCase()) || "";
          }
          if (gName && !seen.has(gName.toLowerCase())) {
            seen.add(gName.toLowerCase());
            out.push({ id: gId, name: gName });
            if (out.length >= 3) break;
          }
        }
        return out;
      }

      function buildHeroMetaLineInnerHtml(hero, isMovie, voteStr, yearStr) {
        const genres = resolveHeroGenreItemsClient(hero, isMovie);
        const genresHtml = genres.length
          ? '<span class="hero-meta-sep">·</span><span class="hero-meta-genres">' +
              genres.map((g, idx) =>
                (g.id
                  ? '<span class="hero-meta-genre" onclick="selectHeroGenreFilter(\\'' + esc(g.id) + '\\')" title="Nach Genre ' + esc(g.name) + ' filtern">' + esc(g.name) + '</span>'
                  : '<span>' + esc(g.name) + '</span>') +
                (idx < genres.length - 1 ? '<span>, </span>' : '')
              ).join("") +
            '</span>'
          : '';
        return '<span><span class="hero-meta-star">★</span> ' + voteStr + '</span>' +
          (yearStr ? '<span class="hero-meta-sep">·</span><span class="hero-meta-year" onclick="runSearch(false,\\'(' + esc(yearStr) + ')\\')" title="Alle Titel aus dem Jahr ' + esc(yearStr) + ' suchen">' + esc(yearStr) + '</span>' : '') +
          '<span class="hero-meta-sep">·</span><span>' + (isMovie ? 'Film' : 'Serie') + '</span>' +
          '<span class="hero-meta-sep">·</span><span class="hero-meta-hd" title="Im Katalog in HD verfügbar">HD</span>' +
          genresHtml;
      }

      function syncHeroExpandedBodyClass() {
        if (!document.body) return;
        const isExp = Boolean(
          !state.isSearchMode &&
          !state.heroHidden &&
          (!state.currentView || state.currentView === "discover") &&
          Array.isArray(state.heroSlides) &&
          state.heroSlides.length > 0
        );
        if (document.body.classList.contains("hero-slider-expanded") !== isExp) {
          document.body.classList.toggle("hero-slider-expanded", isExp);
        }
        if (typeof isUserInHeroSliderFront === "function") {
          document.body.classList.toggle("in-hero-slider", isUserInHeroSliderFront());
        }
      }

      const clientClearLogoCache = new Map();
      const clientDecodedClearLogoUrls = new Set();
      const clientClearLogoPreloadPromises = new Map();
      const clientClearLogoFetchPromises = new Map();

      (function hydratePersistedClearLogoCacheClient() {
        try {
          const raw = localStorage.getItem("tma_clearlogo_map_v1");
          if (!raw) return;
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            for (const [k, v] of Object.entries(parsed)) {
              if (k && typeof v === "string") {
                clientClearLogoCache.set(k, v);
              }
            }
          }
        } catch (_e) {}
      })();

      let persistClearLogoTimer = null;
      function schedulePersistClearLogoCacheClient() {
        if (persistClearLogoTimer) return;
        persistClearLogoTimer = setTimeout(() => {
          persistClearLogoTimer = null;
          try {
            const entries = Array.from(clientClearLogoCache.entries()).slice(-300);
            const obj = {};
            for (const [k, v] of entries) {
              obj[k] = v;
            }
            localStorage.setItem("tma_clearlogo_map_v1", JSON.stringify(obj));
          } catch (_e) {}
        }, 450);
      }

      function resolveClearLogoUrlClient(logoPath) {
        const clean = String(logoPath || "").trim();
        if (!clean) return "";
        if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
        return "https://image.tmdb.org/t/p/w500" + (clean.startsWith("/") ? clean : ("/" + clean));
      }

      function preloadClearLogoBitmapClient(logoPathOrUrl) {
        const logoUrl = resolveClearLogoUrlClient(logoPathOrUrl);
        if (!logoUrl) return Promise.resolve(false);
        if (clientDecodedClearLogoUrls.has(logoUrl)) return Promise.resolve(true);
        if (clientClearLogoPreloadPromises.has(logoUrl)) {
          return clientClearLogoPreloadPromises.get(logoUrl);
        }
        const p = new Promise((resolve) => {
          let settled = false;
          const finish = (ok) => {
            if (settled) return;
            settled = true;
            clientClearLogoPreloadPromises.delete(logoUrl);
            if (ok) clientDecodedClearLogoUrls.add(logoUrl);
            resolve(Boolean(ok));
          };
          const timer = setTimeout(() => finish(false), 3500);
          try {
            const img = new Image();
            img.decoding = "async";
            img.onload = () => {
              clearTimeout(timer);
              if (typeof img.decode === "function") {
                img.decode().then(() => finish(true)).catch(() => finish(true));
              } else {
                finish(true);
              }
            };
            img.onerror = () => {
              clearTimeout(timer);
              finish(false);
            };
            img.src = logoUrl;
          } catch (_err) {
            clearTimeout(timer);
            finish(false);
          }
        });
        clientClearLogoPreloadPromises.set(logoUrl, p);
        return p;
      }

      function onClearLogoImgLoadSuccessClient(imgEl) {
        if (!imgEl) return;
        const src = String(imgEl.getAttribute("src") || imgEl.src || "").trim();
        if (src) clientDecodedClearLogoUrls.add(src);
        const wrap = imgEl.closest ? imgEl.closest(".cinema-clear-logo-wrap") : imgEl.parentElement;
        if (wrap) {
          wrap.classList.remove("is-logo-loading");
          wrap.classList.add("is-logo-ready");
          const fb = wrap.querySelector(".cinema-clear-logo-fallback-title");
          if (fb) fb.style.setProperty("display", "none", "important");
        }
      }

      function onClearLogoImgErrorClient(imgEl) {
        if (!imgEl || !imgEl.parentElement) return;
        const altText = esc(imgEl.getAttribute("alt") || "Titel");
        const wrap = imgEl.closest ? imgEl.closest(".cinema-clear-logo-wrap") : imgEl.parentElement;
        if (wrap) {
          wrap.outerHTML =
            '<div id="heroTitleMarqueeWrap" class="inline-marquee-wrap" data-marquee-always="1">' +
              '<span id="heroTitleTextEl" class="inline-marquee-text hero-title-text">' + altText + '</span>' +
            '</div>';
        }
      }

      function buildHeroTitleOrLogoInnerHtmlClient(titleRaw, logoPath, clickAttr = "") {
        const safeTitle = esc(String(titleRaw || "Titel"));
        const logoUrl = resolveClearLogoUrlClient(logoPath);
        const clickProp = clickAttr ? (' onclick="' + clickAttr + '" style="cursor:pointer" title="Nach „' + safeTitle + '“ suchen"') : '';
        if (logoUrl) {
          const isReady = clientDecodedClearLogoUrls.has(logoUrl);
          return '<div class="cinema-clear-logo-wrap ' + (isReady ? 'is-logo-ready' : 'is-logo-loading') + '"' + clickProp + '>' +
            '<div class="cinema-clear-logo-fallback-title inline-marquee-wrap" data-marquee-always="1"' + (isReady ? ' style="display:none !important"' : '') + '>' +
              '<span class="inline-marquee-text hero-title-text">' + safeTitle + '</span>' +
            '</div>' +
            '<img class="cinema-clear-logo" src="' + esc(logoUrl) + '" alt="' + safeTitle + '" draggable="false" onload="onClearLogoImgLoadSuccessClient(this)" onerror="onClearLogoImgErrorClient(this)" />' +
          '</div>';
        }
        return '<div id="heroTitleMarqueeWrap" class="inline-marquee-wrap" data-marquee-always="1"' + clickProp + '>' +
          '<span id="heroTitleTextEl" class="inline-marquee-text hero-title-text">' + safeTitle + '</span>' +
        '</div>';
      }

      async function ensureHeroSlideClearLogoClient(hero, heroType) {
        if (!hero || !hero.id || Number(hero.id) >= 8000000) return "";
        const normType = heroType === "s" ? "s" : "m";
        const key = normType + "_" + Number(hero.id);
        let lp = String(hero.logo_path || "").trim();
        if (!lp && clientClearLogoCache.has(key)) {
          lp = String(clientClearLogoCache.get(key) || "").trim();
          hero.logo_path = lp;
        }
        if (lp) {
          clientClearLogoCache.set(key, lp);
          const ready = await preloadClearLogoBitmapClient(lp);
          if (ready) {
            const activeHero = state.heroSlides && (state.heroSlides[state.heroIndex] || state.heroSlides[0]);
            if (activeHero && String(activeHero.id) === String(hero.id)) {
              const heroTitleBox = document.getElementById("heroTitleBoxEl");
              if (heroTitleBox) {
                heroTitleBox.innerHTML = buildHeroTitleOrLogoInnerHtmlClient(hero.title || hero.name || "", lp);
              }
            }
          }
          return lp;
        }
        if (clientClearLogoCache.has(key)) {
          return "";
        }
        if (clientClearLogoFetchPromises.has(key)) {
          return clientClearLogoFetchPromises.get(key);
        }
        const fetchPromise = (async () => {
          try {
            const r = await apiFetchJson(API_BASE + "/logo?type=" + encodeURIComponent(normType) + "&id=" + encodeURIComponent(hero.id));
            const fetchedLp = String(r?.logo_path || "").trim();
            clientClearLogoCache.set(key, fetchedLp);
            schedulePersistClearLogoCacheClient();
            hero.logo_path = fetchedLp;
            if (!fetchedLp) return "";
            // Zuerst das PNG-Bild komplett im Browser-RAM vorladen & dekodieren, BEVOR das Text-Logo im Slider ersetzt wird (0ms leeres Feld!)
            const ready = await preloadClearLogoBitmapClient(fetchedLp);
            if (!ready) return "";
            const activeHero = state.heroSlides && (state.heroSlides[state.heroIndex] || state.heroSlides[0]);
            if (activeHero && String(activeHero.id) === String(hero.id)) {
              const heroTitleBox = document.getElementById("heroTitleBoxEl");
              if (heroTitleBox) {
                heroTitleBox.innerHTML = buildHeroTitleOrLogoInnerHtmlClient(hero.title || hero.name || "", fetchedLp);
              }
            }
            return fetchedLp;
          } catch (_e) {
            return "";
          } finally {
            clientClearLogoFetchPromises.delete(key);
          }
        })();
        clientClearLogoFetchPromises.set(key, fetchPromise);
        return fetchPromise;
      }

      function prewarmAllHeroSlidesClearLogosClient() {
        if (!Array.isArray(state.heroSlides) || state.heroSlides.length === 0) return;
        state.heroSlides.forEach((sl, idx) => {
          if (!sl || !sl.id) return;
          const slType = sl.media_type === "tv" || state.type === "s" ? "s" : "m";
          setTimeout(() => {
            ensureHeroSlideClearLogoClient(sl, slType);
          }, idx * 55);
        });
      }

      function buildHeroBannerInnerHtml() {
        syncHeroExpandedBodyClass();
        syncHeroSearchPlaceholderAndToggleBtnClient();
        if (state.isSearchMode || !state.heroSlides.length) return "";
        const hero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
        if (!hero) return "";
        const heroType = hero.media_type === "tv" || state.type === "s" ? "s" : "m";
        const isMovie = heroType === "m";
        const yearStr = (hero.release_date || hero.first_air_date || "").slice(0, 4);
        const voteStr = hero.vote_average ? hero.vote_average.toFixed(1) : "–";
        const heroTitleRaw = String(hero.title || hero.name || "");
        const heroTitleSafe = esc(heroTitleRaw);
        const heroPosterSafe = esc(hero.poster_path || hero.external_poster_url || hero.poster || "");
        const backdropUrl = resolveHeroSlideBackdropUrlClient(hero);
        const posterUrl = resolveHeroSlidePosterUrlClient(hero, "w780") || backdropUrl;
        const heroCardKey = heroType + "_" + hero.id;
        const isHeroSaved = typeof savedKeysSet !== "undefined" && savedKeysSet.has(heroCardKey);
        const cachedAmbi = backdropUrl && heroAmbilightColorCache.has(backdropUrl)
          ? heroAmbilightColorCache.get(backdropUrl)
          : null;
        if (backdropUrl && !cachedAmbi) {
          setTimeout(() => applyDynamicHeroAmbilightClient(backdropUrl), 25);
        } else if (cachedAmbi && document.body) {
          document.body.style.setProperty("--ambi-1", cachedAmbi.c1);
          document.body.style.setProperty("--ambi-2", cachedAmbi.c2);
          document.body.style.setProperty("--ambi-3", cachedAmbi.c3);
        }
        const ambiStyleVars = cachedAmbi
          ? ('--ambi-1:' + cachedAmbi.c1 + ';--ambi-2:' + cachedAmbi.c2 + ';--ambi-3:' + cachedAmbi.c3 + ';')
          : '';
        const brightClass = cachedAmbi && cachedAmbi.isBrightLeft ? ' hero-bright-backdrop' : '';
        const collapsedClass = (state.heroHidden || heroCurtainScrolledToCatalog) ? ' is-collapsed' : '';
        const layerAStyle = (backdropUrl ? ('--hero-bg-landscape:url(' + esc(backdropUrl) + ');') : '--hero-bg-landscape:none;') +
          (posterUrl ? ('--hero-bg-portrait:url(' + esc(posterUrl) + ');') : '--hero-bg-portrait:none;');

        const thumbsNavHtml = state.heroSlides.length > 1
          ? '<div class="hero-dots-nav">' +
              '<button type="button" id="heroPrevArrowBtn" class="hero-circle-arrow" onclick="setHeroSlideIndex(' + (state.heroIndex - 1) + ')" title="Vorheriges Highlight (Pfeiltaste Links)">‹</button>' +
              '<div class="hero-dots-track">' +
                state.heroSlides.map((sl, i) => {
                  const slTitle = String(sl.title || sl.name || "");
                  const isAct = i === state.heroIndex;
                  return '<button type="button" class="hero-dot ' + (isAct ? 'active' : '') + '" data-hero-card="' + i + '" onclick="selectHeroSlideCard(' + i + ')" aria-label="Highlight ' + (i + 1) + ': ' + esc(slTitle) + '" title="' + (i + 1) + '. ' + esc(slTitle) + '">' +
                    '<div class="hero-thumb-progress"><div class="hero-thumb-progress-fill"></div></div>' +
                  '</button>';
                }).join("") +
              '</div>' +
              '<button type="button" id="heroNextArrowBtn" class="hero-circle-arrow" onclick="setHeroSlideIndex(' + (state.heroIndex + 1) + ')" title="Nächstes Highlight (Pfeiltaste Rechts)">›</button>' +
            '</div>'
          : '';

        requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient());
        setTimeout(() => scheduleHeroBackgroundVideoTeaserClient(false), 60);

        return '<div id="heroCurtainShell" class="hero-curtain-shell' + collapsedClass + '">' +
          '<div class="hero-curtain-inner">' +
            '<div id="heroStageWrapEl" class="hero-stage-wrap' + brightClass + '" style="' + ambiStyleVars + '">' +
              '<div id="heroAmbilightEl" class="hero-ambilight-glow" style="' + layerAStyle + '"></div>' +
              '<div id="heroAmbilightBeamsEl" class="hero-ambilight-beams"></div>' +
              '<div id="heroStageEl" class="hero" onmouseenter="setHeroPointerHover(true)" onmouseleave="setHeroPointerHover(false)" onmousedown="onHeroMouseDown(event)" ontouchstart="onHeroTouchStart(event)" ontouchmove="onHeroTouchMove(event)" ontouchend="onHeroTouchEnd(event)">' +
                '<div id="heroBackdropLayerA" class="hero-backdrop-layer active-layer" style="' + layerAStyle + '"></div>' +
                '<div id="heroBackdropLayerB" class="hero-backdrop-layer" style="--hero-bg-landscape:none;--hero-bg-portrait:none"></div>' +
                '<div id="heroBgVideoLayer" class="detail-bg-video-layer hero-bg-video-layer"></div>' +
                '<div class="hero-scrim-layer"></div>' +
                '<div id="heroScrollDimOverlay" class="hero-scroll-dim-overlay"></div>' +
                '<div class="hero-inner">' +
                  '<div class="hero-widescreen-body">' +
                    '<div id="heroContentEl" class="hero-content">' +
                      '<div id="heroKickerEl" class="hero-kicker">HIGHLIGHT DIESE WOCHE</div>' +
                      '<div id="heroTitleBoxEl" class="hero-title">' +
                        buildHeroTitleOrLogoInnerHtmlClient(heroTitleRaw, hero.logo_path || clientClearLogoCache.get(heroCardKey) || "") +
                      '</div>' +
                      '<div id="heroMetaCleanEl" class="hero-meta-clean">' +
                        buildHeroMetaLineInnerHtml(hero, isMovie, voteStr, yearStr) +
                      '</div>' +
                      (function() {
                        const heroOvText = resolveHeroOverviewTextClient(hero, isMovie);
                        const rawOrigOv = String(hero._originalOverviewEn || hero.overview || "").trim();
                        const showTransBtn = isLikelyEnglishOverviewClient(rawOrigOv);
                        const isCurrentlyTranslated = Boolean(hero._showTranslatedOverviewDe && hero._translatedOverviewDe);
                        return '<div id="heroDescEl" class="hero-desc expandable-desc-box" tabindex="0" role="button" aria-expanded="false" onclick="toggleExpandableDescriptionClient(event,\\'heroDescEl\\')" onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();toggleExpandableDescriptionClient(event,\\'heroDescEl\\');}">' +
                          '<div id="heroDescTextEl" class="expandable-desc-scroll" data-orig-overview="' + esc(rawOrigOv) + '">' + esc(heroOvText) + '</div>' +
                          '<div class="desc-actions-row">' +
                            '<span class="desc-expand-hint">▾ Mehr lesen</span>' +
                            '<button type="button" id="heroDescTranslateBtn" class="desc-translate-btn' + (isCurrentlyTranslated ? ' is-translated' : '') + '" style="display:' + (showTransBtn ? 'inline-flex' : 'none') + '" onclick="translateOverviewTextClient(event,\\'' + heroCardKey + '\\',\\'heroDescEl\\',\\'heroDescTextEl\\',\\'heroDescTranslateBtn\\')" title="Englische Beschreibung direkt auf Deutsch übersetzen">' + (isCurrentlyTranslated ? '🇬🇧 Original anzeigen' : '🌐 Auf Deutsch übersetzen') + '</button>' +
                          '</div>' +
                        '</div>';
                      })() +
                      '<div id="heroActionsBox" class="hero-actions-box ' + (state.heroActionsEngaged ? 'engaged' : '') + '">' +
                        '<button type="button" id="heroBtnTrailer" class="hero-btn-play hero-action-btn" onclick="enterHeroForegroundTrailerModeClient(event,false)" title="Trailer direkt im Hauptslider einblenden">▶ Trailer</button>' +
                        '<button type="button" id="heroBtnDetails" class="hero-btn-info hero-action-btn" onclick="openDetails(\\''+ heroType +'\\',' + hero.id + ')">ⓘ Details</button>' +
                        '<button type="button" id="heroBtnWishlist" class="hero-btn-wishlist hero-action-btn ' + (isHeroSaved ? 'saved' : '') + '" data-hero-wl-key="' + heroCardKey + '" onclick="quickToggleCardWishlist(event,\\'' + heroType + '\\',' + hero.id + ')" title="' + (isHeroSaved ? 'Aus deiner Merkliste entfernen' : 'Direkt in deiner Merkliste speichern') + '">' + (isHeroSaved ? '✓ Gespeichert' : '＋ Speichern') + '</button>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="hero-bottom-bar">' +
                    thumbsNavHtml +
                    '<button type="button" id="heroScrollDownHintBtn" tabindex="-1" class="hero-scroll-down-hint" onclick="scrollToCatalogBelowHeroClient(event)" title="Nach unten zum Katalog & allen Filmen/Serien gleiten" aria-label="Nach unten zum Katalog & allen Filmen/Serien gleiten">' +
                      '<span id="heroScrollDownHintLabel" class="hero-scroll-down-label">🍿 Zum Katalog</span>' +
                      '<svg class="hero-scroll-down-chevron" viewBox="0 0 24 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                        '<path d="M2.5 2.25L12 10.75L21.5 2.25" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
                      '</svg>' +
                    '</button>' +
                  '</div>' +
                '</div>' +
                '<div id="heroForegroundStageCatcher" class="detail-foreground-stage-catcher hero-foreground-stage-catcher" onclick="onHeroForegroundStageCatcherTapClient(event)" title="Einmal tippen: Slider-Infos einblenden • Doppeltipp Links/Rechts: ±10s Spulen • Doppeltipp Mitte: Kinoformat-Zoom"></div>' +
                '<div id="heroSeekRippleBadge" class="detail-seek-ripple-badge" aria-hidden="true"></div>' +
                '<div id="heroCinemaPlayerDock" class="detail-cinema-player-dock hero-cinema-player-dock" onclick="event.stopPropagation()">' +
                  '<button type="button" id="heroCinemaPlayBtn" class="cinema-dock-btn" onclick="toggleHeroCinemaPlayPauseClient(event)" title="Trailer abspielen / pausieren">▶</button>' +
                  '<button type="button" id="heroCinemaMuteBtn" class="cinema-dock-btn" onclick="toggleHeroBackgroundTeaserAudioClient(event)" title="Ton umschalten">🔊</button>' +
                  '<div id="heroCinemaTimelineWrap" class="cinema-dock-timeline-wrap">' +
                    '<input type="range" id="heroCinemaScrubber" class="cinema-dock-scrubber" min="0" max="120" step="1" value="0" oninput="onHeroCinemaScrubInputClient(this, event)" onchange="onHeroCinemaScrubChangeClient(this, event)" title="Im Trailer vor-/zurückspulen" />' +
                    '<span id="heroCinemaTimeLbl" class="cinema-dock-time">0:00</span>' +
                  '</div>' +
                  '<button type="button" id="heroCinemaNextClipBtn" class="cinema-dock-btn" style="display:none" onclick="switchNextHeroTrailerCandidateManualClient(event)" title="Nächsten verfügbaren Trailer / Clip abspielen">⏭ 1/2</button>' +
                  '<button type="button" id="heroCinemaZoomBtn" class="cinema-dock-btn" onclick="toggleHeroCinemaZoomModeClient(event)" title="Kinoformat-Zoom umschalten (Doppeltipp Mitte)">⤢ Fill</button>' +
                  '<button type="button" id="heroCinemaModeBtn" class="cinema-dock-btn" onclick="enterHeroForegroundTrailerModeClient(event,false)" title="Alle Elemente ausblenden & Trailer in den Vordergrund holen">⛶ Kino</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }

      function updateHeroBannerDomOnly(forceFullRebuild) {
        syncHeroExpandedBodyClass();
        syncHeroSearchPlaceholderAndToggleBtnClient();
        const container = document.getElementById("heroBannerSlot");
        if (!container) return;
        const prevHeroFocusId = (typeof currentSpatialEl !== "undefined" && currentSpatialEl && (container.contains(currentSpatialEl) || currentSpatialEl.id === "heroHideBtn"))
          ? (currentSpatialEl.id || (currentSpatialEl.classList.contains("hero-dot") ? "dot" : ""))
          : "";

        const curtainEl = document.getElementById("heroCurtainShell");
        if (curtainEl) {
          curtainEl.classList.toggle("is-collapsed", Boolean(state.heroHidden || heroCurtainScrolledToCatalog));
        }
        const existingStage = container.querySelector(".hero");
        const layerA = document.getElementById("heroBackdropLayerA");
        const layerB = document.getElementById("heroBackdropLayerB");

        // Butterweicher 0,5s In-Place Crossfade & Tiefen-Gleiten (ohne Zittern) + dynamisches Ambilight-Update + Hochkant-Cover
        if (!forceFullRebuild && !state.isSearchMode && state.heroSlides.length > 0 && existingStage && layerA && layerB) {
          const hero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
          if (hero) {
            const heroType = hero.media_type === "tv" || state.type === "s" ? "s" : "m";
            const isMovie = heroType === "m";
            const yearStr = (hero.release_date || hero.first_air_date || "").slice(0, 4);
            const voteStr = hero.vote_average ? hero.vote_average.toFixed(1) : "–";
            const heroTitleRaw = String(hero.title || hero.name || "");
            const heroTitleSafe = esc(heroTitleRaw);
            const heroPosterSafe = esc(hero.poster_path || hero.external_poster_url || hero.poster || "");
            const backdropUrl = resolveHeroSlideBackdropUrlClient(hero);
            const posterUrl = resolveHeroSlidePosterUrlClient(hero, "w780") || backdropUrl;
            const heroCardKey = heroType + "_" + hero.id;
            const isHeroSaved = typeof savedKeysSet !== "undefined" && savedKeysSet.has(heroCardKey);

            // 1. Dynamisches Ambilight (Farb-Extraktion + Backdrop/Poster-Halo hinter der Top-Leiste + Helligkeits-Check) + 0,5s Crossfade
            const ambiEl = document.getElementById("heroAmbilightEl");
            if (ambiEl) {
              ambiEl.style.setProperty("--hero-bg-landscape", backdropUrl ? ("url(" + backdropUrl + ")") : "none");
              ambiEl.style.setProperty("--hero-bg-portrait", posterUrl ? ("url(" + posterUrl + ")") : "none");
            }
            if (backdropUrl) {
              applyDynamicHeroAmbilightClient(backdropUrl);
            }
            const activeLayer = layerA.classList.contains("active-layer") ? layerA : layerB;
            const nextLayer = activeLayer === layerA ? layerB : layerA;
            nextLayer.classList.remove("active-layer");
            nextLayer.style.setProperty("--hero-bg-landscape", backdropUrl ? ("url(" + backdropUrl + ")") : "none");
            nextLayer.style.setProperty("--hero-bg-portrait", posterUrl ? ("url(" + posterUrl + ")") : "none");
            void nextLayer.offsetWidth;
            nextLayer.classList.add("active-layer");
            activeLayer.classList.remove("active-layer");

            // 2. Content, Genres, HD-Badge & Merkliste-Button sanft aktualisieren
            const contentEl = document.getElementById("heroContentEl");
            if (contentEl) {
              contentEl.classList.add("hero-fade-step");
              setTimeout(() => contentEl.classList.remove("hero-fade-step"), 60);
            }

            const heroLogoPath = hero.logo_path || clientClearLogoCache.get(heroCardKey) || "";
            const heroTitleBox = document.getElementById("heroTitleBoxEl");
            if (heroTitleBox) {
              heroTitleBox.innerHTML = buildHeroTitleOrLogoInnerHtmlClient(heroTitleRaw, heroLogoPath);
            } else {
              const titleWrap = document.getElementById("heroTitleMarqueeWrap");
              const titleTextEl = document.getElementById("heroTitleTextEl");
              if (titleWrap && typeof deactivateInlineTextMarquee === "function") {
                deactivateInlineTextMarquee(titleWrap);
              }
              if (titleTextEl) {
                titleTextEl.textContent = heroTitleRaw;
              }
            }
            ensureHeroSlideClearLogoClient(hero, heroType);
            const metaEl = document.getElementById("heroMetaCleanEl");
            if (metaEl) {
              metaEl.innerHTML = buildHeroMetaLineInnerHtml(hero, isMovie, voteStr, yearStr);
            }
            const descEl = document.getElementById("heroDescEl");
            const descTextEl = document.getElementById("heroDescTextEl");
            const rawOverview = resolveHeroOverviewTextClient(hero, isMovie);
            const rawOrigOv = String(hero._originalOverviewEn || hero.overview || "").trim();
            const showTransBtn = isLikelyEnglishOverviewClient(rawOrigOv);
            const isCurrentlyTranslated = Boolean(hero._showTranslatedOverviewDe && hero._translatedOverviewDe);
            if (descTextEl) {
              descTextEl.textContent = rawOverview;
              descTextEl.setAttribute("data-orig-overview", rawOrigOv);
              descTextEl.scrollTop = 0;
            } else if (descEl) {
              descEl.textContent = rawOverview;
            }
            if (descEl) {
              descEl.classList.remove("is-expanded", "is-long-desc", "spatial-focus");
              descEl.setAttribute("aria-expanded", "false");
              if (document.activeElement === descEl && typeof descEl.blur === "function") {
                try { descEl.blur(); } catch (_e) {}
              }
              const hintEl = descEl.querySelector(".desc-expand-hint");
              if (hintEl) hintEl.textContent = "▾ Mehr lesen";
              requestAnimationFrame(() => syncExpandableDescriptionsOverflowClient(descEl));
            }
            const transBtn = document.getElementById("heroDescTranslateBtn");
            if (transBtn) {
              transBtn.style.display = showTransBtn ? "inline-flex" : "none";
              transBtn.classList.toggle("is-translated", isCurrentlyTranslated);
              transBtn.innerHTML = isCurrentlyTranslated ? "🇬🇧 Original anzeigen" : "🌐 Auf Deutsch übersetzen";
              transBtn.setAttribute("onclick", "translateOverviewTextClient(event,'" + heroCardKey + "','heroDescEl','heroDescTextEl','heroDescTranslateBtn')");
            }
            const trBtn = document.getElementById("heroBtnTrailer");
            if (trBtn) {
              trBtn.setAttribute("onclick", "enterHeroForegroundTrailerModeClient(event,false)");
            }
            const detBtn = document.getElementById("heroBtnDetails");
            if (detBtn) {
              detBtn.setAttribute("onclick", "openDetails('" + heroType + "'," + hero.id + ")");
            }
            const wlBtn = document.getElementById("heroBtnWishlist");
            if (wlBtn) {
              wlBtn.setAttribute("data-hero-wl-key", heroCardKey);
              wlBtn.setAttribute("onclick", "quickToggleCardWishlist(event,'" + heroType + "'," + hero.id + ")");
              wlBtn.setAttribute("title", isHeroSaved ? "Aus deiner Merkliste entfernen" : "Direkt in deiner Merkliste speichern");
              wlBtn.classList.toggle("saved", Boolean(isHeroSaved));
              wlBtn.innerHTML = isHeroSaved ? "✓ Gespeichert" : "＋ Speichern";
            }
            const prevArr = document.getElementById("heroPrevArrowBtn");
            if (prevArr) prevArr.setAttribute("onclick", "setHeroSlideIndex(" + (state.heroIndex - 1) + ")");
            const nextArr = document.getElementById("heroNextArrowBtn");
            if (nextArr) nextArr.setAttribute("onclick", "setHeroSlideIndex(" + (state.heroIndex + 1) + ")");

            // 3. Minimalistische Punktleiste + 7s-Fortschrittsbalken aktualisieren
            const allDots = container.querySelectorAll(".hero-dot");
            allDots.forEach((btn, idx) => {
              const isAct = idx === state.heroIndex;
              btn.classList.toggle("active", isAct);
              const fill = btn.querySelector(".hero-thumb-progress-fill");
              if (fill) {
                fill.style.animation = "none";
                void fill.offsetWidth;
                fill.style.animation = "";
              }
            });

            scheduleHeroBackgroundVideoTeaserClient(false);

            if (typeof window.refreshModalAndEpisodeMarquees === "function") {
              setTimeout(() => window.refreshModalAndEpisodeMarquees(container), 40);
            }
            if (prevHeroFocusId === "dot") {
              const c = container.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]');
              if (c) setSpatialFocus(c, false);
            }
            return;
          }
        }

        container.innerHTML = buildHeroBannerInnerHtml();
        const curHero = state.heroSlides[state.heroIndex] || state.heroSlides[0];
        if (curHero) {
          const curHeroType = curHero.media_type === "tv" || state.type === "s" ? "s" : "m";
          applyDynamicHeroAmbilightClient(resolveHeroSlideBackdropUrlClient(curHero));
          ensureHeroSlideClearLogoClient(curHero, curHeroType);
        }
        syncHeroSearchPlaceholderAndToggleBtnClient();
        scheduleHeroBackgroundVideoTeaserClient(false);
        if (typeof window.refreshModalAndEpisodeMarquees === "function") {
          setTimeout(() => window.refreshModalAndEpisodeMarquees(container), 40);
        }
        if (prevHeroFocusId === "heroBtnDetails") {
          const b = document.getElementById("heroBtnDetails");
          if (b) setSpatialFocus(b, false);
        } else if (prevHeroFocusId === "heroBtnWishlist") {
          const b = document.getElementById("heroBtnWishlist");
          if (b) setSpatialFocus(b, false);
        } else if (prevHeroFocusId === "heroBtnTrailer") {
          const b = document.getElementById("heroBtnTrailer");
          if (b) setSpatialFocus(b, false);
        } else if (prevHeroFocusId === "heroHideBtn" || prevHeroFocusId === "heroRestoreBtn") {
          const b = document.getElementById("heroHideBtn");
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
        const trigBtn = document.getElementById("searchGenreTriggerBtn");
        const trigIcon = document.getElementById("searchGenreTriggerIcon");
        const trigLabel = document.getElementById("searchGenreTriggerLabel");
        const overlayEl = document.getElementById("searchGenreDropdownOverlay");
        const isMovie = state.type !== "s";
        const gMap = (state.genres && Object.keys(state.genres).length > 0)
          ? state.genres
          : (isMovie ? MOVIE_GENRES_CLIENT : SERIES_GENRES_CLIENT);
        const curGenreId = String(state.genreId || "all");
        let activeName = "Alle Genres";
        let activeEmoji = "🎞️";
        let optsHtml = '<option value="all"' + (curGenreId === "all" ? ' selected' : '') + '>🎞️ Alle Genres</option>';
        Object.entries(gMap || {}).forEach(([gName, gId]) => {
          const idStr = String(gId);
          const em = genreEmoji(gName);
          if (curGenreId === idStr) {
            activeName = gName;
            activeEmoji = em;
          }
          optsHtml += '<option value="' + esc(idStr) + '"' + (curGenreId === idStr ? ' selected' : '') + '>' + em + ' ' + esc(gName) + '</option>';
        });
        if (sel) {
          sel.innerHTML = optsHtml;
          sel.value = curGenreId;
        }
        if (trigIcon) trigIcon.textContent = activeEmoji;
        if (trigLabel) trigLabel.textContent = activeName;
        const quickResetEl = document.getElementById("searchGenreQuickResetBtn");
        if (quickResetEl) {
          quickResetEl.style.display = curGenreId !== "all" ? "inline-flex" : "none";
        }
        if (trigBtn) {
          const hasActive = curGenreId !== "all";
          trigBtn.classList.toggle("has-active-genre", hasActive);
          trigBtn.title = hasActive ? ("Aktives Genre: " + activeName + " (Tippen zum Ändern, ✕ zum Zurücksetzen)") : "Nach Genre filtern";
        }
        if (overlayEl && overlayEl.classList.contains("open")) {
          renderSearchGenreDropdownOverlayContent();
        }
        syncTopBarFilterIndicatorsClient();
      }

      function countActiveUserFiltersClient() {
        const s = state.settings || {};
        let count = 0;
        if (state.genreId && String(state.genreId) !== "all") count += 1;
        if (state.currentCompanyId) count += 1;
        if (s.onlyVipStreams && isCurrentUserVip()) count += 1;
        if (s.showUnreleased) count += 1;
        const addArr = (arr) => {
          if (Array.isArray(arr) && arr.length > 0) count += arr.length;
        };
        addArr(s.includedGenres);
        addArr(s.excludedGenres);
        addArr(s.includedPlatforms);
        addArr(s.excludedPlatforms);
        addArr(s.includedEras);
        addArr(s.excludedEras);
        addArr(s.includedStudios);
        addArr(s.excludedStudios);
        addArr(s.includedFsk);
        addArr(s.excludedFsk);
        return count;
      }

      function syncTopBarFilterIndicatorsClient() {
        const totalActive = countActiveUserFiltersClient();
        const badgeEl = document.getElementById("topSidebarFilterCountBadge");
        const sbBtn = document.getElementById("sidebarToggleBtn");
        if (badgeEl) {
          if (totalActive > 0) {
            badgeEl.textContent = String(totalActive);
            badgeEl.style.display = "inline-flex";
          } else {
            badgeEl.style.display = "none";
          }
        }
        if (sbBtn) {
          sbBtn.classList.toggle("has-active-filters", totalActive > 0);
          sbBtn.title = totalActive > 0
            ? ("Menü & Filter öffnen (" + totalActive + " aktive Filter)")
            : "Menü, Filter, Zufall, Account, Design & Ansichtsgröße öffnen";
        }
        const quickResetEl = document.getElementById("searchGenreQuickResetBtn");
        if (quickResetEl) {
          quickResetEl.style.display = (state.genreId && String(state.genreId) !== "all") ? "inline-flex" : "none";
        }
      }

      function resetTopGenreFilterQuickClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        triggerTmaHapticClient("selection");
        closeSearchGenreDropdownOverlay();
        onSearchGenreSelectChange("all");
      }

      function switchGenreOverlayMediaTypeClient(nextType, ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const cleanType = nextType === "s" ? "s" : "m";
        if (state.type === cleanType) return;
        triggerTmaHapticClient("selection");
        state.type = cleanType;
        state.genres = cleanType === "s" ? SERIES_GENRES_CLIENT : MOVIE_GENRES_CLIENT;
        state.genreId = "all";
        updateMediaModeIndicatorDom();
        syncSearchGenreSelectDom();
        renderSearchGenreDropdownOverlayContent();
        if (typeof loadDiscover === "function") {
          loadDiscover(cleanType, "all", state.mode || "trend", state.sort || "default", false, false);
        }
      }

      function renderSearchGenreDropdownOverlayContent() {
        const overlayEl = document.getElementById("searchGenreDropdownOverlay");
        if (!overlayEl) return;
        const isMovie = state.type !== "s";
        const gMap = (state.genres && Object.keys(state.genres).length > 0)
          ? state.genres
          : (isMovie ? MOVIE_GENRES_CLIENT : SERIES_GENRES_CLIENT);
        const curGenreId = String(state.genreId || "all");
        let chipsHtml = '<button type="button" class="genre-overlay-chip ' + (curGenreId === "all" ? "active" : "") + '" onclick="selectGenreFromSearchOverlay(\\'all\\')">' +
          '<span>🎞️</span><span>Alle Genres</span>' +
        '</button>';
        Object.entries(gMap || {}).forEach(([gName, gId]) => {
          const idStr = String(gId);
          const em = genreEmoji(gName);
          chipsHtml += '<button type="button" class="genre-overlay-chip ' + (curGenreId === idStr ? "active" : "") + '" onclick="selectGenreFromSearchOverlay(\\'' + esc(idStr) + '\\')">' +
            '<span>' + em + '</span><span>' + esc(gName) + '</span>' +
          '</button>';
        });
        overlayEl.innerHTML =
          '<div class="genre-overlay-header">' +
            '<div class="genre-overlay-title">' +
              '<span>🎞️ Genre wählen</span>' +
              '<span class="genre-overlay-type-pills">' +
                '<button type="button" class="genre-overlay-type-btn ' + (isMovie ? 'active' : '') + '" onclick="switchGenreOverlayMediaTypeClient(\\'m\\', event)">🎬 Filme</button>' +
                '<button type="button" class="genre-overlay-type-btn ' + (!isMovie ? 'active' : '') + '" onclick="switchGenreOverlayMediaTypeClient(\\'s\\', event)">📺 Serien</button>' +
              '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              (curGenreId !== "all" ? '<button type="button" class="genre-overlay-close-btn" style="border-color:rgba(56,189,248,0.45);color:#7dd3fc" onclick="selectGenreFromSearchOverlay(\\'all\\')" title="Genre-Filter zurücksetzen">↺ Alle</button>' : '') +
              '<button type="button" class="genre-overlay-close-btn" onclick="closeSearchGenreDropdownOverlay()">✕ Schließen</button>' +
            '</div>' +
          '</div>' +
          '<div class="genre-overlay-grid">' + chipsHtml + '</div>';
      }

      function toggleSearchGenreDropdownOverlay(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        triggerTmaHapticClient("light");
        const overlayEl = document.getElementById("searchGenreDropdownOverlay");
        const trigBtn = document.getElementById("searchGenreTriggerBtn");
        if (!overlayEl) return;
        const willOpen = !overlayEl.classList.contains("open");
        if (willOpen) {
          closeAutocomplete();
          renderSearchGenreDropdownOverlayContent();
          overlayEl.classList.add("open");
          if (trigBtn) {
            trigBtn.classList.add("is-open");
            trigBtn.setAttribute("aria-expanded", "true");
          }
        } else {
          closeSearchGenreDropdownOverlay();
        }
      }

      function closeSearchGenreDropdownOverlay() {
        const overlayEl = document.getElementById("searchGenreDropdownOverlay");
        const trigBtn = document.getElementById("searchGenreTriggerBtn");
        if (overlayEl) {
          overlayEl.classList.remove("open");
        }
        if (trigBtn) {
          trigBtn.classList.remove("is-open");
          trigBtn.setAttribute("aria-expanded", "false");
        }
      }

      function selectGenreFromSearchOverlay(genreVal) {
        triggerTmaHapticClient("selection");
        closeSearchGenreDropdownOverlay();
        onSearchGenreSelectChange(genreVal);
        const inp = document.getElementById("searchInput");
        if (!inp || !inp.value.trim()) {
          collapseMobileSearchBarClient();
        }
      }

      function expandMobileSearchBarClient(focusInput = true) {
        const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
        if (hdr && (window.innerWidth || 1024) <= 760) {
          if (!hdr.classList.contains("mobile-search-expanded")) {
            triggerTmaHapticClient("light");
          }
          hdr.classList.add("mobile-search-expanded");
          syncHeroSearchPlaceholderAndToggleBtnClient();
        }
        if (focusInput) {
          const inp = document.getElementById("searchInput");
          if (inp && document.activeElement !== inp) {
            try { inp.focus(); } catch (e) {}
          }
        }
      }

      function collapseMobileSearchBarClient(ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        triggerTmaHapticClient("selection");
        closeSearchGenreDropdownOverlay();
        closeAutocomplete();
        const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
        if (hdr) {
          hdr.classList.remove("mobile-search-expanded");
        }
        const inp = document.getElementById("searchInput");
        if (inp && document.activeElement === inp) {
          try { inp.blur(); } catch (e) {}
        }
        syncHeroSearchPlaceholderAndToggleBtnClient();
      }

      document.addEventListener("click", (ev) => {
        const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
        if (!hdr) return;
        const t = ev.target;
        if (t && typeof t.closest === "function" && !t.closest("#topUnifiedBar")) {
          closeSearchGenreDropdownOverlay();
          const inp = document.getElementById("searchInput");
          const hasText = Boolean(inp && inp.value && inp.value.trim().length > 0);
          if (!hasText) {
            hdr.classList.remove("mobile-search-expanded");
            syncHeroSearchPlaceholderAndToggleBtnClient();
          }
        }
      });

      async function onSearchGenreSelectChange(genreVal) {
        const val = String(genreVal || "all");
        state.genreId = val;
        syncSearchGenreSelectDom();
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
        if (document.getElementById("searchGenreDropdownOverlay")?.classList.contains("open")) { closeSearchGenreDropdownOverlay(); return; }
        if (document.getElementById("topUnifiedBar")?.classList.contains("mobile-search-expanded")) { collapseMobileSearchBarClient(); return; }
        if (document.getElementById("customDialogRoot")?.innerHTML) { closeCustomDialog(null); return; }
        if (document.getElementById("subModalOverlayRoot")?.innerHTML && typeof closeSubModalOverlayClient === "function") { closeSubModalOverlayClient(); return; }
        if (document.getElementById("personSpotlightOverlayRoot")?.innerHTML && typeof closePersonSpotlightOverlayClient === "function") { closePersonSpotlightOverlayClient(); return; }
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
        closeSearchGenreDropdownOverlay();
        collapseMobileSearchBarClient();
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
          onlyVipStreams: false,
          filtersActive: true
        };
        const inp = document.getElementById("searchInput");
        if (inp) inp.value = "";
        updateSearchClearBtnVisibility();
        closeSearchGenreDropdownOverlay();
        collapseMobileSearchBarClient();
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
              sort: "default"
            })
          });
          if (res && res.settings) state.settings = res.settings;
          if (res && res.discover) {
            state.type = "m";
            state.genreId = "all";
            state.mode = "trend";
            state.sort = "default";
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
        loadDiscover("m", "all", "trend", "default");
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

      let lastAutocompleteResponseCache = null;
      let lastAutocompleteQueryCache = "";
      let activeAutocompleteIndex = -1;

      function onSearchInputFocus() {
        closeSearchGenreDropdownOverlay();
        expandMobileSearchBarClient(false);
        updateSearchClearBtnVisibility();
        state.searchFocused = true;
        const inp = document.getElementById("searchInput");
        const val = (inp ? inp.value : "").trim();
        const box = document.getElementById("searchAutocompleteBox");
        if (val && box && !box.classList.contains("open") && lastAutocompleteResponseCache && lastAutocompleteQueryCache.toLowerCase() === val.toLowerCase()) {
          renderAutocompleteSuggestions(val, lastAutocompleteResponseCache);
        }
      }

      function onSearchInputBlur() {
        setTimeout(() => {
          const inp = document.getElementById("searchInput");
          const box = document.getElementById("searchAutocompleteBox");
          const activeEl = document.activeElement;
          const isFocusInsideAutocomplete = Boolean(
            (activeEl && activeEl === inp) ||
            (activeEl && activeEl.closest && activeEl.closest("#searchAutocompleteBox")) ||
            (typeof currentSpatialEl !== "undefined" && currentSpatialEl && currentSpatialEl.closest && currentSpatialEl.closest("#searchAutocompleteBox")) ||
            (box && typeof box.matches === "function" && box.matches(":hover"))
          );
          const val = (inp ? inp.value : "").trim();
          updateSearchClearBtnVisibility();
          const genreOverlayOpen = Boolean(document.getElementById("searchGenreDropdownOverlay")?.classList.contains("open"));
          if (!val && !state.isSearchMode) {
            state.searchFocused = false;
            if (!genreOverlayOpen && activeEl !== inp && !isFocusInsideAutocomplete) {
              const hdr = document.getElementById("topUnifiedBar") || document.querySelector("header");
              if (hdr) hdr.classList.remove("mobile-search-expanded");
              syncHeroSearchPlaceholderAndToggleBtnClient();
            }
          }
          if (!isFocusInsideAutocomplete) {
            closeAutocomplete();
          }
        }, 240);
      }

      function closeAutocomplete() {
        activeAutocompleteIndex = -1;
        const box = document.getElementById("searchAutocompleteBox");
        if (box) {
          box.classList.remove("open");
          box.innerHTML = "";
        }
      }

      function setAutocompleteHighlightIndexClient(nextIdx) {
        const box = document.getElementById("searchAutocompleteBox");
        if (!box || !box.classList.contains("open")) {
          activeAutocompleteIndex = -1;
          return null;
        }
        const items = Array.from(box.querySelectorAll(".ac-item"));
        if (!items.length) {
          activeAutocompleteIndex = -1;
          return null;
        }
        if (nextIdx < -1) nextIdx = items.length - 1;
        if (nextIdx >= items.length) nextIdx = -1;
        activeAutocompleteIndex = nextIdx;
        items.forEach((el, idx) => {
          const isAct = idx === activeAutocompleteIndex;
          el.classList.toggle("ac-kb-active", isAct);
          el.classList.toggle("spatial-focus", isAct);
        });
        if (activeAutocompleteIndex >= 0 && items[activeAutocompleteIndex]) {
          const targetEl = items[activeAutocompleteIndex];
          if (typeof currentSpatialEl !== "undefined") {
            currentSpatialEl = targetEl;
          }
          if (typeof targetEl.scrollIntoView === "function") {
            try { targetEl.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
          }
          return targetEl;
        }
        return null;
      }

      function onSearchInputKeyDownClient(event, inpEl) {
        if (!event) return;
        const box = document.getElementById("searchAutocompleteBox");
        const isAcOpen = Boolean(box && box.classList.contains("open"));
        if (event.key === "ArrowDown" && isAcOpen) {
          const items = Array.from(box.querySelectorAll(".ac-item"));
          if (items.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            const nextIdx = activeAutocompleteIndex + 1 >= items.length ? 0 : activeAutocompleteIndex + 1;
            setAutocompleteHighlightIndexClient(nextIdx);
            return;
          }
        }
        if (event.key === "ArrowUp" && isAcOpen) {
          const items = Array.from(box.querySelectorAll(".ac-item"));
          if (items.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            const prevIdx = activeAutocompleteIndex <= 0 ? (activeAutocompleteIndex === 0 ? -1 : items.length - 1) : activeAutocompleteIndex - 1;
            setAutocompleteHighlightIndexClient(prevIdx);
            return;
          }
        }
        if (event.key === "Escape" && isAcOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeAutocomplete();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (isAcOpen) {
            const items = Array.from(box.querySelectorAll(".ac-item"));
            const highlighted = (activeAutocompleteIndex >= 0 && items[activeAutocompleteIndex])
              ? items[activeAutocompleteIndex]
              : box.querySelector(".ac-item.ac-kb-active, .ac-item.spatial-focus");
            if (highlighted) {
              highlighted.click();
              return;
            }
          }
          closeSearchGenreDropdownOverlay();
          closeAutocomplete();
          if (inpEl && typeof inpEl.blur === "function") inpEl.blur();
          runSearch(false, inpEl ? inpEl.value : "", undefined, true);
        }
      }

      document.addEventListener("pointerdown", (ev) => {
        const box = document.getElementById("searchAutocompleteBox");
        if (!box || !box.classList.contains("open")) return;
        const t = ev.target;
        if (t && typeof t.closest === "function") {
          if (t.closest("#searchAutocompleteBox") || t.closest(".search-bar")) return;
        }
        closeAutocomplete();
      }, { passive: true });

      function onSearchScopeChange(newScope) {
        const selEl = document.getElementById("searchScopeSelect");
        const resolvedScope = newScope || (selEl && selEl.value) || "all";
        state.searchScope = resolvedScope;
        const inp = document.getElementById("searchInput");
        if (inp && inp.value.trim()) {
          runSearch(false, inp.value.trim(), state.searchScope);
        } else if (state.isSearchMode && state.searchQuery) {
          runSearch(false, state.searchQuery, state.searchScope);
        }
      }

      function toggleSearchDetectedEntities() {
        state.searchEntitiesExpanded = !state.searchEntitiesExpanded;
        const box = document.getElementById("searchDetectedEntitiesBody");
        const iconEl = document.getElementById("searchDetectedEntitiesToggleIcon") || document.getElementById("searchDetectedEntitiesChevron");
        if (box) {
          box.style.display = state.searchEntitiesExpanded ? "flex" : "none";
        }
        if (iconEl) {
          iconEl.textContent = state.searchEntitiesExpanded ? "Ausblenden ▴" : "Anzeigen ▾";
        }
      }

      let liveSearchReqSeq = 0;

      function onSearchInputLive(rawVal) {
        updateSearchClearBtnVisibility();
        const q = String(rawVal || "").trim();
        state.searchFocused = true;
        if (liveSearchDebounceTimer) clearTimeout(liveSearchDebounceTimer);
        if (!q) {
          lastAutocompleteResponseCache = null;
          lastAutocompleteQueryCache = "";
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
            lastAutocompleteResponseCache = res;
            lastAutocompleteQueryCache = q;
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

      function selectFullSearchFromAutocompleteClient(qStr) {
        const cleanQ = String(qStr || document.getElementById("searchInput")?.value || "").trim();
        closeAutocomplete();
        const inp = document.getElementById("searchInput");
        if (inp && typeof inp.blur === "function") inp.blur();
        if (cleanQ) {
          runSearch(false, cleanQ, undefined, true);
        }
      }

      function renderAutocompleteSuggestions(q, res) {
        const box = document.getElementById("searchAutocompleteBox");
        if (!box) return;
        const cols = (res.collections || []).slice(0, 4);
        const unis = (res.universes || []).slice(0, 3);
        const studs = (res.studios || []).slice(0, 4);
        const pers = (res.persons || []).slice(0, 4);
        const media = (res.items || []).slice(0, 6);
        if (!cols.length && !unis.length && !studs.length && !pers.length && !media.length) {
          closeAutocomplete();
          return;
        }
        activeAutocompleteIndex = -1;
        let html = '<div class="ac-header-row">' +
          '<span>💡 Direktwahl: Klick / Tipp oder Pfeiltasten ⇅ + Enter</span>' +
          '<button type="button" class="ac-close-mini-btn" onmousedown="event.preventDefault()" onclick="closeAutocomplete()">✕ Schließen</button>' +
        '</div>';

        if (media.length) {
          html += '<div class="ac-group-title">🎬 Filme & 📺 Serien (Direkt öffnen)</div>';
          media.forEach(m => {
            const tc = m.media_type === "tv" ? "s" : "m";
            const yr = (m.release_date || m.first_air_date || "").slice(0, 4);
            const thumbSrc = m.poster_path ? resolvePosterUrlClient(m.poster_path, "w92", "") : "";
            const thumbHtml = thumbSrc
              ? '<img class="ac-item-thumb" src="' + esc(thumbSrc) + '" alt="" loading="lazy" />'
              : '<span class="ac-item-icon-box">' + (tc === "s" ? "📺" : "🎬") + '</span>';
            const typeBadge = tc === "s" ? "Serie" : "Film";
            html += '<div class="ac-item" role="option" tabindex="0" onmousedown="event.preventDefault()" onclick="closeAutocomplete();openDetails(\\'' + tc + '\\',' + Number(m.id) + ',false)">' +
              '<div class="ac-item-left">' +
                thumbHtml +
                '<div class="ac-item-text">' +
                  '<b>' + esc(m.title || m.name) + '</b>' +
                  '<div style="font-size:11px;color:#94a3b8;margin-top:1px">' + (tc === "s" ? "📺 " : "🎬 ") + typeBadge + (yr ? " • " + esc(yr) : "") + '</div>' +
                '</div>' +
              '</div>' +
              '<span class="ac-item-action" style="color:#fbbf24;border-color:rgba(251,191,36,0.35)">⭐ ' + (m.vote_average ? m.vote_average.toFixed(1) : '–') + ' ➔</span>' +
            '</div>';
          });
        }
        if (cols.length || unis.length || studs.length) {
          html += '<div class="ac-group-title">🍿 Reihen, 🌌 Universen & 🏢 Filmstudios</div>';
          unis.forEach(u => {
            html += '<div class="ac-item" role="option" tabindex="0" onmousedown="event.preventDefault()" onclick="closeAutocomplete();openUniverseView(\\'' + esc(u.id) + '\\')">' +
              '<div class="ac-item-left"><span class="ac-item-icon-box">' + esc(u.icon || '🌌') + '</span><span class="ac-item-text"><b>' + esc(u.name) + '</b></span></div>' +
              '<span class="ac-item-action" style="color:#34d399;border-color:rgba(52,211,153,0.35)">Universum ➔</span>' +
            '</div>';
          });
          cols.forEach(c => {
            html += '<div class="ac-item" role="option" tabindex="0" onmousedown="event.preventDefault()" onclick="closeAutocomplete();openCollectionView(' + Number(c.id) + ')">' +
              '<div class="ac-item-left"><span class="ac-item-icon-box">🍿</span><span class="ac-item-text"><b>' + esc(c.name) + '</b></span></div>' +
              '<span class="ac-item-action" style="color:#a78bfa;border-color:rgba(167,139,250,0.35)">Filmreihe ➔</span>' +
            '</div>';
          });
          studs.forEach(st => {
            const cid = st.companyIds || st.id;
            html += '<div class="ac-item" role="option" tabindex="0" onmousedown="event.preventDefault()" data-cid="' + esc(String(cid)) + '" data-cname="' + esc(st.name) + '" data-cpid="' + esc(st.presetStudioId || '') + '" onclick="closeAutocomplete();openStudioView(this.dataset.cid,this.dataset.cname,this.dataset.cpid)">' +
              '<div class="ac-item-left"><span class="ac-item-icon-box">' + esc(st.icon || '🏢') + '</span><span class="ac-item-text"><b>' + esc(st.name) + '</b></span></div>' +
              '<span class="ac-item-action" style="color:#f59e0b;border-color:rgba(245,158,11,0.35)">Studio ➔</span>' +
            '</div>';
          });
        }
        if (pers.length) {
          html += '<div class="ac-group-title">🌟 Personen (Schauspieler & Regie)</div>';
          pers.forEach(p => {
            html += '<div class="ac-item" role="option" tabindex="0" onmousedown="event.preventDefault()" data-pid="' + Number(p.id) + '" data-pname="' + esc(p.name) + '" onclick="closeAutocomplete();openPersonView(Number(this.dataset.pid),this.dataset.pname)">' +
              '<div class="ac-item-left"><span class="ac-item-icon-box">🌟</span><span class="ac-item-text"><b>' + esc(p.name) + '</b>' + (p.known_for ? ' <span style="color:#94a3b8;font-size:11px">(' + esc(p.known_for) + ')</span>' : '') + '</span></div>' +
              '<span class="ac-item-action" style="color:#38bdf8;border-color:rgba(56,189,248,0.35)">Person ➔</span>' +
            '</div>';
          });
        }
        const totalHitsNum = Math.max(media.length, Number(res.totalResults) || media.length);
        html += '<div class="ac-item" role="option" tabindex="0" style="margin-top:4px;border-top:1px solid rgba(148,163,184,0.16)" onmousedown="event.preventDefault()" onclick="selectFullSearchFromAutocompleteClient()">' +
          '<div class="ac-item-left"><span class="ac-item-icon-box">🔍</span><span class="ac-item-text">Alle Suchergebnisse für „<b>' + esc(q) + '</b>“ im Katalog anzeigen</span></div>' +
          '<span class="ac-item-action" style="color:#38bdf8;border-color:rgba(56,189,248,0.45)">' + totalHitsNum + ' Treffer ➔</span>' +
        '</div>';
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
