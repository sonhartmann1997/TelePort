import React, { useState } from 'react';
import { Play, Plus, Trash2, Globe, Sliders, Send, Code } from 'lucide-react';
import { CfProperties, WorkerRequestData } from '../types/worker';

interface RequestWorkbenchProps {
  requestData: WorkerRequestData;
  onChange: (data: WorkerRequestData) => void;
  onExecute: () => void;
  isExecuting: boolean;
}

const EDGE_COLOCATIONS = [
  { code: 'IAD', city: 'Ashburn, VA', country: 'US', flag: '🇺🇸' },
  { code: 'FRA', city: 'Frankfurt', country: 'DE', flag: '🇩🇪' },
  { code: 'LHR', city: 'London', country: 'GB', flag: '🇬🇧' },
  { code: 'NRT', city: 'Tokyo Narita', country: 'JP', flag: '🇯🇵' },
  { code: 'GRU', city: 'São Paulo', country: 'BR', flag: '🇧🇷' },
  { code: 'SIN', city: 'Singapore', country: 'SG', flag: '🇸🇬' },
  { code: 'SYD', city: 'Sydney', country: 'AU', flag: '🇦🇺' },
];

export const RequestWorkbench: React.FC<RequestWorkbenchProps> = ({
  requestData,
  onChange,
  onExecute,
  isExecuting,
}) => {
  const [activeTab, setActiveTab] = useState<'headers' | 'body' | 'edge'>('headers');

  const handleMethodChange = (method: string) => {
    onChange({ ...requestData, method });
  };

  const handleUrlChange = (url: string) => {
    onChange({ ...requestData, url });
  };

  const handleHeaderChange = (key: string, value: string, oldKey?: string) => {
    const nextHeaders = { ...requestData.headers };
    if (oldKey && oldKey !== key) {
      delete nextHeaders[oldKey];
    }
    if (key.trim()) {
      nextHeaders[key] = value;
    }
    onChange({ ...requestData, headers: nextHeaders });
  };

  const handleRemoveHeader = (key: string) => {
    const nextHeaders = { ...requestData.headers };
    delete nextHeaders[key];
    onChange({ ...requestData, headers: nextHeaders });
  };

  const handleAddHeader = () => {
    const nextHeaders = { ...requestData.headers, '': '' };
    onChange({ ...requestData, headers: nextHeaders });
  };

  const handleBodyChange = (body: string) => {
    onChange({ ...requestData, body });
  };

  const handleFormatJsonBody = () => {
    try {
      const parsed = JSON.parse(requestData.body);
      onChange({ ...requestData, body: JSON.stringify(parsed, null, 2) });
    } catch {
      // ignore parse failure
    }
  };

  const handleColoSelect = (colo: (typeof EDGE_COLOCATIONS)[0]) => {
    onChange({
      ...requestData,
      cf: {
        ...requestData.cf,
        colo: colo.code,
        city: colo.city,
        country: colo.country,
      },
    });
  };

  const methodColors: Record<string, string> = {
    GET: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    POST: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
    PUT: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    DELETE: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    PATCH: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
    OPTIONS: 'text-slate-300 bg-slate-500/10 border-slate-500/30',
    HEAD: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
  };

  return (
    <div className="flex flex-col bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
      {/* Top Request Bar */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800">
        <div className="flex items-center gap-2">
          {/* Method Select */}
          <select
            value={requestData.method}
            onChange={(e) => handleMethodChange(e.target.value)}
            className={`px-2.5 py-1.5 rounded text-xs font-mono font-semibold border focus:outline-hidden ${
              methodColors[requestData.method] || 'text-slate-200 bg-slate-800 border-slate-700'
            }`}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
            <option value="OPTIONS">OPTIONS</option>
            <option value="HEAD">HEAD</option>
          </select>

          {/* URL Input */}
          <div className="relative flex-1">
            <input
              type="text"
              value={requestData.url}
              onChange={(e) => handleUrlChange(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  onExecute();
                }
              }}
              placeholder="/api/v1/health or full URL"
              className="w-full bg-slate-950 text-slate-100 placeholder-slate-500 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono focus:outline-hidden focus:border-amber-500"
            />
          </div>

          {/* Send Button */}
          <button
            onClick={onExecute}
            disabled={isExecuting}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-800/50 text-slate-950 font-semibold text-xs rounded transition-colors whitespace-nowrap shadow-xs"
            title="Execute worker request (Ctrl+Enter / ⌘+Enter)"
          >
            {isExecuting ? (
              <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>Send</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between px-3 bg-slate-900/60 border-b border-slate-800/80 text-xs">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('headers')}
            className={`px-3 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'headers'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Headers ({Object.keys(requestData.headers).length})
          </button>
          <button
            onClick={() => setActiveTab('body')}
            className={`px-3 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'body'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Body
          </button>
          <button
            onClick={() => setActiveTab('edge')}
            className={`px-3 py-2 border-b-2 font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'edge'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-3 h-3" />
            <span>Edge Geo ({requestData.cf.colo})</span>
          </button>
        </div>

        {activeTab === 'body' && (
          <button
            onClick={handleFormatJsonBody}
            className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800"
          >
            <Code className="w-3 h-3" />
            <span>Format JSON</span>
          </button>
        )}
      </div>

      {/* Tab Panels */}
      <div className="p-3 max-h-48 overflow-y-auto">
        {activeTab === 'headers' && (
          <div className="space-y-2">
            {Object.entries(requestData.headers).map(([key, val], idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={key}
                  onChange={(e) => handleHeaderChange(e.target.value, val, key)}
                  placeholder="Header Name"
                  className="w-1/3 bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-amber-500"
                />
                <input
                  type="text"
                  value={val}
                  onChange={(e) => handleHeaderChange(key, e.target.value)}
                  placeholder="Value"
                  className="flex-1 bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-amber-500"
                />
                <button
                  onClick={() => handleRemoveHeader(key)}
                  className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors"
                  title="Remove Header"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            <button
              onClick={handleAddHeader}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Header</span>
            </button>
          </div>
        )}

        {activeTab === 'body' && (
          <div>
            <textarea
              value={requestData.body}
              onChange={(e) => handleBodyChange(e.target.value)}
              placeholder='{\n  "name": "example",\n  "active": true\n}'
              className="w-full h-32 bg-slate-900 text-slate-200 border border-slate-800 rounded p-2.5 text-xs font-mono resize-none focus:outline-hidden focus:border-amber-500"
              spellCheck={false}
            />
            <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
              <span>Standard for POST / PUT payloads. Ignored for GET requests.</span>
            </div>
          </div>
        )}

        {activeTab === 'edge' && (
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1 font-medium">
                Simulated Cloudflare Edge Colocation (request.cf.colo &amp; country)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {EDGE_COLOCATIONS.map((colo) => (
                  <button
                    key={colo.code}
                    onClick={() => handleColoSelect(colo)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-left transition-colors ${
                      requestData.cf.colo === colo.code
                        ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850'
                    }`}
                  >
                    <span>{colo.flag}</span>
                    <span className="font-mono font-semibold">{colo.code}</span>
                    <span className="text-[10px] text-slate-400 truncate">{colo.city}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-800">
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Client Trust Score (0-99)</label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={requestData.cf.clientTrustScore}
                  onChange={(e) =>
                    onChange({
                      ...requestData,
                      cf: { ...requestData.cf, clientTrustScore: parseInt(e.target.value, 10) || 0 },
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Simulated Ray ID</label>
                <input
                  type="text"
                  value={requestData.cf.rayId}
                  onChange={(e) =>
                    onChange({
                      ...requestData,
                      cf: { ...requestData.cf, rayId: e.target.value },
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">TLS Protocol Version</label>
                <select
                  value={requestData.cf.tlsVersion}
                  onChange={(e) =>
                    onChange({
                      ...requestData,
                      cf: { ...requestData.cf, tlsVersion: e.target.value },
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                >
                  <option value="TLSv1.3">TLSv1.3</option>
                  <option value="TLSv1.2">TLSv1.2</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
