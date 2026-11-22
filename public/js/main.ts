import { api, market } from './api.ts';
import { must, hit, el, esc, price, int, peso, dir, pct, debounce, marketStatus, parseSymbol, setSymbolResolver, resolveSymbol, toast } from './util.ts';
import { GLOSSARY } from './glossary.ts';
import { openStock, syncPickButton } from './modal.ts';
import { DEFAULT_FEES, boardLot, plan } from './fees.ts';
import overview from './widgets/overview.ts';
import chart from './widgets/chart.ts';
import info from './widgets/info.ts';
import watchlist from './widgets/watchlist.ts';
import movers from './widgets/movers.ts';
import breadth from './widgets/breadth.ts';
import invest from './widgets/invest.ts';
import news from './widgets/news.ts';
import suggested from './widgets/suggested.ts';
import type { App, SavedState, WidgetDef, WidgetInstance, WidgetState } from './types.ts';

const REGISTRY: Record<string, WidgetDef> = Object.fromEntries(
  ([invest, chart, info, watchlist, movers, overview, news, suggested, breadth] as WidgetDef[]).map((w) => [w.type, w]),
);

const DEFAULT_LAYOUT = [
  { type: 'invest', x: 0, y: 0, w: 6, h: 9 },
  { type: 'chart', x: 6, y: 0, w: 6, h: 9 },
  { type: 'watchlist', x: 0, y: 9, w: 3, h: 8 },
  { type: 'info', x: 3, y: 9, w: 3, h: 8 },
  { type: 'movers', x: 6, y: 9, w: 3, h: 8 },
  { type: 'overview', x: 9, y: 9, w: 3, h: 8 },
  { type: 'news', x: 0, y: 17, w: 6, h: 9 },
  { type: 'suggested', x: 6, y: 17, w: 6, h: 9 },
];

const newId = (): string => Math.random().toString(36).slice(2, 10);

// ---------- state ----------
let state: Required<SavedState> = { widgets: [], positions: [], welcomeDismissed: false };
const persist = debounce(() => api.saveState(state).catch((e) => console.error('save failed', e)), 400);

const live = new Map<string, { def: WidgetDef; instance: WidgetInstance; el: HTMLElement }>();

const app: App = {
  focused: null,
  focus(sym) {
    app.focused = sym;
    for (const { instance } of live.values()) instance.onFocus?.(sym);
  },
  resolveSymbol,
  priceOf: (sym: string) => market.bySymbol.get(sym)?.price ?? null,
  nameOf: (sym: string) => market.bySymbol.get(sym)?.name || '',
  // Click on a stock anywhere: point the chart/info widgets at it and open its detail modal.
  show(sym, from) { app.focus(sym); openStock(sym, app, from); },
  getPositions: () => state.positions,
  // Every symbol the person follows: watchlists, picks, and the stock on screen.
  myStocks() {
    const set = new Set(state.positions.map((p) => p.symbol));
    for (const w of state.widgets) if (w.type === 'watchlist') (w.config?.symbols || []).forEach((s: string) => set.add(s));
    if (app.focused) set.add(app.focused);
    return set;
  },
  // Adds a practice pick for `sym`, sized like the Put Money On planner (its amount and fees,
  // or ₱10,000 and default fees when that widget isn't on the dashboard).
  hasPick: (sym) => state.positions.some((p) => p.symbol === sym),
  async addPick(sym) {
    if (app.hasPick(sym)) { toast(`${sym} is already in your picks`); return; }
    const cfg = state.widgets.find((w) => w.type === 'invest')?.config;
    const amount = Number(cfg?.amount) || 10000;
    const fees = { ...DEFAULT_FEES, ...cfg?.fees };
    const p = market.bySymbol.get(sym)?.price;
    if (!p) { toast(`No price yet for ${sym}, so it can't be added.`); return; }
    let lot: number | null = null;
    try { lot = (await api.stock(sym)).boardLot; } catch { /* fall back to the price table */ }
    if (app.hasPick(sym)) return; // added while the board lot was loading
    const r = plan(amount, p, lot || boardLot(p), fees);
    if (!r?.shares) { toast(`${peso(amount, 0)} isn't enough for one board lot of ${sym}. You'd need ${peso(r?.oneLot ?? 0)}.`); return; }
    const pick = {
      id: newId(), symbol: sym, shares: r.shares, price: p, fees: r.fee.total, total: r.total,
      date: new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
    };
    app.setPositions([...app.getPositions(), pick]);
    toast(`Added ${int(r.shares)} ${sym} shares (${peso(r.total, 0)}) to your picks`, {
      action: 'Undo', onAction: () => app.setPositions(app.getPositions().filter((x) => x.id !== pick.id)),
    });
  },
  setPositions(list) {
    state.positions = list;
    persist();
    for (const { instance } of live.values()) instance.onPositions?.();
    syncPickButton(app);
  },
};

