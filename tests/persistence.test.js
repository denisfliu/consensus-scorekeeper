import { describe, it, expect, beforeEach } from 'vitest';
import { state, saveState, loadState, clearSavedState, savePdfBytes, loadPdfBytes } from '../src/main.js';
import { resetState, makeQ } from './helpers.js';

const STORAGE_KEY = 'consensus-state-v1';

beforeEach(() => {
  resetState();
  localStorage.clear();
});

describe('saveState / loadState round-trip', () => {
  it('preserves teams, score, history, packName, and answeredQuestions', () => {
    state.teamA = { name: 'Alphas', players: [{ name: 'A1', points: 30 }], score: 30 };
    state.teamB = { name: 'Bravos', players: [{ name: 'B1', points: 10 }], score: 10 };
    state.questions = [makeQ(1), makeQ(2)];
    state.hasQuestions = true;
    state.currentQuestion = 1;
    state.history = [
      { team: 'a', playerIndex: 0, points: 10, question: 0 },
      { team: 'a', playerIndex: 0, points: 10, question: 1 },
      { team: 'a', playerIndex: 0, points: 10, question: 1 },
    ];
    state.answeredQuestions = new Set([0, 1]);
    state.streakScoring = {};
    state.packName = 'My Pack.pdf';

    saveState();
    // Wipe state then reload
    resetState();
    loadState();

    expect(state.teamA.name).toBe('Alphas');
    expect(state.teamA.score).toBe(30);
    expect(state.teamB.players[0].points).toBe(10);
    expect(state.questions).toHaveLength(2);
    expect(state.currentQuestion).toBe(1);
    expect(state.hasQuestions).toBe(true);
    expect([...state.answeredQuestions].sort()).toEqual([0, 1]);
    expect(state.history).toHaveLength(3);
    expect(state.packName).toBe('My Pack.pdf');
  });
});

describe('loadState — v1 → v2 streakScoring migration', () => {
  it('migrates a v1 single-scorer entry to a per-team bucket', () => {
    // v1 shape: { team, playerIndex, globalPlayerIdx, totalPoints }
    const v1Snap = {
      teamA: { name: 'A', players: [{ name: 'A1', points: 0 }], score: 0 },
      teamB: { name: 'B', players: [{ name: 'B1', points: 0 }], score: 0 },
      questions: [],
      currentQuestion: 0,
      hasQuestions: false,
      history: [],
      answeredQuestions: [],
      streakScoring: {
        '84': { team: 'a', playerIndex: 0, globalPlayerIdx: 0, totalPoints: 25 },
      },
      packName: null,
      gameActive: false,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1Snap));

    loadState();

    // v2: { a: { playerIndex, totalPoints } }
    expect(state.streakScoring['84']).toEqual({
      a: { playerIndex: 0, totalPoints: 25 },
    });
    expect(state.streakScoring['84'].team).toBeUndefined();
  });

  it('leaves an already-v2 entry untouched', () => {
    const v2Snap = {
      teamA: { name: 'A', players: [], score: 0 },
      teamB: { name: 'B', players: [], score: 0 },
      questions: [],
      streakScoring: {
        '50': { a: { playerIndex: 1, totalPoints: 15 }, b: { playerIndex: 2, totalPoints: 10 } },
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v2Snap));
    loadState();
    expect(state.streakScoring['50']).toEqual({
      a: { playerIndex: 1, totalPoints: 15 },
      b: { playerIndex: 2, totalPoints: 10 },
    });
  });
});

describe('savePdfBytes / loadPdfBytes', () => {
  it('round-trips PDF bytes through localStorage', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
    savePdfBytes(bytes);
    const loaded = loadPdfBytes();
    expect(loaded).toBeInstanceOf(Uint8Array);
    expect(Array.from(loaded)).toEqual(Array.from(bytes));
  });

  it('returns null when no PDF is stored', () => {
    expect(loadPdfBytes()).toBeNull();
  });
});

describe('clearSavedState', () => {
  it('removes both state and pdf-bytes from localStorage', () => {
    state.teamA.name = 'Hello';
    saveState();
    savePdfBytes(new Uint8Array([1, 2, 3]));
    clearSavedState();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadPdfBytes()).toBeNull();
  });
});
