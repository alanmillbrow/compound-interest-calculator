#!/usr/bin/env node
// Fetches data for the lookout's tables from Twelve Data and writes the
// results to the-lookout/data.json, so the page can read a static file
// instead of every visitor's browser calling the API directly.
//
// Split into two modes (REFRESH_MODE env var, set by two separate workflow
// files) because Twelve Data's real per-call credit cost is wildly uneven:
// quote and time_series cost 1 credit each, but earnings and dividends cost
// 20 credits each (confirmed via the api-credits-used response header).
// Fetching everything for every symbol every run blew well past the
// 144-credit/minute budget — a single 10-company table needed 420 credits.
//   - REFRESH_MODE=price: quote + time_series for every symbol, every run.
//     Cheap (~70 credits total for all 35 symbols), so it just runs hourly
//     covering everything in one go — no staggering needed.
//   - REFRESH_MODE=fundamentals: earnings + dividends, on a much slower
//     weekly cadence, since P/E and dividend yield barely change hour to
//     hour. Paced by real credit cost (see waitForCreditBudget) since even
//     one run needs ~960 credits total and has to legitimately spread
//     across several real minutes to respect the budget. (Earnings is only
//     fetched for US companies — see loadFundamentals for why LSE
//     companies don't get a P/E at all. Commodities/crypto skip this tier
//     entirely — see the noFundamentals flag on COMMODITIES below — neither
//     P/E nor dividend yield is a meaningful concept for them.)
// Both modes merge their results into the existing data.json rather than
// overwriting it, via commitMergedResults' fetch-latest-and-retry loop —
// necessary because GitHub Actions resolves which commit a scheduled run
// checks out at trigger time, not at actual execution time, so a run that
// sits queued for a bit can otherwise push based on a stale base.

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
// underlying index, labelled by issuer since Vanguard, iShares and Invesco
// all track FTSE All-World here.
const INDICES_GBP = [
  { symbol: 'VUAG', name: 'S&P 500 Vanguard (Acc)', exchange: 'LSE' },
  { symbol: 'VUSA', name: 'S&P 500 Vanguard (Dist)', exchange: 'LSE' },
  { symbol: 'VWRP', name: 'FTSE All-World Vanguard (Acc)', exchange: 'LSE' },
  { symbol: 'VWRL', name: 'FTSE All-World Vanguard (Dist)', exchange: 'LSE' },
  { symbol: 'FTAW', name: 'FTSE All-World iShares (Acc)', exchange: 'LSE' },
  { symbol: 'FWRG', name: 'FTSE All-World Invesco (Acc)', exchange: 'LSE' },
  { symbol: 'VUKG', name: 'FTSE 100 Vanguard (Acc)', exchange: 'LSE' },
  { symbol: 'VUKE', name: 'FTSE 100 Vanguard (Dist)', exchange: 'LSE' },
];

const SPACE_FORCE = [
  { symbol: 'SPCX', name: 'SpaceX' },
  { symbol: 'RKLB', name: 'Rocket Lab' },
  { symbol: 'ASTS', name: 'AST SpaceMobile' },
  { symbol: 'PL', name: 'Planet Labs' },
  { symbol: 'LMT', name: 'Lockheed Martin' },
  { symbol: 'LHX', name: 'L3Harris' },
  { symbol: 'NOC', name: 'Northrop Grumman' },
  { symbol: 'BA', name: 'Boeing' },
];

// LSE-listed. Aviva resolves as "AV" — Twelve Data doesn't accept its
// official "AV." ticker (the trailing dot breaks the query parameter).
const FTSE_DIVIDENDS = [
  { symbol: 'LGEN', name: 'Legal & General', exchange: 'LSE' },
  { symbol: 'SDLF', name: 'Standard Life', exchange: 'LSE' },
  { symbol: 'MNG', name: 'M&G', exchange: 'LSE' },
  { symbol: 'LAND', name: 'Landsec', exchange: 'LSE' },
  { symbol: 'LMP', name: 'LondonMetric', exchange: 'LSE' },
  { symbol: 'AV', name: 'Aviva', exchange: 'LSE' },
  { symbol: 'IMB', name: 'Imperial Brands', exchange: 'LSE' },
  { symbol: 'BATS', name: 'British American Tobacco', exchange: 'LSE' },
  { symbol: 'NWG', name: 'NatWest Group', exchange: 'LSE' },
  { symbol: 'SBRY', name: "Sainsbury's", exchange: 'LSE' },
];

