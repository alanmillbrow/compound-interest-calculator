(() => {
  'use strict';

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);

  const incomeInput = $('income');
  const incomeRange = $('incomeRange');
  const yearsInput = $('years');
  const yearsRange = $('yearsRange');
  const inflationInput = $('inflation');
  const inflationRange = $('inflationRange');
  const assetsInput = $('assets');
  const assetsRange = $('assetsRange');
  const returnRateInput = $('returnRate');
  const returnRateRange = $('returnRateRange');
  const leveragedInput = $('leveraged');
  const leveragedRange = $('leveragedRange');

  const currencyButtons = document.querySelectorAll('.currency-segmented .seg-btn');
  const incomeSymbol = $('incomeSymbol');
  const assetsSymbol = $('assetsSymbol');
  const leveragedSymbol = $('leveragedSymbol');

  const reqIncomeAnnual = $('reqIncomeAnnual');
  const reqIncomeMonthly = $('reqIncomeMonthly');
  const reqPassiveAnnual = $('reqPassiveAnnual');
  const reqPassiveMonthly = $('reqPassiveMonthly');

  const ruleEls = {
    3: { pot: $('pot3'), fvAssets: $('fvAssets3'), totalSaved: $('totalSaved3'), fvSavings: $('fvSavings3'), savings: $('savings3') },
    4: { pot: $('pot4'), fvAssets: $('fvAssets4'), totalSaved: $('totalSaved4'), fvSavings: $('fvSavings4'), savings: $('savings4') },
    5: { pot: $('pot5'), fvAssets: $('fvAssets5'), totalSaved: $('totalSaved5'), fvSavings: $('fvSavings5'), savings: $('savings5') },
  };

  const themeToggle = $('themeToggle');

  const copyLinkBtn = $('copyLinkBtn');
  const shareLinkBtn = $('shareLinkBtn');
  const bookmarkBtn = $('bookmarkBtn');
  const shareStatus = $('shareStatus');

  const chartRateButtons = document.querySelectorAll('.chart-rate-segmented .seg-btn');
  const chartTargetEl = $('chartTarget');
  const canvas = $('chart');
  const ctx = canvas.getContext('2d');
  const tooltip = $('tooltip');

  const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€' };
  let currentCurrency = 'GBP';
  let selectedChartRate = 4;

  // ---------- Formatting helpers ----------
  const fmtNumber = (n) => new Intl.NumberFormat('en-US').format(Math.round(n));
  const fmtCurrency = (n) => CURRENCY_SYMBOLS[currentCurrency] + fmtNumber(n);

  function parseNumber(str) {
    const cleaned = String(str).replace(/[^0-9.\-]/g, '');
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }

  function updateSliderFill(rangeEl) {
    const min = parseFloat(rangeEl.min);
    const max = parseFloat(rangeEl.max);
    const val = parseFloat(rangeEl.value);
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    rangeEl.style.setProperty('--fill', pct + '%');
  }

  function bindTextAndRange(textEl, rangeEl, { isCurrency = false, isInt = false } = {}) {
    function syncFromText() {
      let val = parseNumber(textEl.value);
      if (isInt) val = Math.round(val);
      if (val < parseFloat(rangeEl.min)) val = parseFloat(rangeEl.min);
      if (val > parseFloat(rangeEl.max)) val = parseFloat(rangeEl.max);
      rangeEl.value = val;
      updateSliderFill(rangeEl);
      render();
    }
    textEl.addEventListener('input', syncFromText);
    textEl.addEventListener('blur', () => {
      let val = parseNumber(textEl.value);
      if (isInt) val = Math.round(val);
      textEl.value = isCurrency ? fmtNumber(val) : val;
    });
    rangeEl.addEventListener('input', () => {
      const val = parseFloat(rangeEl.value);
      textEl.value = isCurrency ? fmtNumber(val) : val;
      updateSliderFill(rangeEl);
      render();
    });
    updateSliderFill(rangeEl);
  }

  bindTextAndRange(incomeInput, incomeRange, { isCurrency: true });
  bindTextAndRange(yearsInput, yearsRange, { isInt: true });
  bindTextAndRange(inflationInput, inflationRange, {});
  bindTextAndRange(assetsInput, assetsRange, { isCurrency: true });
  bindTextAndRange(returnRateInput, returnRateRange, {});
  bindTextAndRange(leveragedInput, leveragedRange, { isCurrency: true });

  currencyButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      currencyButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentCurrency = btn.dataset.currency;
      const symbol = CURRENCY_SYMBOLS[currentCurrency];
      incomeSymbol.textContent = symbol;
      assetsSymbol.textContent = symbol;
      leveragedSymbol.textContent = symbol;
      render();
    });
  });

  chartRateButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      chartRateButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedChartRate = parseInt(btn.dataset.rate, 10);
      render();
    });
  });

  // ---------- Shareable link ----------
  // Restore any values passed via the URL (e.g. from a bookmarked or
  // shared link), falling back to the page's defaults for anything absent
  function applyUrlParams() {
    const params = new URLSearchParams(location.search);

    const currencyParam = params.get('currency');
    if (currencyParam && CURRENCY_SYMBOLS[currencyParam]) {
      currentCurrency = currencyParam;
      currencyButtons.forEach((b) => b.classList.toggle('active', b.dataset.currency === currencyParam));
      const symbol = CURRENCY_SYMBOLS[currentCurrency];
      incomeSymbol.textContent = symbol;
      assetsSymbol.textContent = symbol;
      leveragedSymbol.textContent = symbol;
    }

    function setField(param, textEl, rangeEl, isCurrency, isInt) {
      if (!params.has(param)) return;
      let val = parseNumber(params.get(param));
      if (isInt) val = Math.round(val);
      if (val < parseFloat(rangeEl.min)) val = parseFloat(rangeEl.min);
      if (val > parseFloat(rangeEl.max)) val = parseFloat(rangeEl.max);
      rangeEl.value = val;
      textEl.value = isCurrency ? fmtNumber(val) : val;
      updateSliderFill(rangeEl);
    }

    setField('income', incomeInput, incomeRange, true, false);
    setField('years', yearsInput, yearsRange, false, true);
    setField('inflation', inflationInput, inflationRange, false, false);
    setField('assets', assetsInput, assetsRange, true, false);
    setField('rate', returnRateInput, returnRateRange, false, false);
    setField('leveraged', leveragedInput, leveragedRange, true, false);

    const chartRateParam = params.get('chartRate');
    if (chartRateParam === '3' || chartRateParam === '4' || chartRateParam === '5') {
      selectedChartRate = parseInt(chartRateParam, 10);
      chartRateButtons.forEach((b) => b.classList.toggle('active', b.dataset.rate === chartRateParam));
    }
  }

  function currentParams() {
    const params = new URLSearchParams();
    params.set('income', Math.round(parseNumber(incomeInput.value)));
    params.set('years', Math.round(parseNumber(yearsInput.value)));
    params.set('inflation', parseNumber(inflationInput.value));
    params.set('assets', Math.round(parseNumber(assetsInput.value)));
    params.set('rate', parseNumber(returnRateInput.value));
    params.set('leveraged', Math.round(parseNumber(leveragedInput.value)));
    params.set('currency', currentCurrency);
    params.set('chartRate', selectedChartRate);
    return params;
  }

  // Keep the address bar in sync so the page can be bookmarked directly,
  // without needing an extra history entry per keystroke
  function updateUrl() {
    history.replaceState(null, '', `${location.pathname}?${currentParams().toString()}`);
  }

  // Dragging a slider fires many 'input' events a second, and browsers
  // rate-limit history.replaceState — burst past the limit and further
  // calls are silently dropped, leaving the address bar stuck on a stale
  // value. Trailing-throttle it instead; since updateUrl() reads live DOM
  // state, the eventual call always flushes the current value. Copy
  // link/Share/Bookmark are unaffected either way since they build the URL
  // from live state directly, not from the address bar.
  let urlUpdateTimer = null;
  function scheduleUrlUpdate() {
    if (urlUpdateTimer) return;
    urlUpdateTimer = setTimeout(() => {
      urlUpdateTimer = null;
      updateUrl();
    }, 200);
  }

  function shareUrl() {
    return `${location.origin}${location.pathname}?${currentParams().toString()}`;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error('Clipboard API unavailable'));
  }

  let statusTimer = null;
  function setStatus(msg, duration = 3000) {
    shareStatus.textContent = msg;
    clearTimeout(statusTimer);
    if (duration) statusTimer = setTimeout(() => { shareStatus.textContent = ''; }, duration);
  }

  copyLinkBtn.addEventListener('click', () => {
    const url = shareUrl();
    copyToClipboard(url)
      .then(() => setStatus('Link copied to your clipboard'))
      .catch(() => window.prompt('Copy this link:', url));
  });

  shareLinkBtn.addEventListener('click', () => {
    const url = shareUrl();
    if (navigator.share) {
      navigator.share({ title: document.title, url }).catch((err) => {
        if (err && err.name !== 'AbortError') setStatus('Could not open the share sheet');
      });
    } else {
      copyToClipboard(url)
        .then(() => setStatus('Sharing isn’t supported here — link copied instead'))
        .catch(() => window.prompt('Copy this link to share:', url));
    }
  });

  bookmarkBtn.addEventListener('click', () => {
    const url = shareUrl();
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const shortcut = isMac ? '⌘D' : 'Ctrl+D';
    copyToClipboard(url)
      .then(() => setStatus(`Link copied — press ${shortcut} to bookmark this page`, 5000))
      .catch(() => window.prompt(`Copy this link, then press ${shortcut} to bookmark this page:`, url));
  });

  applyUrlParams();

  // ---------- Calculation ----------
  // The monthly contribution (paid at the end of each month) required for
  // a lump sum plus a savings annuity to reach `target` after `months`
  // months of compounding at `monthlyRate`. Returns 0 once the lump sum
  // alone is already projected to clear the target, and null when there's
  // no time left for a savings plan to act (months <= 0).
  function requiredMonthlySavings(target, currentAssets, monthlyRate, months) {
    if (months <= 0) return null;
    const growthFactor = Math.pow(1 + monthlyRate, months);
    const futureAssets = currentAssets * growthFactor;
    const shortfall = target - futureAssets;
    if (shortfall <= 0) return 0;
    if (monthlyRate === 0) return shortfall / months;
    const annuityFactor = (growthFactor - 1) / monthlyRate;
    return shortfall / annuityFactor;
  }

  function render() {
    const desiredIncome = parseNumber(incomeInput.value);
    const years = Math.max(0, Math.round(parseNumber(yearsInput.value)));
    const inflation = parseNumber(inflationInput.value) / 100;
    const assets = parseNumber(assetsInput.value);
    const annualReturn = parseNumber(returnRateInput.value) / 100;
    const leveraged = parseNumber(leveragedInput.value);

    const futureMonthlyIncome = desiredIncome * Math.pow(1 + inflation, years);
    const futureAnnualIncome = futureMonthlyIncome * 12;
    reqIncomeAnnual.textContent = fmtCurrency(futureAnnualIncome);
    reqIncomeMonthly.textContent = fmtCurrency(futureMonthlyIncome);

    const passiveMonthly = Math.max(0, futureMonthlyIncome - leveraged);
    const passiveAnnual = passiveMonthly * 12;
    reqPassiveAnnual.textContent = fmtCurrency(passiveAnnual);
    reqPassiveMonthly.textContent = fmtCurrency(passiveMonthly);

    const monthlyRate = annualReturn / 12;
    const months = years * 12;
    const futureAssets = assets * Math.pow(1 + monthlyRate, months);

    const chartData = {};

    for (const rate of [3, 4, 5]) {
      const els = ruleEls[rate];
      const potRequired = passiveAnnual / (rate / 100);
      els.pot.textContent = fmtCurrency(potRequired);
      els.fvAssets.textContent = fmtCurrency(futureAssets);
      els.fvSavings.textContent = fmtCurrency(Math.max(0, potRequired - futureAssets));

      const pmt = requiredMonthlySavings(potRequired, assets, monthlyRate, months);
      let pmtForChart = 0;
      if (pmt === null) {
        els.savings.innerHTML = potRequired <= assets
          ? 'On track'
          : `<span>${fmtCurrency(potRequired - futureAssets)}<span class="headline-value-caption">needed now</span></span>`;
        els.totalSaved.textContent = fmtCurrency(0);
      } else if (pmt <= 0) {
        els.savings.textContent = 'On track';
        els.totalSaved.textContent = fmtCurrency(0);
      } else {
        els.savings.textContent = fmtCurrency(pmt);
        els.totalSaved.textContent = fmtCurrency(pmt * months);
        pmtForChart = pmt;
      }
      chartData[rate] = { potRequired, pmt: pmtForChart };
    }

    const selected = chartData[selectedChartRate];

    let sentence;
    if (leveraged > 0) {
      sentence = `<strong>${fmtCurrency(selected.potRequired)}</strong> is enough to provide <strong>${fmtCurrency(passiveMonthly)}</strong> a month in passive income, using the ${selectedChartRate}% rule.`;
      sentence += ` Combined with your expected <strong>${fmtCurrency(leveraged)}</strong> a month leveraged income, that provides your <strong>${fmtCurrency(futureMonthlyIncome)}</strong> desired monthly income`;
    } else {
      sentence = `<strong>${fmtCurrency(selected.potRequired)}</strong> is enough to provide your <strong>${fmtCurrency(passiveMonthly)}</strong> desired monthly income, using the ${selectedChartRate}% rule`;
    }
    chartTargetEl.innerHTML = sentence;

    const series = calculateSavingsSeries(assets, selected.pmt, monthlyRate, months);
    drawChart(series, assets, selected.potRequired);

    scheduleUrlUpdate();
  }

  // ---------- Chart (canvas, no dependencies) ----------
  function calculateSavingsSeries(principal, monthlyContribution, monthlyRate, months) {
    let balance = principal;
    let contributed = principal;
    const yearly = [];
    for (let m = 1; m <= months; m++) {
      balance = balance * (1 + monthlyRate) + monthlyContribution;
      contributed += monthlyContribution;
      if (m % 12 === 0) {
        yearly.push({ year: m / 12, contributed, balance, interest: balance - contributed });
      }
    }
    return yearly;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function hexToRgba(color, alpha) {
    if (color.startsWith('#')) {
      let c = color.substring(1);
      if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
      const num = parseInt(c, 16);
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  }

  function compactCurrency(v) {
    const symbol = CURRENCY_SYMBOLS[currentCurrency];
    if (v >= 1_000_000) return symbol + (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1_000) return symbol + (v / 1_000).toFixed(0) + 'K';
    return symbol + Math.round(v);
  }

  const CHART_HEIGHT = 260;

  function setupCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.style.height = CHART_HEIGHT + 'px';
    canvas.width = rect.width * dpr;
    canvas.height = CHART_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: CHART_HEIGHT };
  }

  let lastChartGeometry = null;
  let lastChartParams = null;

  function drawChart(yearly, principal, potRequired) {
    lastChartParams = { yearly, principal, potRequired };

    const { width, height } = setupCanvasSize();
    ctx.clearRect(0, 0, width, height);

    const points = [{ year: 0, contributed: principal, interest: 0, balance: principal }, ...yearly];
    if (points.length < 2) {
      lastChartGeometry = null;
      return;
    }

    const padding = { top: 16, right: 24, bottom: 28, left: 64 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const maxBalance = Math.max(potRequired, ...points.map((p) => p.balance)) * 1.05;
    const maxYear = points[points.length - 1].year;

    const xForYear = (y) => padding.left + (y / maxYear) * plotW;
    const yForVal = (v) => padding.top + plotH - (v / maxBalance) * plotH;

    const contribColor = cssVar('--contrib');
    const interestColor = cssVar('--interest');
    const targetColor = cssVar('--multiple');
    const textSecondary = cssVar('--text-secondary');
    const gridColor = cssVar('--card-border');

    // Grid + Y axis labels
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillStyle = textSecondary;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const val = (maxBalance / ySteps) * i;
      const yy = yForVal(val);
      ctx.beginPath();
      ctx.moveTo(padding.left, yy);
      ctx.lineTo(width - padding.right, yy);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(compactCurrency(val), padding.left - 10, yy);
    }

    // X axis labels (years)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const maxLabels = width < 500 ? 10 : 15;
    const xLabelStep = Math.max(1, Math.ceil(maxYear / Math.max(1, maxLabels - 1)));
    for (let y = 0; y <= maxYear; y += xLabelStep) {
      ctx.fillText('Yr ' + y, xForYear(y), height - padding.bottom + 8);
    }

    // Stacked area: current assets + savings (bottom), investment return (top)
    function drawArea(getTop, getBottom, color) {
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = xForYear(p.year);
        const y = yForVal(getTop(p));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        ctx.lineTo(xForYear(p.year), yForVal(getBottom(p)));
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    drawArea((p) => p.contributed, () => 0, hexToRgba(contribColor, 0.35));
    drawArea((p) => p.balance, (p) => p.contributed, hexToRgba(interestColor, 0.35));

    // Lines on top
    function drawLine(getVal, color) {
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = xForYear(p.year);
        const y = yForVal(getVal(p));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.25;
      ctx.stroke();
    }

    drawLine((p) => p.contributed, contribColor);
    drawLine((p) => p.balance, interestColor);

    // Target pot — dashed reference line
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    const targetY = yForVal(potRequired);
    ctx.moveTo(padding.left, targetY);
    ctx.lineTo(width - padding.right, targetY);
    ctx.strokeStyle = targetColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    lastChartGeometry = { padding, plotW, plotH, maxYear, maxBalance, points, potRequired, xForYear, yForVal, width, height };
  }

  canvas.addEventListener('mousemove', (e) => {
    if (!lastChartGeometry) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { points, maxYear, padding, plotW, potRequired } = lastChartGeometry;
    const relX = (mx - padding.left) / plotW;
    const yearFloat = relX * maxYear;
    const year = Math.round(Math.max(0, Math.min(maxYear, yearFloat)));
    const point = points.find((p) => p.year === year) || points[points.length - 1];

    tooltip.style.opacity = '1';
    tooltip.style.left = mx + 'px';
    tooltip.style.top = (lastChartGeometry.yForVal(point.balance)) + 'px';
    tooltip.innerHTML = `
      <strong>Year ${point.year}</strong><br>
      Balance: ${fmtCurrency(point.balance)}<br>
      Contributed: ${fmtCurrency(point.contributed)}<br>
      Investment return: ${fmtCurrency(point.interest)}<br>
      Target pot: ${fmtCurrency(potRequired)}
    `;
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
  });

  window.addEventListener('resize', () => {
    if (lastChartParams) {
      drawChart(lastChartParams.yearly, lastChartParams.principal, lastChartParams.potRequired);
    }
  });

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
    render();
  });

  // ---------- Init ----------
  initTheme();
  render();
})();
