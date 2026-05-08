// The application's single mutable state object. All other modules import
// from here. Phase 3 will move mutation logic into named reducers in this
// file; for now we just centralize the data shape.

export const state = {
  teamA: { name: 'Team A', players: [], score: 0 },
  teamB: { name: 'Team B', players: [], score: 0 },
  questions: [],
  currentQuestion: 0,
  hasQuestions: false,
  history: [],
  answeredQuestions: new Set(),
  zipPacks: null,
  packName: null,
  pdfBytes: null,
  pdfViewer: { doc: null, currentPage: 1, inlinePage: null },
  inlinePdfHidden: false,
  // Jailbreak lockout state — which player indices on each team have already
  // buzzed in the current jailbreak round. Reset to [] when the team is full
  // (rebuildJailbreakLocks reconstructs this from state.history every render).
  jailbreakLocked: { a: [], b: [] },
};
