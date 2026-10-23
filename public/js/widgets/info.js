import { api } from '../api.js';
import { esc, price, chg, compact, int, symbolInput, followToggle, term } from '../util.js';

export default {
  type: 'info',
  icon: 'ℹ️',
  title: 'Stock Info',
  description: 'Key facts about one stock',
  help: 'A quick fact sheet for one stock. "Board lot" is the smallest number of shares you can buy at once, and "Min. to buy" is what one board lot costs right now. The colored bar shows where today\'s price sits between the lowest and highest price of the past year. Click any dotted term to see what it means.',
  size: { w: 3, h: 6, minW: 2, minH: 4 },
  defaults: { symbol: 'JFC', linked: true },

  mount({ body, tools, config, save, setTitle, app }) {
    const input = symbolInput(config.symbol, (sym) => setSymbol(sym));
    tools.prepend(input, followToggle(config, save));

    let detail = null;
    let live = null;
    let market = null;
    let reqId = 0;

    const paint = () => setTitle(`Info · ${config.symbol}`);

    body.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) app.addPick(pick.dataset.pick);
    });

    function render() {
      if (!detail) return;
      const d = detail;
      const last = live?.price ?? d.last ?? d.prevClose;
      const pos = d.week52High > d.week52Low ? ((last - d.week52Low) / (d.week52High - d.week52Low)) * 100 : null;
      const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
      body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <div style="min-width:0">
            <div class="sym" style="font-size:16px">${esc(d.symbol)} ${d.status && d.status !== 'Open' ? `<span class="pill closed">${esc(d.status)}</span>` : ''}</div>
            <div class="muted small">${esc(d.company)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:20px;font-weight:700">${price(last)}</div>
            ${live ? chg(live.change) : ''}
          </div>
        </div>
        ${pos != null ? `
          <div class="small muted" style="margin-top:10px">${term('52-week range', '52w')}</div>
          <div class="range" title="Where today's price sits within the past year's range"><i style="left:${Math.min(100, Math.max(0, pos))}%"></i></div>
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
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn sm primary" data-pick="${esc(d.symbol)}">＋ Add to My Picks</button>
          <a class="btn sm ghost" href="${esc(d.edgeUrl)}" target="_blank" rel="noopener">PSE Edge page ↗</a>
        </div>`;
    }

    async function load() {
      const id = ++reqId;
      body.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const d = await api.stock(config.symbol);
        if (id !== reqId) return;
        detail = d;
        render();
      } catch (e) {
        if (id === reqId) body.innerHTML = `<div class="w-error">${esc(e.message)}</div>`;
      }
    }

    function setSymbol(sym) {
      config.symbol = sym;
      input.value = sym;
      live = market?.bySymbol.get(sym) || null;
      save();
      paint();
      load();
    }

    paint();
    load();

    return {
      onMarket(m) { market = m; live = m.bySymbol.get(config.symbol) || null; render(); },
      onFocus(sym) { if (config.linked && sym !== config.symbol) setSymbol(sym); },
    };
  },
};
