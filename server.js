// PSE Tracker — local-only dashboard server.
// Proxies Philippine Stock Exchange data (phisix API + PSE Edge) and stores
// the dashboard layout / positions in data/state.json.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNews } from './news.js';
import { parseCompanyProfile, parseIndices, findSecurityId, parseStockDetail, normaliseCandles } from './parsers.js';
import { validateState } from './state.js';
import { pickCandidates, windowReturns } from './performance.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
// Localhost only by default. Set HOST=0.0.0.0 to open it to your home network.
const HOST = process.env.HOST || '127.0.0.1';
const STATE_FILE = path.join(ROOT, 'data', 'state.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const PHISIX = 'https://phisix-api3.appspot.com/stocks.json';
const EDGE = 'https://edge.pse.com.ph';

// ---------- tiny cache ----------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  try {
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    // Serve stale data rather than nothing when an upstream hiccups.
    if (hit) return { ...hit.value, stale: true };
    throw err;
  }
}

async function get(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res;
}

// ---------- data sources ----------
async function getStocks() {
  return cached('stocks', 8_000, async () => {
    const data = await (await get(PHISIX)).json();
    const stocks = data.stocks.map((s) => ({
      symbol: s.symbol,
      name: s.name.replace(/``/g, '"'),
      price: s.price.amount,
      change: s.percentChange,
      volume: s.volume,
    }));
    return { asOf: data.as_of, fetchedAt: new Date().toISOString(), stocks };
  });
}

async function getIndices() {
  return cached('indices', 12_000, async () => {
    const html = await (await get(`${EDGE}/index/form.do`)).text();
    return parseIndices(html);
  });
}

// symbol -> { cmpyId, securityId }
const ids = new Map();
async function resolveIds(symbol) {
  if (ids.has(symbol)) return ids.get(symbol);
  // Preferred shares (e.g. JFCPA) are listed under the parent company (JFC), so if the
  // full symbol finds nothing, retry with shorter prefixes.
  for (let len = symbol.length; len >= 2; len--) {
    const term = symbol.slice(0, len);
    const res = await get(`${EDGE}/autoComplete/searchCompanyNameSymbol.ax?term=${encodeURIComponent(term)}`, { method: 'POST' });
    const list = await res.json();
    const candidates = [list.find((c) => c.symbol === symbol), list.find((c) => c.symbol === term)].filter(Boolean);
    for (const match of candidates) {
      const page = await (await get(`${EDGE}/companyPage/stockData.do?cmpy_id=${match.cmpyId}`)).text();
      const securityId = findSecurityId(page, symbol);
      if (!securityId && match.symbol !== symbol) continue;
      const value = { cmpyId: match.cmpyId, securityId, company: match.cmpyNm };
      ids.set(symbol, value);
      return value;
    }
  }
  throw new Error(`Unknown symbol ${symbol}`);
}

async function getStockDetail(symbol) {
  return cached(`detail:${symbol}`, 60_000, async () => {
    const { cmpyId, securityId, company } = await resolveIds(symbol);
    const qs = `cmpy_id=${cmpyId}${securityId ? `&security_id=${securityId}` : ''}`;
    const html = await (await get(`${EDGE}/companyPage/stockData.do?${qs}`)).text();
    return {
      symbol,
      company,
      ...parseStockDetail(html, symbol),
      edgeUrl: `${EDGE}/companyPage/stockData.do?${qs}`,
    };
  });
}

async function getCompanyProfile(symbol) {
  return cached(`profile:${symbol}`, 6 * 3_600_000, async () => {
    const { cmpyId, company } = await resolveIds(symbol);
    const html = await (await get(`${EDGE}/companyInformation/form.do?cmpy_id=${cmpyId}`)).text();
    return { symbol, company, ...parseCompanyProfile(html), edgeUrl: `${EDGE}/companyInformation/form.do?cmpy_id=${cmpyId}` };
  });
}

const RANGE_DAYS = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, '3Y': 1096, '5Y': 1827 };
const mdy = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;

async function getHistory(symbol, range) {
  const days = RANGE_DAYS[range] || RANGE_DAYS['6M'];
  return cached(`hist:${symbol}:${range}`, 5 * 60_000, async () => {
    const { cmpyId, securityId } = await resolveIds(symbol);
    if (!securityId) throw new Error(`No security id for ${symbol}`);
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    const res = await get(`${EDGE}/common/DisclosureCht.ax`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmpy_id: cmpyId, security_id: securityId, startDate: mdy(start), endDate: mdy(end) }),
    });
    const { chartData = [] } = await res.json();
    const candles = normaliseCandles(chartData);
    return { symbol, range, candles };
  });
}

