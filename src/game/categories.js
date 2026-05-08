// Pure helpers that read state.questions to derive display info: who answered
// a question, the size of a category run, and the partner of a Splits pair.

import { state } from '../state.js';

export function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

export function getAnsweredBy(questionIdx) {
  const entry = [...state.history].reverse().find(h => h.question === questionIdx && !h.isStreak);
  if (!entry) return null;
  const teamObj = entry.team === 'a' ? state.teamA : state.teamB;
  return {
    name: teamObj.players[entry.playerIndex].name,
    team: teamObj.name,
    teamLetter: entry.team,
    points: entry.points,
    initials: getInitials(teamObj.players[entry.playerIndex].name),
  };
}

// For a "Splits N: <title>" category, find the paired category. In a
// Consensus pack, each splits round has TWO sub-categories played
// back-to-back (e.g., "Splits 1: Gothic Literature" then "Splits 2:
// Mountaineering"). We locate the partner by walking state.questions from
// the current position toward the other half of the pair.
export function getSplitPair(currentIdx, currentCategory) {
  if (!currentCategory) return null;
  const m = currentCategory.match(/^Splits (\d+):\s*/);
  if (!m) return null;
  const curNum = parseInt(m[1], 10);
  const targetPrefix = curNum === 1 ? 'Splits 2:' : 'Splits 1:';
  // Walk forward from current for Splits-2-given-Splits-1, backward for the
  // reverse. Stop on any non-splits category in between (defensive).
  const dir = curNum === 1 ? 1 : -1;
  let i = currentIdx + dir;
  while (i >= 0 && i < state.questions.length) {
    const c = state.questions[i] && state.questions[i].category;
    if (c && c.startsWith(targetPrefix)) return { current: currentCategory, partner: c, currentNum: curNum };
    // Skip same-pair half (current's own category) and missing slots.
    if (c && !c.startsWith('Splits ') && !state.questions[i].isMissing) break;
    i += dir;
  }
  return null;
}

// Counts the size of the contiguous category-instance the current question
// belongs to. Walks forward from currentIdx, accepting questions that share
// the same category AND have posInCategory == expected (currentPos+1, +2, ...).
// Stops as soon as the chain breaks — which correctly distinguishes between
// two separate categories that happen to share the same name (e.g., the pack
// has two unrelated "Set of 4" sections; without this, both would be lumped
// together and a 4-question category would display as 1/8).
export function getCategoryRunSize(currentIdx, category, currentPos) {
  if (!category || !currentPos) return null;
  let total = currentPos;
  let expected = currentPos + 1;
  for (let i = currentIdx + 1; i < state.questions.length; i++) {
    const qq = state.questions[i];
    if (!qq || qq.category !== category || qq.posInCategory !== expected) break;
    total = expected;
    expected++;
  }
  return total;
}
