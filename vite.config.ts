import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, Plugin} from 'vite';
import {extractStaticTmaAssets} from './scripts/build-worker.mjs';

const rootDir = import.meta.dirname || path.resolve();
const modulesDir = path.resolve(rootDir, 'worker-modules');
const workerFile = path.resolve(rootDir, 'worker.js');

const WORKER_REPO_STUB = `// Auto-assembled from ./worker-modules/*.js during 'vite build' (bun run build / npm run build)
// See ./worker-modules/ for the 19 modular worker files.
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
  const combined =
    files
      .map((f) => fs.readFileSync(path.join(modulesDir, f), 'utf8').trimEnd())
      .join('\n\n') + '\n';

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
      if (process.env.DISABLE_HMR === 'true') {
        // Inside AI Studio VFS, keep worker.js as a tiny <1KB stub so GitHub Sync never hits the 2MB single-file limit
        fs.writeFileSync(workerFile, WORKER_REPO_STUB, 'utf8');
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
    async closeBundle() {
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

      // Extract & minify static TMA CSS/JS into dist/assets/ and emit SLIM worker.js (~55%+ kleiner!)
      const assembled = assembleWorkerFromModulesSync();
      if (assembled) {
        const {slimWorkerCode, assets, stats} = await extractStaticTmaAssets(assembled, {
          minify: true,
        });
        const distAssetsDir = path.join(distDir, 'assets');
        fs.mkdirSync(distAssetsDir, {recursive: true});
        for (const asset of assets) {
          fs.writeFileSync(path.join(distAssetsDir, asset.fileName), asset.content, 'utf8');
        }
        fs.writeFileSync(workerFile, slimWorkerCode, 'utf8');
        console.log(
          `[Cloudflare Static Asset Offload] Slim worker.js: ${(stats.slimWorkerBytes / 1024).toFixed(1)} KB (vorher ${(stats.originalWorkerBytes / 1024).toFixed(1)} KB, -${stats.savedPercent}%) | Assets: ${stats.cssFileName} (${(stats.cssBytes / 1024).toFixed(1)} KB), ${stats.jsFileName} (${(stats.jsBytes / 1024).toFixed(1)} KB), ${stats.adminJsFileName} (${(stats.adminJsBytes / 1024).toFixed(1)} KB)`
        );
      }

      fs.writeFileSync(
        path.join(distDir, '_headers'),
        '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/favicon.svg\n  Cache-Control: public, max-age=86400\n\n/manifest.json\n  Cache-Control: public, max-age=86400\n\n/sw.js\n  Cache-Control: no-cache, no-store, must-revalidate\n  Service-Worker-Allowed: /\n',
        'utf8'
      );
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
