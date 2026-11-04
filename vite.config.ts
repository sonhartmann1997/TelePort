import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

const rootDir = import.meta.dirname || path.resolve();
const modulesDir = path.resolve(rootDir, 'worker-modules');
const workerFile = path.resolve(rootDir, 'worker.js');

const WORKER_REPO_STUB = `// Auto-assembled from ./worker-modules/*.js during 'vite build' (bun run build / npm run build)
// See ./worker-modules/ for the 9 modular departments.
export default {
  async fetch() {
    return new Response("Run 'bun run build' or 'npm run build' before deploying.", { status: 200 });
  }
};
`;

function assembleWorkerFromModulesSync(): string | null {
  if (!fs.existsSync(modulesDir)) return null;
  const files = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith('.js'))
    .sort();
  if (files.length === 0) return null;
  let combined =
    files
      .map((f) => fs.readFileSync(path.join(modulesDir, f), 'utf8').trimEnd())
      .join('\n\n') + '\n';

  combined = combined
    .replace('" - viii -": " - 8 -", " viii ": " 8 "', '" - viii -": " - 8 -"')
    .replace(
      'async function enrichSavedListWithD1EpisodesAndPosters(env, chatId, rawItems = null) {\n    const list =',
      'async function enrichSavedListWithD1EpisodesAndPosters(env, chatId, rawItems = null) {\n    let list ='
    )
    .replace('list = validFilteredList;\n      changed = true;', 'changed = true;');

  return combined;
}

function cleanAiStudioAttachments(baseDir: string) {
  const aiStudioDir = path.join(baseDir, 'assets', 'aistudio');
  if (fs.existsSync(aiStudioDir)) {
    fs.rmSync(aiStudioDir, {recursive: true, force: true});
  }
}

function cloudflareStudioPlugin(): Plugin {
  return {
    name: 'cloudflare-studio-plugin',
    buildStart() {
      cleanAiStudioAttachments(path.resolve(rootDir, 'public'));
      const assembled = assembleWorkerFromModulesSync();
      if (assembled) {
        // On Cloudflare Workers Builds (DISABLE_HMR !== 'true'), write full assembled worker.js for npx wrangler deploy!
        if (process.env.DISABLE_HMR !== 'true') {
          fs.writeFileSync(workerFile, assembled, 'utf8');
          console.log(
            `[Cloudflare Assembler] Assembled worker-modules -> worker.js (${(Buffer.byteLength(assembled) / 1024).toFixed(1)} KB)`
          );
        } else {
          // Inside AI Studio VFS, keep worker.js as a tiny <1KB stub so GitHub Sync never hits the 2MB single-file limit
          fs.writeFileSync(workerFile, WORKER_REPO_STUB, 'utf8');
        }
      }
    },
    configureServer(server) {
      cleanAiStudioAttachments(path.resolve(rootDir, 'public'));
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0] === '/worker.js') {
          const assembled = assembleWorkerFromModulesSync();
          if (assembled) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(assembled);
            return;
          }
          if (fs.existsSync(workerFile)) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            fs.createReadStream(workerFile).pipe(res);
            return;
          }
        }
        next();
      });
    },
    closeBundle() {
      const distDir = path.resolve(rootDir, 'dist');
      if (process.env.DISABLE_HMR === 'true') {
        // Keep AI Studio VFS clean of /dist so GitHub Sync only uploads source files (< 400 KB each)
        if (fs.existsSync(distDir)) {
          fs.rmSync(distDir, {recursive: true, force: true});
        }
        fs.writeFileSync(workerFile, WORKER_REPO_STUB, 'utf8');
        return;
      }
      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, {recursive: true});
      }
      cleanAiStudioAttachments(distDir);
      const distWorkerCopy = path.join(distDir, 'worker.js');
      if (fs.existsSync(distWorkerCopy)) {
        fs.rmSync(distWorkerCopy, {force: true});
      }
      fs.writeFileSync(
        path.join(distDir, '.assetsignore'),
        'aistudio\naistudio/**\nassets/aistudio\nassets/aistudio/**\n*.zip\n*.rar\n*.tar.gz\n',
        'utf8'
      );
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), cloudflareStudioPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'vendor-react',
                test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                priority: 20,
              },
              {
                name: 'vendor-icons',
                test: /node_modules[\\/]lucide-react[\\/]/,
                priority: 15,
              },
              {
                name: 'vendor-zip',
                test: /node_modules[\\/]jszip[\\/]/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
