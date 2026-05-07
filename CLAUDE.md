# CLAUDE.md

Notes for Claude Code working in this repo.

## Project shape

- `index.html` — the entire app (HTML + CSS + JS in one file). Single-page scorekeeper that parses Consensus trivia packet PDFs and tracks per-question scoring.
- `serve.py` — local dev server on port 8000. Also exposes `/proxy/<encoded-url>` to proxy whitelisted requests to `consensustrivia.com`, bypassing CORS during local dev.
- `scrape_packs.py` — regenerates the in-page `PACK_CATALOG` by scraping `consensustrivia.com`. See below.

## Regenerating the pack catalog

`PACK_CATALOG` in `index.html` (search for `// ==================== ONLINE PACK BROWSER ====================`) drives the "browse packs from consensustrivia.com" UI. Each entry encodes the level, season, tournament name, URL slug (`dir`), file-name prefix, and number of packs. The site grows over time — championships in particular accumulate packs past the original count of 10 — so the catalog needs occasional refreshing.

`scrape_packs.py` walks the two index pages (`/post-secondary/packs.html`, `/high-school/packs.html`), follows each tournament's detail page, counts the `Pack N.pdf` links, and prints a drop-in JS catalog snippet. It uses only the Python standard library (`urllib`, `html.parser`).

### How to run

On this machine the default `python` shim points at the Microsoft Store stub (not actually installed). Use the miniforge interpreter explicitly:

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

Replace the existing `PACK_CATALOG = [ ... ];` block in `index.html` with the stdout snippet. The schema is identical to what's already there, so nothing else needs to change. Spot-check the diff for any tournament whose pack count dropped — that would suggest the site reorganized something the scraper didn't anticipate.

### When to re-run

- Any time someone reports a missing pack in the browser UI.
- After a new tournament is announced on consensustrivia.com.
- When a championship advances and adds more rounds (these regularly grow past 10 packs).

### What the scraper assumes

- Tournament detail pages link directly to each `Pack N.pdf` with the canonical filename (`<prefix> Pack <N>.pdf`).
- The high-school index lists divisions inline as `<li>Tournament Name (<a>junior</a> | <a>high school</a>)</li>`. Division-to-suffix mapping is hard-coded in `DIVISION_SUFFIX` (junior → " (Junior)", "high school" → "", "B division" → " (B)") to match the existing display names.
- Season is extracted from the nearest enclosing heading via `\d{4}-\d{2}`.

If the site changes its markup, those assumptions are the first places to look.
