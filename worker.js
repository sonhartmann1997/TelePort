// [CLOUDFLARE WORKER REPO STUB]
// Full worker source is modularized into ./worker-modules/*.js (< 300 KB per file)
// and automatically assembled into ./worker.js during `bun run build` / `vite build`.
export default {
  async fetch() {
    return new Response("Worker stub: Run `bun run build` before deploying.", { status: 500 });
  }
};
