#!/usr/bin/env node
// Fetches quote, earnings, and daily history for each stock in STOCKS from
// Twelve Data and writes the results to the-lookout/data.json. Run hourly by
// .github/workflows/refresh-stock-data.yml so the-lookout page can read a
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

// GBP-denominated LSE-listed index trackers. Acc/Dist pairs of the same
// underlying index (Vanguard's accumulating vs distributing share classes).
const INDICES_GBP = [
  { symbol: 'VUAG', name: 'S&P 500 (Acc)', exchange: 'LSE' },
  { symbol: 'VUSA', name: 'S&P 500 (Dist)', exchange: 'LSE' },
  { symbol: 'VWRP', name: 'FTSE All-World (Acc)', exchange: 'LSE' },
  { symbol: 'VWRL', name: 'FTSE All-World (Dist)', exchange: 'LSE' },
];

// Twelve Data enforces a rolling per-minute credit budget, but different
// endpoints cost different (undocumented) amounts of it — quote, earnings
// and time_series don't all cost the same, and time_series' cost scales
// with outputsize — so pre-calculating how many calls fit isn't reliable.
// Instead: cap how many requests are in flight at once to avoid bursting,
// and when the server does return 429 ("out of credits for the current
// minute"), wait out the window and retry rather than giving up on that
// field.
const MAX_CONCURRENT = 4;
const RETRY_WAIT_MS = 65 * 1000;
const MAX_ATTEMPTS = 3;

let activeCount = 0;
const waitQueue = [];

function acquireSlot() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (activeCount < MAX_CONCURRENT) {
        activeCount++;
        resolve();
      } else {
        waitQueue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

function releaseSlot() {
  activeCount--;
  const next = waitQueue.shift();
  if (next) next();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitedFetchJson(url) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await acquireSlot();
    let res, data;
    try {
      res = await fetch(url);
      data = await res.json();
    } finally {
      releaseSlot();
    }

    if (data.code === 429) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(data.message || 'Rate limited after retries');
      }
      await sleep(RETRY_WAIT_MS);
      continue;
    }
    if (data.status === 'error' || data.code >= 400) {
      throw new Error(data.message || `Twelve Data error (${data.code || res.status})`);
    }
    return data;
  }
}

async function debugDividendCheck() {
  for (const sym of ['AAPL', 'MSFT']) {
    try {
      const res = await fetch(`https://api.twelvedata.com/dividends?symbol=${sym}&range=5Y&apikey=${API_KEY}`);
      const data = await res.json();
      const count = Array.isArray(data.dividends) ? data.dividends.length : 'n/a';
      console.error(`[DEBUG dividends-5y:${sym}] count=${count}`, JSON.stringify(data).slice(0, 1500));
    } catch (err) {
      console.error(`[DEBUG dividends-5y:${sym}] failed`, err.message);
    }
  }
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

async function loadIndex(symbol, exchange) {
  const base = 'https://api.twelvedata.com';
  // An explicit exchange keeps ambiguous tickers pinned to the right
  // instrument — without it, some symbols resolve to an unrelated company
  // that happens to share the same ticker on a different exchange.
  const exchangeParam = exchange ? `&exchange=${exchange}` : '';
  const [quoteResult, historyResult] = await Promise.allSettled([
    rateLimitedFetchJson(`${base}/quote?symbol=${symbol}${exchangeParam}&apikey=${API_KEY}`),
    rateLimitedFetchJson(`${base}/time_series?symbol=${symbol}${exchangeParam}&interval=1day&outputsize=5000&apikey=${API_KEY}`),
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
  await debugDividendCheck();
  const stocks = {};
  const indices = {};
  const indicesGbp = {};
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
    ...INDICES_GBP.map(async (index) => {
      try {
        indicesGbp[index.symbol] = await loadIndex(index.symbol, index.exchange);
      } catch (err) {
        indicesGbp[index.symbol] = { symbol: index.symbol, error: err.message };
      }
    }),
  ]);

  const output = { savedAt: new Date().toISOString(), stocks, indices, indicesGbp };
  const fs = await import('node:fs/promises');
  const outPath = new URL('../../the-lookout/data.json', import.meta.url);
  await fs.writeFile(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log('Wrote the-lookout/data.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
