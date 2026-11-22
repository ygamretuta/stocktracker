import test from 'node:test';
import assert from 'node:assert/strict';
import { pollMs, pollEvery } from '../public/js/api.ts';

// Manila is UTC+8: 10:00 PHT = 02:00Z.
test('polls fast while the market is open', () => {
  assert.equal(pollMs('stocks', new Date('2026-10-26T02:00:00Z')), pollEvery.stocks[0]); // Monday 10:00
  assert.equal(pollMs('indices', new Date('2026-10-26T02:00:00Z')), pollEvery.indices[0]);
});

test('polls slowly when closed', () => {
  assert.equal(pollMs('stocks', new Date('2026-10-25T02:00:00Z')), pollEvery.stocks[1]); // Sunday
  assert.equal(pollMs('stocks', new Date('2026-10-26T08:00:00Z')), pollEvery.stocks[1]); // Monday 16:00
  assert.equal(pollMs('stocks', new Date('2026-10-26T04:30:00Z')), pollEvery.stocks[1]); // Monday lunch 12:30
});
