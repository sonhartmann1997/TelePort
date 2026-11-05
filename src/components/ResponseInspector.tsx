import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  FileJson,
  ListTree,
  Terminal,
  Copy,
  Check,
  Clock,
  HardDrive,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Eye,
  Send,
  Bot,
  Users,
  MessageSquare,
  Link2,
  Sparkles,
  X,
  Loader2,
  SlidersHorizontal,
  RefreshCw,
  Activity,
  Download,
  Search,
  Filter,
  ShieldAlert,
  Play,
  Zap,
  Scissors,
} from 'lucide-react';
import { ConsoleLogEntry, WorkerResponseData } from '../types/worker';
import { SimulatedKVNamespace } from '../utils/workerSandbox';
import { TelegramRateHUD } from './TelegramRateHUD';
import { JsonBackupSplitterModal } from './JsonBackupSplitterModal';
import {
  DetectedMediaItem,
  DetectedStreamFile,
  TelegramBotConfig,
  DeliveryMode,
  TelegramActivityLogEntry,
  RetentionPolicyDays,
  TelegramAntiSpamSnapshot,
  detectMediaItemsFromResponse,
  loadTelegramIntegrationConfig,
  saveTelegramIntegrationConfig,
  generateWebhookEndpoint,
  verifyCustomBotToken,
  registerCustomBotWebhook,
  sendMediaToTelegram,
  loadTelegramActivityLog,
  clearTelegramActivityLog,
  loadTelegramRetentionPolicy,
  saveTelegramRetentionPolicy,
  getTelegramAntiSpamSnapshot,
  drainClientAntiSpamQueue,
  simulateClientAntiSpamBurst,
  simulateClient429FloodWait,
  clearClientAntiSpamQueue,
  parseTelegramChannelOrLinkClient,
  validateTelegramChannelClient,
  TelegramChannelValidationResult,
} from '../utils/telegramIntegration';

interface ResponseInspectorProps {
  response: WorkerResponseData | null;
  logs: ConsoleLogEntry[];
  onClearLogs: () => void;
  isExecuting: boolean;
  onDispatchWorkerStream?: (payload: Record<string, unknown>) => Promise<any>;
  onDispatchWorkerImportBatch?: (payload: Record<string, unknown>) => Promise<any>;
  kvNamespace?: SimulatedKVNamespace;
  kvTick?: number;
}

interface DeliveryToastState {
  id: string;
  status: 'pending' | 'success' | 'error';
  title: string;
  stepText: string;
  progress: number;
  targetChatId: string;
  modeUsed: DeliveryMode;
  harvestedFileId?: string | null;
  telegramMessageId?: number | null;
  timestamp: string;
}

type ActivityStatusFilter = 'all' | 'success' | 'error';
type ActivityModeFilter =
  | 'all'
  | 'delivery'
  | 'token_webhook'
  | 'dm'
  | 'group'
  | 'custom_bot';

