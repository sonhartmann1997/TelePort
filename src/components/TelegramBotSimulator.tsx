import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Bot,
  Trash2,
  Film,
  Tv,
  Sparkles,
  ShieldAlert,
  FileVideo,
  Subtitles,
  Play,
  ExternalLink,
} from 'lucide-react';
import {
  ConsoleLogEntry,
  WorkerEnvVar,
  WorkerRequestData,
  WorkerResponseData,
} from '../types/worker';
import {
  executeWorkerSandbox,
  getSimulatedTelegramOutbox,
  clearSimulatedTelegramOutbox,
  subscribeSimulatedTelegramOutbox,
  SimulatedTelegramBotMessage,
  SimulatedKVNamespace,
} from '../utils/workerSandbox';
import { RequestWorkbench } from './RequestWorkbench';
import { ResponseInspector } from './ResponseInspector';

interface TelegramBotSimulatorProps {
  workerCode: string;
  envVars: WorkerEnvVar[];
  kvNamespace: SimulatedKVNamespace;
  kvTick: number;
  requestData: WorkerRequestData;
  onChangeRequestData: (data: WorkerRequestData) => void;
  response: WorkerResponseData | null;
  onUpdateResponse: (res: WorkerResponseData, logs: ConsoleLogEntry[]) => void;
  logs: ConsoleLogEntry[];
  onClearLogs: () => void;
  onDispatchWorkerStream: (payload: Record<string, unknown>) => Promise<any>;
  onDispatchWorkerImportBatch: (payload: Record<string, unknown>) => Promise<any>;
  onOpenMiniAppTab: () => void;
}

interface UserChatMessage {
  id: string;
  text: string;
  timestamp: string;
}

