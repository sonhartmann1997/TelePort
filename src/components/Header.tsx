import React, { useState } from 'react';
import {
  Play,
  Download,
  Copy,
  Check,
  Database,
  Code2,
  Terminal,
  CheckCircle2,
  Activity,
  Film,
  Zap,
} from 'lucide-react';

export type StudioTab =
  | 'tma'
  | 'editor'
  | 'simulator'
  | 'series-health'
  | 'kv'
  | 'deploy';

interface HeaderProps {
  activeTab: StudioTab;
  setActiveTab: (tab: StudioTab) => void;
  onOpenTestRunner: () => void;
  workerCode: string;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenTestRunner,
  workerCode,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyFullCode = () => {
    navigator.clipboard.writeText(workerCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFullWorker = () => {
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'worker.js';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <header className="flex flex-col gap-2.5 px-5 py-3 bg-[#0d111a] border-b border-slate-800/90 text-slate-100 select-none">
      {/* Top Row: Brand Title + Primary Code Copy / Download Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white shadow-md shrink-0">
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="text-base font-bold tracking-tight text-white truncate">
                Cloudflare Movie Bot Studio
              </span>
              <span className="text-xs font-mono text-emerald-400">
                worker.js v3.6 · 9 Abteilungen
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate">
              Telegram Film- &amp; Serien-Empfehlungsbot + STREAMFLIX Mini-App (Modulare Single-File Architektur)
            </p>
          </div>
        </div>

        {/* Right Actions: Copy Code, Download worker.js, Test Suite */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenTestRunner}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors text-xs font-medium cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tests</span>
          </button>

          <button
            onClick={handleCopyFullCode}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors text-xs font-semibold cursor-pointer"
            title="Kopiert den gesamten, aus allen 9 Abteilungen zusammengeführten worker.js Code"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-300" />
            )}
            <span>{copied ? 'Kopiert!' : 'Code kopieren'}</span>
          </button>

          <button
            onClick={handleDownloadFullWorker}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-bold text-xs shadow-md transition-all cursor-pointer"
            title="Lädt die komplette, zusammengeführte worker.js Datei herunter"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>worker.js herunterladen</span>
          </button>
        </div>
      </div>

      {/* Bottom Row: Navigation Tabs matching Screenshot */}
      <nav className="flex items-center gap-1.5 overflow-x-auto pt-0.5 text-xs font-medium">
        <button
          onClick={() => setActiveTab('tma')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'tma'
              ? 'bg-red-950/60 border-red-500/60 text-white shadow-xs'
              : 'bg-slate-900/50 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Film className="w-3.5 h-3.5 text-red-500" />
          <span>🍿 Netflix Mini-App (TMA)</span>
        </button>

        <button
          onClick={() => setActiveTab('editor')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'editor'
              ? 'bg-slate-800 border-slate-600 text-white shadow-xs'
              : 'bg-slate-900/50 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Code2 className="w-3.5 h-3.5 text-amber-400" />
          <span>worker.js Code · 9 Abteilungen</span>
        </button>

        <button
          onClick={() => setActiveTab('simulator')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'simulator'
              ? 'bg-slate-800 border-emerald-500/50 text-white shadow-xs'
              : 'bg-slate-900/50 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Play className="w-3.5 h-3.5 text-emerald-400" />
          <span>Live Telegram Simulator</span>
        </button>

        <button
          onClick={() => setActiveTab('series-health')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'series-health'
              ? 'bg-slate-800 border-rose-500/50 text-white shadow-xs'
              : 'bg-slate-900/50 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-rose-400" />
          <span>Serien-Lücken (Series Health)</span>
        </button>

        <button
          onClick={() => setActiveTab('kv')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'kv'
              ? 'bg-slate-800 border-sky-500/50 text-white shadow-xs'
              : 'bg-slate-900/50 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Database className="w-3.5 h-3.5 text-sky-400" />
          <span>KV &amp; D1 Storage</span>
        </button>

        <button
          onClick={() => setActiveTab('deploy')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'deploy'
              ? 'bg-slate-800 border-slate-600 text-white shadow-xs'
              : 'bg-slate-900/50 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
          <span>Einrichtungs-Anleitung &amp; Deploy</span>
        </button>
      </nav>
    </header>
  );
};
