import { api } from '../api.js';
import { esc, price, peso, signedPeso, int, pct, dir, chg, symbolInput, term, toast } from '../util.js';
import { DEFAULT_FEES, boardLot, plan, netSell, breakEven } from '../fees.js';

export default {
  type: 'invest',
  icon: '💰',
  title: 'Put Money On',
  description: 'Plan a purchase and track your picks',
  help: 'Choose a stock and how much money you\'d put in. It works out how many shares that buys (shares come in fixed bundles called board lots), the broker fees, and the price you\'d need to sell at just to break even. "Add to my picks" saves it on the right so you can watch how it does. This is practice tracking only and never buys anything; real purchases happen through your broker.',
  size: { w: 6, h: 9, minW: 4, minH: 6 },
  defaults: { symbol: 'JFC', amount: 10000, fees: DEFAULT_FEES },

  mount({ body, config, save, app }) {
    config.fees = { ...DEFAULT_FEES, ...config.fees };
    let market = null;
    let detail = null;
    let customPrice = null;

    body.innerHTML = `
      <div class="invest">
        <div class="form">
          <div class="step">
            <div class="step-label"><span class="step-num">1</span> Choose a stock</div>
            <span data-slot="sym"></span>
            <div class="small" data-out="quote">&nbsp;</div>
          </div>
          <div class="step">
            <div class="step-label"><span class="step-num">2</span> How much money?</div>
            <div class="peso-input"><input class="field" data-in="amount" type="number" min="0" step="500" inputmode="decimal" aria-label="Amount in pesos"></div>
            <div class="quick">${[5000, 10000, 25000, 50000, 100000].map((v) => `<button class="btn sm" data-amt="${v}">₱${v / 1000}K</button>`).join('')}</div>
          </div>
          <div class="step">
            <div class="step-label"><span class="step-num">3</span> Review</div>
            <div class="calc" data-out="calc"></div>
          </div>
          <div class="invest-cta">
            <button class="btn primary lg" data-act="add">＋ Add to my picks</button>
          </div>
          <details class="fees">
            <summary>Advanced: set my own price or broker fees</summary>
            <div class="fee-grid">
              <span>Buy price per share (blank = live price)</span><input class="field" data-in="price" type="number" min="0" step="0.01">
              <span>Commission %</span><input class="field" type="number" step="0.01" data-fee="commission">
              <span>Min. commission ₱</span><input class="field" type="number" step="1" data-fee="minCommission">
              <span>VAT on commission %</span><input class="field" type="number" step="0.1" data-fee="vat">
              <span>PSE fee %</span><input class="field" type="number" step="0.001" data-fee="pse">
              <span>SCCP fee %</span><input class="field" type="number" step="0.001" data-fee="sccp">
              <span>Sales tax when selling %</span><input class="field" type="number" step="0.01" data-fee="salesTax">
              <span>Custodial fee ₱/year (0 = none)</span><input class="field" type="number" step="1" data-fee="custodial">
            </div>
          </details>
        </div>
        <div class="positions">
          <h4>My picks ${term('(practice only)', 'practice')}</h4>
          <div class="scroll" data-out="positions"></div>
          <div class="summary" data-out="summary"></div>
          <p class="disclaimer">Nothing here buys real shares. Fees are estimates, so check your broker's actual rates.</p>
        </div>
      </div>`;

    const $ = (s) => body.querySelector(s);
    const amountIn = $('[data-in="amount"]');
    const priceIn = $('[data-in="price"]');
    const symIn = symbolInput(config.symbol, (sym) => setSymbol(sym), { placeholder: 'Type a symbol or company, e.g. JFC', label: 'Stock to buy' });
    symIn.style.width = '100%';
    symIn.style.textTransform = 'none';
    $('[data-slot="sym"]').replaceWith(symIn);
    amountIn.value = config.amount;
    body.querySelectorAll('[data-fee]').forEach((i) => { i.value = config.fees[i.dataset.fee]; });

    const livePrice = () => market?.bySymbol.get(config.symbol)?.price ?? detail?.last ?? detail?.prevClose ?? null;
    const buyPrice = () => customPrice ?? livePrice();
    const lotFor = (p) => (detail?.symbol === config.symbol && detail.boardLot) || boardLot(p);
    const current = () => {
      const p = buyPrice();
      return p ? plan(Number(config.amount), p, lotFor(p), config.fees) : null;
    };

    async function loadDetail() {
      const sym = config.symbol;
      detail = null;
      try {
        const d = await api.stock(sym);
        if (sym === config.symbol) detail = d;
      } catch { /* board lot falls back to the price table */ }
      renderPlan();
    }

    function setSymbol(sym) {
      config.symbol = sym;
      symIn.value = sym;
      customPrice = null;
      priceIn.value = '';
      save();
      loadDetail();
      renderPlan();
    }

    function renderPlan() {
      const s = market?.bySymbol.get(config.symbol);
      const name = s?.name || detail?.company || '';
      $('[data-out="quote"]').innerHTML = s
        ? `${esc(name)}<br><span class="muted">Price now</span> <b>₱${price(s.price)}</b> ${chg(s.change)} <span class="muted">today</span>`
        : esc(name) || '&nbsp;';
      const p = buyPrice();
      const out = $('[data-out="calc"]');
      const addBtn = $('[data-act="add"]');
      addBtn.disabled = true;
      if (!p) { out.innerHTML = '<span class="muted">No price yet for this stock.</span>'; return; }
      const lot = lotFor(p);
      const r = plan(Number(config.amount), p, lot, config.fees);
      if (!r) { out.innerHTML = '<span class="muted">Enter how much you\'d like to invest.</span>'; return; }
      if (!r.shares) {
        out.innerHTML = `<div class="warn">That's not enough for one ${term('board lot', 'board-lot')} of ${esc(config.symbol)} (${int(lot)} shares).<br>You'd need at least <b>${peso(r.oneLot)}</b>.</div>`;
        return;
      }
      addBtn.disabled = false;
      const be = breakEven(r.shares, r.total, config.fees);
      out.innerHTML = `
        <div class="headline">You can buy <b>${int(r.shares)} shares</b> of ${esc(config.symbol)} for <b>${peso(r.total)}</b>.</div>
        <div class="row"><span class="muted">${int(r.shares / lot)} × ${term('board lot', 'board-lot')} of ${int(lot)} at ₱${price(p)}</span><span>${peso(r.gross)}</span></div>
        <div class="row"><span class="muted">${term('Broker fees', 'fees')}</span><span>${peso(r.fee.total)}</span></div>
        <div class="row total"><span>Total you pay</span><span>${peso(r.total)}</span></div>
        <div class="row"><span class="muted">Money left over</span><span>${peso(r.left)}</span></div>
        ${config.fees.custodial > 0 ? `<div class="row"><span class="muted">Custodial fee (yearly, not in total)</span><span>${peso(config.fees.custodial)}</span></div>` : ''}
        <div class="row"><span class="muted">${term('Break-even price', 'break-even')}</span><span>₱${price(be)} <span class="muted small">(${pct(((be - p) / p) * 100)})</span></span></div>`;
    }

    function renderPositions() {
      const list = app.getPositions();
      const out = $('[data-out="positions"]');
      if (!list.length) {
        out.innerHTML = '<div class="empty-picks">No picks yet.<br>Follow steps 1–3 on the left, then click <b>Add to my picks</b> to start tracking how it would do.</div>';
        $('[data-out="summary"]').innerHTML = '';
        return;
      }
      let cost = 0, value = 0;
      const rows = list.map((pos) => {
        const last = market?.bySymbol.get(pos.symbol)?.price ?? pos.price;
        const net = netSell(pos.shares, last, config.fees);
        const pl = net - pos.total;
        cost += pos.total;
        value += net;
        return `<tr class="click" data-sym="${esc(pos.symbol)}" title="Click to view ${esc(pos.symbol)}">
          <td><div class="sym">${esc(pos.symbol)}</div><div class="name">${int(pos.shares)} shares @ ₱${price(pos.price)} · ${esc(pos.date)}</div></td>
          <td class="num">₱${price(last)}</td>
          <td class="num ${dir(pl)}">${signedPeso(pl, 0)}<div class="small">${pct((pl / pos.total) * 100)}</div></td>
          <td class="num"><button class="x" data-remove="${esc(pos.id)}" title="Remove this pick" aria-label="Remove ${esc(pos.symbol)} pick">×</button></td>
        </tr>`;
      });
      out.innerHTML = `<table class="t"><thead><tr><th>Pick</th><th class="num">Price now</th><th class="num">Gain/loss*</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
      const pl = value - cost;
      $('[data-out="summary"]').innerHTML = `
        <div><span>You put in</span><b>${peso(cost, 0)}</b></div>
        <div><span>Worth if sold now*</span><b>${peso(value, 0)}</b></div>
        <div><span>Total gain/loss</span><b class="${dir(pl)}">${signedPeso(pl, 0)} (${pct((pl / cost) * 100)})</b></div>
        <div class="muted small" style="align-self:end">*after estimated selling fees &amp; tax</div>`;
    }

    amountIn.addEventListener('input', () => { config.amount = Number(amountIn.value) || 0; save(); renderPlan(); });
    priceIn.addEventListener('input', () => { customPrice = Number(priceIn.value) || null; renderPlan(); });
    body.querySelectorAll('[data-fee]').forEach((i) => i.addEventListener('input', () => {
      config.fees[i.dataset.fee] = Number(i.value) || 0;
      save();
      renderPlan();
      renderPositions();
    }));
    body.addEventListener('click', (e) => {
      const amt = e.target.closest('[data-amt]');
      if (amt) { config.amount = Number(amt.dataset.amt); amountIn.value = config.amount; save(); renderPlan(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'add') {
        const p = buyPrice();
        const r = current();
        if (!r?.shares) return;
        app.setPositions([...app.getPositions(), {
          id: Math.random().toString(36).slice(2, 10),
          symbol: config.symbol, shares: r.shares, price: p, fees: r.fee.total, total: r.total,
          date: new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
        }]);
        toast(`Added ${int(r.shares)} ${config.symbol} shares to your picks`);
        return;
      }
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        const all = app.getPositions();
        const at = all.findIndex((x) => x.id === rm.dataset.remove);
        if (at < 0) return;
        const pos = all[at];
        app.setPositions(all.filter((x) => x.id !== pos.id));
        toast(`Removed ${pos.symbol} from your picks`, {
          action: 'Undo',
          onAction: () => { const now = app.getPositions(); app.setPositions([...now.slice(0, at), pos, ...now.slice(at)]); },
        });
        return;
      }
      const row = e.target.closest('[data-sym]');
      if (row) app.show(row.dataset.sym, row);
    });

    loadDetail();
    renderPositions();

    return {
      onMarket(m) { market = m; renderPlan(); renderPositions(); },
      onPositions() { renderPositions(); },
      // Lets other parts of the app (welcome card) pre-fill the planner.
      onPlan(sym) { if (sym) setSymbol(sym); symIn.focus(); body.scrollTop = 0; },
    };
  },
};
