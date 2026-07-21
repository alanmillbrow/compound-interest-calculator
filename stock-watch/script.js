// Free API key from https://twelvedata.com/pricing (Basic plan, no card required).
// This key ships in plain client-side JS, so anyone viewing the page source can see
// and use it — that's expected for a free-tier key on a static site with no backend.
const API_KEY = 'd72f1f32bf8142aabd7e80ecc5ccd9e9';

const STOCKS = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'NVDA', name: 'Nvidia' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'AMZN', name: 'Amazon' },
];

const CACHE_KEY = 'stockWatchCache_v1';
const CACHE_TTL_MS = 15 * 60 * 1000;

// Twelve Data's free Basic plan allows 8 API credits per minute. Each stock costs
// 3 credits (quote + statistics + time_series), so this queue paces every request
// across all stocks to stay under that ceiling instead of bursting and getting 429s.
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60 * 1000;
const callTimestamps = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitedFetchJson(url) {
  for (;;) {
    const now = Date.now();
    while (callTimestamps.length && now - callTimestamps[0] >= RATE_WINDOW_MS) {
      callTimestamps.shift();
    }
    if (callTimestamps.length < RATE_LIMIT) {
      callTimestamps.push(now);
      break;
    }
    await sleep(RATE_WINDOW_MS - (now - callTimestamps[0]) + 250);
  }

  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'error' || data.code >= 400) {
    throw new Error(data.message || `Twelve Data error (${data.code || res.status})`);
  }
  return data;
}

function fmtUsd(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — safe to skip caching
  }
}

async function loadStock(symbol) {
  const base = 'https://api.twelvedata.com';
  // Each call is fetched independently (allSettled, not all) because /statistics
  // requires a paid Twelve Data plan and 403s on the free tier for most symbols —
  // that shouldn't stop price/all-time-high (quote + time_series) from rendering.
  const [quoteResult, statsResult, historyResult] = await Promise.allSettled([
    rateLimitedFetchJson(`${base}/quote?symbol=${symbol}&apikey=${API_KEY}`),
    rateLimitedFetchJson(`${base}/statistics?symbol=${symbol}&apikey=${API_KEY}`),
    rateLimitedFetchJson(`${base}/time_series?symbol=${symbol}&interval=1day&outputsize=5000&apikey=${API_KEY}`),
  ]);

  const price = quoteResult.status === 'fulfilled' ? parseFloat(quoteResult.value.close) : null;
  const pe = statsResult.status === 'fulfilled'
    ? statsResult.value?.statistics?.valuations_metrics?.trailing_pe ?? null
    : null;

  let athPrice = null;
  let athDate = null;
  if (historyResult.status === 'fulfilled') {
    for (const bar of historyResult.value.values || []) {
      const high = parseFloat(bar.high);
      if (athPrice === null || high > athPrice) {
        athPrice = high;
        athDate = bar.datetime;
      }
    }
  }

  const daysSinceAth = athDate
    ? Math.round((Date.now() - new Date(`${athDate}T00:00:00Z`).getTime()) / 86400000)
    : null;
  const vsAth = (price !== null && athPrice) ? ((price - athPrice) / athPrice) * 100 : null;

  return { symbol, price, athPrice, athDate, daysSinceAth, vsAth, pe };
}

function renderRow(stock, result, error) {
  const row = document.getElementById(`row-${stock.symbol}`);
  if (!row) return;

  if (error) {
    row.querySelectorAll('td[data-col]').forEach((td) => { td.textContent = '—'; });
    row.querySelector('[data-col="price"]').title = error;
    return;
  }

  row.querySelector('[data-col="price"]').textContent = fmtUsd(result.price);
  row.querySelector('[data-col="ath"]').textContent = fmtUsd(result.athPrice);
  row.querySelector('[data-col="vsAth"]').textContent = fmtPercent(result.vsAth);
  row.querySelector('[data-col="daysSinceAth"]').textContent = fmtDays(result.daysSinceAth);
  row.querySelector('[data-col="pe"]').textContent = fmtPe(result.pe);
}

function buildRows() {
  const tbody = document.getElementById('stockTableBody');
  tbody.innerHTML = STOCKS.map((stock) => `
    <tr id="row-${stock.symbol}">
      <td>${stock.name} <span class="section-note">(${stock.symbol})</span></td>
      <td data-col="price">&hellip;</td>
      <td data-col="ath">&hellip;</td>
      <td data-col="vsAth">&hellip;</td>
      <td data-col="daysSinceAth">&hellip;</td>
      <td data-col="pe">&hellip;</td>
    </tr>
  `).join('');
}

async function init() {
  const status = document.getElementById('stockWatchStatus');
  buildRows();

  if (!API_KEY || API_KEY === 'YOUR_TWELVE_DATA_API_KEY') {
    status.textContent = 'Add a free Twelve Data API key in stock-watch/script.js to load live data';
    document.querySelectorAll('#stockTableBody td[data-col]').forEach((td) => { td.textContent = '—'; });
    return;
  }

  const cached = readCache();
  if (cached) {
    STOCKS.forEach((stock) => renderRow(stock, cached[stock.symbol], cached[stock.symbol]?.error));
    status.textContent = `Last refreshed ${new Date(cached.__savedAt || Date.now()).toLocaleTimeString()} (cached)`;
    return;
  }

  status.textContent = 'Loading live prices… this can take a couple of minutes on the free data plan';

  const results = {};
  await Promise.all(STOCKS.map(async (stock) => {
    try {
      const result = await loadStock(stock.symbol);
      results[stock.symbol] = result;
      renderRow(stock, result, null);
    } catch (err) {
      results[stock.symbol] = { error: err.message };
      renderRow(stock, null, err.message);
    }
  }));

  results.__savedAt = Date.now();
  writeCache(results);
  status.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;
}

init();
