import fs from 'node:fs';
import path from 'node:path';
import { build, transform } from 'esbuild';
import { assembleWorkerFromModules, extractStaticTmaAssets } from './build-worker.mjs';

const rootDir = process.cwd();
const modulesDir = path.join(rootDir, 'worker-modules');
const workerPath = path.join(rootDir, 'worker.js');
const publicWorkerPath = path.join(rootDir, 'public', 'worker.js');

const TEMPLATE_LITERAL_MODULE_RE = /^08[a-z]-.*\.js$/;

const DEPRECATED_PATTERNS = [
  {
    id: 'String.prototype.substr',
    regex: /\.substr\s*\(/g,
    message: 'Veraltete Methode .substr() erkannt – bitte .slice() oder .substring() verwenden.',
  },
  {
    id: 'Global escape/unescape',
    regex: /(?<!\.)\b(?:escape|unescape)\s*\(/g,
    message: 'Veraltete Funktion escape()/unescape() erkannt – bitte encodeURIComponent/decodeURIComponent nutzen.',
  },
  {
    id: 'with-Statement',
    regex: /\bwith\s*\(/g,
    message: 'Verbotenes with-Statement erkannt (im Strict/ES-Module-Modus unzulässig).',
  },
  {
    id: '__proto__-Zugriff',
    regex: /\.__proto__\b/g,
    message: 'Veralteter .__proto__ Zugriff erkannt – bitte Object.getPrototypeOf/setPrototypeOf nutzen.',
  },
  {
    id: 'arguments.callee',
    regex: /\barguments\.callee\b/g,
    message: 'Veraltetes arguments.callee erkannt (im Strict-Modus nicht erlaubt).',
  },
];

function runPreAssemblyModuleStaticAnalysis() {
  if (!fs.existsSync(modulesDir)) {
    return { moduleMap: [], warnings: [], errors: [] };
  }

  const files = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith('.js'))
    .sort();

  const moduleMap = [];
  const warnings = [];
  const errors = [];
  let assembledLineOffset = 1;

  for (const file of files) {
    const fullPath = path.join(modulesDir, file);
    const rawContent = fs.readFileSync(fullPath, 'utf8').trimEnd();
    const lines = rawContent.split(/\r?\n/);

    moduleMap.push({
      file,
      startLine: assembledLineOffset,
      endLine: assembledLineOffset + lines.length - 1,
      lineCount: lines.length,
    });
    assembledLineOffset += lines.length + 2;

    // 1. Check for deprecated JS features in every module
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) continue;

      for (const rule of DEPRECATED_PATTERNS) {
        rule.regex.lastIndex = 0;
        const match = rule.regex.exec(line);
        if (match) {
          warnings.push({
            file,
            line: i + 1,
            column: match.index + 1,
            rule: rule.id,
            message: rule.message,
            snippet: trimmed.slice(0, 110),
          });
        }
      }
    }

    // 2. Check template-literal escaping inside all 08*.js TMA frontend modules (prevents Uncaught SyntaxError: Invalid regular expression flags)
    if (TEMPLATE_LITERAL_MODULE_RE.test(file)) {
      const startMarkerIdx = lines.findIndex((l) => l.includes('return `<!DOCTYPE html>'));
      const endMarkerIdx = lines.findIndex((l) => l.includes('</html>`;'));
      const templateStartIdx = startMarkerIdx !== -1 ? startMarkerIdx : 0;
      const templateEndIdx = endMarkerIdx !== -1 ? endMarkerIdx + 1 : lines.length;

      for (let i = templateStartIdx; i < templateEndIdx; i++) {
        const line = lines[i];
        const singleBackslashRe = /(?<!\\)\\(?!\\|`|\$\{)(.)/g;
        let match;
        while ((match = singleBackslashRe.exec(line)) !== null) {
          errors.push({
            file,
            line: i + 1,
            column: match.index + 1,
            rule: 'Template-Literal Unescaped Backslash',
            message: `Einfach-escaped Sequenz "\\${match[1]}" im HTML-Template-Literal gefunden (muss "\\\\${match[1]}" sein, sonst droht ein Regex/SyntaxError im Browser).`,
            snippet: line.trim().slice(0, 110),
          });
        }
      }
    }
  }

  return { moduleMap, warnings, errors };
}

function resolveModuleLocation(moduleMap, assembledLine) {
  if (!assembledLine || !Array.isArray(moduleMap)) return null;
  const hit = moduleMap.find(
    (m) => assembledLine >= m.startLine && assembledLine <= m.endLine
  );
  if (!hit) return null;
  return {
    file: hit.file,
    moduleLine: assembledLine - hit.startLine + 1,
  };
}

async function verifyEmbeddedMiniAppScripts(assembledCode, moduleMap) {
  const startMarker = 'return `<!DOCTYPE html>';
  const startIdx = assembledCode.indexOf(startMarker);
  if (startIdx === -1) return { scriptCount: 0 };

  const endMarker = '</html>`;';
  const endIdx = assembledCode.indexOf(endMarker, startIdx);
  if (endIdx === -1) return { scriptCount: 0 };

  const templateLiteralSource = assembledCode.slice(
    startIdx + 'return '.length,
    endIdx + '</html>`'.length
  );
  const templateStartLineInWorker = assembledCode
    .slice(0, startIdx)
    .split(/\r?\n/).length;

  // Evaluate the template literal in an isolated scope with safe placeholder values
  const evaluateHtml = new Function(
    'workerOrigin',
    'GENRE_EMOJIS',
    'MOVIE_GENRES',
    'SERIES_GENRES',
    'PLATFORM_OPTIONS',
    'STUDIO_OPTIONS',
    'ERA_OPTIONS',
    'FSK_OPTIONS',
    'FEATURED_COLLECTIONS',
    'CINEMATIC_UNIVERSES',
    `return ${templateLiteralSource};`
  );
  const renderedHtml = evaluateHtml(
    'https://teleport.example.com',
    {},
    {},
    {},
    [],
    [],
    [],
    [],
    [],
    []
  );

  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptCount = 0;

  while ((match = scriptRegex.exec(renderedHtml)) !== null) {
    const scriptContent = match[1];
    if (!scriptContent || !scriptContent.trim()) continue;
    scriptCount++;

    const scriptOffsetLines = renderedHtml
      .slice(0, match.index)
      .split(/\r?\n/).length;

    try {
      await transform(scriptContent, {
        loader: 'js',
        target: 'es2022',
        sourcefile: 'tma-inline-script.js',
        logLevel: 'silent',
      });
      new Function(scriptContent);
    } catch (err) {
      const errLineInScript = err?.errors?.[0]?.location?.line || 1;
      const approxWorkerLine =
        templateStartLineInWorker + scriptOffsetLines + errLineInScript - 2;
      const mapped = resolveModuleLocation(moduleMap, approxWorkerLine);
      const locationStr = mapped
        ? `worker-modules/${mapped.file}:${mapped.moduleLine} (worker.js:${approxWorkerLine})`
        : `worker.js:${approxWorkerLine}`;
      throw new Error(
        `[TMA Inline-Script SyntaxError] ${err.message} near ${locationStr}`
      );
    }
  }

  return { scriptCount };
}

async function verifyAndAssembleWorker() {
  if (fs.existsSync(publicWorkerPath)) {
    fs.rmSync(publicWorkerPath, { force: true });
  }

  // Ensure bun.lock remains compatible with Cloudflare Workers CI (bun@1.2.15 requires lockfileVersion: 1)
  const bunLockPath = path.join(rootDir, 'bun.lock');
  if (fs.existsSync(bunLockPath)) {
    const rawLock = fs.readFileSync(bunLockPath, 'utf8');
    if (rawLock.includes('"lockfileVersion": 2')) {
      const normalizedLock = rawLock
        .replace('"lockfileVersion": 2,', '"lockfileVersion": 1,')
        .replace(/^\s*"configVersion":\s*\d+,\r?\n/m, '');
      fs.writeFileSync(bunLockPath, normalizedLock, 'utf8');
    }
  }

  // 1. Pre-assembly static analysis on individual files in worker-modules/
  const staticReport = runPreAssemblyModuleStaticAnalysis();
  if (staticReport.warnings.length > 0) {
    console.warn(
      `[Pre-Build Static Analysis] ${staticReport.warnings.length} Hinweis(e) in worker-modules/ gefunden:`
    );
    for (const w of staticReport.warnings) {
      console.warn(
        `  ⚠️ worker-modules/${w.file}:${w.line}:${w.column} [${w.rule}] ${w.message}\n     -> ${w.snippet}`
      );
    }
  }

  if (staticReport.errors.length > 0) {
    console.error(
      `[Pre-Build Static Analysis] ${staticReport.errors.length} kritische(r) Fehler vor dem Zusammensetzen in worker-modules/ gefunden:`
    );
    for (const e of staticReport.errors) {
      console.error(
        `  ❌ worker-modules/${e.file}:${e.line}:${e.column} [${e.rule}] ${e.message}\n     -> ${e.snippet}`
      );
    }
    process.exit(1);
  }

  // 2. Assemble worker-modules/*.js -> worker.js
  let code = assembleWorkerFromModules();
  if (!code && fs.existsSync(workerPath)) {
    code = fs.readFileSync(workerPath, 'utf8');
  }

  if (!code || code.length < 1000) {
    console.error(
      '[Pre-Build Check] Fehler: Kein gültiger Worker-Code in worker-modules/ oder worker.js gefunden.'
    );
    process.exit(1);
  }

  // Auf Cloudflare Build CI die vollständige/slim worker.js erst nach Verifikation schreiben; in AI Studio als kompakten Stub belassen (verhindert GitHub Sync >1MB Limit)
  const isAiStudioWorkspace =
    (process.env.DISABLE_HMR === 'true' ||
      fs.existsSync('/.aistudio') ||
      fs.existsSync(path.join(rootDir, '.aistudio'))) &&
    !process.argv.includes('--write-full');
  if (isAiStudioWorkspace) {
    const stub =
      '// Auto-assembled at build time from /worker-modules/*.js via scripts/prebuild-worker-check.mjs\nexport default { async fetch() { return new Response("Assembled at build time"); } };\n';
    fs.writeFileSync(workerPath, stub, 'utf8');
  } else {
    fs.writeFileSync(workerPath, code, 'utf8');
  }

  // 3. Full esbuild bundle & syntax check with module line mapping
  const result = await build({
    stdin: {
      contents: code,
      resolveDir: rootDir,
      sourcefile: 'worker.js',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    external: ['node:async_hooks'],
    write: false,
    logLevel: 'silent',
  }).catch((err) => err);

  const buildWarnings = result.warnings || [];
  const buildErrors = result.errors || [];

  for (const w of buildWarnings) {
    const line = w.location?.line || 0;
    const mapped = resolveModuleLocation(staticReport.moduleMap, line);
    const locLabel = mapped
      ? `worker-modules/${mapped.file}:${mapped.moduleLine}`
      : `worker.js:${line}`;
    console.warn(
      `  ⚠️ [esbuild] ${locLabel}: ${w.text}\n     -> ${w.location?.lineText || ''}`
    );
  }

  if (buildErrors.length > 0) {
    console.error('[Pre-Build Check] esbuild meldet Fehler in worker-modules/:');
    for (const e of buildErrors) {
      const line = e.location?.line || 0;
      const mapped = resolveModuleLocation(staticReport.moduleMap, line);
      const locLabel = mapped
        ? `worker-modules/${mapped.file}:${mapped.moduleLine}`
        : `worker.js:${line}`;
      console.error(
        `  ❌ [esbuild] ${locLabel}: ${e.text}\n     -> ${e.location?.lineText || ''}`
      );
    }
    process.exit(1);
  }

  // 4. Verify embedded Mini-App HTML <script> blocks for client-side regex/syntax validity
  const tmaScriptCheck = await verifyEmbeddedMiniAppScripts(
    code,
    staticReport.moduleMap
  );

  // 5. Dry-run verify static TMA CSS/JS extraction, minification & slim worker syntax
  const extracted = await extractStaticTmaAssets(code, { minify: true });
  const slimCheck = await build({
    stdin: {
      contents: extracted.slimWorkerCode,
      resolveDir: rootDir,
      sourcefile: 'worker-slim.js',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    external: ['node:async_hooks'],
    write: false,
    logLevel: 'silent',
  }).catch((err) => err);
  if (slimCheck.errors && slimCheck.errors.length > 0) {
    console.error('[Pre-Build Check] Slim-Worker nach Static-Asset-Extraktion fehlerhaft:');
    for (const e of slimCheck.errors) {
      console.error(`  ❌ [esbuild slim] ${e.text}`);
    }
    process.exit(1);
  }
  for (const asset of extracted.assets) {
    if (asset.type === 'js') {
      try {
        new Function(asset.content);
      } catch (err) {
        console.error(`[Pre-Build Check] Extrahiertes JS-Asset ${asset.fileName} hat einen Syntaxfehler:`, err.message);
        process.exit(1);
      }
    }
  }
  const { stats } = extracted;

  console.log(
    `[Pre-Build Check] Statische Analyse für ${staticReport.moduleMap.length} Module in worker-modules/ bestanden (0 Fehler, ${staticReport.warnings.length + buildWarnings.length} Warnungen, ${tmaScriptCheck.scriptCount} eingebettete TMA-Skripte verifiziert).`
  );
  console.log(
    `[Pre-Build Check] Static Asset Offload verifiziert: worker.js ${(stats.originalWorkerBytes / 1024).toFixed(1)} KB -> ${(stats.slimWorkerBytes / 1024).toFixed(1)} KB (-${stats.savedPercent}%) | ${stats.cssFileName} (${(stats.cssBytes / 1024).toFixed(1)} KB, roh ${(stats.cssRawBytes / 1024).toFixed(1)} KB) | ${stats.jsFileName} (${(stats.jsBytes / 1024).toFixed(1)} KB, roh ${(stats.jsRawBytes / 1024).toFixed(1)} KB) | ${stats.adminJsFileName} (${(stats.adminJsBytes / 1024).toFixed(1)} KB, roh ${(stats.adminJsRawBytes / 1024).toFixed(1)} KB).`
  );
}

verifyAndAssembleWorker().catch((err) => {
  console.error('[Pre-Build Check] Validierung fehlgeschlagen:', err);
  process.exit(1);
});
