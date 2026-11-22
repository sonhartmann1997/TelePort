  // @DEPARTMENT: 09-tma-api-worker-export | 9. TMA Backend-API Router, Series-Health & Worker-Export
  // @ANCHOR: TMA_BACKEND_API

  const cachedAppHtmlByOrigin = new Map();
  function computeLightweightEtag(str) {
    let h = 2166136261;
    const s = String(str || "");
    const step = Math.max(1, Math.floor(s.length / 4096));
    for (let i = 0; i < s.length; i += step) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `"tma-${s.length}-${(h >>> 0).toString(36)}"`;
  }

  function attachWorkerDiagHeader(res, path) {
    try {
      if (!res || !String(path || "").startsWith("/api/tma/")) return res;
      const startMs = typeof activeWorkerTelemetry === "object" && activeWorkerTelemetry?.requestStartMs
        ? activeWorkerTelemetry.requestStartMs
        : Date.now();
      const wallMs = Math.max(1, Date.now() - startMs);
      const subs = typeof currentInvocationSubrequests === "number" ? currentInvocationSubrequests : 0;
      const d1Ops = typeof activeWorkerTelemetry === "object" ? (activeWorkerTelemetry.d1OpsCount || 0) : 0;
      const cacheState = (typeof activeWorkerTelemetry === "object" && activeWorkerTelemetry.cacheHit) ? "hit" : "miss";
      const clonedHeaders = new Headers(res.headers);
      clonedHeaders.set("X-Worker-Diag", `sub=${subs};d1=${d1Ops};cache=${cacheState};ms=${wallMs}`);
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: clonedHeaders
      });
    } catch (_e) {
      return res;
    }
  }

  function resolveCleanWorkerOrigin(env, fallbackOrigin = "") {
    const candidates = [env?.WEBHOOK_URL, env?.WEBAPP_URL, fallbackOrigin, "https://teleport.sonhartmann-1997.workers.dev"];
    for (const raw of candidates) {
      const s = String(raw || "").trim();
      if (!s) continue;
      try {
        const parsed = new URL(s.startsWith("http") ? s : `https://${s}`);
        if (parsed.origin && parsed.origin !== "null") return parsed.origin.replace(/\/$/, "");
      } catch (_e) {}
    }
    return String(fallbackOrigin || "https://teleport.sonhartmann-1997.workers.dev").replace(/\/$/, "");
  }

  function buildManualWebhookLinks(origin, webhookUrl, secretToken = "", maxConnections = 8, dropPending = true) {
    const cleanOrigin = String(origin || "").replace(/\/$/, "");
    const cleanWebhookUrl = String(webhookUrl || `${cleanOrigin}/webhook`).trim();
    const cleanSecret = String(secretToken || "").trim();
    const cleanMaxConn = Math.min(40, Math.max(1, Number(maxConnections) || 8));
    const dropBool = Boolean(dropPending);
    const workerParams = new URLSearchParams();
    if (cleanSecret) {
      workerParams.set("secret", cleanSecret);
    }
    if (dropBool) {
      workerParams.set("drop_pending_updates", "1");
    }
    workerParams.set("max_connections", String(cleanMaxConn));
    const manualSetWebhookWorkerUrl = `${cleanOrigin}/setwebhook?${workerParams.toString()}`;
    const tgParams = new URLSearchParams();
    tgParams.set("url", cleanWebhookUrl);
    tgParams.set("max_connections", String(cleanMaxConn));
    tgParams.set("drop_pending_updates", dropBool ? "true" : "false");
    if (cleanSecret) {
      tgParams.set("secret_token", cleanSecret);
    }
    const manualTelegramApiTemplateUrl = `https://api.telegram.org/bot<DEIN_BOT_TOKEN>/setWebhook?${tgParams.toString()}`;
    return {
      webhookUrl: cleanWebhookUrl,
      manualSetWebhookWorkerUrl,
      manualTelegramApiTemplateUrl
    };
  }

  async function handleTmaRequest(request, env, ctx = null) {
    globalThis._activeWorkerEnv = env;
    if (ctx) globalThis._activeWorkerCtx = ctx;
    resetSubrequestBudget();
    const url = new URL(request.url);
    const path = url.pathname;
    if (typeof beginWorkerRequestTelemetry === "function") {
      beginWorkerRequestTelemetry(path);
    }
    const corsHeaders = buildTmaCorsHeaders();

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (path === "/botfather-splash.svg" || path === "/api/tma/botfather-splash.svg") {
      const svgContent = typeof BOTFATHER_SINGLE_PATH_SVG_512 === "string"
        ? BOTFATHER_SINGLE_PATH_SVG_512
        : `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><path fill="#00E5FF" fill-rule="evenodd" d="M210 184 L334 256 L210 328 Z"/></svg>`;
      return new Response(svgContent, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"bot-splashscreen-512x512.svg\"",
          "Cache-Control": "public, max-age=86400"
        }
      });
    }

    if (path === "/favicon.ico" || path === "/favicon.svg") {
      const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" fill="none"><defs><linearGradient id="tpGrad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#38bdf8"/><stop offset="50%" stop-color="#a855f7"/><stop offset="100%" stop-color="#e50914"/></linearGradient></defs><circle cx="14" cy="14" r="11.5" stroke="url(#tpGrad)" stroke-width="2.6" stroke-dasharray="18 5"/><circle cx="14" cy="14" r="7.5" stroke="#38bdf8" stroke-width="1.5" stroke-opacity="0.8"/><path d="M11.8 9.8L18.5 14L11.8 18.2V9.8Z" fill="url(#tpGrad)"/></svg>`;
      return new Response(faviconSvg, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=86400"
        }
      });
    }

    if (path === "/manifest.json" || path === "/manifest.webmanifest") {
      const pwaManifest = {
        name: "TelePort",
        short_name: "TelePort",
        description: "Exklusive Filme, Serien & Trailer direkt im Stream.",
        start_url: "/app",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#060a14",
        theme_color: "#060a14",
        icons: [
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      };
      return new Response(JSON.stringify(pwaManifest, null, 2), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/manifest+json; charset=utf-8",
          "Cache-Control": "public, max-age=86400"
        }
      });
    }

    if (path === "/sw.js" || path === "/service-worker.js") {
      const swCode = `const CACHE_NAME="teleport-v2";const IMG_CACHE="teleport-img-v2";const MAX_IMG=150;const APP_SHELL=["/app","/favicon.svg","/manifest.json"];self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting()))});self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE_NAME&&x!==IMG_CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});async function putImgCapped(req,res){try{const c=await caches.open(IMG_CACHE);await c.put(req,res);const ks=await c.keys();if(ks.length>MAX_IMG){await Promise.all(ks.slice(0,ks.length-MAX_IMG).map(k=>c.delete(k)))}}catch(_e){}}self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);if(u.origin===self.location.origin&&(u.pathname==="/"||u.pathname==="/app"||u.pathname==="/miniapp"||u.pathname==="/favicon.svg"||u.pathname==="/manifest.json")){e.respondWith(fetch(r).then(nr=>{if(nr&&nr.status===200){const cl=nr.clone();e.waitUntil(caches.open(CACHE_NAME).then(c=>c.put(r,cl)).catch(()=>{}))}return nr}).catch(()=>caches.match(r).then(m=>m||caches.match("/app")).then(m=>m||Response.error())));return}if(u.hostname==="image.tmdb.org"){e.respondWith(caches.match(r).then(cached=>{if(cached)return cached;return fetch(r).then(nr=>{if(nr&&(nr.status===200||nr.type==="opaque")){e.waitUntil(putImgCapped(r,nr.clone()))}return nr}).catch(()=>caches.match("/favicon.svg").then(m=>m||Response.error()))}));return}});`;
      return new Response(swCode, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/javascript; charset=utf-8",
          "Service-Worker-Allowed": "/",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        }
      });
    }

    if (path === "/" || path === "/app" || path === "/miniapp") {
      let cachedEntry = cachedAppHtmlByOrigin.get(url.origin);
      if (!cachedEntry) {
        const html = renderNetflixMiniAppHtml(url.origin);
        cachedEntry = { html, etag: computeLightweightEtag(html) };
        if (cachedAppHtmlByOrigin.size > 6) cachedAppHtmlByOrigin.clear();
        cachedAppHtmlByOrigin.set(url.origin, cachedEntry);
      }
      const ifNoneMatch = String(request.headers.get("If-None-Match") || "").trim();
      if (ifNoneMatch && ifNoneMatch === cachedEntry.etag) {
        return new Response(null, {
          status: 304,
          headers: {
            "ETag": cachedEntry.etag,
            "Cache-Control": "public, max-age=60, stale-while-revalidate=300"
          }
        });
      }
      return new Response(cachedEntry.html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "ETag": cachedEntry.etag,
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300"
        }
      });
    }

    // Zero-Auth Public Fast-Paths (keine Auth/D1-User/KV-Settings nötig + 24h Cloudflare Edge Cache!)
    if (path === "/api/tma/logo" && request.method === "GET") {
      const edgeCache = (typeof caches !== "undefined" && caches && caches.default) ? caches.default : null;
      const cacheKeyReq = edgeCache ? new Request(url.toString(), { method: "GET" }) : null;
      if (edgeCache && cacheKeyReq) {
        try {
          const hit = await edgeCache.match(cacheKeyReq);
          if (hit) {
            if (typeof activeWorkerTelemetry === "object" && activeWorkerTelemetry) activeWorkerTelemetry.cacheHit = true;
            return hit;
          }
        } catch (_e) {}
      }
      const typeCode = url.searchParams.get("type") === "s" ? "s" : "m";
      const id = String(url.searchParams.get("id") || "").trim();
      if (!/^\d+$/.test(id)) {
        return new Response(JSON.stringify({ ok: false, error: "Ungültige Medien-ID." }), { status: 400, headers: corsHeaders });
      }
      const logoPath = await resolveMediaClearLogoPath(env, typeCode, id, "");
      const res = new Response(JSON.stringify({ ok: true, id: Number(id), typeCode, logo_path: logoPath || "" }), {
        status: 200,
        headers: { ...corsHeaders, "Cache-Control": "public, max-age=86400" }
      });
      if (edgeCache && cacheKeyReq) {
        scheduleBackgroundWork(() => edgeCache.put(cacheKeyReq, res.clone()));
      }
      return res;
    }

    if (path === "/api/tma/logos" && request.method === "GET") {
      const edgeCache = (typeof caches !== "undefined" && caches && caches.default) ? caches.default : null;
      const cacheKeyReq = edgeCache ? new Request(url.toString(), { method: "GET" }) : null;
      if (edgeCache && cacheKeyReq) {
        try {
          const hit = await edgeCache.match(cacheKeyReq);
          if (hit) {
            if (typeof activeWorkerTelemetry === "object" && activeWorkerTelemetry) activeWorkerTelemetry.cacheHit = true;
            return hit;
          }
        } catch (_e) {}
      }
      const rawItems = String(url.searchParams.get("items") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 8);
      const parsed = [];
      for (const token of rawItems) {
        const m = token.match(/^([ms])_(\d+)$/);
        if (m) parsed.push({ key: token, typeCode: m[1], id: Number(m[2]) });
      }
      const logosOut = {};
      if (parsed.length > 0) {
        const batchMap = typeof getClearLogosBatchFromD1 === "function"
          ? await getClearLogosBatchFromD1(env, parsed, "m").catch(() => new Map())
          : new Map();
        const stillMissing = [];
        for (const p of parsed) {
          if (batchMap.has(p.key)) {
            logosOut[p.key] = batchMap.get(p.key) || "";
          } else {
            stillMissing.push(p);
          }
        }
        // Max. 4 uncached TMDb /images Abrufe in diesem Batch (innerhalb des Free-Plan-Budgets)
        if (stillMissing.length > 0 && hasSubrequestBudget(30)) {
          await Promise.all(stillMissing.slice(0, 4).map(async (p) => {
            if (!hasSubrequestBudget(34)) return;
            const lp = await resolveMediaClearLogoPath(env, p.typeCode, p.id, "").catch(() => "");
            logosOut[p.key] = lp || "";
          }));
        }
      }
      const res = new Response(JSON.stringify({ ok: true, logos: logosOut }), {
        status: 200,
        headers: { ...corsHeaders, "Cache-Control": "public, max-age=86400" }
      });
      if (edgeCache && cacheKeyReq) {
        scheduleBackgroundWork(() => edgeCache.put(cacheKeyReq, res.clone()));
      }
      return res;
    }

    try {
      // Zentrale Sicherheits- & Auth-Weiche:
      // chatId stammt NIEMALS aus URL-Parametern (?chatId=...), sondern ausschließlich
      // aus kryptografisch verifiziertem Telegram initData oder einem signierten Account-Session-Token!
      const auth = await resolveTmaAuthContext(request, env);
      const chatId = auth.isAuthenticated ? auth.chatId : "guest";
      // VIP-Zugriffsweiche: Qualitäten & Streams werden serverseitig ausschließlich für VIP-Mitglieder (oder Admins) ausgeliefert!
      const hasVipStreamAccess = Boolean(auth.isAuthenticated && (auth.user?.isVip || auth.user?.isAdmin));
      const ALLOWED_CLIENT_SETTINGS_KEYS = [
        "filtersActive", "showUnreleased", "onlyVipStreams",
        "includedFsk", "excludedFsk",
        "includedGenres", "excludedGenres",
        "includedEras", "excludedEras",
        "includedStudios", "excludedStudios",
        "includedPlatforms", "excludedPlatforms",
        "uiScale", "trailerProvider"
      ];
      const pickAllowedClientSettings = (rawObj) => {
        if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) return null;
        const sanitized = {};
        for (const k of ALLOWED_CLIENT_SETTINGS_KEYS) {
          if (Object.prototype.hasOwnProperty.call(rawObj, k) && rawObj[k] !== undefined) {
            sanitized[k] = rawObj[k];
          }
        }
        return Object.keys(sanitized).length > 0 ? sanitized : null;
      };
      const sanitizeSettingsForClient = (sObj) => {
        if (!sObj || typeof sObj !== "object") return sObj;
        const copy = { ...sObj };
        if (copy.tmdbSync && typeof copy.tmdbSync === "object") {
          const { sessionId: _hiddenSessionId, ...safeSync } = copy.tmdbSync;
          copy.tmdbSync = safeSync;
        }
        return copy;
      };
      let clientHeaderSettings = null;
      try {
        const rawHdr = request.headers.get("X-Tma-Settings");
        if (rawHdr && rawHdr.length <= 4096) {
          clientHeaderSettings = pickAllowedClientSettings(JSON.parse(decodeURIComponent(rawHdr)));
        }
      } catch (e) {}
      const isLocalSandboxRuntime = typeof window !== "undefined" && typeof document !== "undefined";
      const guestMemSettings = isLocalSandboxRuntime ? (memoryFallback.get("settings_guest") || {}) : {};
      const skipUserSettingsRead =
        path === "/api/tma/admin/import-batch" ||
        path === "/api/tma/admin/import-logs" ||
        path === "/api/tma/admin/import-checkpoint" ||
        path === "/api/tma/admin/catalog-preseed" ||
        path === "/api/tma/auth/init" ||
        path === "/api/tma/auth/me" ||
        path === "/api/tma/anti-spam-queue";
      const baseUserSettings = (auth.isAuthenticated && !skipUserSettingsRead)
        ? await getUserSettings(env, chatId)
        : { filtersActive: true, showUnreleased: false, ...guestMemSettings };
      const settings = (clientHeaderSettings && typeof clientHeaderSettings === "object")
        ? { ...baseUserSettings, ...clientHeaderSettings }
        : baseUserSettings;
      if (clientHeaderSettings && typeof clientHeaderSettings === "object" && path === "/api/tma/discover") {
        // Key-reihenfolge-unabhängiger Vergleich (verhindert blinde Writes bei jedem Discover-Aufruf!)
        const cmpSer = typeof stableJsonStringify === "function" ? stableJsonStringify : JSON.stringify;
        const settingsChanged = cmpSer(settings) !== cmpSer(baseUserSettings);
        if (settingsChanged) {
          if (auth.isAuthenticated) {
            scheduleBackgroundWork(() => saveUserSettings(env, chatId, settings));
          } else if (isLocalSandboxRuntime) {
            memoryFallback.set("settings_guest", settings);
          }
        }
      }

      // 1. Telegram initData & signierter Chat-Button Launch-Token (24h) Erst-Authentifizierung
      if (path === "/api/tma/auth/init" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const rawInit = String(body.initData || request.headers.get("X-Telegram-Init-Data") || "").trim();
        const rawLaunch = String(body.tgLaunch || request.headers.get("X-Telegram-Launch-Token") || url.searchParams.get("tgLaunch") || "").trim();

        if (!rawInit && !rawLaunch) {
          return new Response(JSON.stringify({ ok: false, error: "Keine Telegram initData oder Launch-Token übermittelt." }), { status: 400, headers: corsHeaders });
        }

        const effBotToken = String(env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || "").trim();
        if (rawInit) {
          const verified = await verifyTelegramInitDataHmac(rawInit, effBotToken, env);
          if (verified.ok && verified.user) {
            const userProfile = await upsertTelegramUserInD1(env, verified.user);
            const sessionToken = await signTmaSessionToken({
              telegramId: String(verified.user.id),
              tgUsername: verified.user.username || "",
              firstName: verified.user.first_name || "",
              isAdmin: Boolean(userProfile?.isAdmin),
              isVip: Boolean(userProfile?.isVip),
              authMethod: "initData",
              hasInitData: true
            }, env);
            return new Response(JSON.stringify({
              ok: true,
              isAuthenticated: true,
              authMethod: "initData",
              user: userProfile,
              sessionToken
            }), { status: 200, headers: corsHeaders });
          }
          if (!rawLaunch) {
            return new Response(JSON.stringify({
              ok: false,
              code: verified.reasonCode || "INIT_DATA_INVALID",
              reasonCode: verified.reasonCode || "INIT_DATA_INVALID",
              error: verified.error || "initData Validierung fehlgeschlagen."
            }), { status: 401, headers: corsHeaders });
          }
        }

        if (rawLaunch && typeof verifyTelegramChatLaunchToken === "function") {
          const verifiedLaunch = await verifyTelegramChatLaunchToken(rawLaunch, env);
          if (verifiedLaunch && verifiedLaunch.ok && verifiedLaunch.chatId) {
            const existingRow = await getUserByTelegramIdFromD1(env, verifiedLaunch.chatId).catch(() => null);
            const userProfile = await upsertTelegramUserInD1(env, {
              id: Number(verifiedLaunch.chatId),
              first_name: existingRow?.first_name || "Telegram User",
              last_name: existingRow?.last_name || "",
              username: existingRow?.tg_username || ""
            });
            const sessionToken = await signTmaSessionToken({
              telegramId: String(verifiedLaunch.chatId),
              tgUsername: userProfile?.tgUsername || "",
              firstName: userProfile?.firstName || "Telegram User",
              isAdmin: Boolean(userProfile?.isAdmin),
              isVip: Boolean(userProfile?.isVip),
              authMethod: "tgLaunch",
              hasInitData: true
            }, env);
            return new Response(JSON.stringify({
              ok: true,
              isAuthenticated: true,
              authMethod: "tgLaunch",
              user: userProfile,
              sessionToken
            }), { status: 200, headers: corsHeaders });
          }
          return new Response(JSON.stringify({
            ok: false,
            code: "LAUNCH_TOKEN_INVALID",
            reasonCode: "LAUNCH_TOKEN_INVALID",
            error: verifiedLaunch?.error || "Chat-Button Launch-Token abgelaufen oder ungültig."
          }), { status: 401, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ ok: false, code: "AUTH_FAILED", error: "Authentifizierung fehlgeschlagen." }), { status: 401, headers: corsHeaders });
      }

      // 2. Aktuellen Session-Status abfragen
      if (path === "/api/tma/auth/me" && request.method === "GET") {
        return new Response(JSON.stringify({
          ok: true,
          isAuthenticated: auth.isAuthenticated,
          isGuest: auth.isGuest,
          hasInitData: auth.hasInitData,
          authMethod: auth.authMethod || "guest",
          authFailureReason: auth.authFailureReason || "",
          user: auth.user
        }), { status: 200, headers: corsHeaders });
      }

      // 2b. Offizielles Telegram Login Widget (HMAC-SHA256 mit SHA256(BOT_TOKEN))
      if (path === "/api/tma/auth/telegram-widget" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const widgetData = (body && typeof body.user === "object" && body.user !== null) ? body.user : body;
        const verified = await verifyTelegramLoginWidgetHmac(widgetData, env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN, env);
        if (!verified.ok || !verified.user) {
          return new Response(JSON.stringify({ ok: false, error: verified.error || "Telegram Login-Widget Validierung fehlgeschlagen." }), { status: 401, headers: corsHeaders });
        }
        const userProfile = await upsertTelegramUserInD1(env, verified.user);
        const sessionToken = await signTmaSessionToken({
          telegramId: String(verified.user.id),
          tgUsername: verified.user.username || "",
          firstName: verified.user.first_name || "",
          isAdmin: Boolean(userProfile?.isAdmin),
          isVip: Boolean(userProfile?.isVip),
          authMethod: "telegram_widget",
          hasInitData: true
        }, env);
        return new Response(JSON.stringify({
          ok: true,
          isAuthenticated: true,
          user: userProfile,
          sessionToken
        }), { status: 200, headers: corsHeaders });
      }

      // 2c. 1-Klick Bot-App-Bestätigung & 6-stelliger Login-Code für Browser, PC & Smart-TV
      if (path === "/api/tma/auth/bot-code" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const action = String(body.action || "create").trim();
        const isLocalSandbox = typeof window !== "undefined" && typeof document !== "undefined";
        const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));

        if (action === "create") {
          const randIdBytes = new Uint8Array(12);
          crypto.getRandomValues(randIdBytes);
          const challengeId = `wac_${bytesToHex(randIdBytes)}`;
          const randCodeBuf = new Uint32Array(1);
          crypto.getRandomValues(randCodeBuf);
          const code = String(100000 + (randCodeBuf[0] % 900000));
          const expiresAt = Date.now() + 300000; // 5 Minuten gültig
          const botUsername = (await tgApi(env).getBotUsername(env).catch(() => "")) || "";
          const challengeObj = {
            challengeId,
            code,
            status: "pending",
            createdAt: Date.now(),
            expiresAt,
            user: null
          };
          memoryFallback.set(`webauth_id_${challengeId}`, challengeObj);
          memoryFallback.set(`webauth_code_${code}`, challengeId);
          try {
            if (hasD1 && typeof saveEntityToD1 === "function") {
              // D1-first: 0 KV-Writes & sofortige starke Konsistenz über alle Edge-Server (kein 60s KV-Lag!)
              await Promise.all([
                saveEntityToD1(env, `webauth_id_${challengeId}`, "webauth", challengeObj),
                saveEntityToD1(env, `webauth_code_${code}`, "webauth", { challengeId, expiresAt })
              ]);
            } else {
              await kvStageWrite(env, `webauth_id_${challengeId}`, challengeObj, { bindingName: "MOVIE_SAVED", expirationTtl: 300, periodicOnly: false, flushNow: true });
              await kvStageWrite(env, `webauth_code_${code}`, challengeId, { bindingName: "MOVIE_SAVED", expirationTtl: 300, periodicOnly: false, flushNow: true });
            }
          } catch (e) {}
          const deepLink = botUsername
            ? `https://t.me/${botUsername.replace(/^@/, "")}?start=webauth_${challengeId}`
            : "";
          return new Response(JSON.stringify({
            ok: true,
            challengeId,
            code,
            botUsername: botUsername.replace(/^@/, ""),
            deepLink,
            expiresAt,
            canSimulateConfirm: isLocalSandbox
          }), { status: 200, headers: corsHeaders });
        }

        if (action === "simulate_confirm") {
          // Kritische Sicherheitssperre: Simulator-Auto-Login darf NIEMALS auf dem Live-Cloudflare-Worker laufen!
          if (!isLocalSandbox) {
            return new Response(JSON.stringify({
              ok: false,
              error: "Simulator-Bestätigung ist im Produktiv-Worker aus Sicherheitsgründen deaktiviert."
            }), { status: 403, headers: corsHeaders });
          }
          const challengeId = String(body.challengeId || "").trim();
          let challengeObj = memoryFallback.get(`webauth_id_${challengeId}`);
          if (!challengeObj) {
            const raw = await kvCachedGetRaw(env, `webauth_id_${challengeId}`, "MOVIE_SAVED", { bypassMemoryCache: true }).catch(() => null);
            if (raw) { try { challengeObj = JSON.parse(raw); } catch (e) {} }
          }
          if (!challengeObj) {
            return new Response(JSON.stringify({ ok: false, error: "Challenge nicht gefunden." }), { status: 404, headers: corsHeaders });
          }
          challengeObj.status = "confirmed";
          challengeObj.user = {
            id: 100998877,
            first_name: "Admin",
            username: "teleport_admin"
          };
          memoryFallback.set(`webauth_id_${challengeId}`, challengeObj);
          try {
            await kvStageWrite(env, `webauth_id_${challengeId}`, challengeObj, { bindingName: "MOVIE_SAVED", expirationTtl: 300, periodicOnly: false, flushNow: true });
          } catch (e) {}
          return new Response(JSON.stringify({ ok: true, status: "confirmed" }), { status: 200, headers: corsHeaders });
        }

        if (action === "poll") {
          const challengeId = String(body.challengeId || "").trim();
          if (!challengeId) {
            return new Response(JSON.stringify({ ok: false, error: "challengeId fehlt" }), { status: 400, headers: corsHeaders });
          }
          // Auf Edge-Servern IMMER frisch aus D1 (stark konsistent!) bzw. KV lesen
          let challengeObj = null;
          if (!isLocalSandbox) {
            if (hasD1 && typeof getEntityFromD1 === "function") {
              challengeObj = await getEntityFromD1(env, `webauth_id_${challengeId}`, 360000, { bypassMemoryCache: true }).catch(() => null);
            }
            if (!challengeObj) {
              const raw = await kvCachedGetRaw(env, `webauth_id_${challengeId}`, "MOVIE_SAVED", { bypassMemoryCache: true }).catch(() => null);
              if (raw) { try { challengeObj = JSON.parse(raw); } catch (e) {} }
            }
          }
          if (!challengeObj) {
            challengeObj = memoryFallback.get(`webauth_id_${challengeId}`);
          }
          if (!challengeObj || Date.now() > Number(challengeObj.expiresAt || 0)) {
            return new Response(JSON.stringify({ ok: true, status: "expired" }), { status: 200, headers: corsHeaders });
          }
          if (challengeObj.status === "confirmed" && challengeObj.user && challengeObj.user.id) {
            const userProfile = await upsertTelegramUserInD1(env, challengeObj.user);
            const sessionToken = await signTmaSessionToken({
              telegramId: String(challengeObj.user.id),
              tgUsername: challengeObj.user.username || "",
              firstName: challengeObj.user.first_name || "",
              isAdmin: Boolean(userProfile?.isAdmin),
              isVip: Boolean(userProfile?.isVip),
              authMethod: "bot_code",
              hasInitData: true
            }, env);
            memoryFallback.delete(`webauth_id_${challengeId}`);
            if (challengeObj.code) memoryFallback.delete(`webauth_code_${challengeObj.code}`);
            // Einmal-Verwendung: Challenge nach erfolgreichem Login sofort löschen (Replay-Schutz!)
            if (hasD1 && typeof deleteEntityFromD1 === "function") {
              await deleteEntityFromD1(env, `webauth_id_${challengeId}`).catch(() => {});
              if (challengeObj.code) {
                await deleteEntityFromD1(env, `webauth_code_${challengeObj.code}`).catch(() => {});
              }
            } else {
              await kvStageDelete(env, `webauth_id_${challengeId}`, "MOVIE_SAVED").catch(() => {});
              if (challengeObj.code) {
                await kvStageDelete(env, `webauth_code_${challengeObj.code}`, "MOVIE_SAVED").catch(() => {});
              }
            }
            return new Response(JSON.stringify({
              ok: true,
              status: "confirmed",
              isAuthenticated: true,
              user: userProfile,
              sessionToken
            }), { status: 200, headers: corsHeaders });
          }
          return new Response(JSON.stringify({ ok: true, status: "pending" }), { status: 200, headers: corsHeaders });
        }
      }

      // 3. Web-Login (Username + Passwort + optionaler TOTP 2FA Code) – inkl. Brute-Force-Schutz (max. 8 Fehlversuche / 10 Min.)
      if (path === "/api/tma/auth/login" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const totpCode = String(body.totpCode || "").trim();
        if (!username || !password) {
          return new Response(JSON.stringify({ ok: false, error: "Bitte Username und Passwort eingeben." }), { status: 400, headers: corsHeaders });
        }
        const clientIp = String(request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown").split(",")[0].trim().slice(0, 64);
        const normUserKey = username.toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40) || "empty";
        const rlKey = `login_rl_${normUserKey}_${clientIp}`;
        const rlWindowMs = 10 * 60 * 1000;
        const nowRl = Date.now();
        const memRlEntry = memoryFallback.get(rlKey);
        let rlEntry = (memRlEntry && nowRl <= Number(memRlEntry.resetAt || 0)) ? memRlEntry : null;
        if (typeof getEntityFromD1 === "function") {
          const d1Rl = await getEntityFromD1(env, rlKey, rlWindowMs, { bypassMemoryCache: true }).catch(() => null);
          if (d1Rl && nowRl <= Number(d1Rl.resetAt || 0)) {
            if (!rlEntry || Number(d1Rl.count || 0) >= Number(rlEntry.count || 0)) {
              rlEntry = d1Rl;
            }
          }
        }
        if (rlEntry && nowRl <= Number(rlEntry.resetAt || 0) && Number(rlEntry.count || 0) >= 8) {
          const waitSec = Math.max(10, Math.ceil((Number(rlEntry.resetAt) - nowRl) / 1000));
          return new Response(JSON.stringify({
            ok: false,
            error: `Zu viele fehlgeschlagene Anmeldeversuche. Bitte warte ${waitSec} Sekunden.`
          }), { status: 429, headers: { ...corsHeaders, "Retry-After": String(waitSec) } });
        }
        const recordLoginFailure = async () => {
          const nextEntry = (rlEntry && nowRl <= Number(rlEntry.resetAt || 0))
            ? { count: Number(rlEntry.count || 0) + 1, resetAt: Number(rlEntry.resetAt) }
            : { count: 1, resetAt: nowRl + rlWindowMs };
          memoryFallback.set(rlKey, nextEntry);
          if (typeof saveEntityToD1 === "function") {
            await saveEntityToD1(env, rlKey, "auth_rl", nextEntry).catch(() => {});
          }
        };
        const clearLoginFailures = async () => {
          memoryFallback.delete(rlKey);
          if (typeof deleteEntityFromD1 === "function") {
            await deleteEntityFromD1(env, rlKey).catch(() => {});
          }
        };

        const userRow = await getUserByCustomUsernameFromD1(env, username);
        if (!userRow || !userRow.password_hash || !userRow.password_salt) {
          await recordLoginFailure();
          return new Response(JSON.stringify({ ok: false, error: "Ungültiger Username oder Passwort." }), { status: 401, headers: corsHeaders });
        }
        const validPw = await verifyPasswordPbkdf2(password, userRow.password_salt, userRow.password_hash);
        if (!validPw) {
          await recordLoginFailure();
          return new Response(JSON.stringify({ ok: false, error: "Ungültiger Username oder Passwort." }), { status: 401, headers: corsHeaders });
        }
        if (Number(userRow.totp_enabled) === 1 && userRow.totp_secret) {
          if (!totpCode) {
            return new Response(JSON.stringify({
              ok: false,
              requires2fa: true,
              message: "Bitte 6-stelligen 2FA-Code aus deiner Authenticator-App eingeben."
            }), { status: 200, headers: corsHeaders });
          }
          const valid2fa = await verifyTotpCode(userRow.totp_secret, totpCode);
          if (!valid2fa) {
            await recordLoginFailure();
            return new Response(JSON.stringify({
              ok: false,
              requires2fa: true,
              error: "Ungültiger 6-stelliger 2FA-Code. Bitte erneut prüfen."
            }), { status: 200, headers: corsHeaders });
          }
        }
        await clearLoginFailures();
        const userProfile = formatUserRowForClient(userRow, env);
        const sessionToken = await signTmaSessionToken({
          telegramId: String(userRow.telegram_id),
          tgUsername: userRow.tg_username || "",
          firstName: userRow.first_name || "",
          isAdmin: Boolean(userProfile?.isAdmin),
          isVip: Boolean(userProfile?.isVip),
          authMethod: "password",
          hasInitData: false
        }, env);
        return new Response(JSON.stringify({
          ok: true,
          isAuthenticated: true,
          user: userProfile,
          sessionToken
        }), { status: 200, headers: corsHeaders });
      }

      // 4. Account absichern (Username + Passwort erstellen/ändern) -> NUR mit gültigem Telegram initData (oder bereits verifiziertem Account)!
      if (path === "/api/tma/auth/set-account" && request.method === "POST") {
        if (!auth.isAuthenticated || !auth.user) {
          return new Response(JSON.stringify({
            ok: false,
            error: "Account-Erstellung ohne Telegram initData ist gesperrt. Bitte öffne die Mini-App einmal über den Telegram-Bot."
          }), { status: 403, headers: corsHeaders });
        }
        if (!auth.hasInitData && !auth.user.hasPasswordAccount) {
          return new Response(JSON.stringify({
            ok: false,
            error: "Erstmaliges Erstellen eines Accounts erfordert zwingend Telegram initData."
          }), { status: 403, headers: corsHeaders });
        }
        const body = await request.json().catch(() => ({}));
        const customUsername = String(body.customUsername || "").trim();
        const password = String(body.password || "");
        if (password.length < 6) {
          return new Response(JSON.stringify({ ok: false, error: "Das Passwort muss mindestens 6 Zeichen lang sein." }), { status: 400, headers: corsHeaders });
        }
        const { hashHex, saltHex } = await hashPasswordPbkdf2(password);
        const saved = await setCustomCredentialsInD1(env, auth.chatId, customUsername, hashHex, saltHex);
        if (!saved.ok) {
          return new Response(JSON.stringify(saved), { status: 400, headers: corsHeaders });
        }
        const sessionToken = await signTmaSessionToken({
          telegramId: String(auth.chatId),
          tgUsername: saved.user.tgUsername || "",
          firstName: saved.user.firstName || "",
          isAdmin: Boolean(saved.user?.isAdmin || auth.user?.isAdmin),
          isVip: Boolean(saved.user?.isVip || auth.user?.isVip),
          authMethod: "password",
          hasInitData: auth.hasInitData
        }, env);
        return new Response(JSON.stringify({
          ok: true,
          user: saved.user,
          sessionToken
        }), { status: 200, headers: corsHeaders });
      }

      // 4b. TOTP 2FA (Google Authenticator / Authy) Setup, Aktivierung & Deaktivierung
      if (path === "/api/tma/auth/2fa" && request.method === "POST") {
        if (!auth.isAuthenticated || !auth.user) {
          return new Response(JSON.stringify({ ok: false, error: "Nicht authentifiziert." }), { status: 403, headers: corsHeaders });
        }
        const body = await request.json().catch(() => ({}));
        const action = String(body.action || "");
        const userRow = await getUserByTelegramIdFromD1(env, auth.chatId, true);

        if (action === "setup") {
          if (Number(userRow?.totp_enabled) === 1 && userRow?.totp_secret) {
            return new Response(JSON.stringify({
              ok: false,
              error: "2FA ist bereits aktiv. Bitte deaktiviere 2FA zuerst mit deinem aktuellen 6-stelligen Code."
            }), { status: 400, headers: corsHeaders });
          }
          const newSecret = generateBase32TotpSecret(32);
          const savedSetup = await saveUserTotpInD1(env, auth.chatId, newSecret, false);
          if (!savedSetup) {
            return new Response(JSON.stringify({ ok: false, error: "2FA-Schlüssel konnte nicht in der Datenbank gespeichert werden." }), { status: 500, headers: corsHeaders });
          }
          const accountLabel = auth.user.customUsername || auth.user.tgUsername || `TG-${auth.chatId}`;
          const { otpauthUrl, qrCodeUrl } = buildOtpAuthUri(newSecret, accountLabel, "TelePort TMA");
          return new Response(JSON.stringify({
            ok: true,
            secret: newSecret,
            otpauthUrl,
            qrCodeUrl
          }), { status: 200, headers: corsHeaders });
        }

        if (action === "enable") {
          const code = String(body.code || "").trim();
          const pendingSecret = userRow?.totp_secret || "";
          if (!pendingSecret) {
            return new Response(JSON.stringify({ ok: false, error: "Bitte zuerst einen 2FA-Setup-Schlüssel generieren." }), { status: 400, headers: corsHeaders });
          }
          const valid = await verifyTotpCode(pendingSecret, code);
          if (!valid) {
            return new Response(JSON.stringify({ ok: false, error: "Der eingegebene 6-stellige Code stimmt nicht überein." }), { status: 400, headers: corsHeaders });
          }
          const updatedUser = await saveUserTotpInD1(env, auth.chatId, pendingSecret, true);
          if (!updatedUser) {
            return new Response(JSON.stringify({ ok: false, error: "2FA-Status konnte nicht dauerhaft gespeichert werden." }), { status: 500, headers: corsHeaders });
          }
          return new Response(JSON.stringify({ ok: true, user: updatedUser }), { status: 200, headers: corsHeaders });
        }

        if (action === "disable") {
          const code = String(body.code || "").trim();
          if (userRow?.totp_secret && Number(userRow?.totp_enabled) === 1 && !auth.hasInitData) {
            const valid = await verifyTotpCode(userRow.totp_secret, code);
            if (!valid) {
              return new Response(JSON.stringify({ ok: false, error: "Bitte gültigen 6-stelligen 2FA-Code zur Deaktivierung eingeben." }), { status: 400, headers: corsHeaders });
            }
          }
          const updatedUser = await saveUserTotpInD1(env, auth.chatId, null, false);
          if (!updatedUser) {
            return new Response(JSON.stringify({ ok: false, error: "2FA-Deaktivierung konnte nicht dauerhaft gespeichert werden." }), { status: 500, headers: corsHeaders });
          }
          return new Response(JSON.stringify({ ok: true, user: updatedUser }), { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ ok: false, error: "Unbekannte 2FA-Aktion." }), { status: 400, headers: corsHeaders });
      }

      // 5. Admin-Panel Endpunkte (User-Liste, VIP-Status Toggle, Smart Playlist Manager, Film/Serien CRUD & 100k+ Backup-Importer)
      if (path.startsWith("/api/tma/admin/")) {
        const configuredAdminSet = typeof getConfiguredAdminIdSet === "function" ? getConfiguredAdminIdSet(env) : new Set();
        if (!auth.isAuthenticated) {
          return new Response(JSON.stringify({
            ok: false,
            code: "AUTH_REQUIRED",
            error: "Sitzung abgelaufen oder nicht angemeldet. Bitte neu einloggen.",
            diagnostics: {
              telegramId: null,
              authMethod: auth.authMethod || "guest",
              authFailureReason: auth.authFailureReason || "no_credentials",
              hasAdminEnvConfigured: configuredAdminSet.size > 0
            }
          }), { status: 401, headers: corsHeaders });
        }
        if (!auth.user?.isAdmin) {
          return new Response(JSON.stringify({
            ok: false,
            code: "ADMIN_REQUIRED",
            error: "Zugriff verweigert: Deine Telegram-ID ist nicht als Admin autorisiert.",
            diagnostics: {
              telegramId: String(auth.user?.telegramId || auth.chatId || ""),
              authMethod: auth.authMethod || "unknown",
              authFailureReason: "not_in_admin_ids",
              hasAdminEnvConfigured: configuredAdminSet.size > 0
            }
          }), { status: 403, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/validate-channel" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const rawChannelInput = String(body.channelInput || body.channelId || "").trim();
          const parsed = parseAndNormalizeTelegramChannelInput(rawChannelInput);
          const channelId = parsed.channelId || "";
          const sampleMsgId = Number(body.sampleMessageId || parsed.sampleMessageId || 0) || null;
          if (!channelId || !channelId.startsWith("-100")) {
            return new Response(JSON.stringify({
              ok: false,
              readable: false,
              channelId: "",
              diagnosticSummary: "Ungültige Kanal-ID. Bitte eine echte -100... ID oder einen t.me/c/... Link eingeben."
            }), { status: 200, headers: corsHeaders });
          }
          let chatTitle = "Quell-Kanal";
          let readable = true;
          let copyTestPassed = false;
          let diagnosticSummary = `✅ Kanal ${channelId} ist verifiziert und lesbar.`;
          const effBotToken = String(env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || "").trim();
          const isSimulatedToken = !effBotToken || effBotToken.startsWith("123456:");
          if (effBotToken && !isSimulatedToken) {
            try {
              const chatRes = await fetchWithTimeout(`https://api.telegram.org/bot${effBotToken}/getChat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: channelId }),
                _criticalSubrequest: true
              }, 5000).then(r => r.json()).catch(() => null);
              if (chatRes && chatRes.ok && chatRes.result) {
                chatTitle = chatRes.result.title || chatRes.result.username || channelId;
                readable = true;
                if (sampleMsgId && auth.chatId && /^\d+$/.test(String(auth.chatId))) {
                  const copyRes = await fetchWithTimeout(`https://api.telegram.org/bot${effBotToken}/copyMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      chat_id: auth.chatId,
                      from_chat_id: channelId,
                      message_id: sampleMsgId,
                      disable_notification: true
                    }),
                    _criticalSubrequest: true
                  }, 5000).then(r => r.json()).catch(() => null);
                  if (copyRes && copyRes.ok && copyRes.result?.message_id) {
                    copyTestPassed = true;
                    scheduleBackgroundWork(() => fetchWithTimeout(`https://api.telegram.org/bot${effBotToken}/deleteMessage`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ chat_id: auth.chatId, message_id: copyRes.result.message_id })
                    }, 4000));
                  }
                }
                diagnosticSummary = `✅ Kanal "${chatTitle}" (${channelId}) verifiziert${copyTestPassed ? ` • Test-Kopie Msg #${sampleMsgId} erfolgreich` : ""}.`;
              } else if (chatRes && !chatRes.ok) {
                readable = false;
                diagnosticSummary = `❌ Telegram API Fehler für ${channelId}: ${chatRes.description || "Bot ist kein Admin im Kanal"}`;
              }
            } catch (e) {}
          } else {
            chatTitle = `Simulator Quell-Kanal (${channelId})`;
            readable = true;
            copyTestPassed = Boolean(sampleMsgId);
            diagnosticSummary = `✅ Kanal "${chatTitle}" im Simulator verifiziert${sampleMsgId ? ` • Dry-Run Msg #${sampleMsgId} bereit` : ""}.`;
          }
          if (readable) {
            const verifiedPayload = {
              channelId,
              chatTitle,
              updatedAt: new Date().toISOString()
            };
            memoryFallback.set("tma_verified_source_channel_v1", verifiedPayload);
            await kvStageWrite(env, "tma_verified_source_channel_v1", verifiedPayload, { bindingName: "MOVIE_SAVED" });
          }
          return new Response(JSON.stringify({
            ok: readable,
            readable,
            channelId,
            chatTitle,
            sampleMessageId: sampleMsgId,
            copyTestPassed,
            diagnosticSummary
          }), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/d1-diagnostics" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const action = String(body.action || "scan");
          const fallbackChannelId = String(body.fallbackChannelId || body.channelId || "").trim();
          if (action === "reset_all_media") {
            const resetRes = await resetAllMediaAndPlaylistsInD1AndKv(env);
            await flushUserSession(env, auth.chatId, { force: true });
            return new Response(JSON.stringify(resetRes), { status: 200, headers: corsHeaders });
          }
          if (action === "dedupe_files" || action === "delete_broken_files") {
            const dedupeRes = await dedupeAllD1StreamFiles(env, fallbackChannelId);
            await flushUserSession(env, auth.chatId);
            return new Response(JSON.stringify(dedupeRes), { status: 200, headers: corsHeaders });
          }
          const dedupeScan = await dedupeAllD1StreamFiles(env, fallbackChannelId);
          return new Response(JSON.stringify(dedupeScan), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/import-checkpoint") {
          if (request.method === "GET") {
            let checkpoint = await getImportCheckpointFromD1(env);
            if (!checkpoint) {
              checkpoint = memoryFallback.get("tma_backup_import_checkpoint_v1") || null;
              if (!checkpoint) {
                const rawCp = await kvCachedGetRaw(env, "tma_backup_import_checkpoint_v1", "MOVIE_SAVED");
                if (rawCp) {
                  try {
                    checkpoint = JSON.parse(rawCp);
                  } catch (e) {}
                }
              }
              if (checkpoint) {
                checkpoint = await saveImportCheckpointToD1(env, checkpoint);
              }
            }
            return new Response(JSON.stringify({ ok: true, checkpoint }), { status: 200, headers: corsHeaders });
          }
          if (request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            if (body.action === "clear" || body.clear === true) {
              memoryFallback.delete("tma_backup_import_checkpoint_v1");
              memoryFallback.delete("tma_backup_import_checkpoint_kv_cnt");
              await clearImportCheckpointInD1(env);
              return new Response(JSON.stringify({ ok: true, cleared: true }), { status: 200, headers: corsHeaders });
            }
            if (body.checkpoint) {
              const savedCp = await saveImportCheckpointToD1(env, body.checkpoint);
              memoryFallback.set("tma_backup_import_checkpoint_v1", savedCp);
            }
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
          }
        }
        if (path === "/api/tma/admin/overview" && request.method === "GET") {
          const mediaType = url.searchParams.get("mediaType") === "s" ? "s" : "m";
          const playlistChatId = String(url.searchParams.get("playlistChatId") || auth.chatId);
          const requestedFolderId = String(url.searchParams.get("folderId") || "").trim();
          const activeTab = String(url.searchParams.get("tab") || "").trim();
          const isFullRefresh = url.searchParams.get("refresh") === "1";
          if (playlistChatId === "bot_vip") {
            await ensureBotVipDefaultPlaylist(env).catch(() => null);
          }
          if (isFullRefresh) {
            await cleanupEmptySeriesInD1AndMemory(env).catch(() => null);
          }
          const shouldComputeSeriesGapsNow = isFullRefresh || activeTab === "gaps";
          const cachedSeriesGapsRaw = memoryFallback.get("d1_series_gaps_cache");
          const cachedSeriesGaps = (cachedSeriesGapsRaw && cachedSeriesGapsRaw.data)
            ? cachedSeriesGapsRaw.data
            : {
                totalSeriesChecked: 0,
                seriesWithGapsCount: 0,
                seriesWithInternalGapsCount: 0,
                totalMissingInternal: 0,
                totalMissingTrailing: 0,
                totalPrereleaseOnly: 0,
                items: [],
                totalSeriesWithGaps: 0,
                series: [],
                lazyDeferred: !shouldComputeSeriesGapsNow
              };
          const [users, media, queueStats, targetFolders, rawTargetItems, reports, seriesGaps] = await Promise.all([
            listAllUsersFromD1(env).catch(() => []),
            listAllMediaFromD1(env, mediaType).catch(() => []),
            getImportQueueStatsFromD1(env).catch(() => ({ pendingCount: 0, processedCount: 0, moviesSaved: 0, seriesSaved: 0, failedCount: 0 })),
            getFolders(env, playlistChatId).catch(() => []),
            getSavedList(env, playlistChatId).catch(() => []),
            listMediaReportsFromD1(env, "all").catch(() => []),
            shouldComputeSeriesGapsNow
              ? computeSeriesGapsOverview(env, isFullRefresh).catch(() => cachedSeriesGaps)
              : Promise.resolve(cachedSeriesGaps)
          ]);
          const targetItems = await enrichSavedListWithD1EpisodesAndPosters(env, playlistChatId, rawTargetItems).catch(() => rawTargetItems || []);
          const playlists = (targetFolders || []).map(f => ({
            ...f,
            enabled: f.enabled !== false,
            playlistMode: f.playlistMode || (playlistChatId === "bot_vip" ? "vip_stream" : "both"),
            itemCount: (targetItems || []).filter(i => String(i.folderId) === String(f.id)).length
          }));
          const activeFolderId = requestedFolderId && playlists.some(p => String(p.id) === requestedFolderId)
            ? requestedFolderId
            : (playlists[0]?.id ? String(playlists[0].id) : "");
          const activePlaylistItems = activeFolderId
            ? (targetItems || []).filter(i => String(i.folderId) === activeFolderId)
            : [];
          const openReportsCount = (reports || []).filter(r => r && r.status === "open").length;
          const [videoCoverMode, botUsername, speedProfileConfig, webhookSecurity] = await Promise.all([
            getVideoCoverMode(env).catch(() => "backdrop"),
            tgApi(env).getBotUsername(env).catch(() => ""),
            getWorkerSpeedProfile(env).catch(() => WORKER_SPEED_PROFILES.free_turbo),
            typeof getWebhookSecurityConfig === "function" ? getWebhookSecurityConfig(env).catch(() => ({ secretToken: "", maxConnections: 8 })) : Promise.resolve({ secretToken: "", maxConnections: 8 })
          ]);
          const cleanWorkerOrigin = resolveCleanWorkerOrigin(env, url.origin);
          const effectiveWebAppUrl = String(env.WEBAPP_URL || cleanWorkerOrigin).replace(/\/$/, "");
          const officialWebhookUrl = `${cleanWorkerOrigin}/webhook`;
          const activeSecret = String(webhookSecurity?.secretToken || "");
          const activeMaxConn = Number(webhookSecurity?.maxConnections || 8);
          const manualWebhookLinks = buildManualWebhookLinks(cleanWorkerOrigin, officialWebhookUrl, activeSecret, activeMaxConn, true);
          return new Response(JSON.stringify({
            ok: true,
            users,
            media,
            queueStats,
            playlists,
            playlistChatId,
            activeFolderId,
            activePlaylistItems,
            reports: reports || [],
            openReportsCount,
            seriesGaps,
            _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null,
            botSetup: {
              videoCoverMode,
              speedProfile: speedProfileConfig?.id || "free_turbo",
              speedProfileConfig,
              webAppUrl: effectiveWebAppUrl,
              webhookUrl: officialWebhookUrl,
              manualSetWebhookWorkerUrl: manualWebhookLinks.manualSetWebhookWorkerUrl,
              manualTelegramApiTemplateUrl: manualWebhookLinks.manualTelegramApiTemplateUrl,
              activeWebhookSecret: activeSecret,
              hasWebhookPassword: Boolean(activeSecret),
              webhookPasswordLength: activeSecret.length,
              webhookPasswordPreview: activeSecret ? `${activeSecret.slice(0, 3)}•••${activeSecret.slice(-2)}` : "",
              webhookMaxConnections: activeMaxConn,
              hasBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),
              botUsername: botUsername || "DeinBot"
            }
          }), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/bot-setup") {
          const cleanWorkerOrigin = resolveCleanWorkerOrigin(env, url.origin);
          const effectiveWebAppUrl = String(env.WEBAPP_URL || cleanWorkerOrigin).replace(/\/$/, "");
          const officialWebhookUrl = `${cleanWorkerOrigin}/webhook`;
          if (request.method === "GET") {
            const [videoCoverMode, botUsername, speedProfileConfig, webhookSecurity] = await Promise.all([
              getVideoCoverMode(env).catch(() => "backdrop"),
              tgApi(env).getBotUsername(env).catch(() => ""),
              getWorkerSpeedProfile(env).catch(() => WORKER_SPEED_PROFILES.free_turbo),
              typeof getWebhookSecurityConfig === "function" ? getWebhookSecurityConfig(env).catch(() => ({ secretToken: "", maxConnections: 8 })) : Promise.resolve({ secretToken: "", maxConnections: 8 })
            ]);
            const activeSecret = String(webhookSecurity?.secretToken || "");
            const activeMaxConn = Number(webhookSecurity?.maxConnections || 8);
            const manualWebhookLinks = buildManualWebhookLinks(cleanWorkerOrigin, officialWebhookUrl, activeSecret, activeMaxConn, true);
            return new Response(JSON.stringify({
              ok: true,
              videoCoverMode,
              speedProfile: speedProfileConfig?.id || "free_turbo",
              speedProfileConfig,
              webAppUrl: effectiveWebAppUrl,
              webhookUrl: officialWebhookUrl,
              manualSetWebhookWorkerUrl: manualWebhookLinks.manualSetWebhookWorkerUrl,
              manualTelegramApiTemplateUrl: manualWebhookLinks.manualTelegramApiTemplateUrl,
              activeWebhookSecret: activeSecret,
              hasWebhookPassword: Boolean(activeSecret),
              webhookPasswordLength: activeSecret.length,
              webhookPasswordPreview: activeSecret ? `${activeSecret.slice(0, 3)}•••${activeSecret.slice(-2)}` : "",
              webhookMaxConnections: activeMaxConn,
              hasBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),
              botUsername: botUsername || "DeinBot",
              _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null
            }), { status: 200, headers: corsHeaders });
          }
          if (request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const action = String(body.action || "set_cover_mode");
            if (action === "set_cover_mode") {
              const savedMode = await setVideoCoverMode(env, body.videoCoverMode || "backdrop");
              await flushUserSession(env, auth.chatId).catch(() => {});
              return new Response(JSON.stringify({
                ok: true,
                videoCoverMode: savedMode,
                _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null
              }), { status: 200, headers: corsHeaders });
            }
            if (action === "set_speed_profile") {
              const savedProfile = await setWorkerSpeedProfile(env, body.speedProfile || "free_turbo");
              await flushUserSession(env, auth.chatId).catch(() => {});
              return new Response(JSON.stringify({
                ok: true,
                speedProfile: savedProfile.id,
                speedProfileConfig: savedProfile,
                _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null
              }), { status: 200, headers: corsHeaders });
            }
            if (action === "save_webhook_and_register") {
              const existingCfg = typeof getWebhookSecurityConfig === "function"
                ? await getWebhookSecurityConfig(env).catch(() => ({ secretToken: "", maxConnections: 8 }))
                : { secretToken: "", maxConnections: 8 };
              const clearPassword = Boolean(body.clearPassword);
              const rawPassword = String(body.webhookPassword ?? "").trim();
              const sanitizedInputSecret = typeof sanitizeWebhookSecretToken === "function"
                ? sanitizeWebhookSecretToken(rawPassword)
                : rawPassword.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
              // Bestehendes Passwort behalten, wenn das Eingabefeld leer gelassen wurde (außer explizites clearPassword: true)
              const effectiveSecret = clearPassword
                ? ""
                : (sanitizedInputSecret || String(existingCfg?.secretToken || ""));
              const maxConnections = Math.min(40, Math.max(1, Number(body.maxConnections) || Number(existingCfg?.maxConnections) || 8));
              const dropPending = Boolean(body.dropPendingUpdates);
              const customWebhookUrl = String(body.webhookUrl || officialWebhookUrl).trim() || officialWebhookUrl;
              if (!/^https:\/\/[^\s]+$/i.test(customWebhookUrl)) {
                return new Response(JSON.stringify({
                  ok: false,
                  error: "Ungültige Webhook-URL: Muss mit https:// beginnen.",
                  message: "Ungültige Webhook-URL: Telegram akzeptiert nur HTTPS-URLs (z. B. https://dein-worker.workers.dev/webhook)."
                }), { status: 400, headers: corsHeaders });
              }
              const savedCfg = typeof saveWebhookSecurityConfig === "function"
                ? await saveWebhookSecurityConfig(env, {
                    secretToken: effectiveSecret,
                    maxConnections,
                    dropPendingDefault: dropPending
                  })
                : { secretToken: effectiveSecret, maxConnections };
              const manualLinks = buildManualWebhookLinks(cleanWorkerOrigin, customWebhookUrl, savedCfg.secretToken, savedCfg.maxConnections, dropPending);
              if (!env.TELEGRAM_BOT_TOKEN) {
                return new Response(JSON.stringify({
                  ok: true,
                  simulated: true,
                  webhookUrl: customWebhookUrl,
                  manualSetWebhookWorkerUrl: manualLinks.manualSetWebhookWorkerUrl,
                  manualTelegramApiTemplateUrl: manualLinks.manualTelegramApiTemplateUrl,
                  activeWebhookSecret: savedCfg.secretToken,
                  hasWebhookPassword: Boolean(savedCfg.secretToken),
                  webhookPasswordPreview: savedCfg.secretToken ? `${savedCfg.secretToken.slice(0, 3)}•••${savedCfg.secretToken.slice(-2)}` : "",
                  maxConnections: savedCfg.maxConnections,
                  message: "Webhook-Konfiguration gespeichert (Hinweis: TELEGRAM_BOT_TOKEN ist in dieser Umgebung nicht gesetzt – bitte im echten Cloudflare Worker oder über den manuellen Telegram-API-Link unten registrieren).",
                  _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null
                }), { status: 200, headers: corsHeaders });
              }
              const whPayload = {
                url: customWebhookUrl,
                max_connections: savedCfg.maxConnections,
                drop_pending_updates: dropPending,
                allowed_updates: ["message", "channel_post", "callback_query", "inline_query"]
              };
              if (savedCfg.secretToken) {
                whPayload.secret_token = savedCfg.secretToken;
              }
              let whJson = {};
              let whErrorMsg = "";
              try {
                const whRes = await fetchWithTimeout(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(whPayload)
                }, 6000);
                whJson = await whRes.json().catch(() => ({}));
              } catch (whErr) {
                whErrorMsg = String(whErr?.message || "Netzwerkfehler bei Telegram setWebhook.");
              }
              let effectiveActiveCfg = savedCfg;
              let effectiveManualLinks = manualLinks;
              let liveWebhookInfo = null;
              if (whJson?.ok) {
                try {
                  const infoRes = await fetchWithTimeout(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`, {}, 4500);
                  const infoJson = await infoRes.json().catch(() => ({}));
                  if (infoJson?.ok && infoJson?.result) liveWebhookInfo = infoJson.result;
                } catch (_infoErr) {}
              } else if (typeof saveWebhookSecurityConfig === "function") {
                // Rollback auf das vorherige Webhook-Secret, damit Telegram-Updates nicht ausgesperrt werden!
                effectiveActiveCfg = await saveWebhookSecurityConfig(env, {
                  secretToken: String(existingCfg?.secretToken || ""),
                  maxConnections: Number(existingCfg?.maxConnections || 8),
                  dropPendingDefault: Boolean(existingCfg?.dropPendingDefault)
                }).catch(() => existingCfg);
                effectiveManualLinks = buildManualWebhookLinks(cleanWorkerOrigin, customWebhookUrl, effectiveActiveCfg.secretToken, effectiveActiveCfg.maxConnections, dropPending);
              }
              return new Response(JSON.stringify({
                ok: Boolean(whJson?.ok),
                webhookUrl: customWebhookUrl,
                manualSetWebhookWorkerUrl: effectiveManualLinks.manualSetWebhookWorkerUrl,
                manualTelegramApiTemplateUrl: effectiveManualLinks.manualTelegramApiTemplateUrl,
                activeWebhookSecret: effectiveActiveCfg.secretToken,
                hasWebhookPassword: Boolean(effectiveActiveCfg.secretToken),
                webhookPasswordPreview: effectiveActiveCfg.secretToken ? `${effectiveActiveCfg.secretToken.slice(0, 3)}•••${effectiveActiveCfg.secretToken.slice(-2)}` : "",
                maxConnections: effectiveActiveCfg.maxConnections,
                webhookInfo: liveWebhookInfo,
                telegramResponse: whJson,
                message: whJson?.ok
                  ? `Webhook inkl. Passwort-Schutz (${effectiveActiveCfg.secretToken ? "aktiv" : "ohne Passwort"}, max_connections=${effectiveActiveCfg.maxConnections}) erfolgreich bei Telegram registriert & verifiziert!`
                  : `${whJson?.description || whErrorMsg || "Telegram setWebhook fehlgeschlagen."} (Vorheriges Webhook-Secret wurde zur Sicherheit beibehalten.)`,
                _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null
              }), { status: 200, headers: corsHeaders });
            }
            if (action === "get_webhook_info") {
              const webhookSecurity = typeof getWebhookSecurityConfig === "function"
                ? await getWebhookSecurityConfig(env)
                : { secretToken: "", maxConnections: 8 };
              if (!env.TELEGRAM_BOT_TOKEN) {
                return new Response(JSON.stringify({
                  ok: true,
                  simulated: true,
                  webhookInfo: {
                    url: officialWebhookUrl,
                    has_custom_certificate: false,
                    pending_update_count: 0,
                    max_connections: webhookSecurity.maxConnections || 8,
                    ip_address: "104.21.48.1 (Cloudflare Edge Simulator)",
                    allowed_updates: ["message", "channel_post", "callback_query", "inline_query"]
                  },
                  hasWebhookPassword: Boolean(webhookSecurity.secretToken),
                  _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null
                }), { status: 200, headers: corsHeaders });
              }
              const infoRes = await fetchWithTimeout(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`, {}, 5000);
              const infoJson = await infoRes.json().catch(() => ({}));
              return new Response(JSON.stringify({
                ok: Boolean(infoJson?.ok),
                webhookInfo: infoJson?.result || null,
                telegramResponse: infoJson,
                hasWebhookPassword: Boolean(webhookSecurity.secretToken),
                _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null
              }), { status: 200, headers: corsHeaders });
            }
            if (action === "drop_pending_updates") {
              const webhookSecurity = typeof getWebhookSecurityConfig === "function"
                ? await getWebhookSecurityConfig(env)
                : { secretToken: "", maxConnections: 8 };
              if (!env.TELEGRAM_BOT_TOKEN) {
                return new Response(JSON.stringify({
                  ok: true,
                  simulated: true,
                  message: "Hängende Updates im Simulator geleert (drop_pending_updates = true)."
                }), { status: 200, headers: corsHeaders });
              }
              const whPayload = {
                url: officialWebhookUrl,
                max_connections: webhookSecurity.maxConnections || 8,
                drop_pending_updates: true,
                allowed_updates: ["message", "channel_post", "callback_query", "inline_query"]
              };
              if (webhookSecurity.secretToken) {
                whPayload.secret_token = webhookSecurity.secretToken;
              }
              const dropRes = await fetchWithTimeout(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(whPayload)
              }, 6000);
              const dropJson = await dropRes.json().catch(() => ({}));
              return new Response(JSON.stringify({
                ok: Boolean(dropJson?.ok),
                telegramResponse: dropJson,
                message: dropJson?.ok
                  ? "Alle angestauten Telegram-Updates (Retry-Stau) wurden erfolgreich verworfen!"
                  : (dropJson?.description || "Konnte hängende Updates nicht verwerfen."),
                _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null
              }), { status: 200, headers: corsHeaders });
            }
            if (action === "test_webhook_auth") {
              const webhookSecurity = typeof getWebhookSecurityConfig === "function"
                ? await getWebhookSecurityConfig(env)
                : { secretToken: "", maxConnections: 8 };
              const activeSecret = String(webhookSecurity?.secretToken || "");
              return new Response(JSON.stringify({
                ok: true,
                webhookUrl: officialWebhookUrl,
                hasWebhookPassword: Boolean(activeSecret),
                gatekeeperStatus: activeSecret
                  ? "🔒 AKTIV — Unbefugte POST-Requests ohne X-Telegram-Bot-Api-Secret-Token werden in <0.1ms (0 D1-Reads) mit HTTP 401 abgewiesen."
                  : "⚠️ OFFEN — Noch kein Webhook-Passwort gesetzt. Bitte Passwort eintragen oder generieren.",
                _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null
              }), { status: 200, headers: corsHeaders });
            }
            if (action === "setup_miniapp_menu") {
              const customUrl = String(body.webAppUrl || effectiveWebAppUrl).trim().replace(/\/$/, "");
              const buttonText = String(body.buttonText || "🍿 Mediathek").trim().slice(0, 32) || "🍿 Mediathek";
              if (!env.TELEGRAM_BOT_TOKEN) {
                return new Response(JSON.stringify({
                  ok: true,
                  simulated: true,
                  webAppUrl: customUrl,
                  buttonText,
                  message: "Menü-Button & Bot-Befehle im Simulator konfiguriert (setChatMenuButton + setMyCommands)."
                }), { status: 200, headers: corsHeaders });
              }
              const [globalMenuRes, adminMenuRes, commandsRes] = await Promise.all([
                tgApi(env).setChatMenuButton(null, customUrl, buttonText),
                auth.chatId && /^\d+$/.test(String(auth.chatId))
                  ? tgApi(env).setChatMenuButton(auth.chatId, customUrl, buttonText)
                  : Promise.resolve({ ok: true }),
                tgApi(env).setMyCommands()
              ]);
              return new Response(JSON.stringify({
                ok: Boolean((globalMenuRes && globalMenuRes.ok) || (adminMenuRes && adminMenuRes.ok)),
                webAppUrl: customUrl,
                buttonText,
                globalMenuRes,
                adminMenuRes,
                commandsRes
              }), { status: 200, headers: corsHeaders });
            }
            return new Response(JSON.stringify({ ok: false, error: "Unbekannte Bot-Setup Aktion." }), { status: 400, headers: corsHeaders });
          }
        }
        if (path === "/api/tma/admin/series-gaps" && request.method === "GET") {
          const forceRefresh = url.searchParams.get("refresh") === "1";
          const seriesGaps = await computeSeriesGapsOverview(env, forceRefresh);
          return new Response(JSON.stringify({ ok: true, seriesGaps }), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/playlists" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const targetChatId = String(body.targetChatId || auth.chatId);
          const action = String(body.action || "");
          if (action === "create") {
            const mode = ["vip_stream", "watchlist", "both"].includes(body.playlistMode)
              ? body.playlistMode
              : (targetChatId === "bot_vip" ? "vip_stream" : "both");
            const folder = await createOrGetJsonPlaylistFolder(env, targetChatId, body.name || "Neue Custom Playlist", "Admin-Panel", mode);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify({ ok: true, folder }), { status: 200, headers: corsHeaders });
          }
          if (action === "toggle") {
            const res = await togglePlaylistFolderEnabled(env, targetChatId, body.folderId);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify(res), { status: 200, headers: corsHeaders });
          }
          if (action === "set_mode") {
            const res = await setPlaylistFolderMode(env, targetChatId, body.folderId, body.playlistMode, {
              offset: Number(body.offset || 0),
              limit: Number(body.limit || 25)
            });
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify(res), { status: 200, headers: corsHeaders });
          }
          if (action === "copy_playlist_batch") {
            const res = await copyPlaylistFolderItemsBatched(
              env,
              String(body.sourceChatId || targetChatId),
              String(body.sourceFolderId || body.folderId || ""),
              String(body.targetChatId || targetChatId),
              String(body.targetFolderName || "Playlist Kopie"),
              String(body.targetMode || "both"),
              Number(body.offset || 0),
              Number(body.limit || 25)
            );
            await flushUserSession(env, String(body.targetChatId || targetChatId));
            return new Response(JSON.stringify(res), { status: 200, headers: corsHeaders });
          }
          if (action === "reorder_item") {
            const res = await reorderPlaylistFolderItem(env, targetChatId, body.folderId, body.uid, body.direction);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify(res), { status: 200, headers: corsHeaders });
          }
          if (action === "sync_d1") {
            await ensureBotVipDefaultPlaylist(env);
            const syncRes = await syncD1CatalogIntoBotVipPlaylist(
              env,
              body.folderId || "pl_bot_vip_default",
              {
                forceIncludeHidden: Boolean(body.forceIncludeHidden),
                offset: Number(body.offset || 0),
                limit: Number(body.limit || 25)
              }
            );
            await flushUserSession(env, "bot_vip");
            return new Response(JSON.stringify({ ok: true, ...syncRes }), { status: 200, headers: corsHeaders });
          }
          if (action === "add_item" || action === "remove_item" || action === "delete_from_d1") {
            const res = await addOrRemovePlaylistFolderItem(env, targetChatId, body.folderId, action, body);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify(res), { status: 200, headers: corsHeaders });
          }
          if (action === "rename") {
            const res = await renamePlaylistFolder(env, targetChatId, body.folderId, body.name);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify(res), { status: 200, headers: corsHeaders });
          }
          if (action === "delete") {
            const res = await deletePlaylistFolderAndItems(env, targetChatId, body.folderId);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify(res), { status: 200, headers: corsHeaders });
          }
          return new Response(JSON.stringify({ ok: false, error: "Unbekannte Playlist-Aktion." }), { status: 400, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/catalog-preseed" && (request.method === "GET" || request.method === "POST")) {
          const forcePreseedRefresh = url.searchParams.get("refresh") === "1";
          const cachedPreseed = memoryFallback.get("d1_catalog_preseed_cache");
          if (!forcePreseedRefresh && cachedPreseed && cachedPreseed.payload && (Date.now() - Number(cachedPreseed.ts || 0)) < 60000) {
            return new Response(JSON.stringify(cachedPreseed.payload), { status: 200, headers: corsHeaders });
          }
          const items = [];
          const existingFileIds = [];
          const existingFingerprints = [];
          const entityMappings = [];
          try {
            await ensureD1Schema(env);
            const rawDb = getRawD1Binding(env);
            if (rawDb) {
              trackStat("d1Reads");
              if (typeof countD1Subrequest === "function") countD1Subrequest();
              // Free-Plan Schutz: Begrenzte LIMIT-Werte verhindern >50.000-Row-Scans und 10ms-CPU-Timeouts
              const [mRows, sRows, mfRows, efRows, entRows] = await rawDb.batch([
                rawDb.prepare("SELECT tmdb_id, title, release_year, poster_path FROM movies ORDER BY updated_at DESC LIMIT 4000"),
                rawDb.prepare("SELECT tmdb_id, title, release_year, poster_path FROM series ORDER BY updated_at DESC LIMIT 4000"),
                rawDb.prepare("SELECT telegram_file_id, file_fingerprint FROM movie_files WHERE telegram_file_id IS NOT NULL AND telegram_file_id != '' ORDER BY updated_at DESC LIMIT 6000"),
                rawDb.prepare("SELECT telegram_file_id, file_fingerprint FROM episode_files WHERE telegram_file_id IS NOT NULL AND telegram_file_id != '' ORDER BY updated_at DESC LIMIT 6000"),
                rawDb.prepare("SELECT cache_key, data_json FROM entity_cache WHERE entity_type = 'title_res' ORDER BY updated_at DESC LIMIT 1000")
              ]);
              for (const r of (mRows?.results || [])) {
                if (r?.tmdb_id && r?.title) {
                  items.push({
                    tmdbId: Number(r.tmdb_id),
                    typeCode: "m",
                    title: String(r.title),
                    year: r.release_year ? String(r.release_year) : null,
                    poster: r.poster_path || ""
                  });
                }
              }
              for (const r of (sRows?.results || [])) {
                if (r?.tmdb_id && r?.title) {
                  items.push({
                    tmdbId: Number(r.tmdb_id),
                    typeCode: "s",
                    title: String(r.title),
                    year: r.release_year ? String(r.release_year) : null,
                    poster: r.poster_path || ""
                  });
                }
              }
              const seenFidSet = new Set();
              const seenFpSet = new Set();
              for (const r of [...(mfRows?.results || []), ...(efRows?.results || [])]) {
                const fid = String(r?.telegram_file_id || "").trim();
                if (fid && !fid.startsWith("vip_playlist_") && !fid.startsWith("tmdb_card_") && !seenFidSet.has(fid)) {
                  seenFidSet.add(fid);
                  existingFileIds.push(fid);
                }
                const fp = String(r?.file_fingerprint || "").trim();
                if (fp && fp !== "0_0_0x0" && fp !== "null" && !seenFpSet.has(fp)) {
                  seenFpSet.add(fp);
                  existingFingerprints.push(fp);
                }
              }
              for (const r of (entRows?.results || [])) {
                if (r?.cache_key && r?.data_json) {
                  try {
                    const parsedEnt = JSON.parse(r.data_json);
                    if (parsedEnt && parsedEnt.tmdbId) {
                      entityMappings.push({
                        cacheKey: String(r.cache_key),
                        tmdbId: Number(parsedEnt.tmdbId),
                        typeCode: parsedEnt.typeCode === "s" ? "s" : "m",
                        title: String(parsedEnt.title || parsedEnt.cleanTitle || ""),
                        poster: parsedEnt.poster || ""
                      });
                    }
                  } catch (e) {}
                }
              }
            }
          } catch (e) {}
          const preseedPayload = {
            ok: true,
            count: items.length,
            items,
            existingFileIds,
            existingFingerprints,
            entityMappings
          };
          memoryFallback.set("d1_catalog_preseed_cache", { payload: preseedPayload, ts: Date.now() });
          return new Response(JSON.stringify(preseedPayload), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/import-batch" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          if (body.deferKvWrite && !body.isFinalBatch) {
            globalThis.__DEFER_KV_FLUSH_FOR_REQUEST = true;
          }
          const directSpeedProf = (typeof body.speedProfile === "string" && WORKER_SPEED_PROFILES[body.speedProfile])
            ? WORKER_SPEED_PROFILES[body.speedProfile]
            : null;
          const activeSpeedProf = directSpeedProf || await getWorkerSpeedProfile(env, body.speedProfile || null).catch(() => WORKER_SPEED_PROFILES.free_turbo);
          const isPaidProf = activeSpeedProf?.id === "paid_pro" || activeSpeedProf?.id === "paid_highspeed";
          const incomingArr = Array.isArray(body.entries) ? body.entries : [];
          const preResolvedCount = incomingArr.filter(e => e && (e.tmdb_id || e.tmdbId)).length;
          const isPreResolvedBatch = Boolean(body.isPreResolvedFastBatch || (incomingArr.length > 0 && preResolvedCount >= Math.ceil(incomingArr.length * 0.7)));
          const maxSliceCap = isPaidProf
            ? Math.min(Math.max(8, Number(activeSpeedProf?.batchSize || 24)), 28)
            : isPreResolvedBatch
              ? 8
              : Math.min(Math.max(1, Number(activeSpeedProf?.batchSize || 4)), 5);
          const rawEntries = incomingArr.slice(0, maxSliceCap);
          if (rawEntries.length === 0) {
            return new Response(JSON.stringify({ ok: false, error: "Keine Einträge im Batch." }), { status: 400, headers: corsHeaders });
          }
          const parsedBodyChannel = parseAndNormalizeTelegramChannelInput(String(body.sourceChannelId || body.channelId || ""));
          let verifiedChannelId = parsedBodyChannel.channelId || "";
          if (!verifiedChannelId) {
            let savedCh = memoryFallback.get("tma_verified_source_channel_v1") || null;
            if (!savedCh) {
              const rawCh = await kvCachedGetRaw(env, "tma_verified_source_channel_v1", "MOVIE_SAVED");
              if (rawCh) {
                try {
                  savedCh = JSON.parse(rawCh);
                  if (savedCh) memoryFallback.set("tma_verified_source_channel_v1", savedCh);
                } catch (e) {}
              }
            }
            if (savedCh && savedCh.channelId) verifiedChannelId = String(savedCh.channelId);
          }
          const skipFullChannelReParse = Boolean(body.alreadyNormalized && verifiedChannelId);
          const entries = rawEntries.map(item => {
            if (skipFullChannelReParse && item && typeof item === "object" && item.chat_id && item.telegram_file_id && !String(item.telegram_file_id).startsWith("tg_export_0_")) {
              return item;
            }
            const entryCopy = { ...item };
            const itemParsedCh = parseAndNormalizeTelegramChannelInput(String(entryCopy.chat_id || verifiedChannelId || ""));
            const effCh = itemParsedCh.channelId || verifiedChannelId;
            const msgId = Number(entryCopy.msg_id || entryCopy.message_id || extractExportMessageIdFromFileId(entryCopy.telegram_file_id) || 0);
            if (effCh) {
              entryCopy.chat_id = effCh;
              if (msgId > 0 && (!entryCopy.telegram_file_id || String(entryCopy.telegram_file_id).startsWith("tg_export_"))) {
                entryCopy.telegram_file_id = `tg_export_${effCh}_${msgId}`;
              } else if (entryCopy.telegram_file_id) {
                entryCopy.telegram_file_id = normalizeExportFileIdChannel(entryCopy.telegram_file_id, effCh);
              }
            }
            return entryCopy;
          });
          const hasInvalidExportId = entries.some(e => {
            const fid = String(e.telegram_file_id || "");
            return fid.startsWith("tg_export_0_") || (!e.chat_id && fid.startsWith("tg_export_") && !fid.startsWith("tg_export_-100") && !fid.startsWith("tg_export_@"));
          });
          if (hasInvalidExportId && !verifiedChannelId) {
            return new Response(JSON.stringify({
              ok: false,
              error: "Quell-Kanal-ID (-100...) fehlt! Bitte vor dem JSON-Import zuerst den Quell-Kanal verifizieren."
            }), { status: 400, headers: corsHeaders });
          }
          const targetChatId = String(body.targetChatId || auth.chatId);
          const playlistName = String(body.playlistName || "🎵 JSON-Import Playlist").trim().slice(0, 48);
          const sourceLabel = String(body.sourceLabel || playlistName);
          const playlistMode = ["vip_stream", "watchlist", "both"].includes(body.playlistMode)
            ? body.playlistMode
            : (targetChatId === "bot_vip" ? "vip_stream" : "both");
          const fastFolderCacheKey = `fast_import_folder_${targetChatId}_${body.playlistFolderId || playlistName.toLowerCase()}`;
          let playlistFolder = memoryFallback.get(fastFolderCacheKey) || null;
          if (!playlistFolder && body.playlistFolderId) {
            const existingFolders = await getFolders(env, targetChatId);
            playlistFolder = existingFolders.find(f => String(f.id) === String(body.playlistFolderId)) || null;
          }
          if (!playlistFolder) {
            playlistFolder = await createOrGetJsonPlaylistFolder(env, targetChatId, playlistName, sourceLabel, playlistMode);
          }
          if (playlistFolder && playlistFolder.id) {
            memoryFallback.set(fastFolderCacheKey, playlistFolder);
            memoryFallback.set(`fast_import_folder_${targetChatId}_${playlistFolder.id}`, playlistFolder);
          }

          const {
            status,
            partialBatch,
            nextStartIndex,
            pauseReason,
            subrequestCount,
            moviesAdded,
            seriesAdded,
            failedItems,
            playlistSavedCount,
            duplicatesCount,
            mergedQualitiesCount,
            uncertainCount,
            batchItems
          } = await processEntriesBatchWithLimit(
            env,
            entries,
            null,
            {
              chatId: targetChatId,
              folderId: playlistFolder.id,
              playlistName: playlistFolder.name,
              playlistMode: playlistFolder.playlistMode || playlistMode,
              speedProfile: activeSpeedProf.id,
              deferKvWrite: true,
              alreadySorted: Boolean(body.alreadySorted),
              isFinalBatch: body.isFinalBatch === undefined ? true : Boolean(body.isFinalBatch)
            }
          );
          const effectiveProcessedCount = Number(nextStartIndex ?? entries.length);
          if (body.checkpoint && typeof body.checkpoint === "object") {
            const baseCursor = typeof body.batchStartCursor === "number"
              ? Number(body.batchStartCursor)
              : Math.max(0, Number(body.checkpoint.cursor || 0) - entries.length);
            const actualNextCursor = baseCursor + effectiveProcessedCount;
            await saveImportCheckpointToD1(env, {
              ...body.checkpoint,
              cursor: actualNextCursor,
              moviesSaved: Number(body.checkpoint.moviesSaved || 0) + moviesAdded.length,
              seriesSaved: Number(body.checkpoint.seriesSaved || 0) + seriesAdded.length,
              failedCount: Number(body.checkpoint.failedCount || 0) + failedItems.length,
              duplicatesInDb: Number(body.checkpoint.duplicatesInDb || 0) + Number(duplicatesCount || 0),
              mergedQualitiesInDb: Number(body.checkpoint.mergedQualitiesInDb || 0) + Number(mergedQualitiesCount || 0),
              uncertainCount: Number(body.checkpoint.uncertainCount || 0) + Number(uncertainCount || 0),
              playlistFolderId: playlistFolder.id,
              playlistName: playlistFolder.name,
              playlistMode: playlistFolder.playlistMode || playlistMode,
              updatedAt: Date.now()
            });
          }
          if (typeof flushD1BatchBuffer === "function") {
            await flushD1BatchBuffer(env);
          }
          const workerHealth = typeof buildWorkerHealthSnapshot === "function"
            ? buildWorkerHealthSnapshot({ route: path, batchProcessedCount: effectiveProcessedCount })
            : null;
          return new Response(JSON.stringify({
            ok: true,
            status: status || "COMPLETED_BATCH",
            partialBatch: Boolean(partialBatch),
            nextStartIndex: effectiveProcessedCount,
            pauseReason: pauseReason || null,
            subrequestCount: Number(subrequestCount || 0),
            moviesAddedCount: moviesAdded.length,
            seriesAddedCount: seriesAdded.length,
            failedCount: failedItems.length,
            duplicatesCount: Number(duplicatesCount || 0),
            mergedQualitiesCount: Number(mergedQualitiesCount || 0),
            uncertainCount: Number(uncertainCount || 0),
            playlistSavedCount,
            playlistFolder,
            sampleTitles: [...moviesAdded.slice(0, 3), ...seriesAdded.slice(0, 3)],
            batchItems: batchItems || [],
            _workerHealth: workerHealth
          }), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/import-logs") {
          if (request.method === "GET") {
            const statusFilter = url.searchParams.get("status") || "ALL";
            const search = url.searchParams.get("q") || "";
            const limit = Number(url.searchParams.get("limit") || 500);
            const data = await listImportDiagnosticLogsFromD1(env, { statusFilter, search, limit });
            return new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers: corsHeaders });
          }
          if (request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const action = String(body.action || "append");
            if (action === "clear") {
              await clearImportDiagnosticLogsInD1(env);
              return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
            }
            if (action === "resolve") {
              await updateImportDiagnosticLogStatusInD1(env, body.id || body.msgId, "OK", body.reason || "Manuell korrigiert", body.tmdbId || null);
              return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
            }
            const logsToSave = Array.isArray(body.logs) ? body.logs : [];
            const savedCount = await saveImportDiagnosticLogsToD1(env, logsToSave);
            return new Response(JSON.stringify({ ok: true, savedCount }), { status: 200, headers: corsHeaders });
          }
        }
        if (path === "/api/tma/admin/tmdb-candidates" && request.method === "GET") {
          const q = String(url.searchParams.get("q") || "").trim();
          const typeFilter = String(url.searchParams.get("type") || "auto").trim();
          if (!q) {
            return new Response(JSON.stringify({ ok: true, candidates: [] }), { status: 200, headers: corsHeaders });
          }
          // Direkte numerische TMDb-ID Abfrage unterstützen
          if (/^\d+$/.test(q)) {
            const numId = Number(q);
            const directCandidates = [];
            const checkTypes = typeFilter === "s" ? ["s"] : typeFilter === "m" ? ["m"] : ["m", "s"];
            for (const tc of checkTypes) {
              try {
                const det = tc === "s" ? await fetchSeriesDetails(env, numId) : await fetchMovieDetails(env, numId);
                if (det && det.id) {
                  const yr = String(det.releaseDate || "").split("-")[0] || "k.A.";
                  const pUrl = det.poster_path ? `https://image.tmdb.org/t/p/w185${det.poster_path}` : (det.external_poster_url || "");
                  directCandidates.push({
                    tmdbId: Number(det.id),
                    typeCode: tc,
                    mediaType: tc === "s" ? "tv" : "movie",
                    title: String(det.title || "Unbekannt"),
                    originalTitle: "",
                    year: yr,
                    poster: pUrl,
                    voteAverage: Number(det.vote_average || 0).toFixed(1),
                    confidence: 100
                  });
                }
              } catch (e) {}
            }
            return new Response(JSON.stringify({ ok: true, candidates: directCandidates }), { status: 200, headers: corsHeaders });
          }

          const parsedQuery = parseMediaFilename(q);
          if (!parsedQuery.cleanTitle || parsedQuery.cleanTitle === "Unbekannt") {
            parsedQuery.cleanTitle = q;
          }
          const forceTc = typeFilter === "s" ? "s" : typeFilter === "m" ? "m" : null;
          const candidates = await searchTmdbCandidatesForImport(env, parsedQuery, forceTc);
          return new Response(JSON.stringify({ ok: true, candidates }), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/remap-import-item" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          let newTmdbId = Number(body.newTmdbId || 0);
          const newTypeCode = body.newTypeCode === "s" ? "s" : "m";
          const oldTmdbId = body.oldTmdbId ? Number(body.oldTmdbId) : null;
          const oldTypeCode = body.oldTypeCode === "s" ? "s" : "m";
          const targetChatId = String(body.targetChatId || auth.chatId);
          const playlistFolderId = body.playlistFolderId ? String(body.playlistFolderId) : null;
          const playlistMode = ["vip_stream", "watchlist", "both"].includes(body.playlistMode)
            ? body.playlistMode
            : (targetChatId === "bot_vip" ? "vip_stream" : "both");
          const rawEntry = body.rawEntry && typeof body.rawEntry === "object" ? body.rawEntry : {};
          const isManualWithoutTmdb = Boolean(body.confirmManualWithoutTmdb || (!newTmdbId && body.manualCustomMeta));
          const manualCustomMeta = body.manualCustomMeta && typeof body.manualCustomMeta === "object" ? body.manualCustomMeta : null;
          const reuseSyntheticId = Number(body.reuseSyntheticId || manualCustomMeta?.reuseSyntheticId || 0);

          if (isManualWithoutTmdb && reuseSyntheticId >= 900000000) {
            newTmdbId = reuseSyntheticId;
          } else if (isManualWithoutTmdb && (!newTmdbId || newTmdbId < 900000000)) {
            const manualTitle = String(
              manualCustomMeta?.title ||
              body.candidateMeta?.title ||
              rawEntry.cleanTitle ||
              rawEntry.title ||
              rawEntry.filename ||
              rawEntry.raw_file_name ||
              "Unbekannter Titel"
            ).trim();
            const manualYear = String(
              manualCustomMeta?.year ||
              body.candidateMeta?.year ||
              rawEntry.year ||
              ""
            ).trim();
            newTmdbId = await allocateCollisionFreeManualSyntheticId(env, newTypeCode, manualTitle, manualYear);
          }

          if (!newTmdbId) {
            return new Response(JSON.stringify({ ok: false, error: "Ungültige Ziel-ID (weder TMDb-ID noch manuelle Bestätigung)." }), { status: 400, headers: corsHeaders });
          }

          // 1. Falls zuvor ein falscher Treffer in der Playlist gespeichert wurde, diesen sauber aus der Ziel-Playlist entfernen
          if (oldTmdbId && playlistFolderId && (oldTmdbId !== newTmdbId || oldTypeCode !== newTypeCode)) {
            try {
              const oldContentType = oldTypeCode === "s" ? "series" : "movie";
              let list = await getSavedList(env, targetChatId);
              const filtered = list.filter(i =>
                !(String(i.folderId || "") === playlistFolderId &&
                  String(i.tmdbId) === String(oldTmdbId) &&
                  i.contentType === oldContentType)
              );
              if (filtered.length !== list.length) {
                await saveRawList(env, targetChatId, filtered);
              }
            } catch (e) {}
          }

          // 2. Neuen Wunsch-Titel (inkl. evtl. vorhandener Datei-/Qualitäts-Infos aus dem Backup) in D1 speichern
          const entryFileMeta = rawEntry.telegram_file_id
            ? {
                fileId: rawEntry.telegram_file_id,
                fileUniqueId: rawEntry.telegram_unique_id || null,
                fileSize: rawEntry.file_size || null,
                mimeType: rawEntry.mime_type || "video/mp4",
                durationSec: rawEntry.duration_seconds || rawEntry.durationSec || 0,
                width: rawEntry.width || 0,
                height: rawEntry.height || 0
              }
            : null;

          const registerAsVipStream = playlistMode === "vip_stream" || playlistMode === "both";
          const manualSeason = body.season !== undefined && body.season !== null && body.season !== ""
            ? Math.max(0, parseInt(body.season, 10) || 0)
            : null;
          const manualEpisode = body.episode !== undefined && body.episode !== null && body.episode !== ""
            ? Math.max(1, parseInt(body.episode, 10) || 1)
            : null;
          const effectiveCandidateMeta = isManualWithoutTmdb
            ? {
                id: newTmdbId,
                title: String(manualCustomMeta?.title || body.candidateMeta?.title || rawEntry.cleanTitle || rawEntry.filename || "Unbekannter Titel").trim(),
                originalTitle: String(manualCustomMeta?.originalTitle || manualCustomMeta?.title || "").trim(),
                year: String(manualCustomMeta?.year || body.candidateMeta?.year || rawEntry.year || "k.A.").trim(),
                poster: String(manualCustomMeta?.poster || body.candidateMeta?.poster || "").trim(),
                genres: String(manualCustomMeta?.genres || body.candidateMeta?.genres || "Manuell bestätigt").trim(),
                overview: String(manualCustomMeta?.overview || body.candidateMeta?.overview || "Manuell ohne TMDb-ID bestätigter Titel.").trim(),
                vote_average: Number(manualCustomMeta?.vote_average || 0),
                source: "Manuell bestätigt"
              }
            : (body.candidateMeta || null);

          const resolved = await resolveAndIngestMediaEntry(env, {
            ...rawEntry,
            ...(effectiveCandidateMeta?.title ? { title: effectiveCandidateMeta.title, cleanTitle: effectiveCandidateMeta.title } : {}),
            ...(effectiveCandidateMeta?.year && effectiveCandidateMeta.year !== "k.A." ? { year: effectiveCandidateMeta.year } : {}),
            tmdb_id: newTmdbId,
            typeCode: newTypeCode,
            type: newTypeCode === "s" ? "series" : "movie",
            isSeries: newTypeCode === "s",
            manualOverride: true,
            ...(newTypeCode === "s" && manualSeason !== null ? { season: manualSeason, manualSeason } : {}),
            ...(newTypeCode === "s" && manualEpisode !== null ? { episode: manualEpisode, manualEpisode } : {})
          }, entryFileMeta, {
            registerAsVipStream,
            bypassNegativeTitleCache: true,
            confirmManualWithoutTmdb: isManualWithoutTmdb,
            allowCreateWithoutVideoFile: true,
            manualOverride: true,
            candidateMeta: effectiveCandidateMeta,
            sourceChannelId: body.sourceChannelId || ""
          });

          if (!resolved || !resolved.ok) {
            return new Response(JSON.stringify({ ok: false, error: "Eintrag konnte nicht geladen oder gespeichert werden." }), { status: 404, headers: corsHeaders });
          }

          // Selbstlernendes Alias-Gedächtnis: Sowohl bereinigten Titel als auch rohen Dateinamen-Stamm mit manualOverride=true in D1 cachen
          const aliasCachePayload = {
            tmdbId: Number(resolved.tmdbId),
            typeCode: resolved.typeCode,
            title: resolved.cleanTitle,
            confidence: 100,
            manualOverride: true,
            source: resolved.metadataSource || (isManualWithoutTmdb ? "Manuell bestätigt" : "Admin-Remap"),
            notFound: false
          };
          const primaryAliasTitle = String(rawEntry.cleanTitle || rawEntry.title || resolved.cleanTitle || "").trim();
          const rawFileStem = String(rawEntry.filename || rawEntry.raw_file_name || "")
            .replace(/\.[a-z0-9]{2,4}$/i, "")
            .replace(/(?:[-_\s.]|^)(?:s\d{1,2}[\s._-]*e\d{1,3}|\d{1,2}x\d{1,3}|staffel[\s._-]*\d+|folge[\s._-]*\d+|episode[\s._-]*\d+|ep[\s._-]*\d+|cd[\s._-]*\d+|part[\s._-]*\d+|teil[\s._-]*\d+)\b.*$/i, "")
            .replace(/[._-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          const aliasCandidates = new Set([primaryAliasTitle, rawFileStem, String(resolved.cleanTitle || "").trim()].filter(s => s && s.length >= 2));
          for (const aliasStr of aliasCandidates) {
            await invalidateOrUpdateTitleResolutionCacheInD1(env, aliasStr, rawEntry.year || resolved.year, newTypeCode, aliasCachePayload);
            if (newTypeCode === "s") {
              await invalidateOrUpdateTitleResolutionCacheInD1(env, aliasStr, "", "s", aliasCachePayload);
            }
          }

          // Falls ein Diagnose-Log-Eintrag (msgId) übergeben wurde, Status direkt in D1 aktualisieren
          const logMsgId = Number(body.msgId || rawEntry.source_message_id || rawEntry.msg_id || 0);
          if (logMsgId > 0 && typeof updateImportDiagnosticLogStatusInD1 === "function") {
            await updateImportDiagnosticLogStatusInD1(env, logMsgId, "OK", resolved.matchedTitle || resolved.cleanTitle, resolved.tmdbId, resolved.typeCode, resolved.season ?? null, resolved.episode ?? null);
          }

          // 3. In Ziel-Playlist eintragen
          if (playlistFolderId && (playlistMode === "watchlist" || playlistMode === "both" || targetChatId === "bot_vip")) {
            await batchSaveIngestedItemsToPlaylist(env, targetChatId, playlistFolderId, [resolved], { playlistMode });
            await flushUserSession(env, targetChatId);
          }

          return new Response(JSON.stringify({
            ok: true,
            matchedItem: {
              typeCode: resolved.typeCode,
              tmdbId: resolved.tmdbId,
              cleanTitle: resolved.cleanTitle,
              matchedTitle: resolved.matchedTitle || resolved.cleanTitle,
              year: resolved.year || "k.A.",
              poster: resolved.poster || "",
              quality: resolved.quality || "1080p",
              codec: resolved.codec || "x264",
              part: resolved.part || null,
              season: resolved.season ?? null,
              episode: resolved.episode || null,
              metadataSource: resolved.metadataSource || (isManualWithoutTmdb ? "Manuell bestätigt" : "TMDb"),
              manualOverride: true,
              confidence: 100
            }
          }), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/preview-manual-id" && request.method === "GET") {
          const typeCode = url.searchParams.get("type") === "s" ? "s" : "m";
          const title = (url.searchParams.get("title") || "").trim();
          const year = (url.searchParams.get("year") || "").trim();
          const preview = await previewManualSyntheticIdInD1(env, typeCode, title, year);
          return new Response(JSON.stringify(preview), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/migrate-synthetic-id" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const oldSyntheticId = Number(body.oldSyntheticId || 0);
          const newTmdbId = Number(body.newTmdbId || 0);
          const typeCode = body.typeCode === "s" ? "s" : "m";
          if (oldSyntheticId < 900000000 || !newTmdbId || newTmdbId >= 900000000) {
            return new Response(JSON.stringify({ ok: false, error: "Bitte eine gültige synthetische 900M-ID und eine echte TMDb-Ziel-ID (< 900M) angeben." }), { status: 400, headers: corsHeaders });
          }

          // 1. Offizielle TMDb-Metadaten für die neue ID laden und mit manualOverride=1 in D1 anlegen
          let officialDetails = null;
          try {
            if (typeCode === "s") {
              officialDetails = await fetchSeriesDetails(env, newTmdbId);
              if (officialDetails && !officialDetails.error) {
                await saveSeriesToD1(env, { ...officialDetails, manualOverride: true });
              }
            } else {
              officialDetails = await fetchMovieDetails(env, newTmdbId);
              if (officialDetails && !officialDetails.error) {
                await saveMovieToD1(env, { ...officialDetails, manualOverride: true });
              }
            }
          } catch (e) {}

          // 2. Alle Episoden, Videodateien, Aliase und Logs von 900M auf die echte TMDb-ID migrieren
          const migrationResult = await migrateSyntheticIdToRealTmdbInD1(env, oldSyntheticId, newTmdbId, typeCode);
          if (!migrationResult || !migrationResult.ok) {
            return new Response(JSON.stringify({ ok: false, error: migrationResult?.error || "Migration fehlgeschlagen." }), { status: 500, headers: corsHeaders });
          }

          // 3. Auch in der VIP-Liste / Ziel-Playlist aktualisieren
          const targetChatId = String(body.targetChatId || auth.chatId || "bot_vip");
          try {
            let list = await getSavedList(env, targetChatId);
            let changed = false;
            const officialTitle = officialDetails?.title || officialDetails?.name || null;
            const officialPoster = officialDetails?.poster_path ? `https://image.tmdb.org/t/p/w342${officialDetails.poster_path}` : null;
            for (const item of list) {
              if (Number(item.tmdbId) === oldSyntheticId) {
                item.tmdbId = newTmdbId;
                if (officialTitle) item.title = officialTitle;
                if (officialPoster) item.poster = officialPoster;
                changed = true;
              }
            }
            if (changed) {
              await saveRawList(env, targetChatId, list);
            }
          } catch (e) {}

          return new Response(JSON.stringify({
            ok: true,
            ...migrationResult,
            officialTitle: officialDetails?.title || officialDetails?.name || null,
            officialYear: (officialDetails?.release_date || officialDetails?.first_air_date || "").slice(0, 4) || null
          }), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/reheal-conflicts" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const rawProblemLogs = Array.isArray(body.items) && body.items.length > 0
            ? body.items
            : await listImportDiagnosticLogsFromD1(env, "PROBLEMS", "", 250);
          const eligibleLogs = (rawProblemLogs || []).filter(item => {
            const st = String(item.status || "").toUpperCase();
            return st === "TMDB_NOT_FOUND" || st === "CONFLICT" || st === "CONFLICT_?";
          });
          const batchLimit = Math.min(Math.max(1, Number(body.limit) || 10), 15);
          const slice = eligibleLogs.slice(0, batchLimit);
          const healedItems = [];
          const stillOpenItems = [];

          for (const logItem of slice) {
            const fileName = String(logItem.fileName || logItem.file_name || "").trim();
            const rawText = String(logItem.rawText || logItem.raw_text || "").trim();
            const msgId = Number(logItem.msgId || logItem.msg_id || 0);
            if (!fileName && !rawText) continue;

            const reparsed = parseMediaFilename(fileName || rawText, rawText);
            if (!reparsed || reparsed.skippedReason) {
              stillOpenItems.push({ msgId, status: logItem.status, reason: reparsed?.skippedReason || "SKIPPED" });
              continue;
            }

            const candidateEntry = {
              cleanTitle: reparsed.title || logItem.parsedTitle || "",
              title: reparsed.title || logItem.parsedTitle || "",
              titleFromFileName: reparsed.titleFromFileName || "",
              titleFromText: reparsed.titleFromText || "",
              year: reparsed.year || logItem.parsedYear || null,
              type: reparsed.isSeries ? "series" : "movie",
              typeCode: reparsed.isSeries ? "s" : "m",
              isSeries: Boolean(reparsed.isSeries),
              season: reparsed.isBonus ? 0 : (reparsed.season ?? null),
              episode: reparsed.episode ?? null,
              isBonus: Boolean(reparsed.isBonus),
              part: reparsed.part || null,
              editionLabel: reparsed.editionLabel || null,
              quality: reparsed.quality || "HD",
              filename: fileName,
              raw_file_name: fileName,
              raw_caption: rawText,
              source_message_id: msgId || null
            };

            const resolved = await resolveAndIngestMediaEntry(env, candidateEntry, null, {
              bypassNegativeTitleCache: true,
              allowCreateWithoutVideoFile: true,
              registerAsVipStream: false
            });

            if (resolved && resolved.ok && resolved.tmdbId && resolved.confidence >= 62) {
              if (msgId > 0 && typeof updateImportDiagnosticLogStatusInD1 === "function") {
                await updateImportDiagnosticLogStatusInD1(env, msgId, "OK", resolved.matchedTitle || resolved.cleanTitle, resolved.tmdbId, resolved.typeCode, resolved.season ?? null, resolved.episode ?? null);
              }
              healedItems.push({
                msgId,
                fileName,
                parsedTitle: candidateEntry.cleanTitle,
                matchedTitle: resolved.matchedTitle || resolved.cleanTitle,
                tmdbId: resolved.tmdbId,
                typeCode: resolved.typeCode,
                year: resolved.year || "k.A.",
                confidence: resolved.confidence || 100
              });
            } else {
              stillOpenItems.push({
                msgId,
                fileName,
                parsedTitle: candidateEntry.cleanTitle,
                status: logItem.status
              });
            }
          }

          return new Response(JSON.stringify({
            ok: true,
            checkedCount: slice.length,
            healedCount: healedItems.length,
            remainingCount: Math.max(0, eligibleLogs.length - slice.length),
            healedItems,
            stillOpenItems
          }), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/import-queue" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          if (body.action === "clear") {
            await clearImportQueueInD1(env);
            const queueStats = await getImportQueueStatsFromD1(env);
            return new Response(JSON.stringify({ ok: true, queueStats }), { status: 200, headers: corsHeaders });
          }
          const rounds = Math.min(Math.max(1, Number(body.rounds) || 2), 3);
          for (let r = 0; r < rounds; r++) {
            const pendingBatch = await fetchPendingImportBatchFromD1(env, 12);
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
              targetChatId: firstEntryMeta?.chatId || auth.chatId,
              playlistFolderId: firstEntryMeta?.folderId || null,
              playlistName: firstEntryMeta?.playlistName || null
            };
            const plCtx = (meta.targetChatId && meta.playlistFolderId)
              ? { chatId: meta.targetChatId, folderId: meta.playlistFolderId, playlistName: meta.playlistName }
              : (firstEntryMeta?.chatId && firstEntryMeta?.folderId ? firstEntryMeta : null);

            const rawEntries = pendingBatch.map(b => b.entry);
            const { moviesAdded, seriesAdded, failedItems } = await processEntriesBatchWithLimit(env, rawEntries, null, plCtx);
            await deleteImportQueueIdsFromD1(env, pendingBatch.map(b => b.id));
            meta.processedCount = Number(meta.processedCount || 0) + pendingBatch.length;
            meta.moviesSaved = Number(meta.moviesSaved || 0) + moviesAdded.length;
            meta.seriesSaved = Number(meta.seriesSaved || 0) + seriesAdded.length;
            meta.failedCount = Number(meta.failedCount || 0) + failedItems.length;
            if (typeof saveImportQueueMetaInD1 === "function") {
              await saveImportQueueMetaInD1(env, meta);
            } else {
              memoryFallback.set("import_queue_meta", meta);
            }
          }
          const queueStats = await getImportQueueStatsFromD1(env);
          return new Response(JSON.stringify({ ok: true, queueStats }), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/vip" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const rawTid = String(body.telegramId || "").trim();
          if (!rawTid || !/^\d{3,20}$/.test(rawTid)) {
            return new Response(JSON.stringify({ ok: false, error: "Ungültige Telegram-User-ID." }), { status: 400, headers: corsHeaders });
          }
          const updatedUser = await setUserVipStatusInD1(env, rawTid, Boolean(body.isVip));
          if (!updatedUser) {
            return new Response(JSON.stringify({ ok: false, error: "VIP-Status konnte nicht in der Datenbank gespeichert werden." }), { status: 500, headers: corsHeaders });
          }
          return new Response(JSON.stringify({ ok: true, user: updatedUser }), { status: 200, headers: corsHeaders });
        }
        if (path === "/api/tma/admin/media" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const typeCode = body.typeCode === "s" ? "s" : "m";
          if (body.action === "delete") {
            const ok = await deleteMediaFromD1(env, typeCode, body.tmdbId);
            return new Response(JSON.stringify({ ok }), { status: 200, headers: corsHeaders });
          }
          if (body.action === "upsert") {
            let targetId = Number(body.tmdbId || 0);
            let details = null;
            const confirmManual = Boolean(body.confirmManualWithoutTmdb);
            if (!targetId && confirmManual && body.title) {
              targetId = await allocateCollisionFreeManualSyntheticId(env, typeCode, String(body.title), body.year ? String(body.year) : "");
            }
            if (targetId && targetId < 8000000) {
              details = typeCode === "s" ? await fetchSeriesDetails(env, targetId) : await fetchMovieDetails(env, targetId);
              if (details) {
                if (typeCode === "s") await saveSeriesToD1(env, details);
                else await saveMovieToD1(env, details);
              }
            } else if (!targetId && body.title && !confirmManual) {
              const ingested = await resolveAndIngestMediaEntry(env, {
                title: String(body.title),
                year: body.year ? String(body.year) : "",
                isSeries: typeCode === "s",
                quality: body.quality || "1080p",
                fileId: body.fileId || null,
                fileSize: body.fileSize || null,
                tags: body.tags || ""
              });
              if (ingested?.ok) {
                return new Response(JSON.stringify({ ok: true, item: ingested }), { status: 200, headers: corsHeaders });
              }
              if (body.allowManualFallback !== false) {
                targetId = await allocateCollisionFreeManualSyntheticId(env, typeCode, String(body.title), body.year ? String(body.year) : "");
              }
            }
            if (!details && targetId && body.title) {
              const cleanYear = body.year && /^\d{4}$/.test(String(body.year).trim()) ? String(body.year).trim() : "";
              const rawCustomPoster = body.poster ? String(body.poster).trim() : "";
              const customPoster = /^https?:\/\/[^\s"'<>]+$/i.test(rawCustomPoster) ? rawCustomPoster : null;
              details = {
                id: targetId,
                title: String(body.title).trim(),
                originalTitle: String(body.title).trim(),
                releaseDate: cleanYear ? `${cleanYear}-01-01` : "Keine Angabe",
                year: cleanYear || "k.A.",
                fsk: "FSK Keine Angabe",
                vote_average: 0,
                runtime: "Keine Angabe",
                country: "k.A.",
                genres: body.genres ? String(body.genres).trim() : "Manuell bestätigt",
                directors: "Keine Angabe",
                casts: "Keine Angabe",
                overview: body.overview ? String(body.overview).trim() : "Manuell ohne TMDb-ID angelegter Titel.",
                poster_path: null,
                external_poster_url: customPoster,
                metadataSource: "Manuell bestätigt",
                ...(typeCode === "s" ? { totalSeasons: 1, totalEpisodes: 1, seasons: [{ season_number: 1, episode_count: 1 }] } : {})
              };
              if (typeCode === "s") await saveSeriesToD1(env, details);
              else await saveMovieToD1(env, details);
            }
            if (details && body.fileId) {
              const sNum = Math.max(1, parseInt(body.season, 10) || 1);
              const eNum = Math.max(1, parseInt(body.episode, 10) || 1);
              if (typeCode === "s") {
                await saveEpisodeFileToD1(env, details.id, sNum, eNum, {
                  fileId: body.fileId,
                  quality: body.quality || "1080p",
                  fileSize: body.fileSize || null,
                  tags: body.tags || ""
                });
              } else {
                await saveMovieFileToD1(env, details.id, {
                  fileId: body.fileId,
                  quality: body.quality || "1080p",
                  fileSize: body.fileSize || null,
                  tags: body.tags || ""
                });
              }
            }
            return new Response(JSON.stringify({ ok: Boolean(details), item: details }), { status: 200, headers: corsHeaders });
          }
        }

        // Visuelle Cover-Galerie (TMDb EN/DE/Textless + Apple iTunes DE + OMDb) für Detail-Modal & Admin
        if (path === "/api/tma/admin/posters" && request.method === "GET") {
          const typeCode = url.searchParams.get("type") === "s" ? "s" : "m";
          const tmdbId = Number(url.searchParams.get("id") || 0);
          const title = String(url.searchParams.get("title") || "").trim();
          const year = String(url.searchParams.get("year") || "").trim();
          const posters = [];
          const seenUrls = new Set();
          const addPosterOption = (pObj) => {
            const key = pObj.poster_path || pObj.external_poster_url || pObj.url;
            if (!key || seenUrls.has(key)) return;
            seenUrls.add(key);
            posters.push(pObj);
          };

          if (isRealTmdbId(tmdbId) && hasTmdbCredentials(env)) {
            const ep = typeCode === "s" ? "tv" : "movie";
            const imgData = await cachedExternalFetchJson(
              `https://api.themoviedb.org/3/${ep}/${tmdbId}/images?include_image_language=de,en,null`,
              { headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` } },
              3800
            );
            const rawPosters = Array.isArray(imgData?.posters) ? imgData.posters : [];
            // Sortiere: Original Englisch ('en') & Deutsch ('de') mit höchster Bewertung zuerst (ideal gegen unpassende Fan-Cover wie bei Men in Black)
            rawPosters.sort((a, b) => {
              const langPrio = (l) => (l === "en" ? 3 : l === "de" ? 2 : 1);
              if (langPrio(b.iso_639_1) !== langPrio(a.iso_639_1)) return langPrio(b.iso_639_1) - langPrio(a.iso_639_1);
              return Number(b.vote_average || 0) - Number(a.vote_average || 0);
            });
            for (const p of rawPosters.slice(0, 18)) {
              if (!p?.file_path) continue;
              const langTag = p.iso_639_1 === "en" ? "Original EN" : p.iso_639_1 === "de" ? "Deutsch DE" : "Textfrei";
              addPosterOption({
                source: "TMDb",
                label: `TMDb (${langTag})`,
                poster_path: p.file_path,
                external_poster_url: "",
                thumb: `https://image.tmdb.org/t/p/w342${p.file_path}`,
                url: `https://image.tmdb.org/t/p/original${p.file_path}`
              });
            }
          }

          if (title) {
            const [itunesHit, omdbHit, aniHit] = await Promise.all([
              fetchItunesFallback(env, title, year || null, typeCode).catch(() => null),
              fetchOmdbFallback(env, title, year || null, typeCode, null).catch(() => null),
              fetchAniListFallback(env, title, year || null, typeCode).catch(() => null)
            ]);
            if (itunesHit?.external_poster_url) {
              addPosterOption({
                source: "Apple iTunes DE",
                label: "Apple iTunes DE (HQ)",
                poster_path: null,
                external_poster_url: itunesHit.external_poster_url,
                thumb: itunesHit.external_poster_url,
                url: itunesHit.external_poster_url
              });
            }
            if (omdbHit?.external_poster_url) {
              addPosterOption({
                source: "OMDb / IMDb",
                label: "IMDb Original-Poster",
                poster_path: null,
                external_poster_url: omdbHit.external_poster_url,
                thumb: omdbHit.external_poster_url,
                url: omdbHit.external_poster_url
              });
            }
            if (aniHit?.external_poster_url) {
              addPosterOption({
                source: "AniList",
                label: "AniList Cover",
                poster_path: null,
                external_poster_url: aniHit.external_poster_url,
                thumb: aniHit.external_poster_url,
                url: aniHit.external_poster_url
              });
            }
          }

          return new Response(JSON.stringify({ ok: true, posters }), { status: 200, headers: corsHeaders });
        }

        // Speichert ein neu gewähltes Cover/Poster dauerhaft in D1 (movies / series), Cache & allen Playlists
        if (path === "/api/tma/admin/update-poster" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const typeCode = body.typeCode === "s" ? "s" : "m";
          const tmdbId = Number(body.tmdbId || 0);
          const posterPath = body.poster_path ? String(body.poster_path).trim() : null;
          const externalPosterUrl = body.external_poster_url ? String(body.external_poster_url).trim() : "";
          if (!Number.isInteger(tmdbId) || tmdbId <= 0 || (!posterPath && !externalPosterUrl)) {
            return new Response(JSON.stringify({ ok: false, error: "Ungültige Titel-ID oder leeres Cover." }), { status: 400, headers: corsHeaders });
          }
          if (posterPath && !/^\/(?!\/)[^\s"'<>]+$/.test(posterPath)) {
            return new Response(JSON.stringify({ ok: false, error: "Ungültiger TMDb-Poster-Pfad." }), { status: 400, headers: corsHeaders });
          }
          if (externalPosterUrl && !/^https?:\/\/[^\s"'<>]+$/i.test(externalPosterUrl)) {
            return new Response(JSON.stringify({ ok: false, error: "Externe Cover-URL muss mit https:// oder http:// beginnen." }), { status: 400, headers: corsHeaders });
          }

          const db = await ensureD1Schema(env);
          if (db) {
            try {
              trackStat("d1Writes");
              const table = typeCode === "s" ? "series" : "movies";
              // movies/series haben keine eigene Spalte external_poster_url -> wird in details_json per json_set gespeichert!
              await db.prepare(
                `UPDATE ${table}
                 SET poster_path = ?1,
                     details_json = CASE
                       WHEN json_valid(details_json) THEN json_set(details_json, '$.poster_path', ?1, '$.external_poster_url', ?2)
                       ELSE details_json
                     END,
                     updated_at = ?3
                 WHERE tmdb_id = ?4`
              )
                .bind(posterPath, externalPosterUrl || "", Date.now(), tmdbId)
                .run();
            } catch (e) {
              return new Response(JSON.stringify({ ok: false, error: "Cover konnte nicht in der Datenbank gespeichert werden." }), { status: 500, headers: corsHeaders });
            }
          }

          const cacheKey = `${typeCode === "s" ? "tv" : "movie"}_${tmdbId}`;
          const cached = getCachedTmdb(cacheKey);
          if (cached) {
            cached.poster_path = posterPath;
            cached.external_poster_url = externalPosterUrl;
            setCachedTmdb(cacheKey, cached);
          }
          for (const mk of [`d1_${typeCode === "s" ? "series" : "movie"}_${tmdbId}`, `d1_catalog_${typeCode === "s" ? "series" : "movie"}_${tmdbId}`]) {
            const memObj = memoryFallback.get(mk);
            if (memObj) {
              memObj.poster_path = posterPath;
              memObj.external_poster_url = externalPosterUrl;
              memoryFallback.set(mk, memObj);
            }
          }
          const posterLookup = memoryFallback.get("d1_poster_lookup_cache");
          if (posterLookup instanceof Map) {
            const resolvedNewPoster = resolvePosterUrl(posterPath, "w185", externalPosterUrl);
            if (resolvedNewPoster) {
              posterLookup.set(`${typeCode}_${tmdbId}`, resolvedNewPoster);
            } else {
              posterLookup.delete(`${typeCode}_${tmdbId}`);
            }
          }
          memoryFallback.delete(`d1_vip_discover_rows_${typeCode}`);
          memoryFallback.delete(`d1_admin_media_list_cache_${typeCode}`);

          await backfillMediaPosterInLists(env, typeCode, tmdbId, posterPath, externalPosterUrl, auth.chatId || null, true);
          return new Response(JSON.stringify({
            ok: true,
            tmdbId,
            typeCode,
            poster_path: posterPath,
            external_poster_url: externalPosterUrl
          }), { status: 200, headers: corsHeaders });
        }

        // Live-Neuzuordnung (Remap) eines falsch zugeordneten Films oder einer Serie inkl. aller verknüpften Stream-Dateien
        if (path === "/api/tma/admin/remap-saved-media" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const oldTypeCode = body.oldTypeCode === "s" ? "s" : "m";
          const oldTmdbId = Number(body.oldTmdbId || 0);
          const newTypeCode = body.newTypeCode === "s" ? "s" : "m";
          const newTmdbId = Number(body.newTmdbId || 0);
          const targetSeason = Math.max(1, Number(body.season || 1));
          const targetEpisode = Math.max(1, Number(body.episode || 1));

          if (!oldTmdbId || !newTmdbId) {
            return new Response(JSON.stringify({ ok: false, error: "Ungültige Quell- oder Ziel-ID." }), { status: 400, headers: corsHeaders });
          }

          // 1. Lade alle bisherigen Stream-Dateien des falsch zugeordneten Eintrags
          let sourceFiles = [];
          if (oldTypeCode === "m") {
            sourceFiles = await getMovieFilesFromD1(env, oldTmdbId);
          } else {
            const db = await ensureD1Schema(env);
            if (db) {
              try {
                const res = await db.prepare("SELECT * FROM episode_files WHERE series_id = ?1").bind(oldTmdbId).all();
                if (Array.isArray(res?.results)) sourceFiles = res.results.map(enrichStreamFileRowMeta);
              } catch (e) {}
            }
            if (sourceFiles.length === 0) {
              for (const [k, v] of memoryFallback.entries()) {
                if (k.startsWith(`d1_ep_files_${oldTmdbId}_`) && Array.isArray(v)) {
                  sourceFiles.push(...v.map(enrichStreamFileRowMeta));
                }
              }
            }
          }

          // 2. Ziel-Metadaten laden & in D1 sichern
          const newDetails = newTypeCode === "s"
            ? await fetchSeriesDetails(env, newTmdbId)
            : await fetchMovieDetails(env, newTmdbId);
          if (!newDetails) {
            return new Response(JSON.stringify({ ok: false, error: "Ziel-Titel konnte nicht geladen werden." }), { status: 404, headers: corsHeaders });
          }

          // 3. Alle Stream-Dateien auf den neuen Film / die neue Serie übertragen
          for (const f of sourceFiles) {
            const filePayload = {
              fileId: f.telegram_file_id,
              fileUniqueId: f.telegram_unique_id || null,
              quality: f.quality || "1080p",
              codec: f.codec || "x264",
              part: f.part || null,
              tags: f.tags || "",
              fileSize: f.file_size || null,
              mimeType: f.mime_type || "video/mp4",
              rawFilename: f.raw_filename || "",
              rawCaption: f.raw_caption || "",
              messageLink: f.message_link || ""
            };
            if (newTypeCode === "s") {
              const sNum = oldTypeCode === "s" ? Number(f.season_number || targetSeason) : targetSeason;
              const eNum = oldTypeCode === "s" ? Number(f.episode_number || targetEpisode) : targetEpisode;
              await saveEpisodeFileToD1(env, newTmdbId, sNum, eNum, filePayload);
            } else {
              await saveMovieFileToD1(env, newTmdbId, filePayload);
            }
          }

          // 4. Alten Fehleintrag aus D1 & Playlists bereinigen (sofern Quell- und Ziel-Eintrag unterschiedlich sind)
          if (oldTmdbId !== newTmdbId || oldTypeCode !== newTypeCode) {
            await deleteMediaFromD1(env, oldTypeCode, oldTmdbId);
          }

          // 5. Offene Fehlermeldungen für den alten Titel automatisch als gelöst markieren
          const resolvedBy = auth.user?.tgUsername ? `@${auth.user.tgUsername}` : String(auth.chatId || "Admin");
          await resolveMatchingMediaReportsInD1(env, {
            typeCode: oldTypeCode,
            tmdbId: oldTmdbId
          }, `${resolvedBy} (Neu zugeordnet zu ${newDetails.title} #${newDetails.id})`).catch(() => null);

          // 6. Neuen Titel zur Bot-VIP-Playlist hinzufügen
          try {
            const botPlaylistChatId = "bot_vip";
            const folders = await getFolders(env, botPlaylistChatId);
            const targetType = newTypeCode === "s" ? "series" : "movie";
            const targetFolder = (Array.isArray(folders) ? folders : []).find(fl => fl.type === targetType)
              || (Array.isArray(folders) ? folders[0] : null)
              || await createOrGetJsonPlaylistFolder(env, botPlaylistChatId, newTypeCode === "s" ? "VIP Serien" : "VIP Filme", "Admin Remap", "both");
            if (targetFolder && targetFolder.id) {
              const rawDate = String(newDetails.releaseDate || newDetails.release_date || newDetails.first_air_date || "");
              const yr = rawDate.split("-")[0] || "k.A.";
              await batchSaveIngestedItemsToPlaylist(env, botPlaylistChatId, targetFolder.id, [{
                ok: true,
                typeCode: newTypeCode,
                tmdbId: newDetails.id,
                cleanTitle: newDetails.title || newDetails.name || "Unbekannt",
                year: yr,
                poster: resolvePosterUrl(newDetails.poster_path, "w342", newDetails.external_poster_url || ""),
                voteAverage: Number(newDetails.vote_average || 0)
              }], { playlistMode: "both" });
            }
          } catch (e) {}

          return new Response(JSON.stringify({
            ok: true,
            newTmdbId: newDetails.id,
            newTypeCode,
            newTitle: newDetails.title,
            movedFilesCount: sourceFiles.length
          }), { status: 200, headers: corsHeaders });
        }

        // Admin-Verwaltung für VIP/Admin-Fehlermeldungen (Auflisten, Als gelöst markieren, Löschen, Komplett leeren)
        if (path === "/api/tma/admin/reports") {
          if (request.method === "GET") {
            const statusFilter = url.searchParams.get("status") || "all";
            const reports = await listMediaReportsFromD1(env, statusFilter);
            const openReportsCount = (reports || []).filter(r => r && r.status === "open").length;
            return new Response(JSON.stringify({ ok: true, reports, openReportsCount }), { status: 200, headers: corsHeaders });
          }
          if (request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const action = String(body.action || "resolve");
            const reportId = Number(body.reportId || 0);
            const resolvedBy = auth.user?.tgUsername ? `@${auth.user.tgUsername}` : String(auth.chatId || "Admin");
            if (action === "clear_all") {
              await clearAllMediaReportsInD1(env, false);
            } else if (action === "clear_resolved") {
              await clearAllMediaReportsInD1(env, true);
            } else if (action === "delete" && reportId > 0) {
              await deleteMediaReportFromD1(env, reportId);
            } else if (reportId > 0) {
              await resolveMediaReportInD1(env, reportId, resolvedBy);
            }
            const reports = await listMediaReportsFromD1(env, "all");
            const openReportsCount = (reports || []).filter(r => r && r.status === "open").length;
            return new Response(JSON.stringify({ ok: true, reports, openReportsCount }), { status: 200, headers: corsHeaders });
          }
        }

        // Granularer "Folgen korrigieren"-Endpunkt (Staffel/Folge verschieben, Schnittfassung wechseln, Einzel-Folge oder ganze Serie neu verknüpfen)
        if (path === "/api/tma/admin/reassign-episode" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const mode = String(body.mode || "move_se"); // "move_se" | "change_version" | "relink_tmdb"
          const scope = String(body.scope || "single_episode"); // "single_episode" | "entire_series"
          const oldTypeCode = body.oldTypeCode === "m" ? "m" : "s";
          const oldTmdbId = Number(body.seriesId || body.oldTmdbId || 0);
          const oldSeason = (body.oldSeason !== undefined && body.oldSeason !== null && body.oldSeason !== "")
            ? Math.max(0, Number(body.oldSeason))
            : 1;
          const oldEpisode = Math.max(1, Number(body.oldEpisode || 1));
          const newSeason = (body.newSeason !== undefined && body.newSeason !== null && body.newSeason !== "")
            ? Math.max(0, Number(body.newSeason))
            : oldSeason;
          const newEpisode = Math.max(1, Number(body.newEpisode || oldEpisode));
          const telegramFileId = String(body.telegramFileId || "").trim();
          const newVersionLabel = normalizeCompactVersionTags(body.newVersionLabel || "Originalfassung") || "Originalfassung";
          const newTmdbId = Number(body.newTmdbId || oldTmdbId);
          const newTypeCode = body.newTypeCode === "m" ? "m" : "s";
          const reportId = Number(body.reportId || 0);
          const autoResolveReport = body.autoResolveReport !== false;
          const resolvedBy = auth.user?.tgUsername ? `@${auth.user.tgUsername}` : String(auth.chatId || "Admin");

          if (!oldTmdbId) {
            return new Response(JSON.stringify({ ok: false, error: "Ungültige Quell-TMDb-ID." }), { status: 400, headers: corsHeaders });
          }

          const db = await ensureD1Schema(env);

          // Hilfsfunktion: Lädt betroffene Quell-Dateien der aktuellen Folge (oder des Films)
          const loadSourceEpisodeOrMovieFiles = async () => {
            if (oldTypeCode === "m") {
              const allM = await getMovieFilesFromD1(env, oldTmdbId);
              if (telegramFileId) {
                const exact = allM.filter(f => String(f.telegram_file_id) === telegramFileId);
                if (exact.length > 0) return exact;
              }
              return allM;
            }
            const epFiles = await getEpisodeFilesFromD1(env, oldTmdbId, oldSeason, oldEpisode);
            if (telegramFileId) {
              const exact = epFiles.filter(f => String(f.telegram_file_id) === telegramFileId);
              if (exact.length > 0) return exact;
            }
            return epFiles;
          };

          // Hilfsfunktion: Entfernt eine verschobene Datei aus der alten Staffel/Folge und baut versions_json neu auf
          const removeOldEpisodeFileRecord = async (fidToRemove) => {
            const normFid = normalizeExportFileIdChannel(fidToRemove);
            const memKey = `d1_ep_files_${oldTmdbId}_${oldSeason}`;
            const existingMem = Array.isArray(memoryFallback.get(memKey)) ? memoryFallback.get(memKey) : [];
            const remainingMem = existingMem.filter(x => {
              if (!x) return false;
              if (Number(x.episode_number) !== oldEpisode) return true;
              return normFid ? (String(x.telegram_file_id) !== normFid && String(x.telegram_file_id) !== String(fidToRemove)) : false;
            });
            memoryFallback.set(memKey, remainingMem);

            if (db) {
              try {
                if (normFid) {
                  await db.prepare("DELETE FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3 AND (telegram_file_id = ?4 OR telegram_file_id = ?5)")
                    .bind(oldTmdbId, oldSeason, oldEpisode, normFid, String(fidToRemove))
                    .run();
                } else {
                  await db.prepare("DELETE FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3")
                    .bind(oldTmdbId, oldSeason, oldEpisode)
                    .run();
                }
                const remRes = await db.prepare("SELECT * FROM episode_files WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3")
                  .bind(oldTmdbId, oldSeason, oldEpisode)
                  .all();
                const remRows = Array.isArray(remRes?.results) ? remRes.results.map(enrichStreamFileRowMeta) : [];
                if (remRows.length === 0) {
                  await db.prepare("DELETE FROM series_episodes WHERE series_id = ?1 AND season_number = ?2 AND episode_number = ?3")
                    .bind(oldTmdbId, oldSeason, oldEpisode)
                    .run();
                } else {
                  const updatedVersionsJson = JSON.stringify(buildEpisodeVersionsArray(remRows));
                  await db.prepare("UPDATE series_episodes SET versions_json = ?1, updated_at = ?2 WHERE series_id = ?3 AND season_number = ?4 AND episode_number = ?5")
                    .bind(updatedVersionsJson, Date.now(), oldTmdbId, oldSeason, oldEpisode)
                    .run();
                }
              } catch (e) {}
            }
          };

          // MODUS 1: Staffel & Folge innerhalb derselben Serie anpassen ("move_se")
          if (mode === "move_se") {
            const filesToMove = await loadSourceEpisodeOrMovieFiles();
            if (filesToMove.length === 0) {
              if (autoResolveReport && reportId > 0) {
                await resolveMediaReportInD1(env, reportId, `${resolvedBy} (Eintrag bereinigt)`);
              }
              return new Response(JSON.stringify({ ok: false, error: "Keine verknüpfte Stream-Datei für diese Episode gefunden (Meldung wurde als erledigt markiert)." }), { status: 404, headers: corsHeaders });
            }
            // Ziel-Episodentitel von TMDb laden
            let targetEpTitle = `Folge ${newEpisode}`;
            try {
              const targetSeasonData = await fetchSeasonDetails(env, oldTmdbId, newSeason);
              const matchedEp = (targetSeasonData?.episodes || []).find(e => Number(e.episode_number) === newEpisode);
              if (matchedEp?.name) targetEpTitle = matchedEp.name;
            } catch (e) {}

            for (const f of filesToMove) {
              if (oldSeason !== newSeason || oldEpisode !== newEpisode) {
                await removeOldEpisodeFileRecord(f.telegram_file_id);
              }
              await saveEpisodeFileToD1(env, oldTmdbId, newSeason, newEpisode, {
                fileId: f.telegram_file_id,
                fileUniqueId: f.telegram_unique_id || null,
                episodeTitle: targetEpTitle,
                quality: f.quality || "1080p",
                codec: f.codec || "x264",
                part: f.part || null,
                tags: f.tags || f.version_label || "Originalfassung",
                version_label: f.version_label || f.versionLabel || "Originalfassung",
                fileSize: f.file_size || null,
                mimeType: f.mime_type || "video/mp4",
                rawFilename: f.raw_filename || "",
                rawCaption: f.raw_caption || "",
                messageLink: f.message_link || ""
              });
            }

            if (autoResolveReport) {
              await resolveMatchingMediaReportsInD1(env, {
                reportId,
                typeCode: "s",
                tmdbId: oldTmdbId,
                seasonNumber: oldSeason,
                episodeNumber: oldEpisode,
                telegramFileId
              }, `${resolvedBy} (Verschoben nach S${String(newSeason).padStart(2, "0")}E${String(newEpisode).padStart(2, "0")})`);
            }

            return new Response(JSON.stringify({
              ok: true,
              mode: "move_se",
              seriesId: oldTmdbId,
              oldSeason,
              oldEpisode,
              newSeason,
              newEpisode,
              newEpisodeTitle: targetEpTitle,
              movedFilesCount: filesToMove.length
            }), { status: 200, headers: corsHeaders });
          }

          // MODUS 2: Version / Schnittfassung wechseln ("change_version")
          if (mode === "change_version") {
            const filesToUpdate = await loadSourceEpisodeOrMovieFiles();
            if (filesToUpdate.length === 0) {
              if (autoResolveReport && reportId > 0) {
                await resolveMediaReportInD1(env, reportId, `${resolvedBy} (Eintrag bereinigt)`);
              }
              return new Response(JSON.stringify({ ok: false, error: "Keine Stream-Datei zum Ändern der Schnittfassung gefunden (Meldung wurde als erledigt markiert)." }), { status: 404, headers: corsHeaders });
            }
            if (oldTypeCode === "m") {
              for (const f of filesToUpdate) {
                await saveMovieFileToD1(env, oldTmdbId, {
                  fileId: f.telegram_file_id,
                  fileUniqueId: f.telegram_unique_id || null,
                  quality: f.quality || "1080p",
                  codec: f.codec || "x264",
                  part: f.part || null,
                  tags: newVersionLabel,
                  fileSize: f.file_size || null,
                  mimeType: f.mime_type || "video/mp4",
                  rawFilename: f.raw_filename || "",
                  rawCaption: f.raw_caption || "",
                  messageLink: f.message_link || ""
                });
              }
            } else {
              for (const f of filesToUpdate) {
                await saveEpisodeFileToD1(env, oldTmdbId, oldSeason, oldEpisode, {
                  fileId: f.telegram_file_id,
                  fileUniqueId: f.telegram_unique_id || null,
                  episodeTitle: f.episode_title || `Folge ${oldEpisode}`,
                  quality: f.quality || "1080p",
                  codec: f.codec || "x264",
                  part: f.part || null,
                  tags: newVersionLabel,
                  version_label: newVersionLabel,
                  versionLabel: newVersionLabel,
                  fileSize: f.file_size || null,
                  mimeType: f.mime_type || "video/mp4",
                  rawFilename: f.raw_filename || "",
                  rawCaption: f.raw_caption || "",
                  messageLink: f.message_link || ""
                });
              }
            }

            if (autoResolveReport) {
              await resolveMatchingMediaReportsInD1(env, {
                reportId,
                typeCode: oldTypeCode,
                tmdbId: oldTmdbId,
                seasonNumber: oldSeason,
                episodeNumber: oldEpisode,
                telegramFileId
              }, `${resolvedBy} (Version: ${newVersionLabel})`);
            }

            return new Response(JSON.stringify({
              ok: true,
              mode: "change_version",
              tmdbId: oldTmdbId,
              typeCode: oldTypeCode,
              season: oldSeason,
              episode: oldEpisode,
              newVersionLabel,
              updatedFilesCount: filesToUpdate.length
            }), { status: 200, headers: corsHeaders });
          }

          // MODUS 3: Mit neuer TMDb-ID verknüpfen ("relink_tmdb" — unterstützt single_episode UND entire_series!)
          if (mode === "relink_tmdb") {
            if (!newTmdbId) {
              return new Response(JSON.stringify({ ok: false, error: "Bitte eine gültige Ziel-TMDb-ID auswählen." }), { status: 400, headers: corsHeaders });
            }
            const newDetails = newTypeCode === "s"
              ? await fetchSeriesDetails(env, newTmdbId)
              : await fetchMovieDetails(env, newTmdbId);
            if (!newDetails) {
              return new Response(JSON.stringify({ ok: false, error: "Ziel-Titel konnte auf TMDb nicht geladen werden." }), { status: 404, headers: corsHeaders });
            }

            let filesToRelink = [];
            if (scope === "entire_series") {
              if (oldTypeCode === "m") {
                filesToRelink = await getMovieFilesFromD1(env, oldTmdbId);
              } else {
                if (db) {
                  try {
                    const res = await db.prepare("SELECT * FROM episode_files WHERE series_id = ?1").bind(oldTmdbId).all();
                    if (Array.isArray(res?.results)) filesToRelink = res.results.map(enrichStreamFileRowMeta);
                  } catch (e) {}
                }
                if (filesToRelink.length === 0) {
                  for (const [k, v] of memoryFallback.entries()) {
                    if (k.startsWith(`d1_ep_files_${oldTmdbId}_`) && Array.isArray(v)) {
                      filesToRelink.push(...v.map(enrichStreamFileRowMeta));
                    }
                  }
                }
              }
            } else {
              // single_episode: NUR diese gewählte Folge / Datei übertragen!
              filesToRelink = await loadSourceEpisodeOrMovieFiles();
            }

            let targetEpTitle = `Folge ${newEpisode}`;
            if (newTypeCode === "s") {
              try {
                const targetSeasonData = await fetchSeasonDetails(env, newTmdbId, newSeason);
                const matchedEp = (targetSeasonData?.episodes || []).find(e => Number(e.episode_number) === newEpisode);
                if (matchedEp?.name) targetEpTitle = matchedEp.name;
              } catch (e) {}
            }

            for (const f of filesToRelink) {
              const destSeason = (scope === "entire_series" && oldTypeCode === "s" && f.season_number !== undefined && f.season_number !== null)
                ? Math.max(0, Number(f.season_number))
                : newSeason;
              const destEpisode = (scope === "entire_series" && oldTypeCode === "s" && f.episode_number !== undefined && f.episode_number !== null)
                ? Math.max(1, Number(f.episode_number))
                : newEpisode;
              const resolvedEpTitle = (scope === "entire_series" && oldTypeCode === "s")
                ? (f.episode_title || `Folge ${destEpisode}`)
                : targetEpTitle;
              const filePayload = {
                fileId: f.telegram_file_id,
                fileUniqueId: f.telegram_unique_id || null,
                episodeTitle: resolvedEpTitle,
                quality: f.quality || "1080p",
                codec: f.codec || "x264",
                part: f.part || null,
                tags: f.tags || f.version_label || "Originalfassung",
                version_label: f.version_label || f.versionLabel || "Originalfassung",
                fileSize: f.file_size || null,
                mimeType: f.mime_type || "video/mp4",
                rawFilename: f.raw_filename || "",
                rawCaption: f.raw_caption || "",
                messageLink: f.message_link || ""
              };
              if (newTypeCode === "s") {
                await saveEpisodeFileToD1(env, newTmdbId, destSeason, destEpisode, filePayload);
              } else {
                await saveMovieFileToD1(env, newTmdbId, filePayload);
              }

              // Bei single_episode nur die verschobene Datei aus der Quell-Serie/Film löschen
              if (scope === "single_episode" && (oldTmdbId !== newTmdbId || oldTypeCode !== newTypeCode || oldSeason !== newSeason || oldEpisode !== newEpisode)) {
                if (oldTypeCode === "s") {
                  await removeOldEpisodeFileRecord(f.telegram_file_id);
                } else {
                  const normMovieFid = normalizeExportFileIdChannel(f.telegram_file_id);
                  const memMovieKey = `d1_movie_files_${oldTmdbId}`;
                  const existingMovieMem = Array.isArray(memoryFallback.get(memMovieKey)) ? memoryFallback.get(memMovieKey) : [];
                  memoryFallback.set(
                    memMovieKey,
                    existingMovieMem.filter(x => x && String(x.telegram_file_id) !== String(f.telegram_file_id) && (!normMovieFid || String(x.telegram_file_id) !== normMovieFid))
                  );
                  memoryFallback.delete(`d1_movie_best_quality_${oldTmdbId}`);
                  if (db) {
                    try {
                      await db.prepare("DELETE FROM movie_files WHERE movie_id = ?1 AND (telegram_file_id = ?2 OR telegram_file_id = ?3)")
                        .bind(oldTmdbId, f.telegram_file_id, normMovieFid || f.telegram_file_id)
                        .run();
                    } catch (e) {}
                  }
                }
              }
            }

            if (scope === "entire_series" && (oldTmdbId !== newTmdbId || oldTypeCode !== newTypeCode)) {
              await deleteMediaFromD1(env, oldTypeCode, oldTmdbId);
            }

            // Ziel-Titel in der Bot-VIP-Playlist registrieren
            try {
              const botPlaylistChatId = "bot_vip";
              const folders = await getFolders(env, botPlaylistChatId);
              const targetType = newTypeCode === "s" ? "series" : "movie";
              const targetFolder = (Array.isArray(folders) ? folders : []).find(fl => fl.type === targetType)
                || (Array.isArray(folders) ? folders[0] : null)
                || await createOrGetJsonPlaylistFolder(env, botPlaylistChatId, newTypeCode === "s" ? "VIP Serien" : "VIP Filme", "Admin Remap", "both");
              if (targetFolder && targetFolder.id) {
                const rawDate = String(newDetails.releaseDate || newDetails.release_date || newDetails.first_air_date || "");
                const yr = rawDate.split("-")[0] || "k.A.";
                await batchSaveIngestedItemsToPlaylist(env, botPlaylistChatId, targetFolder.id, [{
                  ok: true,
                  typeCode: newTypeCode,
                  tmdbId: newDetails.id,
                  cleanTitle: newDetails.title || newDetails.name || "Unbekannt",
                  year: yr,
                  poster: resolvePosterUrl(newDetails.poster_path, "w342", newDetails.external_poster_url || ""),
                  voteAverage: Number(newDetails.vote_average || 0)
                }], { playlistMode: "both" });
              }
            } catch (e) {}

            if (autoResolveReport) {
              await resolveMatchingMediaReportsInD1(env, {
                reportId,
                typeCode: oldTypeCode,
                tmdbId: oldTmdbId,
                seasonNumber: oldSeason,
                episodeNumber: oldEpisode,
                telegramFileId
              }, `${resolvedBy} (Neu verknüpft mit ${newDetails.title} #${newDetails.id})`);
            }

            return new Response(JSON.stringify({
              ok: true,
              mode: "relink_tmdb",
              scope,
              newTmdbId: newDetails.id,
              newTypeCode,
              newTitle: newDetails.title,
              newSeason,
              newEpisode,
              movedFilesCount: filesToRelink.length
            }), { status: 200, headers: corsHeaders });
          }

          return new Response(JSON.stringify({ ok: false, error: "Unbekannter Korrektur-Modus." }), { status: 400, headers: corsHeaders });
        }
      }

      if (path === "/api/tma/discover" && request.method === "GET") {
        const typeCode = url.searchParams.get("type") === "s" ? "s" : "m";
        const genreId = url.searchParams.get("genreId") || "all";
        const companyId = (url.searchParams.get("companyId") || "").trim();
        const mode = url.searchParams.get("mode") || "trend";
        const sortBy = url.searchParams.get("sort") || "pop_desc";
        const page = Math.max(1, Math.min(500, parseInt(url.searchParams.get("page") || "1", 10) || 1));
        const bypass = url.searchParams.get("bypass") === "1";

        // Cloudflare Edge Cache für nicht-personalisierte Guest-Standardansichten (5 Min TTL, 0 D1/TMDb-Last!)
        const canEdgeCacheDiscover = !auth.isAuthenticated && !clientHeaderSettings && mode !== "random";
        const edgeCache = (canEdgeCacheDiscover && typeof caches !== "undefined" && caches && caches.default) ? caches.default : null;
        const discoverCacheKey = edgeCache
          ? new Request(`${url.origin}/api/tma/discover?type=${typeCode}&genreId=${encodeURIComponent(genreId)}&companyId=${encodeURIComponent(companyId)}&mode=${encodeURIComponent(mode)}&sort=${encodeURIComponent(sortBy)}&page=${page}&bypass=${bypass ? 1 : 0}`, { method: "GET" })
          : null;
        if (edgeCache && discoverCacheKey) {
          try {
            const cachedDiscoverRes = await edgeCache.match(discoverCacheKey);
            if (cachedDiscoverRes && cachedDiscoverRes.ok) {
              if (typeof activeWorkerTelemetry === "object" && activeWorkerTelemetry) activeWorkerTelemetry.cacheHit = true;
              return cachedDiscoverRes;
            }
          } catch (_e) {}
        }

        const baseEffectiveSettings = bypass ? { ...settings, filtersActive: false, showUnreleased: true, onlyVipStreams: false } : settings;
        const effectiveSettings = companyId ? { ...baseEffectiveSettings, explicitCompanyId: companyId } : baseEffectiveSettings;
        const lookahead = await fetchFilteredDiscoverWithLookahead(
          env,
          typeCode,
          genreId,
          mode === "random" ? "pop" : mode,
          page,
          sortBy,
          effectiveSettings,
          18,
          bypass
        );
        let visibleItems = lookahead.items || [];
        visibleItems = await applyVipStreamsOnlyFilterIfActive(env, visibleItems, typeCode, effectiveSettings, hasVipStreamAccess);
        let items = mode === "random" && visibleItems.length > 0
          ? [visibleItems[Math.floor(Math.random() * visibleItems.length)]]
          : visibleItems;

        // Seite 1: Gecachte ClearLogos & Beschreibungen gebündelt aus RAM + D1-Batch anreichern; max. 3 fehlende Overviews per TMDb
        if (page === 1 && Array.isArray(items) && items.length > 0) {
          const topCandidates = items.slice(0, 14);
          const missingOvCandidates = topCandidates.filter(it => it && it.id && (!it.overview || !String(it.overview).trim()));
          const [d1LogosMap, d1MetaMap] = await Promise.all([
            typeof getClearLogosBatchFromD1 === "function"
              ? getClearLogosBatchFromD1(env, topCandidates, typeCode).catch(() => new Map())
              : Promise.resolve(new Map()),
            (missingOvCandidates.length > 0 && typeof getMediaMetaBatchFromD1 === "function")
              ? getMediaMetaBatchFromD1(env, missingOvCandidates, typeCode).catch(() => new Map())
              : Promise.resolve(new Map())
          ]);
          for (const it of topCandidates) {
            if (!it || !it.id) continue;
            const isSer = it.media_type === "tv" || typeCode === "s";
            const k = `${isSer ? "s" : "m"}_${Number(it.id)}`;
            if (!it.logo_path && d1LogosMap.has(k) && d1LogosMap.get(k)) {
              it.logo_path = d1LogosMap.get(k);
            }
            if ((!it.overview || !String(it.overview).trim()) && d1MetaMap.has(k)) {
              const cachedDet = d1MetaMap.get(k);
              if (cachedDet?.overview && String(cachedDet.overview).trim() && cachedDet.overview !== "Keine Beschreibung verfügbar.") {
                it.overview = String(cachedDet.overview).trim();
              }
            }
          }
          const stillMissingOv = topCandidates
            .filter(it => it && it.id && (!it.overview || !String(it.overview).trim()))
            .slice(0, 3);
          if (stillMissingOv.length > 0 && hasSubrequestBudget(30)) {
            await Promise.race([
              Promise.all(stillMissingOv.map(async (it) => {
                if (!hasSubrequestBudget(34)) return;
                try {
                  const isSer = it.media_type === "tv" || typeCode === "s";
                  const det = isSer ? await fetchSeriesDetails(env, it.id) : await fetchMovieDetails(env, it.id);
                  if (det && det.overview && String(det.overview).trim() && det.overview !== "Keine Beschreibung verfügbar.") {
                    it.overview = String(det.overview).trim();
                  }
                } catch (_e) {}
              })),
              new Promise(resolve => setTimeout(resolve, 900))
            ]);
          }
        }

        const rawTotalPages = mode === "random" ? 1 : Math.max(1, Number(lookahead.total_pages || 1));
        const hasMoreAfterFilter = mode !== "random" && Boolean(lookahead.hasMore) && items.length > 0 && page < rawTotalPages;
        const totalPages = hasMoreAfterFilter ? rawTotalPages : page;
        const hasMore = Boolean(hasMoreAfterFilter && page < totalPages);
        const totalResults = mode === "random"
          ? items.length
          : Math.max(items.length, Number(lookahead.total_results || items.length));
        const [botUsername, savedList] = await Promise.all([
          tgApi(env).getBotUsername(env),
          auth.isAuthenticated ? getSavedList(env, chatId) : Promise.resolve([])
        ]);
        const savedKeys = (savedList || [])
          .filter(i => (i.contentType === "movie" || i.contentType === "series") && i.tmdbId)
          .map(i => (i.contentType === "series" ? "s_" : "m_") + i.tmdbId);

        const discoverRes = new Response(JSON.stringify({
          ok: true,
          botUsername,
          savedKeys,
          typeCode,
          genreId,
          mode,
          sortBy,
          page,
          totalPages,
          totalResults,
          hasMore,
          rawCount: lookahead.rawCount || items.length,
          filteredOutCount: lookahead.filteredOutCount || 0,
          genres: typeCode === "m" ? MOVIE_GENRES : SERIES_GENRES,
          genreEmojis: GENRE_EMOJIS,
          settings: sanitizeSettingsForClient(settings),
          items
        }), {
          status: 200,
          headers: canEdgeCacheDiscover
            ? { ...corsHeaders, "Cache-Control": "public, max-age=300" }
            : corsHeaders
        });
        if (edgeCache && discoverCacheKey) {
          scheduleBackgroundWork(() => edgeCache.put(discoverCacheKey, discoverRes.clone()));
        }
        return discoverRes;
      }

      if (path === "/api/tma/translate" && (request.method === "POST" || request.method === "GET")) {
        let textToTranslate = "";
        let targetLang = "de";
        if (request.method === "POST") {
          const bodyObj = await request.json().catch(() => ({}));
          textToTranslate = String(bodyObj.text || "").trim();
          targetLang = String(bodyObj.targetLang || "de").trim() || "de";
        } else {
          textToTranslate = String(url.searchParams.get("text") || "").trim();
          targetLang = String(url.searchParams.get("tl") || "de").trim() || "de";
        }
        if (!textToTranslate) {
          return new Response(JSON.stringify({ ok: false, error: "Kein Text übergeben." }), { status: 400, headers: corsHeaders });
        }
        if (!/^[a-z]{2}(?:-[A-Za-z]{2})?$/.test(targetLang)) {
          targetLang = "de";
        }
        const clippedText = textToTranslate.slice(0, 1800);
        const trHash = computeLightweightEtag(`${targetLang}|${clippedText}`).replace(/[^a-zA-Z0-9_-]/g, "");
        const cacheKey = `tr_${targetLang}_${trHash}`;
        if (typeof memoryFallback !== "undefined" && memoryFallback && memoryFallback.has(cacheKey)) {
          return new Response(JSON.stringify({ ok: true, translatedText: memoryFallback.get(cacheKey), cached: true }), { status: 200, headers: corsHeaders });
        }
        const edgeCacheTr = (typeof caches !== "undefined" && caches?.default) ? caches.default : null;
        const trCacheReq = edgeCacheTr ? new Request(`https://teleport-edge-cache.internal/translate/${encodeURIComponent(targetLang)}/${trHash}`, { method: "GET" }) : null;
        if (edgeCacheTr && trCacheReq) {
          try {
            const hitTr = await edgeCacheTr.match(trCacheReq);
            if (hitTr) {
              const hitJson = await hitTr.json().catch(() => null);
              if (hitJson?.translatedText) {
                if (typeof memoryFallback !== "undefined" && memoryFallback) memoryFallback.set(cacheKey, hitJson.translatedText);
                return new Response(JSON.stringify({ ok: true, translatedText: hitJson.translatedText, cached: true }), { status: 200, headers: corsHeaders });
              }
            }
          } catch (_e) {}
        }
        let translatedText = "";
        try {
          if (typeof translator === "function") {
            const trRes = await translator(clippedText, targetLang);
            if (trRes && trRes !== "Keine Beschreibung verfügbar." && trRes.toLowerCase() !== clippedText.toLowerCase()) {
              translatedText = trRes;
            }
          }
        } catch (_tErr) {}
        if (!translatedText) {
          try {
            const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(clippedText)}`;
            const gRes = await fetchWithTimeout(gUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*"
              }
            }, 3800);
            if (gRes.ok) {
              const gData = await gRes.json();
              if (Array.isArray(gData) && Array.isArray(gData[0])) {
                translatedText = gData[0].map(part => (Array.isArray(part) && part[0] ? String(part[0]) : "")).join("").trim();
              }
            }
          } catch (_err) {}
        }
        if (!translatedText) {
          try {
            const mUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clippedText.slice(0, 490))}&langpair=en|${encodeURIComponent(targetLang)}`;
            const mRes = await fetchWithTimeout(mUrl, {}, 3800);
            if (mRes.ok) {
              const mData = await mRes.json();
              if (mData?.responseData?.translatedText) {
                translatedText = String(mData.responseData.translatedText).trim();
              }
            }
          } catch (_err2) {}
        }
        if (translatedText) {
          if (typeof memoryFallback !== "undefined" && memoryFallback) {
            memoryFallback.set(cacheKey, translatedText);
          }
          const trRes = new Response(JSON.stringify({ ok: true, translatedText }), {
            status: 200,
            headers: { ...corsHeaders, "Cache-Control": "public, max-age=604800" }
          });
          if (edgeCacheTr && trCacheReq && typeof scheduleBackgroundWork === "function") {
            scheduleBackgroundWork(() => edgeCacheTr.put(trCacheReq, trRes.clone()));
          }
          return trRes;
        }
        return new Response(JSON.stringify({ ok: false, error: "Übersetzungsdienst vorübergehend nicht erreichbar." }), { status: 502, headers: corsHeaders });
      }

      if (path === "/api/tma/collections" && request.method === "GET") {
        const colId = url.searchParams.get("id");
        const q = (url.searchParams.get("q") || "").trim();
        const sortBy = url.searchParams.get("sort") || "year_asc";
        if (colId) {
          const col = await fetchCollectionDetails(env, colId);
          if (!col) return new Response(JSON.stringify({ ok: false, error: "Filmreihe nicht gefunden" }), { status: 404, headers: corsHeaders });
          const rawParts = (col.parts || []).map(p => ({ ...p, media_type: "movie" }));
          let { visibleItems } = await filterAndSortMediaList(env, rawParts, settings, sortBy);
          visibleItems = await attachVipQualitiesToMediaList(env, visibleItems, "m", hasVipStreamAccess);
          return new Response(JSON.stringify({
            ok: true,
            id: col.id,
            name: col.name,
            overview: col.overview,
            items: visibleItems
          }), { status: 200, headers: corsHeaders });
        }
        if (q) {
          const found = await searchCollectionsTMDB(env, q, 1);
          return new Response(JSON.stringify({
            ok: true,
            results: found?.results || []
          }), { status: 200, headers: corsHeaders });
        }
        return new Response(JSON.stringify({
          ok: true,
          collections: FEATURED_COLLECTIONS
        }), { status: 200, headers: corsHeaders });
      }

      if (path === "/api/tma/universes" && request.method === "GET") {
        const uniId = url.searchParams.get("id");
        const sortBy = url.searchParams.get("sort") || "year_asc";
        if (uniId) {
          const uni = await fetchUniverseDetails(env, uniId);
          if (!uni) return new Response(JSON.stringify({ ok: false, error: "Filmuniversum nicht gefunden" }), { status: 404, headers: corsHeaders });
          let { visibleItems } = await filterAndSortMediaList(env, uni.parts || [], settings, sortBy);
          visibleItems = await attachVipQualitiesToMediaList(env, visibleItems, "m", hasVipStreamAccess);
          return new Response(JSON.stringify({
            ok: true,
            id: uni.id,
            name: uni.name,
            icon: uni.icon,
            description: uni.desc,
            items: visibleItems
          }), { status: 200, headers: corsHeaders });
        }
        return new Response(JSON.stringify({
          ok: true,
          universes: CINEMATIC_UNIVERSES
        }), { status: 200, headers: corsHeaders });
      }

      if (path === "/api/tma/search" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        const scope = (url.searchParams.get("scope") || "all").trim();
        const personIdParam = (url.searchParams.get("personId") || "").trim();
        const sortBy = url.searchParams.get("sort") || "pop_desc";
        const page = Math.max(1, Math.min(500, parseInt(url.searchParams.get("page") || "1", 10) || 1));
        const bypass = url.searchParams.get("bypass") === "1";
        const effectiveSettings = bypass ? { ...settings, filtersActive: false, showUnreleased: true } : settings;

        if (personIdParam) {
          const pData = await fetchPersonDetails(env, personIdParam);
          const rawCredits = pData?.credits || [];
          let { visibleItems } = await filterAndSortMediaList(env, rawCredits, effectiveSettings, sortBy, true);
          visibleItems = await applyVipStreamsOnlyFilterIfActive(env, visibleItems, "m", effectiveSettings, hasVipStreamAccess);
          return new Response(JSON.stringify({
            ok: true,
            query: pData?.name || q,
            personId: personIdParam,
            personName: pData?.name || q,
            page: 1,
            totalPages: 1,
            totalResults: visibleItems.length,
            hasMore: false,
            rawCount: rawCredits.length,
            filteredOutCount: Math.max(0, rawCredits.length - visibleItems.length),
            items: visibleItems,
            collections: [],
            universes: [],
            persons: pData ? [{
              id: pData.id,
              name: pData.name,
              known_for: pData.known_for,
              profile_path: pData.profile_path || "",
              biography: pData.biography || "",
              birthday: pData.birthday || "",
              place_of_birth: pData.place_of_birth || ""
            }] : []
          }), { status: 200, headers: corsHeaders });
        }

        if (!q) {
          return new Response(JSON.stringify({
            ok: true,
            query: "",
            page: 1,
            totalPages: 1,
            totalResults: 0,
            hasMore: false,
            rawCount: 0,
            filteredOutCount: 0,
            items: [],
            collections: [],
            universes: [],
            persons: []
          }), { status: 200, headers: corsHeaders });
        }

        const qLow = q.toLowerCase();
        const strippedQueryForEntities = q.replace(/\(\s*(?:19\d{2}|20[0-3]\d)\s*\)/g, "").trim() || q;
        const qEntityLow = strippedQueryForEntities.toLowerCase();

        // 1. Passende Filmuniversen lokal erkennen
        const matchedUniverses = CINEMATIC_UNIVERSES.filter(u =>
          u.name.toLowerCase().includes(qEntityLow) ||
          u.id.toLowerCase().includes(qEntityLow) ||
          (String(u.description || u.desc || "").toLowerCase().includes(qEntityLow))
        ).slice(0, 5);

        // 2. Passende Filmreihen, Personen & Filmstudios (Edge- & RAM-gecacht via cachedExternalFetchJson) parallel abrufen
        const [searchData, colSearchData, multiRes, companyRes] = await Promise.all([
          searchTMDBPage(env, q, settings, page, sortBy, bypass),
          (page === 1 && hasSubrequestBudget(28)) ? searchCollectionsTMDB(env, strippedQueryForEntities, 1).catch(() => null) : Promise.resolve(null),
          (page === 1 && hasSubrequestBudget(28)) ? cachedExternalFetchJson(
            `https://api.themoviedb.org/3/search/person?query=${encodeURIComponent(strippedQueryForEntities)}&language=de-DE&page=1`,
            { headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` } },
            3200
          ).catch(() => null) : Promise.resolve(null),
          (page === 1 && hasSubrequestBudget(28)) ? cachedExternalFetchJson(
            `https://api.themoviedb.org/3/search/company?query=${encodeURIComponent(strippedQueryForEntities)}&page=1`,
            { headers: { accept: "application/json", Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}` } },
            3200
          ).catch(() => null) : Promise.resolve(null)
        ]);

        const localFeaturedCols = page === 1 ? FEATURED_COLLECTIONS.filter(c => c.name.toLowerCase().includes(qEntityLow)) : [];
        const tmdbCols = (colSearchData?.results || []).map(c => ({ id: c.id, name: c.name, poster_path: c.poster_path }));
        const seenColIds = new Set();
        const matchedCollections = [];
        for (const c of [...localFeaturedCols, ...tmdbCols]) {
          if (!c || !c.id || seenColIds.has(Number(c.id))) continue;
          seenColIds.add(Number(c.id));
          matchedCollections.push({ id: c.id, name: c.name, icon: c.icon || "🍿" });
          if (matchedCollections.length >= 8) break;
        }

        const matchedPersons = (multiRes?.results || []).slice(0, 6).map(p => ({
          id: p.id,
          name: p.name,
          known_for: p.known_for_department || "",
          profile_path: p.profile_path || null
        }));

        const matchedStudios = [];
        const seenCompanyIds = new Set();
        if (page === 1) {
          for (const st of STUDIO_OPTIONS) {
            if (st.label.toLowerCase().includes(qEntityLow) || st.match.some(m => m.includes(qEntityLow) || qEntityLow.includes(m))) {
              const primaryCid = st.companyIds[0];
              if (primaryCid && !seenCompanyIds.has(Number(primaryCid))) {
                seenCompanyIds.add(Number(primaryCid));
                matchedStudios.push({
                  id: primaryCid,
                  companyIds: st.companyIds.join("|"),
                  name: st.label,
                  icon: st.icon || "🏢",
                  presetStudioId: st.id
                });
              }
            }
          }
          for (const comp of (companyRes?.results || [])) {
            if (!comp || !comp.id || seenCompanyIds.has(Number(comp.id))) continue;
            seenCompanyIds.add(Number(comp.id));
            matchedStudios.push({
              id: comp.id,
              companyIds: String(comp.id),
              name: comp.name,
              icon: "🏢",
              presetStudioId: null
            });
            if (matchedStudios.length >= 6) break;
          }
        }

        let visibleItems = (searchData?.allFilteredResults || searchData?.results || []).slice(0, 20);
        let rawCount = searchData?.rawUnfilteredCount || visibleItems.length;
        let isPersonOrColFallback = false;

        // Wenn nach Person, Filmreihe oder Filmstudio (z.B. "Blueprint Pictures") gesucht wurde:
        if (page === 1 && (scope === "person" || (visibleItems.length === 0 && matchedPersons.length > 0)) && matchedPersons[0]?.id) {
          const pDetails = await fetchPersonDetails(env, matchedPersons[0].id);
          if (pDetails && Array.isArray(pDetails.credits) && pDetails.credits.length > 0) {
            const filteredCredits = await filterAndSortMediaList(env, pDetails.credits, effectiveSettings, sortBy, true);
            visibleItems = filteredCredits.visibleItems;
            rawCount = pDetails.credits.length;
            isPersonOrColFallback = true;
          }
        } else if (page === 1 && scope === "collection" && matchedCollections[0]?.id) {
          const colDetails = await fetchCollectionDetails(env, matchedCollections[0].id);
          if (colDetails && Array.isArray(colDetails.parts)) {
            const rawParts = colDetails.parts.map(p => ({ ...p, media_type: "movie" }));
            const filteredParts = await filterAndSortMediaList(env, rawParts, effectiveSettings, sortBy, true);
            visibleItems = filteredParts.visibleItems;
            rawCount = rawParts.length;
            isPersonOrColFallback = true;
          }
        } else if (page === 1 && (scope === "studio" || (visibleItems.length === 0 && matchedStudios.length > 0)) && matchedStudios[0]?.id) {
          const targetCompanyParam = matchedStudios[0].companyIds || String(matchedStudios[0].id);
          const studioSettings = { ...effectiveSettings, explicitCompanyId: targetCompanyParam };
          const [stMovies, stSeries] = await Promise.all([
            fetchGenreBrowsePage(env, "m", "all", "pop", 1, studioSettings, sortBy).catch(() => null),
            fetchGenreBrowsePage(env, "s", "all", "pop", 1, studioSettings, sortBy).catch(() => null)
          ]);
          const combinedStudioItems = [
            ...((stMovies && stMovies.results) || []),
            ...((stSeries && stSeries.results) || [])
          ];
          if (combinedStudioItems.length > 0) {
            const filteredStudio = await filterAndSortMediaList(env, combinedStudioItems, effectiveSettings, sortBy, true);
            visibleItems = filteredStudio.visibleItems.slice(0, 20);
            rawCount = combinedStudioItems.length;
            isPersonOrColFallback = true;
          }
        } else if (scope === "movie") {
          visibleItems = visibleItems.filter(i => i.media_type === "movie");
        } else if (scope === "series") {
          visibleItems = visibleItems.filter(i => i.media_type === "tv");
        }

        visibleItems = await applyVipStreamsOnlyFilterIfActive(env, visibleItems, "m", effectiveSettings, hasVipStreamAccess);

        // Für den Such-Hero-Slider (Seite 1) bereits gecachte ClearLogos direkt aus RAM/D1-Batch mitliefern
        if (page === 1 && Array.isArray(visibleItems) && visibleItems.length >= 2 && typeof getClearLogosBatchFromD1 === "function") {
          const searchHeroSlice = visibleItems.slice(0, 6);
          const sLogosMap = await getClearLogosBatchFromD1(env, searchHeroSlice, "m").catch(() => new Map());
          for (const it of searchHeroSlice) {
            if (!it || !it.id || it.logo_path) continue;
            const k = `${it.media_type === "tv" ? "s" : "m"}_${Number(it.id)}`;
            if (sLogosMap.has(k) && sLogosMap.get(k)) {
              it.logo_path = sLogosMap.get(k);
            }
          }
        }

        const rawTotalPages = isPersonOrColFallback ? 1 : Math.max(1, Number(searchData?.total_pages || 1));
        const hasMoreAfterFilter = !isPersonOrColFallback && visibleItems.length > 0 && page < rawTotalPages;
        const totalPages = hasMoreAfterFilter ? rawTotalPages : page;
        const hasMore = Boolean(hasMoreAfterFilter && page < totalPages);
        const totalResults = isPersonOrColFallback
          ? visibleItems.length
          : Math.max(visibleItems.length, Number(searchData?.total_results || visibleItems.length));

        return new Response(JSON.stringify({
          ok: true,
          query: q,
          scope,
          page,
          totalPages,
          totalResults,
          hasMore,
          rawCount,
          filteredOutCount: searchData?.filteredOutBySettings ? rawCount : 0,
          items: visibleItems,
          collections: matchedCollections,
          universes: page === 1 ? matchedUniverses : [],
          persons: matchedPersons,
          studios: matchedStudios
        }), { status: 200, headers: corsHeaders });
      }

      if (path === "/api/tma/details" && request.method === "GET") {
        const typeCode = url.searchParams.get("type") === "s" ? "s" : "m";
        const id = String(url.searchParams.get("id") || "").trim();
        if (!/^\d+$/.test(id)) {
          return new Response(JSON.stringify({ ok: false, error: "Ungültige Medien-ID." }), { status: 400, headers: corsHeaders });
        }
        const isMovie = typeCode === "m";
        const details = isMovie ? await fetchMovieDetails(env, id) : await fetchSeriesDetails(env, id);
        if (!details) {
          return new Response(JSON.stringify({ ok: false, error: "Not found" }), { status: 404, headers: corsHeaders });
        }
        const title = (details.title || details.name || "Unbekannt").replace(/\s*\(\d{4}\)$/, "");
        const rawDate = details.releaseDate && details.releaseDate !== "Keine Angabe"
          ? details.releaseDate
          : (details.release_date || details.first_air_date || "");
        const year = (rawDate.split("-")[0]) || "K.A.";
        const vote = details.vote_average ? Math.round(details.vote_average * 10) / 10 : "–";

        const isAdminUser = Boolean(auth.user?.isAdmin);
        const canSeeStreams = Boolean(hasVipStreamAccess || isAdminUser);
        // Telegraph wird in TMA-Details NICHT synchron erzeugt (spart externe API-Calls & CPU; bereits vorhandene URL wird direkt genutzt).
        const telegraphUrl = details.telegraphUrl || "";

        const rawCandidateKeys = Array.isArray(details.trailerCandidates) && details.trailerCandidates.length > 0
          ? details.trailerCandidates
          : (details.trailerKey ? [details.trailerKey] : []);

        // Serien-D1-Abfrage dedupliziert: 1 einzige episode_files Abfrage liefert sowohl seasonCounts als auch allStreamFiles!
        const fetchSeriesEpisodeFilesOnce = async () => {
          if (isMovie || !canSeeStreams) return [];
          const db = await ensureD1Schema(env);
          if (db) {
            try {
              const epFilesRes = await db
                .prepare("SELECT id, series_id, season_number, episode_number, telegram_file_id, quality, codec, part, tags, version_label, file_size, raw_filename, raw_caption, message_link, updated_at FROM episode_files WHERE series_id = ?1 ORDER BY season_number ASC, episode_number ASC")
                .bind(details.id)
                .all();
              if (Array.isArray(epFilesRes?.results) && epFilesRes.results.length > 0) {
                return epFilesRes.results.map(enrichStreamFileRowMeta);
              }
            } catch (_e) {}
          }
          if (memoryFallback) {
            const memCollected = [];
            for (const [k, v] of memoryFallback.entries()) {
              if (k.startsWith(`d1_ep_files_${details.id}_`) && Array.isArray(v)) {
                memCollected.push(...v.map(enrichStreamFileRowMeta));
              }
            }
            if (memCollected.length > 0) return memCollected;
          }
          return [];
        };

        const [savedList, movieFiles, botUsername, seriesEpisodeFiles, mediaDownloads, resolvedLogoPath, resolvedTrailersPack] = await Promise.all([
          auth.isAuthenticated ? getSavedList(env, chatId).catch(() => []) : Promise.resolve([]),
          (isMovie && canSeeStreams) ? getMovieFilesFromD1(env, details.id).catch(() => []) : Promise.resolve([]),
          tgApi(env).getBotUsername(env).catch(() => ""),
          fetchSeriesEpisodeFilesOnce(),
          canSeeStreams ? getMediaDownloadsFromD1(env, typeCode, details.id, details).catch(() => []) : Promise.resolve([]),
          resolveMediaClearLogoPath(env, typeCode, details.id, details.logo_path || "").catch(() => details.logo_path || ""),
          typeof resolveTrailerCandidatesWithFallbacks === "function"
            ? resolveTrailerCandidatesWithFallbacks(env, typeCode, details, rawCandidateKeys, details.trailerCandidatesMeta).catch(() => ({ keys: rawCandidateKeys, meta: details.trailerCandidatesMeta || {}, source: rawCandidateKeys.length ? "tmdb" : "none" }))
            : (typeof verifyEmbeddableYoutubeCandidates === "function"
                ? verifyEmbeddableYoutubeCandidates(rawCandidateKeys).then(keys => ({ keys, meta: details.trailerCandidatesMeta || {}, source: keys.length ? "tmdb" : "none" })).catch(() => ({ keys: rawCandidateKeys, meta: details.trailerCandidatesMeta || {}, source: rawCandidateKeys.length ? "tmdb" : "none" }))
                : Promise.resolve({ keys: rawCandidateKeys, meta: details.trailerCandidatesMeta || {}, source: rawCandidateKeys.length ? "tmdb" : "none" }))
        ]);

        // Poster-Backfill NUR asynchron im Hintergrund UND nur wenn der Eintrag in der Merkliste wirklich noch kein Poster hat!
        const matchedSavedItem = (savedList || []).find(i => String(i.tmdbId) === String(details.id) && i.contentType !== "episode");
        if (matchedSavedItem && (!matchedSavedItem.poster || String(matchedSavedItem.poster).includes("placeholder")) && (details.poster_path || details.external_poster_url)) {
          scheduleBackgroundWork(() => backfillMediaPosterInLists(env, typeCode, details.id, details.poster_path, details.external_poster_url || "", auth.isAuthenticated ? chatId : null));
        }

        // seasonCounts direkt aus den einmalig geladenen seriesEpisodeFiles berechnen (kein zweiter D1-Read!)
        const seasonCounts = {};
        if (!isMovie && Array.isArray(seriesEpisodeFiles) && seriesEpisodeFiles.length > 0) {
          const epSetsBySeason = new Map();
          for (const ef of seriesEpisodeFiles) {
            const sn = (ef.season_number !== undefined && ef.season_number !== null && ef.season_number !== "")
              ? Number(ef.season_number)
              : 1;
            const en = Number(ef.episode_number || 1);
            if (sn >= 0) {
              if (!epSetsBySeason.has(sn)) epSetsBySeason.set(sn, new Set());
              epSetsBySeason.get(sn).add(en);
            }
          }
          for (const [sn, epSet] of epSetsBySeason.entries()) {
            seasonCounts[sn] = epSet.size;
          }
        }
        const vipSeasonsSorted = Object.keys(seasonCounts).map(Number).filter(n => n > 0).sort((a, b) => a - b);
        const firstVipSeason = vipSeasonsSorted[0] ?? (Number(seasonCounts[0] || 0) > 0 ? 0 : 1);
        const isSaved = Boolean(matchedSavedItem);
        const candidateKeys = Array.isArray(resolvedTrailersPack?.keys) && resolvedTrailersPack.keys.length > 0
          ? resolvedTrailersPack.keys
          : [];
        const trailerSource = String(resolvedTrailersPack?.source || (candidateKeys.length > 0 ? "tmdb" : "none"));
        const ytKey = candidateKeys[0] || "";
        const rawMergedMeta = resolvedTrailersPack?.meta || details.trailerCandidatesMeta;
        const trailerMetaMap = typeof resolveYoutubeTrailerCandidatesMeta === "function"
          ? resolveYoutubeTrailerCandidatesMeta(candidateKeys, rawMergedMeta)
          : {};
        if (ytKey && rawMergedMeta && rawMergedMeta[ytKey]?.source && trailerMetaMap[ytKey]) {
          trailerMetaMap[ytKey].source = rawMergedMeta[ytKey].source;
        }
        const primaryTrailerLang = String(trailerMetaMap[ytKey]?.lang || "").toLowerCase();
        const autoEnableSubtitles = primaryTrailerLang === "en";
        const hasTrailer = Boolean(ytKey);
        const trailers = ytKey ? {
          key: ytKey,
          lang: primaryTrailerLang,
          source: trailerSource,
          candidates: candidateKeys,
          meta: trailerMetaMap,
          youtube: `https://www.youtube.com/watch?v=${ytKey}`,
          piped: `https://piped.video/watch?v=${ytKey}`,
          invidious1: `https://yewtu.be/watch?v=${ytKey}`,
          invidious2: `https://inv.nadeko.net/watch?v=${ytKey}`,
          invidiousDe: `https://invidious.nerdvpn.de/watch?v=${ytKey}`,
          poketube: `https://poketube.fun/watch?v=${ytKey}`,
          embeds: {
            youtube: `https://www.youtube-nocookie.com/embed/${ytKey}?autoplay=1&mute=0&controls=0&disablekb=1&fs=0&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3&cc_load_policy=${autoEnableSubtitles ? 1 : 0}${autoEnableSubtitles ? "&cc_lang_pref=de" : ""}&autohide=1&playsinline=1&enablejsapi=1&hl=de`,
            piped: `https://piped.video/embed/${ytKey}?autoplay=1`,
            invidious1: `https://yewtu.be/embed/${ytKey}?autoplay=1`,
            invidious2: `https://inv.nadeko.net/embed/${ytKey}?autoplay=1`,
            invidiousDe: `https://invidious.nerdvpn.de/embed/${ytKey}?autoplay=1`
          }
        } : null;

        // Prüfen, ob der Film/die Serie zu einem bekannten Filmuniversum gehört
        const matchedUniverse = detectUniverseForItem(typeCode, details);
        const providerButtons = buildStreamingProviderButtons(details);
        const shareData = buildUnifiedTelegramSharePost({
          typeCode,
          itemId: details.id,
          title,
          releaseYear: year,
          voteAverage: vote,
          genres: details.genres || "",
          fsk: details.fsk || "",
          overview: details.overview || "",
          posterUrl: resolvePosterUrl(details.poster_path, "w500", details.external_poster_url || ""),
          telegraphUrl: telegraphUrl || "",
          botUsername: botUsername || ""
        });

        // Für VIPs (Tab "Versionen") & Admins (inkl. Original-Dateiname & Telegram-Link) verknüpfte Episoden-/Film-Dateien bereitstellen
        const allStreamFiles = isMovie ? movieFiles : seriesEpisodeFiles;

        const availableVersions = Array.from(new Set(
          (allStreamFiles || []).map(f => extractEpisodeVersionLabel(f)).filter(Boolean)
        ));
        const primaryVersionLabel = availableVersions.find(v => v.toLowerCase().includes("netflix")) ||
          availableVersions[0] ||
          (details.activeGroupName ? normalizeCompactVersionTags(details.activeGroupName) : "") ||
          "";

        const sanitizedStreamFiles = (hasVipStreamAccess || isAdminUser)
          ? (allStreamFiles || []).map(f => isAdminUser ? f : {
              id: f.id,
              series_id: f.series_id,
              movie_id: f.movie_id,
              season_number: f.season_number,
              episode_number: f.episode_number,
              telegram_file_id: f.telegram_file_id,
              quality: f.quality,
              codec: f.codec,
              part: f.part,
              tags: f.tags,
              version_label: f.version_label || f.versionLabel || "Originalfassung",
              versionLabel: f.versionLabel || f.version_label || "Originalfassung",
              file_size: f.file_size
            })
          : [];

        return new Response(JSON.stringify({
          ok: true,
          botUsername,
          id: details.id,
          typeCode,
          title,
          year,
          vote,
          fsk: details.fsk || "Ungeprüft",
          runtime: details.runtime || "",
          country: details.country || "",
          statusText: details.statusText || "",
          numberOfSeasons: Math.max(Number(details.numberOfSeasons || 0), vipSeasonsSorted.length),
          numberOfEpisodes: details.numberOfEpisodes || 0,
          seasonCounts,
          firstVipSeason,
          genres: details.genres || "",
          studios: details.studios || "",
          studiosList: details.studiosList || [],
          providers: details.providers || details.allProviders || "",
          providerButtons,
          directors: details.directors || "",
          directorsList: details.directorsList || [],
          casts: details.casts || "",
          castList: details.castList || [],
          overview: details.overview || "",
          poster_path: details.poster_path,
          external_poster_url: details.external_poster_url || "",
          backdrop_path: details.backdrop_path,
          logo_path: resolvedLogoPath || details.logo_path || "",
          collection: details.collection || null,
          universe: matchedUniverse,
          telegraphUrl,
          tmdbDeUrl: `https://www.themoviedb.org/${isMovie ? "movie" : "tv"}/${details.id}?language=de-DE`,
          isSaved,
          hasTrailer,
          trailerSource,
          trailers,
          files: movieFiles,
          downloads: mediaDownloads,
          allStreamFiles: sanitizedStreamFiles,
          availableVersions,
          primaryVersionLabel,
          shareData
        }), { status: 200, headers: corsHeaders });
      }

      if (path === "/api/tma/similar" && request.method === "GET") {
        const typeCode = url.searchParams.get("type") === "s" ? "s" : "m";
        const id = url.searchParams.get("id") || "";
        const sortBy = url.searchParams.get("sort") || "pop_desc";
        const forceOnlyVip = url.searchParams.get("onlyVip") === "1" || Boolean(settings?.onlyVipStreams);
        if (!id) {
          return new Response(JSON.stringify({ ok: false, error: "Keine ID angegeben" }), { status: 400, headers: corsHeaders });
        }
        const simData = await fetchSimilarMedia(env, typeCode, id, 1);
        const rawItems = simData?.results || [];
        let { visibleItems } = await filterAndSortMediaList(env, rawItems, settings, sortBy, true);
        visibleItems = await attachVipQualitiesToMediaList(env, visibleItems, typeCode, hasVipStreamAccess);
        if (forceOnlyVip && hasVipStreamAccess) {
          visibleItems = visibleItems.filter(it => Boolean(it && it.vipQuality));
          if (visibleItems.length < 10 && typeof fetchVipStreamsDiscoverFromD1 === "function") {
            try {
              const d1Sim = await fetchVipStreamsDiscoverFromD1(env, typeCode, "all", "trend", 1, sortBy, settings, 16);
              if (d1Sim && Array.isArray(d1Sim.items)) {
                const seenIds = new Set([String(id), ...visibleItems.map(x => String(x.id))]);
                const extraVip = await attachVipQualitiesToMediaList(
                  env,
                  d1Sim.items.filter(x => x && x.id && !seenIds.has(String(x.id))),
                  typeCode,
                  hasVipStreamAccess
                );
                for (const ex of extraVip) {
                  if (ex && ex.vipQuality && !seenIds.has(String(ex.id))) {
                    seenIds.add(String(ex.id));
                    visibleItems.push(ex);
                    if (visibleItems.length >= 12) break;
                  }
                }
              }
            } catch (e) {}
          }
        }
        return new Response(JSON.stringify({
          ok: true,
          typeCode,
          id,
          onlyVipFiltered: Boolean(forceOnlyVip && hasVipStreamAccess),
          items: visibleItems
        }), { status: 200, headers: corsHeaders });
      }

      if (path === "/api/tma/share-in-bot" && request.method === "POST") {
        if (!auth.isAuthenticated) {
          return new Response(JSON.stringify({ ok: false, error: "Bitte zuerst über Telegram öffnen oder einloggen, um den Post im Bot-Chat zu erhalten." }), { status: 403, headers: corsHeaders });
        }
        const body = await request.json().catch(() => ({}));
        const typeCode = (body.type || body.typeCode) === "s" ? "s" : "m";
        const id = String(body.id || "").trim();
        if (!id) {
          return new Response(JSON.stringify({ ok: false, error: "Ungültige Titel-ID" }), { status: 400, headers: corsHeaders });
        }
        await showSharePostOverlay(env, auth.chatId, typeCode, id);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
      }

      // Fehlermeldungs-Endpunkt ("Fehler melden") — strikt für freigeschaltete VIP-Mitglieder und Admins
      if (path === "/api/tma/reports" && request.method === "POST") {
        if (!auth.isAuthenticated || (!hasVipStreamAccess && !auth.user?.isAdmin)) {
          return new Response(JSON.stringify({
            ok: false,
            error: "Nur freigeschaltete VIP-Mitglieder und Administratoren können Fehlermeldungen einreichen."
          }), { status: 403, headers: corsHeaders });
        }
        const body = await request.json().catch(() => ({}));
        const tmdbId = Number(body.tmdbId || 0);
        if (!tmdbId) {
          return new Response(JSON.stringify({ ok: false, error: "Ungültige Titel-ID." }), { status: 400, headers: corsHeaders });
        }
        const REASON_MAP = {
          wrong_media: "🎬 Falscher Film / Falsche Serie",
          wrong_episode: "🔢 Falsche Staffel- oder Folgennummer",
          broken_video: "❌ Video defekt / Lädt nicht",
          audio_sub: "🔇 Tonspur / Sprache fehlt oder asynchron",
          other: "💬 Sonstiges"
        };
        const reasonCode = String(body.reasonCode || "other").trim();
        const reasonLabel = REASON_MAP[reasonCode] || String(body.reasonLabel || "💬 Sonstiges").trim();
        const savedReport = await createMediaReportInD1(env, {
          reporterTelegramId: auth.chatId || auth.user?.telegramId || "vip_user",
          reporterUsername: auth.user?.tgUsername || auth.user?.customUsername || "",
          typeCode: body.typeCode === "s" ? "s" : "m",
          tmdbId,
          title: body.title || "Unbekannt",
          seasonNumber: body.seasonNumber,
          episodeNumber: body.episodeNumber,
          episodeTitle: body.episodeTitle || "",
          telegramFileId: body.telegramFileId || "",
          versionLabel: body.versionLabel || "",
          reasonCode,
          reasonLabel,
          note: body.note || ""
        });
        await notifyAdminsOnTelegramForReport(env, savedReport);
        return new Response(JSON.stringify({ ok: true, report: savedReport }), { status: 200, headers: corsHeaders });
      }

      if (path === "/api/tma/season" && request.method === "GET") {
        const seriesId = String(url.searchParams.get("seriesId") || "").trim();
        const seasonNum = parseInt(String(url.searchParams.get("season") || "1"), 10);
        if (!/^\d+$/.test(seriesId) || !Number.isFinite(seasonNum) || seasonNum < 0) {
          return new Response(JSON.stringify({ ok: false, error: "Ungültige Serien- oder Staffelnummer." }), { status: 400, headers: corsHeaders });
        }
        // VIP-Regel: Episoden-Streams & Qualitäten werden ausschließlich für VIP-Mitglieder abgefragt und ausgeliefert!
        const [sDetails, seasonData, savedList, seasonFiles, d1SeasonMeta] = await Promise.all([
          fetchSeriesDetails(env, seriesId),
          fetchSeasonDetails(env, seriesId, seasonNum),
          auth.isAuthenticated ? getSavedList(env, chatId) : Promise.resolve([]),
          hasVipStreamAccess ? getEpisodeFilesFromD1(env, seriesId, seasonNum, null) : Promise.resolve([]),
          getSeriesSeasonsAndEpisodeTitlesFromD1(env, seriesId, seasonNum, hasVipStreamAccess)
        ]);
        const seasonCounts = d1SeasonMeta?.seasonCounts || {};
        const epTitleMap = d1SeasonMeta?.episodeTitleMap || new Map();

        const seasonSet = new Set(
          (sDetails?.seasons || []).filter(s => s && (Number(s.season_number) > 0 || (Number(s.season_number) === 0 && (Number(seasonCounts[0] || 0) > 0 || seasonNum === 0)))).map(s => Number(s.season_number))
        );
        for (const sKey of Object.keys(seasonCounts)) {
          const sn = Number(sKey);
          if (sn > 0 || (sn === 0 && Number(seasonCounts[0] || 0) > 0)) seasonSet.add(sn);
        }
        if (seasonNum === 0) seasonSet.add(0);
        if (seasonSet.size === 0) seasonSet.add(1);
        const seasons = Array.from(seasonSet).sort((a, b) => a - b);

        // Bestimme die exakte Folgenanzahl der aktiven Episode-Group / Staffel (z.B. 13 Folgen bei Haus des Geldes S01)
        const sMeta = (sDetails?.seasons || []).find(s => Number(s.season_number) === Number(seasonNum));
        const rawSeasonEpisodeCount = Number(
          seasonData?.seasonEpisodeCount ||
          (seasonData?.isEpisodeGroup && Array.isArray(seasonData?.episodes) ? seasonData.episodes.length : 0) ||
          sMeta?.episode_count ||
          0
        );
        const highestUploadedEp = Math.max(0, ...(seasonFiles || []).map(f => Number(f.episode_number || 0)));
        const isForceGroupSeries = FORCE_EPISODE_GROUP_SERIES.has(Number(seriesId));
        const seasonEpisodeCount = (isForceGroupSeries && rawSeasonEpisodeCount > 0)
          ? rawSeasonEpisodeCount
          : Math.max(rawSeasonEpisodeCount, highestUploadedEp);

        // Free-Plan Schutz: Karteileichen-Bereinigung nur asynchron im Hintergrund (ctx.waitUntil) und max. 1x pro Isolate & Staffel!
        if (seasonEpisodeCount > 0) {
          const pruneKey = `pruned_ghost_ep_${seriesId}_${seasonNum}`;
          if (!memoryFallback.get(pruneKey)) {
            memoryFallback.set(pruneKey, Date.now());
            const pruneTask = () => pruneGhostEpisodesInD1(env, seriesId, seasonNum, seasonEpisodeCount).catch(() => {});
            if (typeof scheduleBackgroundWork === "function") {
              scheduleBackgroundWork(pruneTask);
            }
          }
        }

        // Kombiniere Episoden der aktiven Fassung mit verknüpften Dateien unter strikter Beachtung von seasonEpisodeCount
        const tmdbEpisodes = Array.isArray(seasonData?.episodes) ? seasonData.episodes : [];
        const epMap = new Map();
        for (const ep of tmdbEpisodes) {
          if (!ep || !ep.episode_number) continue;
          const eNum = Number(ep.episode_number);
          if (seasonEpisodeCount > 0 && eNum > seasonEpisodeCount) continue;
          const d1EpMeta = epTitleMap.get(eNum);
          epMap.set(eNum, {
            episode_number: eNum,
            season_number: seasonNum,
            name: ep.name || d1EpMeta?.title || (typeof d1EpMeta === "string" ? d1EpMeta : "") || `Folge ${eNum}`,
            overview: ep.overview || d1EpMeta?.overview || "",
            vote_average: ep.vote_average || d1EpMeta?.vote_average || 0,
            still_path: ep.still_path || "",
            air_date: ep.air_date || "",
            runtime: ep.runtime || ""
          });
        }
        for (const f of (seasonFiles || [])) {
          const eNum = Number(f.episode_number || 1);
          if (isForceGroupSeries && seasonEpisodeCount > 0 && eNum > seasonEpisodeCount) continue;
          if (!epMap.has(eNum)) {
            const d1EpMeta = epTitleMap.get(eNum);
            epMap.set(eNum, {
              episode_number: eNum,
              season_number: seasonNum,
              name: d1EpMeta?.title || (typeof d1EpMeta === "string" ? d1EpMeta : "") || f.episode_title || `Folge ${eNum}`,
              overview: d1EpMeta?.overview || "",
              vote_average: d1EpMeta?.vote_average || 0,
              still_path: "",
              air_date: "",
              runtime: ""
            });
          }
        }
        for (const [eNum, eMeta] of epTitleMap.entries()) {
          const num = Number(eNum);
          if (seasonEpisodeCount > 0 && num > seasonEpisodeCount) continue;
          if (!epMap.has(num)) {
            epMap.set(num, {
              episode_number: num,
              season_number: seasonNum,
              name: eMeta?.title || (typeof eMeta === "string" ? eMeta : "") || `Folge ${num}`,
              overview: eMeta?.overview || "",
              vote_average: eMeta?.vote_average || 0,
              still_path: "",
              air_date: "",
              runtime: ""
            });
          }
        }

        const seasonDownloads = hasVipStreamAccess
          ? (seasonFiles || []).filter(f => f && (f.is_download_only || f.isDownloadOnly || f.isArchive || f.type === "archive" || f.codec === "ARCHIVE"))
          : [];
        const mergedRawEpisodes = Array.from(epMap.values()).sort((a, b) => a.episode_number - b.episode_number);
        const rawEpisodesArray = mergedRawEpisodes.map(ep => {
          const isSaved = savedList.some(
            i => i.contentType === "episode" &&
                String(i.seriesId) === String(seriesId) &&
                Number(i.seasonNumber) === Number(seasonNum) &&
                Number(i.episodeNumber) === Number(ep.episode_number)
          );
          const epFiles = hasVipStreamAccess
            ? (seasonFiles || [])
                .filter(f => Number(f.episode_number) === Number(ep.episode_number) && !f.is_download_only && !f.isDownloadOnly && !f.isArchive && f.type !== "archive" && f.codec !== "ARCHIVE")
                .map(f => ({
                  ...f,
                  versionLabel: extractEpisodeVersionLabel(f),
                  tags: normalizeCompactVersionTags(f.tags)
                }))
            : [];
          const d1EpMeta = epTitleMap.get(Number(ep.episode_number));
          const epVersions = hasVipStreamAccess
            ? buildEpisodeVersionsArray(epFiles, d1EpMeta?.versions_json)
            : [];
          return {
            episode_number: ep.episode_number,
            season_number: seasonNum,
            name: ep.name || `Folge ${ep.episode_number}`,
            overview: ep.overview || "",
            vote_average: ep.vote_average || 0,
            still_path: ep.still_path || "",
            air_date: ep.air_date || "",
            runtime: ep.runtime || "",
            isSaved,
            files: epFiles,
            versions: epVersions
          };
        });

        // Die "Max. 1 aktive Gruppe / Keine Addition"-Regel + Schutz hochgeladener Dateien:
        const maxAllowedEpisodes = Number(seasonEpisodeCount || 0);
        const finalEpisodesList = maxAllowedEpisodes > 0
          ? rawEpisodesArray.filter(ep => Number(ep.episode_number) <= maxAllowedEpisodes).slice(0, maxAllowedEpisodes)
          : rawEpisodesArray;
        const episodes = finalEpisodesList;
        if (maxAllowedEpisodes > 0 && seasonCounts[seasonNum] > maxAllowedEpisodes) {
          seasonCounts[seasonNum] = maxAllowedEpisodes;
        }

        return new Response(JSON.stringify({ ok: true, seriesId, seasonNum, seasons, seasonCounts, seasonEpisodeCount, episodes, downloads: seasonDownloads }), {
          status: 200,
          headers: corsHeaders
        });
      }

      // =========================================================================
      // KV ACTIVITY LOG & RETENTION POLICY (7 / 30 / 90 DAYS AUTO-PRUNE + KV TTL)
      // =========================================================================
      const normalizeWorkerRetentionDays = (val) => {
        const n = Number(val);
        return (n === 7 || n === 30 || n === 90) ? n : 30;
      };

      if (path === "/api/tma/stream" && request.method === "POST") {
        const reqStartMs = Date.now();
        const body = await request.json().catch(() => ({}));
        const kvBotToken = String((await kvCachedGetRaw(env, "TG_CUSTOM_BOT_TOKEN", "MOVIE_SAVED")) || "").trim();
        const kvDefaultChatId = String((await kvCachedGetRaw(env, "TG_DEFAULT_CHAT_ID", "MOVIE_SAVED")) || "").trim();
        const customBotToken = String(body.customBotToken || kvBotToken || "").trim();
        // Strenge Auth- & VIP-/Admin-Prüfung (kein Bypass durch customBotToken oder globale KV-Defaults!)
        if (!auth.isAuthenticated) {
          return new Response(JSON.stringify({ ok: false, error: "Im Gast-Modus nicht verfügbar. Bitte zuerst einloggen oder über Telegram öffnen." }), { status: 403, headers: corsHeaders });
        }
        if (!hasVipStreamAccess && !auth.user?.isAdmin) {
          return new Response(JSON.stringify({ ok: false, error: "Streams & Qualitäten sind exklusiv für VIP-Mitglieder und Administratoren freigeschaltet." }), { status: 403, headers: corsHeaders });
        }

        const savedDeliv = (settings && settings.deliveryConfig && typeof settings.deliveryConfig === "object")
          ? settings.deliveryConfig
          : {};
        const targetMode = String(body.targetMode || savedDeliv.targetMode || "dm").trim();
        const targetGroupChatId = String(body.targetGroupChatId || savedDeliv.targetGroupChatId || "").trim();
        const targetTopicId = String(body.targetTopicId || savedDeliv.targetTopicId || "").trim();
        const sourceBridgeChatId = String(body.sourceBridgeChatId || savedDeliv.sourceBridgeChatId || "").trim();
        const effectiveCustomToken = customBotToken || String(savedDeliv.customBotToken || "").trim();

        const isAdminStreamCaller = Boolean(auth.user?.isAdmin);
        const usingOwnCustomBot = Boolean(effectiveCustomToken && effectiveCustomToken !== String(env.TELEGRAM_BOT_TOKEN || "").trim());
        let targetChat = "";
        if (targetMode === "group" && targetGroupChatId) {
          if (!isAdminStreamCaller && !usingOwnCustomBot && !targetGroupChatId.startsWith("-")) {
            return new Response(JSON.stringify({ ok: false, error: "Gruppen-Zustellung über den Haupt-Bot erfordert eine gültige Gruppen-/Kanal-ID (beginnend mit -)." }), { status: 403, headers: corsHeaders });
          }
          targetChat = targetGroupChatId;
        } else {
          // Nicht-Admins dürfen im DM-Modus über den Haupt-Bot ausschließlich an ihren eigenen Chat senden (IDOR-/Spam-Schutz)
          targetChat = (isAdminStreamCaller || usingOwnCustomBot)
            ? String(body.chatId || kvDefaultChatId || auth.chatId || "").trim()
            : String(auth.chatId || "").trim();
        }

        const fileId = String(body.fileId || "").trim();
        const cleanTitle = String(body.title || "Stream").trim();
        const quality = String(body.quality || "1080p").trim();
        const fileSizeStr = formatFileSizeBytes(body.fileSize);
        const tagsStr = String(body.tags || "").trim();
        const posterUrl = String(body.posterUrl || "").trim();
        const backdropUrl = String(body.backdropUrl || "").trim();
        const tmdbId = body.tmdbId ? Number(body.tmdbId) : null;
        const typeCode = String(body.typeCode || "").trim();
        if (!fileId || !targetChat || targetChat === "guest") {
          return new Response(JSON.stringify({ ok: false, error: "Bitte gültige Datei-Referenz und Ziel-Chat-ID (bzw. Gruppen-ID) angeben." }), { status: 400, headers: corsHeaders });
        }
        const extraLines = [
          `🎞️ *Qualität:* \`${escapeMd(quality)}\``,
          fileSizeStr ? `📦 *Größe:* \`${escapeMd(fileSizeStr)}\`` : "",
          tagsStr ? `🏷️ *Info:* \`${escapeMd(tagsStr)}\`` : ""
        ].filter(Boolean).join("\n");
        const caption = `🎬 *${escapeMd(cleanTitle)}*\n${extraLines}`;

        const methodLabel = fileId.startsWith("tmdb_card_")
          ? "sendMessage"
          : fileId.startsWith("tg_export_")
            ? "copyMessage"
            : "sendVideo";

        const resolveOpenMessageInfo = async (sentPayload = null) => {
          const msgObj = (sentPayload && typeof sentPayload === "object")
            ? (sentPayload.result && typeof sentPayload.result === "object" ? sentPayload.result : sentPayload)
            : null;
          const rawMsgId = Number(msgObj?.message_id || 0);
          const messageId = Number.isInteger(rawMsgId) && rawMsgId > 0 ? rawMsgId : null;
          const chatUsername = String(msgObj?.chat?.username || "").replace(/^@/, "").trim();
          const cleanTopic = targetTopicId && /^\d+$/.test(targetTopicId) ? targetTopicId : "";
          const targetStr = String(targetChat || "").trim();

          let resolvedBotUsername = "";
          if (usingOwnCustomBot) {
            resolvedBotUsername = String(body.customBotUsername || savedDeliv.customBotUsername || "").replace(/^@/, "").trim();
            if (!resolvedBotUsername && effectiveCustomToken) {
              resolvedBotUsername = await tgApi({ ...env, TELEGRAM_BOT_TOKEN: effectiveCustomToken }).getBotUsername(env).catch(() => "");
            }
          } else if (env.TELEGRAM_BOT_TOKEN) {
            resolvedBotUsername = await tgApi(env).getBotUsername(env).catch(() => "");
          }
          resolvedBotUsername = String(resolvedBotUsername || "").replace(/^@/, "").trim();

          if (chatUsername && /^[A-Za-z0-9_]{3,64}$/.test(chatUsername)) {
            const pathSuffix = messageId
              ? (cleanTopic ? `/${cleanTopic}/${messageId}` : `/${messageId}`)
              : (cleanTopic ? `/${cleanTopic}` : "");
            return {
              messageId,
              openMessageUrl: `https://t.me/${chatUsername}${pathSuffix}`,
              isDirectMessageLink: Boolean(messageId),
              botUsername: resolvedBotUsername
            };
          }
          if (targetStr.startsWith("-100")) {
            const internalId = targetStr.slice(4);
            if (/^\d+$/.test(internalId)) {
              const pathSuffix = messageId
                ? (cleanTopic ? `/${cleanTopic}/${messageId}` : `/${messageId}`)
                : (cleanTopic ? `/${cleanTopic}` : "");
              return {
                messageId,
                openMessageUrl: `https://t.me/c/${internalId}${pathSuffix}`,
                isDirectMessageLink: Boolean(messageId),
                botUsername: resolvedBotUsername
              };
            }
          }
          return {
            messageId,
            openMessageUrl: resolvedBotUsername ? `https://t.me/${resolvedBotUsername}` : "",
            isDirectMessageLink: false,
            botUsername: resolvedBotUsername
          };
        };

        // 0. Prüfe strikte Telegram Anti-Spam-Grenzwerte (Single-Chat 1.15s, Gruppe 18/60s, Global 25/1s, 429 Cooldown)
        await hydrateAntiSpamStateFromStorage(env);
        const slotCheck = evaluateAntiSpamSlot(targetChat, methodLabel, true);
        if (!slotCheck.canSendNow || body.forceQueue) {
          const queuedJob = await enqueueAntiSpamJob(env, {
            chatId: targetChat,
            title: cleanTitle,
            quality,
            fileId,
            caption,
            targetMode,
            targetTopicId,
            sourceBridgeChatId,
            customBotToken: effectiveCustomToken,
            posterUrl,
            backdropUrl,
            tmdbId,
            typeCode,
            method: methodLabel,
            reason: slotCheck.reason,
            reasonCode: slotCheck.reasonCode,
            scheduledAt: slotCheck.scheduledAt
          }, ctx);

          await recordAndPruneWorkerActivityLog(env, {
            eventType: "delivery",
            status: "success",
            deliveryMode: targetMode,
            method: `${methodLabel} (Queued #${queuedJob.position})`,
            title: `${cleanTitle} (${quality})`,
            targetChatId: targetChat,
            durationMs: Date.now() - reqStartMs,
            summary: `⏳ Anti-Spam Warteschleife Pos. #${queuedJob.position} (${slotCheck.reason})`
          });

          const queuedLinkInfo = await resolveOpenMessageInfo(null);
          return new Response(JSON.stringify({
            ok: true,
            queued: true,
            targetChat,
            ...queuedLinkInfo,
            job: queuedJob,
            antiSpam: getAntiSpamSnapshot(env, targetChat),
            message: `⏳ Anti-Spam Schutz aktiv: „${cleanTitle}“ wurde auf Position #${queuedJob.position} eingereiht.`
          }), { status: 200, headers: corsHeaders });
        }

        // Spezialfall: Reine TMDb-Karten-Übermittlung aus dem ResponseInspector (falls noch kein Stream-File verknüpft ist)
        if (fileId.startsWith("tmdb_card_")) {
          const apiToken = effectiveCustomToken || env.TELEGRAM_BOT_TOKEN;
          if (!apiToken) {
            await recordAndPruneWorkerActivityLog(env, {
              eventType: "delivery",
              status: "success",
              deliveryMode: targetMode,
              method: "sendMessage (sandbox)",
              title: cleanTitle,
              targetChatId: targetChat,
              durationMs: Date.now() - reqStartMs,
              summary: `Simulierter Karten-Versand „${cleanTitle}“ an ${targetChat}`
            });
            const simCardLinkInfo = await resolveOpenMessageInfo({ result: { message_id: Math.floor(Date.now() % 900000) + 100 } });
            return new Response(JSON.stringify({
              ok: true,
              simulated: true,
              targetChat,
              ...simCardLinkInfo,
              antiSpam: getAntiSpamSnapshot(env, targetChat),
              message: `Simulierter Versand von „${cleanTitle}“ an ${targetChat} (Kein TELEGRAM_BOT_TOKEN in env gesetzt).`
            }), { status: 200, headers: corsHeaders });
          }
          const msgRes = await tgApi({ ...env, TELEGRAM_BOT_TOKEN: apiToken }).sendMessage(
            targetChat,
            caption,
            targetTopicId && /^\d+$/.test(targetTopicId) ? { message_thread_id: parseInt(targetTopicId, 10) } : {}
          );
          if (!msgRes) {
            await recordAndPruneWorkerActivityLog(env, {
              eventType: "delivery",
              status: "error",
              deliveryMode: targetMode,
              method: "sendMessage",
              title: cleanTitle,
              targetChatId: targetChat,
              durationMs: Date.now() - reqStartMs,
              summary: `Fehler beim Senden der Medienkarte an ${targetChat}`,
              errorDetails: "Telegram sendMessage failed"
            });
            return new Response(JSON.stringify({ ok: false, error: "Telegram-Bot konnte die Medienkarte nicht an den Ziel-Chat senden.", antiSpam: getAntiSpamSnapshot(env, targetChat) }), { status: 500, headers: corsHeaders });
          }
          await recordAndPruneWorkerActivityLog(env, {
            eventType: "delivery",
            status: "success",
            deliveryMode: targetMode,
            method: "sendMessage",
            title: cleanTitle,
            targetChatId: targetChat,
            durationMs: Date.now() - reqStartMs,
            summary: `Medienkarte „${cleanTitle}“ an ${targetChat} gesendet`
          });
          const cardLinkInfo = await resolveOpenMessageInfo(msgRes);
          return new Response(JSON.stringify({ ok: true, targetChat, ...cardLinkInfo, antiSpam: getAntiSpamSnapshot(env, targetChat) }), { status: 200, headers: corsHeaders });
        }

        // Gebundene Untertitel (.srt, .vtt, .sub) zu dieser Datei aus D1 / Memory ermitteln
        let boundSubtitles = Array.isArray(body.subtitles) ? body.subtitles : [];
        if (boundSubtitles.length === 0) {
          try {
            const db = await ensureD1Schema(env);
            if (db) {
              const mSubRow = await db.prepare("SELECT subtitles_json FROM movie_files WHERE telegram_file_id = ?1 LIMIT 1").bind(fileId).first().catch(() => null);
              if (mSubRow?.subtitles_json) {
                const parsed = JSON.parse(mSubRow.subtitles_json);
                if (Array.isArray(parsed)) boundSubtitles = parsed;
              } else {
                const eSubRow = await db.prepare("SELECT subtitles_json FROM episode_files WHERE telegram_file_id = ?1 LIMIT 1").bind(fileId).first().catch(() => null);
                if (eSubRow?.subtitles_json) {
                  const parsed = JSON.parse(eSubRow.subtitles_json);
                  if (Array.isArray(parsed)) boundSubtitles = parsed;
                }
              }
            }
          } catch (_) {}
        }

        const isSubtitleOnlyRequest = Boolean(body.subtitleOnly);

        // Wenn in der lokalen Sandbox weder TELEGRAM_BOT_TOKEN noch customBotToken gesetzt ist, liefere saubere Simulations-Bestätigung
        if (!env.TELEGRAM_BOT_TOKEN && !effectiveCustomToken) {
          const simCoverUrl = isSubtitleOnlyRequest
            ? ""
            : await resolveVideoCoverUrlForDelivery(env, { posterUrl, backdropUrl, tmdbId, typeCode }).catch(() => "");
          await recordAndPruneWorkerActivityLog(env, {
            eventType: "delivery",
            status: "success",
            deliveryMode: targetMode,
            method: isSubtitleOnlyRequest ? "sendSubtitle (sandbox)" : (fileId.startsWith("tg_export_") ? "copyMessage (sandbox)" : "sendVideo (sandbox)"),
            title: `${cleanTitle} (${quality})`,
            targetChatId: targetChat,
            durationMs: Date.now() - reqStartMs,
            summary: `Stream „${cleanTitle}“ (${quality}) an ${targetChat} übermittelt (Sandbox${simCoverUrl ? " + 🖼️ Cover" : ""})`
          });
          const simLinkInfo = await resolveOpenMessageInfo({ result: { message_id: Math.floor(Date.now() % 900000) + 100 } });
          return new Response(JSON.stringify({
            ok: true,
            simulated: true,
            targetChat,
            ...simLinkInfo,
            subtitlesSentCount: boundSubtitles.length,
            copiedFromSourceGroup: fileId.startsWith("tg_export_"),
            coverEmbedded: Boolean(simCoverUrl),
            coverUrl: simCoverUrl || null,
            antiSpam: getAntiSpamSnapshot(env, targetChat),
            message: `Stream „${cleanTitle}“ (${quality}) an ${targetChat} übermittelt (Sandbox-Modus).`
          }), { status: 200, headers: corsHeaders });
        }

        // Falls der Nutzer gezielt auf den separaten "💬 Untertitel"-Button geklickt hat: Nur Untertitel senden
        if (isSubtitleOnlyRequest) {
          if (boundSubtitles.length === 0) {
            return new Response(JSON.stringify({ ok: false, error: "Für diese Datei sind keine verknüpften Untertitel hinterlegt." }), { status: 404, headers: corsHeaders });
          }
          let subtitlesSentCount = 0;
          let lastSubRes = null;
          for (const sub of boundSubtitles) {
            const subFid = String(sub?.file_id || "").trim();
            if (!subFid) continue;
            const subCap = `💬 *Untertitel:* \`${escapeMd(sub.file_name || "subtitle.srt")}\`\n🎬 *Zu:* ${escapeMd(cleanTitle)}`;
            const sRes = await tgApi(env).deliverMediaOrCopyFromSource(targetChat, subFid, subCap, {
              customBotToken: effectiveCustomToken,
              messageThreadId: targetTopicId,
              sourceBridgeChatId,
              disableCover: true
            }).catch(() => null);
            if (sRes) {
              subtitlesSentCount++;
              lastSubRes = sRes;
            }
          }
          const subLinkInfo = await resolveOpenMessageInfo(lastSubRes);
          return new Response(JSON.stringify({
            ok: subtitlesSentCount > 0,
            targetChat,
            ...subLinkInfo,
            subtitlesSentCount,
            antiSpam: getAntiSpamSnapshot(env, targetChat)
          }), { status: subtitlesSentCount > 0 ? 200 : 500, headers: corsHeaders });
        }

        const sent = await tgApi(env).deliverMediaOrCopyFromSource(targetChat, fileId, caption, {
          customBotToken: effectiveCustomToken,
          messageThreadId: targetTopicId,
          sourceBridgeChatId,
          posterUrl,
          backdropUrl,
          tmdbId,
          typeCode
        });

        if (!sent) {
          // Prüfe ob ein 429 Flood-Wait aufgetreten ist -> automatisch in Warteschleife einreihen!
          if (antiSpamState.floodWaitUntil > Date.now()) {
            const queued429 = await enqueueAntiSpamJob(env, {
              chatId: targetChat,
              title: cleanTitle,
              quality,
              fileId,
              caption,
              targetMode,
              targetTopicId,
              sourceBridgeChatId,
              customBotToken: effectiveCustomToken,
              posterUrl,
              backdropUrl,
              tmdbId,
              typeCode,
              method: methodLabel,
              reason: `Telegram 429 retry_after (${antiSpamState.lastRetryAfterSec || 5}s)`,
              reasonCode: "flood_429",
              scheduledAt: antiSpamState.floodWaitUntil
            }, ctx);
            return new Response(JSON.stringify({
              ok: true,
              queued: true,
              targetChat,
              job: queued429,
              ...await resolveOpenMessageInfo(null),
              antiSpam: getAntiSpamSnapshot(env, targetChat)
            }), { status: 200, headers: corsHeaders });
          }

          const isExportRef = fileId.startsWith("tg_export_");
          const errMsg = isExportRef
            ? "Datei konnte nicht per copyMessage aus der Quellgruppe kopiert werden. Stelle sicher, dass der Bot Mitglied der Quellgruppe und des Ziel-Chats ist."
            : "Telegram-Bot konnte die Datei nicht an den gewählten Chat / die Gruppe senden.";
          await recordAndPruneWorkerActivityLog(env, {
            eventType: "delivery",
            status: "error",
            deliveryMode: targetMode,
            method: isExportRef ? "copyMessage" : "sendVideo",
            title: `${cleanTitle} (${quality})`,
            targetChatId: targetChat,
            durationMs: Date.now() - reqStartMs,
            summary: `Zustellung fehlgeschlagen für „${cleanTitle}“ an ${targetChat}`,
            errorDetails: errMsg
          });
          return new Response(JSON.stringify({
            ok: false,
            error: errMsg,
            antiSpam: getAntiSpamSnapshot(env, targetChat)
          }), { status: 500, headers: corsHeaders });
        }

        // Automatisch verknüpfte Untertitel (.srt / .vtt / .sub) direkt nach dem Video mitsenden!
        let subtitlesSentCount = 0;
        if (boundSubtitles.length > 0) {
          for (const sub of boundSubtitles) {
            const subFid = String(sub?.file_id || "").trim();
            if (!subFid) continue;
            const subCap = `💬 *Untertitel:* \`${escapeMd(sub.file_name || "subtitle.srt")}\`\n🎬 *Zu:* ${escapeMd(cleanTitle)}`;
            const sRes = await tgApi(env).deliverMediaOrCopyFromSource(targetChat, subFid, subCap, {
              customBotToken: effectiveCustomToken,
              messageThreadId: targetTopicId,
              sourceBridgeChatId,
              disableCover: true
            }).catch(() => null);
            if (sRes) subtitlesSentCount++;
          }
        }

        await recordAndPruneWorkerActivityLog(env, {
          eventType: "delivery",
          status: "success",
          deliveryMode: targetMode,
          method: sent.copiedFromSourceGroup ? (sent.coverEmbedded ? "copyMessage + editMediaCover" : "copyMessage") : (sent.coverEmbedded ? "sendVideo (cover)" : "sendVideo"),
          title: `${cleanTitle} (${quality})`,
          targetChatId: targetChat,
          harvestedFileId: sent.harvestedFileId || null,
          durationMs: Date.now() - reqStartMs,
          summary: `„${cleanTitle}“ (${quality}) erfolgreich an ${targetChat} gesendet${sent.coverEmbedded ? " (+ 🖼️ Cover)" : ""}${subtitlesSentCount > 0 ? ` (+${subtitlesSentCount} UT)` : ""}`
        });
        const sentLinkInfo = await resolveOpenMessageInfo(sent);
        return new Response(JSON.stringify({
          ok: true,
          targetChat,
          ...sentLinkInfo,
          subtitlesSentCount,
          copiedFromSourceGroup: Boolean(sent.copiedFromSourceGroup),
          harvestedFileId: sent.harvestedFileId || null,
          coverEmbedded: Boolean(sent.coverEmbedded),
          coverUrl: sent.coverUrl || null,
          antiSpam: getAntiSpamSnapshot(env, targetChat)
        }), { status: 200, headers: corsHeaders });
      }

      if (path === "/api/tma/custom-bot/verify" && request.method === "POST") {
        if (!auth.isAuthenticated || (!auth.user?.isAdmin && !hasVipStreamAccess)) {
          return new Response(JSON.stringify({ ok: false, error: "Zugriff verweigert: Nur für angemeldete VIP-Nutzer oder Administratoren." }), { status: 403, headers: corsHeaders });
        }
        const reqStartMs = Date.now();
        const body = await request.json().catch(() => ({}));
        const botToken = String(body.botToken || "").trim();
        if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
          return new Response(JSON.stringify({ ok: false, error: "Ungültiges Telegram Bot-Token Format." }), { status: 400, headers: corsHeaders });
        }
        const meRes = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/getMe`, {}, 4000);
        const meJson = meRes.ok ? await meRes.json() : null;
        if (!meJson || !meJson.ok || !meJson.result) {
          await recordAndPruneWorkerActivityLog(env, {
            eventType: "token_check",
            status: "error",
            deliveryMode: "custom_bot",
            method: "getMe",
            title: "Custom Bot Verifizierung",
            durationMs: Date.now() - reqStartMs,
            summary: "Bot-Token wurde von der Telegram API abgelehnt",
            errorDetails: meJson?.description || "Unauthorized / invalid token"
          });
          return new Response(JSON.stringify({ ok: false, error: "Bot-Token wurde von der Telegram API abgelehnt." }), { status: 400, headers: corsHeaders });
        }
        const botUsername = meJson.result.username || "";
        const firstName = meJson.result.first_name || "CustomBot";
        const baseWebhookOrigin = resolveCleanWorkerOrigin(env, url.origin);
        const webhookUrl = `${baseWebhookOrigin}/api/telegram/custom-webhook?botToken=${encodeURIComponent(botToken)}`;
        const customSecretToken = typeof computeCustomBotWebhookSecret === "function"
          ? await computeCustomBotWebhookSecret(env, botToken)
          : "";
        let webhookRegistered = false;
        if (body.registerWebhook) {
          try {
            const setWebhookPayload = {
              url: webhookUrl,
              allowed_updates: ["message", "channel_post", "callback_query", "inline_query"]
            };
            if (customSecretToken) {
              setWebhookPayload.secret_token = customSecretToken;
            }
            const whRes = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/setWebhook`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(setWebhookPayload)
            }, 4500);
            const whJson = whRes.ok ? await whRes.json() : null;
            webhookRegistered = Boolean(whJson && whJson.ok);
            if (webhookRegistered && customSecretToken && typeof saveEntityToD1 === "function") {
              await saveEntityToD1(env, `custom_bot_reg_${customSecretToken.slice(0, 24)}`, "custom_bot_reg", {
                ownerChatId: String(auth.chatId || ""),
                botId: Number(meJson.result.id || 0),
                botUsername,
                registeredAt: Date.now()
              }).catch(() => {});
            }
          } catch (e) {}
        }
        await recordAndPruneWorkerActivityLog(env, {
          eventType: webhookRegistered ? "webhook" : "token_check",
          status: "success",
          deliveryMode: "custom_bot",
          method: webhookRegistered ? "getMe + setWebhook" : "getMe",
          title: `@${botUsername || firstName}`,
          durationMs: Date.now() - reqStartMs,
          summary: `Custom Bot @${botUsername || firstName} verifiziert${webhookRegistered ? " & Webhook mit Secret-Token verbunden" : ""}`
        });
        return new Response(JSON.stringify({
          ok: true,
          botId: meJson.result.id,
          botUsername,
          firstName,
          webhookUrl,
          webhookRegistered,
          hasSecretToken: Boolean(customSecretToken)
        }), { status: 200, headers: corsHeaders });
      }

      if (path === "/api/tma/activity-log") {
        if (!auth.isAuthenticated || (!auth.user?.isAdmin && !hasVipStreamAccess)) {
          return new Response(JSON.stringify({ ok: false, error: "Zugriff verweigert: Anmeldung erforderlich." }), { status: 403, headers: corsHeaders });
        }
        if (request.method === "GET") {
          const result = await recordAndPruneWorkerActivityLog(env, null, null);
          return new Response(JSON.stringify({
            ok: true,
            retentionDays: result.retentionDays,
            ttlSeconds: result.ttlSeconds,
            prunedCount: result.prunedCount,
            entries: result.entries
          }), { status: 200, headers: corsHeaders });
        }
        if (request.method === "POST") {
          if (!auth.user?.isAdmin) {
            return new Response(JSON.stringify({ ok: false, error: "Zugriff verweigert: Nur Administratoren dürfen das Activity-Log ändern." }), { status: 403, headers: corsHeaders });
          }
          const body = await request.json().catch(() => ({}));
          if (body.action === "clear_log") {
            const retentionDays = await getWorkerRetentionDays(env, settings?.deliveryConfig?.retentionDays);
            memoryFallback.set("TG_ACTIVITY_LOG_JSON", []);
            memoryFallback.set("TG_ACTIVITY_LOG_JSON_ts", Date.now());
            const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
            if (hasD1 && typeof saveEntityToD1 === "function") {
              await saveEntityToD1(env, "TG_ACTIVITY_LOG_JSON", "activity_log", []);
            } else {
              await kvStageWrite(env, "TG_ACTIVITY_LOG_JSON", [], {
                bindingName: "MOVIE_SAVED",
                expirationTtl: retentionDays * 86400,
                flushNow: true
              });
            }
            return new Response(JSON.stringify({ ok: true, entries: [], retentionDays }), { status: 200, headers: corsHeaders });
          }
          if (body.action === "set_retention") {
            const nextDays = normalizeWorkerRetentionDays(body.retentionDays);
            const result = await recordAndPruneWorkerActivityLog(env, null, nextDays);
            return new Response(JSON.stringify({
              ok: true,
              retentionDays: result.retentionDays,
              ttlSeconds: result.ttlSeconds,
              prunedCount: result.prunedCount,
              entries: result.entries
            }), { status: 200, headers: corsHeaders });
          }
          return new Response(JSON.stringify({ ok: false, error: "Unbekannte Aktion." }), { status: 400, headers: corsHeaders });
        }
      }

      if (path === "/api/tma/anti-spam-queue") {
        if (!auth.isAuthenticated) {
          return new Response(JSON.stringify({
            ok: false,
            code: "AUTH_REQUIRED",
            error: "Anmeldung erforderlich (HTTP 401).",
            authFailureReason: auth.authFailureReason || "no_credentials"
          }), { status: 401, headers: corsHeaders });
        }
        if (!auth.user?.isAdmin && !hasVipStreamAccess) {
          return new Response(JSON.stringify({
            ok: false,
            code: "VIP_OR_ADMIN_REQUIRED",
            error: "Zugriff verweigert: VIP- oder Admin-Status erforderlich."
          }), { status: 403, headers: corsHeaders });
        }
        if (!antiSpamState.hydratedFromStorage) {
          await hydrateAntiSpamStateFromStorage(env);
        }
        const focusChat = String(url.searchParams.get("chatId") || auth.chatId || "").trim();
        if (request.method === "GET") {
          const shouldDrain = url.searchParams.get("drain") !== "0" && antiSpamState.queue.length > 0;
          if (shouldDrain) {
            const drained = await drainAntiSpamQueue(env, 4, false);
            return new Response(JSON.stringify({
              ok: true,
              drainedCount: drained.drainedCount,
              snapshot: getAntiSpamSnapshot(env, focusChat),
              _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null
            }), { status: 200, headers: corsHeaders });
          }
          return new Response(JSON.stringify({
            ok: true,
            drainedCount: 0,
            snapshot: getAntiSpamSnapshot(env, focusChat),
            _workerHealth: typeof buildWorkerHealthSnapshot === "function" ? buildWorkerHealthSnapshot({ route: path }) : null
          }), { status: 200, headers: corsHeaders });
        }
        if (request.method === "POST") {
          if (!auth.user?.isAdmin) {
            return new Response(JSON.stringify({ ok: false, error: "Zugriff verweigert: Nur Administratoren dürfen die Anti-Spam-Warteschlange steuern." }), { status: 403, headers: corsHeaders });
          }
          const body = await request.json().catch(() => ({}));
          const action = String(body.action || "drain").trim();
          if (action === "drain") {
            const drained = await drainAntiSpamQueue(env, Number(body.maxJobs) || 8, Boolean(body.forceImmediate));
            return new Response(JSON.stringify({
              ok: true,
              drainedCount: drained.drainedCount,
              snapshot: getAntiSpamSnapshot(env, focusChat)
            }), { status: 200, headers: corsHeaders });
          }
          if (action === "simulate_burst") {
            const count = Math.min(15, Math.max(2, Number(body.count) || 5));
            const simChat = String(body.chatId || focusChat || "-1001987654321").trim();
            const simMode = String(body.targetMode || (simChat.startsWith("-") ? "group" : "dm")).trim();
            const sampleTitles = [
              { title: "Dune: Part Two", quality: "4K HDR" },
              { title: "Severance S02E01 - Hello, Ms. Cobel", quality: "1080p" },
              { title: "The Batman", quality: "4K DV" },
              { title: "Fallout S01E01 - The End", quality: "1080p" },
              { title: "Oppenheimer (CD1)", quality: "4K IMAX" },
              { title: "Oppenheimer (CD2)", quality: "4K IMAX" },
              { title: "Shōgun S01E01 - Anjin", quality: "1080p" }
            ];
            let immediateCount = 0;
            let queuedCount = 0;
            for (let i = 0; i < count; i++) {
              const sample = sampleTitles[i % sampleTitles.length];
              const slot = evaluateAntiSpamSlot(simChat, "sendVideo", true);
              if (slot.canSendNow) {
                immediateCount += 1;
                await recordAndPruneWorkerActivityLog(env, {
                  eventType: "delivery",
                  status: "success",
                  deliveryMode: simMode,
                  method: "sendVideo (Burst #1 Immediate)",
                  title: `${sample.title} (${sample.quality})`,
                  targetChatId: simChat,
                  durationMs: 42,
                  summary: `⚡ Burst #1 sofort zugestellt an ${simChat} (innerhalb Limit)`
                });
              } else {
                queuedCount += 1;
                await enqueueAntiSpamJob(env, {
                  chatId: simChat,
                  title: sample.title,
                  quality: sample.quality,
                  fileId: `sim_burst_${Date.now()}_${i}`,
                  caption: `🎬 *${sample.title}* (${sample.quality})`,
                  targetMode: simMode,
                  method: "sendVideo",
                  reason: slot.reason,
                  reasonCode: slot.reasonCode,
                  scheduledAt: slot.scheduledAt
                }, ctx);
              }
            }
            return new Response(JSON.stringify({
              ok: true,
              immediateCount,
              queuedCount,
              snapshot: getAntiSpamSnapshot(env, simChat)
            }), { status: 200, headers: corsHeaders });
          }
          if (action === "simulate_429") {
            const retrySec = Math.min(30, Math.max(3, Number(body.retryAfterSec) || 6));
            const simChat = String(body.chatId || focusChat || "-1001987654321").trim();
            registerAntiSpam429FloodWait(retrySec, simChat);
            await persistAntiSpamStateToStorage(env);
            return new Response(JSON.stringify({
              ok: true,
              snapshot: getAntiSpamSnapshot(env, simChat)
            }), { status: 200, headers: corsHeaders });
          }
          if (action === "clear") {
            antiSpamState.queue = [];
            antiSpamState.floodWaitUntil = 0;
            antiSpamState.chatNextSlotMap.clear();
            try {
              const db = await ensureD1Schema(env);
              if (db) {
                await db.prepare("DELETE FROM tg_anti_spam_queue").run();
              }
            } catch (e) {}
            await persistAntiSpamStateToStorage(env);
            return new Response(JSON.stringify({
              ok: true,
              snapshot: getAntiSpamSnapshot(env, focusChat)
            }), { status: 200, headers: corsHeaders });
          }
          return new Response(JSON.stringify({ ok: false, error: "Unbekannte Anti-Spam Queue Aktion." }), { status: 400, headers: corsHeaders });
        }
      }

      if (path === "/api/tma/episode-story" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const seriesIdNum = parseInt(String(body.seriesId || "0"), 10);
        const seasonNum = parseInt(String(body.season ?? "1"), 10);
        const episodeNum = parseInt(String(body.episode || "0"), 10);
        if (!Number.isFinite(seriesIdNum) || seriesIdNum <= 0 || !Number.isFinite(seasonNum) || seasonNum < 0 || !Number.isFinite(episodeNum) || episodeNum <= 0) {
          return new Response(JSON.stringify({ ok: false, error: "Ungültige Serien-, Staffel- oder Episodennummer." }), { status: 400, headers: corsHeaders });
        }
        const [sDetails, seasonData] = await Promise.all([
          fetchSeriesDetails(env, seriesIdNum),
          fetchSeasonDetails(env, seriesIdNum, seasonNum)
        ]);
        const epObj = (seasonData?.episodes || []).find(e => Number(e.episode_number) === episodeNum) || {
          episode_number: episodeNum,
          season_number: seasonNum,
          name: `Folge ${episodeNum}`
        };
        const telegraphUrl = sDetails?.id
          ? await ensureEpisodeTelegraphUrl(env, seriesIdNum, sDetails, seasonNum, epObj)
          : "";
        return new Response(JSON.stringify({
          ok: true,
          telegraphUrl,
          episode: {
            episode_number: Number(epObj.episode_number || episodeNum),
            season_number: Number(epObj.season_number || seasonNum),
            name: epObj.name || `Folge ${episodeNum}`,
            overview: epObj.overview || "",
            air_date: epObj.air_date || "",
            still_path: epObj.still_path || "",
            vote_average: Number(epObj.vote_average || 0),
            runtime: parseInt(String(epObj.runtime || ""), 10) || 0
          }
        }), { status: 200, headers: corsHeaders });
      }

      if (path === "/api/tma/wishlist") {
        if (!auth.isAuthenticated) {
          return new Response(JSON.stringify({
            ok: false,
            isGuest: true,
            items: [],
            folders: [],
            error: "Im Gast-Modus (ohne Telegram initData / ohne Account) steht kein Speicher zur Verfügung."
          }), { status: 403, headers: corsHeaders });
        }
        if (request.method === "GET") {
          const rawItems = await getSavedList(env, chatId);
          const items = await enrichSavedListWithD1EpisodesAndPosters(env, chatId, rawItems);
          const folders = await getFolders(env, chatId);
          return new Response(JSON.stringify({ ok: true, items, folders }), { status: 200, headers: corsHeaders });
        }
        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const targetChatId = auth.chatId;
          if (body.action === "create_folder") {
            const folder = await createCustomFolder(env, targetChatId, body.name || "Neue Playlist", {
              isJsonPlaylist: Boolean(body.isPlaylist),
              type: body.isPlaylist ? "playlist" : "custom",
              enabled: true
            });
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify({ ok: true, folder }), { status: 200, headers: corsHeaders });
          }
          if (body.action === "toggle_playlist") {
            const res = await togglePlaylistFolderEnabled(env, targetChatId, body.folderId);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify(res), { status: 200, headers: corsHeaders });
          }
          if (body.action === "rename_playlist") {
            const res = await renamePlaylistFolder(env, targetChatId, body.folderId, body.name);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify(res), { status: 200, headers: corsHeaders });
          }
          if (body.action === "delete_playlist") {
            const res = await deletePlaylistFolderAndItems(env, targetChatId, body.folderId);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify(res), { status: 200, headers: corsHeaders });
          }
          if (body.action === "toggle_episode") {
            const res = await saveEpisodeById(env, targetChatId, body.seriesId, body.season, body.episode);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers: corsHeaders });
          }
          if (body.action === "toggle_item") {
            const list = await getSavedList(env, targetChatId);
            const contentType = body.type === "s" ? "series" : "movie";
            const existing = list.find(i => String(i.tmdbId) === String(body.id) && i.contentType === contentType);
            if (existing) {
              await removeItemByUid(env, targetChatId, existing.uid);
              await pushSingleItemToTmdbWatchlist(env, targetChatId, body.type, body.id, false);
            } else {
              await fetchAndSaveById(env, targetChatId, body.type, body.id, contentType === "series" ? "cat_series" : "cat_movies");
              await pushSingleItemToTmdbWatchlist(env, targetChatId, body.type, body.id, true);
            }
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify({ ok: true, saved: !existing }), { status: 200, headers: corsHeaders });
          }
          if (body.action === "save_collection") {
            const colId = body.collectionId || body.refId;
            const col = await fetchCollectionDetails(env, colId);
            if (!col) return new Response(JSON.stringify({ ok: false, error: "Filmreihe nicht gefunden." }), { status: 404, headers: corsHeaders });
            const rawParts = (col.parts || []).map(p => ({ ...p, media_type: "movie" }));
            const { visibleItems } = await filterAndSortMediaList(env, rawParts, settings, "year_asc");
            const res = await saveCollectionOrUniverseToFolders(env, targetChatId, col.name, visibleItems, "collection", col.id);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers: corsHeaders });
          }
          if (body.action === "save_universe") {
            const uniId = body.universeId || body.refId;
            const uni = await fetchUniverseDetails(env, uniId);
            if (!uni) return new Response(JSON.stringify({ ok: false, error: "Filmuniversum nicht gefunden." }), { status: 404, headers: corsHeaders });
            const { visibleItems } = await filterAndSortMediaList(env, uni.parts || [], settings, "year_asc");
            const res = await saveCollectionOrUniverseToFolders(env, targetChatId, `${uni.icon} ${uni.name}`, visibleItems, "universe", uni.id);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers: corsHeaders });
          }
          if (body.action === "move_item_folder") {
            const list = await getSavedList(env, targetChatId);
            const targetIdx = list.findIndex(i => String(i.uid) === String(body.uid));
            if (targetIdx === -1) {
              return new Response(JSON.stringify({ ok: false, error: "Eintrag nicht gefunden." }), { status: 404, headers: corsHeaders });
            }
            const item = list[targetIdx];
            const oldUid = item.uid;
            const oldFolderId = item.folderId || null;
            const isEpisodeItem = item.contentType === "episode";
            const defaultCat = (item.contentType === "series" || isEpisodeItem) ? "cat_series" : "cat_movies";
            const nextFolderId = (body.targetFolderId && body.targetFolderId !== "root") ? String(body.targetFolderId) : defaultCat;
            const prefix = (item.contentType === "series" || isEpisodeItem) ? "s" : "m";
            const baseId = item.tmdbId || item.seriesId || Date.now();
            const isCustomDestFolder = Boolean(nextFolderId && nextFolderId !== "cat_movies" && nextFolderId !== "cat_series");
            let nextUid;
            if (isEpisodeItem) {
              const sNum = item.seasonNumber != null ? Number(item.seasonNumber) : 1;
              const eNum = item.episodeNumber != null ? Number(item.episodeNumber) : 1;
              const epBaseUid = `ep_${item.seriesId || baseId}_${sNum}_${eNum}`;
              nextUid = isCustomDestFolder ? `${epBaseUid}_${nextFolderId}` : epBaseUid;
            } else {
              nextUid = isCustomDestFolder ? `${prefix}_${baseId}_${nextFolderId}` : `${prefix}_${baseId}`;
            }
            if (oldFolderId && oldFolderId !== nextFolderId) {
              await deletePlaylistItemFromD1(env, targetChatId, oldUid, oldFolderId);
            }
            item.folderId = nextFolderId;
            item.uid = nextUid;
            const duplicateIdx = list.findIndex((i, idx) => idx !== targetIdx && String(i.uid) === String(nextUid));
            if (duplicateIdx !== -1) {
              list[duplicateIdx] = item;
              list.splice(targetIdx, 1);
            } else {
              list[targetIdx] = item;
            }
            if (isCustomDestFolder) {
              await batchUpsertPlaylistItemsInD1(env, targetChatId, nextFolderId, [item]);
            }
            await saveRawList(env, targetChatId, list);
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify({ ok: true, uid: nextUid, folderId: nextFolderId }), { status: 200, headers: corsHeaders });
          }
          if (body.action === "delete_uid") {
            const list = await getSavedList(env, targetChatId);
            const targetItem = list.find(i => String(i.uid) === String(body.uid));
            await removeItemByUid(env, targetChatId, body.uid);
            if (targetItem && (targetItem.contentType === "movie" || targetItem.contentType === "series") && targetItem.tmdbId) {
              await pushSingleItemToTmdbWatchlist(env, targetChatId, targetItem.contentType === "series" ? "s" : "m", targetItem.tmdbId, false);
            }
            await flushUserSession(env, targetChatId);
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
          }
        }
      }

      if (path === "/api/tma/settings") {
        const allGenres = Array.from(new Set([...Object.keys(MOVIE_GENRES), ...Object.keys(SERIES_GENRES)]));
        if (request.method === "GET") {
          return new Response(JSON.stringify({
            ok: true,
            settings: sanitizeSettingsForClient(settings),
            fskOptions: FSK_OPTIONS,
            eraOptions: ERA_OPTIONS,
            studioOptions: STUDIO_OPTIONS,
            platformOptions: PLATFORM_OPTIONS,
            genreEmojis: GENRE_EMOJIS,
            allGenres
          }), { status: 200, headers: corsHeaders });
        }
        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const targetChatId = auth.isAuthenticated ? auth.chatId : "guest";
          const serverCur = auth.isAuthenticated
            ? await getUserSettings(env, targetChatId)
            : (isLocalSandboxRuntime ? (memoryFallback.get("settings_guest") || { ...settings }) : { ...settings });
          const safeClientPatch = pickAllowedClientSettings(body.clientSettings);
          const cur = safeClientPatch
            ? { ...serverCur, ...safeClientPatch }
            : serverCur;

          if (body.action === "save_ui_scale" && body.uiScale) {
            cur.uiScale = {
              all: Number(body.uiScale.all || 100),
              text: Number(body.uiScale.text || 100),
              cover: Number(body.uiScale.cover || 100),
              menu: Number(body.uiScale.menu || 100)
            };
          } else if (body.action === "save_delivery_config" && body.deliveryConfig && typeof body.deliveryConfig === "object") {
            if (!auth.isAuthenticated) {
              return new Response(JSON.stringify({ ok: false, error: "Bitte zuerst einloggen, um Versand-Einstellungen zu speichern." }), { status: 403, headers: corsHeaders });
            }
            const dc = body.deliveryConfig;
            const retentionDays = normalizeWorkerRetentionDays(dc.retentionDays);
            const rawAfterSend = String(dc.afterSendAction || "open_minimize").trim();
            const afterSendAction = (rawAfterSend === "open_minimize" || rawAfterSend === "open_close" || rawAfterSend === "stay")
              ? rawAfterSend
              : "open_minimize";
            cur.deliveryConfig = {
              targetMode: String(dc.targetMode || "dm"),
              targetGroupChatId: String(dc.targetGroupChatId || "").trim(),
              targetTopicId: String(dc.targetTopicId || "").trim(),
              sourceBridgeChatId: String(dc.sourceBridgeChatId || "").trim(),
              customBotToken: String(dc.customBotToken || "").trim(),
              customBotUsername: String(dc.customBotUsername || "").trim(),
              afterSendAction,
              retentionDays
            };
            if (auth.user?.isAdmin) {
              await recordAndPruneWorkerActivityLog(env, null, retentionDays);
            }
          } else if (body.action === "save_trailer_provider" && body.trailerProvider) {
            cur.trailerProvider = String(body.trailerProvider);
          } else if (body.action === "reset_all_filters") {
            cur.includedGenres = [];
            cur.excludedGenres = [];
            cur.includedPlatforms = [];
            cur.excludedPlatforms = [];
            cur.includedEras = [];
            cur.excludedEras = [];
            cur.includedStudios = [];
            cur.excludedStudios = [];
            cur.includedFsk = [];
            cur.excludedFsk = [];
            cur.showUnreleased = false;
            cur.onlyVipStreams = false;
            cur.filtersActive = true;
          } else if (body.clientSettingsAuthoritative && body.clientSettings && typeof body.clientSettings === "object") {
            // WICHTIG: Kein Double-Toggle! Der Client hat den neuen Filter-Status bereits in body.clientSettings berechnet.
            const cs = body.clientSettings;
            cur.includedGenres = Array.isArray(cs.includedGenres) ? cs.includedGenres : [];
            cur.excludedGenres = Array.isArray(cs.excludedGenres) ? cs.excludedGenres : [];
            cur.includedPlatforms = Array.isArray(cs.includedPlatforms) ? Array.from(new Set(cs.includedPlatforms.map(normalizePlatformId).filter(Boolean))) : [];
            cur.excludedPlatforms = Array.isArray(cs.excludedPlatforms) ? Array.from(new Set(cs.excludedPlatforms.map(normalizePlatformId).filter(Boolean))) : [];
            cur.includedEras = Array.isArray(cs.includedEras) ? cs.includedEras : [];
            cur.excludedEras = Array.isArray(cs.excludedEras) ? cs.excludedEras : [];
            cur.includedStudios = Array.isArray(cs.includedStudios) ? cs.includedStudios : [];
            cur.excludedStudios = Array.isArray(cs.excludedStudios) ? cs.excludedStudios : [];
            cur.includedFsk = Array.isArray(cs.includedFsk) ? cs.includedFsk : [];
            cur.excludedFsk = Array.isArray(cs.excludedFsk) ? cs.excludedFsk : [];
            cur.showUnreleased = Boolean(cs.showUnreleased);
            cur.onlyVipStreams = Boolean(cs.onlyVipStreams);
            cur.filtersActive = cs.filtersActive !== false;
          } else if (body.action === "set_direct_filter" && body.category) {
            const cat = String(body.category);
            const val = String(body.value || "");
            const targetMode = String(body.mode || "neutral");
            if (cat === "genre" && val) {
              setDirectIncludeExcludeSetting(cur, "includedGenres", "excludedGenres", val, targetMode);
            } else if (cat === "platform" && val) {
              cur.includedPlatforms = Array.isArray(cur.includedPlatforms) ? cur.includedPlatforms.map(normalizePlatformId) : [];
              cur.excludedPlatforms = Array.isArray(cur.excludedPlatforms) ? cur.excludedPlatforms.map(normalizePlatformId) : [];
              setDirectIncludeExcludeSetting(cur, "includedPlatforms", "excludedPlatforms", normalizePlatformId(val), targetMode);
            } else if (cat === "era" && val) {
              setDirectIncludeExcludeSetting(cur, "includedEras", "excludedEras", val, targetMode);
            } else if (cat === "studio" && val) {
              setDirectIncludeExcludeSetting(cur, "includedStudios", "excludedStudios", val, targetMode);
            } else if (cat === "fsk" && val) {
              setDirectIncludeExcludeSetting(cur, "includedFsk", "excludedFsk", val, targetMode);
            } else if (cat === "vip_streams") {
              if (targetMode === "include") cur.onlyVipStreams = true;
              else if (targetMode === "exclude" || targetMode === "neutral") cur.onlyVipStreams = false;
              else cur.onlyVipStreams = !Boolean(cur.onlyVipStreams);
            }
          } else if (body.action === "toggle_active") {
            cur.filtersActive = !(cur.filtersActive !== false);
          } else if (body.action === "toggle_unreleased") {
            cur.showUnreleased = !Boolean(cur.showUnreleased);
          } else if (body.action === "toggle_fsk" && body.value) {
            cur.excludedFsk = Array.isArray(cur.excludedFsk) ? cur.excludedFsk : [];
            if (cur.excludedFsk.includes(body.value)) cur.excludedFsk = cur.excludedFsk.filter(x => x !== body.value);
            else cur.excludedFsk.push(body.value);
          } else if (body.action === "toggle_genre" && body.value) {
            cycleIncludeExcludeSetting(cur, "includedGenres", "excludedGenres", String(body.value));
          } else if (body.action === "clear_genre" && body.value) {
            cur.includedGenres = (cur.includedGenres || []).filter(x => x !== body.value);
            cur.excludedGenres = (cur.excludedGenres || []).filter(x => x !== body.value);
          } else if (body.action === "toggle_era" && body.value) {
            cycleIncludeExcludeSetting(cur, "includedEras", "excludedEras", String(body.value));
          } else if (body.action === "clear_era" && body.value) {
            cur.includedEras = (cur.includedEras || []).filter(x => x !== body.value);
            cur.excludedEras = (cur.excludedEras || []).filter(x => x !== body.value);
          } else if (body.action === "toggle_studio" && body.value) {
            cycleIncludeExcludeSetting(cur, "includedStudios", "excludedStudios", String(body.value));
          } else if (body.action === "clear_studio" && body.value) {
            cur.includedStudios = (cur.includedStudios || []).filter(x => x !== body.value);
            cur.excludedStudios = (cur.excludedStudios || []).filter(x => x !== body.value);
          } else if (body.action === "toggle_platform" && body.value) {
            cycleIncludeExcludeSetting(cur, "includedPlatforms", "excludedPlatforms", String(body.value));
          } else if (body.action === "clear_platform" && body.value) {
            cur.includedPlatforms = (cur.includedPlatforms || []).filter(x => x !== body.value);
            cur.excludedPlatforms = (cur.excludedPlatforms || []).filter(x => x !== body.value);
          }

          if (auth.isAuthenticated) {
            await saveUserSettings(env, targetChatId, cur);
            await flushUserSession(env, targetChatId);
          } else if (isLocalSandboxRuntime) {
            memoryFallback.set("settings_guest", cur);
          }

          // Single-Roundtrip-Optimierung: Direkt neue Discover- oder Suchergebnisse mitliefern!
          let discoverPayload = null;
          let searchPayload = null;
          if (body.includeSearch && body.searchQuery) {
            const sortBy = body.sort || "pop_desc";
            const searchData = await searchTMDBPage(env, String(body.searchQuery), cur, 1, sortBy, false);
            let rawSearchItems = searchData?.results || [];
            const searchItemsWithVip = await applyVipStreamsOnlyFilterIfActive(env, rawSearchItems, "m", cur, hasVipStreamAccess);
            const rawCount = searchData?.rawUnfilteredCount || 0;
            const rawTotalPages = Math.max(1, Number(searchData?.total_pages || 1));
            const hasMoreSearch = searchItemsWithVip.length > 0 && rawTotalPages > 1;
            const totalPagesSearch = hasMoreSearch ? rawTotalPages : 1;
            const totalResultsSearch = Math.max(searchItemsWithVip.length, Number(searchData?.total_results || searchItemsWithVip.length));
            searchPayload = {
              items: searchItemsWithVip,
              rawCount,
              totalPages: totalPagesSearch,
              totalResults: totalResultsSearch,
              hasMore: hasMoreSearch
            };
          } else if (body.includeDiscover) {
            const typeCode = body.type === "s" ? "s" : "m";
            const genreId = body.genreId || "all";
            const mode = body.discoverMode || body.mode || "trend";
            const sortBy = body.sort || "pop_desc";
            const lookahead = await fetchFilteredDiscoverWithLookahead(
              env,
              typeCode,
              genreId,
              mode === "random" ? "pop" : mode,
              1,
              sortBy,
              cur,
              18,
              false
            );
            let visibleItems = lookahead.items || [];
            const itemsWithVip = await applyVipStreamsOnlyFilterIfActive(env, visibleItems, typeCode, cur, hasVipStreamAccess);
            const rawTotalPages = mode === "random" ? 1 : Math.max(1, Number(lookahead.total_pages || 1));
            const hasMoreDiscover = mode !== "random" && Boolean(lookahead.hasMore) && itemsWithVip.length > 0 && rawTotalPages > 1;
            const totalPagesDiscover = hasMoreDiscover ? rawTotalPages : 1;
            const totalResultsDiscover = mode === "random"
              ? itemsWithVip.length
              : Math.max(itemsWithVip.length, Number(lookahead.total_results || itemsWithVip.length));
            discoverPayload = {
              items: itemsWithVip,
              rawCount: lookahead.rawCount || itemsWithVip.length,
              totalPages: totalPagesDiscover,
              totalResults: totalResultsDiscover,
              hasMore: hasMoreDiscover,
              genres: typeCode === "m" ? MOVIE_GENRES : SERIES_GENRES
            };
          }

          return new Response(JSON.stringify({
            ok: true,
            settings: sanitizeSettingsForClient(cur),
            discover: discoverPayload,
            search: searchPayload
          }), { status: 200, headers: corsHeaders });
        }
      }

      if (path === "/api/tma/tmdb-sync" && request.method === "POST") {
        if (!auth.isAuthenticated) {
          return new Response(JSON.stringify({ ok: false, error: "Im Gast-Modus nicht verfügbar. Bitte zuerst einloggen oder über Telegram öffnen." }), { status: 403, headers: corsHeaders });
        }
        const body = await request.json().catch(() => ({}));
        const targetChatId = auth.chatId;
        const cur = await getUserSettings(env, targetChatId);
        const headers = {
          accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}`
        };

        if (body.action === "create_token") {
          const res = await fetchWithTimeout("https://api.themoviedb.org/3/authentication/token/new", { headers }, 4500);
          const data = res.ok ? await res.json() : null;
          if (!data || !data.request_token) {
            return new Response(JSON.stringify({ ok: false, error: "TMDB Request-Token konnte nicht erstellt werden." }), { status: 200, headers: corsHeaders });
          }
          return new Response(JSON.stringify({
            ok: true,
            requestToken: data.request_token,
            authUrl: `https://www.themoviedb.org/authenticate/${data.request_token}`
          }), { status: 200, headers: corsHeaders });
        }

        if (body.action === "create_session") {
          const reqTok = String(body.requestToken || "").trim();
          const res = await fetchWithTimeout("https://api.themoviedb.org/3/authentication/session/new", {
            method: "POST",
            headers,
            body: JSON.stringify({ request_token: reqTok })
          }, 4500);
          const data = res.ok ? await res.json() : null;
          if (!data || !data.session_id) {
            return new Response(JSON.stringify({ ok: false, error: "TMDB-Token wurde noch nicht im Browser freigegeben." }), { status: 200, headers: corsHeaders });
          }
          const accRes = await fetchWithTimeout(`https://api.themoviedb.org/3/account?session_id=${encodeURIComponent(data.session_id)}`, { headers, _skipEdgeCache: true }, 4500);
          const acc = accRes.ok ? await accRes.json() : null;
          if (!acc || !Number(acc.id)) {
            return new Response(JSON.stringify({ ok: false, error: "TMDB-Konto-Details konnten nicht geladen werden. Bitte erneut versuchen." }), { status: 200, headers: corsHeaders });
          }
          cur.tmdbSync = {
            enabled: true,
            sessionId: data.session_id,
            accountId: Number(acc.id),
            username: acc.username || acc.name || "TMDB-User",
            lastSyncAt: Date.now()
          };
          await saveUserSettings(env, targetChatId, cur);
          const syncResult = await syncTmdbAccountWithBotWishlist(env, targetChatId);
          await flushUserSession(env, targetChatId);
          const { sessionId: _hiddenTmdbSid, ...safeTmdbSync } = cur.tmdbSync;
          return new Response(JSON.stringify({ ok: true, tmdbSync: safeTmdbSync, syncResult }), { status: 200, headers: corsHeaders });
        }

        if (body.action === "sync_now") {
          const syncResult = await syncTmdbAccountWithBotWishlist(env, targetChatId);
          await flushUserSession(env, targetChatId);
          return new Response(JSON.stringify(syncResult), { status: 200, headers: corsHeaders });
        }

        if (body.action === "disconnect") {
          cur.tmdbSync = { enabled: false };
          await saveUserSettings(env, targetChatId, cur);
          await flushUserSession(env, targetChatId);
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
        }
      }

      if (path === "/api/import-json" && request.method === "POST") {
        const importWebhookSec = typeof getWebhookSecurityConfig === "function"
          ? await getWebhookSecurityConfig(env)
          : { secretToken: String(env.TELEGRAM_WEBHOOK_SECRET || "") };
        const configuredImportSecret = String(importWebhookSec?.secretToken || "").trim();
        const incomingImportSecret = String(request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
        const hasValidImportSecret = Boolean(
          configuredImportSecret &&
          incomingImportSecret &&
          (typeof timingSafeEqualStr === "function"
            ? timingSafeEqualStr(incomingImportSecret, configuredImportSecret)
            : incomingImportSecret === configuredImportSecret)
        );
        if ((!auth.isAuthenticated || !auth.user?.isAdmin) && !hasValidImportSecret) {
          return new Response(JSON.stringify({ ok: false, error: "Zugriff verweigert: Nur autorisierte Administratoren dürfen /api/import-json verwenden." }), { status: 403, headers: corsHeaders });
        }
        const body = await request.json().catch(() => ({}));
        const rawEntries = Array.isArray(body.entries)
          ? body.entries
          : Array.isArray(body.messages)
            ? body.messages
            : [];
        const slice = rawEntries.slice(0, MAX_JSON_INGEST_LIMIT);
        const playlistName = String(body.playlistName || "JSON Split Batch").trim().slice(0, 48);
        const targetChatId = auth.isAuthenticated ? auth.chatId : "admin";
        const playlistFolder = await createOrGetJsonPlaylistFolder(env, targetChatId, playlistName, "Stream Splitter");
        const {
          moviesAdded,
          seriesAdded,
          failedItems,
          duplicatesCount,
          mergedQualitiesCount,
          batchItems
        } = await processEntriesBatchWithLimit(
          env,
          slice,
          null,
          { chatId: targetChatId, folderId: playlistFolder.id, playlistName: playlistFolder.name }
        );
        return new Response(JSON.stringify({
          ok: true,
          chunkIndex: Number(body.chunkIndex || 1),
          totalChunks: Number(body.totalChunks || 1),
          processedInBatch: slice.length,
          moviesAddedCount: moviesAdded.length,
          seriesAddedCount: seriesAdded.length,
          failedCount: failedItems.length,
          duplicatesCount: Number(duplicatesCount || 0),
          mergedQualitiesCount: Number(mergedQualitiesCount || 0),
          d1PreMatchedCount: Number(body.d1PreMatchedCount || 0),
          sampleTitles: [...moviesAdded.slice(0, 3), ...seriesAdded.slice(0, 3)],
          batchItems: Array.isArray(batchItems) ? batchItems : [],
          playlistFolder
        }), { status: 200, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ ok: false, error: "Unknown TMA route" }), { status: 404, headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), { status: 500, headers: corsHeaders });
    }
  }

  // @ANCHOR: WORKER_EXPORT
  // --- Cloudflare Workers Export ---
  export default {
    async fetch(request, env, ctx) {
      globalThis._activeWorkerEnv = env;
      globalThis._activeWorkerCtx = ctx;
      resetSubrequestBudget();
      try {
        const url = new URL(request.url);
        globalThis._activeWorkerOrigin = url.origin;

        // Statische Assets & Worker Studio UI (/studio, /assets/*, /favicon.svg, /worker.js) über Cloudflare Workers Assets Binding
        if (request.method === "GET" && env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
          if (
            url.pathname.startsWith("/assets/") ||
            url.pathname === "/favicon.svg" ||
            url.pathname === "/manifest.json" ||
            url.pathname === "/manifest.webmanifest" ||
            url.pathname === "/sw.js" ||
            url.pathname === "/service-worker.js" ||
            url.pathname === "/worker.js"
          ) {
            return await env.ASSETS.fetch(request);
          }
          if (
            url.pathname === "/studio" ||
            url.pathname.startsWith("/studio/") ||
            url.searchParams.get("studio") === "1"
          ) {
            return await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
          }
        }

        // TelegramIntegration: Dynamischer Webhook-Endpunkt für eigene User-Bot-Tokens (/api/telegram/custom-webhook?botToken=...)
        if (url.pathname === "/api/telegram/custom-webhook") {
          const customToken = String(url.searchParams.get("botToken") || url.searchParams.get("token") || "").trim();
          if (request.method === "GET") {
            return new Response(JSON.stringify({
              ok: true,
              endpoint: "/api/telegram/custom-webhook",
              hasBotTokenParam: Boolean(customToken),
              info: "Telegram Bot API kompatibler Webhook-Endpunkt für eigene Bot-Tokens (unterstützt /start, /id, copyMessage aus Quellgruppen & Direktversand)."
            }, null, 2), {
              status: 200,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
          }
          if (request.method === "POST") {
            // Niemals ungeprüft auf den Haupt-Bot (env) zurückfallen – verhindert Webhook-Secret-Bypass!
            if (!customToken || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(customToken)) {
              return new Response(JSON.stringify({ ok: false, error: "Fehlendes oder ungültiges botToken-Parameter für /api/telegram/custom-webhook." }), {
                status: 400,
                headers: { "Content-Type": "application/json; charset=utf-8" }
              });
            }
            const mainBotToken = String(env.TELEGRAM_BOT_TOKEN || "").trim();
            const matchesMainBot = Boolean(
              mainBotToken &&
              (typeof timingSafeEqualStr === "function"
                ? timingSafeEqualStr(customToken, mainBotToken)
                : customToken === mainBotToken)
            );
            if (matchesMainBot) {
              return new Response(JSON.stringify({ ok: false, error: "Bitte nutze /webhook mit Secret-Header für den Haupt-Bot." }), {
                status: 403,
                headers: { "Content-Type": "application/json; charset=utf-8" }
              });
            }
            const incomingCustomSecret = String(request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
            const expectedCustomSecret = typeof computeCustomBotWebhookSecret === "function"
              ? await computeCustomBotWebhookSecret(env, customToken)
              : "";
            const secretOk = Boolean(
              incomingCustomSecret &&
              expectedCustomSecret &&
              (typeof timingSafeEqualStr === "function"
                ? timingSafeEqualStr(incomingCustomSecret, expectedCustomSecret)
                : incomingCustomSecret === expectedCustomSecret)
            );
            if (!secretOk) {
              return new Response(JSON.stringify({ ok: false, error: "Ungültiger oder fehlender X-Telegram-Bot-Api-Secret-Token für Custom-Bot-Webhook. Bitte Custom-Bot in den Einstellungen neu verbinden." }), {
                status: 403,
                headers: { "Content-Type": "application/json; charset=utf-8" }
              });
            }
            if (typeof getEntityFromD1 === "function") {
              const regRec = await getEntityFromD1(env, `custom_bot_reg_${expectedCustomSecret.slice(0, 24)}`, 3650 * 86400000).catch(() => null);
              if (!regRec || !regRec.ownerChatId) {
                return new Response(JSON.stringify({ ok: false, error: "Dieser Custom-Bot-Webhook ist nicht registriert." }), {
                  status: 403,
                  headers: { "Content-Type": "application/json; charset=utf-8" }
                });
              }
            }
            const update = await request.json().catch(() => null);
            if (!update || typeof update !== "object") {
              return new Response(JSON.stringify({ ok: false, error: "Ungültiges oder leeres JSON im Request-Body." }), {
                status: 400,
                headers: { "Content-Type": "application/json; charset=utf-8" }
              });
            }
            const scopedEnv = { ...env, TELEGRAM_BOT_TOKEN: customToken, _isCustomBotWebhook: true };
            const runCustomHook = async () => {
              try {
                await handleUpdate(scopedEnv, update);
              } catch (err) {
                console.error("[custom-webhook] handleUpdate Fehler:", err);
              }
            };
            if (ctx && ctx.waitUntil) ctx.waitUntil(runCustomHook());
            else await runCustomHook();
            return new Response("OK", { status: 200 });
          }
        }

        if (
          url.pathname === "/app" ||
          url.pathname === "/miniapp" ||
          url.pathname === "/favicon.ico" ||
          url.pathname === "/favicon.svg" ||
          url.pathname === "/botfather-splash.svg" ||
          url.pathname === "/manifest.json" ||
          url.pathname === "/manifest.webmanifest" ||
          url.pathname === "/sw.js" ||
          url.pathname === "/service-worker.js" ||
          url.pathname === "/api/import-json" ||
          url.pathname.startsWith("/api/tma/") ||
          (request.method === "GET" && url.pathname === "/" && url.searchParams.get("status") !== "1")
        ) {
          const tmaRes = await handleTmaRequest(request, env, ctx);
          return attachWorkerDiagHeader(tmaRes, url.pathname);
        }

        if (request.method === "GET") {
          const configuredWebhookBase = resolveCleanWorkerOrigin(env, url.origin);
          const officialWebhookEndpoint = `${configuredWebhookBase}/webhook`;
          if (url.pathname === "/setwebhook" || url.searchParams.get("setwebhook") === "1") {
            const effBotToken = String(env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || "").trim();
            if (!effBotToken) {
              return new Response(JSON.stringify({
                ok: false,
                error: "TELEGRAM_BOT_TOKEN ist in diesem Worker nicht als Secret hinterlegt.",
                webhookUrl: officialWebhookEndpoint
              }, null, 2), {
                status: 400,
                headers: { "Content-Type": "application/json; charset=utf-8" }
              });
            }
            const webhookSecurity = typeof getWebhookSecurityConfig === "function"
              ? await getWebhookSecurityConfig(env)
              : { secretToken: String(env.TELEGRAM_WEBHOOK_SECRET || ""), maxConnections: 8 };
            const activeSetWhSecret = String(webhookSecurity?.secretToken || "").trim();
            const incomingWhHeader = String(request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
            const incomingWhQuery = String(url.searchParams.get("secret") || "").trim();
            const incomingTokenQuery = String(url.searchParams.get("token") || "").trim();
            const eqSecret = typeof timingSafeEqualStr === "function" ? timingSafeEqualStr : ((a, b) => a === b);
            const hasValidWhSecret = Boolean(activeSetWhSecret && (eqSecret(incomingWhHeader, activeSetWhSecret) || eqSecret(incomingWhQuery, activeSetWhSecret)));
            let hasValidQueryAdminToken = false;
            if (!hasValidWhSecret && incomingTokenQuery && typeof verifyTmaSessionToken === "function") {
              const qPayload = await verifyTmaSessionToken(incomingTokenQuery, env).catch(() => null);
              if (qPayload && qPayload.tid) {
                const qTid = String(qPayload.tid);
                if (typeof isAuthorizedAdminId === "function" && isAuthorizedAdminId(env, qTid)) {
                  hasValidQueryAdminToken = true;
                } else {
                  const qUser = await getUserByTelegramIdFromD1(env, qTid).catch(() => null);
                  if (qUser && Number(qUser.is_admin) === 1) hasValidQueryAdminToken = true;
                }
              }
            }
            const whAdminAuth = (hasValidWhSecret || hasValidQueryAdminToken)
              ? null
              : await resolveTmaAuthContext(request, env).catch(() => null);
            const isWhAdmin = Boolean(hasValidWhSecret || hasValidQueryAdminToken || (whAdminAuth?.isAuthenticated && whAdminAuth?.user?.isAdmin));
            if (!isWhAdmin) {
              const isAuthedNonAdmin = Boolean(whAdminAuth?.isAuthenticated && !whAdminAuth?.user?.isAdmin);
              return new Response(JSON.stringify({
                ok: false,
                code: isAuthedNonAdmin ? "ADMIN_REQUIRED" : "AUTH_REQUIRED",
                error: isAuthedNonAdmin
                  ? "Zugriff verweigert: Angemeldete Telegram-ID ist kein Admin."
                  : "Unauthorized: Admin-Session (Bearer / ?token=...) oder Webhook-Secret (?secret=...) erforderlich.",
                diagnostics: {
                  hasWebhookSecretConfigured: Boolean(activeSetWhSecret),
                  authFailureReason: whAdminAuth?.authFailureReason || (incomingWhQuery ? "webhook_secret_mismatch" : "no_credentials"),
                  telegramId: whAdminAuth?.user?.telegramId || null
                }
              }, null, 2), {
                status: isAuthedNonAdmin ? 403 : 401,
                headers: { "Content-Type": "application/json; charset=utf-8" }
              });
            }
            const dropPendingParam = url.searchParams.get("drop_pending_updates");
            const dropPendingFlag = dropPendingParam === "1" || dropPendingParam === "true";
            const maxConnParam = parseInt(url.searchParams.get("max_connections") || "", 10);
            const effectiveMaxConn = (Number.isFinite(maxConnParam) && maxConnParam >= 1 && maxConnParam <= 40)
              ? maxConnParam
              : (webhookSecurity.maxConnections || 8);
            const whPayload = {
              url: officialWebhookEndpoint,
              max_connections: effectiveMaxConn,
              drop_pending_updates: dropPendingFlag,
              allowed_updates: ["message", "channel_post", "callback_query", "inline_query"]
            };
            if (activeSetWhSecret) {
              whPayload.secret_token = activeSetWhSecret;
            }
            const whRes = await fetchWithTimeout(`https://api.telegram.org/bot${effBotToken}/setWebhook`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(whPayload)
            }, 6000);
            const whJson = await whRes.json().catch(() => ({}));
            let liveInfo = null;
            if (whJson?.ok) {
              try {
                const infoRes = await fetchWithTimeout(`https://api.telegram.org/bot${effBotToken}/getWebhookInfo`, {}, 4500);
                const infoJson = await infoRes.json().catch(() => ({}));
                if (infoJson?.ok && infoJson?.result) liveInfo = infoJson.result;
              } catch (_e) {}
            }
            return new Response(JSON.stringify({
              ok: Boolean(whJson?.ok),
              webhookUrl: officialWebhookEndpoint,
              hasWebhookPassword: Boolean(activeSetWhSecret),
              maxConnections: effectiveMaxConn,
              dropPendingUpdates: dropPendingFlag,
              telegramResponse: whJson,
              webhookInfo: liveInfo
            }, null, 2), {
              status: 200,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
          }

          return new Response(JSON.stringify({
            status: "online",
            service: "TelePort Movie & Series Bot + Mini-App (Cloudflare Worker v3.7.0)",
            webhookUrl: officialWebhookEndpoint,
            miniAppUrl: `${configuredWebhookBase}/app`,
            studioUrl: `${configuredWebhookBase}/studio`,
            botFatherSplashSvgUrl: `${configuredWebhookBase}/botfather-splash.svg`,
            customBotWebhookEndpoint: `${configuredWebhookBase}/api/telegram/custom-webhook`,
            timestamp: new Date().toISOString(),
            configuredSecrets: {
              TELEGRAM_BOT_TOKEN: !!env.TELEGRAM_BOT_TOKEN,
              TMDB_BEARER_TOKEN: !!env.TMDB_BEARER_TOKEN,
              WEBHOOK_URL: officialWebhookEndpoint,
              MOVIE_SAVED: !!env.MOVIE_SAVED,
              D1_DB: !!(env.DB || env.MOVIE_DB),
            },
            help: "Sende Telegram Webhook Updates per POST an /webhook (oder /), konfiguriere das Webhook-Passwort im Admin-Tab 'Bot & Einstellungen' oder öffne /app für die Mini-App."
          }, null, 2), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }

        if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/webhook")) {
          // 0ms Edge-Gatekeeper: Validiere Webhook-Passwort (X-Telegram-Bot-Api-Secret-Token oder ?secret=...)
          const webhookSecurity = typeof getWebhookSecurityConfig === "function"
            ? await getWebhookSecurityConfig(env)
            : { secretToken: String(env.TELEGRAM_WEBHOOK_SECRET || "") };
          const activeSecret = String(webhookSecurity?.secretToken || "").trim();
          if (activeSecret) {
            const incomingHeaderSecret = String(request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
            const incomingQuerySecret = String(url.searchParams.get("secret") || "").trim();
            const eqSecret = typeof timingSafeEqualStr === "function" ? timingSafeEqualStr : ((a, b) => a === b);
            if (!eqSecret(incomingHeaderSecret, activeSecret) && !eqSecret(incomingQuerySecret, activeSecret)) {
              return new Response("Unauthorized: Invalid Telegram Webhook Secret Password", { status: 401 });
            }
          }

          const update = await request.json().catch(() => null);
          if (!update || typeof update !== "object") {
            return new Response("OK", { status: 200 });
          }

          // Anti-Retry-Storm: Doppelte update_id aus Telegram-Retries in <0.1ms im RAM abfangen
          if (typeof isDuplicateTelegramUpdateId === "function" && isDuplicateTelegramUpdateId(update.update_id)) {
            return new Response("OK", { status: 200 });
          }

          const runAll = async () => {
            await handleUpdate(env, update);
            await flushDirtyKvBatch(env);
          };
          if (ctx && ctx.waitUntil) {
            ctx.waitUntil(runAll());
          } else {
            await runAll();
          }
          return new Response("OK", { status: 200 });
        }

        return new Response("Method not allowed", { status: 405 });
      } catch (err) {
        console.error("[Worker Root Error]:", err);
        let reqPath = "";
        try { reqPath = new URL(request.url).pathname; } catch (_e) {}
        if (reqPath.startsWith("/api/")) {
          return new Response(JSON.stringify({ ok: false, error: "Interner Serverfehler im Worker." }), {
            status: 500,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        }
        return new Response("OK", { status: 200 });
      } finally {
        const deferKvFlush = Boolean(globalThis.__DEFER_KV_FLUSH_FOR_REQUEST);
        globalThis.__DEFER_KV_FLUSH_FOR_REQUEST = false;
        if (!deferKvFlush) {
          if (ctx && typeof ctx.waitUntil === "function") {
            ctx.waitUntil(flushDirtyKvBatch(env).catch(() => {}));
          } else {
            await flushDirtyKvBatch(env).catch(() => {});
          }
        }
      }
    },
  };

export {
  EPISODE_GROUP_TYPES,
  FORCE_EPISODE_GROUP_SERIES,
  formatShortVersionLabel,
  normalizeCompactVersionTags,
  ROMAN_NUMERALS,
  cleanMovieQuery,
  resolveSeriesVersionOnTMDb,
  findOnTMDbWithValidation,
  detectVideoQuality,
  getCleanContentLines,
  normalizeText,
  cleanMediaTitle,
  parseTelegramMessage,
  extractPreContext,
  parseMediaFilename,
  groupSeriesAndMoviesFromEntries,
  detectAndExtractTelegramBackupOrJson
};
