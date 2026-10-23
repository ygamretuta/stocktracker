import { api } from '../api.js';
import { el, esc, price, chg, compact, pct, dir, symbolInput, followToggle } from '../util.js';

const RANGES = ['1M', '3M', '6M', '1Y', '3Y', '5Y'];

export default {
  type: 'chart',
  icon: '📈',
  title: 'Price Chart',
  description: 'See how a stock\'s price moved over time',
  help: 'Each bar ("candle") is one trading day. Green means it closed higher than it opened, red means lower. The thin lines show that day\'s high and low. Bars at the bottom show how much was traded. Pick a time range at the top, and hover over the chart to see exact prices.',
  size: { w: 6, h: 6, minW: 3, minH: 4 },
  defaults: { symbol: 'JFC', range: '6M', linked: true },

  mount({ body, tools, config, save, setTitle }) {
    const LC = window.LightweightCharts;
    body.classList.add('flush');
    body.innerHTML = '<div class="chart-wrap"><div class="chart-legend"></div></div>';
    const wrap = body.firstElementChild;
    const legend = wrap.querySelector('.chart-legend');

    const input = symbolInput(config.symbol, (sym) => setSymbol(sym));
    const ranges = el(`<div class="tabs" title="Time range">${RANGES.map((r) => `<button data-r="${r}">${r}</button>`).join('')}</div>`);
    tools.prepend(input, ranges, followToggle(config, save));

    const paint = () => {
      ranges.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.r === config.range));
      setTitle(`Chart · ${config.symbol}`);
    };
    ranges.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      config.range = b.dataset.r;
      save();
      paint();
      load();
    });

    const chart = LC.createChart(wrap, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8b98a5', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(30,42,55,.6)' }, horzLines: { color: 'rgba(30,42,55,.6)' } },
      rightPriceScale: { borderColor: '#1e2a37' },
      timeScale: { borderColor: '#1e2a37' },
      crosshair: { mode: LC.CrosshairMode.Normal },
    });
    const candles = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#f04f4f', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#f04f4f',
    });
    const volume = chart.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' }, color: 'rgba(59,130,246,.35)' });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.16, bottom: 0.2 } });

    let data = [];
    let live = null;
    let reqId = 0;

    function showLegend(c) {
      if (c) {
        legend.innerHTML = `<b>${esc(config.symbol)}</b> <span class="muted">${c.time}</span>
          Open ${price(c.open)} · High ${price(c.high)} · Low ${price(c.low)} · Close ${price(c.close)}`;
        return;
      }
      const first = data[0], last = data[data.length - 1];
      const rangeChg = first && last ? ((last.close - first.close) / first.close) * 100 : null;
      legend.innerHTML = `<b>${esc(config.symbol)}</b> ${live ? `${price(live.price)} ${chg(live.change)} <span class="muted">today</span>` : ''}
        ${rangeChg != null ? `<span class="${dir(rangeChg)}" style="margin-left:6px">${pct(rangeChg)}</span> <span class="muted">over ${config.range}</span>` : ''}
        <div class="muted">${esc(live?.name || '')}</div>`;
    }
    chart.subscribeCrosshairMove((p) => showLegend(p.time ? data.find((d) => d.time === p.time) : null));

    async function load() {
      const id = ++reqId;
      legend.innerHTML = `<b>${esc(config.symbol)}</b> <span class="muted">loading…</span>`;
      try {
        const res = await api.history(config.symbol, config.range);
        if (id !== reqId) return;
        data = res.candles;
        candles.setData(data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
        volume.setData(data.map((d) => ({ time: d.time, value: d.value, color: d.close >= d.open ? 'rgba(34,197,94,.35)' : 'rgba(240,79,79,.35)' })));
        chart.timeScale().fitContent();
        if (!data.length) legend.innerHTML = `<b>${esc(config.symbol)}</b> <span class="muted">no trades in this period</span>`;
        else showLegend();
      } catch (e) {
        if (id === reqId) legend.innerHTML = `<b>${esc(config.symbol)}</b> <span class="w-error">${esc(e.message)}</span>`;
      }
    }

    let market = null;
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
      onMarket(m) {
        market = m;
        live = m.bySymbol.get(config.symbol) || null;
        // Keep today's candle in step with the live price.
        const last = data[data.length - 1];
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
        if (live && last && last.time === today) {
          last.close = live.price;
          last.high = Math.max(last.high, live.price);
          last.low = Math.min(last.low, live.price);
          candles.update({ time: last.time, open: last.open, high: last.high, low: last.low, close: last.close });
        }
        showLegend();
      },
      onFocus(sym) { if (config.linked && sym !== config.symbol) setSymbol(sym); },
      destroy() { chart.remove(); },
    };
  },
};
