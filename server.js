// PSE Tracker — local-only dashboard server.
// Proxies Philippine Stock Exchange data (phisix API + PSE Edge) and stores
// the dashboard layout / positions in data/state.json.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNews } from './news.js';

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

const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const num = (s) => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// ---------- data sources ----------
async function getStocks() {
  return cached('stocks', 20_000, async () => {
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
  return cached('indices', 30_000, async () => {
    const html = await (await get(`${EDGE}/index/form.do`)).text();
    const asOf = (html.match(/As of ([^<]+)<\/th>/) || [])[1]?.trim() || null;
    const rows = [...html.matchAll(/<td class="label">([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td([^>]*)>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>/g)];
    const indices = rows.map(([, name, value, attrs, chg, pct]) => {
      const sign = /color:\s*red/.test(attrs) || pct.includes('▼') ? -1 : 1;
      return {
        name: name.trim(),
        value: num(value),
        change: sign * Math.abs(num(chg) ?? 0),
        percent: sign * Math.abs(num(pct) ?? 0),
      };
    });
    if (!indices.length) throw new Error('Could not parse PSE index table');
    return { asOf, indices };
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
      const opt = [...page.matchAll(/<option value="(\d+)"[^>]*>\s*([^<\s]+)/g)].find(([, , sym]) => sym === symbol);
      if (!opt && match.symbol !== symbol) continue;
      const value = { cmpyId: match.cmpyId, securityId: opt ? opt[1] : null, company: match.cmpyNm };
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
    const fields = {};
    for (const [, k, v] of html.matchAll(/<th>([^<]+)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) fields[text(k)] = text(v);
    const prev = fields['Previous Close and Date'] || '';
    return {
      symbol,
      company,
      status: fields['Status'] || null,
      boardLot: num(fields['Board Lot']),
      last: num(fields['Last Traded Price']),
      open: num(fields['Open']),
      high: num(fields['High']),
      low: num(fields['Low']),
      prevClose: num(prev.split(' ')[0]),
      prevCloseDate: (prev.match(/\(([^)]+)\)/) || [])[1] || null,
      change: fields['Change(% Change)'] || null,
      volume: num(fields['Volume']),
      value: num(fields['Value']),
      avgPrice: num(fields['Average Price']),
      week52High: num(fields['52-Week High']),
      week52Low: num(fields['52-Week Low']),
      pe: num(fields['P/E Ratio']),
      sectorPe: num(fields['Sector P/E Ratio']),
      bookValue: num(fields['Book Value']),
      pbv: num(fields['P/BV Ratio']),
      marketCap: num(fields['Market Capitalization']),
      outstanding: num(fields['Outstanding Shares']),
      freeFloat: num(fields['Free Float Level(%)']),
      listingDate: fields['Listing Date'] || null,
      edgeUrl: `${EDGE}/companyPage/stockData.do?${qs}`,
    };
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
    // PSE Edge sometimes repeats a day; the chart needs unique, ascending dates.
    const byDay = new Map();
    for (const c of chartData) {
      if (![c.OPEN, c.HIGH, c.LOW, c.CLOSE].every(Number.isFinite)) continue;
      const d = new Date(c.CHART_DATE.replace(' 00:00:00', ''));
      const time = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      byDay.set(time, { time, open: c.OPEN, high: c.HIGH, low: c.LOW, close: c.CLOSE, value: c.VALUE });
    }
    const candles = [...byDay.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
    return { symbol, range, candles };
  });
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
    if (p === '/api/news') return send(res, 200, await cached('news', 5 * 60_000, () => getNews(getStocks)));
    let m;
    if ((m = p.match(/^\/api\/stock\/([^/]+)$/))) {
      const sym = decodeURIComponent(m[1]).toUpperCase();
      if (!SYMBOL_RE.test(sym)) return send(res, 400, { error: 'Bad symbol' });
      return send(res, 200, await getStockDetail(sym));
    }
    if ((m = p.match(/^\/api\/history\/([^/]+)$/))) {
      const sym = decodeURIComponent(m[1]).toUpperCase();
      if (!SYMBOL_RE.test(sym)) return send(res, 400, { error: 'Bad symbol' });
      return send(res, 200, await getHistory(sym, url.searchParams.get('range') || '6M'));
    }
    if (p === '/api/state') {
      if (req.method === 'GET') return send(res, 200, (await readState()) || {});
      if (req.method === 'PUT') {
        await writeState(JSON.parse(await readBody(req)));
        return send(res, 200, { ok: true });
      }
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    return serveStatic(req, res, p);
  } catch (err) {
    console.error(p, err.message);
    return send(res, 502, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PSE Tracker running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') console.log('Listening on all interfaces — reachable from your local network.');
});
