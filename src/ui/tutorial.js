// "Tutorial" button on the setup screen — boots a sandbox game with preset
// rosters and a known pack so a new moderator can experiment without first
// having to build their own roster + upload a packet. The pack lives in
// assets/tutorial-pack.pdf so this works against a local server with no
// network access required.
//
// Future work (planned, not yet implemented): a coach-marks overlay that
// walks the user through each UI element. This module is the entry point —
// once that overlay exists it will be triggered from here after startGame.

import { state } from '../state.js';
import { renderRoster } from './setup.js';
import { parsePdf } from '../loader.js';
import { startGame } from './game.js';
import { startTutorial } from './tutorial-overlay.js';

const TUTORIAL_PACK_URL = 'assets/tutorial-pack.pdf';

const PRESET_ROSTERS = {
  teamA: {
    name: 'Quizmasters',
    players: ['Alice', 'Ben', 'Carla', 'Dan'],
  },
  teamB: {
    name: 'Trivia Titans',
    players: ['Eve', 'Frank', 'Gina', 'Hugo'],
  },
};

export async function startTutorialGame() {
  // Mark this as a sandbox session — saveState / savePdfBytes (in
  // game/persistence.js) early-return while this is true, so nothing
  // we do here touches localStorage. exitTutorial() in tutorial-overlay.js
  // reloads the page, which drops the user back into their pre-tutorial
  // saved state (if any) and resets tutorialMode to false.
  state.tutorialMode = true;

  // Wipe any in-progress setup so the tutorial always starts from a known shape.
  state.teamA.name = PRESET_ROSTERS.teamA.name;
  state.teamA.players = PRESET_ROSTERS.teamA.players.map((name) => ({ name, points: 0 }));
  state.teamA.score = 0;

  state.teamB.name = PRESET_ROSTERS.teamB.name;
  state.teamB.players = PRESET_ROSTERS.teamB.players.map((name) => ({ name, points: 0 }));
  state.teamB.score = 0;

  // Reflect the new teams + roster in the setup-screen inputs (the game's
  // header reads from state, but startGame() pulls team names from these).
  document.getElementById('team-a-name').value = state.teamA.name;
  document.getElementById('team-b-name').value = state.teamB.name;
  renderRoster('a');
  renderRoster('b');

  // Fetch + parse the bundled pack. The setup-screen status line is updated
  // by parsePdf as it goes.
  const statusEl = document.getElementById('pdf-status');
  if (statusEl) {
    statusEl.textContent = 'Loading tutorial pack...';
    statusEl.className = 'pdf-status';
  }
  let buffer;
  try {
    const r = await fetch(TUTORIAL_PACK_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    buffer = await r.arrayBuffer();
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = 'Could not load tutorial pack: ' + e.message + '. Run the page from a local server (python serve.py).';
      statusEl.className = 'pdf-status error';
    }
    return;
  }
  await parsePdf(buffer, 'Tutorial Pack.pdf');

  // Hide any zip-pack-select that a previous upload might have left visible.
  const sel = document.getElementById('zip-pack-select');
  if (sel) sel.style.display = 'none';

  startGame();
  startTutorial();
}
