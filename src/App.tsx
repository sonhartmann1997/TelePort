/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import { Header, StudioTab } from './components/Header';
import { WORKER_TEMPLATES } from './data/workerTemplates';
import {
  ConsoleLogEntry,
  WorkerEnvVar,
  WorkerRequestData,
  WorkerResponseData,
  WorkerTemplate,
} from './types/worker';
import {
  executeWorkerSandbox,
  SimulatedKVNamespace,
  checkDatabaseForExistingTitle as queryD1ForExistingTitle,
  registerResolvedTitleInD1Catalog,
} from './utils/workerSandbox';

// Dynamic import() code-splitting for each Studio module
const NetflixTmaSimulator = lazy(() =>
  import('./components/NetflixTmaSimulator').then((m) => ({ default: m.NetflixTmaSimulator }))
);
const CodeEditor = lazy(() =>
  import('./components/CodeEditor').then((m) => ({ default: m.CodeEditor }))
);
const TelegramBotSimulator = lazy(() =>
  import('./components/TelegramBotSimulator').then((m) => ({ default: m.TelegramBotSimulator }))
);
const SeriesHealth = lazy(() =>
  import('./components/SeriesHealth').then((m) => ({ default: m.SeriesHealth }))
);
const KVStorageManager = lazy(() =>
  import('./components/KVStorageManager').then((m) => ({ default: m.KVStorageManager }))
);
const DeployModal = lazy(() =>
  import('./components/DeployModal').then((m) => ({ default: m.DeployModal }))
);
const TestRunnerModal = lazy(() =>
  import('./components/TestRunnerModal').then((m) => ({ default: m.TestRunnerModal }))
);

