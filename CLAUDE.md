# CLAUDE.md

Notes for Claude Code working in this repo.

## Project shape

```
index.html              ← shell only: HTML + <link styles/main.css> + <script src=src/main.js>
styles/main.css         ← the app's stylesheet
src/
  main.js               ← entry: imports every module, wires DOM, calls loadState()
  state.js              ← state singleton + reducers (addPoints, undo, ...) + subscribe()
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
    setup.js            ← roster CRUD + setup-screen listeners
    game.js             ← renderGame (the single state subscriber), renderQuestion,
                          renderPlayerPanel, sidebar, prev/next/skip/goToQuestion,
                          startGame, backToSetup, padQuestionsToSlots
    pdf-viewer.js       ← inline + fullscreen pdf.js viewer
    scoreboard-popout.js ← BroadcastChannel + popout HTML template
    pack-browser.js     ← PACK_CATALOG, fetchWithFallback, renderBrowser
    keybinds.js         ← global keydown listener
    splitter.js         ← attachSplitter
    dev-tools.js        ← reparseCurrentPdf, applyCustomAward, populateCustomAward
  util/
    escape.js           ← escapeHtml, csvEscape
    csv.js              ← buildResultsCsv, buildResultsFilename
serve.py                ← local dev server (port 8000); also a /proxy/ for consensustrivia.com
scrape_packs.py         ← regenerates ui/pack-browser.js's PACK_CATALOG (see below)
tests/                  ← vitest tests; run with `npm test`
```

The whole app loads as ES modules. There is no bundler — `serve.py` (or any
static server) serves the files directly.

## Architecture conventions

- **State mutations go through reducers in `src/state.js`** (addPoints,
  undoLast, clearCurrentQuestion, resetStreak, applyCustomAward,
  clearPlayerPoints). UI modules call these — they should never write to
  `state.foo` directly.
- **State change → re-render** is wired via a single `subscribe(renderGame)`
  call inside `setupGameScreen()`. Every reducer ends with `notify()`.
- **Inline `onclick=""` is forbidden in index.html.** Static buttons use
  `data-action="..."` and are dispatched by the table in `src/main.js`.
  Dynamically rendered buttons (player panels, sidebar, roster) use
  delegated listeners on a stable parent — see each `setupX()`.
- **Pure logic lives outside `ui/`.** Anything that touches `document` or
  `window` belongs in `ui/` or `loader.js`; anything else should be unit
  testable without a DOM.

## Tests

```
npm install         # one-time: installs vitest + happy-dom
npm test            # runs all tests once
npm run test:watch  # watch mode
```

Tests live in `tests/*.test.js`. They import from `../src/main.js` (which
re-exports the public surface) so a future module split inside `src/` is
transparent to tests. Synthetic-input tests for the parser are in
`tests/parse-questions.test.js`; mutation tests in
`tests/state-mutations.test.js`. CSV layout is snapshot-asserted in
`tests/export-csv.test.js` — keep the multi-section format intact.

## Regenerating the pack catalog

`PACK_CATALOG` lives in `src/ui/pack-browser.js` and drives the "browse
packs from consensustrivia.com" UI. Each entry encodes the level, season,
tournament name, URL slug (`dir`), file-name prefix, and number of packs.
The site grows over time — championships in particular accumulate packs
past the original count of 10 — so the catalog needs occasional refreshing.

`scrape_packs.py` walks the two index pages
(`/post-secondary/packs.html`, `/high-school/packs.html`), follows each
tournament's detail page, counts the `Pack N.pdf` links, and prints a
drop-in JS catalog snippet. It uses only the Python standard library
(`urllib`, `html.parser`).

### How to run

On this machine the default `python` shim points at the Microsoft Store
stub (not actually installed). Use the miniforge interpreter explicitly:

```
& "C:\Users\denis\miniforge3\python.exe" scrape_packs.py
```

Or from a regular shell where Python is on PATH:

```
python scrape_packs.py
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
