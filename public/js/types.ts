// Types shared by the browser code and the server.

export interface Fees { commission: number; minCommission: number; vat: number; pse: number; sccp: number; salesTax: number; custodial: number }

export interface Stock { symbol: string; name: string; price: number; change: number; volume: number }
export interface Index { name: string; value: number | null; change: number; percent: number }

/** A saved "practice" position in My Picks. */
export interface Position { id: string; symbol: string; shares: number; price: number; fees: number; total: number; date: string }

export type WidgetConfig = Record<string, any>;

/** A widget as saved in data/state.json. Geometry is absent until GridStack places it. */
export interface WidgetState { id: string; type: string; x?: number; y?: number; w?: number; h?: number; config?: WidgetConfig }

export interface SavedState { widgets?: WidgetState[]; positions?: Position[]; welcomeDismissed?: boolean }

export interface StockDetail {
  symbol: string; company: string; status: string | null; boardLot: number | null; last: number | null; open: number | null;
  high: number | null; low: number | null; prevClose: number | null; prevCloseDate: string | null; change: string | null;
  volume: number | null; value: number | null; avgPrice: number | null; week52High: number | null; week52Low: number | null;
  pe: number | null; sectorPe: number | null; bookValue: number | null; pbv: number | null; marketCap: number | null;
  outstanding: number | null; freeFloat: number | null; listingDate: string | null; edgeUrl: string;
}

export interface Candle { time: string; open: number; high: number; low: number; close: number; value: number }

export interface CompanyProfile {
  symbol: string; company: string; description: string[]; sector: string | null; subsector: string | null;
  incorporated: string | null; auditor: string | null; transferAgent: string | null; address: string | null;
  phone: string | null; website: string | null; edgeUrl: string;
}

export interface NewsItem {
  title: string; link: string; source: string; summary?: string; company?: string;
  published: string | null; symbols: string[];
}
export interface NewsFeed { news: NewsItem[]; disclosures: NewsItem[]; failed: string[]; fetchedAt: string }

export interface PerformanceRow { symbol: string; name: string; '3M': number | null; '6M': number | null; lastClose: number; lastDate: string }
export interface PerformanceSnapshot {
  state: 'idle' | 'running' | 'ready'; done: number; total: number; results: PerformanceRow[]; asOf: string | null; error: string | null;
}

// ---- widgets ----

export interface MarketState {
  stocks: Stock[]; bySymbol: Map<string, Stock>; indices: Index[];
  asOf: string | null; indicesAsOf: string | null; updatedAt: Date | null; error: string | null;
}

/** What the dashboard offers to every widget. */
export interface App {
  focused: string | null;
  focus(sym: string): void;
  /** Click on a stock anywhere: point the chart/info widgets at it and open its detail modal. */
  show(sym: string, from?: Element | null): void;
  resolveSymbol(text: string): string | null;
  priceOf(sym: string): number | null;
  nameOf(sym: string): string;
  getPositions(): Position[];
  setPositions(list: Position[]): void;
  hasPick(sym: string): boolean;
  addPick(sym: string): Promise<void>;
  myStocks(): Set<string>;
}

export interface WidgetContext {
  body: HTMLElement;
  tools: HTMLElement;
  config: WidgetConfig;
  save(): void;
  setTitle(title: string): void;
  app: App;
}

/** The hooks a mounted widget can react to. */
export interface WidgetInstance {
  onMarket?(m: MarketState): void;
  onFocus?(sym: string): void;
  onPositions?(): void;
  onPlan?(sym?: string): void;
  destroy?(): void;
}

export interface WidgetDef {
  type: string; icon: string; title: string; description: string; help: string;
  size: { w: number; h: number; minW: number; minH: number };
  defaults: WidgetConfig;
  mount(ctx: WidgetContext): WidgetInstance | void;
}
