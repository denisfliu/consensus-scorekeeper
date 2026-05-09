// Tournament Stats viewer. Powers stats.html (the standalone, public-facing
// page). The DOM contract is:
//   - <input type="file" id="ts-file-input" multiple accept=".csv">
//   - <button data-action="ts-clear">
//   - <span id="ts-status">
//   - <div id="ts-content">              ← rendered into
//   - everything wrapped in #tournament-stats-section so the delegated
//     click handler has a stable parent
//
// Sources of CSVs:
//   - **Manual upload** via the file input. Persisted to localStorage so
//     reloads don't lose them. Tagged source: 'upload'.
//   - **Manifest auto-load** from a JSON file (used by the public page) —
//     fetched on every init, replaces any prior `source: 'manifest'` games
//     so a redeploy reflects new pushes. Manifest shape: `{ "games": [...] }`.
//
// Views (state.view):
//   - 'standings' — team table + individual leaderboard + summary
//   - 'team'      — one team's record + all their games
//   - 'player'    — one player's per-game points across all their games
//   - 'game'      — full per-player breakdown of a single match

import { parseResultsCsv } from '../util/parse-results-csv.js';
import { aggregateTournament, gamesForTeam, gamesForPlayer } from '../util/tournament-aggregate.js';
import { escapeHtml } from '../util/escape.js';

const TS_STORAGE_KEY = 'consensus-tournament-games-v1';

const tsState = {
  games: [],                      // [{ id, source, packet, teamA, teamB, scoreA, scoreB, winner, exportedAt, players }]
  view: 'standings',              // 'standings' | 'team' | 'player' | 'game'
  selectedTeam: null,             // team name (string) when view === 'team' | 'player'
  selectedPlayer: null,           // player name (string) when view === 'player'
  selectedGameId: null,           // game id (string) when view === 'game'
};

function loadPersisted() {
  try {
    const raw = localStorage.getItem(TS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) tsState.games = parsed;
  } catch (e) {
    console.warn('[tournament-stats] failed to load persisted games:', e);
  }
}

function persist() {
  try {
    localStorage.setItem(TS_STORAGE_KEY, JSON.stringify(tsState.games));
  } catch (e) {
    console.warn('[tournament-stats] failed to persist games:', e);
  }
}

function setStatus(msg, kind) {
  const el = document.getElementById('ts-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'ts-status' + (kind ? ` ts-status-${kind}` : '');
}

function upsertGame(game) {
  const i = tsState.games.findIndex((g) => g.id === game.id);
  if (i >= 0) tsState.games[i] = game;
  else tsState.games.push(game);
}

async function handleUpload(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let added = 0, skipped = 0;
  for (const file of files) {
    try {
      const text = await file.text();
      const parsed = parseResultsCsv(text);
      if (!parsed.teamA || !parsed.teamB) { skipped++; continue; }
      // Re-uploading the same filename replaces (so users can fix a typo
      // and reupload without doubling the game).
      upsertGame({ id: `upload:${file.name}`, source: 'upload', ...parsed });
      added++;
    } catch (e) {
      console.warn('[tournament-stats] parse failed for', file.name, e);
      skipped++;
    }
  }
  persist();
  setStatus(
    `Loaded ${added} game${added === 1 ? '' : 's'}` + (skipped ? ` (${skipped} skipped)` : '') + `. ${tsState.games.length} total.`,
    skipped ? 'warn' : 'ok',
  );
  render();
}

// Fetch the manifest, then each listed CSV. Replaces any prior
// `source: 'manifest'` games so a redeploy reflects the latest set.
// Tolerates missing manifest / missing files — manual uploads still work.
async function loadFromManifest(manifestUrl) {
  try {
    const resp = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!resp.ok) return;
    const data = await resp.json();
    const list = Array.isArray(data) ? data : (data.games || []);
    if (!list.length) return;

    // Resolve CSV paths relative to the manifest's directory.
    const baseUrl = new URL(manifestUrl, document.baseURI);
    const baseDir = baseUrl.href.replace(/[^/]+$/, '');

    // Drop prior manifest games before adding the fresh set.
    tsState.games = tsState.games.filter((g) => g.source !== 'manifest');

    let added = 0, failed = 0;
    for (const entry of list) {
      const filename = typeof entry === 'string' ? entry : entry.filename;
      if (!filename) continue;
      try {
        const csvResp = await fetch(baseDir + encodeURIComponent(filename), { cache: 'no-cache' });
        if (!csvResp.ok) { failed++; continue; }
        const text = await csvResp.text();
        const parsed = parseResultsCsv(text);
        if (!parsed.teamA || !parsed.teamB) { failed++; continue; }
        upsertGame({ id: `manifest:${filename}`, source: 'manifest', ...parsed });
        added++;
      } catch {
        failed++;
      }
    }
    persist();
    if (added) {
      const uploads = tsState.games.filter((g) => g.source === 'upload').length;
      setStatus(
        `Loaded ${added} published game${added === 1 ? '' : 's'}` + (uploads ? ` + ${uploads} uploaded` : '') + (failed ? ` (${failed} failed)` : '') + '.',
        failed ? 'warn' : 'ok',
      );
    }
    render();
  } catch (e) {
    console.warn('[tournament-stats] failed to load manifest:', e);
  }
}

