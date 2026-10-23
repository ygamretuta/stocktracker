// Board-lot + PH broker-fee math used by the Put Money On widget.

// Typical PH online-broker fees. Rates are percentages.
export const DEFAULT_FEES = { commission: 0.25, minCommission: 20, vat: 12, pse: 0.005, sccp: 0.01, salesTax: 0.1 };

// PSE board lot table by price band (used when PSE Edge doesn't report one).
export function boardLot(p) {
  if (p >= 1000) return 5;
  if (p >= 50) return 10;
  if (p >= 5) return 100;
  if (p >= 0.5) return 1000;
  if (p >= 0.05) return 10000;
  if (p >= 0.01) return 100000;
  return 1000000;
}

export function fees(gross, f, side) {
  if (gross <= 0) return { commission: 0, vat: 0, pse: 0, sccp: 0, salesTax: 0, total: 0 };
  const commission = Math.max((gross * f.commission) / 100, f.minCommission);
  const vat = (commission * f.vat) / 100;
  const pse = (gross * f.pse) / 100;
  const sccp = (gross * f.sccp) / 100;
  const salesTax = side === 'sell' ? (gross * f.salesTax) / 100 : 0;
  return { commission, vat, pse, sccp, salesTax, total: commission + vat + pse + sccp + salesTax };
}

// Most shares (in whole board lots) that `budget` can buy at `p`, fees included.
export function plan(budget, p, lot, f) {
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

export const netSell = (shares, p, f) => shares * p - fees(shares * p, f, 'sell').total;

// Sell price at which the position just covers what was paid.
export function breakEven(shares, cost, f) {
  if (!shares) return null;
  let lo = 0, hi = (cost / shares) * 2 + 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (netSell(shares, mid, f) < cost) lo = mid; else hi = mid;
  }
  return hi;
}
