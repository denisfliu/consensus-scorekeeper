import { describe, it, expect } from 'vitest';
import { cleanTrailing } from '../src/main.js';

describe('cleanTrailing', () => {
  it('strips trailing "PACK N" headers', () => {
    expect(cleanTrailing('the answer is X PACK 3 of 10')).toBe('the answer is X');
  });

  it('strips trailing "Set of N" suffix (case-insensitive regex tail)', () => {
    expect(cleanTrailing('correct response Set of 4: Famous Authors')).toBe('correct response');
  });

  it('strips trailing "Splits:" suffix', () => {
    expect(cleanTrailing('answer text Splits: 1 vs 2')).toBe('answer text');
  });

  it('strips trailing "Streak" suffix', () => {
    expect(cleanTrailing('foo Streak')).toBe('foo');
    expect(cleanTrailing('foo Streaks of 5')).toBe('foo');
  });

  it('strips uppercase section markers (END OF / FIRST QUARTER)', () => {
    expect(cleanTrailing('the answer END OF FIRST QUARTER')).toBe('the answer');
    expect(cleanTrailing('the answer FIRST HALF')).toBe('the answer');
  });

  it('is CASE-SENSITIVE for SECTION_WORDS so prose is preserved', () => {
    // Critical regression target: a lowercase "second half" inside legitimate
    // question text must NOT be truncated.
    const s = 'blew a 12-point second half lead';
    expect(cleanTrailing(s)).toBe(s);
  });

  it('trims trailing whitespace', () => {
    expect(cleanTrailing('hello   ')).toBe('hello');
  });

  it('leaves clean text alone', () => {
    expect(cleanTrailing('Just an answer.')).toBe('Just an answer.');
  });
});
