import { api } from '../api.js';
import { el, esc } from '../util.js';

const REFRESH_EVERY = 5 * 60_000;
const TABS = { news: 'Market news', disclosures: 'Company announcements' };

function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

export default {
  type: 'news',
  icon: '📰',
  title: 'PSE News',
  description: 'Market news and official company announcements',
  help: '"Market news" collects stock-market stories from Philippine business news sites (BusinessWorld, Inquirer, Philstar, Manila Times, Rappler). "Company announcements" are official filings companies post to the PSE, like earnings, dividends, and board changes. Click a headline to read it in a new tab, or a stock tag to see that stock\'s chart. Tick "My stocks only" to see just your watchlist, picks, and the stock you\'re viewing.',
  size: { w: 6, h: 9, minW: 3, minH: 4 },
  defaults: { tab: 'news', mineOnly: false },

  mount({ body, tools, config, save, app }) {
    let data = null;
    let error = null;

    const tabs = el(`<div class="tabs" role="tablist">${Object.entries(TABS).map(([k, t]) => `<button role="tab" data-tab="${k}">${t}</button>`).join('')}</div>`);
    const mine = el('<label class="follow" title="Show only news about your watchlist, your picks, and the stock you\'re viewing"><input type="checkbox"> My stocks only</label>');
    mine.querySelector('input').checked = config.mineOnly;
    tools.prepend(tabs, mine);

    const paintTabs = () => tabs.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === config.tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === config.tab));
    });
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      config.tab = b.dataset.tab;
      save();
      paintTabs();
      render();
    });
    mine.querySelector('input').addEventListener('change', (e) => { config.mineOnly = e.target.checked; save(); render(); });
    paintTabs();

    body.classList.add('flush');
    body.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-sym]');
      if (chip) { e.preventDefault(); app.focus(chip.dataset.sym); }
    });

    function render() {
      if (error && !data) { body.innerHTML = `<div class="hint w-error">Couldn't load news: ${esc(error)}</div>`; return; }
      if (!data) { body.innerHTML = '<div class="hint">Loading news…</div>'; return; }
      let items = config.tab === 'news' ? data.news : data.disclosures;
      const my = app.myStocks();
      if (config.mineOnly) items = items.filter((n) => n.symbols.some((s) => my.has(s)));

      if (!items.length) {
        body.innerHTML = `<div class="hint">${config.mineOnly
          ? 'Nothing about your stocks right now. Untick <b>My stocks only</b> to see everything, or add stocks to your watchlist.'
          : 'No items right now. Check back later.'}</div>`;
        return;
      }
      body.innerHTML = `<ul class="news-list">${items.map((n) => `
        <li class="news-item">
          <a class="news-title" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
          ${n.company ? `<div class="news-company">${esc(n.company)}</div>` : ''}
          ${n.summary ? `<div class="news-summary">${esc(n.summary)}</div>` : ''}
          <div class="news-meta">
            <span>${esc(n.source)} · ${esc(ago(n.published))}</span>
            ${n.symbols.map((s) => `<button class="chip${my.has(s) ? ' mine' : ''}" data-sym="${esc(s)}" title="View ${esc(s)}">${esc(s)}</button>`).join('')}
          </div>
        </li>`).join('')}</ul>
        ${data.failed?.length ? `<div class="hint">Couldn't reach: ${esc(data.failed.join(', '))}</div>` : ''}`;
    }

    async function load() {
      try {
        data = await api.news();
        error = null;
      } catch (e) {
        error = e.message;
      }
      render();
    }

    render();
    load();
    const timer = setInterval(load, REFRESH_EVERY);

    return {
      // Re-render so "My stocks only" and highlighted tags follow the selected stock.
      onFocus() { if (data) render(); },
      onPositions() { if (data) render(); },
      destroy() { clearInterval(timer); },
    };
  },
};
