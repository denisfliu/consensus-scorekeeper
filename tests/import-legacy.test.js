import { describe, it, expect } from 'vitest';
import * as legacy from '../src/legacy.js';

describe('legacy.js import', () => {
  it('imports without throwing', () => {
    expect(legacy).toBeDefined();
  });

  it('exports core pure functions', () => {
    expect(typeof legacy.parseQuestions).toBe('function');
    expect(typeof legacy.cleanTrailing).toBe('function');
    expect(typeof legacy.escapeHtml).toBe('function');
    expect(typeof legacy.csvEscape).toBe('function');
    expect(typeof legacy.exportCsv).toBe('function');
    expect(typeof legacy.readZip).toBe('function');
    expect(typeof legacy.rebuildStreakGroups).toBe('function');
  });

  it('exposes the state singleton', () => {
    expect(legacy.state).toBeDefined();
    expect(legacy.state.teamA).toBeDefined();
    expect(legacy.state.teamB).toBeDefined();
  });
});
