import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

const rootDir = import.meta.dirname || path.resolve();

function cloudflareAssetsSanitizerPlugin(): Plugin {
  return {
    name: 'cloudflare-assets-sanitizer',
    closeBundle() {
      const distDir = path.resolve(rootDir, 'dist');
      if (!fs.existsSync(distDir)) return;

      // 1. Remove AI Studio chat attachment directory from dist if present
      const aiStudioAssetsDir = path.join(distDir, 'assets', 'aistudio');
      if (fs.existsSync(aiStudioAssetsDir)) {
        fs.rmSync(aiStudioAssetsDir, {recursive: true, force: true});
      }

      // 2. Remove any .zip / .rar / .tar.gz or file > 24 MiB (Cloudflare Workers 25 MiB limit)
      const MAX_CF_ASSET_BYTES = 24 * 1024 * 1024;
      const walkAndClean = (dir: string) => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'aistudio') {
              fs.rmSync(fullPath, {recursive: true, force: true});
            } else {
              walkAndClean(fullPath);
            }
          } else {
            const lower = entry.name.toLowerCase();
            const stat = fs.statSync(fullPath);
            if (
              lower.endsWith('.zip') ||
              lower.endsWith('.rar') ||
              lower.endsWith('.7z') ||
              lower.endsWith('.tar.gz') ||
              stat.size > MAX_CF_ASSET_BYTES
            ) {
              fs.rmSync(fullPath, {force: true});
            }
          }
        }
      };
      walkAndClean(distDir);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), cloudflareAssetsSanitizerPlugin()],
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