function ViewLoadingFallback({ label }: { label: string }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-2 bg-[#0d111a] border border-slate-800/80 rounded-xl text-slate-400">
      <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
      <span className="text-xs font-medium">{label} wird geladen…</span>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<StudioTab>('tma');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(WORKER_TEMPLATES[0].id);
  const [workerCode, setWorkerCode] = useState<string>(WORKER_TEMPLATES[0].code);
  const [workerName, setWorkerName] = useState<string>('teleport');

  // KV store instance
  const [kvTick, setKvTick] = useState<number>(0);
  const kvNamespace = useMemo(() => {
    return new SimulatedKVNamespace(
      WORKER_TEMPLATES[0].kvSeed || {},
      () => setKvTick((prev) => prev + 1)
    );
  }, []);

  // Environment variables
  const [envVars, setEnvVars] = useState<WorkerEnvVar[]>([
    { key: 'WEBHOOK_URL', value: 'https://teleport.sonhartmann-1997.workers.dev/', isSecret: false },
    { key: 'ENVIRONMENT', value: 'production', isSecret: false },
    { key: 'ADMIN_IDS', value: '100998877', isSecret: false },
  ]);

  // Request State
  const [requestData, setRequestData] = useState<WorkerRequestData>({
    method: 'GET',
    url: '/?status=1',
    headers: {
      Accept: 'application/json',
    },
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
  });

  // Response & Logs State
  const [response, setResponse] = useState<WorkerResponseData | null>(null);
  const [logs, setLogs] = useState<ConsoleLogEntry[]>([]);
  const [isTestRunnerOpen, setIsTestRunnerOpen] = useState<boolean>(false);

  // Execute request
  const handleExecute = useCallback(async () => {
    const envMap: Record<string, string> = {};
    for (const v of envVars) {
      envMap[v.key] = v.value;
    }

    const res = await executeWorkerSandbox(workerCode, requestData, envMap, kvNamespace);
    setResponse(res.response);
    setLogs((prev) => [...res.logs, ...prev].slice(0, 50));
  }, [workerCode, requestData, envVars, kvNamespace]);

  // Load unified /worker.js on mount
  useEffect(() => {
    fetch(`/worker.js?v=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : null))
      .then((txt) => {
        if (txt && txt.trim().length > 100) {
          setWorkerCode(txt);
        }
      })
      .catch(() => {});
  }, []);

  const handleSelectTemplate = (template: WorkerTemplate) => {
    setSelectedTemplateId(template.id);
    setWorkerCode(template.code);
    setRequestData((prev) => ({
      ...prev,
      method: template.recommendedMethod || 'GET',
      url: template.recommendedPath || '/api/',
      headers: template.recommendedHeaders || { Accept: 'application/json' },
      body: template.recommendedBody || '',
    }));

    if (template.kvSeed) {
      for (const [k, v] of Object.entries(template.kvSeed)) {
        kvNamespace.setItemDirect(k, v);
      }
      setKvTick((t) => t + 1);
    }

    if (template.envSeed) {
      const nextEnv = [...envVars];
      for (const [k, v] of Object.entries(template.envSeed)) {
        const existing = nextEnv.find((e) => e.key === k);
        if (existing) {
          existing.value = v;
        } else {
          nextEnv.push({ key: k, value: v, isSecret: false });
        }
      }
      setEnvVars(nextEnv);
    }

    setActiveTab('editor');
  };

  const handleAddEnvVar = (key: string, value: string, isSecret: boolean) => {
    setEnvVars((prev) => [...prev.filter((e) => e.key !== key), { key, value, isSecret }]);
  };

  const handleRemoveEnvVar = (key: string) => {
    setEnvVars((prev) => prev.filter((e) => e.key !== key));
  };

  // Dispatch Telegram delivery through Worker /api/tma/stream
  const handleDispatchWorkerStream = useCallback(
    async (payload: Record<string, unknown>) => {
      const envMap: Record<string, string> = {};
      for (const v of envVars) {
        envMap[v.key] = v.value;
      }
      const streamReq: WorkerRequestData = {
        ...requestData,
        method: 'POST',
        url: '/api/tma/stream',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      };
      const res = await executeWorkerSandbox(workerCode, streamReq, envMap, kvNamespace);
      setLogs((prev) => [...res.logs, ...prev].slice(0, 50));
      try {
        return JSON.parse(res.response.body);
      } catch {
        return { ok: res.response.status >= 200 && res.response.status < 300 };
      }
    },
    [workerCode, requestData, envVars, kvNamespace]
  );

  // Dispatch >200MB JSON Backup split chunks to Worker /api/import-json
  const handleDispatchWorkerImportBatch = useCallback(
    async (payload: Record<string, unknown>) => {
      const envMap: Record<string, string> = {};
      for (const v of envVars) {
        envMap[v.key] = v.value;
      }

      // Local helper that verifies entry existence in D1 before triggering any external API calls, enforcing the 85% stop-limit
      const checkDatabaseForExistingTitle = (
        title: string,
        meta?: { year?: number | string | null; isSeries?: boolean }
      ) => {
        return queryD1ForExistingTitle(title, {
          year: meta?.year ?? null,
          isSeries: meta?.isSeries,
          kvNamespace,
          stopConfidenceThreshold: 85,
        });
      };

      const rawEntries = Array.isArray(payload.entries)
        ? (payload.entries as Array<Record<string, any>>)
        : Array.isArray(payload.messages)
          ? (payload.messages as Array<Record<string, any>>)
          : [];

      // 1. Set-based deduplication of payload items BEFORE the D1-check
      const seenBatchItemKeys = new Set<string>();
      const deduplicatedEntries: Array<Record<string, any>> = [];
      let deduplicatedItemsDropped = 0;

      for (const item of rawEntries) {
        if (!item || typeof item !== 'object') {
          deduplicatedEntries.push(item);
          continue;
        }

        const rawTitle = String(
          item.cleanTitle ||
            item.clean_title ||
            item.series_title ||
            item.title ||
            item.name ||
            item.filename ||
            item.file_name ||
            item.rawInput ||
            item.caption ||
            item.text ||
            ''
        ).trim();

        const normalizedTitleKey = rawTitle
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

        const telegramIdKey = String(
          item.file_unique_id ||
            item.fileUniqueId ||
            item.document?.file_unique_id ||
            item.video?.file_unique_id ||
            item.file_id ||
            item.fileId ||
            item.message_id ||
            item.msg_id ||
            item.msgId ||
            item.id ||
            ''
        ).trim();

        const seasonVal = item.season ?? item.season_number ?? '';
        const episodeVal = item.episode ?? item.episode_number ?? '';
        const seMatch = rawTitle.match(
          /\b(?:S(\d{1,2})E(\d{1,3})|(\d{1,2})x(\d{1,3})|Staffel\s*(\d{1,2}).*?Folge\s*(\d{1,3}))\b/i
        );
        const seKey =
          seasonVal !== '' || episodeVal !== ''
            ? `s${seasonVal}e${episodeVal}`
            : seMatch
              ? `s${Number(seMatch[1] || seMatch[3] || seMatch[5] || 0)}e${Number(
                  seMatch[2] || seMatch[4] || seMatch[6] || 0
                )}`
              : '';

        const yearKey = String(item.year ?? item.release_year ?? '').trim();

        // Build composite identity key: Telegram-ID + normalized title + S/E + year
        if (telegramIdKey || normalizedTitleKey) {
          const itemDedupKey = `${telegramIdKey}::${normalizedTitleKey}::${seKey}::${yearKey}`;
          if (seenBatchItemKeys.has(itemDedupKey)) {
            deduplicatedItemsDropped++;
            continue;
          }
          seenBatchItemKeys.add(itemDedupKey);
        }

        deduplicatedEntries.push(item);
      }

      const D1_LATENCY_THRESHOLD_MS = 2000;
      const D1_COOLDOWN_DURATION_MS = 5000;
      let cooldownTriggered = false;
      let totalCooldownMs = 0;

      // 2. Set/Map-based deduplication of D1 database lookups across the batch + Phase A latency tracking
      const tPreCheckStart = performance.now();
      const seenD1QueryKeys = new Set<string>();
      const batchD1LookupCache = new Map<
        string,
        ReturnType<typeof checkDatabaseForExistingTitle>
      >();
      let d1PreMatchedCount = 0;
      let d1BatchCacheHits = 0;

      const preCheckedEntries = deduplicatedEntries.map((item) => {
        if (!item || typeof item !== 'object') return item;
        if (item.tmdb_id || item.tmdbId) {
          d1PreMatchedCount++;
          return item;
        }
        const candidateTitle = String(
          item.cleanTitle ||
            item.clean_title ||
            item.series_title ||
            item.title ||
            item.name ||
            item.filename ||
            item.file_name ||
            item.rawInput ||
            ''
        ).trim();
        if (!candidateTitle) return item;

        const isSeriesHint =
          item.isSeries === true ||
          item.typeCode === 's' ||
          item.type === 'series' ||
          item.media_type === 'tv' ||
          Boolean(item.season || item.episode || item.season_number || item.episode_number) ||
          /\b(S\d{1,2}E\d{1,3}|\d{1,2}x\d{1,3}|Staffel\s*\d+|Folge\s*\d+)\b/i.test(candidateTitle);

        const itemYear = item.year || item.release_year || null;
        const normalizedD1TitleKey = candidateTitle
          .toLowerCase()
          .replace(/\b(S\d{1,2}E\d{1,3}|\d{1,2}x\d{1,3}|Staffel\s*\d+|Folge\s*\d+)\b.*$/i, '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

        const d1QueryKey = `${normalizedD1TitleKey || candidateTitle.toLowerCase()}::${
          itemYear ?? ''
        }::${isSeriesHint ? 's' : 'm'}`;

        let d1Match: ReturnType<typeof checkDatabaseForExistingTitle>;
        if (seenD1QueryKeys.has(d1QueryKey) && batchD1LookupCache.has(d1QueryKey)) {
          d1Match = batchD1LookupCache.get(d1QueryKey)!;
          d1BatchCacheHits++;
        } else {
          seenD1QueryKeys.add(d1QueryKey);
          d1Match = checkDatabaseForExistingTitle(candidateTitle, {
            year: itemYear,
            isSeries: isSeriesHint ? true : undefined,
          });
          batchD1LookupCache.set(d1QueryKey, d1Match);
        }

        if (d1Match.matched && d1Match.confidence >= 85 && d1Match.tmdbId) {
          d1PreMatchedCount++;
          return {
            ...item,
            tmdb_id: d1Match.tmdbId,
            tmdbId: d1Match.tmdbId,
            typeCode: d1Match.typeCode,
            type: d1Match.typeCode === 's' ? 'series' : 'movie',
            isSeries: d1Match.typeCode === 's',
            cleanTitle: d1Match.title,
            year: item.year || d1Match.year || undefined,
            external_poster_url: item.external_poster_url || d1Match.posterUrl || undefined,
            overview: item.overview || d1Match.overview || undefined,
            preResolvedFromD1: true,
            d1Confidence: d1Match.confidence,
          };
        }
        return item;
      });

      const d1PreCheckLatencyMs = Math.round(performance.now() - tPreCheckStart);

      // Auto-pause if local D1 pre-check latency exceeds 2 seconds (2000ms)
      if (d1PreCheckLatencyMs > D1_LATENCY_THRESHOLD_MS) {
        cooldownTriggered = true;
        totalCooldownMs += D1_COOLDOWN_DURATION_MS;
        const preCooldownLog: ConsoleLogEntry = {
          id: `log_d1_cooldown_pre_${Date.now()}`,
          level: 'warn',
          args: [
            `⏳ Auto-Pause (${D1_COOLDOWN_DURATION_MS / 1000}s Cooldown): D1-Vorab-Check-Latenz (${d1PreCheckLatencyMs}ms) > ${D1_LATENCY_THRESHOLD_MS}ms – Schutz vor HTTP 503 Gateway-Timeout aktiv`,
          ],
          time: new Date().toLocaleTimeString([], {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
        };
        setLogs((prev) => [preCooldownLog, ...prev].slice(0, 50));
        await new Promise((resolve) => setTimeout(resolve, D1_COOLDOWN_DURATION_MS));
      }

      const enrichedPayload: Record<string, unknown> = {
        ...payload,
        ...(Array.isArray(payload.entries) ? { entries: preCheckedEntries } : {}),
        ...(Array.isArray(payload.messages) && !Array.isArray(payload.entries)
          ? { messages: preCheckedEntries }
          : {}),
        d1PreMatchedCount,
        deduplicatedItemsDropped,
        d1BatchCacheHits,
      };

      const sandboxSecret = envMap.TELEGRAM_WEBHOOK_SECRET || 'studio_local_sandbox_import_secret';
      const sandboxEnvMap: Record<string, string> = {
        ...envMap,
        TELEGRAM_WEBHOOK_SECRET: sandboxSecret,
      };
      const importReq: WorkerRequestData = {
        ...requestData,
        method: 'POST',
        url: '/api/import-json',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': sandboxSecret,
        },
        body: JSON.stringify(enrichedPayload),
      };

      // Phase B: Measure Worker D1 batch execution + catalog registration latency
      const tWorkerD1Start = performance.now();
      const res = await executeWorkerSandbox(workerCode, importReq, sandboxEnvMap, kvNamespace);
      let parsedBody: Record<string, any> | null = null;
      try {
        parsedBody = JSON.parse(res.response.body);
        if (parsedBody && Array.isArray(parsedBody.batchItems)) {
          for (const bItem of parsedBody.batchItems) {
            if (bItem && bItem.tmdbId && bItem.cleanTitle) {
              registerResolvedTitleInD1Catalog({
                tmdbId: Number(bItem.tmdbId),
                typeCode: bItem.typeCode === 's' ? 's' : 'm',
                title: String(bItem.cleanTitle),
                year: bItem.year && bItem.year !== 'k.A.' ? bItem.year : null,
                posterUrl: bItem.poster || '',
              });
            }
          }
        }
      } catch {
        parsedBody = null;
      }

      const workerD1LatencyMs = Math.round(performance.now() - tWorkerD1Start);
      const d1LatencyMs = d1PreCheckLatencyMs + workerD1LatencyMs;

      const d1Log: ConsoleLogEntry[] =
        d1PreMatchedCount > 0 || deduplicatedItemsDropped > 0 || d1BatchCacheHits > 0
          ? [
              {
                id: `log_d1_pre_${Date.now()}`,
                level: 'info',
                args: [
                  `⚡ D1-Vorab-Check (85%-Stop-Limit): ${d1PreMatchedCount}/${preCheckedEntries.length} Titel lokal in D1 erkannt (${d1BatchCacheHits} Batch-Query-Cache-Hits, ${deduplicatedItemsDropped} Duplikat-Items vorab gefiltert, D1-Latenz: ${d1LatencyMs}ms) -> TMDb-ID vorab gesetzt (0 externe API-Calls)`,
                ],
                time: new Date().toLocaleTimeString([], {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                }),
              },
            ]
          : [];

      // Auto-pause if Worker D1 batch latency or total D1 operation latency exceeds 2 seconds (2000ms)
      if (
        workerD1LatencyMs > D1_LATENCY_THRESHOLD_MS ||
        (!cooldownTriggered && d1LatencyMs > D1_LATENCY_THRESHOLD_MS)
      ) {
        cooldownTriggered = true;
        totalCooldownMs += D1_COOLDOWN_DURATION_MS;
        const postCooldownLog: ConsoleLogEntry = {
          id: `log_d1_cooldown_post_${Date.now()}`,
          level: 'warn',
          args: [
            `⏳ Auto-Pause (${D1_COOLDOWN_DURATION_MS / 1000}s Cooldown): D1-Batch-Latenz (${d1LatencyMs}ms gesamt | Vorab: ${d1PreCheckLatencyMs}ms | Worker-D1: ${workerD1LatencyMs}ms) > ${D1_LATENCY_THRESHOLD_MS}ms – Schutz vor HTTP 503 Gateway-Timeout aktiv`,
          ],
          time: new Date().toLocaleTimeString([], {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
        };
        setLogs((prev) => [postCooldownLog, ...d1Log, ...res.logs, ...prev].slice(0, 50));
        await new Promise((resolve) => setTimeout(resolve, D1_COOLDOWN_DURATION_MS));
      } else {
        setLogs((prev) => [...d1Log, ...res.logs, ...prev].slice(0, 50));
      }

      if (parsedBody) {
        return {
          ...parsedBody,
          d1PreMatchedCount,
          deduplicatedItemsDropped,
          d1BatchCacheHits,
          d1LatencyMs,
          d1PreCheckLatencyMs,
          workerD1LatencyMs,
          cooldownTriggered,
          cooldownMs: totalCooldownMs,
        };
      }

      return {
        ok: res.response.status >= 200 && res.response.status < 300,
        d1PreMatchedCount,
        deduplicatedItemsDropped,
        d1BatchCacheHits,
        d1LatencyMs,
        d1PreCheckLatencyMs,
        workerD1LatencyMs,
        cooldownTriggered,
        cooldownMs: totalCooldownMs,
      };
    },
    [workerCode, requestData, envVars, kvNamespace]
  );

  const handleAppendLogs = useCallback((newLogs: ConsoleLogEntry[]) => {
    setLogs((prev) => [...newLogs, ...prev].slice(0, 50));
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#090c14] text-slate-100 overflow-hidden font-sans select-none">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenTestRunner={() => setIsTestRunnerOpen(true)}
        workerCode={workerCode}
      />

      {/* Main Workspace with dynamic import() Suspense boundaries */}
      <main className="flex-1 overflow-hidden p-3">
        {activeTab === 'tma' && (
          <Suspense fallback={<ViewLoadingFallback label="TelePort Mini-App Simulator" />}>
            <NetflixTmaSimulator
              workerCode={workerCode}
              envVars={envVars}
              kvNamespace={kvNamespace}
              onAppendLogs={handleAppendLogs}
            />
          </Suspense>
        )}

        {activeTab === 'editor' && (
          <Suspense fallback={<ViewLoadingFallback label="Modulare Worker-Abteilungen" />}>
            <div className="h-full">
              <CodeEditor
                code={workerCode}
                onChange={setWorkerCode}
                selectedTemplateId={selectedTemplateId}
                onSelectTemplate={(id) => {
                  const tmpl = WORKER_TEMPLATES.find((t) => t.id === id);
                  if (tmpl) handleSelectTemplate(tmpl);
                }}
              />
            </div>
          </Suspense>
        )}

        {activeTab === 'simulator' && (
          <Suspense fallback={<ViewLoadingFallback label="Live Telegram Bot Simulator" />}>
            <TelegramBotSimulator
              workerCode={workerCode}
              envVars={envVars}
              kvNamespace={kvNamespace}
              kvTick={kvTick}
              requestData={requestData}
              onChangeRequestData={setRequestData}
              response={response}
              onUpdateResponse={(res, newLogs) => {
                setResponse(res);
                setLogs((prev) => [...newLogs, ...prev].slice(0, 50));
              }}
              logs={logs}
              onClearLogs={() => setLogs([])}
              onDispatchWorkerStream={handleDispatchWorkerStream}
              onDispatchWorkerImportBatch={handleDispatchWorkerImportBatch}
              onOpenMiniAppTab={() => setActiveTab('tma')}
            />
          </Suspense>
        )}

        {activeTab === 'series-health' && (
          <Suspense fallback={<ViewLoadingFallback label="Series Health Analyse" />}>
            <div className="h-full overflow-y-auto pr-1">
              <SeriesHealth workerCode={workerCode} />
            </div>
          </Suspense>
        )}

        {activeTab === 'kv' && (
          <Suspense fallback={<ViewLoadingFallback label="KV & D1 Storage Manager" />}>
            <div className="h-full">
              <KVStorageManager
                kvNamespace={kvNamespace}
                onRefresh={() => setKvTick((t) => t + 1)}
              />
            </div>
          </Suspense>
        )}

        {activeTab === 'deploy' && (
          <Suspense fallback={<ViewLoadingFallback label="Deploy & Einrichtungs-Anleitung" />}>
            <div className="h-full">
              <DeployModal
                workerCode={workerCode}
                workerName={workerName}
                onWorkerNameChange={setWorkerName}
                envVars={envVars}
                onAddEnvVar={handleAddEnvVar}
                onRemoveEnvVar={handleRemoveEnvVar}
                isStandaloneTab={true}
              />
            </div>
          </Suspense>
        )}
      </main>

      {isTestRunnerOpen && (
        <Suspense fallback={null}>
          <TestRunnerModal
            workerCode={workerCode}
            envVars={envVars}
            kvNamespace={kvNamespace}
            isOpen={isTestRunnerOpen}
            onClose={() => setIsTestRunnerOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
