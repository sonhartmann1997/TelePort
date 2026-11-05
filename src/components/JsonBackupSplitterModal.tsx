import React, { useState, useRef } from 'react';
import {
  X,
  Scissors,
  Upload,
  Download,
  Play,
  CheckCircle2,
  Loader2,
  BookOpen,
  Terminal,
  Copy,
  Check,
  Sparkles,
  HardDrive,
} from 'lucide-react';
import {
  StreamSplitProgress,
  StreamSplitResult,
  BackupSplitChunk,
  streamSplitTelegramJsonFile,
  generateSimulated200MbSplitResult,
} from '../utils/jsonBackupSplitter';
import {
  DEFAULT_BATCH_CHUNK_SIZE,
  createJsonBatchChunkObject,
} from '../utils/jsonStreamSplitter';
import { SimulatedKVNamespace } from '../utils/workerSandbox';
import {
  appendTelegramActivityLog,
  loadTelegramIntegrationConfig,
  parseTelegramChannelOrLinkClient,
  validateTelegramChannelClient,
  TelegramChannelValidationResult,
} from '../utils/telegramIntegration';
import {
  OmdbConfig,
  loadOmdbConfig,
  saveOmdbConfig,
  verifyOmdbApiKey,
  enrichBatchEntriesWithOmdbFallback,
} from '../utils/omdbClient';

interface JsonBackupSplitterModalProps {
  isOpen: boolean;
  onClose: () => void;
  kvNamespace?: SimulatedKVNamespace;
  onImportBatchToWorker?: (payload: {
    entries: Array<{
      filename: string;
      rawInput: string;
      telegram_file_id: string | null;
      file_size: number | null;
      mime_type: string;
      chat_id?: string;
      external_poster_url?: string;
      overview?: string;
      imdb_id?: string;
    }>;
    playlistName: string;
    sourceChannelId?: string;
    chunkIndex: number;
    totalChunks: number;
  }) => Promise<any>;
}

const CHUNK_SIZE_OPTIONS = [50, 100, DEFAULT_BATCH_CHUNK_SIZE, 500, 1000];
const SPLITTER_CHECKPOINT_STORAGE_KEY = 'tma_splitter_import_checkpoint_v1';

interface SplitterImportCheckpoint {
  sourceFileName: string;
  sourceFileSizeBytes: number;
  playlistName: string;
  verifiedChannelId: string;
  completedChunkIndices: number[];
  lastChunkIndex: number;
  totalChunks: number;
  updatedAt: string;
}

