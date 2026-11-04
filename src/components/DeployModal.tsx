import React, { useState } from 'react';
import { Download, Copy, Check, Terminal, ExternalLink, ShieldCheck, Box, Sliders, X } from 'lucide-react';
import { WorkerEnvVar } from '../types/worker';
import {
  generateWranglerToml,
  generateWorkerPackageJson,
  createWorkerZip,
} from '../utils/wranglerGenerator';

interface DeployModalProps {
  workerCode: string;
  workerName: string;
  onWorkerNameChange: (name: string) => void;
  envVars: WorkerEnvVar[];
  onAddEnvVar: (key: string, value: string, isSecret: boolean) => void;
  onRemoveEnvVar: (key: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
  isStandaloneTab?: boolean;
}

export const DeployModal: React.FC<DeployModalProps> = ({
  workerCode,
  workerName,
  onWorkerNameChange,
  envVars,
  onAddEnvVar,
  onRemoveEnvVar,
  isOpen = true,
  onClose,
  isStandaloneTab = false,
}) => {
  const [hasKv, setHasKv] = useState(true);
  const [kvBinding, setKvBinding] = useState('MY_KV');
  const [kvId, setKvId] = useState('xxxxxxxxx_my_kv_namespace_id');
  const [nodejsCompat, setNodejsCompat] = useState(true);
  const [compatibilityDate, setCompatibilityDate] = useState('2026-10-01');

  const [copiedToml, setCopiedToml] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // New env var inputs
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [isSecret, setIsSecret] = useState(false);

  const wranglerToml = generateWranglerToml({
    name: workerName,
    compatibilityDate,
    hasKv,
    kvNamespaceName: kvBinding,
    kvNamespaceId: kvId,
    envVars,
    nodejsCompat,
  });

  const handleCopyToml = async () => {
    await navigator.clipboard.writeText(wranglerToml);
    setCopiedToml(true);
    setTimeout(() => setCopiedToml(false), 2000);
  };

  const handleCopyCmd = async (cmd: string, id: string) => {
    await navigator.clipboard.writeText(cmd);
    setCopiedCommand(id);
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  const handleDownloadZip = async () => {
    try {
      setIsDownloading(true);
      const blob = await createWorkerZip(workerCode, {
        name: workerName,
        compatibilityDate,
        hasKv,
        kvNamespaceName: kvBinding,
        kvNamespaceId: kvId,
        envVars,
        nodejsCompat,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${workerName.toLowerCase().replace(/[^a-z0-9-_]/g, '-')}-project.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleAddEnv = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    onAddEnvVar(newKey.trim(), newVal, isSecret);
    setNewKey('');
    setNewVal('');
    setIsSecret(false);
  };

  if (!isOpen && !isStandaloneTab) return null;

  const content = (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Title & Description */}
      <div className="p-5 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 text-amber-400" />
            <span>Deploy worker.js to Cloudflare Serverless Network</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Configure bindings, generate production-ready <code>wrangler.toml</code>, and deploy to 300+ global data centers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadZip}
            disabled={isDownloading}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 text-white rounded-md text-xs font-semibold shadow-xs transition-colors"
          >
            {isDownloading ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>Download Project ZIP</span>
          </button>

          {!isStandaloneTab && onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Config Left, Generated Output Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
        {/* Left Column: Configuration Controls */}
        <div className="lg:col-span-6 space-y-5">
          {/* Worker Basics */}
          <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-amber-400" />
              <span>Worker Identity &amp; Runtime</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Worker Name
                </label>
                <input
                  type="text"
                  value={workerName}
                  onChange={(e) => onWorkerNameChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Compatibility Date
                </label>
                <input
                  type="date"
                  value={compatibilityDate}
                  onChange={(e) => setCompatibilityDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-hidden focus:border-amber-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="nodejs-compat"
                checked={nodejsCompat}
                onChange={(e) => setNodejsCompat(e.target.checked)}
                className="rounded border-slate-700 text-amber-500 focus:ring-0 focus:outline-hidden"
              />
              <label htmlFor="nodejs-compat" className="text-xs text-slate-300 cursor-pointer">
                Enable Node.js Compatibility (<code>nodejs_compat</code> flag)
              </label>
            </div>
          </div>

          {/* KV Namespace Binding */}
          <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                <span>KV Namespace Binding</span>
              </h3>
              <input
                type="checkbox"
                checked={hasKv}
                onChange={(e) => setHasKv(e.target.checked)}
                className="rounded border-slate-700 text-sky-500"
              />
            </div>

            {hasKv && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Binding Variable (in env)
                  </label>
                  <input
                    type="text"
                    value={kvBinding}
                    onChange={(e) => setKvBinding(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-hidden focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Production KV Namespace ID
                  </label>
                  <input
                    type="text"
                    value={kvId}
                    onChange={(e) => setKvId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-hidden focus:border-sky-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Environment Variables & Secrets */}
          <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-emerald-400" />
              <span>Environment Variables (env)</span>
            </h3>

            {envVars.length > 0 && (
              <div className="space-y-1.5">
                {envVars.map((v) => (
                  <div
                    key={v.key}
                    className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-850 text-xs font-mono"
                  >
                    <span className="text-emerald-400">{v.key}</span>
                    <span className="text-slate-400 truncate max-w-[200px]">
                      {v.isSecret ? '•••••••• (Encrypted Secret)' : `"${v.value}"`}
                    </span>
                    <button
                      onClick={() => onRemoveEnvVar(v.key)}
                      className="text-slate-500 hover:text-rose-400 text-xs px-1"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleAddEnv} className="flex flex-wrap items-center gap-2 pt-1">
              <input
                type="text"
                placeholder="KEY"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="w-28 bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-slate-200"
              />
              <input
                type="text"
                placeholder="Value"
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-slate-200"
              />
              <label className="flex items-center gap-1 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={isSecret}
                  onChange={(e) => setIsSecret(e.target.checked)}
                  className="rounded text-emerald-500"
                />
                <span>Secret</span>
              </label>
              <button
                type="submit"
                className="px-3 py-1 bg-slate-800 hover:bg-slate-750 text-white rounded text-xs font-medium"
              >
                Add
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Generated wrangler.toml & CLI Deploy instructions */}
        <div className="lg:col-span-6 space-y-5">
          {/* wrangler.toml Preview */}
          <div className="rounded-lg bg-slate-900/60 border border-slate-800 overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-900 border-b border-slate-800 text-xs">
              <span className="font-mono font-medium text-slate-300">wrangler.toml</span>
              <button
                onClick={handleCopyToml}
                className="flex items-center gap-1 px-2.5 py-1 text-slate-300 hover:text-white bg-slate-800 rounded text-xs transition-colors"
              >
                {copiedToml ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy toml</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 text-xs font-mono text-slate-200 overflow-x-auto max-h-56 select-text leading-5">
              {wranglerToml}
            </pre>
          </div>

          {/* Cloudflare CLI Commands Step-by-Step */}
          <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Cloudflare CLI Deployment Steps
            </h3>

            <div className="space-y-2 text-xs">
              {[
                {
                  id: 'cmd-login',
                  title: '1. Authenticate with Cloudflare',
                  cmd: 'npx wrangler login',
                },
                {
                  id: 'cmd-dev',
                  title: '2. Run Local Miniflare Server',
                  cmd: 'npx wrangler dev',
                },
                {
                  id: 'cmd-deploy',
                  title: '3. Deploy to Global Edge Network',
                  cmd: 'npx wrangler deploy',
                },
                {
                  id: 'cmd-tail',
                  title: '4. Stream Live Edge Logs',
                  cmd: 'npx wrangler tail',
                },
              ].map((step) => (
                <div key={step.id} className="p-2.5 rounded bg-slate-950 border border-slate-850">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="font-medium text-slate-300">{step.title}</span>
                    <button
                      onClick={() => handleCopyCmd(step.cmd, step.id)}
                      className="text-slate-400 hover:text-white flex items-center gap-1 text-[11px]"
                    >
                      {copiedCommand === step.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copy</span>
                    </button>
                  </div>
                  <code className="text-amber-400 font-mono text-xs block select-all">
                    {step.cmd}
                  </code>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (isStandaloneTab) {
    return (
      <div className="h-full border border-slate-800 rounded-lg overflow-hidden">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-slate-950 border border-slate-800 rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {content}
      </div>
    </div>
  );
};
