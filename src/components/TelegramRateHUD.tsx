import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Zap,
  AlertCircle,
  Play,
  Trash2,
  Scissors,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { SimulatedKVNamespace } from '../utils/workerSandbox';
import {
  TelegramAntiSpamSnapshot,
  DeliveryMode,
  getTelegramAntiSpamSnapshot,
  drainClientAntiSpamQueue,
  simulateClientAntiSpamBurst,
  simulateClient429FloodWait,
  clearClientAntiSpamQueue,
} from '../utils/telegramIntegration';

interface TelegramRateHUDProps {
  kvNamespace?: SimulatedKVNamespace;
  kvTick?: number;
  targetChatId?: string;
  deliveryMode?: DeliveryMode;
  onOpenSplitterModal?: () => void;
  onQueueUpdated?: () => void;
}

export const TelegramRateHUD: React.FC<TelegramRateHUDProps> = ({
  kvNamespace,
  kvTick,
  targetChatId = '-1001987654321',
  deliveryMode = 'group',
  onOpenSplitterModal,
  onQueueUpdated,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [snap, setSnap] = useState<TelegramAntiSpamSnapshot>(() =>
    getTelegramAntiSpamSnapshot(targetChatId, kvNamespace)
  );

  const syncFromKv = useCallback(() => {
    setSnap(getTelegramAntiSpamSnapshot(targetChatId, kvNamespace));
  }, [targetChatId, kvNamespace]);

  useEffect(() => {
    syncFromKv();
  }, [kvTick, syncFromKv]);

  useEffect(() => {
    const handleUpdate = () => syncFromKv();
    window.addEventListener('tg-antispam-updated', handleUpdate);
    window.addEventListener('tg-activity-updated', handleUpdate);
    return () => {
      window.removeEventListener('tg-antispam-updated', handleUpdate);
      window.removeEventListener('tg-activity-updated', handleUpdate);
    };
  }, [syncFromKv]);

  // Live 500ms tick for real-time retry_after countdown & automated queue draining from KV
  useEffect(() => {
    const isActive =
      snap.queueCount > 0 ||
      snap.gauges.floodWait429.active ||
      snap.gauges.singleChatPacing.cooldownMs > 0 ||
      snap.gauges.globalPerSec.used > 0;

    if (!isActive) return;

    const timer = window.setInterval(() => {
      const drained = drainClientAntiSpamQueue(false, kvNamespace);
      setSnap(drained.snapshot);
      if (drained.drainedCount > 0 && onQueueUpdated) {
        onQueueUpdated();
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [
    snap.queueCount,
    snap.gauges.floodWait429.active,
    snap.gauges.singleChatPacing.cooldownMs,
    snap.gauges.globalPerSec.used,
    kvNamespace,
    onQueueUpdated,
  ]);

  const isFlood429 = snap.gauges.floodWait429.active;
  const retryAfterSec = snap.gauges.floodWait429.remainingSec;
  const isQueued = snap.queueCount > 0;
  const isPacing = snap.gauges.singleChatPacing.cooldownMs > 0;

  const statusTone = isFlood429
    ? {
        border: 'border-rose-500/60',
        bg: 'bg-[#180c12]/95',
        accentText: 'text-rose-300',
        label: `429 RETRY_AFTER ${retryAfterSec}s`,
      }
    : isQueued
    ? {
        border: 'border-amber-500/50',
        bg: 'bg-[#16120b]/95',
        accentText: 'text-amber-300',
        label: `QUEUE ACTIVE (${snap.queueCount})`,
      }
    : isPacing
    ? {
        border: 'border-sky-500/40',
        bg: 'bg-[#0d1524]/95',
        accentText: 'text-sky-300',
        label: `PACING ${snap.gauges.singleChatPacing.cooldownMs}ms`,
      }
    : {
        border: 'border-slate-700/80',
        bg: 'bg-[#0d131f]/95',
        accentText: 'text-emerald-300',
        label: 'RATE OK',
      };

  const handleSimulateBurst = (e: React.MouseEvent) => {
    e.stopPropagation();
    const res = simulateClientAntiSpamBurst(5, targetChatId, deliveryMode, kvNamespace);
    setSnap(res.snapshot);
    onQueueUpdated?.();
  };

  const handleSimulate429 = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextSnap = simulateClient429FloodWait(6, targetChatId, kvNamespace);
    setSnap(nextSnap);
    onQueueUpdated?.();
  };

  const handleDrainNow = (e: React.MouseEvent) => {
    e.stopPropagation();
    const res = drainClientAntiSpamQueue(true, kvNamespace);
    setSnap(res.snapshot);
    onQueueUpdated?.();
  };

  const handleClearQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextSnap = clearClientAntiSpamQueue(kvNamespace);
    setSnap(nextSnap);
    onQueueUpdated?.();
  };

  return (
    <div className="pointer-events-auto font-sans tabular-nums select-none z-30">
      {/* Compact Floating HUD Pill */}
      <div
        className={`rounded-lg border ${statusTone.border} ${statusTone.bg} backdrop-blur-md shadow-xl transition-all duration-150`}
      >
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="flex items-center gap-2 text-left min-w-0 focus:outline-none"
            title="TelegramRateHUD ein-/ausklappen (Live KV Rate-Limits & Warteschleife)"
          >
            <ShieldAlert
              className={`w-3.5 h-3.5 shrink-0 ${
                isFlood429
                  ? 'text-rose-400'
                  : isQueued
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            />
            <span className={`text-[11px] font-mono font-bold whitespace-nowrap shrink-0 ${statusTone.accentText}`}>
              {statusTone.label}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="text-[11px] font-mono text-slate-300 whitespace-nowrap shrink-0">
              {snap.gauges.globalPerSec.used}/{snap.gauges.globalPerSec.max} msg/s
            </span>
            <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="text-[11px] font-mono text-slate-300 whitespace-nowrap shrink-0 hidden sm:inline">
              Grp {snap.gauges.groupPerMin.used}/{snap.gauges.groupPerMin.max}m
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="text-[11px] font-mono text-slate-200 whitespace-nowrap shrink-0">
              Queue: {snap.queueCount}
            </span>
            {isFlood429 && (
              <>
                <span className="text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span className="text-[11px] font-mono font-bold text-rose-300 whitespace-nowrap shrink-0">
                  retry_after: {retryAfterSec}s
                </span>
              </>
            )}
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-0.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-0.5" />
            )}
          </button>

          {onOpenSplitterModal && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenSplitterModal();
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/90 hover:bg-slate-700 text-sky-300 border border-slate-700 text-[10px] font-medium whitespace-nowrap shrink-0 transition-colors"
              title=">200 MB JSON-Backup Stream-Splitter & Batch-Importer öffnen"
            >
              <Scissors className="w-3 h-3" />
              <span>&gt;200MB JSON Splitter</span>
            </button>
          )}
        </div>

        {/* Expanded HUD Telemetry Drawer */}
        {expanded && (
          <div className="px-3 pb-3 pt-2 border-t border-slate-800/90 space-y-2.5 w-full sm:w-[460px]">
            {/* Header & KV Sync Indicator */}
            <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
              <span>KV Source: TG_ANTI_SPAM_STATE_JSON</span>
              <span>
                Drained: {snap.stats.totalDrained} · 429 Hits: {snap.stats.total429Hits}
              </span>
            </div>

            {/* Active 429 Flood-Wait Countdown Alert */}
            {isFlood429 && (
              <div className="p-2 rounded bg-rose-950/50 border border-rose-500/40 flex items-center justify-between gap-2 text-[11px] text-rose-200">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Clock className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="truncate">{(snap.gauges.floodWait429 as any).lastReason || 'Telegram 429 Flood-Wait active'}</span>
                </div>
                <span className="font-mono font-bold text-rose-300 whitespace-nowrap shrink-0">
                  {retryAfterSec}s remaining
                </span>
              </div>
            )}

            {/* 3 Rate-Limit Progress Bars */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded bg-slate-900/90 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">Global/s</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {snap.gauges.globalPerSec.used}/{snap.gauges.globalPerSec.max}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      snap.gauges.globalPerSec.pct >= 80
                        ? 'bg-rose-500'
                        : snap.gauges.globalPerSec.pct >= 45
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.max(5, snap.gauges.globalPerSec.pct)}%` }}
                  />
                </div>
              </div>

              <div className="p-2 rounded bg-slate-900/90 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">Group/m</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {snap.gauges.groupPerMin.used}/{snap.gauges.groupPerMin.max}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      snap.gauges.groupPerMin.pct >= 80
                        ? 'bg-rose-500'
                        : snap.gauges.groupPerMin.pct >= 45
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.max(5, snap.gauges.groupPerMin.pct)}%` }}
                  />
                </div>
              </div>

              <div className="p-2 rounded bg-slate-900/90 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">Chat Pace</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {isFlood429
                      ? `${retryAfterSec}s`
                      : `${snap.gauges.singleChatPacing.cooldownMs}ms`}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      isFlood429
                        ? 'bg-rose-500'
                        : snap.gauges.singleChatPacing.cooldownMs > 0
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`}
                    style={{
                      width: `${
                        isFlood429
                          ? 100
                          : Math.max(5, snap.gauges.singleChatPacing.pct)
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Active Waiting Queue Items */}
            {snap.queue.length > 0 ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-amber-300 font-medium">
                  <span>Pending Queue ({snap.queue.length})</span>
                  <span className="font-mono">Next slot in {snap.nextDueInSec}s</span>
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1 pr-0.5">
                  {snap.queue.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-900/95 border border-slate-800 text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-amber-300 font-semibold">
                          #{item.position}
                        </span>
                        <span className="text-slate-200 truncate">{item.title}</span>
                        <span className="text-slate-500" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono text-[10px] text-sky-300 shrink-0">
                          {item.quality}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-amber-300 whitespace-nowrap shrink-0">
                        ETA {item.etaSec}s
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 py-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Queue empty — all deliveries within Telegram limits.</span>
              </div>
            )}

            {/* Quick Controls */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-slate-800/80">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSimulateBurst}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/35 text-[10px] font-semibold whitespace-nowrap shrink-0 transition-colors"
                >
                  <Zap className="w-3 h-3" />
                  <span>Burst +5</span>
                </button>
                <button
                  type="button"
                  onClick={handleSimulate429}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 text-[10px] font-semibold whitespace-nowrap shrink-0 transition-colors"
                >
                  <AlertCircle className="w-3 h-3" />
                  <span>429 (6s)</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleDrainNow}
                  disabled={snap.queueCount === 0}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-40 text-emerald-300 border border-emerald-500/35 text-[10px] font-semibold whitespace-nowrap shrink-0 transition-colors"
                >
                  <Play className="w-3 h-3" />
                  <span>Drain Next</span>
                </button>
                {snap.queueCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearQueue}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-rose-950/40 text-rose-300 border border-slate-700 text-[10px] font-medium whitespace-nowrap shrink-0 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
