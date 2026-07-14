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

  const chartCanvas = $('chart');
  const chartCtx = chartCanvas.getContext('2d');
  const chartTooltip = $('tooltip');

  const toggleTableBtn = $('toggleTable');
  const tableWrap = $('tableWrap');
  const tableBody = $('tableBody');

  const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€' };
  let currentCurrency = 'GBP';

  const fmtNumber = (n) => new Intl.NumberFormat('en-US').format(Math.round(n));
  const fmtCurrency = (n) => CURRENCY_SYMBOLS[currentCurrency] + fmtNumber(n);

  function parseNumber(str) {
    const cleaned = String(str).replace(/[^0-9.\-]/g, '');
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }

  // Duration number: 1 decimal place, trimmed if whole, comma-separated
  function fmtDur(v) {
    const r = Math.round(v * 10) / 10;
    const isWhole = Math.abs(r % 1) < 1e-9;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: isWhole ? 0 : 1,
      maximumFractionDigits: 1,
    }).format(r);
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

  // Months until the balance reaches minAssets, or null if it never does
  function computeRunwayMonths(assets, shortfall, monthlyRate, minAssets) {
    if (shortfall <= 0) return null; // income covers expenses — runway never ends
    if (monthlyRate <= 0) {
      return (assets - minAssets) / shortfall;
    }
    const x = (assets * monthlyRate) / shortfall;
    if (x >= 1) return null; // investment growth outpaces the shortfall — runway never ends
    // Perpetuity balance level where growth exactly offsets the shortfall
    const perpetuityLevel = shortfall / monthlyRate;
    return Math.log((perpetuityLevel - minAssets) / (perpetuityLevel - assets)) / Math.log(1 + monthlyRate);
  }

  function render() {
    const income = parseNumber(incomeInput.value);
    const expenses = parseNumber(expensesInput.value);
    const assets = parseNumber(assetsInput.value);
    const minAssets = Math.min(parseNumber(minAssetsInput.value), assets);
    const shortfall = expenses - income;
    const monthlyRate = parseNumber(returnRateInput.value) / 100 / 12;

    posIncome.textContent = fmtCurrency(income);
    posExpenses.textContent = fmtCurrency(expenses);
    posCoverage.textContent = expenses > 0 ? Math.round((income / expenses) * 100) + '%' : '—';
    posShortfall.textContent = fmtCurrency(Math.max(0, shortfall));

    const months = computeRunwayMonths(assets, shortfall, monthlyRate, minAssets);

    if (months === null) {
      runwayValue.textContent = "You’re free";
      dWeeks.textContent = '∞';
      dMonths.textContent = '∞';
      dYears.textContent = '∞';
    } else {
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

    drawFreedomChart(assets, income, expenses, monthlyRate, minAssets, months);
  }

  // ---------- Chart (canvas, no dependencies) ----------
  // runwayMonths is null when the balance never reaches minAssets (infinite runway)
  function calculateChartSeries(assets, income, expenses, monthlyRate, minAssets, runwayMonths) {
    const netFlow = income - expenses;
    const isInfinite = runwayMonths === null;
    // The 50-year cap only applies when the money never runs out — a
    // finite runway is always shown in full, however long it takes
    const wholeYears = isInfinite ? 50 : Math.floor(runwayMonths / 12);

    let balance = assets;
    let contributed = assets;
    const totalMonths = wholeYears * 12;
    const yearly = [];
    for (let m = 1; m <= totalMonths; m++) {
      balance = balance * (1 + monthlyRate) + netFlow;
      contributed += netFlow;
      if (m % 12 === 0) {
        yearly.push({ year: m / 12, contributed, balance, interest: balance - contributed });
      }
    }

    // Cut the line off at the exact moment the runway ends, rather than
    // rounding up to the next whole year. At that instant the balance is
    // exactly minAssets by definition, so this is a closed-form point —
    // no need to simulate a partial month.
    if (!isInfinite) {
      const runwayYears = runwayMonths / 12;
      if (runwayYears - wholeYears > 1e-9) {
        const endContributed = assets + netFlow * runwayMonths;
        yearly.push({ year: runwayYears, contributed: endContributed, balance: minAssets, interest: minAssets - endContributed });
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

  function renderTable(points) {
    tableBody.innerHTML = '';
    for (const row of points) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmtDur(row.year)}</td>
        <td>${fmtCurrency(row.contributed)}</td>
        <td>${fmtCurrency(row.interest)}</td>
        <td>${fmtCurrency(row.balance)}</td>
      `;
      tableBody.appendChild(tr);
    }
  }

  toggleTableBtn.addEventListener('click', () => {
    const hidden = tableWrap.classList.toggle('hidden');
    toggleTableBtn.textContent = hidden ? 'Show table' : 'Hide table';
  });

  function compactCurrency(v) {
    const symbol = CURRENCY_SYMBOLS[currentCurrency];
    const sign = v < 0 ? '-' : '';
    const av = Math.abs(v);
    if (av >= 1_000_000) return sign + symbol + (av / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (av >= 1_000) return sign + symbol + (av / 1_000).toFixed(0) + 'K';
    return sign + symbol + Math.round(av);
  }

  const CHART_HEIGHT = 260;

  function setupCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = chartCanvas.getBoundingClientRect();
    chartCanvas.style.height = CHART_HEIGHT + 'px';
    chartCanvas.width = rect.width * dpr;
    chartCanvas.height = CHART_HEIGHT * dpr;
    chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: CHART_HEIGHT };
  }

  let lastChartGeometry = null;
  let lastChartParams = null;

  function drawFreedomChart(assets, income, expenses, monthlyRate, minAssets, runwayMonths) {
    lastChartParams = { assets, income, expenses, monthlyRate, minAssets, runwayMonths };

    const yearly = calculateChartSeries(assets, income, expenses, monthlyRate, minAssets, runwayMonths);
    const { width, height } = setupCanvasSize();
    chartCtx.clearRect(0, 0, width, height);

    const points = [{ year: 0, contributed: assets, balance: assets, interest: 0 }, ...yearly];
    renderTable(points);

    const padding = { top: 16, right: 24, bottom: 28, left: 64 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    // Y axis always starts at zero, even if the balance dips below it —
    // the line/area simply runs off the bottom of the plot in that case
    const minVal = 0;
    const maxVal = Math.max(...points.flatMap((p) => [p.contributed, p.balance, 0]));
    const valRange = (maxVal - minVal) || 1;
    const maxYear = points[points.length - 1].year || 1; // guard against a zero-length runway

    const xForYear = (y) => padding.left + (y / maxYear) * plotW;
    const yForVal = (v) => padding.top + plotH - ((v - minVal) / valRange) * plotH;

    const contribColor = cssVar('--contrib');
    const interestColor = cssVar('--interest');
    const textSecondary = cssVar('--text-secondary');
    const gridColor = cssVar('--card-border');

    // Grid + Y axis labels
    chartCtx.font = '11px -apple-system, sans-serif';
    chartCtx.fillStyle = textSecondary;
    chartCtx.strokeStyle = gridColor;
    chartCtx.lineWidth = 1;
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const val = minVal + (valRange / ySteps) * i;
      const yy = yForVal(val);
      chartCtx.beginPath();
      chartCtx.moveTo(padding.left, yy);
      chartCtx.lineTo(width - padding.right, yy);
      chartCtx.stroke();
      chartCtx.textAlign = 'right';
      chartCtx.textBaseline = 'middle';
      chartCtx.fillText(compactCurrency(val), padding.left - 10, yy);
    }

    // X axis labels (years)
    chartCtx.textAlign = 'center';
    chartCtx.textBaseline = 'top';
    const maxLabels = width < 500 ? 10 : 15;
    const xLabelStep = Math.max(1, Math.ceil(maxYear / Math.max(1, maxLabels - 1)));
    for (let y = 0; y <= maxYear; y += xLabelStep) {
      chartCtx.fillText('Yr ' + y, xForYear(y), height - padding.bottom + 8);
    }

    // Stacked area: contributions (bottom) + investment return (top).
    // Values are clamped to zero for drawing only — anything below the
    // zero-pinned axis is simply not rendered, so it never draws over the
    // x-axis labels. The real (possibly negative) figures still surface
    // on hover.
    function drawArea(getTop, getBottom, color) {
      chartCtx.beginPath();
      points.forEach((p, i) => {
        const x = xForYear(p.year);
        const y = yForVal(Math.max(0, getTop(p)));
        if (i === 0) chartCtx.moveTo(x, y);
        else chartCtx.lineTo(x, y);
      });
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        chartCtx.lineTo(xForYear(p.year), yForVal(Math.max(0, getBottom(p))));
      }
      chartCtx.closePath();
      chartCtx.fillStyle = color;
      chartCtx.fill();
    }

    drawArea((p) => p.contributed, () => 0, hexToRgba(contribColor, 0.35));
    drawArea((p) => p.balance, (p) => p.contributed, hexToRgba(interestColor, 0.35));

    // Lines on top. Stop exactly at the zero-crossing (interpolated) rather
    // than clamping every point after it — otherwise several flat segments
    // would sit right on top of the zero gridline, making it look thicker.
    function drawLine(getVal, color) {
      chartCtx.beginPath();
      let started = false;
      for (let i = 0; i < points.length; i++) {
        const raw = getVal(points[i]);
        if (raw >= 0) {
          const x = xForYear(points[i].year);
          const y = yForVal(raw);
          if (!started) { chartCtx.moveTo(x, y); started = true; }
          else chartCtx.lineTo(x, y);
        } else {
          const prev = points[i - 1];
          const prevRaw = prev ? getVal(prev) : raw;
          if (prev && prevRaw > 0) {
            const t = prevRaw / (prevRaw - raw);
            const crossYear = prev.year + t * (points[i].year - prev.year);
            const x = xForYear(crossYear);
            const y = yForVal(0);
            if (!started) { chartCtx.moveTo(x, y); started = true; }
            else chartCtx.lineTo(x, y);
          }
          break;
        }
      }
      chartCtx.strokeStyle = color;
      chartCtx.lineWidth = 2.25;
      chartCtx.stroke();
    }

    drawLine((p) => p.contributed, contribColor);
    drawLine((p) => p.balance, interestColor);

    lastChartGeometry = { padding, plotW, plotH, maxYear, points, xForYear, yForVal, width, height };
  }

  chartCanvas.addEventListener('mousemove', (e) => {
    if (!lastChartGeometry) return;
    const rect = chartCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { points, maxYear, padding, plotW, plotH } = lastChartGeometry;
    const relX = (mx - padding.left) / plotW;
    const yearFloat = Math.max(0, Math.min(maxYear, relX * maxYear));

    // Snap to whichever plotted point (whole year, or the exact runway-end
    // fractional year) is nearest — points aren't always evenly spaced
    let point = points[0];
    let bestDist = Infinity;
    for (const p of points) {
      const dist = Math.abs(p.year - yearFloat);
      if (dist < bestDist) { bestDist = dist; point = p; }
    }

    // Keep the tooltip box within the visible plot area even when the
    // balance itself has run off the bottom (below the zero-pinned axis)
    const tooltipY = Math.max(padding.top, Math.min(padding.top + plotH, lastChartGeometry.yForVal(point.balance)));

    chartTooltip.style.opacity = '1';
    chartTooltip.style.left = mx + 'px';
    chartTooltip.style.top = tooltipY + 'px';
    chartTooltip.innerHTML = `
      <strong>Year ${fmtDur(point.year)}</strong><br>
      Balance: ${fmtCurrency(point.balance)}<br>
      Contributions: ${fmtCurrency(point.contributed)}<br>
      Investment return: ${fmtCurrency(point.interest)}
    `;
  });

  chartCanvas.addEventListener('mouseleave', () => {
    chartTooltip.style.opacity = '0';
  });

  window.addEventListener('resize', () => {
    if (lastChartParams) {
      const { assets, income, expenses, monthlyRate, minAssets, runwayMonths } = lastChartParams;
      drawFreedomChart(assets, income, expenses, monthlyRate, minAssets, runwayMonths);
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

  initTheme();
  render();
})();
