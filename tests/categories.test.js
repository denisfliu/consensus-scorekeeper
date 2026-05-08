import { describe, it, expect, beforeEach } from 'vitest';
import { state, getSplitPair, getCategoryRunSize } from '../src/main.js';
import { resetState, makeQ } from './helpers.js';

beforeEach(resetState);

describe('getSplitPair', () => {
  it('returns null when category is not a Splits', () => {
    state.questions = [makeQ(1, { category: 'Set of 4: X' })];
    expect(getSplitPair(0, 'Set of 4: X')).toBeNull();
  });

  it('finds the partner Splits 2 walking forward from Splits 1', () => {
    state.questions = [
      makeQ(1, { category: 'Splits 1: Gothic' }),
      makeQ(2, { category: 'Splits 1: Gothic' }),
      makeQ(3, { category: 'Splits 2: Mountains' }),
      makeQ(4, { category: 'Splits 2: Mountains' }),
    ];
    expect(getSplitPair(0, 'Splits 1: Gothic')).toEqual({
      current: 'Splits 1: Gothic',
      partner: 'Splits 2: Mountains',
      currentNum: 1,
    });
  });

  it('finds the partner Splits 1 walking backward from Splits 2', () => {
    state.questions = [
      makeQ(1, { category: 'Splits 1: Gothic' }),
      makeQ(2, { category: 'Splits 2: Mountains' }),
    ];
    expect(getSplitPair(1, 'Splits 2: Mountains')).toEqual({
      current: 'Splits 2: Mountains',
      partner: 'Splits 1: Gothic',
      currentNum: 2,
    });
  });

  it('returns null when no partner exists', () => {
    state.questions = [
      makeQ(1, { category: 'Splits 1: Lonely' }),
      makeQ(2, { category: 'Set of 3: Other' }),
    ];
    expect(getSplitPair(0, 'Splits 1: Lonely')).toBeNull();
  });
});

describe('getCategoryRunSize', () => {
  it('returns null with falsy inputs', () => {
    expect(getCategoryRunSize(0, '', 1)).toBeNull();
    expect(getCategoryRunSize(0, 'X', 0)).toBeNull();
  });

  it('counts a contiguous category run', () => {
    state.questions = [
      makeQ(1, { category: 'Set of 4: Authors', posInCategory: 1 }),
      makeQ(2, { category: 'Set of 4: Authors', posInCategory: 2 }),
      makeQ(3, { category: 'Set of 4: Authors', posInCategory: 3 }),
      makeQ(4, { category: 'Set of 4: Authors', posInCategory: 4 }),
    ];
    expect(getCategoryRunSize(0, 'Set of 4: Authors', 1)).toBe(4);
  });

  it('does not lump together two separate runs of the same category name', () => {
    // Pack with two unrelated "Set of 4" sections — must not merge into one run.
    state.questions = [
      makeQ(1, { category: 'Set of 4', posInCategory: 1 }),
      makeQ(2, { category: 'Set of 4', posInCategory: 2 }),
      makeQ(3, { category: 'Set of 4', posInCategory: 3 }),
      makeQ(4, { category: 'Set of 4', posInCategory: 4 }),
      makeQ(5, { category: 'Streak', posInCategory: 1 }),
      makeQ(6, { category: 'Set of 4', posInCategory: 1 }),
      makeQ(7, { category: 'Set of 4', posInCategory: 2 }),
      makeQ(8, { category: 'Set of 4', posInCategory: 3 }),
      makeQ(9, { category: 'Set of 4', posInCategory: 4 }),
    ];
    expect(getCategoryRunSize(0, 'Set of 4', 1)).toBe(4);
    expect(getCategoryRunSize(5, 'Set of 4', 1)).toBe(4);
  });
});