export const ResponseInspector: React.FC<ResponseInspectorProps> = ({
  response,
  logs,
  onClearLogs,
  isExecuting,
  onDispatchWorkerStream,
  onDispatchWorkerImportBatch,
  kvNamespace,
  kvTick,
}) => {
  const [activeTab, setActiveTab] = useState<
    'body' | 'preview' | 'headers' | 'logs' | 'telegram'
  >('body');
  const [copiedBody, setCopiedBody] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedFileIdKey, setCopiedFileIdKey] = useState<string | null>(null);
  const [isSplitterModalOpen, setIsSplitterModalOpen] = useState(false);

  // Telegram Integration & "Send to Telegram" Drawer State
  const [isTelegramPanelOpen, setIsTelegramPanelOpen] = useState(false);
  const [tgConfig, setTgConfig] = useState<TelegramBotConfig>(() =>
    loadTelegramIntegrationConfig(kvNamespace)
  );
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [isSendingTg, setIsSendingTg] = useState(false);
  const [retryingEntryId, setRetryingEntryId] = useState<string | null>(null);
  const [isVerifyingBot, setIsVerifyingBot] = useState(false);
  const [isRegisteringHook, setIsRegisteringHook] = useState(false);
  const [isValidatingChannel, setIsValidatingChannel] = useState(false);
  const [channelValResult, setChannelValResult] =
    useState<TelegramChannelValidationResult | null>(null);
  const [tgFeedback, setTgFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Real-time Status Indicator Overlay / Toast Notification State
  const [deliveryToast, setDeliveryToast] = useState<DeliveryToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Dedicated 'Telegram Activity' Tab State
  const [activityLogs, setActivityLogs] = useState<TelegramActivityLogEntry[]>(() =>
    loadTelegramActivityLog(kvNamespace)
  );
  const [retentionDays, setRetentionDays] = useState<RetentionPolicyDays>(() =>
    loadTelegramRetentionPolicy(kvNamespace)
  );
  const [retentionFeedback, setRetentionFeedback] = useState<string | null>(null);
  const [activityStatusFilter, setActivityStatusFilter] =
    useState<ActivityStatusFilter>('all');
  const [activityModeFilter, setActivityModeFilter] =
    useState<ActivityModeFilter>('all');
  const [activitySearch, setActivitySearch] = useState('');
  const [antiSpamSnap, setAntiSpamSnap] = useState<TelegramAntiSpamSnapshot>(() =>
    getTelegramAntiSpamSnapshot('', kvNamespace)
  );

  const refreshActivityLogs = useCallback(() => {
    setRetentionDays(loadTelegramRetentionPolicy(kvNamespace));
    setActivityLogs(loadTelegramActivityLog(kvNamespace));
    setAntiSpamSnap(getTelegramAntiSpamSnapshot('', kvNamespace));
  }, [kvNamespace]);

  // Reload config and activity log whenever KV store updates or custom event fires
  useEffect(() => {
    setTgConfig(loadTelegramIntegrationConfig(kvNamespace));
    refreshActivityLogs();
  }, [kvNamespace, kvTick, refreshActivityLogs]);

  useEffect(() => {
    const handler = () => refreshActivityLogs();
    window.addEventListener('tg-activity-updated', handler);
    window.addEventListener('tg-antispam-updated', handler);
    return () => {
      window.removeEventListener('tg-activity-updated', handler);
      window.removeEventListener('tg-antispam-updated', handler);
    };
  }, [refreshActivityLogs]);

  // Auto-tick every 500ms while waiting queue, 429 cooldown, or single-chat pacing is active
  useEffect(() => {
    const hasActiveLimits =
      antiSpamSnap.queueCount > 0 ||
      antiSpamSnap.gauges.floodWait429.active ||
      antiSpamSnap.gauges.singleChatPacing.cooldownMs > 0 ||
      antiSpamSnap.gauges.globalPerSec.used > 0;
    if (!hasActiveLimits) return;
    const timer = window.setInterval(() => {
      const drained = drainClientAntiSpamQueue(false, kvNamespace);
      setAntiSpamSnap(drained.snapshot);
      if (drained.drainedCount > 0) {
        setActivityLogs(loadTelegramActivityLog(kvNamespace));
      }
    }, 550);
    return () => window.clearInterval(timer);
  }, [
    antiSpamSnap.queueCount,
    antiSpamSnap.gauges.floodWait429.active,
    antiSpamSnap.gauges.singleChatPacing.cooldownMs,
    antiSpamSnap.gauges.globalPerSec.used,
    kvNamespace,
  ]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const handleCopyBody = () => {
    if (!response) return;
    navigator.clipboard.writeText(response.body);
    setCopiedBody(true);
    setTimeout(() => setCopiedBody(false), 1800);
  };

  const handleCopyFileId = (entryId: string, fileId: string) => {
    navigator.clipboard.writeText(fileId);
    setCopiedFileIdKey(entryId);
    setTimeout(() => setCopiedFileIdKey(null), 1800);
  };

  const getStatusBadgeStyle = (status: number) => {
    if (status >= 200 && status < 300) {
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    }
    if (status >= 300 && status < 400) {
      return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    }
    if (status >= 400 && status < 500) {
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    }
    return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
  };

  const isHtml = Boolean(
    response &&
      (response.headers['content-type']?.includes('text/html') ||
        response.body.trim().startsWith('<!DOCTYPE html>') ||
        response.body.trim().startsWith('<html'))
  );

  const isJson = Boolean(
    response &&
      (response.headers['content-type']?.includes('application/json') ||
        response.body.trim().startsWith('{') ||
        response.body.trim().startsWith('['))
  );

  // Detect Movie / Series / Episode items from JSON response
  const detectedMediaItems: DetectedMediaItem[] = useMemo(() => {
    if (!response || !isJson) return [];
    return detectMediaItemsFromResponse(response.body);
  }, [response, isJson]);

  useEffect(() => {
    setSelectedItemIndex(0);
    setSelectedFileIndex(0);
    setTgFeedback(null);
  }, [detectedMediaItems]);

  const activeMediaItem: DetectedMediaItem | null =
    detectedMediaItems[selectedItemIndex] || detectedMediaItems[0] || null;

  const updateConfig = (partial: Partial<TelegramBotConfig>) => {
    const updated = saveTelegramIntegrationConfig(partial, kvNamespace);
    setTgConfig(updated);
  };

  const generatedWebhookUrl = useMemo(() => {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://streamflix-worker.workers.dev';
    return generateWebhookEndpoint(origin, tgConfig.botToken);
  }, [tgConfig.botToken]);

  const handleCopyWebhookUrl = () => {
    navigator.clipboard.writeText(generatedWebhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 1800);
  };

  const handleVerifyBotToken = async () => {
    setIsVerifyingBot(true);
    setTgFeedback(null);
    try {
      const res = await verifyCustomBotToken(tgConfig.botToken, kvNamespace);
      if (res.ok) {
        updateConfig({ botUsername: res.username || '' });
        setTgFeedback({
          type: 'success',
          text: `Bot verifiziert: @${res.username || res.firstName} (ID: ${res.botId})`,
        });
      } else {
        setTgFeedback({
          type: 'error',
          text: res.error || 'Bot-Token ungültig.',
        });
      }
    } finally {
      setIsVerifyingBot(false);
    }
  };

  const handleRegisterWebhook = async () => {
    setIsRegisteringHook(true);
    setTgFeedback(null);
    try {
      const res = await registerCustomBotWebhook(
        tgConfig.botToken,
        generatedWebhookUrl,
        tgConfig.webhookSecret,
        kvNamespace
      );
      if (res.ok) {
        setTgFeedback({
          type: 'success',
          text: `Webhook verbunden: ${res.description}`,
        });
      } else {
        setTgFeedback({
          type: 'error',
          text: res.error || 'Webhook konnte nicht registriert werden.',
        });
      }
    } finally {
      setIsRegisteringHook(false);
    }
  };

  const handleValidateSourceChannel = async () => {
    setIsValidatingChannel(true);
    setTgFeedback(null);
    try {
      const parsed = parseTelegramChannelOrLinkClient(tgConfig.sourceGroupId);
      const res = await validateTelegramChannelClient(
        tgConfig.sourceGroupId,
        parsed.sampleMessageId,
        tgConfig,
        kvNamespace
      );
      setChannelValResult(res);
      if (res.channelId && !tgConfig.sourceGroupId.includes('t.me/')) {
        updateConfig({ sourceGroupId: res.channelId });
      }
      setTgFeedback({
        type: res.readable ? 'success' : 'error',
        text: res.diagnosticSummary,
      });
    } finally {
      setIsValidatingChannel(false);
    }
  };

  const executeMediaDeliveryWithToast = async (
    itemToDeliver: DetectedMediaItem,
    configToUse: TelegramBotConfig,
    chosenFile: DetectedStreamFile | null
  ) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }

    const targetPreview =
      configToUse.deliveryMode === 'group'
        ? configToUse.targetGroupId || 'Ziel-Gruppe'
        : configToUse.defaultChatId || 'Chat';

    const nowTime = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    setIsSendingTg(true);
    setTgFeedback(null);

    // Stage 1: Pending - Initializing & resolving KV / source reference
    setDeliveryToast({
      id: `tg_toast_${Date.now()}`,
      status: 'pending',
      title: `${itemToDeliver.typeCode === 's' ? '📺' : '🎬'} ${itemToDeliver.title}`,
      stepText: 'Lese KV Bot-Credentials & bereite Stream-Payload vor…',
      progress: 35,
      targetChatId: targetPreview,
      modeUsed: configToUse.deliveryMode,
      timestamp: nowTime,
    });

    try {
      await new Promise((r) => setTimeout(r, 160));

      // Stage 2: Pending - Dispatching to Telegram Bot API / Worker Stream
      setDeliveryToast((prev) =>
        prev
          ? {
              ...prev,
              stepText:
                chosenFile && String(chosenFile.telegram_file_id).startsWith('tg_export_')
                  ? `Löse Quellgruppen-Nachricht (${chosenFile.telegram_file_id}) per copyMessage auf…`
                  : `Sende Medium an Telegram (${targetPreview})…`,
              progress: 75,
            }
          : null
      );

      const result = await sendMediaToTelegram(
        itemToDeliver,
        configToUse,
        chosenFile,
        onDispatchWorkerStream,
        kvNamespace
      );

      const finalText = result.harvestedFileId
        ? `${result.message} (File-ID: ${result.harvestedFileId.slice(0, 20)}…)`
        : result.message;

      setTgFeedback({
        type: result.ok ? 'success' : 'error',
        text: finalText,
      });

      setDeliveryToast({
        id: `tg_toast_${Date.now()}`,
        status: result.ok ? 'success' : 'error',
        title: `${itemToDeliver.typeCode === 's' ? '📺' : '🎬'} ${itemToDeliver.title}`,
        stepText: finalText,
        progress: 100,
        targetChatId: result.targetChatId || targetPreview,
        modeUsed: result.modeUsed,
        harvestedFileId: result.harvestedFileId || null,
        telegramMessageId: result.telegramMessageId || null,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      });

      if (result.ok) {
        toastTimerRef.current = window.setTimeout(() => {
          setDeliveryToast((current) =>
            current && current.status === 'success' ? null : current
          );
        }, 7000);
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Unerwarteter Fehler beim Telegram-Versand.';
      setTgFeedback({ type: 'error', text: errMsg });
      setDeliveryToast({
        id: `tg_toast_${Date.now()}`,
        status: 'error',
        title: `${itemToDeliver.typeCode === 's' ? '📺' : '🎬'} ${itemToDeliver.title}`,
        stepText: errMsg,
        progress: 100,
        targetChatId: targetPreview,
        modeUsed: configToUse.deliveryMode,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      });
    } finally {
      setIsSendingTg(false);
    }
  };

  const handleSendToTelegram = async () => {
    if (!activeMediaItem) return;
    const latestConfig = loadTelegramIntegrationConfig(kvNamespace);
    setTgConfig(latestConfig);
    const chosenFile =
      activeMediaItem.files && activeMediaItem.files[selectedFileIndex]
        ? activeMediaItem.files[selectedFileIndex]
        : null;
    await executeMediaDeliveryWithToast(activeMediaItem, latestConfig, chosenFile);
  };

  const handleRetryActivityEntry = async (entry: TelegramActivityLogEntry) => {
    if (!entry.retryPayload) return;
    setRetryingEntryId(entry.id);
    try {
      const latestConfig = loadTelegramIntegrationConfig(kvNamespace);
      const mergedConfig: TelegramBotConfig = {
        ...entry.retryPayload.config,
        botToken: latestConfig.botToken || entry.retryPayload.config.botToken,
        defaultChatId:
          latestConfig.defaultChatId || entry.retryPayload.config.defaultChatId,
        targetGroupId:
          latestConfig.targetGroupId || entry.retryPayload.config.targetGroupId,
      };
      await executeMediaDeliveryWithToast(
        entry.retryPayload.item,
        mergedConfig,
        entry.retryPayload.selectedFile || null
      );
    } finally {
      setRetryingEntryId(null);
    }
  };

  // Filtered Telegram Activity entries & statistics
  const activityStats = useMemo(() => {
    let successCount = 0;
    let errorCount = 0;
    for (const entry of activityLogs) {
      if (entry.status === 'success') successCount++;
      else errorCount++;
    }
    return {
      total: activityLogs.length,
      success: successCount,
      error: errorCount,
    };
  }, [activityLogs]);

  const filteredActivityLogs = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    return activityLogs.filter((entry) => {
      if (activityStatusFilter !== 'all' && entry.status !== activityStatusFilter) {
        return false;
      }
      if (activityModeFilter === 'delivery' && entry.eventType !== 'delivery') {
        return false;
      }
      if (
        activityModeFilter === 'token_webhook' &&
        entry.eventType !== 'token_check' &&
        entry.eventType !== 'webhook'
      ) {
        return false;
      }
      if (
        (activityModeFilter === 'dm' ||
          activityModeFilter === 'group' ||
          activityModeFilter === 'custom_bot') &&
        entry.deliveryMode !== activityModeFilter
      ) {
        return false;
      }
      if (q) {
        const hay = [
          entry.title,
          entry.method,
          entry.targetChatId || '',
          entry.harvestedFileId || '',
          entry.summary,
          entry.errorDetails || '',
          entry.deliveryMode,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activityLogs, activityStatusFilter, activityModeFilter, activitySearch]);

  const handleExportActivityJson = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      totalEntries: filteredActivityLogs.length,
      filters: {
        status: activityStatusFilter,
        mode: activityModeFilter,
        search: activitySearch,
      },
      entries: filteredActivityLogs,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telegram-activity-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearActivity = () => {
    clearTelegramActivityLog(kvNamespace);
    refreshActivityLogs();
  };

  const handleSelectRetentionPolicy = (days: RetentionPolicyDays) => {
    const res = saveTelegramRetentionPolicy(days, kvNamespace);
    setRetentionDays(res.retentionDays);
    refreshActivityLogs();
    setRetentionFeedback(
      res.prunedCount > 0
        ? `Retention Policy: ${res.retentionDays}d aktiv (${res.prunedCount} alte Logs bereinigt, KV TTL ${res.ttlSeconds}s)`
        : `Retention Policy: ${res.retentionDays} Tage aktiv (KV expirationTtl: ${res.ttlSeconds}s)`
    );
    window.setTimeout(() => setRetentionFeedback(null), 3500);
  };

  return (
    <div className="flex flex-col h-full bg-[#111726] border border-[#1e293b] rounded-lg overflow-hidden relative">
      {/* Response Status Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#0f1522] border-b border-[#1e293b]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Edge Response
          </span>
          {response && (
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 text-xs font-mono font-bold rounded border flex items-center gap-1.5 ${getStatusBadgeStyle(
                  response.status
                )}`}
              >
                {response.status >= 200 && response.status < 300 ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  <AlertCircle className="w-3 h-3" />
                )}
                {response.status} {response.statusText}
              </span>

              <span className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono text-slate-400 bg-slate-800/70 rounded border border-slate-700/60">
                <Clock className="w-3 h-3 text-[#f6821f]" />
                {response.durationMs} ms
              </span>

              <span className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono text-slate-400 bg-slate-800/70 rounded border border-slate-700/60">
                <HardDrive className="w-3 h-3 text-sky-400" />
                {(response as any).sizeBytes ?? (response.body ? response.body.length : 0)} B
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Action Button: Send to Telegram when a media item (movie/series) is identified */}
          {detectedMediaItems.length > 0 && (
            <div className="flex items-center">
              <button
                type="button"
                onClick={handleSendToTelegram}
                disabled={isSendingTg}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-l border border-sky-500/50 bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-60 text-sky-200 transition-colors"
                title="Erkannten Film / Serie direkt an Telegram senden"
              >
                {isSendingTg ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-300" />
                ) : (
                  <Send className="w-3.5 h-3.5 text-sky-300" />
                )}
                <span>Send to Telegram</span>
                <span className="px-1.5 py-0.2 rounded bg-sky-950/90 text-[10px] font-mono text-sky-300">
                  {detectedMediaItems.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setIsTelegramPanelOpen((prev) => !prev)}
                className={`px-2 py-1 text-xs rounded-r border-y border-r transition-colors ${
                  isTelegramPanelOpen
                    ? 'bg-sky-500 text-slate-950 border-sky-400'
                    : 'bg-sky-500/10 hover:bg-sky-500/25 text-sky-300 border-sky-500/50'
                }`}
                title="Telegram Ziel & Bot-Optionen ein-/ausklappen"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {response && (
            <button
              onClick={handleCopyBody}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded border border-slate-700/60 transition-colors"
            >
              {copiedBody ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Body</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* TelegramRateHUD Overlay Component (Live KV Rate-Limits, retry_after Countdown & Queue Size) */}
      <div className="mx-4 mt-2.5 z-20">
        <TelegramRateHUD
          kvNamespace={kvNamespace}
          kvTick={kvTick}
          targetChatId={
            tgConfig.deliveryMode === 'group' && tgConfig.targetGroupId
              ? tgConfig.targetGroupId
              : tgConfig.defaultChatId || '-1001987654321'
          }
          deliveryMode={tgConfig.deliveryMode}
          onOpenSplitterModal={() => setIsSplitterModalOpen(true)}
          onQueueUpdated={refreshActivityLogs}
        />
      </div>

      {/* Real-time Status Indicator Overlay / Toast Notification for 'Send to Telegram' */}
      {deliveryToast && (
        <div className="mx-4 mt-2.5 z-20 rounded-lg border shadow-xl overflow-hidden transition-all bg-[#0c1322]/95 backdrop-blur-md border-slate-700/80">
          {/* Progress Bar Top Strip */}
          <div className="w-full h-1 bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                deliveryToast.status === 'pending'
                  ? 'bg-sky-400 animate-pulse'
                  : deliveryToast.status === 'success'
                  ? 'bg-emerald-400'
                  : 'bg-rose-500'
              }`}
              style={{ width: `${deliveryToast.progress}%` }}
            />
          </div>

          <div className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              {deliveryToast.status === 'pending' && (
                <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0 mt-0.5" />
              )}
              {deliveryToast.status === 'success' && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              )}
              {deliveryToast.status === 'error' && (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase rounded border ${
                      deliveryToast.status === 'pending'
                        ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                        : deliveryToast.status === 'success'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                    }`}
                  >
                    {deliveryToast.status === 'pending'
                      ? 'Pending'
                      : deliveryToast.status === 'success'
                      ? 'Success'
                      : 'Error'}
                  </span>
                  <span className="font-semibold text-slate-100 truncate">
                    {deliveryToast.title}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                    Target: {deliveryToast.targetChatId}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {deliveryToast.timestamp}
                  </span>
                </div>

                <p
                  className={`text-[11px] leading-snug break-words ${
                    deliveryToast.status === 'error'
                      ? 'text-rose-300'
                      : deliveryToast.status === 'success'
                      ? 'text-emerald-300'
                      : 'text-sky-200'
                  }`}
                >
                  {deliveryToast.stepText}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('telegram')}
                className="px-2 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-medium"
                title="Im Telegram Activity Log anzeigen"
              >
                Activity Log
              </button>
              {deliveryToast.status === 'error' && (
                <button
                  type="button"
                  onClick={handleSendToTelegram}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-[11px] font-medium"
                  title="Erneut senden"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setDeliveryToast(null)}
                className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                title="Status schließen"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collapsible "Send to Telegram" Action & Custom Bot Webhook Drawer */}
      {isTelegramPanelOpen && activeMediaItem && (
        <div className="bg-[#0d1424] border-b border-sky-500/30 px-4 py-3 space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="font-semibold text-slate-100">
                Telegram Media Delivery & Custom Bot Webhook
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                ({activeMediaItem.typeCode === 's' ? '📺 Serie' : '🎬 Film'} #{activeMediaItem.id})
              </span>
            </div>
            <button
              onClick={() => setIsTelegramPanelOpen(false)}
              className="text-slate-400 hover:text-white p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Media selector + Stream file selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                Erkanntes Medium ({detectedMediaItems.length})
              </label>
              <select
                value={selectedItemIndex}
                onChange={(e) => {
                  setSelectedItemIndex(Number(e.target.value));
                  setSelectedFileIndex(0);
                }}
                className="w-full bg-[#131c31] border border-slate-700/80 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
              >
                {detectedMediaItems.map((it, idx) => (
                  <option key={`${it.typeCode}_${it.id}_${idx}`} value={idx}>
                    {it.typeCode === 's' ? '📺' : '🎬'} {it.title}
                    {it.year ? ` (${it.year})` : ''}
                    {it.files.length > 0 ? ` • ${it.files.length} Stream(s)` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                Datei / Stream-Quelle
              </label>
              {activeMediaItem.files.length > 0 ? (
                <select
                  value={selectedFileIndex}
                  onChange={(e) => setSelectedFileIndex(Number(e.target.value))}
                  className="w-full bg-[#131c31] border border-slate-700/80 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
                >
                  {activeMediaItem.files.map((f, fIdx) => {
                    const isExport = String(f.telegram_file_id || '').startsWith('tg_export_');
                    return (
                      <option key={fIdx} value={fIdx}>
                        {f.quality || '1080p'} {f.codec || 'x264'}
                        {f.part ? ` (${f.part})` : ''} •{' '}
                        {isExport ? `📦 Quellgruppe (${f.telegram_file_id})` : `⚡ File-ID`}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <div className="px-2.5 py-1.5 rounded bg-slate-900/80 border border-slate-800 text-slate-400 truncate">
                  TMDb-Medienkarte (Poster + Metadaten + Deep-Link)
                </div>
              )}
            </div>
          </div>

          {/* Delivery Mode Switch: Bot DM vs Target Group vs Custom Bot */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {(
              [
                { id: 'dm', label: 'Privat-Chat (DM)', icon: MessageSquare },
                { id: 'group', label: 'Eigene Ziel-Gruppe', icon: Users },
                { id: 'custom_bot', label: 'Eigener Bot-Token', icon: Bot },
              ] as { id: DeliveryMode; label: string; icon: any }[]
            ).map((m) => {
              const Icon = m.icon;
              const active = tgConfig.deliveryMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => updateConfig({ deliveryMode: m.id })}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                      : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>

          {/* Dynamic Target Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {tgConfig.deliveryMode === 'group' ? (
              <>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">
                    Ziel-Gruppen Chat-ID
                  </label>
                  <input
                    type="text"
                    value={tgConfig.targetGroupId}
                    onChange={(e) => updateConfig({ targetGroupId: e.target.value })}
                    placeholder="-1001234567890"
                    className="w-full bg-[#131c31] border border-slate-700/80 rounded px-2 py-1 text-xs font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">
                    Topic / Thread-ID (optional)
                  </label>
                  <input
                    type="text"
                    value={tgConfig.targetTopicId}
                    onChange={(e) => updateConfig({ targetTopicId: e.target.value })}
                    placeholder="z.B. 42"
                    className="w-full bg-[#131c31] border border-slate-700/80 rounded px-2 py-1 text-xs font-mono text-slate-100"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-[10px] text-slate-400 mb-0.5">
                  Empfänger Chat-ID (Privat / Gruppe)
                </label>
                <input
                  type="text"
                  value={tgConfig.defaultChatId}
                  onChange={(e) => updateConfig({ defaultChatId: e.target.value })}
                  placeholder="z.B. 100998877"
                  className="w-full bg-[#131c31] border border-slate-700/80 rounded px-2 py-1 text-xs font-mono text-slate-100"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <label className="block text-[10px] text-slate-400 truncate">
                  Quell-Kanal-ID oder Link (für copyMessage)
                </label>
                {channelValResult && (
                  <span
                    className={`text-[9px] font-mono px-1 rounded ${
                      channelValResult.readable
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {channelValResult.botStatus.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={tgConfig.sourceGroupId}
                  onChange={(e) => {
                    const val = e.target.value;
                    const parsed = parseTelegramChannelOrLinkClient(val);
                    if (val.includes('t.me/') && parsed.channelId) {
                      updateConfig({ sourceGroupId: parsed.channelId });
                    } else {
                      updateConfig({ sourceGroupId: val });
                    }
                    setChannelValResult(null);
                  }}
                  placeholder="-100... oder https://t.me/c/12345/55"
                  className="flex-1 min-w-0 bg-[#131c31] border border-slate-700/80 rounded px-2 py-1 text-xs font-mono text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleValidateSourceChannel}
                  disabled={isValidatingChannel || !tgConfig.sourceGroupId.trim()}
                  title="Validate Telegram Channel (Dry-Run Permission & copyMessage Test)"
                  className="px-2 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-40 text-sky-300 border border-sky-500/40 text-[11px] font-semibold whitespace-nowrap shrink-0"
                >
                  {isValidatingChannel ? '...' : 'Dry-Run'}
                </button>
              </div>
            </div>
          </div>

          {/* Custom Bot Token & Webhook Generator */}
          {tgConfig.deliveryMode === 'custom_bot' && (
            <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800 space-y-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] text-slate-400 mb-0.5">
                    Eigenes Telegram Bot-Token (@BotFather)
                  </label>
                  <input
                    type="password"
                    value={tgConfig.botToken}
                    onChange={(e) => updateConfig({ botToken: e.target.value })}
                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz..."
                    className="w-full bg-[#131c31] border border-slate-700/80 rounded px-2 py-1 text-xs font-mono text-slate-100"
                  />
                </div>
                <div className="flex items-end gap-1.5">
                  <button
                    type="button"
                    onClick={handleVerifyBotToken}
                    disabled={isVerifyingBot || !tgConfig.botToken.trim()}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 text-xs font-medium"
                  >
                    {isVerifyingBot ? 'Prüfe…' : 'Token prüfen'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRegisterWebhook}
                    disabled={isRegisteringHook || !tgConfig.botToken.trim()}
                    className="px-2.5 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600/40 disabled:opacity-50 text-indigo-300 border border-indigo-500/40 text-xs font-medium"
                  >
                    {isRegisteringHook ? 'Setze…' : 'Webhook aktivieren'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 bg-[#0b101d] px-2.5 py-1.5 rounded border border-slate-800/90">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Link2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="text-[11px] font-mono text-slate-300 truncate">
                    {generatedWebhookUrl}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyWebhookUrl}
                  className="text-[11px] text-sky-400 hover:text-sky-300 shrink-0 font-medium"
                >
                  {copiedWebhook ? 'Kopiert!' : 'Webhook kopieren'}
                </button>
              </div>
            </div>
          )}

          {/* Action Footer */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="min-w-0 flex-1">
              {tgFeedback ? (
                <div
                  className={`text-[11px] px-2.5 py-1 rounded border truncate ${
                    tgFeedback.type === 'success'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : tgFeedback.type === 'error'
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                      : 'bg-sky-500/10 border-sky-500/30 text-sky-300'
                  }`}
                  title={tgFeedback.text}
                >
                  {tgFeedback.text}
                </div>
              ) : (
                <span className="text-[11px] text-slate-400">
                  Tipp: In Gruppen zeigt <code className="text-slate-300">/id</code> sofort die
                  Gruppen- & Topic-ID.
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleSendToTelegram}
              disabled={isSendingTg}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition-colors shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {isSendingTg
                  ? 'Sende an Telegram…'
                  : `Jetzt senden (${
                      tgConfig.deliveryMode === 'group'
                        ? 'Gruppe'
                        : tgConfig.deliveryMode === 'custom_bot'
                        ? 'Eigener Bot'
                        : 'Bot-Chat'
                    })`}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center justify-between px-4 bg-[#111726] border-b border-[#1e293b] overflow-x-auto">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('body')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'body'
                ? 'border-[#f6821f] text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileJson className="w-3.5 h-3.5" />
            Response Body
          </button>

          {isHtml && (
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'preview'
                  ? 'border-[#f6821f] text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
              Live HTML Preview
            </button>
          )}

          <button
            onClick={() => setActiveTab('headers')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'headers'
                ? 'border-[#f6821f] text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ListTree className="w-3.5 h-3.5" />
            Headers
            {response && (
              <span className="px-1.5 py-0.2 text-[10px] bg-slate-800 text-slate-300 rounded-full">
                {Object.keys(response.headers).length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'logs'
                ? 'border-[#f6821f] text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Console Tail
            {logs.length > 0 && (
              <span
                className={`px-1.5 py-0.2 text-[10px] rounded-full ${
                  logs.some((l) => l.level === 'error')
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {logs.length}
              </span>
            )}
          </button>

          {/* Dedicated 'Telegram Activity' Tab */}
          <button
            onClick={() => setActiveTab('telegram')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'telegram'
                ? 'border-sky-400 text-sky-200'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-sky-400" />
            <span>Telegram Activity</span>
            {activityStats.total > 0 && (
              <span
                className={`px-1.5 py-0.2 text-[10px] rounded-full font-mono ${
                  activityStats.error > 0
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                }`}
              >
                {activityStats.total}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'logs' && logs.length > 0 && (
          <button
            onClick={onClearLogs}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-4 font-mono text-xs relative">
        {isExecuting && (
          <div className="absolute inset-0 bg-[#0b0f17]/60 backdrop-blur-[1px] flex items-center justify-center z-10">
            <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-slate-900 border border-slate-700 text-slate-200 text-xs">
              <div className="w-2 h-2 rounded-full bg-[#f6821f] animate-ping" />
              Executing Isolate...
            </div>
          </div>
        )}

        {activeTab === 'telegram' ? (
          <div className="space-y-3 font-sans">
            {/* Filter & Action Toolbar */}
            <div className="flex flex-col gap-2.5 p-3 rounded-lg bg-[#0c1220] border border-slate-800/90">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Status Filter Pills */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActivityStatusFilter('all')}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                      activityStatusFilter === 'all'
                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                        : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    All ({activityStats.total})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivityStatusFilter('success')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                      activityStatusFilter === 'success'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                        : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Success ({activityStats.success})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivityStatusFilter('error')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                      activityStatusFilter === 'error'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                        : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <AlertCircle className="w-3 h-3 text-rose-400" />
                    <span>Errors ({activityStats.error})</span>
                  </button>
                </div>

                {/* Action Buttons: >200MB JSON Splitter, Export JSON & Clear Log */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSplitterModalOpen(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                    title=">200 MB Telegram JSON Backup Stream Splitter & Batch Importer öffnen"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                    <span>&gt;200MB JSON Splitter</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportActivityJson}
                    disabled={filteredActivityLogs.length === 0}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
                    title="Gefiltertes Activity Log als JSON exportieren"
                  >
                    <Download className="w-3.5 h-3.5 text-sky-400" />
                    <span>Export JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearActivity}
                    disabled={activityLogs.length === 0}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-950/30 hover:bg-rose-900/40 disabled:opacity-40 text-rose-300 border border-rose-800/50 text-xs font-medium transition-colors"
                    title="Telegram Activity Log in localStorage & KV leeren"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Log</span>
                  </button>
                </div>
              </div>

              {/* Second Toolbar Row: Event/Mode Filter + Search Input */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="relative">
                  <Filter className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <select
                    value={activityModeFilter}
                    onChange={(e) =>
                      setActivityModeFilter(e.target.value as ActivityModeFilter)
                    }
                    className="w-full pl-8 pr-2.5 py-1.5 bg-[#131c31] border border-slate-700/80 rounded text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                  >
                    <option value="all">Alle Events & Modi</option>
                    <option value="delivery">Nur Datei-/Stream-Lieferungen</option>
                    <option value="token_webhook">Bot-Token Checks & Webhooks</option>
                    <option value="dm">Modus: Privat-Chat (DM)</option>
                    <option value="group">Modus: Eigene Ziel-Gruppe</option>
                    <option value="custom_bot">Modus: Eigener Bot-Token</option>
                  </select>
                </div>

                <div className="sm:col-span-2 relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={activitySearch}
                    onChange={(e) => setActivitySearch(e.target.value)}
                    placeholder="Suche nach Titel, Chat-ID, Methode (copyMessage, sendVideo), File-ID oder Fehlertext…"
                    className="w-full pl-8 pr-7 py-1.5 bg-[#131c31] border border-slate-700/80 rounded text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  {activitySearch && (
                    <button
                      type="button"
                      onClick={() => setActivitySearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Retention Policy Section (7, 30, or 90 days KV Performance) */}
              <div className="pt-2.5 mt-0.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-[#f6821f] shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-slate-200">
                        Retention Policy (KV Performance)
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-sky-300">
                        expirationTtl: {retentionDays * 86400}s
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      Bereinigt Delivery-Logs älter als {retentionDays} Tage automatisch in{' '}
                      <code className="text-slate-300">env.MY_KV</code> (synchron mit{' '}
                      <code className="text-slate-300">worker.js</code>).
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {([7, 30, 90] as RetentionPolicyDays[]).map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => handleSelectRetentionPolicy(days)}
                      className={`px-2.5 py-1 rounded text-[11px] font-mono font-semibold border transition-colors ${
                        retentionDays === days
                          ? 'bg-[#f6821f]/20 text-[#f6821f] border-[#f6821f]/60'
                          : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                      title={`Logs älter als ${days} Tage automatisch löschen`}
                    >
                      {days} Days
                    </button>
                  ))}
                </div>
              </div>

              {retentionFeedback && (
                <div className="px-2.5 py-1.5 rounded bg-emerald-950/30 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{retentionFeedback}</span>
                </div>
              )}
            </div>

            {/* Graphical Telegram Anti-Spam Engine & Automated Waiting Queue Cockpit */}
            <div className="p-3.5 rounded-lg bg-[#0c1220] border border-amber-500/35 space-y-3 tabular-nums">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-100">
                        Telegram Anti-Spam Engine & Automatisierte Warteschleife
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-[10px] font-mono text-amber-300">
                        Queue: {antiSpamSnap.queueCount} aktiv • Drained: {antiSpamSnap.stats.totalDrained}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      Erzwingt 1 Msg / 1,15s pro Chat • 18 Msg / 60s pro Gruppe • 25 Msg / Sek. global +
                      automatische HTTP 429 <code className="text-slate-300">retry_after</code> Pausierung.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const target =
                        tgConfig.deliveryMode === 'group' && tgConfig.targetGroupId
                          ? tgConfig.targetGroupId
                          : tgConfig.defaultChatId || '-1001987654321';
                      const res = simulateClientAntiSpamBurst(
                        5,
                        target,
                        tgConfig.deliveryMode,
                        kvNamespace
                      );
                      setAntiSpamSnap(res.snapshot);
                      refreshActivityLogs();
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-colors"
                    title="Simuliert 5 rasche Sendungen hintereinander (1 sofort + 4 automatisch in der Anti-Spam Warteschleife)"
                  >
                    <Zap className="w-3 h-3" />
                    <span>Burst-Test (5 Jobs)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const target =
                        tgConfig.deliveryMode === 'group' && tgConfig.targetGroupId
                          ? tgConfig.targetGroupId
                          : tgConfig.defaultChatId || '-1001987654321';
                      const snap = simulateClient429FloodWait(6, target, kvNamespace);
                      setAntiSpamSnap(snap);
                      refreshActivityLogs();
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/40 transition-colors"
                    title="Simuliert eine HTTP 429 retry_after=6s Antwort von Telegram"
                  >
                    <AlertCircle className="w-3 h-3" />
                    <span>429 Test (6s)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const res = drainClientAntiSpamQueue(true, kvNamespace);
                      setAntiSpamSnap(res.snapshot);
                      refreshActivityLogs();
                    }}
                    disabled={antiSpamSnap.queueCount === 0}
                    className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-40 text-emerald-300 border border-emerald-500/40 transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    <span>Jetzt abarbeiten</span>
                  </button>

                  {antiSpamSnap.queueCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const snap = clearClientAntiSpamQueue(kvNamespace);
                        setAntiSpamSnap(snap);
                      }}
                      className="px-2 py-1 rounded text-[11px] text-rose-400 hover:bg-rose-500/10 border border-rose-500/30"
                    >
                      Queue leeren
                    </button>
                  )}
                </div>
              </div>

              {/* 3 Graphical Rate-Limit Utilization Gauges */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* Gauge 1: Global / sec */}
                <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 font-semibold">🌐 Global / Sekunde</span>
                    <span
                      className={`font-mono font-bold ${
                        antiSpamSnap.gauges.globalPerSec.pct >= 85
                          ? 'text-rose-400'
                          : antiSpamSnap.gauges.globalPerSec.pct >= 50
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {antiSpamSnap.gauges.globalPerSec.used} / {antiSpamSnap.gauges.globalPerSec.max} Msg/s
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        antiSpamSnap.gauges.globalPerSec.pct >= 85
                          ? 'bg-rose-500'
                          : antiSpamSnap.gauges.globalPerSec.pct >= 50
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.max(4, antiSpamSnap.gauges.globalPerSec.pct)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Hard-Limit: 30/s • Sicherheits-Puffer: 25/s
                  </div>
                </div>

                {/* Gauge 2: Group / min */}
                <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 font-semibold">👥 Gruppe / Minute</span>
                    <span
                      className={`font-mono font-bold ${
                        antiSpamSnap.gauges.groupPerMin.pct >= 85
                          ? 'text-rose-400'
                          : antiSpamSnap.gauges.groupPerMin.pct >= 50
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {antiSpamSnap.gauges.groupPerMin.used} / {antiSpamSnap.gauges.groupPerMin.max} Msg/m
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        antiSpamSnap.gauges.groupPerMin.pct >= 85
                          ? 'bg-rose-500'
                          : antiSpamSnap.gauges.groupPerMin.pct >= 50
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.max(4, antiSpamSnap.gauges.groupPerMin.pct)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">
                    Hard-Limit: 20/m • Ziel: <code className="text-slate-400">{antiSpamSnap.gauges.groupPerMin.chatId}</code>
                  </div>
                </div>

                {/* Gauge 3: Single-Chat Pacing & 429 Flood-Wait */}
                <div
                  className={`p-2.5 rounded bg-slate-900/90 border space-y-1.5 ${
                    antiSpamSnap.gauges.floodWait429.active
                      ? 'border-rose-500/60'
                      : 'border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 font-semibold">⏱️ Chat-Pacing & 429</span>
                    <span
                      className={`font-mono font-bold ${
                        antiSpamSnap.gauges.floodWait429.active
                          ? 'text-rose-400'
                          : antiSpamSnap.gauges.singleChatPacing.cooldownMs > 0
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {antiSpamSnap.gauges.floodWait429.active
                        ? `429 WAIT: ${antiSpamSnap.gauges.floodWait429.remainingSec}s`
                        : antiSpamSnap.gauges.singleChatPacing.cooldownMs > 0
                        ? `${antiSpamSnap.gauges.singleChatPacing.cooldownMs} ms`
                        : 'FREI (0 ms)'}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        antiSpamSnap.gauges.floodWait429.active
                          ? 'bg-rose-500'
                          : antiSpamSnap.gauges.singleChatPacing.cooldownMs > 0
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                      style={{
                        width: `${
                          antiSpamSnap.gauges.floodWait429.active
                            ? 100
                            : Math.max(4, antiSpamSnap.gauges.singleChatPacing.pct)
                        }%`,
                      }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Sofort: {antiSpamSnap.stats.totalSentImmediate} • Gequeued: {antiSpamSnap.stats.totalQueued} • 429 Hits: {antiSpamSnap.stats.total429Hits}
                  </div>
                </div>
              </div>

              {/* Active Waiting Queue Pipeline */}
              {antiSpamSnap.queue.length > 0 ? (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-amber-300">
                    <span>⏳ Aktive Warteschleife ({antiSpamSnap.queue.length} Jobs in Pipeline)</span>
                    <span className="font-mono text-[10px] text-slate-400">
                      Nächste Zustellung in {antiSpamSnap.nextDueInSec}s
                    </span>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                    {antiSpamSnap.queue.map((qItem) => (
                      <div
                        key={qItem.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-slate-900/95 border border-amber-500/30 text-[11px]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold text-[10px]">
                            #{qItem.position}
                          </span>
                          <span className="font-semibold text-slate-100 truncate">
                            {qItem.title}
                          </span>
                          <span className="px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-300 font-mono text-[10px]">
                            {qItem.quality}
                          </span>
                          <span className="text-slate-400 font-mono text-[10px] truncate">
                            ➔ {qItem.chatId} ({qItem.reason})
                          </span>
                        </div>
                        <span className="font-mono font-bold text-amber-300 shrink-0">
                          ETA {qItem.etaSec}s
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 pt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Warteschleife frei – alle ausgehenden Nachrichten halten die Telegram Anti-Spam-Grenzwerte ein.
                  </span>
                </div>
              )}
            </div>

            {/* Activity Log Entries List */}
            {filteredActivityLogs.length === 0 ? (
              <div className="text-center py-10 px-4 rounded-lg border border-dashed border-slate-800 bg-[#0c111d]/60 space-y-2">
                <Send className="w-7 h-7 text-slate-600 mx-auto" />
                <div className="text-slate-300 font-medium text-xs">
                  Keine Telegram-Aktivitäten für den aktuellen Filter gefunden.
                </div>
                <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                  Alle Datei-Lieferungen („Send to Telegram“), Quellgruppen-Auflösungen (
                  <code className="text-slate-400">copyMessage</code>), Bot-Token-Prüfungen (
                  <code className="text-slate-400">getMe</code>) und Webhook-Registrierungen werden
                  hier automatisch protokolliert und in <code className="text-slate-400">env.MY_KV</code>{' '}
                  gespeichert.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredActivityLogs.map((entry) => {
                  const isSuccess = entry.status === 'success';
                  const formattedTime = new Date(entry.timestamp).toLocaleString([], {
                    month: 'short',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  });

                  return (
                    <div
                      key={entry.id}
                      className={`p-3 rounded-lg border transition-colors ${
                        isSuccess
                          ? 'bg-[#0c1322] border-slate-800/90 hover:border-slate-700'
                          : 'bg-rose-950/15 border-rose-500/30 hover:border-rose-500/50'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          {/* Status Badge */}
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase rounded border ${
                              isSuccess
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                            }`}
                          >
                            {isSuccess ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <AlertCircle className="w-3 h-3" />
                            )}
                            {entry.status}
                          </span>

                          {/* Method Badge */}
                          <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                            {entry.method}
                          </span>

                          {/* Delivery Mode Badge */}
                          <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {entry.deliveryMode === 'group'
                              ? '👥 Gruppe'
                              : entry.deliveryMode === 'custom_bot'
                              ? '🤖 Custom Bot'
                              : entry.deliveryMode === 'dm'
                              ? '💬 Bot DM'
                              : '⚙️ System'}
                          </span>

                          {/* Title */}
                          <span className="font-semibold text-slate-100 text-xs truncate">
                            {entry.mediaType === 'series'
                              ? '📺 '
                              : entry.mediaType === 'movie'
                              ? '🎬 '
                              : ''}
                            {entry.title}
                          </span>
                        </div>

                        {/* Right Meta + Retry Action */}
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                            {entry.durationMs} ms
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            {formattedTime}
                          </span>

                          {entry.retryPayload && (
                            <button
                              type="button"
                              onClick={() => handleRetryActivityEntry(entry)}
                              disabled={isSendingTg || retryingEntryId === entry.id}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                                isSuccess
                                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                                  : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border-rose-500/40'
                              }`}
                              title="Diesen Medien-Versand erneut ausführen"
                            >
                              {retryingEntryId === entry.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3 h-3" />
                              )}
                              <span>{isSuccess ? 'Resend' : 'Retry'}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Summary & Target Details */}
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          {entry.summary}
                        </p>

                        {entry.errorDetails && (
                          <div className="p-2 rounded bg-rose-950/40 border border-rose-500/30 text-[11px] font-mono text-rose-200 break-words">
                            <span className="font-bold text-rose-400">API Error: </span>
                            {entry.errorDetails}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          {entry.targetChatId && (
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800">
                              Target Chat: <strong className="text-slate-200">{entry.targetChatId}</strong>
                            </span>
                          )}

                          {entry.messageId && (
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800">
                              Message ID: <strong className="text-slate-200">#{entry.messageId}</strong>
                            </span>
                          )}

                          {entry.harvestedFileId && (
                            <div className="flex items-center gap-1.5 bg-emerald-950/30 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-mono text-emerald-300">
                              <span className="truncate max-w-[220px]">
                                file_id: {entry.harvestedFileId}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyFileId(entry.id, entry.harvestedFileId!)
                                }
                                className="text-emerald-400 hover:text-emerald-200 flex items-center gap-0.5 font-sans font-semibold"
                                title="Telegram file_id kopieren"
                              >
                                {copiedFileIdKey === entry.id ? (
                                  <>
                                    <Check className="w-3 h-3" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : !response && activeTab !== 'logs' ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400">
            <Terminal className="w-8 h-8 mb-2 opacity-40" />
            <p>Send a request to inspect the Worker response</p>
          </div>
        ) : (
          <>
            {activeTab === 'body' && response && (
              <pre
                className={`whitespace-pre-wrap break-words leading-relaxed ${
                  isJson ? 'text-emerald-300' : 'text-slate-200'
                }`}
              >
                {response.body || '<empty body>'}
              </pre>
            )}

            {activeTab === 'preview' && response && (
              <div className="w-full h-full bg-white rounded overflow-hidden border border-slate-700 relative">
                {/* Floating TelegramRateHUD Overlay directly on the Mini App Preview */}
                <div className="absolute top-2.5 right-2.5 z-30 max-w-[95%]">
                  <TelegramRateHUD
                    kvNamespace={kvNamespace}
                    kvTick={kvTick}
                    targetChatId={
                      tgConfig.deliveryMode === 'group' && tgConfig.targetGroupId
                        ? tgConfig.targetGroupId
                        : tgConfig.defaultChatId || '-1001987654321'
                    }
                    deliveryMode={tgConfig.deliveryMode}
                    onOpenSplitterModal={() => setIsSplitterModalOpen(true)}
                    onQueueUpdated={refreshActivityLogs}
                  />
                </div>
                <iframe
                  title="Worker HTML Response Preview"
                  srcDoc={response.body}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            )}

            {activeTab === 'headers' && response && (
              <div className="space-y-1.5">
                {Object.entries(response.headers).map(([k, v]) => (
                  <div
                    key={k}
                    className="grid grid-cols-3 gap-2 py-1.5 px-2.5 rounded bg-[#0c111d] border border-slate-800/80"
                  >
                    <span className="text-sky-400 font-semibold truncate">{k}</span>
                    <span className="col-span-2 text-slate-300 break-all">{v}</span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'logs' && (
              <div className="space-y-1.5">
                {logs.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    No console logs emitted during execution. Check{' '}
                    <code className="text-slate-300">console.log()</code> in your worker.
                  </div>
                ) : (
                  logs.map((log) => {
                    const levelColors = {
                      log: 'text-slate-300 border-slate-800 bg-[#0c111d]',
                      info: 'text-sky-300 border-sky-900/50 bg-sky-950/20',
                      warn: 'text-amber-300 border-amber-900/50 bg-amber-950/20',
                      error: 'text-rose-300 border-rose-900/50 bg-rose-950/30',
                    };
                    return (
                      <div
                        key={log.id}
                        className={`flex items-start gap-2.5 p-2 rounded border ${
                          levelColors[log.level]
                        }`}
                      >
                        <span className="text-[10px] text-slate-400 shrink-0 select-none">
                          {(log as any).timestamp || ''}
                        </span>
                        <span className="uppercase text-[10px] font-bold px-1.5 py-0.2 rounded bg-black/30 shrink-0">
                          {log.level}
                        </span>
                        <pre className="whitespace-pre-wrap break-all flex-1">{(log as any).message || (log as any).args?.join(' ') || ''}</pre>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* >200 MB Telegram JSON Backup Stream Splitter & Batch Importer Modal */}
      <JsonBackupSplitterModal
        isOpen={isSplitterModalOpen}
        onClose={() => setIsSplitterModalOpen(false)}
        kvNamespace={kvNamespace}
        onImportBatchToWorker={onDispatchWorkerImportBatch}
      />
    </div>
  );
};
