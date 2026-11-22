import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCandidates, windowReturns, rank } from '../performance.ts';

const stock = (symbol: string, price: number, volume: number, name = symbol) => ({ symbol, name, price, volume });

test('pickCandidates keeps liquid common stocks, most traded first', () => {
  const list = [
    stock('AAA', 10, 1_000_000), stock('BBB', 100, 200_000), stock('CCC', 10, 1_000),
    stock('DDD', 500, 100_000, 'Foo Class B Preferred Shares'), stock('EEE', 0, 5),
  ];
  assert.deepEqual(pickCandidates(list, 10), ['BBB', 'AAA']);
  assert.deepEqual(pickCandidates(list, 1), ['BBB']);
});

const days = (n: number, start: string, f: (i: number) => number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(new Date(start).getTime() + i * 86_400_000).toISOString().slice(0, 10);
  return { time: d, close: f(i) };
});

test('windowReturns measures change from the start of each window', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const candles = days(200, '2026-04-04', (i) => 100 + i); // ends 2026-10-20, close 299
  const r = windowReturns(candles, now);
  assert.ok(r && r['3M'] !== null && r['6M'] !== null);
  assert.ok(r['3M'] > 0 && r['6M'] > r['3M']);
  assert.equal(r.lastClose, 299);
});

test('windowReturns is null for a window the history does not reach', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const r = windowReturns(days(60, '2026-08-20', (i) => 100 + i), now);
  assert.ok(r);
  assert.equal(r['6M'], null);
  assert.equal(r['3M'], null);
  assert.equal(windowReturns(days(5, '2026-10-15', () => 1), now), null);
});

test('rank sorts by the chosen window and skips missing values', () => {
  const rows = [{ symbol: 'A', '3M': 5 }, { symbol: 'B', '3M': 20 }, { symbol: 'C', '3M': null }, { symbol: 'D', '3M': -3 }];
  assert.deepEqual(rank(rows, '3M', 2).map((r) => r.symbol), ['B', 'A']);
});
