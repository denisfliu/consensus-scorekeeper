// End-to-end check: parse every CSV under assets/fake-tournament/ through
// parseResultsCsv, run them through aggregateTournament, and assert the
// shape we expect for the bundled round-robin (28 games, 8 teams).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseResultsCsv } from '../src/util/parse-results-csv.js';
import { aggregateTournament, gamesForTeam } from '../src/util/tournament-aggregate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(here, '..', 'assets', 'tournament-results');

function loadFixtures() {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.csv'));
  return files.map((name) => {
    const text = readFileSync(path.join(FIXTURE_DIR, name), 'utf-8');
    return { id: name, ...parseResultsCsv(text) };
  });
}

function loadManifest() {
  const text = readFileSync(path.join(FIXTURE_DIR, 'manifest.json'), 'utf-8');
  return JSON.parse(text);
}

describe('fake-tournament fixtures', () => {
  const games = loadFixtures();

  it('contains the full round-robin (28 games over 8 teams)', () => {
    expect(games).toHaveLength(28);
    const teams = new Set();
    for (const g of games) { teams.add(g.teamA); teams.add(g.teamB); }
    expect(teams.size).toBe(8);
  });

  it('uses 7 packs × 4 games-per-pack (one pack per round)', () => {
    const packCounts = {};
    for (const g of games) {
      packCounts[g.packet] = (packCounts[g.packet] || 0) + 1;
    }
    const counts = Object.values(packCounts);
    expect(counts).toHaveLength(7);
    expect(counts.every((c) => c === 4)).toBe(true);
  });

  it('every game parses with non-empty teams, both scores, and player rows', () => {
    for (const g of games) {
      expect(g.teamA, g.id).toBeTruthy();
      expect(g.teamB, g.id).toBeTruthy();
      expect(Number.isInteger(g.scoreA), g.id).toBe(true);
      expect(Number.isInteger(g.scoreB), g.id).toBe(true);
      expect(g.players.length, g.id).toBeGreaterThan(0);
    }
  });

  it('aggregates without error and each team plays everyone else exactly once', () => {
    const agg = aggregateTournament(games);
    expect(agg.standings).toHaveLength(8);
    for (const team of agg.standings) {
      expect(team.gamesPlayed).toBe(7); // round-robin against the other 7
      const opponents = gamesForTeam(games, team.name).map((g) => g.opponent);
      expect(new Set(opponents).size).toBe(7);
    }
    expect(agg.summary.totalGames).toBe(28);
    expect(agg.summary.closestGame).toBeTruthy();
    expect(agg.summary.bestPlayerGame).toBeTruthy();
    // Blowout was removed — make sure it stays gone.
    expect(agg.summary.biggestBlowout).toBeUndefined();
  });

  it('manifest.json lists every CSV in the folder', () => {
    const manifest = loadManifest();
    const csvFiles = readdirSync(FIXTURE_DIR)
      .filter((f) => f.endsWith('.csv'))
      .sort();
    expect(manifest.games.slice().sort()).toEqual(csvFiles);
  });

  it('total wins across the field equals games minus ties', () => {
    const agg = aggregateTournament(games);
    const totalWins = agg.standings.reduce((s, t) => s + t.wins, 0);
    const totalTies = agg.standings.reduce((s, t) => s + t.ties, 0);
    // Each non-tie game contributes 1 win + 1 loss; tie contributes 0/0/2.
    expect(totalWins).toBe(28 - totalTies / 2);
  });
});
