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
