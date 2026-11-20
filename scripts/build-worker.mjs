import fs from 'fs';
import path from 'path';

const rootDir = import.meta.dirname ? path.resolve(import.meta.dirname, '..') : process.cwd();
const workerPath = path.join(rootDir, 'worker.js');
const modulesDir = path.join(rootDir, 'worker-modules');

export const WORKER_DEPARTMENTS = [
  {
    id: '01-config-catalog',
    title: '1. Konfiguration, Filmreihen & Genres',
    shortTitle: '01 · Config & Genres',
    anchorStart: null,
    anchorEnd: '// @ANCHOR: PARSER_SWITCH',
  },
  {
    id: '02-parser-ingester',
    title: '2. Erkennungs-Weiche, Regex-Parser & JSON-Ingester',
    shortTitle: '02 · Parser & Ingester',
    anchorStart: '// @ANCHOR: PARSER_SWITCH',
    anchorEnd: '// @ANCHOR: ANTI_SPAM_ENGINE',
  },
  {
    id: '03-telegram-kv-engine',
    title: '3. Telegram Bot API, Anti-Spam & KV-Merkliste',
    shortTitle: '03 · Telegram & KV',
    anchorStart: '// @ANCHOR: ANTI_SPAM_ENGINE',
    anchorEnd: '// @ANCHOR: D1_MOVIES',
  },
  {
    id: '04-d1-database',
    title: '4. Cloudflare D1 Datenbank (Filme, Serien & Logs)',
    shortTitle: '04 · D1 Datenbank',
    anchorStart: '// @ANCHOR: D1_MOVIES',
    anchorEnd: '// @ANCHOR: TELEGRAPH_ENGINE',
  },
  {
    id: '05-tmdb-telegraph',
    title: '5. TMDb-API, Confidence-Scoring & Multi-API Fallback',
    shortTitle: '05 · TMDb & Fallbacks',
    anchorStart: '// @ANCHOR: TELEGRAPH_ENGINE',
    anchorEnd: '// @ANCHOR: ADMIN_PANEL',
  },
  {
    id: '06-bot-ui-menus',
    title: '6. Bot-Menüs, Filter-Cockpit, Detailkarten & Suche',
    shortTitle: '06 · Bot UI & Menüs',
    anchorStart: '// @ANCHOR: ADMIN_PANEL',
    anchorEnd: '// @ANCHOR: WEBHOOK_ROUTER',
  },
  {
    id: '07-webhook-callbacks',
    title: '7. Telegram Webhook-Router & Callback-Handler',
    shortTitle: '07 · Webhook & Callbacks',
    anchorStart: '// @ANCHOR: WEBHOOK_ROUTER',
    anchorEnd: '// @ANCHOR: TMA_ROUTES',
  },
  {
    id: '08-tma-netflix-frontend',
    title: '8. TelePort Mini-App (TMA) Frontend & Auth-Crypto',
    shortTitle: '08 · TelePort UI & Auth',
    anchorStart: '// @ANCHOR: TMA_ROUTES',
    anchorEnd: '// @ANCHOR: TMA_BACKEND_API',
  },
  {
    id: '09-tma-api-worker-export',
    title: '9. TMA Backend-API Router, Series-Health & Worker-Export',
    shortTitle: '09 · TMA API & Export',
    anchorStart: '// @ANCHOR: TMA_BACKEND_API',
    anchorEnd: null,
  },
];

export function assembleWorkerFromModules(customModulesDir = modulesDir) {
  if (!fs.existsSync(customModulesDir)) return null;
  const files = fs
    .readdirSync(customModulesDir)
    .filter((f) => f.endsWith('.js'))
    .sort();
  if (files.length === 0) return null;
  return (
    files
      .map((f) => fs.readFileSync(path.join(customModulesDir, f), 'utf8').trimEnd())
      .join('\n\n') + '\n'
  );
}

export const WORKER_REPO_STUB = `// [CLOUDFLARE WORKER REPO STUB]
// Full worker source is modularized into ./worker-modules/*.js (< 300 KB per file)
// and automatically assembled into ./worker.js during \`bun run build\` / \`vite build\`.
export default {
  async fetch() {
    return new Response("Worker stub: Run \`bun run build\` before deploying.", { status: 500 });
  }
};
`;

