// ==================== STATE ====================
import {
  state,
  subscribe,
  addPoints,
  clearPlayerPoints,
  clearCurrentQuestion,
  resetStreak,
  applyCustomAward as applyCustomAwardReducer,
  undoLast,
} from './state.js';
import { rebuildJailbreakLocks } from './game/jailbreak.js';
import { rebuildStreakGroups } from './game/streaks.js';
import { getInitials, getAnsweredBy, getSplitPair, getCategoryRunSize } from './game/categories.js';
import { STORAGE_KEY, PDF_STORAGE_KEY, isGameVisible, saveState, savePdfBytes, loadPdfBytes, clearSavedState } from './game/persistence.js';

// renderGame is wired as the single state-change subscriber inside
// setupGameScreen() — see ui/game.js.

// ==================== SETUP ====================
import { addPlayer, removePlayer, renderRoster, setupSetupScreen } from './ui/setup.js';
setupSetupScreen();

// ==================== PDF PARSING ====================
import { parsePdf, processZipBuffer, handleZipUpload } from './loader.js';
import { readZip, looksLikePdfOrZip } from './parser/zip.js';
import { extractRichLinesFromPdf } from './parser/pdf-text.js';
import { SECTION_WORDS, STRUCTURAL_RE, cleanTrailing, extractRichRange, richToHtml, parseQuestions } from './parser/questions.js';

document.getElementById('pdf-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.name.endsWith('.zip')) {
    await handleZipUpload(file);
  } else {
    await parsePdf(await file.arrayBuffer(), file.name);
  }
});

import {
  padQuestionsToSlots,
  startGame,
  backToSetup,
  renderGame,
  renderQuestion,
  nextQuestion,
  prevQuestion,
  skipQuestion,
  goToQuestion,
  renderPlayerPanel,
  setupGameScreen,
} from './ui/game.js';
setupGameScreen();

// ==================== DEV TOOLS ====================
import { applyCustomAward, populateCustomAward, setupDevTools, reparseCurrentPdf as reparsePdfImpl } from './ui/dev-tools.js';
setupDevTools();
const reparseCurrentPdf = () => reparsePdfImpl({ padQuestionsToSlots, renderGame });


// ==================== KEYBINDS ====================
import { setupKeybinds } from './ui/keybinds.js';
setupKeybinds({ nextQuestion: () => nextQuestion(), prevQuestion: () => prevQuestion() });

// ==================== PERSISTENCE ====================




function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    Object.assign(state.teamA, snap.teamA || {});
    Object.assign(state.teamB, snap.teamB || {});
    state.questions = snap.questions || [];
    state.currentQuestion = snap.currentQuestion || 0;
    state.hasQuestions = !!snap.hasQuestions;
    state.history = snap.history || [];
    state.answeredQuestions = new Set(snap.answeredQuestions || []);
    // Migrate v1 streakScoring (single scorer per streak: { team, playerIndex, globalPlayerIdx, totalPoints })
    // to v2 (per-team buckets: { a?: {playerIndex, totalPoints}, b?: ... }).
    const ss = snap.streakScoring || {};
    for (const k of Object.keys(ss)) {
      const v = ss[k];
      if (v && typeof v === 'object' && 'team' in v && 'totalPoints' in v) {
        ss[k] = { [v.team]: { playerIndex: v.playerIndex, totalPoints: v.totalPoints } };
      }
    }
    state.streakScoring = ss;
    state.packName = snap.packName || null;
    state.inlinePdfHidden = !!snap.inlinePdfHidden;
    rebuildStreakGroups();

    const pdfBytes = loadPdfBytes();
    if (pdfBytes) state.pdfBytes = pdfBytes;

    // Restore setup UI fields regardless of game state
    document.getElementById('team-a-name').value = state.teamA.name || 'Team A';
    document.getElementById('team-b-name').value = state.teamB.name || 'Team B';
    renderRoster('a');
    renderRoster('b');
    if (state.packName) {
      const statusEl = document.getElementById('pdf-status');
      statusEl.textContent = `Restored "${state.packName}" from previous session.`;
      statusEl.className = 'pdf-status success';
    }

    if (snap.gameActive) {
      document.getElementById('setup').style.display = 'none';
      document.getElementById('game').style.display = 'block';
      renderGame();
    }
    return true;
  } catch (e) {
    console.warn('[persist] loadState failed:', e);
    return false;
  }
}


