  // @DEPARTMENT: 08-tma-netflix-frontend | 8. TelePort Mini-App (TMA) Frontend & Auth-Crypto
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

  function timingSafeEqualStr(a, b) {
    const strA = String(a || "");
    const strB = String(b || "");
    if (!strA || !strB || strA.length !== strB.length) return false;
    let diff = 0;
    for (let i = 0; i < strA.length; i++) {
      diff |= (strA.charCodeAt(i) ^ strB.charCodeAt(i));
    }
    return diff === 0;
  }

  async function computeCustomBotWebhookSecret(env, botToken) {
    const cleanToken = String(botToken || "").trim();
    if (!cleanToken) return "";
    const enc = new TextEncoder();
    const signingSecret = await getSessionSigningSecret(env);
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(`custom-wh-v1:${cleanToken}`));
    return bytesToHex(sigBuf).slice(0, 48);
  }

  // Offizielle Telegram Mini App HMAC-SHA256 Validierung von initData (Web Crypto API)
  async function verifyTelegramInitDataHmac(rawInitData, botToken, env = null) {
    if (!rawInitData) return { ok: false, reasonCode: "MISSING_INIT_DATA", error: "Fehlende initData" };
    try {
      const effectiveBotToken = String(botToken || env?.TELEGRAM_BOT_TOKEN || env?.BOT_TOKEN || "").trim();
      const params = new URLSearchParams(String(rawInitData));
      const receivedHash = params.get("hash");
      if (!receivedHash) return { ok: false, reasonCode: "MISSING_HASH", error: "Kein Hash in initData" };

      const userRaw = params.get("user");
      const userObj = userRaw ? JSON.parse(userRaw) : null;

      // Simulator-Sandbox-Unterstützung für lokale Vorschau nur im Entwicklungs-Modus
      const isDevEnv = Boolean(env && (env.ENVIRONMENT === "development" || env.ENABLE_SIMULATOR === "true" || env.DEV_MODE === "true"));
      if (receivedHash === "sim_valid_hmac" && userObj && (String(userObj.id) === "100998877" || String(userObj.id) === "55443322")) {
        if (!isDevEnv) {
          return { ok: false, reasonCode: "SIMULATOR_DISABLED", error: "Simulator-initData ist in der Produktivumgebung deaktiviert." };
        }
        return { ok: true, user: userObj, isSimulator: true };
      }

      if (!effectiveBotToken) return { ok: false, reasonCode: "MISSING_BOT_TOKEN", error: "Fehlendes Bot-Token" };

      // Replay-Schutz: auth_date Validierung (maximal 24 Stunden = 86400 Sekunden alt)
      const authDate = Number(params.get("auth_date") || 0);
      if (!authDate || Math.abs(Math.floor(Date.now() / 1000) - authDate) > 86400) {
        return { ok: false, reasonCode: "INIT_DATA_EXPIRED", error: "Telegram initData ist abgelaufen (> 24h). Bitte Mini-App kurz neu über Telegram öffnen." };
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
      const secretKeyBuf = await crypto.subtle.sign("HMAC", secretKeyMaterial, enc.encode(effectiveBotToken));

      const validationKey = await crypto.subtle.importKey(
        "raw",
        secretKeyBuf,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sigBuf = await crypto.subtle.sign("HMAC", validationKey, enc.encode(dataCheckString));
      const calculatedHash = bytesToHex(sigBuf);

      if (!timingSafeEqualStr(calculatedHash.toLowerCase(), String(receivedHash).toLowerCase())) {
        return { ok: false, reasonCode: "INVALID_SIGNATURE", error: "Ungültige Telegram initData Signatur (prüfe TELEGRAM_BOT_TOKEN im Worker)." };
      }

      if (!userObj || !userObj.id) {
        return { ok: false, reasonCode: "MISSING_USER", error: "Kein gültiges User-Objekt in initData" };
      }
      return { ok: true, user: userObj };
    } catch (e) {
      return { ok: false, reasonCode: "PARSE_ERROR", error: "Fehler bei initData-Prüfung" };
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
      if (!authDate || Math.abs(Math.floor(Date.now() / 1000) - authDate) > 86400) {
        return { ok: false, error: "Telegram Login-Widget Sitzung fehlt oder ist abgelaufen (> 24h). Bitte erneut anmelden." };
      }

      const checkFields = ["auth_date", "first_name", "id", "last_name", "photo_url", "username"];
      const pairs = [];
      for (const k of Object.keys(widgetData).sort()) {
        if (k === "hash" || !checkFields.includes(k)) continue;
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

      if (!timingSafeEqualStr(calculatedHash.toLowerCase(), receivedHash.toLowerCase())) {
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
    return timingSafeEqualStr(hashHex.toLowerCase(), String(expectedHashHex).toLowerCase());
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
    let matched = false;
    for (let step = -windowSteps; step <= windowSteps; step++) {
      const candidate = await computeHotpCode(secretBytes, currentCounter + step);
      if (timingSafeEqualStr(candidate, cleanCode)) matched = true;
    }
    return matched;
  }

  function buildOtpAuthUri(secret, accountLabel, issuer = "TelePort TMA") {
    const cleanIssuer = String(issuer || "TelePort TMA").trim();
    const cleanAccount = String(accountLabel || "User").trim();
    const label = `${encodeURIComponent(cleanIssuer)}:${encodeURIComponent(cleanAccount)}`;
    const otpauthUrl = `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(cleanIssuer)}&algorithm=SHA1&digits=6&period=30`;
    // Kein Drittanbieter-QR-Request (api.qrserver.com), damit das TOTP-Secret niemals extern geleakt wird!
    return { otpauthUrl, qrCodeUrl: "" };
  }

  async function getSessionSigningSecret(env) {
    const configured = String(env?.JWT_SECRET || env?.TELEGRAM_WEBHOOK_SECRET || env?.TELEGRAM_BOT_TOKEN || "").trim();
    if (configured) return configured;
    if (globalThis.__persistentTmaSessionSecret) {
      return globalThis.__persistentTmaSessionSecret;
    }
    const secretKey = "TMA_PERSISTENT_SESSION_SECRET_V1";
    try {
      const fromKv = typeof kvCachedGetRaw === "function"
        ? await kvCachedGetRaw(env, secretKey, "MOVIE_SAVED", { ttlMs: 3600000 }).catch(() => null)
        : null;
      if (fromKv && String(fromKv).trim().length >= 32) {
        globalThis.__persistentTmaSessionSecret = String(fromKv).trim();
        return globalThis.__persistentTmaSessionSecret;
      }
      if (typeof getEntityFromD1 === "function") {
        const fromD1 = await getEntityFromD1(env, secretKey, 3650 * 86400000).catch(() => null);
        if (fromD1 && typeof fromD1.secret === "string" && fromD1.secret.length >= 32) {
          globalThis.__persistentTmaSessionSecret = fromD1.secret;
          return globalThis.__persistentTmaSessionSecret;
        }
      }
    } catch (_e) {}
    const randBytes = new Uint8Array(32);
    crypto.getRandomValues(randBytes);
    const generated = bytesToHex(randBytes);
    globalThis.__persistentTmaSessionSecret = generated;
    try {
      if (typeof kvStageWrite === "function") {
        await kvStageWrite(env, secretKey, generated, { bindingName: "MOVIE_SAVED", flushNow: true });
      }
      if (typeof saveEntityToD1 === "function") {
        await saveEntityToD1(env, secretKey, "config", { secret: generated, createdAt: Date.now() });
      }
    } catch (_e) {}
    return generated;
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
    const signingSecret = await getSessionSigningSecret(env);
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadHex));
    return `${payloadHex}.${bytesToHex(sigBuf)}`;
  }

  async function getVerificationSigningSecrets(env) {
    const primary = await getSessionSigningSecret(env);
    const list = [];
    const pushUnique = (val) => {
      const s = String(val || "").trim();
      if (s && !list.includes(s)) list.push(s);
    };
    pushUnique(primary);
    // Fallback bei nachträglichem Setzen von JWT_SECRET / TELEGRAM_WEBHOOK_SECRET:
    // Bestehende 30-Tage-Sessions bleiben gültig, wenn sie zuvor mit TELEGRAM_BOT_TOKEN signiert wurden.
    pushUnique(env?.JWT_SECRET);
    pushUnique(env?.TELEGRAM_WEBHOOK_SECRET);
    pushUnique(env?.TELEGRAM_BOT_TOKEN);
    pushUnique(env?.BOT_TOKEN);
    return list;
  }

  async function verifyTmaSessionToken(token, env) {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    try {
      const [payloadHex, sigHex] = token.split(".");
      if (!payloadHex || !sigHex) return null;
      const enc = new TextEncoder();
      const secrets = await getVerificationSigningSecrets(env);
      let signatureValid = false;
      for (const signingSecret of secrets) {
        const key = await crypto.subtle.importKey(
          "raw",
          enc.encode(signingSecret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const expectedSigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadHex));
        const expectedSigHex = bytesToHex(expectedSigBuf);
        if (timingSafeEqualStr(expectedSigHex.toLowerCase(), sigHex.toLowerCase())) {
          signatureValid = true;
          break;
        }
      }
      if (!signatureValid) return null;

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
    const failureReasons = [];
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
        if (userProfile && !dbRow && verifiedToken.isAdmin) userProfile.isAdmin = true;
        if (userProfile && !dbRow && verifiedToken.isVip) userProfile.isVip = true;
        return {
          isAuthenticated: true,
          isGuest: false,
          authMethod: verifiedToken.authMethod || "token",
          hasInitData: Boolean(verifiedToken.hasInitData),
          chatId: String(verifiedToken.telegramId),
          user: userProfile,
          authFailureReason: null
        };
      }
      failureReasons.push("invalid_or_expired_bearer_token");
    }

    const rawInitData = request.headers.get("X-Telegram-Init-Data") || "";
    const effectiveBotToken = String(env?.TELEGRAM_BOT_TOKEN || env?.BOT_TOKEN || "").trim();
    if (rawInitData && effectiveBotToken) {
      const verifiedInit = await verifyTelegramInitDataHmac(rawInitData, effectiveBotToken, env);
      if (verifiedInit.ok && verifiedInit.user) {
        const userProfile = await upsertTelegramUserInD1(env, verifiedInit.user);
        return {
          isAuthenticated: true,
          isGuest: false,
          authMethod: "initData",
          hasInitData: true,
          chatId: String(verifiedInit.user.id),
          user: userProfile,
          authFailureReason: null
        };
      }
      failureReasons.push(verifiedInit?.reasonCode ? `initData_${verifiedInit.reasonCode.toLowerCase()}` : "invalid_init_data");
    } else if (rawInitData && !effectiveBotToken) {
      failureReasons.push("missing_bot_token");
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
          user: userProfile,
          authFailureReason: null
        };
      }
      failureReasons.push("invalid_or_expired_launch_token");
    }

    // Kein gültiges initData, kein gültiger Launch-Token & kein eingeloggter Account -> Gast-Modus ohne Speicher!
    return {
      isAuthenticated: false,
      isGuest: true,
      authMethod: "guest",
      hasInitData: false,
      chatId: "guest",
      user: null,
      authFailureReason: failureReasons.length > 0 ? failureReasons.join(",") : "no_credentials"
    };
  }

  // Optionale TMDB-Account-Synchronisierung (Watchlist & Favoriten <-> Bot Merkliste)
  async function pushSingleItemToTmdbWatchlist(env, chatId, typeCode, tmdbId, watchlistState) {
    try {
      const settings = await getUserSettings(env, chatId);
      const sync = settings?.tmdbSync;
      if (!sync || !sync.enabled || !sync.sessionId || !sync.accountId || !isRealTmdbId(tmdbId)) return false;
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
    const localMedia = list.filter(i => (i.contentType === "movie" || i.contentType === "series") && isRealTmdbId(i.tmdbId)).slice(-15);
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
    <meta name="apple-mobile-web-app-title" content="TelePort" />
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
        background: transparent;
        border: none;
        box-shadow: none;
      }
      body[data-theme="light"] .card-poster-wrap {
        background: #e2e8f0;
        border-color: rgba(15, 23, 42, 0.14);
        box-shadow: 0 5px 15px rgba(15, 23, 42, 0.11);
      }
      body[data-theme="light"] .card:hover .card-poster-wrap,
      body[data-theme="light"] .card.spatial-focus .card-poster-wrap,
      body[data-theme="light"] .card:focus-visible .card-poster-wrap {
        border-color: #0284c7;
        box-shadow: 0 0 0 2.5px #0284c7, 0 12px 24px rgba(15, 23, 42, 0.20);
      }
      body[data-theme="light"] .card-title {
        color: #0f172a;
      }
      body[data-theme="light"] .card:hover .card-title,
      body[data-theme="light"] .card.spatial-focus .card-title,
      body[data-theme="light"] .card:focus-visible .card-title {
        color: #0369a1;
      }
      body[data-theme="light"] .card-sub {
        color: #475569;
      }
      body[data-theme="light"] .card-sub-rating {
        color: #b45309;
      }
      body[data-theme="light"] .card-wl-folder-link {
        color: #0369a1 !important;
      }
      body[data-theme="light"] .catalog-focus-info-bar {
        background: rgba(255, 255, 255, 0.94);
        border-color: rgba(2, 132, 199, 0.34);
        color: #0f172a;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
      }
      body[data-theme="light"] .cfi-title {
        color: #0f172a;
      }
      body[data-theme="light"] .cfi-meta {
        color: #475569;
      }
      body[data-theme="light"] .cfi-rating {
        color: #b45309;
      }
      body[data-theme="light"] .cfi-divider {
        background: rgba(15, 23, 42, 0.14);
      }
      body[data-theme="light"] .cfi-hint-btn {
        color: #334155;
      }
      body[data-theme="light"] .cfi-hint-btn:hover {
        background: rgba(2, 132, 199, 0.12);
        color: #0369a1;
      }
      body[data-theme="light"] .cfi-hint-btn kbd {
        background: #f1f5f9;
        border-color: #cbd5e1;
        color: #0f172a;
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
      body[data-theme="cyberpunk"] .card:hover .card-poster-wrap,
      body[data-theme="cyberpunk"] .card.spatial-focus .card-poster-wrap {
        border-color: #00f0ff;
        box-shadow: 0 0 0 2.5px #00f0ff, 0 12px 26px rgba(0, 240, 255, 0.30);
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
      .card {
        scroll-margin-top: var(--sticky-header-offset, 74px);
        scroll-margin-bottom: 76px;
      }
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
        grid-template-columns: repeat(auto-fill, minmax(calc(158px * var(--scale-cover)), 1fr));
        column-gap: calc(14px * var(--scale-cover));
        row-gap: calc(20px * var(--scale-cover));
      }
      body[data-device="mobile"] header {
        padding: calc(6px * var(--scale-menu)) calc(8px * var(--scale-menu));
        gap: 5px;
      }
      body[data-device="mobile"] .brand-logo {
        font-size: calc(15.5px * var(--scale-menu));
      }
      body[data-device="mobile"] .carousel {
        grid-template-columns: repeat(auto-fill, minmax(calc(106px * var(--scale-cover)), 1fr));
        column-gap: calc(10px * var(--scale-cover));
        row-gap: calc(16px * var(--scale-cover));
      }

      /* Gemeinsame 1:1 Kino-Typografie & Button-Variablen für Hero-Slider & Detailansicht */
      :root {
        --cinema-title-size: clamp(24px, calc(36px * var(--scale-text)), 96px);
        --cinema-meta-size: calc(13.5px * var(--scale-text));
        --cinema-desc-size: calc(13.5px * var(--scale-text));
        --cinema-btn-font: calc(13.5px * var(--scale-text));
        --cinema-btn-pad: calc(9.5px * var(--scale-menu)) calc(18px * var(--scale-menu));
      }

      /* Klare Fokus-Markierung für Pfeiltasten, Fire TV / Android TV Fernbedienung, Gamepad & Maus-Hover (Textlinks & .card-Rahmen ausgenommen):
         WICHTIG: outline-offset: -2px + inset Box-Shadow + kein horizontales scale(), damit die linken & rechten Ränder
         in Scrollboxen (Suchvorschläge, Sidebar, Genre-Grid, Cast-Slider, Katalog) NIEMALS überstehen oder abgeschnitten werden! */
      .spatial-focus:where(:not(.card):not(#searchInput):not(.search-scope-select):not(.expandable-desc-box):not(.detail-meta-link):not(.detail-meta-studio):not(.hero-meta-year):not(.hero-meta-genre):not(.modal-genre-link):not(.modal-meta-item.clickable):not(.cinema-pause-center-btn):not(.cinema-overlay-btn):not(.hero-btn-play):not(#heroBtnTrailer):not(.detail-btn-play-white):not(#detailTrailerBtn):not(#detailPrimaryPlayBtn):not(#heroCinemaPlayBtn):not(#detailCinemaPlayBtn):not(.card-hover-play-btn):not(.btn.blue):not(.btn.red):not(.btn.primary):not(.btn.active):not(.btn.hero-primary):not(.page-jump-btn.primary):not(.page-jump-btn.active):not(.media-mode-tab.active-movie):not(.media-mode-tab.active-series)),
      .brand-logo:focus-visible,
      .btn:focus-visible:where(:not(.blue):not(.red):not(.primary):not(.active):not(.hero-primary)),
      .media-mode-tab:focus-visible:where(:not(.active-movie):not(.active-series)),
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

      /* Tastatur-/Controller-Modus aktiv: Mauszeiger ausblenden & ALLE konkurrierenden Maus-Hover-Effekte sofort abschalten */
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
      header:has(.search-bar:focus-within),
      header.mobile-search-expanded {
        z-index: 82;
      }
      .search-bar:focus-within,
      .search-bar.is-search-focused {
        border-color: #38bdf8 !important;
        background: linear-gradient(
          135deg,
          rgba(10, 18, 34, 0.96) 0%,
          rgba(14, 165, 233, 0.24) 52%,
          rgba(10, 18, 34, 0.96) 100%
        );
        box-shadow:
          0 0 0 3px rgba(56, 189, 248, 0.36),
          0 8px 28px rgba(0, 0, 0, 0.68),
          0 0 26px rgba(56, 189, 248, 0.26) !important;
      }
      @keyframes searchFocusAttentionPulse {
        0% {
          box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.72), 0 8px 28px rgba(0, 0, 0, 0.68);
        }
        60% {
          box-shadow: 0 0 0 7px rgba(56, 189, 248, 0.22), 0 8px 30px rgba(14, 165, 233, 0.38);
        }
        100% {
          box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.36), 0 8px 28px rgba(0, 0, 0, 0.68);
        }
      }
      .search-bar.search-focus-pulse {
        animation: searchFocusAttentionPulse 0.55s cubic-bezier(0.22, 1, 0.36, 1);
      }
      #searchInput {
        caret-color: #38bdf8;
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
        border-color: #38bdf8 !important;
        box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.42), 0 6px 22px rgba(0, 0, 0, 0.6) !important;
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
      /* Schmale abgerundete Glas-Laschen an den Seiten der Cover-Übersicht (Links: Menü-Übersicht | Rechts: Schnellmenü) */
      .catalog-edge-trigger-left,
      .catalog-edge-trigger-right {
        position: fixed;
        top: 50%;
        transform: translate3d(0, -50%, 0);
        width: 26px;
        height: 92px;
        z-index: 75;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        color: rgba(226, 232, 240, 0.72);
        background: linear-gradient(155deg, rgba(15, 22, 38, 0.74) 0%, rgba(8, 13, 24, 0.62) 100%);
        backdrop-filter: blur(14px) saturate(165%);
        -webkit-backdrop-filter: blur(14px) saturate(165%);
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 16px rgba(56, 189, 248, 0.12);
        opacity: 0;
        transition:
          width 0.22s cubic-bezier(0.22, 1, 0.36, 1),
          opacity 0.42s cubic-bezier(0.22, 1, 0.36, 1),
          color 0.22s ease,
          border-color 0.22s ease,
          box-shadow 0.22s ease,
          background 0.22s ease;
      }
      .catalog-edge-trigger-left.is-edge-hint-visible,
      .catalog-edge-trigger-right.is-edge-hint-visible {
        opacity: 0.82;
      }
      .catalog-edge-trigger-left {
        left: 0;
        border-left: none;
        border-radius: 0 16px 16px 0;
      }
      .catalog-edge-trigger-right {
        right: 0;
        border-right: none;
        border-radius: 16px 0 0 16px;
      }
      .catalog-edge-trigger-left svg,
      .catalog-edge-trigger-right svg {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), filter 0.22s ease;
      }
      .catalog-edge-trigger-left:hover,
      .catalog-edge-trigger-right:hover {
        width: 32px;
        opacity: 1;
        color: #ffffff;
        background: linear-gradient(155deg, rgba(14, 165, 233, 0.28) 0%, rgba(15, 23, 42, 0.84) 100%);
        border-color: rgba(56, 189, 248, 0.56);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.58), 0 0 22px rgba(56, 189, 248, 0.34);
      }
      .catalog-edge-trigger-left:hover svg {
        transform: translateX(2px);
        filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.7));
      }
      .catalog-edge-trigger-right:hover svg {
        transform: translateX(-2px);
        filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.7));
      }
      /* Dezentes Feedback beim Enter-/OK-Gedrückthalten auf einem Cover (Merkliste / Controller-Trailer) */
      .card.is-enter-holding .card-poster-wrap {
        border-color: #10b981 !important;
        box-shadow: 0 0 0 2.5px #10b981, 0 0 24px rgba(16, 185, 129, 0.48) !important;
        transform: translateY(-2px) scale(0.975) !important;
        transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease !important;
      }
      /* Hintergrund-Scroll-Sperre sobald ein Seitenmenü (Links oder Rechts) aktiv/geöffnet ist */
      body:has(#filterSidebarDrawer.open),
      body:has(#tvQuickJumpElevator:not(.is-dismissed).has-subpanel),
      body:has(#tvQuickJumpElevator:not(.is-dismissed).is-visible),
      body:has(#tvQuickJumpElevator:not(.is-dismissed).is-hover-expanded) {
        overflow: hidden !important;
        overscroll-behavior: none !important;
      }
      .sidebar-body,
      .sidebar-right-subpanel,
      .rm-entries-scroll {
        overscroll-behavior: contain;
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
      .rm-time-filter-group {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 4px;
        border-radius: 9px;
        background: rgba(8, 13, 26, 0.52);
        border: 1px solid rgba(148, 163, 184, 0.22);
      }
      .rm-ctrl-select.rm-ctrl-active,
      .rm-ctrl-input.rm-ctrl-active {
        border-color: rgba(56, 189, 248, 0.85);
        background: rgba(14, 165, 233, 0.16);
        color: #f8fafc;
      }
      .rm-ctrl-select.rm-ctrl-superseded,
      .rm-ctrl-input.rm-ctrl-superseded {
        opacity: 0.56;
        border-style: dashed;
      }
      .rm-year-input-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
      }
      .rm-year-clear-btn {
        position: absolute;
        right: 3px;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        border: none;
        background: rgba(148, 163, 184, 0.28);
        color: #f8fafc;
        font-size: 9.5px;
        font-weight: 900;
        line-height: 1;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }
      .rm-year-clear-btn:hover {
        background: rgba(239, 68, 68, 0.72);
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
      .tv-quick-jump-elevator:not(.is-dismissed).has-subpanel + .elevator-backdrop,
      .tv-quick-jump-elevator:not(.is-dismissed).is-visible + .elevator-backdrop,
      .tv-quick-jump-elevator:not(.is-dismissed).is-hover-expanded + .elevator-backdrop,
      .tv-quick-jump-elevator:not(.is-dismissed):has(.spatial-focus) + .elevator-backdrop {
        opacity: 1;
        pointer-events: auto;
      }
      body.in-hero-slider .tv-quick-jump-elevator,
      body.in-hero-slider .elevator-backdrop,
      body.in-hero-slider .catalog-edge-trigger-left,
      body.in-hero-slider .catalog-edge-trigger-right,
      body:has(#heroStageEl.is-trailer-foreground-mode) .catalog-edge-trigger-left,
      body:has(#heroStageEl.is-trailer-foreground-mode) .catalog-edge-trigger-right,
      body:has(#modalRoot .modal-backdrop) .tv-quick-jump-elevator,
      body:has(#modalRoot .modal-backdrop) .elevator-backdrop,
      body:has(#modalRoot .modal-backdrop) .catalog-edge-trigger-left,
      body:has(#modalRoot .modal-backdrop) .catalog-edge-trigger-right,
      body:has(#filterSidebarDrawer.open) .tv-quick-jump-elevator,
      body:has(#filterSidebarDrawer.open) .elevator-backdrop,
      body:has(#filterSidebarDrawer.open) .catalog-edge-trigger-left,
      body:has(#filterSidebarDrawer.open) .catalog-edge-trigger-right,
      body:has(#tvQuickJumpElevator:not(.is-dismissed).is-visible) .catalog-edge-trigger-right,
      body:has(#tvQuickJumpElevator:not(.is-dismissed).is-hover-expanded) .catalog-edge-trigger-right,
      body:has(#tvQuickJumpElevator:not(.is-dismissed).has-subpanel) .catalog-edge-trigger-right,
      body:has(#customDialogRoot .page-jump-modal-backdrop) .tv-quick-jump-elevator,
      body:has(#customDialogRoot .page-jump-modal-backdrop) .elevator-backdrop,
      body:has(#customDialogRoot .page-jump-modal-backdrop) .catalog-edge-trigger-left,
      body:has(#customDialogRoot .page-jump-modal-backdrop) .catalog-edge-trigger-right,
      body:has(#personSpotlightOverlayRoot .person-spotlight-overlay) .tv-quick-jump-elevator,
      body:has(#personSpotlightOverlayRoot .person-spotlight-overlay) .elevator-backdrop,
      body:has(#personSpotlightOverlayRoot .person-spotlight-overlay) .catalog-edge-trigger-left,
      body:has(#personSpotlightOverlayRoot .person-spotlight-overlay) .catalog-edge-trigger-right {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      .tv-quick-jump-elevator:not(.is-dismissed).has-subpanel,
      .tv-quick-jump-elevator:not(.is-dismissed).is-hover-expanded,
      .tv-quick-jump-elevator:not(.is-dismissed).is-visible,
      .tv-quick-jump-elevator:not(.is-dismissed):has(.spatial-focus) {
        opacity: 1 !important;
        pointer-events: auto !important;
        transform: translate3d(0, -50%, 0) !important;
        border-color: rgba(56, 189, 248, 0.78);
        box-shadow: -16px 16px 44px rgba(0, 0, 0, 0.86), 0 0 26px rgba(14, 165, 233, 0.28);
      }
      .tv-quick-jump-elevator.is-dismissed {
        transform: translate3d(calc(100% + 2px), -50%, 0) !important;
        pointer-events: none !important;
      }
      .tv-quick-jump-elevator.is-dismissed + .elevator-backdrop {
        opacity: 0 !important;
        pointer-events: none !important;
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
        .tv-quick-jump-elevator:not(:focus-within):not(.is-visible):not(.is-hover-expanded):not(.has-subpanel) .tv-elev-label {
          display: none;
        }
        .tv-quick-jump-elevator:not(:focus-within):not(.is-visible):not(.is-hover-expanded):not(.has-subpanel) .tv-elevator-btn {
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
