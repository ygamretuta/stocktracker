// Stock detail modal: price, key facts, a 6-month chart, the company profile and recent news.
import { api, market } from './api.ts';
import type { IChartApi } from 'lightweight-charts';
import type { App, Candle, CompanyProfile, NewsItem, Stock, StockDetail } from './types.ts';
import { hit, must, errText, esc, price, chg, compact, int, term, pickButton } from './util.ts';

const root = must(document, '#stock-modal');
let reqId = 0;
let chart: IChartApi | null = null;
let opener: Element | null = null;
let current: string | null = null;

// Keep the header price moving while the modal is open.
market.subscribe((mk) => {
  const q = current && mk.bySymbol.get(current);
  if (!q || root.hidden) return;
  const p = root.querySelector('[data-price]');
  const c = root.querySelector('[data-chg]');
  if (p) p.textContent = price(q.price);
  if (c) c.innerHTML = chg(q.change);
});

function close() {
  root.hidden = true;
  root.innerHTML = '';
  chart?.remove();
  chart = null;
  reqId++;
  current = null;
  document.body.classList.remove('modal-open');
  if (opener instanceof HTMLElement) opener.focus();
  opener = null;
}

const spinner = (label: string): string => `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>${label}</div>`;
const stat = (k: string, v: string | number): string => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
const failed = (what: string, e: unknown): string => `<div class="w-error">Couldn't load ${what}: ${esc(errText(e) || 'unknown error')}</div>`;

function renderFacts(d: StockDetail, live: Stock | undefined): string {
  const last = live?.price ?? d.last ?? d.prevClose;
  const { week52High: hi, week52Low: lo } = d;
  const pos = hi != null && lo != null && last != null && hi > lo ? ((last - lo) / (hi - lo)) * 100 : null;
  return `
    ${pos != null ? `
      <div class="small muted">${term('52-week range', '52w')}</div>
      <div class="range"><i style="left:${Math.min(100, Math.max(0, pos))}%"></i></div>
      <div class="legend small muted"><span>Low ${price(d.week52Low)}</span><span>High ${price(d.week52High)}</span></div>` : ''}
    <div class="stat-grid" style="margin-top:12px">
      ${stat(term('Board lot', 'board-lot'), `${int(d.boardLot)} shares`)}
      ${stat('Min. to buy (1 lot)', last && d.boardLot ? '₱' + compact(last * d.boardLot) : '—')}
      ${stat(term('Open', 'open'), price(d.open))}
      ${stat(term('Prev. close', 'prev-close'), price(d.prevClose))}
      ${stat('Day high', price(d.high))}
      ${stat('Day low', price(d.low))}
      ${stat(term('Volume', 'volume'), compact(d.volume))}
      ${stat(term('Value traded', 'value-traded'), '₱' + compact(d.value))}
      ${stat(term('P/E', 'pe'), d.pe ?? '—')}
      ${stat(term('P/BV', 'pbv'), d.pbv ?? '—')}
      ${stat(term('Market cap', 'market-cap'), '₱' + compact(d.marketCap))}
      ${stat(term('Free float', 'free-float'), d.freeFloat != null ? d.freeFloat + '%' : '—')}
    </div>`;
}

