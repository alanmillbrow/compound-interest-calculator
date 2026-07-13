(() => {
  'use strict';

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);

  const principalInput = $('principal');
  const principalRange = $('principalRange');
  const contributionInput = $('contribution');
  const contributionRange = $('contributionRange');
  const rateInput = $('rate');
  const rateRange = $('rateRange');
  const yearsInput = $('years');
  const yearsRange = $('yearsRange');
  const frequencySelect = $('frequency');
  const segButtons = document.querySelectorAll('.contribution-timing .seg-btn');
  const currencyButtons = document.querySelectorAll('.currency-segmented .seg-btn');
  const principalSymbolEl = $('principalSymbol');
  const contributionSymbolEl = $('contributionSymbol');

  const futureValueEl = $('futureValue');
  const totalContribEl = $('totalContrib');
  const totalInterestEl = $('totalInterest');
  const growthMultipleEl = $('growthMultiple');

  const incomeEls = {
    3: { annual: $('income3Annual'), monthly: $('income3Monthly') },
    4: { annual: $('income4Annual'), monthly: $('income4Monthly') },
    5: { annual: $('income5Annual'), monthly: $('income5Monthly') },
  };

  const canvas = $('chart');
  const ctx = canvas.getContext('2d');
  const tooltip = $('tooltip');

  const toggleTableBtn = $('toggleTable');
  const tableWrap = $('tableWrap');
  const tableBody = $('tableBody');

  const themeToggle = $('themeToggle');

  let contributeAtStart = false;
  let yearlyData = [];

  const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€' };
  let currentCurrency = 'GBP';

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
      renderAll();
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
      renderAll();
    });
    updateSliderFill(rangeEl);
  }

  bindTextAndRange(principalInput, principalRange, { isCurrency: true });
  bindTextAndRange(contributionInput, contributionRange, { isCurrency: true });
  bindTextAndRange(rateInput, rateRange, {});
  bindTextAndRange(yearsInput, yearsRange, { isInt: true });
  frequencySelect.addEventListener('change', renderAll);

  segButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      segButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      contributeAtStart = btn.dataset.timing === 'begin';
      renderAll();
    });
  });

  currencyButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      currencyButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentCurrency = btn.dataset.currency;
      const symbol = CURRENCY_SYMBOLS[currentCurrency];
      principalSymbolEl.textContent = symbol;
      contributionSymbolEl.textContent = symbol;
      renderAll();
    });
  });

  // ---------- Calculation ----------
  function calculate() {
    const principal = parseNumber(principalInput.value);
    const monthlyContribution = parseNumber(contributionInput.value);
    const annualRate = parseNumber(rateInput.value) / 100;
    const years = Math.max(1, Math.round(parseNumber(yearsInput.value)));
    const n = parseFloat(frequencySelect.value); // compounding periods per year

    // Effective monthly growth factor implied by the chosen compounding frequency.
    const monthlyFactor = annualRate === 0 ? 1 : Math.pow(1 + annualRate / n, n / 12);

    let balance = principal;
    let contributed = principal;
    const months = years * 12;

    const results = [];

    for (let m = 1; m <= months; m++) {
      if (contributeAtStart) {
        balance += monthlyContribution;
        balance *= monthlyFactor;
      } else {
        balance *= monthlyFactor;
        balance += monthlyContribution;
      }
      if (m > 0) contributed += monthlyContribution;

      if (m % 12 === 0) {
        const year = m / 12;
        results.push({
          year,
          contributed,
          balance,
          interest: balance - contributed,
        });
      }
    }

    return {
      principal,
      monthlyContribution,
      finalBalance: balance,
      totalContributed: contributed,
      totalInterest: balance - contributed,
      yearly: results,
    };
  }

  // ---------- Rendering ----------
  let lastFutureValue = null;
  let countUpFrame = null;

  function animateFutureValue(target) {
    const start = lastFutureValue === null ? target : lastFutureValue;
    lastFutureValue = target;
    if (countUpFrame) cancelAnimationFrame(countUpFrame);

    const duration = 350;
    const t0 = performance.now();

    function tick(now) {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const current = start + (target - start) * eased;
      futureValueEl.textContent = fmtCurrency(current);
      if (p < 1) countUpFrame = requestAnimationFrame(tick);
    }
    countUpFrame = requestAnimationFrame(tick);
  }

  function renderAll() {
    const data = calculate();
    yearlyData = data.yearly;

    animateFutureValue(data.finalBalance);
    totalContribEl.textContent = fmtCurrency(data.totalContributed);
    totalInterestEl.textContent = fmtCurrency(data.totalInterest);
    const multiple = data.totalContributed > 0 ? data.finalBalance / data.totalContributed : 0;
    growthMultipleEl.textContent = multiple.toFixed(2) + 'x';

    for (const rate of [3, 4, 5]) {
      const annual = data.finalBalance * (rate / 100);
      incomeEls[rate].annual.textContent = fmtCurrency(annual);
      incomeEls[rate].monthly.textContent = fmtCurrency(annual / 12);
    }

    drawChart(yearlyData, data.principal);
    renderTable(yearlyData, data.principal);
  }

  function renderTable(yearly, principal) {
    tableBody.innerHTML = '';
    const rows = [{ year: 0, contributed: principal, interest: 0, balance: principal }, ...yearly];
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.year}</td>
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

  // ---------- Chart (canvas, no dependencies) ----------
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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

  function drawChart(yearly, principal) {
    const { width, height } = setupCanvasSize();
    ctx.clearRect(0, 0, width, height);

    if (!yearly.length) return;

    const padding = { top: 16, right: 24, bottom: 28, left: 64 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const points = [{ year: 0, contributed: principal, interest: 0, balance: principal }, ...yearly];
    const maxBalance = Math.max(...points.map((p) => p.balance));
    const maxYear = points[points.length - 1].year;

    const xForYear = (y) => padding.left + (y / maxYear) * plotW;
    const yForVal = (v) => padding.top + plotH - (v / maxBalance) * plotH;

    const contribColor = cssVar('--contrib');
    const interestColor = cssVar('--interest');
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

    // Stacked area: contributions (bottom) + interest (top)
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

    lastChartGeometry = { padding, plotW, plotH, maxYear, maxBalance, points, xForYear, yForVal, width, height };
  }

  function compactCurrency(v) {
    const symbol = CURRENCY_SYMBOLS[currentCurrency];
    if (v >= 1_000_000) return symbol + (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1_000) return symbol + (v / 1_000).toFixed(0) + 'K';
    return symbol + Math.round(v);
  }

  function hexToRgba(color, alpha) {
    // supports hex colors; falls back to color-mix for named/other formats
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

  canvas.addEventListener('mousemove', (e) => {
    if (!lastChartGeometry) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { points, maxYear, padding, plotW } = lastChartGeometry;
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
      Investment return: ${fmtCurrency(point.interest)}
    `;
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
  });

  window.addEventListener('resize', () => {
    if (yearlyData) drawChart(yearlyData, parseNumber(principalInput.value));
  });

  // ---------- Theme ----------
  function initTheme() {
    const saved = localStorage.getItem('cic-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  }

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('cic-theme', next);
    renderAll();
  });

  // ---------- Init ----------
  initTheme();
  renderAll();
})();
