import { marketStatus } from './util.js';

// Server calls + one shared market feed that every widget subscribes to.

async function json(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const api = {
  stocks: () => json('/api/stocks'),
  indices: () => json('/api/indices'),
  news: () => json('/api/news'),
  stock: (sym) => json(`/api/stock/${encodeURIComponent(sym)}`),
  company: (sym) => json(`/api/company/${encodeURIComponent(sym)}`),
  history: (sym, range) => json(`/api/history/${encodeURIComponent(sym)}?range=${range}`),
  loadState: () => json('/api/state'),
  saveState: (state) => json('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }),
};

// Poll quickly while the market is open and once a minute when it is closed (so the open
// and the end of the lunch recess are noticed within a minute).
// (Holidays aren't detected, so a holiday just polls at the open-market rate.)
export const pollEvery = { stocks: [10_000, 60_000], indices: [15_000, 60_000] };
export const pollMs = (kind, now = new Date()) => pollEvery[kind][marketStatus(now).open ? 0 : 1];

export const market = {
  stocks: [],
  bySymbol: new Map(),
  indices: [],
  asOf: null,
  indicesAsOf: null,
  updatedAt: null,
  error: null,
  listeners: new Set(),

  subscribe(fn) {
    this.listeners.add(fn);
    if (this.updatedAt) fn(this);
    return () => this.listeners.delete(fn);
  },
  emit() { for (const fn of this.listeners) fn(this); },

  async refreshStocks() {
    try {
      const data = await api.stocks();
      this.stocks = data.stocks;
      this.bySymbol = new Map(data.stocks.map((s) => [s.symbol, s]));
      this.asOf = data.asOf;
      this.updatedAt = new Date();
      this.error = null;
    } catch (e) {
      this.error = e.message;
    }
    this.emit();
  },

  async refreshIndices() {
    try {
      const data = await api.indices();
      this.indices = data.indices;
      this.indicesAsOf = data.asOf;
    } catch (e) {
      this.error = e.message;
    }
    this.emit();
  },

  refresh() { return Promise.all([this.refreshStocks(), this.refreshIndices()]); },

  // Each feed reschedules itself, so a slow request never overlaps the next one.
  start() {
    const loop = (kind, refresh) => {
      const run = async () => {
        clearTimeout(this.timers[kind]);
        await refresh();
        this.timers[kind] = setTimeout(run, pollMs(kind));
      };
      this[`wake_${kind}`] = run;
      run();
    };
    this.timers = {};
    loop('stocks', () => this.refreshStocks());
    loop('indices', () => this.refreshIndices());
    // Browsers pause timers in background tabs, so catch up the moment the tab is back.
    const wake = () => { if (!document.hidden) { this.wake_stocks(); this.wake_indices(); } };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
  },
};
