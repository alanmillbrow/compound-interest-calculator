#!/usr/bin/env node
// Fetches quote, statistics, and daily history for each stock in STOCKS from
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

// Twelve Data's free plan 404s on raw index symbols (SPX, NDX) — "available
// starting with the Grow or Venture plan". SPY and QQQ, the ETFs that track
// the S&P 500 and Nasdaq-100, work fine on the free tier and are a close
// practical stand-in.
const INDICES = [
  { symbol: 'SPY', name: 'S&P 500' },
  { symbol: 'QQQ', name: 'Nasdaq-100' },
];

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
  const valuations = statsResult.status === 'fulfilled'
    ? statsResult.value?.statistics?.valuations_metrics
    : null;
  const pe = valuations?.trailing_pe ?? null;
  const marketCap = valuations?.market_capitalization ?? null;

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

async function debugFundamentalsCheck() {
  for (const ep of ['profile', 'earnings']) {
    try {
      const res = await fetch(`https://api.twelvedata.com/${ep}?symbol=NVDA&apikey=${API_KEY}`);
      const data = await res.json();
      console.error(`[DEBUG fundbody:${ep}]`, JSON.stringify(data).slice(0, 1500));
    } catch (err) {
      console.error(`[DEBUG fundbody:${ep}] failed`, err.message);
    }
  }
}

async function main() {
  await debugFundamentalsCheck();
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
