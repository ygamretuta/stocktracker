import { hit, esc, el, price, chg, compact, toast, pickButton } from '../util.ts';
import type { MarketState, WidgetDef } from '../types.ts';

export default {
  type: 'watchlist',
  icon: '⭐',
  title: 'Watchlist',
  description: 'Keep an eye on stocks you care about',
  help: 'Add stocks you want to follow. Each row shows the latest price and how much it moved today. Click a row to open that stock in the chart and info widgets. Use × to take a stock off the list.',
  size: { w: 3, h: 8, minW: 2, minH: 3 },
  defaults: { symbols: ['JFC', 'SM', 'BDO', 'ALI', 'AC', 'TEL', 'ICT', 'MER'] },

  mount({ body, tools, config, save, app }) {
    let last: MarketState | null = null;
    const form = el<HTMLFormElement>('<form class="inline-form"></form>');
    const input = el<HTMLInputElement>('<input class="field sym-input" list="symbols" placeholder="e.g. JFC" aria-label="Stock to add" spellcheck="false" autocomplete="off">');
    const addBtn = el('<button class="btn sm primary" type="submit">Add</button>');
    form.append(input, addBtn);
    tools.prepend(form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const sym = app.resolveSymbol(input.value);
      if (!sym) { if (input.value.trim()) toast(`Couldn't find "${input.value.trim()}".`); return; }
      input.value = '';
      if (config.symbols.includes(sym)) { toast(`${sym} is already on your watchlist`); return; }
      config.symbols.push(sym);
      save();
      render();
      toast(`Added ${sym} to your watchlist`);
    });

    body.classList.add('flush');
    body.addEventListener('click', (e) => {
      const pick = hit(e, '[data-pick]');
      if (pick) { app.addPick(pick.dataset.pick!); return; }
      const rm = hit(e, '[data-remove]');
      if (rm) {
        const sym = rm.dataset.remove;
        const at = config.symbols.indexOf(sym);
        config.symbols = config.symbols.filter((s: string) => s !== sym);
        save();
        render();
        toast(`Removed ${sym} from your watchlist`, { action: 'Undo', onAction: () => { config.symbols.splice(at, 0, sym); save(); render(); } });
        return;
      }
      const row = hit(e, '[data-sym]');
      if (row) app.show(row.dataset.sym!, row);
    });

    function render() {
      if (!last) return;
      if (!config.symbols.length) {
        body.innerHTML = '<div class="hint">Your watchlist is empty. Type a stock symbol above and click <b>Add</b>.</div>';
        return;
      }
      body.innerHTML = `<table class="t">
        <thead><tr><th>Stock</th><th class="num">Price</th><th class="num">Today</th><th class="num hide-sm">Volume</th><th></th><th></th></tr></thead>
        <tbody>${config.symbols.map((sym: string) => {
          const s = last?.bySymbol.get(sym);
          return `<tr class="click${app.focused === sym ? ' selected' : ''}" data-sym="${esc(sym)}" title="Click to view ${esc(sym)}">
            <td><div class="sym">${esc(sym)}</div><div class="name">${esc(s?.name || 'No trades today')}</div></td>
            <td class="num">${price(s?.price)}</td>
            <td class="num">${s ? chg(s.change) : '—'}</td>
            <td class="num muted hide-sm">${compact(s?.volume)}</td>
            <td class="num">${pickButton(sym, app.hasPick(sym))}</td>
            <td class="num"><button class="x" data-remove="${esc(sym)}" title="Remove ${esc(sym)} from watchlist" aria-label="Remove ${esc(sym)}">×</button></td>
          </tr>`;
        }).join('')}</tbody></table>
        <div class="hint">Tip: click a stock to see its chart.</div>`;
    }

    return { onMarket(m) { last = m; render(); }, onFocus() { render(); }, onPositions() { render(); } };
  },
} satisfies WidgetDef;
