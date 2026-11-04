import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const rootDir = process.cwd();
const workerPath = path.join(rootDir, 'worker.js');
const publicWorkerPath = path.join(rootDir, 'public', 'worker.js');

async function verifyWorker() {
  if (!fs.existsSync(workerPath)) {
    console.error('[Pre-Build Check] Fehler: worker.js nicht im Projekt-Root gefunden.');
    process.exit(1);
  }

  // Entferne evtl. doppelte Kopie in public/worker.js, damit GitHub-Sync schlank bleibt
  if (fs.existsSync(publicWorkerPath)) {
    fs.rmSync(publicWorkerPath, { force: true });
  }

  // Automatische Selbstheilung für bekannte Wrangler/esbuild Fallstricke
  let code = fs.readFileSync(workerPath, 'utf8');
  let patched = false;

  if (code.includes('" - viii -": " - 8 -", " viii ": " 8 "')) {
    code = code.replace('" - viii -": " - 8 -", " viii ": " 8 "', '" - viii -": " - 8 -"');
    patched = true;
  }
  if (
    code.includes('async function enrichSavedListWithD1EpisodesAndPosters(env, chatId, rawItems = null) {\n    const list =') ||
    code.includes('list = validFilteredList;')
  ) {
    code = code
      .replace(
        'async function enrichSavedListWithD1EpisodesAndPosters(env, chatId, rawItems = null) {\n    const list =',
        'async function enrichSavedListWithD1EpisodesAndPosters(env, chatId, rawItems = null) {\n    let list ='
      )
      .replace('list = validFilteredList;\n      changed = true;', 'changed = true;');
    patched = true;
  }

  if (patched) {
    fs.writeFileSync(workerPath, code, 'utf8');
    console.log('[Pre-Build Check] worker.js automatisch für Wrangler/esbuild bereinigt.');
  }

  const result = await build({
    entryPoints: [workerPath],
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
    `[Pre-Build Check] worker.js erfolgreich mit esbuild (ESM) geprüft (${result.warnings.length} Warnungen).`
  );
}

verifyWorker().catch((err) => {
  console.error('[Pre-Build Check] Validierung fehlgeschlagen:', err);
  process.exit(1);
});