function clearUploaded() {
  const count = tsState.games.filter((g) => g.source === 'upload').length;
  if (!count) { setStatus('No uploaded games to clear.', 'warn'); return; }
  if (!confirm(`Clear ${count} uploaded game${count === 1 ? '' : 's'}? Published games stay.`)) return;
  tsState.games = tsState.games.filter((g) => g.source !== 'upload');
  resetView();
  persist();
  setStatus(`Cleared ${count} uploaded game${count === 1 ? '' : 's'}.`, 'ok');
  render();
}

function clearPublished() {
  const count = tsState.games.filter((g) => g.source === 'manifest').length;
  if (!count) { setStatus('No published games to clear.', 'warn'); return; }
  if (!confirm(`Clear ${count} published game${count === 1 ? '' : 's'} from the local view? They'll reappear on the next page load.`)) return;
  tsState.games = tsState.games.filter((g) => g.source !== 'manifest');
  resetView();
  persist();
  setStatus(`Cleared ${count} published game${count === 1 ? '' : 's'} (will refetch on reload).`, 'ok');
  render();
}

function resetView() {
  tsState.view = 'standings';
  tsState.selectedTeam = null;
  tsState.selectedPlayer = null;
  tsState.selectedGameId = null;
}

function showStandings() {
  resetView();
  render();
}

function showTeam(name) {
  tsState.view = 'team';
  tsState.selectedTeam = name;
  tsState.selectedPlayer = null;
  tsState.selectedGameId = null;
  render();
}

function showPlayer(team, name) {
  tsState.view = 'player';
  tsState.selectedTeam = team;
  tsState.selectedPlayer = name;
  tsState.selectedGameId = null;
  render();
}

function showGame(id) {
  tsState.view = 'game';
  tsState.selectedGameId = id;
  render();
}

// ==================== RENDER ====================

function pct(n, d) {
  if (!d) return '—';
  return `${((n / d) * 100).toFixed(0)}%`;
}

function renderStandings(agg) {
  const sRows = agg.standings.map((t) => `
    <tr class="ts-row-clickable" data-action="ts-show-team" data-team="${escapeHtml(t.name)}">
      <td>${escapeHtml(t.name)}</td>
      <td>${t.wins}</td>
      <td>${t.losses}</td>
      <td>${t.ties}</td>
      <td>${pct(t.wins + 0.5 * t.ties, t.gamesPlayed)}</td>
      <td>${t.pointsFor}</td>
      <td>${t.pointsAgainst}</td>
      <td>${t.pointsFor - t.pointsAgainst >= 0 ? '+' : ''}${t.pointsFor - t.pointsAgainst}</td>
    </tr>`).join('');

  const lRows = agg.leaderboard.map((p, i) => `
    <tr class="ts-row-clickable" data-action="ts-show-player" data-team="${escapeHtml(p.team)}" data-player="${escapeHtml(p.name)}">
      <td>${i + 1}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.team)}</td>
      <td>${p.points}</td>
      <td>${p.gamesPlayed}</td>
      <td>${p.ppg.toFixed(1)}</td>
      <td>${p.bestGame}</td>
    </tr>`).join('');

  const s = agg.summary;
  const summaryHtml = `
    <div class="ts-summary">
      <div><strong>${s.totalGames}</strong> game${s.totalGames === 1 ? '' : 's'}</div>
      ${s.closestGame ? `<div>Closest: <strong>${escapeHtml(s.closestGame.teamA)} ${s.closestGame.scoreA} – ${s.closestGame.scoreB} ${escapeHtml(s.closestGame.teamB)}</strong> (margin ${s.closestGame.margin})</div>` : ''}
      ${s.bestPlayerGame ? `<div>Top single-game: <strong>${escapeHtml(s.bestPlayerGame.name)}</strong> (${escapeHtml(s.bestPlayerGame.team)}) — ${s.bestPlayerGame.points} pts</div>` : ''}
    </div>`;

  return `
    ${summaryHtml}
    <div class="ts-stack">
      <div class="ts-panel">
        <h3>Team Standings</h3>
        <table class="ts-table">
          <thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th><th>%</th><th>PF</th><th>PA</th><th>±</th></tr></thead>
          <tbody>${sRows}</tbody>
        </table>
        <div class="ts-hint">Click a team to see their games.</div>
      </div>
      <div class="ts-panel">
        <h3>Individual Leaderboard</h3>
        <table class="ts-table">
          <thead><tr><th>#</th><th>Player</th><th>Team</th><th>Pts</th><th>GP</th><th>PPG</th><th>Best</th></tr></thead>
          <tbody>${lRows}</tbody>
        </table>
        <div class="ts-hint">Click a player to see their per-game performances.</div>
      </div>
    </div>`;
}

