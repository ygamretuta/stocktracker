// Server calls + one shared market feed that every widget subscribes to.

import { marketStatus } from './util.ts';
import type { Candle, CompanyProfile, Index, MarketState, NewsFeed, PerformanceSnapshot, SavedState, Stock, StockDetail } from './types.ts';

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function json<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError((body as { error?: string }).error || `HTTP ${res.status}`, res.status);
  return body as T;
}

// When the host can't store anything for you (the hosted copy), the layout and picks live in
// this browser instead. A local server answers saves normally, so this is never used there.
const LOCAL_STATE_KEY = 'pse-tracker:state';

function readLocalState(): SavedState | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) ?? 'null');
    return parsed && typeof parsed === 'object' && Array.isArray((parsed as SavedState).widgets) ? (parsed as SavedState) : null;
  } catch {
    return null;
  }
}

// False once the host has said it won't store anything, so we stop sending saves it would refuse.
let hostStoresState = true;

async function loadState(): Promise<SavedState> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
  hostStoresState = res.headers.get('X-State-Storage') !== 'browser';
  const server = (await res.json()) as SavedState;
  return Object.keys(server).length ? server : (readLocalState() ?? server);
}

async function saveState(state: SavedState): Promise<void> {
  try {
    if (!hostStoresState) throw new HttpError('Saving is handled by your browser on this host', 501);
    await json<{ ok: true }>('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 501)) throw e;
    hostStoresState = false;
    try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state)); } catch { /* storage blocked or full */ }
  }
}

export const api = {
  stocks: () => json<{ asOf: string; fetchedAt: string; stocks: Stock[] }>('/api/stocks'),
  indices: () => json<{ asOf: string | null; indices: Index[] }>('/api/indices'),
  news: () => json<NewsFeed>('/api/news'),
  performance: () => json<PerformanceSnapshot>('/api/performance'),
  stock: (sym: string) => json<StockDetail>(`/api/stock/${encodeURIComponent(sym)}`),
  company: (sym: string) => json<CompanyProfile>(`/api/company/${encodeURIComponent(sym)}`),
  history: (sym: string, range: string) => json<{ symbol: string; range: string; candles: Candle[] }>(`/api/history/${encodeURIComponent(sym)}?range=${range}`),
  loadState,
  saveState,
};

type Feed = 'stocks' | 'indices';

// Poll quickly while the market is open and once a minute when it is closed (so the open
// and the end of the lunch recess are noticed within a minute).
// (Holidays aren't detected, so a holiday just polls at the open-market rate.)
export const pollEvery: Record<Feed, [open: number, closed: number]> = { stocks: [10_000, 60_000], indices: [15_000, 60_000] };
export const pollMs = (kind: Feed, now = new Date()): number => pollEvery[kind][marketStatus(now).open ? 0 : 1];

type Listener = (m: MarketState) => void;

class Market implements MarketState {
  stocks: Stock[] = [];
  bySymbol = new Map<string, Stock>();
  indices: Index[] = [];
  asOf: string | null = null;
  indicesAsOf: string | null = null;
  updatedAt: Date | null = null;
  error: string | null = null;
  listeners = new Set<Listener>();
  private timers: Partial<Record<Feed, ReturnType<typeof setTimeout>>> = {};
  private wake: Partial<Record<Feed, () => Promise<void>>> = {};

  subscribe(fn: Listener): () => boolean {
    this.listeners.add(fn);
    if (this.updatedAt) fn(this);
    return () => this.listeners.delete(fn);
  }

  emit(): void { for (const fn of this.listeners) fn(this); }

  async refreshStocks(): Promise<void> {
    try {
      const data = await api.stocks();
      this.stocks = data.stocks;
      this.bySymbol = new Map(data.stocks.map((s) => [s.symbol, s]));
      this.asOf = data.asOf;
      this.updatedAt = new Date();
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.emit();
  }

  async refreshIndices(): Promise<void> {
    try {
      const data = await api.indices();
      this.indices = data.indices;
      this.indicesAsOf = data.asOf;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.emit();
  }

  refresh(): Promise<[void, void]> { return Promise.all([this.refreshStocks(), this.refreshIndices()]); }

  // Each feed reschedules itself, so a slow request never overlaps the next one.
  start(): void {
    const loop = (kind: Feed, refresh: () => Promise<void>) => {
      const run = async () => {
        clearTimeout(this.timers[kind]);
        await refresh();
        this.timers[kind] = setTimeout(run, pollMs(kind));
      };
      this.wake[kind] = run;
      void run();
    };
    loop('stocks', () => this.refreshStocks());
    loop('indices', () => this.refreshIndices());
    // Browsers pause timers in background tabs, so catch up the moment the tab is back.
    const wake = () => { if (!document.hidden) { void this.wake.stocks?.(); void this.wake.indices?.(); } };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
  }
}

export const market = new Market();
