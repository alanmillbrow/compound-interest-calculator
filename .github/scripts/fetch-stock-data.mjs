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
  { symbol: 'VUKG', name: 'FTSE 100 (Acc)', exchange: 'LSE' },
  { symbol: 'VUKE', name: 'FTSE 100 (Dist)', exchange: 'LSE' },
];

// Twelve Data enforces a rolling per-minute credit budget, but different
// endpoints cost different (undocumented) amounts of it — quote, earnings,
// dividends and time_series don't all cost the same, and time_series' cost
// scales with outputsize. A concurrency cap alone only limits how many
// requests are in flight at once, not how many get dispatched per minute —
// with fast responses, a full run's calls can still fire in a matter of
// seconds and blow well past the per-minute credit ceiling before any
// single request even has a chance to return 429. So dispatch is paced by
// a conservative request-count budget instead (assuming an average cost
// noticeably above 1 credit, based on real observed usage), and the 429
// retry stays on as a backstop for whatever that estimate still misses.
// Current plan: Grow, upgraded to 144 credits/minute.
const REQUESTS_PER_MINUTE = 100;
const RATE_WINDOW_MS = 60 * 1000;
const dispatchTimestamps = [];

const MAX_CONCURRENT = 4;
const RETRY_WAIT_MS = 65 * 1000;
const MAX_ATTEMPTS = 3;

let activeCount = 0;
const waitQueue = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Blocks until fewer than REQUESTS_PER_MINUTE dispatches have happened in
// the trailing 60 seconds, then reserves this one.
async function waitForDispatchSlot() {
  for (;;) {
    const now = Date.now();
    while (dispatchTimestamps.length && now - dispatchTimestamps[0] >= RATE_WINDOW_MS) {
      dispatchTimestamps.shift();
    }
    if (dispatchTimestamps.length < REQUESTS_PER_MINUTE) {
      dispatchTimestamps.push(now);
      return;
    }
    await sleep(RATE_WINDOW_MS - (now - dispatchTimestamps[0]) + 250);
  }
}

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

async function rateLimitedFetchJson(url) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await waitForDispatchSlot();
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

// Walks a daily-bar history (most-recent-first, as Twelve Data returns it)
// to find the closing price from approximately `days` ago — the newest bar
// that's still at or before that point in time. Returns null if the history
// doesn't reach back far enough (e.g. a recent IPO).
function findPriceDaysAgo(bars, days) {
  const targetTime = Date.now() - days * 86400000;
  for (const bar of bars) {
    if (new Date(`${bar.datetime}T00:00:00Z`).getTime() <= targetTime) {
      return parseFloat(bar.close);
    }
  }
  return null;
}

function sumTrailingDividends(dividends, days) {
  const cutoff = Date.now() - days * 86400000;
  return dividends
    .filter((d) => new Date(`${d.ex_date}T00:00:00Z`).getTime() >= cutoff)
    .reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
}

// Shared by loadStock and loadIndex: all-time high, days since it, drawdown
// from it, trailing 12-month price change, and trailing 12-month dividend
// yield. All derived from the same two allSettled results so a failure on
// either just leaves those specific fields null rather than the whole row.
function computeHistoryStats(price, historyResult, dividendResult) {
  const bars = historyResult.status === 'fulfilled' ? (historyResult.value.values || []) : [];

  let athPrice = null;
  let athDate = null;
  for (const bar of bars) {
    const high = parseFloat(bar.high);
    if (athPrice === null || high > athPrice) {
      athPrice = high;
      athDate = bar.datetime;
    }
  }

  const daysSinceAth = athDate
    ? Math.round((Date.now() - new Date(`${athDate}T00:00:00Z`).getTime()) / 86400000)
    : null;
  const vsAth = (price !== null && athPrice) ? ((price - athPrice) / athPrice) * 100 : null;

  let change12mo = null;
  if (price !== null && bars.length) {
    const priceYearAgo = findPriceDaysAgo(bars, 365);
    if (priceYearAgo) change12mo = ((price - priceYearAgo) / priceYearAgo) * 100;
  }

  let dividendYield = null;
  if (price !== null && price > 0 && dividendResult.status === 'fulfilled') {
    const total = sumTrailingDividends(dividendResult.value.dividends || [], 365);
    if (total > 0) dividendYield = (total / price) * 100;
  }

  return { athPrice, athDate, daysSinceAth, vsAth, change12mo, dividendYield };
}