function renderTeamView(agg) {
  const teamName = tsState.selectedTeam;
  const team = agg.standings.find((t) => t.name === teamName);
  if (!team) return `<div class="ts-empty">Team not found.</div>`;

  const teamGames = gamesForTeam(tsState.games, teamName);
  teamGames.sort((x, y) => String(x.exportedAt).localeCompare(String(y.exportedAt)));

  const rows = teamGames.map((g) => `
    <tr class="ts-row-clickable ts-result-${g.result}" data-action="ts-show-game" data-game-id="${escapeHtml(g.id)}">
      <td>${escapeHtml(g.packet || '—')}</td>
      <td>${escapeHtml(g.opponent)}</td>
      <td><strong>${g.teamScore}</strong> – ${g.opponentScore}</td>
      <td>${g.result}</td>
    </tr>`).join('');

  const teamPlayers = agg.leaderboard.filter((p) => p.team === teamName);
  const playerRows = teamPlayers.map((p) => `
    <tr class="ts-row-clickable" data-action="ts-show-player" data-team="${escapeHtml(p.team)}" data-player="${escapeHtml(p.name)}">
      <td>${escapeHtml(p.name)}</td>
      <td>${p.points}</td>
      <td>${p.gamesPlayed}</td>
      <td>${p.ppg.toFixed(1)}</td>
      <td>${p.bestGame}</td>
    </tr>`).join('');

  return `
    <div class="ts-breadcrumbs">
      <a data-action="ts-show-standings">← All standings</a>
    </div>
    <h3>${escapeHtml(teamName)}</h3>
    <div class="ts-team-meta">
      <span><strong>${team.wins}</strong>W – <strong>${team.losses}</strong>L${team.ties ? ` – <strong>${team.ties}</strong>T` : ''}</span>
      <span>PF ${team.pointsFor} · PA ${team.pointsAgainst} · ± ${team.pointsFor - team.pointsAgainst >= 0 ? '+' : ''}${team.pointsFor - team.pointsAgainst}</span>
    </div>
    <div class="ts-grid">
      <div class="ts-panel">
        <h3>Games</h3>
        <table class="ts-table">
          <thead><tr><th>Packet</th><th>Opponent</th><th>Score</th><th>Result</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="ts-hint">Click a game for the per-player breakdown.</div>
      </div>
      <div class="ts-panel">
        <h3>Player Totals</h3>
        <table class="ts-table">
          <thead><tr><th>Player</th><th>Pts</th><th>GP</th><th>PPG</th><th>Best</th></tr></thead>
          <tbody>${playerRows}</tbody>
        </table>
        <div class="ts-hint">Click a player to drill in.</div>
      </div>
    </div>`;
}

function renderPlayerView(agg) {
  const playerName = tsState.selectedPlayer;
  const teamName = tsState.selectedTeam;
  const player = agg.leaderboard.find((p) => p.name === playerName && p.team === teamName);
  if (!player) return `<div class="ts-empty">Player not found.</div>`;

  const games = gamesForPlayer(tsState.games, playerName, teamName);
  games.sort((x, y) => String(x.exportedAt).localeCompare(String(y.exportedAt)));

  const rows = games.map((g) => `
    <tr class="ts-row-clickable ts-result-${g.result}" data-action="ts-show-game" data-game-id="${escapeHtml(g.id)}">
      <td>${escapeHtml(g.packet || '—')}</td>
      <td>${escapeHtml(g.opponent)}</td>
      <td><strong>${g.points}</strong></td>
      <td>${g.teamScore} – ${g.opponentScore}</td>
      <td>${g.result}</td>
    </tr>`).join('');

  // Quick descriptive stats: high, low, std-dev approximation.
  const pts = games.map((g) => g.points);
  const high = pts.length ? Math.max(...pts) : 0;
  const low = pts.length ? Math.min(...pts) : 0;

  return `
    <div class="ts-breadcrumbs">
      <a data-action="ts-show-standings">← All standings</a>
      · <a data-action="ts-show-team" data-team="${escapeHtml(teamName)}">${escapeHtml(teamName)}</a>
    </div>
    <h3>${escapeHtml(playerName)} <span class="ts-team-meta-inline">${escapeHtml(teamName)}</span></h3>
    <div class="ts-team-meta">
      <span>Total <strong>${player.points}</strong> pts</span>
      <span>${player.gamesPlayed} GP</span>
      <span>PPG <strong>${player.ppg.toFixed(1)}</strong></span>
      <span>High ${high} · Low ${low}</span>
    </div>
    <div class="ts-panel">
      <h3>Per-Game Performances</h3>
      <table class="ts-table">
        <thead><tr><th>Packet</th><th>Opponent</th><th>Pts</th><th>Team Score</th><th>Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="ts-hint">Click a row to see the full game breakdown.</div>
    </div>`;
}

