// Global keyboard shortcuts (active only when the game screen is visible
// and no input/textarea/select has focus).
//
// - Number keys (1-9, 0): assign points to that player. 0 also acts as
//   "skip to next question" when no player is in slot 9.
// - Arrow Left / Right: prev / next question.
// - Ctrl+Z: undo last scoring action.
// - C: clear the current question's points.
//
// PDF overlay short-circuits this — its own listener (in ui/pdf-viewer.js)
// owns Esc / arrows while the overlay is open.

import { state, addPoints, undoLast, clearCurrentQuestion } from '../state.js';
import { isGameVisible } from '../game/persistence.js';

export function setupKeybinds({ nextQuestion, prevQuestion }) {
  // Window-level capture-phase logger for debugging stuck keys. Toggle on
  // with `window.DEBUG_KEYS = true` from devtools.
  window.addEventListener('keydown', (e) => {
    if (window.DEBUG_KEYS) {
      console.log('[window-capture keydown]', { key: e.key, code: e.code, which: e.which, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, target: e.target && (e.target.tagName + (e.target.id ? '#' + e.target.id : '') + (e.target.className ? '.' + String(e.target.className).split(' ').join('.') : '')) });
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (window.DEBUG_KEYS) {
      console.log('[document keydown]', { key: e.key, code: e.code, repeat: e.repeat, gameVisible: isGameVisible(), targetTag: e.target && e.target.tagName, currentQ: state.currentQuestion, players: state.teamA.players.length + state.teamB.players.length });
    }
    if (e.repeat) return;
    const pdfOverlay = document.getElementById('pdf-overlay');
    if (pdfOverlay && pdfOverlay.classList.contains('open')) { if (window.DEBUG_KEYS) console.log('[keydown] return: pdf overlay open'); return; }
    if (!isGameVisible()) { if (window.DEBUG_KEYS) console.log('[keydown] return: game not visible'); return; }
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { if (window.DEBUG_KEYS) console.log('[keydown] return: focused on', tag); return; }

    if (e.key === 'ArrowRight') { e.preventDefault(); nextQuestion(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prevQuestion(); return; }
    if (e.key === 'z' && e.ctrlKey) { e.preventDefault(); undoLast(); return; }
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      clearCurrentQuestion();
      return;
    }

    if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const allPlayers = [...state.teamA.players, ...state.teamB.players];
      const keyNum = parseInt(e.key, 10);
      if (keyNum === 0 && !e.shiftKey) {
        e.preventDefault();
        nextQuestion();
        return;
      }
      const playerIdx = keyNum === 0 ? 9 : keyNum - 1;
      if (window.DEBUG_KEYS) console.log('[keydown] playerIdx=', playerIdx, 'allPlayers=', allPlayers.length);
      if (playerIdx < allPlayers.length) {
        e.preventDefault();
        const currentQ = state.questions[state.currentQuestion];
        // Streaks: only +5. Non-streaks: only +10. Shift modifier no longer toggles.
        const points = (currentQ && currentQ.isStreak) ? 5 : 10;
        if (window.DEBUG_KEYS) console.log('[keydown] addPoints', { team: playerIdx < state.teamA.players.length ? 'a' : 'b', playerIdx, points, currentQ: currentQ ? { num: currentQ.num, isStreak: currentQ.isStreak, isMissing: currentQ.isMissing } : null });
        if (playerIdx < state.teamA.players.length) {
          addPoints('a', playerIdx, points);
        } else {
          addPoints('b', playerIdx - state.teamA.players.length, points);
        }
      }
    }
  });
}
