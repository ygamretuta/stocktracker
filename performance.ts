// Ranks liquid PSE stocks by price performance. Pure functions so they can be tested.

import type { Candle, Stock } from './public/js/types.ts';

const DAY = 86_400_000;
export const WINDOWS = { '3M': 92, '6M': 183 } as const;
export type Window = keyof typeof WINDOWS;
type Returns = Record<Window, number | null> & { lastClose: number; lastDate: string };

// The most actively traded common stocks (skips preferred shares and warrants).
export function pickCandidates(stocks: Pick<Stock, 'symbol' | 'name' | 'price' | 'volume'>[], n = 40, minValue = 5_000_000): string[] {
  return stocks
    .filter((s) => s.price > 0 && s.volume > 0 && s.price * s.volume >= minValue && !/preferred|warrant/i.test(s.name))
    .sort((a, b) => b.price * b.volume - a.price * a.volume)
    .slice(0, n)
    .map((s) => s.symbol);
}

// Return over each window, from daily candles (ascending dates, 'YYYY-MM-DD').
export function windowReturns(candles: Pick<Candle, 'time' | 'close'>[] | null | undefined, now = new Date()): Returns | null {
  if (!candles || candles.length < 20) return null;
  const last = candles[candles.length - 1];
  const out: Record<string, number | null> = {};
  for (const [name, days] of Object.entries(WINDOWS)) {
    const cutoff = new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
    const start = candles.find((c) => c.time >= cutoff);
    // Need the history to actually reach back to the window, not just start later.
    if (!start || start.time > new Date(new Date(cutoff).getTime() + 10 * DAY).toISOString().slice(0, 10)) { out[name] = null; continue; }
    out[name] = ((last.close - start.close) / start.close) * 100;
  }
  return { '3M': out['3M'] ?? null, '6M': out['6M'] ?? null, lastClose: last.close, lastDate: last.time };
}

export function rank<T extends Partial<Record<Window, number | null>>>(results: T[], window: Window, count = 5): T[] {
  return results
    .filter((r) => r[window] != null)
    .sort((a, b) => (b[window] ?? 0) - (a[window] ?? 0))
    .slice(0, count);
}
