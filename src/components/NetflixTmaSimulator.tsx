import React, { useState, useEffect, useRef, useCallback } from 'react';
import { animate, useMotionValue, useSpring } from 'motion/react';
import {
  RotateCcw,
  Monitor,
  Smartphone,
  Tv,
  ShieldCheck,
  UserCheck,
  Globe,
  Loader2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { ConsoleLogEntry, WorkerEnvVar, WorkerRequestData } from '../types/worker';
import { executeWorkerSandbox, SimulatedKVNamespace } from '../utils/workerSandbox';

interface NetflixTmaSimulatorProps {
  workerCode: string;
  envVars: WorkerEnvVar[];
  kvNamespace: SimulatedKVNamespace;
  onAppendLogs?: (logs: ConsoleLogEntry[]) => void;
}

type ViewportPreset = 'full' | 'tv' | 'mobile';
type AuthPersona = 'admin_vip' | 'standard_user' | 'external_guest';

export interface UseSwipeableOptions {
  onSwipedUp?: (deltaY: number, velocityY: number) => void;
  onSwipedDown?: (deltaY: number, velocityY: number) => void;
  onSwipedLeft?: (deltaX: number) => void;
  onSwipedRight?: (deltaX: number) => void;
  onSwipingVertical?: (deltaY: number, velocityY: number) => void;
  onSwipeReset?: () => void;
  minDistance?: number;
  minVelocity?: number;
  trackMouse?: boolean;
}

export function useSwipeable(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  srcDocDependency: string,
  options: UseSwipeableOptions
) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Framer Motion physics model for smooth rubber-band resistance at the Hero Slider boundary
  const rawDragY = useMotionValue(0);
  const smoothRubberY = useSpring(rawDragY, {
    stiffness: 380,
    damping: 34,
    mass: 0.65,
  });

  useEffect(() => {
    const unsubscribe = smoothRubberY.on('change', (latest) => {
      const doc = iframeRef.current?.contentDocument;
      const stageWrap = doc?.getElementById('heroStageWrapEl');
      if (stageWrap) {
        stageWrap.style.setProperty('--hero-rubber-y', `${Math.round(latest)}px`);
      }
    });
    return () => unsubscribe();
  }, [iframeRef, smoothRubberY]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cleanupDocListeners: (() => void) | null = null;

    const attachToIframeDoc = () => {
      if (cleanupDocListeners) {
        cleanupDocListeners();
        cleanupDocListeners = null;
      }
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) return;

      let startX = 0;
      let startY = 0;
      let startTime = 0;
      let lastY = 0;
      let lastTime = 0;
      let velocityY = 0;
      let isTracking = false;
      let startedInHero = false;

      const isTargetInsideHero = (target: EventTarget | null): boolean => {
        if (!target || !(target instanceof Element)) return false;
        if (target.closest('button, a, input, select, textarea, .expandable-desc-box')) return false;
        return Boolean(target.closest('.hero, #heroStageWrapEl, #heroBannerSlot'));
      };

      const onPointerDown = (ev: PointerEvent) => {
        // Touch events are handled natively by onHeroTouchStart/Move/End inside the worker document
        // so that mouse & pointer drags in the simulator get Framer Motion spring rubber-band physics without double firing
        if (ev.pointerType === 'touch') return;
        if (ev.pointerType === 'mouse' && !(optionsRef.current.trackMouse ?? true)) return;
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        if (!isTargetInsideHero(ev.target)) return;
        startX = ev.clientX;
        startY = ev.clientY;
        lastY = ev.clientY;
        startTime = performance.now();
        lastTime = startTime;
        velocityY = 0;
        isTracking = true;
        startedInHero = true;
      };

      const onPointerMove = (ev: PointerEvent) => {
        if (!isTracking || !startedInHero) return;
        const now = performance.now();
        const dt = Math.max(8, now - lastTime);
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        velocityY = (ev.clientY - lastY) / dt; // px/ms
        lastY = ev.clientY;
        lastTime = now;

        if (dy < -8 && Math.abs(dy) > Math.abs(dx) * 1.15) {
          // Logarithmic rubber-band resistance curve before triggering the transition
          const absDy = Math.abs(dy);
          const dampedRubber = -Math.min(34, Math.pow(absDy, 0.76) * 1.35);
          rawDragY.set(dampedRubber);
          optionsRef.current.onSwipingVertical?.(dy, velocityY);
        }
      };

      const onPointerUp = (ev: PointerEvent) => {
        if (!isTracking || !startedInHero) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const totalDt = Math.max(16, performance.now() - startTime);
        const avgVy = dy / totalDt;
        const effectiveVy = Math.abs(velocityY) > Math.abs(avgVy) ? velocityY : avgVy;

        isTracking = false;
        startedInHero = false;

        // Smoothly spring the rubber-band offset back to 0
        animate(rawDragY, 0, { type: 'spring', stiffness: 420, damping: 32 });

        const threshold = optionsRef.current.minDistance ?? 64;
        const minVel = optionsRef.current.minVelocity ?? 0.45;
        const passesVerticalGate =
          Math.abs(dy) > Math.abs(dx) * 1.15 &&
          (Math.abs(dy) >= threshold || (Math.abs(dy) >= 28 && Math.abs(effectiveVy) >= minVel));

        if (passesVerticalGate) {
          if (dy < 0) {
            optionsRef.current.onSwipedUp?.(dy, effectiveVy);
          } else {
            optionsRef.current.onSwipedDown?.(dy, effectiveVy);
          }
        } else if (Math.abs(dx) >= 44 && Math.abs(dx) > Math.abs(dy)) {
          optionsRef.current.onSwipeReset?.();
          if (dx < 0) {
            optionsRef.current.onSwipedLeft?.(dx);
          } else {
            optionsRef.current.onSwipedRight?.(dx);
          }
        } else {
          optionsRef.current.onSwipeReset?.();
        }
      };

      const onPointerCancel = () => {
        isTracking = false;
        startedInHero = false;
        animate(rawDragY, 0, { type: 'spring', stiffness: 420, damping: 32 });
        optionsRef.current.onSwipeReset?.();
      };

      doc.addEventListener('pointerdown', onPointerDown, { passive: true });
      doc.addEventListener('pointermove', onPointerMove, { passive: true });
      doc.addEventListener('pointerup', onPointerUp, { passive: true });
      doc.addEventListener('pointercancel', onPointerCancel, { passive: true });

      cleanupDocListeners = () => {
        doc.removeEventListener('pointerdown', onPointerDown);
        doc.removeEventListener('pointermove', onPointerMove);
        doc.removeEventListener('pointerup', onPointerUp);
        doc.removeEventListener('pointercancel', onPointerCancel);
      };
    };

    iframe.addEventListener('load', attachToIframeDoc);
    attachToIframeDoc();

    return () => {
      iframe.removeEventListener('load', attachToIframeDoc);
      if (cleanupDocListeners) cleanupDocListeners();
    };
  }, [iframeRef, srcDocDependency]);
}

