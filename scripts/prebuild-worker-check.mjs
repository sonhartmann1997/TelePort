import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const rootDir = process.cwd();
const workerPath = path.join(rootDir, 'worker.js');
const publicDir = path.join(rootDir, 'public');
const publicWorkerPath = path.join(publicDir, 'worker.js');

async function verifyAndSyncWorker() {
  if (!fs.existsSync(workerPath)) {
    console.error('[Pre-Build Check] Fehler: worker.js nicht im Projekt-Root gefunden.');
    process.exit(1);
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

  if (fs.existsSync(publicDir)) {
    fs.copyFileSync(workerPath, publicWorkerPath);
  }

  console.log(
    `[Pre-Build Check] worker.js erfolgreich mit esbuild (ESM) geprüft (${result.warnings.length} Warnungen) und nach public/worker.js synchronisiert.`
  );
}

verifyAndSyncWorker().catch((err) => {
  console.error('[Pre-Build Check] Validierung fehlgeschlagen:', err);
  process.exit(1);
});
