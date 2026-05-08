// Reconstruct jailbreak per-team lockouts from state.history. Walking
// history in order means that any change (undo, clear, custom award) is
// reflected automatically — we never have to keep two sources of truth in
// sync. A team's lock resets the moment every player on it has buzzed.

import { state } from '../state.js';

export function rebuildJailbreakLocks() {
  state.jailbreakLocked = { a: [], b: [] };
  for (const h of state.history) {
    if (h.isStreak) continue;
    const q = state.questions[h.question];
    if (!q || !q.category || !/jailbreak/i.test(q.category)) continue;
    const lock = state.jailbreakLocked[h.team];
    if (!lock.includes(h.playerIndex)) lock.push(h.playerIndex);
    const teamPlayers = h.team === 'a' ? state.teamA.players : state.teamB.players;
    if (teamPlayers.length > 0 && lock.length >= teamPlayers.length) {
      state.jailbreakLocked[h.team] = [];
    }
  }
}