function renderCompany(c: CompanyProfile): string {
  const row = (k: string, v: string | null): string => (v ? `<div class="kv"><span class="muted">${k}</span><span>${v}</span></div>` : '');
  const sector = [c.sector, c.subsector].filter(Boolean).join(' · ');
  return `
    ${c.description.length ? `<div class="about">${c.description.map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
    <div class="kvs">
      ${row('Sector', esc(sector))}
      ${row('Incorporated', esc(c.incorporated))}
      ${row('Address', esc(c.address))}
      ${row('Phone', esc(c.phone))}
      ${row('Auditor', esc(c.auditor))}
      ${row('Transfer agent', esc(c.transferAgent))}
      ${c.website ? row('Website', `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''))} ↗</a>`) : ''}
    </div>`;
}

function renderNews(items: NewsItem[]): string {
  if (!items.length) return '<div class="muted small">No recent stories or announcements mention this stock.</div>';
  return `<ul class="mnews">${items.map((n) => `<li>
      <a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
      <span class="muted small">${esc(n.source)}${n.published ? ' · ' + new Date(n.published).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : ''}</span>
    </li>`).join('')}</ul>`;
}

function drawChart(host: HTMLElement, candles: Candle[]): void {
  const LC = window.LightweightCharts;
  chart?.remove();
  chart = LC.createChart(host, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: '#8b98a5', fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(30,42,55,.6)' } },
    rightPriceScale: { borderColor: '#1e2a37' },
    timeScale: { borderColor: '#1e2a37' },
  });
  const first = candles[0];
  const lastCandle = candles.at(-1);
  if (!first || !lastCandle) return;
  const up = lastCandle.close >= first.close;
  const color = up ? '#22c55e' : '#f04f4f';
  const series = chart.addAreaSeries({ lineColor: color, topColor: up ? 'rgba(34,197,94,.25)' : 'rgba(240,79,79,.25)', bottomColor: 'transparent', lineWidth: 2 });
  series.setData(candles.map((c) => ({ time: c.time, value: c.close })));
  chart.timeScale().fitContent();
}

// Re-draws the modal's pick button, e.g. after the stock was added to My Picks.
export function syncPickButton(app: App): void {
  const slot = root.querySelector('[data-pickslot]');
  if (current && slot) slot.innerHTML = pickButton(current, app.hasPick(current), '＋ Add to My Picks', 'btn primary');
}

export function openStock(sym: string, app: App, from: Element | null = document.activeElement): void {
  const id = ++reqId;
  opener = from;
  const s = market.bySymbol.get(sym);
  root.hidden = false;
  document.body.classList.add('modal-open');
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
      <header class="modal-head">
        <div style="min-width:0">
          <h2 id="modal-title">${esc(sym)}</h2>
          <div class="muted small" data-name>${esc(s?.name || '')}</div>
        </div>
        <div class="modal-price"><b data-price>${price(s?.price)}</b> <span data-chg>${s ? chg(s.change) : ''}</span></div>
        <button class="icon-btn" data-close aria-label="Close" title="Close (Esc)">✕</button>
      </header>
      <div class="modal-progress" data-progress aria-hidden="true"></div>
      <div class="modal-body">
        <section><div class="modal-chart" data-chart>${spinner('Loading chart…')}</div></section>
        <section><h3>Key facts</h3><div data-facts>${spinner('Loading…')}</div></section>
        <section><h3>About the company</h3><div data-company>${spinner('Loading…')}</div></section>
        <section><h3>Recent news &amp; announcements</h3><div data-news>${spinner('Loading…')}</div></section>
      </div>
      <footer class="modal-foot">
        <span data-pickslot></span>
        <a class="btn" data-edge target="_blank" rel="noopener" hidden>PSE Edge ↗</a>
      </footer>
    </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(q: string): T => must<T>(root, q);
  const dialog = $('.modal');
  dialog.focus();
  current = sym;
  syncPickButton(app);
  $('[data-pickslot]').addEventListener('click', (e) => { if (hit(e, '[data-pick]')) app.addPick(sym); });

  const fill = (q: string, html: string): void => { if (id === reqId) $(q).innerHTML = html; };
  const live = () => market.bySymbol.get(sym);

  const jobs = [];
  jobs.push(api.stock(sym).then((d) => {
    if (id !== reqId) return;
    if (d.company) $('[data-name]').textContent = d.company;
    $<HTMLAnchorElement>('[data-edge]').href = d.edgeUrl;
    $('[data-edge]').hidden = false;
    $('[data-price]').textContent = price(live()?.price ?? d.last ?? d.prevClose);
    fill('[data-facts]', renderFacts(d, live()));
  }).catch((e) => fill('[data-facts]', failed('key facts', e))));

  jobs.push(api.company(sym).then((c) => fill('[data-company]', renderCompany(c)))
    .catch((e) => fill('[data-company]', failed('company details', e))));

  jobs.push(api.history(sym, '6M').then(({ candles }) => {
    if (id !== reqId) return;
    if (!candles.length) { $('[data-chart]').innerHTML = '<div class="muted small">No price history.</div>'; return; }
    $('[data-chart]').innerHTML = '';
    drawChart($('[data-chart]'), candles);
  }).catch((e) => fill('[data-chart]', failed('the chart', e))));

  jobs.push(api.news().then((n) => {
    const items = [...n.disclosures, ...n.news].filter((x) => x.symbols?.includes(sym))
      .sort((a, b) => (b.published || '').localeCompare(a.published || '')).slice(0, 6);
    fill('[data-news]', renderNews(items));
  }).catch((e) => fill('[data-news]', failed('news', e))));

  // The progress bar under the header runs until every section has settled.
  Promise.allSettled(jobs).then(() => { if (id === reqId) $('[data-progress]')?.remove(); });
}

root.addEventListener('click', (e) => {
  if (e.target === root || hit(e, '[data-close]')) close();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || root.hidden) return;
  // The glossary popover handles its own Escape first.
  if (!must(document, '#term-pop').hidden) return;
  close();
});
// Keep Tab inside the dialog while it is open.
root.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const items = [...root.querySelectorAll<HTMLElement>('a[href]:not([hidden]), button:not([disabled])')];
  const first = items[0], last = items.at(-1);
  if (!first || !last) return;
  if (e.shiftKey && (document.activeElement === first || document.activeElement === root.querySelector('.modal'))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