// No exchange param needed — resolve fine as plain pair symbols, confirmed
// live (both /quote and /time_series, on the current plan, no paywall).
const COMMODITIES = [
  { symbol: 'BTC/USD', name: 'Bitcoin' },
  { symbol: 'XAU/USD', name: 'Gold' },
  { symbol: 'XAG/USD', name: 'Silver' },
];

// Flat registry combining every table. `isIndex` marks the ETF-tracker
// tables (no per-company earnings, so no P/E) vs. individual companies.
// `noFundamentals` (commodities/crypto only) skips the fundamentals tier
// entirely — no earnings, no dividends, since neither concept applies.
const ALL_SYMBOLS = [
  ...STOCKS.map((s) => ({ ...s, section: 'stocks', isIndex: false })),
  ...INDICES.map((s) => ({ ...s, section: 'indices', isIndex: true })),
  ...INDICES_GBP.map((s) => ({ ...s, section: 'indicesGbp', isIndex: true })),
  ...SPACE_FORCE.map((s) => ({ ...s, section: 'spaceForce', isIndex: false })),
  ...FTSE_DIVIDENDS.map((s) => ({ ...s, section: 'ftseDividends', isIndex: false })),
  ...COMMODITIES.map((s) => ({ ...s, section: 'commodities', isIndex: true, noFundamentals: true })),
];

// Real per-call cost, confirmed via Twelve Data's api-credits-used response
// header — quote and time_series are cheap; earnings and dividends are not.
const CREDIT_COST = { quote: 1, time_series: 1, earnings: 20, dividends: 20 };
// Kept under the real 144/minute ceiling for some margin (concurrent
// in-flight calls can land a little past the threshold before it bites).
const CREDIT_BUDGET_PER_MINUTE = 120;
const RATE_WINDOW_MS = 60 * 1000;
const creditLog = []; // [{ ts, cost }, ...]

const MAX_CONCURRENT = 4;
const RETRY_WAIT_MS = 65 * 1000;
const MAX_ATTEMPTS = 3;

let activeCount = 0;
const waitQueue = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Blocks until dispatching `cost` more credits would stay within
// CREDIT_BUDGET_PER_MINUTE for the trailing 60 seconds, then reserves it.
async function waitForCreditBudget(cost) {
  for (;;) {
    const now = Date.now();
    while (creditLog.length && now - creditLog[0].ts >= RATE_WINDOW_MS) {
      creditLog.shift();
    }
    const used = creditLog.reduce((sum, e) => sum + e.cost, 0);
    if (used + cost <= CREDIT_BUDGET_PER_MINUTE) {
      creditLog.push({ ts: now, cost });
      return;
    }
    await sleep(RATE_WINDOW_MS - (now - creditLog[0].ts) + 250);
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

async function rateLimitedFetchJson(url, endpointType) {
  const cost = CREDIT_COST[endpointType];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await waitForCreditBudget(cost);
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

// Percentage change from `days` ago to `price`, using the same daily-bar
// history for every lookback window (1 month, 12 months, 3 years, 5 years)
// — no extra API calls, since time_series is already fetched with enough
// history (outputsize=5000 daily bars is ~19 years) to cover all of them.
function changeOverDays(price, bars, days) {
  if (price === null || !bars.length) return null;
  const priceThen = findPriceDaysAgo(bars, days);
  if (!priceThen) return null;
  return ((price - priceThen) / priceThen) * 100;
}

function sumTrailingDividends(dividends, days) {
  const cutoff = Date.now() - days * 86400000;
  return dividends
    .filter((d) => new Date(`${d.ex_date}T00:00:00Z`).getTime() >= cutoff)
    .reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
}

// Promise.allSettled swallows individual endpoint failures so one bad call
// doesn't wipe out the rest — but that also means a failure would otherwise
// vanish with zero trace. Logs a warning with the actual reason so
// intermittent per-endpoint failures (rate limits, timeouts) are visible in
// the workflow run instead of just showing up as an unexplained null field.
function logRejections(symbol, labels, results) {
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(`[WARN] ${symbol} ${labels[i]} failed: ${result.reason?.message || result.reason}`);
    }
  });
}

