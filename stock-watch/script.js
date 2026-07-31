// Data is fetched hourly by a scheduled GitHub Action (see
// .github/workflows/refresh-stock-data.yml) and committed to data.json, so
// this page just reads that static file instead of calling Twelve Data
// directly from every visitor's browser.

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

function fmtUsd(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMarketCap(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return fmtUsd(n);
}

function fmtPercent(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function fmtPe(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(1);
}

function fmtDays(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n === 0 ? 'Today' : String(n);
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

function renderRow(stock, result) {
  const row = document.getElementById(`row-${stock.symbol}`);
  if (!row) return;

  if (!result || result.error) {
    row.querySelectorAll('td[data-col]').forEach((td) => { td.textContent = '—'; });
    if (result?.error) row.querySelector('[data-col="price"]').title = result.error;
    return;
  }

  row.querySelector('[data-col="marketCap"]').textContent = fmtMarketCap(result.marketCap);
  row.querySelector('[data-col="ath"]').textContent = fmtUsd(result.athPrice);
  row.querySelector('[data-col="price"]').textContent = fmtUsd(result.price);
  row.querySelector('[data-col="vsAth"]').textContent = fmtPercent(result.vsAth);
  row.querySelector('[data-col="daysSinceAth"]').textContent = fmtDays(result.daysSinceAth);
  row.querySelector('[data-col="pe"]').textContent = fmtPe(result.pe);
}

function renderIndexRow(index, result) {
  const row = document.getElementById(`idx-${index.symbol}`);
  if (!row) return;

  if (!result || result.error) {
    row.querySelectorAll('td[data-col]').forEach((td) => { td.textContent = '—'; });
    if (result?.error) row.querySelector('[data-col="price"]').title = result.error;
    return;
  }

  row.querySelector('[data-col="ath"]').textContent = fmtUsd(result.athPrice);
  row.querySelector('[data-col="price"]').textContent = fmtUsd(result.price);
  row.querySelector('[data-col="vsAth"]').textContent = fmtPercent(result.vsAth);
  row.querySelector('[data-col="daysSinceAth"]').textContent = fmtDays(result.daysSinceAth);
}

function buildRows() {
  const tbody = document.getElementById('stockTableBody');
  tbody.innerHTML = STOCKS.map((stock) => `
    <tr id="row-${stock.symbol}">
      <td>${stock.name} <span class="section-note">(${stock.symbol})</span></td>
      <td data-col="marketCap">&hellip;</td>
      <td data-col="ath">&hellip;</td>
      <td data-col="price">&hellip;</td>
      <td data-col="vsAth">&hellip;</td>
      <td data-col="daysSinceAth">&hellip;</td>
      <td data-col="pe">&hellip;</td>
    </tr>
  `).join('');

  const indexTbody = document.getElementById('indexTableBody');
  indexTbody.innerHTML = INDICES.map((index) => `
    <tr id="idx-${index.symbol}">
      <td>${index.name} <span class="section-note">(${index.symbol})</span></td>
      <td>&mdash;</td>
      <td data-col="ath">&hellip;</td>
      <td data-col="price">&hellip;</td>
      <td data-col="vsAth">&hellip;</td>
      <td data-col="daysSinceAth">&hellip;</td>
      <td>&mdash;</td>
    </tr>
  `).join('');
}

async function init() {
  const status = document.getElementById('stockWatchStatus');
  buildRows();
  status.textContent = 'Loading…';

  try {
    const res = await fetch('/stock-watch/data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load data (${res.status})`);
    const data = await res.json();
    STOCKS.forEach((stock) => renderRow(stock, data.stocks?.[stock.symbol]));
    INDICES.forEach((index) => renderIndexRow(index, data.indices?.[index.symbol]));
    status.textContent = `Last refreshed ${fmtRefreshedAt(new Date(data.savedAt))}`;
  } catch (err) {
    status.textContent = `Couldn't load stock data: ${err.message}`;
  }
}

init();
