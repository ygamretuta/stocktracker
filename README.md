# PSE Tracker

A local-only dashboard for the Philippine Stock Exchange. Widgets can be dragged, resized, added, and removed.

## Run

```bash
npm install
npm start
```

Open http://localhost:5173.

To open it to other devices on your home Wi-Fi (phone, tablet), run `npm run start:lan` and visit `http://<your-mac's-ip>:5173`.
The local server is for your own machine. For a public copy, see Deploying below.

## Development

Written in TypeScript 7 (the native `tsc`), with strict type checking.

```bash
npm run typecheck   # tsc --noEmit over the server, browser code and tests
npm test            # fee math, PSE Edge parsers, state validation, ranking, polling
npm run check       # both
npm run build:watch # recompile the browser code on save
```

- The server (`server.ts`, `news.ts`, ...) runs directly on Node's built-in TypeScript support, so there is no server build step. Requires Node 22.18+.
- The browser code in `public/js/` is compiled to `dist/js/` by `npm run build`, which `npm start` runs for you.
- Type-aware ESLint isn't set up: typescript-eslint doesn't support TypeScript 7 yet. `npm run typecheck` also flags unused variables and parameters.

## Deploying to Vercel

`vercel.json` builds the static site into `dist/public` and serves the API (`handler.ts`) as one serverless function in the Singapore region, close to the PSE.

```bash
vercel --prod
```

Differences from running locally:

- **Layout and picks are saved in each visitor's browser** (localStorage), not on a server, so every visitor has their own dashboard.
- **API responses are cached by Vercel's CDN** (8 seconds for prices up to an hour for rankings), so many visitors share one fetch to the free data sources.
- **Suggested Picks** ranks 30 stocks instead of 40, and the first request after the cache expires waits for the ranking to build.
- The data sources are unofficial. If one blocks the host's IP addresses, that part of the dashboard shows an error.

## Using the dashboard

- **Look up a stock** with the search box at the top (ticker or company name).
- **Drag any widget by its title bar** (the ⠿ grip) to rearrange the dashboard, and drag its bottom-right corner to resize it. The layout saves automatically. On phones widgets stack in one column and stay put.
- **Edit layout** shows Remove buttons and a Reset to default option.
- **+ Add widget** adds another panel. **?** on any widget explains what it shows.
- Words with a dotted underline (board lot, P/E, break-even…) show a plain-language definition when clicked.
- Removing a pick, a watchlist stock, or a widget can be undone from the message that pops up.

## Widgets

| Widget | What it does |
| --- | --- |
| **Put Money On** | Pick a stock and a peso amount. It works out how many shares you can buy in whole board lots, the broker fees, cash left over, and break-even price. *Add to my picks* tracks the position with live P/L (after estimated sell fees and tax). Paper tracking only, it never places orders. |
| **Price Chart** | Daily candlesticks and value traded, 1M–5Y. |
| **Stock Info** | Board lot, minimum buy, 52-week range, P/E, market cap, link to PSE Edge. |
| **Watchlist** | Your symbols with live price and % change. |
| **Top Movers** | Gainers / losers / most active (by value). |
| **Market Overview** | PSEi plus sector indices. |
| **Market Breadth** | Advancers vs decliners. |
| **PSE News** | Stock-market stories from BusinessWorld, Inquirer, Philstar, Manila Times and Rappler (filtered to market news), plus official company announcements from PSE Edge. Stories are tagged with the stocks they mention; *My stocks only* narrows it to your watchlist and picks. Refreshes every 5 minutes. |

Click any stock in the watchlist, movers, ticker, or your picks, and every chart/info widget with **Follow selection** ticked switches to it.

## Data

- Prices for all listed stocks: [phisix API](https://phisix-api3.appspot.com/stocks.json), polled every 30s
- Indices, stock details, price history: [PSE Edge](https://edge.pse.com.ph) (also company announcements)
- News: the public RSS feeds of the news sites above

Both are free, unofficial sources. Quotes may lag the exchange by a few minutes, so confirm with your broker before trading.

Your layout, watchlists, and picks are saved to `data/state.json`. Delete it to start over.

Fee defaults (editable in the widget) match BPI Trade's published schedule: 0.25% commission (₱20 min), 12% VAT on commission, 0.005% PSE fee, 0.01% SCCP fee, and 0.1% stock transaction tax on sells (cut from 0.6% by the CMEPA law, effective July 1, 2025). The ₱120/year custodial fee is shown as a separate yearly cost in the planner (set it to 0 to hide it); it isn't part of the per-trade total or break-even.
