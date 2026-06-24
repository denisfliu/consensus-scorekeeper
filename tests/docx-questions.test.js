import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDocxBuffer, inferStreakSlotCount } from '../src/parser/docx-questions.js';

describe('inferStreakSlotCount', () => {
  it('uses prompt cap when present, ceil(cap/2)', () => {
    expect(inferStreakSlotCount('name up to all six of the highest-rated…', 6)).toBe(3);
    expect(inferStreakSlotCount('Give the nicknames of up to all six…', 6)).toBe(3);
    expect(inferStreakSlotCount('Name up to all five colors on the Olympic flag.', 5)).toBe(3);
    expect(inferStreakSlotCount('Name up to all four…', 4)).toBe(2);
  });
  it('uses prompt cap even when more answers are listed', () => {
    // Writer listed 11 acceptable answers but the prompt caps at five.
    expect(inferStreakSlotCount('Name up to all five US presidents…', 11)).toBe(3);
  });
  it('handles digit caps', () => {
    expect(inferStreakSlotCount('Name up to 8 things', 8)).toBe(4);
  });
  it('falls back to ceil(answers/2) when no cap pattern matches', () => {
    expect(inferStreakSlotCount('List as many as you can.', 6)).toBe(3);
    expect(inferStreakSlotCount('', 7)).toBe(4);
  });
  it('never returns less than 1', () => {
    expect(inferStreakSlotCount('', 0)).toBe(1);
  });
});

// Lazy import so the suite skips cleanly when the user hasn't placed the
// packet docx files at the expected path.
const PACKET = 'C:\\Users\\denis\\Downloads\\drive-download-20260624T034000Z-3-001\\Copy of mCons packet 1.docx';

function tryRead() {
  try { return readFileSync(PACKET); } catch { return null; }
}

const buf = tryRead();
const describeOrSkip = buf ? describe : describe.skip;

describeOrSkip('parseDocxBuffer — packet 1', () => {
  let questions;
  it('parses without throwing', async () => {
    questions = await parseDocxBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(Array.isArray(questions)).toBe(true);
  });
  it('produces ~96 questions (matches reference Python parser)', () => {
    expect(questions.length).toBeGreaterThanOrEqual(90);
    expect(questions.length).toBeLessThanOrEqual(100);
  });
  it('emits PDF-parser-compatible shape', () => {
    const q = questions[0];
    expect(q).toHaveProperty('num');
    expect(q).toHaveProperty('question');
    expect(q).toHaveProperty('answer');
    expect(q).toHaveProperty('answerHtml');
    expect(q).toHaveProperty('category');
    expect(q).toHaveProperty('posInCategory');
    expect(q).toHaveProperty('categoryInstructions');
    expect(q).toHaveProperty('streakRange');
    expect(q).toHaveProperty('pageNum');
    expect(q).toHaveProperty('yPos');
    expect(q.pageNum).toBeNull();
    expect(q.yPos).toBeNull();
  });
  it('finds Q1 = Mona Lisa → Louvre', () => {
    const q1 = questions.find(q => q.num === 1);
    expect(q1.question).toMatch(/Mona Lisa/);
    expect(q1.answer).toMatch(/Louvre/);
    expect(q1.answerHtml).toContain('<b><u>Louvre</u></b>');
  });
  it('attaches Jackpot answer to every part', () => {
    const jackpotParts = questions.filter(q => q.category === 'Jackpot');
    expect(jackpotParts.length).toBeGreaterThan(0);
    for (const q of jackpotParts) {
      expect(q.answer).toMatch(/Weill/);
    }
  });
  it('emits streak with multi-answer (" | "-joined) and a slot range', () => {
    const streaks = questions.filter(q => q.streakRange);
    expect(streaks.length).toBe(2);
    const nakamura = streaks.find(q => q.answer.includes('Nakamura'));
    expect(nakamura).toBeDefined();
    expect(nakamura.answer.split(' | ').length).toBe(6);
    // Prompt says "up to all six" — cap 6, half points → 3 slots.
    expect(nakamura.streakRange.end - nakamura.streakRange.start).toBe(2);
    expect(nakamura.answerHtml).toContain('<div>Answer:');
  });
  it('assigns sequential num across streak slots', () => {
    // Numbers must be strictly increasing — streaks bump num by their span.
    let prev = 0;
    for (const q of questions) {
      expect(q.num).toBeGreaterThan(prev);
      prev = q.num;
    }
  });
  it('captures Splits sub-categories', () => {
    const splits = questions.filter(q => q.category === 'Splits');
    const subs = new Set(splits.map(q => q.subcategory).filter(Boolean));
    expect(subs.size).toBeGreaterThanOrEqual(2);
  });
});
