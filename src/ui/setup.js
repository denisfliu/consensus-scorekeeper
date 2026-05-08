// Roster management on the setup screen: adding/removing players and the
// team-name <input> wiring. renderRoster is also called by loadState when
// restoring a session.

import { state } from '../state.js';
import { escapeHtml } from '../util/escape.js';
import { saveState } from '../game/persistence.js';

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

export function setupSetupScreen() {
  const addA = document.getElementById('add-player-a');
  const addB = document.getElementById('add-player-b');
  const nameA = document.getElementById('team-a-name');
  const nameB = document.getElementById('team-b-name');
  if (addA) addA.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer('a'); });
  if (addB) addB.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer('b'); });
  if (nameA) nameA.addEventListener('input', (e) => { state.teamA.name = e.target.value; saveState(); });
  if (nameB) nameB.addEventListener('input', (e) => { state.teamB.name = e.target.value; saveState(); });

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
