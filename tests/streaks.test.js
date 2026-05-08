import { describe, it, expect, beforeEach } from 'vitest';
import { state, rebuildStreakGroups } from '../src/legacy.js';
import { resetState, makeQ } from './helpers.js';

beforeEach(resetState);

describe('rebuildStreakGroups', () => {
  it('builds an empty streakGroups object when no streak questions exist', () => {
    state.questions = [makeQ(1), makeQ(2)];
    rebuildStreakGroups();
    expect(state.streakGroups).toEqual({});
  });

  it('builds a group for a streak ranging across multiple questions', () => {
    // streak source is at slot 84 (Q85), runs through slot 88 (Q89)
    state.questions = [];
    for (let n = 1; n <= 100; n++) state.questions.push(makeQ(n));
    state.questions[84] = makeQ(85, {
      category: 'Streak: US Capitals',
      streakRange: { start: 85, end: 89 },
    });
    rebuildStreakGroups();

    const group = state.streakGroups[84];
    expect(group).toBeDefined();
    expect(group.start).toBe(84);
    expect(group.end).toBe(88);
    expect(group.members).toEqual([84, 85, 86, 87, 88]);
    expect(group.category).toBe('Streak: US Capitals');
  });

  it('marks each member question as isStreak with shared streakGroupStart', () => {
    state.questions = [];
    for (let n = 1; n <= 100; n++) state.questions.push(makeQ(n));
    state.questions[84] = makeQ(85, {
      category: 'Streak: US Capitals',
      streakRange: { start: 85, end: 89 },
    });
    rebuildStreakGroups();
    for (let i = 84; i <= 88; i++) {
      expect(state.questions[i].isStreak).toBe(true);
      expect(state.questions[i].streakGroupStart).toBe(84);
    }
    expect(state.questions[83].isStreak).toBeUndefined();
    expect(state.questions[89].isStreak).toBeUndefined();
  });
});
