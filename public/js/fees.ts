// Board-lot + PH broker-fee math used by the Put Money On widget.

import type { Fees } from './types.ts';
export type { Fees };
export interface FeeBreakdown { commission: number; vat: number; pse: number; sccp: number; salesTax: number; total: number }
export interface Plan { shares: number; gross: number; fee: FeeBreakdown; total: number; left: number; oneLot?: number }

// Typical PH online-broker fees. Rates are percentages.
// `custodial` is BPI Trade's yearly custody fee in pesos. It isn't charged per trade, so it
// stays out of fees()/plan()/breakEven() and is shown as a separate yearly cost.
export const DEFAULT_FEES: Fees = { commission: 0.25, minCommission: 20, vat: 12, pse: 0.005, sccp: 0.01, salesTax: 0.1, custodial: 120 };

// PSE board lot table by price band (used when PSE Edge doesn't report one).
export function boardLot(p: number): number {
  if (p >= 1000) return 5;
  if (p >= 50) return 10;
  if (p >= 5) return 100;
  if (p >= 0.5) return 1000;
  if (p >= 0.05) return 10000;
  if (p >= 0.01) return 100000;
  return 1000000;
}

export function fees(gross: number, f: Fees, side: 'buy' | 'sell'): FeeBreakdown {
  if (gross <= 0) return { commission: 0, vat: 0, pse: 0, sccp: 0, salesTax: 0, total: 0 };
  const commission = Math.max((gross * f.commission) / 100, f.minCommission);
  const vat = (commission * f.vat) / 100;
  const pse = (gross * f.pse) / 100;
  const sccp = (gross * f.sccp) / 100;
  const salesTax = side === 'sell' ? (gross * f.salesTax) / 100 : 0;
  return { commission, vat, pse, sccp, salesTax, total: commission + vat + pse + sccp + salesTax };
}

// Most shares (in whole board lots) that `budget` can buy at `p`, fees included.
export function plan(budget: number, p: number, lot: number, f: Fees): Plan | null {
  if (!(budget > 0 && p > 0 && lot > 0)) return null;
  let lots = Math.floor(budget / (p * lot));
  while (lots > 0) {
    const gross = lots * lot * p;
    const fee = fees(gross, f, 'buy');
    if (gross + fee.total <= budget) return { shares: lots * lot, gross, fee, total: gross + fee.total, left: budget - gross - fee.total };
    lots--;
  }
  const gross = lot * p;
  const fee = fees(gross, f, 'buy');
  return { shares: 0, gross: 0, fee, total: 0, left: budget, oneLot: gross + fee.total };
}

export const netSell = (shares: number, p: number, f: Fees): number => shares * p - fees(shares * p, f, 'sell').total;

// Sell price at which the position just covers what was paid.
export function breakEven(shares: number, cost: number, f: Fees): number | null {
  if (!shares) return null;
  let lo = 0, hi = (cost / shares) * 2 + 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (netSell(shares, mid, f) < cost) lo = mid; else hi = mid;
  }
  return hi;
}
