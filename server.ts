// PSE Tracker — local-only dashboard server.
// Serves the dashboard, the API from handler.ts, and saves the layout / positions in data/state.json.

import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import { handleApi } from './handler.ts';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
// Localhost only by default. Set HOST=0.0.0.0 to open it to your home network.
const HOST = process.env.HOST || '127.0.0.1';
const STATE_FILE = path.join(ROOT, 'data', 'state.json');

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json' };
// Compiled browser code lives in dist/js (npm run build); everything else is served as-is.
const STATIC: [string, string][] = [
  ['/js/', path.join(ROOT, 'dist/js/')],
  ['/vendor/gridstack/', path.join(ROOT, 'node_modules/gridstack/dist/')],
  ['/vendor/lightweight-charts/', path.join(ROOT, 'node_modules/lightweight-charts/dist/')],
  ['/', path.join(ROOT, 'public/')],
];

function notFound(res: ServerResponse, status = 404, error = 'Not found'): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error }));
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    const rel = pathname.slice(prefix.length) || 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) return notFound(res, 403, 'Forbidden');
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      return void res.end(body);
    } catch {
      return notFound(res);
    }
  }
  notFound(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url, { stateFile: STATE_FILE });
  return serveStatic(res, url.pathname);
});

server.listen(PORT, HOST, () => {
  if (!existsSync(path.join(ROOT, 'dist/js/main.js'))) console.warn('dist/js is missing: run `npm run build` first, or the page will not load.');
  console.log(`PSE Tracker running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') console.log('Listening on all interfaces — reachable from your local network.');
});
