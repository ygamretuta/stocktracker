// Validation for the saved dashboard state (data/state.json). The client PUTs this
// whole object, so only known fields and sane shapes are kept.

import type { Position, SavedState, WidgetConfig, WidgetState } from './public/js/types.ts';

const MAX_WIDGETS = 100;
const MAX_POSITIONS = 1000;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isOptInt = (v: unknown): v is number | null | undefined => v == null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000);

export function validateState(input: unknown): SavedState {
  if (!isObj(input)) throw badRequest('State must be an object');
  const out: SavedState = {};

  if (input.widgets !== undefined) {
    const list = input.widgets;
    if (!Array.isArray(list) || list.length > MAX_WIDGETS) throw badRequest('Invalid widgets');
    out.widgets = list.map((w: unknown): WidgetState => {
      if (!isObj(w) || !str(w.id, 40) || !str(w.type, 40)) throw badRequest('Invalid widget');
      const { x, y, w: width, h } = w;
      if (!isOptInt(x) || !isOptInt(y) || !isOptInt(width) || !isOptInt(h)) throw badRequest('Invalid widget geometry');
      if (w.config !== undefined && !isObj(w.config)) throw badRequest('Invalid widget config');
      return { id: w.id, type: w.type, x: x ?? undefined, y: y ?? undefined, w: width ?? undefined, h: h ?? undefined, config: w.config as WidgetConfig | undefined };
    });
  }

  if (input.positions !== undefined) {
    const list = input.positions;
    if (!Array.isArray(list) || list.length > MAX_POSITIONS) throw badRequest('Invalid positions');
    out.positions = list.map((p: unknown): Position => {
      if (!isObj(p) || !str(p.id, 40) || !str(p.symbol, 12) || !str(p.date, 40)) throw badRequest('Invalid position');
      const { shares, price, fees, total } = p;
      if (!finite(shares) || !finite(price) || !finite(fees) || !finite(total)) throw badRequest('Invalid position numbers');
      return { id: p.id, symbol: p.symbol, shares, price, fees, total, date: p.date };
    });
  }

  if (input.welcomeDismissed !== undefined) out.welcomeDismissed = Boolean(input.welcomeDismissed);
  return out;
}

function badRequest(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 400 });
}
