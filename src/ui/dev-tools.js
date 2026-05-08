// Dev Tools panel on the game screen. Two features:
//   1. Re-parse the loaded PDF (pick up parser fixes mid-game without losing scores).
//   2. Custom point award: assign arbitrary points to a player on any question.

import { state, applyCustomAward as applyCustomAwardReducer } from '../state.js';
import { escapeHtml } from '../util/escape.js';
import { parsePdf } from '../loader.js';
import { rebuildStreakGroups } from '../game/streaks.js';

export async function reparseCurrentPdf({ padQuestionsToSlots, renderGame }) {
  if (!state.pdfBytes) {
    alert('No PDF is loaded for this session. Upload one from the Setup screen first.');
    return;
  }
  const ok = confirm(
    'Re-parse the current PDF?\n\n' +
    'This re-runs the parser on the loaded PDF and replaces all parsed questions and answers. ' +
    'Team scores, player points, and per-question history are kept intact.\n\n' +
    'Use this to pick up parser fixes without re-uploading the file or losing your in-progress game.'
  );
  if (!ok) return;
  // parsePdf detaches the buffer it's given; pass a fresh copy so state.pdfBytes survives.
  await parsePdf(state.pdfBytes.buffer.slice(0), state.packName || 'pdf');
  padQuestionsToSlots();
  rebuildStreakGroups();
  if (state.currentQuestion >= state.questions.length) state.currentQuestion = state.questions.length - 1;
  document.getElementById('dev-tools').open = false;
  renderGame();
}

export function applyCustomAward() {
  const sel = document.getElementById('dt-player').value;
  const qNum = parseInt(document.getElementById('dt-question').value, 10);
  const points = parseInt(document.getElementById('dt-points').value, 10);
  if (!sel) { alert('Pick a player.'); return; }
  if (!Number.isInteger(qNum) || qNum < 1 || qNum > state.questions.length) {
    alert(`Question number must be between 1 and ${state.questions.length}.`); return;
  }
  if (!Number.isInteger(points) || points === 0) {
    alert('Points must be a non-zero integer (negatives subtract).'); return;
  }
  const [team, idxStr] = sel.split(':');
  const playerIndex = parseInt(idxStr, 10);
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  if (!teamObj.players[playerIndex]) { alert('Player not found.'); return; }
  applyCustomAwardReducer(team, playerIndex, points, qNum - 1);
  // applyCustomAwardReducer triggers renderGame via the state subscriber.
  // The remaining work below is dev-tools UI cleanup only.
  document.getElementById('dt-points').value = '';
  const ca = document.getElementById('custom-award');
  if (ca) ca.open = false;
}

// Populate the custom-award dropdown's player list and default Q# whenever it opens.
export function populateCustomAward() {
  const playerSel = document.getElementById('dt-player');
  if (!playerSel) return;
  const prev = playerSel.value;
  const opts = ['<option value="">— pick player —</option>'];
  state.teamA.players.forEach((p, i) => opts.push(`<option value="a:${i}">${escapeHtml(state.teamA.name)} — ${escapeHtml(p.name)}</option>`));
  state.teamB.players.forEach((p, i) => opts.push(`<option value="b:${i}">${escapeHtml(state.teamB.name)} — ${escapeHtml(p.name)}</option>`));
  playerSel.innerHTML = opts.join('');
  if (prev && [...playerSel.options].some(o => o.value === prev)) playerSel.value = prev;
  const qInput = document.getElementById('dt-question');
  if (qInput) qInput.value = (state.currentQuestion || 0) + 1;
}

export function setupDevTools() {
  // Refresh the custom-award dropdown's player list + default Q# each time it opens.
  const customAwardEl = document.getElementById('custom-award');
  if (customAwardEl) {
    customAwardEl.addEventListener('toggle', () => {
      if (customAwardEl.open) populateCustomAward();
    });
  }
}
