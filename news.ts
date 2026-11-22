// PSE-relevant news: business RSS feeds filtered to market stories, plus official
// company announcements from PSE Edge. Each item is tagged with the listed stocks it mentions.

import type { NewsFeed, NewsItem, Stock } from './public/js/types.ts';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const EDGE = 'https://edge.pse.com.ph';

interface Feed { source: string; url: string; alwaysRelevant?: boolean; manilaTimeAsUtc?: boolean }
interface Matcher { find(text: string): string[]; byCompanyName(name: string): string | null }

const FEEDS: Feed[] = [
  // BusinessWorld's stock-market section is all PSE news, so nothing is filtered out.
  { source: 'BusinessWorld', url: 'https://www.bworldonline.com/stock-market/feed/', alwaysRelevant: true },
  // Inquirer stamps Manila local time with a UTC (+0000) offset.
  { source: 'Inquirer', url: 'https://business.inquirer.net/feed', manilaTimeAsUtc: true },
  { source: 'Philstar', url: 'https://www.philstar.com/rss/business' },
  { source: 'Manila Times', url: 'https://www.manilatimes.net/business/feed/' },
  { source: 'Rappler', url: 'https://www.rappler.com/business/feed/' },
];

// Market-wide topics that make a general business story worth showing.
const MARKET_WORDS = /\b(psei|pse|stock market|stocks?|shares?|bourse|ipo|listing|listed|dividends?|earnings|net income|profit|investors?|peso|bsp|rate (cut|hike)s?|interest rates?|inflation|sec|bonds?|equit(y|ies)|market cap|buyback|rights offer)\b/i;

// Uppercase words that are also tickers but usually mean something else in headlines.
const AMBIGUOUS_SYMBOLS = new Set(['EMI', 'IPO', 'SEC', 'BSP', 'PSE', 'CEO', 'GDP', 'USD', 'PHP', 'AI', 'EU', 'US', 'UK', 'VAT', 'ETF', 'FDI', 'OFW', 'BPO', 'REIT', 'MSME', 'NFA', 'DOE', 'ERC', 'PAL', 'CAT', 'TECH', 'FOOD', 'EV', 'OK', 'IT', 'GO', 'SUN', 'NOW', 'ABS']);
// Generic first words that can't stand in for a company on their own.
// Two-letter tickers common enough in headlines to match safely.
const SHORT_TICKERS = new Set(['SM', 'AC', 'AP', 'EW', 'DD']);
// The exchange operator: headlines about the PSEi or "the PSE" are about the market, not this stock.
const SKIP_SYMBOLS = new Set(['PSE']);
const GENERIC_WORDS = new Set(['basic', 'nickel', 'cyber', 'forum', 'vantage', 'house', 'philippine', 'philippines', 'first', 'global', 'manila', 'metro', 'asia', 'asian', 'national', 'premier', 'pacific', 'united', 'international', 'golden', 'royal', 'prime', 'union', 'city', 'grand', 'central', 'east', 'west', 'south', 'north', 'new', 'max', 'citicore', 'converge', 'premiere', 'security', 'universal', 'transpacific', 'oriental', 'atlas', 'cosco', 'shang', 'bank', 'power', 'energy', 'land', 'holdings', 'group', 'ever', 'alliance', 'top', 'semirara']);
const SUFFIXES = /\b(corporation|corp\.?|incorporated|inc\.?|company|co\.?|holdings?|limited|ltd\.?|philippines|phils?\.?|group|of the|the)\b|[",.]/gi;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—' };

const decode = (s: unknown): string => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp|hellip|rsquo|lsquo|rdquo|ldquo|ndash|mdash);/g, (_, e: string) => ENTITIES[e] ?? '')
  .replace(/\s+/g, ' ')
  .trim();

