# consensus-scorekeeper

A browser-based scorekeeper and tournament-stats viewer for
[Consensus](https://consensustrivia.com/) trivia. Static site — no build
step, no backend; just open the HTML.

## Pages

- **`index.html`** — the live scorekeeper. Upload a packet PDF (or pick
  one from the consensustrivia.com browser), set up rosters, run the
  game with keyboard shortcuts, export per-game CSV results.
- **`tournaments/`** — the tournament-stats hub. Lists every tournament
  hosted here with a search box; pick one to see its standings.
- **`tournaments/<slug>/`** — per-tournament stats viewer. Auto-loads
  CSVs from that folder's `results/manifest.json`. Click into a team to
  see their games, into a game for the per-player breakdown, or into a
  player for their per-game performances.
- **`stats.html`** — legacy redirect to `tournaments/` for old bookmarks.

## Run locally

```
python serve.py
```

Then open http://localhost:8000/ for the scorekeeper or
http://localhost:8000/tournaments/ for the stats hub. The bundled dev
server also proxies `/proxy/` to consensustrivia.com so the in-app pack
browser works without CORS headaches.

## Tournament workflow

When running a tournament with multiple rooms:

1. Each room uses `index.html` to score its game and clicks **Export
   CSV** at the end.
2. Collect the CSVs and drop them into `tournaments/<slug>/results/`.
3. `git add` + commit + push.
4. A GitHub Action regenerates that folder's `manifest.json`
   automatically. The next visit to `tournaments/<slug>/` shows the
   updated standings, leaderboard, and drill-downs.

That's it — there's no script to run by hand.
`scripts/update_manifests.py` exists as a manual fallback for
offline/local development.

To start a new tournament, add an entry to `TOURNAMENTS` in
`src/ui/roster-presets.js`, create `tournaments/<new-slug>/index.html`
(copy + adjust the slug from the Stanford one), and drop CSVs in
`tournaments/<new-slug>/results/`. The hub picks it up automatically.

## Roster modes

The setup screen has a top-right toggle labeled **"Tournament rosters"**:

- **OFF** (default) — team-name field is a text input. Rosters built
  manually.
- **ON** — team-name field is a dropdown of preset rosters; an
  additional "Rosters from" dropdown lets you pick which tournament's
  rosters to load (defined in `src/ui/roster-presets.js`).

Add/remove player buttons work in either mode. The autocomplete
`<datalist>` on the add-player input includes every known player name
across every tournament.

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

Vitest + happy-dom. ~120 tests covering the parser, scoring reducers,
CSV exporter round-trip, tournament aggregator, and a structural sweep
across every `tournaments/*/results/` folder.

## Internal notes

`CLAUDE.md` documents architecture conventions, module layout, and the
parts of the code that aren't obvious from reading it (state ownership,
persistence keys, multi-page module sharing rules, the
adding-a-tournament runbook). Read that before refactoring.