export function splitWorkerIntoModules(sourceCode) {
  let raw = sourceCode ?? (fs.existsSync(workerPath) ? fs.readFileSync(workerPath, 'utf8') : '');
  if (Buffer.byteLength(raw) < 50000 && fs.existsSync(modulesDir)) {
    raw = assembleWorkerFromModules() || raw;
  }

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
  for (const oldFile of fs.readdirSync(modulesDir)) {
    fs.rmSync(path.join(modulesDir, oldFile), { force: true });
  }

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
    const deptLines = [header, ...cleaned];

    // Split 08-tma-netflix-frontend into 11 semantic domain modules (08a..08k, all < 250 KB)
    if (dept.id === '08-tma-netflix-frontend' && deptLines.length > 3000) {
      const semanticSplits = [
        { file: '08a-tma-auth-shell.js', idx: 0 },
        { file: '08b-tma-css-hero-player.js', find: '/* 100% Vollbild TelePort Kino-Spotlight:' },
        { file: '08c-tma-js-core-catalog.js', find: 'const API_BASE = "${workerOrigin}/api/tma";', offset: -1 },
        { file: '08d-tma-js-hero-cinema-player.js', find: '// HAUPTSLIDER INLINE-KINO-TRAILER ENGINE', offset: -1 },
        { file: '08e-tma-js-detail-trailer.js', find: 'async function openStudioView(companyId, companyName, presetStudioId = "") {' },
        { file: '08f-tma-js-detail-modal-streams.js', find: 'function renderOrPatchDetailStageClient(type, id, d, forceSeasonNum = null' },
        { file: '08g-tma-js-corrections-wishlist.js', find: '// GRANULARER "FOLGEN KORRIGIEREN"-DIALOG & "FEHLER MELDEN"-MODAL (CLIENT)', offset: -1 },
        { file: '08h-tma-js-backup-parser.js', find: '// ADMIN-PANEL: USER-LISTE, VIP-STATUS TOGGLE, SMART PLAYLIST MANAGER, FILM-CRUD & 100K+ BACKUP-IMPORTER', offset: -1 },
        { file: '08i-tma-js-backup-review.js', find: 'async function handleBackupFileInput(ev) {' },
        { file: '08j-tma-js-admin-diagnostics.js', find: '// PERSISTENTES DIAGNOSE-LOG (D1 + Browser localStorage + KI-Analyse-Export)', offset: -1 },
        { file: '08k-tma-js-spatial-navigation.js', find: '// SPATIAL NAVIGATION: PFEILTASTEN, ANDROID-TV REMOTE, GAMEPAD, MAUS-HOVER & TYPE-TO-SEARCH', offset: -1 },
      ];

      const resolved = [];
      let allFound = true;
      for (const spec of semanticSplits) {
        if (typeof spec.idx === 'number') {
          resolved.push({ file: spec.file, idx: spec.idx });
          continue;
        }
        const hit = deptLines.findIndex((l) => l.includes(spec.find));
        if (hit === -1) {
          allFound = false;
          break;
        }
        resolved.push({ file: spec.file, idx: Math.max(0, hit + (spec.offset || 0)) });
      }

      if (allFound && resolved.every((r, i) => i === 0 || r.idx > resolved[i - 1].idx)) {
        for (let i = 0; i < resolved.length; i++) {
          const start = resolved[i].idx;
          const end = i + 1 < resolved.length ? resolved[i + 1].idx : deptLines.length;
          const chunk = deptLines.slice(start, end).join('\n').trimEnd() + '\n';
          fs.writeFileSync(path.join(modulesDir, resolved[i].file), chunk, 'utf8');
        }
      } else {
        const chunkCount = Math.max(4, Math.ceil(Buffer.byteLength(deptLines.join('\n')) / (230 * 1024)));
        const linesPerChunk = Math.ceil(deptLines.length / chunkCount);
        for (let i = 0; i < chunkCount; i++) {
          const letter = String.fromCharCode(97 + i);
          const chunk = deptLines.slice(i * linesPerChunk, (i + 1) * linesPerChunk).join('\n').trimEnd() + '\n';
          if (chunk.trim()) {
            fs.writeFileSync(path.join(modulesDir, `08${letter}-tma-frontend-part.js`), chunk, 'utf8');
          }
        }
      }
    } else {
      const content = deptLines.join('\n').trimEnd() + '\n';
      fs.writeFileSync(path.join(modulesDir, `${dept.id}.js`), content, 'utf8');
    }
  }

  console.log(`[build-worker] Split worker into ${fs.readdirSync(modulesDir).length} module files in worker-modules/`);
}

if (process.argv[1] && process.argv[1].endsWith('build-worker.mjs')) {
  const mode = process.argv[2] || '--split';
  if (mode === '--bundle') {
    const combined = assembleWorkerFromModules();
    if (combined) {
      fs.writeFileSync(workerPath, combined, 'utf8');
      console.log(`[build-worker] Bundled modules -> worker.js (${(Buffer.byteLength(combined) / 1024).toFixed(1)} KB)`);
    }
  } else if (mode === '--stub') {
    fs.writeFileSync(workerPath, WORKER_REPO_STUB, 'utf8');
    console.log('[build-worker] Wrote repo stub -> worker.js');
  } else {
    splitWorkerIntoModules();
  }
}