// Symbol, "JFC — Jollibee…", or a company name -> a listed symbol.
setSymbolResolver((text) => {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const sym = parseSymbol(raw);
  if (!market.bySymbol.size || market.bySymbol.has(sym)) return sym;
  const q = raw.toLowerCase();
  const hit = market.stocks.find((s) => s.name.toLowerCase().startsWith(q)) || market.stocks.find((s) => s.name.toLowerCase().includes(q));
  return hit?.symbol || null;
});

// ---------- grid ----------
// Drag a widget by its title bar (controls in the title bar stay clickable) and resize from the corner.
const grid = GridStack.init({
  column: 12,
  cellHeight: 56,
  margin: 5,
  float: false,
  animate: false,
  handle: '.w-head',
  draggable: { cancel: '.w-tools, .help-btn, input, button, select, label' },
  resizable: { handles: 'se' },
  alwaysShowResizeHandle: true,
}, '#grid');

grid.on('change', () => syncLayout());

// Stack widgets in one column on phones. The 12-column layout is always built first,
// so GridStack can restore it exactly when the window widens again.
function fitColumns() {
  const cols = grid.el.clientWidth < 700 ? 1 : 12;
  if (grid.getColumn() !== cols) grid.column(cols, 'list');
  // On phones widgets stack in one column, and touching a title bar should scroll, not drag.
  grid.enableMove(cols === 12);
  grid.enableResize(cols === 12);
}
window.addEventListener('resize', debounce(fitColumns, 150));

function syncLayout() {
  for (const node of grid.engine.nodes) {
    const w = state.widgets.find((x) => x.id === node.id);
    // Only record positions from the full 12-column layout so phone reflow doesn't overwrite it.
    if (w && grid.getColumn() === 12) Object.assign(w, { x: node.x, y: node.y, w: node.w, h: node.h });
  }
  persist();
}

function addWidget(w: WidgetState): HTMLElement | undefined {
  const def = REGISTRY[w.type];
  if (!def) return undefined;
  w.config = { ...structuredClone(def.defaults), ...(w.config || {}) };
  const item = el(`
    <div class="grid-stack-item">
      <div class="grid-stack-item-content">
        <div class="w-head">
          <div class="w-name">
            <span class="grip" aria-hidden="true" title="Drag to move">⠿</span>
            <span class="w-title" title="Drag the title bar to move this widget">${esc(def.title)}</span>
            <button class="help-btn" title="What is this?" aria-label="What is ${esc(def.title)}?" aria-expanded="false">?</button>
          </div>
          <div class="w-tools"><div class="w-slot"></div><button class="btn sm danger w-remove" title="Remove this widget">Remove</button></div>
        </div>
        <div class="w-help" hidden><p>${esc(def.help)}</p></div>
        <div class="w-body"></div>
      </div>
    </div>`);
  grid.el.appendChild(item);
  grid.makeWidget(item, {
    id: w.id, x: w.x, y: w.y, w: w.w ?? def.size.w, h: w.h ?? def.size.h,
    minW: def.size.minW, minH: def.size.minH, autoPosition: w.x == null,
  });

  const helpBtn = must(item, '.help-btn');
  const help = must(item, '.w-help');
  helpBtn.addEventListener('click', () => {
    help.hidden = !help.hidden;
    helpBtn.classList.toggle('on', !help.hidden);
    helpBtn.setAttribute('aria-expanded', String(!help.hidden));
  });

  const instance = def.mount({
    body: must(item, '.w-body'),
    tools: must(item, '.w-slot'),
    config: w.config ?? {},
    save: persist,
    setTitle: (t) => { must(item, '.w-title').textContent = t; },
    app,
  }) || {};
  live.set(w.id, { def, instance, el: item });
  if (instance.onMarket) market.subscribe(instance.onMarket);

  must(item, '.w-remove').addEventListener('click', () => removeWidget(w.id));
  updateEmpty();
  return item;
}