// ---------- performance ranking ----------
// Fetching history for dozens of stocks takes a while, so it runs in the background and the
// widget polls for progress. Results are kept for an hour.
const PERF_TTL = 3_600_000;
const perf = { state: 'idle', at: 0, done: 0, total: 0, results: [], error: null };

async function runPerformance() {
  perf.state = 'running';
  perf.done = 0;
  perf.error = null;
  try {
    const { stocks } = await getStocks();
    const symbols = pickCandidates(stocks);
    perf.total = symbols.length;
    const results = [];
    const queue = [...symbols];
    const worker = async () => {
      while (queue.length) {
        const symbol = queue.shift();
        try {
          const { candles } = await getHistory(symbol, '6M');
          const r = windowReturns(candles);
          const s = stocks.find((x) => x.symbol === symbol);
          if (r) results.push({ symbol, name: s?.name || symbol, ...r });
        } catch (err) {
          console.error('performance', symbol, err.message);
        }
        perf.done++;
      }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
    perf.results = results;
    perf.at = Date.now();
    perf.state = results.length ? 'ready' : 'idle';
    if (!results.length) perf.error = 'No price history could be loaded';
  } catch (err) {
    perf.state = 'idle';
    perf.error = err.message;
  }
}

function performanceSnapshot() {
  if (perf.state !== 'running' && Date.now() - perf.at > PERF_TTL) runPerformance();
  return { state: perf.state, done: perf.done, total: perf.total, results: perf.state === 'running' && !perf.results.length ? [] : perf.results, asOf: perf.at ? new Date(perf.at).toISOString() : null, error: perf.error };
}

// ---------- state ----------
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return null; }
}
async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, STATE_FILE);
}

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json' };
const STATIC = [
  ['/vendor/gridstack/', path.join(ROOT, 'node_modules/gridstack/dist/')],
  ['/vendor/lightweight-charts/', path.join(ROOT, 'node_modules/lightweight-charts/dist/')],
  ['/', path.join(ROOT, 'public/')],
];

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    let rel = pathname.slice(prefix.length) || 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) return send(res, 403, { error: 'Forbidden' });
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      return res.end(body);
    } catch {
      return send(res, 404, { error: 'Not found' });
    }
  }
}

// Browsers send Origin on cross-site writes; refuse any that isn't this server's own page.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const SYMBOL_RE = /^[A-Z0-9]{1,12}$/;

async function readBody(req, limit = 2_000_000) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw Object.assign(new Error('Too large'), { status: 413 });
  }
  return body;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    if (p === '/api/stocks') return send(res, 200, await getStocks());
    if (p === '/api/indices') return send(res, 200, await getIndices());
    if (p === '/api/performance') return send(res, 200, performanceSnapshot());
    if (p === '/api/news') return send(res, 200, await cached('news', 5 * 60_000, () => getNews(getStocks)));
    let m;
    if ((m = p.match(/^\/api\/stock\/([^/]+)$/))) {
      const sym = decodeURIComponent(m[1]).toUpperCase();
      if (!SYMBOL_RE.test(sym)) return send(res, 400, { error: 'Bad symbol' });
      return send(res, 200, await getStockDetail(sym));
    }
    if ((m = p.match(/^\/api\/company\/([^/]+)$/))) {
      const sym = decodeURIComponent(m[1]).toUpperCase();
      if (!SYMBOL_RE.test(sym)) return send(res, 400, { error: 'Bad symbol' });
      return send(res, 200, await getCompanyProfile(sym));
    }
    if ((m = p.match(/^\/api\/history\/([^/]+)$/))) {
      const sym = decodeURIComponent(m[1]).toUpperCase();
      if (!SYMBOL_RE.test(sym)) return send(res, 400, { error: 'Bad symbol' });
      return send(res, 200, await getHistory(sym, url.searchParams.get('range') || '6M'));
    }
    if (p === '/api/state') {
      if (req.method === 'GET') return send(res, 200, (await readState()) || {});
      if (req.method === 'PUT') {
        if (!sameOrigin(req)) return send(res, 403, { error: 'Cross-origin write refused' });
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
        await writeState(validateState(body));
        return send(res, 200, { ok: true });
      }
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    return serveStatic(req, res, p);
  } catch (err) {
    console.error(p, err.message);
    return send(res, err.status || 502, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PSE Tracker running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') console.log('Listening on all interfaces — reachable from your local network.');
});
