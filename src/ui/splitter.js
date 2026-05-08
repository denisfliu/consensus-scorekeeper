// Drag-resize splitters. Each splitter element is a thin strip (transparent
// hit area + a 2px line rendered via ::before) that the user can drag to
// resize an adjacent panel.

export function attachSplitter(splitter, target, axis, opts) {
  if (!splitter || !target) return;
  const sign = (opts && opts.sign) || 1;
  const min = (opts && opts.min) || 50;
  const getMax = () => (opts && typeof opts.max === 'function') ? opts.max() : ((opts && opts.max) || Infinity);
  let dragging = null;
  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const coord = axis === 'x' ? e.clientX : e.clientY;
    const delta = (coord - dragging.startCoord) * sign;
    const newSize = Math.max(min, Math.min(getMax(), dragging.startSize + delta));
    target.style[axis === 'x' ? 'width' : 'height'] = newSize + 'px';
  }
  function onUp() {
    dragging = null;
    splitter.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = target.getBoundingClientRect();
    dragging = {
      startSize: axis === 'x' ? rect.width : rect.height,
      startCoord: axis === 'x' ? e.clientX : e.clientY,
    };
    splitter.classList.add('dragging');
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// Wire up the three splitters that exist in the page (sidebar, scoreboard,
// question/pdf row). Idempotent-safe: attachSplitter no-ops on missing
// elements, so calling this in tests where the DOM is partial is fine.
export function setupSplitters() {
  // Sidebar (right column): drag left = wider, drag right = narrower → sign -1.
  attachSplitter(
    document.getElementById('splitter-sidebar'),
    document.querySelector('.question-sidebar'),
    'x',
    { min: 120, max: 400, sign: -1 },
  );
  // Scoreboard: drag down = taller. Custom-award dropdown still works because
  // .scoreboard has no overflow:hidden — its absolute-positioned panel escapes.
  attachSplitter(
    document.getElementById('splitter-scoreboard'),
    document.querySelector('.scoreboard'),
    'y',
    { min: 60, max: 240 },
  );
  // Question/PDF row: drag down = row taller, panels shrink (panels are flex:1).
  attachSplitter(
    document.getElementById('splitter-row'),
    document.querySelector('.question-content-row'),
    'y',
    { min: 160, max: () => Math.max(200, window.innerHeight * 0.8) },
  );
}