// Cheap half: current price, all-time high, drawdown, and price change over
// several lookback windows — quote + time_series only (1 credit each).
async function loadPrice(symbol, exchange) {
  const base = 'https://api.twelvedata.com';
  const exchangeParam = exchange ? `&exchange=${exchange}` : '';
  const [quoteResult, historyResult] = await Promise.allSettled([
    rateLimitedFetchJson(`${base}/quote?symbol=${symbol}${exchangeParam}&apikey=${API_KEY}`, 'quote'),
    rateLimitedFetchJson(`${base}/time_series?symbol=${symbol}${exchangeParam}&interval=1day&outputsize=5000&apikey=${API_KEY}`, 'time_series'),
  ]);
  logRejections(symbol, ['quote', 'time_series'], [quoteResult, historyResult]);

  // Some LSE-listed instruments are quoted by Twelve Data in pence
  // ("GBp") rather than pounds — confirmed per-symbol via the quote's own
  // currency field, not assumed by exchange (the Vanguard trackers above
  // are GBP; Invesco's FWRG came back GBp). This site's GBP tables are
  // pound-denominated, so normalise to pounds here rather than mixing
  // units within one table's Price/All-Time High columns. Percentage
  // fields (drawdown, change) are unaffected either way since they're
  // ratios of same-unit values.
  const currency = quoteResult.status === 'fulfilled' ? quoteResult.value.currency : null;
  const divisor = currency === 'GBp' ? 100 : 1;

  const price = quoteResult.status === 'fulfilled' ? parseFloat(quoteResult.value.close) / divisor : null;
  const rawBars = historyResult.status === 'fulfilled' ? (historyResult.value.values || []) : [];
  const bars = divisor === 1 ? rawBars : rawBars.map((bar) => ({
    ...bar,
    open: String(parseFloat(bar.open) / divisor),
    high: String(parseFloat(bar.high) / divisor),
    low: String(parseFloat(bar.low) / divisor),
    close: String(parseFloat(bar.close) / divisor),
  }));

  let athPrice = null;
  let athDate = null;
  for (const bar of bars) {
    const high = parseFloat(bar.high);
    if (athPrice === null || high > athPrice) {
      athPrice = high;
      athDate = bar.datetime;
    }
  }

  // Math.floor (not round) so "Today" stays correct for the entire calendar
  // day the ATH happened on — with round, anything more than ~12 hours past
  // midnight UTC on the ATH date rounded up to 1, showing "1" instead of
  // "Today" even while it was still the same day.
  const daysSinceAth = athDate
    ? Math.floor((Date.now() - new Date(`${athDate}T00:00:00Z`).getTime()) / 86400000)
    : null;
  const vsAth = (price !== null && athPrice) ? ((price - athPrice) / athPrice) * 100 : null;

  const change1mo = changeOverDays(price, bars, 30);
  const change12mo = changeOverDays(price, bars, 365);
  const change3yr = changeOverDays(price, bars, 365 * 3);
  const change5yr = changeOverDays(price, bars, 365 * 5);

  return { price, athPrice, athDate, daysSinceAth, vsAth, change1mo, change12mo, change3yr, change5yr };
}

