// Generic delegated HTML5 drag-and-drop for reordering items inside a stable
// container. The container's children are usually re-rendered (innerHTML) on
// every state change, so we bind once on the container and look up the
// dragged/target items by data-* attributes at event time.
//
// Items must declare:
//   draggable="true"
//   data-team="a"|"b"   ← cross-team drags are rejected
//   data-index="N"      ← position in the players array
//
// Drop indicator: the target row gets .drag-target-before or .drag-target-after
// depending on which half the cursor is in, so CSS can render a colored line
// above or below the row. The source row gets .drag-source while a drag is in
// flight. All classes are cleaned up on dragend / drop.
//
// onReorder({ team, fromIndex, toIndex }) is called after the reducer has
// mutated state — useful for callers (setup.js) whose render isn't a state
// subscriber and needs to be poked manually.

import { reorderPlayer } from '../state.js';

const VISUAL_CLASSES = ['drag-source', 'drag-target-before', 'drag-target-after'];

function clearVisuals(container) {
  for (const cls of VISUAL_CLASSES) {
    for (const el of container.querySelectorAll('.' + cls)) {
      el.classList.remove(cls);
    }
  }
}

export function attachDragReorder(container, { itemSelector, onReorder } = {}) {
  if (!container || !itemSelector) return;
  let dragFrom = null;

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    // Don't initiate drag if the user mousedowned on an interactive child
    // that explicitly opts out (the score / remove buttons set draggable="false").
    if (e.target.closest('[draggable="false"]')) {
      e.preventDefault();
      return;
    }
    dragFrom = { team: item.dataset.team, index: parseInt(item.dataset.index, 10) };
    item.classList.add('drag-source');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(dragFrom.index)); } catch { /* some browsers throw on non-string */ }
    }
  });

  container.addEventListener('dragover', (e) => {
    if (!dragFrom) return;
    const item = e.target.closest(itemSelector);
    if (!item || item.dataset.team !== dragFrom.team) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = item.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    // Clear previous indicator before applying the new one.
    for (const cls of ['drag-target-before', 'drag-target-after']) {
      for (const el of container.querySelectorAll('.' + cls)) el.classList.remove(cls);
    }
    item.classList.add(before ? 'drag-target-before' : 'drag-target-after');
  });

  container.addEventListener('drop', (e) => {
    if (!dragFrom) return;
    const item = e.target.closest(itemSelector);
    if (!item || item.dataset.team !== dragFrom.team) { clearVisuals(container); dragFrom = null; return; }
    e.preventDefault();
    const overIdx = parseInt(item.dataset.index, 10);
    const rect = item.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    // "before overIdx" inserts at overIdx; "after overIdx" inserts at overIdx+1.
    // Then compensate for the fact that removing fromIndex shifts everything
    // after it down by one before the insert.
    let toIndex = before ? overIdx : overIdx + 1;
    if (dragFrom.index < toIndex) toIndex -= 1;
    const { team, index: fromIndex } = dragFrom;
    clearVisuals(container);
    dragFrom = null;
    if (toIndex === fromIndex) return;
    reorderPlayer(team, fromIndex, toIndex);
    if (onReorder) onReorder({ team, fromIndex, toIndex });
  });

  container.addEventListener('dragend', () => {
    clearVisuals(container);
    dragFrom = null;
  });

  // When the cursor leaves the container entirely, drop the target highlight.
  container.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && container.contains(e.relatedTarget)) return;
    for (const cls of ['drag-target-before', 'drag-target-after']) {
      for (const el of container.querySelectorAll('.' + cls)) el.classList.remove(cls);
    }
  });
}
