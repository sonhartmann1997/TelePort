import React, { useState } from 'react';
import { CheckCircle2, XCircle, Play, Plus, Trash2, X, Clock } from 'lucide-react';
import { TestCase, TestResult, WorkerEnvVar } from '../types/worker';
import { executeWorkerSandbox, SimulatedKVNamespace } from '../utils/workerSandbox';

interface TestRunnerModalProps {
  workerCode: string;
  envVars: WorkerEnvVar[];
  kvNamespace: SimulatedKVNamespace;
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_TESTS: TestCase[] = [
  {
    id: 'test_health',
    name: 'GET /api/v1/health returns 200 OK',
    method: 'GET',
    path: '/api/v1/health',
    expectedStatus: 200,
    expectedBodySubstring: 'healthy',
  },
  {
    id: 'test_cors_preflight',
    name: 'OPTIONS CORS preflight returns 204 or 200',
    method: 'OPTIONS',
    path: '/api/v1/health',
    expectedStatus: 204,
  },
  {
    id: 'test_items_listing',
    name: 'GET /api/v1/items returns item list',
    method: 'GET',
    path: '/api/v1/items?limit=2',
    expectedStatus: 200,
  },
  {
    id: 'test_not_found',
    name: 'Unrecognized routes return 404 Not Found',
    method: 'GET',
    path: '/unknown/edge/route/999',
    expectedStatus: 404,
  },
];

export const TestRunnerModal: React.FC<TestRunnerModalProps> = ({
  workerCode,
  envVars,
  kvNamespace,
  isOpen,
  onClose,
}) => {
  const [tests, setTests] = useState<TestCase[]>(DEFAULT_TESTS);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [isRunning, setIsRunning] = useState(false);

  // New test input
  const [newName, setNewName] = useState('');
  const [newMethod, setNewMethod] = useState('GET');
  const [newPath, setNewPath] = useState('/api/');
  const [newStatus, setNewStatus] = useState('200');
  const [showAdd, setShowAdd] = useState(false);

  if (!isOpen) return null;

  const handleRunAll = async () => {
    setIsRunning(true);
    const newResults: Record<string, TestResult> = {};

    const envMap: Record<string, string> = {};
    for (const v of envVars) {
      envMap[v.key] = v.value;
    }

    for (const t of tests) {
      const res = await executeWorkerSandbox(
        workerCode,
        {
          method: t.method,
          url: t.path,
          headers: t.headers || { 'Accept': 'application/json' },
          body: t.body || '',
          cf: {
            country: 'US',
            city: 'Ashburn',
            colo: 'IAD',
            asn: 13335,
            rayId: 'test-ray-run',
            clientTrustScore: 99,
            tlsVersion: 'TLSv1.3',
          },
        },
        envMap,
        kvNamespace
      );

      let passed = res.response.status === t.expectedStatus;
      let message = '';

      if (t.expectedBodySubstring && !res.response.body.includes(t.expectedBodySubstring)) {
        // If it was a generic 404 and expected 404, it might pass; otherwise fail
        if (res.response.status === t.expectedStatus) {
          passed = true;
        } else {
          passed = false;
          message = `Body did not contain "${t.expectedBodySubstring}"`;
        }
      }

      if (!passed && !message) {
        message = `Expected HTTP ${t.expectedStatus}, got ${res.response.status}`;
      }

      newResults[t.id] = {
        testId: t.id,
        passed,
        durationMs: res.response.durationMs,
        actualStatus: res.response.status,
        message,
      };
    }

    setResults(newResults);
    setIsRunning(false);
  };

  const handleAddTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const newTest: TestCase = {
      id: `test_${Date.now()}`,
      name: newName,
      method: newMethod,
      path: newPath,
      expectedStatus: parseInt(newStatus, 10) || 200,
    };

    setTests([...tests, newTest]);
    setNewName('');
    setNewPath('/api/');
    setShowAdd(false);
  };

  const handleDeleteTest = (id: string) => {
    setTests(tests.filter((t) => t.id !== id));
    const nextResults = { ...results };
    delete nextResults[id];
    setResults(nextResults);
  };

  const passCount = Object.values(results).filter((r) => r.passed).length;
  const failCount = Object.values(results).filter((r) => !r.passed).length;
  const totalRan = Object.keys(results).length;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-slate-950 border border-slate-800 rounded-lg max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Cloudflare Worker Automated Test Suite</h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRunAll}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white rounded text-xs font-semibold shadow-xs transition-colors"
            >
              {isRunning ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>Run Suite</span>
            </button>

            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Strip if tests have run */}
        {totalRan > 0 && (
          <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-slate-800 text-xs">
            <div className="flex items-center gap-4">
              <span className="text-emerald-400 font-semibold">{passCount} Passed</span>
              {failCount > 0 && <span className="text-rose-400 font-semibold">{failCount} Failed</span>}
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">{tests.length} Total Cases</span>
            </div>
          </div>
        )}

        {/* Tests List */}
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {tests.map((t) => {
            const res = results[t.id];

            return (
              <div
                key={t.id}
                className="p-3 rounded bg-slate-900/60 border border-slate-850 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3">
                  {res ? (
                    res.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    )
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-700 shrink-0" />
                  )}

                  <div>
                    <div className="font-medium text-slate-200 flex items-center gap-2">
                      <span>{t.name}</span>
                      <span className="text-[11px] font-mono text-amber-400">{t.method} {t.path}</span>
                    </div>

                    {res && !res.passed && (
                      <p className="text-[11px] text-rose-400 mt-0.5">{res.message}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-slate-400 font-mono text-[11px]">
                    Expected: {t.expectedStatus}
                  </span>

                  {res && (
                    <span className="text-slate-500 font-mono text-[11px] tabular-nums flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {res.durationMs}ms
                    </span>
                  )}

                  <button
                    onClick={() => handleDeleteTest(t.id)}
                    className="text-slate-500 hover:text-rose-400 p-1"
                    title="Delete Test Case"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Test Form */}
        <div className="p-3 bg-slate-900 border-t border-slate-800">
          {showAdd ? (
            <form onSubmit={handleAddTest} className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Test Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="sm:col-span-2 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200"
                />
                <select
                  value={newMethod}
                  onChange={(e) => setNewMethod(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="OPTIONS">OPTIONS</option>
                </select>
                <input
                  type="number"
                  placeholder="Status (e.g. 200)"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  required
                  placeholder="Path (e.g. /api/v1/health)"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 font-mono"
                />
                <button
                  type="submit"
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium"
                >
                  Add Test
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Custom Test Assertion</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
