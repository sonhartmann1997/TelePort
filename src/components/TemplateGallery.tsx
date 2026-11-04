import React, { useState } from 'react';
import { Sparkles, ArrowRight, Code, Shield, Database, Globe, RefreshCw, Check } from 'lucide-react';
import { WorkerTemplate } from '../types/worker';
import { WORKER_TEMPLATES } from '../data/workerTemplates';

interface TemplateGalleryProps {
  onSelectTemplate: (template: WorkerTemplate) => void;
  activeTemplateId: string;
}

export const TemplateGallery: React.FC<TemplateGalleryProps> = ({
  onSelectTemplate,
  activeTemplateId,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [previewTemplate, setPreviewTemplate] = useState<WorkerTemplate | null>(null);

  const categories = [
    'All',
    'API & Routing',
    'Security & Auth',
    'Caching & Storage',
    'Traffic & Geo',
    'Transformation',
  ];

  const filtered = WORKER_TEMPLATES.filter(
    (t) => selectedCategory === 'All' || t.category === selectedCategory
  );

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'API & Routing':
        return Code;
      case 'Security & Auth':
        return Shield;
      case 'Caching & Storage':
        return Database;
      case 'Traffic & Geo':
        return Globe;
      default:
        return RefreshCw;
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
      {/* Header & Category Filter */}
      <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Cloudflare Worker Blueprints</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Production-grade serverless edge architectures ready to simulate and deploy.
          </p>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-amber-500 text-slate-950 shadow-xs font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Templates */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((template) => {
            const Icon = getCategoryIcon(template.category);
            const isLoaded = activeTemplateId === template.id;

            return (
              <div
                key={template.id}
                className={`flex flex-col justify-between p-4 rounded-lg border transition-all ${
                  isLoaded
                    ? 'bg-slate-900/90 border-amber-500/60 ring-1 ring-amber-500/30'
                    : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/70'
                }`}
              >
                <div>
                  {/* Category & Status */}
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="flex items-center gap-1.5 text-slate-400 font-medium">
                      <Icon className="w-3.5 h-3.5 text-amber-400" />
                      <span>{template.category}</span>
                    </span>
                    {isLoaded && (
                      <span className="text-[11px] font-mono text-amber-400 font-medium">
                        Active in Editor
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-semibold text-slate-100 mb-1.5">
                    {template.title}
                  </h3>

                  {/* Description */}
                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-3 mb-3">
                    {template.description}
                  </p>

                  {/* Target Endpoint Info */}
                  <div className="p-2 rounded bg-slate-950/80 border border-slate-850 font-mono text-[11px] text-slate-300 mb-4 flex items-center justify-between">
                    <span className="text-amber-400 font-bold">{template.recommendedMethod}</span>
                    <span className="text-slate-400 truncate max-w-[180px]">
                      {template.recommendedPath}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/60">
                  <button
                    onClick={() => setPreviewTemplate(template)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    View Code
                  </button>

                  <button
                    onClick={() => onSelectTemplate(template)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      isLoaded
                        ? 'bg-slate-800 text-slate-300'
                        : 'bg-amber-600 hover:bg-amber-500 text-white shadow-xs'
                    }`}
                  >
                    {isLoaded ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Loaded</span>
                      </>
                    ) : (
                      <>
                        <span>Load Blueprint</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Code Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold text-white">
                  {previewTemplate.title} — worker.js
                </span>
              </div>
              <button
                onClick={() => setPreviewTemplate(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded hover:bg-slate-800"
              >
                Close
              </button>
            </div>

            <div className="p-4 flex-1 overflow-auto bg-slate-950 font-mono text-xs text-slate-200">
              <pre className="whitespace-pre">{previewTemplate.code}</pre>
            </div>

            <div className="p-3 bg-slate-900 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setPreviewTemplate(null)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onSelectTemplate(previewTemplate);
                  setPreviewTemplate(null);
                }}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold"
              >
                Load into Editor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
