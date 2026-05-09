# CLAUDE.md

Notes for Claude Code working in this repo.

## Two pages, one shared library

There are **two** static HTML entry points:

- `index.html` → the live scorekeeper. Boots the scoring UI, parses the
  PDF, drives all the in-game features.
- `stats.html` → the public-facing tournament stats viewer. Loads exported
  CSVs (auto-fetched from `assets/tournament-results/` + optional local
  uploads), renders standings / leaderboards / per-game / per-player
  drill-downs.

They share `styles/main.css` and the contents of `src/`. Each has its own
entry-point JS (`src/main.js` for the scorekeeper, `src/stats-main.js` for
stats). There is no bundler — `serve.py` (or any static server) serves the
files directly.

## Project shape

```
index.html              ← scorekeeper shell
stats.html              ← standalone tournament stats page
styles/main.css         ← the app's stylesheet (shared by both pages)
src/
  main.js               ← scorekeeper entry: imports modules, wires DOM, loadState()
  stats-main.js         ← stats.html entry: setupTournamentStats({ manifestUrl })
  state.js              ← state singleton + reducers + subscribe()
  loader.js             ← parsePdf / processZipBuffer / handleZipUpload orchestrators
  parser/
    zip.js              ← readZip, looksLikePdfOrZip
    pdf-text.js         ← extractRichLinesFromPdf (pdf.js → lines/segments/posMap)
    questions.js        ← parseQuestions + cleanTrailing + extractRichRange + richToHtml
  game/
    streaks.js          ← rebuildStreakGroups
    jailbreak.js        ← rebuildJailbreakLocks
    categories.js       ← getInitials, getAnsweredBy, getSplitPair, getCategoryRunSize
    persistence.js      ← saveState, loadPdfBytes, savePdfBytes, clearSavedState, isGameVisible
  ui/
    setup.js            ← roster CRUD + roster-mode toggle (tournament/custom)
    roster-presets.js   ← ROSTER_PRESETS + PLAYER_SUGGESTIONS for tournament-mode dropdowns
    game.js             ← renderGame (single state subscriber), renderQuestion, etc.
    pdf-viewer.js       ← inline + fullscreen pdf.js viewer
    scoreboard-popout.js ← BroadcastChannel + popout HTML template
    pack-browser.js     ← PACK_CATALOG, fetchWithFallback, renderBrowser
    keybinds.js         ← global keydown listener
    splitter.js         ← attachSplitter
    dev-tools.js        ← reparseCurrentPdf, applyCustomAward, populateCustomAward
    tutorial.js         ← startTutorialGame: boots a sandbox session w/ preset rosters + pack
    tutorial-overlay.js ← 13-step coach-marks overlay engine (multi-target highlight)
    tournament-stats.js ← setupTournamentStats: upload + manifest fetch + view router
  util/
    escape.js           ← escapeHtml, csvEscape
    csv.js              ← buildResultsCsv, buildResultsFilename (used by exportCsv)
    parse-results-csv.js ← parseResultsCsv: round-trip of buildResultsCsv output
    tournament-aggregate.js ← aggregateTournament + gamesForTeam + gamesForPlayer
assets/
  tutorial-pack.pdf     ← bundled pack the tutorial sandbox loads
  tournament-results/   ← published CSVs + manifest.json (fetched by stats.html)
scripts/                ← Python helpers; run from anywhere (paths use __file__)
  serve.py is at root   ← local dev server (port 8000); also /proxy/ for consensustrivia.com
  scrape_packs.py       ← regenerates ui/pack-browser.js's PACK_CATALOG
  generate_fake_tournament.py  ← writes 28-game round-robin into assets/tournament-results/
  update_results_manifest.py   ← rewrites assets/tournament-results/manifest.json
.github/workflows/
  update-manifest.yml   ← auto-regenerates manifest.json on push (see below)
tests/                  ← vitest tests; run with `npm test`
```

## Architecture conventions

- **State mutations go through reducers in `src/state.js`** (addPoints,
  undoLast, clearCurrentQuestion, resetStreak, applyCustomAward,
  clearPlayerPoints). UI modules call these — they should never write to
  `state.foo` directly.
