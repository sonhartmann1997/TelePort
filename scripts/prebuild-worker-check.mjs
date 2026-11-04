import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { assembleWorkerFromModules } from './build-worker.mjs';

const rootDir = process.cwd();
const workerPath = path.join(rootDir, 'worker.js');
const publicWorkerPath = path.join(rootDir, 'public', 'worker.js');

async function verifyAndAssembleWorker() {
  if (fs.existsSync(publicWorkerPath)) {
    fs.rmSync(publicWorkerPath, { force: true });
  }

  let code = assembleWorkerFromModules();
  if (!code && fs.existsSync(workerPath)) {
    code = fs.readFileSync(workerPath, 'utf8');
  }

  if (!code || code.length < 1000) {
    console.error('[Pre-Build Check] Fehler: Kein gültiger Worker-Code in worker-modules/ oder worker.js gefunden.');
    process.exit(1);
  }

  // Automatische Selbstheilung für bekannte Wrangler/esbuild Fallstricke
  code = code
    .replace('" - viii -": " - 8 -", " viii ": " 8 "', '" - viii -": " - 8 -"')
    .replace(
      'async function enrichSavedListWithD1EpisodesAndPosters(env, chatId, rawItems = null) {\n    const list =',
      'async function enrichSavedListWithD1EpisodesAndPosters(env, chatId, rawItems = null) {\n    let list ='
    )
    .replace('list = validFilteredList;\n      changed = true;', 'changed = true;');

  // Auf Cloudflare / lokalem Build (DISABLE_HMR !== 'true') die vollständige worker.js schreiben
  if (process.env.DISABLE_HMR !== 'true') {
    fs.writeFileSync(workerPath, code, 'utf8');
  }

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
    write: false,
    logLevel: 'warning',
  });

  if (result.errors.length > 0) {
    console.error('[Pre-Build Check] esbuild meldet Fehler in worker.js:');
    process.exit(1);
  }

  console.log(
    `[Pre-Build Check] Worker erfolgreich aus Abteilungs-Modulen zusammengesetzt und mit esbuild geprüft (${result.warnings.length} Warnungen).`
  );
}

verifyAndAssembleWorker().catch((err) => {
  console.error('[Pre-Build Check] Validierung fehlgeschlagen:', err);
  process.exit(1);
});
