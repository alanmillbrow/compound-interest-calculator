#!/usr/bin/env node
// Fetches quote, earnings, and daily history for each stock in STOCKS from
// Twelve Data and writes the results to stock-watch/data.json. Run hourly by
// .github/workflows/refresh-stock-data.yml so the stock-watch page can read a
// static file instead of every visitor's browser calling the API directly.

const API_KEY = process.env.TWELVE_DATA_API_KEY;
if (!API_KEY) {
  console.error('TWELVE_DATA_API_KEY is not set');
  process.exit(1);
}

const STOCKS = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'NVDA', name: 'Nvidia' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'TSLA', name: 'Tesla' },
];

// Raw index symbols (SPX, NDX) are ambiguous on Twelve Data — without an
// exchange qualifier they resolve to unrelated small-cap tickers that happen
// to share the same symbol, not the indices themselves. SPY and QQQ, the
// ETFs that track the S&P 500 and Nasdaq-100, are unambiguous and a close
// practical stand-in.
const INDICES = [
  { symbol: 'SPY', name: 'S&P 500' },
  { symbol: 'QQQ', name: 'Nasdaq-100' },
];

// The current Twelve Data Grow plan allows 55 API credits per minute. Each
// stock costs 3 credits (quote + earnings + time_series), so this queue
// paces every request to stay under that ceiling instead of bursting and
// getting 429s.
const RATE_LIMIT = 50;
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

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error(`[DEBUG netfail] ${url}`, err.message);
    throw err;
  }
  const data = await res.json();
  if (data.status === 'error' || data.code >= 400) {
    console.error(`[DEBUG apierr] ${url}`, res.status, JSON.stringify(data));
    throw new Error(data.message || `Twelve Data error (${data.code || res.status})`);
  }
  return data;
}

async function loadStock(symbol) {
  const base = 'https://api.twelvedata.com';
  // /statistics — which would hand back a ready-made trailing P/E and market
  // cap in one call — requires Twelve Data's Pro tier or above, out of reach
  // on the current Grow plan. /earnings *is* included on Grow, so trailing
  // P/E is computed here instead from the last four quarters' reported EPS.
  // Market cap has no such workaround (it needs shares outstanding, which no
  // Grow-tier endpoint exposes) and stays unavailable until upgrading further.
  // Each call is fetched independently (allSettled, not all) so a failure on
  // one doesn't stop price/all-time-high (quote + time_series) from rendering.
  const [quoteResult, earningsResult, historyResult] = await Promise.allSettled([
    rateLimitedFetchJson(`${base}/quote?symbol=${symbol}&apikey=${API_KEY}`),
    rateLimitedFetchJson(`${base}/earnings?symbol=${symbol}&apikey=${API_KEY}`),
    rateLimitedFetchJson(`${base}/time_series?symbol=${symbol}&interval=1day&outputsize=5000&apikey=${API_KEY}`),
  ]);

  const price = quoteResult.status === 'fulfilled' ? parseFloat(quoteResult.value.close) : null;

  // Trailing (TTM) P/E = price / sum of the last four quarters' actual EPS.
  // Twelve Data returns earnings most-recent-first, so the first four
  // entries with a reported (non-null) eps_actual are the trailing year.
  // Requires a full four quarters to avoid a misleading partial-year figure.
  let pe = null;
  if (earningsResult.status === 'fulfilled' && price !== null) {
    const quarters = (earningsResult.value.earnings || [])
      .map((q) => q.eps_actual)
      .filter((v) => typeof v === 'number')
      .slice(0, 4);
    if (quarters.length === 4) {
      const ttmEps = quarters.reduce((sum, v) => sum + v, 0);
      if (ttmEps > 0) pe = price / ttmEps;
    }
  }

  // Requires shares outstanding, which isn't exposed by any endpoint
  // available on the current plan
  const marketCap = null;

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

  return { symbol, price, marketCap, athPrice, athDate, daysSinceAth, vsAth, pe };
}

async function loadIndex(symbol) {
  const base = 'https://api.twelvedata.com';
  const [quoteResult, historyResult] = await Promise.allSettled([
    rateLimitedFetchJson(`${base}/quote?symbol=${symbol}&apikey=${API_KEY}`),
    rateLimitedFetchJson(`${base}/time_series?symbol=${symbol}&interval=1day&outputsize=5000&apikey=${API_KEY}`),
  ]);

  const price = quoteResult.status === 'fulfilled' ? parseFloat(quoteResult.value.close) : null;

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

  return { symbol, price, athPrice, athDate, daysSinceAth, vsAth };
}

async function main() {
  const stocks = {};
  const indices = {};
  await Promise.all([
    ...STOCKS.map(async (stock) => {
      try {
        stocks[stock.symbol] = await loadStock(stock.symbol);
      } catch (err) {
        stocks[stock.symbol] = { symbol: stock.symbol, error: err.message };
      }
    }),
    ...INDICES.map(async (index) => {
      try {
        indices[index.symbol] = await loadIndex(index.symbol);
      } catch (err) {
        indices[index.symbol] = { symbol: index.symbol, error: err.message };
      }
    }),
  ]);

  const output = { savedAt: new Date().toISOString(), stocks, indices };
  const fs = await import('node:fs/promises');
  const outPath = new URL('../../stock-watch/data.json', import.meta.url);
  await fs.writeFile(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log('Wrote stock-watch/data.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
