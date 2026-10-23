import { esc, el, price, chg, compact, pickButton } from '../util.js';

const TABS = {
  gainers: { label: 'Up most', sort: (a, b) => b.change - a.change },
  losers: { label: 'Down most', sort: (a, b) => a.change - b.change },
  active: { label: 'Most traded', sort: (a, b) => b.price * b.volume - a.price * a.volume },
};

export default {
  type: 'movers',
  icon: '🚀',
  title: 'Top Movers',
  description: 'Today\'s biggest gainers, losers, and most-traded stocks',
  help: '"Up most" and "Down most" rank stocks by today\'s % change. "Most traded" ranks by peso value changed hands, which shows where most of the money went today. Tiny trades are ignored so a single odd trade doesn\'t top the list. Click a row to view that stock.',
  size: { w: 3, h: 8, minW: 2, minH: 4 },
  defaults: { tab: 'gainers', count: 15 },

  mount({ body, tools, config, save, app }) {
    let last = null;
    const tabs = el(`<div class="tabs" role="tablist">${Object.entries(TABS).map(([k, t]) => `<button role="tab" data-tab="${k}">${t.label}</button>`).join('')}</div>`);
    tools.prepend(tabs);
    const paintTabs = () => tabs.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === config.tab);
      b.setAttribute('aria-selected', b.dataset.tab === config.tab);
    });
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      config.tab = b.dataset.tab;
      save();
      paintTabs();
      render();
    });
    paintTabs();

    body.classList.add('flush');
    body.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) { app.addPick(pick.dataset.pick); return; }
      const row = e.target.closest('[data-sym]');
      if (row) app.show(row.dataset.sym, row);
    });

    function render() {
      if (!last) return;
      const traded = last.stocks.filter((s) => s.volume > 0 && s.price * s.volume >= 100_000);
      const rows = [...traded].sort(TABS[config.tab].sort).slice(0, config.count);
      body.innerHTML = `<table class="t">
        <thead><tr><th>Stock</th><th class="num">Price</th><th class="num">Today</th><th class="num hide-sm">Traded</th><th></th></tr></thead>
        <tbody>${rows.map((s) => `<tr class="click${app.focused === s.symbol ? ' selected' : ''}" data-sym="${esc(s.symbol)}" title="Click to view ${esc(s.symbol)}">
          <td><div class="sym">${esc(s.symbol)}</div><div class="name">${esc(s.name)}</div></td>
          <td class="num">${price(s.price)}</td>
          <td class="num">${chg(s.change)}</td>
          <td class="num muted hide-sm">₱${compact(s.price * s.volume)}</td>
          <td class="num">${pickButton(s.symbol, app.hasPick(s.symbol))}</td>
        </tr>`).join('')}</tbody></table>`;
    }

    return { onMarket(m) { last = m; render(); }, onFocus() { render(); }, onPositions() { render(); } };
  },
};
