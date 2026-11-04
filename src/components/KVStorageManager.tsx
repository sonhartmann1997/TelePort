import React, { useState, useEffect, useMemo } from 'react';
import {
  Database,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  Search,
  Clock,
  Key,
  Bot,
  ShieldCheck,
  Eye,
  EyeOff,
  Link2,
  Copy,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
  Users,
  MessageSquare,
} from 'lucide-react';
import { SimulatedKVNamespace } from '../utils/workerSandbox';
import {
  TelegramBotConfig,
  DeliveryMode,
  KV_TELEGRAM_KEYS,
  loadTelegramIntegrationConfig,
  saveTelegramIntegrationConfig,
  verifyCustomBotToken,
  generateWebhookEndpoint,
  registerCustomBotWebhook,
} from '../utils/telegramIntegration';

interface KVStorageManagerProps {
  kvNamespace: SimulatedKVNamespace;
  onRefresh: () => void;
}

export const KVStorageManager: React.FC<KVStorageManagerProps> = ({
  kvNamespace,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newTtl, setNewTtl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});

  // Dedicated 'Telegram Bot Settings' Modal State
  const [isBotSettingsOpen, setIsBotSettingsOpen] = useState(false);
  const [botForm, setBotForm] = useState<TelegramBotConfig>(() =>
    loadTelegramIntegrationConfig(kvNamespace)
  );
  const [showModalToken, setShowModalToken] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRegisteringHook, setIsRegisteringHook] = useState(false);
  const [copiedHook, setCopiedHook] = useState(false);
  const [modalStatus, setModalStatus] = useState<{
    type: 'success' | 'error' | 'pending';
    text: string;
  } | null>(null);

  const items = kvNamespace.getAllItems();
  const filtered = items.filter(
    (item) =>
      item.key.toLowerCase().includes(search.toLowerCase()) ||
      item.value.toLowerCase().includes(search.toLowerCase())
  );

  // Sync modal form whenever opened
  useEffect(() => {
    if (isBotSettingsOpen) {
      setBotForm(loadTelegramIntegrationConfig(kvNamespace));
      setModalStatus(null);
    }
  }, [isBotSettingsOpen, kvNamespace]);

  const webhookUrl = useMemo(() => {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://streamflix-worker.workers.dev';
    return generateWebhookEndpoint(origin, botForm.botToken);
  }, [botForm.botToken]);

  const isSecretKey = (key: string) =>
    key === KV_TELEGRAM_KEYS.BOT_TOKEN ||
    key === KV_TELEGRAM_KEYS.WEBHOOK_SECRET ||
    key.toLowerCase().includes('token') ||
    key.toLowerCase().includes('secret');

  const toggleRevealKey = (key: string) => {
    setRevealedSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const maskValue = (val: string) => {
    if (!val) return '<empty>';
    if (val.length <= 8) return '••••••••';
    return `${val.slice(0, 6)}••••••••••••${val.slice(-4)}`;
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;

    const ttl = newTtl ? parseInt(newTtl, 10) : undefined;
    kvNamespace.setItemDirect(newKey.trim(), newValue, ttl);
    setNewKey('');
    setNewValue('');
    setNewTtl('');
    setIsAdding(false);
    onRefresh();
  };

  const handleSaveEdit = (key: string) => {
    kvNamespace.setItemDirect(key, editingValue);
    setEditingKey(null);
    onRefresh();
  };

  const handleDelete = (key: string) => {
    kvNamespace.deleteItemDirect(key);
    onRefresh();
  };

  const handleClearAll = () => {
    kvNamespace.clear();
    onRefresh();
  };

  const handleVerifyBotInModal = async () => {
    if (!botForm.botToken.trim()) {
      setModalStatus({
        type: 'error',
        text: 'Bitte gib zuerst ein Telegram Bot API Token ein.',
      });
      return;
    }
    setIsVerifying(true);
    setModalStatus({
      type: 'pending',
      text: 'Prüfe Bot-Token über api.telegram.org/getMe…',
    });
    try {
      const res = await verifyCustomBotToken(botForm.botToken, kvNamespace);
      onRefresh();
      if (res.ok) {
        const updatedUsername = res.username || '';
        setBotForm((prev) => ({ ...prev, botUsername: updatedUsername }));
        setModalStatus({
          type: 'success',
          text: `Bot verifiziert: @${updatedUsername || res.firstName} (ID: ${res.botId})`,
        });
      } else {
        setModalStatus({
          type: 'error',
          text: res.error || 'Token-Prüfung fehlgeschlagen.',
        });
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRegisterWebhookInModal = async () => {
    if (!botForm.botToken.trim()) return;
    setIsRegisteringHook(true);
    setModalStatus({
      type: 'pending',
      text: 'Registriere Custom-Webhook bei Telegram…',
    });
    try {
      const res = await registerCustomBotWebhook(
        botForm.botToken,
        webhookUrl,
        botForm.webhookSecret,
        kvNamespace
      );
      onRefresh();
      if (res.ok) {
        setModalStatus({
          type: 'success',
          text: `Webhook aktiv: ${res.description}`,
        });
      } else {
        setModalStatus({
          type: 'error',
          text: res.error || 'Webhook konnte nicht gesetzt werden.',
        });
      }
    } finally {
      setIsRegisteringHook(false);
    }
  };

  const handleSaveBotSettingsToKV = (e: React.FormEvent) => {
    e.preventDefault();
    const saved = saveTelegramIntegrationConfig(botForm, kvNamespace);
    setBotForm(saved);
    onRefresh();
    setModalStatus({
      type: 'success',
      text: `Gespeichert! ${KV_TELEGRAM_KEYS.BOT_TOKEN} & ${KV_TELEGRAM_KEYS.DEFAULT_CHAT_ID} wurden sicher im lokalen KV Namespace hinterlegt.`,
    });
  };

  const hasStoredBotToken = Boolean(
    items.find((i) => i.key === KV_TELEGRAM_KEYS.BOT_TOKEN && i.value.trim().length > 0)
  );

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-lg overflow-hidden relative">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-900/90 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-semibold text-white">Cloudflare KV Namespace</span>
          <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
            binding: env.MY_KV
          </span>
          <span className="text-xs text-slate-500 tabular-nums">({items.length} keys)</span>
          {hasStoredBotToken && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <ShieldCheck className="w-3 h-3" />
              Telegram Bot Configured
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Dedicated 'Telegram Bot Settings' Modal Trigger */}
          <button
            type="button"
            onClick={() => setIsBotSettingsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/25 hover:bg-indigo-600/35 text-indigo-200 border border-indigo-500/40 rounded text-xs font-semibold transition-colors shadow-xs"
          >
            <Bot className="w-3.5 h-3.5 text-indigo-400" />
            <span>Telegram Bot Settings</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAdding(!isAdding)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-medium transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Key</span>
          </button>

          {items.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs text-rose-400 hover:text-rose-300 px-2.5 py-1.5 rounded hover:bg-rose-500/10 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Add Form */}
      {isAdding && (
        <form
          onSubmit={handleCreate}
          className="p-4 bg-slate-900/60 border-b border-slate-800 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Key Name</label>
              <input
                type="text"
                required
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g. user_session_104"
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                TTL (Seconds, optional)
              </label>
              <input
                type="number"
                value={newTtl}
                onChange={(e) => setNewTtl(e.target.value)}
                placeholder="e.g. 300 (5 minutes)"
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Initial Value (Text or JSON)
              </label>
              <input
                type="text"
                required
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder='e.g. {"role":"admin"}'
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-sky-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-medium"
            >
              Save to KV
            </button>
          </div>
        </form>
      )}

      {/* Search Bar */}
      <div className="p-3 bg-slate-950 border-b border-slate-800/80 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter keys or values..."
            className="w-full bg-slate-900 border border-slate-800 rounded pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-sky-500"
          />
        </div>
      </div>

      {/* Keys Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-500">
            <Database className="w-8 h-8 stroke-1 text-slate-600 mb-2" />
            <p className="text-sm font-medium text-slate-400">No KV Keys Found</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Your worker code can write keys with{' '}
              <code>await env.MY_KV.put(&apos;key&apos;, &apos;value&apos;)</code> or you can
              configure Telegram credentials via <strong>Telegram Bot Settings</strong> above.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 text-[11px] sticky top-0">
              <tr>
                <th className="py-2.5 px-4 font-semibold w-1/4">Key</th>
                <th className="py-2.5 px-4 font-semibold">Value</th>
                <th className="py-2.5 px-4 font-semibold w-32">TTL</th>
                <th className="py-2.5 px-4 font-semibold w-28 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filtered.map((item) => {
                const secret = isSecretKey(item.key);
                const revealed = Boolean(revealedSecrets[item.key]);
                return (
                  <tr key={item.key} className="hover:bg-slate-900/40 group">
                    <td className="py-2.5 px-4 text-sky-400 font-medium break-all align-top">
                      <div className="flex items-center gap-1.5">
                        <Key
                          className={`w-3 h-3 shrink-0 ${
                            secret ? 'text-amber-400' : 'text-slate-500'
                          }`}
                        />
                        <span>{item.key}</span>
                      </div>
                    </td>

                    <td className="py-2.5 px-4 text-slate-300 break-all align-top">
                      {editingKey === item.key ? (
                        <div className="flex items-center gap-1.5">
                          <textarea
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-100"
                            rows={2}
                          />
                          <button
                            onClick={() => handleSaveEdit(item.key)}
                            className="p-1 text-emerald-400 hover:text-emerald-300"
                            title="Save"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingKey(null)}
                            className="p-1 text-slate-400 hover:text-slate-200"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="select-text whitespace-pre-wrap">
                            {secret && !revealed ? maskValue(item.value) : item.value}
                          </span>
                          {secret && (
                            <button
                              type="button"
                              onClick={() => toggleRevealKey(item.key)}
                              className="p-1 text-slate-500 hover:text-slate-300 rounded"
                              title={revealed ? 'Hide secret' : 'Reveal secret'}
                            >
                              {revealed ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="py-2.5 px-4 text-slate-400 align-top tabular-nums">
                      {item.expirationTtl ? (
                        <div className="flex items-center gap-1 text-amber-400/90">
                          <Clock className="w-3 h-3" />
                          <span>{item.expirationTtl}s</span>
                        </div>
                      ) : (
                        <span className="text-slate-600">Permanent</span>
                      )}
                    </td>

                    <td className="py-2.5 px-4 text-right align-top">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setEditingKey(item.key);
                            setEditingValue(item.value);
                          }}
                          className="p-1 text-slate-500 hover:text-slate-200 rounded hover:bg-slate-800 transition-colors"
                          title="Edit Value"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(item.key)}
                          className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-rose-500/10 transition-colors"
                          title="Delete Key"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick Developer Cheat Sheet */}
      <div className="p-3 bg-slate-900/60 border-t border-slate-800 text-[11px] text-slate-400 font-mono">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span>Worker KV Access:</span>
          <span className="text-slate-300">
            <code>await env.MY_KV.get(&apos;{KV_TELEGRAM_KEYS.BOT_TOKEN}&apos;)</code> ·{' '}
            <code>await env.MY_KV.get(&apos;{KV_TELEGRAM_KEYS.DEFAULT_CHAT_ID}&apos;)</code>
          </span>
        </div>
      </div>

      {/* Dedicated 'Telegram Bot Settings' Modal */}
      {isBotSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-[#0e1525] border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#131c31] border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    Telegram Bot Settings
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      env.MY_KV
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Store custom Telegram Bot API Token & default delivery Target Chat ID in local KV
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBotSettingsOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveBotSettingsToKV} className="p-5 space-y-4 overflow-y-auto text-xs">
              {/* Custom Bot API Token */}
              <div className="p-3.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    <span>Custom Telegram Bot API Token</span>
                  </label>
                  <code className="text-[10px] text-sky-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                    {KV_TELEGRAM_KEYS.BOT_TOKEN}
                  </code>
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showModalToken ? 'text' : 'password'}
                      value={botForm.botToken}
                      onChange={(e) =>
                        setBotForm((prev) => ({ ...prev, botToken: e.target.value }))
                      }
                      placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz..."
                      className="w-full bg-slate-950 border border-slate-700/90 rounded-lg pl-3 pr-9 py-2 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowModalToken((prev) => !prev)}
                      className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
                      title={showModalToken ? 'Hide Token' : 'Show Token'}
                    >
                      {showModalToken ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleVerifyBotInModal}
                    disabled={isVerifying || !botForm.botToken.trim()}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 font-medium shrink-0 flex items-center gap-1.5"
                  >
                    {isVerifying ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>Verify Token</span>
                  </button>
                </div>

                {botForm.botUsername && (
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Verknüpfter Bot: @{botForm.botUsername}</span>
                  </div>
                )}
              </div>

              {/* Default Delivery Mode & Target Chat ID */}
              <div className="p-3.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">
                    Default Delivery Mode & Target Chat ID
                  </span>
                  <code className="text-[10px] text-sky-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                    {KV_TELEGRAM_KEYS.DEFAULT_CHAT_ID}
                  </code>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'dm', label: 'Bot Private Chat', icon: MessageSquare },
                      { id: 'group', label: 'Target Group', icon: Users },
                      { id: 'custom_bot', label: 'Custom Bot', icon: Bot },
                    ] as { id: DeliveryMode; label: string; icon: any }[]
                  ).map((m) => {
                    const Icon = m.icon;
                    const active = botForm.deliveryMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          setBotForm((prev) => ({ ...prev, deliveryMode: m.id }))
                        }
                        className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border text-xs font-medium transition-colors ${
                          active
                            ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{m.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Default Target Chat ID (DM or Chat)
                    </label>
                    <input
                      type="text"
                      value={botForm.defaultChatId}
                      onChange={(e) =>
                        setBotForm((prev) => ({ ...prev, defaultChatId: e.target.value }))
                      }
                      placeholder="e.g. 100998877 or -1001234567890"
                      className="w-full bg-slate-950 border border-slate-700/90 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Target Group Chat ID (optional)
                    </label>
                    <input
                      type="text"
                      value={botForm.targetGroupId}
                      onChange={(e) =>
                        setBotForm((prev) => ({ ...prev, targetGroupId: e.target.value }))
                      }
                      placeholder="e.g. -1001987654321"
                      className="w-full bg-slate-950 border border-slate-700/90 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Forum Topic / Thread ID (optional)
                    </label>
                    <input
                      type="text"
                      value={botForm.targetTopicId}
                      onChange={(e) =>
                        setBotForm((prev) => ({ ...prev, targetTopicId: e.target.value }))
                      }
                      placeholder="e.g. 42"
                      className="w-full bg-slate-950 border border-slate-700/90 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Source Group ID (for result.json copyMessage)
                    </label>
                    <input
                      type="text"
                      value={botForm.sourceGroupId}
                      onChange={(e) =>
                        setBotForm((prev) => ({ ...prev, sourceGroupId: e.target.value }))
                      }
                      placeholder="Auto (-100...) or custom chat_id"
                      className="w-full bg-slate-950 border border-slate-700/90 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Webhook Endpoint & One-Click Registration */}
              <div className="p-3.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-sky-400" />
                    <span>Generated Custom Bot Webhook Endpoint</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleRegisterWebhookInModal}
                    disabled={isRegisteringHook || !botForm.botToken.trim()}
                    className="px-2.5 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-40 text-sky-300 border border-sky-500/40 text-[11px] font-medium flex items-center gap-1"
                  >
                    {isRegisteringHook && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>Set Webhook on Bot</span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 bg-slate-950 px-3 py-1.5 rounded border border-slate-800">
                  <span className="font-mono text-[11px] text-slate-300 truncate">
                    {webhookUrl}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl);
                      setCopiedHook(true);
                      setTimeout(() => setCopiedHook(false), 1800);
                    }}
                    className="text-sky-400 hover:text-sky-300 shrink-0 flex items-center gap-1 text-[11px]"
                  >
                    {copiedHook ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Status Banner inside Modal */}
              {modalStatus && (
                <div
                  className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg border text-xs ${
                    modalStatus.type === 'success'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : modalStatus.type === 'error'
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                      : 'bg-sky-500/10 border-sky-500/30 text-sky-300'
                  }`}
                >
                  {modalStatus.type === 'pending' && (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0 text-sky-400" />
                  )}
                  {modalStatus.type === 'success' && (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  )}
                  {modalStatus.type === 'error' && (
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  )}
                  <span className="flex-1">{modalStatus.text}</span>
                </div>
              )}

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsBotSettingsOpen(false)}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Save to KV Namespace</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