- **State change → re-render** is wired via a single `subscribe(renderGame)`
  call inside `setupGameScreen()`. Every reducer ends with `notify()`.
- **Inline `onclick=""` is forbidden in index.html.** Static buttons use
  `data-action="..."` and are dispatched by the table in `src/main.js`.
  Dynamically rendered buttons (player panels, sidebar, roster, stats
  tables) use delegated listeners on a stable parent — see each `setupX()`.
- **Pure logic lives outside `ui/`.** Anything that touches `document` or
  `window` belongs in `ui/` or `loader.js`; anything else should be unit
  testable without a DOM. The whole `util/` tree (parse-results-csv,
  tournament-aggregate, csv, escape) is DOM-free.
- **Persistence keys are namespaced and versioned.** Each subsystem owns
  its own localStorage key:
  - `consensus-state-v1`            — saved scorekeeper game (game/persistence.js)
  - `consensus-stats-pdf-v1`        — saved PDF bytes (game/persistence.js)
  - `consensus-roster-mode-v1`      — tournament/custom toggle (ui/setup.js)
  - `consensus-tournament-games-v1` — uploaded + cached manifest games (ui/tournament-stats.js)
- **Two pages share modules**, so anything imported by `stats-main.js`
  must not assume scorekeeper-only DOM exists. tournament-stats.js, the
  util modules, and roster-presets.js are page-agnostic; everything else
  in `ui/` (setup.js, game.js, pdf-viewer.js, etc.) is index.html-only.

## Roster mode toggle

The setup screen has a top-right toggle that flips between two modes:

- **Tournament** (default) — team-name field is a `<select>` populated
  from `ROSTER_PRESETS` (see `src/ui/roster-presets.js`). Picking a team
  auto-fills the player list. Adding a player offers an autocomplete
  `<datalist>` of all known names (including ones intentionally absent
  from default rosters, e.g. last-minute subs whose names are easy to
  misspell).
- **Custom** — original behavior: a free-text `<input>` for the team
  name; rosters built manually.

Mode is mirrored onto `#setup` as `data-roster-mode="…"` so CSS-only
sections can show/hide themselves without JS coordination.

`setTeamNameField(team, name)` is the mode-aware setter that
`loadState`, `tutorial.js`, and the toggle itself use to display a name
in whichever element is currently mounted.

## Tutorial

`startTutorialGame()` (`src/ui/tutorial.js`) boots a sandbox session:

- Sets `state.tutorialMode = true` so saveState / savePdfBytes early-return
  and the tutorial doesn't pollute the user's saved game.
- Loads `assets/tutorial-pack.pdf`, applies preset rosters, calls
  `startGame()`, then triggers `startTutorial()` from
  `src/ui/tutorial-overlay.js`.
- `exitTutorial()` reloads the page, which both clears `tutorialMode` and
  restores any pre-tutorial saved game.

The overlay supports multi-target highlights (the `target` field accepts
either a CSS selector string or an array — first match gets the dim
spotlight, the rest get an outline only). Step 10 uses this to highlight
±Points + the inline PDF + the Hide-PDF toggle simultaneously.

## Tournament stats (stats.html)

The standalone stats page ingests CSVs from two sources:

- **Manifest auto-load** — `assets/tournament-results/manifest.json`
  (shape `{"games": [...]}`) is fetched on every page load. Listed CSVs
  are tagged `source: 'manifest'` and refreshed on each load (so a new
  push reflects on the next visit).
- **Manual upload** — `<input type="file" multiple>`. Tagged
  `source: 'upload'`, persisted to localStorage, never sent anywhere.

The two sets coexist; "Clear my uploads" / "Clear published" act on each
independently.

Views (state machine in `tournament-stats.js`):

- `standings` — team table stacked above individual leaderboard
  (full-width to avoid horizontal scroll), plus a summary card.
