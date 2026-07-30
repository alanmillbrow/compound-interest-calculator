(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const themeToggle = $('themeToggle');

  const effortInput = $('effortIncome');
  const effortRange = $('effortIncomeRange');
  const leveragedInput = $('leveragedIncome');
  const leveragedRange = $('leveragedIncomeRange');
  const passiveInput = $('passiveIncome');
  const passiveRange = $('passiveIncomeRange');
  const lifestyleInput = $('lifestyleExpenses');
  const lifestyleRange = $('lifestyleExpensesRange');
  const personalInput = $('personalInvestment');
  const personalRange = $('personalInvestmentRange');

  const effortSymbol = $('effortIncomeSymbol');
  const leveragedSymbol = $('leveragedIncomeSymbol');
  const passiveSymbol = $('passiveIncomeSymbol');
  const lifestyleSymbol = $('lifestyleExpensesSymbol');
  const personalSymbol = $('personalInvestmentSymbol');
  const engineSymbol = $('engineSymbol');

  const currencyButtons = document.querySelectorAll('.currency-segmented .seg-btn');
  const engineValueEl = $('engineValue');
  const warningEl = $('sankeyWarning');
  const svg = $('sankeySvg');

  const copyLinkBtn = $('copyLinkBtn');
  const shareLinkBtn = $('shareLinkBtn');
  const bookmarkBtn = $('bookmarkBtn');
  const shareStatus = $('shareStatus');

  const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€' };
  let currentCurrency = 'GBP';

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

  function bindTextAndRange(textEl, rangeEl) {
    function clamp(val) {
      if (val < parseFloat(rangeEl.min)) val = parseFloat(rangeEl.min);
      if (val > parseFloat(rangeEl.max)) val = parseFloat(rangeEl.max);
      return val;
    }
    textEl.addEventListener('input', () => {
      const val = clamp(parseNumber(textEl.value));
      rangeEl.value = val;
      updateSliderFill(rangeEl);
      render();
    });
    textEl.addEventListener('blur', () => {
      const val = clamp(parseNumber(textEl.value));
      textEl.value = fmtNumber(val);
      rangeEl.value = val;
      updateSliderFill(rangeEl);
      render();
    });
    rangeEl.addEventListener('input', () => {
      const val = parseFloat(rangeEl.value);
      textEl.value = fmtNumber(val);
      updateSliderFill(rangeEl);
      render();
    });
    updateSliderFill(rangeEl);
  }

  bindTextAndRange(effortInput, effortRange);
  bindTextAndRange(leveragedInput, leveragedRange);
  bindTextAndRange(passiveInput, passiveRange);
  bindTextAndRange(lifestyleInput, lifestyleRange);
  bindTextAndRange(personalInput, personalRange);

  currencyButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      currencyButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentCurrency = btn.dataset.currency;
      const s = CURRENCY_SYMBOLS[currentCurrency];
      effortSymbol.textContent = s;
      leveragedSymbol.textContent = s;
      passiveSymbol.textContent = s;
      lifestyleSymbol.textContent = s;
      personalSymbol.textContent = s;
      engineSymbol.textContent = s;
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
      const s = CURRENCY_SYMBOLS[currentCurrency];
      effortSymbol.textContent = s;
      leveragedSymbol.textContent = s;
      passiveSymbol.textContent = s;
      lifestyleSymbol.textContent = s;
      personalSymbol.textContent = s;
      engineSymbol.textContent = s;
    }

    function setField(param, textEl, rangeEl) {
      if (!params.has(param)) return;
      let val = parseNumber(params.get(param));
      if (val < parseFloat(rangeEl.min)) val = parseFloat(rangeEl.min);
      if (val > parseFloat(rangeEl.max)) val = parseFloat(rangeEl.max);
      rangeEl.value = val;
      textEl.value = fmtNumber(val);
      updateSliderFill(rangeEl);
    }

    setField('effort', effortInput, effortRange);
    setField('leveraged', leveragedInput, leveragedRange);
    setField('passive', passiveInput, passiveRange);
    setField('lifestyle', lifestyleInput, lifestyleRange);
    setField('personal', personalInput, personalRange);
  }

  function currentParams() {
    const params = new URLSearchParams();
    params.set('effort', Math.round(parseNumber(effortInput.value)));
    params.set('leveraged', Math.round(parseNumber(leveragedInput.value)));
    params.set('passive', Math.round(parseNumber(passiveInput.value)));
    params.set('lifestyle', Math.round(parseNumber(lifestyleInput.value)));
    params.set('personal', Math.round(parseNumber(personalInput.value)));
    params.set('currency', currentCurrency);
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
  // state, the eventual call always flushes the current value.
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

  // ---------- Sankey (hand-built SVG, no dependencies) ----------

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

  const VB_W = 800;
  const VB_H = 460;
  const NODE_W = 16;
  // Wide margins either side so the node name/value labels — the longest is
  // "Personal Development" — have room to render fully inside the viewBox
  // rather than spilling past its edges
  const LEFT_X = 190;
  const RIGHT_X = VB_W - 190 - NODE_W;
  const PLOT_TOP = 56;
  const PLOT_BOTTOM = VB_H - 24;
  const NODE_GAP = 20;
  const RIBBON_X_START = LEFT_X + NODE_W;
  const RIBBON_X_END = RIGHT_X;
  const RIBBON_X_MID = (RIBBON_X_START + RIBBON_X_END) / 2;

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const key in attrs) el.setAttribute(key, attrs[key]);
    return el;
  }

  // Stacks a column of nodes proportional to their values within the
  // available plot height (minus fixed gaps between them), returning the
  // pixel [top, bottom] span for each — used for both the left (income)
  // and right (outgoings) columns, whose totals can legitimately differ
  // (e.g. when outgoings exceed income) so each column scales against its
  // own reference total, not a shared one
  function layoutColumn(values, referenceTotal, availableH) {
    const n = values.length;
    const gapTotal = NODE_GAP * (n - 1);
    const usableH = Math.max(0, availableH - gapTotal);
    let y = PLOT_TOP;
    return values.map((v) => {
      const h = referenceTotal > 0 ? (v / referenceTotal) * usableH : 0;
      const span = { top: y, bottom: y + h, height: h };
      y += h + NODE_GAP;
      return span;
    });
  }

  function ribbonPath(y0top, y0bot, y1top, y1bot) {
    return `M ${RIBBON_X_START} ${y0top} `
      + `C ${RIBBON_X_MID} ${y0top} ${RIBBON_X_MID} ${y1top} ${RIBBON_X_END} ${y1top} `
      + `L ${RIBBON_X_END} ${y1bot} `
      + `C ${RIBBON_X_MID} ${y1bot} ${RIBBON_X_MID} ${y0bot} ${RIBBON_X_START} ${y0bot} Z`;
  }

  function drawSankey(values) {
    const { effort, leveraged, passive, lifestyle, personal, engine, totalIncome } = values;

    const inputs = [
      { key: 'effort', name: 'Effort Income', value: effort, color: cssVar('--text-primary') },
      { key: 'leveraged', name: 'Leveraged Income', value: leveraged, color: cssVar('--accent-3') },
      { key: 'passive', name: 'Passive Income', value: passive, color: cssVar('--interest') },
    ];
    const outputs = [
      { key: 'lifestyle', name: 'Lifestyle Expenses', value: lifestyle, color: cssVar('--text-primary') },
      { key: 'personal', name: 'Personal Development', value: personal, color: cssVar('--accent-3') },
      { key: 'engine', name: 'Investment Engine', value: engine, color: cssVar('--interest'), hero: true },
    ];

    const availableH = PLOT_BOTTOM - PLOT_TOP;
    const leftSpans = layoutColumn(inputs.map((d) => d.value), totalIncome, availableH);
    const rightSpans = layoutColumn(outputs.map((d) => d.value), totalIncome, availableH);

    svg.innerHTML = '';
    const ribbonLayer = svgEl('g', { class: 'sankey-ribbons' });
    const nodeLayer = svgEl('g', { class: 'sankey-nodes' });
    const labelLayer = svgEl('g', { class: 'sankey-labels' });
    svg.appendChild(ribbonLayer);
    svg.appendChild(nodeLayer);
    svg.appendChild(labelLayer);

    // Column captions
    labelLayer.appendChild(svgEl('text', { x: LEFT_X, y: PLOT_TOP - 26, class: 'sankey-col-caption' }));
    labelLayer.lastChild.textContent = 'INCOME';
    labelLayer.appendChild(svgEl('text', { x: RIGHT_X + NODE_W, y: PLOT_TOP - 26, class: 'sankey-col-caption', 'text-anchor': 'end' }));
    labelLayer.lastChild.textContent = 'OUTGOINGS';

    // Ribbons: flow(i,j) = input_i * output_j / totalIncome, so each ribbon
    // set sums back exactly to its source node's height on the left and its
    // destination node's height on the right — the diagram is always balanced
    if (totalIncome > 0) {
      const rightCursors = rightSpans.map((s) => s.top);
      inputs.forEach((input, i) => {
        let leftCursor = leftSpans[i].top;
        outputs.forEach((output, j) => {
          const flow = (input.value * output.value) / totalIncome;
          if (flow <= 0) return;
          const leftH = (flow / input.value) * (leftSpans[i].height || 0);
          const rightH = (flow / output.value) * (rightSpans[j].height || 0);
          const y0top = leftCursor;
          const y0bot = leftCursor + leftH;
          const y1top = rightCursors[j];
          const y1bot = rightCursors[j] + rightH;
          leftCursor = y0bot;
          rightCursors[j] = y1bot;

          const path = svgEl('path', {
            d: ribbonPath(y0top, y0bot, y1top, y1bot),
            fill: hexToRgba(input.color, output.hero ? 0.58 : 0.26),
            class: 'sankey-ribbon',
          });
          ribbonLayer.appendChild(path);
        });
      });
    }

    // Nodes + labels — a node with a value of exactly 0 (e.g. a slider
    // dragged all the way down) is skipped entirely, rect and labels alike,
    // rather than leaving a zero-height sliver with orphaned text next to it
    function drawColumn(defs, spans, side) {
      defs.forEach((d, i) => {
        if (d.value <= 0) return;
        const span = spans[i];
        const x = side === 'left' ? LEFT_X : RIGHT_X;

        // A soft glow behind the Investment Engine node marks it as the
        // destination the whole diagram is building towards
        if (d.hero) {
          nodeLayer.appendChild(svgEl('rect', {
            x: x - 10, y: span.top - 10, width: NODE_W + 20, height: span.height + 20,
            class: 'sankey-hero-glow',
          }));
        }
        const rect = svgEl('rect', {
          x, y: span.top, width: NODE_W, height: span.height,
          fill: d.color,
          class: d.hero ? 'sankey-node sankey-node-hero' : 'sankey-node',
        });
        nodeLayer.appendChild(rect);

        const midY = (span.top + span.bottom) / 2;
        const labelX = side === 'left' ? LEFT_X - 12 : RIGHT_X + NODE_W + 12;
        const anchor = side === 'left' ? 'end' : 'start';

        const nameEl = svgEl('text', {
          x: labelX, y: midY - 6, 'text-anchor': anchor, class: 'sankey-node-name',
        });
        nameEl.textContent = d.name;
        labelLayer.appendChild(nameEl);

        const valueEl = svgEl('text', {
          x: labelX, y: midY + 14, 'text-anchor': anchor,
          class: d.hero ? 'sankey-node-value sankey-node-value-hero' : 'sankey-node-value',
        });
        valueEl.textContent = fmtCurrency(d.value);
        labelLayer.appendChild(valueEl);
      });
    }

    drawColumn(inputs, leftSpans, 'left');
    drawColumn(outputs, rightSpans, 'right');
  }

  function render() {
    const effort = parseNumber(effortInput.value);
    const leveraged = parseNumber(leveragedInput.value);
    const passive = parseNumber(passiveInput.value);
    const lifestyle = parseNumber(lifestyleInput.value);
    const personal = parseNumber(personalInput.value);

    const totalIncome = effort + leveraged + passive;
    const rawEngine = totalIncome - lifestyle - personal;
    const deficit = rawEngine < 0 ? -rawEngine : 0;
    const engine = Math.max(0, rawEngine);

    // The diagram always needs outgoings to sum exactly to income to stay
    // balanced. When outgoings overshoot, scale lifestyle/personal down
    // proportionally for drawing purposes only — the real (over-budget)
    // figures still show in the sliders and the warning message
    let diagLifestyle = lifestyle;
    let diagPersonal = personal;
    let diagEngine = engine;
    if (deficit > 0 && lifestyle + personal > 0) {
      const scale = totalIncome / (lifestyle + personal);
      diagLifestyle = lifestyle * scale;
      diagPersonal = personal * scale;
      diagEngine = 0;
    }

    engineValueEl.value = fmtNumber(engine);
    warningEl.textContent = deficit > 0
      ? `Your outgoings are ${fmtCurrency(deficit)} more than your income this month`
      : '';
    warningEl.classList.toggle('is-visible', deficit > 0);

    drawSankey({
      effort, leveraged, passive,
      lifestyle: diagLifestyle, personal: diagPersonal, engine: diagEngine,
      totalIncome,
    });
    scheduleUrlUpdate();
  }

  window.addEventListener('resize', render);

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