function unmount(id: string): void {
  const entry = live.get(id);
  if (!entry) return;
  if (entry.instance.onMarket) market.listeners.delete(entry.instance.onMarket);
  entry.instance.destroy?.();
  grid.removeWidget(entry.el);
  live.delete(id);
}

function removeWidget(id: string): void {
  const w = state.widgets.find((x) => x.id === id);
  if (!w) return;
  unmount(id);
  state.widgets = state.widgets.filter((x) => x.id !== id);
  persist();
  updateEmpty();
  toast(`Removed "${REGISTRY[w.type]?.title}"`, {
    action: 'Undo',
    onAction: () => { state.widgets.push(w); addWidget(w); syncLayout(); },
  });
}

function loadLayout(widgets: WidgetState[]): void {
  for (const id of [...live.keys()]) unmount(id);
  state.widgets = widgets;
  grid.column(12, 'none');
  grid.batchUpdate();
  state.widgets.forEach(addWidget);
  grid.batchUpdate(false);
  fitColumns();
  updateEmpty();
  persist();
}
const defaultLayout = () => DEFAULT_LAYOUT.map((w) => ({ ...w, id: newId() }));

const updateEmpty = () => { must(document, '#empty').hidden = live.size > 0; };

// ---------- edit mode ----------
const editBtn = must(document, '#edit-layout');
function setEditing(on: boolean): void {
  document.body.classList.toggle('editing', on);
  must(document, '#edit-banner').hidden = !on;
  editBtn.classList.toggle('on', on);
  editBtn.innerHTML = on ? '<span aria-hidden="true">✓</span> Done editing' : '<span aria-hidden="true">✎</span> Edit layout';
}
editBtn.addEventListener('click', () => setEditing(!document.body.classList.contains('editing')));
must(document, '#done-editing').addEventListener('click', () => { setEditing(false); toast('Layout saved'); });
must(document, '#reset-layout').addEventListener('click', () => {
  const before = structuredClone(state.widgets);
  loadLayout(defaultLayout());
  toast('Layout reset to default. Your picks are kept.', { action: 'Undo', onAction: () => loadLayout(before) });
});

// ---------- add-widget menu ----------
const menu = must(document, '#widget-menu');
const addBtn = must(document, '#add-widget');
menu.innerHTML = '<div class="menu-title">Choose a widget to add to your dashboard</div>' + Object.values(REGISTRY).map((d) => `
  <button data-type="${d.type}">
    <span class="mi-icon" aria-hidden="true">${d.icon}</span>
    <span><b>${esc(d.title)}</b><span class="desc">${esc(d.description)}</span></span>
  </button>`).join('');
const toggleMenu = (show = menu.hidden) => { menu.hidden = !show; addBtn.setAttribute('aria-expanded', String(show)); };
addBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
must(document, '#empty-add').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(true); addBtn.scrollIntoView(); });
must(document, '#empty-reset').addEventListener('click', () => loadLayout(defaultLayout()));
document.addEventListener('click', (e) => { if (!(e.target instanceof Node) || !menu.contains(e.target)) toggleMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleMenu(false); });
menu.addEventListener('click', (e) => {
  const b = hit(e, '[data-type]');
  if (!b) return;
  toggleMenu(false);
  const type = b.dataset.type!;
  const w: WidgetState = { id: newId(), type };
  state.widgets.push(w);
  const item = addWidget(w);
  syncLayout();
  item?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast(`Added "${REGISTRY[type]?.title}". Use Edit layout to move or resize it.`);
});

// ---------- header ----------
must(document, '#refresh').addEventListener('click', async () => {
  await market.refresh();
  toast('Prices updated');
});

const lookup = must<HTMLInputElement>(document, '#lookup');
function doLookup() {
  if (!lookup.value.trim()) return;
  const sym = resolveSymbol(lookup.value);
  if (!sym) { toast(`Couldn't find "${lookup.value.trim()}". Try the ticker symbol, e.g. JFC.`); return; }
  lookup.value = '';
  lookup.blur();
  app.focus(sym);
  const target = [...live.values()].find((x) => x.def.type === 'chart' || x.def.type === 'info');
  if (target) {
    target.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(`Showing ${sym}`);
  } else {
    toast(`Showing ${sym}. Add a Price Chart or Stock Info widget to see it.`);
  }
}
lookup.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLookup(); });
lookup.addEventListener('change', doLookup);

