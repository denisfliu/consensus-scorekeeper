// Roster management on the setup screen.
//
// Two modes for the team-name field:
//   * tournament (default) — a <select> populated from ROSTER_PRESETS;
//                            picking a team auto-fills the player list.
//   * custom              — a free-text <input>, the original behavior.
//
// The mode is persisted in localStorage under ROSTER_MODE_KEY so the
// preference survives reloads. Toggling re-renders both team-name slots
// (#team-a-name-slot / #team-b-name-slot) and re-binds listeners — the
// active element keeps its stable id (`team-${team}-name`) so other
// modules (loadState, tutorial.js, ui/game.js startGame) don't need to
// care which mode is active.
//
// Add/remove player buttons and the Michał-aware <datalist> autocomplete
// are mode-independent and always available.

import { state } from '../state.js';
import { escapeHtml } from '../util/escape.js';
import { saveState } from '../game/persistence.js';
import { ROSTER_PRESETS, PLAYER_SUGGESTIONS } from './roster-presets.js';

const ROSTER_MODE_KEY = 'consensus-roster-mode-v1';
const PLACEHOLDER_VALUE = '';
let rosterMode = readPersistedMode();

function readPersistedMode() {
  try {
    const v = localStorage.getItem(ROSTER_MODE_KEY);
    return v === 'custom' ? 'custom' : 'tournament';
  } catch { return 'tournament'; }
}

export function getRosterMode() { return rosterMode; }

export function addPlayer(team) {
  const input = document.getElementById(`add-player-${team}`);
  const name = input.value.trim();
  if (!name) return;
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  teamObj.players.push({ name, points: 0 });
  input.value = '';
  renderRoster(team);
  input.focus();
  saveState();
}

export function removePlayer(team, index) {
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  teamObj.players.splice(index, 1);
  renderRoster(team);
  saveState();
}

export function renderRoster(team) {
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  const list = document.getElementById(`roster-${team}`);
  if (!list) return;
  list.innerHTML = teamObj.players.map((p, i) =>
    `<li><span>${escapeHtml(p.name)}</span><button data-action="remove-player" data-team="${team}" data-index="${i}">&times;</button></li>`
  ).join('');
}

function buildTeamSelectMarkup(team) {
  const opts = [`<option value="${PLACEHOLDER_VALUE}">— Pick a team —</option>`];
  for (const preset of ROSTER_PRESETS) {
    opts.push(`<option value="${escapeHtml(preset.name)}">${escapeHtml(preset.name)}</option>`);
  }
  return `<select id="team-${team}-name">${opts.join('')}</select>`;
}

function buildTeamInputMarkup(team, currentName) {
  const safe = escapeHtml(currentName || '');
  return `<input type="text" id="team-${team}-name" value="${safe}" placeholder="Team name">`;
}

function populatePlayerSuggestions() {
  const dl = document.getElementById('player-suggestions');
  if (!dl) return;
  dl.innerHTML = PLAYER_SUGGESTIONS
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join('');
}

// Render the team-name field in `team`'s slot for the current mode.
// The previous element (and its listeners) is dropped because innerHTML
// replaces the contents — listeners are re-bound here. The displayed
// value isn't set here: in custom mode, buildTeamInputMarkup already bakes
// in state.teamX.name; in tournament mode we want a fresh load to show
// the placeholder. Callers that want to carry a name across a toggle
// (toggleRosterMode) call setTeamNameField after this returns.
function renderTeamNameField(team) {
  const slot = document.getElementById(`team-${team}-name-slot`);
  if (!slot) return;
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  slot.innerHTML = rosterMode === 'tournament'
    ? buildTeamSelectMarkup(team)
    : buildTeamInputMarkup(team, teamObj.name);

  const el = document.getElementById(`team-${team}-name`);
  if (!el) return;

  if (rosterMode === 'tournament') {
    el.addEventListener('change', (e) => applyPreset(team, e.target.value));
  } else {
    el.addEventListener('input', (e) => {
      const obj = team === 'a' ? state.teamA : state.teamB;
      obj.name = e.target.value;
      saveState();
    });
  }
}

// Set the team-name field to display `name`, regardless of mode.
//   - In tournament mode: select the matching preset, or inject a one-off
//     <option data-dynamic="true"> if the name isn't a preset (saved
//     sessions, tutorial sandbox).
//   - In custom mode: just write to the input's value.
export function setTeamNameField(team, name) {
  const el = document.getElementById(`team-${team}-name`);
  if (!el) return;
  if (el.tagName !== 'SELECT') {
    el.value = name || '';
    return;
  }
  if (!name) { el.value = PLACEHOLDER_VALUE; return; }
  // Skip the boilerplate default names — they're meaningless in tournament
  // mode and we don't want them to clutter the dropdown as dynamic options.
  // The user can pick a real preset; until then the placeholder stays.
  const defaultName = team === 'a' ? 'Team A' : 'Team B';
  if (name === defaultName) { el.value = PLACEHOLDER_VALUE; return; }
  const stale = el.querySelector('option[data-dynamic="true"]');
  if (stale) stale.remove();
  const matches = Array.from(el.options).some((o) => o.value === name);
  if (!matches) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    opt.dataset.dynamic = 'true';
    el.insertBefore(opt, el.options[1] || null);
  }
  el.value = name;
}

function applyPreset(team, presetName) {
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  const preset = ROSTER_PRESETS.find((p) => p.name === presetName);
  if (preset) {
    teamObj.name = preset.name;
    teamObj.players = preset.players.map((name) => ({ name, points: 0 }));
  } else {
    teamObj.name = '';
    teamObj.players = [];
  }
  teamObj.score = 0;
  renderRoster(team);
  saveState();
}

function syncToggleLabel() {
  const btn = document.getElementById('roster-mode-toggle');
  if (btn) {
    btn.textContent = rosterMode === 'tournament' ? 'Roster: Tournament' : 'Roster: Custom';
    btn.dataset.mode = rosterMode;
  }
  // Mirror onto #setup so CSS-only sections (e.g. #tournament-stats-section)
  // can show/hide themselves based on mode without needing to coordinate
  // with this module.
  const setup = document.getElementById('setup');
  if (setup) setup.dataset.rosterMode = rosterMode;
}

export function toggleRosterMode() {
  rosterMode = rosterMode === 'tournament' ? 'custom' : 'tournament';
  try { localStorage.setItem(ROSTER_MODE_KEY, rosterMode); } catch {}
  syncToggleLabel();
  // After re-rendering, carry whatever name lives in state into the new
  // field so a custom-typed name isn't dropped on toggle. In tournament
  // mode this also preserves a non-preset name as a one-off <option>.
  renderTeamNameField('a');
  renderTeamNameField('b');
  setTeamNameField('a', state.teamA.name);
  setTeamNameField('b', state.teamB.name);
}

export function setupSetupScreen() {
  populatePlayerSuggestions();
  syncToggleLabel();
  renderTeamNameField('a');
  renderTeamNameField('b');

  const addA = document.getElementById('add-player-a');
  const addB = document.getElementById('add-player-b');
  if (addA) addA.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer('a'); });
  if (addB) addB.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer('b'); });

  // Roster <button> uses data-action so we can keep using event delegation
  // without inline onclick. The roster list is re-rendered (innerHTML) on
  // every change, so this delegated listener is the right place to bind.
  for (const team of ['a', 'b']) {
    const list = document.getElementById(`roster-${team}`);
    if (!list) continue;
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action="remove-player"]');
      if (!btn) return;
      removePlayer(btn.dataset.team, parseInt(btn.dataset.index, 10));
    });
  }
}
