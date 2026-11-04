export interface WorkerDepartmentMeta {
  id: string;
  number: string;
  title: string;
  shortTitle: string;
  anchorStart: string | null;
  anchorEnd: string | null;
  anchors: string[];
  description: string;
}

export interface ParsedWorkerDepartment extends WorkerDepartmentMeta {
  code: string;
  lineCount: number;
  byteSize: number;
  startLineInFull: number;
  endLineInFull: number;
  anchorLocations: { anchor: string; relativeLine: number; fullLine: number }[];
}

export const WORKER_DEPARTMENT_DEFINITIONS: WorkerDepartmentMeta[] = [
  {
    id: '01-config-catalog',
    number: '01',
    title: 'Konfiguration, Filmreihen & Genres',
    shortTitle: 'Config & Genres',
    anchorStart: null,
    anchorEnd: '// @ANCHOR: PARSER_SWITCH',
    anchors: ['CONFIG_TIERS', 'COLLECTIONS_UNIVERSES', 'GENRES_SYNONYMS', 'CACHE_STATS'],
    description:
      'API-Tiers (Free/Paid), 30+ Filmreihen, 12 Filmuniversen, Genres, Synonyme, Studios, Streaming-Anbieter & In-Memory Cache.',
  },
  {
    id: '02-parser-ingester',
    number: '02',
    title: 'Erkennungs-Weiche, Regex-Parser & JSON-Ingester',
    shortTitle: 'Parser & Ingester',
    anchorStart: '// @ANCHOR: PARSER_SWITCH',
    anchorEnd: '// @ANCHOR: ANTI_SPAM_ENGINE',
    anchors: ['PARSER_SWITCH'],
    description:
      'Serien-/Film-Erkennungsweiche (S01E01, 1x01, Folge), Qualitäts-/Codec-/RAR-/Untertitel-Parser, Prerelease/MD-Erkennung & JSON-Backup-Parser.',
  },
  {
    id: '03-telegram-kv-engine',
    number: '03',
    title: 'Telegram Bot API, Anti-Spam & KV-Merkliste',
    shortTitle: 'Telegram & KV',
    anchorStart: '// @ANCHOR: ANTI_SPAM_ENGINE',
    anchorEnd: '// @ANCHOR: D1_MOVIES',
    anchors: [
      'ANTI_SPAM_ENGINE',
      'TELEGRAM_API',
      'KV_STORAGE_WISHLIST',
      'GENRE_AUTO_RANDOM_TIMESTAMP',
      'TRANSLATOR_FSK',
    ],
    description:
      'Telegram Rate-Limiter & Flood-Wait-Schutz, Bot-API Wrapper, KV-Merkliste/Ordner, Übersetzer & FSK-Altersfreigaben.',
  },
  {
    id: '04-d1-database',
    number: '04',
    title: 'Cloudflare D1 Datenbank (Filme, Serien & Logs)',
    shortTitle: 'D1 Datenbank',
    anchorStart: '// @ANCHOR: D1_MOVIES',
    anchorEnd: '// @ANCHOR: TELEGRAPH_ENGINE',
    anchors: ['D1_MOVIES', 'D1_REPORTS_AND_CORRECTIONS'],
    description:
      'Getrennte D1-Tabellen (movies, movie_files, series, series_seasons, series_episodes, episode_files), Prerelease-Auto-Upgrade, Untertitel-Bindung & Diagnose-Logs.',
  },
  {
    id: '05-tmdb-telegraph',
    number: '05',
    title: 'TMDb-API, Confidence-Scoring & Multi-API Fallback',
    shortTitle: 'TMDb & Fallbacks',
    anchorStart: '// @ANCHOR: TELEGRAPH_ENGINE',
    anchorEnd: '// @ANCHOR: ADMIN_PANEL',
    anchors: ['TELEGRAPH_ENGINE', 'TMDB_FETCH'],
    description:
      'TMDb Movie/TV/Season Abfragen, Unicode-Confidence-Scoring mit Non-Latin-Guard, 8-Stufen Fallback (OMDb, iTunes, TVMaze, AniList, Wikidata) & Telegraph.',
  },
  {
    id: '06-bot-ui-menus',
    number: '06',
    title: 'Bot-Menüs, Filter-Cockpit, Detailkarten & Suche',
    shortTitle: 'Bot UI & Menüs',
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
    description:
      'Interaktive Telegram-Bot-Menüs, Filter- & Sortier-UI, Serien-Staffelbrowser, Detailkarten mit Stream-Buttons, Zufalls-Engine & Inline-Modus.',
  },
  {
    id: '07-webhook-callbacks',
    number: '07',
    title: 'Telegram Webhook-Router & Callback-Handler',
    shortTitle: 'Webhook & Callbacks',
    anchorStart: '// @ANCHOR: WEBHOOK_ROUTER',
    anchorEnd: '// @ANCHOR: TMA_ROUTES',
    anchors: ['WEBHOOK_ROUTER', 'CALLBACK_ROUTER'],
    description:
      'Eingehende Telegram-Updates (Videos, Dokumente, .srt/.sub Untertitel, .json Backups, Befehle) und Inline-Keyboard Callback-Routing.',
  },
  {
    id: '08-tma-netflix-frontend',
    number: '08',
    title: 'STREAMFLIX Netflix Mini-App (TMA) Frontend & Auth-Crypto',
    shortTitle: 'STREAMFLIX UI & Auth',
    anchorStart: '// @ANCHOR: TMA_ROUTES',
    anchorEnd: '// @ANCHOR: TMA_BACKEND_API',
    anchors: ['TMA_ROUTES', 'TMA_AUTH_SECURITY'],
    description:
      'Immersives STREAMFLIX Frontend (#141414), HMAC-SHA256 initData-Security, PBKDF2 Web-Login, TOTP 2FA & Admin-Dashboard UI.',
  },
  {
    id: '09-tma-api-worker-export',
    number: '09',
    title: 'TMA Backend-API Router, Series-Health & Worker-Export',
    shortTitle: 'TMA API & Export',
    anchorStart: '// @ANCHOR: TMA_BACKEND_API',
    anchorEnd: null,
    anchors: ['TMA_BACKEND_API', 'WORKER_EXPORT'],
    description:
      'Serverless API-Router (/api/tma/*, /api/import-json, /api/tma/series-health, Admin-Remap/Logs) & Cloudflare Worker fetch()-Export.',
  },
];