// Expensive half: trailing P/E and dividend yield — earnings + dividends
// (20 credits each). Needs the current price (read from the existing
// data.json by the caller) rather than re-fetching quote, to avoid paying
// for a third call.
async function loadFundamentals(symbol, exchange, currentPrice, isIndex) {
  const base = 'https://api.twelvedata.com';
  const exchangeParam = exchange ? `&exchange=${exchange}` : '';
  const calls = [rateLimitedFetchJson(`${base}/dividends?symbol=${symbol}${exchangeParam}&range=1Y&apikey=${API_KEY}`, 'dividends')];
  // Indices are ETFs, not companies — there's no per-share earnings to
  // compute a P/E from, so skip that (expensive) call entirely for them.
  // LSE companies are skipped too: Twelve Data's /earnings for UK companies
  // isn't structured into 4 clean, evenly-spaced quarters the way US
  // companies' is — it's a mix of annual results, interim results, and
  // trading updates at irregular dates with no period-type field to tell
  // them apart, so "sum the last 4 entries" isn't a valid trailing-12-month
  // EPS for these (confirmed by checking Aviva's raw payload: 5 entries all
  // within a 4-month window, eps_actual swinging from -0.61 to 2.68).
  const fetchesEarnings = !isIndex && exchange !== 'LSE';
  if (fetchesEarnings) {
    calls.push(rateLimitedFetchJson(`${base}/earnings?symbol=${symbol}${exchangeParam}&apikey=${API_KEY}`, 'earnings'));
  }
  const results = await Promise.allSettled(calls);
  const [dividendResult, earningsResult] = results;
  logRejections(symbol, fetchesEarnings ? ['dividends', 'earnings'] : ['dividends'], results);

  let dividendYield = null;
  if (currentPrice !== null && currentPrice > 0 && dividendResult.status === 'fulfilled') {
    // currentPrice is already normalised to pounds (see loadPrice) — match
    // that here so the ratio stays in consistent units. Per-symbol, not
    // assumed: dividends' own currency field confirmed GBp for a
    // pence-quoted instrument (FWRG) even though it pays no cash
    // dividends itself (an Acc fund), so a future Dist pence-quoted
    // instrument would otherwise get a yield 100x too high.
    const dividendDivisor = dividendResult.value.meta?.currency === 'GBp' ? 100 : 1;
    const total = sumTrailingDividends(dividendResult.value.dividends || [], 365) / dividendDivisor;
    if (total > 0) dividendYield = (total / currentPrice) * 100;
  }

  let pe = null;
  if (fetchesEarnings && earningsResult?.status === 'fulfilled' && currentPrice !== null) {
    // Trailing (TTM) P/E = price / sum of the last four quarters' actual
    // EPS. Twelve Data returns earnings most-recent-first, so the first
    // four entries with a reported (non-null) eps_actual are the trailing
    // year. Requires a full four quarters to avoid a misleading
    // partial-year figure.
    const quarters = (earningsResult.value.earnings || [])
      .map((q) => q.eps_actual)
      .filter((v) => typeof v === 'number')
      .slice(0, 4);
    if (quarters.length === 4) {
      const ttmEps = quarters.reduce((sum, v) => sum + v, 0);
      if (ttmEps > 0) pe = currentPrice / ttmEps;
    }
  }

  return { pe, dividendYield };
}