export const TelegramBotSimulator: React.FC<TelegramBotSimulatorProps> = ({
  workerCode,
  envVars,
  kvNamespace,
  kvTick,
  requestData,
  onChangeRequestData,
  response,
  onUpdateResponse,
  logs,
  onClearLogs,
  onDispatchWorkerStream,
  onDispatchWorkerImportBatch,
  onOpenMiniAppTab,
}) => {
  const [botMessages, setBotMessages] = useState<SimulatedTelegramBotMessage[]>(() =>
    getSimulatedTelegramOutbox()
  );
  const [userMessages, setUserMessages] = useState<UserChatMessage[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = subscribeSimulatedTelegramOutbox((msgs) => {
      setBotMessages([...msgs]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [botMessages, userMessages]);

  const buildEnvMap = useCallback(() => {
    const map: Record<string, string> = {
      ADMIN_IDS: '100998877',
      TELEGRAM_ADMIN_IDS: '100998877',
    };
    for (const v of envVars) {
      if (v.key && v.value) map[v.key] = v.value;
    }
    return map;
  }, [envVars]);

  const sendWebhookUpdate = useCallback(
    async (updatePayload: Record<string, any>, labelForUser?: string) => {
      if (!workerCode || workerCode.trim().length < 50) return;
      setIsSending(true);
      if (labelForUser) {
        setUserMessages((prev) => [
          ...prev.slice(-20),
          {
            id: `u_${Date.now()}`,
            text: labelForUser,
            timestamp: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
          },
        ]);
      }

      try {
        const webhookReq: WorkerRequestData = {
          ...requestData,
          method: 'POST',
          url: '/',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(updatePayload),
        };
        const res = await executeWorkerSandbox(
          workerCode,
          webhookReq,
          buildEnvMap(),
          kvNamespace
        );
        onUpdateResponse(res.response, res.logs);
      } finally {
        setIsSending(false);
      }
    },
    [workerCode, requestData, buildEnvMap, kvNamespace, onUpdateResponse]
  );

  // Automatically trigger /start on first open if outbox is empty
  useEffect(() => {
    if (getSimulatedTelegramOutbox().length === 0 && workerCode.length > 200) {
      sendWebhookUpdate(
        {
          update_id: Date.now(),
          message: {
            message_id: 1,
            from: { id: 100998877, is_bot: false, first_name: 'Admin', username: 'teleport_admin' },
            chat: { id: 100998877, type: 'private', first_name: 'Admin' },
            date: Math.floor(Date.now() / 1000),
            text: '/start',
          },
        },
        '/start'
      );
    }
  }, []);

  const handleSendText = (customText?: string) => {
    const txt = (customText ?? inputText).trim();
    if (!txt) return;
    if (!customText) setInputText('');

    sendWebhookUpdate(
      {
        update_id: Date.now(),
        message: {
          message_id: Math.floor(Math.random() * 90000) + 100,
          from: { id: 100998877, is_bot: false, first_name: 'Admin', username: 'teleport_admin' },
          chat: { id: 100998877, type: 'private', first_name: 'Admin' },
          date: Math.floor(Date.now() / 1000),
          text: txt,
        },
      },
      txt
    );
  };

  const handleSimulateVideoUpload = (filename: string, duration = 2700) => {
    sendWebhookUpdate(
      {
        update_id: Date.now(),
        message: {
          message_id: Math.floor(Math.random() * 90000) + 500,
          from: { id: 100998877, is_bot: false, first_name: 'Admin', username: 'teleport_admin' },
          chat: { id: 100998877, type: 'private', first_name: 'Admin' },
          date: Math.floor(Date.now() / 1000),
          caption: filename,
          video: {
            file_id: `BAACAgIAAxkB_${Date.now()}`,
            file_unique_id: `uniq_${Date.now()}`,
            file_name: filename,
            mime_type: 'video/x-matroska',
            duration,
            width: 1920,
            height: 1080,
            file_size: 1845493760,
          },
        },
      },
      `📹 Video-Upload: ${filename}`
    );
  };

  const handleSimulateSubtitleUpload = (filename: string) => {
    sendWebhookUpdate(
      {
        update_id: Date.now(),
        message: {
          message_id: Math.floor(Math.random() * 90000) + 600,
          from: { id: 100998877, is_bot: false, first_name: 'Admin', username: 'teleport_admin' },
          chat: { id: 100998877, type: 'private', first_name: 'Admin' },
          date: Math.floor(Date.now() / 1000),
          caption: filename,
          document: {
            file_id: `BQACAgIAAxkB_sub_${Date.now()}`,
            file_unique_id: `uniq_sub_${Date.now()}`,
            file_name: filename,
            mime_type: 'application/x-subrip',
            file_size: 48200,
          },
        },
      },
      `💬 Untertitel-Upload: ${filename}`
    );
  };

  const handleInlineButtonClick = (
    btn: {
      text: string;
      callback_data?: string;
      url?: string;
      web_app?: { url: string };
    },
    messageId: number
  ) => {
    if (btn.web_app) {
      onOpenMiniAppTab();
      return;
    }
    if (btn.url) {
      window.open(btn.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (btn.callback_data) {
      sendWebhookUpdate({
        update_id: Date.now(),
        callback_query: {
          id: `cbq_${Date.now()}`,
          from: { id: 100998877, is_bot: false, first_name: 'Admin', username: 'teleport_admin' },
          message: {
            message_id: messageId,
            chat: { id: 100998877, type: 'private', first_name: 'Admin' },
            date: Math.floor(Date.now() / 1000),
          },
          chat_instance: 'sim_chat_inst_1',
          data: btn.callback_data,
        },
      });
    }
  };

  const handleExecuteRawWorkbench = async () => {
    setIsSending(true);
    try {
      const res = await executeWorkerSandbox(
        workerCode,
        requestData,
        buildEnvMap(),
        kvNamespace
      );
      onUpdateResponse(res.response, res.logs);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 h-full">
      {/* Left 6 cols: Interactive Telegram Bot Messenger Simulator */}
      <div className="lg:col-span-6 h-full flex flex-col bg-[#0e1621] border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        {/* Telegram Chat Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#17212b] border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-600 to-amber-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white">
                  TelePort Movie &amp; Series Bot
                </span>
                <span className="text-[10px] text-emerald-400 font-medium">
                  bot · online
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Interaktiver Webhook-Simulator (Klicke Buttons oder sende Dateien/Befehle)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onOpenMiniAppTab}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold transition-colors"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Mini-App öffnen</span>
            </button>
            <button
              onClick={() => {
                clearSimulatedTelegramOutbox();
                setUserMessages([]);
              }}
              className="p-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors"
              title="Chat-Verlauf leeren"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Quick Command & File Ingest Bar */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-[#131c26] border-b border-slate-800/70 text-[11px]">
          <button
            onClick={() => handleSendText('/start')}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono transition-colors"
          >
            /start
          </button>
          <button
            onClick={() => handleSendText('film Action')}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            <Film className="w-3 h-3 text-red-400" />
            <span>film Action</span>
          </button>
          <button
            onClick={() => handleSendText('serie Sci-Fi')}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            <Tv className="w-3 h-3 text-sky-400" />
            <span>serie Sci-Fi</span>
          </button>
          <button
            onClick={() => handleSendText('/random')}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            <span>/random</span>
          </button>
          <button
            onClick={() => handleSendText('/stats xyz')}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 font-mono transition-colors"
          >
            <ShieldAlert className="w-3 h-3" />
            <span>/stats xyz</span>
          </button>
          <button
            onClick={() =>
              handleSimulateVideoUpload('Frontier.S01E03.1080p.WEB.H264.mkv', 2820)
            }
            className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-200 transition-colors"
            title="Simuliert eingehende Serien-Videodatei beim Videobot"
          >
            <FileVideo className="w-3 h-3" />
            <span>+ S01E03.mkv</span>
          </button>
          <button
            onClick={() => handleSimulateSubtitleUpload('Frontier.S01E03.German.srt')}
            className="flex items-center gap-1 px-2 py-1 rounded bg-teal-950/80 hover:bg-teal-900 border border-teal-700/50 text-teal-200 transition-colors"
            title="Simuliert eingehende .srt Untertitel-Datei zur zuletzt gesendeten Folge"
          >
            <Subtitles className="w-3 h-3" />
            <span>+ .srt Untertitel</span>
          </button>
        </div>

        {/* Telegram Messages Stream */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {userMessages.length > 0 && (
            <div className="flex justify-end">
              <div className="max-w-[80%] bg-[#2b5278] text-white px-3 py-1.5 rounded-xl rounded-br-xs text-xs shadow-sm">
                <span>{userMessages[userMessages.length - 1].text}</span>
                <span className="ml-2 text-[10px] text-sky-200/70">
                  {userMessages[userMessages.length - 1].timestamp}
                </span>
              </div>
            </div>
          )}

          {botMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 p-6">
              <Bot className="w-10 h-10 text-slate-600 mb-2" />
              <p className="text-xs font-medium text-slate-300">
                Noch keine Bot-Antwort im Verlauf
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Klicke oben auf <code>/start</code>, <code>/random</code> oder gib unten einen Filmtitel wie <em>Interstellar</em> ein.
              </p>
            </div>
          ) : (
            botMessages.map((msg) => (
              <div key={msg.id} className="flex flex-col items-start max-w-[92%]">
                <div className="w-full bg-[#182533] border border-slate-800/90 text-slate-100 rounded-xl rounded-bl-xs overflow-hidden shadow-md">
                  {msg.photoUrl && (
                    <div className="relative bg-black/40 max-h-56 overflow-hidden flex justify-center">
                      <img
                        src={msg.photoUrl}
                        alt="Poster"
                        className="object-contain max-h-56 w-auto"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                  <div className="p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">
                    <div
                      dangerouslySetInnerHTML={{
                        __html: msg.text
                          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                          .replace(/\n/g, '<br/>'),
                      }}
                    />
                    <div className="mt-1.5 flex items-center justify-end gap-2 text-[10px] text-slate-400">
                      <span>{msg.method}</span>
                      <span>·</span>
                      <span>{msg.timestamp}</span>
                    </div>
                  </div>
                </div>

                {/* Inline Keyboard Grid */}
                {msg.replyMarkup?.inline_keyboard && (
                  <div className="w-full mt-1.5 flex flex-col gap-1">
                    {msg.replyMarkup.inline_keyboard.map((row, rIdx) => (
                      <div key={rIdx} className="grid grid-flow-col auto-cols-fr gap-1">
                        {row.map((btn, bIdx) => (
                          <button
                            key={bIdx}
                            onClick={() => handleInlineButtonClick(btn, msg.id)}
                            disabled={isSending}
                            className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#202b36]/95 hover:bg-[#2b3947] active:scale-[0.99] border border-slate-700/60 text-slate-100 text-[11px] font-medium transition-all truncate shadow-xs"
                            title={btn.callback_data || btn.url || btn.web_app?.url}
                          >
                            <span className="truncate">{btn.text}</span>
                            {(btn.url || btn.web_app) && (
                              <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
                            )}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Telegram Chat Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendText();
          }}
          className="flex items-center gap-2 p-2.5 bg-[#17212b] border-t border-slate-800"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Film/Serie suchen oder Befehl senden (z.B. Interstellar, /start, /stats xyz)…"
            className="flex-1 bg-[#0e1621] border border-slate-800 focus:border-sky-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 outline-none"
          />
          <button
            type="submit"
            disabled={isSending || !inputText.trim()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Senden</span>
          </button>
        </form>
      </div>

      {/* Right 6 cols: Request Workbench & Response Inspector (inkl. JSON Splitter & Telegram Rate HUD) */}
      <div className="lg:col-span-6 h-full flex flex-col gap-3.5 overflow-hidden">
        <div className="shrink-0">
          <RequestWorkbench
            requestData={requestData}
            onChange={onChangeRequestData}
            onExecute={handleExecuteRawWorkbench}
            isExecuting={isSending}
          />
        </div>
        <div className="flex-1 min-h-0">
          <ResponseInspector
            response={response}
            logs={logs}
            onClearLogs={onClearLogs}
            isExecuting={isSending}
            onDispatchWorkerStream={onDispatchWorkerStream}
            onDispatchWorkerImportBatch={onDispatchWorkerImportBatch}
            kvNamespace={kvNamespace}
            kvTick={kvTick}
          />
        </div>
      </div>
    </div>
  );
};

export default TelegramBotSimulator;