function renderGameView() {
  const game = tsState.games.find((g) => g.id === tsState.selectedGameId);
  if (!game) return `<div class="ts-empty">Game not found.</div>`;
  const winner = game.scoreA > game.scoreB ? game.teamA
                : game.scoreB > game.scoreA ? game.teamB
                : 'Tie';
  const playersOf = (team) => game.players
    .filter((p) => p.team === team)
    .sort((x, y) => y.points - x.points);
  const tableFor = (team, score) => {
    const rows = playersOf(team).map((p) =>
      `<tr class="ts-row-clickable" data-action="ts-show-player" data-team="${escapeHtml(team)}" data-player="${escapeHtml(p.name)}"><td>${escapeHtml(p.name)}</td><td>${p.points}</td></tr>`).join('');
    return `
      <div class="ts-panel">
        <h3>${escapeHtml(team)} <span class="ts-team-score">${score}</span></h3>
        <table class="ts-table">
          <thead><tr><th>Player</th><th>Points</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  };
  // Build breadcrumbs back to whatever the user came from.
  const crumbs = ['<a data-action="ts-show-standings">← All standings</a>'];
  if (tsState.selectedTeam) {
    crumbs.push(`<a data-action="ts-show-team" data-team="${escapeHtml(tsState.selectedTeam)}">${escapeHtml(tsState.selectedTeam)}</a>`);
  }
  if (tsState.selectedPlayer) {
    crumbs.push(`<a data-action="ts-show-player" data-team="${escapeHtml(tsState.selectedTeam)}" data-player="${escapeHtml(tsState.selectedPlayer)}">${escapeHtml(tsState.selectedPlayer)}</a>`);
  }
  return `
    <div class="ts-breadcrumbs">${crumbs.join(' · ')}</div>
    <h3>${escapeHtml(game.packet || 'Game')}</h3>
    <div class="ts-team-meta">
      <span><strong>${escapeHtml(game.teamA)} ${game.scoreA}</strong> – <strong>${game.scoreB} ${escapeHtml(game.teamB)}</strong></span>
      <span>Winner: ${winner === 'Tie' ? 'Tie' : `<strong>${escapeHtml(winner)}</strong>`}</span>
    </div>
    <div class="ts-grid">
      ${tableFor(game.teamA, game.scoreA)}
      ${tableFor(game.teamB, game.scoreB)}
    </div>`;
}

function render() {
  const content = document.getElementById('ts-content');
  if (!content) return;
  if (!tsState.games.length) {
    content.innerHTML = `<div class="ts-empty">No games loaded yet. Upload CSVs above to get started.</div>`;
    return;
  }
  const agg = aggregateTournament(tsState.games);
  if (tsState.view === 'team')        content.innerHTML = renderTeamView(agg);
  else if (tsState.view === 'player') content.innerHTML = renderPlayerView(agg);
  else if (tsState.view === 'game')   content.innerHTML = renderGameView();
  else                                content.innerHTML = renderStandings(agg);
}

export function setupTournamentStats({ manifestUrl } = {}) {
  loadPersisted();

  const input = document.getElementById('ts-file-input');
  if (input) {
    input.addEventListener('change', async (e) => {
      await handleUpload(e.target.files);
      e.target.value = '';
    });
  }
  // Delegated click handler for everything inside the section, so it
  // survives re-renders of #ts-content.
  const section = document.getElementById('tournament-stats-section');
  if (section) {
    section.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'ts-clear-uploaded')      clearUploaded();
      else if (action === 'ts-clear-published') clearPublished();
      else if (action === 'ts-show-standings') showStandings();
      else if (action === 'ts-show-team')      showTeam(target.dataset.team);
      else if (action === 'ts-show-player')    showPlayer(target.dataset.team, target.dataset.player);
      else if (action === 'ts-show-game')      showGame(target.dataset.gameId);
    });
  }
  render();

  // Manifest fetch runs async — render() above shows whatever we restored
  // from localStorage immediately, then the manifest update re-renders
  // when the network responds.
  if (manifestUrl) loadFromManifest(manifestUrl);
}

// Test/inspection helpers — not used by the app.
export function _getTsState() { return tsState; }
export function _resetTsStateForTests() {
  tsState.games = [];
  resetView();
}
