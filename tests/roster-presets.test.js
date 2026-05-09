import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../src/main.js';
import { setTeamNameField, toggleRosterMode, getRosterMode } from '../src/ui/setup.js';
import { ROSTER_PRESETS, PLAYER_SUGGESTIONS } from '../src/ui/roster-presets.js';
import { resetState } from './helpers.js';

// Toggle into a known mode before each test. setupSetupScreen ran at main.js
// import time using whatever localStorage held; force tournament mode here so
// the dropdown-specific assertions don't depend on test-execution order.
function ensureTournamentMode() {
  if (getRosterMode() !== 'tournament') toggleRosterMode();
}

beforeEach(() => {
  resetState();
  ensureTournamentMode();
});

describe('team-name <select> presets', () => {
  it('is populated with every preset roster plus a placeholder', () => {
    const sel = document.getElementById('team-a-name');
    // setupSetupScreen() ran at main.js import time. First option is the
    // "— Pick a team —" placeholder; remaining options correspond 1:1 with
    // ROSTER_PRESETS.
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values[0]).toBe('');
    expect(values.slice(1)).toEqual(ROSTER_PRESETS.map((p) => p.name));
  });

  it('selecting a preset auto-populates name + players (change event)', () => {
    const sel = document.getElementById('team-a-name');
    sel.value = 'Wookiee';
    sel.dispatchEvent(new Event('change'));
    expect(state.teamA.name).toBe('Wookiee');
    expect(state.teamA.players.map((p) => p.name)).toEqual(['Danny Han', 'Denis Liu', 'Ethan Bosita']);
    // Each player starts with zero points.
    expect(state.teamA.players.every((p) => p.points === 0)).toBe(true);
  });

  it('selecting the placeholder clears the team', () => {
    const sel = document.getElementById('team-b-name');
    sel.value = 'Sarlacc';
    sel.dispatchEvent(new Event('change'));
    expect(state.teamB.players).toHaveLength(2); // Michał intentionally excluded
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    expect(state.teamB.name).toBe('');
    expect(state.teamB.players).toEqual([]);
  });

  it('Sarlacc preset omits Michał Gerasimiuk by default', () => {
    const sarlacc = ROSTER_PRESETS.find((p) => p.name === 'Sarlacc');
    expect(sarlacc.players).not.toContain('Michał Gerasimiuk');
  });

  it('Michał Gerasimiuk is offered as an autocomplete suggestion', () => {
    expect(PLAYER_SUGGESTIONS).toContain('Michał Gerasimiuk');
    const dl = document.getElementById('player-suggestions');
    const values = Array.from(dl.querySelectorAll('option')).map((o) => o.value);
    expect(values).toContain('Michał Gerasimiuk');
  });
});

describe('roster-mode toggle', () => {
  it('switches the team-name field from <select> to <input> and back', () => {
    expect(getRosterMode()).toBe('tournament');
    expect(document.getElementById('team-a-name').tagName).toBe('SELECT');
    toggleRosterMode();
    expect(getRosterMode()).toBe('custom');
    expect(document.getElementById('team-a-name').tagName).toBe('INPUT');
    toggleRosterMode();
    expect(getRosterMode()).toBe('tournament');
    expect(document.getElementById('team-a-name').tagName).toBe('SELECT');
  });

  it('typing in custom mode updates state.teamA.name', () => {
    toggleRosterMode();
    const el = document.getElementById('team-a-name');
    el.value = 'Phoenix';
    el.dispatchEvent(new Event('input'));
    expect(state.teamA.name).toBe('Phoenix');
    toggleRosterMode(); // back to tournament for the next test
  });

  it('preserves the current team name when switching modes', () => {
    state.teamA.name = 'Wookiee';
    state.teamA.players = [{ name: 'Danny Han', points: 0 }];
    setTeamNameField('a', 'Wookiee');
    toggleRosterMode(); // -> custom
    expect(document.getElementById('team-a-name').value).toBe('Wookiee');
    toggleRosterMode(); // -> tournament
    expect(document.getElementById('team-a-name').value).toBe('Wookiee');
  });
});

describe('setTeamNameField', () => {
  it('selects a matching preset option without injecting a duplicate', () => {
    setTeamNameField('a', 'Wookiee');
    const sel = document.getElementById('team-a-name');
    expect(sel.value).toBe('Wookiee');
    expect(sel.querySelectorAll('option[data-dynamic="true"]')).toHaveLength(0);
  });

  it('injects a one-off option for non-preset names (e.g. tutorial / legacy saves)', () => {
    setTeamNameField('a', 'Quizmasters');
    const sel = document.getElementById('team-a-name');
    expect(sel.value).toBe('Quizmasters');
    expect(sel.querySelectorAll('option[data-dynamic="true"]')).toHaveLength(1);
  });

  it('replaces a stale dynamic option rather than accumulating them', () => {
    setTeamNameField('a', 'Quizmasters');
    setTeamNameField('a', 'Trivia Titans');
    const sel = document.getElementById('team-a-name');
    expect(sel.value).toBe('Trivia Titans');
    expect(sel.querySelectorAll('option[data-dynamic="true"]')).toHaveLength(1);
  });
});
