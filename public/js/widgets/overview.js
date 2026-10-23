import { esc, price, chg, dir, pct, term } from '../util.js';

export default {
  type: 'overview',
  icon: '🏛',
  title: 'Market Overview',
  description: 'How the whole market is doing today',
  help: 'The PSEi is the main index: one number that tracks the 30 biggest Philippine companies. Green means the market is up today, red means it is down. Below it are sector indices, which track groups of companies in the same industry.',
  size: { w: 3, h: 6, minW: 2, minH: 4 },
  defaults: {},

  mount({ body }) {
    return {
      onMarket(m) {
        if (!m.indices.length) {
          body.innerHTML = m.error ? `<div class="w-error">${esc(m.error)}</div>` : '<div class="loading">Loading indices…</div>';
          return;
        }
        const [main, ...rest] = m.indices;
        body.innerHTML = `
          <div class="muted small">${term('PSEi', 'psei')} (main index)</div>
          <div class="big ${dir(main.change)}">${price(main.value)}</div>
          <div class="${dir(main.change)}" style="font-weight:600;margin-bottom:10px">
            ${main.change > 0 ? '▲ +' : main.change < 0 ? '▼ ' : ''}${price(main.change)} (${pct(main.percent)}) today
          </div>
          <div class="muted small" style="margin-bottom:4px">${term('Sector indices', 'sectors')}</div>
          ${rest.map((i) => `
            <div class="idx-row">
              <span>${esc(i.name)}</span>
              <span>${price(i.value)} ${chg(i.percent)}</span>
            </div>`).join('')}
          <div class="muted small" style="margin-top:8px">As of ${esc(m.indicesAsOf || '—')}</div>`;
      },
    };
  },
};
