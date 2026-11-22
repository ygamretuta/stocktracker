import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FEES, boardLot, fees, plan, netSell, breakEven } from '../public/js/fees.ts';

test('boardLot follows the PSE price bands', () => {
  assert.equal(boardLot(1000), 5);
  assert.equal(boardLot(999.99), 10);
  assert.equal(boardLot(50), 10);
  assert.equal(boardLot(5), 100);
  assert.equal(boardLot(0.5), 1000);
  assert.equal(boardLot(0.05), 10000);
  assert.equal(boardLot(0.01), 100000);
  assert.equal(boardLot(0.005), 1000000);
});

test('fees: minimum commission applies and sell adds sales tax', () => {
  const buy = fees(1000, DEFAULT_FEES, 'buy');
  assert.equal(buy.commission, 20);
  assert.ok(Math.abs(buy.vat - 2.4) < 1e-9);
  assert.equal(buy.salesTax, 0);
  const sell = fees(1000, DEFAULT_FEES, 'sell');
  assert.ok(Math.abs(sell.salesTax - 1) < 1e-9);
  assert.equal(fees(0, DEFAULT_FEES, 'buy').total, 0);
});

test('custodial fee is not part of per-trade fees', () => {
  const noCust = { ...DEFAULT_FEES, custodial: 0 };
  assert.equal(fees(50000, DEFAULT_FEES, 'buy').total, fees(50000, noCust, 'buy').total);
});

test('plan buys whole lots and never exceeds the budget', () => {
  const r = plan(10000, 12.5, 100, DEFAULT_FEES);
  assert.ok(r);
  assert.equal(r.shares % 100, 0);
  assert.ok(r.shares > 0);
  assert.ok(r.total <= 10000);
  assert.ok(Math.abs(r.left - (10000 - r.total)) < 1e-9);
});

test('plan reports the one-lot cost when the budget is too small', () => {
  const r = plan(100, 500, 10, DEFAULT_FEES);
  assert.ok(r);
  assert.equal(r.shares, 0);
  assert.ok(r.oneLot && r.oneLot > 5000);
});

test('plan rejects invalid input', () => {
  assert.equal(plan(0, 10, 100, DEFAULT_FEES), null);
  assert.equal(plan(1000, 0, 100, DEFAULT_FEES), null);
});

test('breakEven sells for exactly what was paid', () => {
  const r = plan(10000, 12.5, 100, DEFAULT_FEES);
  assert.ok(r);
  const be = breakEven(r.shares, r.total, DEFAULT_FEES);
  assert.ok(be !== null && be > 12.5);
  assert.ok(Math.abs(netSell(r.shares, be, DEFAULT_FEES) - r.total) < 1e-6);
  assert.equal(breakEven(0, 0, DEFAULT_FEES), null);
});