// Reads data.json straight from origin/main's latest commit via git, not
// the local checkout — GitHub Actions resolves which commit a scheduled run
// checks out at *trigger* time, not execution time, so the local working
// tree can be stale by the time a run actually executes (e.g. if it sat
// queued for a bit behind another run that pushed in the meantime).
async function readLatestDataJson() {
  const { execSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  execSync('git fetch origin main --quiet', { cwd: repoRoot, stdio: 'inherit' });
  try {
    const content = execSync('git show origin/main:the-lookout/data.json', { cwd: repoRoot, encoding: 'utf8' });
    return JSON.parse(content);
  } catch {
    // First run, or the file doesn't exist yet.
    return {};
  }
}

// Re-fetches the latest data.json immediately before merging in this run's
// results and pushing, retrying on a race instead of trusting the checkout
// from job start (see readLatestDataJson above for why).
//
// `resultsBySection` is a Map<section, Map<symbol, partialFields>> — only
// the given fields are merged per symbol, leaving everything else (e.g.
// price fields during a fundamentals run) untouched.
async function commitMergedResults(resultsBySection) {
  const { execSync, spawnSync } = await import('node:child_process');
  const fs = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const outPath = new URL('../../the-lookout/data.json', import.meta.url);
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

  for (let attempt = 1; attempt <= 5; attempt++) {
    execSync('git fetch origin main --quiet', { cwd: repoRoot, stdio: 'inherit' });
    execSync('git reset --hard origin/main --quiet', { cwd: repoRoot, stdio: 'inherit' });

    let existing = {};
    try {
      existing = JSON.parse(await fs.readFile(outPath, 'utf8'));
    } catch {
      // First run, or the file doesn't exist yet — start from an empty object.
    }

    const output = { ...existing, savedAt: new Date().toISOString() };
    for (const [section, bySymbol] of resultsBySection) {
      output[section] = { ...(existing[section] || {}) };
      for (const [symbol, fields] of bySymbol) {
        output[section][symbol] = { ...(output[section][symbol] || { symbol }), ...fields };
      }
    }

    await fs.writeFile(outPath, JSON.stringify(output, null, 2) + '\n');
    execSync('git add the-lookout/data.json', { cwd: repoRoot });

    const diffStatus = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: repoRoot }).status;
    if (diffStatus === 0) {
      console.log('No changes to commit.');
      return;
    }
    // [skip netlify] stops this push from triggering a full Netlify deploy
    // (which costs build credits) for a data-only commit — the live page
    // reads data.json straight from GitHub's raw CDN instead, so it doesn't
    // need a Netlify deploy to see the update anyway.
    execSync('git commit -m "Refresh stock watch data [skip netlify]" --quiet', { cwd: repoRoot });

    const push = spawnSync('git', ['push', 'origin', 'HEAD:main'], { cwd: repoRoot, stdio: 'inherit' });
    if (push.status === 0) {
      console.log(`Pushed on attempt ${attempt}`);
      return;
    }
    console.log(`Push attempt ${attempt} lost a race with another run — retrying with a fresh base...`);
  }
  throw new Error('Failed to push after retries');
}

function addResult(resultsBySection, section, symbol, fields) {
  if (!resultsBySection.has(section)) resultsBySection.set(section, new Map());
  resultsBySection.get(section).set(symbol, fields);
}

async function runPriceRefresh() {
  const resultsBySection = new Map();
  await Promise.all(ALL_SYMBOLS.map(async (item) => {
    let fields;
    try {
      fields = await loadPrice(item.symbol, item.exchange);
    } catch (err) {
      console.warn(`[WARN] ${item.symbol} price refresh failed entirely: ${err.message}`);
      fields = {};
    }
    addResult(resultsBySection, item.section, item.symbol, fields);
  }));
  await commitMergedResults(resultsBySection);
}

async function runFundamentalsRefresh() {
  // Read fresh rather than trusting the local checkout — this run can take
  // several minutes (paced against the credit budget), so an hourly price
  // refresh landing on main mid-run is a real possibility, not just a
  // theoretical race.
  const current = await readLatestDataJson();

  const resultsBySection = new Map();
  await Promise.all(ALL_SYMBOLS.filter((item) => !item.noFundamentals).map(async (item) => {
    const currentPrice = current[item.section]?.[item.symbol]?.price ?? null;
    let fields;
    try {
      fields = await loadFundamentals(item.symbol, item.exchange, currentPrice, item.isIndex);
    } catch (err) {
      console.warn(`[WARN] ${item.symbol} fundamentals refresh failed entirely: ${err.message}`);
      fields = {};
    }
    addResult(resultsBySection, item.section, item.symbol, fields);
  }));
  await commitMergedResults(resultsBySection);
}

async function main() {
  const mode = process.env.REFRESH_MODE;
  if (mode === 'price') {
    await runPriceRefresh();
  } else if (mode === 'fundamentals') {
    await runFundamentalsRefresh();
  } else {
    throw new Error(`REFRESH_MODE must be "price" or "fundamentals", got: ${mode}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
