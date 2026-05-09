// Entry point for stats.html (the standalone, public-facing tournament
// stats page). This page does NOT load the scorekeeper; it only renders
// the tournament-stats viewer, with auto-load wired to the manifest in
// assets/tournament-results/.
//
// The viewer module (ui/tournament-stats.js) is shared with the eventual
// in-app embedding, but the public page is the primary surface — pushing
// new CSVs + manifest to GitHub redeploys the page with fresh stats.

import { setupTournamentStats } from './ui/tournament-stats.js';

setupTournamentStats({
  manifestUrl: 'assets/tournament-results/manifest.json',
});
