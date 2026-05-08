import { describe, it, expect } from 'vitest';
import * as main from '../src/main.js';

describe('main.js import', () => {
  it('imports without throwing', () => {
    expect(main).toBeDefined();
  });

  it('exports core pure functions', () => {
    expect(typeof main.parseQuestions).toBe('function');
    expect(typeof main.cleanTrailing).toBe('function');
    expect(typeof main.escapeHtml).toBe('function');
    expect(typeof main.csvEscape).toBe('function');
    expect(typeof main.exportCsv).toBe('function');
    expect(typeof main.readZip).toBe('function');
    expect(typeof main.rebuildStreakGroups).toBe('function');
  });

  it('exposes the state singleton', () => {
    expect(main.state).toBeDefined();
    expect(main.state.teamA).toBeDefined();
    expect(main.state.teamB).toBeDefined();
  });
});
