// Rebuilds state.streakGroups from state.questions. Each question whose
// streakRange is set defines a group whose member slots all share the same
// streakGroupStart and isStreak=true.

import { state } from '../state.js';

export function rebuildStreakGroups() {
  state.streakGroups = {};
  for (const q of state.questions) {
    if (q && q.streakRange) {
      const startIdx = q.streakRange.start - 1;
      const endIdx = q.streakRange.end - 1;
      for (let si = startIdx; si <= endIdx; si++) {
        if (state.questions[si]) {
          state.questions[si].isStreak = true;
          state.questions[si].streakGroupStart = startIdx;
        }
      }
      const members = [];
      for (let si = startIdx; si <= endIdx; si++) members.push(si);
      state.streakGroups[startIdx] = { start: startIdx, end: endIdx, members, category: q.category, sourceQuestion: q };
    }
  }
}
