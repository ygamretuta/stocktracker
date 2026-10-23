// Pure parsers for PSE Edge HTML. Kept apart from server.js so they can be tested
// against fixtures and so a markup change fails with a clear message.

export const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export const num = (s) => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function parseIndices(html) {
  const asOf = (html.match(/As of ([^<]+)<\/th>/) || [])[1]?.trim() || null;
  const rows = [...html.matchAll(/<td class="label">([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td([^>]*)>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>/g)];
  const indices = rows.map(([, name, value, attrs, chg, pct]) => {
    const sign = /color:\s*red/.test(attrs) || pct.includes('▼') ? -1 : 1;
    return {
      name: name.trim(),
      value: num(value),
      change: sign * Math.abs(num(chg) ?? 0),
      percent: sign * Math.abs(num(pct) ?? 0),
    };
  });
  if (!indices.length) throw new Error('PSE Edge index table not found (page markup may have changed)');
  return { asOf, indices };
}

// <option value="123">JFC ...</option> entries on a company page: security id for a symbol.
export function findSecurityId(html, symbol) {
  const opt = [...html.matchAll(/<option value="(\d+)"[^>]*>\s*([^<\s]+)/g)].find(([, , sym]) => sym === symbol);
  return opt ? opt[1] : null;
}

export function parseStockDetail(html, symbol) {
  const fields = {};
  for (const [, k, v] of html.matchAll(/<th>([^<]+)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) fields[text(k)] = text(v);
  // If none of the key labels are present the page layout changed; don't return a card of nulls.
  if (!['Last Traded Price', 'Board Lot', 'Previous Close and Date'].some((k) => k in fields)) {
    throw new Error(`PSE Edge stock page for ${symbol} not recognised (page markup may have changed)`);
  }
  const prev = fields['Previous Close and Date'] || '';
  return {
    status: fields['Status'] || null,
    boardLot: num(fields['Board Lot']),
    last: num(fields['Last Traded Price']),
    open: num(fields['Open']),
    high: num(fields['High']),
    low: num(fields['Low']),
    prevClose: num(prev.split(' ')[0]),
    prevCloseDate: (prev.match(/\(([^)]+)\)/) || [])[1] || null,
    change: fields['Change(% Change)'] || null,
    volume: num(fields['Volume']),
    value: num(fields['Value']),
    avgPrice: num(fields['Average Price']),
    week52High: num(fields['52-Week High']),
    week52Low: num(fields['52-Week Low']),
    pe: num(fields['P/E Ratio']),
    sectorPe: num(fields['Sector P/E Ratio']),
    bookValue: num(fields['Book Value']),
    pbv: num(fields['P/BV Ratio']),
    marketCap: num(fields['Market Capitalization']),
    outstanding: num(fields['Outstanding Shares']),
    freeFloat: num(fields['Free Float Level(%)']),
    listingDate: fields['Listing Date'] || null,
  };
}

const pad = (n) => String(n).padStart(2, '0');

// PSE Edge sometimes repeats a day; the chart needs unique, ascending dates.
export function normaliseCandles(chartData) {
  const byDay = new Map();
  for (const c of chartData) {
    if (![c.OPEN, c.HIGH, c.LOW, c.CLOSE].every(Number.isFinite)) continue;
    const d = new Date(String(c.CHART_DATE).replace(' 00:00:00', ''));
    if (Number.isNaN(d.getTime())) continue;
    const time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    byDay.set(time, { time, open: c.OPEN, high: c.HIGH, low: c.LOW, close: c.CLOSE, value: c.VALUE });
  }
  return [...byDay.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
}

// Company Information page: description, sector and contact details.
export function parseCompanyProfile(html) {
  const tableByCaption = (caption) => {
    const m = html.match(new RegExp(`<caption>\\s*${caption}\\s*</caption>([\\s\\S]*?)</table>`));
    return m ? m[1] : null;
  };
  const desc = tableByCaption('Company Description');
  const security = tableByCaption('Security Information');
  const contact = tableByCaption('Contact Information');
  if (!desc && !security && !contact) throw new Error('PSE Edge company page not recognised (page markup may have changed)');

  const fieldsOf = (table) => {
    const out = {};
    for (const [, k, v] of (table || '').matchAll(/<th>([^<]+)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) out[text(k)] = text(v);
    return out;
  };
  const sec = fieldsOf(security);
  const con = fieldsOf(contact);
  const paragraphs = desc
    ? (desc.match(/<td[^>]*>([\s\S]*?)<\/td>/) || ['', ''])[1].split(/<br\s*\/?>(?:\s*<br\s*\/?>)+/i).map(text).filter(Boolean)
    : [];
  const website = /^https?:\/\//i.test(con['Website'] || '') ? con['Website'] : null;
  return {
    description: paragraphs,
    sector: sec['Sector'] || null,
    subsector: sec['Subsector'] || null,
    incorporated: sec['Incorporation Date'] || null,
    auditor: sec['External Auditor'] || null,
    transferAgent: sec['Transfer Agent'] || null,
    address: con['Business Address'] || null,
    phone: con['Telephone Number'] || null,
    website,
  };
}