// Promise.allSettled swallows individual endpoint failures so one bad call
// doesn't null out the whole row — but that also means a failure would
// otherwise vanish with zero trace. Logs a warning with the actual reason so
// intermittent per-endpoint failures (rate limits, timeouts) are visible in
// the workflow run instead of just showing up as an unexplained null field.
function logRejections(symbol, labels, results) {
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(`[WARN] ${symbol} ${labels[i]} failed: ${result.reason?.message || result.reason}`);
    }
  });
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
  // one doesn't stop the rest of the row from rendering.
  const [quoteResult, earningsResult, historyResult, dividendResult] = await Promise.allSettled([
    rateLimitedFetchJson(`${base}/quote?symbol=${symbol}&apikey=${API_KEY}`),
    rateLimitedFetchJson(`${base}/earnings?symbol=${symbol}&apikey=${API_KEY}`),
    rateLimitedFetchJson(`${base}/time_series?symbol=${symbol}&interval=1day&outputsize=5000&apikey=${API_KEY}`),
    rateLimitedFetchJson(`${base}/dividends?symbol=${symbol}&range=1Y&apikey=${API_KEY}`),
  ]);
  logRejections(symbol, ['quote', 'earnings', 'time_series', 'dividends'], [quoteResult, earningsResult, historyResult, dividendResult]);

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

  const stats = computeHistoryStats(price, historyResult, dividendResult);
  return { symbol, price, pe, ...stats };
}

async function loadIndex(symbol, exchange) {
  const base = 'https://api.twelvedata.com';
  // An explicit exchange keeps ambiguous tickers pinned to the right
  // instrument — without it, some symbols resolve to an unrelated company
  // that happens to share the same ticker on a different exchange.
  const exchangeParam = exchange ? `&exchange=${exchange}` : '';
  const [quoteResult, historyResult, dividendResult] = await Promise.allSettled([
    rateLimitedFetchJson(`${base}/quote?symbol=${symbol}${exchangeParam}&apikey=${API_KEY}`),
    rateLimitedFetchJson(`${base}/time_series?symbol=${symbol}${exchangeParam}&interval=1day&outputsize=5000&apikey=${API_KEY}`),
    rateLimitedFetchJson(`${base}/dividends?symbol=${symbol}${exchangeParam}&range=1Y&apikey=${API_KEY}`),
  ]);
  logRejections(symbol, ['quote', 'time_series', 'dividends'], [quoteResult, historyResult, dividendResult]);

  const price = quoteResult.status === 'fulfilled' ? parseFloat(quoteResult.value.close) : null;
  const stats = computeHistoryStats(price, historyResult, dividendResult);
  return { symbol, price, ...stats };
}

async function debugInvestigate() {
  const base = 'https://api.twelvedata.com';
  const calls = [
    ['quote', `${base}/quote?symbol=NWG&exchange=LSE&apikey=${API_KEY}`],
    ['earnings', `${base}/earnings?symbol=NWG&exchange=LSE&apikey=${API_KEY}`],
    ['time_series', `${base}/time_series?symbol=NWG&exchange=LSE&interval=1day&outputsize=5000&apikey=${API_KEY}`],
    ['dividends', `${base}/dividends?symbol=NWG&exchange=LSE&range=1Y&apikey=${API_KEY}`],
  ];
  for (const [label, url] of calls) {
    const res = await fetch(url);
    const headers = {};
    for (const [k, v] of res.headers.entries()) {
      if (k.toLowerCase().includes('credit') || k.toLowerCase().includes('limit') || k.toLowerCase().includes('rate')) {
        headers[k] = v;
      }
    }
    const body = await res.json();
    console.log(`[DEBUG ${label}] headers=${JSON.stringify(headers)}`);
    if (label === 'earnings') {
      console.log(`[DEBUG ${label}] body=${JSON.stringify(body).slice(0, 1500)}`);
    }
  }
}

async function main() {
  await debugInvestigate();
  return;
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
