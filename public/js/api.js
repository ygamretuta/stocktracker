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
  history: (sym, range) => json(`/api/history/${encodeURIComponent(sym)}?range=${range}`),
  loadState: () => json('/api/state'),
  saveState: (state) => json('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }),
};

const STOCKS_EVERY = 30_000;
const INDICES_EVERY = 60_000;

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

  start() {
    this.refresh();
    setInterval(() => this.refreshStocks(), STOCKS_EVERY);
    setInterval(() => this.refreshIndices(), INDICES_EVERY);
  },
};
