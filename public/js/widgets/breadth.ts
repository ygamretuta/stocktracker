import { compact, term } from '../util.ts';
import type { WidgetDef } from '../types.ts';

export default {
  type: 'breadth',
  icon: '📊',
  title: 'Market Breadth',
  description: 'How many stocks went up vs down today',
  help: 'Breadth counts how many stocks rose versus fell today. When most stocks are green, the market is broadly strong. When the PSEi is up but most stocks are red, only a few big companies are carrying it.',
  size: { w: 3, h: 4, minW: 2, minH: 3 },
  defaults: {},

  mount({ body }) {
    return {
      onMarket(m) {
        if (!m.stocks.length) return;
        const traded = m.stocks.filter((s) => s.volume > 0);
        const up = traded.filter((s) => s.change > 0).length;
        const down = traded.filter((s) => s.change < 0).length;
        const flat = traded.length - up - down;
        const value = traded.reduce((sum, s) => sum + s.price * s.volume, 0);
        const total = traded.length || 1;
        body.innerHTML = `
          <div class="bar" role="img" aria-label="${up} up, ${flat} unchanged, ${down} down">
            <div style="width:${(up / total) * 100}%;background:var(--up)"></div>
            <div style="width:${(flat / total) * 100}%;background:var(--flat);opacity:.5"></div>
            <div style="width:${(down / total) * 100}%;background:var(--down)"></div>
          </div>
          <div class="legend small">
            <span class="up">▲ ${up} up</span>
            <span class="flat">${flat} unchanged</span>
            <span class="down">▼ ${down} down</span>
          </div>
          <div class="stat-grid" style="margin-top:12px">
            <div class="stat"><div class="k">Stocks traded</div><div class="v">${traded.length}</div></div>
            <div class="stat"><div class="k">${term('Value traded', 'value-traded')} (approx.)</div><div class="v">₱${compact(value)}</div></div>
          </div>`;
      },
    };
  },
} satisfies WidgetDef;
