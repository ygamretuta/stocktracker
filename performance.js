// Ranks liquid PSE stocks by price performance. Pure functions so they can be tested.

const DAY = 86_400_000;
export const WINDOWS = { '3M': 92, '6M': 183 };

// The most actively traded common stocks (skips preferred shares and warrants).
export function pickCandidates(stocks, n = 40, minValue = 5_000_000) {
  return stocks
    .filter((s) => s.price > 0 && s.volume > 0 && s.price * s.volume >= minValue && !/preferred|warrant/i.test(s.name))
    .sort((a, b) => b.price * b.volume - a.price * a.volume)
    .slice(0, n)
    .map((s) => s.symbol);
}

// Return over each window, from daily candles (ascending dates, 'YYYY-MM-DD').
export function windowReturns(candles, now = new Date()) {
  if (!candles || candles.length < 20) return null;
  const last = candles[candles.length - 1];
  const out = {};
  for (const [name, days] of Object.entries(WINDOWS)) {
    const cutoff = new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
    const start = candles.find((c) => c.time >= cutoff);
    // Need the history to actually reach back to the window, not just start later.
    if (!start || start.time > new Date(new Date(cutoff).getTime() + 10 * DAY).toISOString().slice(0, 10)) { out[name] = null; continue; }
    out[name] = ((last.close - start.close) / start.close) * 100;
  }
  return { ...out, lastClose: last.close, lastDate: last.time };
}

export function rank(results, window, count = 5) {
  return results
    .filter((r) => r[window] != null)
    .sort((a, b) => b[window] - a[window])
    .slice(0, count);
}
