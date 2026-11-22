// PSE Tracker API. Proxies Philippine Stock Exchange data (phisix API + PSE Edge) and,
// when given a state file, stores the dashboard layout / positions there.
// Used by server.ts (local) and api/index.js (Vercel serverless).

import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getNews } from './news.ts';
import { parseCompanyProfile, parseIndices, findSecurityId, parseStockDetail, normaliseCandles } from './parsers.ts';
import { validateState } from './state.ts';
import { pickCandidates, windowReturns } from './performance.ts';
import type { Candle, CompanyProfile, PerformanceRow, PerformanceSnapshot, SavedState, Stock, StockDetail } from './public/js/types.ts';

// Anything thrown on purpose with an HTTP status attached.
const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const errStatus = (err: unknown): number => (typeof err === 'object' && err && 'status' in err && typeof err.status === 'number' ? err.status : 502);

// Vercel runs this as short-lived functions: no background work, no writable disk, and a CDN
// in front that we let cache responses.
const SERVERLESS = Boolean(process.env.VERCEL);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const PHISIX = 'https://phisix-api3.appspot.com/stocks.json';
const EDGE = 'https://edge.pse.com.ph';

// ---------- tiny cache ----------
const cache = new Map<string, { at: number; value: object }>();
async function cached<T extends object>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  try {
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    // Serve stale data rather than nothing when an upstream hiccups.
    if (hit) return { ...hit.value, stale: true } as T;
    throw err;
  }
}