export const NetflixTmaSimulator: React.FC<NetflixTmaSimulatorProps> = ({
  workerCode,
  envVars,
  kvNamespace,
  onAppendLogs,
}) => {
  const [srcDocHtml, setSrcDocHtml] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [viewportPreset, setViewportPreset] = useState<ViewportPreset>('full');
  const [authPersona, setAuthPersona] = useState<AuthPersona>('admin_vip');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [lastApiRoute, setLastApiRoute] = useState<string>('/app');
  const [lastDurationMs, setLastDurationMs] = useState<number>(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const buildEnvMap = useCallback(() => {
    const map: Record<string, string> = {
      ADMIN_IDS: '100998877',
      TELEGRAM_ADMIN_IDS: '100998877',
    };
    for (const v of envVars) {
      if (v.key && v.value) map[v.key] = v.value;
    }
    return map;
  }, [envVars]);

  // Inject bridge script into the STREAMFLIX HTML so all fetch('/api/...') calls route through executeWorkerSandbox
  const buildInjectedMiniAppHtml = useCallback(
    (rawHtml: string, persona: AuthPersona) => {
      const personaUser =
        persona === 'admin_vip'
          ? { id: 100998877, first_name: 'Admin', username: 'streamflix_admin', language_code: 'de' }
          : persona === 'standard_user'
            ? { id: 55443322, first_name: 'Max', username: 'kino_fan', language_code: 'de' }
            : null;

      const simulatedInitData = personaUser
        ? `user=${encodeURIComponent(JSON.stringify(personaUser))}&auth_date=${Math.floor(Date.now() / 1000)}&hash=sim_valid_hmac`
        : '';

      const bridgeScript = `
<script>
(function() {
  const PERSONA = ${JSON.stringify(persona)};
  const PERSONA_USER = ${JSON.stringify(personaUser)};
  const SIM_INIT_DATA = ${JSON.stringify(simulatedInitData)};

  // Clear stale session token when persona changes so initAuthSession() always authenticates the active persona
  try {
    const prevPersona = sessionStorage.getItem("__tma_sim_active_persona__");
    if (prevPersona !== PERSONA || !PERSONA_USER) {
      localStorage.removeItem("tma_session_token");
      sessionStorage.setItem("__tma_sim_active_persona__", PERSONA);
    }
  } catch (e) {}

  // Provide simulated Telegram.WebApp object before app scripts run
  if (PERSONA_USER) {
    const webAppObj = {
      initData: SIM_INIT_DATA,
      initDataUnsafe: { user: PERSONA_USER },
      platform: ${JSON.stringify(viewportPreset === 'mobile' ? 'android' : 'tdesktop')},
      colorScheme: "dark",
      version: "7.10",
      isExpanded: true,
      viewportHeight: window.innerHeight,
      viewportStableHeight: window.innerHeight,
      ready: function() {},
      expand: function() {},
      close: function() {},
      openTelegramLink: function(url) { window.open(url, "_blank"); },
      openLink: function(url) { window.open(url, "_blank"); },
      HapticFeedback: {
        impactOccurred: function() {},
        notificationOccurred: function() {},
        selectionChanged: function() {}
      },
      MainButton: {
        text: "",
        isVisible: false,
        show: function() { this.isVisible = true; },
        hide: function() { this.isVisible = false; },
        onClick: function() {},
        offClick: function() {}
      },
      BackButton: {
        isVisible: false,
        show: function() { this.isVisible = true; },
        hide: function() { this.isVisible = false; },
        onClick: function() {},
        offClick: function() {}
      }
    };
    window.Telegram = { WebApp: webAppObj };
  } else {
    window.Telegram = { WebApp: { initData: "", initDataUnsafe: {}, ready: function() {}, expand: function() {} } };
  }

  const pendingRequests = new Map();
  let reqCounter = 1;

  window.addEventListener("message", function(event) {
    const data = event.data;
    if (!data || data.type !== "TMA_SANDBOX_FETCH_RESPONSE") return;
    const resolver = pendingRequests.get(data.reqId);
    if (!resolver) return;
    pendingRequests.delete(data.reqId);
    try {
      const resHeaders = new Headers(data.headers || { "content-type": "application/json" });
      const response = new Response(data.body, {
        status: data.status || 200,
        headers: resHeaders
      });
      resolver.resolve(response);
    } catch (err) {
      resolver.reject(err);
    }
  });

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    let urlStr = typeof input === "string" ? input : (input && input.url ? input.url : String(input));
    const isInternalWorkerRoute =
      urlStr.startsWith("/") ||
      urlStr.startsWith("https://edge-worker.workers.dev") ||
      urlStr.includes("/api/tma/") ||
      urlStr.includes("/api/import-json");

    if (!isInternalWorkerRoute) {
      return nativeFetch(input, init);
    }

    // Normalize URL to path + query
    try {
      if (urlStr.startsWith("http")) {
        const u = new URL(urlStr);
        urlStr = u.pathname + u.search;
      }
    } catch (e) {}

    const reqId = "tma_req_" + (reqCounter++) + "_" + Date.now();
    const method = (init && init.method) ? String(init.method).toUpperCase() : "GET";
    const headersObj = {};
    if (init && init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach(function(v, k) { headersObj[k] = v; });
      } else if (typeof init.headers === "object") {
        Object.assign(headersObj, init.headers);
      }
    }
    if (SIM_INIT_DATA && !headersObj["X-Telegram-Init-Data"] && !headersObj["x-telegram-init-data"]) {
      headersObj["X-Telegram-Init-Data"] = SIM_INIT_DATA;
    }
    const bodyStr = (init && typeof init.body === "string") ? init.body : "";

    return new Promise(function(resolve, reject) {
      pendingRequests.set(reqId, { resolve: resolve, reject: reject });
      window.parent.postMessage({
        type: "TMA_SANDBOX_FETCH_REQUEST",
        reqId: reqId,
        url: urlStr,
        method: method,
        headers: headersObj,
        body: bodyStr,
        persona: PERSONA
      }, "*");
    });
  };
})();
</script>`;

      // Remove external telegram-web-app.js script tag in simulator iframe so it cannot overwrite window.Telegram.WebApp.initData
      const sanitizedHtml = rawHtml.replace(
        /<script\s+src=["']https:\/\/telegram\.org\/js\/telegram-web-app\.js["']\s*><\/script>/gi,
        ''
      );

      if (sanitizedHtml.includes('<head>')) {
        return sanitizedHtml.replace('<head>', `<head>${bridgeScript}`);
      }
      return `${bridgeScript}${sanitizedHtml}`;
    },
    [viewportPreset]
  );

  const [activeWorkerCode, setActiveWorkerCode] = useState<string>(workerCode);
  const onAppendLogsRef = useRef(onAppendLogs);
  useEffect(() => {
    onAppendLogsRef.current = onAppendLogs;
  }, [onAppendLogs]);

  useEffect(() => {
    setActiveWorkerCode(workerCode);
  }, [workerCode]);

  const loadMiniApp = useCallback(async (fetchFreshBundle = false) => {
    let codeToRun = activeWorkerCode || workerCode;
    if (fetchFreshBundle) {
      try {
        const freshRes = await fetch(`/worker.js?v=${Date.now()}`, { cache: 'no-store' });
        if (freshRes.ok) {
          const freshTxt = await freshRes.text();
          if (freshTxt && freshTxt.trim().length > 100) {
            codeToRun = freshTxt;
            setActiveWorkerCode(freshTxt);
          }
        }
      } catch {
        // Fallback to existing workerCode prop
      }
    }
    if (!codeToRun || codeToRun.trim().length < 50) return;
    setIsLoading(true);
    try {
      const envMap = buildEnvMap();
      const req: WorkerRequestData = {
        method: 'GET',
        url: '/app',
        headers: { Accept: 'text/html' },
        body: '',
        cf: {
          country: 'DE',
          city: 'Frankfurt',
          colo: 'FRA',
          asn: 13335,
          rayId: '8d2a10b4f8a910c2',
          clientTrustScore: 99,
          tlsVersion: 'TLSv1.3',
        },
      };
      const res = await executeWorkerSandbox(codeToRun, req, envMap, kvNamespace);
      if (onAppendLogsRef.current && res.logs.length > 0) {
        onAppendLogsRef.current(res.logs);
      }
      setLastApiRoute('GET /app');
      setLastDurationMs(res.response.durationMs);

      const rawBody = res.response.body || '';
      if (rawBody.trim().startsWith('<!DOCTYPE') || rawBody.includes('<html')) {
        setSrcDocHtml(buildInjectedMiniAppHtml(rawBody, authPersona));
      } else {
        setSrcDocHtml(`<!DOCTYPE html><html><body style="background:#141414;color:#f8fafc;font-family:sans-serif;padding:2rem;">
          <h2 style="color:#e50914;">Mini-App Vorschau</h2>
          <pre style="background:#1f2937;padding:1rem;border-radius:8px;overflow:auto;">${rawBody.replace(/</g, '&lt;')}</pre>
        </body></html>`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkerCode, workerCode, buildEnvMap, kvNamespace, buildInjectedMiniAppHtml, authPersona]);

  useEffect(() => {
    loadMiniApp(false);
  }, [loadMiniApp]);

  const dispatchHeroSwipeToIframe = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const win = iframeRef.current?.contentWindow as (Window & { __tmaHandleHeroSwipe?: (dir: string) => void }) | null;
    if (!win) return;
    if (typeof win.__tmaHandleHeroSwipe === 'function') {
      win.__tmaHandleHeroSwipe(direction);
    } else {
      win.postMessage({ type: 'TMA_HERO_SWIPE_GESTURE', direction }, '*');
    }
  }, []);

  useSwipeable(iframeRef, srcDocHtml, {
    minDistance: 66,
    minVelocity: 0.45,
    trackMouse: true,
    onSwipingVertical: (deltaY) => {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || deltaY >= -8) return;
      doc.body?.classList.add('page-scrolled');
      const stageWrap = doc.getElementById('heroStageWrapEl');
      if (stageWrap) {
        const heroH = Math.max(280, stageWrap.offsetHeight || 580);
        const dragFade = Math.max(0, Math.min(0.68, Math.abs(deltaY) / (heroH * 0.55)));
        stageWrap.style.setProperty('--hero-scroll-fade', dragFade.toFixed(3));
      }
    },
    onSwipeReset: () => {
      const doc = iframeRef.current?.contentDocument;
      const win = iframeRef.current?.contentWindow;
      if (!doc || !win) return;
      const scrollY = win.scrollY || win.pageYOffset || 0;
      if (scrollY <= 10) {
        doc.body?.classList.remove('page-scrolled');
        const stageWrap = doc.getElementById('heroStageWrapEl');
        if (stageWrap) {
          stageWrap.style.setProperty('--hero-scroll-fade', '0');
          stageWrap.style.setProperty('--hero-rubber-y', '0px');
        }
      }
    },
    onSwipedUp: () => dispatchHeroSwipeToIframe('up'),
    onSwipedDown: () => dispatchHeroSwipeToIframe('down'),
    onSwipedLeft: () => dispatchHeroSwipeToIframe('left'),
    onSwipedRight: () => dispatchHeroSwipeToIframe('right'),
  });

  // Listen for fetch requests coming from inside the simulated STREAMFLIX iframe
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'TMA_SANDBOX_FETCH_REQUEST') return;

      const { reqId, url, method, headers, body } = data;
      const envMap = buildEnvMap();

      const startMs = performance.now();
      const reqData: WorkerRequestData = {
        method: method || 'GET',
        url: url || '/api/tma/discover',
        headers: headers || { Accept: 'application/json' },
        body: body || '',
        cf: {
          country: 'DE',
          city: 'Frankfurt',
          colo: 'FRA',
          asn: 13335,
          rayId: '8d2a10b4f8a910c2',
          clientTrustScore: 99,
          tlsVersion: 'TLSv1.3',
        },
      };

      const res = await executeWorkerSandbox(activeWorkerCode || workerCode, reqData, envMap, kvNamespace);
      if (onAppendLogsRef.current && res.logs.length > 0) {
        onAppendLogsRef.current(res.logs);
      }
      setLastApiRoute(`${reqData.method} ${reqData.url.split('?')[0]}`);
      setLastDurationMs(Math.round(performance.now() - startMs));

      event.source?.postMessage(
        {
          type: 'TMA_SANDBOX_FETCH_RESPONSE',
          reqId,
          status: res.response.status,
          headers: res.response.headers,
          body: res.response.body,
        },
        { targetOrigin: '*' }
      );
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [activeWorkerCode, workerCode, buildEnvMap, kvNamespace]);

  return (
    <div
      className={`flex flex-col bg-[#0b0d13] border border-white/[0.07] rounded-xl overflow-hidden shadow-2xl ${
        isFullscreen ? 'fixed inset-2 z-50' : 'h-full w-full'
      }`}
    >
      {/* Simulator Top Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-[#0b0d13] border-b border-white/[0.06] text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-200">
            TelePort Mini-App Vorschau
          </span>
          <span className="text-slate-500 hidden sm:inline">·</span>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            Rolle &amp; Geräte-Ansicht testen
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Auth Persona Switcher */}
          <div className="flex items-center bg-white/[0.04] p-0.5 rounded-lg border border-white/[0.07]">
            <button
              onClick={() => setAuthPersona('admin_vip')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                authPersona === 'admin_vip'
                  ? 'bg-white text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Simuliert verifizierten Telegram Admin + VIP Status"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Admin &amp; VIP</span>
            </button>
            <button
              onClick={() => setAuthPersona('standard_user')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                authPersona === 'standard_user'
                  ? 'bg-white text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Simuliert regulären Telegram Mini-App Nutzer"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Telegram User</span>
            </button>
            <button
              onClick={() => setAuthPersona('external_guest')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                authPersona === 'external_guest'
                  ? 'bg-white text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Simuliert externen Browser ohne Telegram initData (Gast / Web-Login)"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Gast / Browser</span>
            </button>
          </div>

          {/* Viewport Size Switcher */}
          <div className="flex items-center bg-white/[0.04] p-0.5 rounded-lg border border-white/[0.07]">
            <button
              onClick={() => setViewportPreset('full')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                viewportPreset === 'full'
                  ? 'bg-white/[0.14] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Desktop</span>
            </button>
            <button
              onClick={() => setViewportPreset('tv')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                viewportPreset === 'tv'
                  ? 'bg-white/[0.14] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              <span>Smart TV</span>
            </button>
            <button
              onClick={() => setViewportPreset('mobile')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                viewportPreset === 'mobile'
                  ? 'bg-white/[0.14] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Smartphone</span>
            </button>
          </div>

          <button
            onClick={() => loadMiniApp(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border border-white/[0.08] transition-colors text-[11px] font-medium cursor-pointer"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Neu laden</span>
          </button>

          <button
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.08] transition-colors text-[11px] cursor-pointer"
            title={isFullscreen ? 'Vollbild verlassen' : 'Simulator maximieren'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Main STREAMFLIX Mini-App Viewport */}
      <div className="flex-1 bg-[#0b0d13] flex items-center justify-center overflow-hidden relative">
        {isLoading && (
          <div className="absolute inset-0 z-20 bg-[#0b0d13]/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 text-slate-200">
            <Loader2 className="w-7 h-7 text-[#e50914] animate-spin" />
            <span className="text-xs font-medium tracking-wide">
              TelePort Mini-App wird geladen…
            </span>
          </div>
        )}

        <div
          className={`h-full transition-all duration-200 overflow-hidden ${
            viewportPreset === 'mobile'
              ? 'w-[412px] max-w-full border-x border-white/[0.08] shadow-2xl'
              : viewportPreset === 'tv'
                ? 'w-full max-w-[1600px]'
                : 'w-full'
          }`}
        >
          <iframe
            ref={iframeRef}
            title="STREAMFLIX Telegram Mini-App Simulator"
            srcDoc={srcDocHtml}
            className="w-full h-full border-0 bg-[#0b0d13]"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        </div>
      </div>
    </div>
  );
};

export default NetflixTmaSimulator;