// Dotted jargon terms open a short definition under the word; clicking elsewhere closes it.
const pop = must(document, '#term-pop');
let popFor: Element | null = null;
const closePop = () => { pop.hidden = true; popFor = null; };
document.addEventListener('click', (e) => {
  const t = hit(e, '.term[data-term]');
  if (!t) { if (!(e.target instanceof Node) || !pop.contains(e.target)) closePop(); return; }
  e.preventDefault();
  if (popFor === t) { closePop(); return; }
  const text = GLOSSARY[t.dataset.term!];
  if (!text) return;
  pop.innerHTML = `<b>${esc((t.textContent ?? '').replace(/[()]/g, ''))}</b>${esc(text)}`;
  pop.hidden = false;
  const r = t.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left + window.scrollX), window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
  popFor = t;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
window.addEventListener('resize', closePop);
document.addEventListener('scroll', closePop, true);

// ---------- welcome ----------
const welcome = must(document, '#welcome');
const dismissWelcome = () => { welcome.hidden = true; state.welcomeDismissed = true; persist(); };
must(document, '#welcome-close').addEventListener('click', dismissWelcome);
must(document, '#welcome-plan').addEventListener('click', () => {
  let entry = [...live.values()].find((x) => x.def.type === 'invest');
  if (!entry) {
    const w: WidgetState = { id: newId(), type: 'invest' };
    state.widgets.push(w);
    addWidget(w);
    syncLayout();
    entry = live.get(w.id);
  }
  entry?.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  entry?.instance.onPlan?.();
});

// ---------- status, ticker, symbol list ----------
const statusEl = must(document, '#market-status');
const updatedEl = must(document, '#updated');
const tickerEl = must(document, '#ticker');
const datalist = must(document, '#symbols');
let datalistCount = 0;

function paintStatus() {
  const s = marketStatus();
  statusEl.textContent = s.label;
  statusEl.className = `pill ${s.open ? 'open' : 'closed'}`;
}
setInterval(paintStatus, 30_000);
paintStatus();

market.subscribe((m) => {
  updatedEl.textContent = m.error && !m.updatedAt
    ? `Can't load prices: ${m.error}`
    : `Prices updated ${m.updatedAt?.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) ?? '…'}${m.error ? ' · retrying' : ''}`;

  if (m.stocks.length !== datalistCount) {
    datalistCount = m.stocks.length;
    datalist.innerHTML = m.stocks.map((s) => `<option value="${esc(s.symbol)} — ${esc(s.name)}">`).join('');
  }

  const psei = m.indices[0];
  const top = [...m.stocks].filter((s) => s.volume > 0).sort((a, b) => b.price * b.volume - a.price * a.volume).slice(0, 30);
  const items = [
    psei ? `<span class="ticker-item"><b>${esc(psei.name)}</b>${price(psei.value)} <span class="${dir(psei.percent)}">${pct(psei.percent)}</span></span>` : '',
    ...top.map((s) => `<span class="ticker-item" data-sym="${esc(s.symbol)}"><b>${esc(s.symbol)}</b>${price(s.price)} <span class="${dir(s.change)}">${pct(s.change)}</span></span>`),
  ].join('');
  // Duplicated so the CSS scroll loops seamlessly.
  tickerEl.innerHTML = `<div class="ticker-track">${items}${items}</div>`;
});
tickerEl.addEventListener('click', (e) => {
  const t = hit(e, '[data-sym]');
  if (t) app.show(t.dataset.sym!, t);
});

// ---------- boot ----------
(async () => {
  let saved = null;
  try {
    saved = await api.loadState();
  } catch (e) {
    console.error('Could not load saved dashboard', e);
  }
  // First run gets the default layout; an intentionally emptied dashboard stays empty.
  state = {
    widgets: Array.isArray(saved?.widgets) ? saved.widgets : defaultLayout(),
    positions: saved?.positions || [],
    welcomeDismissed: Boolean(saved?.welcomeDismissed),
  };
  welcome.hidden = state.welcomeDismissed;
  loadLayout(state.widgets);
  market.start();
})();
