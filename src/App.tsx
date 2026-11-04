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
import { executeWorkerSandbox, SimulatedKVNamespace } from './utils/workerSandbox';

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
      const importReq: WorkerRequestData = {
        ...requestData,
        method: 'POST',
        url: '/api/import-json',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      };
      const res = await executeWorkerSandbox(workerCode, importReq, envMap, kvNamespace);
      setLogs((prev) => [...res.logs, ...prev].slice(0, 50));
      try {
        return JSON.parse(res.response.body);
      } catch {
        return { ok: res.response.status >= 200 && res.response.status < 300 };
      }
    },
    [workerCode, requestData, envVars, kvNamespace]
  );

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
          <Suspense fallback={<ViewLoadingFallback label="STREAMFLIX Mini-App Simulator" />}>
            <NetflixTmaSimulator
              workerCode={workerCode}
              envVars={envVars}
              kvNamespace={kvNamespace}
              onAppendLogs={(newLogs) => setLogs((prev) => [...newLogs, ...prev].slice(0, 50))}
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