// ==================== UTILS ====================
import { escapeHtml, csvEscape } from './util/escape.js';
import { buildResultsCsv, buildResultsFilename } from './util/csv.js';

function exportCsv() {
  const csv = buildResultsCsv(state);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = buildResultsFilename(state);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.addPlayer = addPlayer;
window.removePlayer = removePlayer;
window.startGame = startGame;
window.backToSetup = backToSetup;
window.addPoints = addPoints;
window.undoLast = undoLast;
window.nextQuestion = nextQuestion;
window.prevQuestion = prevQuestion;
window.skipQuestion = skipQuestion;
window.goToQuestion = goToQuestion;
window.resetStreak = resetStreak;
window.clearPlayerPoints = clearPlayerPoints;
window.clearCurrentQuestion = clearCurrentQuestion;
window.exportCsv = exportCsv;
window.viewPdf = viewPdf;
window.closePdfViewer = closePdfViewer;
window.toggleInlinePdf = toggleInlinePdf;
window.reparseCurrentPdf = reparseCurrentPdf;
window.applyCustomAward = applyCustomAward;
window.popOutScoreboard = popOutScoreboard;

// ==================== DRAG-RESIZE SPLITTERS ====================
import { setupSplitters } from './ui/splitter.js';
setupSplitters();
window.clearAndReload = () => {
  if (!confirm('Clear all saved progress and reload?')) return;
  clearSavedState();
  location.reload();
};
// ==================== PDF VIEWER ====================
import {
  viewPdf,
  renderPdfPage,
  closePdfViewer,
  renderInlinePdf,
  syncInlinePdfToQuestion,
  updateInlinePdfButton,
  toggleInlinePdf,
  pdfPagePrev,
  pdfPageNext,
  inlinePdfPrev,
  inlinePdfNext,
  setupPdfViewer,
} from './ui/pdf-viewer.js';
setupPdfViewer();

// Re-export to window so inline onclick="..." handlers in index.html still work
// (Phase 4 cleanup will replace those with addEventListener and these go away).
window.pdfPagePrev = pdfPagePrev;
window.pdfPageNext = pdfPageNext;
window.inlinePdfPrev = inlinePdfPrev;
window.inlinePdfNext = inlinePdfNext;

// ==================== SCOREBOARD POPOUT ====================
import { pushScoreboardUpdate, popOutScoreboard } from './ui/scoreboard-popout.js';

import { setupPackBrowser } from './ui/pack-browser.js';
setupPackBrowser();

// Restore previous session if any. Runs at the end so all functions and DOM
// elements are available.
loadState();

// ==================== ES MODULE EXPORTS (for tests) ====================
// Phase 1: tests import these to lock current behavior. Subsequent phases
// will move these into per-domain modules; tests will update import paths.
export {
  state,
  // pure
  cleanTrailing,
  extractRichRange,
  richToHtml,
  parseQuestions,
  escapeHtml,
  csvEscape,
  getInitials,
  // game logic
  getSplitPair,
  getCategoryRunSize,
  getAnsweredBy,
  rebuildStreakGroups,
  padQuestionsToSlots,
  rebuildJailbreakLocks,
  // zip / pdf
  readZip,
  looksLikePdfOrZip,
  // state mutations
  addPoints,
  undoLast,
  clearPlayerPoints,
  clearCurrentQuestion,
  resetStreak,
  applyCustomAward,
  // persistence
  saveState,
  loadState,
  savePdfBytes,
  loadPdfBytes,
  clearSavedState,
  // export
  exportCsv,
  // setup / lifecycle
  addPlayer,
  removePlayer,
  startGame,
  backToSetup,
};
