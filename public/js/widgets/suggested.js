import { api } from '../api.js';
import { el, esc, price, pct, dir, pickButton } from '../util.js';

const WINDOWS = ['3M', '6M'];

export default {
  type: 'suggested',
  icon: '🏆',
  title: 'Suggested Picks',
  description: 'Best 3–6 month performers, and what\'s getting the most news',
  help: '"Best performers" ranks the most actively traded stocks by how much their price rose over the last 3 or 6 months. "In the news" counts how many recent stories and company filings mention each stock. Both are simple screens of past data: they are not predictions or advice, and a stock that rose recently can fall just as easily. Click a row for details, or ＋ Pick to track it.',
  size: { w: 6, h: 9, minW: 3, minH: 5 },
  defaults: { window: '3M' },

  mount({ body, tools, config, save, app }) {
    let perf = null;
    let news = null;
    let perfError = null;
    let timer = null;

    const tabs = el(`<div class="tabs" title="Look-back period">${WINDOWS.map((w) => `<button data-w="${w}">${w}</button>`).join('')}</div>`);
    tools.prepend(tabs);
    const paintTabs = () => tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.w === config.window));
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      config.window = b.dataset.w;
      save();
      paintTabs();
      render();
    });
    paintTabs();

    body.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) { app.addPick(pick.dataset.pick); return; }
      const row = e.target.closest('[data-sym]');
      if (row) app.show(row.dataset.sym, row);
    });

    const row = (sym, name, right, extra = '') => `
      <tr class="click" data-sym="${esc(sym)}" title="Click to view ${esc(sym)}">
        <td><div class="sym">${esc(sym)}</div><div class="name">${esc(name)}</div></td>
        <td class="num">${right}</td>
        <td class="num">${extra}</td>
        <td class="num">${pickButton(sym, app.hasPick(sym))}</td>
      </tr>`;

    // Stocks named in the most recent stories and filings.
    function attention() {
      if (!news) return [];
      const counts = new Map();
      for (const n of [...news.news, ...news.disclosures]) for (const s of n.symbols || []) counts.set(s, (counts.get(s) || 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
    }

    function render() {
      const w = config.window;
      let top = '';
      if (perf?.results?.length) {
        const rows = perf.results.filter((r) => r[w] != null).sort((a, b) => b[w] - a[w]).slice(0, 5);
        top = rows.length
          ? `<table class="t"><thead><tr><th>Stock</th><th class="num">Last ${w}</th><th class="num">Price</th><th></th></tr></thead>
              <tbody>${rows.map((r) => row(r.symbol, r.name, `<span class="${dir(r[w])}">${pct(r[w])}</span>`, price(app.priceOf(r.symbol) ?? r.lastClose))).join('')}</tbody></table>`
          : '<div class="hint">Not enough price history to rank this period.</div>';
      } else if (perf?.state === 'running') {
        top = `<div class="hint">Crunching ${w} price history… ${perf.done}/${perf.total || '…'} stocks done</div>`;
      } else if (perfError || perf?.error) {
        top = `<div class="hint w-error">Couldn't rank performance: ${esc(perfError || perf.error)}</div>`;
      } else {
        top = '<div class="hint">Loading…</div>';
      }

      const att = attention();
      const bottom = news
        ? (att.length
          ? `<table class="t"><thead><tr><th>Stock</th><th class="num">Mentions</th><th></th><th></th></tr></thead>
              <tbody>${att.map(([s, c]) => row(s, app.nameOf(s), String(c), app.priceOf(s) != null ? `${price(app.priceOf(s))}` : '')).join('')}</tbody></table>`
          : '<div class="hint">No recent stories or filings mention a listed stock.</div>')
        : '<div class="hint">Loading…</div>';

      body.innerHTML = `
        <h4 class="sub">Best performers · last ${w}</h4>${top}
        <h4 class="sub">In the news · recent stories &amp; filings</h4>${bottom}
        <p class="disclaimer">Screens of past data, not predictions or advice. Rankings cover the most actively traded stocks${perf?.asOf ? `, updated ${new Date(perf.asOf).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}` : ''}. Past performance doesn't guarantee future results.</p>`;
    }

    async function loadPerf() {
      clearTimeout(timer);
      try {
        perf = await api.performance();
        perfError = null;
      } catch (e) {
        perfError = e.message;
      }
      render();
      // While the server is still building the ranking, check back every few seconds.
      if (perf?.state === 'running') timer = setTimeout(loadPerf, 3000);
    }
    async function loadNews() {
      try { news = await api.news(); } catch { /* keep any earlier result */ }
      render();
    }

    render();
    loadPerf();
    loadNews();
    const refresh = setInterval(() => { loadPerf(); loadNews(); }, 10 * 60_000);

    return {
      onMarket() { if (perf || news) render(); },
      onPositions() { render(); },
      destroy() { clearTimeout(timer); clearInterval(refresh); },
    };
  },
};
