// Shows a small "›" hint on horizontally-scrollable tables (stock watch,
// yearly breakdown, future income) whenever there's more content off to the
// right, and fades it out once scrolled to the end. Only appears at all if
// the table actually overflows its container, so it's invisible on desktop.
(() => {
  'use strict';

  function attach(wrap) {
    if (wrap.dataset.scrollHintInit) return;
    wrap.dataset.scrollHintInit = 'true';

    const hint = document.createElement('span');
    hint.className = 'scroll-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = '›';
    wrap.appendChild(hint);

    function update() {
      const isScrollable = wrap.scrollWidth > wrap.clientWidth + 1;
      const atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 4;
      hint.classList.toggle('is-hidden', !isScrollable || atEnd);
    }

    wrap.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    // Table contents are often populated after page load (fetched data,
    // calculator results), which changes whether the table overflows —
    // ResizeObserver catches that without needing to coordinate with
    // whichever page script renders the rows.
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(update);
      observer.observe(wrap);
      const inner = wrap.querySelector('table, .ledger-row');
      if (inner) observer.observe(inner);
    }

    update();
  }

  function init() {
    document.querySelectorAll('.table-wrap, .ledger-table-scroll').forEach(attach);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
