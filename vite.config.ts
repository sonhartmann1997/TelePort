import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

const rootDir = import.meta.dirname || path.resolve();

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
      // Keep public/ free of large chat attachments so GitHub sync stays fast & lightweight
      cleanAiStudioAttachments(path.resolve(rootDir, 'public'));
    },
    configureServer(server) {
      cleanAiStudioAttachments(path.resolve(rootDir, 'public'));
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0] === '/worker.js') {
          const workerFile = path.resolve(rootDir, 'worker.js');
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