async function get(url: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, ...(opts.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res;
}

// ---------- data sources ----------
interface PhisixStock { symbol: string; name: string; price: { amount: number }; percentChange: number; volume: number }
interface StockList { asOf: string; fetchedAt: string; stocks: Stock[] }

async function getStocks(): Promise<StockList> {
  return cached('stocks', 8_000, async () => {
    const data = (await (await get(PHISIX)).json()) as { as_of: string; stocks: PhisixStock[] };
    const stocks: Stock[] = data.stocks.map((s) => ({
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
interface EdgeIds { cmpyId: string; securityId: string | null; company: string }
const ids = new Map<string, EdgeIds>();
async function resolveIds(symbol: string): Promise<EdgeIds> {
  const known = ids.get(symbol);
  if (known) return known;
  // Preferred shares (e.g. JFCPA) are listed under the parent company (JFC), so if the
  // full symbol finds nothing, retry with shorter prefixes.
  for (let len = symbol.length; len >= 2; len--) {
    const term = symbol.slice(0, len);
    const res = await get(`${EDGE}/autoComplete/searchCompanyNameSymbol.ax?term=${encodeURIComponent(term)}`, { method: 'POST' });
    const list = (await res.json()) as { cmpyId: string; cmpyNm: string; symbol: string }[];
    const candidates = [list.find((c) => c.symbol === symbol), list.find((c) => c.symbol === term)].filter((c) => c !== undefined);
    for (const match of candidates) {
      const page = await (await get(`${EDGE}/companyPage/stockData.do?cmpy_id=${match.cmpyId}`)).text();
      const securityId = findSecurityId(page, symbol);
      if (!securityId && match.symbol !== symbol) continue;
      const value: EdgeIds = { cmpyId: match.cmpyId, securityId, company: match.cmpyNm };
      ids.set(symbol, value);
      return value;
    }
  }
  throw new Error(`Unknown symbol ${symbol}`);
}

async function getStockDetail(symbol: string): Promise<StockDetail> {
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

async function getCompanyProfile(symbol: string): Promise<CompanyProfile> {
  return cached(`profile:${symbol}`, 6 * 3_600_000, async () => {
    const { cmpyId, company } = await resolveIds(symbol);
    const html = await (await get(`${EDGE}/companyInformation/form.do?cmpy_id=${cmpyId}`)).text();
    return { symbol, company, ...parseCompanyProfile(html), edgeUrl: `${EDGE}/companyInformation/form.do?cmpy_id=${cmpyId}` };
  });
}

const RANGE_DAYS: Record<string, number> = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, '3Y': 1096, '5Y': 1827 };
const mdy = (d: Date): string => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;

async function getHistory(symbol: string, range: string): Promise<{ symbol: string; range: string; candles: Candle[] }> {
  const days = RANGE_DAYS[range] ?? RANGE_DAYS['6M']!;
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
    const { chartData = [] } = (await res.json()) as { chartData?: Parameters<typeof normaliseCandles>[0] };
    const candles = normaliseCandles(chartData);
    return { symbol, range, candles };
  });
}

// ---------- performance ranking ----------
// Fetching history for dozens of stocks takes a while, so it runs in the background and the
// widget polls for progress. Results are kept for an hour.
const PERF_TTL = 3_600_000;
const PERF_COUNT = SERVERLESS ? 30 : 40;
const PERF_WORKERS = SERVERLESS ? 8 : 5;
const perf: { state: PerformanceSnapshot['state']; at: number; done: number; total: number; results: PerformanceRow[]; error: string | null } = {
  state: 'idle', at: 0, done: 0, total: 0, results: [], error: null,
};

let perfRun: Promise<void> | null = null;

async function runPerformance(): Promise<void> {
  perf.state = 'running';
  perf.done = 0;
  perf.error = null;
  try {
    const { stocks } = await getStocks();
    const symbols = pickCandidates(stocks, PERF_COUNT);
    perf.total = symbols.length;
    const results: PerformanceRow[] = [];
    const queue = [...symbols];
    const worker = async () => {
      while (queue.length) {
        const symbol = queue.shift()!;
        try {
          const { candles } = await getHistory(symbol, '6M');
          const r = windowReturns(candles);
          const s = stocks.find((x) => x.symbol === symbol);
          if (r) results.push({ symbol, name: s?.name || symbol, ...r });
        } catch (err) {
          console.error('performance', symbol, errMessage(err));
        }
        perf.done++;
      }
    };
    await Promise.all(Array.from({ length: PERF_WORKERS }, worker));
    perf.results = results;
    perf.at = Date.now();
    perf.state = results.length ? 'ready' : 'idle';
    if (!results.length) perf.error = 'No price history could be loaded';
  } catch (err) {
    perf.state = 'idle';
    perf.error = errMessage(err);
  }
}

// Locally the ranking builds in the background and the widget polls for progress. A serverless
// function can't keep working after it responds, so there the request waits for the result
// (the CDN then caches it for an hour).
async function performanceSnapshot(wait: boolean): Promise<PerformanceSnapshot> {
  if (!perfRun && Date.now() - perf.at > PERF_TTL) perfRun = runPerformance().finally(() => { perfRun = null; });
  if (wait && perfRun) await perfRun;
  return { state: perf.state, done: perf.done, total: perf.total, results: perf.state === 'running' && !perf.results.length ? [] : perf.results, asOf: perf.at ? new Date(perf.at).toISOString() : null, error: perf.error };
}

// ---------- state ----------
async function readState(file: string): Promise<SavedState | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}
async function writeState(file: string, state: SavedState): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, file);
}

// ---------- http ----------
// `cacheSeconds` lets the Vercel CDN reuse a response, so many visitors share one upstream fetch.
function send(res: ServerResponse, status: number, body: unknown, cacheSeconds = 0): void {
  const cache = SERVERLESS && status === 200 && cacheSeconds > 0
    ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}`
    : 'no-store';
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': cache });
  res.end(JSON.stringify(body));
}

// Browsers send Origin on cross-site writes; refuse any that isn't this server's own page.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const SYMBOL_RE = /^[A-Z0-9]{1,12}$/;

async function readBody(req: IncomingMessage, limit = 2_000_000): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw Object.assign(new Error('Too large'), { status: 413 });
  }
  return body;
}

export interface ApiOptions {
  /** Where to keep the saved dashboard. Without one (hosted), the browser keeps it instead. */
  stateFile?: string;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, { stateFile }: ApiOptions = {}): Promise<void> {
  const p = url.pathname;
  try {
    if (p === '/api/stocks') return send(res, 200, await getStocks(), 8);
    if (p === '/api/indices') return send(res, 200, await getIndices(), 12);
    if (p === '/api/performance') return send(res, 200, await performanceSnapshot(SERVERLESS), 3600);
    if (p === '/api/news') return send(res, 200, await cached('news', 5 * 60_000, () => getNews(getStocks)), 300);
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^\/api\/stock\/([^/]+)$/))) {
      const sym = decodeURIComponent(m[1]!).toUpperCase();
      if (!SYMBOL_RE.test(sym)) return send(res, 400, { error: 'Bad symbol' });
      return send(res, 200, await getStockDetail(sym), 60);
    }
    if ((m = p.match(/^\/api\/company\/([^/]+)$/))) {
      const sym = decodeURIComponent(m[1]!).toUpperCase();
      if (!SYMBOL_RE.test(sym)) return send(res, 400, { error: 'Bad symbol' });
      return send(res, 200, await getCompanyProfile(sym), 3600);
    }
    if ((m = p.match(/^\/api\/history\/([^/]+)$/))) {
      const sym = decodeURIComponent(m[1]!).toUpperCase();
      if (!SYMBOL_RE.test(sym)) return send(res, 400, { error: 'Bad symbol' });
      return send(res, 200, await getHistory(sym, url.searchParams.get('range') || '6M'), 300);
    }
    if (p === '/api/state') {
      if (req.method === 'GET') return send(res, 200, (stateFile && (await readState(stateFile))) || {});
      if (req.method === 'PUT') {
        // Hosted copies keep each visitor's layout and picks in their own browser.
        if (!stateFile) return send(res, 501, { error: 'Saving is handled by your browser on this host' });
        if (!sameOrigin(req)) return send(res, 403, { error: 'Cross-origin write refused' });
        let body: unknown;
        try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
        await writeState(stateFile, validateState(body));
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(p, errMessage(err));
    return send(res, errStatus(err), { error: errMessage(err) });
  }
}
