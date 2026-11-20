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
    <header className="flex flex-col gap-2 px-4 py-2.5 bg-[#0b0d13]/95 backdrop-blur-md border-b border-white/[0.07] text-slate-100 select-none">
      {/* Top Row: Brand Title + Primary Code Copy / Download Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-amber-400 shrink-0">
            <Zap className="w-4 h-4 fill-current" />
          </div>
          <div className="min-w-0 flex items-center gap-2.5 flex-wrap">
            <span className="text-sm font-bold tracking-tight text-white truncate">
              TelePort Studio
            </span>
            <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
              worker.js · 19 Module
            </span>
          </div>
        </div>

        {/* Right Actions: Copy Code, Download worker.js, Test Suite */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenTestRunner}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.08] transition-colors text-xs font-medium cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tests</span>
          </button>

          <button
            onClick={handleCopyFullCode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-100 border border-white/[0.1] transition-colors text-xs font-medium cursor-pointer"
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
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#e50914] hover:bg-[#f40612] text-white font-semibold text-xs shadow-sm transition-all cursor-pointer"
            title="Lädt die komplette, zusammengeführte worker.js Datei herunter"
          >
            <Download className="w-3.5 h-3.5" />
            <span>worker.js laden</span>
          </button>
        </div>
      </div>

      {/* Bottom Row: Calm Segmented Navigation Tabs */}
      <nav className="flex items-center gap-1 overflow-x-auto pt-0.5 text-xs font-medium">
        <button
          onClick={() => setActiveTab('tma')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'tma'
              ? 'bg-white text-slate-950 border-white font-semibold shadow-xs'
              : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <Film className={`w-3.5 h-3.5 ${activeTab === 'tma' ? 'text-[#e50914]' : 'text-slate-400'}`} />
          <span>Mini-App (TMA)</span>
        </button>

        <button
          onClick={() => setActiveTab('editor')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'editor'
              ? 'bg-white text-slate-950 border-white font-semibold shadow-xs'
              : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <Code2 className={`w-3.5 h-3.5 ${activeTab === 'editor' ? 'text-amber-600' : 'text-slate-400'}`} />
          <span>Code · 9 Abteilungen</span>
        </button>

        <button
          onClick={() => setActiveTab('simulator')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'simulator'
              ? 'bg-white text-slate-950 border-white font-semibold shadow-xs'
              : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <Play className={`w-3.5 h-3.5 ${activeTab === 'simulator' ? 'text-emerald-600' : 'text-slate-400'}`} />
          <span>Telegram Bot Simulator</span>
        </button>

        <button
          onClick={() => setActiveTab('series-health')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'series-health'
              ? 'bg-white text-slate-950 border-white font-semibold shadow-xs'
              : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <Activity className={`w-3.5 h-3.5 ${activeTab === 'series-health' ? 'text-rose-600' : 'text-slate-400'}`} />
          <span>Serien-Lücken (Health)</span>
        </button>

        <button
          onClick={() => setActiveTab('kv')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'kv'
              ? 'bg-white text-slate-950 border-white font-semibold shadow-xs'
              : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <Database className={`w-3.5 h-3.5 ${activeTab === 'kv' ? 'text-sky-600' : 'text-slate-400'}`} />
          <span>KV &amp; D1 Storage</span>
        </button>

        <button
          onClick={() => setActiveTab('deploy')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'deploy'
              ? 'bg-white text-slate-950 border-white font-semibold shadow-xs'
              : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <Terminal className={`w-3.5 h-3.5 ${activeTab === 'deploy' ? 'text-emerald-600' : 'text-slate-400'}`} />
          <span>Deploy &amp; Anleitung</span>
        </button>
      </nav>
    </header>
  );
};
