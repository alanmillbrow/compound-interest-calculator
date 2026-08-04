// Data is fetched by two separate scheduled GitHub Actions and committed to
// data.json, so this page just reads that static file instead of calling
// Twelve Data directly from every visitor's browser: refresh-prices.yml
// (hourly — price, all-time high, drawdown, 12-month change) and
// refresh-fundamentals.yml (weekly — P/E, dividend yield), since those cost
// far more API credits and barely change hour to hour.

const STOCKS = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'NVDA', name: 'Nvidia' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'TSLA', name: 'Tesla' },
];

// Tracked via the ETFs that follow each index — see the comment in
// .github/scripts/fetch-stock-data.mjs for why.
const INDICES = [
  { symbol: 'SPY', name: 'S&P 500' },
  { symbol: 'QQQ', name: 'Nasdaq-100' },
];

// GBP-denominated LSE-listed index trackers — see the comment in
// .github/scripts/fetch-stock-data.mjs for why these specific symbols.
const INDICES_GBP = [
  { symbol: 'VUAG', name: 'S&P 500 (Acc)' },
  { symbol: 'VUSA', name: 'S&P 500 (Dist)' },
  { symbol: 'VWRP', name: 'FTSE All-World (Acc)' },
  { symbol: 'VWRL', name: 'FTSE All-World (Dist)' },
  { symbol: 'VUKG', name: 'FTSE 100 (Acc)' },
  { symbol: 'VUKE', name: 'FTSE 100 (Dist)' },
];

const SPACE_FORCE = [
  { symbol: 'SPCX', name: 'SpaceX' },
  { symbol: 'RKLB', name: 'Rocket Lab' },
  { symbol: 'ASTS', name: 'AST SpaceMobile' },
  { symbol: 'PL', name: 'Planet Labs' },
  { symbol: 'LMT', name: 'Lockheed Martin' },
  { symbol: 'LHX', name: 'L3Harris' },
  { symbol: 'NOC', name: 'Northrop Grumman' },
];

const FTSE_DIVIDENDS = [
  { symbol: 'LGEN', name: 'Legal & General' },
  { symbol: 'SDLF', name: 'Standard Life' },
  { symbol: 'MNG', name: 'M&G' },
  { symbol: 'LAND', name: 'Landsec' },
  { symbol: 'LMP', name: 'LondonMetric' },
  { symbol: 'AV', name: 'Aviva' },
  { symbol: 'IMB', name: 'Imperial Brands' },
  { symbol: 'BATS', name: 'British American Tobacco' },
  { symbol: 'NWG', name: 'NatWest Group' },
  { symbol: 'SBRY', name: "Sainsbury's" },
];

