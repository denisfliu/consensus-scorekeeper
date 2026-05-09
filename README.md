# consensus-scorekeeper

A browser-based scorekeeper and tournament-stats viewer for
[Consensus](https://consensustrivia.com/) trivia. Static site — no build
step, no backend; just open the HTML.

## Two pages

- **`index.html`** — the live scorekeeper. Upload a packet PDF (or pick
  one from the consensustrivia.com browser), set up rosters, run the
  game with keyboard shortcuts, export per-game CSV results.
- **`stats.html`** — the tournament stats viewer. Auto-loads CSVs
  published in `assets/tournament-results/`, plus optional local uploads.
  Click into a team to see their games, into a game for the per-player
  breakdown, or into a player for their per-game performances.

## Run locally

```
python serve.py
```

Then open http://localhost:8000/ for the scorekeeper or
http://localhost:8000/stats.html for the stats viewer. The bundled dev
server also proxies `/proxy/` to consensustrivia.com so the in-app pack
browser works without CORS headaches.

## Tournament workflow

When running a tournament with multiple rooms:

1. Each room uses `index.html` to score its game and clicks **Export
   CSV** at the end.
2. Collect the CSVs and drop them into `assets/tournament-results/`.
3. `git add` + commit + push.
4. A GitHub Action regenerates `manifest.json` automatically. The next
   visit to `stats.html` shows the updated standings, leaderboard, and
   drill-downs.

That's it — there's no script to run by hand.
`scripts/update_results_manifest.py` exists as a manual fallback for
offline/local development.

For a demo run with eight preset rosters and a fake round-robin, the
folder is pre-populated by `scripts/generate_fake_tournament.py`.

## Roster modes

The setup screen has a top-right toggle:

- **Tournament** (default) — team-name field is a dropdown of preset
  rosters from `src/ui/roster-presets.js`; picking a team auto-fills its
  players.
- **Custom** — original behavior: type a team name, add players manually.

Add/remove player buttons work in either mode. The autocomplete
`<datalist>` on the add-player input includes every known player name
(handy when last-minute subs have unusual spellings).

## Tutorial

New moderators can click **Tutorial** on the setup screen to launch a
sandbox session: preset rosters, bundled sample pack, and a 13-step
coach-marks overlay walking through every control and shortcut. The
tutorial doesn't touch saved-game persistence — exiting reloads the page
and restores whatever real session you had open.

## Tests

```
npm install         # one-time
npm test            # run the suite
```

Vitest + happy-dom. ~100 tests covering the parser, scoring reducers,
CSV exporter round-trip, tournament aggregator, and the full set of
fake-tournament fixtures.

## Internal notes

`CLAUDE.md` documents architecture conventions, module layout, and the
parts of the code that aren't obvious from reading it (state ownership,
persistence keys, two-page module sharing rules). Read that before
refactoring.
