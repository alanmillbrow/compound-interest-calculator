(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const incomeInput = $('income');
  const incomeRange = $('incomeRange');
  const expensesInput = $('expenses');
  const expensesRange = $('expensesRange');
  const assetsInput = $('assets');
  const assetsRange = $('assetsRange');
  const returnRateInput = $('returnRate');
  const returnRateRange = $('returnRateRange');
  const minAssetsInput = $('minAssets');
  const minAssetsRange = $('minAssetsRange');

  const currencyButtons = document.querySelectorAll('.currency-segmented .seg-btn');
  const incomeSymbol = $('incomeSymbol');
  const expensesSymbol = $('expensesSymbol');
  const assetsSymbol = $('assetsSymbol');
  const minAssetsSymbol = $('minAssetsSymbol');

  const posIncome = $('posIncome');
  const posExpenses = $('posExpenses');
  const posShortfall = $('posShortfall');
  const posCoverage = $('posCoverage');
  const runwayValue = $('runwayValue');
  const dWeeks = $('dWeeks');
  const dMonths = $('dMonths');
  const dYears = $('dYears');

  const themeToggle = $('themeToggle');

  const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€' };
  let currentCurrency = 'GBP';

  const fmtNumber = (n) => new Intl.NumberFormat('en-US').format(Math.round(n));
  const fmtCurrency = (n) => CURRENCY_SYMBOLS[currentCurrency] + fmtNumber(n);

  function parseNumber(str) {
    const cleaned = String(str).replace(/[^0-9.\-]/g, '');
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }

  // Duration number: 1 decimal place, trimmed if whole
  function fmtDur(v) {
    const r = Math.round(v * 10) / 10;
    return (Math.abs(r % 1) < 1e-9) ? String(Math.round(r)) : r.toFixed(1);
  }

  function updateSliderFill(rangeEl) {
    const min = parseFloat(rangeEl.min);
    const max = parseFloat(rangeEl.max);
    const val = parseFloat(rangeEl.value);
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    rangeEl.style.setProperty('--fill', pct + '%');
  }

  function bindTextAndRange(textEl, rangeEl, { isCurrency = false, onChange } = {}) {
    function clamp(val) {
      if (val < parseFloat(rangeEl.min)) val = parseFloat(rangeEl.min);
      if (val > parseFloat(rangeEl.max)) val = parseFloat(rangeEl.max);
      return val;
    }
    textEl.addEventListener('input', () => {
      const val = clamp(parseNumber(textEl.value));
      rangeEl.value = val;
      updateSliderFill(rangeEl);
      if (onChange) onChange(val);
      render();
    });
    textEl.addEventListener('blur', () => {
      const val = clamp(parseNumber(textEl.value));
      textEl.value = isCurrency ? fmtNumber(val) : val;
      rangeEl.value = val;
      updateSliderFill(rangeEl);
      if (onChange) onChange(val);
      render();
    });
    rangeEl.addEventListener('input', () => {
      const val = parseFloat(rangeEl.value);
      textEl.value = isCurrency ? fmtNumber(val) : val;
      updateSliderFill(rangeEl);
      if (onChange) onChange(val);
      render();
    });
    updateSliderFill(rangeEl);
  }

  // Keep the minimum-liquid-assets slider capped at the current total liquid assets
  function syncMinAssetsCeiling(assetsVal) {
    minAssetsRange.max = assetsVal;
    minAssetsRange.step = assetsVal < 100000 ? 1000 : assetsVal < 500000 ? 5000 : 10000;
    let minVal = parseNumber(minAssetsInput.value);
    if (minVal > assetsVal) {
      minVal = assetsVal;
      minAssetsInput.value = fmtNumber(minVal);
    }
    minAssetsRange.value = minVal;
    updateSliderFill(minAssetsRange);
  }

  bindTextAndRange(incomeInput, incomeRange, { isCurrency: true });
  bindTextAndRange(expensesInput, expensesRange, { isCurrency: true });
  bindTextAndRange(assetsInput, assetsRange, { isCurrency: true, onChange: syncMinAssetsCeiling });
  bindTextAndRange(returnRateInput, returnRateRange, {});
  bindTextAndRange(minAssetsInput, minAssetsRange, { isCurrency: true });

  syncMinAssetsCeiling(parseNumber(assetsInput.value));

  currencyButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      currencyButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentCurrency = btn.dataset.currency;
      const s = CURRENCY_SYMBOLS[currentCurrency];
      incomeSymbol.textContent = s;
      expensesSymbol.textContent = s;
      assetsSymbol.textContent = s;
      minAssetsSymbol.textContent = s;
      render();
    });
  });

  function render() {
    const income = parseNumber(incomeInput.value);
    const expenses = parseNumber(expensesInput.value);
    const assets = parseNumber(assetsInput.value);
    const minAssets = Math.min(parseNumber(minAssetsInput.value), assets);
    const shortfall = expenses - income;

    posIncome.textContent = fmtCurrency(income);
    posExpenses.textContent = fmtCurrency(expenses);
    posCoverage.textContent = expenses > 0 ? Math.round((income / expenses) * 100) + '%' : '—';

    if (shortfall <= 0) {
      // Income already covers lifestyle — the runway never ends
      posShortfall.textContent = fmtCurrency(0);
      runwayValue.textContent = "You’re free";
      dWeeks.textContent = '∞';
      dMonths.textContent = '∞';
      dYears.textContent = '∞';
      return;
    }

    posShortfall.textContent = fmtCurrency(shortfall);

    const monthlyRate = parseNumber(returnRateInput.value) / 100 / 12;

    let months;
    if (monthlyRate <= 0) {
      months = (assets - minAssets) / shortfall;
    } else {
      const x = (assets * monthlyRate) / shortfall;
      if (x >= 1) {
        // Investment growth on the unused balance outpaces the shortfall — never runs out
        runwayValue.textContent = "You’re free";
        dWeeks.textContent = '∞';
        dMonths.textContent = '∞';
        dYears.textContent = '∞';
        return;
      }
      // Perpetuity balance level where growth exactly offsets the shortfall
      const perpetuityLevel = shortfall / monthlyRate;
      months = Math.log((perpetuityLevel - minAssets) / (perpetuityLevel - assets)) / Math.log(1 + monthlyRate);
    }

    const weeks = months * 52 / 12;
    const years = months / 12;

    dWeeks.textContent = fmtNumber(weeks);
    dMonths.textContent = fmtDur(months);
    dYears.textContent = fmtDur(years);

    // Headline: show the most natural unit for the size of the runway
    let unit, valStr;
    if (years >= 1) { unit = 'year'; valStr = fmtDur(years); }
    else if (months >= 1) { unit = 'month'; valStr = fmtDur(months); }
    else { unit = 'week'; valStr = fmtNumber(weeks); }
    const plural = valStr === '1' ? '' : 's';
    runwayValue.textContent = `${valStr} ${unit}${plural}`;
  }

  // ---------- Theme ----------
  function initTheme() {
    const saved = localStorage.getItem('cic-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));
  }
  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('cic-theme', next);
  });

  initTheme();
  render();
})();
