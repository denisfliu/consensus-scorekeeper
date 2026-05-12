import { describe, it, expect, beforeEach } from 'vitest';
import { state, addPoints, reorderPlayer, undoLast } from '../src/main.js';
import { resetState, makeQ } from './helpers.js';

beforeEach(() => {
  resetState();
  state.teamA = {
    name: 'Alphas',
    players: [
      { name: 'A0', points: 0 },
      { name: 'A1', points: 0 },
      { name: 'A2', points: 0 },
      { name: 'A3', points: 0 },
      { name: 'A4', points: 0 },
    ],
    score: 0,
  };
  state.teamB = {
    name: 'Bravos',
    players: [
      { name: 'B0', points: 0 },
      { name: 'B1', points: 0 },
    ],
    score: 0,
  };
  state.questions = [makeQ(1), makeQ(2), makeQ(3), makeQ(4)];
  state.hasQuestions = true;
});

describe('reorderPlayer — array mutation', () => {
  it('moves a player forward (low → high index)', () => {
    reorderPlayer('a', 1, 3);
    expect(state.teamA.players.map((p) => p.name)).toEqual(['A0', 'A2', 'A3', 'A1', 'A4']);
  });

  it('moves a player backward (high → low index)', () => {
    reorderPlayer('a', 3, 1);
    expect(state.teamA.players.map((p) => p.name)).toEqual(['A0', 'A3', 'A1', 'A2', 'A4']);
  });

  it('preserves player points when moved', () => {
    state.teamA.players[1].points = 25;
    reorderPlayer('a', 1, 4);
    const moved = state.teamA.players.find((p) => p.name === 'A1');
    expect(moved.points).toBe(25);
    expect(state.teamA.players[4].name).toBe('A1');
  });

  it('is a no-op when from === to', () => {
    const before = state.teamA.players.map((p) => p.name);
    reorderPlayer('a', 2, 2);
    expect(state.teamA.players.map((p) => p.name)).toEqual(before);
  });

  it('clamps out-of-range indices and no-ops if both clamp to the same slot', () => {
    const before = state.teamA.players.map((p) => p.name);
    reorderPlayer('a', 99, 100);
    expect(state.teamA.players.map((p) => p.name)).toEqual(before);
  });

  it('does not touch the other team', () => {
    reorderPlayer('a', 0, 4);
    expect(state.teamB.players.map((p) => p.name)).toEqual(['B0', 'B1']);
  });
});

describe('reorderPlayer — history remap (CSV / undo correctness)', () => {
  it('updates state.history playerIndex so points stay attached to the moved player', () => {
    state.currentQuestion = 0;
    addPoints('a', 1, 10);        // A1 gets +10 → history[0].playerIndex = 1
    state.currentQuestion = 1;
    addPoints('a', 3, 10);        // A3 gets +10 → history[1].playerIndex = 3
    state.currentQuestion = 2;
    addPoints('b', 0, 10);        // B0 gets +10 → history[2].playerIndex = 0

    // Move A1 (index 1) to the end of team A (index 4).
    reorderPlayer('a', 1, 4);

    expect(state.teamA.players.map((p) => p.name)).toEqual(['A0', 'A2', 'A3', 'A4', 'A1']);
    // A1's history entry should now point to index 4 (its new home).
    expect(state.history[0]).toMatchObject({ team: 'a', playerIndex: 4, points: 10 });
    // A3's history entry should point to index 2 (it shifted left by one).
    expect(state.history[1]).toMatchObject({ team: 'a', playerIndex: 2, points: 10 });
    // Team B history is untouched.
    expect(state.history[2]).toMatchObject({ team: 'b', playerIndex: 0, points: 10 });
  });

  it('undoLast after a reorder still subtracts from the right player', () => {
    state.currentQuestion = 0;
    addPoints('a', 2, 10);          // A2 gets +10
    expect(state.teamA.players[2].points).toBe(10);

    reorderPlayer('a', 2, 0);       // A2 moves to index 0
    expect(state.teamA.players[0].name).toBe('A2');
    expect(state.teamA.players[0].points).toBe(10);

    undoLast();                     // should subtract from A2 at index 0, not the original index 2
    expect(state.teamA.players[0].points).toBe(0);
    expect(state.teamA.players[1].points).toBe(0); // A0 (was at idx 0) untouched
    expect(state.teamA.score).toBe(0);
  });
});

describe('reorderPlayer — streakScoring remap', () => {
  it('updates streak bucket playerIndex so accumulated streak points stay attached', () => {
    state.questions = [makeQ(1, { isStreak: true, streakGroupStart: 0, category: 'Streak: X' })];
    state.streakGroups = { 0: { start: 0, end: 0, members: [0], category: 'Streak: X', sourceQuestion: state.questions[0] } };
    state.currentQuestion = 0;
    addPoints('a', 2, 10); // A2 starts the streak → totalPoints=5, playerIndex=2
    addPoints('a', 2, 10); // → totalPoints=10
    expect(state.streakScoring[0].a.playerIndex).toBe(2);
    expect(state.streakScoring[0].a.totalPoints).toBe(10);

    reorderPlayer('a', 2, 0); // A2 moves to index 0

    expect(state.streakScoring[0].a.playerIndex).toBe(0);
    expect(state.streakScoring[0].a.totalPoints).toBe(10);
    expect(state.teamA.players[0].name).toBe('A2');
    expect(state.teamA.players[0].points).toBe(10);
  });
});

describe('reorderPlayer — jailbreakLocked remap', () => {
  it('updates the cached state.jailbreakLocked indices directly', () => {
    // state.jailbreakLocked is *derived* from state.history by
    // rebuildJailbreakLocks (called on every renderGame), but we also keep
    // it consistent inside the reducer as defense-in-depth for any caller
    // that inspects state.jailbreakLocked before the next render fires.
    state.jailbreakLocked = { a: [0, 2, 4], b: [1] };
    // Snapshot before notify() can stomp the array.
    const beforeNotifyA = [...state.jailbreakLocked.a];
    expect(beforeNotifyA).toEqual([0, 2, 4]);

    // Apply reorder via the mapping directly (bypassing notify) by setting up
    // history with jailbreak-category questions, then verifying that after a
    // reorder the canonical reconstruction lands on the right players.
    state.questions = [
      makeQ(1, { category: 'Jailbreak: A' }),
      makeQ(2, { category: 'Jailbreak: A' }),
      makeQ(3, { category: 'Jailbreak: A' }),
    ];
    state.currentQuestion = 0;
    addPoints('a', 0, 10);   // A0 locks
    state.currentQuestion = 1;
    addPoints('a', 2, 10);   // A2 locks
    state.currentQuestion = 2;
    addPoints('a', 4, 10);   // A4 locks
    // Three of five players have buzzed — locks should be {0, 2, 4} for team a.
    expect([...state.jailbreakLocked.a].sort((x, y) => x - y)).toEqual([0, 2, 4]);

    // Move A2 to the front. History remap + rebuild should leave the locks
    // pointing at A0, A2, A4 by name (now at indices 1, 0, 4).
    reorderPlayer('a', 2, 0);
    expect(state.teamA.players.map((p) => p.name)).toEqual(['A2', 'A0', 'A1', 'A3', 'A4']);
    expect([...state.jailbreakLocked.a].sort((x, y) => x - y)).toEqual([0, 1, 4]);
  });
});
