// Stock detail modal: price, key facts, a 6-month chart, the company profile and recent news.
import { api, market } from './api.js';
import { esc, price, chg, compact, int, term, pickButton } from './util.js';

const root = document.getElementById('stock-modal');
let reqId = 0;
let chart = null;
let opener = null;
let current = null;

function close() {
  root.hidden = true;
  root.innerHTML = '';
  chart?.remove();
  chart = null;
  reqId++;
  current = null;
  document.body.classList.remove('modal-open');
  opener?.focus?.();
  opener = null;
}

const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
const failed = (what, e) => `<div class="w-error">Couldn't load ${what}: ${esc(e?.message || 'unknown error')}</div>`;

function renderFacts(d, live) {
  const last = live?.price ?? d.last ?? d.prevClose;
  const pos = d.week52High > d.week52Low ? ((last - d.week52Low) / (d.week52High - d.week52Low)) * 100 : null;
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

function renderCompany(c) {
  const row = (k, v) => (v ? `<div class="kv"><span class="muted">${k}</span><span>${v}</span></div>` : '');
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

function renderNews(items) {
  if (!items.length) return '<div class="muted small">No recent stories or announcements mention this stock.</div>';
  return `<ul class="mnews">${items.map((n) => `<li>
      <a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
      <span class="muted small">${esc(n.source)}${n.published ? ' · ' + new Date(n.published).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : ''}</span>
    </li>`).join('')}</ul>`;
}

function drawChart(host, candles) {
  const LC = window.LightweightCharts;
  chart?.remove();
  chart = LC.createChart(host, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: '#8b98a5', fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(30,42,55,.6)' } },
    rightPriceScale: { borderColor: '#1e2a37' },
    timeScale: { borderColor: '#1e2a37' },
  });
  const up = candles.at(-1).close >= candles[0].close;
  const color = up ? '#22c55e' : '#f04f4f';
  const series = chart.addAreaSeries({ lineColor: color, topColor: up ? 'rgba(34,197,94,.25)' : 'rgba(240,79,79,.25)', bottomColor: 'transparent', lineWidth: 2 });
  series.setData(candles.map((c) => ({ time: c.time, value: c.close })));
  chart.timeScale().fitContent();
}

// Re-draws the modal's pick button, e.g. after the stock was added to My Picks.
export function syncPickButton(app) {
  const slot = root.querySelector('[data-pickslot]');
  if (current && slot) slot.innerHTML = pickButton(current, app.hasPick(current), '＋ Add to My Picks', 'btn primary');
}

export function openStock(sym, app, from = document.activeElement) {
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
      <div class="modal-body">
        <section><div class="modal-chart" data-chart><div class="loading">Loading chart…</div></div></section>
        <section><h3>Key facts</h3><div data-facts><div class="loading">Loading…</div></div></section>
        <section><h3>About the company</h3><div data-company><div class="loading">Loading…</div></div></section>
        <section><h3>Recent news &amp; announcements</h3><div data-news><div class="loading">Loading…</div></div></section>
      </div>
      <footer class="modal-foot">
        <span data-pickslot></span>
        <a class="btn" data-edge target="_blank" rel="noopener" hidden>PSE Edge ↗</a>
      </footer>
    </div>`;
  const $ = (q) => root.querySelector(q);
  const dialog = $('.modal');
  dialog.focus();
  current = sym;
  syncPickButton(app);
  $('[data-pickslot]').addEventListener('click', (e) => { if (e.target.closest('[data-pick]')) app.addPick(sym); });

  const fill = (q, html) => { if (id === reqId) $(q).innerHTML = html; };
  const live = () => market.bySymbol.get(sym);

  api.stock(sym).then((d) => {
    if (id !== reqId) return;
    if (d.company) $('[data-name]').textContent = d.company;
    $('[data-edge]').href = d.edgeUrl;
    $('[data-edge]').hidden = false;
    $('[data-price]').textContent = price(live()?.price ?? d.last ?? d.prevClose);
    fill('[data-facts]', renderFacts(d, live()));
  }).catch((e) => fill('[data-facts]', failed('key facts', e)));

  api.company(sym).then((c) => fill('[data-company]', renderCompany(c)))
    .catch((e) => fill('[data-company]', failed('company details', e)));

  api.history(sym, '6M').then(({ candles }) => {
    if (id !== reqId) return;
    if (!candles.length) { $('[data-chart]').innerHTML = '<div class="muted small">No price history.</div>'; return; }
    $('[data-chart]').innerHTML = '';
    drawChart($('[data-chart]'), candles);
  }).catch((e) => fill('[data-chart]', failed('the chart', e)));

  api.news().then((n) => {
    const items = [...n.disclosures, ...n.news].filter((x) => x.symbols?.includes(sym))
      .sort((a, b) => (b.published || '').localeCompare(a.published || '')).slice(0, 6);
    fill('[data-news]', renderNews(items));
  }).catch((e) => fill('[data-news]', failed('news', e)));
}

root.addEventListener('click', (e) => {
  if (e.target === root || e.target.closest('[data-close]')) close();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || root.hidden) return;
  // The glossary popover handles its own Escape first.
  if (!document.getElementById('term-pop').hidden) return;
  close();
});
// Keep Tab inside the dialog while it is open.
root.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const items = [...root.querySelectorAll('a[href]:not([hidden]), button:not([disabled])')];
  if (!items.length) return;
  const first = items[0], last = items.at(-1);
  if (e.shiftKey && (document.activeElement === first || document.activeElement === root.querySelector('.modal'))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