const tag = (xml: string, name: string): string => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1] ?? '';
const safeUrl = (u: string): string | null => (/^https?:\/\//.test(u) ? u : null);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normName = (s: string): string => s.toLowerCase().replace(SUFFIXES, ' ').replace(/\s+/g, ' ').trim();

// Builds matchers that find listed companies in a headline: multi-word short names
// ("Jollibee Foods", any case), and for actively traded stocks a capitalized
// distinctive first word ("Jollibee") or an unambiguous ticker ("BPI").
function companyMatcher(stocks: Pick<Stock, 'symbol' | 'name' | 'price' | 'volume'>[]): Matcher {
  const common = stocks.filter((s) => !SKIP_SYMBOLS.has(s.symbol) && !/preferred|warrant|series|fund|etf|perpetual/i.test(s.name));
  const firstWordCount = new Map<string, number>();
  for (const s of common) {
    const w = normName(s.name).split(' ')[0] ?? '';
    firstWordCount.set(w, (firstWordCount.get(w) || 0) + 1);
  }
  // "Capitalized or ALL CAPS" so lowercase words like "basic goods" don't match.
  const properNoun = (w: string) => {
    const cap = w.charAt(0).toUpperCase() + w.slice(1);
    return new RegExp(`\\b(?:${escapeRe(cap)}|${escapeRe(w.toUpperCase())})\\b`);
  };
  const rules: { symbol: string; re: RegExp }[] = [];
  for (const s of common) {
    const short = normName(s.name);
    const words = short.split(' ');
    // Small, thinly traded names ("Dizon", "Forum") are mostly false positives.
    const active = s.price * s.volume >= 1_000_000;
    if (words.length >= 2 && short.length >= 6) rules.push({ symbol: s.symbol, re: new RegExp(`\\b${escapeRe(short)}\\b`, 'i') });
    const first = words[0] ?? '';
    if (active && first.length >= 4 && firstWordCount.get(first) === 1 && !GENERIC_WORDS.has(first)) {
      rules.push({ symbol: s.symbol, re: properNoun(first) });
    }
    const tickerOk = s.symbol.length >= 3 || SHORT_TICKERS.has(s.symbol);
    if (active && tickerOk && !AMBIGUOUS_SYMBOLS.has(s.symbol)) {
      rules.push({ symbol: s.symbol, re: new RegExp(`(^|[^A-Za-z0-9])${escapeRe(s.symbol)}([^A-Za-z0-9]|$)`) }); // case-sensitive
    }
  }
  const byName = new Map(common.map((s) => [normName(s.name), s.symbol]));
  return {
    find(text) { return [...new Set(rules.filter((r) => r.re.test(text)).map((r) => r.symbol))].slice(0, 4); },
    byCompanyName(name) { return byName.get(normName(name)) || null; },
  };
}

async function fetchText(url: string, opts: RequestInit = {}): Promise<string> {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function readFeed(feed: Feed, matcher: Matcher): Promise<NewsItem[]> {
  const xml = await fetchText(feed.url);
  const items: NewsItem[] = [];
  for (const [, raw] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = decode(tag(raw, 'title'));
    const link = safeUrl(decode(tag(raw, 'link')));
    if (!title || !link) continue;
    const summary = decode(tag(raw, 'description')).slice(0, 240);
    const text = `${title} ${summary}`;
    const symbols = matcher.find(text);
    if (!feed.alwaysRelevant && !symbols.length && !MARKET_WORDS.test(title)) continue;
    let stamp = decode(tag(raw, 'pubDate'));
    if (feed.manilaTimeAsUtc) stamp = stamp.replace(/\+0000$|GMT$/, '+0800');
    const parsed = new Date(stamp);
    // Never show a story as newer than now, whatever the feed claims.
    const published = parsed.getTime() > Date.now() ? new Date() : parsed;
    items.push({
      title, link, source: feed.source, summary: summary.length === 240 ? summary + '…' : summary,
      published: Number.isNaN(published.getTime()) ? null : published.toISOString(), symbols,
    });
  }
  return items;
}

const mdy = (d: Date): string => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
// Routine filings that would bury the interesting ones.
const NOISY_TEMPLATES = /daily trading information|share buy-back transactions/i;

async function readDisclosures(matcher: Matcher): Promise<NewsItem[]> {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const html = await fetchText(`${EDGE}/announcements/search.ax`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pageNo: '1', companyId: '', keyword: '', tmplNm: '', fromDate: mdy(from), toDate: mdy(to), sortType: 'date', dateSortType: 'DESC', cmpySortType: 'ASC' }),
  });
  const body = (html.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '';
  const out: NewsItem[] = [];
  for (const [, row] of body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 4) continue;
    const id = (cells[1].match(/openPopup\('([0-9a-f]+)'\)/) || [])[1];
    const company = decode(cells[0]);
    const title = decode(cells[1]);
    if (!id || NOISY_TEMPLATES.test(title)) continue;
    const published = new Date(`${decode(cells[3])} GMT+0800`);
    const symbol = matcher.byCompanyName(company);
    out.push({
      title, company, symbols: symbol ? [symbol] : [], source: 'PSE Edge',
      link: `${EDGE}/openDiscViewer.do?edge_no=${id}`,
      published: Number.isNaN(published.getTime()) ? null : published.toISOString(),
    });
  }
  return out;
}

export async function getNews(getStocks: () => Promise<{ stocks: Stock[] }>): Promise<NewsFeed> {
  const { stocks } = await getStocks();
  const matcher = companyMatcher(stocks);
  const [feeds, disclosures] = await Promise.all([
    Promise.allSettled(FEEDS.map((f) => readFeed(f, matcher))),
    readDisclosures(matcher).catch((e) => { console.error('disclosures', e.message); return null; }),
  ]);
  const failed = FEEDS.filter((_, i) => feeds[i].status === 'rejected').map((f) => f.source);
  const seen = new Set();
  const news = feeds
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((n) => !seen.has(n.link) && seen.add(n.link))
    .sort((a, b) => (b.published || '').localeCompare(a.published || ''))
    .slice(0, 80);
  if (!news.length && !disclosures) throw new Error('No news sources responded');
  return { news, disclosures: disclosures || [], failed: disclosures ? failed : [...failed, 'PSE Edge'], fetchedAt: new Date().toISOString() };
}
