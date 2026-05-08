// Shared helpers for tests. Resets the state singleton (src/state.js) to a
// known blank shape between tests so mutation-style tests don't leak.

import { state } from '../src/main.js';

export function resetState() {
  state.teamA = { name: 'Team A', players: [], score: 0 };
  state.teamB = { name: 'Team B', players: [], score: 0 };
  state.questions = [];
  state.currentQuestion = 0;
  state.hasQuestions = false;
  state.history = [];
  state.answeredQuestions = new Set();
  state.streakGroups = {};
  state.streakScoring = {};
  state.zipPacks = null;
  state.packName = null;
  state.pdfBytes = null;
  state.pdfViewer = { doc: null, currentPage: 1, inlinePage: null };
  state.inlinePdfHidden = false;
  state.jailbreakLocked = { a: [], b: [] };
}

// Build a minimal question object with sensible defaults.
export function makeQ(num, overrides = {}) {
  return {
    num,
    question: `Q${num}?`,
    answer: `A${num}`,
    answerHtml: `A${num}`,
    category: null,
    posInCategory: null,
    categoryInstructions: null,
    streakRange: null,
    pageNum: 1,
    yPos: 700 - num * 5,
    ...overrides,
  };
}