export function parseWorkerIntoDepartments(fullCode: string): ParsedWorkerDepartment[] {
  const lines = fullCode.split(/\r?\n/);

  const findAnchorLineIndex = (anchorComment: string | null, deptId?: string): number => {
    if (!anchorComment) return -1;
    // Prefer matching the @DEPARTMENT header right above the anchor if present
    if (deptId) {
      const deptIdx = lines.findIndex((l) => l.includes(`@DEPARTMENT: ${deptId}`));
      if (deptIdx !== -1) return deptIdx;
    }
    const idx = lines.findIndex((l) => l.trim() === anchorComment.trim());
    if (idx > 0 && lines[idx - 1]?.includes('@DEPARTMENT:')) {
      return idx - 1;
    }
    return idx;
  };

  // Fallback if code is a small template without our anchors
  const hasParserAnchor = lines.some((l) => l.includes('@ANCHOR: PARSER_SWITCH'));
  if (!hasParserAnchor) {
    return [
      {
        ...WORKER_DEPARTMENT_DEFINITIONS[0],
        id: '01-config-catalog',
        title: 'Vollständiges Worker-Modul (Blueprint)',
        shortTitle: 'Worker Blueprint',
        code: fullCode,
        lineCount: lines.length,
        byteSize: new Blob([fullCode]).size,
        startLineInFull: 1,
        endLineInFull: lines.length,
        anchorLocations: [],
      },
    ];
  }

  const parsed: ParsedWorkerDepartment[] = [];

  for (let i = 0; i < WORKER_DEPARTMENT_DEFINITIONS.length; i++) {
    const def = WORKER_DEPARTMENT_DEFINITIONS[i];
    const nextDef = WORKER_DEPARTMENT_DEFINITIONS[i + 1] || null;
    const startIdx = i === 0 ? 0 : findAnchorLineIndex(def.anchorStart, def.id);
    const endIdx = nextDef ? findAnchorLineIndex(def.anchorEnd, nextDef.id) : lines.length;

    const safeStart = startIdx === -1 ? 0 : startIdx;
    const safeEnd = endIdx === -1 || endIdx < safeStart ? lines.length : endIdx;
    const slice = lines.slice(safeStart, safeEnd);
    const deptCode = slice.join('\n');

    const anchorLocations: { anchor: string; relativeLine: number; fullLine: number }[] = [];
    slice.forEach((line, relIdx) => {
      const m = line.match(/@ANCHOR:\s*([A-Z0-9_]+)/);
      if (m) {
        anchorLocations.push({
          anchor: m[1],
          relativeLine: relIdx + 1,
          fullLine: safeStart + relIdx + 1,
        });
      }
    });

    parsed.push({
      ...def,
      code: deptCode,
      lineCount: slice.length,
      byteSize: new TextEncoder().encode(deptCode).length,
      startLineInFull: safeStart + 1,
      endLineInFull: safeEnd,
      anchorLocations,
    });
  }

  return parsed;
}

export function updateDepartmentInFullWorker(
  fullCode: string,
  departmentId: string,
  newDepartmentCode: string
): string {
  const departments = parseWorkerIntoDepartments(fullCode);
  if (departments.length <= 1) {
    return newDepartmentCode;
  }
  return (
    departments
      .map((dept) => (dept.id === departmentId ? newDepartmentCode.trimEnd() : dept.code.trimEnd()))
      .join('\n\n') + '\n'
  );
}

export function optimizeWorkerCode(fullCode: string): {
  optimizedCode: string;
  beforeBytes: number;
  afterBytes: number;
  savedBytes: number;
  beforeLines: number;
  afterLines: number;
  compactedLines: number;
} {
  const beforeBytes = new TextEncoder().encode(fullCode).length;
  const rawLines = fullCode.split(/\r?\n/);
  const beforeLines = rawLines.length;

  const cleaned: string[] = [];
  let blankRun = 0;

  for (const line of rawLines) {
    const trimmedRight = line.replace(/[ \t]+$/, '');
    if (trimmedRight === '') {
      blankRun++;
      if (blankRun <= 1) {
        cleaned.push('');
      }
    } else {
      blankRun = 0;
      cleaned.push(trimmedRight);
    }
  }

  const optimizedCode = cleaned.join('\n').trimEnd() + '\n';
  const afterBytes = new TextEncoder().encode(optimizedCode).length;
  const afterLines = optimizedCode.split('\n').length;

  return {
    optimizedCode,
    beforeBytes,
    afterBytes,
    savedBytes: Math.max(0, beforeBytes - afterBytes),
    beforeLines,
    afterLines,
    compactedLines: Math.max(0, beforeLines - afterLines),
  };
}
