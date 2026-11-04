import fs from 'fs';
import path from 'path';

const rootDir = import.meta.dirname ? path.resolve(import.meta.dirname, '..') : process.cwd();
const workerPath = path.join(rootDir, 'worker.js');
const publicWorkerPath = path.join(rootDir, 'public', 'worker.js');
const modulesDir = path.join(rootDir, 'worker-modules');

export const WORKER_DEPARTMENTS = [
  {
    id: '01-config-catalog',
    title: '1. Konfiguration, Filmreihen & Genres',
    shortTitle: '01 · Config & Genres',
    anchorStart: null,
    anchorEnd: '// @ANCHOR: PARSER_SWITCH',
    anchors: ['CONFIG_TIERS', 'COLLECTIONS_UNIVERSES', 'GENRES_SYNONYMS', 'CACHE_STATS'],
    description: 'API-Tiers (Free/Paid), 30+ Filmreihen, 12 Filmuniversen, Genres, Synonyme, Studios, Streaming-Anbieter & In-Memory Cache.',
  },
  {
    id: '02-parser-ingester',
    title: '2. Erkennungs-Weiche, Regex-Parser & JSON-Ingester',
    shortTitle: '02 · Parser & Ingester',
    anchorStart: '// @ANCHOR: PARSER_SWITCH',
    anchorEnd: '// @ANCHOR: ANTI_SPAM_ENGINE',
    anchors: ['PARSER_SWITCH'],
    description: 'Serien-/Film-Erkennungsweiche (S01E01, 1x01, Folge), Qualitäts-/Codec-/RAR-/Untertitel-Parser, Prerelease/MD-Erkennung & JSON-Backup-Parser.',
  },
  {
    id: '03-telegram-kv-engine',
    title: '3. Telegram Bot API, Anti-Spam & KV-Merkliste',
    shortTitle: '03 · Telegram & KV',
    anchorStart: '// @ANCHOR: ANTI_SPAM_ENGINE',
    anchorEnd: '// @ANCHOR: D1_MOVIES',
    anchors: ['ANTI_SPAM_ENGINE', 'TELEGRAM_API', 'KV_STORAGE_WISHLIST', 'GENRE_AUTO_RANDOM_TIMESTAMP', 'TRANSLATOR_FSK'],
    description: 'Telegram Rate-Limiter & Flood-Wait-Schutz, Bot-API Wrapper, KV-Merkliste/Ordner, Übersetzer & FSK-Altersfreigaben.',
  },
  {
    id: '04-d1-database',
    title: '4. Cloudflare D1 Datenbank (Filme, Serien & Logs)',
    shortTitle: '04 · D1 Datenbank',
    anchorStart: '// @ANCHOR: D1_MOVIES',
    anchorEnd: '// @ANCHOR: TELEGRAPH_ENGINE',
    anchors: ['D1_MOVIES', 'D1_REPORTS_AND_CORRECTIONS'],
    description: 'Getrennte D1-Tabellen (movies, movie_files, series, series_seasons, series_episodes, episode_files), Prerelease-Auto-Upgrade, Untertitel-Bindung & Diagnose-Logs.',
  },
  {
    id: '05-tmdb-telegraph',
    title: '5. TMDb-API, Confidence-Scoring & Multi-API Fallback',
    shortTitle: '05 · TMDb & Fallbacks',
    anchorStart: '// @ANCHOR: TELEGRAPH_ENGINE',
    anchorEnd: '// @ANCHOR: ADMIN_PANEL',
    anchors: ['TELEGRAPH_ENGINE', 'TMDB_FETCH'],
    description: 'TMDb Movie/TV/Season Abfragen, Unicode-Confidence-Scoring mit Non-Latin-Guard, 8-Stufen Fallback (OMDb, iTunes, TVMaze, AniList, Wikidata) & Telegraph.',
  },
  {
    id: '06-bot-ui-menus',
    title: '6. Bot-Menüs, Filter-Cockpit, Detailkarten & Suche',
    shortTitle: '06 · Bot UI & Menüs',
    anchorStart: '// @ANCHOR: ADMIN_PANEL',
    anchorEnd: '// @ANCHOR: WEBHOOK_ROUTER',
    anchors: [
      'ADMIN_PANEL',
      'MAIN_MENU_INFO',
      'BROWSER_COLLECTIONS_UNIVERSES',
      'FILTER_SORT_UI',
      'GENRE_DISCOVERY',
      'COLLECTION_UNIVERSE_DETAILS',
      'YEAR_DISCOVERY',
      'SERIES_EPISODES',
      'PERSON_CREDITS',
      'SEARCH_RESULTS',
      'WISHLIST_COCKPIT',
      'WHERE_TO_SEARCH',
      'ITEM_CARD',
      'RANDOM_DISCOVERY',
      'INLINE_MODE',
      'SIMILAR_SEARCH',
    ],
    description: 'Interaktive Telegram-Bot-Menüs, Filter- & Sortier-UI, Serien-Staffelbrowser, Detailkarten mit Stream-Buttons, Zufalls-Engine & Inline-Modus.',
  },
  {
    id: '07-webhook-callbacks',
    title: '7. Telegram Webhook-Router & Callback-Handler',
    shortTitle: '07 · Webhook & Callbacks',
    anchorStart: '// @ANCHOR: WEBHOOK_ROUTER',
    anchorEnd: '// @ANCHOR: TMA_ROUTES',
    anchors: ['WEBHOOK_ROUTER', 'CALLBACK_ROUTER'],
    description: 'Eingehende Telegram-Updates (Videos, Dokumente, .srt/.sub Untertitel, .json Backups, Befehle) und Inline-Keyboard Callback-Routing.',
  },
  {
    id: '08-tma-netflix-frontend',
    title: '8. STREAMFLIX Netflix Mini-App (TMA) Frontend & Auth-Crypto',
    shortTitle: '08 · STREAMFLIX UI & Auth',
    anchorStart: '// @ANCHOR: TMA_ROUTES',
    anchorEnd: '// @ANCHOR: TMA_BACKEND_API',
    anchors: ['TMA_ROUTES', 'TMA_AUTH_SECURITY'],
    description: 'Immersives STREAMFLIX Frontend (#141414), HMAC-SHA256 initData-Security, PBKDF2 Web-Login, TOTP 2FA & Admin-Dashboard UI.',
  },
  {
    id: '09-tma-api-worker-export',
    title: '9. TMA Backend-API Router, Series-Health & Worker-Export',
    shortTitle: '09 · TMA API & Export',
    anchorStart: '// @ANCHOR: TMA_BACKEND_API',
    anchorEnd: null,
    anchors: ['TMA_BACKEND_API', 'WORKER_EXPORT'],
    description: 'Serverless API-Router (/api/tma/*, /api/import-json, /api/tma/series-health, Admin-Remap/Logs) & Cloudflare Worker fetch()-Export.',
  },
];

