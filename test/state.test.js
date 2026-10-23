import test from 'node:test';
import assert from 'node:assert/strict';
import { validateState } from '../state.js';

const widget = { id: 'a1', type: 'chart', x: 0, y: 0, w: 6, h: 9, config: { symbol: 'JFC' } };
const position = { id: 'p1', symbol: 'JFC', shares: 100, price: 230, fees: 60, total: 23060, date: 'Oct 22, 2026' };

test('accepts a valid state and drops unknown keys', () => {
  const out = validateState({ widgets: [widget], positions: [position], welcomeDismissed: 1, evil: 'x' });
  assert.equal(out.evil, undefined);
  assert.equal(out.welcomeDismissed, true);
  assert.deepEqual(out.positions[0], position);
});

test('rejects non-objects and malformed entries with status 400', () => {
  for (const bad of [null, [], 'x', { widgets: 'no' }, { widgets: [{ id: 1, type: 'x' }] },
    { widgets: [{ ...widget, w: -1 }] }, { positions: [{ ...position, shares: 'many' }] }, { positions: [{ ...position, shares: NaN }] }]) {
    assert.throws(() => validateState(bad), (e) => e.status === 400);
  }
});

test('rejects oversized lists', () => {
  assert.throws(() => validateState({ widgets: Array.from({ length: 101 }, (_, i) => ({ ...widget, id: String(i) })) }), /Invalid widgets/);
});
