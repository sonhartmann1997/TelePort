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
    title: '8. STREAMFLIX Netflix Mini-App (TMA) Frontend & Auth-Crypto',
    shortTitle: '08 · STREAMFLIX UI & Auth',
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

    // Split 08-tma-netflix-frontend into 08a, 08b, 08c so every single file is < 300 KB for GitHub API sync
    if (dept.id === '08-tma-netflix-frontend' && deptLines.length > 3000) {
      const third = Math.ceil(deptLines.length / 3);
      const partA = deptLines.slice(0, third).join('\n').trimEnd() + '\n';
      const partB = deptLines.slice(third, third * 2).join('\n').trimEnd() + '\n';
      const partC = deptLines.slice(third * 2).join('\n').trimEnd() + '\n';
      fs.writeFileSync(path.join(modulesDir, '08a-tma-netflix-frontend.js'), partA, 'utf8');
      fs.writeFileSync(path.join(modulesDir, '08b-tma-netflix-frontend.js'), partB, 'utf8');
      fs.writeFileSync(path.join(modulesDir, '08c-tma-netflix-frontend.js'), partC, 'utf8');
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
