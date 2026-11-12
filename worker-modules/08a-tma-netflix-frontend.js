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
  async function verifyTelegramInitDataHmac(rawInitData, botToken) {
    if (!rawInitData) return { ok: false, error: "Fehlende initData" };
    try {
      const params = new URLSearchParams(String(rawInitData));
      const receivedHash = params.get("hash");
      if (!receivedHash) return { ok: false, error: "Kein Hash in initData" };

      const userRaw = params.get("user");
      const userObj = userRaw ? JSON.parse(userRaw) : null;

      // Simulator-Sandbox-Unterstützung für lokale Vorschau (Personas 100998877 & 55443322)
      if (receivedHash === "sim_valid_hmac" && userObj && (String(userObj.id) === "100998877" || String(userObj.id) === "55443322")) {
        return { ok: true, user: userObj, isSimulator: true };
      }

      if (!botToken) return { ok: false, error: "Fehlendes Bot-Token" };

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
  async function verifyTelegramLoginWidgetHmac(widgetData, botToken) {
    if (!widgetData || typeof widgetData !== "object") {
      return { ok: false, error: "Fehlende Telegram Login-Widget Daten" };
    }
    try {
      const receivedHash = String(widgetData.hash || "").trim();
      const userId = widgetData.id ? String(widgetData.id).trim() : "";
      if (!receivedHash || !userId) {
        return { ok: false, error: "Ungültige Login-Widget Daten (id oder hash fehlt)" };
      }

      // Simulator- / Sandbox-Unterstützung (wenn kein echtes Bot-Token gesetzt ist oder expliziter Simulator-Hash)
      if (receivedHash === "sim_valid_widget_hmac" || !botToken) {
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
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
      body[data-theme="light"] .btn:not(.red):not(.danger):not(.blue):not(.green):not(.purple):not(.amber):not(.active) {
        background: #f1f5f9;
        color: #0f172a;
        border-color: #cbd5e1;
      }
      body[data-theme="light"] .btn:not(.red):not(.danger):not(.blue):not(.green):not(.purple):not(.amber):not(.active):hover {
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
        background: #e0e7ff;
        border-color: #6366f1;
        color: #312e81;
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
        background: #ffffff;
        border-color: #cbd5e1;
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
      }
      body[data-theme="light"] .card:hover {
        border-color: #0284c7;
        box-shadow: 0 8px 20px rgba(2, 132, 199, 0.16);
      }
      body[data-theme="light"] .card-sub {
        color: #475569;
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
      body[data-theme="light"] .sidebar-sec-title,
      body[data-theme="light"] .sidebar-section-title {
        color: #334155;
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
      body[data-theme="light"] .modal-body [style*="background:#141414"],
      body[data-theme="light"] .panel-box [style*="background:#141414"],
      body[data-theme="light"] .submodal-box [style*="background:#090d16"],
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
      body[data-theme="light"] .panel-box [style*="color:#ddd"],
      body[data-theme="light"] .panel-box [style*="color:#ccc"],
      body[data-theme="light"] .sidebar-body [style*="color:#f8fafc"],
      body[data-theme="light"] .sidebar-body [style*="color:#e2e8f0"],
      body[data-theme="light"] .sidebar-body [style*="color:#cbd5e1"],
      body[data-theme="light"] .submodal-box [style*="color:#f8fafc"],
      body[data-theme="light"] .submodal-box [style*="color:#e2e8f0"],
      body[data-theme="light"] .submodal-box [style*="color:#cbd5e1"] {
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
      body[data-theme="light"] .panel-box [style*="color:#38bdf8"] {
        color: #0369a1 !important;
      }
      body[data-theme="light"] .modal-body [style*="color:#c4b5fd"],
      body[data-theme="light"] .panel-box [style*="color:#c4b5fd"],
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
        outline: 3px solid var(--accent-primary) !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.38), 0 8px 24px rgba(0, 0, 0, 0.85) !important;
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
        background: rgba(11, 13, 19, 0.88);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        padding: calc(8px * var(--scale-menu)) calc(14px * var(--scale-menu));
        border-bottom: 1px solid rgba(255,255,255,0.07);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: nowrap;
      }
      .brand-wrap { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .brand-logo {
        color: #f8fafc;
        font-weight: 800;
        font-size: calc(15.5px * var(--scale-menu));
        letter-spacing: -0.2px;
        cursor: pointer;
        user-select: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: background 0.15s, transform 0.12s, border-color 0.15s, box-shadow 0.15s;
        flex-shrink: 0;
      }
      .brand-logo:hover,
      .brand-logo.spatial-focus,
      .brand-logo:focus-visible {
        background: rgba(255, 255, 255, 0.09);
        border-color: rgba(255, 255, 255, 0.22);
      }
      .brand-logo:active { transform: scale(0.96); }
      .teleport-logo-svg {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
        filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.35));
      }
      .teleport-accent {
        background: linear-gradient(135deg, #38bdf8, #818cf8, #6366f1);
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
      .btn.active { background: #f8fafc; color: #0f172a; border-color: #f8fafc; font-weight: 800; }

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
        border-color: var(--accent-primary) !important;
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.35), 0 4px 16px rgba(0, 0, 0, 0.55) !important;
      }
      .search-scope-select.spatial-focus {
        outline: 2px solid var(--accent-primary) !important;
        outline-offset: -1px !important;
        background-color: rgba(14, 165, 233, 0.22) !important;
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.35) !important;
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
        border-color: #38bdf8 !important;
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
        border: 1px solid rgba(14, 165, 233, 0.5);
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
        background: rgba(14, 165, 233, 0.18);
        border-color: rgba(56, 189, 248, 0.5);
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
      .hero-badge.movie { background: linear-gradient(135deg, #0284c7, #1d4ed8); color: #fff; }
      .hero-badge.series { background: linear-gradient(135deg, #4338ca, #6d28d9); color: #fff; }
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
        color: #fbbf24;
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
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.55), 0 6px 20px rgba(0, 0, 0, 0.75) !important;
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
        box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.5), 0 6px 18px rgba(0, 0, 0, 0.75);
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
        background: linear-gradient(90deg, rgba(14, 165, 233, 0.16) 0%, rgba(22, 22, 30, 0.92) 45%, rgba(22, 22, 30, 0.95) 100%);
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
        border-color: var(--accent-primary);
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(30, 41, 59, 0.95));
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
        background: rgba(18, 21, 30, 0.78);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 12px;
        padding: 8px 10px;
        margin: 4px 0 10px;
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
      .ff-tab-btn:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.2); }
      .ff-tab-btn.open { background: rgba(99, 102, 241, 0.24); border-color: #818cf8; color: #fff; box-shadow: 0 3px 12px rgba(99,102,241,0.25); }
      .ff-tab-btn.has-inc { border-color: var(--inc-border); background: var(--inc-bg); color: var(--inc-text); }
      .ff-tab-btn.has-exc { border-color: var(--exc-border); }

      /* Kompakte Dropdowns für Modus, Anbieter & Sortierung */
      .sort-select,
      .mode-filter-select,
      .new-filter-select {
        background-color: rgba(255, 255, 255, 0.05);
        color: #f1f5f9;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px;
        padding: calc(5.5px * var(--scale-menu)) calc(9px * var(--scale-menu));
        font-size: calc(11.5px * var(--scale-menu));
        font-weight: 600;
        cursor: pointer;
        outline: none;
        color-scheme: dark;
        transition: border-color 0.14s ease, background-color 0.14s ease;
      }
      .sort-select option,
      .mode-filter-select option,
      .new-filter-select option {
        background-color: #12151e;
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
        border-color: rgba(56, 189, 248, 0.65);
        background-color: rgba(14, 165, 233, 0.16);
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
        border-color: rgba(56, 189, 248, 0.75);
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
        background: linear-gradient(135deg, #0284c7, #4338ca);
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
      /* Lesezeichen-Button oben rechts: dauerhaft dezent sichtbar, bei Gespeichert (.saved) grün hervorgehoben */
      .card-quick-save {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.86);
        backdrop-filter: blur(6px);
        border: 1px solid rgba(255, 255, 255, 0.22);
        color: #fff;
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 4;
        opacity: 0.92;
        pointer-events: auto;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
        transition: transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), background 0.14s, opacity 0.14s, border-color 0.14s;
      }
      @media (hover: none), (pointer: coarse) {
        .card-quick-save {
          opacity: 0.95;
          pointer-events: auto;
          width: 30px;
          height: 30px;
          font-size: 12.5px;
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
      .card.card-subnav-active .card-quick-save {
        opacity: 1;
        pointer-events: auto;
      }
      .card.card-saved {
        border-color: rgba(16, 185, 129, 0.65) !important;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(16, 185, 129, 0.35), 0 0 14px rgba(0, 229, 255, 0.12);
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
      /* Instant-Trailer Button unten rechts: NUR bei Hover oder Fokus sichtbar! */
      .card-quick-trailer {
        position: absolute;
        bottom: 6px;
        right: 6px;
        z-index: 3;
        background: rgba(14, 14, 20, 0.94);
        backdrop-filter: blur(6px);
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
      /* Info/Details Sub-Button unten links: NUR bei Hover oder Fokus sichtbar! */
      .card-quick-info {
        position: absolute;
        bottom: 6px;
        left: 6px;
        z-index: 3;
        background: rgba(14, 14, 20, 0.94);
        backdrop-filter: blur(6px);
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
      .card:hover .card-quick-info,
      .card:focus-within .card-quick-info,
      .card.spatial-focus .card-quick-info,
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
      .pagination-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 16px;
        padding: 12px 10px;
        border-radius: 12px;
        background: rgba(18, 21, 30, 0.72);
        border: 1px solid rgba(255, 255, 255, 0.07);
      }
      .page-counter-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 5px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: var(--text);
        font-size: calc(11.5px * var(--scale-text));
        font-weight: 700;
        font-variant-numeric: tabular-nums;
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
        border-color: var(--accent-primary);
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
        background: rgba(99, 102, 241, 0.24);
        border: 1px solid rgba(129, 140, 248, 0.65);
        color: #e0e7ff;
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
        border-bottom-color: var(--accent-primary);
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
      /* Edle Episoden-Zeilen (Apple TV+ / Netflix Stil) */
      .ep-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 9px 12px;
        background: rgba(255, 255, 255, 0.025);
        border-radius: 9px;
        margin-bottom: 6px;
        gap: 10px;
        border: 1px solid rgba(255, 255, 255, 0.065);
        flex-wrap: wrap;
        transition: background 0.14s ease, border-color 0.14s ease;
      }
      .ep-row:hover {
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.14);
      }
      .ep-row.ep-watched { border-color: rgba(16, 185, 129, 0.42); background: rgba(16, 185, 129, 0.06); }
      .ep-row.ep-next-up { border-color: rgba(245, 158, 11, 0.5); background: rgba(245, 158, 11, 0.07); }
      .ep-title {
        font-size: calc(13px * var(--scale-text));
        font-weight: 600;
        color: #f1f5f9;
        cursor: pointer;
        flex: 1;
        min-width: 180px;
        border-radius: 6px;
        padding: 2px 4px;
        transition: color 0.14s ease;
        display: flex;
        align-items: center;
        gap: 9px;
        flex-wrap: wrap;
      }
      .ep-title.spatial-focus,
      .ep-title:hover {
        color: #ffffff;
      }
      .ep-title:hover .ep-name-text,
      .ep-title.spatial-focus .ep-name-text {
        text-decoration: underline;
        text-decoration-color: rgba(255, 255, 255, 0.45);
        text-underline-offset: 3px;
      }
      .ep-code-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 2px 7px;
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #94a3b8;
        font-size: calc(11px * var(--scale-text));
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.3px;
        flex-shrink: 0;
      }
      .ep-name-text {
        color: #f8fafc;
        font-weight: 600;
        line-height: 1.35;
      }
      .btn-stream-clean {
        background: rgba(14, 165, 233, 0.16);
        border: 1px solid rgba(56, 189, 248, 0.45);
        color: #bae6fd;
        font-weight: 700;
        padding: 5px 10px;
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
        background: transparent;
        border: 1px solid transparent;
        color: #94a3b8;
        padding: 4px 7px;
        border-radius: 6px;
        font-size: calc(11.5px * var(--scale-text));
        cursor: pointer;
        opacity: 0.5;
        transition: opacity 0.14s ease, background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .ep-row:hover .ep-ghost-btn,
      .ep-row:focus-within .ep-ghost-btn,
      .ep-ghost-btn:hover,
      .ep-ghost-btn.spatial-focus {
        opacity: 0.92;
      }
      .ep-ghost-btn:hover,
      .ep-ghost-btn.spatial-focus {
        opacity: 1;
        background: rgba(255, 255, 255, 0.09);
        border-color: rgba(255, 255, 255, 0.18);
        color: #ffffff;
      }
      .ep-ghost-btn.saved {
        opacity: 1;
        background: rgba(16, 185, 129, 0.16);
        border-color: rgba(16, 185, 129, 0.42);
        color: #6ee7b7;
      }
      body[data-theme="light"] .ep-name-text {
        color: #0f172a;
      }
      body[data-theme="light"] .ep-code-badge {
        background: #e2e8f0;
        border-color: #cbd5e1;
        color: #334155;
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
      .panel-box { background: rgba(18, 21, 30, 0.88); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
      .lightbox-backdrop { position: fixed; inset: 0; z-index: 220; background: rgba(0,0,0,0.94); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px; }
      .lightbox-img { max-width: 96vw; max-height: 82vh; object-fit: contain; border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,0.9); transition: transform 0.2s ease; cursor: zoom-in; }
      .lightbox-img.zoomed { transform: scale(1.65); cursor: zoom-out; }
      a.link { color: #38bdf8; text-decoration: none; font-weight: 600; }
      body[data-theme="light"] a.link { color: #0284c7; }
      #hudToast {
        position: fixed;
        bottom: 18px;
        right: 14px;
        z-index: 260;
        background: rgba(15, 23, 42, 0.96);
        border: 1px solid rgba(56, 189, 248, 0.65);
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
    <header>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button class="btn" id="sidebarToggleBtn" onclick="toggleFilterSidebar()" title="Menü, Filter, Zufall, Account, Design & Ansichtsgröße öffnen">☰ Menü</button>
        <span id="headerBrandLogo" class="brand-logo" tabindex="0" role="button" aria-label="TelePort – Zur Hauptseite" onclick="goHome()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();goHome();}" title="TelePort – Zur Hauptseite">
          <svg class="teleport-logo-svg" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="tpGradHeader" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#38bdf8"/>
                <stop offset="50%" stop-color="#a855f7"/>
                <stop offset="100%" stop-color="#6366f1"/>
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
          <button class="btn danger" style="padding:4px 8px;font-size:11px" onclick="setDirectFilter('reset_all','','neutral')" title="Alle aktiven Filter zurücksetzen">🗑️ Reset</button>
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
          const isDangerConfirm = /lösch|reset|leeren|entfern|trennen|deaktivier|abmeld/i.test(String(confirmLabel || "") + " " + String(messageText || ""));
          root.innerHTML = '<div class="modal-backdrop" style="z-index:1600;align-items:center" onclick="if(event.target===this)closeCustomDialog(false)">' +
            '<div class="modal" style="max-width:420px;padding:18px;border:1px solid rgba(255,255,255,0.2)">' +
              '<div style="font-size:15px;font-weight:800;margin-bottom:10px">🛡️ Bestätigung</div>' +
              '<div style="font-size:13px;color:var(--text-muted);line-height:1.5;margin-bottom:16px">' + esc(messageText) + '</div>' +
              '<div style="display:flex;justify-content:flex-end;gap:8px">' +
                '<button class="btn" onclick="closeCustomDialog(false)">Abbrechen</button>' +
                '<button class="btn ' + (isDangerConfirm ? 'danger' : 'red') + '" onclick="closeCustomDialog(true)">' + esc(confirmLabel) + '</button>' +
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
          /* 0. Schnellzugriff & Konto */
          '<div class="sidebar-section">' +
            '<div class="sidebar-section-title">' +
              '<span>⚡ Navigation & Konto</span>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
              '<button id="syncBadge" class="btn" style="grid-column:1 / -1;justify-content:space-between;background:rgba(255,255,255,0.04);color:' + (isAuth ? '#34d399' : '#fbbf24') + ';border-color:' + (isAuth ? 'rgba(16,185,129,0.32)' : 'rgba(251,191,36,0.32)') + '" onclick="closeFilterSidebar();openAccountModal()">' +
                '<span>' + esc(accLabel) + '</span><span style="color:var(--text-muted);font-size:11px">🔐 Konto öffnen ▸</span>' +
              '</button>' +
              '<button id="sidebarRandomBtn" class="btn" onclick="closeFilterSidebar();triggerRandom()" title="Zufälligen Titel mit aktiven Filtern ziehen">' +
                (state.type === 's' ? '🎲 Zufalls-Serie' : '🎲 Zufalls-Film') +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();loadFranchisesHub()" title="Alle Filmreihen & Filmuniversen öffnen">' +
                '🌌 Welten & Reihen' +
              '</button>' +
              '<button id="sidebarOpenInBotBtn" class="btn" onclick="closeFilterSidebar();openCurrentViewInBot()" title="Aktuelle Ansicht im Telegram-Bot öffnen">' +
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
              '<button class="btn" onclick="closeFilterSidebar();toggleTmaFullscreenClient()" title="Bot API 8.0 Vollbild-Modus ein-/ausschalten">' +
                '⛶ Vollbild' +
              '</button>' +
              '<button class="btn" onclick="closeFilterSidebar();addTmaToHomeScreenClient()" title="Bot API 8.0 Mini-App Icon auf dem Smartphone-Startbildschirm ablegen">' +
                '📲 Home-Icon' +
              '</button>' +
              (u.isAdmin ? (
                '<button id="adminHeaderBtn" class="btn amber" style="grid-column:1 / -1;justify-content:center" onclick="closeFilterSidebar();loadAdminPanelView()">👑 Admin-Dashboard & VIP-Verwaltung</button>'
              ) : '') +
            '</div>' +
          '</div>' +

          /* 1. Filter-Kategorien (kompakt, beim Öffnen eingeklappt) */
          '<div class="sidebar-section">' +
            '<div class="sidebar-section-title">' +
              '<span>🎛️ Katalog-Filter</span>' +
              '<span style="font-size:10px;color:var(--text-muted)">✓ Einschluss • ✕ Ausschluss</span>' +
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
              '<button id="sidebarVipStreamsOnlyBtn" class="btn ' + (s.onlyVipStreams ? 'green' : '') + '" style="width:100%;justify-content:space-between;' + (catGridHtml ? 'margin-bottom:8px' : '') + '" onclick="setDirectFilter(\\'vip_streams\\',\\'\\',\\'toggle\\')">' +
                '<span>🌟 Nur mit verfügbarem Stream</span>' +
                '<b>' + (s.onlyVipStreams ? 'AKTIV' : 'ALLE') + '</b>' +
              '</button>'
            ) : '') +
            catGridHtml +
          '</div>' +

          /* 2. Design & Ansicht (eingeklappt beim Öffnen) */
          '<div class="sidebar-section">' +
            '<button type="button" id="sidebarSecBtn_design" class="sidebar-collapse-btn" onclick="toggleSidebarExtraSection(\\'design\\')">' +
              '<span>🎨 Darstellung & Komfort</span>' +
              '<span class="sidebar-collapse-meta">' + themeBadge + ' ' + (state.sidebarDesignOpen ? '▾' : '▸') + '</span>' +
            '</button>' +
            (state.sidebarDesignOpen ? (
              '<div id="sidebarDesignBody" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08)">' +
                '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:6px">' +
                  '<button id="sidebarThemeBtn_dark" class="btn ' + (appTheme === 'dark' ? 'active' : '') + '" onclick="setAppTheme(\\'dark\\')">🌙 Dark</button>' +
                  '<button id="sidebarThemeBtn_light" class="btn ' + (appTheme === 'light' ? 'active' : '') + '" onclick="setAppTheme(\\'light\\')">☀️ Light</button>' +
                  '<button id="sidebarThemeBtn_cyberpunk" class="btn ' + (appTheme === 'cyberpunk' ? 'active' : '') + '" onclick="setAppTheme(\\'cyberpunk\\')">⚡ Cyber</button>' +
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
                  '<span>🎬 Spotlight-Banner</span>' +
                  '<b>' + (state.heroHidden ? 'AUS' : 'EIN') + '</b>' +
                '</button>' +
              '</div>'
            ) : '') +
          '</div>' +

          /* 3. Ansichtsgröße (eingeklappt beim Öffnen) */
          '<div class="sidebar-section">' +
            '<button type="button" id="sidebarSecBtn_scale" class="sidebar-collapse-btn" onclick="toggleSidebarExtraSection(\\'scale\\')">' +
              '<span>🔠 Skalierung & Textgröße</span>' +
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

      function openAccountModal() {
        const m = document.getElementById("modalRoot");
        if (!m) return;
        const isAuth = Boolean(state.isAuthenticated && state.authUser);
        const u = state.authUser || {};
        const canCreateOrUpdateAccount = Boolean(state.hasInitData || (isAuth && u.hasPasswordAccount));
        const activeTab = state.loginModalTab || "telegram";

        let bodyHtml = "";
        if (isAuth) {
          stopBotCodePollClient();
          bodyHtml += '<div class="panel-box" style="border-color:rgba(16,185,129,0.35)">' +
            '<div style="font-size:13.5px;font-weight:800;color:#34d399;margin-bottom:6px">✅ Authentifiziertes Konto aktiv</div>' +
            '<div style="font-size:12px;color:#ddd;line-height:1.6">' +
              '<div>🆔 <b>Telegram-ID:</b> ' + esc(u.telegramId) + '</div>' +
              (u.tgUsername ? '<div>💬 <b>Telegram:</b> @' + esc(u.tgUsername) + '</div>' : '') +
              '<div>🔐 <b>Web-Account:</b> ' + (u.hasPasswordAccount ? ('<span style="color:#34d399">Abgesichert als <b>' + esc(u.customUsername) + '</b> (Login überall ohne initData möglich)</span>') : '<span style="color:#fbbf24">Noch kein Passwort gesetzt (Über Telegram angemeldet)</span>') + '</div>' +
              '<div>🛡️ <b>Zwei-Faktor-Schutz (2FA):</b> ' + (u.totpEnabled ? '<span style="color:#34d399;font-weight:800">🟢 TOTP 2FA Aktiv (Google Authenticator / Authy)</span>' : '<span style="color:#94a3b8">⚪ Optional (Nicht aktiviert)</span>') + '</div>' +
              '<div>🌟 <b>VIP-Status:</b> ' + (u.isVip ? '<span style="color:#fbbf24;font-weight:800">🌟 VIP Aktiv</span>' : 'Standard-Nutzer') + '</div>' +
              (u.isAdmin ? '<div>👑 <b>Rolle:</b> <span style="color:#f87171;font-weight:800">Autorisierter Administrator</span></div>' : '') +
            '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
              (u.isAdmin ? '<button class="btn amber" onclick="document.getElementById(\\'modalRoot\\').innerHTML=\\'\\';loadAdminPanelView()">👑 Admin-Panel öffnen</button>' : '') +
              '<button class="btn danger" onclick="logoutWebSession()">🚪 Abmelden (In Gast-Modus wechseln)</button>' +
            '</div>' +
          '</div>';
        } else {
          bodyHtml += '<div class="panel-box" style="border-color:rgba(0,240,255,0.35);background:linear-gradient(145deg,rgba(11,16,33,0.95),rgba(16,16,24,0.96))">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
              '<div style="font-size:13.5px;font-weight:800;color:#00f0ff">🔐 Anmeldung für Browser, PC & Smart-TV (Ohne initData)</div>' +
              '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                '<button type="button" class="btn ' + (activeTab === "telegram" ? "blue" : "") + '" style="padding:4px 10px;font-size:11.5px" onclick="switchLoginModalTabClient(\\'telegram\\')">📲 Telegram Widget & TV-Code</button>' +
                '<button type="button" class="btn ' + (activeTab === "password" ? "green" : "") + '" style="padding:4px 10px;font-size:11.5px" onclick="switchLoginModalTabClient(\\'password\\')">🔑 Username & Passwort</button>' +
              '</div>' +
            '</div>' +
            (activeTab === "telegram" ? (
              '<div style="display:flex;flex-direction:column;gap:10px">' +
                /* Säule 1: 1-Klick Bot-Bestätigung & 6-stelliger Code (funktioniert immer, auch auf TV & ohne Cookies) */
                '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(56,189,248,0.3);border-radius:8px;padding:10px">' +
                  '<div style="font-size:12.5px;font-weight:800;color:#38bdf8;margin-bottom:4px">1️⃣ 1-Klick Bot-Bestätigung & 6-stelliger Smart-TV / Browser-Code (Empfohlen)</div>' +
                  '<div style="font-size:11.5px;color:#cbd5e1;line-height:1.45;margin-bottom:8px">' +
                    'Funktioniert auf jedem Gerät (PC, Smartphone-Browser, Smart-TV) – ganz ohne Drittanbieter-Cookies:' +
                  '</div>' +
                  '<button type="button" class="btn blue" onclick="startBotCodeLoginChallengeClient()">📲 6-stelligen Login-Code & 1-Klick Bot-Link anfordern</button>' +
                  '<div id="botCodeChallengeBox"></div>' +
                '</div>' +
                /* Säule 2: Offizielles Telegram Login Widget (HMAC-SHA256) */
                '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(139,92,246,0.3);border-radius:8px;padding:10px">' +
                  '<div style="font-size:12.5px;font-weight:800;color:#c4b5fd;margin-bottom:4px">2️⃣ Offizielles Telegram Login Widget (HMAC-SHA256)</div>' +
                  '<div style="font-size:11.5px;color:#cbd5e1;line-height:1.45;margin-bottom:8px">' +
                    'Direktes Browser-Login über <code>telegram-widget.js</code> (Hinweis: Bei @BotFather muss einmalig <code>/setdomain</code> auf deine Worker-Domain gesetzt sein):' +
                  '</div>' +
                  '<div id="tgLoginWidgetContainer" style="min-height:38px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"></div>' +
                  '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                    '<button type="button" class="btn purple" style="padding:5px 10px;font-size:11.5px" onclick="onTelegramWidgetAuthClient({id:100998877,first_name:\\'Admin\\',username:\\'teleport_admin\\',auth_date:Math.floor(Date.now()/1000),hash:\\'sim_valid_widget_hmac\\'})">' +
                      '⚡ Telegram-Widget Login direkt ausführen (Demo / Admin)' +
                    '</button>' +
                  '</div>' +
                '</div>' +
                '<div id="loginModalFeedback" style="font-size:12px;color:#f87171"></div>' +
              '</div>'
            ) : (
              '<div style="display:flex;flex-direction:column;gap:8px">' +
                '<p style="font-size:12px;color:#cbd5e1;line-height:1.45;margin:0 0 4px 0">' +
                  'Logge dich mit deinem abgesicherten <b>Username & Passwort</b> (sowie optionalem 6-stelligem 2FA-Code) ein:' +
                '</p>' +
                '<input id="loginUsernameInp" placeholder="Username" style="padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:#141414;color:#fff;font-size:13px" />' +
                '<input id="loginPasswordInp" type="password" placeholder="Passwort" onkeydown="if(event.key===\\'Enter\\')submitWebLogin()" style="padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:#141414;color:#fff;font-size:13px" />' +
                '<div id="login2faWrap" style="display:none;flex-direction:column;gap:6px;padding:8px;border-radius:6px;background:rgba(91,70,245,0.14);border:1px solid rgba(91,70,245,0.4)">' +
                  '<div style="font-size:11.5px;font-weight:700;color:#c4b5fd">🛡️ 2FA-Schutz aktiv: Bitte 6-stelligen Authenticator-Code eingeben</div>' +
                  '<input id="loginTotpInp" placeholder="6-stelliger 2FA-Code (z. B. 123456)" maxlength="6" inputmode="numeric" onkeydown="if(event.key===\\'Enter\\')submitWebLogin()" style="padding:8px 10px;border-radius:6px;border:1px solid rgba(167,139,250,0.5);background:#141414;color:#fff;font-size:14px;letter-spacing:3px;font-weight:800;text-align:center" />' +
                '</div>' +
                '<button class="btn green" onclick="submitWebLogin()">🔑 Mit Username & Passwort einloggen</button>' +
                '<div id="loginModalFeedback" style="font-size:12px;color:#f87171"></div>' +
              '</div>'
            )) +
          '</div>';
        }

        if (canCreateOrUpdateAccount || isAuth) {
          bodyHtml += '<div class="panel-box">' +
            '<div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:6px">🔐 ' + (u.hasPasswordAccount ? 'Account-Zugangsdaten ändern' : 'Account zusätzlich mit Username & Passwort absichern') + '</div>' +
            '<p style="font-size:11.5px;color:#aaa;margin-bottom:10px">Sobald dein Account mit Username & Passwort abgesichert ist, kannst du dich jederzeit auch per Passwort auf jedem Gerät (TV, PC, Browser) einloggen.</p>' +
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
                '<button class="btn danger" onclick="disable2faProtection()">🔓 2FA deaktivieren</button>' +
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

        m.innerHTML = '<div class="modal-backdrop" onclick="if(event.target===this){stopBotCodePollClient();this.parentElement.innerHTML=\\'\\';}"><div class="modal"><div class="modal-body">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h2 style="font-size:18px">🔐 Account, Telegram-Login & 2FA</h2><button class="btn" onclick="stopBotCodePollClient();document.getElementById(\\'modalRoot\\').innerHTML=\\'\\'">✖</button></div>' +
          bodyHtml +
        '</div></div></div>';

        if (!isAuth && activeTab === "telegram") {
          setTimeout(mountTelegramLoginWidgetClient, 40);
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
          '<button type="button" class="btn danger" style="padding:2px 7px;font-size:11px;flex-shrink:0" onclick="clearAllRecentViewed()" title="Gesamten Verlauf leeren">🗑️</button>' +
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
          onlyVipStreams: false,
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