- `team` — record + games + per-player totals; click a row to drill in.
- `player` — per-game performance for one player on one team (matches
  on `(name, team)` so same-name-different-team players don't collide).
- `game` — full per-player breakdown for both sides.

Pure logic for these lives in `src/util/tournament-aggregate.js`
(`aggregateTournament`, `gamesForTeam`, `gamesForPlayer`) and
`src/util/parse-results-csv.js` — both unit-tested without a DOM.

### Auto-manifest workflow

`stats.html` loads `assets/tournament-results/manifest.json` to know
which CSVs to fetch. **You don't write the manifest by hand.** The
`.github/workflows/update-manifest.yml` Action regenerates it on every
push that touches the folder, so the maintainer's flow is:

1. Drop CSV(s) into `assets/tournament-results/`
2. `git add` + commit + push

The Action runs `python scripts/update_results_manifest.py` and commits
the result if it changed (skip-otherwise so it doesn't bounce on its
own commits — also guarded by a path filter that excludes manifest.json).

`scripts/update_results_manifest.py` is a manual fallback for local dev
(when running `python serve.py` against an unpushed checkout).
`scripts/generate_fake_tournament.py` re-rolls the demo data and writes
the manifest at the end.

## Tests

```
npm install         # one-time: installs vitest + happy-dom
npm test            # runs all tests once
npm run test:watch  # watch mode
```

Tests live in `tests/*.test.js`. They import from `../src/main.js` (which
re-exports the public surface) so a future module split inside `src/` is
transparent to tests. Notable test files:

- `parse-questions.test.js`        — synthetic PDF input → parsed questions
- `state-mutations.test.js`        — reducer correctness
- `export-csv.test.js`             — CSV layout snapshot (keep multi-section format intact)
- `parse-results-csv.test.js`      — round-trip of the CSV exporter
- `tournament-aggregate.test.js`   — standings sort, leaderboard, per-team / per-player
- `tournament-fixtures.test.js`    — runs every CSV in `assets/tournament-results/`
                                     through parse + aggregate, plus asserts the manifest
                                     stays in sync with the folder

If you add stats functionality, add fixtures + assertions there so the
manifest can't silently drift.

## Regenerating the pack catalog

`PACK_CATALOG` lives in `src/ui/pack-browser.js` and drives the "browse
packs from consensustrivia.com" UI. Each entry encodes the level, season,
tournament name, URL slug (`dir`), file-name prefix, and number of packs.
The site grows over time — championships in particular accumulate packs
past the original count of 10 — so the catalog needs occasional refreshing.

`scripts/scrape_packs.py` walks the two index pages
(`/post-secondary/packs.html`, `/high-school/packs.html`), follows each
tournament's detail page, counts the `Pack N.pdf` links, and prints a
drop-in JS catalog snippet. It uses only the Python standard library
(`urllib`, `html.parser`).

### How to run

On this machine the default `python` shim points at the Microsoft Store
stub (not actually installed). Use the miniforge interpreter explicitly:

```
& "C:\Users\denis\miniforge3\python.exe" scripts\scrape_packs.py
```

Or from a regular shell where Python is on PATH:

```
python scripts/scrape_packs.py
```

Output:
- **stdout** — a `const PACK_CATALOG = [ ... ];` block.
- **stderr** — per-tournament progress (season, name, detail URL, pack count).

### Applying the output

Replace the existing `PACK_CATALOG = [ ... ];` block in
`src/ui/pack-browser.js` with the stdout snippet. The schema is identical
to what's already there, so nothing else needs to change. Spot-check the
diff for any tournament whose pack count dropped — that would suggest the
site reorganized something the scraper didn't anticipate.

### When to re-run

- Any time someone reports a missing pack in the browser UI.
- After a new tournament is announced on consensustrivia.com.
- When a championship advances and adds more rounds (these regularly grow
  past 10 packs).

### What the scraper assumes

- Tournament detail pages link directly to each `Pack N.pdf` with the
  canonical filename (`<prefix> Pack <N>.pdf`).
- The high-school index lists divisions inline as `<li>Tournament Name
  (<a>junior</a> | <a>high school</a>)</li>`. Division-to-suffix mapping
  is hard-coded in `DIVISION_SUFFIX` (junior → " (Junior)", "high school"
  → "", "B division" → " (B)") to match the existing display names.
- Season is extracted from the nearest enclosing heading via
  `\d{4}-\d{2}`.

If the site changes its markup, those assumptions are the first places
to look.
