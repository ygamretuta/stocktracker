// Shared formatting + helpers.

import type { WidgetConfig } from './types.ts';

/** Builds one element from an HTML string. */
export const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const first = t.content.firstElementChild;
  if (!first) throw new Error('el(): no element in markup');
  return first as T;
};

/** querySelector that throws instead of returning null, for markup we just built ourselves. */
export const must = <T extends Element = HTMLElement>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
};

/** The nearest ancestor of the event target (or the target itself) matching `selector`. */
export const hit = <T extends HTMLElement = HTMLElement>(e: Event, selector: string): T | null =>
  (e.target instanceof Element ? e.target.closest<T>(selector) : null);

/** Message text from anything that was thrown. */
export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

type Num = number | null | undefined;

export function price(n: Num): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const digits = n < 1 ? 4 : 2;
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: digits });
}

export const peso = (n: Num, digits = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const signedPeso = (n: Num, digits = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${peso(Math.abs(n), digits)}`;

export function compact(n: Num): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString('en-PH');
}

export const int = (n: Num): string => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-PH'));

export const dir = (n: Num): 'up' | 'down' | 'flat' => (n != null && n > 0 ? 'up' : n != null && n < 0 ? 'down' : 'flat');

export function pct(n: Num, { sign = true } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${sign && n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export const chg = (n: Num): string => `<span class="chg ${dir(n)}">${pct(n)}</span>`;

export const debounce = <A extends unknown[]>(fn: (...args: A) => void, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// Read a symbol out of a datalist input ("JFC — Jollibee Foods" -> "JFC").
export const parseSymbol = (v: unknown): string => String(v || '').trim().split(/\s|—/)[0].toUpperCase();

// Turns what someone typed (symbol, "JFC — Jollibee…", or a company name) into a
// listed symbol, or null. main.js swaps in a version that knows the stock list.
let resolver = (v: string): string | null => parseSymbol(v) || null;
export const setSymbolResolver = (fn: (v: string) => string | null): void => { resolver = fn; };
export const resolveSymbol = (v: string): string | null => resolver(v);

// Text input bound to the shared #symbols datalist. Calls onPick(symbol) for known symbols.
export function symbolInput(value: string, onPick: (sym: string) => void, { placeholder = 'Symbol', className = 'sym-input', label = 'Stock symbol' } = {}): HTMLInputElement {
  const input = el<HTMLInputElement>(`<input class="field ${className}" list="symbols" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" title="Type a symbol or company name" spellcheck="false" autocomplete="off" value="${esc(value || '')}">`);
  const commit = () => {
    if (!input.value.trim()) return;
    const sym = resolveSymbol(input.value);
    if (!sym) { toast(`Couldn't find "${input.value.trim()}". Try the ticker symbol, e.g. JFC.`); return; }
    input.value = sym;
    onPick(sym);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); input.blur(); } });
  input.addEventListener('focus', () => input.select());
  return input;
}

// Philippine market hours (approximate; does not know about holidays).
export function marketStatus(now = new Date()): { open: boolean; label: string } {
  const ph = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  const day = ph.getDay();
  const mins = ph.getHours() * 60 + ph.getMinutes();
  if (day === 0 || day === 6) return { open: false, label: 'Closed · weekend' };
  if (mins < 9 * 60 + 30) return { open: false, label: 'Pre-open' };
  if (mins >= 12 * 60 && mins < 13 * 60) return { open: false, label: 'Lunch recess' };
  if (mins >= 15 * 60) return { open: false, label: 'Closed' };
  return { open: true, label: 'Market open' };
}

// Checkbox that lets a chart/info widget follow whichever stock was last picked anywhere.
export function followToggle(config: WidgetConfig, save: () => void): HTMLLabelElement {
  const label = el<HTMLLabelElement>(`<label class="follow" title="When on, this widget switches to whatever stock you click or search for elsewhere on the dashboard"><input type="checkbox"> Follow selection</label>`);
  const box = must<HTMLInputElement>(label, 'input');
  box.checked = config.linked;
  box.addEventListener('change', () => { config.linked = box.checked; save(); });
  return label;
}

// A jargon word with a dotted underline; clicking it shows a plain-language definition.
export const term = (label: string, key: string): string =>
  `<button type="button" class="term" data-term="${esc(key)}" title="What does this mean?">${esc(label)}</button>`;

// "＋ Pick" button for a stock; disabled once it is already in My Picks.
export const pickButton = (sym: string, picked: boolean, label = '＋ Pick', cls = 'btn sm'): string => picked
  ? `<button class="${cls}" disabled title="${esc(sym)} is already in My Picks">✓ Picked</button>`
  : `<button class="${cls}" data-pick="${esc(sym)}" title="Add ${esc(sym)} to My Picks" aria-label="Add ${esc(sym)} to My Picks">${label}</button>`;

// Short confirmation at the bottom of the screen, optionally with an action (e.g. Undo).
export function toast(message: string, { action, onAction, ms = 5000 }: { action?: string; onAction?: () => void; ms?: number } = {}): void {
  const box = must(document, '#toasts');
  const t = el(`<div class="toast" role="status"><span>${esc(message)}</span></div>`);
  if (action) {
    const b = el<HTMLButtonElement>(`<button class="btn sm">${esc(action)}</button>`);
    b.addEventListener('click', () => { onAction?.(); t.remove(); });
    t.append(b);
  }
  box.append(t);
  setTimeout(() => t.remove(), ms);
}