export const JsonBackupSplitterModal: React.FC<JsonBackupSplitterModalProps> = ({
  isOpen,
  onClose,
  kvNamespace,
  onImportBatchToWorker,
}) => {
  const [activeTab, setActiveTab] = useState<'splitter' | 'howto'>('splitter');
  const [chunkSize, setChunkSize] = useState<number>(DEFAULT_BATCH_CHUNK_SIZE);
  const [playlistName, setPlaylistName] = useState<string>('Cinema & Serien HD Archiv');
  const [isStreamingFile, setIsStreamingFile] = useState<boolean>(false);
  const [progress, setProgress] = useState<StreamSplitProgress | null>(null);
  const [splitResult, setSplitResult] = useState<StreamSplitResult | null>(() =>
    generateSimulated200MbSplitResult(DEFAULT_BATCH_CHUNK_SIZE)
  );
  const [isBatchImportingAll, setIsBatchImportingAll] = useState<boolean>(false);
  const [importingChunkIdx, setImportingChunkIdx] = useState<number | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  const [omdbConfig, setOmdbConfig] = useState<OmdbConfig>(() => loadOmdbConfig());
  const [omdbTestStatus, setOmdbTestStatus] = useState<string | null>(null);
  const [isTestingOmdbKey, setIsTestingOmdbKey] = useState<boolean>(false);

  const [sourceChannelInput, setSourceChannelInput] = useState<string>(() => {
    const cfg = loadTelegramIntegrationConfig(kvNamespace);
    return cfg.sourceGroupId || '-1001987654321';
  });
  const [channelValidation, setChannelValidation] =
    useState<TelegramChannelValidationResult | null>(null);
  const [isValidatingChannel, setIsValidatingChannel] = useState<boolean>(false);

  const [savedCheckpoint, setSavedCheckpoint] = useState<SplitterImportCheckpoint | null>(() => {
    try {
      const raw = localStorage.getItem(SPLITTER_CHECKPOINT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortBatchRef = useRef<boolean>(false);

  if (!isOpen) return null;

  const parsedChannelInfo = parseTelegramChannelOrLinkClient(sourceChannelInput);
  const isChannelVerifiedReady = Boolean(
    channelValidation?.readable && channelValidation?.channelId?.startsWith('-100')
  );

  const persistCheckpoint = (nextCp: SplitterImportCheckpoint | null) => {
    setSavedCheckpoint(nextCp);
    try {
      if (nextCp) {
        localStorage.setItem(SPLITTER_CHECKPOINT_STORAGE_KEY, JSON.stringify(nextCp));
      } else {
        localStorage.removeItem(SPLITTER_CHECKPOINT_STORAGE_KEY);
      }
    } catch {
      // ignore storage quota errors
    }
  };

  const handleValidateSourceChannel = async (): Promise<TelegramChannelValidationResult> => {
    setIsValidatingChannel(true);
    try {
      const sampleMsgId =
        parsedChannelInfo.sampleMessageId ||
        splitResult?.chunks?.[0]?.entries?.[0]?.messageId ||
        null;
      const res = await validateTelegramChannelClient(
        sourceChannelInput,
        sampleMsgId,
        undefined,
        kvNamespace
      );
      setChannelValidation(res);
      if (res.channelId && sourceChannelInput !== res.channelId && !sourceChannelInput.includes('t.me/')) {
        setSourceChannelInput(res.channelId);
      }
      return res;
    } finally {
      setIsValidatingChannel(false);
    }
  };

  const handleToggleOmdbFallback = (enabled: boolean) => {
    const next = saveOmdbConfig({ enabled });
    setOmdbConfig(next);
  };

  const handleOmdbApiKeyChange = (apiKey: string) => {
    const next = saveOmdbConfig({ apiKey });
    setOmdbConfig(next);
  };

  const handleTestOmdbApiKey = async () => {
    setIsTestingOmdbKey(true);
    setOmdbTestStatus(null);
    try {
      const res = await verifyOmdbApiKey(omdbConfig.apiKey);
      setOmdbTestStatus(res.ok ? `✅ ${res.message}` : `⚠️ ${res.message}`);
    } finally {
      setIsTestingOmdbKey(false);
    }
  };

  const handleChunkSizeChange = (nextSize: number) => {
    setChunkSize(nextSize);
    if (
      splitResult &&
      splitResult.sourceFileName === 'result_telegram_archive_248MB.json'
    ) {
      setSplitResult(generateSimulated200MbSplitResult(nextSize));
    }
  };

  const handleSelectFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isChannelVerifiedReady) {
      const checkRes = await handleValidateSourceChannel();
      if (!checkRes.readable || !checkRes.channelId) {
        e.target.value = '';
        return;
      }
    }
    setIsStreamingFile(true);
    setProgress({
      bytesRead: 0,
      totalBytes: file.size,
      percent: 0,
      rawObjectsScanned: 0,
      videoEntriesMatched: 0,
      skippedNonVideo: 0,
      chunksCreated: 0,
    });
    try {
      const res = await streamSplitTelegramJsonFile(file, chunkSize, (p) => {
        setProgress(p);
      });
      // Falls ein passender Checkpoint für diese Datei existiert, erledigte Chunks automatisch markieren
      if (
        savedCheckpoint &&
        savedCheckpoint.sourceFileName === res.sourceFileName &&
        savedCheckpoint.completedChunkIndices.length > 0
      ) {
        res.chunks = res.chunks.map((c) =>
          savedCheckpoint.completedChunkIndices.includes(c.chunkIndex)
            ? {
                ...c,
                importedStatus: 'done',
                importedSummary: `Bereits via Checkpoint importiert [Kanal ${savedCheckpoint.verifiedChannelId}]`,
              }
            : c
        );
      }
      setSplitResult(res);
      if (res.chatName) {
        setPlaylistName(res.chatName.slice(0, 48));
      }
    } finally {
      setIsStreamingFile(false);
    }
  };

  const handleLoadDemo200Mb = async () => {
    if (!isChannelVerifiedReady) {
      const checkRes = await handleValidateSourceChannel();
      if (!checkRes.readable || !checkRes.channelId) return;
    }
    const demo = generateSimulated200MbSplitResult(chunkSize);
    setSplitResult(demo);
    setPlaylistName(demo.chatName);
  };

  const handleDownloadChunkJson = (chunk: BackupSplitChunk) => {
    const baseCleanName = (splitResult?.sourceFileName || 'backup').replace(/\.json$/i, '');
    const batchObj = createJsonBatchChunkObject(
      chunk.entries,
      chunk.chunkIndex,
      chunk.totalChunks,
      chunkSize,
      baseCleanName,
      playlistName
    );
    const payload = {
      name: `${playlistName} (Part ${batchObj.chunkIndex}/${batchObj.totalChunks})`,
      type: 'public_supergroup',
      partIndex: batchObj.chunkIndex,
      totalParts: batchObj.totalChunks,
      messages: batchObj.messages,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = chunk.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAllMergedCleanedJson = () => {
    if (!splitResult) return;
    const allEntries = splitResult.chunks.flatMap((c) => c.entries);
    const payload = {
      name: playlistName,
      sourceFile: splitResult.sourceFileName,
      videoEntriesCount: allEntries.length,
      messages: allEntries.map((item) => ({
        id: item.messageId || item.index,
        type: 'message',
        file_name: item.filename,
        media_type: 'video_file',
        mime_type: item.mime_type,
        file_size: item.file_size,
        telegram_file_id: item.telegram_file_id,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${splitResult.sourceFileName.replace(/\.json$/i, '')}_videos_only.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportSingleChunk = async (chunk: BackupSplitChunk): Promise<boolean> => {
    if (!splitResult) return false;

    // Mandatory pre-import channel readability validation
    let activeValidation = channelValidation;
    if (!activeValidation || !activeValidation.readable || !activeValidation.channelId) {
      activeValidation = await handleValidateSourceChannel();
      if (!activeValidation.readable || !activeValidation.channelId) {
        setSplitResult((prev) =>
          prev
            ? {
                ...prev,
                chunks: prev.chunks.map((c) =>
                  c.chunkIndex === chunk.chunkIndex
                    ? {
                        ...c,
                        importedStatus: 'error',
                        importedSummary:
                          activeValidation?.diagnosticSummary ||
                          'Quell-Kanal-ID fehlt oder nicht lesbar',
                      }
                    : c
                ),
              }
            : null
        );
        return false;
      }
    }

    const verifiedChannelId = activeValidation.channelId;
    setImportingChunkIdx(chunk.chunkIndex);

    setSplitResult((prev) =>
      prev
        ? {
            ...prev,
            chunks: prev.chunks.map((c) =>
              c.chunkIndex === chunk.chunkIndex
                ? { ...c, importedStatus: 'importing' }
                : c
            ),
          }
        : null
    );

    const startMs = Date.now();
    try {
      const rawBatchEntries = chunk.entries.slice(0, 20).map((e) => {
        const msgId = e.messageId || e.index || undefined;
        const boundTgFileId =
          e.telegram_file_id && String(e.telegram_file_id).startsWith('tg_export_0_') && msgId
            ? `tg_export_${verifiedChannelId}_${msgId}`
            : e.telegram_file_id || (msgId ? `tg_export_${verifiedChannelId}_${msgId}` : null);
        return {
          filename: e.filename,
          rawInput: e.rawInput,
          telegram_file_id: boundTgFileId,
          chat_id: verifiedChannelId,
          file_size: e.file_size,
          mime_type: e.mime_type,
          msg_id: msgId,
          message_id: msgId,
        };
      });

      const { entries: batchEntries, enrichedCount: omdbEnrichedCount } =
        await enrichBatchEntriesWithOmdbFallback(rawBatchEntries, {
          apiKey: omdbConfig.apiKey,
          maxLookups: 8,
        });

      if (onImportBatchToWorker) {
        await onImportBatchToWorker({
          entries: batchEntries,
          playlistName,
          sourceChannelId: verifiedChannelId,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
        });
      } else {
        await new Promise((r) => setTimeout(r, 320));
      }

      const omdbNote =
        omdbEnrichedCount > 0 ? ` · ${omdbEnrichedCount} High-Res OMDb Posters` : '';
      const summary = `Imported ${chunk.entries.length} entries (${chunk.moviesCount} movies · ${chunk.seriesCount} series${omdbNote}) [Channel ${verifiedChannelId}] into D1`;

      appendTelegramActivityLog(
        {
          eventType: 'delivery',
          status: 'success',
          deliveryMode: 'system',
          method: `importBatch (Chunk ${chunk.chunkIndex}/${chunk.totalChunks})`,
          title: `${chunk.fileName} (${chunk.entries.length} Videos)`,
          mediaType: 'movie',
          targetChatId: playlistName,
          durationMs: Date.now() - startMs,
          summary,
        },
        kvNamespace
      );

      setSplitResult((prev) => {
        if (!prev) return null;
        const updatedChunks = prev.chunks.map((c) =>
          c.chunkIndex === chunk.chunkIndex
            ? { ...c, importedStatus: 'done' as const, importedSummary: summary }
            : c
        );
        const completedIndices = updatedChunks
          .filter((c) => c.importedStatus === 'done')
          .map((c) => c.chunkIndex);
        if (completedIndices.length >= prev.chunks.length) {
          persistCheckpoint(null);
        } else {
          persistCheckpoint({
            sourceFileName: prev.sourceFileName,
            sourceFileSizeBytes: prev.sourceFileSizeBytes,
            playlistName,
            verifiedChannelId,
            completedChunkIndices: completedIndices,
            lastChunkIndex: chunk.chunkIndex,
            totalChunks: prev.chunks.length,
            updatedAt: new Date().toISOString(),
          });
        }
        return {
          ...prev,
          chunks: updatedChunks,
        };
      });
      return true;
    } catch (err: any) {
      setSplitResult((prev) =>
        prev
          ? {
              ...prev,
              chunks: prev.chunks.map((c) =>
                c.chunkIndex === chunk.chunkIndex
                  ? {
                      ...c,
                      importedStatus: 'error',
                      importedSummary: err?.message || 'Batch import failed',
                    }
                  : c
              ),
            }
          : null
      );
      return false;
    } finally {
      setImportingChunkIdx(null);
    }
  };

  const handleImportAllChunksSequentially = async () => {
    if (!splitResult || isBatchImportingAll) return;
    setIsBatchImportingAll(true);
    abortBatchRef.current = false;

    try {
      for (const chunk of splitResult.chunks) {
        if (abortBatchRef.current) break;
        if (chunk.importedStatus === 'done') continue;
        const ok = await handleImportSingleChunk(chunk);
        if (!ok) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      setIsBatchImportingAll(false);
    }
  };

  const handleRestartAllFromZeroNoDuplicates = async () => {
    if (!splitResult || isBatchImportingAll) return;
    persistCheckpoint(null);
    setSplitResult((prev) =>
      prev
        ? {
            ...prev,
            chunks: prev.chunks.map((c) => ({
              ...c,
              importedStatus: undefined,
              importedSummary: undefined,
            })),
          }
        : null
    );
    setTimeout(() => {
      handleImportAllChunksSequentially();
    }, 60);
  };

  const handleCopyCode = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(key);
    setTimeout(() => setCopiedSnippet(null), 1800);
  };

  const pythonScriptSnippet = `import json, re, os, sys

# Usage: python3 split_telegram_backup.py result.json 250
input_path = sys.argv[1] if len(sys.argv) > 1 else "result.json"
chunk_size = int(sys.argv[2]) if len(sys.argv) > 2 else 250

with open(input_path, "r", encoding="utf-8", errors="replace") as f:
    data = json.load(f)

messages = data.get("messages", data if isinstance(data, list) else [])
video_msgs = [
    m for m in messages
    if isinstance(m, dict) and (
        m.get("media_type") == "video_file"
        or str(m.get("mime_type", "")).startswith("video/")
        or re.search(r"\\.(mp4|mkv|avi|mov|webm)$", str(m.get("file_name", "")), re.I)
    )
]

for idx in range(0, len(video_msgs), chunk_size):
    part_num = (idx // chunk_size) + 1
    out_name = f"result_part_{part_num:03d}.json"
    with open(out_name, "w", encoding="utf-8") as out:
        json.dump({"name": data.get("name", "Backup"), "messages": video_msgs[idx:idx+chunk_size]}, out, ensure_ascii=False, indent=2)
    print(f"Saved {out_name} ({len(video_msgs[idx:idx+chunk_size])} videos)")`;

  const jqCommandSnippet = `jq '{name: .name, messages: [.messages[] | select(.media_type == "video_file" or (.file_name // "" | test("\\\\.(mp4|mkv|avi)$"; "i")))]}' result.json > result_videos_only.json`;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 font-sans tabular-nums">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#0d1320] border border-slate-700/80 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 bg-[#111827] border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <Scissors className="w-4 h-4 text-sky-400 shrink-0" />
            <h2 className="text-sm font-bold text-slate-100 truncate">
              &gt;200 MB Telegram JSON Backup Stream Splitter &amp; Batch Importer
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 p-0.5 bg-slate-900 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setActiveTab('splitter')}
                className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activeTab === 'splitter'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Stream Splitter &amp; Batch Import
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('howto')}
                className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activeTab === 'howto'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>How-To &amp; CLI Tools</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'splitter' ? (
            <>
              {/* SCHRITT 1 (PFLICHT): Quell-Kanal / Gruppen-ID oder Beispiel-Link vor jedem JSON-Upload */}
              <div
                className={`p-3.5 rounded-lg bg-[#0a0f1a] border space-y-2 ${
                  isChannelVerifiedReady ? 'border-emerald-500/45' : 'border-rose-500/45'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-sky-300">
                      📡 1. PFLICHT-SCHRITT: Quell-Kanal / Gruppen-ID oder Beispiel-Link prüfen
                    </span>
                    <p className="text-[11px] text-slate-400">
                      Ohne verifizierte <code className="text-sky-300">-100...</code> Kanal-ID ist der JSON-Upload gesperrt (verhindert kaputte <code className="text-rose-300">tg_export_0_...</code> Buttons).
                    </p>
                  </div>

                  {parsedChannelInfo.channelId && (
                    <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-[11px] font-mono text-sky-300">
                      Erkannt: {parsedChannelInfo.channelId}
                      {parsedChannelInfo.sampleMessageId
                        ? ` · Msg #${parsedChannelInfo.sampleMessageId}`
                        : ''}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={sourceChannelInput}
                    onChange={(e) => {
                      setSourceChannelInput(e.target.value);
                      setChannelValidation(null);
                    }}
                    placeholder="-1001234567890 oder https://t.me/c/1234567890/55"
                    className="flex-1 min-w-[240px] px-2.5 py-1.5 rounded bg-[#111827] border border-slate-700 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-400"
                  />
                  <button
                    type="button"
                    onClick={handleValidateSourceChannel}
                    disabled={isValidatingChannel || !sourceChannelInput.trim()}
                    className="px-3 py-1.5 rounded bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 text-xs font-bold whitespace-nowrap transition-colors"
                  >
                    {isValidatingChannel
                      ? 'Prüfe Kanal...'
                      : '🔍 Kanal prüfen & Upload freischalten'}
                  </button>
                </div>

                {channelValidation ? (
                  <div
                    className={`p-2 rounded border text-[11px] font-medium ${
                      channelValidation.readable
                        ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-950/35 border-rose-500/40 text-rose-300'
                    }`}
                  >
                    {channelValidation.diagnosticSummary}
                  </div>
                ) : (
                  <div className="p-2 rounded border border-amber-500/30 bg-amber-950/25 text-[11px] text-amber-300">
                    🔒 Bitte zuerst auf „🔍 Kanal prüfen &amp; Upload freischalten“ klicken, bevor du eine .json Datei auswählst oder importierst.
                  </div>
                )}
              </div>

              {/* Gespeicherter Fortschritts-Checkpoint Banner */}
              {savedCheckpoint && (
                <div className="p-3.5 rounded-lg bg-amber-950/25 border border-amber-500/40 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-amber-300">
                      📌 Gespeicherter JSON-Import-Checkpoint erkannt ({savedCheckpoint.sourceFileName})
                    </div>
                    <div className="text-[11px] text-slate-300">
                      Stand: Chunk <strong>#{savedCheckpoint.lastChunkIndex}</strong> von{' '}
                      <strong>{savedCheckpoint.totalChunks}</strong> ({savedCheckpoint.completedChunkIndices.length}{' '}
                      Chunks erledigt) · Kanal <code className="text-emerald-300">{savedCheckpoint.verifiedChannelId}</code>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleImportAllChunksSequentially}
                      disabled={isBatchImportingAll}
                      className="px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs"
                    >
                      ▶️ Fortsetzen ab Chunk #{savedCheckpoint.lastChunkIndex + 1}
                    </button>
                    <button
                      type="button"
                      onClick={handleRestartAllFromZeroNoDuplicates}
                      disabled={isBatchImportingAll}
                      className="px-3 py-1.5 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-300 font-semibold text-xs"
                    >
                      🔄 Neu starten ab 0 (ohne Duplikate)
                    </button>
                    <button
                      type="button"
                      onClick={() => persistCheckpoint(null)}
                      className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs"
                    >
                      ✖ Verwerfen
                    </button>
                  </div>
                </div>
              )}

              {/* Controls & File Upload Strip */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 rounded-lg bg-[#0a0f1a] border border-slate-800">
                <div className="md:col-span-5 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-200">
                    2. Select Large Telegram Backup (result.json)
                  </label>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Reads 200 MB – 2 GB+ files in 2 MB binary stream slices without loading the full file into memory.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      onChange={handleSelectFile}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!isChannelVerifiedReady) {
                          handleValidateSourceChannel();
                          return;
                        }
                        fileInputRef.current?.click();
                      }}
                      disabled={isStreamingFile || !isChannelVerifiedReady}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-bold text-xs whitespace-nowrap shrink-0 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {isChannelVerifiedReady
                          ? 'Choose .json File (200MB+)'
                          : '🔒 Erst Kanal prüfen'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleLoadDemo200Mb}
                      disabled={isStreamingFile}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>Load 248 MB Demo</span>
                    </button>
                  </div>
                </div>

                <div className="md:col-span-4 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-200">
                    3. Partition Size (Video Entries / Chunk)
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Default 250 video entries per batch (~60 KB clean JSON).
                  </p>
                  <div className="flex items-center gap-1.5 pt-1">
                    {CHUNK_SIZE_OPTIONS.map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => handleChunkSizeChange(size)}
                        className={`px-2.5 py-1 rounded text-xs font-mono font-semibold border whitespace-nowrap shrink-0 transition-colors ${
                          chunkSize === size
                            ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                            : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-3 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-200">
                    4. Target D1 Playlist Name
                  </label>
                  <input
                    type="text"
                    value={playlistName}
                    onChange={(e) => setPlaylistName(e.target.value)}
                    placeholder="Custom Playlist Name"
                    className="w-full px-2.5 py-1.5 rounded bg-[#111827] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                  <div className="text-[10px] text-slate-500">
                    Auto-creates playlist in D1 &amp; KV
                  </div>
                </div>
              </div>

              {/* Admin OMDb High-Res Poster & Metadata Fallback Toggle */}
              <div className="p-3.5 rounded-lg bg-[#0a0f1a] border border-amber-500/30 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1 min-w-[220px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-amber-300">
                      🖼️ Admin OMDb High-Res Fallback (Import Service Chain)
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleOmdbFallback(!omdbConfig.enabled)}
                      className={`px-2.5 py-0.5 rounded text-[11px] font-bold border transition-colors ${
                        omdbConfig.enabled
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {omdbConfig.enabled ? 'ACTIVE (ON)' : 'DISABLED (OFF)'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Fetches missing metadata &amp; upgrades Amazon/IMDb posters to high-res{' '}
                    <code className="text-amber-300">_V1_SX1000.jpg</code> when TMDb has no cover.
                  </p>
                  {omdbTestStatus && (
                    <div className="text-[11px] font-medium text-sky-300 pt-0.5">
                      {omdbTestStatus}
                    </div>
                  )}
                </div>

                {omdbConfig.enabled && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      value={omdbConfig.apiKey}
                      onChange={(e) => handleOmdbApiKeyChange(e.target.value)}
                      placeholder="OMDb API Key (optional, default fallback active)"
                      className="w-64 px-2.5 py-1.5 rounded bg-[#111827] border border-slate-700 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-400"
                    />
                    <button
                      type="button"
                      onClick={handleTestOmdbApiKey}
                      disabled={isTestingOmdbKey}
                      className="px-2.5 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold whitespace-nowrap transition-colors"
                    >
                      {isTestingOmdbKey ? 'Testing...' : 'Verify Key'}
                    </button>
                  </div>
                )}
              </div>

              {/* Active Stream Slicing Progress */}
              {isStreamingFile && progress && (
                <div className="p-3.5 rounded-lg bg-[#0a101d] border border-sky-500/40 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-sky-300 font-semibold flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Streaming 2 MB binary slices ({progress.percent}%)
                    </span>
                    <span className="font-mono text-slate-300">
                      {(progress.bytesRead / (1024 * 1024)).toFixed(1)} /{' '}
                      {(progress.totalBytes / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-sky-500 transition-all duration-150"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Scanned: {progress.rawObjectsScanned.toLocaleString()} msgs · Videos matched:{' '}
                    {progress.videoEntriesMatched.toLocaleString()} · Chunks:{' '}
                    {progress.chunksCreated}
                  </div>
                </div>
              )}

              {/* Split Summary & Batch Actions */}
              {splitResult && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-lg bg-[#0a0f1a] border border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                        <HardDrive className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{splitResult.sourceFileName}</span>
                        <span className="text-slate-500" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono text-emerald-300">
                          {(splitResult.sourceFileSizeBytes / (1024 * 1024)).toFixed(1)} MB Source
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        <span>
                          Raw Messages: {splitResult.rawObjectsScanned.toLocaleString()}
                        </span>
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-200 font-medium">
                          Clean Videos: {splitResult.videoEntriesMatched.toLocaleString()}
                        </span>
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-emerald-400">
                          Movies: {splitResult.moviesCount.toLocaleString()}
                        </span>
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-sky-400">
                          Series: {splitResult.seriesCount.toLocaleString()}
                        </span>
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span>
                          Non-video text stripped: {splitResult.skippedNonVideo.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDownloadAllMergedCleanedJson}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5 text-sky-400" />
                        <span>Download Cleaned JSON</span>
                      </button>

                      {isBatchImportingAll ? (
                        <button
                          type="button"
                          onClick={() => {
                            abortBatchRef.current = true;
                          }}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs whitespace-nowrap shrink-0 transition-colors"
                        >
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>⏸️ Pause (Checkpoint speichern)</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleImportAllChunksSequentially}
                          disabled={!isChannelVerifiedReady}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold text-xs whitespace-nowrap shrink-0 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>
                            {isChannelVerifiedReady
                              ? `Sequential Batch Import (${splitResult.chunks.filter((c) => c.importedStatus !== 'done').length}/${splitResult.chunks.length} offen)`
                              : '🔒 Erst Kanal prüfen'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Partitioned Chunks Table */}
                  <div className="border border-slate-800 rounded-lg overflow-hidden bg-[#0a0f1a]">
                    <div className="grid grid-cols-12 gap-2 px-3.5 py-2 bg-[#111827] border-b border-slate-800 text-[11px] font-semibold text-slate-400">
                      <div className="col-span-4">Split Chunk File</div>
                      <div className="col-span-3">Content Breakdown</div>
                      <div className="col-span-2">Est. Payload</div>
                      <div className="col-span-3 text-right">Actions</div>
                    </div>

                    <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
                      {splitResult.chunks.map((chunk) => (
                        <div
                          key={chunk.chunkIndex}
                          className="grid grid-cols-12 gap-2 items-center px-3.5 py-2.5 text-xs hover:bg-slate-900/60 transition-colors"
                        >
                          <div className="col-span-4 min-w-0">
                            <div className="font-mono font-semibold text-slate-200 truncate">
                              {chunk.fileName}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Part {chunk.chunkIndex} of {chunk.totalChunks} ({chunk.entries.length}{' '}
                              entries)
                            </div>
                          </div>

                          <div className="col-span-3 text-[11px] text-slate-300">
                            <span>{chunk.moviesCount} Movies</span>
                            <span className="mx-1.5 text-slate-600" aria-hidden="true">
                              ·
                            </span>
                            <span>{chunk.seriesCount} Series</span>
                          </div>

                          <div className="col-span-2 font-mono text-[11px] text-slate-400">
                            ~{Math.max(1, Math.round(chunk.estimatedJsonBytes / 1024))} KB
                          </div>

                          <div className="col-span-3 flex items-center justify-end gap-1.5">
                            {chunk.importedStatus === 'done' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 px-2 py-0.5">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Imported</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleImportSingleChunk(chunk)}
                                disabled={
                                  !isChannelVerifiedReady ||
                                  importingChunkIdx === chunk.chunkIndex ||
                                  isBatchImportingAll
                                }
                                className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-40 text-emerald-300 border border-emerald-500/35 text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors"
                              >
                                {importingChunkIdx === chunk.chunkIndex ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Play className="w-3 h-3" />
                                )}
                                <span>{isChannelVerifiedReady ? 'Import Batch' : '🔒 Kanal'}</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDownloadChunkJson(chunk)}
                              className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors"
                              title={`Download ${chunk.fileName}`}
                            >
                              <Download className="w-3 h-3 text-sky-400" />
                              <span>.json</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* How-To & CLI Tools Tab */
            <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
              <div className="p-4 rounded-lg bg-[#0a0f1a] border border-slate-800 space-y-2">
                <h3 className="text-sm font-bold text-slate-100">
                  01. Why Backups Over 200 MB Need Stream Splitting
                </h3>
                <p className="text-slate-400">
                  Telegram Desktop chat exports (<code className="text-slate-200">result.json</code>)
                  from large movie and series channels often reach 200 MB to 1.5 GB because they
                  include ratusan thousand text messages, reactions, and service events alongside
                  video captions. Uploading a 200 MB+ file in a single HTTP request hits Cloudflare
                  Workers’ 100 MB request body limit and 128 MB isolate RAM limit.
                </p>
                <p className="text-slate-300">
                  <strong>How the Built-in Stream Splitter Solves This:</strong> Instead of calling{' '}
                  <code className="text-sky-300">file.text()</code> on the entire file, the splitter
                  reads 2 MB binary slices via <code className="text-sky-300">File.slice()</code>,
                  discards non-video chatter (&gt;90% size reduction), and packages only clean video
                  entries into 250-item chunks (~60 KB each) that import sequentially into D1.
                </p>
              </div>

              <div className="p-4 rounded-lg bg-[#0a0f1a] border border-slate-800 space-y-2">
                <h3 className="text-sm font-bold text-slate-100">
                  02. Exporting Only Metadata in Telegram Desktop (Fastest Export)
                </h3>
                <ol className="list-decimal list-inside space-y-1 text-slate-400">
                  <li>
                    Open the movie/series group or channel in <strong>Telegram Desktop</strong>.
                  </li>
                  <li>
                    Click the three dots <strong>⋮ → Export chat history</strong>.
                  </li>
                  <li>
                    <strong>Uncheck all media checkboxes</strong> (Photos, Videos, Voice messages,
                    Stickers) so Telegram does not download gigabytes of video files to your disk.
                  </li>
                  <li>
                    Select <strong>Format: Machine-readable JSON</strong> and start the export.
                  </li>
                  <li>
                    Drop the resulting <code className="text-slate-200">result.json</code> into the{' '}
                    <strong>Stream Splitter &amp; Batch Import</strong> tab above.
                  </li>
                </ol>
              </div>

              {/* Python 3 CLI Splitter */}
              <div className="p-4 rounded-lg bg-[#0a0f1a] border border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-bold text-slate-100">
                      03. Optional Local Python 3 Splitter Script (split_telegram_backup.py)
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyCode('python', pythonScriptSnippet)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium whitespace-nowrap shrink-0"
                  >
                    {copiedSnippet === 'python' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Script</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 rounded bg-[#060911] border border-slate-800 font-mono text-[11px] text-emerald-300 overflow-x-auto">
                  {pythonScriptSnippet}
                </pre>
              </div>

              {/* jq One-Liner */}
              <div className="p-4 rounded-lg bg-[#0a0f1a] border border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-sky-400" />
                    <h3 className="text-sm font-bold text-slate-100">
                      04. Optional jq One-Liner (Strip Non-Video Messages Instantly)
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyCode('jq', jqCommandSnippet)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium whitespace-nowrap shrink-0"
                  >
                    {copiedSnippet === 'jq' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Command</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 rounded bg-[#060911] border border-slate-800 font-mono text-[11px] text-sky-300 overflow-x-auto">
                  {jqCommandSnippet}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
