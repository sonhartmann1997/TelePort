import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Copy,
  Check,
  RotateCcw,
  Download,
  FileCode2,
  Layers,
  Zap,
  Search,
  Hash,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { WORKER_TEMPLATES } from '../data/workerTemplates';
import {
  parseWorkerIntoDepartments,
  updateDepartmentInFullWorker,
  optimizeWorkerCode,
} from '../utils/workerDepartments';
import { stripEsModuleExportsForSandbox } from '../utils/workerSandbox';

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  code,
  onChange,
  selectedTemplateId,
  onSelectTemplate,
}) => {
  const [copied, setCopied] = useState(false);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [activeDepartmentId, setActiveDepartmentId] = useState<string>('01-config-catalog');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [optimizationReport, setOptimizationReport] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const departments = useMemo(() => parseWorkerIntoDepartments(code), [code]);
  const totalBytes = useMemo(() => new TextEncoder().encode(code).length, [code]);
  const totalLines = useMemo(() => code.split('\n').length, [code]);

  const activeDepartment = useMemo(() => {
    if (activeDepartmentId === 'ALL') return null;
    return departments.find((d) => d.id === activeDepartmentId) || departments[0] || null;
  }, [departments, activeDepartmentId]);

  const displayedCode = activeDepartment ? activeDepartment.code : code;

  // Validate syntax on full worker code
  useEffect(() => {
    try {
      const testCode = stripEsModuleExportsForSandbox(code);
      new Function(testCode);
      setSyntaxError(null);
    } catch (e: any) {
      setSyntaxError(e.message);
    }
  }, [code]);

  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const handleCodeChange = (newValue: string) => {
    if (!activeDepartment || activeDepartmentId === 'ALL') {
      onChange(newValue);
    } else {
      const updatedFull = updateDepartmentInFullWorker(code, activeDepartment.id, newValue);
      onChange(updatedFull);
    }
  };

  const handleOptimizeAllDepartments = () => {
    const res = optimizeWorkerCode(code);
    onChange(res.optimizedCode);
    setOptimizationReport(
      `${departments.length} Abteilungen optimiert & zusammengeführt · ${(
        res.afterBytes / 1024
      ).toFixed(1)} KB gesamt (${res.compactedLines} Leerzeilen/Ränder bereinigt)`
    );
    setTimeout(() => setOptimizationReport(null), 6000);
  };

  const handleCopy = (copyFull = true) => {
    navigator.clipboard.writeText(copyFull ? code : displayedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = (downloadFull = true) => {
    const content = downloadFull ? code : displayedCode;
    const filename = downloadFull
      ? 'worker.js'
      : `${activeDepartment?.id || 'department'}.js`;
    const blob = new Blob([content], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const jumpToSearchOrAnchor = (term: string) => {
    if (!textareaRef.current || !term) return;
    const idx = displayedCode.toLowerCase().indexOf(term.toLowerCase());
    if (idx !== -1) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(idx, idx + term.length);
      const linesBefore = displayedCode.slice(0, idx).split('\n').length;
      const lineHeight = 20;
      textareaRef.current.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight);
      handleScroll();
    }
  };

  const displayedLinesCount = displayedCode.split('\n').length;
  // Cap line numbers rendering to avoid DOM lag when viewing all 39k lines at once
  const renderedLineNumbersCount = Math.min(displayedLinesCount, 6000);
  const startLineOffset = activeDepartment ? activeDepartment.startLineInFull - 1 : 0;

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
      {/* Top Architecture Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold text-slate-100">
              Modulare Worker-Abteilungen ({departments.length} Module → 1 großes Ganzes)
            </span>
          </div>
          <span className="text-slate-700">·</span>
          <span className="text-[11px] font-mono text-slate-400">
            Gesamt: <strong className="text-slate-200">{totalLines.toLocaleString()} Zeilen</strong> (
            {(totalBytes / 1024).toFixed(1)} KB)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search in current department */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') jumpToSearchOrAnchor(searchQuery);
              }}
              placeholder="In Abteilung suchen (Enter)…"
              className="bg-slate-900 border border-slate-800 focus:border-amber-500/60 rounded-lg pl-8 pr-2.5 py-1 text-[11px] text-slate-200 placeholder-slate-500 outline-none w-48"
            />
          </div>

          <button
            onClick={handleOptimizeAllDepartments}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[11px] font-semibold transition-colors cursor-pointer"
            title="Optimiert alle 9 Abteilungen (entfernt redundante Leerzeilen & Whitespaces) und fügt sie nahtlos zum großen Ganzen zusammen"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Code optimieren &amp; bündeln</span>
          </button>

          <button
            onClick={() => handleCopy(false)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-medium transition-colors"
            title="Aktuelle Ansicht kopieren"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>{activeDepartment ? 'Abteilung kopieren' : 'Alles kopieren'}</span>
          </button>

          <button
            onClick={() => handleDownload(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors cursor-pointer"
            title="Lädt alle 9 Abteilungen zusammengeführt als eine vollständige worker.js Datei herunter"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Gesamte worker.js laden</span>
          </button>
        </div>
      </div>

      {/* Optimization Banner if triggered */}
      {optimizationReport && (
        <div className="px-4 py-1.5 bg-emerald-950/70 border-b border-emerald-800/60 flex items-center justify-between text-xs text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{optimizationReport}</span>
          </div>
        </div>
      )}

      {/* Main Split View: Left Department Navigator + Right Code Editor */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Sidebar: 9 Departments + Unified View */}
        <div className="w-72 shrink-0 bg-slate-950/80 border-r border-slate-800 flex flex-col overflow-y-auto p-2.5 space-y-1.5">
          <button
            onClick={() => setActiveDepartmentId('ALL')}
            className={`w-full text-left p-2.5 rounded-lg border transition-all ${
              activeDepartmentId === 'ALL'
                ? 'bg-amber-500/15 border-amber-500/50 text-white shadow-xs'
                : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-900 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400">
                📦 Großes Ganzes (worker.js)
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {(totalBytes / 1024).toFixed(0)} KB
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-snug">
              Alle {departments.length} Abteilungen vereint in einer einzigen Deploy-Datei ({totalLines.toLocaleString()} Zeilen).
            </p>
          </button>

          <div className="pt-1 pb-0.5 px-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <span>Worker-Abteilungen (1–{departments.length})</span>
            <span>Zeilen · Größe</span>
          </div>

          {departments.map((dept) => {
            const isSelected = activeDepartmentId === dept.id;
            const pct = Math.max(1, Math.round((dept.byteSize / Math.max(1, totalBytes)) * 100));
            return (
              <button
                key={dept.id}
                onClick={() => setActiveDepartmentId(dept.id)}
                className={`w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-slate-800/95 border-sky-500/60 text-white shadow-sm'
                    : 'bg-slate-900/40 border-slate-800/60 text-slate-300 hover:bg-slate-900/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold truncate">
                    <span className="font-mono text-sky-400 mr-1.5">{dept.number}.</span>
                    {dept.shortTitle}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {dept.lineCount.toLocaleString()} Z. · {(dept.byteSize / 1024).toFixed(0)}K
                  </span>
                </div>
                <p className="text-[10.5px] text-slate-400 mt-1 line-clamp-2 leading-snug">
                  {dept.description}
                </p>
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>
                    Zeile {dept.startLineInFull}–{dept.endLineInFull}
                  </span>
                  <span>{pct}%</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right Area: Active Department Banner + Anchor Bar + Editor */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          {/* Active Department Info & Anchor Jump Bar */}
          {activeDepartment && (
            <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">
                    Abteilung {activeDepartment.number}: {activeDepartment.title}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-[11px] font-mono text-sky-400">
                    worker-modules/{activeDepartment.id}.js
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {activeDepartment.description}
                </p>
              </div>

              {activeDepartment.anchorLocations.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {activeDepartment.anchorLocations.slice(0, 6).map((loc) => (
                    <button
                      key={loc.anchor}
                      onClick={() => jumpToSearchOrAnchor(`@ANCHOR: ${loc.anchor}`)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-mono text-amber-300 transition-colors cursor-pointer"
                      title={`Springe zu @ANCHOR: ${loc.anchor} (Zeile ${loc.fullLine})`}
                    >
                      <Hash className="w-2.5 h-2.5" />
                      <span>{loc.anchor}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Code Editor Surface */}
          <div className="relative flex-1 flex overflow-hidden font-mono text-xs bg-[#090d16]">
            {/* Line Numbers Gutter */}
            <div
              ref={lineNumbersRef}
              className="w-14 py-4 bg-slate-950/70 text-slate-600 text-right pr-3 select-none overflow-hidden border-r border-slate-800/80 leading-5 shrink-0"
            >
              {Array.from({ length: renderedLineNumbersCount }).map((_, idx) => (
                <div key={idx}>{startLineOffset + idx + 1}</div>
              ))}
            </div>

            {/* Editable Textarea */}
            <textarea
              ref={textareaRef}
              value={displayedCode}
              onChange={(e) => handleCodeChange(e.target.value)}
              onScroll={handleScroll}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className="flex-1 p-4 bg-transparent text-slate-100 focus:outline-none resize-none leading-5 overflow-y-auto font-mono selection:bg-amber-500/20"
              placeholder="// Cloudflare Worker JS Code..."
            />
          </div>

          {/* Bottom Status Bar */}
          <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              {syntaxError ? (
                <span className="flex items-center gap-1.5 text-red-400 font-mono truncate max-w-xl">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Syntax Warning: {syntaxError}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>
                    Alle {departments.length} Abteilungen synchron &amp; valide (ES Module / Cloudflare Worker)
                  </span>
                </span>
              )}
            </div>
            <div className="text-slate-500 font-mono text-[11px]">
              {activeDepartment
                ? `Abteilung ${activeDepartment.number} (${activeDepartment.lineCount.toLocaleString()} Zeilen) · Änderungen fließen direkt in worker.js ein`
                : `Gesamter worker.js (${totalLines.toLocaleString()} Zeilen)`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CodeEditor;
