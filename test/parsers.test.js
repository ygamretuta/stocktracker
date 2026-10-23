import test from 'node:test';
import assert from 'node:assert/strict';
import { num, text, parseIndices, findSecurityId, parseStockDetail, parseCompanyProfile, normaliseCandles } from '../parsers.js';

test('num strips formatting and rejects junk', () => {
  assert.equal(num('1,234.50'), 1234.5);
  assert.equal(num('-3.2%'), -3.2);
  assert.equal(num('n/a'), null);
  assert.equal(num(null), null);
});

test('text strips tags and entities', () => {
  assert.equal(text('<b>A&nbsp;&amp;&nbsp;B</b>  c'), 'A & B c');
});

const INDEX_HTML = `<table><tr><th>Index</th><th>As of Oct 22, 2026 03:00 PM</th></tr>
<tr><td class="label">PSEi</td><td>6,500.10</td><td style="color:red">-20.5</td><td>▼ 0.31</td></tr>
<tr><td class="label">All Shares</td><td>3,600.00</td><td>10.0</td><td>▲ 0.28</td></tr></table>`;

test('parseIndices reads values and signs', () => {
  const { asOf, indices } = parseIndices(INDEX_HTML);
  assert.equal(asOf, 'Oct 22, 2026 03:00 PM');
  assert.deepEqual(indices[0], { name: 'PSEi', value: 6500.1, change: -20.5, percent: -0.31 });
  assert.equal(indices[1].percent, 0.28);
});

test('parseIndices throws a clear error when the table is gone', () => {
  assert.throws(() => parseIndices('<html>maintenance</html>'), /markup may have changed/);
});

test('findSecurityId matches the exact symbol', () => {
  const html = '<option value="11">JFC Common</option><option value="12">JFCPA Pref</option>';
  assert.equal(findSecurityId(html, 'JFCPA'), '12');
  assert.equal(findSecurityId(html, 'XYZ'), null);
});

const DETAIL_HTML = `<table>
<tr><th>Board Lot</th><td>100</td></tr>
<tr><th>Last Traded Price</th><td>230.00</td></tr>
<tr><th>Previous Close and Date</th><td>228.00 (Oct 21, 2026)</td></tr>
<tr><th>52-Week High</th><td>250.00</td></tr></table>`;

test('parseStockDetail extracts fields', () => {
  const d = parseStockDetail(DETAIL_HTML, 'JFC');
  assert.equal(d.boardLot, 100);
  assert.equal(d.last, 230);
  assert.equal(d.prevClose, 228);
  assert.equal(d.prevCloseDate, 'Oct 21, 2026');
  assert.equal(d.week52High, 250);
  assert.equal(d.pe, null);
});

test('parseStockDetail throws on an unrecognised page', () => {
  assert.throws(() => parseStockDetail('<html><body>Error</body></html>', 'JFC'), /not recognised/);
});

test('normaliseCandles dedupes, sorts and drops bad rows', () => {
  const rows = [
    { CHART_DATE: 'Oct 22, 2026 00:00:00', OPEN: 2, HIGH: 3, LOW: 1, CLOSE: 2.5, VALUE: 10 },
    { CHART_DATE: 'Oct 21, 2026 00:00:00', OPEN: 1, HIGH: 2, LOW: 1, CLOSE: 2, VALUE: 5 },
    { CHART_DATE: 'Oct 22, 2026 00:00:00', OPEN: 2, HIGH: 3, LOW: 1, CLOSE: 2.6, VALUE: 11 },
    { CHART_DATE: 'Oct 20, 2026 00:00:00', OPEN: null, HIGH: 2, LOW: 1, CLOSE: 2, VALUE: 1 },
    { CHART_DATE: 'garbage', OPEN: 1, HIGH: 1, LOW: 1, CLOSE: 1, VALUE: 1 },
  ];
  const c = normaliseCandles(rows);
  assert.deepEqual(c.map((x) => x.time), ['2026-10-21', '2026-10-22']);
  assert.equal(c[1].close, 2.6);
});

const PROFILE_HTML = `<div id="dataList"><table class="view"><caption>Company Description</caption>
<tr><td>Acme &amp; Co. makes widgets.<br/><br/>It has 10 stores.<br/><br/>Source: SEC Form 17-A</td></tr></table>
<table class="view"><caption>Security Information</caption>
<tr><th>Sector</th><td>Industrial</td></tr><tr><th>Subsector</th><td>Food, Beverage &amp; Tobacco</td></tr>
<tr><th>Incorporation Date</th><td>Jan 11, 1978</td></tr></table>
<table class="view"><caption>Contact Information</caption>
<tr><th>Business Address</th><td>Pasig City</td></tr><tr><th>Website</th><td>javascript:alert(1)</td></tr></table></div>`;

test('parseCompanyProfile splits the description and drops unsafe websites', () => {
  const p = parseCompanyProfile(PROFILE_HTML);
  assert.deepEqual(p.description, ['Acme & Co. makes widgets.', 'It has 10 stores.', 'Source: SEC Form 17-A']);
  assert.equal(p.sector, 'Industrial');
  assert.equal(p.subsector, 'Food, Beverage & Tobacco');
  assert.equal(p.address, 'Pasig City');
  assert.equal(p.website, null);
  assert.equal(parseCompanyProfile(PROFILE_HTML.replace('javascript:alert(1)', 'https://acme.ph/')).website, 'https://acme.ph/');
});

test('parseCompanyProfile throws on an unrecognised page', () => {
  assert.throws(() => parseCompanyProfile('<html></html>'), /not recognised/);
});