function fmtUsd(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtGbp(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Individual LSE-listed companies (unlike the Vanguard ETF trackers, which
// quote in whole pounds) are quoted by Twelve Data in pence — confirmed via
// each symbol's own currency field (GBp vs GBP), not assumed. £3.04 would
// otherwise render as "£303.80", 100x too high.
function fmtGbx(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}p`;
}

function fmtPercent(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

// Dividend yield is never negative, so (unlike fmtPercent) this never
// prefixes a sign.
function fmtYield(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function fmtPe(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(1);
}

function fmtDays(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n === 0 ? 'Today' : n.toLocaleString('en-US');
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "30 Jul 26, 21:05" — dd mmm yy, hh:mm (local time, 24-hour)
function fmtRefreshedAt(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTH_NAMES[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

// Price fields (quote/time_series) and fundamentals fields (earnings/
// dividends) are now fetched by two entirely separate scheduled runs on
// different cadences, so a symbol can legitimately have some fields present
// and others still missing — each field just renders "—" independently
// (via the fmt* helpers) rather than blanking the whole row on any gap.
function renderRow(stock, result, { idPrefix = 'row', fmt = fmtUsd } = {}) {
  const row = document.getElementById(`${idPrefix}-${stock.symbol}`);
  if (!row) return;
  const r = result || {};

  row.querySelector('[data-col="ath"]').textContent = fmt(r.athPrice);
  row.querySelector('[data-col="price"]').textContent = fmt(r.price);
  row.querySelector('[data-col="vsAth"]').textContent = fmtPercent(r.vsAth);
  row.querySelector('[data-col="daysSinceAth"]').textContent = fmtDays(r.daysSinceAth);
  row.querySelector('[data-col="change12mo"]').textContent = fmtPercent(r.change12mo);
  row.querySelector('[data-col="dividendYield"]').textContent = fmtYield(r.dividendYield);
  row.querySelector('[data-col="pe"]').textContent = fmtPe(r.pe);
}

function renderIndexRow(index, result, { idPrefix = 'idx', fmt = fmtUsd } = {}) {
  const row = document.getElementById(`${idPrefix}-${index.symbol}`);
  if (!row) return;
  const r = result || {};

  row.querySelector('[data-col="ath"]').textContent = fmt(r.athPrice);
  row.querySelector('[data-col="price"]').textContent = fmt(r.price);
  row.querySelector('[data-col="vsAth"]').textContent = fmtPercent(r.vsAth);
  row.querySelector('[data-col="daysSinceAth"]').textContent = fmtDays(r.daysSinceAth);
  row.querySelector('[data-col="change12mo"]').textContent = fmtPercent(r.change12mo);
  row.querySelector('[data-col="dividendYield"]').textContent = fmtYield(r.dividendYield);
}

function buildRows() {
  const tbody = document.getElementById('stockTableBody');
  tbody.innerHTML = STOCKS.map((stock) => `
    <tr id="row-${stock.symbol}">
      <td>${stock.name} <span class="section-note">(${stock.symbol})</span></td>
      <td data-col="ath">&hellip;</td>
      <td data-col="price">&hellip;</td>
      <td data-col="vsAth">&hellip;</td>
      <td data-col="daysSinceAth">&hellip;</td>
      <td data-col="change12mo">&hellip;</td>
      <td data-col="dividendYield">&hellip;</td>
      <td data-col="pe">&hellip;</td>
    </tr>
  `).join('');

  const indexTbody = document.getElementById('indexTableBody');
  indexTbody.innerHTML = INDICES.map((index) => `
    <tr id="idx-${index.symbol}">
      <td>${index.name} <span class="section-note">(${index.symbol})</span></td>
      <td data-col="ath">&hellip;</td>
      <td data-col="price">&hellip;</td>
      <td data-col="vsAth">&hellip;</td>
      <td data-col="daysSinceAth">&hellip;</td>
      <td data-col="change12mo">&hellip;</td>
      <td data-col="dividendYield">&hellip;</td>
      <td>&mdash;</td>
    </tr>
  `).join('');

  const indexGbpTbody = document.getElementById('indexGbpTableBody');
  indexGbpTbody.innerHTML = INDICES_GBP.map((index) => `
    <tr id="idxgbp-${index.symbol}">
      <td>${index.name} <span class="section-note">(${index.symbol})</span></td>
      <td data-col="ath">&hellip;</td>
      <td data-col="price">&hellip;</td>
      <td data-col="vsAth">&hellip;</td>
      <td data-col="daysSinceAth">&hellip;</td>
      <td data-col="change12mo">&hellip;</td>
      <td data-col="dividendYield">&hellip;</td>
      <td>&mdash;</td>
    </tr>
  `).join('');

  const spaceForceTbody = document.getElementById('spaceForceTableBody');
  spaceForceTbody.innerHTML = SPACE_FORCE.map((stock) => `
    <tr id="space-${stock.symbol}">
      <td>${stock.name} <span class="section-note">(${stock.symbol})</span></td>
      <td data-col="ath">&hellip;</td>
      <td data-col="price">&hellip;</td>
      <td data-col="vsAth">&hellip;</td>
      <td data-col="daysSinceAth">&hellip;</td>
      <td data-col="change12mo">&hellip;</td>
      <td data-col="dividendYield">&hellip;</td>
      <td data-col="pe">&hellip;</td>
    </tr>
  `).join('');

  buildFtseDividendRows(FTSE_DIVIDENDS);
}

// Broken out from buildRows so it can be called again after data loads,
// rebuilding the table in dividend-yield order (highest first) instead of
// the fixed order used for the initial loading-placeholder state.
function buildFtseDividendRows(order) {
  const ftseDividendTbody = document.getElementById('ftseDividendTableBody');
  ftseDividendTbody.innerHTML = order.map((stock) => `
    <tr id="ftsediv-${stock.symbol}">
      <td>${stock.name} <span class="section-note">(${stock.symbol})</span></td>
      <td data-col="ath">&hellip;</td>
      <td data-col="price">&hellip;</td>
      <td data-col="vsAth">&hellip;</td>
      <td data-col="daysSinceAth">&hellip;</td>
      <td data-col="change12mo">&hellip;</td>
      <td data-col="dividendYield">&hellip;</td>
      <td data-col="pe">&hellip;</td>
    </tr>
  `).join('');
}

async function init() {
  const status = document.getElementById('stockWatchStatus');
  buildRows();
  status.textContent = 'Loading…';

  try {
    const res = await fetch('/the-lookout/data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load data (${res.status})`);
    const data = await res.json();
    STOCKS.forEach((stock) => renderRow(stock, data.stocks?.[stock.symbol]));
    INDICES.forEach((index) => renderIndexRow(index, data.indices?.[index.symbol]));
    INDICES_GBP.forEach((index) => renderIndexRow(index, data.indicesGbp?.[index.symbol], { idPrefix: 'idxgbp', fmt: fmtGbp }));
    SPACE_FORCE.forEach((stock) => renderRow(stock, data.spaceForce?.[stock.symbol], { idPrefix: 'space', fmt: fmtUsd }));

    // Highest dividend yield first — missing yields (e.g. a fetch gap) sink
    // to the bottom rather than being treated as a 0% yield.
    const byYieldDesc = [...FTSE_DIVIDENDS].sort((a, b) => {
      const ay = data.ftseDividends?.[a.symbol]?.dividendYield;
      const by = data.ftseDividends?.[b.symbol]?.dividendYield;
      if (ay == null && by == null) return 0;
      if (ay == null) return 1;
      if (by == null) return -1;
      return by - ay;
    });
    buildFtseDividendRows(byYieldDesc);
    FTSE_DIVIDENDS.forEach((stock) => renderRow(stock, data.ftseDividends?.[stock.symbol], { idPrefix: 'ftsediv', fmt: fmtGbx }));
    status.textContent = `Last refreshed ${fmtRefreshedAt(new Date(data.savedAt))}`;
  } catch (err) {
    status.textContent = `Couldn't load stock data: ${err.message}`;
  }
}

init();