const mode = process.argv[2] || '--sync';

if (mode === '--bundle' && fs.existsSync(modulesDir)) {
  const files = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith('.js'))
    .sort();
  if (files.length > 0) {
    const combined = files
      .map((f) => fs.readFileSync(path.join(modulesDir, f), 'utf8').trimEnd())
      .join('\n\n') + '\n';
    fs.writeFileSync(workerPath, combined, 'utf8');
    fs.writeFileSync(publicWorkerPath, combined, 'utf8');
    console.log(`[build-worker] Bundled ${files.length} departments -> worker.js (${(Buffer.byteLength(combined) / 1024).toFixed(1)} KB)`);
    process.exit(0);
  }
}

// Ensure @ANCHOR: TMA_BACKEND_API exists before handleTmaRequest
let raw = fs.readFileSync(workerPath, 'utf8');
if (!raw.includes('// @ANCHOR: TMA_BACKEND_API')) {
  raw = raw.replace(
    /(\n\s*async function handleTmaRequest\(request,\s*env,\s*ctx\s*=\s*null\)\s*\{)/,
    '\n  // @ANCHOR: TMA_BACKEND_API$1'
  );
}

const rawLines = raw.split(/\r?\n/).filter((l) => !l.trim().startsWith('// @DEPARTMENT:'));

function findAnchorIndex(anchorComment) {
  if (!anchorComment) return -1;
  return rawLines.findIndex((l) => l.trim() === anchorComment.trim());
}

fs.mkdirSync(modulesDir, { recursive: true });
const chunks = [];

for (const dept of WORKER_DEPARTMENTS) {
  const startIdx = dept.anchorStart ? findAnchorIndex(dept.anchorStart) : 0;
  const endIdx = dept.anchorEnd ? findAnchorIndex(dept.anchorEnd) : rawLines.length;
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Missing anchor for ${dept.id}: start=${startIdx}, end=${endIdx}`);
  }
  const slice = rawLines.slice(startIdx, endIdx);
  const cleaned = [];
  let blankRun = 0;
  for (const line of slice) {
    const r = line.replace(/[ \t]+$/, '');
    if (r === '') {
      blankRun++;
      if (blankRun <= 1) cleaned.push('');
    } else {
      blankRun = 0;
      cleaned.push(r);
    }
  }
  const header = `  // @DEPARTMENT: ${dept.id} | ${dept.title}`;
  const content = [header, ...cleaned].join('\n').trimEnd() + '\n';
  fs.writeFileSync(path.join(modulesDir, `${dept.id}.js`), content, 'utf8');
  chunks.push(content.trimEnd());
}

const merged = chunks.join('\n\n') + '\n';
fs.writeFileSync(workerPath, merged, 'utf8');
if (mode !== '--split' && fs.existsSync(modulesDir)) {
  fs.rmSync(modulesDir, { recursive: true, force: true });
}
console.log(`[build-worker] Synced ${WORKER_DEPARTMENTS.length} departments -> worker.js (${(Buffer.byteLength(merged) / 1024).toFixed(1)} KB)`);
