// Validation for the saved dashboard state (data/state.json). The client PUTs this
// whole object, so only known fields and sane shapes are kept.

const MAX_WIDGETS = 100;
const MAX_POSITIONS = 1000;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => typeof v === 'string' && v.length <= max;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const optInt = (v) => v == null || (Number.isInteger(v) && v >= 0 && v <= 1000);

export function validateState(input) {
  if (!isObj(input)) throw badRequest('State must be an object');
  const out = {};

  if (input.widgets !== undefined) {
    if (!Array.isArray(input.widgets) || input.widgets.length > MAX_WIDGETS) throw badRequest('Invalid widgets');
    out.widgets = input.widgets.map((w) => {
      if (!isObj(w) || !str(w.id, 40) || !str(w.type, 40)) throw badRequest('Invalid widget');
      if (![w.x, w.y, w.w, w.h].every(optInt)) throw badRequest('Invalid widget geometry');
      if (w.config !== undefined && !isObj(w.config)) throw badRequest('Invalid widget config');
      return { id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, config: w.config };
    });
  }

  if (input.positions !== undefined) {
    if (!Array.isArray(input.positions) || input.positions.length > MAX_POSITIONS) throw badRequest('Invalid positions');
    out.positions = input.positions.map((p) => {
      if (!isObj(p) || !str(p.id, 40) || !str(p.symbol, 12) || !str(p.date, 40)) throw badRequest('Invalid position');
      if (![p.shares, p.price, p.fees, p.total].every(finite)) throw badRequest('Invalid position numbers');
      return { id: p.id, symbol: p.symbol, shares: p.shares, price: p.price, fees: p.fees, total: p.total, date: p.date };
    });
  }

  if (input.welcomeDismissed !== undefined) out.welcomeDismissed = Boolean(input.welcomeDismissed);
  return out;
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
