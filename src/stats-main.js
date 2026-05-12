// Entry point for every per-tournament stats page (e.g.
// tournaments/<slug>/index.html). Identifies the current tournament from
// a <meta name="tournament-slug"> tag, looks up the matching entry in
// TOURNAMENTS, stamps the document title + page heading, then wires up
// the manifest-driven viewer.
//
// The manifest lives next to this page at ./results/manifest.json — the
// auto-manifest GitHub workflow regenerates it on every push that touches
// tournaments/<slug>/results/.

import { setupTournamentStats } from './ui/tournament-stats.js';
import { getTournamentBySlug } from './ui/roster-presets.js';

const slugMeta = document.querySelector('meta[name="tournament-slug"]');
const slug = slugMeta ? slugMeta.content : '';
const tournament = getTournamentBySlug(slug);

if (tournament) {
  document.title = `${tournament.name} — Stats`;
  const heading = document.getElementById('stats-page-heading');
  if (heading) heading.textContent = tournament.name;
} else if (slug) {
  console.warn(`[stats-main] no TOURNAMENTS entry for slug "${slug}"`);
}

setupTournamentStats({ manifestUrl: 'results/manifest.json' });
