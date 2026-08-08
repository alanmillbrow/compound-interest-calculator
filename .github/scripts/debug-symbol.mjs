// TEMPORARY, test-branch-only script — checking whether SPXP's anomalous
// block is a clean, consistent 100x error (correctable) or genuinely messy
// corrupted data (not correctable). Samples across the full history and
// prints both raw and /100 values so the shape of the anomaly is visible.

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const SYMBOL = process.env.DEBUG_SYMBOL;
const EXCHANGE = process.env.DEBUG_EXCHANGE || '';
const base = 'https://api.twelvedata.com';
const exchangeParam = EXCHANGE ? `&exchange=${EXCHANGE}` : '';

async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function main() {
  const series = await fetchJson(`${base}/time_series?symbol=${SYMBOL}${exchangeParam}&interval=1day&outputsize=5000&apikey=${API_KEY}`);
  const values = [...(series.values || [])].reverse(); // chronological

  // Sample one bar per ~30-day stretch across the whole series, printing
  // raw close and close/100, to see where the anomaly starts/ends and
  // whether /100 gives a smooth, plausible S&P 500 price curve throughout.
  let lastPrinted = null;
  for (const bar of values) {
    const d = new Date(`${bar.datetime}T00:00:00Z`);
    if (lastPrinted === null || d - lastPrinted >= 30 * 86400000) {
      const close = parseFloat(bar.close);
      console.log(`${bar.datetime}  raw=${close.toFixed(2)}  /100=${(close / 100).toFixed(2)}`);
      lastPrinted = d;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
